'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const { httpRequest, parseXmlTag, parseXmlTags } = require('../src/aws-client')

test('parseXmlTag returns the first tag content or null', () => {
  assert.equal(parseXmlTag('<Code>NoSuchKey</Code>', 'Code'), 'NoSuchKey')
  assert.equal(parseXmlTag('<other>x</other>', 'Code'), null)
})

test('parseXmlTags returns all matches', () => {
  assert.deepEqual(parseXmlTags('<N>a</N><N>b</N>', 'N'), ['a', 'b'])
})

test('httpRequest performs a real request against a local server', async () => {
  const server = http.createServer((req, res) => {
    let received = ''
    req.on('data', c => (received += c))
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ echoed: received, method: req.method }))
    })
  })

  await new Promise(resolve => server.listen(0, resolve))
  const port = server.address().port

  try {
    const response = await httpRequest('POST', `http://127.0.0.1:${port}/`, { 'content-type': 'application/json' }, '{"a":1}')
    assert.equal(response.statusCode, 200)
    const parsed = JSON.parse(response.body)
    assert.equal(parsed.method, 'POST')
    assert.equal(parsed.echoed, '{"a":1}')
  } finally {
    server.close()
  }
})
