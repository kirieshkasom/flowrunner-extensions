'use strict'

async function fetchBytes(url) {
  const res = await fetch(url)

  if (!res.ok) {
    throw new Error(`Failed to fetch file from URL: ${ res.status } ${ res.statusText }`)
  }

  const arrayBuffer = await res.arrayBuffer()

  return Buffer.from(arrayBuffer)
}

function guessImageContentType(url) {
  const lowerUrl = url.toLowerCase().split('?')[0]

  if (lowerUrl.endsWith('.png')) return 'image/png'
  if (lowerUrl.endsWith('.jpg') || lowerUrl.endsWith('.jpeg')) return 'image/jpeg'
  if (lowerUrl.endsWith('.gif')) return 'image/gif'

  return 'image/jpeg'
}

/**
 * Performs a YouTube resumable upload: init session + PUT bytes.
 * Returns parsed JSON response from final PUT.
 */
async function resumableUpload({ initUrl, accessToken, metadata, fileBytes, fileContentType }) {
  const initRes = await fetch(initUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ accessToken }`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(fileBytes.length),
      'X-Upload-Content-Type': fileContentType,
    },
    body: JSON.stringify(metadata),
  })

  if (!initRes.ok) {
    const text = await initRes.text()

    throw new Error(`Upload session init failed: ${ initRes.status } ${ text }`)
  }

  const sessionUrl = initRes.headers.get('location') || initRes.headers.get('Location')

  if (!sessionUrl) {
    throw new Error('Upload session URL missing in response.')
  }

  const uploadRes = await fetch(sessionUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': fileContentType,
      'Content-Length': String(fileBytes.length),
    },
    body: fileBytes,
  })

  if (!uploadRes.ok) {
    const text = await uploadRes.text()

    throw new Error(`Upload failed: ${ uploadRes.status } ${ text }`)
  }

  return await uploadRes.json()
}

/**
 * Direct binary POST upload (used for thumbnails: simpler than resumable).
 */
async function binaryUpload({ url, accessToken, fileBytes, fileContentType }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ accessToken }`,
      'Content-Type': fileContentType,
      'Content-Length': String(fileBytes.length),
    },
    body: fileBytes,
  })

  if (!res.ok) {
    const text = await res.text()

    throw new Error(`Binary upload failed: ${ res.status } ${ text }`)
  }

  return await res.json()
}

module.exports = { fetchBytes, guessImageContentType, resumableUpload, binaryUpload }
