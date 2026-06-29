'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const { signRequest } = require('../src/sigv4')

const RealDate = Date

function freezeDate(iso) {
  global.Date = class extends RealDate {
    constructor(...args) {
      if (args.length) return new RealDate(...args)
      return new RealDate(iso)
    }
    static now() {
      return new RealDate(iso).getTime()
    }
  }
}

function unfreezeDate() {
  global.Date = RealDate
}

const CREDS = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'SECRETEXAMPLE' }

test('signRequest sets x-amz-date and x-amz-content-sha256 from body', () => {
  freezeDate('2024-01-01T00:00:00.000Z')
  try {
    const headers = {}
    const body = '{"hello":"world"}'
    signRequest('POST', 'https://dynamodb.us-east-1.amazonaws.com/', headers, body, CREDS, 'us-east-1', 'dynamodb')
    assert.equal(headers['x-amz-date'], '20240101T000000Z')
    assert.equal(headers['x-amz-content-sha256'], crypto.createHash('sha256').update(body).digest('hex'))
    assert.equal(headers['host'], 'dynamodb.us-east-1.amazonaws.com')
  } finally {
    unfreezeDate()
  }
})

test('signRequest authorization header has the SigV4 structure', () => {
  const headers = {}
  signRequest('POST', 'https://dynamodb.us-east-1.amazonaws.com/', headers, '', CREDS, 'us-east-1', 'dynamodb')
  assert.match(
    headers['authorization'],
    /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-east-1\/dynamodb\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/,
  )
})

test('signRequest is deterministic for a fixed time', () => {
  freezeDate('2024-01-01T00:00:00.000Z')
  try {
    const h1 = {}
    const h2 = {}
    signRequest('POST', 'https://dynamodb.us-east-1.amazonaws.com/', h1, 'x', CREDS, 'us-east-1', 'dynamodb')
    signRequest('POST', 'https://dynamodb.us-east-1.amazonaws.com/', h2, 'x', CREDS, 'us-east-1', 'dynamodb')
    assert.equal(h1['authorization'], h2['authorization'])
  } finally {
    unfreezeDate()
  }
})

test('signRequest includes session token in signed headers when present', () => {
  const headers = {}
  signRequest('POST', 'https://dynamodb.us-east-1.amazonaws.com/', headers, '', { ...CREDS, sessionToken: 'TOKEN' }, 'us-east-1', 'dynamodb')
  assert.equal(headers['x-amz-security-token'], 'TOKEN')
  assert.match(headers['authorization'], /SignedHeaders=[^,]*x-amz-security-token/)
})
