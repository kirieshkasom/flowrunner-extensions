'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { DynamoDB } = require('../src/index')

test('describeTable returns normalized metadata', async () => {
  const db = new DynamoDB({ accessKeyId: 'AK', secretAccessKey: 'SK' }, {})
  const calls = []
  db.sendJson = async (op, body) => {
    calls.push({ op, body })

    return {
      Table: {
        TableName: 'Users',
        TableStatus: 'ACTIVE',
        ItemCount: 42,
        TableSizeBytes: 1024,
        KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
        AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
        GlobalSecondaryIndexes: [{ IndexName: 'gsi1' }],
      },
    }
  }
  const out = await db.describeTable('Users')
  assert.equal(calls[0].op, 'DescribeTable')
  assert.deepEqual(calls[0].body, { TableName: 'Users' })
  assert.equal(out.tableName, 'Users')
  assert.equal(out.status, 'ACTIVE')
  assert.equal(out.itemCount, 42)
  assert.equal(out.sizeBytes, 1024)
  assert.deepEqual(out.keySchema, [{ AttributeName: 'id', KeyType: 'HASH' }])
  assert.deepEqual(out.attributeDefinitions, [{ AttributeName: 'id', AttributeType: 'S' }])
  assert.deepEqual(out.indexes.global, [{ IndexName: 'gsi1' }])
  assert.deepEqual(out.indexes.local, [])
})
