'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { SQS } = require('../src/index')

function makeSqs(sendJsonImpl) {
  const sqs = new SQS({ region: 'us-east-1', authenticationMethod: 'API Key', accessKeyId: 'AK', secretAccessKey: 'SK' })

  sqs.sendJson = sendJsonImpl

  return sqs
}

test('listQueuesDictionary calls ListQueues with MaxResults 100', async () => {
  const calls = []
  const sqs = makeSqs(async (op, body) => {
    calls.push({ op, body })

    return { QueueUrls: [] }
  })

  const result = await sqs.listQueuesDictionary({})

  assert.equal(calls[0].op, 'ListQueues')
  assert.equal(calls[0].body.MaxResults, 100)
  assert.deepEqual(result, { items: [], cursor: null })
})

test('listQueuesDictionary maps url to label (last path segment) and value (full url)', async () => {
  const sqs = makeSqs(async () => ({
    QueueUrls: [
      'https://sqs.us-east-1.amazonaws.com/123456789012/MyQueue',
      'https://sqs.us-east-1.amazonaws.com/123456789012/OrdersQueue.fifo',
    ],
  }))

  const result = await sqs.listQueuesDictionary({})

  assert.equal(result.items.length, 2)
  assert.deepEqual(result.items[0], {
    label: 'MyQueue',
    value: 'https://sqs.us-east-1.amazonaws.com/123456789012/MyQueue',
  })
  assert.deepEqual(result.items[1], {
    label: 'OrdersQueue.fifo',
    value: 'https://sqs.us-east-1.amazonaws.com/123456789012/OrdersQueue.fifo',
  })
})

test('listQueuesDictionary passes QueueNamePrefix when search is provided', async () => {
  const calls = []
  const sqs = makeSqs(async (op, body) => {
    calls.push({ op, body })

    return { QueueUrls: ['https://sqs.us-east-1.amazonaws.com/123/Orders'] }
  })

  await sqs.listQueuesDictionary({ search: 'Orders' })

  assert.equal(calls[0].body.QueueNamePrefix, 'Orders')
})

test('listQueuesDictionary omits QueueNamePrefix when search is absent', async () => {
  const calls = []
  const sqs = makeSqs(async (op, body) => {
    calls.push({ op, body })

    return {}
  })

  await sqs.listQueuesDictionary({})

  assert.equal('QueueNamePrefix' in calls[0].body, false)
})

test('listQueuesDictionary passes NextToken as cursor and returns next cursor', async () => {
  const calls = []
  const sqs = makeSqs(async (op, body) => {
    calls.push({ op, body })

    return { QueueUrls: ['https://sqs.us-east-1.amazonaws.com/123/Q2'], NextToken: 'next-page-token' }
  })

  const result = await sqs.listQueuesDictionary({ cursor: 'prev-token' })

  assert.equal(calls[0].body.NextToken, 'prev-token')
  assert.equal(result.cursor, 'next-page-token')
})

test('listQueuesDictionary returns null cursor when no NextToken in response', async () => {
  const sqs = makeSqs(async () => ({ QueueUrls: ['https://sqs.us-east-1.amazonaws.com/123/Q'] }))
  const result = await sqs.listQueuesDictionary({})

  assert.equal(result.cursor, null)
})

test('listQueuesDictionary works with null payload', async () => {
  const sqs = makeSqs(async () => ({ QueueUrls: [] }))
  const result = await sqs.listQueuesDictionary(null)

  assert.deepEqual(result.items, [])
  assert.equal(result.cursor, null)
})

test('listQueuesDictionary handles absent QueueUrls in response', async () => {
  const sqs = makeSqs(async () => ({}))
  const result = await sqs.listQueuesDictionary({})

  assert.deepEqual(result.items, [])
  assert.equal(result.cursor, null)
})
