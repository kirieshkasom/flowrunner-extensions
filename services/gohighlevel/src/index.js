const API_BASE_URL = 'https://services.leadconnectorhq.com'
const OAUTH_AUTH_URL = 'https://marketplace.gohighlevel.com/oauth/chooselocation'
const OAUTH_TOKEN_URL = `${ API_BASE_URL }/oauth/token`
const API_VERSION = '2021-07-28'
// Calendars and Conversations endpoints only accept the older dated version.
const API_VERSION_LEGACY = '2021-04-15'

// Plain-English remediation shown to the user instead of a raw provider error body.
const ERROR_HINTS = {
  400: 'The request was rejected - check the field values and try again.',
  401: 'Authentication failed - reconnect your GoHighLevel account.',
  403: 'Access denied - reconnect your GoHighLevel account, or confirm the app has the required permissions.',
  404: 'Not found - the ID may be wrong; use the matching "Get" or "List" action to pick a valid one.',
  422: 'The request was rejected - check the field values and try again.',
  429: 'Rate limit reached - wait a moment and try again.',
}

const DEFAULT_SCOPES = [
  'contacts.readonly', 'contacts.write',
  'opportunities.readonly', 'opportunities.write',
  'conversations.readonly', 'conversations.write',
  'conversations/message.readonly', 'conversations/message.write',
  'calendars.readonly', 'calendars.write',
  'calendars/events.readonly', 'calendars/events.write',
  'workflows.readonly', 'users.readonly', 'locations.readonly',
  'locations/customFields.readonly',
  'businesses.readonly', 'businesses.write',
  'workflows.write',
  'forms.readonly', 'forms.write',
  'invoices.readonly', 'invoices.write',
  'products.readonly', 'products.write',
  'tags.readonly', 'tags.write',
].join(' ')

// Polling-trigger tuning: overlap windows absorb provider indexing lag, seen-id lists dedupe
// events across cycles, and the page cap bounds how much a single cycle walks (excess pages
// resume on the next cycle via a carried cursor instead of being dropped).
const OPP_POLL_OVERLAP_MS = 15 * 60 * 1000 // 15 min
const OPP_LEARNING_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000 // 30 days, preview-only
const FORM_POLL_LOOKBACK_DAYS = 1 // query-level day buffer (startAt/endAt are date-only)
const FORM_LEARNING_LOOKBACK_DAYS = 7 // preview-only window
const MAX_SEEN_IDS = 5000
const MAX_PAGES_PER_CYCLE = 20 // 20 x limit(100) = 2000 records/cycle cap

// Friendly dropdown labels -> API wire values. The @paramDef DROPDOWNs expose the labels; methods
// resolve them back to the values GoHighLevel expects via #resolveChoice right before the API call.
const OPPORTUNITY_STATUS_MAP = { Open: 'open', Won: 'won', Lost: 'lost', Abandoned: 'abandoned' }
const MESSAGE_TYPE_MAP = {
  SMS: 'SMS', RCS: 'RCS', Email: 'Email', WhatsApp: 'WhatsApp',
  Instagram: 'IG', Facebook: 'FB', 'Live Chat': 'Live_Chat', Custom: 'Custom', TikTok: 'TIKTOK',
}
const APPOINTMENT_STATUS_MAP = {
  New: 'new', Confirmed: 'confirmed', Cancelled: 'cancelled',
  Showed: 'showed', 'No Show': 'noshow', Invalid: 'invalid',
}
const INVOICE_DELIVERY_MAP = {
  Email: 'email', SMS: 'sms', 'SMS and Email': 'sms_and_email', 'Send Manually': 'send_manually',
}
const PRODUCT_TYPE_MAP = {
  Physical: 'PHYSICAL', Digital: 'DIGITAL', Service: 'SERVICE', 'Physical and Digital': 'PHYSICAL/DIGITAL',
}
const BILLING_TYPE_MAP = { 'One Time': 'one_time', Recurring: 'recurring' }
const MODEL_MAP = { Contact: 'contact', Opportunity: 'opportunity', All: 'all' }

const logger = {
  info: (...args) => console.log('[GoHighLevel Service] info:', ...args),
  debug: (...args) => console.log('[GoHighLevel Service] debug:', ...args),
  error: (...args) => console.log('[GoHighLevel Service] error:', ...args),
  warn: (...args) => console.log('[GoHighLevel Service] warn:', ...args),
}

function cleanupObject(obj) {
  if (!obj || typeof obj !== 'object') {
    return obj
  }

  const cleaned = {}

  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null && value !== '') {
      cleaned[key] = value
    }
  }

  return Object.keys(cleaned).length > 0 ? cleaned : undefined
}

// YYYY-MM-DD, matching the forms/submissions endpoint's date-only query params.
function toDateStr(ms) {
  return new Date(ms).toISOString().slice(0, 10)
}

function searchFilter(items, fields, search) {
  if (!search || !items) {
    return items
  }

  const lowerSearch = search.toLowerCase()

  return items.filter(item =>
    fields.some(field => {
      const value = item[field]

      return value && String(value).toLowerCase().includes(lowerSearch)
    })
  )
}

/**
 * @requireOAuth
 * @integrationName GoHighLevel
 * @integrationIcon /icon.png
 * @integrationTriggersScope SINGLE_APP
 */
class GoHighLevelService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
  }

  // Map a friendly dropdown label back to its API wire value; pass through anything unmapped.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #getAccessToken() {
    return this.request.headers['oauth-access-token']
  }

  // GoHighLevel access tokens are JWTs; the location/company they belong to is carried in the
  // claims, so most calls can infer the location instead of asking the user to paste an ID.
  #decodeToken() {
    try {
      const payload = String(this.#getAccessToken()).split('.')[1]

      return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
    } catch (error) {
      return {}
    }
  }

  // Resolve the location ID: an explicit value always wins, otherwise fall back to the token's
  // location claim (a location-scoped token carries it in authClassId).
  #getLocationId(explicit) {
    if (explicit) {
      return explicit
    }

    const claims = this.#decodeToken()

    if (claims.authClass === 'Location' && claims.authClassId) {
      return claims.authClassId
    }

    return claims.locationId || claims.authClassId || null
  }

  // The agency/company the token belongs to - required by the user search endpoint.
  #getCompanyId() {
    const claims = this.#decodeToken()

    return claims.companyId || (claims.authClass === 'Company' ? claims.authClassId : null)
  }

  // Turn a raw provider error into a short, actionable message for the flow builder.
  #friendlyError(error) {
    const status = error?.status || error?.code || error?.body?.statusCode || error?.body?.status
    let apiMsg = error?.body?.message || error?.body?.error || error?.message

    if (Array.isArray(apiMsg)) {
      apiMsg = apiMsg.join('; ')
    }

    const hint = ERROR_HINTS[status]

    if (hint) {
      return new Error(apiMsg ? `${ hint } (${ apiMsg })` : hint)
    }

    return new Error(apiMsg || 'The GoHighLevel request failed. Please try again.')
  }

  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'
    query = cleanupObject(query)

    // Calendars and Conversations require the older API version; everything else uses the current one.
    const version = /\/(calendars|conversations)(\/|$)/.test(url) ? API_VERSION_LEGACY : API_VERSION

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      const request = Flowrunner.Request[method](url)
        .set({
          Authorization: `Bearer ${ this.#getAccessToken() }`,
          'Content-Type': 'application/json',
          Version: version,
        })
        .query(query)

      if (body) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      logger.error(`${ logTag } - API request failed:`, error.message || error)
      throw this.#friendlyError(error)
    }
  }

  // ========================================== OAUTH2 SYSTEM METHODS ==========================================

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   *
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('scope', DEFAULT_SCOPES)
    params.append('response_type', 'code')

    const connectionURL = `${ OAUTH_AUTH_URL }?${ params.toString() }`

    logger.debug(`OAuth2 Connection URL: ${ connectionURL }`)

    return connectionURL
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   * @property {String} token
   * @property {String} refreshToken
   * @property {Number} expirationInSeconds
   * @property {String} connectionIdentityName
   * @property {String} connectionIdentityImageURL
   * @property {Boolean} overwrite
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
    logger.debug('Execute Callback: processing authorization code exchange')

    const params = new URLSearchParams()

    params.append('grant_type', 'authorization_code')
    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('code', callbackObject.code)

    try {
      const tokenResponse = await Flowrunner.Request.post(OAUTH_TOKEN_URL)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      logger.debug(`executeCallback -> tokenResponse: ${ JSON.stringify(tokenResponse) }`)

      let connectionIdentityName = 'GoHighLevel Account'
      let connectionIdentityImageURL

      try {
        const locationInfo = await Flowrunner.Request
          .get(`${ API_BASE_URL }/locations/${ tokenResponse.locationId }`)
          .set({
            Authorization: `Bearer ${ tokenResponse.access_token }`,
            Version: API_VERSION,
          })

        const location = locationInfo.location || locationInfo

        connectionIdentityName = location?.name || connectionIdentityName
        connectionIdentityImageURL = location?.logoUrl || undefined
      } catch (error) {
        logger.warn('Could not fetch location info for connection identity name:', error.message || error)
      }

      return {
        token: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        expirationInSeconds: tokenResponse.expires_in,
        connectionIdentityName,
        connectionIdentityImageURL,
        overwrite: true,
      }
    } catch (error) {
      logger.error(`Failed to execute callback: ${ error.message || error }`)
      throw error
    }
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   * @property {String} token
   * @property {Number} expirationInSeconds
   * @property {String} refreshToken
   */

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   *
   * @param {String} refreshToken
   *
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    logger.debug('Refreshing access token')

    const params = new URLSearchParams()

    params.append('grant_type', 'refresh_token')
    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)
    params.append('refresh_token', refreshToken)

    try {
      const response = await Flowrunner.Request.post(OAUTH_TOKEN_URL)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      return {
        token: response.access_token,
        expirationInSeconds: response.expires_in,
        refreshToken: response.refresh_token,
      }
    } catch (error) {
      logger.error(`Error refreshing token: ${ error.message || error }`)
      throw error
    }
  }

  // ========================================== DICTIONARIES ==========================================

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

  // ----- Contacts Dictionary -----

  /**
   * @typedef {Object} getContactsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter contacts by name or email. Filtering is performed via the GoHighLevel search API."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Contacts
   * @category Contacts
   * @description Retrieves a list of contacts from your GoHighLevel location for use in parameter selection dropdowns.
   *
   * @route POST /get-contacts-dictionary
   *
   * @paramDef {"type":"getContactsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering contacts."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"John Doe (john@example.com)","value":"abc123def456","note":"ID: abc123def456"}],"cursor":null}
   */
  async getContactsDictionary(payload) {
    const { search } = payload || {}

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/contacts/search`,
        method: 'post',
        body: cleanupObject({ locationId: this.#getLocationId(), query: search, pageLimit: 20 }),
        logTag: 'getContactsDictionary',
      })

      const contacts = response.contacts || []

      return {
        items: contacts.map(contact => {
          const firstName = contact.firstName || ''
          const lastName = contact.lastName || ''
          const email = contact.email || ''
          const name = `${ firstName } ${ lastName }`.trim() || '[No Name]'

          return {
            label: email ? `${ name } (${ email })` : name,
            value: contact.id,
            note: `ID: ${ contact.id }`,
          }
        }),
        cursor: null,
      }
    } catch (error) {
      logger.error(`getContactsDictionary - Error: ${ error.message || error }`)

      return { items: [], cursor: null }
    }
  }

  // ----- Users Dictionary -----

  /**
   * @typedef {Object} getUsersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter users by name or email. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Users
   * @category Organization
   * @description Retrieves a list of users from your GoHighLevel account for use in parameter selection dropdowns.
   *
   * @route POST /get-users-dictionary
   *
   * @paramDef {"type":"getUsersDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering users."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Jane Smith (jane@example.com)","value":"usr_abc123","note":"ID: usr_abc123"}],"cursor":null}
   */
  async getUsersDictionary(payload) {
    const { search } = payload || {}

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/users/search`,
        query: cleanupObject({ companyId: this.#getCompanyId(), locationId: this.#getLocationId(), query: search, limit: 100 }),
        logTag: 'getUsersDictionary',
      })

      const users = response.users || []

      return {
        items: users.map(user => {
          const name = user.name || `${ user.firstName || '' } ${ user.lastName || '' }`.trim() || '[No Name]'
          const email = user.email || ''

          return {
            label: email ? `${ name } (${ email })` : name,
            value: user.id,
            note: `ID: ${ user.id }`,
          }
        }),
        cursor: null,
      }
    } catch (error) {
      logger.error(`getUsersDictionary - Error: ${ error.message || error }`)

      return { items: [], cursor: null }
    }
  }

  // ----- Pipelines Dictionary -----

  /**
   * @typedef {Object} getPipelinesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter pipelines by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Pipelines
   * @category Opportunities
   * @description Retrieves a list of opportunity pipelines from your GoHighLevel location for use in parameter selection dropdowns.
   *
   * @route POST /get-pipelines-dictionary
   *
   * @paramDef {"type":"getPipelinesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering pipelines."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Sales Pipeline","value":"pipe_abc123","note":"ID: pipe_abc123"}],"cursor":null}
   */
  async getPipelinesDictionary(payload) {
    const { search } = payload || {}

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/opportunities/pipelines`,
        query: cleanupObject({ locationId: this.#getLocationId() }),
        logTag: 'getPipelinesDictionary',
      })

      let pipelines = response.pipelines || []

      if (search) {
        pipelines = searchFilter(pipelines, ['name', 'id'], search)
      }

      return {
        items: pipelines.map(pipeline => ({
          label: pipeline.name,
          value: pipeline.id,
          note: `ID: ${ pipeline.id }`,
        })),
        cursor: null,
      }
    } catch (error) {
      logger.error(`getPipelinesDictionary - Error: ${ error.message || error }`)

      return { items: [], cursor: null }
    }
  }

  // ----- Pipeline Stages Dictionary (dependent on pipelineId) -----

  /**
   * @typedef {Object} getPipelineStagesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Pipeline ID","name":"pipelineId","required":true,"description":"Unique identifier of the pipeline whose stages will be listed."}
   */

  /**
   * @typedef {Object} getPipelineStagesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter pipeline stages by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   * @paramDef {"type":"getPipelineStagesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameter to identify the pipeline whose stages will be listed."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Pipeline Stages
   * @category Opportunities
   * @description Retrieves the stages of a specific pipeline from your GoHighLevel location. Stages represent the progression steps within a pipeline.
   *
   * @route POST /get-pipeline-stages-dictionary
   *
   * @paramDef {"type":"getPipelineStagesDictionary__payload","label":"Payload","name":"payload","description":"Contains pipeline ID, optional search string, and pagination cursor for retrieving and filtering pipeline stages."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Qualified Lead","value":"stage_abc123","note":"ID: stage_abc123"}],"cursor":null}
   */
  async getPipelineStagesDictionary(payload) {
    const { search, criteria } = payload || {}
    const pipelineId = criteria?.pipelineId

    if (!pipelineId) {
      return { items: [], cursor: null }
    }

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/opportunities/pipelines`,
        query: cleanupObject({ locationId: this.#getLocationId() }),
        logTag: 'getPipelineStagesDictionary',
      })

      const pipelines = response.pipelines || []
      const pipeline = pipelines.find(p => p.id === pipelineId)

      if (!pipeline) {
        return { items: [], cursor: null }
      }

      let stages = pipeline.stages || []

      if (search) {
        stages = searchFilter(stages, ['name', 'id'], search)
      }

      return {
        items: stages.map(stage => ({
          label: stage.name,
          value: stage.id,
          note: `ID: ${ stage.id }`,
        })),
        cursor: null,
      }
    } catch (error) {
      logger.error(`getPipelineStagesDictionary - Error: ${ error.message || error }`)

      return { items: [], cursor: null }
    }
  }

  // ----- Opportunities Dictionary -----

  /**
   * @typedef {Object} getOpportunitiesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter opportunities by name. Filtering is performed via the GoHighLevel search API."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Opportunities
   * @category Opportunities
   * @description Retrieves a list of opportunities from your GoHighLevel location for use in parameter selection dropdowns.
   *
   * @route POST /get-opportunities-dictionary
   *
   * @paramDef {"type":"getOpportunitiesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering opportunities."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Website Redesign ($5000)","value":"opp_abc123","note":"ID: opp_abc123"}],"cursor":null}
   */
  async getOpportunitiesDictionary(payload) {
    const { search } = payload || {}

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/opportunities/search`,
        query: cleanupObject({ location_id: this.#getLocationId(), q: search, limit: 20 }),
        logTag: 'getOpportunitiesDictionary',
      })

      const opportunities = response.opportunities || []

      return {
        items: opportunities.map(opp => {
          const monetaryValue = opp.monetaryValue != null ? ` ($${ opp.monetaryValue })` : ''

          return {
            label: `${ opp.name || '[No Name]' }${ monetaryValue }`,
            value: opp.id,
            note: `ID: ${ opp.id }`,
          }
        }),
        cursor: null,
      }
    } catch (error) {
      logger.error(`getOpportunitiesDictionary - Error: ${ error.message || error }`)

      return { items: [], cursor: null }
    }
  }

  // ----- Calendars Dictionary -----

  /**
   * @typedef {Object} getCalendarsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter calendars by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Calendars
   * @category Calendar
   * @description Retrieves a list of calendars from your GoHighLevel location for use in parameter selection dropdowns.
   *
   * @route POST /get-calendars-dictionary
   *
   * @paramDef {"type":"getCalendarsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering calendars."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Sales Calls","value":"cal_abc123","note":"ID: cal_abc123"}],"cursor":null}
   */
  async getCalendarsDictionary(payload) {
    const { search } = payload || {}

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/calendars/`,
        query: cleanupObject({ locationId: this.#getLocationId() }),
        logTag: 'getCalendarsDictionary',
      })

      let calendars = response.calendars || []

      if (search) {
        calendars = searchFilter(calendars, ['name', 'id'], search)
      }

      return {
        items: calendars.map(calendar => ({
          label: calendar.name,
          value: calendar.id,
          note: `ID: ${ calendar.id }`,
        })),
        cursor: null,
      }
    } catch (error) {
      logger.error(`getCalendarsDictionary - Error: ${ error.message || error }`)

      return { items: [], cursor: null }
    }
  }

  // ----- Conversations Dictionary -----

  /**
   * @typedef {Object} getConversationsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter conversations by contact name or message content. Filtering is performed via the GoHighLevel search API."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Conversations
   * @category Conversations
   * @description Retrieves a list of conversations from your GoHighLevel location for use in parameter selection dropdowns.
   *
   * @route POST /get-conversations-dictionary
   *
   * @paramDef {"type":"getConversationsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering conversations."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"John Doe - Hey, I wanted to follow up...","value":"conv_abc123","note":"ID: conv_abc123"}],"cursor":null}
   */
  async getConversationsDictionary(payload) {
    const { search } = payload || {}

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/conversations/search`,
        query: cleanupObject({ locationId: this.#getLocationId(), query: search }),
        logTag: 'getConversationsDictionary',
      })

      const conversations = response.conversations || []

      return {
        items: conversations.map(conv => {
          const contactName = conv.contactName || conv.fullName || '[Unknown Contact]'
          const lastMessage = conv.lastMessageBody || conv.lastMessagePreview || '[No messages]'
          const truncatedMessage = lastMessage.length > 50 ? lastMessage.substring(0, 50) + '...' : lastMessage

          return {
            label: `${ contactName } - ${ truncatedMessage }`,
            value: conv.id,
            note: `ID: ${ conv.id }`,
          }
        }),
        cursor: null,
      }
    } catch (error) {
      logger.error(`getConversationsDictionary - Error: ${ error.message || error }`)

      return { items: [], cursor: null }
    }
  }

  // ----- Businesses Dictionary -----

  /**
   * @typedef {Object} getBusinessesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter businesses by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Businesses
   * @category Businesses
   * @description Retrieves a list of businesses from your GoHighLevel location for use in parameter selection dropdowns.
   *
   * @route POST /get-businesses-dictionary
   *
   * @paramDef {"type":"getBusinessesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering businesses."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Acme Corp","value":"biz_abc123","note":"ID: biz_abc123"}],"cursor":null}
   */
  async getBusinessesDictionary(payload) {
    const { search } = payload || {}

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/businesses/`,
        query: cleanupObject({ locationId: this.#getLocationId() }),
        logTag: 'getBusinessesDictionary',
      })

      let businesses = response.businesses || []

      if (search) {
        businesses = searchFilter(businesses, ['name', 'id'], search)
      }

      return {
        items: businesses.map(business => ({
          label: business.name,
          value: business.id,
          note: `ID: ${ business.id }`,
        })),
        cursor: null,
      }
    } catch (error) {
      logger.error(`getBusinessesDictionary - Error: ${ error.message || error }`)

      return { items: [], cursor: null }
    }
  }

  // ----- Tags Dictionary -----

  /**
   * @typedef {Object} getTagsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter tags by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tags
   * @category Tags
   * @description Retrieves a list of tags from your GoHighLevel location for use in parameter selection dropdowns.
   *
   * @route POST /get-tags-dictionary
   *
   * @paramDef {"type":"getTagsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering tags."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"VIP","value":"tag_abc123","note":"ID: tag_abc123"}],"cursor":null}
   */
  async getTagsDictionary(payload) {
    const { search } = payload || {}
    const locationId = this.#getLocationId()

    if (!locationId) {
      return { items: [], cursor: null }
    }

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/locations/${ locationId }/tags`,
        logTag: 'getTagsDictionary',
      })

      let tags = response.tags || []

      if (search) {
        tags = searchFilter(tags, ['name', 'id'], search)
      }

      return {
        items: tags.map(tag => ({
          label: tag.name,
          value: tag.id,
          note: `ID: ${ tag.id }`,
        })),
        cursor: null,
      }
    } catch (error) {
      logger.error(`getTagsDictionary - Error: ${ error.message || error }`)

      return { items: [], cursor: null }
    }
  }

  // ----- Workflows Dictionary -----

  /**
   * @typedef {Object} getWorkflowsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter workflows by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Workflows
   * @category Workflows
   * @description Retrieves a list of workflows from your GoHighLevel location for use in parameter selection dropdowns.
   *
   * @route POST /get-workflows-dictionary
   *
   * @paramDef {"type":"getWorkflowsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering workflows."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"New Lead Follow-Up","value":"wf_abc123","note":"ID: wf_abc123"}],"cursor":null}
   */
  async getWorkflowsDictionary(payload) {
    const { search } = payload || {}

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/workflows/`,
        query: cleanupObject({ locationId: this.#getLocationId() }),
        logTag: 'getWorkflowsDictionary',
      })

      let workflows = response.workflows || []

      if (search) {
        workflows = searchFilter(workflows, ['name', 'id'], search)
      }

      return {
        items: workflows.map(workflow => ({
          label: workflow.name,
          value: workflow.id,
          note: `ID: ${ workflow.id }`,
        })),
        cursor: null,
      }
    } catch (error) {
      logger.error(`getWorkflowsDictionary - Error: ${ error.message || error }`)

      return { items: [], cursor: null }
    }
  }

  // ----- Forms Dictionary -----

  /**
   * @typedef {Object} getFormsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter forms by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Forms
   * @category Forms
   * @description Retrieves a list of forms from your GoHighLevel location for use in parameter selection dropdowns.
   *
   * @route POST /get-forms-dictionary
   *
   * @paramDef {"type":"getFormsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering forms."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Contact Us Form","value":"form_abc123","note":"ID: form_abc123"}],"cursor":null}
   */
  async getFormsDictionary(payload) {
    const { search } = payload || {}

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/forms/`,
        query: cleanupObject({ locationId: this.#getLocationId(), limit: 100 }),
        logTag: 'getFormsDictionary',
      })

      let forms = response.forms || []

      if (search) {
        forms = searchFilter(forms, ['name', 'id'], search)
      }

      return {
        items: forms.map(form => ({
          label: form.name,
          value: form.id,
          note: `ID: ${ form.id }`,
        })),
        cursor: null,
      }
    } catch (error) {
      logger.error(`getFormsDictionary - Error: ${ error.message || error }`)

      return { items: [], cursor: null }
    }
  }

  // ----- Invoices Dictionary -----

  /**
   * @typedef {Object} getInvoicesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter invoices by name or invoice number. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Invoices
   * @category Invoices
   * @description Retrieves a list of invoices from your GoHighLevel location for use in parameter selection dropdowns.
   *
   * @route POST /get-invoices-dictionary
   *
   * @paramDef {"type":"getInvoicesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering invoices."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Website Design ($2500)","value":"inv_abc123","note":"ID: inv_abc123"}],"cursor":null}
   */
  async getInvoicesDictionary(payload) {
    const { search } = payload || {}

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/invoices/`,
        query: cleanupObject({ altId: this.#getLocationId(), altType: 'location', limit: 100, offset: 0 }),
        logTag: 'getInvoicesDictionary',
      })

      let invoices = response.invoices || []

      if (search) {
        invoices = searchFilter(invoices, ['name', 'invoiceNumber'], search)
      }

      return {
        items: invoices.map(invoice => ({
          label: `${ invoice.name || invoice.invoiceNumber } ($${ invoice.amount || 0 })`,
          value: invoice.id,
          note: `ID: ${ invoice.id }`,
        })),
        cursor: null,
      }
    } catch (error) {
      logger.error(`getInvoicesDictionary - Error: ${ error.message || error }`)

      return { items: [], cursor: null }
    }
  }

  // ----- Products Dictionary -----

  /**
   * @typedef {Object} getProductsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter products by name. Filtering is performed via the GoHighLevel search API."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Products
   * @category Products
   * @description Retrieves a list of products from your GoHighLevel location for use in parameter selection dropdowns.
   *
   * @route POST /get-products-dictionary
   *
   * @paramDef {"type":"getProductsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering products."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Premium Plan ($99)","value":"prod_abc123","note":"ID: prod_abc123"}],"cursor":null}
   */
  async getProductsDictionary(payload) {
    const { search } = payload || {}

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/products/`,
        query: cleanupObject({ locationId: this.#getLocationId(), search }),
        logTag: 'getProductsDictionary',
      })

      const products = response.products || []

      return {
        items: products.map(product => ({
          label: `${ product.name } ($${ product.price || 0 })`,
          value: product.id,
          note: `ID: ${ product.id }`,
        })),
        cursor: null,
      }
    } catch (error) {
      logger.error(`getProductsDictionary - Error: ${ error.message || error }`)

      return { items: [], cursor: null }
    }
  }

  // ----- Custom Fields Dictionary -----

  /**
   * @typedef {Object} getCustomFieldsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter custom fields by name, field key, or ID. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Custom Fields
   * @category Custom Fields
   * @description Retrieves the contact custom fields defined in your GoHighLevel location for use in parameter selection dropdowns.
   *
   * @route POST /get-custom-fields-dictionary
   *
   * @paramDef {"type":"getCustomFieldsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering custom fields."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"pincode (contact.pincode)","value":"3sv6UEo51C9Bmpo1cKTq","note":"ID: 3sv6UEo51C9Bmpo1cKTq"}],"cursor":null}
   */
  async getCustomFieldsDictionary(payload) {
    const { search } = payload || {}
    const locationId = this.#getLocationId()

    if (!locationId) {
      return { items: [], cursor: null }
    }

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/locations/${ locationId }/customFields`,
        query: cleanupObject({ model: 'contact' }),
        logTag: 'getCustomFieldsDictionary',
      })

      let customFields = response.customFields || []

      if (search) {
        customFields = searchFilter(customFields, ['name', 'fieldKey', 'id'], search)
      }

      return {
        items: customFields.map(field => ({
          label: `${ field.name } (${ field.fieldKey })`,
          value: field.id,
          note: `ID: ${ field.id }`,
        })),
        cursor: null,
      }
    } catch (error) {
      logger.error(`getCustomFieldsDictionary - Error: ${ error.message || error }`)

      return { items: [], cursor: null }
    }
  }

  // ========================================== CUSTOM FIELDS ==========================================

  /**
   * @typedef {Object} GHLCustomField
   * @property {String} id
   * @property {String} name
   * @property {String} fieldKey
   * @property {String} placeholder
   * @property {String} dataType
   * @property {Number} position
   * @property {Array<String>} picklistOptions
   * @property {Array<String>} picklistImageOptions
   * @property {Boolean} isAllowedCustomOption
   * @property {Boolean} isMultiFileAllowed
   * @property {Number} maxFileLimit
   * @property {String} locationId
   * @property {String} model
   */

  /**
   * @typedef {Object} ListCustomFieldsResult
   * @property {Array<GHLCustomField>} customFields
   */

  /**
   * @description Lists the custom fields defined in your GoHighLevel location. Custom fields let you store extra data on contacts or opportunities beyond the standard fields. Use this to find a field's ID and data type before setting its value with Upsert Contact.
   *
   * @route POST /list-custom-fields
   * @operationName List Custom Fields
   * @category Custom Fields
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Model","name":"model","uiComponent":{"type":"DROPDOWN","options":{"values":["Contact","Opportunity","All"]}},"description":"Filter to custom fields for Contacts, Opportunities, or both. Leave blank to retrieve all custom fields for the location."}
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","description":"The GoHighLevel location ID. Usually inferred from your connected account, but can be provided explicitly if needed."}
   *
   * @returns {ListCustomFieldsResult}
   * @sampleResult {"customFields":[{"id":"3sv6UEo51C9Bmpo1cKTq","name":"pincode","fieldKey":"contact.pincode","placeholder":"Pin code","dataType":"TEXT","position":0,"picklistOptions":["first option"],"picklistImageOptions":[],"isAllowedCustomOption":false,"isMultiFileAllowed":false,"maxFileLimit":0,"locationId":"loc_123","model":"contact"}]}
   */
  async listCustomFields(model, locationId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/locations/${ this.#getLocationId(locationId) }/customFields`,
      query: cleanupObject({ model: this.#resolveChoice(model, MODEL_MAP) }),
      logTag: 'listCustomFields',
    })
  }

  // ========================================== CONTACTS ==========================================

  /**
   * @typedef {Object} GHLContact
   * @property {String} id
   * @property {String} locationId
   * @property {String} firstName
   * @property {String} lastName
   * @property {String} email
   * @property {String} phone
   * @property {String} address1
   * @property {String} city
   * @property {String} state
   * @property {String} postalCode
   * @property {String} source
   * @property {Array<String>} tags
   * @property {String} dateAdded
   * @property {String} dateUpdated
   */

  /**
   * @typedef {Object} SearchContactsResult
   * @property {Array<GHLContact>} contacts
   * @property {Number} total
   */

  /**
   * @description Searches for contacts in your GoHighLevel location using a query string. Returns matching contacts with their profile details including name, email, phone, address, and tags.
   *
   * @route POST /search-contacts
   * @operationName Search Contacts
   * @category Contacts
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Search Query","name":"query","description":"Search term to find contacts by name, email, phone, or other fields."}
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","description":"The GoHighLevel location ID. Usually inferred from your connected account, but can be provided explicitly if needed."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of contacts to return per page. Default is 20."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number for paginated results. Default is 1."}
   *
   * @returns {SearchContactsResult}
   * @sampleResult {"contacts":[{"id":"abc123def456","locationId":"loc_123","firstName":"John","lastName":"Doe","email":"john@example.com","phone":"+15551234567","address1":"123 Main St","city":"Austin","state":"TX","postalCode":"78701","source":"website","tags":["lead","vip"],"dateAdded":"2025-01-15T10:30:00.000Z","dateUpdated":"2025-03-20T14:45:00.000Z"}],"total":1}
   */
  async searchContacts(query, locationId, limit, page) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/contacts/search`,
      method: 'post',
      body: cleanupObject({ locationId: this.#getLocationId(locationId), query, pageLimit: limit, page }),
      logTag: 'searchContacts',
    })
  }

  /**
   * @description Retrieves detailed information about a specific contact using their unique GoHighLevel contact ID. Returns complete contact profile data including name, email, phone, address, tags, and custom fields.
   *
   * @route POST /get-contact-by-id
   * @operationName Get Contact By ID
   * @category Contacts
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The unique identifier of the contact to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"contact":{"id":"abc123def456","locationId":"loc_123","firstName":"John","lastName":"Doe","email":"john@example.com","phone":"+15551234567","address1":"123 Main St","city":"Austin","state":"TX","postalCode":"78701","source":"website","tags":["lead","vip"],"dateAdded":"2025-01-15T10:30:00.000Z","dateUpdated":"2025-03-20T14:45:00.000Z","customFields":[{"id":"cf_123","value":"Enterprise"}]}}
   */
  async getContactById(contactId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/contacts/${ contactId }`,
      logTag: 'getContactById',
    })
  }

  /**
   * @description Creates a new contact in your GoHighLevel location with the specified profile details. At minimum, a location ID is required. Additional fields such as name, email, phone, and tags can be provided.
   *
   * @route POST /create-contact
   * @operationName Create Contact
   * @category Contacts
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","description":"The GoHighLevel location ID. Usually inferred from your connected account, but can be provided explicitly if needed."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"The first name of the contact."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"The last name of the contact."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"The email address of the contact."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"The phone number of the contact in E.164 format (e.g., +15551234567)."}
   * @paramDef {"type":"String","label":"Address","name":"address1","description":"The street address of the contact."}
   * @paramDef {"type":"String","label":"City","name":"city","description":"The city of the contact's address."}
   * @paramDef {"type":"String","label":"State","name":"state","description":"The state or province of the contact's address."}
   * @paramDef {"type":"String","label":"Postal Code","name":"postalCode","description":"The postal or ZIP code of the contact's address."}
   * @paramDef {"type":"String","label":"Tags","name":"tags","description":"Comma-separated list of tags to assign to the contact (e.g., lead, vip, newsletter)."}
   * @paramDef {"type":"String","label":"Source","name":"source","description":"The source or origin of the contact (e.g., website, referral, advertisement)."}
   *
   * @returns {Object}
   * @sampleResult {"contact":{"id":"abc123def456","locationId":"loc_123","firstName":"Jane","lastName":"Smith","email":"jane@example.com","phone":"+15559876543","address1":"456 Oak Ave","city":"Austin","state":"TX","postalCode":"78702","source":"website","tags":["lead"],"dateAdded":"2025-03-25T09:00:00.000Z"}}
   */
  async createContact(locationId, firstName, lastName, email, phone, address1, city, state, postalCode, tags, source) {
    const body = cleanupObject({
      locationId: this.#getLocationId(locationId),
      firstName,
      lastName,
      email,
      phone,
      address1,
      city,
      state,
      postalCode,
      tags: tags ? tags.split(',').map(t => t.trim()) : undefined,
      source,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/contacts/`,
      method: 'post',
      body,
      logTag: 'createContact',
    })
  }

  /**
   * @description Updates an existing contact in GoHighLevel with new profile information. Only the fields provided will be updated; all other contact data remains unchanged.
   *
   * @route POST /update-contact
   * @operationName Update Contact
   * @category Contacts
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The unique identifier of the contact to update."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"The updated first name of the contact."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"The updated last name of the contact."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"The updated email address of the contact."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"The updated phone number of the contact in E.164 format."}
   * @paramDef {"type":"String","label":"Address","name":"address1","description":"The updated street address of the contact."}
   * @paramDef {"type":"String","label":"City","name":"city","description":"The updated city of the contact's address."}
   * @paramDef {"type":"String","label":"State","name":"state","description":"The updated state or province of the contact's address."}
   * @paramDef {"type":"String","label":"Postal Code","name":"postalCode","description":"The updated postal or ZIP code of the contact's address."}
   * @paramDef {"type":"String","label":"Tags","name":"tags","description":"Comma-separated list of tags to set on the contact. GoHighLevel may overwrite the contact's existing tags with this list; to add or remove individual tags, use the Add Tags To Contact or Remove Tags From Contact actions instead."}
   * @paramDef {"type":"String","label":"Source","name":"source","description":"The updated source or origin of the contact."}
   *
   * @returns {Object}
   * @sampleResult {"contact":{"id":"abc123def456","locationId":"loc_123","firstName":"Jane","lastName":"Smith-Updated","email":"jane.updated@example.com","phone":"+15559876543","address1":"789 Pine St","city":"Dallas","state":"TX","postalCode":"75201","source":"referral","tags":["lead","vip"],"dateUpdated":"2025-03-25T15:30:00.000Z"}}
   */
  async updateContact(contactId, firstName, lastName, email, phone, address1, city, state, postalCode, tags, source) {
    const body = cleanupObject({
      firstName,
      lastName,
      email,
      phone,
      address1,
      city,
      state,
      postalCode,
      tags: tags ? tags.split(',').map(t => t.trim()) : undefined,
      source,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/contacts/${ contactId }`,
      method: 'put',
      body,
      logTag: 'updateContact',
    })
  }

  /**
   * @typedef {Object} ContactCustomField
   * @property {String} id - The custom field's ID (from "List Custom Fields" / its dictionary). Required.
   * @property {String} field_value - The value to set. For most field types (TEXT, LARGE_TEXT,
   *   SINGLE_OPTIONS, RADIO) this is a plain string. Fields with a different dataType (CHECKBOX,
   *   MULTIPLE_OPTIONS, FILE) accept an array or object instead of a string per the provider's docs -
   *   check the field's dataType (from "List Custom Fields") before setting field_value for those types.
   */

  /**
   * @description Creates a new contact or updates an existing one, matched by email or phone according to your location's Allow Duplicate Contact setting. Use this instead of Create Contact when you are not sure whether the contact already exists.
   *
   * @route POST /upsert-contact
   * @operationName Upsert Contact
   * @category Contacts
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","description":"The GoHighLevel location ID. Usually inferred from your connected account, but can be provided explicitly if needed."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"The first name of the contact."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"The last name of the contact."}
   * @paramDef {"type":"String","label":"Full Name","name":"name","description":"The full name of the contact. If both this and First/Last Name are provided, GoHighLevel treats them independently - prefer setting First Name and Last Name unless you only have a single combined name string."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"The email address used to identify an existing contact for update (per the location's Allow Duplicate Contact setting), or to create a new one."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"The phone number used to identify an existing contact for update (per the location's Allow Duplicate Contact setting), or to create a new one. Use E.164 format (e.g., +15551234567)."}
   * @paramDef {"type":"String","label":"Address","name":"address1","description":"The street address of the contact."}
   * @paramDef {"type":"String","label":"City","name":"city","description":"The city of the contact's address."}
   * @paramDef {"type":"String","label":"State","name":"state","description":"The state or province of the contact's address."}
   * @paramDef {"type":"String","label":"Postal Code","name":"postalCode","description":"The postal or ZIP code of the contact's address."}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"The two-letter country code of the contact's address (e.g. US). See the provider's country list documentation for accepted values."}
   * @paramDef {"type":"String","label":"Website","name":"website","description":"The website URL of the contact."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"The name of the company the contact belongs to."}
   * @paramDef {"type":"String","label":"Timezone","name":"timezone","description":"The IANA timezone of the contact (e.g. America/Chihuahua)."}
   * @paramDef {"type":"String","label":"Gender","name":"gender","description":"The gender of the contact (e.g. male, female)."}
   * @paramDef {"type":"String","label":"Date of Birth","name":"dateOfBirth","uiComponent":{"type":"DATE_PICKER"},"description":"The contact's date of birth. Accepted formats: YYYY/MM/DD, MM/DD/YYYY, YYYY-MM-DD, MM-DD-YYYY, YYYY.MM.DD, MM.DD.YYYY, YYYY_MM_DD, MM_DD_YYYY."}
   * @paramDef {"type":"Boolean","label":"Do Not Disturb","name":"dnd","uiComponent":{"type":"TOGGLE"},"description":"When enabled, marks the contact as globally do-not-disturb across all channels."}
   * @paramDef {"type":"String","label":"Tags","name":"tags","description":"Comma-separated list of tags to set on the contact (e.g., lead, vip, newsletter). This OVERWRITES all of the contact's current tags - to add or remove individual tags without overwriting, use the existing Add Tags To Contact / Remove Tags From Contact actions instead."}
   * @paramDef {"type":"Array<ContactCustomField>","label":"Custom Fields","name":"customFields","description":"Custom field values to set on the contact. Use the \"List Custom Fields\" action (or its dictionary) to find valid custom field IDs for this location."}
   * @paramDef {"type":"String","label":"Source","name":"source","description":"The source or origin of the contact (e.g., website, referral, advertisement, public api)."}
   * @paramDef {"type":"String","label":"Assigned To","name":"assignedTo","dictionary":"getUsersDictionary","description":"The team member this contact is assigned to."}
   * @paramDef {"type":"Boolean","label":"Always Create New (When Duplicates Allowed)","name":"createNewIfDuplicateAllowed","uiComponent":{"type":"TOGGLE"},"description":"When enabled AND the location's \"Allow Duplicate Contact\" setting permits duplicates, creates a new contact immediately without searching for an existing match. When the location does NOT allow duplicates, this is ignored and normal upsert matching applies. Defaults to false (normal upsert-or-create behavior)."}
   *
   * @returns {Object}
   * @sampleResult {"new":true,"contact":{"id":"abc123def456","name":"Jane Smith","locationId":"loc_123","firstName":"Jane","lastName":"Smith","email":"jane@example.com","phone":"+15559876543","address1":"456 Oak Ave","city":"Austin","state":"TX","country":"US","postalCode":"78702","tags":["lead"],"customFields":[{"id":"3sv6UEo51C9Bmpo1cKTq","value":"Enterprise"}],"dateAdded":"2025-03-25T09:00:00.000Z","dateUpdated":"2025-03-25T09:00:00.000Z"},"traceId":"trace_abc123"}
   */
  async upsertContact(locationId, firstName, lastName, name, email, phone, address1, city, state, postalCode, country, website, companyName, timezone, gender, dateOfBirth, dnd, tags, customFields, source, assignedTo, createNewIfDuplicateAllowed) {
    const body = cleanupObject({
      locationId: this.#getLocationId(locationId),
      firstName,
      lastName,
      name,
      email,
      phone,
      address1,
      city,
      state,
      postalCode,
      country,
      website,
      companyName,
      timezone,
      gender,
      dateOfBirth,
      dnd,
      tags: tags ? tags.split(',').map(t => t.trim()) : undefined,
      customFields,
      source,
      assignedTo,
      createNewIfDuplicateAllowed,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/contacts/upsert`,
      method: 'post',
      body,
      logTag: 'upsertContact',
    })
  }

  /**
   * @description Permanently deletes a contact from your GoHighLevel location. This action cannot be undone, and all associated data including conversations and appointments will be removed.
   *
   * @route POST /delete-contact
   * @operationName Delete Contact
   * @category Contacts
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The unique identifier of the contact to delete."}
   *
   * @returns {Object}
   * @sampleResult {"succeeded":true,"message":"Contact deleted successfully"}
   */
  async deleteContact(contactId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/contacts/${ contactId }`,
      method: 'delete',
      logTag: 'deleteContact',
    })
  }

  // ========================================== OPPORTUNITIES ==========================================

  /**
   * @typedef {Object} GHLOpportunity
   * @property {String} id
   * @property {String} name
   * @property {Number} monetaryValue
   * @property {String} pipelineId
   * @property {String} pipelineStageId
   * @property {String} contactId
   * @property {String} status
   * @property {String} locationId
   * @property {String} dateAdded
   * @property {String} dateUpdated
   */

  /**
   * @typedef {Object} SearchOpportunitiesResult
   * @property {Array<GHLOpportunity>} opportunities
   * @property {Number} total
   */

  /**
   * @description Searches for opportunities in your GoHighLevel location with optional filtering by pipeline. Returns matching opportunities with their deal details including name, monetary value, pipeline stage, and status.
   *
   * @route POST /search-opportunities
   * @operationName Search Opportunities
   * @category Opportunities
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Search Query","name":"query","description":"Search term to find opportunities by name or other fields."}
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","description":"The GoHighLevel location ID. Usually inferred from your connected account, but can be provided explicitly if needed."}
   * @paramDef {"type":"String","label":"Pipeline ID","name":"pipelineId","dictionary":"getPipelinesDictionary","description":"Filter opportunities by a specific pipeline."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of opportunities to return per page. Default is 20."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number for paginated results. Default is 1."}
   *
   * @returns {SearchOpportunitiesResult}
   * @sampleResult {"opportunities":[{"id":"opp_abc123","name":"Website Redesign","monetaryValue":5000,"pipelineId":"pipe_abc123","pipelineStageId":"stage_abc123","contactId":"abc123def456","status":"open","locationId":"loc_123","dateAdded":"2025-02-01T10:00:00.000Z","dateUpdated":"2025-03-15T16:20:00.000Z"}],"total":1}
   */
  async searchOpportunities(query, locationId, pipelineId, limit, page) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/opportunities/search`,
      query: cleanupObject({
        location_id: this.#getLocationId(locationId),
        q: query,
        pipeline_id: pipelineId,
        limit,
        page,
      }),
      logTag: 'searchOpportunities',
    })
  }

  /**
   * @description Retrieves detailed information about a specific opportunity using its unique GoHighLevel opportunity ID. Returns complete deal data including pipeline position, monetary value, contact association, and current status.
   *
   * @route POST /get-opportunity-by-id
   * @operationName Get Opportunity By ID
   * @category Opportunities
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Opportunity ID","name":"opportunityId","required":true,"dictionary":"getOpportunitiesDictionary","description":"The unique identifier of the opportunity to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"opportunity":{"id":"opp_abc123","name":"Website Redesign","monetaryValue":5000,"pipelineId":"pipe_abc123","pipelineStageId":"stage_abc123","contactId":"abc123def456","status":"open","locationId":"loc_123","assignedTo":"usr_abc123","dateAdded":"2025-02-01T10:00:00.000Z","dateUpdated":"2025-03-15T16:20:00.000Z"}}
   */
  async getOpportunityById(opportunityId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/opportunities/${ opportunityId }`,
      logTag: 'getOpportunityById',
    })
  }

  /**
   * @description Creates a new opportunity (deal) in your GoHighLevel location within a specified pipeline and stage. Associates the opportunity with a contact and allows setting a monetary value and status.
   *
   * @route POST /create-opportunity
   * @operationName Create Opportunity
   * @category Opportunities
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Pipeline ID","name":"pipelineId","required":true,"dictionary":"getPipelinesDictionary","description":"The pipeline where the opportunity will be created."}
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","description":"The GoHighLevel location ID. Usually inferred from your connected account, but can be provided explicitly if needed."}
   * @paramDef {"type":"String","label":"Pipeline Stage ID","name":"pipelineStageId","required":true,"dictionary":"getPipelineStagesDictionary","dependsOn":["pipelineId"],"description":"The stage within the pipeline where the opportunity will be placed."}
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The contact associated with this opportunity."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name or title of the opportunity."}
   * @paramDef {"type":"Number","label":"Monetary Value","name":"monetaryValue","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The monetary value of the opportunity in the location's currency."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Won","Lost","Abandoned"]}},"description":"The current status of the opportunity. Default is open."}
   *
   * @returns {Object}
   * @sampleResult {"opportunity":{"id":"opp_new123","name":"New Deal","monetaryValue":10000,"pipelineId":"pipe_abc123","pipelineStageId":"stage_abc123","contactId":"abc123def456","status":"open","locationId":"loc_123","dateAdded":"2025-03-25T12:00:00.000Z"}}
   */
  async createOpportunity(pipelineId, locationId, pipelineStageId, contactId, name, monetaryValue, status) {
    const body = cleanupObject({
      pipelineId,
      locationId: this.#getLocationId(locationId),
      pipelineStageId,
      contactId,
      name,
      monetaryValue,
      status: this.#resolveChoice(status, OPPORTUNITY_STATUS_MAP) || 'open',
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/opportunities/`,
      method: 'post',
      body,
      logTag: 'createOpportunity',
    })
  }

  /**
   * @description Updates an existing opportunity in GoHighLevel with new deal information. Only the fields provided will be updated; all other opportunity data remains unchanged.
   *
   * @route POST /update-opportunity
   * @operationName Update Opportunity
   * @category Opportunities
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Opportunity ID","name":"opportunityId","required":true,"dictionary":"getOpportunitiesDictionary","description":"The unique identifier of the opportunity to update."}
   * @paramDef {"type":"String","label":"Pipeline ID","name":"pipelineId","dictionary":"getPipelinesDictionary","description":"Move the opportunity to a different pipeline."}
   * @paramDef {"type":"String","label":"Pipeline Stage ID","name":"pipelineStageId","dictionary":"getPipelineStagesDictionary","dependsOn":["pipelineId"],"description":"Move the opportunity to a different stage within the pipeline."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The updated name or title of the opportunity."}
   * @paramDef {"type":"Number","label":"Monetary Value","name":"monetaryValue","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The updated monetary value of the opportunity."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Won","Lost","Abandoned"]}},"description":"The updated status of the opportunity."}
   *
   * @returns {Object}
   * @sampleResult {"opportunity":{"id":"opp_abc123","name":"Website Redesign - Updated","monetaryValue":7500,"pipelineId":"pipe_abc123","pipelineStageId":"stage_def456","status":"open","dateUpdated":"2025-03-25T18:00:00.000Z"}}
   */
  async updateOpportunity(opportunityId, pipelineId, pipelineStageId, name, monetaryValue, status) {
    const body = cleanupObject({
      pipelineId,
      pipelineStageId,
      name,
      monetaryValue,
      status: this.#resolveChoice(status, OPPORTUNITY_STATUS_MAP),
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/opportunities/${ opportunityId }`,
      method: 'put',
      body,
      logTag: 'updateOpportunity',
    })
  }

  /**
   * @description Updates only the status of an existing opportunity in GoHighLevel. Use this method to quickly mark an opportunity as won, lost, or abandoned without modifying other fields.
   *
   * @route POST /update-opportunity-status
   * @operationName Update Opportunity Status
   * @category Opportunities
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Opportunity ID","name":"opportunityId","required":true,"dictionary":"getOpportunitiesDictionary","description":"The unique identifier of the opportunity whose status will be updated."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Won","Lost","Abandoned"]}},"description":"The new status for the opportunity."}
   *
   * @returns {Object}
   * @sampleResult {"opportunity":{"id":"opp_abc123","status":"won","dateUpdated":"2025-03-25T20:00:00.000Z"}}
   */
  async updateOpportunityStatus(opportunityId, status) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/opportunities/${ opportunityId }/status`,
      method: 'put',
      body: { status: this.#resolveChoice(status, OPPORTUNITY_STATUS_MAP) },
      logTag: 'updateOpportunityStatus',
    })
  }

  /**
   * @description Permanently deletes an opportunity from your GoHighLevel location. This action cannot be undone, and the deal record will be removed from the pipeline.
   *
   * @route POST /delete-opportunity
   * @operationName Delete Opportunity
   * @category Opportunities
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Opportunity ID","name":"opportunityId","required":true,"dictionary":"getOpportunitiesDictionary","description":"The unique identifier of the opportunity to delete."}
   *
   * @returns {Object}
   * @sampleResult {"succeeded":true,"message":"Opportunity deleted successfully"}
   */
  async deleteOpportunity(opportunityId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/opportunities/${ opportunityId }`,
      method: 'delete',
      logTag: 'deleteOpportunity',
    })
  }

  // ========================================== CONVERSATIONS / MESSAGES ==========================================

  /**
   * @typedef {Object} GHLMessage
   * @property {String} id
   * @property {String} conversationId
   * @property {String} contactId
   * @property {String} type
   * @property {String} direction
   * @property {String} body
   * @property {String} status
   * @property {String} dateAdded
   */

  /**
   * @description Sends a message to a contact through the specified communication channel in GoHighLevel. Supports SMS, Email, WhatsApp, and other messaging channels. For Email type, a subject line and optional HTML content can be provided.
   *
   * @route POST /send-message
   * @operationName Send Message
   * @category Conversations
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The unique identifier of the contact to send the message to."}
   * @paramDef {"type":"String","label":"Message Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["SMS","RCS","Email","WhatsApp","Instagram","Facebook","Live Chat","Custom","TikTok"]}},"description":"The communication channel to use for sending the message."}
   * @paramDef {"type":"String","label":"Message","name":"message","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text content of the message to send."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"The subject line for email messages. Required when the message type is Email."}
   * @paramDef {"type":"String","label":"HTML Content","name":"html","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional HTML content for email messages. When provided, this is used as the email body instead of the plain text message."}
   *
   * @returns {Object}
   * @sampleResult {"messageId":"msg_abc123","conversationId":"conv_abc123","contactId":"abc123def456","type":"SMS","message":"Hello! Following up on your inquiry.","dateAdded":"2025-03-25T10:00:00.000Z"}
   */
  async sendMessage(contactId, type, message, subject, html) {
    const body = cleanupObject({
      contactId,
      type: this.#resolveChoice(type, MESSAGE_TYPE_MAP),
      message,
      subject,
      html,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/conversations/messages`,
      method: 'post',
      body,
      logTag: 'sendMessage',
    })
  }

  /**
   * @typedef {Object} GetMessagesResult
   * @property {Array<GHLMessage>} messages
   * @property {String} nextPage
   */

  /**
   * @description Retrieves messages from a specific conversation in GoHighLevel. Returns the message history including sender information, message content, delivery status, and timestamps.
   *
   * @route POST /get-messages
   * @operationName Get Messages
   * @category Conversations
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Conversation ID","name":"conversationId","required":true,"dictionary":"getConversationsDictionary","description":"The unique identifier of the conversation to retrieve messages from."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of messages to return. Default is 20."}
   *
   * @returns {GetMessagesResult}
   * @sampleResult {"messages":[{"id":"msg_abc123","conversationId":"conv_abc123","contactId":"abc123def456","type":"SMS","direction":"outbound","body":"Hello! Following up on your inquiry.","status":"delivered","dateAdded":"2025-03-25T10:00:00.000Z"},{"id":"msg_def456","conversationId":"conv_abc123","contactId":"abc123def456","type":"SMS","direction":"inbound","body":"Thanks for reaching out! I am interested.","status":"received","dateAdded":"2025-03-25T10:05:00.000Z"}],"nextPage":null}
   */
  async getMessages(conversationId, limit) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/conversations/${ conversationId }/messages`,
      query: cleanupObject({ limit }),
      logTag: 'getMessages',
    })
  }

  /**
   * @typedef {Object} GHLConversation
   * @property {String} id
   * @property {String} contactId
   * @property {String} locationId
   * @property {String} lastMessageBody
   * @property {String} lastMessageType
   * @property {String} type
   * @property {Number} unreadCount
   * @property {String} dateAdded
   * @property {String} dateUpdated
   */

  /**
   * @description Retrieves detailed information about a specific conversation using its unique GoHighLevel conversation ID. Returns conversation metadata including associated contact, last message details, and unread status.
   *
   * @route POST /get-conversation-by-id
   * @operationName Get Conversation By ID
   * @category Conversations
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Conversation ID","name":"conversationId","required":true,"dictionary":"getConversationsDictionary","description":"The unique identifier of the conversation to retrieve."}
   *
   * @returns {GHLConversation}
   * @sampleResult {"id":"conv_abc123","contactId":"abc123def456","locationId":"loc_123","lastMessageBody":"Thanks for reaching out!","lastMessageType":"SMS","type":"TYPE_PHONE","unreadCount":0,"dateAdded":"2025-03-20T08:00:00.000Z","dateUpdated":"2025-03-25T10:05:00.000Z"}
   */
  async getConversationById(conversationId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/conversations/${ conversationId }`,
      logTag: 'getConversationById',
    })
  }

  /**
   * @description Permanently deletes a conversation from your GoHighLevel location. This action cannot be undone, and all messages within the conversation will be removed.
   *
   * @route POST /delete-conversation
   * @operationName Delete Conversation
   * @category Conversations
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Conversation ID","name":"conversationId","required":true,"dictionary":"getConversationsDictionary","description":"The unique identifier of the conversation to delete."}
   *
   * @returns {Object}
   * @sampleResult {"succeeded":true,"message":"Conversation deleted successfully"}
   */
  async deleteConversation(conversationId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/conversations/${ conversationId }`,
      method: 'delete',
      logTag: 'deleteConversation',
    })
  }

  // ========================================== CALENDAR ==========================================

  /**
   * @typedef {Object} GHLCalendar
   * @property {String} id
   * @property {String} name
   * @property {String} locationId
   * @property {String} description
   * @property {Boolean} isActive
   */

  /**
   * @typedef {Object} GetCalendarsResult
   * @property {Array<GHLCalendar>} calendars
   */

  /**
   * @description Retrieves all calendars from a specific GoHighLevel location. Returns calendar names, IDs, descriptions, and active status for scheduling and appointment management.
   *
   * @route POST /get-calendars
   * @operationName List Calendars
   * @category Calendar
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","description":"The GoHighLevel location ID. Usually inferred from your connected account, but can be provided explicitly if needed."}
   *
   * @returns {GetCalendarsResult}
   * @sampleResult {"calendars":[{"id":"cal_abc123","name":"Sales Calls","locationId":"loc_123","description":"Calendar for sales team appointments","isActive":true},{"id":"cal_def456","name":"Support Sessions","locationId":"loc_123","description":"Calendar for customer support","isActive":true}]}
   */
  async getCalendars(locationId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/calendars/`,
      query: cleanupObject({ locationId: this.#getLocationId(locationId) }),
      logTag: 'getCalendars',
    })
  }

  /**
   * @description Retrieves the free time slots for a calendar within a date range (maximum 31 days). Returns an availability map keyed by date, with each date listing the open slot start times. Use this before Create Appointment to offer a contact real open times.
   *
   * @route POST /get-calendar-free-slots
   * @operationName Get Calendar Free Slots
   * @category Calendar
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Calendar ID","name":"calendarId","required":true,"dictionary":"getCalendarsDictionary","description":"The calendar to check for free slots."}
   * @paramDef {"type":"Number","label":"Start Date","name":"startDate","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The start of the date range to check, as a Unix timestamp in milliseconds. The range cannot span more than 31 days."}
   * @paramDef {"type":"Number","label":"End Date","name":"endDate","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The end of the date range to check, as a Unix timestamp in milliseconds. The range cannot span more than 31 days."}
   * @paramDef {"type":"String","label":"Timezone","name":"timezone","description":"The IANA timezone the free slots should be returned in (e.g. America/Chihuahua). Defaults to the calendar's own timezone if omitted."}
   * @paramDef {"type":"String","label":"User","name":"userId","dictionary":"getUsersDictionary","description":"Limit free slots to a single specific team member."}
   * @paramDef {"type":"Array<String>","label":"Users","name":"userIds","description":"Limit free slots to multiple specific team members. Use this instead of \"User\" when more than one team member should be checked."}
   *
   * @returns {Object}
   * @sampleResult {"2024-10-28":{"slots":["2024-10-28T10:00:00-05:00","2024-10-28T11:00:00-05:00"]},"2024-10-29":{"slots":["2024-10-29T10:00:00-05:00","2024-10-29T14:30:00-05:00"]}}
   */
  async getCalendarFreeSlots(calendarId, startDate, endDate, timezone, userId, userIds) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/calendars/${ calendarId }/free-slots`,
      query: cleanupObject({ startDate, endDate, timezone, userId, userIds }),
      logTag: 'getCalendarFreeSlots',
    })
  }

  /**
   * @typedef {Object} GHLAppointment
   * @property {String} id
   * @property {String} calendarId
   * @property {String} contactId
   * @property {String} title
   * @property {String} startTime
   * @property {String} endTime
   * @property {String} appointmentStatus
   * @property {String} dateAdded
   * @property {String} dateUpdated
   */

  /**
   * @description Creates a new appointment in a GoHighLevel calendar. Associates the appointment with a contact and allows setting the time range, title, and initial status.
   *
   * @route POST /create-appointment
   * @operationName Create Appointment
   * @category Calendar
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Calendar ID","name":"calendarId","required":true,"dictionary":"getCalendarsDictionary","description":"The calendar where the appointment will be created."}
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The contact associated with this appointment."}
   * @paramDef {"type":"String","label":"Start Time","name":"startTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"The start date and time of the appointment in ISO 8601 format."}
   * @paramDef {"type":"String","label":"End Time","name":"endTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"The end date and time of the appointment in ISO 8601 format."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"The title or subject of the appointment."}
   * @paramDef {"type":"String","label":"Appointment Status","name":"appointmentStatus","uiComponent":{"type":"DROPDOWN","options":{"values":["New","Confirmed","Cancelled","Showed","No Show","Invalid"]}},"description":"The initial status of the appointment. Default is confirmed."}
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","description":"The GoHighLevel location ID. Usually inferred from your connected account, but can be provided explicitly if needed."}
   *
   * @returns {Object}
   * @sampleResult {"id":"apt_abc123","calendarId":"cal_abc123","contactId":"abc123def456","title":"Initial Consultation","startTime":"2025-04-01T10:00:00.000Z","endTime":"2025-04-01T11:00:00.000Z","appointmentStatus":"confirmed","dateAdded":"2025-03-25T14:00:00.000Z"}
   */
  async createAppointment(calendarId, contactId, startTime, endTime, title, appointmentStatus, locationId) {
    const body = cleanupObject({
      calendarId,
      locationId: this.#getLocationId(locationId),
      contactId,
      startTime,
      endTime,
      title,
      appointmentStatus: this.#resolveChoice(appointmentStatus, APPOINTMENT_STATUS_MAP),
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/calendars/events/appointments`,
      method: 'post',
      body,
      logTag: 'createAppointment',
    })
  }

  /**
   * @description Retrieves detailed information about a specific appointment using its unique GoHighLevel appointment ID. Returns appointment details including calendar, contact, time range, title, and current status.
   *
   * @route POST /get-appointment-by-id
   * @operationName Get Appointment By ID
   * @category Calendar
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Appointment ID","name":"appointmentId","required":true,"description":"The unique identifier of the appointment to retrieve."}
   *
   * @returns {GHLAppointment}
   * @sampleResult {"id":"apt_abc123","calendarId":"cal_abc123","contactId":"abc123def456","title":"Initial Consultation","startTime":"2025-04-01T10:00:00.000Z","endTime":"2025-04-01T11:00:00.000Z","appointmentStatus":"confirmed","dateAdded":"2025-03-25T14:00:00.000Z","dateUpdated":"2025-03-25T14:00:00.000Z"}
   */
  async getAppointmentById(appointmentId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/calendars/events/appointments/${ appointmentId }`,
      logTag: 'getAppointmentById',
    })
  }

  /**
   * @description Updates an existing appointment in GoHighLevel with new scheduling or status information. Only the fields provided will be updated; all other appointment data remains unchanged.
   *
   * @route POST /update-appointment
   * @operationName Update Appointment
   * @category Calendar
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Appointment ID","name":"appointmentId","required":true,"description":"The unique identifier of the appointment to update."}
   * @paramDef {"type":"String","label":"Calendar ID","name":"calendarId","dictionary":"getCalendarsDictionary","description":"Move the appointment to a different calendar."}
   * @paramDef {"type":"String","label":"Start Time","name":"startTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"The updated start date and time of the appointment in ISO 8601 format."}
   * @paramDef {"type":"String","label":"End Time","name":"endTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"The updated end date and time of the appointment in ISO 8601 format."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"The updated title or subject of the appointment."}
   * @paramDef {"type":"String","label":"Appointment Status","name":"appointmentStatus","uiComponent":{"type":"DROPDOWN","options":{"values":["New","Confirmed","Cancelled","Showed","No Show","Invalid"]}},"description":"The updated status of the appointment."}
   *
   * @returns {Object}
   * @sampleResult {"id":"apt_abc123","calendarId":"cal_abc123","contactId":"abc123def456","title":"Updated Consultation","startTime":"2025-04-02T14:00:00.000Z","endTime":"2025-04-02T15:00:00.000Z","appointmentStatus":"confirmed","dateUpdated":"2025-03-26T09:00:00.000Z"}
   */
  async updateAppointment(appointmentId, calendarId, startTime, endTime, title, appointmentStatus) {
    const body = cleanupObject({
      calendarId,
      startTime,
      endTime,
      title,
      appointmentStatus: this.#resolveChoice(appointmentStatus, APPOINTMENT_STATUS_MAP),
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/calendars/events/appointments/${ appointmentId }`,
      method: 'put',
      body,
      logTag: 'updateAppointment',
    })
  }

  /**
   * @description Permanently deletes an appointment or blocked time slot from a GoHighLevel calendar. This action cannot be undone.
   *
   * @route POST /delete-appointment
   * @operationName Delete Appointment
   * @category Calendar
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Appointment / Event ID","name":"eventId","required":true,"description":"The unique identifier of the appointment or blocked time slot to delete. For a recurring appointment instance, send the specific instance ID (or the master event ID to affect the whole series)."}
   *
   * @returns {Object}
   * @sampleResult {"succeeded":true}
   */
  async deleteAppointment(eventId) {
    // The provider requires a request body on this DELETE, even though its schema has zero
    // fields - an explicit {} (not cleanupObject, which would collapse it to undefined and skip
    // sending a body).
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/calendars/events/${ eventId }`,
      method: 'delete',
      body: {},
      logTag: 'deleteAppointment',
    })
  }

  // ========================================== BUSINESSES ==========================================

  /**
   * @typedef {Object} GHLBusiness
   * @property {String} id
   * @property {String} name
   * @property {String} email
   * @property {String} phone
   * @property {String} website
   * @property {String} address
   * @property {String} city
   * @property {String} state
   * @property {String} postalCode
   * @property {String} country
   * @property {String} description
   * @property {String} locationId
   * @property {String} dateAdded
   * @property {String} dateUpdated
   */

  /**
   * @description Lists the businesses in your GoHighLevel location. Businesses group contacts under a company or organization. Returns each business with its name, contact details, and address.
   *
   * @route POST /list-businesses
   * @operationName List Businesses
   * @category Businesses
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","description":"The GoHighLevel location ID. Usually inferred from your connected account, but can be provided explicitly if needed."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of businesses to return. Default is 20."}
   *
   * @returns {Object}
   * @sampleResult {"businesses":[{"id":"biz_abc123","name":"Acme Corp","email":"info@example.com","phone":"+15551234567","website":"https://example.com","address":"123 Business Ave","city":"Austin","state":"TX","postalCode":"78701","country":"US","locationId":"loc_123","dateAdded":"2025-01-15T10:30:00.000Z"}]}
   */
  async listBusinesses(locationId, limit) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/businesses/`,
      query: cleanupObject({ locationId: this.#getLocationId(locationId), limit }),
      logTag: 'listBusinesses',
    })
  }

  /**
   * @description Retrieves detailed information about a specific business using its unique GoHighLevel business ID. Returns complete business profile data including name, email, phone, website, and address.
   *
   * @route POST /get-business-by-id
   * @operationName Get Business By ID
   * @category Businesses
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Business ID","name":"businessId","required":true,"dictionary":"getBusinessesDictionary","description":"The unique identifier of the business to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"business":{"id":"biz_abc123","name":"Acme Corp","email":"info@example.com","phone":"+15551234567","website":"https://example.com","address":"123 Business Ave","city":"Austin","state":"TX","postalCode":"78701","country":"US","description":"Enterprise client","locationId":"loc_123","dateAdded":"2025-01-15T10:30:00.000Z","dateUpdated":"2025-03-20T14:45:00.000Z"}}
   */
  async getBusinessById(businessId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/businesses/${ businessId }`,
      logTag: 'getBusinessById',
    })
  }

  /**
   * @description Creates a new business in your GoHighLevel location. A business groups contacts under a company or organization. At minimum, a name is required; address and contact fields are optional.
   *
   * @route POST /create-business
   * @operationName Create Business
   * @category Businesses
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the business."}
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","description":"The GoHighLevel location ID. Usually inferred from your connected account, but can be provided explicitly if needed."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"The email address of the business."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"The phone number of the business."}
   * @paramDef {"type":"String","label":"Website","name":"website","description":"The website URL of the business."}
   * @paramDef {"type":"String","label":"Address","name":"address","description":"The street address of the business."}
   * @paramDef {"type":"String","label":"City","name":"city","description":"The city of the business address."}
   * @paramDef {"type":"String","label":"State","name":"state","description":"The state or province of the business address."}
   * @paramDef {"type":"String","label":"Postal Code","name":"postalCode","description":"The postal or ZIP code of the business address."}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"The country of the business address."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A description of the business."}
   *
   * @returns {Object}
   * @sampleResult {"business":{"id":"biz_new123","name":"New Corp","email":"info@example.com","phone":"+15559876543","website":"https://example.com","address":"456 Corporate Blvd","city":"Dallas","state":"TX","postalCode":"75201","country":"US","locationId":"loc_123","dateAdded":"2025-03-25T09:00:00.000Z"}}
   */
  async createBusiness(name, locationId, email, phone, website, address, city, state, postalCode, country, description) {
    const body = cleanupObject({
      name,
      locationId: this.#getLocationId(locationId),
      email,
      phone,
      website,
      address,
      city,
      state,
      postalCode,
      country,
      description,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/businesses/`,
      method: 'post',
      body,
      logTag: 'createBusiness',
    })
  }

  /**
   * @description Updates an existing business in GoHighLevel with new profile information. Only the fields provided will be updated; all other business data remains unchanged.
   *
   * @route POST /update-business
   * @operationName Update Business
   * @category Businesses
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Business ID","name":"businessId","required":true,"dictionary":"getBusinessesDictionary","description":"The unique identifier of the business to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The updated name of the business."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"The updated email address of the business."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"The updated phone number of the business."}
   * @paramDef {"type":"String","label":"Website","name":"website","description":"The updated website URL of the business."}
   * @paramDef {"type":"String","label":"Address","name":"address","description":"The updated street address of the business."}
   * @paramDef {"type":"String","label":"City","name":"city","description":"The updated city of the business address."}
   * @paramDef {"type":"String","label":"State","name":"state","description":"The updated state or province of the business address."}
   * @paramDef {"type":"String","label":"Postal Code","name":"postalCode","description":"The updated postal or ZIP code of the business address."}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"The updated country of the business address."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The updated description of the business."}
   *
   * @returns {Object}
   * @sampleResult {"business":{"id":"biz_abc123","name":"Acme Corp - Updated","email":"new@example.com","phone":"+15551234567","website":"https://example.com","address":"789 Enterprise Dr","city":"Austin","state":"TX","postalCode":"78702","country":"US","dateUpdated":"2025-03-25T15:30:00.000Z"}}
   */
  async updateBusiness(businessId, name, email, phone, website, address, city, state, postalCode, country, description) {
    const body = cleanupObject({
      name,
      email,
      phone,
      website,
      address,
      city,
      state,
      postalCode,
      country,
      description,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/businesses/${ businessId }`,
      method: 'put',
      body,
      logTag: 'updateBusiness',
    })
  }

  /**
   * @description Permanently deletes a business from your GoHighLevel location. This action cannot be undone, and the business record will be removed.
   *
   * @route POST /delete-business
   * @operationName Delete Business
   * @category Businesses
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Business ID","name":"businessId","required":true,"dictionary":"getBusinessesDictionary","description":"The unique identifier of the business to delete."}
   *
   * @returns {Object}
   * @sampleResult {"succeeded":true,"message":"Business deleted successfully"}
   */
  async deleteBusiness(businessId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/businesses/${ businessId }`,
      method: 'delete',
      logTag: 'deleteBusiness',
    })
  }

  // ========================================== TASKS ==========================================

  /**
   * @typedef {Object} GHLTask
   * @property {String} id
   * @property {String} contactId
   * @property {String} title
   * @property {String} body
   * @property {String} dueDate
   * @property {String} assignedTo
   * @property {Boolean} completed
   * @property {String} dateAdded
   * @property {String} dateUpdated
   */

  /**
   * @description Retrieves a list of tasks associated with a specific contact in GoHighLevel. Returns task details including title, description, due date, assigned user, and current status.
   *
   * @route POST /list-tasks
   * @operationName List Tasks
   * @category Tasks
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The unique identifier of the contact whose tasks will be listed."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tasks to return. Default is 20."}
   *
   * @returns {Object}
   * @sampleResult {"tasks":[{"id":"task_abc123","contactId":"abc123def456","title":"Follow up call","body":"Schedule a demo","dueDate":"2025-04-15T14:00:00.000Z","assignedTo":"usr_abc123","completed":false,"dateAdded":"2025-03-20T08:00:00.000Z"}]}
   */
  async listTasks(contactId, limit) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/contacts/${ contactId }/tasks`,
      query: cleanupObject({ limit }),
      logTag: 'listTasks',
    })
  }

  /**
   * @description Retrieves detailed information about a specific task associated with a contact using its unique task ID. Returns complete task data including title, description, due date, assigned user, and status.
   *
   * @route POST /get-task-by-id
   * @operationName Get Task By ID
   * @category Tasks
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The unique identifier of the contact who owns the task."}
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The unique identifier of the task to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"task":{"id":"task_abc123","contactId":"abc123def456","title":"Follow up call","body":"Schedule a demo","dueDate":"2025-04-15T14:00:00.000Z","assignedTo":"usr_abc123","completed":false,"dateAdded":"2025-03-20T08:00:00.000Z","dateUpdated":"2025-03-20T08:00:00.000Z"}}
   */
  async getTaskById(contactId, taskId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/contacts/${ contactId }/tasks/${ taskId }`,
      logTag: 'getTaskById',
    })
  }

  /**
   * @description Creates a new task for a specific contact in GoHighLevel. Tasks help track follow-ups, to-dos, and action items. A title and due date are required; you can add details, assign a team member, and mark it complete.
   *
   * @route POST /create-task
   * @operationName Create Task
   * @category Tasks
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The unique identifier of the contact to create the task for."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The title or subject of the task."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"The due date and time for the task in ISO 8601 format."}
   * @paramDef {"type":"String","label":"Details","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A detailed description of the task."}
   * @paramDef {"type":"String","label":"Assigned To","name":"assignedTo","dictionary":"getUsersDictionary","description":"The team member assigned to this task."}
   * @paramDef {"type":"Boolean","label":"Completed","name":"completed","uiComponent":{"type":"TOGGLE"},"description":"Whether the task is already completed. Defaults to not completed."}
   *
   * @returns {Object}
   * @sampleResult {"task":{"id":"task_new123","contactId":"abc123def456","title":"Schedule demo call","body":"Discuss premium plan features","dueDate":"2025-04-15T14:00:00.000Z","assignedTo":"usr_abc123","completed":false,"dateAdded":"2025-03-25T09:00:00.000Z"}}
   */
  async createTask(contactId, title, dueDate, description, assignedTo, completed) {
    const body = cleanupObject({
      title,
      dueDate,
      body: description,
      assignedTo,
    })

    body.completed = completed === true

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/contacts/${ contactId }/tasks`,
      method: 'post',
      body,
      logTag: 'createTask',
    })
  }

  /**
   * @description Updates an existing task associated with a contact in GoHighLevel. Only the fields provided will be updated; all other task data remains unchanged.
   *
   * @route POST /update-task
   * @operationName Update Task
   * @category Tasks
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The unique identifier of the contact who owns the task."}
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The unique identifier of the task to update."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"The updated title or subject of the task."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"The updated due date and time for the task in ISO 8601 format."}
   * @paramDef {"type":"String","label":"Details","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The updated description of the task."}
   * @paramDef {"type":"String","label":"Assigned To","name":"assignedTo","dictionary":"getUsersDictionary","description":"The updated team member assigned to this task."}
   * @paramDef {"type":"Boolean","label":"Completed","name":"completed","uiComponent":{"type":"TOGGLE"},"description":"Mark the task as completed or not completed."}
   *
   * @returns {Object}
   * @sampleResult {"task":{"id":"task_abc123","contactId":"abc123def456","title":"Updated follow up call","body":"Discuss pricing changes","dueDate":"2025-04-20T10:00:00.000Z","assignedTo":"usr_abc123","completed":true,"dateUpdated":"2025-03-26T09:00:00.000Z"}}
   */
  async updateTask(contactId, taskId, title, dueDate, description, assignedTo, completed) {
    const body = cleanupObject({
      title,
      dueDate,
      body: description,
      assignedTo,
    }) || {}

    if (completed !== undefined && completed !== null) {
      body.completed = completed === true
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/contacts/${ contactId }/tasks/${ taskId }`,
      method: 'put',
      body,
      logTag: 'updateTask',
    })
  }

  /**
   * @description Permanently deletes a task associated with a contact from your GoHighLevel location. This action cannot be undone.
   *
   * @route POST /delete-task
   * @operationName Delete Task
   * @category Tasks
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The unique identifier of the contact who owns the task."}
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The unique identifier of the task to delete."}
   *
   * @returns {Object}
   * @sampleResult {"succeeded":true,"message":"Task deleted successfully"}
   */
  async deleteTask(contactId, taskId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/contacts/${ contactId }/tasks/${ taskId }`,
      method: 'delete',
      logTag: 'deleteTask',
    })
  }

  // ========================================== NOTES ==========================================

  /**
   * @typedef {Object} GHLNote
   * @property {String} id
   * @property {String} contactId
   * @property {String} body
   * @property {String} dateAdded
   * @property {String} dateUpdated
   */

  /**
   * @description Retrieves a list of notes associated with a specific contact in GoHighLevel. Returns note content and timestamps for tracking interactions and internal comments about the contact.
   *
   * @route POST /list-notes
   * @operationName List Notes
   * @category Notes
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The unique identifier of the contact whose notes will be listed."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of notes to return. Default is 20."}
   *
   * @returns {Object}
   * @sampleResult {"notes":[{"id":"note_abc123","contactId":"abc123def456","body":"Called and discussed pricing options. Interested in premium plan.","dateAdded":"2025-03-20T08:00:00.000Z","dateUpdated":"2025-03-20T08:00:00.000Z"}]}
   */
  async listNotes(contactId, limit) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/contacts/${ contactId }/notes`,
      query: cleanupObject({ limit }),
      logTag: 'listNotes',
    })
  }

  /**
   * @description Retrieves a specific note by its ID for a contact in GoHighLevel. Returns the full note content and metadata.
   *
   * @route POST /get-note-by-id
   * @operationName Get Note By ID
   * @category Notes
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The unique identifier of the contact who owns the note."}
   * @paramDef {"type":"String","label":"Note ID","name":"noteId","required":true,"description":"The unique identifier of the note to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"note":{"id":"note_abc123","contactId":"abc123def456","body":"Called and discussed pricing options. Interested in premium plan.","dateAdded":"2025-03-20T08:00:00.000Z","dateUpdated":"2025-03-20T08:00:00.000Z"}}
   */
  async getNoteById(contactId, noteId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/contacts/${ contactId }/notes/${ noteId }`,
      logTag: 'getNoteById',
    })
  }

  /**
   * @description Creates a new note for a specific contact in GoHighLevel. Notes are used to record interactions, observations, and internal comments about the contact.
   *
   * @route POST /create-note
   * @operationName Create Note
   * @category Notes
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The unique identifier of the contact to add the note to."}
   * @paramDef {"type":"String","label":"Body","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text content of the note."}
   *
   * @returns {Object}
   * @sampleResult {"note":{"id":"note_new123","contactId":"abc123def456","body":"Sent proposal for website redesign project.","dateAdded":"2025-03-25T09:00:00.000Z"}}
   */
  async createNote(contactId, body) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/contacts/${ contactId }/notes`,
      method: 'post',
      body: { body },
      logTag: 'createNote',
    })
  }

  /**
   * @description Updates an existing note for a contact in GoHighLevel. Replaces the note body with the new content provided.
   *
   * @route POST /update-note
   * @operationName Update Note
   * @category Notes
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The unique identifier of the contact who owns the note."}
   * @paramDef {"type":"String","label":"Note ID","name":"noteId","required":true,"description":"The unique identifier of the note to update."}
   * @paramDef {"type":"String","label":"Body","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The updated text content of the note."}
   *
   * @returns {Object}
   * @sampleResult {"note":{"id":"note_abc123","contactId":"abc123def456","body":"Updated: Proposal accepted. Moving forward with implementation.","dateUpdated":"2025-03-26T09:00:00.000Z"}}
   */
  async updateNote(contactId, noteId, body) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/contacts/${ contactId }/notes/${ noteId }`,
      method: 'put',
      body: { body },
      logTag: 'updateNote',
    })
  }

  /**
   * @description Permanently deletes a note associated with a contact from your GoHighLevel location. This action cannot be undone.
   *
   * @route POST /delete-note
   * @operationName Delete Note
   * @category Notes
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The unique identifier of the contact who owns the note."}
   * @paramDef {"type":"String","label":"Note ID","name":"noteId","required":true,"description":"The unique identifier of the note to delete."}
   *
   * @returns {Object}
   * @sampleResult {"succeeded":true,"message":"Note deleted successfully"}
   */
  async deleteNote(contactId, noteId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/contacts/${ contactId }/notes/${ noteId }`,
      method: 'delete',
      logTag: 'deleteNote',
    })
  }

  // ========================================== TAGS ==========================================

  /**
   * @typedef {Object} GHLTag
   * @property {String} id
   * @property {String} name
   * @property {String} locationId
   */

  /**
   * @description Retrieves all tags from a specific GoHighLevel location. Tags are used to categorize and segment contacts for targeted workflows and campaigns.
   *
   * @route POST /list-tags
   * @operationName List Tags
   * @category Tags
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","description":"The GoHighLevel location ID. Usually inferred from your connected account, but can be provided explicitly if needed."}
   *
   * @returns {Object}
   * @sampleResult {"tags":[{"id":"tag_abc123","name":"VIP","locationId":"loc_123"},{"id":"tag_def456","name":"Lead","locationId":"loc_123"}]}
   */
  async listTags(locationId) {
    const resolvedLocationId = this.#getLocationId(locationId)

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/locations/${ resolvedLocationId }/tags`,
      logTag: 'listTags',
    })
  }

  /**
   * @description Creates a new tag in your GoHighLevel location. Tags are used to categorize contacts and trigger workflows based on tag assignments.
   *
   * @route POST /create-tag
   * @operationName Create Tag
   * @category Tags
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the tag to create."}
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","description":"The GoHighLevel location ID. Usually inferred from your connected account, but can be provided explicitly if needed."}
   *
   * @returns {Object}
   * @sampleResult {"tag":{"id":"tag_new123","name":"Newsletter","locationId":"loc_123"}}
   */
  async createTag(name, locationId) {
    const resolvedLocationId = this.#getLocationId(locationId)

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/locations/${ resolvedLocationId }/tags`,
      method: 'post',
      body: { name },
      logTag: 'createTag',
    })
  }

  /**
   * @description Adds one or more tags to a specific contact in GoHighLevel. Tags help categorize contacts for segmentation, automation triggers, and targeted campaigns.
   *
   * @route POST /add-tags-to-contact
   * @operationName Add Tags To Contact
   * @category Tags
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The unique identifier of the contact to add tags to."}
   * @paramDef {"type":"String","label":"Tags","name":"tags","required":true,"description":"Comma-separated list of tag names to add (e.g., VIP, Lead, Newsletter)."}
   *
   * @returns {Object}
   * @sampleResult {"tags":["VIP","Lead","Newsletter"],"contactId":"abc123def456"}
   */
  async addTagsToContact(contactId, tags) {
    const tagArray = tags.split(',').map(t => t.trim()).filter(t => t)

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/contacts/${ contactId }/tags`,
      method: 'post',
      body: { tags: tagArray },
      logTag: 'addTagsToContact',
    })
  }

  /**
   * @description Removes one or more tags from a specific contact in GoHighLevel. This removes the tag association from the contact without deleting the tags themselves.
   *
   * @route POST /remove-tags-from-contact
   * @operationName Remove Tags From Contact
   * @category Tags
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The unique identifier of the contact to remove tags from."}
   * @paramDef {"type":"String","label":"Tags","name":"tags","required":true,"description":"Comma-separated list of tag names to remove (e.g., VIP, Lead, Newsletter)."}
   *
   * @returns {Object}
   * @sampleResult {"tags":["VIP","Lead"],"contactId":"abc123def456"}
   */
  async removeTagsFromContact(contactId, tags) {
    const tagArray = tags.split(',').map(t => t.trim()).filter(t => t)

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/contacts/${ contactId }/tags`,
      method: 'delete',
      body: { tags: tagArray },
      logTag: 'removeTagsFromContact',
    })
  }

  // ========================================== WORKFLOWS ==========================================

  /**
   * @description Triggers a GoHighLevel workflow for a specific contact. The workflow will execute all its configured actions and steps for the specified contact.
   *
   * @route POST /trigger-workflow
   * @operationName Trigger Workflow
   * @category Workflows
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Workflow ID","name":"workflowId","required":true,"dictionary":"getWorkflowsDictionary","description":"The unique identifier of the workflow to trigger."}
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The unique identifier of the contact for whom the workflow will be triggered."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Workflow triggered successfully"}
   */
  async triggerWorkflow(workflowId, contactId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/contacts/${ contactId }/workflow/${ workflowId }`,
      method: 'post',
      logTag: 'triggerWorkflow',
    })
  }

  // ========================================== FORMS ==========================================

  /**
   * @typedef {Object} GHLForm
   * @property {String} id
   * @property {String} name
   * @property {String} locationId
   */

  /**
   * @description Retrieves all forms from a specific GoHighLevel location. Returns form names, IDs, and location associations for managing form-based lead capture and data collection.
   *
   * @route POST /list-forms
   * @operationName List Forms
   * @category Forms
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","description":"The GoHighLevel location ID. Usually inferred from your connected account, but can be provided explicitly if needed."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of forms to return. Default is 20."}
   *
   * @returns {Object}
   * @sampleResult {"forms":[{"id":"form_abc123","name":"Contact Us Form","locationId":"loc_123"},{"id":"form_def456","name":"Free Consultation","locationId":"loc_123"}]}
   */
  async listForms(locationId, limit) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/forms/`,
      query: cleanupObject({ locationId: this.#getLocationId(locationId), limit }),
      logTag: 'listForms',
    })
  }

  /**
   * @description Retrieves form submissions for a specific form in GoHighLevel. Returns submitted data, contact associations, and timestamps. Supports date range filtering and pagination for large result sets.
   *
   * @route POST /get-form-submissions
   * @operationName Get Form Submissions
   * @category Forms
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The unique identifier of the form whose submissions will be retrieved."}
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","description":"The GoHighLevel location ID. Usually inferred from your connected account, but can be provided explicitly if needed."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of submissions to return per page. Default is 20."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number for paginated results. Default is 1."}
   * @paramDef {"type":"String","label":"Start Date","name":"startAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Filter submissions from this date in ISO 8601 format."}
   * @paramDef {"type":"String","label":"End Date","name":"endAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Filter submissions until this date in ISO 8601 format."}
   *
   * @returns {Object}
   * @sampleResult {"submissions":[{"id":"sub_abc123","formId":"form_abc123","contactId":"abc123def456","createdAt":"2025-03-20T08:00:00.000Z","data":{"name":"John Doe","email":"john@example.com","message":"I'd like a consultation"}}],"total":1}
   */
  async getFormSubmissions(formId, locationId, limit, page, startAt, endAt) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/forms/submissions`,
      query: cleanupObject({ formId, locationId: this.#getLocationId(locationId), limit, page, startAt, endAt }),
      logTag: 'getFormSubmissions',
    })
  }

  // ========================================== INVOICES ==========================================

  /**
   * @typedef {Object} GHLInvoice
   * @property {String} id
   * @property {String} name
   * @property {String} invoiceNumber
   * @property {String} contactId
   * @property {Number} amount
   * @property {String} currency
   * @property {String} status
   * @property {String} dueDate
   * @property {String} locationId
   * @property {String} dateAdded
   * @property {String} dateUpdated
   */

  /**
   * @typedef {Object} InvoiceItem
   * @property {String} name - Line item name.
   * @property {Number} amount - Unit price of the line item.
   * @property {Number} qty - Quantity.
   * @property {String} currency - Three-letter ISO currency code, e.g. USD.
   * @property {String} description - Optional line item description.
   */

  /**
   * @description Retrieves a list of invoices from your GoHighLevel location with optional status filtering. Returns invoice details including name, invoice number, amount, currency, and current status.
   *
   * @route POST /list-invoices
   * @operationName List Invoices
   * @category Invoices
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","description":"The GoHighLevel location ID. Usually inferred from your connected account, but can be provided explicitly if needed."}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"Filter invoices by status, for example draft, sent, or paid."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of invoices to return. Default is 20."}
   *
   * @returns {Object}
   * @sampleResult {"invoices":[{"id":"inv_abc123","name":"Website Design","invoiceNumber":"INV-001","contactId":"abc123def456","amount":2500,"currency":"USD","status":"sent","dueDate":"2025-04-15T00:00:00.000Z","locationId":"loc_123","dateAdded":"2025-03-01T10:00:00.000Z"}],"total":1}
   */
  async listInvoices(locationId, status, limit) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/invoices/`,
      query: cleanupObject({ altId: this.#getLocationId(locationId), altType: 'location', status, limit: limit || 20, offset: 0 }),
      logTag: 'listInvoices',
    })
  }

  /**
   * @description Retrieves detailed information about a specific invoice using its unique GoHighLevel invoice ID. Returns complete invoice data including line items, amounts, contact association, and payment status.
   *
   * @route POST /get-invoice-by-id
   * @operationName Get Invoice By ID
   * @category Invoices
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Invoice ID","name":"invoiceId","required":true,"dictionary":"getInvoicesDictionary","description":"The unique identifier of the invoice to retrieve."}
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","description":"The GoHighLevel location ID. Usually inferred from your connected account, but can be provided explicitly if needed."}
   *
   * @returns {Object}
   * @sampleResult {"invoice":{"id":"inv_abc123","name":"Website Design","invoiceNumber":"INV-001","contactId":"abc123def456","amount":2500,"currency":"USD","status":"sent","dueDate":"2025-04-15T00:00:00.000Z","locationId":"loc_123","dateAdded":"2025-03-01T10:00:00.000Z","dateUpdated":"2025-03-15T14:30:00.000Z"}}
   */
  async getInvoiceById(invoiceId, locationId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/invoices/${ invoiceId }`,
      query: cleanupObject({ altId: this.#getLocationId(locationId), altType: 'location' }),
      logTag: 'getInvoiceById',
    })
  }

  /**
   * @description Creates a new invoice in your GoHighLevel location for a specific contact. The contact's name, email and phone are read from the contact record automatically. Provide the invoice name, currency, one or more line items, and the issue date.
   *
   * @route POST /create-invoice
   * @operationName Create Invoice
   * @category Invoices
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The contact the invoice is for."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name or title of the invoice."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","required":true,"description":"Three-letter ISO currency code, e.g. USD."}
   * @paramDef {"type":"Array<InvoiceItem>","label":"Line Items","name":"items","required":true,"description":"The invoice line items. Each item has a name, unit amount, and quantity."}
   * @paramDef {"type":"String","label":"Issue Date","name":"issueDate","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"The date the invoice is issued, in ISO 8601 format."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"The due date for the invoice, in ISO 8601 format."}
   * @paramDef {"type":"String","label":"Business Name","name":"businessName","description":"The name of your business to show on the invoice."}
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","description":"The GoHighLevel location ID. Usually inferred from your connected account, but can be provided explicitly if needed."}
   *
   * @returns {Object}
   * @sampleResult {"invoice":{"id":"inv_new123","name":"Consulting Services","contactDetails":{"id":"abc123def456","name":"Jane Smith","email":"jane@example.com"},"currency":"USD","issueDate":"2025-03-25","dueDate":"2025-04-30","status":"draft","altId":"loc_123","liveMode":true,"dateAdded":"2025-03-25T09:00:00.000Z"}}
   */
  async createInvoice(contactId, name, currency, items, issueDate, dueDate, businessName, locationId) {
    let contact = {}

    try {
      const contactResponse = await this.getContactById(contactId)

      contact = contactResponse.contact || {}
    } catch (error) {
      logger.warn(`createInvoice - could not load contact ${ contactId }: ${ error.message || error }`)
    }

    const contactName = contact.name || `${ contact.firstName || '' } ${ contact.lastName || '' }`.trim()

    const contactDetails = {
      id: contact.id || contactId,
      name: contactName,
      email: contact.email || '',
      phoneNo: contact.phone || '',
    }

    const sentTo = cleanupObject({
      email: contact.email ? [contact.email] : undefined,
      phoneNo: contact.phone ? [contact.phone] : undefined,
    }) || { email: [] }

    const lineItems = (items || []).map(item => cleanupObject({
      name: item.name,
      description: item.description,
      currency: item.currency || currency,
      amount: item.amount,
      qty: item.qty,
    }))

    const body = cleanupObject({
      altId: this.#getLocationId(locationId),
      altType: 'location',
      name,
      currency,
      items: lineItems,
      contactDetails,
      businessDetails: businessName ? { name: businessName } : {},
      discount: { value: 0, type: 'percentage' },
      issueDate,
      dueDate,
      sentTo,
      liveMode: true,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/invoices/`,
      method: 'post',
      body,
      logTag: 'createInvoice',
    })
  }

  /**
   * @description Replaces the core details of an existing invoice in GoHighLevel. The update endpoint requires the full invoice, so provide the name, currency, line items, issue date and due date every time.
   *
   * @route POST /update-invoice
   * @operationName Update Invoice
   * @category Invoices
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Invoice ID","name":"invoiceId","required":true,"dictionary":"getInvoicesDictionary","description":"The unique identifier of the invoice to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name or title of the invoice."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","required":true,"description":"Three-letter ISO currency code, e.g. USD."}
   * @paramDef {"type":"Array<InvoiceItem>","label":"Line Items","name":"items","required":true,"description":"The invoice line items. Each item has a name, unit amount, and quantity."}
   * @paramDef {"type":"String","label":"Issue Date","name":"issueDate","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"The date the invoice is issued, in ISO 8601 format."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"The due date for the invoice, in ISO 8601 format."}
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","description":"The GoHighLevel location ID. Usually inferred from your connected account, but can be provided explicitly if needed."}
   *
   * @returns {Object}
   * @sampleResult {"invoice":{"id":"inv_abc123","name":"Website Design - Updated","currency":"USD","issueDate":"2025-03-25","dueDate":"2025-05-01","status":"sent","dateUpdated":"2025-03-26T09:00:00.000Z"}}
   */
  async updateInvoice(invoiceId, name, currency, items, issueDate, dueDate, locationId) {
    const invoiceItems = (items || []).map(item => cleanupObject({
      name: item.name,
      description: item.description,
      currency: item.currency || currency,
      amount: item.amount,
      qty: item.qty,
    }))

    const body = cleanupObject({
      altId: this.#getLocationId(locationId),
      altType: 'location',
      name,
      currency,
      invoiceItems,
      issueDate,
      dueDate,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/invoices/${ invoiceId }`,
      method: 'put',
      body,
      logTag: 'updateInvoice',
    })
  }

  /**
   * @description Sends an existing GoHighLevel invoice to its contact. Choose how it is delivered - by email, SMS, or both. A sending user is required.
   *
   * @route POST /send-invoice
   * @operationName Send Invoice
   * @category Invoices
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Invoice ID","name":"invoiceId","required":true,"dictionary":"getInvoicesDictionary","description":"The unique identifier of the invoice to send."}
   * @paramDef {"type":"String","label":"Sending User","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The user the invoice is sent on behalf of."}
   * @paramDef {"type":"String","label":"Delivery Method","name":"action","uiComponent":{"type":"DROPDOWN","options":{"values":["Email","SMS","SMS and Email","Send Manually"]}},"description":"How the invoice is delivered. Defaults to Email."}
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","description":"The GoHighLevel location ID. Usually inferred from your connected account, but can be provided explicitly if needed."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"invoice":{"id":"inv_abc123","status":"sent"}}
   */
  async sendInvoice(invoiceId, userId, action, locationId) {
    const body = cleanupObject({
      altId: this.#getLocationId(locationId),
      altType: 'location',
      userId,
      action: this.#resolveChoice(action, INVOICE_DELIVERY_MAP) || 'email',
      liveMode: true,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/invoices/${ invoiceId }/send`,
      method: 'post',
      body,
      logTag: 'sendInvoice',
    })
  }

  // ========================================== PRODUCTS ==========================================

  /**
   * @typedef {Object} GHLProduct
   * @property {String} id
   * @property {String} name
   * @property {String} description
   * @property {String} productType
   * @property {String} locationId
   * @property {String} dateAdded
   * @property {String} dateUpdated
   */

  /**
   * @description Retrieves a list of products from your GoHighLevel location with optional search filtering. Returns product details including name, description, and type.
   *
   * @route POST /list-products
   * @operationName List Products
   * @category Products
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","description":"The GoHighLevel location ID. Usually inferred from your connected account, but can be provided explicitly if needed."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Search products by name."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of products to return. Default is 20."}
   *
   * @returns {Object}
   * @sampleResult {"products":[{"id":"prod_abc123","name":"Premium Plan","description":"Full-featured plan with all add-ons","productType":"SERVICE","locationId":"loc_123","dateAdded":"2025-01-10T08:00:00.000Z"}],"total":1}
   */
  async listProducts(locationId, search, limit) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/products/`,
      query: cleanupObject({ locationId: this.#getLocationId(locationId), search, limit }),
      logTag: 'listProducts',
    })
  }

  /**
   * @description Retrieves detailed information about a specific product using its unique GoHighLevel product ID. Returns complete product data including name, description, type, and timestamps.
   *
   * @route POST /get-product-by-id
   * @operationName Get Product By ID
   * @category Products
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Product ID","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The unique identifier of the product to retrieve."}
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","description":"The GoHighLevel location ID. Usually inferred from your connected account, but can be provided explicitly if needed."}
   *
   * @returns {Object}
   * @sampleResult {"product":{"id":"prod_abc123","name":"Premium Plan","description":"Full-featured plan with all add-ons","productType":"SERVICE","locationId":"loc_123","dateAdded":"2025-01-10T08:00:00.000Z","dateUpdated":"2025-03-15T14:30:00.000Z"}}
   */
  async getProductById(productId, locationId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/products/${ productId }`,
      query: cleanupObject({ locationId: this.#getLocationId(locationId) }),
      logTag: 'getProductById',
    })
  }

  /**
   * @description Creates a new product in your GoHighLevel location. Products can be used in invoices, payment links, and order forms. A name and product type are required. To set pricing, use the Create Product Price action afterwards.
   *
   * @route POST /create-product
   * @operationName Create Product
   * @category Products
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the product."}
   * @paramDef {"type":"String","label":"Product Type","name":"productType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Physical","Digital","Service","Physical and Digital"]}},"description":"The kind of product being sold."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A detailed description of the product."}
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","description":"The GoHighLevel location ID. Usually inferred from your connected account, but can be provided explicitly if needed."}
   *
   * @returns {Object}
   * @sampleResult {"product":{"id":"prod_new123","name":"Basic Plan","description":"Entry-level plan with core features","productType":"SERVICE","locationId":"loc_123","dateAdded":"2025-03-25T09:00:00.000Z"}}
   */
  async createProduct(name, productType, description, locationId) {
    const body = cleanupObject({
      name,
      locationId: this.#getLocationId(locationId),
      productType: this.#resolveChoice(productType, PRODUCT_TYPE_MAP),
      description,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/products/`,
      method: 'post',
      body,
      logTag: 'createProduct',
    })
  }

  /**
   * @description Updates an existing product in GoHighLevel. GoHighLevel requires the name and product type on every update, so provide them both. To change pricing, use the Create Product Price action.
   *
   * @route POST /update-product
   * @operationName Update Product
   * @category Products
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Product ID","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The unique identifier of the product to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the product."}
   * @paramDef {"type":"String","label":"Product Type","name":"productType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Physical","Digital","Service","Physical and Digital"]}},"description":"The kind of product being sold."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The updated description of the product."}
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","description":"The GoHighLevel location ID. Usually inferred from your connected account, but can be provided explicitly if needed."}
   *
   * @returns {Object}
   * @sampleResult {"product":{"id":"prod_abc123","name":"Premium Plan - Updated","description":"Updated plan with new features","productType":"SERVICE","dateUpdated":"2025-03-26T09:00:00.000Z"}}
   */
  async updateProduct(productId, name, productType, description, locationId) {
    const body = cleanupObject({
      name,
      locationId: this.#getLocationId(locationId),
      productType: this.#resolveChoice(productType, PRODUCT_TYPE_MAP),
      description,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/products/${ productId }`,
      method: 'put',
      body,
      logTag: 'updateProduct',
    })
  }

  /**
   * @description Adds a price to a product in GoHighLevel. A product can have one or more prices - a one-time charge or a recurring subscription. Prices are what invoices, payment links, and order forms actually charge.
   *
   * @route POST /create-product-price
   * @operationName Create Product Price
   * @category Products
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Product ID","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product to add the price to."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of this price, for example Monthly or Standard."}
   * @paramDef {"type":"String","label":"Billing Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["One Time","Recurring"]}},"description":"Whether this price is charged once or on a recurring schedule."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","required":true,"description":"Three-letter ISO currency code, e.g. USD."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The price amount in the given currency."}
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","description":"The GoHighLevel location ID. Usually inferred from your connected account, but can be provided explicitly if needed."}
   *
   * @returns {Object}
   * @sampleResult {"_id":"price_new123","name":"Monthly","type":"recurring","currency":"USD","amount":99,"locationId":"loc_123"}
   */
  async createProductPrice(productId, name, type, currency, amount, locationId) {
    const body = cleanupObject({
      name,
      type: this.#resolveChoice(type, BILLING_TYPE_MAP),
      currency,
      amount,
      locationId: this.#getLocationId(locationId),
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/products/${ productId }/price`,
      method: 'post',
      body,
      logTag: 'createProductPrice',
    })
  }

  /**
   * @description Permanently deletes a product from your GoHighLevel location. This action cannot be undone, and the product will no longer be available for invoices or order forms.
   *
   * @route POST /delete-product
   * @operationName Delete Product
   * @category Products
   *
   * @appearanceColor #FF6B35 #FF8C5A
   *
   * @paramDef {"type":"String","label":"Product ID","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The unique identifier of the product to delete."}
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","description":"The GoHighLevel location ID. Usually inferred from your connected account, but can be provided explicitly if needed."}
   *
   * @returns {Object}
   * @sampleResult {"succeeded":true,"message":"Product deleted successfully"}
   */
  async deleteProduct(productId, locationId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/products/${ productId }`,
      method: 'delete',
      query: cleanupObject({ locationId: this.#getLocationId(locationId) }),
      logTag: 'deleteProduct',
    })
  }

  // ========================================== POLLING TRIGGERS ==========================================

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    return this[invocation.eventName](invocation)
  }

  /**
   * @description Polls GoHighLevel for newly created opportunities (checked on your configured polling interval, minimum 30 seconds - not instant). Optionally scoped to a single pipeline.
   *
   * @route POST /on-new-opportunity
   * @operationName On New Opportunity
   * @category Opportunities
   * @registerAs POLLING_TRIGGER
   *
   * @appearanceColor #FF6B35 #FF8C5A
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Pipeline","name":"pipelineId","dictionary":"getPipelinesDictionary","description":"Only trigger for opportunities created in this pipeline. Leave blank to monitor every pipeline in the location."}
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","description":"The GoHighLevel location ID. Usually inferred from your connected account, but can be provided explicitly if needed."}
   *
   * @returns {Object} A newly created opportunity.
   * @sampleResult {"id":"opp_abc123","name":"Website Redesign","monetaryValue":5000,"pipelineId":"pipe_abc123","pipelineStageId":"stage_abc123","assignedTo":"usr_abc123","status":"open","contactId":"abc123def456","locationId":"loc_123","createdAt":"2025-02-01T10:00:00.000Z","updatedAt":"2025-02-01T10:00:00.000Z"}
   */
  async onNewOpportunity(invocation) {
    const { pipelineId, locationId } = invocation.triggerData
    const state = invocation.state || {}
    const baseQuery = cleanupObject({
      location_id: this.#getLocationId(locationId),
      pipeline_id: pipelineId,
      order: 'added_asc',
    })

    // Preview only: not a resumable watermark seed - state stays null so the next real cycle
    // still seeds itself below. "added_desc" is not documented anywhere in the primary spec, so
    // this deliberately does not guess a descending sort - it takes the oldest match within the
    // last 30 days as a representative sample instead.
    if (invocation.learningMode) {
      const sample = await this.#apiRequest({
        url: `${ API_BASE_URL }/opportunities/search`,
        query: { ...baseQuery, startAfter: Date.now() - OPP_LEARNING_LOOKBACK_MS, limit: 1 },
        logTag: 'onNewOpportunity_learning',
      })
      const opp = (sample.opportunities || [])[0]

      return { events: opp ? [opp] : [], state: null }
    }

    // First real cycle: seed the watermark and emit nothing - no backlog replay. No API call
    // needed, since "added_desc" cannot be cited to fetch a true single newest record to seed from.
    if (state.since == null) {
      return { events: [], state: { since: Date.now(), seenIds: [], resumeCursor: null } }
    }

    const now = Date.now()
    let cursorStartAfter = state.resumeCursor ? state.resumeCursor.startAfter : state.since - OPP_POLL_OVERLAP_MS
    let cursorStartAfterId = state.resumeCursor ? state.resumeCursor.startAfterId : undefined
    const collected = []
    let resumeCursor = null

    for (let page = 0; page < MAX_PAGES_PER_CYCLE; page++) {
      const result = await this.#apiRequest({
        url: `${ API_BASE_URL }/opportunities/search`,
        query: { ...baseQuery, startAfter: cursorStartAfter, startAfterId: cursorStartAfterId, limit: 100 },
        logTag: 'onNewOpportunity_poll',
      })
      const batch = result.opportunities || []

      collected.push(...batch)

      if (batch.length < 100) {
        resumeCursor = null // fully drained
        break
      }

      // Carry the cursor forward for the next iteration of this same loop.
      cursorStartAfter = result.meta?.startAfter
      cursorStartAfterId = result.meta?.startAfterId
      // Hit the per-cycle page cap with more pages left - carry the cursor into state so next
      // cycle resumes the drain instead of silently dropping the remainder.
      resumeCursor = { startAfter: cursorStartAfter, startAfterId: cursorStartAfterId }
    }

    const seen = new Set(state.seenIds || [])
    const events = collected.filter(o => !seen.has(o.id)).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    const seenIds = [...collected.map(o => o.id), ...(state.seenIds || [])].slice(0, MAX_SEEN_IDS)
    // Do NOT advance the watermark past an undrained page cap - only advance once fully drained.
    const since = resumeCursor ? state.since : now

    return { events, state: { since, seenIds, resumeCursor } }
  }

  /**
   * @description Polls GoHighLevel for newly submitted forms (checked on your configured polling interval, minimum 30 seconds - not instant). Optionally scoped to a single form.
   *
   * @route POST /on-new-form-submission
   * @operationName On New Form Submission
   * @category Forms
   * @registerAs POLLING_TRIGGER
   *
   * @appearanceColor #FF6B35 #FF8C5A
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Form","name":"formId","dictionary":"getFormsDictionary","description":"Only trigger for submissions to this form. Leave blank to monitor every form in the location."}
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","description":"The GoHighLevel location ID. Usually inferred from your connected account, but can be provided explicitly if needed."}
   *
   * @returns {Object} A newly submitted form entry.
   * @sampleResult {"id":"38303ec7-629a-49e2-888a-cf8bf0b1f97e","contactId":"DWQ45t2IPVxi9LDu1wBl","createdAt":"2021-06-23T06:07:04.000Z","formId":"YSWdvS4Is98wtIDGnpmI","name":"test","email":"test@test.com"}
   */
  async onNewFormSubmission(invocation) {
    const { formId, locationId } = invocation.triggerData
    const state = invocation.state || {}
    const resolvedLocationId = this.#getLocationId(locationId)

    // Preview only: does not touch state.
    if (invocation.learningMode) {
      const sample = await this.#apiRequest({
        url: `${ API_BASE_URL }/forms/submissions`,
        query: cleanupObject({
          locationId: resolvedLocationId,
          formId,
          startAt: toDateStr(Date.now() - FORM_LEARNING_LOOKBACK_DAYS * 86400000),
          endAt: toDateStr(Date.now()),
          limit: 1,
          page: 1,
        }),
        logTag: 'onNewFormSubmission_learning',
      })
      const submission = (sample.submissions || [])[0]

      return { events: submission ? [submission] : [], state: null }
    }

    // First real cycle: seed the watermark and emit nothing - no backlog replay, no API call needed.
    if (state.since == null) {
      return { events: [], state: { since: new Date().toISOString(), seenIds: [], resumePage: null } }
    }

    const now = new Date().toISOString()
    const sinceMs = Date.parse(state.since)
    const startAt = toDateStr(sinceMs - FORM_POLL_LOOKBACK_DAYS * 86400000) // over-fetch by whole days
    const endAt = toDateStr(Date.now())
    const collected = []
    let page = state.resumePage || 1
    let resumePage = null

    for (let i = 0; i < MAX_PAGES_PER_CYCLE; i++) {
      const result = await this.#apiRequest({
        url: `${ API_BASE_URL }/forms/submissions`,
        query: cleanupObject({ locationId: resolvedLocationId, formId, startAt, endAt, page, limit: 100 }),
        logTag: 'onNewFormSubmission_poll',
      })

      collected.push(...(result.submissions || []))

      if (result.meta?.nextPage == null) {
        resumePage = null // fully drained
        break
      }

      page = result.meta.nextPage
      // Hit the per-cycle page cap with pages left - carry the exact page number so next cycle
      // resumes the drain instead of dropping the remainder.
      resumePage = page
    }

    // Fine-grained filter: the query window is day-wide, so filter/sort by the real ISO createdAt,
    // not the date-only query bounds, before applying the overlap watermark.
    const seen = new Set(state.seenIds || [])
    const fresh = collected.filter(s => Date.parse(s.createdAt) > sinceMs && !seen.has(s.id))
    const events = fresh.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    const seenIds = [...collected.map(s => s.id), ...(state.seenIds || [])].slice(0, MAX_SEEN_IDS)
    const since = resumePage ? state.since : now

    return { events, state: { since, seenIds, resumePage } }
  }
}

Flowrunner.ServerCode.addService(GoHighLevelService, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth2 Client ID from your GoHighLevel Marketplace app settings.',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth2 Client Secret from your GoHighLevel Marketplace app settings.',
  },
])
