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

import { join } from 'node:path';
import { setInterval } from 'isomorphic-timers-promises';

import clone from 'clone-deep';
import debug from 'debug';
import pointer from 'json-pointer';

import type { Json } from '@oada/client';

import type { Conn } from './Options.js';

const trace = debug('oada-list-lib#metadata:trace');
const info = debug('oada-list-lib#metadata:info');
const error = debug('oada-list-lib#metadata:error');

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
  #rev?: string;
  #revDirty = false;

  // Where to store state
  #conn?;
  #path;
  #tree?: Record<string, unknown>;
  #initialized = false;

  constructor({
    conn,
    path,
    tree,
    name,
  }: {
    /**
     * The path to the resource with which to associate this metadata
     */
    path: string;
    /**
     * Optional OADA tree corresponding to `path`
     */
    tree?: Record<string, unknown>;
    name: string;
    conn?: Conn;
  }) {
    this.#conn = conn;
    this.#path = join(path, '_meta', Metadata.META_KEY, name);
    this.#tree = clone(tree);
    if (this.#tree) {
      // Replicate list tree under handled key?
      const listTree: unknown = clone(pointer.get(this.#tree, path));
      pointer.set(this.#tree, this.#path, {
        _type: 'application/json',
        handled: listTree,
      });
    } else {
      // Make up a tree? idk man
      this.#tree = {};
      pointer.set(this.#tree, this.#path, {
        _type: 'application/json',
        handled: { '*': {} },
      });
    }

    // TODO: Use timeouts for all updates?
    const revUpdateInterval = setInterval(100);
    const updateRevs = async () => {
      for await (const _ of revUpdateInterval) {
        if (!this.#initialized || !this.#revDirty) {
          continue;
        }

        trace('Recording rev %s', this.#rev);
        const data: Json = { rev: this.#rev };
        this.#revDirty = false;
        try {
          await this.#conn?.put({
            path: this.#path,
            tree: this.#tree,
            data,
          });
        } catch (cError: unknown) {
          error({ error: cError }, 'Failed to update rev');
          this.#revDirty = true;
        }
      }
    };

    void updateRevs();
  }

  get rev(): string {
    return `${this.#rev}`;
  }

  set rev(rev) {
    if (this.#rev === rev) {
      // No need to update
      return;
    }

    trace(`Updating local rev to ${rev}`);
    this.#rev = rev;
    this.#revDirty = true;
  }

  /**
   * Set handled info of a list item
   *
   * @param path JSON pointer of list item
   * @param item Item info to set
   */
  async setHandled(path: string, item?: Item) {
    if (item) {
      // Merge with current info

      const data: Json = {};
      pointer.set(data, `/handled${path}`, item);

      await this.#conn?.put({
        path: this.#path,
        tree: this.#tree,
        data,
      });
    } else {
      // Unset info?
      await this.#conn?.delete({ path: join(this.#path, 'handled', path) });
    }
    // This.#updated = true;
  }

  /**
   * Get handled info of a list item
   *
   * @param path JSON pointer of list item
   */
  async handled(path: string): Promise<Item | undefined> {
    if (!this.#conn) {
      return undefined;
    }

    try {
      const { data } = await this.#conn.get({
        path: join(this.#path, 'handled', path),
      });
      return data as Item;
    } catch {
      return undefined;
    }
  }

  /**
   * Initialize the connection to the meta resource
   * @returns whether existing metadata was found
   *
   * @TODO I hate needing to call init...
   */
  public async init(): Promise<boolean> {
    if (!this.#conn) {
      this.#rev = undefined;
      this.#initialized = true;
      return false;
    }

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
        this.#rev = data.rev as string;
      }

      this.#initialized = true;
      return true;
    } catch {
      // Create our metadata?
      info('%s does not exist, posting new resource', this.#path);
      const {
        headers: { 'content-location': location },
      } = await this.#conn.post({
        path: '/resources/',
        data: {},
        contentType: 'application/json',
      });
      await this.#conn.put({
        path: this.#path,
        tree: this.#tree,
        data: { _id: location?.slice(1) },
      });
      const data: Json = {
        rev: this.#rev,
      };
      await this.#conn.put({
        path: this.#path,
        tree: this.#tree,
        data,
      });
      this.#initialized = true;
      return false;
    }
  }
}
