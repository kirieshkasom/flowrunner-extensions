'use strict'

const API_VERSION = 'v24'
const API_BASE_URL = `https://googleads.googleapis.com/${ API_VERSION }`
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const USER_INFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

const DEFAULT_SCOPE_LIST = [
  'https://www.googleapis.com/auth/adwords',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const MICROS_PER_UNIT = 1000000

const MAX_CUSTOMER_NAME_LOOKUPS = 25

// GAQL predefined date range keywords (there is no LAST_90_DAYS keyword — it is computed as a BETWEEN clause)
const DATE_RANGE_KEYWORDS = {
  'Today': 'TODAY',
  'Yesterday': 'YESTERDAY',
  'Last 7 Days': 'LAST_7_DAYS',
  'Last 14 Days': 'LAST_14_DAYS',
  'Last 30 Days': 'LAST_30_DAYS',
  'This Month': 'THIS_MONTH',
  'Last Month': 'LAST_MONTH',
}

const CAMPAIGN_STATUS_OPTIONS = {
  'Enabled': 'ENABLED',
  'Paused': 'PAUSED',
}

const logger = {
  info: (...args) => console.log('[Google Ads] info:', ...args),
  debug: (...args) => console.log('[Google Ads] debug:', ...args),
  error: (...args) => console.log('[Google Ads] error:', ...args),
  warn: (...args) => console.log('[Google Ads] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName Google Ads
 * @integrationIcon /icon.png
 **/
class GoogleAdsService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.developerToken = config.developerToken
    this.loginCustomerId = config.loginCustomerId
    this.scopes = DEFAULT_SCOPE_STRING
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    if (query) {
      query = cleanupObject(query)
    }

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method](url)
        .set(this.#getHeaders())
        .query(query || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = this.#extractErrorMessage(error)

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Google Ads API error: ${ message }`)
    }
  }

  #getHeaders(accessToken) {
    const headers = {
      'Authorization': `Bearer ${ accessToken || this.request.headers['oauth-access-token'] }`,
      'developer-token': this.developerToken,
      'Content-Type': 'application/json',
    }

    const loginCustomerId = this.#normalizeCustomerId(this.loginCustomerId)

    if (loginCustomerId) {
      headers['login-customer-id'] = loginCustomerId
    }

    return headers
  }

  // Google Ads nests the real failure reason inside error.details[].errors[].message — surface the deepest messages
  #extractErrorMessage(error) {
    const apiError = error.body?.error

    if (!apiError) {
      return error.message
    }

    const detailMessages = []

    for (const detail of apiError.details || []) {
      for (const detailError of detail.errors || []) {
        if (detailError.message) {
          detailMessages.push(detailError.message)
        }
      }
    }

    return detailMessages.length ? detailMessages.join('; ') : (apiError.message || error.message)
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #normalizeCustomerId(customerId) {
    if (!customerId) {
      return undefined
    }

    return String(customerId).replace('customers/', '').replace(/-/g, '').trim()
  }

  #requireCustomerId(customerId) {
    const normalized = this.#normalizeCustomerId(customerId)

    if (!normalized) {
      throw new Error('"Customer ID" is required')
    }

    return normalized
  }

  #buildDateClause(dateRange) {
    if (!dateRange || dateRange === 'All Time') {
      return undefined
    }

    if (dateRange === 'Last 90 Days') {
      const format = date => date.toISOString().slice(0, 10)
      const end = new Date()
      const start = new Date()

      start.setDate(start.getDate() - 90)

      return `segments.date BETWEEN '${ format(start) }' AND '${ format(end) }'`
    }

    const keyword = this.#resolveChoice(dateRange, DATE_RANGE_KEYWORDS)

    return `segments.date DURING ${ keyword }`
  }

  #microsToUnits(micros) {
    if (micros === undefined || micros === null) {
      return 0
    }

    return Number(micros) / MICROS_PER_UNIT
  }

  async #searchGaql({ customerId, query, pageToken, logTag }) {
    const body = { query }

    if (pageToken) {
      body.pageToken = pageToken
    }

    return this.#apiRequest({
      logTag,
      method: 'post',
      url: `${ API_BASE_URL }/customers/${ customerId }/googleAds:search`,
      body,
    })
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
    let connectionIdentityName = 'Google Ads Account'
    let connectionIdentityImageURL = null

    try {
      userData = await Flowrunner.Request
        .get(USER_INFO_URL)
        .set({ Authorization: `Bearer ${ codeExchangeResponse.access_token }` })

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
   * @typedef {Object} getCustomersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter accounts by name or customer ID. Filtering is applied locally."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Customers Dictionary
   * @description Lists Google Ads accounts for selection in dependent parameters. When a Login Customer ID (manager account) is configured, lists all enabled client accounts under the manager via a customer_client query; otherwise lists the accounts directly accessible to the connected user, resolving each account's descriptive name where possible. The value is the 10-digit customer ID without dashes.
   * @route POST /get-customers-dictionary
   * @paramDef {"type":"getCustomersDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Acme Marketing (1234567890)","value":"1234567890","note":"Client account"}]}
   */
  async getCustomersDictionary(payload) {
    const { search } = payload || {}

    const loginCustomerId = this.#normalizeCustomerId(this.loginCustomerId)
    let items = []

    if (loginCustomerId) {
      try {
        items = await this.#listClientAccounts(loginCustomerId)
      } catch (error) {
        logger.warn(`getCustomersDictionary - customer_client lookup failed, falling back: ${ error.message }`)
      }
    }

    if (!items.length) {
      items = await this.#listDirectlyAccessibleAccounts()
    }

    const filteredItems = search
      ? searchFilter(items, ['label', 'value'], search)
      : items

    return { items: filteredItems }
  }

  async #listClientAccounts(loginCustomerId) {
    const query = `
      SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager
      FROM customer_client
      WHERE customer_client.status = 'ENABLED'
      ORDER BY customer_client.descriptive_name`

    const response = await this.#searchGaql({
      customerId: loginCustomerId,
      query,
      logTag: 'getCustomersDictionary',
    })

    return (response.results || []).map(row => {
      const client = row.customerClient || {}
      const id = String(client.id)

      return {
        label: client.descriptiveName ? `${ client.descriptiveName } (${ id })` : id,
        value: id,
        note: client.manager ? 'Manager account' : 'Client account',
      }
    })
  }

  async #listDirectlyAccessibleAccounts() {
    const response = await this.#apiRequest({
      logTag: 'getCustomersDictionary',
      url: `${ API_BASE_URL }/customers:listAccessibleCustomers`,
    })

    const customerIds = (response.resourceNames || []).map(name => name.replace('customers/', ''))

    return Promise.all(customerIds.slice(0, MAX_CUSTOMER_NAME_LOOKUPS).map(async id => {
      let label = id
      let note = 'Accessible account'

      try {
        const nameLookup = await this.#searchGaql({
          customerId: id,
          query: 'SELECT customer.id, customer.descriptive_name, customer.manager FROM customer LIMIT 1',
          logTag: 'getCustomersDictionary',
        })

        const customer = nameLookup.results?.[0]?.customer

        if (customer?.descriptiveName) {
          label = `${ customer.descriptiveName } (${ id })`
        }

        if (customer?.manager) {
          note = 'Manager account'
        }
      } catch (error) {
        logger.warn(`getCustomersDictionary - name lookup failed for ${ id }: ${ error.message }`)
      }

      return { label, value: id, note }
    }))
  }

  /**
   * @typedef {Object} getCampaignsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","description":"The Google Ads account whose campaigns populate the list."}
   */

  /**
   * @typedef {Object} getCampaignsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter campaigns by name or ID. Filtering is applied locally to the retrieved page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for retrieving the next page of results."}
   * @paramDef {"type":"getCampaignsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The account whose campaigns to list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Campaigns Dictionary
   * @description Lists campaigns of a Google Ads account for selection in dependent parameters, excluding removed campaigns. The label is the campaign name and the value is the numeric campaign ID.
   * @route POST /get-campaigns-dictionary
   * @paramDef {"type":"getCampaignsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the account criteria whose campaigns to list."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Summer Sale 2026","value":"21987654321","note":"ENABLED"}],"cursor":"CJgDEKgD"}
   */
  async getCampaignsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const customerId = this.#normalizeCustomerId(criteria?.customerId)

    if (!customerId) {
      return { items: [] }
    }

    const query = `
      SELECT campaign.id, campaign.name, campaign.status
      FROM campaign
      WHERE campaign.status != 'REMOVED'
      ORDER BY campaign.name`

    const response = await this.#searchGaql({
      customerId,
      query,
      pageToken: cursor,
      logTag: 'getCampaignsDictionary',
    })

    const items = (response.results || []).map(row => ({
      label: row.campaign.name,
      value: String(row.campaign.id),
      note: row.campaign.status,
    }))

    const filteredItems = search
      ? searchFilter(items, ['label', 'value'], search)
      : items

    return {
      items: filteredItems,
      cursor: response.nextPageToken,
    }
  }

  // ============================================ REPORTING =============================================

  /**
   * @description Runs a Google Ads Query Language (GAQL) query against a Google Ads account — the universal operation for reading any resource, report, or metric. Example: "SELECT campaign.id, campaign.name, metrics.clicks FROM campaign WHERE segments.date DURING LAST_30_DAYS ORDER BY metrics.clicks DESC". Other examples: "SELECT ad_group.id, ad_group.name FROM ad_group WHERE campaign.id = 123", "SELECT search_term_view.search_term, metrics.impressions FROM search_term_view WHERE segments.date DURING LAST_7_DAYS". Each result row contains only the selected resources (e.g. 'campaign', 'metrics', 'segments') in camelCase. Monetary metric fields such as metrics.cost_micros are returned in micros (divide by 1,000,000 for currency units). The API returns a fixed page size of 10,000 rows; use a LIMIT clause to cap results and Next Page Token for pagination.
   *
   * @route POST /search
   * @operationName Search (GAQL)
   * @category Reporting
   *
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The Google Ads account to query, as a 10-digit customer ID without dashes (e.g. '1234567890'). Select from the list or provide the ID directly."}
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The GAQL query to execute, e.g. \"SELECT campaign.id, campaign.name, metrics.clicks FROM campaign WHERE segments.date DURING LAST_30_DAYS\". See the Google Ads Query Language reference for available resources, fields, and predicates."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous Search response ('nextPageToken') used to retrieve the next page of results. Pages contain up to 10,000 rows (fixed by the API)."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"campaign":{"resourceName":"customers/1234567890/campaigns/21987654321","id":"21987654321","name":"Summer Sale 2026"},"metrics":{"clicks":"1543"}}],"totalCount":1,"nextPageToken":null,"fieldMask":"campaign.id,campaign.name,metrics.clicks"}
   */
  async search(customerId, query, pageToken) {
    if (!query) {
      throw new Error('"Query" is required')
    }

    const response = await this.#searchGaql({
      customerId: this.#requireCustomerId(customerId),
      query,
      pageToken,
      logTag: 'search',
    })

    const results = response.results || []

    return {
      results,
      totalCount: results.length,
      nextPageToken: response.nextPageToken || null,
      fieldMask: response.fieldMask || null,
    }
  }

  // ============================================ ACCOUNTS ==============================================

  /**
   * @description Lists the Google Ads accounts directly accessible by the connected user (accounts where the user is listed, not client accounts hidden behind a manager). Returns both the raw resource names and the plain 10-digit customer IDs. To enumerate client accounts under a manager (MCC) account, set the Login Customer ID config item and use Search (GAQL) with the customer_client resource.
   *
   * @route GET /list-accessible-customers
   * @operationName List Accessible Customers
   * @category Accounts
   *
   * @returns {Object}
   * @sampleResult {"resourceNames":["customers/1234567890","customers/9876543210"],"customerIds":["1234567890","9876543210"],"totalCount":2}
   */
  async listAccessibleCustomers() {
    const response = await this.#apiRequest({
      logTag: 'listAccessibleCustomers',
      url: `${ API_BASE_URL }/customers:listAccessibleCustomers`,
    })

    const resourceNames = response.resourceNames || []

    return {
      resourceNames,
      customerIds: resourceNames.map(name => name.replace('customers/', '')),
      totalCount: resourceNames.length,
    }
  }

  // ============================================ CAMPAIGNS =============================================

  /**
   * @description Lists campaigns of a Google Ads account with their status, advertising channel type, budget, and core performance metrics (clicks, impressions, cost, conversions) for the selected date range. Removed campaigns are excluded. Monetary values are converted from micros to currency units (e.g. dollars) in the account's currency. Returns up to 10,000 campaigns per page; use Page Token for pagination.
   *
   * @route GET /list-campaigns
   * @operationName List Campaigns
   * @category Campaigns
   *
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The Google Ads account whose campaigns to list, as a 10-digit customer ID without dashes."}
   * @paramDef {"type":"String","label":"Date Range","name":"dateRange","defaultValue":"Last 30 Days","uiComponent":{"type":"DROPDOWN","options":{"values":["Today","Yesterday","Last 7 Days","Last 14 Days","Last 30 Days","Last 90 Days","This Month","Last Month","All Time"]}},"description":"The date range for the returned metrics. 'All Time' aggregates metrics over the campaign's whole history. Default: 'Last 30 Days'."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous List Campaigns response ('nextPageToken') used to retrieve the next page of results."}
   *
   * @returns {Object}
   * @sampleResult {"campaigns":[{"id":"21987654321","name":"Summer Sale 2026","status":"ENABLED","channelType":"SEARCH","startDate":"2026-05-01","endDate":"2037-12-30","budget":50,"clicks":1543,"impressions":48210,"cost":812.45,"conversions":37.5,"currencyCode":"USD","resourceName":"customers/1234567890/campaigns/21987654321"}],"totalCount":1,"nextPageToken":null}
   */
  async listCampaigns(customerId, dateRange, pageToken) {
    const dateClause = this.#buildDateClause(dateRange || 'Last 30 Days')
    const whereClauses = ["campaign.status != 'REMOVED'"]

    if (dateClause) {
      whereClauses.push(dateClause)
    }

    const query = `
      SELECT
        campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
        campaign.start_date, campaign.end_date, campaign_budget.amount_micros,
        customer.currency_code,
        metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions
      FROM campaign
      WHERE ${ whereClauses.join(' AND ') }
      ORDER BY campaign.name`

    const response = await this.#searchGaql({
      customerId: this.#requireCustomerId(customerId),
      query,
      pageToken,
      logTag: 'listCampaigns',
    })

    const campaigns = (response.results || []).map(row => {
      const campaign = row.campaign || {}
      const metrics = row.metrics || {}

      return {
        id: String(campaign.id),
        name: campaign.name,
        status: campaign.status,
        channelType: campaign.advertisingChannelType,
        startDate: campaign.startDate,
        endDate: campaign.endDate,
        budget: this.#microsToUnits(row.campaignBudget?.amountMicros),
        clicks: Number(metrics.clicks || 0),
        impressions: Number(metrics.impressions || 0),
        cost: this.#microsToUnits(metrics.costMicros),
        conversions: Number(metrics.conversions || 0),
        currencyCode: row.customer?.currencyCode,
        resourceName: campaign.resourceName,
      }
    })

    return {
      campaigns,
      totalCount: campaigns.length,
      nextPageToken: response.nextPageToken || null,
    }
  }

  /**
   * @description Retrieves aggregated performance metrics for a single campaign over the selected date range: clicks, impressions, cost, conversions, click-through rate, and average cost per click. Monetary values are converted from micros to currency units in the account's currency. Returns zeroed metrics if the campaign had no activity in the range.
   *
   * @route GET /get-campaign-metrics
   * @operationName Get Campaign Metrics
   * @category Campaigns
   *
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The Google Ads account that owns the campaign, as a 10-digit customer ID without dashes."}
   * @paramDef {"type":"String","label":"Campaign","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","dependsOn":["customerId"],"description":"The campaign to report on. Choose an account above to pick from its campaigns, or provide the numeric campaign ID directly."}
   * @paramDef {"type":"String","label":"Date Range","name":"dateRange","defaultValue":"Last 30 Days","uiComponent":{"type":"DROPDOWN","options":{"values":["Today","Yesterday","Last 7 Days","Last 14 Days","Last 30 Days","Last 90 Days","This Month","Last Month","All Time"]}},"description":"The date range over which metrics are aggregated. 'All Time' aggregates over the campaign's whole history. Default: 'Last 30 Days'."}
   *
   * @returns {Object}
   * @sampleResult {"campaignId":"21987654321","campaignName":"Summer Sale 2026","status":"ENABLED","dateRange":"Last 30 Days","clicks":1543,"impressions":48210,"cost":812.45,"conversions":37.5,"ctr":0.032,"averageCpc":0.53,"currencyCode":"USD"}
   */
  async getCampaignMetrics(customerId, campaignId, dateRange) {
    if (!campaignId) {
      throw new Error('"Campaign" is required')
    }

    const normalizedCampaignId = String(campaignId).replace(/\D/g, '')
    const effectiveDateRange = dateRange || 'Last 30 Days'
    const dateClause = this.#buildDateClause(effectiveDateRange)
    const whereClauses = [`campaign.id = ${ normalizedCampaignId }`]

    if (dateClause) {
      whereClauses.push(dateClause)
    }

    const query = `
      SELECT
        campaign.id, campaign.name, campaign.status, customer.currency_code,
        metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions,
        metrics.ctr, metrics.average_cpc
      FROM campaign
      WHERE ${ whereClauses.join(' AND ') }`

    const response = await this.#searchGaql({
      customerId: this.#requireCustomerId(customerId),
      query,
      logTag: 'getCampaignMetrics',
    })

    const row = response.results?.[0]

    if (!row) {
      throw new Error(`Campaign ${ normalizedCampaignId } was not found in this account`)
    }

    const metrics = row.metrics || {}

    return {
      campaignId: String(row.campaign.id),
      campaignName: row.campaign.name,
      status: row.campaign.status,
      dateRange: effectiveDateRange,
      clicks: Number(metrics.clicks || 0),
      impressions: Number(metrics.impressions || 0),
      cost: this.#microsToUnits(metrics.costMicros),
      conversions: Number(metrics.conversions || 0),
      ctr: Number(metrics.ctr || 0),
      averageCpc: this.#microsToUnits(metrics.averageCpc),
      currencyCode: row.customer?.currencyCode,
    }
  }

  /**
   * @description Enables or pauses a Google Ads campaign using a partial mutate (updateMask=status), leaving all other campaign settings unchanged. Note: campaign and budget creation is out of scope for this integration due to the many required sub-resources (bidding strategy, budget, ad groups, ads); create campaigns in the Google Ads UI and manage their status here.
   *
   * @route POST /update-campaign-status
   * @operationName Update Campaign Status
   * @category Campaigns
   *
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The Google Ads account that owns the campaign, as a 10-digit customer ID without dashes."}
   * @paramDef {"type":"String","label":"Campaign","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","dependsOn":["customerId"],"description":"The campaign to update. Choose an account above to pick from its campaigns, or provide the numeric campaign ID directly."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"defaultValue":"Paused","uiComponent":{"type":"DROPDOWN","options":{"values":["Enabled","Paused"]}},"description":"The new serving status of the campaign. 'Enabled' resumes serving; 'Paused' stops serving while keeping all settings."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"resourceName":"customers/1234567890/campaigns/21987654321","status":"PAUSED"}
   */
  async updateCampaignStatus(customerId, campaignId, status) {
    if (!campaignId) {
      throw new Error('"Campaign" is required')
    }

    if (!status) {
      throw new Error('"Status" is required')
    }

    const normalizedCustomerId = this.#requireCustomerId(customerId)
    const normalizedCampaignId = String(campaignId).replace(/\D/g, '')
    const resourceName = `customers/${ normalizedCustomerId }/campaigns/${ normalizedCampaignId }`
    const apiStatus = this.#resolveChoice(status, CAMPAIGN_STATUS_OPTIONS)

    const response = await this.#apiRequest({
      logTag: 'updateCampaignStatus',
      method: 'post',
      url: `${ API_BASE_URL }/customers/${ normalizedCustomerId }/campaigns:mutate`,
      body: {
        operations: [
          {
            update: {
              resourceName,
              status: apiStatus,
            },
            updateMask: 'status',
          },
        ],
      },
    })

    return {
      success: true,
      resourceName: response.results?.[0]?.resourceName || resourceName,
      status: apiStatus,
    }
  }
}

Flowrunner.ServerCode.addService(GoogleAdsService, [
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
  {
    displayName: 'Developer Token',
    defaultValue: '',
    name: 'developerToken',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Google Ads API developer token, found in Google Ads under Tools > API Center (requires a manager account). Test-level tokens work only against test accounts; apply for basic/standard access to use production accounts.',
  },
  {
    displayName: 'Login Customer ID',
    defaultValue: '',
    name: 'loginCustomerId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Optional manager (MCC) account ID without dashes, e.g. 1234567890. Required when accessing client accounts managed under an MCC; leave empty when working directly with your own account.',
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
