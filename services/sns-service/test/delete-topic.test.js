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

test('deleteTopic sends Action=DeleteTopic with TopicArn', async () => {
  const xml = `<DeleteTopicResponse><ResponseMetadata><RequestId>req-1</RequestId></ResponseMetadata></DeleteTopicResponse>`
  const sns = makeSns(xml)

  const result = await sns.deleteTopic('arn:aws:sns:us-east-1:123:MyTopic')

  assert.equal(sns._lastAction, 'DeleteTopic')
  assert.equal(sns._lastParams.TopicArn, 'arn:aws:sns:us-east-1:123:MyTopic')
  assert.deepEqual(result, { success: true })
})

test('deleteTopic throws when topicArn is missing', async () => {
  const sns = makeSns('<x/>')

  await assert.rejects(() => sns.deleteTopic(null), /topicArn is required/)
})

test('deleteTopic wraps AWS errors via #handleError', async () => {
  const sns = new SNS({ region: 'us-east-1' })

  sns.credentials = { resolve: async () => ({ accessKeyId: 'AK', secretAccessKey: 'SK' }) }
  sns.sendQuery = async () => {
    const err = new Error('Topic not found')

    err.name = 'NotFound'
    throw err
  }

  await assert.rejects(() => sns.deleteTopic('arn:aws:sns:us-east-1:123:Bad'), /Resource not found/)
})
