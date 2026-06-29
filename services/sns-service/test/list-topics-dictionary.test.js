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

const XML_TWO_TOPICS = `
<ListTopicsResponse>
  <ListTopicsResult>
    <Topics>
      <member><TopicArn>arn:aws:sns:us-east-1:123456789012:Alerts</TopicArn></member>
      <member><TopicArn>arn:aws:sns:us-east-1:123456789012:Orders</TopicArn></member>
    </Topics>
  </ListTopicsResult>
</ListTopicsResponse>`

test('listTopicsDictionary sends Action=ListTopics', async () => {
  const sns = makeSns(XML_TWO_TOPICS)

  await sns.listTopicsDictionary({})

  assert.equal(sns._lastAction, 'ListTopics')
})

test('listTopicsDictionary maps ARNs to label (last segment) and value (full ARN)', async () => {
  const sns = makeSns(XML_TWO_TOPICS)

  const result = await sns.listTopicsDictionary({})

  assert.deepEqual(result.items, [
    { label: 'Alerts', value: 'arn:aws:sns:us-east-1:123456789012:Alerts' },
    { label: 'Orders', value: 'arn:aws:sns:us-east-1:123456789012:Orders' },
  ])
  assert.equal(result.cursor, null)
})

test('listTopicsDictionary filters by search (case-insensitive on label)', async () => {
  const sns = makeSns(XML_TWO_TOPICS)

  const result = await sns.listTopicsDictionary({ search: 'alert' })

  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].label, 'Alerts')
})

test('listTopicsDictionary passes NextToken as cursor param', async () => {
  const xml = `
  <ListTopicsResponse>
    <ListTopicsResult>
      <Topics>
        <member><TopicArn>arn:aws:sns:us-east-1:123:TopicA</TopicArn></member>
      </Topics>
      <NextToken>page2token</NextToken>
    </ListTopicsResult>
  </ListTopicsResponse>`
  const sns = makeSns(xml)

  const result = await sns.listTopicsDictionary({ cursor: 'prevToken' })

  assert.equal(sns._lastParams.NextToken, 'prevToken')
  assert.equal(result.cursor, 'page2token')
})

test('listTopicsDictionary returns cursor=null when no NextToken in response', async () => {
  const sns = makeSns(XML_TWO_TOPICS)

  const result = await sns.listTopicsDictionary({})

  assert.equal(result.cursor, null)
})

test('listTopicsDictionary sends no NextToken when cursor is absent', async () => {
  const sns = makeSns(XML_TWO_TOPICS)

  await sns.listTopicsDictionary({})

  assert.equal(sns._lastParams.NextToken, undefined)
})

test('listTopicsDictionary handles empty topic list', async () => {
  const xml = `<ListTopicsResponse><ListTopicsResult><Topics/></ListTopicsResult></ListTopicsResponse>`
  const sns = makeSns(xml)

  const result = await sns.listTopicsDictionary({})

  assert.deepEqual(result.items, [])
  assert.equal(result.cursor, null)
})

test('listTopicsDictionary wraps AWS errors via #handleError', async () => {
  const sns = new SNS({ region: 'us-east-1' })

  sns.credentials = { resolve: async () => ({ accessKeyId: 'AK', secretAccessKey: 'SK' }) }
  sns.sendQuery = async () => {
    const err = new Error('not authorized')

    err.name = 'AuthorizationError'
    throw err
  }

  await assert.rejects(() => sns.listTopicsDictionary({}), /Authorization error/)
})
