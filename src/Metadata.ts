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

import Bluebird from 'bluebird';
import clone from 'clone-deep';
import pointer from 'json-pointer';

import { Conn } from './Options';

import debug from 'debug';
const trace = debug('oada-list-lib#metadata:trace');

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
// eslint-disable-next-line @typescript-eslint/consistent-indexed-object-style
export type Items = { [key: string]: undefined | Item | Items };

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

  // Where to store state
  #conn?;
  #path;
  #tree?: Record<string, unknown>;
  #timeout: NodeJS.Timeout;
  // Init stuff?
  #done!: (error?: unknown) => void;
  #wait: Promise<unknown>;

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

    // Console.dir(this.#tree, { depth: null });
    this.#wait = Bluebird.fromCallback((done) => {
      this.#done = done;
    });
    // TODO: Use timeouts for all updates?
    this.#timeout = setTimeout(async () => {
      await this.#wait;
      trace('Recording rev %s', this.#rev);
      this.#wait = Promise.resolve(
        this.#conn?.put({
          path: this.#path,
          tree: this.#tree,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: { rev: this.#rev } as any,
        })
      );
    }, 100);
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
    this.#timeout.refresh();
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

      const data: any = {};
      pointer.set(data, `/handled${path}`, item);

      await this.#conn?.put({
        path: this.#path,
        tree: this.#tree,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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
    try {
      if (!this.#conn) {
        this.#rev = undefined;
        this.#done();
        return false;
      }

      // Try to get our metadata about this list
      try {
        const { data: rev } = await this.#conn.get({
          path: join(this.#path, 'rev'),
        });
        this.#rev = rev as string;
        this.#done();
        return true;
      } catch {
        // Create our metadata?
        const {
          headers: { 'content-location': location },
        } = await this.#conn.post({
          path: '/resources/',
          data: {},
        });
        await this.#conn.put({
          path: this.#path,
          tree: this.#tree,
          data: { _id: location.slice(1) },
        });
        await this.#conn.put({
          path: this.#path,
          tree: this.#tree,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: {
            rev: this.#rev,
          } as any,
        });
        this.#done();
        return false;
      }
    } catch (error: unknown) {
      this.#done(error);
      throw error;
    }
  }
}
