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

import type { Change, ConnectionResponse } from '@oada/client';
import { OADAClient } from '@oada/client';
import { createStubInstance } from 'sinon';

export const emptyResponse: ConnectionResponse = {
  requestId: 'testid',
  status: 200,
  statusText: 'OK',
  headers: {},
  data: {},
};

/**
 * Creates a stubbed OADAClient for use in tests
 */
export function createStub() {
  const conn = createStubInstance(OADAClient);

  conn.get.resolves(emptyResponse);
  conn.head.resolves(emptyResponse);
  conn.put.resolves(emptyResponse);
  conn.post.resolves(emptyResponse);
  conn.delete.resolves(emptyResponse);
  const watch = {
    ...emptyResponse,
    changes: (async function* () {
      const change: Change = {
        type: 'merge',
        path: '',
        resource_id: 'resources/foo',
        body: { _rev: 2 },
      };
      yield [change];
    })(),
  };
  // @ts-expect-error stuff
  conn.watch.resolves(watch);
  conn.unwatch.resolves(emptyResponse);

  return conn;
}
