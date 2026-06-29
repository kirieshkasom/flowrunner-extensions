'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { DynamoDB } = require('../src/index')

function stubbed() {
  const db = new DynamoDB({ accessKeyId: 'AK', secretAccessKey: 'SK' }, {})
  const calls = []
  db.sendJson = async (op, body) => {
    calls.push({ op, body })

    return {}
  }

  return { db, calls }
}

test('putItem marshalls the item and sends PutItem', async () => {
  const { db, calls } = stubbed()
  const out = await db.putItem('Users', { id: '1', age: 30 })
  assert.equal(calls[0].op, 'PutItem')
  assert.equal(calls[0].body.TableName, 'Users')
  assert.deepEqual(calls[0].body.Item, { id: { S: '1' }, age: { N: '30' } })
  assert.deepEqual(out.item, { id: '1', age: 30 })
})

test('putItem passes conditionExpression and marshalled values', async () => {
  const { db, calls } = stubbed()
  await db.putItem('Users', { id: '1' }, 'attribute_not_exists(id)', { ':x': 5 })
  assert.equal(calls[0].body.ConditionExpression, 'attribute_not_exists(id)')
  assert.deepEqual(calls[0].body.ExpressionAttributeValues, { ':x': { N: '5' } })
})

test('putItem returns unmarshalled old values when returnValues=ALL_OLD', async () => {
  const db = new DynamoDB({ accessKeyId: 'AK', secretAccessKey: 'SK' }, {})
  db.sendJson = async () => ({ Attributes: { id: { S: '1' }, age: { N: '29' } } })
  const out = await db.putItem('Users', { id: '1', age: 30 }, null, null, 'ALL_OLD')
  assert.deepEqual(out.oldItem, { id: '1', age: 29 })
})
