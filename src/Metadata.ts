import { Conn } from '.'

/**
 * Persistent data we store in the _meta of the list
 */
export class Metadata {
  /**
   * The rev we left off on
   */
  private _rev

  private interval
  /**
   * Flag to track whenever any state gets set
   */
  private _updated: boolean

  // Where to store state
  private conn
  private path
  private name

  get rev (): string {
    return this._rev
  }
  set rev (rev: string) {
    this._rev = rev
    this._updated = true
  }

  constructor ({
    conn,
    path,
    name,
    rev,
    persistInterval
  }: {
    path: string
    name: string
    conn: Conn
    rev: string
    persistInterval: number
  }) {
    this._rev = rev
    this._updated = false

    this.conn = conn
    this.path = path
    this.name = name

    // Periodically persist state to _meta
    this.interval = setInterval(() => this.persist(), persistInterval)
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

    const meta = { rev: this._rev }
    await this.conn.put({
      path: this.path,
      data: {
        _meta: {
          'oada-list-lib': {
            [this.name]: meta
          }
        }
      }
    })

    this._updated = false
  }

  public stop () {
    clearInterval(this.interval)
  }
}

