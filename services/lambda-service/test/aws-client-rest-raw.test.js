'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildRestJsonRequest, restRequest } = require('../src/aws-client')

// --- buildRestJsonRequest: custom headers merge ---

test('buildRestJsonRequest merges custom headers after default content-type', () => {
  const req = buildRestJsonRequest({
    region: 'us-east-1',
    service: 'lambda',
    method: 'POST',
    path: '/2015-03-31/functions/myFn/invocations',
    body: { key: 'val' },
    headers: { 'x-amz-invocation-type': 'Event' },
  })
  assert.equal(req.headers['content-type'], 'application/json')
  assert.equal(req.headers['x-amz-invocation-type'], 'Event')
})

test('buildRestJsonRequest custom headers can override content-type', () => {
  const req = buildRestJsonRequest({
    region: 'us-east-1',
    service: 'lambda',
    method: 'POST',
    path: '/',
    body: null,
    headers: { 'content-type': 'text/plain' },
  })
  assert.equal(req.headers['content-type'], 'text/plain')
})

test('buildRestJsonRequest with no headers param is backward-compatible', () => {
  const req = buildRestJsonRequest({ region: 'us-east-1', service: 'ses', method: 'GET', path: '/v2/email/templates' })
  assert.equal(req.headers['content-type'], 'application/json')
  assert.equal(Object.keys(req.headers).length, 1)
})

// --- restRequest ---

test('restRequest signs with lambda service and returns raw response via injected httpRequest', async () => {
  const calls = []
  const rawResponse = { statusCode: 202, headers: { 'x-amz-function-error': null }, body: '' }
  const fakeHttp = async (method, url, headers, body) => {
    calls.push({ method, url, headers, body })
    return rawResponse
  }

  const result = await restRequest(
    {
      region: 'us-east-1',
      service: 'lambda',
      method: 'POST',
      path: '/2015-03-31/functions/myFn/invocations',
      body: { action: 'run' },
      headers: { 'x-amz-invocation-type': 'Event' },
    },
    { accessKeyId: 'AK', secretAccessKey: 'SK' },
    { httpRequest: fakeHttp },
  )

  assert.equal(result, rawResponse)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].url, 'https://lambda.us-east-1.amazonaws.com/2015-03-31/functions/myFn/invocations')
  assert.match(calls[0].headers['authorization'], /^AWS4-HMAC-SHA256 /)
  assert.equal(calls[0].headers['x-amz-invocation-type'], 'Event')
})

test('restRequest does NOT throw on statusCode >= 300 — caller decides', async () => {
  const fakeHttp = async () => ({
    statusCode: 400,
    headers: {},
    body: '{"__type":"ResourceNotFoundException","message":"Function not found"}',
  })

  const result = await restRequest(
    { region: 'us-east-1', service: 'lambda', method: 'POST', path: '/2015-03-31/functions/no-such/invocations', body: {} },
    { accessKeyId: 'AK', secretAccessKey: 'SK' },
    { httpRequest: fakeHttp },
  )

  assert.equal(result.statusCode, 400)
  assert.ok(result.body.includes('ResourceNotFoundException'))
})

test('restRequest does NOT throw on statusCode 500', async () => {
  const fakeHttp = async () => ({ statusCode: 500, headers: {}, body: '{"message":"internal"}' })

  const result = await restRequest(
    { region: 'us-east-1', service: 'lambda', method: 'POST', path: '/', body: null },
    { accessKeyId: 'AK', secretAccessKey: 'SK' },
    { httpRequest: fakeHttp },
  )

  assert.equal(result.statusCode, 500)
})
