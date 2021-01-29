import test from 'ava';
import sinon from 'sinon';
import Bluebird from 'bluebird';

//import { Change } from '@oada/types/oada/change/v2';
// TODO: Fix this
import { Change } from './';

import { createStub } from './conn-stub';

import { ListWatch } from './';
import { PUTRequest } from '@oada/client';

const name = 'oada-list-lib-test';

test('should resume from last rev', async (t) => {
  const conn = createStub();
  // A Change from adding an item to a list
  // TODO: Better way to do this test without actually runnig oada?
  const path = '/bookmarks';
  const rev = '766';

  // @ts-ignore
  conn.get.resolves({ data: { rev } });

  const opts = {
    path,
    name,
    conn,
    resume: true,
    // Create spies to see which callbacks run
    onAddItem: sinon.spy(),
    onChangeItem: sinon.spy(),
    onItem: sinon.spy(),
    onRemoveItem: sinon.spy(),
  };

  new ListWatch(opts);
  // TODO: How to do this right in ava?
  await Bluebird.delay(5);

  t.is(conn.watch.firstCall?.args?.[0]?.rev, rev);
});
test('should persist rev to _meta', async (t) => {
  const conn = createStub();
  // A Change from adding an item to a list
  // TODO: Better way to do this test without actually runnig oada?
  const path = '/bookmarks';
  const change: Change[] = [
    {
      resource_id: 'resources/default:resources_bookmarks_321',
      path: '',
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
    onAddItem: sinon.spy(),
    onChangeItem: sinon.spy(),
    onItem: sinon.spy(),
    onRemoveItem: sinon.spy(),
  };

  // @ts-ignore
  conn.get.resolves({ data: {} });

  new ListWatch(opts);
  // TODO: How to do this right in ava?
  await Bluebird.delay(5);

  const cb = conn.watch.firstCall?.args?.[0]?.watchCallback as (
    change: Change
  ) => Promise<void>;
  await Bluebird.map(change, (c) => cb?.(c));

  await Bluebird.delay(100);

  t.assert(
    conn.put.calledWithMatch({
      path: `${path}/_meta/oada-list-lib/${name}/rev`,
      data: '4',
    } as PUTRequest)
  );
});
