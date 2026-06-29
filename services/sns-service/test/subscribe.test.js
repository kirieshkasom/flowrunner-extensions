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

test('subscribe sends Action=Subscribe with correct params', async () => {
  const xml = `<SubscribeResponse><SubscribeResult><SubscriptionArn>arn:aws:sns:us-east-1:123:MyTopic:sub-abc</SubscriptionArn></SubscribeResult></SubscribeResponse>`
  const sns = makeSns(xml)

  const result = await sns.subscribe('arn:aws:sns:us-east-1:123:MyTopic', 'email', 'user@example.com')

  assert.equal(sns._lastAction, 'Subscribe')
  assert.equal(sns._lastParams.TopicArn, 'arn:aws:sns:us-east-1:123:MyTopic')
  assert.equal(sns._lastParams.Protocol, 'email')
  assert.equal(sns._lastParams.Endpoint, 'user@example.com')
  assert.equal(sns._lastParams.ReturnSubscriptionArn, 'true')
  assert.deepEqual(result, { subscriptionArn: 'arn:aws:sns:us-east-1:123:MyTopic:sub-abc' })
})

test('subscribe returns pending confirmation for email subscriptions', async () => {
  const xml = `<SubscribeResponse><SubscribeResult><SubscriptionArn>pending confirmation</SubscriptionArn></SubscribeResult></SubscribeResponse>`
  const sns = makeSns(xml)

  const result = await sns.subscribe('arn:aws:sns:us-east-1:123:MyTopic', 'email', 'user@example.com')

  assert.deepEqual(result, { subscriptionArn: 'pending confirmation' })
})

test('subscribe throws when topicArn is missing', async () => {
  const sns = makeSns('<x/>')

  await assert.rejects(() => sns.subscribe(null, 'email', 'user@example.com'), /topicArn is required/)
})

test('subscribe throws when protocol is missing', async () => {
  const sns = makeSns('<x/>')

  await assert.rejects(() => sns.subscribe('arn:aws:sns:us-east-1:123:MyTopic', null, 'user@example.com'), /protocol is required/)
})

test('subscribe throws when endpoint is missing', async () => {
  const sns = makeSns('<x/>')

  await assert.rejects(() => sns.subscribe('arn:aws:sns:us-east-1:123:MyTopic', 'email', null), /endpoint is required/)
})

test('subscribe wraps AWS errors via #handleError', async () => {
  const sns = new SNS({ region: 'us-east-1' })

  sns.credentials = { resolve: async () => ({ accessKeyId: 'AK', secretAccessKey: 'SK' }) }
  sns.sendQuery = async () => {
    const err = new Error('not authorized')

    err.name = 'AuthorizationError'
    throw err
  }

  await assert.rejects(() => sns.subscribe('arn:aws:sns:us-east-1:123:MyTopic', 'email', 'x@y.com'), /Authorization error/)
})
