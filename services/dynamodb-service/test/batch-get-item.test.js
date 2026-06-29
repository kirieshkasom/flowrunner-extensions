'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { DynamoDB } = require('../src/index')

test('batchGetItem marshalls keys and returns unmarshalled items', async () => {
  const db = new DynamoDB({ accessKeyId: 'AK', secretAccessKey: 'SK' }, {})
  const calls = []
  db.sendJson = async (op, body) => {
    calls.push({ op, body })

    return { Responses: { Users: [{ id: { S: '1' } }, { id: { S: '2' } }] } }
  }
  const out = await db.batchGetItem('Users', [{ id: '1' }, { id: '2' }])
  assert.equal(calls[0].op, 'BatchGetItem')
  assert.deepEqual(calls[0].body.RequestItems.Users.Keys, [{ id: { S: '1' } }, { id: { S: '2' } }])
  assert.deepEqual(out.items, [{ id: '1' }, { id: '2' }])
})

test('batchGetItem retries UnprocessedKeys until drained', async () => {
  const db = new DynamoDB({ accessKeyId: 'AK', secretAccessKey: 'SK' }, {})
  db._sleep = async () => {}
  let call = 0
  db.sendJson = async () => {
    call++
    if (call === 1) {
      return { Responses: { Users: [{ id: { S: '1' } }] }, UnprocessedKeys: { Users: { Keys: [{ id: { S: '2' } }] } } }
    }

    return { Responses: { Users: [{ id: { S: '2' } }] } }
  }
  const out = await db.batchGetItem('Users', [{ id: '1' }, { id: '2' }])
  assert.equal(call, 2)
  assert.deepEqual(out.items, [{ id: '1' }, { id: '2' }])
})
