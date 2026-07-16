'use strict'

const {
  ENVIRONMENTS,
  DEFAULT_ENVIRONMENT,
  SCOPE_READ_WRITE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  DICTIONARY_PAGE_SIZE,
  FETCH_ALL_MAX_PAGES,
  POLLING_MAX_PAGES,
  POLL_OVERLAP_MS,
  MAX_SEEN_EVENT_IDS,
  SCENARIO_SIMULATORS,
  COUNTRY_LABELS,
  LANGUAGE_LABELS,
  CURRENCY_LABELS,
  SCHEME_LABELS,
  ACCOUNT_TYPE_LABELS,
  MANDATE_IMPORT_ENTRY_STATUS_LABELS,
  MANDATE_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  INSTALMENT_STATUS_LABELS,
  PAYOUT_STATUS_LABELS,
  REFUND_TYPE_LABELS,
  MANDATE_VERIFY_LABELS,
  RESOURCE_TYPE_LABELS,
  EVENT_ACTION_LABELS,
  SCENARIO_LABELS,
  MONTH_LABELS,
  INTERVAL_UNIT_LABELS,
} = require('./constants')

const { logger } = require('./helpers/logger')
const { apiRequest, fetchAllPages } = require('./helpers/http')
const {
  cleanupObject,
  toArray,
  toCommaList,
  resolveChoice,
  resolveChoices,
  buildIdempotencyKey,
  buildCreatedAtFilter,
  toIsoDateTime,
  toDictItem,
  toMinorUnits,
} = require('./helpers/utils')
const {
  isIdempotentReplay,
  getConflictingResourceId,
} = require('./helpers/errors')

// =================================================================================================
// GoCardless Service - FlowRunner Extension
// =================================================================================================
// Non-obvious facts every reader should know:
//
//   1. Two host pairs per environment. `connect.gocardless.com` handles OAuth (authorize + token
//      exchange) and `api.gocardless.com` handles data API calls. Sandbox uses
//      `connect-sandbox.*` + `api-sandbox.*`. A token minted against sandbox CANNOT be used
//      against the live API - environment is sticky per OAuth connection. We persist the chosen
//      environment in userData on the OAuth callback so subsequent API calls hit the right host.
//
//   2. OAuth tokens are non-expiring. Standard partner OAuth bearers don't expire and rarely ship
//      a refresh_token. refreshToken is implemented anyway so the FlowRunner runtime doesn't
//      complain, but it usually returns the same token. Revocation happens dashboard-side.
//
//   3. Every POST that creates a resource REQUIRES an Idempotency-Key header. We derive a stable
//      key from method+args (sha256 truncated to 64 chars) so retries don't double-create. Users
//      can supply their own key per-call to bypass this.
//
//   4. Resource envelope. All GoCardless requests/responses wrap payload in the resource's plural
//      key - `{ "customers": {...} }` on create, `{ "customers": [...], "meta": {...} }` on list.
//      Helpers below unwrap on read and rewrap on write so downstream code/AI agents see a flat
//      shape.
//
//   5. Event delivery is polling-only. GoCardless has no API to register webhook endpoints, so
//      the six triggers poll the Events API (see the polling-trigger section for the
//      window/cursor/de-dup rules) instead of receiving pushes.
//
// Section index (jump targets when reading at >3K LOC):
//   1. OAuth system methods         (getOAuth2ConnectionURL / executeCallback / refreshToken)
//   2. Helpers + apiRequest wrapper
//   3. Dictionaries                 (customers/mandates/creditors/subscriptions/payouts/...)
//   4. Customers + bank accounts
//   5. Mandates                     (incl. mandate PDF)
//   6. Payments
//   7. Subscriptions
//   8. Refunds
//   9. Payouts                      (list, get, line items)
//  10. Billing Requests             (hosted onboarding flow)
//  11. Events                       (list + get; backbone of polling triggers)
//  12. Utility                      (testConnection, lookupBankDetails, runScenarioSimulator)
//  13. Polling triggers
//  14. Sample result loaders
// =================================================================================================

/**
 * @requireOAuth
 * @integrationName GoCardless
 * @integrationIcon /icon.png
 **/
class GoCardlessService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret

    const envKey = (config.environment || DEFAULT_ENVIRONMENT).toLowerCase()
    const env = ENVIRONMENTS[envKey] || ENVIRONMENTS[DEFAULT_ENVIRONMENT]

    this.environment = envKey in ENVIRONMENTS ? envKey : DEFAULT_ENVIRONMENT
    this.connectBase = env.connectBase
    this.apiBase = env.apiBase
    this.scopes = SCOPE_READ_WRITE
  }

  // ===========================================================================
  // 2. HELPERS + apiRequest wrapper
  // ===========================================================================

  #getAccessToken() {
    return this.request?.headers?.['oauth-access-token']
  }

  #getApiBase() {
    const userDataEnv = this.request?.headers?.['oauth-user-data-environment']

    if (userDataEnv && ENVIRONMENTS[userDataEnv]) {
      return ENVIRONMENTS[userDataEnv].apiBase
    }

    return this.apiBase
  }

  async #api({
    path,
    method = 'get',
    body,
    query,
    logTag,
    idempotencyKey,
    idempotencyArgs,
    uniqueIdempotency,
  }) {
    const accessToken = this.#getAccessToken()
    const url = `${ this.#getApiBase() }${ path }`

    const computedKey =
      method.toLowerCase() === 'post'
        ? buildIdempotencyKey(
          logTag,
          idempotencyArgs || { path, body },
          idempotencyKey,
          uniqueIdempotency
        )
        : undefined

    return apiRequest({
      url,
      method,
      body,
      query,
      logTag,
      accessToken,
      idempotencyKey: computedKey,
    })
  }

  async #createWithReplayRecovery({
    path,
    resourceKey,
    body,
    logTag,
    idempotencyKey,
    idempotencyArgs,
    uniqueIdempotency,
  }) {
    try {
      const response = await this.#api({
        path,
        method: 'post',
        body,
        logTag,
        idempotencyKey,
        idempotencyArgs,
        uniqueIdempotency,
      })

      return this.#unwrap(response, resourceKey)
    } catch (error) {
      if (isIdempotentReplay(error)) {
        const conflictId = getConflictingResourceId(error)

        logger.warn(
          `${ logTag } - idempotent replay; fetching existing ${ resourceKey } ${ conflictId }`
        )

        const existing = await this.#api({
          path: `${ path }/${ conflictId }`,
          method: 'get',
          logTag: `${ logTag }:replay-fetch`,
        })

        const unwrapped = this.#unwrap(existing, resourceKey)

        return { ...unwrapped, _idempotentReplay: true }
      }

      throw error
    }
  }

  #unwrap(response, resourceKey) {
    if (!response) return null
    const inner = response[resourceKey]

    if (Array.isArray(inner)) {
      return {
        items: inner,
        cursors: response.meta?.cursors || {},
        limit: response.meta?.limit,
      }
    }

    return inner
  }

  #unwrapList(response, resourceKey) {
    const inner = response?.[resourceKey] || []

    return {
      data: inner,
      items: inner,
      cursors: response?.meta?.cursors || {},
      limit: response?.meta?.limit,
      hasMore: !!response?.meta?.cursors?.after,
    }
  }

  // ===========================================================================
  // 1. OAUTH SYSTEM METHODS
  // ===========================================================================

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

    return `${ this.connectBase }/oauth/authorize?${ params.toString() }`
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

    params.append('grant_type', 'authorization_code')
    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)
    params.append('code', callbackObject.code)
    params.append('redirect_uri', callbackObject.redirectURI)

    let tokenResponse

    try {
      tokenResponse = await Flowrunner.Request.post(
        `${ this.connectBase }/oauth/access_token`
      )
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())
    } catch (error) {
      const msg =
        error?.body?.error || error?.body?.error_description || error?.message
      logger.error(`[executeCallback] token exchange failed: ${ msg }`)
      throw new Error(`[GoCardless] OAuth token exchange failed: ${ msg }`)
    }

    if (!tokenResponse?.access_token) {
      throw new Error(
        '[GoCardless] OAuth token exchange returned no access_token'
      )
    }

    // Identify the connected organisation. The merchant name comes from `/creditors` (a partner
    // org always has at least one creditor). Falls back to the organisation_id from the token
    // response when the creditors call fails.
    let identityName =
      `GoCardless Org ${ tokenResponse.organisation_id || '' }`.trim()
    let identityImage = null

    try {
      const creditorsResponse = await Flowrunner.Request.get(
        `${ this.apiBase }/creditors`
      )
        .set({
          Authorization: `Bearer ${ tokenResponse.access_token }`,
          'GoCardless-Version': require('./constants').API_VERSION,
          Accept: 'application/json',
        })
        .query({ limit: 1 })

      const creditor = creditorsResponse?.creditors?.[0]

      if (creditor?.name) {
        identityName = creditor.name
        identityImage = creditor.logo_url || null
      }
    } catch (error) {
      logger.warn(
        `[executeCallback] could not load creditor identity: ${ error?.message }`
      )
    }

    return {
      token: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      // Standard GoCardless partner tokens are non-expiring; some configurations ship an
      // expires_in. Default to 30 days when absent so the platform schedules an occasional
      // refresh attempt (which will return the same token).
      expirationInSeconds: tokenResponse.expires_in || 30 * 24 * 60 * 60,
      connectionIdentityName: identityName,
      connectionIdentityImageURL: identityImage,
      overwrite: true,
      userData: {
        organisationId: tokenResponse.organisation_id || null,
        scope: tokenResponse.scope || this.scopes,
        environment: this.environment,
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
    if (!refreshToken) {
      throw new Error(
        '[GoCardless] refreshToken called without a refresh token'
      )
    }

    const params = new URLSearchParams()

    params.append('grant_type', 'refresh_token')
    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)
    params.append('refresh_token', refreshToken)

    try {
      const response = await Flowrunner.Request.post(
        `${ this.connectBase }/oauth/access_token`
      )
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      if (response?.access_token) {
        return {
          token: response.access_token,
          refreshToken: response.refresh_token || refreshToken,
          expirationInSeconds: response.expires_in || 30 * 24 * 60 * 60,
        }
      }

      logger.warn(
        '[refreshToken] no access_token in response; returning original token'
      )
    } catch (error) {
      logger.warn(
        `[refreshToken] refresh attempt failed: ${ error?.message } - token is likely non-expiring`
      )
    }

    // Non-rotating token: hand the same one back so callers see a successful refresh.
    return {
      token: this.#getAccessToken() || refreshToken,
      refreshToken,
      expirationInSeconds: 30 * 24 * 60 * 60,
    }
  }

  // ===========================================================================
  // 3. DICTIONARIES
  // ===========================================================================

  /**
   * @typedef {Object} listCustomersDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","required":false,"description":"Optional text to filter customers locally by email, given name, family name, or company name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"description":"Pagination cursor for the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Customers Dictionary
   * @route POST /get-customers-dictionary
   * @description Loads customers for dropdowns.
   * @paramDef {"type":"listCustomersDict__payload","label":"Payload","name":"payload","required":false,"description":"Search text and pagination cursor for listing customers."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Jane Doe","value":"CU000123456","note":"jane@example.com - GB"}],"cursor":null}
   */
  async listCustomersDict(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#api({
      path: '/customers',
      logTag: 'listCustomersDict',
      query: { limit: DICTIONARY_PAGE_SIZE, after: cursor },
    })

    const customers = response?.customers || []
    const items = customers
      .filter(
        c =>
          !search ||
          this.#matchesSearch(c, search, [
            'email',
            'given_name',
            'family_name',
            'company_name',
          ])
      )
      .map(c =>
        toDictItem(
          c.company_name ||
            [c.given_name, c.family_name].filter(Boolean).join(' ') ||
            c.email ||
            c.id,
          c.id,
          [c.email, c.country_code].filter(Boolean).join(' - ')
        )
      )

    return { items, cursor: response?.meta?.cursors?.after || null }
  }

  /**
   * @typedef {Object} listMandatesDict__payloadCriteria
   * @paramDef {"type":"String","label":"Customer","name":"customer","required":false,"description":"Only show mandates belonging to this customer."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"description":"Only show mandates in this status."}
   */

  /**
   * @typedef {Object} listMandatesDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","required":false,"description":"Optional text to filter mandates locally by reference, scheme, or ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"description":"Pagination cursor for the next page of results."}
   * @paramDef {"type":"listMandatesDict__payloadCriteria","label":"Criteria","name":"criteria","required":false,"description":"Optional filters: customer and/or status."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Mandates Dictionary
   * @route POST /get-mandates-dictionary
   * @description Loads Direct Debit mandates for dropdowns. Optionally filter by customer or status.
   * @paramDef {"type":"listMandatesDict__payload","label":"Payload","name":"payload","required":false,"description":"Search text, pagination cursor, and optional customer/status filters for listing mandates."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"REF-1234","value":"MD000123456","note":"active - bacs - CU000123456"}],"cursor":null}
   */
  async listMandatesDict(payload) {
    const { search, cursor, criteria } = payload || {}

    const response = await this.#api({
      path: '/mandates',
      logTag: 'listMandatesDict',
      query: {
        limit: DICTIONARY_PAGE_SIZE,
        after: cursor,
        customer: criteria?.customer,
        status: criteria?.status,
      },
    })

    const mandates = response?.mandates || []
    const items = mandates
      .filter(
        m =>
          !search ||
          this.#matchesSearch(m, search, ['reference', 'scheme', 'id'])
      )
      .map(m =>
        toDictItem(
          m.reference || `${ m.scheme || 'mandate' } - ${ m.id }`,
          m.id,
          [m.status, m.scheme, m.links?.customer].filter(Boolean).join(' - ')
        )
      )

    return { items, cursor: response?.meta?.cursors?.after || null }
  }

  /**
   * @typedef {Object} listCreditorsDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","required":false,"description":"Optional text to filter creditors locally by name or ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"description":"Pagination cursor for the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Creditors Dictionary
   * @route POST /get-creditors-dictionary
   * @description Loads your own GoCardless creditor accounts for dropdowns. Most merchants have just one.
   * @paramDef {"type":"listCreditorsDict__payload","label":"Payload","name":"payload","required":false,"description":"Search text and pagination cursor for listing creditors."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Acme Ltd","value":"CR000000000001","note":"successful"}],"cursor":null}
   */
  async listCreditorsDict(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#api({
      path: '/creditors',
      logTag: 'listCreditorsDict',
      query: { limit: DICTIONARY_PAGE_SIZE, after: cursor },
    })

    const creditors = response?.creditors || []
    const items = creditors
      .filter(c => !search || this.#matchesSearch(c, search, ['name', 'id']))
      .map(c => toDictItem(c.name || c.id, c.id, c.verification_status))

    return { items, cursor: response?.meta?.cursors?.after || null }
  }

  /**
   * @typedef {Object} listSubscriptionsDict__payloadCriteria
   * @paramDef {"type":"String","label":"Mandate","name":"mandate","required":false,"description":"Only show subscriptions running under this mandate."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"description":"Only show subscriptions in this status."}
   */

  /**
   * @typedef {Object} listSubscriptionsDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","required":false,"description":"Optional text to filter subscriptions locally by name or ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"description":"Pagination cursor for the next page of results."}
   * @paramDef {"type":"listSubscriptionsDict__payloadCriteria","label":"Criteria","name":"criteria","required":false,"description":"Optional filters: mandate and/or status."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Subscriptions Dictionary
   * @route POST /get-subscriptions-dictionary
   * @description Loads recurring subscriptions for dropdowns. Filter by mandate or status.
   * @paramDef {"type":"listSubscriptionsDict__payload","label":"Payload","name":"payload","required":false,"description":"Search text, pagination cursor, and optional mandate/status filters for listing subscriptions."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Standard Plan","value":"SB000123456","note":"active - 1500 GBP - monthly"}],"cursor":null}
   */
  async listSubscriptionsDict(payload) {
    const { search, cursor, criteria } = payload || {}

    const response = await this.#api({
      path: '/subscriptions',
      logTag: 'listSubscriptionsDict',
      query: {
        limit: DICTIONARY_PAGE_SIZE,
        after: cursor,
        mandate: criteria?.mandate,
        status: criteria?.status,
      },
    })

    const subs = response?.subscriptions || []
    const items = subs
      .filter(s => !search || this.#matchesSearch(s, search, ['name', 'id']))
      .map(s =>
        toDictItem(
          s.name || s.id,
          s.id,
          [s.status, s.amount && `${ s.amount } ${ s.currency }`, s.interval_unit]
            .filter(Boolean)
            .join(' - ')
        )
      )

    return { items, cursor: response?.meta?.cursors?.after || null }
  }

  /**
   * @typedef {Object} listPaymentsDict__payloadCriteria
   * @paramDef {"type":"String","label":"Mandate","name":"mandate","required":false,"description":"Only show payments collected under this mandate."}
   * @paramDef {"type":"String","label":"Customer","name":"customer","required":false,"description":"Only show payments from this customer."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"description":"Only show payments in this status."}
   */

  /**
   * @typedef {Object} listPaymentsDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","required":false,"description":"Optional text to filter payments locally by reference, ID, or description."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"description":"Pagination cursor for the next page of results."}
   * @paramDef {"type":"listPaymentsDict__payloadCriteria","label":"Criteria","name":"criteria","required":false,"description":"Optional filters: mandate, customer, and/or status."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Payments Dictionary
   * @route POST /get-payments-dictionary
   * @description Loads payments for dropdowns. Filter by mandate, customer, or status.
   * @paramDef {"type":"listPaymentsDict__payload","label":"Payload","name":"payload","required":false,"description":"Search text, pagination cursor, and optional mandate/customer/status filters for listing payments."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"INV-4242","value":"PM000123456","note":"pending_submission - 1000 GBP - 2026-05-19"}],"cursor":null}
   */
  async listPaymentsDict(payload) {
    const { search, cursor, criteria } = payload || {}

    const response = await this.#api({
      path: '/payments',
      logTag: 'listPaymentsDict',
      query: {
        limit: DICTIONARY_PAGE_SIZE,
        after: cursor,
        mandate: criteria?.mandate,
        customer: criteria?.customer,
        status: criteria?.status,
      },
    })

    const payments = response?.payments || []
    const items = payments
      .filter(
        p =>
          !search || this.#matchesSearch(p, search, ['reference', 'id', 'description'])
      )
      .map(p =>
        toDictItem(
          p.reference || p.description || `${ p.amount } ${ p.currency } - ${ p.id }`,
          p.id,
          [p.status, `${ p.amount } ${ p.currency }`, p.charge_date]
            .filter(Boolean)
            .join(' - ')
        )
      )

    return { items, cursor: response?.meta?.cursors?.after || null }
  }

  /**
   * @typedef {Object} listPayoutsDict__payloadCriteria
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"description":"Only show payouts in this status."}
   * @paramDef {"type":"String","label":"Creditor","name":"creditor","required":false,"description":"Only show payouts belonging to this creditor."}
   */

  /**
   * @typedef {Object} listPayoutsDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","required":false,"description":"Optional text to filter payouts locally by ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"description":"Pagination cursor for the next page of results."}
   * @paramDef {"type":"listPayoutsDict__payloadCriteria","label":"Criteria","name":"criteria","required":false,"description":"Optional filters: status and/or creditor."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Payouts Dictionary
   * @route POST /get-payouts-dictionary
   * @description Loads payouts (bank transfers GoCardless sent you) for dropdowns. Filter by status.
   * @paramDef {"type":"listPayoutsDict__payload","label":"Payload","name":"payload","required":false,"description":"Search text, pagination cursor, and optional status/creditor filters for listing payouts."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"25000 GBP - 2026-05-18","value":"PO000123456","note":"pending - merchant"}],"cursor":null}
   */
  async listPayoutsDict(payload) {
    const { search, cursor, criteria } = payload || {}

    const response = await this.#api({
      path: '/payouts',
      logTag: 'listPayoutsDict',
      query: {
        limit: DICTIONARY_PAGE_SIZE,
        after: cursor,
        status: criteria?.status,
        creditor: criteria?.creditor,
      },
    })

    const payouts = response?.payouts || []
    const items = payouts
      .filter(p => !search || this.#matchesSearch(p, search, ['id']))
      .map(p =>
        toDictItem(
          `${ p.amount } ${ p.currency } - ${ p.arrival_date || p.created_at?.slice(0, 10) }`,
          p.id,
          [p.status, p.payout_type].filter(Boolean).join(' - ')
        )
      )

    return { items, cursor: response?.meta?.cursors?.after || null }
  }

  /**
   * @typedef {Object} listRefundsDict__payloadCriteria
   * @paramDef {"type":"String","label":"Payment","name":"payment","required":false,"description":"Only show refunds issued against this payment."}
   * @paramDef {"type":"String","label":"Mandate","name":"mandate","required":false,"description":"Only show refunds issued under this mandate."}
   */

  /**
   * @typedef {Object} listRefundsDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","required":false,"description":"Optional text to filter refunds locally by reference or ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"description":"Pagination cursor for the next page of results."}
   * @paramDef {"type":"listRefundsDict__payloadCriteria","label":"Criteria","name":"criteria","required":false,"description":"Optional filters: payment and/or mandate."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Refunds Dictionary
   * @route POST /get-refunds-dictionary
   * @description Loads refunds for dropdowns. Filter by payment or mandate.
   * @paramDef {"type":"listRefundsDict__payload","label":"Payload","name":"payload","required":false,"description":"Search text, pagination cursor, and optional payment/mandate filters for listing refunds."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"REFUND-1","value":"RF000123456","note":"2026-05-16 - PM000123456"}],"cursor":null}
   */
  async listRefundsDict(payload) {
    const { search, cursor, criteria } = payload || {}

    const response = await this.#api({
      path: '/refunds',
      logTag: 'listRefundsDict',
      query: {
        limit: DICTIONARY_PAGE_SIZE,
        after: cursor,
        payment: criteria?.payment,
        mandate: criteria?.mandate,
      },
    })

    const refunds = response?.refunds || []
    const items = refunds
      .filter(r => !search || this.#matchesSearch(r, search, ['reference', 'id']))
      .map(r =>
        toDictItem(
          r.reference || `${ r.amount } ${ r.currency } - ${ r.id }`,
          r.id,
          [r.created_at?.slice(0, 10), r.links?.payment].filter(Boolean).join(' - ')
        )
      )

    return { items, cursor: response?.meta?.cursors?.after || null }
  }

  /**
   * @typedef {Object} listBillingRequestsDict__payloadCriteria
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"description":"Only show billing requests in this status."}
   * @paramDef {"type":"String","label":"Customer","name":"customer","required":false,"description":"Only show billing requests linked to this customer."}
   */

  /**
   * @typedef {Object} listBillingRequestsDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","required":false,"description":"Optional text to filter billing requests locally by ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"description":"Pagination cursor for the next page of results."}
   * @paramDef {"type":"listBillingRequestsDict__payloadCriteria","label":"Criteria","name":"criteria","required":false,"description":"Optional filters: status and/or customer."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Billing Requests Dictionary
   * @route POST /get-billing-requests-dictionary
   * @description Loads billing requests (hosted onboarding sessions) for dropdowns.
   * @paramDef {"type":"listBillingRequestsDict__payload","label":"Payload","name":"payload","required":false,"description":"Search text, pagination cursor, and optional status/customer filters for listing billing requests."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"BRQ000ABCDEF","value":"BRQ000ABCDEF","note":"pending - 2026-05-16"}],"cursor":null}
   */
  async listBillingRequestsDict(payload) {
    const { search, cursor, criteria } = payload || {}

    const response = await this.#api({
      path: '/billing_requests',
      logTag: 'listBillingRequestsDict',
      query: {
        limit: DICTIONARY_PAGE_SIZE,
        after: cursor,
        status: criteria?.status,
        customer: criteria?.customer,
      },
    })

    const requests = response?.billing_requests || []
    const items = requests
      .filter(r => !search || this.#matchesSearch(r, search, ['id']))
      .map(r =>
        toDictItem(
          r.id,
          r.id,
          [r.status, r.created_at?.slice(0, 10)].filter(Boolean).join(' - ')
        )
      )

    return { items, cursor: response?.meta?.cursors?.after || null }
  }

  /**
   * @typedef {Object} listBillingRequestTemplatesDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","required":false,"description":"Optional text to filter templates locally by name or ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"description":"Pagination cursor for the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Billing Request Templates Dictionary
   * @route POST /get-billing-request-templates-dictionary
   * @description Loads reusable billing request templates for dropdowns.
   * @paramDef {"type":"listBillingRequestTemplatesDict__payload","label":"Payload","name":"payload","required":false,"description":"Search text and pagination cursor for listing billing request templates."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Standard Onboarding","value":"BRT000ABCDEF","note":"GBP"}],"cursor":null}
   */
  async listBillingRequestTemplatesDict(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#api({
      path: '/billing_request_templates',
      logTag: 'listBillingRequestTemplatesDict',
      query: { limit: DICTIONARY_PAGE_SIZE, after: cursor },
    })

    const templates = response?.billing_request_templates || []
    const items = templates
      .filter(t => !search || this.#matchesSearch(t, search, ['name', 'id']))
      .map(t => toDictItem(t.name || t.id, t.id, t.payment_request_currency))

    return { items, cursor: response?.meta?.cursors?.after || null }
  }

  /**
   * @typedef {Object} listInstitutionsDict__payloadCriteria
   * @paramDef {"type":"String","label":"Country Code","name":"countryCode","required":false,"description":"Two-letter country code to narrow the institution list. Defaults to GB."}
   * @paramDef {"type":"String","label":"Scheme","name":"scheme","required":false,"description":"Only show institutions supporting this Direct Debit scheme."}
   */

  /**
   * @typedef {Object} listInstitutionsDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","required":false,"description":"Optional text to filter institutions locally by name or ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"description":"Pagination cursor for the next page of results."}
   * @paramDef {"type":"listInstitutionsDict__payloadCriteria","label":"Criteria","name":"criteria","required":false,"description":"Optional filters: country code and/or scheme."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Institutions Dictionary
   * @route POST /get-institutions-dictionary
   * @description Loads banks that support instant bank pay for dropdowns. Provide a country to narrow the list.
   * @paramDef {"type":"listInstitutionsDict__payload","label":"Payload","name":"payload","required":false,"description":"Search text, pagination cursor, and optional country/scheme filters for listing institutions."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Monzo Bank","value":"MONZO_MONZGB2L","note":"MONZGB2L"}],"cursor":null}
   */
  async listInstitutionsDict(payload) {
    const { search, cursor, criteria } = payload || {}

    const response = await this.#api({
      path: '/institutions',
      logTag: 'listInstitutionsDict',
      query: {
        country_code: resolveChoice(criteria?.countryCode, COUNTRY_LABELS) || 'GB',
        scheme: resolveChoice(criteria?.scheme, SCHEME_LABELS),
        limit: DICTIONARY_PAGE_SIZE,
        after: cursor,
      },
    })

    const institutions = response?.institutions || []
    const items = institutions
      .filter(i => !search || this.#matchesSearch(i, search, ['name', 'id']))
      .map(i => toDictItem(i.name || i.id, i.id, i.bic))

    return { items, cursor: response?.meta?.cursors?.after || null }
  }

  /**
   * @typedef {Object} listCustomerBankAccountsDict__payloadCriteria
   * @paramDef {"type":"String","label":"Customer","name":"customer","required":false,"description":"Only show bank accounts belonging to this customer."}
   * @paramDef {"type":"Boolean","label":"Enabled","name":"enabled","required":false,"description":"Only show accounts that are (or are not) currently enabled."}
   */

  /**
   * @typedef {Object} listCustomerBankAccountsDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","required":false,"description":"Optional text to filter accounts locally by account holder name, bank name, or ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"description":"Pagination cursor for the next page of results."}
   * @paramDef {"type":"listCustomerBankAccountsDict__payloadCriteria","label":"Criteria","name":"criteria","required":false,"description":"Optional filters: customer and/or enabled."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Customer Bank Accounts Dictionary
   * @route POST /get-customer-bank-accounts-dictionary
   * @description Loads saved customer bank accounts for dropdowns. Optionally filter by customer.
   * @paramDef {"type":"listCustomerBankAccountsDict__payload","label":"Payload","name":"payload","required":false,"description":"Search text, pagination cursor, and optional customer/enabled filters for listing customer bank accounts."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Jane Doe","value":"BA000123456","note":"MONZO BANK LIMITED - ending 56 - GBP"}],"cursor":null}
   */
  async listCustomerBankAccountsDict(payload) {
    const { search, cursor, criteria } = payload || {}

    const response = await this.#api({
      path: '/customer_bank_accounts',
      logTag: 'listCustomerBankAccountsDict',
      query: {
        limit: DICTIONARY_PAGE_SIZE,
        after: cursor,
        customer: criteria?.customer,
        enabled: criteria?.enabled,
      },
    })

    const accounts = response?.customer_bank_accounts || []
    const items = accounts
      .filter(
        a =>
          !search ||
          this.#matchesSearch(a, search, [
            'account_holder_name',
            'bank_name',
            'id',
          ])
      )
      .map(a =>
        toDictItem(
          a.account_holder_name || a.bank_name || a.id,
          a.id,
          [
            a.bank_name,
            a.account_number_ending && `ending ${ a.account_number_ending }`,
            a.currency,
          ]
            .filter(Boolean)
            .join(' - ')
        )
      )

    return { items, cursor: response?.meta?.cursors?.after || null }
  }

  /**
   * @typedef {Object} listInstalmentSchedulesDict__payloadCriteria
   * @paramDef {"type":"String","label":"Mandate","name":"mandate","required":false,"description":"Only show instalment schedules running under this mandate."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"description":"Only show instalment schedules in this status."}
   */

  /**
   * @typedef {Object} listInstalmentSchedulesDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","required":false,"description":"Optional text to filter instalment schedules locally by name or ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"description":"Pagination cursor for the next page of results."}
   * @paramDef {"type":"listInstalmentSchedulesDict__payloadCriteria","label":"Criteria","name":"criteria","required":false,"description":"Optional filters: mandate and/or status."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Instalment Schedules Dictionary
   * @route POST /get-instalment-schedules-dictionary
   * @description Loads instalment schedules for dropdowns. Optionally filter by mandate or status.
   * @paramDef {"type":"listInstalmentSchedulesDict__payload","label":"Payload","name":"payload","required":false,"description":"Search text, pagination cursor, and optional mandate/status filters for listing instalment schedules."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Invoice 1234","value":"IS000123456","note":"active - 3000 GBP"}],"cursor":null}
   */
  async listInstalmentSchedulesDict(payload) {
    const { search, cursor, criteria } = payload || {}

    const response = await this.#api({
      path: '/instalment_schedules',
      logTag: 'listInstalmentSchedulesDict',
      query: {
        limit: DICTIONARY_PAGE_SIZE,
        after: cursor,
        mandate: criteria?.mandate,
        status: criteria?.status,
      },
    })

    const schedules = response?.instalment_schedules || []
    const items = schedules
      .filter(s => !search || this.#matchesSearch(s, search, ['name', 'id']))
      .map(s =>
        toDictItem(
          s.name || s.id,
          s.id,
          [s.status, s.total_amount && `${ s.total_amount } ${ s.currency }`]
            .filter(Boolean)
            .join(' - ')
        )
      )

    return { items, cursor: response?.meta?.cursors?.after || null }
  }

  // Simple substring search used by every dictionary above. Multi-field needle match - case
  // insensitive, all string fields.
  #matchesSearch(obj, search, fields) {
    if (!search) return true
    const needle = String(search).toLowerCase()

    return fields.some(f => {
      const v = obj?.[f]

      return v && String(v).toLowerCase().includes(needle)
    })
  }

  // ===========================================================================
  // 4. CUSTOMERS + BANK ACCOUNTS
  // ===========================================================================

  /**
   * @description List your GoCardless customers. Useful for reconciliation, exports, or paging through everyone with optional date filters. Use this when you need to browse or audit the customer base.
   * @route POST /list-customers
   * @operationName List Customers
   * @category Customers
   * @appearanceColor #00b87b #008f5d
   * @sampleResultLoader {"methodName":"getCustomer_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Date Range","name":"period","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Custom Range","Today","Yesterday","Last 7 Days","Last 30 Days","Last 90 Days","Month to Date","Year to Date"]}},"description":"Filter by when customers were created. Pick a preset or choose 'custom' to set your own dates below."}
   * @paramDef {"type":"String","label":"Created After","name":"createdAfter","required":false,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return customers created on or after this date. Overrides the preset above when set."}
   * @paramDef {"type":"String","label":"Created Before","name":"createdBefore","required":false,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return customers created on or before this date."}
   * @paramDef {"type":"Number","label":"Page Size","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many customers per page (1 to 500). Defaults to 50."}
   * @paramDef {"type":"Boolean","label":"Fetch All Pages","name":"fetchAll","required":false,"uiComponent":{"type":"TOGGLE"},"description":"When on, automatically pages through every customer (up to 100 pages = 50,000 records). Leave off for large datasets to control quota."}
   * @paramDef {"type":"String","label":"Next Page Token","name":"cursor","required":false,"description":"Advanced. To fetch the next page manually, paste the 'cursors.after' value from a previous response here. Ignored when Fetch All Pages is on."}
   * @returns {Object}
   */
  async listCustomers(
    period,
    createdAfter,
    createdBefore,
    limit,
    fetchAll,
    cursor
  ) {
    const createdAt = buildCreatedAtFilter({
      period,
      createdAfter,
      createdBefore,
    })
    const baseQuery = cleanupObject({
      limit: this.#clampLimit(limit),
      ...(createdAt ? this.#flattenCreatedAt(createdAt) : {}),
    })

    if (fetchAll) {
      const result = await fetchAllPages(
        async after => {
          const page = await this.#api({
            path: '/customers',
            logTag: 'listCustomers:fetchAll',
            query: { ...baseQuery, after },
          })

          return {
            items: page?.customers || [],
            cursors: page?.meta?.cursors || {},
          }
        },
        { maxPages: FETCH_ALL_MAX_PAGES }
      )

      return {
        data: result.items,
        items: result.items,
        pageCount: result.pageCount,
        truncated: result.truncated,
      }
    }

    const response = await this.#api({
      path: '/customers',
      logTag: 'listCustomers',
      query: { ...baseQuery, after: cursor },
    })

    return this.#unwrapList(response, 'customers')
  }

  /**
   * @description Fetch one customer's full profile - name, email, address, language, identity numbers. Use when you have a customer ID and need their details for display or downstream logic.
   * @route POST /get-customer
   * @operationName Get Customer
   * @category Customers
   * @appearanceColor #00b87b #008f5d
   * @sampleResultLoader {"methodName":"getCustomer_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"listCustomersDict","description":"Pick the customer you want to look up."}
   * @returns {Object}
   */
  async getCustomer(customerId) {
    if (!customerId) throw new Error('[GoCardless] customerId is required')

    const response = await this.#api({
      path: `/customers/${ customerId }`,
      logTag: 'getCustomer',
    })

    return this.#unwrap(response, 'customers')
  }

  /**
   * @description Create a new customer. Use this before collecting their bank details (createCustomerBankAccount) and authorising a mandate. For self-serve onboarding where the payer enters their own details, use createBillingRequest instead.
   * @route POST /create-customer
   * @operationName Create Customer
   * @category Customers
   * @appearanceColor #00b87b #008f5d
   * @sampleResultLoader {"methodName":"getCustomer_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Email","name":"email","required":false,"description":"Customer email address. Used for payment notifications and confirmations."}
   * @paramDef {"type":"String","label":"First Name","name":"givenName","required":false,"description":"First name. Use for individuals; leave blank for businesses (set Company Name instead)."}
   * @paramDef {"type":"String","label":"Last Name","name":"familyName","required":false,"description":"Last name. Use for individuals."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","required":false,"description":"Business name. Set this for company customers - it appears on the payer's notifications instead of first/last name."}
   * @paramDef {"type":"String","label":"Country","name":"countryCode","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["United Kingdom","Germany","France","Netherlands","Spain","Italy","Ireland","Austria","Belgium","Portugal","Finland","Luxembourg","Sweden","Denmark","Australia","New Zealand","Canada","United States"]}},"description":"Where the customer lives. Required before you can collect a Direct Debit mandate."}
   * @paramDef {"type":"String","label":"Language","name":"language","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["English","German","French","Spanish","Italian","Dutch","Portuguese","Swedish","Danish"]}},"description":"Language used for emails GoCardless sends the customer. Defaults to English."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumber","required":false,"description":"International phone with country code. Example: +447000000000."}
   * @paramDef {"type":"String","label":"Address Line 1","name":"addressLine1","required":false,"description":"Street address - first line."}
   * @paramDef {"type":"String","label":"Address Line 2","name":"addressLine2","required":false,"description":"Apartment, suite, or building number."}
   * @paramDef {"type":"String","label":"Address Line 3","name":"addressLine3","required":false,"description":"Extra address line if needed."}
   * @paramDef {"type":"String","label":"City","name":"city","required":false,"description":"City or town."}
   * @paramDef {"type":"String","label":"Region","name":"region","required":false,"description":"State, county, or region."}
   * @paramDef {"type":"String","label":"Postal Code","name":"postalCode","required":false,"description":"Postal or ZIP code."}
   * @paramDef {"type":"String","label":"Swedish Personnummer","name":"swedishIdentityNumber","required":false,"description":"Swedish identity number. Required only when collecting a Swedish Autogiro mandate (currency SEK). Accepts personnummer, samordningsnummer, or organisationsnummer. Cannot be changed once set."}
   * @paramDef {"type":"String","label":"Danish CPR / CVR","name":"danishIdentityNumber","required":false,"description":"Danish identity number. Required only when collecting a Danish Betalingsservice mandate (currency DKK). Accepts CPR (personal) or CVR (business)."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","required":false,"description":"Optional notes - up to 3 key/value pairs you can use to reference your own records. Each key max 50 chars, each value max 500 chars."}
   * @paramDef {"type":"String","label":"Idempotency Key (Advanced)","name":"idempotencyKey","required":false,"description":"Advanced. Leave blank unless you need to force a fresh creation when retrying. We auto-generate a stable key so retries don't create duplicates."}
   * @returns {Object}
   */
  async createCustomer(
    email,
    givenName,
    familyName,
    companyName,
    countryCode,
    language,
    phoneNumber,
    addressLine1,
    addressLine2,
    addressLine3,
    city,
    region,
    postalCode,
    swedishIdentityNumber,
    danishIdentityNumber,
    metadata,
    idempotencyKey
  ) {
    const body = {
      customers:
        cleanupObject({
          email,
          given_name: givenName,
          family_name: familyName,
          company_name: companyName,
          country_code: resolveChoice(countryCode, COUNTRY_LABELS),
          language: resolveChoice(language, LANGUAGE_LABELS),
          phone_number: phoneNumber,
          address_line1: addressLine1,
          address_line2: addressLine2,
          address_line3: addressLine3,
          city,
          region,
          postal_code: postalCode,
          swedish_identity_number: swedishIdentityNumber,
          danish_identity_number: danishIdentityNumber,
          metadata: cleanupObject(metadata),
        }) || {},
    }

    return this.#createWithReplayRecovery({
      path: '/customers',
      resourceKey: 'customers',
      body,
      logTag: 'createCustomer',
      idempotencyKey,
      idempotencyArgs: body,
    })
  }

  /**
   * @description Update an existing customer's profile fields like name, email, address, phone or language. Country and identity numbers cannot be changed once set - to change those, create a new customer.
   * @route POST /update-customer
   * @operationName Update Customer
   * @category Customers
   * @appearanceColor #00b87b #008f5d
   * @sampleResultLoader {"methodName":"getCustomer_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"listCustomersDict","description":"Customer to update."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":false,"description":"New email address. Leave blank to keep current."}
   * @paramDef {"type":"String","label":"First Name","name":"givenName","required":false,"description":"New first name. Leave blank to keep current."}
   * @paramDef {"type":"String","label":"Last Name","name":"familyName","required":false,"description":"New last name. Leave blank to keep current."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","required":false,"description":"New company name. Leave blank to keep current."}
   * @paramDef {"type":"String","label":"Language","name":"language","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["English","German","French","Spanish","Italian","Dutch","Portuguese","Swedish","Danish"]}},"description":"New language for notifications."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumber","required":false,"description":"New phone number. Use international format with country code, e.g. +447000000000."}
   * @paramDef {"type":"String","label":"Address Line 1","name":"addressLine1","required":false,"description":"New street address."}
   * @paramDef {"type":"String","label":"Address Line 2","name":"addressLine2","required":false,"description":"New address line 2."}
   * @paramDef {"type":"String","label":"Address Line 3","name":"addressLine3","required":false,"description":"New address line 3."}
   * @paramDef {"type":"String","label":"City","name":"city","required":false,"description":"New city."}
   * @paramDef {"type":"String","label":"Region","name":"region","required":false,"description":"New state/region."}
   * @paramDef {"type":"String","label":"Postal Code","name":"postalCode","required":false,"description":"New postal/ZIP code."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","required":false,"description":"Replacement notes - up to 3 key/value pairs."}
   * @returns {Object}
   */
  async updateCustomer(
    customerId,
    email,
    givenName,
    familyName,
    companyName,
    language,
    phoneNumber,
    addressLine1,
    addressLine2,
    addressLine3,
    city,
    region,
    postalCode,
    metadata
  ) {
    if (!customerId) throw new Error('[GoCardless] customerId is required')

    const fields = cleanupObject({
      email,
      given_name: givenName,
      family_name: familyName,
      company_name: companyName,
      language: resolveChoice(language, LANGUAGE_LABELS),
      phone_number: phoneNumber,
      address_line1: addressLine1,
      address_line2: addressLine2,
      address_line3: addressLine3,
      city,
      region,
      postal_code: postalCode,
      metadata: cleanupObject(metadata),
    })

    const response = await this.#api({
      path: `/customers/${ customerId }`,
      method: 'put',
      body: { customers: fields || {} },
      logTag: 'updateCustomer',
    })

    return this.#unwrap(response, 'customers')
  }

  /**
   * @description Remove a customer. The record stays in GoCardless for your reference but becomes read-only - no new mandates or payments can be created. Use this when ending a customer relationship cleanly. Not reversible.
   * @route POST /remove-customer
   * @operationName Remove Customer
   * @category Customers
   * @appearanceColor #00b87b #008f5d
   * @sampleResultLoader {"methodName":"getCustomer_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"listCustomersDict","description":"Customer to remove."}
   * @returns {Object}
   */
  async removeCustomer(customerId) {
    if (!customerId) throw new Error('[GoCardless] customerId is required')

    const response = await this.#api({
      path: `/customers/${ customerId }`,
      method: 'delete',
      logTag: 'removeCustomer',
    })

    return this.#unwrap(response, 'customers')
  }

  /**
   * @description List bank accounts attached to your customers. Use to find an existing bank account before creating a mandate, or to audit which customers have active payment methods.
   * @route POST /list-customer-bank-accounts
   * @operationName List Customer Bank Accounts
   * @category Customers
   * @appearanceColor #00b87b #008f5d
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":false,"dictionary":"listCustomersDict","description":"Only show accounts belonging to this customer."}
   * @paramDef {"type":"Boolean","label":"Active Only","name":"enabled","required":false,"uiComponent":{"type":"TOGGLE"},"description":"When on, hide disabled accounts (those you can no longer charge)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many results per page (1 to 500). Defaults to 50."}
   * @paramDef {"type":"String","label":"Next Page Token","name":"cursor","required":false,"description":"Advanced. Paste 'cursors.after' from a previous response to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"BA000123456","created_at":"2026-05-16T10:00:00.000Z","account_holder_name":"Jane Doe","account_number_ending":"56","bank_name":"MONZO BANK LIMITED","country_code":"GB","currency":"GBP","enabled":true,"metadata":{},"links":{"customer":"CU000123456"}}],"items":[{"id":"BA000123456","created_at":"2026-05-16T10:00:00.000Z","account_holder_name":"Jane Doe","account_number_ending":"56","bank_name":"MONZO BANK LIMITED","country_code":"GB","currency":"GBP","enabled":true,"metadata":{},"links":{"customer":"CU000123456"}}],"cursors":{"before":null,"after":null},"limit":50,"hasMore":false}
   */
  async listCustomerBankAccounts(customerId, enabled, limit, cursor) {
    const response = await this.#api({
      path: '/customer_bank_accounts',
      logTag: 'listCustomerBankAccounts',
      query: cleanupObject({
        customer: customerId,
        enabled,
        limit: this.#clampLimit(limit),
        after: cursor,
      }),
    })

    return this.#unwrapList(response, 'customer_bank_accounts')
  }

  /**
   * @description Fetch one customer bank account - sort code, last few digits, scheme support, status.
   * @route POST /get-customer-bank-account
   * @operationName Get Customer Bank Account
   * @category Customers
   * @appearanceColor #00b87b #008f5d
   * @paramDef {"type":"String","label":"Bank Account","name":"bankAccountId","required":true,"dictionary":"listCustomerBankAccountsDict","description":"Pick the customer bank account (its ID starts with BA)."}
   * @returns {Object}
   * @sampleResult {"id":"BA000123456","created_at":"2026-05-16T10:00:00.000Z","account_holder_name":"Jane Doe","account_number_ending":"56","bank_name":"MONZO BANK LIMITED","country_code":"GB","currency":"GBP","enabled":true,"metadata":{},"links":{"customer":"CU000123456"}}
   */
  async getCustomerBankAccount(bankAccountId) {
    if (!bankAccountId)
      throw new Error('[GoCardless] bankAccountId is required')

    const response = await this.#api({
      path: `/customer_bank_accounts/${ bankAccountId }`,
      logTag: 'getCustomerBankAccount',
    })

    return this.#unwrap(response, 'customer_bank_accounts')
  }

  /**
   * @description Save a customer's bank details so you can charge them. Either provide an IBAN (works for most European accounts) OR fill the account number + sort/bank/branch code for local schemes (UK, US, AU, etc.). For self-serve flows where the payer enters their own details, use createBillingRequestFlow instead.
   * @route POST /create-customer-bank-account
   * @operationName Save Customer Bank Account
   * @category Customers
   * @appearanceColor #00b87b #008f5d
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"listCustomersDict","description":"Customer this bank account belongs to."}
   * @paramDef {"type":"String","label":"Account Holder Name","name":"accountHolderName","required":true,"description":"Name on the bank account as it appears on the customer's bank statement."}
   * @paramDef {"type":"String","label":"Bank Country","name":"countryCode","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["United Kingdom","Germany","France","Netherlands","Spain","Italy","Ireland","Austria","Belgium","Portugal","Finland","Luxembourg","Sweden","Denmark","Australia","New Zealand","Canada","United States"]}},"description":"Country where the bank account is held."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["British Pound","Euro","US Dollar","Swedish Krona","Australian Dollar","New Zealand Dollar","Canadian Dollar","Danish Krone"]}},"description":"Currency for this account. Usually inferred from the bank details - leave blank unless you need to override."}
   * @paramDef {"type":"String","label":"IBAN","name":"iban","required":false,"description":"International bank account number. Use for European (SEPA) accounts - covers most European countries in one field. Leave blank if you're using account number + sort code instead."}
   * @paramDef {"type":"String","label":"Account Number","name":"accountNumber","required":false,"description":"Local account number. Use this with Branch Code for non-European schemes (UK, US, AU, NZ, CA, SE, DK). Leave blank if you're using IBAN."}
   * @paramDef {"type":"String","label":"Sort Code / Routing Number","name":"branchCode","required":false,"description":"The local routing code: sort code (UK), BSB (Australia), routing number (US), clearingnummer (Sweden). Pair with Account Number above."}
   * @paramDef {"type":"String","label":"Bank Code","name":"bankCode","required":false,"description":"Bank code used by Canada and New Zealand schemes. Only needed there."}
   * @paramDef {"type":"String","label":"Account Type (US only)","name":"accountType","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Checking","Savings"]}},"description":"Only fill for US dollar (ACH) accounts. Must be left blank for every other currency."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","required":false,"description":"Optional notes - up to 3 key/value pairs."}
   * @paramDef {"type":"String","label":"Idempotency Key (Advanced)","name":"idempotencyKey","required":false,"description":"Advanced. Leave blank unless forcing a fresh creation."}
   * @returns {Object}
   * @sampleResult {"id":"BA000123456","created_at":"2026-05-16T10:00:00.000Z","account_holder_name":"Jane Doe","account_number_ending":"56","bank_name":"MONZO BANK LIMITED","country_code":"GB","currency":"GBP","enabled":true,"metadata":{},"links":{"customer":"CU000123456"}}
   */
  async createCustomerBankAccount(
    customerId,
    accountHolderName,
    countryCode,
    currency,
    iban,
    accountNumber,
    branchCode,
    bankCode,
    accountType,
    metadata,
    idempotencyKey
  ) {
    if (!customerId) throw new Error('[GoCardless] customerId is required')
    if (!accountHolderName)
      throw new Error('[GoCardless] accountHolderName is required')

    const body = {
      customer_bank_accounts:
        cleanupObject({
          account_holder_name: accountHolderName,
          country_code: resolveChoice(countryCode, COUNTRY_LABELS),
          currency: resolveChoice(currency, CURRENCY_LABELS),
          iban,
          account_number: accountNumber,
          branch_code: branchCode,
          bank_code: bankCode,
          account_type: resolveChoice(accountType, ACCOUNT_TYPE_LABELS),
          metadata: cleanupObject(metadata),
          links: { customer: customerId },
        }) || {},
    }

    return this.#createWithReplayRecovery({
      path: '/customer_bank_accounts',
      resourceKey: 'customer_bank_accounts',
      body,
      logTag: 'createCustomerBankAccount',
      idempotencyKey,
      idempotencyArgs: body,
    })
  }

  /**
   * @description Permanently turn off a customer bank account. Existing mandates on it stop working and you can no longer collect payments from it. Cannot be undone - to switch to a new account, save a new one first.
   * @route POST /disable-customer-bank-account
   * @operationName Disable Customer Bank Account
   * @category Customers
   * @appearanceColor #00b87b #008f5d
   * @paramDef {"type":"String","label":"Bank Account","name":"bankAccountId","required":true,"dictionary":"listCustomerBankAccountsDict","description":"Pick the customer bank account to disable (its ID starts with BA)."}
   * @returns {Object}
   * @sampleResult {"id":"BA000123456","created_at":"2026-05-16T10:00:00.000Z","account_holder_name":"Jane Doe","account_number_ending":"56","bank_name":"MONZO BANK LIMITED","country_code":"GB","currency":"GBP","enabled":false,"metadata":{},"links":{"customer":"CU000123456"}}
   */
  async disableCustomerBankAccount(bankAccountId) {
    if (!bankAccountId)
      throw new Error('[GoCardless] bankAccountId is required')

    const response = await this.#api({
      path: `/customer_bank_accounts/${ bankAccountId }/actions/disable`,
      method: 'post',
      body: {},
      logTag: 'disableCustomerBankAccount',
    })

    return this.#unwrap(response, 'customer_bank_accounts')
  }

  // ===========================================================================
  // 5. MANDATES
  // ===========================================================================

  /**
   * @description List Direct Debit mandates (payer authorisations). Filter by customer, bank account, status, scheme, or date range. Use for reporting, finding active mandates to charge, or auditing cancelled ones.
   * @route POST /list-mandates
   * @operationName List Mandates
   * @category Mandates
   * @appearanceColor #1e88e5 #0d47a1
   * @sampleResultLoader {"methodName":"getMandate_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":false,"dictionary":"listCustomersDict","description":"Only show mandates for this customer."}
   * @paramDef {"type":"String","label":"Bank Account","name":"customerBankAccountId","required":false,"dictionary":"listCustomerBankAccountsDict","description":"Only show mandates authorising this specific bank account."}
   * @paramDef {"type":"Array<String>","label":"Status","name":"status","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Pending Customer Approval","Pending Submission","Submitted","Active","Failed","Cancelled","Expired","Consumed","Blocked","Suspended By Payer"],"multiple":true}},"description":"Pick one or more states to include. Most-used: 'active' (can be charged) and 'cancelled'."}
   * @paramDef {"type":"String","label":"Scheme","name":"scheme","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Bacs (UK)","SEPA Core (Europe)","ACH (US)","BECS (Australia)","BECS (New Zealand)","Autogiro (Sweden)","PAD (Canada)","Betalingsservice (Denmark)","Faster Payments (UK)"]}},"description":"Only show mandates on this Direct Debit scheme (bacs = UK, sepa_core = Europe, ach = US, becs = Australia, etc.)."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","required":false,"description":"Filter by mandate reference text."}
   * @paramDef {"type":"String","label":"Date Range","name":"period","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Custom Range","Today","Last 7 Days","Last 30 Days","Last 90 Days","Month to Date","Year to Date"]}},"description":"Filter by when the mandate was created. Pick a preset or 'custom' for explicit dates."}
   * @paramDef {"type":"String","label":"Created After","name":"createdAfter","required":false,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return mandates created on or after this date."}
   * @paramDef {"type":"String","label":"Created Before","name":"createdBefore","required":false,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return mandates created on or before this date."}
   * @paramDef {"type":"Number","label":"Page Size","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many mandates per page (1 to 500). Defaults to 50."}
   * @paramDef {"type":"String","label":"Next Page Token","name":"cursor","required":false,"description":"Advanced. Paste 'cursors.after' from a previous response to fetch the next page."}
   * @returns {Object}
   */
  async listMandates(
    customerId,
    customerBankAccountId,
    status,
    scheme,
    reference,
    period,
    createdAfter,
    createdBefore,
    limit,
    cursor
  ) {
    const createdAt = buildCreatedAtFilter({
      period,
      createdAfter,
      createdBefore,
    })

    const response = await this.#api({
      path: '/mandates',
      logTag: 'listMandates',
      query: cleanupObject({
        customer: customerId,
        customer_bank_account: customerBankAccountId,
        status: toCommaList(resolveChoices(status, MANDATE_STATUS_LABELS)),
        scheme: resolveChoice(scheme, SCHEME_LABELS),
        reference,
        limit: this.#clampLimit(limit),
        after: cursor,
        ...(createdAt ? this.#flattenCreatedAt(createdAt) : {}),
      }),
    })

    return this.#unwrapList(response, 'mandates')
  }

  /**
   * @description Fetch one mandate - scheme, status, next earliest charge date, links to customer and bank account.
   * @route POST /get-mandate
   * @operationName Get Mandate
   * @category Mandates
   * @appearanceColor #1e88e5 #0d47a1
   * @sampleResultLoader {"methodName":"getMandate_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Mandate","name":"mandateId","required":true,"dictionary":"listMandatesDict","description":"Pick the mandate."}
   * @returns {Object}
   */
  async getMandate(mandateId) {
    if (!mandateId) throw new Error('[GoCardless] mandateId is required')

    const response = await this.#api({
      path: `/mandates/${ mandateId }`,
      logTag: 'getMandate',
    })

    return this.#unwrap(response, 'mandates')
  }

  /**
   * @description Create a Direct Debit mandate against an existing customer bank account. The mandate authorises you to take future payments. Use this when you already collected bank details out of band; for self-serve onboarding where the payer authorises themselves online, use createBillingRequestFlow instead.
   * @route POST /create-mandate
   * @operationName Create Mandate
   * @category Mandates
   * @appearanceColor #1e88e5 #0d47a1
   * @sampleResultLoader {"methodName":"getMandate_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Customer Bank Account","name":"customerBankAccountId","required":true,"dictionary":"listCustomerBankAccountsDict","description":"Pick the customer bank account to authorise (its ID starts with BA)."}
   * @paramDef {"type":"String","label":"Scheme","name":"scheme","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Bacs (UK)","SEPA Core (Europe)","ACH (US)","BECS (Australia)","BECS (New Zealand)","Autogiro (Sweden)","PAD (Canada)","Betalingsservice (Denmark)","Faster Payments (UK)"]}},"description":"Direct Debit scheme. Leave blank to let GoCardless pick automatically based on the bank details."}
   * @paramDef {"type":"String","label":"Mandate Reference","name":"reference","required":false,"description":"Your own reference for this mandate (e.g. customer number). Max 35 chars for UK Bacs, 140 for European SEPA. GoCardless generates one if you leave it blank."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","required":false,"description":"Optional notes - up to 3 key/value pairs."}
   * @paramDef {"type":"String","label":"Idempotency Key (Advanced)","name":"idempotencyKey","required":false,"description":"Advanced. Leave blank unless forcing a fresh creation."}
   * @returns {Object}
   */
  async createMandate(
    customerBankAccountId,
    scheme,
    reference,
    metadata,
    idempotencyKey
  ) {
    if (!customerBankAccountId) {
      throw new Error('[GoCardless] customerBankAccountId is required')
    }

    const body = {
      mandates:
        cleanupObject({
          scheme: resolveChoice(scheme, SCHEME_LABELS),
          reference,
          metadata: cleanupObject(metadata),
          links: { customer_bank_account: customerBankAccountId },
        }) || {},
    }

    return this.#createWithReplayRecovery({
      path: '/mandates',
      resourceKey: 'mandates',
      body,
      logTag: 'createMandate',
      idempotencyKey,
      idempotencyArgs: body,
    })
  }

  /**
   * @description Update the notes attached to a mandate. Only the notes (metadata) field is editable - bank details and scheme are fixed once a mandate exists.
   * @route POST /update-mandate
   * @operationName Update Mandate Notes
   * @category Mandates
   * @appearanceColor #1e88e5 #0d47a1
   * @sampleResultLoader {"methodName":"getMandate_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Mandate","name":"mandateId","required":true,"dictionary":"listMandatesDict","description":"Mandate to update."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","required":true,"description":"Replacement notes - up to 3 key/value pairs."}
   * @returns {Object}
   */
  async updateMandate(mandateId, metadata) {
    if (!mandateId) throw new Error('[GoCardless] mandateId is required')

    const response = await this.#api({
      path: `/mandates/${ mandateId }`,
      method: 'put',
      body: { mandates: { metadata: metadata || {} } },
      logTag: 'updateMandate',
    })

    return this.#unwrap(response, 'mandates')
  }

  /**
   * @description Cancel a mandate so you can no longer take payments from it. Use this when ending a subscription or after a customer asks to stop direct debits. UK Bacs mandates can be reinstated within a short window via Reinstate Mandate; other schemes need a fresh authorisation.
   * @route POST /cancel-mandate
   * @operationName Cancel Mandate
   * @category Mandates
   * @appearanceColor #1e88e5 #0d47a1
   * @sampleResultLoader {"methodName":"getMandate_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Mandate","name":"mandateId","required":true,"dictionary":"listMandatesDict","description":"Mandate to cancel."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","required":false,"description":"Optional notes to attach to the cancellation."}
   * @returns {Object}
   */
  async cancelMandate(mandateId, metadata) {
    if (!mandateId) throw new Error('[GoCardless] mandateId is required')

    const body = {
      data: cleanupObject({ metadata: cleanupObject(metadata) }) || {},
    }

    const response = await this.#api({
      path: `/mandates/${ mandateId }/actions/cancel`,
      method: 'post',
      body,
      logTag: 'cancelMandate',
    })

    return this.#unwrap(response, 'mandates')
  }

  /**
   * @description Bring back a cancelled or failed UK Bacs mandate without asking the customer to sign up again. Only works for the Bacs scheme; other schemes need a fresh authorisation via createBillingRequestFlow.
   * @route POST /reinstate-mandate
   * @operationName Reinstate Mandate (UK Bacs)
   * @category Mandates
   * @appearanceColor #1e88e5 #0d47a1
   * @sampleResultLoader {"methodName":"getMandate_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Mandate","name":"mandateId","required":true,"dictionary":"listMandatesDict","description":"Mandate to bring back."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","required":false,"description":"Optional notes."}
   * @returns {Object}
   */
  async reinstateMandate(mandateId, metadata) {
    if (!mandateId) throw new Error('[GoCardless] mandateId is required')

    const body = {
      data: cleanupObject({ metadata: cleanupObject(metadata) }) || {},
    }

    const response = await this.#api({
      path: `/mandates/${ mandateId }/actions/reinstate`,
      method: 'post',
      body,
      logTag: 'reinstateMandate',
    })

    return this.#unwrap(response, 'mandates')
  }

  /**
   * @description Generate a downloadable PDF copy of a signed mandate. Useful for audit trails and compliance records. The PDF URL expires after 30 minutes - download or store it right away.
   * @route POST /get-mandate-pdf
   * @operationName Get Mandate PDF
   * @category Mandates
   * @appearanceColor #1e88e5 #0d47a1
   * @paramDef {"type":"String","label":"Mandate","name":"mandateId","required":false,"dictionary":"listMandatesDict","description":"Existing mandate to render. Leave blank to render an unsigned PDF from raw bank details (provide them in Prefill below)."}
   * @paramDef {"type":"Object","label":"Prefill (Unsigned)","name":"prefill","required":false,"schemaLoader":"mandatePdfPrefillSchema","description":"Alternative: render a blank unsigned PDF from bank details. Fill these when no mandate is selected above."}
   * @returns {Object}
   * @sampleResult {"url":"https://pdfs.gocardless.com/MD000123456.pdf?signature=abc123","expires_at":"2026-05-16T10:30:00.000Z"}
   */
  async getMandatePdf(mandateId, prefill) {
    const body = {
      mandate_pdfs:
        cleanupObject({
          links: mandateId ? { mandate: mandateId } : undefined,
          ...(prefill || {}),
        }) || {},
    }

    const response = await this.#api({
      path: '/mandate_pdfs',
      method: 'post',
      body,
      logTag: 'getMandatePdf',
    })

    return this.#unwrap(response, 'mandate_pdfs')
  }

  // ===========================================================================
  // 5A. MANDATE IMPORTS
  // ===========================================================================
  // Bulk-migrate existing Direct Debit mandates from another provider. There is no endpoint to
  // list mandate imports, so mandateImportId params below carry no dictionary - keep the ID GC
  // returns from Create Mandate Import. Restricted to approved integrators by GoCardless.

  /**
   * @description Start migrating existing Direct Debit mandates from another provider into GoCardless. This opens an empty import - add each mandate with Add Mandate Import Entry, then Submit Mandate Import when done. GoCardless reviews and processes the import (sandbox auto-processes in about 10 seconds). Requires the Mandate Imports feature on your GoCardless account.
   * @route POST /create-mandate-import
   * @operationName Create Mandate Import
   * @category Mandate Imports
   * @appearanceColor #0097a7 #006064
   * @sampleResultLoader {"methodName":"getMandateImport_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Scheme","name":"scheme","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["ACH (US)","Autogiro (Sweden)","Bacs (UK)","BECS (Australia)","BECS (New Zealand)","Betalingsservice (Denmark)","Faster Payments (UK)","PAD (Canada)","PayTo (Australia)","SEPA Core (Europe)"]}},"description":"Direct Debit scheme of the mandates being imported. All mandates in one import must use the same scheme."}
   * @paramDef {"type":"String","label":"Creditor","name":"creditorId","required":false,"dictionary":"listCreditorsDict","description":"Which of your creditor accounts the imported mandates belong to. Only needed if your account manages multiple creditors - leave blank otherwise."}
   * @paramDef {"type":"String","label":"Idempotency Key (Advanced)","name":"idempotencyKey","required":false,"description":"Advanced. Leave blank unless forcing a fresh import when retrying."}
   * @returns {Object}
   */
  async createMandateImport(scheme, creditorId, idempotencyKey) {
    if (!scheme) throw new Error('[GoCardless] scheme is required')

    const body = {
      mandate_imports:
        cleanupObject({
          scheme: resolveChoice(scheme, SCHEME_LABELS),
          links: creditorId ? { creditor: creditorId } : undefined,
        }) || {},
    }

    return this.#createWithReplayRecovery({
      path: '/mandate_imports',
      resourceKey: 'mandate_imports',
      body,
      logTag: 'createMandateImport',
      idempotencyKey,
      idempotencyArgs: body,
    })
  }

  /**
   * @description Check the status of a mandate import - created (still accepting entries), submitted (waiting for GoCardless to process), processing, processed (mandates created - reconcile with List Mandate Import Entries), or cancelled.
   * @route POST /get-mandate-import
   * @operationName Get Mandate Import
   * @category Mandate Imports
   * @appearanceColor #0097a7 #006064
   * @sampleResultLoader {"methodName":"getMandateImport_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Mandate Import","name":"mandateImportId","required":true,"description":"ID of the mandate import (starts with IM). GoCardless has no endpoint to list mandate imports, so paste the ID returned by Create Mandate Import."}
   * @returns {Object}
   */
  async getMandateImport(mandateImportId) {
    if (!mandateImportId)
      throw new Error('[GoCardless] mandateImportId is required')

    const response = await this.#api({
      path: `/mandate_imports/${ mandateImportId }`,
      logTag: 'getMandateImport',
    })

    return this.#unwrap(response, 'mandate_imports')
  }

  /**
   * @description Finish adding entries and hand the import over to GoCardless for processing. After submitting you can no longer add entries. In sandbox the import is processed automatically about 10 seconds later; in live a GoCardless team member approves it.
   * @route POST /submit-mandate-import
   * @operationName Submit Mandate Import
   * @category Mandate Imports
   * @appearanceColor #0097a7 #006064
   * @sampleResultLoader {"methodName":"getMandateImport_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Mandate Import","name":"mandateImportId","required":true,"description":"ID of the mandate import to submit (starts with IM), from Create Mandate Import. No list endpoint exists to pick it from."}
   * @returns {Object}
   */
  async submitMandateImport(mandateImportId) {
    if (!mandateImportId)
      throw new Error('[GoCardless] mandateImportId is required')

    const response = await this.#api({
      path: `/mandate_imports/${ mandateImportId }/actions/submit`,
      method: 'post',
      body: {},
      logTag: 'submitMandateImport',
    })

    return this.#unwrap(response, 'mandate_imports')
  }

  /**
   * @description Abort a mandate import before it is submitted - none of its entries become mandates. Imports that were already submitted or processed cannot be cancelled.
   * @route POST /cancel-mandate-import
   * @operationName Cancel Mandate Import
   * @category Mandate Imports
   * @appearanceColor #0097a7 #006064
   * @sampleResultLoader {"methodName":"getMandateImport_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Mandate Import","name":"mandateImportId","required":true,"description":"ID of the mandate import to cancel (starts with IM), from Create Mandate Import. No list endpoint exists to pick it from."}
   * @returns {Object}
   */
  async cancelMandateImport(mandateImportId) {
    if (!mandateImportId)
      throw new Error('[GoCardless] mandateImportId is required')

    const response = await this.#api({
      path: `/mandate_imports/${ mandateImportId }/actions/cancel`,
      method: 'post',
      body: {},
      logTag: 'cancelMandateImport',
    })

    return this.#unwrap(response, 'mandate_imports')
  }

  /**
   * @description Add one existing mandate to an open import - the customer's identity, their bank account, and (for SEPA moves) the original mandate reference. Each entry becomes a real mandate when the import is processed. Give every entry a Record Identifier so you can match the created mandate back to your system afterwards. Limit: 30,000 entries per import.
   * @route POST /add-mandate-import-entry
   * @operationName Add Mandate Import Entry
   * @category Mandate Imports
   * @appearanceColor #0097a7 #006064
   * @paramDef {"type":"String","label":"Mandate Import","name":"mandateImportId","required":true,"description":"ID of the open mandate import to add this entry to (starts with IM), from Create Mandate Import. No list endpoint exists to pick it from."}
   * @paramDef {"type":"Object","label":"Customer","name":"customer","required":true,"schemaLoader":"mandateImportEntryCustomerSchema","description":"Who the mandate belongs to. Provide first + last name or a company name; email is needed in most cases so GoCardless can notify them. Bacs and SEPA imports also require address line 1 and postal code."}
   * @paramDef {"type":"Object","label":"Bank Account","name":"bankAccount","required":true,"schemaLoader":"mandateImportEntryBankAccountSchema","description":"The customer's bank account the mandate is on. Account holder name is required; then either an IBAN (most of Europe) or local details (account number + sort/branch/bank code)."}
   * @paramDef {"type":"Object","label":"Amendment (SEPA Only)","name":"amendment","required":false,"schemaLoader":"mandateImportEntryAmendmentSchema","description":"Details of the original mandate at the previous provider. Required for SEPA imports (original mandate reference + original creditor ID); leave blank for other schemes."}
   * @paramDef {"type":"String","label":"Record Identifier","name":"recordIdentifier","required":false,"description":"Your own unique reference for this entry (e.g. a row number or customer ID, max 255 characters). After processing, List Mandate Import Entries returns it next to the created mandate so you can link records in your system."}
   * @paramDef {"type":"String","label":"Mandate Reference","name":"mandateReference","required":false,"description":"Reference for the new mandate. Leave blank to let GoCardless generate one that satisfies the scheme's rules."}
   * @paramDef {"type":"Object","label":"Mandate Metadata","name":"mandateMetadata","required":false,"description":"Optional notes stored on the created mandate - up to 3 key/value pairs."}
   * @paramDef {"type":"String","label":"Idempotency Key (Advanced)","name":"idempotencyKey","required":false,"description":"Advanced. Leave blank unless forcing a duplicate entry when retrying."}
   * @returns {Object}
   * @sampleResult {"record_identifier":"bank-file.xml/line-1","created_at":"2026-05-16T10:00:00.000Z","links":{"mandate_import":"IM000010790WX1"}}
   */
  async addMandateImportEntry(
    mandateImportId,
    customer,
    bankAccount,
    amendment,
    recordIdentifier,
    mandateReference,
    mandateMetadata,
    idempotencyKey
  ) {
    if (!mandateImportId)
      throw new Error('[GoCardless] mandateImportId is required')
    if (!customer) throw new Error('[GoCardless] customer is required')
    if (!bankAccount) throw new Error('[GoCardless] bankAccount is required')

    const body = {
      mandate_import_entries:
        cleanupObject({
          links: { mandate_import: mandateImportId },
          record_identifier: recordIdentifier,
          customer: cleanupObject(customer),
          bank_account: cleanupObject(bankAccount),
          amendment: cleanupObject(amendment),
          mandate: cleanupObject({
            reference: mandateReference,
            metadata: cleanupObject(mandateMetadata),
          }),
        }) || {},
    }

    const response = await this.#api({
      path: '/mandate_import_entries',
      method: 'post',
      body,
      logTag: 'addMandateImportEntry',
      idempotencyKey,
      idempotencyArgs: body,
    })

    return this.#unwrap(response, 'mandate_import_entries')
  }

  /**
   * @description See every entry in a mandate import and, once the import is processed, which customer, bank account, and mandate each entry created - plus any processing errors for entries that failed. Match rows back to your system with the Record Identifier you set when adding entries.
   * @route POST /list-mandate-import-entries
   * @operationName List Mandate Import Entries
   * @category Mandate Imports
   * @appearanceColor #0097a7 #006064
   * @paramDef {"type":"String","label":"Mandate Import","name":"mandateImportId","required":true,"description":"ID of the mandate import whose entries to list (starts with IM), from Create Mandate Import. No list endpoint exists to pick it from."}
   * @paramDef {"type":"String","label":"Processing Result","name":"status","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Successfully Processed","Unsuccessfully Processed"]}},"description":"Only show entries that processed successfully, or only those that failed (check each failed entry's processing_errors for the reason). Leave blank for all entries."}
   * @paramDef {"type":"Number","label":"Page Size","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many entries per page (1 to 500). Defaults to 50."}
   * @paramDef {"type":"String","label":"Next Page Token","name":"cursor","required":false,"description":"Advanced. To fetch the next page manually, paste the 'cursors.after' value from a previous response here."}
   * @returns {Object}
   * @sampleResult {"items":[{"record_identifier":"bank-file.xml/line-1","created_at":"2026-05-16T10:00:00.000Z","links":{"mandate_import":"IM000010790WX1","customer":"CU000123456","customer_bank_account":"BA000123456","mandate":"MD000123456"},"processing_errors":null}],"data":[{"record_identifier":"bank-file.xml/line-1","created_at":"2026-05-16T10:00:00.000Z","links":{"mandate_import":"IM000010790WX1","customer":"CU000123456","customer_bank_account":"BA000123456","mandate":"MD000123456"},"processing_errors":null}],"cursors":{"before":null,"after":null},"limit":50,"hasMore":false}
   */
  async listMandateImportEntries(mandateImportId, status, limit, cursor) {
    if (!mandateImportId)
      throw new Error('[GoCardless] mandateImportId is required')

    const response = await this.#api({
      path: '/mandate_import_entries',
      logTag: 'listMandateImportEntries',
      query: cleanupObject({
        mandate_import: mandateImportId,
        status: resolveChoice(status, MANDATE_IMPORT_ENTRY_STATUS_LABELS),
        limit: this.#clampLimit(limit),
        after: cursor,
      }),
    })

    return this.#unwrapList(response, 'mandate_import_entries')
  }

  // ===========================================================================
  // 5B. CREDITORS
  // ===========================================================================

  /**
   * @description List your GoCardless creditor accounts (the businesses payments are paid out to) with their verification status and payout bank links. Most merchants have exactly one. Companion to Get/Update Creditor for flows that need the full record rather than a dropdown pick.
   * @route POST /list-creditors
   * @operationName List Creditors
   * @category Creditors
   * @appearanceColor #f9a825 #f57f17
   * @sampleResultLoader {"methodName":"getCreditor_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"Number","label":"Page Size","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many creditors per page (1 to 500). Defaults to 50."}
   * @paramDef {"type":"String","label":"Next Page Token","name":"cursor","required":false,"description":"Advanced. To fetch the next page manually, paste the 'cursors.after' value from a previous response here."}
   * @returns {Object}
   */
  async listCreditors(limit, cursor) {
    const response = await this.#api({
      path: '/creditors',
      logTag: 'listCreditors',
      query: cleanupObject({
        limit: this.#clampLimit(limit),
        after: cursor,
      }),
    })

    return this.#unwrapList(response, 'creditors')
  }

  /**
   * @description Fetch one creditor account - trading name, address, verification status (whether it can receive payouts yet), refund permission, feature flags (e.g. whether Mandate Imports is enabled), and which bank accounts receive payouts per currency.
   * @route POST /get-creditor
   * @operationName Get Creditor
   * @category Creditors
   * @appearanceColor #f9a825 #f57f17
   * @sampleResultLoader {"methodName":"getCreditor_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Creditor","name":"creditorId","required":true,"dictionary":"listCreditorsDict","description":"Pick the creditor account to fetch (its ID starts with CR)."}
   * @returns {Object}
   */
  async getCreditor(creditorId) {
    if (!creditorId) throw new Error('[GoCardless] creditorId is required')

    const response = await this.#api({
      path: `/creditors/${ creditorId }`,
      logTag: 'getCreditor',
    })

    return this.#unwrap(response, 'creditors')
  }

  /**
   * @description Change a creditor's trading name, address, payout bank-reference prefix, or which saved bank account receives payouts in each currency. Only the fields you fill are changed.
   * @route POST /update-creditor
   * @operationName Update Creditor
   * @category Creditors
   * @appearanceColor #f9a825 #f57f17
   * @sampleResultLoader {"methodName":"getCreditor_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Creditor","name":"creditorId","required":true,"dictionary":"listCreditorsDict","description":"Pick the creditor account to update (its ID starts with CR)."}
   * @paramDef {"type":"String","label":"Trading Name","name":"name","required":false,"description":"The creditor's trading name, shown to customers."}
   * @paramDef {"type":"String","label":"Address Line 1","name":"addressLine1","required":false,"description":"First line of the creditor's address."}
   * @paramDef {"type":"String","label":"Address Line 2","name":"addressLine2","required":false,"description":"Second line of the creditor's address."}
   * @paramDef {"type":"String","label":"Address Line 3","name":"addressLine3","required":false,"description":"Third line of the creditor's address."}
   * @paramDef {"type":"String","label":"City","name":"city","required":false,"description":"City of the creditor's address."}
   * @paramDef {"type":"String","label":"Region","name":"region","required":false,"description":"Region, county, or department of the creditor's address."}
   * @paramDef {"type":"String","label":"Postal Code","name":"postalCode","required":false,"description":"Postal or ZIP code of the creditor's address."}
   * @paramDef {"type":"String","label":"Country","name":"countryCode","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["United Kingdom","Germany","France","Netherlands","Spain","Italy","Ireland","Austria","Belgium","Portugal","Finland","Luxembourg","Sweden","Denmark","Australia","New Zealand","Canada","United States"]}},"description":"Country of the creditor's address."}
   * @paramDef {"type":"String","label":"Payout Bank Reference Prefix","name":"bankReferencePrefix","required":false,"description":"Prefix on the bank reference of payouts sent to this creditor - e.g. prefix ACME produces payout references like ACME-8G7Q8. Also used for EUR and GBP refunds."}
   * @paramDef {"type":"Object","label":"Payout Bank Accounts","name":"payoutAccountLinks","required":false,"schemaLoader":"creditorPayoutAccountsSchema","description":"Which saved bank account receives payouts in each currency. Fill only the currencies you want to change, using bank account IDs (start with BA)."}
   * @returns {Object}
   */
  async updateCreditor(
    creditorId,
    name,
    addressLine1,
    addressLine2,
    addressLine3,
    city,
    region,
    postalCode,
    countryCode,
    bankReferencePrefix,
    payoutAccountLinks
  ) {
    if (!creditorId) throw new Error('[GoCardless] creditorId is required')

    const response = await this.#api({
      path: `/creditors/${ creditorId }`,
      method: 'put',
      body: {
        creditors:
          cleanupObject({
            name,
            address_line1: addressLine1,
            address_line2: addressLine2,
            address_line3: addressLine3,
            city,
            region,
            postal_code: postalCode,
            country_code: resolveChoice(countryCode, COUNTRY_LABELS),
            bank_reference_prefix: bankReferencePrefix,
            links: cleanupObject(payoutAccountLinks),
          }) || {},
      },
      logTag: 'updateCreditor',
    })

    return this.#unwrap(response, 'creditors')
  }

  // ===========================================================================
  // 6. PAYMENTS
  // ===========================================================================

  /**
   * @description List payments you've collected. Filter by customer, mandate, subscription, status, or date. Use for reconciliation against your accounting system, finding failed payments to follow up on, or pulling a settlement report.
   * @route POST /list-payments
   * @operationName List Payments
   * @category Payments
   * @appearanceColor #ff7043 #d84315
   * @sampleResultLoader {"methodName":"getPayment_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Mandate","name":"mandateId","required":false,"dictionary":"listMandatesDict","description":"Only show payments collected under this mandate."}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":false,"dictionary":"listCustomersDict","description":"Only show payments from this customer."}
   * @paramDef {"type":"String","label":"Subscription","name":"subscriptionId","required":false,"dictionary":"listSubscriptionsDict","description":"Only show payments generated by this subscription."}
   * @paramDef {"type":"Array<String>","label":"Status","name":"status","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Pending Customer Approval","Pending Submission","Submitted","Confirmed","Paid Out","Failed","Cancelled","Charged Back"],"multiple":true}},"description":"Pick one or more states. Most-used: 'paid_out' (money in your bank), 'failed' (bounced), 'confirmed' (taken but not yet settled to you)."}
   * @paramDef {"type":"String","label":"Created Date Range","name":"period","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Custom Range","Today","Yesterday","Last 7 Days","Last 30 Days","Last 90 Days","Month to Date","Year to Date"]}},"description":"Filter by when the payment was CREATED (not its charge date). Pick a preset for a quick window. To filter by charge date instead, use the Charge Date After/Before fields below. Ignored when either Charge Date field is set."}
   * @paramDef {"type":"String","label":"Charge Date After","name":"chargeDateAfter","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Only return payments charged on or after this date."}
   * @paramDef {"type":"String","label":"Charge Date Before","name":"chargeDateBefore","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Only return payments charged on or before this date."}
   * @paramDef {"type":"Number","label":"Page Size","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many payments per page (1 to 500). Defaults to 50."}
   * @paramDef {"type":"Boolean","label":"Fetch All Pages","name":"fetchAll","required":false,"uiComponent":{"type":"TOGGLE"},"description":"When on, pages through every matching payment (up to 100 pages = 50,000 records)."}
   * @paramDef {"type":"String","label":"Next Page Token","name":"cursor","required":false,"description":"Advanced. Paste 'cursors.after' from a previous response."}
   * @returns {Object}
   */
  async listPayments(
    mandateId,
    customerId,
    subscriptionId,
    status,
    period,
    chargeDateAfter,
    chargeDateBefore,
    limit,
    fetchAll,
    cursor
  ) {
    const createdAt = buildCreatedAtFilter({
      period,
      createdAfter: chargeDateAfter,
      createdBefore: chargeDateBefore,
    })

    const baseQuery = cleanupObject({
      mandate: mandateId,
      customer: customerId,
      subscription: subscriptionId,
      status: toCommaList(resolveChoices(status, PAYMENT_STATUS_LABELS)),
      'charge_date[gte]': chargeDateAfter
        ? toIsoDateTime(chargeDateAfter).slice(0, 10)
        : undefined,
      'charge_date[lte]': chargeDateBefore
        ? toIsoDateTime(chargeDateBefore).slice(0, 10)
        : undefined,
      limit: this.#clampLimit(limit),
      ...(createdAt && !chargeDateAfter && !chargeDateBefore
        ? this.#flattenCreatedAt(createdAt)
        : {}),
    })

    if (fetchAll) {
      const result = await fetchAllPages(
        async after => {
          const page = await this.#api({
            path: '/payments',
            logTag: 'listPayments:fetchAll',
            query: { ...baseQuery, after },
          })

          return {
            items: page?.payments || [],
            cursors: page?.meta?.cursors || {},
          }
        },
        { maxPages: FETCH_ALL_MAX_PAGES }
      )

      return {
        data: result.items,
        items: result.items,
        pageCount: result.pageCount,
        truncated: result.truncated,
      }
    }

    const response = await this.#api({
      path: '/payments',
      logTag: 'listPayments',
      query: { ...baseQuery, after: cursor },
    })

    return this.#unwrapList(response, 'payments')
  }

  /**
   * @description Fetch one payment - amount, currency, status, charge date, links to mandate/customer.
   * @route POST /get-payment
   * @operationName Get Payment
   * @category Payments
   * @appearanceColor #ff7043 #d84315
   * @sampleResultLoader {"methodName":"getPayment_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Payment","name":"paymentId","required":true,"dictionary":"listPaymentsDict","description":"Pick the payment."}
   * @returns {Object}
   */
  async getPayment(paymentId) {
    if (!paymentId) throw new Error('[GoCardless] paymentId is required')

    const response = await this.#api({
      path: `/payments/${ paymentId }`,
      logTag: 'getPayment',
    })

    return this.#unwrap(response, 'payments')
  }

  /**
   * @description Charge a one-off payment against an active mandate. The customer's bank will be debited on the charge date. Use for one-time invoices, top-ups, or anything not on a recurring subscription.
   * @route POST /create-payment
   * @operationName Create Payment
   * @category Payments
   * @appearanceColor #ff7043 #d84315
   * @sampleResultLoader {"methodName":"getPayment_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Mandate","name":"mandateId","required":true,"dictionary":"listMandatesDict","description":"Active mandate to charge."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Amount in the smallest currency unit. GBP 10.00 = 1000, EUR 10.00 = 1000, $10.00 = 1000. Always enter whole numbers - no decimals."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["British Pound","Euro","US Dollar","Swedish Krona","Australian Dollar","New Zealand Dollar","Canadian Dollar","Danish Krone"]}},"description":"Currency for this payment. Must match the mandate's currency."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Short description (max 100 characters). Appears on the customer's bank statement on schemes that support it."}
   * @paramDef {"type":"String","label":"Charge Date","name":"chargeDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Earliest date GoCardless will attempt the charge. Leave blank to use the soonest possible date (varies by scheme - Bacs typically takes 3 business days)."}
   * @paramDef {"type":"String","label":"Payment Reference","name":"reference","required":false,"description":"Your own reference for this payment (e.g. invoice number). Appears on payouts and reports."}
   * @paramDef {"type":"Number","label":"App Fee","name":"appFee","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Partner-only. Your fee in the smallest currency unit. Most users leave blank."}
   * @paramDef {"type":"Boolean","label":"Auto-Retry On Failure","name":"retryIfPossible","required":false,"uiComponent":{"type":"TOGGLE"},"description":"When on, GoCardless automatically retries this payment once if it fails (subject to scheme rules)."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","required":false,"description":"Optional notes - up to 3 key/value pairs."}
   * @paramDef {"type":"String","label":"Idempotency Key (Advanced)","name":"idempotencyKey","required":false,"description":"Advanced. Leave blank unless forcing a fresh charge when retrying."}
   * @returns {Object}
   */
  async createPayment(
    mandateId,
    amount,
    currency,
    description,
    chargeDate,
    reference,
    appFee,
    retryIfPossible,
    metadata,
    idempotencyKey
  ) {
    if (!mandateId) throw new Error('[GoCardless] mandateId is required')

    if (amount === undefined || amount === null) {
      throw new Error(
        '[GoCardless] amount is required (whole number in the smallest currency unit)'
      )
    }

    if (!currency) throw new Error('[GoCardless] currency is required')

    const body = {
      payments:
        cleanupObject({
          amount: toMinorUnits(amount),
          currency: resolveChoice(currency, CURRENCY_LABELS),
          description,
          charge_date: chargeDate
            ? toIsoDateTime(chargeDate).slice(0, 10)
            : undefined,
          reference,
          app_fee: toMinorUnits(appFee),
          retry_if_possible: retryIfPossible,
          metadata: cleanupObject(metadata),
          links: { mandate: mandateId },
        }) || {},
    }

    return this.#createWithReplayRecovery({
      path: '/payments',
      resourceKey: 'payments',
      body,
      logTag: 'createPayment',
      idempotencyKey,
      idempotencyArgs: body,
      uniqueIdempotency: true,
    })
  }

  /**
   * @description Update a payment's notes or auto-retry behaviour. Amount, currency, and charge date are fixed once a payment exists.
   * @route POST /update-payment
   * @operationName Update Payment
   * @category Payments
   * @appearanceColor #ff7043 #d84315
   * @sampleResultLoader {"methodName":"getPayment_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Payment","name":"paymentId","required":true,"dictionary":"listPaymentsDict","description":"Payment to update."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","required":false,"description":"Replacement notes - up to 3 key/value pairs."}
   * @paramDef {"type":"Boolean","label":"Auto-Retry On Failure","name":"retryIfPossible","required":false,"uiComponent":{"type":"TOGGLE"},"description":"Turn auto-retry on or off."}
   * @returns {Object}
   */
  async updatePayment(paymentId, metadata, retryIfPossible) {
    if (!paymentId) throw new Error('[GoCardless] paymentId is required')

    const response = await this.#api({
      path: `/payments/${ paymentId }`,
      method: 'put',
      body: {
        payments:
          cleanupObject({
            metadata: cleanupObject(metadata),
            retry_if_possible: retryIfPossible,
          }) || {},
      },
      logTag: 'updatePayment',
    })

    return this.#unwrap(response, 'payments')
  }

  /**
   * @description Cancel a payment before the money actually reaches you. Works until the payment is paid out - after that, use Create Refund instead. Useful for stopping a duplicate or wrong-amount charge in flight.
   * @route POST /cancel-payment
   * @operationName Cancel Payment
   * @category Payments
   * @appearanceColor #ff7043 #d84315
   * @sampleResultLoader {"methodName":"getPayment_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Payment","name":"paymentId","required":true,"dictionary":"listPaymentsDict","description":"Payment to cancel."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","required":false,"description":"Optional notes."}
   * @returns {Object}
   */
  async cancelPayment(paymentId, metadata) {
    if (!paymentId) throw new Error('[GoCardless] paymentId is required')

    const response = await this.#api({
      path: `/payments/${ paymentId }/actions/cancel`,
      method: 'post',
      body: {
        data: cleanupObject({ metadata: cleanupObject(metadata) }) || {},
      },
      logTag: 'cancelPayment',
    })

    return this.#unwrap(response, 'payments')
  }

  /**
   * @description Retry a failed payment. Only works for payments in 'failed' state and within the scheme's retry window (about 21 days). After that, you have to create a fresh payment.
   * @route POST /retry-payment
   * @operationName Retry Payment
   * @category Payments
   * @appearanceColor #ff7043 #d84315
   * @sampleResultLoader {"methodName":"getPayment_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Payment","name":"paymentId","required":true,"dictionary":"listPaymentsDict","description":"Failed payment to retry."}
   * @paramDef {"type":"String","label":"New Charge Date","name":"chargeDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"When to retry. Leave blank for the earliest possible date."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","required":false,"description":"Optional notes."}
   * @returns {Object}
   */
  async retryPayment(paymentId, chargeDate, metadata) {
    if (!paymentId) throw new Error('[GoCardless] paymentId is required')

    const body = {
      data:
        cleanupObject({
          charge_date: chargeDate
            ? toIsoDateTime(chargeDate).slice(0, 10)
            : undefined,
          metadata: cleanupObject(metadata),
        }) || {},
    }

    const response = await this.#api({
      path: `/payments/${ paymentId }/actions/retry`,
      method: 'post',
      body,
      logTag: 'retryPayment',
    })

    return this.#unwrap(response, 'payments')
  }

  // ===========================================================================
  // 7. SUBSCRIPTIONS
  // ===========================================================================

  /**
   * @description List recurring subscriptions. Filter by mandate, customer, or status. Use for active-customer reports, churn analysis, or finding paused subscriptions to resume.
   * @route POST /list-subscriptions
   * @operationName List Subscriptions
   * @category Subscriptions
   * @appearanceColor #8e24aa #4a148c
   * @sampleResultLoader {"methodName":"getSubscription_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Mandate","name":"mandateId","required":false,"dictionary":"listMandatesDict","description":"Only show subscriptions billing this mandate."}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":false,"dictionary":"listCustomersDict","description":"Only show subscriptions for any mandate belonging to this customer."}
   * @paramDef {"type":"Array<String>","label":"Status","name":"status","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Paused","Finished","Cancelled","Customer Approval Denied"],"multiple":true}},"description":"Pick one or more states. Most-used: 'active' and 'paused'."}
   * @paramDef {"type":"Number","label":"Page Size","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many subscriptions per page (1 to 500). Defaults to 50."}
   * @paramDef {"type":"String","label":"Next Page Token","name":"cursor","required":false,"description":"Advanced. Paste 'cursors.after' from a previous response."}
   * @returns {Object}
   */
  async listSubscriptions(mandateId, customerId, status, limit, cursor) {
    const response = await this.#api({
      path: '/subscriptions',
      logTag: 'listSubscriptions',
      query: cleanupObject({
        mandate: mandateId,
        customer: customerId,
        status: toCommaList(resolveChoices(status, SUBSCRIPTION_STATUS_LABELS)),
        limit: this.#clampLimit(limit),
        after: cursor,
      }),
    })

    return this.#unwrapList(response, 'subscriptions')
  }

  /**
   * @description Fetch one subscription - name, amount, interval, status, upcoming charge dates.
   * @route POST /get-subscription
   * @operationName Get Subscription
   * @category Subscriptions
   * @appearanceColor #8e24aa #4a148c
   * @sampleResultLoader {"methodName":"getSubscription_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Subscription","name":"subscriptionId","required":true,"dictionary":"listSubscriptionsDict","description":"Pick the subscription."}
   * @returns {Object}
   */
  async getSubscription(subscriptionId) {
    if (!subscriptionId)
      throw new Error('[GoCardless] subscriptionId is required')

    const response = await this.#api({
      path: `/subscriptions/${ subscriptionId }`,
      logTag: 'getSubscription',
    })

    return this.#unwrap(response, 'subscriptions')
  }

  /**
   * @description Set up a recurring subscription. Charges generate automatically on the schedule until cancelled, the count is reached, or the end date passes. Use for memberships, monthly invoices, instalment plans, anything billed on a regular cadence.
   * @route POST /create-subscription
   * @operationName Create Subscription
   * @category Subscriptions
   * @appearanceColor #8e24aa #4a148c
   * @sampleResultLoader {"methodName":"getSubscription_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Mandate","name":"mandateId","required":true,"dictionary":"listMandatesDict","description":"Active mandate that will be charged each cycle."}
   * @paramDef {"type":"Number","label":"Amount Per Cycle","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Amount each cycle in the smallest currency unit. GBP 15.00 = 1500. Whole numbers only."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["British Pound","Euro","US Dollar","Swedish Krona","Australian Dollar","New Zealand Dollar","Canadian Dollar","Danish Krone"]}},"description":"Currency for the subscription."}
   * @paramDef {"type":"Number","label":"Interval","name":"interval","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of units between charges. Example: 1 with monthly = every month; 3 with monthly = quarterly."}
   * @paramDef {"type":"String","label":"Interval Unit","name":"intervalUnit","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Weekly","Monthly","Yearly"]}},"description":"Pair with Interval above to set the cadence."}
   * @paramDef {"type":"String","label":"Subscription Name","name":"name","required":false,"description":"Human-readable name (e.g. 'Pro Plan'). Appears on the payer's notifications."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Date of the first charge. Leave blank for the earliest possible date."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Date after which no more charges are generated. Cannot be combined with Total Cycles below."}
   * @paramDef {"type":"Number","label":"Total Cycles","name":"count","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Total number of charges before the subscription auto-finishes. Cannot be combined with End Date above."}
   * @paramDef {"type":"Number","label":"Day Of Month","name":"dayOfMonth","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Day of the month to charge on (1-28, or -1 for last day). Only used when Interval Unit is monthly or yearly."}
   * @paramDef {"type":"String","label":"Month","name":"month","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["January","February","March","April","May","June","July","August","September","October","November","December"]}},"description":"Month of the year to charge on. Only used when Interval Unit is yearly."}
   * @paramDef {"type":"Number","label":"App Fee","name":"appFee","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Partner-only. Your fee per cycle in the smallest currency unit."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","required":false,"description":"Optional notes - up to 3 key/value pairs."}
   * @paramDef {"type":"String","label":"Idempotency Key (Advanced)","name":"idempotencyKey","required":false,"description":"Advanced. Leave blank unless forcing a fresh creation."}
   * @returns {Object}
   */
  async createSubscription(
    mandateId,
    amount,
    currency,
    interval,
    intervalUnit,
    name,
    startDate,
    endDate,
    count,
    dayOfMonth,
    month,
    appFee,
    metadata,
    idempotencyKey
  ) {
    if (!mandateId) throw new Error('[GoCardless] mandateId is required')
    if (!currency) throw new Error('[GoCardless] currency is required')

    const body = {
      subscriptions:
        cleanupObject({
          amount: toMinorUnits(amount),
          currency: resolveChoice(currency, CURRENCY_LABELS),
          interval,
          interval_unit: resolveChoice(intervalUnit, INTERVAL_UNIT_LABELS),
          name,
          start_date: startDate
            ? toIsoDateTime(startDate).slice(0, 10)
            : undefined,
          end_date: endDate ? toIsoDateTime(endDate).slice(0, 10) : undefined,
          count,
          day_of_month: dayOfMonth,
          month: resolveChoice(month, MONTH_LABELS),
          app_fee: toMinorUnits(appFee),
          metadata: cleanupObject(metadata),
          links: { mandate: mandateId },
        }) || {},
    }

    return this.#createWithReplayRecovery({
      path: '/subscriptions',
      resourceKey: 'subscriptions',
      body,
      logTag: 'createSubscription',
      idempotencyKey,
      idempotencyArgs: body,
      uniqueIdempotency: true,
    })
  }

  /**
   * @description Update a subscription's name, payment reference, amount (active only), notes, or app fee. The cadence (interval, start/end, day-of-month) is fixed once created.
   * @route POST /update-subscription
   * @operationName Update Subscription
   * @category Subscriptions
   * @appearanceColor #8e24aa #4a148c
   * @sampleResultLoader {"methodName":"getSubscription_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Subscription","name":"subscriptionId","required":true,"dictionary":"listSubscriptionsDict","description":"Subscription to update."}
   * @paramDef {"type":"String","label":"New Name","name":"name","required":false,"description":"New display name shown on payer notifications."}
   * @paramDef {"type":"String","label":"New Payment Reference","name":"paymentReference","required":false,"description":"New reference attached to each generated payment."}
   * @paramDef {"type":"Number","label":"New Amount","name":"amount","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New amount per cycle in the smallest currency unit (e.g. 2000 = GBP 20). Only allowed on active subscriptions."}
   * @paramDef {"type":"Number","label":"New App Fee","name":"appFee","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Partner-only. New fee per cycle."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","required":false,"description":"Replacement notes - up to 3 key/value pairs."}
   * @returns {Object}
   */
  async updateSubscription(
    subscriptionId,
    name,
    paymentReference,
    amount,
    appFee,
    metadata
  ) {
    if (!subscriptionId)
      throw new Error('[GoCardless] subscriptionId is required')

    const body = {
      subscriptions:
        cleanupObject({
          name,
          payment_reference: paymentReference,
          amount: amount !== undefined ? toMinorUnits(amount) : undefined,
          app_fee: appFee !== undefined ? toMinorUnits(appFee) : undefined,
          metadata: cleanupObject(metadata),
        }) || {},
    }

    const response = await this.#api({
      path: `/subscriptions/${ subscriptionId }`,
      method: 'put',
      body,
      logTag: 'updateSubscription',
    })

    return this.#unwrap(response, 'subscriptions')
  }

  /**
   * @description Pause a subscription temporarily. Choose how many cycles to skip, or leave the count blank to pause indefinitely until you Resume.
   * @route POST /pause-subscription
   * @operationName Pause Subscription
   * @category Subscriptions
   * @appearanceColor #8e24aa #4a148c
   * @sampleResultLoader {"methodName":"getSubscription_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Subscription","name":"subscriptionId","required":true,"dictionary":"listSubscriptionsDict","description":"Subscription to pause."}
   * @paramDef {"type":"Number","label":"Pause For Cycles","name":"pauseCycles","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of upcoming cycles to skip. Leave blank to pause indefinitely."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","required":false,"description":"Optional notes."}
   * @returns {Object}
   */
  async pauseSubscription(subscriptionId, pauseCycles, metadata) {
    if (!subscriptionId)
      throw new Error('[GoCardless] subscriptionId is required')

    const body = {
      data:
        cleanupObject({
          pause_cycles: pauseCycles,
          metadata: cleanupObject(metadata),
        }) || {},
    }

    const response = await this.#api({
      path: `/subscriptions/${ subscriptionId }/actions/pause`,
      method: 'post',
      body,
      logTag: 'pauseSubscription',
    })

    return this.#unwrap(response, 'subscriptions')
  }

  /**
   * @description Resume a paused subscription. Charges start again from the next scheduled date.
   * @route POST /resume-subscription
   * @operationName Resume Subscription
   * @category Subscriptions
   * @appearanceColor #8e24aa #4a148c
   * @sampleResultLoader {"methodName":"getSubscription_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Subscription","name":"subscriptionId","required":true,"dictionary":"listSubscriptionsDict","description":"Subscription to resume."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","required":false,"description":"Optional notes."}
   * @returns {Object}
   */
  async resumeSubscription(subscriptionId, metadata) {
    if (!subscriptionId)
      throw new Error('[GoCardless] subscriptionId is required')

    const response = await this.#api({
      path: `/subscriptions/${ subscriptionId }/actions/resume`,
      method: 'post',
      body: {
        data: cleanupObject({ metadata: cleanupObject(metadata) }) || {},
      },
      logTag: 'resumeSubscription',
    })

    return this.#unwrap(response, 'subscriptions')
  }

  /**
   * @description Cancel a subscription so no more charges are generated. Cannot be undone - to start billing again, create a new subscription.
   * @route POST /cancel-subscription
   * @operationName Cancel Subscription
   * @category Subscriptions
   * @appearanceColor #8e24aa #4a148c
   * @sampleResultLoader {"methodName":"getSubscription_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Subscription","name":"subscriptionId","required":true,"dictionary":"listSubscriptionsDict","description":"Subscription to cancel."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","required":false,"description":"Optional notes."}
   * @returns {Object}
   */
  async cancelSubscription(subscriptionId, metadata) {
    if (!subscriptionId)
      throw new Error('[GoCardless] subscriptionId is required')

    const response = await this.#api({
      path: `/subscriptions/${ subscriptionId }/actions/cancel`,
      method: 'post',
      body: {
        data: cleanupObject({ metadata: cleanupObject(metadata) }) || {},
      },
      logTag: 'cancelSubscription',
    })

    return this.#unwrap(response, 'subscriptions')
  }

  // ===========================================================================
  // 7b. INSTALMENT SCHEDULES
  // ===========================================================================

  /**
   * @description List instalment schedules - fixed sets of payments collected on a schedule against one mandate. Filter by mandate, customer, or status. Use for reporting on payment plans.
   * @route POST /list-instalment-schedules
   * @operationName List Instalment Schedules
   * @category Instalment Schedules
   * @appearanceColor #6d4c41 #3e2723
   * @sampleResultLoader {"methodName":"getInstalmentSchedule_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Mandate","name":"mandateId","required":false,"dictionary":"listMandatesDict","description":"Only show instalment schedules billing this mandate."}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":false,"dictionary":"listCustomersDict","description":"Only show instalment schedules for mandates belonging to this customer."}
   * @paramDef {"type":"Array<String>","label":"Status","name":"status","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Pending","Active","Creating","Errored","Cancelled","Completed"],"multiple":true}},"description":"Pick one or more states to include."}
   * @paramDef {"type":"Number","label":"Page Size","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many per page (1 to 500). Defaults to 50."}
   * @paramDef {"type":"String","label":"Next Page Token","name":"cursor","required":false,"description":"Advanced. Paste 'cursors.after' from a previous response."}
   * @returns {Object}
   */
  async listInstalmentSchedules(mandateId, customerId, status, limit, cursor) {
    const response = await this.#api({
      path: '/instalment_schedules',
      logTag: 'listInstalmentSchedules',
      query: cleanupObject({
        mandate: mandateId,
        customer: customerId,
        status: toCommaList(resolveChoices(status, INSTALMENT_STATUS_LABELS)),
        limit: this.#clampLimit(limit),
        after: cursor,
      }),
    })

    return this.#unwrapList(response, 'instalment_schedules')
  }

  /**
   * @description Fetch one instalment schedule - name, total amount, status, and its generated payments.
   * @route POST /get-instalment-schedule
   * @operationName Get Instalment Schedule
   * @category Instalment Schedules
   * @appearanceColor #6d4c41 #3e2723
   * @sampleResultLoader {"methodName":"getInstalmentSchedule_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Instalment Schedule","name":"instalmentScheduleId","required":true,"dictionary":"listInstalmentSchedulesDict","description":"Pick the instalment schedule."}
   * @returns {Object}
   */
  async getInstalmentSchedule(instalmentScheduleId) {
    if (!instalmentScheduleId)
      throw new Error('[GoCardless] instalmentScheduleId is required')

    const response = await this.#api({
      path: `/instalment_schedules/${ instalmentScheduleId }`,
      logTag: 'getInstalmentSchedule',
    })

    return this.#unwrap(response, 'instalment_schedules')
  }

  /**
   * @description Set up a payment plan - a fixed number of instalments charged against one mandate on a regular cadence. You supply the amount of each instalment plus the interval; GoCardless schedules them. Use for 'pay in 3', financed purchases, or any split-payment arrangement. For open-ended recurring billing use Create Subscription instead.
   * @route POST /create-instalment-schedule
   * @operationName Create Instalment Schedule
   * @category Instalment Schedules
   * @appearanceColor #6d4c41 #3e2723
   * @sampleResultLoader {"methodName":"getInstalmentSchedule_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Mandate","name":"mandateId","required":true,"dictionary":"listMandatesDict","description":"Active mandate that will be charged for each instalment."}
   * @paramDef {"type":"String","label":"Schedule Name","name":"name","required":true,"description":"Name for this payment plan (e.g. 'Invoice 1234'). Appears on the payer's notifications."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["British Pound","Euro","US Dollar","Swedish Krona","Australian Dollar","New Zealand Dollar","Canadian Dollar","Danish Krone"]}},"description":"Currency for the whole plan. Must match the mandate's currency."}
   * @paramDef {"type":"Number","label":"Total Amount","name":"totalAmount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Grand total across all instalments, in the smallest currency unit (3000 = 30.00 GBP). Must equal the sum of the per-instalment amounts - GoCardless rejects a mismatch."}
   * @paramDef {"type":"Array<Number>","label":"Instalment Amounts","name":"amounts","required":true,"description":"One amount per instalment, in the smallest currency unit. Example: [1000,1000,1000] for three payments of 10.00. They must add up to Total Amount."}
   * @paramDef {"type":"Number","label":"Interval","name":"interval","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of units between instalments. 1 with monthly = every month."}
   * @paramDef {"type":"String","label":"Interval Unit","name":"intervalUnit","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Weekly","Monthly","Yearly"]}},"description":"Pair with Interval to set the cadence between instalments."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Date of the first instalment. Leave blank for the earliest possible date."}
   * @paramDef {"type":"String","label":"Payment Reference","name":"paymentReference","required":false,"description":"Your reference attached to every generated payment (e.g. invoice number)."}
   * @paramDef {"type":"Number","label":"App Fee","name":"appFee","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Partner-only. Your fee per instalment in the smallest currency unit."}
   * @paramDef {"type":"Boolean","label":"Auto-Retry On Failure","name":"retryIfPossible","required":false,"uiComponent":{"type":"TOGGLE"},"description":"When on, GoCardless retries a failed instalment once (subject to scheme rules)."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","required":false,"description":"Optional notes - up to 3 key/value pairs."}
   * @paramDef {"type":"String","label":"Idempotency Key (Advanced)","name":"idempotencyKey","required":false,"description":"Advanced. Leave blank unless forcing a fresh creation when retrying."}
   * @returns {Object}
   */
  async createInstalmentSchedule(
    mandateId,
    name,
    currency,
    totalAmount,
    amounts,
    interval,
    intervalUnit,
    startDate,
    paymentReference,
    appFee,
    retryIfPossible,
    metadata,
    idempotencyKey
  ) {
    if (!mandateId) throw new Error('[GoCardless] mandateId is required')
    if (!currency) throw new Error('[GoCardless] currency is required')

    const amountList = toArray(amounts)
      .map(a => toMinorUnits(a))
      .filter(a => a !== undefined)

    if (!amountList.length) {
      throw new Error(
        '[GoCardless] amounts is required (one whole-number amount per instalment)'
      )
    }

    const body = {
      instalment_schedules:
        cleanupObject({
          name,
          currency: resolveChoice(currency, CURRENCY_LABELS),
          total_amount: toMinorUnits(totalAmount),
          payment_reference: paymentReference,
          app_fee: toMinorUnits(appFee),
          retry_if_possible: retryIfPossible,
          metadata: cleanupObject(metadata),
          instalments: cleanupObject({
            amounts: amountList,
            interval,
            interval_unit: resolveChoice(intervalUnit, INTERVAL_UNIT_LABELS),
            start_date: startDate
              ? toIsoDateTime(startDate).slice(0, 10)
              : undefined,
          }),
          links: { mandate: mandateId },
        }) || {},
    }

    return this.#createWithReplayRecovery({
      path: '/instalment_schedules',
      resourceKey: 'instalment_schedules',
      body,
      logTag: 'createInstalmentSchedule',
      idempotencyKey,
      idempotencyArgs: body,
      uniqueIdempotency: true,
    })
  }

  /**
   * @description Cancel an instalment schedule so no further instalments are collected. Instalments already paid out are unaffected. Cannot be undone.
   * @route POST /cancel-instalment-schedule
   * @operationName Cancel Instalment Schedule
   * @category Instalment Schedules
   * @appearanceColor #6d4c41 #3e2723
   * @sampleResultLoader {"methodName":"getInstalmentSchedule_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Instalment Schedule","name":"instalmentScheduleId","required":true,"dictionary":"listInstalmentSchedulesDict","description":"Instalment schedule to cancel."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","required":false,"description":"Optional notes to attach to the cancellation."}
   * @returns {Object}
   */
  async cancelInstalmentSchedule(instalmentScheduleId, metadata) {
    if (!instalmentScheduleId)
      throw new Error('[GoCardless] instalmentScheduleId is required')

    const response = await this.#api({
      path: `/instalment_schedules/${ instalmentScheduleId }/actions/cancel`,
      method: 'post',
      body: {
        data: cleanupObject({ metadata: cleanupObject(metadata) }) || {},
      },
      logTag: 'cancelInstalmentSchedule',
    })

    return this.#unwrap(response, 'instalment_schedules')
  }

  // ===========================================================================
  // 8. REFUNDS
  // ===========================================================================

  /**
   * @description List refunds you've issued. Filter by payment, mandate, or whether it's a per-payment refund vs whole-mandate refund.
   * @route POST /list-refunds
   * @operationName List Refunds
   * @category Refunds
   * @appearanceColor #43a047 #1b5e20
   * @sampleResultLoader {"methodName":"getRefund_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Payment","name":"paymentId","required":false,"dictionary":"listPaymentsDict","description":"Only show refunds against this payment."}
   * @paramDef {"type":"String","label":"Mandate","name":"mandateId","required":false,"dictionary":"listMandatesDict","description":"Only show refunds tied to this mandate."}
   * @paramDef {"type":"String","label":"Refund Type","name":"refundType","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Per Payment","Whole Mandate"]}},"description":"'payment' = refund against one specific payment. 'mandate' = whole-mandate refund (rare, mostly chargebacks)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many refunds per page (1 to 500). Defaults to 50."}
   * @paramDef {"type":"String","label":"Next Page Token","name":"cursor","required":false,"description":"Advanced. Paste 'cursors.after' from a previous response."}
   * @returns {Object}
   */
  async listRefunds(paymentId, mandateId, refundType, limit, cursor) {
    const response = await this.#api({
      path: '/refunds',
      logTag: 'listRefunds',
      query: cleanupObject({
        payment: paymentId,
        mandate: mandateId,
        refund_type: resolveChoice(refundType, REFUND_TYPE_LABELS),
        limit: this.#clampLimit(limit),
        after: cursor,
      }),
    })

    return this.#unwrapList(response, 'refunds')
  }

  /**
   * @description Fetch one refund.
   * @route POST /get-refund
   * @operationName Get Refund
   * @category Refunds
   * @appearanceColor #43a047 #1b5e20
   * @sampleResultLoader {"methodName":"getRefund_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Refund","name":"refundId","required":true,"dictionary":"listRefundsDict","description":"Pick the refund."}
   * @returns {Object}
   */
  async getRefund(refundId) {
    if (!refundId) throw new Error('[GoCardless] refundId is required')

    const response = await this.#api({
      path: `/refunds/${ refundId }`,
      logTag: 'getRefund',
    })

    return this.#unwrap(response, 'refunds')
  }

  /**
   * @description Refund a payment that's already been confirmed or paid out. Use for returns, billing errors, or goodwill. You must confirm the total amount you've ever refunded on this payment (Confirmation field below) - GoCardless rejects the call if it doesn't match, which prevents accidental double-refunds when two systems try at once.
   * @route POST /create-refund
   * @operationName Create Refund
   * @category Refunds
   * @appearanceColor #43a047 #1b5e20
   * @sampleResultLoader {"methodName":"getRefund_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Payment","name":"paymentId","required":true,"dictionary":"listPaymentsDict","description":"Payment to refund."}
   * @paramDef {"type":"Number","label":"Refund Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Amount to refund in the smallest currency unit (GBP 10.00 = 1000). Must be at most the payment amount minus any previous refunds."}
   * @paramDef {"type":"Number","label":"Total Refunded Confirmation","name":"totalAmountConfirmation","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Safety check. Total amount across ALL refunds on this payment (including this one), in the smallest currency unit. Example: payment was GBP 30, you refunded GBP 5 before, refunding another GBP 10 now > enter 1500. Prevents accidental over-refunds."}
   * @paramDef {"type":"String","label":"Payer-Visible Reference","name":"reference","required":false,"description":"Reference shown on the payer's bank statement. Max 18 chars for UK Bacs, 140 for European SEPA."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","required":false,"description":"Optional notes - up to 3 key/value pairs."}
   * @paramDef {"type":"String","label":"Idempotency Key (Advanced)","name":"idempotencyKey","required":false,"description":"Advanced. Leave blank unless forcing a fresh refund when retrying."}
   * @returns {Object}
   */
  async createRefund(
    paymentId,
    amount,
    totalAmountConfirmation,
    reference,
    metadata,
    idempotencyKey
  ) {
    if (!paymentId) throw new Error('[GoCardless] paymentId is required')

    const body = {
      refunds:
        cleanupObject({
          amount: toMinorUnits(amount),
          total_amount_confirmation: toMinorUnits(
            totalAmountConfirmation
          ),
          reference,
          metadata: cleanupObject(metadata),
          links: { payment: paymentId },
        }) || {},
    }

    return this.#createWithReplayRecovery({
      path: '/refunds',
      resourceKey: 'refunds',
      body,
      logTag: 'createRefund',
      idempotencyKey,
      idempotencyArgs: body,
      uniqueIdempotency: true,
    })
  }

  // ===========================================================================
  // 9. PAYOUTS
  // ===========================================================================

  /**
   * @description List payouts - bank transfers from GoCardless to your business bank account. GoCardless schedules these automatically; this is read-only. Use for reconciliation against bank statements.
   * @route POST /list-payouts
   * @operationName List Payouts
   * @category Payouts
   * @appearanceColor #00897b #004d40
   * @sampleResultLoader {"methodName":"getPayout_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Creditor","name":"creditorId","required":false,"dictionary":"listCreditorsDict","description":"Only show payouts for this creditor account."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Pending","Paid","Bounced"]}},"description":"'paid' = money in your bank. 'pending' = scheduled. 'bounced' = transfer failed."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["British Pound","Euro","US Dollar","Swedish Krona","Australian Dollar","New Zealand Dollar","Canadian Dollar","Danish Krone"]}},"description":"Only show payouts in this currency."}
   * @paramDef {"type":"String","label":"Date Range","name":"period","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Custom Range","Today","Last 7 Days","Last 30 Days","Last 90 Days","Month to Date","Year to Date"]}},"description":"Filter by when the payout was created."}
   * @paramDef {"type":"String","label":"Created After","name":"createdAfter","required":false,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return payouts created on or after this date."}
   * @paramDef {"type":"String","label":"Created Before","name":"createdBefore","required":false,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return payouts created on or before this date."}
   * @paramDef {"type":"Number","label":"Page Size","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many payouts per page (1 to 500). Defaults to 50."}
   * @paramDef {"type":"String","label":"Next Page Token","name":"cursor","required":false,"description":"Advanced. Paste 'cursors.after' from a previous response."}
   * @returns {Object}
   */
  async listPayouts(
    creditorId,
    status,
    currency,
    period,
    createdAfter,
    createdBefore,
    limit,
    cursor
  ) {
    const createdAt = buildCreatedAtFilter({
      period,
      createdAfter,
      createdBefore,
    })

    const response = await this.#api({
      path: '/payouts',
      logTag: 'listPayouts',
      query: cleanupObject({
        creditor: creditorId,
        status: resolveChoice(status, PAYOUT_STATUS_LABELS),
        currency: resolveChoice(currency, CURRENCY_LABELS),
        limit: this.#clampLimit(limit),
        after: cursor,
        ...(createdAt ? this.#flattenCreatedAt(createdAt) : {}),
      }),
    })

    return this.#unwrapList(response, 'payouts')
  }

  /**
   * @description Fetch one payout - amount, fees deducted, arrival date, status.
   * @route POST /get-payout
   * @operationName Get Payout
   * @category Payouts
   * @appearanceColor #00897b #004d40
   * @sampleResultLoader {"methodName":"getPayout_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Payout","name":"payoutId","required":true,"dictionary":"listPayoutsDict","description":"Pick the payout."}
   * @returns {Object}
   */
  async getPayout(payoutId) {
    if (!payoutId) throw new Error('[GoCardless] payoutId is required')

    const response = await this.#api({
      path: `/payouts/${ payoutId }`,
      logTag: 'getPayout',
    })

    return this.#unwrap(response, 'payouts')
  }

  /**
   * @description List the line items inside a payout - every payment, refund, and fee that adds up to the total. Use for full reconciliation showing exactly which customer payments made up each bank deposit.
   * @route POST /list-payout-items
   * @operationName List Payout Items
   * @category Payouts
   * @appearanceColor #00897b #004d40
   * @paramDef {"type":"String","label":"Payout","name":"payoutId","required":true,"dictionary":"listPayoutsDict","description":"Payout to break down."}
   * @paramDef {"type":"Boolean","label":"Include Tax Breakdown","name":"includeTaxes","required":false,"uiComponent":{"type":"TOGGLE"},"description":"When on, includes per-item tax details. Available for French and German merchants only."}
   * @paramDef {"type":"Number","label":"Page Size","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many items per page (1 to 500). Defaults to 50."}
   * @paramDef {"type":"String","label":"Next Page Token","name":"cursor","required":false,"description":"Advanced. Paste 'cursors.after' from a previous response."}
   * @returns {Object}
   * @sampleResult {"data":[{"amount":"1000","type":"payment_paid_out","taxes":[],"links":{"payment":"PM000123456","mandate":"MD000123456"}}],"items":[{"amount":"1000","type":"payment_paid_out","taxes":[],"links":{"payment":"PM000123456","mandate":"MD000123456"}}],"cursors":{"before":null,"after":null},"limit":50,"hasMore":false}
   */
  async listPayoutItems(payoutId, includeTaxes, limit, cursor) {
    if (!payoutId) throw new Error('[GoCardless] payoutId is required')

    const response = await this.#api({
      path: '/payout_items',
      logTag: 'listPayoutItems',
      query: cleanupObject({
        payout: payoutId,
        include: includeTaxes ? 'tax_breakdowns' : undefined,
        limit: this.#clampLimit(limit),
        after: cursor,
      }),
    })

    return this.#unwrapList(response, 'payout_items')
  }

  // ===========================================================================
  // 10. BILLING REQUESTS (hosted onboarding)
  // ===========================================================================

  /**
   * @description Set up a hosted onboarding session. A Billing Request defines what you want to collect - a mandate, a one-off payment, or both. After creating it, generate a hosted URL with Create Billing Request Flow and send the payer there to enter their details. Use this for self-serve sign-ups where the customer enters their own bank details.
   * @route POST /create-billing-request
   * @operationName Create Billing Request
   * @category Billing Requests
   * @appearanceColor #5e35b1 #311b92
   * @paramDef {"type":"Boolean","label":"Collect Mandate","name":"collectMandate","required":false,"uiComponent":{"type":"TOGGLE"},"description":"Turn on to collect a Direct Debit authorisation. Required if you plan to charge the customer later (subscriptions, future invoices)."}
   * @paramDef {"type":"Boolean","label":"Collect Payment","name":"collectPayment","required":false,"uiComponent":{"type":"TOGGLE"},"description":"Turn on to take a one-off payment as part of the flow. Set Amount + Currency below."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["British Pound","Euro","US Dollar","Swedish Krona","Australian Dollar","New Zealand Dollar","Canadian Dollar","Danish Krone"]}},"description":"Currency for the mandate and/or payment."}
   * @paramDef {"type":"String","label":"Mandate Scheme","name":"mandateScheme","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Bacs (UK)","SEPA Core (Europe)","ACH (US)","BECS (Australia)","BECS (New Zealand)","Autogiro (Sweden)","PAD (Canada)","Betalingsservice (Denmark)","Faster Payments (UK)"]}},"description":"Direct Debit scheme for the mandate. Leave blank to let GoCardless pick based on the payer's country."}
   * @paramDef {"type":"String","label":"Mandate Verification","name":"mandateVerify","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Minimum","Recommended (Default)","When Available","Always"]}},"description":"How strict to be about bank-account verification before activating the mandate. 'recommended' is the GoCardless default."}
   * @paramDef {"type":"String","label":"Mandate Reference","name":"mandateReference","required":false,"description":"Your reference for the mandate (e.g. customer number)."}
   * @paramDef {"type":"Number","label":"Payment Amount","name":"paymentAmount","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"One-off payment amount in the smallest currency unit (GBP 10 = 1000). Only used when Collect Payment is on."}
   * @paramDef {"type":"String","label":"Payment Description","name":"paymentDescription","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Short description shown to the payer. Max 100 characters."}
   * @paramDef {"type":"String","label":"Payment Reference","name":"paymentReference","required":false,"description":"Your reference for the one-off payment (e.g. invoice number)."}
   * @paramDef {"type":"Boolean","label":"Auto-Retry Payment On Failure","name":"paymentRetryIfPossible","required":false,"uiComponent":{"type":"TOGGLE"},"description":"Auto-retry the one-off payment once if it fails."}
   * @paramDef {"type":"Number","label":"App Fee","name":"paymentAppFee","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Partner-only. Your fee on the one-off payment."}
   * @paramDef {"type":"String","label":"Existing Customer","name":"customerId","required":false,"dictionary":"listCustomersDict","description":"Link to an existing customer. Leave blank to capture a brand-new customer in the hosted flow."}
   * @paramDef {"type":"Boolean","label":"Allow Direct Debit Fallback","name":"fallbackEnabled","required":false,"uiComponent":{"type":"TOGGLE"},"description":"If instant bank pay fails (e.g. payer's bank doesn't support it), fall back to a Direct Debit mandate. Recommended on."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","required":false,"description":"Optional notes - up to 3 key/value pairs."}
   * @paramDef {"type":"String","label":"Idempotency Key (Advanced)","name":"idempotencyKey","required":false,"description":"Advanced. Leave blank unless forcing a fresh creation."}
   * @returns {Object}
   * @sampleResult {"id":"BRQ000ABCDEF","created_at":"2026-05-16T10:00:00.000Z","status":"pending","fallback_enabled":true,"fallback_occurred":false,"mandate_request":{"scheme":"bacs","verify":"recommended","currency":"GBP"},"payment_request":null,"metadata":{},"links":{}}
   */
  async createBillingRequest(
    collectMandate,
    collectPayment,
    currency,
    mandateScheme,
    mandateVerify,
    mandateReference,
    paymentAmount,
    paymentDescription,
    paymentReference,
    paymentRetryIfPossible,
    paymentAppFee,
    customerId,
    fallbackEnabled,
    metadata,
    idempotencyKey
  ) {
    const mandateRequest = collectMandate
      ? cleanupObject({
        currency: resolveChoice(currency, CURRENCY_LABELS),
        scheme: resolveChoice(mandateScheme, SCHEME_LABELS),
        verify: resolveChoice(mandateVerify, MANDATE_VERIFY_LABELS),
        reference: mandateReference,
      })
      : undefined

    const paymentRequest = collectPayment
      ? cleanupObject({
        amount: toMinorUnits(paymentAmount),
        currency: resolveChoice(currency, CURRENCY_LABELS),
        description: paymentDescription,
        reference: paymentReference,
        retry_if_possible: paymentRetryIfPossible,
        app_fee: toMinorUnits(paymentAppFee),
      })
      : undefined

    const body = {
      billing_requests:
        cleanupObject({
          mandate_request: mandateRequest,
          payment_request: paymentRequest,
          fallback_enabled: fallbackEnabled,
          metadata: cleanupObject(metadata),
          links: customerId ? { customer: customerId } : undefined,
        }) || {},
    }

    return this.#createWithReplayRecovery({
      path: '/billing_requests',
      resourceKey: 'billing_requests',
      body,
      logTag: 'createBillingRequest',
      idempotencyKey,
      idempotencyArgs: body,
      uniqueIdempotency: true,
    })
  }

  /**
   * @description Fetch one billing request to check its status (pending, completed, cancelled, etc.).
   * @route POST /get-billing-request
   * @operationName Get Billing Request
   * @category Billing Requests
   * @appearanceColor #5e35b1 #311b92
   * @paramDef {"type":"String","label":"Billing Request","name":"billingRequestId","required":true,"dictionary":"listBillingRequestsDict","description":"Pick the billing request."}
   * @returns {Object}
   * @sampleResult {"id":"BRQ000ABCDEF","created_at":"2026-05-16T10:00:00.000Z","status":"pending","fallback_enabled":true,"fallback_occurred":false,"mandate_request":{"scheme":"bacs","verify":"recommended","currency":"GBP"},"payment_request":null,"metadata":{},"links":{"customer":"CU000123456"}}
   */
  async getBillingRequest(billingRequestId) {
    if (!billingRequestId)
      throw new Error('[GoCardless] billingRequestId is required')

    const response = await this.#api({
      path: `/billing_requests/${ billingRequestId }`,
      logTag: 'getBillingRequest',
    })

    return this.#unwrap(response, 'billing_requests')
  }

  /**
   * @description Generate a hosted GoCardless URL for a billing request. Send your customer to the returned 'authorisation_url' - they'll enter bank details and authorise the mandate (and/or pay) on a GoCardless-hosted page. After completion, GoCardless redirects them back to your Return URL.
   * @route POST /create-billing-request-flow
   * @operationName Create Hosted Flow URL
   * @category Billing Requests
   * @appearanceColor #5e35b1 #311b92
   * @sampleResultLoader {"methodName":"createBillingRequestFlow_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Billing Request","name":"billingRequestId","required":true,"dictionary":"listBillingRequestsDict","description":"Billing request to attach the flow to."}
   * @paramDef {"type":"String","label":"Return URL","name":"redirectUri","required":false,"description":"Where to send the customer after they finish. Use your own thank-you page."}
   * @paramDef {"type":"String","label":"Exit URL","name":"exitUri","required":false,"description":"Where to send the customer if they leave without finishing."}
   * @paramDef {"type":"Boolean","label":"Auto-Create On Completion","name":"autoFulfil","required":false,"uiComponent":{"type":"TOGGLE"},"description":"When on, GoCardless creates the mandate and/or takes the payment as soon as the customer finishes. Recommended."}
   * @paramDef {"type":"Boolean","label":"Lock Currency","name":"lockCurrency","required":false,"uiComponent":{"type":"TOGGLE"},"description":"Prevent the customer from changing the currency in the hosted flow."}
   * @paramDef {"type":"Boolean","label":"Lock Customer Details","name":"lockCustomerDetails","required":false,"uiComponent":{"type":"TOGGLE"},"description":"Prevent the customer from editing pre-filled email/name/address. Use when you've validated these yourself."}
   * @paramDef {"type":"Boolean","label":"Show Redirect Buttons","name":"showRedirectButtons","required":false,"uiComponent":{"type":"TOGGLE"},"description":"Show 'Return to merchant' buttons on the success page."}
   * @paramDef {"type":"String","label":"Language","name":"language","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["English","German","French","Spanish","Italian","Dutch","Portuguese","Swedish","Danish"]}},"description":"Language for the hosted page. Defaults to English."}
   * @paramDef {"type":"String","label":"Prefilled IBAN","name":"prefilledBankAccountIban","required":false,"description":"Pre-fill the customer's IBAN on the hosted page so they don't have to type it."}
   * @paramDef {"type":"Object","label":"Prefilled Customer Details","name":"prefilledCustomer","required":false,"schemaLoader":"prefilledCustomerSchema","description":"Pre-fill customer details on the hosted page. Leave any field blank to ask the customer for it."}
   * @paramDef {"type":"String","label":"Idempotency Key (Advanced)","name":"idempotencyKey","required":false,"description":"Advanced. Leave blank unless forcing a fresh URL."}
   * @returns {Object}
   */
  async createBillingRequestFlow(
    billingRequestId,
    redirectUri,
    exitUri,
    autoFulfil,
    lockCurrency,
    lockCustomerDetails,
    showRedirectButtons,
    language,
    prefilledBankAccountIban,
    prefilledCustomer,
    idempotencyKey
  ) {
    if (!billingRequestId)
      throw new Error('[GoCardless] billingRequestId is required')

    const body = {
      billing_request_flows:
        cleanupObject({
          redirect_uri: redirectUri,
          exit_uri: exitUri,
          auto_fulfil: autoFulfil,
          lock_currency: lockCurrency,
          lock_customer_details: lockCustomerDetails,
          show_redirect_buttons: showRedirectButtons,
          language: resolveChoice(language, LANGUAGE_LABELS),
          prefilled_bank_account: prefilledBankAccountIban
            ? { iban: prefilledBankAccountIban }
            : undefined,
          prefilled_customer: cleanupObject(prefilledCustomer),
          links: { billing_request: billingRequestId },
        }) || {},
    }

    return this.#createWithReplayRecovery({
      path: '/billing_request_flows',
      resourceKey: 'billing_request_flows',
      body,
      logTag: 'createBillingRequestFlow',
      idempotencyKey,
      idempotencyArgs: body,
    })
  }

  /**
   * @description Cancel a billing request. The associated hosted page stops working immediately.
   * @route POST /cancel-billing-request
   * @operationName Cancel Billing Request
   * @category Billing Requests
   * @appearanceColor #5e35b1 #311b92
   * @paramDef {"type":"String","label":"Billing Request","name":"billingRequestId","required":true,"dictionary":"listBillingRequestsDict","description":"Billing request to cancel."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","required":false,"description":"Optional notes."}
   * @returns {Object}
   * @sampleResult {"id":"BRQ000ABCDEF","created_at":"2026-05-16T10:00:00.000Z","status":"cancelled","fallback_enabled":true,"fallback_occurred":false,"mandate_request":{"scheme":"bacs","verify":"recommended","currency":"GBP"},"payment_request":null,"metadata":{},"links":{"customer":"CU000123456"}}
   */
  async cancelBillingRequest(billingRequestId, metadata) {
    if (!billingRequestId)
      throw new Error('[GoCardless] billingRequestId is required')

    const response = await this.#api({
      path: `/billing_requests/${ billingRequestId }/actions/cancel`,
      method: 'post',
      body: {
        data: cleanupObject({ metadata: cleanupObject(metadata) }) || {},
      },
      logTag: 'cancelBillingRequest',
    })

    return this.#unwrap(response, 'billing_requests')
  }

  /**
   * @description Manually finalise a billing request - actually create the mandate and/or take the payment. Most hosted flows do this automatically (when Auto-Create On Completion is on). Use this only when you collected the customer's details elsewhere and need to commit them.
   * @route POST /fulfil-billing-request
   * @operationName Finalise Billing Request
   * @category Billing Requests
   * @appearanceColor #5e35b1 #311b92
   * @paramDef {"type":"String","label":"Billing Request","name":"billingRequestId","required":true,"dictionary":"listBillingRequestsDict","description":"Billing request to finalise."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","required":false,"description":"Optional notes."}
   * @returns {Object}
   * @sampleResult {"id":"BRQ000ABCDEF","created_at":"2026-05-16T10:00:00.000Z","status":"fulfilled","fallback_enabled":true,"fallback_occurred":false,"mandate_request":{"scheme":"bacs","verify":"recommended","currency":"GBP"},"payment_request":null,"metadata":{},"links":{"customer":"CU000123456","mandate_request_mandate":"MD000123456"}}
   */
  async fulfilBillingRequest(billingRequestId, metadata) {
    if (!billingRequestId)
      throw new Error('[GoCardless] billingRequestId is required')

    const response = await this.#api({
      path: `/billing_requests/${ billingRequestId }/actions/fulfil`,
      method: 'post',
      body: {
        data: cleanupObject({ metadata: cleanupObject(metadata) }) || {},
      },
      logTag: 'fulfilBillingRequest',
    })

    return this.#unwrap(response, 'billing_requests')
  }

  // ---------------------------------------------------------------------------
  // Non-hosted collect actions (own pages instead of the GoCardless-hosted flow).
  // Requires a GoCardless Pro or Enterprise account with the custom payment pages upgrade.
  // ---------------------------------------------------------------------------

  /**
   * @description Complete the customer-details step of a billing request from your own pages instead of the GoCardless-hosted flow - submit the payer's name/email and billing address you collected yourself. GoCardless checks the fields satisfy the billing request's scheme and updates the linked customer immediately. Next step: Collect Bank Account (Own Pages). Requires a GoCardless Pro or Enterprise account with the custom payment pages upgrade.
   * @route POST /collect-billing-request-customer-details
   * @operationName Collect Customer Details (Own Pages)
   * @category Billing Requests
   * @appearanceColor #5e35b1 #311b92
   * @paramDef {"type":"String","label":"Billing Request","name":"billingRequestId","required":true,"dictionary":"listBillingRequestsDict","description":"Billing request with a pending customer-details step."}
   * @paramDef {"type":"Object","label":"Customer","name":"customer","required":true,"schemaLoader":"billingRequestCustomerSchema","description":"The payer's identity - first + last name or company name, plus email in most cases (GoCardless sends notifications to it)."}
   * @paramDef {"type":"Object","label":"Billing Address","name":"customerBillingDetail","required":false,"schemaLoader":"billingRequestBillingDetailSchema","description":"The payer's billing address and scheme-specific identity fields (US state and IP address for ACH, CPR/CVR for Denmark, personnummer for Sweden)."}
   * @returns {Object}
   * @sampleResult {"id":"BRQ000ABCDEF","created_at":"2026-05-16T10:00:00.000Z","status":"pending","fallback_enabled":true,"fallback_occurred":false,"mandate_request":{"scheme":"bacs","verify":"recommended","currency":"GBP"},"payment_request":null,"metadata":{},"links":{"customer":"CU000123456","creditor":"CR000000000001"},"actions":[{"type":"collect_customer_details","required":true,"status":"completed"},{"type":"collect_bank_account","required":true,"status":"pending"}]}
   */
  async collectBillingRequestCustomerDetails(
    billingRequestId,
    customer,
    customerBillingDetail
  ) {
    if (!billingRequestId)
      throw new Error('[GoCardless] billingRequestId is required')
    if (!customer) throw new Error('[GoCardless] customer is required')

    const response = await this.#api({
      path: `/billing_requests/${ billingRequestId }/actions/collect_customer_details`,
      method: 'post',
      body: {
        data:
          cleanupObject({
            customer: cleanupObject(customer),
            customer_billing_detail: cleanupObject(customerBillingDetail),
          }) || {},
      },
      logTag: 'collectBillingRequestCustomerDetails',
    })

    return this.#unwrap(response, 'billing_requests')
  }

  /**
   * @description Complete the bank-account step of a billing request from your own pages - submit the payer's bank details you collected yourself. Either provide an IBAN (most European accounts) OR account number + sort/branch/bank code for local schemes. GoCardless validates the account against the billing request's scheme (ACH accounts get a third-party validity check; UK accounts get Payer Name Verification) before attaching it. Next step: Confirm Payer Details. Requires a GoCardless Pro or Enterprise account with the custom payment pages upgrade.
   * @route POST /collect-billing-request-bank-account
   * @operationName Collect Bank Account (Own Pages)
   * @category Billing Requests
   * @appearanceColor #5e35b1 #311b92
   * @paramDef {"type":"String","label":"Billing Request","name":"billingRequestId","required":true,"dictionary":"listBillingRequestsDict","description":"Billing request with a pending bank-account step."}
   * @paramDef {"type":"String","label":"Account Holder Name","name":"accountHolderName","required":true,"description":"Name on the bank account as known by the bank (transliterated, upcased, and truncated to 18 characters by GoCardless)."}
   * @paramDef {"type":"String","label":"Bank Country","name":"countryCode","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["United Kingdom","Germany","France","Netherlands","Spain","Italy","Ireland","Austria","Belgium","Portugal","Finland","Luxembourg","Sweden","Denmark","Australia","New Zealand","Canada","United States"]}},"description":"Country where the bank account is held. Inferred from the IBAN when one is supplied - otherwise required."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["British Pound","Euro","US Dollar","Swedish Krona","Australian Dollar","New Zealand Dollar","Canadian Dollar","Danish Krone"]}},"description":"Currency of the account. Usually inferred from the bank details - leave blank unless you need to override."}
   * @paramDef {"type":"String","label":"IBAN","name":"iban","required":false,"description":"International bank account number - covers most European accounts in one field. Leave blank if using account number + sort code instead. Not accepted for Swedish SEK accounts (use local details)."}
   * @paramDef {"type":"String","label":"Account Number","name":"accountNumber","required":false,"description":"Local account number. Pair with the sort/branch/bank code fields for non-IBAN schemes (UK, US, AU, NZ, CA, SE, DK)."}
   * @paramDef {"type":"String","label":"Sort Code / Routing Number","name":"branchCode","required":false,"description":"The local routing code - sort code (UK), BSB (Australia), routing number (US), clearingnummer (Sweden). Pair with Account Number."}
   * @paramDef {"type":"String","label":"Bank Code","name":"bankCode","required":false,"description":"Bank code used by Canada and New Zealand schemes. Only needed there."}
   * @paramDef {"type":"String","label":"Account Type (US Only)","name":"accountType","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Checking","Savings"]}},"description":"Only fill for US dollar (ACH) accounts. Must be left blank for every other currency."}
   * @paramDef {"type":"String","label":"Account Suffix (NZ Only)","name":"accountNumberSuffix","required":false,"description":"Account number suffix - only for New Zealand dollar accounts."}
   * @paramDef {"type":"String","label":"PayID (PayTo Only)","name":"payId","required":false,"description":"For Australian PayTo only - a PayID such as an email address, mobile number, or company number the payer uses to accept payments (not a GoCardless resource ID - no dictionary applies). Provide together with Bank Country."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","required":false,"description":"Optional notes - up to 3 key/value pairs."}
   * @returns {Object}
   * @sampleResult {"id":"BRQ000ABCDEF","created_at":"2026-05-16T10:00:00.000Z","status":"pending","fallback_enabled":true,"fallback_occurred":false,"mandate_request":{"scheme":"bacs","verify":"recommended","currency":"GBP"},"payment_request":null,"metadata":{},"links":{"customer":"CU000123456","customer_bank_account":"BA000123456","creditor":"CR000000000001"},"actions":[{"type":"collect_bank_account","required":true,"status":"completed"},{"type":"confirm_payer_details","required":true,"status":"pending"}]}
   */
  async collectBillingRequestBankAccount(
    billingRequestId,
    accountHolderName,
    countryCode,
    currency,
    iban,
    accountNumber,
    branchCode,
    bankCode,
    accountType,
    accountNumberSuffix,
    payId,
    metadata
  ) {
    if (!billingRequestId)
      throw new Error('[GoCardless] billingRequestId is required')
    if (!accountHolderName)
      throw new Error('[GoCardless] accountHolderName is required')

    const response = await this.#api({
      path: `/billing_requests/${ billingRequestId }/actions/collect_bank_account`,
      method: 'post',
      body: {
        data:
          cleanupObject({
            account_holder_name: accountHolderName,
            country_code: resolveChoice(countryCode, COUNTRY_LABELS),
            currency: resolveChoice(currency, CURRENCY_LABELS),
            iban,
            account_number: accountNumber,
            branch_code: branchCode,
            bank_code: bankCode,
            account_type: resolveChoice(accountType, ACCOUNT_TYPE_LABELS),
            account_number_suffix: accountNumberSuffix,
            pay_id: payId,
            metadata: cleanupObject(metadata),
          }) || {},
      },
      logTag: 'collectBillingRequestBankAccount',
    })

    return this.#unwrap(response, 'billing_requests')
  }

  /**
   * @description Record that the payer has reviewed and confirmed the details you collected - a Direct Debit scheme compliance step required for mandate requests. Only call this after the payer has actually seen and approved their details on your page. Once confirmed, the billing request becomes ready to finalise with Finalise Billing Request.
   * @route POST /confirm-billing-request-payer-details
   * @operationName Confirm Payer Details
   * @category Billing Requests
   * @appearanceColor #5e35b1 #311b92
   * @paramDef {"type":"String","label":"Billing Request","name":"billingRequestId","required":true,"dictionary":"listBillingRequestsDict","description":"Billing request whose collected details the payer has confirmed."}
   * @paramDef {"type":"Boolean","label":"Payer Requested Dual Signature","name":"payerRequestedDualSignature","required":false,"uiComponent":{"type":"TOGGLE"},"description":"Turn on if the payer said their mandate needs multiple signatures. GoCardless emails them instructions to complete the extra signature (that final step runs on GoCardless-branded pages)."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","required":false,"description":"Optional notes - up to 3 key/value pairs."}
   * @returns {Object}
   * @sampleResult {"id":"BRQ000ABCDEF","created_at":"2026-05-16T10:00:00.000Z","status":"ready_to_fulfil","fallback_enabled":true,"fallback_occurred":false,"mandate_request":{"scheme":"bacs","verify":"recommended","currency":"GBP"},"payment_request":null,"metadata":{},"links":{"customer":"CU000123456","customer_bank_account":"BA000123456","creditor":"CR000000000001"}}
   */
  async confirmBillingRequestPayerDetails(
    billingRequestId,
    payerRequestedDualSignature,
    metadata
  ) {
    if (!billingRequestId)
      throw new Error('[GoCardless] billingRequestId is required')

    const response = await this.#api({
      path: `/billing_requests/${ billingRequestId }/actions/confirm_payer_details`,
      method: 'post',
      body: {
        data:
          cleanupObject({
            payer_requested_dual_signature: payerRequestedDualSignature,
            metadata: cleanupObject(metadata),
          }) || {},
      },
      logTag: 'confirmBillingRequestPayerDetails',
    })

    return this.#unwrap(response, 'billing_requests')
  }

  // ===========================================================================
  // 11. EVENTS (backbone of polling triggers)
  // ===========================================================================

  /**
   * @description List events - the timeline of state changes for everything (mandates, payments, subscriptions, payouts, refunds, billing requests). Use for audit history, finding what happened to a specific resource, or building custom dashboards.
   * @route POST /list-events
   * @operationName List Events
   * @category Events
   * @appearanceColor #546e7a #263238
   * @sampleResultLoader {"methodName":"getEvent_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Resource Type","name":"resourceType","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Billing Requests","Creditors","Customers","Instalment Schedules","Mandates","Outbound Payments","Payer Authorisations","Payments","Payouts","Refunds","Subscriptions"]}},"description":"Only return events about this kind of resource."}
   * @paramDef {"type":"Array<String>","label":"Action","name":"action","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Created","Submitted","Confirmed","Failed","Cancelled","Paid","Paid Out","Charged Back","Bounced","Customer Approval Granted","Customer Approval Denied","Resubmission Requested","Active","Expired","Reinstated","Replaced","Consumed","Blocked","Suspended By Payer","Paused","Resumed","Finished","Fulfilled","Fx Rate Confirmed"],"multiple":true}},"description":"Pick one or more action names to include. Examples: 'confirmed' for payments hitting your account, 'failed' for bounces."}
   * @paramDef {"type":"String","label":"Mandate","name":"mandateId","required":false,"dictionary":"listMandatesDict","description":"Only events about this mandate."}
   * @paramDef {"type":"String","label":"Payment","name":"paymentId","required":false,"dictionary":"listPaymentsDict","description":"Only events about this payment."}
   * @paramDef {"type":"String","label":"Subscription","name":"subscriptionId","required":false,"dictionary":"listSubscriptionsDict","description":"Only events about this subscription."}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":false,"dictionary":"listCustomersDict","description":"Only events about this customer."}
   * @paramDef {"type":"String","label":"Payout","name":"payoutId","required":false,"dictionary":"listPayoutsDict","description":"Only events about this payout."}
   * @paramDef {"type":"String","label":"Refund","name":"refundId","required":false,"dictionary":"listRefundsDict","description":"Only events about this refund."}
   * @paramDef {"type":"String","label":"Billing Request","name":"billingRequestId","required":false,"dictionary":"listBillingRequestsDict","description":"Only events about this billing request."}
   * @paramDef {"type":"String","label":"Date Range","name":"period","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Custom Range","Today","Yesterday","Last 7 Days","Last 30 Days","Last 90 Days"]}},"description":"Filter by event date."}
   * @paramDef {"type":"String","label":"Created After","name":"createdAfter","required":false,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return events created on or after this date."}
   * @paramDef {"type":"String","label":"Created Before","name":"createdBefore","required":false,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return events created on or before this date."}
   * @paramDef {"type":"Number","label":"Page Size","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many events per page (1 to 500). Defaults to 50."}
   * @paramDef {"type":"String","label":"Next Page Token","name":"cursor","required":false,"description":"Advanced. Paste 'cursors.after' from a previous response."}
   * @returns {Object}
   */
  async listEvents(
    resourceType,
    action,
    mandateId,
    paymentId,
    subscriptionId,
    customerId,
    payoutId,
    refundId,
    billingRequestId,
    period,
    createdAfter,
    createdBefore,
    limit,
    cursor
  ) {
    const createdAt = buildCreatedAtFilter({
      period,
      createdAfter,
      createdBefore,
    })

    const response = await this.#api({
      path: '/events',
      logTag: 'listEvents',
      query: cleanupObject({
        resource_type: resolveChoice(resourceType, RESOURCE_TYPE_LABELS),
        action: toCommaList(resolveChoices(action, EVENT_ACTION_LABELS)),
        mandate: mandateId,
        payment: paymentId,
        subscription: subscriptionId,
        customer: customerId,
        payout: payoutId,
        refund: refundId,
        billing_request: billingRequestId,
        limit: this.#clampLimit(limit),
        after: cursor,
        ...(createdAt ? this.#flattenCreatedAt(createdAt) : {}),
      }),
    })

    return this.#unwrapList(response, 'events')
  }

  /**
   * @description Fetch one event by ID.
   * @route POST /get-event
   * @operationName Get Event
   * @category Events
   * @appearanceColor #546e7a #263238
   * @sampleResultLoader {"methodName":"getEvent_SampleResultLoader","dependsOn":[]}
   * @paramDef {"type":"String","label":"Event ID","name":"eventId","required":true,"description":"The event ID (starts with EV, e.g. EV000ABC). Events are high-volume and short-lived, so there is no pick-list - paste an ID from a List Events result or a trigger payload."}
   * @returns {Object}
   */
  async getEvent(eventId) {
    if (!eventId) throw new Error('[GoCardless] eventId is required')

    const response = await this.#api({
      path: `/events/${ eventId }`,
      logTag: 'getEvent',
    })

    return this.#unwrap(response, 'events')
  }

  // ===========================================================================
  // 12. UTILITY
  // ===========================================================================

  /**
   * @description Check the connection is working. Returns your GoCardless creditor name and the active environment (sandbox or live). Use first when troubleshooting an integration.
   * @route POST /test-connection
   * @operationName Test Connection
   * @category Utility
   * @appearanceColor #757575 #424242
   * @returns {Object}
   * @sampleResult {"ok":true,"environment":"sandbox","creditor":{"id":"CR000000000001","name":"Acme Ltd","verification_status":"successful"},"organisationId":"OR000123456"}
   */
  async testConnection() {
    const response = await this.#api({
      path: '/creditors',
      logTag: 'testConnection',
      query: { limit: 1 },
    })

    const creditor = response?.creditors?.[0]
    const env =
      this.request?.headers?.['oauth-user-data-environment'] ||
      this.environment

    return {
      ok: !!creditor,
      environment: env,
      creditor: creditor || null,
      organisationId:
        this.request?.headers?.['oauth-user-data-organisationid'] || null,
    }
  }

  /**
   * @description Look up bank info from an IBAN or local account number. Returns the bank name, SWIFT/BIC code, and which Direct Debit schemes are supported. Use to show the bank name back to the customer for confirmation, or to pre-validate bank details before saving.
   * @route POST /lookup-bank-details
   * @operationName Lookup Bank
   * @category Utility
   * @appearanceColor #757575 #424242
   * @paramDef {"type":"String","label":"IBAN","name":"iban","required":false,"description":"International bank account number. Works for most European countries in one field. Leave blank to use account number + sort code instead."}
   * @paramDef {"type":"String","label":"Account Number","name":"accountNumber","required":false,"description":"Local account number. Pair with Sort/Routing Code below."}
   * @paramDef {"type":"String","label":"Sort Code / Routing Number","name":"branchCode","required":false,"description":"Sort code (UK), BSB (AU), routing number (US)."}
   * @paramDef {"type":"String","label":"Bank Code","name":"bankCode","required":false,"description":"Bank code (Canada / New Zealand only)."}
   * @paramDef {"type":"String","label":"Bank Country","name":"countryCode","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["United Kingdom","Germany","France","Netherlands","Spain","Italy","Ireland","Austria","Belgium","Portugal","Finland","Luxembourg","Sweden","Denmark","Australia","New Zealand","Canada","United States"]}},"description":"Country where the bank is. Required when using account number (not needed for IBAN)."}
   * @returns {Object}
   * @sampleResult {"available_debit_schemes":["bacs","faster_payments"],"bank_name":"MONZO BANK LIMITED","bic":"MONZGB2L"}
   */
  async lookupBankDetails(
    iban,
    accountNumber,
    branchCode,
    bankCode,
    countryCode
  ) {
    if (!iban && !accountNumber) {
      throw new Error(
        '[GoCardless] Either iban or accountNumber must be supplied'
      )
    }

    const body = {
      bank_details_lookups:
        cleanupObject({
          iban,
          account_number: accountNumber,
          branch_code: branchCode,
          bank_code: bankCode,
          country_code: resolveChoice(countryCode, COUNTRY_LABELS),
        }) || {},
    }

    const response = await this.#api({
      path: '/bank_details_lookups',
      method: 'post',
      body,
      logTag: 'lookupBankDetails',
    })

    return this.#unwrap(response, 'bank_details_lookups')
  }

  /**
   * @description Sandbox-only helper that forces a resource into a specific state (e.g. mark a payment as confirmed, fail a mandate). Use during testing to exercise state-dependent code paths without waiting for real bank settlements. Fails on live with a 400 error.
   * @route POST /run-scenario-simulator
   * @operationName Run Test Scenario (Sandbox Only)
   * @category Utility
   * @appearanceColor #757575 #424242
   * @paramDef {"type":"String","label":"Scenario","name":"scenario","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Payment Submitted","Payment Confirmed","Payment Paid Out","Payment Failed","Payment Late Failure","Payment Late Failure Settled","Payment Charged Back","Payment Chargeback Settled","Mandate Activated","Mandate Customer Approval Granted","Mandate Customer Approval Skipped","Mandate Failed","Mandate Expired","Mandate Transferred","Mandate Transferred With Resubmission","Mandate Suspended By Payer","Refund Paid","Refund Settled","Refund Bounced","Refund Returned","Payout Bounced","Creditor Verification Status Action Required","Creditor Verification Status In Review","Creditor Verification Status Successful","Billing Request Fulfilled","Billing Request Fulfilled And Payment Failed","Billing Request Fulfilled And Payment Confirmed To Failed","Billing Request Fulfilled And Payment Paid Out"]}},"description":"State change to simulate."}
   * @paramDef {"type":"String","label":"Resource ID","name":"resourceId","required":true,"description":"ID of the resource to transition. The resource type depends on the scenario, so there is no single pick-list - paste the matching ID (for example a payment ID for any 'payment_' scenario)."}
   * @returns {Object}
   * @sampleResult {"scenario_simulators":{"id":"payment_confirmed"}}
   */
  async runScenarioSimulator(scenario, resourceId) {
    if (!scenario) throw new Error('[GoCardless] scenario is required')
    if (!resourceId) throw new Error('[GoCardless] resourceId is required')

    const scenarioKey = resolveChoice(scenario, SCENARIO_LABELS)

    if (!(scenarioKey in SCENARIO_SIMULATORS)) {
      throw new Error(
        `[GoCardless] Unknown scenario "${ scenario }". See the Scenario dropdown for valid values.`
      )
    }

    const response = await this.#api({
      path: `/scenario_simulators/${ scenarioKey }/actions/run`,
      method: 'post',
      body: { data: { links: { resource: resourceId } } },
      logTag: 'runScenarioSimulator',
    })

    return response
  }

  // ===========================================================================
  // 13. POLLING TRIGGERS
  // ===========================================================================

  // Shared polling logic for every event trigger. `resourceType` is fixed per trigger; `action` is
  // the optional configured filter. Correctness rules (judgment.md section 16): seed-and-emit-[] on
  // the first cycle, window by time with overlap and sort ascending, exhaust the cursor but carry a
  // residual page cursor rather than advancing the watermark past undrained pages, and de-dup the
  // overlap against a bounded seen-id set. State shape:
  //   { since, seenIds, windowStart?, pageCursor?, pendingMax? }
  async #pollEvents({ resourceType, action, state, learningMode }) {
    const baseFilter = cleanupObject({
      resource_type: resourceType,
      action: toCommaList(resolveChoices(action, EVENT_ACTION_LABELS)),
    })

    // Learning mode: hand back the single newest event so the flow builder sees a real shape.
    if (learningMode) {
      const probe = await this.#api({
        path: '/events',
        logTag: `${ resourceType }Trigger:learn`,
        query: cleanupObject({ ...baseFilter, limit: 1 }),
      })
      const newest = probe?.events?.[0]

      return {
        events: newest
          ? [{ ...newest, resourceId: this.#extractResourceId(newest) }]
          : [],
        state: null,
      }
    }

    const prev = state || {}

    // First cycle: seed the watermark from the newest event and emit nothing (no backlog replay).
    if (!prev.since && !prev.pageCursor) {
      const probe = await this.#api({
        path: '/events',
        logTag: `${ resourceType }Trigger:seed`,
        query: cleanupObject({ ...baseFilter, limit: 1 }),
      })
      const newest = probe?.events?.[0]

      return {
        events: [],
        state: {
          since: newest?.created_at || new Date().toISOString(),
          seenIds: newest?.id ? [newest.id] : [],
        },
      }
    }

    // Mid-drain (a previous poll hit the page cap): keep the same lower bound and resume from the
    // carried cursor so the residual older pages drain before the watermark moves. Otherwise open a
    // fresh window that overlaps the stored watermark so a late-listable event just under the
    // boundary is re-scanned; the seen-set below removes the duplicates.
    const draining = Boolean(prev.pageCursor)
    const windowStart = draining
      ? prev.windowStart
      : new Date(Date.parse(prev.since) - POLL_OVERLAP_MS).toISOString()

    const query = cleanupObject({
      ...baseFilter,
      'created_at[gte]': windowStart,
      limit: MAX_PAGE_SIZE,
    })

    let collected = []
    let cursor = prev.pageCursor || null
    let pages = 0
    let residual = null

    do {
      const response = await this.#api({
        path: '/events',
        logTag: `${ resourceType }Trigger:poll`,
        query: cleanupObject({ ...query, after: cursor }),
      })

      collected = collected.concat(response?.events || [])
      cursor = response?.meta?.cursors?.after || null
      pages++

      // Bound the work per poll, but CARRY the live cursor into state so the next poll resumes -
      // dropping it (and advancing the watermark) would lose the un-fetched events forever.
      if (cursor && pages >= POLLING_MAX_PAGES) {
        residual = cursor

        break
      }
    } while (cursor)

    // Fire oldest-first so downstream sees events in chronological order.
    collected.sort((a, b) =>
      (a.created_at || '').localeCompare(b.created_at || '')
    )

    const seen = new Set(prev.seenIds || [])
    const events = collected
      .filter(ev => ev.id && !seen.has(ev.id))
      .map(ev => ({ ...ev, resourceId: this.#extractResourceId(ev) }))

    const seenIds = [
      ...collected.map(ev => ev.id).filter(Boolean),
      ...(prev.seenIds || []),
    ].slice(0, MAX_SEEN_EVENT_IDS)

    // Running max across the whole (possibly multi-poll) drain, so the watermark never regresses to
    // an older page's max once the residual pages are drained.
    const batchMax = collected.reduce(
      (max, ev) => (ev.created_at && ev.created_at > max ? ev.created_at : max),
      prev.pendingMax || prev.since
    )

    if (residual) {
      return {
        events,
        state: {
          since: prev.since,
          windowStart,
          pageCursor: residual,
          pendingMax: batchMax,
          seenIds,
        },
      }
    }

    return {
      events,
      state: { since: batchMax, seenIds },
    }
  }

  #extractResourceId(event) {
    if (!event?.links) return null
    const singular = {
      payments: 'payment',
      mandates: 'mandate',
      subscriptions: 'subscription',
      refunds: 'refund',
      payouts: 'payout',
      billing_requests: 'billing_request',
      customers: 'customer',
      instalment_schedules: 'instalment_schedule',
      creditors: 'creditor',
      organisations: 'organisation',
    }[event.resource_type]

    return event.links[singular] || null
  }

  /**
   * @registerAs POLLING_TRIGGER
   * @description Fires when something happens to a payment - submitted, confirmed, paid out, failed, charged back. Use for accounting automations, customer notifications, or syncing payment state to your system.
   * @operationName When a Payment Event Happens
   * @category Triggers
   * @appearanceColor #ff7043 #d84315
   * @paramDef {"type":"String","label":"Only When Action Is","name":"action","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Created","Customer Approval Granted","Customer Approval Denied","Submitted","Confirmed","Failed","Cancelled","Paid Out","Late Failure Settled","Chargeback Cancelled","Chargeback Settled","Charged Back","Resubmission Requested"]}},"description":"Only fire on this action. Examples: 'confirmed' = bank has accepted the charge, 'paid_out' = money is in your account, 'failed' = bounced. Leave blank to fire on all payment events."}
   * @returns {Object}
   * @sampleResult {"id":"EV000PAYMENT1","created_at":"2026-05-16T10:00:00.000Z","resource_type":"payments","action":"confirmed","details":{"origin":"gocardless","cause":"payment_confirmed","description":"Payment confirmed by the banks.","scheme":"bacs"},"metadata":{},"links":{"payment":"PM000123456","mandate":"MD000123456"},"resourceId":"PM000123456"}
   */
  async onPaymentEvent(invocation) {
    return this.#pollEvents({
      resourceType: 'payments',
      action: invocation?.triggerData?.action,
      state: invocation?.state,
      learningMode: invocation?.learningMode,
    })
  }

  /**
   * @registerAs POLLING_TRIGGER
   * @description Fires when something happens to a mandate - created, activated, failed, cancelled, expired. Use to drive onboarding flows, dunning, or sync mandate state to your system.
   * @operationName When a Mandate Event Happens
   * @category Triggers
   * @appearanceColor #1e88e5 #0d47a1
   * @paramDef {"type":"String","label":"Only When Action Is","name":"action","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Created","Customer Approval Granted","Customer Approval Skipped","Submitted","Active","Failed","Cancelled","Transferred","Expired","Resubmission Requested","Reinstated","Replaced","Consumed","Blocked","Suspended By Payer"]}},"description":"Only fire on this action. Examples: 'active' = customer is now chargeable, 'cancelled' = customer or you cancelled. Leave blank for all mandate events."}
   * @returns {Object}
   * @sampleResult {"id":"EV000MANDATE1","created_at":"2026-05-16T10:00:00.000Z","resource_type":"mandates","action":"active","details":{"origin":"gocardless","cause":"mandate_activated","description":"Mandate has been successfully activated.","scheme":"bacs"},"metadata":{},"links":{"mandate":"MD000123456","customer":"CU000123456"},"resourceId":"MD000123456"}
   */
  async onMandateEvent(invocation) {
    return this.#pollEvents({
      resourceType: 'mandates',
      action: invocation?.triggerData?.action,
      state: invocation?.state,
      learningMode: invocation?.learningMode,
    })
  }

  /**
   * @registerAs POLLING_TRIGGER
   * @description Fires when something happens to a subscription - created, cancelled, paused, resumed, finished, or a charge was generated.
   * @operationName When a Subscription Event Happens
   * @category Triggers
   * @appearanceColor #8e24aa #4a148c
   * @paramDef {"type":"String","label":"Only When Action Is","name":"action","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Created","Payment Created","Cancelled","Paused","Resumed","Finished","Customer Approval Granted","Customer Approval Denied","Scheduled Pause Started"]}},"description":"Only fire on this action. Examples: 'payment_created' = a charge for this cycle was just generated, 'cancelled' = subscription stopped. Leave blank for all."}
   * @returns {Object}
   * @sampleResult {"id":"EV000SUBSCRIB1","created_at":"2026-05-16T10:00:00.000Z","resource_type":"subscriptions","action":"payment_created","details":{"origin":"gocardless","cause":"subscription_payment_created","description":"A payment was created for this subscription's billing cycle.","scheme":"bacs"},"metadata":{},"links":{"subscription":"SB000123456","mandate":"MD000123456"},"resourceId":"SB000123456"}
   */
  async onSubscriptionEvent(invocation) {
    return this.#pollEvents({
      resourceType: 'subscriptions',
      action: invocation?.triggerData?.action,
      state: invocation?.state,
      learningMode: invocation?.learningMode,
    })
  }

  /**
   * @registerAs POLLING_TRIGGER
   * @description Fires when something happens to a refund - paid, settled, bounced, returned. Use to confirm a refund actually went through.
   * @operationName When a Refund Event Happens
   * @category Triggers
   * @appearanceColor #43a047 #1b5e20
   * @paramDef {"type":"String","label":"Only When Action Is","name":"action","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Created","Paid","Submitted","Cancelled","Failed","Bounced","Funds Returned","Refund Settled"]}},"description":"Only fire on this action. 'paid' = refund left your account, 'refund_settled' = customer received it. Leave blank for all."}
   * @returns {Object}
   * @sampleResult {"id":"EV000REFUND1","created_at":"2026-05-16T10:00:00.000Z","resource_type":"refunds","action":"paid","details":{"origin":"gocardless","cause":"refund_paid","description":"Refund has been paid to the customer's bank.","scheme":"bacs"},"metadata":{},"links":{"refund":"RF000123456","payment":"PM000123456","mandate":"MD000123456"},"resourceId":"RF000123456"}
   */
  async onRefundEvent(invocation) {
    return this.#pollEvents({
      resourceType: 'refunds',
      action: invocation?.triggerData?.action,
      state: invocation?.state,
      learningMode: invocation?.learningMode,
    })
  }

  /**
   * @registerAs POLLING_TRIGGER
   * @description Fires when a payout from GoCardless to your bank account changes state - paid (money in your bank), bounced, FX rate confirmed, or tax updated.
   * @operationName When a Payout Event Happens
   * @category Triggers
   * @appearanceColor #00897b #004d40
   * @paramDef {"type":"String","label":"Only When Action Is","name":"action","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Paid","Bounced","Fx Rate Confirmed","Tax Updated"]}},"description":"Only fire on this action. 'paid' is the usual one - fires when the money lands in your bank account. Leave blank for all."}
   * @returns {Object}
   * @sampleResult {"id":"EV000PAYOUT1","created_at":"2026-05-16T10:00:00.000Z","resource_type":"payouts","action":"paid","details":{"origin":"gocardless","cause":"payout_paid","description":"Payout has been paid to your bank account.","scheme":"bacs"},"metadata":{},"links":{"payout":"PO000123456","creditor":"CR000000000001"},"resourceId":"PO000123456"}
   */
  async onPayoutEvent(invocation) {
    return this.#pollEvents({
      resourceType: 'payouts',
      action: invocation?.triggerData?.action,
      state: invocation?.state,
      learningMode: invocation?.learningMode,
    })
  }

  /**
   * @registerAs POLLING_TRIGGER
   * @description Fires during a hosted billing flow - customer opens the page, submits details, completes, or abandons. Use to track conversion or react to a successful sign-up immediately.
   * @operationName When a Billing Request Event Happens
   * @category Triggers
   * @appearanceColor #5e35b1 #311b92
   * @paramDef {"type":"String","label":"Only When Action Is","name":"action","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Created","Customer Details Confirmed","Bank Account Collected","Flow Created","Flow Initialised","Flow Completed","Flow Visited","Flow Exited","Payer Finalised Payment Details","Fulfilled","Cancelled","Failed"]}},"description":"Only fire on this action. Examples: 'fulfilled' = customer finished and mandate/payment is created, 'flow_exited' = customer left without finishing. Leave blank for all."}
   * @returns {Object}
   * @sampleResult {"id":"EV000BILLREQ1","created_at":"2026-05-16T10:00:00.000Z","resource_type":"billing_requests","action":"fulfilled","details":{"origin":"gocardless","cause":"billing_request_fulfilled","description":"Billing request has been fulfilled.","scheme":"bacs"},"metadata":{},"links":{"billing_request":"BRQ000ABCDEF","customer":"CU000123456"},"resourceId":"BRQ000ABCDEF"}
   */
  async onBillingRequestEvent(invocation) {
    return this.#pollEvents({
      resourceType: 'billing_requests',
      action: invocation?.triggerData?.action,
      state: invocation?.state,
      learningMode: invocation?.learningMode,
    })
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerPollingForEvent
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    return this[invocation.eventName](invocation)
  }

  // ===========================================================================
  // 14. SAMPLE RESULT LOADERS
  // ===========================================================================
  // Dynamic sample results so AI agents see realistic shapes per resource.

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /sample/customer
   */
  async getCustomer_SampleResultLoader() {
    return {
      id: 'CU000123456',
      created_at: '2026-05-16T10:00:00.000Z',
      email: 'jane@example.com',
      given_name: 'Jane',
      family_name: 'Doe',
      company_name: null,
      country_code: 'GB',
      language: 'en',
      phone_number: '+447000000000',
      address_line1: '10 Downing St',
      city: 'London',
      postal_code: 'SW1A 2AA',
      metadata: {},
    }
  }

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /sample/mandate
   */
  async getMandate_SampleResultLoader() {
    return {
      id: 'MD000123456',
      created_at: '2026-05-16T10:00:00.000Z',
      reference: 'REF-1234',
      status: 'active',
      scheme: 'bacs',
      next_possible_charge_date: '2026-05-20',
      payments_require_approval: false,
      metadata: {},
      links: {
        customer: 'CU000123456',
        customer_bank_account: 'BA000123456',
        creditor: 'CR000000000001',
      },
    }
  }

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /sample/payment
   */
  async getPayment_SampleResultLoader() {
    return {
      id: 'PM000123456',
      created_at: '2026-05-16T10:00:00.000Z',
      amount: 1000,
      currency: 'GBP',
      status: 'pending_submission',
      charge_date: '2026-05-19',
      description: 'Order #4242',
      reference: 'INV-4242',
      amount_refunded: 0,
      metadata: {},
      links: {
        mandate: 'MD000123456',
        creditor: 'CR000000000001',
      },
    }
  }

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /sample/subscription
   */
  async getSubscription_SampleResultLoader() {
    return {
      id: 'SB000123456',
      created_at: '2026-05-16T10:00:00.000Z',
      name: 'Standard Plan',
      amount: 1500,
      currency: 'GBP',
      status: 'active',
      interval: 1,
      interval_unit: 'monthly',
      day_of_month: 15,
      start_date: '2026-06-15',
      end_date: null,
      count: null,
      payment_reference: null,
      upcoming_payments: [
        { charge_date: '2026-06-15', amount: 1500 },
        { charge_date: '2026-07-15', amount: 1500 },
      ],
      metadata: {},
      links: { mandate: 'MD000123456' },
    }
  }

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /sample/instalment-schedule
   */
  async getInstalmentSchedule_SampleResultLoader() {
    return {
      id: 'IS000123456',
      created_at: '2026-05-16T10:00:00.000Z',
      name: 'Invoice 1234',
      currency: 'GBP',
      total_amount: 3000,
      status: 'active',
      payment_reference: 'INV-1234',
      metadata: {},
      links: {
        mandate: 'MD000123456',
        customer: 'CU000123456',
        payments: ['PM000123456', 'PM000123457', 'PM000123458'],
      },
    }
  }

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /sample/refund
   */
  async getRefund_SampleResultLoader() {
    return {
      id: 'RF000123456',
      created_at: '2026-05-16T10:00:00.000Z',
      amount: 500,
      currency: 'GBP',
      reference: 'REFUND-1',
      metadata: {},
      links: {
        payment: 'PM000123456',
        mandate: 'MD000123456',
      },
    }
  }

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /sample/payout
   */
  async getPayout_SampleResultLoader() {
    return {
      id: 'PO000123456',
      created_at: '2026-05-16T10:00:00.000Z',
      amount: 25000,
      currency: 'GBP',
      deducted_fees: 200,
      arrival_date: '2026-05-18',
      status: 'pending',
      payout_type: 'merchant',
      links: {
        creditor: 'CR000000000001',
        creditor_bank_account: 'BA000ABCDEFGH',
      },
    }
  }

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /sample/event
   */
  async getEvent_SampleResultLoader() {
    return {
      id: 'EV000ABCDEFG',
      created_at: '2026-05-16T10:00:00.000Z',
      resource_type: 'payments',
      action: 'confirmed',
      details: {
        origin: 'gocardless',
        cause: 'payment_confirmed',
        description: 'Payment confirmed by the banks.',
        scheme: 'bacs',
      },
      metadata: {},
      links: { payment: 'PM000123456', mandate: 'MD000123456' },
      resourceId: 'PM000123456',
    }
  }

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /sample/billing-request-flow
   */
  async createBillingRequestFlow_SampleResultLoader() {
    return {
      id: 'BRF000ABCDEF',
      created_at: '2026-05-16T10:00:00.000Z',
      authorisation_url: 'https://pay.gocardless.com/flow/BRF000ABCDEF',
      redirect_uri: 'https://your-app.example.com/return',
      exit_uri: 'https://your-app.example.com/exit',
      expires_at: '2026-05-17T10:00:00.000Z',
      auto_fulfil: true,
      lock_currency: false,
      links: { billing_request: 'BRQ000ABCDEF' },
    }
  }

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /sample/mandate-import
   */
  async getMandateImport_SampleResultLoader() {
    return {
      id: 'IM000010790WX1',
      created_at: '2026-05-16T10:00:00.000Z',
      scheme: 'bacs',
      status: 'created',
      links: { creditor: 'CR000000000001' },
    }
  }

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /sample/creditor
   */
  async getCreditor_SampleResultLoader() {
    return {
      id: 'CR000000000001',
      created_at: '2026-05-16T10:00:00.000Z',
      name: 'Acme Ltd',
      address_line1: null,
      address_line2: null,
      address_line3: null,
      city: null,
      region: null,
      postal_code: null,
      country_code: 'GB',
      creditor_type: 'company',
      logo_url: null,
      scheme_identifiers: [],
      verification_status: 'successful',
      can_create_refunds: false,
      fx_payout_currency: null,
      mandate_imports_enabled: false,
      custom_payment_pages_enabled: true,
      merchant_responsible_for_notifications: true,
      bank_reference_prefix: 'ACME',
      links: { default_gbp_payout_account: 'BA000ABCDEFGH' },
    }
  }

  // ===========================================================================
  // 16. PARAM SCHEMA LOADERS (sub-forms for Object params)
  // ===========================================================================
  // Return an array of paramDef-style field objects (the sub-form), NOT JSON Schema. Field names
  // are the exact snake_case keys GoCardless expects, so the collected object passes straight
  // through to the request body.

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /prefilled-customer-schema
   * @returns {Object}
   */
  async prefilledCustomerSchema() {
    return [
      { type: 'String', label: 'Email', name: 'email', required: false, description: 'Customer email address.' },
      { type: 'String', label: 'First Name', name: 'given_name', required: false, description: 'First name (individuals).' },
      { type: 'String', label: 'Last Name', name: 'family_name', required: false, description: 'Last name (individuals).' },
      { type: 'String', label: 'Company Name', name: 'company_name', required: false, description: 'Business name (companies).' },
      { type: 'String', label: 'Address Line 1', name: 'address_line1', required: false, description: 'Street address, first line.' },
      { type: 'String', label: 'City', name: 'city', required: false, description: 'City or town.' },
      { type: 'String', label: 'Postal Code', name: 'postal_code', required: false, description: 'Postal or ZIP code.' },
      { type: 'String', label: 'Country', name: 'country_code', required: false, description: 'ISO 3166-1 alpha-2 country code (for example GB, DE, US).' },
      { type: 'String', label: 'Language', name: 'language', required: false, description: 'ISO 639-1 language code for the hosted page (for example en, de, fr).' },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /mandate-pdf-prefill-schema
   * @returns {Object}
   */
  async mandatePdfPrefillSchema() {
    return [
      { type: 'String', label: 'Account Holder Name', name: 'account_holder_name', required: false, description: 'Name on the bank account.' },
      { type: 'String', label: 'IBAN', name: 'iban', required: false, description: 'International bank account number (European accounts). Use instead of account number + branch code.' },
      { type: 'String', label: 'Account Number', name: 'account_number', required: false, description: 'Local account number. Pair with Branch Code.' },
      { type: 'String', label: 'Branch Code', name: 'branch_code', required: false, description: 'Sort code (UK), routing number (US), BSB (AU). Pair with Account Number.' },
      { type: 'String', label: 'Country', name: 'country_code', required: false, description: 'ISO 3166-1 alpha-2 country code of the bank account.' },
      { type: 'String', label: 'Scheme', name: 'scheme', required: false, description: 'Direct Debit scheme (for example bacs, sepa_core, ach).' },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /mandate-import-entry-customer-schema
   * @returns {Object}
   */
  async mandateImportEntryCustomerSchema() {
    return [
      { type: 'String', label: 'First Name', name: 'given_name', required: false, description: 'First name. Required unless a company name is provided.' },
      { type: 'String', label: 'Last Name', name: 'family_name', required: false, description: 'Surname. Required unless a company name is provided.' },
      { type: 'String', label: 'Company Name', name: 'company_name', required: false, description: 'Business name. Required unless first + last name are provided. For Canadian customers this makes the mandate a Business PAD.' },
      { type: 'String', label: 'Email', name: 'email', required: false, description: 'Email address. Needed in most cases so GoCardless can send notifications.' },
      { type: 'String', label: 'Phone Number', name: 'phone_number', required: false, description: 'Phone number in international format, including country code.' },
      { type: 'String', label: 'Address Line 1', name: 'address_line1', required: false, description: 'Street address, first line. Required for Bacs and SEPA imports.' },
      { type: 'String', label: 'Address Line 2', name: 'address_line2', required: false, description: 'Street address, second line.' },
      { type: 'String', label: 'Address Line 3', name: 'address_line3', required: false, description: 'Street address, third line.' },
      { type: 'String', label: 'City', name: 'city', required: false, description: 'City or town.' },
      { type: 'String', label: 'Region', name: 'region', required: false, description: 'Region, county, or department. US customers need a 2-letter state code (e.g. CA).' },
      { type: 'String', label: 'Postal Code', name: 'postal_code', required: false, description: 'Postal or ZIP code. Required for Bacs and SEPA imports.' },
      { type: 'String', label: 'Country', name: 'country_code', required: false, description: 'ISO 3166-1 alpha-2 country code (for example GB, DE, US).' },
      { type: 'String', label: 'Language', name: 'language', required: false, description: 'ISO 639-1 language for GoCardless notification emails (en, fr, de, pt, es, it, nl, da, nb, sl, sv).' },
      { type: 'String', label: 'Swedish Identity Number', name: 'swedish_identity_number', required: false, description: 'Sweden only - personnummer, samordningsnummer, or organisationsnummer. Required for SEK accounts.' },
      { type: 'String', label: 'Danish Identity Number', name: 'danish_identity_number', required: false, description: 'Denmark only - CPR or CVR number. Required for DKK accounts.' },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /mandate-import-entry-bank-account-schema
   * @returns {Object}
   */
  async mandateImportEntryBankAccountSchema() {
    return [
      { type: 'String', label: 'Account Holder Name', name: 'account_holder_name', required: false, description: 'Name on the bank account (required). Transliterated, upcased, and truncated to 18 characters by GoCardless.' },
      { type: 'String', label: 'IBAN', name: 'iban', required: false, description: 'International bank account number - use for most European accounts. Not accepted for Swedish SEK accounts. Leave blank if using local details.' },
      { type: 'String', label: 'Account Number', name: 'account_number', required: false, description: 'Local account number. Pair with the sort/branch/bank code fields. Leave blank if using IBAN.' },
      { type: 'String', label: 'Sort Code / Routing Number', name: 'branch_code', required: false, description: 'The local routing code - sort code (UK), BSB (Australia), routing number (US).' },
      { type: 'String', label: 'Bank Code', name: 'bank_code', required: false, description: 'Bank code used by Canada and New Zealand schemes.' },
      { type: 'String', label: 'Account Type (US Only)', name: 'account_type', required: false, description: 'US dollar (ACH) accounts only - checking or savings. Leave blank for every other currency.' },
      { type: 'String', label: 'Country', name: 'country_code', required: false, description: 'ISO 3166-1 alpha-2 country of the account. Inferred from the IBAN when supplied - otherwise required.' },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /mandate-import-entry-amendment-schema
   * @returns {Object}
   */
  async mandateImportEntryAmendmentSchema() {
    return [
      { type: 'String', label: 'Original Mandate Reference', name: 'original_mandate_reference', required: false, description: 'The unique SEPA reference of the mandate being moved. Required for SEPA imports.' },
      { type: 'String', label: 'Original Creditor ID', name: 'original_creditor_id', required: false, description: 'The creditor identifier of the original Direct Debit originator. Required for SEPA imports.' },
      { type: 'String', label: 'Original Creditor Name', name: 'original_creditor_name', required: false, description: 'Name of the previous Direct Debit provider the mandate is moving from.' },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /billing-request-customer-schema
   * @returns {Object}
   */
  async billingRequestCustomerSchema() {
    return [
      { type: 'String', label: 'First Name', name: 'given_name', required: false, description: 'First name. Required unless a company name is provided.' },
      { type: 'String', label: 'Last Name', name: 'family_name', required: false, description: 'Surname. Required unless a company name is provided.' },
      { type: 'String', label: 'Company Name', name: 'company_name', required: false, description: 'Business name. Required unless first + last name are provided. For Canadian payers this makes the mandate a Business PAD.' },
      { type: 'String', label: 'Email', name: 'email', required: false, description: 'Email address. Required in most cases so GoCardless can send notifications.' },
      { type: 'String', label: 'Phone Number', name: 'phone_number', required: false, description: 'Phone number in international format, including country code.' },
      { type: 'String', label: 'Language', name: 'language', required: false, description: 'ISO 639-1 language for GoCardless notification emails (en, fr, de, pt, es, it, nl, da, nb, sl, sv).' },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /billing-request-billing-detail-schema
   * @returns {Object}
   */
  async billingRequestBillingDetailSchema() {
    return [
      { type: 'String', label: 'Address Line 1', name: 'address_line1', required: false, description: 'First line of the billing address.' },
      { type: 'String', label: 'Address Line 2', name: 'address_line2', required: false, description: 'Second line of the billing address.' },
      { type: 'String', label: 'Address Line 3', name: 'address_line3', required: false, description: 'Third line of the billing address.' },
      { type: 'String', label: 'City', name: 'city', required: false, description: 'City or town.' },
      { type: 'String', label: 'Region', name: 'region', required: false, description: 'Region, county, or department. US payers need a 2-letter state code (e.g. CA).' },
      { type: 'String', label: 'Postal Code', name: 'postal_code', required: false, description: 'Postal or ZIP code.' },
      { type: 'String', label: 'Country', name: 'country_code', required: false, description: 'ISO 3166-1 alpha-2 country code (for example GB, DE, US).' },
      { type: 'String', label: 'IP Address (ACH Only)', name: 'ip_address', required: false, description: "US ACH only - the payer's IP address captured when they completed the mandate setup in their browser. Not needed for telephone or paper mandates." },
      { type: 'String', label: 'Swedish Identity Number', name: 'swedish_identity_number', required: false, description: 'Sweden only - personnummer, samordningsnummer, or organisationsnummer. Required for SEK accounts. Cannot be changed once set.' },
      { type: 'String', label: 'Danish Identity Number', name: 'danish_identity_number', required: false, description: 'Denmark only - CPR or CVR number. Required for DKK accounts.' },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /creditor-payout-accounts-schema
   * @returns {Object}
   */
  async creditorPayoutAccountsSchema() {
    return [
      { type: 'String', label: 'GBP Payout Account', name: 'default_gbp_payout_account', required: false, description: 'Bank account ID (starts with BA) that receives payouts in British pounds.' },
      { type: 'String', label: 'EUR Payout Account', name: 'default_eur_payout_account', required: false, description: 'Bank account ID that receives payouts in euros.' },
      { type: 'String', label: 'USD Payout Account', name: 'default_usd_payout_account', required: false, description: 'Bank account ID that receives payouts in US dollars.' },
      { type: 'String', label: 'AUD Payout Account', name: 'default_aud_payout_account', required: false, description: 'Bank account ID that receives payouts in Australian dollars.' },
      { type: 'String', label: 'NZD Payout Account', name: 'default_nzd_payout_account', required: false, description: 'Bank account ID that receives payouts in New Zealand dollars.' },
      { type: 'String', label: 'CAD Payout Account', name: 'default_cad_payout_account', required: false, description: 'Bank account ID that receives payouts in Canadian dollars.' },
      { type: 'String', label: 'SEK Payout Account', name: 'default_sek_payout_account', required: false, description: 'Bank account ID that receives payouts in Swedish kronor.' },
      { type: 'String', label: 'DKK Payout Account', name: 'default_dkk_payout_account', required: false, description: 'Bank account ID that receives payouts in Danish kroner.' },
    ]
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  // Clamp limit to GoCardless's [1, 500] band. NaN/null/undefined > default page size.
  #clampLimit(limit) {
    const n = Number(limit)

    if (!Number.isFinite(n) || n <= 0) return DEFAULT_PAGE_SIZE

    return Math.min(Math.max(1, Math.floor(n)), MAX_PAGE_SIZE)
  }

  // GoCardless accepts `created_at[gte]=...&created_at[lte]=...` as bracketed query params.
  // Flatten {gte, lte} to that shape so it serialises cleanly through Flowrunner.Request.query().
  #flattenCreatedAt(createdAt) {
    const out = {}

    if (createdAt.gte) out['created_at[gte]'] = createdAt.gte
    if (createdAt.lte) out['created_at[lte]'] = createdAt.lte
    if (createdAt.gt) out['created_at[gt]'] = createdAt.gt
    if (createdAt.lt) out['created_at[lt]'] = createdAt.lt

    return out
  }
}

// =================================================================================================
// SERVICE REGISTRATION
// =================================================================================================

Flowrunner.ServerCode.addService(GoCardlessService, [
  {
    displayName: 'Client ID',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth Client ID from your GoCardless partner app. Create one at manage.gocardless.com > Developers > Partner apps (or manage-sandbox.gocardless.com for sandbox).',
  },
  {
    displayName: 'Client Secret',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth Client Secret shown once when you created the partner app. If you lost it, you have to create a new app.',
  },
  {
    displayName: 'Environment',
    name: 'environment',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    required: true,
    shared: false,
    defaultValue: 'live',
    options: ['live', 'sandbox'],
    hint: "Pick 'sandbox' while testing, 'live' for real transactions. A sandbox connection cannot be used for live API calls - you register a separate partner app for each.",
  },
])
