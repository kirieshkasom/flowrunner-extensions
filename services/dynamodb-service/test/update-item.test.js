'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { DynamoDB } = require('../src/index')

function stubbed(response = {}) {
  const db = new DynamoDB({ accessKeyId: 'AK', secretAccessKey: 'SK' }, {})
  const calls = []
  db.sendJson = async (op, body) => {
    calls.push({ op, body })

    return response
  }

  return { db, calls }
}

test('updateItem builds a SET expression from the updates object', async () => {
  const { db, calls } = stubbed({ Attributes: { id: { S: '1' }, age: { N: '31' } } })
  const out = await db.updateItem('Users', { id: '1' }, { age: 31 })
  assert.equal(calls[0].op, 'UpdateItem')
  assert.deepEqual(calls[0].body.Key, { id: { S: '1' } })
  assert.equal(calls[0].body.UpdateExpression, 'SET #n0 = :v0')
  assert.deepEqual(calls[0].body.ExpressionAttributeNames, { '#n0': 'age' })
  assert.deepEqual(calls[0].body.ExpressionAttributeValues, { ':v0': { N: '31' } })
  assert.equal(calls[0].body.ReturnValues, 'ALL_NEW')
  assert.deepEqual(out.attributes, { id: '1', age: 31 })
})

test('updateItem uses the raw updateExpression escape hatch when provided', async () => {
  const { db, calls } = stubbed({ Attributes: {} })
  await db.updateItem('Users', { id: '1' }, null, 'ADD visits :one', { ':one': 1 }, { '#v': 'visits' }, 'attribute_exists(id)')
  assert.equal(calls[0].body.UpdateExpression, 'ADD visits :one')
  assert.deepEqual(calls[0].body.ExpressionAttributeValues, { ':one': { N: '1' } })
  assert.deepEqual(calls[0].body.ExpressionAttributeNames, { '#v': 'visits' })
  assert.equal(calls[0].body.ConditionExpression, 'attribute_exists(id)')
})

test('updateItem returns null attributes when DynamoDB response has no Attributes key', async () => {
  const { db } = stubbed({})
  const out = await db.updateItem('Users', { id: '1' }, { age: 5 }, null, null, null, null, 'NONE')
  assert.deepEqual(out, { attributes: null })
})
