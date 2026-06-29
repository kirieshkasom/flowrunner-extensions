'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { DynamoDB } = require('../src/index')

test('constructor sets region and a credential provider', () => {
  const db = new DynamoDB({ region: 'eu-west-1', authenticationMethod: 'API Key', accessKeyId: 'AK', secretAccessKey: 'SK' }, {})
  assert.equal(db.region, 'eu-west-1')
  assert.ok(db.credentials)
})

test('region defaults to us-east-1', () => {
  const db = new DynamoDB({ accessKeyId: 'AK', secretAccessKey: 'SK' }, {})
  assert.equal(db.region, 'us-east-1')
})

test('sendJson resolves credentials and calls jsonRequest with the DynamoDB target', async () => {
  const db = new DynamoDB({ region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK' }, {})
  const calls = []
  db.deps.jsonRequest = async (opts, creds) => {
    calls.push({ opts, creds })

    return { ok: true }
  }
  const out = await db.sendJson('GetItem', { TableName: 'T' })
  assert.deepEqual(out, { ok: true })
  assert.equal(calls[0].opts.target, 'DynamoDB_20120810.GetItem')
  assert.equal(calls[0].opts.service, 'dynamodb')
  assert.equal(calls[0].opts.contentType, 'application/x-amz-json-1.0')
  assert.deepEqual(calls[0].opts.body, { TableName: 'T' })
  assert.deepEqual(calls[0].creds, { accessKeyId: 'AK', secretAccessKey: 'SK' })
})

test('requiring index.js does not throw without Backendless global', () => {
  assert.equal(typeof DynamoDB, 'function')
})
