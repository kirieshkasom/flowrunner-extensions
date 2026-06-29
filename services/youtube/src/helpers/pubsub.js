'use strict'

const crypto = require('crypto')

const HUB_URL = 'https://pubsubhubbub.appspot.com/subscribe'
const TOPIC_BASE = 'https://www.youtube.com/xml/feeds/videos.xml'
const DEFAULT_LEASE_SECONDS = 864000 // 10 days, hub maximum
const RENEWAL_THRESHOLD_MS = 24 * 60 * 60 * 1000 // re-subscribe when <24h to expiry

function buildTopicForChannel(channelId) {
  return `${ TOPIC_BASE }?channel_id=${ encodeURIComponent(channelId) }`
}

function generateSecret() {
  return crypto.randomBytes(20).toString('hex')
}

/**
 * Sends a PubSubHubbub subscribe/unsubscribe request.
 * Returns { ok, status } — hub responds with 202 Accepted on success.
 */
async function callHub({ mode, channelId, callbackUrl, secret, leaseSeconds }) {
  const params = new URLSearchParams()

  params.append('hub.callback', callbackUrl)
  params.append('hub.topic', buildTopicForChannel(channelId))
  params.append('hub.verify', 'async')
  params.append('hub.mode', mode)

  if (mode === 'subscribe') {
    params.append('hub.lease_seconds', String(leaseSeconds || DEFAULT_LEASE_SECONDS))

    if (secret) params.append('hub.secret', secret)
  }

  const res = await fetch(HUB_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  return { ok: res.ok, status: res.status }
}

async function subscribeToChannelFeed({ channelId, callbackUrl, secret, leaseSeconds }) {
  return callHub({ mode: 'subscribe', channelId, callbackUrl, secret, leaseSeconds })
}

async function unsubscribeFromChannelFeed({ channelId, callbackUrl }) {
  return callHub({ mode: 'unsubscribe', channelId, callbackUrl })
}

/**
 * Verifies the HMAC-SHA1 signature on a notification body.
 * `signatureHeader` is the X-Hub-Signature value (e.g., "sha1=abc123").
 */
function verifyHubSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret || !rawBody) return false

  const match = signatureHeader.match(/^sha1=([0-9a-f]+)$/i)

  if (!match) return false

  const expected = crypto.createHmac('sha1', secret).update(rawBody).digest('hex')
  const provided = match[1]

  if (expected.length !== provided.length) return false

  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'))
}

function decodeXmlEntities(text) {
  if (typeof text !== 'string') return text

  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
}

function pickTag(block, tag) {
  const re = new RegExp(`<${ tag }[^>]*>([\\s\\S]*?)<\\/${ tag }>`)
  const match = block.match(re)

  return match ? decodeXmlEntities(match[1].trim()) : null
}

function pickAttr(block, tag, attr) {
  const re = new RegExp(`<${ tag }[^>]*\\b${ attr }="([^"]*)"`)
  const match = block.match(re)

  return match ? decodeXmlEntities(match[1]) : null
}

/**
 * Parses a YouTube PubSubHubbub Atom notification into events.
 * Returns array of { videoId, channelId, title, link, authorName, publishedAt, updatedAt, isUpdate }.
 */
function parseAtomNotification(xml) {
  if (!xml || typeof xml !== 'string') return []

  const entries = xml.match(/<entry\b[\s\S]*?<\/entry>/g) || []

  return entries.map(block => {
    const videoId = pickTag(block, 'yt:videoId')
    const channelId = pickTag(block, 'yt:channelId')
    const title = pickTag(block, 'title')
    const publishedAt = pickTag(block, 'published')
    const updatedAt = pickTag(block, 'updated')
    const link = pickAttr(block, 'link', 'href')
    const authorName = pickTag(block, 'name')

    let isUpdate = false

    if (publishedAt && updatedAt) {
      const pub = Date.parse(publishedAt)
      const upd = Date.parse(updatedAt)

      if (Number.isFinite(pub) && Number.isFinite(upd)) {
        isUpdate = upd - pub > 60 * 1000 // >1 min apart = treat as edit
      }
    }

    return { videoId, channelId, title, link, authorName, publishedAt, updatedAt, isUpdate }
  }).filter(e => e.videoId)
}

module.exports = {
  HUB_URL,
  DEFAULT_LEASE_SECONDS,
  RENEWAL_THRESHOLD_MS,
  buildTopicForChannel,
  generateSecret,
  subscribeToChannelFeed,
  unsubscribeFromChannelFeed,
  verifyHubSignature,
  parseAtomNotification,
}
