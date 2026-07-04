'use strict'

const { iterSegments, allBodyElements } = require('./segments')
const { paragraphPlainText } = require('./utils')

/**
 * Lossless-ish conversions of a Docs document to plain text, markdown, or simplified HTML.
 * Used so callers can fetch a doc's content in the format they need without spinning a
 * separate Drive export call (which costs more quota and won't honor tab scoping).
 */

function toPlainText(document) {
  return iterSegments(document)
    .filter(s => s.kind === 'body')
    .map(seg => segmentToPlainText(seg.body))
    .join('\n')
}

function segmentToPlainText(body) {
  if (!body?.content) return ''

  const lines = []

  for (const el of body.content) {
    if (el.paragraph) {
      lines.push(paragraphPlainText(el.paragraph).replace(/\n+$/, ''))
    } else if (el.table) {
      for (const row of el.table.tableRows || []) {
        const cells = (row.tableCells || []).map(cell => {
          return (cell.content || [])
            .map(inner => inner.paragraph ? paragraphPlainText(inner.paragraph).replace(/\n+$/, '') : '')
            .join(' ')
        })

        lines.push(cells.join(' | '))
      }
    } else if (el.sectionBreak) {
      lines.push('')
    }
  }

  return lines.join('\n')
}

function toMarkdown(document) {
  return iterSegments(document)
    .filter(s => s.kind === 'body')
    .map(seg => segmentToMarkdown(seg.body))
    .join('\n\n')
}

function segmentToMarkdown(body) {
  if (!body?.content) return ''

  const out = []

  for (const el of body.content) {
    if (el.paragraph) {
      out.push(paragraphToMarkdown(el.paragraph))
    } else if (el.table) {
      out.push(tableToMarkdown(el.table))
    } else if (el.sectionBreak) {
      out.push('---')
    }
  }

  return out.filter(s => s !== null && s !== undefined).join('\n').replace(/\n{3,}/g, '\n\n')
}

function paragraphToMarkdown(paragraph) {
  const namedStyle = paragraph.paragraphStyle?.namedStyleType
  const bullet = paragraph.bullet
  const text = (paragraph.elements || [])
    .map(runToMarkdown)
    .join('')
    .replace(/\n+$/, '')

  if (!text.trim() && !bullet) return ''

  if (bullet) {
    const level = bullet.nestingLevel || 0
    const indent = '  '.repeat(level)

    return `${ indent }- ${ text }`
  }

  switch (namedStyle) {
    case 'TITLE': return `# ${ text }`
    case 'SUBTITLE': return `## ${ text }`
    case 'HEADING_1': return `# ${ text }`
    case 'HEADING_2': return `## ${ text }`
    case 'HEADING_3': return `### ${ text }`
    case 'HEADING_4': return `#### ${ text }`
    case 'HEADING_5': return `##### ${ text }`
    case 'HEADING_6': return `###### ${ text }`
    default: return text
  }
}

function runToMarkdown(el) {
  if (el.textRun) {
    const t = el.textRun.content || ''
    const s = el.textRun.textStyle || {}
    let txt = t

    if (s.link?.url) {
      const cleaned = txt.replace(/\n+$/, '')

      return `[${ cleaned }](${ s.link.url })${ txt.endsWith('\n') ? '\n' : '' }`
    }

    if (s.bold && s.italic) txt = `***${ txt.replace(/\n+$/, '') }***${ txt.endsWith('\n') ? '\n' : '' }`
    else if (s.bold) txt = `**${ txt.replace(/\n+$/, '') }**${ txt.endsWith('\n') ? '\n' : '' }`
    else if (s.italic) txt = `*${ txt.replace(/\n+$/, '') }*${ txt.endsWith('\n') ? '\n' : '' }`

    if (s.strikethrough) txt = `~~${ txt }~~`

    return txt
  }

  if (el.inlineObjectElement) {
    return '![inline-image]()'
  }

  if (el.pageBreak) {
    return '\n\n---\n\n'
  }

  if (el.horizontalRule) {
    return '\n---\n'
  }

  return ''
}

function tableToMarkdown(table) {
  const rows = table.tableRows || []

  if (!rows.length) return ''

  const cells = rows.map(row =>
    (row.tableCells || []).map(cell =>
      (cell.content || [])
        .map(inner => inner.paragraph ? paragraphPlainText(inner.paragraph).replace(/\n+/g, ' ').trim() : '')
        .filter(Boolean)
        .join(' ')
        .replace(/\|/g, '\\|')
    )
  )

  const header = cells[0] || []
  const separator = header.map(() => '---')
  const body = cells.slice(1)
  const lines = [
    `| ${ header.join(' | ') } |`,
    `| ${ separator.join(' | ') } |`,
    ...body.map(r => `| ${ r.join(' | ') } |`),
  ]

  return lines.join('\n')
}

function toHtml(document) {
  return iterSegments(document)
    .filter(s => s.kind === 'body')
    .map(seg => `<div class="doc-segment">${ segmentToHtml(seg.body) }</div>`)
    .join('\n')
}

function segmentToHtml(body) {
  if (!body?.content) return ''

  const out = []
  let listOpen = null

  for (const el of body.content) {
    if (el.paragraph) {
      const bullet = el.paragraph.bullet
      const isList = !!bullet

      if (isList && listOpen === null) {
        out.push('<ul>')
        listOpen = 'ul'
      } else if (!isList && listOpen) {
        out.push(`</${ listOpen }>`)
        listOpen = null
      }

      out.push(paragraphToHtml(el.paragraph))
    } else {
      if (listOpen) {
        out.push(`</${ listOpen }>`)
        listOpen = null
      }

      if (el.table) out.push(tableToHtml(el.table))
      else if (el.sectionBreak) out.push('<hr/>')
    }
  }

  if (listOpen) out.push(`</${ listOpen }>`)

  return out.join('')
}

function paragraphToHtml(paragraph) {
  const namedStyle = paragraph.paragraphStyle?.namedStyleType
  const inner = (paragraph.elements || []).map(runToHtml).join('').replace(/\n+$/, '')

  if (paragraph.bullet) return `<li>${ inner }</li>`

  switch (namedStyle) {
    case 'TITLE': return `<h1 class="title">${ inner }</h1>`
    case 'SUBTITLE': return `<h2 class="subtitle">${ inner }</h2>`
    case 'HEADING_1': return `<h1>${ inner }</h1>`
    case 'HEADING_2': return `<h2>${ inner }</h2>`
    case 'HEADING_3': return `<h3>${ inner }</h3>`
    case 'HEADING_4': return `<h4>${ inner }</h4>`
    case 'HEADING_5': return `<h5>${ inner }</h5>`
    case 'HEADING_6': return `<h6>${ inner }</h6>`
    default: return `<p>${ inner }</p>`
  }
}

function runToHtml(el) {
  if (el.textRun) {
    const t = escapeHtml(el.textRun.content || '')
    const s = el.textRun.textStyle || {}
    let html = t

    if (s.bold) html = `<strong>${ html }</strong>`
    if (s.italic) html = `<em>${ html }</em>`
    if (s.underline) html = `<u>${ html }</u>`
    if (s.strikethrough) html = `<s>${ html }</s>`

    if (s.link?.url) html = `<a href="${ escapeAttr(s.link.url) }">${ html }</a>`

    return html
  }

  if (el.inlineObjectElement) return '<img alt="inline-image"/>'
  if (el.pageBreak) return '<br/>'
  if (el.horizontalRule) return '<hr/>'

  return ''
}

function tableToHtml(table) {
  const rows = table.tableRows || []

  if (!rows.length) return ''

  const trs = rows.map(row => {
    const tds = (row.tableCells || []).map(cell => {
      const inner = (cell.content || [])
        .map(c => c.paragraph ? paragraphToHtml(c.paragraph) : '')
        .join('')

      return `<td>${ inner }</td>`
    })

    return `<tr>${ tds.join('') }</tr>`
  })

  return `<table>${ trs.join('') }</table>`
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;',
  }[c]))
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;')
}

/**
 * Counts words across the body of all segments. Whitespace-collapsed.
 */
function countWords(document) {
  const elements = allBodyElements(document)
  let words = 0
  let chars = 0
  let paragraphs = 0

  for (const e of elements) {
    if (e.type !== 'paragraph') continue

    const text = paragraphPlainText(e.element.paragraph).trim()

    if (!text) continue

    paragraphs++

    chars += text.length
    words += text.split(/\s+/).filter(Boolean).length
  }

  return { words, characters: chars, paragraphs }
}

module.exports = { toPlainText, toMarkdown, toHtml, countWords }
