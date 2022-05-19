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

import { setTimeout } from 'isomorphic-timers-promises';
import { spy } from 'sinon';
import test from 'ava';

// TODO: Fix this
// Import { Change } from '@oada/types/oada/change/v2';
import type { PUTRequest } from '@oada/client';

import { createStub, emptyResponse } from './conn-stub.js';

import { Change, ListWatch } from '../';

const name = 'oada-list-lib-test';

test('should resume from last rev', async (t) => {
  const conn = createStub();
  // A Change from adding an item to a list
  // TODO: Better way to do this test without actually running oada?
  const path = '/bookmarks';
  const rev = '766';

  // @ts-expect-error test
  conn.get.resolves({ data: { rev } });

  const options = {
    path,
    name,
    conn,
    resume: true,
    // Create spies to see which callbacks run
    onAddItem: spy(),
    onChangeItem: spy(),
    onItem: spy(),
    onRemoveItem: spy(),
  };

  // eslint-disable-next-line no-new
  new ListWatch(options);
  // TODO: How to do this right in ava?
  await setTimeout(5);

  t.is(conn.watch.firstCall?.args?.[0]?.rev, rev);
});
test('should persist rev to _meta', async (t) => {
  const conn = createStub();
  // A Change from adding an item to a list
  // TODO: Better way to do this test without actually running oada?
  const path = '/bookmarks';
  const change: Change[] = [
    {
      resource_id: 'resources/default:resources_bookmarks_321',
      path: '/foo',
      body: {
        // eslint-disable-next-line no-secrets/no-secrets
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

  const options = {
    path,
    name,
    conn,
    resume: true,
    persistInterval: 10,
    // Create spies to see which callbacks run
    onAddItem: spy(),
    onChangeItem: spy(),
    onItem: spy(),
    onRemoveItem: spy(),
  };

  // @ts-expect-error test
  conn.get.resolves({ data: {} });

  async function* changes() {
    yield change;
  }

  // @ts-expect-error bs from deprecated v2 API
  conn.watch.resolves({
    ...emptyResponse,
    changes: changes(),
  });

  // eslint-disable-next-line no-new
  new ListWatch(options);
  // TODO: How to do this right in ava?
  await setTimeout(5);

  await setTimeout(500);

  t.assert(
    conn.put.calledWithMatch({
      path: `${path}/_meta/oada-list-lib/${name}`,
      data: { rev: '4' },
    } as PUTRequest)
  );
});
