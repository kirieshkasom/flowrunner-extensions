'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { SES } = require('../src/index')

function makeSES() {
  const ses = new SES({ region: 'us-east-1', authenticationMethod: 'API Key', accessKeyId: 'AK', secretAccessKey: 'SK' })
  const calls = []
  ses.sendRest = async (method, path, body) => {
    calls.push({ method, path, body })
    return {}
  }
  return { ses, calls }
}

test('createEmailTemplate posts to /v2/email/templates with correct body', async () => {
  const { ses, calls } = makeSES()
  const result = await ses.createEmailTemplate('MyTemplate', 'Hello {{name}}', 'Dear {{name}}', '<h1>Dear {{name}}</h1>')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].path, '/v2/email/templates')
  assert.equal(calls[0].body.TemplateName, 'MyTemplate')
  assert.equal(calls[0].body.TemplateContent.Subject, 'Hello {{name}}')
  assert.equal(calls[0].body.TemplateContent.Text, 'Dear {{name}}')
  assert.equal(calls[0].body.TemplateContent.Html, '<h1>Dear {{name}}</h1>')
  assert.deepEqual(result, { templateName: 'MyTemplate' })
})

test('createEmailTemplate omits Text/Html when not provided', async () => {
  const { ses, calls } = makeSES()
  await ses.createEmailTemplate('T', 'Subject', null, null)
  assert.equal(calls[0].body.TemplateContent.Text, undefined)
  assert.equal(calls[0].body.TemplateContent.Html, undefined)
})

test('createEmailTemplate returns templateName on success', async () => {
  const { ses } = makeSES()
  const result = await ses.createEmailTemplate('ATemplate', 'Subj', 'txt', null)
  assert.equal(result.templateName, 'ATemplate')
})

test('createEmailTemplate throws if templateName is missing', async () => {
  const { ses } = makeSES()
  await assert.rejects(() => ses.createEmailTemplate(null, 'Subject', 'text', null), /templateName/)
})

test('createEmailTemplate throws if subject is missing', async () => {
  const { ses } = makeSES()
  await assert.rejects(() => ses.createEmailTemplate('T', null, 'text', null), /subject/)
})
