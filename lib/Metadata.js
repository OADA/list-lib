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
var _Metadata_rev, _Metadata_revDirty, _Metadata_conn, _Metadata_path, _Metadata_tree, _Metadata_initialized;
Object.defineProperty(exports, "__esModule", { value: true });
exports.Metadata = void 0;
const tslib_1 = require("tslib");
const node_path_1 = require("node:path");
const isomorphic_timers_promises_1 = require("isomorphic-timers-promises");
const clone_deep_1 = (0, tslib_1.__importDefault)(require("clone-deep"));
const debug_1 = (0, tslib_1.__importDefault)(require("debug"));
const json_pointer_1 = (0, tslib_1.__importDefault)(require("json-pointer"));
const trace = (0, debug_1.default)('oada-list-lib#metadata:trace');
const info = (0, debug_1.default)('oada-list-lib#metadata:info');
const error = (0, debug_1.default)('oada-list-lib#metadata:error');
/**
 * Persistent data we store in the _meta of the list
 *
 * @internal
 */
class Metadata {
    constructor({ conn, path, tree, name, }) {
        /**
         * The rev we left off on
         */
        _Metadata_rev.set(this, void 0);
        _Metadata_revDirty.set(this, false);
        // Where to store state
        _Metadata_conn.set(this, void 0);
        _Metadata_path.set(this, void 0);
        _Metadata_tree.set(this, void 0);
        _Metadata_initialized.set(this, false);
        (0, tslib_1.__classPrivateFieldSet)(this, _Metadata_conn, conn, "f");
        (0, tslib_1.__classPrivateFieldSet)(this, _Metadata_path, (0, node_path_1.join)(path, '_meta', Metadata.META_KEY, name), "f");
        (0, tslib_1.__classPrivateFieldSet)(this, _Metadata_tree, (0, clone_deep_1.default)(tree), "f");
        if ((0, tslib_1.__classPrivateFieldGet)(this, _Metadata_tree, "f")) {
            // Replicate list tree under handled key?
            const listTree = (0, clone_deep_1.default)(json_pointer_1.default.get((0, tslib_1.__classPrivateFieldGet)(this, _Metadata_tree, "f"), path));
            json_pointer_1.default.set((0, tslib_1.__classPrivateFieldGet)(this, _Metadata_tree, "f"), (0, tslib_1.__classPrivateFieldGet)(this, _Metadata_path, "f"), {
                _type: 'application/json',
                handled: listTree,
            });
        }
        else {
            // Make up a tree? idk man
            (0, tslib_1.__classPrivateFieldSet)(this, _Metadata_tree, {}, "f");
            json_pointer_1.default.set((0, tslib_1.__classPrivateFieldGet)(this, _Metadata_tree, "f"), (0, tslib_1.__classPrivateFieldGet)(this, _Metadata_path, "f"), {
                _type: 'application/json',
                handled: { '*': {} },
            });
        }
        // TODO: Use timeouts for all updates?
        const revUpdateInterval = (0, isomorphic_timers_promises_1.setInterval)(100);
        const updateRevs = async () => {
            var _a;
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            for await (const _ of revUpdateInterval) {
                trace('rev update interval %d, %s, %s', (0, tslib_1.__classPrivateFieldGet)(this, _Metadata_rev, "f"), (0, tslib_1.__classPrivateFieldGet)(this, _Metadata_initialized, "f"), (0, tslib_1.__classPrivateFieldGet)(this, _Metadata_revDirty, "f"));
                if (!(0, tslib_1.__classPrivateFieldGet)(this, _Metadata_initialized, "f") || !(0, tslib_1.__classPrivateFieldGet)(this, _Metadata_revDirty, "f")) {
                    continue;
                }
                trace('Recording rev %s', (0, tslib_1.__classPrivateFieldGet)(this, _Metadata_rev, "f"));
                const data = { rev: (0, tslib_1.__classPrivateFieldGet)(this, _Metadata_rev, "f") };
                (0, tslib_1.__classPrivateFieldSet)(this, _Metadata_revDirty, false, "f");
                try {
                    await ((_a = (0, tslib_1.__classPrivateFieldGet)(this, _Metadata_conn, "f")) === null || _a === void 0 ? void 0 : _a.put({
                        path: (0, tslib_1.__classPrivateFieldGet)(this, _Metadata_path, "f"),
                        tree: (0, tslib_1.__classPrivateFieldGet)(this, _Metadata_tree, "f"),
                        data,
                    }));
                }
                catch (cError) {
                    error(cError, 'Failed to update rev');
                    (0, tslib_1.__classPrivateFieldSet)(this, _Metadata_revDirty, true, "f");
                }
            }
        };
        void updateRevs();
    }
    /**
     * @todo: Where in _meta to keep stuff?
     */
    // eslint-disable-next-line @typescript-eslint/naming-convention
    static get META_KEY() {
        return 'oada-list-lib';
    }
    get rev() {
        return `${(0, tslib_1.__classPrivateFieldGet)(this, _Metadata_rev, "f")}`;
    }
    set rev(rev) {
        if ((0, tslib_1.__classPrivateFieldGet)(this, _Metadata_rev, "f") === rev) {
            // No need to update
            return;
        }
        trace(`Updating local rev to ${rev}`);
        (0, tslib_1.__classPrivateFieldSet)(this, _Metadata_rev, rev, "f");
        (0, tslib_1.__classPrivateFieldSet)(this, _Metadata_revDirty, true, "f");
    }
    /**
     * Set handled info of a list item
     *
     * @param path JSON pointer of list item
     * @param item Item info to set
     */
    async setHandled(path, item) {
        var _a, _b;
        if (item) {
            // Merge with current info
            const data = {};
            json_pointer_1.default.set(data, `/handled${path}`, item);
            await ((_a = (0, tslib_1.__classPrivateFieldGet)(this, _Metadata_conn, "f")) === null || _a === void 0 ? void 0 : _a.put({
                path: (0, tslib_1.__classPrivateFieldGet)(this, _Metadata_path, "f"),
                tree: (0, tslib_1.__classPrivateFieldGet)(this, _Metadata_tree, "f"),
                data,
            }));
        }
        else {
            // Unset info?
            await ((_b = (0, tslib_1.__classPrivateFieldGet)(this, _Metadata_conn, "f")) === null || _b === void 0 ? void 0 : _b.delete({ path: (0, node_path_1.join)((0, tslib_1.__classPrivateFieldGet)(this, _Metadata_path, "f"), 'handled', path) }));
        }
        // This.#updated = true;
    }
    /**
     * Get handled info of a list item
     *
     * @param path JSON pointer of list item
     */
    async handled(path) {
        if (!(0, tslib_1.__classPrivateFieldGet)(this, _Metadata_conn, "f")) {
            return undefined;
        }
        try {
            const { data } = await (0, tslib_1.__classPrivateFieldGet)(this, _Metadata_conn, "f").get({
                path: (0, node_path_1.join)((0, tslib_1.__classPrivateFieldGet)(this, _Metadata_path, "f"), 'handled', path),
            });
            return data;
        }
        catch {
            return undefined;
        }
    }
    /**
     * Initialize the connection to the meta resource
     * @returns whether existing metadata was found
     *
     * @TODO I hate needing to call init...
     */
    async init() {
        if (!(0, tslib_1.__classPrivateFieldGet)(this, _Metadata_conn, "f")) {
            (0, tslib_1.__classPrivateFieldSet)(this, _Metadata_rev, undefined, "f");
            (0, tslib_1.__classPrivateFieldSet)(this, _Metadata_initialized, true, "f");
            return false;
        }
        // Try to get our metadata about this list
        try {
            const { data } = await (0, tslib_1.__classPrivateFieldGet)(this, _Metadata_conn, "f").get({
                path: (0, tslib_1.__classPrivateFieldGet)(this, _Metadata_path, "f"),
            });
            if (typeof data == 'object' && data && !Buffer.isBuffer(data) && !Array.isArray(data)) {
                (0, tslib_1.__classPrivateFieldSet)(this, _Metadata_rev, data.rev, "f");
            }
            (0, tslib_1.__classPrivateFieldSet)(this, _Metadata_initialized, true, "f");
            return true;
        }
        catch {
            // Create our metadata?
            info(`${(0, tslib_1.__classPrivateFieldGet)(this, _Metadata_path, "f")} does not exist, posting new resource`);
            const { headers: { 'content-location': location }, } = await (0, tslib_1.__classPrivateFieldGet)(this, _Metadata_conn, "f").post({
                path: '/resources/',
                data: {},
                contentType: 'application/json'
            });
            await (0, tslib_1.__classPrivateFieldGet)(this, _Metadata_conn, "f").put({
                path: (0, tslib_1.__classPrivateFieldGet)(this, _Metadata_path, "f"),
                tree: (0, tslib_1.__classPrivateFieldGet)(this, _Metadata_tree, "f"),
                data: { _id: location === null || location === void 0 ? void 0 : location.slice(1) },
            });
            const data = {
                rev: (0, tslib_1.__classPrivateFieldGet)(this, _Metadata_rev, "f"),
            };
            await (0, tslib_1.__classPrivateFieldGet)(this, _Metadata_conn, "f").put({
                path: (0, tslib_1.__classPrivateFieldGet)(this, _Metadata_path, "f"),
                tree: (0, tslib_1.__classPrivateFieldGet)(this, _Metadata_tree, "f"),
                data,
            });
            (0, tslib_1.__classPrivateFieldSet)(this, _Metadata_initialized, true, "f");
            return false;
        }
    }
}
exports.Metadata = Metadata;
_Metadata_rev = new WeakMap(), _Metadata_revDirty = new WeakMap(), _Metadata_conn = new WeakMap(), _Metadata_path = new WeakMap(), _Metadata_tree = new WeakMap(), _Metadata_initialized = new WeakMap();
//# sourceMappingURL=Metadata.js.map