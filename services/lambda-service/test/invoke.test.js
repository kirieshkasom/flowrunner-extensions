'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

// We require index.js which may call Backendless.ServerCode.addService — guard it
global.Backendless = { ServerCode: { addService: () => {} } }

const { Lambda } = require('../src/index')

function makeLambda() {
  return new Lambda({ region: 'us-east-1', authenticationMethod: 'API Key', accessKeyId: 'AK', secretAccessKey: 'SK' })
}

// --- invoke ---

test('invoke: RequestResponse 200 with JSON body returns statusCode, functionError null, payload parsed', async () => {
  const lambda = makeLambda()
  const rawRes = { statusCode: 200, headers: {}, body: '{"result":"ok","value":42}' }

  lambda.invokeRaw = async (path, payload, invocationType) => {
    assert.equal(path, '/2015-03-31/functions/myFn/invocations')
    assert.equal(invocationType, 'RequestResponse')
    assert.deepEqual(payload, { input: 'hello' })
    return rawRes
  }

  const result = await lambda.invoke('myFn', { input: 'hello' }, 'RequestResponse')

  assert.deepEqual(result, { statusCode: 200, functionError: null, payload: { result: 'ok', value: 42 } })
})

test('invoke: Event 202 with empty body returns payload null', async () => {
  const lambda = makeLambda()

  lambda.invokeRaw = async (path, payload, invocationType) => {
    assert.equal(invocationType, 'Event')
    return { statusCode: 202, headers: {}, body: '' }
  }

  const result = await lambda.invoke('myFn', null, 'Event')

  assert.deepEqual(result, { statusCode: 202, functionError: null, payload: null })
})

test('invoke: x-amz-function-error header populates functionError', async () => {
  const lambda = makeLambda()

  lambda.invokeRaw = async () => ({
    statusCode: 200,
    headers: { 'x-amz-function-error': 'Handled' },
    body: '{"errorMessage":"oops","errorType":"Error"}',
  })

  const result = await lambda.invoke('myFn', {}, 'RequestResponse')

  assert.equal(result.functionError, 'Handled')
  assert.deepEqual(result.payload, { errorMessage: 'oops', errorType: 'Error' })
})

test('invoke: statusCode >= 300 throws via parseJsonResponse', async () => {
  const lambda = makeLambda()

  lambda.invokeRaw = async () => ({
    statusCode: 404,
    headers: {},
    body: '{"__type":"ResourceNotFoundException","message":"Function not found: arn:aws:lambda:us-east-1:123:function:noFn"}',
  })

  await assert.rejects(
    () => lambda.invoke('noFn', {}, 'RequestResponse'),
    err => {
      assert.equal(err.name, 'ResourceNotFoundException')
      assert.ok(err.message.includes('Function not found'))
      return true
    },
  )
})

test('invoke: path encodes function name', async () => {
  const lambda = makeLambda()
  const captured = {}

  lambda.invokeRaw = async (path, payload, invocationType) => {
    captured.path = path
    return { statusCode: 200, headers: {}, body: 'null' }
  }

  await lambda.invoke('my fn/name', {}, 'RequestResponse')

  assert.equal(captured.path, '/2015-03-31/functions/my%20fn%2Fname/invocations')
})

test('invoke: defaults invocationType to RequestResponse when omitted', async () => {
  const lambda = makeLambda()
  const captured = {}

  lambda.invokeRaw = async (path, payload, invocationType) => {
    captured.invocationType = invocationType
    return { statusCode: 200, headers: {}, body: '{}' }
  }

  await lambda.invoke('myFn')

  assert.equal(captured.invocationType, 'RequestResponse')
})

test('invoke: non-JSON body falls back to raw string in payload', async () => {
  const lambda = makeLambda()

  lambda.invokeRaw = async () => ({
    statusCode: 200,
    headers: {},
    body: 'plain text response',
  })

  const result = await lambda.invoke('myFn', {}, 'RequestResponse')

  assert.equal(result.payload, 'plain text response')
})

test('invoke: functionName required validation throws before try/catch', async () => {
  const lambda = makeLambda()

  await assert.rejects(
    () => lambda.invoke(''),
    err => {
      assert.ok(err.message.includes('functionName'))
      return true
    },
  )
})

test('invoke: DryRun 204 with no body returns payload null', async () => {
  const lambda = makeLambda()

  lambda.invokeRaw = async (path, payload, invocationType) => {
    assert.equal(invocationType, 'DryRun')
    return { statusCode: 204, headers: {}, body: '' }
  }

  const result = await lambda.invoke('myFn', {}, 'DryRun')

  assert.deepEqual(result, { statusCode: 204, functionError: null, payload: null })
})
