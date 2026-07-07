'use strict'

const { logger } = require('./logger')
const { cleanupObject } = require('./utils')
const { buildFriendlyMessage } = require('./errors')
const { API_VERSION } = require('../constants')

// Single request factory for all GoCardless API calls. Pin the `GoCardless-Version` header
// here so individual methods can't accidentally omit it (silent 400 missing_api_version).
async function apiRequest({
  url,
  method,
  body,
  query,
  logTag,
  headers,
  accessToken,
  idempotencyKey,
}) {
  method = (method || 'get').toLowerCase()

  const finalQuery = query ? cleanupObject(query) : undefined

  const finalHeaders = {
    Authorization: `Bearer ${ accessToken }`,
    'GoCardless-Version': API_VERSION,
    Accept: 'application/json',
    ...(headers || {}),
  }

  if (body !== undefined && body !== null) {
    finalHeaders['Content-Type'] = 'application/json'
  }

  if (idempotencyKey && (method === 'post' || method === 'put')) {
    finalHeaders['Idempotency-Key'] = idempotencyKey
  }

  try {
    logger.debug(
      `${ logTag } - ${ method.toUpperCase() } ${ url } q=${ JSON.stringify(finalQuery) }`
    )

    const request = Flowrunner.Request[method](url).set(finalHeaders)

    if (finalQuery) {
      request.query(finalQuery)
    }

    if (body !== undefined && body !== null) {
      return await request.send(body)
    }

    return await request
  } catch (error) {
    const status = error?.status || error?.statusCode
    const bodySnippet = error?.body
      ? JSON.stringify(error.body).slice(0, 400)
      : ''

    logger.error(
      `${ logTag } - http=${ status } body=${ bodySnippet } msg=${ error?.message }`
    )

    const friendly = new Error(buildFriendlyMessage(error, logTag))

    // Preserve original metadata so handlers (idempotent replay recovery, retries) can introspect.
    friendly.originalError = error
    friendly.status = status

    throw friendly
  }
}

// Walk through cursor-paginated list endpoints until exhausted (or `maxPages` reached). Each
// page is fetched via the supplied `fetchPage(after)` callback that returns
// `{ items, cursors: { after } }`. Returns merged items in order.
async function fetchAllPages(fetchPage, { maxPages = 100 } = {}) {
  const all = []
  let after = null
  let pages = 0

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (pages >= maxPages) break

    const page = await fetchPage(after)

    if (page?.items?.length) {
      all.push(...page.items)
    }

    after = page?.cursors?.after || null
    pages++

    if (!after) break
  }

  return { items: all, pageCount: pages, truncated: !!after }
}

module.exports = {
  apiRequest,
  fetchAllPages,
}
