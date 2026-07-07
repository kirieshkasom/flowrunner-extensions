'use strict'

const crypto = require('crypto')

const { PERIOD_PRESETS, PERIOD_LABELS } = require('../constants')

// Resolve a friendly dropdown label back to its GoCardless API value. Unknown values (raw API
// values, custom input) pass through untouched, so both label and wire forms are accepted.
function resolveChoice(value, mapping) {
  if (value === undefined || value === null) return undefined

  return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
}

// Array/comma-list variant of resolveChoice for multi-select dropdowns.
function resolveChoices(input, mapping) {
  const arr = toArray(input).map(v => resolveChoice(v, mapping))

  return arr.length ? arr : undefined
}

// Drop undefined/null/empty entries so query() / send() never emit dangling keys. Returns
// undefined when nothing remains - callers can pass the result straight through.
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

// Normalize String | Array<String> | comma-separated string > real array of trimmed values.
// Used for any GoCardless filter field that supports `?customer=X,Y,Z` semantics or for arrays
// in create-payload bodies.
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

// Comma-joined variant for the same input shape - handy for `?status=pending_submission,submitted`
// style filters.
function toCommaList(input) {
  const arr = toArray(input)

  return arr.length ? arr.join(',') : undefined
}

// Build the Idempotency-Key for a create. An explicit override always wins. Otherwise:
//   - `unique` (money-moving creates): a fresh random key per invocation, so two legitimately
//     identical charges - same mandate, amount and day - both go through instead of the second
//     silently collapsing into the first via GC's 30-day idempotency window (a revenue-loss bug).
//     Callers who DO want retry de-duplication pass their own stable key.
//   - otherwise (identity resources like customers/mandates/bank accounts): a stable key derived
//     from method + args, so an accidental double-submit returns the original record.
function buildIdempotencyKey(methodName, args, overrideKey, unique) {
  if (overrideKey) return String(overrideKey).slice(0, 128)
  if (unique) return crypto.randomUUID()

  const payload = JSON.stringify({ m: methodName, a: args })

  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 64)
}

// Convert a period preset to GC `created_at[gte]` / `created_at[lte]` ISO bounds. `custom` and
// unknown presets return null so caller can layer explicit dates on top.
function resolvePeriod(rawPreset, now = new Date()) {
  const preset = resolveChoice(rawPreset, PERIOD_LABELS)

  if (!preset || preset === 'custom') return null
  if (!(preset in PERIOD_PRESETS)) return null

  const end = new Date(now)
  let start = new Date(now)

  switch (preset) {
    case 'today': {
      start.setUTCHours(0, 0, 0, 0)

      break
    }

    case 'yesterday': {
      start.setUTCDate(start.getUTCDate() - 1)
      start.setUTCHours(0, 0, 0, 0)
      end.setUTCDate(end.getUTCDate() - 1)
      end.setUTCHours(23, 59, 59, 999)

      break
    }

    case 'monthToDate': {
      start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

      break
    }

    case 'yearToDate': {
      start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1))

      break
    }

    default: {
      // last7Days / last30Days / last90Days - preset value is days back.
      const days = PERIOD_PRESETS[preset]

      start.setUTCDate(start.getUTCDate() - days)
    }
  }

  return { gte: start.toISOString(), lte: end.toISOString() }
}

// Layer explicit ISO bounds on top of period preset, then drop empty keys so we never send a
// stray `created_at: {}` (which GC rejects with 400 invalid_api_usage).
function buildCreatedAtFilter({ period, createdAfter, createdBefore }) {
  const fromPreset = resolvePeriod(period) || {}
  const filter = cleanupObject({
    gte: createdAfter || fromPreset.gte,
    lte: createdBefore || fromPreset.lte,
  })

  return filter
}

// String > Date > ISO. Tolerates already-ISO strings, numeric epoch ms, or Date objects. Used
// when callers pass `Modified Since` style timestamps from FlowRunner DATE_PICKER.
function toIsoDateTime(value) {
  if (!value) return undefined
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number') return new Date(value).toISOString()

  return String(value)
}

// Reduce a GoCardless resource to a dictionary item. `label` is what the user sees in the
// dropdown; `value` is the resource id; `note` is supplementary context (e.g. status).
function toDictItem(label, value, note) {
  return { label: label || value, value, note: note || undefined }
}

// All money fields on GoCardless are integers in the minor unit (1000 = 10.00 GBP), never strings.
// Accept numbers/floats/strings and coerce to a rounded integer, defending against accidental
// decimals. See developer.gocardless.com - e.g. create payment takes amount=1000 (an integer).
function toMinorUnits(value) {
  if (value === undefined || value === null || value === '') return undefined

  const num = Number(value)

  if (!Number.isFinite(num)) {
    throw new Error(
      `Invalid amount "${ value }" - expected an integer in minor units (pence/cents)`
    )
  }

  return Math.round(num)
}

module.exports = {
  cleanupObject,
  toArray,
  toCommaList,
  resolveChoice,
  resolveChoices,
  buildIdempotencyKey,
  resolvePeriod,
  buildCreatedAtFilter,
  toIsoDateTime,
  toDictItem,
  toMinorUnits,
}
