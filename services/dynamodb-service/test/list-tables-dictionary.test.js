'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { DynamoDB } = require('../src/index')
const { encodeCursor } = require('../src/marshall')

test('listTablesDictionary maps table names to label/value items', async () => {
  const db = new DynamoDB({ accessKeyId: 'AK', secretAccessKey: 'SK' }, {})
  db.sendJson = async () => ({ TableNames: ['Users', 'Orders'] })
  const out = await db.listTablesDictionary({})
  assert.deepEqual(out.items, [
    { label: 'Users', value: 'Users' },
    { label: 'Orders', value: 'Orders' },
  ])
  assert.equal(out.cursor, null)
})

test('listTablesDictionary filters by search (case-insensitive)', async () => {
  const db = new DynamoDB({ accessKeyId: 'AK', secretAccessKey: 'SK' }, {})
  db.sendJson = async () => ({ TableNames: ['Users', 'Orders', 'UserEvents'] })
  const out = await db.listTablesDictionary({ search: 'user' })
  assert.deepEqual(out.items.map(i => i.value), ['Users', 'UserEvents'])
})

test('listTablesDictionary paginates with ExclusiveStartTableName and returns next cursor', async () => {
  const db = new DynamoDB({ accessKeyId: 'AK', secretAccessKey: 'SK' }, {})
  const calls = []
  db.sendJson = async (op, body) => {
    calls.push({ op, body })

    return { TableNames: ['Users'], LastEvaluatedTableName: 'Users' }
  }
  const out = await db.listTablesDictionary({ cursor: encodeCursor('Orders') })
  assert.equal(calls[0].body.ExclusiveStartTableName, 'Orders')
  assert.equal(out.cursor, encodeCursor('Users'))
})
