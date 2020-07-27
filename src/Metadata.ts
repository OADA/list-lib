import assign from 'object-assign-deep'

import { ConnI } from '.'

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
          rev: string
        }
      }
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
  public static META_KEY = 'oada-list-lib'

  /**
   * The rev we left off on
   */
  private _rev = '0'
  /**
   * Track "error" items
   */
  private _handled: Items = {}

  private interval?
  /**
   * Flag to track whenever any state gets set
   */
  private _updated: boolean

  // Where to store state
  private conn
  private path

  get rev (): string {
    return this._rev
  }
  set rev (rev) {
    this._rev = rev
    this._updated = true
  }

  // TODO: IDK about this...
  set handled (items) {
    assign(this._handled, items)
    this._updated = true
  }

  get handled () {
    return this._handled
  }

  toJSON (): object {
    return {
      rev: this.rev,
      handled: this.handled
    }
  }

  constructor ({
    conn,
    path,
    name,
    persistInterval
  }: {
    /**
     * The path to the resource with which to associate this metadata
     */
    path: string
    name: string
    conn: ConnI
    persistInterval: number
  }) {
    this._updated = false

    this.conn = conn
    this.path = `${path}/_meta/${Metadata.META_KEY}/${name}`

    // Periodically persist state to _meta
    if (persistInterval) {
      this.interval = setInterval(() => this.persist(), persistInterval)
    }
  }

  /**
   * Initialize the connection to the meta resource
   * @returns whether existing metadata was found
   *
   * @TODO I hate needing to call init...
   */
  public async init (): Promise<boolean> {
    // Try to get our metadata about this list
    try {
      const { data } = await this.conn.get<Metadata>({
        path: this.path
      })
      Object.assign(this, data)
      return true
    } catch (err) {
      // Create our metadata
      const { headers } = await this.conn.post({
        path: '/resources/',
        data: this as {}
      })
      const id = headers['content-location'].replace(/^\//, '')
      await this.conn.put({ path: this.path, data: { _id: id } })
      return false
    }
  }

  /**
   * Persist relevant info to the _meta of the list.
   * This preserves it across restarts.
   */
  public async persist () {
    if (!this._updated || !this.interval) {
      // Avoid PUTing to _meta needlessly
      return
    }

    // Removing keys in OADA is annoying
    // TODO: Is it better to just DELETE the whole thing and then put?
    for (const id in this.handled) {
      if (!this.handled[id]) {
        await this.conn.delete({
          path: `${this.path}/${id}`
        })
        delete this.handled[id]
      }
    }
    await this.conn.put({
      path: this.path,
      data: this as {}
    })

    this._updated = false
  }

  /**
   * Stop the interval to check for changes to meta
   */
  public stop () {
    this.interval && clearInterval(this.interval)
  }
}
