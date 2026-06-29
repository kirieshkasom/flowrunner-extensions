'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { SQS } = require('../src/index')

function makeSqs(sendJsonImpl) {
  const sqs = new SQS({ region: 'us-east-1', authenticationMethod: 'API Key', accessKeyId: 'AK', secretAccessKey: 'SK' })

  sqs.sendJson = sendJsonImpl

  return sqs
}

test('getQueueAttributes defaults to All when no attributeNames provided', async () => {
  const calls = []
  const sqs = makeSqs(async (op, body) => {
    calls.push({ op, body })

    return { Attributes: { ApproximateNumberOfMessages: '5' } }
  })

  const result = await sqs.getQueueAttributes('https://sqs.us-east-1.amazonaws.com/123/Q')

  assert.equal(calls[0].op, 'GetQueueAttributes')
  assert.deepEqual(calls[0].body.AttributeNames, ['All'])
  assert.deepEqual(result, { attributes: { ApproximateNumberOfMessages: '5' } })
})

test('getQueueAttributes uses provided attributeNames list', async () => {
  const calls = []
  const sqs = makeSqs(async (op, body) => {
    calls.push({ op, body })

    return { Attributes: { VisibilityTimeout: '30', ApproximateNumberOfMessages: '3' } }
  })

  await sqs.getQueueAttributes('https://sqs.us-east-1.amazonaws.com/123/Q', ['VisibilityTimeout', 'ApproximateNumberOfMessages'])

  assert.deepEqual(calls[0].body.AttributeNames, ['VisibilityTimeout', 'ApproximateNumberOfMessages'])
})

test('getQueueAttributes falls back to All when empty array is passed', async () => {
  const calls = []
  const sqs = makeSqs(async (op, body) => {
    calls.push({ op, body })

    return {}
  })

  await sqs.getQueueAttributes('https://sqs.us-east-1.amazonaws.com/123/Q', [])

  assert.deepEqual(calls[0].body.AttributeNames, ['All'])
})

test('getQueueAttributes returns empty attributes when response has none', async () => {
  const sqs = makeSqs(async () => ({}))
  const result = await sqs.getQueueAttributes('https://sqs.us-east-1.amazonaws.com/123/Q')

  assert.deepEqual(result, { attributes: {} })
})

test('getQueueAttributes maps QueueDoesNotExist to friendly message', async () => {
  const sqs = makeSqs(async () => {
    const err = new Error('The specified queue does not exist.')

    err.name = 'QueueDoesNotExist'
    throw err
  })

  await assert.rejects(() => sqs.getQueueAttributes('https://sqs.us-east-1.amazonaws.com/123/Gone'), /Queue not found/)
})

test('getQueueAttributes maps NonExistentQueue alias to friendly message', async () => {
  const sqs = makeSqs(async () => {
    const err = new Error('Queue does not exist.')

    err.name = 'AWS.SimpleQueueService.NonExistentQueue'
    throw err
  })

  await assert.rejects(() => sqs.getQueueAttributes('https://sqs.us-east-1.amazonaws.com/123/Gone'), /Queue not found/)
})

test('getQueueAttributes throws when queueUrl is missing', async () => {
  const sqs = makeSqs(async () => {})

  await assert.rejects(() => sqs.getQueueAttributes(''), /queueUrl is required/)
})
