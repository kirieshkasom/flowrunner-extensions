'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildQueryRequest, queryRequest } = require('../src/aws-client')

// ── buildQueryRequest ─────────────────────────────────────────────────────────

test('buildQueryRequest builds a POST to the /  URL', () => {
  const req = buildQueryRequest({ region: 'us-east-1', service: 'sns', action: 'Publish', version: '2010-03-31', params: {} })

  assert.equal(req.method, 'POST')
  assert.equal(req.url, 'https://sns.us-east-1.amazonaws.com/')
})

test('buildQueryRequest sets content-type header', () => {
  const req = buildQueryRequest({ region: 'us-east-1', service: 'sns', action: 'Publish', version: '2010-03-31', params: {} })

  assert.equal(req.headers['content-type'], 'application/x-www-form-urlencoded')
})

test('buildQueryRequest encodes Action and Version in the body', () => {
  const req = buildQueryRequest({ region: 'us-east-1', service: 'sns', action: 'ListTopics', version: '2010-03-31', params: {} })
  const pairs = new URLSearchParams(req.body)

  assert.equal(pairs.get('Action'), 'ListTopics')
  assert.equal(pairs.get('Version'), '2010-03-31')
})

test('buildQueryRequest encodes extra params in the body', () => {
  const req = buildQueryRequest({
    region: 'us-east-1',
    service: 'sns',
    action: 'Publish',
    version: '2010-03-31',
    params: { TopicArn: 'arn:aws:sns:us-east-1:123:MyTopic', Message: 'hello world' },
  })
  const pairs = new URLSearchParams(req.body)

  assert.equal(pairs.get('TopicArn'), 'arn:aws:sns:us-east-1:123:MyTopic')
  assert.equal(pairs.get('Message'), 'hello world')
})

test('buildQueryRequest drops undefined, null, and empty-string params', () => {
  const req = buildQueryRequest({
    region: 'us-east-1',
    service: 'sns',
    action: 'Publish',
    version: '2010-03-31',
    params: { Message: 'hi', Subject: undefined, PhoneNumber: null, TopicArn: '' },
  })
  const pairs = new URLSearchParams(req.body)

  assert.equal(pairs.get('Message'), 'hi')
  assert.equal(pairs.get('Subject'), null)
  assert.equal(pairs.get('PhoneNumber'), null)
  assert.equal(pairs.get('TopicArn'), null)
})

// ── queryRequest ──────────────────────────────────────────────────────────────

test('queryRequest signs and sends; returns response on 2xx', async () => {
  const calls = []
  const fakeHttp = async (method, url, headers, body) => {
    calls.push({ method, url, headers, body })

    return { statusCode: 200, headers: {}, body: '<PublishResponse><MessageId>abc-123</MessageId></PublishResponse>' }
  }

  const res = await queryRequest(
    { region: 'us-east-1', service: 'sns', action: 'Publish', version: '2010-03-31', params: { Message: 'hello' } },
    { accessKeyId: 'AK', secretAccessKey: 'SK' },
    { httpRequest: fakeHttp },
  )

  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].url, 'https://sns.us-east-1.amazonaws.com/')
  assert.match(calls[0].headers['authorization'], /^AWS4-HMAC-SHA256 /)
  assert.ok(res.body.includes('<MessageId>abc-123</MessageId>'))
  assert.equal(res.statusCode, 200)
})

test('queryRequest throws with err.name === Code on an XML error body with statusCode >= 300', async () => {
  const fakeHttp = async () => ({
    statusCode: 400,
    headers: {},
    body: '<ErrorResponse><Error><Code>InvalidParameter</Code><Message>Invalid topic ARN</Message></Error></ErrorResponse>',
  })

  await assert.rejects(
    () => queryRequest(
      { region: 'us-east-1', service: 'sns', action: 'Publish', version: '2010-03-31', params: {} },
      { accessKeyId: 'AK', secretAccessKey: 'SK' },
      { httpRequest: fakeHttp },
    ),
    err => {
      assert.equal(err.name, 'InvalidParameter')
      assert.equal(err.message, 'Invalid topic ARN')
      assert.equal(err.statusCode, 400)

      return true
    },
  )
})

test('queryRequest throws with fallback name AwsError when Code tag is absent', async () => {
  const fakeHttp = async () => ({
    statusCode: 500,
    headers: {},
    body: '<ErrorResponse><Error><Message>Internal failure</Message></Error></ErrorResponse>',
  })

  await assert.rejects(
    () => queryRequest(
      { region: 'us-east-1', service: 'sns', action: 'ListTopics', version: '2010-03-31', params: {} },
      { accessKeyId: 'AK', secretAccessKey: 'SK' },
      { httpRequest: fakeHttp },
    ),
    err => {
      assert.equal(err.name, 'AwsError')

      return true
    },
  )
})
