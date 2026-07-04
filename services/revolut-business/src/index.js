'use strict'

const { logger } = require('./helpers/logger')
const { apiRequest } = require('./helpers/http')
const { signClientAssertion } = require('./helpers/jwt')
const {
  verifyWebhookSignature,
  rawBodyOf,
  headersOf,
} = require('./helpers/webhook')
const { wrapApiError } = require('./helpers/errors')
const {
  clean,
  searchFilter,
  toArray,
  generateRequestId,
} = require('./helpers/utils')

// =====================================================================================
// CONSTANTS
// =====================================================================================
//
// TABLE OF CONTENTS (search for the marker to jump):
//   1. OAuth 2.0 system methods            -- #OAUTH
//   2. Internal helpers                    -- #HELPERS
//   3. Dictionaries                        -- #DICTIONARIES
//   4. Accounts                            -- #ACCOUNTS
//   5. Counterparties                      -- #COUNTERPARTIES
//   6. Transactions                        -- #TRANSACTIONS
//   7. Transfers & payments                -- #TRANSFERS
//   8. Payment drafts                      -- #PAYMENT-DRAFTS
//   9. Foreign exchange                    -- #FX
//  10. Payout links                        -- #PAYOUT-LINKS
//  11. Webhooks (management)               -- #WEBHOOKS-MGMT
//  12. Webhook realtime trigger handlers   -- #TRIGGER-HANDLERS
//  13. Realtime trigger operations         -- #TRIGGER-OPS
//  14. Service registration                -- #REGISTRATION

const PRODUCTION_API_BASE = 'https://b2b.revolut.com/api/1.0'
const PRODUCTION_API_V2_BASE = 'https://b2b.revolut.com/api/2.0'
const PRODUCTION_AUTH_HOST = 'https://business.revolut.com'

const SANDBOX_API_BASE = 'https://sandbox-b2b.revolut.com/api/1.0'
const SANDBOX_API_V2_BASE = 'https://sandbox-b2b.revolut.com/api/2.0'
const SANDBOX_AUTH_HOST = 'https://sandbox-business.revolut.com'

const ENVIRONMENT_PRODUCTION = 'production'
const ENVIRONMENT_SANDBOX = 'sandbox'

const DEFAULT_LIMIT = 100
const MAX_TRANSACTIONS_PER_REQUEST = 1000

// Revolut Business webhook events surfaced via the Business API.
// docs: https://developer.revolut.com/docs/business/webhooks-v-2
const RevolutEvents = {
  TransactionCreated: 'TransactionCreated',
  TransactionStateChanged: 'TransactionStateChanged',
  PayoutLinkCreated: 'PayoutLinkCreated',
  PayoutLinkStateChanged: 'PayoutLinkStateChanged',
}

// Operation-name → Revolut event-name registry. Each entry produces a
// realtime trigger method below, and is used to dispatch incoming webhook
// payloads back to the right trigger callback.
const TriggerEventBindings = {
  onTransactionCreated: RevolutEvents.TransactionCreated,
  onTransactionStateChanged: RevolutEvents.TransactionStateChanged,
  onPayoutLinkCreated: RevolutEvents.PayoutLinkCreated,
  onPayoutLinkStateChanged: RevolutEvents.PayoutLinkStateChanged,
}

// Reverse map: Revolut event-name → service method name. Built once at load time.
const RevolutEventToMethod = Object.fromEntries(
  Object.entries(TriggerEventBindings).map(([method, event]) => [
    event,
    method,
  ])
)

const TriggerCallTypes = {
  SHAPE_EVENT: 'SHAPE_EVENT',
  FILTER_TRIGGER: 'FILTER_TRIGGER',
}

// Static reference list of ISO 4217 currencies most commonly used in
// Revolut Business. The full list is dynamic on Revolut's side but a
// fixed dropdown is friendlier for AI agents and UI.
const SUPPORTED_CURRENCIES = [
  'AED',
  'AUD',
  'BGN',
  'CAD',
  'CHF',
  'CZK',
  'DKK',
  'EUR',
  'GBP',
  'HKD',
  'HRK',
  'HUF',
  'ILS',
  'ISK',
  'JPY',
  'MXN',
  'NOK',
  'NZD',
  'PLN',
  'QAR',
  'RON',
  'RUB',
  'SAR',
  'SEK',
  'SGD',
  'THB',
  'TRY',
  'USD',
  'ZAR',
]

// ISO 3166-1 alpha-2 country codes Revolut Business commonly supports for
// counterparties + address fields. Labelled with the country name so AI
// agents and humans both see a friendly picker rather than guessing codes.
const SUPPORTED_COUNTRIES = [
  ['AE', 'United Arab Emirates'], ['AT', 'Austria'], ['AU', 'Australia'],
  ['BE', 'Belgium'], ['BG', 'Bulgaria'], ['BR', 'Brazil'], ['CA', 'Canada'],
  ['CH', 'Switzerland'], ['CN', 'China'], ['CY', 'Cyprus'], ['CZ', 'Czechia'],
  ['DE', 'Germany'], ['DK', 'Denmark'], ['EE', 'Estonia'], ['ES', 'Spain'],
  ['FI', 'Finland'], ['FR', 'France'], ['GB', 'United Kingdom'], ['GR', 'Greece'],
  ['HK', 'Hong Kong'], ['HR', 'Croatia'], ['HU', 'Hungary'], ['IE', 'Ireland'],
  ['IL', 'Israel'], ['IN', 'India'], ['IS', 'Iceland'], ['IT', 'Italy'],
  ['JP', 'Japan'], ['LT', 'Lithuania'], ['LU', 'Luxembourg'], ['LV', 'Latvia'],
  ['MT', 'Malta'], ['MX', 'Mexico'], ['NL', 'Netherlands'], ['NO', 'Norway'],
  ['NZ', 'New Zealand'], ['PL', 'Poland'], ['PT', 'Portugal'], ['RO', 'Romania'],
  ['SA', 'Saudi Arabia'], ['SE', 'Sweden'], ['SG', 'Singapore'], ['SI', 'Slovenia'],
  ['SK', 'Slovakia'], ['TR', 'Turkey'], ['US', 'United States'], ['ZA', 'South Africa'],
]

// Reference lists used by trigger filters / DROPDOWN values. Exported via
// JSDoc enum strings on each trigger paramDef, kept here for grep-ability.
// eslint-disable-next-line no-unused-vars
const TRANSACTION_STATES = [
  'created',
  'pending',
  'completed',
  'declined',
  'failed',
  'reverted',
]
// eslint-disable-next-line no-unused-vars
const PAYOUT_LINK_STATES = [
  'created',
  'failed',
  'awaiting',
  'active',
  'expired',
  'cancelled',
  'processing',
  'processed',
]

// DROPDOWN friendly-label -> API-value maps. The UI shows the labels; #resolveChoice maps the
// selected label back to the value Revolut expects before it goes into a request/query or a filter.
const PROFILE_TYPE_MAP = { Personal: 'personal', Business: 'business' }

const PERIOD_MAP = {
  Today: 'today',
  Yesterday: 'yesterday',
  'Last 7 Days': 'last7Days',
  'Last 30 Days': 'last30Days',
  'Last 90 Days': 'last90Days',
  'This Month': 'thisMonth',
  'Last Month': 'lastMonth',
  'This Quarter': 'thisQuarter',
  'Last Quarter': 'lastQuarter',
  'This Year': 'thisYear',
  'Last Year': 'lastYear',
  'Year to Date': 'yearToDate',
  Custom: 'custom',
}

const TRANSACTION_TYPE_MAP = {
  ATM: 'atm',
  'Card Payment': 'card_payment',
  'Card Refund': 'card_refund',
  'Card Chargeback': 'card_chargeback',
  'Card Credit': 'card_credit',
  Exchange: 'exchange',
  Transfer: 'transfer',
  Loan: 'loan',
  Fee: 'fee',
  Refund: 'refund',
  'Top-Up': 'topup',
  Tax: 'tax',
  'Tax Refund': 'tax_refund',
}

const TRANSACTION_STATE_MAP = {
  Created: 'created',
  Pending: 'pending',
  Completed: 'completed',
  Declined: 'declined',
  Failed: 'failed',
  Reverted: 'reverted',
}

const PAYOUT_LINK_STATE_MAP = {
  Created: 'created',
  Failed: 'failed',
  Awaiting: 'awaiting',
  Active: 'active',
  Expired: 'expired',
  Cancelled: 'cancelled',
  Processing: 'processing',
  Processed: 'processed',
}

/**
 * @requireOAuth
 * @integrationName Revolut Business
 * @integrationIcon /icon.png
 * @integrationTriggersScope SINGLE_APP
 */
class RevolutBusinessService {
  constructor(config) {
    this.clientId = config.clientId
    this.privateKey = config.privateKey
    this.issuer = config.issuer || ''

    this.environment = (
      config.environment || ENVIRONMENT_PRODUCTION
    ).toLowerCase()

    const isSandbox = this.environment === ENVIRONMENT_SANDBOX

    this.apiBaseUrl = isSandbox ? SANDBOX_API_BASE : PRODUCTION_API_BASE

    this.apiV2BaseUrl = isSandbox
      ? SANDBOX_API_V2_BASE
      : PRODUCTION_API_V2_BASE

    this.authHost = isSandbox ? SANDBOX_AUTH_HOST : PRODUCTION_AUTH_HOST

    // Empty scope string – Revolut does not use OAuth scopes in the
    // authorization URL (security scopes are bound at registration on
    // the Revolut side based on the certificate). The harness still
    // uses `instance.scopes` for re-auth detection.
    this.scopes = ''
  }

  // =====================================================================================
  // #OAUTH — OAuth 2.0 system methods (JWT bearer client assertion)
  // =====================================================================================
  //
  // Flow:
  //   1. getOAuth2ConnectionURL builds a Revolut consent URL. Revolut
  //      redirects to redirectURI with ?code=... after the user accepts.
  //   2. executeCallback signs a JWT (RS256) with the private key, then
  //      POSTs /api/1.0/auth/token with grant_type=authorization_code +
  //      client_assertion. Result: {access_token, refresh_token, expires_in}.
  //      access_token expiry: 40 minutes. refresh_token: long-lived.
  //   3. refreshToken signs a fresh JWT and exchanges the refresh_token
  //      for a new access_token. Revolut does not rotate refresh tokens
  //      so we echo the input back.
  //
  // Issuer (iss) is the host of the redirect URI registered on the
  // Revolut side, captured at executeCallback time and re-derived on
  // refresh from the service-config `issuer` value. Users register this
  // host once in the Revolut Business app settings.

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   *
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    // FlowRunner OAuth platform appends `redirect_uri` and `state` before
    // redirecting the browser, so we omit both here to avoid duplicate params.
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
    })

    return `${ this.authHost }/app-confirm?${ params.toString() }`
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   * @property {String} token
   * @property {String} refreshToken
   * @property {Number} expirationInSeconds
   * @property {String} connectionIdentityName
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
    const issuer =
      this.issuer ||
      this.#deriveIssuerFromRedirect(callbackObject?.redirectURI)

    const tokenResponse = await this.#exchangeToken({
      grant_type: 'authorization_code',
      code: callbackObject.code,
      issuer,
    })

    return {
      token: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expirationInSeconds: tokenResponse.expires_in,
      connectionIdentityName: `Revolut Business (${ this.environment })`,
      overwrite: true,
    }
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   * @property {String} token
   * @property {Number} expirationInSeconds
   * @property {String} [refreshToken]
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
    const tokenResponse = await this.#exchangeToken({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      issuer: this.issuer,
    })

    return {
      token: tokenResponse.access_token,
      expirationInSeconds: tokenResponse.expires_in,
      // Revolut keeps the same refresh_token across refreshes; echo to
      // keep FlowRunner's cached value in sync.
      refreshToken: tokenResponse.refresh_token || refreshToken,
    }
  }

  // =====================================================================================
  // #HELPERS — Private helpers (auth, request, JWT)
  // =====================================================================================

  #getAccessToken() {
    return this.request.headers['oauth-access-token']
  }

  #authHeader() {
    return { Authorization: `Bearer ${ this.#getAccessToken() }` }
  }

  // Map a friendly DROPDOWN label back to the API value Revolut expects.
  // Passes through values that are not a known label (already an API value).
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #deriveIssuerFromRedirect(redirectUri) {
    if (!redirectUri) {
      throw new Error(
        'JWT Issuer host is missing. Either set "JWT Issuer" in the service configuration ' +
          'or pass redirectURI in the OAuth callback so the host can be derived.'
      )
    }

    try {
      return new URL(redirectUri).host
    } catch (error) {
      throw new Error(
        `Invalid redirect URI "${ redirectUri }" — cannot derive JWT issuer host.`
      )
    }
  }

  async #exchangeToken({ grant_type, code, refresh_token, issuer }) {
    const clientAssertion = signClientAssertion({
      clientId: this.clientId,
      issuer,
      privateKey: this.privateKey,
    })

    const body = new URLSearchParams({ grant_type })

    if (code) {
      body.append('code', code)
    }

    if (refresh_token) {
      body.append('refresh_token', refresh_token)
    }

    body.append('client_id', this.clientId)

    body.append(
      'client_assertion_type',
      'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'
    )

    body.append('client_assertion', clientAssertion)

    try {
      return await Flowrunner.Request.post(`${ this.apiBaseUrl }/auth/token`)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(body.toString())
    } catch (error) {
      throw wrapApiError(error, `tokenExchange:${ grant_type }`)
    }
  }

  async #api({ url, method, body, query, logTag }) {
    return apiRequest({
      url,
      method,
      body,
      query,
      headers: { ...this.#authHeader(), 'Content-Type': 'application/json' },
      logTag,
    })
  }

  // =====================================================================================
  // #DICTIONARIES
  // =====================================================================================

  /**
   * @typedef {Object} DictionaryItem
   * @property {String} label
   * @property {String} value
   * @property {String} note
   */

  /**
   * @typedef {Object} DictionaryResponse
   * @property {Array<DictionaryItem>} items
   * @property {String} cursor
   */

  /**
   * @typedef {Object} getAccountsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter accounts by name or currency. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token. Revolut returns the full account list in one call, so this is reserved for future use."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Accounts
   * @description Returns the Revolut Business accounts available to the connected profile, with each account's name, balance, and currency. Used in dropdowns to pick the source account for transfers, payments, exchanges, and balance checks.
   *
   * @route POST /get-accounts-dictionary
   *
   * @paramDef {"type":"getAccountsDictionary__payload","label":"Payload","name":"payload","description":"Optional search and pagination cursor for the account picker."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Main GBP · £4,512.30","value":"f1234567-1111-2222-3333-444455556666","note":"GBP · active"},{"label":"USD Holding · $12,000.00","value":"a7654321-aaaa-bbbb-cccc-ddddeeee0000","note":"USD · active"}],"cursor":null}
   */
  async getAccountsDictionary(payload) {
    const { search } = payload || {}

    const accounts = await this.#api({
      logTag: 'getAccountsDictionary',
      url: `${ this.apiBaseUrl }/accounts`,
    })

    const filtered = searchFilter(accounts || [], ['name', 'currency'], search)

    return {
      items: filtered.map(account => ({
        label: `${ account.name || account.id } · ${ formatBalance(account.balance, account.currency) }`,
        value: account.id,
        note: `${ account.currency } · ${ account.state || 'active' }`,
      })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getCounterpartiesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter counterparties by name, email, or phone. Performed locally."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token (created_at of the last item from the previous page)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Counterparties
   * @description Returns the saved counterparties (payment recipients) for the connected Revolut Business profile. Used in dropdowns to pick a recipient for Make Payment or Create Payment Draft without re-entering bank details.
   *
   * @route POST /get-counterparties-dictionary
   *
   * @paramDef {"type":"getCounterpartiesDictionary__payload","label":"Payload","name":"payload","description":"Optional search and pagination cursor for the counterparty picker."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Acme Ltd","value":"01234567-89ab-cdef-0123-456789abcdef","note":"GB · revolut · counterparty_id 01234567"},{"label":"John Doe","value":"abcdef01-2345-6789-abcd-ef0123456789","note":"US · external · counterparty_id abcdef01"}],"cursor":"2026-04-15T08:30:00Z"}
   */
  async getCounterpartiesDictionary(payload) {
    const { search, cursor } = payload || {}

    const counterparties = await this.#api({
      logTag: 'getCounterpartiesDictionary',
      url: `${ this.apiBaseUrl }/counterparties`,
      query: { limit: DEFAULT_LIMIT, created_before: cursor },
    })

    const filtered = searchFilter(
      counterparties || [],
      ['name', 'email', 'phone', 'company_name'],
      search
    )
    const nextCursor =
      counterparties?.length === DEFAULT_LIMIT
        ? counterparties[counterparties.length - 1].created_at
        : null

    return {
      items: filtered.map(cp => ({
        label: cp.name || cp.company_name || cp.id,
        value: cp.id,
        note: `${ cp.country || 'n/a' } · ${ cp.profile_type || 'external' } · ${ cp.id.slice(0, 8) }`,
      })),
      cursor: nextCursor,
    }
  }

  /**
   * @typedef {Object} getCurrenciesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter currencies by their three-letter code (e.g. type 'GB' to find GBP)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Unused — the currency list is static and returned in a single page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Currencies
   * @description Returns the three-letter currency codes (GBP, EUR, USD, and so on) most commonly used in Revolut Business. Use to pick a currency when sending payments, exchanging money, or adding a counterparty.
   *
   * @route POST /get-currencies-dictionary
   *
   * @paramDef {"type":"getCurrenciesDictionary__payload","label":"Payload","name":"payload","description":"Optional search string for filtering the static currency list."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"GBP","value":"GBP","note":"British Pound"},{"label":"EUR","value":"EUR","note":"Euro"},{"label":"USD","value":"USD","note":"US Dollar"}],"cursor":null}
   */
  async getCurrenciesDictionary(payload) {
    const { search } = payload || {}

    const filtered = search
      ? SUPPORTED_CURRENCIES.filter(code =>
        code.toLowerCase().includes(String(search).toLowerCase())
      )
      : SUPPORTED_CURRENCIES

    return {
      items: filtered.map(code => ({ label: code, value: code, note: code })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getCountriesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter countries by ISO code or English name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Unused — the country list is static and returned in a single page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Countries
   * @description Returns two-letter country codes (GB, US, DE, and so on) commonly used for counterparty banks and addresses on Revolut Business. Use to pick the recipient's country when adding a counterparty — the picker shows the full country name so you do not need to remember the codes.
   *
   * @route POST /get-countries-dictionary
   *
   * @paramDef {"type":"getCountriesDictionary__payload","label":"Payload","name":"payload","description":"Optional search string for filtering the static country list."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"United Kingdom","value":"GB","note":"GB"},{"label":"United States","value":"US","note":"US"},{"label":"Germany","value":"DE","note":"DE"}],"cursor":null}
   */
  async getCountriesDictionary(payload) {
    const { search } = payload || {}
    const needle = search ? String(search).toLowerCase() : ''

    const filtered = needle
      ? SUPPORTED_COUNTRIES.filter(
        ([code, name]) =>
          code.toLowerCase().includes(needle) || name.toLowerCase().includes(needle)
      )
      : SUPPORTED_COUNTRIES

    return {
      items: filtered.map(([code, name]) => ({ label: name, value: code, note: code })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getTransactionsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter the recent transactions by reference, type, or state. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token (created_at of the last item from the previous page)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Transactions
   * @description Returns the most recent transactions on the connected Revolut Business profile so a specific one can be picked from a list instead of pasting its ID. Used in dropdowns to choose a transaction for Get Transaction or Cancel Transaction.
   *
   * @route POST /get-transactions-dictionary
   *
   * @paramDef {"type":"getTransactionsDictionary__payload","label":"Payload","name":"payload","description":"Optional search and pagination cursor for the transaction picker."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Invoice 1234 · completed","value":"abcd","note":"transfer · 2026-05-15"}],"cursor":null}
   */
  async getTransactionsDictionary(payload) {
    const { search, cursor } = payload || {}

    const transactions = await this.#api({
      logTag: 'getTransactionsDictionary',
      url: `${ this.apiBaseUrl }/transactions`,
      query: { count: DEFAULT_LIMIT, to: cursor },
    })

    const filtered = searchFilter(
      transactions || [],
      ['reference', 'type', 'state', 'id'],
      search
    )

    return {
      items: filtered.map(tx => {
        const base = tx.reference || tx.type || tx.id

        return {
          label: tx.state ? `${ base } · ${ tx.state }` : base,
          value: tx.id,
          note: `${ tx.type || 'transaction' } · ${ (tx.created_at || '').slice(0, 10) }`,
        }
      }),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getPaymentDraftsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter payment drafts by title. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Unused — Revolut returns the full payment-draft list in one call, so this is reserved for future use."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Payment Drafts
   * @description Returns the payment drafts on the connected Revolut Business profile so a specific draft can be picked from a list instead of pasting its ID. Used in dropdowns to choose a draft for Get Payment Draft or Delete Payment Draft.
   *
   * @route POST /get-payment-drafts-dictionary
   *
   * @paramDef {"type":"getPaymentDraftsDictionary__payload","label":"Payload","name":"payload","description":"Optional search string for the payment-draft picker."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"June payroll","value":"draft-1","note":"2026-06-01"}],"cursor":null}
   */
  async getPaymentDraftsDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#api({
      logTag: 'getPaymentDraftsDictionary',
      url: `${ this.apiBaseUrl }/payment-drafts`,
    })

    const filtered = searchFilter(
      response?.payment_orders || [],
      ['title', 'id'],
      search
    )

    return {
      items: filtered.map(draft => ({
        label: draft.title || draft.id,
        value: draft.id,
        note: draft.scheduled_for || 'draft',
      })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getPayoutLinksDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter payout links by recipient name, reference, or state. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token (created_at of the last item from the previous page)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Payout Links
   * @description Returns the payout links on the connected Revolut Business profile so a specific link can be picked from a list instead of pasting its ID. Used in dropdowns to choose a link for Get Payout Link or Cancel Payout Link.
   *
   * @route POST /get-payout-links-dictionary
   *
   * @paramDef {"type":"getPayoutLinksDictionary__payload","label":"Payload","name":"payload","description":"Optional search and pagination cursor for the payout-link picker."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"John Doe · £50.00","value":"po-1","note":"active"}],"cursor":null}
   */
  async getPayoutLinksDictionary(payload) {
    const { search, cursor } = payload || {}

    const links = await this.#api({
      logTag: 'getPayoutLinksDictionary',
      url: `${ this.apiBaseUrl }/payout-links`,
      query: { limit: DEFAULT_LIMIT, created_before: cursor },
    })

    const filtered = searchFilter(
      links || [],
      ['counterparty_name', 'reference', 'state', 'id'],
      search
    )

    return {
      items: filtered.map(link => {
        const base = link.counterparty_name || link.reference || link.id
        const amount = link.amount != null ? formatBalance(link.amount, link.currency) : ''

        return {
          label: amount ? `${ base } · ${ amount }` : base,
          value: link.id,
          note: link.state || 'active',
        }
      }),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getWebhooksDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter webhooks by URL or state. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Unused — Revolut returns the full webhook list in one call, so this is reserved for future use."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Webhooks
   * @description Returns the webhook subscriptions on the connected Revolut Business profile so a specific one can be picked from a list instead of pasting its ID. Used in dropdowns to choose a webhook for Get Webhook, Update Webhook, Delete Webhook, Rotate Webhook Signing Secret, or List Failed Webhook Events.
   *
   * @route POST /get-webhooks-dictionary
   *
   * @paramDef {"type":"getWebhooksDictionary__payload","label":"Payload","name":"payload","description":"Optional search string for the webhook picker."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"https://example.com/hook","value":"wh-1","note":"enabled"}],"cursor":null}
   */
  async getWebhooksDictionary(payload) {
    const { search } = payload || {}

    const webhooks = await this.#api({
      logTag: 'getWebhooksDictionary',
      url: `${ this.apiV2BaseUrl }/webhooks`,
    })

    const filtered = searchFilter(webhooks || [], ['url', 'state', 'id'], search)

    return {
      items: filtered.map(webhook => ({
        label: webhook.url || webhook.id,
        value: webhook.id,
        note: webhook.state || 'enabled',
      })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getCounterpartyAccountsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Counterparty","name":"counterpartyId","required":true,"description":"The counterparty whose accounts to list."}
   */

  /**
   * @typedef {Object} getCounterpartyAccountsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter the counterparty's accounts by currency or type. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"getCounterpartyAccountsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies which counterparty's accounts to list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Counterparty Accounts
   * @description Returns the bank accounts saved on one counterparty so a specific account can be picked when the recipient has more than one on file. Used by Make Payment to select which of the recipient's accounts to pay.
   *
   * @route POST /get-counterparty-accounts-dictionary
   *
   * @paramDef {"type":"getCounterpartyAccountsDictionary__payload","label":"Payload","name":"payload","description":"The counterparty to read accounts from, plus an optional search string."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"GBP revolut ··0000","value":"d1","note":"GBP"}],"cursor":null}
   */
  async getCounterpartyAccountsDictionary(payload) {
    const { search, criteria } = payload || {}
    const counterpartyId = criteria && criteria.counterpartyId

    if (!counterpartyId) {
      return { items: [], cursor: null }
    }

    const counterparty = await this.#api({
      logTag: 'getCounterpartyAccountsDictionary',
      url: `${ this.apiBaseUrl }/counterparty/${ encodeURIComponent(counterpartyId) }`,
    })

    const filtered = searchFilter(
      counterparty?.accounts || [],
      ['currency', 'type', 'account_no'],
      search
    )

    return {
      items: filtered.map(account => {
        const tail = account.account_no
          ? ` ··${ String(account.account_no).slice(-4) }`
          : ''

        return {
          label: `${ account.currency || '' } ${ account.type || 'account' }${ tail }`.trim(),
          value: account.id,
          note: account.currency || account.type || '',
        }
      }),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getCounterpartyCardsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Counterparty","name":"counterpartyId","required":true,"description":"The counterparty whose cards to list."}
   */

  /**
   * @typedef {Object} getCounterpartyCardsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter the counterparty's cards by brand or last digits. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"getCounterpartyCardsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies which counterparty's cards to list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Counterparty Cards
   * @description Returns the cards saved on one counterparty so a specific card can be picked when paying a card instead of a bank account. Used by Make Payment to select which of the recipient's cards to pay.
   *
   * @route POST /get-counterparty-cards-dictionary
   *
   * @paramDef {"type":"getCounterpartyCardsDictionary__payload","label":"Payload","name":"payload","description":"The counterparty to read cards from, plus an optional search string."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"VISA ··4242","value":"card-1","note":"GB"}],"cursor":null}
   */
  async getCounterpartyCardsDictionary(payload) {
    const { search, criteria } = payload || {}
    const counterpartyId = criteria && criteria.counterpartyId

    if (!counterpartyId) {
      return { items: [], cursor: null }
    }

    const counterparty = await this.#api({
      logTag: 'getCounterpartyCardsDictionary',
      url: `${ this.apiBaseUrl }/counterparty/${ encodeURIComponent(counterpartyId) }`,
    })

    const filtered = searchFilter(
      counterparty?.cards || [],
      ['scheme', 'last_digits'],
      search
    )

    return {
      items: filtered.map(card => ({
        label: `${ card.scheme || 'Card' } ··${ card.last_digits || '' }`.trim(),
        value: card.id,
        note: card.country || '',
      })),
      cursor: null,
    }
  }

  // =====================================================================================
  // #ACCOUNTS
  // =====================================================================================

  /**
   * @operationName List Accounts
   * @category Accounts
   * @description Returns every Revolut Business account on the connected profile, with the current balance, currency, and whether the account is active. Use this to look up your accounts, check balances across currencies, or feed downstream cash-flow workflows.
   *
   * @route POST /list-accounts
   * @appearanceColor #0666EB #2C7BE5
   * @requiredOauth2Scopes READ
   *
   * @returns {Array.<Object>}
   * @sampleResult [{"id":"f1234567-1111-2222-3333-444455556666","name":"Main GBP","balance":4512.3,"currency":"GBP","state":"active","public":false,"created_at":"2024-03-20T11:04:12.123Z","updated_at":"2026-05-12T09:00:00.000Z"}]
   */
  async listAccounts() {
    return this.#api({
      logTag: 'listAccounts',
      url: `${ this.apiBaseUrl }/accounts`,
    })
  }

  /**
   * @operationName Get Account
   * @category Accounts
   * @description Looks up one of your Revolut Business accounts and returns its current balance, currency, and status. Use this when you need an up-to-date balance before sending a payment, or when checking the state of a specific account.
   *
   * @route POST /get-account
   * @appearanceColor #0666EB #2C7BE5
   * @requiredOauth2Scopes READ
   *
   * @paramDef {"type":"String","label":"Account","name":"accountId","required":true,"dictionary":"getAccountsDictionary","description":"The Revolut Business account to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"f1234567-1111-2222-3333-444455556666","name":"Main GBP","balance":4512.3,"currency":"GBP","state":"active","public":false,"created_at":"2024-03-20T11:04:12.123Z","updated_at":"2026-05-12T09:00:00.000Z"}
   */
  async getAccount(accountId) {
    return this.#api({
      logTag: 'getAccount',
      url: `${ this.apiBaseUrl }/accounts/${ encodeURIComponent(accountId) }`,
    })
  }

  /**
   * @operationName Get Account Bank Details
   * @category Accounts
   * @description Returns the receiving bank details for one of your Revolut Business accounts — account number, sort code, IBAN, BIC, and the supported payment networks. Use this when you need to share your details with someone who is paying you, attach them to an invoice, or onboard a new payer.
   *
   * @route POST /get-account-bank-details
   * @appearanceColor #0666EB #2C7BE5
   * @requiredOauth2Scopes READ
   *
   * @paramDef {"type":"String","label":"Account","name":"accountId","required":true,"dictionary":"getAccountsDictionary","description":"The account whose receiving bank details to fetch."}
   *
   * @returns {Array.<Object>}
   * @sampleResult [{"iban":"GB00REVO00000000000000","bic":"REVOGB21","bank_country":"GB","pooled":false,"unique_reference":"REVO123","schemes":["swift","sepa","faster_payments"]}]
   */
  async getAccountBankDetails(accountId) {
    return this.#api({
      logTag: 'getAccountBankDetails',
      url: `${ this.apiBaseUrl }/accounts/${ encodeURIComponent(accountId) }/bank-details`,
    })
  }

  // =====================================================================================
  // #COUNTERPARTIES
  // =====================================================================================

  /**
   * @operationName List Counterparties
   * @category Counterparties
   * @description Returns saved counterparties (payment recipients) on the connected profile. Use to review your recipient list, find a counterparty before sending a payment, or copy recipients into a CRM. Older results are read by passing the creation date of the last item you saw into Created Before.
   *
   * @route POST /list-counterparties
   * @appearanceColor #0666EB #2C7BE5
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes READ
   *
   * @paramDef {"type":"String","label":"Name Filter","name":"name","description":"Optional. Filter counterparties whose name contains this string."}
   * @paramDef {"type":"String","label":"Account Number","name":"accountNo","description":"Optional. Filter by destination account number."}
   * @paramDef {"type":"String","label":"Sort Code","name":"sortCode","description":"Optional. Filter by UK sort code."}
   * @paramDef {"type":"String","label":"IBAN","name":"iban","description":"Optional. Filter by IBAN."}
   * @paramDef {"type":"String","label":"BIC","name":"bic","description":"Optional. Filter by BIC/SWIFT code."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of counterparties to return per page. Default 100, maximum 100."}
   * @paramDef {"type":"String","label":"Created Before","name":"createdBefore","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return counterparties added before this date and time. To page through older counterparties, pass the creation date of the last item from the previous page."}
   *
   * @returns {Array.<Object>}
   * @sampleResult [{"id":"01234567-89ab-cdef-0123-456789abcdef","name":"Acme Ltd","profile_type":"business","country":"GB","state":"created","created_at":"2026-04-12T08:30:00Z","accounts":[{"id":"abc","currency":"GBP","type":"revolut"}]}]
   */
  async listCounterparties(
    name,
    accountNo,
    sortCode,
    iban,
    bic,
    limit,
    createdBefore
  ) {
    return this.#api({
      logTag: 'listCounterparties',
      url: `${ this.apiBaseUrl }/counterparties`,
      query: {
        name,
        account_no: accountNo,
        sort_code: sortCode,
        iban,
        bic,
        limit: limit || DEFAULT_LIMIT,
        created_before: createdBefore,
      },
    })
  }

  /**
   * @operationName Get Counterparty
   * @category Counterparties
   * @description Looks up one saved counterparty (recipient), including every bank account or card linked to them. Use this to double-check payment details before sending money, or to show the recipient's details inside your own app.
   *
   * @route POST /get-counterparty
   * @appearanceColor #0666EB #2C7BE5
   * @requiredOauth2Scopes READ
   *
   * @paramDef {"type":"String","label":"Counterparty","name":"counterpartyId","required":true,"dictionary":"getCounterpartiesDictionary","description":"The counterparty to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"01234567-89ab-cdef-0123-456789abcdef","name":"Acme Ltd","profile_type":"business","country":"GB","state":"created","created_at":"2026-04-12T08:30:00Z","accounts":[{"id":"d1","currency":"GBP","type":"revolut","account_no":"00000000","sort_code":"000000"}]}
   */
  async getCounterparty(counterpartyId) {
    return this.#api({
      logTag: 'getCounterparty',
      url: `${ this.apiBaseUrl }/counterparty/${ encodeURIComponent(counterpartyId) }`,
    })
  }

  /**
   * @operationName Create Counterparty
   * @category Counterparties
   * @description Saves a new payment recipient so future payments can reference it by ID instead of re-entering bank details. There are three pathways — pick the one that matches your recipient and leave the other fields empty:
   * (1) Revolut-to-Revolut: set Revolut Username, Email, or Phone (no bank fields).
   * (2) UK bank: set Profile Type, Name (or Company Name), Bank Country = GB, Currency, Account Number, Sort Code.
   * (3) International bank: set Profile Type, Name (or Company Name), Bank Country, Currency, plus either IBAN+BIC (SEPA/SWIFT) or Account Number+Routing Number (US ABA). US and some SWIFT destinations also require the address fields.
   *
   * @route POST /create-counterparty
   * @appearanceColor #0666EB #2C7BE5
   * @requiredOauth2Scopes WRITE
   *
   * @paramDef {"type":"String","label":"Profile Type","name":"profileType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Personal","Business"]}},"description":"Pick 'business' for a company recipient (uses Company Name) or 'personal' for an individual (uses Name). Required for all three pathways."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Full name of an individual recipient. Required when Profile Type is 'personal' and you are paying a bank account. Skip for business counterparties (use Company Name instead) and for Revolut-handle lookups."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"Trading name of a business recipient. Required when Profile Type is 'business' and you are paying a bank account."}
   * @paramDef {"type":"String","label":"Revolut Username","name":"revtag","description":"Pathway 1 only. Revolut @handle of a Revolut user (e.g. 'johndoe'). Mutually exclusive with Email, Phone, and all bank fields."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Pathway 1 only. Email of an existing Revolut personal user. Mutually exclusive with Revolut Username, Phone, and all bank fields."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Pathway 1 only. Phone number of an existing Revolut personal user, in international format with the country code (for example +447700900123). Leave the Revolut Username, Email, and all bank fields empty when using this."}
   * @paramDef {"type":"String","label":"Bank Country","name":"bankCountry","dictionary":"getCountriesDictionary","description":"Country where the recipient's bank is located. Required for UK and international bank payments. The picker lists country names so you do not need to remember the two-letter codes."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","dictionary":"getCurrenciesDictionary","description":"Currency the recipient is paid in (for example GBP, EUR, USD). Required for UK and international bank payments."}
   * @paramDef {"type":"String","label":"Account Number","name":"accountNo","description":"Pathways 2 and 3. Recipient's local bank account number (8 digits for UK, varies for US/other)."}
   * @paramDef {"type":"String","label":"Sort Code","name":"sortCode","description":"Pathway 2 only. UK sort code (6 digits, e.g. 123456). Required when Bank Country is GB."}
   * @paramDef {"type":"String","label":"Routing Number","name":"routingNumber","description":"Pathway 3 only. US bank routing number (ABA, 9 digits). Required when Bank Country is US."}
   * @paramDef {"type":"String","label":"IBAN","name":"iban","description":"Pathway 3 only. IBAN for SEPA/SWIFT recipients (e.g. DE89370400440532013000). Required for most EU recipients."}
   * @paramDef {"type":"String","label":"BIC","name":"bic","description":"Pathway 3 only. BIC/SWIFT code (8 or 11 characters). Required alongside IBAN for SWIFT and some SEPA recipients."}
   * @paramDef {"type":"String","label":"Address Line 1","name":"addressLine1","description":"Required by US ABA transfers and most SWIFT corridors. Recipient street address line 1."}
   * @paramDef {"type":"String","label":"Address Line 2","name":"addressLine2","description":"Recipient address line 2 (apartment / suite)."}
   * @paramDef {"type":"String","label":"Address Region","name":"addressRegion","description":"Recipient state, province, or region (e.g. 'CA' for California, 'NY' for New York)."}
   * @paramDef {"type":"String","label":"Address City","name":"addressCity","description":"Recipient city."}
   * @paramDef {"type":"String","label":"Address Country","name":"addressCountry","dictionary":"getCountriesDictionary","description":"Country on the recipient's mailing address. Usually the same country as the recipient's bank."}
   * @paramDef {"type":"String","label":"Address Postcode","name":"addressPostcode","description":"Recipient postal / ZIP code."}
   *
   * @returns {Object}
   * @sampleResult {"id":"01234567-89ab-cdef-0123-456789abcdef","name":"Acme Ltd","profile_type":"business","country":"GB","state":"created","created_at":"2026-05-16T10:00:00Z","accounts":[{"id":"d1","currency":"GBP","type":"external","account_no":"00012345","sort_code":"123456"}]}
   */
  async createCounterparty(
    profileType,
    name,
    companyName,
    revtag,
    email,
    phone,
    bankCountry,
    currency,
    accountNo,
    sortCode,
    routingNumber,
    iban,
    bic,
    addressLine1,
    addressLine2,
    addressRegion,
    addressCity,
    addressCountry,
    addressPostcode
  ) {
    profileType = this.#resolveChoice(profileType, PROFILE_TYPE_MAP)

    const address = clean({
      street_line1: addressLine1,
      street_line2: addressLine2,
      region: addressRegion,
      city: addressCity,
      country: addressCountry,
      postcode: addressPostcode,
    })

    const body = clean({
      profile_type: profileType,
      name,
      company_name: companyName,
      revtag,
      email,
      phone,
      bank_country: bankCountry,
      currency,
      account_no: accountNo,
      sort_code: sortCode,
      routing_number: routingNumber,
      iban,
      bic,
      address: Object.keys(address).length ? address : undefined,
    })

    return this.#api({
      logTag: 'createCounterparty',
      method: 'post',
      url: `${ this.apiBaseUrl }/counterparty`,
      body,
    })
  }

  /**
   * @operationName Delete Counterparty
   * @category Counterparties
   * @description Removes a saved counterparty (recipient) from your Revolut Business profile. Payments already in flight to this recipient are not affected. Use this to keep your recipient list tidy, or to stop someone from being paid in future.
   *
   * @route POST /delete-counterparty
   * @appearanceColor #DC2626 #F87171
   * @requiredOauth2Scopes WRITE
   *
   * @paramDef {"type":"String","label":"Counterparty","name":"counterpartyId","required":true,"dictionary":"getCounterpartiesDictionary","description":"The counterparty to delete."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":"01234567-89ab-cdef-0123-456789abcdef"}
   */
  async deleteCounterparty(counterpartyId) {
    await this.#api({
      logTag: 'deleteCounterparty',
      method: 'delete',
      url: `${ this.apiBaseUrl }/counterparty/${ encodeURIComponent(counterpartyId) }`,
    })

    return { deleted: true, id: counterpartyId }
  }

  /**
   * @operationName Validate Account Name (UK Confirmation of Payee)
   * @category Counterparties
   * @description Asks the recipient's UK bank to confirm that the account number and sort code really belong to the person or business you expect — without saving a counterparty. Use this before sending a UK payment to reduce the risk of paying the wrong account or being tricked into paying a scammer. UK only.
   *
   * @route POST /validate-account-name
   * @appearanceColor #0666EB #2C7BE5
   * @requiredOauth2Scopes WRITE
   *
   * @paramDef {"type":"String","label":"Account Number","name":"accountNo","required":true,"description":"UK account number (8 digits)."}
   * @paramDef {"type":"String","label":"Sort Code","name":"sortCode","required":true,"description":"UK sort code (6 digits)."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"Provide when verifying a business account."}
   * @paramDef {"type":"String","label":"Individual First Name","name":"firstName","description":"Provide when verifying a personal account."}
   * @paramDef {"type":"String","label":"Individual Last Name","name":"lastName","description":"Provide when verifying a personal account."}
   *
   * @returns {Object}
   * @sampleResult {"result_code":"close_match","reason":"name_does_not_match","matched_name":"Acme Limited"}
   */
  async validateAccountName(
    accountNo,
    sortCode,
    companyName,
    firstName,
    lastName
  ) {
    const body = clean({
      account_no: accountNo,
      sort_code: sortCode,
      company_name: companyName,
      individual_name:
        firstName || lastName
          ? clean({ first_name: firstName, last_name: lastName })
          : undefined,
    })

    return this.#api({
      logTag: 'validateAccountName',
      method: 'post',
      url: `${ this.apiBaseUrl }/account-name-validation`,
      body,
    })
  }

  // =====================================================================================
  // #TRANSACTIONS
  // =====================================================================================

  /**
   * @operationName List Transactions
   * @category Transactions
   * @description Returns transactions, newest first, with filters for date range, counterparty, account, and type. Use this to build finance dashboards, generate statements, reconcile invoices, or copy transactions into accounting tools. Pick a Period preset (for example "last30Days") to filter by date in one click, or fill in From and To for a custom window. Turn on Fetch All to read every page automatically up to the safety cap.
   *
   * @route POST /list-transactions
   * @appearanceColor #0666EB #2C7BE5
   * @executionTimeoutInSeconds 300
   * @requiredOauth2Scopes READ
   *
   * @paramDef {"type":"String","label":"Period","name":"period","uiComponent":{"type":"DROPDOWN","options":{"values":["Today","Yesterday","Last 7 Days","Last 30 Days","Last 90 Days","This Month","Last Month","This Quarter","Last Quarter","This Year","Last Year","Year to Date","Custom"]}},"description":"Convenience preset that auto-fills From / To. Choose 'custom' (or leave empty) to set From / To manually. Examples: 'last30Days' for the rolling last month, 'thisMonth' for the calendar month."}
   * @paramDef {"type":"String","label":"From","name":"from","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Earliest date and time to include (the result starts here). Used only when Period is empty or 'custom'."}
   * @paramDef {"type":"String","label":"To","name":"to","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Latest date and time to include (the result stops just before this). Used only when Period is empty or 'custom'."}
   * @paramDef {"type":"String","label":"Counterparty","name":"counterpartyId","dictionary":"getCounterpartiesDictionary","description":"Optional. Only return transactions involving this saved counterparty."}
   * @paramDef {"type":"String","label":"Account","name":"accountId","dictionary":"getAccountsDictionary","description":"Optional. Only return transactions that affect this account."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["ATM","Card Payment","Card Refund","Card Chargeback","Card Credit","Exchange","Transfer","Loan","Fee","Refund","Top-Up","Tax","Tax Refund"]}},"description":"Optional. Only return transactions of this type (e.g. 'card_payment' for card spending, 'exchange' for currency conversion)."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of transactions to return per page. Default 100, maximum 1000. Ignored when Fetch All is true."}
   * @paramDef {"type":"Boolean","label":"Fetch All","name":"fetchAll","uiComponent":{"type":"TOGGLE"},"description":"When true, follow Revolut's pagination automatically and return every transaction in the window up to Max Total. When false (default), return only the first page."}
   * @paramDef {"type":"Number","label":"Max Total","name":"maxTotal","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Safety cap when Fetch All is true (default 5000). Stops paginating once this many transactions have been collected to protect against runaway result sets."}
   *
   * @returns {Array.<Object>}
   * @sampleResult [{"id":"abcd","type":"transfer","request_id":"req-1","state":"completed","reason_code":null,"created_at":"2026-05-15T09:30:00Z","completed_at":"2026-05-15T09:30:01Z","reference":"Invoice 1234","legs":[{"leg_id":"l1","account_id":"f12","amount":-100,"currency":"GBP","description":"Payment to Acme Ltd","counterparty":{"id":"01234567","account_id":"d1"}}]}]
   */
  async listTransactions(
    period,
    from,
    to,
    counterpartyId,
    accountId,
    type,
    count,
    fetchAll,
    maxTotal
  ) {
    period = this.#resolveChoice(period, PERIOD_MAP)
    type = this.#resolveChoice(type, TRANSACTION_TYPE_MAP)

    const window = resolvePeriod(period, from, to)
    const pageSize = Math.min(
      Number(count) || DEFAULT_LIMIT,
      MAX_TRANSACTIONS_PER_REQUEST
    )
    const cap = Math.max(Number(maxTotal) || 5000, pageSize)

    const baseQuery = {
      from: window.from,
      counterparty: counterpartyId,
      account: accountId,
      type,
      count: pageSize,
    }

    if (!fetchAll) {
      return this.#api({
        logTag: 'listTransactions',
        url: `${ this.apiBaseUrl }/transactions`,
        query: { ...baseQuery, to: window.to },
      })
    }

    // Revolut paginates by passing the oldest seen created_at as the new `to`.
    const collected = []
    let cursor = window.to

    while (collected.length < cap) {
      const page = await this.#api({
        logTag: 'listTransactions:page',
        url: `${ this.apiBaseUrl }/transactions`,
        query: { ...baseQuery, to: cursor },
      })

      if (!Array.isArray(page) || page.length === 0) {
        break
      }

      collected.push(...page)

      if (page.length < pageSize) {
        break
      }

      cursor = page[page.length - 1].created_at
    }

    return collected.slice(0, cap)
  }

  /**
   * @operationName Get Transaction
   * @category Transactions
   * @description Looks up one transaction by its Revolut ID and returns its current status, amount, currency, counterparty, and every side of the movement (called "legs" by Revolut, for example a debit leg and a credit leg in a currency exchange). Use this to check a payment's status, reconcile a specific transaction, or follow up after a trigger fires.
   *
   * @route POST /get-transaction
   * @appearanceColor #0666EB #2C7BE5
   * @requiredOauth2Scopes READ
   *
   * @paramDef {"type":"String","label":"Transaction","name":"transactionId","required":true,"dictionary":"getTransactionsDictionary","description":"The transaction to retrieve. Pick from recent transactions, or paste an ID returned by Make Payment or a webhook event."}
   *
   * @returns {Object}
   * @sampleResult {"id":"abcd","type":"transfer","request_id":"req-1","state":"completed","created_at":"2026-05-15T09:30:00Z","completed_at":"2026-05-15T09:30:01Z","reference":"Invoice 1234","legs":[{"leg_id":"l1","account_id":"f12","amount":-100,"currency":"GBP","counterparty":{"id":"01234567"}}]}
   */
  async getTransaction(transactionId) {
    return this.#api({
      logTag: 'getTransaction',
      url: `${ this.apiBaseUrl }/transaction/${ encodeURIComponent(transactionId) }`,
    })
  }

  /**
   * @operationName Get Transaction By Request ID
   * @category Transactions
   * @description Looks up a transaction by the Request ID you supplied when sending the payment (the safe-retry tag, not Revolut's transaction ID). Use this when a payment call timed out and you need to check whether the payment actually went through.
   *
   * @route POST /get-transaction-by-request-id
   * @appearanceColor #0666EB #2C7BE5
   * @requiredOauth2Scopes READ
   *
   * @paramDef {"type":"String","label":"Request ID","name":"requestId","required":true,"freeform":true,"description":"The Request ID you supplied when creating the payment (the safe-retry tag, not the Revolut transaction ID). No picker is offered — this is a value you chose yourself, so Revolut has no list to pick it from."}
   *
   * @returns {Object}
   * @sampleResult {"id":"abcd","type":"transfer","request_id":"req-1","state":"completed","created_at":"2026-05-15T09:30:00Z","legs":[]}
   */
  async getTransactionByRequestId(requestId) {
    return this.#api({
      logTag: 'getTransactionByRequestId',
      url: `${ this.apiBaseUrl }/transaction/${ encodeURIComponent(requestId) }`,
      query: { id_type: 'request_id' },
    })
  }

  /**
   * @operationName Cancel Transaction
   * @category Transactions
   * @description Cancels a transaction that hasn't gone through yet — for example a payment scheduled for a future date, or one waiting for someone to approve it in the Revolut Business app. Already-completed transactions cannot be cancelled (use Make Payment in reverse if you need to refund money).
   *
   * @route POST /cancel-transaction
   * @appearanceColor #DC2626 #F87171
   * @requiredOauth2Scopes PAY
   *
   * @paramDef {"type":"String","label":"Transaction","name":"transactionId","required":true,"dictionary":"getTransactionsDictionary","description":"The transaction to cancel. Pick from recent transactions, or paste the Revolut transaction ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":"abcd","cancelled":true}
   */
  async cancelTransaction(transactionId) {
    await this.#api({
      logTag: 'cancelTransaction',
      method: 'post',
      url: `${ this.apiBaseUrl }/transaction/${ encodeURIComponent(transactionId) }/cancel`,
    })

    return { id: transactionId, cancelled: true }
  }

  // =====================================================================================
  // #TRANSFERS — Internal transfers + external payments
  // =====================================================================================

  /**
   * @operationName Transfer Between Own Accounts
   * @category Transfers
   * @description Moves money between two accounts on the same Revolut Business profile (for example between your "Main GBP" and "Holding GBP" accounts). Both accounts must be in the same currency — to swap currencies use Exchange Money instead. Safe to retry: pass the same Request ID and the transfer will not be duplicated.
   *
   * @route POST /transfer-between-accounts
   * @appearanceColor #0666EB #2C7BE5
   * @requiredOauth2Scopes PAY
   *
   * @paramDef {"type":"String","label":"Source Account","name":"sourceAccountId","required":true,"dictionary":"getAccountsDictionary","description":"Account the money is debited from."}
   * @paramDef {"type":"String","label":"Target Account","name":"targetAccountId","required":true,"dictionary":"getAccountsDictionary","description":"Account the money is credited to. Must be in the same currency as the source."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Amount to transfer in the account currency, in major units (e.g. 25.50 for £25.50)."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","required":true,"dictionary":"getCurrenciesDictionary","description":"Currency of the transfer (for example GBP). Must match the currency of both the source and target accounts."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"Free-text description shown on the transaction in both accounts (max 100 characters). Examples: 'Internal sweep', 'GBP to USD top-up'."}
   * @paramDef {"type":"String","label":"Request ID","name":"requestId","freeform":true,"description":"Safe-retry tag. Leave blank and one is generated for you. Sending the same Request ID twice returns the original transaction instead of moving the money a second time, so you can safely retry after a network glitch. No picker is offered — this is a value you choose, not one Revolut lists."}
   *
   * @returns {Object}
   * @sampleResult {"id":"abcd","state":"completed","request_id":"req-1"}
   */
  async transferBetweenAccounts(
    sourceAccountId,
    targetAccountId,
    amount,
    currency,
    reference,
    requestId
  ) {
    const body = clean({
      request_id: requestId || generateRequestId(),
      source_account_id: sourceAccountId,
      target_account_id: targetAccountId,
      amount: Number(amount),
      currency,
      reference,
    })

    return this.#api({
      logTag: 'transferBetweenAccounts',
      method: 'post',
      url: `${ this.apiBaseUrl }/transfer`,
      body,
    })
  }

  /**
   * @operationName Make Payment
   * @category Transfers
   * @description Sends money from one of your accounts to a saved counterparty (recipient). Safe to retry: pass the same Request ID and the payment will not be sent twice. Available on Revolut Business Company plans only — Freelancer plans must use Create Payment Draft, which sends the payment for approval in the Revolut Business app instead of releasing money immediately. Larger or unusual payments may need you to approve them in the Revolut Business mobile app before they leave the account.
   *
   * @route POST /make-payment
   * @appearanceColor #0666EB #2C7BE5
   * @executionTimeoutInSeconds 60
   * @requiredOauth2Scopes PAY
   *
   * @paramDef {"type":"String","label":"Source Account","name":"accountId","required":true,"dictionary":"getAccountsDictionary","description":"Your account the money is taken from."}
   * @paramDef {"type":"String","label":"Counterparty","name":"counterpartyId","required":true,"dictionary":"getCounterpartiesDictionary","description":"Saved recipient to pay. If the person or business isn't here yet, add them with Create Counterparty first."}
   * @paramDef {"type":"String","label":"Counterparty Account","name":"receiverAccountId","dictionary":"getCounterpartyAccountsDictionary","dependsOn":["counterpartyId"],"description":"Optional. If the recipient has more than one account on file, pick the specific one. Leave blank to use the recipient's default account for the chosen currency."}
   * @paramDef {"type":"String","label":"Counterparty Card","name":"receiverCardId","dictionary":"getCounterpartyCardsDictionary","dependsOn":["counterpartyId"],"description":"Optional. Pick this when paying a specific card on the recipient instead of a bank account. Do not fill in both this and Counterparty Account."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How much to send, in the currency below (for example 25.50 for £25.50)."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","required":true,"dictionary":"getCurrenciesDictionary","description":"Currency of the payment (for example GBP, EUR, USD). Must match the source account's currency."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"Free-text description shown on the recipient's statement (max 100 characters). Examples: 'Invoice 1234', 'October consulting fee'."}
   * @paramDef {"type":"String","label":"Schedule For","name":"scheduleFor","uiComponent":{"type":"DATE_PICKER"},"description":"Optional date to send the payment on. Leave blank to send it right away. You can cancel a scheduled payment with Cancel Transaction up until the scheduled date."}
   * @paramDef {"type":"String","label":"Request ID","name":"requestId","freeform":true,"description":"Safe-retry tag. Leave blank and one is generated for you. Sending the same Request ID twice returns the original payment instead of paying twice, so you can safely retry after a network glitch. No picker is offered — this is a value you choose, not one Revolut lists."}
   *
   * @returns {Object}
   * @sampleResult {"id":"abcd","state":"pending","request_id":"req-1"}
   */
  async makePayment(
    accountId,
    counterpartyId,
    receiverAccountId,
    receiverCardId,
    amount,
    currency,
    reference,
    scheduleFor,
    requestId
  ) {
    const receiver = clean({
      counterparty_id: counterpartyId,
      account_id: receiverAccountId,
      card_id: receiverCardId,
    })

    const body = clean({
      request_id: requestId || generateRequestId(),
      account_id: accountId,
      receiver: Object.keys(receiver).length ? receiver : undefined,
      amount: Number(amount),
      currency,
      reference,
      schedule_for: scheduleFor,
    })

    return this.#api({
      logTag: 'makePayment',
      method: 'post',
      url: `${ this.apiBaseUrl }/pay`,
      body,
    })
  }

  // =====================================================================================
  // #PAYMENT-DRAFTS
  // =====================================================================================

  /**
   * @operationName List Payment Drafts
   * @category Payment Drafts
   * @description Returns every payment draft on the connected profile. Drafts are payments lined up for someone to approve inside the Revolut Business mobile app — used by Freelancer plan accounts (which cannot use Make Payment directly) and by Company accounts that need approval before any money moves.
   *
   * @route POST /list-payment-drafts
   * @appearanceColor #0666EB #2C7BE5
   * @requiredOauth2Scopes READ
   *
   * @returns {Object}
   * @sampleResult {"payment_orders":[{"id":"draft-1","scheduled_for":"2026-06-01","title":"June payroll","payment_counts":{"processing":0,"failed":0,"completed":0,"reverted":0,"draft":3}}]}
   */
  async listPaymentDrafts() {
    return this.#api({
      logTag: 'listPaymentDrafts',
      url: `${ this.apiBaseUrl }/payment-drafts`,
    })
  }

  /**
   * @operationName Get Payment Draft
   * @category Payment Drafts
   * @description Looks up one payment draft, with every payment inside it, the scheduled date, and the current status of each payment. Use this to show the draft to someone for approval, or to track what happened to each payment after the draft was approved.
   *
   * @route POST /get-payment-draft
   * @appearanceColor #0666EB #2C7BE5
   * @requiredOauth2Scopes READ
   *
   * @paramDef {"type":"String","label":"Payment Draft","name":"draftId","required":true,"dictionary":"getPaymentDraftsDictionary","description":"The payment draft to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"scheduled_for":"2026-06-01","title":"June payroll","payments":[{"id":"p1","amount":1000,"currency":"GBP","account_id":"f12","receiver":{"counterparty_id":"01234567"},"state":"draft"}]}
   */
  async getPaymentDraft(draftId) {
    return this.#api({
      logTag: 'getPaymentDraft',
      url: `${ this.apiBaseUrl }/payment-drafts/${ encodeURIComponent(draftId) }`,
    })
  }

  /**
   * @typedef {Object} PaymentDraftPayment
   * @property {String} accountId - Your account the money is taken from.
   * @property {String} counterpartyId - Saved recipient to pay.
   * @property {String} [receiverAccountId] - Optional specific account on the recipient (leave blank to use the recipient's default account in the chosen currency).
   * @property {Number} amount - How much to pay, in major units (for example 25.50 for £25.50).
   * @property {String} currency - Currency to pay in (for example GBP, EUR, USD).
   * @property {String} [reference] - Optional note shown on the recipient's statement (up to 100 characters).
   */

  /**
   * @operationName Create Payment Draft
   * @category Payment Drafts
   * @description Prepares one or more payments and saves them as a draft that has to be approved inside the Revolut Business mobile app before any money moves. Use this for: Freelancer plan accounts (which cannot use Make Payment directly), batch runs like payroll, and any workflow where a person needs to sign off before the payment goes out. You can also schedule the payments for a future date.
   *
   * @route POST /create-payment-draft
   * @appearanceColor #0666EB #2C7BE5
   * @requiredOauth2Scopes WRITE
   *
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Title for the draft, displayed in the Revolut Business approval screen."}
   * @paramDef {"type":"String","label":"Schedule For","name":"scheduleFor","uiComponent":{"type":"DATE_PICKER"},"description":"Optional date to send the payments on after they are approved. Leave blank to send them as soon as someone approves the draft."}
   * @paramDef {"type":"Array.<PaymentDraftPayment>","label":"Payments","name":"payments","required":true,"description":"One or more payments to include in this draft. For each payment provide: Source Account, Counterparty, Amount, Currency, and optionally a Reference and a specific Counterparty Account."}
   *
   * @returns {Object}
   * @sampleResult {"id":"draft-1"}
   */
  async createPaymentDraft(title, scheduleFor, payments) {
    const draftPayments = (Array.isArray(payments) ? payments : []).map(
      payment => {
        const receiver = clean({
          counterparty_id: payment.counterpartyId,
          account_id: payment.receiverAccountId,
        })

        return clean({
          account_id: payment.accountId,
          receiver: Object.keys(receiver).length ? receiver : undefined,
          amount: Number(payment.amount),
          currency: payment.currency,
          reference: payment.reference,
        })
      }
    )

    const body = clean({
      title,
      schedule_for: scheduleFor,
      payments: draftPayments.length ? draftPayments : undefined,
    })

    return this.#api({
      logTag: 'createPaymentDraft',
      method: 'post',
      url: `${ this.apiBaseUrl }/payment-drafts`,
      body,
    })
  }

  /**
   * @operationName Delete Payment Draft
   * @category Payment Drafts
   * @description Cancels a payment draft before anyone approves it, so the payments inside never go out. Use this when payment details change, or to pull back an approval request that should no longer be acted on.
   *
   * @route POST /delete-payment-draft
   * @appearanceColor #DC2626 #F87171
   * @requiredOauth2Scopes WRITE
   *
   * @paramDef {"type":"String","label":"Payment Draft","name":"draftId","required":true,"dictionary":"getPaymentDraftsDictionary","description":"The payment draft to delete."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":"draft-1"}
   */
  async deletePaymentDraft(draftId) {
    await this.#api({
      logTag: 'deletePaymentDraft',
      method: 'delete',
      url: `${ this.apiBaseUrl }/payment-drafts/${ encodeURIComponent(draftId) }`,
    })

    return { id: draftId, deleted: true }
  }

  // =====================================================================================
  // #FX — Foreign exchange
  // =====================================================================================

  /**
   * @operationName Get Exchange Rate
   * @category Foreign Exchange
   * @description Returns the current exchange rate Revolut Business will use to convert between two currencies, plus any fee. Use this to show a quote to someone before actually moving money with Exchange Money, or to compare rates.
   *
   * @route POST /get-exchange-rate
   * @appearanceColor #0666EB #2C7BE5
   * @requiredOauth2Scopes READ
   *
   * @paramDef {"type":"String","label":"From","name":"from","required":true,"dictionary":"getCurrenciesDictionary","description":"Currency you are converting from (for example GBP)."}
   * @paramDef {"type":"String","label":"To","name":"to","required":true,"dictionary":"getCurrenciesDictionary","description":"Currency you are converting to (for example EUR)."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional reference amount in the From currency. Default 1."}
   *
   * @returns {Object}
   * @sampleResult {"from":{"amount":1,"currency":"GBP"},"to":{"amount":1.17,"currency":"EUR"},"rate":1.17,"fee":{"amount":0,"currency":"GBP"},"rate_date":"2026-05-16T10:00:00Z"}
   */
  async getExchangeRate(from, to, amount) {
    return this.#api({
      logTag: 'getExchangeRate',
      url: `${ this.apiBaseUrl }/rate`,
      query: { from, to, amount: amount != null ? Number(amount) : 1 },
    })
  }

  /**
   * @operationName Exchange Money
   * @category Foreign Exchange
   * @description Converts money between two of your Revolut Business accounts that are in different currencies, using the current Revolut rate. Fill in either Source Amount (how much to convert out of the source account) or Target Amount (how much you want to land in the target account) — Revolut works out the other side. Safe to retry: pass the same Request ID and the conversion will not happen twice.
   *
   * @route POST /exchange-money
   * @appearanceColor #0666EB #2C7BE5
   * @requiredOauth2Scopes PAY
   *
   * @paramDef {"type":"String","label":"Source Account","name":"sourceAccountId","required":true,"dictionary":"getAccountsDictionary","description":"Account in the source currency."}
   * @paramDef {"type":"String","label":"Source Currency","name":"sourceCurrency","required":true,"dictionary":"getCurrenciesDictionary","description":"Currency you are converting from (must match the Source Account's currency)."}
   * @paramDef {"type":"Number","label":"Source Amount","name":"sourceAmount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Amount to debit from the source account (sell). Provide either Source Amount or Target Amount, not both."}
   * @paramDef {"type":"String","label":"Target Account","name":"targetAccountId","required":true,"dictionary":"getAccountsDictionary","description":"Account in the destination currency."}
   * @paramDef {"type":"String","label":"Target Currency","name":"targetCurrency","required":true,"dictionary":"getCurrenciesDictionary","description":"Currency you are converting to (must match the Target Account's currency)."}
   * @paramDef {"type":"Number","label":"Target Amount","name":"targetAmount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Amount to credit into the target account (buy). Provide either Source Amount or Target Amount, not both."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"Free-text description shown on the resulting transaction in both accounts (max 100 characters). Examples: 'Convert GBP to USD for invoice payment'."}
   * @paramDef {"type":"String","label":"Request ID","name":"requestId","freeform":true,"description":"Safe-retry tag. Leave blank and one is generated for you. Sending the same Request ID twice returns the original exchange instead of converting the money twice, so you can safely retry after a network glitch. No picker is offered — this is a value you choose, not one Revolut lists."}
   *
   * @returns {Object}
   * @sampleResult {"id":"abcd","state":"completed","request_id":"req-1"}
   */
  async exchangeMoney(
    sourceAccountId,
    sourceCurrency,
    sourceAmount,
    targetAccountId,
    targetCurrency,
    targetAmount,
    reference,
    requestId
  ) {
    const from = clean({
      account_id: sourceAccountId,
      currency: sourceCurrency,
      amount: sourceAmount != null ? Number(sourceAmount) : undefined,
    })

    const to = clean({
      account_id: targetAccountId,
      currency: targetCurrency,
      amount: targetAmount != null ? Number(targetAmount) : undefined,
    })

    const body = clean({
      request_id: requestId || generateRequestId(),
      from: Object.keys(from).length ? from : undefined,
      to: Object.keys(to).length ? to : undefined,
      reference,
    })

    return this.#api({
      logTag: 'exchangeMoney',
      method: 'post',
      url: `${ this.apiBaseUrl }/exchange`,
      body,
    })
  }

  // =====================================================================================
  // #PAYOUT-LINKS
  // =====================================================================================

  /**
   * @operationName List Payout Links
   * @category Payout Links
   * @description Returns the payout links on the connected profile. A payout link is a one-time web link you send to someone so they can collect the money themselves — by Revolut, bank transfer, or card — on a Revolut-hosted page, without you needing their bank details first. Useful for one-off refunds, contractor payments, or paying suppliers when you don't have their account number.
   *
   * @route POST /list-payout-links
   * @appearanceColor #0666EB #2C7BE5
   * @requiredOauth2Scopes READ
   *
   * @paramDef {"type":"String","label":"State","name":"state","uiComponent":{"type":"DROPDOWN","options":{"values":["Created","Failed","Awaiting","Active","Expired","Cancelled","Processing","Processed"]}},"description":"Filter by payout link state."}
   * @paramDef {"type":"String","label":"Created Before","name":"createdBefore","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return payout links created before this date and time. Use to page through older links."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of links per page. Default 100, maximum 100."}
   *
   * @returns {Array.<Object>}
   * @sampleResult [{"id":"po-1","state":"active","created_at":"2026-05-15T10:00:00Z","expiry_date":"2026-05-22T10:00:00Z","payout_methods":["revolut","bank_account","card"],"counterparty_name":"John Doe","reference":"Refund 1234","amount":50,"currency":"GBP","url":"https://revolut.me/p/abc123"}]
   */
  async listPayoutLinks(state, createdBefore, limit) {
    state = this.#resolveChoice(state, PAYOUT_LINK_STATE_MAP)

    return this.#api({
      logTag: 'listPayoutLinks',
      url: `${ this.apiBaseUrl }/payout-links`,
      query: {
        state,
        created_before: createdBefore,
        limit: limit || DEFAULT_LIMIT,
      },
    })
  }

  /**
   * @operationName Get Payout Link
   * @category Payout Links
   * @description Looks up one payout link, with its current status, the web link the recipient uses to collect the money, and which payment methods they can choose from.
   *
   * @route POST /get-payout-link
   * @appearanceColor #0666EB #2C7BE5
   * @requiredOauth2Scopes READ
   *
   * @paramDef {"type":"String","label":"Payout Link","name":"payoutLinkId","required":true,"dictionary":"getPayoutLinksDictionary","description":"The payout link to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"po-1","state":"active","created_at":"2026-05-15T10:00:00Z","expiry_date":"2026-05-22T10:00:00Z","payout_methods":["revolut","bank_account","card"],"counterparty_name":"John Doe","reference":"Refund 1234","amount":50,"currency":"GBP","url":"https://revolut.me/p/abc123"}
   */
  async getPayoutLink(payoutLinkId) {
    return this.#api({
      logTag: 'getPayoutLink',
      url: `${ this.apiBaseUrl }/payout-links/${ encodeURIComponent(payoutLinkId) }`,
    })
  }

  /**
   * @operationName Create Payout Link
   * @category Payout Links
   * @description Creates a one-time web link you can send to someone so they can collect the money themselves — by Revolut, bank transfer, or card — on a Revolut-hosted page. Use this for refunds, paying contractors, or any case where you don't have the recipient's bank details on file (or where you'd rather let them pick how to get paid).
   *
   * @route POST /create-payout-link
   * @appearanceColor #0666EB #2C7BE5
   * @requiredOauth2Scopes PAY
   *
   * @paramDef {"type":"String","label":"Source Account","name":"accountId","required":true,"dictionary":"getAccountsDictionary","description":"Account the money is debited from when the link is redeemed."}
   * @paramDef {"type":"String","label":"Counterparty Name","name":"counterpartyName","required":true,"description":"Name of the recipient. Shown on Revolut's hosted page and on the transaction."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Amount in the currency below, major units."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","required":true,"dictionary":"getCurrenciesDictionary","description":"Currency the link is paid in (must match the Source Account's currency)."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"Free-text description shown on the recipient's statement and on Revolut's hosted page (max 100 characters). Examples: 'Refund order #4521', 'Q3 contractor payment'."}
   * @paramDef {"type":"Array.<String>","label":"Payout Methods","name":"payoutMethods","uiComponent":{"type":"MULTI_SELECT_DROPDOWN","options":{"values":["revolut","bank_account","card"]}},"description":"Methods the recipient can pick when redeeming the link. Default: all three. Restrict (e.g. only 'bank_account') if you need to control how funds are received."}
   * @paramDef {"type":"Number","label":"Expiry Days","name":"expiryDays","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of days the link stays redeemable (1–7, default 7). After expiry the link auto-cancels and money is returned to your account."}
   * @paramDef {"type":"String","label":"Request ID","name":"requestId","freeform":true,"description":"Safe-retry tag. Leave blank and one is generated for you. Sending the same Request ID twice returns the original link instead of creating a duplicate, so you can safely retry after a network glitch. No picker is offered — this is a value you choose, not one Revolut lists."}
   *
   * @returns {Object}
   * @sampleResult {"id":"po-1","state":"active","url":"https://revolut.me/p/abc123","expiry_date":"2026-05-23T10:00:00Z"}
   */
  async createPayoutLink(
    accountId,
    counterpartyName,
    amount,
    currency,
    reference,
    payoutMethods,
    expiryDays,
    requestId
  ) {
    const methods = toArray(payoutMethods)

    const body = clean({
      request_id: requestId || generateRequestId(),
      account_id: accountId,
      counterparty_name: counterpartyName,
      amount: Number(amount),
      currency,
      reference,
      payout_methods: methods.length ? methods : undefined,
      expiry_period: expiryDays
        ? `P${ Math.min(Math.max(Number(expiryDays), 1), 7) }D`
        : undefined,
    })

    return this.#api({
      logTag: 'createPayoutLink',
      method: 'post',
      url: `${ this.apiBaseUrl }/payout-links`,
      body,
    })
  }

  /**
   * @operationName Cancel Payout Link
   * @category Payout Links
   * @description Cancels an active payout link before the recipient collects the money, so the link can no longer be used. Use this when payment terms change, the link was sent to the wrong person, or the payment is no longer needed.
   *
   * @route POST /cancel-payout-link
   * @appearanceColor #DC2626 #F87171
   * @requiredOauth2Scopes PAY
   *
   * @paramDef {"type":"String","label":"Payout Link","name":"payoutLinkId","required":true,"dictionary":"getPayoutLinksDictionary","description":"The payout link to cancel."}
   *
   * @returns {Object}
   * @sampleResult {"id":"po-1","cancelled":true}
   */
  async cancelPayoutLink(payoutLinkId) {
    await this.#api({
      logTag: 'cancelPayoutLink',
      method: 'post',
      url: `${ this.apiBaseUrl }/payout-links/${ encodeURIComponent(payoutLinkId) }/cancel`,
    })

    return { id: payoutLinkId, cancelled: true }
  }

  // =====================================================================================
  // #WEBHOOKS-MGMT — Webhook subscription management (v2)
  // =====================================================================================

  /**
   * @operationName List Webhooks
   * @category Webhooks
   * @description Returns every webhook on the connected Revolut Business profile — the URL Revolut sends events to, which events it sends, and whether the webhook is turned on. Use this to check what is hooked up, or to spot stale URLs that should be removed.
   *
   * @route POST /list-webhooks
   * @appearanceColor #0666EB #2C7BE5
   * @requiredOauth2Scopes READ
   *
   * @returns {Array.<Object>}
   * @sampleResult [{"id":"wh-1","url":"https://example.com/hook","state":"enabled","events":["TransactionCreated","TransactionStateChanged"],"created_at":"2026-05-12T08:00:00Z","updated_at":"2026-05-12T08:00:00Z"}]
   */
  async listWebhooks() {
    return this.#api({
      logTag: 'listWebhooks',
      url: `${ this.apiV2BaseUrl }/webhooks`,
    })
  }

  /**
   * @operationName Get Webhook
   * @category Webhooks
   * @description Looks up one webhook by ID. Use this to confirm where events are being sent, which events the webhook is signed up for, and whether it is currently turned on.
   *
   * @route POST /get-webhook
   * @appearanceColor #0666EB #2C7BE5
   * @requiredOauth2Scopes READ
   *
   * @paramDef {"type":"String","label":"Webhook","name":"webhookId","required":true,"dictionary":"getWebhooksDictionary","description":"The webhook subscription to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"wh-1","url":"https://example.com/hook","state":"enabled","events":["TransactionCreated"],"created_at":"2026-05-12T08:00:00Z","updated_at":"2026-05-12T08:00:00Z"}
   */
  async getWebhook(webhookId) {
    return this.#api({
      logTag: 'getWebhook',
      url: `${ this.apiV2BaseUrl }/webhooks/${ encodeURIComponent(webhookId) }`,
    })
  }

  /**
   * @operationName Create Webhook
   * @category Webhooks
   * @description Tells Revolut to send event notifications (transaction created, payment state changed, and so on) to a web address you control. Only use this if you are building your own receiver — if you want events to flow into a FlowRunner flow, use the On Transaction Created, On Transaction State Changed, or On Payout Link triggers instead, which set up the webhook for you.
   *
   * @route POST /create-webhook
   * @appearanceColor #0666EB #2C7BE5
   * @requiredOauth2Scopes WRITE
   *
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"HTTPS URL Revolut will POST events to. Must be publicly reachable."}
   * @paramDef {"type":"Array.<String>","label":"Events","name":"events","uiComponent":{"type":"MULTI_SELECT_DROPDOWN","options":{"values":["TransactionCreated","TransactionStateChanged","PayoutLinkCreated","PayoutLinkStateChanged"]}},"description":"Events to subscribe to. Default: TransactionCreated and TransactionStateChanged."}
   *
   * @returns {Object}
   * @sampleResult {"id":"wh-1","url":"https://example.com/hook","state":"enabled","events":["TransactionCreated","TransactionStateChanged"],"signing_secret":"wsec_abc123","created_at":"2026-05-16T10:00:00Z","updated_at":"2026-05-16T10:00:00Z"}
   */
  async createWebhook(url, events) {
    const body = clean({
      url,
      events: toArray(events).length ? toArray(events) : undefined,
    })

    return this.#api({
      logTag: 'createWebhook',
      method: 'post',
      url: `${ this.apiV2BaseUrl }/webhooks`,
      body,
    })
  }

  /**
   * @operationName Update Webhook
   * @category Webhooks
   * @description Changes an existing webhook — point it at a new web address, or change which events it listens for. Use this when moving your receiver to a new server, or when you want to start or stop receiving certain events.
   *
   * @route POST /update-webhook
   * @appearanceColor #0666EB #2C7BE5
   * @requiredOauth2Scopes WRITE
   *
   * @paramDef {"type":"String","label":"Webhook","name":"webhookId","required":true,"dictionary":"getWebhooksDictionary","description":"The webhook subscription to update."}
   * @paramDef {"type":"String","label":"URL","name":"url","description":"New HTTPS URL. Omit to keep the existing URL."}
   * @paramDef {"type":"Array.<String>","label":"Events","name":"events","uiComponent":{"type":"MULTI_SELECT_DROPDOWN","options":{"values":["TransactionCreated","TransactionStateChanged","PayoutLinkCreated","PayoutLinkStateChanged"]}},"description":"New event list. Omit to keep the existing events."}
   *
   * @returns {Object}
   * @sampleResult {"id":"wh-1","url":"https://example.com/hook","state":"enabled","events":["TransactionCreated"],"created_at":"2026-05-12T08:00:00Z","updated_at":"2026-05-16T10:00:00Z"}
   */
  async updateWebhook(webhookId, url, events) {
    const eventList = toArray(events)

    const body = clean({
      url,
      events: eventList.length ? eventList : undefined,
    })

    return this.#api({
      logTag: 'updateWebhook',
      method: 'patch',
      url: `${ this.apiV2BaseUrl }/webhooks/${ encodeURIComponent(webhookId) }`,
      body,
    })
  }

  /**
   * @operationName Delete Webhook
   * @category Webhooks
   * @description Removes a webhook so Revolut stops sending events to its address. Use this when the receiver is being shut down or you no longer need the events.
   *
   * @route POST /delete-webhook
   * @appearanceColor #DC2626 #F87171
   * @requiredOauth2Scopes WRITE
   *
   * @paramDef {"type":"String","label":"Webhook","name":"webhookId","required":true,"dictionary":"getWebhooksDictionary","description":"The webhook subscription to delete."}
   *
   * @returns {Object}
   * @sampleResult {"id":"wh-1","deleted":true}
   */
  async deleteWebhook(webhookId) {
    await this.#api({
      logTag: 'deleteWebhook',
      method: 'delete',
      url: `${ this.apiV2BaseUrl }/webhooks/${ encodeURIComponent(webhookId) }`,
    })

    return { id: webhookId, deleted: true }
  }

  /**
   * @operationName Rotate Webhook Signing Secret
   * @category Webhooks
   * @description Issues a new signing secret for a webhook (the value used to prove that incoming events really came from Revolut). After rotating, check incoming events against the new secret. Use this if you think the old secret may have leaked.
   *
   * @route POST /rotate-webhook-signing-secret
   * @appearanceColor #0666EB #2C7BE5
   * @requiredOauth2Scopes WRITE
   *
   * @paramDef {"type":"String","label":"Webhook","name":"webhookId","required":true,"dictionary":"getWebhooksDictionary","description":"The webhook subscription whose signing secret to rotate."}
   * @paramDef {"type":"Number","label":"Expiration Period (seconds)","name":"expirationPeriodSeconds","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional grace period (seconds) during which the previous secret continues to be accepted. Maximum 86400 (24h)."}
   *
   * @returns {Object}
   * @sampleResult {"signing_secret":"wsec_newabc123"}
   */
  async rotateWebhookSigningSecret(webhookId, expirationPeriodSeconds) {
    const body = clean({
      expiration_period:
        expirationPeriodSeconds != null
          ? `PT${ Math.min(Math.max(Number(expirationPeriodSeconds), 0), 86400) }S`
          : undefined,
    })

    return this.#api({
      logTag: 'rotateWebhookSigningSecret',
      method: 'post',
      url: `${ this.apiV2BaseUrl }/webhooks/${ encodeURIComponent(webhookId) }/rotate-signing-secret`,
      body,
    })
  }

  /**
   * @operationName List Failed Webhook Events
   * @category Webhooks
   * @description Returns events Revolut tried to send to your webhook but never managed to deliver (because the receiver was down, slow, or returned an error). Use this after an outage to find dropped events that need to be replayed by hand.
   *
   * @route POST /list-failed-webhook-events
   * @appearanceColor #0666EB #2C7BE5
   * @requiredOauth2Scopes READ
   *
   * @paramDef {"type":"String","label":"Webhook","name":"webhookId","required":true,"dictionary":"getWebhooksDictionary","description":"The webhook subscription."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of failed events to return. Default 100, maximum 100."}
   * @paramDef {"type":"String","label":"Created Before","name":"createdBefore","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return failed events from before this date and time. Use to page through older failures."}
   *
   * @returns {Array.<Object>}
   * @sampleResult [{"id":"evt-1","created_at":"2026-05-15T10:00:00Z","updated_at":"2026-05-15T10:05:00Z","webhook_id":"wh-1","event":"TransactionCreated","last_sent_date":"2026-05-15T10:04:30Z","payload":{"data":{"id":"abcd"}}}]
   */
  async listFailedWebhookEvents(webhookId, limit, createdBefore) {
    return this.#api({
      logTag: 'listFailedWebhookEvents',
      url: `${ this.apiV2BaseUrl }/webhooks/${ encodeURIComponent(webhookId) }/failed-events`,
      query: { limit: limit || DEFAULT_LIMIT, created_before: createdBefore },
    })
  }

  // =====================================================================================
  // #TRIGGER-HANDLERS — Webhook lifecycle for FlowRunner realtime triggers
  // =====================================================================================
  //
  // FlowRunner asks the service to upsert one webhook per connection,
  // covering all configured triggers. Incoming events are dispatched to
  // the right trigger via handleTriggerResolveEvents.

  async #createTriggerWebhook(events, invocation) {
    const callbackUrl = `${ invocation.callbackUrl }&connectionId=${ encodeURIComponent(invocation.connectionId) }`

    return this.#api({
      logTag: 'createTriggerWebhook',
      method: 'post',
      url: `${ this.apiV2BaseUrl }/webhooks`,
      body: clean({ url: callbackUrl, events }),
    })
  }

  async #deleteTriggerWebhook(webhookId) {
    if (!webhookId) {
      return
    }

    try {
      await this.#api({
        logTag: 'deleteTriggerWebhook',
        method: 'delete',
        url: `${ this.apiV2BaseUrl }/webhooks/${ encodeURIComponent(webhookId) }`,
      })
    } catch (error) {
      // Best-effort cleanup; log and swallow so a stale id doesn't trap
      // the operator inside a recreate loop.
      logger.warn(
        `deleteTriggerWebhook[${ webhookId }] failed: ${ error.message }`
      )
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    logger.debug(
      `handleTriggerUpsertWebhook: ${ JSON.stringify({ connectionId: invocation.connectionId, events: invocation.events?.map(e => e.name) }) }`
    )

    const eventNames = (invocation.events || [])
      .map(event => TriggerEventBindings[event.name])
      .filter(Boolean)

    if (invocation.webhookData?.id) {
      await this.#deleteTriggerWebhook(invocation.webhookData.id)
    }

    const created = await this.#createTriggerWebhook(eventNames, invocation)

    return {
      webhookData: {
        id: created.id,
        url: created.url,
        events: created.events,
        signingSecret: created.signing_secret,
      },
      connectionId: invocation.connectionId,
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    const eventName = invocation.body?.event

    logger.debug(
      `handleTriggerResolveEvents: ${ JSON.stringify({ event: eventName }) }`
    )

    const signingSecret = invocation.webhookData?.signingSecret

    if (signingSecret) {
      // A signing secret is configured (a live webhook subscription): every
      // delivery must carry valid Revolut signature headers, otherwise it is
      // dropped so forged POSTs are never processed as real events.
      const headers = headersOf(invocation)
      const { valid, reason } = verifyWebhookSignature({
        rawBody: rawBodyOf(invocation),
        signatureHeader: headers['revolut-signature'],
        timestampHeader: headers['revolut-request-timestamp'],
        signingSecret,
      })

      if (!valid) {
        logger.warn(
          `handleTriggerResolveEvents: rejecting event — signature ${ reason }`
        )

        return null
      }
    } else {
      // No signing secret on record (e.g. dry-run/test mode): accept and shape.
      logger.debug(
        'handleTriggerResolveEvents: no signingSecret configured — accepting (test mode)'
      )
    }

    const methodName = RevolutEventToMethod[eventName]

    if (!methodName) {
      logger.warn(
        `handleTriggerResolveEvents: unsupported event "${ eventName }"`
      )

      return null
    }

    const events = await this[methodName](
      TriggerCallTypes.SHAPE_EVENT,
      invocation.body
    )

    return {
      connectionId: invocation.queryParams?.connectionId,
      events,
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    logger.debug(
      `handleTriggerSelectMatched.${ invocation.eventName }: ${ JSON.stringify({ triggerCount: invocation.triggers?.length }) }`
    )

    return this[invocation.eventName](
      TriggerCallTypes.FILTER_TRIGGER,
      invocation
    )
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   */
  async handleTriggerDeleteWebhook(invocation) {
    logger.debug(
      `handleTriggerDeleteWebhook: ${ JSON.stringify({ webhookId: invocation.webhookData?.id }) }`
    )

    await this.#deleteTriggerWebhook(invocation.webhookData?.id)
  }

  // =====================================================================================
  // #TRIGGER-OPS — Realtime trigger operation methods
  // =====================================================================================
  //
  // Each method runs in two modes:
  //   SHAPE_EVENT   — convert the raw Revolut payload into one or more
  //                   trigger events (name + data).
  //   FILTER_TRIGGER — narrow the set of trigger instances to fire based
  //                   on per-trigger filters (account, state, etc.).

  /**
   * @operationName On Transaction Created
   * @category Triggers
   * @description Runs every time a new transaction appears on the connected Revolut Business profile — incoming payments, outgoing payments, card spending, fees, refunds, and so on. Use this to mirror transactions into your accounting system, post a notification, kick off invoice reconciliation, or trigger downstream workflows. Filter by account or transaction type if you only care about a slice (for example, only card payments on the GBP account).
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-transaction-created
   * @appearanceColor #0666EB #2C7BE5
   *
   * @paramDef {"type":"String","label":"Account","name":"accountId","dictionary":"getAccountsDictionary","description":"Optional. Only run when the transaction touches this account. Leave blank to run for any account."}
   * @paramDef {"type":"String","label":"Transaction Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["ATM","Card Payment","Card Refund","Card Chargeback","Card Credit","Exchange","Transfer","Loan","Fee","Refund","Top-Up","Tax","Tax Refund"]}},"description":"Optional. Only run for this kind of transaction (for example 'card_payment' for card spending, 'transfer' for outbound payments). Leave blank to run for every type."}
   *
   * @returns {Object}
   * @sampleResult {"id":"abcd","type":"transfer","request_id":"req-1","state":"pending","created_at":"2026-05-16T10:00:00Z","reference":"Invoice 1234","legs":[{"leg_id":"l1","account_id":"f12","amount":-100,"currency":"GBP","description":"Payment to Acme Ltd","counterparty":{"id":"01234567","account_id":"d1"}}]}
   */
  onTransactionCreated(callType, payload) {
    if (callType === TriggerCallTypes.SHAPE_EVENT) {
      return [{ name: 'onTransactionCreated', data: payload?.data || payload }]
    }

    if (callType === TriggerCallTypes.FILTER_TRIGGER) {
      return this.#filterByAccountAndType(payload)
    }
  }

  /**
   * @operationName On Transaction State Changed
   * @category Triggers
   * @description Runs every time an existing transaction moves to a new state — for example pending → completed when a payment clears, or completed → reverted when one is reversed. Use this to confirm payments without polling, react to failures, send notifications when funds actually land, or close out invoices automatically.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-transaction-state-changed
   * @appearanceColor #0666EB #2C7BE5
   *
   * @paramDef {"type":"String","label":"New State","name":"newState","uiComponent":{"type":"DROPDOWN","options":{"values":["Created","Pending","Completed","Declined","Failed","Reverted"]}},"description":"Optional. Only run when the transaction moves into this state (for example pick 'completed' to react only when payments actually clear)."}
   * @paramDef {"type":"String","label":"Old State","name":"oldState","uiComponent":{"type":"DROPDOWN","options":{"values":["Created","Pending","Completed","Declined","Failed","Reverted"]}},"description":"Optional. Only run when the transaction was previously in this state (for example pick 'pending' to react to anything leaving the pending state)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"abcd","request_id":"req-1","old_state":"pending","new_state":"completed"}
   */
  onTransactionStateChanged(callType, payload) {
    if (callType === TriggerCallTypes.SHAPE_EVENT) {
      return [{ name: 'onTransactionStateChanged', data: payload?.data || payload }]
    }

    if (callType === TriggerCallTypes.FILTER_TRIGGER) {
      return this.#filterByState(payload)
    }
  }

  /**
   * @operationName On Payout Link Created
   * @category Triggers
   * @description Runs every time a new payout link is generated on the connected profile. Use this to copy payout-link records into your accounting or CRM system, notify finance when a link is issued, or send the link to the recipient automatically by email or SMS.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-payout-link-created
   * @appearanceColor #0666EB #2C7BE5
   *
   * @returns {Object}
   * @sampleResult {"id":"po-1","state":"active","url":"https://revolut.me/p/abc123","counterparty_name":"John Doe","amount":50,"currency":"GBP"}
   */
  onPayoutLinkCreated(callType, payload) {
    if (callType === TriggerCallTypes.SHAPE_EVENT) {
      return [{ name: 'onPayoutLinkCreated', data: payload?.data || payload }]
    }

    if (callType === TriggerCallTypes.FILTER_TRIGGER) {
      // PayoutLinkCreated payloads carry no account_id (docs:
      // developer.revolut.com/docs/business/webhooks-v-2), so there is nothing
      // to filter on — every configured trigger fires.
      return { ids: (payload.triggers || []).map(trigger => trigger.id) }
    }
  }

  /**
   * @operationName On Payout Link State Changed
   * @category Triggers
   * @description Runs every time a payout link moves to a new state — for example 'active' → 'processed' when the recipient redeems it, or 'active' → 'cancelled' if you call it off. Use this to confirm the recipient was paid, follow up on cancellations, or close out related work.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-payout-link-state-changed
   * @appearanceColor #0666EB #2C7BE5
   *
   * @paramDef {"type":"String","label":"New State","name":"newState","uiComponent":{"type":"DROPDOWN","options":{"values":["Created","Failed","Awaiting","Active","Expired","Cancelled","Processing","Processed"]}},"description":"Optional. Only run when the link moves into this state (for example pick 'processed' to react only when the recipient has been paid)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"po-1","old_state":"active","new_state":"processed"}
   */
  onPayoutLinkStateChanged(callType, payload) {
    if (callType === TriggerCallTypes.SHAPE_EVENT) {
      return [{ name: 'onPayoutLinkStateChanged', data: payload?.data || payload }]
    }

    if (callType === TriggerCallTypes.FILTER_TRIGGER) {
      const ids = []

      for (const trigger of payload.triggers) {
        const newState = this.#resolveChoice(trigger.data?.newState, PAYOUT_LINK_STATE_MAP)

        if (!newState || payload.eventData?.new_state === newState) {
          ids.push(trigger.id)
        }
      }

      return { ids }
    }
  }

  #filterByAccountAndType(payload) {
    const ids = []
    const data = payload.eventData || {}
    const legAccounts = (data.legs || []).map(leg => leg.account_id)

    for (const trigger of payload.triggers) {
      const accountFilter = trigger.data?.accountId
      const typeFilter = this.#resolveChoice(trigger.data?.type, TRANSACTION_TYPE_MAP)

      const accountMatch =
        !accountFilter || legAccounts.includes(accountFilter)
      const typeMatch = !typeFilter || data.type === typeFilter

      if (accountMatch && typeMatch) {
        ids.push(trigger.id)
      }
    }

    return { ids }
  }

  // TransactionStateChanged payloads carry only id, request_id, old_state and
  // new_state (no account_id — docs: developer.revolut.com/docs/business/webhooks-v-2),
  // so this trigger filters on state transitions only.
  #filterByState(payload) {
    const ids = []
    const data = payload.eventData || {}

    for (const trigger of payload.triggers) {
      const newStateFilter = this.#resolveChoice(trigger.data?.newState, TRANSACTION_STATE_MAP)
      const oldStateFilter = this.#resolveChoice(trigger.data?.oldState, TRANSACTION_STATE_MAP)

      const newStateMatch =
        !newStateFilter || data.new_state === newStateFilter
      const oldStateMatch =
        !oldStateFilter || data.old_state === oldStateFilter

      if (newStateMatch && oldStateMatch) {
        ids.push(trigger.id)
      }
    }

    return { ids }
  }

  /**
   * @operationName Check Webhook Is Genuine
   * @category Webhooks
   * @description Confirms that an incoming webhook message really came from Revolut and was not tampered with on the way. Use this only if you are building your own webhook receiver — if you are using the On Transaction / On Payout Link triggers, this service already verifies the signature for you before firing them. Returns valid: true when the message matches the signing secret you received from Create Webhook, valid: false otherwise.
   *
   * @route POST /check-webhook-is-genuine
   * @appearanceColor #0666EB #2C7BE5
   *
   * @paramDef {"type":"String","label":"Webhook Message Body","name":"rawBody","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The exact text of the message Revolut sent to your webhook URL. Pass it through unchanged — any reformatting will cause the check to fail."}
   * @paramDef {"type":"String","label":"Signature","name":"signatureHeader","required":true,"description":"Value of the 'Revolut-Signature' header on the incoming request."}
   * @paramDef {"type":"String","label":"Timestamp","name":"timestampHeader","required":true,"description":"Value of the 'Revolut-Request-Timestamp' header on the incoming request."}
   * @paramDef {"type":"String","label":"Signing Secret","name":"signingSecret","required":true,"description":"The signing secret Revolut gave you when you created the webhook (starts with 'wsec_'). Treat it like a password."}
   *
   * @returns {Object}
   * @sampleResult {"valid":true,"reason":null}
   */
  async verifyWebhookSignature(
    rawBody,
    signatureHeader,
    timestampHeader,
    signingSecret
  ) {
    return verifyWebhookSignature({
      rawBody,
      signatureHeader,
      timestampHeader,
      signingSecret,
    })
  }
}

// Resolve a Period preset (or 'custom'/empty) to concrete from/to ISO 8601
// bounds. Custom mode honours whatever the caller supplied; presets compute
// the standard rolling window against the current clock.
function resolvePeriod(period, customFrom, customTo) {
  const normalised = period && String(period).toLowerCase()

  if (!normalised || normalised === 'custom') {
    return { from: customFrom || undefined, to: customTo || undefined }
  }

  const now = new Date()
  const iso = date => date.toISOString()
  const startOfDay = date => new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const startOfMonth = date => new Date(date.getFullYear(), date.getMonth(), 1)
  const startOfQuarter = date => new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1)
  const startOfYear = date => new Date(date.getFullYear(), 0, 1)
  const addDays = (date, days) => new Date(date.getTime() + days * 86400000)

  switch (normalised) {
    case 'today':
      return { from: iso(startOfDay(now)), to: iso(now) }

    case 'yesterday': {
      const yStart = addDays(startOfDay(now), -1)

      return { from: iso(yStart), to: iso(startOfDay(now)) }
    }

    case 'last7days':
      return { from: iso(addDays(now, -7)), to: iso(now) }
    case 'last30days':
      return { from: iso(addDays(now, -30)), to: iso(now) }
    case 'last90days':
      return { from: iso(addDays(now, -90)), to: iso(now) }
    case 'thismonth':
      return { from: iso(startOfMonth(now)), to: iso(now) }

    case 'lastmonth': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)

      return { from: iso(start), to: iso(startOfMonth(now)) }
    }

    case 'thisquarter':
      return { from: iso(startOfQuarter(now)), to: iso(now) }

    case 'lastquarter': {
      const q = startOfQuarter(now)
      const start = new Date(q.getFullYear(), q.getMonth() - 3, 1)

      return { from: iso(start), to: iso(q) }
    }

    case 'thisyear':
    case 'yeartodate':
      return { from: iso(startOfYear(now)), to: iso(now) }

    case 'lastyear': {
      const start = new Date(now.getFullYear() - 1, 0, 1)

      return { from: iso(start), to: iso(startOfYear(now)) }
    }

    default:
      return { from: customFrom || undefined, to: customTo || undefined }
  }
}

function formatBalance(balance, currency) {
  const num = Number(balance)

  if (!Number.isFinite(num)) {
    return `${ balance } ${ currency || '' }`.trim()
  }

  const symbol = { GBP: '£', EUR: '€', USD: '$', JPY: '¥' }[currency] || ''

  return `${ symbol }${ num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }`
}

// =====================================================================================
// #REGISTRATION
// =====================================================================================

Flowrunner.ServerCode.addService(RevolutBusinessService, [
  {
    order: 1,
    name: 'environment',
    displayName: 'Environment',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    options: [ENVIRONMENT_PRODUCTION, ENVIRONMENT_SANDBOX],
    defaultValue: ENVIRONMENT_PRODUCTION,
    required: true,
    shared: false,
    hint: 'Select Sandbox for development and testing against fake balances. Select Production for live banking operations.',
  },
  {
    order: 2,
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Identifier Revolut Business shows you after you upload your security certificate. Find it in the Revolut Business app under Settings → APIs.',
  },
  {
    order: 3,
    name: 'privateKey',
    displayName: 'Private Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.TEXT,
    required: true,
    shared: false,
    hint: 'The private key that pairs with the security certificate you uploaded to Revolut Business. Paste the whole block, including the BEGIN and END lines. Treat it like a password and never share it.',
  },
  {
    order: 4,
    name: 'issuer',
    displayName: 'Issuer Host',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Host part of the OAuth redirect URL you registered in your Revolut Business app, for example "your-flowrunner-host.com". No "https://" prefix, no path.',
  },
])
