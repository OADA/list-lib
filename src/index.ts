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

import type { Link } from '@oada/types/oada/link/v1.js';
import type Resource from '@oada/types/oada/resource.js';
import type V2Changes from '@oada/types/oada/change/v2.js';

/**
 * Type for a single V2 OADA change (rather than the array)
 *
 * @todo fix the Change V2 types
 */
export type Change = V2Changes[0];

export type TypeAssert<T> = (value: unknown) => asserts value is T;

/**
 * Type for the lists we can watch
 */
export type List = Resource & { [key: string]: Link | List };

export interface ItemEvent<Item = never> {
  listRev: number;
  pointer: string;
  readonly item: Promise<Item>;
}
export interface ItemChange<Item> extends ItemEvent<Item> {
  rev: number;
  change: Change;
}

/**
 * Type of changes to detect in a list
 */
export const enum ChangeType {
  /**
   * Event for when an existing item is changed
   */
  ItemChanged = 'itemChange',
  /**
   * Event for when a new item is added
   */
  ItemAdded = 'addedItem',
  /**
   * Event for when an item is removed from the list
   */
  ItemRemoved = 'removedItem',
  // ItemUnknown = 'unknownItem',
  ItemAny = 'anyItem',
}

export interface EventTypes<Item> {
  [ChangeType.ItemChanged]: [ItemChange<Item>];
  [ChangeType.ItemAdded]: [ItemEvent<Item>];
  [ChangeType.ItemRemoved]: [ItemEvent<Item>];
  [ChangeType.ItemAny]: [ItemEvent<Item> | ItemChange<Item>];
  error: unknown[];
}

export type ItemType<E extends ChangeType, Item> = EventTypes<Item>[E][0];

export const enum AssumeState {
  New,
  Handled,
}

export { ListWatch } from './ListWatch.js';

export type { Options } from './Options.js';
