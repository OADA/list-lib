/**
 * @license
 * Copyright 2021-2022 Open Ag Data Alliance
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

import type { EventEmitter as NodeEventEmitter } from 'node:events';
import { on } from 'node:events';

import { EventEmitter } from 'eventemitter3';
import { JSONPath } from 'jsonpath-plus';
import debug from 'debug';

import type { Change } from '@oada/client';
import type Resource from '@oada/types/oada/resource.js';

import {
  AssumeState,
  ChangeType,
  type EventTypes,
  type ItemEvent,
  type ItemType,
  type TypeAssert,
} from './index.js';
import {
  type ChangeBody,
  type Result,
  assertNever,
  buildChangeObject,
  changeSym,
  join,
} from './util.js';
import type { Options, OptionsDeprecated } from './Options.js';
import { Metadata } from './Metadata.js';

const log = {
  trace: debug('@oada/list-lib:trace'),
  debug: debug('@oada/list-lib:debug'),
  info: debug('@oada/list-lib:info'),
  warn: debug('@oada/list-lib:warn'),
  error: debug('@oada/list-lib:error'),
  fatal: debug('@oada/list-lib:fatal'),
};

/**
 * The main class of this library.
 * Watches an OADA list and calls various callbacks when appropriate.
 *
 * @public
 * @typeParam Item The type of the items linked in the list
 * @see Options
 */
export class ListWatch<Item = unknown> {
  /**
   * Make ListWatch consider every unknown `Item` new
   * @deprecated
   */
  static readonly AssumeNew = AssumeState.New;
  /**
   * Make ListWatch consider every unknown `Item` handled
   * @deprecated
   */
  static readonly AssumeHandled = AssumeState.Handled;

  /**
   * The OADA path of the List being watched
   */
  readonly path;
  /**
   * The OADA tree of the List being watched
   */
  readonly tree;
  /**
   * The JSON Path for the list items
   */
  readonly itemsPath;
  /**
   * The unique name of this service/watch
   */
  readonly name;

  #conn;
  #watch;
  #meta;
  #emitter;
  #assertItem;

  constructor(options: Options<Item>);
  /**
   * @deprecated
   * see {@link Options} for the non-deprecated options
   * and {@link OptionsDeprecated} for alternatives to deprecated options
   */
  // eslint-disable-next-line @typescript-eslint/unified-signatures
  constructor(options: Options<Item> & OptionsDeprecated<Item>);
  constructor({
    path,
    itemsPath = '$[?(!@property.match(/^_/))]',
    tree = { '*': { _type: 'application/json' } },
    name = process.env.npm_package_name!,
    resume = true,
    conn,
    persistInterval = 1000,
    // If no assert given, assume all items valid
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    assertItem = () => {},
    onAddItem,
    onChangeItem,
    onItem,
    onRemoveItem,
    onNewList,
  }: Options<Item> & OptionsDeprecated<Item>) {
    this.path = path;
    this.tree = tree;
    this.itemsPath = itemsPath;
    this.name = name;
    this.#conn = conn;
    this.#assertItem = assertItem;
    this.#emitter = new EventEmitter<EventTypes<Item>, this>();

    if (onAddItem) {
      log.warn('onAddItem is deprecated, use .on(ChangeType.ItemAdded, ...)');
      this.#emitter.on(
        ChangeType.ItemAdded,
        this.#wrapListener(ChangeType.ItemAdded, async ({ item, pointer }) =>
          onAddItem(await item, pointer)
        )
      );
    }

    if (onChangeItem) {
      log.warn(
        'onChangeItem is deprecated, use .on(ChangeType.ItemChanged, ...)'
      );
      this.#emitter.on(
        ChangeType.ItemChanged,
        this.#wrapListener(
          ChangeType.ItemChanged,
          async ({ change, pointer }) => onChangeItem(change, pointer)
        )
      );
    }

    if (onItem) {
      log.warn('onItem is deprecated, use .on(ChangeType.ItemAny, ...)');
      this.#emitter.on(
        ChangeType.ItemAny,
        this.#wrapListener(ChangeType.ItemAny, async ({ item, pointer }) =>
          onItem(await item, pointer)
        )
      );
    }

    if (onRemoveItem) {
      log.warn(
        'onRemoveItem is deprecated, use .on(ChangeType.ItemRemoved, ...)'
      );
      this.#emitter.on(
        ChangeType.ItemRemoved,
        this.#wrapListener(ChangeType.ItemRemoved, async ({ pointer }) =>
          onRemoveItem(pointer)
        )
      );
    }

    // Don't persist metdata if service does not "resume"
    this.#meta = resume
      ? new Metadata({
          conn: this.#conn,
          path,
          name,
          persistInterval,
        })
      : undefined;
    this.#watch = this.#initialize(onNewList);
  }

  /**
   * Clean up metadata and unwatch list
   */
  async stop() {
    try {
      const watch = await this.#watch;
      await watch.return?.();
    } finally {
      await this.#meta?.stop();
    }
  }

  on<E extends ChangeType>(event: E): AsyncGenerator<[ItemType<E, Item>]>;
  on<E extends ChangeType>(
    event: E,
    listener: (itemChange: ItemType<E, Item>) => void | PromiseLike<void>
  ): this;
  on<E extends ChangeType>(
    event: E,
    listener?: (itemChange: ItemType<E, Item>) => void | PromiseLike<void>
  ) {
    if (listener) {
      this.#emitter.on(event, this.#wrapListener(event, listener));
      return this;
    }

    return this.#generate(event);
  }

  once<E extends ChangeType>(event: E): Promise<[ItemType<E, Item>]>;
  once<E extends ChangeType>(
    event: E,
    listener: (itemChange: ItemEvent<Item>) => void | PromiseLike<void>
  ): this;
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  once<E extends ChangeType>(
    event: E,
    listener?: (itemChange: ItemEvent<Item>) => void | PromiseLike<void>
  ) {
    if (listener) {
      this.#emitter.once(event, this.#wrapListener(event, listener));
      return this;
    }

    return this.#once(event);
  }

  /**
   * Fetch the contents of the corresponding list item
   */
  async #getItem(itemEvent: ItemEvent<Item>): Promise<Item> {
    // Needed because TS is weird about asserts...
    const assertItem: TypeAssert<Item> = this.#assertItem;
    const { data: item } = await this.#conn.get({
      path: join(this.path, itemEvent.pointer),
    });
    assertItem(item);
    return item;
  }

  /**
   * Emit our internal events
   */
  async #emit<E extends ChangeType>(
    event: E,
    itemEvent: Omit<ItemEvent<Item>, 'item'>
  ) {
    // Automagically get the list item when it is accessed
    const getItem = this.#getItem.bind(this);
    let itemP: Promise<Item>;
    const out = {
      get item() {
        if (itemP === undefined) {
          itemP = getItem(this);
        }

        return itemP;
      },
      ...itemEvent,
    };
    switch (event) {
      case ChangeType.ItemChanged: {
        log.debug({ itemChange: itemEvent }, 'Detected change to item');
        this.#emitter.emit(
          ChangeType.ItemChanged,
          out as ItemType<ChangeType.ItemChanged, Item>
        );
        this.#emitter.emit(ChangeType.ItemAny, out);

        break;
      }

      case ChangeType.ItemAdded: {
        log.debug({ itemChange: itemEvent }, 'Detected new item');
        this.#emitter.emit(ChangeType.ItemAdded, out);
        this.#emitter.emit(ChangeType.ItemAny, out);

        break;
      }

      case ChangeType.ItemRemoved: {
        log.debug({ itemChange: itemEvent }, 'Detected removed item');
        this.#emitter.emit(ChangeType.ItemRemoved, out);
        break;
      }

      case ChangeType.ItemAny: {
        throw new TypeError('ItemAny is not a valid event');
      }

      default: {
        assertNever(event, `Unknown event type ${event}`);
      }
    }
  }

  async #once<E extends ChangeType>(event: E) {
    const generator = this.#generate(event);
    try {
      const { value } = await generator.next();
      return [value] as [ItemType<E, Item>];
    } finally {
      await generator.return();
    }
  }

  #wrapListener<E extends ItemEvent<Item>>(
    type: string,
    listener: (itemChange: E) => void | PromiseLike<void>
  ) {
    return async (itemChange: E) => {
      try {
        await listener(itemChange);
      } catch (error: unknown) {
        log.error(
          { type, listener: listener.name, error },
          'Error in listener'
        );
        await this.#meta?.setErrored(
          itemChange.pointer,
          itemChange.listRev,
          error
        );
      } finally {
        if (this.#meta) {
          // Update our place in the change feed?
          this.#meta.rev = itemChange.listRev;
        }
      }
    };
  }

  async *#generate<E extends ChangeType>(type: E) {
    const events: AsyncIterable<[ItemType<E, Item>]> = on(
      this.#emitter as unknown as NodeEventEmitter,
      type
    );
    for await (const [event] of events) {
      try {
        // Generate event
        yield event;
      } catch (error: unknown) {
        log.error({ type, error }, 'Error in generator');
        await this.#meta?.setErrored(event.pointer, event.listRev, error);
      } finally {
        if (this.#meta) {
          // Update our place in the change feed?
          this.#meta.rev = event.listRev;
        }
      }
    }
  }

  /**
   * Do async stuff for initializing ourself since constructors are synchronous
   */
  async #initialize(assume: AssumeState = AssumeState.New) {
    const { path } = this;
    const conn = this.#conn;

    log.debug('Ensuring %s exists', path);
    try {
      await conn.head({ path });
    } catch (error: unknown) {
      // @ts-expect-error darn errors
      if (error?.status === 403 || error?.status === 404) {
        // Create it
        await conn.put({ path, data: {} });
        log.trace('Created %s because it did not exist', path);
      } else {
        log.error({ error });
        throw error;
      }
    }

    const foundMeta = await this.#meta?.init();
    log.debug('Resuming watch from rev %s', this.#meta?.rev);

    // Setup watch on the path
    const { changes } = await conn.watch({
      path,
      rev: this.#meta?.rev,
      type: 'tree',
    });

    if (!foundMeta) {
      switch (assume) {
        case AssumeState.Handled: {
          break;
        }

        case AssumeState.New: {
          await this.#handleStartingItems();
          break;
        }

        default: {
          assertNever(assume);
        }
      }
    }

    // eslint-disable-next-line github/no-then
    void this.#handleChangeFeed(changes).catch((error: unknown) =>
      // Forward rejections to EventEmitter
      this.#emitter.emit('error', error)
    );

    log.info({ this: this }, 'ListWatch initialized');
    return changes;
  }

  /**
   * Treat all starting list items as new
   *
   * @todo Remove need for tree GET
   */
  async #handleStartingItems() {
    const { path, tree, itemsPath } = this;
    const { data: json } = await this.#conn.get({ path, tree });
    if (
      typeof json !== 'object' ||
      json === null ||
      Array.isArray(json) ||
      Buffer.isBuffer(json)
    ) {
      throw new TypeError('Expected JSON');
    }

    // eslint-disable-next-line new-cap
    const items = JSONPath<Array<Result<ChangeBody<Item>>>>({
      resultType: 'all',
      path: itemsPath,
      json,
    });
    const listRev = Number(json._rev);
    for await (const { value, pointer } of items) {
      const itemChange = {
        item: value,
        listRev,
        pointer,
      };
      await this.#emit(ChangeType.ItemAdded, itemChange);
    }
  }

  /**
   * Iterate though chid changes to list items
   */
  async #handleItemChanges(changeBody: ChangeBody<unknown>, listRev: number) {
    // eslint-disable-next-line new-cap
    const items = JSONPath<Array<Result<ChangeBody<Item>>>>({
      resultType: 'all',
      path: this.itemsPath,
      json: changeBody,
    });
    for await (const { value, pointer } of items) {
      if (value === undefined) {
        // Item was removed from list
        const itemChange = {
          listRev,
          pointer,
        };
        await this.#emit(ChangeType.ItemRemoved, itemChange);
        continue;
      }

      const { [changeSym]: changes } = value;
      if (!changes && typeof value === 'object' && '_id' in value) {
        // Item was added to list?
        const itemChange = {
          listRev,
          pointer,
        };
        await this.#emit(ChangeType.ItemAdded, itemChange);
        continue;
      }

      for await (const change of changes ?? []) {
        log.trace({ change }, 'Received change');
        const rev = Number(
          // @ts-expect-error just do it
          change.body?._meta?._rev ?? change.body?._rev
        );

        // ???: Find any children of change
        // const changes = [change];
        const itemChange = {
          rev,
          listRev,
          pointer,
          change: {
            ...change,
            // Adust change path to start at this item
            path: change.path.slice(pointer.length),
          },
        };

        // Emit generic item change event
        await this.#emit(ChangeType.ItemChanged, itemChange);
      }
    }
  }

  async #handleChangeFeed(
    watch: AsyncIterable<ReadonlyArray<Readonly<Change>>>
  ): Promise<never> {
    // Iterate through list change feed
    for await (const [rootChange, ...children] of watch) {
      const listRev = Number(
        // @ts-expect-error just do it
        rootChange!.body?._meta?._rev ?? rootChange!.body?._rev
      );
      if (
        rootChange!.body === null &&
        rootChange!.type === 'delete' &&
        rootChange!.path === ''
      ) {
        // The list itself was deleted
        log.warn(
          'Detected delete of list %s, nothing left to watch',
          rootChange!.path
        );
        break;
      }

      const changeBody = buildChangeObject(rootChange!, ...children);
      await this.#handleItemChanges(changeBody, listRev);

      if (this.#meta) {
        log.trace(
          'Received change to root of list, updating handled rev in our _meta records'
        );
        this.#meta.rev = (rootChange!.body as Resource)?._rev;
      }
    }

    log.fatal('Change feed ended unexpectedly');
    throw new Error('Change feed ended');
  }
}
