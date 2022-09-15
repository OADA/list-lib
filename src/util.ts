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

import { JsonPointer } from 'json-ptr';
import objectAssignDeep from 'object-assign-deep';

import type {
  Change,
  ConnectionResponse,
  Json,
  JsonObject,
} from '@oada/client';

/**
 * @internal
 */
export const changeSym = Symbol('change');
/**
 * @internal
 */
export type ChangeBody<T> = T & {
  [changeSym]?: Array<Readonly<Change>>;
};

/**
 * @internal
 */
export interface Result<T, P = unknown> {
  value: T;
  path: string;
  pointer: string;
  parent: P;
  parentProperty: string;
}

/**
 * @internal
 */
export type GetResponse<T = unknown> = ConnectionResponse & {
  data: T;
};

/**
 * Tell TS we should never reach here (i.e., this should never be called)
 * @internal
 */
export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Bad value: ${value}`);
}

/**
 * Replace `null` values in delete changes with `undefined`
 * @internal
 */
export function translateDelete(body: Json): Json | undefined {
  if (body === null) {
    return undefined;
  }

  if (typeof body !== 'object') {
    return body;
  }

  if (Array.isArray(body)) {
    return body.map((item) => translateDelete(item) as Json);
  }

  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [
      key,
      translateDelete(value!) as Json,
    ])
  );
}

/**
 * Construct object representing the change tree
 * @internal
 */
export function buildChangeObject(rootChange: Change, ...children: Change[]) {
  const changeBody: ChangeBody<unknown> = {
    [changeSym]: [rootChange],
    ...(rootChange.type === 'delete'
      ? (translateDelete(rootChange.body as Json) as JsonObject)
      : rootChange.body),
  };
  for (const change of children) {
    const ptr = JsonPointer.create(change.path);
    const old = ptr.get(changeBody) as ChangeBody<unknown>;
    // eslint-disable-next-line security/detect-object-injection
    const changes = old?.[changeSym] ?? [];
    const body =
      change.type === 'delete'
        ? translateDelete(change.body as Json)
        : change.body;
    const merged = objectAssignDeep(old ?? {}, body);
    // eslint-disable-next-line security/detect-object-injection
    merged[changeSym] = [...changes, change];
    ptr.set(changeBody, merged, true);
  }

  return changeBody;
}
