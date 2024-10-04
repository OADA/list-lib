/**
 * @license
 * Copyright 2021-2022 Open Ag Data Alliance
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

import { AbortController } from 'abort-controller';
import { assert as assertResource } from '@oada/types/oada/resource.js';
import type { Conn } from './Options.js';
import { inspect } from 'node:util';
import { join } from './util.js';
import type { Json } from '@oada/client';
import { type Logger } from '@oada/pino-debug';
import { setInterval } from 'isomorphic-timers-promises';

/**
 * Record of a successfully handled list item
 * @internal
 */
export type Item = Record<
  string,
  {
    rev: string;
  }
>;

/**
 * Record of successfully handled list items
 * @internal
 */
export interface Items {
  [key: string]: undefined | Item | Items;
}

export interface Meta {
  rev: string;
  // eslint-disable-next-line @typescript-eslint/consistent-indexed-object-style
  errors: {
    [pointer: string]: Record<number, string>;
  };
}

/**
 * Persistent data we store in the _meta of the list
 * @internal
 */
export class Metadata {
  /**
   * @todo: Where in _meta to keep stuff?
   */
  // eslint-disable-next-line @typescript-eslint/naming-convention
  public static get META_KEY() {
    return 'oada-list-lib';
  }

  /**
   * The rev we left off on
   */
  #rev?: number;
  #revDirty = false;

  // Where to store state
  readonly #conn;
  readonly #path;
  #initialized = false;
  readonly #controller;
  readonly #updates;
  readonly #log;

  constructor({
    conn,
    path,
    name,
    log,
    persistInterval,
  }: {
    /**
     * The path to the resource with which to associate this metadata
     */
    path: string;
    name: string;
    conn: Conn;
    log: Logger;
    persistInterval: number;
  }) {
    this.#conn = conn;
    this.#path = join(path, '_meta', Metadata.META_KEY, name);
    this.#controller = new AbortController();
    this.#log = log;

    // ??? Use timeouts for all updates?
    const revUpdateInterval = setInterval(persistInterval, undefined, {
      // @ts-expect-error browser/node difference bs
      signal: this.#controller.signal,
    });
    const updateRevs = async () => {
      try {
        for await (const _ of revUpdateInterval) {
          await this.#doUpdate();
        }
      } finally {
        await this.#doUpdate();
      }
    };

    this.#updates = updateRevs();
  }

  async stop() {
    this.#controller.abort();
    await this.#updates;
  }

  async setErrored(pointer: string, rev: number, error: unknown) {
    // Merge with current info
    await this.#conn?.put({
      path: this.#path,
      data: {
        errors: {
          [pointer]: {
            [rev]: inspect(error),
          },
        },
      },
    });
  }

  /**
   * Initialize the connection to the meta resource
   * @returns whether existing metadata was found
   * @TODO I hate needing to call init...
   */
  async init(): Promise<boolean> {
    // Try to get our metadata about this list
    try {
      const { data } = await this.#conn.get({
        path: this.#path,
      });
      assertResource(data);
      this.#rev = Number(data.rev ?? 0);
      return true;
    } catch {
      // Create our metadata?
      this.#log.info('%s does not exist, posting new resource', this.#path);
      const {
        headers: { 'content-location': location },
      } = await this.#conn.post({
        path: '/resources/',
        data: {},
        contentType: 'application/json',
      });
      const {
        headers: { 'x-oada-rev': revHeader },
      } = await this.#conn.put({
        path: this.#path,
        data: { _id: location?.slice(1) },
      });

      const rev = revHeader ? Number(revHeader) : undefined;

      this.#rev = rev;
      await this.#conn.put({
        path: this.#path,
        data: {
          rev: rev!,
        },
      });
      return false;
    } finally {
      this.#initialized = true;
    }
  }

  async #doUpdate() {
    if (!(this.#initialized && this.#revDirty)) {
      return;
    }

    this.#log.trace('Recording rev %s', this.#rev);
    const data: Json = { rev: this.#rev };
    this.#revDirty = false;
    try {
      await this.#conn.put({
        path: this.#path,
        data,
      });
    } catch (error: unknown) {
      this.#log.error({ error }, 'Failed to update rev');
      this.#revDirty = true;
    }
  }

  get rev() {
    return this.#rev;
  }

  set rev(rev) {
    if (this.#rev === rev) {
      // No need to update
      return;
    }

    this.#log.trace('Updating local rev to %d', rev);
    this.#rev = rev;
    this.#revDirty = true;
  }
}
