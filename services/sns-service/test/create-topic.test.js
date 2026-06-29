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

test('createTopic sends Action=CreateTopic with Name', async () => {
  const xml = `<CreateTopicResponse><CreateTopicResult><TopicArn>arn:aws:sns:us-east-1:123:NewTopic</TopicArn></CreateTopicResult></CreateTopicResponse>`
  const sns = makeSns(xml)

  const result = await sns.createTopic('NewTopic')

  assert.equal(sns._lastAction, 'CreateTopic')
  assert.equal(sns._lastParams.Name, 'NewTopic')
  assert.deepEqual(result, { topicArn: 'arn:aws:sns:us-east-1:123:NewTopic' })
})

test('createTopic throws when name is missing', async () => {
  const sns = makeSns('<x/>')

  await assert.rejects(() => sns.createTopic(null), /name is required/)
})

test('createTopic wraps AWS errors via #handleError', async () => {
  const sns = new SNS({ region: 'us-east-1' })

  sns.credentials = { resolve: async () => ({ accessKeyId: 'AK', secretAccessKey: 'SK' }) }
  sns.sendQuery = async () => {
    const err = new Error('bad param')

    err.name = 'InvalidParameter'
    throw err
  }

  await assert.rejects(() => sns.createTopic('Bad!Name'), /Invalid parameter/)
})
