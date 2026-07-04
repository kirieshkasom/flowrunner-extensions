'use strict'

const DEFAULT_MAX_PAGES = 10

/**
 * Iterates over pages of a Drive list endpoint, concatenating an array key.
 * fetchPage(pageToken) → must return an object with `nextPageToken` and the array key.
 */
async function paginateAll(fetchPage, { itemsKey = 'files', maxPages = DEFAULT_MAX_PAGES } = {}) {
  const all = []
  let pageToken
  let pages = 0
  let lastResponse = null

  do {
    const response = await fetchPage(pageToken)

    lastResponse = response

    if (Array.isArray(response?.[itemsKey])) {
      all.push(...response[itemsKey])
    }

    pageToken = response?.nextPageToken
    pages++
  } while (pageToken && pages < maxPages)

  return {
    [itemsKey]: all,
    pages,
    truncated: !!pageToken,
    nextPageToken: pageToken || null,
    incompleteSearch: lastResponse?.incompleteSearch,
  }
}

module.exports = { paginateAll, DEFAULT_MAX_PAGES }
