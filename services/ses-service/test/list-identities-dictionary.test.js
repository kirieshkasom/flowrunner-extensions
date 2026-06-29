'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { SES } = require('../src/index')

function makeSES(responseOverride) {
  const ses = new SES({ region: 'us-east-1', authenticationMethod: 'API Key', accessKeyId: 'AK', secretAccessKey: 'SK' })
  const calls = []
  ses.sendRest = async (method, path, body) => {
    calls.push({ method, path, body })
    return responseOverride || {
      EmailIdentities: [
        { IdentityName: 'example.com', IdentityType: 'DOMAIN', SendingEnabled: true },
        { IdentityName: 'user@example.com', IdentityType: 'EMAIL_ADDRESS', SendingEnabled: false },
        { IdentityName: 'other.com', IdentityType: 'DOMAIN', SendingEnabled: true },
      ],
    }
  }
  return { ses, calls }
}

test('listIdentitiesDictionary calls GET /v2/email/identities?PageSize=100', async () => {
  const { ses, calls } = makeSES()
  await ses.listIdentitiesDictionary({})
  assert.equal(calls[0].method, 'GET')
  assert.equal(calls[0].path, '/v2/email/identities?PageSize=100')
  assert.equal(calls[0].body, undefined)
})

test('listIdentitiesDictionary returns items with label, value, and note (IdentityType)', async () => {
  const { ses } = makeSES()
  const result = await ses.listIdentitiesDictionary({})
  assert.deepEqual(result.items, [
    { label: 'example.com', value: 'example.com', note: 'DOMAIN' },
    { label: 'user@example.com', value: 'user@example.com', note: 'EMAIL_ADDRESS' },
    { label: 'other.com', value: 'other.com', note: 'DOMAIN' },
  ])
  assert.equal(result.cursor, null)
})

test('listIdentitiesDictionary filters by search case-insensitively', async () => {
  const { ses } = makeSES()
  const result = await ses.listIdentitiesDictionary({ search: 'USER@' })
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].value, 'user@example.com')
})

test('listIdentitiesDictionary includes NextToken as cursor', async () => {
  const { ses } = makeSES({ EmailIdentities: [{ IdentityName: 'a.com', IdentityType: 'DOMAIN', SendingEnabled: true }], NextToken: 'nextpage' })
  const result = await ses.listIdentitiesDictionary({})
  assert.equal(result.cursor, 'nextpage')
})

test('listIdentitiesDictionary passes cursor as NextToken in path', async () => {
  const { ses, calls } = makeSES()
  await ses.listIdentitiesDictionary({ cursor: 'tok123' })
  assert.match(calls[0].path, /NextToken=tok123/)
})

test('listIdentitiesDictionary handles empty payload', async () => {
  const { ses } = makeSES({ EmailIdentities: [] })
  const result = await ses.listIdentitiesDictionary()
  assert.deepEqual(result.items, [])
  assert.equal(result.cursor, null)
})

test('listIdentitiesDictionary handles missing EmailIdentities', async () => {
  const { ses } = makeSES({})
  const result = await ses.listIdentitiesDictionary({})
  assert.deepEqual(result.items, [])
})
