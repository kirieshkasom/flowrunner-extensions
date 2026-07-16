'use strict'

const DATA_API_BASE_URL = 'https://analyticsdata.googleapis.com/v1beta'
const ADMIN_API_BASE_URL = 'https://analyticsadmin.googleapis.com/v1beta'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const USER_INFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

const DEFAULT_SCOPE_LIST = [
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const DEFAULT_PAGE_SIZE = 200

// Property used by the Metadata endpoint to return the dimensions/metrics common to every property
const COMMON_METADATA_PROPERTY = 'properties/0'

const logger = {
  info: (...args) => console.log('[Google Analytics] info:', ...args),
  debug: (...args) => console.log('[Google Analytics] debug:', ...args),
  error: (...args) => console.log('[Google Analytics] error:', ...args),
  warn: (...args) => console.log('[Google Analytics] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName Google Analytics
 * @integrationIcon /icon.svg
 **/
class GoogleAnalyticsService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    if (query) {
      query = cleanupObject(query)
    }

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=[${ JSON.stringify(query) }]`)

      const request = Flowrunner.Request[method](url)
        .set(this.#getAccessTokenHeader())
        .query(query || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.error?.message || error.message

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Google Analytics API error: ${ message }`)
    }
  }

  #getAccessTokenHeader(accessToken) {
    return {
      Authorization: `Bearer ${ accessToken || this.request.headers['oauth-access-token'] }`,
    }
  }

  #normalizeProperty(propertyId) {
    if (propertyId === undefined || propertyId === null || String(propertyId).trim() === '') {
      throw new Error('"Property" is required')
    }

    const id = String(propertyId).trim()

    return id.startsWith('properties/') ? id : `properties/${ id }`
  }

  #normalizeAccountId(accountId) {
    if (accountId === undefined || accountId === null || String(accountId).trim() === '') {
      throw new Error('"Account" is required')
    }

    const id = String(accountId).trim()

    return id.startsWith('accounts/') ? id.slice('accounts/'.length) : id
  }

  #normalizeNameList(value, label) {
    const list = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(',')
        : []

    const names = list.map(item => String(item).trim()).filter(Boolean)

    if (label && !names.length) {
      throw new Error(`"${ label }" is required`)
    }

    return names
  }

  // Converts the GA4 header/row-index response into plain row objects keyed by
  // dimension/metric API names, with metric values parsed into numbers.
  #convertReport(response) {
    const dimensionNames = (response.dimensionHeaders || []).map(header => header.name)
    const metricHeaders = response.metricHeaders || []

    const rows = (response.rows || []).map(row => {
      const record = {}

      dimensionNames.forEach((name, index) => {
        record[name] = row.dimensionValues?.[index]?.value
      })

      metricHeaders.forEach((header, index) => {
        record[header.name] = toMetricNumber(row.metricValues?.[index]?.value)
      })

      return record
    })

    const totalsRows = (response.totals || []).map(row => {
      const record = {}

      metricHeaders.forEach((header, index) => {
        record[header.name] = toMetricNumber(row.metricValues?.[index]?.value)
      })

      return record
    })

    const result = {
      rows,
      totals: totalsRows[0] || null,
      rowCount: response.rowCount || rows.length,
    }

    if (response.metadata) {
      result.metadata = response.metadata
    }

    return result
  }

  // ============================================= OAUTH ================================================

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

    const connectionURL = `${ OAUTH_URL }?${ params.toString() }`

    logger.debug(`composed connectionURL: ${ connectionURL }`)

    return connectionURL
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   *
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
    params.append('access_type', 'offline')

    const codeExchangeResponse = await Flowrunner.Request.post(TOKEN_URL)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    let userData = {}
    let connectionIdentityName = 'Google Analytics Account'
    let connectionIdentityImageURL = null

    try {
      userData = await Flowrunner.Request
        .get(USER_INFO_URL)
        .set(this.#getAccessTokenHeader(codeExchangeResponse.access_token))

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
   *
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

  // ========================================== DICTIONARIES ===========================================

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
   * @typedef {Object} getPropertiesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter properties by display name or property ID. Filtering is applied locally to the retrieved page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Properties Dictionary
   * @description Lists GA4 properties accessible to the connected user (via account summaries), for selection in dependent parameters. Returns the property display name as the label and the numeric property ID as the value.
   * @route POST /get-properties-dictionary
   * @paramDef {"type":"getPropertiesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"My Website","value":"123456789","note":"Acme Inc"}],"cursor":"nextPageToken123"}
   */
  async getPropertiesDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getPropertiesDictionary',
      url: `${ ADMIN_API_BASE_URL }/accountSummaries`,
      query: {
        pageSize: DEFAULT_PAGE_SIZE,
        pageToken: cursor,
      },
    })

    const items = []

    for (const account of response.accountSummaries || []) {
      for (const property of account.propertySummaries || []) {
        items.push({
          label: property.displayName || property.property,
          value: property.property.replace('properties/', ''),
          note: account.displayName,
        })
      }
    }

    const filteredItems = search
      ? searchFilter(items, ['label', 'value'], search)
      : items

    return {
      cursor: response.nextPageToken,
      items: filteredItems,
    }
  }

  /**
   * @typedef {Object} getAccountsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter accounts by display name or account ID. Filtering is applied locally to the retrieved page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Accounts Dictionary
   * @description Lists Google Analytics accounts accessible to the connected user, for selection in dependent parameters. Returns the account display name as the label and the numeric account ID as the value.
   * @route POST /get-accounts-dictionary
   * @paramDef {"type":"getAccountsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Acme Inc","value":"100200300","note":"accounts/100200300"}],"cursor":"nextPageToken123"}
   */
  async getAccountsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getAccountsDictionary',
      url: `${ ADMIN_API_BASE_URL }/accounts`,
      query: {
        pageSize: DEFAULT_PAGE_SIZE,
        pageToken: cursor,
      },
    })

    const accounts = response.accounts || []

    const filteredAccounts = search
      ? searchFilter(accounts, ['displayName', 'name'], search)
      : accounts

    return {
      cursor: response.nextPageToken,
      items: filteredAccounts.map(account => ({
        label: account.displayName || account.name,
        value: account.name.replace('accounts/', ''),
        note: account.name,
      })),
    }
  }

  /**
   * @typedef {Object} metadataDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Property","name":"propertyId","description":"The GA4 property whose metadata populates the list. When empty, the common metadata shared by all properties is used."}
   */

  /**
   * @typedef {Object} getDimensionsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter dimensions by API name or UI name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Not used — the full list is returned in a single page."}
   * @paramDef {"type":"metadataDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The property whose dimensions to list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Dimensions Dictionary
   * @description Lists the dimensions available for reporting on a GA4 property (including custom dimensions), sourced from the property's metadata. Returns the human-readable UI name as the label and the dimension API name (e.g. "country", "pagePath") as the value.
   * @route POST /get-dimensions-dictionary
   * @paramDef {"type":"getDimensionsDictionary__payload","label":"Payload","name":"payload","description":"Search, pagination, and property criteria input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Country","value":"country","note":"Geography"},{"label":"Page path","value":"pagePath","note":"Page / screen"}]}
   */
  async getDimensionsDictionary(payload) {
    const { search, criteria } = payload || {}

    const metadata = await this.#fetchMetadata(criteria?.propertyId, 'getDimensionsDictionary')

    return {
      items: buildMetadataItems(metadata.dimensions, search),
    }
  }

  /**
   * @typedef {Object} getMetricsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter metrics by API name or UI name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Not used — the full list is returned in a single page."}
   * @paramDef {"type":"metadataDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The property whose metrics to list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Metrics Dictionary
   * @description Lists the metrics available for reporting on a GA4 property (including custom metrics), sourced from the property's metadata. Returns the human-readable UI name as the label and the metric API name (e.g. "activeUsers", "sessions") as the value.
   * @route POST /get-metrics-dictionary
   * @paramDef {"type":"getMetricsDictionary__payload","label":"Payload","name":"payload","description":"Search, pagination, and property criteria input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Active users","value":"activeUsers","note":"User"},{"label":"Sessions","value":"sessions","note":"Session"}]}
   */
  async getMetricsDictionary(payload) {
    const { search, criteria } = payload || {}

    const metadata = await this.#fetchMetadata(criteria?.propertyId, 'getMetricsDictionary')

    return {
      items: buildMetadataItems(metadata.metrics, search),
    }
  }

  async #fetchMetadata(propertyId, logTag) {
    const property = propertyId ? this.#normalizeProperty(propertyId) : COMMON_METADATA_PROPERTY

    return this.#apiRequest({
      logTag,
      url: `${ DATA_API_BASE_URL }/${ property }/metadata`,
    })
  }

  // ============================================= REPORTS ==============================================

  /**
   * @description Runs a GA4 report and returns the results as plain row objects keyed by dimension and metric API names, with metric values converted to numbers (e.g. {"country":"United States","activeUsers":1234}). Also returns overall totals for the requested metrics and the total matching row count. Dates accept absolute values in YYYY-MM-DD format or relative values: "today", "yesterday", and "NdaysAgo" (e.g. "7daysAgo", "30daysAgo"). Defaults to the last 7 days. Returns up to 250,000 rows per request (default 10,000); use Limit and Offset to paginate.
   *
   * @route POST /run-report
   * @operationName Run Report
   * @category Reports
   *
   * @paramDef {"type":"String","label":"Property","name":"propertyId","required":true,"dictionary":"getPropertiesDictionary","description":"The GA4 property to report on. Select from the list or provide the numeric property ID (e.g. '123456789')."}
   * @paramDef {"type":"Array<String>","label":"Metrics","name":"metrics","required":true,"dictionary":"getMetricsDictionary","dependsOn":["propertyId"],"description":"Metric API names to report, e.g. 'activeUsers', 'sessions', 'screenPageViews', 'eventCount', 'totalRevenue'. Up to 10 metrics per request. Accepts a list or comma-separated names; use Get Metadata to discover all available metrics."}
   * @paramDef {"type":"Array<String>","label":"Dimensions","name":"dimensions","dictionary":"getDimensionsDictionary","dependsOn":["propertyId"],"description":"Dimension API names to break the metrics down by, e.g. 'date', 'country', 'pagePath', 'sessionSource'. Up to 9 dimensions per request. Accepts a list or comma-separated names. Leave empty for a single aggregate row."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","defaultValue":"7daysAgo","description":"Start of the date range (inclusive). Accepts 'YYYY-MM-DD', 'today', 'yesterday', or 'NdaysAgo' (e.g. '7daysAgo'). Default: '7daysAgo'."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","defaultValue":"today","description":"End of the date range (inclusive). Accepts 'YYYY-MM-DD', 'today', 'yesterday', or 'NdaysAgo'. Default: 'today'."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of rows to return. Maximum: 250,000. Default: 10,000 (API default)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Row offset for pagination (0-based). Use together with Limit to page through large result sets. Default: 0."}
   * @paramDef {"type":"Object","label":"Dimension Filter","name":"dimensionFilter","description":"Optional GA4 FilterExpression object applied to dimensions, passed through as-is. Example: {\"filter\":{\"fieldName\":\"country\",\"stringFilter\":{\"matchType\":\"EXACT\",\"value\":\"United States\"}}}. Supports 'andGroup', 'orGroup', 'notExpression', and 'filter' with stringFilter/inListFilter."}
   * @paramDef {"type":"Object","label":"Order Bys","name":"orderBys","description":"Optional GA4 OrderBy specification: a single OrderBy object or an array of them. Example: [{\"metric\":{\"metricName\":\"activeUsers\"},\"desc\":true}] or [{\"dimension\":{\"dimensionName\":\"date\"}}]. Default ordering is by the first metric, descending is not applied automatically."}
   *
   * @returns {Object}
   * @sampleResult {"rows":[{"country":"United States","activeUsers":1234,"sessions":1580},{"country":"Germany","activeUsers":456,"sessions":610}],"totals":{"activeUsers":1690,"sessions":2190},"rowCount":54,"metadata":{"currencyCode":"USD","timeZone":"America/Los_Angeles"}}
   */
  async runReport(propertyId, metrics, dimensions, startDate, endDate, limit, offset, dimensionFilter, orderBys) {
    const property = this.#normalizeProperty(propertyId)
    const metricNames = this.#normalizeNameList(metrics, 'Metrics')
    const dimensionNames = this.#normalizeNameList(dimensions)

    const body = cleanupObject({
      metrics: metricNames.map(name => ({ name })),
      dimensions: dimensionNames.length ? dimensionNames.map(name => ({ name })) : undefined,
      dateRanges: [{
        startDate: startDate || '7daysAgo',
        endDate: endDate || 'today',
      }],
      limit: limit || undefined,
      offset: offset || undefined,
      dimensionFilter: dimensionFilter || undefined,
      orderBys: normalizeToArray(orderBys),
      metricAggregations: ['TOTAL'],
    })

    const response = await this.#apiRequest({
      logTag: 'runReport',
      method: 'post',
      url: `${ DATA_API_BASE_URL }/${ property }:runReport`,
      body,
    })

    return this.#convertReport(response)
  }

  /**
   * @description Runs a GA4 realtime report showing activity on the property over the last 30 minutes and returns the results as plain row objects keyed by dimension and metric API names, with metric values converted to numbers. Also returns overall totals for the requested metrics. Realtime reports support a limited set of dimensions (e.g. 'country', 'city', 'deviceCategory', 'platform', 'unifiedScreenName', 'eventName', 'audienceName') and metrics (e.g. 'activeUsers', 'screenPageViews', 'eventCount', 'keyEvents').
   *
   * @route POST /run-realtime-report
   * @operationName Run Realtime Report
   * @category Reports
   *
   * @paramDef {"type":"String","label":"Property","name":"propertyId","required":true,"dictionary":"getPropertiesDictionary","description":"The GA4 property to report on. Select from the list or provide the numeric property ID (e.g. '123456789')."}
   * @paramDef {"type":"Array<String>","label":"Metrics","name":"metrics","required":true,"description":"Realtime metric API names to report, e.g. 'activeUsers', 'screenPageViews', 'eventCount', 'keyEvents'. Accepts a list or comma-separated names. Note: only the realtime-compatible subset of metrics is supported."}
   * @paramDef {"type":"Array<String>","label":"Dimensions","name":"dimensions","description":"Realtime dimension API names to break the metrics down by, e.g. 'country', 'city', 'deviceCategory', 'platform', 'unifiedScreenName', 'eventName'. Accepts a list or comma-separated names. Leave empty for a single aggregate row."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of rows to return. Maximum: 250,000. Default: 10,000 (API default)."}
   *
   * @returns {Object}
   * @sampleResult {"rows":[{"unifiedScreenName":"Home","activeUsers":42},{"unifiedScreenName":"Pricing","activeUsers":17}],"totals":{"activeUsers":59},"rowCount":2}
   */
  async runRealtimeReport(propertyId, metrics, dimensions, limit) {
    const property = this.#normalizeProperty(propertyId)
    const metricNames = this.#normalizeNameList(metrics, 'Metrics')
    const dimensionNames = this.#normalizeNameList(dimensions)

    const body = cleanupObject({
      metrics: metricNames.map(name => ({ name })),
      dimensions: dimensionNames.length ? dimensionNames.map(name => ({ name })) : undefined,
      limit: limit || undefined,
      metricAggregations: ['TOTAL'],
    })

    const response = await this.#apiRequest({
      logTag: 'runRealtimeReport',
      method: 'post',
      url: `${ DATA_API_BASE_URL }/${ property }:runRealtimeReport`,
      body,
    })

    return this.#convertReport(response)
  }

  /**
   * @description Retrieves the reporting metadata for a GA4 property: every dimension and metric available in reports, including custom dimensions and custom metrics defined on the property. Each entry includes the API name (used in Run Report), a human-readable UI name, a description, and a category. Useful for discovering valid dimension/metric names before running reports.
   *
   * @route GET /get-metadata
   * @operationName Get Metadata
   * @category Reports
   *
   * @paramDef {"type":"String","label":"Property","name":"propertyId","required":true,"dictionary":"getPropertiesDictionary","description":"The GA4 property whose metadata to retrieve. Select from the list or provide the numeric property ID. Use '0' to retrieve only the common metadata shared by all properties."}
   *
   * @returns {Object}
   * @sampleResult {"name":"properties/123456789/metadata","dimensions":[{"apiName":"country","uiName":"Country","description":"The country from which the user activity originated.","category":"Geography"}],"metrics":[{"apiName":"activeUsers","uiName":"Active users","description":"The number of distinct users who visited your site or app.","type":"TYPE_INTEGER","category":"User"}]}
   */
  async getMetadata(propertyId) {
    return this.#fetchMetadata(propertyId, 'getMetadata')
  }

  // ============================================== ADMIN ===============================================

  /**
   * @description Lists all Google Analytics accounts accessible to the connected user, including each account's resource name, display name, region, and timestamps. Supports pagination and optionally includes soft-deleted (trashed) accounts.
   *
   * @route GET /list-accounts
   * @operationName List Accounts
   * @category Admin
   *
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of accounts to return per page. Maximum: 200. Default: 50 (API default)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous List Accounts response ('nextPageToken') used to retrieve the next page of results."}
   * @paramDef {"type":"Boolean","label":"Show Deleted","name":"showDeleted","uiComponent":{"type":"TOGGLE"},"description":"Whether to include soft-deleted (trashed) accounts in the results. Default: false."}
   *
   * @returns {Object}
   * @sampleResult {"accounts":[{"name":"accounts/100200300","displayName":"Acme Inc","regionCode":"US","createTime":"2023-05-10T12:00:00.000Z","updateTime":"2025-01-15T14:30:00.000Z"}],"nextPageToken":"nextPageToken123"}
   */
  async listAccounts(pageSize, pageToken, showDeleted) {
    return this.#apiRequest({
      logTag: 'listAccounts',
      url: `${ ADMIN_API_BASE_URL }/accounts`,
      query: {
        pageSize,
        pageToken,
        showDeleted: showDeleted || undefined,
      },
    })
  }

  /**
   * @description Lists the GA4 properties under a Google Analytics account, including each property's resource name, display name, time zone, currency, and service level. Supports pagination and optionally includes soft-deleted (trashed) properties. Only GA4 properties are returned — Universal Analytics properties are not accessible through this API.
   *
   * @route GET /list-properties
   * @operationName List Properties
   * @category Admin
   *
   * @paramDef {"type":"String","label":"Account","name":"accountId","required":true,"dictionary":"getAccountsDictionary","description":"The Google Analytics account whose properties to list. Select from the list or provide the numeric account ID (e.g. '100200300')."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of properties to return per page. Maximum: 200. Default: 50 (API default)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous List Properties response ('nextPageToken') used to retrieve the next page of results."}
   * @paramDef {"type":"Boolean","label":"Show Deleted","name":"showDeleted","uiComponent":{"type":"TOGGLE"},"description":"Whether to include soft-deleted (trashed) properties in the results. Default: false."}
   *
   * @returns {Object}
   * @sampleResult {"properties":[{"name":"properties/123456789","displayName":"My Website","parent":"accounts/100200300","timeZone":"America/Los_Angeles","currencyCode":"USD","serviceLevel":"GOOGLE_ANALYTICS_STANDARD","createTime":"2023-05-10T12:00:00.000Z"}],"nextPageToken":"nextPageToken123"}
   */
  async listProperties(accountId, pageSize, pageToken, showDeleted) {
    return this.#apiRequest({
      logTag: 'listProperties',
      url: `${ ADMIN_API_BASE_URL }/properties`,
      query: {
        filter: `parent:accounts/${ this.#normalizeAccountId(accountId) }`,
        pageSize,
        pageToken,
        showDeleted: showDeleted || undefined,
      },
    })
  }
}

Flowrunner.ServerCode.addService(GoogleAnalyticsService, [
  {
    displayName: 'Client Id',
    defaultValue: '',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your OAuth 2.0 Client ID from the Google Cloud Console (used for authentication requests).',
  },
  {
    displayName: 'Client Secret',
    defaultValue: '',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your OAuth 2.0 Client Secret from the Google Cloud Console (required for secure authentication).',
  },
])

function cleanupObject(data) {
  const result = {}

  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null) {
      result[key] = data[key]
    }
  })

  return result
}

function searchFilter(list, props, searchString) {
  return list.filter(item =>
    props.some(prop => {
      const value = item[prop]

      return value && String(value).toLowerCase().includes(searchString.toLowerCase())
    })
  )
}

function normalizeToArray(value) {
  if (value === undefined || value === null) {
    return undefined
  }

  return Array.isArray(value) ? value : [value]
}

function toMetricNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null
  }

  const number = Number(value)

  return Number.isFinite(number) ? number : value
}

function buildMetadataItems(entries, search) {
  const items = (entries || []).map(entry => ({
    label: entry.uiName || entry.apiName,
    value: entry.apiName,
    note: entry.category,
  }))

  return search ? searchFilter(items, ['label', 'value'], search) : items
}
