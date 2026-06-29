'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { DynamoDB } = require('../src/index')
const { encodeCursor } = require('../src/marshall')

test('query sends KeyConditionExpression with marshalled values and unmarshalls items', async () => {
  const db = new DynamoDB({ accessKeyId: 'AK', secretAccessKey: 'SK' }, {})
  const calls = []
  db.sendJson = async (op, body) => {
    calls.push({ op, body })

    return { Items: [{ id: { S: '1' } }, { id: { S: '2' } }], Count: 2 }
  }
  const out = await db.query('Users', 'pk = :p', { ':p': 'tenant1' })
  assert.equal(calls[0].op, 'Query')
  assert.equal(calls[0].body.KeyConditionExpression, 'pk = :p')
  assert.deepEqual(calls[0].body.ExpressionAttributeValues, { ':p': { S: 'tenant1' } })
  assert.deepEqual(out.items, [{ id: '1' }, { id: '2' }])
  assert.equal(out.count, 2)
  assert.equal(out.cursor, null)
})

test('query decodes incoming cursor and encodes LastEvaluatedKey', async () => {
  const db = new DynamoDB({ accessKeyId: 'AK', secretAccessKey: 'SK' }, {})
  const startKey = { id: { S: '10' } }
  const calls = []
  db.sendJson = async (op, body) => {
    calls.push({ op, body })

    return { Items: [], Count: 0, LastEvaluatedKey: { id: { S: '20' } } }
  }
  const out = await db.query('Users', 'pk = :p', { ':p': 'a' }, null, null, null, 50, false, null, encodeCursor(startKey))
  assert.deepEqual(calls[0].body.ExclusiveStartKey, startKey)
  assert.equal(calls[0].body.Limit, 50)
  assert.equal(calls[0].body.ScanIndexForward, false)
  assert.equal(out.cursor, encodeCursor({ id: { S: '20' } }))
})
