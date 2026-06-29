'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { marshall, unmarshall, marshallItem, unmarshallItem, isAttributeValue, marshallValues } = require('../src/marshall')

test('marshall primitive types', () => {
  assert.deepEqual(marshall('hi'), { S: 'hi' })
  assert.deepEqual(marshall(42), { N: '42' })
  assert.deepEqual(marshall(true), { BOOL: true })
  assert.deepEqual(marshall(null), { NULL: true })
})

test('marshall lists and maps recursively', () => {
  assert.deepEqual(marshall([1, 'a']), { L: [{ N: '1' }, { S: 'a' }] })
  assert.deepEqual(marshall({ a: 1, b: 'x' }), { M: { a: { N: '1' }, b: { S: 'x' } } })
})

test('marshall Buffer to B (base64)', () => {
  assert.deepEqual(marshall(Buffer.from('hi')), { B: Buffer.from('hi').toString('base64') })
})

test('unmarshall is the inverse of marshall', () => {
  const values = ['hi', 42, true, null, [1, 'a', false], { nested: { deep: [1, 2] } }]
  for (const v of values) {
    assert.deepEqual(unmarshall(marshall(v)), v)
  }
})

test('marshallItem / unmarshallItem operate on top-level maps', () => {
  const item = { id: '1', age: 30, tags: ['a', 'b'] }
  const marshalled = marshallItem(item)
  assert.deepEqual(marshalled, { id: { S: '1' }, age: { N: '30' }, tags: { L: [{ S: 'a' }, { S: 'b' }] } })
  assert.deepEqual(unmarshallItem(marshalled), item)
})

test('empty string round-trips', () => {
  assert.deepEqual(unmarshall(marshall('')), '')
})

test('isAttributeValue detects typed values', () => {
  assert.equal(isAttributeValue({ S: 'x' }), true)
  assert.equal(isAttributeValue({ N: '1' }), true)
  assert.equal(isAttributeValue({ foo: 'bar' }), false)
  assert.equal(isAttributeValue('plain'), false)
})

test('marshallValues marshals plain values but passes typed ones through', () => {
  assert.deepEqual(marshallValues({ ':a': 'x', ':b': 2 }), { ':a': { S: 'x' }, ':b': { N: '2' } })
  assert.deepEqual(marshallValues({ ':a': { S: 'raw' } }), { ':a': { S: 'raw' } })
})
