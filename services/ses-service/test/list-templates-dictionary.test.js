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
      TemplatesMetadata: [
        { TemplateName: 'WelcomeTemplate' },
        { TemplateName: 'AlertTemplate' },
        { TemplateName: 'NotifyTemplate' },
      ],
    }
  }
  return { ses, calls }
}

test('listTemplatesDictionary calls GET /v2/email/templates?PageSize=100', async () => {
  const { ses, calls } = makeSES()
  await ses.listTemplatesDictionary({})
  assert.equal(calls[0].method, 'GET')
  assert.equal(calls[0].path, '/v2/email/templates?PageSize=100')
  assert.equal(calls[0].body, undefined)
})

test('listTemplatesDictionary returns items with label and value', async () => {
  const { ses } = makeSES()
  const result = await ses.listTemplatesDictionary({})
  assert.deepEqual(result.items, [
    { label: 'WelcomeTemplate', value: 'WelcomeTemplate' },
    { label: 'AlertTemplate', value: 'AlertTemplate' },
    { label: 'NotifyTemplate', value: 'NotifyTemplate' },
  ])
  assert.equal(result.cursor, null)
})

test('listTemplatesDictionary filters by search case-insensitively', async () => {
  const { ses } = makeSES()
  const result = await ses.listTemplatesDictionary({ search: 'alert' })
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].value, 'AlertTemplate')
})

test('listTemplatesDictionary includes NextToken as cursor', async () => {
  const { ses } = makeSES({ TemplatesMetadata: [{ TemplateName: 'T1' }], NextToken: 'page2token' })
  const result = await ses.listTemplatesDictionary({})
  assert.equal(result.cursor, 'page2token')
})

test('listTemplatesDictionary passes cursor as NextToken in path', async () => {
  const { ses, calls } = makeSES()
  await ses.listTemplatesDictionary({ cursor: 'mytoken' })
  assert.match(calls[0].path, /NextToken=mytoken/)
})

test('listTemplatesDictionary handles empty payload', async () => {
  const { ses } = makeSES({ TemplatesMetadata: [] })
  const result = await ses.listTemplatesDictionary()
  assert.deepEqual(result.items, [])
  assert.equal(result.cursor, null)
})

test('listTemplatesDictionary handles missing TemplatesMetadata', async () => {
  const { ses } = makeSES({})
  const result = await ses.listTemplatesDictionary({})
  assert.deepEqual(result.items, [])
})
