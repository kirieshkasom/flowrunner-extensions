'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildAwsJsonRequest, parseJsonResponse, jsonRequest } = require('../src/aws-client')

test('buildAwsJsonRequest builds endpoint, headers, and serialized body', () => {
  const req = buildAwsJsonRequest({
    region: 'us-east-1',
    service: 'dynamodb',
    target: 'DynamoDB_20120810.GetItem',
    body: { TableName: 'T' },
    contentType: 'application/x-amz-json-1.0',
  })
  assert.equal(req.method, 'POST')
  assert.equal(req.url, 'https://dynamodb.us-east-1.amazonaws.com/')
  assert.equal(req.headers['content-type'], 'application/x-amz-json-1.0')
  assert.equal(req.headers['x-amz-target'], 'DynamoDB_20120810.GetItem')
  assert.equal(req.body, '{"TableName":"T"}')
})

test('parseJsonResponse returns parsed object on 2xx', () => {
  const out = parseJsonResponse({ statusCode: 200, body: '{"Item":{"id":{"S":"1"}}}' })
  assert.deepEqual(out, { Item: { id: { S: '1' } } })
})

test('parseJsonResponse returns {} for empty 2xx body', () => {
  assert.deepEqual(parseJsonResponse({ statusCode: 200, body: '' }), {})
})

test('parseJsonResponse throws with name derived from __type', () => {
  assert.throws(
    () => parseJsonResponse({ statusCode: 400, body: '{"__type":"com.amazon.coral.validate#ValidationException","message":"bad key"}' }),
    err => {
      assert.equal(err.name, 'ValidationException')
      assert.equal(err.message, 'bad key')
      assert.equal(err.statusCode, 400)

      return true
    },
  )
})

test('jsonRequest signs, sends via injected httpRequest, and parses', async () => {
  const calls = []
  const fakeHttp = async (method, url, headers, body) => {
    calls.push({ method, url, headers, body })

    return { statusCode: 200, headers: {}, body: '{"ok":true}' }
  }
  const out = await jsonRequest(
    { region: 'us-east-1', service: 'dynamodb', target: 'DynamoDB_20120810.PutItem', body: { TableName: 'T' }, contentType: 'application/x-amz-json-1.0' },
    { accessKeyId: 'AK', secretAccessKey: 'SK' },
    { httpRequest: fakeHttp },
  )
  assert.deepEqual(out, { ok: true })
  assert.equal(calls.length, 1)
  assert.match(calls[0].headers['authorization'], /^AWS4-HMAC-SHA256 /)
  assert.equal(calls[0].headers['x-amz-target'], 'DynamoDB_20120810.PutItem')
})
