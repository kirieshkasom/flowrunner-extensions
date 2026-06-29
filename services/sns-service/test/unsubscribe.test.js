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

test('unsubscribe sends Action=Unsubscribe with SubscriptionArn', async () => {
  const xml = `<UnsubscribeResponse><ResponseMetadata><RequestId>req-2</RequestId></ResponseMetadata></UnsubscribeResponse>`
  const sns = makeSns(xml)

  const result = await sns.unsubscribe('arn:aws:sns:us-east-1:123:MyTopic:sub-abc')

  assert.equal(sns._lastAction, 'Unsubscribe')
  assert.equal(sns._lastParams.SubscriptionArn, 'arn:aws:sns:us-east-1:123:MyTopic:sub-abc')
  assert.deepEqual(result, { success: true })
})

test('unsubscribe throws when subscriptionArn is missing', async () => {
  const sns = makeSns('<x/>')

  await assert.rejects(() => sns.unsubscribe(null), /subscriptionArn is required/)
})

test('unsubscribe wraps AWS errors via #handleError', async () => {
  const sns = new SNS({ region: 'us-east-1' })

  sns.credentials = { resolve: async () => ({ accessKeyId: 'AK', secretAccessKey: 'SK' }) }
  sns.sendQuery = async () => {
    const err = new Error('Request rate exceeded')

    err.name = 'Throttled'
    throw err
  }

  await assert.rejects(() => sns.unsubscribe('arn:aws:sns:us-east-1:123:MyTopic:sub-abc'), /throttled/i)
})
