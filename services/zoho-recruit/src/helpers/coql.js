'use strict'

// Search-criteria DSL builders for Recruit's `/{module}/search?criteria=` endpoint. Format:
//   ((Field:operator:value)and(Field:operator:value))
// Operators: equals, starts_with, between, greater_than, less_than. Parens/commas/backslashes
// inside values must be backslash-escaped before the whole string is URL-encoded.
// (coqlValue is kept for callers that build raw COQL — the extension itself doesn't run COQL,
//  Recruit's API has no COQL endpoint, but the helper is harmless and useful for custom flows.)

function escapeCriteriaValue(value) {
  if (value === null || value === undefined) return ''

  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/,/g, '\\,')
}

// buildCriteria([{field,operator,value},...]) → '((F:op:v)and(F:op:v))'. Pass `{logical:'or'}`
// to switch the connector. Single-clause inputs return without the extra wrapping parens.
function buildCriteria(clauses, { logical = 'and' } = {}) {
  if (!Array.isArray(clauses) || clauses.length === 0) return undefined

  const parts = clauses
    .filter(c => c?.field && c?.operator && c?.value !== undefined)
    .map(c => `(${ c.field }:${ c.operator }:${ escapeCriteriaValue(c.value) })`)

  if (parts.length === 0) return undefined

  if (parts.length === 1) return parts[0]

  return `(${ parts.join(logical) })`
}

// COQL string-literal escape: doubled single quotes, single-quote wrapping. Numbers/bools pass
// through unquoted; null becomes the literal `null`.
function coqlValue(value) {
  if (value === null || value === undefined) return 'null'

  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)

  return `'${ String(value).replace(/'/g, "''") }'`
}

module.exports = {
  escapeCriteriaValue,
  buildCriteria,
  coqlValue,
}
