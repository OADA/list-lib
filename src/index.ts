import Bluebird from 'bluebird'
import pointer from 'json-pointer'
import debug from 'debug'

// TODO: Should this lib be specific to oada client??
// prettier-ignore
import { OADAClient, GETRequest } from '@oada/client'

import { TypeAssert } from '@oada/types'
import { List, Link } from '@oada/types/oada/link/v1'
import { Change } from '@oada/types/oada/change/v2'
import { SocketResponse } from '@oada/client/dist/websocket'

import { Metadata } from './Metadata'

const info = debug('oada-list-lib:info')
const warn = debug('oada-list-lib:warn')
const trace = debug('oada-list-lib:trace')
const error = debug('oada-list-lib:error')

// Accept anything with same method signatures as OADAClient
export type Conn = {
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
  /**
   * A persistent name/id for this instance (can just be random string)
   *
   * It is used to prevent collisions in storage library metadata.
   */
  name: string
  /**
   * An OADAClient instance (or something with the same API)
   */
  conn: Conn

  /**
   * How frequently to save state to OADA (in ms)
   *
   * @default 1000
   */
  persistInterval?: number

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
  public path
  public name
  private conn
  private id?: string
  // TODO: This explicit typing thing must be a TS bug?
  private assertItem: TypeAssert<Item>

  // _meta stuff
  private meta?: Metadata

  // Callback
  private onAddItem?
  private onChangeItem?
  private onItem?
  private onRemoveItem?

  constructor ({
    path,
    name,
    conn,
    persistInterval = 1000,
    /**
     * If no assert given, assume all items valid
     */
    assertItem = () => {},
    onAddItem,
    onChangeItem,
    onItem,
    onRemoveItem
  }: Options<Item>) {
    this.path = path
    this.name = name
    this.conn = conn as Conn & {
      // Make get less annoying
      get<T = unknown>(
        request: GETRequest
      ): Promise<SocketResponse & { data: T }>
    }
    this.assertItem = assertItem

    this.onAddItem = onAddItem
    this.onChangeItem = onChangeItem
    this.onItem = onItem
    this.onRemoveItem = onRemoveItem

    this.initialize(persistInterval)
  }

  public async stop () {
    await this.conn.unwatch(this.id!)
    await this.persistMeta()
    this.meta?.stop()
  }

  /**
   * Persist relevant info to the _meta of the list.
   * This preserves it across restarts.
   */
  public async persistMeta () {
    await this.meta?.persist()
  }

  private async initialize (persistInterval: number) {
    const { path, name, conn } = this

    info(`Ensuring ${path} exists`)
    try {
      // Try to get our metadata about this list
      const {
        data: { rev }
      } = await conn.get<Partial<Metadata>>({
        // TODO: Where in _meta to keep stuff?
        path: `${path}/_meta/oada-list-lib/${name}`
      })
      this.meta = new Metadata({
        persistInterval,
        rev: rev!,
        conn,
        path: `${path}/_meta/oada-list-lib/${name}`
      })
    } catch (err) {
      this.meta = new Metadata({
        persistInterval,
        rev: '',
        conn,
        path: `${path}/_meta/oada-list-lib/${name}`
      })
      // Create the list?
      this.meta.rev = '0'
      await this.meta.persist()
    }

    // Setup watch on the path
    // TODO: Handle reestabnlishing watch and updating meta
    // when path is deleted etc.
    this.id = await conn.watch({
      path,
      rev: this.meta.rev,
      watchCallback: async ({ type, path: changePath, body, ...ctx }) => {
        if (body === null && type === 'delete' && changePath === '') {
          // The list itself was deleted
          warn(`Detected delete of list ${path}`)

          // TODO: Actually handle the list being deleted (redo watch?)
          return
        }

        const rev = (body as Change['body'])._rev as string
        const [id, ...rest] = pointer.parse(changePath)

        trace(`Received change to ${path}, rev ${rev}`)
        let itemsFound = !!id

        try {
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
                await this.onChangeItem?.(change, id)
                if (this.onItem) {
                  const { data: item } = await conn.get({
                    path: `${path}/${id}`
                  })
                  this.assertItem(item)
                  await this.onItem(item, id)
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
          itemsFound ||= items.length > 0

          switch (type) {
            case 'merge':
              await Bluebird.map(items, async id => {
                try {
                  const lchange = list[id] as Partial<Link>

                  // If there is an _id this is a new link in the list right?
                  if (lchange._id) {
                    info(`Detected new item ${id} in ${path}, rev ${rev}`)
                    const { data: item } = await conn.get({
                      path: `${path}/${id}`
                    })
                    this.assertItem(item)
                    await this.onAddItem?.(item, id)
                    await this.onItem?.(item, id)
                  } else {
                    // TODO: What should we do now??
                    warn(
                      `Ignoring non-link key added to list ${path}, rev ${rev}`
                    )
                  }
                } catch (err) {
                  // TODO: Keep track of failed items in meta or something
                  // Log error with this item but continue map over other items
                  error(
                    `Error processing change for ${id} at ${path}, rev ${rev}: %O`,
                    err
                  )
                }
              })
              break

            case 'delete':
              await Bluebird.map(items, async id => {
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
                  // TODO: Keep track of failed items in meta or something
                  // Log error with this item but continue map over other items
                  error(
                    `Error processing change for ${id} at ${path}, rev ${rev}: %O`,
                    err
                  )
                }
              })
              break
          }
        } catch (err) {
          // TODO: Keep track of failed items in meta or something
          error(
            `Error processing change for ${id} at ${path}, rev ${rev}: %O`,
            err
          )
        } finally {
          // Need this check to prevent infinite loop
          if (itemsFound) {
            // Only update last processed rev if we actually processed items
            this.meta!.rev = rev
          }
        }
      }
    })
  }
}



















