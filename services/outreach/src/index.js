// Outreach sales-engagement integration: prospects, accounts, sequences, tasks,
// calls, opportunities, templates/snippets, and realtime webhook triggers.

const crypto = require('crypto')

// ============================================================================
//  CONSTANTS
// ============================================================================
const API_BASE = 'https://api.outreach.io/api/v2'
const OAUTH_AUTHORIZE_URL = 'https://api.outreach.io/oauth/authorize'
const OAUTH_TOKEN_URL = 'https://api.outreach.io/oauth/token'
const JSON_API_CONTENT_TYPE = 'application/vnd.api+json'

// Scopes requested at connect time - only what the shipped methods use.
const DEFAULT_SCOPE_LIST = [
  'prospects.all',
  'accounts.all',
  'sequences.read',
  'sequenceStates.all',
  'sequenceSteps.read',
  'mailings.read',
  'mailboxes.read',
  'templates.all',
  'snippets.all',
  'tasks.all',
  'calls.all',
  'opportunities.all',
  'stages.read',
  'users.read',
  'webhooks.all',
]
const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

// Maps each REALTIME trigger method to the Outreach webhook (resource, action) it subscribes to.
const TRIGGER_WEBHOOKS = {
  onProspectCreated: { resource: 'prospect', action: 'created' },
  onProspectUpdated: { resource: 'prospect', action: 'updated' },
  onAccountCreated: { resource: 'account', action: 'created' },
  onTaskCreated: { resource: 'task', action: 'created' },
  onTaskCompleted: { resource: 'task', action: 'completed' },
  onOpportunityCreated: { resource: 'opportunity', action: 'created' },
  onOpportunityUpdated: { resource: 'opportunity', action: 'updated' },
  onCallCreated: { resource: 'call', action: 'created' },
  onMailingCreated: { resource: 'mailing', action: 'created' },
}

const ERROR_HINTS = {
  401: 'Reconnect your Outreach account — the connection has expired or is invalid.',
  403: 'Access denied — the connected Outreach user lacks permission for this action.',
  404: 'Not found — the ID may be wrong; use the matching picker to choose a valid one.',
  422: 'Outreach rejected the request — check the field values.',
  429: 'Rate limit hit — retry in a moment.',
}

// Friendly DROPDOWN label -> Outreach API value maps (labels are shown in the UI; values are sent to the API).
const SHARE_TYPE_MAP = { Private: 'private', 'Shared with team': 'shared' }
const TASK_ACTION_MAP = {
  'To-do / action item': 'action_item',
  Call: 'call',
  Email: 'email',
  'In-person meeting': 'in_person',
}
const TASK_STATE_MAP = { Incomplete: 'incomplete', Completed: 'completed', Skipped: 'skipped' }
const CALL_DIRECTION_MAP = { Inbound: 'inbound', Outbound: 'outbound' }

// ============================================================================
//  LOGGER
// ============================================================================
const logger = {
  info: (...args) => console.log('[Outreach] info:', ...args),
  debug: (...args) => console.log('[Outreach] debug:', ...args),
  error: (...args) => console.log('[Outreach] error:', ...args),
  warn: (...args) => console.log('[Outreach] warn:', ...args),
}

// ============================================================================
//  DICTIONARY PAYLOAD TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} getProspectsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter prospects by email."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getAccountsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter accounts by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getSequencesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter sequences by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getMailboxesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter mailboxes by email."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getUsersDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter users by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getStagesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter stages by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getTagsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter tags by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getTemplatesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter templates by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getSnippetsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter snippets by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getTasksDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text (unused; tasks have no name)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getCallsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text (unused; calls have no name)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getOpportunitiesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter opportunities by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getSequenceStatesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text (unused; enrollments have no name)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @integrationName Outreach
 * @integrationIcon /icon.png
 * @requireOAuth
 * @integrationTriggersScope SINGLE_APP
 */
class Outreach {
  constructor(config) {
    this.config = config || {}
    this.clientId = this.config.clientId
    this.clientSecret = this.config.clientSecret
  }

  // ==========================================================================
  //  CORE - every external call goes through #apiRequest
  // ==========================================================================
  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'

    try {
      logger.debug(`${ logTag } ${ method.toUpperCase() } ${ url }`)

      const request = Flowrunner.Request[method](url)
        .set(this.#headers())
        .query(query || {})

      if (body !== undefined) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      this.#handleError(error, logTag)
    }
  }

  #headers() {
    return {
      Authorization: `Bearer ${ this.#getAccessToken() }`,
      'Content-Type': JSON_API_CONTENT_TYPE,
    }
  }

  #handleError(error, logTag) {
    const status = error?.status || error?.body?.status || error?.code
    const apiMessage =
      error?.body?.errors?.[0]?.detail ||
      error?.body?.errors?.[0]?.title ||
      error?.body?.message ||
      error?.message ||
      'Request failed'
    const hint = ERROR_HINTS[status]

    logger.error(`${ logTag } failed: ${ apiMessage }`)

    throw new Error(hint ? `${ hint } (${ apiMessage })` : apiMessage)
  }

  // Splits an Array<String> param that may also arrive as a comma-separated string.
  #toList(value) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    const list = Array.isArray(value)
      ? value
      : String(value).split(',').map(part => part.trim()).filter(Boolean)

    return list.length ? list : undefined
  }

  // Assigns a value into a target object only when it is meaningfully set.
  #set(target, key, value) {
    if (value !== undefined && value !== null && value !== '') {
      target[key] = value
    }
  }

  // Maps a friendly DROPDOWN label to its Outreach API value; passes through anything unmapped.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Builds a JSON:API relationship object: { type, data: { type, id } }.
  #relationship(type, id) {
    return { data: { type, id } }
  }

  // Builds the standard list query: page[size] (+ page[after] cursor) and any extra params.
  #listQuery(pageSize, cursor, extra) {
    const query = { 'page[size]': pageSize || 50, ...(extra || {}) }

    this.#set(query, 'page[after]', cursor)

    return query
  }

  // ==========================================================================
  //  OAUTH2 SYSTEM METHODS
  // ==========================================================================
  #getAccessToken() {
    return this.request.headers['oauth-access-token']
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   */
  async getOAuth2ConnectionURL() {
    // API: https://developers.outreach.io/api/oauth/
    // redirect_uri is injected by the FlowRunner platform - do NOT append it here.
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      scope: DEFAULT_SCOPE_STRING,
    })

    return `${ OAUTH_AUTHORIZE_URL }?${ params.toString() }`
  }

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   */
  async executeCallback(callbackObject) {
    // API: https://developers.outreach.io/api/oauth/
    const tokenResponse = await Flowrunner.Request.post(OAUTH_TOKEN_URL)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: callbackObject.code,
          client_id: this.clientId,
          client_secret: this.clientSecret,
          redirect_uri: callbackObject.redirectURI,
        }).toString()
      )

    let identityName = null

    try {
      const usersResponse = await Flowrunner.Request.get(`${ API_BASE }/users`)
        .set({ Authorization: `Bearer ${ tokenResponse.access_token }`, 'Content-Type': JSON_API_CONTENT_TYPE })
        .query({ 'page[size]': 1 })

      const user = usersResponse?.data?.[0]?.attributes

      identityName = user?.email || (user ? `${ user.firstName || '' } ${ user.lastName || '' }`.trim() : null) || null
    } catch (error) {
      logger.warn(`executeCallback: could not resolve connected user identity: ${ error?.message }`)
    }

    return {
      token: tokenResponse.access_token,
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token,
      connectionIdentityName: identityName,
      connectionIdentityImageURL: '',
      overwrite: true,
    }
  }

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   */
  async refreshToken(refreshToken) {
    // API: https://developers.outreach.io/api/oauth/
    const tokenResponse = await Flowrunner.Request.post(OAUTH_TOKEN_URL)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: this.clientId,
          client_secret: this.clientSecret,
        }).toString()
      )

    return {
      token: tokenResponse.access_token,
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token,
    }
  }

  // ==========================================================================
  //  PROSPECTS
  // ==========================================================================
  /**
   * @operationName Create Prospect
   * @category Prospects
   * @description Creates a new prospect (a person you sell to) in Outreach with their name, email, job title, and optional Account, owner, and tags. Use this to add a lead captured elsewhere into Outreach before enrolling them in a sequence.
   * @route POST /create-prospect
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"The prospect's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"The prospect's last name."}
   * @paramDef {"type":"Array<String>","label":"Email Addresses","name":"emails","required":true,"description":"One or more email addresses. Accepts a list or a comma-separated string."}
   * @paramDef {"type":"String","label":"Job Title","name":"title","description":"The prospect's job title."}
   * @paramDef {"type":"String","label":"Company Name","name":"company","description":"Company name (free text). To link a managed Account, set Account instead."}
   * @paramDef {"type":"String","label":"Account","name":"accountId","dictionary":"getAccountsDictionary","description":"Link this prospect to an existing Account. Pick one with the Account picker."}
   * @paramDef {"type":"String","label":"Owner","name":"ownerId","dictionary":"getUsersDictionary","description":"The Outreach user who owns this prospect."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","dictionary":"getTagsDictionary","description":"Tags to apply. Accepts a list or comma-separated string."}
   * @returns {Object}
   * @sampleResult {"data":{"type":"prospect","id":"123","attributes":{"firstName":"John","lastName":"Doe","emails":["john@acme.com"],"title":"VP Sales","tags":["lead"]}}}
   */
  async createProspect(firstName, lastName, emails, title, company, accountId, ownerId, tags) {
    // API: https://developers.outreach.io/api/making-requests/  (shared JSON:API POST /prospects envelope)
    const attributes = {}

    this.#set(attributes, 'firstName', firstName)
    this.#set(attributes, 'lastName', lastName)
    this.#set(attributes, 'emails', this.#toList(emails))
    this.#set(attributes, 'title', title)
    this.#set(attributes, 'company', company)
    this.#set(attributes, 'tags', this.#toList(tags))

    const relationships = {}

    this.#set(relationships, 'account', accountId ? this.#relationship('account', accountId) : undefined)
    this.#set(relationships, 'owner', ownerId ? this.#relationship('user', ownerId) : undefined)

    const data = { type: 'prospect', attributes }

    if (Object.keys(relationships).length) {
      data.relationships = relationships
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/prospects`,
      method: 'post',
      body: { data },
      logTag: 'createProspect',
    })
  }

  /**
   * @operationName Get Prospect
   * @category Prospects
   * @description Retrieves a single prospect by ID, returning their full profile - name, emails, title, tags, and relationships. Use this to inspect a prospect before updating or enrolling them.
   * @route POST /get-prospect
   * @paramDef {"type":"String","label":"Prospect","name":"prospectId","required":true,"dictionary":"getProspectsDictionary","description":"The prospect to retrieve. Pick from your Outreach prospects."}
   * @returns {Object}
   * @sampleResult {"data":{"type":"prospect","id":"123","attributes":{"firstName":"John","lastName":"Doe","emails":["john@acme.com"],"title":"VP Sales"}}}
   */
  async getProspect(prospectId) {
    return await this.#apiRequest({
      url: `${ API_BASE }/prospects/${ prospectId }`,
      logTag: 'getProspect',
    })
  }

  /**
   * @operationName List Prospects
   * @category Prospects
   * @description Returns a page of prospects, optionally filtered by an exact email match. Use this to browse prospects or to find one to feed into a later action; pass the returned cursor to page through results.
   * @route POST /list-prospects
   * @paramDef {"type":"String","label":"Filter by Email","name":"filterEmail","description":"Return only prospects matching this exact email."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":50,"description":"How many prospects per page (max 100). Default: 50."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"The cursor from a previous response's next link; leave blank for the first page."}
   * @returns {Object}
   * @sampleResult {"data":[{"type":"prospect","id":"123","attributes":{"firstName":"John","emails":["john@acme.com"]}}],"links":{"next":"https://api.outreach.io/api/v2/prospects?page[after]=200"}}
   */
  async listProspects(filterEmail, pageSize, cursor) {
    const extra = {}

    this.#set(extra, 'filter[emails]', filterEmail)

    return await this.#apiRequest({
      url: `${ API_BASE }/prospects`,
      query: this.#listQuery(pageSize, cursor, extra),
      logTag: 'listProspects',
    })
  }

  /**
   * @operationName Update Prospect
   * @category Prospects
   * @description Updates a prospect's name, title, or owner. Leave a field blank to keep its current value. Use this to enrich or correct a prospect's details.
   * @route POST /update-prospect
   * @paramDef {"type":"String","label":"Prospect","name":"prospectId","required":true,"dictionary":"getProspectsDictionary","description":"The prospect to update."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"New first name (leave blank to keep current)."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"New last name."}
   * @paramDef {"type":"String","label":"Job Title","name":"title","description":"New job title."}
   * @paramDef {"type":"String","label":"Owner","name":"ownerId","dictionary":"getUsersDictionary","description":"Reassign the owning Outreach user."}
   * @returns {Object}
   * @sampleResult {"data":{"type":"prospect","id":"123","attributes":{"firstName":"Sal","lastName":"Doe"}}}
   */
  async updateProspect(prospectId, firstName, lastName, title, ownerId) {
    // API: https://developers.outreach.io/api/making-requests/  (shared JSON:API PATCH /prospects/{id} envelope)
    const attributes = {}

    this.#set(attributes, 'firstName', firstName)
    this.#set(attributes, 'lastName', lastName)
    this.#set(attributes, 'title', title)

    const data = { type: 'prospect', id: prospectId, attributes }

    if (ownerId) {
      data.relationships = { owner: this.#relationship('user', ownerId) }
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/prospects/${ prospectId }`,
      method: 'patch',
      body: { data },
      logTag: 'updateProspect',
    })
  }

  /**
   * @operationName Delete Prospect
   * @category Prospects
   * @description Permanently deletes a prospect from Outreach. This cannot be undone. Use with care - it removes the person and their activity from your Outreach data.
   * @route POST /delete-prospect
   * @paramDef {"type":"String","label":"Prospect","name":"prospectId","required":true,"dictionary":"getProspectsDictionary","description":"The prospect to permanently delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":"123"}
   */
  async deleteProspect(prospectId) {
    // API: https://developers.outreach.io/api/reference/tag/Prospect/  (DELETE /prospects/{id})
    await this.#apiRequest({
      url: `${ API_BASE }/prospects/${ prospectId }`,
      method: 'delete',
      logTag: 'deleteProspect',
    })

    return { deleted: true, id: prospectId }
  }

  /**
   * @operationName Add Prospect Tags
   * @category Prospects
   * @description Adds one or more tags to a prospect, merging them with the prospect's existing tags. Use this to label prospects (for example "vip" or "webinar-2026") for segmentation.
   * @route POST /add-prospect-tag
   * @paramDef {"type":"String","label":"Prospect","name":"prospectId","required":true,"dictionary":"getProspectsDictionary","description":"The prospect to tag."}
   * @paramDef {"type":"Array<String>","label":"Tags to Add","name":"tags","required":true,"dictionary":"getTagsDictionary","description":"Tags to add (merged with existing tags). List or comma-separated."}
   * @returns {Object}
   * @sampleResult {"data":{"type":"prospect","id":"123","attributes":{"tags":["lead","vip"]}}}
   */
  async addProspectTag(prospectId, tags) {
    // API: https://developers.outreach.io/api/making-requests/  (shared PATCH envelope; tags is an array attribute)
    const toAdd = this.#toList(tags) || []
    const merged = await this.#mergedTags(prospectId, current => Array.from(new Set([...current, ...toAdd])))

    return await this.#patchProspectTags(prospectId, merged)
  }

  /**
   * @operationName Remove Prospect Tags
   * @category Prospects
   * @description Removes one or more tags from a prospect, keeping the rest. Use this to clean up labels - for example to take a prospect out of a tagged segment.
   * @route POST /remove-prospect-tag
   * @paramDef {"type":"String","label":"Prospect","name":"prospectId","required":true,"dictionary":"getProspectsDictionary","description":"The prospect to untag."}
   * @paramDef {"type":"Array<String>","label":"Tags to Remove","name":"tags","required":true,"dictionary":"getTagsDictionary","description":"Tags to remove from the prospect. List or comma-separated."}
   * @returns {Object}
   * @sampleResult {"data":{"type":"prospect","id":"123","attributes":{"tags":["lead"]}}}
   */
  async removeProspectTag(prospectId, tags) {
    // API: https://developers.outreach.io/api/making-requests/  (shared PATCH envelope; tags is an array attribute)
    const toRemove = new Set(this.#toList(tags) || [])
    const merged = await this.#mergedTags(prospectId, current => current.filter(tag => !toRemove.has(tag)))

    return await this.#patchProspectTags(prospectId, merged)
  }

  // Reads the prospect's current tags, then applies `mutate(current)` to produce the new list.
  async #mergedTags(prospectId, mutate) {
    const current = await this.getProspect(prospectId)
    const existing = current?.data?.attributes?.tags || []

    return mutate(Array.isArray(existing) ? existing : [])
  }

  #patchProspectTags(prospectId, tags) {
    return this.#apiRequest({
      url: `${ API_BASE }/prospects/${ prospectId }`,
      method: 'patch',
      body: { data: { type: 'prospect', id: prospectId, attributes: { tags } } },
      logTag: 'patchProspectTags',
    })
  }

  // ==========================================================================
  //  ACCOUNTS
  // ==========================================================================
  /**
   * @operationName Create Account
   * @category Accounts
   * @description Creates a new account (a company you sell to) in Outreach with its name, domain, industry, and owner. Use this to add a target company so prospects and opportunities can be linked to it.
   * @route POST /create-account
   * @paramDef {"type":"String","label":"Account Name","name":"name","required":true,"description":"The company / account name."}
   * @paramDef {"type":"String","label":"Domain","name":"domain","description":"Primary web domain, e.g. acme.com."}
   * @paramDef {"type":"String","label":"Industry","name":"industry","description":"Industry of the account."}
   * @paramDef {"type":"Number","label":"Number of Employees","name":"numberOfEmployees","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Employee headcount."}
   * @paramDef {"type":"String","label":"Owner","name":"ownerId","dictionary":"getUsersDictionary","description":"The Outreach user who owns this account."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","dictionary":"getTagsDictionary","description":"Tags to apply. List or comma-separated."}
   * @returns {Object}
   * @sampleResult {"data":{"type":"account","id":"55","attributes":{"name":"Acme Inc","domain":"acme.com","industry":"Software"}}}
   */
  async createAccount(name, domain, industry, numberOfEmployees, ownerId, tags) {
    // API: https://developers.outreach.io/api/making-requests/  (shared JSON:API POST envelope, data.type="account")
    const attributes = { name }

    this.#set(attributes, 'domain', domain)
    this.#set(attributes, 'industry', industry)
    this.#set(attributes, 'tags', this.#toList(tags))

    if (numberOfEmployees !== undefined && numberOfEmployees !== null && numberOfEmployees !== '') {
      attributes.numberOfEmployees = numberOfEmployees
    }

    const data = { type: 'account', attributes }

    if (ownerId) {
      data.relationships = { owner: this.#relationship('user', ownerId) }
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/accounts`,
      method: 'post',
      body: { data },
      logTag: 'createAccount',
    })
  }

  /**
   * @operationName Get Account
   * @category Accounts
   * @description Retrieves a single account by ID, returning its company details. Use this to inspect an account before updating it or linking records to it.
   * @route POST /get-account
   * @paramDef {"type":"String","label":"Account","name":"accountId","required":true,"dictionary":"getAccountsDictionary","description":"The account to retrieve."}
   * @returns {Object}
   * @sampleResult {"data":{"type":"account","id":"55","attributes":{"name":"Acme Inc","domain":"acme.com"}}}
   */
  async getAccount(accountId) {
    return await this.#apiRequest({
      url: `${ API_BASE }/accounts/${ accountId }`,
      logTag: 'getAccount',
    })
  }

  /**
   * @operationName List Accounts
   * @category Accounts
   * @description Returns a page of accounts, optionally filtered by name. Use this to browse target companies or to find an account ID for a later action; pass the cursor to page through results.
   * @route POST /list-accounts
   * @paramDef {"type":"String","label":"Filter by Name","name":"filterName","description":"Return only accounts whose name matches."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":50,"description":"How many accounts per page (max 100). Default: 50."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"The cursor from a previous response; blank for the first page."}
   * @returns {Object}
   * @sampleResult {"data":[{"type":"account","id":"55","attributes":{"name":"Acme Inc"}}],"links":{"next":null}}
   */
  async listAccounts(filterName, pageSize, cursor) {
    const extra = {}

    this.#set(extra, 'filter[name]', filterName)

    return await this.#apiRequest({
      url: `${ API_BASE }/accounts`,
      query: this.#listQuery(pageSize, cursor, extra),
      logTag: 'listAccounts',
    })
  }

  /**
   * @operationName Update Account
   * @category Accounts
   * @description Updates an account's name, domain, or industry. Leave a field blank to keep its current value. Use this to correct or enrich company details.
   * @route POST /update-account
   * @paramDef {"type":"String","label":"Account","name":"accountId","required":true,"dictionary":"getAccountsDictionary","description":"The account to update."}
   * @paramDef {"type":"String","label":"Account Name","name":"name","description":"New account name."}
   * @paramDef {"type":"String","label":"Domain","name":"domain","description":"New primary domain."}
   * @paramDef {"type":"String","label":"Industry","name":"industry","description":"New industry."}
   * @returns {Object}
   * @sampleResult {"data":{"type":"account","id":"55","attributes":{"name":"Acme Holdings"}}}
   */
  async updateAccount(accountId, name, domain, industry) {
    // API: https://developers.outreach.io/api/making-requests/  (shared JSON:API PATCH envelope, data.type="account")
    const attributes = {}

    this.#set(attributes, 'name', name)
    this.#set(attributes, 'domain', domain)
    this.#set(attributes, 'industry', industry)

    return await this.#apiRequest({
      url: `${ API_BASE }/accounts/${ accountId }`,
      method: 'patch',
      body: { data: { type: 'account', id: accountId, attributes } },
      logTag: 'updateAccount',
    })
  }

  /**
   * @operationName Delete Account
   * @category Accounts
   * @description Permanently deletes an account from Outreach. This cannot be undone. Prospects and opportunities linked to it are unlinked, not deleted.
   * @route POST /delete-account
   * @paramDef {"type":"String","label":"Account","name":"accountId","required":true,"dictionary":"getAccountsDictionary","description":"The account to permanently delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":"55"}
   */
  async deleteAccount(accountId) {
    // API: https://developers.outreach.io/api/reference/tag/Account/  (DELETE /accounts/{id})
    await this.#apiRequest({
      url: `${ API_BASE }/accounts/${ accountId }`,
      method: 'delete',
      logTag: 'deleteAccount',
    })

    return { deleted: true, id: accountId }
  }

  // ==========================================================================
  //  SEQUENCES & ENROLLMENT
  // ==========================================================================
  /**
   * @operationName List Sequences
   * @category Sequences
   * @description Returns a page of sequences (the multi-step email/call cadences set up in Outreach), optionally filtered by name. Use this to find the sequence you want to enroll a prospect into.
   * @route POST /list-sequences
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter sequences by name."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":50,"description":"How many sequences per page. Default: 50."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"The cursor from a previous response; blank for the first page."}
   * @returns {Object}
   * @sampleResult {"data":[{"type":"sequence","id":"7","attributes":{"name":"Cold Outreach Q1","enabled":true,"prospectCount":42}}],"links":{"next":null}}
   */
  async listSequences(search, pageSize, cursor) {
    const extra = {}

    this.#set(extra, 'filter[name]', search)

    return await this.#apiRequest({
      url: `${ API_BASE }/sequences`,
      query: this.#listQuery(pageSize, cursor, extra),
      logTag: 'listSequences',
    })
  }

  /**
   * @operationName Get Sequence
   * @category Sequences
   * @description Retrieves a single sequence by ID, returning its name, status, and prospect count. Use this to inspect a sequence before enrolling prospects.
   * @route POST /get-sequence
   * @paramDef {"type":"String","label":"Sequence","name":"sequenceId","required":true,"dictionary":"getSequencesDictionary","description":"The sequence to retrieve."}
   * @returns {Object}
   * @sampleResult {"data":{"type":"sequence","id":"7","attributes":{"name":"Cold Outreach Q1","enabled":true}}}
   */
  async getSequence(sequenceId) {
    return await this.#apiRequest({
      url: `${ API_BASE }/sequences/${ sequenceId }`,
      logTag: 'getSequence',
    })
  }

  /**
   * @operationName List Sequence Steps
   * @category Sequences
   * @description Lists the steps that make up a sequence - their order, type (automatic email, call, task, etc.), and interval. Use this to inspect a cadence's structure.
   * @route POST /list-sequence-steps
   * @paramDef {"type":"String","label":"Sequence","name":"sequenceId","required":true,"dictionary":"getSequencesDictionary","description":"List the steps belonging to this sequence."}
   * @returns {Object}
   * @sampleResult {"data":[{"type":"sequenceStep","id":"11","attributes":{"order":1,"stepType":"auto_email","interval":0}}]}
   */
  async listSequenceSteps(sequenceId) {
    return await this.#apiRequest({
      url: `${ API_BASE }/sequenceSteps`,
      query: { 'filter[sequence][id]': sequenceId, 'page[size]': 50 },
      logTag: 'listSequenceSteps',
    })
  }

  /**
   * @operationName Add Prospect to Sequence
   * @category Sequences
   * @description Enrolls a prospect into a sequence so Outreach starts sending them the cadence's steps from the chosen mailbox. This is the core "start outreach to this person" action. Outreach requires a sending mailbox to enroll.
   * @route POST /add-to-sequence
   * @paramDef {"type":"String","label":"Prospect","name":"prospectId","required":true,"dictionary":"getProspectsDictionary","description":"The prospect to enroll in the sequence."}
   * @paramDef {"type":"String","label":"Sequence","name":"sequenceId","required":true,"dictionary":"getSequencesDictionary","description":"The sequence to add the prospect to."}
   * @paramDef {"type":"String","label":"Sending Mailbox","name":"mailboxId","required":true,"dictionary":"getMailboxesDictionary","description":"The mailbox that will send this prospect's emails. Required by Outreach to enroll."}
   * @returns {Object}
   * @sampleResult {"data":{"type":"sequenceState","id":"900","attributes":{"state":"active"},"relationships":{"prospect":{"data":{"type":"prospect","id":"123"}},"sequence":{"data":{"type":"sequence","id":"7"}}}}}
   */
  async addToSequence(prospectId, sequenceId, mailboxId) {
    // API: https://developers.outreach.io/api/making-requests/  (shared JSON:API relationships envelope, data.type="sequenceState")
    return await this.#apiRequest({
      url: `${ API_BASE }/sequenceStates`,
      method: 'post',
      body: {
        data: {
          type: 'sequenceState',
          relationships: {
            prospect: this.#relationship('prospect', prospectId),
            sequence: this.#relationship('sequence', sequenceId),
            mailbox: this.#relationship('mailbox', mailboxId),
          },
        },
      },
      logTag: 'addToSequence',
    })
  }

  /**
   * @operationName Remove Prospect from Sequence
   * @category Sequences
   * @description Removes a prospect's enrollment from a sequence by deleting its sequence state, stopping further steps. Use this to unenroll someone who replied or opted out.
   * @route POST /remove-from-sequence
   * @paramDef {"type":"String","label":"Enrollment","name":"sequenceStateId","required":true,"dictionary":"getSequenceStatesDictionary","description":"The enrollment (sequence state) to remove. Pick one, or paste an id from Add Prospect to Sequence output."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":"900"}
   */
  async removeFromSequence(sequenceStateId) {
    // API: https://developers.outreach.io/api/reference/tag/SequenceState/  (DELETE /sequenceStates/{id})
    await this.#apiRequest({
      url: `${ API_BASE }/sequenceStates/${ sequenceStateId }`,
      method: 'delete',
      logTag: 'removeFromSequence',
    })

    return { deleted: true, id: sequenceStateId }
  }

  /**
   * @operationName List Sequence Enrollments
   * @category Sequences
   * @description Lists sequence states (prospect enrollments), optionally filtered by prospect or sequence. Use this to see which sequences a prospect is in, or who is enrolled in a sequence, and to get an enrollment ID to remove.
   * @route POST /list-sequence-states
   * @paramDef {"type":"String","label":"Prospect","name":"prospectId","dictionary":"getProspectsDictionary","description":"Filter enrollments for this prospect."}
   * @paramDef {"type":"String","label":"Sequence","name":"sequenceId","dictionary":"getSequencesDictionary","description":"Filter enrollments for this sequence."}
   * @returns {Object}
   * @sampleResult {"data":[{"type":"sequenceState","id":"900","attributes":{"state":"active"}}]}
   */
  async listSequenceStates(prospectId, sequenceId) {
    const query = { 'page[size]': 50 }

    this.#set(query, 'filter[prospect][id]', prospectId)
    this.#set(query, 'filter[sequence][id]', sequenceId)

    return await this.#apiRequest({
      url: `${ API_BASE }/sequenceStates`,
      query,
      logTag: 'listSequenceStates',
    })
  }

  // ==========================================================================
  //  TEMPLATES
  // ==========================================================================
  /**
   * @operationName Create Template
   * @category Templates
   * @description Creates a reusable email template in Outreach with a name, subject, and HTML body. Use this to standardize messaging that reps and sequences can drop into emails.
   * @route POST /create-template
   * @paramDef {"type":"String","label":"Template Name","name":"name","required":true,"description":"A name to identify this email template."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"The email subject line (supports merge variables like {{first_name}})."}
   * @paramDef {"type":"String","label":"Body (HTML)","name":"bodyHtml","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The email body in HTML."}
   * @paramDef {"type":"String","label":"Sharing","name":"shareType","uiComponent":{"type":"DROPDOWN","options":{"values":["Private","Shared with team"]}},"defaultValue":"Private","description":"Who can use this template."}
   * @returns {Object}
   * @sampleResult {"data":{"type":"template","id":"30","attributes":{"name":"Intro Email","subject":"Quick question"}}}
   */
  async createTemplate(name, subject, bodyHtml, shareType) {
    // API: https://developers.outreach.io/api/making-requests/  (shared JSON:API POST envelope, data.type="template")
    const attributes = { name }

    this.#set(attributes, 'subject', subject)
    this.#set(attributes, 'bodyHtml', bodyHtml)
    this.#set(attributes, 'shareType', this.#resolveChoice(shareType, SHARE_TYPE_MAP) || 'private')

    return await this.#apiRequest({
      url: `${ API_BASE }/templates`,
      method: 'post',
      body: { data: { type: 'template', attributes } },
      logTag: 'createTemplate',
    })
  }

  /**
   * @operationName Get Template
   * @category Templates
   * @description Retrieves a single email template by ID, returning its name, subject, and body. Use this to inspect a template before editing or reusing it.
   * @route POST /get-template
   * @paramDef {"type":"String","label":"Template","name":"templateId","required":true,"dictionary":"getTemplatesDictionary","description":"The template to retrieve."}
   * @returns {Object}
   * @sampleResult {"data":{"type":"template","id":"30","attributes":{"name":"Intro Email"}}}
   */
  async getTemplate(templateId) {
    return await this.#apiRequest({
      url: `${ API_BASE }/templates/${ templateId }`,
      logTag: 'getTemplate',
    })
  }

  /**
   * @operationName List Templates
   * @category Templates
   * @description Returns a page of email templates. Use this to browse available templates or to find a template ID for a later action; pass the cursor to page through results.
   * @route POST /list-templates
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":50,"description":"How many templates per page. Default: 50."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"The cursor from a previous response; blank for the first page."}
   * @returns {Object}
   * @sampleResult {"data":[{"type":"template","id":"30","attributes":{"name":"Intro Email"}}],"links":{"next":null}}
   */
  async listTemplates(pageSize, cursor) {
    return await this.#apiRequest({
      url: `${ API_BASE }/templates`,
      query: this.#listQuery(pageSize, cursor),
      logTag: 'listTemplates',
    })
  }

  /**
   * @operationName Update Template
   * @category Templates
   * @description Updates an email template's name, subject, or HTML body. Leave a field blank to keep its current value. Use this to revise standardized messaging.
   * @route POST /update-template
   * @paramDef {"type":"String","label":"Template","name":"templateId","required":true,"dictionary":"getTemplatesDictionary","description":"The template to update."}
   * @paramDef {"type":"String","label":"Template Name","name":"name","description":"New template name."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"New subject line."}
   * @paramDef {"type":"String","label":"Body (HTML)","name":"bodyHtml","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New HTML body."}
   * @returns {Object}
   * @sampleResult {"data":{"type":"template","id":"30","attributes":{"name":"Intro Email v2"}}}
   */
  async updateTemplate(templateId, name, subject, bodyHtml) {
    // API: https://developers.outreach.io/api/making-requests/  (shared JSON:API PATCH envelope, data.type="template")
    const attributes = {}

    this.#set(attributes, 'name', name)
    this.#set(attributes, 'subject', subject)
    this.#set(attributes, 'bodyHtml', bodyHtml)

    return await this.#apiRequest({
      url: `${ API_BASE }/templates/${ templateId }`,
      method: 'patch',
      body: { data: { type: 'template', id: templateId, attributes } },
      logTag: 'updateTemplate',
    })
  }

  /**
   * @operationName Delete Template
   * @category Templates
   * @description Permanently deletes an email template from Outreach. This cannot be undone. Sequences that referenced it will lose that template.
   * @route POST /delete-template
   * @paramDef {"type":"String","label":"Template","name":"templateId","required":true,"dictionary":"getTemplatesDictionary","description":"The template to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":"30"}
   */
  async deleteTemplate(templateId) {
    // API: https://developers.outreach.io/api/reference/tag/Template/  (DELETE /templates/{id})
    await this.#apiRequest({
      url: `${ API_BASE }/templates/${ templateId }`,
      method: 'delete',
      logTag: 'deleteTemplate',
    })

    return { deleted: true, id: templateId }
  }

  // ==========================================================================
  //  SNIPPETS
  // ==========================================================================
  /**
   * @operationName Create Snippet
   * @category Snippets
   * @description Creates a reusable snippet (a saved block of content) in Outreach with a name and HTML body. Use this for boilerplate like a pricing blurb or legal footer that reps insert into emails.
   * @route POST /create-snippet
   * @paramDef {"type":"String","label":"Snippet Name","name":"name","required":true,"description":"A name to identify this reusable snippet."}
   * @paramDef {"type":"String","label":"Body (HTML)","name":"bodyHtml","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The snippet content in HTML."}
   * @paramDef {"type":"String","label":"Sharing","name":"shareType","uiComponent":{"type":"DROPDOWN","options":{"values":["Private","Shared with team"]}},"defaultValue":"Private","description":"Who can use this snippet."}
   * @returns {Object}
   * @sampleResult {"data":{"type":"snippet","id":"12","attributes":{"name":"Pricing blurb"}}}
   */
  async createSnippet(name, bodyHtml, shareType) {
    // API: https://developers.outreach.io/api/making-requests/  (shared JSON:API POST envelope, data.type="snippet")
    const attributes = { name }

    this.#set(attributes, 'bodyHtml', bodyHtml)
    this.#set(attributes, 'shareType', this.#resolveChoice(shareType, SHARE_TYPE_MAP) || 'private')

    return await this.#apiRequest({
      url: `${ API_BASE }/snippets`,
      method: 'post',
      body: { data: { type: 'snippet', attributes } },
      logTag: 'createSnippet',
    })
  }

  /**
   * @operationName Get Snippet
   * @category Snippets
   * @description Retrieves a single snippet by ID, returning its name and body. Use this to inspect a snippet before editing or reusing it.
   * @route POST /get-snippet
   * @paramDef {"type":"String","label":"Snippet","name":"snippetId","required":true,"dictionary":"getSnippetsDictionary","description":"The snippet to retrieve."}
   * @returns {Object}
   * @sampleResult {"data":{"type":"snippet","id":"12","attributes":{"name":"Pricing blurb"}}}
   */
  async getSnippet(snippetId) {
    return await this.#apiRequest({
      url: `${ API_BASE }/snippets/${ snippetId }`,
      logTag: 'getSnippet',
    })
  }

  /**
   * @operationName List Snippets
   * @category Snippets
   * @description Returns a page of snippets. Use this to browse available snippets or to find a snippet ID for a later action; pass the cursor to page through results.
   * @route POST /list-snippets
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":50,"description":"How many snippets per page. Default: 50."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"The cursor from a previous response; blank for the first page."}
   * @returns {Object}
   * @sampleResult {"data":[{"type":"snippet","id":"12","attributes":{"name":"Pricing blurb"}}]}
   */
  async listSnippets(pageSize, cursor) {
    return await this.#apiRequest({
      url: `${ API_BASE }/snippets`,
      query: this.#listQuery(pageSize, cursor),
      logTag: 'listSnippets',
    })
  }

  /**
   * @operationName Update Snippet
   * @category Snippets
   * @description Updates a snippet's name or HTML body. Leave a field blank to keep its current value. Use this to revise saved boilerplate content.
   * @route POST /update-snippet
   * @paramDef {"type":"String","label":"Snippet","name":"snippetId","required":true,"dictionary":"getSnippetsDictionary","description":"The snippet to update."}
   * @paramDef {"type":"String","label":"Snippet Name","name":"name","description":"New snippet name."}
   * @paramDef {"type":"String","label":"Body (HTML)","name":"bodyHtml","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New HTML body."}
   * @returns {Object}
   * @sampleResult {"data":{"type":"snippet","id":"12","attributes":{"name":"Pricing blurb v2"}}}
   */
  async updateSnippet(snippetId, name, bodyHtml) {
    // API: https://developers.outreach.io/api/making-requests/  (shared JSON:API PATCH envelope, data.type="snippet")
    const attributes = {}

    this.#set(attributes, 'name', name)
    this.#set(attributes, 'bodyHtml', bodyHtml)

    return await this.#apiRequest({
      url: `${ API_BASE }/snippets/${ snippetId }`,
      method: 'patch',
      body: { data: { type: 'snippet', id: snippetId, attributes } },
      logTag: 'updateSnippet',
    })
  }

  /**
   * @operationName Delete Snippet
   * @category Snippets
   * @description Permanently deletes a snippet from Outreach. This cannot be undone.
   * @route POST /delete-snippet
   * @paramDef {"type":"String","label":"Snippet","name":"snippetId","required":true,"dictionary":"getSnippetsDictionary","description":"The snippet to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":"12"}
   */
  async deleteSnippet(snippetId) {
    // API: https://developers.outreach.io/api/reference/tag/Snippet/  (DELETE /snippets/{id})
    await this.#apiRequest({
      url: `${ API_BASE }/snippets/${ snippetId }`,
      method: 'delete',
      logTag: 'deleteSnippet',
    })

    return { deleted: true, id: snippetId }
  }

  // ==========================================================================
  //  TASKS
  // ==========================================================================
  /**
   * @operationName Create Task
   * @category Tasks
   * @description Creates a task in Outreach about a prospect - a to-do/action item, call, email, or in-person meeting, with an optional due date and owner. Use this to queue a rep's follow-up work.
   * @route POST /create-task
   * @paramDef {"type":"String","label":"Task Type","name":"action","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["To-do / action item","Call","Email","In-person meeting"]}},"description":"What kind of task this is."}
   * @paramDef {"type":"String","label":"Prospect","name":"prospectId","required":true,"dictionary":"getProspectsDictionary","description":"The prospect this task is about."}
   * @paramDef {"type":"String","label":"Note","name":"note","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free-text note describing the task."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"When the task is due (ISO-8601)."}
   * @paramDef {"type":"String","label":"Owner","name":"ownerId","dictionary":"getUsersDictionary","description":"The Outreach user assigned to this task."}
   * @returns {Object}
   * @sampleResult {"data":{"type":"task","id":"500","attributes":{"action":"call","state":"incomplete","dueAt":"2026-06-10T09:00:00Z"}}}
   */
  async createTask(action, prospectId, note, dueAt, ownerId) {
    // API: https://developers.outreach.io/api/making-requests/  (shared JSON:API POST envelope, data.type="task" + relationships)
    // API: https://developers.outreach.io/api/reference/tag/Task/  (task action enum: action_item | call | email | in_person)
    const attributes = { action: this.#resolveChoice(action, TASK_ACTION_MAP) }

    this.#set(attributes, 'note', note)
    this.#set(attributes, 'dueAt', dueAt)

    const relationships = { prospect: this.#relationship('prospect', prospectId) }

    if (ownerId) {
      relationships.owner = this.#relationship('user', ownerId)
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/tasks`,
      method: 'post',
      body: { data: { type: 'task', attributes, relationships } },
      logTag: 'createTask',
    })
  }

  /**
   * @operationName Get Task
   * @category Tasks
   * @description Retrieves a single task by ID, returning its type, state, due date, and note. Use this to inspect a task before updating or completing it.
   * @route POST /get-task
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","description":"The task to retrieve. Pick one, or paste an id from Create Task output."}
   * @returns {Object}
   * @sampleResult {"data":{"type":"task","id":"500","attributes":{"action":"call","state":"incomplete"}}}
   */
  async getTask(taskId) {
    return await this.#apiRequest({
      url: `${ API_BASE }/tasks/${ taskId }`,
      logTag: 'getTask',
    })
  }

  /**
   * @operationName List Tasks
   * @category Tasks
   * @description Returns a page of tasks, optionally filtered by completion status and owner. Use this to find outstanding work for a rep or to locate a task ID for a later action.
   * @route POST /list-tasks
   * @paramDef {"type":"String","label":"Status","name":"state","uiComponent":{"type":"DROPDOWN","options":{"values":["Incomplete","Completed","Skipped"]}},"description":"Filter by completion status."}
   * @paramDef {"type":"String","label":"Owner","name":"ownerId","dictionary":"getUsersDictionary","description":"Filter to tasks owned by this user."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":50,"description":"How many tasks per page. Default: 50."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"The cursor from a previous response; blank for the first page."}
   * @returns {Object}
   * @sampleResult {"data":[{"type":"task","id":"500","attributes":{"action":"call","state":"incomplete"}}]}
   */
  async listTasks(state, ownerId, pageSize, cursor) {
    const extra = {}

    this.#set(extra, 'filter[state]', this.#resolveChoice(state, TASK_STATE_MAP))
    this.#set(extra, 'filter[owner][id]', ownerId)

    return await this.#apiRequest({
      url: `${ API_BASE }/tasks`,
      query: this.#listQuery(pageSize, cursor, extra),
      logTag: 'listTasks',
    })
  }

  /**
   * @operationName Update Task
   * @category Tasks
   * @description Updates a task's note, due date, or owner. Leave a field blank to keep its current value. To mark a task done, use Complete Task instead.
   * @route POST /update-task
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","description":"The task to update. Pick one, or paste an id."}
   * @paramDef {"type":"String","label":"Note","name":"note","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New note text."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"New due date (ISO-8601)."}
   * @paramDef {"type":"String","label":"Owner","name":"ownerId","dictionary":"getUsersDictionary","description":"Reassign the task owner."}
   * @returns {Object}
   * @sampleResult {"data":{"type":"task","id":"500","attributes":{"note":"Called, left VM"}}}
   */
  async updateTask(taskId, note, dueAt, ownerId) {
    // API: https://developers.outreach.io/api/making-requests/  (shared JSON:API PATCH envelope, data.type="task")
    const attributes = {}

    this.#set(attributes, 'note', note)
    this.#set(attributes, 'dueAt', dueAt)

    const data = { type: 'task', id: taskId, attributes }

    if (ownerId) {
      data.relationships = { owner: this.#relationship('user', ownerId) }
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/tasks/${ taskId }`,
      method: 'patch',
      body: { data },
      logTag: 'updateTask',
    })
  }

  /**
   * @operationName Complete Task
   * @category Tasks
   * @description Marks a task complete by setting its state to "completed". Use this when the rep finishes the call, email, or to-do the task represents.
   * @route POST /complete-task
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","description":"The task to mark complete. Pick one, or paste an id."}
   * @returns {Object}
   * @sampleResult {"data":{"type":"task","id":"500","attributes":{"state":"completed"}}}
   */
  async completeTask(taskId) {
    // API: https://developers.outreach.io/api/making-requests/  (shared PATCH envelope; complete = attributes.state="completed")
    return await this.#apiRequest({
      url: `${ API_BASE }/tasks/${ taskId }`,
      method: 'patch',
      body: { data: { type: 'task', id: taskId, attributes: { state: 'completed' } } },
      logTag: 'completeTask',
    })
  }

  /**
   * @operationName Delete Task
   * @category Tasks
   * @description Permanently deletes a task from Outreach. This cannot be undone. Use this to remove a task that is no longer needed.
   * @route POST /delete-task
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","description":"The task to delete. Pick one, or paste an id."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":"500"}
   */
  async deleteTask(taskId) {
    // API: https://developers.outreach.io/api/reference/tag/Task/  (DELETE /tasks/{id})
    await this.#apiRequest({
      url: `${ API_BASE }/tasks/${ taskId }`,
      method: 'delete',
      logTag: 'deleteTask',
    })

    return { deleted: true, id: taskId }
  }

  // ==========================================================================
  //  CALLS
  // ==========================================================================
  /**
   * @operationName Log Call
   * @category Calls
   * @description Logs a call with a prospect in Outreach - its direction, outcome, note, and when it happened. Use this to record dial activity from an external dialer or after a manual call.
   * @route POST /log-call
   * @paramDef {"type":"String","label":"Prospect","name":"prospectId","required":true,"dictionary":"getProspectsDictionary","description":"The prospect this call was with."}
   * @paramDef {"type":"String","label":"Direction","name":"direction","uiComponent":{"type":"DROPDOWN","options":{"values":["Inbound","Outbound"]}},"defaultValue":"Outbound","description":"Whether the call was inbound or outbound."}
   * @paramDef {"type":"String","label":"Outcome","name":"outcome","description":"The result of the call (e.g. Connected, Voicemail)."}
   * @paramDef {"type":"String","label":"Note","name":"note","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free-text notes from the call."}
   * @paramDef {"type":"String","label":"Occurred At","name":"occurredAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"When the call took place (ISO-8601). Defaults to now if omitted."}
   * @returns {Object}
   * @sampleResult {"data":{"type":"call","id":"77","attributes":{"direction":"outbound","outcome":"Connected","occurredAt":"2026-06-02T15:00:00Z"}}}
   */
  async logCall(prospectId, direction, outcome, note, occurredAt) {
    // API: https://developers.outreach.io/api/making-requests/  (shared JSON:API POST envelope, data.type="call")
    const attributes = { direction: this.#resolveChoice(direction, CALL_DIRECTION_MAP) || 'outbound' }

    this.#set(attributes, 'outcome', outcome)
    this.#set(attributes, 'note', note)
    this.#set(attributes, 'occurredAt', occurredAt)

    return await this.#apiRequest({
      url: `${ API_BASE }/calls`,
      method: 'post',
      body: {
        data: {
          type: 'call',
          attributes,
          relationships: { prospect: this.#relationship('prospect', prospectId) },
        },
      },
      logTag: 'logCall',
    })
  }

  /**
   * @operationName Get Call
   * @category Calls
   * @description Retrieves a single logged call by ID, returning its direction, outcome, and note. Use this to inspect a recorded call.
   * @route POST /get-call
   * @paramDef {"type":"String","label":"Call","name":"callId","required":true,"dictionary":"getCallsDictionary","description":"The call to retrieve. Pick one, or paste an id."}
   * @returns {Object}
   * @sampleResult {"data":{"type":"call","id":"77","attributes":{"direction":"outbound","outcome":"Connected"}}}
   */
  async getCall(callId) {
    return await this.#apiRequest({
      url: `${ API_BASE }/calls/${ callId }`,
      logTag: 'getCall',
    })
  }

  /**
   * @operationName List Calls
   * @category Calls
   * @description Returns a page of logged calls, optionally filtered by prospect. Use this to review call history for a prospect or across the org; pass the cursor to page through results.
   * @route POST /list-calls
   * @paramDef {"type":"String","label":"Prospect","name":"prospectId","dictionary":"getProspectsDictionary","description":"Filter calls for this prospect."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":50,"description":"How many calls per page. Default: 50."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"The cursor from a previous response; blank for the first page."}
   * @returns {Object}
   * @sampleResult {"data":[{"type":"call","id":"77","attributes":{"direction":"outbound"}}]}
   */
  async listCalls(prospectId, pageSize, cursor) {
    const extra = {}

    this.#set(extra, 'filter[prospect][id]', prospectId)

    return await this.#apiRequest({
      url: `${ API_BASE }/calls`,
      query: this.#listQuery(pageSize, cursor, extra),
      logTag: 'listCalls',
    })
  }

  // ==========================================================================
  //  OPPORTUNITIES
  // ==========================================================================
  /**
   * @operationName Create Opportunity
   * @category Opportunities
   * @description Creates an opportunity (a deal) in Outreach with a name, amount, account, stage, and owner. Use this to track a revenue opportunity tied to an account.
   * @route POST /create-opportunity
   * @paramDef {"type":"String","label":"Opportunity Name","name":"name","required":true,"description":"A name for the deal/opportunity."}
   * @paramDef {"type":"String","label":"Account","name":"accountId","dictionary":"getAccountsDictionary","description":"The account this opportunity belongs to."}
   * @paramDef {"type":"String","label":"Stage","name":"stageId","dictionary":"getStagesDictionary","description":"The pipeline stage for this opportunity."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The monetary value of the opportunity."}
   * @paramDef {"type":"String","label":"Close Date","name":"closeDate","uiComponent":{"type":"DATE_PICKER"},"description":"Expected close date (ISO-8601)."}
   * @paramDef {"type":"String","label":"Owner","name":"ownerId","dictionary":"getUsersDictionary","description":"The Outreach user who owns this opportunity."}
   * @returns {Object}
   * @sampleResult {"data":{"type":"opportunity","id":"88","attributes":{"name":"Acme Renewal","amount":50000}}}
   */
  async createOpportunity(name, accountId, stageId, amount, closeDate, ownerId) {
    // API: https://developers.outreach.io/api/making-requests/  (shared JSON:API POST envelope, data.type="opportunity")
    const attributes = { name }

    this.#set(attributes, 'closeDate', closeDate)

    if (amount !== undefined && amount !== null && amount !== '') {
      attributes.amount = amount
    }

    const relationships = {}

    if (accountId) {
      relationships.account = this.#relationship('account', accountId)
    }

    if (stageId) {
      relationships.stage = this.#relationship('stage', stageId)
    }

    if (ownerId) {
      relationships.owner = this.#relationship('user', ownerId)
    }

    const data = { type: 'opportunity', attributes }

    if (Object.keys(relationships).length) {
      data.relationships = relationships
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/opportunities`,
      method: 'post',
      body: { data },
      logTag: 'createOpportunity',
    })
  }

  /**
   * @operationName Get Opportunity
   * @category Opportunities
   * @description Retrieves a single opportunity by ID, returning its name, amount, and stage. Use this to inspect a deal before updating it.
   * @route POST /get-opportunity
   * @paramDef {"type":"String","label":"Opportunity","name":"opportunityId","required":true,"dictionary":"getOpportunitiesDictionary","description":"The opportunity to retrieve. Pick one, or paste an id."}
   * @returns {Object}
   * @sampleResult {"data":{"type":"opportunity","id":"88","attributes":{"name":"Acme Renewal","amount":50000}}}
   */
  async getOpportunity(opportunityId) {
    return await this.#apiRequest({
      url: `${ API_BASE }/opportunities/${ opportunityId }`,
      logTag: 'getOpportunity',
    })
  }

  /**
   * @operationName List Opportunities
   * @category Opportunities
   * @description Returns a page of opportunities, optionally filtered by stage. Use this to review a pipeline or to find an opportunity ID for a later action; pass the cursor to page through results.
   * @route POST /list-opportunities
   * @paramDef {"type":"String","label":"Stage","name":"stageId","dictionary":"getStagesDictionary","description":"Filter opportunities in this stage."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":50,"description":"How many opportunities per page. Default: 50."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"The cursor from a previous response; blank for the first page."}
   * @returns {Object}
   * @sampleResult {"data":[{"type":"opportunity","id":"88","attributes":{"name":"Acme Renewal"}}]}
   */
  async listOpportunities(stageId, pageSize, cursor) {
    const extra = {}

    this.#set(extra, 'filter[stage][id]', stageId)

    return await this.#apiRequest({
      url: `${ API_BASE }/opportunities`,
      query: this.#listQuery(pageSize, cursor, extra),
      logTag: 'listOpportunities',
    })
  }

  /**
   * @operationName Update Opportunity
   * @category Opportunities
   * @description Updates an opportunity's name, stage, or amount. Leave a field blank to keep its current value. Use this to advance a deal through the pipeline or revise its value.
   * @route POST /update-opportunity
   * @paramDef {"type":"String","label":"Opportunity","name":"opportunityId","required":true,"dictionary":"getOpportunitiesDictionary","description":"The opportunity to update. Pick one, or paste an id."}
   * @paramDef {"type":"String","label":"Opportunity Name","name":"name","description":"New name."}
   * @paramDef {"type":"String","label":"Stage","name":"stageId","dictionary":"getStagesDictionary","description":"Move the opportunity to a different stage."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New monetary value."}
   * @returns {Object}
   * @sampleResult {"data":{"type":"opportunity","id":"88","attributes":{"amount":60000}}}
   */
  async updateOpportunity(opportunityId, name, stageId, amount) {
    // API: https://developers.outreach.io/api/making-requests/  (shared JSON:API PATCH envelope, data.type="opportunity")
    const attributes = {}

    this.#set(attributes, 'name', name)

    if (amount !== undefined && amount !== null && amount !== '') {
      attributes.amount = amount
    }

    const data = { type: 'opportunity', id: opportunityId, attributes }

    if (stageId) {
      data.relationships = { stage: this.#relationship('stage', stageId) }
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/opportunities/${ opportunityId }`,
      method: 'patch',
      body: { data },
      logTag: 'updateOpportunity',
    })
  }

  /**
   * @operationName Delete Opportunity
   * @category Opportunities
   * @description Permanently deletes an opportunity from Outreach. This cannot be undone. Use this to remove a deal that was created in error.
   * @route POST /delete-opportunity
   * @paramDef {"type":"String","label":"Opportunity","name":"opportunityId","required":true,"dictionary":"getOpportunitiesDictionary","description":"The opportunity to delete. Pick one, or paste an id."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":"88"}
   */
  async deleteOpportunity(opportunityId) {
    // API: https://developers.outreach.io/api/reference/tag/Opportunity/  (DELETE /opportunities/{id})
    await this.#apiRequest({
      url: `${ API_BASE }/opportunities/${ opportunityId }`,
      method: 'delete',
      logTag: 'deleteOpportunity',
    })

    return { deleted: true, id: opportunityId }
  }

  // ==========================================================================
  //  REFERENCE READS (back the pickers)
  // ==========================================================================
  /**
   * @operationName List Mailboxes
   * @category Reference
   * @description Returns the mailboxes (sending email accounts) connected to Outreach. Use this to find the mailbox ID needed to enroll a prospect in a sequence.
   * @route POST /list-mailboxes
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":50,"description":"How many mailboxes per page. Default: 50."}
   * @returns {Object}
   * @sampleResult {"data":[{"type":"mailbox","id":"3","attributes":{"email":"rep@acme.com","emailProvider":"google"}}]}
   */
  async listMailboxes(pageSize) {
    return await this.#apiRequest({
      url: `${ API_BASE }/mailboxes`,
      query: { 'page[size]': pageSize || 50 },
      logTag: 'listMailboxes',
    })
  }

  /**
   * @operationName List Mailings
   * @category Reference
   * @description Returns a page of mailings (outbound emails Outreach sent), optionally filtered by prospect, with open/click/reply counts. Use this to review email engagement for a prospect.
   * @route POST /list-mailings
   * @paramDef {"type":"String","label":"Prospect","name":"prospectId","dictionary":"getProspectsDictionary","description":"Filter mailings for this prospect."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":50,"description":"How many mailings per page. Default: 50."}
   * @paramDef {"type":"String","label":"Page Cursor","name":"cursor","description":"The cursor from a previous response; blank for the first page."}
   * @returns {Object}
   * @sampleResult {"data":[{"type":"mailing","id":"401","attributes":{"subject":"Quick question","state":"opened","openCount":2}}]}
   */
  async listMailings(prospectId, pageSize, cursor) {
    const extra = {}

    this.#set(extra, 'filter[prospect][id]', prospectId)

    return await this.#apiRequest({
      url: `${ API_BASE }/mailings`,
      query: this.#listQuery(pageSize, cursor, extra),
      logTag: 'listMailings',
    })
  }

  /**
   * @operationName List Users
   * @category Reference
   * @description Returns the Outreach users (reps) in the org. Use this to find the user ID for an owner or assignee on a prospect, account, task, or opportunity.
   * @route POST /list-users
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":50,"description":"How many users per page. Default: 50."}
   * @returns {Object}
   * @sampleResult {"data":[{"type":"user","id":"9","attributes":{"firstName":"Sara","lastName":"Lee","email":"sara@acme.com"}}]}
   */
  async listUsers(pageSize) {
    return await this.#apiRequest({
      url: `${ API_BASE }/users`,
      query: { 'page[size]': pageSize || 50 },
      logTag: 'listUsers',
    })
  }

  /**
   * @operationName List Stages
   * @category Reference
   * @description Returns the opportunity stages configured in Outreach (the pipeline steps). Use this to find the stage ID to set on an opportunity.
   * @route POST /list-stages
   * @returns {Object}
   * @sampleResult {"data":[{"type":"stage","id":"2","attributes":{"name":"Qualified","order":2}}]}
   */
  async listStages() {
    return await this.#apiRequest({
      url: `${ API_BASE }/stages`,
      query: { 'page[size]': 100 },
      logTag: 'listStages',
    })
  }

  /**
   * @operationName List Tags
   * @category Reference
   * @description Returns the distinct tags used across your Outreach data. Use this to discover existing labels before tagging prospects or accounts.
   * @route POST /list-tags
   * @returns {Object}
   * @sampleResult {"data":[{"type":"tag","id":"hot","attributes":{"name":"hot"}}]}
   */
  async listTags() {
    return await this.#apiRequest({
      url: `${ API_BASE }/tags`,
      query: { 'page[size]': 100 },
      logTag: 'listTags',
    })
  }

  // ==========================================================================
  //  DICTIONARIES - back every resource-pick (*Id) param
  // ==========================================================================
  /**
   * @registerAs DICTIONARY
   * @operationName Get Prospects Dictionary
   * @description Provides a searchable list of prospects for dropdown selection in other actions.
   * @route POST /get-prospects-dictionary
   * @paramDef {"type":"getProspectsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"John Doe (john@acme.com)","value":"123","note":"ID: 123"}],"cursor":null}
   */
  async getProspectsDictionary(payload) {
    const { search, cursor } = payload || {}
    const extra = {}

    this.#set(extra, 'filter[emails]', search)

    const result = await this.#apiRequest({
      url: `${ API_BASE }/prospects`,
      query: this.#listQuery(25, cursor, extra),
      logTag: 'getProspectsDictionary',
    })

    return {
      items: (result?.data || []).map(row => {
        const attr = row.attributes || {}
        const name = `${ attr.firstName || '' } ${ attr.lastName || '' }`.trim() || attr.emails?.[0] || `Prospect ${ row.id }`
        const email = attr.emails?.[0]

        return { label: email ? `${ name } (${ email })` : name, value: String(row.id), note: `ID: ${ row.id }` }
      }),
      cursor: this.#nextCursor(result),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Accounts Dictionary
   * @description Provides a searchable list of accounts for dropdown selection in other actions.
   * @route POST /get-accounts-dictionary
   * @paramDef {"type":"getAccountsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Acme Inc","value":"55","note":"acme.com"}],"cursor":null}
   */
  async getAccountsDictionary(payload) {
    const { search, cursor } = payload || {}
    const extra = {}

    this.#set(extra, 'filter[name]', search)

    const result = await this.#apiRequest({
      url: `${ API_BASE }/accounts`,
      query: this.#listQuery(25, cursor, extra),
      logTag: 'getAccountsDictionary',
    })

    return {
      items: (result?.data || []).map(row => ({
        label: row.attributes?.name || `Account ${ row.id }`,
        value: String(row.id),
        note: row.attributes?.domain || `ID: ${ row.id }`,
      })),
      cursor: this.#nextCursor(result),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Sequences Dictionary
   * @description Provides a searchable list of sequences for dropdown selection in other actions.
   * @route POST /get-sequences-dictionary
   * @paramDef {"type":"getSequencesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Cold Outreach Q1","value":"7","note":"42 prospects"}],"cursor":null}
   */
  async getSequencesDictionary(payload) {
    const { search, cursor } = payload || {}
    const extra = {}

    this.#set(extra, 'filter[name]', search)

    const result = await this.#apiRequest({
      url: `${ API_BASE }/sequences`,
      query: this.#listQuery(25, cursor, extra),
      logTag: 'getSequencesDictionary',
    })

    return {
      items: (result?.data || []).map(row => ({
        label: row.attributes?.name || `Sequence ${ row.id }`,
        value: String(row.id),
        note: `${ row.attributes?.prospectCount ?? 0 } prospects`,
      })),
      cursor: this.#nextCursor(result),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Mailboxes Dictionary
   * @description Provides a searchable list of mailboxes for dropdown selection in other actions.
   * @route POST /get-mailboxes-dictionary
   * @paramDef {"type":"getMailboxesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"rep@acme.com","value":"3","note":"google"}],"cursor":null}
   */
  async getMailboxesDictionary(payload) {
    const { cursor } = payload || {}

    const result = await this.#apiRequest({
      url: `${ API_BASE }/mailboxes`,
      query: this.#listQuery(25, cursor),
      logTag: 'getMailboxesDictionary',
    })

    return {
      items: (result?.data || []).map(row => ({
        label: row.attributes?.email || `Mailbox ${ row.id }`,
        value: String(row.id),
        note: row.attributes?.emailProvider || `ID: ${ row.id }`,
      })),
      cursor: this.#nextCursor(result),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Users Dictionary
   * @description Provides a searchable list of Outreach users for owner/assignee dropdown selection in other actions.
   * @route POST /get-users-dictionary
   * @paramDef {"type":"getUsersDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Sara Lee","value":"9","note":"sara@acme.com"}],"cursor":null}
   */
  async getUsersDictionary(payload) {
    const { cursor } = payload || {}

    const result = await this.#apiRequest({
      url: `${ API_BASE }/users`,
      query: this.#listQuery(25, cursor),
      logTag: 'getUsersDictionary',
    })

    return {
      items: (result?.data || []).map(row => {
        const attr = row.attributes || {}
        const name = `${ attr.firstName || '' } ${ attr.lastName || '' }`.trim() || attr.username || `User ${ row.id }`

        return { label: name, value: String(row.id), note: attr.email || `ID: ${ row.id }` }
      }),
      cursor: this.#nextCursor(result),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Stages Dictionary
   * @description Provides a searchable list of opportunity stages for dropdown selection in other actions.
   * @route POST /get-stages-dictionary
   * @paramDef {"type":"getStagesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Qualified","value":"2","note":"Order 2"}],"cursor":null}
   */
  async getStagesDictionary(payload) {
    const { cursor } = payload || {}

    const result = await this.#apiRequest({
      url: `${ API_BASE }/stages`,
      query: this.#listQuery(25, cursor),
      logTag: 'getStagesDictionary',
    })

    return {
      items: (result?.data || []).map(row => ({
        label: row.attributes?.name || `Stage ${ row.id }`,
        value: String(row.id),
        note: `Order ${ row.attributes?.order ?? 0 }`,
      })),
      cursor: this.#nextCursor(result),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tags Dictionary
   * @description Provides a searchable list of existing tags for dropdown selection in other actions.
   * @route POST /get-tags-dictionary
   * @paramDef {"type":"getTagsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"hot","value":"hot","note":""}],"cursor":null}
   */
  async getTagsDictionary(payload) {
    const { cursor } = payload || {}

    const result = await this.#apiRequest({
      url: `${ API_BASE }/tags`,
      query: this.#listQuery(25, cursor),
      logTag: 'getTagsDictionary',
    })

    return {
      items: (result?.data || []).map(row => {
        const name = row.attributes?.name || String(row.id)

        return { label: name, value: name, note: '' }
      }),
      cursor: this.#nextCursor(result),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Templates Dictionary
   * @description Provides a searchable list of email templates for dropdown selection in other actions.
   * @route POST /get-templates-dictionary
   * @paramDef {"type":"getTemplatesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Intro Email","value":"30","note":"ID: 30"}],"cursor":null}
   */
  async getTemplatesDictionary(payload) {
    const { search, cursor } = payload || {}
    const extra = {}

    this.#set(extra, 'filter[name]', search)

    const result = await this.#apiRequest({
      url: `${ API_BASE }/templates`,
      query: this.#listQuery(25, cursor, extra),
      logTag: 'getTemplatesDictionary',
    })

    return {
      items: (result?.data || []).map(row => ({
        label: row.attributes?.name || `Template ${ row.id }`,
        value: String(row.id),
        note: `ID: ${ row.id }`,
      })),
      cursor: this.#nextCursor(result),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Snippets Dictionary
   * @description Provides a searchable list of snippets for dropdown selection in other actions.
   * @route POST /get-snippets-dictionary
   * @paramDef {"type":"getSnippetsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Pricing blurb","value":"12","note":"ID: 12"}],"cursor":null}
   */
  async getSnippetsDictionary(payload) {
    const { search, cursor } = payload || {}
    const extra = {}

    this.#set(extra, 'filter[name]', search)

    const result = await this.#apiRequest({
      url: `${ API_BASE }/snippets`,
      query: this.#listQuery(25, cursor, extra),
      logTag: 'getSnippetsDictionary',
    })

    return {
      items: (result?.data || []).map(row => ({
        label: row.attributes?.name || `Snippet ${ row.id }`,
        value: String(row.id),
        note: `ID: ${ row.id }`,
      })),
      cursor: this.#nextCursor(result),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tasks Dictionary
   * @description Provides a list of tasks for dropdown selection in other actions, labelled by type, prospect, and due date.
   * @route POST /get-tasks-dictionary
   * @paramDef {"type":"getTasksDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Call — due 2026-06-10","value":"500","note":"incomplete"}],"cursor":null}
   */
  async getTasksDictionary(payload) {
    const { cursor } = payload || {}

    const result = await this.#apiRequest({
      url: `${ API_BASE }/tasks`,
      query: this.#listQuery(25, cursor),
      logTag: 'getTasksDictionary',
    })

    return {
      items: (result?.data || []).map(row => {
        const attr = row.attributes || {}
        const due = attr.dueAt ? ` — due ${ String(attr.dueAt).slice(0, 10) }` : ''

        return { label: `${ attr.action || 'Task' }${ due }`, value: String(row.id), note: attr.state || `ID: ${ row.id }` }
      }),
      cursor: this.#nextCursor(result),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Calls Dictionary
   * @description Provides a list of logged calls for dropdown selection in other actions, labelled by direction and outcome.
   * @route POST /get-calls-dictionary
   * @paramDef {"type":"getCallsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Outbound — Connected","value":"77","note":"ID: 77"}],"cursor":null}
   */
  async getCallsDictionary(payload) {
    const { cursor } = payload || {}

    const result = await this.#apiRequest({
      url: `${ API_BASE }/calls`,
      query: this.#listQuery(25, cursor),
      logTag: 'getCallsDictionary',
    })

    return {
      items: (result?.data || []).map(row => {
        const attr = row.attributes || {}
        const outcome = attr.outcome ? ` — ${ attr.outcome }` : ''
        const direction = attr.direction === 'inbound' ? 'Inbound' : 'Outbound'

        return { label: `${ direction }${ outcome }`, value: String(row.id), note: `ID: ${ row.id }` }
      }),
      cursor: this.#nextCursor(result),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Opportunities Dictionary
   * @description Provides a searchable list of opportunities for dropdown selection in other actions.
   * @route POST /get-opportunities-dictionary
   * @paramDef {"type":"getOpportunitiesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Acme Renewal","value":"88","note":"$50000"}],"cursor":null}
   */
  async getOpportunitiesDictionary(payload) {
    const { search, cursor } = payload || {}
    const extra = {}

    this.#set(extra, 'filter[name]', search)

    const result = await this.#apiRequest({
      url: `${ API_BASE }/opportunities`,
      query: this.#listQuery(25, cursor, extra),
      logTag: 'getOpportunitiesDictionary',
    })

    return {
      items: (result?.data || []).map(row => {
        const attr = row.attributes || {}
        const amount = attr.amount !== undefined && attr.amount !== null ? `$${ attr.amount }` : `ID: ${ row.id }`

        return { label: attr.name || `Opportunity ${ row.id }`, value: String(row.id), note: amount }
      }),
      cursor: this.#nextCursor(result),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Sequence Enrollments Dictionary
   * @description Provides a list of sequence enrollments (sequence states) for dropdown selection in other actions, labelled by state.
   * @route POST /get-sequence-states-dictionary
   * @paramDef {"type":"getSequenceStatesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Enrollment 900 (active)","value":"900","note":"ID: 900"}],"cursor":null}
   */
  async getSequenceStatesDictionary(payload) {
    const { cursor } = payload || {}

    const result = await this.#apiRequest({
      url: `${ API_BASE }/sequenceStates`,
      query: this.#listQuery(25, cursor),
      logTag: 'getSequenceStatesDictionary',
    })

    return {
      items: (result?.data || []).map(row => ({
        label: `Enrollment ${ row.id } (${ row.attributes?.state || 'unknown' })`,
        value: String(row.id),
        note: `ID: ${ row.id }`,
      })),
      cursor: this.#nextCursor(result),
    }
  }

  // Extracts the page[after] cursor from a JSON:API links.next URL, or null when there's no next page.
  #nextCursor(result) {
    const next = result?.links?.next

    if (!next) {
      return null
    }

    const match = /[?&]page\[after\]=([^&]+)/.exec(next)

    return match ? decodeURIComponent(match[1]) : null
  }

  // ==========================================================================
  //  REALTIME TRIGGERS (SINGLE_APP - one webhook per subscribed resource/action)
  // ==========================================================================
  /**
   * @registerAs REALTIME_TRIGGER
   * @operationName On Prospect Created
   * @category Triggers
   * @description Fires when a new prospect is created in Outreach. Use this to react to a freshly added lead - sync it elsewhere, notify a rep, or kick off enrichment.
   * @route POST /on-prospect-created
   * @returns {Object}
   * @sampleResult {"data":{"type":"prospect","id":"123","attributes":{"firstName":"John","emails":["john@acme.com"]}},"meta":{"deliveredAt":"2026-06-02T15:00:00Z"}}
   */
  async onProspectCreated() {
    // Trigger marker - events are shaped by handleTriggerResolveEvents.
  }

  /**
   * @registerAs REALTIME_TRIGGER
   * @operationName On Prospect Updated
   * @category Triggers
   * @description Fires when a prospect is updated in Outreach. Use this to react to changes such as a status, owner, or contact-detail edit.
   * @route POST /on-prospect-updated
   * @returns {Object}
   * @sampleResult {"data":{"type":"prospect","id":"123","attributes":{"firstName":"John","title":"VP Sales"}},"meta":{"deliveredAt":"2026-06-02T15:00:00Z"}}
   */
  async onProspectUpdated() {
    // Trigger marker - events are shaped by handleTriggerResolveEvents.
  }

  /**
   * @registerAs REALTIME_TRIGGER
   * @operationName On Account Created
   * @category Triggers
   * @description Fires when a new account is created in Outreach. Use this to react to a new target company - sync it to your CRM or assign an owner.
   * @route POST /on-account-created
   * @returns {Object}
   * @sampleResult {"data":{"type":"account","id":"55","attributes":{"name":"Acme Inc","domain":"acme.com"}},"meta":{"deliveredAt":"2026-06-02T15:00:00Z"}}
   */
  async onAccountCreated() {
    // Trigger marker - events are shaped by handleTriggerResolveEvents.
  }

  /**
   * @registerAs REALTIME_TRIGGER
   * @operationName On Task Created
   * @category Triggers
   * @description Fires when a new task is created in Outreach. Use this to react to queued rep work - for example to notify the assignee.
   * @route POST /on-task-created
   * @returns {Object}
   * @sampleResult {"data":{"type":"task","id":"500","attributes":{"action":"call","state":"incomplete"}},"meta":{"deliveredAt":"2026-06-02T15:00:00Z"}}
   */
  async onTaskCreated() {
    // Trigger marker - events are shaped by handleTriggerResolveEvents.
  }

  /**
   * @registerAs REALTIME_TRIGGER
   * @operationName On Task Completed
   * @category Triggers
   * @description Fires when a task is marked complete in Outreach. Use this to react when a rep finishes a call, email, or to-do - for example to advance a workflow.
   * @route POST /on-task-completed
   * @returns {Object}
   * @sampleResult {"data":{"type":"task","id":"500","attributes":{"action":"call","state":"completed"}},"meta":{"deliveredAt":"2026-06-02T15:00:00Z"}}
   */
  async onTaskCompleted() {
    // Trigger marker - events are shaped by handleTriggerResolveEvents.
  }

  /**
   * @registerAs REALTIME_TRIGGER
   * @operationName On Opportunity Created
   * @category Triggers
   * @description Fires when a new opportunity is created in Outreach. Use this to react to a new deal - for example to alert sales leadership or sync to your CRM.
   * @route POST /on-opportunity-created
   * @returns {Object}
   * @sampleResult {"data":{"type":"opportunity","id":"88","attributes":{"name":"Acme Renewal","amount":50000}},"meta":{"deliveredAt":"2026-06-02T15:00:00Z"}}
   */
  async onOpportunityCreated() {
    // Trigger marker - events are shaped by handleTriggerResolveEvents.
  }

  /**
   * @registerAs REALTIME_TRIGGER
   * @operationName On Opportunity Updated
   * @category Triggers
   * @description Fires when an opportunity is updated in Outreach, such as a stage or amount change. Use this to react to pipeline movement.
   * @route POST /on-opportunity-updated
   * @returns {Object}
   * @sampleResult {"data":{"type":"opportunity","id":"88","attributes":{"amount":60000}},"meta":{"deliveredAt":"2026-06-02T15:00:00Z"}}
   */
  async onOpportunityUpdated() {
    // Trigger marker - events are shaped by handleTriggerResolveEvents.
  }

  /**
   * @registerAs REALTIME_TRIGGER
   * @operationName On Call Logged
   * @category Triggers
   * @description Fires when a call is logged in Outreach. Use this to react to dial activity - for example to record it elsewhere or update a dashboard.
   * @route POST /on-call-created
   * @returns {Object}
   * @sampleResult {"data":{"type":"call","id":"77","attributes":{"direction":"outbound","outcome":"Connected"}},"meta":{"deliveredAt":"2026-06-02T15:00:00Z"}}
   */
  async onCallCreated() {
    // Trigger marker - events are shaped by handleTriggerResolveEvents.
  }

  /**
   * @registerAs REALTIME_TRIGGER
   * @operationName On Mailing Created
   * @category Triggers
   * @description Fires when a mailing (outbound email) is created in Outreach. Use this to react to email sends - for example to log outbound activity.
   * @route POST /on-mailing-created
   * @returns {Object}
   * @sampleResult {"data":{"type":"mailing","id":"401","attributes":{"subject":"Quick question","state":"scheduled"}},"meta":{"deliveredAt":"2026-06-02T15:00:00Z"}}
   */
  async onMailingCreated() {
    // Trigger marker - events are shaped by handleTriggerResolveEvents.
  }

  // -- SYSTEM trigger handlers (SINGLE_APP) -------------------------------
  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerUpsertWebhook
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    // API: https://developers.outreach.io/api/webhooks/  (POST /webhooks)
    logger.debug('handleTriggerUpsertWebhook invoked')

    const callbackUrl = `${ invocation.callbackUrl }${ invocation.callbackUrl.includes('?') ? '&' : '?' }connectionId=${ invocation.connectionId }`
    const webhooks = []

    for (const event of invocation.events || []) {
      const spec = TRIGGER_WEBHOOKS[event.name]

      if (!spec) {
        continue
      }

      // Generate a per-webhook secret used to verify inbound deliveries (HMAC-SHA256).
      const secret = crypto.randomBytes(32).toString('hex')

      const created = await this.#apiRequest({
        url: `${ API_BASE }/webhooks`,
        method: 'post',
        body: {
          data: {
            type: 'webhook',
            attributes: { url: callbackUrl, resource: spec.resource, action: spec.action, secret },
          },
        },
        logTag: 'createWebhook',
      })

      webhooks.push({ triggerId: event.id, webhookId: created?.data?.id, eventName: event.name, secret })
    }

    return { webhookData: { webhooks }, connectionId: invocation.connectionId }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerResolveEvents
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    logger.debug('handleTriggerResolveEvents invoked')

    if (!invocation || !invocation.body) {
      return { connectionId: invocation?.queryParams?.connectionId, events: [] }
    }

    if (!this.#verifyWebhookSignature(invocation)) {
      logger.warn('handleTriggerResolveEvents: webhook signature verification failed — rejecting delivery')

      return { connectionId: invocation.queryParams?.connectionId, events: [] }
    }

    const resource = invocation.body.data?.type
    const action = invocation.body.meta?.eventName || invocation.body.meta?.action || invocation.queryParams?.action
    const events = []

    for (const [name, spec] of Object.entries(TRIGGER_WEBHOOKS)) {
      if (spec.resource === resource && (!action || spec.action === action)) {
        events.push({ name, data: invocation.body })
      }
    }

    return { connectionId: invocation.queryParams?.connectionId, events }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerSelectMatched
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    logger.debug(`handleTriggerSelectMatched.${ invocation.eventName }`)

    const eventId = invocation.body?.data?.id
    const matched = (invocation.triggers || [])
      .filter(trigger => trigger.eventName === invocation.eventName || !trigger.eventName)
      .map(trigger => trigger.id)

    return { ids: matched.length ? matched : (eventId ? [eventId] : []) }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerDeleteWebhook
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerDeleteWebhook(invocation) {
    // API: https://developers.outreach.io/api/webhooks/  (DELETE /webhooks/{id})
    logger.debug('handleTriggerDeleteWebhook invoked')

    const webhooks = invocation.webhookData?.webhooks || []

    for (const webhook of webhooks) {
      if (!webhook.webhookId) {
        continue
      }

      try {
        await this.#apiRequest({
          url: `${ API_BASE }/webhooks/${ webhook.webhookId }`,
          method: 'delete',
          logTag: 'deleteWebhook',
        })
      } catch (error) {
        logger.warn(`handleTriggerDeleteWebhook: failed to delete webhook ${ webhook.webhookId }: ${ error?.message }`)
      }
    }

    return { webhookData: {} }
  }

  // Verifies the inbound Outreach webhook signature: HMAC-SHA256 hexdigest of the EXACT raw
  // request body keyed by the per-webhook secret stored at upsert, compared against the
  // "Outreach-Webhook-Signature" header with a constant-time compare.
  //
  // API: https://developers.outreach.io/api/webhooks/  (header "Outreach-Webhook-Signature" =
  //   OpenSSL::HMAC.hexdigest(sha256, SECRET, body) over the RAW bytes Outreach POSTed).
  //
  // Honesty note: the FlowRunner resolve-events invocation contract (docs/flowrunner-triggers.md)
  // exposes only `headers`, `queryParams`, and a PARSED `body` - there is no guaranteed raw-body
  // field. HMAC over a re-serialised parse (`JSON.stringify(body)`) is NOT byte-identical to what
  // Outreach signed (key order / whitespace / unicode escaping all differ), so it would virtually
  // never match. We therefore (1) use the platform raw body if a build does surface one
  // (rawBody / bodyString), and (2) if only the parsed body is available we still attempt the
  // best-effort compare, but on mismatch we surface the real cause loudly instead of silently
  // dropping the delivery as a generic "bad signature". We never accept an unsigned/forged
  // delivery: a missing header, a missing secret, or a failed compare all reject.
  #verifyWebhookSignature(invocation) {
    const headers = invocation.headers || {}
    const provided = headers['Outreach-Webhook-Signature'] || headers['outreach-webhook-signature']

    if (!provided) {
      logger.warn('Webhook delivery missing Outreach-Webhook-Signature header — rejecting (unsigned).')

      return false
    }

    const secrets = (invocation.webhookData?.webhooks || [])
      .map(webhook => webhook.secret)
      .filter(Boolean)

    if (!secrets.length) {
      logger.warn('No stored webhook secret available — cannot verify signature; rejecting.')

      return false
    }

    // Prefer a platform-supplied raw body (byte-exact); only some platform builds expose one.
    const rawBody = invocation.rawBody !== undefined ? invocation.rawBody
      : (invocation.bodyString !== undefined ? invocation.bodyString : undefined)
    const hasRawBody = rawBody !== undefined
    const candidate = hasRawBody ? rawBody : JSON.stringify(invocation.body)

    const matched = secrets.some(secret => this.#signatureMatches(candidate, secret, provided))

    if (!matched && !hasRawBody) {
      // Be honest about WHY this failed rather than masking it as a bad signature: the platform
      // did not hand us the raw request bytes, so a byte-exact HMAC was impossible. Reps will see
      // this if realtime triggers stop firing - it is the documented limitation, not a forged event.
      logger.warn(
        'Webhook signature could not be verified: the platform did not expose the raw request body, ' +
        'so HMAC-SHA256 cannot be computed byte-exactly against Outreach\'s signature. ' +
        'Rejecting this delivery to stay safe. Realtime triggers require a platform build that ' +
        'surfaces invocation.rawBody / invocation.bodyString. See docs/flowrunner-triggers.md.')
    }

    return matched
  }

  #signatureMatches(rawBody, secret, providedSignature) {
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
    const expectedBuffer = Buffer.from(expected)
    const providedBuffer = Buffer.from(String(providedSignature))

    return expectedBuffer.length === providedBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  }
}

Flowrunner.ServerCode.addService(Outreach, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth2 Client ID from your Outreach app (developers.outreach.io → your app → API credentials).',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth2 Client Secret from your Outreach app (developers.outreach.io → your app → API credentials).',
  },
])
