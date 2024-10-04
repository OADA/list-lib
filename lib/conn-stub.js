"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createStub = void 0;
const sinon_1 = __importDefault(require("sinon"));
const client_1 = require("@oada/client");
const emptyResp = {
    requestId: 'testid',
    status: 200,
    statusText: 'OK',
    headers: {},
    data: {},
};
/**
 * Creates a stubbed OADAClient for use in tests
 */
function createStub() {
    const conn = sinon_1.default.createStubInstance(client_1.OADAClient);
    conn.get.resolves(emptyResp);
    conn.head.resolves(emptyResp);
    conn.put.resolves(emptyResp);
    conn.post.resolves(emptyResp);
    conn.delete.resolves(emptyResp);
    conn.watch.resolves('watchid');
    conn.unwatch.resolves(emptyResp);
    return conn;
}
exports.createStub = createStub;
//# sourceMappingURL=conn-stub.js.map