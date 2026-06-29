'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { SNS } = require('../src/index')

function makeSns(bodyXml) {
  const sns = new SNS({ region: 'us-east-1' })

  sns.credentials = { resolve: async () => ({ accessKeyId: 'AK', secretAccessKey: 'SK' }) }
  sns.sendQuery = async (action, params) => {
    sns._lastAction = action
    sns._lastParams = params

    return { statusCode: 200, body: bodyXml }
  }

  return sns
}

test('publish sends Action=Publish with TopicArn and Message', async () => {
  const xml = `<PublishResponse><PublishResult><MessageId>msg-001</MessageId></PublishResult></PublishResponse>`
  const sns = makeSns(xml)

  const result = await sns.publish('arn:aws:sns:us-east-1:123:MyTopic', null, 'Hello world', null)

  assert.equal(sns._lastAction, 'Publish')
  assert.equal(sns._lastParams.TopicArn, 'arn:aws:sns:us-east-1:123:MyTopic')
  assert.equal(sns._lastParams.Message, 'Hello world')
  assert.equal(sns._lastParams.PhoneNumber, undefined)
  assert.deepEqual(result, { messageId: 'msg-001' })
})

test('publish sends PhoneNumber instead of TopicArn when provided', async () => {
  const xml = `<PublishResponse><PublishResult><MessageId>msg-002</MessageId></PublishResult></PublishResponse>`
  const sns = makeSns(xml)

  const result = await sns.publish(null, '+15551234567', 'SMS text', null)

  assert.equal(sns._lastParams.PhoneNumber, '+15551234567')
  assert.equal(sns._lastParams.TopicArn, undefined)
  assert.deepEqual(result, { messageId: 'msg-002' })
})

test('publish includes Subject when provided', async () => {
  const xml = `<PublishResponse><PublishResult><MessageId>msg-003</MessageId></PublishResult></PublishResponse>`
  const sns = makeSns(xml)

  await sns.publish('arn:aws:sns:us-east-1:123:MyTopic', null, 'Body', 'My Subject')

  assert.equal(sns._lastParams.Subject, 'My Subject')
})

test('publish throws when message is missing', async () => {
  const sns = makeSns('<x/>')

  await assert.rejects(() => sns.publish('arn:aws:sns:us-east-1:123:MyTopic', null, null, null), /message is required/)
})

test('publish throws when both topicArn and phoneNumber are missing', async () => {
  const sns = makeSns('<x/>')

  await assert.rejects(() => sns.publish(null, null, 'Hello', null), /topicArn or phoneNumber is required/)
})

test('publish wraps AWS errors via #handleError', async () => {
  const sns = new SNS({ region: 'us-east-1' })

  sns.credentials = { resolve: async () => ({ accessKeyId: 'AK', secretAccessKey: 'SK' }) }
  sns.sendQuery = async () => {
    const err = new Error('No such topic')

    err.name = 'NotFound'
    throw err
  }

  await assert.rejects(() => sns.publish('arn:aws:sns:us-east-1:123:Bad', null, 'Hi', null), /Resource not found/)
})
