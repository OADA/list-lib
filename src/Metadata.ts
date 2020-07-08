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
    rev,
    persistInterval
  }: {
    path: string
    conn: Conn
    rev: string
    persistInterval: number
  }) {
    this._rev = rev
    this._updated = false

    this.conn = conn
    this.path = path

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

    await this.conn.put({
      path: this.path,
      data: {
        rev: this._rev
      }
    })

    this._updated = false
  }

  public stop () {
    clearInterval(this.interval)
  }
}

