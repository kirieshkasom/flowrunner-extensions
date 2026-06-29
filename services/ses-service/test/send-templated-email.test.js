'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { SES } = require('../src/index')

function makeSES() {
  const ses = new SES({ region: 'us-east-1', authenticationMethod: 'API Key', accessKeyId: 'AK', secretAccessKey: 'SK' })
  const calls = []
  ses.sendRest = async (method, path, body) => {
    calls.push({ method, path, body })
    return { MessageId: 'tmpl-msg-id' }
  }
  return { ses, calls }
}

test('sendTemplatedEmail posts to /v2/email/outbound-emails with Template content', async () => {
  const { ses, calls } = makeSES()
  const result = await ses.sendTemplatedEmail(
    'from@example.com',
    ['to@example.com'],
    null, null,
    'MyTemplate',
    { name: 'Alice' },
    null,
  )
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].path, '/v2/email/outbound-emails')
  assert.equal(calls[0].body.FromEmailAddress, 'from@example.com')
  assert.deepEqual(calls[0].body.Destination.ToAddresses, ['to@example.com'])
  assert.equal(calls[0].body.Content.Template.TemplateName, 'MyTemplate')
  assert.equal(calls[0].body.Content.Template.TemplateData, '{"name":"Alice"}')
  assert.equal(result.messageId, 'tmpl-msg-id')
})

test('sendTemplatedEmail uses empty object for templateData when omitted', async () => {
  const { ses, calls } = makeSES()
  await ses.sendTemplatedEmail('f@e.com', ['t@e.com'], null, null, 'T', null, null)
  assert.equal(calls[0].body.Content.Template.TemplateData, '{}')
})

test('sendTemplatedEmail includes cc, bcc, replyTo when provided', async () => {
  const { ses, calls } = makeSES()
  await ses.sendTemplatedEmail('f@e.com', ['t@e.com'], ['cc@e.com'], ['bcc@e.com'], 'T', null, ['reply@e.com'])
  assert.deepEqual(calls[0].body.Destination.CcAddresses, ['cc@e.com'])
  assert.deepEqual(calls[0].body.Destination.BccAddresses, ['bcc@e.com'])
  assert.deepEqual(calls[0].body.ReplyToAddresses, ['reply@e.com'])
})

test('sendTemplatedEmail throws if fromEmailAddress is missing', async () => {
  const { ses } = makeSES()
  await assert.rejects(() => ses.sendTemplatedEmail(null, ['t@e.com'], null, null, 'T', null, null), /fromEmailAddress/)
})

test('sendTemplatedEmail throws if toAddresses is missing', async () => {
  const { ses } = makeSES()
  await assert.rejects(() => ses.sendTemplatedEmail('f@e.com', null, null, null, 'T', null, null), /toAddresses/)
})

test('sendTemplatedEmail throws if templateName is missing', async () => {
  const { ses } = makeSES()
  await assert.rejects(() => ses.sendTemplatedEmail('f@e.com', ['t@e.com'], null, null, null, null, null), /templateName/)
})
