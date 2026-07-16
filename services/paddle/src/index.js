'use strict'

const logger = {
  info: (...args) => console.log('[Paddle] info:', ...args),
  debug: (...args) => console.log('[Paddle] debug:', ...args),
  error: (...args) => console.log('[Paddle] error:', ...args),
  warn: (...args) => console.log('[Paddle] warn:', ...args),
}

const LIVE_BASE_URL = 'https://api.paddle.com'
const SANDBOX_BASE_URL = 'https://sandbox-api.paddle.com'

/**
 * @integrationName Paddle
 * @integrationIcon /icon.png
 */
class Paddle {
  constructor(config) {
    this.apiKey = config.apiKey
    this.baseUrl = config.environment === 'Live' ? LIVE_BASE_URL : SANDBOX_BASE_URL
  }

  // ─── Core request helper ───────────────────────────────────────────────

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=[${ JSON.stringify(query || {}) }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.apiKey }`,
          'Content-Type': 'application/json',
        })
        .query(query || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const apiError = error.body?.error
      const detail = apiError?.detail || error.body?.message || error.message
      const code = apiError?.code ? ` (code: ${ apiError.code })` : ''
      const type = apiError?.type ? ` [${ apiError.type }]` : ''
      logger.error(`${ logTag } - failed: ${ detail }${ code }${ type }`)
      throw new Error(`Paddle API error: ${ detail }${ code }${ type }`)
    }
  }

  // Map a friendly dropdown label to its API value; pass through unknown values.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Extract the `?after=` cursor from a Paddle pagination "next" URL.
  #extractCursor(pagination) {
    const next = pagination?.next
    if (!next || pagination?.has_more === false) return undefined

    try {
      return new URL(next).searchParams.get('after') || undefined
    } catch {
      return undefined
    }
  }

  // Remove undefined/empty entries so we only send fields the user supplied.
  #clean(obj) {
    const out = {}

    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined && value !== null && value !== '') out[key] = value
    }

    return out
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  PRODUCTS
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * @operationName Create Product
   * @description Creates a new product in your Paddle catalog. A product represents the item you sell (for example an app, a plan, or an add-on) and holds one or more prices. Requires a name and a tax category that determines how Paddle calculates tax. Optionally include a description, an HTTPS image URL, and custom_data key-value metadata.
   * @category Products
   * @route POST /products
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Name of the product (1-200 characters)."}
   * @paramDef {"type":"String","label":"Tax Category","name":"taxCategory","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Standard","Digital Goods","SaaS","E-books","Implementation Services","Professional Services","Software Programming Services","Training Services","Website Hosting"]}},"description":"Tax category Paddle uses to calculate tax for this product."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Short description of the product (max 2048 characters)."}
   * @paramDef {"type":"String","label":"Image URL","name":"imageUrl","required":false,"description":"Publicly accessible HTTPS URL for the product image."}
   * @paramDef {"type":"Object","label":"Custom Data","name":"customData","required":false,"description":"Arbitrary key-value metadata to store against the product."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"pro_01h1vjes1y163xfj1rh1tkfb65","name":"AI Access","tax_category":"standard","status":"active","description":"Access to AI features","image_url":null,"custom_data":null,"created_at":"2024-01-01T00:00:00Z"}}
   */
  async createProduct(name, taxCategory, description, imageUrl, customData) {
    const body = this.#clean({
      name,
      tax_category: this.#resolveTaxCategory(taxCategory),
      description,
      image_url: imageUrl,
      custom_data: customData,
    })

    return this.#apiRequest({
      url: `${ this.baseUrl }/products`,
      method: 'post',
      body,
      logTag: 'createProduct',
    })
  }

  /**
   * @operationName List Products
   * @description Retrieves a paginated list of products in your Paddle catalog. Filter by status (active or archived) and control page size. Returns products with their tax category, description, and metadata alongside pagination details for fetching further pages.
   * @category Products
   * @route GET /products
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Archived"]}},"description":"Filter products by lifecycle status."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results per page (default 50, max 200)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"description":"Pagination cursor (the after value) returned from a previous call."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"pro_01h1vjes1y163xfj1rh1tkfb65","name":"AI Access","tax_category":"standard","status":"active"}],"meta":{"pagination":{"per_page":50,"next":"https://api.paddle.com/products?after=pro_02","has_more":true,"estimated_total":120}}}
   */
  async listProducts(status, perPage, cursor) {
    const query = this.#clean({
      status: this.#resolveChoice(status, { Active: 'active', Archived: 'archived' }),
      per_page: perPage,
      after: cursor,
    })

    return this.#apiRequest({
      url: `${ this.baseUrl }/products`,
      query,
      logTag: 'listProducts',
    })
  }

  /**
   * @operationName Get Product
   * @description Retrieves a single product by its Paddle product ID (pro_...). Returns the product's name, tax category, status, description, image URL, and any custom metadata.
   * @category Products
   * @route GET /products/{productId}
   * @paramDef {"type":"String","label":"Product ID","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The Paddle product ID (pro_...) to retrieve."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"pro_01h1vjes1y163xfj1rh1tkfb65","name":"AI Access","tax_category":"standard","status":"active","description":"Access to AI features"}}
   */
  async getProduct(productId) {
    return this.#apiRequest({
      url: `${ this.baseUrl }/products/${ productId }`,
      logTag: 'getProduct',
    })
  }

  /**
   * @operationName Update Product
   * @description Updates an existing product. Supply the product ID and only the fields you want to change: name, tax category, description, image URL, custom data, or status (set to Archived to archive the product). Omitted fields are left unchanged.
   * @category Products
   * @route PATCH /products/{productId}
   * @paramDef {"type":"String","label":"Product ID","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The Paddle product ID (pro_...) to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New product name (1-200 characters)."}
   * @paramDef {"type":"String","label":"Tax Category","name":"taxCategory","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Standard","Digital Goods","SaaS","E-books","Implementation Services","Professional Services","Software Programming Services","Training Services","Website Hosting"]}},"description":"New tax category for the product."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description (max 2048 characters)."}
   * @paramDef {"type":"String","label":"Image URL","name":"imageUrl","required":false,"description":"New publicly accessible HTTPS image URL."}
   * @paramDef {"type":"Object","label":"Custom Data","name":"customData","required":false,"description":"Replacement custom key-value metadata."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Archived"]}},"description":"Set the product status. Choose Archived to archive the product."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"pro_01h1vjes1y163xfj1rh1tkfb65","name":"AI Access Pro","tax_category":"saas","status":"active"}}
   */
  async updateProduct(productId, name, taxCategory, description, imageUrl, customData, status) {
    const body = this.#clean({
      name,
      tax_category: this.#resolveTaxCategory(taxCategory),
      description,
      image_url: imageUrl,
      custom_data: customData,
      status: this.#resolveChoice(status, { Active: 'active', Archived: 'archived' }),
    })

    return this.#apiRequest({
      url: `${ this.baseUrl }/products/${ productId }`,
      method: 'patch',
      body,
      logTag: 'updateProduct',
    })
  }

  // Map friendly tax-category labels to Paddle API values.
  #resolveTaxCategory(value) {
    return this.#resolveChoice(value, {
      'Standard': 'standard',
      'Digital Goods': 'digital-goods',
      'SaaS': 'saas',
      'E-books': 'ebooks',
      'Implementation Services': 'implementation-services',
      'Professional Services': 'professional-services',
      'Software Programming Services': 'software-programming-services',
      'Training Services': 'training-services',
      'Website Hosting': 'website-hosting',
    })
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  PRICES
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * @typedef {Object} unitPrice
   * @paramDef {"type":"String","label":"Amount","name":"amount","required":true,"description":"Amount in the lowest denomination for the currency (e.g. 1000 for $10.00)."}
   * @paramDef {"type":"String","label":"Currency Code","name":"currency_code","required":true,"description":"Three-letter ISO 4217 currency code (e.g. USD, EUR, GBP)."}
   */

  /**
   * @typedef {Object} billingCycle
   * @paramDef {"type":"String","label":"Interval","name":"interval","required":true,"description":"Unit of the billing interval: day, week, month, or year."}
   * @paramDef {"type":"Number","label":"Frequency","name":"frequency","required":true,"description":"How many intervals make up the billing cycle (e.g. 1 for monthly, 3 for quarterly)."}
   */

  /**
   * @typedef {Object} trialPeriod
   * @paramDef {"type":"String","label":"Interval","name":"interval","required":true,"description":"Unit of the trial period: day, week, month, or year."}
   * @paramDef {"type":"Number","label":"Frequency","name":"frequency","required":true,"description":"How many intervals the trial lasts."}
   */

  /**
   * @operationName Create Price
   * @description Creates a price for an existing product. Set the unit price amount (in the currency's lowest denomination) and currency code. Provide a billing cycle to make it a recurring subscription price, or omit it for a one-time price. Optionally add a trial period and minimum/maximum quantity limits.
   * @category Prices
   * @route POST /prices
   * @paramDef {"type":"String","label":"Product ID","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The Paddle product ID (pro_...) this price belongs to."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":true,"description":"Internal description of the price (2-500 characters)."}
   * @paramDef {"type":"unitPrice","label":"Unit Price","name":"unitPrice","required":true,"description":"The price amount and currency."}
   * @paramDef {"type":"billingCycle","label":"Billing Cycle","name":"billingCycle","required":false,"description":"Set to make this a recurring price. Omit for a one-time price."}
   * @paramDef {"type":"trialPeriod","label":"Trial Period","name":"trialPeriod","required":false,"description":"Optional free trial before the first billing cycle."}
   * @paramDef {"type":"Number","label":"Minimum Quantity","name":"quantityMinimum","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Minimum quantity allowed per transaction (default 1)."}
   * @paramDef {"type":"Number","label":"Maximum Quantity","name":"quantityMaximum","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum quantity allowed per transaction (default 100)."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Customer-facing name of the price (1-150 characters)."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"pri_01h1vjfevh5etwq3rb416a23h2","product_id":"pro_01h1vjes1y163xfj1rh1tkfb65","description":"Monthly","unit_price":{"amount":"1000","currency_code":"USD"},"billing_cycle":{"interval":"month","frequency":1},"status":"active"}}
   */
  async createPrice(productId, description, unitPrice, billingCycle, trialPeriod, quantityMinimum, quantityMaximum, name) {
    const quantity = this.#clean({ minimum: quantityMinimum, maximum: quantityMaximum })

    const body = this.#clean({
      product_id: productId,
      description,
      name,
      unit_price: unitPrice,
      billing_cycle: billingCycle,
      trial_period: trialPeriod,
      quantity: Object.keys(quantity).length ? quantity : undefined,
    })

    return this.#apiRequest({
      url: `${ this.baseUrl }/prices`,
      method: 'post',
      body,
      logTag: 'createPrice',
    })
  }

  /**
   * @operationName List Prices
   * @description Retrieves a paginated list of prices. Filter by product ID or status (active or archived) to narrow results. Returns each price with its unit price, billing cycle, and quantity limits, plus pagination details.
   * @category Prices
   * @route GET /prices
   * @paramDef {"type":"String","label":"Product ID","name":"productId","required":false,"dictionary":"getProductsDictionary","description":"Only return prices for this product ID (pro_...)."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Archived"]}},"description":"Filter prices by lifecycle status."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results per page (default 50, max 200)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"description":"Pagination cursor (the after value) returned from a previous call."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"pri_01h1vjfevh5etwq3rb416a23h2","product_id":"pro_01h1vjes1y163xfj1rh1tkfb65","description":"Monthly","unit_price":{"amount":"1000","currency_code":"USD"},"status":"active"}],"meta":{"pagination":{"per_page":50,"has_more":false}}}
   */
  async listPrices(productId, status, perPage, cursor) {
    const query = this.#clean({
      product_id: productId,
      status: this.#resolveChoice(status, { Active: 'active', Archived: 'archived' }),
      per_page: perPage,
      after: cursor,
    })

    return this.#apiRequest({
      url: `${ this.baseUrl }/prices`,
      query,
      logTag: 'listPrices',
    })
  }

  /**
   * @operationName Get Price
   * @description Retrieves a single price by its Paddle price ID (pri_...). Returns the unit price, currency, billing cycle, trial period, quantity limits, and status.
   * @category Prices
   * @route GET /prices/{priceId}
   * @paramDef {"type":"String","label":"Price ID","name":"priceId","required":true,"dictionary":"getPricesDictionary","description":"The Paddle price ID (pri_...) to retrieve."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"pri_01h1vjfevh5etwq3rb416a23h2","product_id":"pro_01h1vjes1y163xfj1rh1tkfb65","description":"Monthly","unit_price":{"amount":"1000","currency_code":"USD"},"billing_cycle":{"interval":"month","frequency":1},"status":"active"}}
   */
  async getPrice(priceId) {
    return this.#apiRequest({
      url: `${ this.baseUrl }/prices/${ priceId }`,
      logTag: 'getPrice',
    })
  }

  /**
   * @operationName Update Price
   * @description Updates an existing price. Supply the price ID and only the fields to change: description, name, unit price, billing cycle, trial period, quantity limits, or status (set to Archived to archive the price). Omitted fields are left unchanged.
   * @category Prices
   * @route PATCH /prices/{priceId}
   * @paramDef {"type":"String","label":"Price ID","name":"priceId","required":true,"dictionary":"getPricesDictionary","description":"The Paddle price ID (pri_...) to update."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":false,"description":"New internal description of the price (2-500 characters)."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New customer-facing name of the price."}
   * @paramDef {"type":"unitPrice","label":"Unit Price","name":"unitPrice","required":false,"description":"New price amount and currency."}
   * @paramDef {"type":"billingCycle","label":"Billing Cycle","name":"billingCycle","required":false,"description":"New recurring billing cycle."}
   * @paramDef {"type":"trialPeriod","label":"Trial Period","name":"trialPeriod","required":false,"description":"New trial period."}
   * @paramDef {"type":"Number","label":"Minimum Quantity","name":"quantityMinimum","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New minimum quantity per transaction."}
   * @paramDef {"type":"Number","label":"Maximum Quantity","name":"quantityMaximum","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New maximum quantity per transaction."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Archived"]}},"description":"Set the price status. Choose Archived to archive the price."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"pri_01h1vjfevh5etwq3rb416a23h2","description":"Monthly Pro","unit_price":{"amount":"1200","currency_code":"USD"},"status":"active"}}
   */
  async updatePrice(priceId, description, name, unitPrice, billingCycle, trialPeriod, quantityMinimum, quantityMaximum, status) {
    const quantity = this.#clean({ minimum: quantityMinimum, maximum: quantityMaximum })

    const body = this.#clean({
      description,
      name,
      unit_price: unitPrice,
      billing_cycle: billingCycle,
      trial_period: trialPeriod,
      quantity: Object.keys(quantity).length ? quantity : undefined,
      status: this.#resolveChoice(status, { Active: 'active', Archived: 'archived' }),
    })

    return this.#apiRequest({
      url: `${ this.baseUrl }/prices/${ priceId }`,
      method: 'patch',
      body,
      logTag: 'updatePrice',
    })
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  CUSTOMERS
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * @operationName Create Customer
   * @description Creates a new customer record in Paddle. Requires a unique email address. Optionally include the customer's name and custom_data metadata. The returned customer ID (ctm_...) can be used when creating transactions or subscriptions.
   * @category Customers
   * @route POST /customers
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Customer's unique email address."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Customer's full name."}
   * @paramDef {"type":"Object","label":"Custom Data","name":"customData","required":false,"description":"Arbitrary key-value metadata to store against the customer."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"ctm_01h8441etc9kdrbmn0f9k9tsvw","email":"jane@example.com","name":"Jane Doe","status":"active","created_at":"2024-01-01T00:00:00Z"}}
   */
  async createCustomer(email, name, customData) {
    const body = this.#clean({ email, name, custom_data: customData })

    return this.#apiRequest({
      url: `${ this.baseUrl }/customers`,
      method: 'post',
      body,
      logTag: 'createCustomer',
    })
  }

  /**
   * @operationName List Customers
   * @description Retrieves a paginated list of customers. Filter by status (active or archived) or search by email address or name. Returns each customer with their email, name, status, and metadata plus pagination details.
   * @category Customers
   * @route GET /customers
   * @paramDef {"type":"String","label":"Search","name":"search","required":false,"description":"Filter customers by email address or name."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Archived"]}},"description":"Filter customers by lifecycle status."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results per page (default 50, max 200)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"description":"Pagination cursor (the after value) returned from a previous call."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"ctm_01h8441etc9kdrbmn0f9k9tsvw","email":"jane@example.com","name":"Jane Doe","status":"active"}],"meta":{"pagination":{"per_page":50,"has_more":false}}}
   */
  async listCustomers(search, status, perPage, cursor) {
    const query = this.#clean({
      search,
      status: this.#resolveChoice(status, { Active: 'active', Archived: 'archived' }),
      per_page: perPage,
      after: cursor,
    })

    return this.#apiRequest({
      url: `${ this.baseUrl }/customers`,
      query,
      logTag: 'listCustomers',
    })
  }

  /**
   * @operationName Get Customer
   * @description Retrieves a single customer by their Paddle customer ID (ctm_...). Returns the customer's email, name, status, locale, and custom metadata.
   * @category Customers
   * @route GET /customers/{customerId}
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The Paddle customer ID (ctm_...) to retrieve."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"ctm_01h8441etc9kdrbmn0f9k9tsvw","email":"jane@example.com","name":"Jane Doe","status":"active","locale":"en"}}
   */
  async getCustomer(customerId) {
    return this.#apiRequest({
      url: `${ this.baseUrl }/customers/${ customerId }`,
      logTag: 'getCustomer',
    })
  }

  /**
   * @operationName Update Customer
   * @description Updates an existing customer. Supply the customer ID and only the fields to change: email, name, custom data, or status. Set the status to Archived to archive the customer so they can no longer be used.
   * @category Customers
   * @route PATCH /customers/{customerId}
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The Paddle customer ID (ctm_...) to update."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":false,"description":"New unique email address."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":false,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New full name."}
   * @paramDef {"type":"Object","label":"Custom Data","name":"customData","required":false,"description":"Replacement custom key-value metadata."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Archived"]}},"description":"Set the customer status. Choose Archived to archive the customer."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"ctm_01h8441etc9kdrbmn0f9k9tsvw","email":"jane@example.com","name":"Jane Smith","status":"active"}}
   */
  async updateCustomer(customerId, email, name, customData, status) {
    const body = this.#clean({
      email,
      name,
      custom_data: customData,
      status: this.#resolveChoice(status, { Active: 'active', Archived: 'archived' }),
    })

    return this.#apiRequest({
      url: `${ this.baseUrl }/customers/${ customerId }`,
      method: 'patch',
      body,
      logTag: 'updateCustomer',
    })
  }

  /**
   * @operationName Get Customer Credit Balances
   * @description Retrieves the credit balances for a customer, grouped by currency. Returns available, reserved, and used credit amounts that can be applied to future transactions. Optionally filter to a single currency code.
   * @category Customers
   * @route GET /customers/{customerId}/credit-balances
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The Paddle customer ID (ctm_...) to retrieve credit balances for."}
   * @paramDef {"type":"String","label":"Currency Code","name":"currencyCode","required":false,"description":"Optional ISO 4217 currency code to filter balances (e.g. USD)."}
   * @returns {Object}
   * @sampleResult {"data":[{"customer_id":"ctm_01h8441etc9kdrbmn0f9k9tsvw","currency_code":"USD","balance":{"available":"500","reserved":"0","used":"0"}}]}
   */
  async getCustomerCreditBalances(customerId, currencyCode) {
    const query = this.#clean({ currency_code: currencyCode })

    return this.#apiRequest({
      url: `${ this.baseUrl }/customers/${ customerId }/credit-balances`,
      query,
      logTag: 'getCustomerCreditBalances',
    })
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  SUBSCRIPTIONS
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * @operationName List Subscriptions
   * @description Retrieves a paginated list of subscriptions. Filter by status (active, canceled, past_due, paused, or trialing) and/or by customer ID. Returns each subscription with its items, billing details, and current status alongside pagination information.
   * @category Subscriptions
   * @route GET /subscriptions
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Canceled","Past Due","Paused","Trialing"]}},"description":"Filter subscriptions by status."}
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":false,"dictionary":"getCustomersDictionary","description":"Only return subscriptions for this customer ID (ctm_...)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results per page (default 50, max 200)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"description":"Pagination cursor (the after value) returned from a previous call."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"sub_01h04vsc0qh2a7bxg3n1qkh9m4","status":"active","customer_id":"ctm_01h8441etc9kdrbmn0f9k9tsvw","currency_code":"USD"}],"meta":{"pagination":{"per_page":50,"has_more":false}}}
   */
  async listSubscriptions(status, customerId, perPage, cursor) {
    const query = this.#clean({
      status: this.#resolveChoice(status, {
        'Active': 'active',
        'Canceled': 'canceled',
        'Past Due': 'past_due',
        'Paused': 'paused',
        'Trialing': 'trialing',
      }),
      customer_id: customerId,
      per_page: perPage,
      after: cursor,
    })

    return this.#apiRequest({
      url: `${ this.baseUrl }/subscriptions`,
      query,
      logTag: 'listSubscriptions',
    })
  }

  /**
   * @operationName Get Subscription
   * @description Retrieves a single subscription by its Paddle subscription ID (sub_...). Returns the subscription's status, items, billing period, next billed date, scheduled changes, and customer details.
   * @category Subscriptions
   * @route GET /subscriptions/{subscriptionId}
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"The Paddle subscription ID (sub_...) to retrieve."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"sub_01h04vsc0qh2a7bxg3n1qkh9m4","status":"active","customer_id":"ctm_01h8441etc9kdrbmn0f9k9tsvw","next_billed_at":"2024-02-01T00:00:00Z","items":[{"price":{"id":"pri_01h1vjfevh5etwq3rb416a23h2"},"quantity":1}]}}
   */
  async getSubscription(subscriptionId) {
    return this.#apiRequest({
      url: `${ this.baseUrl }/subscriptions/${ subscriptionId }`,
      logTag: 'getSubscription',
    })
  }

  /**
   * @typedef {Object} subscriptionItem
   * @paramDef {"type":"String","label":"Price ID","name":"price_id","required":true,"description":"The Paddle price ID (pri_...) for this item."}
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","required":true,"description":"Quantity of the price to bill."}
   */

  /**
   * @operationName Update Subscription
   * @description Updates a subscription's items and billing behavior. Provide the full desired list of items (each with a price ID and quantity) to replace the current items, and choose how Paddle handles proration when the change affects billing. Only the fields you supply are changed.
   * @category Subscriptions
   * @route PATCH /subscriptions/{subscriptionId}
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"The Paddle subscription ID (sub_...) to update."}
   * @paramDef {"type":"Array<subscriptionItem>","label":"Items","name":"items","required":false,"description":"The complete desired list of subscription items. Replaces existing items."}
   * @paramDef {"type":"String","label":"Proration Billing Mode","name":"prorationBillingMode","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Prorated Immediately","Prorated Next Billing Period","Full Immediately","Full Next Billing Period","Do Not Bill"]}},"description":"How Paddle prorates and bills the change."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"sub_01h04vsc0qh2a7bxg3n1qkh9m4","status":"active","items":[{"price":{"id":"pri_01h1vjfevh5etwq3rb416a23h2"},"quantity":2}]}}
   */
  async updateSubscription(subscriptionId, items, prorationBillingMode) {
    const body = this.#clean({
      items,
      proration_billing_mode: this.#resolveChoice(prorationBillingMode, {
        'Prorated Immediately': 'prorated_immediately',
        'Prorated Next Billing Period': 'prorated_next_billing_period',
        'Full Immediately': 'full_immediately',
        'Full Next Billing Period': 'full_next_billing_period',
        'Do Not Bill': 'do_not_bill',
      }),
    })

    return this.#apiRequest({
      url: `${ this.baseUrl }/subscriptions/${ subscriptionId }`,
      method: 'patch',
      body,
      logTag: 'updateSubscription',
    })
  }

  /**
   * @operationName Pause Subscription
   * @description Pauses an active subscription. Choose when the pause takes effect: at the end of the current billing period (default) or immediately. While paused, the customer is not billed until the subscription is resumed.
   * @category Subscriptions
   * @route POST /subscriptions/{subscriptionId}/pause
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"The Paddle subscription ID (sub_...) to pause."}
   * @paramDef {"type":"String","label":"Effective From","name":"effectiveFrom","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Next Billing Period","Immediately"]}},"defaultValue":"Next Billing Period","description":"When the pause takes effect."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"sub_01h04vsc0qh2a7bxg3n1qkh9m4","status":"paused","scheduled_change":{"action":"pause","effective_at":"2024-02-01T00:00:00Z"}}}
   */
  async pauseSubscription(subscriptionId, effectiveFrom) {
    const body = this.#clean({
      effective_from: this.#resolveChoice(effectiveFrom, {
        'Next Billing Period': 'next_billing_period',
        'Immediately': 'immediately',
      }),
    })

    return this.#apiRequest({
      url: `${ this.baseUrl }/subscriptions/${ subscriptionId }/pause`,
      method: 'post',
      body,
      logTag: 'pauseSubscription',
    })
  }

  /**
   * @operationName Resume Subscription
   * @description Resumes a paused subscription. Choose when the resume takes effect: immediately or at the end of the current billing period. Once resumed, normal billing continues.
   * @category Subscriptions
   * @route POST /subscriptions/{subscriptionId}/resume
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"The Paddle subscription ID (sub_...) to resume."}
   * @paramDef {"type":"String","label":"Effective From","name":"effectiveFrom","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Immediately","Next Billing Period"]}},"defaultValue":"Immediately","description":"When the resume takes effect."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"sub_01h04vsc0qh2a7bxg3n1qkh9m4","status":"active"}}
   */
  async resumeSubscription(subscriptionId, effectiveFrom) {
    const body = this.#clean({
      effective_from: this.#resolveChoice(effectiveFrom, {
        'Immediately': 'immediately',
        'Next Billing Period': 'next_billing_period',
      }),
    })

    return this.#apiRequest({
      url: `${ this.baseUrl }/subscriptions/${ subscriptionId }/resume`,
      method: 'post',
      body,
      logTag: 'resumeSubscription',
    })
  }

  /**
   * @operationName Cancel Subscription
   * @description Cancels a subscription. Choose when the cancellation takes effect: at the end of the current billing period (so the customer keeps access until then) or immediately. Cancellation is permanent and cannot be undone.
   * @category Subscriptions
   * @route POST /subscriptions/{subscriptionId}/cancel
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"The Paddle subscription ID (sub_...) to cancel."}
   * @paramDef {"type":"String","label":"Effective From","name":"effectiveFrom","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Next Billing Period","Immediately"]}},"defaultValue":"Next Billing Period","description":"When the cancellation takes effect."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"sub_01h04vsc0qh2a7bxg3n1qkh9m4","status":"canceled","scheduled_change":{"action":"cancel","effective_at":"2024-02-01T00:00:00Z"}}}
   */
  async cancelSubscription(subscriptionId, effectiveFrom) {
    const body = this.#clean({
      effective_from: this.#resolveChoice(effectiveFrom, {
        'Next Billing Period': 'next_billing_period',
        'Immediately': 'immediately',
      }),
    })

    return this.#apiRequest({
      url: `${ this.baseUrl }/subscriptions/${ subscriptionId }/cancel`,
      method: 'post',
      body,
      logTag: 'cancelSubscription',
    })
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  TRANSACTIONS
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * @operationName List Transactions
   * @description Retrieves a paginated list of transactions. Filter by status (draft, ready, billed, paid, completed, canceled, or past_due) and/or by customer ID. Returns each transaction with its items, totals, and status alongside pagination details.
   * @category Transactions
   * @route GET /transactions
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Ready","Billed","Paid","Completed","Canceled","Past Due"]}},"description":"Filter transactions by status."}
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":false,"dictionary":"getCustomersDictionary","description":"Only return transactions for this customer ID (ctm_...)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results per page (default 50, max 200)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"description":"Pagination cursor (the after value) returned from a previous call."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"txn_01h04vsc0qh2a7bxg3n1qkh9m4","status":"completed","customer_id":"ctm_01h8441etc9kdrbmn0f9k9tsvw","currency_code":"USD"}],"meta":{"pagination":{"per_page":50,"has_more":false}}}
   */
  async listTransactions(status, customerId, perPage, cursor) {
    const query = this.#clean({
      status: this.#resolveChoice(status, {
        'Draft': 'draft',
        'Ready': 'ready',
        'Billed': 'billed',
        'Paid': 'paid',
        'Completed': 'completed',
        'Canceled': 'canceled',
        'Past Due': 'past_due',
      }),
      customer_id: customerId,
      per_page: perPage,
      after: cursor,
    })

    return this.#apiRequest({
      url: `${ this.baseUrl }/transactions`,
      query,
      logTag: 'listTransactions',
    })
  }

  /**
   * @operationName Get Transaction
   * @description Retrieves a single transaction by its Paddle transaction ID (txn_...). Returns the transaction's items, totals, tax breakdown, status, customer, and associated subscription (if any).
   * @category Transactions
   * @route GET /transactions/{transactionId}
   * @paramDef {"type":"String","label":"Transaction ID","name":"transactionId","required":true,"description":"The Paddle transaction ID (txn_...) to retrieve."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"txn_01h04vsc0qh2a7bxg3n1qkh9m4","status":"completed","customer_id":"ctm_01h8441etc9kdrbmn0f9k9tsvw","details":{"totals":{"total":"1200","currency_code":"USD"}}}}
   */
  async getTransaction(transactionId) {
    return this.#apiRequest({
      url: `${ this.baseUrl }/transactions/${ transactionId }`,
      logTag: 'getTransaction',
    })
  }

  /**
   * @typedef {Object} transactionItem
   * @paramDef {"type":"String","label":"Price ID","name":"price_id","required":true,"description":"The Paddle price ID (pri_...) to bill."}
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","required":true,"description":"Quantity of the price to include."}
   */

  /**
   * @operationName Create Transaction
   * @description Creates a transaction (an order or invoice) for a set of catalog prices. Provide one or more items, each with a price ID and quantity. Optionally attach an existing customer and choose the collection mode: automatic (Paddle charges the saved payment method) or manual (generates an invoice for the customer to pay).
   * @category Transactions
   * @route POST /transactions
   * @paramDef {"type":"Array<transactionItem>","label":"Items","name":"items","required":true,"description":"Line items to bill, each with a price ID and quantity."}
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":false,"dictionary":"getCustomersDictionary","description":"Attach this customer ID (ctm_...) to the transaction."}
   * @paramDef {"type":"String","label":"Collection Mode","name":"collectionMode","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Automatic","Manual"]}},"defaultValue":"Automatic","description":"How payment is collected. Manual generates an invoice for the customer to pay."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"txn_01h04vsc0qh2a7bxg3n1qkh9m4","status":"draft","collection_mode":"automatic","items":[{"price_id":"pri_01h1vjfevh5etwq3rb416a23h2","quantity":1}]}}
   */
  async createTransaction(items, customerId, collectionMode) {
    const body = this.#clean({
      items,
      customer_id: customerId,
      collection_mode: this.#resolveChoice(collectionMode, { Automatic: 'automatic', Manual: 'manual' }),
    })

    return this.#apiRequest({
      url: `${ this.baseUrl }/transactions`,
      method: 'post',
      body,
      logTag: 'createTransaction',
    })
  }

  /**
   * @operationName Get Transaction Invoice PDF
   * @description Retrieves a link to the PDF invoice for a billed or completed transaction. Returns a temporary, secure URL where the invoice PDF can be downloaded. The URL expires after a short period, so download it promptly.
   * @category Transactions
   * @route GET /transactions/{transactionId}/invoice
   * @paramDef {"type":"String","label":"Transaction ID","name":"transactionId","required":true,"description":"The Paddle transaction ID (txn_...) to fetch the invoice for."}
   * @returns {Object}
   * @sampleResult {"data":{"url":"https://paddle-invoice-service.s3.amazonaws.com/invoice.pdf?signature=abc"}}
   */
  async getTransactionInvoicePdf(transactionId) {
    return this.#apiRequest({
      url: `${ this.baseUrl }/transactions/${ transactionId }/invoice`,
      logTag: 'getTransactionInvoicePdf',
    })
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  DISCOUNTS
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * @operationName List Discounts
   * @description Retrieves a paginated list of discounts. Filter by status (active, archived, expired, or used) and/or by discount code. Returns each discount with its type, amount, code, and recurrence settings alongside pagination details.
   * @category Discounts
   * @route GET /discounts
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Archived","Expired","Used"]}},"description":"Filter discounts by status."}
   * @paramDef {"type":"String","label":"Code","name":"code","required":false,"description":"Filter to the discount with this exact code."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results per page (default 50, max 200)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"description":"Pagination cursor (the after value) returned from a previous call."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"dsc_01gtgztp8fpc48zh8gc3jbs4pf","status":"active","type":"percentage","amount":"10","code":"WELCOME10"}],"meta":{"pagination":{"per_page":50,"has_more":false}}}
   */
  async listDiscounts(status, code, perPage, cursor) {
    const query = this.#clean({
      status: this.#resolveChoice(status, {
        'Active': 'active',
        'Archived': 'archived',
        'Expired': 'expired',
        'Used': 'used',
      }),
      code,
      per_page: perPage,
      after: cursor,
    })

    return this.#apiRequest({
      url: `${ this.baseUrl }/discounts`,
      query,
      logTag: 'listDiscounts',
    })
  }

  /**
   * @operationName Create Discount
   * @description Creates a discount that customers can apply at checkout. Set a description, an amount, and a type: Percentage (amount is a percent, e.g. 10 for 10%) or Flat (amount is in the currency's lowest denomination). Optionally set a redemption code, make it recurring, and restrict usage limits or expiry.
   * @category Discounts
   * @route POST /discounts
   * @paramDef {"type":"String","label":"Description","name":"description","required":true,"description":"Internal description of the discount."}
   * @paramDef {"type":"String","label":"Amount","name":"amount","required":true,"description":"For Percentage: the percent (e.g. 10). For Flat: the amount in the currency's lowest denomination."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Percentage","Flat","Flat Per Seat"]}},"description":"How the discount amount is applied."}
   * @paramDef {"type":"String","label":"Currency Code","name":"currencyCode","required":false,"description":"Required for Flat and Flat Per Seat discounts. ISO 4217 code (e.g. USD)."}
   * @paramDef {"type":"String","label":"Code","name":"code","required":false,"description":"Redemption code customers enter at checkout. Omit for an automatic discount."}
   * @paramDef {"type":"Boolean","label":"Recurring","name":"recur","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"Whether the discount applies to recurring subscription payments."}
   * @paramDef {"type":"Number","label":"Maximum Recurring Intervals","name":"maximumRecurringIntervals","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"For recurring discounts, the number of billing periods it applies to."}
   * @paramDef {"type":"Number","label":"Usage Limit","name":"usageLimit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of times the discount can be redeemed."}
   * @paramDef {"type":"String","label":"Expires At","name":"expiresAt","required":false,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"RFC 3339 timestamp when the discount expires."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"dsc_01gtgztp8fpc48zh8gc3jbs4pf","status":"active","type":"percentage","amount":"10","code":"WELCOME10","recur":false}}
   */
  async createDiscount(description, amount, type, currencyCode, code, recur, maximumRecurringIntervals, usageLimit, expiresAt) {
    const body = this.#clean({
      description,
      amount,
      type: this.#resolveChoice(type, { Percentage: 'percentage', Flat: 'flat', 'Flat Per Seat': 'flat_per_seat' }),
      currency_code: currencyCode,
      code,
      recur,
      maximum_recurring_intervals: maximumRecurringIntervals,
      usage_limit: usageLimit,
      expires_at: expiresAt,
    })

    return this.#apiRequest({
      url: `${ this.baseUrl }/discounts`,
      method: 'post',
      body,
      logTag: 'createDiscount',
    })
  }

  /**
   * @operationName Get Discount
   * @description Retrieves a single discount by its Paddle discount ID (dsc_...). Returns the discount's type, amount, code, recurrence settings, usage limits, and status.
   * @category Discounts
   * @route GET /discounts/{discountId}
   * @paramDef {"type":"String","label":"Discount ID","name":"discountId","required":true,"description":"The Paddle discount ID (dsc_...) to retrieve."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"dsc_01gtgztp8fpc48zh8gc3jbs4pf","status":"active","type":"percentage","amount":"10","code":"WELCOME10"}}
   */
  async getDiscount(discountId) {
    return this.#apiRequest({
      url: `${ this.baseUrl }/discounts/${ discountId }`,
      logTag: 'getDiscount',
    })
  }

  /**
   * @operationName Update Discount
   * @description Updates an existing discount. Supply the discount ID and only the fields to change: description, amount, code, usage limit, expiry, or status (set to Archived to archive it). Omitted fields are left unchanged.
   * @category Discounts
   * @route PATCH /discounts/{discountId}
   * @paramDef {"type":"String","label":"Discount ID","name":"discountId","required":true,"description":"The Paddle discount ID (dsc_...) to update."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":false,"description":"New internal description of the discount."}
   * @paramDef {"type":"String","label":"Amount","name":"amount","required":false,"description":"New discount amount (percent for Percentage type, lowest denomination for Flat)."}
   * @paramDef {"type":"String","label":"Code","name":"code","required":false,"description":"New redemption code."}
   * @paramDef {"type":"Number","label":"Usage Limit","name":"usageLimit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New maximum number of redemptions."}
   * @paramDef {"type":"String","label":"Expires At","name":"expiresAt","required":false,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"New RFC 3339 expiry timestamp."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Archived"]}},"description":"Set the discount status. Choose Archived to archive the discount."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"dsc_01gtgztp8fpc48zh8gc3jbs4pf","status":"active","type":"percentage","amount":"15","code":"WELCOME15"}}
   */
  async updateDiscount(discountId, description, amount, code, usageLimit, expiresAt, status) {
    const body = this.#clean({
      description,
      amount,
      code,
      usage_limit: usageLimit,
      expires_at: expiresAt,
      status: this.#resolveChoice(status, { Active: 'active', Archived: 'archived' }),
    })

    return this.#apiRequest({
      url: `${ this.baseUrl }/discounts/${ discountId }`,
      method: 'patch',
      body,
      logTag: 'updateDiscount',
    })
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  ADJUSTMENTS (refunds / credits)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * @typedef {Object} adjustmentItem
   * @paramDef {"type":"String","label":"Item ID","name":"item_id","required":true,"description":"The transaction item ID (txnitm_...) to adjust."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"description":"Adjustment type for this item: full, partial, tax, or proration."}
   * @paramDef {"type":"String","label":"Amount","name":"amount","required":false,"description":"For partial adjustments, the amount in the currency's lowest denomination."}
   */

  /**
   * @operationName Create Adjustment
   * @description Creates an adjustment against a billed transaction to issue a refund or credit. Choose the action: Refund (returns money to the customer) or Credit (adds credit for manually-collected transactions). Provide a reason and either specific line items to adjust or a full adjustment covering the whole transaction.
   * @category Adjustments
   * @route POST /adjustments
   * @paramDef {"type":"String","label":"Action","name":"action","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Refund","Credit"]}},"description":"Whether to refund the customer or add credit."}
   * @paramDef {"type":"String","label":"Transaction ID","name":"transactionId","required":true,"description":"The Paddle transaction ID (txn_...) to adjust."}
   * @paramDef {"type":"String","label":"Reason","name":"reason","required":true,"description":"Reason for the adjustment (shown in Paddle and to the customer where relevant)."}
   * @paramDef {"type":"String","label":"Adjustment Type","name":"adjustmentType","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Full","Partial"]}},"defaultValue":"Full","description":"Full adjusts the entire transaction; Partial adjusts only the supplied items."}
   * @paramDef {"type":"Array<adjustmentItem>","label":"Items","name":"items","required":false,"description":"Specific transaction items to adjust. Required when Adjustment Type is Partial."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"adj_01h8gpn2h5bxsy4a30h84a5akw","action":"refund","transaction_id":"txn_01h04vsc0qh2a7bxg3n1qkh9m4","status":"pending_approval","reason":"Customer request"}}
   */
  async createAdjustment(action, transactionId, reason, adjustmentType, items) {
    const body = this.#clean({
      action: this.#resolveChoice(action, { Refund: 'refund', Credit: 'credit' }),
      transaction_id: transactionId,
      reason,
      type: this.#resolveChoice(adjustmentType, { Full: 'full', Partial: 'partial' }),
      items,
    })

    return this.#apiRequest({
      url: `${ this.baseUrl }/adjustments`,
      method: 'post',
      body,
      logTag: 'createAdjustment',
    })
  }

  /**
   * @operationName List Adjustments
   * @description Retrieves a paginated list of adjustments (refunds and credits). Filter by action (refund or credit), status, transaction ID, or customer ID. Returns each adjustment with its action, totals, status, and reason alongside pagination details.
   * @category Adjustments
   * @route GET /adjustments
   * @paramDef {"type":"String","label":"Action","name":"action","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Refund","Credit"]}},"description":"Filter adjustments by action."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Pending Approval","Approved","Rejected","Reversed"]}},"description":"Filter adjustments by status."}
   * @paramDef {"type":"String","label":"Transaction ID","name":"transactionId","required":false,"description":"Only return adjustments for this transaction ID (txn_...)."}
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":false,"dictionary":"getCustomersDictionary","description":"Only return adjustments for this customer ID (ctm_...)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results per page (default 50, max 200)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"description":"Pagination cursor (the after value) returned from a previous call."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"adj_01h8gpn2h5bxsy4a30h84a5akw","action":"refund","status":"approved","transaction_id":"txn_01h04vsc0qh2a7bxg3n1qkh9m4"}],"meta":{"pagination":{"per_page":50,"has_more":false}}}
   */
  async listAdjustments(action, status, transactionId, customerId, perPage, cursor) {
    const query = this.#clean({
      action: this.#resolveChoice(action, { Refund: 'refund', Credit: 'credit' }),
      status: this.#resolveChoice(status, {
        'Pending Approval': 'pending_approval',
        'Approved': 'approved',
        'Rejected': 'rejected',
        'Reversed': 'reversed',
      }),
      transaction_id: transactionId,
      customer_id: customerId,
      per_page: perPage,
      after: cursor,
    })

    return this.#apiRequest({
      url: `${ this.baseUrl }/adjustments`,
      query,
      logTag: 'listAdjustments',
    })
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  DICTIONARIES
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * @typedef {Object} getProductsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter products by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @operationName Get Products Dictionary
   * @description Lists active products for selection in dependent parameters. Returns each product's name as the label and its product ID (pro_...) as the value.
   * @category Dictionaries
   * @route POST /get-products-dictionary
   * @registerAs DICTIONARY
   * @paramDef {"type":"getProductsDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"AI Access","value":"pro_01h1vjes1y163xfj1rh1tkfb65","note":"active"}],"cursor":"pro_02"}
   */
  async getProductsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      url: `${ this.baseUrl }/products`,
      query: this.#clean({ status: 'active', per_page: 200, after: cursor }),
      logTag: 'getProductsDictionary',
    })

    let items = (response.data || []).map(product => ({
      label: product.name,
      value: product.id,
      note: product.status,
    }))

    if (search) {
      const term = search.toLowerCase()
      items = items.filter(item => item.label?.toLowerCase().includes(term))
    }

    return { items, cursor: this.#extractCursor(response.meta?.pagination) }
  }

  /**
   * @typedef {Object} getPricesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Product ID","name":"productId","description":"Optional product ID (pro_...) to list prices for."}
   */

  /**
   * @typedef {Object} getPricesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter prices by description or name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   * @paramDef {"type":"getPricesDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Optional criteria to scope prices to a single product."}
   */

  /**
   * @operationName Get Prices Dictionary
   * @description Lists active prices for selection in dependent parameters, optionally scoped to a single product. Returns each price's description as the label and its price ID (pri_...) as the value, with the amount and currency as a note.
   * @category Dictionaries
   * @route POST /get-prices-dictionary
   * @registerAs DICTIONARY
   * @paramDef {"type":"getPricesDictionary__payload","label":"Payload","name":"payload","description":"Optional search text, pagination cursor, and product criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Monthly","value":"pri_01h1vjfevh5etwq3rb416a23h2","note":"1000 USD"}],"cursor":"pri_02"}
   */
  async getPricesDictionary(payload) {
    const { search, cursor, criteria } = payload || {}

    const response = await this.#apiRequest({
      url: `${ this.baseUrl }/prices`,
      query: this.#clean({
        status: 'active',
        per_page: 200,
        after: cursor,
        product_id: criteria?.productId,
      }),
      logTag: 'getPricesDictionary',
    })

    let items = (response.data || []).map(price => ({
      label: price.name || price.description,
      value: price.id,
      note: price.unit_price ? `${ price.unit_price.amount } ${ price.unit_price.currency_code }` : price.status,
    }))

    if (search) {
      const term = search.toLowerCase()
      items = items.filter(item => item.label?.toLowerCase().includes(term))
    }

    return { items, cursor: this.#extractCursor(response.meta?.pagination) }
  }

  /**
   * @typedef {Object} getCustomersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter customers by email or name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @operationName Get Customers Dictionary
   * @description Lists active customers for selection in dependent parameters. Returns each customer's name or email as the label and their customer ID (ctm_...) as the value.
   * @category Dictionaries
   * @route POST /get-customers-dictionary
   * @registerAs DICTIONARY
   * @paramDef {"type":"getCustomersDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Jane Doe","value":"ctm_01h8441etc9kdrbmn0f9k9tsvw","note":"jane@example.com"}],"cursor":"ctm_02"}
   */
  async getCustomersDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      url: `${ this.baseUrl }/customers`,
      query: this.#clean({ status: 'active', per_page: 200, after: cursor, search }),
      logTag: 'getCustomersDictionary',
    })

    const items = (response.data || []).map(customer => ({
      label: customer.name || customer.email,
      value: customer.id,
      note: customer.email,
    }))

    return { items, cursor: this.#extractCursor(response.meta?.pagination) }
  }
}

Flowrunner.ServerCode.addService(Paddle, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Paddle API key (pdl_...). Get it from Paddle → Developer Tools → Authentication → API keys.',
  },
  {
    name: 'environment',
    displayName: 'Environment',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    options: ['Sandbox', 'Live'],
    defaultValue: 'Sandbox',
    required: true,
    shared: false,
    hint: 'Choose Sandbox for testing (sandbox-api.paddle.com) or Live for production (api.paddle.com). Your API key must match the selected environment.',
  },
])
