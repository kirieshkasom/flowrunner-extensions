'use strict'

// =====================================================================
// YouTube FlowRunner Extension
//
// TOC:
//   1  Constants & init
//   2  OAuth + system methods (4)
//   3  Internal helpers (#getAccessToken, #apiRequest)
//   4  Dictionaries — Data API (8)
//   5  Dictionaries — Analytics (3)
//   6  Channels (3)
//   7  Videos (10)
//   8  Playlists (4)
//   9  PlaylistItems (4)
//   10 Search (3)
//   11 Subscriptions (3)
//   12 Comments (8)
//   13 Captions (4)
//   14 Activities (1)
//   15 Analytics (13)
//   16 Polling triggers (3)
//   17 Service registration
// =====================================================================

const {
  API_BASE_URL,
  UPLOAD_BASE_URL,
  ANALYTICS_API_BASE_URL,
  REPORTING_API_BASE_URL,
  TOKEN_URL,
  OAUTH_URL,
  USER_INFO_URL,
  MAX_DICTIONARY_PAGE_SIZE,
  buildScopeString,
} = require('./constants')

const { logger } = require('./helpers/logger')
const { cleanupObject, searchFilter, clampInt, isShortDuration } = require('./helpers/utils')
const { apiRequest } = require('./helpers/http')
const { fetchBytes, guessImageContentType, resumableUpload, binaryUpload } = require('./helpers/upload')
const {
  METRIC_PRESETS, METRICS_CATALOG, DIMENSIONS_CATALOG,
  buildAnalyticsQuery, buildVideoFilter,
  flattenReport,
} = require('./helpers/analytics')
const { classifyChannelInput, extractVideoId, extractPlaylistId } = require('./helpers/resolver')
const { pickDateRange } = require('./helpers/period')
const { paginateAll, DEFAULT_MAX_PAGES } = require('./helpers/pagination')
const { parseCaption, toTranscript } = require('./helpers/captions')
const { parseCSV } = require('./helpers/reporting')
const {
  generateSecret, subscribeToChannelFeed, unsubscribeFromChannelFeed,
  verifyHubSignature, parseAtomNotification, RENEWAL_THRESHOLD_MS,
} = require('./helpers/pubsub')

// Per-poll page ceiling for polling triggers: walk back this many pages toward the previous
// last-seen marker before giving up, so a burst between polls isn't dropped without unbounded quota.
const POLLING_MAX_PAGES = 5

// =============================== 1 INIT ===============================

/**
 * @requireOAuth
 * @integrationName YouTube
 * @integrationIcon /icon.png
 * @integrationTriggersScope SINGLE_APP
 **/
class YouTubeService {
  constructor(config, context) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret

    this.enableMonetary = config.enableRevenueAnalytics === true ||
      config.enableRevenueAnalytics === 'true'

    this.defaultRegion = config.defaultRegion || 'US'
    this.defaultLanguage = config.defaultLanguage || 'en'

    this.scopes = buildScopeString({ enableMonetary: this.enableMonetary })

    if (context) {
      this.backendless = context.backendless
    }
  }

  // =============================== 3 INTERNAL HELPERS ===============================

  #getAccessToken(accessToken) {
    return accessToken || this.request?.headers?.['oauth-access-token']
  }

  #getAccessTokenHeader(accessToken) {
    return {
      Authorization: `Bearer ${ this.#getAccessToken(accessToken) }`,
    }
  }

  async #apiRequest(opts) {
    return apiRequest({ ...opts, authHeader: this.#getAccessTokenHeader() })
  }

  /**
   * Pages a newest-first list endpoint and returns the raw items newer than `seenId`, stopping
   * as soon as the previously seen item is reached (it and everything after it are trimmed),
   * there are no more pages, or POLLING_MAX_PAGES is hit. Prevents a burst of new items spanning
   * more than one page between polls from being silently lost. `seenId: null` (first run) fetches
   * a single page so the trigger initializes its marker without walking the entire history.
   */
  async #collectUntilSeen({ logTag, url, query, idOf, seenId }) {
    const collected = []
    let pageToken
    let pages = 0

    do {
      const response = await this.#apiRequest({ logTag, url, query: { ...query, pageToken } })
      const items = response.items || []

      for (const item of items) {
        if (seenId && idOf(item) === seenId) {
          return collected
        }

        collected.push(item)
      }

      pageToken = response.nextPageToken
      pages++

      // First run (no marker yet): one page is enough to seed the marker — don't walk history.
      if (!seenId) break
    } while (pageToken && pages < POLLING_MAX_PAGES)

    return collected
  }

  async #cacheMyChannelId(invocation) {
    const resp = await this.#apiRequest({
      logTag: '#cacheMyChannelId',
      url: `${ API_BASE_URL }/channels`,
      query: { part: 'id', mine: 'true' },
    })

    const id = resp.items?.[0]?.id || null

    if (invocation && invocation.state) {
      invocation.state.myChannelId = id
    }

    return id
  }

  /**
   * Resolves a user-provided channel input (URL/@handle/username/ID) to a canonical UC... ID.
   * For non-ID inputs, performs a channels.list lookup. Used by methods that strictly need an ID.
   */
  async #ensureChannelId(input) {
    const classified = classifyChannelInput(input)

    if (!classified) {
      throw new Error(`Could not parse "${ input }" as a YouTube channel ID, handle, or URL.`)
    }

    if (classified.kind === 'id') return classified.value

    const query = { part: 'id' }

    if (classified.kind === 'handle') query.forHandle = classified.value
    else query.forUsername = classified.value

    const response = await this.#apiRequest({
      logTag: '#ensureChannelId',
      url: `${ API_BASE_URL }/channels`,
      query,
    })

    const id = response.items?.[0]?.id

    if (!id) {
      throw new Error(`No channel found for "${ input }".`)
    }

    return id
  }

  // =============================== 2 OAUTH ===============================

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('scope', this.scopes)
    params.append('access_type', 'offline')
    params.append('prompt', 'consent')
    params.append('include_granted_scopes', 'true')

    const connectionURL = `${ OAUTH_URL }?${ params.toString() }`

    logger.debug(`composed connectionURL: ${ connectionURL }`)

    return connectionURL
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   * @property {String} token
   * @property {String} [refreshToken]
   * @property {Number} [expirationInSeconds]
   * @property {Object} [userData]
   * @property {Boolean} [overwrite]
   * @property {String} connectionIdentityName
   * @property {String} [connectionIdentityImageURL]
   */

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('code', callbackObject.code)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('grant_type', 'authorization_code')
    params.append('client_secret', this.clientSecret)

    const codeExchangeResponse = await Flowrunner.Request.post(TOKEN_URL)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    logger.debug('[executeCallback] codeExchangeResponse received')

    let userData = {}
    let connectionIdentityName = 'YouTube Account'
    let connectionIdentityImageURL = null

    try {
      userData = await Flowrunner.Request
        .get(USER_INFO_URL)
        .set(this.#getAccessTokenHeader(codeExchangeResponse.access_token))

      logger.debug(`[executeCallback] userInfo: ${ JSON.stringify(userData) }`)

      if (userData.name || userData.email) {
        connectionIdentityName = userData.name
          ? `${ userData.name } (${ userData.email })`
          : userData.email
      }

      connectionIdentityImageURL = userData.picture || null

      try {
        const channelsResponse = await Flowrunner.Request
          .get(`${ API_BASE_URL }/channels`)
          .set(this.#getAccessTokenHeader(codeExchangeResponse.access_token))
          .query({ part: 'snippet', mine: 'true' })

        const channel = channelsResponse?.items?.[0]

        if (channel) {
          const channelTitle = channel.snippet?.title
          const channelHandle = channel.snippet?.customUrl

          if (channelTitle) {
            connectionIdentityName = channelHandle
              ? `${ channelTitle } (${ channelHandle })`
              : channelTitle
          }

          if (channel.snippet?.thumbnails?.default?.url) {
            connectionIdentityImageURL = channel.snippet.thumbnails.default.url
          }
        }
      } catch (channelError) {
        logger.warn(`[executeCallback] channel lookup failed: ${ channelError.message }`)
      }
    } catch (error) {
      logger.error(`[executeCallback] userInfo error: ${ error.message }`)
    }

    return {
      token: codeExchangeResponse.access_token,
      expirationInSeconds: codeExchangeResponse.expires_in,
      refreshToken: codeExchangeResponse.refresh_token,
      connectionIdentityName,
      connectionIdentityImageURL,
      overwrite: true,
      userData,
    }
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   * @property {String} token
   * @property {Number} [expirationInSeconds]
   * @property {String} [refreshToken]
   */

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    try {
      const { access_token, expires_in } = await Flowrunner.Request.post(TOKEN_URL)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .query({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        })

      return {
        token: access_token,
        expirationInSeconds: expires_in,
      }
    } catch (error) {
      logger.error(`refreshToken error: ${ error.message }`)

      if (error.body?.error === 'invalid_grant') {
        throw new Error('Refresh token expired or invalid, please re-authenticate.')
      }

      throw error
    }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerPollingForEvent
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    return this[invocation.eventName](invocation)
  }

  // =============================== 4 DICTIONARIES — DATA API ===============================

  /**
   * @typedef {Object} DictionaryItem
   * @property {String} label
   * @property {any} value
   * @property {String} note
   */

  /**
   * @typedef {Object} DictionaryResponse
   * @property {Array<DictionaryItem>} items
   * @property {String} cursor
   */

  /**
   * @typedef {Object} listMyChannelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring to filter channels by title or handle. Filtering is local."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for next page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get My Channels
   * @category Channel
   * @description Returns YouTube channels owned by the authenticated user. Quota cost: 1 unit.
   *
   * @route POST /list-my-channels-dictionary
   *
   * @paramDef {"type":"listMyChannelsDictionary__payload","label":"Payload","name":"payload","description":"Optional search and pagination."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"My Awesome Channel","note":"@awesomechannel","value":"UCabc123"}]}
   * @returns {DictionaryResponse}
   */
  async listMyChannelsDictionary({ search, cursor } = {}) {
    const response = await this.#apiRequest({
      logTag: 'listMyChannelsDictionary',
      url: `${ API_BASE_URL }/channels`,
      query: { part: 'snippet', mine: 'true', maxResults: MAX_DICTIONARY_PAGE_SIZE, pageToken: cursor },
    })

    const items = response.items || []
    const filtered = search ? searchFilter(items, ['snippet.title', 'snippet.customUrl'], search) : items

    return {
      cursor: response.nextPageToken || null,
      items: filtered.map(channel => ({
        label: channel.snippet?.title || channel.id,
        note: channel.snippet?.customUrl || `Channel ID: ${ channel.id }`,
        value: channel.id,
      })),
    }
  }

  /**
   * @typedef {Object} listMyPlaylistsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring filter on playlist title."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get My Playlists
   * @category Playlists
   * @description Returns playlists owned by the authenticated user. Quota cost: 1 unit.
   *
   * @route POST /list-my-playlists-dictionary
   *
   * @paramDef {"type":"listMyPlaylistsDictionary__payload","label":"Payload","name":"payload","description":"Optional search and pagination."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"Tutorials","note":"24 videos","value":"PLabc123"}]}
   * @returns {DictionaryResponse}
   */
  async listMyPlaylistsDictionary({ search, cursor } = {}) {
    const response = await this.#apiRequest({
      logTag: 'listMyPlaylistsDictionary',
      url: `${ API_BASE_URL }/playlists`,
      query: { part: 'snippet,contentDetails', mine: 'true', maxResults: MAX_DICTIONARY_PAGE_SIZE, pageToken: cursor },
    })

    const items = response.items || []
    const filtered = search ? searchFilter(items, ['snippet.title', 'snippet.description'], search) : items

    return {
      cursor: response.nextPageToken || null,
      items: filtered.map(p => ({
        label: p.snippet?.title || p.id,
        note: `${ p.contentDetails?.itemCount ?? '?' } videos`,
        value: p.id,
      })),
    }
  }

  /**
   * @typedef {Object} listMyVideosDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring filter on video title."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get My Videos
   * @category Videos
   * @description Pick from videos you uploaded to your YouTube channel. Use to populate Video ID fields like Update Video, Delete Video, Add to Playlist, or Get Video Analytics.
   *
   * @route POST /list-my-videos-dictionary
   *
   * @paramDef {"type":"listMyVideosDictionary__payload","label":"Payload","name":"payload","description":"Optional search and pagination."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"How to Build an API","note":"Published 2025-01-10","value":"abc123def"}]}
   * @returns {DictionaryResponse}
   */
  async listMyVideosDictionary({ search, cursor } = {}) {
    const channelsResp = await this.#apiRequest({
      logTag: 'listMyVideosDictionary:channels',
      url: `${ API_BASE_URL }/channels`,
      query: { part: 'contentDetails', mine: 'true' },
    })

    const uploadsPlaylistId = channelsResp.items?.[0]?.contentDetails?.relatedPlaylists?.uploads

    if (!uploadsPlaylistId) {
      return { cursor: null, items: [] }
    }

    const response = await this.#apiRequest({
      logTag: 'listMyVideosDictionary:playlistItems',
      url: `${ API_BASE_URL }/playlistItems`,
      query: { part: 'snippet,contentDetails', playlistId: uploadsPlaylistId, maxResults: MAX_DICTIONARY_PAGE_SIZE, pageToken: cursor },
    })

    const items = response.items || []
    const filtered = search ? searchFilter(items, ['snippet.title'], search) : items

    return {
      cursor: response.nextPageToken || null,
      items: filtered.map(item => ({
        label: item.snippet?.title || item.contentDetails?.videoId,
        note: item.contentDetails?.videoPublishedAt
          ? `Published ${ item.contentDetails.videoPublishedAt.slice(0, 10) }`
          : `Video ID: ${ item.contentDetails?.videoId }`,
        value: item.contentDetails?.videoId,
      })),
    }
  }

  /**
   * @typedef {Object} listVideoCategoriesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring filter on category title."}
   * @paramDef {"type":"String","label":"Region Code","name":"regionCode","description":"ISO 3166-1 alpha-2 country code (e.g., 'US', 'GB'). Defaults to 'US'.","required":false}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Video Categories
   * @category Videos
   * @description Returns YouTube video categories assignable when uploading. Quota cost: 1 unit.
   *
   * @route POST /list-video-categories-dictionary
   *
   * @paramDef {"type":"listVideoCategoriesDictionary__payload","label":"Payload","name":"payload","description":"Optional region code and search."}
   *
   * @sampleResult {"items":[{"label":"Music","note":"Category ID: 10","value":"10"},{"label":"Gaming","note":"Category ID: 20","value":"20"}]}
   * @returns {DictionaryResponse}
   */
  async listVideoCategoriesDictionary({ search, regionCode } = {}) {
    const response = await this.#apiRequest({
      logTag: 'listVideoCategoriesDictionary',
      url: `${ API_BASE_URL }/videoCategories`,
      query: { part: 'snippet', regionCode: regionCode || this.defaultRegion },
    })

    const items = (response.items || []).filter(c => c.snippet?.assignable !== false)
    const filtered = search ? searchFilter(items, ['snippet.title'], search) : items

    return {
      items: filtered.map(c => ({
        label: c.snippet?.title || c.id,
        note: `Category ID: ${ c.id }`,
        value: c.id,
      })),
    }
  }

  /**
   * @typedef {Object} listI18nLanguagesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring filter on language name."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Languages
   * @category Lookups
   * @description Returns YouTube-supported i18n languages (BCP-47 codes). Quota cost: 1 unit.
   *
   * @route POST /list-i18n-languages-dictionary
   *
   * @paramDef {"type":"listI18nLanguagesDictionary__payload","label":"Payload","name":"payload","description":"Optional search."}
   *
   * @sampleResult {"items":[{"label":"English","note":"en","value":"en"},{"label":"Spanish","note":"es","value":"es"}]}
   * @returns {DictionaryResponse}
   */
  async listI18nLanguagesDictionary({ search } = {}) {
    const response = await this.#apiRequest({
      logTag: 'listI18nLanguagesDictionary',
      url: `${ API_BASE_URL }/i18nLanguages`,
      query: { part: 'snippet' },
    })

    const items = response.items || []
    const filtered = search ? searchFilter(items, ['snippet.name', 'snippet.hl'], search) : items

    return {
      items: filtered.map(l => ({
        label: l.snippet?.name || l.snippet?.hl,
        note: l.snippet?.hl,
        value: l.snippet?.hl,
      })),
    }
  }

  /**
   * @typedef {Object} listI18nRegionsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring filter on region name."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Regions
   * @category Lookups
   * @description Returns YouTube-supported regions (ISO 3166-1 alpha-2 codes). Quota cost: 1 unit.
   *
   * @route POST /list-i18n-regions-dictionary
   *
   * @paramDef {"type":"listI18nRegionsDictionary__payload","label":"Payload","name":"payload","description":"Optional search."}
   *
   * @sampleResult {"items":[{"label":"United States","note":"US","value":"US"},{"label":"United Kingdom","note":"GB","value":"GB"}]}
   * @returns {DictionaryResponse}
   */
  async listI18nRegionsDictionary({ search } = {}) {
    const response = await this.#apiRequest({
      logTag: 'listI18nRegionsDictionary',
      url: `${ API_BASE_URL }/i18nRegions`,
      query: { part: 'snippet' },
    })

    const items = response.items || []
    const filtered = search ? searchFilter(items, ['snippet.name', 'snippet.gl'], search) : items

    return {
      items: filtered.map(r => ({
        label: r.snippet?.name || r.snippet?.gl,
        note: r.snippet?.gl,
        value: r.snippet?.gl,
      })),
    }
  }

  /**
   * @typedef {Object} listAbuseReasonsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring filter."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Video Abuse Report Reasons
   * @category Comments & Moderation
   * @description Returns reasons usable when reporting a video for abuse. Quota cost: 1 unit.
   *
   * @route POST /list-abuse-reasons-dictionary
   *
   * @paramDef {"type":"listAbuseReasonsDictionary__payload","label":"Payload","name":"payload","description":"Optional search."}
   *
   * @sampleResult {"items":[{"label":"Spam or misleading","note":"S","value":"S"},{"label":"Hateful or abusive content","note":"V","value":"V"}]}
   * @returns {DictionaryResponse}
   */
  async listAbuseReasonsDictionary({ search } = {}) {
    const response = await this.#apiRequest({
      logTag: 'listAbuseReasonsDictionary',
      url: `${ API_BASE_URL }/videoAbuseReportReasons`,
      query: { part: 'snippet' },
    })

    const items = response.items || []
    const filtered = search ? searchFilter(items, ['snippet.label'], search) : items

    return {
      items: filtered.map(r => ({
        label: r.snippet?.label || r.id,
        note: `Reason ID: ${ r.id }`,
        value: r.id,
      })),
    }
  }

  /**
   * @typedef {Object} listMembershipsLevelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring filter."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Memberships Levels
   * @category Memberships
   * @description Returns channel memberships levels for the authenticated creator. Requires monetization-eligible channel. Quota cost: 1 unit.
   *
   * @route POST /list-memberships-levels-dictionary
   *
   * @paramDef {"type":"listMembershipsLevelsDictionary__payload","label":"Payload","name":"payload","description":"Optional search."}
   *
   * @sampleResult {"items":[{"label":"Bronze Tier","note":"Level ID: ABC","value":"ABC"}]}
   * @returns {DictionaryResponse}
   */
  async listMembershipsLevelsDictionary({ search } = {}) {
    const response = await this.#apiRequest({
      logTag: 'listMembershipsLevelsDictionary',
      url: `${ API_BASE_URL }/membershipsLevels`,
      query: { part: 'snippet' },
    })

    const items = response.items || []
    const filtered = search ? searchFilter(items, ['snippet.levelDetails.displayName'], search) : items

    return {
      items: filtered.map(l => ({
        label: l.snippet?.levelDetails?.displayName || l.id,
        note: `Level ID: ${ l.id }`,
        value: l.id,
      })),
    }
  }

  /**
   * @typedef {Object} listMySubscriptionsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter the list by channel name (case-insensitive substring)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token returned from a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get My Subscriptions
   * @category Subscriptions
   * @description Pick from the channels you currently subscribe to. Use to populate Subscription ID fields like Unsubscribe.
   *
   * @route POST /list-my-subscriptions-dictionary
   *
   * @paramDef {"type":"listMySubscriptionsDictionary__payload","label":"Payload","name":"payload","description":"Optional search and pagination."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"Some Channel","note":"@somehandle","value":"sub_abc123"}]}
   * @returns {DictionaryResponse}
   */
  async listMySubscriptionsDictionary({ search, cursor } = {}) {
    const response = await this.#apiRequest({
      logTag: 'listMySubscriptionsDictionary',
      url: `${ API_BASE_URL }/subscriptions`,
      query: { part: 'snippet', mine: 'true', maxResults: MAX_DICTIONARY_PAGE_SIZE, pageToken: cursor },
    })

    const items = response.items || []
    const filtered = search ? searchFilter(items, ['snippet.title'], search) : items

    return {
      cursor: response.nextPageToken || null,
      items: filtered.map(s => ({
        label: s.snippet?.title || s.id,
        note: s.snippet?.resourceId?.channelId ? `Channel: ${ s.snippet.resourceId.channelId }` : `Sub ID: ${ s.id }`,
        value: s.id,
      })),
    }
  }

  /**
   * @typedef {Object} listPlaylistItemsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Playlist","name":"playlistId","description":"Pick the playlist to list items from.","required":true,"dictionary":"listMyPlaylistsDictionary"}
   */

  /**
   * @typedef {Object} listPlaylistItemsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter by video title (case-insensitive substring)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token."}
   * @paramDef {"type":"listPlaylistItemsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the playlist whose items to list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Playlist Items
   * @category Playlists
   * @description Pick a playlist item (a video inside a playlist). Use to populate Playlist Item ID fields like Update Playlist Item or Remove Playlist Item.
   *
   * @route POST /list-playlist-items-dictionary
   *
   * @paramDef {"type":"listPlaylistItemsDictionary__payload","label":"Payload","name":"payload","description":"Provide the playlist; optional search and pagination."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"Episode 1: Intro","note":"Position 0","value":"PLI_abc"}]}
   * @returns {DictionaryResponse}
   */
  async listPlaylistItemsDictionary({ search, cursor, criteria } = {}) {
    const playlistId = criteria?.playlistId

    if (!playlistId) {
      return { cursor: null, items: [] }
    }

    const response = await this.#apiRequest({
      logTag: 'listPlaylistItemsDictionary',
      url: `${ API_BASE_URL }/playlistItems`,
      query: { part: 'snippet,contentDetails', playlistId, maxResults: MAX_DICTIONARY_PAGE_SIZE, pageToken: cursor },
    })

    const items = response.items || []
    const filtered = search ? searchFilter(items, ['snippet.title'], search) : items

    return {
      cursor: response.nextPageToken || null,
      items: filtered.map(it => ({
        label: it.snippet?.title || it.id,
        note: typeof it.snippet?.position === 'number' ? `Position ${ it.snippet.position }` : `Item ID: ${ it.id }`,
        value: it.id,
      })),
    }
  }

  /**
   * @typedef {Object} listVideoCaptionsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Video","name":"videoId","description":"Pick the video to list caption tracks for.","required":true,"dictionary":"listMyVideosDictionary"}
   */

  /**
   * @typedef {Object} listVideoCaptionsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter by track name or language."}
   * @paramDef {"type":"listVideoCaptionsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the video whose caption tracks to list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Video Captions
   * @category Captions
   * @description Pick a caption track on a video. Use to populate Caption ID fields like Download Caption or Delete Caption.
   *
   * @route POST /list-video-captions-dictionary
   *
   * @paramDef {"type":"listVideoCaptionsDictionary__payload","label":"Payload","name":"payload","description":"Provide the video; optional search."}
   *
   * @sampleResult {"items":[{"label":"English (standard)","note":"language: en","value":"cap_abc"}]}
   * @returns {DictionaryResponse}
   */
  async listVideoCaptionsDictionary({ search, criteria } = {}) {
    const videoId = criteria?.videoId

    if (!videoId) {
      return { items: [] }
    }

    const response = await this.#apiRequest({
      logTag: 'listVideoCaptionsDictionary',
      url: `${ API_BASE_URL }/captions`,
      query: { part: 'snippet', videoId },
    })

    const items = response.items || []
    const filtered = search ? searchFilter(items, ['snippet.name', 'snippet.language'], search) : items

    return {
      items: filtered.map(c => ({
        label: c.snippet?.name
          ? `${ c.snippet.name } (${ c.snippet.trackKind || 'standard' })`
          : (c.snippet?.language || c.id),
        note: `language: ${ c.snippet?.language || 'unknown' }`,
        value: c.id,
      })),
    }
  }

  /**
   * @typedef {Object} listMyCommentThreadsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Video","name":"videoId","description":"Pick the video whose comments to list.","required":true,"dictionary":"listMyVideosDictionary"}
   */

  /**
   * @typedef {Object} listMyCommentThreadsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter by comment text or author."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token."}
   * @paramDef {"type":"listMyCommentThreadsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the video whose comment threads to list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Comment Threads on My Video
   * @category Comments & Moderation
   * @description Pick a top-level comment from one of your videos. Use to populate Comment ID fields like Update Comment, Delete Comment, or Set Moderation Status.
   *
   * @route POST /list-my-comment-threads-dictionary
   *
   * @paramDef {"type":"listMyCommentThreadsDictionary__payload","label":"Payload","name":"payload","description":"Provide the video; optional search."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"@viewer: Loved this video!","note":"Likes: 3","value":"comment_abc"}]}
   * @returns {DictionaryResponse}
   */
  async listMyCommentThreadsDictionary({ search, cursor, criteria } = {}) {
    const videoId = criteria?.videoId

    if (!videoId) {
      return { cursor: null, items: [] }
    }

    const response = await this.#apiRequest({
      logTag: 'listMyCommentThreadsDictionary',
      url: `${ API_BASE_URL }/commentThreads`,
      query: { part: 'snippet', videoId, order: 'time', maxResults: MAX_DICTIONARY_PAGE_SIZE, pageToken: cursor },
    })

    const items = response.items || []

    const filtered = search
      ? items.filter(t => {
        const top = t.snippet?.topLevelComment?.snippet
        const haystack = [top?.textDisplay, top?.authorDisplayName].filter(Boolean).join(' ').toLowerCase()

        return haystack.includes(search.toLowerCase())
      })
      : items

    return {
      cursor: response.nextPageToken || null,
      items: filtered.map(t => {
        const top = t.snippet?.topLevelComment?.snippet
        const text = top?.textDisplay || ''
        const truncated = text.length > 60 ? `${ text.slice(0, 60) }…` : text
        const commentId = t.snippet?.topLevelComment?.id || t.id

        return {
          label: top?.authorDisplayName ? `${ top.authorDisplayName }: ${ truncated }` : truncated,
          note: `Likes: ${ top?.likeCount ?? 0 }`,
          value: commentId,
        }
      }),
    }
  }

  /**
   * @typedef {Object} listSecondaryAbuseReasonsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Primary Reason","name":"reasonId","description":"Pick a primary abuse reason first; secondary reasons depend on it.","required":true,"dictionary":"listAbuseReasonsDictionary"}
   */

  /**
   * @typedef {Object} listSecondaryAbuseReasonsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter by sub-reason label."}
   * @paramDef {"type":"listSecondaryAbuseReasonsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the primary abuse reason whose sub-reasons to list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Secondary Abuse Reasons
   * @category Comments & Moderation
   * @description Pick a more specific sub-reason for an abuse report. Use to populate Secondary Reason ID on Report Video Abuse.
   *
   * @route POST /list-secondary-abuse-reasons-dictionary
   *
   * @paramDef {"type":"listSecondaryAbuseReasonsDictionary__payload","label":"Payload","name":"payload","description":"Provide the primary reason; optional search."}
   *
   * @sampleResult {"items":[{"label":"Misleading thumbnails","note":"Sub-reason ID: M","value":"M"}]}
   * @returns {DictionaryResponse}
   */
  async listSecondaryAbuseReasonsDictionary({ search, criteria } = {}) {
    const reasonId = criteria?.reasonId

    if (!reasonId) {
      return { items: [] }
    }

    const response = await this.#apiRequest({
      logTag: 'listSecondaryAbuseReasonsDictionary',
      url: `${ API_BASE_URL }/videoAbuseReportReasons`,
      query: { part: 'snippet' },
    })

    const primary = (response.items || []).find(r => r.id === reasonId)
    const secondaries = primary?.snippet?.secondaryReasons || []
    const filtered = search ? secondaries.filter(s => (s.label || '').toLowerCase().includes(search.toLowerCase())) : secondaries

    return {
      items: filtered.map(s => ({
        label: s.label,
        note: `Sub-reason ID: ${ s.id }`,
        value: s.id,
      })),
    }
  }

  // =============================== 5 DICTIONARIES — ANALYTICS ===============================

  /**
   * @typedef {Object} listAnalyticsMetricsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring filter on metric label or value."}
   * @paramDef {"type":"String","label":"Category","name":"category","description":"Optional category filter (engagement, watchTime, audience, cards, revenue)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Analytics Metrics
   * @category Analytics
   * @description Returns YouTube Analytics metrics catalog (static, no API call). Filterable by category.
   *
   * @route POST /list-analytics-metrics-dictionary
   *
   * @paramDef {"type":"listAnalyticsMetricsDictionary__payload","label":"Payload","name":"payload","description":"Optional search and category filter."}
   *
   * @sampleResult {"items":[{"label":"Views","note":"engagement","value":"views"},{"label":"Estimated minutes watched","note":"watchTime","value":"estimatedMinutesWatched"}]}
   * @returns {DictionaryResponse}
   */
  async listAnalyticsMetricsDictionary({ search, category } = {}) {
    let items = METRICS_CATALOG

    if (category) {
      items = items.filter(m => m.category === category)
    }

    if (!this.enableMonetary) {
      items = items.filter(m => m.category !== 'revenue')
    }

    if (search) {
      items = searchFilter(items, ['value', 'label'], search)
    }

    return {
      items: items.map(m => ({ label: m.label, note: m.category, value: m.value })),
    }
  }

  /**
   * @typedef {Object} listAnalyticsDimensionsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring filter."}
   * @paramDef {"type":"String","label":"Category","name":"category","description":"Optional category filter (time, resource, geography, demographics, audience, devices, traffic)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Analytics Dimensions
   * @category Analytics
   * @description Returns YouTube Analytics dimensions catalog (static, no API call).
   *
   * @route POST /list-analytics-dimensions-dictionary
   *
   * @paramDef {"type":"listAnalyticsDimensionsDictionary__payload","label":"Payload","name":"payload","description":"Optional search and category filter."}
   *
   * @sampleResult {"items":[{"label":"Day","note":"time","value":"day"},{"label":"Country","note":"geography","value":"country"}]}
   * @returns {DictionaryResponse}
   */
  async listAnalyticsDimensionsDictionary({ search, category } = {}) {
    let items = DIMENSIONS_CATALOG

    if (category) {
      items = items.filter(d => d.category === category)
    }

    if (search) {
      items = searchFilter(items, ['value', 'label'], search)
    }

    return {
      items: items.map(d => ({ label: d.label, note: d.category, value: d.value })),
    }
  }

  /**
   * @typedef {Object} listAnalyticsGroupsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring filter."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Analytics Groups
   * @category Analytics
   * @description Returns analytics groups owned by the authenticated user. Quota: 1 unit.
   *
   * @route POST /list-analytics-groups-dictionary
   *
   * @paramDef {"type":"listAnalyticsGroupsDictionary__payload","label":"Payload","name":"payload","description":"Optional search."}
   *
   * @sampleResult {"items":[{"label":"Top Tutorials","note":"video","value":"groupId123"}]}
   * @returns {DictionaryResponse}
   */
  async listAnalyticsGroupsDictionary({ search } = {}) {
    const response = await this.#apiRequest({
      logTag: 'listAnalyticsGroupsDictionary',
      url: `${ ANALYTICS_API_BASE_URL }/groups`,
      query: { mine: 'true' },
    })

    const items = response.items || []
    const filtered = search ? searchFilter(items, ['snippet.title'], search) : items

    return {
      items: filtered.map(g => ({
        label: g.snippet?.title || g.id,
        note: g.contentDetails?.itemType?.replace('youtube#', '') || 'group',
        value: g.id,
      })),
    }
  }

  // =============================== 6 CHANNELS ===============================

  /**
   * @description Retrieves the authenticated user's primary YouTube channel including snippet, statistics, branding, and content details. Quota cost: 1 unit per requested part.
   *
   * @route POST /get-my-channel
   * @operationName Get My Channel
   * @category Channel
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.readonly
   *
   * @paramDef {"type":"Array.<String>","label":"Parts","name":"parts","uiComponent":{"type":"DROPDOWN","options":{"values":["snippet","statistics","contentDetails","brandingSettings","status","topicDetails","localizations"],"multiselect":true}},"description":"Resource sections to include. Defaults to snippet, statistics, contentDetails, brandingSettings."}
   *
   * @sampleResultLoader { "methodName":"getMyChannel_SampleResultLoader", "dependsOn":["parts"] }
   * @returns {Object}
   * @sampleResult {"id":"UCabc123","snippet":{"title":"My Channel","description":"Welcome!","customUrl":"@mychannel"},"statistics":{"viewCount":"12345","subscriberCount":"500","videoCount":"42"}}
   */
  async getMyChannel(parts) {
    const partList = (Array.isArray(parts) && parts.length)
      ? parts.join(',')
      : 'snippet,statistics,contentDetails,brandingSettings'

    const response = await this.#apiRequest({
      logTag: 'getMyChannel',
      url: `${ API_BASE_URL }/channels`,
      query: { part: partList, mine: 'true' },
    })

    return response.items?.[0] || null
  }

  /**
   * @description Retrieves a YouTube channel by ID, handle (e.g., @MrBeast), or legacy username. Resolves the appropriate filter automatically. Quota cost: 1 unit per requested part.
   *
   * @route POST /get-channel
   * @operationName Get Channel
   * @category Channel
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.readonly
   *
   * @paramDef {"type":"String","label":"Channel","name":"identifier","required":true,"description":"Channel ID (UC...), @handle, legacy username, or any YouTube channel URL."}
   * @paramDef {"type":"Array.<String>","label":"Parts","name":"parts","uiComponent":{"type":"DROPDOWN","options":{"values":["snippet","statistics","contentDetails","brandingSettings","status","topicDetails","localizations"],"multiselect":true}},"description":"Resource sections to include."}
   *
   * @sampleResultLoader { "methodName":"getChannel_SampleResultLoader", "dependsOn":["parts"] }
   * @returns {Object}
   * @sampleResult {"id":"UCabc123","snippet":{"title":"Some Channel","customUrl":"@somechannel","thumbnails":{"default":{"url":"..."}}},"statistics":{"subscriberCount":"1000000"}}
   */
  async getChannel(identifier, parts) {
    if (!identifier) {
      throw new Error('"Channel Identifier" is required')
    }

    const partList = (Array.isArray(parts) && parts.length)
      ? parts.join(',')
      : 'snippet,statistics,contentDetails'

    const classified = classifyChannelInput(identifier)

    if (!classified) {
      throw new Error(`Could not parse "${ identifier }" as a YouTube channel ID, handle, or URL.`)
    }

    const query = { part: partList }

    if (classified.kind === 'id') query.id = classified.value
    else if (classified.kind === 'handle') query.forHandle = classified.value
    else query.forUsername = classified.value

    const response = await this.#apiRequest({
      logTag: 'getChannel',
      url: `${ API_BASE_URL }/channels`,
      query,
    })

    return response.items?.[0] || null
  }

  /**
   * @description Updates the authenticated user's channel branding settings (title, description, country, keywords, default language).
   *
   * @route POST /update-channel-branding
   * @operationName Update Channel Branding
   * @category Channel
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube
   *
   * @paramDef {"type":"String","label":"Channel ID","name":"channelId","description":"Channel ID to update. Use Get My Channel dictionary or pass UC... id.","required":true,"dictionary":"listMyChannelsDictionary"}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New channel title."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"New channel description.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"ISO 3166-1 alpha-2 country code, e.g. 'US'."}
   * @paramDef {"type":"String","label":"Keywords","name":"keywords","description":"Space-delimited keywords. Quote multi-word terms with double quotes."}
   * @paramDef {"type":"String","label":"Default Language","name":"defaultLanguage","description":"BCP-47 language code, e.g. 'en'.","dictionary":"listI18nLanguagesDictionary"}
   *
   * @returns {Object}
   * @sampleResult {"id":"UCabc123","brandingSettings":{"channel":{"title":"My Channel","description":"...","country":"US","keywords":"tech tutorials"}}}
   */
  async updateChannelBranding(channelId, title, description, country, keywords, defaultLanguage) {
    if (!channelId) {
      throw new Error('"Channel ID" is required')
    }

    // Only set defaultLanguage when the user explicitly supplied it — channels.update with
    // part=brandingSettings replaces the whole brandingSettings.channel object, so injecting
    // the config fallback here would silently overwrite the channel's existing default language.
    const channelBranding = cleanupObject({ title, description, country, keywords, defaultLanguage })

    if (!Object.keys(channelBranding).length) {
      throw new Error('At least one branding field must be provided.')
    }

    return await this.#apiRequest({
      logTag: 'updateChannelBranding',
      method: 'put',
      url: `${ API_BASE_URL }/channels`,
      query: { part: 'brandingSettings' },
      body: { id: channelId, brandingSettings: { channel: channelBranding } },
    })
  }

  /**
   * @description Restores channel branding from a previously captured snapshot. Pass the entire brandingSettings object (e.g., from Get My Channel). Use when reverting changes from Update Channel Branding.
   *
   * @route POST /restore-channel-branding
   * @operationName Restore Channel Branding
   * @category Channel
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube
   *
   * @paramDef {"type":"String","label":"Channel ID","name":"channelId","description":"Channel ID to restore.","required":true,"dictionary":"listMyChannelsDictionary"}
   * @paramDef {"type":"Object","label":"Branding Settings","name":"brandingSettings","description":"Full brandingSettings object as returned by Get My Channel (e.g., {channel: {title, description, ...}}).","required":true}
   *
   * @returns {Object}
   * @sampleResult {"id":"UCabc123","brandingSettings":{"channel":{"title":"My Channel","description":"original"}}}
   */
  async restoreChannelBranding(channelId, brandingSettings) {
    if (!channelId) {
      throw new Error('"Channel ID" is required')
    }

    if (!brandingSettings || typeof brandingSettings !== 'object') {
      throw new Error('"Branding Settings" is required')
    }

    return await this.#apiRequest({
      logTag: 'restoreChannelBranding',
      method: 'put',
      url: `${ API_BASE_URL }/channels`,
      query: { part: 'brandingSettings' },
      body: { id: channelId, brandingSettings },
    })
  }

  // =============================== 6.5 QUICK HELPERS ===============================

  /**
   * @description Verify the YouTube connection is working. Returns the connected channel's basic info — useful for setup wizards or health checks.
   *
   * @route POST /test-connection
   * @operationName Test Connection
   * @category Channel
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 30
   * @requiredOauth2Scopes youtube.readonly
   *
   * @returns {Object}
   * @sampleResult {"ok":true,"channelId":"UCabc","title":"My Channel","handle":"@mychannel","subscribers":"500","videos":"42"}
   */
  async testConnection() {
    const channel = await this.getMyChannel(['snippet', 'statistics'])

    if (!channel) {
      return { ok: false, message: 'No channel found for the authenticated user.' }
    }

    return {
      ok: true,
      channelId: channel.id,
      title: channel.snippet?.title,
      handle: channel.snippet?.customUrl,
      thumbnail: channel.snippet?.thumbnails?.default?.url,
      subscribers: channel.statistics?.subscriberCount,
      videos: channel.statistics?.videoCount,
      views: channel.statistics?.viewCount,
    }
  }

  /**
   * @description Look up a video using a YouTube URL (watch link, shorts, embed, youtu.be) instead of an ID. Returns the same payload as Get Video.
   *
   * @route POST /get-video-by-url
   * @operationName Get Video by URL
   * @category Videos
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.readonly
   *
   * @paramDef {"type":"String","label":"Video URL","name":"url","required":true,"description":"Full YouTube URL (e.g., https://www.youtube.com/watch?v=ID, https://youtu.be/ID, https://www.youtube.com/shorts/ID). The 11-character video ID is also accepted."}
   * @paramDef {"type":"Array.<String>","label":"Parts","name":"parts","description":"Resource parts to include.","uiComponent":{"type":"DROPDOWN","options":{"values":["snippet","statistics","contentDetails","status","topicDetails","liveStreamingDetails","player","recordingDetails","localizations"],"multiselect":true}}}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"abc123","snippet":{"title":"Demo"},"statistics":{"viewCount":"1000"}}]}
   */
  async getVideoByUrl(url, parts) {
    if (!url) throw new Error('"Video URL" is required')

    const videoId = extractVideoId(url)

    if (!videoId) {
      throw new Error(`Could not extract a video ID from "${ url }". Pass a watch URL, youtu.be URL, shorts URL, or 11-character video ID.`)
    }

    return this.getVideo(videoId, parts)
  }

  /**
   * @description Look up a playlist by URL or ID. Returns the playlist's snippet, status, and item count.
   *
   * @route POST /get-playlist-by-url
   * @operationName Get Playlist by URL
   * @category Playlists
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.readonly
   *
   * @paramDef {"type":"String","label":"Playlist URL or ID","name":"urlOrId","required":true,"description":"Full URL (e.g., https://www.youtube.com/playlist?list=PL...) or the PL... / UU... ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":"PLabc","snippet":{"title":"Tutorials","channelId":"UCabc"},"contentDetails":{"itemCount":24}}
   */
  async getPlaylistByUrl(urlOrId) {
    if (!urlOrId) throw new Error('"Playlist URL or ID" is required')

    const id = extractPlaylistId(urlOrId)

    if (!id) {
      throw new Error(`Could not extract a playlist ID from "${ urlOrId }".`)
    }

    const response = await this.#apiRequest({
      logTag: 'getPlaylistByUrl',
      url: `${ API_BASE_URL }/playlists`,
      query: { part: 'snippet,contentDetails,status', id },
    })

    return response.items?.[0] || null
  }

  /**
   * @description Get the most recent videos uploaded by a channel, identified by URL, @handle, username, or UC... ID. Cheap (3 quota units) compared to a search-based approach.
   *
   * @route POST /get-latest-videos
   * @operationName Get Latest Videos
   * @category Videos
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.readonly
   *
   * @paramDef {"type":"String","label":"Channel","name":"channel","required":true,"description":"Channel ID, @handle, username, or full YouTube channel URL."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many recent videos to fetch (1-50). Default 10."}
   *
   * @returns {Object}
   * @sampleResult {"channelId":"UCabc","items":[{"videoId":"abc123","title":"Demo","publishedAt":"2025-01-10T10:00:00Z"}]}
   */
  async getLatestVideos(channel, count) {
    if (!channel) throw new Error('"Channel" is required')

    const channelId = await this.#ensureChannelId(channel)

    const channelsResp = await this.#apiRequest({
      logTag: 'getLatestVideos:channels',
      url: `${ API_BASE_URL }/channels`,
      query: { part: 'contentDetails', id: channelId },
    })

    const uploadsPlaylistId = channelsResp.items?.[0]?.contentDetails?.relatedPlaylists?.uploads

    if (!uploadsPlaylistId) {
      return { channelId, items: [] }
    }

    const itemsResp = await this.#apiRequest({
      logTag: 'getLatestVideos:playlistItems',
      url: `${ API_BASE_URL }/playlistItems`,
      query: { part: 'snippet,contentDetails', playlistId: uploadsPlaylistId, maxResults: clampInt(count, 1, 50, 10) },
    })

    return {
      channelId,
      items: (itemsResp.items || []).map(item => ({
        videoId: item.contentDetails?.videoId,
        title: item.snippet?.title,
        description: item.snippet?.description,
        publishedAt: item.contentDetails?.videoPublishedAt,
        thumbnails: item.snippet?.thumbnails,
      })),
    }
  }

  /**
   * @description One-call channel summary: identity, statistics, and latest 5 videos. Useful for AI dashboards and channel cards.
   *
   * @route POST /summarize-channel
   * @operationName Summarize Channel
   * @category Channel
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.readonly
   *
   * @paramDef {"type":"String","label":"Channel","name":"channel","required":true,"description":"Channel ID, @handle, username, or full URL."}
   *
   * @returns {Object}
   * @sampleResult {"channelId":"UCabc","title":"My Channel","handle":"@mychannel","description":"Welcome!","thumbnail":"https://...","subscribers":"500","videos":"42","views":"12345","latestVideos":[{"videoId":"abc","title":"Demo"}]}
   */
  async summarizeChannel(channel) {
    if (!channel) throw new Error('"Channel" is required')

    const channelId = await this.#ensureChannelId(channel)

    const channelsResp = await this.#apiRequest({
      logTag: 'summarizeChannel:channels',
      url: `${ API_BASE_URL }/channels`,
      query: { part: 'snippet,statistics,contentDetails,brandingSettings', id: channelId },
    })

    const c = channelsResp.items?.[0]

    if (!c) {
      throw new Error(`Channel ${ channel } not found.`)
    }

    const uploadsPlaylistId = c.contentDetails?.relatedPlaylists?.uploads
    let latestVideos = []

    if (uploadsPlaylistId) {
      const itemsResp = await this.#apiRequest({
        logTag: 'summarizeChannel:playlistItems',
        url: `${ API_BASE_URL }/playlistItems`,
        query: { part: 'snippet,contentDetails', playlistId: uploadsPlaylistId, maxResults: 5 },
      })

      latestVideos = (itemsResp.items || []).map(item => ({
        videoId: item.contentDetails?.videoId,
        title: item.snippet?.title,
        publishedAt: item.contentDetails?.videoPublishedAt,
      }))
    }

    return {
      channelId: c.id,
      title: c.snippet?.title,
      handle: c.snippet?.customUrl,
      description: c.snippet?.description,
      thumbnail: c.snippet?.thumbnails?.default?.url,
      country: c.brandingSettings?.channel?.country,
      subscribers: c.statistics?.subscriberCount,
      videos: c.statistics?.videoCount,
      views: c.statistics?.viewCount,
      latestVideos,
    }
  }

  // =============================== 7 VIDEOS ===============================

  /**
   * @description Get videos uploaded to your YouTube channel, sorted newest-first. Returns video IDs, titles, descriptions, and thumbnails. Use for content audits, dashboards, or piping recent uploads into a workflow. (API quota: 2 units per page — efficient compared to search.)
   *
   * @route POST /list-my-videos
   * @operationName List My Videos
   * @category Videos
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes youtube.readonly
   *
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Items per page (1-50, default 25)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token returned in previous response."}
   * @paramDef {"type":"Boolean","label":"Fetch All","name":"fetchAll","uiComponent":{"type":"TOGGLE"},"description":"Auto-paginate and return all videos as a single concatenated list. Ignores Page Token. Caps at Max Pages."}
   * @paramDef {"type":"Number","label":"Max Pages","name":"maxPages","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Safety cap for Fetch All (default 10). Each page costs 1 quota unit."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"videoId":"abc123","title":"Demo","publishedAt":"2025-01-10T10:00:00Z","thumbnails":{"default":{"url":"..."}}}],"nextPageToken":"CAUQ","truncated":false}
   */
  async listMyVideos(maxResults, pageToken, fetchAll, maxPages) {
    const channelsResp = await this.#apiRequest({
      logTag: 'listMyVideos:channels',
      url: `${ API_BASE_URL }/channels`,
      query: { part: 'contentDetails', mine: 'true' },
    })

    const uploadsPlaylistId = channelsResp.items?.[0]?.contentDetails?.relatedPlaylists?.uploads

    if (!uploadsPlaylistId) {
      return { items: [], nextPageToken: null }
    }

    const limit = clampInt(maxResults, 1, 50, 25)

    const fetchPage = async pt => this.#apiRequest({
      logTag: 'listMyVideos:playlistItems',
      url: `${ API_BASE_URL }/playlistItems`,
      query: { part: 'snippet,contentDetails', playlistId: uploadsPlaylistId, maxResults: limit, pageToken: pt },
    })

    const mapItem = item => ({
      videoId: item.contentDetails?.videoId,
      title: item.snippet?.title,
      description: item.snippet?.description,
      publishedAt: item.contentDetails?.videoPublishedAt,
      thumbnails: item.snippet?.thumbnails,
    })

    if (fetchAll) {
      const all = await paginateAll(fetchPage, clampInt(maxPages, 1, 50, DEFAULT_MAX_PAGES))

      return {
        items: all.items.map(mapItem),
        nextPageToken: all.nextPageToken,
        pages: all.pages,
        truncated: all.truncated,
      }
    }

    const response = await fetchPage(pageToken)

    return {
      items: (response.items || []).map(mapItem),
      nextPageToken: response.nextPageToken || null,
      pageInfo: response.pageInfo,
    }
  }

  /**
   * @description Retrieves full metadata for one or more videos by ID, including statistics, content details, and status. Quota cost: 1 unit per part.
   *
   * @route POST /get-video
   * @operationName Get Video
   * @category Videos
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.readonly
   *
   * @paramDef {"type":"String","label":"Video IDs","name":"videoIds","required":true,"description":"One or more video IDs. Accepts a single 11-char ID, comma-separated list, or an array of strings (max 50)."}
   * @paramDef {"type":"Array.<String>","label":"Parts","name":"parts","uiComponent":{"type":"DROPDOWN","options":{"values":["snippet","statistics","contentDetails","status","topicDetails","liveStreamingDetails","player","recordingDetails","localizations"],"multiselect":true}},"description":"Resource sections to include. Default: snippet, statistics, contentDetails, status."}
   * @paramDef {"type":"Boolean","label":"Summarize","name":"summarize","uiComponent":{"type":"TOGGLE"},"description":"When on, returns a flattened single-video summary {videoId, title, viewCount, likeCount, duration, channelId, ...} instead of the raw {items:[...]} structure. Use for AI-friendly responses."}
   *
   * @sampleResultLoader { "methodName":"getVideo_SampleResultLoader", "dependsOn":["parts","summarize"] }
   * @returns {Object}
   * @sampleResult {"items":[{"id":"abc123","snippet":{"title":"Demo Video","channelId":"UCabc"},"statistics":{"viewCount":"1000","likeCount":"42","commentCount":"5"},"contentDetails":{"duration":"PT5M30S"}}]}
   */
  async getVideo(videoIds, parts, summarize) {
    if (!videoIds) {
      throw new Error('"Video IDs" is required')
    }

    const ids = Array.isArray(videoIds) ? videoIds.join(',') : videoIds

    const partList = (Array.isArray(parts) && parts.length)
      ? parts.join(',')
      : 'snippet,statistics,contentDetails,status'

    const response = await this.#apiRequest({
      logTag: 'getVideo',
      url: `${ API_BASE_URL }/videos`,
      query: { part: partList, id: ids },
    })

    if (!summarize) return response

    const item = response.items?.[0]

    if (!item) return null

    return {
      videoId: item.id,
      title: item.snippet?.title,
      description: item.snippet?.description,
      channelId: item.snippet?.channelId,
      channelTitle: item.snippet?.channelTitle,
      publishedAt: item.snippet?.publishedAt,
      thumbnails: item.snippet?.thumbnails,
      tags: item.snippet?.tags,
      categoryId: item.snippet?.categoryId,
      duration: item.contentDetails?.duration,
      viewCount: item.statistics?.viewCount,
      likeCount: item.statistics?.likeCount,
      commentCount: item.statistics?.commentCount,
      privacyStatus: item.status?.privacyStatus,
    }
  }

  /**
   * @description Get currently trending videos in a country, optionally filtered by category. Returns titles, view counts, and channel info. Use for trend analysis, content strategy, or surfacing popular content.
   *
   * @route POST /list-popular-videos
   * @operationName List Popular Videos
   * @category Videos
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.readonly
   *
   * @paramDef {"type":"String","label":"Region","name":"regionCode","description":"ISO 3166-1 alpha-2 region code. Default 'US'.","dictionary":"listI18nRegionsDictionary"}
   * @paramDef {"type":"String","label":"Category","name":"videoCategoryId","description":"Optional video category id (use Get Video Categories dictionary).","dictionary":"listVideoCategoriesDictionary"}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","description":"Items per page (1-50, default 25).","uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"abc","snippet":{"title":"Trending Video"},"statistics":{"viewCount":"1000000"}}],"nextPageToken":"..."}
   */
  async listPopularVideos(regionCode, videoCategoryId, maxResults, pageToken) {
    return await this.#apiRequest({
      logTag: 'listPopularVideos',
      url: `${ API_BASE_URL }/videos`,
      query: {
        part: 'snippet,statistics,contentDetails',
        chart: 'mostPopular',
        regionCode: regionCode || this.defaultRegion,
        videoCategoryId,
        maxResults: clampInt(maxResults, 1, 50, 25),
        pageToken,
      },
    })
  }

  /**
   * @description Upload a video to YouTube. Pick a video file from Flowrunner storage or paste any publicly fetchable URL. Set title, description, tags, category, privacy, and optional schedule time. Use for publishing pipelines, automated re-uploads, or content syndication. (API quota: 1600 units — heavy; ~6 uploads per default daily quota.)
   *
   * @route POST /upload-video
   * @operationName Upload Video
   * @category Videos
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 600
   * @requiredOauth2Scopes youtube.upload
   *
   * @paramDef {"type":"String","label":"Video File","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"Pick a video from your Flowrunner files, or paste any publicly fetchable URL. Max 256GB. Common formats: MP4, MOV, AVI, WebM."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Video title (required, max 100 chars).","required":true}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Video description (max 5000 chars).","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Tags","name":"tags","description":"Comma-separated tags."}
   * @paramDef {"type":"String","label":"Category","name":"categoryId","description":"Category ID (defaults to 22 - People & Blogs).","dictionary":"listVideoCategoriesDictionary"}
   * @paramDef {"type":"String","label":"Privacy","name":"privacyStatus","description":"Visibility: public, unlisted, private.","uiComponent":{"type":"DROPDOWN","options":{"values":["public","unlisted","private"]}}}
   * @paramDef {"type":"String","label":"Publish At","name":"publishAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Schedule the video to go live at this time (ISO 8601, e.g., 2025-12-31T15:00:00Z). Automatically forces visibility to Private until publish time."}
   * @paramDef {"type":"Boolean","label":"Made For Kids","name":"madeForKids","description":"Self-declared made-for-kids flag.","uiComponent":{"type":"TOGGLE"}}
   * @paramDef {"type":"Boolean","label":"Embeddable","name":"embeddable","description":"Allow embedding on other sites.","uiComponent":{"type":"TOGGLE"}}
   * @paramDef {"type":"String","label":"Default Language","name":"defaultLanguage","description":"BCP-47 default language for snippet fields.","dictionary":"listI18nLanguagesDictionary"}
   * @paramDef {"type":"Boolean","label":"Notify Subscribers","name":"notifySubscribers","description":"Whether to notify subscribers of the upload.","uiComponent":{"type":"TOGGLE"}}
   *
   * @returns {Object}
   * @sampleResult {"id":"abc123def","snippet":{"title":"My New Video","channelId":"UCabc"},"status":{"uploadStatus":"uploaded","privacyStatus":"private"}}
   */
  async uploadVideo(
    fileUrl, title, description, tags, categoryId, privacyStatus, publishAt,
    madeForKids, embeddable, defaultLanguage, notifySubscribers
  ) {
    if (!fileUrl) throw new Error('"File URL" is required')
    if (!title) throw new Error('"Title" is required')

    const tagList = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : undefined

    const metadata = {
      snippet: cleanupObject({
        title,
        description,
        tags: tagList,
        categoryId: categoryId || '22',
        defaultLanguage: defaultLanguage || this.defaultLanguage,
      }),
      status: cleanupObject({
        privacyStatus: publishAt ? 'private' : (privacyStatus || 'private'),
        publishAt,
        selfDeclaredMadeForKids: madeForKids,
        embeddable,
      }),
    }

    const fileBytes = await fetchBytes(fileUrl)

    return await resumableUpload({
      initUrl: `${ UPLOAD_BASE_URL }/videos?uploadType=resumable&part=snippet,status&notifySubscribers=${ notifySubscribers !== false }`,
      accessToken: this.#getAccessToken(),
      metadata,
      fileBytes,
      fileContentType: 'video/*',
    })
  }

  /**
   * @description Updates metadata for an existing video. Only provided fields are changed; others are preserved via read-modify-write.
   *
   * @route POST /update-video
   * @operationName Update Video
   * @category Videos
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube
   *
   * @paramDef {"type":"String","label":"Video","name":"videoId","description":"Video to update.","required":true,"dictionary":"listMyVideosDictionary"}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New title."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"New description.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Tags","name":"tags","description":"Comma-separated tags."}
   * @paramDef {"type":"String","label":"Category","name":"categoryId","description":"New category ID.","dictionary":"listVideoCategoriesDictionary"}
   * @paramDef {"type":"String","label":"Privacy","name":"privacyStatus","description":"New privacy: public, unlisted, private.","uiComponent":{"type":"DROPDOWN","options":{"values":["public","unlisted","private"]}}}
   * @paramDef {"type":"String","label":"Publish At","name":"publishAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Reschedule when the video goes live (ISO 8601). Use only with privacyStatus=private."}
   *
   * @returns {Object}
   * @sampleResult {"id":"abc123","snippet":{"title":"Updated Title","categoryId":"22"},"status":{"privacyStatus":"public"}}
   */
  async updateVideo(videoId, title, description, tags, categoryId, privacyStatus, publishAt) {
    if (!videoId) throw new Error('"Video" is required')

    const existing = await this.#apiRequest({
      logTag: 'updateVideo:get',
      url: `${ API_BASE_URL }/videos`,
      query: { part: 'snippet,status', id: videoId },
    })

    const current = existing.items?.[0]

    if (!current) {
      throw new Error(`Video ${ videoId } not found.`)
    }

    const partsToUpdate = []

    if (title != null) current.snippet.title = title
    if (description != null) current.snippet.description = description
    if (categoryId != null) current.snippet.categoryId = categoryId

    if (tags != null) {
      current.snippet.tags = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : []
    }

    if (title != null || description != null || categoryId != null || tags != null) {
      partsToUpdate.push('snippet')
    }

    if (privacyStatus != null) current.status.privacyStatus = privacyStatus
    if (publishAt != null) current.status.publishAt = publishAt

    if (privacyStatus != null || publishAt != null) {
      partsToUpdate.push('status')
    }

    if (!partsToUpdate.length) {
      throw new Error('At least one updatable field must be provided.')
    }

    return await this.#apiRequest({
      logTag: 'updateVideo',
      method: 'put',
      url: `${ API_BASE_URL }/videos`,
      query: { part: partsToUpdate.join(',') },
      body: {
        id: videoId,
        snippet: partsToUpdate.includes('snippet') ? current.snippet : undefined,
        status: partsToUpdate.includes('status') ? current.status : undefined,
      },
    })
  }

  /**
   * @description Deletes a video. Authenticated user must own the video.
   *
   * @route POST /delete-video
   * @operationName Delete Video
   * @category Videos
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube
   *
   * @paramDef {"type":"String","label":"Video","name":"videoId","description":"Video to delete.","required":true,"dictionary":"listMyVideosDictionary"}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"videoId":"abc123"}
   */
  async deleteVideo(videoId) {
    if (!videoId) throw new Error('"Video" is required')

    await this.#apiRequest({
      logTag: 'deleteVideo',
      method: 'delete',
      url: `${ API_BASE_URL }/videos`,
      query: { id: videoId },
    })

    return { success: true, videoId }
  }

  /**
   * @description Sets the authenticated user's rating on a video (like, dislike, or none).
   *
   * @route POST /rate-video
   * @operationName Rate Video
   * @category Videos
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube
   *
   * @paramDef {"type":"String","label":"Video ID","name":"videoId","description":"Video to rate.","required":true,"dictionary":"listMyVideosDictionary"}
   * @paramDef {"type":"String","label":"Rating","name":"rating","description":"like, dislike, or none (clears rating).","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["like","dislike","none"]}}}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"videoId":"abc123","rating":"like"}
   */
  async rateVideo(videoId, rating) {
    if (!videoId) throw new Error('"Video ID" is required')
    if (!rating) throw new Error('"Rating" is required')

    await this.#apiRequest({
      logTag: 'rateVideo',
      method: 'post',
      url: `${ API_BASE_URL }/videos/rate`,
      query: { id: videoId, rating },
    })

    return { success: true, videoId, rating }
  }

  /**
   * @description Returns the authenticated user's current rating(s) on one or more videos.
   *
   * @route POST /get-video-rating
   * @operationName Get Video Rating
   * @category Videos
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube
   *
   * @paramDef {"type":"String","label":"Video IDs","name":"videoIds","required":true,"description":"One or more video IDs. Accepts a single ID, comma-separated list, or an array of strings.","dictionary":"listMyVideosDictionary"}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"videoId":"abc123","rating":"like"}]}
   */
  async getVideoRating(videoIds) {
    if (!videoIds) throw new Error('"Video IDs" is required')

    const ids = Array.isArray(videoIds) ? videoIds.join(',') : videoIds

    return await this.#apiRequest({
      logTag: 'getVideoRating',
      url: `${ API_BASE_URL }/videos/getRating`,
      query: { id: ids },
    })
  }

  /**
   * @description Reports a video for abuse. Provide a reason ID from Get Video Abuse Report Reasons.
   *
   * @route POST /report-video-abuse
   * @operationName Report Video Abuse
   * @category Comments & Moderation
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube
   *
   * @paramDef {"type":"String","label":"Video ID","name":"videoId","description":"Video to report.","required":true}
   * @paramDef {"type":"String","label":"Reason","name":"reasonId","description":"Abuse reason ID.","required":true,"dictionary":"listAbuseReasonsDictionary"}
   * @paramDef {"type":"String","label":"Secondary Reason","name":"secondaryReasonId","dictionary":"listSecondaryAbuseReasonsDictionary","dependsOn":["reasonId"],"description":"Optionally pick a more specific sub-reason (depends on the primary reason chosen)."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","description":"Additional notes about the report.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Language of the comments (BCP-47).","dictionary":"listI18nLanguagesDictionary"}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"videoId":"abc123"}
   */
  async reportVideoAbuse(videoId, reasonId, secondaryReasonId, comments, language) {
    if (!videoId) throw new Error('"Video ID" is required')
    if (!reasonId) throw new Error('"Reason" is required')

    await this.#apiRequest({
      logTag: 'reportVideoAbuse',
      method: 'post',
      url: `${ API_BASE_URL }/videos/reportAbuse`,
      body: cleanupObject({ videoId, reasonId, secondaryReasonId, comments, language }),
    })

    return { success: true, videoId }
  }

  /**
   * @description Sets a custom thumbnail for a video. Image must be JPEG/PNG, max 2MB.
   *
   * @route POST /set-video-thumbnail
   * @operationName Set Video Thumbnail
   * @category Videos
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes youtube.upload
   *
   * @paramDef {"type":"String","label":"Video","name":"videoId","description":"Video to update.","required":true,"dictionary":"listMyVideosDictionary"}
   * @paramDef {"type":"String","label":"Image File","name":"imageUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"Pick a JPEG or PNG image (max 2MB) from Flowrunner files, or paste a publicly fetchable URL. Note: Custom thumbnails require a phone-verified YouTube channel."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"default":{"url":"...","width":120,"height":90}}]}
   */
  async setVideoThumbnail(videoId, imageUrl) {
    if (!videoId) throw new Error('"Video" is required')
    if (!imageUrl) throw new Error('"Image URL" is required')

    const imageBytes = await fetchBytes(imageUrl)

    return await binaryUpload({
      url: `${ UPLOAD_BASE_URL }/thumbnails/set?videoId=${ encodeURIComponent(videoId) }`,
      accessToken: this.#getAccessToken(),
      fileBytes: imageBytes,
      fileContentType: guessImageContentType(imageUrl),
    })
  }

  // =============================== 8 PLAYLISTS ===============================

  /**
   * @description Lists playlists owned by a channel or by ID. Defaults to authenticated user's playlists.
   *
   * @route POST /list-playlists
   * @operationName List Playlists
   * @category Playlists
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.readonly
   *
   * @paramDef {"type":"String","label":"Channel ID","name":"channelId","description":"List playlists for this channel. Mutually exclusive with 'mine'."}
   * @paramDef {"type":"Boolean","label":"Mine","name":"mine","description":"List the authenticated user's own playlists. Default: true if no Channel ID.","uiComponent":{"type":"TOGGLE"}}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","description":"Items per page (1-50, default 25).","uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"PLabc","snippet":{"title":"Tutorials","channelId":"UCabc"},"contentDetails":{"itemCount":24}}],"nextPageToken":"..."}
   */
  async listPlaylists(channelId, mine, maxResults, pageToken) {
    const query = { part: 'snippet,contentDetails,status', maxResults: clampInt(maxResults, 1, 50, 25), pageToken }

    if (channelId) {
      query.channelId = channelId
    } else if (mine === false) {
      throw new Error('Either "Channel ID" or "Mine" must be set.')
    } else {
      query.mine = 'true'
    }

    return await this.#apiRequest({
      logTag: 'listPlaylists',
      url: `${ API_BASE_URL }/playlists`,
      query,
    })
  }

  /**
   * @description Creates a new playlist on the authenticated user's channel.
   *
   * @route POST /create-playlist
   * @operationName Create Playlist
   * @category Playlists
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube
   *
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Playlist title.","required":true}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Playlist description.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Privacy","name":"privacyStatus","description":"Visibility: public, unlisted, private.","uiComponent":{"type":"DROPDOWN","options":{"values":["public","unlisted","private"]}}}
   * @paramDef {"type":"String","label":"Default Language","name":"defaultLanguage","description":"BCP-47 language code.","dictionary":"listI18nLanguagesDictionary"}
   *
   * @returns {Object}
   * @sampleResult {"id":"PLabc123","snippet":{"title":"My Playlist","description":"..."},"status":{"privacyStatus":"private"}}
   */
  async createPlaylist(title, description, privacyStatus, defaultLanguage) {
    if (!title) throw new Error('"Title" is required')

    return await this.#apiRequest({
      logTag: 'createPlaylist',
      method: 'post',
      url: `${ API_BASE_URL }/playlists`,
      query: { part: 'snippet,status' },
      body: {
        snippet: cleanupObject({ title, description, defaultLanguage: defaultLanguage || this.defaultLanguage }),
        status: { privacyStatus: privacyStatus || 'private' },
      },
    })
  }

  /**
   * @description Updates an existing playlist's metadata.
   *
   * @route POST /update-playlist
   * @operationName Update Playlist
   * @category Playlists
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube
   *
   * @paramDef {"type":"String","label":"Playlist","name":"playlistId","description":"Playlist to update.","required":true,"dictionary":"listMyPlaylistsDictionary"}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New title."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"New description.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Privacy","name":"privacyStatus","description":"New privacy status.","uiComponent":{"type":"DROPDOWN","options":{"values":["public","unlisted","private"]}}}
   *
   * @returns {Object}
   * @sampleResult {"id":"PLabc","snippet":{"title":"Updated Title"},"status":{"privacyStatus":"public"}}
   */
  async updatePlaylist(playlistId, title, description, privacyStatus) {
    if (!playlistId) throw new Error('"Playlist" is required')

    const existing = await this.#apiRequest({
      logTag: 'updatePlaylist:get',
      url: `${ API_BASE_URL }/playlists`,
      query: { part: 'snippet,status', id: playlistId },
    })

    const current = existing.items?.[0]

    if (!current) {
      throw new Error(`Playlist ${ playlistId } not found.`)
    }

    if (title !== undefined) current.snippet.title = title
    if (description !== undefined) current.snippet.description = description
    if (privacyStatus !== undefined) current.status.privacyStatus = privacyStatus

    // Send the mutated snippet/status objects so unread fields (defaultLanguage, localizations)
    // are preserved on this read-modify-write — playlists.update replaces the whole part.
    return await this.#apiRequest({
      logTag: 'updatePlaylist',
      method: 'put',
      url: `${ API_BASE_URL }/playlists`,
      query: { part: 'snippet,status' },
      body: {
        id: playlistId,
        snippet: current.snippet,
        status: current.status,
      },
    })
  }

  /**
   * @description Deletes a playlist owned by the authenticated user.
   *
   * @route POST /delete-playlist
   * @operationName Delete Playlist
   * @category Playlists
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube
   *
   * @paramDef {"type":"String","label":"Playlist","name":"playlistId","description":"Playlist to delete.","required":true,"dictionary":"listMyPlaylistsDictionary"}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"playlistId":"PLabc"}
   */
  async deletePlaylist(playlistId) {
    if (!playlistId) throw new Error('"Playlist" is required')

    await this.#apiRequest({
      logTag: 'deletePlaylist',
      method: 'delete',
      url: `${ API_BASE_URL }/playlists`,
      query: { id: playlistId },
    })

    return { success: true, playlistId }
  }

  // =============================== 9 PLAYLIST ITEMS ===============================

  /**
   * @description Lists items in a playlist.
   *
   * @route POST /list-playlist-items
   * @operationName List Playlist Items
   * @category Playlists
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.readonly
   *
   * @paramDef {"type":"String","label":"Playlist","name":"playlistId","required":true,"dictionary":"listMyPlaylistsDictionary","description":"Playlist to inspect."}
   * @paramDef {"type":"String","label":"Video ID Filter","name":"videoId","description":"Optionally filter by a specific video ID."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Items per page (1-50, default 25)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token."}
   * @paramDef {"type":"Boolean","label":"Fetch All","name":"fetchAll","uiComponent":{"type":"TOGGLE"},"description":"Auto-paginate the entire playlist into one list. Ignores Page Token. Caps at Max Pages."}
   * @paramDef {"type":"Number","label":"Max Pages","name":"maxPages","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Safety cap for Fetch All (default 10)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"PLI_abc","snippet":{"title":"Episode 1","position":0,"resourceId":{"videoId":"abc123"}}}],"nextPageToken":"..."}
   */
  async listPlaylistItems(playlistId, videoId, maxResults, pageToken, fetchAll, maxPages) {
    if (!playlistId) throw new Error('"Playlist" is required')

    const baseQuery = { part: 'snippet,contentDetails,status', playlistId, videoId, maxResults: clampInt(maxResults, 1, 50, 25) }

    const fetchPage = pt => this.#apiRequest({
      logTag: 'listPlaylistItems',
      url: `${ API_BASE_URL }/playlistItems`,
      query: { ...baseQuery, pageToken: pt },
    })

    if (fetchAll) {
      const all = await paginateAll(fetchPage, clampInt(maxPages, 1, 50, DEFAULT_MAX_PAGES))

      return { items: all.items, pages: all.pages, truncated: all.truncated, nextPageToken: all.nextPageToken }
    }

    return await fetchPage(pageToken)
  }

  /**
   * @description Adds a video to a playlist. Optionally specify position.
   *
   * @route POST /add-playlist-item
   * @operationName Add Video to Playlist
   * @category Playlists
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube
   *
   * @paramDef {"type":"String","label":"Playlist","name":"playlistId","description":"Target playlist.","required":true,"dictionary":"listMyPlaylistsDictionary"}
   * @paramDef {"type":"String","label":"Video ID","name":"videoId","description":"Video to add.","required":true}
   * @paramDef {"type":"Number","label":"Position","name":"position","description":"Zero-indexed position. Defaults to end.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"String","label":"Note","name":"note","description":"Optional note (max 280 chars)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"PLI_xyz","snippet":{"playlistId":"PLabc","position":0,"resourceId":{"kind":"youtube#video","videoId":"abc123"}}}
   */
  async addPlaylistItem(playlistId, videoId, position, note) {
    if (!playlistId) throw new Error('"Playlist" is required')
    if (!videoId) throw new Error('"Video ID" is required')

    return await this.#apiRequest({
      logTag: 'addPlaylistItem',
      method: 'post',
      url: `${ API_BASE_URL }/playlistItems`,
      query: { part: 'snippet,contentDetails' },
      body: {
        snippet: cleanupObject({
          playlistId,
          position: typeof position === 'number' ? position : undefined,
          resourceId: { kind: 'youtube#video', videoId },
        }),
        contentDetails: note ? { note } : undefined,
      },
    })
  }

  /**
   * @description Updates a playlist item (e.g., reorder by changing position).
   *
   * @route POST /update-playlist-item
   * @operationName Update Playlist Item
   * @category Playlists
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube
   *
   * @paramDef {"type":"String","label":"Playlist Item ID","name":"playlistItemId","description":"Playlist item id (e.g., PLI_xyz). From List Playlist Items.","required":true,"dictionary":"listPlaylistItemsDictionary","dependsOn":["playlistId"]}
   * @paramDef {"type":"String","label":"Playlist","name":"playlistId","description":"Containing playlist.","required":true,"dictionary":"listMyPlaylistsDictionary"}
   * @paramDef {"type":"String","label":"Video ID","name":"videoId","description":"Video referenced by the item.","required":true,"dictionary":"listMyVideosDictionary"}
   * @paramDef {"type":"Number","label":"Position","name":"position","description":"New zero-indexed position.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"String","label":"Note","name":"note","description":"Optional note."}
   *
   * @returns {Object}
   * @sampleResult {"id":"PLI_xyz","snippet":{"playlistId":"PLabc","position":2,"resourceId":{"videoId":"abc123"}}}
   */
  async updatePlaylistItem(playlistItemId, playlistId, videoId, position, note) {
    if (!playlistItemId) throw new Error('"Playlist Item ID" is required')
    if (!playlistId) throw new Error('"Playlist" is required')
    if (!videoId) throw new Error('"Video ID" is required')

    return await this.#apiRequest({
      logTag: 'updatePlaylistItem',
      method: 'put',
      url: `${ API_BASE_URL }/playlistItems`,
      query: { part: 'snippet,contentDetails' },
      body: {
        id: playlistItemId,
        snippet: cleanupObject({
          playlistId,
          position: typeof position === 'number' ? position : undefined,
          resourceId: { kind: 'youtube#video', videoId },
        }),
        contentDetails: note ? { note } : undefined,
      },
    })
  }

  /**
   * @description Removes an item from a playlist.
   *
   * @route POST /remove-playlist-item
   * @operationName Remove Playlist Item
   * @category Playlists
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube
   *
   * @paramDef {"type":"String","label":"Playlist Item ID","name":"playlistItemId","description":"Playlist item id (PLI_...).","required":true}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"playlistItemId":"PLI_xyz"}
   */
  async removePlaylistItem(playlistItemId) {
    if (!playlistItemId) throw new Error('"Playlist Item ID" is required')

    await this.#apiRequest({
      logTag: 'removePlaylistItem',
      method: 'delete',
      url: `${ API_BASE_URL }/playlistItems`,
      query: { id: playlistItemId },
    })

    return { success: true, playlistItemId }
  }

  // =============================== 10 SEARCH ===============================

  /**
   * @description Search YouTube for videos by keywords with filters for duration, definition, captions, recency, and live status. Returns video titles, channel info, and thumbnails. Use for content discovery, trend research, or building dynamic feeds. Statistics (view counts, likes) are NOT included by default — enable "Enrich Statistics" to add them in one extra call. (API quota: 100 units per call, +1 if enriching.)
   *
   * @route POST /search-videos
   * @operationName Search Videos
   * @category Search & Discovery
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.readonly
   *
   * @paramDef {"type":"String","label":"Query","name":"q","description":"Search keywords. Use quotes for phrases, '-term' to exclude, 'a|b' for OR."}
   * @paramDef {"type":"String","label":"Channel ID","name":"channelId","description":"Limit results to a specific channel."}
   * @paramDef {"type":"String","label":"Order","name":"order","description":"Sort order.","uiComponent":{"type":"DROPDOWN","options":{"values":["relevance","date","rating","title","videoCount","viewCount"]}}}
   * @paramDef {"type":"String","label":"Published After","name":"publishedAfter","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Lower-bound timestamp (RFC 3339, e.g., 2025-01-20T00:00:00Z)."}
   * @paramDef {"type":"String","label":"Published Before","name":"publishedBefore","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Upper-bound timestamp (RFC 3339, e.g., 2025-12-31T23:59:59Z)."}
   * @paramDef {"type":"String","label":"Region","name":"regionCode","description":"ISO 3166-1 alpha-2 region.","dictionary":"listI18nRegionsDictionary"}
   * @paramDef {"type":"String","label":"Relevance Language","name":"relevanceLanguage","description":"BCP-47 hint for ranking.","dictionary":"listI18nLanguagesDictionary"}
   * @paramDef {"type":"String","label":"Safe Search","name":"safeSearch","description":"Safe search level.","uiComponent":{"type":"DROPDOWN","options":{"values":["none","moderate","strict"]}}}
   * @paramDef {"type":"String","label":"Event Type","name":"eventType","description":"Live filter.","uiComponent":{"type":"DROPDOWN","options":{"values":["live","upcoming","completed"]}}}
   * @paramDef {"type":"String","label":"Video Duration","name":"videoDuration","description":"Duration filter.","uiComponent":{"type":"DROPDOWN","options":{"values":["short","medium","long","any"]}}}
   * @paramDef {"type":"String","label":"Video Definition","name":"videoDefinition","description":"Definition filter.","uiComponent":{"type":"DROPDOWN","options":{"values":["high","standard","any"]}}}
   * @paramDef {"type":"String","label":"Video Caption","name":"videoCaption","description":"Caption filter.","uiComponent":{"type":"DROPDOWN","options":{"values":["closedCaption","none","any"]}}}
   * @paramDef {"type":"String","label":"Video Category","name":"videoCategoryId","description":"Filter by category.","dictionary":"listVideoCategoriesDictionary"}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","description":"1-50, default 10.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token."}
   * @paramDef {"type":"Boolean","label":"Enrich Statistics","name":"enrichStatistics","uiComponent":{"type":"TOGGLE"},"description":"Add view/like/comment counts and duration via a follow-up videos.list call (+1 quota)."}
   *
   * @sampleResultLoader { "methodName":"searchVideos_SampleResultLoader", "dependsOn":["enrichStatistics"] }
   * @returns {Object}
   * @sampleResult {"items":[{"id":{"kind":"youtube#video","videoId":"abc123"},"snippet":{"title":"Demo","channelTitle":"Demo Ch","publishedAt":"2025-01-10T00:00:00Z"},"statistics":{"viewCount":"1000","likeCount":"42"}}],"nextPageToken":"..."}
   */
  async searchVideos(
    q, channelId, order, publishedAfter, publishedBefore, regionCode, relevanceLanguage,
    safeSearch, eventType, videoDuration, videoDefinition, videoCaption, videoCategoryId,
    maxResults, pageToken, enrichStatistics
  ) {
    const response = await this.#apiRequest({
      logTag: 'searchVideos',
      url: `${ API_BASE_URL }/search`,
      query: {
        part: 'snippet', type: 'video', q, channelId, order,
        publishedAfter, publishedBefore,
        regionCode: regionCode || this.defaultRegion,
        relevanceLanguage: relevanceLanguage || this.defaultLanguage,
        safeSearch, eventType, videoDuration, videoDefinition, videoCaption, videoCategoryId,
        maxResults: clampInt(maxResults, 1, 50, 10),
        pageToken,
      },
    })

    if (!enrichStatistics) return response

    const ids = (response.items || []).map(i => i.id?.videoId).filter(Boolean).join(',')

    if (!ids) return response

    const enriched = await this.#apiRequest({
      logTag: 'searchVideos:enrich',
      url: `${ API_BASE_URL }/videos`,
      query: { part: 'statistics,contentDetails', id: ids },
    })

    const statsById = {}

    for (const v of (enriched.items || [])) {
      statsById[v.id] = { statistics: v.statistics, contentDetails: v.contentDetails }
    }

    response.items = (response.items || []).map(item => ({
      ...item,
      statistics: statsById[item.id?.videoId]?.statistics,
      contentDetails: statsById[item.id?.videoId]?.contentDetails,
    }))

    return response
  }

  /**
   * @description Search YouTube for channels matching keywords. Returns channel titles, IDs, and descriptions. Use for finding creators, competitor research, or building channel directories. (API quota: 100 units per call.)
   *
   * @route POST /search-channels
   * @operationName Search Channels
   * @category Search & Discovery
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.readonly
   *
   * @paramDef {"type":"String","label":"Query","name":"q","description":"Search keywords."}
   * @paramDef {"type":"String","label":"Channel Type","name":"channelType","description":"Filter to 'show' or 'any'.","uiComponent":{"type":"DROPDOWN","options":{"values":["any","show"]}}}
   * @paramDef {"type":"String","label":"Order","name":"order","description":"Sort order.","uiComponent":{"type":"DROPDOWN","options":{"values":["relevance","date","videoCount","viewCount"]}}}
   * @paramDef {"type":"String","label":"Region","name":"regionCode","description":"ISO 3166-1 alpha-2.","dictionary":"listI18nRegionsDictionary"}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","description":"1-50, default 10.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":{"channelId":"UCabc"},"snippet":{"title":"Some Channel"}}],"nextPageToken":"..."}
   */
  async searchChannels(q, channelType, order, regionCode, maxResults, pageToken) {
    return await this.#apiRequest({
      logTag: 'searchChannels',
      url: `${ API_BASE_URL }/search`,
      query: { part: 'snippet', type: 'channel', q, channelType, order, regionCode: regionCode || this.defaultRegion, maxResults: clampInt(maxResults, 1, 50, 10), pageToken },
    })
  }

  /**
   * @description Search YouTube for public playlists by keywords. Returns playlist titles, owners, and IDs. Use for content curation discovery or finding curated collections. (API quota: 100 units per call.)
   *
   * @route POST /search-playlists
   * @operationName Search Playlists
   * @category Search & Discovery
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.readonly
   *
   * @paramDef {"type":"String","label":"Query","name":"q","description":"Search keywords."}
   * @paramDef {"type":"String","label":"Channel ID","name":"channelId","description":"Optional channel filter."}
   * @paramDef {"type":"String","label":"Order","name":"order","description":"Sort order.","uiComponent":{"type":"DROPDOWN","options":{"values":["relevance","date","title","videoCount"]}}}
   * @paramDef {"type":"String","label":"Region","name":"regionCode","description":"ISO 3166-1 alpha-2.","dictionary":"listI18nRegionsDictionary"}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","description":"1-50, default 10.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":{"playlistId":"PLabc"},"snippet":{"title":"Tutorials","channelId":"UCabc"}}],"nextPageToken":"..."}
   */
  async searchPlaylists(q, channelId, order, regionCode, maxResults, pageToken) {
    return await this.#apiRequest({
      logTag: 'searchPlaylists',
      url: `${ API_BASE_URL }/search`,
      query: { part: 'snippet', type: 'playlist', q, channelId, order, regionCode: regionCode || this.defaultRegion, maxResults: clampInt(maxResults, 1, 50, 10), pageToken },
    })
  }

  // =============================== 11 SUBSCRIPTIONS ===============================

  /**
   * @description Lists subscriptions. By default returns the authenticated user's subscriptions.
   *
   * @route POST /list-subscriptions
   * @operationName List Subscriptions
   * @category Subscriptions
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.readonly
   *
   * @paramDef {"type":"String","label":"Channel ID","name":"channelId","description":"Channel whose subscriptions to list (must be public)."}
   * @paramDef {"type":"Boolean","label":"Mine","name":"mine","description":"List the authenticated user's subscriptions. Default true if no Channel ID.","uiComponent":{"type":"TOGGLE"}}
   * @paramDef {"type":"Boolean","label":"My Subscribers","name":"mySubscribers","description":"List who subscribes to the authenticated user.","uiComponent":{"type":"TOGGLE"}}
   * @paramDef {"type":"String","label":"Order","name":"order","uiComponent":{"type":"DROPDOWN","options":{"values":["alphabetical","relevance","unread"]}},"description":"Sort order."}
   * @paramDef {"type":"String","label":"For Channel ID","name":"forChannelId","description":"Filter results to subscriptions targeting one or more channels (comma-separated). Useful with mine=true to check existence."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-50, default 25."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token."}
   * @paramDef {"type":"Boolean","label":"Fetch All","name":"fetchAll","uiComponent":{"type":"TOGGLE"},"description":"Auto-paginate and return all subscriptions concatenated. Ignores Page Token. Caps at Max Pages."}
   * @paramDef {"type":"Number","label":"Max Pages","name":"maxPages","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Safety cap for Fetch All (default 10)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"sub_abc","snippet":{"title":"Other Channel","resourceId":{"channelId":"UCxyz"}}}],"nextPageToken":"..."}
   */
  async listSubscriptions(channelId, mine, mySubscribers, order, forChannelId, maxResults, pageToken, fetchAll, maxPages) {
    const baseQuery = { part: 'snippet,subscriberSnippet,contentDetails', order, forChannelId, maxResults: clampInt(maxResults, 1, 50, 25) }

    if (mySubscribers) {
      baseQuery.mySubscribers = 'true'
    } else if (channelId) {
      baseQuery.channelId = channelId
    } else {
      baseQuery.mine = 'true'
    }

    const fetchPage = pt => this.#apiRequest({
      logTag: 'listSubscriptions',
      url: `${ API_BASE_URL }/subscriptions`,
      query: { ...baseQuery, pageToken: pt },
    })

    if (fetchAll) {
      const all = await paginateAll(fetchPage, clampInt(maxPages, 1, 50, DEFAULT_MAX_PAGES))

      return { items: all.items, pages: all.pages, truncated: all.truncated, nextPageToken: all.nextPageToken }
    }

    return await fetchPage(pageToken)
  }

  /**
   * @description Subscribes the authenticated user to a channel.
   *
   * @route POST /subscribe-to-channel
   * @operationName Subscribe to Channel
   * @category Subscriptions
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube
   *
   * @paramDef {"type":"String","label":"Channel","name":"channelId","required":true,"description":"Channel to subscribe to. Accepts a UC... ID, an @handle, a legacy username, or a full YouTube channel URL."}
   *
   * @returns {Object}
   * @sampleResult {"id":"sub_abc","snippet":{"resourceId":{"channelId":"UCxyz"}}}
   */
  async subscribeToChannel(channelId) {
    if (!channelId) throw new Error('"Channel" is required')

    const resolvedId = await this.#ensureChannelId(channelId)

    try {
      return await this.#apiRequest({
        logTag: 'subscribeToChannel',
        method: 'post',
        url: `${ API_BASE_URL }/subscriptions`,
        query: { part: 'snippet' },
        body: { snippet: { resourceId: { kind: 'youtube#channel', channelId: resolvedId } } },
      })
    } catch (error) {
      // Idempotent: if already subscribed, fetch and return the existing subscription.
      if (typeof error.message === 'string' && error.message.includes('subscriptionDuplicate')) {
        const existing = await this.#apiRequest({
          logTag: 'subscribeToChannel:lookupExisting',
          url: `${ API_BASE_URL }/subscriptions`,
          query: { part: 'snippet', mine: 'true', forChannelId: resolvedId, maxResults: 1 },
        })

        const sub = existing.items?.[0]

        if (sub) return sub
      }

      throw error
    }
  }

  /**
   * @description Removes a subscription. Pass the subscription ID (not channel ID) — get it from List Subscriptions.
   *
   * @route POST /unsubscribe
   * @operationName Unsubscribe
   * @category Subscriptions
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube
   *
   * @paramDef {"type":"String","label":"Subscription","name":"subscriptionId","required":true,"dictionary":"listMySubscriptionsDictionary","description":"Pick a subscription you currently have, or paste a subscription ID. (Note: this is NOT the same as a channel ID.)"}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"subscriptionId":"sub_abc"}
   */
  async unsubscribe(subscriptionId) {
    if (!subscriptionId) throw new Error('"Subscription ID" is required')

    await this.#apiRequest({
      logTag: 'unsubscribe',
      method: 'delete',
      url: `${ API_BASE_URL }/subscriptions`,
      query: { id: subscriptionId },
    })

    return { success: true, subscriptionId }
  }

  // =============================== 12 COMMENTS ===============================

  /**
   * @description Lists top-level comment threads on a video, channel, or all threads related to a channel.
   *
   * @route POST /list-comment-threads
   * @operationName List Comment Threads
   * @category Comments & Moderation
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.force-ssl
   *
   * @paramDef {"type":"String","label":"Video ID","name":"videoId","description":"List threads for a specific video."}
   * @paramDef {"type":"String","label":"Channel ID","name":"channelId","description":"List threads about a channel (channel-level comments only)."}
   * @paramDef {"type":"String","label":"All Threads For Channel","name":"allThreadsRelatedToChannelId","description":"List all threads related to the channel including its videos."}
   * @paramDef {"type":"String","label":"Moderation Status","name":"moderationStatus","description":"Filter by status (owner only).","uiComponent":{"type":"DROPDOWN","options":{"values":["heldForReview","likelySpam","published"]}}}
   * @paramDef {"type":"String","label":"Order","name":"order","description":"Sort.","uiComponent":{"type":"DROPDOWN","options":{"values":["time","relevance"]}}}
   * @paramDef {"type":"String","label":"Search Terms","name":"searchTerms","description":"Optional substring filter."}
   * @paramDef {"type":"String","label":"Text Format","name":"textFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["html","plainText"]}},"description":"Body format."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-100, default 20."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token."}
   * @paramDef {"type":"Boolean","label":"Fetch All","name":"fetchAll","uiComponent":{"type":"TOGGLE"},"description":"Auto-paginate and return all comment threads. Ignores Page Token. Caps at Max Pages."}
   * @paramDef {"type":"Number","label":"Max Pages","name":"maxPages","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Safety cap for Fetch All (default 10)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"ct_abc","snippet":{"topLevelComment":{"snippet":{"textDisplay":"Great video!","authorDisplayName":"@user","likeCount":3}},"totalReplyCount":1}}],"nextPageToken":"..."}
   */
  async listCommentThreads(videoId, channelId, allThreadsRelatedToChannelId, moderationStatus, order, searchTerms, textFormat, maxResults, pageToken, fetchAll, maxPages) {
    if (!videoId && !channelId && !allThreadsRelatedToChannelId) {
      throw new Error('One of "Video ID", "Channel ID", or "All Threads For Channel" is required.')
    }

    const baseQuery = {
      part: 'snippet,replies', videoId, channelId, allThreadsRelatedToChannelId,
      moderationStatus, order, searchTerms, textFormat,
      maxResults: clampInt(maxResults, 1, 100, 20),
    }

    const fetchPage = pt => this.#apiRequest({
      logTag: 'listCommentThreads',
      url: `${ API_BASE_URL }/commentThreads`,
      query: { ...baseQuery, pageToken: pt },
    })

    if (fetchAll) {
      const all = await paginateAll(fetchPage, clampInt(maxPages, 1, 50, DEFAULT_MAX_PAGES))

      return { items: all.items, pages: all.pages, truncated: all.truncated, nextPageToken: all.nextPageToken }
    }

    return await fetchPage(pageToken)
  }

  /**
   * @description Lists replies to a parent comment.
   *
   * @route POST /list-comment-replies
   * @operationName List Comment Replies
   * @category Comments & Moderation
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.force-ssl
   *
   * @paramDef {"type":"String","label":"Parent Comment ID","name":"parentId","description":"ID of the top-level comment.","required":true}
   * @paramDef {"type":"String","label":"Text Format","name":"textFormat","description":"Body format.","uiComponent":{"type":"DROPDOWN","options":{"values":["html","plainText"]}}}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","description":"1-100, default 20.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"reply_xyz","snippet":{"textDisplay":"Thanks!","parentId":"ct_abc"}}],"nextPageToken":"..."}
   */
  async listCommentReplies(parentId, textFormat, maxResults, pageToken) {
    if (!parentId) throw new Error('"Parent Comment ID" is required')

    return await this.#apiRequest({
      logTag: 'listCommentReplies',
      url: `${ API_BASE_URL }/comments`,
      query: { part: 'snippet', parentId, textFormat, maxResults: clampInt(maxResults, 1, 100, 20), pageToken },
    })
  }

  /**
   * @description Posts a top-level comment on a video or channel discussion.
   *
   * @route POST /post-top-comment
   * @operationName Post Top-Level Comment
   * @category Comments & Moderation
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.force-ssl
   *
   * @paramDef {"type":"String","label":"Text","name":"text","description":"Comment body.","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Video ID","name":"videoId","description":"Target video. Required unless Channel ID provided."}
   * @paramDef {"type":"String","label":"Channel ID","name":"channelId","description":"Target channel for channel-level discussion. Required if no Video ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":"ct_new","snippet":{"topLevelComment":{"snippet":{"textDisplay":"Hello!","authorDisplayName":"@me"}}}}
   */
  async postTopComment(text, videoId, channelId) {
    if (!text) throw new Error('"Text" is required')
    if (!videoId && !channelId) throw new Error('One of "Video ID" or "Channel ID" is required.')

    return await this.#apiRequest({
      logTag: 'postTopComment',
      method: 'post',
      url: `${ API_BASE_URL }/commentThreads`,
      query: { part: 'snippet' },
      body: {
        snippet: cleanupObject({
          videoId, channelId,
          topLevelComment: { snippet: { textOriginal: text } },
        }),
      },
    })
  }

  /**
   * @description Posts a reply to an existing comment.
   *
   * @route POST /post-comment-reply
   * @operationName Post Comment Reply
   * @category Comments & Moderation
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.force-ssl
   *
   * @paramDef {"type":"String","label":"Parent Comment ID","name":"parentId","description":"ID of the comment being replied to.","required":true}
   * @paramDef {"type":"String","label":"Text","name":"text","description":"Reply body.","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"}}
   *
   * @returns {Object}
   * @sampleResult {"id":"reply_new","snippet":{"parentId":"ct_abc","textDisplay":"Hi back!"}}
   */
  async postCommentReply(parentId, text) {
    if (!parentId) throw new Error('"Parent Comment ID" is required')
    if (!text) throw new Error('"Text" is required')

    return await this.#apiRequest({
      logTag: 'postCommentReply',
      method: 'post',
      url: `${ API_BASE_URL }/comments`,
      query: { part: 'snippet' },
      body: { snippet: { parentId, textOriginal: text } },
    })
  }

  /**
   * @description Updates an existing comment owned by the authenticated user.
   *
   * @route POST /update-comment
   * @operationName Update Comment
   * @category Comments & Moderation
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.force-ssl
   *
   * @paramDef {"type":"String","label":"Comment ID","name":"commentId","description":"Comment to update.","required":true}
   * @paramDef {"type":"String","label":"Text","name":"text","description":"New body.","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"}}
   *
   * @returns {Object}
   * @sampleResult {"id":"comment_abc","snippet":{"textDisplay":"Edited text"}}
   */
  async updateComment(commentId, text) {
    if (!commentId) throw new Error('"Comment ID" is required')
    if (!text) throw new Error('"Text" is required')

    return await this.#apiRequest({
      logTag: 'updateComment',
      method: 'put',
      url: `${ API_BASE_URL }/comments`,
      query: { part: 'snippet' },
      body: { id: commentId, snippet: { textOriginal: text } },
    })
  }

  /**
   * @description Deletes a comment.
   *
   * @route POST /delete-comment
   * @operationName Delete Comment
   * @category Comments & Moderation
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.force-ssl
   *
   * @paramDef {"type":"String","label":"Comment ID","name":"commentId","description":"Comment to delete.","required":true}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"commentId":"comment_abc"}
   */
  async deleteComment(commentId) {
    if (!commentId) throw new Error('"Comment ID" is required')

    await this.#apiRequest({
      logTag: 'deleteComment',
      method: 'delete',
      url: `${ API_BASE_URL }/comments`,
      query: { id: commentId },
    })

    return { success: true, commentId }
  }

  /**
   * @description Sets the moderation status for one or more comments. Channel owners only.
   *
   * @route POST /set-comment-moderation-status
   * @operationName Set Comment Moderation Status
   * @category Comments & Moderation
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.force-ssl
   *
   * @paramDef {"type":"String","label":"Comment IDs","name":"commentIds","required":true,"description":"One or more comment IDs. Accepts a single ID, comma-separated list, or array of strings."}
   * @paramDef {"type":"String","label":"Moderation Status","name":"moderationStatus","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["heldForReview","published","rejected"]}},"description":"New moderation status."}
   * @paramDef {"type":"Boolean","label":"Ban Author","name":"banAuthor","uiComponent":{"type":"TOGGLE"},"description":"Hide all future comments from the author. Only valid with status=rejected."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"commentIds":"abc,def","moderationStatus":"rejected"}
   */
  async setCommentModerationStatus(commentIds, moderationStatus, banAuthor) {
    if (!commentIds) throw new Error('"Comment IDs" is required')
    if (!moderationStatus) throw new Error('"Moderation Status" is required')

    const ids = Array.isArray(commentIds) ? commentIds.join(',') : commentIds

    await this.#apiRequest({
      logTag: 'setCommentModerationStatus',
      method: 'post',
      url: `${ API_BASE_URL }/comments/setModerationStatus`,
      query: cleanupObject({
        id: ids, moderationStatus,
        banAuthor: banAuthor === true ? 'true' : undefined,
      }),
    })

    return { success: true, commentIds: ids, moderationStatus }
  }

  /**
   * @description Marks one or more comments as spam.
   *
   * @route POST /mark-comments-as-spam
   * @operationName Mark Comments as Spam
   * @category Comments & Moderation
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.force-ssl
   *
   * @paramDef {"type":"String","label":"Comment IDs","name":"commentIds","required":true,"description":"One or more comment IDs. Accepts a single ID, comma-separated list, or array of strings."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"commentIds":"abc,def"}
   */
  async markCommentsAsSpam(commentIds) {
    if (!commentIds) throw new Error('"Comment IDs" is required')

    const ids = Array.isArray(commentIds) ? commentIds.join(',') : commentIds

    await this.#apiRequest({
      logTag: 'markCommentsAsSpam',
      method: 'post',
      url: `${ API_BASE_URL }/comments/markAsSpam`,
      query: { id: ids },
    })

    return { success: true, commentIds: ids }
  }

  // =============================== 13 CAPTIONS ===============================

  /**
   * @description Lists caption tracks for a video.
   *
   * @route POST /list-captions
   * @operationName List Captions
   * @category Captions
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.force-ssl
   *
   * @paramDef {"type":"String","label":"Video ID","name":"videoId","description":"Video whose captions to list.","required":true,"dictionary":"listMyVideosDictionary"}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"cap_abc","snippet":{"language":"en","name":"English","trackKind":"standard","status":"serving"}}]}
   */
  async listCaptions(videoId) {
    if (!videoId) throw new Error('"Video ID" is required')

    return await this.#apiRequest({
      logTag: 'listCaptions',
      url: `${ API_BASE_URL }/captions`,
      query: { part: 'snippet', videoId },
    })
  }

  /**
   * @description Downloads a caption track. Returns text content. Quota cost: 200 units.
   *
   * @route POST /download-caption
   * @operationName Download Caption
   * @category Captions
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes youtube.force-ssl
   *
   * @paramDef {"type":"String","label":"Caption ID","name":"captionId","required":true,"description":"Caption track ID (from List Captions)."}
   * @paramDef {"type":"String","label":"Format","name":"tfmt","uiComponent":{"type":"DROPDOWN","options":{"values":["srt","vtt","sbv","ttml","scc"]}},"description":"Source format YouTube returns. Default 'srt'."}
   * @paramDef {"type":"String","label":"Translate To","name":"tlang","dictionary":"listI18nLanguagesDictionary","description":"Optional BCP-47 target language for auto-translation (e.g., 'es', 'fr')."}
   * @paramDef {"type":"String","label":"Output","name":"outputFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["raw","transcript","cues"]}},"description":"How to return the caption: 'raw' = original text, 'transcript' = stripped plain prose for AI/LLM use, 'cues' = parsed array of {startMs,endMs,text}. Default 'raw'."}
   *
   * @returns {Object}
   * @sampleResult {"captionId":"cap_abc","format":"srt","outputFormat":"transcript","content":"Hello world Welcome to the demo"}
   */
  async downloadCaption(captionId, tfmt, tlang, outputFormat) {
    if (!captionId) throw new Error('"Caption ID" is required')

    const accessToken = this.#getAccessToken()
    const params = new URLSearchParams()

    if (tfmt) params.append('tfmt', tfmt)
    if (tlang) params.append('tlang', tlang)

    const url = `${ API_BASE_URL }/captions/${ encodeURIComponent(captionId) }${ params.toString() ? '?' + params.toString() : '' }`

    const res = await fetch(url, { headers: { Authorization: `Bearer ${ accessToken }` } })

    if (!res.ok) {
      const text = await res.text()

      throw new Error(`Caption download failed: ${ res.status } ${ text }`)
    }

    const raw = await res.text()
    const fmt = (tfmt || 'srt').toLowerCase()
    const out = (outputFormat || 'raw').toLowerCase()

    if (out === 'transcript') {
      const cues = parseCaption(raw, fmt)

      return { captionId, format: fmt, outputFormat: 'transcript', content: toTranscript(cues), cueCount: cues.length }
    }

    if (out === 'cues') {
      const cues = parseCaption(raw, fmt)

      return { captionId, format: fmt, outputFormat: 'cues', cues, cueCount: cues.length }
    }

    return { captionId, format: fmt, outputFormat: 'raw', content: raw }
  }

  /**
   * @description Uploads a caption track for a video.
   *
   * @route POST /upload-caption
   * @operationName Upload Caption
   * @category Captions
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 300
   * @requiredOauth2Scopes youtube.force-ssl
   *
   * @paramDef {"type":"String","label":"Video ID","name":"videoId","description":"Target video.","required":true}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"BCP-47 language code.","required":true,"dictionary":"listI18nLanguagesDictionary"}
   * @paramDef {"type":"String","label":"Track Name","name":"name","description":"Display name for the track.","required":true}
   * @paramDef {"type":"String","label":"Caption File","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"Pick a caption file (SRT, VTT, SBV, TTML, SCC) from Flowrunner files, or paste a publicly fetchable URL."}
   * @paramDef {"type":"Boolean","label":"Is Draft","name":"isDraft","description":"Whether the track is a draft (unpublished).","uiComponent":{"type":"TOGGLE"}}
   *
   * @returns {Object}
   * @sampleResult {"id":"cap_new","snippet":{"videoId":"abc","language":"en","name":"English","trackKind":"standard"}}
   */
  async uploadCaption(videoId, language, name, fileUrl, isDraft) {
    if (!videoId) throw new Error('"Video ID" is required')
    if (!name) throw new Error('"Track Name" is required')
    if (!fileUrl) throw new Error('"File URL" is required')

    const lang = language || this.defaultLanguage

    if (!lang) throw new Error('"Language" is required (or set Default Language in service config).')

    const fileBytes = await fetchBytes(fileUrl)

    return await resumableUpload({
      initUrl: `${ UPLOAD_BASE_URL }/captions?uploadType=resumable&part=snippet`,
      accessToken: this.#getAccessToken(),
      metadata: {
        snippet: cleanupObject({ videoId, language: lang, name, isDraft: isDraft === true ? true : undefined }),
      },
      fileBytes,
      fileContentType: '*/*',
    })
  }

  /**
   * @description Deletes a caption track.
   *
   * @route POST /delete-caption
   * @operationName Delete Caption
   * @category Captions
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.force-ssl
   *
   * @paramDef {"type":"String","label":"Caption ID","name":"captionId","description":"Caption track ID.","required":true}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"captionId":"cap_abc"}
   */
  async deleteCaption(captionId) {
    if (!captionId) throw new Error('"Caption ID" is required')

    await this.#apiRequest({
      logTag: 'deleteCaption',
      method: 'delete',
      url: `${ API_BASE_URL }/captions`,
      query: { id: captionId },
    })

    return { success: true, captionId }
  }

  // =============================== 14 ACTIVITIES ===============================

  /**
   * @description Lists recent activities for a channel (uploads, likes, etc.).
   *
   * @route POST /list-activities
   * @operationName List Activities
   * @category Channel
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.readonly
   *
   * @paramDef {"type":"String","label":"Channel ID","name":"channelId","description":"Channel whose activities to list. Mutually exclusive with Mine."}
   * @paramDef {"type":"Boolean","label":"Mine","name":"mine","description":"List authenticated user's activities.","uiComponent":{"type":"TOGGLE"}}
   * @paramDef {"type":"String","label":"Published After","name":"publishedAfter","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Lower-bound timestamp (RFC 3339, e.g., 2025-01-20T00:00:00Z)."}
   * @paramDef {"type":"String","label":"Published Before","name":"publishedBefore","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Upper-bound timestamp (RFC 3339, e.g., 2025-12-31T23:59:59Z)."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","description":"1-50, default 25.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"act_abc","snippet":{"type":"upload","title":"New video","channelId":"UCabc"},"contentDetails":{"upload":{"videoId":"vid123"}}}],"nextPageToken":"..."}
   */
  async listActivities(channelId, mine, publishedAfter, publishedBefore, maxResults, pageToken) {
    if (!channelId && !mine) throw new Error('Either "Channel ID" or "Mine" must be set.')

    return await this.#apiRequest({
      logTag: 'listActivities',
      url: `${ API_BASE_URL }/activities`,
      query: cleanupObject({
        part: 'snippet,contentDetails',
        channelId, mine: mine ? 'true' : undefined,
        publishedAfter, publishedBefore,
        maxResults: clampInt(maxResults, 1, 50, 25), pageToken,
      }),
    })
  }

  // =============================== 15 ANALYTICS ===============================

  /**
   * @description Run a custom YouTube Analytics query with full control over metrics, dimensions, filters, and sort. Use when the canned reports (Channel Overview, Top Videos, etc.) don't cover your use case. Defaults to the authenticated channel.
   *
   * @route POST /run-analytics-query
   * @operationName Run Analytics Query
   * @category Analytics
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes yt-analytics.readonly
   *
   * @paramDef {"type":"String","label":"IDs","name":"ids","description":"Identifies the YouTube channel/content owner. Default: 'channel==MINE'."}
   * @paramDef {"type":"String","label":"Period","name":"period","uiComponent":{"type":"DROPDOWN","options":{"values":["last7Days","last14Days","last28Days","last30Days","last90Days","last365Days","thisMonth","lastMonth","thisYear","lastYear","yearToDate","custom"]}},"description":"Pick a relative date range. Set to 'custom' (or leave empty) to use the explicit Start/End Date below."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","uiComponent":{"type":"DATE_PICKER"},"description":"YYYY-MM-DD lower bound (inclusive). Required when Period is empty or 'custom'."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","uiComponent":{"type":"DATE_PICKER"},"description":"YYYY-MM-DD upper bound (inclusive). Required when Period is empty or 'custom'."}
   * @paramDef {"type":"String","label":"Metrics","name":"metrics","description":"Comma-separated metric list (e.g., 'views,estimatedMinutesWatched').","required":true,"dictionary":"listAnalyticsMetricsDictionary"}
   * @paramDef {"type":"String","label":"Dimensions","name":"dimensions","description":"Optional comma-separated dimensions (e.g., 'day' or 'video,country').","dictionary":"listAnalyticsDimensionsDictionary"}
   * @paramDef {"type":"String","label":"Filters","name":"filters","description":"Filter string (e.g., 'video==abc123;country==US')."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","description":"Sort spec (prefix '-' for descending, e.g., '-views')."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","description":"Maximum rows to return.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"String","label":"Currency","name":"currency","description":"ISO 4217 currency code for revenue metrics."}
   * @paramDef {"type":"Boolean","label":"Flatten","name":"flatten","uiComponent":{"type":"TOGGLE"},"description":"Convert the columnar response into an array of objects keyed by column name. AI-friendly."}
   *
   * @sampleResultLoader { "methodName":"runAnalyticsQuery_SampleResultLoader", "dependsOn":["metrics","dimensions","flatten"] }
   * @returns {Object}
   * @sampleResult {"columnHeaders":[{"name":"day","columnType":"DIMENSION","dataType":"STRING"},{"name":"views","columnType":"METRIC","dataType":"INTEGER"}],"rows":[["2025-01-01",1234],["2025-01-02",1500]]}
   */
  async runAnalyticsQuery(ids, period, startDate, endDate, metrics, dimensions, filters, sort, maxResults, currency, flatten) {
    ;({ startDate, endDate } = pickDateRange({ period, startDate, endDate }))
    if (!metrics) throw new Error('"Metrics" is required')

    const result = await this.#apiRequest({
      logTag: 'runAnalyticsQuery',
      url: `${ ANALYTICS_API_BASE_URL }/reports`,
      query: buildAnalyticsQuery({ ids, startDate, endDate, metrics, dimensions, filters, sort, maxResults, currency }),
    })

    return flatten ? flattenReport(result) : result
  }

  /**
   * @description Returns headline channel metrics for a date range (views, watch time, subs gained, likes, comments, shares). Optionally includes revenue if monetary scope is enabled.
   *
   * @route POST /get-channel-overview
   * @operationName Get Channel Overview
   * @category Analytics
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes yt-analytics.readonly
   *
   * @paramDef {"type":"String","label":"Period","name":"period","uiComponent":{"type":"DROPDOWN","options":{"values":["last7Days","last14Days","last28Days","last30Days","last90Days","last365Days","thisMonth","lastMonth","thisYear","lastYear","yearToDate","custom"]}},"description":"Pick a relative date range. Set to 'custom' (or leave empty) to use the explicit Start/End Date below."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","uiComponent":{"type":"DATE_PICKER"},"description":"YYYY-MM-DD lower bound (inclusive). Required when Period is empty or 'custom'."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","uiComponent":{"type":"DATE_PICKER"},"description":"YYYY-MM-DD upper bound (inclusive). Required when Period is empty or 'custom'."}
   * @paramDef {"type":"Boolean","label":"Include Revenue","name":"includeRevenue","description":"Append revenue metrics. Requires monetary scope (config item).","uiComponent":{"type":"TOGGLE"}}
   *
   * @returns {Object}
   * @sampleResult {"columnHeaders":[{"name":"views"},{"name":"estimatedMinutesWatched"}],"rows":[[12345,67890]]}
   */
  async getChannelOverview(period, startDate, endDate, includeRevenue) {
    ;({ startDate, endDate } = pickDateRange({ period, startDate, endDate }))

    const metrics = includeRevenue && this.enableMonetary
      ? [...METRIC_PRESETS.overview, ...METRIC_PRESETS.revenue]
      : METRIC_PRESETS.overview

    return await this.#apiRequest({
      logTag: 'getChannelOverview',
      url: `${ ANALYTICS_API_BASE_URL }/reports`,
      query: buildAnalyticsQuery({ ids: 'channel==MINE', startDate, endDate, metrics }),
    })
  }

  /**
   * @description Returns daily time-series for a channel across requested metrics.
   *
   * @route POST /get-channel-time-series
   * @operationName Get Channel Time Series
   * @category Analytics
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes yt-analytics.readonly
   *
   * @paramDef {"type":"String","label":"Period","name":"period","uiComponent":{"type":"DROPDOWN","options":{"values":["last7Days","last14Days","last28Days","last30Days","last90Days","last365Days","thisMonth","lastMonth","thisYear","lastYear","yearToDate","custom"]}},"description":"Pick a relative date range. Set to 'custom' (or leave empty) to use the explicit Start/End Date below."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","uiComponent":{"type":"DATE_PICKER"},"description":"YYYY-MM-DD lower bound (inclusive). Required when Period is empty or 'custom'."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","uiComponent":{"type":"DATE_PICKER"},"description":"YYYY-MM-DD upper bound (inclusive). Required when Period is empty or 'custom'."}
   * @paramDef {"type":"String","label":"Metrics","name":"metrics","dictionary":"listAnalyticsMetricsDictionary","description":"Comma-separated metrics. Default: views,estimatedMinutesWatched."}
   * @paramDef {"type":"Boolean","label":"Flatten","name":"flatten","uiComponent":{"type":"TOGGLE"},"description":"Return an array of {day, ...metrics} objects instead of columnar shape."}
   *
   * @returns {Object}
   * @sampleResult {"columnHeaders":[{"name":"day"},{"name":"views"}],"rows":[["2025-01-01",100],["2025-01-02",150]]}
   */
  async getChannelTimeSeries(period, startDate, endDate, metrics, flatten) {
    ;({ startDate, endDate } = pickDateRange({ period, startDate, endDate }))

    const result = await this.#apiRequest({
      logTag: 'getChannelTimeSeries',
      url: `${ ANALYTICS_API_BASE_URL }/reports`,
      query: buildAnalyticsQuery({
        ids: 'channel==MINE', startDate, endDate,
        metrics: metrics || 'views,estimatedMinutesWatched',
        dimensions: 'day',
        sort: 'day',
      }),
    })

    return flatten ? flattenReport(result) : result
  }

  /**
   * @description Returns top videos for a channel ranked by a metric (default: views).
   *
   * @route POST /get-top-videos
   * @operationName Get Top Videos
   * @category Analytics
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes yt-analytics.readonly
   *
   * @paramDef {"type":"String","label":"Period","name":"period","uiComponent":{"type":"DROPDOWN","options":{"values":["last7Days","last14Days","last28Days","last30Days","last90Days","last365Days","thisMonth","lastMonth","thisYear","lastYear","yearToDate","custom"]}},"description":"Pick a relative date range. Set to 'custom' (or leave empty) to use the explicit Start/End Date below."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","uiComponent":{"type":"DATE_PICKER"},"description":"YYYY-MM-DD lower bound (inclusive). Required when Period is empty or 'custom'."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","uiComponent":{"type":"DATE_PICKER"},"description":"YYYY-MM-DD upper bound (inclusive). Required when Period is empty or 'custom'."}
   * @paramDef {"type":"String","label":"Sort Metric","name":"sortMetric","description":"Metric to sort by (default: views).","dictionary":"listAnalyticsMetricsDictionary"}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of top videos (1-200). Default 10."}
   * @paramDef {"type":"Boolean","label":"Flatten","name":"flatten","uiComponent":{"type":"TOGGLE"},"description":"Return an array of {video, views, ...} objects instead of columnar shape."}
   *
   * @returns {Object}
   * @sampleResult {"columnHeaders":[{"name":"video"},{"name":"views"},{"name":"estimatedMinutesWatched"}],"rows":[["abc123",10000,50000]]}
   */
  async getTopVideos(period, startDate, endDate, sortMetric, maxResults, flatten) {
    ;({ startDate, endDate } = pickDateRange({ period, startDate, endDate }))

    const metric = sortMetric || 'views'

    const result = await this.#apiRequest({
      logTag: 'getTopVideos',
      url: `${ ANALYTICS_API_BASE_URL }/reports`,
      query: buildAnalyticsQuery({
        ids: 'channel==MINE', startDate, endDate,
        metrics: `${ metric },estimatedMinutesWatched,averageViewDuration,likes,comments`,
        dimensions: 'video',
        sort: `-${ metric }`,
        maxResults: clampInt(maxResults, 1, 200, 10),
      }),
    })

    return flatten ? flattenReport(result) : result
  }

  /**
   * @description Returns analytics for one or more specific videos.
   *
   * @route POST /get-video-analytics
   * @operationName Get Video Analytics
   * @category Analytics
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes yt-analytics.readonly
   *
   * @paramDef {"type":"String","label":"Video IDs","name":"videoIds","description":"Comma-separated video IDs.","required":true}
   * @paramDef {"type":"String","label":"Period","name":"period","uiComponent":{"type":"DROPDOWN","options":{"values":["last7Days","last14Days","last28Days","last30Days","last90Days","last365Days","thisMonth","lastMonth","thisYear","lastYear","yearToDate","custom"]}},"description":"Pick a relative date range. Set to 'custom' (or leave empty) to use the explicit Start/End Date below."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","uiComponent":{"type":"DATE_PICKER"},"description":"YYYY-MM-DD lower bound (inclusive). Required when Period is empty or 'custom'."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","uiComponent":{"type":"DATE_PICKER"},"description":"YYYY-MM-DD upper bound (inclusive). Required when Period is empty or 'custom'."}
   * @paramDef {"type":"String","label":"Metrics","name":"metrics","description":"Comma-separated metrics. Default: overview preset.","dictionary":"listAnalyticsMetricsDictionary"}
   * @paramDef {"type":"String","label":"Dimensions","name":"dimensions","dictionary":"listAnalyticsDimensionsDictionary","description":"Optional dimensions (e.g., 'day')."}
   * @paramDef {"type":"Boolean","label":"Flatten","name":"flatten","uiComponent":{"type":"TOGGLE"},"description":"Convert columnar response to array of objects."}
   *
   * @returns {Object}
   * @sampleResult {"columnHeaders":[{"name":"views"}],"rows":[[1234]]}
   */
  async getVideoAnalytics(videoIds, period, startDate, endDate, metrics, dimensions, flatten) {
    if (!videoIds) throw new Error('"Video IDs" is required')
    ;({ startDate, endDate } = pickDateRange({ period, startDate, endDate }))

    const result = await this.#apiRequest({
      logTag: 'getVideoAnalytics',
      url: `${ ANALYTICS_API_BASE_URL }/reports`,
      query: buildAnalyticsQuery({
        ids: 'channel==MINE', startDate, endDate,
        metrics: metrics || METRIC_PRESETS.overview.join(','),
        dimensions,
        filters: buildVideoFilter(videoIds),
      }),
    })

    return flatten ? flattenReport(result) : result
  }

  /**
   * @description Returns audience demographics breakdown by age group and gender.
   *
   * @route POST /get-demographics-report
   * @operationName Get Demographics Report
   * @category Analytics
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes yt-analytics.readonly
   *
   * @paramDef {"type":"String","label":"Period","name":"period","uiComponent":{"type":"DROPDOWN","options":{"values":["last7Days","last14Days","last28Days","last30Days","last90Days","last365Days","thisMonth","lastMonth","thisYear","lastYear","yearToDate","custom"]}},"description":"Pick a relative date range. Set to 'custom' (or leave empty) to use the explicit Start/End Date below."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","uiComponent":{"type":"DATE_PICKER"},"description":"YYYY-MM-DD lower bound (inclusive). Required when Period is empty or 'custom'."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","uiComponent":{"type":"DATE_PICKER"},"description":"YYYY-MM-DD upper bound (inclusive). Required when Period is empty or 'custom'."}
   * @paramDef {"type":"Boolean","label":"Flatten","name":"flatten","uiComponent":{"type":"TOGGLE"},"description":"Convert columnar response to array of {ageGroup, gender, viewerPercentage} objects."}
   *
   * @returns {Object}
   * @sampleResult {"columnHeaders":[{"name":"ageGroup"},{"name":"gender"},{"name":"viewerPercentage"}],"rows":[["age25-34","male",18.5]]}
   */
  async getDemographicsReport(period, startDate, endDate, flatten) {
    ;({ startDate, endDate } = pickDateRange({ period, startDate, endDate }))

    const result = await this.#apiRequest({
      logTag: 'getDemographicsReport',
      url: `${ ANALYTICS_API_BASE_URL }/reports`,
      query: buildAnalyticsQuery({
        ids: 'channel==MINE', startDate, endDate,
        metrics: 'viewerPercentage',
        dimensions: 'ageGroup,gender',
        sort: 'gender,ageGroup',
      }),
    })

    return flatten ? flattenReport(result) : result
  }

  /**
   * @description Returns traffic source breakdown for the channel (where viewers come from).
   *
   * @route POST /get-traffic-source-report
   * @operationName Get Traffic Source Report
   * @category Analytics
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes yt-analytics.readonly
   *
   * @paramDef {"type":"String","label":"Period","name":"period","uiComponent":{"type":"DROPDOWN","options":{"values":["last7Days","last14Days","last28Days","last30Days","last90Days","last365Days","thisMonth","lastMonth","thisYear","lastYear","yearToDate","custom"]}},"description":"Pick a relative date range. Set to 'custom' (or leave empty) to use the explicit Start/End Date below."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","uiComponent":{"type":"DATE_PICKER"},"description":"YYYY-MM-DD lower bound (inclusive). Required when Period is empty or 'custom'."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","uiComponent":{"type":"DATE_PICKER"},"description":"YYYY-MM-DD upper bound (inclusive). Required when Period is empty or 'custom'."}
   * @paramDef {"type":"Boolean","label":"Flatten","name":"flatten","uiComponent":{"type":"TOGGLE"},"description":"Convert columnar response to array of {insightTrafficSourceType, views, estimatedMinutesWatched} objects."}
   *
   * @returns {Object}
   * @sampleResult {"columnHeaders":[{"name":"insightTrafficSourceType"},{"name":"views"}],"rows":[["YT_SEARCH",5000],["EXT_URL",1200]]}
   */
  async getTrafficSourceReport(period, startDate, endDate, flatten) {
    ;({ startDate, endDate } = pickDateRange({ period, startDate, endDate }))

    const result = await this.#apiRequest({
      logTag: 'getTrafficSourceReport',
      url: `${ ANALYTICS_API_BASE_URL }/reports`,
      query: buildAnalyticsQuery({
        ids: 'channel==MINE', startDate, endDate,
        metrics: 'views,estimatedMinutesWatched',
        dimensions: 'insightTrafficSourceType',
        sort: '-views',
      }),
    })

    return flatten ? flattenReport(result) : result
  }

  /**
   * @description Returns viewership breakdown by device type and operating system.
   *
   * @route POST /get-device-report
   * @operationName Get Device Report
   * @category Analytics
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes yt-analytics.readonly
   *
   * @paramDef {"type":"String","label":"Period","name":"period","uiComponent":{"type":"DROPDOWN","options":{"values":["last7Days","last14Days","last28Days","last30Days","last90Days","last365Days","thisMonth","lastMonth","thisYear","lastYear","yearToDate","custom"]}},"description":"Pick a relative date range. Set to 'custom' (or leave empty) to use the explicit Start/End Date below."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","uiComponent":{"type":"DATE_PICKER"},"description":"YYYY-MM-DD lower bound (inclusive). Required when Period is empty or 'custom'."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","uiComponent":{"type":"DATE_PICKER"},"description":"YYYY-MM-DD upper bound (inclusive). Required when Period is empty or 'custom'."}
   * @paramDef {"type":"Boolean","label":"Flatten","name":"flatten","uiComponent":{"type":"TOGGLE"},"description":"Convert columnar response to array of {deviceType, operatingSystem, views, ...} objects."}
   *
   * @returns {Object}
   * @sampleResult {"columnHeaders":[{"name":"deviceType"},{"name":"views"}],"rows":[["MOBILE",6000],["DESKTOP",3000]]}
   */
  async getDeviceReport(period, startDate, endDate, flatten) {
    ;({ startDate, endDate } = pickDateRange({ period, startDate, endDate }))

    const result = await this.#apiRequest({
      logTag: 'getDeviceReport',
      url: `${ ANALYTICS_API_BASE_URL }/reports`,
      query: buildAnalyticsQuery({
        ids: 'channel==MINE', startDate, endDate,
        metrics: 'views,estimatedMinutesWatched',
        dimensions: 'deviceType,operatingSystem',
        sort: '-views',
      }),
    })

    return flatten ? flattenReport(result) : result
  }

  /**
   * @description Returns country-level breakdown for the channel.
   *
   * @route POST /get-geography-report
   * @operationName Get Geography Report
   * @category Analytics
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes yt-analytics.readonly
   *
   * @paramDef {"type":"String","label":"Period","name":"period","uiComponent":{"type":"DROPDOWN","options":{"values":["last7Days","last14Days","last28Days","last30Days","last90Days","last365Days","thisMonth","lastMonth","thisYear","lastYear","yearToDate","custom"]}},"description":"Pick a relative date range. Set to 'custom' (or leave empty) to use the explicit Start/End Date below."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","uiComponent":{"type":"DATE_PICKER"},"description":"YYYY-MM-DD lower bound (inclusive). Required when Period is empty or 'custom'."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","uiComponent":{"type":"DATE_PICKER"},"description":"YYYY-MM-DD upper bound (inclusive). Required when Period is empty or 'custom'."}
   * @paramDef {"type":"String","label":"Sort Metric","name":"sortMetric","description":"Metric to sort by (default views).","dictionary":"listAnalyticsMetricsDictionary"}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Top N countries."}
   * @paramDef {"type":"Boolean","label":"Flatten","name":"flatten","uiComponent":{"type":"TOGGLE"},"description":"Convert columnar response to array of {country, views, ...} objects."}
   *
   * @returns {Object}
   * @sampleResult {"columnHeaders":[{"name":"country"},{"name":"views"}],"rows":[["US",4500],["GB",1200]]}
   */
  async getGeographyReport(period, startDate, endDate, sortMetric, maxResults, flatten) {
    ;({ startDate, endDate } = pickDateRange({ period, startDate, endDate }))

    const metric = sortMetric || 'views'

    const result = await this.#apiRequest({
      logTag: 'getGeographyReport',
      url: `${ ANALYTICS_API_BASE_URL }/reports`,
      query: buildAnalyticsQuery({
        ids: 'channel==MINE', startDate, endDate,
        metrics: `${ metric },estimatedMinutesWatched`,
        dimensions: 'country',
        sort: `-${ metric }`,
        maxResults: clampInt(maxResults, 1, 250, 25),
      }),
    })

    return flatten ? flattenReport(result) : result
  }

  /**
   * @description Lists analytics groups owned by the authenticated user. Groups are custom collections of videos/playlists/channels for analytics aggregation.
   *
   * @route POST /list-analytics-groups
   * @operationName List Analytics Groups
   * @category Analytics
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes yt-analytics.readonly
   *
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","description":"Items per page.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"groupId123","snippet":{"title":"Top Tutorials"},"contentDetails":{"itemCount":"5","itemType":"youtube#video"}}]}
   */
  async listAnalyticsGroups(maxResults, pageToken) {
    return await this.#apiRequest({
      logTag: 'listAnalyticsGroups',
      url: `${ ANALYTICS_API_BASE_URL }/groups`,
      query: { mine: 'true', maxResults: clampInt(maxResults, 1, 200, 100), pageToken },
    })
  }

  /**
   * @description Creates a new analytics group.
   *
   * @route POST /create-analytics-group
   * @operationName Create Analytics Group
   * @category Analytics
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube
   *
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Group display title.","required":true}
   * @paramDef {"type":"String","label":"Item Type","name":"itemType","description":"Resource type contained in the group.","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["youtube#video","youtube#channel","youtube#playlist","youtubePartner#asset"]}}}
   *
   * @returns {Object}
   * @sampleResult {"id":"groupId123","snippet":{"title":"Top Tutorials"},"contentDetails":{"itemType":"youtube#video"}}
   */
  async createAnalyticsGroup(title, itemType) {
    if (!title) throw new Error('"Title" is required')
    if (!itemType) throw new Error('"Item Type" is required')

    return await this.#apiRequest({
      logTag: 'createAnalyticsGroup',
      method: 'post',
      url: `${ ANALYTICS_API_BASE_URL }/groups`,
      body: {
        snippet: { title },
        contentDetails: { itemType },
      },
    })
  }

  /**
   * @description Deletes an analytics group.
   *
   * @route POST /delete-analytics-group
   * @operationName Delete Analytics Group
   * @category Analytics
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube
   *
   * @paramDef {"type":"String","label":"Group ID","name":"groupId","description":"Analytics group to delete.","required":true,"dictionary":"listAnalyticsGroupsDictionary"}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"groupId":"groupId123"}
   */
  async deleteAnalyticsGroup(groupId) {
    if (!groupId) throw new Error('"Group ID" is required')

    await this.#apiRequest({
      logTag: 'deleteAnalyticsGroup',
      method: 'delete',
      url: `${ ANALYTICS_API_BASE_URL }/groups`,
      query: { id: groupId },
    })

    return { success: true, groupId }
  }

  /**
   * @description Lists items inside an analytics group.
   *
   * @route POST /list-analytics-group-items
   * @operationName List Analytics Group Items
   * @category Analytics
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes yt-analytics.readonly
   *
   * @paramDef {"type":"String","label":"Group ID","name":"groupId","description":"Analytics group.","required":true,"dictionary":"listAnalyticsGroupsDictionary"}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"itemId","resource":{"kind":"youtube#video","id":"abc123"}}]}
   */
  async listAnalyticsGroupItems(groupId) {
    if (!groupId) throw new Error('"Group ID" is required')

    return await this.#apiRequest({
      logTag: 'listAnalyticsGroupItems',
      url: `${ ANALYTICS_API_BASE_URL }/groupItems`,
      query: { groupId },
    })
  }

  // =============================== 15.5 REPORTING ===============================

  /**
   * @typedef {Object} listReportTypesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter the list by report type id or name (case-insensitive substring)."}
   * @paramDef {"type":"Boolean","label":"Include System-Managed","name":"includeSystemManaged","uiComponent":{"type":"TOGGLE"},"description":"Include system-managed report types (only available to content owners)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Report Types
   * @category Reporting
   * @description Pick from the report types YouTube can generate. Use to populate the Report Type ID field on Create Reporting Job.
   *
   * @route POST /list-report-types-dictionary
   *
   * @paramDef {"type":"listReportTypesDictionary__payload","label":"Payload","name":"payload","description":"Optional search and pagination."}
   *
   * @sampleResult {"items":[{"label":"Channel basic A1 daily","note":"channel_basic_a1","value":"channel_basic_a1"}]}
   * @returns {DictionaryResponse}
   */
  async listReportTypesDictionary({ search, includeSystemManaged, cursor } = {}) {
    const response = await this.#apiRequest({
      logTag: 'listReportTypesDictionary',
      url: `${ REPORTING_API_BASE_URL }/reportTypes`,
      query: cleanupObject({
        includeSystemManaged: includeSystemManaged ? 'true' : undefined,
        pageToken: cursor,
      }),
    })

    const items = response.reportTypes || []
    const filtered = search ? searchFilter(items, ['id', 'name'], search) : items

    return {
      cursor: response.nextPageToken || null,
      items: filtered.map(rt => ({
        label: rt.name || rt.id,
        note: rt.deprecateTime ? `Deprecates ${ rt.deprecateTime.slice(0, 10) }` : rt.id,
        value: rt.id,
      })),
    }
  }

  /**
   * @typedef {Object} listReportingJobsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter by job name."}
   * @paramDef {"type":"Boolean","label":"Include System-Managed","name":"includeSystemManaged","uiComponent":{"type":"TOGGLE"},"description":"Include system-managed jobs (content owners only)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Reporting Jobs
   * @category Reporting
   * @description Pick from your scheduled reporting jobs. Use to populate Job ID fields on List Reports, Get Report, or Delete Reporting Job.
   *
   * @route POST /list-reporting-jobs-dictionary
   *
   * @paramDef {"type":"listReportingJobsDictionary__payload","label":"Payload","name":"payload","description":"Optional search and pagination."}
   *
   * @sampleResult {"items":[{"label":"My Channel Daily","note":"channel_basic_a1","value":"job_abc"}]}
   * @returns {DictionaryResponse}
   */
  async listReportingJobsDictionary({ search, includeSystemManaged, cursor } = {}) {
    const response = await this.#apiRequest({
      logTag: 'listReportingJobsDictionary',
      url: `${ REPORTING_API_BASE_URL }/jobs`,
      query: cleanupObject({
        includeSystemManaged: includeSystemManaged ? 'true' : undefined,
        pageToken: cursor,
      }),
    })

    const items = response.jobs || []
    const filtered = search ? searchFilter(items, ['name', 'reportTypeId'], search) : items

    return {
      cursor: response.nextPageToken || null,
      items: filtered.map(job => ({
        label: job.name || job.id,
        note: job.reportTypeId || `Job ID: ${ job.id }`,
        value: job.id,
      })),
    }
  }

  /**
   * @description List the report types YouTube can generate as bulk daily CSVs. Use to discover which scheduled reports you can subscribe to.
   *
   * @route POST /list-report-types
   * @operationName List Report Types
   * @category Reporting
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes yt-analytics.readonly
   *
   * @paramDef {"type":"Boolean","label":"Include System-Managed","name":"includeSystemManaged","uiComponent":{"type":"TOGGLE"},"description":"Include system-managed report types (content owners only)."}
   * @paramDef {"type":"String","label":"On Behalf Of Content Owner","name":"onBehalfOfContentOwner","description":"Partner CMS content-owner ID. Leave blank for regular channels."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Items per page (default 50)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token."}
   * @paramDef {"type":"Boolean","label":"Fetch All","name":"fetchAll","uiComponent":{"type":"TOGGLE"},"description":"Auto-paginate the full list. Caps at Max Pages."}
   * @paramDef {"type":"Number","label":"Max Pages","name":"maxPages","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Safety cap for Fetch All (default 10)."}
   *
   * @returns {Object}
   * @sampleResult {"reportTypes":[{"id":"channel_basic_a1","name":"Channel basic"},{"id":"channel_demographics_a1","name":"Channel demographics"}]}
   */
  async listReportTypes(includeSystemManaged, onBehalfOfContentOwner, maxResults, pageToken, fetchAll, maxPages) {
    const baseQuery = cleanupObject({
      includeSystemManaged: includeSystemManaged ? 'true' : undefined,
      onBehalfOfContentOwner,
      pageSize: clampInt(maxResults, 1, 100, 50),
    })

    const fetchPage = async pt => {
      const resp = await this.#apiRequest({
        logTag: 'listReportTypes',
        url: `${ REPORTING_API_BASE_URL }/reportTypes`,
        query: { ...baseQuery, pageToken: pt },
      })

      return { items: resp.reportTypes || [], nextPageToken: resp.nextPageToken }
    }

    if (fetchAll) {
      const all = await paginateAll(fetchPage, clampInt(maxPages, 1, 50, DEFAULT_MAX_PAGES))

      return { reportTypes: all.items, pages: all.pages, truncated: all.truncated, nextPageToken: all.nextPageToken }
    }

    const page = await fetchPage(pageToken)

    return { reportTypes: page.items, nextPageToken: page.nextPageToken || null }
  }

  /**
   * @description List the reporting jobs you've already scheduled. Each job generates a daily CSV for one report type.
   *
   * @route POST /list-reporting-jobs
   * @operationName List Reporting Jobs
   * @category Reporting
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes yt-analytics.readonly
   *
   * @paramDef {"type":"Boolean","label":"Include System-Managed","name":"includeSystemManaged","uiComponent":{"type":"TOGGLE"},"description":"Include system-managed jobs (content owners only)."}
   * @paramDef {"type":"String","label":"On Behalf Of Content Owner","name":"onBehalfOfContentOwner","description":"Partner CMS content-owner ID."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Items per page (default 50)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token."}
   * @paramDef {"type":"Boolean","label":"Fetch All","name":"fetchAll","uiComponent":{"type":"TOGGLE"},"description":"Auto-paginate. Caps at Max Pages."}
   * @paramDef {"type":"Number","label":"Max Pages","name":"maxPages","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Safety cap (default 10)."}
   *
   * @returns {Object}
   * @sampleResult {"jobs":[{"id":"job_abc","reportTypeId":"channel_basic_a1","name":"My Channel Daily","createTime":"2025-01-01T00:00:00Z"}]}
   */
  async listReportingJobs(includeSystemManaged, onBehalfOfContentOwner, maxResults, pageToken, fetchAll, maxPages) {
    const baseQuery = cleanupObject({
      includeSystemManaged: includeSystemManaged ? 'true' : undefined,
      onBehalfOfContentOwner,
      pageSize: clampInt(maxResults, 1, 100, 50),
    })

    const fetchPage = async pt => {
      const resp = await this.#apiRequest({
        logTag: 'listReportingJobs',
        url: `${ REPORTING_API_BASE_URL }/jobs`,
        query: { ...baseQuery, pageToken: pt },
      })

      return { items: resp.jobs || [], nextPageToken: resp.nextPageToken }
    }

    if (fetchAll) {
      const all = await paginateAll(fetchPage, clampInt(maxPages, 1, 50, DEFAULT_MAX_PAGES))

      return { jobs: all.items, pages: all.pages, truncated: all.truncated, nextPageToken: all.nextPageToken }
    }

    const page = await fetchPage(pageToken)

    return { jobs: page.items, nextPageToken: page.nextPageToken || null }
  }

  /**
   * @description Schedule a daily CSV report. Once created, YouTube starts generating reports for the chosen report type every day; download via List Reports + Get Report. Idempotent on (reportTypeId, name).
   *
   * @route POST /create-reporting-job
   * @operationName Create Reporting Job
   * @category Reporting
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes yt-analytics.readonly
   *
   * @paramDef {"type":"String","label":"Report Type","name":"reportTypeId","required":true,"dictionary":"listReportTypesDictionary","description":"The kind of report YouTube should generate daily."}
   * @paramDef {"type":"String","label":"Job Name","name":"name","required":true,"description":"Human-readable label for the job (e.g., 'My Channel Daily Stats')."}
   * @paramDef {"type":"String","label":"On Behalf Of Content Owner","name":"onBehalfOfContentOwner","description":"Partner CMS content-owner ID. Leave blank for regular channels."}
   *
   * @returns {Object}
   * @sampleResult {"id":"job_abc","reportTypeId":"channel_basic_a1","name":"My Channel Daily Stats","createTime":"2025-01-15T00:00:00Z"}
   */
  async createReportingJob(reportTypeId, name, onBehalfOfContentOwner) {
    if (!reportTypeId) throw new Error('"Report Type" is required')
    if (!name) throw new Error('"Job Name" is required')

    return await this.#apiRequest({
      logTag: 'createReportingJob',
      method: 'post',
      url: `${ REPORTING_API_BASE_URL }/jobs`,
      query: cleanupObject({ onBehalfOfContentOwner }),
      body: { reportTypeId, name },
    })
  }

  /**
   * @description Cancel a scheduled reporting job. Already-generated reports remain available for ~60 days.
   *
   * @route POST /delete-reporting-job
   * @operationName Delete Reporting Job
   * @category Reporting
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes yt-analytics.readonly
   *
   * @paramDef {"type":"String","label":"Job","name":"jobId","required":true,"dictionary":"listReportingJobsDictionary","description":"Pick the reporting job to cancel."}
   * @paramDef {"type":"String","label":"On Behalf Of Content Owner","name":"onBehalfOfContentOwner","description":"Partner CMS content-owner ID."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"jobId":"job_abc"}
   */
  async deleteReportingJob(jobId, onBehalfOfContentOwner) {
    if (!jobId) throw new Error('"Job" is required')

    await this.#apiRequest({
      logTag: 'deleteReportingJob',
      method: 'delete',
      url: `${ REPORTING_API_BASE_URL }/jobs/${ encodeURIComponent(jobId) }`,
      query: cleanupObject({ onBehalfOfContentOwner }),
    })

    return { success: true, jobId }
  }

  /**
   * @description List the daily-generated reports available for a job. Each report covers one calendar day.
   *
   * @route POST /list-reports
   * @operationName List Reports
   * @category Reporting
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes yt-analytics.readonly
   *
   * @paramDef {"type":"String","label":"Job","name":"jobId","required":true,"dictionary":"listReportingJobsDictionary","description":"Pick the reporting job."}
   * @paramDef {"type":"String","label":"Created After","name":"createdAfter","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return reports created at or after this RFC 3339 timestamp."}
   * @paramDef {"type":"String","label":"Start Time At Or After","name":"startTimeAtOrAfter","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return reports whose data window starts at or after this timestamp."}
   * @paramDef {"type":"String","label":"Start Time Before","name":"startTimeBefore","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return reports whose data window starts strictly before this timestamp."}
   * @paramDef {"type":"String","label":"On Behalf Of Content Owner","name":"onBehalfOfContentOwner","description":"Partner CMS content-owner ID."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Items per page (default 50)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token."}
   * @paramDef {"type":"Boolean","label":"Fetch All","name":"fetchAll","uiComponent":{"type":"TOGGLE"},"description":"Auto-paginate the full list. Caps at Max Pages."}
   * @paramDef {"type":"Number","label":"Max Pages","name":"maxPages","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Safety cap (default 10)."}
   *
   * @returns {Object}
   * @sampleResult {"reports":[{"id":"report_abc","jobId":"job_abc","startTime":"2025-01-14T00:00:00Z","endTime":"2025-01-15T00:00:00Z","createTime":"2025-01-15T05:00:00Z","downloadUrl":"https://..."}]}
   */
  async listReports(jobId, createdAfter, startTimeAtOrAfter, startTimeBefore, onBehalfOfContentOwner, maxResults, pageToken, fetchAll, maxPages) {
    if (!jobId) throw new Error('"Job" is required')

    const baseQuery = cleanupObject({
      createdAfter, startTimeAtOrAfter, startTimeBefore, onBehalfOfContentOwner,
      pageSize: clampInt(maxResults, 1, 100, 50),
    })

    const fetchPage = async pt => {
      const resp = await this.#apiRequest({
        logTag: 'listReports',
        url: `${ REPORTING_API_BASE_URL }/jobs/${ encodeURIComponent(jobId) }/reports`,
        query: { ...baseQuery, pageToken: pt },
      })

      return { items: resp.reports || [], nextPageToken: resp.nextPageToken }
    }

    if (fetchAll) {
      const all = await paginateAll(fetchPage, clampInt(maxPages, 1, 50, DEFAULT_MAX_PAGES))

      return { reports: all.items, pages: all.pages, truncated: all.truncated, nextPageToken: all.nextPageToken }
    }

    const page = await fetchPage(pageToken)

    return { reports: page.items, nextPageToken: page.nextPageToken || null }
  }

  /**
   * @description Get a single generated report. Choose 'metadata' for the descriptor, 'raw' to download the CSV text, or 'parsed' to download and parse into rows of objects.
   *
   * @route POST /get-report
   * @operationName Get Report
   * @category Reporting
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 300
   * @requiredOauth2Scopes yt-analytics.readonly
   *
   * @paramDef {"type":"String","label":"Job","name":"jobId","required":true,"dictionary":"listReportingJobsDictionary","description":"The reporting job."}
   * @paramDef {"type":"String","label":"Report ID","name":"reportId","required":true,"description":"The report's ID (from List Reports)."}
   * @paramDef {"type":"String","label":"Output","name":"outputFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["metadata","raw","parsed"]}},"description":"What to return: 'metadata' = descriptor (default, no download), 'raw' = CSV text content, 'parsed' = array of objects keyed by column."}
   * @paramDef {"type":"String","label":"On Behalf Of Content Owner","name":"onBehalfOfContentOwner","description":"Partner CMS content-owner ID."}
   *
   * @sampleResultLoader { "methodName":"getReport_SampleResultLoader", "dependsOn":["outputFormat"] }
   * @returns {Object}
   * @sampleResult {"id":"report_abc","jobId":"job_abc","startTime":"2025-01-14T00:00:00Z","endTime":"2025-01-15T00:00:00Z","downloadUrl":"https://..."}
   */
  async getReport(jobId, reportId, outputFormat, onBehalfOfContentOwner) {
    if (!jobId) throw new Error('"Job" is required')
    if (!reportId) throw new Error('"Report ID" is required')

    const meta = await this.#apiRequest({
      logTag: 'getReport',
      url: `${ REPORTING_API_BASE_URL }/jobs/${ encodeURIComponent(jobId) }/reports/${ encodeURIComponent(reportId) }`,
      query: cleanupObject({ onBehalfOfContentOwner }),
    })

    const out = (outputFormat || 'metadata').toLowerCase()

    if (out === 'metadata') return meta

    if (!meta.downloadUrl) {
      throw new Error('Report has no downloadUrl. Cannot fetch contents.')
    }

    const accessToken = this.#getAccessToken()
    const res = await fetch(meta.downloadUrl, { headers: { Authorization: `Bearer ${ accessToken }` } })

    if (!res.ok) {
      const text = await res.text()

      throw new Error(`Report download failed: ${ res.status } ${ text }`)
    }

    const csv = await res.text()

    if (out === 'parsed') {
      return { ...meta, outputFormat: 'parsed', rows: parseCSV(csv) }
    }

    return { ...meta, outputFormat: 'raw', content: csv }
  }

  // =============================== 15.7 LIVE STREAMING ===============================

  /**
   * @typedef {Object} listMyLiveBroadcastsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter by broadcast title (case-insensitive substring)."}
   * @paramDef {"type":"String","label":"Status","name":"broadcastStatus","uiComponent":{"type":"DROPDOWN","options":{"values":["all","upcoming","active","completed"]}},"description":"Filter by lifecycle status. Default 'all'."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get My Live Broadcasts
   * @category Live Streaming
   * @description Pick from your live broadcasts (upcoming, active, or completed). Use to populate Broadcast ID fields.
   *
   * @route POST /list-my-live-broadcasts-dictionary
   *
   * @paramDef {"type":"listMyLiveBroadcastsDictionary__payload","label":"Payload","name":"payload","description":"Optional search and status filter."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"Today's Stream","note":"upcoming","value":"broadcast_abc"}]}
   * @returns {DictionaryResponse}
   */
  async listMyLiveBroadcastsDictionary({ search, broadcastStatus, cursor } = {}) {
    const response = await this.#apiRequest({
      logTag: 'listMyLiveBroadcastsDictionary',
      url: `${ API_BASE_URL }/liveBroadcasts`,
      query: {
        part: 'snippet,status',
        broadcastStatus: broadcastStatus || 'all',
        maxResults: MAX_DICTIONARY_PAGE_SIZE,
        pageToken: cursor,
      },
    })

    const items = response.items || []
    const filtered = search ? searchFilter(items, ['snippet.title'], search) : items

    return {
      cursor: response.nextPageToken || null,
      items: filtered.map(b => ({
        label: b.snippet?.title || b.id,
        note: b.status?.lifeCycleStatus || 'unknown',
        value: b.id,
      })),
    }
  }

  /**
   * @typedef {Object} listMyLiveStreamsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter by stream title."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get My Live Streams
   * @category Live Streaming
   * @description Pick from your ingestion streams (RTMP/HLS endpoints). Use to populate Stream ID fields like Bind Live Broadcast.
   *
   * @route POST /list-my-live-streams-dictionary
   *
   * @paramDef {"type":"listMyLiveStreamsDictionary__payload","label":"Payload","name":"payload","description":"Optional search and pagination."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"Main Stream","note":"720p / rtmp","value":"stream_abc"}]}
   * @returns {DictionaryResponse}
   */
  async listMyLiveStreamsDictionary({ search, cursor } = {}) {
    const response = await this.#apiRequest({
      logTag: 'listMyLiveStreamsDictionary',
      url: `${ API_BASE_URL }/liveStreams`,
      query: { part: 'snippet,cdn,status', mine: 'true', maxResults: MAX_DICTIONARY_PAGE_SIZE, pageToken: cursor },
    })

    const items = response.items || []
    const filtered = search ? searchFilter(items, ['snippet.title'], search) : items

    return {
      cursor: response.nextPageToken || null,
      items: filtered.map(s => ({
        label: s.snippet?.title || s.id,
        note: s.cdn ? `${ s.cdn.resolution || '?' } / ${ s.cdn.ingestionType || 'rtmp' }` : `Status: ${ s.status?.streamStatus || 'unknown' }`,
        value: s.id,
      })),
    }
  }

  /**
   * @description List your live broadcasts filtered by lifecycle status. Returns titles, scheduled times, and live chat IDs.
   *
   * @route POST /list-live-broadcasts
   * @operationName List Live Broadcasts
   * @category Live Streaming
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.force-ssl
   *
   * @paramDef {"type":"String","label":"Status","name":"broadcastStatus","uiComponent":{"type":"DROPDOWN","options":{"values":["all","active","completed","upcoming"]}},"description":"Filter by lifecycle status."}
   * @paramDef {"type":"String","label":"Type","name":"broadcastType","uiComponent":{"type":"DROPDOWN","options":{"values":["all","event","persistent"]}},"description":"Filter by broadcast type. 'persistent' = 24/7 streams."}
   * @paramDef {"type":"String","label":"Broadcast IDs","name":"id","description":"Comma-separated broadcast IDs (mutually exclusive with status/type filters)."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-50, default 25."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"broadcast_abc","snippet":{"title":"Today's Show","scheduledStartTime":"2025-01-15T18:00:00Z","liveChatId":"chat_abc"},"status":{"lifeCycleStatus":"upcoming","privacyStatus":"public"}}]}
   */
  async listLiveBroadcasts(broadcastStatus, broadcastType, id, maxResults, pageToken) {
    const query = { part: 'snippet,status,contentDetails', maxResults: clampInt(maxResults, 1, 50, 25), pageToken }

    if (id) {
      query.id = Array.isArray(id) ? id.join(',') : id
    } else {
      query.broadcastStatus = broadcastStatus || 'all'
      if (broadcastType) query.broadcastType = broadcastType
    }

    return await this.#apiRequest({
      logTag: 'listLiveBroadcasts',
      url: `${ API_BASE_URL }/liveBroadcasts`,
      query,
    })
  }

  /**
   * @description Schedule a new live broadcast. Returns the broadcast resource including the live chat ID.
   *
   * @route POST /create-live-broadcast
   * @operationName Create Live Broadcast
   * @category Live Streaming
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.force-ssl
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Broadcast title (max 100 chars)."}
   * @paramDef {"type":"String","label":"Scheduled Start Time","name":"scheduledStartTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"When the broadcast goes live (ISO 8601, e.g., 2025-12-31T18:00:00Z)."}
   * @paramDef {"type":"Boolean","label":"Made For Kids","name":"madeForKids","required":true,"uiComponent":{"type":"TOGGLE"},"description":"Self-declared made-for-kids flag (REQUIRED by YouTube — even if false)."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Broadcast description (max 5000 chars)."}
   * @paramDef {"type":"String","label":"Scheduled End Time","name":"scheduledEndTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional end time."}
   * @paramDef {"type":"String","label":"Privacy","name":"privacyStatus","uiComponent":{"type":"DROPDOWN","options":{"values":["public","unlisted","private"]}},"description":"Visibility. Default 'private'."}
   * @paramDef {"type":"Boolean","label":"Enable Auto Start","name":"enableAutoStart","uiComponent":{"type":"TOGGLE"},"description":"Auto-transition to live when ingestion starts."}
   * @paramDef {"type":"Boolean","label":"Enable Auto Stop","name":"enableAutoStop","uiComponent":{"type":"TOGGLE"},"description":"Auto-transition to complete when ingestion stops."}
   * @paramDef {"type":"Boolean","label":"Enable DVR","name":"enableDvr","uiComponent":{"type":"TOGGLE"},"description":"Allow viewers to seek backward during the broadcast."}
   * @paramDef {"type":"Boolean","label":"Enable Embed","name":"enableEmbed","uiComponent":{"type":"TOGGLE"},"description":"Allow embedding on other sites."}
   * @paramDef {"type":"String","label":"Latency Preference","name":"latencyPreference","uiComponent":{"type":"DROPDOWN","options":{"values":["normal","low","ultraLow"]}},"description":"Stream latency tier. ultraLow disables DVR."}
   *
   * @returns {Object}
   * @sampleResult {"id":"broadcast_abc","snippet":{"title":"My Stream","liveChatId":"chat_abc","scheduledStartTime":"2025-12-31T18:00:00Z"},"status":{"lifeCycleStatus":"created","privacyStatus":"private"}}
   */
  async createLiveBroadcast(title, scheduledStartTime, madeForKids, description, scheduledEndTime, privacyStatus, enableAutoStart, enableAutoStop, enableDvr, enableEmbed, latencyPreference) {
    if (!title) throw new Error('"Title" is required')
    if (!scheduledStartTime) throw new Error('"Scheduled Start Time" is required')

    if (madeForKids !== true && madeForKids !== false) {
      throw new Error('"Made For Kids" must be explicitly true or false (YouTube requires this self-declaration).')
    }

    return await this.#apiRequest({
      logTag: 'createLiveBroadcast',
      method: 'post',
      url: `${ API_BASE_URL }/liveBroadcasts`,
      query: { part: 'snippet,status,contentDetails' },
      body: {
        snippet: cleanupObject({ title, description, scheduledStartTime, scheduledEndTime }),
        status: cleanupObject({
          privacyStatus: privacyStatus || 'private',
          selfDeclaredMadeForKids: madeForKids,
        }),
        contentDetails: cleanupObject({
          enableAutoStart: enableAutoStart !== false,
          enableAutoStop: enableAutoStop !== false,
          enableDvr: enableDvr !== false,
          enableEmbed: enableEmbed !== false,
          latencyPreference: latencyPreference || 'normal',
        }),
      },
    })
  }

  /**
   * @description Update broadcast metadata. Only provided fields are changed.
   *
   * @route POST /update-live-broadcast
   * @operationName Update Live Broadcast
   * @category Live Streaming
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.force-ssl
   *
   * @paramDef {"type":"String","label":"Broadcast","name":"broadcastId","required":true,"dictionary":"listMyLiveBroadcastsDictionary","description":"Broadcast to update."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New title."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description."}
   * @paramDef {"type":"String","label":"Scheduled Start Time","name":"scheduledStartTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"New start time (ISO 8601)."}
   * @paramDef {"type":"String","label":"Scheduled End Time","name":"scheduledEndTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"New end time."}
   * @paramDef {"type":"String","label":"Privacy","name":"privacyStatus","uiComponent":{"type":"DROPDOWN","options":{"values":["public","unlisted","private"]}},"description":"New privacy."}
   *
   * @returns {Object}
   * @sampleResult {"id":"broadcast_abc","snippet":{"title":"Updated Title"},"status":{"privacyStatus":"public"}}
   */
  async updateLiveBroadcast(broadcastId, title, description, scheduledStartTime, scheduledEndTime, privacyStatus) {
    if (!broadcastId) throw new Error('"Broadcast" is required')

    const existing = await this.#apiRequest({
      logTag: 'updateLiveBroadcast:get',
      url: `${ API_BASE_URL }/liveBroadcasts`,
      query: { part: 'snippet,status', id: broadcastId },
    })

    const current = existing.items?.[0]

    if (!current) {
      throw new Error(`Broadcast ${ broadcastId } not found.`)
    }

    if (title != null) current.snippet.title = title
    if (description != null) current.snippet.description = description
    if (scheduledStartTime != null) current.snippet.scheduledStartTime = scheduledStartTime
    if (scheduledEndTime != null) current.snippet.scheduledEndTime = scheduledEndTime
    if (privacyStatus != null) current.status.privacyStatus = privacyStatus

    return await this.#apiRequest({
      logTag: 'updateLiveBroadcast',
      method: 'put',
      url: `${ API_BASE_URL }/liveBroadcasts`,
      query: { part: 'snippet,status' },
      body: { id: broadcastId, snippet: current.snippet, status: current.status },
    })
  }

  /**
   * @description Delete a scheduled or completed broadcast.
   *
   * @route POST /delete-live-broadcast
   * @operationName Delete Live Broadcast
   * @category Live Streaming
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.force-ssl
   *
   * @paramDef {"type":"String","label":"Broadcast","name":"broadcastId","required":true,"dictionary":"listMyLiveBroadcastsDictionary","description":"Broadcast to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"broadcastId":"broadcast_abc"}
   */
  async deleteLiveBroadcast(broadcastId) {
    if (!broadcastId) throw new Error('"Broadcast" is required')

    await this.#apiRequest({
      logTag: 'deleteLiveBroadcast',
      method: 'delete',
      url: `${ API_BASE_URL }/liveBroadcasts`,
      query: { id: broadcastId },
    })

    return { success: true, broadcastId }
  }

  /**
   * @description Move a broadcast through its lifecycle (testing → live → complete). Bound stream must be active before transitioning to 'live'.
   *
   * @route POST /transition-live-broadcast
   * @operationName Transition Broadcast
   * @category Live Streaming
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.force-ssl
   *
   * @paramDef {"type":"String","label":"Broadcast","name":"broadcastId","required":true,"dictionary":"listMyLiveBroadcastsDictionary","description":"Broadcast to transition."}
   * @paramDef {"type":"String","label":"Target Status","name":"broadcastStatus","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["testing","live","complete"]}},"description":"New lifecycle status."}
   *
   * @returns {Object}
   * @sampleResult {"id":"broadcast_abc","status":{"lifeCycleStatus":"live"}}
   */
  async transitionLiveBroadcast(broadcastId, broadcastStatus) {
    if (!broadcastId) throw new Error('"Broadcast" is required')
    if (!broadcastStatus) throw new Error('"Target Status" is required')

    return await this.#apiRequest({
      logTag: 'transitionLiveBroadcast',
      method: 'post',
      url: `${ API_BASE_URL }/liveBroadcasts/transition`,
      query: { part: 'id,status', id: broadcastId, broadcastStatus },
    })
  }

  /**
   * @description Bind a live ingestion stream to a broadcast (or unbind by passing empty Stream).
   *
   * @route POST /bind-live-broadcast
   * @operationName Bind Broadcast to Stream
   * @category Live Streaming
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.force-ssl
   *
   * @paramDef {"type":"String","label":"Broadcast","name":"broadcastId","required":true,"dictionary":"listMyLiveBroadcastsDictionary","description":"Broadcast to bind."}
   * @paramDef {"type":"String","label":"Stream","name":"streamId","dictionary":"listMyLiveStreamsDictionary","description":"Stream to attach. Leave empty to unbind."}
   *
   * @returns {Object}
   * @sampleResult {"id":"broadcast_abc","contentDetails":{"boundStreamId":"stream_abc"}}
   */
  async bindLiveBroadcast(broadcastId, streamId) {
    if (!broadcastId) throw new Error('"Broadcast" is required')

    return await this.#apiRequest({
      logTag: 'bindLiveBroadcast',
      method: 'post',
      url: `${ API_BASE_URL }/liveBroadcasts/bind`,
      query: cleanupObject({ part: 'id,contentDetails', id: broadcastId, streamId }),
    })
  }

  /**
   * @description Insert an ad cuepoint into a live broadcast. Channel must be partnered/monetized.
   *
   * @route POST /insert-cuepoint
   * @operationName Insert Cuepoint
   * @category Live Streaming
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.force-ssl
   *
   * @paramDef {"type":"String","label":"Broadcast","name":"broadcastId","required":true,"dictionary":"listMyLiveBroadcastsDictionary","description":"Live broadcast to cue."}
   * @paramDef {"type":"Number","label":"Duration Seconds","name":"durationSecs","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Ad break length in seconds. Default 30."}
   * @paramDef {"type":"String","label":"Cue Type","name":"cueType","uiComponent":{"type":"DROPDOWN","options":{"values":["cueTypeAd"]}},"description":"Cuepoint type. Currently only 'cueTypeAd'."}
   *
   * @returns {Object}
   * @sampleResult {"id":"broadcast_abc","cueId":"cue_xyz"}
   */
  async insertCuepoint(broadcastId, durationSecs, cueType) {
    if (!broadcastId) throw new Error('"Broadcast" is required')

    return await this.#apiRequest({
      logTag: 'insertCuepoint',
      method: 'post',
      url: `${ API_BASE_URL }/liveBroadcasts/cuepoint`,
      query: { id: broadcastId },
      body: {
        cueType: cueType || 'cueTypeAd',
        durationSecs: clampInt(durationSecs, 5, 120, 30),
      },
    })
  }

  /**
   * @description List your ingestion streams (RTMP/HLS endpoints with stream keys).
   *
   * @route POST /list-live-streams
   * @operationName List Live Streams
   * @category Live Streaming
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.force-ssl
   *
   * @paramDef {"type":"String","label":"Stream IDs","name":"id","description":"Comma-separated stream IDs (mutually exclusive with mine)."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-50, default 25."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"stream_abc","snippet":{"title":"Main Stream"},"cdn":{"resolution":"1080p","frameRate":"30fps","ingestionType":"rtmp"},"status":{"streamStatus":"ready"}}]}
   */
  async listLiveStreams(id, maxResults, pageToken) {
    const query = { part: 'snippet,cdn,contentDetails,status', maxResults: clampInt(maxResults, 1, 50, 25), pageToken }

    if (id) {
      query.id = Array.isArray(id) ? id.join(',') : id
    } else {
      query.mine = 'true'
    }

    return await this.#apiRequest({
      logTag: 'listLiveStreams',
      url: `${ API_BASE_URL }/liveStreams`,
      query,
    })
  }

  /**
   * @description Create an ingestion stream config (RTMP/HLS endpoint). Returns the stream key needed to broadcast.
   *
   * @route POST /create-live-stream
   * @operationName Create Live Stream
   * @category Live Streaming
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.force-ssl
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Stream title (internal label)."}
   * @paramDef {"type":"String","label":"Resolution","name":"resolution","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["240p","360p","480p","720p","1080p","1440p","2160p","variable"]}},"description":"Target resolution."}
   * @paramDef {"type":"String","label":"Frame Rate","name":"frameRate","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["30fps","60fps","variable"]}},"description":"Target frame rate."}
   * @paramDef {"type":"String","label":"Ingestion Type","name":"ingestionType","uiComponent":{"type":"DROPDOWN","options":{"values":["rtmp","dash","webrtc","hls"]}},"description":"Streaming protocol. Default 'rtmp'."}
   * @paramDef {"type":"Boolean","label":"Reusable","name":"isReusable","uiComponent":{"type":"TOGGLE"},"description":"Allow binding this stream to multiple broadcasts. Default true."}
   *
   * @returns {Object}
   * @sampleResult {"id":"stream_abc","snippet":{"title":"Main Stream"},"cdn":{"ingestionInfo":{"streamName":"<key>","ingestionAddress":"rtmp://a.rtmp.youtube.com/live2","backupIngestionAddress":"rtmp://b.rtmp.youtube.com/live2?backup=1","rtmpsIngestionAddress":"rtmps://a.rtmps.youtube.com/live2"}}}
   */
  async createLiveStream(title, resolution, frameRate, ingestionType, isReusable) {
    if (!title) throw new Error('"Title" is required')
    if (!resolution) throw new Error('"Resolution" is required')
    if (!frameRate) throw new Error('"Frame Rate" is required')

    return await this.#apiRequest({
      logTag: 'createLiveStream',
      method: 'post',
      url: `${ API_BASE_URL }/liveStreams`,
      query: { part: 'snippet,cdn,contentDetails' },
      body: {
        snippet: { title },
        cdn: { resolution, frameRate, ingestionType: ingestionType || 'rtmp' },
        contentDetails: { isReusable: isReusable !== false },
      },
    })
  }

  /**
   * @description Update an ingestion stream's title or CDN config.
   *
   * @route POST /update-live-stream
   * @operationName Update Live Stream
   * @category Live Streaming
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.force-ssl
   *
   * @paramDef {"type":"String","label":"Stream","name":"streamId","required":true,"dictionary":"listMyLiveStreamsDictionary","description":"Stream to update."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New title."}
   * @paramDef {"type":"String","label":"Resolution","name":"resolution","uiComponent":{"type":"DROPDOWN","options":{"values":["240p","360p","480p","720p","1080p","1440p","2160p","variable"]}},"description":"New resolution."}
   * @paramDef {"type":"String","label":"Frame Rate","name":"frameRate","uiComponent":{"type":"DROPDOWN","options":{"values":["30fps","60fps","variable"]}},"description":"New frame rate."}
   *
   * @returns {Object}
   * @sampleResult {"id":"stream_abc","snippet":{"title":"Updated"}}
   */
  async updateLiveStream(streamId, title, resolution, frameRate) {
    if (!streamId) throw new Error('"Stream" is required')

    const existing = await this.#apiRequest({
      logTag: 'updateLiveStream:get',
      url: `${ API_BASE_URL }/liveStreams`,
      query: { part: 'snippet,cdn', id: streamId },
    })

    const current = existing.items?.[0]

    if (!current) {
      throw new Error(`Stream ${ streamId } not found.`)
    }

    if (title != null) current.snippet.title = title
    if (resolution != null) current.cdn.resolution = resolution
    if (frameRate != null) current.cdn.frameRate = frameRate

    return await this.#apiRequest({
      logTag: 'updateLiveStream',
      method: 'put',
      url: `${ API_BASE_URL }/liveStreams`,
      query: { part: 'snippet,cdn' },
      body: { id: streamId, snippet: current.snippet, cdn: current.cdn },
    })
  }

  /**
   * @description Delete an ingestion stream config.
   *
   * @route POST /delete-live-stream
   * @operationName Delete Live Stream
   * @category Live Streaming
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.force-ssl
   *
   * @paramDef {"type":"String","label":"Stream","name":"streamId","required":true,"dictionary":"listMyLiveStreamsDictionary","description":"Stream to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"streamId":"stream_abc"}
   */
  async deleteLiveStream(streamId) {
    if (!streamId) throw new Error('"Stream" is required')

    await this.#apiRequest({
      logTag: 'deleteLiveStream',
      method: 'delete',
      url: `${ API_BASE_URL }/liveStreams`,
      query: { id: streamId },
    })

    return { success: true, streamId }
  }

  /**
   * @description Poll messages from a live chat. Honor the returned pollingIntervalMillis between calls. Only works while the broadcast is testing/live.
   *
   * @route POST /list-live-chat-messages
   * @operationName List Live Chat Messages
   * @category Live Streaming
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.force-ssl
   *
   * @paramDef {"type":"String","label":"Live Chat ID","name":"liveChatId","required":true,"description":"From broadcast.snippet.liveChatId. Only valid while broadcast is testing/live."}
   * @paramDef {"type":"Number","label":"Profile Image Size","name":"profileImageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Profile image size in pixels (16-720)."}
   * @paramDef {"type":"String","label":"Language","name":"hl","dictionary":"listI18nLanguagesDictionary","description":"BCP-47 language for the response."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"200 default; up to 2000."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Token returned in previous response (chronological continuation)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"msg_abc","snippet":{"type":"textMessageEvent","displayMessage":"Hello!","authorChannelId":"UCxyz","publishedAt":"2025-01-15T18:05:00Z"}}],"pollingIntervalMillis":5000,"nextPageToken":"..."}
   */
  async listLiveChatMessages(liveChatId, profileImageSize, hl, maxResults, pageToken) {
    if (!liveChatId) throw new Error('"Live Chat ID" is required')

    return await this.#apiRequest({
      logTag: 'listLiveChatMessages',
      url: `${ API_BASE_URL }/liveChat/messages`,
      query: cleanupObject({
        part: 'id,snippet,authorDetails',
        liveChatId,
        profileImageSize,
        hl: hl || this.defaultLanguage,
        maxResults: clampInt(maxResults, 200, 2000, 200),
        pageToken,
      }),
    })
  }

  /**
   * @description Post a text message to a live chat.
   *
   * @route POST /post-live-chat-message
   * @operationName Post Live Chat Message
   * @category Live Streaming
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.force-ssl
   *
   * @paramDef {"type":"String","label":"Live Chat ID","name":"liveChatId","required":true,"description":"From broadcast.snippet.liveChatId."}
   * @paramDef {"type":"String","label":"Message","name":"messageText","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text to send (max 200 chars)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"msg_xyz","snippet":{"liveChatId":"chat_abc","textMessageDetails":{"messageText":"Hello!"}}}
   */
  async postLiveChatMessage(liveChatId, messageText) {
    if (!liveChatId) throw new Error('"Live Chat ID" is required')
    if (!messageText) throw new Error('"Message" is required')

    return await this.#apiRequest({
      logTag: 'postLiveChatMessage',
      method: 'post',
      url: `${ API_BASE_URL }/liveChat/messages`,
      query: { part: 'snippet' },
      body: {
        snippet: {
          liveChatId,
          type: 'textMessageEvent',
          textMessageDetails: { messageText },
        },
      },
    })
  }

  /**
   * @description Delete a live chat message. Owner or moderators only.
   *
   * @route POST /delete-live-chat-message
   * @operationName Delete Live Chat Message
   * @category Live Streaming
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.force-ssl
   *
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"description":"Live chat message id."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"messageId":"msg_xyz"}
   */
  async deleteLiveChatMessage(messageId) {
    if (!messageId) throw new Error('"Message ID" is required')

    await this.#apiRequest({
      logTag: 'deleteLiveChatMessage',
      method: 'delete',
      url: `${ API_BASE_URL }/liveChat/messages`,
      query: { id: messageId },
    })

    return { success: true, messageId }
  }

  /**
   * @description List moderators of a live chat.
   *
   * @route POST /list-live-chat-moderators
   * @operationName List Live Chat Moderators
   * @category Live Streaming
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.force-ssl
   *
   * @paramDef {"type":"String","label":"Live Chat ID","name":"liveChatId","required":true,"description":"Live chat id."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-50, default 25."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"mod_xyz","snippet":{"liveChatId":"chat_abc","moderatorDetails":{"channelId":"UCxyz","displayName":"User"}}}]}
   */
  async listLiveChatModerators(liveChatId, maxResults, pageToken) {
    if (!liveChatId) throw new Error('"Live Chat ID" is required')

    return await this.#apiRequest({
      logTag: 'listLiveChatModerators',
      url: `${ API_BASE_URL }/liveChat/moderators`,
      query: { part: 'snippet', liveChatId, maxResults: clampInt(maxResults, 1, 50, 25), pageToken },
    })
  }

  /**
   * @description Promote a viewer to chat moderator for an active live chat.
   *
   * @route POST /add-live-chat-moderator
   * @operationName Add Live Chat Moderator
   * @category Live Streaming
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.force-ssl
   *
   * @paramDef {"type":"String","label":"Live Chat ID","name":"liveChatId","required":true,"description":"Live chat to moderate."}
   * @paramDef {"type":"String","label":"Channel","name":"channelId","required":true,"description":"Channel ID, @handle, username, or URL of the user to make moderator."}
   *
   * @returns {Object}
   * @sampleResult {"id":"mod_xyz","snippet":{"liveChatId":"chat_abc","moderatorDetails":{"channelId":"UCxyz"}}}
   */
  async addLiveChatModerator(liveChatId, channelId) {
    if (!liveChatId) throw new Error('"Live Chat ID" is required')
    if (!channelId) throw new Error('"Channel" is required')

    const resolvedId = await this.#ensureChannelId(channelId)

    return await this.#apiRequest({
      logTag: 'addLiveChatModerator',
      method: 'post',
      url: `${ API_BASE_URL }/liveChat/moderators`,
      query: { part: 'snippet' },
      body: {
        snippet: {
          liveChatId,
          moderatorDetails: { channelId: resolvedId },
        },
      },
    })
  }

  /**
   * @description Remove a chat moderator.
   *
   * @route POST /remove-live-chat-moderator
   * @operationName Remove Live Chat Moderator
   * @category Live Streaming
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.force-ssl
   *
   * @paramDef {"type":"String","label":"Moderator ID","name":"moderatorId","required":true,"description":"Moderator resource id (from List Live Chat Moderators)."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"moderatorId":"mod_xyz"}
   */
  async removeLiveChatModerator(moderatorId) {
    if (!moderatorId) throw new Error('"Moderator ID" is required')

    await this.#apiRequest({
      logTag: 'removeLiveChatModerator',
      method: 'delete',
      url: `${ API_BASE_URL }/liveChat/moderators`,
      query: { id: moderatorId },
    })

    return { success: true, moderatorId }
  }

  /**
   * @description Ban a user from a live chat (permanent or for a duration).
   *
   * @route POST /add-live-chat-ban
   * @operationName Ban User from Live Chat
   * @category Live Streaming
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.force-ssl
   *
   * @paramDef {"type":"String","label":"Live Chat ID","name":"liveChatId","required":true,"description":"Live chat to ban from."}
   * @paramDef {"type":"String","label":"User Channel","name":"bannedUserChannelId","required":true,"description":"Channel ID, @handle, or URL of the user to ban."}
   * @paramDef {"type":"String","label":"Ban Type","name":"banType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["permanent","temporary"]}},"description":"Permanent or time-limited ban."}
   * @paramDef {"type":"Number","label":"Duration Seconds","name":"banDurationSeconds","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Required for temporary bans."}
   *
   * @returns {Object}
   * @sampleResult {"id":"ban_xyz","snippet":{"liveChatId":"chat_abc","type":"permanent","bannedUserDetails":{"channelId":"UCxyz"}}}
   */
  async addLiveChatBan(liveChatId, bannedUserChannelId, banType, banDurationSeconds) {
    if (!liveChatId) throw new Error('"Live Chat ID" is required')
    if (!bannedUserChannelId) throw new Error('"User Channel" is required')
    if (!banType) throw new Error('"Ban Type" is required')

    if (banType === 'temporary' && !banDurationSeconds) {
      throw new Error('"Duration Seconds" is required for temporary bans.')
    }

    const resolvedId = await this.#ensureChannelId(bannedUserChannelId)

    return await this.#apiRequest({
      logTag: 'addLiveChatBan',
      method: 'post',
      url: `${ API_BASE_URL }/liveChat/bans`,
      query: { part: 'snippet' },
      body: {
        snippet: cleanupObject({
          liveChatId,
          type: banType,
          banDurationSeconds: banType === 'temporary' ? banDurationSeconds : undefined,
          bannedUserDetails: { channelId: resolvedId },
        }),
      },
    })
  }

  /**
   * @description Lift a live chat ban.
   *
   * @route POST /remove-live-chat-ban
   * @operationName Remove Live Chat Ban
   * @category Live Streaming
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.force-ssl
   *
   * @paramDef {"type":"String","label":"Ban ID","name":"banId","required":true,"description":"Ban resource id (returned from Ban User from Live Chat)."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"banId":"ban_xyz"}
   */
  async removeLiveChatBan(banId) {
    if (!banId) throw new Error('"Ban ID" is required')

    await this.#apiRequest({
      logTag: 'removeLiveChatBan',
      method: 'delete',
      url: `${ API_BASE_URL }/liveChat/bans`,
      query: { id: banId },
    })

    return { success: true, banId }
  }

  /**
   * @description List Super Chat events from your channel (last 30 days). Authenticated channel must be the recipient.
   *
   * @route POST /list-super-chat-events
   * @operationName List Super Chats
   * @category Live Streaming
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes youtube.force-ssl
   *
   * @paramDef {"type":"String","label":"Language","name":"hl","dictionary":"listI18nLanguagesDictionary","description":"BCP-47 language for the response."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-50, default 25."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"sc_abc","snippet":{"channelId":"UCabc","supporterDetails":{"displayName":"User"},"commentText":"Great stream!","amountMicros":"5000000","currency":"USD","displayString":"$5.00","createdAt":"2025-01-15T18:30:00Z","messageType":4,"isSuperChatForGood":false}}]}
   */
  async listSuperChatEvents(hl, maxResults, pageToken) {
    return await this.#apiRequest({
      logTag: 'listSuperChatEvents',
      url: `${ API_BASE_URL }/superChatEvents`,
      query: cleanupObject({ part: 'id,snippet', hl: hl || this.defaultLanguage, maxResults: clampInt(maxResults, 1, 50, 25), pageToken }),
    })
  }

  // =============================== 16 POLLING TRIGGERS ===============================

  /**
   * @description Triggers when a new video is uploaded to a specified YouTube channel. Uses uploads-playlist diffing (low quota cost: ~3 units per poll).
   *
   * @registerAs POLLING_TRIGGER
   * @operationName On New Video on Channel
   * @category Triggers
   * @route POST /on-new-video-on-channel
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Channel","name":"channelId","required":true,"dictionary":"listMyChannelsDictionary","description":"Channel to monitor. Pick from your channels or paste a channel ID."}
   * @paramDef {"type":"String","label":"Title Contains","name":"titleContains","description":"Only fire if the new video's title contains this substring (case-insensitive). Empty matches all."}
   * @paramDef {"type":"String","label":"Title Excludes","name":"titleExcludes","description":"Skip if title contains this substring. Useful for excluding live streams or premieres."}
   * @paramDef {"type":"String","label":"Tag Required","name":"tagAny","description":"Only fire if the video has at least one tag from this comma-separated list."}
   * @paramDef {"type":"Boolean","label":"Exclude Shorts","name":"excludeShorts","uiComponent":{"type":"TOGGLE"},"description":"Skip videos shorter than 60 seconds (likely YouTube Shorts). Adds 1 quota unit per poll."}
   *
   * @returns {Object}
   * @sampleResult {"events":[{"videoId":"abc123","title":"New Demo","publishedAt":"2025-01-10T10:00:00Z","channelId":"UCabc"}]}
   */
  async onNewVideoOnChannel(invocation) {
    const data = invocation.eventData || invocation.triggerData || {}
    const channelId = data.channelId

    if (!channelId) throw new Error('"Channel" is required')

    const channelsResp = await this.#apiRequest({
      logTag: 'onNewVideoOnChannel:channels',
      url: `${ API_BASE_URL }/channels`,
      query: { part: 'contentDetails', id: channelId },
    })

    const uploadsPlaylistId = channelsResp.items?.[0]?.contentDetails?.relatedPlaylists?.uploads

    if (!uploadsPlaylistId) {
      return { events: [], state: invocation.state || {} }
    }

    // Page newest-first until we reach the previously seen video, so a burst of uploads spanning
    // more than one page between polls is not silently dropped (bounded by POLLING_MAX_PAGES).
    const previousLatest = invocation.state?.latestVideoId
    const rawItems = await this.#collectUntilSeen({
      logTag: 'onNewVideoOnChannel:playlistItems',
      url: `${ API_BASE_URL }/playlistItems`,
      query: { part: 'snippet,contentDetails', playlistId: uploadsPlaylistId, maxResults: 50 },
      idOf: i => i.contentDetails?.videoId,
      seenId: invocation.state?.initialized ? previousLatest : null,
    })

    let videos = rawItems.map(i => ({
      videoId: i.contentDetails?.videoId,
      title: i.snippet?.title,
      description: i.snippet?.description,
      publishedAt: i.contentDetails?.videoPublishedAt,
      channelId: i.snippet?.channelId,
      thumbnails: i.snippet?.thumbnails,
    }))

    if (data.titleContains) {
      const needle = data.titleContains.toLowerCase()

      videos = videos.filter(v => v.title?.toLowerCase().includes(needle))
    }

    if (data.titleExcludes) {
      const skip = data.titleExcludes.toLowerCase()

      videos = videos.filter(v => !v.title?.toLowerCase().includes(skip))
    }

    if ((data.tagAny || data.excludeShorts) && videos.length) {
      const allIds = videos.map(v => v.videoId).filter(Boolean)
      const detailsById = {}

      // videos.list accepts at most 50 ids per call — chunk so a multi-page burst still enriches.
      for (let start = 0; start < allIds.length; start += 50) {
        const enriched = await this.#apiRequest({
          logTag: 'onNewVideoOnChannel:enrich',
          url: `${ API_BASE_URL }/videos`,
          query: { part: 'snippet,contentDetails', id: allIds.slice(start, start + 50).join(',') },
        })

        for (const v of (enriched.items || [])) {
          detailsById[v.id] = v
        }
      }

      videos = videos.map(v => ({ ...v, tags: detailsById[v.videoId]?.snippet?.tags, duration: detailsById[v.videoId]?.contentDetails?.duration }))

      if (data.tagAny) {
        const wanted = data.tagAny.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)

        videos = videos.filter(v => v.tags?.some(t => wanted.includes(t.toLowerCase())))
      }

      if (data.excludeShorts) {
        videos = videos.filter(v => !isShortDuration(v.duration))
      }
    }

    if (invocation.learningMode) {
      return { events: videos.slice(0, 1), state: null }
    }

    // Advance the marker to the newest raw upload seen this poll (rawItems[0]), independent of
    // user filters — otherwise a filtered-out newest video would be re-evaluated every poll.
    const newestVideoId = rawItems[0]?.contentDetails?.videoId || previousLatest || null

    if (!invocation.state?.initialized) {
      return { events: [], state: { initialized: true, latestVideoId: newestVideoId } }
    }

    // #collectUntilSeen already trimmed everything at/after the previous marker, so the filtered
    // list is exactly the new videos (newest-first, matching the prior break-at-marker behavior).
    return { events: videos, state: { ...invocation.state, latestVideoId: newestVideoId } }
  }

  /**
   * @description Triggers when a new comment is posted on a specified video.
   *
   * @registerAs POLLING_TRIGGER
   * @operationName On New Comment on Video
   * @category Triggers
   * @route POST /on-new-comment-on-video
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Video ID","name":"videoId","required":true,"description":"Video to monitor."}
   * @paramDef {"type":"Boolean","label":"Exclude Own Comments","name":"excludeOwnComments","uiComponent":{"type":"TOGGLE"},"description":"Skip comments posted by the connected channel owner."}
   * @paramDef {"type":"Number","label":"Min Likes","name":"minLikes","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Only fire if the comment has at least this many likes (helps surface notable comments)."}
   * @paramDef {"type":"String","label":"Author Block List","name":"authorBlockList","description":"Comma-separated list of author handles or substrings to ignore (case-insensitive)."}
   * @paramDef {"type":"String","label":"Text Contains","name":"textContains","description":"Only fire if the comment text contains this substring (case-insensitive). Useful for keyword-based moderation."}
   * @paramDef {"type":"Number","label":"Min Length","name":"minLength","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Skip comments shorter than this character count (filters emoji-only spam)."}
   *
   * @returns {Object}
   * @sampleResult {"events":[{"commentId":"comment_abc","videoId":"vid123","text":"Great!","author":"@user","publishedAt":"2025-01-10T11:00:00Z","likeCount":2}]}
   */
  async onNewCommentOnVideo(invocation) {
    const data = invocation.eventData || invocation.triggerData || {}
    const videoId = data.videoId

    if (!videoId) throw new Error('"Video ID" is required')

    // Page time-ordered (newest-first) until the previously seen comment, so a burst of comments
    // spanning more than one page between polls is not silently dropped (bounded by POLLING_MAX_PAGES).
    const previousLatest = invocation.state?.latestCommentId
    const rawThreads = await this.#collectUntilSeen({
      logTag: 'onNewCommentOnVideo',
      url: `${ API_BASE_URL }/commentThreads`,
      query: { part: 'snippet', videoId, order: 'time', maxResults: 100 },
      idOf: t => t.snippet?.topLevelComment?.id || t.id,
      seenId: invocation.state?.initialized ? previousLatest : null,
    })

    const newestCommentId = rawThreads[0]?.snippet?.topLevelComment?.id || rawThreads[0]?.id || previousLatest || null

    let comments = rawThreads.map(t => {
      const top = t.snippet?.topLevelComment?.snippet

      return {
        commentId: t.snippet?.topLevelComment?.id || t.id,
        videoId,
        text: top?.textDisplay,
        author: top?.authorDisplayName,
        authorChannelId: top?.authorChannelId?.value,
        publishedAt: top?.publishedAt,
        likeCount: top?.likeCount,
      }
    })

    if (data.excludeOwnComments) {
      const myChannelId = invocation.state?.myChannelId || await this.#cacheMyChannelId(invocation)

      comments = comments.filter(c => c.authorChannelId !== myChannelId)
    }

    if (typeof data.minLikes === 'number') {
      comments = comments.filter(c => (c.likeCount || 0) >= data.minLikes)
    }

    if (data.textContains) {
      const needle = data.textContains.toLowerCase()

      comments = comments.filter(c => c.text?.toLowerCase().includes(needle))
    }

    if (typeof data.minLength === 'number') {
      comments = comments.filter(c => (c.text?.length || 0) >= data.minLength)
    }

    if (data.authorBlockList) {
      const blocked = data.authorBlockList.split(',').map(a => a.trim().toLowerCase()).filter(Boolean)

      comments = comments.filter(c => !blocked.some(b => c.author?.toLowerCase().includes(b)))
    }

    if (invocation.learningMode) {
      return { events: comments.slice(0, 1), state: null }
    }

    if (!invocation.state?.initialized) {
      return { events: [], state: { initialized: true, latestCommentId: newestCommentId } }
    }

    // #collectUntilSeen already trimmed the previous marker and everything after it, so the
    // filtered list is exactly the new comments. Advance the marker to the newest raw comment
    // (independent of filters) so a filtered-out newest comment isn't re-evaluated every poll.
    return { events: comments, state: { ...invocation.state, latestCommentId: newestCommentId } }
  }

  /**
   * @description Triggers when the authenticated user gains a new subscriber.
   *
   * @registerAs POLLING_TRIGGER
   * @operationName On New Subscriber
   * @category Triggers
   * @route POST /on-new-subscriber
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Boolean","label":"Exclude Empty Profiles","name":"excludeEmpty","uiComponent":{"type":"TOGGLE"},"description":"Skip subscribers with no description and no custom thumbnail (often bots)."}
   * @paramDef {"type":"Number","label":"Min Subscriber Count","name":"minSubscribers","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Only fire when the subscriber's own channel has at least this many subscribers. Adds 1 quota unit per new subscriber to fetch counts."}
   *
   * @returns {Object}
   * @sampleResult {"events":[{"subscriptionId":"sub_abc","subscriberChannelId":"UCxyz","subscriberTitle":"Some User","subscribedAt":"2025-01-10T09:00:00Z"}]}
   */
  async onNewSubscriber(invocation) {
    const data = invocation.eventData || invocation.triggerData || {}
    const seenSet = new Set(invocation.state?.seenIds || [])
    const initialized = !!invocation.state?.initialized

    // Page newest-first (order=unread): on an initialized trigger, keep walking pages until a page
    // adds no unseen subscriptions (steady state) or POLLING_MAX_PAGES is hit, so a burst of more
    // than one page of new subscribers between polls is not silently dropped. First run reads a
    // single page to seed the seen-set baseline.
    const rawItems = []
    let pageToken
    let pages = 0

    do {
      const response = await this.#apiRequest({
        logTag: 'onNewSubscriber',
        url: `${ API_BASE_URL }/subscriptions`,
        query: { part: 'snippet,subscriberSnippet', mySubscribers: 'true', order: 'unread', maxResults: 50, pageToken },
      })

      const items = response.items || []
      const pageHadUnseen = items.some(s => !seenSet.has(s.id))

      rawItems.push(...items)
      pageToken = response.nextPageToken
      pages++

      // First run: one page seeds the baseline. Otherwise stop once a page yields nothing new.
      if (!initialized || !pageHadUnseen) break
    } while (pageToken && pages < POLLING_MAX_PAGES)

    let subs = rawItems.map(s => ({
      subscriptionId: s.id,
      subscriberChannelId: s.subscriberSnippet?.channelId,
      subscriberTitle: s.subscriberSnippet?.title,
      subscriberDescription: s.subscriberSnippet?.description,
      subscriberThumbnails: s.subscriberSnippet?.thumbnails,
      subscribedAt: s.snippet?.publishedAt,
    }))

    if (data.excludeEmpty) {
      subs = subs.filter(s => s.subscriberDescription || s.subscriberThumbnails?.default?.url)
    }

    if (typeof data.minSubscribers === 'number' && data.minSubscribers > 0 && subs.length) {
      const allIds = subs.map(s => s.subscriberChannelId).filter(Boolean)

      if (allIds.length) {
        const subCountById = {}

        // channels.list accepts at most 50 ids per call — chunk so a multi-page burst still enriches.
        for (let start = 0; start < allIds.length; start += 50) {
          const enriched = await this.#apiRequest({
            logTag: 'onNewSubscriber:enrich',
            url: `${ API_BASE_URL }/channels`,
            query: { part: 'statistics', id: allIds.slice(start, start + 50).join(',') },
          })

          for (const c of (enriched.items || [])) {
            subCountById[c.id] = Number(c.statistics?.subscriberCount || 0)
          }
        }

        subs = subs.filter(s => (subCountById[s.subscriberChannelId] || 0) >= data.minSubscribers)
      }
    }

    if (invocation.learningMode) {
      return { events: subs.slice(0, 1), state: null }
    }

    if (!initialized) {
      const seenIds = subs.map(s => s.subscriptionId)

      return { events: [], state: { initialized: true, seenIds: seenIds.slice(0, 200) } }
    }

    const newSubs = subs.filter(s => !seenSet.has(s.subscriptionId))
    const updatedSeen = Array.from(new Set([...subs.map(s => s.subscriptionId), ...(invocation.state.seenIds || [])])).slice(0, 500)

    return { events: newSubs, state: { ...invocation.state, seenIds: updatedSeen } }
  }

  // =============================== 16.5 REALTIME TRIGGERS (PubSubHubbub) ===============================

  /**
   * @description Fires the moment YouTube's PubSubHubbub hub notifies us of a new video or metadata update on the chosen channel. Push-based — sub-second latency, no polling quota cost. Recommended over the polling 'On New Video on Channel' trigger.
   *
   * @route POST /on-new-video-on-channel-realtime
   * @operationName On New Video on Channel (Realtime)
   * @category Triggers
   * @registerAs REALTIME_TRIGGER
   * @appearanceColor #ff0000 #cc0000
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Channel","name":"channelId","required":true,"dictionary":"listMyChannelsDictionary","description":"Channel to monitor. Pick from your channels or paste any UC... ID, @handle, or YouTube channel URL."}
   * @paramDef {"type":"Boolean","label":"Skip Updates","name":"skipUpdates","uiComponent":{"type":"TOGGLE"},"description":"Only fire on brand-new uploads; ignore title/description edits to existing videos."}
   *
   * @returns {Object}
   * @sampleResult {"videoId":"abc123","channelId":"UCabc","title":"My New Video","link":"https://www.youtube.com/watch?v=abc123","authorName":"My Channel","publishedAt":"2025-05-10T12:00:00+00:00","updatedAt":"2025-05-10T12:00:00+00:00","isUpdate":false}
   */
  async onNewVideoOnChannelRealtime() {}

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerUpsertWebhook
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    logger.debug(`handleTriggerUpsertWebhook.invocation: ${ JSON.stringify(invocation) }`)

    const webhookData = invocation.webhookData || {}
    const callbackUrl = invocation.callbackUrl

    if (!callbackUrl) {
      logger.warn('handleTriggerUpsertWebhook: no callbackUrl provided')

      return { connectionId: invocation.connectionId, refreshIntervalInSeconds: 24 * 3600, webhookData }
    }

    // Resolve channel inputs to canonical UC... IDs (so URL/handle inputs work)
    const desiredChannels = new Set()

    for (const ev of (invocation.events || [])) {
      const raw = ev.triggerData?.channelId

      if (!raw) continue

      try {
        const id = await this.#ensureChannelId(raw)

        desiredChannels.add(id)
      } catch (error) {
        logger.warn(`handleTriggerUpsertWebhook: failed to resolve "${ raw }": ${ error.message }`)
      }
    }

    const subscribed = new Set(Object.keys(webhookData))

    // Subscribe to channels we don't have webhooks for yet
    for (const channelId of desiredChannels) {
      if (!subscribed.has(channelId)) {
        const secret = generateSecret()
        const result = await subscribeToChannelFeed({ channelId, callbackUrl, secret })

        webhookData[channelId] = {
          channelId,
          secret,
          callbackUrl,
          subscribedAt: new Date().toISOString(),
          leaseExpiresAt: new Date(Date.now() + (10 * 24 * 60 * 60 * 1000)).toISOString(),
          lastResult: result,
        }
      }
    }

    // Unsubscribe from channels no longer wanted
    for (const channelId of subscribed) {
      if (!desiredChannels.has(channelId)) {
        await unsubscribeFromChannelFeed({ channelId, callbackUrl: webhookData[channelId].callbackUrl })
        delete webhookData[channelId]
      }
    }

    return {
      connectionId: invocation.connectionId,
      refreshIntervalInSeconds: 24 * 3600, // check daily; renew when within 24h of expiry
      webhookData,
    }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerRefreshWebhook
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerRefreshWebhook(invocation) {
    const webhookData = { ...(invocation.webhookData || {}) }
    const now = Date.now()

    for (const channelId of Object.keys(webhookData)) {
      const entry = webhookData[channelId]
      const expiresAt = entry.leaseExpiresAt ? Date.parse(entry.leaseExpiresAt) : 0

      if (!Number.isFinite(expiresAt) || expiresAt - now < RENEWAL_THRESHOLD_MS) {
        const result = await subscribeToChannelFeed({
          channelId,
          callbackUrl: entry.callbackUrl,
          secret: entry.secret,
        })

        webhookData[channelId] = {
          ...entry,
          leaseExpiresAt: new Date(now + (10 * 24 * 60 * 60 * 1000)).toISOString(),
          lastResult: result,
          renewedAt: new Date().toISOString(),
        }
      }
    }

    return { refreshIntervalInSeconds: 24 * 3600, webhookData }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerResolveEvents
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    logger.debug(`handleTriggerResolveEvents headers: ${ JSON.stringify(invocation.headers) }`)

    const queryParams = invocation.queryParams || {}

    // PubSubHubbub verification handshake — hub sends GET with hub.challenge to confirm subscription
    if (queryParams['hub.challenge']) {
      return {
        handshake: true,
        responseToExternalService: queryParams['hub.challenge'],
        connectionId: invocation.connectionId,
        events: [],
      }
    }

    const rawBody = typeof invocation.body === 'string' ? invocation.body : ''
    const sigHeader = invocation.headers?.['x-hub-signature'] || invocation.headers?.['X-Hub-Signature']

    // Every subscription is registered with a hub.secret, so the hub signs every real
    // delivery (per the WebSub spec, section 11.2). When stored secrets exist, reject any delivery that lacks a
    // valid signature — an unsigned notification is forged. https://www.w3.org/TR/websub/
    const secrets = Object.values(invocation.webhookData || {}).map(d => d.secret).filter(Boolean)

    if (secrets.length) {
      const verified = Boolean(sigHeader) && secrets.some(secret => verifyHubSignature(rawBody, sigHeader, secret))

      if (!verified) {
        logger.warn('handleTriggerResolveEvents: missing or invalid HMAC signature; dropping notification.')

        return { connectionId: invocation.connectionId, events: [] }
      }
    }

    const entries = parseAtomNotification(rawBody)

    const events = entries.map(e => ({
      name: 'onNewVideoOnChannelRealtime',
      data: e,
    }))

    return { connectionId: invocation.connectionId, events }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerSelectMatched
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    const eventData = invocation.eventData || {}
    const triggers = invocation.triggers || []

    const matched = triggers.filter(t => {
      const targetChannel = t.data?.channelId

      if (!targetChannel) return false

      // Caller may have used handle/URL — compare normalized forms when possible.
      const normalized = classifyChannelInput(targetChannel)
      const targetId = normalized?.kind === 'id' ? normalized.value : null

      if (eventData.channelId && targetId && eventData.channelId === targetId) {
        return true
      }

      // Fallback exact match (covers stored UC IDs already)
      return eventData.channelId === targetChannel
    })

    // Apply per-trigger filters (skipUpdates)
    const ids = matched
      .filter(t => !(t.data?.skipUpdates && eventData.isUpdate))
      .map(t => t.id)

    return { ids, enrichedEventData: eventData }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerDeleteWebhook
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerDeleteWebhook(invocation) {
    const webhookData = invocation.webhookData || {}

    for (const channelId of Object.keys(webhookData)) {
      const entry = webhookData[channelId]

      try {
        await unsubscribeFromChannelFeed({ channelId, callbackUrl: entry.callbackUrl })
      } catch (error) {
        logger.warn(`handleTriggerDeleteWebhook: failed to unsubscribe ${ channelId }: ${ error.message }`)
      }
    }

    return { connectionId: invocation.connectionId }
  }

  // =============================== 17 SAMPLE RESULT LOADERS ===============================

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /getVideo_SampleResultLoader
   * @paramDef {"type":"Object","label":"payload","name":"payload"}
   * @returns {Object}
   */
  async getVideo_SampleResultLoader(payload = {}) {
    const criteria = payload?.criteria || {}
    const parts = Array.isArray(criteria.parts) && criteria.parts.length
      ? criteria.parts
      : ['snippet', 'statistics', 'contentDetails', 'status']

    const item = { kind: 'youtube#video', etag: 'sample', id: 'dQw4w9WgXcQ' }

    if (parts.includes('snippet')) {
      item.snippet = {
        publishedAt: '2025-01-10T10:00:00Z',
        channelId: 'UCsamplechannel123456789',
        title: 'Sample Video Title',
        description: 'Sample description for an uploaded video.',
        thumbnails: { default: { url: 'https://i.ytimg.com/vi/ID/default.jpg', width: 120, height: 90 } },
        channelTitle: 'Sample Channel',
        tags: ['sample', 'demo'],
        categoryId: '22',
        liveBroadcastContent: 'none',
        defaultLanguage: 'en',
      }
    }

    if (parts.includes('statistics')) {
      item.statistics = { viewCount: '12345', likeCount: '420', favoriteCount: '0', commentCount: '37' }
    }

    if (parts.includes('contentDetails')) {
      item.contentDetails = { duration: 'PT5M30S', dimension: '2d', definition: 'hd', caption: 'true', licensedContent: false }
    }

    if (parts.includes('status')) {
      item.status = { uploadStatus: 'processed', privacyStatus: 'public', license: 'youtube', embeddable: true, publicStatsViewable: true, madeForKids: false }
    }

    if (parts.includes('topicDetails')) {
      item.topicDetails = { topicCategories: ['https://en.wikipedia.org/wiki/Music'] }
    }

    if (criteria.summarize) {
      return {
        videoId: item.id,
        title: item.snippet?.title,
        description: item.snippet?.description,
        channelId: item.snippet?.channelId,
        channelTitle: item.snippet?.channelTitle,
        publishedAt: item.snippet?.publishedAt,
        thumbnails: item.snippet?.thumbnails,
        tags: item.snippet?.tags,
        categoryId: item.snippet?.categoryId,
        duration: item.contentDetails?.duration,
        viewCount: item.statistics?.viewCount,
        likeCount: item.statistics?.likeCount,
        commentCount: item.statistics?.commentCount,
        privacyStatus: item.status?.privacyStatus,
      }
    }

    return { kind: 'youtube#videoListResponse', etag: 'sample', items: [item], pageInfo: { totalResults: 1, resultsPerPage: 1 } }
  }

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /getMyChannel_SampleResultLoader
   * @paramDef {"type":"Object","label":"payload","name":"payload"}
   * @returns {Object}
   */
  async getMyChannel_SampleResultLoader(payload = {}) {
    const criteria = payload?.criteria || {}
    const parts = Array.isArray(criteria.parts) && criteria.parts.length
      ? criteria.parts
      : ['snippet', 'statistics', 'contentDetails', 'brandingSettings']

    const channel = { kind: 'youtube#channel', etag: 'sample', id: 'UCsamplechannel123456789' }

    if (parts.includes('snippet')) {
      channel.snippet = {
        title: 'My Sample Channel',
        description: 'Welcome to my channel.',
        customUrl: '@samplechannel',
        publishedAt: '2020-06-01T00:00:00Z',
        thumbnails: { default: { url: 'https://yt3.ggpht.com/sample/default.jpg' } },
        country: 'US',
      }
    }

    if (parts.includes('statistics')) {
      channel.statistics = { viewCount: '125000', subscriberCount: '500', hiddenSubscriberCount: false, videoCount: '42' }
    }

    if (parts.includes('contentDetails')) {
      channel.contentDetails = { relatedPlaylists: { likes: '', uploads: 'UUsamplechannel123456789' } }
    }

    if (parts.includes('brandingSettings')) {
      channel.brandingSettings = { channel: { title: 'My Sample Channel', description: 'Welcome to my channel.', keywords: 'sample tutorials', country: 'US' } }
    }

    if (parts.includes('status')) {
      channel.status = { privacyStatus: 'public', isLinked: true, longUploadsStatus: 'allowed' }
    }

    return channel
  }

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /getChannel_SampleResultLoader
   * @paramDef {"type":"Object","label":"payload","name":"payload"}
   * @returns {Object}
   */
  async getChannel_SampleResultLoader(payload = {}) {
    return this.getMyChannel_SampleResultLoader(payload)
  }

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /runAnalyticsQuery_SampleResultLoader
   * @paramDef {"type":"Object","label":"payload","name":"payload"}
   * @returns {Object}
   */
  async runAnalyticsQuery_SampleResultLoader(payload = {}) {
    const criteria = payload?.criteria || {}

    const metrics = (criteria.metrics || 'views,estimatedMinutesWatched')
      .split(',').map(s => s.trim()).filter(Boolean)

    const dimensions = (criteria.dimensions || '')
      .split(',').map(s => s.trim()).filter(Boolean)

    const columnHeaders = [
      ...dimensions.map(d => ({ name: d, columnType: 'DIMENSION', dataType: 'STRING' })),
      ...metrics.map(m => ({ name: m, columnType: 'METRIC', dataType: 'INTEGER' })),
    ]

    const sampleDimValue = dim => {
      if (dim === 'day') return '2025-01-01'
      if (dim === 'month') return '2025-01'
      if (dim === 'video') return 'dQw4w9WgXcQ'
      if (dim === 'channel') return 'UCsamplechannel123'
      if (dim === 'country') return 'US'
      if (dim === 'ageGroup') return 'age25-34'
      if (dim === 'gender') return 'male'
      if (dim === 'deviceType') return 'MOBILE'
      if (dim === 'operatingSystem') return 'IOS'
      if (dim === 'insightTrafficSourceType') return 'YT_SEARCH'

      return 'sample'
    }

    const sampleMetricValue = (metric, idx) => {
      const base = 1000 - (idx * 100)

      if (metric.includes('Revenue') || metric === 'cpm') return Math.round(base * 0.01 * 100) / 100
      if (metric.includes('Percentage') || metric === 'audienceWatchRatio') return 50 + idx * 5
      if (metric === 'averageViewDuration') return 120 + idx * 10

      return base
    }

    const rowCount = dimensions.length ? Math.min(3, 3) : 1

    const rows = Array.from({ length: rowCount }, (_, i) => [
      ...dimensions.map(d => sampleDimValue(d)),
      ...metrics.map(m => sampleMetricValue(m, i)),
    ])

    const result = { kind: 'youtubeAnalytics#resultTable', columnHeaders, rows }

    if (criteria.flatten) {
      return rows.map(row => {
        const obj = {}

        for (let i = 0; i < columnHeaders.length; i++) {
          obj[columnHeaders[i].name] = row[i]
        }

        return obj
      })
    }

    return result
  }

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /getReport_SampleResultLoader
   * @paramDef {"type":"Object","label":"payload","name":"payload"}
   * @returns {Object}
   */
  async getReport_SampleResultLoader(payload = {}) {
    const out = (payload?.criteria?.outputFormat || 'metadata').toLowerCase()

    const meta = {
      id: 'sample_report_id',
      jobId: 'sample_job_id',
      startTime: '2025-01-14T00:00:00Z',
      endTime: '2025-01-15T00:00:00Z',
      createTime: '2025-01-15T05:00:00Z',
      downloadUrl: 'https://youtubereporting.googleapis.com/v1/media/...',
      jobExpireTime: '2026-01-15T00:00:00Z',
    }

    if (out === 'raw') {
      return {
        ...meta,
        outputFormat: 'raw',
        content: 'date,channel_id,video_id,views,estimated_minutes_watched\n2025-01-14,UCabc,vid1,1234,5670\n2025-01-14,UCabc,vid2,890,2100\n',
      }
    }

    if (out === 'parsed') {
      return {
        ...meta,
        outputFormat: 'parsed',
        rows: [
          { date: '2025-01-14', channel_id: 'UCabc', video_id: 'vid1', views: '1234', estimated_minutes_watched: '5670' },
          { date: '2025-01-14', channel_id: 'UCabc', video_id: 'vid2', views: '890', estimated_minutes_watched: '2100' },
        ],
      }
    }

    return meta
  }

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /searchVideos_SampleResultLoader
   * @paramDef {"type":"Object","label":"payload","name":"payload"}
   * @returns {Object}
   */
  async searchVideos_SampleResultLoader(payload = {}) {
    const criteria = payload?.criteria || {}

    const item = {
      kind: 'youtube#searchResult',
      etag: 'sample',
      id: { kind: 'youtube#video', videoId: 'dQw4w9WgXcQ' },
      snippet: {
        publishedAt: '2025-01-10T10:00:00Z',
        channelId: 'UCsamplechannel123',
        title: 'Sample Video Title',
        description: 'Sample search result description.',
        thumbnails: { default: { url: 'https://i.ytimg.com/vi/ID/default.jpg', width: 120, height: 90 } },
        channelTitle: 'Sample Channel',
        liveBroadcastContent: 'none',
      },
    }

    if (criteria.enrichStatistics) {
      item.statistics = { viewCount: '12345', likeCount: '420', commentCount: '37' }
      item.contentDetails = { duration: 'PT5M30S', definition: 'hd' }
    }

    return {
      kind: 'youtube#searchListResponse',
      etag: 'sample',
      nextPageToken: 'CAUQAA',
      pageInfo: { totalResults: 100, resultsPerPage: 5 },
      items: [item],
    }
  }
}

// =============================== 18 SERVICE REGISTRATION ===============================

Flowrunner.ServerCode.addService(YouTubeService, [
  {
    shared: true,
    displayName: 'Client Id',
    defaultValue: '',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Your OAuth 2.0 Client ID from the Google Cloud Console (APIs & Services > Credentials).',
  },
  {
    shared: true,
    displayName: 'Client Secret',
    defaultValue: '',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Your OAuth 2.0 Client Secret from the Google Cloud Console (APIs & Services > Credentials).',
  },
  {
    shared: false,
    displayName: 'Enable Revenue Analytics',
    defaultValue: false,
    name: 'enableRevenueAnalytics',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.BOOL,
    required: false,
    hint: 'When enabled, requests yt-analytics-monetary.readonly scope so revenue metrics are available. Requires app verification by Google for production. Triggers re-authentication.',
  },
  {
    shared: false,
    displayName: 'Default Region',
    defaultValue: 'US',
    name: 'defaultRegion',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    hint: 'ISO 3166-1 alpha-2 country code used as fallback when a method needs a region but none is supplied (e.g., List Popular Videos, Search). Per-call values still override.',
  },
  {
    shared: false,
    displayName: 'Default Language',
    defaultValue: 'en',
    name: 'defaultLanguage',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    hint: 'BCP-47 language code (e.g., en, es, fr) used as fallback for Caption Upload, search relevance language, video defaultLanguage, and channel branding language.',
  },
])
