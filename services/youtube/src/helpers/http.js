'use strict'

const { logger } = require('./logger')
const { cleanupObject } = require('./utils')
const { extractApiError } = require('./errors')

/**
 * Pure helper that performs a YouTube API request via Flowrunner.Request.
 * Auth header is provided by the caller (the service instance).
 */
async function apiRequest({ url, method, body, query, logTag, headers, authHeader }) {
  method = method || 'get'

  if (query) {
    query = cleanupObject(query)
  }

  try {
    logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

    return await Flowrunner.Request[method](url)
      .set(authHeader)
      .set({ ...(headers || {}) })
      .query(query)
      .send(body)
  } catch (error) {
    logger.error(`${ logTag } - error: ${ JSON.stringify({ ...error, message: error.message }) }`)

    throw new Error(extractApiError(error) || error.message || 'YouTube API request failed')
  }
}

module.exports = { apiRequest }
