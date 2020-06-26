import test from 'ava'
import sinon from 'sinon'
import Bluebird from 'bluebird'

import { OADAClient, WatchRequest } from '@oada/client'

import { ListWatch } from './'

const conn = sinon.createStubInstance(OADAClient, {})

test.beforeEach(() => {
  sinon.reset()
})

test('it should WATCH given path', async t => {
  const path = '/bookmarks/foo/bar'

  new ListWatch({ path, conn })
  t.plan(1)

  // TODO: How to do this right in ava?
  await Bluebird.delay(5)

  t.assert(conn.watch.calledWithMatch({ path } as WatchRequest))
})
test('it should UNWATCH on stop()', async t => {
  const path = '/bookmarks/foo/bar'
  const id = 'foobar'

  conn.watch.resolves(id)

  const watch = new ListWatch({ path, conn })

  // TODO: How to do this right in ava?
  await Bluebird.delay(5)

  await watch.stop()

  t.is(conn.unwatch.callCount, 1)
  t.is(conn.unwatch.firstCall.args[0], id)
})
test.todo('it should reconnect WATCH')

test.todo('it should detect new item')
test.todo('it should detect modified item')
test.todo('it should detect removed item')
