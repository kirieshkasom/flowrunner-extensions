'use strict'

/**
 * Translates user-friendly style flags from FlowRunner params into batchUpdate textStyle
 * + paragraphStyle objects. Returns `{ style, fields }` pairs because Docs requires the
 * caller to specify which fields are being touched via the `fields` mask.
 */

function buildTextStyle({
  bold, italic, underline, strikethrough,
  fontSize, fontFamily,
  foregroundColorHex, backgroundColorHex,
  link,
  baselineOffset,
} = {}) {
  const style = {}
  const fields = []

  if (bold !== undefined && bold !== null) {
    style.bold = !!bold
    fields.push('bold')
  }

  if (italic !== undefined && italic !== null) {
    style.italic = !!italic
    fields.push('italic')
  }

  if (underline !== undefined && underline !== null) {
    style.underline = !!underline
    fields.push('underline')
  }

  if (strikethrough !== undefined && strikethrough !== null) {
    style.strikethrough = !!strikethrough
    fields.push('strikethrough')
  }

  if (fontSize) {
    style.fontSize = { magnitude: Number(fontSize), unit: 'PT' }
    fields.push('fontSize')
  }

  if (fontFamily) {
    style.weightedFontFamily = { fontFamily }
    fields.push('weightedFontFamily')
  }

  if (foregroundColorHex) {
    style.foregroundColor = { color: { rgbColor: hexToRgb(foregroundColorHex) } }
    fields.push('foregroundColor')
  }

  if (backgroundColorHex) {
    style.backgroundColor = { color: { rgbColor: hexToRgb(backgroundColorHex) } }
    fields.push('backgroundColor')
  }

  if (link) {
    style.link = { url: link }
    fields.push('link')
  }

  if (baselineOffset) {
    style.baselineOffset = baselineOffset
    fields.push('baselineOffset')
  }

  return { style, fields: fields.join(',') }
}

function buildParagraphStyle({
  alignment, lineSpacing, namedStyleType,
  spaceAbovePt, spaceBelowPt,
  indentStartPt, indentEndPt,
  direction,
  keepWithNext, keepLinesTogether,
} = {}) {
  const style = {}
  const fields = []

  if (alignment) {
    style.alignment = String(alignment).toUpperCase()
    fields.push('alignment')
  }

  if (lineSpacing) {
    style.lineSpacing = Number(lineSpacing)
    fields.push('lineSpacing')
  }

  if (namedStyleType) {
    style.namedStyleType = String(namedStyleType).toUpperCase()
    fields.push('namedStyleType')
  }

  if (spaceAbovePt !== undefined && spaceAbovePt !== null) {
    style.spaceAbove = { magnitude: Number(spaceAbovePt), unit: 'PT' }
    fields.push('spaceAbove')
  }

  if (spaceBelowPt !== undefined && spaceBelowPt !== null) {
    style.spaceBelow = { magnitude: Number(spaceBelowPt), unit: 'PT' }
    fields.push('spaceBelow')
  }

  if (indentStartPt !== undefined && indentStartPt !== null) {
    style.indentStart = { magnitude: Number(indentStartPt), unit: 'PT' }
    fields.push('indentStart')
  }

  if (indentEndPt !== undefined && indentEndPt !== null) {
    style.indentEnd = { magnitude: Number(indentEndPt), unit: 'PT' }
    fields.push('indentEnd')
  }

  if (direction) {
    style.direction = normalizeDirection(direction)
    fields.push('direction')
  }

  if (keepWithNext !== undefined && keepWithNext !== null) {
    style.keepWithNext = !!keepWithNext
    fields.push('keepWithNext')
  }

  if (keepLinesTogether !== undefined && keepLinesTogether !== null) {
    style.keepLinesTogether = !!keepLinesTogether
    fields.push('keepLinesTogether')
  }

  return { style, fields: fields.join(',') }
}

/**
 * Hex (#RRGGBB or #RGB) → {red,green,blue} 0..1 floats expected by Docs API.
 * Returns black on malformed input rather than throwing — Docs API will reject NaNs anyway.
 */
function hexToRgb(hex) {
  if (!hex) return { red: 0, green: 0, blue: 0 }

  let h = String(hex).trim().replace(/^#/, '')

  if (h.length === 3) {
    h = h.split('').map(c => c + c).join('')
  }

  if (!/^[0-9a-f]{6}$/i.test(h)) return { red: 0, green: 0, blue: 0 }

  return {
    red: parseInt(h.slice(0, 2), 16) / 255,
    green: parseInt(h.slice(2, 4), 16) / 255,
    blue: parseInt(h.slice(4, 6), 16) / 255,
  }
}

/**
 * List preset → bulletPreset enum. Docs supports a fixed set; we map common names.
 * https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/request#bulletglyphpreset
 */
const BULLET_PRESETS = {
  bulleted: 'BULLET_DISC_CIRCLE_SQUARE',
  bulletedArrow: 'BULLET_ARROW_DIAMOND_DISC',
  bulletedChecklist: 'BULLET_CHECKBOX',
  numbered: 'NUMBERED_DECIMAL_ALPHA_ROMAN',
  numberedParens: 'NUMBERED_DECIMAL_ALPHA_ROMAN_PARENS',
  numberedNested: 'NUMBERED_DECIMAL_NESTED',
  upperAlpha: 'NUMBERED_UPPERALPHA_ALPHA_ROMAN',
  upperRoman: 'NUMBERED_UPPERROMAN_UPPERALPHA_DECIMAL',
}

function bulletPreset(name) {
  if (!name) return BULLET_PRESETS.bulleted

  return BULLET_PRESETS[name] || BULLET_PRESETS[String(name).toLowerCase()] || name
}

/**
 * Accepts either the friendly UI label or the raw Docs API enum and returns the API enum.
 * Friendly: "Left to right", "Right to left". API: LEFT_TO_RIGHT, RIGHT_TO_LEFT.
 */
function normalizeDirection(direction) {
  const v = String(direction).trim().toLowerCase().replace(/[\s-]+/g, '_')

  if (v === 'left_to_right' || v === 'ltr') return 'LEFT_TO_RIGHT'

  if (v === 'right_to_left' || v === 'rtl') return 'RIGHT_TO_LEFT'

  return String(direction).toUpperCase()
}

/**
 * Accepts friendly UI labels or raw Docs enums for the values below and returns the API enum.
 */
function normalizeSectionType(value) {
  const v = String(value || '').trim().toLowerCase()

  if (v === 'new page' || v === 'next_page' || v === 'next page') return 'NEXT_PAGE'

  if (v === 'same page' || v === 'continuous' || v === '') return 'CONTINUOUS'

  return String(value).toUpperCase().replace(/\s+/g, '_')
}

function normalizeImageReplaceMethod(value) {
  const v = String(value || '').trim().toLowerCase()

  if (v === 'crop to fit' || v === 'center_crop' || v === 'center crop') return 'CENTER_CROP'

  return 'IMAGE_REPLACE_METHOD_UNSPECIFIED'
}

function normalizeAlignment(value) {
  return String(value || '').toUpperCase().replace(/[\s-]+/g, '_')
}

function normalizeOrientation(value) {
  const v = String(value || '').trim().toLowerCase()

  return v === 'landscape' ? 'landscape' : 'portrait'
}

module.exports = {
  buildTextStyle,
  buildParagraphStyle,
  hexToRgb,
  BULLET_PRESETS,
  bulletPreset,
  normalizeDirection,
  normalizeSectionType,
  normalizeImageReplaceMethod,
  normalizeAlignment,
  normalizeOrientation,
}
