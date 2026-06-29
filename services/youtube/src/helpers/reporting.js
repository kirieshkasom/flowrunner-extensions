'use strict'

/**
 * Minimal CSV parser for YouTube Reporting API outputs.
 * - Header row → field names
 * - Standard quoted fields with embedded commas/newlines
 * - Embedded double quotes encoded as ""
 *
 * Returns an array of plain objects keyed by header.
 */
function parseCSV(text) {
  if (!text || typeof text !== 'string') return []

  const rows = parseRows(text)

  if (!rows.length) return []

  const [header, ...dataRows] = rows

  return dataRows.map(row => {
    const obj = {}

    for (let i = 0; i < header.length; i++) {
      obj[header[i]] = row[i] !== undefined ? row[i] : null
    }

    return obj
  })
}

function parseRows(text) {
  const rows = []
  let current = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      current.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      // Push any pending field
      if (field.length || current.length) {
        current.push(field)
        rows.push(current)
        current = []
        field = ''
      }

      // Skip CRLF pair
      if (ch === '\r' && next === '\n') {
        i++
      }
    } else {
      field += ch
    }
  }

  // Final field/row
  if (field.length || current.length) {
    current.push(field)
    rows.push(current)
  }

  return rows.filter(r => r.length > 0 && !(r.length === 1 && r[0] === ''))
}

module.exports = { parseCSV }
