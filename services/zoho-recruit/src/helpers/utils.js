'use strict'

const crypto = require('crypto')

// Drop undefined/null/empty-string entries. Returns undefined when nothing remains, so callers
// can pass the result straight to query() without dragging empty maps onto the URL.
function cleanupObject(data) {
  if (!data || typeof data !== 'object') return data

  const result = {}

  for (const key of Object.keys(data)) {
    const value = data[key]

    if (value !== undefined && value !== null && value !== '') {
      result[key] = value
    }
  }

  return Object.keys(result).length > 0 ? result : undefined
}

// Client-side substring filter — used by dictionaries whose Zoho endpoint returns the full list
// (e.g. /settings/modules, /settings/fields).
function searchFilter(list, props, searchString) {
  if (!searchString) return list

  const needle = String(searchString).toLowerCase()

  return list.filter(item =>
    props.some(prop => {
      const value = prop.split('.').reduce((acc, k) => acc?.[k], item)

      return (
        value !== undefined &&
        value !== null &&
        String(value).toLowerCase().includes(needle)
      )
    })
  )
}

// Normalize String | Array<String> | comma-separated string → comma-joined string. Used for
// Zoho's `ids=a,b,c` query convention. Returns undefined when no usable values remain.
function toCommaList(input) {
  if (input === undefined || input === null || input === '') return undefined

  if (Array.isArray(input)) {
    return (
      input
        .filter(v => v !== undefined && v !== null && v !== '')
        .join(',') || undefined
    )
  }

  return String(input).trim() || undefined
}

// Same coercion as toCommaList but returns a real array — for JSON body fields that expect one.
function toArray(input) {
  if (input === undefined || input === null || input === '') return []

  if (Array.isArray(input)) {
    return input.filter(v => v !== undefined && v !== null && v !== '')
  }

  return String(input)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

// 32-char hex shared secret echoed back in Notification API webhooks for verification.
function generateNotificationToken() {
  return crypto.randomBytes(16).toString('hex')
}

// Notification API requires channel_id to be a digit-string. 13-digit timestamp + 4 random
// digits is collision-safe enough for our subscription density.
function generateChannelId() {
  return `${ Date.now() }${ Math.floor(Math.random() * 9000 + 1000) }`
}

// Pass-through for ISO strings; Date → ISO; anything else → undefined.
function toZohoDateTime(value) {
  if (!value) return undefined

  if (typeof value === 'string') return value

  if (value instanceof Date) return value.toISOString()

  return undefined
}

function looksLikeUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

module.exports = {
  cleanupObject,
  searchFilter,
  toCommaList,
  toArray,
  generateNotificationToken,
  generateChannelId,
  toZohoDateTime,
  looksLikeUrl,
}
