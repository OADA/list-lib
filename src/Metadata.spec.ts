import test from 'ava'
import sinon from 'sinon'
import Bluebird from 'bluebird'
import { OADAClient } from '@oada/client'

import { Change } from '@oada/types/oada/change/v2'
import { ListWatch } from './'

const name = 'oada-list-lib-test'

test('should resume from last rev', async t => {
  const conn = sinon.createStubInstance(OADAClient, {})
  // A Change from adding an item to a list
  // TODO: Better way to do this test without actually runnig oada?
  const path = '/bookmarks'
  const rev = '766'

  // @ts-ignore
  conn.get.resolves({ data: { rev } })

  const opts = {
    path,
    name,
    conn,
    // Create spies to see which callbacks run
    onAddItem: sinon.spy(),
    onChangeItem: sinon.spy(),
    onItem: sinon.spy(),
    onRemoveItem: sinon.spy()
  }

  new ListWatch(opts)
  // TODO: How to do this right in ava?
  await Bluebird.delay(5)

  t.is(conn.watch.firstCall.args[0].rev, rev)
})
test('should persist rev to _meta', async t => {
  const conn = sinon.createStubInstance(OADAClient, {})
  // A Change from adding an item to a list
  // TODO: Better way to do this test without actually runnig oada?
  const path = '/bookmarks'
  const change: Change[] = [
    {
      resource_id: 'resources/default:resources_bookmarks_321',
      path: '',
      body: {
        '1e6XB0Hy7XJICbi3nMzCtl4QLpC': {
          _id: ''
        },
        _meta: {
          modifiedBy: 'users/default:users_sam_321',
          modified: 1593642877.725,
          _rev: '4'
        },
        _rev: '4'
      },
      type: 'merge'
    }
  ]

  const opts = {
    path,
    name,
    conn,
    persistInterval: 10,
    // Create spies to see which callbacks run
    onAddItem: sinon.spy(),
    onChangeItem: sinon.spy(),
    onItem: sinon.spy(),
    onRemoveItem: sinon.spy()
  }

  // @ts-ignore
  conn.get.resolves({ data: {} })

  new ListWatch(opts)
  // TODO: How to do this right in ava?
  await Bluebird.delay(5)

  const cb = conn.watch.firstCall.args[0].watchCallback as (
    change: Change
  ) => Promise<void>
  await Bluebird.map(change, c => cb(c))

  await Bluebird.delay(100)

  t.is(
    // @ts-ignore
    conn.put.firstCall.args[0].data?._meta?.['oada-list-lib']?.[name]?.rev,
    '4'
  )
})
