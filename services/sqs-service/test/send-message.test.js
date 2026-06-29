'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { SQS } = require('../src/index')

function makeSqs(sendJsonImpl) {
  const sqs = new SQS({ region: 'us-east-1', authenticationMethod: 'API Key', accessKeyId: 'AK', secretAccessKey: 'SK' })

  sqs.sendJson = sendJsonImpl

  return sqs
}

test('sendMessage calls SendMessage with required fields and returns messageId', async () => {
  const calls = []
  const sqs = makeSqs(async (op, body) => {
    calls.push({ op, body })

    return { MessageId: '5fea7756-0ea4-451a-a703-a558b933e274' }
  })

  const result = await sqs.sendMessage('https://sqs.us-east-1.amazonaws.com/123/MyQueue', 'Hello World')

  assert.equal(calls.length, 1)
  assert.equal(calls[0].op, 'SendMessage')
  assert.equal(calls[0].body.QueueUrl, 'https://sqs.us-east-1.amazonaws.com/123/MyQueue')
  assert.equal(calls[0].body.MessageBody, 'Hello World')
  assert.equal(result.messageId, '5fea7756-0ea4-451a-a703-a558b933e274')
  assert.equal(result.sequenceNumber, null)
})

test('sendMessage includes DelaySeconds when provided', async () => {
  const calls = []
  const sqs = makeSqs(async (op, body) => {
    calls.push({ op, body })

    return { MessageId: 'abc123' }
  })

  await sqs.sendMessage('https://sqs.us-east-1.amazonaws.com/123/MyQueue', 'Delayed', 30)

  assert.equal(calls[0].body.DelaySeconds, 30)
})

test('sendMessage includes FIFO fields when provided', async () => {
  const calls = []
  const sqs = makeSqs(async (op, body) => {
    calls.push({ op, body })

    return { MessageId: 'abc123', SequenceNumber: '18849496460467696128' }
  })

  const result = await sqs.sendMessage(
    'https://sqs.us-east-1.amazonaws.com/123/MyQueue.fifo',
    'FIFO message',
    null,
    'group1',
    'dedup1'
  )

  assert.equal(calls[0].body.MessageGroupId, 'group1')
  assert.equal(calls[0].body.MessageDeduplicationId, 'dedup1')
  assert.equal(result.sequenceNumber, '18849496460467696128')
})

test('sendMessage omits optional fields when not provided', async () => {
  const calls = []
  const sqs = makeSqs(async (op, body) => {
    calls.push({ op, body })

    return { MessageId: 'abc' }
  })

  await sqs.sendMessage('https://sqs.us-east-1.amazonaws.com/123/Q', 'msg')

  assert.equal('DelaySeconds' in calls[0].body, false)
  assert.equal('MessageGroupId' in calls[0].body, false)
  assert.equal('MessageDeduplicationId' in calls[0].body, false)
})

test('sendMessage throws when queueUrl is missing', async () => {
  const sqs = makeSqs(async () => {})

  await assert.rejects(() => sqs.sendMessage('', 'body'), /queueUrl is required/)
})

test('sendMessage throws when messageBody is missing', async () => {
  const sqs = makeSqs(async () => {})

  await assert.rejects(() => sqs.sendMessage('https://sqs.us-east-1.amazonaws.com/123/Q', ''), /messageBody is required/)
})
