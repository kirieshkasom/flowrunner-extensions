const { clean } = require('./utils')

const API_VERSION = 'v20.0'
const API_BASE_WWW_URL = `https://www.facebook.com/${ API_VERSION }`
const API_BASE_GRAPH_URL = `https://graph.facebook.com/${ API_VERSION }`
const OAUTH_BASE_URL = `${ API_BASE_WWW_URL }/dialog/oauth`

const DEFAULT_SCOPE_LIST = [
  'pages_manage_metadata',
  'leads_retrieval',
  'pages_manage_ads',
  'pages_read_engagement',
  'ads_read',
  'ads_management',
  'business_management',
  'pages_read_user_content',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const logger = {
  info: (...args) => console.log('[Facebook Lead Ads Service] info:', ...args),
  debug: (...args) => console.log('[Facebook Lead Ads Service] debug:', ...args),
  error: (...args) => console.log('[Facebook Lead Ads Service] error:', ...args),
  warn: (...args) => console.log('[Facebook Lead Ads Service] warn:', ...args),
}

/**
 *  @requireOAuth
 *  @integrationName Facebook Lead Ads
 *  @integrationIcon /icon.svg
 **/
class FacebookLeadAdsService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  #getAccessToken() {
    return this.request.headers['oauth-access-token']
  }

  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'GET'

    if (query) {
      query = clean(query)
    }

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      const headers = {
        Authorization: `Bearer ${ this.#getAccessToken() }`,
        'Content-Type': 'application/json',
      }

      return await Flowrunner.Request[method.toLowerCase()](url)
        .set(headers)
        .query(query)
        .send(body ? JSON.stringify(body) : undefined)
    } catch (error) {
      logger.error(`${ logTag } - error: ${ JSON.stringify(error) }`)
      throw error
    }
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   *
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()
    params.append('client_id', this.clientId)
    params.append('scope', this.scopes)
    params.append('response_type', 'code')

    const connectionURL = `${ OAUTH_BASE_URL }/?${ params.toString() }`
    logger.debug(`OAuth2 Connection URL: ${ connectionURL }`)

    return connectionURL
  }

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   *
   * @param {String} refreshToken
   *
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    logger.debug(`Refresh Token: ${ refreshToken }`)

    const params = new URLSearchParams()
    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)
    params.append('scope', this.scopes)
    params.append('refresh_token', refreshToken)
    params.append('grant_type', 'refresh_token')

    try {
      const { access_token, expires_in } = await Flowrunner.Request
        .post(`${ API_BASE_GRAPH_URL }/oauth/access_token`)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      return { token: access_token, expirationInSeconds: expires_in }
    } catch (error) {
      logger.error(`Error refreshing token: ${ error.message || error }`)

      throw error
    }
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   * @property {String} token
   * @property {String} refreshToken
   * @property {Number} expirationInSeconds
   * @property {String} connectionIdentityName
   */

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   *
   * @param {Object} callbackObject
   *
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    logger.debug(`Execute Callback: ${ JSON.stringify(callbackObject) }`)

    const params = new URLSearchParams()
    params.append('grant_type', 'authorization_code')
    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('code', callbackObject.code)

    try {
      const response = await Flowrunner.Request.post(`${ API_BASE_GRAPH_URL }/oauth/access_token`)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      logger.debug(`executeCallback -> response: ${ JSON.stringify(response) }`)

      const { access_token, refresh_token, expires_in } = response

      const profile = await Flowrunner.Request
        .get(`${ API_BASE_GRAPH_URL }/me?fields=id,name`)
        .set({ Authorization: `Bearer ${ access_token }` })
        .send()

      logger.debug(`Get profile response: ${ JSON.stringify(profile) }`)

      return {
        token: access_token,
        refreshToken: refresh_token,
        overwrite: true,
        expirationInSeconds: expires_in,
        connectionIdentityName: profile['name'] || 'Facebook User',
      }
    } catch (error) {
      logger.error(`Failed to execute callback: ${ error }`)

      throw error
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Ad Accounts
   * @category Account Management
   * @description Provides a list of Facebook Ad Accounts accessible to the authenticated user
   * @route POST /get-ad-accounts-dictionary
   *
   * @paramDef {"type":"getAdAccountsDictionary_payload","label":"Payload","name":"payload","description":"Dictionary payload containing search and cursor"}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"My Ad Account","value":"act_123456789","note":"ID: act_123456789 | Status: ACTIVE"}],"cursor":null}
   */
  async getAdAccountsDictionary(payload) {
    const { search, cursor } = payload || {}
    const response = await this.#apiRequest({
      url: `${ API_BASE_GRAPH_URL }/me/adaccounts`,
      query: {
        fields: 'id,name,account_status',
        limit: 25,
        after: cursor,
      },
      logTag: 'getAdAccountsDictionary',
    })

    let items = response.data || []

    // Filter by search if provided
    if (search) {
      items = items.filter(account =>
        account.name?.toLowerCase().includes(search.toLowerCase())
      )
    }

    // Map account status to readable string
    const getStatusText = status => {
      const statusMap = {
        1: 'ACTIVE',
        2: 'DISABLED',
        3: 'UNSETTLED',
        7: 'PENDING_RISK_REVIEW',
        8: 'PENDING_SETTLEMENT',
        9: 'IN_GRACE_PERIOD',
        100: 'PENDING_CLOSURE',
        101: 'CLOSED',
        201: 'ANY_ACTIVE',
        202: 'ANY_CLOSED',
      }

      return statusMap[status] || 'UNKNOWN'
    }

    return {
      items: items.map(account => ({
        label: account.name || 'Unnamed Account',
        value: account.id,
        note: `ID: ${ account.id } | Status: ${ getStatusText(account.account_status) }`,
      })),
      cursor: response.paging?.cursors?.after || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Campaigns
   * @category Campaign Management
   * @description Provides a list of Facebook Ad Campaigns for a given Ad Account
   * @route POST /get-campaigns-dictionary
   *
   * @paramDef {"type":"getCampaignsDictionary_payload","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria with adAccountId"}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Summer Campaign 2024","value":"123456789","note":"ID: 123456789 | Status: ACTIVE | Objective: OUTCOME_TRAFFIC"}],"cursor":null}
   */
  async getCampaignsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const { adAccountId } = criteria || {}

    if (!adAccountId) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_GRAPH_URL }/${ adAccountId }/campaigns`,
      query: {
        fields: 'id,name,status,objective',
        limit: 25,
        after: cursor,
      },
      logTag: 'getCampaignsDictionary',
    })

    let items = response.data || []

    // Filter by search if provided
    if (search) {
      items = items.filter(campaign =>
        campaign.name?.toLowerCase().includes(search.toLowerCase())
      )
    }

    return {
      items: items.map(campaign => ({
        label: campaign.name || 'Unnamed Campaign',
        value: campaign.id,
        note: `ID: ${ campaign.id } | Status: ${ campaign.status } | Objective: ${ campaign.objective }`,
      })),
      cursor: response.paging?.cursors?.after || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Ad Sets
   * @category Ad Set Management
   * @description Provides a list of Facebook Ad Sets for a given Campaign
   * @route POST /get-ad-sets-dictionary
   *
   * @paramDef {"type":"getAdSetsDictionary_payload","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria with campaignId"}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Target Audience 18-25","value":"123456789","note":"ID: 123456789 | Status: ACTIVE | Daily Budget: $50.00"}],"cursor":null}
   */
  async getAdSetsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const { campaignId } = criteria || {}

    if (!campaignId) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_GRAPH_URL }/${ campaignId }/adsets`,
      query: {
        fields: 'id,name,status,daily_budget,lifetime_budget',
        limit: 25,
        after: cursor,
      },
      logTag: 'getAdSetsDictionary',
    })

    let items = response.data || []

    // Filter by search if provided
    if (search) {
      items = items.filter(adSet =>
        adSet.name?.toLowerCase().includes(search.toLowerCase())
      )
    }

    return {
      items: items.map(adSet => {
        const budget = adSet.daily_budget
          ? `Daily Budget: $${ (adSet.daily_budget / 100).toFixed(2) }`
          : adSet.lifetime_budget
            ? `Lifetime Budget: $${ (adSet.lifetime_budget / 100).toFixed(2) }`
            : 'No budget set'

        return {
          label: adSet.name || 'Unnamed Ad Set',
          value: adSet.id,
          note: `ID: ${ adSet.id } | Status: ${ adSet.status } | ${ budget }`,
        }
      }),
      cursor: response.paging?.cursors?.after || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Pages
   * @category Asset Management
   * @description Provides a list of Facebook Pages accessible to the authenticated user
   * @route POST /get-pages-dictionary
   *
   * @paramDef {"type":"getPagesDictionary_payload","label":"Payload","name":"payload","description":"Dictionary payload containing search and cursor"}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"My Business Page","value":"123456789","note":"ID: 123456789 | Category: Local Business"}],"cursor":null}
   */
  async getPagesDictionary(payload) {
    const { search, cursor } = payload || {}
    const response = await this.#apiRequest({
      url: `${ API_BASE_GRAPH_URL }/me/accounts`,
      query: {
        fields: 'id,name,category',
        limit: 25,
        after: cursor,
      },
      logTag: 'getPagesDictionary',
    })

    let items = response.data || []

    // Filter by search if provided
    if (search) {
      items = items.filter(page =>
        page.name?.toLowerCase().includes(search.toLowerCase())
      )
    }

    return {
      items: items.map(page => ({
        label: page.name || 'Unnamed Page',
        value: page.id,
        note: `ID: ${ page.id }${ page.category ? ` | Category: ${ page.category }` : '' }`,
      })),
      cursor: response.paging?.cursors?.after || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Lead Forms Dictionary
   * @category Lead Forms
   * @description Provides a list of Lead Generation Forms for a given Facebook Page
   * @route POST /get-lead-forms-dictionary
   *
   * @paramDef {"type":"getLeadFormsDictionary_payload","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria with pageId"}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Contact Form 2024","value":"123456789","note":"ID: 123456789 | Status: ACTIVE | Locale: en_US"}],"cursor":null}
   */
  async getLeadFormsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const { pageId } = criteria || {}

    if (!pageId) {
      return { items: [], cursor: null }
    }

    // First get page access token
    const pageResponse = await this.#apiRequest({
      url: `${ API_BASE_GRAPH_URL }/${ pageId }`,
      query: { fields: 'access_token' },
      logTag: 'getLeadFormsDictionary-pageToken',
    })

    // Then get lead forms using page access token
    const headers = {
      Authorization: `Bearer ${ pageResponse.access_token }`,
      'Content-Type': 'application/json',
    }

    const response = await Flowrunner.Request
      .get(`${ API_BASE_GRAPH_URL }/${ pageId }/leadgen_forms`)
      .set(headers)
      .query({
        fields: 'id,name,status,locale',
        limit: 25,
        after: cursor,
      })

    let items = response.data || []

    // Filter by search if provided
    if (search) {
      items = items.filter(form => form.name?.toLowerCase().includes(search.toLowerCase()))
    }

    return {
      items: items.map(form => ({
        label: form.name || 'Unnamed Form',
        value: form.id,
        note: `ID: ${ form.id } | Status: ${ form.status } | Locale: ${ form.locale }`,
      })),
      cursor: response.paging?.cursors?.after || null,
    }
  }

  /**
   * @route GET /ad-account
   *
   * @operationName Get Ad Account Info
   * @category Account Management
   * @description Retrieves information about a Facebook Ad Account including ID, name, account status, balance, and currency
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes ads_management,ads_read
   *
   * @paramDef {"type":"String","label":"Ad Account ID","name":"adAccountId","required":true,"dictionary":"getAdAccountsDictionary","description":"The unique identifier for the Facebook Ad Account. Should be in the format 'act_{ad_account_id}'."}
   *
   * @returns {Object}
   * @sampleResult {"id": "act_123456789", "name": "My Ad Account", "account_status": 1, "balance": 500.00, "currency": "USD"}
   */
  async getAdAccountInfo(adAccountId) {
    const fields = 'id,name,account_status,balance,currency'

    return this.#apiRequest({
      url: `${ API_BASE_GRAPH_URL }/${ adAccountId }`,
      query: { fields },
      logTag: 'getAdAccountInfo',
    })
  }

  /**
   * @route GET /ad-account-insights
   *
   * @operationName Get Ad Account Insights
   * @category Account Management
   * @description Retrieves insights data for a Facebook Ad Account including campaign performance metrics
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes ads_management,ads_read
   *
   * @paramDef {"type":"String","label":"Ad Account ID","name":"adAccountId","required":true,"dictionary":"getAdAccountsDictionary","description":"The unique identifier for the Facebook Ad Account. Should be in the format 'act_{ad_account_id}'."}
   *
   * @returns {Object}
   * @sampleResult {"date_start": "2024-01-01", "date_stop": "2024-01-31", "campaign_name": "Campaign 1", "spend": 250.00, "impressions": 5000, "clicks": 150}
   */
  async getAdInsights(adAccountId) {
    const fields = 'date_start,date_stop,campaign_name,spend,impressions,clicks'

    return this.#apiRequest({
      url: `${ API_BASE_GRAPH_URL }/${ adAccountId }/insights`,
      query: { fields },
      logTag: 'getAdInsights',
    })
  }

  /**
   * @route POST /campaigns
   *
   * @operationName Create Ad Campaign
   * @category Campaign Management
   * @description Creates a new Facebook Ad Campaign with specified parameters and targeting options
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes ads_management
   *
   * @paramDef {"type":"String","label":"Ad Account Id","name":"adAccountId","required":true,"description":"The unique identifier for the Facebook Ad Account. Should be in the format 'act_{ad_account_id}'."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the campaign. This is a required field and should be unique within the ad account."}
   * @paramDef {"type":"String","label":"Objective","name":"objective","required":true,"description":"The objective of the campaign. Examples include 'OUTCOME_LEADS', 'OUTCOME_TRAFFIC', etc. Refer to Facebook's documentation for a full list of objectives."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"description":"The status of the campaign. Must be either 'ACTIVE' or 'PAUSED'. Default is 'ACTIVE'."}
   * @paramDef {"type":"Array","label":"Special Ad Categories","name":"specialAdCategories","required":true,"description":"Array of special ad categories applicable to the campaign (e.g., 'HOUSING', 'EMPLOYMENT')."}
   * @paramDef {"type":"String","label":"Buying Type","name":"buyingType","required":false,"description":"The buying type for the campaign, such as 'AUCTION' or 'FIXED_PRICE'. Defaults to 'AUCTION'."}
   * @paramDef {"type":"Number","label":"Spend Cap","name":"spendCap","required":false,"description":"The maximum amount of money the campaign can spend, in cents. Default is 0 (unlimited)."}
   * @paramDef {"type":"Number","label":"Daily Budget","name":"dailyBudget","required":false,"description":"The daily budget for the campaign, in cents. This is a required field when the buying type is 'AUCTION'."}
   * @paramDef {"type":"String","label":"Start Time","name":"startTime","required":false,"description":"The start time of the campaign in ISO 8601 format (e.g., '2024-01-01T00:00:00Z'). Optional. If not specified, the campaign will start immediately."}
   * @paramDef {"type":"String","label":"Stop Time","name":"stopTime","required":false,"description":"The end time of the campaign in ISO 8601 format. Optional."}
   * @paramDef {"type":"Array","label":"Ad Labels","name":"adLabels","required":false,"description":"Array of ad labels to apply to the campaign. Each label can be represented as an object with 'id' and 'name'."}
   * @paramDef {"type":"String","label":"Bid Strategy","name":"bidStrategy","required":false,"description":"The bid strategy for the campaign, such as 'LOWEST_COST' or 'TARGET_COST'. Default is 'LOWEST_COST'."}
   * @paramDef {"type":"Object","label":"Promoted Object","name":"promotedObject","required":false,"description":"Object specifying what is being promoted in the campaign, e.g., a product catalog, app, etc."}
   *
   * @returns {Object}
   * @sampleResult {"id":"120214682014080036"}
   */
  async createAdCampaign(
    adAccountId,
    name,
    objective,
    status,
    specialAdCategories,
    buyingType,
    spendCap,
    dailyBudget,
    startTime,
    stopTime,
    adLabels,
    bidStrategy,
    promotedObject
  ) {
    const payload = {
      name,
      objective,
      status,
      special_ad_categories: specialAdCategories,
      buying_type: buyingType,
      spend_cap: spendCap,
      daily_budget: dailyBudget,
      start_time: startTime,
      stop_time: stopTime,
      ad_labels: adLabels,
      bid_strategy: bidStrategy,
      promoted_object: promotedObject,
    }

    return this.#apiRequest({
      url: `${ API_BASE_GRAPH_URL }/${ adAccountId }/campaigns`,
      method: 'POST',
      body: payload,
      logTag: 'createAdCampaign',
    })
  }

  /**
   * @route POST /campaign-insights
   *
   * @operationName Get Campaign Insights
   * @category Campaign Management
   * @description Retrieves performance insights and metrics for a specific Facebook Ad Campaign
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes ads_read
   *
   * @paramDef {"type":"String","label":"Campaign Id","name":"campaignId","required":true,"description":"Unique identifier for the campaign you want to fetch insights for."}
   * @paramDef {"type":"String","label":"Date Preset","name":"datePreset","description":"Preset time range for the insights (e.g., 'last_7d', 'last_30d')."}
   * @paramDef {"type":"Array","label":"Action Attribution Windows","name":"actionAttributionWindows","description":"The action attribution windows for the insights (e.g., ['1d_click', '7d_click'])."}
   *
   * @returns {Object}
   * @sampleResult {"impressions": 10000, "clicks": 150, "spend": 200.00, "conversions": 30, "reach": 8000, "frequency": 1.25, "ctr": 1.5}
   */
  async getCampaignInsights(campaignId, datePreset, actionAttributionWindows) {
    const payload = {
      date_preset: datePreset,
      fields: 'impressions,clicks,spend,conversions,reach,frequency,ctr',
    }

    if (actionAttributionWindows && actionAttributionWindows.length > 0) {
      payload.action_attribution_windows = actionAttributionWindows.join(',')
    }

    return this.#apiRequest({
      url: `${ API_BASE_GRAPH_URL }/${ campaignId }/insights`,
      query: payload,
      logTag: 'getCampaignInsights',
    })
  }

  /**
   * @route GET /campaigns
   *
   * @operationName Get All Ad Campaigns
   * @category Campaign Management
   * @description Retrieves all campaigns associated with a Facebook Ad Account
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes ads_read
   *
   * @paramDef {"type":"String","label":"Ad Account Id","name":"adAccountId","required":true,"description":"The unique identifier for the Facebook Ad Account."}
   *
   * @returns {Array}
   * @sampleResult [{"id":"1234567890", "name":"Campaign 1", "status":"ACTIVE", "objective":"OUTCOME_TRAFFIC"}, {"id":"0987654321", "name":"Campaign 2", "status":"PAUSED", "objective":"OUTCOME_LEADS"}]
   */
  async getAllAdCampaigns(adAccountId) {
    const fields = 'id,name,status,objective'

    return this.#apiRequest({
      url: `${ API_BASE_GRAPH_URL }/${ adAccountId }/campaigns`,
      query: { fields },
      logTag: 'getAllAdCampaigns',
    })
  }

  /**
   * @route PUT /campaigns
   *
   * @operationName Update Ad Campaign
   * @category Campaign Management
   * @description Updates an existing Facebook Ad Campaign with new parameters and settings
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes ads_management
   *
   * @paramDef {"type":"String","label":"Campaign Id","name":"campaignId","required":true,"description":"Unique identifier for the campaign to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The new name for the campaign."}
   * @paramDef {"type":"String","label":"Objective","name":"objective","description":"The campaign's objective (e.g., BRAND_AWARENESS, LEAD_GENERATION)."}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"The status of the campaign (e.g., ACTIVE, PAUSED)."}
   * @paramDef {"type":"Array","label":"Special Ad Categories","name":"specialAdCategories","description":"Special ad categories (e.g., housing, employment, credit)."}
   * @paramDef {"type":"String","label":"Buying Type","name":"buyingType","description":"The buying type (e.g., AUCTION, FIXED_PRICE)."}
   * @paramDef {"type":"Number","label":"Spend Cap","name":"spendCap","description":"The spending limit for the campaign."}
   * @paramDef {"type":"Number","label":"Daily Budget","name":"dailyBudget","description":"The daily budget for the campaign."}
   * @paramDef {"type":"String","label":"Start Time","name":"startTime","description":"The start time of the campaign in ISO 8601 format."}
   * @paramDef {"type":"String","label":"Stop Time","name":"stopTime","description":"The stop time of the campaign in ISO 8601 format."}
   * @paramDef {"type":"String","label":"Bid Strategy","name":"bidStrategy","description":"The bid strategy for the campaign (e.g., LOWEST_COST)."}
   * @paramDef {"type":"Object","label":"Promoted Object","name":"promotedObject","description":"The object to promote (e.g., a Facebook page or website)."}
   *
   * @returns {Object}
   * @sampleResult {"success": true}
   */
  async updateAdCampaign(
    campaignId,
    name,
    objective,
    status,
    specialAdCategories,
    buyingType,
    spendCap,
    dailyBudget,
    startTime,
    stopTime,
    bidStrategy,
    promotedObject
  ) {
    const payload = {
      name,
      objective,
      status,
      special_ad_categories: specialAdCategories,
      buying_type: buyingType,
      spend_cap: spendCap,
      daily_budget: dailyBudget,
      start_time: startTime,
      stop_time: stopTime,
      bid_strategy: bidStrategy,
      promoted_object: promotedObject,
    }

    return this.#apiRequest({
      url: `${ API_BASE_GRAPH_URL }/${ campaignId }`,
      method: 'POST',
      body: payload,
      logTag: 'updateAdCampaign',
    })
  }

  /**
   * @route DELETE /campaigns
   *
   * @operationName Delete Ad Campaign
   * @category Campaign Management
   * @description Deletes a Facebook Ad Campaign permanently from the account
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes ads_management
   *
   * @paramDef {"type":"String","label":"Campaign Id","name":"campaignId","required":true,"description":"Unique identifier for the campaign to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success": true}
   */
  async deleteAdCampaign(campaignId) {
    return this.#apiRequest({
      url: `${ API_BASE_GRAPH_URL }/${ campaignId }`,
      method: 'DELETE',
      logTag: 'deleteAdCampaign',
    })
  }

  /**
   * @route POST /create-adset
   *
   * @operationName Create Ad Set
   * @category Ad Set Management
   * @description Creates a new Facebook Ad Set within a campaign with targeting and budget parameters
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes ads_management
   *
   * @paramDef {"type":"String","label":"Ad Account Id","name":"adAccountId","required":true,"description":"The unique identifier for the Facebook Ad Account."}
   * @paramDef {"type":"String","label":"Campaign Id","name":"campaignId","required":true,"description":"The unique identifier for the Facebook Campaign."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the ad set. This is a required field and should be unique within the campaign."}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"The status of the ad set. Must be either 'ACTIVE' or 'PAUSED'. Default is 'ACTIVE'."}
   * @paramDef {"type":"Number","label":"Daily Budget","name":"dailyBudget","required":true,"description":"The daily budget for the ad set, in cents. This is a required field when the buying type is 'AUCTION'."}
   * @paramDef {"type":"String","label":"Start Time","name":"startTime","description":"The start time of the ad set in ISO 8601 format (e.g., '2024-01-01T00:00:00Z')."}
   * @paramDef {"type":"String","label":"Stop Time","name":"stopTime","description":"The end time of the ad set in ISO 8601 format."}
   * @paramDef {"type":"Object","label":"Targeting","name":"targeting","required":true,"description":"The targeting specifications for the ad set."}
   * @paramDef {"type":"String","label":"Billing Event","name":"billingEvent","required":false,"description":"The billing event for the ad set. E.g., 'IMPRESSIONS'."}
   * @paramDef {"type":"Number","label":"Bid Amount","name":"bidAmount","required":false,"description":"The bid amount for the ad set in cents. Optional."}
   * @paramDef {"type":"String","label":"Optimization Goal","name":"optimizationGoal","required":false,"description":"The optimization goal for the ad set. E.g., 'LINK_CLICKS'."}
   * @paramDef {"type":"Array","label":"Adset Schedule","name":"adsetSchedule","required":false,"description":"The schedule for the ad set as an array of objects containing start and end times."}
   * @paramDef {"type":"Number","label":"Daily Spend Cap","name":"dailySpendCap","required":false,"description":"The daily spend cap for the ad set in cents. Optional."}
   * @paramDef {"type":"String","label":"Destination Type","name":"destinationType","required":false,"description":"The type of destination for the ad set. E.g., 'WEBSITE'."}
   * @paramDef {"type":"Object","label":"Promoted Object","name":"promotedObject","required":false,"description":"The object being promoted in the ad set."}
   *
   * @returns {Object}
   * @sampleResult {"id": "120214694681520036"}
   */
  async createAdSet(
    adAccountId,
    campaignId,
    name,
    status,
    dailyBudget,
    startTime,
    stopTime,
    targeting,
    billingEvent,
    bidAmount,
    optimizationGoal,
    adsetSchedule,
    dailySpendCap,
    destinationType,
    promotedObject
  ) {
    const payload = {
      campaign_id: campaignId,
      name,
      status,
      daily_budget: dailyBudget,
      start_time: startTime,
      stop_time: stopTime,
      targeting,
      billing_event: billingEvent,
      bid_amount: bidAmount,
      optimization_goal: optimizationGoal,
      adset_schedule: adsetSchedule,
      daily_spend_cap: dailySpendCap,
      destination_type: destinationType,
      promoted_object: promotedObject,
    }

    return this.#apiRequest({
      url: `${ API_BASE_GRAPH_URL }/${ adAccountId }/adsets`,
      method: 'POST',
      body: payload,
      logTag: 'createAdSet',
    })
  }

  /**
   * @route POST /update-adset
   *
   * @operationName Update Ad Set
   * @category Ad Set Management
   * @description Updates an existing Facebook Ad Set with new budget, targeting, or scheduling parameters
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes ads_management
   *
   * @paramDef {"type":"String","label":"Ad Set ID","name":"adSetId","required":true,"description":"The unique identifier for the Facebook Ad Set."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":false,"description":"The name of the ad set. This field is optional but can be updated."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"description":"The status of the ad set. Must be either 'ACTIVE' or 'PAUSED'."}
   * @paramDef {"type":"Number","label":"Daily Budget","name":"dailyBudget","required":false,"description":"The daily budget for the ad set, in cents."}
   * @paramDef {"type":"Number","label":"Lifetime Budget","name":"lifetimeBudget","required":false,"description":"The total budget for the ad set, in cents."}
   * @paramDef {"type":"Number","label":"Bid Amount","name":"bidAmount","required":false,"description":"The bid amount in cents."}
   * @paramDef {"type":"String","label":"Billing Event","name":"billingEvent","required":false,"description":"Specifies when charges occur, such as 'IMPRESSIONS' or 'LINK_CLICKS'."}
   * @paramDef {"type":"String","label":"Optimization Goal","name":"optimizationGoal","required":false,"description":"The optimization goal, like 'REACH', 'CONVERSIONS', or 'LEAD_GENERATION'."}
   * @paramDef {"type":"String","label":"Start Time","name":"startTime","required":false,"description":"Start time for the ad set in ISO format."}
   * @paramDef {"type":"String","label":"End Time","name":"endTime","required":false,"description":"End time for the ad set in ISO format."}
   * @paramDef {"type":"String","label":"Campaign Id","name":"campaignId","required":false,"description":"The campaign ID to which the ad set belongs."}
   * @paramDef {"type":"Object","label":"Promoted Object","name":"promotedObject","required":false,"description":"Specifies the promoted object, such as a page or app."}
   * @paramDef {"type":"String","label":"Bid Strategy","name":"bidStrategy","required":false,"description":"Bidding strategy, like 'LOWEST_COST_WITHOUT_CAP' or 'COST_CAP'."}
   * @paramDef {"type":"Array","label":"Pacing Type","name":"pacingType","required":false,"description":"Defines pacing strategy, e.g., 'standard'."}
   * @paramDef {"type":"Array","label":"Ad Set Schedule","name":"adsetSchedule","required":false,"description":"Specifies the schedule for the ad set with start and end times."}
   * @paramDef {"type":"Object","label":"Targeting","name":"targeting","required":false,"description":"The targeting specifications for the ad set."}
   *
   * @returns {Object}
   * @sampleResult {"success": true}
   */
  async updateAdSet(
    adSetId,
    name,
    status,
    dailyBudget,
    lifetimeBudget,
    bidAmount,
    billingEvent,
    optimizationGoal,
    startTime,
    endTime,
    campaignId,
    promotedObject,
    bidStrategy,
    pacingType,
    adsetSchedule,
    targeting
  ) {
    const payload = {
      name,
      status,
      daily_budget: dailyBudget,
      lifetime_budget: lifetimeBudget,
      bid_amount: bidAmount,
      billing_event: billingEvent,
      optimization_goal: optimizationGoal,
      start_time: startTime,
      end_time: endTime,
      campaign_id: campaignId,
      promoted_object: promotedObject,
      bid_strategy: bidStrategy,
      pacing_type: pacingType,
      adset_schedule: adsetSchedule,
      targeting,
    }

    return this.#apiRequest({
      url: `${ API_BASE_GRAPH_URL }/${ adSetId }`,
      method: 'POST',
      body: payload,
      logTag: 'updateAdSet',
    })
  }

  /**
   * @route GET /adsets
   *
   * @operationName Get All Ad Sets
   * @category Ad Set Management
   * @description Retrieves all ad sets associated with a specific Facebook Ad Campaign
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes ads_read
   *
   * @paramDef {"type":"String","label":"Campaign ID","name":"campaignId","required":true,"description":"The unique identifier for the Facebook Campaign."}
   *
   * @returns {Array}
   * @sampleResult [{"id":"1234567890", "name":"Ad Set 1", "status":"ACTIVE", "daily_budget":5000, "lifetime_budget":100000, "bid_strategy":"LOWEST_COST", "start_time":"2024-01-01T00:00:00Z", "end_time":"2024-01-31T00:00:00Z"}, {"id":"0987654321", "name":"Ad Set 2", "status":"PAUSED", "daily_budget":3000, "lifetime_budget":50000, "bid_strategy":"COST_CAP", "start_time":"2024-02-01T00:00:00Z", "end_time":"2024-02-28T00:00:00Z"}]
   */
  async getAllAdSets(campaignId) {
    const fields = 'id,name,status,daily_budget,lifetime_budget,bid_strategy,start_time,end_time'

    return this.#apiRequest({
      url: `${ API_BASE_GRAPH_URL }/${ campaignId }/adsets`,
      query: { fields },
      logTag: 'getAllAdSets',
    })
  }

  /**
   * @route DELETE /delete-adset
   *
   * @operationName Delete Ad Set
   * @category Ad Set Management
   * @description Deletes a Facebook Ad Set permanently from the campaign
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes ads_management
   *
   * @paramDef {"type":"String","label":"Ad Set ID","name":"adSetId","required":true,"description":"The unique identifier for the Facebook Ad Set."}
   *
   * @returns {Object}
   * @sampleResult {"success": true}
   */
  async deleteAdSet(adSetId) {
    return this.#apiRequest({
      url: `${ API_BASE_GRAPH_URL }/${ adSetId }`,
      method: 'DELETE',
      logTag: 'deleteAdSet',
    })
  }

  /**
   * @route GET /adset-insights
   *
   * @operationName Get Ad Set Insights
   * @category Ad Set Management
   * @description Retrieves performance insights and metrics for a specific Facebook Ad Set
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes ads_read
   *
   * @paramDef {"type":"String","label":"Ad Set ID","name":"adSetId","required":true,"description":"The unique identifier for the Facebook Ad Set."}
   * @paramDef {"type":"String","label":"Date Preset","name":"datePreset","required":false,"description":"The date range for the insights. Optional, defaults to 'last_30d'."}
   *
   * @returns {Object}
   * @sampleResult {"impressions": 1000, "clicks": 150, "spend": 50.00}
   */
  async getAdSetInsights(adSetId, datePreset) {
    const params = {
      date_preset: datePreset,
      fields: 'impressions,clicks,spend',
    }

    return this.#apiRequest({
      url: `${ API_BASE_GRAPH_URL }/${ adSetId }/insights`,
      query: params,
      logTag: 'getAdSetInsights',
    })
  }

  /**
   * @route POST /ads
   *
   * @operationName Create Ad
   * @category Ad Management
   * @description Creates a new Facebook Ad within an ad set using a specified creative
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes ads_management
   *
   * @paramDef {"type":"String","label":"Ad Account Id","name":"adAccountId","required":true,"description":"The unique identifier for the Facebook Ad Account."}
   * @paramDef {"type":"String","label":"Ad Set Id","name":"adSetId","required":true,"description":"The unique identifier for the Facebook Ad Set."}
   * @paramDef {"type":"String","label":"Creative Id","name":"creativeId","required":true,"description":"The unique identifier for the ad creative."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the ad. Must be a non-empty string."}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"The status of the ad. Must be either 'ACTIVE' or 'PAUSED'."}
   *
   * @returns {Object}
   * @sampleResult {"id": 1234567890}
   */
  async createAd(adAccountId, adSetId, creativeId, name, status) {
    return this.#apiRequest({
      url: `${ API_BASE_GRAPH_URL }/${ adAccountId }/ads`,
      method: 'POST',
      body: {
        adset_id: adSetId,
        creative: { creative_id: creativeId },
        name,
        status,
      },
      logTag: 'createAd',
    })
  }

  /**
   * @route POST /update-ad
   *
   * @operationName Update Ad
   * @category Ad Management
   * @description Updates an existing Facebook Ad with new creative, name, or status settings
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes ads_management
   *
   * @paramDef {"type":"String","label":"Ad Id","name":"adId","required":true,"description":"The unique identifier for the Facebook Ad to be updated."}
   * @paramDef {"type":"String","label":"Creative Id","name":"creativeId","description":"The unique identifier for the ad creative."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the ad. Must be a non-empty string."}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"The status of the ad. Must be either 'ACTIVE' or 'PAUSED'."}
   *
   * @returns {Object}
   * @sampleResult {"success": true}
   */
  async updateAd(adId, creativeId, name, status) {
    return this.#apiRequest({
      url: `${ API_BASE_GRAPH_URL }/${ adId }`,
      method: 'POST',
      body: {
        creative: creativeId ? { creative_id: creativeId } : undefined,
        name,
        status,
      },
      logTag: 'updateAd',
    })
  }

  /**
   * @route DELETE /ads
   *
   * @operationName Delete Ad
   * @category Ad Management
   * @description Deletes a Facebook Ad permanently from the ad set
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes ads_management
   *
   * @paramDef {"type":"String","label":"Ad Id","name":"adId","required":true,"description":"The unique identifier for the Facebook Ad to be deleted."}
   *
   * @returns {Object}
   * @sampleResult {"success": true}
   */
  async deleteAd(adId) {
    return this.#apiRequest({ url: `${ API_BASE_GRAPH_URL }/${ adId }`, method: 'DELETE', logTag: 'deleteAd' })
  }

  /**
   * @route POST /leadgen-forms
   *
   * @operationName Create Lead Form
   * @category Lead Forms
   * @description Creates a new Facebook Lead Generation form with custom questions and privacy settings
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes ads_management,pages_manage_metadata
   *
   * @paramDef {"type":"String","label":"Page Id","name":"pageId","required":true,"description":"The unique identifier for the Facebook Page."}
   * @paramDef {"type":"String","label":"Form Name","name":"formName","required":true,"description":"The name of the lead generation form. This is a required field."}
   * @paramDef {"type":"String","label":"Legal Content Id","name":"legalContentId","description":"The ID of the legal content to be associated with the form."}
   * @paramDef {"type":"Object","label":"Privacy Policy","name":"privacyPolicy","description":"The privacy policy URL to be associated with the form."}
   * @paramDef {"type":"Array","label":"Questions","name":"questions","required":true,"description":"Array of objects defining the questions in the form. This is a required field."}
   * @paramDef {"type":"String","label":"Follow Up Action URL","name":"followUpActionUrl","description":"The URL for follow-up actions after the form is submitted."}
   *
   * @returns {Object}
   * @sampleResult {"id": "509803975225108"}
   */
  async createLeadForm(pageId, formName, legalContentId, privacyPolicy, questions, followUpActionUrl) {
    const payload = {
      name: formName,
      questions,
      legal_content_id: legalContentId,
      privacy_policy: privacyPolicy,
      follow_up_action_url: followUpActionUrl,
    }

    return this.#apiRequest({
      url: `${ API_BASE_GRAPH_URL }/${ pageId }/leadgen_forms`,
      method: 'POST',
      body: payload,
      logTag: 'createLeadForm',
    })
  }

  /**
   * @route GET /leadgen-forms
   *
   * @operationName Get Lead Forms
   * @category Lead Forms
   * @description Retrieves all lead generation forms associated with a Facebook page
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 60
   *
   * @requiredOauth2Scopes pages_read_engagement,ads_management
   *
   * @paramDef {"type":"String","label":"Page Id","name":"pageId","required":true,"description":"The unique identifier of the Facebook page for which the lead forms are requested."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"name":"Leadgen Form Name","id":"509803975225108","locale":"en_US","status":"ACTIVE"}],"paging":{"cursors":{"before":"QVFIUkxSYkNrdVkyUzFUN1h0VGE3OVF1ZAzZAtb181bWJ4YkVUbGdsRy1JbGhLRlBzSGZA0bmNWaTVqZAWRRZAHRfWm1ZAbUE2bTQyUzV4ZAm8yNmJqNGlFd21peDVn","after":"QVFIUkxSYkNrdVkyUzFUN1h0VGE3OVF1ZAzZAtb181bWJ4YkVUbGdsRy1JbGhLRlBzSGZA0bmNWaTVqZAWRRZAHRfWm1ZAbUE2bTQyUzV4ZAm8yNmJqNGlFd21peDVn"}}}
   */
  async getLeadForms(pageId) {
    const response = await Flowrunner.Request
      .get(`${ API_BASE_GRAPH_URL }/${ pageId }?fields=access_token`)
      .set({ Authorization: `Bearer ${ this.#getAccessToken() }` })
      .send()

    const headers = {
      Authorization: `Bearer ${ response.access_token }`,
      'Content-Type': 'application/json',
    }

    return Flowrunner.Request.get(`${ API_BASE_GRAPH_URL }/${ pageId }/leadgen_forms`).set(headers)
  }

  /**
   * @route GET /leadgen-form-info
   *
   * @operationName Get Lead Form Info
   * @category Lead Forms
   * @description Retrieves detailed information about a specific lead generation form including questions and settings
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes pages_read_engagement,ads_management
   *
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"description":"The unique identifier of the lead form for which questions are requested."}
   *
   * @returns {Array}
   * @sampleResult {"created_time":"2024-10-25T12:47:43+0000","follow_up_action_url":"https://yourwebsite.com/thank-you","name":"Form Name","questions":[{"label":"Full name","id":"495405253475918","type":"FULL_NAME","key":"question1"},{"label":"Email","id":"1257356128605709","type":"EMAIL","key":"question2"},{"label":"Phone number","id":"3856621271258627","type":"PHONE","key":"question3"},{"label":"Do you like rainbows","id":"1236807654233779","type":"CUSTOM","key":"question4"},{"options":[{"value":"Red","key":"key1"},{"value":"Green","key":"key2"},{"value":"Blue","key":"key4"}],"label":"What is your favorite color?","id":"847259840601556","type":"CUSTOM","key":"question5"}],"id":"509803975225108","status":"ACTIVE"}
   */
  async getLeadFormInfo(formId) {
    const fields = [
      'id',
      'name',
      'created_time',
      'status',
      'questions',
      'follow_up_action_url',
      'privacy_policy_url',
      'context_card',
      'thank_you_page',
      'tracking_parameters',
      'locale',
      'question_page_custom_headline',
      'is_optimized_for_quality',
    ].join(',')

    return this.#apiRequest({
      url: `${ API_BASE_GRAPH_URL }/${ formId }`,
      query: { fields },
      logTag: 'getLeadFormInfo',
    })
  }

  /**
   * @route POST /archive-leadgen-form
   *
   * @operationName Archive Lead Form
   * @category Lead Forms
   * @description Archives a Facebook Lead Generation form making it inactive but preserving data
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes pages_read_engagement,ads_management
   *
   * @paramDef {"type":"String","label":"Page Id","name":"pageId","required":true,"description":"The unique identifier for the Facebook Page associated with the lead gen form."}
   * @paramDef {"type":"String","label":"Lead Gen Form Id","name":"leadGenFormId","required":true,"description":"The unique identifier for the lead gen form to be archived."}
   *
   * @returns {Object}
   * @sampleResult {"success": true}
   */
  async archiveLeadGenForm(pageId, leadGenFormId) {
    return this.#apiRequest({
      url: `${ API_BASE_GRAPH_URL }/${ pageId }/${ leadGenFormId }`,
      query: { status: 'ARCHIVED' },
      logTag: 'archiveLeadGenForm',
    })
  }

  /**
   * @route POST /activate-leadgen-form
   *
   * @operationName Activate Lead Form
   * @category Lead Forms
   * @description Activates a Facebook Lead Generation form making it available for lead collection
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes pages_read_engagement,ads_management
   *
   * @paramDef {"type":"String","label":"Page Id","name":"pageId","required":true,"description":"The unique identifier for the Facebook Page associated with the lead gen form."}
   * @paramDef {"type":"String","label":"Lead Gen Form Id","name":"leadGenFormId","required":true,"description":"The unique identifier for the lead gen form to be activated."}
   *
   * @returns {Object}
   * @sampleResult {"success": true}
   */
  async activateLeadGenForm(pageId, leadGenFormId) {
    return this.#apiRequest({
      url: `${ API_BASE_GRAPH_URL }/${ pageId }/${ leadGenFormId }`,
      query: { status: 'ACTIVE' },
      logTag: 'activateLeadGenForm',
    })
  }

  /**
   * @route POST /adcreatives
   *
   * @operationName Create Ad Creative
   * @category Ad Management
   * @description Creates a new Facebook Ad Creative with lead generation form integration and visual elements
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes ads_management
   *
   * @paramDef {"type":"String","label":"Ad Account Id","name":"adAccountId","required":true,"description":"The unique identifier of the ad account where the creative will be created."}
   * @paramDef {"type":"String","label":"Lead Gen Form Id","name":"leadGenFormId","required":true,"description":"The ID of the lead gen form to be associated with the creative."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":true,"description":"The description of the ad creative."}
   * @paramDef {"type":"String","label":"Image Hash","name":"imageHash","required":true,"description":"The hash of the image to be used in the ad creative."}
   * @paramDef {"type":"String","label":"Message","name":"message","required":true,"description":"The message of the ad creative."}
   * @paramDef {"type":"String","label":"Page Id","name":"pageId","required":true,"description":"The ID of the Facebook Page associated with the creative."}
   * @paramDef {"type":"String","label":"Call To Action Type","name":"callToActionType","required":true,"description":"The type of call to action for the ad creative. Must be one of the allowed types."}
   *
   * @returns {Object}
   * @sampleResult {"id": "1234567890"}
   */
  async createAdCreative(adAccountId, leadGenFormId, description, imageHash, message, pageId, callToActionType) {
    const payload = {
      object_story_spec: {
        link_data: {
          call_to_action: {
            type: callToActionType,
            value: {
              lead_gen_form_id: leadGenFormId,
            },
          },
          description: description,
          image_hash: imageHash,
          link: 'https://fb.me/',
          message: message,
        },
        page_id: pageId,
      },
    }

    return this.#apiRequest({
      url: `${ API_BASE_GRAPH_URL }/${ adAccountId }/adcreatives`,
      method: 'POST',
      body: payload,
      logTag: 'createAdCreative',
    })
  }

  /**
   * @route POST /update-adcreative
   *
   * @operationName Update Ad Creative
   * @category Ad Management
   * @description Updates an existing Facebook Ad Creative with new content, labels, or status
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes ads_management
   *
   * @paramDef {"type":"String","label":"Account Id","name":"adAccountId","required":true,"description":"Ad account ID for the account this ad creative belongs to."}
   * @paramDef {"type":"String","label":"Creative Id","name":"creativeId","required":true,"description":"The ID of the ad creative to be updated."}
   * @paramDef {"type":"Array","label":"Ad Labels","name":"adLabels","required":false,"description":"Ad Labels associated with this creative. Used to group it with related ad objects."}
   * @paramDef {"type":"String","label":"Name","name":"creativeName","required":true,"description":"The name of the creative in the creative library. This field takes a string of up to 100 characters."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"description":"The status of this ad creative. Must be one of: ACTIVE, IN_PROCESS, WITH_ISSUES, DELETED."}
   *
   * @returns {Object}
   * @sampleResult {"success": true}
   */
  async updateAdCreative(adAccountId, creativeId, adLabels, creativeName, status) {
    const payload = {
      account_id: adAccountId,
      adlabels: adLabels,
      name: creativeName,
      status: status,
    }

    return this.#apiRequest({
      url: `${ API_BASE_GRAPH_URL }/${ creativeId }`,
      method: 'POST',
      body: payload,
      logTag: 'updateAdCreative',
    })
  }

  /**
   * @route DELETE /delete-adcreative
   *
   * @operationName Delete Ad Creative
   * @category Ad Management
   * @description Deletes a Facebook Ad Creative permanently from the account
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes ads_management
   *
   * @paramDef {"type":"String","label":"Creative Id","name":"creativeId","required":true,"description":"The unique identifier for the Facebook Ad Creative."}
   *
   * @returns {Object}
   * @sampleResult {"success": true}
   */
  async deleteAdCreative(creativeId) {
    return this.#apiRequest({
      url: `${ API_BASE_GRAPH_URL }/${ creativeId }`,
      method: 'DELETE',
      logTag: 'deleteAdCreative',
    })
  }

  /**
   * @route POST /publish-ad
   *
   * @operationName Publish Ad
   * @category Ad Management
   * @description Publishes a Facebook Ad by setting its status to active and making it live
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes ads_management
   *
   * @paramDef {"type":"String","label":"Ad Id","name":"adId","required":true,"description":"The unique identifier for the Facebook Ad that you want to publish."}
   *
   * @returns {Object}
   * @sampleResult {"success": true}
   */
  async publishAd(adId) {
    return this.#apiRequest({
      url: `${ API_BASE_GRAPH_URL }/${ adId }`,
      method: 'POST',
      body: { status: 'ACTIVE' },
      logTag: 'publishAd',
    })
  }

  /**
   * @route GET /leadgen-forms-messenger
   *
   * @operationName Get Messenger Lead Forms
   * @category Lead Forms
   * @description Retrieves Facebook Lead Generation forms eligible for Messenger integration
   *
   * @appearanceColor #0066da #2684fc
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes ads_management
   *
   * @paramDef {"type":"String","label":"Page Id","name":"pageId","required":true,"description":"The unique identifier for the Facebook Page."}
   *
   * @returns {Object}
   * @sampleResult {"data": [{"id": "eligible_form_1_id"},{"id": "eligible_form_2_id"}]}
   */
  async getMessengerLeadGenForms(pageId) {
    const response = await Flowrunner.Request.get(
      `https://graph.facebook.com/v20.0/${ pageId }?fields=access_token`
    )
      .set({ Authorization: `Bearer ${ this.#getAccessToken() }` })
      .send()

    const headers = {
      Authorization: `Bearer ${ response.access_token }`,
      'Content-Type': 'application/json',
    }

    return Flowrunner.Request.get(`${ API_BASE_GRAPH_URL }/${ pageId }/leadgen_forms`).set(headers).query({ fields: 'is_eligible_for_in_thread_forms' })
  }
}

Flowrunner.ServerCode.addService(FacebookLeadAdsService, [
  {
    order: 0,
    displayName: 'App Client ID',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Client ID from your Facebook app settings',
  },
  {
    order: 1,
    displayName: 'App Client Secret',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Client Secret from your Facebook app settings',
  },
])