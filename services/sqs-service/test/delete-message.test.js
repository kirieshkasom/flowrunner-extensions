'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { SQS } = require('../src/index')

function makeSqs(sendJsonImpl) {
  const sqs = new SQS({ region: 'us-east-1', authenticationMethod: 'API Key', accessKeyId: 'AK', secretAccessKey: 'SK' })

  sqs.sendJson = sendJsonImpl

  return sqs
}

test('deleteMessage calls DeleteMessage with QueueUrl and ReceiptHandle', async () => {
  const calls = []
  const sqs = makeSqs(async (op, body) => {
    calls.push({ op, body })

    return {}
  })

  const result = await sqs.deleteMessage('https://sqs.us-east-1.amazonaws.com/123/Q', 'receipt-handle-abc')

  assert.equal(calls[0].op, 'DeleteMessage')
  assert.equal(calls[0].body.QueueUrl, 'https://sqs.us-east-1.amazonaws.com/123/Q')
  assert.equal(calls[0].body.ReceiptHandle, 'receipt-handle-abc')
  assert.deepEqual(result, { success: true })
})

test('deleteMessage throws when queueUrl is missing', async () => {
  const sqs = makeSqs(async () => {})

  await assert.rejects(() => sqs.deleteMessage('', 'handle'), /queueUrl is required/)
})

test('deleteMessage throws when receiptHandle is missing', async () => {
  const sqs = makeSqs(async () => {})

  await assert.rejects(() => sqs.deleteMessage('https://sqs.us-east-1.amazonaws.com/123/Q', ''), /receiptHandle is required/)
})

test('deleteMessage maps ReceiptHandleIsInvalid error to friendly message', async () => {
  const sqs = makeSqs(async () => {
    const err = new Error('The input receipt handle is invalid.')

    err.name = 'ReceiptHandleIsInvalid'
    throw err
  })

  await assert.rejects(() => sqs.deleteMessage('https://sqs.us-east-1.amazonaws.com/123/Q', 'bad-handle'), /Invalid receipt handle/)
})
