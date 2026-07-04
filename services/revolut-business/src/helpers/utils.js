function clean(obj) {
  if (!obj || typeof obj !== 'object') {
    return obj
  }

  const result = {}

  for (const key of Object.keys(obj)) {
    const value = obj[key]

    if (value === undefined || value === null || value === '') {
      continue
    }

    if (Array.isArray(value) && value.length === 0) {
      continue
    }

    result[key] = value
  }

  return result
}

function searchFilter(items, fields, search) {
  if (!search) {
    return items
  }

  const needle = String(search).toLowerCase()

  return items.filter(item =>
    fields.some(field => {
      const value = field.split('.').reduce((acc, key) => acc?.[key], item)

      return value != null && String(value).toLowerCase().includes(needle)
    })
  )
}

function toArray(value) {
  if (value == null || value === '') {
    return []
  }

  if (Array.isArray(value)) {
    return value
  }

  return String(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function generateRequestId() {
  // RFC 4122 v4 UUID via Node's crypto module (always available in CodeRunner).
  const { randomUUID } = require('crypto')

  if (typeof randomUUID === 'function') {
    return randomUUID()
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8

    return v.toString(16)
  })
}

function toMinorUnits(amount, fractionDigits = 2) {
  const num = Number(amount)

  if (!Number.isFinite(num)) {
    return null
  }

  return Math.round(num * Math.pow(10, fractionDigits))
}

function fromMinorUnits(amount, fractionDigits = 2) {
  const num = Number(amount)

  if (!Number.isFinite(num)) {
    return null
  }

  return num / Math.pow(10, fractionDigits)
}

module.exports = {
  clean,
  searchFilter,
  toArray,
  generateRequestId,
  toMinorUnits,
  fromMinorUnits,
}
