import Bluebird from 'bluebird'
import pointer from 'json-pointer'
import debug from 'debug'

// TODO: Should this lib be specific to oada client??
// prettier-ignore
import type { GETRequest } from '@oada/client'

import { TypeAssert } from '@oada/types'
import { Resource } from '@oada/types/oada/resource'
import { List, Link } from '@oada/types/oada/link/v1'
import { Change } from '@oada/types/oada/change/v2'
import { SocketResponse } from '@oada/client/dist/websocket'

import { Options, ItemState } from './Options'
import { Metadata } from './Metadata'

const info = debug('oada-list-lib:info')
const warn = debug('oada-list-lib:warn')
const trace = debug('oada-list-lib:trace')
const error = debug('oada-list-lib:error')

/**
 * @public
 */
export { Options, ItemState }

/**
 * @internal
 */
export type ConnI = Options<unknown>['conn'] & {
  // Make get less annoying
  get<T = unknown>(request: GETRequest): Promise<SocketResponse & { data: T }>
}

// Recursive version of Partial
type DeepPartial<T> = {
  [P in keyof T]?: DeepPartial<T[P]>
}

function assertNever (val: never, mesg?: string) {
  throw new Error(mesg ?? `Bad value: ${val}`)
}

/**
 * The main class of this library.
 * Watches an OADA list and calls various callbacks when appropriate.
 *
 * @public
 * @typeParam Item  The type of the items linked in the list
 * @see Options
 */
export class ListWatch<Item = unknown> {
  public readonly path
  public readonly tree
  public readonly name
  private resume
  private conn
  private id?: string
  // TODO: This explicit typing thing must be a TS bug?
  private assertItem: TypeAssert<Item>

  // _meta stuff
  private meta

  // Callbacks
  private onAddItem?
  private onChangeItem?
  private onItem?
  private onRemoveItem?
  private onDeleteList
  private getItemState

  constructor ({
    path,
    tree,
    name,
    resume = false,
    conn,
    persistInterval = 1000,
    // If no assert given, assume all items valid
    assertItem = _ => {},
    onAddItem,
    onChangeItem,
    onItem,
    onRemoveItem,
    onDeleteList = async () => {
      // TODO: Actually handle the list being deleted (redo watch?)
      error(`Unhandled delete of list ${path}`)
      process.exit()
    },
    // If no callback given, assume everything unknown is new
    getItemState = async (id: string) => {
      warn(`Assuming item ${id} is new`)
      return ItemState.New
    }
  }: Options<Item>) {
    this.path = path
    this.tree = tree
    this.name = name
    this.resume = resume
    this.conn = conn as ConnI
    this.assertItem = assertItem

    this.onAddItem = onAddItem
    this.onChangeItem = onChangeItem
    this.onItem = onItem
    this.onRemoveItem = onRemoveItem
    this.onDeleteList = onDeleteList
    this.getItemState = getItemState

    this.meta = new Metadata({
      // Don't persist metdata if service does not "resume"
      persistInterval: this.resume ? persistInterval : 0,
      conn: this.conn,
      path,
      name
    })
    this.initialize().catch(error)
  }

  /**
   * Force library to recheck all current list items
   * @see getItemState
   * @param all check even items we think were handled
   *
   * @todo Better name?
   */
  public async forceRecheck (all = false) {
    const { conn, path } = this

    const { data: list } = await conn.get<List>({ path })
    const items = Object.keys(list).filter(k => !k.match(/^_/))

    const { rev } = this.meta
    await Bluebird.map(items, async id => {
      try {
        if (!all && this.meta.handled[id]) {
          // We think this item is handled
          return
        }

        // Ask lib user for state of this item
        let state: ItemState
        if (!stateCBnoItem(this.getItemState)) {
          const { data: item } = await this.conn.get({
            path: `${path}/${id}`
          })
          this.assertItem(item)
          state = await this.getItemState(id, item)
        } else {
          state = await this.getItemState(id)
        }

        switch (state) {
          case ItemState.New:
            {
              const { data: item } = await this.conn.get<Resource>({
                path: `${path}/${id}`
              })
              await this.handleNewItem(list._rev + '', id, item)
            }
            break
          case ItemState.Modified:
            {
              const { data: item } = await this.conn.get({
                path: `${path}/${id}`
              })
              const change: Change = {
                resource_id: list[id]._id,
                path: '',
                // TODO: what is the type the change??
                type: 'merge',
                body: item as {}
              }
              await this.handleItemChange(id, change)
            }
            break
          case ItemState.Handled:
            info(`Recoding item ${id} as handled for ${path}`)
            // Mark handled for all callbacks?
            this.meta.handled = {
              [id]: { onAddItem: { rev }, onItem: { rev } }
            }
            break
          default:
            assertNever(state)
        }
      } catch (err) {
        error(err)
      }
    })
  }

  /**
   * Clean up metadata and unwatch list
   */
  public async stop () {
    await this.conn.unwatch(this.id!)
    await this.persistMeta()
    this.meta.stop()
  }

  /**
   * Persist relevant info to the _meta of the list.
   * This preserves it across restarts.
   */
  public async persistMeta () {
    await this.meta.persist()
  }

  private async handleNewItem (rev: string, id: string, item: Resource) {
    const { path } = this

    info(`Detected new item ${id} in ${path}, rev ${rev}`)
    const { _rev } = item
    this.assertItem(item)

    try {
      // Double check this is a new item?
      if (!this.meta.handled[id]?.onAddItem) {
        await this.onAddItem?.(item, id)
        this.meta.handled = {
          [id]: { onAddItem: { rev: _rev + '' } }
        }
      }
    } finally {
      // Call this even if previous callback errored

      // TODO: Do I need to make a fake "change" to the item
      // or will the feed have one??

      // Double check this item is actually newer than last time
      if (+_rev > +(this.meta.handled[id]?.onItem?.rev ?? 0)) {
        await this.onItem?.(item, id)
        this.meta.handled = { [id]: { onItem: { rev: _rev + '' } } }
      }
    }
  }

  private async handleItemChange (id: string, change: Change) {
    const { conn, path } = this
    const rev = change.body._rev as string

    // TODO: How best to handle change to a descendant of an item?
    info(`Detected change to item ${id} in ${path}, rev ${rev}`)

    const { _rev } = change
    try {
      await this.onChangeItem?.(change, id)
      this.meta.handled = {
        [id]: { onChangeItem: { rev: _rev + '' } }
      }
    } finally {
      if (this.onItem) {
        const { data: item } = await conn.get({
          path: `${path}/${id}`
        })
        this.assertItem(item)
        await this.onItem(item, id)
        this.meta.handled = { [id]: { onItem: { rev: _rev + '' } } }
      }
    }
  }

  private async handleListChange (
    list: DeepPartial<List>,
    type: Change['type']
  ): Promise<boolean> {
    const { path, conn } = this
    const rev = list._rev
    // Ignore _ keys of OADA
    const items = Object.keys(list).filter(k => !k.match(/^_/))

    switch (type) {
      case 'merge':
        await Bluebird.map(items, async id => {
          try {
            const lchange = list[id] as Partial<Link>

            // If there is an _id this is a new link in the list right?
            if (lchange._id) {
              const { data: item } = await conn.get<Resource>({
                path: `${path}/${id}`
              })
              await this.handleNewItem(rev + '', id, item)
            } else {
              // TODO: What should we do now??
              warn(`Ignoring non-link key added to list ${path}, rev ${rev}`)
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
        await Bluebird.map(items, async id => {
          try {
            const lchange = list[id]

            if (lchange === null) {
              info(`Detected removal of item ${id} from ${path}, rev ${rev}`)
              try {
                await this.onRemoveItem?.(id)
              } finally {
                // Mark for delete?
                this.meta.handled = { [id]: undefined }
              }
            } else {
              // TODO: What does this mean??
              warn(`Ignoring non-link key added to list ${path}, rev ${rev}`)
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

    return items.length > 0
  }

  /**
   * Do async stuff for initializing ourself since constructors are syncronous
   */
  private async initialize () {
    const { path, tree, conn } = this

    info(`Ensuring ${path} exists`)
    try {
      await conn.head({ path })
    } catch (err) {
      if (err.status === 403 || err.status === 404) {
        // Create it
        await conn.put({ path, tree, data: {} })
        trace(`Created ${path} because it did not exist`)
      } else {
        error(err)
        throw err
      }
    }

    // TODO: Clean up control flow to not need this?
    const currentItemsNew = !(await this.meta.init()) || !this.resume

    if (currentItemsNew) {
      await this.forceRecheck(true)
    }

    // Setup watch on the path
    const { rev } = this.meta
    this.id = await conn.watch({
      path,
      rev: this.resume ? this.meta.rev : rev,
      watchCallback: async ({ type, path: changePath, body, ...ctx }) => {
        if (body === null && type === 'delete' && changePath === '') {
          // The list itself was deleted
          warn(`Detected delete of list ${path}`)

          await this.onDeleteList()
          return
        }

        const rev = (body as Change['body'])._rev as string
        const [id, ...rest] = pointer.parse(changePath)

        trace(`Received change to ${path}, rev ${rev}`)
        let itemsFound = !!id

        try {
          // The actual change was to an item in the list (or a descendant)
          if (id) {
            // Make change start at item instead of the list
            const change: Change = {
              ...ctx,
              type,
              path: pointer.compile(rest),
              body: body as {}
            }

            await this.handleItemChange(id, change)
            return
          }

          // The change was to the list itself
          const list = body as DeepPartial<List>
          itemsFound = (await this.handleListChange(list, type)) || itemsFound
        } catch (err) {
          error(
            `Error processing change for ${id} at ${path}, rev ${rev}: %O`,
            err
          )
        } finally {
          // Need this check to prevent infinite loop
          if (itemsFound && this.resume) {
            // Only update last processed rev if we actually processed items
            this.meta!.rev = rev
          }
        }
      }
    })
  }
}

// Gross stuff to make TS handle optional second param for callback
type ItemStateNoItemCB = (id: string) => Promise<ItemState>
function stateCBnoItem<Item> (
  cb: ItemStateNoItemCB | NonNullable<Options<Item>['getItemState']>
): cb is ItemStateNoItemCB {
  return cb.length < 2
}
