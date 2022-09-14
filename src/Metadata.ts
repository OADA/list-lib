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

import { inspect } from 'node:util';
import { join } from 'node:path';
import { setInterval } from 'isomorphic-timers-promises';

import debug from 'debug';

import type { Json } from '@oada/client';

import { AssumeState, assertNever } from './index.js';
import type { Conn } from './Options.js';

const log = {
  trace: debug('oada-list-lib#metadata:trace'),
  debug: debug('oada-list-lib#metadata:debug'),
  info: debug('oada-list-lib#metadata:info'),
  warn: debug('oada-list-lib#metadata:warn'),
  error: debug('oada-list-lib#metadata:error'),
  fatal: debug('oada-list-lib#metadata:fatal'),
};

/**
 * Record of a successfully handled list item
 *
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
 *
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
 *
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
  #rev = 0;
  #revDirty = false;

  // Where to store state
  #conn;
  #path;
  #initialized = false;

  constructor({
    conn,
    path,
    name,
  }: {
    /**
     * The path to the resource with which to associate this metadata
     */
    path: string;
    name: string;
    conn: Conn;
  }) {
    this.#conn = conn;
    this.#path = join(path, '_meta', Metadata.META_KEY, name);

    // ??? Use timeouts for all updates?
    const revUpdateInterval = setInterval(100);
    const updateRevs = async () => {
      for await (const _ of revUpdateInterval) {
        if (!this.#initialized || !this.#revDirty) {
          continue;
        }

        log.trace('Recording rev %s', this.#rev);
        const data: Json = { rev: this.#rev };
        this.#revDirty = false;
        try {
          await this.#conn?.put({
            path: this.#path,
            data,
          });
        } catch (error: unknown) {
          log.error({ error }, 'Failed to update rev');
          this.#revDirty = true;
        }
      }
    };

    void updateRevs();
  }

  get rev(): number {
    return this.#rev;
  }

  set rev(rev) {
    if (this.#rev === rev) {
      // No need to update
      return;
    }

    log.trace('Updating local rev to %d', rev);
    this.#rev = rev;
    this.#revDirty = true;
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
   *
   * @TODO I hate needing to call init...
   */
  public async init(assume: AssumeState): Promise<boolean> {
    // Try to get our metadata about this list
    try {
      const { data } = await this.#conn.get({
        path: this.#path,
      });
      if (
        typeof data == 'object' &&
        data &&
        !Buffer.isBuffer(data) &&
        !Array.isArray(data)
      ) {
        this.#rev = Number(data.rev ?? 0);
      }

      this.#initialized = true;
      return true;
    } catch {
      // Create our metadata?
      log.info('%s does not exist, posting new resource', this.#path);
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

      let rev: number;
      switch (assume) {
        case AssumeState.Handled:
          rev = Number(revHeader ?? 0);
          break;

        case AssumeState.New:
          rev = 0;
          break;

        default:
          assertNever(assume);
      }

      this.#rev = rev!;
      await this.#conn.put({
        path: this.#path,
        data: {
          rev: rev!,
        },
      });
      this.#initialized = true;
      return false;
    }
  }
}
