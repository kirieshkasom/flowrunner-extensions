'use strict'

function cleanupObject(data) {
  const result = {}

  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null && data[key] !== '') {
      result[key] = data[key]
    }
  })

  return result
}

function searchFilter(list, props, searchString) {
  return list.filter(item =>
    props.some(prop => {
      const value = prop.split('.').reduce((acc, key) => acc?.[key], item)

      return value && String(value).toLowerCase().includes(searchString.toLowerCase())
    })
  )
}

function clampInt(value, min, max, fallback) {
  const n = Number(value)

  if (!Number.isFinite(n)) {
    return fallback
  }

  return Math.max(min, Math.min(max, Math.floor(n)))
}

function extractApiError(error) {
  const apiError = error?.body?.error || error?.response?.error

  if (apiError?.message) {
    const reason = apiError.errors?.[0]?.reason
      ? ` (${ apiError.errors[0].reason })`
      : ''

    return `YouTube API: ${ apiError.message }${ reason }`
  }

  return null
}

/**
 * Returns true if an ISO 8601 duration (e.g., "PT45S", "PT1M") is under 60 seconds.
 * Used to detect YouTube Shorts.
 */
function isShortDuration(iso) {
  if (!iso || typeof iso !== 'string') return false

  const match = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/)

  if (!match) return false

  const hours = Number(match[1] || 0)
  const minutes = Number(match[2] || 0)
  const seconds = Number(match[3] || 0)
  const totalSeconds = (hours * 3600) + (minutes * 60) + seconds

  return totalSeconds > 0 && totalSeconds < 60
}

function ensureDate(value) {
  if (!value) return value

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value
  }

  const d = new Date(value)

  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date: ${ value }`)
  }

  return d.toISOString().slice(0, 10)
}

module.exports = {
  cleanupObject,
  searchFilter,
  clampInt,
  extractApiError,
  ensureDate,
  isShortDuration,
}
