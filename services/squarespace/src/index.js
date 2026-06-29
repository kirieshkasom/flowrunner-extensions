'use strict'

const crypto = require('crypto')

// Products use the v2 Commerce API (all product types, recommended for new integrations).
// Orders, inventory and store pages use the 1.0 Commerce API (no v2 exists for them).
const PRODUCTS_API = 'https://api.squarespace.com/v2/commerce'
const COMMERCE_API = 'https://api.squarespace.com/1.0/commerce'

// Polling: overlap absorbs the lag between an order's timestamp and when it becomes queryable;
// the seed look-back records existing orders so the first cycle never replays history.
const POLL_OVERLAP_MS = 15 * 60 * 1000
const POLL_SEED_LOOKBACK_MS = 24 * 60 * 60 * 1000
const POLL_MAX_SEEN_IDS = 3000

const ERROR_HINTS = {
  400: 'The request was rejected - check the field values you provided.',
  401: 'Authentication failed - check the Squarespace API key and reconnect the account.',
  403: 'Access denied - the API key lacks permission, or this Squarespace plan does not include the Commerce API.',
  404: 'Not found - the ID may be wrong; use the matching "List/Get" action to pick a valid one.',
  409: 'Conflict - the resource was changed by someone else or already exists.',
  429: 'Rate limit reached - wait a moment and try again.',
  500: 'Squarespace had a server error - try again in a moment.',
  502: 'Squarespace is temporarily unavailable - try again in a moment.',
  503: 'Squarespace is temporarily unavailable - try again in a moment.',
}

const logger = {
  info: (...args) => console.log('[Squarespace Service] info:', ...args),
  debug: (...args) => console.log('[Squarespace Service] debug:', ...args),
  error: (...args) => console.log('[Squarespace Service] error:', ...args),
  warn: (...args) => console.log('[Squarespace Service] warn:', ...args),
}

/**
 * @integrationName Squarespace
 * @integrationIcon /icon.png
 */
class SquarespaceService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  async #apiRequest({ url, method = 'GET', body, query, headers, logTag }) {
    try {
      logger.debug(`${ logTag } - API request: [${ method }::${ url }]`)

      let request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          Authorization: `Bearer ${ this.apiKey }`,
          'User-Agent': 'FlowRunner-Squarespace-Extension',
          ...(headers || {}),
        })

      if (query) {
        request = request.query(query)
      }

      if (body) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      const status = error?.status || error?.code
      const apiMsg = error?.body?.message || error?.body?.error ||
        (typeof error?.message === 'string' ? error.message : JSON.stringify(error?.message))
      const hint = ERROR_HINTS[status]

      logger.error(`${ logTag } - Failed (${ status || 'no status' }): ${ apiMsg }`)

      throw new Error(hint ? `${ hint } (${ apiMsg })` : `Squarespace API error: ${ apiMsg }`)
    }
  }

  // Maps a friendly dropdown label to its API value; passes through anything not in the mapping.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Pages an order query to completion. Squarespace forbids combining a cursor with the date
  // filters, so the first request carries the filter and later requests carry only the cursor
  // (the cursor encodes the original filter).
  async #fetchOrdersInWindow({ from, to, fulfillmentStatus, logTag }) {
    const firstQuery = { modifiedAfter: from, modifiedBefore: to }

    if (fulfillmentStatus) {
      firstQuery.fulfillmentStatus = fulfillmentStatus
    }

    const orders = []
    let cursor = null

    do {
      const response = await this.#apiRequest({
        url: `${ COMMERCE_API }/orders`,
        query: cursor ? { cursor } : firstQuery,
        logTag,
      })

      orders.push(...(response.result || []))
      cursor = response.pagination?.hasNextPage ? response.pagination.nextPageCursor : null
    } while (cursor)

    return orders
  }

  // ========================================== DICTIONARY METHODS ==========================================

  /**
   * @typedef {Object} getStorePagesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter store pages by title."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Store Pages Dictionary
   * @description Provides a list of store pages so a product can be assigned to the right page.
   * @route POST /get-store-pages-dictionary
   * @paramDef {"type":"getStorePagesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Main Store","value":"store_123","note":"ID: store_123"}],"cursor":null}
   */
  async getStorePagesDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getStorePagesDictionary]'

    const query = {}

    if (cursor) {
      query.cursor = cursor
    }

    const response = await this.#apiRequest({
      url: `${ COMMERCE_API }/store_pages`,
      query,
      logTag,
    })

    let storePages = response.storePages || []

    if (search) {
      const searchLower = search.toLowerCase()
      storePages = storePages.filter(page => page.title?.toLowerCase().includes(searchLower))
    }

    return {
      items: storePages.map(page => ({
        label: page.title,
        value: page.id,
        note: `ID: ${ page.id }`,
      })),
      cursor: response.pagination?.nextPageCursor || null,
    }
  }

  /**
   * @typedef {Object} getProductsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter products by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Products Dictionary
   * @description Provides a list of products for selection in other actions.
   * @route POST /get-products-dictionary
   * @paramDef {"type":"getProductsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Blue T-Shirt","value":"prod_abc123","note":"$29.99"}],"cursor":null}
   */
  async getProductsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getProductsDictionary]'

    const query = {}

    if (cursor) {
      query.cursor = cursor
    }

    const response = await this.#apiRequest({
      url: `${ PRODUCTS_API }/products`,
      query,
      logTag,
    })

    let products = response.products || []

    if (search) {
      const searchLower = search.toLowerCase()
      products = products.filter(product => product.name?.toLowerCase().includes(searchLower))
    }

    return {
      items: products.map(product => {
        const price = product.variants?.[0]?.pricing?.basePrice?.value
        const priceNote = price != null ? `$${ Number(price).toFixed(2) }` : 'No price'

        return {
          label: product.name,
          value: product.id,
          note: priceNote,
        }
      }),
      cursor: response.pagination?.nextPageCursor || null,
    }
  }

  /**
   * @typedef {Object} getVariantsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Product ID","name":"productId","required":true,"description":"The product whose variants should be listed."}
   */

  /**
   * @typedef {Object} getVariantsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter variants by SKU or option name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   * @paramDef {"type":"getVariantsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the parent product."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Variants Dictionary
   * @description Provides the variants of a selected product so a specific variant can be chosen.
   * @route POST /get-variants-dictionary
   * @paramDef {"type":"getVariantsDictionary__payload","label":"Payload","name":"payload","description":"Contains an optional search string and the parent product criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Small / Blue (BTS-001)","value":"var_456","note":"SKU: BTS-001"}],"cursor":null}
   */
  async getVariantsDictionary(payload) {
    const { search, criteria } = payload || {}
    const productId = criteria?.productId
    const logTag = '[getVariantsDictionary]'

    if (!productId) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      url: `${ PRODUCTS_API }/products/${ productId }`,
      logTag,
    })

    let variants = response.products?.[0]?.variants || []

    const describe = variant => {
      const options = variant.attributes ? Object.values(variant.attributes).join(' / ') : ''
      const sku = variant.sku ? `(${ variant.sku })` : ''

      return [options, sku].filter(Boolean).join(' ') || variant.id
    }

    if (search) {
      const searchLower = search.toLowerCase()
      variants = variants.filter(variant => describe(variant).toLowerCase().includes(searchLower))
    }

    return {
      items: variants.map(variant => ({
        label: describe(variant),
        value: variant.id,
        note: variant.sku ? `SKU: ${ variant.sku }` : `ID: ${ variant.id }`,
      })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getOrdersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter orders by order number or customer email."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Orders Dictionary
   * @description Provides a list of orders for selection in other actions.
   * @route POST /get-orders-dictionary
   * @paramDef {"type":"getOrdersDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Order #1234","value":"order_xyz789","note":"PENDING - $99.99"}],"cursor":null}
   */
  async getOrdersDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getOrdersDictionary]'

    const query = {}

    if (cursor) {
      query.cursor = cursor
    }

    const response = await this.#apiRequest({
      url: `${ COMMERCE_API }/orders`,
      query,
      logTag,
    })

    let orders = response.result || []

    if (search) {
      const searchLower = search.toLowerCase()

      orders = orders.filter(order =>
        order.orderNumber?.toString().includes(searchLower) ||
        order.customerEmail?.toLowerCase().includes(searchLower)
      )
    }

    return {
      items: orders.map(order => {
        const total = order.grandTotal?.value
        const totalStr = total != null ? `$${ Number(total).toFixed(2) }` : ''
        const note = `${ order.fulfillmentStatus }${ totalStr ? ' - ' + totalStr : '' }`

        return {
          label: `Order #${ order.orderNumber }`,
          value: order.id,
          note,
        }
      }),
      cursor: response.pagination?.nextPageCursor || null,
    }
  }

  // ========================================== PRODUCTS ==========================================

  /**
   * @operationName List Products
   * @category Products
   * @description Retrieves products from a Squarespace store, optionally filtered by product type. Returns product details including variants, pricing, and visibility. Use the cursor to page through large catalogs.
   * @route POST /list-products
   * @appearanceColor #000000 #1a1a1a
   *
   * @paramDef {"type":"String","label":"Product Type","name":"productType","uiComponent":{"type":"DROPDOWN","options":{"values":["All Types","Physical","Service","Gift Card","Digital"]}},"description":"Optionally limit results to a single product type."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   *
   * @returns {Object}
   * @sampleResult {"products":[{"id":"prod_123","type":"PHYSICAL","name":"Blue T-Shirt","storePageId":"store_456","isVisible":true,"variants":[{"id":"var_456","sku":"BTS-001","pricing":{"basePrice":{"value":"29.99","currency":"USD"}}}]}],"pagination":{"hasNextPage":false,"nextPageCursor":null}}
   */
  async listProducts(productType, cursor) {
    const logTag = '[listProducts]'

    const query = {}

    const apiType = this.#resolveChoice(productType, {
      'All Types': '',
      Physical: 'PHYSICAL',
      Service: 'SERVICE',
      'Gift Card': 'GIFT_CARD',
      Digital: 'DIGITAL',
    })

    if (apiType) {
      query.type = apiType
    }

    if (cursor) {
      query.cursor = cursor
    }

    const response = await this.#apiRequest({
      url: `${ PRODUCTS_API }/products`,
      query,
      logTag,
    })

    logger.info(`${ logTag } Successfully listed ${ response.products?.length || 0 } products`)

    return response
  }

  /**
   * @operationName Get Product
   * @category Products
   * @description Retrieves detailed information about a single product including all variants, images, pricing, and visibility.
   * @route POST /get-product
   * @appearanceColor #000000 #1a1a1a
   *
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product to retrieve details for."}
   *
   * @returns {Object}
   * @sampleResult {"id":"prod_123","type":"PHYSICAL","name":"Blue T-Shirt","description":"A comfortable cotton t-shirt","isVisible":true,"storePageId":"store_456","variants":[{"id":"var_456","sku":"BTS-001","pricing":{"basePrice":{"value":"29.99","currency":"USD"}}}],"images":[{"id":"img_789","url":"https://example.com/image.jpg"}]}
   */
  async getProduct(productId) {
    const logTag = '[getProduct]'

    if (!productId) {
      throw new Error('Product ID is required.')
    }

    const response = await this.#apiRequest({
      url: `${ PRODUCTS_API }/products/${ productId }`,
      logTag,
    })

    // The endpoint returns an array wrapper even for a single id; surface the single product.
    const product = response.products?.[0]

    if (!product) {
      throw new Error(`Product "${ productId }" was not found. Use List Products to pick a valid product.`)
    }

    logger.info(`${ logTag } Successfully retrieved product: ${ productId }`)

    return product
  }

  /**
   * @operationName Create Product
   * @category Products
   * @description Creates a new physical product in a Squarespace store with a single variant (name, price, optional SKU and starting stock). Non-physical types (service, gift card, digital) require additional configuration and are not created here.
   * @route POST /create-product
   * @appearanceColor #000000 #1a1a1a
   *
   * @paramDef {"type":"String","label":"Store Page","name":"storePageId","required":true,"dictionary":"getStorePagesDictionary","description":"The store page to add the product to."}
   * @paramDef {"type":"String","label":"Product Name","name":"name","required":true,"description":"The name of the product."}
   * @paramDef {"type":"Number","label":"Price","name":"price","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The price as a decimal amount in the store currency (e.g. 29.99)."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional product description (HTML supported)."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","description":"Optional 3-letter currency code matching the store currency. Defaults to USD."}
   * @paramDef {"type":"String","label":"SKU","name":"sku","description":"Optional stock keeping unit identifier for the variant."}
   * @paramDef {"type":"Number","label":"Initial Stock","name":"initialStock","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional starting stock quantity. Leave empty to default to 0."}
   * @paramDef {"type":"Boolean","label":"Visible","name":"isVisible","uiComponent":{"type":"TOGGLE"},"description":"Whether the product is visible on the store. Defaults to visible."}
   *
   * @returns {Object}
   * @sampleResult {"id":"prod_new123","type":"PHYSICAL","name":"New Product","storePageId":"store_456","isVisible":true,"variants":[{"id":"var_789","sku":"NP-001","pricing":{"basePrice":{"value":"29.99","currency":"USD"}}}]}
   */
  async createProduct(storePageId, name, price, description, currency, sku, initialStock, isVisible) {
    const logTag = '[createProduct]'

    if (!storePageId) {
      throw new Error('Store Page is required. Use Get Store Pages to pick one.')
    }

    if (!name) {
      throw new Error('Product name is required.')
    }

    if (price === undefined || price === null || isNaN(Number(price))) {
      throw new Error('Price is required and must be a number (a decimal amount such as 29.99).')
    }

    const variant = {
      pricing: {
        basePrice: {
          currency: currency || 'USD',
          // Squarespace money values are decimal strings (e.g. "29.99"), not numbers.
          value: Number(price).toFixed(2),
        },
      },
    }

    if (sku) {
      variant.sku = sku
    }

    if (initialStock !== undefined && initialStock !== null) {
      variant.stock = { quantity: Number(initialStock), unlimited: false }
    }

    const body = {
      type: 'PHYSICAL',
      storePageId,
      name,
      isVisible: isVisible !== false,
      variants: [variant],
    }

    if (description) {
      body.description = description
    }

    const response = await this.#apiRequest({
      url: `${ PRODUCTS_API }/products`,
      method: 'POST',
      body,
      logTag,
    })

    logger.info(`${ logTag } Successfully created product: ${ response.id }`)

    return response
  }

  /**
   * @operationName Update Product
   * @category Products
   * @description Updates an existing product's name, description, visibility, or URL slug. Only the fields you provide are changed.
   * @route POST /update-product
   * @appearanceColor #000000 #1a1a1a
   *
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product to update."}
   * @paramDef {"type":"String","label":"Product Name","name":"name","description":"New name for the product."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New product description (HTML supported)."}
   * @paramDef {"type":"Boolean","label":"Visible","name":"isVisible","uiComponent":{"type":"TOGGLE"},"description":"Whether the product is visible on the store."}
   * @paramDef {"type":"String","label":"URL Slug","name":"urlSlug","description":"Custom URL slug for the product page."}
   *
   * @returns {Object}
   * @sampleResult {"id":"prod_123","type":"PHYSICAL","name":"Updated Product","isVisible":true,"urlSlug":"updated-product"}
   */
  async updateProduct(productId, name, description, isVisible, urlSlug) {
    const logTag = '[updateProduct]'

    if (!productId) {
      throw new Error('Product ID is required.')
    }

    // The endpoint takes flat fields and leaves omitted ones untouched (partial update).
    const body = {}

    if (name !== undefined) {
      body.name = name
    }

    if (description !== undefined) {
      body.description = description
    }

    if (isVisible !== undefined) {
      body.isVisible = isVisible
    }

    if (urlSlug !== undefined) {
      body.urlSlug = urlSlug
    }

    if (Object.keys(body).length === 0) {
      throw new Error('Provide at least one field to update (name, description, visibility, or URL slug).')
    }

    const response = await this.#apiRequest({
      url: `${ PRODUCTS_API }/products/${ productId }`,
      method: 'POST',
      body,
      logTag,
    })

    logger.info(`${ logTag } Successfully updated product: ${ productId }`)

    return response
  }

  /**
   * @operationName Delete Product
   * @category Products
   * @description Permanently deletes a product from the Squarespace store. This action cannot be undone.
   * @route POST /delete-product
   * @appearanceColor #FF4444 #FF6666
   *
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Product deleted successfully","productId":"prod_123"}
   */
  async deleteProduct(productId) {
    const logTag = '[deleteProduct]'

    if (!productId) {
      throw new Error('Product ID is required.')
    }

    await this.#apiRequest({
      url: `${ PRODUCTS_API }/products/${ productId }`,
      method: 'DELETE',
      logTag,
    })

    logger.info(`${ logTag } Successfully deleted product: ${ productId }`)

    return {
      success: true,
      message: 'Product deleted successfully',
      productId,
    }
  }

  // ========================================== ORDERS ==========================================

  /**
   * @operationName List Orders
   * @category Orders
   * @description Retrieves orders from a Squarespace store. Filter by fulfillment status, or by a modified-date range. Note: a date range and a pagination cursor cannot be used together - page through a date range using the returned cursor only.
   * @route POST /list-orders
   * @appearanceColor #000000 #1a1a1a
   *
   * @paramDef {"type":"String","label":"Fulfillment Status","name":"fulfillmentStatus","uiComponent":{"type":"DROPDOWN","options":{"values":["Any Status","Pending","Fulfilled","Canceled"]}},"description":"Filter orders by fulfillment status."}
   * @paramDef {"type":"String","label":"Modified After","name":"modifiedAfter","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Filter orders modified at or after this time (ISO 8601). Must be paired with Modified Before."}
   * @paramDef {"type":"String","label":"Modified Before","name":"modifiedBefore","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Filter orders modified before this time (ISO 8601). Must be paired with Modified After."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page. Do not combine with the date range."}
   *
   * @returns {Object}
   * @sampleResult {"result":[{"id":"order_123","orderNumber":1234,"customerEmail":"customer@example.com","createdOn":"2024-01-15T10:00:00Z","modifiedOn":"2024-01-15T10:00:00Z","fulfillmentStatus":"PENDING","grandTotal":{"value":"99.99","currency":"USD"}}],"pagination":{"hasNextPage":false,"nextPageCursor":null}}
   */
  async listOrders(fulfillmentStatus, modifiedAfter, modifiedBefore, cursor) {
    const logTag = '[listOrders]'

    if (cursor && (modifiedAfter || modifiedBefore)) {
      throw new Error('A pagination cursor cannot be combined with a modified-date range. Use one or the other.')
    }

    if ((modifiedAfter && !modifiedBefore) || (!modifiedAfter && modifiedBefore)) {
      throw new Error('Modified After and Modified Before must be provided together.')
    }

    const query = {}

    const apiStatus = this.#resolveChoice(fulfillmentStatus, {
      'Any Status': '',
      Pending: 'PENDING',
      Fulfilled: 'FULFILLED',
      Canceled: 'CANCELED',
    })

    if (apiStatus) {
      query.fulfillmentStatus = apiStatus
    }

    if (modifiedAfter) {
      query.modifiedAfter = modifiedAfter
    }

    if (modifiedBefore) {
      query.modifiedBefore = modifiedBefore
    }

    if (cursor) {
      query.cursor = cursor
    }

    const response = await this.#apiRequest({
      url: `${ COMMERCE_API }/orders`,
      query,
      logTag,
    })

    logger.info(`${ logTag } Successfully listed ${ response.result?.length || 0 } orders`)

    return response
  }

  /**
   * @operationName Get Order
   * @category Orders
   * @description Retrieves detailed information about a specific order including line items, shipping and billing addresses, fulfillment status, and totals.
   * @route POST /get-order
   * @appearanceColor #000000 #1a1a1a
   *
   * @paramDef {"type":"String","label":"Order","name":"orderId","required":true,"dictionary":"getOrdersDictionary","description":"The order to retrieve details for."}
   *
   * @returns {Object}
   * @sampleResult {"id":"order_123","orderNumber":1234,"customerEmail":"customer@example.com","createdOn":"2024-01-15T10:00:00Z","modifiedOn":"2024-01-15T10:00:00Z","fulfillmentStatus":"PENDING","lineItems":[{"id":"item_456","productName":"Blue T-Shirt","quantity":2,"unitPricePaid":{"value":"29.99","currency":"USD"}}],"grandTotal":{"value":"59.98","currency":"USD"}}
   */
  async getOrder(orderId) {
    const logTag = '[getOrder]'

    if (!orderId) {
      throw new Error('Order ID is required.')
    }

    const response = await this.#apiRequest({
      url: `${ COMMERCE_API }/orders/${ orderId }`,
      logTag,
    })

    logger.info(`${ logTag } Successfully retrieved order: ${ orderId }`)

    return response
  }

  /**
   * @operationName Fulfill Order
   * @category Orders
   * @description Marks an order as fulfilled with optional shipment tracking, and optionally emails the customer. Squarespace returns no content on success, so a confirmation summary is returned.
   * @route POST /fulfill-order
   * @appearanceColor #000000 #1a1a1a
   *
   * @paramDef {"type":"String","label":"Order","name":"orderId","required":true,"dictionary":"getOrdersDictionary","description":"The order to fulfill."}
   * @paramDef {"type":"String","label":"Ship Date","name":"shipDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"When the order shipped (ISO 8601)."}
   * @paramDef {"type":"String","label":"Carrier Name","name":"carrierName","description":"Name of the shipping carrier (e.g. UPS, FedEx, USPS)."}
   * @paramDef {"type":"String","label":"Service","name":"service","description":"Carrier service level (e.g. Ground, Priority)."}
   * @paramDef {"type":"String","label":"Tracking Number","name":"trackingNumber","description":"Shipment tracking number."}
   * @paramDef {"type":"String","label":"Tracking URL","name":"trackingUrl","description":"URL to track the shipment."}
   * @paramDef {"type":"Boolean","label":"Send Notification","name":"sendNotification","uiComponent":{"type":"TOGGLE"},"description":"Email a fulfillment notification to the customer. Defaults to on."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Order fulfilled successfully","orderId":"order_123"}
   */
  async fulfillOrder(orderId, shipDate, carrierName, service, trackingNumber, trackingUrl, sendNotification) {
    const logTag = '[fulfillOrder]'

    if (!orderId) {
      throw new Error('Order ID is required.')
    }

    const shipment = {}

    if (shipDate) {
      shipment.shipDate = shipDate
    }

    if (carrierName) {
      shipment.carrierName = carrierName
    }

    if (service) {
      shipment.service = service
    }

    if (trackingNumber) {
      shipment.trackingNumber = trackingNumber
    }

    if (trackingUrl) {
      shipment.trackingUrl = trackingUrl
    }

    const body = {
      shouldSendNotification: sendNotification !== false,
      shipments: [shipment],
    }

    await this.#apiRequest({
      url: `${ COMMERCE_API }/orders/${ orderId }/fulfillments`,
      method: 'POST',
      body,
      logTag,
    })

    logger.info(`${ logTag } Successfully fulfilled order: ${ orderId }`)

    return {
      success: true,
      message: 'Order fulfilled successfully',
      orderId,
    }
  }

  // ========================================== INVENTORY ==========================================

  /**
   * @operationName List Inventory
   * @category Inventory
   * @description Retrieves inventory for all product variants including stock quantities, SKUs, and whether stock is unlimited.
   * @route POST /list-inventory
   * @appearanceColor #000000 #1a1a1a
   *
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   *
   * @returns {Object}
   * @sampleResult {"inventory":[{"variantId":"var_123","sku":"BTS-001","descriptor":"Blue / Large","quantity":50,"isUnlimited":false}],"pagination":{"hasNextPage":false,"nextPageCursor":null}}
   */
  async listInventory(cursor) {
    const logTag = '[listInventory]'

    const query = {}

    if (cursor) {
      query.cursor = cursor
    }

    const response = await this.#apiRequest({
      url: `${ COMMERCE_API }/inventory`,
      query,
      logTag,
    })

    logger.info(`${ logTag } Successfully listed ${ response.inventory?.length || 0 } inventory items`)

    return response
  }

  /**
   * @operationName Get Inventory Item
   * @category Inventory
   * @description Retrieves inventory for a single product variant including current stock and whether it is unlimited.
   * @route POST /get-inventory
   * @appearanceColor #000000 #1a1a1a
   *
   * @paramDef {"type":"String","label":"Product","name":"productId","dictionary":"getProductsDictionary","description":"Optional - pick a product to choose its variant below. Not needed if you already have a Variant ID."}
   * @paramDef {"type":"String","label":"Variant","name":"variantId","required":true,"dictionary":"getVariantsDictionary","dependsOn":["productId"],"description":"The product variant to get inventory for."}
   *
   * @returns {Object}
   * @sampleResult {"variantId":"var_123","sku":"BTS-001","descriptor":"Blue / Large","quantity":50,"isUnlimited":false}
   */
  async getInventory(productId, variantId) {
    const logTag = '[getInventory]'

    if (!variantId) {
      throw new Error('Variant is required. Pick a product, then choose a variant.')
    }

    const response = await this.#apiRequest({
      url: `${ COMMERCE_API }/inventory/${ variantId }`,
      logTag,
    })

    // The endpoint returns an array wrapper even for a single id; surface the single item.
    const item = response.inventory?.[0]

    if (!item) {
      throw new Error(`Inventory for variant "${ variantId }" was not found. Use List Inventory to pick a valid variant.`)
    }

    logger.info(`${ logTag } Successfully retrieved inventory for variant: ${ variantId }`)

    return item
  }

  /**
   * @operationName Adjust Stock
   * @category Inventory
   * @description Adjusts the stock quantity for a product variant. Use a positive number to add stock and a negative number to reduce it. Squarespace returns no content on success, so a confirmation summary is returned.
   * @route POST /adjust-stock
   * @appearanceColor #000000 #1a1a1a
   *
   * @paramDef {"type":"String","label":"Product","name":"productId","dictionary":"getProductsDictionary","description":"Optional - pick a product to choose its variant below. Not needed if you already have a Variant ID."}
   * @paramDef {"type":"String","label":"Variant","name":"variantId","required":true,"dictionary":"getVariantsDictionary","dependsOn":["productId"],"description":"The product variant to adjust stock for."}
   * @paramDef {"type":"Number","label":"Quantity Adjustment","name":"quantityDelta","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Amount to change stock by (positive to add, negative to subtract). Cannot be zero."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Stock adjusted successfully","variantId":"var_123","quantityDelta":10}
   */
  async adjustStock(productId, variantId, quantityDelta) {
    const logTag = '[adjustStock]'

    if (!variantId) {
      throw new Error('Variant is required. Pick a product, then choose a variant.')
    }

    const delta = Number(quantityDelta)

    if (quantityDelta === undefined || quantityDelta === null || isNaN(delta) || delta === 0) {
      throw new Error('Quantity Adjustment is required and must be a non-zero number.')
    }

    // The adjustments endpoint takes operation arrays; map the signed delta to add/subtract.
    const operation = { variantId, quantity: Math.abs(delta) }
    const body = delta > 0
      ? { incrementOperations: [operation] }
      : { decrementOperations: [operation] }

    await this.#apiRequest({
      url: `${ COMMERCE_API }/inventory/adjustments`,
      method: 'POST',
      body,
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      logTag,
    })

    logger.info(`${ logTag } Successfully adjusted stock for variant: ${ variantId } by ${ delta }`)

    return {
      success: true,
      message: 'Stock adjusted successfully',
      variantId,
      quantityDelta: delta,
    }
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
   * @description Triggered when a new order is placed in your Squarespace store. Polling interval can be customized (minimum 30 seconds).
   * @route POST /on-new-order
   * @operationName On New Order
   * @category Triggers
   * @registerAs POLLING_TRIGGER
   *
   * @paramDef {"type":"String","label":"Fulfillment Status","name":"fulfillmentStatus","uiComponent":{"type":"DROPDOWN","options":{"values":["Any Status","Pending","Fulfilled","Canceled"]}},"description":"Optionally only trigger for new orders with this fulfillment status."}
   *
   * @returns {Object}
   * @sampleResult {"id":"order_123","orderNumber":1234,"customerEmail":"customer@example.com","createdOn":"2024-01-15T10:00:00Z","fulfillmentStatus":"PENDING","lineItems":[{"productName":"Blue T-Shirt","quantity":1}],"grandTotal":{"value":"29.99","currency":"USD"}}
   */
  async onNewOrder(invocation) {
    const logTag = '[onNewOrder]'
    const { fulfillmentStatus: fulfillmentStatusLabel } = invocation.triggerData || {}
    const fulfillmentStatus = this.#resolveChoice(fulfillmentStatusLabel, {
      'Any Status': '',
      Pending: 'PENDING',
      Fulfilled: 'FULFILLED',
      Canceled: 'CANCELED',
    })
    const state = invocation.state || {}
    const now = new Date().toISOString()

    // First cycle: record existing orders and emit nothing, so history is not replayed.
    if (!state.since) {
      const seedFrom = new Date(Date.now() - POLL_SEED_LOOKBACK_MS).toISOString()
      const existing = await this.#fetchOrdersInWindow({ from: seedFrom, to: now, fulfillmentStatus, logTag })

      logger.debug(`${ logTag } Seeding with ${ existing.length } existing orders`)

      return {
        events: [],
        state: { since: now, seenIds: existing.map(order => order.id).slice(0, POLL_MAX_SEEN_IDS) },
      }
    }

    // Window the query back by the overlap (records can become queryable after their timestamp).
    const from = new Date(Date.parse(state.since) - POLL_OVERLAP_MS).toISOString()
    const createdFloor = Date.parse(from)
    const orders = await this.#fetchOrdersInWindow({ from, to: now, fulfillmentStatus, logTag })

    orders.sort((a, b) => Date.parse(a.createdOn) - Date.parse(b.createdOn))

    const seen = new Set(state.seenIds || [])
    const newOrders = orders.filter(order =>
      !seen.has(order.id) && Date.parse(order.createdOn) >= createdFloor
    )

    logger.info(`${ logTag } Found ${ newOrders.length } new orders`)

    const seenIds = [...newOrders.map(order => order.id), ...(state.seenIds || [])].slice(0, POLL_MAX_SEEN_IDS)

    return {
      events: newOrders,
      state: { since: now, seenIds },
    }
  }

  /**
   * @description Triggered when an order is marked as fulfilled. Polling interval can be customized (minimum 30 seconds).
   * @route POST /on-order-fulfilled
   * @operationName On Order Fulfilled
   * @category Triggers
   * @registerAs POLLING_TRIGGER
   *
   * @returns {Object}
   * @sampleResult {"id":"order_123","orderNumber":1234,"customerEmail":"customer@example.com","modifiedOn":"2024-01-15T12:00:00Z","fulfillmentStatus":"FULFILLED","fulfillments":[{"shipDate":"2024-01-15T12:00:00Z","carrierName":"UPS","trackingNumber":"1Z999AA10123456784"}],"grandTotal":{"value":"29.99","currency":"USD"}}
   */
  async onOrderFulfilled(invocation) {
    const logTag = '[onOrderFulfilled]'
    const state = invocation.state || {}
    const now = new Date().toISOString()

    // First cycle: record already-fulfilled orders and emit nothing.
    if (!state.since) {
      const seedFrom = new Date(Date.now() - POLL_SEED_LOOKBACK_MS).toISOString()
      const existing = await this.#fetchOrdersInWindow({ from: seedFrom, to: now, fulfillmentStatus: 'FULFILLED', logTag })

      logger.debug(`${ logTag } Seeding with ${ existing.length } already-fulfilled orders`)

      return {
        events: [],
        state: { since: now, seenIds: existing.map(order => order.id).slice(0, POLL_MAX_SEEN_IDS) },
      }
    }

    // Fulfillment updates an order's modifiedOn, so window by modified time with overlap.
    const from = new Date(Date.parse(state.since) - POLL_OVERLAP_MS).toISOString()
    const orders = await this.#fetchOrdersInWindow({ from, to: now, fulfillmentStatus: 'FULFILLED', logTag })

    orders.sort((a, b) => Date.parse(a.modifiedOn) - Date.parse(b.modifiedOn))

    const seen = new Set(state.seenIds || [])
    const newlyFulfilled = orders.filter(order => !seen.has(order.id))

    logger.info(`${ logTag } Found ${ newlyFulfilled.length } newly fulfilled orders`)

    const seenIds = [...newlyFulfilled.map(order => order.id), ...(state.seenIds || [])].slice(0, POLL_MAX_SEEN_IDS)

    return {
      events: newlyFulfilled,
      state: { since: now, seenIds },
    }
  }
}

Flowrunner.ServerCode.addService(SquarespaceService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Squarespace API key from Settings > Advanced > Developer API Keys',
  },
])
