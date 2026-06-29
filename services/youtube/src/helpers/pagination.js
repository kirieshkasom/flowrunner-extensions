'use strict'

const DEFAULT_MAX_PAGES = 10

/**
 * Iterates over pages of a YouTube list endpoint, concatenating items[].
 * fetchPage(pageToken) → must return { items, nextPageToken }.
 */
async function paginateAll(fetchPage, maxPages = DEFAULT_MAX_PAGES) {
  const allItems = []
  let pageToken
  let pages = 0
  let lastResponse = null

  do {
    const response = await fetchPage(pageToken)

    lastResponse = response

    if (Array.isArray(response.items)) {
      allItems.push(...response.items)
    }

    pageToken = response.nextPageToken
    pages++
  } while (pageToken && pages < maxPages)

  return {
    items: allItems,
    pageInfo: lastResponse?.pageInfo,
    pages,
    truncated: !!pageToken,
    nextPageToken: pageToken || null,
  }
}

module.exports = { paginateAll, DEFAULT_MAX_PAGES }
