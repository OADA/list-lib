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

import { inspect } from 'node:util';

import { setTimeout } from 'isomorphic-timers-promises';
import test from 'ava';

import type { PUTRequest } from '@oada/client';

import { createStub, emptyResponse } from './conn-stub.js';

// eslint-disable-next-line node/no-extraneous-import
import { type Change, ChangeType, ListWatch } from '@oada/list-lib';

const name = 'oada-list-lib-test';

test('should resume from last rev', async (t) => {
  const conn = createStub();
  // A Change from adding an item to a list
  const path = '/bookmarks';
  const rev = 766;

  // @ts-expect-error test
  conn.get.resolves({
    data: {
      _id: 'resources/foo',
      _rev: 7,
      _type: 'application/vnd.oada.foo.1+json',
      _meta: {
        _id: 'resources/foo/_meta',
        _rev: 7,
      },
      rev,
    },
  });

  const watch = new ListWatch({
    path,
    name,
    conn,
    resume: true,
  });

  await setTimeout(5);

  t.is(conn.watch.firstCall?.args?.[0]?.rev, rev);

  await watch.stop();
});

test('should persist rev to _meta', async (t) => {
  const conn = createStub();
  // A Change from adding an item to a list
  const path = '/bookmarks';
  const change: Change[] = [
    {
      resource_id: 'resources/default:resources_bookmarks_321',
      path: '/foo',
      body: {
        '1e6XB0Hy7XJICbi3nMzCtl4QLpC': {
          _id: '',
        },
        '_meta': {
          modifiedBy: 'users/default:users_sam_321',
          modified: 1_593_642_877.725,
          _rev: '4',
        },
        '_rev': 4,
      },
      type: 'merge',
    },
  ];

  // @ts-expect-error test
  conn.get.resolves({ data: { rev: 3 } });

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
    resume: true,
    persistInterval: 10,
  });

  await watch.once(ChangeType.ItemAdded);
  await setTimeout(500);

  t.assert(
    conn.put.calledWithMatch({
      path: `${path}/_meta/oada-list-lib/${name}`,
      data: { rev: 4 },
    } as PUTRequest),
    `conn.put calls: ${inspect(conn.put.getCalls(), false, undefined, true)}`,
  );

  await watch.stop();
});
