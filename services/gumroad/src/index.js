const logger = {
  info: (...args) => console.log('[Gumroad] info:', ...args),
  debug: (...args) => console.log('[Gumroad] debug:', ...args),
  error: (...args) => console.log('[Gumroad] error:', ...args),
  warn: (...args) => console.log('[Gumroad] warn:', ...args),
}

const API_BASE_URL = 'https://api.gumroad.com/v2'

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
 * @integrationName Gumroad
 * @integrationIcon /icon.png
 */
class GumroadService {
  constructor(config) {
    this.accessToken = config.accessToken
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.accessToken }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery)

      const response = body !== undefined ? await request.send(clean(body)) : await request

      // Gumroad wraps responses as { success: true/false, ... }. A false success
      // still returns HTTP 200, so surface the message explicitly.
      if (response && response.success === false) {
        throw new Error(`Gumroad API error: ${ response.message || 'Request was not successful' }`)
      }

      return response
    } catch (error) {
      if (error.message && error.message.startsWith('Gumroad API error:')) {
        throw error
      }

      const status = error.status || error.statusCode
      const message = error.body?.message ||
        (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))

      logger.error(`${ logTag } - failed${ status ? ` (${ status })` : '' }: ${ message }`)

      throw new Error(`Gumroad API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  /**
   * @operationName Get Current User
   * @category User
   * @description Retrieves the profile of the authenticated Gumroad user, including id, name, email, bio, profile URL and currency. Useful as a connection/health check to confirm the access token is valid.
   * @route GET /user
   *
   * @returns {Object}
   * @sampleResult {"success":true,"user":{"bio":"a sailor, a tailor","name":"John Smith","twitter_handle":null,"user_id":"G_-mnBf9b1j9A7a4ub4nFQ==","email":"johnsmith@gumroad.com","url":"https://gumroad.com/johnsmith","currency_type":"usd"}}
   */
  async getCurrentUser() {
    const logTag = '[getCurrentUser]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/user`,
      method: 'get',
    })
  }

  /**
   * @operationName List Products
   * @category Products
   * @description Retrieves all products for the authenticated Gumroad account. Each product includes its id, name, price (in the currency's smallest unit), formatted price, permalink/short_url, published state, sales count and total revenue.
   * @route GET /products
   *
   * @returns {Object}
   * @sampleResult {"success":true,"products":[{"custom_permalink":null,"custom_receipt":null,"custom_summary":"You'll get one PDF file.","id":"A-yG7uSPnfyChzBDR9zaXQ==","url":"https://gumroad.com/l/pencil","name":"Pencil","preview_url":null,"description":"An eBook.","customizable_price":null,"require_shipping":false,"published":true,"price":100,"currency":"usd","short_url":"https://gum.co/pencil","sales_count":3,"sales_usd_cents":300}]}
   */
  async listProducts() {
    const logTag = '[listProducts]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/products`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Product
   * @category Products
   * @description Retrieves a single product by its Gumroad id, including price, description, published state, variant/tier information and sales metrics.
   * @route GET /products/{productId}
   *
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The Gumroad product id. Search and select a product, or enter an id directly."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"product":{"id":"A-yG7uSPnfyChzBDR9zaXQ==","name":"Pencil","published":true,"price":100,"currency":"usd","short_url":"https://gum.co/pencil","sales_count":3,"sales_usd_cents":300}}
   */
  async getProduct(productId) {
    const logTag = '[getProduct]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/products/${ encodeURIComponent(productId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Delete Product
   * @category Products
   * @description Permanently deletes a product from the authenticated Gumroad account. This action cannot be undone. Returns a confirmation message on success.
   * @route DELETE /products/{productId}
   *
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The Gumroad product id to delete. Search and select a product, or enter an id directly."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"The product was deleted successfully."}
   */
  async deleteProduct(productId) {
    const logTag = '[deleteProduct]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/products/${ encodeURIComponent(productId) }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Enable or Disable Product
   * @category Products
   * @description Publishes (enables) or unpublishes (disables) a product. When enabled the product is available for sale; when disabled it is hidden from customers. Returns the updated product.
   * @route PUT /products/{productId}/enable
   *
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The Gumroad product id. Search and select a product, or enter an id directly."}
   * @paramDef {"type":"String","label":"Action","name":"action","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Enable","Disable"]}},"defaultValue":"Enable","description":"Choose Enable to publish the product or Disable to unpublish it."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"product":{"id":"A-yG7uSPnfyChzBDR9zaXQ==","name":"Pencil","published":true,"price":100,"currency":"usd"}}
   */
  async setProductPublishState(productId, action) {
    const logTag = '[setProductPublishState]'
    const path = this.#resolveChoice(action, { Enable: 'enable', Disable: 'disable' })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/products/${ encodeURIComponent(productId) }/${ path }`,
      method: 'put',
    })
  }

  /**
   * @operationName List Sales
   * @category Sales
   * @description Retrieves successful sales for the authenticated account, most recent first. Supports filtering by date range, product and buyer email. Results are paginated — use the returned next_page_key with the Page Key parameter to fetch subsequent pages.
   * @route GET /sales
   *
   * @paramDef {"type":"String","label":"After Date","name":"after","uiComponent":{"type":"DATE_PICKER"},"description":"Only include sales after this date (format YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"Before Date","name":"before","uiComponent":{"type":"DATE_PICKER"},"description":"Only include sales before this date (format YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"Product","name":"productId","dictionary":"getProductsDictionary","description":"Filter sales to a single product. Search and select a product, or enter an id directly."}
   * @paramDef {"type":"String","label":"Buyer Email","name":"email","description":"Filter sales by the buyer's email address."}
   * @paramDef {"type":"String","label":"Page Key","name":"pageKey","description":"Pagination key returned as next_page_key from a previous call. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"next_page_url":"/v2/sales?page_key=...","next_page_key":"1612345678","sales":[{"id":"EdqbHTvBUJ13xHzsE1x6bg==","email":"customer@example.com","seller_id":"kL0psf_HcOP2jVQejwLtHw==","product_id":"A-yG7uSPnfyChzBDR9zaXQ==","product_name":"Pencil","price":100,"currency_symbol":"$","order_number":524459995,"created_at":"2023-01-15T04:00:00Z","refunded":false}]}
   */
  async listSales(after, before, productId, email, pageKey) {
    const logTag = '[listSales]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sales`,
      method: 'get',
      query: {
        after,
        before,
        product_id: productId,
        email,
        page_key: pageKey,
      },
    })
  }

  /**
   * @operationName Get Sale
   * @category Sales
   * @description Retrieves the details of a single sale by its id, including buyer email, product, price, order number, refund state and any custom fields captured at checkout.
   * @route GET /sales/{saleId}
   *
   * @paramDef {"type":"String","label":"Sale ID","name":"saleId","required":true,"description":"The Gumroad sale id (returned by List Sales)."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"sale":{"id":"EdqbHTvBUJ13xHzsE1x6bg==","email":"customer@example.com","product_id":"A-yG7uSPnfyChzBDR9zaXQ==","product_name":"Pencil","price":100,"currency_symbol":"$","order_number":524459995,"created_at":"2023-01-15T04:00:00Z","refunded":false}}
   */
  async getSale(saleId) {
    const logTag = '[getSale]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sales/${ encodeURIComponent(saleId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Subscribers
   * @category Subscribers
   * @description Retrieves the subscribers of a membership/subscription product for the authenticated account. Optionally filter by email. Each subscriber includes its status (alive, cancelled, failed_payment, etc.), subscription dates and recurrence.
   * @route GET /products/{productId}/subscribers
   *
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The membership product id whose subscribers to list. Search and select a product, or enter an id directly."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Optional. Filter subscribers by email address."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"subscribers":[{"id":"tPBqCpj6MZbBP0V8QqNkxg==","product_id":"A-yG7uSPnfyChzBDR9zaXQ==","product_name":"Monthly Plan","user_id":"G_-mnBf9b1j9A7a4ub4nFQ==","user_email":"customer@example.com","status":"alive","recurrence":"monthly","created_at":"2023-01-15T04:00:00Z","cancelled_at":null}]}
   */
  async listSubscribers(productId, email) {
    const logTag = '[listSubscribers]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/products/${ encodeURIComponent(productId) }/subscribers`,
      method: 'get',
      query: { email },
    })
  }

  /**
   * @operationName Get Subscriber
   * @category Subscribers
   * @description Retrieves a single subscriber by its id, including status, recurrence, subscription start date and cancellation/charge information.
   * @route GET /subscribers/{subscriberId}
   *
   * @paramDef {"type":"String","label":"Subscriber ID","name":"subscriberId","required":true,"description":"The Gumroad subscriber id (returned by List Subscribers)."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"subscriber":{"id":"tPBqCpj6MZbBP0V8QqNkxg==","product_id":"A-yG7uSPnfyChzBDR9zaXQ==","product_name":"Monthly Plan","user_email":"customer@example.com","status":"alive","recurrence":"monthly","created_at":"2023-01-15T04:00:00Z","cancelled_at":null}}
   */
  async getSubscriber(subscriberId) {
    const logTag = '[getSubscriber]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/subscribers/${ encodeURIComponent(subscriberId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Verify License
   * @category Licenses
   * @description Verifies a license key issued for a product and returns the associated purchase details plus the current uses count. Optionally increments the uses count on each successful verification (default true), which is useful for enforcing seat/activation limits.
   * @route POST /licenses/verify
   *
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product id the license belongs to. Search and select a product, or enter an id directly."}
   * @paramDef {"type":"String","label":"License Key","name":"licenseKey","required":true,"description":"The license key to verify (provided to the buyer at purchase)."}
   * @paramDef {"type":"Boolean","label":"Increment Uses Count","name":"incrementUsesCount","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"When true (default), increments the license uses count on this verification. Set false to check without counting an activation."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"uses":3,"purchase":{"id":"EdqbHTvBUJ13xHzsE1x6bg==","product_id":"A-yG7uSPnfyChzBDR9zaXQ==","product_name":"Pencil","email":"customer@example.com","license_key":"85DB562A-C11D4B21-A8EF3EC9-2CC7DD24","refunded":false,"disputed":false,"chargebacked":false,"subscription_cancelled_at":null}}
   */
  async verifyLicense(productId, licenseKey, incrementUsesCount) {
    const logTag = '[verifyLicense]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/licenses/verify`,
      method: 'post',
      body: {
        product_id: productId,
        license_key: licenseKey,
        increment_uses_count: incrementUsesCount === undefined ? true : incrementUsesCount,
      },
    })
  }

  /**
   * @operationName Enable or Disable License
   * @category Licenses
   * @description Enables or disables a license key. A disabled license fails verification (useful for revoking access on refund/chargeback), and an enabled license passes again.
   * @route PUT /licenses/enable
   *
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product id the license belongs to. Search and select a product, or enter an id directly."}
   * @paramDef {"type":"String","label":"License Key","name":"licenseKey","required":true,"description":"The license key to enable or disable."}
   * @paramDef {"type":"String","label":"Action","name":"action","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Enable","Disable"]}},"defaultValue":"Enable","description":"Choose Enable to make the license valid again, or Disable to revoke it."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"uses":3,"purchase":{"id":"EdqbHTvBUJ13xHzsE1x6bg==","license_key":"85DB562A-C11D4B21-A8EF3EC9-2CC7DD24","product_id":"A-yG7uSPnfyChzBDR9zaXQ=="}}
   */
  async setLicenseState(productId, licenseKey, action) {
    const logTag = '[setLicenseState]'
    const path = this.#resolveChoice(action, { Enable: 'enable', Disable: 'disable' })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/licenses/${ path }`,
      method: 'put',
      body: {
        product_id: productId,
        license_key: licenseKey,
      },
    })
  }

  /**
   * @operationName List Offer Codes
   * @category Offer Codes
   * @description Retrieves all offer codes (discount codes) for a product, including their code, discount amount or percentage, max purchase count and remaining uses.
   * @route GET /products/{productId}/offer_codes
   *
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product id whose offer codes to list. Search and select a product, or enter an id directly."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"offer_codes":[{"id":"3sf7f9Il4Ry_v9O0Oz1kFA==","name":"code","amount_cents":200,"max_purchase_count":10,"universal":false,"times_used":1}]}
   */
  async listOfferCodes(productId) {
    const logTag = '[listOfferCodes]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/products/${ encodeURIComponent(productId) }/offer_codes`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Offer Code
   * @category Offer Codes
   * @description Retrieves a single offer code for a product by its id, including its code, discount value, usage limits and times used.
   * @route GET /products/{productId}/offer_codes/{offerCodeId}
   *
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product id the offer code belongs to. Search and select a product, or enter an id directly."}
   * @paramDef {"type":"String","label":"Offer Code ID","name":"offerCodeId","required":true,"description":"The offer code id (returned by List Offer Codes)."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"offer_code":{"id":"3sf7f9Il4Ry_v9O0Oz1kFA==","name":"code","amount_cents":200,"max_purchase_count":10,"universal":false,"times_used":1}}
   */
  async getOfferCode(productId, offerCodeId) {
    const logTag = '[getOfferCode]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/products/${ encodeURIComponent(productId) }/offer_codes/${ encodeURIComponent(offerCodeId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Offer Code
   * @category Offer Codes
   * @description Creates a new offer code (discount) for a product. Provide the code name (the string buyers enter) and a discount as either a flat amount in the currency's smallest unit (cents) or a percentage. Optionally limit total redemptions with a max purchase count.
   * @route POST /products/{productId}/offer_codes
   *
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product to attach the offer code to. Search and select a product, or enter an id directly."}
   * @paramDef {"type":"String","label":"Code Name","name":"name","required":true,"description":"The offer code buyers enter at checkout, e.g. LAUNCH20."}
   * @paramDef {"type":"Number","label":"Amount Off","name":"amountOff","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The discount value. When Discount Type is Fixed Amount this is cents (e.g. 200 = $2.00); when Percentage it is a whole percent (e.g. 20 = 20%)."}
   * @paramDef {"type":"String","label":"Discount Type","name":"offerType","uiComponent":{"type":"DROPDOWN","options":{"values":["Fixed Amount","Percentage"]}},"defaultValue":"Fixed Amount","description":"Whether Amount Off is a fixed cents value or a percentage. Defaults to Fixed Amount."}
   * @paramDef {"type":"Number","label":"Max Purchase Count","name":"maxPurchaseCount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional cap on the total number of times this code can be redeemed. Leave empty for unlimited."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"offer_code":{"id":"3sf7f9Il4Ry_v9O0Oz1kFA==","name":"LAUNCH20","amount_cents":200,"max_purchase_count":10,"universal":false,"times_used":0}}
   */
  async createOfferCode(productId, name, amountOff, offerType, maxPurchaseCount) {
    const logTag = '[createOfferCode]'
    const offerTypeValue = this.#resolveChoice(offerType, { 'Fixed Amount': 'cents', 'Percentage': 'percent' }) || 'cents'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/products/${ encodeURIComponent(productId) }/offer_codes`,
      method: 'post',
      body: {
        name,
        amount_off: amountOff,
        offer_type: offerTypeValue,
        max_purchase_count: maxPurchaseCount,
      },
    })
  }

  /**
   * @operationName Update Offer Code
   * @category Offer Codes
   * @description Updates the maximum purchase count of an existing offer code. Only the redemption limit can be changed via the API; other attributes are fixed at creation.
   * @route PUT /products/{productId}/offer_codes/{offerCodeId}
   *
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product the offer code belongs to. Search and select a product, or enter an id directly."}
   * @paramDef {"type":"String","label":"Offer Code ID","name":"offerCodeId","required":true,"description":"The offer code id to update."}
   * @paramDef {"type":"Number","label":"Max Purchase Count","name":"maxPurchaseCount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The new maximum number of times this code may be redeemed."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"offer_code":{"id":"3sf7f9Il4Ry_v9O0Oz1kFA==","name":"LAUNCH20","amount_cents":200,"max_purchase_count":50,"universal":false,"times_used":1}}
   */
  async updateOfferCode(productId, offerCodeId, maxPurchaseCount) {
    const logTag = '[updateOfferCode]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/products/${ encodeURIComponent(productId) }/offer_codes/${ encodeURIComponent(offerCodeId) }`,
      method: 'put',
      body: { max_purchase_count: maxPurchaseCount },
    })
  }

  /**
   * @operationName Delete Offer Code
   * @category Offer Codes
   * @description Permanently deletes an offer code from a product. Existing purchases that used the code are unaffected, but the code can no longer be redeemed.
   * @route DELETE /products/{productId}/offer_codes/{offerCodeId}
   *
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product the offer code belongs to. Search and select a product, or enter an id directly."}
   * @paramDef {"type":"String","label":"Offer Code ID","name":"offerCodeId","required":true,"description":"The offer code id to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"The offer_code was deleted successfully."}
   */
  async deleteOfferCode(productId, offerCodeId) {
    const logTag = '[deleteOfferCode]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/products/${ encodeURIComponent(productId) }/offer_codes/${ encodeURIComponent(offerCodeId) }`,
      method: 'delete',
    })
  }

  /**
   * @operationName List Variant Categories
   * @category Variants
   * @description Retrieves the variant categories of a product. Variant categories group the purchase options (versions/tiers) a buyer can choose, such as "Color" or "Plan". Each category contains its own set of variants.
   * @route GET /products/{productId}/variant_categories
   *
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product whose variant categories to list. Search and select a product, or enter an id directly."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"variant_categories":[{"id":"tPBqCpj6MZbBP0V8QqNkxg==","title":"Color"}]}
   */
  async listVariantCategories(productId) {
    const logTag = '[listVariantCategories]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/products/${ encodeURIComponent(productId) }/variant_categories`,
      method: 'get',
    })
  }

  /**
   * @operationName List Resource Subscriptions
   * @category Resource Subscriptions
   * @description Lists the resource subscriptions (webhooks) of a given type for the authenticated account. Gumroad calls the registered post_url whenever the resource event occurs (e.g. a new sale). Filter by resource type.
   * @route GET /resource_subscriptions
   *
   * @paramDef {"type":"String","label":"Resource Type","name":"resourceName","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Sale","Refund","Dispute","Dispute Won","Cancellation","Subscription Updated","Subscription Ended","Subscription Restarted"]}},"defaultValue":"Sale","description":"The resource event type whose subscriptions to list."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"resource_subscriptions":[{"id":"A-yG7uSPnfyChzBDR9zaXQ==","resource_name":"sale","post_url":"https://example.com/gumroad/webhook"}]}
   */
  async listResourceSubscriptions(resourceName) {
    const logTag = '[listResourceSubscriptions]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/resource_subscriptions`,
      method: 'get',
      query: { resource_name: this.#resolveResourceName(resourceName) },
    })
  }

  /**
   * @operationName Create Resource Subscription
   * @category Resource Subscriptions
   * @description Registers a resource subscription (webhook). Gumroad sends an HTTP POST to the given URL each time the selected resource event occurs for the authenticated account.
   * @route PUT /resource_subscriptions
   *
   * @paramDef {"type":"String","label":"Resource Type","name":"resourceName","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Sale","Refund","Dispute","Dispute Won","Cancellation","Subscription Updated","Subscription Ended","Subscription Restarted"]}},"defaultValue":"Sale","description":"The resource event type to subscribe to."}
   * @paramDef {"type":"String","label":"Post URL","name":"postUrl","required":true,"description":"The HTTPS URL Gumroad will POST to when the event occurs."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"resource_subscription":{"id":"A-yG7uSPnfyChzBDR9zaXQ==","resource_name":"sale","post_url":"https://example.com/gumroad/webhook"}}
   */
  async createResourceSubscription(resourceName, postUrl) {
    const logTag = '[createResourceSubscription]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/resource_subscriptions`,
      method: 'put',
      body: {
        resource_name: this.#resolveResourceName(resourceName),
        post_url: postUrl,
      },
    })
  }

  /**
   * @operationName Delete Resource Subscription
   * @category Resource Subscriptions
   * @description Deletes a resource subscription (webhook) by its id, stopping future POST callbacks for that subscription.
   * @route DELETE /resource_subscriptions/{resourceSubscriptionId}
   *
   * @paramDef {"type":"String","label":"Resource Subscription ID","name":"resourceSubscriptionId","required":true,"description":"The resource subscription id to delete (returned by List/Create Resource Subscriptions)."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"The resource_subscription was deleted successfully."}
   */
  async deleteResourceSubscription(resourceSubscriptionId) {
    const logTag = '[deleteResourceSubscription]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/resource_subscriptions/${ encodeURIComponent(resourceSubscriptionId) }`,
      method: 'delete',
    })
  }

  #resolveResourceName(resourceName) {
    return this.#resolveChoice(resourceName, {
      'Sale': 'sale',
      'Refund': 'refund',
      'Dispute': 'dispute',
      'Dispute Won': 'dispute_won',
      'Cancellation': 'cancellation',
      'Subscription Updated': 'subscription_updated',
      'Subscription Ended': 'subscription_ended',
      'Subscription Restarted': 'subscription_restarted',
    })
  }

  /**
   * @typedef {Object} getProductsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter products by name (case-insensitive substring match)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. The Gumroad products endpoint returns all products in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Products Dictionary
   * @description Provides a searchable list of the account's products for selecting a product in other operations. The option value is the Gumroad product id.
   * @route POST /get-products-dictionary
   * @paramDef {"type":"getProductsDictionary__payload","label":"Payload","name":"payload","description":"Search string used to filter products by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Pencil","value":"A-yG7uSPnfyChzBDR9zaXQ==","note":"$1 - published"}],"cursor":null}
   */
  async getProductsDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getProductsDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/products`,
      method: 'get',
    })

    const products = response.products || []
    const term = (search || '').trim().toLowerCase()

    const filtered = term
      ? products.filter(product => (product.name || '').toLowerCase().includes(term))
      : products

    return {
      items: filtered.map(product => {
        const noteParts = [product.formatted_price, product.published ? 'published' : 'unpublished'].filter(Boolean)

        return {
          label: product.name || product.id,
          value: product.id,
          note: noteParts.join(' - ') || undefined,
        }
      }),
      cursor: null,
    }
  }
}

Flowrunner.ServerCode.addService(GumroadService, [
  {
    name: 'accessToken',
    displayName: 'Access Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Gumroad → Settings → Advanced → Applications → create an application → Generate access token (or an OAuth token). Sent as an Authorization: Bearer header.',
  },
])
