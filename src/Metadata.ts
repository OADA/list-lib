import { join } from 'path';

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
export interface Item {
  /**
   * The callback which ran on item
   */
  [callback: string]: {
    rev: string;
  };
}

/**
 * Record of successfully handled list items
 *
 * @internal
 */
export type Items = {
  /**
   * The list item(s) which ran
   *
   * Items can be nested
   */
  [key: string]: undefined | Item | Items;
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
  #rev?: string;

  // Where to store state
  #conn?;
  #path;
  #tree?: object;
  #timeout;
  // Init stuff?
  #done!: (err?: any) => void;
  #wait: Promise<unknown>;

  get rev(): string {
    return this.#rev + '';
  }
  set rev(rev) {
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
  async setHandled(path: string, item: Item | undefined) {
    if (item) {
      // Merge with current info

      const data: any = {};
      pointer.set(data, `/handled${path}`, item);

      await this.#conn?.put({
        path: this.#path,
        tree: this.#tree,
        data: data,
      });
    } else {
      // Unset info?
      await this.#conn?.delete({ path: join(this.#path, 'handled', path) });
    }
    //this.#updated = true;
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
    tree?: object;
    name: string;
    conn?: Conn;
  }) {
    this.#conn = conn;
    this.#path = join(path, '_meta', Metadata.META_KEY, name);
    this.#tree = clone(tree);
    if (this.#tree) {
      // Replicate list tree under handled key?
      const listTree = clone(pointer.get(this.#tree, path));
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
    //console.dir(this.#tree, { depth: null });
    this.#wait = Bluebird.fromCallback((done) => {
      this.#done = done;
    });
    // TODO: Use timeouts for all updates?
    this.#timeout = setTimeout(async () => {
      await this.#wait;
      trace('Recording rev %d', this.#rev);
      this.#wait = Promise.resolve(
        this.#conn?.put({
          path: this.#path,
          tree: this.#tree,
          data: { rev: this.#rev } as any,
        })
      );
    }, 100);
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
      } catch (err: unknown) {
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
          data: { _id: location.substring(1) },
        });
        await this.#conn.put({
          path: this.#path,
          tree: this.#tree,
          data: {
            rev: this.#rev,
          } as any,
        });
        this.#done();
        return false;
      }
    } catch (err: unknown) {
      this.#done(err);
      throw err;
    }
  }
}
