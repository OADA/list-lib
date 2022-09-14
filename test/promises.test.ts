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

import test from 'ava';

import { createStub, emptyResponse } from './conn-stub.js';

// eslint-disable-next-line node/no-extraneous-import
import type { Change } from '@oada/list-lib';
// eslint-disable-next-line node/no-extraneous-import
import { ChangeType, ListWatch } from '@oada/list-lib';

const name = 'oada-list-lib-test';

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

  async function* changes() {
    yield change;
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
  const add = watch.once(ChangeType.ItemAdded);
  const item = watch.once(ChangeType.ItemAny);

  await t.notThrowsAsync(add);
  await t.notThrowsAsync(item);
});

test('it should detect removed item', async (t) => {
  const conn = createStub();
  // A Change from adding an item to a list
  // TODO: Better way to do this test without actually running oada?
  const path = '/bookmarks';
  const change: Change[] = [
    {
      resource_id: 'resources/default:resources_bookmarks_321',
      path: '',
      body: {
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

  async function* changes() {
    yield change;
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
  const removed = watch.once(ChangeType.ItemRemoved);

  await t.notThrowsAsync(removed);
});

test.todo('it should detect modified item');
