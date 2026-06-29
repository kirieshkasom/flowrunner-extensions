'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { SQS } = require('../src/index')

function makeSqs(sendJsonImpl) {
  const sqs = new SQS({ region: 'us-east-1', authenticationMethod: 'API Key', accessKeyId: 'AK', secretAccessKey: 'SK' })

  sqs.sendJson = sendJsonImpl

  return sqs
}

test('receiveMessage calls ReceiveMessage with required fields and MessageSystemAttributeNames', async () => {
  const calls = []
  const sqs = makeSqs(async (op, body) => {
    calls.push({ op, body })

    return { Messages: [] }
  })

  const result = await sqs.receiveMessage('https://sqs.us-east-1.amazonaws.com/123/Q')

  assert.equal(calls[0].op, 'ReceiveMessage')
  assert.equal(calls[0].body.QueueUrl, 'https://sqs.us-east-1.amazonaws.com/123/Q')
  assert.deepEqual(calls[0].body.MessageSystemAttributeNames, ['All'])
  assert.deepEqual(result.messages, [])
})

test('receiveMessage returns empty messages array when queue is empty', async () => {
  const sqs = makeSqs(async () => ({}))
  const result = await sqs.receiveMessage('https://sqs.us-east-1.amazonaws.com/123/Q')

  assert.deepEqual(result.messages, [])
})

test('receiveMessage maps returned messages correctly', async () => {
  const sqs = makeSqs(async () => ({
    Messages: [
      {
        MessageId: 'msg-id-1',
        ReceiptHandle: 'receipt-handle-1',
        Body: 'Hello World',
        MD5OfBody: 'e1d3a7b3',
        Attributes: { ApproximateReceiveCount: '1' },
      },
    ],
  }))

  const result = await sqs.receiveMessage('https://sqs.us-east-1.amazonaws.com/123/Q')

  assert.equal(result.messages.length, 1)
  assert.equal(result.messages[0].messageId, 'msg-id-1')
  assert.equal(result.messages[0].receiptHandle, 'receipt-handle-1')
  assert.equal(result.messages[0].body, 'Hello World')
  assert.equal(result.messages[0].md5OfBody, 'e1d3a7b3')
  assert.deepEqual(result.messages[0].attributes, { ApproximateReceiveCount: '1' })
})

test('receiveMessage defaults attributes to empty object when not present', async () => {
  const sqs = makeSqs(async () => ({
    Messages: [{ MessageId: 'id1', ReceiptHandle: 'rh1', Body: 'hi', MD5OfBody: 'abc' }],
  }))

  const result = await sqs.receiveMessage('https://sqs.us-east-1.amazonaws.com/123/Q')

  assert.deepEqual(result.messages[0].attributes, {})
})

test('receiveMessage includes optional params in request body when provided', async () => {
  const calls = []
  const sqs = makeSqs(async (op, body) => {
    calls.push({ op, body })

    return {}
  })

  await sqs.receiveMessage('https://sqs.us-east-1.amazonaws.com/123/Q', 5, 20, 60)

  assert.equal(calls[0].body.MaxNumberOfMessages, 5)
  assert.equal(calls[0].body.WaitTimeSeconds, 20)
  assert.equal(calls[0].body.VisibilityTimeout, 60)
})

test('receiveMessage omits optional params when not provided', async () => {
  const calls = []
  const sqs = makeSqs(async (op, body) => {
    calls.push({ op, body })

    return {}
  })

  await sqs.receiveMessage('https://sqs.us-east-1.amazonaws.com/123/Q')

  assert.equal('MaxNumberOfMessages' in calls[0].body, false)
  assert.equal('WaitTimeSeconds' in calls[0].body, false)
  assert.equal('VisibilityTimeout' in calls[0].body, false)
})

test('receiveMessage throws when queueUrl is missing', async () => {
  const sqs = makeSqs(async () => {})

  await assert.rejects(() => sqs.receiveMessage(''), /queueUrl is required/)
})
