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
ava_1.default('should resume from last rev', async (t) => {
    var _a, _b, _c;
    const conn = conn_stub_1.createStub();
    // A Change from adding an item to a list
    // TODO: Better way to do this test without actually runnig oada?
    const path = '/bookmarks';
    const rev = '766';
    // @ts-ignore
    conn.get.resolves({ data: rev });
    const opts = {
        path,
        name,
        conn,
        resume: true,
        // Create spies to see which callbacks run
        onAddItem: sinon_1.default.spy(),
        onChangeItem: sinon_1.default.spy(),
        onItem: sinon_1.default.spy(),
        onRemoveItem: sinon_1.default.spy(),
    };
    new _1.ListWatch(opts);
    // TODO: How to do this right in ava?
    await bluebird_1.default.delay(5);
    t.is((_c = (_b = (_a = conn.watch.firstCall) === null || _a === void 0 ? void 0 : _a.args) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.rev, rev);
});
ava_1.default('should persist rev to _meta', async (t) => {
    var _a, _b, _c;
    const conn = conn_stub_1.createStub();
    // A Change from adding an item to a list
    // TODO: Better way to do this test without actually runnig oada?
    const path = '/bookmarks';
    const change = [
        {
            resource_id: 'resources/default:resources_bookmarks_321',
            path: '/foo',
            body: {
                '1e6XB0Hy7XJICbi3nMzCtl4QLpC': {
                    _id: '',
                },
                '_meta': {
                    modifiedBy: 'users/default:users_sam_321',
                    modified: 1593642877.725,
                    _rev: '4',
                },
                '_rev': '4',
            },
            type: 'merge',
        },
    ];
    const opts = {
        path,
        name,
        conn,
        resume: true,
        persistInterval: 10,
        // Create spies to see which callbacks run
        onAddItem: sinon_1.default.spy(),
        onChangeItem: sinon_1.default.spy(),
        onItem: sinon_1.default.spy(),
        onRemoveItem: sinon_1.default.spy(),
    };
    // @ts-ignore
    conn.get.resolves({ data: {} });
    new _1.ListWatch(opts);
    // TODO: How to do this right in ava?
    await bluebird_1.default.delay(5);
    const cb = (_c = (_b = (_a = conn.watch.firstCall) === null || _a === void 0 ? void 0 : _a.args) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.watchCallback;
    await cb(change);
    await bluebird_1.default.delay(500);
    t.assert(conn.put.calledWithMatch({
        path: `${path}/_meta/oada-list-lib/${name}`,
        data: { rev: '4' },
    }));
});
//# sourceMappingURL=Metadata.spec.js.map