'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { SQS } = require('../src/index')

function makeSqs(sendJsonImpl) {
  const sqs = new SQS({ region: 'us-east-1', authenticationMethod: 'API Key', accessKeyId: 'AK', secretAccessKey: 'SK' })

  sqs.sendJson = sendJsonImpl

  return sqs
}

test('sendMessageBatch calls SendMessageBatch with mapped entries', async () => {
  const calls = []
  const sqs = makeSqs(async (op, body) => {
    calls.push({ op, body })

    return {
      Successful: [{ Id: 'msg1', MessageId: 'aaa-111' }],
      Failed: [],
    }
  })

  const entries = [{ id: 'msg1', messageBody: 'Hello' }]
  const result = await sqs.sendMessageBatch('https://sqs.us-east-1.amazonaws.com/123/Q', entries)

  assert.equal(calls[0].op, 'SendMessageBatch')
  assert.equal(calls[0].body.QueueUrl, 'https://sqs.us-east-1.amazonaws.com/123/Q')
  assert.deepEqual(calls[0].body.Entries, [{ Id: 'msg1', MessageBody: 'Hello' }])
  assert.deepEqual(result.successful, [{ id: 'msg1', messageId: 'aaa-111' }])
  assert.deepEqual(result.failed, [])
})

test('sendMessageBatch maps DelaySeconds per entry when provided', async () => {
  const calls = []
  const sqs = makeSqs(async (op, body) => {
    calls.push({ op, body })

    return { Successful: [], Failed: [] }
  })

  const entries = [
    { id: 'e1', messageBody: 'A', delaySeconds: 10 },
    { id: 'e2', messageBody: 'B' },
  ]

  await sqs.sendMessageBatch('https://sqs.us-east-1.amazonaws.com/123/Q', entries)

  assert.equal(calls[0].body.Entries[0].DelaySeconds, 10)
  assert.equal('DelaySeconds' in calls[0].body.Entries[1], false)
})

test('sendMessageBatch maps failed entries correctly', async () => {
  const calls = []
  const sqs = makeSqs(async (op, body) => {
    calls.push({ op, body })

    return {
      Successful: [],
      Failed: [{ Id: 'bad1', Code: 'InvalidParameterValue', Message: 'Too large', SenderFault: true }],
    }
  })

  const result = await sqs.sendMessageBatch('https://sqs.us-east-1.amazonaws.com/123/Q', [{ id: 'bad1', messageBody: 'x'.repeat(300000) }])

  assert.deepEqual(result.failed, [{ id: 'bad1', code: 'InvalidParameterValue', message: 'Too large', senderFault: true }])
})

test('sendMessageBatch handles absent Successful and Failed keys gracefully', async () => {
  const sqs = makeSqs(async () => ({}))
  const result = await sqs.sendMessageBatch('https://sqs.us-east-1.amazonaws.com/123/Q', [{ id: 'e1', messageBody: 'Hi' }])

  assert.deepEqual(result.successful, [])
  assert.deepEqual(result.failed, [])
})

test('sendMessageBatch throws when queueUrl is missing', async () => {
  const sqs = makeSqs(async () => {})

  await assert.rejects(() => sqs.sendMessageBatch('', [{ id: 'e1', messageBody: 'x' }]), /queueUrl is required/)
})

test('sendMessageBatch throws when entries is empty', async () => {
  const sqs = makeSqs(async () => {})

  await assert.rejects(() => sqs.sendMessageBatch('https://sqs.us-east-1.amazonaws.com/123/Q', []), /entries must be a non-empty array/)
})

test('sendMessageBatch throws when entries is not an array', async () => {
  const sqs = makeSqs(async () => {})

  await assert.rejects(() => sqs.sendMessageBatch('https://sqs.us-east-1.amazonaws.com/123/Q', null), /entries must be a non-empty array/)
})
