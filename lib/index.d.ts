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
import type { Link } from '@oada/types/oada/link/v1';
import type { Resource } from '@oada/types/oada/resource';
import type V2Changes from '@oada/types/oada/change/v2';
import { ItemState, Options } from './Options';
export type { Tree } from './tree';
/**
 * Type for a single V2 OADA change (rather than the array)
 *
 * @todo fix the Change V2 types
 */
export declare type Change = V2Changes[0];
export declare type TypeAssert<T> = (value: unknown) => asserts value is T;
/**
 * Type for the lists we can watch
 */
export declare type List = Resource & {
    [key: string]: Link | List;
};
/**
 * The main class of this library.
 * Watches an OADA list and calls various callbacks when appropriate.
 *
 * @public
 * @typeParam Item  The type of the items linked in the list
 * @see Options
 */
export declare class ListWatch<Item = unknown> {
    #private;
    /**
     * Callback to make ListWatch consider every `Item` new
     *
     * @see getItemState
     * @see onNewList
     * @see ItemState.New
     */
    static readonly AssumeNew: {
        (id: readonly string[]): ItemState.New[];
        (id: string): ItemState.New;
    };
    /**
     * Callback to make ListWatch consider every `Item` handled
     *
     * @see getItemState
     * @see onNewList
     * @see ItemState.Handled
     */
    static readonly AssumeHandled: {
        (id: readonly string[]): ItemState.Handled[];
        (id: string): ItemState.Handled;
    };
    /**
     * The OADA path of the List being watched
     */
    readonly path: string;
    /**
     * The JSON Path for the list items
     */
    readonly itemsPath: string;
    /**
     * The OADA Tree for the List being watched
     * @see path
     */
    readonly tree?: Record<string, unknown> | undefined;
    /**
     * The unique name of this service/watch
     */
    readonly name: string;
    constructor({ path, itemsPath, tree, name, resume, conn, assertItem, onAddItem, onChangeItem, onItem, onRemoveItem, onNewList, onDeleteList, getItemState, }: Options<Item>);
    /**
     * Force library to recheck all current list items
     * @see getItemState
     * @param all check even items we think were handled
     *
     * @todo Better name?
     */
    forceRecheck(
    /**
     * @default false
     */
    all?: boolean): Promise<void>;
    /**
     * Clean up metadata and unwatch list
     */
    stop(): Promise<void>;
    /**
     * Persist relevant info to the `_meta` of the list.
     * This preserves it across restarts.
     */
    persistMeta(): Promise<void>;
}
export { Options, ItemState } from './Options';
