'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildRestJsonRequest, restJsonRequest } = require('../src/aws-client')

// --- buildRestJsonRequest ---

test('buildRestJsonRequest builds host+path URL with application/json', () => {
  const req = buildRestJsonRequest({ region: 'us-east-1', service: 'ses', method: 'POST', path: '/v2/email/outbound-emails', body: { From: 'a@b.com' } })
  assert.equal(req.method, 'POST')
  assert.equal(req.url, 'https://ses.us-east-1.amazonaws.com/v2/email/outbound-emails')
  assert.equal(req.headers['content-type'], 'application/json')
  assert.equal(req.body, '{"From":"a@b.com"}')
})

test('buildRestJsonRequest uses POST as default method', () => {
  const req = buildRestJsonRequest({ region: 'us-east-1', service: 'ses', path: '/v2/email/templates', body: { TemplateName: 'T' } })
  assert.equal(req.method, 'POST')
})

test('buildRestJsonRequest uses / as default path', () => {
  const req = buildRestJsonRequest({ region: 'us-east-1', service: 'ses', body: {} })
  assert.equal(req.url, 'https://ses.us-east-1.amazonaws.com/')
})

test('buildRestJsonRequest produces empty body string for GET with no body', () => {
  const req = buildRestJsonRequest({ region: 'us-east-1', service: 'ses', method: 'GET', path: '/v2/email/templates' })
  assert.equal(req.body, '')
})

test('buildRestJsonRequest produces empty body string for null body', () => {
  const req = buildRestJsonRequest({ region: 'us-east-1', service: 'ses', method: 'GET', path: '/v2/email/templates', body: null })
  assert.equal(req.body, '')
})

test('buildRestJsonRequest passes through a pre-serialized string body', () => {
  const req = buildRestJsonRequest({ region: 'us-east-1', service: 'ses', method: 'POST', path: '/v2/email/templates', body: '{"TemplateName":"T"}' })
  assert.equal(req.body, '{"TemplateName":"T"}')
})

// --- restJsonRequest ---

test('restJsonRequest signs request, sends via injected httpRequest, and returns parsed JSON', async () => {
  const calls = []
  const fakeHttp = async (method, url, headers, body) => {
    calls.push({ method, url, headers, body })
    return { statusCode: 200, headers: {}, body: '{"MessageId":"abc123"}' }
  }

  const out = await restJsonRequest(
    { region: 'us-east-1', service: 'ses', method: 'POST', path: '/v2/email/outbound-emails', body: { From: 'a@b.com' } },
    { accessKeyId: 'AK', secretAccessKey: 'SK' },
    { httpRequest: fakeHttp },
  )

  assert.deepEqual(out, { MessageId: 'abc123' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].url, 'https://ses.us-east-1.amazonaws.com/v2/email/outbound-emails')
  assert.match(calls[0].headers['authorization'], /^AWS4-HMAC-SHA256 /)
  assert.equal(calls[0].headers['content-type'], 'application/json')
})

test('restJsonRequest with GET and no body still adds auth headers', async () => {
  const calls = []
  const fakeHttp = async (method, url, headers, body) => {
    calls.push({ method, url, headers, body })
    return { statusCode: 200, headers: {}, body: '{"TemplatesMetadata":[]}' }
  }

  const out = await restJsonRequest(
    { region: 'eu-west-1', service: 'ses', method: 'GET', path: '/v2/email/templates?PageSize=100' },
    { accessKeyId: 'AK2', secretAccessKey: 'SK2' },
    { httpRequest: fakeHttp },
  )

  assert.deepEqual(out, { TemplatesMetadata: [] })
  assert.match(calls[0].headers['authorization'], /^AWS4-HMAC-SHA256 /)
})

test('restJsonRequest throws via parseJsonResponse on error response with __type', async () => {
  const fakeHttp = async () => ({
    statusCode: 400,
    headers: {},
    body: '{"__type":"com.amazonaws.email.v2#NotFoundException","message":"template not found"}',
  })

  await assert.rejects(
    () => restJsonRequest(
      { region: 'us-east-1', service: 'ses', method: 'GET', path: '/v2/email/templates/NoSuch' },
      { accessKeyId: 'AK', secretAccessKey: 'SK' },
      { httpRequest: fakeHttp },
    ),
    err => {
      assert.equal(err.name, 'NotFoundException')
      assert.equal(err.message, 'template not found')
      assert.equal(err.statusCode, 400)
      return true
    },
  )
})
