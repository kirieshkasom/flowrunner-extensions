'use strict'

/**
 * Zero-dependency XML parser for AWS Query-protocol (ELBv2) responses.
 *
 * AWS Query responses are simple, well-formed XML: element nodes, text leaves,
 * and repeating <member> elements for lists. There are no attributes we care
 * about, no CDATA, and no mixed content. This tokenizer-based parser turns such
 * XML into plain JS objects:
 *
 *   - A leaf element becomes its (entity-decoded) text value.
 *   - An element with child elements becomes an object keyed by child tag name.
 *   - Repeated sibling tags (notably <member>) collapse into an array.
 *
 * It is intentionally small and only supports the subset of XML that AWS emits.
 */

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
}

/**
 * Decodes the XML entities AWS uses, including numeric character references.
 * @param {string} text
 * @returns {string}
 */
function decodeEntities(text) {
  return text
    .replace(/&(amp|lt|gt|quot|apos);/g, m => ENTITIES[m])
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
}

/**
 * Adds a value under a key on an object, promoting to an array when the key
 * repeats (e.g. multiple <member> siblings).
 * @param {Object} obj
 * @param {string} key
 * @param {*} value
 */
function assign(obj, key, value) {
  if (Object.prototype.hasOwnProperty.call(obj, key)) {
    if (Array.isArray(obj[key])) {
      obj[key].push(value)
    } else {
      obj[key] = [obj[key], value]
    }
  } else {
    obj[key] = value
  }
}

/**
 * Parses an XML document into a plain JS object.
 * @param {string} xml
 * @returns {Object} Object keyed by the root element's tag name.
 */
function parseXml(xml) {
  const clean = String(xml || '')
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')

  const tokenRe = /<\/?([A-Za-z_][\w.:-]*)((?:\s+[^<>]*?)?)\s*(\/?)>|([^<]+)/g
  const root = {}
  const stack = [{ node: root, text: '' }]
  let match

  while ((match = tokenRe.exec(clean)) !== null) {
    const [, tagName, , selfClose, text] = match

    if (text !== undefined) {
      stack[stack.length - 1].text += text
      continue
    }

    const raw = match[0]
    const isClose = raw[1] === '/'

    if (selfClose) {
      // Self-closing element -> empty value.
      assign(stack[stack.length - 1].node, tagName, '')
      continue
    }

    if (!isClose) {
      // Opening tag: push a fresh frame.
      stack.push({ node: {}, text: '', tag: tagName })
    } else {
      // Closing tag: collapse the frame into its parent.
      const frame = stack.pop()
      const parent = stack[stack.length - 1]
      const childKeys = Object.keys(frame.node)
      const value = childKeys.length > 0 ? frame.node : decodeEntities(frame.text.trim())

      assign(parent.node, tagName, value)
    }
  }

  return root
}

/**
 * Normalizes an AWS Query list node to a JS array.
 *
 * AWS wraps list entries in <member> elements. Depending on cardinality the
 * parser yields: undefined/'' (empty), a single object (one member), or an
 * array (many). This coerces all three to an array of members.
 *
 * @param {*} node - The value of a list-typed element (e.g. result.LoadBalancers).
 * @returns {Array} Array of member objects/values (empty when none).
 */
function toArray(node) {
  if (node === undefined || node === null || node === '') return []

  const members = node && typeof node === 'object' ? node.member : node

  if (members === undefined || members === null || members === '') return []

  return Array.isArray(members) ? members : [members]
}

module.exports = { parseXml, toArray, decodeEntities }
