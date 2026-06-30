'use strict'

const { logger } = require('./logger')
const { cleanupObject } = require('./utils')
const { buildFriendlyMessage } = require('./errors')

// Zoho returns per-record write failures (DUPLICATE_DATA, MANDATORY_NOT_FOUND, ...) as
// `{ data: [{ status:'error', code, message }] }` riding a 2xx response, NOT an HTTP error — so
// without this they'd pass through as "success". Only inspected for writes (GET/read data rows
// are records, never carry a lowercase `status:'error'`).
function throwOnRecordError(result, method, logTag) {
  if (method === 'get') return

  const failed = Array.isArray(result?.data)
    ? result.data.find(row => row?.status === 'error')
    : null

  if (failed) {
    throw new Error(buildFriendlyMessage({ body: result, status: 200 }, logTag))
  }
}

// JSON request via Flowrunner.Request. Caller supplies `authHeader` (Recruit needs the
// Zoho-oauthtoken prefix). Errors get tagged + hinted via buildFriendlyMessage.
async function apiRequest({
  url,
  method,
  body,
  query,
  logTag,
  headers,
  authHeader,
  contentType,
}) {
  method = (method || 'get').toLowerCase()

  const finalQuery = query ? cleanupObject(query) : undefined

  let result

  try {
    logger.debug(
      `${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(finalQuery) }]`
    )

    const request = Flowrunner.Request[method](url)
      .set(authHeader)
      .set({
        'Content-Type': contentType || 'application/json',
        ...(headers || {}),
      })

    if (finalQuery) {
      request.query(finalQuery)
    }

    result =
      body !== undefined && body !== null
        ? await request.send(body)
        : await request
  } catch (error) {
    logger.error(
      `${ logTag } - error http=${ error?.status || error?.statusCode } body=${ JSON.stringify(error?.body) } message=${ error?.message }`
    )

    throw new Error(buildFriendlyMessage(error, logTag))
  }

  // Outside the catch so the already-friendly record-error message isn't re-wrapped.
  throwOnRecordError(result, method, logTag)

  return result
}

// Multipart upload for attachments / resume parser. `parts` items are
// { name, value, fileName?, contentType? } — fileName triggers Blob wrapping.
async function multipartRequest({
  url,
  method,
  parts,
  query,
  logTag,
  authHeader,
  extraFields,
}) {
  method = (method || 'post').toLowerCase()

  const finalQuery = query ? cleanupObject(query) : undefined
  const form = new FormData()

  for (const part of parts) {
    if (part.fileName) {
      const blob = new Blob([part.value], {
        type: part.contentType || 'application/octet-stream',
      })

      form.append(part.name, blob, part.fileName)
    } else {
      form.append(part.name, part.value)
    }
  }

  if (extraFields) {
    for (const [k, v] of Object.entries(extraFields)) {
      if (v !== undefined && v !== null && v !== '') {
        form.append(k, String(v))
      }
    }
  }

  let result

  try {
    logger.debug(
      `${ logTag } - multipart request: [${ method }::${ url }] q=[${ JSON.stringify(finalQuery) }]`
    )

    const request = Flowrunner.Request[method](url).set(authHeader)

    if (finalQuery) {
      request.query(finalQuery)
    }

    result = await request.send(form)
  } catch (error) {
    logger.error(
      `${ logTag } - error http=${ error?.status || error?.statusCode } body=${ JSON.stringify(error?.body) } message=${ error?.message }`
    )

    throw new Error(buildFriendlyMessage(error, logTag))
  }

  // Outside the catch so the already-friendly record-error message isn't re-wrapped.
  throwOnRecordError(result, method, logTag)

  return result
}

// Pull bytes + metadata for a fileUrl parameter. Returns { buffer, contentType, fileName }
// with fileName derived from Content-Disposition (RFC 5987 + plain) or the URL path.
async function fetchBinary(url) {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(
      `[Zoho Recruit][fetch-failed] ${ response.status } ${ response.statusText } for ${ url }`
    )
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  const contentType =
    response.headers.get('content-type') || 'application/octet-stream'
  const cd = response.headers.get('content-disposition') || ''
  const cdMatch = cd.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i)
  let fileName = cdMatch ? decodeURIComponent(cdMatch[1] || cdMatch[2]) : null

  if (!fileName) {
    const urlPath = new URL(url).pathname
    const last = urlPath.split('/').filter(Boolean).pop()

    fileName = last || 'upload.bin'
  }

  return { buffer, contentType, fileName }
}

module.exports = {
  apiRequest,
  multipartRequest,
  fetchBinary,
}
