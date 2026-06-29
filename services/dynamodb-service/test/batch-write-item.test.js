'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { DynamoDB } = require('../src/index')

test('batchWriteItem builds Put and Delete requests', async () => {
  const db = new DynamoDB({ accessKeyId: 'AK', secretAccessKey: 'SK' }, {})
  const calls = []
  db.sendJson = async (op, body) => {
    calls.push({ op, body })

    return {}
  }
  const out = await db.batchWriteItem('Users', [{ id: '1', n: 'a' }], [{ id: '2' }])
  assert.equal(calls[0].op, 'BatchWriteItem')
  const reqs = calls[0].body.RequestItems.Users
  assert.deepEqual(reqs[0], { PutRequest: { Item: { id: { S: '1' }, n: { S: 'a' } } } })
  assert.deepEqual(reqs[1], { DeleteRequest: { Key: { id: { S: '2' } } } })
  assert.equal(out.processed, 2)
  assert.deepEqual(out.unprocessed, [])
})

test('batchWriteItem retries UnprocessedItems and reports leftovers after max retries', async () => {
  const db = new DynamoDB({ accessKeyId: 'AK', secretAccessKey: 'SK' }, {})
  db._sleep = async () => {}
  db.sendJson = async () => ({ UnprocessedItems: { Users: [{ PutRequest: { Item: { id: { S: '1' } } } }] } })
  const out = await db.batchWriteItem('Users', [{ id: '1' }])
  assert.equal(out.processed, 0)
  assert.equal(out.unprocessed.length, 1)
  assert.deepEqual(out.unprocessed[0], { put: { id: '1' } })
})
