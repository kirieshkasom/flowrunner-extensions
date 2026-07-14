const logger = {
  info: (...args) => console.log('[Hacker News] info:', ...args),
  debug: (...args) => console.log('[Hacker News] debug:', ...args),
  error: (...args) => console.log('[Hacker News] error:', ...args),
  warn: (...args) => console.log('[Hacker News] warn:', ...args),
}

// Firebase (official HN API) - items, users, live story-id lists.
const FIREBASE_BASE_URL = 'https://hacker-news.firebaseio.com/v0'
// Algolia HN Search API - full-text search, hydrated items/users.
const ALGOLIA_BASE_URL = 'https://hn.algolia.com/api/v1'

// Maps friendly Search tag labels to the Algolia tag tokens.
const SEARCH_TAG_MAP = {
  'Story': 'story',
  'Comment': 'comment',
  'Ask HN': 'ask_hn',
  'Show HN': 'show_hn',
  'Poll': 'poll',
  'Front Page': 'front_page',
}

const DEFAULT_HYDRATE_LIMIT = 10
const MAX_HYDRATE_LIMIT = 50

function clean(obj) {
  if (!obj) {
    return obj
  }

  const result = {}

  for (const key in obj) {
    const value = obj[key]

    if (value !== undefined && value !== null && value !== '') {
      result[key] = value
    }
  }

  return result
}

/**
 * @integrationName Hacker News
 * @integrationIcon /icon.svg
 */
class HackerNewsService {
  // No constructor / configuration items: the Hacker News Firebase and Algolia search APIs are public and unauthenticated.

  // Single request helper for both the Firebase and Algolia read-only JSON APIs.
  async #apiRequest({ url, method = 'get', query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ 'Accept': 'application/json' })
        .query(cleanedQuery || {})

      return await request
    } catch (error) {
      const status = error.status || error.statusCode
      const message = error.body?.error || error.body?.message || error.message

      logger.error(`${ logTag } - failed (${ status || 'no status' }): ${ message }`)

      throw new Error(`Hacker News API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  // Firebase returns a literal `null` body when an id/username does not exist; treat that as not found.
  #assertFound(value, description) {
    if (value === null || value === undefined) {
      throw new Error(`Hacker News API error (404): ${ description } not found.`)
    }

    return value
  }

  // Resolves a DROPDOWN label to its API token, passing through free-text values (e.g. author_pg, story_8863).
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /**
   * @operationName Get Item
   * @category Items & Users
   * @description Retrieves a single Hacker News item by its numeric id from the official Firebase API. An item may be a story, comment, job, poll, or poll option (pollopt); the returned fields vary by type (for example stories have title/url/score/descendants, comments have text/parent, polls have parts). The kids array lists direct child comment ids in display order - fetch each with another Get Item call to build a thread. Returns a not-found error if the id does not exist.
   * @route GET /item
   * @paramDef {"type":"Number","label":"Item ID","name":"itemId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric id of the item to retrieve (e.g. 8863)."}
   * @returns {Object}
   * @sampleResult {"by":"dhouston","descendants":71,"id":8863,"kids":[8952,9224,8917],"score":111,"time":1175714200,"title":"My YC app: Dropbox - Throw away your USB drive","type":"story","url":"http://www.getdropbox.com/u/2/screencast.html"}
   */
  async getItem(itemId) {
    const response = await this.#apiRequest({
      logTag: '[getItem]',
      url: `${ FIREBASE_BASE_URL }/item/${ itemId }.json`,
    })

    return this.#assertFound(response, `Item ${ itemId }`)
  }

  /**
   * @operationName Get User
   * @category Items & Users
   * @description Retrieves a Hacker News user profile by case-sensitive username from the official Firebase API. Returns the user id, karma, account creation time (Unix seconds), optional HTML about text, and a submitted array of the ids of their stories, polls, and comments (newest first). Only users who have public activity are exposed. Returns a not-found error if the username does not exist.
   * @route GET /user
   * @paramDef {"type":"String","label":"Username","name":"username","required":true,"description":"Case-sensitive Hacker News username (e.g. pg)."}
   * @returns {Object}
   * @sampleResult {"about":"Bug fixer.","created":1160418092,"id":"pg","karma":157315,"submitted":[35279135,8265435,8168423]}
   */
  async getUser(username) {
    const response = await this.#apiRequest({
      logTag: '[getUser]',
      url: `${ FIREBASE_BASE_URL }/user/${ encodeURIComponent(username) }.json`,
    })

    return this.#assertFound(response, `User ${ username }`)
  }

  /**
   * @operationName Get Max Item ID
   * @category Items & Users
   * @description Returns the current largest item id on Hacker News from the official Firebase API. Item ids are assigned sequentially, so this is the id of the most recently created item. Walk backwards from this value to discover the newest items of any type, or use it to bound polling.
   * @route GET /max-item-id
   * @returns {Number}
   * @sampleResult 41393920
   */
  async getMaxItemId() {
    const response = await this.#apiRequest({
      logTag: '[getMaxItemId]',
      url: `${ FIREBASE_BASE_URL }/maxitem.json`,
    })

    return this.#assertFound(response, 'Max item id')
  }

  /**
   * @operationName Get Top Stories
   * @category Story Lists
   * @description Returns up to 500 item ids for the current front-page ranking (top stories and jobs) from the official Firebase API, ordered by rank. The result is a bare array of numeric ids; call Get Item on each id to resolve the story details, or use Get Top Stories (Hydrated) to fetch the first N items in one call.
   * @route GET /top-stories
   * @returns {Array<Number>}
   * @sampleResult [41393911,41393199,41387761,41391104]
   */
  async getTopStories() {
    return await this.#getStoryList('topstories', '[getTopStories]')
  }

  /**
   * @operationName Get New Stories
   * @category Story Lists
   * @description Returns up to 500 item ids for the newest stories from the official Firebase API, ordered newest first. The result is a bare array of numeric ids; call Get Item on each id to resolve the story details.
   * @route GET /new-stories
   * @returns {Array<Number>}
   * @sampleResult [41393911,41393199,41387761,41391104]
   */
  async getNewStories() {
    return await this.#getStoryList('newstories', '[getNewStories]')
  }

  /**
   * @operationName Get Best Stories
   * @category Story Lists
   * @description Returns up to 500 item ids for the current best (highest scoring recent) stories from the official Firebase API. The result is a bare array of numeric ids; call Get Item on each id to resolve the story details.
   * @route GET /best-stories
   * @returns {Array<Number>}
   * @sampleResult [41393911,41393199,41387761,41391104]
   */
  async getBestStories() {
    return await this.#getStoryList('beststories', '[getBestStories]')
  }

  /**
   * @operationName Get Ask Stories
   * @category Story Lists
   * @description Returns up to 200 item ids for the latest Ask HN stories from the official Firebase API, ordered by rank. The result is a bare array of numeric ids; call Get Item on each id to resolve the story details.
   * @route GET /ask-stories
   * @returns {Array<Number>}
   * @sampleResult [41393911,41393199,41387761,41391104]
   */
  async getAskStories() {
    return await this.#getStoryList('askstories', '[getAskStories]')
  }

  /**
   * @operationName Get Show Stories
   * @category Story Lists
   * @description Returns up to 200 item ids for the latest Show HN stories from the official Firebase API, ordered by rank. The result is a bare array of numeric ids; call Get Item on each id to resolve the story details.
   * @route GET /show-stories
   * @returns {Array<Number>}
   * @sampleResult [41393911,41393199,41387761,41391104]
   */
  async getShowStories() {
    return await this.#getStoryList('showstories', '[getShowStories]')
  }

  /**
   * @operationName Get Job Stories
   * @category Story Lists
   * @description Returns up to 200 item ids for the latest job postings from the official Firebase API, ordered by rank. The result is a bare array of numeric ids; call Get Item on each id to resolve the job details.
   * @route GET /job-stories
   * @returns {Array<Number>}
   * @sampleResult [41393911,41393199,41387761,41391104]
   */
  async getJobStories() {
    return await this.#getStoryList('jobstories', '[getJobStories]')
  }

  /**
   * @operationName Get Updates
   * @category Story Lists
   * @description Returns the items and user profiles that have recently changed on Hacker News, from the official Firebase API. The response has two arrays: items (numeric ids of changed items) and profiles (usernames of changed users). Useful for detecting edits, new comments, or score changes since a previous poll.
   * @route GET /updates
   * @returns {Object}
   * @sampleResult {"items":[41393911,41393199],"profiles":["thefox","mdda"]}
   */
  async getUpdates() {
    const response = await this.#apiRequest({
      logTag: '[getUpdates]',
      url: `${ FIREBASE_BASE_URL }/updates.json`,
    })

    return this.#assertFound(response, 'Updates')
  }

  /**
   * @operationName Get Top Stories (Hydrated)
   * @category Story Lists
   * @description Convenience action that fetches the current top-story id list from the official Firebase API and then resolves the first N ids into full item objects in one call, so you do not have to loop Get Item yourself. Returns story objects in rank order plus the total number of ids available. Limit is capped at 50 to stay within a reasonable request budget.
   * @route GET /top-stories-hydrated
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many top stories to resolve to full items (1-50). Defaults to 10."}
   * @returns {Object}
   * @sampleResult {"count":500,"limit":2,"stories":[{"by":"dhouston","id":8863,"score":111,"title":"My YC app: Dropbox","type":"story","url":"http://www.getdropbox.com/u/2/screencast.html"},{"by":"pg","id":8864,"score":95,"title":"Ask HN: Something?","type":"story"}]}
   */
  async getTopStoriesHydrated(limit) {
    const ids = await this.#getStoryList('topstories', '[getTopStoriesHydrated]')

    let count = Number.parseInt(limit, 10)

    if (!Number.isFinite(count) || count <= 0) {
      count = DEFAULT_HYDRATE_LIMIT
    }

    count = Math.min(count, MAX_HYDRATE_LIMIT)

    const selectedIds = ids.slice(0, count)
    const stories = await Promise.all(selectedIds.map(id => this.#apiRequest({
      logTag: '[getTopStoriesHydrated]',
      url: `${ FIREBASE_BASE_URL }/item/${ id }.json`,
    })))

    return {
      count: ids.length,
      limit: count,
      stories: stories.filter(story => story !== null && story !== undefined),
    }
  }

  /**
   * @operationName Search
   * @category Search
   * @description Full-text search across Hacker News via the Algolia HN Search API, ranked by relevance (points, then recency). Filter by content type with the Tags parameter, restrict by numeric fields (created_at_i, points, num_comments) with Numeric Filters, and page through results. Returns hit objects with objectID, title, url, author, points, num_comments, story_text/comment_text, and _tags. Use Search by Date instead when you need strictly chronological ordering.
   * @route GET /search
   * @paramDef {"type":"String","label":"Query","name":"query","description":"Full-text query. Leave empty to browse by tag/filter only."}
   * @paramDef {"type":"String","label":"Tags","name":"tags","uiComponent":{"type":"DROPDOWN","options":{"values":["Story","Comment","Ask HN","Show HN","Poll","Front Page"]}},"description":"Restrict to a content type. You may also type a raw Algolia tag such as author_pg or story_8863, or comma-separate tags to AND them (e.g. story,author_pg)."}
   * @paramDef {"type":"String","label":"Numeric Filters","name":"numericFilters","description":"Algolia numeric filter expression on created_at_i (Unix seconds), points, or num_comments. Example: points>100,num_comments>=10."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based page index. Defaults to 0."}
   * @paramDef {"type":"Number","label":"Hits Per Page","name":"hitsPerPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results per page (max 1000). Defaults to 20."}
   * @returns {Object}
   * @sampleResult {"hits":[{"objectID":"8863","title":"My YC app: Dropbox","url":"http://www.getdropbox.com/u/2/screencast.html","author":"dhouston","points":111,"num_comments":71,"created_at":"2007-04-04T19:16:40.000Z","_tags":["story","author_dhouston","story_8863"]}],"nbHits":10106,"page":0,"nbPages":1000,"hitsPerPage":20,"query":"dropbox"}
   */
  async search(query, tags, numericFilters, page, hitsPerPage) {
    return await this.#runSearch('search', '[search]', { query, tags, numericFilters, page, hitsPerPage })
  }

  /**
   * @operationName Search by Date
   * @category Search
   * @description Full-text search across Hacker News via the Algolia HN Search API, ordered strictly by date (most recent first) rather than relevance. Accepts the same Query, Tags, Numeric Filters, and paging parameters as Search. Use this for chronological feeds, monitoring, or "everything since a timestamp" queries (combine with a created_at_i numeric filter). Returns the same hit shape as Search.
   * @route GET /search-by-date
   * @paramDef {"type":"String","label":"Query","name":"query","description":"Full-text query. Leave empty to browse by tag/filter only."}
   * @paramDef {"type":"String","label":"Tags","name":"tags","uiComponent":{"type":"DROPDOWN","options":{"values":["Story","Comment","Ask HN","Show HN","Poll","Front Page"]}},"description":"Restrict to a content type. You may also type a raw Algolia tag such as author_pg or story_8863, or comma-separate tags to AND them (e.g. comment,story_8863)."}
   * @paramDef {"type":"String","label":"Numeric Filters","name":"numericFilters","description":"Algolia numeric filter expression on created_at_i (Unix seconds), points, or num_comments. Example: created_at_i>1700000000."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based page index. Defaults to 0."}
   * @paramDef {"type":"Number","label":"Hits Per Page","name":"hitsPerPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results per page (max 1000). Defaults to 20."}
   * @returns {Object}
   * @sampleResult {"hits":[{"objectID":"41393911","title":"Show HN: A thing","url":"https://example.com","author":"pg","points":1,"num_comments":0,"created_at":"2024-08-25T10:00:00.000Z","_tags":["story","author_pg","show_hn"]}],"nbHits":42,"page":0,"nbPages":3,"hitsPerPage":20,"query":"thing"}
   */
  async searchByDate(query, tags, numericFilters, page, hitsPerPage) {
    return await this.#runSearch('search_by_date', '[searchByDate]', { query, tags, numericFilters, page, hitsPerPage })
  }

  /**
   * @operationName Get Item (Algolia)
   * @category Search
   * @description Retrieves a single item and its full nested comment tree from the Algolia HN Search API in one call. Unlike the Firebase Get Item (which returns only child ids in kids), this returns each child comment inline under a children array, recursively, so you get the whole discussion thread without additional requests. Fields include id, title, url, author, points, text, created_at, and children.
   * @route GET /algolia-item
   * @paramDef {"type":"Number","label":"Item ID","name":"itemId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric id of the item to retrieve with its nested comment tree (e.g. 8863)."}
   * @returns {Object}
   * @sampleResult {"id":8863,"created_at":"2007-04-04T19:16:40.000Z","author":"dhouston","title":"My YC app: Dropbox","url":"http://www.getdropbox.com/u/2/screencast.html","points":111,"text":null,"children":[{"id":8952,"author":"BrandonM","text":"...","points":null,"children":[]}]}
   */
  async getItemAlgolia(itemId) {
    return await this.#apiRequest({
      logTag: '[getItemAlgolia]',
      url: `${ ALGOLIA_BASE_URL }/items/${ itemId }`,
    })
  }

  /**
   * @operationName Get User (Algolia)
   * @category Search
   * @description Retrieves a Hacker News user's aggregate stats from the Algolia HN Search API by username. Returns the username, karma, about text, and derived counts (submitted, comment_count, submission_count) as indexed by Algolia. For the raw Firebase profile including the full submitted-id list, use Get User instead.
   * @route GET /algolia-user
   * @paramDef {"type":"String","label":"Username","name":"username","required":true,"description":"Case-sensitive Hacker News username (e.g. pg)."}
   * @returns {Object}
   * @sampleResult {"username":"pg","about":"Bug fixer.","karma":157315,"created_at":"2006-10-09T18:21:32.000Z","avg":null,"comment_count":9001,"submission_count":1234,"submitted":10235}
   */
  async getUserAlgolia(username) {
    return await this.#apiRequest({
      logTag: '[getUserAlgolia]',
      url: `${ ALGOLIA_BASE_URL }/users/${ encodeURIComponent(username) }`,
    })
  }

  // Fetches a Firebase story-id list endpoint and guarantees an array result.
  async #getStoryList(listName, logTag) {
    const response = await this.#apiRequest({
      logTag,
      url: `${ FIREBASE_BASE_URL }/${ listName }.json`,
    })

    return Array.isArray(response) ? response : []
  }

  // Shared Algolia search runner for both relevance and by-date endpoints.
  async #runSearch(endpoint, logTag, { query, tags, numericFilters, page, hitsPerPage }) {
    // Comma-separated tags are ANDed; map each friendly label, pass raw tokens through.
    let resolvedTags

    if (tags !== undefined && tags !== null && tags !== '') {
      resolvedTags = tags
        .split(',')
        .map(part => this.#resolveChoice(part.trim(), SEARCH_TAG_MAP))
        .filter(Boolean)
        .join(',')
    }

    return await this.#apiRequest({
      logTag,
      url: `${ ALGOLIA_BASE_URL }/${ endpoint }`,
      query: {
        query,
        tags: resolvedTags,
        numericFilters,
        page,
        hitsPerPage,
      },
    })
  }
}

Flowrunner.ServerCode.addService(HackerNewsService, [])
