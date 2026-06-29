'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { DynamoDB } = require('../src/index')

test('scan sends optional filter and unmarshalls items', async () => {
  const db = new DynamoDB({ accessKeyId: 'AK', secretAccessKey: 'SK' }, {})
  const calls = []
  db.sendJson = async (op, body) => {
    calls.push({ op, body })

    return { Items: [{ id: { S: '1' } }], Count: 1 }
  }
  const out = await db.scan('Users', '#a = :v', { ':v': true }, { '#a': 'active' })
  assert.equal(calls[0].op, 'Scan')
  assert.equal(calls[0].body.FilterExpression, '#a = :v')
  assert.deepEqual(calls[0].body.ExpressionAttributeValues, { ':v': { BOOL: true } })
  assert.deepEqual(calls[0].body.ExpressionAttributeNames, { '#a': 'active' })
  assert.deepEqual(out.items, [{ id: '1' }])
  assert.equal(out.count, 1)
})

test('scan with no filter sends only TableName', async () => {
  const db = new DynamoDB({ accessKeyId: 'AK', secretAccessKey: 'SK' }, {})
  const calls = []
  db.sendJson = async (op, body) => {
    calls.push({ op, body })

    return { Items: [], Count: 0 }
  }
  await db.scan('Users')
  assert.deepEqual(Object.keys(calls[0].body), ['TableName'])
})
