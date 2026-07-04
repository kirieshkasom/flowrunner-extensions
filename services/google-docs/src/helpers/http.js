'use strict'

const { logger } = require('./logger')
const { cleanupObject } = require('./utils')
const { extractApiError } = require('./errors')

/**
 * Single chokepoint for Docs + Drive API calls. Centralizes auth, query cleanup, and error wrapping.
 *
 * For Drive endpoints touching files possibly stored in shared drives, callers should set
 * supportsAllDrives: 'true' explicitly via query — we don't auto-inject because the Docs API
 * itself doesn't take that parameter.
 */
async function apiRequest({ url, method, body, query, logTag, headers, authHeader }) {
  method = method || 'get'

  const finalQuery = query ? cleanupObject(query) : undefined

  try {
    logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(finalQuery || {}) }]`)

    const request = Flowrunner.Request[method](url)
      .set(authHeader)
      .set({ ...(headers || {}) })

    if (finalQuery) request.query(finalQuery)

    if (body !== undefined && body !== null) {
      return await request.send(body)
    }

    return await request
  } catch (error) {
    logger.error(`${ logTag } - error: ${ JSON.stringify({ status: error.status, message: error.message, body: error.body }) }`)

    throw new Error(extractApiError(error) || error.message || 'Google API request failed')
  }
}

module.exports = { apiRequest }
