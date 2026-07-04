'use strict'

const { MAX_BATCH_REQUESTS } = require('../constants')

/**
 * Chunks an array of batchUpdate requests into payloads that respect the per-call limit.
 * Returns an array of `{ requests: [...] }` payload bodies.
 */
function chunkRequests(requests) {
  if (!Array.isArray(requests) || requests.length === 0) return []

  const chunks = []

  for (let i = 0; i < requests.length; i += MAX_BATCH_REQUESTS) {
    chunks.push({ requests: requests.slice(i, i + MAX_BATCH_REQUESTS) })
  }

  return chunks
}

/**
 * Builds a Docs location object that respects segmentId and tabId fields.
 * For body-segment ops, `segmentId` should be omitted (not null) — Docs treats empty string
 * as "header/footer not found".
 */
function buildLocation({ index, segmentId, tabId }) {
  const loc = { index }

  if (segmentId) loc.segmentId = segmentId

  if (tabId) loc.tabId = tabId

  return loc
}

function buildRange({ startIndex, endIndex, segmentId, tabId }) {
  const range = { startIndex, endIndex }

  if (segmentId) range.segmentId = segmentId

  if (tabId) range.tabId = tabId

  return range
}

/**
 * Attaches tab scoping to a batchUpdate request that supports it. The shape of `tabsCriteria`
 * is consistent across requests that target text/style operations in multi-tab docs.
 */
function withTabsCriteria(request, tabId) {
  if (!tabId) return request

  return { ...request, tabsCriteria: { tabIds: [tabId] } }
}

module.exports = { chunkRequests, buildLocation, buildRange, withTabsCriteria }
