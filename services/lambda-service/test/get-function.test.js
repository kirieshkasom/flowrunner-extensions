'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

global.Backendless = { ServerCode: { addService: () => {} } }

const { Lambda } = require('../src/index')

function makeLambda() {
  return new Lambda({ region: 'us-east-1', authenticationMethod: 'API Key', accessKeyId: 'AK', secretAccessKey: 'SK' })
}

test('getFunction: sends GET to correct path and normalizes Configuration fields', async () => {
  const lambda = makeLambda()
  const captured = {}

  lambda.sendRest = async (method, path) => {
    captured.method = method
    captured.path = path
    return {
      Configuration: {
        FunctionName: 'myFn',
        Runtime: 'nodejs20.x',
        Handler: 'index.handler',
        Description: 'My function',
        Timeout: 30,
        MemorySize: 128,
        CodeSize: 1024,
        LastModified: '2026-01-01T00:00:00.000+0000',
        State: 'Active',
        Version: '$LATEST',
        Role: 'arn:aws:iam::123:role/my-role',
        FunctionArn: 'arn:aws:lambda:us-east-1:123:function:myFn',
      },
      Code: { RepositoryType: 'S3', Location: 'https://...' },
    }
  }

  const result = await lambda.getFunction('myFn')

  assert.equal(captured.method, 'GET')
  assert.equal(captured.path, '/2015-03-31/functions/myFn')
  assert.deepEqual(result, {
    functionName: 'myFn',
    runtime: 'nodejs20.x',
    handler: 'index.handler',
    description: 'My function',
    timeout: 30,
    memorySize: 128,
    codeSize: 1024,
    lastModified: '2026-01-01T00:00:00.000+0000',
    state: 'Active',
    version: '$LATEST',
    role: 'arn:aws:iam::123:role/my-role',
    arn: 'arn:aws:lambda:us-east-1:123:function:myFn',
  })
})

test('getFunction: encodes function name in path', async () => {
  const lambda = makeLambda()
  const captured = {}

  lambda.sendRest = async (method, path) => {
    captured.path = path
    return { Configuration: {} }
  }

  await lambda.getFunction('my fn/name')

  assert.equal(captured.path, '/2015-03-31/functions/my%20fn%2Fname')
})

test('getFunction: missing Configuration fields become undefined', async () => {
  const lambda = makeLambda()

  lambda.sendRest = async () => ({ Configuration: { FunctionName: 'sparse' } })

  const result = await lambda.getFunction('sparse')

  assert.equal(result.functionName, 'sparse')
  assert.equal(result.runtime, undefined)
  assert.equal(result.handler, undefined)
})

test('getFunction: empty response (no Configuration) returns all undefined fields', async () => {
  const lambda = makeLambda()

  lambda.sendRest = async () => ({})

  const result = await lambda.getFunction('sparse')

  assert.equal(result.functionName, undefined)
})

test('getFunction: functionName required — throws before try/catch', async () => {
  const lambda = makeLambda()

  await assert.rejects(
    () => lambda.getFunction(''),
    err => {
      assert.ok(err.message.includes('functionName'))
      return true
    },
  )
})

test('getFunction: propagates AWS error from sendRest via #handleError', async () => {
  const lambda = makeLambda()
  const err = new Error('Function not found: arn:...')

  err.name = 'ResourceNotFoundException'
  lambda.sendRest = async () => {
    throw err
  }

  await assert.rejects(
    () => lambda.getFunction('noFn'),
    e => {
      assert.ok(e.message.includes('not found'))
      return true
    },
  )
})
