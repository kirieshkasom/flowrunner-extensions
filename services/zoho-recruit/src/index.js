'use strict'

const {
  DATA_CENTERS,
  ZOHOAPIS_TO_RECRUIT,
  DEFAULT_DATA_CENTER,
  DEFAULT_SCOPE_STRING,
  CORE_MODULES,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  DICTIONARY_PAGE_SIZE,
  POLLING_MAX_PAGES,
  FETCH_ALL_MAX_PAGES,
  REALTIME_TRIGGERS,
  EVENT_TO_TRIGGER,
  WEBHOOK_EXPIRY_MS,
} = require('./constants')

const { logger } = require('./helpers/logger')
const { apiRequest, multipartRequest, fetchBinary } = require('./helpers/http')
const {
  cleanupObject,
  searchFilter,
  toCommaList,
  toArray,
  generateNotificationToken,
  generateChannelId,
  toZohoDateTime,
} = require('./helpers/utils')
const { buildCriteria } = require('./helpers/coql')

// Friendly DROPDOWN labels are what the picker submits; Zoho's API expects its own value. These
// maps translate label -> API value. #resolveChoice passes any value not present in a map through
// unchanged, so custom statuses typed directly (or API values from internal callers) still work.
const JOB_OPENING_STATUS_MAP = {
  'In Progress': 'In-progress',
  'Waiting for Approval': 'Waiting for approval',
  'On Hold': 'On Hold',
  Inactive: 'Inactive',
  Cancelled: 'Cancelled',
  Filled: 'Filled',
}

const INTERVIEW_TYPE_MAP = {
  'In-Person': 'In-person',
  Online: 'Online',
  Phone: 'Phone',
  Group: 'Group',
}

const TASK_STATUS_MAP = {
  'Not Started': 'Not Started',
  'In Progress': 'In Progress',
  Completed: 'Completed',
  'Waiting on Someone Else': 'Waiting on someone else',
  Deferred: 'Deferred',
}

const ATTACHMENT_CATEGORY_MAP = {
  Others: 'Others',
  Resume: 'Resume',
  'Offer Letter': 'Offer_Letter',
  Contract: 'Contract',
  'Cover Letter': 'Cover_Letter',
  'Formatted Resume': 'Formatted_Resume',
  'Performance Review': 'Performance_Review',
}

const SORT_ORDER_MAP = { Ascending: 'asc', Descending: 'desc' }

const LOGICAL_CONNECTOR_MAP = {
  'And (match all clauses)': 'and',
  'Or (match any clause)': 'or',
}

const MAIL_FORMAT_MAP = { HTML: 'html', 'Plain Text': 'plaintext' }

const USER_TYPE_MAP = {
  'All Users': 'AllUsers',
  'Active Users': 'ActiveUsers',
  'Deactivated Users': 'DeactiveUsers',
  'Confirmed Users': 'ConfirmedUsers',
  'Not Confirmed Users': 'NotConfirmedUsers',
  'Deleted Users': 'DeletedUsers',
  'Active Confirmed Users': 'ActiveConfirmedUsers',
  'Admin Users': 'AdminUsers',
  'Active Confirmed Admins': 'ActiveConfirmedAdmins',
  'Current User': 'CurrentUser',
}

// =================================================================================================
// Zoho Recruit Service — FlowRunner Extension
// =================================================================================================
// Two non-obvious facts every reader should know up front:
//
//   1. Auth header is `Authorization: Zoho-oauthtoken {token}`, NOT `Bearer`. Zoho rejects Bearer
//      with a generic 401 that gives no hint at the cause.
//
//   2. Multi-DC. The OAuth callback ships `accounts-server` and `location` query params, and the
//      token response ships `api_domain`. All three identify the user's home region (us/eu/in/...).
//      We persist them in connection userData so refresh + API calls hit the same region the
//      consent was granted in. Refresh falls back to probing all DCs if userData is missing.
//
// COQL and mass_update are intentionally absent — they're Zoho CRM-only endpoints; Recruit's API
// returns 404 for both. Use Search Records / iterated Update Record instead.
// =================================================================================================

/**
 * @requireOAuth
 * @integrationName Zoho Recruit
 * @integrationTriggersScope SINGLE_APP
 * @integrationIcon /icon.png
 **/
class ZohoRecruitService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING

    const dcKey = (config.dataCenter || DEFAULT_DATA_CENTER).toUpperCase()
    const dc = DATA_CENTERS[dcKey] || DATA_CENTERS[DEFAULT_DATA_CENTER]

    this.defaultAccountsServer = dc.accountsServer
    this.defaultApiDomain = dc.apiDomain
    this.defaultModule = config.defaultModule || 'Candidates'
  }

  // ---------------------------- Header / DC Helpers ----------------------------

  // Zoho rejects Bearer; must be Zoho-oauthtoken.
  #getAuthHeader(accessToken) {
    const token = accessToken || this.request.headers['oauth-access-token']

    return { Authorization: `Zoho-oauthtoken ${ token }` }
  }

  // Per-connection userData header (set by the runtime) wins over the configured default DC.
  #getApiDomain() {
    const headerDomain = this.request?.headers?.['oauth-user-data-apidomain']

    return headerDomain || this.defaultApiDomain
  }

  #getAccountsServer() {
    const headerAccounts =
      this.request?.headers?.['oauth-user-data-accountsserver']

    return headerAccounts || this.defaultAccountsServer
  }

  #recruitBase() {
    return `${ this.#getApiDomain() }/recruit/v2`
  }

  async #apiRequest(opts) {
    return apiRequest({
      ...opts,
      authHeader: this.#getAuthHeader(),
    })
  }

  async #multipartRequest(opts) {
    return multipartRequest({
      ...opts,
      authHeader: this.#getAuthHeader(),
    })
  }

  // Recruit's native `word=` search returns 500 INTERNAL_ERROR (Zoho-side bug, verified 2026-05-10).
  // We translate user-supplied free-text into an OR-criteria across the module's primary fields.
  #buildWordCriteria(apiName, word) {
    const moduleDef = CORE_MODULES[apiName]
    const primaryFields = moduleDef?.primaryFields || ['Last_Name', 'Email', 'Phone']
    const clauses = primaryFields.map(f => ({
      field: f, operator: 'starts_with', value: word,
    }))

    return buildCriteria(clauses, { logical: 'or' })
  }

  // Accepts api_name (Candidates/JobOpenings/CustomModule1) OR display label ("Job Openings");
  // unknown values pass through so custom modules just work.
  #resolveModuleApiName(moduleName) {
    if (!moduleName) return this.defaultModule

    const trimmed = String(moduleName).trim()

    if (CORE_MODULES[trimmed]) return trimmed

    for (const [apiName, def] of Object.entries(CORE_MODULES)) {
      if (def.label.toLowerCase() === trimmed.toLowerCase()) return apiName
    }

    return trimmed
  }

  // Map a friendly DROPDOWN label back to the API value Zoho expects. Unknown values (custom
  // statuses typed directly, or API values from internal callers) pass through unchanged.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value)
      ? mapping[value]
      : value
  }

  // ============================================================================================
  // 1. OAUTH2 SYSTEM METHODS
  // ============================================================================================

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
    // Zoho only returns refresh_token on FIRST consent unless prompt=consent forces it.
    params.append('prompt', 'consent')

    return `${ this.defaultAccountsServer }/oauth/v2/auth?${ params.toString() }`
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
    // Multi-DC: Zoho redirects with `accounts-server` + `location`. Use the redirect's
    // accounts-server for token exchange so codes minted in EU are redeemed against EU.
    const accountsServer =
      callbackObject['accounts-server'] ||
      callbackObject.accountsServer ||
      this.defaultAccountsServer

    const location = callbackObject.location || null

    const params = new URLSearchParams()

    params.append('grant_type', 'authorization_code')
    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)
    params.append('code', callbackObject.code)
    params.append('redirect_uri', callbackObject.redirectURI)

    let tokenResponse = {}

    try {
      tokenResponse = await Flowrunner.Request.post(
        `${ accountsServer }/oauth/v2/token`
      )
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      logger.debug('[executeCallback] token exchange ok')
    } catch (error) {
      const zohoMsg = error?.body?.error || error?.message || 'Unknown error'

      logger.error(`[executeCallback] token exchange error: ${ zohoMsg }`)

      throw new Error(`[Zoho Recruit] OAuth token exchange failed: ${ zohoMsg }`)
    }

    if (tokenResponse.error) {
      logger.error(
        `[executeCallback] Zoho returned error: ${ tokenResponse.error }`
      )

      throw new Error(
        `[Zoho Recruit] OAuth token exchange returned error: ${ tokenResponse.error }`
      )
    }

    if (!tokenResponse.access_token) {
      throw new Error(
        '[Zoho Recruit] OAuth token exchange returned no access_token'
      )
    }

    // Zoho often returns the generic gateway (`https://www.zohoapis.com`) as api_domain even for
    // Recruit-issued tokens. Swap to the Recruit-specific subdomain when that happens; otherwise
    // trust whatever Zoho returned.
    const rawApiDomain = tokenResponse.api_domain || this.defaultApiDomain
    const apiDomain = ZOHOAPIS_TO_RECRUIT[rawApiDomain] || rawApiDomain

    let identityName = 'Zoho Recruit Account'
    let identityImage = null
    let userId = null

    try {
      const userResponse = await Flowrunner.Request.get(
        `${ apiDomain }/recruit/v2/users?type=CurrentUser`
      ).set({ Authorization: `Zoho-oauthtoken ${ tokenResponse.access_token }` })

      const user = userResponse?.users?.[0]

      if (user) {
        identityName = user.full_name || user.email || identityName
        identityImage = user.profile_pic || null
        userId = user.id || null
      }
    } catch (error) {
      logger.warn(
        `[executeCallback] failed to fetch CurrentUser: ${ error.message }`
      )
    }

    return {
      token: tokenResponse.access_token,
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token,
      connectionIdentityName: identityName,
      connectionIdentityImageURL: identityImage,
      overwrite: true,
      userData: {
        apiDomain,
        accountsServer,
        location,
        userId,
      },
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
    // Refresh tokens are DC-bound: foreign DCs reject with 400 quickly. So if userData didn't
    // pin the right region, probing every DC sequentially is safe and finds the right one fast.
    const primary = this.#getAccountsServer()
    const order = [
      primary,
      this.defaultAccountsServer,
      ...Object.values(DATA_CENTERS).map(dc => dc.accountsServer),
    ]
    const tried = new Set()

    let lastError

    for (const accountsServer of order) {
      if (tried.has(accountsServer)) continue

      tried.add(accountsServer)

      const params = new URLSearchParams()

      params.append('grant_type', 'refresh_token')
      params.append('client_id', this.clientId)
      params.append('client_secret', this.clientSecret)
      params.append('refresh_token', refreshToken)

      try {
        const response = await Flowrunner.Request.post(
          `${ accountsServer }/oauth/v2/token`
        )
          .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
          .send(params.toString())

        if (!response?.access_token) {
          lastError = new Error(
            `refreshToken: no access_token from ${ accountsServer } (${ response?.error || 'unknown' })`
          )

          continue
        }

        return {
          token: response.access_token,
          expirationInSeconds: response.expires_in,
          // Zoho refresh tokens don't rotate by default — preserve the original.
          refreshToken: response.refresh_token || refreshToken,
        }
      } catch (error) {
        lastError = error

        logger.warn(
          `refreshToken at ${ accountsServer } failed: ${ error.message }`
        )
      }
    }

    logger.error(`refreshToken: exhausted all DCs, last=${ lastError?.message }`)

    throw (
      lastError ||
      new Error('[Zoho Recruit] refreshToken failed across all data centers')
    )
  }

  // ============================================================================================
  // 2. DICTIONARIES
  // ============================================================================================

  /**
   * @typedef {Object} DictionaryItem
   * @property {String} label
   * @property {any} value
   * @property {String} note
   */

  /**
   * @typedef {Object} DictionaryResponse
   * @property {Array<DictionaryItem>} items
   * @property {String} [cursor]
   */

  // ---------------------------- Modules Dictionary ----------------------------

  /**
   * @typedef {Object} listModulesDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring filter on module API name or display label."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (modules endpoint returns the full list, so cursor is unused)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Modules
   * @description Backs the Module dropdown shown on universal record actions (Get/List/Create/Update/Delete/Search Record). Returns built-in modules (Candidates, Job Openings, Applications, etc.) and any custom modules your org has added.
   *
   * @route POST /list-modules-dictionary
   *
   * @paramDef {"type":"listModulesDict__payload","label":"Payload","name":"payload","description":"Contains an optional search string and pagination cursor."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"Candidates","note":"api_name: Candidates","value":"Candidates"}]}
   * @returns {DictionaryResponse}
   */
  async listModulesDict(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'listModulesDict',
      url: `${ this.#recruitBase() }/settings/modules`,
    })

    let modules = (response?.modules || []).filter(
      m => m.api_supported !== false
    )

    if (search) {
      modules = searchFilter(
        modules,
        ['api_name', 'plural_label', 'singular_label'],
        search
      )
    }

    return {
      cursor: null,
      items: modules.map(m => ({
        label: m.plural_label || m.api_name,
        note: `api_name: ${ m.api_name }${ m.module_name && m.module_name !== m.api_name ? ` (${ m.module_name })` : '' }`,
        value: m.api_name,
      })),
    }
  }

  // ---------------------------- Users Dictionary ----------------------------

  /**
   * @typedef {Object} listUsersDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring filter on user name or email. Filtering is local on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor — the page number of users to fetch next."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Users
   * @description Backs Owner / Interviewer / From-Email picker dropdowns. Returns active recruiter accounts (excludes deactivated users), with the user's full name as the label and email as the note.
   *
   * @route POST /list-users-dictionary
   *
   * @paramDef {"type":"listUsersDict__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"Jane Recruiter","note":"jane@acme.com","value":"4150868000000341001"}]}
   * @returns {DictionaryResponse}
   */
  async listUsersDict(payload) {
    const { search, cursor } = payload || {}
    const page = cursor ? parseInt(cursor, 10) : 1

    const response = await this.#apiRequest({
      logTag: 'listUsersDict',
      url: `${ this.#recruitBase() }/users`,
      query: { type: 'ActiveUsers', page, per_page: DICTIONARY_PAGE_SIZE },
    })

    let users = response?.users || []
    const hasMore = response?.info?.more_records === true

    if (search) {
      users = searchFilter(users, ['full_name', 'email'], search)
    }

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: users.map(u => ({
        label: u.full_name || u.email || `User ${ u.id }`,
        note: u.email || u.role?.name || '',
        value: u.id,
      })),
    }
  }

  // ---------------------------- Candidates Dictionary ----------------------------

  /**
   * @typedef {Object} listCandidatesDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring filter on candidate name or email. Routed to Zoho via the search criteria when provided."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor — the next page number to fetch."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Candidate Picker
   * @description Backs candidate-picker dropdowns on actions like Get Candidate, Schedule Interview, or Associate Candidate To Job Opening. Typing in the picker matches against Last Name / First Name / Email / Phone (starts-with).
   *
   * @route POST /list-candidates-dictionary
   *
   * @paramDef {"type":"listCandidatesDict__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor."}
   *
   * @sampleResult {"cursor":"2","items":[{"label":"Jane Smith","note":"jane.smith@acme.com","value":"4150868000000567001"}]}
   * @returns {DictionaryResponse}
   */
  async listCandidatesDict(payload) {
    const { search, cursor } = payload || {}
    const page = cursor ? parseInt(cursor, 10) : 1

    let response

    try {
      if (search) {
        response = await this.#apiRequest({
          logTag: 'listCandidatesDict.search',
          url: `${ this.#recruitBase() }/Candidates/search`,
          query: {
            page, per_page: DICTIONARY_PAGE_SIZE,
            criteria: this.#buildWordCriteria('Candidates', search),
          },
        })
      } else {
        response = await this.#apiRequest({
          logTag: 'listCandidatesDict',
          url: `${ this.#recruitBase() }/Candidates`,
          query: {
            page, per_page: DICTIONARY_PAGE_SIZE,
            sort_by: 'Modified_Time', sort_order: 'desc',
          },
        })
      }
    } catch (error) {
      if (error.message && /204/.test(error.message)) {
        return { cursor: null, items: [] }
      }

      throw error
    }

    const candidates = response?.data || []
    const hasMore = response?.info?.more_records === true

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: candidates.map(c => ({
        label:
          [c.First_Name, c.Last_Name].filter(Boolean).join(' ') ||
          c.Full_Name ||
          `Candidate ${ c.id }`,
        note: c.Email || c.Phone || `id: ${ c.id }`,
        value: c.id,
      })),
    }
  }

  // ---------------------------- Job Openings Dictionary ----------------------------

  /**
   * @typedef {Object} listJobOpeningsDict__payloadCriteria
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["In Progress","Waiting for Approval","On Hold","Inactive","Cancelled","Filled"]}},"description":"Optional status filter. Only Job Openings matching this status are returned."}
   */

  /**
   * @typedef {Object} listJobOpeningsDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring filter on Posting Title (server-side word search)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor — the next page number to fetch."}
   * @paramDef {"type":"listJobOpeningsDict__payloadCriteria","label":"Criteria","name":"criteria","description":"Optional status filter."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Job Opening Picker
   * @description Backs Job Opening picker dropdowns on actions like Associate Candidate To Job Opening, Schedule Interview, and List Applications. Optional Status filter narrows the list to currently-active requisitions.
   *
   * @route POST /list-job-openings-dictionary
   *
   * @paramDef {"type":"listJobOpeningsDict__payload","label":"Payload","name":"payload","description":"Contains optional search string, status filter, and pagination cursor."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"Senior Backend Engineer","note":"In-progress","value":"4150868000000789001"}]}
   * @returns {DictionaryResponse}
   */
  async listJobOpeningsDict(payload) {
    const { search, cursor, criteria } = payload || {}
    const status = this.#resolveChoice(criteria?.status, JOB_OPENING_STATUS_MAP)
    const page = cursor ? parseInt(cursor, 10) : 1

    const useSearch = Boolean(search || status)
    let url = `${ this.#recruitBase() }/JobOpenings`
    const query = {
      page, per_page: DICTIONARY_PAGE_SIZE,
      sort_by: 'Modified_Time', sort_order: 'desc',
    }

    if (useSearch) {
      url = `${ this.#recruitBase() }/JobOpenings/search`
      const clauses = []

      if (status) clauses.push({ field: 'Job_Opening_Status', operator: 'equals', value: status })

      if (search) {
        // Translate free-text search into Posting_Title starts_with — Recruit's `word` query
        // returns 500. Status + search combined: AND.
        clauses.push({ field: 'Posting_Title', operator: 'starts_with', value: search })
      }

      query.criteria = buildCriteria(clauses)
    }

    let response

    try {
      response = await this.#apiRequest({
        logTag: 'listJobOpeningsDict',
        url,
        query: cleanupObject(query),
      })
    } catch (error) {
      if (error.message && /204/.test(error.message)) {
        return { cursor: null, items: [] }
      }

      throw error
    }

    const jobs = response?.data || []
    const hasMore = response?.info?.more_records === true

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: jobs.map(j => ({
        label: j.Posting_Title || j.Job_Opening_Name || `Job ${ j.id }`,
        note: j.Job_Opening_Status || j.Client_Name?.name || '',
        value: j.id,
      })),
    }
  }

  // ---------------------------- Applications Dictionary ----------------------------

  /**
   * @typedef {Object} listApplicationsDict__payloadCriteria
   * @paramDef {"type":"String","label":"Job Opening","name":"jobOpeningId","dictionary":"listJobOpeningsDict","description":"Optional Job Opening filter — only applications for this job are returned."}
   */

  /**
   * @typedef {Object} listApplicationsDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring filter on application name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor — the next page number to fetch."}
   * @paramDef {"type":"listApplicationsDict__payloadCriteria","label":"Criteria","name":"criteria","description":"Optional Job Opening filter."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Application Picker
   * @description Backs Application picker dropdowns on actions like Change Application Status and Update Application. An Application is the record that links a specific candidate to a specific job and tracks their pipeline stage. Optional Job Opening filter narrows the list to one role's applicants.
   *
   * @route POST /list-applications-dictionary
   *
   * @paramDef {"type":"listApplicationsDict__payload","label":"Payload","name":"payload","description":"Contains optional search string, Job Opening filter, and pagination cursor."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"Jane Smith → Senior Backend Engineer","note":"In-process","value":"4150868000000812001"}]}
   * @returns {DictionaryResponse}
   */
  async listApplicationsDict(payload) {
    const { search, cursor, criteria } = payload || {}
    const jobOpeningId = criteria?.jobOpeningId
    const page = cursor ? parseInt(cursor, 10) : 1

    let url = `${ this.#recruitBase() }/Applications`
    const query = {
      page, per_page: DICTIONARY_PAGE_SIZE,
      sort_by: 'Modified_Time', sort_order: 'desc',
    }

    if (search || jobOpeningId) {
      url = `${ this.#recruitBase() }/Applications/search`
      const clauses = []

      if (jobOpeningId) clauses.push({ field: 'Job_Opening_Id', operator: 'equals', value: jobOpeningId })
      if (search) clauses.push({ field: 'Name', operator: 'starts_with', value: search })

      query.criteria = buildCriteria(clauses)
    }

    let response

    try {
      response = await this.#apiRequest({
        logTag: 'listApplicationsDict',
        url,
        query: cleanupObject(query),
      })
    } catch (error) {
      if (error.message && /204/.test(error.message)) {
        return { cursor: null, items: [] }
      }

      throw error
    }

    const apps = response?.data || []
    const hasMore = response?.info?.more_records === true

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: apps.map(a => ({
        label:
          a.Name ||
          `${ a.Candidate_Id?.name || 'Candidate' } → ${ a.Job_Opening_Id?.name || 'Job' }`,
        note: a.Status || '',
        value: a.id,
      })),
    }
  }

  // ---------------------------- Interviews Dictionary ----------------------------

  /**
   * @typedef {Object} listInterviewsDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring filter on interview name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor — the next page number to fetch."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Interview Picker
   * @description Backs Interview picker dropdowns on actions like Update Interview and Cancel Interview. Includes both upcoming and historical interviews, sorted newest first.
   *
   * @route POST /list-interviews-dictionary
   *
   * @paramDef {"type":"listInterviewsDict__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"Jane Smith — System Design","note":"2026-05-12T10:00:00-04:00","value":"4150868000000900001"}]}
   * @returns {DictionaryResponse}
   */
  async listInterviewsDict(payload) {
    const { search, cursor } = payload || {}
    const page = cursor ? parseInt(cursor, 10) : 1

    let response

    try {
      if (search) {
        response = await this.#apiRequest({
          logTag: 'listInterviewsDict.search',
          url: `${ this.#recruitBase() }/Interviews/search`,
          query: {
            page, per_page: DICTIONARY_PAGE_SIZE,
            criteria: buildCriteria([
              { field: 'Interview_Name', operator: 'starts_with', value: search },
            ]),
          },
        })
      } else {
        response = await this.#apiRequest({
          logTag: 'listInterviewsDict',
          url: `${ this.#recruitBase() }/Interviews`,
          query: {
            page, per_page: DICTIONARY_PAGE_SIZE,
            sort_by: 'Modified_Time', sort_order: 'desc',
          },
        })
      }
    } catch (error) {
      if (error.message && /204/.test(error.message)) {
        return { cursor: null, items: [] }
      }

      throw error
    }

    const interviews = response?.data || []
    const hasMore = response?.info?.more_records === true

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: interviews.map(i => ({
        label: i.Interview_Name || `Interview ${ i.id }`,
        note: i.Start_DateTime || i.Interview_DateTime || '',
        value: i.id,
      })),
    }
  }

  // ---------------------------- Layouts Dictionary ----------------------------

  /**
   * @typedef {Object} listLayoutsDict__payloadCriteria
   * @paramDef {"type":"String","label":"Module","name":"moduleName","required":true,"dictionary":"listModulesDict","description":"The module whose layouts will be listed."}
   */

  /**
   * @typedef {Object} listLayoutsDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring filter on layout name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (layouts endpoint returns the full list)."}
   * @paramDef {"type":"listLayoutsDict__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required module name."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Layouts
   * @description Backs the Layout dropdown on Create Record. Layouts are page-layout variants your Zoho admin defined per module (e.g. one Candidate layout for Engineering, another for Sales) — picking one assigns the new record to that layout's set of fields and validations.
   *
   * @route POST /list-layouts-dictionary
   *
   * @paramDef {"type":"listLayoutsDict__payload","label":"Payload","name":"payload","description":"Contains module name, optional search, and pagination cursor."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"Standard","note":"id: 4150868000000091001","value":"4150868000000091001"}]}
   * @returns {DictionaryResponse}
   */
  async listLayoutsDict(payload) {
    const { search, criteria } = payload || {}
    const moduleName = this.#resolveModuleApiName(criteria?.moduleName)

    const response = await this.#apiRequest({
      logTag: 'listLayoutsDict',
      url: `${ this.#recruitBase() }/settings/layouts`,
      query: { module: moduleName },
    })

    let layouts = response?.layouts || []

    if (search) {
      layouts = searchFilter(layouts, ['name'], search)
    }

    return {
      cursor: null,
      items: layouts.map(l => ({
        label: l.name || `Layout ${ l.id }`,
        note: `id: ${ l.id }`,
        value: l.id,
      })),
    }
  }

  // ---------------------------- Custom Views Dictionary ----------------------------

  /**
   * @typedef {Object} listCustomViewsDict__payloadCriteria
   * @paramDef {"type":"String","label":"Module","name":"moduleName","required":true,"dictionary":"listModulesDict","description":"The module whose custom views will be listed."}
   */

  /**
   * @typedef {Object} listCustomViewsDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring filter on view name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (custom views endpoint returns the full list)."}
   * @paramDef {"type":"listCustomViewsDict__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required module name."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Custom Views
   * @description Backs the Custom View dropdown on List Records. Custom views are saved filters configured by recruiters (e.g. "All Open Candidates", "Hot Leads This Week") — picking one returns only the records matching that view's criteria.
   *
   * @route POST /list-custom-views-dictionary
   *
   * @paramDef {"type":"listCustomViewsDict__payload","label":"Payload","name":"payload","description":"Contains module name, optional search, and pagination cursor."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"All Open Candidates","note":"system_defined: true","value":"4150868000000091045"}]}
   * @returns {DictionaryResponse}
   */
  async listCustomViewsDict(payload) {
    const { search, criteria } = payload || {}
    const moduleName = this.#resolveModuleApiName(criteria?.moduleName)

    const response = await this.#apiRequest({
      logTag: 'listCustomViewsDict',
      url: `${ this.#recruitBase() }/settings/custom_views`,
      query: { module: moduleName },
    })

    let views = response?.custom_views || []

    if (search) {
      views = searchFilter(views, ['name', 'display_value'], search)
    }

    return {
      cursor: null,
      items: views.map(v => ({
        label: v.display_value || v.name || `View ${ v.id }`,
        note: `system_defined: ${ v.system_defined === true }`,
        value: v.id,
      })),
    }
  }

  // ---------------------------- Fields Dictionary ----------------------------

  /**
   * @typedef {Object} listFieldsDict__payloadCriteria
   * @paramDef {"type":"String","label":"Module","name":"moduleName","required":true,"dictionary":"listModulesDict","description":"The module whose fields will be listed."}
   */

  /**
   * @typedef {Object} listFieldsDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring filter on field name or display label."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (fields endpoint returns the full list)."}
   * @paramDef {"type":"listFieldsDict__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required module name."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Fields
   * @description Backs the Field picker dropdown — used by actions where the user selects which fields to read or sort by, and by Build Search Criteria. Each option shows the field's display label, type, and whether it's required, with the underlying field name as the value.
   *
   * @route POST /list-fields-dictionary
   *
   * @paramDef {"type":"listFieldsDict__payload","label":"Payload","name":"payload","description":"Contains module name, optional search, and pagination cursor."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"Last Name (text, required)","note":"api: Last_Name","value":"Last_Name"}]}
   * @returns {DictionaryResponse}
   */
  async listFieldsDict(payload) {
    const { search, criteria } = payload || {}
    const moduleName = this.#resolveModuleApiName(criteria?.moduleName)

    const response = await this.#apiRequest({
      logTag: 'listFieldsDict',
      url: `${ this.#recruitBase() }/settings/fields`,
      query: { module: moduleName },
    })

    let fields = response?.fields || []

    if (search) {
      fields = searchFilter(
        fields,
        ['api_name', 'field_label', 'display_label'],
        search
      )
    }

    return {
      cursor: null,
      items: fields.map(f => {
        const required = f.system_mandatory || f.required ? ', required' : ''
        const dataType = f.data_type || 'text'

        return {
          label: `${ f.field_label || f.display_label || f.api_name } (${ dataType }${ required })`,
          note: `api: ${ f.api_name }`,
          value: f.api_name,
        }
      }),
    }
  }

  // ---------------------------- Picklist Values Dictionary ----------------------------

  /**
   * @typedef {Object} listPicklistValuesDict__payloadCriteria
   * @paramDef {"type":"String","label":"Module","name":"moduleName","required":true,"dictionary":"listModulesDict","description":"The module whose field belongs to."}
   * @paramDef {"type":"String","label":"Field","name":"fieldName","required":true,"dictionary":"listFieldsDict","description":"The picklist field whose options will be listed."}
   */

  /**
   * @typedef {Object} listPicklistValuesDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring filter on picklist value."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (picklist endpoint returns the full list)."}
   * @paramDef {"type":"listPicklistValuesDict__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required module + field name."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Picklist Values
   * @description Backs status / dropdown pickers — given a module + field, returns the valid options users can pick (e.g. for the Application Status field: "In-process", "Interview", "Offer Made", "Hired", "Rejected"). Use as the dictionary for an action's status parameter, or to validate values before passing them to Update / Change Status actions.
   *
   * @route POST /list-picklist-values-dictionary
   *
   * @paramDef {"type":"listPicklistValuesDict__payload","label":"Payload","name":"payload","description":"Contains module + field name, optional search, and pagination cursor."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"In-progress","note":"","value":"In-progress"}]}
   * @returns {DictionaryResponse}
   */
  async listPicklistValuesDict(payload) {
    const { search, criteria } = payload || {}
    const moduleName = this.#resolveModuleApiName(criteria?.moduleName)
    const fieldName = criteria?.fieldName

    if (!fieldName) {
      return { cursor: null, items: [] }
    }

    const response = await this.#apiRequest({
      logTag: 'listPicklistValuesDict',
      url: `${ this.#recruitBase() }/settings/fields`,
      query: { module: moduleName },
    })

    const field = (response?.fields || []).find(
      f => f.api_name === fieldName
    )
    let values = field?.pick_list_values || []

    if (search) {
      values = searchFilter(values, ['actual_value', 'display_value'], search)
    }

    return {
      cursor: null,
      items: values.map(v => ({
        label: v.display_value || v.actual_value,
        note: v.colour_code || '',
        value: v.actual_value,
      })),
    }
  }

  // ---------------------------- Tags Dictionary ----------------------------

  /**
   * @typedef {Object} listTagsDict__payloadCriteria
   * @paramDef {"type":"String","label":"Module","name":"moduleName","required":true,"dictionary":"listModulesDict","description":"The module whose tags will be listed."}
   */

  /**
   * @typedef {Object} listTagsDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring filter on tag name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (tags endpoint returns the full list)."}
   * @paramDef {"type":"listTagsDict__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required module name."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Tags
   * @description Backs Tag picker dropdowns on Add Tags / Remove Tags actions. Tags are scoped per module — a "Hot" tag on Candidates is a different object from "Hot" on Job Openings.
   *
   * @route POST /list-tags-dictionary
   *
   * @paramDef {"type":"listTagsDict__payload","label":"Payload","name":"payload","description":"Contains module name, optional search, and pagination cursor."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"Hot","note":"id: 4150868000000456001","value":"Hot"}]}
   * @returns {DictionaryResponse}
   */
  async listTagsDict(payload) {
    const { search, criteria } = payload || {}
    const moduleName = this.#resolveModuleApiName(criteria?.moduleName)

    const response = await this.#apiRequest({
      logTag: 'listTagsDict',
      url: `${ this.#recruitBase() }/settings/tags`,
      query: { module: moduleName },
    })

    let tags = response?.tags || []

    if (search) {
      tags = searchFilter(tags, ['name'], search)
    }

    return {
      cursor: null,
      items: tags.map(t => ({
        label: t.name,
        note: `id: ${ t.id }`,
        value: t.name,
      })),
    }
  }

  // ============================================================================================
  // 3. UNIVERSAL RECORDS
  // ============================================================================================
  // Module-agnostic CRUD — any api_name, built-in or custom. The Candidate/JobOpening/etc.
  // methods below are thin wrappers that preset moduleName for the most-common modules.

  /**
   * @operationName Get Record
   * @category Records
   * @description Fetches the current field values of one record by its Zoho ID, from any module (Candidates, Job Openings, Applications, custom modules, etc.). Use when you already have a record's ID — typically captured from a trigger or a previous Search/List call — and need its latest data. Prefer Get Candidate / Get Application / Get Interview when working specifically with those modules; this method exists for custom or less-common modules.
   * @route POST /get-record
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Module","name":"moduleName","required":true,"dictionary":"listModulesDict","description":"The Zoho Recruit module to operate on (Candidates, Job Openings, Applications, or any custom module). Pick from the dropdown — the underlying name is sent automatically."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"freeform":true,"description":"The Zoho record ID (19-digit string). Treat as opaque — never coerce to Number."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"Optional comma-separated list of field names to include in the response (e.g. \"Last_Name,Email,Phone\"). Omit to return every field. Trimming this on heavy-list calls reduces payload size and quota cost."}
   *
   * @returns {Object}
   * @sampleResultLoader { "methodName":"getRecord_SampleResultLoader", "dependsOn":["moduleName"] }
   */
  async getRecord(moduleName, recordId, fields) {
    const apiName = this.#resolveModuleApiName(moduleName)

    const response = await this.#apiRequest({
      logTag: 'getRecord',
      url: `${ this.#recruitBase() }/${ apiName }/${ recordId }`,
      query: cleanupObject({ fields: toCommaList(fields) }),
    })

    return response?.data?.[0] || response
  }

  /**
   * @operationName List Records
   * @category Records
   * @description Pages through records of a chosen module with optional sorting, a saved-view filter, or a "changed since" cutoff. Use this to enumerate records (e.g. "all candidates modified in the last 24 hours", "all job openings in the Engineering custom view") or to back a paginated UI. For free-text matching use Search Records; for a single ID use Get Record.
   * @route POST /list-records
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Module","name":"moduleName","required":true,"dictionary":"listModulesDict","description":"The Zoho Recruit module to operate on. Pick from the dropdown."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Which page of results to return (starting at 1). Combine with Page Size to walk through large result sets. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many records to return per page (max 200). Larger pages mean fewer API calls when paging through big result sets. Defaults to 50."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"Optional comma-separated list of field names to include in the response (e.g. \"Last_Name,Email\"). Omit to return every field."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","dictionary":"listFieldsDict","description":"Field to sort the results by — common picks are Modified_Time (most-recently-changed first), Created_Time, or Last_Name. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction. Default ascending."}
   * @paramDef {"type":"String","label":"Custom View","name":"customViewId","dictionary":"listCustomViewsDict","description":"Optional saved-filter view (configured by recruiters in Zoho Recruit) — when set, only records matching that view's criteria are returned. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Modified Since","name":"modifiedSince","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional cutoff timestamp (with timezone) — only records modified after this moment are returned. Use for periodic syncs to pick up just what changed since the last run."}
   * @paramDef {"type":"Boolean","label":"Fetch All Pages","name":"fetchAll","uiComponent":{"type":"CHECKBOX"},"description":"When checked, the action keeps paging through results until there are no more, returning everything in one combined response (capped at ~20,000 records as a safety net). The Page parameter is ignored. Use when downstream steps need all records at once and you don't want to loop manually."}
   *
   * @returns {Object}
   * @sampleResultLoader { "methodName":"listRecords_SampleResultLoader", "dependsOn":["moduleName"] }
   */
  async listRecords(
    moduleName,
    page,
    perPage,
    fields,
    sortBy,
    sortOrder,
    customViewId,
    modifiedSince,
    fetchAll
  ) {
    const apiName = this.#resolveModuleApiName(moduleName)
    const url = `${ this.#recruitBase() }/${ apiName }`

    sortOrder = this.#resolveChoice(sortOrder, SORT_ORDER_MAP)

    const headers = modifiedSince
      ? { 'If-Modified-Since': new Date(modifiedSince).toUTCString() }
      : undefined

    if (fetchAll) {
      return this.#fetchAllPages({
        logTag: 'listRecords.fetchAll',
        url,
        perPage: Math.min(perPage || MAX_PAGE_SIZE, MAX_PAGE_SIZE),
        baseQuery: cleanupObject({
          fields: toCommaList(fields),
          sort_by: sortBy,
          sort_order: sortOrder,
          cvid: customViewId,
        }),
        headers,
      })
    }

    const response = await this.#apiRequest({
      logTag: 'listRecords',
      url,
      headers,
      query: cleanupObject({
        page: page || 1,
        per_page: Math.min(perPage || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
        fields: toCommaList(fields),
        sort_by: sortBy,
        sort_order: sortOrder,
        cvid: customViewId,
      }),
    })

    return {
      data: response?.data || [],
      info: response?.info || {},
    }
  }

  async #fetchAllPages({ logTag, url, perPage, baseQuery, headers }) {
    const all = []
    let page = 1
    let lastInfo = null

    while (page <= FETCH_ALL_MAX_PAGES) {
      const response = await this.#apiRequest({
        logTag: `${ logTag }.p${ page }`,
        url,
        headers,
        query: cleanupObject({ ...baseQuery, page, per_page: perPage }),
      })

      const batch = response?.data || []

      all.push(...batch)
      lastInfo = response?.info || lastInfo

      if (response?.info?.more_records !== true) break

      page++
    }

    if (page > FETCH_ALL_MAX_PAGES) {
      logger.warn(
        `${ logTag } - hit FETCH_ALL_MAX_PAGES cap of ${ FETCH_ALL_MAX_PAGES }; returning ${ all.length } records`
      )
    }

    return { data: all, info: lastInfo || {} }
  }

  /**
   * @operationName Create Record
   * @category Records
   * @description Inserts one new record in any module. Field Values is an object whose keys are field names and whose values are what to store (e.g. `{ Last_Name: "Smith", Email: "smith@example.com" }`). Use this for custom modules or when you need fine-grained control over the layout/workflow flags. For everyday use, prefer Create Candidate, Create Job Opening, or Schedule Interview — those methods validate required fields up front and are easier to read in flows.
   * @route POST /create-record
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Module","name":"moduleName","required":true,"dictionary":"listModulesDict","description":"The Zoho Recruit module to operate on. Pick from the dropdown."}
   * @paramDef {"type":"Object","label":"Field Values","name":"data","required":true,"freeform":true,"description":"Object whose keys are field names and whose values are what to store, e.g. { \"Last_Name\": \"Smith\", \"Email\": \"smith@example.com\" }. Which fields are required depends on the module's layout — run List Module Fields first to discover them."}
   * @paramDef {"type":"String","label":"Layout ID","name":"layoutId","dictionary":"listLayoutsDict","description":"Optional layout to assign the record to. Defaults to the module's standard layout."}
   * @paramDef {"type":"Boolean","label":"Trigger Workflows","name":"triggerWorkflows","uiComponent":{"type":"CHECKBOX"},"description":"When true (default), runs Zoho's automation rules and workflow triggers for the create event."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"4150868000000567001","Modified_Time":"2026-05-10T14:00:00-04:00"},"message":"record added","status":"success"}]}
   */
  async createRecord(moduleName, data, layoutId, triggerWorkflows) {
    const apiName = this.#resolveModuleApiName(moduleName)
    const record = { ...(data || {}) }

    if (layoutId) {
      record.Layout = { id: layoutId }
    }

    const trigger = triggerWorkflows === false ? [] : ['workflow']

    const response = await this.#apiRequest({
      logTag: 'createRecord',
      method: 'post',
      url: `${ this.#recruitBase() }/${ apiName }`,
      body: { data: [record], trigger },
    })

    return response
  }

  /**
   * @operationName Update Record
   * @category Records
   * @description Modifies an existing record by ID. Only fields you pass in Field Values are changed; everything else is left as-is. Use this for custom modules, or when patching a single field that isn't covered by a dedicated convenience method (Update Candidate, Change Application Status, etc.). The response includes a per-record success flag — branch your flow on it if downstream steps depend on the update having stuck.
   * @route POST /update-record
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Module","name":"moduleName","required":true,"dictionary":"listModulesDict","description":"The Zoho Recruit module to operate on. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"freeform":true,"description":"The 19-digit Zoho record ID."}
   * @paramDef {"type":"Object","label":"Field Values","name":"data","required":true,"freeform":true,"description":"Object whose keys are field names and whose values are the new values to set, e.g. { \"Email\": \"new@example.com\", \"Current_Job_Title\": \"Senior Engineer\" }. Only the fields you supply are changed; everything else stays as-is."}
   * @paramDef {"type":"Boolean","label":"Trigger Workflows","name":"triggerWorkflows","uiComponent":{"type":"CHECKBOX"},"description":"When true (default), runs Zoho's automation rules for the update event."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"4150868000000567001","Modified_Time":"2026-05-10T14:05:00-04:00"},"message":"record updated","status":"success"}]}
   */
  async updateRecord(moduleName, recordId, data, triggerWorkflows) {
    const apiName = this.#resolveModuleApiName(moduleName)
    const trigger = triggerWorkflows === false ? [] : ['workflow']

    const response = await this.#apiRequest({
      logTag: 'updateRecord',
      method: 'put',
      url: `${ this.#recruitBase() }/${ apiName }/${ recordId }`,
      body: { data: [{ ...(data || {}) }], trigger },
    })

    return response
  }

  /**
   * @operationName Upsert Record
   * @category Records
   * @description Inserts a new record OR updates the existing one when a record with matching values on the duplicate-check fields (e.g. Email) is found. Use this for idempotent ingestion — re-running with the same payload won't create a duplicate. Typical scenario: syncing candidates from an external source where you don't know whether each person is new or already in Zoho.
   * @route POST /upsert-record
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Module","name":"moduleName","required":true,"dictionary":"listModulesDict","description":"The Zoho Recruit module to operate on. Pick from the dropdown."}
   * @paramDef {"type":"Object","label":"Field Values","name":"data","required":true,"freeform":true,"description":"Object whose keys are field names and whose values are what to store. Must include the field(s) listed in Duplicate Check Fields so Zoho can match against existing records."}
   * @paramDef {"type":"String","label":"Duplicate Check Fields","name":"duplicateCheckFields","description":"Comma-separated field names that identify a duplicate (e.g. \"Email\" or \"Email,Phone\"). If a record exists with matching values for all listed fields, Zoho updates it instead of inserting. Defaults to Email-only for most modules."}
   * @paramDef {"type":"Boolean","label":"Trigger Workflows","name":"triggerWorkflows","uiComponent":{"type":"CHECKBOX"},"description":"When true (default), runs Zoho's automation rules."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","action":"insert","details":{"id":"4150868000000567001"},"status":"success"}]}
   */
  async upsertRecord(moduleName, data, duplicateCheckFields, triggerWorkflows) {
    const apiName = this.#resolveModuleApiName(moduleName)
    const trigger = triggerWorkflows === false ? [] : ['workflow']
    const dupFields = toArray(duplicateCheckFields)

    const body = {
      data: [{ ...(data || {}) }],
      trigger,
    }

    if (dupFields.length > 0) {
      body.duplicate_check_fields = dupFields
    }

    const response = await this.#apiRequest({
      logTag: 'upsertRecord',
      method: 'post',
      url: `${ this.#recruitBase() }/${ apiName }/upsert`,
      body,
    })

    return response
  }

  /**
   * @operationName Delete Record
   * @category Records
   * @description Removes one or more records (up to 100 at a time) from any module. Deletions are soft — Zoho keeps the data in its Recycle Bin for 60 days, so accidental deletes can be recovered from the UI. Use this when cleaning up test data, processing GDPR right-to-erasure requests, or batch-removing stale records. Prefer Delete Candidate / Delete Job Opening for those modules — same effect, friendlier flow readability.
   * @route POST /delete-record
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Module","name":"moduleName","required":true,"dictionary":"listModulesDict","description":"The Zoho Recruit module to operate on. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Record IDs","name":"recordIds","required":true,"description":"Single ID, comma-separated list, or array of IDs (max 100)."}
   * @paramDef {"type":"Boolean","label":"Trigger Workflows","name":"triggerWorkflows","uiComponent":{"type":"CHECKBOX"},"description":"When true (default), runs Zoho's automation rules for the delete event."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"4150868000000567001"},"message":"record deleted","status":"success"}]}
   */
  async deleteRecord(moduleName, recordIds, triggerWorkflows) {
    const apiName = this.#resolveModuleApiName(moduleName)
    const ids = toCommaList(recordIds)

    if (!ids) {
      throw new Error('[Zoho Recruit][deleteRecord] recordIds is required')
    }

    const wfTrigger = triggerWorkflows === false ? false : true

    const response = await this.#apiRequest({
      logTag: 'deleteRecord',
      method: 'delete',
      url: `${ this.#recruitBase() }/${ apiName }`,
      query: { ids, wf_trigger: String(wfTrigger) },
    })

    return response
  }

  /**
   * @operationName Search Records
   * @category Records
   * @description Finds records in any module without knowing their IDs. Pass exactly ONE search input: an exact-match Email or Phone, a free-text Word that's matched starts-with against the module's primary fields, or a fully-formed Criteria expression for advanced multi-field filters. Use this for custom modules or when the search target isn't Candidates — for candidates specifically, prefer Search Candidates (same shape, presets module=Candidates).
   * @route POST /search-records
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Module","name":"moduleName","required":true,"dictionary":"listModulesDict","description":"The Zoho Recruit module to operate on. Pick from the dropdown."}
   * @paramDef {"type":"String","label":"Criteria","name":"criteria","description":"Filter expression in Zoho's syntax, e.g. ((Last_Name:equals:Smith)and(Email:starts_with:foo)). For complex filters built from dynamic inputs, use Build Search Criteria first to get the escaping right; otherwise write the string directly. Operators: equals, starts_with, between, greater_than, less_than."}
   * @paramDef {"type":"String","label":"Email (exact)","name":"email","description":"Exact-match email lookup — the record's Email field must equal this string. Use for dedupe checks. Mutually exclusive with Criteria / Phone / Word."}
   * @paramDef {"type":"String","label":"Phone (exact)","name":"phone","description":"Exact-match phone lookup. Mutually exclusive with Criteria / Email / Word."}
   * @paramDef {"type":"String","label":"Word","name":"word","description":"Free-text starts-with match across the module's primary fields (Last Name / First Name / Email / Phone for Candidates; Posting Title for Job Openings; etc.). Use for partial-name lookups like \"Smit\" matching \"Smith\". Mutually exclusive with Criteria / Email / Phone."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Which page of results to return (starting at 1). Combine with Page Size to walk through large result sets. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many records to return per page (max 200). Larger pages mean fewer API calls when paging through big result sets. Defaults to 50."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"Optional comma-separated list of field names to include in the response (e.g. \"Last_Name,Email\"). Omit to return every field."}
   *
   * @returns {Object}
   * @sampleResultLoader { "methodName":"searchRecords_SampleResultLoader", "dependsOn":["moduleName"] }
   */
  async searchRecords(
    moduleName,
    criteria,
    email,
    phone,
    word,
    page,
    perPage,
    fields
  ) {
    const apiName = this.#resolveModuleApiName(moduleName)
    const provided = [criteria, email, phone, word].filter(Boolean).length

    if (provided === 0) {
      throw new Error(
        '[Zoho Recruit][searchRecords] one of criteria/email/phone/word is required'
      )
    }

    if (provided > 1) {
      throw new Error(
        '[Zoho Recruit][searchRecords] pass only one of criteria/email/phone/word'
      )
    }

    // Translate `word` to a primary-fields OR criteria — see #buildWordCriteria for the why.
    let resolvedCriteria = criteria

    if (word && !criteria) {
      const moduleDef = CORE_MODULES[apiName]
      const primaryFields = moduleDef?.primaryFields || ['Last_Name', 'Email', 'Phone']
      const wordClauses = primaryFields.map(f => ({
        field: f, operator: 'starts_with', value: word,
      }))

      resolvedCriteria = buildCriteria(wordClauses, { logical: 'or' })
    }

    try {
      const response = await this.#apiRequest({
        logTag: 'searchRecords',
        url: `${ this.#recruitBase() }/${ apiName }/search`,
        query: cleanupObject({
          criteria: resolvedCriteria,
          email,
          phone,
          page: page || 1,
          per_page: Math.min(perPage || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
          fields: toCommaList(fields),
        }),
      })

      return {
        data: response?.data || [],
        info: response?.info || {},
      }
    } catch (error) {
      // Recruit returns 204 (no body) when search has zero matches — Flowrunner raises that as
      // an error. Normalize to empty result.
      if (error.message && /204/.test(error.message)) {
        return { data: [], info: { count: 0, more_records: false } }
      }

      throw error
    }
  }

  /**
   * @typedef {Object} SearchCriteriaClause
   * @property {String} field - Field api_name to filter on, e.g. "Last_Name".
   * @property {String} operator - One of: equals, starts_with, between, greater_than, less_than.
   * @property {String} value - Value to compare against. For "between" use "start,end".
   */

  /**
   * @operationName Build Search Criteria
   * @category Records
   * @description Helper that assembles a Zoho-compatible filter string from a list of simple field/operator/value clauses, handling all the escaping rules so you don't have to. Output goes into Search Records' Criteria parameter. Use this when an upstream step produces dynamic filter pieces (e.g. user-typed search terms) that you need to combine safely without worrying about parentheses, commas, or backslashes breaking the query.
   * @route POST /build-search-criteria
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"Array<SearchCriteriaClause>","label":"Clauses","name":"clauses","required":true,"description":"Array of filter rules. Each item is an object with three keys: `field` (the field name), `operator` (one of: equals, starts_with, between, greater_than, less_than), and `value` (the value to compare). Example: [{ \"field\": \"Last_Name\", \"operator\": \"equals\", \"value\": \"Smith\" }, { \"field\": \"Modified_Time\", \"operator\": \"greater_than\", \"value\": \"2026-01-01T00:00:00+00:00\" }]. For `between` use \"YYYY-MM-DD,YYYY-MM-DD\" as the value."}
   * @paramDef {"type":"String","label":"Logical Connector","name":"logical","uiComponent":{"type":"DROPDOWN","options":{"values":["And (match all clauses)","Or (match any clause)"]}},"description":"How to combine multiple clauses — \"and\" requires every clause to match, \"or\" matches any. Defaults to \"and\"."}
   *
   * @returns {Object}
   * @sampleResult {"criteria":"((Last_Name:equals:Smith)and(Email:starts_with:foo))"}
   */
  async buildSearchCriteria(clauses, logical) {
    const resolvedLogical =
      this.#resolveChoice(logical, LOGICAL_CONNECTOR_MAP) || 'and'
    const criteria = buildCriteria(clauses, { logical: resolvedLogical })

    return { criteria: criteria || null }
  }

  // ============================================================================================
  // 4. CANDIDATES (convenience wrappers)
  // ============================================================================================

  /**
   * @operationName Create Candidate
   * @category Candidates
   * @description Adds a new candidate to your Zoho Recruit talent pool. Use this to ingest applicants from external sources — job-board webhooks, referral forms, scraped LinkedIn profiles, or another ATS being migrated. Captures the most-common fields directly (name, email, phone, current employer, skills); any uncommon or custom fields can ride along in the optional Extra Fields object.
   * @route POST /create-candidate
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","required":true,"description":"Candidate's last name. Required by Zoho."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"Candidate's first name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Primary email address. Recommended for duplicate detection."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Primary phone number."}
   * @paramDef {"type":"String","label":"Mobile","name":"mobile","description":"Mobile phone number."}
   * @paramDef {"type":"String","label":"Current Job Title","name":"currentJobTitle","description":"Candidate's current role at their present employer."}
   * @paramDef {"type":"String","label":"Current Employer","name":"currentEmployer","description":"Candidate's current company."}
   * @paramDef {"type":"Number","label":"Experience (Years)","name":"experienceYears","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Total years of professional experience."}
   * @paramDef {"type":"String","label":"Skill Set","name":"skillSet","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Comma-separated skills or a free-text summary of capabilities."}
   * @paramDef {"type":"String","label":"Source","name":"source","description":"Candidate origin (e.g. LinkedIn, Referral, Indeed)."}
   * @paramDef {"type":"String","label":"Owner User ID","name":"ownerUserId","dictionary":"listUsersDict","description":"Optional recruiter user ID to assign as the candidate owner. Defaults to the connected user."}
   * @paramDef {"type":"Object","label":"Extra Fields","name":"extraFields","freeform":true,"description":"Optional object for any additional Candidate fields not in the dedicated parameters above — keys are field names, values are what to store, e.g. { \"City\": \"NYC\", \"LinkedIn\": \"https://linkedin.com/in/...\" }. Use List Module Fields with module=Candidates to discover what fields exist."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"4150868000000567001","Modified_Time":"2026-05-10T14:00:00-04:00"},"status":"success"}]}
   */
  async createCandidate(
    lastName,
    firstName,
    email,
    phone,
    mobile,
    currentJobTitle,
    currentEmployer,
    experienceYears,
    skillSet,
    source,
    ownerUserId,
    extraFields
  ) {
    const data =
      cleanupObject({
        Last_Name: lastName,
        First_Name: firstName,
        Email: email,
        Phone: phone,
        Mobile: mobile,
        Current_Job_Title: currentJobTitle,
        Current_Employer: currentEmployer,
        Experience_in_Years: experienceYears,
        Skill_Set: skillSet,
        Source: source,
        ...(ownerUserId ? { Owner: { id: ownerUserId } } : {}),
        ...(extraFields || {}),
      }) || {}

    if (!data.Last_Name) {
      throw new Error('[Zoho Recruit][createCandidate] lastName is required')
    }

    return this.createRecord('Candidates', data)
  }

  /**
   * @operationName Get Candidate
   * @category Candidates
   * @description Returns the full profile of one candidate — name, contact info, skills, source, owner, every standard and custom field. Use when a trigger or earlier step gives you a candidate ID and you need their current details (e.g. to enrich an outbound email, check skill match before scheduling, or sync to another system).
   * @route POST /get-candidate
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Candidate","name":"candidateId","required":true,"dictionary":"listCandidatesDict","description":"The candidate to fetch."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"Optional comma-separated list of field names to include in the response (e.g. \"Last_Name,Email\"). Omit to return every field."}
   *
   * @returns {Object}
   * @sampleResult {"id":"4150868000000567001","Last_Name":"Smith","First_Name":"Jane","Email":"jane@acme.com","Phone":"+1-555-1234","Source":"LinkedIn","Current_Job_Title":"Engineer"}
   */
  async getCandidate(candidateId, fields) {
    return this.getRecord('Candidates', candidateId, fields)
  }

  /**
   * @operationName Update Candidate
   * @category Candidates
   * @description Modifies one or more fields on an existing candidate. Only the fields you supply are touched; everything else stays as-is. Use this to enrich a candidate after extra info arrives (e.g. resume parsed → skills filled in), correct a typo flagged downstream, or change ownership without re-creating the record.
   * @route POST /update-candidate
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Candidate","name":"candidateId","required":true,"dictionary":"listCandidatesDict","description":"The candidate to update."}
   * @paramDef {"type":"Object","label":"Field Values","name":"data","required":true,"freeform":true,"description":"Object whose keys are field names and whose values are the new values to set. Only the fields you supply are changed; everything else stays as-is."}
   * @paramDef {"type":"Boolean","label":"Trigger Workflows","name":"triggerWorkflows","uiComponent":{"type":"CHECKBOX"},"description":"When true (default), runs Zoho's automation rules."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"4150868000000567001","Modified_Time":"2026-05-10T14:05:00-04:00"},"status":"success"}]}
   */
  async updateCandidate(candidateId, data, triggerWorkflows) {
    return this.updateRecord('Candidates', candidateId, data, triggerWorkflows)
  }

  /**
   * @operationName Delete Candidate
   * @category Candidates
   * @description Removes a candidate from active records. The deletion is soft — Zoho keeps the candidate in its Recycle Bin for 60 days where it can be restored from the UI. Use when handling GDPR right-to-erasure requests, removing test data, or culling stale prospects. After 60 days the record is gone for good.
   * @route POST /delete-candidate
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Candidate","name":"candidateId","required":true,"dictionary":"listCandidatesDict","description":"The candidate to delete."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"4150868000000567001"},"status":"success"}]}
   */
  async deleteCandidate(candidateId) {
    return this.deleteRecord('Candidates', candidateId)
  }

  /**
   * @operationName Search Candidates
   * @category Candidates
   * @description Looks up candidates without their IDs. Pass exactly ONE search input: an exact-match Email or Phone for dedupe checks, a free-text Word for partial-name lookups, or a Criteria expression for advanced multi-field filters. Use this to "does Jane Smith already exist?" before creating a new candidate, or to find everyone matching a recruiter's free-typed query.
   * @route POST /search-candidates
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Exact-match email lookup — the candidate's Email field must equal this string. Use for dedupe checks before insert. Mutually exclusive with Phone / Word / Criteria."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Exact-match phone lookup. Mutually exclusive with Email / Word / Criteria."}
   * @paramDef {"type":"String","label":"Word","name":"word","description":"Free-text starts-with match across Last Name / First Name / Email / Phone — \"Sm\" matches \"Smith\", \"smith@\", etc. Mutually exclusive with Email / Phone / Criteria."}
   * @paramDef {"type":"String","label":"Criteria","name":"criteria","description":"Filter expression in Zoho's syntax — use Build Search Criteria to assemble one safely, or write directly e.g. ((Skill_Set:starts_with:python)and(Experience_in_Years:greater_than:5))."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Which page of results to return (starting at 1). Combine with Page Size to walk through large result sets. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many records to return per page (max 200). Larger pages mean fewer API calls when paging through big result sets. Defaults to 50."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"4150868000000567001","Last_Name":"Smith","Email":"smith@acme.com"}],"info":{"count":1,"more_records":false}}
   */
  async searchCandidates(email, phone, word, criteria, page, perPage) {
    return this.searchRecords(
      'Candidates',
      criteria,
      email,
      phone,
      word,
      page,
      perPage
    )
  }

  /**
   * @operationName List Candidates
   * @category Candidates
   * @description Pages through your candidate pool, newest-modified first by default, with optional saved-view filtering and a "changed since" cutoff. Use to enumerate candidates for a periodic export, surface everyone in a curated view (e.g. "All Junior Engineers"), or pick up records that changed since the last sync. For free-text matching use Search Candidates; for one specific person use Get Candidate.
   * @route POST /list-candidates
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Which page of results to return (starting at 1). Combine with Page Size to walk through large result sets. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many records to return per page (max 200). Larger pages mean fewer API calls when paging through big result sets. Defaults to 50."}
   * @paramDef {"type":"String","label":"Custom View ID","name":"customViewId","freeform":true,"description":"Optional saved-filter view ID — when set, only candidates matching that view's criteria are returned. Use List Module Custom Views with module=Candidates to discover view IDs."}
   * @paramDef {"type":"String","label":"Modified Since","name":"modifiedSince","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional cutoff timestamp — only candidates modified after this moment are returned. Use for periodic syncs to pick up just what changed since the last run."}
   * @paramDef {"type":"Boolean","label":"Fetch All Pages","name":"fetchAll","uiComponent":{"type":"CHECKBOX"},"description":"When checked, returns every matching candidate in one combined response (capped at ~20,000 as a safety net). Page is ignored. Use when downstream steps need everything at once."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"4150868000000567001","Last_Name":"Smith","First_Name":"Jane"}],"info":{"count":1,"more_records":false}}
   */
  async listCandidates(page, perPage, customViewId, modifiedSince, fetchAll) {
    return this.listRecords(
      'Candidates',
      page,
      perPage,
      null,
      'Modified_Time',
      'desc',
      customViewId,
      modifiedSince,
      fetchAll
    )
  }

  /**
   * @operationName Parse Resume Into New Candidate
   * @category Candidates
   * @description Uploads a resume file (PDF / DOC / DOCX / TXT / HTML, max 20MB), runs Zoho's built-in resume parser, and creates a brand-new Candidate record pre-filled with the extracted name, contact info, work history, and skills. Use this to onboard applicants from received resumes without manual data entry — e.g. an inbox-watching automation that turns each new attachment into a candidate. To attach a resume to an EXISTING candidate instead of creating one, use Upload Resume To Candidate.
   * @route POST /parse-resume-into-candidate
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Resume File URL","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"Public HTTPS URL of the resume file (FlowRunner file or any reachable URL). Max 20MB."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","description":"Optional explicit file name (otherwise inferred from the URL or Content-Disposition header)."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"4150868000000567001"},"message":"Document Imported","status":"success"}]}
   */
  async parseResumeIntoCandidate(fileUrl, fileName) {
    if (!fileUrl) {
      throw new Error(
        '[Zoho Recruit][parseResumeIntoCandidate] fileUrl is required'
      )
    }

    const {
      buffer,
      contentType,
      fileName: detectedName,
    } = await fetchBinary(fileUrl)
    const finalName = fileName || detectedName

    const response = await this.#multipartRequest({
      logTag: 'parseResumeIntoCandidate',
      method: 'post',
      url: `${ this.#recruitBase() }/Candidates/actions/import_document`,
      parts: [
        { name: 'file', value: buffer, fileName: finalName, contentType },
      ],
    })

    return response
  }

  /**
   * @operationName Upload Resume To Existing Candidate
   * @category Candidates
   * @description Attaches a resume file to a candidate that already exists, tagged with category "Resume" so it shows up in the candidate's CV slot. Use this when the candidate record was created elsewhere (manual entry, partial import) and you're adding the file separately, or when refreshing a candidate's CV with an updated version. To CREATE a new candidate from a resume in one shot, use Parse Resume Into New Candidate instead.
   * @route POST /upload-resume-to-candidate
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Candidate","name":"candidateId","required":true,"dictionary":"listCandidatesDict","description":"The candidate to attach the resume to."}
   * @paramDef {"type":"String","label":"Resume File URL","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"Public HTTPS URL of the resume file. Max 20MB."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","description":"Optional explicit file name (otherwise inferred from the URL)."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"4150868000000812001"},"status":"success"}]}
   */
  async uploadResumeToCandidate(candidateId, fileUrl, fileName) {
    if (!candidateId)
      throw new Error(
        '[Zoho Recruit][uploadResumeToCandidate] candidateId is required'
      )
    if (!fileUrl)
      throw new Error(
        '[Zoho Recruit][uploadResumeToCandidate] fileUrl is required'
      )

    const {
      buffer,
      contentType,
      fileName: detectedName,
    } = await fetchBinary(fileUrl)
    const finalName = fileName || detectedName

    const response = await this.#multipartRequest({
      logTag: 'uploadResumeToCandidate',
      method: 'post',
      url: `${ this.#recruitBase() }/Candidates/${ candidateId }/Attachments`,
      query: { attachments_category: 'Resume' },
      parts: [
        { name: 'file', value: buffer, fileName: finalName, contentType },
      ],
    })

    return response
  }

  /**
   * @operationName Associate Candidate To Job Opening
   * @category Candidates
   * @description Links an existing candidate to a Job Opening — Zoho automatically creates the Application record that connects them. Use this when moving a sourced candidate into the hiring pipeline for a specific role (e.g. "this engineer looks great for the Backend Lead opening"). Once associated, you can drive the candidate through pipeline stages with Change Application Status.
   * @route POST /associate-candidate-to-job-opening
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Candidate","name":"candidateId","required":true,"dictionary":"listCandidatesDict","description":"The candidate to associate."}
   * @paramDef {"type":"String","label":"Job Opening","name":"jobOpeningId","required":true,"dictionary":"listJobOpeningsDict","description":"The Job Opening to associate the candidate with."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional comment recorded on the association."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","message":"Record successfully associated","status":"success"}]}
   */
  async associateCandidateToJobOpening(candidateId, jobOpeningId, comments) {
    if (!candidateId)
      throw new Error(
        '[Zoho Recruit][associateCandidateToJobOpening] candidateId is required'
      )
    if (!jobOpeningId)
      throw new Error(
        '[Zoho Recruit][associateCandidateToJobOpening] jobOpeningId is required'
      )

    // Recruit's associate endpoint is module-level (POST/PUT /Candidates/actions/associate) and
    // carries BOTH candidate ids and job ids in the body — there is no /{id}/ path variant.
    const body = {
      data: [
        cleanupObject({
          jobids: [jobOpeningId],
          ids: [candidateId],
          comments,
        }),
      ],
    }

    const response = await this.#apiRequest({
      logTag: 'associateCandidateToJobOpening',
      method: 'put',
      url: `${ this.#recruitBase() }/Candidates/actions/associate`,
      body,
    })

    return response
  }

  // ============================================================================================
  // 5. JOB OPENINGS
  // ============================================================================================

  /**
   * @operationName Create Job Opening
   * @category Job Openings
   * @description Opens a new requisition for hiring — the role candidates will apply to and be associated with. Use when an external system (HR planning tool, hiring manager intake form) signals a new role is approved and needs to start sourcing. Captures the standard posting fields directly; uncommon or custom fields go in Extra Fields.
   * @route POST /create-job-opening
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Posting Title","name":"postingTitle","required":true,"description":"Public-facing role title (e.g. 'Senior Backend Engineer')."}
   * @paramDef {"type":"String","label":"Client","name":"clientId","freeform":true,"description":"Optional Client (Account) ID for staffing agencies. Internal hires can omit."}
   * @paramDef {"type":"String","label":"Department","name":"department","description":"Hiring department (free-text or matches a Department record)."}
   * @paramDef {"type":"String","label":"Industry","name":"industry","description":"Industry classification."}
   * @paramDef {"type":"Number","label":"Number Of Positions","name":"numberOfPositions","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Headcount to fill. Default 1."}
   * @paramDef {"type":"String","label":"Job Type","name":"jobType","uiComponent":{"type":"DROPDOWN","options":{"values":["Full-Time","Part-Time","Contract","Temporary","Intern"]}},"description":"Engagement type."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["In Progress","Waiting for Approval","On Hold","Inactive","Cancelled","Filled"]}},"description":"Initial Job Opening status. Defaults to your org's default for the chosen layout if omitted. If your org uses custom statuses, write the value directly instead of picking."}
   * @paramDef {"type":"String","label":"City","name":"city","description":"Primary work city."}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"Primary work country."}
   * @paramDef {"type":"String","label":"Salary","name":"salary","description":"Pay band — free-text or numeric (Zoho stores as decimal)."}
   * @paramDef {"type":"String","label":"Job Description","name":"jobDescription","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Full role description."}
   * @paramDef {"type":"String","label":"Required Skills","name":"requiredSkills","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Comma-separated or free-text list of required skills."}
   * @paramDef {"type":"String","label":"Owner User ID","name":"ownerUserId","dictionary":"listUsersDict","description":"Optional recruiter user ID assigned as owner."}
   * @paramDef {"type":"Object","label":"Extra Fields","name":"extraFields","freeform":true,"description":"Optional object for any additional Job Opening fields not in the dedicated parameters above — keys are field names, values are what to store, e.g. { \"Remote_Allowed\": true, \"Hiring_Manager\": \"jane@acme.com\" }."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"4150868000000789001"},"status":"success"}]}
   */
  async createJobOpening(
    postingTitle,
    clientId,
    department,
    industry,
    numberOfPositions,
    jobType,
    status,
    city,
    country,
    salary,
    jobDescription,
    requiredSkills,
    ownerUserId,
    extraFields
  ) {
    if (!postingTitle)
      throw new Error(
        '[Zoho Recruit][createJobOpening] postingTitle is required'
      )

    status = this.#resolveChoice(status, JOB_OPENING_STATUS_MAP)

    const data =
      cleanupObject({
        Posting_Title: postingTitle,
        Department: department,
        Industry: industry,
        Number_of_Positions: numberOfPositions,
        Job_Type: jobType,
        Job_Opening_Status: status,
        City: city,
        Country: country,
        Salary: salary,
        Job_Description: jobDescription,
        Required_Skills: requiredSkills,
        ...(clientId ? { Client_Name: { id: clientId } } : {}),
        ...(ownerUserId ? { Owner: { id: ownerUserId } } : {}),
        ...(extraFields || {}),
      }) || {}

    return this.createRecord('JobOpenings', data)
  }

  /**
   * @operationName Get Job Opening
   * @category Job Openings
   * @description Returns the full details of one job requisition — title, status, headcount, location, salary, description, owner, every standard and custom field. Use when a trigger or earlier step gives you a Job Opening ID and you need its current values (e.g. to render the description in a job board, count remaining positions, or check status before associating a candidate).
   * @route POST /get-job-opening
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Job Opening","name":"jobOpeningId","required":true,"dictionary":"listJobOpeningsDict","description":"The Job Opening to fetch."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"Optional comma-separated list of field names to include in the response (e.g. \"Last_Name,Email\"). Omit to return every field."}
   *
   * @returns {Object}
   * @sampleResult {"id":"4150868000000789001","Posting_Title":"Senior Backend Engineer","Job_Opening_Status":"In-progress","Number_of_Positions":2}
   */
  async getJobOpening(jobOpeningId, fields) {
    return this.getRecord('JobOpenings', jobOpeningId, fields)
  }

  /**
   * @operationName Update Job Opening
   * @category Job Openings
   * @description Modifies one or more fields on an existing Job Opening. Only fields you supply are changed. Use to revise the posting (e.g. headcount increased, salary band changed, description rewritten) without re-creating the requisition. For status-only changes prefer Change Job Opening Status; for closing prefer Close Job Opening.
   * @route POST /update-job-opening
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Job Opening","name":"jobOpeningId","required":true,"dictionary":"listJobOpeningsDict","description":"The Job Opening to update."}
   * @paramDef {"type":"Object","label":"Field Values","name":"data","required":true,"freeform":true,"description":"Object whose keys are field names and whose values are the new values to set. Only the fields you supply are changed; everything else stays as-is."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"4150868000000789001"},"status":"success"}]}
   */
  async updateJobOpening(jobOpeningId, data) {
    return this.updateRecord('JobOpenings', jobOpeningId, data)
  }

  /**
   * @operationName Change Job Opening Status
   * @category Job Openings
   * @description Switches a job requisition's status in one step. Common values: In-progress (actively sourcing), Waiting for approval, On Hold (paused), Inactive, Cancelled, Filled. Use when downstream events should drive the requisition's lifecycle — e.g. "auto-set to Filled when the offer is accepted" or "move to On Hold when the budget freeze starts".
   * @route POST /change-job-opening-status
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Job Opening","name":"jobOpeningId","required":true,"dictionary":"listJobOpeningsDict","description":"The Job Opening to update."}
   * @paramDef {"type":"String","label":"New Status","name":"newStatus","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["In Progress","Waiting for Approval","On Hold","Inactive","Cancelled","Filled"]}},"description":"The new status to set on the Job Opening. If your org uses custom values (visible in Zoho Recruit > Settings > Modules > Job Openings), write the value directly instead of picking."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"4150868000000789001"},"status":"success"}]}
   */
  async changeJobOpeningStatus(jobOpeningId, newStatus) {
    if (!newStatus)
      throw new Error(
        '[Zoho Recruit][changeJobOpeningStatus] newStatus is required'
      )

    newStatus = this.#resolveChoice(newStatus, JOB_OPENING_STATUS_MAP)

    return this.updateRecord('JobOpenings', jobOpeningId, {
      Job_Opening_Status: newStatus,
    })
  }

  /**
   * @operationName Close Job Opening
   * @category Job Openings
   * @description Marks a job requisition as Filled — the canonical "we're done hiring for this role" status. Use when an offer is accepted and the headcount is satisfied. For other terminal states (Cancelled, Inactive) use Change Job Opening Status with that specific value.
   * @route POST /close-job-opening
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Job Opening","name":"jobOpeningId","required":true,"dictionary":"listJobOpeningsDict","description":"The Job Opening to close."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"4150868000000789001"},"status":"success"}]}
   */
  async closeJobOpening(jobOpeningId) {
    return this.updateRecord('JobOpenings', jobOpeningId, {
      Job_Opening_Status: 'Filled',
    })
  }

  /**
   * @operationName Delete Job Opening
   * @category Job Openings
   * @description Removes a job requisition. Soft-delete: kept in Zoho's Recycle Bin for 60 days where it can be restored from the UI. Use for cleaning up duplicates or test requisitions. To retire a real-but-completed role prefer Close Job Opening (status=Filled) so the historical Application records still make sense.
   * @route POST /delete-job-opening
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Job Opening","name":"jobOpeningId","required":true,"dictionary":"listJobOpeningsDict","description":"The Job Opening to delete."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"4150868000000789001"},"status":"success"}]}
   */
  async deleteJobOpening(jobOpeningId) {
    return this.deleteRecord('JobOpenings', jobOpeningId)
  }

  /**
   * @operationName List Job Openings
   * @category Job Openings
   * @description Pages through your active and historical requisitions, newest-modified first by default, with optional status filter and "changed since" cutoff. Use to render a dashboard of open roles, drive a periodic job-board sync, or audit how many requisitions are stuck in any given status.
   * @route POST /list-job-openings
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["In Progress","Waiting for Approval","On Hold","Inactive","Cancelled","Filled"]}},"description":"Optional status filter."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Which page of results to return (starting at 1). Combine with Page Size to walk through large result sets. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many records to return per page (max 200). Larger pages mean fewer API calls when paging through big result sets. Defaults to 50."}
   * @paramDef {"type":"String","label":"Modified Since","name":"modifiedSince","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional cutoff timestamp — only Job Openings modified after this moment are returned. Use for periodic syncs."}
   * @paramDef {"type":"Boolean","label":"Fetch All Pages","name":"fetchAll","uiComponent":{"type":"CHECKBOX"},"description":"When checked, returns every matching Job Opening in one combined response (capped at ~20,000 as a safety net). Page is ignored."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"4150868000000789001","Posting_Title":"Senior Backend Engineer","Job_Opening_Status":"In-progress"}],"info":{"count":1,"more_records":false}}
   */
  async listJobOpenings(status, page, perPage, modifiedSince, fetchAll) {
    status = this.#resolveChoice(status, JOB_OPENING_STATUS_MAP)

    if (status) {
      const criteria = buildCriteria([
        { field: 'Job_Opening_Status', operator: 'equals', value: status },
      ])

      return this.searchRecords(
        'JobOpenings',
        criteria,
        null,
        null,
        null,
        page,
        perPage
      )
    }

    return this.listRecords(
      'JobOpenings',
      page,
      perPage,
      null,
      'Modified_Time',
      'desc',
      null,
      modifiedSince,
      fetchAll
    )
  }

  // ============================================================================================
  // 6. APPLICATIONS
  // ============================================================================================

  /**
   * @operationName List Applications
   * @category Applications
   * @description Pages through Applications — the records that link a candidate to a specific job and track that candidate's pipeline stage for that role. Filter by Job Opening to see "everyone applied to this role", by Candidate to see "every role this person is being considered for", and/or by Status to see "everyone in stage X". Use this to drive recruiter dashboards, send pipeline-stage reports, or fan out reminders.
   * @route POST /list-applications
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Job Opening","name":"jobOpeningId","dictionary":"listJobOpeningsDict","description":"Optional — only applications for this Job Opening are returned."}
   * @paramDef {"type":"String","label":"Candidate","name":"candidateId","dictionary":"listCandidatesDict","description":"Optional — only applications for this candidate are returned."}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"Optional pipeline-stage filter (typical values: \"In-process\", \"Interview\", \"Offer Made\", \"Hired\", \"Rejected\"). Exact values depend on your org's pipeline configuration — use List Picklist Values with module=Applications and field=Status to discover them."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Which page of results to return (starting at 1). Combine with Page Size to walk through large result sets. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many records to return per page (max 200). Larger pages mean fewer API calls when paging through big result sets. Defaults to 50."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"4150868000000812001","Candidate_Id":{"name":"Jane Smith","id":"4150868000000567001"},"Job_Opening_Id":{"name":"Senior Backend Engineer","id":"4150868000000789001"},"Status":"In-process"}],"info":{"count":1,"more_records":false}}
   */
  async listApplications(jobOpeningId, candidateId, status, page, perPage) {
    const clauses = []

    if (jobOpeningId)
      clauses.push({
        field: 'Job_Opening_Id',
        operator: 'equals',
        value: jobOpeningId,
      })
    if (candidateId)
      clauses.push({
        field: 'Candidate_Id',
        operator: 'equals',
        value: candidateId,
      })
    if (status)
      clauses.push({ field: 'Status', operator: 'equals', value: status })

    if (clauses.length > 0) {
      return this.searchRecords(
        'Applications',
        buildCriteria(clauses),
        null,
        null,
        null,
        page,
        perPage
      )
    }

    return this.listRecords(
      'Applications',
      page,
      perPage,
      null,
      'Modified_Time',
      'desc'
    )
  }

  /**
   * @operationName Get Application
   * @category Applications
   * @description Returns the full record linking one candidate to one Job Opening — current pipeline stage, source, dates, owner, and any custom Application fields. Use when a trigger gives you an Application ID and you need to see "where is this candidate in the process for this role?" before deciding what to do next.
   * @route POST /get-application
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Application","name":"applicationId","required":true,"dictionary":"listApplicationsDict","description":"The Application to fetch."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"Optional comma-separated list of field names to include in the response (e.g. \"Last_Name,Email\"). Omit to return every field."}
   *
   * @returns {Object}
   * @sampleResult {"id":"4150868000000812001","Candidate_Id":{"name":"Jane Smith","id":"4150868000000567001"},"Job_Opening_Id":{"name":"Senior Backend Engineer","id":"4150868000000789001"},"Status":"In-process"}
   */
  async getApplication(applicationId, fields) {
    return this.getRecord('Applications', applicationId, fields)
  }

  /**
   * @operationName Change Application Status
   * @category Applications
   * @description Moves a candidate to a new pipeline stage for a specific Job Opening — the canonical way to advance, hold, or reject within Zoho's hiring workflow (e.g. "In-process" → "Interview" → "Offer Made" → "Hired"). Use this in stage-transition automations: when an interview is completed, when a take-home is submitted, when feedback is collected. The exact allowed values depend on your org's pipeline configuration; use List Picklist Values with field "Status" to discover them.
   * @route POST /change-application-status
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Application","name":"applicationId","required":true,"dictionary":"listApplicationsDict","description":"The Application to update."}
   * @paramDef {"type":"String","label":"New Status","name":"newStatus","required":true,"description":"The new pipeline stage to move the candidate into for this Job Opening (typical values: \"In-process\", \"Interview\", \"Offer Made\", \"Hired\", \"Rejected\"). Must match a value defined on your org's Application Status picklist — use List Picklist Values with module=Applications and field=Status to discover them."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"4150868000000812001"},"status":"success"}]}
   */
  async changeApplicationStatus(applicationId, newStatus) {
    if (!newStatus)
      throw new Error(
        '[Zoho Recruit][changeApplicationStatus] newStatus is required'
      )

    return this.updateRecord('Applications', applicationId, {
      Status: newStatus,
    })
  }

  /**
   * @operationName Update Application
   * @category Applications
   * @description Modifies one or more fields on an existing Application beyond just status — e.g. recording the source channel, attaching a referral note, updating a custom field. Use when you need broader changes than Change Application Status; that method is preferred when only the pipeline stage needs to move.
   * @route POST /update-application
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Application","name":"applicationId","required":true,"dictionary":"listApplicationsDict","description":"The Application to update."}
   * @paramDef {"type":"Object","label":"Field Values","name":"data","required":true,"freeform":true,"description":"Object whose keys are field names and whose values are the new values to set. Only the fields you supply are changed; everything else stays as-is."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"4150868000000812001"},"status":"success"}]}
   */
  async updateApplication(applicationId, data) {
    return this.updateRecord('Applications', applicationId, data)
  }

  // ============================================================================================
  // 7. INTERVIEWS
  // ============================================================================================

  /**
   * @operationName Schedule Interview
   * @category Interviews
   * @description Books an interview slot for a candidate — captures who, when, where, what type (in-person / online / phone / group), interviewers, and free-form remarks. Use this from a calendar-integration step or when an automation needs to create the next round after the previous one passed (e.g. "phone screen succeeded → schedule technical interview"). The Job Opening link is optional but recommended so the interview shows up in pipeline reports.
   * @route POST /schedule-interview
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Interview Name","name":"interviewName","required":true,"description":"Display title (e.g. 'Jane Smith — System Design Round')."}
   * @paramDef {"type":"String","label":"Candidate","name":"candidateId","required":true,"dictionary":"listCandidatesDict","description":"The candidate being interviewed."}
   * @paramDef {"type":"String","label":"Job Opening","name":"jobOpeningId","dictionary":"listJobOpeningsDict","description":"Optional Job Opening this interview targets."}
   * @paramDef {"type":"String","label":"Start Date/Time","name":"startDateTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Interview start (ISO-8601 with timezone, e.g. 2026-05-12T10:00:00-04:00)."}
   * @paramDef {"type":"String","label":"End Date/Time","name":"endDateTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Interview end (ISO-8601 with timezone)."}
   * @paramDef {"type":"String","label":"Interview Type","name":"interviewType","uiComponent":{"type":"DROPDOWN","options":{"values":["In-Person","Online","Phone","Group"]}},"description":"Format of the interview."}
   * @paramDef {"type":"String","label":"Venue","name":"venue","description":"Address or video-call URL."}
   * @paramDef {"type":"String","label":"Interviewer User IDs","name":"interviewerIds","description":"Optional comma-separated list of recruiter user IDs."}
   * @paramDef {"type":"String","label":"Owner User ID","name":"ownerUserId","dictionary":"listUsersDict","description":"Optional owner user ID."}
   * @paramDef {"type":"String","label":"Remarks","name":"remarks","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional additional notes."}
   * @paramDef {"type":"Object","label":"Extra Fields","name":"extraFields","freeform":true,"description":"Optional object for any additional Interview fields not in the dedicated parameters above — keys are field names, values are what to store."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"4150868000000900001"},"status":"success"}]}
   */
  async scheduleInterview(
    interviewName,
    candidateId,
    jobOpeningId,
    startDateTime,
    endDateTime,
    interviewType,
    venue,
    interviewerIds,
    ownerUserId,
    remarks,
    extraFields
  ) {
    if (!interviewName)
      throw new Error(
        '[Zoho Recruit][scheduleInterview] interviewName is required'
      )
    if (!candidateId)
      throw new Error(
        '[Zoho Recruit][scheduleInterview] candidateId is required'
      )
    if (!startDateTime)
      throw new Error(
        '[Zoho Recruit][scheduleInterview] startDateTime is required'
      )
    if (!endDateTime)
      throw new Error(
        '[Zoho Recruit][scheduleInterview] endDateTime is required'
      )

    interviewType = this.#resolveChoice(interviewType, INTERVIEW_TYPE_MAP)

    const interviewerArray = toArray(interviewerIds).map(id => ({ id }))

    const data =
      cleanupObject({
        Interview_Name: interviewName,
        Candidate_Id: { id: candidateId },
        ...(jobOpeningId ? { Job_Opening_Id: { id: jobOpeningId } } : {}),
        Start_DateTime: toZohoDateTime(startDateTime),
        End_DateTime: toZohoDateTime(endDateTime),
        Interview_Type: interviewType,
        Venue: venue,
        ...(interviewerArray.length > 0
          ? { Interviewer: interviewerArray }
          : {}),
        ...(ownerUserId ? { Owner: { id: ownerUserId } } : {}),
        Remarks: remarks,
        ...(extraFields || {}),
      }) || {}

    return this.createRecord('Interviews', data)
  }

  /**
   * @operationName List Interviews
   * @category Interviews
   * @description Pages through scheduled and completed interviews, with optional Candidate or Job Opening filters. Use to render an interviewer's daily schedule, count interviews per role, or pull "all upcoming interviews this week" for a Slack digest.
   * @route POST /list-interviews
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Candidate","name":"candidateId","dictionary":"listCandidatesDict","description":"Optional candidate filter."}
   * @paramDef {"type":"String","label":"Job Opening","name":"jobOpeningId","dictionary":"listJobOpeningsDict","description":"Optional Job Opening filter."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Which page of results to return (starting at 1). Combine with Page Size to walk through large result sets. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many records to return per page (max 200). Larger pages mean fewer API calls when paging through big result sets. Defaults to 50."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"4150868000000900001","Interview_Name":"Jane Smith — System Design","Start_DateTime":"2026-05-12T10:00:00-04:00"}],"info":{"count":1,"more_records":false}}
   */
  async listInterviews(candidateId, jobOpeningId, page, perPage) {
    const clauses = []

    if (candidateId)
      clauses.push({
        field: 'Candidate_Id',
        operator: 'equals',
        value: candidateId,
      })
    if (jobOpeningId)
      clauses.push({
        field: 'Job_Opening_Id',
        operator: 'equals',
        value: jobOpeningId,
      })

    if (clauses.length > 0) {
      return this.searchRecords(
        'Interviews',
        buildCriteria(clauses),
        null,
        null,
        null,
        page,
        perPage
      )
    }

    return this.listRecords(
      'Interviews',
      page,
      perPage,
      null,
      'Start_DateTime',
      'desc'
    )
  }

  /**
   * @operationName Get Interview
   * @category Interviews
   * @description Returns the full details of one interview — candidate, job, time, type, venue, interviewers, status, feedback. Use when a trigger gives you an Interview ID and you need its current state (e.g. to sync to a calendar, send a reminder, or check whether feedback has been recorded yet).
   * @route POST /get-interview
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Interview","name":"interviewId","required":true,"dictionary":"listInterviewsDict","description":"The Interview to fetch."}
   *
   * @returns {Object}
   * @sampleResult {"id":"4150868000000900001","Interview_Name":"Jane Smith — System Design","Start_DateTime":"2026-05-12T10:00:00-04:00"}
   */
  async getInterview(interviewId) {
    return this.getRecord('Interviews', interviewId)
  }

  /**
   * @operationName Update Interview
   * @category Interviews
   * @description Modifies one or more fields on an existing Interview — common uses are rescheduling (Start/End DateTime), changing the venue/video link, swapping interviewers, or recording feedback after the fact. Only fields you supply are touched. To cancel use Cancel Interview instead.
   * @route POST /update-interview
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Interview","name":"interviewId","required":true,"dictionary":"listInterviewsDict","description":"The Interview to update."}
   * @paramDef {"type":"Object","label":"Field Values","name":"data","required":true,"freeform":true,"description":"Object whose keys are field names and whose values are the new values to set, e.g. { \"Start_DateTime\": \"2026-05-12T14:00:00-04:00\", \"Venue\": \"https://meet.google.com/abc\" }. Only the fields you supply are changed."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"4150868000000900001"},"status":"success"}]}
   */
  async updateInterview(interviewId, data) {
    return this.updateRecord('Interviews', interviewId, data)
  }

  /**
   * @operationName Cancel Interview
   * @category Interviews
   * @description Marks an interview as cancelled and records an optional reason in the Remarks field. Use when the candidate withdraws, the interviewer is unavailable, or the role is put on hold. By default the status is set to "Cancelled"; pass a custom value if your Zoho org uses a different label for the cancelled state.
   * @route POST /cancel-interview
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Interview","name":"interviewId","required":true,"dictionary":"listInterviewsDict","description":"The Interview to cancel."}
   * @paramDef {"type":"String","label":"Cancellation Status","name":"status","description":"Optional override (default 'Cancelled')."}
   * @paramDef {"type":"String","label":"Reason","name":"reason","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional cancellation note recorded in Remarks."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"4150868000000900001"},"status":"success"}]}
   */
  async cancelInterview(interviewId, status, reason) {
    return this.updateRecord(
      'Interviews',
      interviewId,
      cleanupObject({
        Interview_Status: status || 'Cancelled',
        Remarks: reason,
      })
    )
  }

  // ============================================================================================
  // 8. NOTES
  // ============================================================================================

  /**
   * @operationName Add Note To Record
   * @category Notes
   * @description Attaches a free-text note to any record — Candidate, Job Opening, Application, Interview, custom modules, etc. Notes appear in the record's Notes panel in the Zoho UI and are visible to recruiters reviewing the file. Use to capture interview feedback, recruiter observations, hiring-manager comments, or any context that doesn't fit a structured field.
   * @route POST /add-note-to-record
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Module","name":"moduleName","required":true,"dictionary":"listModulesDict","description":"The module of the parent record."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"freeform":true,"description":"The parent record ID."}
   * @paramDef {"type":"String","label":"Note Title","name":"noteTitle","description":"Optional short title."}
   * @paramDef {"type":"String","label":"Note Content","name":"noteContent","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Note body."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"4150868000000567099"},"status":"success"}]}
   */
  async addNoteToRecord(moduleName, recordId, noteTitle, noteContent) {
    if (!recordId)
      throw new Error('[Zoho Recruit][addNoteToRecord] recordId is required')
    if (!noteContent)
      throw new Error(
        '[Zoho Recruit][addNoteToRecord] noteContent is required'
      )

    const apiName = this.#resolveModuleApiName(moduleName)

    // Recruit creates notes via the top-level /Notes endpoint with se_module + Parent_Id —
    // POST to the related-list path /{module}/{id}/Notes returns 400 INVALID_REQUEST_METHOD.
    const response = await this.#apiRequest({
      logTag: 'addNoteToRecord',
      method: 'post',
      url: `${ this.#recruitBase() }/Notes`,
      body: {
        data: [cleanupObject({
          Note_Title: noteTitle,
          Note_Content: noteContent,
          se_module: apiName,
          Parent_Id: recordId,
        })],
      },
    })

    return response
  }

  /**
   * @operationName List Notes For Record
   * @category Notes
   * @description Returns every note attached to a record, newest first. Use to gather all comments on a candidate or application before generating a hiring-committee summary, syncing notes to another system, or auditing recruiter activity.
   * @route POST /list-notes-for-record
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Module","name":"moduleName","required":true,"dictionary":"listModulesDict","description":"The module of the parent record."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"freeform":true,"description":"The parent record ID."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Which page of results to return (starting at 1). Combine with Page Size to walk through large result sets. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many notes to return per page (max 200). Defaults to 50."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"4150868000000567099","Note_Title":"Phone screen","Note_Content":"Strong communicator","Created_Time":"2026-05-10T14:30:00-04:00"}],"info":{"count":1,"more_records":false}}
   */
  async listNotesForRecord(moduleName, recordId, page, perPage) {
    const apiName = this.#resolveModuleApiName(moduleName)

    const response = await this.#apiRequest({
      logTag: 'listNotesForRecord',
      url: `${ this.#recruitBase() }/${ apiName }/${ recordId }/Notes`,
      query: cleanupObject({
        page: page || 1,
        per_page: Math.min(perPage || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
      }),
    })

    return { data: response?.data || [], info: response?.info || {} }
  }

  /**
   * @operationName Update Note
   * @category Notes
   * @description Edits the title or content of an existing note. Use to correct typos, append additional context, or rewrite an earlier draft note left by a previous step.
   * @route POST /update-note
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Module","name":"moduleName","required":true,"dictionary":"listModulesDict","description":"The module of the parent record."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"freeform":true,"description":"The parent record ID."}
   * @paramDef {"type":"String","label":"Note ID","name":"noteId","required":true,"freeform":true,"description":"The note ID."}
   * @paramDef {"type":"String","label":"Note Title","name":"noteTitle","description":"Optional updated title."}
   * @paramDef {"type":"String","label":"Note Content","name":"noteContent","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional updated content."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"4150868000000567099"},"status":"success"}]}
   */
  async updateNote(moduleName, recordId, noteId, noteTitle, noteContent) {
    const apiName = this.#resolveModuleApiName(moduleName)
    const data = cleanupObject({
      Note_Title: noteTitle,
      Note_Content: noteContent,
      se_module: apiName,
      Parent_Id: recordId,
    })

    if (!noteId)
      throw new Error('[Zoho Recruit][updateNote] noteId is required')
    if (!noteTitle && !noteContent)
      throw new Error(
        '[Zoho Recruit][updateNote] noteTitle or noteContent is required'
      )

    const response = await this.#apiRequest({
      logTag: 'updateNote',
      method: 'put',
      url: `${ this.#recruitBase() }/Notes/${ noteId }`,
      body: { data: [data] },
    })

    return response
  }

  /**
   * @operationName Delete Note
   * @category Notes
   * @description Permanently removes a note from a record. Unlike record deletion, note deletion is not soft — once gone, the note cannot be recovered. Use when removing notes that contain sensitive info posted in error, or cleaning up automated notes that are no longer relevant.
   * @route POST /delete-note
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Module","name":"moduleName","required":true,"dictionary":"listModulesDict","description":"The module of the parent record."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"freeform":true,"description":"The parent record ID."}
   * @paramDef {"type":"String","label":"Note ID","name":"noteId","required":true,"freeform":true,"description":"The note ID."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"4150868000000567099"},"status":"success"}]}
   */
  async deleteNote(moduleName, recordId, noteId) {
    if (!noteId)
      throw new Error('[Zoho Recruit][deleteNote] noteId is required')

    // Top-level Notes resource — Recruit doesn't expose DELETE on the related-list path.
    const response = await this.#apiRequest({
      logTag: 'deleteNote',
      method: 'delete',
      url: `${ this.#recruitBase() }/Notes`,
      query: { ids: noteId },
    })

    return response
  }

  // ============================================================================================
  // 9. ATTACHMENTS
  // ============================================================================================

  /**
   * @operationName List Attachments
   * @category Attachments
   * @description Returns every file attached to a record — resumes, offer letters, cover letters, signed contracts, and miscellaneous documents — with their names, sizes, categories, and upload timestamps. Use to inventory what's already attached before deciding whether to upload a new version, or to drive a "download all candidate documents" automation.
   * @route POST /list-attachments
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Module","name":"moduleName","required":true,"dictionary":"listModulesDict","description":"The module of the parent record."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"freeform":true,"description":"The parent record ID."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Which page of results to return (starting at 1). Combine with Page Size to walk through large result sets. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many attachments to return per page (max 200). Defaults to 50."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"4150868000000567077","File_Name":"jane-smith-resume.pdf","Size":"152314","Created_Time":"2026-05-10T14:00:00-04:00"}],"info":{"count":1,"more_records":false}}
   */
  async listAttachments(moduleName, recordId, page, perPage) {
    const apiName = this.#resolveModuleApiName(moduleName)

    const response = await this.#apiRequest({
      logTag: 'listAttachments',
      url: `${ this.#recruitBase() }/${ apiName }/${ recordId }/Attachments`,
      query: cleanupObject({
        page: page || 1,
        per_page: Math.min(perPage || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
      }),
    })

    return { data: response?.data || [], info: response?.info || {} }
  }

  /**
   * @operationName Upload Attachment
   * @category Attachments
   * @description Attaches a file (PDF, DOC, DOCX, XLSX, PNG, JPG, etc., up to 20MB) to any record. Optionally tags it with a category like "Cover Letter", "Offer Letter", or "Contract". Use this to attach signed offers, reference documents, or screening artifacts to a candidate or application. For resumes specifically, prefer Upload Resume To Existing Candidate so the file lands in the dedicated Resume slot.
   * @route POST /upload-attachment
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Module","name":"moduleName","required":true,"dictionary":"listModulesDict","description":"The module of the parent record."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"freeform":true,"description":"The parent record ID."}
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"Public HTTPS URL of the file."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","description":"Optional explicit file name (otherwise inferred from URL/headers)."}
   * @paramDef {"type":"String","label":"Category","name":"category","uiComponent":{"type":"DROPDOWN","options":{"values":["Others","Resume","Offer Letter","Contract","Cover Letter","Formatted Resume","Performance Review"]}},"description":"Optional attachment category — applies primarily to Candidates."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"4150868000000567077"},"status":"success"}]}
   */
  async uploadAttachment(moduleName, recordId, fileUrl, fileName, category) {
    if (!recordId)
      throw new Error('[Zoho Recruit][uploadAttachment] recordId is required')
    if (!fileUrl)
      throw new Error('[Zoho Recruit][uploadAttachment] fileUrl is required')

    const apiName = this.#resolveModuleApiName(moduleName)
    const {
      buffer,
      contentType,
      fileName: detectedName,
    } = await fetchBinary(fileUrl)
    const finalName = fileName || detectedName

    const response = await this.#multipartRequest({
      logTag: 'uploadAttachment',
      method: 'post',
      url: `${ this.#recruitBase() }/${ apiName }/${ recordId }/Attachments`,
      query: cleanupObject({
        attachments_category: this.#resolveChoice(
          category,
          ATTACHMENT_CATEGORY_MAP
        ),
      }),
      parts: [
        { name: 'file', value: buffer, fileName: finalName, contentType },
      ],
    })

    return response
  }

  /**
   * @operationName Attach Link As Attachment
   * @category Attachments
   * @description Saves a URL (LinkedIn profile, GitHub portfolio, Google Doc, video reel) as an attachment entry on a record without copying any bytes — Zoho stores the link itself. Use when you want the candidate's external resources discoverable from inside Zoho without duplicating the content.
   * @route POST /attach-link-as-attachment
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Module","name":"moduleName","required":true,"dictionary":"listModulesDict","description":"The module of the parent record."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"freeform":true,"description":"The parent record ID."}
   * @paramDef {"type":"String","label":"Attachment URL","name":"attachmentUrl","required":true,"description":"The link to attach."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Optional display title for the link."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"4150868000000567088"},"status":"success"}]}
   */
  async attachLinkAsAttachment(moduleName, recordId, attachmentUrl, title) {
    if (!attachmentUrl)
      throw new Error(
        '[Zoho Recruit][attachLinkAsAttachment] attachmentUrl is required'
      )

    const apiName = this.#resolveModuleApiName(moduleName)

    const response = await this.#apiRequest({
      logTag: 'attachLinkAsAttachment',
      method: 'post',
      url: `${ this.#recruitBase() }/${ apiName }/${ recordId }/Attachments`,
      query: cleanupObject({ attachmentUrl, title }),
    })

    return response
  }

  /**
   * @operationName Download Attachment
   * @category Attachments
   * @description Returns the bytes of an attachment file as base64, along with its filename, MIME type, and size. Use this to forward a candidate's resume or offer letter to another service (e-signature, parsing API, archival storage), or to mirror attachments into FlowRunner Files for in-app display.
   * @route POST /download-attachment
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Module","name":"moduleName","required":true,"dictionary":"listModulesDict","description":"The module of the parent record."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"freeform":true,"description":"The parent record ID."}
   * @paramDef {"type":"String","label":"Attachment ID","name":"attachmentId","required":true,"freeform":true,"description":"The attachment ID."}
   *
   * @returns {Object}
   * @sampleResult {"fileName":"jane-smith-resume.pdf","contentType":"application/pdf","contentBase64":"JVBERi0xLjQK...","sizeBytes":152314}
   */
  async downloadAttachment(moduleName, recordId, attachmentId) {
    const apiName = this.#resolveModuleApiName(moduleName)
    const url = `${ this.#recruitBase() }/${ apiName }/${ recordId }/Attachments/${ attachmentId }`

    // Raw fetch (not Flowrunner.Request) — we need Content-Type + Content-Disposition headers
    // to derive filename/MIME, and Flowrunner.Request only exposes the body.
    const httpResponse = await fetch(url, {
      headers: this.#getAuthHeader(),
    })

    if (!httpResponse.ok) {
      throw new Error(
        `[Zoho Recruit][downloadAttachment] HTTP ${ httpResponse.status } ${ httpResponse.statusText }`
      )
    }

    const buffer = Buffer.from(await httpResponse.arrayBuffer())
    const contentType =
      httpResponse.headers.get('content-type') || 'application/octet-stream'
    const cd = httpResponse.headers.get('content-disposition') || ''
    const cdMatch = cd.match(
      /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i
    )
    const fileName = cdMatch
      ? decodeURIComponent(cdMatch[1] || cdMatch[2])
      : `attachment-${ attachmentId }`

    return {
      fileName,
      contentType,
      contentBase64: buffer.toString('base64'),
      sizeBytes: buffer.length,
    }
  }

  /**
   * @operationName Delete Attachment
   * @category Attachments
   * @description Permanently removes a single attachment from a record. Use when replacing an outdated document (delete old, upload new) or removing a file uploaded in error. Deletion is not soft — the file cannot be recovered.
   * @route POST /delete-attachment
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Module","name":"moduleName","required":true,"dictionary":"listModulesDict","description":"The module of the parent record."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"freeform":true,"description":"The parent record ID."}
   * @paramDef {"type":"String","label":"Attachment ID","name":"attachmentId","required":true,"freeform":true,"description":"The attachment ID."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"4150868000000567077"},"status":"success"}]}
   */
  async deleteAttachment(moduleName, recordId, attachmentId) {
    const apiName = this.#resolveModuleApiName(moduleName)

    const response = await this.#apiRequest({
      logTag: 'deleteAttachment',
      method: 'delete',
      url: `${ this.#recruitBase() }/${ apiName }/${ recordId }/Attachments/${ attachmentId }`,
    })

    return response
  }

  // ============================================================================================
  // 10. TAGS
  // ============================================================================================

  /**
   * @operationName Add Tags To Records
   * @category Tags
   * @description Tags one or more records with one or more labels in a single call — useful for batch-classifying candidates ("Hot", "Reject", "Future Pool") or marking applications ("Needs Follow-up"). Tags are per-module: a "Hot" tag on Candidates is a separate object from "Hot" on Job Openings. Tag names that don't exist yet are created automatically by default; turn off Create Missing Tags to skip unknown names instead.
   * @route POST /add-tags-to-records
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Module","name":"moduleName","required":true,"dictionary":"listModulesDict","description":"The module of the records to tag."}
   * @paramDef {"type":"String","label":"Record IDs","name":"recordIds","required":true,"description":"Comma-separated list or array of record IDs (max 100)."}
   * @paramDef {"type":"String","label":"Tag Names","name":"tagNames","required":true,"description":"Comma-separated list or array of tag names."}
   * @paramDef {"type":"Boolean","label":"Create Missing Tags","name":"createNotMatching","uiComponent":{"type":"CHECKBOX"},"description":"When true (default), tag names that don't exist yet are created on the fly. When false, missing names are skipped."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"4150868000000567001"},"status":"success"}]}
   */
  async addTagsToRecords(moduleName, recordIds, tagNames, createNotMatching) {
    const apiName = this.#resolveModuleApiName(moduleName)
    const ids = toCommaList(recordIds)
    const tags = toCommaList(tagNames)

    if (!ids)
      throw new Error('[Zoho Recruit][addTagsToRecords] recordIds is required')
    if (!tags)
      throw new Error('[Zoho Recruit][addTagsToRecords] tagNames is required')

    const response = await this.#apiRequest({
      logTag: 'addTagsToRecords',
      method: 'post',
      url: `${ this.#recruitBase() }/${ apiName }/actions/add_tags`,
      query: cleanupObject({
        ids,
        tag_names: tags,
        over_write: 'false',
        create_not_matching_tag: String(createNotMatching !== false),
      }),
    })

    return response
  }

  /**
   * @operationName Remove Tags From Records
   * @category Tags
   * @description Strips one or more tags off one or more records in a single call. Use to reclassify candidates (e.g. remove "Cold" once they engage), clean up automation-applied tags after they've served their purpose, or undo a misapplied bulk-tag.
   * @route POST /remove-tags-from-records
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Module","name":"moduleName","required":true,"dictionary":"listModulesDict","description":"The module of the records."}
   * @paramDef {"type":"String","label":"Record IDs","name":"recordIds","required":true,"description":"Comma-separated list or array of record IDs (max 100)."}
   * @paramDef {"type":"String","label":"Tag Names","name":"tagNames","required":true,"description":"Comma-separated list or array of tag names to remove."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"4150868000000567001"},"status":"success"}]}
   */
  async removeTagsFromRecords(moduleName, recordIds, tagNames) {
    const apiName = this.#resolveModuleApiName(moduleName)
    const ids = toCommaList(recordIds)
    const tags = toCommaList(tagNames)

    if (!ids)
      throw new Error(
        '[Zoho Recruit][removeTagsFromRecords] recordIds is required'
      )
    if (!tags)
      throw new Error(
        '[Zoho Recruit][removeTagsFromRecords] tagNames is required'
      )

    const response = await this.#apiRequest({
      logTag: 'removeTagsFromRecords',
      method: 'post',
      url: `${ this.#recruitBase() }/${ apiName }/actions/remove_tags`,
      query: { ids, tag_names: tags },
    })

    return response
  }

  // ============================================================================================
  // 11. TASKS
  // ============================================================================================

  /**
   * @operationName Create Task
   * @category Tasks
   * @description Creates a follow-up to-do for a recruiter, optionally linked to a Candidate, Job Opening, or other parent record so the task shows up on that record's timeline. Use to drive recruiter actions from automations — "remind me to call this candidate in 3 days", "schedule reference checks after offer accepted", "review applications added today".
   * @route POST /create-task
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Task subject — what needs to be done."}
   * @paramDef {"type":"String","label":"Linked Module","name":"linkedModule","dictionary":"listModulesDict","description":"Optional module of the parent record this task belongs to."}
   * @paramDef {"type":"String","label":"Linked Record ID","name":"linkedRecordId","freeform":true,"description":"Optional ID of the parent record."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Optional due date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Not Started","In Progress","Completed","Waiting on Someone Else","Deferred"]}},"description":"Optional task status. Defaults to 'Not Started'."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Normal","High","Highest"]}},"description":"Optional task priority. Defaults to 'Normal'."}
   * @paramDef {"type":"String","label":"Owner User ID","name":"ownerUserId","dictionary":"listUsersDict","description":"Optional owner user ID. Defaults to the connected user."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional task description."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"4150868000000888001"},"status":"success"}]}
   */
  async createTask(
    subject,
    linkedModule,
    linkedRecordId,
    dueDate,
    status,
    priority,
    ownerUserId,
    description
  ) {
    if (!subject)
      throw new Error('[Zoho Recruit][createTask] subject is required')

    status = this.#resolveChoice(status, TASK_STATUS_MAP)

    const data =
      cleanupObject({
        Subject: subject,
        Due_Date: dueDate,
        Status: status,
        Priority: priority,
        Description: description,
        ...(linkedRecordId && linkedModule
          ? {
            $se_module: this.#resolveModuleApiName(linkedModule),
            What_Id: { id: linkedRecordId },
          }
          : {}),
        ...(ownerUserId ? { Owner: { id: ownerUserId } } : {}),
      }) || {}

    return this.createRecord('Tasks', data)
  }

  /**
   * @operationName List Tasks
   * @category Tasks
   * @description Pages through tasks, with optional status (Not Started / In Progress / Completed / etc.) and owner filters. Use to render a recruiter's daily to-do, surface overdue tasks for a manager dashboard, or flag tasks waiting on someone else.
   * @route POST /list-tasks
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Not Started","In Progress","Completed","Waiting on Someone Else","Deferred"]}},"description":"Optional status filter."}
   * @paramDef {"type":"String","label":"Owner User ID","name":"ownerUserId","dictionary":"listUsersDict","description":"Optional owner filter."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Which page of results to return (starting at 1). Combine with Page Size to walk through large result sets. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many records to return per page (max 200). Larger pages mean fewer API calls when paging through big result sets. Defaults to 50."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"4150868000000888001","Subject":"Phone screen Jane Smith","Status":"Not Started","Due_Date":"2026-05-12"}],"info":{"count":1,"more_records":false}}
   */
  async listTasks(status, ownerUserId, page, perPage) {
    status = this.#resolveChoice(status, TASK_STATUS_MAP)

    const clauses = []

    if (status)
      clauses.push({ field: 'Status', operator: 'equals', value: status })
    if (ownerUserId)
      clauses.push({ field: 'Owner', operator: 'equals', value: ownerUserId })

    if (clauses.length > 0) {
      return this.searchRecords(
        'Tasks',
        buildCriteria(clauses),
        null,
        null,
        null,
        page,
        perPage
      )
    }

    return this.listRecords(
      'Tasks',
      page,
      perPage,
      null,
      'Modified_Time',
      'desc'
    )
  }

  /**
   * @operationName Update Task
   * @category Tasks
   * @description Modifies one or more fields on an existing task. Most common uses: mark Status as "Completed" once an automation finishes the work, push the Due Date out when something gets rescheduled, or reassign the Owner when responsibilities shift. Only fields you supply are touched.
   * @route POST /update-task
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"freeform":true,"description":"The task ID to update."}
   * @paramDef {"type":"Object","label":"Field Values","name":"data","required":true,"freeform":true,"description":"Object whose keys are field names and whose values are the new values to set, e.g. { \"Status\": \"Completed\" } to mark the task done. Only the fields you supply are changed."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"4150868000000888001"},"status":"success"}]}
   */
  async updateTask(taskId, data) {
    return this.updateRecord('Tasks', taskId, data)
  }

  // ============================================================================================
  // 12. EMAIL
  // ============================================================================================

  /**
   * @operationName Send Email To Record
   * @category Email
   * @description Sends an email from the connected Zoho Recruit account and logs it on the record's email-history timeline so the conversation is visible to the recruiter team. Use to send candidate outreach, interview confirmations, offer letters, or rejection notices and have them tracked in Zoho automatically. Pass a Template ID to render a saved template (subject + content come from the template, merged with the record's fields); otherwise supply Subject + Content directly.
   * @route POST /send-email-to-record
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Module","name":"moduleName","required":true,"dictionary":"listModulesDict","description":"The module of the parent record (typically Candidates or Contacts)."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"freeform":true,"description":"The parent record ID."}
   * @paramDef {"type":"String","label":"To","name":"to","required":true,"description":"Comma-separated list or array of recipient email addresses."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Email subject line."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Email body. HTML allowed when Mail Format is html."}
   * @paramDef {"type":"String","label":"Mail Format","name":"mailFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["HTML","Plain Text"]}},"description":"Default HTML."}
   * @paramDef {"type":"String","label":"From Email","name":"fromEmail","description":"Optional sender address — must be a verified email on the connected user's Zoho account."}
   * @paramDef {"type":"String","label":"Cc","name":"cc","description":"Optional comma-separated CC list."}
   * @paramDef {"type":"String","label":"Bcc","name":"bcc","description":"Optional comma-separated BCC list."}
   * @paramDef {"type":"String","label":"Template ID","name":"templateId","freeform":true,"description":"Optional Zoho email template ID — when set, content is rendered via the template (subject/content from template merged with record fields)."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{},"status":"success"}]}
   */
  async sendEmailToRecord(
    moduleName,
    recordId,
    to,
    subject,
    content,
    mailFormat,
    fromEmail,
    cc,
    bcc,
    templateId
  ) {
    if (!recordId)
      throw new Error('[Zoho Recruit][sendEmailToRecord] recordId is required')
    if (!to)
      throw new Error('[Zoho Recruit][sendEmailToRecord] to is required')
    if (!subject)
      throw new Error('[Zoho Recruit][sendEmailToRecord] subject is required')
    if (!content && !templateId)
      throw new Error(
        '[Zoho Recruit][sendEmailToRecord] content or templateId is required'
      )

    const apiName = this.#resolveModuleApiName(moduleName)

    const mail = cleanupObject({
      to: toArray(to).map(email => ({ email })),
      cc: cc ? toArray(cc).map(email => ({ email })) : undefined,
      bcc: bcc ? toArray(bcc).map(email => ({ email })) : undefined,
      from: fromEmail ? { email: fromEmail } : undefined,
      subject,
      content,
      mail_format: this.#resolveChoice(mailFormat, MAIL_FORMAT_MAP) || 'html',
      template: templateId ? { id: templateId } : undefined,
    })

    const response = await this.#apiRequest({
      logTag: 'sendEmailToRecord',
      method: 'post',
      url: `${ this.#recruitBase() }/${ apiName }/${ recordId }/actions/send_mail`,
      body: { data: [mail] },
    })

    return response
  }

  // ============================================================================================
  // 13. METADATA ACTIONS (user-facing helpers, not dictionaries)
  // ============================================================================================

  /**
   * @operationName List All Modules
   * @category Metadata
   * @description Returns every record type (Candidates, Job Openings, Applications, plus any custom modules) defined in your Zoho Recruit org, including each one's internal name and human-friendly label. Use this to discover what modules exist before building actions that work generically across record types — for example, when an automation needs to enumerate all custom modules added by your administrators.
   * @route POST /list-modules-action
   * @appearanceColor #E42527 #F26C6F
   *
   * @returns {Object}
   * @sampleResult {"modules":[{"api_name":"Candidates","plural_label":"Candidates","singular_label":"Candidate","creatable":true,"editable":true,"deletable":true}]}
   */
  async listModulesAction() {
    const response = await this.#apiRequest({
      logTag: 'listModulesAction',
      url: `${ this.#recruitBase() }/settings/modules`,
    })

    return { modules: response?.modules || [] }
  }

  /**
   * @operationName List Module Fields
   * @category Metadata
   * @description Returns every field on a chosen module — its internal name, display label, data type, whether it's mandatory, and (for dropdowns) the allowed values. Use this before building Create Record or Update Record actions to learn which fields exist, which are required, and what values picklists accept — especially when working with custom fields your Zoho admins added.
   * @route POST /list-fields-action
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Module","name":"moduleName","required":true,"dictionary":"listModulesDict","description":"The module whose fields will be listed."}
   *
   * @returns {Object}
   * @sampleResult {"fields":[{"api_name":"Last_Name","field_label":"Last Name","data_type":"text","required":true}]}
   */
  async listFieldsAction(moduleName) {
    const apiName = this.#resolveModuleApiName(moduleName)

    const response = await this.#apiRequest({
      logTag: 'listFieldsAction',
      url: `${ this.#recruitBase() }/settings/fields`,
      query: { module: apiName },
    })

    return { fields: response?.fields || [] }
  }

  /**
   * @operationName List Module Layouts
   * @category Metadata
   * @description Returns the form layouts (page-layout variants) configured for a module — useful when an org has multiple intake forms (e.g. "Engineering Candidate" vs "Sales Candidate") and you want to assign new records to a specific layout. Use this to discover layout IDs before passing one to Create Record.
   * @route POST /list-layouts-action
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Module","name":"moduleName","required":true,"dictionary":"listModulesDict","description":"The module whose layouts will be listed."}
   *
   * @returns {Object}
   * @sampleResult {"layouts":[{"id":"4150868000000091001","name":"Standard","sections":[]}]}
   */
  async listLayoutsAction(moduleName) {
    const apiName = this.#resolveModuleApiName(moduleName)

    const response = await this.#apiRequest({
      logTag: 'listLayoutsAction',
      url: `${ this.#recruitBase() }/settings/layouts`,
      query: { module: apiName },
    })

    return { layouts: response?.layouts || [] }
  }

  /**
   * @operationName List Module Custom Views
   * @category Metadata
   * @description Returns the saved filtered views configured for a module (e.g. "All Open Candidates", "Hot Leads This Week"), plus Zoho's built-in system views. Use this to discover view IDs before passing one to List Records, so the action returns only records matching a recruiter-curated filter instead of the entire module.
   * @route POST /list-custom-views-action
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"Module","name":"moduleName","required":true,"dictionary":"listModulesDict","description":"The module whose custom views will be listed."}
   *
   * @returns {Object}
   * @sampleResult {"custom_views":[{"id":"4150868000000091045","name":"All Open Candidates","system_defined":true}]}
   */
  async listCustomViewsAction(moduleName) {
    const apiName = this.#resolveModuleApiName(moduleName)

    const response = await this.#apiRequest({
      logTag: 'listCustomViewsAction',
      url: `${ this.#recruitBase() }/settings/custom_views`,
      query: { module: apiName },
    })

    return { custom_views: response?.custom_views || [] }
  }

  /**
   * @operationName List Recruiters
   * @category Metadata
   * @description Returns the user accounts (recruiters, admins, hiring managers) in your Zoho Recruit org — names, emails, roles, and active/inactive status. Use this to discover user IDs for assigning record owners, scheduling interviews, or routing email-from addresses; or to audit who currently has access to the platform.
   * @route POST /list-users-action
   * @appearanceColor #E42527 #F26C6F
   *
   * @paramDef {"type":"String","label":"User Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["All Users","Active Users","Deactivated Users","Confirmed Users","Not Confirmed Users","Deleted Users","Active Confirmed Users","Admin Users","Active Confirmed Admins","Current User"]}},"description":"User listing scope. Default Active Users."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Which page of results to return (starting at 1). Combine with Page Size to walk through large result sets. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many users to return per page (max 200). Defaults to 50."}
   *
   * @returns {Object}
   * @sampleResult {"users":[{"id":"4150868000000341001","full_name":"Jane Recruiter","email":"jane@acme.com","role":{"name":"Recruiter"}}],"info":{"count":1,"more_records":false}}
   */
  async listUsersAction(type, page, perPage) {
    const response = await this.#apiRequest({
      logTag: 'listUsersAction',
      url: `${ this.#recruitBase() }/users`,
      query: cleanupObject({
        type: this.#resolveChoice(type, USER_TYPE_MAP) || 'ActiveUsers',
        page: page || 1,
        per_page: Math.min(perPage || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
      }),
    })

    return { users: response?.users || [], info: response?.info || {} }
  }

  /**
   * @operationName Get Org Info
   * @category Metadata
   * @description Returns the connected Zoho Recruit organization's profile — company name, primary email, license tier, and feature gates. Use this to confirm which org an automation is attached to, or to branch logic on edition (Free vs Standard vs Enterprise) when a feature is gated.
   * @route POST /get-org-info
   * @appearanceColor #E42527 #F26C6F
   *
   * @returns {Object}
   * @sampleResult {"org":[{"company_name":"Acme Recruiters","primary_email":"hr@acme.com","license_details":{"paid_type":"enterprise","users_license_purchased":10}}]}
   */
  async getOrgInfo() {
    const response = await this.#apiRequest({
      logTag: 'getOrgInfo',
      url: `${ this.#recruitBase() }/org`,
    })

    return { org: response?.org || [] }
  }

  // ============================================================================================
  // 14. REALTIME TRIGGERS — ZOHO RECRUIT NOTIFICATIONS API
  // ============================================================================================
  // Channel-based subscriptions on `/actions/watch` (POST=create, PATCH=update, DELETE=disable).
  // Two important quirks:
  //   - Channel expiry caps at ~24h. handleTriggerRefreshWebhook re-PATCHes well before that, and
  //     falls back to recreate-with-same-id if PATCH 400s on an already-expired channel.
  //   - Zoho does not HMAC-sign payloads. Each channel carries a `token` shared secret which is
  //     echoed back in the notification body verbatim — verify by exact-match.

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    const { events, webhookData, callbackUrl } = invocation
    const previousChannel = webhookData?.channel || null

    if (!Array.isArray(events) || events.length === 0) {
      if (previousChannel?.channelId) {
        await this.#deleteChannel(previousChannel.channelId)
      }

      return { webhookData: { channel: null } }
    }

    const wantedEvents = new Set()

    for (const trigger of events) {
      const def = REALTIME_TRIGGERS[trigger.name]

      if (!def) {
        logger.warn(
          `handleTriggerUpsertWebhook: unknown trigger=${ trigger.name }`
        )

        continue
      }

      for (const ev of def.events) wantedEvents.add(ev)
    }

    if (wantedEvents.size === 0) {
      if (previousChannel?.channelId)
        await this.#deleteChannel(previousChannel.channelId)

      return { webhookData: { channel: null } }
    }

    const channelId = previousChannel?.channelId || generateChannelId()
    const token = previousChannel?.token || generateNotificationToken()
    const channelExpiry = new Date(
      Date.now() + WEBHOOK_EXPIRY_MS
    ).toISOString()

    const watchPayload = [
      {
        channel_id: channelId,
        events: Array.from(wantedEvents),
        channel_expiry: channelExpiry,
        token,
        notify_url: callbackUrl,
      },
    ]

    const response = await this.#apiRequest({
      logTag: previousChannel?.channelId
        ? 'handleTriggerUpsertWebhook.update'
        : 'handleTriggerUpsertWebhook.create',
      method: previousChannel?.channelId ? 'patch' : 'post',
      url: `${ this.#recruitBase() }/actions/watch`,
      body: { watch: watchPayload },
    })

    logger.debug(
      `handleTriggerUpsertWebhook: channel=${ channelId } events=${ Array.from(wantedEvents).join(',') } expiry=${ channelExpiry }`
    )

    return {
      webhookData: {
        channel: {
          channelId,
          token,
          expiry: channelExpiry,
          events: Array.from(wantedEvents),
        },
        watchResponse: response,
      },
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerRefreshWebhook(invocation) {
    const { webhookData } = invocation
    const channel = webhookData?.channel

    if (!channel?.channelId) {
      logger.debug('handleTriggerRefreshWebhook: no channel to refresh')

      return { webhookData: webhookData || { channel: null } }
    }

    const newExpiry = new Date(Date.now() + WEBHOOK_EXPIRY_MS).toISOString()

    try {
      await this.#apiRequest({
        logTag: 'handleTriggerRefreshWebhook',
        method: 'patch',
        url: `${ this.#recruitBase() }/actions/watch`,
        body: {
          watch: [
            {
              channel_id: channel.channelId,
              channel_expiry: newExpiry,
            },
          ],
        },
      })

      logger.debug(
        `handleTriggerRefreshWebhook: channel=${ channel.channelId } extended to ${ newExpiry }`
      )

      return {
        webhookData: {
          channel: { ...channel, expiry: newExpiry },
        },
      }
    } catch (error) {
      // If the channel is already expired or missing on Zoho's side, we can't PATCH — fall back to
      // a fresh subscription with the same channel_id and re-add events.
      logger.warn(
        `handleTriggerRefreshWebhook: PATCH failed (${ error.message }), recreating`
      )

      try {
        await this.#apiRequest({
          logTag: 'handleTriggerRefreshWebhook.recreate',
          method: 'post',
          url: `${ this.#recruitBase() }/actions/watch`,
          body: {
            watch: [
              {
                channel_id: channel.channelId,
                events: channel.events,
                channel_expiry: newExpiry,
                token: channel.token,
                notify_url: invocation.callbackUrl,
              },
            ],
          },
        })

        return {
          webhookData: {
            channel: { ...channel, expiry: newExpiry },
          },
        }
      } catch (recreateError) {
        logger.error(
          `handleTriggerRefreshWebhook: recreate failed: ${ recreateError.message }`
        )

        throw recreateError
      }
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   */
  async handleTriggerDeleteWebhook(invocation) {
    const channel = invocation?.webhookData?.channel

    if (channel?.channelId) {
      await this.#deleteChannel(channel.channelId)
    }

    return { webhookData: { channel: null } }
  }

  async #deleteChannel(channelId) {
    try {
      await this.#apiRequest({
        logTag: 'deleteChannel',
        method: 'delete',
        url: `${ this.#recruitBase() }/actions/watch`,
        query: { channel_ids: channelId },
      })
    } catch (error) {
      logger.warn(
        `deleteChannel: failed for channel=${ channelId }: ${ error.message }`
      )
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    const body = invocation.body || {}
    const channel = invocation.webhookData?.channel

    if (!channel?.token) {
      logger.warn(
        'handleTriggerResolveEvents: missing channel/token in webhookData'
      )

      return { events: [] }
    }

    if (body.token !== channel.token) {
      logger.warn(
        `handleTriggerResolveEvents: token mismatch (expected=${ channel.token } got=${ body.token })`
      )

      return { events: [] }
    }

    // Notification envelope: {channel_id, token, ids, module, operation, ...}. `ids` is an array
    // (Recruit can batch — typically one id per notification, but delete sweeps may batch).
    const moduleName = body.module
    const operation = body.operation || body.event_type
    const ids = body.ids || body.affected_fields || []

    if (!moduleName || !operation) {
      logger.warn(
        `handleTriggerResolveEvents: missing module/operation in payload (module=${ moduleName }, op=${ operation })`
      )

      return { events: [] }
    }

    const eventName = `${ moduleName }.${ operation }`
    const triggerName = EVENT_TO_TRIGGER[eventName]

    if (!triggerName) {
      logger.debug(
        `handleTriggerResolveEvents: unsubscribed event=${ eventName }`
      )

      return { events: [] }
    }

    const idArray = Array.isArray(ids) ? ids : [ids].filter(Boolean)

    if (idArray.length === 0) {
      // Some Recruit operations (delete batch) ship only the ids field as a single string.
      return {
        events: [{ name: triggerName, data: body }],
      }
    }

    return {
      events: idArray.map(id => ({
        name: triggerName,
        data: { ...body, recordId: id },
      })),
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    // Notifications are org-scoped, not record-scoped — every active trigger gets every event.
    const { triggers } = invocation

    return { ids: (triggers || []).map(t => t.id) }
  }

  /**
   * @operationName On Candidate Created (Realtime)
   * @category Event Tracking
   * @description Fires within seconds whenever a new candidate is added to your Zoho Recruit org — manually, via API, or by parsing a resume. Use this to kick off downstream workflows the moment a candidate appears: send a welcome email, push to an enrichment service, notify a Slack channel, sync to your data warehouse.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-candidate-created-rt
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"module":"Candidates","operation":"create","ids":["4150868000000567001"],"recordId":"4150868000000567001"}
   */
  async onCandidateCreatedRT(invocation) {
    return invocation.body
  }

  /**
   * @operationName On Candidate Updated (Realtime)
   * @category Event Tracking
   * @description Fires within seconds whenever any field on any candidate is edited. Use to mirror candidate edits to external systems (CRM, data warehouse), re-trigger enrichment when key fields change, or notify a recruiter when "their" candidate has new info. Note: fires for every edit including bulk updates — add filters in your flow if you only care about specific field changes.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-candidate-updated-rt
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"module":"Candidates","operation":"edit","ids":["4150868000000567001"],"recordId":"4150868000000567001"}
   */
  async onCandidateUpdatedRT(invocation) {
    return invocation.body
  }

  /**
   * @operationName On Candidate Deleted (Realtime)
   * @category Event Tracking
   * @description Fires within seconds whenever a candidate is deleted (including soft-deletes that go to the Recycle Bin). Use to mirror deletions to downstream systems, satisfy GDPR right-to-erasure pipelines, or audit who's pruning the database.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-candidate-deleted-rt
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"module":"Candidates","operation":"delete","ids":["4150868000000567001"],"recordId":"4150868000000567001"}
   */
  async onCandidateDeletedRT(invocation) {
    return invocation.body
  }

  /**
   * @operationName On Job Opening Created (Realtime)
   * @category Event Tracking
   * @description Fires within seconds whenever a new requisition is opened. Use to auto-publish to a careers page or job-board aggregator, notify a Slack channel that a new role is live, or kick off a sourcing automation that finds candidates matching the job description.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-job-opening-created-rt
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"module":"JobOpenings","operation":"create","ids":["4150868000000789001"],"recordId":"4150868000000789001"}
   */
  async onJobOpeningCreatedRT(invocation) {
    return invocation.body
  }

  /**
   * @operationName On Job Opening Updated (Realtime)
   * @category Event Tracking
   * @description Fires within seconds whenever any field on any Job Opening is edited. Most useful for status transitions (In-progress → On Hold → Filled) — pair with a status check inside your flow to drive lifecycle automations like un-publishing a filled role, archiving applications, or alerting the hiring manager.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-job-opening-updated-rt
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"module":"JobOpenings","operation":"edit","ids":["4150868000000789001"],"recordId":"4150868000000789001"}
   */
  async onJobOpeningUpdatedRT(invocation) {
    return invocation.body
  }

  /**
   * @operationName On Application Created (Realtime)
   * @category Event Tracking
   * @description Fires within seconds whenever a candidate is associated with a Job Opening (Application record created). Use to greet new applicants automatically, kick off a screening assessment, schedule a phone-screen invite, or notify the hiring manager that someone entered the pipeline.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-application-created-rt
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"module":"Applications","operation":"create","ids":["4150868000000812001"],"recordId":"4150868000000812001"}
   */
  async onApplicationCreatedRT(invocation) {
    return invocation.body
  }

  /**
   * @operationName On Application Updated (Realtime)
   * @category Event Tracking
   * @description Fires within seconds whenever any field on an Application changes. The flagship use case is tracking pipeline stage transitions ("In-process" → "Interview" → "Offer" → "Hired") — branch on the new Status to send stage-specific emails, create reminders, or update analytics dashboards.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-application-updated-rt
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"module":"Applications","operation":"edit","ids":["4150868000000812001"],"recordId":"4150868000000812001"}
   */
  async onApplicationUpdatedRT(invocation) {
    return invocation.body
  }

  /**
   * @operationName On Interview Created (Realtime)
   * @category Event Tracking
   * @description Fires within seconds whenever a new interview is scheduled. Use to push the event to interviewer calendars (Google / Outlook), send candidate confirmation emails with prep info, generate a Zoom link, or post the schedule to a private Slack channel.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-interview-created-rt
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"module":"Interviews","operation":"create","ids":["4150868000000900001"],"recordId":"4150868000000900001"}
   */
  async onInterviewCreatedRT(invocation) {
    return invocation.body
  }

  /**
   * @operationName On Interview Updated (Realtime)
   * @category Event Tracking
   * @description Fires within seconds whenever any field on an Interview changes — typical events are reschedules (DateTime change), cancellations (Status change), and feedback being recorded after the fact. Use to keep external calendars in sync, send "your interview was rescheduled" notifications, or push feedback into a hiring-decision dashboard.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-interview-updated-rt
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"module":"Interviews","operation":"edit","ids":["4150868000000900001"],"recordId":"4150868000000900001"}
   */
  async onInterviewUpdatedRT(invocation) {
    return invocation.body
  }

  // ============================================================================================
  // 15. POLLING TRIGGERS
  // ============================================================================================
  // High-water-mark on Modified_Time, ascending. First run seeds the cursor without emitting
  // historical rows; subsequent runs fetch strictly-newer records so simultaneous-timestamp
  // bursts don't get lost across boundaries.

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    return this[invocation.eventName](invocation)
  }

  async #pollByModified({ logTag, moduleName, cursor, extraCriteriaClauses }) {
    const events = []
    let nextCursor = cursor
    let page = 1

    while (page <= POLLING_MAX_PAGES) {
      const clauses = [...(extraCriteriaClauses || [])]

      if (cursor) {
        clauses.push({
          field: 'Modified_Time',
          operator: 'greater_than',
          value: cursor,
        })
      }

      const useSearch = clauses.length > 0
      const url = useSearch
        ? `${ this.#recruitBase() }/${ moduleName }/search`
        : `${ this.#recruitBase() }/${ moduleName }`

      const query = cleanupObject({
        page,
        per_page: MAX_PAGE_SIZE,
        sort_by: 'Modified_Time',
        sort_order: 'asc',
        ...(useSearch ? { criteria: buildCriteria(clauses) } : {}),
      })

      let records = []

      try {
        const response = await this.#apiRequest({ logTag, url, query })

        records = response?.data || []

        for (const record of records) {
          const modAt = record.Modified_Time

          if (!cursor || (modAt && modAt > cursor)) {
            events.push(record)

            if (modAt && (!nextCursor || modAt > nextCursor)) {
              nextCursor = modAt
            }
          }
        }

        if (response?.info?.more_records !== true) break

        page++
      } catch (error) {
        if (error.message && /204/.test(error.message)) break
        throw error
      }
    }

    return { events, nextCursor: nextCursor || cursor }
  }

  async #runPollingTrigger(
    invocation,
    { eventName, moduleName, extraCriteriaClauses }
  ) {
    if (invocation.learningMode) {
      const url = `${ this.#recruitBase() }/${ moduleName }`

      const response = await this.#apiRequest({
        logTag: `${ eventName }.learning`,
        url,
        query: {
          page: 1,
          per_page: 1,
          sort_by: 'Modified_Time',
          sort_order: 'desc',
        },
      }).catch(() => null)

      const sample = response?.data?.[0]

      return { events: sample ? [sample] : [], state: null }
    }

    const cursor = invocation.state?.lastModifiedAt

    if (!cursor) {
      // First run: anchor cursor at the latest existing record so historical rows aren't replayed.
      const url = `${ this.#recruitBase() }/${ moduleName }`

      const response = await this.#apiRequest({
        logTag: `${ eventName }.seed`,
        url,
        query: {
          page: 1,
          per_page: 1,
          sort_by: 'Modified_Time',
          sort_order: 'desc',
        },
      }).catch(() => null)

      const sample = response?.data?.[0]
      const seedTime = sample?.Modified_Time || new Date().toISOString()

      return { events: [], state: { lastModifiedAt: seedTime } }
    }

    const { events, nextCursor } = await this.#pollByModified({
      logTag: eventName,
      moduleName,
      cursor,
      extraCriteriaClauses,
    })

    return {
      events: events.map(data => ({ name: eventName, data })),
      state: { lastModifiedAt: nextCursor },
    }
  }

  /**
   * @operationName On New Or Updated Candidate (Polling)
   * @category Event Tracking
   * @description Checks the Candidates module on a schedule (you set the cadence) and fires once per candidate created or modified since the last poll. Use this when you need a polling alternative to the realtime trigger — simpler to debug, no webhook setup, but with intrinsic latency equal to your poll interval. Same payload shape as the realtime version, so flow logic is interchangeable.
   * @registerAs POLLING_TRIGGER
   * @route POST /on-new-or-updated-candidate
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"id":"4150868000000567001","Last_Name":"Smith","First_Name":"Jane","Email":"jane@acme.com","Modified_Time":"2026-05-10T14:00:00-04:00"}
   */
  async onNewOrUpdatedCandidate(invocation) {
    return this.#runPollingTrigger(invocation, {
      eventName: 'onNewOrUpdatedCandidate',
      moduleName: 'Candidates',
    })
  }

  /**
   * @operationName On New Or Updated Job Opening (Polling)
   * @category Event Tracking
   * @description Checks the Job Openings module on a schedule and fires once per requisition created or modified since the last poll. Use when polling fits your latency tolerance and you'd rather avoid webhook subscription state. Same payload shape as the realtime version.
   * @registerAs POLLING_TRIGGER
   * @route POST /on-new-or-updated-job-opening
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"id":"4150868000000789001","Posting_Title":"Senior Backend Engineer","Job_Opening_Status":"In-progress","Modified_Time":"2026-05-10T14:00:00-04:00"}
   */
  async onNewOrUpdatedJobOpening(invocation) {
    return this.#runPollingTrigger(invocation, {
      eventName: 'onNewOrUpdatedJobOpening',
      moduleName: 'JobOpenings',
    })
  }

  /**
   * @operationName On New Or Updated Application (Polling)
   * @category Event Tracking
   * @description Checks the Applications module on a schedule and fires once per Application created or modified since the last poll. Most often used to track pipeline-stage movement when realtime webhooks aren't desired. Same payload shape as the realtime version.
   * @registerAs POLLING_TRIGGER
   * @route POST /on-new-or-updated-application
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"id":"4150868000000812001","Status":"Interview","Modified_Time":"2026-05-10T14:00:00-04:00"}
   */
  async onNewOrUpdatedApplication(invocation) {
    return this.#runPollingTrigger(invocation, {
      eventName: 'onNewOrUpdatedApplication',
      moduleName: 'Applications',
    })
  }

  /**
   * @operationName On New Or Updated Interview (Polling)
   * @category Event Tracking
   * @description Checks the Interviews module on a schedule and fires once per interview created or modified since the last poll. Use for calendar sync, reminder dispatch, or feedback-collection automations when realtime webhooks aren't desired. Same payload shape as the realtime version.
   * @registerAs POLLING_TRIGGER
   * @route POST /on-new-or-updated-interview
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"id":"4150868000000900001","Interview_Name":"Jane Smith — System Design","Start_DateTime":"2026-05-12T10:00:00-04:00"}
   */
  async onNewOrUpdatedInterview(invocation) {
    return this.#runPollingTrigger(invocation, {
      eventName: 'onNewOrUpdatedInterview',
      moduleName: 'Interviews',
    })
  }

  // ============================================================================================
  // 16. SAMPLE RESULT LOADERS
  // ============================================================================================
  // Module-aware sample shapes for the Records APIs — UI shows the right mock for the picked module.

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @paramDef {"type":"Object","label":"params","name":"params"}
   * @returns {Object}
   */
  async getRecord_SampleResultLoader(params) {
    const moduleName =
      params?.criteria?.moduleName || params?.moduleName || 'Candidates'

    return MODULE_SAMPLE_SHAPES[moduleName] || MODULE_SAMPLE_SHAPES.Candidates
  }

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @paramDef {"type":"Object","label":"params","name":"params"}
   * @returns {Object}
   */
  async listRecords_SampleResultLoader(params) {
    const moduleName =
      params?.criteria?.moduleName || params?.moduleName || 'Candidates'
    const sample =
      MODULE_SAMPLE_SHAPES[moduleName] || MODULE_SAMPLE_SHAPES.Candidates

    return {
      data: [sample],
      info: { count: 1, more_records: false, page: 1, per_page: 50 },
    }
  }

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @paramDef {"type":"Object","label":"params","name":"params"}
   * @returns {Object}
   */
  async searchRecords_SampleResultLoader(params) {
    const moduleName =
      params?.criteria?.moduleName || params?.moduleName || 'Candidates'
    const sample =
      MODULE_SAMPLE_SHAPES[moduleName] || MODULE_SAMPLE_SHAPES.Candidates

    return {
      data: [sample],
      info: { count: 1, more_records: false, page: 1, per_page: 50 },
    }
  }
}

// =================================================================================================
// SAMPLE SHAPES BY MODULE — used by SAMPLE_RESULT_LOADER methods
// =================================================================================================

const MODULE_SAMPLE_SHAPES = {
  Candidates: {
    id: '4150868000000567001',
    Last_Name: 'Smith',
    First_Name: 'Jane',
    Email: 'jane.smith@acme.com',
    Phone: '+1-555-1234',
    Current_Job_Title: 'Senior Engineer',
    Current_Employer: 'Globex Corp',
    Source: 'LinkedIn',
    Owner: { id: '4150868000000341001', name: 'Jane Recruiter' },
    Created_Time: '2026-05-10T14:00:00-04:00',
    Modified_Time: '2026-05-10T14:00:00-04:00',
  },
  JobOpenings: {
    id: '4150868000000789001',
    Posting_Title: 'Senior Backend Engineer',
    Job_Opening_Name: 'JOB-2026-001',
    Job_Opening_Status: 'In-progress',
    Number_of_Positions: 2,
    Job_Type: 'Full-Time',
    City: 'San Francisco',
    Country: 'USA',
    Industry: 'Software',
    Created_Time: '2026-05-10T14:00:00-04:00',
    Modified_Time: '2026-05-10T14:00:00-04:00',
  },
  Applications: {
    id: '4150868000000812001',
    Name: 'Jane Smith — Senior Backend Engineer',
    Candidate_Id: { id: '4150868000000567001', name: 'Jane Smith' },
    Job_Opening_Id: {
      id: '4150868000000789001',
      name: 'Senior Backend Engineer',
    },
    Status: 'In-process',
    Modified_Time: '2026-05-10T14:00:00-04:00',
  },
  Interviews: {
    id: '4150868000000900001',
    Interview_Name: 'Jane Smith — System Design',
    Candidate_Id: { id: '4150868000000567001', name: 'Jane Smith' },
    Job_Opening_Id: {
      id: '4150868000000789001',
      name: 'Senior Backend Engineer',
    },
    Start_DateTime: '2026-05-12T10:00:00-04:00',
    End_DateTime: '2026-05-12T11:00:00-04:00',
    Interview_Type: 'Online',
    Modified_Time: '2026-05-10T14:00:00-04:00',
  },
  Contacts: {
    id: '4150868000000401001',
    Last_Name: 'Doe',
    First_Name: 'John',
    Email: 'john.doe@client.com',
    Account_Name: { id: '4150868000000300001', name: 'Acme Inc' },
    Modified_Time: '2026-05-10T14:00:00-04:00',
  },
  Accounts: {
    id: '4150868000000300001',
    Account_Name: 'Acme Inc',
    Industry: 'Software',
    Phone: '+1-555-9999',
    Modified_Time: '2026-05-10T14:00:00-04:00',
  },
  Tasks: {
    id: '4150868000000888001',
    Subject: 'Phone screen Jane Smith',
    Status: 'Not Started',
    Priority: 'Normal',
    Due_Date: '2026-05-12',
    Modified_Time: '2026-05-10T14:00:00-04:00',
  },
}

// =================================================================================================
// SERVICE REGISTRATION
// =================================================================================================

Flowrunner.ServerCode.addService(ZohoRecruitService, [
  {
    displayName: 'Client ID',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth 2.0 Client ID issued by the Zoho API Console (https://api-console.zoho.com).',
  },
  {
    displayName: 'Client Secret',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth 2.0 Client Secret issued by the Zoho API Console alongside the Client ID.',
  },
  {
    displayName: 'Data Center',
    name: 'dataCenter',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    required: false,
    shared: false,
    defaultValue: 'US',
    options: ['US', 'EU', 'IN', 'AU', 'JP', 'CA', 'CN', 'SA'],
    hint: 'Default Zoho data center for the initial OAuth redirect. Multi-DC clients are auto-detected via accounts-server returned during the callback.',
  },
  {
    displayName: 'Default Module',
    name: 'defaultModule',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    defaultValue: 'Candidates',
    hint: 'Module API name used by universal Records actions when no Module parameter is provided. Defaults to Candidates.',
  },
])
