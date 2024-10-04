"use strict";
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
var _ListWatch_instances, _ListWatch_resume, _ListWatch_conn, _ListWatch_watch, _ListWatch_assertItem, _ListWatch_meta, _ListWatch_onAddItem, _ListWatch_onChangeItem, _ListWatch_onItem, _ListWatch_onRemoveItem, _ListWatch_onNewList, _ListWatch_onDeleteList, _ListWatch_getItemState, _ListWatch_handleItemState, _ListWatch_handleNewItem, _ListWatch_handleItemChange, _ListWatch_handleListChange, _ListWatch_updateItemState, _ListWatch_initialize, _ListWatch_handleChangeFeed;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ItemState = exports.ListWatch = exports.pathFromTree = void 0;
const tslib_1 = require("tslib");
const node_path_1 = require("node:path");
const jsonpath_plus_1 = require("jsonpath-plus");
const debug_1 = (0, tslib_1.__importDefault)(require("debug"));
const json_pointer_1 = (0, tslib_1.__importDefault)(require("json-pointer"));
const Options_1 = require("./Options");
const Metadata_1 = require("./Metadata");
const info = (0, debug_1.default)('oada-list-lib:info');
const warn = (0, debug_1.default)('oada-list-lib:warn');
const trace = (0, debug_1.default)('oada-list-lib:trace');
const error = (0, debug_1.default)('oada-list-lib:error');
/**
 * Tell TS we should never reach here (i.e., this should never be called)
 */
function assertNever(value, message) {
    throw new Error(message !== null && message !== void 0 ? message : `Bad value: ${value}`);
}
/**
 * Create a callback which assumes item(s) have the given state.
 * @param state The ItemsState to assume
 */
function assumeItemState(state) {
    function assume(id) {
        warn('Assuming state %s for item(s) %s', state, id);
        if (Array.isArray(id)) {
            const ids = id;
            return ids.map(() => state);
        }
        return state;
    }
    return assume;
}
function getListItems(list, path) {
    // eslint-disable-next-line new-cap
    return (0, jsonpath_plus_1.JSONPath)({
        resultType: 'pointer',
        path,
        json: list,
        preventEval: true,
    }).filter(
    // Don't follow underscore keys
    (p) => !p.includes('/_'));
}
/**
 * Generates an equivalent JSON Path from an OADA Tree object
 *
 * @internal
 * @experimental trees with multiple "paths" (excluding *)
 */
function pathFromTree(tree, root = '') {
    let path = '$.*';
    let outPath = '$';
    const json = json_pointer_1.default.get(tree, root);
    // eslint-disable-next-line no-constant-condition
    while (true) {
        // Get set of non underscore keys
        const keys = Array.from(new Set(
        // eslint-disable-next-line new-cap
        (0, jsonpath_plus_1.JSONPath)({
            resultType: 'parentProperty',
            path,
            json,
        }).filter((k) => !k.startsWith('_'))));
        if (keys.length === 0) {
            break;
        }
        // eslint-disable-next-line sonarjs/no-nested-template-literals
        outPath += `.${keys.length === 1 ? keys[0] : `[${keys.join(',')}]`}`;
        path += '.*';
    }
    return outPath;
}
exports.pathFromTree = pathFromTree;
/**
 * The main class of this library.
 * Watches an OADA list and calls various callbacks when appropriate.
 *
 * @public
 * @typeParam Item  The type of the items linked in the list
 * @see Options
 */
class ListWatch {
    constructor({ path, itemsPath, tree, name, resume = false, conn, 
    // If no assert given, assume all items valid
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    assertItem = () => { }, onAddItem, onChangeItem, onItem, onRemoveItem, onNewList, onDeleteList = async () => {
        // TODO: Actually handle the list being deleted (redo watch?)
        error('Unhandled delete of list %s', path);
        // eslint-disable-next-line no-process-exit, unicorn/no-process-exit
        process.exit();
    }, 
    // If no callback given, assume everything unknown is new
    getItemState = ListWatch.AssumeNew, }) {
        _ListWatch_instances.add(this);
        _ListWatch_resume.set(this, void 0);
        _ListWatch_conn.set(this, void 0);
        _ListWatch_watch.set(this, void 0);
        _ListWatch_assertItem.set(this, void 0);
        // _meta stuff
        _ListWatch_meta.set(this, void 0);
        // Callbacks
        _ListWatch_onAddItem.set(this, void 0);
        _ListWatch_onChangeItem.set(this, void 0);
        _ListWatch_onItem.set(this, void 0);
        _ListWatch_onRemoveItem.set(this, void 0);
        _ListWatch_onNewList.set(this, void 0);
        _ListWatch_onDeleteList.set(this, void 0);
        _ListWatch_getItemState.set(this, void 0);
        this.path = path;
        this.tree = tree;
        this.name = name;
        (0, tslib_1.__classPrivateFieldSet)(this, _ListWatch_resume, resume, "f");
        (0, tslib_1.__classPrivateFieldSet)(this, _ListWatch_conn, conn, "f");
        (0, tslib_1.__classPrivateFieldSet)(this, _ListWatch_assertItem, assertItem, "f");
        (0, tslib_1.__classPrivateFieldSet)(this, _ListWatch_onAddItem, onAddItem, "f");
        (0, tslib_1.__classPrivateFieldSet)(this, _ListWatch_onChangeItem, onChangeItem, "f");
        (0, tslib_1.__classPrivateFieldSet)(this, _ListWatch_onItem, onItem, "f");
        (0, tslib_1.__classPrivateFieldSet)(this, _ListWatch_onRemoveItem, onRemoveItem, "f");
        (0, tslib_1.__classPrivateFieldSet)(this, _ListWatch_onDeleteList, onDeleteList, "f");
        (0, tslib_1.__classPrivateFieldSet)(this, _ListWatch_getItemState, getItemState, "f");
        if (itemsPath) {
            this.itemsPath = itemsPath;
        }
        else if (tree) {
            // Assume items are at the leaves of tree
            this.itemsPath = pathFromTree(tree, path);
        }
        else {
            // Assume a flat list
            this.itemsPath = '$.*';
        }
        if (onNewList) {
            (0, tslib_1.__classPrivateFieldSet)(this, _ListWatch_onNewList, onNewList, "f");
        }
        else {
            // If no callback provided, ask client for states of pre-existing items
            (0, tslib_1.__classPrivateFieldSet)(this, _ListWatch_onNewList, async (ids) => Promise.all(ids.map(async (id) => {
                try {
                    return await (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_instances, "m", _ListWatch_handleItemState).call(this, id);
                }
                catch (cError) {
                    error(cError, 'Error getting item state');
                    throw cError;
                }
            })), "f");
        }
        (0, tslib_1.__classPrivateFieldSet)(this, _ListWatch_meta, new Metadata_1.Metadata({
            // Don't persist metdata if service does not "resume"
            // persistInterval: this.#resume ? persistInterval : 0,
            conn: (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_resume, "f") ? (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_conn, "f") : undefined,
            path,
            tree,
            name,
        }), "f");
        (0, tslib_1.__classPrivateFieldSet)(this, _ListWatch_watch, (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_instances, "m", _ListWatch_initialize).call(this), "f");
    }
    /**
     * Force library to recheck all current list items
     * @see getItemState
     * @param all check even items we think were handled
     *
     * @todo Better name?
     */
    async forceRecheck(
    /**
     * @default false
     */
    all = false) {
        const { path, itemsPath } = this;
        const conn = (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_conn, "f");
        const { data: list } = (await conn.get({ path }));
        if (Buffer.isBuffer(list)) {
            throw new TypeError('List is not a JSON object');
        }
        // Const items = Object.keys(list).filter((k) => !k.match(/^_/));
        const items = getListItems(list, itemsPath);
        // Const { rev } = this.#meta;
        await Promise.all(items.map(async (id) => {
            try {
                if (!all && (await (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_meta, "f").handled(id))) {
                    // We think this item is handled
                    return;
                }
                // Ask lib user for state of this item
                const state = await (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_instances, "m", _ListWatch_handleItemState).call(this, id);
                await (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_instances, "m", _ListWatch_updateItemState).call(this, list, id, state);
            }
            catch (cError) {
                error(cError);
            }
        }));
    }
    /**
     * Clean up metadata and unwatch list
     */
    async stop() {
        const watch = await (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_watch, "f");
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
    async persistMeta() {
        // Await this.#meta.persist();
    }
}
exports.ListWatch = ListWatch;
_ListWatch_resume = new WeakMap(), _ListWatch_conn = new WeakMap(), _ListWatch_watch = new WeakMap(), _ListWatch_assertItem = new WeakMap(), _ListWatch_meta = new WeakMap(), _ListWatch_onAddItem = new WeakMap(), _ListWatch_onChangeItem = new WeakMap(), _ListWatch_onItem = new WeakMap(), _ListWatch_onRemoveItem = new WeakMap(), _ListWatch_onNewList = new WeakMap(), _ListWatch_onDeleteList = new WeakMap(), _ListWatch_getItemState = new WeakMap(), _ListWatch_instances = new WeakSet(), _ListWatch_handleItemState = 
/**
 * Ask lib user for state of this item
 *
 * This handles fetching the Item before invoking the callback if needed
 */
async function _ListWatch_handleItemState(id) {
    // Needed because TS is weird about asserts...
    const assertItem = (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_assertItem, "f");
    if (!stateCBnoItem((0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_getItemState, "f"))) {
        const { data: item } = await (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_conn, "f").get({
            path: (0, node_path_1.join)(this.path, id),
        });
        assertItem(item);
        return (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_getItemState, "f").call(this, id, item);
    }
    return (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_getItemState, "f").call(this, id);
}, _ListWatch_handleNewItem = async function _ListWatch_handleNewItem(rev, id, item) {
    var _a, _b;
    const { path } = this;
    // Needed because TS is weird about asserts...
    const assertItem = (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_assertItem, "f");
    info(`${(0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_resume, "f") ? 'Detected new' : 'Handing existing'} item %s in %s, rev %s`, id, path, rev);
    const { _rev } = item;
    assertItem(item);
    const handled = await (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_meta, "f").handled(id);
    try {
        // Double check this is a new item?
        //      if (!handled?.onAddItem) {
        await ((0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_onAddItem, "f") && (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_onAddItem, "f").call(this, item, id));
        await (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_meta, "f").setHandled(id, { onAddItem: { rev: `${_rev}` } });
        //      }
    }
    finally {
        // Call this even if previous callback errored
        // TODO: Do I need to make a fake "change" to the item
        // or will the feed have one??
        // Double check this item is actually newer than last time
        if (Number(_rev) > Number((_b = (_a = handled === null || handled === void 0 ? void 0 : handled.onItem) === null || _a === void 0 ? void 0 : _a.rev) !== null && _b !== void 0 ? _b : 0)) {
            await ((0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_onItem, "f") && (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_onItem, "f").call(this, item, id));
            await (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_meta, "f").setHandled(id, { onItem: { rev: `${_rev}` } });
        }
    }
}, _ListWatch_handleItemChange = async function _ListWatch_handleItemChange(id, change) {
    var _a;
    const { path } = this;
    const conn = (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_conn, "f");
    const rev = (_a = change.body) === null || _a === void 0 ? void 0 : _a._rev;
    // TODO: How best to handle change to a descendant of an item?
    info('Detected change to item %s in %s, rev %s', id, path, rev);
    trace(`change was ${JSON.stringify(change)}`);
    try {
        await ((0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_onChangeItem, "f") && (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_onChangeItem, "f").call(this, change, id));
        await (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_meta, "f").setHandled(id, { onChangeItem: { rev: `${rev}` } });
    }
    finally {
        if ((0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_onItem, "f")) {
            // Needed because TS is weird about asserts...
            const assertItem = (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_assertItem, "f");
            const { data: item } = await conn.get({
                path: (0, node_path_1.join)(path, id),
            });
            assertItem(item);
            await (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_onItem, "f").call(this, item, id);
            await (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_meta, "f").setHandled(id, { onItem: { rev: `${rev}` } });
        }
    }
}, _ListWatch_handleListChange = async function _ListWatch_handleListChange(list, type) {
    const { path, itemsPath } = this;
    const conn = (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_conn, "f");
    const rev = list._rev;
    // Ignore _ keys of OADA
    // const items = Object.keys(list).filter((k) => !k.match(/^_/));
    const items = getListItems(list, itemsPath);
    trace(items, 'handleListChange');
    switch (type) {
        case 'merge':
            await Promise.all(items.map(async (id) => {
                try {
                    info('handleListChange: Processing item %s', id);
                    const ichang = json_pointer_1.default.get(list, id);
                    trace(ichang, 'handleListChange');
                    // If there is an _id this is a new link in the list right?
                    if (ichang._id) {
                        info('handleListChange: change has an _id, getting it and handing to handleNewItem');
                        const { data: item } = (await conn.get({
                            path: `/${ichang._id}`,
                        }));
                        await (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_instances, "m", _ListWatch_handleNewItem).call(this, `${rev}`, id, item);
                    }
                    else {
                        // TODO: What should we do now??
                        trace('Ignoring non-link key added to list %s, rev %s', path, rev);
                    }
                }
                catch (cError) {
                    // Log error with this item but continue map over other items
                    error(cError, `Error processing change for ${id} at ${path}, rev ${rev}`);
                }
            }));
            break;
        case 'delete':
            await Promise.all(items.map(async (id) => {
                try {
                    const lChange = json_pointer_1.default.get(list, id);
                    if (lChange === null) {
                        info('Detected removal of item %s from %s, rev %s', id, path, rev);
                        try {
                            await ((0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_onRemoveItem, "f") && (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_onRemoveItem, "f").call(this, id));
                        }
                        finally {
                            // Mark for delete?
                            await (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_meta, "f").setHandled(id);
                        }
                    }
                    else {
                        // TODO: What does this mean??
                        trace('Ignoring non-link key added to list %s, rev %s', path, rev);
                    }
                }
                catch (cError) {
                    // Log error with this item but continue map over other items
                    error(cError, `Error processing change for ${id} at ${path}, rev ${rev}`);
                }
            }));
            break;
        default:
            throw new TypeError(`Unknown change type ${type}`);
    }
    return items.length > 0;
}, _ListWatch_updateItemState = 
/**
 * Update the states of list items
 *
 * @see ItemState
 */
async function _ListWatch_updateItemState(list, ids, states) {
    const { path } = this;
    const { rev } = (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_meta, "f");
    const idArray = Array.isArray(ids) ? ids : [ids];
    const stateArray = (Array.isArray(states) ? states : [states]);
    await Promise.all(idArray.map(async (id, index) => {
        const state = stateArray[Number(index)];
        try {
            switch (state) {
                case Options_1.ItemState.New:
                    {
                        const { data: item } = (await (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_conn, "f").get({
                            path: (0, node_path_1.join)(path, id),
                        }));
                        await (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_instances, "m", _ListWatch_handleNewItem).call(this, `${list._rev}`, id, item);
                    }
                    break;
                case Options_1.ItemState.Modified:
                    {
                        const { data: item } = await (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_conn, "f").get({
                            path: (0, node_path_1.join)(path, id),
                        });
                        const change = {
                            resource_id: json_pointer_1.default.get(list, id)._id,
                            path: '',
                            type: 'merge',
                            body: item,
                        };
                        await (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_instances, "m", _ListWatch_handleItemChange).call(this, id, change);
                    }
                    break;
                case Options_1.ItemState.Handled:
                    info('Recording item %s as handled for %s', id, path);
                    // Mark handled for all callbacks?
                    await (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_meta, "f").setHandled(id, {
                        onAddItem: { rev },
                        onItem: { rev },
                    });
                    break;
                default:
                    assertNever(state);
            }
        }
        catch (cError) {
            error(cError, `Error processing item state "${state}" for item ${id}`);
        }
    }));
}, _ListWatch_initialize = 
/**
 * Do async stuff for initializing ourself since constructors are synchronous
 */
async function _ListWatch_initialize() {
    const { path, tree, itemsPath } = this;
    const conn = (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_conn, "f");
    info('Ensuring %s exists', path);
    try {
        await conn.head({ path });
    }
    catch (cError) {
        // @ts-expect-error darn errors
        if ((cError === null || cError === void 0 ? void 0 : cError.status) === 403 || (cError === null || cError === void 0 ? void 0 : cError.status) === 404) {
            // Create it
            await conn.put({ path, tree, data: {} });
            trace('Created %s because it did not exist', path);
        }
        else {
            error(cError);
            throw cError;
        }
    }
    // TODO: Clean up control flow to not need this?
    const currentItemsNew = !(await (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_meta, "f").init()) || !(0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_resume, "f");
    if (currentItemsNew) {
        trace('Treating current list items as new items');
        const { data: list } = (await conn.get({
            path,
            tree,
        }));
        // Const items = Object.keys(list).filter((k) => !k.match(/^_/));
        const items = getListItems(list, itemsPath);
        // Ask for states of pre-existing items
        trace('Calling onNewList');
        const states = await (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_onNewList, "f").call(this, items);
        // Set the states
        trace('Updating item states based on callback result');
        await (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_instances, "m", _ListWatch_updateItemState).call(this, list, items, states);
    }
    // Setup watch on the path
    if ((0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_resume, "f")) {
        trace('Resuming watch from rev %s', (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_meta, "f").rev);
    }
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const { changes } = await conn.watch({
        path,
        rev: (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_resume, "f") ? (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_meta, "f").rev : undefined,
        type: 'tree',
    });
    void (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_instances, "m", _ListWatch_handleChangeFeed).call(this, changes);
    return changes;
}, _ListWatch_handleChangeFeed = async function _ListWatch_handleChangeFeed(watch) {
    var _a, _b;
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
                await (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_onDeleteList, "f").call(this);
                continue;
            }
            const rev = (_a = body) === null || _a === void 0 ? void 0 : _a._rev;
            trace(change, 'Received change');
            let listChange = body;
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
                        json_pointer_1.default.set(changeObject, changePath, true);
                        // eslint-disable-next-line new-cap
                        const pathmatches = (0, jsonpath_plus_1.JSONPath)({
                            resultType: 'pointer',
                            path: itemsPath,
                            json: changeObject,
                            preventEval: true,
                        });
                        if ((pathmatches === null || pathmatches === void 0 ? void 0 : pathmatches.length) === 0) {
                            // If it does not match, this must be above the items
                            isListChange = true;
                            trace('Have a write to the list under itemsPath rather than to any of the items');
                        }
                    }
                    // Now put the actual change body in place of the true
                    json_pointer_1.default.set(changeObject, changePath, body);
                    // Find items involved in the change
                    const itemsChanged = getListItems(changeObject, itemsPath);
                    // The change was to items of the list (or their descendants)
                    if (!isListChange && itemsChanged.length > 0) {
                        // eslint-disable-next-line no-await-in-loop
                        await Promise.all(itemsChanged.map((item) => {
                            const itemBody = json_pointer_1.default.get(changeObject, item);
                            // Make change start at item instead of the list
                            const itemPath = changePath.slice(item.length);
                            const itemChange = {
                                ...context,
                                type,
                                path: itemPath,
                                body: itemBody,
                            };
                            // Check that it is a resource change?
                            if (!(typeof itemBody === 'object' &&
                                itemBody &&
                                '_rev' in itemBody)) {
                                warn(itemChange, 'Ignoring unexpected (as in the body does not have a _rev) change');
                                return;
                            }
                            return (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_instances, "m", _ListWatch_handleItemChange).call(this, item, itemChange);
                        }));
                        continue;
                    }
                    // The change is between the list and items
                    // (multiple link levels)
                    listChange = changeObject;
                }
                trace('Change was to the list itself because changePath is empty, calling handleListChange');
                // eslint-disable-next-line no-await-in-loop
                await (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_instances, "m", _ListWatch_handleListChange).call(this, listChange, type);
            }
            catch (cError) {
                error(cError, `Error processing change at ${path}, rev ${rev}`);
            }
        }
        if ((0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_resume, "f")) {
            trace('Received change to root of list, updating handled rev in our _meta records');
            (0, tslib_1.__classPrivateFieldGet)(this, _ListWatch_meta, "f").rev = `${(_b = rootChange === null || rootChange === void 0 ? void 0 : rootChange.body) === null || _b === void 0 ? void 0 : _b._rev}`;
        }
    }
    error('Change feed ended unexpectedly');
    return undefined;
};
/**
 * Callback to make ListWatch consider every `Item` new
 *
 * @see getItemState
 * @see onNewList
 * @see ItemState.New
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
ListWatch.AssumeNew = assumeItemState(Options_1.ItemState.New);
/**
 * Callback to make ListWatch consider every `Item` handled
 *
 * @see getItemState
 * @see onNewList
 * @see ItemState.Handled
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
ListWatch.AssumeHandled = assumeItemState(Options_1.ItemState.Handled);
function stateCBnoItem(callback) {
    return callback.length < 2;
}
var Options_2 = require("./Options");
Object.defineProperty(exports, "ItemState", { enumerable: true, get: function () { return Options_2.ItemState; } });
//# sourceMappingURL=index.js.map