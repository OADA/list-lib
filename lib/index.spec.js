"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ava_1 = __importDefault(require("ava"));
const sinon_1 = __importDefault(require("sinon"));
const bluebird_1 = __importDefault(require("bluebird"));
const conn_stub_1 = require("./conn-stub");
const _1 = require("./");
const name = 'oada-list-lib-test';
const delay = 100;
ava_1.default('it should create JSON Path from simple OADA tree', (t) => {
    const tree = {
        bookmarks: {
            _type: 'application/vnd.oada.bookmarks.1+json',
            _rev: 0,
            thing: {
                _type: 'application/json',
                _rev: 0,
                abc: {
                    '*': {
                        _type: 'application/json',
                        _rev: 0,
                    },
                },
            },
        },
    };
    const path = _1.pathFromTree(tree);
    t.is(path, '$.bookmarks.thing.abc.*');
});
ava_1.default('it should create JSON Path from OADA tree and root', (t) => {
    const tree = {
        bookmarks: {
            _type: 'application/vnd.oada.bookmarks.1+json',
            _rev: 0,
            thing: {
                _type: 'application/json',
                _rev: 0,
                abc: {
                    '*': {
                        _type: 'application/json',
                        _rev: 0,
                    },
                },
            },
        },
    };
    const path = _1.pathFromTree(tree, '/bookmarks/thing');
    t.is(path, '$.abc.*');
});
ava_1.default('it should create JSON Path from two path OADA tree', (t) => {
    const tree = {
        bookmarks: {
            _type: 'application/vnd.oada.bookmarks.1+json',
            _rev: 0,
            thing1: {
                _type: 'application/json',
                _rev: 0,
                abc: {
                    '*': {
                        _type: 'application/json',
                        _rev: 0,
                    },
                },
            },
            thing2: {
                _type: 'application/json',
                _rev: 0,
                abc: {
                    '*': {
                        _type: 'application/json',
                        _rev: 0,
                    },
                },
            },
        },
    };
    const path = _1.pathFromTree(tree);
    t.is(path, '$.bookmarks.[thing1,thing2].abc.*');
});
ava_1.default('it should WATCH given path', async (t) => {
    var _a, _b, _c;
    const conn = conn_stub_1.createStub();
    const path = '/bookmarks/foo/bar';
    new _1.ListWatch({ path, name, conn });
    t.plan(1);
    // TODO: How to do this right in ava?
    await bluebird_1.default.delay(delay);
    t.is((_c = (_b = (_a = conn.watch.firstCall) === null || _a === void 0 ? void 0 : _a.args) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.path, path);
});
ava_1.default('it should UNWATCH on stop()', async (t) => {
    var _a, _b;
    const conn = conn_stub_1.createStub();
    const path = '/bookmarks/foo/bar';
    const id = 'foobar';
    conn.watch.resolves(id);
    const watch = new _1.ListWatch({ path, name, conn });
    // TODO: How to do this right in ava?
    await bluebird_1.default.delay(delay);
    await watch.stop();
    t.is(conn.unwatch.callCount, 1);
    t.is((_b = (_a = conn.unwatch.firstCall) === null || _a === void 0 ? void 0 : _a.args) === null || _b === void 0 ? void 0 : _b[0], id);
});
ava_1.default.todo('it should reconnect WATCH');
ava_1.default('it should detect new item', async (t) => {
    var _a, _b, _c;
    const conn = conn_stub_1.createStub();
    // A Change from adding an item to a list
    // TODO: Better way to do this test without actually runnig oada?
    const path = '/bookmarks';
    const id = 'resources/foo';
    // @ts-ignore
    conn.get.resolves({ data: { _id: id } });
    const change = [
        {
            resource_id: 'resources/default:resources_bookmarks_321',
            path: '',
            body: {
                '1e6XB0Hy7XJICbi3nMzCtl4QLpC': {
                    _id: id,
                },
                '_meta': {
                    modifiedBy: 'users/default:users_sam_321',
                    modified: 1593642877.725,
                    _rev: 4,
                },
                '_rev': 4,
            },
            type: 'merge',
        },
    ];
    // @ts-ignore
    conn.get.resolves({ data: { _rev: 4 } });
    const opts = {
        path,
        name,
        conn,
        // Create spies to see which callbacks run
        onAddItem: sinon_1.default.spy(),
        onChangeItem: sinon_1.default.spy(),
        onItem: sinon_1.default.spy(),
        onRemoveItem: sinon_1.default.spy(),
    };
    new _1.ListWatch(opts);
    // TODO: How to do this right in ava?
    await bluebird_1.default.delay(delay);
    const cb = (_c = (_b = (_a = conn.watch.firstCall) === null || _a === void 0 ? void 0 : _a.args) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.watchCallback;
    await cb(change);
    t.is(opts.onAddItem.callCount, 1);
    t.is(opts.onItem.callCount, 1);
    t.is(opts.onChangeItem.callCount, 0);
    t.is(opts.onRemoveItem.callCount, 0);
});
ava_1.default('it should detect removed item', async (t) => {
    var _a, _b, _c;
    const conn = conn_stub_1.createStub();
    // A Change from adding an item to a list
    // TODO: Better way to do this test without actually runnig oada?
    const path = '/bookmarks';
    const change = [
        {
            resource_id: 'resources/default:resources_bookmarks_321',
            path: '',
            body: {
                '1e6XB0Hy7XJICbi3nMzCtl4QLpC': null,
                '_meta': {
                    modifiedBy: 'users/default:users_sam_321',
                    modified: 1593642877.725,
                    _rev: 4,
                },
                '_rev': 4,
            },
            type: 'delete',
        },
    ];
    const opts = {
        path,
        name,
        conn,
        // Create spies to see which callbacks run
        onAddItem: sinon_1.default.spy(),
        onChangeItem: sinon_1.default.spy(),
        onItem: sinon_1.default.spy(),
        onRemoveItem: sinon_1.default.spy(),
    };
    new _1.ListWatch(opts);
    // TODO: How to do this right in ava?
    await bluebird_1.default.delay(delay);
    const cb = (_c = (_b = (_a = conn.watch.firstCall) === null || _a === void 0 ? void 0 : _a.args) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.watchCallback;
    await cb(change);
    t.is(opts.onAddItem.callCount, 0);
    t.is(opts.onItem.callCount, 0);
    t.is(opts.onChangeItem.callCount, 0);
    t.is(opts.onRemoveItem.callCount, 1);
});
ava_1.default.todo('it should detect modified item');
//# sourceMappingURL=index.spec.js.map