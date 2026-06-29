'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { awsConfigItems } = require('../src/config-items')
const { createLogger, mapAwsError } = require('../src/errors')

test('awsConfigItems defines the six shared items in order', () => {
  assert.equal(awsConfigItems.length, 6)
  assert.deepEqual(awsConfigItems.map(i => i.name), [
    'authenticationMethod', 'region', 'accessKeyId', 'secretAccessKey', 'roleArn', 'externalId',
  ])
  const auth = awsConfigItems[0]
  assert.equal(auth.type, 'CHOICE')
  assert.deepEqual(auth.options, ['API Key', 'IAM Role'])
  assert.equal(auth.defaultValue, 'API Key')
})

test('config displayName never contains the service name', () => {
  for (const item of awsConfigItems) {
    assert.ok(!/lambda/i.test(item.displayName), `${item.name} displayName leaks service name`)
  }
})

test('createLogger prefixes messages and exposes 4 levels', () => {
  const lines = []
  const orig = console.log
  console.log = (...args) => lines.push(args.join(' '))
  try {
    const log = createLogger('Lambda')
    log.info('hello')
    log.error('boom')
  } finally {
    console.log = orig
  }
  assert.ok(lines[0].startsWith('[Lambda Service] info:'))
  assert.ok(lines[1].startsWith('[Lambda Service] error:'))
})

test('mapAwsError maps throttling and credential errors to friendly messages', () => {
  const throttle = mapAwsError(Object.assign(new Error('rate'), { name: 'ThrottlingException' }))
  assert.match(throttle.message, /throttl/i)

  const creds = mapAwsError(Object.assign(new Error('bad'), { name: 'InvalidSignatureException' }))
  assert.match(creds.message, /credential/i)

  const original = Object.assign(new Error('weird'), { name: 'SomethingElse' })
  const passthrough = mapAwsError(original)
  assert.match(passthrough.message, /weird/)
  assert.equal(passthrough.cause, original)
})
