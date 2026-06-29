'use strict'

const ATTRIBUTE_TYPES = new Set(['S', 'N', 'BOOL', 'NULL', 'B', 'L', 'M', 'SS', 'NS', 'BS'])

function marshall(value) {
  if (value === null || value === undefined) {
    return { NULL: true }
  }

  if (Buffer.isBuffer(value)) {
    return { B: value.toString('base64') }
  }

  const type = typeof value

  if (type === 'string') {
    return { S: value }
  }

  if (type === 'number') {
    return { N: String(value) }
  }

  if (type === 'boolean') {
    return { BOOL: value }
  }

  if (Array.isArray(value)) {
    return { L: value.map(marshall) }
  }

  if (type === 'object') {
    return { M: marshallItem(value) }
  }

  throw new Error(`Cannot marshall value of type ${ type }`)
}

function marshallItem(obj) {
  const out = {}

  for (const [k, v] of Object.entries(obj)) {
    out[k] = marshall(v)
  }

  return out
}

function unmarshall(attr) {
  if (attr === null || attr === undefined) {
    return null
  }

  if ('S' in attr) return attr.S
  if ('N' in attr) return Number(attr.N)
  if ('BOOL' in attr) return attr.BOOL
  if ('NULL' in attr) return null
  if ('B' in attr) return Buffer.from(attr.B, 'base64')
  if ('L' in attr) return attr.L.map(unmarshall)
  if ('M' in attr) return unmarshallItem(attr.M)
  if ('SS' in attr) return attr.SS.slice()
  if ('NS' in attr) return attr.NS.map(Number)
  if ('BS' in attr) return attr.BS.map(b => Buffer.from(b, 'base64'))

  throw new Error(`Cannot unmarshall attribute value: ${ JSON.stringify(attr) }`)
}

function unmarshallItem(map) {
  const out = {}

  for (const [k, v] of Object.entries(map)) {
    out[k] = unmarshall(v)
  }

  return out
}

function isAttributeValue(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Buffer.isBuffer(v)) {
    return false
  }

  const keys = Object.keys(v)

  return keys.length === 1 && ATTRIBUTE_TYPES.has(keys[0])
}

function marshallValues(obj) {
  const out = {}

  for (const [k, v] of Object.entries(obj)) {
    out[k] = isAttributeValue(v) ? v : marshall(v)
  }

  return out
}

function buildUpdateExpression(updates) {
  const entries = Object.entries(updates || {})

  if (entries.length === 0) {
    throw new Error('updateItem requires at least one field in "updates" (or use the raw updateExpression).')
  }

  const names = {}
  const values = {}
  const sets = []

  entries.forEach(([key, value], i) => {
    const nameKey = `#n${ i }`
    const valueKey = `:v${ i }`

    names[nameKey] = key
    values[valueKey] = marshall(value)
    sets.push(`${ nameKey } = ${ valueKey }`)
  })

  return {
    UpdateExpression: 'SET ' + sets.join(', '),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64')
}

function decodeCursor(str) {
  return JSON.parse(Buffer.from(str, 'base64').toString('utf8'))
}

function chunk(array, size) {
  const out = []

  for (let i = 0; i < array.length; i += size) {
    out.push(array.slice(i, i + size))
  }

  return out
}

module.exports = {
  marshall,
  unmarshall,
  marshallItem,
  unmarshallItem,
  isAttributeValue,
  marshallValues,
  buildUpdateExpression,
  encodeCursor,
  decodeCursor,
  chunk,
}
