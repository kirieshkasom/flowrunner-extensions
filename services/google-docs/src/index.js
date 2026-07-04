'use strict'

// =====================================================================
// Google Docs FlowRunner Extension
//
// Docs API v1 is only 3 endpoints (documents.{get, create, batchUpdate});
// everything else (list/copy/export/import/share/comments/revisions/triggers)
// rides on Drive v3. This file orchestrates both behind one OAuth flow.
//
// TOC:
//   1  Imports & init
//   2  OAuth + system methods (5)
//   3  Internal helpers (#getAccessToken, #docsRequest, #driveRequest,
//        #ensureDocId, #batchUpdate, #loadDoc)
//   4  Dictionaries (12)
//   5  Documents — read & shape (8)
//   6  Documents — list & search (5)
//   7  Documents — create / lifecycle (9)
//   8  Text — insert / delete / replace (10)
//   9  Formatting — text + paragraph (10)
//   10 Lists & bullets (3)
//   11 Tables (12)
//   12 Images (4)
//   13 Structure — sections / headers / footers / footnotes / named ranges (12)
//   14 Document-level styles (3)
//   15 Tabs (4)
//   16 Smart inserts — person / rich link / date (3)
//   17 Export / share / revisions (10)
//   18 Comments + replies (5)
//   19 Triggers — polling + realtime (5)
//   20 Sample result loaders (8)
//   21 Service registration
// =====================================================================

const {
  DOCS_API_BASE_URL,
  DRIVE_API_BASE_URL,
  DRIVE_UPLOAD_BASE_URL,
  TOKEN_URL,
  OAUTH_URL,
  USER_INFO_URL,
  DEFAULT_PAGE_SIZE,
  MAX_DICTIONARY_PAGE_SIZE,
  MAX_LIST_PAGE_SIZE,
  buildScopeString,
  GOOGLE_DOC_MIME,
  FOLDER_MIME,
  EXPORT_MIME,
  DOC_FILE_FIELDS,
  DOC_FILE_FIELDS_LIST,
  PARAGRAPH_NAMED_STYLES,
} = require('./constants')

const { logger } = require('./helpers/logger')
const {
  cleanupObject,
  searchFilter,
  clampInt,
  asBool,
  toArray,
  ensureRfc3339,
} = require('./helpers/utils')
const { apiRequest } = require('./helpers/http')
const { paginateAll } = require('./helpers/pagination')
const {
  extractDocId,
  extractFolderId,
} = require('./helpers/resolver')
const {
  chunkRequests,
  buildLocation,
  buildRange,
  withTabsCriteria,
} = require('./helpers/batch')
const {
  buildTextStyle,
  buildParagraphStyle,
  bulletPreset,
  BULLET_PRESETS,
  normalizeSectionType,
  normalizeImageReplaceMethod,
  normalizeAlignment,
  normalizeOrientation,
} = require('./helpers/style')
const {
  iterSegments,
  extractHeadings,
  extractTables,
  extractImages,
  extractNamedRanges,
  appendIndex,
} = require('./helpers/segments')
const {
  toPlainText,
  toMarkdown,
  toHtml,
  countWords,
} = require('./helpers/extractor')

// Polling triggers page through Drive results so bursts larger than one page are not
// dropped. Each poll is bounded to TRIGGER_MAX_PAGES * TRIGGER_PAGE_SIZE documents so the
// 60s trigger timeout is never at risk; in normal operation the watermark sits on page 1.
const TRIGGER_PAGE_SIZE = 100
const TRIGGER_MAX_PAGES = 10

// =============================== 1 INIT ===============================

/**
 * @requireOAuth
 * @integrationName Google Docs
 * @integrationIcon /icon.png
 * @integrationTriggersScope SINGLE_APP
 * @usesFileStorage
 **/
class GoogleDocsService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret

    // Default behaviors callers may override per-method.
    this.defaultFolderId = config.defaultFolderId || null
    this.includeTabsByDefault = config.includeTabsByDefault !== false

    this.scopes = buildScopeString()
  }

  // =============================== 3 INTERNAL HELPERS ===============================

  #getAccessToken(accessToken) {
    return accessToken || this.request?.headers?.['oauth-access-token']
  }

  #getAccessTokenHeader(accessToken) {
    return { Authorization: `Bearer ${ this.#getAccessToken(accessToken) }` }
  }

  async #docsRequest(opts) {
    return apiRequest({ ...opts, authHeader: this.#getAccessTokenHeader() })
  }

  async #driveRequest(opts) {
    const query = { ...(opts.query || {}) }

    if (!('supportsAllDrives' in query) && !opts.omitAllDrives) {
      query.supportsAllDrives = 'true'
    }

    return apiRequest({
      ...opts,
      query,
      authHeader: this.#getAccessTokenHeader(),
    })
  }

  /**
   * Pages through the Drive files.list endpoint for polling triggers, calling
   * `onPage(files, pageIndex)` per page. `onPage` returns true to stop early once the
   * watermark is reached, so a quiet poll costs a single request. Bounded to
   * TRIGGER_MAX_PAGES pages to keep every poll inside the trigger timeout.
   */
  async #listDocsPaged({ logTag, query, onPage }) {
    let pageToken

    for (let page = 0; page < TRIGGER_MAX_PAGES; page++) {
      const response = await this.#driveRequest({
        logTag,
        url: `${ DRIVE_API_BASE_URL }/files`,
        query: pageToken ? { ...query, pageToken } : query,
      })
      const stop = onPage(response.files || [], page)

      if (stop || !response.nextPageToken) break

      pageToken = response.nextPageToken
    }
  }

  #ensureDocId(input) {
    if (!input) throw new Error('Document ID is required')

    return extractDocId(input)
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /**
   * Submits a list of batchUpdate requests, chunked to keep payloads under the limit.
   * Optionally sorts by descending startIndex to neutralize Docs' index-shift footgun:
   * when you mutate the body, all later indices change, so highest-index-first is the safe order.
   * Returns the merged replies array.
   */
  async #batchUpdate(
    documentId,
    requests,
    { writeControl, sortDescending = true } = {}
  ) {
    const docId = this.#ensureDocId(documentId)

    const filtered = (requests || []).filter(Boolean)

    if (!filtered.length) {
      return { documentId: docId, replies: [], writeControl }
    }

    const ordered = sortDescending ? sortByDescendingIndex(filtered) : filtered
    const chunks = chunkRequests(ordered)
    const allReplies = []

    for (const chunk of chunks) {
      const body = writeControl ? { ...chunk, writeControl } : chunk

      const response = await this.#docsRequest({
        logTag: 'batchUpdate',
        method: 'post',
        url: `${ DOCS_API_BASE_URL }/documents/${ docId }:batchUpdate`,
        body,
      })

      if (Array.isArray(response.replies)) allReplies.push(...response.replies)
    }

    return { documentId: docId, replies: allReplies }
  }

  async #loadDoc(documentId, { includeTabsContent, suggestionsViewMode } = {}) {
    const docId = this.#ensureDocId(documentId)
    const includeTabs =
      includeTabsContent === undefined
        ? this.includeTabsByDefault
        : asBool(includeTabsContent) !== false

    return this.#docsRequest({
      logTag: 'loadDoc',
      url: `${ DOCS_API_BASE_URL }/documents/${ docId }`,
      query: cleanupObject({
        includeTabsContent: includeTabs ? 'true' : undefined,
        suggestionsViewMode,
      }),
    })
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

    logger.debug(`composed connectionURL: ${ connectionURL.slice(0, 120) }...`)

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
    let connectionIdentityName = 'Google Docs User'
    let connectionIdentityImageURL = null

    try {
      userData = await Flowrunner.Request.get(USER_INFO_URL).set(
        this.#getAccessTokenHeader(codeExchangeResponse.access_token)
      )

      if (userData.name || userData.email) {
        connectionIdentityName = userData.name
          ? `${ userData.name } (${ userData.email })`
          : userData.email
      }

      connectionIdentityImageURL = userData.picture || null
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
      const { access_token, expires_in } = await Flowrunner.Request.post(
        TOKEN_URL
      )
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .query({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        })

      return { token: access_token, expirationInSeconds: expires_in }
    } catch (error) {
      logger.error(`refreshToken error: ${ error.message }`)

      if (error.body?.error === 'invalid_grant') {
        throw new Error(
          'Refresh token expired or invalid, please re-authenticate.'
        )
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

  /**
   * @operationName Test Connection
   * @category System
   * @description Verifies the Google connection works by reading the signed-in user's profile. Use this to confirm the integration is wired up.
   *
   * @route POST /test-connection
   *
   * @returns {Object}
   * @sampleResult {"ok":true,"email":"user@example.com","name":"Sample User","picture":"https://example.com/photo.jpg"}
   */
  async testConnection() {
    const userData = await this.#docsRequest({
      logTag: 'testConnection',
      url: USER_INFO_URL,
    })

    return {
      ok: true,
      email: userData?.email || null,
      name: userData?.name || null,
      picture: userData?.picture || null,
    }
  }

  // =============================== 4 DICTIONARIES ===============================

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
   * @typedef {Object} listDocumentsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring filter (matches document name)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for next page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Documents
   * @description Returns Google Docs the connected account can access. Use this to populate document parameters across the service.
   *
   * @route POST /list-documents-dictionary
   *
   * @paramDef {"type":"listDocumentsDictionary__payload","label":"Payload","name":"payload","description":"Optional search and pagination."}
   *
   * @sampleResult {"items":[{"label":"Q3 Plan","note":"Modified 2025-01-10","value":"1aBC..."}],"cursor":null}
   * @returns {DictionaryResponse}
   */
  async listDocumentsDictionary(payload) {
    const { search, cursor } = payload || {}

    const q = [
      `mimeType='${ GOOGLE_DOC_MIME }'`,
      'trashed=false',
      search ? `name contains '${ String(search).replace(/'/g, "\\'") }'` : null,
    ]
      .filter(Boolean)
      .join(' and ')

    const response = await this.#driveRequest({
      logTag: 'listDocumentsDictionary',
      url: `${ DRIVE_API_BASE_URL }/files`,
      query: {
        q,
        pageSize: MAX_DICTIONARY_PAGE_SIZE,
        pageToken: cursor,
        fields: 'nextPageToken,files(id,name,modifiedTime)',
        includeItemsFromAllDrives: 'true',
        corpora: 'allDrives',
        orderBy: 'modifiedTime desc',
      },
    })

    const items = (response.files || []).map(f => ({
      label: f.name || f.id,
      value: f.id,
      note: f.modifiedTime
        ? `Modified ${ f.modifiedTime.slice(0, 10) }`
        : `ID: ${ f.id }`,
    }))

    return { items, cursor: response.nextPageToken || null }
  }

  /**
   * @typedef {Object} listFoldersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring filter (matches folder name)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for next page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Folders
   * @description Returns Drive folders the connected account can see. Use this when picking where to create or move a document.
   *
   * @route POST /list-folders-dictionary
   *
   * @paramDef {"type":"listFoldersDictionary__payload","label":"Payload","name":"payload","description":"Optional search and pagination."}
   *
   * @sampleResult {"items":[{"label":"Reports","note":"ID: 1abc...","value":"1abc..."}],"cursor":null}
   * @returns {DictionaryResponse}
   */
  async listFoldersDictionary(payload) {
    const { search, cursor } = payload || {}

    const q = [
      `mimeType='${ FOLDER_MIME }'`,
      'trashed=false',
      search ? `name contains '${ String(search).replace(/'/g, "\\'") }'` : null,
    ]
      .filter(Boolean)
      .join(' and ')

    const response = await this.#driveRequest({
      logTag: 'listFoldersDictionary',
      url: `${ DRIVE_API_BASE_URL }/files`,
      query: {
        q,
        pageSize: MAX_DICTIONARY_PAGE_SIZE,
        pageToken: cursor,
        fields: 'nextPageToken,files(id,name,parents)',
        includeItemsFromAllDrives: 'true',
        corpora: 'allDrives',
      },
    })

    const items = [
      ...(cursor
        ? []
        : [
          {
            label: 'My Drive (root)',
            value: 'root',
            note: 'Top-level personal drive',
          },
        ]),
      ...(response.files || []).map(f => ({
        label: f.name || f.id,
        value: f.id,
        note: `ID: ${ f.id }`,
      })),
    ]

    return {
      items: search ? searchFilter(items, ['label'], search) : items,
      cursor: response.nextPageToken || null,
    }
  }

  /**
   * @typedef {Object} listTabsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"Document whose tabs you want to list."}
   */

  /**
   * @typedef {Object} listTabsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring filter on tab title."}
   * @paramDef {"type":"listTabsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Source document."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Tabs In Document
   * @description Returns the tabs of a document. Use this when picking which tab an operation should target. Single-tab docs return one entry ("Tab 1") so workflows stay consistent.
   *
   * @route POST /list-tabs-dictionary
   *
   * @paramDef {"type":"listTabsDictionary__payload","label":"Payload","name":"payload","description":"Document + optional filter."}
   *
   * @sampleResult {"items":[{"label":"Overview","note":"index 0","value":"t.0"}],"cursor":null}
   * @returns {DictionaryResponse}
   */
  async listTabsDictionary(payload) {
    const documentId = payload?.criteria?.documentId

    if (!documentId) return { items: [], cursor: null }

    let document

    try {
      document = await this.#loadDoc(documentId, { includeTabsContent: true })
    } catch (error) {
      logger.warn(`listTabsDictionary: load failed: ${ error.message }`)

      return { items: [], cursor: null }
    }

    const tabs = flattenTabs(document.tabs || [])
    let items = tabs.length
      ? tabs.map(t => ({
        label: t.title || t.tabId,
        value: t.tabId,
        note: `index ${ t.index ?? 0 }${ t.parentTabId ? ` · child of ${ t.parentTabId }` : '' }`,
      }))
      : [{ label: 'Tab 1', value: 't.0', note: 'Single-tab document' }]

    if (payload?.search) items = searchFilter(items, ['label'], payload.search)

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} listNamedRangesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"Document whose named ranges you want to list."}
   */

  /**
   * @typedef {Object} listNamedRangesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring filter."}
   * @paramDef {"type":"listNamedRangesDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Source document."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Named Ranges
   * @description Returns named ranges defined in a document — these are stable anchors that survive collaborative edits. Use them when repeatedly inserting or replacing content at the same logical spot.
   *
   * @route POST /list-named-ranges-dictionary
   *
   * @paramDef {"type":"listNamedRangesDictionary__payload","label":"Payload","name":"payload","description":"Document + optional filter."}
   *
   * @sampleResult {"items":[{"label":"summary","note":"50 characters","value":"summary"}],"cursor":null}
   * @returns {DictionaryResponse}
   */
  async listNamedRangesDictionary(payload) {
    const documentId = payload?.criteria?.documentId

    if (!documentId) return { items: [], cursor: null }

    let document

    try {
      document = await this.#loadDoc(documentId, { includeTabsContent: true })
    } catch (error) {
      logger.warn(`listNamedRangesDictionary: load failed: ${ error.message }`)

      return { items: [], cursor: null }
    }

    const ranges = extractNamedRanges(document)
    const grouped = new Map()

    for (const r of ranges) {
      if (!grouped.has(r.name)) {
        grouped.set(r.name, { name: r.name, ids: new Set(), totalLength: 0 })
      }

      const entry = grouped.get(r.name)

      entry.ids.add(r.namedRangeId)

      entry.totalLength += Math.max(0, (r.endIndex || 0) - (r.startIndex || 0))
    }

    let items = Array.from(grouped.values()).map(g => ({
      label: g.name,
      value: g.name,
      note: `${ g.totalLength } characters`,
    }))

    if (payload?.search) items = searchFilter(items, ['label'], payload.search)

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} listHeadingsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"Document whose headings you want to list."}
   */

  /**
   * @typedef {Object} listHeadingsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring filter on heading text."}
   * @paramDef {"type":"listHeadingsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Source document."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Headings
   * @description Returns headings (Heading 1–6, Title, Subtitle) extracted from a document's outline. Use this when navigating or targeting sections of a doc.
   *
   * @route POST /list-headings-dictionary
   *
   * @paramDef {"type":"listHeadingsDictionary__payload","label":"Payload","name":"payload","description":"Document + optional filter."}
   *
   * @sampleResult {"items":[{"label":"Introduction","note":"Heading 1 · index 1","value":"1"}],"cursor":null}
   * @returns {DictionaryResponse}
   */
  async listHeadingsDictionary(payload) {
    const documentId = payload?.criteria?.documentId

    if (!documentId) return { items: [], cursor: null }

    let document

    try {
      document = await this.#loadDoc(documentId, { includeTabsContent: true })
    } catch (error) {
      logger.warn(`listHeadingsDictionary: load failed: ${ error.message }`)

      return { items: [], cursor: null }
    }

    const headings = extractHeadings(document)
    let items = headings.map(h => ({
      label: h.text || `(empty ${ h.namedStyleType })`,
      value: String(h.startIndex),
      note: `${ h.namedStyleType.replace('HEADING_', 'Heading ') } · position ${ h.startIndex }`,
    }))

    if (payload?.search) items = searchFilter(items, ['label'], payload.search)

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} listImagesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"Document whose inline images you want to list."}
   */

  /**
   * @typedef {Object} listImagesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring filter on image title or description."}
   * @paramDef {"type":"listImagesDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Source document."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Inline Images
   * @description Returns inline images embedded in a document. Use this for "Replace Image" workflows.
   *
   * @route POST /list-images-dictionary
   *
   * @paramDef {"type":"listImagesDictionary__payload","label":"Payload","name":"payload","description":"Document + optional filter."}
   *
   * @sampleResult {"items":[{"label":"logo.png","note":"position 100","value":"img-001"}],"cursor":null}
   * @returns {DictionaryResponse}
   */
  async listImagesDictionary(payload) {
    const documentId = payload?.criteria?.documentId

    if (!documentId) return { items: [], cursor: null }

    let document

    try {
      document = await this.#loadDoc(documentId, { includeTabsContent: true })
    } catch (error) {
      logger.warn(`listImagesDictionary: load failed: ${ error.message }`)

      return { items: [], cursor: null }
    }

    const images = extractImages(document)
    let items = images.map((img, i) => ({
      label: img.title || `Image ${ i + 1 }`,
      value: img.inlineObjectId,
      note: img.description
        ? `${ img.description.slice(0, 40) } · position ${ img.startIndex }`
        : `position ${ img.startIndex }`,
    }))

    if (payload?.search)
      items = searchFilter(items, ['label', 'note'], payload.search)

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} listHeadersFootersDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"Document whose headers/footers you want to list."}
   */

  /**
   * @typedef {Object} listHeadersFootersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional filter."}
   * @paramDef {"type":"listHeadersFootersDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Source document."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Headers & Footers
   * @description Returns the headers and footers defined in a document. Pick from here when you want an edit to apply to the header or footer of a document instead of the body.
   *
   * @route POST /list-headers-footers-dictionary
   *
   * @paramDef {"type":"listHeadersFootersDictionary__payload","label":"Payload","name":"payload","description":"Document plus optional filter."}
   *
   * @sampleResult {"items":[{"label":"Header","note":"header","value":"hdr-001"}],"cursor":null}
   * @returns {DictionaryResponse}
   */
  async listHeadersFootersDictionary(payload) {
    const documentId = payload?.criteria?.documentId

    if (!documentId) return { items: [], cursor: null }

    let document

    try {
      document = await this.#loadDoc(documentId, { includeTabsContent: true })
    } catch (error) {
      logger.warn(
        `listHeadersFootersDictionary: load failed: ${ error.message }`
      )

      return { items: [], cursor: null }
    }

    const items = []
    let headerCount = 0
    let footerCount = 0

    for (const seg of iterSegments(document)) {
      if (seg.kind === 'header') {
        headerCount++

        items.push({
          label: headerCount === 1 ? 'Header' : `Header ${ headerCount }`,
          value: seg.segmentId,
          note: 'Header (repeats on every page)',
        })
      } else if (seg.kind === 'footer') {
        footerCount++

        items.push({
          label: footerCount === 1 ? 'Footer' : `Footer ${ footerCount }`,
          value: seg.segmentId,
          note: 'Footer (repeats on every page)',
        })
      }
    }

    const filtered = payload?.search
      ? searchFilter(items, ['label'], payload.search)
      : items

    return { items: filtered, cursor: null }
  }

  /**
   * @typedef {Object} listExportFormatsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional filter."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Export Formats
   * @description Returns formats a Google Doc can be exported to (PDF, DOCX, HTML, Markdown, ODT, RTF, plain text, EPUB).
   *
   * @route POST /list-export-formats-dictionary
   *
   * @paramDef {"type":"listExportFormatsDictionary__payload","label":"Payload","name":"payload","description":"Optional search."}
   *
   * @sampleResult {"items":[{"label":"PDF","note":"application/pdf","value":"application/pdf"}],"cursor":null}
   * @returns {DictionaryResponse}
   */
  async listExportFormatsDictionary({ search } = {}) {
    const items = [
      { label: 'PDF', value: EXPORT_MIME.pdf, note: EXPORT_MIME.pdf },
      { label: 'Word (.docx)', value: EXPORT_MIME.docx, note: 'Doc → .docx' },
      { label: 'Markdown', value: EXPORT_MIME.markdown, note: 'Doc → .md' },
      { label: 'HTML', value: EXPORT_MIME.html, note: 'Doc → .html' },
      { label: 'Plain text', value: EXPORT_MIME.txt, note: 'Doc → .txt' },
      { label: 'RTF', value: EXPORT_MIME.rtf, note: 'Doc → .rtf' },
      {
        label: 'OpenDocument Text',
        value: EXPORT_MIME.odt,
        note: 'Doc → .odt',
      },
      { label: 'EPUB', value: EXPORT_MIME.epub, note: 'Doc → .epub' },
      {
        label: 'ZIP (HTML bundle)',
        value: EXPORT_MIME.zippedHtml,
        note: 'Doc → zipped HTML',
      },
    ]

    return {
      items: search ? searchFilter(items, ['label', 'value'], search) : items,
      cursor: null,
    }
  }

  /**
   * @typedef {Object} listBulletPresetsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional filter."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Bullet & Numbering Presets
   * @description Returns bullet/numbering style presets for list operations. Pick a preset value when applying bullets.
   *
   * @route POST /list-bullet-presets-dictionary
   *
   * @paramDef {"type":"listBulletPresetsDictionary__payload","label":"Payload","name":"payload","description":"Optional search."}
   *
   * @sampleResult {"items":[{"label":"Bulleted","note":"BULLET_DISC_CIRCLE_SQUARE","value":"BULLET_DISC_CIRCLE_SQUARE"}],"cursor":null}
   * @returns {DictionaryResponse}
   */
  async listBulletPresetsDictionary({ search } = {}) {
    const items = [
      {
        label: 'Bulleted',
        value: BULLET_PRESETS.bulleted,
        note: BULLET_PRESETS.bulleted,
      },
      {
        label: 'Bulleted (arrows)',
        value: BULLET_PRESETS.bulletedArrow,
        note: BULLET_PRESETS.bulletedArrow,
      },
      {
        label: 'Checklist',
        value: BULLET_PRESETS.bulletedChecklist,
        note: BULLET_PRESETS.bulletedChecklist,
      },
      {
        label: 'Numbered (1. a. i.)',
        value: BULLET_PRESETS.numbered,
        note: BULLET_PRESETS.numbered,
      },
      {
        label: 'Numbered with parens',
        value: BULLET_PRESETS.numberedParens,
        note: BULLET_PRESETS.numberedParens,
      },
      {
        label: 'Numbered nested (1.1.1)',
        value: BULLET_PRESETS.numberedNested,
        note: BULLET_PRESETS.numberedNested,
      },
      {
        label: 'Upper alpha (A. B. C.)',
        value: BULLET_PRESETS.upperAlpha,
        note: BULLET_PRESETS.upperAlpha,
      },
      {
        label: 'Upper roman (I. II. III.)',
        value: BULLET_PRESETS.upperRoman,
        note: BULLET_PRESETS.upperRoman,
      },
    ]

    return {
      items: search ? searchFilter(items, ['label', 'value'], search) : items,
      cursor: null,
    }
  }

  /**
   * @typedef {Object} listNamedStylesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional filter."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Named Styles
   * @description Returns paragraph named styles available in Docs (Normal text, Title, Subtitle, Heading 1–6). Use when applying or updating paragraph style.
   *
   * @route POST /list-named-styles-dictionary
   *
   * @paramDef {"type":"listNamedStylesDictionary__payload","label":"Payload","name":"payload","description":"Optional search."}
   *
   * @sampleResult {"items":[{"label":"Heading 1","note":"HEADING_1","value":"HEADING_1"}],"cursor":null}
   * @returns {DictionaryResponse}
   */
  async listNamedStylesDictionary({ search } = {}) {
    const items = PARAGRAPH_NAMED_STYLES.map(s => ({
      label: s
        .replace('_', ' ')
        .toLowerCase()
        .replace(/\b\w/g, c => c.toUpperCase()),
      value: s,
      note: s,
    }))

    return {
      items: search ? searchFilter(items, ['label', 'value'], search) : items,
      cursor: null,
    }
  }

  /**
   * @typedef {Object} listParagraphAlignmentsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional filter."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Paragraph Alignments
   * @description Returns paragraph alignment options (start, center, end, justified).
   *
   * @route POST /list-paragraph-alignments-dictionary
   *
   * @paramDef {"type":"listParagraphAlignmentsDictionary__payload","label":"Payload","name":"payload","description":"Optional search."}
   *
   * @sampleResult {"items":[{"label":"Start (left)","note":"START","value":"START"}],"cursor":null}
   * @returns {DictionaryResponse}
   */
  async listParagraphAlignmentsDictionary({ search } = {}) {
    const items = [
      {
        label: 'Start (left)',
        value: 'START',
        note: 'Left in LTR, right in RTL',
      },
      { label: 'Center', value: 'CENTER', note: 'Centered' },
      { label: 'End (right)', value: 'END', note: 'Right in LTR, left in RTL' },
      { label: 'Justified', value: 'JUSTIFIED', note: 'Both edges aligned' },
    ]

    return {
      items: search ? searchFilter(items, ['label', 'value'], search) : items,
      cursor: null,
    }
  }

  /**
   * @typedef {Object} listSuggestionsViewModeDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional filter."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Suggestion View Options
   * @description Returns the different ways suggested edits (tracked changes) can appear when reading a document. Pick how you want suggestions to show up in the response. Note: this service can read suggestions but cannot accept or reject them.
   *
   * @route POST /list-suggestions-view-mode-dictionary
   *
   * @paramDef {"type":"listSuggestionsViewModeDictionary__payload","label":"Payload","name":"payload","description":"Optional search."}
   *
   * @sampleResult {"items":[{"label":"Suggestions inline","note":"SUGGESTIONS_INLINE","value":"SUGGESTIONS_INLINE"}],"cursor":null}
   * @returns {DictionaryResponse}
   */
  async listSuggestionsViewModeDictionary({ search } = {}) {
    const items = [
      {
        label: 'Default',
        value: 'DEFAULT_FOR_CURRENT_ACCESS',
        note: 'Google picks the right view based on your access level.',
      },
      {
        label: 'Show suggestions as marked-up edits',
        value: 'SUGGESTIONS_INLINE',
        note: 'Each suggestion appears in the response with markers showing what was proposed.',
      },
      {
        label: 'Preview as if suggestions were accepted',
        value: 'PREVIEW_SUGGESTIONS_ACCEPTED',
        note: 'Returns the document as it would look if every suggestion were accepted.',
      },
      {
        label: 'Preview as if suggestions were rejected',
        value: 'PREVIEW_WITHOUT_SUGGESTIONS',
        note: 'Returns the document as it would look if every suggestion were rejected.',
      },
    ]

    return {
      items: search ? searchFilter(items, ['label', 'value'], search) : items,
      cursor: null,
    }
  }

  /**
   * @typedef {Object} listTablesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"Document whose tables you want to list."}
   */

  /**
   * @typedef {Object} listTablesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional filter on table description."}
   * @paramDef {"type":"listTablesDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Source document."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Tables In Document
   * @description Returns the tables in a document and the character position where each one starts. Use this any time a table action asks for the "Table Start Position" — pick from the list instead of looking up positions yourself.
   *
   * @route POST /list-tables-dictionary
   *
   * @paramDef {"type":"listTablesDictionary__payload","label":"Payload","name":"payload","description":"Document plus optional filter."}
   *
   * @sampleResult {"items":[{"label":"Table 1 (3 × 4)","note":"position 120","value":"120"}],"cursor":null}
   * @returns {DictionaryResponse}
   */
  async listTablesDictionary(payload) {
    const documentId = payload?.criteria?.documentId

    if (!documentId) return { items: [], cursor: null }

    let document

    try {
      document = await this.#loadDoc(documentId, { includeTabsContent: true })
    } catch (error) {
      logger.warn(`listTablesDictionary: load failed: ${ error.message }`)

      return { items: [], cursor: null }
    }

    const tables = extractTables(document)
    let items = tables.map((t, i) => ({
      label: `Table ${ i + 1 } (${ t.rows } × ${ t.columns })`,
      value: String(t.startIndex),
      note: `${ t.rows } row${ t.rows === 1 ? '' : 's' }, ${ t.columns } column${ t.columns === 1 ? '' : 's' } · position ${ t.startIndex }`,
    }))

    if (payload?.search) items = searchFilter(items, ['label', 'note'], payload.search)

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} listCommentsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"Document whose comments you want to list."}
   */

  /**
   * @typedef {Object} listCommentsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional filter on the comment text."}
   * @paramDef {"type":"listCommentsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Source document."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Comments In Document
   * @description Returns the comments on a document so you can pick one for actions like Reply, Resolve, or Delete.
   *
   * @route POST /list-comments-dictionary
   *
   * @paramDef {"type":"listCommentsDictionary__payload","label":"Payload","name":"payload","description":"Document plus optional filter."}
   *
   * @sampleResult {"items":[{"label":"Please review (Sample User)","note":"unresolved · 2025-01-10","value":"comment-001"}],"cursor":null}
   * @returns {DictionaryResponse}
   */
  async listCommentsDictionary(payload) {
    const documentId = payload?.criteria?.documentId

    if (!documentId) return { items: [], cursor: null }

    let response

    try {
      response = await this.#driveRequest({
        logTag: 'listCommentsDictionary',
        url: `${ DRIVE_API_BASE_URL }/files/${ extractDocId(documentId) }/comments`,
        query: {
          pageSize: MAX_DICTIONARY_PAGE_SIZE,
          fields: 'comments(id,content,resolved,createdTime,author/displayName,deleted)',
        },
      })
    } catch (error) {
      logger.warn(`listCommentsDictionary: load failed: ${ error.message }`)

      return { items: [], cursor: null }
    }

    let items = (response.comments || [])
      .filter(c => !c.deleted)
      .map(c => {
        const preview = (c.content || '').replace(/\s+/g, ' ').slice(0, 60)
        const author = c.author?.displayName ? ` (${ c.author.displayName })` : ''

        return {
          label: `${ preview || '(empty)' }${ author }`,
          value: c.id,
          note: `${ c.resolved ? 'resolved' : 'unresolved' } · ${ (c.createdTime || '').slice(0, 10) }`,
        }
      })

    if (payload?.search) items = searchFilter(items, ['label'], payload.search)

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} listDocumentRevisionsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"Document whose past versions you want to list."}
   */

  /**
   * @typedef {Object} listDocumentRevisionsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional filter."}
   * @paramDef {"type":"listDocumentRevisionsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Source document."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Document Versions
   * @description Returns the saved versions (revisions) of a document. Pick a version when you want to export an older copy or compare changes over time.
   *
   * @route POST /list-document-revisions-dictionary
   *
   * @paramDef {"type":"listDocumentRevisionsDictionary__payload","label":"Payload","name":"payload","description":"Document plus optional filter."}
   *
   * @sampleResult {"items":[{"label":"Version 5 · Sample User","note":"2025-01-10","value":"5"}],"cursor":null}
   * @returns {DictionaryResponse}
   */
  async listDocumentRevisionsDictionary(payload) {
    const documentId = payload?.criteria?.documentId

    if (!documentId) return { items: [], cursor: null }

    let response

    try {
      response = await this.#driveRequest({
        logTag: 'listDocumentRevisionsDictionary',
        url: `${ DRIVE_API_BASE_URL }/files/${ extractDocId(documentId) }/revisions`,
        query: {
          pageSize: MAX_DICTIONARY_PAGE_SIZE,
          fields: 'revisions(id,modifiedTime,lastModifyingUser/displayName)',
        },
      })
    } catch (error) {
      logger.warn(`listDocumentRevisionsDictionary: load failed: ${ error.message }`)

      return { items: [], cursor: null }
    }

    let items = (response.revisions || []).map(r => ({
      label: `Version ${ r.id }${ r.lastModifyingUser?.displayName ? ` · ${ r.lastModifyingUser.displayName }` : '' }`,
      value: r.id,
      note: (r.modifiedTime || '').slice(0, 10),
    }))

    if (payload?.search) items = searchFilter(items, ['label'], payload.search)

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} listDocumentPermissionsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"Document whose sharing permissions you want to list."}
   */

  /**
   * @typedef {Object} listDocumentPermissionsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional filter on email or name."}
   * @paramDef {"type":"listDocumentPermissionsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Source document."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Document Sharing Permissions
   * @description Returns who currently has access to a document. Pick a person/group/domain when you want to remove their access.
   *
   * @route POST /list-document-permissions-dictionary
   *
   * @paramDef {"type":"listDocumentPermissionsDictionary__payload","label":"Payload","name":"payload","description":"Document plus optional filter."}
   *
   * @sampleResult {"items":[{"label":"sample@example.com — Editor","note":"user","value":"perm-001"}],"cursor":null}
   * @returns {DictionaryResponse}
   */
  async listDocumentPermissionsDictionary(payload) {
    const documentId = payload?.criteria?.documentId

    if (!documentId) return { items: [], cursor: null }

    let response

    try {
      response = await this.#driveRequest({
        logTag: 'listDocumentPermissionsDictionary',
        url: `${ DRIVE_API_BASE_URL }/files/${ extractDocId(documentId) }/permissions`,
        query: { fields: 'permissions(id,type,role,emailAddress,domain,displayName,deleted)' },
      })
    } catch (error) {
      logger.warn(`listDocumentPermissionsDictionary: load failed: ${ error.message }`)

      return { items: [], cursor: null }
    }

    const roleLabel = role => {
      const map = { owner: 'Owner', writer: 'Editor', commenter: 'Commenter', reader: 'Viewer', organizer: 'Organizer', fileOrganizer: 'File organizer' }

      return map[role] || role
    }

    let items = (response.permissions || [])
      .filter(p => !p.deleted)
      .map(p => {
        const who = p.emailAddress || p.domain || p.displayName || p.type
        const label = `${ who } — ${ roleLabel(p.role) }`

        return { label, value: p.id, note: p.type }
      })

    if (payload?.search) items = searchFilter(items, ['label'], payload.search)

    return { items, cursor: null }
  }

  // =============================== 5 DOCUMENTS — READ & SHAPE ===============================

  /**
   * @operationName Get Document (Full Detail)
   * @category Documents
   * @description Returns every piece of a document: text, headings, headers, footers, footnotes, styles, tables, images, labeled sections, suggestions. Use this when you need exact positions for editing, want to copy styling, or are building a workflow that touches multiple parts of the document at once. For just the text or a clean Markdown/HTML version, use Get Document As Plain Text, Markdown, or HTML — those are much smaller and easier to work with.
   *
   * @route POST /get-document
   * @appearanceColor #1a73e8 #4285f4
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"Document to read. Paste a Google Docs link or pick from the list."}
   * @paramDef {"type":"Boolean","label":"Include All Tabs","name":"includeTabsContent","uiComponent":{"type":"TOGGLE"},"description":"On (default): reads content from every tab in the document. Off: reads only the first tab. Turn off for older single-tab documents to keep the response smaller."}
   * @paramDef {"type":"String","label":"Suggestions View","name":"suggestionsViewMode","dictionary":"listSuggestionsViewModeDictionary","description":"How tracked-changes (suggestions) should appear in the response. Pick the default unless you specifically need to preview with or without suggested edits applied."}
   *
   * @returns {Object}
   * @sampleResultLoader { "methodName":"getDocument_SampleResultLoader" }
   */
  async getDocument(documentId, includeTabsContent, suggestionsViewMode) {
    return this.#loadDoc(documentId, {
      includeTabsContent,
      suggestionsViewMode,
    })
  }

  /**
   * @operationName Get Document Metadata
   * @category Documents
   * @description Returns the document's file information: title, owner, folder, sharing status, last modified date, web link. Faster and lighter than Get Document. Use when you only need facts about the document, not its contents — for example to display a list, check who owns it, or build a link.
   *
   * @route POST /get-document-metadata
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to inspect."}
   *
   * @returns {Object}
   * @sampleResultLoader { "methodName":"getDocumentMetadata_SampleResultLoader" }
   */
  async getDocumentMetadata(documentId) {
    const docId = this.#ensureDocId(documentId)

    return this.#driveRequest({
      logTag: 'getDocumentMetadata',
      url: `${ DRIVE_API_BASE_URL }/files/${ docId }`,
      query: { fields: DOC_FILE_FIELDS },
    })
  }

  /**
   * @operationName Get Document As Plain Text
   * @category Documents
   * @description Returns the document's text with all formatting stripped out. Table cells appear on one line separated by " | ". Use when you want just the words — passing to an AI model, searching for content, or saving to a text field — and the styling does not matter.
   *
   * @route POST /get-document-as-plain-text
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"Document to read. Paste a Google Docs link or pick from the list."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Read only this tab of the document. Leave empty to read every tab."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","title":"Sample Doc","text":"Hello world.\nThis is a sample doc.","characters":33,"words":7,"paragraphs":2}
   */
  async getDocumentAsPlainText(documentId, tabId) {
    const document = await this.#loadDoc(documentId, {
      includeTabsContent: true,
    })
    const filtered = tabId ? scopeToTab(document, tabId) : document
    const text = toPlainText(filtered)
    const stats = countWords(filtered)

    return {
      documentId: this.#ensureDocId(documentId),
      title: document.title,
      text,
      characters: stats.characters,
      words: stats.words,
      paragraphs: stats.paragraphs,
    }
  }

  /**
   * @operationName Get Document As Markdown
   * @category Documents
   * @description Returns the document as Markdown. Headings, bold and italic, links, bullet lists, and tables are preserved. Use this when feeding the document to an AI model, posting it to a wiki or static site, or saving to a `.md` file.
   *
   * @route POST /get-document-as-markdown
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"Document to read. Paste a Google Docs link or pick from the list."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Read only this tab. Leave empty to read every tab."}
   * @paramDef {"type":"Boolean","label":"Use Google's Converter","name":"useDriveExport","uiComponent":{"type":"TOGGLE"},"description":"Off (default): converts inside the service — fast, free, supports the Tab filter. On: asks Google to convert, which keeps more layout details but is slower, uses your Google quota, and ignores the Tab filter."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","markdown":"# Title\n\nFirst paragraph."}
   */
  async getDocumentAsMarkdown(documentId, tabId, useDriveExport) {
    const docId = this.#ensureDocId(documentId)

    if (asBool(useDriveExport)) {
      const bytes = await this.#driveExport(docId, EXPORT_MIME.markdown)

      return {
        documentId: docId,
        markdown: bytes.toString('utf8'),
        source: 'drive-export',
      }
    }

    const document = await this.#loadDoc(documentId, {
      includeTabsContent: true,
    })
    const filtered = tabId ? scopeToTab(document, tabId) : document
    const markdown = toMarkdown(filtered)

    return {
      documentId: docId,
      title: document.title,
      markdown,
      source: 'in-extension',
    }
  }

  /**
   * @operationName Get Document As HTML
   * @category Documents
   * @description Returns the document as HTML. Use this when posting the document to a website, sending as a styled email body, or saving as an `.html` file. The simple option converts inside the service; the Google option keeps more visual styling.
   *
   * @route POST /get-document-as-html
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to read."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional: restrict to a single tab."}
   * @paramDef {"type":"Boolean","label":"Use Google's Converter","name":"useDriveExport","uiComponent":{"type":"TOGGLE"},"description":"Off (default): converts inside the service — fast, simple HTML with image links. On: asks Google to convert — preserves more styling and embeds images directly in the HTML, but uses your Google quota."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","html":"<h1>Title</h1><p>First paragraph.</p>"}
   */
  async getDocumentAsHtml(documentId, tabId, useDriveExport) {
    const docId = this.#ensureDocId(documentId)

    if (asBool(useDriveExport)) {
      const bytes = await this.#driveExport(docId, EXPORT_MIME.html)

      return {
        documentId: docId,
        html: bytes.toString('utf8'),
        source: 'drive-export',
      }
    }

    const document = await this.#loadDoc(documentId, {
      includeTabsContent: true,
    })
    const filtered = tabId ? scopeToTab(document, tabId) : document
    const html = toHtml(filtered)

    return {
      documentId: docId,
      title: document.title,
      html,
      source: 'in-extension',
    }
  }

  /**
   * @operationName Get Document Outline
   * @category Documents
   * @description Returns the heading outline of a document (Title, Subtitle, Heading 1–6) with each entry's index and segment so it can be linked or navigated.
   *
   * @route POST /get-document-outline
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to outline."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional: restrict to a single tab."}
   *
   * @returns {Object}
   * @sampleResultLoader { "methodName":"getDocumentOutline_SampleResultLoader" }
   */
  async getDocumentOutline(documentId, tabId) {
    const document = await this.#loadDoc(documentId, {
      includeTabsContent: true,
    })
    const filtered = tabId ? scopeToTab(document, tabId) : document
    const headings = extractHeadings(filtered)

    return {
      documentId: this.#ensureDocId(documentId),
      title: document.title,
      headings,
    }
  }

  /**
   * @operationName Get Document Statistics
   * @category Documents
   * @description Returns counts for a document: words, characters, paragraphs, tables, images, and labeled sections. Use this when you need a length check before sending the document to an AI, deciding whether to split a large document, or showing stats to a user.
   *
   * @route POST /get-document-statistics
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to inspect."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional: restrict to a single tab."}
   *
   * @returns {Object}
   * @sampleResultLoader { "methodName":"getDocumentStatistics_SampleResultLoader" }
   */
  async getDocumentStatistics(documentId, tabId) {
    const document = await this.#loadDoc(documentId, {
      includeTabsContent: true,
    })
    const filtered = tabId ? scopeToTab(document, tabId) : document
    const stats = countWords(filtered)
    const tables = extractTables(filtered).length
    const images = extractImages(filtered).length
    const namedRanges = extractNamedRanges(filtered).length

    return {
      documentId: this.#ensureDocId(documentId),
      title: document.title,
      revisionId: document.revisionId,
      ...stats,
      tables,
      images,
      namedRanges,
    }
  }

  /**
   * @operationName Get Inline Images
   * @category Documents
   * @description Returns the inline images embedded in a document with each image's `contentUri` (the publicly-fetchable URL Drive serves for that image). Use for image extraction or re-hosting workflows.
   *
   * @route POST /get-document-images
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to inspect."}
   *
   * @returns {Object}
   * @sampleResult {"images":[{"inlineObjectId":"img-001","title":"Logo","contentUri":"https://lh3.googleusercontent.com/..."}]}
   */
  async getDocumentImages(documentId) {
    const document = await this.#loadDoc(documentId, {
      includeTabsContent: true,
    })

    return {
      documentId: this.#ensureDocId(documentId),
      images: extractImages(document),
    }
  }

  /**
   * @operationName Get Named Ranges
   * @category Documents
   * @description Returns the named ranges defined in a document. Named ranges are stable anchors that survive collaborative edits — use them for repeatable insert/replace workflows.
   *
   * @route POST /get-document-named-ranges
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to inspect."}
   *
   * @returns {Object}
   * @sampleResult {"namedRanges":[{"name":"summary","namedRangeId":"range-001","startIndex":10,"endIndex":200}]}
   */
  async getDocumentNamedRanges(documentId) {
    const document = await this.#loadDoc(documentId, {
      includeTabsContent: true,
    })

    return {
      documentId: this.#ensureDocId(documentId),
      namedRanges: extractNamedRanges(document),
    }
  }

  /**
   * Internal: fetches a Drive export as a Buffer. Used by Markdown/HTML/PDF/DOCX shaped methods.
   */
  async #driveExport(docId, mimeType) {
    const headers = this.#getAccessTokenHeader()
    const url = `${ DRIVE_API_BASE_URL }/files/${ docId }/export?mimeType=${ encodeURIComponent(mimeType) }`

    const res = await fetch(url, { headers })

    if (!res.ok) {
      const text = await res.text().catch(() => '')

      throw new Error(
        `Drive export failed (${ res.status }): ${ text.slice(0, 500) }`
      )
    }

    return Buffer.from(await res.arrayBuffer())
  }

  // =============================== 6 DOCUMENTS — LIST & SEARCH ===============================

  /**
   * @operationName List Documents
   * @category Documents
   * @description Lists Google Docs the connected account can access. Supports filtering by folder, name substring, modified date, and shared-with-me status. Returns up to 1000 results per page.
   *
   * @route POST /list-documents
   *
   * @paramDef {"type":"String","label":"Folder","name":"folderId","dictionary":"listFoldersDictionary","description":"Restrict to direct children of this folder. Use 'root' for My Drive root."}
   * @paramDef {"type":"String","label":"Name Contains","name":"nameContains","description":"Filter to docs whose name contains this substring."}
   * @paramDef {"type":"String","label":"Modified After","name":"modifiedAfter","uiComponent":{"type":"DATE_PICKER"},"description":"Only return documents modified after this date and time. Example: 2025-01-15 or 2025-01-15T10:00:00Z."}
   * @paramDef {"type":"Boolean","label":"Owned By Me","name":"ownedByMe","uiComponent":{"type":"TOGGLE"},"description":"Restrict to docs owned by the connected account."}
   * @paramDef {"type":"Boolean","label":"Shared With Me","name":"sharedWithMe","uiComponent":{"type":"TOGGLE"},"description":"Restrict to docs explicitly shared with the connected account."}
   * @paramDef {"type":"Boolean","label":"Trashed Only","name":"trashedOnly","uiComponent":{"type":"TOGGLE"},"description":"When true returns only trashed docs. When false (default) excludes trashed."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Last Modified (Newest First)","Last Modified (Oldest First)","Name (A-Z)","Name (Z-A)","Date Created (Newest First)","Date Created (Oldest First)","Starred First","Recently Shared With Me","Most Recent Activity"]}},"description":"How to sort results. Default: newest first."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Items per page, 1-1000 (default 50)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Cursor returned by a previous call to fetch the next page."}
   * @paramDef {"type":"Boolean","label":"Fetch All Pages","name":"fetchAll","uiComponent":{"type":"TOGGLE"},"description":"Auto-paginate up to 10 pages, returning a flattened files array."}
   *
   * @returns {Object}
   * @sampleResultLoader { "methodName":"listDocuments_SampleResultLoader" }
   */
  async listDocuments(
    folderId,
    nameContains,
    modifiedAfter,
    ownedByMe,
    sharedWithMe,
    trashedOnly,
    orderBy,
    pageSize,
    pageToken,
    fetchAll
  ) {
    const folder = folderId ? extractFolderId(folderId) : null
    const parts = [`mimeType='${ GOOGLE_DOC_MIME }'`]

    if (asBool(trashedOnly)) parts.push('trashed=true')
    else parts.push('trashed=false')

    if (folder) parts.push(`'${ folder }' in parents`)

    if (nameContains)
      parts.push(
        `name contains '${ String(nameContains).replace(/'/g, "\\'") }'`
      )

    if (modifiedAfter)
      parts.push(`modifiedTime > '${ ensureRfc3339(modifiedAfter) }'`)

    if (asBool(ownedByMe)) parts.push("'me' in owners")

    if (asBool(sharedWithMe)) parts.push('sharedWithMe=true')

    const q = parts.join(' and ')
    const size = clampInt(pageSize, 1, MAX_LIST_PAGE_SIZE, DEFAULT_PAGE_SIZE)
    const resolvedOrderBy = this.#resolveChoice(orderBy, {
      'Last Modified (Newest First)': 'modifiedTime desc',
      'Last Modified (Oldest First)': 'modifiedTime',
      'Name (A-Z)': 'name',
      'Name (Z-A)': 'name desc',
      'Date Created (Newest First)': 'createdTime desc',
      'Date Created (Oldest First)': 'createdTime',
      'Starred First': 'starred desc',
      'Recently Shared With Me': 'sharedWithMeTime desc',
      'Most Recent Activity': 'recency desc',
    })
    const order = resolvedOrderBy || 'modifiedTime desc'

    const fetchPage = async token =>
      this.#driveRequest({
        logTag: 'listDocuments',
        url: `${ DRIVE_API_BASE_URL }/files`,
        query: {
          q,
          pageSize: size,
          pageToken: token || pageToken,
          fields: DOC_FILE_FIELDS_LIST,
          includeItemsFromAllDrives: 'true',
          corpora: 'allDrives',
          orderBy: order,
        },
      })

    if (asBool(fetchAll)) return paginateAll(fetchPage, { itemsKey: 'files' })

    const response = await fetchPage()

    return {
      files: response.files || [],
      nextPageToken: response.nextPageToken || null,
    }
  }

  /**
   * @operationName Search Documents By Content
   * @category Documents
   * @description Returns Google Docs whose full-text content contains the given query. Uses Drive's `fullText contains` operator — indexing may lag the most recent edits by a few minutes.
   *
   * @route POST /search-documents-by-content
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Word, phrase, or substring to search for inside the documents' content (example: \"quarterly report\")."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Items per page (default 50, max 1000)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Cursor for next page."}
   *
   * @returns {Object}
   * @sampleResultLoader { "methodName":"listDocuments_SampleResultLoader" }
   */
  async searchDocumentsByContent(query, pageSize, pageToken) {
    if (!query) throw new Error('"Query" is required')

    const escaped = String(query).replace(/'/g, "\\'")
    const q = `mimeType='${ GOOGLE_DOC_MIME }' and trashed=false and fullText contains '${ escaped }'`

    const response = await this.#driveRequest({
      logTag: 'searchDocumentsByContent',
      url: `${ DRIVE_API_BASE_URL }/files`,
      query: {
        q,
        pageSize: clampInt(pageSize, 1, MAX_LIST_PAGE_SIZE, DEFAULT_PAGE_SIZE),
        pageToken,
        fields: DOC_FILE_FIELDS_LIST,
        includeItemsFromAllDrives: 'true',
        corpora: 'allDrives',
        orderBy: 'modifiedTime desc',
      },
    })

    return {
      files: response.files || [],
      nextPageToken: response.nextPageToken || null,
    }
  }

  /**
   * @operationName List Recent Documents
   * @category Documents
   * @description Returns Google Docs modified recently. Convenience wrapper over List Documents with `orderBy=modifiedTime desc`.
   *
   * @route POST /list-recent-documents
   *
   * @paramDef {"type":"Number","label":"Days","name":"days","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many days back to consider (default 7)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Items per page (default 50, max 1000)."}
   *
   * @returns {Object}
   * @sampleResultLoader { "methodName":"listDocuments_SampleResultLoader" }
   */
  async listRecentDocuments(days, pageSize) {
    const daysBack = clampInt(days, 1, 365, 7)
    const cutoff = new Date(Date.now() - daysBack * 86400000).toISOString()

    return this.listDocuments(
      null,
      null,
      cutoff,
      null,
      null,
      null,
      'modifiedTime desc',
      pageSize,
      null,
      false
    )
  }

  /**
   * @operationName List Documents Shared With Me
   * @category Documents
   * @description Returns Google Docs explicitly shared with the connected account.
   *
   * @route POST /list-documents-shared-with-me
   *
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Items per page (default 50, max 1000)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Cursor for next page."}
   *
   * @returns {Object}
   * @sampleResultLoader { "methodName":"listDocuments_SampleResultLoader" }
   */
  async listDocumentsSharedWithMe(pageSize, pageToken) {
    return this.listDocuments(
      null,
      null,
      null,
      null,
      true,
      null,
      'sharedWithMeTime desc',
      pageSize,
      pageToken,
      false
    )
  }

  /**
   * @operationName List Documents In Folder
   * @category Documents
   * @description Returns Google Docs that live directly inside the given folder. For subfolders' contents use Search Documents By Content with a name filter.
   *
   * @route POST /list-documents-in-folder
   *
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":true,"dictionary":"listFoldersDictionary","description":"Folder to scope listing to. Use 'root' for My Drive root."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Items per page (default 50, max 1000)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Cursor for next page."}
   *
   * @returns {Object}
   * @sampleResultLoader { "methodName":"listDocuments_SampleResultLoader" }
   */
  async listDocumentsInFolder(folderId, pageSize, pageToken) {
    if (!folderId) throw new Error('"Folder" is required')

    return this.listDocuments(
      folderId,
      null,
      null,
      null,
      null,
      null,
      null,
      pageSize,
      pageToken,
      false
    )
  }

  // =============================== 7 DOCUMENTS — CREATE / LIFECYCLE ===============================

  /**
   * @operationName Create Blank Document
   * @category Documents
   * @description Creates a new empty Google Doc with the given title. Optionally places it inside a folder (otherwise it lands in My Drive root).
   *
   * @route POST /create-document
   * @appearanceColor #16a765 #22c55e
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Title of the new document."}
   * @paramDef {"type":"String","label":"Folder","name":"folderId","dictionary":"listFoldersDictionary","description":"Optional folder to create the document in."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","title":"Smoke Doc","webViewLink":"https://docs.google.com/document/d/1aBC.../edit","revisionId":"ALm..."}
   */
  async createDocument(title, folderId) {
    if (!title) throw new Error('"Title" is required')

    const created = await this.#docsRequest({
      logTag: 'createDocument',
      method: 'post',
      url: `${ DOCS_API_BASE_URL }/documents`,
      body: { title },
    })

    const folder = folderId
      ? extractFolderId(folderId)
      : this.defaultFolderId || null

    if (folder && folder !== 'root') {
      try {
        await this.#driveRequest({
          logTag: 'createDocument:move',
          method: 'patch',
          url: `${ DRIVE_API_BASE_URL }/files/${ created.documentId }`,
          query: {
            addParents: folder,
            removeParents: 'root',
            fields: 'id,parents',
          },
        })
      } catch (error) {
        logger.warn(`createDocument: move to folder failed: ${ error.message }`)
      }
    }

    return {
      documentId: created.documentId,
      title: created.title,
      revisionId: created.revisionId,
      webViewLink: `https://docs.google.com/document/d/${ created.documentId }/edit`,
    }
  }

  /**
   * @operationName Create Document From Template
   * @category Documents
   * @description Copies a template document, renames it, and (optionally) runs Replace All Text substitutions in one shot. Use for mail-merge: build a template with `{{name}}` placeholders, then call this with replacements.
   *
   * @route POST /create-document-from-template
   * @appearanceColor #16a765 #22c55e
   *
   * @paramDef {"type":"String","label":"Template Document","name":"templateDocumentId","required":true,"dictionary":"listDocumentsDictionary","description":"The template document to copy."}
   * @paramDef {"type":"String","label":"New Title","name":"title","required":true,"description":"Title of the new document."}
   * @paramDef {"type":"Object","label":"Replacements","name":"replacements","freeform":true,"description":"Optional. A map of placeholder → value pairs that get filled in immediately after the template is copied. Keys are free-form because the placeholders are defined by your own template, so there is no fixed sub-form. Example: {\"{{name}}\":\"Kiril\",\"{{date}}\":\"2026-05-16\"}. Leave empty to skip the substitution step."}
   * @paramDef {"type":"String","label":"Folder","name":"folderId","dictionary":"listFoldersDictionary","description":"Optional folder for the new copy."}
   * @paramDef {"type":"Boolean","label":"Match Case","name":"matchCase","uiComponent":{"type":"TOGGLE"},"description":"When true (default) replacement matches are case-sensitive."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","title":"Q3 Report — Acme","replacementsApplied":3,"webViewLink":"https://docs.google.com/document/d/1aBC.../edit"}
   */
  async createDocumentFromTemplate(
    templateDocumentId,
    title,
    replacements,
    folderId,
    matchCase
  ) {
    const templateId = this.#ensureDocId(templateDocumentId)

    if (!title) throw new Error('"New Title" is required')

    const copied = await this.#driveRequest({
      logTag: 'createDocumentFromTemplate:copy',
      method: 'post',
      url: `${ DRIVE_API_BASE_URL }/files/${ templateId }/copy`,
      body: cleanupObject({
        name: title,
        parents: folderId ? [extractFolderId(folderId)] : undefined,
      }),
      query: { fields: 'id,name,webViewLink,parents' },
    })

    let replacementsApplied = 0

    if (replacements && typeof replacements === 'object') {
      const entries = Object.entries(replacements).filter(([k]) => k)
      const requests = entries.map(([find, replace]) => ({
        replaceAllText: {
          containsText: {
            text: find,
            matchCase:
              matchCase === undefined ? true : asBool(matchCase) !== false,
          },
          replaceText: replace == null ? '' : String(replace),
        },
      }))

      if (requests.length) {
        const result = await this.#batchUpdate(copied.id, requests, {
          sortDescending: false,
        })

        replacementsApplied = (result.replies || []).reduce(
          (sum, r) => sum + (r.replaceAllText?.occurrencesChanged || 0),
          0
        )
      }
    }

    return {
      documentId: copied.id,
      title: copied.name,
      replacementsApplied,
      webViewLink:
        copied.webViewLink ||
        `https://docs.google.com/document/d/${ copied.id }/edit`,
    }
  }

  /**
   * @operationName Create Document From Markdown
   * @category Documents
   * @description Creates a new Google Doc from Markdown text. Headings, bold and italic, links, bullet lists, and pipe tables turn into real Docs formatting. Use to put AI-generated content into a doc that humans can review and refine.
   *
   * @route POST /create-document-from-markdown
   * @appearanceColor #16a765 #22c55e
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Title of the new document."}
   * @paramDef {"type":"String","label":"Markdown","name":"markdown","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Markdown source. Headings #, **bold**, *italic*, [links](url), -lists, and pipe tables are honored by Drive's converter."}
   * @paramDef {"type":"String","label":"Folder","name":"folderId","dictionary":"listFoldersDictionary","description":"Optional folder."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","title":"AI Notes","webViewLink":"https://docs.google.com/document/d/1aBC.../edit"}
   */
  async createDocumentFromMarkdown(title, markdown, folderId) {
    return this.#importFile({
      title,
      mediaContent: markdown == null ? '' : String(markdown),
      mediaMimeType: 'text/markdown',
      folderId,
      logTag: 'createDocumentFromMarkdown',
    })
  }

  /**
   * @operationName Create Document From HTML
   * @category Documents
   * @description Creates a new Google Doc from an HTML snippet. Use to convert rich-text email content, web snippets, or styled exports from other tools into an editable Google Doc.
   *
   * @route POST /create-document-from-html
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Title of the new document."}
   * @paramDef {"type":"String","label":"HTML","name":"html","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"HTML source. Drive's converter understands headings, lists, tables, images by URL, and basic styling."}
   * @paramDef {"type":"String","label":"Folder","name":"folderId","dictionary":"listFoldersDictionary","description":"Optional folder."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","title":"Imported","webViewLink":"https://docs.google.com/document/d/1aBC.../edit"}
   */
  async createDocumentFromHtml(title, html, folderId) {
    return this.#importFile({
      title,
      mediaContent: html == null ? '' : String(html),
      mediaMimeType: 'text/html',
      folderId,
      logTag: 'createDocumentFromHtml',
    })
  }

  /**
   * @operationName Create Document From DOCX URL
   * @category Documents
   * @description Downloads a `.docx` file from a public URL and imports it as a Google Doc. The URL must be reachable without authentication (presigned S3 links work).
   *
   * @route POST /create-document-from-docx
   *
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"description":"HTTPS URL of a .docx file. Must be publicly accessible."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Title of the new document."}
   * @paramDef {"type":"String","label":"Folder","name":"folderId","dictionary":"listFoldersDictionary","description":"Optional folder."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","title":"Imported.docx","webViewLink":"https://docs.google.com/document/d/1aBC.../edit"}
   */
  async createDocumentFromDocx(fileUrl, title, folderId) {
    if (!fileUrl) throw new Error('"File URL" is required')

    if (!title) throw new Error('"Title" is required')

    const res = await fetch(fileUrl)

    if (!res.ok) throw new Error(`Source URL fetch failed: ${ res.status }`)

    const buffer = Buffer.from(await res.arrayBuffer())

    return this.#importFile({
      title,
      mediaContent: buffer,
      mediaMimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      folderId,
      logTag: 'createDocumentFromDocx',
    })
  }

  /**
   * @operationName Duplicate Document
   * @category Documents
   * @description Copies an existing Google Doc. By default the copy lives in the same folder as the source; pass a folder to override.
   *
   * @route POST /duplicate-document
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to duplicate."}
   * @paramDef {"type":"String","label":"New Title","name":"newTitle","description":"Optional title for the copy. Defaults to 'Copy of <original>'."}
   * @paramDef {"type":"String","label":"Folder","name":"folderId","dictionary":"listFoldersDictionary","description":"Optional folder for the new copy."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","title":"Copy of Smoke Doc","webViewLink":"https://docs.google.com/document/d/1aBC.../edit"}
   */
  async duplicateDocument(documentId, newTitle, folderId) {
    const docId = this.#ensureDocId(documentId)

    const copied = await this.#driveRequest({
      logTag: 'duplicateDocument',
      method: 'post',
      url: `${ DRIVE_API_BASE_URL }/files/${ docId }/copy`,
      body: cleanupObject({
        name: newTitle,
        parents: folderId ? [extractFolderId(folderId)] : undefined,
      }),
      query: { fields: 'id,name,webViewLink,parents' },
    })

    return {
      documentId: copied.id,
      title: copied.name,
      webViewLink:
        copied.webViewLink ||
        `https://docs.google.com/document/d/${ copied.id }/edit`,
    }
  }

  /**
   * @operationName Rename Document
   * @category Documents
   * @description Changes a document's title. Use to standardize naming, append dates, or rename after content edits. The web link to the document stays the same.
   *
   * @route POST /rename-document
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to rename."}
   * @paramDef {"type":"String","label":"New Title","name":"newTitle","required":true,"description":"New title."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","title":"Q3 Plan — Final"}
   */
  async renameDocument(documentId, newTitle) {
    const docId = this.#ensureDocId(documentId)

    if (!newTitle) throw new Error('"New Title" is required')

    const updated = await this.#driveRequest({
      logTag: 'renameDocument',
      method: 'patch',
      url: `${ DRIVE_API_BASE_URL }/files/${ docId }`,
      body: { name: newTitle },
      query: { fields: 'id,name' },
    })

    return { documentId: updated.id, title: updated.name }
  }

  /**
   * @operationName Move Document To Folder
   * @category Documents
   * @description Moves a document to a different folder. Removes the doc from its current parents and adds it to the new folder.
   *
   * @route POST /move-document
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to move."}
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":true,"dictionary":"listFoldersDictionary","description":"Destination folder."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","parents":["folderId123"]}
   */
  async moveDocument(documentId, folderId) {
    const docId = this.#ensureDocId(documentId)
    const target = extractFolderId(folderId)

    if (!target) throw new Error('"Folder" is required')

    const current = await this.#driveRequest({
      logTag: 'moveDocument:get',
      url: `${ DRIVE_API_BASE_URL }/files/${ docId }`,
      query: { fields: 'id,parents' },
    })

    const previousParents = (current.parents || []).join(',')

    const moved = await this.#driveRequest({
      logTag: 'moveDocument:patch',
      method: 'patch',
      url: `${ DRIVE_API_BASE_URL }/files/${ docId }`,
      query: {
        addParents: target,
        removeParents: previousParents,
        fields: 'id,parents',
      },
    })

    return { documentId: moved.id, parents: moved.parents }
  }

  /**
   * @operationName Trash Document
   * @category Documents
   * @description Moves a document to the trash. Can be restored later via Restore Document. Use Delete Document for permanent removal.
   *
   * @route POST /trash-document
   * @appearanceColor #d93025 #ea4335
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to trash."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","trashed":true}
   */
  async trashDocument(documentId) {
    const docId = this.#ensureDocId(documentId)

    await this.#driveRequest({
      logTag: 'trashDocument',
      method: 'patch',
      url: `${ DRIVE_API_BASE_URL }/files/${ docId }`,
      body: { trashed: true },
      query: { fields: 'id,trashed' },
    })

    return { documentId: docId, trashed: true }
  }

  /**
   * @operationName Restore Document From Trash
   * @category Documents
   * @description Restores a document from the trash. Use to recover after a Trash Document action. Does nothing if the document is not currently in the trash.
   *
   * @route POST /restore-document
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"freeform":true,"description":"The trashed document to restore. The document picker lists only active documents, so paste the document's link or the ID returned by Trash Document."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","trashed":false}
   */
  async restoreDocument(documentId) {
    const docId = this.#ensureDocId(documentId)

    await this.#driveRequest({
      logTag: 'restoreDocument',
      method: 'patch',
      url: `${ DRIVE_API_BASE_URL }/files/${ docId }`,
      body: { trashed: false },
      query: { fields: 'id,trashed' },
    })

    return { documentId: docId, trashed: false }
  }

  /**
   * @operationName Delete Document Permanently
   * @category Documents
   * @description Permanently deletes a document. This skips the trash and CANNOT be undone. Prefer Trash Document for recoverable removals.
   *
   * @route POST /delete-document
   * @appearanceColor #d93025 #ea4335
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to delete."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","deleted":true}
   */
  async deleteDocument(documentId) {
    const docId = this.#ensureDocId(documentId)

    await this.#driveRequest({
      logTag: 'deleteDocument',
      method: 'delete',
      url: `${ DRIVE_API_BASE_URL }/files/${ docId }`,
    })

    return { documentId: docId, deleted: true }
  }

  /**
   * Internal: multipart upload that imports a source file into a new Google Doc.
   * Uses raw fetch because Flowrunner.Request doesn't expose multipart upload semantics.
   */
  async #importFile({ title, mediaContent, mediaMimeType, folderId, logTag }) {
    if (!title) throw new Error('"Title" is required')

    const metadata = {
      name: title,
      mimeType: GOOGLE_DOC_MIME,
    }

    const folder = folderId
      ? extractFolderId(folderId)
      : this.defaultFolderId || null

    if (folder && folder !== 'root') metadata.parents = [folder]

    const boundary = `flowrunner-${ Date.now().toString(36) }-${ Math.random().toString(36).slice(2, 10) }`
    const head = `--${ boundary }\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${ JSON.stringify(metadata) }\r\n--${ boundary }\r\nContent-Type: ${ mediaMimeType }\r\n\r\n`
    const tail = `\r\n--${ boundary }--`

    const body = Buffer.concat([
      Buffer.from(head, 'utf8'),
      Buffer.isBuffer(mediaContent)
        ? mediaContent
        : Buffer.from(String(mediaContent), 'utf8'),
      Buffer.from(tail, 'utf8'),
    ])

    const url = `${ DRIVE_UPLOAD_BASE_URL }/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink,mimeType,parents`

    logger.debug(
      `${ logTag } - importing ${ mediaMimeType } (${ body.length } bytes)`
    )

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.#getAccessTokenHeader(),
        'Content-Type': `multipart/related; boundary="${ boundary }"`,
      },
      body,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')

      throw new Error(
        `Drive import failed (${ res.status }): ${ text.slice(0, 500) }`
      )
    }

    const created = await res.json()

    return {
      documentId: created.id,
      title: created.name,
      webViewLink:
        created.webViewLink ||
        `https://docs.google.com/document/d/${ created.id }/edit`,
    }
  }

  // =============================== 8 TEXT — INSERT / DELETE / REPLACE ===============================

  /**
   * @operationName Insert Text At Index
   * @category Text
   * @description Inserts text at a specific character position in the document. Positions are counted from 1 (the first character is at position 1). Use Get Document Outline to find positions of headings, or Append Text To Document if you simply want to add to the end without computing a position.
   *
   * @route POST /insert-text-at-index
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text to insert. Use `\\n` to break paragraphs."}
   * @paramDef {"type":"Number","label":"Index","name":"index","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Insertion index (1 or greater)."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Insert into this tab only (for documents with multiple tabs)."}
   * @paramDef {"type":"String","label":"Header or Footer","name":"segmentId","dictionary":"listHeadersFootersDictionary","description":"Optional. Insert into a header or footer instead of the main body of the document. Leave empty to insert into the body."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async insertTextAtIndex(documentId, text, index, tabId, segmentId) {
    if (text === null || text === undefined)
      throw new Error('"Text" is required')

    if (!index) throw new Error('"Index" is required')

    return this.#batchUpdate(
      documentId,
      [
        {
          insertText: {
            text: String(text),
            location: buildLocation({ index: Number(index), tabId, segmentId }),
          },
        },
      ],
      { sortDescending: false }
    )
  }

  /**
   * @operationName Append Text To Document
   * @category Text
   * @description Appends text at the very end of a tab/segment. Use this instead of computing indices when you simply want to add to the end.
   *
   * @route POST /append-text
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text to append. Use `\\n` for line breaks."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Append into this tab only."}
   * @paramDef {"type":"String","label":"Header or Footer","name":"segmentId","dictionary":"listHeadersFootersDictionary","description":"Optional. Append into a header or footer instead of the main body. Leave empty to append to the body."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async appendText(documentId, text, tabId, segmentId) {
    if (text === null || text === undefined)
      throw new Error('"Text" is required')

    const eos = {}

    if (segmentId) eos.segmentId = segmentId

    if (tabId) eos.tabId = tabId

    return this.#batchUpdate(
      documentId,
      [
        {
          insertText: { text: String(text), endOfSegmentLocation: eos },
        },
      ],
      { sortDescending: false }
    )
  }

  /**
   * @operationName Prepend Text To Document
   * @category Text
   * @description Inserts text at the very start of a document's body (index 1).
   *
   * @route POST /prepend-text
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text to prepend."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Restrict the action to a single tab of the document. Leave empty to target the first tab (or all tabs where applicable)."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async prependText(documentId, text, tabId) {
    return this.insertTextAtIndex(documentId, text, 1, tabId, null)
  }

  /**
   * @operationName Delete Content Range
   * @category Text
   * @description Deletes everything between two character positions. Use when removing a specific span — like a paragraph between two known positions, or a placeholder that Replace All Text cannot match. Note: Google Docs does not let you delete the document's final newline, so the end position must fit before it.
   *
   * @route POST /delete-content-range
   * @appearanceColor #d93025 #ea4335
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"Number","label":"Start Index","name":"startIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Character position where the selection begins (counting from 1)."}
   * @paramDef {"type":"Number","label":"End Index","name":"endIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Character position where the selection ends — just past the last character to include. Must be greater than the start position."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Restrict the action to a single tab of the document. Leave empty to target the first tab (or all tabs where applicable)."}
   * @paramDef {"type":"String","label":"Header or Footer","name":"segmentId","dictionary":"listHeadersFootersDictionary","description":"Optional. Apply to a header or footer instead of the main body. Leave empty to target the body."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async deleteContentRange(documentId, startIndex, endIndex, tabId, segmentId) {
    if (!startIndex || !endIndex)
      throw new Error('Start and end indices are required')

    return this.#batchUpdate(documentId, [
      {
        deleteContentRange: {
          range: buildRange({
            startIndex: Number(startIndex),
            endIndex: Number(endIndex),
            tabId,
            segmentId,
          }),
        },
      },
    ])
  }

  /**
   * @operationName Replace All Text
   * @category Text
   * @description Finds every occurrence of a substring and replaces it. This is the canonical mail-merge primitive — pair it with placeholder tokens like `{{name}}` in your templates.
   *
   * @route POST /replace-all-text
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"String","label":"Find","name":"findText","required":true,"description":"Text to find. Matches anywhere in the doc."}
   * @paramDef {"type":"String","label":"Replace With","name":"replaceText","description":"Replacement text. Empty string deletes the match."}
   * @paramDef {"type":"Boolean","label":"Match Case","name":"matchCase","uiComponent":{"type":"TOGGLE"},"description":"When true (default) matches are case-sensitive."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional: restrict replacement to one tab."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","occurrencesChanged":3}
   */
  async replaceAllText(documentId, findText, replaceText, matchCase, tabId) {
    if (!findText) throw new Error('"Find" is required')

    const request = {
      replaceAllText: {
        containsText: {
          text: String(findText),
          matchCase:
            matchCase === undefined ? true : asBool(matchCase) !== false,
        },
        replaceText: replaceText == null ? '' : String(replaceText),
      },
    }

    const result = await this.#batchUpdate(
      documentId,
      [withTabsCriteria(request, tabId)],
      { sortDescending: false }
    )
    const occurrencesChanged =
      result.replies?.[0]?.replaceAllText?.occurrencesChanged || 0

    return { documentId: result.documentId, occurrencesChanged }
  }

  /**
   * @operationName Replace Multiple Texts
   * @category Text
   * @description Runs many find-and-replace pairs in one pass. Faster and more reliable than calling Replace All Text many times. Use for mail-merge with multiple placeholders ({{name}}, {{date}}, {{amount}}, etc.) or for cleaning up many terms at once.
   *
   * @route POST /replace-multiple-texts
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"Array","label":"Replacements","name":"replacements","required":true,"description":"List of find-and-replace entries (each entry is an object) to run in one pass. Each entry has a `find` (text to look for), a `replace` (text to put in its place), and an optional `matchCase` (defaults to true). Example: [{\"find\":\"{{name}}\",\"replace\":\"Kiril\"}, {\"find\":\"{{date}}\",\"replace\":\"2026-05-16\"}]."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional: restrict replacements to one tab."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","totalOccurrencesChanged":5,"perMatch":[{"find":"{{name}}","occurrencesChanged":2}]}
   */
  async replaceMultipleTexts(documentId, replacements, tabId) {
    if (!Array.isArray(replacements) || !replacements.length) {
      throw new Error('"Replacements" must be a non-empty array')
    }

    // Drop entries with no `find`; requests, replies, and perMatch labels all index into
    // this filtered set so a dropped entry never shifts the labels.
    const entries = replacements.filter(
      r => r && r.find !== undefined && r.find !== null
    )
    const requests = entries.map(r =>
      withTabsCriteria(
        {
          replaceAllText: {
            containsText: {
              text: String(r.find),
              matchCase:
                r.matchCase === undefined ? true : asBool(r.matchCase) !== false,
            },
            replaceText: r.replace == null ? '' : String(r.replace),
          },
        },
        tabId
      )
    )

    const result = await this.#batchUpdate(documentId, requests, {
      sortDescending: false,
    })

    const perMatch = (result.replies || []).map((reply, i) => ({
      find: entries[i]?.find,
      occurrencesChanged: reply?.replaceAllText?.occurrencesChanged || 0,
    }))

    const total = perMatch.reduce((s, e) => s + e.occurrencesChanged, 0)

    return {
      documentId: result.documentId,
      totalOccurrencesChanged: total,
      perMatch,
    }
  }

  /**
   * @operationName Replace Text In Named Range
   * @category Text
   * @description Atomically swaps the content of every range registered under the given name. Named ranges are the most resilient anchor — they survive collaborative edits while indices drift.
   *
   * @route POST /replace-named-range-content
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"String","label":"Named Range","name":"namedRangeName","required":true,"dictionary":"listNamedRangesDictionary","description":"Name of the named range whose content should be replaced."}
   * @paramDef {"type":"String","label":"New Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New content."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional tab to restrict the replacement to."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async replaceNamedRangeContent(documentId, namedRangeName, text, tabId) {
    if (!namedRangeName) throw new Error('"Named Range" is required')

    return this.#batchUpdate(
      documentId,
      [
        withTabsCriteria(
          {
            replaceNamedRangeContent: {
              namedRangeName,
              text: text == null ? '' : String(text),
            },
          },
          tabId
        ),
      ],
      { sortDescending: false }
    )
  }

  /**
   * @operationName Move Text
   * @category Text
   * @description Cuts a stretch of text from one place and pastes it somewhere else in the document in a single step. Specify the destination as the position it would occupy in the current document (before the cut happens) — the service handles the rest. The destination must lie outside the source range.
   *
   * @route POST /move-text
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"Number","label":"Source Start","name":"sourceStartIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Character position where the range to move begins (counting from 1)."}
   * @paramDef {"type":"Number","label":"Source End","name":"sourceEndIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Character position just past the last character of the range to move."}
   * @paramDef {"type":"Number","label":"Destination Index","name":"destinationIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Where to insert the moved text (interpreted before deletion). Must lie OUTSIDE the source range."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Restrict the action to a single tab of the document. Leave empty to target the first tab (or all tabs where applicable)."}
   * @paramDef {"type":"String","label":"Header or Footer","name":"segmentId","dictionary":"listHeadersFootersDictionary","description":"Optional. Apply to a header or footer instead of the main body."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}],"moved":"Hello"}
   */
  async moveText(
    documentId,
    sourceStartIndex,
    sourceEndIndex,
    destinationIndex,
    tabId,
    segmentId
  ) {
    const start = Number(sourceStartIndex)
    const end = Number(sourceEndIndex)
    const dest = Number(destinationIndex)

    if (!(end > start))
      throw new Error('Source end must be greater than source start')

    if (dest >= start && dest <= end)
      throw new Error('Destination must lie outside the source range')

    // Read the slice first via the doc tree so we know what to re-insert.
    const document = await this.#loadDoc(documentId, {
      includeTabsContent: true,
    })
    const text = extractTextSlice(document, {
      tabId,
      segmentId,
      startIndex: start,
      endIndex: end,
    })

    if (!text)
      throw new Error('No content found at source range — verify indices')

    // Compose in descending-index order so deletion and insertion don't shift each other.
    const requests = []

    if (dest > end) {
      // Insertion is AFTER the source — after deletion the destination shifts left by (end-start).
      requests.push({
        insertText: {
          text,
          location: buildLocation({
            index: dest - (end - start),
            tabId,
            segmentId,
          }),
        },
      })

      requests.push({
        deleteContentRange: {
          range: buildRange({
            startIndex: start,
            endIndex: end,
            tabId,
            segmentId,
          }),
        },
      })
    } else {
      // Insertion is BEFORE the source — delete first so the source range indices are valid.
      requests.push({
        deleteContentRange: {
          range: buildRange({
            startIndex: start,
            endIndex: end,
            tabId,
            segmentId,
          }),
        },
      })

      requests.push({
        insertText: {
          text,
          location: buildLocation({ index: dest, tabId, segmentId }),
        },
      })
    }

    const result = await this.#batchUpdate(documentId, requests, {
      sortDescending: false,
    })

    return {
      documentId: result.documentId,
      replies: result.replies,
      moved: text,
    }
  }

  /**
   * @operationName Append Paragraph
   * @category Text
   * @description Appends a new paragraph at the end of the document, optionally styled (Title, Heading 1, etc.). Inserts the text, then promotes the new paragraph's named style.
   *
   * @route POST /append-paragraph
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Paragraph text. A trailing newline is added automatically."}
   * @paramDef {"type":"String","label":"Style","name":"namedStyleType","dictionary":"listNamedStylesDictionary","description":"Optional named style (Title, Heading 1, etc.). Defaults to Normal text."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Append into this tab only."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{},{}]}
   */
  async appendParagraph(documentId, text, namedStyleType, tabId) {
    if (text === null || text === undefined)
      throw new Error('"Text" is required')

    const document = await this.#loadDoc(documentId, {
      includeTabsContent: true,
    })
    const body = pickBody(document, tabId)
    const insertIndex = appendIndex(body)
    const paragraphText = `\n${ String(text) }`
    const requests = [
      {
        insertText: {
          text: paragraphText,
          location: buildLocation({ index: insertIndex, tabId }),
        },
      },
    ]

    if (namedStyleType) {
      requests.push({
        updateParagraphStyle: {
          range: buildRange({
            startIndex: insertIndex + 1,
            endIndex: insertIndex + paragraphText.length,
            tabId,
          }),
          paragraphStyle: {
            namedStyleType: String(namedStyleType).toUpperCase(),
          },
          fields: 'namedStyleType',
        },
      })
    }

    return this.#batchUpdate(documentId, requests, { sortDescending: false })
  }

  // =============================== 9 FORMATTING — TEXT + PARAGRAPH ===============================

  /**
   * @operationName Format Text
   * @category Formatting
   * @description Applies one or more text-style attributes (bold, italic, underline, strikethrough, font, size, color, background, link) to a range. Only the attributes you set are touched; everything else is preserved.
   *
   * @route POST /format-text
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"Number","label":"Start Index","name":"startIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Character position where the selection begins (counting from 1)."}
   * @paramDef {"type":"Number","label":"End Index","name":"endIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Character position where the selection ends (this position is just past the last character to include)."}
   * @paramDef {"type":"Boolean","label":"Bold","name":"bold","uiComponent":{"type":"TOGGLE"},"description":"Toggle bold."}
   * @paramDef {"type":"Boolean","label":"Italic","name":"italic","uiComponent":{"type":"TOGGLE"},"description":"Toggle italic."}
   * @paramDef {"type":"Boolean","label":"Underline","name":"underline","uiComponent":{"type":"TOGGLE"},"description":"Toggle underline."}
   * @paramDef {"type":"Boolean","label":"Strikethrough","name":"strikethrough","uiComponent":{"type":"TOGGLE"},"description":"Toggle strikethrough."}
   * @paramDef {"type":"Number","label":"Font Size (pt)","name":"fontSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Font size in points (e.g. 11, 14, 18)."}
   * @paramDef {"type":"String","label":"Font Family","name":"fontFamily","description":"Font family name (e.g. Arial, Roboto, Georgia)."}
   * @paramDef {"type":"String","label":"Foreground Color","name":"foregroundColorHex","description":"Hex color like #1a73e8 or #fff."}
   * @paramDef {"type":"String","label":"Background Color","name":"backgroundColorHex","description":"Hex color like #fff4e5."}
   * @paramDef {"type":"String","label":"Link URL","name":"link","description":"Turn the selection into a clickable link to this URL (example: https://example.com)."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional tab to scope the formatting to."}
   * @paramDef {"type":"String","label":"Header or Footer","name":"segmentId","dictionary":"listHeadersFootersDictionary","description":"Optional. Apply to a header or footer instead of the main body."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async formatText(
    documentId,
    startIndex,
    endIndex,
    bold,
    italic,
    underline,
    strikethrough,
    fontSize,
    fontFamily,
    foregroundColorHex,
    backgroundColorHex,
    link,
    tabId,
    segmentId
  ) {
    if (!startIndex || !endIndex)
      throw new Error('Start and end indices are required')

    const { style, fields } = buildTextStyle({
      bold,
      italic,
      underline,
      strikethrough,
      fontSize,
      fontFamily,
      foregroundColorHex,
      backgroundColorHex,
      link,
    })

    if (!fields) throw new Error('Specify at least one formatting attribute')

    return this.#batchUpdate(documentId, [
      {
        updateTextStyle: {
          range: buildRange({
            startIndex: Number(startIndex),
            endIndex: Number(endIndex),
            tabId,
            segmentId,
          }),
          textStyle: style,
          fields,
        },
      },
    ])
  }

  /**
   * @operationName Set Text Link
   * @category Formatting
   * @description Wraps a range with a hyperlink. Shortcut over Format Text.
   *
   * @route POST /set-text-link
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"Number","label":"Start Index","name":"startIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Character position where the selection begins (counting from 1)."}
   * @paramDef {"type":"Number","label":"End Index","name":"endIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Character position where the selection ends (this position is just past the last character to include)."}
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"Where the link should point (example: https://example.com)."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async setTextLink(documentId, startIndex, endIndex, url, tabId) {
    if (!url) throw new Error('"URL" is required')

    return this.formatText(
      documentId,
      startIndex,
      endIndex,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      url,
      tabId,
      null
    )
  }

  /**
   * @operationName Clear Text Formatting
   * @category Formatting
   * @description Resets text styling (bold, italic, underline, font, color, link) over a range to the default. Paragraph-level style is left intact — use Apply Named Style to change Heading levels etc.
   *
   * @route POST /clear-text-formatting
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"Number","label":"Start Index","name":"startIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Character position where the selection begins (counting from 1)."}
   * @paramDef {"type":"Number","label":"End Index","name":"endIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Character position where the selection ends (this position is just past the last character to include)."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async clearTextFormatting(documentId, startIndex, endIndex, tabId) {
    return this.#batchUpdate(documentId, [
      {
        updateTextStyle: {
          range: buildRange({
            startIndex: Number(startIndex),
            endIndex: Number(endIndex),
            tabId,
          }),
          textStyle: {},
          fields:
            'bold,italic,underline,strikethrough,fontSize,weightedFontFamily,foregroundColor,backgroundColor,link,baselineOffset',
        },
      },
    ])
  }

  /**
   * @operationName Apply Named Style To Paragraph
   * @category Formatting
   * @description Sets a paragraph's named style (Normal text, Title, Subtitle, Heading 1–6). The named style controls font, size, color, and outline-tree membership.
   *
   * @route POST /apply-named-style
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"Number","label":"Start Index","name":"startIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Character position where the selection begins (counting from 1)."}
   * @paramDef {"type":"Number","label":"End Index","name":"endIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Character position where the selection ends (this position is just past the last character to include)."}
   * @paramDef {"type":"String","label":"Named Style","name":"namedStyleType","required":true,"dictionary":"listNamedStylesDictionary","description":"Target named style."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async applyNamedStyle(
    documentId,
    startIndex,
    endIndex,
    namedStyleType,
    tabId
  ) {
    if (!namedStyleType) throw new Error('"Named Style" is required')

    return this.#batchUpdate(documentId, [
      {
        updateParagraphStyle: {
          range: buildRange({
            startIndex: Number(startIndex),
            endIndex: Number(endIndex),
            tabId,
          }),
          paragraphStyle: {
            namedStyleType: String(namedStyleType).toUpperCase(),
          },
          fields: 'namedStyleType',
        },
      },
    ])
  }

  /**
   * @operationName Set Paragraph Alignment
   * @category Formatting
   * @description Aligns paragraphs across a stretch of the document — left, center, right, or justified (both edges). Use when formatting titles, headings, or quotation blocks. Applies to every paragraph that the selection touches.
   *
   * @route POST /set-paragraph-alignment
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"Number","label":"Start Index","name":"startIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Character position where the selection begins (counting from 1)."}
   * @paramDef {"type":"Number","label":"End Index","name":"endIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Character position where the selection ends (this position is just past the last character to include)."}
   * @paramDef {"type":"String","label":"Alignment","name":"alignment","required":true,"dictionary":"listParagraphAlignmentsDictionary","description":"START, CENTER, END, or JUSTIFIED."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async setParagraphAlignment(
    documentId,
    startIndex,
    endIndex,
    alignment,
    tabId
  ) {
    if (!alignment) throw new Error('"Alignment" is required')

    const { style, fields } = buildParagraphStyle({ alignment })

    return this.#batchUpdate(documentId, [
      {
        updateParagraphStyle: {
          range: buildRange({
            startIndex: Number(startIndex),
            endIndex: Number(endIndex),
            tabId,
          }),
          paragraphStyle: style,
          fields,
        },
      },
    ])
  }

  /**
   * @operationName Set Line Spacing
   * @category Formatting
   * @description Sets the line spacing for paragraphs in a stretch of the document. Use to make text denser (100% = single-spaced) or roomier (150% = 1.5×, 200% = double). Affects every paragraph the selection touches.
   *
   * @route POST /set-line-spacing
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"Number","label":"Start Index","name":"startIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Character position where the selection begins (counting from 1)."}
   * @paramDef {"type":"Number","label":"End Index","name":"endIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Character position where the selection ends (this position is just past the last character to include)."}
   * @paramDef {"type":"Number","label":"Line Spacing (%)","name":"lineSpacing","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Percentage of normal line height. 100 = single, 150 = 1.5x, 200 = double."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async setLineSpacing(documentId, startIndex, endIndex, lineSpacing, tabId) {
    const { style, fields } = buildParagraphStyle({ lineSpacing })

    return this.#batchUpdate(documentId, [
      {
        updateParagraphStyle: {
          range: buildRange({
            startIndex: Number(startIndex),
            endIndex: Number(endIndex),
            tabId,
          }),
          paragraphStyle: style,
          fields,
        },
      },
    ])
  }

  /**
   * @operationName Set Paragraph Indent
   * @category Formatting
   * @description Indents paragraphs from the left and/or right margin. Use for nested lists, block quotes, or call-out paragraphs. Measured in points (72 points = 1 inch).
   *
   * @route POST /set-paragraph-indent
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"Number","label":"Start Index","name":"startIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Character position where the selection begins (counting from 1)."}
   * @paramDef {"type":"Number","label":"End Index","name":"endIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Character position where the selection ends (this position is just past the last character to include)."}
   * @paramDef {"type":"Number","label":"Left Indent (pt)","name":"indentStartPt","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Indentation from left margin (points)."}
   * @paramDef {"type":"Number","label":"Right Indent (pt)","name":"indentEndPt","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Indentation from right margin (points)."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async setParagraphIndent(
    documentId,
    startIndex,
    endIndex,
    indentStartPt,
    indentEndPt,
    tabId
  ) {
    const { style, fields } = buildParagraphStyle({
      indentStartPt,
      indentEndPt,
    })

    if (!fields) throw new Error('Specify at least one indent attribute')

    return this.#batchUpdate(documentId, [
      {
        updateParagraphStyle: {
          range: buildRange({
            startIndex: Number(startIndex),
            endIndex: Number(endIndex),
            tabId,
          }),
          paragraphStyle: style,
          fields,
        },
      },
    ])
  }

  /**
   * @operationName Set Paragraph Spacing
   * @category Formatting
   * @description Adds blank space above and/or below paragraphs to give them breathing room. Useful between headings and body text. Measured in points (72 points = 1 inch).
   *
   * @route POST /set-paragraph-spacing
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"Number","label":"Start Index","name":"startIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Character position where the selection begins (counting from 1)."}
   * @paramDef {"type":"Number","label":"End Index","name":"endIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Character position where the selection ends (this position is just past the last character to include)."}
   * @paramDef {"type":"Number","label":"Space Above (pt)","name":"spaceAbovePt","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Points above each paragraph."}
   * @paramDef {"type":"Number","label":"Space Below (pt)","name":"spaceBelowPt","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Points below each paragraph."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async setParagraphSpacing(
    documentId,
    startIndex,
    endIndex,
    spaceAbovePt,
    spaceBelowPt,
    tabId
  ) {
    const { style, fields } = buildParagraphStyle({
      spaceAbovePt,
      spaceBelowPt,
    })

    if (!fields) throw new Error('Specify at least one spacing attribute')

    return this.#batchUpdate(documentId, [
      {
        updateParagraphStyle: {
          range: buildRange({
            startIndex: Number(startIndex),
            endIndex: Number(endIndex),
            tabId,
          }),
          paragraphStyle: style,
          fields,
        },
      },
    ])
  }

  /**
   * @operationName Set Paragraph Direction
   * @category Formatting
   * @description Sets the reading direction of paragraphs. Use Left to right for English and most languages; use Right to left for Arabic, Hebrew, Persian, and similar languages.
   *
   * @route POST /set-paragraph-direction
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"Number","label":"Start Index","name":"startIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Character position where the selection begins (counting from 1)."}
   * @paramDef {"type":"Number","label":"End Index","name":"endIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Character position where the selection ends (this position is just past the last character to include)."}
   * @paramDef {"type":"String","label":"Direction","name":"direction","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Left to Right","Right to Left"]}},"description":"Pick Left to Right for most languages, or Right to Left for Arabic, Hebrew, and similar."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async setParagraphDirection(
    documentId,
    startIndex,
    endIndex,
    direction,
    tabId
  ) {
    if (!direction) throw new Error('"Direction" is required')

    const { style, fields } = buildParagraphStyle({ direction })

    return this.#batchUpdate(documentId, [
      {
        updateParagraphStyle: {
          range: buildRange({
            startIndex: Number(startIndex),
            endIndex: Number(endIndex),
            tabId,
          }),
          paragraphStyle: style,
          fields,
        },
      },
    ])
  }

  // =============================== 10 LISTS & BULLETS ===============================

  /**
   * @operationName Apply Bullets
   * @category Formatting
   * @description Turns paragraphs in a range into a bulleted or numbered list. Pick a preset for the glyph style.
   *
   * @route POST /apply-bullets
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"Number","label":"Start Index","name":"startIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Character position where the selection begins (counting from 1)."}
   * @paramDef {"type":"Number","label":"End Index","name":"endIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Character position where the selection ends (this position is just past the last character to include)."}
   * @paramDef {"type":"String","label":"Preset","name":"preset","required":true,"dictionary":"listBulletPresetsDictionary","description":"Bullet/numbering preset."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async applyBullets(documentId, startIndex, endIndex, preset, tabId) {
    if (!preset) throw new Error('"Preset" is required')

    return this.#batchUpdate(documentId, [
      {
        createParagraphBullets: {
          range: buildRange({
            startIndex: Number(startIndex),
            endIndex: Number(endIndex),
            tabId,
          }),
          bulletPreset: bulletPreset(preset),
        },
      },
    ])
  }

  /**
   * @operationName Apply Numbered List
   * @category Formatting
   * @description Convenience wrapper around Apply Bullets that defaults to the standard numbered preset (1., 2., 3.).
   *
   * @route POST /apply-numbered-list
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"Number","label":"Start Index","name":"startIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Character position where the selection begins (counting from 1)."}
   * @paramDef {"type":"Number","label":"End Index","name":"endIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Character position where the selection ends (this position is just past the last character to include)."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async applyNumberedList(documentId, startIndex, endIndex, tabId) {
    return this.applyBullets(
      documentId,
      startIndex,
      endIndex,
      BULLET_PRESETS.numbered,
      tabId
    )
  }

  /**
   * @operationName Remove Bullets
   * @category Formatting
   * @description Removes the bullets or numbers from a list, turning it back into plain paragraphs. The text and its indentation stay where they are.
   *
   * @route POST /remove-bullets
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"Number","label":"Start Index","name":"startIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Character position where the selection begins (counting from 1)."}
   * @paramDef {"type":"Number","label":"End Index","name":"endIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Character position where the selection ends (this position is just past the last character to include)."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async removeBullets(documentId, startIndex, endIndex, tabId) {
    return this.#batchUpdate(documentId, [
      {
        deleteParagraphBullets: {
          range: buildRange({
            startIndex: Number(startIndex),
            endIndex: Number(endIndex),
            tabId,
          }),
        },
      },
    ])
  }

  // =============================== 11 TABLES ===============================

  /**
   * @operationName Insert Table
   * @category Tables
   * @description Inserts a table of the given dimensions. Use `Append To End` to skip computing an index — the table lands at the end of the body/tab.
   *
   * @route POST /insert-table
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"Number","label":"Rows","name":"rows","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of rows (1 or greater)."}
   * @paramDef {"type":"Number","label":"Columns","name":"columns","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of columns (1 or greater)."}
   * @paramDef {"type":"Number","label":"Index","name":"index","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Insertion index. Ignored when Append To End is true."}
   * @paramDef {"type":"Boolean","label":"Append To End","name":"appendToEnd","uiComponent":{"type":"TOGGLE"},"description":"When true, inserts the table at the end of the segment instead of at an index."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async insertTable(documentId, rows, columns, index, appendToEnd, tabId) {
    const r = Number(rows)
    const c = Number(columns)

    if (!(r > 0) || !(c > 0))
      throw new Error('Rows and Columns must be positive integers')

    const request = { insertTable: { rows: r, columns: c } }

    if (asBool(appendToEnd)) {
      request.insertTable.endOfSegmentLocation = tabId ? { tabId } : {}
    } else {
      if (!index) throw new Error('Either Index or Append To End is required')

      request.insertTable.location = buildLocation({
        index: Number(index),
        tabId,
      })
    }

    return this.#batchUpdate(documentId, [request], { sortDescending: false })
  }

  /**
   * @operationName Insert Table Row
   * @category Tables
   * @description Adds a new row to an existing table, above or below a reference cell. Use to grow a table when capturing more data.
   *
   * @route POST /insert-table-row
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"String","label":"Table","name":"tableStartIndex","required":true,"dictionary":"listTablesDictionary","description":"Pick the table to act on. The list shows each table's position, row count, and column count."}
   * @paramDef {"type":"Number","label":"Row Index","name":"rowIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Reference row number, starting at 0 (so 0 means the first row, 1 means the second, and so on)."}
   * @paramDef {"type":"Number","label":"Column Index","name":"columnIndex","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Reference column number, starting at 0 (default 0 = first column)."}
   * @paramDef {"type":"Boolean","label":"Insert Below","name":"insertBelow","uiComponent":{"type":"TOGGLE"},"description":"When true (default) inserts below; false inserts above."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async insertTableRow(
    documentId,
    tableStartIndex,
    rowIndex,
    columnIndex,
    insertBelow,
    tabId
  ) {
    return this.#batchUpdate(
      documentId,
      [
        {
          insertTableRow: {
            tableCellLocation: tableCellLoc({
              tableStartIndex,
              rowIndex,
              columnIndex,
              tabId,
            }),
            insertBelow:
              insertBelow === undefined ? true : asBool(insertBelow) !== false,
          },
        },
      ],
      { sortDescending: false }
    )
  }

  /**
   * @operationName Insert Table Column
   * @category Tables
   * @description Adds a new column to an existing table, to the left or right of a reference cell. Use to add a new field to data already in the table.
   *
   * @route POST /insert-table-column
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"String","label":"Table","name":"tableStartIndex","required":true,"dictionary":"listTablesDictionary","description":"Pick the table to act on. The list shows each table's position, row count, and column count."}
   * @paramDef {"type":"Number","label":"Row Index","name":"rowIndex","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Reference row number, starting at 0 (default 0 = first row)."}
   * @paramDef {"type":"Number","label":"Column Index","name":"columnIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Reference column number, starting at 0 (so 0 means the first column, 1 means the second, and so on)."}
   * @paramDef {"type":"Boolean","label":"Insert Right","name":"insertRight","uiComponent":{"type":"TOGGLE"},"description":"When true (default) inserts to the right; false inserts to the left."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async insertTableColumn(
    documentId,
    tableStartIndex,
    rowIndex,
    columnIndex,
    insertRight,
    tabId
  ) {
    return this.#batchUpdate(
      documentId,
      [
        {
          insertTableColumn: {
            tableCellLocation: tableCellLoc({
              tableStartIndex,
              rowIndex,
              columnIndex,
              tabId,
            }),
            insertRight:
              insertRight === undefined ? true : asBool(insertRight) !== false,
          },
        },
      ],
      { sortDescending: false }
    )
  }

  /**
   * @operationName Delete Table Row
   * @category Tables
   *
   * @route POST /delete-table-row
   * @appearanceColor #d93025 #ea4335
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"String","label":"Table","name":"tableStartIndex","required":true,"dictionary":"listTablesDictionary","description":"Pick the table to act on. The list shows each table's position, row count, and column count."}
   * @paramDef {"type":"Number","label":"Row Index","name":"rowIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Row number to delete, starting at 0 (so 0 means the first row)."}
   * @paramDef {"type":"Number","label":"Column Index","name":"columnIndex","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based column index (default 0)."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   * @description Removes a row from a table. Use when an entry is no longer needed. To clear a row without removing it, use Set Table Cell Text on each cell instead.
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async deleteTableRow(
    documentId,
    tableStartIndex,
    rowIndex,
    columnIndex,
    tabId
  ) {
    return this.#batchUpdate(documentId, [
      {
        deleteTableRow: {
          tableCellLocation: tableCellLoc({
            tableStartIndex,
            rowIndex,
            columnIndex,
            tabId,
          }),
        },
      },
    ])
  }

  /**
   * @operationName Delete Table Column
   * @category Tables
   *
   * @route POST /delete-table-column
   * @appearanceColor #d93025 #ea4335
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"String","label":"Table","name":"tableStartIndex","required":true,"dictionary":"listTablesDictionary","description":"Pick the table to act on. The list shows each table's position, row count, and column count."}
   * @paramDef {"type":"Number","label":"Row Index","name":"rowIndex","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Row number, starting at 0 (default 0 = first row)."}
   * @paramDef {"type":"Number","label":"Column Index","name":"columnIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Column number to delete, starting at 0 (so 0 means the first column)."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   * @description Removes a column from a table. Use when a field is no longer needed. To clear a column without removing it, use Set Table Cell Text on each cell instead.
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async deleteTableColumn(
    documentId,
    tableStartIndex,
    rowIndex,
    columnIndex,
    tabId
  ) {
    return this.#batchUpdate(documentId, [
      {
        deleteTableColumn: {
          tableCellLocation: tableCellLoc({
            tableStartIndex,
            rowIndex,
            columnIndex,
            tabId,
          }),
        },
      },
    ])
  }

  /**
   * @operationName Set Table Cell Text
   * @category Tables
   * @description Replaces all text in one cell of a table. Use to fill or update a single cell — for example, writing the result of a calculation into a totals row. The cell's existing content (if any) is cleared first.
   *
   * @route POST /set-table-cell-text
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"String","label":"Table","name":"tableStartIndex","required":true,"dictionary":"listTablesDictionary","description":"Pick the table to act on. The list shows each table's position, row count, and column count."}
   * @paramDef {"type":"Number","label":"Row Index","name":"rowIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Row number, starting at 0 (so 0 means the first row)."}
   * @paramDef {"type":"Number","label":"Column Index","name":"columnIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Column number, starting at 0 (so 0 means the first column)."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New cell content."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{},{}]}
   */
  async setTableCellText(
    documentId,
    tableStartIndex,
    rowIndex,
    columnIndex,
    text,
    tabId
  ) {
    const document = await this.#loadDoc(documentId, {
      includeTabsContent: true,
    })
    const cell = findTableCell(document, {
      tableStartIndex: Number(tableStartIndex),
      rowIndex: Number(rowIndex),
      columnIndex: Number(columnIndex),
      tabId,
    })

    if (!cell) throw new Error('Table cell not found at the given coordinates')

    const requests = []

    // Delete current cell content (skip the trailing newline).
    if (cell.contentEnd > cell.contentStart) {
      requests.push({
        deleteContentRange: {
          range: buildRange({
            startIndex: cell.contentStart,
            endIndex: cell.contentEnd,
            tabId,
          }),
        },
      })
    }

    requests.push({
      insertText: {
        text: String(text || ''),
        location: buildLocation({ index: cell.contentStart, tabId }),
      },
    })

    return this.#batchUpdate(documentId, requests, { sortDescending: false })
  }

  /**
   * @operationName Set Table Cell Style
   * @category Tables
   * @description Styles a rectangle of cells in a table — background color and vertical alignment. Use to highlight a header row or shade a totals row.
   *
   * @route POST /set-table-cell-style
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"String","label":"Table","name":"tableStartIndex","required":true,"dictionary":"listTablesDictionary","description":"Pick the table to act on. The list shows each table's position, row count, and column count."}
   * @paramDef {"type":"Number","label":"Row Start","name":"rowStart","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"First row (zero-based, inclusive)."}
   * @paramDef {"type":"Number","label":"Column Start","name":"columnStart","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"First column (zero-based, inclusive)."}
   * @paramDef {"type":"Number","label":"Row Span","name":"rowSpan","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of rows in the range (1 or greater)."}
   * @paramDef {"type":"Number","label":"Column Span","name":"columnSpan","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of columns in the range (1 or greater)."}
   * @paramDef {"type":"String","label":"Background Color","name":"backgroundColorHex","description":"Hex color (e.g. #fff4e5)."}
   * @paramDef {"type":"String","label":"Content Alignment","name":"contentAlignment","uiComponent":{"type":"DROPDOWN","options":{"values":["Top","Middle","Bottom"]}},"description":"How content lines up vertically inside each cell. Top puts content at the top of the cell, Middle centers it, Bottom puts it at the bottom."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async setTableCellStyle(
    documentId,
    tableStartIndex,
    rowStart,
    columnStart,
    rowSpan,
    columnSpan,
    backgroundColorHex,
    contentAlignment,
    tabId
  ) {
    const tableCellStyle = {}
    const fields = []

    if (backgroundColorHex) {
      const { style } = buildTextStyle({ backgroundColorHex })

      tableCellStyle.backgroundColor = style.backgroundColor
      fields.push('backgroundColor')
    }

    if (contentAlignment) {
      tableCellStyle.contentAlignment = normalizeAlignment(contentAlignment)
      fields.push('contentAlignment')
    }

    if (!fields.length) throw new Error('Specify at least one style attribute')

    return this.#batchUpdate(documentId, [
      {
        updateTableCellStyle: {
          tableRange: {
            tableCellLocation: tableCellLoc({
              tableStartIndex,
              rowIndex: rowStart,
              columnIndex: columnStart,
              tabId,
            }),
            rowSpan: Number(rowSpan),
            columnSpan: Number(columnSpan),
          },
          tableCellStyle,
          fields: fields.join(','),
        },
      },
    ])
  }

  /**
   * @operationName Set Table Column Width
   * @category Tables
   * @description Resizes columns in a table. Choose a fixed width in points (72 points = 1 inch), or pass 0 to let Google space the columns evenly. Use when fitting a table to a layout or making a column wide enough for long text.
   *
   * @route POST /set-table-column-width
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"String","label":"Table","name":"tableStartIndex","required":true,"dictionary":"listTablesDictionary","description":"Pick the table to act on. The list shows each table's position, row count, and column count."}
   * @paramDef {"type":"Array","label":"Column Indices","name":"columnIndices","required":true,"description":"Zero-based column indices to resize, as a list of numbers (e.g. [0, 2])."}
   * @paramDef {"type":"Number","label":"Width (pt)","name":"widthPt","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Width in points (72 pt = 1 inch). Pass 0 to make the column 'fit content'."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async setTableColumnWidth(
    documentId,
    tableStartIndex,
    columnIndices,
    widthPt,
    tabId
  ) {
    const indices = toArray(columnIndices)
      .map(Number)
      .filter(n => Number.isFinite(n))

    if (!indices.length) throw new Error('"Column Indices" is required')

    const isFitContent = Number(widthPt) === 0

    return this.#batchUpdate(documentId, [
      {
        updateTableColumnProperties: {
          tableStartLocation: buildLocation({
            index: Number(tableStartIndex),
            tabId,
          }),
          columnIndices: indices,
          tableColumnProperties: isFitContent
            ? { widthType: 'EVENLY_DISTRIBUTED' }
            : {
              widthType: 'FIXED_WIDTH',
              width: { magnitude: Number(widthPt), unit: 'PT' },
            },
          fields: 'widthType,width',
        },
      },
    ])
  }

  /**
   * @operationName Set Table Row Height
   * @category Tables
   * @description Sets a minimum height for one or more table rows in points (72 points = 1 inch). Use to give a header row consistent vertical space.
   *
   * @route POST /set-table-row-height
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"String","label":"Table","name":"tableStartIndex","required":true,"dictionary":"listTablesDictionary","description":"Pick the table to act on. The list shows each table's position, row count, and column count."}
   * @paramDef {"type":"Array","label":"Row Indices","name":"rowIndices","required":true,"description":"Zero-based row indices to resize, as a list of numbers (e.g. [0, 2])."}
   * @paramDef {"type":"Number","label":"Min Height (pt)","name":"minHeightPt","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Minimum row height in points."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async setTableRowHeight(
    documentId,
    tableStartIndex,
    rowIndices,
    minHeightPt,
    tabId
  ) {
    const indices = toArray(rowIndices)
      .map(Number)
      .filter(n => Number.isFinite(n))

    if (!indices.length) throw new Error('"Row Indices" is required')

    return this.#batchUpdate(documentId, [
      {
        updateTableRowStyle: {
          tableStartLocation: buildLocation({
            index: Number(tableStartIndex),
            tabId,
          }),
          rowIndices: indices,
          tableRowStyle: {
            minRowHeight: { magnitude: Number(minHeightPt), unit: 'PT' },
          },
          fields: 'minRowHeight',
        },
      },
    ])
  }

  /**
   * @operationName Merge Table Cells
   * @category Tables
   * @description Combines a rectangle of table cells into one larger cell. Use for spanning a header across columns or grouping related fields.
   *
   * @route POST /merge-table-cells
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"String","label":"Table","name":"tableStartIndex","required":true,"dictionary":"listTablesDictionary","description":"Pick the table to act on. The list shows each table's position, row count, and column count."}
   * @paramDef {"type":"Number","label":"Row Start","name":"rowStart","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"First row (zero-based, inclusive)."}
   * @paramDef {"type":"Number","label":"Column Start","name":"columnStart","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"First column (zero-based, inclusive)."}
   * @paramDef {"type":"Number","label":"Row Span","name":"rowSpan","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of rows to merge (1 or greater)."}
   * @paramDef {"type":"Number","label":"Column Span","name":"columnSpan","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of columns to merge (1 or greater)."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async mergeTableCells(
    documentId,
    tableStartIndex,
    rowStart,
    columnStart,
    rowSpan,
    columnSpan,
    tabId
  ) {
    return this.#batchUpdate(documentId, [
      {
        mergeTableCells: {
          tableRange: {
            tableCellLocation: tableCellLoc({
              tableStartIndex,
              rowIndex: rowStart,
              columnIndex: columnStart,
              tabId,
            }),
            rowSpan: Number(rowSpan),
            columnSpan: Number(columnSpan),
          },
        },
      },
    ])
  }

  /**
   * @operationName Unmerge Table Cells
   * @category Tables
   * @description Splits cells that were previously merged back into separate cells. The cell content stays in the top-left cell of the original merge.
   *
   * @route POST /unmerge-table-cells
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"String","label":"Table","name":"tableStartIndex","required":true,"dictionary":"listTablesDictionary","description":"Pick the table to act on. The list shows each table's position, row count, and column count."}
   * @paramDef {"type":"Number","label":"Row Start","name":"rowStart","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"First row (zero-based)."}
   * @paramDef {"type":"Number","label":"Column Start","name":"columnStart","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"First column (zero-based)."}
   * @paramDef {"type":"Number","label":"Row Span","name":"rowSpan","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Row span."}
   * @paramDef {"type":"Number","label":"Column Span","name":"columnSpan","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Column span."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async unmergeTableCells(
    documentId,
    tableStartIndex,
    rowStart,
    columnStart,
    rowSpan,
    columnSpan,
    tabId
  ) {
    return this.#batchUpdate(documentId, [
      {
        unmergeTableCells: {
          tableRange: {
            tableCellLocation: tableCellLoc({
              tableStartIndex,
              rowIndex: rowStart,
              columnIndex: columnStart,
              tabId,
            }),
            rowSpan: Number(rowSpan),
            columnSpan: Number(columnSpan),
          },
        },
      },
    ])
  }

  /**
   * @operationName Pin Table Header Rows
   * @category Tables
   * @description Marks the top rows of a table as header rows that repeat at the top of each page when the table spans multiple pages. Use for long tables where the column labels need to stay visible. Pass 0 to clear the freeze.
   *
   * @route POST /pin-table-header-rows
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"String","label":"Table","name":"tableStartIndex","required":true,"dictionary":"listTablesDictionary","description":"Pick the table to act on. The list shows each table's position, row count, and column count."}
   * @paramDef {"type":"Number","label":"Header Rows","name":"headerRowCount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of header rows to pin (0 disables)."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async pinTableHeaderRows(documentId, tableStartIndex, headerRowCount, tabId) {
    return this.#batchUpdate(documentId, [
      {
        pinTableHeaderRows: {
          tableStartLocation: buildLocation({
            index: Number(tableStartIndex),
            tabId,
          }),
          pinnedHeaderRowsCount: Number(headerRowCount),
        },
      },
    ])
  }

  // =============================== 12 IMAGES ===============================

  /**
   * @operationName Insert Inline Image
   * @category Images
   * @description Inserts an image at a specific index. The image must be reachable from a public URL (PNG/JPEG/GIF, ≤ 50 MB, ≤ 25 megapixels).
   *
   * @route POST /insert-inline-image
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"String","label":"Image URL","name":"imageUrl","required":true,"description":"Publicly-reachable HTTPS URL of the image."}
   * @paramDef {"type":"Number","label":"Index","name":"index","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Insertion index."}
   * @paramDef {"type":"Number","label":"Width (pt)","name":"widthPt","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional width in points (72 pt = 1 inch). If omitted, uses the image's native size."}
   * @paramDef {"type":"Number","label":"Height (pt)","name":"heightPt","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional height in points."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","inlineObjectId":"img-001"}
   */
  async insertInlineImage(
    documentId,
    imageUrl,
    index,
    widthPt,
    heightPt,
    tabId
  ) {
    if (!imageUrl) throw new Error('"Image URL" is required')

    if (!index) throw new Error('"Index" is required')

    const request = {
      insertInlineImage: {
        uri: imageUrl,
        location: buildLocation({ index: Number(index), tabId }),
      },
    }

    if (widthPt || heightPt) {
      request.insertInlineImage.objectSize = {}

      if (widthPt)
        request.insertInlineImage.objectSize.width = {
          magnitude: Number(widthPt),
          unit: 'PT',
        }

      if (heightPt)
        request.insertInlineImage.objectSize.height = {
          magnitude: Number(heightPt),
          unit: 'PT',
        }
    }

    const result = await this.#batchUpdate(documentId, [request], {
      sortDescending: false,
    })

    return {
      documentId: result.documentId,
      inlineObjectId: result.replies?.[0]?.insertInlineImage?.objectId || null,
    }
  }

  /**
   * @operationName Append Inline Image
   * @category Images
   * @description Inserts an image at the end of the document/tab.
   *
   * @route POST /append-inline-image
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"String","label":"Image URL","name":"imageUrl","required":true,"description":"Publicly-reachable HTTPS URL."}
   * @paramDef {"type":"Number","label":"Width (pt)","name":"widthPt","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional width in points."}
   * @paramDef {"type":"Number","label":"Height (pt)","name":"heightPt","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional height in points."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","inlineObjectId":"img-001"}
   */
  async appendInlineImage(documentId, imageUrl, widthPt, heightPt, tabId) {
    if (!imageUrl) throw new Error('"Image URL" is required')

    const request = {
      insertInlineImage: {
        uri: imageUrl,
        endOfSegmentLocation: tabId ? { tabId } : {},
      },
    }

    if (widthPt || heightPt) {
      request.insertInlineImage.objectSize = {}

      if (widthPt)
        request.insertInlineImage.objectSize.width = {
          magnitude: Number(widthPt),
          unit: 'PT',
        }

      if (heightPt)
        request.insertInlineImage.objectSize.height = {
          magnitude: Number(heightPt),
          unit: 'PT',
        }
    }

    const result = await this.#batchUpdate(documentId, [request], {
      sortDescending: false,
    })

    return {
      documentId: result.documentId,
      inlineObjectId: result.replies?.[0]?.insertInlineImage?.objectId || null,
    }
  }

  /**
   * @operationName Replace Image
   * @category Images
   * @description Swaps an existing inline image's source for a new URL. Use List Inline Images to discover the inlineObjectId.
   *
   * @route POST /replace-image
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"String","label":"Image","name":"inlineObjectId","required":true,"dictionary":"listImagesDictionary","description":"Inline object ID of the image to replace."}
   * @paramDef {"type":"String","label":"New Image URL","name":"newImageUrl","required":true,"description":"Publicly-reachable HTTPS URL of the replacement image."}
   * @paramDef {"type":"String","label":"Replacement Method","name":"replacementMethod","uiComponent":{"type":"DROPDOWN","options":{"values":["Crop to Fit","Default"]}},"description":"How the new image should fit the existing image's space. Crop to Fit centers and crops the new image to match the old shape; Default lets Google decide."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async replaceImage(
    documentId,
    inlineObjectId,
    newImageUrl,
    replacementMethod
  ) {
    if (!inlineObjectId) throw new Error('"Image" is required')

    if (!newImageUrl) throw new Error('"New Image URL" is required')

    return this.#batchUpdate(
      documentId,
      [
        {
          replaceImage: {
            imageObjectId: inlineObjectId,
            uri: newImageUrl,
            imageReplaceMethod: normalizeImageReplaceMethod(replacementMethod),
          },
        },
      ],
      { sortDescending: false }
    )
  }

  /**
   * @operationName Delete Positioned Object
   * @category Images
   * @description Removes a floating image or shape from the document — the kind that sits in a fixed spot on the page, not within the text flow. Note: this service can remove floating objects but cannot create new ones.
   *
   * @route POST /delete-positioned-object
   * @appearanceColor #d93025 #ea4335
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"String","label":"Object ID","name":"objectId","required":true,"freeform":true,"description":"Positioned object ID. Floating objects are not listable by a picker; copy this ID from the positionedObjects map returned by Get Document (Full Detail)."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async deletePositionedObject(documentId, objectId, tabId) {
    if (!objectId) throw new Error('"Object ID" is required')

    const request = { deletePositionedObject: { objectId } }

    if (tabId) request.deletePositionedObject.tabId = tabId

    return this.#batchUpdate(documentId, [request])
  }

  // =============================== 13 STRUCTURE ===============================

  /**
   * @operationName Insert Page Break
   * @category Structure
   * @description Inserts a page break at a specific position so the content after it starts on a new page. Use before chapter headings or to force a clean print layout.
   *
   * @route POST /insert-page-break
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"Number","label":"Index","name":"index","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Insertion index."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async insertPageBreak(documentId, index, tabId) {
    return this.#batchUpdate(documentId, [
      {
        insertPageBreak: {
          location: buildLocation({ index: Number(index), tabId }),
        },
      },
    ])
  }

  /**
   * @operationName Insert Section Break
   * @category Structure
   * @description Inserts a section break. Sections let different parts of a document have different margins, columns, headers, or footers. Pick "New page" to also start a new page, or "Same page" to change layout without forcing a page break.
   *
   * @route POST /insert-section-break
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"Number","label":"Index","name":"index","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Insertion index."}
   * @paramDef {"type":"String","label":"Section Type","name":"sectionType","uiComponent":{"type":"DROPDOWN","options":{"values":["Same Page","New Page"]}},"description":"Same Page = the break does not start a new page (you can still change margins or columns after it). New Page = forces the content after the break onto a new page. Default: Same Page."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async insertSectionBreak(documentId, index, sectionType, tabId) {
    return this.#batchUpdate(documentId, [
      {
        insertSectionBreak: {
          location: buildLocation({ index: Number(index), tabId }),
          sectionType: normalizeSectionType(sectionType),
        },
      },
    ])
  }

  /**
   * @operationName Create Header
   * @category Structure
   * @description Adds a header to the document (the area that repeats at the top of every page). Returns an ID for the new header — pass it as the "Header or Footer" parameter in other actions to add text or formatting inside the header. Use the optional Initial Text field to write something into the header in one step.
   *
   * @route POST /create-header
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"String","label":"Initial Text","name":"text","description":"Optional text to insert into the new header immediately."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","headerId":"hdr-001"}
   */
  async createHeader(documentId, text) {
    const request = {
      createHeader: { type: 'DEFAULT' },
    }
    const result = await this.#batchUpdate(documentId, [request], {
      sortDescending: false,
    })
    const headerId = result.replies?.[0]?.createHeader?.headerId

    if (headerId && text) {
      await this.#batchUpdate(
        documentId,
        [
          {
            insertText: {
              text: String(text),
              location: { index: 0, segmentId: headerId },
            },
          },
        ],
        { sortDescending: false }
      )
    }

    return { documentId: result.documentId, headerId }
  }

  /**
   * @operationName Create Footer
   * @category Structure
   * @description Adds a footer to the document (the area that repeats at the bottom of every page). Returns an ID for the new footer — pass it as the "Header or Footer" parameter in other actions to add text or formatting inside the footer. Use the optional Initial Text field to write something into the footer in one step.
   *
   * @route POST /create-footer
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"String","label":"Initial Text","name":"text","description":"Optional text to insert immediately."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","footerId":"ftr-001"}
   */
  async createFooter(documentId, text) {
    const request = {
      createFooter: { type: 'DEFAULT' },
    }
    const result = await this.#batchUpdate(documentId, [request], {
      sortDescending: false,
    })
    const footerId = result.replies?.[0]?.createFooter?.footerId

    if (footerId && text) {
      await this.#batchUpdate(
        documentId,
        [
          {
            insertText: {
              text: String(text),
              location: { index: 0, segmentId: footerId },
            },
          },
        ],
        { sortDescending: false }
      )
    }

    return { documentId: result.documentId, footerId }
  }

  /**
   * @operationName Delete Header
   * @category Structure
   *
   * @route POST /delete-header
   * @appearanceColor #d93025 #ea4335
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @description Removes a header from the document. The header area, and anything you put in it, disappears.
   *
   * @paramDef {"type":"String","label":"Header","name":"headerId","required":true,"dictionary":"listHeadersFootersDictionary","description":"Header to remove."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async deleteHeader(documentId, headerId) {
    if (!headerId) throw new Error('"Header" is required')

    return this.#batchUpdate(documentId, [{ deleteHeader: { headerId } }], {
      sortDescending: false,
    })
  }

  /**
   * @operationName Delete Footer
   * @category Structure
   *
   * @route POST /delete-footer
   * @appearanceColor #d93025 #ea4335
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @description Removes a footer from the document. The footer area, and anything you put in it, disappears.
   *
   * @paramDef {"type":"String","label":"Footer","name":"footerId","required":true,"dictionary":"listHeadersFootersDictionary","description":"Footer to remove."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async deleteFooter(documentId, footerId) {
    if (!footerId) throw new Error('"Footer" is required')

    return this.#batchUpdate(documentId, [{ deleteFooter: { footerId } }], {
      sortDescending: false,
    })
  }

  /**
   * @operationName Set Header Or Footer Text
   * @category Structure
   * @description Replaces all content inside a header or footer with new text. Use this when refreshing a recurring page header (for example, putting the current month into a report footer).
   *
   * @route POST /set-header-or-footer-text
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"String","label":"Header or Footer","name":"segmentId","required":true,"dictionary":"listHeadersFootersDictionary","description":"Header or footer to overwrite."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New content."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{},{}]}
   */
  async setHeaderOrFooterText(documentId, segmentId, text) {
    if (!segmentId) throw new Error('"Segment" is required')

    const document = await this.#loadDoc(documentId, {
      includeTabsContent: true,
    })
    const segment = iterSegments(document).find(
      s => s.segmentId === segmentId
    )

    if (!segment) throw new Error('Segment not found')

    const start = 0
    const endIndex = Math.max(
      0,
      (segment.body?.content?.[segment.body.content.length - 1]?.endIndex ||
        1) - 1
    )
    const requests = []

    if (endIndex > start) {
      requests.push({
        deleteContentRange: {
          range: { startIndex: 0, endIndex, segmentId },
        },
      })
    }

    requests.push({
      insertText: {
        text: String(text || ''),
        location: { index: 0, segmentId },
      },
    })

    return this.#batchUpdate(documentId, requests, { sortDescending: false })
  }

  /**
   * @operationName Create Footnote
   * @category Structure
   * @description Adds a footnote anchor at a specific position in the document. Returns an ID for the new footnote — pass that ID as the "Header or Footer" parameter to add text inside the footnote. Use the optional Footnote Text field to write the footnote content in one step.
   *
   * @route POST /create-footnote
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"Number","label":"Index","name":"index","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Where to insert the footnote reference."}
   * @paramDef {"type":"String","label":"Footnote Text","name":"text","description":"Optional text to insert into the new footnote segment."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","footnoteId":"fn-001"}
   */
  async createFootnote(documentId, index, text, tabId) {
    const result = await this.#batchUpdate(
      documentId,
      [
        {
          createFootnote: {
            location: buildLocation({ index: Number(index), tabId }),
          },
        },
      ],
      { sortDescending: false }
    )

    const footnoteId = result.replies?.[0]?.createFootnote?.footnoteId

    if (footnoteId && text) {
      await this.#batchUpdate(
        documentId,
        [
          {
            insertText: {
              text: String(text),
              location: { index: 0, segmentId: footnoteId },
            },
          },
        ],
        { sortDescending: false }
      )
    }

    return { documentId: result.documentId, footnoteId }
  }

  /**
   * @operationName Create Named Range
   * @category Structure
   * @description Labels a range with a name. Named ranges survive collaborative edits — perfect anchors for repeatable insertions or replacements.
   *
   * @route POST /create-named-range
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Range name (multiple ranges can share a name)."}
   * @paramDef {"type":"Number","label":"Start Index","name":"startIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Inclusive start."}
   * @paramDef {"type":"Number","label":"End Index","name":"endIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Exclusive end."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   * @paramDef {"type":"String","label":"Header or Footer","name":"segmentId","dictionary":"listHeadersFootersDictionary","description":"Optional. Apply to a header or footer instead of the main body."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","namedRangeId":"range-001"}
   */
  async createNamedRange(
    documentId,
    name,
    startIndex,
    endIndex,
    tabId,
    segmentId
  ) {
    if (!name) throw new Error('"Name" is required')

    const result = await this.#batchUpdate(
      documentId,
      [
        {
          createNamedRange: {
            name,
            range: buildRange({
              startIndex: Number(startIndex),
              endIndex: Number(endIndex),
              tabId,
              segmentId,
            }),
          },
        },
      ],
      { sortDescending: false }
    )

    return {
      documentId: result.documentId,
      namedRangeId: result.replies?.[0]?.createNamedRange?.namedRangeId || null,
    }
  }

  /**
   * @operationName Delete Named Range
   * @category Structure
   * @description Removes the label from a labeled section ("named range") so it is no longer reusable. The text itself stays — only the label is dropped. If you pass a name, every section sharing that name is unlabeled at once.
   *
   * @route POST /delete-named-range
   * @appearanceColor #d93025 #ea4335
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"String","label":"Label Name","name":"name","dictionary":"listNamedRangesDictionary","description":"Pick the label by name. All sections sharing this name will be unlabeled at once."}
   * @paramDef {"type":"String","label":"Label ID","name":"namedRangeId","freeform":true,"description":"Alternative: paste a specific label ID instead of picking by name (use the Label Name list above to pick from a list). Only fill in one — the name or the ID."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async deleteNamedRange(documentId, name, namedRangeId) {
    if (!name && !namedRangeId) throw new Error('Provide either Name or ID')

    const body = namedRangeId ? { namedRangeId } : { name }

    return this.#batchUpdate(documentId, [{ deleteNamedRange: body }], {
      sortDescending: false,
    })
  }

  /**
   * @operationName Update Section Style
   * @category Structure
   * @description Sets margins (top, bottom, left, right) for one section of the document. Use when a part of the document needs different page edges — for example wider margins on a cover page. The selection should cover the section you want to change.
   *
   * @route POST /update-section-style
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"Number","label":"Start Index","name":"startIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Inclusive start of the section."}
   * @paramDef {"type":"Number","label":"End Index","name":"endIndex","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Exclusive end of the section."}
   * @paramDef {"type":"Number","label":"Top Margin (pt)","name":"marginTopPt","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Top margin in points (72 points = 1 inch). Example: 72."}
   * @paramDef {"type":"Number","label":"Bottom Margin (pt)","name":"marginBottomPt","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Bottom margin in points (72 points = 1 inch)."}
   * @paramDef {"type":"Number","label":"Left Margin (pt)","name":"marginLeftPt","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Left margin in points (72 points = 1 inch)."}
   * @paramDef {"type":"Number","label":"Right Margin (pt)","name":"marginRightPt","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Right margin in points (72 points = 1 inch)."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async updateSectionStyle(
    documentId,
    startIndex,
    endIndex,
    marginTopPt,
    marginBottomPt,
    marginLeftPt,
    marginRightPt,
    tabId
  ) {
    const sectionStyle = {}
    const fields = []

    if (marginTopPt !== undefined && marginTopPt !== null) {
      sectionStyle.marginTop = { magnitude: Number(marginTopPt), unit: 'PT' }
      fields.push('marginTop')
    }

    if (marginBottomPt !== undefined && marginBottomPt !== null) {
      sectionStyle.marginBottom = {
        magnitude: Number(marginBottomPt),
        unit: 'PT',
      }

      fields.push('marginBottom')
    }

    if (marginLeftPt !== undefined && marginLeftPt !== null) {
      sectionStyle.marginLeft = { magnitude: Number(marginLeftPt), unit: 'PT' }
      fields.push('marginLeft')
    }

    if (marginRightPt !== undefined && marginRightPt !== null) {
      sectionStyle.marginRight = {
        magnitude: Number(marginRightPt),
        unit: 'PT',
      }

      fields.push('marginRight')
    }

    if (!fields.length) throw new Error('Specify at least one margin')

    return this.#batchUpdate(documentId, [
      {
        updateSectionStyle: {
          range: buildRange({
            startIndex: Number(startIndex),
            endIndex: Number(endIndex),
            tabId,
          }),
          sectionStyle,
          fields: fields.join(','),
        },
      },
    ])
  }

  // =============================== 14 DOCUMENT-LEVEL STYLES ===============================

  /**
   * @operationName Update Document Style
   * @category Structure
   * @description Sets page size and margins for the whole document. Use to switch paper sizes (US Letter ↔ A4), tighten or loosen margins, or both. To change just one section, use Update Section Style instead.
   *
   * @route POST /update-document-style
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"Number","label":"Page Width (pt)","name":"pageWidthPt","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page width in points (72 points = 1 inch). 612 = US Letter (8.5\"), 595 = A4."}
   * @paramDef {"type":"Number","label":"Page Height (pt)","name":"pageHeightPt","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page height in points (72 points = 1 inch). 792 = US Letter (11\"), 842 = A4."}
   * @paramDef {"type":"Number","label":"Top Margin (pt)","name":"marginTopPt","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Top margin in points (72 points = 1 inch). Example: 72."}
   * @paramDef {"type":"Number","label":"Bottom Margin (pt)","name":"marginBottomPt","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Bottom margin in points (72 points = 1 inch)."}
   * @paramDef {"type":"Number","label":"Left Margin (pt)","name":"marginLeftPt","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Left margin in points (72 points = 1 inch)."}
   * @paramDef {"type":"Number","label":"Right Margin (pt)","name":"marginRightPt","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Right margin in points (72 points = 1 inch)."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async updateDocumentStyle(
    documentId,
    pageWidthPt,
    pageHeightPt,
    marginTopPt,
    marginBottomPt,
    marginLeftPt,
    marginRightPt
  ) {
    const documentStyle = {}
    const fields = []

    if (pageWidthPt || pageHeightPt) {
      const pageSize = {}

      if (pageWidthPt)
        pageSize.width = { magnitude: Number(pageWidthPt), unit: 'PT' }

      if (pageHeightPt)
        pageSize.height = { magnitude: Number(pageHeightPt), unit: 'PT' }

      documentStyle.pageSize = pageSize
      fields.push('pageSize')
    }

    const margins = {
      marginTop: marginTopPt,
      marginBottom: marginBottomPt,
      marginLeft: marginLeftPt,
      marginRight: marginRightPt,
    }

    for (const [k, v] of Object.entries(margins)) {
      if (v !== undefined && v !== null) {
        documentStyle[k] = { magnitude: Number(v), unit: 'PT' }
        fields.push(k)
      }
    }

    if (!fields.length) throw new Error('Specify at least one style attribute')

    return this.#batchUpdate(
      documentId,
      [
        {
          updateDocumentStyle: { documentStyle, fields: fields.join(',') },
        },
      ],
      { sortDescending: false }
    )
  }

  /**
   * @operationName Set Document Background Color
   * @category Structure
   * @description Sets the background color of every page in the document. Use for branded layouts. Pass a hex color (for example #f5f5f5 for light gray).
   *
   * @route POST /set-document-background-color
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"String","label":"Color","name":"colorHex","required":true,"description":"Hex color (e.g. #f5f5f5)."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async setDocumentBackgroundColor(documentId, colorHex) {
    if (!colorHex) throw new Error('"Color" is required')

    const { style } = buildTextStyle({ foregroundColorHex: colorHex })

    return this.#batchUpdate(
      documentId,
      [
        {
          updateDocumentStyle: {
            documentStyle: {
              background: { color: style.foregroundColor.color },
            },
            fields: 'background',
          },
        },
      ],
      { sortDescending: false }
    )
  }

  /**
   * @operationName Set Page Orientation
   * @category Structure
   * @description Switches the document between portrait (taller than wide) and landscape (wider than tall) orientation. Page width and height are swapped automatically.
   *
   * @route POST /set-page-orientation
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"String","label":"Orientation","name":"orientation","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Portrait","Landscape"]}},"description":"Portrait (taller than wide) or Landscape (wider than tall)."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async setPageOrientation(documentId, orientation) {
    if (!orientation) throw new Error('"Orientation" is required')

    const document = await this.#loadDoc(documentId, {
      includeTabsContent: false,
    })
    const pageSize = document.documentStyle?.pageSize || {
      width: { magnitude: 612, unit: 'PT' },
      height: { magnitude: 792, unit: 'PT' },
    }
    const w = pageSize.width?.magnitude || 612
    const h = pageSize.height?.magnitude || 792
    const wantLandscape = normalizeOrientation(orientation) === 'landscape'
    const newWidth = wantLandscape ? Math.max(w, h) : Math.min(w, h)
    const newHeight = wantLandscape ? Math.min(w, h) : Math.max(w, h)

    return this.#batchUpdate(
      documentId,
      [
        {
          updateDocumentStyle: {
            documentStyle: {
              pageSize: {
                width: { magnitude: newWidth, unit: 'PT' },
                height: { magnitude: newHeight, unit: 'PT' },
              },
            },
            fields: 'pageSize',
          },
        },
      ],
      { sortDescending: false }
    )
  }

  // =============================== 15 TABS ===============================

  /**
   * @operationName List Tabs
   * @category Tabs
   * @description Returns the tabs in a document with their order and any parent/child relationships. Use this to map out the document's structure before editing a specific tab. Documents without explicit tabs return a single "Tab 1" entry.
   *
   * @route POST /list-tabs
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to inspect."}
   *
   * @returns {Object}
   * @sampleResult {"tabs":[{"tabId":"t.0","title":"Overview","index":0}]}
   */
  async listTabs(documentId) {
    const document = await this.#loadDoc(documentId, {
      includeTabsContent: true,
    })
    const tabs = flattenTabs(document.tabs || [])

    return {
      documentId: this.#ensureDocId(documentId),
      tabs: tabs.length ? tabs : [{ tabId: 't.0', title: 'Tab 1', index: 0 }],
    }
  }

  /**
   * @operationName Create Tab
   * @category Tabs
   * @description Adds a new tab to the document. Use this to organize content into separate tabs — for example a "Summary" tab and an "Appendix" tab. Optionally nest the tab inside another tab.
   *
   * @route POST /create-tab
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Tab title."}
   * @paramDef {"type":"String","label":"Parent Tab","name":"parentTabId","dictionary":"listTabsDictionary","description":"Optional parent tab to nest under."}
   * @paramDef {"type":"Number","label":"Index","name":"index","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional zero-based sibling position."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","tabId":"t.5"}
   */
  async createTab(documentId, title, parentTabId, index) {
    if (!title) throw new Error('"Title" is required')

    const request = {
      addDocumentTab: { tabProperties: { title } },
    }

    if (parentTabId)
      request.addDocumentTab.tabProperties.parentTabId = parentTabId

    if (index !== undefined && index !== null)
      request.addDocumentTab.tabProperties.index = Number(index)

    const result = await this.#batchUpdate(documentId, [request], {
      sortDescending: false,
    })
    const tabId = result.replies?.[0]?.addDocumentTab?.tabProperties?.tabId

    return { documentId: result.documentId, tabId }
  }

  /**
   * @operationName Rename / Reorder Tab
   * @category Tabs
   * @description Renames a tab, changes its position relative to other tabs, or moves it under a different parent tab. Fill in only the fields you want to change.
   *
   * @route POST /update-tab
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","required":true,"dictionary":"listTabsDictionary","description":"Tab to update."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New title (omit to leave unchanged)."}
   * @paramDef {"type":"Number","label":"Index","name":"index","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New sibling position."}
   * @paramDef {"type":"String","label":"Parent Tab","name":"parentTabId","dictionary":"listTabsDictionary","description":"New parent tab (omit to leave unchanged)."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async updateTab(documentId, tabId, title, index, parentTabId) {
    if (!tabId) throw new Error('"Tab" is required')

    const tabProperties = { tabId }
    const fields = []

    if (title) {
      tabProperties.title = title
      fields.push('title')
    }

    if (index !== undefined && index !== null) {
      tabProperties.index = Number(index)
      fields.push('index')
    }

    if (parentTabId) {
      tabProperties.parentTabId = parentTabId
      fields.push('parentTabId')
    }

    if (!fields.length)
      throw new Error('Provide at least one attribute to update')

    return this.#batchUpdate(
      documentId,
      [
        {
          updateDocumentTabProperties: {
            tabProperties,
            fields: fields.join(','),
          },
        },
      ],
      { sortDescending: false }
    )
  }

  /**
   * @operationName Delete Tab
   * @category Tabs
   *
   * @route POST /delete-tab
   * @appearanceColor #d93025 #ea4335
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","required":true,"dictionary":"listTabsDictionary","description":"Tab to delete."}
   * @description Removes a tab from the document along with everything inside it. Any tabs nested under it are deleted too. Cannot be undone — use carefully.
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async deleteTab(documentId, tabId) {
    if (!tabId) throw new Error('"Tab" is required')

    return this.#batchUpdate(documentId, [{ deleteTab: { tabId } }], {
      sortDescending: false,
    })
  }

  // =============================== 16 SMART INSERTS ===============================

  /**
   * @operationName Insert Person Mention
   * @category Smart Inserts
   * @description Writes a plain-text @-mention (the literal text "@email") at a specific position — for example "@user@example.com". This is ordinary document text, not a Google Docs smart chip: it is not clickable and does not notify the person (the Docs API cannot create interactive people chips). Use it to reference a collaborator or flag an action item in the wording.
   *
   * @route POST /insert-person-mention
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"Number","label":"Index","name":"index","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Insertion index."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Email address of the person to mention (example: user@example.com)."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async insertPersonMention(documentId, index, email, tabId) {
    if (!email) throw new Error('"Email" is required')

    return this.#batchUpdate(
      documentId,
      [
        {
          insertText: {
            text: `@${ email }`,
            location: buildLocation({ index: Number(index), tabId }),
          },
        },
      ],
      { sortDescending: false }
    )
  }

  /**
   * @operationName Insert Rich Link
   * @category Smart Inserts
   * @description Inserts a clickable hyperlink at a specific position. The link text reads however you want (default: the URL itself). Use for citations, references to other documents, or "Click here" prompts.
   *
   * @route POST /insert-rich-link
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"Number","label":"Index","name":"index","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Insertion index."}
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"Where the link should point (example: https://example.com)."}
   * @paramDef {"type":"String","label":"Display Text","name":"title","description":"Optional. What text the link should read. Leave empty to use the URL itself."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{},{}]}
   */
  async insertRichLink(documentId, index, url, title, tabId) {
    if (!url) throw new Error('"URL" is required')

    const display = title || url
    const idx = Number(index)
    const requests = [
      {
        insertText: {
          text: display,
          location: buildLocation({ index: idx, tabId }),
        },
      },
      {
        updateTextStyle: {
          range: buildRange({
            startIndex: idx,
            endIndex: idx + display.length,
            tabId,
          }),
          textStyle: { link: { url } },
          fields: 'link',
        },
      },
    ]

    return this.#batchUpdate(documentId, requests, { sortDescending: false })
  }

  /**
   * @operationName Insert Date
   * @category Smart Inserts
   * @description Writes a date into the document in the chosen format. Use for "Last updated", "Report date", or signed-on lines. Pick Short for compact dates, Long for a full weekday-month-day-year format.
   *
   * @route POST /insert-date
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to edit."}
   * @paramDef {"type":"Number","label":"Index","name":"index","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Insertion index."}
   * @paramDef {"type":"String","label":"Date","name":"date","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Date and time to insert (example: 2026-05-16 or 2026-05-16T10:00:00Z)."}
   * @paramDef {"type":"String","label":"Format","name":"format","uiComponent":{"type":"DROPDOWN","options":{"values":["Short (2026-05-16)","Medium (May 16, 2026)","Long (Saturday, May 16, 2026)","ISO 8601 (Full Timestamp)"]}},"description":"Output format. short=2026-05-16, medium=May 16, 2026, long=Saturday, May 16, 2026, iso=2026-05-16T10:00:00.000Z."}
   * @paramDef {"type":"String","label":"Tab","name":"tabId","dictionary":"listTabsDictionary","description":"Optional. Apply only to this tab of the document."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","replies":[{}]}
   */
  async insertDate(documentId, index, date, format, tabId) {
    if (!date) throw new Error('"Date" is required')

    const d = new Date(date)

    if (Number.isNaN(d.getTime())) throw new Error('Invalid date')

    let formatted

    const resolvedFormat = this.#resolveChoice(format, {
      'Short (2026-05-16)': 'short',
      'Medium (May 16, 2026)': 'medium',
      'Long (Saturday, May 16, 2026)': 'long',
      'ISO 8601 (Full Timestamp)': 'iso',
    })

    switch ((resolvedFormat || 'medium').toLowerCase()) {
      case 'short':
        formatted = d.toISOString().slice(0, 10)
        break
      case 'long':
        formatted = d.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })

        break
      case 'iso':
        formatted = d.toISOString()
        break
      default:
        formatted = d.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
    }

    return this.#batchUpdate(
      documentId,
      [
        {
          insertText: {
            text: formatted,
            location: buildLocation({ index: Number(index), tabId }),
          },
        },
      ],
      { sortDescending: false }
    )
  }

  // =============================== 17 EXPORT / SHARE / REVISIONS ===============================

  /**
   * @operationName Export Document
   * @category Export
   * @description Exports a Google Doc to a different file format (PDF, Word, Markdown, HTML, plain text, EPUB, RTF, ODT). The file is returned as encoded text — fill in the Save Path field to also upload the file to FlowRunner Files. Use this when you need to email a PDF, archive a Word copy, or hand the document off to another tool.
   *
   * @route POST /export-document
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to export."}
   * @paramDef {"type":"String","label":"Format","name":"mimeType","required":true,"dictionary":"listExportFormatsDictionary","description":"What format to export to (PDF, Word, Markdown, etc.). Pick from the list."}
   * @paramDef {"type":"String","label":"Save Path","name":"filePath","description":"Optional. Where to save the exported file in FlowRunner Files — for example `exports/q3-plan.pdf`. Leave empty to return the file contents in the response without saving."}
   *
   * @returns {Object}
   * @sampleResultLoader { "methodName":"exportDocument_SampleResultLoader", "dependsOn":["mimeType"] }
   */
  async exportDocument(documentId, mimeType, filePath) {
    const docId = this.#ensureDocId(documentId)

    if (!mimeType) throw new Error('"Format" is required')

    const bytes = await this.#driveExport(docId, mimeType)
    const isText =
      mimeType.startsWith('text/') || mimeType === 'application/json'

    const result = {
      documentId: docId,
      mimeType,
      size: bytes.length,
      extension: extensionFor(mimeType),
    }

    if (isText) {
      result.content = bytes.toString('utf8')
    } else {
      result.base64 = bytes.toString('base64')
    }

    if (filePath) {
      try {
        const saved = await this.flowrunner.Files.uploadFile(bytes, {
          filename: filePath,
          generateUrl: true,
          overwrite: true,
        })

        result.fileURL = saved.url
      } catch (error) {
        logger.warn(
          `exportDocument: save to FlowRunner failed: ${ error.message }`
        )

        result.fileURL = null
        result.saveError = error.message
      }
    }

    return result
  }

  /**
   * @operationName Export As PDF
   * @category Export
   * @description Convenience wrapper that exports a Google Doc to PDF.
   *
   * @route POST /export-as-pdf
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to export."}
   * @paramDef {"type":"String","label":"Save Path","name":"filePath","description":"Optional file path."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","mimeType":"application/pdf","size":123456,"extension":"pdf","base64":"JVBERi0..."}
   */
  async exportAsPdf(documentId, filePath) {
    return this.exportDocument(
      documentId,
      EXPORT_MIME.pdf,
      filePath
    )
  }

  /**
   * @operationName Export As DOCX
   * @category Export
   *
   * @route POST /export-as-docx
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to export."}
   * @paramDef {"type":"String","label":"Save Path","name":"filePath","description":"Optional file path."}
   * @description Convenience wrapper that exports to a Microsoft Word .docx file.
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","mimeType":"application/vnd.openxmlformats-officedocument.wordprocessingml.document","size":54321,"extension":"docx","base64":"UEsDBA..."}
   */
  async exportAsDocx(documentId, filePath) {
    return this.exportDocument(
      documentId,
      EXPORT_MIME.docx,
      filePath
    )
  }

  /**
   * @operationName Export As Markdown
   * @category Export
   *
   * @route POST /export-as-markdown
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to export."}
   * @paramDef {"type":"String","label":"Save Path","name":"filePath","description":"Optional file path."}
   * @description Convenience wrapper that exports to Markdown.
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","mimeType":"text/markdown","size":1234,"extension":"md","content":"# Title\n\nContent..."}
   */
  async exportAsMarkdown(documentId, filePath) {
    return this.exportDocument(
      documentId,
      EXPORT_MIME.markdown,
      filePath
    )
  }

  /**
   * @operationName List Document Revisions
   * @category Export
   * @description Returns every saved version of a document, with who made each version and when. Use this to find a version to export, audit changes, or restore older content.
   *
   * @route POST /list-document-revisions
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document whose revisions to list."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Items per page (default 50, max 1000)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Cursor for next page."}
   *
   * @returns {Object}
   * @sampleResultLoader { "methodName":"listDocumentRevisions_SampleResultLoader" }
   */
  async listDocumentRevisions(documentId, pageSize, pageToken) {
    const docId = this.#ensureDocId(documentId)

    const response = await this.#driveRequest({
      logTag: 'listDocumentRevisions',
      url: `${ DRIVE_API_BASE_URL }/files/${ docId }/revisions`,
      query: {
        pageSize: clampInt(pageSize, 1, MAX_LIST_PAGE_SIZE, DEFAULT_PAGE_SIZE),
        pageToken,
        fields:
          'nextPageToken,revisions(id,modifiedTime,lastModifyingUser,keepForever,exportLinks)',
      },
    })

    return {
      revisions: response.revisions || [],
      nextPageToken: response.nextPageToken || null,
    }
  }

  /**
   * @operationName Export Document Revision
   * @category Export
   * @description Exports a specific revision of a document to the chosen format. Use this to retrieve a past version.
   *
   * @route POST /export-document-revision
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document."}
   * @paramDef {"type":"String","label":"Version","name":"revisionId","required":true,"dictionary":"listDocumentRevisionsDictionary","description":"Pick the saved version (revision) to export."}
   * @paramDef {"type":"String","label":"Format","name":"mimeType","dictionary":"listExportFormatsDictionary","description":"Target MIME type. Defaults to PDF."}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","revisionId":"5","mimeType":"application/pdf","size":12345,"base64":"JVBERi0..."}
   */
  async exportDocumentRevision(documentId, revisionId, mimeType) {
    const docId = this.#ensureDocId(documentId)

    if (!revisionId) throw new Error('"Revision ID" is required')

    const targetMime = mimeType || EXPORT_MIME.pdf
    const url = `${ DRIVE_API_BASE_URL }/files/${ docId }/revisions/${ revisionId }`

    const revision = await this.#driveRequest({
      logTag: 'exportDocumentRevision:meta',
      url,
      query: { fields: 'id,exportLinks' },
    })

    const exportUrl = revision.exportLinks?.[targetMime]

    if (!exportUrl)
      throw new Error(
        `Revision ${ revisionId } has no export link for ${ targetMime }`
      )

    const res = await fetch(exportUrl, {
      headers: this.#getAccessTokenHeader(),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')

      throw new Error(
        `Revision export failed (${ res.status }): ${ text.slice(0, 500) }`
      )
    }

    const bytes = Buffer.from(await res.arrayBuffer())
    const isText = targetMime.startsWith('text/')

    return {
      documentId: docId,
      revisionId,
      mimeType: targetMime,
      size: bytes.length,
      extension: extensionFor(targetMime),
      ...(isText
        ? { content: bytes.toString('utf8') }
        : { base64: bytes.toString('base64') }),
    }
  }

  /**
   * @operationName Share Document
   * @category Sharing
   * @description Grants a user, group, or domain access to the document. Sends a notification email by default.
   *
   * @route POST /share-document
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document to share."}
   * @paramDef {"type":"String","label":"Email Or Domain","name":"emailAddress","required":true,"description":"User email, group email, or a domain (e.g. example.com)."}
   * @paramDef {"type":"String","label":"Role","name":"role","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Viewer","Commenter","Editor","Owner"]}},"description":"Permission level."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["User","Group","Domain","Anyone"]}},"description":"Grantee type. Default user."}
   * @paramDef {"type":"Boolean","label":"Send Notification","name":"sendNotification","uiComponent":{"type":"TOGGLE"},"description":"When true (default) sends an email."}
   * @paramDef {"type":"String","label":"Message","name":"message","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional notification email message."}
   *
   * @returns {Object}
   * @sampleResult {"id":"perm-id","type":"user","role":"writer","emailAddress":"sample@example.com"}
   */
  async shareDocument(
    documentId,
    emailAddress,
    role,
    type,
    sendNotification,
    message
  ) {
    const docId = this.#ensureDocId(documentId)

    if (!emailAddress) throw new Error('"Email Or Domain" is required')

    if (!role) throw new Error('"Role" is required')

    const resolvedRole = this.#resolveChoice(role, {
      Viewer: 'reader',
      Commenter: 'commenter',
      Editor: 'writer',
      Owner: 'owner',
    })

    const grantType = (
      type || (emailAddress.includes('@') ? 'user' : 'domain')
    ).toLowerCase()
    const body = { role: resolvedRole, type: grantType }

    if (grantType === 'user' || grantType === 'group')
      body.emailAddress = emailAddress
    else if (grantType === 'domain') body.domain = emailAddress

    const notify =
      sendNotification === undefined
        ? true
        : asBool(sendNotification) !== false

    return this.#driveRequest({
      logTag: 'shareDocument',
      method: 'post',
      url: `${ DRIVE_API_BASE_URL }/files/${ docId }/permissions`,
      body: cleanupObject(body),
      query: cleanupObject({
        sendNotificationEmail: notify ? 'true' : 'false',
        emailMessage: notify && message ? message : undefined,
        fields: 'id,type,role,emailAddress,domain,displayName',
      }),
    })
  }

  /**
   * @operationName List Document Permissions
   * @category Sharing
   * @description Returns everyone who currently has access to a document — individuals, groups, domains, and the public-link state. Use this for audits or before removing access from someone.
   *
   * @route POST /list-document-permissions
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document."}
   *
   * @returns {Object}
   * @sampleResult {"permissions":[{"id":"p1","type":"user","role":"owner","emailAddress":"sample@example.com"}]}
   */
  async listDocumentPermissions(documentId) {
    const docId = this.#ensureDocId(documentId)

    const response = await this.#driveRequest({
      logTag: 'listDocumentPermissions',
      url: `${ DRIVE_API_BASE_URL }/files/${ docId }/permissions`,
      query: {
        fields:
          'permissions(id,type,role,emailAddress,domain,displayName,deleted,pendingOwner)',
      },
    })

    return { permissions: response.permissions || [] }
  }

  /**
   * @operationName Remove Document Permission
   * @category Sharing
   *
   * @route POST /remove-document-permission
   * @appearanceColor #d93025 #ea4335
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document."}
   * @paramDef {"type":"String","label":"Person Or Group","name":"permissionId","required":true,"dictionary":"listDocumentPermissionsDictionary","description":"Pick the person, group, or domain whose access you want to revoke."}
   * @description Revokes a permission, removing the user/group's access.
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","permissionId":"p1","removed":true}
   */
  async removeDocumentPermission(documentId, permissionId) {
    const docId = this.#ensureDocId(documentId)

    if (!permissionId) throw new Error('"Permission ID" is required')

    await this.#driveRequest({
      logTag: 'removeDocumentPermission',
      method: 'delete',
      url: `${ DRIVE_API_BASE_URL }/files/${ docId }/permissions/${ permissionId }`,
    })

    return { documentId: docId, permissionId, removed: true }
  }

  // =============================== 18 COMMENTS + REPLIES ===============================

  /**
   * @operationName List Comments
   * @category Comments
   * @description Returns the comments on a document, including any replies and resolved status. Use to summarize feedback, route comments to other systems, or build a review dashboard.
   *
   * @route POST /list-comments
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document."}
   * @paramDef {"type":"Boolean","label":"Include Deleted","name":"includeDeleted","uiComponent":{"type":"TOGGLE"},"description":"When true also returns deleted comments."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Items per page (default 50, max 100)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Cursor for next page."}
   *
   * @returns {Object}
   * @sampleResultLoader { "methodName":"listComments_SampleResultLoader" }
   */
  async listComments(documentId, includeDeleted, pageSize, pageToken) {
    const docId = this.#ensureDocId(documentId)

    const response = await this.#driveRequest({
      logTag: 'listComments',
      url: `${ DRIVE_API_BASE_URL }/files/${ docId }/comments`,
      query: {
        pageSize: clampInt(pageSize, 1, 100, DEFAULT_PAGE_SIZE),
        pageToken,
        includeDeleted: asBool(includeDeleted) ? 'true' : 'false',
        fields:
          'nextPageToken,comments(id,content,createdTime,modifiedTime,resolved,author,quotedFileContent,replies,deleted)',
      },
    })

    return {
      comments: response.comments || [],
      nextPageToken: response.nextPageToken || null,
    }
  }

  /**
   * @operationName Create Comment
   * @category Comments
   * @description Posts a new comment on the document. Use to leave review notes, ask questions, or attach automated feedback. Optionally include a snippet of the document's text to anchor the comment to that passage.
   *
   * @route POST /create-comment
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Comment text."}
   * @paramDef {"type":"String","label":"Quoted Text","name":"quotedText","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional. A snippet copied from the document that the comment is about. The comment will be anchored to wherever this text appears."}
   *
   * @returns {Object}
   * @sampleResult {"id":"c1","content":"Please review","author":{"displayName":"User"},"createdTime":"2025-01-10T10:00:00Z"}
   */
  async createComment(documentId, content, quotedText) {
    const docId = this.#ensureDocId(documentId)

    if (!content) throw new Error('"Content" is required')

    const body = cleanupObject({
      content,
      quotedFileContent: quotedText
        ? { value: quotedText, mimeType: 'text/plain' }
        : undefined,
    })

    return this.#driveRequest({
      logTag: 'createComment',
      method: 'post',
      url: `${ DRIVE_API_BASE_URL }/files/${ docId }/comments`,
      body,
      query: {
        fields:
          'id,content,createdTime,author,quotedFileContent,replies,resolved',
      },
    })
  }

  /**
   * @operationName Reply To Comment
   * @category Comments
   * @description Adds a reply to a comment that already exists on the document. Use to acknowledge feedback or continue a discussion thread.
   *
   * @route POST /reply-to-comment
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document."}
   * @paramDef {"type":"String","label":"Comment","name":"commentId","required":true,"dictionary":"listCommentsDictionary","description":"Pick the comment to reply to."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Reply text."}
   *
   * @returns {Object}
   * @sampleResult {"id":"r1","content":"Done","author":{"displayName":"User"},"createdTime":"2025-01-10T10:00:00Z"}
   */
  async replyToComment(documentId, commentId, content) {
    const docId = this.#ensureDocId(documentId)

    if (!commentId) throw new Error('"Comment ID" is required')

    if (!content) throw new Error('"Content" is required')

    return this.#driveRequest({
      logTag: 'replyToComment',
      method: 'post',
      url: `${ DRIVE_API_BASE_URL }/files/${ docId }/comments/${ commentId }/replies`,
      body: { content },
      query: { fields: 'id,content,createdTime,author,action' },
    })
  }

  /**
   * @operationName Resolve Comment
   * @category Comments
   * @description Closes out a comment thread by marking it resolved — the same as clicking the check mark in Google Docs. Use to clean up the discussion list once feedback has been addressed.
   *
   * @route POST /resolve-comment
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document."}
   * @paramDef {"type":"String","label":"Comment","name":"commentId","required":true,"dictionary":"listCommentsDictionary","description":"Pick the comment to mark resolved."}
   *
   * @returns {Object}
   * @sampleResult {"id":"c1","resolved":true}
   */
  async resolveComment(documentId, commentId) {
    const docId = this.#ensureDocId(documentId)

    if (!commentId) throw new Error('"Comment ID" is required')

    await this.#driveRequest({
      logTag: 'resolveComment:reply',
      method: 'post',
      url: `${ DRIVE_API_BASE_URL }/files/${ docId }/comments/${ commentId }/replies`,
      body: { action: 'resolve' },
      query: { fields: 'id,action' },
    })

    return { id: commentId, resolved: true }
  }

  /**
   * @operationName Delete Comment
   * @category Comments
   *
   * @route POST /delete-comment
   * @appearanceColor #d93025 #ea4335
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"The document."}
   * @paramDef {"type":"String","label":"Comment","name":"commentId","required":true,"dictionary":"listCommentsDictionary","description":"Pick the comment to delete."}
   * @description Permanently removes a comment and all its replies from the document. Cannot be undone — prefer Resolve Comment for soft removal.
   *
   * @returns {Object}
   * @sampleResult {"documentId":"1aBC...","commentId":"c1","deleted":true}
   */
  async deleteComment(documentId, commentId) {
    const docId = this.#ensureDocId(documentId)

    if (!commentId) throw new Error('"Comment ID" is required')

    await this.#driveRequest({
      logTag: 'deleteComment',
      method: 'delete',
      url: `${ DRIVE_API_BASE_URL }/files/${ docId }/comments/${ commentId }`,
    })

    return { documentId: docId, commentId, deleted: true }
  }

  // =============================== 19 TRIGGERS — POLLING + REALTIME ===============================

  /**
   * @description Fires every time a new Google Doc shows up in the connected account. Use this to react to fresh content — saving copies, posting alerts, kicking off onboarding workflows. Optionally narrow the watch to a single folder. Pages through results so a burst of new documents between checks is not missed (up to ~1000 per check).
   *
   * @registerAs POLLING_TRIGGER
   * @operationName On New Document
   * @category Triggers
   * @route POST /on-new-document
   * @appearanceColor #1a73e8 #4285f4
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Folder","name":"folderId","dictionary":"listFoldersDictionary","description":"Optional folder to watch (only direct children of this folder fire)."}
   * @paramDef {"type":"String","label":"Name Contains","name":"nameContains","description":"Optional name substring."}
   *
   * @returns {Object}
   * @sampleResult {"events":[{"id":"1aBC","name":"new.docx","createdTime":"2025-05-10T10:00:00Z","webViewLink":"https://docs.google.com/document/d/1aBC..."}]}
   */
  async onNewDocument(invocation) {
    const data = invocation.eventData || invocation.triggerData || {}
    const folder = data.folderId ? extractFolderId(data.folderId) : null
    const parts = [`mimeType='${ GOOGLE_DOC_MIME }'`, 'trashed=false']

    if (folder) parts.push(`'${ folder }' in parents`)

    if (data.nameContains)
      parts.push(
        `name contains '${ String(data.nameContains).replace(/'/g, "\\'") }'`
      )

    const query = {
      q: parts.join(' and '),
      orderBy: 'createdTime desc',
      pageSize: TRIGGER_PAGE_SIZE,
      fields: DOC_FILE_FIELDS_LIST,
      includeItemsFromAllDrives: 'true',
      corpora: 'allDrives',
    }

    // Learning mode and the first poll only need the newest page to seed the watermark.
    if (invocation.learningMode || !invocation.state?.initialized) {
      const response = await this.#driveRequest({
        logTag: 'onNewDocument',
        url: `${ DRIVE_API_BASE_URL }/files`,
        query,
      })
      const files = response.files || []

      if (invocation.learningMode) return { events: files.slice(0, 1), state: null }

      return {
        events: [],
        state: { initialized: true, latestId: files[0]?.id || null },
      }
    }

    const previousLatest = invocation.state.latestId
    const newFiles = []
    let latestId = previousLatest

    // Walk newest-first, collecting docs until we reach the previous watermark. The watermark
    // only advances to the newest doc, so everything emitted lies between it and the old mark.
    await this.#listDocsPaged({
      logTag: 'onNewDocument',
      query,
      onPage: (files, page) => {
        if (page === 0) latestId = files[0]?.id || previousLatest

        for (const f of files) {
          if (f.id === previousLatest) return true

          newFiles.push(f)
        }

        return false
      },
    })

    return {
      events: newFiles,
      state: { ...invocation.state, latestId },
    }
  }

  /**
   * @description Fires when a Google Doc is edited, renamed, or moved. Use to react to changes — for example, syncing edits to another system, posting alerts when key documents change, or triggering a review workflow. Pages through results so a burst of edits between checks is not missed (up to ~1000 per check).
   *
   * @registerAs POLLING_TRIGGER
   * @operationName On Document Modified
   * @category Triggers
   * @route POST /on-document-modified
   * @appearanceColor #1a73e8 #4285f4
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Folder","name":"folderId","dictionary":"listFoldersDictionary","description":"Optional folder scope (direct children only)."}
   * @paramDef {"type":"String","label":"Document","name":"documentId","dictionary":"listDocumentsDictionary","description":"Optional single doc to watch (mutually exclusive with Folder)."}
   *
   * @returns {Object}
   * @sampleResult {"events":[{"id":"1aBC","name":"plan","modifiedTime":"2025-05-10T10:00:00Z","lastModifyingUser":{"displayName":"User"}}]}
   */
  async onDocumentModified(invocation) {
    const data = invocation.eventData || invocation.triggerData || {}
    const folder = data.folderId ? extractFolderId(data.folderId) : null
    const docId = data.documentId ? extractDocId(data.documentId) : null

    // Single-doc watch: one metadata fetch, nothing to page through.
    if (docId) {
      const file = await this.#driveRequest({
        logTag: 'onDocumentModified',
        url: `${ DRIVE_API_BASE_URL }/files/${ docId }`,
        query: { fields: DOC_FILE_FIELDS },
      })

      if (invocation.learningMode) return { events: [file], state: null }

      const lastSeenAt = invocation.state?.lastSeenModified
      const newest = file.modifiedTime || lastSeenAt || new Date().toISOString()

      if (!lastSeenAt) return { events: [], state: { lastSeenModified: newest } }

      const events =
        Date.parse(file.modifiedTime) > Date.parse(lastSeenAt) ? [file] : []

      return { events, state: { ...invocation.state, lastSeenModified: newest } }
    }

    const parts = [`mimeType='${ GOOGLE_DOC_MIME }'`, 'trashed=false']

    if (folder) parts.push(`'${ folder }' in parents`)

    const query = {
      q: parts.join(' and '),
      orderBy: 'modifiedTime desc',
      pageSize: TRIGGER_PAGE_SIZE,
      fields: DOC_FILE_FIELDS_LIST,
      includeItemsFromAllDrives: 'true',
      corpora: 'allDrives',
    }

    // Learning mode and the first poll only need the newest page to seed the watermark.
    if (invocation.learningMode || !invocation.state?.lastSeenModified) {
      const response = await this.#driveRequest({
        logTag: 'onDocumentModified',
        url: `${ DRIVE_API_BASE_URL }/files`,
        query,
      })
      const files = response.files || []

      if (invocation.learningMode) return { events: files.slice(0, 1), state: null }

      const newest = files[0]?.modifiedTime || new Date().toISOString()

      return { events: [], state: { lastSeenModified: newest } }
    }

    const lastSeenAt = invocation.state.lastSeenModified
    const cutoff = Date.parse(lastSeenAt)
    const events = []
    let newest = lastSeenAt

    // Newest-first: collect edits until one is at or below the watermark, then stop paging.
    await this.#listDocsPaged({
      logTag: 'onDocumentModified',
      query,
      onPage: (files, page) => {
        if (page === 0) newest = files[0]?.modifiedTime || lastSeenAt

        for (const f of files) {
          if (Date.parse(f.modifiedTime) > cutoff) events.push(f)
          else return true
        }

        return false
      },
    })

    return { events, state: { ...invocation.state, lastSeenModified: newest } }
  }

  /**
   * @description Fires when someone posts a new comment on the watched document. Use to route feedback to chat, email a reviewer, or kick off an automated reply.
   *
   * @registerAs POLLING_TRIGGER
   * @operationName On New Comment
   * @category Triggers
   * @route POST /on-new-comment
   * @appearanceColor #1a73e8 #4285f4
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"Document to watch."}
   *
   * @returns {Object}
   * @sampleResult {"events":[{"id":"c1","content":"Looks good","author":{"displayName":"User"},"createdTime":"2025-05-10T10:00:00Z"}]}
   */
  async onNewComment(invocation) {
    const data = invocation.eventData || invocation.triggerData || {}
    const docId = extractDocId(data.documentId)

    if (!docId) throw new Error('"Document" is required')

    const response = await this.#driveRequest({
      logTag: 'onNewComment',
      url: `${ DRIVE_API_BASE_URL }/files/${ docId }/comments`,
      query: {
        pageSize: 50,
        fields:
          'comments(id,content,createdTime,author,resolved,quotedFileContent)',
      },
    })

    const comments = (response.comments || []).sort(
      (a, b) => Date.parse(b.createdTime) - Date.parse(a.createdTime)
    )

    if (invocation.learningMode) {
      return { events: comments.slice(0, 1), state: null }
    }

    const lastSeenAt = invocation.state?.lastSeenCreated

    if (!lastSeenAt) {
      const newest = comments[0]?.createdTime || new Date().toISOString()

      return { events: [], state: { lastSeenCreated: newest } }
    }

    const cutoff = Date.parse(lastSeenAt)
    const events = comments.filter(c => Date.parse(c.createdTime) > cutoff)
    const newest = comments[0]?.createdTime || lastSeenAt

    return { events, state: { ...invocation.state, lastSeenCreated: newest } }
  }

  /**
   * @description Fires when the watched document gets a new saved version. Use for change-tracking workflows — capturing a snapshot every time a version is recorded, or archiving older versions.
   *
   * @registerAs POLLING_TRIGGER
   * @operationName On Document Revision
   * @category Triggers
   * @route POST /on-document-revision
   * @appearanceColor #1a73e8 #4285f4
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"listDocumentsDictionary","description":"Document to watch."}
   *
   * @returns {Object}
   * @sampleResult {"events":[{"id":"5","modifiedTime":"2025-05-10T10:00:00Z","lastModifyingUser":{"displayName":"User"}}]}
   */
  async onDocumentRevision(invocation) {
    const data = invocation.eventData || invocation.triggerData || {}
    const docId = extractDocId(data.documentId)

    if (!docId) throw new Error('"Document" is required')

    const response = await this.#driveRequest({
      logTag: 'onDocumentRevision',
      url: `${ DRIVE_API_BASE_URL }/files/${ docId }/revisions`,
      query: {
        pageSize: 50,
        fields: 'revisions(id,modifiedTime,lastModifyingUser)',
      },
    })

    const revisions = (response.revisions || []).sort(
      (a, b) => Date.parse(b.modifiedTime) - Date.parse(a.modifiedTime)
    )

    if (invocation.learningMode) {
      return { events: revisions.slice(0, 1), state: null }
    }

    const lastSeenId = invocation.state?.lastRevisionId

    if (!lastSeenId) {
      return {
        events: [],
        state: { lastRevisionId: revisions[0]?.id || null },
      }
    }

    const newOnes = []

    for (const r of revisions) {
      if (r.id === lastSeenId) break

      newOnes.push(r)
    }

    return {
      events: newOnes,
      state: {
        ...invocation.state,
        lastRevisionId: revisions[0]?.id || lastSeenId,
      },
    }
  }

  // =============================== 20 SAMPLE RESULT LOADERS ===============================

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /getDocument_SampleResultLoader
   * @paramDef {"type":"Object","label":"payload","name":"payload"}
   * @returns {Object}
   */
  async getDocument_SampleResultLoader() {
    return {
      documentId: '1aBCDEFghi',
      title: 'Sample Document',
      revisionId: 'ALm...',
      tabs: [
        {
          tabProperties: { tabId: 't.0', title: 'Tab 1', index: 0 },
          documentTab: {
            body: {
              content: [
                {
                  startIndex: 1,
                  endIndex: 28,
                  paragraph: {
                    elements: [
                      {
                        startIndex: 1,
                        endIndex: 28,
                        textRun: {
                          content: 'Welcome to the document\n',
                          textStyle: {},
                        },
                      },
                    ],
                    paragraphStyle: { namedStyleType: 'HEADING_1' },
                  },
                },
                {
                  startIndex: 28,
                  endIndex: 76,
                  paragraph: {
                    elements: [
                      {
                        startIndex: 28,
                        endIndex: 76,
                        textRun: {
                          content:
                            'This is a sample paragraph for demonstration.\n',
                          textStyle: {},
                        },
                      },
                    ],
                    paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
                  },
                },
              ],
            },
          },
        },
      ],
      documentStyle: {
        pageSize: {
          width: { magnitude: 612, unit: 'PT' },
          height: { magnitude: 792, unit: 'PT' },
        },
      },
      namedRanges: {
        summary: {
          name: 'summary',
          namedRanges: [
            {
              namedRangeId: 'range-001',
              name: 'summary',
              ranges: [{ startIndex: 28, endIndex: 76 }],
            },
          ],
        },
      },
    }
  }

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /listDocuments_SampleResultLoader
   * @paramDef {"type":"Object","label":"payload","name":"payload"}
   * @returns {Object}
   */
  async listDocuments_SampleResultLoader() {
    return {
      files: [
        {
          id: '1aBCDEFghi',
          name: 'Q3 Plan',
          mimeType: GOOGLE_DOC_MIME,
          modifiedTime: '2025-01-10T10:00:00Z',
          createdTime: '2025-01-01T08:00:00Z',
          parents: ['folderId123'],
          owners: [
            {
              displayName: 'Sample User',
              emailAddress: 'sample@example.com',
              me: true,
            },
          ],
          webViewLink: 'https://docs.google.com/document/d/1aBCDEFghi/edit',
          shared: true,
          size: '12345',
        },
        {
          id: '2cDEFGhij',
          name: 'Onboarding Notes',
          mimeType: GOOGLE_DOC_MIME,
          modifiedTime: '2025-01-09T09:00:00Z',
          parents: ['folderId123'],
          webViewLink: 'https://docs.google.com/document/d/2cDEFGhij/edit',
        },
      ],
      nextPageToken: null,
    }
  }

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /exportDocument_SampleResultLoader
   * @paramDef {"type":"Object","label":"payload","name":"payload"}
   * @returns {Object}
   */
  async exportDocument_SampleResultLoader(payload = {}) {
    const mime = payload?.criteria?.mimeType || EXPORT_MIME.pdf
    const ext = extensionFor(mime)
    const isText = mime.startsWith('text/') || mime === 'application/json'
    const base = {
      documentId: '1aBCDEFghi',
      mimeType: mime,
      size: 12345,
      extension: ext,
    }

    if (isText) {
      return {
        ...base,
        content:
          mime === EXPORT_MIME.markdown
            ? '# Title\n\nSample exported content.'
            : 'Sample exported text content...',
      }
    }

    return {
      ...base,
      base64: 'JVBERi0xLjQKJeLjz9MKMyAwIG9iago8PAovTGVuZ3R...',
    }
  }

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /getDocumentMetadata_SampleResultLoader
   * @paramDef {"type":"Object","label":"payload","name":"payload"}
   * @returns {Object}
   */
  async getDocumentMetadata_SampleResultLoader() {
    return {
      id: '1aBCDEFghi',
      name: 'Q3 Plan',
      mimeType: GOOGLE_DOC_MIME,
      description: 'Quarterly planning document',
      parents: ['folderId123'],
      owners: [
        {
          displayName: 'Sample User',
          emailAddress: 'sample@example.com',
          me: true,
        },
      ],
      createdTime: '2025-01-01T08:00:00Z',
      modifiedTime: '2025-01-10T10:00:00Z',
      webViewLink: 'https://docs.google.com/document/d/1aBCDEFghi/edit',
      shared: true,
      size: '12345',
    }
  }

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /listComments_SampleResultLoader
   * @paramDef {"type":"Object","label":"payload","name":"payload"}
   * @returns {Object}
   */
  async listComments_SampleResultLoader() {
    return {
      comments: [
        {
          id: 'c1',
          content: 'Please review the second paragraph',
          createdTime: '2025-01-10T10:00:00Z',
          modifiedTime: '2025-01-10T10:00:00Z',
          author: {
            displayName: 'Sample User',
            emailAddress: 'sample@example.com',
          },
          quotedFileContent: { value: 'sample text', mimeType: 'text/plain' },
          resolved: false,
          replies: [
            {
              id: 'r1',
              content: 'Done',
              createdTime: '2025-01-10T11:00:00Z',
              author: { displayName: 'Another User' },
            },
          ],
        },
      ],
      nextPageToken: null,
    }
  }

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /listDocumentRevisions_SampleResultLoader
   * @paramDef {"type":"Object","label":"payload","name":"payload"}
   * @returns {Object}
   */
  async listDocumentRevisions_SampleResultLoader() {
    return {
      revisions: [
        {
          id: '5',
          modifiedTime: '2025-01-10T10:00:00Z',
          lastModifyingUser: { displayName: 'Sample User' },
          keepForever: false,
        },
        {
          id: '4',
          modifiedTime: '2025-01-09T10:00:00Z',
          lastModifyingUser: { displayName: 'Sample User' },
          keepForever: true,
        },
      ],
      nextPageToken: null,
    }
  }

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /getDocumentOutline_SampleResultLoader
   * @paramDef {"type":"Object","label":"payload","name":"payload"}
   * @returns {Object}
   */
  async getDocumentOutline_SampleResultLoader() {
    return {
      documentId: '1aBCDEFghi',
      title: 'Sample Document',
      headings: [
        {
          level: 1,
          namedStyleType: 'HEADING_1',
          text: 'Introduction',
          startIndex: 1,
          endIndex: 14,
          segmentId: null,
          tabId: 't.0',
          segmentKind: 'body',
        },
        {
          level: 2,
          namedStyleType: 'HEADING_2',
          text: 'Background',
          startIndex: 200,
          endIndex: 211,
          segmentId: null,
          tabId: 't.0',
          segmentKind: 'body',
        },
        {
          level: 2,
          namedStyleType: 'HEADING_2',
          text: 'Goals',
          startIndex: 600,
          endIndex: 606,
          segmentId: null,
          tabId: 't.0',
          segmentKind: 'body',
        },
      ],
    }
  }

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /getDocumentStatistics_SampleResultLoader
   * @paramDef {"type":"Object","label":"payload","name":"payload"}
   * @returns {Object}
   */
  async getDocumentStatistics_SampleResultLoader() {
    return {
      documentId: '1aBCDEFghi',
      title: 'Sample Document',
      revisionId: 'ALm...',
      words: 723,
      characters: 4321,
      paragraphs: 18,
      tables: 1,
      images: 2,
      namedRanges: 3,
    }
  }
}

// =============================== MODULE-LEVEL HELPERS ===============================

/**
 * Flattens a `Document.tabs[]` tree (with childTabs) into a depth-first array of
 * { tabId, title, index, parentTabId } entries.
 */
function flattenTabs(tabs, parentTabId = null, out = []) {
  for (const tab of tabs || []) {
    const props = tab.tabProperties || {}

    out.push({
      tabId: props.tabId,
      title: props.title,
      index: props.index,
      parentTabId: parentTabId || props.parentTabId || null,
    })

    if (Array.isArray(tab.childTabs) && tab.childTabs.length) {
      flattenTabs(tab.childTabs, props.tabId, out)
    }
  }

  return out
}

/**
 * Returns the matching tab's documentTab body (or null) for use when tabId is supplied.
 * Falls back to the document's top-level body for single-tab docs.
 */
function pickBody(document, tabId) {
  if (Array.isArray(document.tabs) && document.tabs.length) {
    const flat = flattenTabsWithDocs(document.tabs)
    const match = tabId ? flat.find(t => t.tabId === tabId) : flat[0]

    return match?.documentTab?.body || null
  }

  return document.body || null
}

function flattenTabsWithDocs(tabs, out = []) {
  for (const tab of tabs || []) {
    out.push({ tabId: tab.tabProperties?.tabId, documentTab: tab.documentTab })

    if (Array.isArray(tab.childTabs) && tab.childTabs.length) {
      flattenTabsWithDocs(tab.childTabs, out)
    }
  }

  return out
}

/**
 * Returns a document-shaped object containing only the requested tab, useful for shaping methods.
 */
function scopeToTab(document, tabId) {
  if (!Array.isArray(document.tabs)) return document

  const flat = flattenTabsWithDocs(document.tabs)
  const match = flat.find(t => t.tabId === tabId)

  if (!match) return document

  return {
    ...document,
    tabs: [{ tabProperties: { tabId }, documentTab: match.documentTab }],
  }
}

/**
 * Sorts batchUpdate requests by descending `range.startIndex` (or location.index) so later edits
 * don't invalidate earlier ones. Requests without explicit indices keep their relative order
 * but float to the bottom of the list.
 */
function sortByDescendingIndex(requests) {
  const indexed = requests.map((r, i) => ({
    r,
    i,
    idx: extractRequestIndex(r),
  }))

  indexed.sort((a, b) => {
    if (a.idx === null && b.idx === null) return a.i - b.i

    if (a.idx === null) return 1

    if (b.idx === null) return -1

    return b.idx - a.idx
  })

  return indexed.map(e => e.r)
}

function extractRequestIndex(request) {
  const key = Object.keys(request)[0]
  const body = request[key]

  if (!body || typeof body !== 'object') return null

  const range = body.range
  const location = body.location
  const tableStart = body.tableStartLocation

  if (range?.startIndex != null) return Number(range.startIndex)

  if (location?.index != null) return Number(location.index)

  if (tableStart?.index != null) return Number(tableStart.index)

  if (body.tableCellLocation?.tableStartLocation?.index != null)
    return Number(body.tableCellLocation.tableStartLocation.index)

  return null
}

/**
 * Extracts the plaintext for a given range out of a loaded document.
 */
function extractTextSlice(
  document,
  { tabId, segmentId, startIndex, endIndex }
) {
  const segments = iterSegments(document)

  for (const seg of segments) {
    if (tabId && seg.tabId !== tabId) continue

    if (segmentId && seg.segmentId !== segmentId) continue

    if (!segmentId && seg.kind !== 'body') continue

    const elements = allBodyElementsForSegment(seg.body)
    let out = ''

    for (const el of elements) {
      if (el.type !== 'paragraph') continue

      for (const run of el.element.paragraph.elements || []) {
        if (!run.textRun) continue

        const s = run.startIndex
        const e = run.endIndex

        if (e <= startIndex || s >= endIndex) continue

        const text = run.textRun.content || ''
        const sliceStart = Math.max(0, startIndex - s)
        const sliceEnd = Math.min(text.length, endIndex - s)

        out += text.slice(sliceStart, sliceEnd)
      }
    }

    if (out) return out
  }

  return ''
}

function allBodyElementsForSegment(body) {
  if (!body?.content) return []

  return body.content.map(el => ({
    type: el.paragraph ? 'paragraph' : el.table ? 'table' : 'other',
    element: el,
  }))
}

/**
 * Builds a tableCellLocation for table requests. Defaults rowIndex/columnIndex to 0 when omitted.
 */
function tableCellLoc({ tableStartIndex, rowIndex, columnIndex, tabId }) {
  return {
    tableStartLocation: {
      index: Number(tableStartIndex),
      ...(tabId ? { tabId } : {}),
    },
    rowIndex: Number(rowIndex || 0),
    columnIndex: Number(columnIndex || 0),
  }
}

/**
 * Finds a table cell at the given coordinates by walking the document tree. Returns the cell's
 * content range so callers can replace it. Returns null if no matching table exists.
 */
function findTableCell(
  document,
  { tableStartIndex, rowIndex, columnIndex, tabId }
) {
  const segments = iterSegments(document)

  for (const seg of segments) {
    if (tabId && seg.tabId !== tabId) continue

    if (seg.kind !== 'body') continue

    for (const el of seg.body.content || []) {
      if (!el.table) continue

      if (el.startIndex !== tableStartIndex) continue

      const row = el.table.tableRows?.[rowIndex]
      const cell = row?.tableCells?.[columnIndex]

      if (!cell) return null

      const firstContent = cell.content?.[0]
      const lastContent = cell.content?.[cell.content.length - 1]
      const contentStart = firstContent?.startIndex
      const contentEnd = lastContent?.endIndex
        ? lastContent.endIndex - 1
        : contentStart

      return { contentStart, contentEnd }
    }
  }

  return null
}

/**
 * Maps MIME type → file extension for export results.
 */
function extensionFor(mimeType) {
  const map = {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      'docx',
    'application/vnd.oasis.opendocument.text': 'odt',
    'application/rtf': 'rtf',
    'text/plain': 'txt',
    'text/markdown': 'md',
    'text/html': 'html',
    'application/zip': 'zip',
    'application/epub+zip': 'epub',
    'application/json': 'json',
  }

  return map[mimeType] || 'bin'
}

// =============================== 21 SERVICE REGISTRATION ===============================

Flowrunner.ServerCode.addService(GoogleDocsService, [
  {
    order: 0,
    displayName: 'Client ID',
    defaultValue: '',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth 2.0 Client ID from Google Cloud Console (APIs & Services > Credentials).',
  },
  {
    order: 1,
    displayName: 'Client Secret',
    defaultValue: '',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth 2.0 Client Secret from Google Cloud Console (APIs & Services > Credentials).',
  },
  {
    order: 2,
    displayName: 'Default Folder',
    defaultValue: '',
    name: 'defaultFolderId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Optional Drive folder ID used as the default destination when creating documents without an explicit folder. Leave blank to use My Drive root.',
  },
  {
    order: 3,
    displayName: 'Include Tabs Content By Default',
    defaultValue: true,
    name: 'includeTabsByDefault',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.BOOL,
    required: false,
    shared: false,
    hint: 'When enabled (default), Get Document reads all tabs. Disable for legacy single-tab behavior. Multi-tab docs need this on to see content beyond the first tab.',
  },
])
