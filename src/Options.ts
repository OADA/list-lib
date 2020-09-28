import type { TypeAssert } from '@oada/types';
//import type { Change } from '@oada/types/oada/change/v2';
// TODO: Fix this
import type { Change } from './';

import type { OADAClient } from '@oada/client';

/**
 * Type that can be either T or a Promise which resovles to T
 */
type AllowPromise<T> = T | Promise<T>;

/**
 * The type for the object given to the construtor
 *
 * @public
 * @typeParam Item  The type of the items linked in the list
 * @see ListWatch
 */
export interface Options<Item> {
  /**
   * Path to an OADA list to watch for items
   */
  path: string;
  /**
   * OADA Tree for the path
   *
   * @see path
   */
  tree?: object;
  /**
   *, 'data'> A persistent name/id for this instance (can just be random string)
   *
   * It is used to prevent collisions in storage library metadata.
   */
  name: string;
  /**
   * true: "resume" change feed for list from last processed rev
   * false: just start from current state of the list
   *
   * @todo should default be true instead??
   * @default false
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
   * Called when a new item is added to the list
   *
   * @param item The resource for the new item
   * @param id The list key `item` is linked under (not the OADA `_id`)
   */
  onAddItem?: (item: Item, id: string) => AllowPromise<void>;
  /**
   * Called when an existing item is modified in the list
   *
   * @param change The change to the item
   * @param id The list key the item is linked under (not the OADA `_id`)
   */
  onChangeItem?: (change: Change, id: string) => AllowPromise<void>;
  /**
   * Called when an item is added or changed
   *
   * @param item The resource for the new item
   * @param id The list key `item` is linked under (not the OADA `_id`)
   */
  onItem?: (item: Item, id: string) => Promise<void>;
  /**
   * Called when an item is removed from the list
   *
   * @param id The list key the item was linked under (not the OADA `_id`)
   */
  onRemoveItem?: (id: string) => AllowPromise<void>;
  /**
   * Called when the list itself is deleted
   */
  onDeleteList?: () => AllowPromise<void>;
  /**
   * Called when the list in new to this lib (i.e., we have no _meta about it)
   *
   * @param ids The pre-existing items in the list
   * @example
   * // Assume all pre-existing items were previously handled
   * { onNewList: ListWatch.AssumeHandled, ...otherOptions }
   * @default invoke getItemState on each pre-existing item
   * @see getItemState
   * @see ListWatch.AssumeNew
   * @see ListWatch.AssumeHandled
   */
  onNewList?: (ids: readonly string[]) => AllowPromise<ItemState[]>;
  /**
   * Called when "handled" state of an item is unclear
   *
   * @param id The list key `item` is linked under (not the OADA `_id`)
   * @param item The resource for the item in question
   * @returns Promise which resolves to the current state of `item`
   * @default ListWatch.AssumeNew
   * @see ItemState
   * @see ListWatch.AssumeNew
   */
  getItemState?: (id: string, item: Item) => AllowPromise<ItemState>;
}

/**
 * Accepts anything with same method signatures as OADAClient
 */
export type Conn = Pick<
  OADAClient,
  'get' | 'head' | 'put' | 'post' | 'delete' | 'watch' | 'unwatch'
>;

/**
 * The possible states of an item in our list
 *
 * @public
 */
export enum ItemState {
  /**
   * The state of a completely new list item
   */
  New = 'new',
  /**
   * The state of an item we already know about
   * but has changes since we last handled it
   */
  Modified = 'modified',
  /**
   * The state of an old item with no unhandled changes
   */
  Handled = 'handled',
}
