'use strict'

const { walkBodyElements, paragraphPlainText } = require('./utils')

/**
 * A Google Doc has several text "segments": body, headers, footers, footnotes.
 * Each has its own zero/one-based index space. batchUpdate operations targeting headers/footers
 * MUST pass `segmentId` in the location object — omitting it targets the body.
 *
 * For multi-tab docs (Oct 2024+), every segment lives inside a tab. When `includeTabsContent=true`,
 * `document.tabs[].documentTab.body|headers|footers|footnotes` replaces the top-level fields.
 */

/**
 * Iterates all segments of a document, regardless of single-tab or multi-tab shape.
 * Yields entries: { kind: 'body'|'header'|'footer'|'footnote', body, segmentId?, tabId? }
 *
 * - body                segmentId omitted on locations (use undefined)
 * - header/footer       segmentId = headerId / footerId
 * - footnote            segmentId = footnoteId
 * - tabId               present only in multi-tab docs
 */
function iterSegments(document) {
  const out = []

  if (Array.isArray(document?.tabs) && document.tabs.length > 0) {
    for (const tab of document.tabs) {
      collectFromTab(tab, out)
    }

    return out
  }

  collectFromRoot(document, out)

  return out
}

function collectFromRoot(document, out) {
  if (document.body) out.push({ kind: 'body', body: document.body })

  for (const [id, header] of Object.entries(document.headers || {})) {
    out.push({ kind: 'header', segmentId: id, body: header })
  }

  for (const [id, footer] of Object.entries(document.footers || {})) {
    out.push({ kind: 'footer', segmentId: id, body: footer })
  }

  for (const [id, footnote] of Object.entries(document.footnotes || {})) {
    out.push({ kind: 'footnote', segmentId: id, body: footnote })
  }
}

function collectFromTab(tab, out) {
  const tabId = tab.tabProperties?.tabId
  const documentTab = tab.documentTab || {}

  if (documentTab.body) out.push({ kind: 'body', body: documentTab.body, tabId })

  for (const [id, header] of Object.entries(documentTab.headers || {})) {
    out.push({ kind: 'header', segmentId: id, body: header, tabId })
  }

  for (const [id, footer] of Object.entries(documentTab.footers || {})) {
    out.push({ kind: 'footer', segmentId: id, body: footer, tabId })
  }

  for (const [id, footnote] of Object.entries(documentTab.footnotes || {})) {
    out.push({ kind: 'footnote', segmentId: id, body: footnote, tabId })
  }

  for (const child of tab.childTabs || []) {
    collectFromTab(child, out)
  }
}

/**
 * Returns a flat list of body elements across all segments + tabs, with their owning
 * segmentId/tabId so downstream methods can target them via batchUpdate.
 */
function allBodyElements(document) {
  const segments = iterSegments(document)

  return segments.flatMap(seg =>
    walkBodyElements(seg.body, { segmentId: seg.segmentId, tabId: seg.tabId }).map(item => ({
      ...item,
      segmentKind: seg.kind,
    }))
  )
}

/**
 * Headings extracted from all segments. Useful for "table of contents" output.
 */
function extractHeadings(document) {
  const elements = allBodyElements(document)

  return elements
    .filter(e => e.type === 'paragraph')
    .map(e => {
      const p = e.element.paragraph
      const namedStyle = p.paragraphStyle?.namedStyleType

      if (!namedStyle || !/^HEADING_/.test(namedStyle)) return null

      const text = paragraphPlainText(p).replace(/\n+$/, '').trim()
      const level = Number(namedStyle.replace('HEADING_', ''))

      return {
        level,
        namedStyleType: namedStyle,
        text,
        startIndex: e.element.startIndex,
        endIndex: e.element.endIndex,
        segmentId: e.segmentId,
        tabId: e.tabId,
        segmentKind: e.segmentKind,
      }
    })
    .filter(Boolean)
}

/**
 * Tables across all segments + tabs.
 */
function extractTables(document) {
  return allBodyElements(document)
    .filter(e => e.type === 'table')
    .map(e => ({
      rows: e.element.table.rows,
      columns: e.element.table.columns,
      startIndex: e.element.startIndex,
      endIndex: e.element.endIndex,
      segmentId: e.segmentId,
      tabId: e.tabId,
      segmentKind: e.segmentKind,
    }))
}

/**
 * Inline images sit on `paragraph.elements[].inlineObjectElement.inlineObjectId`. The actual
 * image lives in `document.inlineObjects[id].inlineObjectProperties.embeddedObject.imageProperties`.
 */
function extractImages(document) {
  const out = []
  const inlineObjects = document.inlineObjects || {}

  // For multi-tab docs, inlineObjects sit under each tab.documentTab.inlineObjects.
  const tabInline = {}

  for (const tab of document.tabs || []) {
    Object.assign(tabInline, tab.documentTab?.inlineObjects || {})
  }

  const elements = allBodyElements(document)

  for (const entry of elements) {
    if (entry.type !== 'paragraph') continue

    for (const el of entry.element.paragraph.elements || []) {
      const id = el.inlineObjectElement?.inlineObjectId

      if (!id) continue

      const obj = inlineObjects[id] || tabInline[id]
      const embedded = obj?.inlineObjectProperties?.embeddedObject
      const image = embedded?.imageProperties

      if (!image) continue

      out.push({
        inlineObjectId: id,
        title: embedded.title,
        description: embedded.description,
        contentUri: image.contentUri,
        sourceUri: image.sourceUri,
        startIndex: el.startIndex,
        endIndex: el.endIndex,
        segmentId: entry.segmentId,
        tabId: entry.tabId,
      })
    }
  }

  return out
}

/**
 * Named ranges (multiple can share a name) — surfaces id + ranges + name.
 */
function extractNamedRanges(document) {
  const map = document.namedRanges || {}
  const tabMap = {}

  for (const tab of document.tabs || []) {
    Object.assign(tabMap, tab.documentTab?.namedRanges || {})
  }

  const combined = { ...map, ...tabMap }
  const out = []

  for (const [name, group] of Object.entries(combined)) {
    for (const ranged of group.namedRanges || []) {
      for (const range of ranged.ranges || []) {
        out.push({
          name,
          namedRangeId: ranged.namedRangeId,
          startIndex: range.startIndex,
          endIndex: range.endIndex,
          segmentId: range.segmentId,
          tabId: range.tabId,
        })
      }
    }
  }

  return out
}

/**
 * Document end index — the index ONE PAST the last character. Use as fallback insertion point
 * when appending content. For body, last paragraph's endIndex - 1 is the right spot for inserts.
 */
function bodyEndIndex(body) {
  const content = body?.content || []

  if (!content.length) return 1

  return content[content.length - 1].endIndex
}

/**
 * Computes the insertion index for appending text to the end of the body, just before the final
 * trailing newline (Docs always keeps a final newline that can't be deleted).
 */
function appendIndex(body) {
  return Math.max(1, bodyEndIndex(body) - 1)
}

module.exports = {
  iterSegments,
  allBodyElements,
  extractHeadings,
  extractTables,
  extractImages,
  extractNamedRanges,
  bodyEndIndex,
  appendIndex,
}
