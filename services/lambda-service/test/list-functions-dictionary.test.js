'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

global.Backendless = { ServerCode: { addService: () => {} } }

const { Lambda } = require('../src/index')

function makeLambda() {
  return new Lambda({ region: 'us-east-1', authenticationMethod: 'API Key', accessKeyId: 'AK', secretAccessKey: 'SK' })
}

const SAMPLE_FUNCTIONS = [
  { FunctionName: 'FunctionAlpha', Runtime: 'nodejs20.x' },
  { FunctionName: 'FunctionBeta', Runtime: 'python3.12' },
  { FunctionName: 'UtilityGamma', Runtime: 'go1.x' },
]

test('listFunctionsDictionary: maps Functions to label/value/note items', async () => {
  const lambda = makeLambda()
  const captured = {}

  lambda.sendRest = async (method, path) => {
    captured.method = method
    captured.path = path
    return { Functions: SAMPLE_FUNCTIONS, NextMarker: null }
  }

  const result = await lambda.listFunctionsDictionary({})

  assert.equal(captured.method, 'GET')
  assert.ok(captured.path.startsWith('/2015-03-31/functions?MaxItems=50'))
  assert.deepEqual(result, {
    items: [
      { label: 'FunctionAlpha', value: 'FunctionAlpha', note: 'nodejs20.x' },
      { label: 'FunctionBeta', value: 'FunctionBeta', note: 'python3.12' },
      { label: 'UtilityGamma', value: 'UtilityGamma', note: 'go1.x' },
    ],
    cursor: null,
  })
})

test('listFunctionsDictionary: filters by search (case-insensitive)', async () => {
  const lambda = makeLambda()

  lambda.sendRest = async () => ({ Functions: SAMPLE_FUNCTIONS })

  const result = await lambda.listFunctionsDictionary({ search: 'function' })

  assert.equal(result.items.length, 2)
  assert.equal(result.items[0].label, 'FunctionAlpha')
  assert.equal(result.items[1].label, 'FunctionBeta')
})

test('listFunctionsDictionary: cursor passed as Marker query param', async () => {
  const lambda = makeLambda()
  const captured = {}

  lambda.sendRest = async (method, path) => {
    captured.path = path
    return { Functions: [] }
  }

  await lambda.listFunctionsDictionary({ cursor: 'abc123==' })

  assert.ok(captured.path.includes('&Marker=abc123%3D%3D'), `Expected Marker in path, got: ${captured.path}`)
})

test('listFunctionsDictionary: NextMarker returned as cursor', async () => {
  const lambda = makeLambda()

  lambda.sendRest = async () => ({
    Functions: SAMPLE_FUNCTIONS,
    NextMarker: 'nextPage==',
  })

  const result = await lambda.listFunctionsDictionary({})

  assert.equal(result.cursor, 'nextPage==')
})

test('listFunctionsDictionary: no NextMarker → cursor null', async () => {
  const lambda = makeLambda()

  lambda.sendRest = async () => ({ Functions: SAMPLE_FUNCTIONS })

  const result = await lambda.listFunctionsDictionary({})

  assert.equal(result.cursor, null)
})

test('listFunctionsDictionary: empty payload uses defaults', async () => {
  const lambda = makeLambda()

  lambda.sendRest = async () => ({ Functions: [] })

  const result = await lambda.listFunctionsDictionary()

  assert.deepEqual(result, { items: [], cursor: null })
})

test('listFunctionsDictionary: search is empty string (no filter applied)', async () => {
  const lambda = makeLambda()

  lambda.sendRest = async () => ({ Functions: SAMPLE_FUNCTIONS })

  const result = await lambda.listFunctionsDictionary({ search: '' })

  assert.equal(result.items.length, 3)
})

test('listFunctionsDictionary: propagates AWS error via #handleError', async () => {
  const lambda = makeLambda()
  const err = new Error('Too many requests')

  err.name = 'TooManyRequestsException'
  lambda.sendRest = async () => {
    throw err
  }

  await assert.rejects(
    () => lambda.listFunctionsDictionary({}),
    e => {
      assert.ok(e.message.toLowerCase().includes('too many') || e.message.toLowerCase().includes('request'))
      return true
    },
  )
})
