'use strict'

/**
 * Resolves a user-provided string to a canonical YouTube channel ID.
 * Accepts: 24-char UC... ID, @handle, legacy username, or full YouTube URL.
 * Returns { kind: 'id'|'handle'|'username', value } describing how to query the API.
 */
function classifyChannelInput(input) {
  if (!input || typeof input !== 'string') return null

  const trimmed = input.trim()

  if (!trimmed) return null

  // Full URL handling
  const urlMatch = trimmed.match(/^https?:\/\/(?:www\.|m\.)?youtube\.com\/(?:channel\/(UC[A-Za-z0-9_-]{22})|@([A-Za-z0-9_.\-]+)|c\/([A-Za-z0-9_.\-]+)|user\/([A-Za-z0-9_.\-]+))/i)

  if (urlMatch) {
    if (urlMatch[1]) return { kind: 'id', value: urlMatch[1] }
    if (urlMatch[2]) return { kind: 'handle', value: `@${ urlMatch[2] }` }
    if (urlMatch[3]) return { kind: 'username', value: urlMatch[3] }
    if (urlMatch[4]) return { kind: 'username', value: urlMatch[4] }
  }

  // Channel ID
  if (/^UC[A-Za-z0-9_-]{22}$/.test(trimmed)) {
    return { kind: 'id', value: trimmed }
  }

  // Handle
  if (trimmed.startsWith('@')) {
    return { kind: 'handle', value: trimmed }
  }

  // Bare handle without @ (e.g., "MrBeast")
  if (/^[A-Za-z0-9_.\-]+$/.test(trimmed) && trimmed.length <= 30) {
    return { kind: 'username', value: trimmed }
  }

  return null
}

/**
 * Extracts a video ID from a YouTube URL or returns the input if already an 11-char ID.
 */
function extractVideoId(input) {
  if (!input || typeof input !== 'string') return null

  const trimmed = input.trim()

  if (!trimmed) return null

  // 11-char video ID
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) {
    return trimmed
  }

  // youtube.com/watch?v=ID
  let match = trimmed.match(/[?&]v=([A-Za-z0-9_-]{11})/)
  if (match) return match[1]

  // youtu.be/ID
  match = trimmed.match(/^https?:\/\/youtu\.be\/([A-Za-z0-9_-]{11})/i)
  if (match) return match[1]

  // youtube.com/shorts/ID
  match = trimmed.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/i)
  if (match) return match[1]

  // youtube.com/embed/ID
  match = trimmed.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{11})/i)
  if (match) return match[1]

  // youtube.com/v/ID
  match = trimmed.match(/youtube\.com\/v\/([A-Za-z0-9_-]{11})/i)
  if (match) return match[1]

  return null
}

/**
 * Extracts a playlist ID from a YouTube URL or returns the input if already a PL... ID.
 */
function extractPlaylistId(input) {
  if (!input || typeof input !== 'string') return null

  const trimmed = input.trim()

  if (!trimmed) return null

  // Direct playlist ID (PL/UU/LL/FL prefix)
  if (/^(PL|UU|LL|FL|RD|OL)[A-Za-z0-9_-]+$/.test(trimmed)) {
    return trimmed
  }

  const match = trimmed.match(/[?&]list=([A-Za-z0-9_-]+)/)

  if (match) return match[1]

  return null
}

module.exports = {
  classifyChannelInput,
  extractVideoId,
  extractPlaylistId,
}
