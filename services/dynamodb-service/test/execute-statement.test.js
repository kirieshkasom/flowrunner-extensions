'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { DynamoDB } = require('../src/index')

test('executeStatement marshalls parameters and unmarshalls items', async () => {
  const db = new DynamoDB({ accessKeyId: 'AK', secretAccessKey: 'SK' }, {})
  const calls = []
  db.sendJson = async (op, body) => {
    calls.push({ op, body })

    return { Items: [{ id: { S: '1' } }], NextToken: 'TOK' }
  }
  const out = await db.executeStatement('SELECT * FROM Users WHERE id = ?', ['1'])
  assert.equal(calls[0].op, 'ExecuteStatement')
  assert.equal(calls[0].body.Statement, 'SELECT * FROM Users WHERE id = ?')
  assert.deepEqual(calls[0].body.Parameters, [{ S: '1' }])
  assert.deepEqual(out.items, [{ id: '1' }])
  assert.equal(out.cursor, 'TOK')
})

test('executeStatement passes NextToken from incoming cursor', async () => {
  const db = new DynamoDB({ accessKeyId: 'AK', secretAccessKey: 'SK' }, {})
  const calls = []
  db.sendJson = async (op, body) => {
    calls.push({ op, body })

    return { Items: [] }
  }
  const out = await db.executeStatement('SELECT * FROM Users', null, false, 'PREV')
  assert.equal(calls[0].body.NextToken, 'PREV')
  assert.equal(out.cursor, null)
})
