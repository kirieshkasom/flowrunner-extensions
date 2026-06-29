'use strict'

const DAY_MS = 24 * 60 * 60 * 1000

const PERIOD_OPTIONS = [
  'last7Days', 'last14Days', 'last28Days', 'last30Days', 'last90Days',
  'last365Days', 'thisMonth', 'lastMonth', 'thisYear', 'lastYear',
  'yearToDate', 'custom',
]

function todayUTC() {
  return new Date().toISOString().slice(0, 10)
}

function daysAgoUTC(n) {
  return new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10)
}

function startOfMonthUTC(date) {
  return `${ date.getUTCFullYear() }-${ String(date.getUTCMonth() + 1).padStart(2, '0') }-01`
}

function endOfMonthUTC(date) {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))

  return next.toISOString().slice(0, 10)
}

/**
 * Resolves a period preset to a {startDate, endDate} pair (YYYY-MM-DD strings, UTC).
 * Returns null if period is 'custom' or not a recognized preset (caller uses explicit dates).
 */
function resolvePeriod(period) {
  if (!period || period === 'custom') return null

  const today = new Date()

  switch (period) {
    case 'last7Days':
      return { startDate: daysAgoUTC(7), endDate: todayUTC() }
    case 'last14Days':
      return { startDate: daysAgoUTC(14), endDate: todayUTC() }
    case 'last28Days':
      return { startDate: daysAgoUTC(28), endDate: todayUTC() }
    case 'last30Days':
      return { startDate: daysAgoUTC(30), endDate: todayUTC() }
    case 'last90Days':
      return { startDate: daysAgoUTC(90), endDate: todayUTC() }
    case 'last365Days':
      return { startDate: daysAgoUTC(365), endDate: todayUTC() }
    case 'thisMonth':
      return { startDate: startOfMonthUTC(today), endDate: todayUTC() }

    case 'lastMonth': {
      const lastMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))

      return { startDate: startOfMonthUTC(lastMonth), endDate: endOfMonthUTC(lastMonth) }
    }

    case 'thisYear':
      return { startDate: `${ today.getUTCFullYear() }-01-01`, endDate: todayUTC() }

    case 'lastYear': {
      const y = today.getUTCFullYear() - 1

      return { startDate: `${ y }-01-01`, endDate: `${ y }-12-31` }
    }

    case 'yearToDate':
      return { startDate: `${ today.getUTCFullYear() }-01-01`, endDate: todayUTC() }
    default:
      return null
  }
}

/**
 * Picks startDate/endDate to use given a period preset and explicit overrides.
 * Resolution order: period (if not custom) > explicit startDate/endDate > error.
 */
function pickDateRange({ period, startDate, endDate }) {
  const resolved = resolvePeriod(period)

  if (resolved) return resolved

  if (!startDate || !endDate) {
    throw new Error('Provide a Period or both Start Date and End Date.')
  }

  return { startDate, endDate }
}

module.exports = { PERIOD_OPTIONS, resolvePeriod, pickDateRange, todayUTC, daysAgoUTC }
