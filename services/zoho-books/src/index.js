'use strict'

const crypto = require('crypto')

// =================================================================================================
// Zoho Books Service - FlowRunner Extension
// =================================================================================================
// Zoho operates in multiple data centers (US, EU, IN, AU, JP, CA, CN, SA). When "Multi-DC" is
// enabled on the Zoho Developer Console client, the same client_id can be used across regions.
// During the OAuth2 callback Zoho returns:
//   - `accounts-server` (full URL of the accounts server, e.g. https://accounts.zoho.eu)
//   - `location` (region code, e.g. eu, us)
//   - `api_domain` (the API base for that user's organization, e.g. https://www.zohoapis.eu)
// We persist `apiDomain` and `accountsServer` in connection user data so that subsequent token
// refreshes and API calls hit the correct region. Falls back to the configured `dataCenter`.
// =================================================================================================

const DATA_CENTERS = {
  US: { accountsServer: 'https://accounts.zoho.com', apiDomain: 'https://www.zohoapis.com' },
  EU: { accountsServer: 'https://accounts.zoho.eu', apiDomain: 'https://www.zohoapis.eu' },
  IN: { accountsServer: 'https://accounts.zoho.in', apiDomain: 'https://www.zohoapis.in' },
  AU: { accountsServer: 'https://accounts.zoho.com.au', apiDomain: 'https://www.zohoapis.com.au' },
  JP: { accountsServer: 'https://accounts.zoho.jp', apiDomain: 'https://www.zohoapis.jp' },
  CA: { accountsServer: 'https://accounts.zoho.ca', apiDomain: 'https://www.zohoapis.ca' },
  CN: { accountsServer: 'https://accounts.zoho.com.cn', apiDomain: 'https://www.zohoapis.com.cn' },
  SA: { accountsServer: 'https://accounts.zoho.sa', apiDomain: 'https://www.zohoapis.sa' },
}

const DEFAULT_DATA_CENTER = 'US'

const DEFAULT_SCOPE_LIST = [
  'ZohoBooks.contacts.ALL',
  'ZohoBooks.settings.ALL',
  'ZohoBooks.estimates.ALL',
  'ZohoBooks.invoices.ALL',
  'ZohoBooks.customerpayments.ALL',
  'ZohoBooks.creditnotes.ALL',
  'ZohoBooks.projects.ALL',
  'ZohoBooks.expenses.ALL',
  'ZohoBooks.salesorders.ALL',
  'ZohoBooks.purchaseorders.ALL',
  'ZohoBooks.bills.ALL',
  'ZohoBooks.debitnotes.ALL',
  'ZohoBooks.vendorpayments.ALL',
  'ZohoBooks.banking.ALL',
  'ZohoBooks.accountants.ALL',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const DEFAULT_PAGE_SIZE = 50
const DICTIONARY_PAGE_SIZE = 100
const POLLING_MAX_PAGES = 50

// Friendly dropdown labels are submitted verbatim by the UI; these maps translate each label back
// to the API value the Zoho Books endpoints expect.
const CONTACT_TYPE_MAP = { Customer: 'customer', Vendor: 'vendor' }
const INVOICE_STATUS_MAP = {
  Draft: 'draft',
  Sent: 'sent',
  Overdue: 'overdue',
  Paid: 'paid',
  Void: 'void',
  Unpaid: 'unpaid',
  'Partially Paid': 'partially_paid',
  Viewed: 'viewed',
}
const BILL_STATUS_MAP = {
  Open: 'open',
  Paid: 'paid',
  Void: 'void',
  Draft: 'draft',
  Overdue: 'overdue',
  Unpaid: 'unpaid',
  'Partially Paid': 'partially_paid',
}
const EXPENSE_STATUS_MAP = {
  Unbilled: 'unbilled',
  Invoiced: 'invoiced',
  Reimbursed: 'reimbursed',
  'Non-Billable': 'non-billable',
  Billable: 'billable',
}
const PAYMENT_MODE_MAP = {
  Cash: 'cash',
  Check: 'check',
  'Bank Transfer': 'banktransfer',
  'Bank Remittance': 'bankremittance',
  'Credit Card': 'creditcard',
  'Auto Transaction': 'autotransaction',
  Others: 'others',
}
const RECURRENCE_FREQUENCY_MAP = { Days: 'days', Weeks: 'weeks', Months: 'months', Years: 'years' }

// Realtime trigger registry — operationName -> {entity, event}
const REALTIME_TRIGGERS = {
  onInvoiceCreatedRT: { entity: 'invoice', event: 'invoice.created' },
  onInvoiceUpdatedRT: { entity: 'invoice', event: 'invoice.updated' },
  onInvoiceDeletedRT: { entity: 'invoice', event: 'invoice.deleted' },
  onPaymentCreatedRT: { entity: 'customerpayment', event: 'payment.created' },
  onContactCreatedRT: { entity: 'contact', event: 'contact.created' },
  onContactUpdatedRT: { entity: 'contact', event: 'contact.updated' },
  onEstimateAcceptedRT: { entity: 'estimate', event: 'estimate.accepted' },
  onBillCreatedRT: { entity: 'bill', event: 'bill.created' },
  onBillPaidRT: { entity: 'bill', event: 'bill.paid' },
}

const EVENT_TO_TRIGGER = Object.fromEntries(
  Object.entries(REALTIME_TRIGGERS).map(([name, def]) => [def.event, name])
)

const logger = {
  info: (...args) => console.log('[Zoho Books Service] info:', ...args),
  debug: (...args) => console.log('[Zoho Books Service] debug:', ...args),
  error: (...args) => console.log('[Zoho Books Service] error:', ...args),
  warn: (...args) => console.log('[Zoho Books Service] warn:', ...args),
}

// ---------------------------- Service Class ----------------------------

/**
 * @requireOAuth
 * @integrationName Zoho Books
 * @integrationTriggersScope SINGLE_APP
 * @integrationIcon /icon.png
 **/
class ZohoBooksService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING

    const dcKey = (config.dataCenter || DEFAULT_DATA_CENTER).toUpperCase()
    const dc = DATA_CENTERS[dcKey] || DATA_CENTERS[DEFAULT_DATA_CENTER]

    this.defaultAccountsServer = dc.accountsServer
    this.defaultApiDomain = dc.apiDomain
    this.defaultOrganizationId = config.defaultOrganizationId || null
  }

  // ---------------------------- Header / DC Helpers ----------------------------

  /**
   * Returns the OAuth access-token header in Zoho's required format.
   * Zoho uses `Zoho-oauthtoken <token>`, NOT `Bearer`.
   */
  #getAccessTokenHeader(accessToken) {
    const token = accessToken || this.request.headers['oauth-access-token']

    return {
      Authorization: `Zoho-oauthtoken ${ token }`,
    }
  }

  /**
   * Resolves the API domain for the current request, preferring the per-connection
   * `api_domain` returned during the original token exchange and stored as user data.
   */
  #getApiDomain() {
    const headerDomain = this.request?.headers?.['oauth-user-data-apidomain']

    if (headerDomain) {
      return headerDomain
    }

    return this.defaultApiDomain
  }

  /**
   * Resolves the accounts server (token endpoint host) for token refresh, preferring
   * the per-connection `accounts-server` captured during the original consent flow.
   */
  #getAccountsServer() {
    const headerAccounts = this.request?.headers?.['oauth-user-data-accountsserver']

    if (headerAccounts) {
      return headerAccounts
    }

    return this.defaultAccountsServer
  }

  /**
   * Resolves the active organization_id for an action. Action methods accept
   * `organizationId` as a parameter; when missing, fall back to the configured default.
   */
  #resolveOrganizationId(organizationId) {
    const orgId = organizationId || this.defaultOrganizationId

    if (!orgId) {
      throw new Error(
        'organization_id is required. Provide one via the action parameter or set ' +
        '"Default Organization ID" in service configuration.'
      )
    }

    return orgId
  }

  /**
   * Maps a friendly dropdown label (submitted verbatim by the UI) to the API value Zoho expects.
   * Unknown values pass through unchanged so callers can still supply raw API values directly.
   */
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /**
   * Standardized API request helper. All Zoho Books endpoints require an `organization_id`
   * query parameter, which is automatically appended here when supplied.
   *
   * Error handling:
   *   - HTTP 401 / Zoho code 5: surfaced with a clear message. The FlowRunner OAuth runtime
   *     auto-refreshes the access token via `refreshToken()` and re-runs the action, so this
   *     wrapper does not retry inline.
   *   - HTTP 429 / Zoho codes 44 / 45 / 1070: distinct error messages so callers can tell
   *     per-minute, per-day, and concurrent-call ceilings apart.
   *
   * For DELETE we append `organization_id` to the URL directly because some HTTP backends drop
   * query strings on DELETE chains.
   */
  async #apiRequest({ url, method, body, query, organizationId, logTag }) {
    method = (method || 'get').toLowerCase()

    const finalQuery = cleanupObject({
      ...(query || {}),
      organization_id: organizationId,
    }) || {}

    let finalUrl = url

    if (method === 'delete' && organizationId) {
      const sep = url.includes('?') ? '&' : '?'

      finalUrl = `${ url }${ sep }organization_id=${ encodeURIComponent(organizationId) }`
    }

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ finalUrl }] q=[${ JSON.stringify(finalQuery) }]`)

      // Note: do NOT set Content-Type here. Flowrunner.Request.send() serializes an object body
      // to JSON (and sets application/json) on its own; presetting Content-Type makes it treat the
      // body as an already-encoded string and pass the raw object to the socket, which throws.
      const request = Flowrunner.Request[method](finalUrl)
        .set(this.#getAccessTokenHeader())
        .query(finalQuery)

      if (body) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      const zohoMessage = error?.body?.message || error?.message
      const zohoCode = error?.body?.code
      const httpStatus = error?.status || error?.statusCode

      logger.error(`${ logTag } - error http=${ httpStatus } code=${ zohoCode } message=${ zohoMessage }`)

      let prefix = '[Zoho Books]'

      if (zohoCode === 44 || (httpStatus === 429 && zohoCode !== 45 && zohoCode !== 1070)) {
        prefix = '[Zoho Books][rate-limited:per-minute]'
      } else if (zohoCode === 45) {
        prefix = '[Zoho Books][rate-limited:per-day]'
      } else if (zohoCode === 1070) {
        prefix = '[Zoho Books][rate-limited:concurrent]'
      } else if (zohoCode === 5 || httpStatus === 401) {
        prefix = '[Zoho Books][auth-expired]'
      } else if (zohoCode === 4404) {
        prefix = '[Zoho Books][bad-organization-id]'
      } else if (zohoCode === 1002) {
        prefix = '[Zoho Books][not-found]'
      }

      throw new Error(`${ prefix }[${ logTag }] ${ zohoMessage || 'Unknown error' }`)
    }
  }

  // ============================================================================================
  // OAUTH2 SYSTEM METHODS
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
    // `prompt=consent` ensures Zoho returns a refresh_token on every consent flow.
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
    // Multi-DC: Zoho may return the user's accounts-server in the callback. Use it for token
    // exchange so authorization codes minted in EU/IN/etc are redeemed against the right DC.
    const accountsServer = callbackObject['accounts-server'] ||
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
      tokenResponse = await Flowrunner.Request.post(`${ accountsServer }/oauth/v2/token`)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      logger.debug('[executeCallback] token exchange successful')
    } catch (error) {
      const zohoMsg = error?.body?.error || error?.message || 'Unknown error'

      logger.error(`[executeCallback] token exchange error: ${ zohoMsg }`)

      throw new Error(`[Zoho Books] OAuth token exchange failed: ${ zohoMsg }`)
    }

    if (tokenResponse.error) {
      logger.error(`[executeCallback] Zoho returned error: ${ tokenResponse.error }`)

      throw new Error(`[Zoho Books] OAuth token exchange returned error: ${ tokenResponse.error }`)
    }

    if (!tokenResponse.access_token) {
      throw new Error('[Zoho Books] OAuth token exchange returned no access_token')
    }

    // The api_domain returned with the token is the correct API host for this user.
    const apiDomain = tokenResponse.api_domain || this.defaultApiDomain

    // Discover the connected organizations to derive a friendly identity name.
    let identityName = 'Zoho Books Account'
    let primaryOrganization = null

    try {
      const orgsResponse = await Flowrunner.Request
        .get(`${ apiDomain }/books/v3/organizations`)
        .set({ Authorization: `Zoho-oauthtoken ${ tokenResponse.access_token }` })

      const organizations = orgsResponse?.organizations || []

      primaryOrganization = organizations.find(o => o.is_default_org) || organizations[0] || null

      if (primaryOrganization) {
        identityName = primaryOrganization.name || identityName
      }
    } catch (error) {
      logger.warn(`[executeCallback] failed to fetch organizations: ${ error.message }`)
    }

    return {
      token: tokenResponse.access_token,
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token,
      connectionIdentityName: identityName,
      connectionIdentityImageURL: null,
      overwrite: true,
      userData: {
        apiDomain,
        accountsServer,
        location,
        primaryOrganizationId: primaryOrganization?.organization_id || null,
        primaryOrganizationName: primaryOrganization?.name || null,
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
    // Try every known accountsServer. The FlowRunner OAuth runtime usually injects the
    // connection's `userData.accountsServer` as the `oauth-user-data-accountsserver` header on
    // refresh calls, so #getAccountsServer() will pick the correct DC. If the framework does
    // not inject the header (older runtimes), we fall back to the configured Data Center, then
    // probe the remaining DCs sequentially. Refresh tokens are DC-bound: only the originating
    // DC will accept them, so probing is safe (other DCs return 400).
    const primary = this.#getAccountsServer()
    const order = [primary, this.defaultAccountsServer, ...Object.values(DATA_CENTERS).map(dc => dc.accountsServer)]
    const tried = new Set()

    let lastError

    for (const accountsServer of order) {
      if (tried.has(accountsServer)) {
        continue
      }

      tried.add(accountsServer)

      const params = new URLSearchParams()

      params.append('grant_type', 'refresh_token')
      params.append('client_id', this.clientId)
      params.append('client_secret', this.clientSecret)
      params.append('refresh_token', refreshToken)

      try {
        const response = await Flowrunner.Request.post(`${ accountsServer }/oauth/v2/token`)
          .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
          .send(params.toString())

        if (!response?.access_token) {
          lastError = new Error(`refreshToken: no access_token from ${ accountsServer } (${ response?.error || 'unknown' })`)

          continue
        }

        return {
          token: response.access_token,
          expirationInSeconds: response.expires_in,
          // Zoho refresh tokens are not rotated by default; preserve the original.
          refreshToken: response.refresh_token || refreshToken,
        }
      } catch (error) {
        lastError = error

        logger.warn(`refreshToken at ${ accountsServer } failed: ${ error.message }`)
      }
    }

    logger.error(`refreshToken: exhausted all DCs, last error: ${ lastError?.message }`)

    throw lastError || new Error('[Zoho Books] refreshToken failed across all data centers')
  }

  // ============================================================================================
  // DICTIONARY TYPEDEFS
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

  // ---------------------------- Organizations Dictionary ----------------------------

  /**
   * @typedef {Object} listOrganizations__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter organizations by name, currency, or organization ID. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (organizations API returns the full list, so cursor is unused)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Organizations
   * @description Returns the Zoho Books organizations the connected account can access. Each Zoho Books API call requires an organization_id, so this dictionary powers the Organization picker on every action.
   *
   * @route POST /list-organizations-dictionary
   *
   * @paramDef {"type":"listOrganizations__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering organizations."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"Acme Inc","note":"USD","value":"650427230"}]}
   * @returns {DictionaryResponse}
   */
  async listOrganizations(payload) {
    const { search } = payload || {}

    const apiDomain = this.#getApiDomain()

    const response = await Flowrunner.Request
      .get(`${ apiDomain }/books/v3/organizations`)
      .set(this.#getAccessTokenHeader())

    let organizations = response?.organizations || []

    if (search) {
      organizations = searchFilter(organizations, ['name', 'organization_id', 'currency_code'], search)
    }

    return {
      cursor: null,
      items: organizations.map(org => ({
        label: org.name || `Organization ${ org.organization_id }`,
        note: org.currency_code || '',
        value: org.organization_id,
      })),
    }
  }

  // ---------------------------- Contacts Dictionary ----------------------------

  /**
   * @typedef {Object} listContacts__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization whose contacts will be listed."}
   * @paramDef {"type":"String","label":"Contact Type","name":"contactType","uiComponent":{"type":"DROPDOWN","options":{"values":["Customer","Vendor"]}},"description":"Optional filter to restrict to customers or vendors."}
   */

  /**
   * @typedef {Object} listContacts__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter contacts by name. Sent to Zoho via the contact_name_contains filter."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor representing the next page number for retrieving more contacts."}
   * @paramDef {"type":"listContacts__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters identifying the Zoho Books organization and an optional contact-type filter."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Contacts (Dictionary)
   * @description Returns Zoho Books contacts (customers and vendors) for use as parameter dropdowns. Supports server-side search by contact name and optional filtering by contact type.
   *
   * @route POST /list-contacts-dictionary
   *
   * @paramDef {"type":"listContacts__payload","label":"Payload","name":"payload","description":"Contains organization ID, optional search string, optional contact-type filter, and pagination cursor."}
   *
   * @sampleResult {"cursor":"2","items":[{"label":"Acme Corp","note":"ID: 460000000026049","value":"460000000026049"}]}
   * @returns {DictionaryResponse}
   */
  async listContacts(payload) {
    const { search, cursor, criteria } = payload || {}
    const organizationId = criteria?.organizationId
    const contactType = criteria?.contactType

    const page = cursor ? parseInt(cursor, 10) : 1

    const response = await this.#apiRequest({
      logTag: 'listContacts',
      url: `${ this.#getApiDomain() }/books/v3/contacts`,
      organizationId,
      query: {
        page,
        per_page: DICTIONARY_PAGE_SIZE,
        contact_name_contains: search || undefined,
        contact_type: this.#resolveChoice(contactType, CONTACT_TYPE_MAP),
      },
    })

    const contacts = response?.contacts || []
    const hasMore = response?.page_context?.has_more_page === true

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: contacts.map(contact => ({
        label: contact.contact_name || contact.company_name || '[Unnamed Contact]',
        note: `ID: ${ contact.contact_id }`,
        value: contact.contact_id,
      })),
    }
  }

  // ---------------------------- Items Dictionary ----------------------------

  /**
   * @typedef {Object} listItems__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization whose items will be listed."}
   */

  /**
   * @typedef {Object} listItems__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter items by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor representing the next page number for retrieving more items."}
   * @paramDef {"type":"listItems__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters identifying the Zoho Books organization."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Items (Dictionary)
   * @description Returns Zoho Books items (products and services) used in invoice, estimate, and bill line items. The note field shows the default rate so the right SKU is easy to pick.
   *
   * @route POST /list-items-dictionary
   *
   * @paramDef {"type":"listItems__payload","label":"Payload","name":"payload","description":"Contains organization ID, optional search string, and pagination cursor for retrieving items."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"Consulting","note":"Rate: 150","value":"460000000027111"}]}
   * @returns {DictionaryResponse}
   */
  async listItems(payload) {
    const { search, cursor, criteria } = payload || {}
    const organizationId = criteria?.organizationId

    const page = cursor ? parseInt(cursor, 10) : 1

    const response = await this.#apiRequest({
      logTag: 'listItems',
      url: `${ this.#getApiDomain() }/books/v3/items`,
      organizationId,
      query: {
        page,
        per_page: DICTIONARY_PAGE_SIZE,
        name_contains: search || undefined,
      },
    })

    const items = response?.items || []
    const hasMore = response?.page_context?.has_more_page === true

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: items.map(item => ({
        label: item.name || '[Unnamed Item]',
        note: item.rate !== undefined ? `Rate: ${ item.rate }` : `ID: ${ item.item_id }`,
        value: item.item_id,
      })),
    }
  }

  // ---------------------------- Accounts Dictionary ----------------------------

  /**
   * @typedef {Object} listAccounts__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization whose chart of accounts will be listed."}
   */

  /**
   * @typedef {Object} listAccounts__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter accounts by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor representing the next page number for retrieving more accounts."}
   * @paramDef {"type":"listAccounts__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters identifying the Zoho Books organization."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Accounts
   * @description Returns the chart of accounts for the selected organization. Used to pick GL accounts for expenses, items, and journal entries.
   *
   * @route POST /list-accounts-dictionary
   *
   * @paramDef {"type":"listAccounts__payload","label":"Payload","name":"payload","description":"Contains organization ID, optional search string, and pagination cursor for retrieving chart-of-accounts entries."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"Office Supplies","note":"expense","value":"460000000027001"}]}
   * @returns {DictionaryResponse}
   */
  async listAccounts(payload) {
    const { search, cursor, criteria } = payload || {}
    const organizationId = criteria?.organizationId

    const page = cursor ? parseInt(cursor, 10) : 1

    const response = await this.#apiRequest({
      logTag: 'listAccounts',
      url: `${ this.#getApiDomain() }/books/v3/chartofaccounts`,
      organizationId,
      query: {
        page,
        per_page: DICTIONARY_PAGE_SIZE,
        search_text: search || undefined,
      },
    })

    const accounts = response?.chartofaccounts || []
    const hasMore = response?.page_context?.has_more_page === true

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: accounts.map(account => ({
        label: account.account_name || `[Account ${ account.account_id }]`,
        note: account.account_type || '',
        value: account.account_id,
      })),
    }
  }

  // ---------------------------- Currencies Dictionary ----------------------------

  /**
   * @typedef {Object} listCurrencies__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization whose currencies will be listed."}
   */

  /**
   * @typedef {Object} listCurrencies__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter currencies by code or name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused; the currencies endpoint returns the full list)."}
   * @paramDef {"type":"listCurrencies__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters identifying the Zoho Books organization."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Currencies
   * @description Returns the currencies enabled for the selected organization, useful for multi-currency invoice and bill creation.
   *
   * @route POST /list-currencies-dictionary
   *
   * @paramDef {"type":"listCurrencies__payload","label":"Payload","name":"payload","description":"Contains organization ID and an optional search string for filtering currencies."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"USD - U.S. Dollar","note":"Symbol: $","value":"460000000000097"}]}
   * @returns {DictionaryResponse}
   */
  async listCurrencies(payload) {
    const { search, criteria } = payload || {}
    const organizationId = criteria?.organizationId

    const response = await this.#apiRequest({
      logTag: 'listCurrencies',
      url: `${ this.#getApiDomain() }/books/v3/settings/currencies`,
      organizationId,
    })

    let currencies = response?.currencies || []

    if (search) {
      currencies = searchFilter(currencies, ['currency_code', 'currency_name'], search)
    }

    return {
      cursor: null,
      items: currencies.map(currency => ({
        label: `${ currency.currency_code } - ${ currency.currency_name || '' }`.trim(),
        note: currency.currency_symbol ? `Symbol: ${ currency.currency_symbol }` : '',
        value: currency.currency_id,
      })),
    }
  }

  // ---------------------------- Taxes Dictionary ----------------------------

  /**
   * @typedef {Object} listTaxes__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization whose tax rates will be listed."}
   */

  /**
   * @typedef {Object} listTaxes__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter taxes by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused; the taxes endpoint returns the full list)."}
   * @paramDef {"type":"listTaxes__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters identifying the Zoho Books organization."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Taxes
   * @description Returns the tax rates configured in the selected organization, used for line-item tax selection on invoices, bills, and expenses.
   *
   * @route POST /list-taxes-dictionary
   *
   * @paramDef {"type":"listTaxes__payload","label":"Payload","name":"payload","description":"Contains organization ID and an optional search string for filtering tax rates."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"GST 10%","note":"10%","value":"460000000037004"}]}
   * @returns {DictionaryResponse}
   */
  async listTaxes(payload) {
    const { search, criteria } = payload || {}
    const organizationId = criteria?.organizationId

    const response = await this.#apiRequest({
      logTag: 'listTaxes',
      url: `${ this.#getApiDomain() }/books/v3/settings/taxes`,
      organizationId,
    })

    let taxes = response?.taxes || []

    if (search) {
      taxes = searchFilter(taxes, ['tax_name'], search)
    }

    return {
      cursor: null,
      items: taxes.map(tax => ({
        label: tax.tax_name || `Tax ${ tax.tax_id }`,
        note: tax.tax_percentage !== undefined ? `${ tax.tax_percentage }%` : '',
        value: tax.tax_id,
      })),
    }
  }

  // ---------------------------- Invoices Dictionary ----------------------------

  /**
   * @typedef {Object} listInvoices__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization whose invoices will be listed."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Sent","Overdue","Paid","Void","Unpaid","Partially Paid","Viewed"]}},"description":"Optional filter to limit invoices to a specific status."}
   */

  /**
   * @typedef {Object} listInvoices__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter invoices by invoice number."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor representing the next page number for retrieving more invoices."}
   * @paramDef {"type":"listInvoices__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters identifying the Zoho Books organization and optional status filter."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Invoices (Dictionary)
   * @description Returns Zoho Books invoices for selecting an existing invoice to record payments against, email, void, or otherwise reference.
   *
   * @route POST /list-invoices-dictionary
   *
   * @paramDef {"type":"listInvoices__payload","label":"Payload","name":"payload","description":"Contains organization ID, status filter, optional search string, and pagination cursor."}
   *
   * @sampleResult {"cursor":"2","items":[{"label":"INV-000123 - Acme Corp","note":"Status: sent","value":"460000000034037"}]}
   * @returns {DictionaryResponse}
   */
  async listInvoices(payload) {
    const { search, cursor, criteria } = payload || {}
    const organizationId = criteria?.organizationId
    const status = criteria?.status

    const page = cursor ? parseInt(cursor, 10) : 1

    const response = await this.#apiRequest({
      logTag: 'listInvoices',
      url: `${ this.#getApiDomain() }/books/v3/invoices`,
      organizationId,
      query: {
        page,
        per_page: DICTIONARY_PAGE_SIZE,
        invoice_number_contains: search || undefined,
        status: this.#resolveChoice(status, INVOICE_STATUS_MAP),
      },
    })

    const invoices = response?.invoices || []
    const hasMore = response?.page_context?.has_more_page === true

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: invoices.map(invoice => ({
        label: `${ invoice.invoice_number || invoice.invoice_id } - ${ invoice.customer_name || '' }`.trim(),
        note: `Status: ${ invoice.status || 'unknown' }`,
        value: invoice.invoice_id,
      })),
    }
  }

  // ---------------------------- Bills Dictionary ----------------------------

  /**
   * @typedef {Object} listBills__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization whose bills will be listed."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Paid","Void","Draft","Overdue","Unpaid","Partially Paid"]}},"description":"Optional filter to limit bills to a specific status."}
   */

  /**
   * @typedef {Object} listBills__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter bills by bill number."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor representing the next page number for retrieving more bills."}
   * @paramDef {"type":"listBills__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters identifying the Zoho Books organization and optional status filter."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Bills (Dictionary)
   * @description Returns Zoho Books vendor bills for selecting an existing bill to record vendor payments, void, or update.
   *
   * @route POST /list-bills-dictionary
   *
   * @paramDef {"type":"listBills__payload","label":"Payload","name":"payload","description":"Contains organization ID, status filter, optional search string, and pagination cursor."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"BILL-007 - Office Depot","note":"Status: open","value":"460000000038099"}]}
   * @returns {DictionaryResponse}
   */
  async listBills(payload) {
    const { search, cursor, criteria } = payload || {}
    const organizationId = criteria?.organizationId
    const status = criteria?.status

    const page = cursor ? parseInt(cursor, 10) : 1

    const response = await this.#apiRequest({
      logTag: 'listBills',
      url: `${ this.#getApiDomain() }/books/v3/bills`,
      organizationId,
      query: {
        page,
        per_page: DICTIONARY_PAGE_SIZE,
        bill_number_contains: search || undefined,
        status: this.#resolveChoice(status, BILL_STATUS_MAP),
      },
    })

    const bills = response?.bills || []
    const hasMore = response?.page_context?.has_more_page === true

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: bills.map(bill => ({
        label: `${ bill.bill_number || bill.bill_id } - ${ bill.vendor_name || '' }`.trim(),
        note: `Status: ${ bill.status || 'unknown' }`,
        value: bill.bill_id,
      })),
    }
  }

  // ---------------------------- Estimates Dictionary ----------------------------

  /**
   * @typedef {Object} listEstimates__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization whose estimates will be listed."}
   */

  /**
   * @typedef {Object} listEstimates__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter estimates by estimate number."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor representing the next page number for retrieving more estimates."}
   * @paramDef {"type":"listEstimates__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters identifying the Zoho Books organization."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Estimates (Dictionary)
   * @description Returns Zoho Books estimates for selecting an existing estimate to retrieve, update, accept, decline, or convert to an invoice.
   *
   * @route POST /list-estimates-dictionary
   *
   * @paramDef {"type":"listEstimates__payload","label":"Payload","name":"payload","description":"Contains organization ID, optional search string, and pagination cursor."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"EST-00009 - Acme Corp","note":"Status: sent","value":"460000000045021"}]}
   * @returns {DictionaryResponse}
   */
  async listEstimates(payload) {
    const { search, cursor, criteria } = payload || {}
    const organizationId = criteria?.organizationId

    const page = cursor ? parseInt(cursor, 10) : 1

    const response = await this.#apiRequest({
      logTag: 'listEstimates',
      url: `${ this.#getApiDomain() }/books/v3/estimates`,
      organizationId,
      query: {
        page,
        per_page: DICTIONARY_PAGE_SIZE,
        estimate_number_contains: search || undefined,
      },
    })

    const estimates = response?.estimates || []
    const hasMore = response?.page_context?.has_more_page === true

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: estimates.map(estimate => ({
        label: `${ estimate.estimate_number || estimate.estimate_id } - ${ estimate.customer_name || '' }`.trim(),
        note: `Status: ${ estimate.status || 'unknown' }`,
        value: estimate.estimate_id,
      })),
    }
  }

  // ---------------------------- Customer Payments Dictionary ----------------------------

  /**
   * @typedef {Object} listCustomerPayments__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization whose customer payments will be listed."}
   */

  /**
   * @typedef {Object} listCustomerPayments__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter payments by payment number, customer name, or reference."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor representing the next page number for retrieving more payments."}
   * @paramDef {"type":"listCustomerPayments__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters identifying the Zoho Books organization."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Customer Payments (Dictionary)
   * @description Returns recorded customer payments for selecting an existing payment to retrieve or delete.
   *
   * @route POST /list-customer-payments-dictionary
   *
   * @paramDef {"type":"listCustomerPayments__payload","label":"Payload","name":"payload","description":"Contains organization ID, optional search string, and pagination cursor."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"2 - Acme Corp","note":"Amount: 1250","value":"460000000048011"}]}
   * @returns {DictionaryResponse}
   */
  async listCustomerPayments(payload) {
    const { search, cursor, criteria } = payload || {}
    const organizationId = criteria?.organizationId

    const page = cursor ? parseInt(cursor, 10) : 1

    const response = await this.#apiRequest({
      logTag: 'listCustomerPayments',
      url: `${ this.#getApiDomain() }/books/v3/customerpayments`,
      organizationId,
      query: {
        page,
        per_page: DICTIONARY_PAGE_SIZE,
      },
    })

    let payments = response?.customerpayments || []
    const hasMore = response?.page_context?.has_more_page === true

    if (search) {
      payments = searchFilter(payments, ['payment_number', 'customer_name', 'reference_number'], search)
    }

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: payments.map(payment => ({
        label: `${ payment.payment_number || payment.payment_id } - ${ payment.customer_name || '' }`.trim(),
        note: payment.amount !== undefined ? `Amount: ${ payment.amount }` : (payment.date || ''),
        value: payment.payment_id,
      })),
    }
  }

  // ---------------------------- Expenses Dictionary ----------------------------

  /**
   * @typedef {Object} listExpensesDict__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization whose expenses will be listed."}
   */

  /**
   * @typedef {Object} listExpensesDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter expenses by account name, description, vendor, or reference."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor representing the next page number for retrieving more expenses."}
   * @paramDef {"type":"listExpensesDict__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters identifying the Zoho Books organization."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Expenses (Dictionary)
   * @description Returns recorded expenses for selecting an existing expense to retrieve, update, or delete.
   *
   * @route POST /list-expenses-dictionary
   *
   * @paramDef {"type":"listExpensesDict__payload","label":"Payload","name":"payload","description":"Contains organization ID, optional search string, and pagination cursor."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"Office Supplies - 2025-04-28","note":"Amount: 75","value":"460000000050099"}]}
   * @returns {DictionaryResponse}
   */
  async listExpensesDict(payload) {
    const { search, cursor, criteria } = payload || {}
    const organizationId = criteria?.organizationId

    const page = cursor ? parseInt(cursor, 10) : 1

    const response = await this.#apiRequest({
      logTag: 'listExpensesDict',
      url: `${ this.#getApiDomain() }/books/v3/expenses`,
      organizationId,
      query: {
        page,
        per_page: DICTIONARY_PAGE_SIZE,
      },
    })

    let expenses = response?.expenses || []
    const hasMore = response?.page_context?.has_more_page === true

    if (search) {
      expenses = searchFilter(expenses, ['account_name', 'description', 'vendor_name', 'reference_number'], search)
    }

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: expenses.map(expense => {
        const amount = expense.total !== undefined ? expense.total : expense.amount

        return {
          label: `${ expense.account_name || expense.description || `Expense ${ expense.expense_id }` }${ expense.date ? ` - ${ expense.date }` : '' }`.trim(),
          note: amount !== undefined ? `Amount: ${ amount }` : '',
          value: expense.expense_id,
        }
      }),
    }
  }

  // ---------------------------- Sales Orders Dictionary ----------------------------

  /**
   * @typedef {Object} listSalesOrders__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization whose sales orders will be listed."}
   */

  /**
   * @typedef {Object} listSalesOrders__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter sales orders by sales order number."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor representing the next page number for retrieving more sales orders."}
   * @paramDef {"type":"listSalesOrders__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters identifying the Zoho Books organization."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Sales Orders (Dictionary)
   * @description Returns Zoho Books sales orders for selecting an existing sales order to retrieve, update, delete, or transition.
   *
   * @route POST /list-sales-orders-dictionary
   *
   * @paramDef {"type":"listSalesOrders__payload","label":"Payload","name":"payload","description":"Contains organization ID, optional search string, and pagination cursor."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"SO-00007 - Acme Corp","note":"Status: open","value":"460000000060011"}]}
   * @returns {DictionaryResponse}
   */
  async listSalesOrders(payload) {
    const { search, cursor, criteria } = payload || {}
    const organizationId = criteria?.organizationId

    const page = cursor ? parseInt(cursor, 10) : 1

    const response = await this.#apiRequest({
      logTag: 'listSalesOrders',
      url: `${ this.#getApiDomain() }/books/v3/salesorders`,
      organizationId,
      query: {
        page,
        per_page: DICTIONARY_PAGE_SIZE,
        salesorder_number_contains: search || undefined,
      },
    })

    const salesorders = response?.salesorders || []
    const hasMore = response?.page_context?.has_more_page === true

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: salesorders.map(so => ({
        label: `${ so.salesorder_number || so.salesorder_id } - ${ so.customer_name || '' }`.trim(),
        note: `Status: ${ so.status || 'unknown' }`,
        value: so.salesorder_id,
      })),
    }
  }

  // ---------------------------- Purchase Orders Dictionary ----------------------------

  /**
   * @typedef {Object} listPurchaseOrders__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization whose purchase orders will be listed."}
   */

  /**
   * @typedef {Object} listPurchaseOrders__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter purchase orders by purchase order number."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor representing the next page number for retrieving more purchase orders."}
   * @paramDef {"type":"listPurchaseOrders__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters identifying the Zoho Books organization."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Purchase Orders (Dictionary)
   * @description Returns Zoho Books purchase orders for selecting an existing purchase order to retrieve, update, delete, or transition.
   *
   * @route POST /list-purchase-orders-dictionary
   *
   * @paramDef {"type":"listPurchaseOrders__payload","label":"Payload","name":"payload","description":"Contains organization ID, optional search string, and pagination cursor."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"PO-00007 - Office Depot","note":"Status: issued","value":"460000000061099"}]}
   * @returns {DictionaryResponse}
   */
  async listPurchaseOrders(payload) {
    const { search, cursor, criteria } = payload || {}
    const organizationId = criteria?.organizationId

    const page = cursor ? parseInt(cursor, 10) : 1

    const response = await this.#apiRequest({
      logTag: 'listPurchaseOrders',
      url: `${ this.#getApiDomain() }/books/v3/purchaseorders`,
      organizationId,
      query: {
        page,
        per_page: DICTIONARY_PAGE_SIZE,
        purchaseorder_number_contains: search || undefined,
      },
    })

    const purchaseorders = response?.purchaseorders || []
    const hasMore = response?.page_context?.has_more_page === true

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: purchaseorders.map(po => ({
        label: `${ po.purchaseorder_number || po.purchaseorder_id } - ${ po.vendor_name || '' }`.trim(),
        note: `Status: ${ po.status || 'unknown' }`,
        value: po.purchaseorder_id,
      })),
    }
  }

  // ---------------------------- Credit Notes Dictionary ----------------------------

  /**
   * @typedef {Object} listCreditNotes__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization whose credit notes will be listed."}
   */

  /**
   * @typedef {Object} listCreditNotes__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter credit notes by credit note number."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor representing the next page number for retrieving more credit notes."}
   * @paramDef {"type":"listCreditNotes__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters identifying the Zoho Books organization."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Credit Notes (Dictionary)
   * @description Returns Zoho Books credit notes for selecting an existing credit note to retrieve, update, delete, or apply to invoices.
   *
   * @route POST /list-credit-notes-dictionary
   *
   * @paramDef {"type":"listCreditNotes__payload","label":"Payload","name":"payload","description":"Contains organization ID, optional search string, and pagination cursor."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"CN-00005 - Acme Corp","note":"Status: open","value":"460000000070033"}]}
   * @returns {DictionaryResponse}
   */
  async listCreditNotes(payload) {
    const { search, cursor, criteria } = payload || {}
    const organizationId = criteria?.organizationId

    const page = cursor ? parseInt(cursor, 10) : 1

    const response = await this.#apiRequest({
      logTag: 'listCreditNotes',
      url: `${ this.#getApiDomain() }/books/v3/creditnotes`,
      organizationId,
      query: {
        page,
        per_page: DICTIONARY_PAGE_SIZE,
        creditnote_number_contains: search || undefined,
      },
    })

    const creditnotes = response?.creditnotes || []
    const hasMore = response?.page_context?.has_more_page === true

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: creditnotes.map(cn => ({
        label: `${ cn.creditnote_number || cn.creditnote_id } - ${ cn.customer_name || '' }`.trim(),
        note: `Status: ${ cn.status || 'unknown' }`,
        value: cn.creditnote_id,
      })),
    }
  }

  // ---------------------------- Recurring Invoices Dictionary ----------------------------

  /**
   * @typedef {Object} listRecurringInvoices__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization whose recurring invoices will be listed."}
   */

  /**
   * @typedef {Object} listRecurringInvoices__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter recurring invoices by recurrence name or customer name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor representing the next page number for retrieving more recurring invoices."}
   * @paramDef {"type":"listRecurringInvoices__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters identifying the Zoho Books organization."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Recurring Invoices (Dictionary)
   * @description Returns Zoho Books recurring invoice profiles for selecting an existing schedule to retrieve, update, delete, activate, or stop.
   *
   * @route POST /list-recurring-invoices-dictionary
   *
   * @paramDef {"type":"listRecurringInvoices__payload","label":"Payload","name":"payload","description":"Contains organization ID, optional search string, and pagination cursor."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"Monthly Retainer - Acme Corp","note":"Status: active","value":"460000000080021"}]}
   * @returns {DictionaryResponse}
   */
  async listRecurringInvoices(payload) {
    const { search, cursor, criteria } = payload || {}
    const organizationId = criteria?.organizationId

    const page = cursor ? parseInt(cursor, 10) : 1

    const response = await this.#apiRequest({
      logTag: 'listRecurringInvoices',
      url: `${ this.#getApiDomain() }/books/v3/recurringinvoices`,
      organizationId,
      query: {
        page,
        per_page: DICTIONARY_PAGE_SIZE,
      },
    })

    let recurring = response?.recurring_invoices || []
    const hasMore = response?.page_context?.has_more_page === true

    if (search) {
      recurring = searchFilter(recurring, ['recurrence_name', 'customer_name'], search)
    }

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: recurring.map(ri => ({
        label: `${ ri.recurrence_name || ri.recurring_invoice_id } - ${ ri.customer_name || '' }`.trim(),
        note: `Status: ${ ri.status || 'unknown' }`,
        value: ri.recurring_invoice_id,
      })),
    }
  }

  // ============================================================================================
  // CONTACTS - ACTIONS
  // ============================================================================================

  /**
   * @typedef {Object} ZohoAddress
   * @property {String} [attention] - Recipient name for the address
   * @property {String} [address] - Street address line
   * @property {String} [street2] - Optional second address line
   * @property {String} [city] - City
   * @property {String} [state] - State / Province
   * @property {String} [zip] - Postal / Zip code
   * @property {String} [country] - Country
   * @property {String} [phone] - Phone number
   */

  /**
   * @operationName Create Contact
   * @category Contacts
   * @description Creates a new customer or vendor contact in Zoho Books. Supports primary contact details, billing address, shipping address, and tax-relevant fields.
   *
   * @route POST /create-contact
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization in which to create the contact."}
   * @paramDef {"type":"String","label":"Contact Name","name":"contactName","required":true,"description":"Display name of the contact (person or business)."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"Optional company name when the contact represents a business."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Primary email address used for invoicing and communication."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Primary phone number for the contact."}
   * @paramDef {"type":"String","label":"Contact Type","name":"contactType","uiComponent":{"type":"DROPDOWN","options":{"values":["Customer","Vendor"]}},"description":"Whether this contact is a customer or a vendor. Defaults to customer when omitted."}
   * @paramDef {"type":"ZohoAddress","label":"Billing Address","name":"billingAddress","description":"Optional billing address object with attention, address, city, state, zip, country, and phone."}
   * @paramDef {"type":"ZohoAddress","label":"Shipping Address","name":"shippingAddress","description":"Optional shipping address object using the same shape as billing address."}
   *
   * @returns {Object}
   * @sampleResult {"contact_id":"460000000026049","contact_name":"Acme Corp","company_name":"Acme Corp","contact_type":"customer","email":"billing@acme.com","status":"active"}
   */
  async createContact(organizationId, contactName, companyName, email, phone, contactType, billingAddress, shippingAddress) {
    if (!contactName) {
      throw new Error('"Contact Name" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const body = cleanupObject({
      contact_name: contactName,
      company_name: companyName,
      contact_type: this.#resolveChoice(contactType, CONTACT_TYPE_MAP) || 'customer',
      contact_persons: email || phone ? [cleanupObject({ email, phone, is_primary_contact: true })] : undefined,
      billing_address: cleanupObject(billingAddress),
      shipping_address: cleanupObject(shippingAddress),
    })

    const response = await this.#apiRequest({
      logTag: 'createContact',
      method: 'post',
      url: `${ this.#getApiDomain() }/books/v3/contacts`,
      organizationId: orgId,
      body,
    })

    return response?.contact
  }

  /**
   * @operationName Get Contact
   * @category Contacts
   * @description Retrieves the full details of a single contact in Zoho Books, including contact persons, addresses, and balance information.
   *
   * @route POST /get-contact
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the contact."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"listContacts","dependsOn":["organizationId"],"description":"The contact to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"contact_id":"460000000026049","contact_name":"Acme Corp","contact_type":"customer","outstanding_receivable_amount":1250,"status":"active"}
   */
  async getContact(organizationId, contactId) {
    if (!contactId) {
      throw new Error('"Contact" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'getContact',
      url: `${ this.#getApiDomain() }/books/v3/contacts/${ contactId }`,
      organizationId: orgId,
    })

    return response?.contact
  }

  /**
   * @operationName Update Contact
   * @category Contacts
   * @description Updates an existing Zoho Books contact. Provide a fields object containing any subset of contact properties to merge into the existing record (for example contact_name, company_name, billing_address, etc.).
   *
   * @route POST /update-contact
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the contact."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"listContacts","dependsOn":["organizationId"],"description":"The contact to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"freeform":true,"description":"Object of contact fields to update. Example: {\"contact_name\":\"New Name\",\"company_name\":\"New Co\",\"billing_address\":{\"city\":\"Austin\"}}."}
   *
   * @returns {Object}
   * @sampleResult {"contact_id":"460000000026049","contact_name":"Acme Corp Updated","status":"active"}
   */
  async updateContact(organizationId, contactId, fields) {
    if (!contactId) {
      throw new Error('"Contact" is required')
    }

    if (!fields || typeof fields !== 'object') {
      throw new Error('"Fields" must be a non-empty object of contact fields to update')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'updateContact',
      method: 'put',
      url: `${ this.#getApiDomain() }/books/v3/contacts/${ contactId }`,
      organizationId: orgId,
      body: cleanupObject(fields),
    })

    return response?.contact
  }

  /**
   * @operationName Delete Contact
   * @category Contacts
   * @description Deletes a contact from Zoho Books. Contacts that have transactions associated with them cannot be deleted; consider archiving instead.
   *
   * @route POST /delete-contact
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the contact."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"listContacts","dependsOn":["organizationId"],"description":"The contact to delete."}
   *
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The contact has been deleted."}
   */
  async deleteContact(organizationId, contactId) {
    if (!contactId) {
      throw new Error('"Contact" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'deleteContact',
      method: 'delete',
      url: `${ this.#getApiDomain() }/books/v3/contacts/${ contactId }`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName List Contacts
   * @category Contacts
   * @description Retrieves a paginated list of contacts from Zoho Books with optional search and contact-type filters. Returns the full contact records for downstream processing.
   *
   * @route POST /list-contacts
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization whose contacts will be listed."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (1-based). Default: 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of contacts to return per page. Maximum is 200; default is 50."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter by contact name (matches the contact_name_contains filter)."}
   * @paramDef {"type":"String","label":"Contact Type","name":"contactType","uiComponent":{"type":"DROPDOWN","options":{"values":["Customer","Vendor"]}},"description":"Optional filter restricting to customers or vendors."}
   * @paramDef {"type":"String","label":"Modified Since","name":"lastModifiedTimeStart","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional ISO timestamp; only contacts modified at or after this time are returned. Useful for incremental sync."}
   *
   * @returns {Object}
   * @sampleResult {"contacts":[{"contact_id":"460000000026049","contact_name":"Acme Corp","contact_type":"customer","status":"active"}],"page_context":{"page":1,"per_page":50,"has_more_page":false}}
   */
  async listContactsAction(organizationId, page, perPage, search, contactType, lastModifiedTimeStart) {
    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'listContactsAction',
      url: `${ this.#getApiDomain() }/books/v3/contacts`,
      organizationId: orgId,
      query: {
        page: page || 1,
        per_page: perPage || DEFAULT_PAGE_SIZE,
        contact_name_contains: search || undefined,
        contact_type: this.#resolveChoice(contactType, CONTACT_TYPE_MAP),
        last_modified_time: lastModifiedTimeStart || undefined,
      },
    })
  }

  // ============================================================================================
  // INVOICES - ACTIONS
  // ============================================================================================

  /**
   * @typedef {Object} ZohoLineItem
   * @property {String} [item_id] - Zoho Books item ID for catalog products/services
   * @property {String} [name] - Override line item name when item_id is omitted
   * @property {String} [description] - Optional line description
   * @property {Number} [rate] - Unit rate
   * @property {Number} [quantity] - Quantity
   * @property {String} [tax_id] - Optional tax ID applied to this line
   * @property {String} [unit] - Unit of measure (e.g. hr, pcs)
   * @property {Number} [discount] - Optional line-level discount
   */

  /**
   * @operationName Create Invoice
   * @category Invoices
   * @description Creates a new invoice in Zoho Books for a customer. Line items can reference Zoho Books items by item_id or specify name and rate inline. Supports invoice date, due date, notes, and terms.
   *
   * @route POST /create-invoice
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization in which to create the invoice."}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"listContacts","dependsOn":["organizationId"],"description":"The customer (contact) being invoiced."}
   * @paramDef {"type":"Array<ZohoLineItem>","label":"Line Items","name":"lineItems","required":true,"description":"Array of invoice line items. Each line should provide either item_id (preferred) or name plus rate and quantity."}
   * @paramDef {"type":"String","label":"Invoice Number","name":"invoiceNumber","description":"Optional invoice number. When omitted, Zoho auto-generates from the configured number sequence."}
   * @paramDef {"type":"String","label":"Invoice Date","name":"invoiceDate","uiComponent":{"type":"DATE_PICKER"},"description":"Invoice date in YYYY-MM-DD format. Defaults to today when omitted."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Optional due date in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"Currency","name":"currencyId","dictionary":"listCurrencies","dependsOn":["organizationId"],"description":"Optional currency for the invoice. Defaults to the customer's currency."}
   * @paramDef {"type":"String","label":"Reference Number","name":"referenceNumber","description":"Optional customer reference / PO number."}
   * @paramDef {"type":"Number","label":"Payment Terms (Days)","name":"paymentTerms","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional net payment terms in days (e.g. 15, 30)."}
   * @paramDef {"type":"Number","label":"Discount","name":"discount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional invoice-level discount. Pass a number for a flat amount or a string like '5%' for percent."}
   * @paramDef {"type":"Boolean","label":"Tax Inclusive Lines","name":"isInclusiveTax","uiComponent":{"type":"CHECKBOX"},"description":"When true, line item rates are treated as tax-inclusive."}
   * @paramDef {"type":"String","label":"Salesperson","name":"salespersonName","description":"Optional salesperson name for reporting."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional notes shown on the invoice."}
   * @paramDef {"type":"String","label":"Terms","name":"terms","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional terms and conditions shown on the invoice."}
   * @paramDef {"type":"Object","label":"Extra Fields","name":"extraFields","freeform":true,"description":"Optional object merged into the invoice body for any additional Zoho fields not exposed above (e.g. {\"custom_fields\":[...],\"shipping_charge\":12}). Top-level keys override the named parameters."}
   *
   * @returns {Object}
   * @sampleResult {"invoice_id":"460000000034037","invoice_number":"INV-000123","customer_id":"460000000026049","status":"draft","total":1250,"balance":1250}
   */
  async createInvoice(organizationId, customerId, lineItems, invoiceNumber, invoiceDate, dueDate, currencyId, referenceNumber, paymentTerms, discount, isInclusiveTax, salespersonName, notes, terms, extraFields) {
    if (!customerId) {
      throw new Error('"Customer" is required')
    }

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      throw new Error('"Line Items" must be a non-empty array')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const body = cleanupObject({
      customer_id: customerId,
      line_items: lineItems.map(line => cleanupObject(line)),
      invoice_number: invoiceNumber,
      date: invoiceDate,
      due_date: dueDate,
      currency_id: currencyId,
      reference_number: referenceNumber,
      payment_terms: paymentTerms !== undefined && paymentTerms !== null ? Number(paymentTerms) : undefined,
      discount,
      is_inclusive_tax: isInclusiveTax,
      salesperson_name: salespersonName,
      notes,
      terms,
      ...(extraFields && typeof extraFields === 'object' ? extraFields : {}),
    })

    const response = await this.#apiRequest({
      logTag: 'createInvoice',
      method: 'post',
      url: `${ this.#getApiDomain() }/books/v3/invoices`,
      organizationId: orgId,
      body,
    })

    return response?.invoice
  }

  /**
   * @operationName Get Invoice
   * @category Invoices
   * @description Retrieves the complete details of a single invoice including line items, totals, customer information, and current status.
   *
   * @route POST /get-invoice
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the invoice."}
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"listInvoices","dependsOn":["organizationId"],"description":"The invoice to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"invoice_id":"460000000034037","invoice_number":"INV-000123","customer_name":"Acme Corp","status":"sent","total":1250,"balance":1250,"line_items":[{"line_item_id":"7","name":"Consulting","rate":1250,"quantity":1}]}
   */
  async getInvoice(organizationId, invoiceId) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'getInvoice',
      url: `${ this.#getApiDomain() }/books/v3/invoices/${ invoiceId }`,
      organizationId: orgId,
    })

    return response?.invoice
  }

  /**
   * @operationName Update Invoice
   * @category Invoices
   * @description Updates an existing invoice in Zoho Books. Pass any subset of invoice fields (line_items, due_date, notes, etc.); the provided fields are merged into the existing invoice.
   *
   * @route POST /update-invoice
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the invoice."}
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"listInvoices","dependsOn":["organizationId"],"description":"The invoice to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"freeform":true,"description":"Object containing invoice fields to update. Example: {\"due_date\":\"2025-12-31\",\"notes\":\"Updated terms\"}."}
   *
   * @returns {Object}
   * @sampleResult {"invoice_id":"460000000034037","invoice_number":"INV-000123","status":"sent","total":1250}
   */
  async updateInvoice(organizationId, invoiceId, fields) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required')
    }

    if (!fields || typeof fields !== 'object') {
      throw new Error('"Fields" must be a non-empty object of invoice fields to update')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'updateInvoice',
      method: 'put',
      url: `${ this.#getApiDomain() }/books/v3/invoices/${ invoiceId }`,
      organizationId: orgId,
      body: cleanupObject(fields),
    })

    return response?.invoice
  }

  /**
   * @operationName Delete Invoice
   * @category Invoices
   * @description Permanently deletes an invoice from Zoho Books. Use with caution; sent or paid invoices may not be deletable depending on organization settings.
   *
   * @route POST /delete-invoice
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the invoice."}
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"listInvoices","dependsOn":["organizationId"],"description":"The invoice to delete."}
   *
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The invoice has been deleted."}
   */
  async deleteInvoice(organizationId, invoiceId) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'deleteInvoice',
      method: 'delete',
      url: `${ this.#getApiDomain() }/books/v3/invoices/${ invoiceId }`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Mark Invoice Sent
   * @category Invoices
   * @description Transitions an invoice from draft to sent status without actually emailing it. Useful when invoices are delivered through other channels but still need to be marked as outstanding.
   *
   * @route POST /mark-invoice-sent
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the invoice."}
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"listInvoices","dependsOn":["organizationId"],"description":"The invoice to mark as sent."}
   *
   * @returns {Object}
   * @sampleResult {"code":0,"message":"Invoice status has been changed to Sent."}
   */
  async markInvoiceSent(organizationId, invoiceId) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'markInvoiceSent',
      method: 'post',
      url: `${ this.#getApiDomain() }/books/v3/invoices/${ invoiceId }/status/sent`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Void Invoice
   * @category Invoices
   * @description Voids an invoice in Zoho Books. Voided invoices remain in the system for auditing but no longer count against the customer's outstanding balance.
   *
   * @route POST /void-invoice
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the invoice."}
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"listInvoices","dependsOn":["organizationId"],"description":"The invoice to void."}
   *
   * @returns {Object}
   * @sampleResult {"code":0,"message":"Invoice status has been changed to Void."}
   */
  async voidInvoice(organizationId, invoiceId) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'voidInvoice',
      method: 'post',
      url: `${ this.#getApiDomain() }/books/v3/invoices/${ invoiceId }/status/void`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Email Invoice
   * @category Invoices
   * @description Emails an invoice to one or more recipients with optional CC, custom subject, and body. Useful for triggering ad-hoc invoice deliveries from automated workflows.
   *
   * @route POST /email-invoice
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the invoice."}
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"listInvoices","dependsOn":["organizationId"],"description":"The invoice to email."}
   * @paramDef {"type":"Array<String>","label":"To Emails","name":"toEmails","required":true,"description":"Array of recipient email addresses."}
   * @paramDef {"type":"Array<String>","label":"CC Emails","name":"ccEmails","description":"Optional array of email addresses to CC."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"Optional email subject line; Zoho's default is used when omitted."}
   * @paramDef {"type":"String","label":"Body","name":"body","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional email body text; Zoho's default is used when omitted."}
   *
   * @returns {Object}
   * @sampleResult {"code":0,"message":"Your invoice has been sent."}
   */
  async emailInvoice(organizationId, invoiceId, toEmails, ccEmails, subject, body) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required')
    }

    if (!Array.isArray(toEmails) || toEmails.length === 0) {
      throw new Error('"To Emails" must be a non-empty array of email addresses')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const payload = cleanupObject({
      to_mail_ids: toEmails,
      cc_mail_ids: Array.isArray(ccEmails) && ccEmails.length > 0 ? ccEmails : undefined,
      subject,
      body,
    })

    return this.#apiRequest({
      logTag: 'emailInvoice',
      method: 'post',
      url: `${ this.#getApiDomain() }/books/v3/invoices/${ invoiceId }/email`,
      organizationId: orgId,
      body: payload,
    })
  }

  /**
   * @operationName List Invoices
   * @category Invoices
   * @description Retrieves a paginated list of invoices with optional status and customer filters. Returns the full invoice records including totals and balances.
   *
   * @route POST /list-invoices
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization whose invoices will be listed."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Sent","Overdue","Paid","Void","Unpaid","Partially Paid","Viewed"]}},"description":"Optional filter restricting to a specific invoice status."}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","dictionary":"listContacts","dependsOn":["organizationId"],"description":"Optional customer (contact) filter to return only that customer's invoices."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number (1-based). Default: 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of invoices per page. Maximum is 200; default is 50."}
   * @paramDef {"type":"String","label":"Modified Since","name":"lastModifiedTimeStart","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional ISO timestamp; only invoices modified at or after this time are returned. Useful for incremental sync."}
   *
   * @returns {Object}
   * @sampleResult {"invoices":[{"invoice_id":"460000000034037","invoice_number":"INV-000123","customer_name":"Acme Corp","status":"sent","total":1250,"balance":1250}],"page_context":{"page":1,"per_page":50,"has_more_page":false}}
   */
  async listInvoicesAction(organizationId, status, customerId, page, perPage, lastModifiedTimeStart) {
    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'listInvoicesAction',
      url: `${ this.#getApiDomain() }/books/v3/invoices`,
      organizationId: orgId,
      query: {
        page: page || 1,
        per_page: perPage || DEFAULT_PAGE_SIZE,
        status: this.#resolveChoice(status, INVOICE_STATUS_MAP),
        customer_id: customerId || undefined,
        last_modified_time: lastModifiedTimeStart || undefined,
      },
    })
  }

  // ============================================================================================
  // ESTIMATES - ACTIONS
  // ============================================================================================

  /**
   * @operationName Create Estimate
   * @category Estimates
   * @description Creates a new estimate (quote) for a customer with line items, dates, and optional notes and terms.
   *
   * @route POST /create-estimate
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization in which to create the estimate."}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"listContacts","dependsOn":["organizationId"],"description":"The customer the estimate is for."}
   * @paramDef {"type":"Array<ZohoLineItem>","label":"Line Items","name":"lineItems","required":true,"description":"Array of estimate line items with item_id or name plus rate and quantity."}
   * @paramDef {"type":"String","label":"Estimate Date","name":"estimateDate","uiComponent":{"type":"DATE_PICKER"},"description":"Estimate date in YYYY-MM-DD format. Defaults to today when omitted."}
   * @paramDef {"type":"String","label":"Expiry Date","name":"expiryDate","uiComponent":{"type":"DATE_PICKER"},"description":"Optional estimate expiry date in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional notes shown on the estimate."}
   * @paramDef {"type":"String","label":"Terms","name":"terms","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional terms and conditions shown on the estimate."}
   *
   * @returns {Object}
   * @sampleResult {"estimate_id":"460000000045021","estimate_number":"EST-00009","customer_id":"460000000026049","status":"draft","total":2400}
   */
  async createEstimate(organizationId, customerId, lineItems, estimateDate, expiryDate, notes, terms) {
    if (!customerId) {
      throw new Error('"Customer" is required')
    }

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      throw new Error('"Line Items" must be a non-empty array')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const body = cleanupObject({
      customer_id: customerId,
      line_items: lineItems.map(line => cleanupObject(line)),
      date: estimateDate,
      expiry_date: expiryDate,
      notes,
      terms,
    })

    const response = await this.#apiRequest({
      logTag: 'createEstimate',
      method: 'post',
      url: `${ this.#getApiDomain() }/books/v3/estimates`,
      organizationId: orgId,
      body,
    })

    return response?.estimate
  }

  /**
   * @operationName Get Estimate
   * @category Estimates
   * @description Retrieves the full details of a single estimate including line items, totals, and current status.
   *
   * @route POST /get-estimate
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the estimate."}
   * @paramDef {"type":"String","label":"Estimate","name":"estimateId","required":true,"dictionary":"listEstimates","dependsOn":["organizationId"],"description":"The Zoho Books estimate ID to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"estimate_id":"460000000045021","estimate_number":"EST-00009","status":"sent","total":2400,"line_items":[{"line_item_id":"3","name":"Consulting","rate":1200,"quantity":2}]}
   */
  async getEstimate(organizationId, estimateId) {
    if (!estimateId) {
      throw new Error('"Estimate ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'getEstimate',
      url: `${ this.#getApiDomain() }/books/v3/estimates/${ estimateId }`,
      organizationId: orgId,
    })

    return response?.estimate
  }

  /**
   * @operationName Update Estimate
   * @category Estimates
   * @description Updates an existing estimate by merging the provided fields into the existing record.
   *
   * @route POST /update-estimate
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the estimate."}
   * @paramDef {"type":"String","label":"Estimate","name":"estimateId","required":true,"dictionary":"listEstimates","dependsOn":["organizationId"],"description":"The Zoho Books estimate ID to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"freeform":true,"description":"Object containing estimate fields to update. Example: {\"expiry_date\":\"2025-12-31\",\"notes\":\"Adjusted scope\"}."}
   *
   * @returns {Object}
   * @sampleResult {"estimate_id":"460000000045021","status":"sent","total":2400}
   */
  async updateEstimate(organizationId, estimateId, fields) {
    if (!estimateId) {
      throw new Error('"Estimate ID" is required')
    }

    if (!fields || typeof fields !== 'object') {
      throw new Error('"Fields" must be a non-empty object of estimate fields to update')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'updateEstimate',
      method: 'put',
      url: `${ this.#getApiDomain() }/books/v3/estimates/${ estimateId }`,
      organizationId: orgId,
      body: cleanupObject(fields),
    })

    return response?.estimate
  }

  /**
   * @operationName Delete Estimate
   * @category Estimates
   * @description Permanently deletes an estimate from Zoho Books.
   *
   * @route POST /delete-estimate
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the estimate."}
   * @paramDef {"type":"String","label":"Estimate","name":"estimateId","required":true,"dictionary":"listEstimates","dependsOn":["organizationId"],"description":"The Zoho Books estimate ID to delete."}
   *
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The estimate has been deleted."}
   */
  async deleteEstimate(organizationId, estimateId) {
    if (!estimateId) {
      throw new Error('"Estimate ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'deleteEstimate',
      method: 'delete',
      url: `${ this.#getApiDomain() }/books/v3/estimates/${ estimateId }`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Mark Estimate Accepted
   * @category Estimates
   * @description Marks an estimate as accepted by the customer, useful for tracking conversions in sales workflows.
   *
   * @route POST /mark-estimate-accepted
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the estimate."}
   * @paramDef {"type":"String","label":"Estimate","name":"estimateId","required":true,"dictionary":"listEstimates","dependsOn":["organizationId"],"description":"The Zoho Books estimate ID to mark as accepted."}
   *
   * @returns {Object}
   * @sampleResult {"code":0,"message":"Estimate status has been changed to Accepted."}
   */
  async markEstimateAccepted(organizationId, estimateId) {
    if (!estimateId) {
      throw new Error('"Estimate ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'markEstimateAccepted',
      method: 'post',
      url: `${ this.#getApiDomain() }/books/v3/estimates/${ estimateId }/status/accepted`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Mark Estimate Declined
   * @category Estimates
   * @description Marks an estimate as declined by the customer for accurate sales pipeline reporting.
   *
   * @route POST /mark-estimate-declined
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the estimate."}
   * @paramDef {"type":"String","label":"Estimate","name":"estimateId","required":true,"dictionary":"listEstimates","dependsOn":["organizationId"],"description":"The Zoho Books estimate ID to mark as declined."}
   *
   * @returns {Object}
   * @sampleResult {"code":0,"message":"Estimate status has been changed to Declined."}
   */
  async markEstimateDeclined(organizationId, estimateId) {
    if (!estimateId) {
      throw new Error('"Estimate ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'markEstimateDeclined',
      method: 'post',
      url: `${ this.#getApiDomain() }/books/v3/estimates/${ estimateId }/status/declined`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Convert Estimate To Invoice
   * @category Estimates
   * @description Converts an accepted estimate into a new invoice in Zoho Books, copying the line items and customer details so billing can proceed.
   *
   * @route POST /convert-estimate-to-invoice
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the estimate."}
   * @paramDef {"type":"String","label":"Estimate","name":"estimateId","required":true,"dictionary":"listEstimates","dependsOn":["organizationId"],"description":"The estimate to convert into an invoice."}
   *
   * @returns {Object}
   * @sampleResult {"invoice_id":"460000000034089","invoice_number":"INV-000133","status":"draft","total":2400}
   */
  async convertEstimateToInvoice(organizationId, estimateId) {
    if (!estimateId) {
      throw new Error('"Estimate ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'convertEstimateToInvoice',
      method: 'post',
      url: `${ this.#getApiDomain() }/books/v3/invoices/fromestimates`,
      organizationId: orgId,
      query: { estimate_id: estimateId },
    })

    return response?.invoice || response
  }

  // ============================================================================================
  // CUSTOMER PAYMENTS - ACTIONS
  // ============================================================================================

  /**
   * @operationName Record Customer Payment
   * @category Customer Payments
   * @description Records a payment received from a customer and applies it to an invoice. Supports specifying the payment mode (cash, bank transfer, credit card, etc.) and a reference number.
   *
   * @route POST /record-customer-payment
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @typedef {Object} ZohoInvoiceApply
   * @property {String} invoice_id - Zoho Books invoice ID this payment portion is applied to
   * @property {Number} amount_applied - Amount applied to that invoice
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization in which to record the payment."}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"listContacts","dependsOn":["organizationId"],"description":"The customer making the payment."}
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"listInvoices","dependsOn":["organizationId"],"description":"The primary invoice the payment is applied to. Use Extra Invoices to split across multiple invoices."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The total payment amount in the invoice currency. When Extra Invoices are supplied, the remainder of this amount is applied to the primary invoice."}
   * @paramDef {"type":"String","label":"Payment Mode","name":"paymentMode","uiComponent":{"type":"DROPDOWN","options":{"values":["Cash","Check","Bank Transfer","Bank Remittance","Credit Card","Auto Transaction","Others"]}},"description":"How the payment was received. Defaults to cash when omitted."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Payment date in YYYY-MM-DD format. Defaults to today when omitted."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"Optional reference number (check number, transaction ID, etc.)."}
   * @paramDef {"type":"String","label":"Deposit Account","name":"depositAccountId","dictionary":"listAccounts","dependsOn":["organizationId"],"description":"Optional bank/cash account to deposit the payment into."}
   * @paramDef {"type":"Number","label":"Bank Charges","name":"bankCharges","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional bank charges deducted from the payment."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description recorded on the payment."}
   * @paramDef {"type":"Array<ZohoInvoiceApply>","label":"Extra Invoices","name":"extraInvoices","description":"Optional array of additional invoices to split this payment across. Each entry needs invoice_id and amount_applied. The primary invoice receives the remaining amount."}
   *
   * @returns {Object}
   * @sampleResult {"payment_id":"460000000048011","customer_id":"460000000026049","amount":1250,"payment_mode":"banktransfer","date":"2025-04-28"}
   */
  async recordCustomerPayment(organizationId, customerId, invoiceId, amount, paymentMode, date, reference, depositAccountId, bankCharges, description, extraInvoices) {
    if (!customerId) {
      throw new Error('"Customer" is required')
    }

    if (!invoiceId) {
      throw new Error('"Invoice" is required')
    }

    if (amount === undefined || amount === null || isNaN(Number(amount))) {
      throw new Error('"Amount" is required and must be a number')
    }

    const orgId = this.#resolveOrganizationId(organizationId)
    const numericAmount = Number(amount)

    const extraApplied = Array.isArray(extraInvoices)
      ? extraInvoices
        .filter(e => e && e.invoice_id && Number(e.amount_applied) > 0)
        .map(e => ({ invoice_id: e.invoice_id, amount_applied: Number(e.amount_applied) }))
      : []

    const extraTotal = extraApplied.reduce((s, e) => s + e.amount_applied, 0)
    const primaryAmount = Number((numericAmount - extraTotal).toFixed(2))

    if (primaryAmount < 0) {
      throw new Error('"Extra Invoices" total exceeds "Amount"')
    }

    const invoices = primaryAmount > 0
      ? [{ invoice_id: invoiceId, amount_applied: primaryAmount }, ...extraApplied]
      : extraApplied

    const body = cleanupObject({
      customer_id: customerId,
      payment_mode: this.#resolveChoice(paymentMode, PAYMENT_MODE_MAP) || 'cash',
      amount: numericAmount,
      date,
      reference_number: reference,
      account_id: depositAccountId,
      bank_charges: bankCharges !== undefined && bankCharges !== null ? Number(bankCharges) : undefined,
      description,
      invoices,
    })

    const response = await this.#apiRequest({
      logTag: 'recordCustomerPayment',
      method: 'post',
      url: `${ this.#getApiDomain() }/books/v3/customerpayments`,
      organizationId: orgId,
      body,
    })

    return response?.payment
  }

  /**
   * @operationName Get Customer Payment
   * @category Customer Payments
   * @description Retrieves a single customer payment by ID, including the invoices it was applied to and remaining unused amounts.
   *
   * @route POST /get-customer-payment
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the payment."}
   * @paramDef {"type":"String","label":"Payment","name":"paymentId","required":true,"dictionary":"listCustomerPayments","dependsOn":["organizationId"],"description":"The Zoho Books customer payment ID."}
   *
   * @returns {Object}
   * @sampleResult {"payment_id":"460000000048011","customer_id":"460000000026049","amount":1250,"payment_mode":"banktransfer","date":"2025-04-28","invoices":[{"invoice_id":"460000000034037","amount_applied":1250}]}
   */
  async getCustomerPayment(organizationId, paymentId) {
    if (!paymentId) {
      throw new Error('"Payment ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'getCustomerPayment',
      url: `${ this.#getApiDomain() }/books/v3/customerpayments/${ paymentId }`,
      organizationId: orgId,
    })

    return response?.payment
  }

  /**
   * @operationName Delete Customer Payment
   * @category Customer Payments
   * @description Deletes a customer payment, restoring the related invoice balances.
   *
   * @route POST /delete-customer-payment
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the payment."}
   * @paramDef {"type":"String","label":"Payment","name":"paymentId","required":true,"dictionary":"listCustomerPayments","dependsOn":["organizationId"],"description":"The Zoho Books customer payment ID to delete."}
   *
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The payment has been deleted."}
   */
  async deleteCustomerPayment(organizationId, paymentId) {
    if (!paymentId) {
      throw new Error('"Payment ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'deleteCustomerPayment',
      method: 'delete',
      url: `${ this.#getApiDomain() }/books/v3/customerpayments/${ paymentId }`,
      organizationId: orgId,
    })
  }

  // ============================================================================================
  // BILLS - ACTIONS
  // ============================================================================================

  /**
   * @operationName Create Bill
   * @category Bills
   * @description Creates a new vendor bill in Zoho Books, capturing line items, dates, and an optional bill number for reconciliation.
   *
   * @route POST /create-bill
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization in which to create the bill."}
   * @paramDef {"type":"String","label":"Vendor","name":"vendorId","required":true,"dictionary":"listContacts","dependsOn":["organizationId"],"description":"The vendor (contact with contact_type=vendor) the bill is from."}
   * @paramDef {"type":"Array<ZohoLineItem>","label":"Line Items","name":"lineItems","required":true,"description":"Array of bill line items with item_id or name plus rate and quantity."}
   * @paramDef {"type":"String","label":"Bill Date","name":"billDate","uiComponent":{"type":"DATE_PICKER"},"description":"Bill date in YYYY-MM-DD format. Defaults to today when omitted."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Optional due date in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"Bill Number","name":"billNumber","description":"Optional vendor bill / invoice number for reference."}
   * @paramDef {"type":"String","label":"Currency","name":"currencyId","dictionary":"listCurrencies","dependsOn":["organizationId"],"description":"Optional currency for the bill. Defaults to the vendor's currency."}
   * @paramDef {"type":"String","label":"Reference Number","name":"referenceNumber","description":"Optional cross-system reference number."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional notes recorded on the bill."}
   * @paramDef {"type":"Boolean","label":"Tax Inclusive Lines","name":"isInclusiveTax","uiComponent":{"type":"CHECKBOX"},"description":"When true, line item rates are treated as tax-inclusive."}
   * @paramDef {"type":"Object","label":"Extra Fields","name":"extraFields","freeform":true,"description":"Optional object merged into the bill body for any additional Zoho fields (e.g. {\"purchaseorder_ids\":[\"...\"]})."}
   *
   * @returns {Object}
   * @sampleResult {"bill_id":"460000000038099","bill_number":"BILL-007","vendor_id":"460000000026099","status":"open","total":480}
   */
  async createBill(organizationId, vendorId, lineItems, billDate, dueDate, billNumber, currencyId, referenceNumber, notes, isInclusiveTax, extraFields) {
    if (!vendorId) {
      throw new Error('"Vendor" is required')
    }

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      throw new Error('"Line Items" must be a non-empty array')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const body = cleanupObject({
      vendor_id: vendorId,
      bill_number: billNumber,
      date: billDate,
      due_date: dueDate,
      currency_id: currencyId,
      reference_number: referenceNumber,
      notes,
      is_inclusive_tax: isInclusiveTax,
      line_items: lineItems.map(line => cleanupObject(line)),
      ...(extraFields && typeof extraFields === 'object' ? extraFields : {}),
    })

    const response = await this.#apiRequest({
      logTag: 'createBill',
      method: 'post',
      url: `${ this.#getApiDomain() }/books/v3/bills`,
      organizationId: orgId,
      body,
    })

    return response?.bill
  }

  /**
   * @operationName Get Bill
   * @category Bills
   * @description Retrieves a single bill by ID with full line item details, totals, and payment status.
   *
   * @route POST /get-bill
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the bill."}
   * @paramDef {"type":"String","label":"Bill","name":"billId","required":true,"dictionary":"listBills","dependsOn":["organizationId"],"description":"The bill to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"bill_id":"460000000038099","bill_number":"BILL-007","vendor_name":"Office Depot","status":"open","total":480,"balance":480}
   */
  async getBill(organizationId, billId) {
    if (!billId) {
      throw new Error('"Bill" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'getBill',
      url: `${ this.#getApiDomain() }/books/v3/bills/${ billId }`,
      organizationId: orgId,
    })

    return response?.bill
  }

  /**
   * @operationName Update Bill
   * @category Bills
   * @description Updates an existing bill by merging the supplied fields into the existing record.
   *
   * @route POST /update-bill
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the bill."}
   * @paramDef {"type":"String","label":"Bill","name":"billId","required":true,"dictionary":"listBills","dependsOn":["organizationId"],"description":"The bill to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"freeform":true,"description":"Object containing bill fields to update. Example: {\"due_date\":\"2025-12-31\",\"bill_number\":\"BILL-008\"}."}
   *
   * @returns {Object}
   * @sampleResult {"bill_id":"460000000038099","bill_number":"BILL-008","status":"open","total":480}
   */
  async updateBill(organizationId, billId, fields) {
    if (!billId) {
      throw new Error('"Bill" is required')
    }

    if (!fields || typeof fields !== 'object') {
      throw new Error('"Fields" must be a non-empty object of bill fields to update')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'updateBill',
      method: 'put',
      url: `${ this.#getApiDomain() }/books/v3/bills/${ billId }`,
      organizationId: orgId,
      body: cleanupObject(fields),
    })

    return response?.bill
  }

  /**
   * @operationName Delete Bill
   * @category Bills
   * @description Permanently deletes a vendor bill from Zoho Books.
   *
   * @route POST /delete-bill
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the bill."}
   * @paramDef {"type":"String","label":"Bill","name":"billId","required":true,"dictionary":"listBills","dependsOn":["organizationId"],"description":"The bill to delete."}
   *
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The bill has been deleted."}
   */
  async deleteBill(organizationId, billId) {
    if (!billId) {
      throw new Error('"Bill" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'deleteBill',
      method: 'delete',
      url: `${ this.#getApiDomain() }/books/v3/bills/${ billId }`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Mark Bill Open
   * @category Bills
   * @description Transitions a bill from draft to open, making it visible in payable reports and ready for vendor payments to be applied.
   *
   * @route POST /mark-bill-open
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the bill."}
   * @paramDef {"type":"String","label":"Bill","name":"billId","required":true,"dictionary":"listBills","dependsOn":["organizationId"],"description":"The bill to mark as open."}
   *
   * @returns {Object}
   * @sampleResult {"code":0,"message":"Bill status has been changed to Open."}
   */
  async markBillOpen(organizationId, billId) {
    if (!billId) {
      throw new Error('"Bill" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'markBillOpen',
      method: 'post',
      url: `${ this.#getApiDomain() }/books/v3/bills/${ billId }/status/open`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Mark Bill Void
   * @category Bills
   * @description Voids a bill in Zoho Books. Voided bills remain in the system for auditing but no longer affect outstanding payables.
   *
   * @route POST /mark-bill-void
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the bill."}
   * @paramDef {"type":"String","label":"Bill","name":"billId","required":true,"dictionary":"listBills","dependsOn":["organizationId"],"description":"The bill to void."}
   *
   * @returns {Object}
   * @sampleResult {"code":0,"message":"Bill status has been changed to Void."}
   */
  async markBillVoid(organizationId, billId) {
    if (!billId) {
      throw new Error('"Bill" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'markBillVoid',
      method: 'post',
      url: `${ this.#getApiDomain() }/books/v3/bills/${ billId }/status/void`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Record Vendor Payment
   * @category Vendor Payments
   * @description Records a payment made to a vendor and applies it to an outstanding bill. Supports payment mode and date specification.
   *
   * @route POST /record-vendor-payment
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization in which to record the vendor payment."}
   * @paramDef {"type":"String","label":"Vendor","name":"vendorId","required":true,"dictionary":"listContacts","dependsOn":["organizationId"],"description":"The vendor receiving the payment."}
   * @paramDef {"type":"String","label":"Bill","name":"billId","required":true,"dictionary":"listBills","dependsOn":["organizationId"],"description":"The bill the payment will be applied to."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The payment amount in the bill currency."}
   * @paramDef {"type":"String","label":"Payment Mode","name":"paymentMode","uiComponent":{"type":"DROPDOWN","options":{"values":["Cash","Check","Bank Transfer","Bank Remittance","Credit Card","Auto Transaction","Others"]}},"description":"How the payment was made. Defaults to cash when omitted."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Payment date in YYYY-MM-DD format. Defaults to today when omitted."}
   *
   * @returns {Object}
   * @sampleResult {"payment_id":"460000000049077","vendor_id":"460000000026099","amount":480,"payment_mode":"banktransfer","date":"2025-04-28"}
   */
  async recordVendorPayment(organizationId, vendorId, billId, amount, paymentMode, date) {
    if (!vendorId) {
      throw new Error('"Vendor" is required')
    }

    if (!billId) {
      throw new Error('"Bill" is required')
    }

    if (amount === undefined || amount === null || isNaN(Number(amount))) {
      throw new Error('"Amount" is required and must be a number')
    }

    const orgId = this.#resolveOrganizationId(organizationId)
    const numericAmount = Number(amount)

    const body = cleanupObject({
      vendor_id: vendorId,
      payment_mode: this.#resolveChoice(paymentMode, PAYMENT_MODE_MAP) || 'cash',
      amount: numericAmount,
      date,
      bills: [{ bill_id: billId, amount_applied: numericAmount }],
    })

    const response = await this.#apiRequest({
      logTag: 'recordVendorPayment',
      method: 'post',
      url: `${ this.#getApiDomain() }/books/v3/vendorpayments`,
      organizationId: orgId,
      body,
    })

    return response?.vendorpayment
  }

  // ============================================================================================
  // EXPENSES - ACTIONS
  // ============================================================================================

  /**
   * @operationName Create Expense
   * @category Expenses
   * @description Records an expense transaction in Zoho Books. Requires a GL expense account and the account the funds were paid from. Optionally associate with a vendor and a billable customer.
   *
   * @route POST /create-expense
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization in which to record the expense."}
   * @paramDef {"type":"String","label":"Expense Account","name":"accountId","required":true,"dictionary":"listAccounts","dependsOn":["organizationId"],"description":"The GL expense account to charge."}
   * @paramDef {"type":"String","label":"Paid Through Account","name":"paidThroughAccountId","required":true,"dictionary":"listAccounts","dependsOn":["organizationId"],"description":"The bank, credit card, or cash account from which the expense was paid."}
   * @paramDef {"type":"String","label":"Vendor","name":"vendorId","dictionary":"listContacts","dependsOn":["organizationId"],"description":"Optional vendor associated with the expense."}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","dictionary":"listContacts","dependsOn":["organizationId"],"description":"Optional customer to associate the expense with (for billable or tracking purposes)."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The expense amount."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Expense date in YYYY-MM-DD format. Defaults to today when omitted."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description shown on the expense record."}
   * @paramDef {"type":"Boolean","label":"Billable","name":"isBillable","uiComponent":{"type":"CHECKBOX"},"description":"When true and a Customer is provided, the expense is marked billable to the customer. Defaults to false."}
   * @paramDef {"type":"String","label":"Currency","name":"currencyId","dictionary":"listCurrencies","dependsOn":["organizationId"],"description":"Optional currency for the expense."}
   * @paramDef {"type":"String","label":"Reference Number","name":"referenceNumber","description":"Optional reference number (receipt number, transaction ID, etc.)."}
   *
   * @returns {Object}
   * @sampleResult {"expense_id":"460000000050099","account_id":"460000000027001","amount":75,"date":"2025-04-28","description":"Office supplies"}
   */
  async createExpense(organizationId, accountId, paidThroughAccountId, vendorId, customerId, amount, date, description, isBillable, currencyId, referenceNumber) {
    if (!accountId) {
      throw new Error('"Expense Account" is required')
    }

    if (!paidThroughAccountId) {
      throw new Error('"Paid Through Account" is required')
    }

    if (amount === undefined || amount === null || isNaN(Number(amount))) {
      throw new Error('"Amount" is required and must be a number')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const body = cleanupObject({
      account_id: accountId,
      paid_through_account_id: paidThroughAccountId,
      vendor_id: vendorId,
      customer_id: customerId,
      is_billable: isBillable === true && customerId ? true : undefined,
      currency_id: currencyId,
      reference_number: referenceNumber,
      amount: Number(amount),
      date,
      description,
    })

    const response = await this.#apiRequest({
      logTag: 'createExpense',
      method: 'post',
      url: `${ this.#getApiDomain() }/books/v3/expenses`,
      organizationId: orgId,
      body,
    })

    return response?.expense
  }

  /**
   * @operationName Get Expense
   * @category Expenses
   * @description Retrieves a single expense record by ID with the full detail set including the source account and any billable customer.
   *
   * @route POST /get-expense
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the expense."}
   * @paramDef {"type":"String","label":"Expense","name":"expenseId","required":true,"dictionary":"listExpensesDict","dependsOn":["organizationId"],"description":"The Zoho Books expense ID."}
   *
   * @returns {Object}
   * @sampleResult {"expense_id":"460000000050099","amount":75,"date":"2025-04-28","account_name":"Office Supplies","status":"unbilled"}
   */
  async getExpense(organizationId, expenseId) {
    if (!expenseId) {
      throw new Error('"Expense ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'getExpense',
      url: `${ this.#getApiDomain() }/books/v3/expenses/${ expenseId }`,
      organizationId: orgId,
    })

    return response?.expense
  }

  /**
   * @operationName Update Expense
   * @category Expenses
   * @description Updates an existing expense by merging the supplied fields into the existing record.
   *
   * @route POST /update-expense
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the expense."}
   * @paramDef {"type":"String","label":"Expense","name":"expenseId","required":true,"dictionary":"listExpensesDict","dependsOn":["organizationId"],"description":"The Zoho Books expense ID to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"freeform":true,"description":"Object containing expense fields to update. Example: {\"amount\":99.99,\"description\":\"Adjusted amount\"}."}
   *
   * @returns {Object}
   * @sampleResult {"expense_id":"460000000050099","amount":99.99,"date":"2025-04-28","description":"Adjusted amount"}
   */
  async updateExpense(organizationId, expenseId, fields) {
    if (!expenseId) {
      throw new Error('"Expense ID" is required')
    }

    if (!fields || typeof fields !== 'object') {
      throw new Error('"Fields" must be a non-empty object of expense fields to update')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'updateExpense',
      method: 'put',
      url: `${ this.#getApiDomain() }/books/v3/expenses/${ expenseId }`,
      organizationId: orgId,
      body: cleanupObject(fields),
    })

    return response?.expense
  }

  /**
   * @operationName Delete Expense
   * @category Expenses
   * @description Permanently deletes an expense from Zoho Books.
   *
   * @route POST /delete-expense
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the expense."}
   * @paramDef {"type":"String","label":"Expense","name":"expenseId","required":true,"dictionary":"listExpensesDict","dependsOn":["organizationId"],"description":"The Zoho Books expense ID to delete."}
   *
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The expense has been deleted."}
   */
  async deleteExpense(organizationId, expenseId) {
    if (!expenseId) {
      throw new Error('"Expense ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'deleteExpense',
      method: 'delete',
      url: `${ this.#getApiDomain() }/books/v3/expenses/${ expenseId }`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName List Expenses
   * @category Expenses
   * @description Retrieves a paginated list of expenses with optional filters. Useful for syncing expense data into reporting or reimbursement workflows.
   *
   * @route POST /list-expenses
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization whose expenses will be listed."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Unbilled","Invoiced","Reimbursed","Non-Billable","Billable"]}},"description":"Optional filter restricting expenses to a specific status."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number (1-based). Default: 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of expenses per page. Maximum is 200; default is 50."}
   * @paramDef {"type":"String","label":"Modified Since","name":"lastModifiedTimeStart","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional ISO timestamp; only expenses modified at or after this time are returned. Useful for incremental sync."}
   *
   * @returns {Object}
   * @sampleResult {"expenses":[{"expense_id":"460000000050099","amount":75,"date":"2025-04-28","account_name":"Office Supplies","status":"unbilled"}],"page_context":{"page":1,"per_page":50,"has_more_page":false}}
   */
  async listExpensesAction(organizationId, status, page, perPage, lastModifiedTimeStart) {
    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'listExpensesAction',
      url: `${ this.#getApiDomain() }/books/v3/expenses`,
      organizationId: orgId,
      query: {
        page: page || 1,
        per_page: perPage || DEFAULT_PAGE_SIZE,
        status: this.#resolveChoice(status, EXPENSE_STATUS_MAP),
        last_modified_time: lastModifiedTimeStart || undefined,
      },
    })
  }

  // ============================================================================================
  // ITEMS - ACTIONS
  // ============================================================================================

  /**
   * @operationName Create Item
   * @category Items
   * @description Creates a new product or service item in Zoho Books. Items are reusable line entries used by invoices, estimates, and bills.
   *
   * @route POST /create-item
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization in which to create the item."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Display name of the item."}
   * @paramDef {"type":"Number","label":"Rate","name":"rate","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Default unit rate / price."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description appended to invoice/estimate line items."}
   * @paramDef {"type":"String","label":"Income Account","name":"accountId","dictionary":"listAccounts","dependsOn":["organizationId"],"description":"Optional income account to which sales of this item should be posted."}
   * @paramDef {"type":"String","label":"Tax","name":"taxId","dictionary":"listTaxes","dependsOn":["organizationId"],"description":"Optional default tax to apply when this item is added to invoices."}
   *
   * @returns {Object}
   * @sampleResult {"item_id":"460000000027111","name":"Consulting","rate":150,"description":"Hourly consulting"}
   */
  async createItem(organizationId, name, rate, description, accountId, taxId) {
    if (!name) {
      throw new Error('"Name" is required')
    }

    if (rate === undefined || rate === null || isNaN(Number(rate))) {
      throw new Error('"Rate" is required and must be a number')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const body = cleanupObject({
      name,
      rate: Number(rate),
      description,
      account_id: accountId,
      tax_id: taxId,
    })

    const response = await this.#apiRequest({
      logTag: 'createItem',
      method: 'post',
      url: `${ this.#getApiDomain() }/books/v3/items`,
      organizationId: orgId,
      body,
    })

    return response?.item
  }

  /**
   * @operationName Get Item
   * @category Items
   * @description Retrieves a single item by ID with full configuration including rate, accounts, and tax settings.
   *
   * @route POST /get-item
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the item."}
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"listItems","dependsOn":["organizationId"],"description":"The item to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"item_id":"460000000027111","name":"Consulting","rate":150,"description":"Hourly consulting","status":"active"}
   */
  async getItem(organizationId, itemId) {
    if (!itemId) {
      throw new Error('"Item" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'getItem',
      url: `${ this.#getApiDomain() }/books/v3/items/${ itemId }`,
      organizationId: orgId,
    })

    return response?.item
  }

  /**
   * @operationName Update Item
   * @category Items
   * @description Updates an existing item by merging the provided fields into the existing record.
   *
   * @route POST /update-item
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the item."}
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"listItems","dependsOn":["organizationId"],"description":"The item to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"freeform":true,"description":"Object containing item fields to update. Example: {\"rate\":175,\"description\":\"Updated rate\"}."}
   *
   * @returns {Object}
   * @sampleResult {"item_id":"460000000027111","name":"Consulting","rate":175,"status":"active"}
   */
  async updateItem(organizationId, itemId, fields) {
    if (!itemId) {
      throw new Error('"Item" is required')
    }

    if (!fields || typeof fields !== 'object') {
      throw new Error('"Fields" must be a non-empty object of item fields to update')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'updateItem',
      method: 'put',
      url: `${ this.#getApiDomain() }/books/v3/items/${ itemId }`,
      organizationId: orgId,
      body: cleanupObject(fields),
    })

    return response?.item
  }

  /**
   * @operationName Delete Item
   * @category Items
   * @description Permanently deletes an item from Zoho Books. Items currently used in transactions cannot be deleted.
   *
   * @route POST /delete-item
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the item."}
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"listItems","dependsOn":["organizationId"],"description":"The item to delete."}
   *
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The item has been deleted."}
   */
  async deleteItem(organizationId, itemId) {
    if (!itemId) {
      throw new Error('"Item" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'deleteItem',
      method: 'delete',
      url: `${ this.#getApiDomain() }/books/v3/items/${ itemId }`,
      organizationId: orgId,
    })
  }

  // ============================================================================================
  // SALES ORDERS - ACTIONS
  // ============================================================================================

  /**
   * @operationName Create Sales Order
   * @category Sales Orders
   * @description Creates a new sales order in Zoho Books for tracking customer commitments before invoicing.
   *
   * @route POST /create-sales-order
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization in which to create the sales order."}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"listContacts","dependsOn":["organizationId"],"description":"The customer the sales order is for."}
   * @paramDef {"type":"Array<ZohoLineItem>","label":"Line Items","name":"lineItems","required":true,"description":"Array of sales-order line items with item_id or name plus rate and quantity."}
   * @paramDef {"type":"String","label":"Order Date","name":"orderDate","uiComponent":{"type":"DATE_PICKER"},"description":"Sales order date in YYYY-MM-DD format. Defaults to today when omitted."}
   * @paramDef {"type":"String","label":"Shipment Date","name":"shipmentDate","uiComponent":{"type":"DATE_PICKER"},"description":"Optional expected shipment date in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"Reference Number","name":"referenceNumber","description":"Optional reference number such as a customer PO number."}
   *
   * @returns {Object}
   * @sampleResult {"salesorder_id":"460000000060011","salesorder_number":"SO-00007","customer_id":"460000000026049","status":"draft","total":2400}
   */
  async createSalesOrder(organizationId, customerId, lineItems, orderDate, shipmentDate, referenceNumber) {
    if (!customerId) {
      throw new Error('"Customer" is required')
    }

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      throw new Error('"Line Items" must be a non-empty array')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const body = cleanupObject({
      customer_id: customerId,
      line_items: lineItems.map(line => cleanupObject(line)),
      date: orderDate,
      shipment_date: shipmentDate,
      reference_number: referenceNumber,
    })

    const response = await this.#apiRequest({
      logTag: 'createSalesOrder',
      method: 'post',
      url: `${ this.#getApiDomain() }/books/v3/salesorders`,
      organizationId: orgId,
      body,
    })

    return response?.salesorder
  }

  /**
   * @operationName Get Sales Order
   * @category Sales Orders
   * @description Retrieves a single sales order by ID with line items, totals, and current status.
   *
   * @route POST /get-sales-order
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the sales order."}
   * @paramDef {"type":"String","label":"Sales Order","name":"salesOrderId","required":true,"dictionary":"listSalesOrders","dependsOn":["organizationId"],"description":"The Zoho Books sales order ID."}
   *
   * @returns {Object}
   * @sampleResult {"salesorder_id":"460000000060011","salesorder_number":"SO-00007","status":"open","total":2400}
   */
  async getSalesOrder(organizationId, salesOrderId) {
    if (!salesOrderId) {
      throw new Error('"Sales Order ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'getSalesOrder',
      url: `${ this.#getApiDomain() }/books/v3/salesorders/${ salesOrderId }`,
      organizationId: orgId,
    })

    return response?.salesorder
  }

  /**
   * @operationName Update Sales Order
   * @category Sales Orders
   * @description Updates an existing sales order by merging the provided fields into the existing record.
   *
   * @route POST /update-sales-order
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the sales order."}
   * @paramDef {"type":"String","label":"Sales Order","name":"salesOrderId","required":true,"dictionary":"listSalesOrders","dependsOn":["organizationId"],"description":"The Zoho Books sales order ID to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"freeform":true,"description":"Object of sales-order fields to update. Example: {\"shipment_date\":\"2025-05-15\",\"reference_number\":\"PO-12345\"}."}
   *
   * @returns {Object}
   * @sampleResult {"salesorder_id":"460000000060011","salesorder_number":"SO-00007","status":"open","total":2400}
   */
  async updateSalesOrder(organizationId, salesOrderId, fields) {
    if (!salesOrderId) {
      throw new Error('"Sales Order ID" is required')
    }

    if (!fields || typeof fields !== 'object') {
      throw new Error('"Fields" must be a non-empty object of sales-order fields to update')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'updateSalesOrder',
      method: 'put',
      url: `${ this.#getApiDomain() }/books/v3/salesorders/${ salesOrderId }`,
      organizationId: orgId,
      body: cleanupObject(fields),
    })

    return response?.salesorder
  }

  /**
   * @operationName Delete Sales Order
   * @category Sales Orders
   * @description Permanently deletes a sales order from Zoho Books.
   *
   * @route POST /delete-sales-order
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the sales order."}
   * @paramDef {"type":"String","label":"Sales Order","name":"salesOrderId","required":true,"dictionary":"listSalesOrders","dependsOn":["organizationId"],"description":"The Zoho Books sales order ID to delete."}
   *
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The sales order has been deleted."}
   */
  async deleteSalesOrder(organizationId, salesOrderId) {
    if (!salesOrderId) {
      throw new Error('"Sales Order ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'deleteSalesOrder',
      method: 'delete',
      url: `${ this.#getApiDomain() }/books/v3/salesorders/${ salesOrderId }`,
      organizationId: orgId,
    })
  }

  // ============================================================================================
  // PURCHASE ORDERS - ACTIONS
  // ============================================================================================

  /**
   * @operationName Create Purchase Order
   * @category Purchase Orders
   * @description Creates a new purchase order in Zoho Books for tracking commitments to a vendor before the bill arrives.
   *
   * @route POST /create-purchase-order
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization in which to create the purchase order."}
   * @paramDef {"type":"String","label":"Vendor","name":"vendorId","required":true,"dictionary":"listContacts","dependsOn":["organizationId"],"description":"The vendor the purchase order is being placed with."}
   * @paramDef {"type":"Array<ZohoLineItem>","label":"Line Items","name":"lineItems","required":true,"description":"Array of purchase-order line items with item_id or name plus rate and quantity."}
   * @paramDef {"type":"String","label":"Order Date","name":"orderDate","uiComponent":{"type":"DATE_PICKER"},"description":"Purchase order date in YYYY-MM-DD format. Defaults to today when omitted."}
   * @paramDef {"type":"String","label":"Delivery Date","name":"deliveryDate","uiComponent":{"type":"DATE_PICKER"},"description":"Optional expected delivery date in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"Reference Number","name":"referenceNumber","description":"Optional reference number for cross-system tracking."}
   *
   * @returns {Object}
   * @sampleResult {"purchaseorder_id":"460000000061099","purchaseorder_number":"PO-00007","vendor_id":"460000000026099","status":"draft","total":1200}
   */
  async createPurchaseOrder(organizationId, vendorId, lineItems, orderDate, deliveryDate, referenceNumber) {
    if (!vendorId) {
      throw new Error('"Vendor" is required')
    }

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      throw new Error('"Line Items" must be a non-empty array')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const body = cleanupObject({
      vendor_id: vendorId,
      line_items: lineItems.map(line => cleanupObject(line)),
      date: orderDate,
      delivery_date: deliveryDate,
      reference_number: referenceNumber,
    })

    const response = await this.#apiRequest({
      logTag: 'createPurchaseOrder',
      method: 'post',
      url: `${ this.#getApiDomain() }/books/v3/purchaseorders`,
      organizationId: orgId,
      body,
    })

    return response?.purchaseorder
  }

  /**
   * @operationName Get Purchase Order
   * @category Purchase Orders
   * @description Retrieves a single purchase order by ID with line items, totals, and status.
   *
   * @route POST /get-purchase-order
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the purchase order."}
   * @paramDef {"type":"String","label":"Purchase Order","name":"purchaseOrderId","required":true,"dictionary":"listPurchaseOrders","dependsOn":["organizationId"],"description":"The Zoho Books purchase order ID."}
   *
   * @returns {Object}
   * @sampleResult {"purchaseorder_id":"460000000061099","purchaseorder_number":"PO-00007","status":"issued","total":1200}
   */
  async getPurchaseOrder(organizationId, purchaseOrderId) {
    if (!purchaseOrderId) {
      throw new Error('"Purchase Order ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'getPurchaseOrder',
      url: `${ this.#getApiDomain() }/books/v3/purchaseorders/${ purchaseOrderId }`,
      organizationId: orgId,
    })

    return response?.purchaseorder
  }

  /**
   * @operationName Update Purchase Order
   * @category Purchase Orders
   * @description Updates an existing purchase order by merging the provided fields into the existing record.
   *
   * @route POST /update-purchase-order
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the purchase order."}
   * @paramDef {"type":"String","label":"Purchase Order","name":"purchaseOrderId","required":true,"dictionary":"listPurchaseOrders","dependsOn":["organizationId"],"description":"The Zoho Books purchase order ID to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"freeform":true,"description":"Object of purchase-order fields to update. Example: {\"delivery_date\":\"2025-05-15\"}."}
   *
   * @returns {Object}
   * @sampleResult {"purchaseorder_id":"460000000061099","purchaseorder_number":"PO-00007","status":"issued","total":1200}
   */
  async updatePurchaseOrder(organizationId, purchaseOrderId, fields) {
    if (!purchaseOrderId) {
      throw new Error('"Purchase Order ID" is required')
    }

    if (!fields || typeof fields !== 'object') {
      throw new Error('"Fields" must be a non-empty object of purchase-order fields to update')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'updatePurchaseOrder',
      method: 'put',
      url: `${ this.#getApiDomain() }/books/v3/purchaseorders/${ purchaseOrderId }`,
      organizationId: orgId,
      body: cleanupObject(fields),
    })

    return response?.purchaseorder
  }

  /**
   * @operationName Delete Purchase Order
   * @category Purchase Orders
   * @description Permanently deletes a purchase order from Zoho Books.
   *
   * @route POST /delete-purchase-order
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the purchase order."}
   * @paramDef {"type":"String","label":"Purchase Order","name":"purchaseOrderId","required":true,"dictionary":"listPurchaseOrders","dependsOn":["organizationId"],"description":"The Zoho Books purchase order ID to delete."}
   *
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The purchase order has been deleted."}
   */
  async deletePurchaseOrder(organizationId, purchaseOrderId) {
    if (!purchaseOrderId) {
      throw new Error('"Purchase Order ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'deletePurchaseOrder',
      method: 'delete',
      url: `${ this.#getApiDomain() }/books/v3/purchaseorders/${ purchaseOrderId }`,
      organizationId: orgId,
    })
  }

  // ============================================================================================
  // SALES ORDER STATUS TRANSITIONS
  // ============================================================================================

  /**
   * @operationName Mark Sales Order Open
   * @category Sales Orders
   * @description Transitions a sales order from draft to open.
   * @route POST /mark-sales-order-open
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the sales order."}
   * @paramDef {"type":"String","label":"Sales Order","name":"salesOrderId","required":true,"dictionary":"listSalesOrders","dependsOn":["organizationId"],"description":"The sales order to mark as open."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"Sales Order status has been changed to Open."}
   */
  async markSalesOrderOpen(organizationId, salesOrderId) {
    if (!salesOrderId) {
      throw new Error('"Sales Order ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'markSalesOrderOpen',
      method: 'post',
      url: `${ this.#getApiDomain() }/books/v3/salesorders/${ salesOrderId }/status/open`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Mark Sales Order Void
   * @category Sales Orders
   * @description Voids a sales order.
   * @route POST /mark-sales-order-void
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the sales order."}
   * @paramDef {"type":"String","label":"Sales Order","name":"salesOrderId","required":true,"dictionary":"listSalesOrders","dependsOn":["organizationId"],"description":"The sales order to void."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"Sales Order status has been changed to Void."}
   */
  async markSalesOrderVoid(organizationId, salesOrderId) {
    if (!salesOrderId) {
      throw new Error('"Sales Order ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'markSalesOrderVoid',
      method: 'post',
      url: `${ this.#getApiDomain() }/books/v3/salesorders/${ salesOrderId }/status/void`,
      organizationId: orgId,
    })
  }

  // ============================================================================================
  // PURCHASE ORDER STATUS TRANSITIONS
  // ============================================================================================

  /**
   * @operationName Mark Purchase Order Issued
   * @category Purchase Orders
   * @description Transitions a purchase order from draft to issued.
   * @route POST /mark-purchase-order-issued
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the purchase order."}
   * @paramDef {"type":"String","label":"Purchase Order","name":"purchaseOrderId","required":true,"dictionary":"listPurchaseOrders","dependsOn":["organizationId"],"description":"The purchase order to mark as issued."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"Purchase Order status has been changed to Issued."}
   */
  async markPurchaseOrderIssued(organizationId, purchaseOrderId) {
    if (!purchaseOrderId) {
      throw new Error('"Purchase Order ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'markPurchaseOrderIssued',
      method: 'post',
      url: `${ this.#getApiDomain() }/books/v3/purchaseorders/${ purchaseOrderId }/status/issued`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Mark Purchase Order Cancelled
   * @category Purchase Orders
   * @description Cancels an issued purchase order.
   * @route POST /mark-purchase-order-cancelled
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the purchase order."}
   * @paramDef {"type":"String","label":"Purchase Order","name":"purchaseOrderId","required":true,"dictionary":"listPurchaseOrders","dependsOn":["organizationId"],"description":"The purchase order to cancel."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"Purchase Order status has been changed to Cancelled."}
   */
  async markPurchaseOrderCancelled(organizationId, purchaseOrderId) {
    if (!purchaseOrderId) {
      throw new Error('"Purchase Order ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'markPurchaseOrderCancelled',
      method: 'post',
      url: `${ this.#getApiDomain() }/books/v3/purchaseorders/${ purchaseOrderId }/status/cancelled`,
      organizationId: orgId,
    })
  }

  // ============================================================================================
  // INVOICE EXTRAS
  // ============================================================================================

  /**
   * @operationName Submit Invoice
   * @category Invoices
   * @description Submits an invoice for approval (when invoice approval workflow is enabled in Zoho Books).
   * @route POST /submit-invoice
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the invoice."}
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"listInvoices","dependsOn":["organizationId"],"description":"The invoice to submit for approval."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"Invoice has been submitted for approval."}
   */
  async submitInvoice(organizationId, invoiceId) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'submitInvoice',
      method: 'post',
      url: `${ this.#getApiDomain() }/books/v3/invoices/${ invoiceId }/submit`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Approve Invoice
   * @category Invoices
   * @description Approves an invoice that was submitted for approval.
   * @route POST /approve-invoice
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the invoice."}
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"listInvoices","dependsOn":["organizationId"],"description":"The invoice to approve."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"Invoice has been approved."}
   */
  async approveInvoice(organizationId, invoiceId) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'approveInvoice',
      method: 'post',
      url: `${ this.#getApiDomain() }/books/v3/invoices/${ invoiceId }/approve`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Write Off Invoice
   * @category Invoices
   * @description Writes off the outstanding balance of an invoice. Useful for marking uncollectible invoices.
   * @route POST /write-off-invoice
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the invoice."}
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"listInvoices","dependsOn":["organizationId"],"description":"The invoice to write off."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"Amount has been written off for the invoice."}
   */
  async writeOffInvoice(organizationId, invoiceId) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'writeOffInvoice',
      method: 'post',
      url: `${ this.#getApiDomain() }/books/v3/invoices/${ invoiceId }/writeoff`,
      organizationId: orgId,
    })
  }

  // ============================================================================================
  // CREDIT NOTES - ACTIONS
  // ============================================================================================

  /**
   * @operationName Create Credit Note
   * @category Credit Notes
   * @description Creates a customer credit note in Zoho Books with line items. Credit notes can later be applied to invoices or refunded.
   * @route POST /create-credit-note
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization in which to create the credit note."}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"listContacts","dependsOn":["organizationId"],"description":"The customer the credit note is for."}
   * @paramDef {"type":"Array<ZohoLineItem>","label":"Line Items","name":"lineItems","required":true,"description":"Array of credit-note line items with item_id or name plus rate and quantity."}
   * @paramDef {"type":"String","label":"Credit Note Date","name":"creditNoteDate","uiComponent":{"type":"DATE_PICKER"},"description":"Credit note date in YYYY-MM-DD format. Defaults to today when omitted."}
   * @paramDef {"type":"String","label":"Reference Number","name":"referenceNumber","description":"Optional reference number."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional notes shown on the credit note."}
   * @paramDef {"type":"Object","label":"Extra Fields","name":"extraFields","freeform":true,"description":"Optional object merged into the credit note body for additional Zoho fields."}
   * @returns {Object}
   * @sampleResult {"creditnote_id":"460000000070033","creditnote_number":"CN-00005","customer_id":"460000000026049","status":"draft","total":250}
   */
  async createCreditNote(organizationId, customerId, lineItems, creditNoteDate, referenceNumber, notes, extraFields) {
    if (!customerId) {
      throw new Error('"Customer" is required')
    }

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      throw new Error('"Line Items" must be a non-empty array')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const body = cleanupObject({
      customer_id: customerId,
      line_items: lineItems.map(line => cleanupObject(line)),
      date: creditNoteDate,
      reference_number: referenceNumber,
      notes,
      ...(extraFields && typeof extraFields === 'object' ? extraFields : {}),
    })

    const response = await this.#apiRequest({
      logTag: 'createCreditNote',
      method: 'post',
      url: `${ this.#getApiDomain() }/books/v3/creditnotes`,
      organizationId: orgId,
      body,
    })

    return response?.creditnote
  }

  /**
   * @operationName Get Credit Note
   * @category Credit Notes
   * @description Retrieves a credit note by ID.
   * @route POST /get-credit-note
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the credit note."}
   * @paramDef {"type":"String","label":"Credit Note","name":"creditNoteId","required":true,"dictionary":"listCreditNotes","dependsOn":["organizationId"],"description":"The credit note to retrieve."}
   * @returns {Object}
   * @sampleResult {"creditnote_id":"460000000070033","status":"open","total":250,"balance":250}
   */
  async getCreditNote(organizationId, creditNoteId) {
    if (!creditNoteId) {
      throw new Error('"Credit Note ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'getCreditNote',
      url: `${ this.#getApiDomain() }/books/v3/creditnotes/${ creditNoteId }`,
      organizationId: orgId,
    })

    return response?.creditnote
  }

  /**
   * @operationName Update Credit Note
   * @category Credit Notes
   * @description Updates an existing credit note by merging fields into the existing record.
   * @route POST /update-credit-note
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the credit note."}
   * @paramDef {"type":"String","label":"Credit Note","name":"creditNoteId","required":true,"dictionary":"listCreditNotes","dependsOn":["organizationId"],"description":"The credit note to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"freeform":true,"description":"Object containing credit note fields to update."}
   * @returns {Object}
   * @sampleResult {"creditnote_id":"460000000070033","status":"open","total":300}
   */
  async updateCreditNote(organizationId, creditNoteId, fields) {
    if (!creditNoteId) {
      throw new Error('"Credit Note ID" is required')
    }

    if (!fields || typeof fields !== 'object') {
      throw new Error('"Fields" must be a non-empty object')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'updateCreditNote',
      method: 'put',
      url: `${ this.#getApiDomain() }/books/v3/creditnotes/${ creditNoteId }`,
      organizationId: orgId,
      body: cleanupObject(fields),
    })

    return response?.creditnote
  }

  /**
   * @operationName Delete Credit Note
   * @category Credit Notes
   * @description Permanently deletes a credit note.
   * @route POST /delete-credit-note
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the credit note."}
   * @paramDef {"type":"String","label":"Credit Note","name":"creditNoteId","required":true,"dictionary":"listCreditNotes","dependsOn":["organizationId"],"description":"The credit note to delete."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The credit note has been deleted."}
   */
  async deleteCreditNote(organizationId, creditNoteId) {
    if (!creditNoteId) {
      throw new Error('"Credit Note ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'deleteCreditNote',
      method: 'delete',
      url: `${ this.#getApiDomain() }/books/v3/creditnotes/${ creditNoteId }`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Apply Credit Note To Invoices
   * @category Credit Notes
   * @description Applies all or part of a credit note to one or more invoices.
   * @route POST /apply-credit-note
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the credit note."}
   * @paramDef {"type":"String","label":"Credit Note","name":"creditNoteId","required":true,"dictionary":"listCreditNotes","dependsOn":["organizationId"],"description":"The credit note to apply."}
   * @paramDef {"type":"Array<ZohoInvoiceApply>","label":"Invoices","name":"invoices","required":true,"description":"Array of {invoice_id, amount_applied} entries describing how to distribute the credit."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"Credits have been applied to the invoice(s)."}
   */
  async applyCreditNoteToInvoices(organizationId, creditNoteId, invoices) {
    if (!creditNoteId) {
      throw new Error('"Credit Note ID" is required')
    }

    if (!Array.isArray(invoices) || invoices.length === 0) {
      throw new Error('"Invoices" must be a non-empty array of {invoice_id, amount_applied}')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'applyCreditNoteToInvoices',
      method: 'post',
      url: `${ this.#getApiDomain() }/books/v3/creditnotes/${ creditNoteId }/invoices`,
      organizationId: orgId,
      body: { invoices: invoices.map(i => ({ invoice_id: i.invoice_id, amount_applied: Number(i.amount_applied) })) },
    })
  }

  // ============================================================================================
  // RECURRING INVOICES - ACTIONS
  // ============================================================================================

  /**
   * @operationName Create Recurring Invoice
   * @category Recurring Invoices
   * @description Creates a recurring invoice schedule that automatically generates invoices on a defined cadence.
   * @route POST /create-recurring-invoice
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization in which to create the recurring invoice."}
   * @paramDef {"type":"String","label":"Recurrence Name","name":"recurrenceName","required":true,"description":"Display name for the recurring profile."}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"listContacts","dependsOn":["organizationId"],"description":"The customer billed by this recurring invoice."}
   * @paramDef {"type":"Array<ZohoLineItem>","label":"Line Items","name":"lineItems","required":true,"description":"Array of recurring invoice line items."}
   * @paramDef {"type":"String","label":"Recurrence Frequency","name":"recurrenceFrequency","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Days","Weeks","Months","Years"]}},"description":"Recurrence unit."}
   * @paramDef {"type":"Number","label":"Repeat Every","name":"repeatEvery","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many units between invocations (e.g. 1 month, 2 weeks)."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"First invoice generation date in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","uiComponent":{"type":"DATE_PICKER"},"description":"Optional last generation date in YYYY-MM-DD format."}
   * @paramDef {"type":"Object","label":"Extra Fields","name":"extraFields","freeform":true,"description":"Optional object merged into the body for additional Zoho fields."}
   * @returns {Object}
   * @sampleResult {"recurring_invoice_id":"460000000080021","recurrence_name":"Monthly Retainer","status":"active","next_invoice_date":"2026-06-01"}
   */
  async createRecurringInvoice(organizationId, recurrenceName, customerId, lineItems, recurrenceFrequency, repeatEvery, startDate, endDate, extraFields) {
    if (!recurrenceName) {
      throw new Error('"Recurrence Name" is required')
    }

    if (!customerId) {
      throw new Error('"Customer" is required')
    }

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      throw new Error('"Line Items" must be a non-empty array')
    }

    if (!recurrenceFrequency) {
      throw new Error('"Recurrence Frequency" is required')
    }

    if (!repeatEvery || isNaN(Number(repeatEvery))) {
      throw new Error('"Repeat Every" is required and must be a number')
    }

    if (!startDate) {
      throw new Error('"Start Date" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const body = cleanupObject({
      recurrence_name: recurrenceName,
      customer_id: customerId,
      line_items: lineItems.map(line => cleanupObject(line)),
      recurrence_frequency: this.#resolveChoice(recurrenceFrequency, RECURRENCE_FREQUENCY_MAP),
      repeat_every: Number(repeatEvery),
      start_date: startDate,
      end_date: endDate,
      ...(extraFields && typeof extraFields === 'object' ? extraFields : {}),
    })

    const response = await this.#apiRequest({
      logTag: 'createRecurringInvoice',
      method: 'post',
      url: `${ this.#getApiDomain() }/books/v3/recurringinvoices`,
      organizationId: orgId,
      body,
    })

    return response?.recurring_invoice
  }

  /**
   * @operationName Get Recurring Invoice
   * @category Recurring Invoices
   * @description Retrieves a recurring invoice by ID.
   * @route POST /get-recurring-invoice
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the recurring invoice."}
   * @paramDef {"type":"String","label":"Recurring Invoice","name":"recurringInvoiceId","required":true,"dictionary":"listRecurringInvoices","dependsOn":["organizationId"],"description":"The recurring invoice to retrieve."}
   * @returns {Object}
   * @sampleResult {"recurring_invoice_id":"460000000080021","status":"active","next_invoice_date":"2026-06-01"}
   */
  async getRecurringInvoice(organizationId, recurringInvoiceId) {
    if (!recurringInvoiceId) {
      throw new Error('"Recurring Invoice ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'getRecurringInvoice',
      url: `${ this.#getApiDomain() }/books/v3/recurringinvoices/${ recurringInvoiceId }`,
      organizationId: orgId,
    })

    return response?.recurring_invoice
  }

  /**
   * @operationName Update Recurring Invoice
   * @category Recurring Invoices
   * @description Updates a recurring invoice by merging fields into the existing record.
   * @route POST /update-recurring-invoice
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the recurring invoice."}
   * @paramDef {"type":"String","label":"Recurring Invoice","name":"recurringInvoiceId","required":true,"dictionary":"listRecurringInvoices","dependsOn":["organizationId"],"description":"The recurring invoice to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"freeform":true,"description":"Object of recurring invoice fields to update."}
   * @returns {Object}
   * @sampleResult {"recurring_invoice_id":"460000000080021","status":"active"}
   */
  async updateRecurringInvoice(organizationId, recurringInvoiceId, fields) {
    if (!recurringInvoiceId) {
      throw new Error('"Recurring Invoice ID" is required')
    }

    if (!fields || typeof fields !== 'object') {
      throw new Error('"Fields" must be a non-empty object')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'updateRecurringInvoice',
      method: 'put',
      url: `${ this.#getApiDomain() }/books/v3/recurringinvoices/${ recurringInvoiceId }`,
      organizationId: orgId,
      body: cleanupObject(fields),
    })

    return response?.recurring_invoice
  }

  /**
   * @operationName Delete Recurring Invoice
   * @category Recurring Invoices
   * @description Permanently deletes a recurring invoice schedule.
   * @route POST /delete-recurring-invoice
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the recurring invoice."}
   * @paramDef {"type":"String","label":"Recurring Invoice","name":"recurringInvoiceId","required":true,"dictionary":"listRecurringInvoices","dependsOn":["organizationId"],"description":"The recurring invoice to delete."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The recurring invoice has been deleted."}
   */
  async deleteRecurringInvoice(organizationId, recurringInvoiceId) {
    if (!recurringInvoiceId) {
      throw new Error('"Recurring Invoice ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'deleteRecurringInvoice',
      method: 'delete',
      url: `${ this.#getApiDomain() }/books/v3/recurringinvoices/${ recurringInvoiceId }`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Activate Recurring Invoice
   * @category Recurring Invoices
   * @description Activates a recurring invoice so it begins generating invoices on schedule.
   * @route POST /activate-recurring-invoice
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the recurring invoice."}
   * @paramDef {"type":"String","label":"Recurring Invoice","name":"recurringInvoiceId","required":true,"dictionary":"listRecurringInvoices","dependsOn":["organizationId"],"description":"The recurring invoice to activate."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The recurring invoice has been activated."}
   */
  async activateRecurringInvoice(organizationId, recurringInvoiceId) {
    if (!recurringInvoiceId) {
      throw new Error('"Recurring Invoice ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'activateRecurringInvoice',
      method: 'post',
      url: `${ this.#getApiDomain() }/books/v3/recurringinvoices/${ recurringInvoiceId }/status/active`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Stop Recurring Invoice
   * @category Recurring Invoices
   * @description Stops a recurring invoice so it no longer generates new invoices.
   * @route POST /stop-recurring-invoice
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization that owns the recurring invoice."}
   * @paramDef {"type":"String","label":"Recurring Invoice","name":"recurringInvoiceId","required":true,"dictionary":"listRecurringInvoices","dependsOn":["organizationId"],"description":"The recurring invoice to stop."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The recurring invoice has been stopped."}
   */
  async stopRecurringInvoice(organizationId, recurringInvoiceId) {
    if (!recurringInvoiceId) {
      throw new Error('"Recurring Invoice ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'stopRecurringInvoice',
      method: 'post',
      url: `${ this.#getApiDomain() }/books/v3/recurringinvoices/${ recurringInvoiceId }/status/stop`,
      organizationId: orgId,
    })
  }

  // ============================================================================================
  // REALTIME TRIGGERS (ZOHO BOOKS WEBHOOKS)
  // ============================================================================================
  // Webhook subscription is managed per-trigger-set: each call to handleTriggerUpsertWebhook
  // groups the active triggers by Zoho entity (invoice/bill/contact/etc.) and creates one Zoho
  // webhook per entity, registered with the FlowRunner-supplied callbackUrl. Each Zoho webhook
  // carries its own HMAC-SHA256 secret which we persist in webhookData and verify on every
  // incoming invocation. SINGLE_APP scope at the class level means each app/connection gets its
  // own webhook record.

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    const { events, webhookData, callbackUrl } = invocation
    const previousByEntity = webhookData?.byEntity || {}

    if (!Array.isArray(events) || events.length === 0) {
      // Nothing to subscribe to — delete any previously-registered webhooks.
      await this.#deleteAllWebhooks(previousByEntity, webhookData?.organizationId)

      return { webhookData: { byEntity: {}, organizationId: null } }
    }

    const organizationId = events
      .map(e => e?.triggerData?.organizationId)
      .find(Boolean)

    if (!organizationId) {
      throw new Error('handleTriggerUpsertWebhook: no organizationId on any trigger')
    }

    // Group requested events by Zoho entity.
    const wantByEntity = {}

    for (const trigger of events) {
      const def = REALTIME_TRIGGERS[trigger.name]

      if (!def) {
        logger.warn(`handleTriggerUpsertWebhook: unknown trigger name=${ trigger.name }`)
        continue
      }

      if (!wantByEntity[def.entity]) {
        wantByEntity[def.entity] = new Set()
      }

      wantByEntity[def.entity].add(def.event)
    }

    const newByEntity = {}

    for (const entity of Object.keys(wantByEntity)) {
      const eventList = Array.from(wantByEntity[entity])
      const previous = previousByEntity[entity]
      const secret = previous?.secret || generateWebhookSecret()
      const webhookName = `FlowRunner ${ entity } #${ Date.now().toString(36) }`.slice(0, 50)

      const payload = {
        webhook_name: previous?.webhookName || webhookName,
        url: callbackUrl,
        method: 'POST',
        entity,
        events: eventList,
        secret,
      }

      try {
        if (previous?.webhookId) {
          await this.#apiRequest({
            logTag: 'handleTriggerUpsertWebhook.update',
            method: 'put',
            url: `${ this.#getApiDomain() }/books/v3/settings/webhooks/${ previous.webhookId }`,
            organizationId,
            body: payload,
          })

          newByEntity[entity] = {
            webhookId: previous.webhookId,
            webhookName: previous.webhookName || webhookName,
            secret,
            events: eventList,
          }
        } else {
          const response = await this.#apiRequest({
            logTag: 'handleTriggerUpsertWebhook.create',
            method: 'post',
            url: `${ this.#getApiDomain() }/books/v3/settings/webhooks`,
            organizationId,
            body: payload,
          })

          const webhookId = response?.webhook?.webhook_id || response?.webhook_id

          if (!webhookId) {
            throw new Error(`No webhook_id returned for entity=${ entity }`)
          }

          newByEntity[entity] = { webhookId, webhookName, secret, events: eventList }
        }
      } catch (error) {
        logger.error(`handleTriggerUpsertWebhook entity=${ entity } error=${ error.message }`)
        throw error
      }
    }

    // Delete webhooks for entities that are no longer needed.
    for (const entity of Object.keys(previousByEntity)) {
      if (!newByEntity[entity]) {
        try {
          await this.#apiRequest({
            logTag: 'handleTriggerUpsertWebhook.delete',
            method: 'delete',
            url: `${ this.#getApiDomain() }/books/v3/settings/webhooks/${ previousByEntity[entity].webhookId }`,
            organizationId,
          })
        } catch (error) {
          logger.warn(`handleTriggerUpsertWebhook: failed to remove webhook for entity=${ entity }: ${ error.message }`)
        }
      }
    }

    return {
      eventScopeId: organizationId,
      webhookData: { byEntity: newByEntity, organizationId },
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   */
  async handleTriggerDeleteWebhook(invocation) {
    const previousByEntity = invocation.webhookData?.byEntity || {}
    const organizationId = invocation.webhookData?.organizationId

    await this.#deleteAllWebhooks(previousByEntity, organizationId)

    return { webhookData: { byEntity: {}, organizationId: null } }
  }

  async #deleteAllWebhooks(byEntity, organizationId) {
    if (!organizationId) {
      return
    }

    for (const entity of Object.keys(byEntity || {})) {
      try {
        await this.#apiRequest({
          logTag: 'deleteAllWebhooks',
          method: 'delete',
          url: `${ this.#getApiDomain() }/books/v3/settings/webhooks/${ byEntity[entity].webhookId }`,
          organizationId,
        })
      } catch (error) {
        logger.warn(`deleteAllWebhooks: failed for entity=${ entity }: ${ error.message }`)
      }
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    const body = invocation.body || {}
    const headers = invocation.headers || {}
    const rawBody = invocation.rawBody || (typeof body === 'string' ? body : JSON.stringify(body))
    const signature = headers['x-zoho-webhook-signature'] ||
      headers['X-Zoho-Webhook-Signature'] ||
      headers['x-zoho-webhook-signature'.toLowerCase()]

    const byEntity = invocation.webhookData?.byEntity || {}

    // Verify HMAC against any of the per-entity secrets.
    let verified = false

    for (const entity of Object.keys(byEntity)) {
      const secret = byEntity[entity].secret

      if (verifyZohoSignature(rawBody, secret, signature)) {
        verified = true
        break
      }
    }

    if (!verified) {
      logger.warn('handleTriggerResolveEvents: signature verification failed')

      return { events: [] }
    }

    // Determine the event type from the payload. Zoho ships the entity body but no canonical
    // event field; infer by matching against subscribed event lists and the data shape.
    const inferredEntity = this.#inferEntityFromPayload(body)
    const subscription = byEntity[inferredEntity]

    if (!subscription) {
      logger.debug(`handleTriggerResolveEvents: no subscription for inferred entity=${ inferredEntity }`)

      return { events: [] }
    }

    const eventName = this.#inferEventName(inferredEntity, body, subscription.events)

    if (!eventName) {
      logger.debug(`handleTriggerResolveEvents: could not match event for entity=${ inferredEntity }`)

      return { events: [] }
    }

    const triggerName = EVENT_TO_TRIGGER[eventName]

    if (!triggerName) {
      return { events: [] }
    }

    return {
      eventScopeId: invocation.webhookData?.organizationId,
      events: [{ name: triggerName, data: body }],
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    // For Zoho, all triggers fire on org-level events, so scope match is implicit through the
    // webhook subscription. Return all triggers as matched.
    const { triggers } = invocation

    return { ids: (triggers || []).map(t => t.id) }
  }

  #inferEntityFromPayload(body) {
    if (!body || typeof body !== 'object') {
      return null
    }

    if (body.invoice || body.invoice_id) {
      return 'invoice'
    }

    if (body.bill || body.bill_id) {
      return 'bill'
    }

    if (body.contact || body.contact_id) {
      return 'contact'
    }

    if (body.estimate || body.estimate_id) {
      return 'estimate'
    }

    if (body.payment || body.payment_id || body.customerpayment) {
      return 'customerpayment'
    }

    return null
  }

  #inferEventName(entity, body, subscribedEvents) {
    // Zoho posts `event_type` on some webhook variants; honor it when present.
    if (body?.event_type && subscribedEvents.includes(body.event_type)) {
      return body.event_type
    }

    // Otherwise pick the most-likely event for the entity. With multiple subscribed events for
    // the same entity (e.g. created + updated), we cannot reliably distinguish without an
    // explicit field; favor `*.updated` if present since it covers more cases. Bill paid is
    // distinguishable when the body shows status=paid.
    if (entity === 'bill' && body?.bill?.status === 'paid' && subscribedEvents.includes('bill.paid')) {
      return 'bill.paid'
    }

    if (entity === 'estimate' && body?.estimate?.status === 'accepted' && subscribedEvents.includes('estimate.accepted')) {
      return 'estimate.accepted'
    }

    const updatedEvent = subscribedEvents.find(e => e.endsWith('.updated'))

    if (updatedEvent) {
      return updatedEvent
    }

    return subscribedEvents[0]
  }

  /**
   * @operationName On Invoice Created (Realtime)
   * @category Event Tracking
   * @description Fires immediately when a new invoice is created in the selected Zoho Books organization, via Zoho Books webhooks.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-invoice-created-rt
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization to monitor."}
   * @returns {Object}
   * @sampleResult {"invoice":{"invoice_id":"460000000034037","invoice_number":"INV-000123","status":"draft","total":1250}}
   */
  async onInvoiceCreatedRT(invocation) {
    return invocation.body
  }

  /**
   * @operationName On Invoice Updated (Realtime)
   * @category Event Tracking
   * @description Fires immediately when an invoice is updated.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-invoice-updated-rt
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization to monitor."}
   * @returns {Object}
   * @sampleResult {"invoice":{"invoice_id":"460000000034037","status":"sent","total":1250}}
   */
  async onInvoiceUpdatedRT(invocation) {
    return invocation.body
  }

  /**
   * @operationName On Invoice Deleted (Realtime)
   * @category Event Tracking
   * @description Fires immediately when an invoice is deleted.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-invoice-deleted-rt
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization to monitor."}
   * @returns {Object}
   * @sampleResult {"invoice_id":"460000000034037"}
   */
  async onInvoiceDeletedRT(invocation) {
    return invocation.body
  }

  /**
   * @operationName On Payment Created (Realtime)
   * @category Event Tracking
   * @description Fires immediately when a customer payment is recorded.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-payment-created-rt
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization to monitor."}
   * @returns {Object}
   * @sampleResult {"payment":{"payment_id":"460000000048011","amount":1250}}
   */
  async onPaymentCreatedRT(invocation) {
    return invocation.body
  }

  /**
   * @operationName On Contact Created (Realtime)
   * @category Event Tracking
   * @description Fires immediately when a new contact is created.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-contact-created-rt
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization to monitor."}
   * @returns {Object}
   * @sampleResult {"contact":{"contact_id":"460000000026049","contact_name":"Acme Corp"}}
   */
  async onContactCreatedRT(invocation) {
    return invocation.body
  }

  /**
   * @operationName On Contact Updated (Realtime)
   * @category Event Tracking
   * @description Fires immediately when a contact is updated.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-contact-updated-rt
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization to monitor."}
   * @returns {Object}
   * @sampleResult {"contact":{"contact_id":"460000000026049","contact_name":"Acme Corp"}}
   */
  async onContactUpdatedRT(invocation) {
    return invocation.body
  }

  /**
   * @operationName On Estimate Accepted (Realtime)
   * @category Event Tracking
   * @description Fires immediately when an estimate is accepted by a customer.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-estimate-accepted-rt
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization to monitor."}
   * @returns {Object}
   * @sampleResult {"estimate":{"estimate_id":"460000000045021","status":"accepted"}}
   */
  async onEstimateAcceptedRT(invocation) {
    return invocation.body
  }

  /**
   * @operationName On Bill Created (Realtime)
   * @category Event Tracking
   * @description Fires immediately when a new vendor bill is created.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-bill-created-rt
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization to monitor."}
   * @returns {Object}
   * @sampleResult {"bill":{"bill_id":"460000000038099","bill_number":"BILL-007","status":"open"}}
   */
  async onBillCreatedRT(invocation) {
    return invocation.body
  }

  /**
   * @operationName On Bill Paid (Realtime)
   * @category Event Tracking
   * @description Fires immediately when a vendor bill is fully paid.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-bill-paid-rt
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization to monitor."}
   * @returns {Object}
   * @sampleResult {"bill":{"bill_id":"460000000038099","status":"paid"}}
   */
  async onBillPaidRT(invocation) {
    return invocation.body
  }

  // ============================================================================================
  // POLLING TRIGGERS
  // ============================================================================================
  // Polling triggers serve as a fallback / parallel option when realtime webhooks aren't
  // desired. The pattern: page through `last_modified_time = state` ascending so we
  // never miss events when many records share a timestamp, and never lose data after >100
  // records arrive between polls.

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    return this[invocation.eventName](invocation)
  }

  /**
   * Shared paginating helper for polling triggers. Streams ascending by last_modified_time
   * starting at the cursor, accumulating events whose modification time is strictly newer
   * than the cursor. Returns {events, nextCursor}.
   */
  async #pollByModified({ logTag, url, organizationId, listKey, modifiedField, extraQuery, cursor }) {
    const events = []
    let nextCursor = cursor
    let page = 1

    while (page <= POLLING_MAX_PAGES) {
      const response = await this.#apiRequest({
        logTag,
        url,
        organizationId,
        query: cleanupObject({
          page,
          per_page: 200,
          sort_column: modifiedField,
          sort_order: 'A',
          last_modified_time: cursor || undefined,
          ...(extraQuery || {}),
        }),
      })

      const records = response?.[listKey] || []

      for (const record of records) {
        const modAt = record[modifiedField] || record.last_modified_time || record.created_time

        if (!cursor || (modAt && modAt > cursor)) {
          events.push(record)

          if (modAt && (!nextCursor || modAt > nextCursor)) {
            nextCursor = modAt
          }
        }
      }

      if (response?.page_context?.has_more_page !== true) {
        break
      }

      page++
    }

    return { events, nextCursor: nextCursor || cursor }
  }

  async #runPollingTrigger(invocation, { eventName, listKey, urlPath, idField, modifiedField, extraQuery }) {
    const { organizationId } = invocation.triggerData || {}
    const orgId = this.#resolveOrganizationId(organizationId)
    const url = `${ this.#getApiDomain() }/books/v3/${ urlPath }`

    if (invocation.learningMode) {
      const response = await this.#apiRequest({
        logTag: `${ eventName }.learning`,
        url,
        organizationId: orgId,
        query: cleanupObject({
          page: 1,
          per_page: 1,
          sort_column: modifiedField,
          sort_order: 'D',
          ...(extraQuery || {}),
        }),
      })

      const sample = response?.[listKey]?.[0]

      return { events: sample ? [sample] : [], state: null }
    }

    const cursor = invocation.state?.lastModifiedAt

    if (!cursor) {
      // First run — establish a high-water-mark without emitting historical events.
      const response = await this.#apiRequest({
        logTag: `${ eventName }.seed`,
        url,
        organizationId: orgId,
        query: cleanupObject({
          page: 1,
          per_page: 1,
          sort_column: modifiedField,
          sort_order: 'D',
          ...(extraQuery || {}),
        }),
      })

      const sample = response?.[listKey]?.[0]
      const seedTime = sample?.[modifiedField] || sample?.last_modified_time || sample?.created_time || new Date().toISOString()

      return { events: [], state: { lastModifiedAt: seedTime } }
    }

    const { events, nextCursor } = await this.#pollByModified({
      logTag: eventName,
      url,
      organizationId: orgId,
      listKey,
      idField,
      modifiedField,
      extraQuery,
      cursor,
    })

    return {
      events: events.map(data => ({ name: eventName, data })),
      state: { lastModifiedAt: nextCursor },
    }
  }

  /**
   * @operationName On New Or Updated Invoice (Polling)
   * @category Event Tracking
   * @description Polls for invoices created or updated since the last run. Use the realtime trigger when low latency matters.
   * @registerAs POLLING_TRIGGER
   *
   * @route POST /on-new-invoice
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization to monitor for invoice changes."}
   *
   * @returns {Object}
   * @sampleResult {"invoice_id":"460000000034037","invoice_number":"INV-000123","customer_name":"Acme Corp","total":1250,"status":"draft","last_modified_time":"2026-05-08T09:30:00-0500"}
   */
  async onNewInvoice(invocation) {
    return this.#runPollingTrigger(invocation, {
      eventName: 'onNewInvoice',
      listKey: 'invoices',
      urlPath: 'invoices',
      idField: 'invoice_id',
      modifiedField: 'last_modified_time',
    })
  }

  /**
   * @operationName On New Or Updated Contact (Polling)
   * @category Event Tracking
   * @description Triggers when a new contact (customer or vendor) is created in the selected Zoho Books organization. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   *
   * @route POST /on-new-contact
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization to monitor for new contacts."}
   * @paramDef {"type":"String","label":"Contact Type","name":"contactType","uiComponent":{"type":"DROPDOWN","options":{"values":["Customer","Vendor"]}},"description":"Optional filter to monitor only customers or only vendors."}
   *
   * @returns {Object}
   * @sampleResult {"contact_id":"460000000026049","contact_name":"Acme Corp","contact_type":"customer","status":"active","created_time":"2025-04-28T08:11:00-0500"}
   */
  async onNewContact(invocation) {
    const { contactType } = invocation.triggerData || {}

    return this.#runPollingTrigger(invocation, {
      eventName: 'onNewContact',
      listKey: 'contacts',
      urlPath: 'contacts',
      idField: 'contact_id',
      modifiedField: 'last_modified_time',
      extraQuery: { contact_type: this.#resolveChoice(contactType, CONTACT_TYPE_MAP) },
    })
  }

  /**
   * @operationName On New Or Updated Customer Payment (Polling)
   * @category Event Tracking
   * @description Triggers when a new customer payment is recorded in the selected Zoho Books organization. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   *
   * @route POST /on-payment-received
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization to monitor for new customer payments."}
   *
   * @returns {Object}
   * @sampleResult {"payment_id":"460000000048011","customer_id":"460000000026049","amount":1250,"payment_mode":"banktransfer","date":"2025-04-28"}
   */
  async onPaymentReceived(invocation) {
    return this.#runPollingTrigger(invocation, {
      eventName: 'onPaymentReceived',
      listKey: 'customerpayments',
      urlPath: 'customerpayments',
      idField: 'payment_id',
      modifiedField: 'last_modified_time',
    })
  }

  /**
   * @operationName On New Or Updated Bill (Polling)
   * @category Event Tracking
   * @description Triggers when a new vendor bill is created in the selected Zoho Books organization. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   *
   * @route POST /on-new-bill
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"The Zoho Books organization to monitor for new vendor bills."}
   *
   * @returns {Object}
   * @sampleResult {"bill_id":"460000000038099","bill_number":"BILL-007","vendor_name":"Office Depot","status":"open","total":480,"created_time":"2025-04-28T08:55:00-0500"}
   */
  async onNewBill(invocation) {
    return this.#runPollingTrigger(invocation, {
      eventName: 'onNewBill',
      listKey: 'bills',
      urlPath: 'bills',
      idField: 'bill_id',
      modifiedField: 'last_modified_time',
    })
  }
}

// =================================================================================================
// SERVICE REGISTRATION
// =================================================================================================

Flowrunner.ServerCode.addService(ZohoBooksService, [
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
    displayName: 'Default Organization ID',
    name: 'defaultOrganizationId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Optional fallback organization_id used when an action does not specify one. Find IDs in Zoho Books > Settings > Organization.',
  },
])

// =================================================================================================
// UTILITY FUNCTIONS
// =================================================================================================

function cleanupObject(data) {
  if (!data || typeof data !== 'object') {
    return data
  }

  const result = {}

  Object.keys(data).forEach(key => {
    const value = data[key]

    if (value !== undefined && value !== null && value !== '') {
      result[key] = value
    }
  })

  return Object.keys(result).length > 0 ? result : undefined
}

function searchFilter(list, props, searchString) {
  if (!searchString) {
    return list
  }

  const needle = String(searchString).toLowerCase()

  return list.filter(item =>
    props.some(prop => {
      const value = prop.split('.').reduce((acc, key) => acc?.[key], item)

      return value !== undefined && value !== null && String(value).toLowerCase().includes(needle)
    })
  )
}

function generateWebhookSecret() {
  // Zoho requires 12-50 alphanumeric chars; 32 hex chars satisfies that.
  return crypto.randomBytes(16).toString('hex')
}

function verifyZohoSignature(rawBody, secret, signature) {
  if (!secret || !signature || !rawBody) {
    return false
  }

  try {
    const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('base64')
    const a = Buffer.from(computed)
    const b = Buffer.from(signature)

    if (a.length !== b.length) {
      return false
    }

    return crypto.timingSafeEqual(a, b)
  } catch (e) {
    return false
  }
}
