const { logger } = require('./logger')
const { wrapApiError } = require('./errors')
const { clean } = require('./utils')

// Wraps Flowrunner.Request to centralise logging + friendly error
// translation. All methods receive absolute URLs (per the FlowRunner
// extension rules) and the auth header is injected by the caller.

async function apiRequest({
  url,
  method = 'get',
  body,
  query,
  headers,
  logTag,
}) {
  const cleanQuery = query ? clean(query) : undefined

  logger.debug(
    `[${ logTag }] ${ method.toUpperCase() } ${ url }${ cleanQuery && Object.keys(cleanQuery).length ? ` q=${ JSON.stringify(cleanQuery) }` : '' }`
  )

  try {
    let request = Flowrunner.Request[method](url)

    if (headers) {
      request = request.set(headers)
    }

    if (cleanQuery && Object.keys(cleanQuery).length) {
      request = request.query(cleanQuery)
    }

    if (body !== undefined && body !== null) {
      return await request.send(body)
    }

    return await request
  } catch (error) {
    throw wrapApiError(error, logTag)
  }
}

module.exports = {
  apiRequest,
}
