import { join } from 'path';

import Bluebird from 'bluebird';
import pointer from 'json-pointer';
import { JSONPath } from 'jsonpath-plus';
import PQueue from 'p-queue';
import debug from 'debug';

import type { TypeAssert } from '@oada/types';
import type { Resource } from '@oada/types/oada/resource';
import type { Link } from '@oada/types/oada/link/v1';
import type V2Changes from '@oada/types/oada/change/v2';
import type { ConnectionResponse } from '@oada/client';

import { Options, ItemState } from './Options';
import { Metadata } from './Metadata';

const info = debug('oada-list-lib:info');
const warn = debug('oada-list-lib:warn');
const trace = debug('oada-list-lib:trace');
const error = debug('oada-list-lib:error');

/**
 * Type for a single V2 OADA change (rather than the array)
 *
 * @todo fix the Change V2 types
 */
export type Change = V2Changes[0];

/**
 * @public
 */
export { Options, ItemState };

/**
 * @internal
 */
export type GetResponse<T = unknown> = ConnectionResponse & {
  data: T;
};

/**
 * Recursive version of the Partial utility type
 *
 * Makes nested properties optional too.
 */
type DeepPartial<T> = {
  [P in keyof T]?: DeepPartial<T[P]>;
};

/**
 * Tell TS we should never reach here (i.e., this should never be called)
 */
function assertNever(val: never, mesg?: string): never {
  throw new Error(mesg ?? `Bad value: ${val}`);
}

/**
 * Create a callback which assumes item(s) have the given state.
 * @param state The ItemsState to assume
 */
function assumeItemState<State extends ItemState>(state: State) {
  function assume(id: readonly string[]): State[];
  function assume(id: string): State;
  function assume(id: string | readonly string[]) {
    warn('Assuming state %s for item(s) %s', state, id);
    if (Array.isArray(id)) {
      const ids = id;
      return ids.map(() => state);
    }
    return state;
  }

  return assume;
}

/**
 * Type for the lists we can watch
 */
export type List = Resource & {
  [key: string]: Link | List;
};

/**
 * @internal
 */
declare module 'jsonpath-plus' {
  interface JSONPathCallable {
    (
      options: JSONPathOptions & {
        resultType: 'path' | 'pointer' | 'parentProperty';
        wrap?: true;
      }
    ): string[];
    (
      path: JSONPathOptions['path'],
      json: JSONPathOptions['json'],
      callback?: JSONPathOptions['callback'],
      otherTypeCallback?: JSONPathOptions['otherTypeCallback']
    ): any[];
  }
}

function getListItems(list: Partial<List>, path: string) {
  const pointers = JSONPath({
    resultType: 'pointer',
    path,
    json: list,
    preventEval: true,
  }).filter(
    // Don't follow underscore keys
    (p) => !/\/_/.test(p)
  );

  return pointers;
}

/**
 * OADA Tree
 *
 * @internal
 */
export type Tree = {
  _type?: string;
  _rev?: number;
} & (
  | {
      [key: string]: Tree;
    }
  | {}
);

/**
 * Generates an equivalent JSON Path from an OADA Tree object
 *
 * @internal
 * @experimental trees with multiple "paths" (excluing *)
 */
export function pathFromTree(tree: Tree, root = ''): string {
  let path = '$.*';
  let outPath = '$';

  const json = pointer.get(tree, root);
  while (true) {
    // Get set of non underscore keys
    const keys = [
      ...new Set(
        JSONPath({
          resultType: 'parentProperty',
          path,
          json,
        }).filter((k) => !k.startsWith('_'))
      ),
    ];
    if (keys.length === 0) {
      break;
    }

    outPath += '.' + (keys.length === 1 ? keys[0] : `[${keys.join(',')}]`);

    path += '.*';
  }

  return outPath;
}

/**
 * The main class of this library.
 * Watches an OADA list and calls various callbacks when appropriate.
 *
 * @public
 * @typeParam Item  The type of the items linked in the list
 * @see Options
 */
export class ListWatch<Item = unknown> {
  /**
   * The OADA path of the List being watched
   */
  public readonly path;
  /**
   * The JSON Path for the list items
   */
  public readonly itemsPath;
  /**
   * The OADA Tree for the List being watched
   * @see path
   */
  public readonly tree?;
  /**
   * The unique name of this service/watch
   */
  public readonly name;

  /**
   * Callback to make ListWatch consider every `Item` new
   *
   * @see getItemState
   * @see onNewList
   * @see ItemState.New
   */
  public static readonly AssumeNew = assumeItemState(ItemState.New);
  /**
   * Callback to make ListWatch consider every `Item` handled
   *
   * @see getItemState
   * @see onNewList
   * @see ItemState.Handled
   */
  public static readonly AssumeHandled = assumeItemState(ItemState.Handled);

  #resume;
  #conn;
  #id?: string;
  #assertItem;

  // _meta stuff
  #meta;

  // Callbacks
  #onAddItem?;
  #onChangeItem?;
  #onItem?;
  #onRemoveItem?;
  #onNewList: NonNullable<Options<Item>['onNewList']>;
  #onDeleteList;
  #getItemState;

  constructor({
    path,
    itemsPath,
    tree,
    name,
    resume = false,
    conn,
    // If no assert given, assume all items valid
    assertItem = () => {},
    onAddItem,
    onChangeItem,
    onItem,
    onRemoveItem,
    onNewList,
    onDeleteList = async () => {
      // TODO: Actually handle the list being deleted (redo watch?)
      error('Unhandled delete of list %s', path);
      process.exit();
    },
    // If no callback given, assume everything unknown is new
    getItemState = ListWatch.AssumeNew,
  }: Options<Item>) {
    this.path = path;
    this.tree = tree;
    this.name = name;
    this.#resume = resume;
    this.#conn = conn;
    this.#assertItem = assertItem;

    this.#onAddItem = onAddItem;
    this.#onChangeItem = onChangeItem;
    this.#onItem = onItem;
    this.#onRemoveItem = onRemoveItem;
    this.#onDeleteList = onDeleteList;
    this.#getItemState = getItemState;

    if (itemsPath) {
      this.itemsPath = itemsPath;
    } else {
      if (tree) {
        // Asume items are at the leaves of tree
        this.itemsPath = pathFromTree(tree, path);
      } else {
        // Assume flat list
        this.itemsPath = '$.*';
      }
    }

    if (onNewList) {
      this.#onNewList = onNewList;
    } else {
      // If no callback provided, ask client for states of pre-existing items
      this.#onNewList = (ids: readonly string[]) => {
        return Bluebird.map(ids, (id) => {
          try {
            return this.getItemState(id);
          } catch (err) {
            error(err, 'Error getting item state');
          }
        });
      };
    }

    this.#meta = new Metadata({
      // Don't persist metdata if service does not "resume"
      //persistInterval: this.#resume ? persistInterval : 0,
      conn: this.#resume ? this.#conn : undefined,
      path,
      tree,
      name,
    });
    this.initialize().catch(error);
  }

  /**
   * Force library to recheck all current list items
   * @see getItemState
   * @param all check even items we think were handled
   *
   * @todo Better name?
   */
  public async forceRecheck(
    /**
     * @default false
     */
    all = false
  ) {
    const { path } = this;
    const conn = this.#conn;

    const { data: list } = (await conn.get({ path })) as GetResponse<List>;
    //const items = Object.keys(list).filter((k) => !k.match(/^_/));
    const items = getListItems(list, this.itemsPath);

    //const { rev } = this.#meta;
    await Bluebird.map(items, async (id) => {
      try {
        if (!all && this.#meta.handled(id)) {
          // We think this item is handled
          return;
        }

        // Ask lib user for state of this item
        const state = await this.getItemState(id);

        await this.updateItemState(list, id, state);
      } catch (err: unknown) {
        error(err);
      }
    });
  }

  /**
   * Ask lib user for state of this item
   *
   * This handles fetching the Item before invoking the callback if needed
   */
  private async getItemState(id: string): Promise<ItemState> {
    // Needed because TS is weird about asserts...
    const assertItem: TypeAssert<Item> = this.#assertItem;

    if (!stateCBnoItem(this.#getItemState)) {
      const { data: item } = await this.#conn.get({
        path: join(this.path, id),
      });
      assertItem(item);
      return this.#getItemState(id, item);
    } else {
      return this.#getItemState(id);
    }
  }

  /**
   * Clean up metadata and unwatch list
   */
  public async stop() {
    await this.#conn.unwatch(this.#id!);
    await this.persistMeta();
    //this.#meta.stop();
  }

  /**
   * Persist relevant info to the `_meta` of the list.
   * This preserves it across restarts.
   */
  public async persistMeta() {
    //await this.#meta.persist();
  }

  private async handleNewItem(rev: string, id: string, item: Resource) {
    const { path } = this;
    // Needed because TS is weird about asserts...
    const assertItem: TypeAssert<Item> = this.#assertItem;

    info('Detected new item %s in %s, rev %s', id, path, rev);
    const { _rev } = item;
    assertItem(item);

    try {
      // Double check this is a new item?
      if (!(await this.#meta.handled(id))?.onAddItem) {
        await (this.#onAddItem && this.#onAddItem(item, id));
        await this.#meta.setHandled(id, { onAddItem: { rev: _rev + '' } });
      }
    } finally {
      // Call this even if previous callback errored

      // TODO: Do I need to make a fake "change" to the item
      // or will the feed have one??

      // Double check this item is actually newer than last time
      if (+_rev > +((await this.#meta.handled(id))?.onItem?.rev ?? 0)) {
        // TODO: Why doesn't this.#onItem?.() work?
        await (this.#onItem && this.#onItem(item, id));
        await this.#meta.setHandled(id, { onItem: { rev: _rev + '' } });
      }
    }
  }

  private async handleItemChange(id: string, change: Change) {
    const { path } = this;
    const conn = this.#conn;
    const rev = change.body._rev as string;

    // TODO: How best to handle change to a descendant of an item?
    info('Detected change to item %s in %s, rev %s', id, path, rev);

    const { _rev } = change.body;
    try {
      await (this.#onChangeItem && this.#onChangeItem(change, id));
      await this.#meta.setHandled(id, { onChangeItem: { rev: _rev + '' } });
    } finally {
      if (this.#onItem) {
        // Needed because TS is weird about asserts...
        const assertItem: TypeAssert<Item> = this.#assertItem;

        const { data: item } = await conn.get({
          path: join(path, id),
        });
        assertItem(item);
        await this.#onItem(item, id);
        await this.#meta.setHandled(id, { onItem: { rev: _rev + '' } });
      }
    }
  }

  private async handleListChange(
    list: DeepPartial<List>,
    type: Change['type']
  ): Promise<boolean> {
    const { path } = this;
    const conn = this.#conn;
    const rev = list._rev;
    // Ignore _ keys of OADA
    //const items = Object.keys(list).filter((k) => !k.match(/^_/));
    const items = getListItems(list as List, this.itemsPath);
    trace(items, 'handleListChange');

    switch (type) {
      case 'merge':
        await Bluebird.map(items, async (id) => {
          try {
            trace('handleListChange: Processing item %s', id);
            const lchange = pointer.get(list, id) as Partial<Link>;
            trace(lchange, 'handleListChange: lchange');

            // If there is an _id this is a new link in the list right?
            if (lchange._id) {
              trace(
                'handleListChange: lchange has an _id, getting it and handing to handleNewItem'
              );
              const { data: item } = (await conn.get({
                path: join(path, id),
              })) as GetResponse<Resource>;
              await this.handleNewItem(rev + '', id, item);
            } else {
              // TODO: What should we do now??
              trace(
                'Ignoring non-link key added to list %s, rev %s',
                path,
                rev
              );
            }
          } catch (err: unknown) {
            // Log error with this item but continue map over other items
            error(
              err,
              `Error processing change for ${id} at ${path}, rev ${rev}`
            );
          }
        });
        break;

      case 'delete':
        await Bluebird.map(items, async (id) => {
          try {
            const lchange = pointer.get(list, id);

            if (lchange === null) {
              info(
                'Detected removal of item %s from %s, rev %s',
                id,
                path,
                rev
              );
              try {
                await (this.#onRemoveItem && this.#onRemoveItem(id));
              } finally {
                // Mark for delete?
                await this.#meta.setHandled(id, undefined);
              }
            } else {
              // TODO: What does this mean??
              trace(
                'Ignoring non-link key added to list %s, rev %s',
                path,
                rev
              );
            }
          } catch (err: unknown) {
            // Log error with this item but continue map over other items
            error(
              err,
              `Error processing change for ${id} at ${path}, rev ${rev}`
            );
          }
        });
        break;
    }

    return items.length > 0;
  }

  /**
   * Update the states of list items
   *
   * @see ItemState
   */
  private async updateItemState(
    list: List,
    ids: string | readonly string[],
    states: ItemState | readonly ItemState[]
  ) {
    const { path } = this;
    const { rev } = this.#meta;

    const _ids = Array.isArray(ids) ? ids : [ids];
    const _states = (Array.isArray(states) ? states : [states]) as ItemState[];
    await Bluebird.map(_ids, async (id, i) => {
      const state = _states[i];
      try {
        switch (state) {
          case ItemState.New:
            {
              const { data: item } = (await this.#conn.get({
                path: join(path, id),
              })) as GetResponse<Resource>;
              await this.handleNewItem(list._rev + '', id, item);
            }
            break;
          case ItemState.Modified:
            {
              const { data: item } = await this.#conn.get({
                path: join(path, id),
              });
              const change: Change = {
                resource_id: pointer.get(list, id)._id,
                path: '',
                // TODO: what is the type the change??
                type: 'merge',
                body: item as {},
              };
              await this.handleItemChange(id, change);
            }
            break;
          case ItemState.Handled:
            info('Recording item %s as handled for %s', id, path);
            // Mark handled for all callbacks?
            await this.#meta.setHandled(id, {
              onAddItem: { rev },
              onItem: { rev },
            });
            break;
          default:
            assertNever(state);
        }
      } catch (err: unknown) {
        error(err, `Error processing item state "${state}" for item ${id}`);
      }
    });
  }

  /**
   * Do async stuff for initializing ourself since constructors are syncronous
   */
  private async initialize() {
    const { path, tree } = this;
    const conn = this.#conn;

    info('Ensuring %s exists', path);
    try {
      await conn.head({ path });
    } catch (err) {
      if (err.status === 403 || err.status === 404) {
        // Create it
        await conn.put({ path, tree, data: {} });
        trace('Created %s because it did not exist', path);
      } else {
        error(err);
        throw err;
      }
    }

    // TODO: Clean up control flow to not need this?
    const currentItemsNew = !(await this.#meta.init()) || !this.#resume;
    if (currentItemsNew) {
      trace('Treating current list items as new items');
      const { data: list } = (await conn.get({
        path,
        tree,
      })) as GetResponse<List>;
      //const items = Object.keys(list).filter((k) => !k.match(/^_/));
      const items = getListItems(list, this.itemsPath);

      // ask for states of pre-existing items
      trace('Calling onNewList');
      const states = await this.#onNewList(items);
      // Set the states
      trace('Updating item states based on callback result');
      await this.updateItemState(list, items, states);
    }

    // Setup watch on the path
    if (this.#resume) {
      trace('Resuming watch from rev %s', this.#meta.rev);
    }
    // Queue to handle changes in order
    const changeQueue = new PQueue({ concurrency: 1 });
    this.#id = await conn.watch({
      path,
      rev: this.#resume ? this.#meta.rev : undefined,
      type: 'tree',
      watchCallback: (changes) =>
        changeQueue.add(async () => {
          // Get root change?
          const rootChange = changes[0];

          // TODO: Better way than just looping through them all?
          await Bluebird.each(changes, async (change) => {
            const { type, path: changePath, body, ...ctx } = change;

            if (body === null && type === 'delete' && changePath === '') {
              // The list itself was deleted
              warn('Detected delete of list %s', path);

              await this.#onDeleteList();
              return;
            }

            const rev = (body as Change['body'])._rev as string;

            trace(change, 'Received change');

            let itemsFound = !!changePath;
            let listChange = body as DeepPartial<List>;
            try {
              // The actual change was to a descendant of the list
              if (changePath) {
                // To decide if this change was to the list or to an item,
                // need to check if itemsPath matches the changePath:
                // if it does, it is to an item.
                // If it doesn't, it's probably to the list.

                // Reconstruct change to list?
                const changeObj = {};
                let isListChange = false;
                if (this.itemsPath) {
                  // just put true here for now to check if path matches
                  pointer.set(changeObj, changePath, true);
                  const pathmatches = JSONPath({
                    resultType: 'pointer',
                    path: this.itemsPath,
                    json: changeObj,
                    preventEval: true,
                  });
                  if (pathmatches?.length === 0) {
                    // if it does not match, this must be above the items
                    isListChange = true;
                    trace(
                      'Have a write to the list under itemsPath rather than to any of the items'
                    );
                  }
                }

                // now put the actual change body in place of the true
                pointer.set(changeObj, changePath, body);
                // Find items involved in the change
                const itemsChanged = getListItems(changeObj, this.itemsPath);
                // The change was to items of the list (or their descendants)
                if (!isListChange && itemsChanged.length >= 1) {
                  return Bluebird.map(itemsChanged, (item) => {
                    const body = pointer.get(changeObj, item);
                    // Make change start at item instead of the list
                    const path = changePath.slice(item.length);
                    const change: Change = {
                      ...ctx,
                      type,
                      path,
                      body,
                    };
                    // Check that it is a resource change?
                    if (!body._rev) {
                      warn(
                        change,
                        'Ignoring unexpected (as in the body does not have a _rev) change'
                      );
                      return;
                    }
                    return this.handleItemChange(item, change);
                  });
                } else {
                  // The change is between the list and items
                  // (multiple link levels)
                  listChange = changeObj;
                }
              }
              trace(
                'Change was to the list itself because changePath is empty, calling handleListChange'
              );
              // The change was to the list itself
              itemsFound =
                (await this.handleListChange(listChange, type)) || itemsFound;
            } catch (err: unknown) {
              error(err, `Error processing change at ${path}, rev ${rev}`);
            }
          });

          if (this.#resume) {
            trace(
              'Received change to root of list, updating handled rev in our _meta records'
            );
            this.#meta.rev = (rootChange.body as Resource)?._rev + '';
          }
        }),
    });
  }
}

// Gross stuff to make TS handle optional second param for callback
type ItemStateNoItemCB = (id: string) => Promise<ItemState>;
function stateCBnoItem<Item>(
  cb: ItemStateNoItemCB | NonNullable<Options<Item>['getItemState']>
): cb is ItemStateNoItemCB {
  return cb.length < 2;
}
