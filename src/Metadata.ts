import { ConnI } from '.'

/**
 * Persistent data we store in the _meta of the list
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

  private interval
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
  set rev (rev: string) {
    this._rev = rev
    this._updated = true
  }

  toJSON (): object {
    return {
      rev: this.rev
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
    this.interval = setInterval(() => this.persist(), persistInterval)
  }

  // TODO: I hate needing to call init...
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
    if (!this._updated) {
      // Avoid PUTing to _meta needlessly
      return
    }

    await this.conn.put({
      path: this.path,
      data: this as {}
    })

    this._updated = false
  }

  public stop () {
    clearInterval(this.interval)
  }
}
