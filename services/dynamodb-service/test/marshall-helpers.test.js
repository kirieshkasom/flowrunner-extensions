'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildUpdateExpression, encodeCursor, decodeCursor, chunk } = require('../src/marshall')

test('buildUpdateExpression builds a SET clause with aliased names and marshalled values', () => {
  const out = buildUpdateExpression({ age: 31, status: 'active' })
  assert.equal(out.UpdateExpression, 'SET #n0 = :v0, #n1 = :v1')
  assert.deepEqual(out.ExpressionAttributeNames, { '#n0': 'age', '#n1': 'status' })
  assert.deepEqual(out.ExpressionAttributeValues, { ':v0': { N: '31' }, ':v1': { S: 'active' } })
})

test('buildUpdateExpression throws on empty updates', () => {
  assert.throws(() => buildUpdateExpression({}), /at least one/i)
})

test('encodeCursor/decodeCursor round-trip an object and a string', () => {
  const key = { id: { S: '1' }, sk: { N: '5' } }
  assert.deepEqual(decodeCursor(encodeCursor(key)), key)
  assert.equal(decodeCursor(encodeCursor('TableName')), 'TableName')
})

test('chunk splits arrays into fixed-size groups', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  assert.deepEqual(chunk([], 2), [])
})
