import Bluebird from 'bluebird'
import pointer from 'json-pointer'
import debug from 'debug'

// TODO: Should this lib be specific to oada client??
// prettier-ignore
import { OADAClient } from '@oada/client'

import { TypeAssert } from '@oada/types'
import { List, Link } from '@oada/types/oada/link/v1'
import { Change } from '@oada/types/oada/change/v2'

const info = debug('oada-list-lib:info')
const warn = debug('oada-list-lib:warn')
const error = debug('oada-list-lib:error')

// Accept anything with same method signatures as OADAClient
type Conn = {
  [P in keyof OADAClient]: OADAClient[P] extends Function
    ? OADAClient[P]
    : never
}

// Recursive version of Partial
type DeepPartial<T> = {
  [P in keyof T]?: DeepPartial<T[P]>
}

type Options<Item> = {
  /**
   * Path to an OADA list to watch for items
   */
  path: string
  conn: Conn

  /**
   * Function to assert if an object is an Item.
   * Items which fail this check will be ignored.
   */
  assertItem?: TypeAssert<Item>

  /**
   * Called when a new item is added to the list
   */
  onAddItem?: (item: Item, id: string) => Promise<void>
  /**
   * Called when an existing item is modified in the list
   */
  onChangeItem?: (change: Change, id: string) => Promise<void>
  /**
   * Called when an item is added or changed
   */
  onItem?: (item: Item, id: string) => Promise<void>
  /**
   * Called when an item is removed from the list
   */
  onRemoveItem?: (id: string) => Promise<void>
}

export class ListWatch<Item = unknown> {
  public path: string
  private conn: Conn
  private id: string | null = null
  private assertItem: TypeAssert<Item>

  private onAddItem?: Options<Item>['onAddItem']
  private onChangeItem?: Options<Item>['onChangeItem']
  private onItem?: Options<Item>['onItem']
  private onRemoveItem?: Options<Item>['onRemoveItem']

  constructor ({
    path,
    conn,
    /**
     * If no assert given, assume all items valid
     */
    assertItem = () => {},
    onAddItem,
    onRemoveItem
  }: Options<Item>) {
    this.path = path
    this.conn = conn
    this.assertItem = assertItem

    this.onAddItem = onAddItem
    this.onRemoveItem = onRemoveItem

    this.initialize()
  }

  public async stop () {
    this.id && (await this.conn.unwatch(this.id))
  }

  private async initialize () {
    const { path, conn } = this

    info(`Ensuring ${path} exists`)
    // TODO: Only PUT if it does not already exist
    await conn.put({ path, data: {} })

    // TODO: How to handle remembering where we left off?

    // Setup watch on the path
    // TODO: Handle reestabnlishing watch when path is deleted etc.
    this.id = await conn.watch({
      path,
      watchCallback: async ({ type, path: changePath, body, ...ctx }) => {
        const rev = (body as Change['body'])._rev
        const [id, ...rest] = pointer.parse(changePath)

        // The actual change was to an item in the list (or a descendant)
        if (id) {
          switch (type) {
            case 'merge':
              // TODO: How best to handle change to a descendant of an item?
              info(`Detected change to item ${id} in ${path}, rev ${rev}`)
              const change: Change = {
                ...ctx,
                type,
                path: pointer.compile(rest),
                body: body as {}
              }
              this.onChangeItem?.(change, id)
              if (this.onItem) {
                const { data: item } = await conn.get({
                  path: `${path}/${id}`
                })
                this.assertItem(item)
                this.onItem(item, id)
              }
              break

            case 'delete':
              // TODO: What would this mean??
              break
          }

          return
        }

        // The change was to the list itself
        const list = body as DeepPartial<List>
        // Ignore _ keys of OADA
        const items = Object.keys(list).filter(k => !k.match(/^_/))

        switch (type) {
          case 'merge':
            Bluebird.map(items, async id => {
              try {
                const lchange = list[id] as Partial<Link>

                // If there is an _id this is a new link in the list right?
                if (lchange._id) {
                  info(`Detected new item ${id} in ${path}, rev ${rev}`)
                  const { data: item } = await conn.get({
                    path: `${path}/${id}`
                  })
                  this.assertItem(item)
                  this.onAddItem?.(item, id)
                  this.onItem?.(item, id)
                } else {
                  // TODO: What should we do now??
                  warn(
                    `Ignoring non-link key added to list ${path}, rev ${rev}`
                  )
                }
              } catch (err) {
                // Log error with this item but continue map over other items
                error(
                  `Error processing change for ${id} at ${path}, rev ${rev}: %O`,
                  err
                )
              }
            })
            break

          case 'delete':
            Bluebird.map(items, async id => {
              try {
                const lchange = list[id]

                if (lchange === null) {
                  info(
                    `Detected removal of item ${id} from ${path}, rev ${rev}`
                  )
                  this.onRemoveItem?.(id)
                } else {
                  // TODO: What does this mean??
                  warn(
                    `Ignoring non-link key added to list ${path}, rev ${rev}`
                  )
                }
              } catch (err) {
                // Log error with this item but continue map over other items
                error(
                  `Error processing change for ${id} at ${path}, rev ${rev}: %O`,
                  err
                )
              }
            })
            break
        }
      }
    })
  }
}
