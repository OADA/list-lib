/**
 * @license
 * Copyright 2022 Open Ag Data Alliance
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

import { setTimeout } from 'isomorphic-timers-promises';
import { spy } from 'sinon';
import test from 'ava';

import { createStub, emptyResponse } from './conn-stub.js';

import { ChangeType, ListWatch } from '@oada/list-lib';
import type { Change } from '@oada/list-lib';

const name = 'oada-list-lib-test';

const delay = 100;

test('it should WATCH given path', async (t) => {
  const conn = createStub();
  const path = '/bookmarks/foo/bar';

  // eslint-disable-next-line no-new
  new ListWatch({ path, name, conn });
  t.plan(1);

  await setTimeout(delay);

  t.is(conn.watch.firstCall?.args?.[0]?.path, path);
});

test.todo('it should reconnect WATCH');

test('it should detect new item', async (t) => {
  const conn = createStub();
  // A Change from adding an item to a list
  const path = '/bookmarks';
  const id = 'resources/foo';
  // @ts-expect-error test
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
          modified: 1_593_642_877.725,
          _rev: 4,
        },
        '_rev': 4,
      },
      type: 'merge',
    },
  ];
  // @ts-expect-error test
  conn.get.resolves({ data: { _rev: 4 } });

  // Create spies to see which events are emitted
  const onAddItem = spy();
  const onChangeItem = spy();
  const onItem = spy();
  const onRemoveItem = spy();

  async function* changes() {
    yield change;
  }

  // @ts-expect-error bs from deprecated v2 API
  conn.watch.resolves({
    ...emptyResponse,
    changes: changes(),
  });

  const watch = new ListWatch({
    path,
    name,
    conn,
  });
  watch.on(ChangeType.ItemAdded, onAddItem);
  watch.on(ChangeType.ItemChanged, onChangeItem);
  watch.on(ChangeType.ItemAny, onItem);
  watch.on(ChangeType.ItemRemoved, onRemoveItem);

  await setTimeout(delay);

  t.is(onAddItem.callCount, 1);
  t.is(onItem.callCount, 1);
  t.is(onChangeItem.callCount, 0);
  t.is(onRemoveItem.callCount, 0);
});

test('it should detect removed item', async (t) => {
  const conn = createStub();
  // A Change from adding an item to a list
  const path = '/bookmarks';
  const change: Change[] = [
    {
      resource_id: 'resources/default:resources_bookmarks_321',
      path: '',
      body: {
        // eslint-disable-next-line unicorn/no-null
        '1e6XB0Hy7XJICbi3nMzCtl4QLpC': null,
        '_meta': {
          modifiedBy: 'users/default:users_sam_321',
          modified: 1_593_642_877.725,
          _rev: 4,
        },
        '_rev': 4,
      },
      type: 'delete',
    },
  ];

  // Create spies to see which events are emitted
  const onAddItem = spy();
  const onChangeItem = spy();
  const onItem = spy();
  const onRemoveItem = spy();

  async function* changes() {
    yield change;
  }

  // @ts-expect-error bs from deprecated v2 API
  conn.watch.resolves({
    ...emptyResponse,
    changes: changes(),
  });

  const watch = new ListWatch({
    path,
    name,
    conn,
  });
  watch.on(ChangeType.ItemAdded, onAddItem);
  watch.on(ChangeType.ItemChanged, onChangeItem);
  watch.on(ChangeType.ItemAny, onItem);
  watch.on(ChangeType.ItemRemoved, onRemoveItem);

  await setTimeout(delay);

  t.is(onAddItem.callCount, 0);
  t.is(onItem.callCount, 0);
  t.is(onChangeItem.callCount, 0);
  t.is(onRemoveItem.callCount, 1);
});

test('it should detect modified item', async (t) => {
  const conn = createStub();
  // A Change from adding an item to a list
  const path = '/bookmarks';
  const id = 'resources/foo';
  // @ts-expect-error test
  conn.get.resolves({ data: { _id: id } });
  const change: Change[] = [
    {
      resource_id: 'resources/default:resources_bookmarks_321',
      path: '',
      body: {
        abc123: { _rev: 4 },
        _meta: {
          modifiedBy: 'users/default:users_sam_321',
          modified: 1_593_642_877.725,
          _rev: 4,
        },
        _rev: 4,
      },
      type: 'merge',
    },
    {
      resource_id: 'resources/abc123',
      path: '/abc123',
      body: {
        foo: 'bar',
        _meta: {
          modifiedBy: 'users/default:users_sam_321',
          modified: 1_593_642_877.725,
          _rev: 4,
        },
        _rev: 4,
      },
      type: 'merge',
    },
  ];
  // @ts-expect-error test
  conn.get.resolves({ data: { _rev: 4 } });

  // Create spies to see which events are emitted
  const onAddItem = spy();
  const onChangeItem = spy();
  const onItem = spy();
  const onRemoveItem = spy();

  async function* changes() {
    yield change;
  }

  // @ts-expect-error bs from deprecated v2 API
  conn.watch.resolves({
    ...emptyResponse,
    changes: changes(),
  });

  const watch = new ListWatch({
    path,
    name,
    conn,
  });
  watch.on(ChangeType.ItemAdded, onAddItem);
  watch.on(ChangeType.ItemChanged, onChangeItem);
  watch.on(ChangeType.ItemAny, onItem);
  watch.on(ChangeType.ItemRemoved, onRemoveItem);

  await setTimeout(delay);

  t.is(onAddItem.callCount, 0);
  t.is(onItem.callCount, 1);
  t.is(onChangeItem.callCount, 1);
  t.is(onRemoveItem.callCount, 0);
});
