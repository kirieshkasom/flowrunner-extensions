const logger = {
  info: (...args) => console.log('[Wise] info:', ...args),
  debug: (...args) => console.log('[Wise] debug:', ...args),
  error: (...args) => console.log('[Wise] error:', ...args),
  warn: (...args) => console.log('[Wise] warn:', ...args),
}

const LIVE_BASE_URL = 'https://api.wise.com'
const SANDBOX_BASE_URL = 'https://api.sandbox.transferwise.tech'

// Simple monotonic counter used to help build a fallback idempotency key when
// the caller does not supply their own customerTransactionId.
let transactionCounter = 0

function clean(obj) {
  if (!obj) {
    return obj
  }

  const result = {}

  for (const key in obj) {
    const value = obj[key]

    if (value !== undefined && value !== null && value !== '') {
      result[key] = value
    }
  }

  return result
}

/**
 * @integrationName Wise
 * @integrationIcon /icon.svg
 */
class WiseService {
  constructor(config) {
    this.apiToken = config.apiToken
    this.environment = config.environment || 'Sandbox'
    this.baseUrl = this.environment === 'Live' ? LIVE_BASE_URL : SANDBOX_BASE_URL
  }

  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const url = `${ this.baseUrl }${ path }`

    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.apiToken }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const body = error.body || {}
      const message =
        (Array.isArray(body.errors) && body.errors.length ? body.errors.map(e => e.message).filter(Boolean).join('; ') : null) ||
        body.message ||
        body.error ||
        error.message ||
        'Unknown error'

      logger.error(`${ logTag } - Request failed: ${ message }`)

      throw new Error(`Wise API error: ${ message }`)
    }
  }

  // Resolves a friendly dropdown label to the API value it maps to. Returns the
  // raw value when no mapping exists so free-typed values still pass through.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Builds an RFC-4122-style UUID v4 without Math.random (which is banned).
  // Derives entropy from a per-instance counter, the current time, and the API
  // token so keys are unique enough to serve as an idempotency key fallback.
  #buildTransactionId() {
    transactionCounter += 1

    const seed = `${ Date.now() }-${ transactionCounter }-${ this.apiToken || '' }-${ process.hrtime ? process.hrtime.bigint().toString() : '' }`
    const hex = []

    // Deterministic byte stream derived from the seed (djb2-style rolling hash).
    let hash = 5381

    for (let i = 0; i < 32; i++) {
      hash = ((hash << 5) + hash + seed.charCodeAt(i % seed.length) + i) & 0xffffffff
      hex.push(((hash >>> ((i % 4) * 8)) & 0xff).toString(16).padStart(2, '0'))
    }

    // Force the version (4) and variant (8-b) nibbles per RFC 4122.
    hex[6] = `4${ hex[6][1] }`
    hex[8] = `${ ['8', '9', 'a', 'b'][hash & 0x3] }${ hex[8][1] }`

    const h = hex.join('')

    return `${ h.slice(0, 8) }-${ h.slice(8, 12) }-${ h.slice(12, 16) }-${ h.slice(16, 20) }-${ h.slice(20, 32) }`
  }

  /**
   * @operationName List Profiles
   * @category Profiles
   * @description Lists all Wise profiles (personal and business) available to the authenticated token. This is the first call to make: every scoped operation (quotes, transfers, balances, recipients) needs a profileId taken from here. Personal profiles hold your individual account; business profiles hold an organization's account.
   * @route GET /profiles
   * @appearanceColor #00B9FF #163300
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":12345,"type":"personal","details":{"firstName":"Jane","lastName":"Doe"}},{"id":67890,"type":"business","details":{"name":"Acme Ltd"}}]
   */
  async listProfiles() {
    return await this.#apiRequest({
      logTag: '[listProfiles]',
      path: '/v1/profiles',
      method: 'get',
    })
  }

  /**
   * @operationName Get Profile
   * @category Profiles
   * @description Retrieves a single Wise profile by its ID, returning its type (personal or business) and detail fields. Use List Profiles first to discover available profile IDs.
   * @route GET /profiles/get
   * @appearanceColor #00B9FF #163300
   *
   * @paramDef {"type":"Number","label":"Profile ID","name":"profileId","required":true,"dictionary":"getProfilesDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the Wise profile to retrieve. Select from your profiles or enter an ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":12345,"type":"personal","details":{"firstName":"Jane","lastName":"Doe"}}
   */
  async getProfile(profileId) {
    return await this.#apiRequest({
      logTag: '[getProfile]',
      path: `/v1/profiles/${ profileId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Quote
   * @category Quotes
   * @description Creates a quote for a currency conversion or cross-border transfer. Provide the source and target currencies plus exactly one of source amount (amount you will pay) or target amount (amount the recipient receives). Returns the exchange rate, fees, expiry, and available payment options; the returned quote id is required to create a transfer. Quotes expire, so create one shortly before creating the transfer.
   * @route POST /profiles/quotes
   * @appearanceColor #00B9FF #163300
   *
   * @paramDef {"type":"Number","label":"Profile ID","name":"profileId","required":true,"dictionary":"getProfilesDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Profile that owns the quote. Get it from List Profiles."}
   * @paramDef {"type":"String","label":"Source Currency","name":"sourceCurrency","required":true,"description":"Three-letter ISO code of the currency you send from, e.g. GBP, USD, EUR."}
   * @paramDef {"type":"String","label":"Target Currency","name":"targetCurrency","required":true,"description":"Three-letter ISO code of the currency the recipient receives, e.g. EUR, USD."}
   * @paramDef {"type":"Number","label":"Source Amount","name":"sourceAmount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Amount to send in the source currency. Provide either Source Amount or Target Amount, not both."}
   * @paramDef {"type":"Number","label":"Target Amount","name":"targetAmount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Amount the recipient should receive in the target currency. Provide either Source Amount or Target Amount, not both."}
   * @paramDef {"type":"String","label":"Pay Out Method","name":"payOut","uiComponent":{"type":"DROPDOWN","options":{"values":["Bank Transfer","Balance","Swift","Interac"]}},"description":"How the money is paid out to the recipient. Defaults to Bank Transfer."}
   *
   * @returns {Object}
   * @sampleResult {"id":"11144c35-9fe8-4c32-b7fd-d05e2a965d80","sourceCurrency":"GBP","targetCurrency":"EUR","sourceAmount":100,"targetAmount":114.5,"rate":1.1642,"payOut":"BANK_TRANSFER","paymentOptions":[{"payIn":"BALANCE","payOut":"BANK_TRANSFER","fee":{"total":0.42},"targetAmount":114.5}],"expirationTime":"2026-07-14T12:00:00Z"}
   */
  async createQuote(profileId, sourceCurrency, targetCurrency, sourceAmount, targetAmount, payOut) {
    const body = clean({
      sourceCurrency,
      targetCurrency,
      sourceAmount,
      targetAmount,
      payOut: this.#resolveChoice(payOut, {
        'Bank Transfer': 'BANK_TRANSFER',
        'Balance': 'BALANCE',
        'Swift': 'SWIFT',
        'Interac': 'INTERAC',
      }),
    })

    return await this.#apiRequest({
      logTag: '[createQuote]',
      path: `/v3/profiles/${ profileId }/quotes`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Get Quote
   * @category Quotes
   * @description Retrieves a previously created quote by its ID, including the exchange rate, fees, payment options, and expiry status. Use this to re-read a quote before creating a transfer.
   * @route GET /profiles/quotes/get
   * @appearanceColor #00B9FF #163300
   *
   * @paramDef {"type":"Number","label":"Profile ID","name":"profileId","required":true,"dictionary":"getProfilesDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Profile that owns the quote."}
   * @paramDef {"type":"String","label":"Quote ID","name":"quoteId","required":true,"description":"ID (UUID) of the quote returned by Create Quote."}
   *
   * @returns {Object}
   * @sampleResult {"id":"11144c35-9fe8-4c32-b7fd-d05e2a965d80","sourceCurrency":"GBP","targetCurrency":"EUR","sourceAmount":100,"targetAmount":114.5,"rate":1.1642,"payOut":"BANK_TRANSFER","expirationTime":"2026-07-14T12:00:00Z"}
   */
  async getQuote(profileId, quoteId) {
    return await this.#apiRequest({
      logTag: '[getQuote]',
      path: `/v3/profiles/${ profileId }/quotes/${ quoteId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Recipient Account
   * @category Recipients
   * @description Creates a recipient (payee) account that transfers can be sent to. The required detail fields vary by currency and account type: a GBP sort-code account needs sortCode and accountNumber, an EUR IBAN account needs an iban, an email recipient needs email, and so on. Pass those fields as a raw Details object; consult the Wise Platform "Recipient account requirements" docs for the exact fields per currency/type. Returns the new recipient account with its numeric id, used as the targetAccount when creating a transfer.
   * @route POST /accounts
   * @appearanceColor #00B9FF #163300
   *
   * @paramDef {"type":"Number","label":"Profile ID","name":"profile","required":true,"dictionary":"getProfilesDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Profile that owns the recipient. Get it from List Profiles."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","required":true,"description":"Three-letter ISO code of the recipient account currency, e.g. GBP, EUR, USD."}
   * @paramDef {"type":"String","label":"Account Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Email","Sort Code","IBAN","ABA (US)","Aba","Canadian","Australian","Interac"]}},"description":"Recipient account type. The type must match the currency (e.g. Sort Code for GBP, IBAN for EUR, ABA for USD)."}
   * @paramDef {"type":"String","label":"Account Holder Name","name":"accountHolderName","required":true,"description":"Full legal name of the recipient account holder."}
   * @paramDef {"type":"Object","label":"Details","name":"details","required":true,"description":"Type-specific bank details as a JSON object. Fields vary by currency/type, e.g. {\"iban\":\"DE89...\"} for IBAN, {\"sortCode\":\"231470\",\"accountNumber\":\"28821822\"} for GBP sort code, {\"email\":\"jane@example.com\"} for email. Legal type (PRIVATE/BUSINESS) and address may also be required."}
   *
   * @returns {Object}
   * @sampleResult {"id":40000000,"profile":12345,"accountHolderName":"Jane Doe","currency":"EUR","type":"iban","details":{"iban":"DE89370400440532013000","legalType":"PRIVATE"}}
   */
  async createRecipientAccount(profile, currency, type, accountHolderName, details) {
    const resolvedType = this.#resolveChoice(type, {
      'Email': 'email',
      'Sort Code': 'sort_code',
      'IBAN': 'iban',
      'ABA (US)': 'aba',
      'Aba': 'aba',
      'Canadian': 'canadian',
      'Australian': 'australian',
      'Interac': 'interac',
    })

    const body = clean({
      profile,
      currency,
      type: resolvedType,
      accountHolderName,
      details: details || undefined,
    })

    return await this.#apiRequest({
      logTag: '[createRecipientAccount]',
      path: '/v1/accounts',
      method: 'post',
      body,
    })
  }

  /**
   * @operationName List Recipient Accounts
   * @category Recipients
   * @description Lists recipient (payee) accounts belonging to a profile, optionally filtered by currency. Returns each recipient's id, holder name, currency, and type. Use a recipient's id as the targetAccount when creating a transfer.
   * @route GET /accounts
   * @appearanceColor #00B9FF #163300
   *
   * @paramDef {"type":"Number","label":"Profile ID","name":"profile","required":true,"dictionary":"getProfilesDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Profile whose recipients to list."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","description":"Optional three-letter ISO currency code to filter recipients, e.g. EUR."}
   *
   * @returns {Object}
   * @sampleResult {"content":[{"id":40000000,"accountHolderName":"Jane Doe","currency":"EUR","type":"iban"}]}
   */
  async listRecipientAccounts(profile, currency) {
    return await this.#apiRequest({
      logTag: '[listRecipientAccounts]',
      path: '/v1/accounts',
      method: 'get',
      query: { profile, currency },
    })
  }

  /**
   * @operationName Get Recipient Account
   * @category Recipients
   * @description Retrieves a single recipient (payee) account by its numeric ID, returning the holder name, currency, type, and bank details.
   * @route GET /accounts/get
   * @appearanceColor #00B9FF #163300
   *
   * @paramDef {"type":"Number","label":"Recipient Account ID","name":"accountId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the recipient account."}
   *
   * @returns {Object}
   * @sampleResult {"id":40000000,"profile":12345,"accountHolderName":"Jane Doe","currency":"EUR","type":"iban","details":{"iban":"DE89370400440532013000"}}
   */
  async getRecipientAccount(accountId) {
    return await this.#apiRequest({
      logTag: '[getRecipientAccount]',
      path: `/v1/accounts/${ accountId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Delete Recipient Account
   * @category Recipients
   * @description Deletes (deactivates) a recipient (payee) account by its numeric ID so it can no longer receive transfers. This does not affect transfers already sent to it.
   * @route DELETE /accounts
   * @appearanceColor #00B9FF #163300
   *
   * @paramDef {"type":"Number","label":"Recipient Account ID","name":"accountId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the recipient account to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"accountId":40000000}
   */
  async deleteRecipientAccount(accountId) {
    await this.#apiRequest({
      logTag: '[deleteRecipientAccount]',
      path: `/v1/accounts/${ accountId }`,
      method: 'delete',
    })

    return { success: true, accountId }
  }

  /**
   * @operationName Create Transfer
   * @category Transfers
   * @description Creates a transfer from a quote to a recipient account. Requires the recipient account id (targetAccount) and the quote id (quoteUuid) from Create Quote. A customerTransactionId (UUID v4) acts as an idempotency key: pass your own to safely retry without creating duplicates, or leave it empty and one is generated for you. The transfer is created in an unfunded state; call Fund Transfer afterwards to actually move the money. Optionally attach a payment reference shown to the recipient.
   * @route POST /transfers
   * @appearanceColor #00B9FF #163300
   *
   * @paramDef {"type":"Number","label":"Target Account (Recipient) ID","name":"targetAccount","required":true,"dictionary":"getRecipientAccountsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the recipient account to pay. Get it from List Recipient Accounts."}
   * @paramDef {"type":"String","label":"Quote UUID","name":"quoteUuid","required":true,"description":"ID (UUID) of the quote from Create Quote that this transfer is based on."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"Optional payment reference shown to the recipient (kept short, typically up to ~35 characters depending on target)."}
   * @paramDef {"type":"String","label":"Customer Transaction ID","name":"customerTransactionId","description":"Optional UUID v4 idempotency key. Reuse the same value to retry a request without creating a duplicate transfer. Leave empty to auto-generate one."}
   *
   * @returns {Object}
   * @sampleResult {"id":16521632,"user":55555,"targetAccount":40000000,"quoteUuid":"11144c35-9fe8-4c32-b7fd-d05e2a965d80","status":"incoming_payment_waiting","reference":"Invoice 42","customerTransactionId":"6d0d81f6-cb15-42fb-9d09-a1c4e3f4d000"}
   */
  async createTransfer(targetAccount, quoteUuid, reference, customerTransactionId) {
    const body = clean({
      targetAccount,
      quoteUuid,
      customerTransactionId: customerTransactionId || this.#buildTransactionId(),
      details: reference ? { reference } : undefined,
    })

    return await this.#apiRequest({
      logTag: '[createTransfer]',
      path: '/v1/transfers',
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Get Transfer
   * @category Transfers
   * @description Retrieves a single transfer by its numeric ID, including its current status, amounts, rate, recipient, and reference.
   * @route GET /transfers/get
   * @appearanceColor #00B9FF #163300
   *
   * @paramDef {"type":"Number","label":"Transfer ID","name":"transferId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the transfer to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":16521632,"status":"incoming_payment_waiting","sourceCurrency":"GBP","targetCurrency":"EUR","sourceValue":100,"targetValue":114.5,"rate":1.1642,"reference":"Invoice 42"}
   */
  async getTransfer(transferId) {
    return await this.#apiRequest({
      logTag: '[getTransfer]',
      path: `/v1/transfers/${ transferId }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Transfers
   * @category Transfers
   * @description Lists transfers for a profile, optionally filtered by status and paginated with limit and offset. Returns each transfer's id, status, amounts, and recipient. Use the status filter to find, for example, transfers still awaiting funding.
   * @route GET /transfers
   * @appearanceColor #00B9FF #163300
   *
   * @paramDef {"type":"Number","label":"Profile ID","name":"profile","required":true,"dictionary":"getProfilesDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Profile whose transfers to list."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Incoming Payment Waiting","Processing","Funds Converted","Outgoing Payment Sent","Cancelled","Funds Refunded","Bounced Back"]}},"description":"Optional transfer status to filter by."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of transfers to return (default 100)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of transfers to skip for pagination (default 0)."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":16521632,"status":"outgoing_payment_sent","sourceCurrency":"GBP","targetCurrency":"EUR","sourceValue":100,"targetValue":114.5,"reference":"Invoice 42"}]
   */
  async listTransfers(profile, status, limit, offset) {
    const resolvedStatus = this.#resolveChoice(status, {
      'Incoming Payment Waiting': 'incoming_payment_waiting',
      'Processing': 'processing',
      'Funds Converted': 'funds_converted',
      'Outgoing Payment Sent': 'outgoing_payment_sent',
      'Cancelled': 'cancelled',
      'Funds Refunded': 'funds_refunded',
      'Bounced Back': 'bounced_back',
    })

    return await this.#apiRequest({
      logTag: '[listTransfers]',
      path: '/v1/transfers',
      method: 'get',
      query: {
        profile,
        status: resolvedStatus,
        limit: limit !== undefined ? limit : 100,
        offset,
      },
    })
  }

  /**
   * @operationName Cancel Transfer
   * @category Transfers
   * @description Cancels a transfer by its numeric ID. Only transfers that have not yet been fully processed (typically still awaiting incoming payment/funding) can be cancelled. Returns the transfer with its updated status.
   * @route PUT /transfers/cancel
   * @appearanceColor #00B9FF #163300
   *
   * @paramDef {"type":"Number","label":"Transfer ID","name":"transferId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the transfer to cancel."}
   *
   * @returns {Object}
   * @sampleResult {"id":16521632,"status":"cancelled"}
   */
  async cancelTransfer(transferId) {
    return await this.#apiRequest({
      logTag: '[cancelTransfer]',
      path: `/v1/transfers/${ transferId }/cancel`,
      method: 'put',
    })
  }

  /**
   * @operationName Fund Transfer
   * @category Transfers
   * @description Funds a previously created transfer from your Wise multi-currency balance, which is what actually starts moving the money. The transfer's source currency balance must hold enough funds. This uses payment type BALANCE; other pay-in methods (e.g. bank debit) are not covered here. Returns the payment result and updated transfer status.
   * @route POST /profiles/transfers/payments
   * @appearanceColor #00B9FF #163300
   *
   * @paramDef {"type":"Number","label":"Profile ID","name":"profileId","required":true,"dictionary":"getProfilesDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Profile that owns the transfer and balance."}
   * @paramDef {"type":"Number","label":"Transfer ID","name":"transferId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the transfer to fund."}
   *
   * @returns {Object}
   * @sampleResult {"type":"BALANCE","status":"COMPLETED","errorCode":null}
   */
  async fundTransfer(profileId, transferId) {
    return await this.#apiRequest({
      logTag: '[fundTransfer]',
      path: `/v3/profiles/${ profileId }/transfers/${ transferId }/payments`,
      method: 'post',
      body: { type: 'BALANCE' },
    })
  }

  /**
   * @operationName Get Account Balances
   * @category Balances
   * @description Retrieves the multi-currency account balances for a profile. By default returns STANDARD balances (spendable multi-currency account balances). Each balance includes its currency, available amount, and reserved amount.
   * @route GET /profiles/balances
   * @appearanceColor #00B9FF #163300
   *
   * @paramDef {"type":"Number","label":"Profile ID","name":"profileId","required":true,"dictionary":"getProfilesDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Profile whose balances to retrieve."}
   * @paramDef {"type":"String","label":"Balance Type","name":"types","uiComponent":{"type":"DROPDOWN","options":{"values":["Standard","Savings"]}},"description":"Type of balances to return. Defaults to Standard (spendable multi-currency balances)."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":100000,"currency":"GBP","type":"STANDARD","amount":{"value":1000.5,"currency":"GBP"},"reservedAmount":{"value":0,"currency":"GBP"}}]
   */
  async getAccountBalances(profileId, types) {
    const resolvedTypes = this.#resolveChoice(types, {
      'Standard': 'STANDARD',
      'Savings': 'SAVINGS',
    })

    return await this.#apiRequest({
      logTag: '[getAccountBalances]',
      path: `/v4/profiles/${ profileId }/balances`,
      method: 'get',
      query: { types: resolvedTypes || 'STANDARD' },
    })
  }

  /**
   * @operationName Get Exchange Rate
   * @category Rates
   * @description Returns the current mid-market exchange rate for a currency pair. Provide source and target ISO currency codes. Useful for displaying an indicative rate before creating a quote; the actual transfer rate comes from Create Quote.
   * @route GET /rates
   * @appearanceColor #00B9FF #163300
   *
   * @paramDef {"type":"String","label":"Source Currency","name":"source","required":true,"description":"Three-letter ISO code of the source currency, e.g. GBP."}
   * @paramDef {"type":"String","label":"Target Currency","name":"target","required":true,"description":"Three-letter ISO code of the target currency, e.g. EUR."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"rate":1.1642,"source":"GBP","target":"EUR","time":"2026-07-14T10:00:00+0000"}]
   */
  async getExchangeRate(source, target) {
    return await this.#apiRequest({
      logTag: '[getExchangeRate]',
      path: '/v1/rates',
      method: 'get',
      query: { source, target },
    })
  }

  /**
   * @operationName List Currencies
   * @category Currencies
   * @description Returns the list of currencies supported by Wise, each with its ISO code, name, and symbol. Use this to populate currency selectors or validate currency codes before creating quotes or recipients.
   * @route GET /currencies
   * @appearanceColor #00B9FF #163300
   *
   * @returns {Array<Object>}
   * @sampleResult [{"code":"GBP","symbol":"£","name":"British Pound","countryKeywords":["United Kingdom"]},{"code":"EUR","symbol":"€","name":"Euro"}]
   */
  async listCurrencies() {
    return await this.#apiRequest({
      logTag: '[listCurrencies]',
      path: '/v1/currencies',
      method: 'get',
    })
  }

  /**
   * @typedef {Object} getProfilesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter profiles by name or type."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Profiles return in a single call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Profiles Dictionary
   * @description Provides a selectable list of the token's Wise profiles (personal and business) for choosing a Profile ID on scoped operations. The option value is the numeric profile id.
   * @route POST /get-profiles-dictionary
   * @paramDef {"type":"getProfilesDictionary__payload","label":"Payload","name":"payload","description":"Optional search string used to filter the profile list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Jane Doe (personal)","value":"12345","note":"personal"}],"cursor":null}
   */
  async getProfilesDictionary(payload) {
    const { search } = payload || {}

    const profiles = await this.#apiRequest({
      logTag: '[getProfilesDictionary]',
      path: '/v1/profiles',
      method: 'get',
    })

    const list = Array.isArray(profiles) ? profiles : []

    const items = list
      .map(profile => {
        const details = profile.details || {}
        const name = details.name || [details.firstName, details.lastName].filter(Boolean).join(' ') || `Profile ${ profile.id }`

        return {
          label: `${ name } (${ profile.type })`,
          value: String(profile.id),
          note: profile.type,
        }
      })
      .filter(item => !search || item.label.toLowerCase().includes(search.toLowerCase()))

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} getRecipientAccountsDictionary__payloadCriteria
   * @paramDef {"type":"Number","label":"Profile ID","name":"profileId","required":true,"description":"Profile whose recipient accounts to list."}
   */

  /**
   * @typedef {Object} getRecipientAccountsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter recipients by holder name or currency."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Recipients return in a single call, so this is unused but kept for API compatibility."}
   * @paramDef {"type":"getRecipientAccountsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Dependency values, including the selected Profile ID."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Recipient Accounts Dictionary
   * @description Provides a selectable list of a profile's recipient (payee) accounts for choosing a Target Account on Create Transfer. Depends on a Profile ID; the option value is the numeric recipient account id.
   * @route POST /get-recipient-accounts-dictionary
   * @paramDef {"type":"getRecipientAccountsDictionary__payload","label":"Payload","name":"payload","description":"Search text plus criteria carrying the selected Profile ID."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Jane Doe - EUR","value":"40000000","note":"iban"}],"cursor":null}
   */
  async getRecipientAccountsDictionary(payload) {
    const { search, criteria } = payload || {}
    const profileId = criteria?.profileId

    if (!profileId) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      logTag: '[getRecipientAccountsDictionary]',
      path: '/v1/accounts',
      method: 'get',
      query: { profile: profileId },
    })

    const list = Array.isArray(response) ? response : (response.content || [])

    const items = list
      .map(account => ({
        label: `${ account.accountHolderName || 'Recipient' } - ${ account.currency }`,
        value: String(account.id),
        note: account.type,
      }))
      .filter(item => !search || item.label.toLowerCase().includes(search.toLowerCase()))

    return { items, cursor: null }
  }
}

Flowrunner.ServerCode.addService(WiseService, [
  {
    name: 'apiToken',
    displayName: 'API Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Wise → Settings → API tokens. Create a personal token; business and platform tokens also work. Sent as "Authorization: Bearer <token>".',
  },
  {
    name: 'environment',
    displayName: 'Environment',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    required: true,
    shared: false,
    options: ['Sandbox', 'Live'],
    defaultValue: 'Sandbox',
    hint: 'Choose Sandbox (api.sandbox.transferwise.tech) for testing with a sandbox token, or Live (api.wise.com) for production.',
  },
])
