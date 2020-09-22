import test from 'ava';
import sinon from 'sinon';
import Bluebird from 'bluebird';

//import { Change } from '@oada/types/oada/change/v2';
// TODO: Fix this
import { Change } from './';

import { createStub } from './conn-stub';

import { ListWatch } from './';

const name = 'oada-list-lib-test';

const delay = 11;

test('it should WATCH given path', async (t) => {
  const conn = createStub();
  const path = '/bookmarks/foo/bar';

  new ListWatch({ path, name, conn });
  t.plan(1);

  // TODO: How to do this right in ava?
  await Bluebird.delay(delay);

  t.is(conn.watch.firstCall?.args?.[0]?.path, path);
});
test('it should UNWATCH on stop()', async (t) => {
  const conn = createStub();
  const path = '/bookmarks/foo/bar';
  const id = 'foobar';

  conn.watch.resolves(id);

  const watch = new ListWatch({ path, name, conn });

  // TODO: How to do this right in ava?
  await Bluebird.delay(delay);

  await watch.stop();

  t.is(conn.unwatch.callCount, 1);
  t.is(conn.unwatch.firstCall?.args?.[0], id);
});
test.todo('it should reconnect WATCH');

test('it should detect new item', async (t) => {
  const conn = createStub();
  // A Change from adding an item to a list
  // TODO: Better way to do this test without actually runnig oada?
  const path = '/bookmarks';
  const id = 'resources/foo';
  // @ts-ignore
  conn.get.resolves({ data: { _id: id } });
  const change: Change[] = [
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
    onAddItem: sinon.spy(),
    onChangeItem: sinon.spy(),
    onItem: sinon.spy(),
    onRemoveItem: sinon.spy(),
  };

  new ListWatch(opts);
  // TODO: How to do this right in ava?
  await Bluebird.delay(delay);

  const cb = conn.watch.firstCall?.args?.[0]?.watchCallback as (
    change: Change
  ) => Promise<void>;
  await Bluebird.map(change, (c) => cb?.(c));

  t.is(opts.onAddItem.callCount, 1);
  t.is(opts.onItem.callCount, 1);
  t.is(opts.onChangeItem.callCount, 0);
  t.is(opts.onRemoveItem.callCount, 0);
});
test('it should detect removed item', async (t) => {
  const conn = createStub();
  // A Change from adding an item to a list
  // TODO: Better way to do this test without actually runnig oada?
  const path = '/bookmarks';
  const change: Change[] = [
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
    onAddItem: sinon.spy(),
    onChangeItem: sinon.spy(),
    onItem: sinon.spy(),
    onRemoveItem: sinon.spy(),
  };

  new ListWatch(opts);
  // TODO: How to do this right in ava?
  await Bluebird.delay(delay);

  const cb = conn.watch.firstCall?.args?.[0]?.watchCallback as (
    change: Change
  ) => Promise<void>;
  await Bluebird.map(change, (c) => cb?.(c));

  t.is(opts.onAddItem.callCount, 0);
  t.is(opts.onItem.callCount, 0);
  t.is(opts.onChangeItem.callCount, 0);
  t.is(opts.onRemoveItem.callCount, 1);
});
test.todo('it should detect modified item');
