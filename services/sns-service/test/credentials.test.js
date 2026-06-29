'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { CredentialProvider } = require('../src/credentials')

test('API Key method returns static credentials', async () => {
  const cp = new CredentialProvider({ authenticationMethod: 'API Key', accessKeyId: 'AK', secretAccessKey: 'SK', region: 'us-east-1' })
  assert.deepEqual(await cp.resolve(), { accessKeyId: 'AK', secretAccessKey: 'SK' })
})

test('API Key method throws when credentials missing', async () => {
  const cp = new CredentialProvider({ authenticationMethod: 'API Key', region: 'us-east-1' })
  await assert.rejects(() => cp.resolve(), /Access Key and Secret Key are required/)
})

test('IAM Role method assumes role and returns session credentials', async () => {
  let now = 1_000_000
  const calls = []
  const fakeSts = async (creds, region, roleArn, sessionName, externalId) => {
    calls.push({ roleArn, externalId })

    return { accessKeyId: 'TMP', secretAccessKey: 'TMPS', sessionToken: 'TOK', expiration: new Date(now + 3_600_000) }
  }
  const cp = new CredentialProvider(
    { authenticationMethod: 'IAM Role', accessKeyId: 'AK', secretAccessKey: 'SK', region: 'us-east-1', roleArn: 'arn:aws:iam::1:role/R', externalId: 'EID' },
    { stsAssumeRole: fakeSts, now: () => now },
  )
  const out = await cp.resolve()
  assert.deepEqual(out, { accessKeyId: 'TMP', secretAccessKey: 'TMPS', sessionToken: 'TOK' })
  assert.equal(calls[0].roleArn, 'arn:aws:iam::1:role/R')
  assert.equal(calls[0].externalId, 'EID')
})

test('IAM Role credentials are cached until near expiry', async () => {
  let now = 1_000_000
  let stsCount = 0
  const fakeSts = async () => {
    stsCount++

    return { accessKeyId: 'TMP', secretAccessKey: 'TMPS', sessionToken: 'TOK', expiration: new Date(now + 3_600_000) }
  }
  const cp = new CredentialProvider(
    { authenticationMethod: 'IAM Role', accessKeyId: 'AK', secretAccessKey: 'SK', region: 'us-east-1', roleArn: 'arn:aws:iam::1:role/R' },
    { stsAssumeRole: fakeSts, now: () => now },
  )
  await cp.resolve()
  await cp.resolve()
  assert.equal(stsCount, 1) // second call served from cache

  now += 3_600_000 // advance past expiry buffer
  await cp.resolve()
  assert.equal(stsCount, 2) // re-assumed after expiry
})

test('IAM Role credentials are re-assumed inside the 5-minute expiry buffer', async () => {
  let now = 0
  let stsCount = 0
  const fakeSts = async () => {
    stsCount++
    // expiration is 1 million ms from current time; re-assume threshold is 1_000_000 - 300_000 = 700_000
    return { accessKeyId: 'TMP', secretAccessKey: 'TMPS', sessionToken: 'TOK', expiration: new Date(now + 1_000_000) }
  }
  const cp = new CredentialProvider(
    { authenticationMethod: 'IAM Role', accessKeyId: 'AK', secretAccessKey: 'SK', region: 'us-east-1', roleArn: 'arn:aws:iam::1:role/R' },
    { stsAssumeRole: fakeSts, now: () => now },
  )

  // First resolve at now = 0; expiry will be 1_000_000, buffer threshold will be 700_000
  await cp.resolve()
  assert.equal(stsCount, 1)

  // Advance to now = 699_999 (before buffer threshold), should use cache
  now = 699_999
  await cp.resolve()
  assert.equal(stsCount, 1) // still 1, served from cache

  // Advance to now = 700_001 (inside the 5-minute buffer, but before hard expiry at 1_000_000)
  // should trigger re-assumption
  now = 700_001
  await cp.resolve()
  assert.equal(stsCount, 2) // incremented to 2, re-assumed inside buffer zone
})
