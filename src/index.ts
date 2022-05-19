/**
 * @license
 * Copyright 2021 Open Ag Data Alliance
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { join } from 'node:path';

import { JSONPath } from 'jsonpath-plus';
import debug from 'debug';
import pointer from 'json-pointer';

import type { Change as ClientChange, ConnectionResponse } from '@oada/client';
import type { Link } from '@oada/types/oada/link/v1';
import type { Resource } from '@oada/types/oada/resource';
import type V2Changes from '@oada/types/oada/change/v2';

import { ItemState, Options } from './Options';
import { Metadata } from './Metadata';
import type { Tree } from './tree';

export type { Tree } from './tree';

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

export type TypeAssert<T> = (value: unknown) => asserts value is T;

/**
 * Tell TS we should never reach here (i.e., this should never be called)
 */
function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Bad value: ${value}`);
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
// eslint-disable-next-line @typescript-eslint/consistent-indexed-object-style
export type List = Resource & { [key: string]: Link | List };

function getListItems(list: DeepPartial<List>, path: string) {
  // eslint-disable-next-line new-cap
  return JSONPath<string[]>({
    resultType: 'pointer',
    path,
    json: list,
    preventEval: true,
  }).filter(
    // Don't follow underscore keys
    (p) => !p.includes('/_')
  );
}

/**
 * Generates an equivalent JSON Path from an OADA Tree object
 *
 * @internal
 * @experimental trees with multiple "paths" (excluding *)
 */
export function pathFromTree(tree: Tree, root = ''): string {
  let path = '$.*';
  let outPath = '$';

  const json = pointer.get(tree, root) as Tree;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Get set of non underscore keys
    const keys = Array.from(
      new Set(
        // eslint-disable-next-line new-cap
        JSONPath<string[]>({
          resultType: 'parentProperty',
          path,
          json,
        }).filter((k) => !k.startsWith('_'))
      )
    );
    if (keys.length === 0) {
      break;
    }

    // eslint-disable-next-line sonarjs/no-nested-template-literals
    outPath += `.${keys.length === 1 ? keys[0] : `[${keys.join(',')}]`}`;

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
   * Callback to make ListWatch consider every `Item` new
   *
   * @see getItemState
   * @see onNewList
   * @see ItemState.New
   */
  // eslint-disable-next-line @typescript-eslint/naming-convention
  public static readonly AssumeNew = assumeItemState(ItemState.New);
  /**
   * Callback to make ListWatch consider every `Item` handled
   *
   * @see getItemState
   * @see onNewList
   * @see ItemState.Handled
   */
  // eslint-disable-next-line @typescript-eslint/naming-convention
  public static readonly AssumeHandled = assumeItemState(ItemState.Handled);

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

  #resume;
  #conn;
  #watch;
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
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    assertItem = () => {},
    onAddItem,
    onChangeItem,
    onItem,
    onRemoveItem,
    onNewList,
    onDeleteList = async () => {
      // TODO: Actually handle the list being deleted (redo watch?)
      error('Unhandled delete of list %s', path);
      // eslint-disable-next-line no-process-exit, unicorn/no-process-exit
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
    } else if (tree) {
      // Assume items are at the leaves of tree
      this.itemsPath = pathFromTree(tree as Tree, path);
    } else {
      // Assume a flat list
      this.itemsPath = '$.*';
    }

    if (onNewList) {
      this.#onNewList = onNewList;
    } else {
      // If no callback provided, ask client for states of pre-existing items
      this.#onNewList = async (ids: readonly string[]) =>
        Promise.all(
          ids.map(async (id) => {
            try {
              return await this.#handleItemState(id);
            } catch (cError: unknown) {
              error(cError, 'Error getting item state');
              throw cError;
            }
          })
        );
    }

    this.#meta = new Metadata({
      // Don't persist metdata if service does not "resume"
      // persistInterval: this.#resume ? persistInterval : 0,
      conn: this.#resume ? this.#conn : undefined,
      path,
      tree,
      name,
    });
    this.#watch = this.#initialize();
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
    const { path, itemsPath } = this;
    const conn = this.#conn;

    const { data: list } = (await conn.get({ path })) as GetResponse<List>;
    if (Buffer.isBuffer(list)) {
      throw new TypeError('List is not a JSON object');
    }

    // Const items = Object.keys(list).filter((k) => !k.match(/^_/));
    const items = getListItems(list as DeepPartial<List>, itemsPath);

    // Const { rev } = this.#meta;
    await Promise.all(
      items.map(async (id) => {
        try {
          if (!all && (await this.#meta.handled(id))) {
            // We think this item is handled
            return;
          }

          // Ask lib user for state of this item
          const state = await this.#handleItemState(id);

          await this.#updateItemState(list, id, state);
        } catch (cError: unknown) {
          error(cError);
        }
      })
    );
  }

  /**
   * Clean up metadata and unwatch list
   */
  public async stop() {
    const watch = await this.#watch;
    if (watch.return) {
      await watch.return();
    }

    await this.persistMeta();
    // This.#meta.stop();
  }

  /**
   * Persist relevant info to the `_meta` of the list.
   * This preserves it across restarts.
   */
  public async persistMeta() {
    // Await this.#meta.persist();
  }

  /**
   * Ask lib user for state of this item
   *
   * This handles fetching the Item before invoking the callback if needed
   */
  async #handleItemState(id: string): Promise<ItemState> {
    // Needed because TS is weird about asserts...
    const assertItem: TypeAssert<Item> = this.#assertItem;

    if (!stateCBnoItem(this.#getItemState)) {
      const { data: item } = await this.#conn.get({
        path: join(this.path, id),
      });
      assertItem(item);
      return this.#getItemState(id, item);
    }

    return this.#getItemState(id);
  }

  async #handleNewItem(rev: string, id: string, item: Resource) {
    const { path } = this;
    // Needed because TS is weird about asserts...
    const assertItem: TypeAssert<Item> = this.#assertItem;

    info(`${this.#resume ? 'Detected new' : 'Handing existing'} item %s in %s, rev %s`, id, path, rev);
    const { _rev } = item;
    assertItem(item);

    const handled = await this.#meta.handled(id);
    try {
      // Double check this is a new item?
      if (!handled?.onAddItem) {
        await (this.#onAddItem && this.#onAddItem(item, id));
        await this.#meta.setHandled(id, { onAddItem: { rev: `${_rev}` } });
      }
    } finally {
      // Call this even if previous callback errored

      // TODO: Do I need to make a fake "change" to the item
      // or will the feed have one??

      // Double check this item is actually newer than last time
      if (Number(_rev) > Number(handled?.onItem?.rev ?? 0)) {
        await (this.#onItem && this.#onItem(item, id));
        await this.#meta.setHandled(id, { onItem: { rev: `${_rev}` } });
      }
    }
  }

  async #handleItemChange(id: string, change: Change) {
    const { path } = this;
    const conn = this.#conn;
    const rev = change.body?._rev;

    // TODO: How best to handle change to a descendant of an item?
    info('Detected change to item %s in %s, rev %s', id, path, rev);

    try {
      await (this.#onChangeItem && this.#onChangeItem(change, id));
      await this.#meta.setHandled(id, { onChangeItem: { rev: `${rev}` } });
    } finally {
      if (this.#onItem) {
        // Needed because TS is weird about asserts...
        const assertItem: TypeAssert<Item> = this.#assertItem;

        const { data: item } = await conn.get({
          path: join(path, id),
        });
        assertItem(item);
        await this.#onItem(item, id);
        await this.#meta.setHandled(id, { onItem: { rev: `${rev}` } });
      }
    }
  }

  async #handleListChange(
    list: DeepPartial<List>,
    type: Change['type']
  ): Promise<boolean> {
    const { path, itemsPath } = this;
    const conn = this.#conn;
    const rev = list._rev;
    // Ignore _ keys of OADA
    // const items = Object.keys(list).filter((k) => !k.match(/^_/));
    const items = getListItems(list, itemsPath);
    trace(items, 'handleListChange');

    switch (type) {
      case 'merge':
        await Promise.all(
          items.map(async (id) => {
            try {
              trace('handleListChange: Processing item %s', id);
              const ichang = pointer.get(list, id) as Partial<Link>;
              trace(ichang, 'handleListChange');

              // If there is an _id this is a new link in the list right?
              if (ichang._id) {
                trace(
                  'handleListChange: change has an _id, getting it and handing to handleNewItem'
                );
                const { data: item } = (await conn.get({
                  path: `/${ichang._id}`
                })) as GetResponse<Resource>;
                await this.#handleNewItem(`${rev}`, id, item);
              } else {
                // TODO: What should we do now??
                trace(
                  'Ignoring non-link key added to list %s, rev %s',
                  path,
                  rev
                );
              }
            } catch (cError: unknown) {
              // Log error with this item but continue map over other items
              error(
                cError,
                `Error processing change for ${id} at ${path}, rev ${rev}`
              );
            }
          })
        );
        break;

      case 'delete':
        await Promise.all(
          items.map(async (id) => {
            try {
              const lChange = pointer.get(list, id) as Partial<Link>;

              if (lChange === null) {
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
                  await this.#meta.setHandled(id);
                }
              } else {
                // TODO: What does this mean??
                trace(
                  'Ignoring non-link key added to list %s, rev %s',
                  path,
                  rev
                );
              }
            } catch (cError: unknown) {
              // Log error with this item but continue map over other items
              error(
                cError,
                `Error processing change for ${id} at ${path}, rev ${rev}`
              );
            }
          })
        );
        break;

      default:
        throw new TypeError(`Unknown change type ${type}`);
    }

    return items.length > 0;
  }

  /**
   * Update the states of list items
   *
   * @see ItemState
   */
  async #updateItemState(
    list: List,
    ids: string | readonly string[],
    states: ItemState | readonly ItemState[]
  ) {
    const { path } = this;
    const { rev } = this.#meta;

    const idArray = Array.isArray(ids) ? ids : [ids];
    const stateArray = (
      Array.isArray(states) ? states : [states]
    ) as readonly ItemState[];
    await Promise.all(
      idArray.map(async (id, index) => {
        const state = stateArray[Number(index)]!;
        try {
          switch (state) {
            case ItemState.New:
              {
                const { data: item } = (await this.#conn.get({
                  path: join(path, id),
                })) as GetResponse<Resource>;
                await this.#handleNewItem(`${list._rev}`, id, item);
              }

              break;
            case ItemState.Modified:
              {
                const { data: item } = await this.#conn.get({
                  path: join(path, id),
                });
                const change: Change = {
                  resource_id: pointer.get(list, id)._id as string,
                  path: '',
                  type: 'merge',
                  body: item as Resource,
                };
                await this.#handleItemChange(id, change);
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
        } catch (cError: unknown) {
          error(
            cError,
            `Error processing item state "${state}" for item ${id}`
          );
        }
      })
    );
  }

  /**
   * Do async stuff for initializing ourself since constructors are synchronous
   */
  async #initialize() {
    const { path, tree, itemsPath } = this;
    const conn = this.#conn;

    info('Ensuring %s exists', path);
    try {
      await conn.head({ path });
    } catch (cError: unknown) {
      // @ts-expect-error darn errors
      if (cError?.status === 403 || cError?.status === 404) {
        // Create it
        await conn.put({ path, tree, data: {} });
        trace('Created %s because it did not exist', path);
      } else {
        error(cError);
        throw cError;
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
      // Const items = Object.keys(list).filter((k) => !k.match(/^_/));
      const items = getListItems(list as DeepPartial<List>, itemsPath);

      // Ask for states of pre-existing items
      trace('Calling onNewList');
      const states = await this.#onNewList(items);
      // Set the states
      trace('Updating item states based on callback result');
      await this.#updateItemState(list, items, states);
    }

    // Setup watch on the path
    if (this.#resume) {
      trace('Resuming watch from rev %s', this.#meta.rev);
    }

    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const { changes } = await conn.watch({
      path,
      rev: this.#resume ? this.#meta.rev : undefined,
      type: 'tree',
    });
   
    void this.#handleChangeFeed(changes);
    return changes;
  }

  async #handleChangeFeed(
    watch: AsyncIterable<ReadonlyArray<Readonly<ClientChange>>>
  ): Promise<never> {
    const { path, itemsPath } = this;

    for await (const changes of watch) {
      // Get root change?
      const rootChange = changes[0];

      // TODO: Better way than just looping through them all?
      for (const change of changes) {
        const { type, path: changePath, body, ...context } = change;

        if (body === null && type === 'delete' && changePath === '') {
          // The list itself was deleted
          warn('Detected delete of list %s', path);

          // eslint-disable-next-line no-await-in-loop
          await this.#onDeleteList();
          continue;
        }

        const rev = (body as Change['body'])?._rev;

        trace(change, 'Received change');

        let listChange = body as DeepPartial<List>;
        try {
          // The actual change was to a descendant of the list
          if (changePath) {
            // To decide if this change was to the list or to an item,
            // need to check if itemsPath matches the changePath:
            // if it does, it is to an item.
            // If it doesn't, it's probably to the list.

            // Reconstruct change to list?
            const changeObject = {};
            let isListChange = false;
            if (itemsPath) {
              // Just put true here for now to check if path matches
              pointer.set(changeObject, changePath, true);
              // eslint-disable-next-line new-cap
              const pathmatches = JSONPath<string[]>({
                resultType: 'pointer',
                path: itemsPath,
                json: changeObject,
                preventEval: true,
              });
              if (pathmatches?.length === 0) {
                // If it does not match, this must be above the items
                isListChange = true;
                trace(
                  'Have a write to the list under itemsPath rather than to any of the items'
                );
              }
            }

            // Now put the actual change body in place of the true
            pointer.set(changeObject, changePath, body);
            // Find items involved in the change
            const itemsChanged = getListItems(changeObject, itemsPath);
            // The change was to items of the list (or their descendants)
            if (!isListChange && itemsChanged.length > 0) {
              // eslint-disable-next-line no-await-in-loop
              await Promise.all(
                itemsChanged.map((item) => {
                  const itemBody: unknown = pointer.get(changeObject, item);
                  // Make change start at item instead of the list
                  const itemPath = changePath.slice(item.length);
                  const itemChange: Change = {
                    ...context,
                    type,
                    path: itemPath,
                    body: itemBody as Resource,
                  };
                  // Check that it is a resource change?
                  if (
                    !(
                      typeof itemBody === 'object' &&
                      itemBody &&
                      '_rev' in itemBody
                    )
                  ) {
                    warn(
                      itemChange,
                      'Ignoring unexpected (as in the body does not have a _rev) change'
                    );
                    return;
                  }

                  return this.#handleItemChange(item, itemChange);
                })
              );
              continue;
            }

            // The change is between the list and items
            // (multiple link levels)
            listChange = changeObject;
          }

          trace(
            'Change was to the list itself because changePath is empty, calling handleListChange'
          );
          // eslint-disable-next-line no-await-in-loop
          await this.#handleListChange(listChange, type);
        } catch (cError: unknown) {
          error(cError, `Error processing change at ${path}, rev ${rev}`);
        }
      }

      if (this.#resume) {
        trace(
          'Received change to root of list, updating handled rev in our _meta records'
        );
        this.#meta.rev = `${(rootChange?.body as Resource)?._rev}`;
      }
    }

    error('Change feed ended unexpectedly');
    return undefined as never;
  }
}

// Gross stuff to make TS handle optional second param for callback
type ItemStateNoItemCB = (id: string) => Promise<ItemState>;
function stateCBnoItem<Item>(
  callback: ItemStateNoItemCB | NonNullable<Options<Item>['getItemState']>
): callback is ItemStateNoItemCB {
  return callback.length < 2;
}

export { Options, ItemState } from './Options';
