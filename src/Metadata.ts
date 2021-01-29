import { join } from 'path';

import assign from 'object-assign-deep';
import pointer from 'json-pointer';

import { Conn } from './Options';
import { GetResponse } from '.';

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

function moveTree(tree: object, oldRoot: string, newRoot: string): object {
  const out = {};
  pointer.set(out, newRoot, pointer.get(tree, oldRoot));
  return out;
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
  public static readonly META_KEY = 'oada-list-lib';

  /**
   * The rev we left off on
   */
  #rev = '0';
  /**
   * Track "error" items
   */
  #handled: Items = {};

  // Where to store state
  #conn;
  #path;
  #tree;

  get rev(): string {
    return this.#rev;
  }
  set rev(rev) {
    trace(`Updating local rev to ${rev}`);
    this.#rev = rev;
    //this.#updated = true;
    this.#conn.put({
      path: `${this.#path}/rev`,
      data: rev,
    });
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
      const old = pointer.get(this.#handled, path);
      await this.#conn.put({
        path: `${this.#path}/handled/${path}`,
        data: item,
      });
      pointer.set(this.#handled, path, assign(old, item));
    } else {
      // Unset info?
      await this.#conn.delete({ path: `${this.#path}/handled/${path}` });
      pointer.set(this.#handled, path, undefined);
    }
    //this.#updated = true;
  }

  /**
   * Get handled info of a list item
   *
   * @param path JSON pointer of list item
   */
  handled(path: string): Item | undefined {
    return pointer.get(this.#handled, path);
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
    // Replicate list tree under handled key?
    this.#tree = tree && moveTree(tree, join(path, 'handled'), this.#path);
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
      await this.#conn.put({
        path: this.#path,
        tree: this.#tree,
        data: { _id: id },
      });
      return false;
    }
  }
}
