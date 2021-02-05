import { join } from 'path';

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
  #rev = '0';

  // Where to store state
  #conn;
  #path;
  #tree?: object;
  #timeout;
  #wait: Promise<unknown>;

  get rev(): string {
    return this.#rev;
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
      await this.#conn.put({
        path: join(this.#path, 'handled', path),
        tree: this.#tree,
        data: item,
      });
    } else {
      // Unset info?
      await this.#conn.delete({ path: join(this.#path, 'handled', path) });
    }
    //this.#updated = true;
  }

  /**
   * Get handled info of a list item
   *
   * @param path JSON pointer of list item
   */
  async handled(path: string): Promise<Item | undefined> {
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
    tree: object | undefined;
    name: string;
    conn: Conn;
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
    }
    this.#wait = Promise.resolve();
    // TODO: Use timeouts for all updates?
    this.#timeout = setTimeout(async () => {
      await this.#wait;
      this.#wait = this.#conn.put({
        path: this.#path,
        // TODO: Figure out why tree here causes If-Match error?
        //tree: this.#tree,
        data: { rev: this.#rev },
      });
    }, 100);
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
      await this.#conn.head({
        path: this.#path,
      });
      return true;
    } catch (err: unknown) {
      // Create our metadata?
      await this.#conn.put({ path: this.#path, tree: this.#tree, data: {} });
      return false;
    }
  }
}
