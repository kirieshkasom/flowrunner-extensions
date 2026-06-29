'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { DynamoDB } = require('../src/index')

test('getItem marshalls the key and unmarshalls the result', async () => {
  const db = new DynamoDB({ accessKeyId: 'AK', secretAccessKey: 'SK' }, {})
  const calls = []
  db.sendJson = async (op, body) => {
    calls.push({ op, body })

    return { Item: { id: { S: '1' }, age: { N: '30' } } }
  }
  const out = await db.getItem('Users', { id: '1' }, true, 'id, age')
  assert.equal(calls[0].op, 'GetItem')
  assert.deepEqual(calls[0].body.Key, { id: { S: '1' } })
  assert.equal(calls[0].body.ConsistentRead, true)
  assert.equal(calls[0].body.ProjectionExpression, 'id, age')
  assert.deepEqual(out.item, { id: '1', age: 30 })
})

test('getItem returns {item:null} when no item found', async () => {
  const db = new DynamoDB({ accessKeyId: 'AK', secretAccessKey: 'SK' }, {})
  db.sendJson = async () => ({})
  const out = await db.getItem('Users', { id: 'missing' })
  assert.deepEqual(out, { item: null })
})
