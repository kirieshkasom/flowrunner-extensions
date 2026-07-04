'use strict'

function cleanupObject(data) {
  if (!data || typeof data !== 'object') return data

  const result = {}

  Object.keys(data).forEach(key => {
    const value = data[key]

    if (value !== undefined && value !== null && value !== '') {
      result[key] = value
    }
  })

  return result
}

function searchFilter(list, props, searchString) {
  if (!searchString) return list

  return list.filter(item =>
    props.some(prop => {
      const value = prop.split('.').reduce((acc, key) => acc?.[key], item)

      return value && String(value).toLowerCase().includes(searchString.toLowerCase())
    })
  )
}

function clampInt(value, min, max, fallback) {
  const n = Number(value)

  if (!Number.isFinite(n)) return fallback

  return Math.max(min, Math.min(max, Math.floor(n)))
}

function toArray(input) {
  if (input == null || input === '') return []

  if (Array.isArray(input)) return input.filter(v => v !== null && v !== undefined && v !== '').map(String)

  return String(input).split(',').map(s => s.trim()).filter(Boolean)
}

function ensureRfc3339(value) {
  if (!value) return undefined

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
    return value
  }

  const d = new Date(value)

  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date: ${ value }`)
  }

  return d.toISOString()
}

function asBool(value) {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false

  return undefined
}

/**
 * Picks a subset of fields from an object — drops nullish values.
 */
function compact(obj) {
  if (!obj || typeof obj !== 'object') return obj

  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''))
}

/**
 * Walks a Docs body element tree and returns a flat array of `{ type, element, segmentId, tabId }`
 * entries for every paragraph/table/sectionBreak/tableOfContents. Used by extractors.
 */
function walkBodyElements(body, { segmentId = null, tabId = null } = {}) {
  if (!body?.content) return []

  const out = []

  for (const el of body.content) {
    if (el.paragraph) out.push({ type: 'paragraph', element: el, segmentId, tabId })
    else if (el.table) out.push({ type: 'table', element: el, segmentId, tabId })
    else if (el.sectionBreak) out.push({ type: 'sectionBreak', element: el, segmentId, tabId })
    else if (el.tableOfContents) out.push({ type: 'tableOfContents', element: el, segmentId, tabId })
  }

  return out
}

/**
 * Concatenates the `textRun.content` strings inside a paragraph element.
 * Skips inline objects and personMentions for the plain-text view.
 */
function paragraphPlainText(paragraph) {
  if (!paragraph?.elements) return ''

  return paragraph.elements
    .map(e => e.textRun?.content || e.personMention?.textStyle?.link?.url || '')
    .join('')
}

/**
 * Returns a Date.now()-based ISO timestamp + random suffix. Used for unique names in samples.
 */
function timestampSuffix() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

module.exports = {
  cleanupObject,
  searchFilter,
  clampInt,
  toArray,
  ensureRfc3339,
  asBool,
  compact,
  walkBodyElements,
  paragraphPlainText,
  timestampSuffix,
}
