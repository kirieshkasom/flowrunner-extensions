'use strict'

function timeStrToMs(str) {
  const match = str.match(/^(\d+):(\d{2}):(\d{2})[.,](\d{1,3})/)

  if (!match) return null

  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  const fraction = match[4].padEnd(3, '0').slice(0, 3)

  return ((hours * 3600) + (minutes * 60) + seconds) * 1000 + Number(fraction)
}

function detectFormat(content) {
  const trimmed = content.trim()

  if (/^WEBVTT/.test(trimmed)) return 'vtt'
  if (/^\d{1,2}:\d{2}:\d{2}\.\d{3},\d{1,2}:\d{2}:\d{2}\.\d{3}/m.test(trimmed)) return 'sbv'

  return 'srt'
}

/**
 * Parses SRT, WebVTT, or SBV caption text into [{index, startMs, endMs, text}].
 */
function parseCaption(content, format) {
  if (!content) return []

  const fmt = (format || detectFormat(content)).toLowerCase()
  let body = content

  if (fmt === 'vtt') {
    body = body.replace(/^WEBVTT[^\n]*\n+/, '').replace(/\nNOTE\s[^\n]*\n+/g, '\n\n')
  }

  const blocks = body.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean)
  const cues = []

  for (const block of blocks) {
    const lines = block.split('\n')
    const timeIdx = lines.findIndex(line => /\d{1,2}:\d{2}:\d{2}/.test(line))

    if (timeIdx < 0) continue

    const timeLine = lines[timeIdx]
    const textLines = lines.slice(timeIdx + 1).join('\n').trim()

    let startMs
    let endMs

    if (fmt === 'sbv') {
      const m = timeLine.match(/^(\d+:\d{2}:\d{2}\.\d{1,3}),(\d+:\d{2}:\d{2}\.\d{1,3})/)

      if (m) {
        startMs = timeStrToMs(m[1])
        endMs = timeStrToMs(m[2])
      }
    } else {
      const m = timeLine.match(/^(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})/)

      if (m) {
        startMs = timeStrToMs(m[1])
        endMs = timeStrToMs(m[2])
      }
    }

    if (startMs == null) continue

    cues.push({
      index: cues.length + 1,
      startMs,
      endMs,
      text: textLines.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
    })
  }

  return cues
}

/**
 * Reduces parsed cues to a single transcript string (no timing).
 */
function toTranscript(cues) {
  return cues.map(c => c.text).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

module.exports = { parseCaption, toTranscript, detectFormat }
