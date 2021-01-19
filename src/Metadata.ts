import { join } from 'path';

import assign from 'object-assign-deep';

import { Conn } from './Options';
import { GetResponse } from '.';

import debug from 'debug';
const trace = debug('oada-list-lib#metadata:trace');


/**
 * Record of successfully handled list item(s)
 *
 * @internal
 */
export type Items = {
  /**
   * The list item which ran
   */
  [item: string]:
    | undefined
    | {
        /**
         * The callback which ran on item
         */
        [callback: string]: {
          rev: string;
        };
      };
};

/**
 * Persistent data we store in the _meta of the list
 *
 * @internal
 */
export class Metadata {
  /**
   * @todo: Where in _meta to keep stuff?
   */
  public static readonly META_KEY = 'oada-list-lib';

  /**
   * The rev we left off on
   */
  #rev = '0';
  /**
   * Track "error" items
   */
  #handled: Items = {};

  #interval?;
  /**
   * Flag to track whenever any state gets set
   */
  #updated: boolean;

  // Where to store state
  #conn;
  #path;

  get rev(): string {
    return this.#rev;
  }
  set rev(rev) {
    trace(`Updating local rev to ${rev}`);
    this.#rev = rev;
    this.#updated = true;
  }

  // TODO: IDK about this...
  set handled(items) {
    assign(this.#handled, items);
    this.#updated = true;
  }

  get handled() {
    return this.#handled;
  }

  toJSON(): object {
    return {
      rev: this.rev,
      handled: this.handled,
    };
  }

  constructor({
    conn,
    path,
    name,
    persistInterval,
  }: {
    /**
     * The path to the resource with which to associate this metadata
     */
    path: string;
    name: string;
    conn: Conn;
    persistInterval: number;
  }) {
    this.#updated = false;

    this.#conn = conn;
    this.#path = join(path, '_meta', Metadata.META_KEY, name);

    // Periodically persist state to _meta
    if (persistInterval) {
      this.#interval = setInterval(() => this.persist(), persistInterval);
    }
  }

  /**
   * Initialize the connection to the meta resource
   * @returns whether existing metadata was found
   *
   * @TODO I hate needing to call init...
   */
  public async init(): Promise<boolean> {
    // Try to get our metadata about this list
    try {
      const { data } = (await this.#conn.get({
        path: this.#path,
      })) as GetResponse<Metadata>;
      Object.assign(this, data);
      return true;
    } catch (err: unknown) {
      // Create our metadata
      const { headers } = await this.#conn.post({
        path: '/resources/',
        data: this as {},
      });
      const id = headers['content-location'].replace(/^\//, '');
      await this.#conn.put({ path: this.#path, data: { _id: id } });
      return false;
    }
  }

  /**
   * Persist relevant info to the _meta of the list.
   * This preserves it across restarts.
   */
  public async persist() {
    if (!this.#updated || !this.#interval) {
      // Avoid PUTing to _meta needlessly
      return;
    }
    trace(`Persisting _meta to OADA`);

    // Removing keys in OADA is annoying
    // TODO: Is it better to just DELETE the whole thing and then put?
    for (const id in this.handled) {
      if (!this.handled[id]) {
        await this.#conn.delete({
          path: join(this.#path, id),
        });
        delete this.handled[id];
      }
    }
    await this.#conn.put({
      path: this.#path,
      data: this as {},
    });

    this.#updated = false;
  }

  /**
   * Stop the interval to check for changes to meta
   */
  public stop() {
    this.#interval && clearInterval(this.#interval);
  }
}
