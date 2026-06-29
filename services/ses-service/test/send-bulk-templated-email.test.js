'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { SES } = require('../src/index')

function makeSES() {
  const ses = new SES({ region: 'us-east-1', authenticationMethod: 'API Key', accessKeyId: 'AK', secretAccessKey: 'SK' })
  const calls = []
  ses.sendRest = async (method, path, body) => {
    calls.push({ method, path, body })
    return {
      BulkEmailEntries: [
        { MessageId: 'msg-1', Status: 'SUCCESS', Error: null },
        { MessageId: 'msg-2', Status: 'FAILED', Error: 'MailFromDomainNotVerified' },
      ],
    }
  }
  return { ses, calls }
}

test('sendBulkTemplatedEmail posts to /v2/email/outbound-bulk-emails', async () => {
  const { ses, calls } = makeSES()
  const result = await ses.sendBulkTemplatedEmail(
    'from@example.com',
    'MyTemplate',
    { greeting: 'Hello' },
    [
      { toAddresses: ['a@e.com'], replacementData: { name: 'A' } },
      { toAddresses: ['b@e.com'] },
    ],
  )
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].path, '/v2/email/outbound-bulk-emails')
  assert.equal(calls[0].body.FromEmailAddress, 'from@example.com')
  assert.equal(calls[0].body.DefaultContent.Template.TemplateName, 'MyTemplate')
  assert.equal(calls[0].body.DefaultContent.Template.TemplateData, '{"greeting":"Hello"}')
  assert.equal(calls[0].body.BulkEmailEntries.length, 2)
  assert.deepEqual(calls[0].body.BulkEmailEntries[0].Destination.ToAddresses, ['a@e.com'])
  assert.equal(calls[0].body.BulkEmailEntries[0].ReplacementEmailContent.ReplacementTemplate.ReplacementTemplateData, '{"name":"A"}')
  assert.deepEqual(calls[0].body.BulkEmailEntries[1].Destination.ToAddresses, ['b@e.com'])
  assert.equal(calls[0].body.BulkEmailEntries[1].ReplacementEmailContent.ReplacementTemplate.ReplacementTemplateData, '{}')
  assert.deepEqual(result.results, [
    { messageId: 'msg-1', status: 'SUCCESS', error: null },
    { messageId: 'msg-2', status: 'FAILED', error: 'MailFromDomainNotVerified' },
  ])
})

test('sendBulkTemplatedEmail uses empty object for defaultTemplateData when null', async () => {
  const { ses, calls } = makeSES()
  await ses.sendBulkTemplatedEmail('f@e.com', 'T', null, [{ toAddresses: ['a@e.com'] }])
  assert.equal(calls[0].body.DefaultContent.Template.TemplateData, '{}')
})

test('sendBulkTemplatedEmail handles empty BulkEmailEntries response', async () => {
  const ses = new SES({ region: 'us-east-1', authenticationMethod: 'API Key', accessKeyId: 'AK', secretAccessKey: 'SK' })
  ses.sendRest = async () => ({})
  const result = await ses.sendBulkTemplatedEmail('f@e.com', 'T', null, [{ toAddresses: ['a@e.com'] }])
  assert.deepEqual(result.results, [])
})

test('sendBulkTemplatedEmail throws if fromEmailAddress is missing', async () => {
  const { ses } = makeSES()
  await assert.rejects(() => ses.sendBulkTemplatedEmail(null, 'T', null, [{ toAddresses: ['a@e.com'] }]), /fromEmailAddress/)
})

test('sendBulkTemplatedEmail throws if templateName is missing', async () => {
  const { ses } = makeSES()
  await assert.rejects(() => ses.sendBulkTemplatedEmail('f@e.com', null, null, [{ toAddresses: ['a@e.com'] }]), /templateName/)
})

test('sendBulkTemplatedEmail throws if entries is missing', async () => {
  const { ses } = makeSES()
  await assert.rejects(() => ses.sendBulkTemplatedEmail('f@e.com', 'T', null, null), /entries/)
})

test('sendBulkTemplatedEmail throws if entries is empty array', async () => {
  const { ses } = makeSES()
  await assert.rejects(() => ses.sendBulkTemplatedEmail('f@e.com', 'T', null, []), /entries/)
})
