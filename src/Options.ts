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

import type { OADAClient } from '@oada/client';
import type Tree from '@oada/types/oada/tree/v1.js';

import type {
  AssumeState,
  Change,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- for TSDoc
  ChangeType,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- for TSDoc
  ListWatch,
  TypeAssert,
} from './index.js';

/**
 * Type that can be either T or a Promise which resolves to T
 */
type AllowPromise<T> = T | PromiseLike<T>;

/**
 * The type for the object given to the constructor
 *
 * @public
 * @typeParam Item The type of the items linked in the list
 * @see ListWatch
 */
export interface Options<Item> {
  /**
   * Path to an OADA list to watch for items
   */
  path: string;
  /**
   * JSON Path to retrieve items from list.
   *
   * @default '$[?(!@property.match(/^_/))]'
   */
  itemsPath?: string;
  /**
   * Only needed when using `itemsPath` and `resume: false`
   * @todo remove need for this entirely
   */
  tree?: Tree;
  /**
   * A persistent name/id for this instance (can just be random string)
   *
   * It is used to prevent collisions in storage library metadata.
   */
  name?: string;
  /**
   * True: "resume" change feed for list from last processed rev
   * false: just start from current state of the list
   *
   * This disables storage of any state in `_meta`,
   * thus starting from the current state of the list each time.
   *
   * @default true
   */
  resume?: boolean;
  /**
   * An OADAClient instance (or something with the same API)
   */
  conn: Conn;
  /**
   * How frequently to save state to OADA (in ms)
   *
   * @default 1000
   */
  persistInterval?: number;
  /**
   * Function to assert if an object is an Item.
   * Items which fail this check will be ignored.
   *
   * @default assume all items are type Item
   */
  assertItem?: TypeAssert<Item>;
  /**
   * Called when the list in new to this lib (i.e., we have no _meta about it)
   */
  onNewList?: AssumeState;
  /**
   * Timeout for the watches created in OADAClient 
   */
  timeout?: number;

}

/**
 * @deprecated
 */
export interface OptionsDeprecated<Item> {
  /**
   * Called when a new item is added to the list
   *
   * @param item The resource for the new item
   * @param id The list key `item` is linked under (not the OADA `_id`)
   *
   * @deprecated Use {@link ListWatch.on} with {@link ChangeType.ItemAdded} instead
   */
  onAddItem?: (item: Item, id: string) => AllowPromise<void>;
  /**
   * Called when an existing item is modified in the list
   *
   * @param change The change to the item
   * @param id The list key the item is linked under (not the OADA `_id`)
   *
   * @deprecated Use {@link ListWatch.on} with {@link ChangeType.ItemChanged} instead
   */
  onChangeItem?: (change: Change, id: string) => AllowPromise<void>;
  /**
   * Called when an item is added or changed
   *
   * @param item The resource for the new item
   * @param id The list key `item` is linked under (not the OADA `_id`)
   *
   * @deprecated Use {@link ListWatch.on} with {@link ChangeType.ItemAny} instead
   */
  onItem?: (item: Item, id: string) => Promise<void>;
  /**
   * Called when an item is removed from the list
   *
   * @param id The list key the item was linked under (not the OADA `_id`)
   *
   * @deprecated Use {@link ListWatch.on} with {@link ChangeType.ItemRemoved} instead
   */
  onRemoveItem?: (id: string) => AllowPromise<void>;
}

/**
 * Accepts anything with same method signatures as OADAClient
 */
export type Conn = Pick<
  OADAClient,
  'get' | 'head' | 'put' | 'post' | 'delete' | 'watch' | 'unwatch'
>;
