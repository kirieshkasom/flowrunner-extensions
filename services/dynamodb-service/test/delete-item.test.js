'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { DynamoDB } = require('../src/index')

test('deleteItem marshalls the key and sends DeleteItem', async () => {
  const db = new DynamoDB({ accessKeyId: 'AK', secretAccessKey: 'SK' }, {})
  const calls = []
  db.sendJson = async (op, body) => {
    calls.push({ op, body })

    return {}
  }
  const out = await db.deleteItem('Users', { id: '1' })
  assert.equal(calls[0].op, 'DeleteItem')
  assert.deepEqual(calls[0].body.Key, { id: { S: '1' } })
  assert.deepEqual(out, { deleted: null })
})

test('deleteItem returns unmarshalled deleted item when ALL_OLD', async () => {
  const db = new DynamoDB({ accessKeyId: 'AK', secretAccessKey: 'SK' }, {})
  db.sendJson = async () => ({ Attributes: { id: { S: '1' }, name: { S: 'Ada' } } })
  const out = await db.deleteItem('Users', { id: '1' }, 'attribute_exists(id)', 'ALL_OLD')
  assert.deepEqual(out.deleted, { id: '1', name: 'Ada' })
})
