'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { SES } = require('../src/index')

function makeSES() {
  const ses = new SES({ region: 'us-east-1', authenticationMethod: 'API Key', accessKeyId: 'AK', secretAccessKey: 'SK' })
  const calls = []
  ses.sendRest = async (method, path, body) => {
    calls.push({ method, path, body })
    return { MessageId: '0100018f-test' }
  }
  return { ses, calls }
}

test('sendEmail posts to /v2/email/outbound-emails with correct body', async () => {
  const { ses, calls } = makeSES()
  const result = await ses.sendEmail(
    'from@example.com',
    ['to@example.com'],
    null, null,
    'Hello subject',
    'Hello text',
    null,
    null,
  )
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].path, '/v2/email/outbound-emails')
  assert.equal(calls[0].body.FromEmailAddress, 'from@example.com')
  assert.deepEqual(calls[0].body.Destination.ToAddresses, ['to@example.com'])
  assert.equal(calls[0].body.Content.Simple.Subject.Data, 'Hello subject')
  assert.equal(calls[0].body.Content.Simple.Body.Text.Data, 'Hello text')
  assert.equal(result.messageId, '0100018f-test')
})

test('sendEmail includes htmlBody in body when provided', async () => {
  const { ses, calls } = makeSES()
  await ses.sendEmail('f@e.com', ['t@e.com'], null, null, 'subj', null, '<h1>Hi</h1>', null)
  assert.equal(calls[0].body.Content.Simple.Body.Html.Data, '<h1>Hi</h1>')
  assert.equal(calls[0].body.Content.Simple.Body.Text, undefined)
})

test('sendEmail includes both text and html when both provided', async () => {
  const { ses, calls } = makeSES()
  await ses.sendEmail('f@e.com', ['t@e.com'], null, null, 'subj', 'text', '<h1>html</h1>', null)
  assert.equal(calls[0].body.Content.Simple.Body.Text.Data, 'text')
  assert.equal(calls[0].body.Content.Simple.Body.Html.Data, '<h1>html</h1>')
})

test('sendEmail includes cc, bcc, replyTo when provided', async () => {
  const { ses, calls } = makeSES()
  await ses.sendEmail('f@e.com', ['t@e.com'], ['cc@e.com'], ['bcc@e.com'], 'subj', 'text', null, ['reply@e.com'])
  assert.deepEqual(calls[0].body.Destination.CcAddresses, ['cc@e.com'])
  assert.deepEqual(calls[0].body.Destination.BccAddresses, ['bcc@e.com'])
  assert.deepEqual(calls[0].body.ReplyToAddresses, ['reply@e.com'])
})

test('sendEmail does not include cc/bcc/replyTo when null/undefined', async () => {
  const { ses, calls } = makeSES()
  await ses.sendEmail('f@e.com', ['t@e.com'], null, null, 'subj', 'text', null, null)
  assert.equal(calls[0].body.Destination.CcAddresses, undefined)
  assert.equal(calls[0].body.Destination.BccAddresses, undefined)
  assert.equal(calls[0].body.ReplyToAddresses, undefined)
})

test('sendEmail throws if fromEmailAddress is missing', async () => {
  const { ses } = makeSES()
  await assert.rejects(() => ses.sendEmail(null, ['t@e.com'], null, null, 'subj', 'text', null, null), /fromEmailAddress/)
})

test('sendEmail throws if toAddresses is missing', async () => {
  const { ses } = makeSES()
  await assert.rejects(() => ses.sendEmail('f@e.com', null, null, null, 'subj', 'text', null, null), /toAddresses/)
})

test('sendEmail throws if subject is missing', async () => {
  const { ses } = makeSES()
  await assert.rejects(() => ses.sendEmail('f@e.com', ['t@e.com'], null, null, null, 'text', null, null), /subject/)
})

test('sendEmail throws if neither textBody nor htmlBody is provided', async () => {
  const { ses } = makeSES()
  await assert.rejects(() => ses.sendEmail('f@e.com', ['t@e.com'], null, null, 'subj', null, null, null), /textBody|htmlBody/)
})
