// WooCommerce REST API integration: products, orders, customers, coupons, and order webhooks.

const crypto = require('crypto')

// ============================================================================
//  CONSTANTS
// ============================================================================
// WooCommerce exposes its REST API under {store}/wp-json/wc/v3. The store base URL is a
// per-connection config item because every store is a separate self-hosted WordPress.
const API_SUFFIX = '/wp-json/wc/v3'

// Map each FlowRunner trigger method to its native WooCommerce webhook topic, and back.
const EVENT_TOPIC = {
  onOrderCreated: 'order.created',
  onOrderUpdated: 'order.updated',
  onProductCreated: 'product.created',
  onProductUpdated: 'product.updated',
  onCustomerCreated: 'customer.created',
  onCustomerUpdated: 'customer.updated',
}
const TOPIC_EVENT = Object.fromEntries(Object.entries(EVENT_TOPIC).map(([event, topic]) => [topic, event]))

// Friendly DROPDOWN labels the UI shows, mapped to the API values WooCommerce expects.
const PRODUCT_TYPE_MAP = {
  'Simple': 'simple',
  'Variable (has variations)': 'variable',
  'Grouped (bundle of products)': 'grouped',
  'External / Affiliate': 'external',
}
const PRODUCT_STATUS_MAP = {
  'Any': 'any',
  'Published': 'publish',
  'Draft': 'draft',
  'Pending review': 'pending',
  'Private': 'private',
}
const ORDER_STATUS_MAP = {
  'Any': 'any',
  'Pending payment': 'pending',
  'Processing': 'processing',
  'On hold': 'on-hold',
  'Completed': 'completed',
  'Cancelled': 'cancelled',
  'Refunded': 'refunded',
  'Failed': 'failed',
}
const COUPON_TYPE_MAP = {
  'Percentage off': 'percent',
  'Fixed amount off the cart': 'fixed_cart',
  'Fixed amount off each product': 'fixed_product',
}
const ATTRIBUTE_ORDER_BY_MAP = {
  'Menu Order': 'menu_order',
  'Name': 'name',
  'Name (Numeric)': 'name_num',
  'ID': 'id',
}

// Plain-English remediation for the failure reasons a self-hosted store actually returns.
const ERROR_HINTS = {
  400: 'The request was rejected — check the field values and try again.',
  401: 'Authentication failed — verify the Consumer Key/Secret and that the key has the required permissions.',
  403: 'Access denied — the API key lacks permission for this action, or the store blocked the request (WAF/host).',
  404: 'Not found — the ID may be wrong; use the matching dictionary/"List" action to pick a valid one.',
  429: 'The store is rate-limiting requests — retry in a moment.',
  500: 'The store returned an internal error — it may be overloaded or a plugin conflict is present.',
  503: 'The store is temporarily unavailable — retry shortly.',
}

// ============================================================================
//  LOGGER
// ============================================================================
const logger = {
  info: (...args) => console.log('[WooCommerce Service] info:', ...args),
  debug: (...args) => console.log('[WooCommerce Service] debug:', ...args),
  error: (...args) => console.log('[WooCommerce Service] error:', ...args),
  warn: (...args) => console.log('[WooCommerce Service] warn:', ...args),
}

// ============================================================================
//  DICTIONARY PAYLOAD TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} getProductsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter products by name or SKU."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number for the next page of results."}
 */

/**
 * @typedef {Object} getProductCategoriesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter categories by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number for the next page of results."}
 */

/**
 * @typedef {Object} getProductAttributesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter attributes by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number for the next page of results."}
 */

/**
 * @typedef {Object} getAttributeTermsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Attribute","name":"attributeId","required":true,"description":"The global attribute whose terms to list."}
 */

/**
 * @typedef {Object} getAttributeTermsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter terms by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number for the next page of results."}
 * @paramDef {"type":"getAttributeTermsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the parent attribute."}
 */

/**
 * @typedef {Object} getOrdersDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter orders (matches order content)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number for the next page of results."}
 */

/**
 * @typedef {Object} getCustomersDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter customers by name or email."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number for the next page of results."}
 */

/**
 * @typedef {Object} getCouponsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter coupons by code."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number for the next page of results."}
 */

/**
 * @typedef {Object} getProductVariationsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"description":"The parent product whose variations to list."}
 */

/**
 * @typedef {Object} getProductVariationsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter variations by SKU."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number for the next page of results."}
 * @paramDef {"type":"getProductVariationsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the parent product."}
 */

/**
 * @typedef {Object} getOrderNotesDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Order","name":"orderId","required":true,"description":"The order whose notes to list."}
 */

/**
 * @typedef {Object} getOrderNotesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter the order's notes locally by their content."}
 * @paramDef {"type":"getOrderNotesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the parent order."}
 */

/**
 * @typedef {Object} getOrderRefundsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Order","name":"orderId","required":true,"description":"The order whose refunds to list."}
 */

/**
 * @typedef {Object} getOrderRefundsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter the order's refunds locally by their reason."}
 * @paramDef {"type":"getOrderRefundsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the parent order."}
 */

// ============================================================================
//  TYPED ARRAY ELEMENT TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} OrderLineItem
 * @property {String} productId - The product to add to the order.
 * @property {Number} quantity - How many units of the product.
 * @property {String} variationId - Optional variation ID when the product is variable.
 */

/**
 * @typedef {Object} VariationAttribute
 * @property {String} name - Attribute name (e.g. "Color").
 * @property {String} option - Selected option for this variation (e.g. "Blue").
 */

/**
 * @integrationName WooCommerce
 * @integrationIcon /icon.svg
 * @appearanceColor #7f54b3 #a777d6
 * @integrationTriggersScope SINGLE_APP
 */
class WooCommerce {
  constructor(config) {
    this.config = config || {}
    this.storeUrl = String(this.config.storeUrl || '').trim().replace(/\/+$/, '')
    this.consumerKey = this.config.consumerKey
    this.consumerSecret = this.config.consumerSecret
    this.authMethod = this.config.authMethod === 'query' ? 'query' : 'header'
    this.apiBase = `${ this.storeUrl }${ API_SUFFIX }`
  }

  // ==========================================================================
  //  CORE - every external call goes through #apiRequest
  // ==========================================================================
  async #apiRequest({ url, method, body, query, logTag }) {
    method = (method || 'get').toLowerCase()

    if (!this.storeUrl) {
      throw new Error('Store URL is not configured — set the Store URL connection field to your WooCommerce site (e.g. https://shop.example.com).')
    }

    // Some hosts strip the Authorization header; in that mode the credentials ride along as
    // query-string parameters instead (WooCommerce's documented fallback over HTTPS).
    const finalQuery = { ...(query || {}) }

    if (this.authMethod === 'query') {
      finalQuery.consumer_key = this.consumerKey
      finalQuery.consumer_secret = this.consumerSecret
    }

    try {
      logger.debug(`${ logTag } ${ method.toUpperCase() } ${ url }`)

      const request = Flowrunner.Request[method](url)
        .set(this.#headers())
        .query(finalQuery)

      if (body) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      this.#handleError(error, logTag)
    }
  }

  #headers() {
    const headers = { 'Content-Type': 'application/json' }

    if (this.authMethod !== 'query') {
      const token = Buffer.from(`${ this.consumerKey }:${ this.consumerSecret }`).toString('base64')

      headers.Authorization = `Basic ${ token }`
    }

    return headers
  }

  // Translate a friendly DROPDOWN label into the API value; pass through anything unmapped.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #handleError(error, logTag) {
    const status = error?.status || error?.body?.data?.status
    const apiMessage = error?.body?.message || error?.message || 'Request failed'
    const hint = ERROR_HINTS[status]

    logger.error(`${ logTag } failed (${ status || 'no status' }): ${ apiMessage }`)

    throw new Error(hint ? `${ hint } (${ apiMessage })` : apiMessage)
  }

  // ==========================================================================
  //  PRODUCTS
  // ==========================================================================
  /**
   * @operationName Create Product
   * @category Products
   * @description Creates a new product in the store catalog. Use this to add inventory programmatically - a simple item, or a variable parent you then attach variations to.
   * @route POST /create-product
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Product name shown to shoppers."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Simple","Variable (has variations)","Grouped (bundle of products)","External / Affiliate"]}},"description":"What kind of product this is. Default: Simple. Choose 'Variable' if it will have size/color options you add later."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Published","Draft","Pending review","Private"]}},"description":"Whether shoppers can see it. Default: Published."}
   * @paramDef {"type":"String","label":"Regular Price","name":"regularPrice","description":"Base price as a decimal string, e.g. \"21.99\"."}
   * @paramDef {"type":"String","label":"Sale Price","name":"salePrice","description":"Optional discounted price as a decimal string, e.g. \"19.99\". Must be lower than the regular price."}
   * @paramDef {"type":"Number","label":"Stock Quantity","name":"stockQuantity","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional number of units in stock. Setting this turns on stock tracking for the product."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Full product description (HTML allowed)."}
   * @paramDef {"type":"String","label":"SKU","name":"sku","description":"Stock keeping unit — must be unique across the catalog."}
   * @paramDef {"type":"Array<String>","label":"Category IDs","name":"categories","description":"Category IDs to file the product under. Use the Categories dictionary to pick them."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"additionalFields","freeform":true,"description":"Any other product fields (e.g. images, weight, tax_class) as a JSON object, merged as-is into the request body."}
   *
   * @returns {Object}
   * @sampleResult {"id":799,"name":"Premium Hoodie","slug":"premium-hoodie","type":"simple","status":"publish","price":"19.99","regular_price":"21.99","sale_price":"19.99","on_sale":true,"sku":"PH-001","manage_stock":true,"stock_quantity":100,"stock_status":"instock","categories":[{"id":9,"name":"Clothing"}],"permalink":"https://shop.example.com/product/premium-hoodie/"}
   */
  async createProduct(name, type, status, regularPrice, salePrice, stockQuantity, description, sku, categories, additionalFields) {
    const body = clean({
      name,
      type: this.#resolveChoice(type, PRODUCT_TYPE_MAP),
      status: this.#resolveChoice(status, PRODUCT_STATUS_MAP),
      regular_price: regularPrice,
      sale_price: salePrice,
      ...stockFields(stockQuantity),
      description,
      sku,
      categories: toIdRefs(categories),
      ...(additionalFields || {}),
    })

    return await this.#apiRequest({ url: `${ this.apiBase }/products`, method: 'post', body, logTag: 'createProduct' })
  }

  /**
   * @operationName Get Product
   * @category Products
   * @description Retrieves a single product by ID, including price, stock, and category data. Pick the product from the dropdown instead of pasting an ID.
   * @route POST /get-product
   *
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":799,"name":"Premium Hoodie","type":"simple","status":"publish","price":"21.99","regular_price":"21.99","sku":"PH-001","stock_status":"instock","categories":[{"id":9,"name":"Clothing"}]}
   */
  async getProduct(productId) {
    return await this.#apiRequest({ url: `${ this.apiBase }/products/${ productId }`, logTag: 'getProduct' })
  }

  /**
   * @operationName List Products
   * @category Products
   * @description Lists products, optionally filtered by search text, category, or status. Use this to browse the catalog or find a product before acting on it.
   * @route POST /list-products
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter by product name or SKU."}
   * @paramDef {"type":"String","label":"Category","name":"category","dictionary":"getProductCategoriesDictionary","description":"Only return products in this category."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Any","Published","Draft","Pending review","Private"]}},"description":"Only show products with this visibility. Default: Any."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page (1-100). Default: 20."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":799,"name":"Premium Hoodie","sku":"PH-001","price":"21.99","stock_status":"instock","status":"publish"}]
   */
  async listProducts(search, category, status, perPage, page) {
    const query = clean({ search, category, status: this.#resolveChoice(status, PRODUCT_STATUS_MAP), per_page: perPage || 20, page: page || 1 })

    return await this.#apiRequest({ url: `${ this.apiBase }/products`, query, logTag: 'listProducts' })
  }

  /**
   * @operationName Update Product
   * @category Products
   * @description Updates an existing product's name, price, status, or any other field. Use this to change pricing, publish a draft, or adjust catalog details.
   * @route POST /update-product
   *
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New product name."}
   * @paramDef {"type":"String","label":"Regular Price","name":"regularPrice","description":"New base price as a decimal string, e.g. \"19.99\"."}
   * @paramDef {"type":"String","label":"Sale Price","name":"salePrice","description":"New discounted price as a decimal string. Must be lower than the regular price; send an empty string to clear it."}
   * @paramDef {"type":"Number","label":"Stock Quantity","name":"stockQuantity","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New number of units in stock. Setting this turns on stock tracking for the product."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Published","Draft","Pending review","Private"]}},"description":"New visibility for shoppers."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"additionalFields","freeform":true,"description":"Any other product fields to update (e.g. images, weight, tax_class) as a JSON object, merged as-is into the request body."}
   *
   * @returns {Object}
   * @sampleResult {"id":799,"name":"Premium Hoodie","status":"publish","price":"17.99","regular_price":"19.99","sale_price":"17.99","sku":"PH-001","manage_stock":true,"stock_quantity":90}
   */
  async updateProduct(productId, name, regularPrice, salePrice, stockQuantity, status, additionalFields) {
    const body = clean({ name, regular_price: regularPrice, sale_price: salePrice, ...stockFields(stockQuantity), status: this.#resolveChoice(status, PRODUCT_STATUS_MAP), ...(additionalFields || {}) })

    return await this.#apiRequest({ url: `${ this.apiBase }/products/${ productId }`, method: 'put', body, logTag: 'updateProduct' })
  }

  /**
   * @operationName Delete Product
   * @category Products
   * @description Deletes a product. By default it is moved to trash; enable Permanent to remove it entirely. Use when retiring inventory.
   * @route POST /delete-product
   *
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product to delete."}
   * @paramDef {"type":"Boolean","label":"Permanent","name":"force","uiComponent":{"type":"TOGGLE"},"description":"Permanently delete instead of moving to trash."}
   *
   * @returns {Object}
   * @sampleResult {"id":799,"name":"Premium Hoodie","status":"trash"}
   */
  async deleteProduct(productId, force) {
    return await this.#apiRequest({ url: `${ this.apiBase }/products/${ productId }`, method: 'delete', query: { force: Boolean(force) }, logTag: 'deleteProduct' })
  }

  // ==========================================================================
  //  PRODUCT VARIATIONS
  // ==========================================================================
  /**
   * @operationName Create Product Variation
   * @category Product Variations
   * @description Adds a variation (e.g. a specific size/color combination) to a variable product. Use after creating a 'variable' product to define its purchasable options.
   * @route POST /create-product-variation
   *
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The parent variable product."}
   * @paramDef {"type":"String","label":"Regular Price","name":"regularPrice","description":"Variation price as a decimal string, e.g. \"24.99\"."}
   * @paramDef {"type":"String","label":"Sale Price","name":"salePrice","description":"Optional discounted price as a decimal string. Must be lower than the regular price."}
   * @paramDef {"type":"Number","label":"Stock Quantity","name":"stockQuantity","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional units in stock for this variation. Setting this turns on stock tracking."}
   * @paramDef {"type":"String","label":"SKU","name":"sku","description":"Unique SKU for this variation."}
   * @paramDef {"type":"Array<VariationAttribute>","label":"Attributes","name":"attributes","description":"Attribute selections that define this variation, e.g. [{\"name\":\"Color\",\"option\":\"Blue\"}]."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"additionalFields","freeform":true,"description":"Any other variation fields (e.g. image, weight, tax_class) as a JSON object, merged as-is into the request body."}
   *
   * @returns {Object}
   * @sampleResult {"id":733,"sku":"PH-001-BLUE","price":"22.99","regular_price":"24.99","sale_price":"22.99","manage_stock":true,"stock_quantity":50,"stock_status":"instock","attributes":[{"name":"Color","option":"Blue"}]}
   */
  async createProductVariation(productId, regularPrice, salePrice, stockQuantity, sku, attributes, additionalFields) {
    const body = clean({ regular_price: regularPrice, sale_price: salePrice, ...stockFields(stockQuantity), sku, attributes, ...(additionalFields || {}) })

    return await this.#apiRequest({ url: `${ this.apiBase }/products/${ productId }/variations`, method: 'post', body, logTag: 'createProductVariation' })
  }

  /**
   * @operationName Get Product Variation
   * @category Product Variations
   * @description Retrieves a single variation of a variable product by ID, including its price and stock.
   * @route POST /get-product-variation
   *
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The parent variable product."}
   * @paramDef {"type":"String","label":"Variation","name":"variationId","required":true,"dictionary":"getProductVariationsDictionary","dependsOn":["productId"],"description":"The variation to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":733,"sku":"PH-001-BLUE","price":"24.99","regular_price":"24.99","stock_status":"instock","attributes":[{"name":"Color","option":"Blue"}]}
   */
  async getProductVariation(productId, variationId) {
    return await this.#apiRequest({ url: `${ this.apiBase }/products/${ productId }/variations/${ variationId }`, logTag: 'getProductVariation' })
  }

  /**
   * @operationName List Product Variations
   * @category Product Variations
   * @description Lists all variations of a variable product. Use to enumerate the purchasable options of a product.
   * @route POST /list-product-variations
   *
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The parent variable product."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page (1-100). Default: 20."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":733,"sku":"PH-001-BLUE","price":"24.99","stock_status":"instock","attributes":[{"name":"Color","option":"Blue"}]}]
   */
  async listProductVariations(productId, perPage, page) {
    const query = clean({ per_page: perPage || 20, page: page || 1 })

    return await this.#apiRequest({ url: `${ this.apiBase }/products/${ productId }/variations`, query, logTag: 'listProductVariations' })
  }

  /**
   * @operationName Update Product Variation
   * @category Product Variations
   * @description Updates a variation's price, stock, or other fields. Use to reprice or restock a specific size/color.
   * @route POST /update-product-variation
   *
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The parent variable product."}
   * @paramDef {"type":"String","label":"Variation","name":"variationId","required":true,"dictionary":"getProductVariationsDictionary","dependsOn":["productId"],"description":"The variation to update."}
   * @paramDef {"type":"String","label":"Regular Price","name":"regularPrice","description":"New variation price as a decimal string."}
   * @paramDef {"type":"String","label":"Sale Price","name":"salePrice","description":"New discounted price as a decimal string. Must be lower than the regular price; send an empty string to clear it."}
   * @paramDef {"type":"Number","label":"Stock Quantity","name":"stockQuantity","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New units in stock for this variation. Setting this turns on stock tracking."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"additionalFields","freeform":true,"description":"Any other variation fields to update as a JSON object, merged as-is into the request body."}
   *
   * @returns {Object}
   * @sampleResult {"id":733,"sku":"PH-001-BLUE","price":"20.99","regular_price":"22.99","sale_price":"20.99","manage_stock":true,"stock_quantity":40,"stock_status":"instock"}
   */
  async updateProductVariation(productId, variationId, regularPrice, salePrice, stockQuantity, additionalFields) {
    const body = clean({ regular_price: regularPrice, sale_price: salePrice, ...stockFields(stockQuantity), ...(additionalFields || {}) })

    return await this.#apiRequest({ url: `${ this.apiBase }/products/${ productId }/variations/${ variationId }`, method: 'put', body, logTag: 'updateProductVariation' })
  }

  /**
   * @operationName Delete Product Variation
   * @category Product Variations
   * @description Permanently deletes a variation of a variable product. Variations cannot be trashed, so this removal is final.
   * @route POST /delete-product-variation
   *
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The parent variable product."}
   * @paramDef {"type":"String","label":"Variation","name":"variationId","required":true,"dictionary":"getProductVariationsDictionary","dependsOn":["productId"],"description":"The variation to delete."}
   *
   * @returns {Object}
   * @sampleResult {"id":733,"sku":"PH-001-BLUE","price":"24.99"}
   */
  async deleteProductVariation(productId, variationId) {
    return await this.#apiRequest({ url: `${ this.apiBase }/products/${ productId }/variations/${ variationId }`, method: 'delete', query: { force: true }, logTag: 'deleteProductVariation' })
  }

  // ==========================================================================
  //  PRODUCT CATEGORIES
  // ==========================================================================
  /**
   * @operationName Create Product Category
   * @category Product Categories
   * @description Creates a product category to organize the catalog. Optionally nest it under a parent category.
   * @route POST /create-product-category
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Category name."}
   * @paramDef {"type":"String","label":"Parent Category","name":"parent","dictionary":"getProductCategoriesDictionary","description":"Optional parent category to nest under."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional category description."}
   *
   * @returns {Object}
   * @sampleResult {"id":9,"name":"Clothing","slug":"clothing","parent":0,"description":"Apparel","count":0}
   */
  async createProductCategory(name, parent, description) {
    const body = clean({ name, parent: parent ? Number(parent) : undefined, description })

    return await this.#apiRequest({ url: `${ this.apiBase }/products/categories`, method: 'post', body, logTag: 'createProductCategory' })
  }

  /**
   * @operationName Get Product Category
   * @category Product Categories
   * @description Retrieves a single product category by ID, including its product count and parent.
   * @route POST /get-product-category
   *
   * @paramDef {"type":"String","label":"Category","name":"categoryId","required":true,"dictionary":"getProductCategoriesDictionary","description":"The category to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":9,"name":"Clothing","slug":"clothing","parent":0,"description":"Apparel","count":36}
   */
  async getProductCategory(categoryId) {
    return await this.#apiRequest({ url: `${ this.apiBase }/products/categories/${ categoryId }`, logTag: 'getProductCategory' })
  }

  /**
   * @operationName List Product Categories
   * @category Product Categories
   * @description Lists product categories, optionally filtered by search text. Use to discover how the catalog is organized.
   * @route POST /list-product-categories
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter by category name."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page (1-100). Default: 20."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":9,"name":"Clothing","slug":"clothing","parent":0,"count":36}]
   */
  async listProductCategories(search, perPage, page) {
    const query = clean({ search, per_page: perPage || 20, page: page || 1 })

    return await this.#apiRequest({ url: `${ this.apiBase }/products/categories`, query, logTag: 'listProductCategories' })
  }

  /**
   * @operationName Update Product Category
   * @category Product Categories
   * @description Updates a product category's name or description.
   * @route POST /update-product-category
   *
   * @paramDef {"type":"String","label":"Category","name":"categoryId","required":true,"dictionary":"getProductCategoriesDictionary","description":"The category to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New category name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New category description."}
   *
   * @returns {Object}
   * @sampleResult {"id":9,"name":"Apparel","slug":"clothing","parent":0,"description":"Updated","count":36}
   */
  async updateProductCategory(categoryId, name, description) {
    const body = clean({ name, description })

    return await this.#apiRequest({ url: `${ this.apiBase }/products/categories/${ categoryId }`, method: 'put', body, logTag: 'updateProductCategory' })
  }

  /**
   * @operationName Delete Product Category
   * @category Product Categories
   * @description Permanently deletes a product category. Categories cannot be trashed, so this removal is final; products are not deleted but lose this category.
   * @route POST /delete-product-category
   *
   * @paramDef {"type":"String","label":"Category","name":"categoryId","required":true,"dictionary":"getProductCategoriesDictionary","description":"The category to delete."}
   *
   * @returns {Object}
   * @sampleResult {"id":9,"name":"Clothing","slug":"clothing"}
   */
  async deleteProductCategory(categoryId) {
    return await this.#apiRequest({ url: `${ this.apiBase }/products/categories/${ categoryId }`, method: 'delete', query: { force: true }, logTag: 'deleteProductCategory' })
  }

  // ==========================================================================
  //  PRODUCT ATTRIBUTES - global attributes (e.g. "Color", "Size") used to build variable products
  // ==========================================================================
  /**
   * @operationName Create Product Attribute
   * @category Product Attributes
   * @description Creates a global product attribute (e.g. "Color" or "Size") that can be reused across products. Create this first, then add its terms (the selectable values) and assign it to a variable product before defining variations.
   * @route POST /create-product-attribute
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Attribute name, e.g. \"Color\"."}
   * @paramDef {"type":"String","label":"Slug","name":"slug","description":"Optional URL-safe identifier. Auto-generated from the name if omitted."}
   * @paramDef {"type":"String","label":"Type","name":"type","description":"Attribute type. WooCommerce currently only supports \"select\" (the default); leave blank unless a plugin has registered a custom type."}
   * @paramDef {"type":"String","label":"Sort Terms By","name":"orderBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Menu Order","Name","Name (Numeric)","ID"]}},"description":"Default order for this attribute's terms in the storefront. Default: Menu Order."}
   * @paramDef {"type":"Boolean","label":"Enable Archives","name":"hasArchives","uiComponent":{"type":"TOGGLE"},"description":"If on, enables a public archive page listing products for each term of this attribute."}
   *
   * @returns {Object}
   * @sampleResult {"id":3,"name":"Color","slug":"color","type":"select","order_by":"menu_order","has_archives":false}
   */
  async createProductAttribute(name, slug, type, orderBy, hasArchives) {
    const body = clean({ name, slug, type, order_by: this.#resolveChoice(orderBy, ATTRIBUTE_ORDER_BY_MAP), has_archives: hasArchives })

    return await this.#apiRequest({ url: `${ this.apiBase }/products/attributes`, method: 'post', body, logTag: 'createProductAttribute' })
  }

  /**
   * @operationName Get Product Attribute
   * @category Product Attributes
   * @description Retrieves a single global product attribute by ID, including its type and sort order.
   * @route POST /get-product-attribute
   *
   * @paramDef {"type":"String","label":"Attribute","name":"attributeId","required":true,"dictionary":"getProductAttributesDictionary","description":"The attribute to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":3,"name":"Color","slug":"color","type":"select","order_by":"menu_order","has_archives":false}
   */
  async getProductAttribute(attributeId) {
    return await this.#apiRequest({ url: `${ this.apiBase }/products/attributes/${ attributeId }`, logTag: 'getProductAttribute' })
  }

  /**
   * @operationName List Product Attributes
   * @category Product Attributes
   * @description Lists the store's global product attributes, optionally filtered by search text. Use to discover which attributes exist before creating terms or assigning them to a variable product.
   * @route POST /list-product-attributes
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter by attribute name."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page (1-100). Default: 20."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":3,"name":"Color","slug":"color","type":"select","order_by":"menu_order","has_archives":false}]
   */
  async listProductAttributes(search, perPage, page) {
    const query = clean({ search, per_page: perPage || 20, page: page || 1 })

    return await this.#apiRequest({ url: `${ this.apiBase }/products/attributes`, query, logTag: 'listProductAttributes' })
  }

  /**
   * @operationName Update Product Attribute
   * @category Product Attributes
   * @description Updates a global product attribute's name, slug, sort order, or archive setting.
   * @route POST /update-product-attribute
   *
   * @paramDef {"type":"String","label":"Attribute","name":"attributeId","required":true,"dictionary":"getProductAttributesDictionary","description":"The attribute to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New attribute name."}
   * @paramDef {"type":"String","label":"Slug","name":"slug","description":"New URL-safe identifier."}
   * @paramDef {"type":"String","label":"Sort Terms By","name":"orderBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Menu Order","Name","Name (Numeric)","ID"]}},"description":"New default order for this attribute's terms in the storefront."}
   * @paramDef {"type":"Boolean","label":"Enable Archives","name":"hasArchives","uiComponent":{"type":"TOGGLE"},"description":"If on, enables a public archive page listing products for each term of this attribute."}
   *
   * @returns {Object}
   * @sampleResult {"id":3,"name":"Color","slug":"color","type":"select","order_by":"name","has_archives":true}
   */
  async updateProductAttribute(attributeId, name, slug, orderBy, hasArchives) {
    const body = clean({ name, slug, order_by: this.#resolveChoice(orderBy, ATTRIBUTE_ORDER_BY_MAP), has_archives: hasArchives })

    return await this.#apiRequest({ url: `${ this.apiBase }/products/attributes/${ attributeId }`, method: 'put', body, logTag: 'updateProductAttribute' })
  }

  /**
   * @operationName Delete Product Attribute
   * @category Product Attributes
   * @description Permanently deletes a global product attribute and all of its terms. Attributes cannot be trashed, so this removal is final; products that used it lose those attribute selections.
   * @route POST /delete-product-attribute
   *
   * @paramDef {"type":"String","label":"Attribute","name":"attributeId","required":true,"dictionary":"getProductAttributesDictionary","description":"The attribute to delete."}
   *
   * @returns {Object}
   * @sampleResult {"id":3,"name":"Color","slug":"color","type":"select"}
   */
  async deleteProductAttribute(attributeId) {
    return await this.#apiRequest({ url: `${ this.apiBase }/products/attributes/${ attributeId }`, method: 'delete', query: { force: true }, logTag: 'deleteProductAttribute' })
  }

  // ==========================================================================
  //  ATTRIBUTE TERMS - the selectable values (e.g. "Blue", "Large") of a global product attribute
  // ==========================================================================
  /**
   * @operationName Create Attribute Term
   * @category Product Attributes
   * @description Adds a selectable term (e.g. "Blue" for the "Color" attribute) to a global product attribute. Use after creating the attribute so it has values to assign to variable products.
   * @route POST /create-attribute-term
   *
   * @paramDef {"type":"String","label":"Attribute","name":"attributeId","required":true,"dictionary":"getProductAttributesDictionary","description":"The attribute this term belongs to."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Term name, e.g. \"Blue\"."}
   * @paramDef {"type":"String","label":"Slug","name":"slug","description":"Optional URL-safe identifier. Auto-generated from the name if omitted."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional HTML description of the term."}
   * @paramDef {"type":"Number","label":"Menu Order","name":"menuOrder","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional position used to custom-sort this term among its attribute's other terms."}
   *
   * @returns {Object}
   * @sampleResult {"id":12,"name":"Blue","slug":"blue","description":"","menu_order":0,"count":0}
   */
  async createAttributeTerm(attributeId, name, slug, description, menuOrder) {
    const body = clean({ name, slug, description, menu_order: menuOrder != null ? Number(menuOrder) : undefined })

    return await this.#apiRequest({ url: `${ this.apiBase }/products/attributes/${ attributeId }/terms`, method: 'post', body, logTag: 'createAttributeTerm' })
  }

  /**
   * @operationName Get Attribute Term
   * @category Product Attributes
   * @description Retrieves a single term of a global product attribute by ID, including how many products use it.
   * @route POST /get-attribute-term
   *
   * @paramDef {"type":"String","label":"Attribute","name":"attributeId","required":true,"dictionary":"getProductAttributesDictionary","description":"The attribute this term belongs to."}
   * @paramDef {"type":"String","label":"Term","name":"termId","required":true,"dictionary":"getAttributeTermsDictionary","dependsOn":["attributeId"],"description":"The term to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":12,"name":"Blue","slug":"blue","description":"","menu_order":0,"count":8}
   */
  async getAttributeTerm(attributeId, termId) {
    return await this.#apiRequest({ url: `${ this.apiBase }/products/attributes/${ attributeId }/terms/${ termId }`, logTag: 'getAttributeTerm' })
  }

  /**
   * @operationName List Attribute Terms
   * @category Product Attributes
   * @description Lists the terms (selectable values) of a global product attribute, optionally filtered by search text. Use to see or reuse an attribute's existing options, e.g. all colors already defined.
   * @route POST /list-attribute-terms
   *
   * @paramDef {"type":"String","label":"Attribute","name":"attributeId","required":true,"dictionary":"getProductAttributesDictionary","description":"The attribute whose terms to list."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter by term name."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page (1-100). Default: 20."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":12,"name":"Blue","slug":"blue","menu_order":0,"count":8}]
   */
  async listAttributeTerms(attributeId, search, perPage, page) {
    const query = clean({ search, per_page: perPage || 20, page: page || 1 })

    return await this.#apiRequest({ url: `${ this.apiBase }/products/attributes/${ attributeId }/terms`, query, logTag: 'listAttributeTerms' })
  }

  /**
   * @operationName Update Attribute Term
   * @category Product Attributes
   * @description Updates a term's name, slug, description, or sort order within a global product attribute.
   * @route POST /update-attribute-term
   *
   * @paramDef {"type":"String","label":"Attribute","name":"attributeId","required":true,"dictionary":"getProductAttributesDictionary","description":"The attribute this term belongs to."}
   * @paramDef {"type":"String","label":"Term","name":"termId","required":true,"dictionary":"getAttributeTermsDictionary","dependsOn":["attributeId"],"description":"The term to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New term name."}
   * @paramDef {"type":"String","label":"Slug","name":"slug","description":"New URL-safe identifier."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New HTML description of the term."}
   * @paramDef {"type":"Number","label":"Menu Order","name":"menuOrder","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New position used to custom-sort this term among its attribute's other terms."}
   *
   * @returns {Object}
   * @sampleResult {"id":12,"name":"Navy Blue","slug":"blue","description":"","menu_order":1,"count":8}
   */
  async updateAttributeTerm(attributeId, termId, name, slug, description, menuOrder) {
    const body = clean({ name, slug, description, menu_order: menuOrder != null ? Number(menuOrder) : undefined })

    return await this.#apiRequest({ url: `${ this.apiBase }/products/attributes/${ attributeId }/terms/${ termId }`, method: 'put', body, logTag: 'updateAttributeTerm' })
  }

  /**
   * @operationName Delete Attribute Term
   * @category Product Attributes
   * @description Permanently deletes a term from a global product attribute. Terms cannot be trashed, so this removal is final; variations using it lose that attribute selection.
   * @route POST /delete-attribute-term
   *
   * @paramDef {"type":"String","label":"Attribute","name":"attributeId","required":true,"dictionary":"getProductAttributesDictionary","description":"The attribute this term belongs to."}
   * @paramDef {"type":"String","label":"Term","name":"termId","required":true,"dictionary":"getAttributeTermsDictionary","dependsOn":["attributeId"],"description":"The term to delete."}
   *
   * @returns {Object}
   * @sampleResult {"id":12,"name":"Blue","slug":"blue"}
   */
  async deleteAttributeTerm(attributeId, termId) {
    return await this.#apiRequest({ url: `${ this.apiBase }/products/attributes/${ attributeId }/terms/${ termId }`, method: 'delete', query: { force: true }, logTag: 'deleteAttributeTerm' })
  }

  // ==========================================================================
  //  ORDERS
  // ==========================================================================
  /**
   * @operationName Create Order
   * @category Orders
   * @description Creates an order with line items, customer, and billing details. Use to record a sale made outside the storefront or to draft an order for a customer.
   * @route POST /create-order
   *
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Pending payment","Processing","On hold","Completed","Cancelled","Refunded","Failed"]}},"description":"Where the order sits in your workflow. Default: Pending payment."}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","dictionary":"getCustomersDictionary","description":"Registered customer to attach (omit for a guest order)."}
   * @paramDef {"type":"String","label":"Payment Method","name":"paymentMethod","description":"The payment method's ID, e.g. \"bacs\" for direct bank transfer or \"stripe\" for card payments."}
   * @paramDef {"type":"Boolean","label":"Mark as Paid","name":"setPaid","uiComponent":{"type":"TOGGLE"},"description":"Mark the order as paid immediately."}
   * @paramDef {"type":"Object","label":"Billing","name":"billing","schemaLoader":"addressSchema","description":"Billing address as a JSON object with these keys: first_name, last_name, email, address_1, city, postcode, country (2-letter code)."}
   * @paramDef {"type":"Object","label":"Shipping","name":"shipping","schemaLoader":"addressSchema","description":"Shipping address as a JSON object with these keys: first_name, last_name, address_1, city, postcode, country (2-letter code)."}
   * @paramDef {"type":"Array<OrderLineItem>","label":"Line Items","name":"lineItems","description":"The products on this order, as a list. Each entry needs a productId and a quantity — look up product IDs with List Products. Example: [{\"productId\":\"799\",\"quantity\":2}]."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"additionalFields","freeform":true,"description":"Any other order fields (e.g. shipping_lines, coupon_lines, currency) as a JSON object, merged as-is into the request body."}
   *
   * @returns {Object}
   * @sampleResult {"id":727,"status":"pending","currency":"USD","total":"43.98","customer_id":25,"billing":{"first_name":"John","last_name":"Doe","email":"john@example.com"},"line_items":[{"id":315,"name":"Premium Hoodie","product_id":799,"quantity":2,"total":"43.98"}],"date_created":"2026-05-30T10:00:00"}
   */
  async createOrder(status, customerId, paymentMethod, setPaid, billing, shipping, lineItems, additionalFields) {
    const body = clean({
      status: this.#resolveChoice(status, ORDER_STATUS_MAP),
      customer_id: customerId ? Number(customerId) : undefined,
      payment_method: paymentMethod,
      set_paid: setPaid,
      billing,
      shipping,
      line_items: toLineItems(lineItems),
      ...(additionalFields || {}),
    })

    return await this.#apiRequest({ url: `${ this.apiBase }/orders`, method: 'post', body, logTag: 'createOrder' })
  }

  /**
   * @operationName Get Order
   * @category Orders
   * @description Retrieves a single order by ID, including line items, totals, and customer/billing data.
   * @route POST /get-order
   *
   * @paramDef {"type":"String","label":"Order","name":"orderId","required":true,"dictionary":"getOrdersDictionary","description":"The order to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":727,"status":"processing","currency":"USD","total":"43.98","customer_id":25,"billing":{"first_name":"John","last_name":"Doe","email":"john@example.com"},"line_items":[{"id":315,"name":"Premium Hoodie","product_id":799,"quantity":2,"total":"43.98"}]}
   */
  async getOrder(orderId) {
    return await this.#apiRequest({ url: `${ this.apiBase }/orders/${ orderId }`, logTag: 'getOrder' })
  }

  /**
   * @operationName List Orders
   * @category Orders
   * @description Lists orders, optionally filtered by status, customer, or search text. Use to find recent sales or a customer's order history.
   * @route POST /list-orders
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter by order content (e.g. customer name or email)."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Any","Pending payment","Processing","On hold","Completed","Cancelled","Refunded","Failed"]}},"description":"Only show orders in this state. Default: Any."}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","dictionary":"getCustomersDictionary","description":"Only return orders for this customer."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page (1-100). Default: 20."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":727,"status":"processing","total":"43.98","customer_id":25,"date_created":"2026-05-30T10:00:00"}]
   */
  async listOrders(search, status, customerId, perPage, page) {
    const query = clean({
      search,
      status: this.#resolveChoice(status, ORDER_STATUS_MAP),
      customer: customerId ? Number(customerId) : undefined,
      per_page: perPage || 20,
      page: page || 1,
    })

    return await this.#apiRequest({ url: `${ this.apiBase }/orders`, query, logTag: 'listOrders' })
  }

  /**
   * @operationName Update Order
   * @category Orders
   * @description Updates an order - most often to change its status (e.g. mark processing or completed). Use to advance fulfillment or correct order details.
   * @route POST /update-order
   *
   * @paramDef {"type":"String","label":"Order","name":"orderId","required":true,"dictionary":"getOrdersDictionary","description":"The order to update."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Pending payment","Processing","On hold","Completed","Cancelled","Refunded","Failed"]}},"description":"The new state for the order (e.g. move it to Processing or Completed)."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"additionalFields","freeform":true,"description":"Any other order fields to update as a JSON object, merged as-is into the request body."}
   *
   * @returns {Object}
   * @sampleResult {"id":727,"status":"completed","currency":"USD","total":"43.98","customer_id":25}
   */
  async updateOrder(orderId, status, additionalFields) {
    const body = clean({ status: this.#resolveChoice(status, ORDER_STATUS_MAP), ...(additionalFields || {}) })

    return await this.#apiRequest({ url: `${ this.apiBase }/orders/${ orderId }`, method: 'put', body, logTag: 'updateOrder' })
  }

  /**
   * @operationName Delete Order
   * @category Orders
   * @description Deletes an order. By default it is moved to trash; enable Permanent to remove it entirely.
   * @route POST /delete-order
   *
   * @paramDef {"type":"String","label":"Order","name":"orderId","required":true,"dictionary":"getOrdersDictionary","description":"The order to delete."}
   * @paramDef {"type":"Boolean","label":"Permanent","name":"force","uiComponent":{"type":"TOGGLE"},"description":"Permanently delete instead of moving to trash."}
   *
   * @returns {Object}
   * @sampleResult {"id":727,"status":"trash","total":"43.98"}
   */
  async deleteOrder(orderId, force) {
    return await this.#apiRequest({ url: `${ this.apiBase }/orders/${ orderId }`, method: 'delete', query: { force: Boolean(force) }, logTag: 'deleteOrder' })
  }

  // ==========================================================================
  //  ORDER NOTES
  // ==========================================================================
  /**
   * @operationName Create Order Note
   * @category Order Notes
   * @description Adds a note to an order. Mark it as a customer note to email it to the buyer, or leave it private for staff. Use for fulfillment updates or internal remarks.
   * @route POST /create-order-note
   *
   * @paramDef {"type":"String","label":"Order","name":"orderId","required":true,"dictionary":"getOrdersDictionary","description":"The order to annotate."}
   * @paramDef {"type":"String","label":"Note","name":"note","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The note text."}
   * @paramDef {"type":"Boolean","label":"Customer Note","name":"customerNote","uiComponent":{"type":"TOGGLE"},"description":"If on, the note is emailed to the customer; otherwise it is private."}
   *
   * @returns {Object}
   * @sampleResult {"id":314,"author":"system","note":"Order shipped via UPS","customer_note":true,"date_created":"2026-05-30T10:05:00"}
   */
  async createOrderNote(orderId, note, customerNote) {
    const body = clean({ note, customer_note: Boolean(customerNote) })

    return await this.#apiRequest({ url: `${ this.apiBase }/orders/${ orderId }/notes`, method: 'post', body, logTag: 'createOrderNote' })
  }

  /**
   * @operationName Get Order Note
   * @category Order Notes
   * @description Retrieves a single note on an order by ID.
   * @route POST /get-order-note
   *
   * @paramDef {"type":"String","label":"Order","name":"orderId","required":true,"dictionary":"getOrdersDictionary","description":"The order the note belongs to."}
   * @paramDef {"type":"String","label":"Note","name":"noteId","required":true,"dictionary":"getOrderNotesDictionary","dependsOn":["orderId"],"description":"The note to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":314,"author":"system","note":"Order shipped via UPS","customer_note":true,"date_created":"2026-05-30T10:05:00"}
   */
  async getOrderNote(orderId, noteId) {
    return await this.#apiRequest({ url: `${ this.apiBase }/orders/${ orderId }/notes/${ noteId }`, logTag: 'getOrderNote' })
  }

  /**
   * @operationName List Order Notes
   * @category Order Notes
   * @description Lists all notes on an order, both customer-facing and private. Use to review an order's history.
   * @route POST /list-order-notes
   *
   * @paramDef {"type":"String","label":"Order","name":"orderId","required":true,"dictionary":"getOrdersDictionary","description":"The order whose notes to list."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":314,"author":"system","note":"Order shipped via UPS","customer_note":true,"date_created":"2026-05-30T10:05:00"}]
   */
  async listOrderNotes(orderId) {
    return await this.#apiRequest({ url: `${ this.apiBase }/orders/${ orderId }/notes`, logTag: 'listOrderNotes' })
  }

  /**
   * @operationName Delete Order Note
   * @category Order Notes
   * @description Permanently deletes a note from an order. Notes cannot be trashed, so this removal is final.
   * @route POST /delete-order-note
   *
   * @paramDef {"type":"String","label":"Order","name":"orderId","required":true,"dictionary":"getOrdersDictionary","description":"The order the note belongs to."}
   * @paramDef {"type":"String","label":"Note","name":"noteId","required":true,"dictionary":"getOrderNotesDictionary","dependsOn":["orderId"],"description":"The note to delete."}
   *
   * @returns {Object}
   * @sampleResult {"id":314,"note":"Order shipped via UPS","customer_note":true}
   */
  async deleteOrderNote(orderId, noteId) {
    return await this.#apiRequest({ url: `${ this.apiBase }/orders/${ orderId }/notes/${ noteId }`, method: 'delete', query: { force: true }, logTag: 'deleteOrderNote' })
  }

  // ==========================================================================
  //  ORDER REFUNDS
  // ==========================================================================
  /**
   * @operationName Create Order Refund
   * @category Order Refunds
   * @description Issues a refund against an order for a given amount. Optionally trigger the payment gateway to refund the customer automatically. Use for returns and chargebacks.
   * @route POST /create-order-refund
   *
   * @paramDef {"type":"String","label":"Order","name":"orderId","required":true,"dictionary":"getOrdersDictionary","description":"The order to refund."}
   * @paramDef {"type":"String","label":"Amount","name":"amount","required":true,"description":"Refund amount as a decimal string, e.g. \"10.00\"."}
   * @paramDef {"type":"String","label":"Reason","name":"reason","description":"Optional reason recorded with the refund."}
   * @paramDef {"type":"Boolean","label":"Refund via Gateway","name":"refundPayment","uiComponent":{"type":"TOGGLE"},"description":"If on, instruct the payment gateway to actually return the funds."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"additionalFields","freeform":true,"description":"Any other refund fields (e.g. line_items) as a JSON object, merged as-is into the request body."}
   *
   * @returns {Object}
   * @sampleResult {"id":726,"amount":"10.00","reason":"Item returned","refunded_by":1,"date_created":"2026-05-30T10:10:00"}
   */
  async createOrderRefund(orderId, amount, reason, refundPayment, additionalFields) {
    const body = clean({ amount, reason, api_refund: refundPayment, ...(additionalFields || {}) })

    return await this.#apiRequest({ url: `${ this.apiBase }/orders/${ orderId }/refunds`, method: 'post', body, logTag: 'createOrderRefund' })
  }

  /**
   * @operationName Get Order Refund
   * @category Order Refunds
   * @description Retrieves a single refund on an order by ID.
   * @route POST /get-order-refund
   *
   * @paramDef {"type":"String","label":"Order","name":"orderId","required":true,"dictionary":"getOrdersDictionary","description":"The order the refund belongs to."}
   * @paramDef {"type":"String","label":"Refund","name":"refundId","required":true,"dictionary":"getOrderRefundsDictionary","dependsOn":["orderId"],"description":"The refund to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":726,"amount":"10.00","reason":"Item returned","refunded_by":1,"date_created":"2026-05-30T10:10:00"}
   */
  async getOrderRefund(orderId, refundId) {
    return await this.#apiRequest({ url: `${ this.apiBase }/orders/${ orderId }/refunds/${ refundId }`, logTag: 'getOrderRefund' })
  }

  /**
   * @operationName List Order Refunds
   * @category Order Refunds
   * @description Lists all refunds issued against an order. Use to total what has already been refunded.
   * @route POST /list-order-refunds
   *
   * @paramDef {"type":"String","label":"Order","name":"orderId","required":true,"dictionary":"getOrdersDictionary","description":"The order whose refunds to list."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":726,"amount":"10.00","reason":"Item returned","refunded_by":1,"date_created":"2026-05-30T10:10:00"}]
   */
  async listOrderRefunds(orderId) {
    return await this.#apiRequest({ url: `${ this.apiBase }/orders/${ orderId }/refunds`, logTag: 'listOrderRefunds' })
  }

  /**
   * @operationName Delete Order Refund
   * @category Order Refunds
   * @description Permanently deletes a refund record from an order. This removes the record only; it does not reverse money already returned.
   * @route POST /delete-order-refund
   *
   * @paramDef {"type":"String","label":"Order","name":"orderId","required":true,"dictionary":"getOrdersDictionary","description":"The order the refund belongs to."}
   * @paramDef {"type":"String","label":"Refund","name":"refundId","required":true,"dictionary":"getOrderRefundsDictionary","dependsOn":["orderId"],"description":"The refund to delete."}
   *
   * @returns {Object}
   * @sampleResult {"id":726,"amount":"10.00","reason":"Item returned"}
   */
  async deleteOrderRefund(orderId, refundId) {
    return await this.#apiRequest({ url: `${ this.apiBase }/orders/${ orderId }/refunds/${ refundId }`, method: 'delete', query: { force: true }, logTag: 'deleteOrderRefund' })
  }

  // ==========================================================================
  //  CUSTOMERS
  // ==========================================================================
  /**
   * @operationName Create Customer
   * @category Customers
   * @description Creates a customer account. Use to register a buyer programmatically so future orders attach to a known profile.
   * @route POST /create-customer
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Customer email — must be unique across the store."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"Customer first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Customer last name."}
   * @paramDef {"type":"String","label":"Username","name":"username","description":"Optional login username (defaults to the email if omitted)."}
   * @paramDef {"type":"String","label":"Password","name":"password","description":"Optional account password (auto-generated if omitted)."}
   * @paramDef {"type":"Object","label":"Billing","name":"billing","schemaLoader":"addressSchema","description":"Billing address object (first_name, last_name, address_1, city, postcode, country, ...)."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"additionalFields","freeform":true,"description":"Any other customer fields (e.g. shipping, meta_data) as a JSON object, merged as-is into the request body."}
   *
   * @returns {Object}
   * @sampleResult {"id":25,"email":"john@example.com","first_name":"John","last_name":"Doe","username":"john.doe","role":"customer","is_paying_customer":false}
   */
  async createCustomer(email, firstName, lastName, username, password, billing, additionalFields) {
    const body = clean({
      email,
      first_name: firstName,
      last_name: lastName,
      username,
      password,
      billing,
      ...(additionalFields || {}),
    })

    return await this.#apiRequest({ url: `${ this.apiBase }/customers`, method: 'post', body, logTag: 'createCustomer' })
  }

  /**
   * @operationName Get Customer
   * @category Customers
   * @description Retrieves a single customer by ID, including billing/shipping and spend totals.
   * @route POST /get-customer
   *
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The customer to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":25,"email":"john@example.com","first_name":"John","last_name":"Doe","username":"john.doe","role":"customer","is_paying_customer":true}
   */
  async getCustomer(customerId) {
    return await this.#apiRequest({ url: `${ this.apiBase }/customers/${ customerId }`, logTag: 'getCustomer' })
  }

  /**
   * @operationName List Customers
   * @category Customers
   * @description Lists customers, optionally filtered by search text or an exact email. Use to look up a buyer before creating an order.
   * @route POST /list-customers
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter by name or email."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Return only the customer with this exact email."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page (1-100). Default: 20."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":25,"email":"john@example.com","first_name":"John","last_name":"Doe","role":"customer"}]
   */
  async listCustomers(search, email, perPage, page) {
    const query = clean({ search, email, per_page: perPage || 20, page: page || 1 })

    return await this.#apiRequest({ url: `${ this.apiBase }/customers`, query, logTag: 'listCustomers' })
  }

  /**
   * @operationName Update Customer
   * @category Customers
   * @description Updates a customer's profile fields, e.g. name or addresses.
   * @route POST /update-customer
   *
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The customer to update."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"New first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"New last name."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"additionalFields","freeform":true,"description":"Any other customer fields to update (e.g. billing, shipping) as a JSON object, merged as-is into the request body."}
   *
   * @returns {Object}
   * @sampleResult {"id":25,"email":"john@example.com","first_name":"Jonathan","last_name":"Doe","role":"customer"}
   */
  async updateCustomer(customerId, firstName, lastName, additionalFields) {
    const body = clean({ first_name: firstName, last_name: lastName, ...(additionalFields || {}) })

    return await this.#apiRequest({ url: `${ this.apiBase }/customers/${ customerId }`, method: 'put', body, logTag: 'updateCustomer' })
  }

  /**
   * @operationName Delete Customer
   * @category Customers
   * @description Permanently deletes a customer account. Customers cannot be trashed, so this removal is final; optionally reassign their posts to another user.
   * @route POST /delete-customer
   *
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The customer to delete."}
   * @paramDef {"type":"Number","label":"Reassign Content To","name":"reassign","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"If this customer ever authored store content (e.g. product reviews), the ID of the user to hand it to. Usually leave blank."}
   *
   * @returns {Object}
   * @sampleResult {"id":25,"email":"john@example.com","first_name":"John","last_name":"Doe"}
   */
  async deleteCustomer(customerId, reassign) {
    const query = clean({ force: true, reassign: reassign != null ? Number(reassign) : undefined })

    return await this.#apiRequest({ url: `${ this.apiBase }/customers/${ customerId }`, method: 'delete', query, logTag: 'deleteCustomer' })
  }

  // ==========================================================================
  //  COUPONS
  // ==========================================================================
  /**
   * @operationName Create Coupon
   * @category Coupons
   * @description Creates a discount coupon. Use to run promotions - a percentage off, a fixed cart discount, or a fixed product discount.
   * @route POST /create-coupon
   *
   * @paramDef {"type":"String","label":"Code","name":"code","required":true,"description":"The coupon code customers enter at checkout."}
   * @paramDef {"type":"String","label":"Discount Type","name":"discountType","uiComponent":{"type":"DROPDOWN","options":{"values":["Percentage off","Fixed amount off the cart","Fixed amount off each product"]}},"description":"How the discount applies. Default: Fixed amount off the cart."}
   * @paramDef {"type":"String","label":"Amount","name":"amount","required":true,"description":"Discount amount as a decimal string (a percentage when type is percent), e.g. \"10\"."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional internal description."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"additionalFields","freeform":true,"description":"Any other coupon fields (e.g. date_expires, usage_limit, free_shipping) as a JSON object, merged as-is into the request body."}
   *
   * @returns {Object}
   * @sampleResult {"id":720,"code":"save10","amount":"10.00","discount_type":"percent","description":"10% off","usage_count":0}
   */
  async createCoupon(code, discountType, amount, description, additionalFields) {
    const body = clean({ code, discount_type: this.#resolveChoice(discountType, COUPON_TYPE_MAP), amount, description, ...(additionalFields || {}) })

    return await this.#apiRequest({ url: `${ this.apiBase }/coupons`, method: 'post', body, logTag: 'createCoupon' })
  }

  /**
   * @operationName Get Coupon
   * @category Coupons
   * @description Retrieves a single coupon by ID, including its discount type, amount, and usage count.
   * @route POST /get-coupon
   *
   * @paramDef {"type":"String","label":"Coupon","name":"couponId","required":true,"dictionary":"getCouponsDictionary","description":"The coupon to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":720,"code":"save10","amount":"10.00","discount_type":"percent","description":"10% off","usage_count":3}
   */
  async getCoupon(couponId) {
    return await this.#apiRequest({ url: `${ this.apiBase }/coupons/${ couponId }`, logTag: 'getCoupon' })
  }

  /**
   * @operationName List Coupons
   * @category Coupons
   * @description Lists coupons, optionally filtered by search text against the code. Use to audit active promotions.
   * @route POST /list-coupons
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter by coupon code."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page (1-100). Default: 20."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":720,"code":"save10","amount":"10.00","discount_type":"percent","usage_count":3}]
   */
  async listCoupons(search, perPage, page) {
    const query = clean({ search, per_page: perPage || 20, page: page || 1 })

    return await this.#apiRequest({ url: `${ this.apiBase }/coupons`, query, logTag: 'listCoupons' })
  }

  /**
   * @operationName Update Coupon
   * @category Coupons
   * @description Updates a coupon's amount, description, or other fields. Use to adjust an ongoing promotion.
   * @route POST /update-coupon
   *
   * @paramDef {"type":"String","label":"Coupon","name":"couponId","required":true,"dictionary":"getCouponsDictionary","description":"The coupon to update."}
   * @paramDef {"type":"String","label":"Amount","name":"amount","description":"New discount amount as a decimal string."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New internal description."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"additionalFields","freeform":true,"description":"Any other coupon fields to update as a JSON object, merged as-is into the request body."}
   *
   * @returns {Object}
   * @sampleResult {"id":720,"code":"save10","amount":"15.00","discount_type":"percent","description":"15% off"}
   */
  async updateCoupon(couponId, amount, description, additionalFields) {
    const body = clean({ amount, description, ...(additionalFields || {}) })

    return await this.#apiRequest({ url: `${ this.apiBase }/coupons/${ couponId }`, method: 'put', body, logTag: 'updateCoupon' })
  }

  /**
   * @operationName Delete Coupon
   * @category Coupons
   * @description Deletes a coupon. By default it is moved to trash; enable Permanent to remove it entirely.
   * @route POST /delete-coupon
   *
   * @paramDef {"type":"String","label":"Coupon","name":"couponId","required":true,"dictionary":"getCouponsDictionary","description":"The coupon to delete."}
   * @paramDef {"type":"Boolean","label":"Permanent","name":"force","uiComponent":{"type":"TOGGLE"},"description":"Permanently delete instead of moving to trash."}
   *
   * @returns {Object}
   * @sampleResult {"id":720,"code":"save10","amount":"10.00","discount_type":"percent"}
   */
  async deleteCoupon(couponId, force) {
    return await this.#apiRequest({ url: `${ this.apiBase }/coupons/${ couponId }`, method: 'delete', query: { force: Boolean(force) }, logTag: 'deleteCoupon' })
  }

  // ==========================================================================
  //  BATCH - bulk create/update/delete in a single request, for fast catalog and data syncs
  // ==========================================================================
  /**
   * @operationName Batch Products
   * @category Batch
   * @description Creates, updates, and/or deletes multiple products in a single request. Use this to sync a catalog in bulk instead of calling Create/Update/Delete Product repeatedly. WooCommerce allows at most 100 items total across Create, Update, and Delete per request.
   * @route POST /batch-products
   *
   * @paramDef {"type":"Array<Object>","label":"Create","name":"create","description":"Product objects to create, each shaped like the Create Product action's fields (e.g. name, type, regular_price, sku, categories)."}
   * @paramDef {"type":"Array<Object>","label":"Update","name":"update","description":"Product objects to update. Each object must include an \"id\" field identifying the product, plus the fields to change."}
   * @paramDef {"type":"Array<String>","label":"Delete","name":"deleteIds","description":"IDs of products to permanently delete."}
   *
   * @returns {Object}
   * @sampleResult {"create":[{"id":800,"name":"New Product","status":"publish"}],"update":[{"id":799,"regular_price":"24.99"}],"delete":[{"id":701,"name":"Old Product"}]}
   */
  async batchProducts(create, update, deleteIds) {
    const body = clean({ create, update, delete: toIdList(deleteIds) })

    return await this.#apiRequest({ url: `${ this.apiBase }/products/batch`, method: 'post', body, logTag: 'batchProducts' })
  }

  /**
   * @operationName Batch Orders
   * @category Batch
   * @description Creates, updates, and/or deletes multiple orders in a single request. Use this to bulk-import orders or push status changes across many orders at once. WooCommerce allows at most 100 items total across Create, Update, and Delete per request.
   * @route POST /batch-orders
   *
   * @paramDef {"type":"Array<Object>","label":"Create","name":"create","description":"Order objects to create, each shaped like the Create Order action's fields (e.g. status, customer_id, line_items, billing)."}
   * @paramDef {"type":"Array<Object>","label":"Update","name":"update","description":"Order objects to update. Each object must include an \"id\" field identifying the order, plus the fields to change (e.g. status)."}
   * @paramDef {"type":"Array<String>","label":"Delete","name":"deleteIds","description":"IDs of orders to permanently delete."}
   *
   * @returns {Object}
   * @sampleResult {"create":[{"id":728,"status":"pending","total":"0.00"}],"update":[{"id":727,"status":"completed"}],"delete":[{"id":700,"status":"trash"}]}
   */
  async batchOrders(create, update, deleteIds) {
    const body = clean({ create, update, delete: toIdList(deleteIds) })

    return await this.#apiRequest({ url: `${ this.apiBase }/orders/batch`, method: 'post', body, logTag: 'batchOrders' })
  }

  /**
   * @operationName Batch Customers
   * @category Batch
   * @description Creates, updates, and/or deletes multiple customers in a single request. Use this to bulk-import a customer list or update many profiles at once. WooCommerce allows at most 100 items total across Create, Update, and Delete per request.
   * @route POST /batch-customers
   *
   * @paramDef {"type":"Array<Object>","label":"Create","name":"create","description":"Customer objects to create, each shaped like the Create Customer action's fields (e.g. email, first_name, last_name, billing)."}
   * @paramDef {"type":"Array<Object>","label":"Update","name":"update","description":"Customer objects to update. Each object must include an \"id\" field identifying the customer, plus the fields to change."}
   * @paramDef {"type":"Array<String>","label":"Delete","name":"deleteIds","description":"IDs of customers to permanently delete."}
   *
   * @returns {Object}
   * @sampleResult {"create":[{"id":26,"email":"jane@example.com","first_name":"Jane"}],"update":[{"id":25,"first_name":"Jonathan"}],"delete":[{"id":20,"email":"old@example.com"}]}
   */
  async batchCustomers(create, update, deleteIds) {
    const body = clean({ create, update, delete: toIdList(deleteIds) })

    return await this.#apiRequest({ url: `${ this.apiBase }/customers/batch`, method: 'post', body, logTag: 'batchCustomers' })
  }

  // ==========================================================================
  //  DICTIONARIES - back every resource-pick (*Id) param with one of these
  // ==========================================================================
  /**
   * @registerAs DICTIONARY
   * @operationName Products Dictionary
   * @description Provides a searchable list of products for dropdown selection in other actions.
   * @route POST /get-products-dictionary
   * @paramDef {"type":"getProductsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Premium Hoodie","value":"799","note":"SKU: PH-001 · ID: 799"}],"cursor":null}
   */
  async getProductsDictionary(payload) {
    const { search, cursor } = payload || {}
    const page = pageFromCursor(cursor)
    const list = await this.#apiRequest({ url: `${ this.apiBase }/products`, query: clean({ search, per_page: 20, page }), logTag: 'getProductsDictionary' })

    return toDictionary(list, page, p => ({ label: p.name, value: String(p.id), note: `SKU: ${ p.sku || '—' } · ID: ${ p.id }` }))
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Product Categories Dictionary
   * @description Provides a searchable list of product categories for dropdown selection.
   * @route POST /get-product-categories-dictionary
   * @paramDef {"type":"getProductCategoriesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Clothing","value":"9","note":"36 products · ID: 9"}],"cursor":null}
   */
  async getProductCategoriesDictionary(payload) {
    const { search, cursor } = payload || {}
    const page = pageFromCursor(cursor)
    const list = await this.#apiRequest({ url: `${ this.apiBase }/products/categories`, query: clean({ search, per_page: 20, page }), logTag: 'getProductCategoriesDictionary' })

    return toDictionary(list, page, c => ({ label: c.name, value: String(c.id), note: `${ c.count || 0 } products · ID: ${ c.id }` }))
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Product Attributes Dictionary
   * @description Provides a searchable list of global product attributes for dropdown selection in other actions.
   * @route POST /get-product-attributes-dictionary
   * @paramDef {"type":"getProductAttributesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Color","value":"3","note":"Type: select · ID: 3"}],"cursor":null}
   */
  async getProductAttributesDictionary(payload) {
    const { search, cursor } = payload || {}
    const page = pageFromCursor(cursor)
    const list = await this.#apiRequest({ url: `${ this.apiBase }/products/attributes`, query: clean({ search, per_page: 20, page }), logTag: 'getProductAttributesDictionary' })

    return toDictionary(list, page, a => ({ label: a.name, value: String(a.id), note: `Type: ${ a.type || 'select' } · ID: ${ a.id }` }))
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Attribute Terms Dictionary
   * @description Provides the terms of a chosen global product attribute for dependent dropdown selection.
   * @route POST /get-attribute-terms-dictionary
   * @paramDef {"type":"getAttributeTermsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the parent attribute criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Blue","value":"12","note":"8 products · ID: 12"}],"cursor":null}
   */
  async getAttributeTermsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const attributeId = criteria?.attributeId

    if (!attributeId) {
      return { items: [], cursor: null }
    }

    const page = pageFromCursor(cursor)
    const list = await this.#apiRequest({ url: `${ this.apiBase }/products/attributes/${ attributeId }/terms`, query: clean({ search, per_page: 20, page }), logTag: 'getAttributeTermsDictionary' })

    return toDictionary(list, page, t => ({ label: t.name, value: String(t.id), note: `${ t.count || 0 } products · ID: ${ t.id }` }))
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Product Variations Dictionary
   * @description Provides the variations of a chosen product for dependent dropdown selection.
   * @route POST /get-product-variations-dictionary
   * @paramDef {"type":"getProductVariationsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the parent product criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Blue / Large","value":"733","note":"SKU: PH-001-BLUE · ID: 733"}],"cursor":null}
   */
  async getProductVariationsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const productId = criteria?.productId

    if (!productId) {
      return { items: [], cursor: null }
    }

    const page = pageFromCursor(cursor)
    const list = await this.#apiRequest({ url: `${ this.apiBase }/products/${ productId }/variations`, query: clean({ search, per_page: 20, page }), logTag: 'getProductVariationsDictionary' })

    return toDictionary(list, page, v => ({
      label: variationLabel(v),
      value: String(v.id),
      note: `SKU: ${ v.sku || '—' } · ID: ${ v.id }`,
    }))
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Orders Dictionary
   * @description Provides a searchable list of orders for dropdown selection in other actions.
   * @route POST /get-orders-dictionary
   * @paramDef {"type":"getOrdersDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Order #727 — John Doe","value":"727","note":"processing · 43.98"}],"cursor":null}
   */
  async getOrdersDictionary(payload) {
    const { search, cursor } = payload || {}
    const page = pageFromCursor(cursor)
    const list = await this.#apiRequest({ url: `${ this.apiBase }/orders`, query: clean({ search, per_page: 20, page }), logTag: 'getOrdersDictionary' })

    return toDictionary(list, page, o => ({
      label: `Order #${ o.id } — ${ orderName(o) }`,
      value: String(o.id),
      note: `${ o.status } · ${ o.total }`,
    }))
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Order Notes Dictionary
   * @description Provides the notes on a chosen order for dependent dropdown selection.
   * @route POST /get-order-notes-dictionary
   * @paramDef {"type":"getOrderNotesDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the parent order criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Order shipped via UPS","value":"314","note":"customer note · ID: 314"}],"cursor":null}
   */
  async getOrderNotesDictionary(payload) {
    const { search, criteria } = payload || {}
    const orderId = criteria?.orderId

    if (!orderId) {
      return { items: [], cursor: null }
    }

    // The notes endpoint returns the full set (no server-side search/paging), so we filter
    // locally and return a null cursor rather than advertising a page that does not exist.
    const list = await this.#apiRequest({ url: `${ this.apiBase }/orders/${ orderId }/notes`, logTag: 'getOrderNotesDictionary' })
    const rows = filterByText(list, search, n => n.note)

    return {
      items: rows.map(n => ({
        label: truncate(n.note, 60),
        value: String(n.id),
        note: `${ n.customer_note ? 'customer note' : 'private note' } · ID: ${ n.id }`,
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Order Refunds Dictionary
   * @description Provides the refunds on a chosen order for dependent dropdown selection.
   * @route POST /get-order-refunds-dictionary
   * @paramDef {"type":"getOrderRefundsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the parent order criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Refund 10.00 — Item returned","value":"726","note":"ID: 726"}],"cursor":null}
   */
  async getOrderRefundsDictionary(payload) {
    const { search, criteria } = payload || {}
    const orderId = criteria?.orderId

    if (!orderId) {
      return { items: [], cursor: null }
    }

    // The refunds endpoint returns the full set (no server-side search/paging), so we filter
    // locally and return a null cursor rather than advertising a page that does not exist.
    const list = await this.#apiRequest({ url: `${ this.apiBase }/orders/${ orderId }/refunds`, logTag: 'getOrderRefundsDictionary' })
    const rows = filterByText(list, search, r => r.reason)

    return {
      items: rows.map(r => ({
        label: `Refund ${ r.amount } — ${ truncate(r.reason || 'No reason', 40) }`,
        value: String(r.id),
        note: `ID: ${ r.id }`,
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Customers Dictionary
   * @description Provides a searchable list of customers for dropdown selection in other actions.
   * @route POST /get-customers-dictionary
   * @paramDef {"type":"getCustomersDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"John Doe","value":"25","note":"john@example.com · ID: 25"}],"cursor":null}
   */
  async getCustomersDictionary(payload) {
    const { search, cursor } = payload || {}
    const page = pageFromCursor(cursor)
    const list = await this.#apiRequest({ url: `${ this.apiBase }/customers`, query: clean({ search, per_page: 20, page }), logTag: 'getCustomersDictionary' })

    return toDictionary(list, page, c => ({
      label: customerName(c),
      value: String(c.id),
      note: `${ c.email || '—' } · ID: ${ c.id }`,
    }))
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Coupons Dictionary
   * @description Provides a searchable list of coupons for dropdown selection in other actions.
   * @route POST /get-coupons-dictionary
   * @paramDef {"type":"getCouponsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"save10","value":"720","note":"percent 10.00 · ID: 720"}],"cursor":null}
   */
  async getCouponsDictionary(payload) {
    const { search, cursor } = payload || {}
    const page = pageFromCursor(cursor)
    const list = await this.#apiRequest({ url: `${ this.apiBase }/coupons`, query: clean({ search, per_page: 20, page }), logTag: 'getCouponsDictionary' })

    return toDictionary(list, page, c => ({
      label: c.code,
      value: String(c.id),
      note: `${ c.discount_type } ${ c.amount } · ID: ${ c.id }`,
    }))
  }

  // ==========================================================================
  //  PARAM SCHEMAS - sub-forms for the billing/shipping address Object params
  // ==========================================================================
  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /address-schema
   * @returns {Object}
   */
  async addressSchema() {
    return [
      { type: 'String', label: 'First Name', name: 'first_name', required: false, description: 'Contact first name.' },
      { type: 'String', label: 'Last Name', name: 'last_name', required: false, description: 'Contact last name.' },
      { type: 'String', label: 'Company', name: 'company', required: false, description: 'Company name.' },
      { type: 'String', label: 'Address Line 1', name: 'address_1', required: false, description: 'Street address, line 1.' },
      { type: 'String', label: 'Address Line 2', name: 'address_2', required: false, description: 'Apartment, suite, or unit, line 2.' },
      { type: 'String', label: 'City', name: 'city', required: false, description: 'City.' },
      { type: 'String', label: 'State / County', name: 'state', required: false, description: 'State, province, or county.' },
      { type: 'String', label: 'Postcode / ZIP', name: 'postcode', required: false, description: 'Postal or ZIP code.' },
      { type: 'String', label: 'Country Code', name: 'country', required: false, description: 'Two-letter ISO country code, e.g. US.' },
      { type: 'String', label: 'Email', name: 'email', required: false, description: 'Contact email address.' },
      { type: 'String', label: 'Phone', name: 'phone', required: false, description: 'Contact phone number.' },
    ]
  }

  // ==========================================================================
  //  TRIGGERS (realtime) - native /webhooks, SINGLE_APP, HMAC-SHA256 verified
  // ==========================================================================
  /**
   * @operationName On Order Created
   * @category Triggers
   * @description Fires when a new order is placed in the store. Use to kick off fulfillment, send confirmations, or sync the sale to another system in real time.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-order-created
   * @appearanceColor #7f54b3 #a777d6
   * @returns {Object}
   * @sampleResult {"id":727,"status":"processing","currency":"USD","total":"43.98","customer_id":25,"billing":{"first_name":"John","last_name":"Doe","email":"john@example.com"},"line_items":[{"id":315,"name":"Premium Hoodie","product_id":799,"quantity":2,"total":"43.98"}],"date_created":"2026-05-30T10:00:00"}
   */
  async onOrderCreated() {
    // Trigger marker - events are shaped by handleTriggerResolveEvents.
  }

  /**
   * @operationName On Order Updated
   * @category Triggers
   * @description Fires when an existing order changes (e.g. its status moves to processing or completed). Use to track fulfillment progress and notify customers.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-order-updated
   * @appearanceColor #7f54b3 #a777d6
   * @returns {Object}
   * @sampleResult {"id":727,"status":"completed","currency":"USD","total":"43.98","customer_id":25,"date_modified":"2026-05-30T11:00:00"}
   */
  async onOrderUpdated() {
    // Trigger marker - events are shaped by handleTriggerResolveEvents.
  }

  /**
   * @operationName On Product Created
   * @category Triggers
   * @description Fires when a new product is added to the catalog. Use to mirror inventory to another channel or announce new arrivals.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-product-created
   * @appearanceColor #7f54b3 #a777d6
   * @returns {Object}
   * @sampleResult {"id":799,"name":"Premium Hoodie","type":"simple","status":"publish","price":"21.99","sku":"PH-001","stock_status":"instock"}
   */
  async onProductCreated() {
    // Trigger marker - events are shaped by handleTriggerResolveEvents.
  }

  /**
   * @operationName On Product Updated
   * @category Triggers
   * @description Fires when a product changes (price, stock, status, etc.). Use to keep external catalogs or price feeds in sync.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-product-updated
   * @appearanceColor #7f54b3 #a777d6
   * @returns {Object}
   * @sampleResult {"id":799,"name":"Premium Hoodie","type":"simple","status":"publish","price":"19.99","sku":"PH-001","stock_status":"instock"}
   */
  async onProductUpdated() {
    // Trigger marker - events are shaped by handleTriggerResolveEvents.
  }

  /**
   * @operationName On Customer Created
   * @category Triggers
   * @description Fires when a new customer account is created. Use to add the buyer to a CRM or mailing list automatically.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-customer-created
   * @appearanceColor #7f54b3 #a777d6
   * @returns {Object}
   * @sampleResult {"id":25,"email":"john@example.com","first_name":"John","last_name":"Doe","username":"john.doe","role":"customer"}
   */
  async onCustomerCreated() {
    // Trigger marker - events are shaped by handleTriggerResolveEvents.
  }

  /**
   * @operationName On Customer Updated
   * @category Triggers
   * @description Fires when a customer's profile changes. Use to keep contact records in an external system up to date.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-customer-updated
   * @appearanceColor #7f54b3 #a777d6
   * @returns {Object}
   * @sampleResult {"id":25,"email":"john@example.com","first_name":"Jonathan","last_name":"Doe","role":"customer"}
   */
  async onCustomerUpdated() {
    // Trigger marker - events are shaped by handleTriggerResolveEvents.
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handle-trigger-upsert-webhook
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    const existing = (invocation.webhookData && invocation.webhookData.webhooks) || []
    const byTopic = new Map(existing.map(w => [w.topic, w]))

    const neededTopics = new Set(
      (invocation.events || [])
        .map(event => EVENT_TOPIC[event.name])
        .filter(Boolean)
    )

    // Tear down webhooks whose topic is no longer subscribed by any trigger.
    const deletions = [...byTopic.keys()]
      .filter(topic => !neededTopics.has(topic))
      .map(async topic => {
        const webhook = byTopic.get(topic)

        await this.#deleteWebhook(webhook.id)
        byTopic.delete(topic)
      })

    // Create one webhook per newly-needed topic, delivering to the platform callback URL.
    const creations = [...neededTopics]
      .filter(topic => !byTopic.has(topic))
      .map(async topic => {
        const secret = crypto.randomBytes(24).toString('hex')
        const created = await this.#createWebhook(topic, invocation.callbackUrl, secret)

        byTopic.set(topic, { id: created.id, topic, secret })
      })

    await Promise.all([...deletions, ...creations])

    return {
      webhookData: { webhooks: [...byTopic.values()] },
      eventScopeId: this.storeUrl,
    }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handle-trigger-resolve-events
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    const headers = lowerKeys(invocation.headers || invocation.httpHeaders || {})
    const topic = headers['x-wc-webhook-topic']
    const body = invocation.body

    // WooCommerce sends a verification ping ({ webhook_id }) when a webhook is first created.
    if (!topic || (body && body.webhook_id && Object.keys(body).length === 1)) {
      logger.debug('[handleTriggerResolveEvents] ignoring webhook ping/handshake')

      return { events: [] }
    }

    const eventName = TOPIC_EVENT[topic]

    if (!eventName) {
      logger.debug(`[handleTriggerResolveEvents] no trigger mapped for topic "${ topic }"`)

      return { events: [] }
    }

    this.#verifyWebhookSignature(invocation, headers, topic)

    return { events: [{ name: eventName, data: body }] }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handle-trigger-select-matched
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    // Topics are store-wide, so every trigger subscribed to this event matches the delivery.
    return { ids: (invocation.triggers || []).map(trigger => trigger.id) }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handle-trigger-delete-webhook
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerDeleteWebhook(invocation) {
    const existing = (invocation.webhookData && invocation.webhookData.webhooks) || []

    await Promise.all(existing.map(async webhook => {
      try {
        await this.#deleteWebhook(webhook.id)
      } catch (error) {
        logger.warn(`[handleTriggerDeleteWebhook] could not delete webhook ${ webhook.id }: ${ error.message }`)
      }
    }))

    return { webhookData: { webhooks: [] } }
  }

  // ==========================================================================
  //  PRIVATE - webhook plumbing
  // ==========================================================================
  async #createWebhook(topic, deliveryUrl, secret) {
    return await this.#apiRequest({
      url: `${ this.apiBase }/webhooks`,
      method: 'post',
      body: {
        name: `FlowRunner ${ topic }`,
        topic,
        delivery_url: deliveryUrl,
        secret,
        status: 'active',
      },
      logTag: `createWebhook:${ topic }`,
    })
  }

  async #deleteWebhook(webhookId) {
    return await this.#apiRequest({
      url: `${ this.apiBase }/webhooks/${ webhookId }`,
      method: 'delete',
      query: { force: true },
      logTag: `deleteWebhook:${ webhookId }`,
    })
  }

  // Verify the base64 HMAC-SHA256 signature WooCommerce sends in X-WC-Webhook-Signature.
  // The raw request body and the webhook secret are both required; when either is unavailable
  // (the platform delivered a parsed body, or the secret was not retained), verification is
  // skipped rather than failing a legitimate delivery.
  #verifyWebhookSignature(invocation, headers, topic) {
    const signature = headers['x-wc-webhook-signature']
    const rawBody = invocation.rawBody || invocation.bodyString || (typeof invocation.body === 'string' ? invocation.body : null)
    const webhook = ((invocation.webhookData && invocation.webhookData.webhooks) || []).find(w => w.topic === topic)
    const secret = webhook && webhook.secret

    if (!signature || !rawBody || !secret) {
      logger.debug('[verifyWebhookSignature] raw body or secret unavailable — skipping signature check')

      return
    }

    const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64')

    if (!safeEqual(expected, signature)) {
      throw new Error('Webhook signature verification failed — the payload did not match the expected HMAC-SHA256 signature.')
    }
  }
}

// ============================================================================
//  PURE HELPERS
// ============================================================================
/** Drop null/undefined keys so they are never sent in a request body or query. */
function clean(obj) {
  const out = {}

  for (const key of Object.keys(obj || {})) {
    if (obj[key] !== undefined && obj[key] !== null) {
      out[key] = obj[key]
    }
  }

  return out
}

/** Stock-management fields. WooCommerce ignores stock_quantity unless manage_stock is on, so set both together. */
function stockFields(stockQuantity) {
  if (stockQuantity == null) return {}

  return { manage_stock: true, stock_quantity: Number(stockQuantity) }
}

/** Map an array of category IDs (string or number) to WooCommerce's [{ id }] reference shape. */
function toIdRefs(ids) {
  if (!ids) return undefined

  const list = Array.isArray(ids) ? ids : String(ids).split(',').map(s => s.trim()).filter(Boolean)

  return list.map(id => ({ id: Number(id) }))
}

/** Convert an array of ID-like values (string or number) to numbers, for batch delete lists. */
function toIdList(ids) {
  if (!Array.isArray(ids) || !ids.length) return undefined

  return ids.map(id => Number(id)).filter(id => Number.isFinite(id))
}

/** Map FlowRunner OrderLineItem objects to WooCommerce's line_items shape. */
function toLineItems(lineItems) {
  if (!Array.isArray(lineItems) || !lineItems.length) return undefined

  return lineItems.map(item => clean({
    product_id: item.productId != null ? Number(item.productId) : undefined,
    quantity: item.quantity != null ? Number(item.quantity) : 1,
    variation_id: item.variationId != null ? Number(item.variationId) : undefined,
  }))
}

/** Cursor is a 1-based page number serialized as a string; default to page 1. */
function pageFromCursor(cursor) {
  const page = cursor ? Number(cursor) : 1

  return Number.isFinite(page) && page > 0 ? page : 1
}

/** Shape a WooCommerce list response into the dictionary { items, cursor } contract. */
function toDictionary(list, page, mapItem) {
  const rows = Array.isArray(list) ? list : []
  const PER_PAGE = 20

  return {
    items: rows.map(mapItem),
    cursor: rows.length === PER_PAGE ? String(page + 1) : null,
  }
}

/** Case-insensitive local filter over a list by a text accessor; returns the list unchanged when no search term is given. */
function filterByText(list, search, accessor) {
  const rows = Array.isArray(list) ? list : []

  if (!search) return rows

  const needle = String(search).toLowerCase()

  return rows.filter(row => String(accessor(row) || '').toLowerCase().includes(needle))
}

/** Build a human label for a variation from its attribute options, falling back to its ID. */
function variationLabel(variation) {
  const opts = Array.isArray(variation.attributes)
    ? variation.attributes.map(a => a.option).filter(Boolean).join(' / ')
    : ''

  return opts || `Variation #${ variation.id }`
}

/** Build a display name for an order from its billing details. */
function orderName(order) {
  const billing = order.billing || {}
  const name = `${ billing.first_name || '' } ${ billing.last_name || '' }`.trim()

  return name || billing.email || 'Guest'
}

/** Build a display name for a customer from name/email. */
function customerName(customer) {
  const name = `${ customer.first_name || '' } ${ customer.last_name || '' }`.trim()

  return name || customer.username || customer.email || `Customer #${ customer.id }`
}

/** Truncate a string for use in a dropdown label. */
function truncate(text, max) {
  const str = String(text || '')

  return str.length > max ? `${ str.slice(0, max - 1) }…` : str
}

/** Lowercase every header key so lookups are case-insensitive. */
function lowerKeys(headers) {
  const out = {}

  for (const key of Object.keys(headers || {})) {
    out[String(key).toLowerCase()] = headers[key]
  }

  return out
}

/** Constant-time-ish comparison of two base64 signature strings. */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a))
  const bufB = Buffer.from(String(b))

  if (bufA.length !== bufB.length) return false

  return crypto.timingSafeEqual(bufA, bufB)
}

Flowrunner.ServerCode.addService(WooCommerce, [
  {
    name: 'storeUrl',
    displayName: 'Store URL',
    shared: false,
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Your store\'s base URL over HTTPS, e.g. https://shop.example.com (the REST API lives at /wp-json/wc/v3).',
  },
  {
    name: 'consumerKey',
    displayName: 'Consumer Key',
    shared: false,
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'REST API Consumer Key (ck_...). Generate at WooCommerce > Settings > Advanced > REST API with Read/Write permissions.',
  },
  {
    name: 'consumerSecret',
    displayName: 'Consumer Secret',
    shared: false,
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'REST API Consumer Secret (cs_...), shown once when you create the API key.',
  },
  {
    name: 'authMethod',
    displayName: 'Authorization Method',
    shared: false,
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    options: ['header', 'query'],
    required: false,
    defaultValue: 'header',
    hint: 'How to send credentials. Use "header" (HTTP Basic) normally; switch to "query" if your host strips the Authorization header (a "Consumer key is missing" error).',
  },
])
