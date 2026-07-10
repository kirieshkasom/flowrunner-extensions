// Cin7 Core (DEAR Inventory) - products, sales, purchases, stock, and reference data.
// Authenticates with an Account ID + Application Key; realtime webhooks require the paid
// Automation module, and the API is rate-limited to 60 calls/minute.

const crypto = require('crypto')

// ============================================================================
//  CONSTANTS
// ============================================================================
const API_BASE_URL = 'https://inventory.dearsystems.com/ExternalApi/v2'
const PAGE_LIMIT = 1000 // max Limit; loop pages until a short page (DESIGN: pagination)
const EMPTY_GUID = '00000000-0000-0000-0000-000000000000'

const ERROR_HINTS = {
  400: 'The request was rejected — check the required fields and dropdown selections.',
  403: 'Authentication failed — verify the Account ID and Application Key in the connection settings.',
  404: 'Not found — the ID may be wrong; use the matching "Get" or list action to pick a valid one.',
  429: 'Rate limit hit (60 calls/minute) — retry in a moment.',
}

// Friendly dropdown label -> Cin7 API value. Options show the label; #resolveChoice maps back.
const PRODUCT_TYPE_MAP = { 'Stock product': 'Stock', 'Service product': 'Service' }
const COSTING_METHOD_MAP = {
  FIFO: 'FIFO',
  'FIFO (batch tracked)': 'FIFO - Batch',
  'FIFO (serial tracked)': 'FIFO - Serial Number',
  'FEFO (batch tracked)': 'FEFO - Batch',
  'FEFO (serial tracked)': 'FEFO - Serial Number',
  'Special (batch)': 'Special - Batch',
  'Special (serial)': 'Special - Serial Number',
}
const SALE_STATUS_MAP = { Estimating: 'ESTIMATING', Estimated: 'ESTIMATED', Ordering: 'ORDERING', Ordered: 'ORDERED', Backordered: 'BACKORDERED', Invoicing: 'INVOICING', Invoiced: 'INVOICED', Completed: 'COMPLETED', Voided: 'VOIDED' }
const PURCHASE_STATUS_MAP = { Ordering: 'ORDERING', Ordered: 'ORDERED', Receiving: 'RECEIVING', Received: 'RECEIVED', Invoiced: 'INVOICED', Completed: 'COMPLETED', Voided: 'VOIDED' }
const DRAFT_AUTHORISED_MAP = { Draft: 'DRAFT', Authorised: 'AUTHORISED' }
const AUTO_PPS_MAP = { 'No auto pick': 'NOPICK', 'Auto pick': 'AUTOPICK', 'Auto pick & pack': 'AUTOPICKPACK', 'Auto pick, pack & ship': 'AUTOPICKPACKSHIP' }
const PAYMENT_TYPE_MAP = { Payment: 'PAYMENT', Prepayment: 'PREPAYMENT', Refund: 'REFUND' }
const PURCHASE_APPROACH_MAP = { 'Invoice first': 'INVOICE', 'Stock first': 'STOCK' }
const PURCHASE_TYPE_MAP = { 'Simple purchase': 'Simple', 'Advanced purchase': 'Advanced', 'Service purchase': 'Service' }
const TAX_CALCULATION_MAP = { 'Tax exclusive': 'Exclusive', 'Tax inclusive': 'Inclusive' }
const ADJUSTMENT_STATUS_FILTER_MAP = { Draft: 'DRAFT', Completed: 'COMPLETED', Voided: 'VOIDED' }
const DRAFT_COMPLETED_MAP = { Draft: 'DRAFT', Completed: 'COMPLETED' }
const TRANSFER_STATUS_MAP = { Draft: 'DRAFT', 'In transit': 'IN TRANSIT', Completed: 'COMPLETED' }
const COST_DISTRIBUTION_MAP = { 'By cost': 'Cost', 'By quantity': 'Quantity', 'By weight': 'Weight', 'By volume': 'Volume' }
const STOCKTAKE_START_MAP = { Draft: 'DRAFT', 'In progress': 'IN PROGRESS' }
const STOCKTAKE_COMPLETE_MAP = { 'In progress': 'IN PROGRESS', Completed: 'COMPLETED' }
const DUE_DATE_METHOD_MAP = { 'Number of days': 'number of days', 'Days since end of month': 'days since the end of the month', 'Last day of next month': 'last day of next month' }

// ============================================================================
//  LOGGER
// ============================================================================
// Per-request tracing is gated behind CIN7_DEBUG so routine list/page/dictionary calls
// don't flood the log; info/warn/error are always emitted.
const DEBUG_ENABLED = process.env.CIN7_DEBUG === 'true'
const logger = {
  info: (...args) => console.log('[Cin7 Core] info:', ...args),
  debug: (...args) => DEBUG_ENABLED && console.log('[Cin7 Core] debug:', ...args),
  error: (...args) => console.log('[Cin7 Core] error:', ...args),
  warn: (...args) => console.log('[Cin7 Core] warn:', ...args),
}

// ============================================================================
//  DICTIONARY PAYLOAD TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} dictionaryPayload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter results by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @integrationName Cin7 Core
 * @integrationIcon /icon.png
 * @integrationTriggersScope SINGLE_APP
 */
class Cin7Core {
  constructor(config) {
    this.config = config || {}
    this.accountId = this.config.accountId
    this.applicationKey = this.config.applicationKey
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

      if (body) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      // One backoff retry on 429 (60 calls/minute hard limit).
      const status = error?.status || error?.code || error?.body?.status

      if (status === 429) {
        logger.warn(`${ logTag } hit the rate limit — retrying once after a short pause.`)
        await this.#sleep(2000)

        try {
          const retry = Flowrunner.Request[method](url).set(this.#headers()).query(query || {})

          if (body) {
            return await retry.send(body)
          }

          return await retry
        } catch (retryError) {
          this.#handleError(retryError, logTag)
        }
      }

      this.#handleError(error, logTag)
    }
  }

  #headers() {
    return {
      'api-auth-accountid': this.accountId,
      'api-auth-applicationkey': this.applicationKey,
      'Content-Type': 'application/json',
    }
  }

  #sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // Map a friendly dropdown label back to the Cin7 API value. Pass-through when the value
  // is not a known label (already an API value, free text, or undefined/null).
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Fail fast (before any API call) when a required write field is missing, with a
  // plain-English message naming the field. `fields` is { "Field label": value, ... }.
  #require(fields) {
    const missing = Object.keys(fields).filter(label => {
      const value = fields[label]

      return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
    })

    if (missing.length) {
      const list = missing.join(', ')

      throw new Error(`Please fill in the required field${ missing.length > 1 ? 's' : '' }: ${ list }.`)
    }
  }

  // Fail fast when a required line-item array is empty/missing, naming the field.
  #requireLines(lines, label) {
    if (!Array.isArray(lines) || lines.length === 0) {
      throw new Error(`Please add at least one line to "${ label }".`)
    }
  }

  // Cin7's stock-level webhook (Stock/AvailableStockLevelChanged) delivers a bare JSON
  // array of changed-stock rows; every other event type delivers a single object carrying
  // an `EventType`. Make that rule explicit rather than inferring "array => stock" inline.
  #resolveEventType(body, invocation) {
    if (Array.isArray(body)) {
      return 'Stock/AvailableStockLevelChanged'
    }

    return (body && body.EventType) || invocation?.eventScopeId
  }

  #handleError(error, logTag) {
    const status = error?.status || error?.code || error?.body?.status
    const apiMessage = error?.body?.Errors?.[0]?.Message ||
      error?.body?.Message ||
      error?.body?.error?.message ||
      error?.body?.message ||
      error?.message ||
      'Request failed'
    const hint = ERROR_HINTS[status]

    logger.error(`${ logTag } failed: ${ apiMessage }`)

    throw new Error(hint ? `${ hint } (${ apiMessage })` : apiMessage)
  }

  // Loop Page=1,2,... with Limit=1000 until a short page; aggregate the named collection.
  async #listAll({ url, query, collection, limit, logTag }) {
    const pageLimit = limit || PAGE_LIMIT
    const all = []
    let page = 1
    let total = 0

    for (;;) {
      const result = await this.#apiRequest({
        url,
        query: { ...(query || {}), Page: page, Limit: pageLimit },
        logTag,
      })

      const rows = (result && result[collection]) || []

      all.push(...rows)
      total = (result && result.Total) || all.length

      if (rows.length < pageLimit || all.length >= total) {
        break
      }

      page += 1
    }

    return { [collection]: all, Total: total, Page: 1 }
  }

  #isoDate(value) {
    if (!value) {
      return undefined
    }

    const date = new Date(value)

    return isNaN(date.getTime()) ? value : date.toISOString().replace('Z', '').split('.')[0]
  }

  // ==========================================================================
  //  PRODUCTS
  // ==========================================================================
  /**
   * @operationName List Products
   * @category Products
   * @description Lists products in the catalog, optionally filtered by a name/SKU prefix. Auto-pages through every match. Use this to browse stock and service items or to find a product before acting on it.
   * @route POST /list-products
   * @paramDef {"type":"String","label":"Name or SKU starts with","name":"search","description":"Filter products whose name (or SKU) starts with this text. Leave blank for all."}
   * @paramDef {"type":"Boolean","label":"Include deprecated","name":"includeDeprecated","uiComponent":{"type":"TOGGLE"},"description":"Include retired (deprecated) products in the results."}
   * @paramDef {"type":"Number","label":"Max per page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page, 1-1000. The action auto-pages through all results. Default 100."}
   * @returns {Object}
   * @sampleResult {"Products":[{"ID":"4aadd8f6-4d3d-46ca-acbb-1a9a662f9bc1","SKU":"Bread","Name":"Baked Bread","Category":"Other","Type":"Stock","UOM":"Item","Status":"Active","PriceTier1":8}],"Total":41}
   */
  async listProducts(search, includeDeprecated, limit) {
    return await this.#listAll({
      url: `${ API_BASE_URL }/product`,
      query: { Name: search || undefined, IncludeDeprecated: includeDeprecated ? 'true' : undefined },
      collection: 'Products',
      limit,
      logTag: 'listProducts',
    })
  }

  /**
   * @operationName Get Product
   * @category Products
   * @description Retrieves the full detail of a single product, including pricing tiers, costing, and supplier links. Pick the product from the dropdown.
   * @route POST /get-product
   * @paramDef {"type":"String","label":"Product","name":"productId","dictionary":"getProductsDictionary","required":true,"description":"The product to fetch."}
   * @returns {Object}
   * @sampleResult {"ID":"4aadd8f6-4d3d-46ca-acbb-1a9a662f9bc1","SKU":"Bread","Name":"Baked Bread","Category":"Other","Type":"Stock","UOM":"Item","Status":"Active","AverageCost":5}
   */
  async getProduct(productId) {
    const result = await this.#apiRequest({
      url: `${ API_BASE_URL }/product`,
      query: { ID: productId },
      logTag: 'getProduct',
    })

    return (result && result.Products && result.Products[0]) || result
  }

  /**
   * @operationName Create Product
   * @category Products
   * @description Creates a new product (stock or service) in the catalog. Set the SKU, name, category, type, costing method, unit and status - these are required by Cin7. Use this to add a sellable or purchasable item.
   * @route POST /create-product
   * @paramDef {"type":"String","label":"SKU","name":"sku","required":true,"description":"Unique product code."}
   * @paramDef {"type":"String","label":"Product name","name":"name","required":true,"description":"Display name of the product."}
   * @paramDef {"type":"String","label":"Category","name":"category","dictionary":"getCategoriesDictionary","required":true,"description":"Product category. Pick an existing one."}
   * @paramDef {"type":"String","label":"Product type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Stock product","Service product"]}},"description":"Stock = tracked inventory; Service = non-stock service line."}
   * @paramDef {"type":"String","label":"Costing method","name":"costingMethod","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["FIFO","FIFO (batch tracked)","FIFO (serial tracked)","FEFO (batch tracked)","FEFO (serial tracked)","Special (batch)","Special (serial)"]}},"description":"How cost of goods is calculated. FIFO is the common default."}
   * @paramDef {"type":"String","label":"Unit of measure","name":"uom","dictionary":"getUnitsDictionary","required":true,"description":"Selling/stock unit. Must already exist in Units of Measure."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Setup required","Deprecated"]}},"description":"Active products are sellable; Deprecated retires the product."}
   * @paramDef {"type":"String","label":"Brand","name":"brand","dictionary":"getBrandsDictionary","description":"Optional brand."}
   * @paramDef {"type":"String","label":"Default location","name":"defaultLocation","dictionary":"getLocationsByNameDictionary","description":"Default warehouse for this product."}
   * @paramDef {"type":"String","label":"Barcode","name":"barcode","description":"Optional barcode."}
   * @paramDef {"type":"Number","label":"Sell price (Tier 1)","name":"priceTier1","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Default sell price for Price Tier 1."}
   * @paramDef {"type":"String","label":"Purchase tax rule","name":"purchaseTaxRule","dictionary":"getPurchaseTaxRulesDictionary","description":"Tax rule applied when buying this product."}
   * @paramDef {"type":"String","label":"Sale tax rule","name":"saleTaxRule","dictionary":"getSaleTaxRulesDictionary","description":"Tax rule applied when selling this product."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Long product description."}
   * @paramDef {"type":"Boolean","label":"Sellable","name":"sellable","uiComponent":{"type":"TOGGLE"},"description":"Whether this product can be sold. Defaults to true."}
   * @returns {Object}
   * @sampleResult {"ID":"4aadd8f6-4d3d-46ca-acbb-1a9a662f9bc1","SKU":"Bread Test","Name":"Baked Bread Test","Category":"Other","Type":"Stock","UOM":"Item","Status":"Active"}
   */
  async createProduct(sku, name, category, type, costingMethod, uom, status, brand, defaultLocation, barcode, priceTier1, purchaseTaxRule, saleTaxRule, description, sellable) {
    this.#require({ SKU: sku, 'Product name': name, Category: category, 'Product type': type, 'Costing method': costingMethod, 'Unit of measure': uom, Status: status })
    // docs: https://dearinventory.docs.apiary.io/#reference/product/product/post
    type = this.#resolveChoice(type, PRODUCT_TYPE_MAP)
    costingMethod = this.#resolveChoice(costingMethod, COSTING_METHOD_MAP)
    const body = {
      SKU: sku,
      Name: name,
      Category: category,
      Type: type,
      CostingMethod: costingMethod,
      UOM: uom,
      Status: status,
      Brand: brand,
      DefaultLocation: defaultLocation,
      Barcode: barcode,
      PriceTier1: priceTier1,
      PurchaseTaxRule: purchaseTaxRule,
      SaleTaxRule: saleTaxRule,
      Description: description,
      Sellable: sellable === undefined ? true : sellable,
    }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/product`, method: 'post', body, logTag: 'createProduct' })
  }

  /**
   * @operationName Update Product
   * @category Products
   * @description Updates an existing product. There is no delete in Cin7 - set Status to "Deprecated" to retire a product. Note the product Type cannot be changed once created.
   * @route POST /update-product
   * @paramDef {"type":"String","label":"Product","name":"id","dictionary":"getProductsDictionary","required":true,"description":"The product to update (or set Status=Deprecated to retire it — there is no delete)."}
   * @paramDef {"type":"String","label":"SKU","name":"sku","required":true,"description":"Unique product code."}
   * @paramDef {"type":"String","label":"Product name","name":"name","required":true,"description":"Display name of the product."}
   * @paramDef {"type":"String","label":"Category","name":"category","dictionary":"getCategoriesDictionary","required":true,"description":"Product category."}
   * @paramDef {"type":"String","label":"Costing method","name":"costingMethod","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["FIFO","FIFO (batch tracked)","FIFO (serial tracked)","FEFO (batch tracked)","FEFO (serial tracked)","Special (batch)","Special (serial)"]}},"description":"How cost of goods is calculated."}
   * @paramDef {"type":"String","label":"Unit of measure","name":"uom","dictionary":"getUnitsDictionary","required":true,"description":"Selling/stock unit."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Setup required","Deprecated"]}},"description":"Active products are sellable; Deprecated retires the product."}
   * @paramDef {"type":"String","label":"Brand","name":"brand","dictionary":"getBrandsDictionary","description":"Optional brand."}
   * @paramDef {"type":"String","label":"Default location","name":"defaultLocation","dictionary":"getLocationsByNameDictionary","description":"Default warehouse for this product."}
   * @paramDef {"type":"String","label":"Barcode","name":"barcode","description":"Optional barcode."}
   * @paramDef {"type":"Number","label":"Sell price (Tier 1)","name":"priceTier1","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Default sell price for Price Tier 1."}
   * @paramDef {"type":"String","label":"Purchase tax rule","name":"purchaseTaxRule","dictionary":"getPurchaseTaxRulesDictionary","description":"Tax rule applied when buying this product."}
   * @paramDef {"type":"String","label":"Sale tax rule","name":"saleTaxRule","dictionary":"getSaleTaxRulesDictionary","description":"Tax rule applied when selling this product."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Long product description."}
   * @paramDef {"type":"Boolean","label":"Sellable","name":"sellable","uiComponent":{"type":"TOGGLE"},"description":"Whether this product can be sold."}
   * @returns {Object}
   * @sampleResult {"ID":"4aadd8f6-4d3d-46ca-acbb-1a9a662f9bc1","SKU":"Bread","Name":"Baked Bread v2","Status":"Active"}
   */
  async updateProduct(id, sku, name, category, costingMethod, uom, status, brand, defaultLocation, barcode, priceTier1, purchaseTaxRule, saleTaxRule, description, sellable) {
    this.#require({ Product: id, SKU: sku, 'Product name': name, Category: category, 'Costing method': costingMethod, 'Unit of measure': uom, Status: status })
    // docs: https://dearinventory.docs.apiary.io/#reference/product/product/put  (PUT body mirrors POST; ID required, Type read-only)
    costingMethod = this.#resolveChoice(costingMethod, COSTING_METHOD_MAP)
    const body = {
      ID: id,
      SKU: sku,
      Name: name,
      Category: category,
      CostingMethod: costingMethod,
      UOM: uom,
      Status: status,
      Brand: brand,
      DefaultLocation: defaultLocation,
      Barcode: barcode,
      PriceTier1: priceTier1,
      PurchaseTaxRule: purchaseTaxRule,
      SaleTaxRule: saleTaxRule,
      Description: description,
      Sellable: sellable,
    }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/product`, method: 'put', body, logTag: 'updateProduct' })
  }

  // ==========================================================================
  //  PRODUCT AVAILABILITY
  // ==========================================================================
  /**
   * @operationName List Product Availability
   * @category Products
   * @description Lists stock-on-hand availability per product and location: on hand, allocated, available, on order and in transit. Auto-pages. Use this to check what stock you can sell or where it sits.
   * @route POST /list-product-availability
   * @paramDef {"type":"String","label":"SKU","name":"sku","description":"Filter by exact SKU. Blank for all."}
   * @paramDef {"type":"String","label":"Location","name":"location","dictionary":"getLocationsByNameDictionary","description":"Restrict to one warehouse location."}
   * @paramDef {"type":"String","label":"Category","name":"category","dictionary":"getCategoriesDictionary","description":"Restrict to one product category."}
   * @paramDef {"type":"Number","label":"Max per page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page 1-1000; auto-pages. Default 100."}
   * @returns {Object}
   * @sampleResult {"Total":4,"Page":1,"ProductAvailabilityList":[{"ID":"53350e22-0a89-4bdd-b11c-90bb3315dbe1","SKU":"test product 1","Name":"Test product 1","Location":"Main Warehouse","OnHand":0,"Allocated":1,"Available":1,"OnOrder":0,"StockOnHand":0,"InTransit":0}]}
   */
  async listProductAvailability(sku, location, category, limit) {
    return await this.#listAll({
      url: `${ API_BASE_URL }/ref/productavailability`,
      query: { Sku: sku || undefined, Location: location || undefined, Category: category || undefined },
      collection: 'ProductAvailabilityList',
      limit,
      logTag: 'listProductAvailability',
    })
  }

  // ==========================================================================
  //  REF BOOKS - Category / Brand / Unit (shared CRUD shape: { Name })
  // ==========================================================================
  /**
   * @operationName List Categories
   * @category Reference Data
   * @description Lists product categories. Auto-pages. Use to browse categories or find one to assign to a product.
   * @route POST /list-categories
   * @paramDef {"type":"String","label":"Name starts with","name":"search","description":"Filter by name prefix. Blank for all."}
   * @paramDef {"type":"Number","label":"Max per page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page 1-1000; auto-pages. Default 100."}
   * @returns {Object}
   * @sampleResult {"Total":5,"Page":1,"CategoryList":[{"ID":"1f1c7865-0058-450c-8c6a-44180b8a9705","Name":"Apparel"}]}
   */
  async listCategories(search, limit) {
    return await this.#listAll({ url: `${ API_BASE_URL }/ref/category`, query: { Name: search || undefined }, collection: 'CategoryList', limit, logTag: 'listCategories' })
  }

  /**
   * @operationName Create Category
   * @category Reference Data
   * @description Creates a new product category.
   * @route POST /create-category
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Category name."}
   * @returns {Object}
   * @sampleResult {"ID":"c783373b-67b1-496f-96d9-4b3ed76cb391","Name":"Test"}
   */
  async createCategory(name) {
    this.#require({ Name: name })

    // docs: https://dearinventory.docs.apiary.io/#reference/product-categories/product-category  (POST body { "Name": "Test" })
    return await this.#apiRequest({ url: `${ API_BASE_URL }/ref/category`, method: 'post', body: { Name: name }, logTag: 'createCategory' })
  }

  /**
   * @operationName Update Category
   * @category Reference Data
   * @description Renames an existing product category.
   * @route POST /update-category
   * @paramDef {"type":"String","label":"Category","name":"id","dictionary":"getCategoriesByIdDictionary","required":true,"description":"The category to rename."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"New category name."}
   * @returns {Object}
   * @sampleResult {"ID":"c783373b-67b1-496f-96d9-4b3ed76cb391","Name":"Apparel v2"}
   */
  async updateCategory(id, name) {
    this.#require({ Category: id, Name: name })

    // docs: https://dearinventory.docs.apiary.io/#reference/product-categories/product-category  (PUT requires ID + Name)
    return await this.#apiRequest({ url: `${ API_BASE_URL }/ref/category`, method: 'put', body: { ID: id, Name: name }, logTag: 'updateCategory' })
  }

  /**
   * @operationName Delete Category
   * @category Reference Data
   * @description Permanently deletes a product category. This cannot be undone.
   * @route POST /delete-category
   * @paramDef {"type":"String","label":"Category","name":"id","dictionary":"getCategoriesByIdDictionary","required":true,"description":"The category to delete."}
   * @returns {Object}
   * @sampleResult {"Success":true}
   */
  async deleteCategory(id) {
    this.#require({ Category: id })
    await this.#apiRequest({ url: `${ API_BASE_URL }/ref/category`, method: 'delete', query: { ID: id }, logTag: 'deleteCategory' })

    return { Success: true }
  }

  /**
   * @operationName List Brands
   * @category Reference Data
   * @description Lists product brands. Auto-pages.
   * @route POST /list-brands
   * @paramDef {"type":"String","label":"Name starts with","name":"search","description":"Filter by name prefix. Blank for all."}
   * @paramDef {"type":"Number","label":"Max per page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page 1-1000; auto-pages. Default 100."}
   * @returns {Object}
   * @sampleResult {"Total":1,"Page":1,"BrandList":[{"ID":"fa528b78-d8a3-4f87-b1ac-9cea985e337d","Name":"New Brand"}]}
   */
  async listBrands(search, limit) {
    return await this.#listAll({ url: `${ API_BASE_URL }/ref/brand`, query: { Name: search || undefined }, collection: 'BrandList', limit, logTag: 'listBrands' })
  }

  /**
   * @operationName Create Brand
   * @category Reference Data
   * @description Creates a new product brand.
   * @route POST /create-brand
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Brand name."}
   * @returns {Object}
   * @sampleResult {"ID":"ca585936-d523-4c40-980b-fbd0199d61fc","Name":"Test new brand"}
   */
  async createBrand(name) {
    this.#require({ Name: name })

    // docs: https://dearinventory.docs.apiary.io/#reference/brand/brand/post  (POST body { "Name": "Test new brand" })
    return await this.#apiRequest({ url: `${ API_BASE_URL }/ref/brand`, method: 'post', body: { Name: name }, logTag: 'createBrand' })
  }

  /**
   * @operationName Update Brand
   * @category Reference Data
   * @description Renames an existing brand.
   * @route POST /update-brand
   * @paramDef {"type":"String","label":"Brand","name":"id","dictionary":"getBrandsByIdDictionary","required":true,"description":"The brand to rename."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"New brand name."}
   * @returns {Object}
   * @sampleResult {"ID":"ca585936-d523-4c40-980b-fbd0199d61fc","Name":"New Brand v2"}
   */
  async updateBrand(id, name) {
    this.#require({ Brand: id, Name: name })

    // docs: https://dearinventory.docs.apiary.io/#reference/brand/brand  (PUT requires ID + Name)
    return await this.#apiRequest({ url: `${ API_BASE_URL }/ref/brand`, method: 'put', body: { ID: id, Name: name }, logTag: 'updateBrand' })
  }

  /**
   * @operationName Delete Brand
   * @category Reference Data
   * @description Permanently deletes a brand. This cannot be undone.
   * @route POST /delete-brand
   * @paramDef {"type":"String","label":"Brand","name":"id","dictionary":"getBrandsByIdDictionary","required":true,"description":"The brand to delete."}
   * @returns {Object}
   * @sampleResult {"Success":true}
   */
  async deleteBrand(id) {
    this.#require({ Brand: id })
    await this.#apiRequest({ url: `${ API_BASE_URL }/ref/brand`, method: 'delete', query: { ID: id }, logTag: 'deleteBrand' })

    return { Success: true }
  }

  /**
   * @operationName List Units
   * @category Reference Data
   * @description Lists units of measure. Auto-pages.
   * @route POST /list-units
   * @paramDef {"type":"String","label":"Name starts with","name":"search","description":"Filter by name prefix. Blank for all."}
   * @paramDef {"type":"Number","label":"Max per page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page 1-1000; auto-pages. Default 100."}
   * @returns {Object}
   * @sampleResult {"Total":1,"Page":1,"UnitList":[{"ID":"999b3f55-78f5-4a1f-ba8b-2be682a0af61","Name":"Item"}]}
   */
  async listUnits(search, limit) {
    return await this.#listAll({ url: `${ API_BASE_URL }/ref/unit`, query: { Name: search || undefined }, collection: 'UnitList', limit, logTag: 'listUnits' })
  }

  /**
   * @operationName Create Unit
   * @category Reference Data
   * @description Creates a new unit of measure.
   * @route POST /create-unit
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Unit name (e.g. Item, Box, Kg)."}
   * @returns {Object}
   * @sampleResult {"ID":"999b3f55-78f5-4a1f-ba8b-2be682a0af61","Name":"Item"}
   */
  async createUnit(name) {
    this.#require({ Name: name })

    // docs: https://dearinventory.docs.apiary.io/#reference/unit-of-measure/unit-of-measure  (POST body { "Name": "Item" })
    return await this.#apiRequest({ url: `${ API_BASE_URL }/ref/unit`, method: 'post', body: { Name: name }, logTag: 'createUnit' })
  }

  /**
   * @operationName Update Unit
   * @category Reference Data
   * @description Renames an existing unit of measure.
   * @route POST /update-unit
   * @paramDef {"type":"String","label":"Unit","name":"id","dictionary":"getUnitsByIdDictionary","required":true,"description":"The unit to rename."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"New unit name."}
   * @returns {Object}
   * @sampleResult {"ID":"999b3f55-78f5-4a1f-ba8b-2be682a0af61","Name":"Box"}
   */
  async updateUnit(id, name) {
    this.#require({ Unit: id, Name: name })

    // docs: https://dearinventory.docs.apiary.io/#reference/unit-of-measure/unit-of-measure  (PUT requires ID + Name)
    return await this.#apiRequest({ url: `${ API_BASE_URL }/ref/unit`, method: 'put', body: { ID: id, Name: name }, logTag: 'updateUnit' })
  }

  /**
   * @operationName Delete Unit
   * @category Reference Data
   * @description Permanently deletes a unit of measure. This cannot be undone.
   * @route POST /delete-unit
   * @paramDef {"type":"String","label":"Unit","name":"id","dictionary":"getUnitsByIdDictionary","required":true,"description":"The unit to delete."}
   * @returns {Object}
   * @sampleResult {"Success":true}
   */
  async deleteUnit(id) {
    this.#require({ Unit: id })
    await this.#apiRequest({ url: `${ API_BASE_URL }/ref/unit`, method: 'delete', query: { ID: id }, logTag: 'deleteUnit' })

    return { Success: true }
  }

  // ==========================================================================
  //  ATTRIBUTE SETS
  // ==========================================================================
  // Maps an attributes[] array -> Attribute{N}Name/Type/Values (max 10) per docs evidence.
  #attributeBody(attributes) {
    const body = {}
    const list = Array.isArray(attributes) ? attributes.slice(0, 10) : []

    list.forEach((attr, index) => {
      const n = index + 1

      body[`Attribute${ n }Name`] = attr.attributeName
      body[`Attribute${ n }Type`] = attr.attributeType

      if (attr.attributeValues !== undefined) {
        body[`Attribute${ n }Values`] = attr.attributeValues
      }
    })

    return body
  }

  /**
   * @operationName List Attribute Sets
   * @category Reference Data
   * @description Lists attribute sets (the attribute templates used by product families). Auto-pages.
   * @route POST /list-attribute-sets
   * @paramDef {"type":"String","label":"Name starts with","name":"search","description":"Filter by name prefix. Blank for all."}
   * @paramDef {"type":"Number","label":"Max per page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page 1-1000; auto-pages. Default 100."}
   * @returns {Object}
   * @sampleResult {"Total":1,"Page":1,"AttributeSetList":[{"ID":"0ba27d98-42ca-4bf6-9b9e-9f71538bd53d","Name":"Test set"}]}
   */
  async listAttributeSets(search, limit) {
    return await this.#listAll({ url: `${ API_BASE_URL }/ref/attributeset`, query: { Name: search || undefined }, collection: 'AttributeSetList', limit, logTag: 'listAttributeSets' })
  }

  /**
   * @operationName Create Attribute Set
   * @category Reference Data
   * @description Creates an attribute set with up to 10 attributes. Each attribute has a name, a type (List/Checkbox/Text) and, for List, comma-separated values. Use this before creating a product family that needs variant options.
   * @route POST /create-attribute-set
   * @paramDef {"type":"String","label":"Attribute set name","name":"name","required":true,"description":"Name of the attribute set."}
   * @paramDef {"type":"Array<Object>","label":"Attributes","name":"attributes","required":true,"schemaLoader":"attributeSetLineSchema","description":"Up to 10 attributes. Each has a name, a type (List/Checkbox/Text) and, for List, comma-separated values."}
   * @returns {Object}
   * @sampleResult {"ID":"0ba27d98-42ca-4bf6-9b9e-9f71538bd53d","Name":"Test set","Attribute1Name":"List attribute name","Attribute1Type":"List","Attribute1Values":"Red, Black, Blue, Aqua"}
   */
  async createAttributeSet(name, attributes) {
    this.#require({ 'Attribute set name': name })
    this.#requireLines(attributes, 'Attributes')
    // docs: https://dearinventory.docs.apiary.io/#reference/attribute-set/attribute-set/post
    const body = { Name: name, ...this.#attributeBody(attributes) }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/ref/attributeset`, method: 'post', body, logTag: 'createAttributeSet' })
  }

  /**
   * @operationName Update Attribute Set
   * @category Reference Data
   * @description Updates an existing attribute set's name and attributes.
   * @route POST /update-attribute-set
   * @paramDef {"type":"String","label":"Attribute set","name":"id","dictionary":"getAttributeSetsDictionary","required":true,"description":"The attribute set to update."}
   * @paramDef {"type":"String","label":"Attribute set name","name":"name","required":true,"description":"Name of the attribute set."}
   * @paramDef {"type":"Array<Object>","label":"Attributes","name":"attributes","required":true,"schemaLoader":"attributeSetLineSchema","description":"Up to 10 attributes (name, type, and for List comma-separated values)."}
   * @returns {Object}
   * @sampleResult {"ID":"0ba27d98-42ca-4bf6-9b9e-9f71538bd53d","Name":"Test set v2"}
   */
  async updateAttributeSet(id, name, attributes) {
    this.#require({ 'Attribute set': id, 'Attribute set name': name })
    this.#requireLines(attributes, 'Attributes')
    // docs: https://dearinventory.docs.apiary.io/#reference/attribute-set/attribute-set  (PUT requires ID + Name + Attribute fields)
    const body = { ID: id, Name: name, ...this.#attributeBody(attributes) }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/ref/attributeset`, method: 'put', body, logTag: 'updateAttributeSet' })
  }

  /**
   * @operationName Delete Attribute Set
   * @category Reference Data
   * @description Permanently deletes an attribute set. This cannot be undone.
   * @route POST /delete-attribute-set
   * @paramDef {"type":"String","label":"Attribute set","name":"id","dictionary":"getAttributeSetsDictionary","required":true,"description":"The attribute set to delete."}
   * @returns {Object}
   * @sampleResult {"Success":true}
   */
  async deleteAttributeSet(id) {
    this.#require({ 'Attribute set': id })
    await this.#apiRequest({ url: `${ API_BASE_URL }/ref/attributeset`, method: 'delete', query: { ID: id }, logTag: 'deleteAttributeSet' })

    return { Success: true }
  }

  // ==========================================================================
  //  PRODUCT FAMILIES
  // ==========================================================================
  /**
   * @operationName List Product Families
   * @category Products
   * @description Lists product families (variant masters). Auto-pages.
   * @route POST /list-product-families
   * @paramDef {"type":"String","label":"Name or SKU starts with","name":"search","description":"Filter by name/SKU prefix. Blank for all."}
   * @paramDef {"type":"Number","label":"Max per page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page 1-1000; auto-pages. Default 100."}
   * @returns {Object}
   * @sampleResult {"ProductFamilies":[{"ID":"ce9a6504-4207-4001-b430-749bf11fdc4f","SKU":"Test","Name":"Test","Category":"Other"}],"Total":1}
   */
  async listProductFamilies(search, limit) {
    const result = await this.#listAll({ url: `${ API_BASE_URL }/productFamily`, query: {}, collection: 'ProductFamilies', limit, logTag: 'listProductFamilies' })

    if (search) {
      const needle = search.toLowerCase()

      result.ProductFamilies = result.ProductFamilies.filter(f => `${ f.Name || '' } ${ f.SKU || '' }`.toLowerCase().includes(needle))
    }

    return result
  }

  /**
   * @operationName Create Product Family
   * @category Products
   * @description Creates a product family (a variant master that generates child variant products). Set the base SKU, name, category, costing method, default location and unit. Add variant lines for each combination.
   * @route POST /create-product-family
   * @paramDef {"type":"String","label":"Family SKU","name":"sku","required":true,"description":"Unique base SKU for the variant family."}
   * @paramDef {"type":"String","label":"Family name","name":"name","required":true,"description":"Base name for generated variant products."}
   * @paramDef {"type":"String","label":"Category","name":"category","dictionary":"getCategoriesDictionary","required":true,"description":"Product category."}
   * @paramDef {"type":"String","label":"Costing method","name":"costingMethod","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["FIFO","FIFO (batch tracked)","FIFO (serial tracked)","FEFO (batch tracked)","FEFO (serial tracked)","Special (batch)","Special (serial)"]}},"description":"How cost is calculated."}
   * @paramDef {"type":"String","label":"Default location","name":"defaultLocation","dictionary":"getLocationsByNameDictionary","required":true,"description":"Default warehouse."}
   * @paramDef {"type":"String","label":"Unit of measure","name":"uom","dictionary":"getUnitsDictionary","required":true,"description":"Stock/sell unit."}
   * @paramDef {"type":"String","label":"Brand","name":"brand","dictionary":"getBrandsDictionary","description":"Optional brand."}
   * @paramDef {"type":"Array<Object>","label":"Variants","name":"variants","schemaLoader":"productFamilyVariantSchema","description":"Optional variant lines (each with SKU, name, and up to 3 option values)."}
   * @returns {Object}
   * @sampleResult {"ID":"ce9a6504-4207-4001-b430-749bf11fdc4f","SKU":"Test","Name":"Test","Category":"Other","UOM":"Item","Products":[{"ID":"ce9a6504-4207-4001-b430-749bf11fdc4f","SKU":"GB1-White"}]}
   */
  async createProductFamily(sku, name, category, costingMethod, defaultLocation, uom, brand, variants) {
    this.#require({ 'Family SKU': sku, 'Family name': name, Category: category, 'Costing method': costingMethod, 'Default location': defaultLocation, 'Unit of measure': uom })
    // docs: https://dearinventory.docs.apiary.io/#reference/product-family/product-family/post
    costingMethod = this.#resolveChoice(costingMethod, COSTING_METHOD_MAP)
    const body = {
      SKU: sku,
      Name: name,
      Category: category,
      CostingMethod: costingMethod,
      DefaultLocation: defaultLocation,
      UOM: uom,
      Brand: brand,
      Products: this.#variantProducts(variants),
    }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/productFamily`, method: 'post', body, logTag: 'createProductFamily' })
  }

  /**
   * @operationName Update Product Family
   * @category Products
   * @description Updates an existing product family. There is no delete in the API.
   * @route POST /update-product-family
   * @paramDef {"type":"String","label":"Product family","name":"id","dictionary":"getProductFamiliesDictionary","required":true,"description":"The product family to update."}
   * @paramDef {"type":"String","label":"Family SKU","name":"sku","required":true,"description":"Unique base SKU for the variant family."}
   * @paramDef {"type":"String","label":"Family name","name":"name","required":true,"description":"Base name for variant products."}
   * @paramDef {"type":"String","label":"Category","name":"category","dictionary":"getCategoriesDictionary","required":true,"description":"Product category."}
   * @paramDef {"type":"String","label":"Costing method","name":"costingMethod","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["FIFO","FIFO (batch tracked)","FIFO (serial tracked)","FEFO (batch tracked)","FEFO (serial tracked)","Special (batch)","Special (serial)"]}},"description":"How cost is calculated."}
   * @paramDef {"type":"String","label":"Default location","name":"defaultLocation","dictionary":"getLocationsByNameDictionary","required":true,"description":"Default warehouse."}
   * @paramDef {"type":"String","label":"Unit of measure","name":"uom","dictionary":"getUnitsDictionary","required":true,"description":"Stock/sell unit."}
   * @paramDef {"type":"String","label":"Brand","name":"brand","dictionary":"getBrandsDictionary","description":"Optional brand."}
   * @paramDef {"type":"Array<Object>","label":"Variants","name":"variants","schemaLoader":"productFamilyVariantSchema","description":"Optional variant lines (each with SKU, name, and up to 3 option values)."}
   * @returns {Object}
   * @sampleResult {"ID":"ce9a6504-4207-4001-b430-749bf11fdc4f","SKU":"Test","Name":"Test v2"}
   */
  async updateProductFamily(id, sku, name, category, costingMethod, defaultLocation, uom, brand, variants) {
    this.#require({ 'Product family': id, 'Family SKU': sku, 'Family name': name, Category: category, 'Costing method': costingMethod, 'Default location': defaultLocation, 'Unit of measure': uom })
    // docs: https://dearinventory.docs.apiary.io/#reference/product-family/product-family  (PUT requires ID + create fields)
    costingMethod = this.#resolveChoice(costingMethod, COSTING_METHOD_MAP)
    const body = {
      ID: id,
      SKU: sku,
      Name: name,
      Category: category,
      CostingMethod: costingMethod,
      DefaultLocation: defaultLocation,
      UOM: uom,
      Brand: brand,
      Products: this.#variantProducts(variants),
    }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/productFamily`, method: 'put', body, logTag: 'updateProductFamily' })
  }

  #variantProducts(variants) {
    if (!Array.isArray(variants)) {
      return undefined
    }

    return variants.map(v => ({
      SKU: v.sku,
      Name: v.name,
      Option1: v.option1,
      Option2: v.option2,
      Option3: v.option3,
    }))
  }

  // ==========================================================================
  //  CUSTOMERS
  // ==========================================================================
  #addressBody(addresses) {
    if (!Array.isArray(addresses)) {
      return undefined
    }

    return addresses.map(a => ({
      Line1: a.line1,
      Line2: a.line2,
      City: a.city,
      State: a.state,
      Postcode: a.postcode,
      Country: a.country,
      Type: a.type,
      DefaultForType: a.defaultForType,
    }))
  }

  #contactBody(contacts) {
    if (!Array.isArray(contacts)) {
      return undefined
    }

    return contacts.map(c => ({
      Name: c.name,
      JobTitle: c.jobTitle,
      Phone: c.phone,
      MobilePhone: c.mobilePhone,
      Email: c.email,
      Default: c.default,
    }))
  }

  /**
   * @operationName List Customers
   * @category Customers
   * @description Lists customers, optionally filtered by name prefix or change date. Auto-pages. Use this to browse customers or find one before creating a sale.
   * @route POST /list-customers
   * @paramDef {"type":"String","label":"Name starts with","name":"search","description":"Filter by name prefix. Blank for all."}
   * @paramDef {"type":"Boolean","label":"Include deprecated","name":"includeDeprecated","uiComponent":{"type":"TOGGLE"},"description":"Include retired customers."}
   * @paramDef {"type":"String","label":"Modified since","name":"modifiedSince","uiComponent":{"type":"DATE_PICKER"},"description":"Only customers changed after this date."}
   * @paramDef {"type":"Number","label":"Max per page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page 1-1000; auto-pages. Default 100."}
   * @returns {Object}
   * @sampleResult {"Total":1,"Page":1,"CustomerList":[{"ID":"7d6b441a-3067-42b1-9b81-2def95df827b","Name":"DIISR - Small Business Services customer","Currency":"AUD","PaymentTerm":"30 days","TaxRule":"GST Free Exports","PriceTier":"Tier 1","Status":"Active"}]}
   */
  async listCustomers(search, includeDeprecated, modifiedSince, limit) {
    return await this.#listAll({
      url: `${ API_BASE_URL }/customer`,
      query: { Name: search || undefined, IncludeDeprecated: includeDeprecated ? 'true' : undefined, ModifiedSince: this.#isoDate(modifiedSince) },
      collection: 'CustomerList',
      limit,
      logTag: 'listCustomers',
    })
  }

  /**
   * @operationName Get Customer
   * @category Customers
   * @description Retrieves the full detail of a single customer, including addresses and contacts. Pick the customer from the dropdown.
   * @route POST /get-customer
   * @paramDef {"type":"String","label":"Customer","name":"customerId","dictionary":"getCustomersDictionary","required":true,"description":"The customer to fetch."}
   * @returns {Object}
   * @sampleResult {"ID":"7d6b441a-3067-42b1-9b81-2def95df827b","Name":"Mary Jane","Currency":"AUD","Status":"Active","Addresses":[],"Contacts":[]}
   */
  async getCustomer(customerId) {
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/customer`, query: { ID: customerId }, logTag: 'getCustomer' })

    return (result && result.CustomerList && result.CustomerList[0]) || result
  }

  /**
   * @operationName Create Customer
   * @category Customers
   * @description Creates a new customer. Only the name is required, but a currency, payment term, tax rule and accounts are recommended for clean invoicing. Use this before raising a sale for a new buyer.
   * @route POST /create-customer
   * @paramDef {"type":"String","label":"Customer name","name":"name","required":true,"description":"Unique customer name."}
   * @paramDef {"type":"String","label":"Display name","name":"displayName","description":"Name shown on documents."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","description":"3-letter currency code (e.g. USD). Defaults to your base currency."}
   * @paramDef {"type":"String","label":"Payment term","name":"paymentTerm","dictionary":"getPaymentTermsDictionary","description":"Default payment term."}
   * @paramDef {"type":"String","label":"Tax rule","name":"taxRule","dictionary":"getSaleTaxRulesDictionary","description":"Default sales tax rule for this customer."}
   * @paramDef {"type":"String","label":"Price tier","name":"priceTier","dictionary":"getPriceTiersDictionary","description":"Default price tier."}
   * @paramDef {"type":"String","label":"Receivable account","name":"accountReceivable","dictionary":"getAccountsDictionary","description":"Accounts-receivable account code."}
   * @paramDef {"type":"String","label":"Revenue account","name":"revenueAccount","dictionary":"getAccountsDictionary","description":"Default revenue account code."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Deprecated"]}},"description":"Active or Deprecated. Defaults to Active."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free notes."}
   * @paramDef {"type":"Array<Object>","label":"Addresses","name":"addresses","schemaLoader":"customerAddressSchema","description":"Billing/shipping/business addresses."}
   * @paramDef {"type":"Array<Object>","label":"Contacts","name":"contacts","schemaLoader":"contactSchema","description":"Customer contacts (name, email, phone)."}
   * @returns {Object}
   * @sampleResult {"Total":1,"Page":1,"CustomerList":[{"ID":"7d6b441a-3067-42b1-9b81-2def95df827b","Name":"DIISR - Small Business Services customer","DisplayName":"Mary Jane","Currency":"AUD","Status":"Active"}]}
   */
  async createCustomer(name, displayName, currency, paymentTerm, taxRule, priceTier, accountReceivable, revenueAccount, status, comments, addresses, contacts) {
    this.#require({ 'Customer name': name })
    // docs: https://dearinventory.docs.apiary.io/#reference/customer/customer/post
    const body = {
      Name: name,
      DisplayName: displayName,
      Currency: currency,
      PaymentTerm: paymentTerm,
      TaxRule: taxRule,
      PriceTier: priceTier,
      AccountReceivable: accountReceivable,
      RevenueAccount: revenueAccount,
      Status: status || 'Active',
      Comments: comments,
      Addresses: this.#addressBody(addresses),
      Contacts: this.#contactBody(contacts),
    }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/customer`, method: 'post', body, logTag: 'createCustomer' })
  }

  /**
   * @operationName Update Customer
   * @category Customers
   * @description Updates an existing customer. There is no delete in Cin7 - set Status to "Deprecated" to retire a customer.
   * @route POST /update-customer
   * @paramDef {"type":"String","label":"Customer","name":"id","dictionary":"getCustomersDictionary","required":true,"description":"The customer to update (set Status=Deprecated to retire — there is no delete)."}
   * @paramDef {"type":"String","label":"Customer name","name":"name","required":true,"description":"Unique customer name."}
   * @paramDef {"type":"String","label":"Display name","name":"displayName","description":"Name shown on documents."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","description":"3-letter currency code."}
   * @paramDef {"type":"String","label":"Payment term","name":"paymentTerm","dictionary":"getPaymentTermsDictionary","description":"Default payment term."}
   * @paramDef {"type":"String","label":"Tax rule","name":"taxRule","dictionary":"getSaleTaxRulesDictionary","description":"Default sales tax rule."}
   * @paramDef {"type":"String","label":"Price tier","name":"priceTier","dictionary":"getPriceTiersDictionary","description":"Default price tier."}
   * @paramDef {"type":"String","label":"Receivable account","name":"accountReceivable","dictionary":"getAccountsDictionary","description":"AR account code."}
   * @paramDef {"type":"String","label":"Revenue account","name":"revenueAccount","dictionary":"getAccountsDictionary","description":"Default revenue account code."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Deprecated"]}},"description":"Active or Deprecated."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free notes."}
   * @paramDef {"type":"Array<Object>","label":"Addresses","name":"addresses","schemaLoader":"customerAddressSchema","description":"Billing/shipping/business addresses."}
   * @paramDef {"type":"Array<Object>","label":"Contacts","name":"contacts","schemaLoader":"contactSchema","description":"Customer contacts."}
   * @returns {Object}
   * @sampleResult {"Total":1,"Page":1,"CustomerList":[{"ID":"7d6b441a-3067-42b1-9b81-2def95df827b","Name":"Mary Jane v2","Status":"Active"}]}
   */
  async updateCustomer(id, name, displayName, currency, paymentTerm, taxRule, priceTier, accountReceivable, revenueAccount, status, comments, addresses, contacts) {
    this.#require({ Customer: id, 'Customer name': name })
    // docs: https://dearinventory.docs.apiary.io/#reference/customer/customer/put  (PUT body mirrors POST; ID required)
    const body = {
      ID: id,
      Name: name,
      DisplayName: displayName,
      Currency: currency,
      PaymentTerm: paymentTerm,
      TaxRule: taxRule,
      PriceTier: priceTier,
      AccountReceivable: accountReceivable,
      RevenueAccount: revenueAccount,
      Status: status,
      Comments: comments,
      Addresses: this.#addressBody(addresses),
      Contacts: this.#contactBody(contacts),
    }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/customer`, method: 'put', body, logTag: 'updateCustomer' })
  }

  // ==========================================================================
  //  SUPPLIERS
  // ==========================================================================
  /**
   * @operationName List Suppliers
   * @category Suppliers
   * @description Lists suppliers, optionally filtered by name prefix or change date. Auto-pages. Use this to browse suppliers or find one before creating a purchase.
   * @route POST /list-suppliers
   * @paramDef {"type":"String","label":"Name starts with","name":"search","description":"Filter by name prefix. Blank for all."}
   * @paramDef {"type":"Boolean","label":"Include deprecated","name":"includeDeprecated","uiComponent":{"type":"TOGGLE"},"description":"Include retired suppliers."}
   * @paramDef {"type":"String","label":"Modified since","name":"modifiedSince","uiComponent":{"type":"DATE_PICKER"},"description":"Only suppliers changed after this date."}
   * @paramDef {"type":"Number","label":"Max per page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page 1-1000; auto-pages. Default 100."}
   * @returns {Object}
   * @sampleResult {"Total":1,"Page":1,"SupplierList":[{"ID":"57144411-51ce-446f-9c96-db4243c477dc","Name":"Post Supplier test","Currency":"AUD","PaymentTerm":"30 days","TaxRule":"BAS Excluded","AccountPayable":"800","Status":"Active"}]}
   */
  async listSuppliers(search, includeDeprecated, modifiedSince, limit) {
    return await this.#listAll({
      url: `${ API_BASE_URL }/supplier`,
      query: { Name: search || undefined, IncludeDeprecated: includeDeprecated ? 'true' : undefined, ModifiedSince: this.#isoDate(modifiedSince) },
      collection: 'SupplierList',
      limit,
      logTag: 'listSuppliers',
    })
  }

  /**
   * @operationName Get Supplier
   * @category Suppliers
   * @description Retrieves the full detail of a single supplier, including addresses and contacts. Pick the supplier from the dropdown.
   * @route POST /get-supplier
   * @paramDef {"type":"String","label":"Supplier","name":"supplierId","dictionary":"getSuppliersDictionary","required":true,"description":"The supplier to fetch."}
   * @returns {Object}
   * @sampleResult {"ID":"57144411-51ce-446f-9c96-db4243c477dc","Name":"ABC Furniture","Currency":"RUB","Status":"Active","Addresses":[],"Contacts":[]}
   */
  async getSupplier(supplierId) {
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/supplier`, query: { ID: supplierId }, logTag: 'getSupplier' })

    return (result && result.SupplierList && result.SupplierList[0]) || result
  }

  /**
   * @operationName Create Supplier
   * @category Suppliers
   * @description Creates a new supplier. Only the name is required, but a currency, payment term, tax rule and payable account are recommended. Use this before raising a purchase for a new vendor.
   * @route POST /create-supplier
   * @paramDef {"type":"String","label":"Supplier name","name":"name","required":true,"description":"Unique supplier name."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","description":"3-letter currency code."}
   * @paramDef {"type":"String","label":"Payment term","name":"paymentTerm","dictionary":"getPaymentTermsDictionary","description":"Default payment term."}
   * @paramDef {"type":"String","label":"Tax rule","name":"taxRule","dictionary":"getPurchaseTaxRulesDictionary","description":"Default purchase tax rule."}
   * @paramDef {"type":"String","label":"Payable account","name":"accountPayable","dictionary":"getAccountsDictionary","description":"Accounts-payable account code."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Deprecated"]}},"description":"Active or Deprecated. Defaults to Active."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free notes."}
   * @paramDef {"type":"Array<Object>","label":"Addresses","name":"addresses","schemaLoader":"supplierAddressSchema","description":"Supplier addresses."}
   * @paramDef {"type":"Array<Object>","label":"Contacts","name":"contacts","schemaLoader":"contactSchema","description":"Supplier contacts."}
   * @returns {Object}
   * @sampleResult {"Total":1,"Page":1,"SupplierList":[{"ID":"57144411-51ce-446f-9c96-db4243c477dc","Name":"Post Supplier test","Currency":"AUD","TaxRule":"BAS Excluded","Status":"Active"}]}
   */
  async createSupplier(name, currency, paymentTerm, taxRule, accountPayable, status, comments, addresses, contacts) {
    this.#require({ 'Supplier name': name })
    // docs: https://dearinventory.docs.apiary.io/#reference/supplier/supplier/post
    const body = {
      Name: name,
      Currency: currency,
      PaymentTerm: paymentTerm,
      TaxRule: taxRule,
      AccountPayable: accountPayable,
      Status: status || 'Active',
      Comments: comments,
      Addresses: this.#addressBody(addresses),
      Contacts: this.#contactBody(contacts),
    }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/supplier`, method: 'post', body, logTag: 'createSupplier' })
  }

  /**
   * @operationName Update Supplier
   * @category Suppliers
   * @description Updates an existing supplier. There is no delete in Cin7 - set Status to "Deprecated" to retire a supplier.
   * @route POST /update-supplier
   * @paramDef {"type":"String","label":"Supplier","name":"id","dictionary":"getSuppliersDictionary","required":true,"description":"The supplier to update (set Status=Deprecated to retire — there is no delete)."}
   * @paramDef {"type":"String","label":"Supplier name","name":"name","required":true,"description":"Unique supplier name."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","description":"3-letter currency code."}
   * @paramDef {"type":"String","label":"Payment term","name":"paymentTerm","dictionary":"getPaymentTermsDictionary","description":"Default payment term."}
   * @paramDef {"type":"String","label":"Tax rule","name":"taxRule","dictionary":"getPurchaseTaxRulesDictionary","description":"Default purchase tax rule."}
   * @paramDef {"type":"String","label":"Payable account","name":"accountPayable","dictionary":"getAccountsDictionary","description":"AP account code."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Deprecated"]}},"description":"Active or Deprecated."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free notes."}
   * @paramDef {"type":"Array<Object>","label":"Addresses","name":"addresses","schemaLoader":"supplierAddressSchema","description":"Supplier addresses."}
   * @paramDef {"type":"Array<Object>","label":"Contacts","name":"contacts","schemaLoader":"contactSchema","description":"Supplier contacts."}
   * @returns {Object}
   * @sampleResult {"Total":1,"Page":1,"SupplierList":[{"ID":"57144411-51ce-446f-9c96-db4243c477dc","Name":"Post Supplier test v2","Status":"Active"}]}
   */
  async updateSupplier(id, name, currency, paymentTerm, taxRule, accountPayable, status, comments, addresses, contacts) {
    this.#require({ Supplier: id, 'Supplier name': name })
    // docs: https://dearinventory.docs.apiary.io/#reference/supplier/supplier  (PUT body mirrors POST; ID required)
    const body = {
      ID: id,
      Name: name,
      Currency: currency,
      PaymentTerm: paymentTerm,
      TaxRule: taxRule,
      AccountPayable: accountPayable,
      Status: status,
      Comments: comments,
      Addresses: this.#addressBody(addresses),
      Contacts: this.#contactBody(contacts),
    }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/supplier`, method: 'put', body, logTag: 'updateSupplier' })
  }

  // ==========================================================================
  //  SALES - shell + lifecycle
  // ==========================================================================
  #saleLineBody(lines) {
    if (!Array.isArray(lines)) {
      return []
    }

    return lines.map(l => ({
      ProductID: l.productId,
      Quantity: l.quantity,
      Price: l.price,
      Discount: l.discount,
      TaxRule: l.taxRule,
      Comment: l.comment,
      Account: l.account,
    }))
  }

  /**
   * @operationName List Sales
   * @category Sales
   * @description Lists sales (orders), optionally filtered by search text, status or change date. Auto-pages. Use this to browse the sales pipeline or find a sale before working on its quote, order, fulfilment or invoice.
   * @route POST /list-sales
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Match order number, customer, reference. Blank for all."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Estimating","Estimated","Ordering","Ordered","Backordered","Invoicing","Invoiced","Completed","Voided"]}},"description":"Filter by sale status."}
   * @paramDef {"type":"String","label":"Updated since","name":"updatedSince","uiComponent":{"type":"DATE_PICKER"},"description":"Only sales changed after this date."}
   * @paramDef {"type":"Number","label":"Max per page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page 1-1000; auto-pages. Default 100."}
   * @returns {Object}
   * @sampleResult {"Total":1,"Page":1,"SaleList":[{"SaleID":"916ab4c0-6ccb-4c93-873d-0603859050e4","OrderNumber":"SO-00001","Status":"ORDERED","OrderDate":"2017-10-28T00:00:00","Customer":"Hamilton Smith Pty","CustomerID":"6c18f8e9-90e1-418f-aebc-1219e67e4b9c","InvoiceAmount":358,"PaidAmount":0,"OrderStatus":"AUTHORISED"}]}
   */
  async listSales(search, status, updatedSince, limit) {
    status = this.#resolveChoice(status, SALE_STATUS_MAP)

    return await this.#listAll({
      url: `${ API_BASE_URL }/saleList`,
      query: { Search: search || undefined, Status: status || undefined, UpdatedSince: this.#isoDate(updatedSince) },
      collection: 'SaleList',
      limit,
      logTag: 'listSales',
    })
  }

  /**
   * @operationName Get Sale
   * @category Sales
   * @description Retrieves the full detail of a single sale, including its quote, order, fulfilments and invoices (with their TaskIDs). Pick the sale from the dropdown. Use this to read fulfilment/invoice TaskIDs needed by other actions.
   * @route POST /get-sale
   * @paramDef {"type":"String","label":"Sale","name":"saleId","dictionary":"getSalesDictionary","required":true,"description":"The sale to fetch."}
   * @paramDef {"type":"Boolean","label":"Include transactions","name":"includeTransactions","uiComponent":{"type":"TOGGLE"},"description":"Include inventory/financial transactions in the result."}
   * @returns {Object}
   * @sampleResult {"ID":"916ab4c0-6ccb-4c93-873d-0603859050e4","Customer":"Hamilton Smith Pty","CustomerID":"6c18f8e9-90e1-418f-aebc-1219e67e4b9c","Status":"ORDERED","TaxRule":"Tax on Sales","Location":"Main Warehouse","Order":{"SaleOrderNumber":"SO-00001","Status":"AUTHORISED"},"Invoices":[{"TaskID":"b039f19e-66f8-4309-a4b1-abf928303c88","InvoiceNumber":"INV-00001"}]}
   */
  async getSale(saleId, includeTransactions) {
    return await this.#apiRequest({ url: `${ API_BASE_URL }/sale`, query: { ID: saleId, IncludeTransactions: includeTransactions ? 'true' : undefined }, logTag: 'getSale' })
  }

  /**
   * @operationName Create Sale
   * @category Sales
   * @description Creates a new sale (the document shell). Pick the customer from the dropdown - Cin7 needs the customer ID, not just a name - and set the location and tax rule (both required). After creating, set the quote/order/fulfilment/invoice stages.
   * @route POST /create-sale
   * @paramDef {"type":"String","label":"Customer","name":"customerId","dictionary":"getCustomersDictionary","required":true,"description":"The customer for this sale. Pick from the list — Cin7 needs the customer ID, not just a name."}
   * @paramDef {"type":"String","label":"Location","name":"location","dictionary":"getLocationsByNameDictionary","required":true,"description":"Warehouse to pick stock from. Required."}
   * @paramDef {"type":"String","label":"Tax rule","name":"taxRule","dictionary":"getSaleTaxRulesDictionary","required":true,"description":"Default sales tax rule for the sale (required by Cin7)."}
   * @paramDef {"type":"String","label":"Price tier","name":"priceTier","dictionary":"getPriceTiersDictionary","description":"Price tier to apply. Defaults to the customer's tier."}
   * @paramDef {"type":"Boolean","label":"Prices include tax","name":"taxInclusive","uiComponent":{"type":"TOGGLE"},"description":"On = line prices already include tax (Inclusive); Off = tax added on top (Exclusive)."}
   * @paramDef {"type":"String","label":"Payment term","name":"terms","dictionary":"getPaymentTermsDictionary","description":"Payment term name."}
   * @paramDef {"type":"String","label":"Carrier","name":"carrier","dictionary":"getCarriersDictionary","description":"Shipping carrier."}
   * @paramDef {"type":"String","label":"Customer reference","name":"customerReference","description":"The customer's PO number or reference."}
   * @paramDef {"type":"String","label":"Note","name":"note","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Internal note."}
   * @paramDef {"type":"String","label":"Ship by","name":"shipBy","uiComponent":{"type":"DATE_PICKER"},"description":"Date shipment is due."}
   * @paramDef {"type":"String","label":"Order date","name":"saleOrderDate","uiComponent":{"type":"DATE_PICKER"},"description":"Order date. Defaults to today."}
   * @paramDef {"type":"Number","label":"Currency rate","name":"currencyRate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Conversion rate vs base currency. Leave 1 unless the customer uses a different currency."}
   * @paramDef {"type":"Boolean","label":"Skip quote","name":"skipQuote","uiComponent":{"type":"TOGGLE"},"description":"On = no quote stage; the sale starts at the order stage."}
   * @returns {Object}
   * @sampleResult {"ID":"916ab4c0-6ccb-4c93-873d-0603859050e4","Customer":"Hamilton Smith Pty","CustomerID":"6c18f8e9-90e1-418f-aebc-1219e67e4b9c","Status":"ORDERED","TaxRule":"Tax on Sales","Location":"Main Warehouse"}
   */
  async createSale(customerId, location, taxRule, priceTier, taxInclusive, terms, carrier, customerReference, note, shipBy, saleOrderDate, currencyRate, skipQuote) {
    this.#require({ Customer: customerId, Location: location, 'Tax rule': taxRule })
    // docs: https://dearinventory.docs.apiary.io/#reference/sale/sale/post
    //   Sale POST/PUT Attributes table: `CurrencyRate` = Decimal (up to 5 dp); `TaxInclusive`
    //   = Boolean; `SkipQuote` = Boolean. Send the documented types (matches every other
    //   CurrencyRate path, all of which send a number) - not stringified values.
    const body = {
      CustomerID: customerId,
      Location: location,
      TaxRule: taxRule,
      PriceTier: priceTier,
      TaxInclusive: taxInclusive === undefined ? undefined : Boolean(taxInclusive),
      Terms: terms,
      Carrier: carrier,
      CustomerReference: customerReference,
      Note: note,
      ShipBy: this.#isoDate(shipBy),
      SaleOrderDate: this.#isoDate(saleOrderDate),
      CurrencyRate: currencyRate === undefined ? 1 : currencyRate,
      SkipQuote: skipQuote === undefined ? undefined : Boolean(skipQuote),
    }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/sale`, method: 'post', body, logTag: 'createSale' })
  }

  /**
   * @operationName Set Sale Quote
   * @category Sales
   * @description Creates or updates the quote stage of a sale with its line items. Set status to Authorised to lock the quote so the order can proceed. Use this after Create Sale (unless you skipped the quote).
   * @route POST /set-sale-quote
   * @paramDef {"type":"String","label":"Sale","name":"saleId","dictionary":"getSalesDictionary","required":true,"description":"The sale whose quote you are setting."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Authorised"]}},"description":"Draft saves it; Authorised locks the quote so the order can proceed."}
   * @paramDef {"type":"String","label":"Memo","name":"memo","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Quote memo."}
   * @paramDef {"type":"Array<Object>","label":"Quote lines","name":"lines","required":true,"schemaLoader":"saleLineSchema","description":"Products being quoted (product, quantity, price, tax rule)."}
   * @returns {Object}
   * @sampleResult {"SaleID":"916ab4c0-6ccb-4c93-873d-0603859050e4","Status":"AUTHORISED","Lines":[{"ProductID":"4aadd8f6-4d3d-46ca-acbb-1a9a662f9bc1","SKU":"Bread","Quantity":1,"Price":8,"Total":8}],"Total":8}
   */
  async upsertSaleQuote(saleId, status, memo, lines) {
    this.#require({ Sale: saleId, Status: status })
    this.#requireLines(lines, 'Quote lines')
    // docs: https://dearinventory.docs.apiary.io/#reference/sale/sale-quote/post
    status = this.#resolveChoice(status, DRAFT_AUTHORISED_MAP)
    const body = {
      SaleID: saleId,
      CombineAdditionalCharges: false,
      Memo: memo || '',
      Status: status,
      Lines: this.#saleLineBody(lines),
    }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/sale/quote`, method: 'post', body, logTag: 'upsertSaleQuote' })
  }

  /**
   * @operationName Set Sale Order
   * @category Sales
   * @description Creates or updates the order stage of a sale with its line items. Authorise to allocate stock and move the sale forward. Use this after the quote is authorised (or after Create Sale with Skip quote on).
   * @route POST /set-sale-order
   * @paramDef {"type":"String","label":"Sale","name":"saleId","dictionary":"getSalesDictionary","required":true,"description":"The sale whose order you are setting."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Authorised"]}},"description":"Authorise to allocate stock and move the sale forward."}
   * @paramDef {"type":"String","label":"Auto pick/pack/ship","name":"autoPickPackShipMode","uiComponent":{"type":"DROPDOWN","options":{"values":["No auto pick","Auto pick","Auto pick & pack","Auto pick, pack & ship"]}},"description":"For simple sales: how far to auto-progress fulfilment on authorise."}
   * @paramDef {"type":"String","label":"Memo","name":"memo","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Order memo."}
   * @paramDef {"type":"Array<Object>","label":"Order lines","name":"lines","required":true,"schemaLoader":"saleOrderLineSchema","description":"Products on the order."}
   * @returns {Object}
   * @sampleResult {"SaleID":"916ab4c0-6ccb-4c93-873d-0603859050e4","SaleOrderNumber":"SO-00001","Status":"AUTHORISED","Total":8}
   */
  async upsertSaleOrder(saleId, status, autoPickPackShipMode, memo, lines) {
    this.#require({ Sale: saleId, Status: status })
    this.#requireLines(lines, 'Order lines')
    // docs: https://dearinventory.docs.apiary.io/#reference/sale/sale-order/post
    status = this.#resolveChoice(status, DRAFT_AUTHORISED_MAP)
    autoPickPackShipMode = this.#resolveChoice(autoPickPackShipMode, AUTO_PPS_MAP)
    const body = {
      SaleID: saleId,
      Memo: memo || '',
      Status: status,
      AutoPickPackShipMode: autoPickPackShipMode,
      Lines: this.#saleLineBody(lines).map(l => ({ ...l, DropShip: false })),
    }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/sale/order`, method: 'post', body, logTag: 'upsertSaleOrder' })
  }

  /**
   * @operationName Get Sale Fulfilments
   * @category Sales
   * @description Lists the fulfilments (pick/pack/ship tasks) of a sale, with their TaskIDs. Pick the sale from the dropdown. Use this to get the fulfilment TaskID needed to authorise a pick, pack or ship.
   * @route POST /get-sale-fulfilments
   * @paramDef {"type":"String","label":"Sale","name":"saleId","dictionary":"getSalesDictionary","required":true,"description":"The sale whose fulfilments you want."}
   * @returns {Object}
   * @sampleResult {"SaleID":"916ab4c0-6ccb-4c93-873d-0603859050e4","Fulfilments":[{"TaskID":"cde5fb4a-1dac-4e9a-bc33-5dfa14eedb57","FulFilmentStatus":"NOT FULFILLED","Pick":{"Status":"DRAFT"}}]}
   */
  async getSaleFulfilments(saleId) {
    return await this.#apiRequest({ url: `${ API_BASE_URL }/sale/fulfilment`, query: { SaleID: saleId }, logTag: 'getSaleFulfilments' })
  }

  /**
   * @operationName Set Sale Pick
   * @category Sales
   * @description Authorises (or drafts) the pick stage of a sale fulfilment. Supply the fulfilment TaskID from Get Sale Fulfilments and the lines being picked. The order must be authorised first.
   * @route POST /set-sale-pick
   * @paramDef {"type":"String","label":"Fulfilment","name":"taskId","dictionary":"getSaleFulfilmentTasksDictionary","required":true,"description":"The fulfilment to act on (from Get Sale Fulfilments)."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Authorised"]}},"description":"Authorise to confirm the pick."}
   * @paramDef {"type":"Array<Object>","label":"Pick lines","name":"lines","required":true,"schemaLoader":"pickLineSchema","description":"Products/locations/quantities being picked."}
   * @returns {Object}
   * @sampleResult {"TaskID":"cde5fb4a-1dac-4e9a-bc33-5dfa14eedb57","Status":"AUTHORISED","Lines":[{"ProductID":"4aadd8f6-4d3d-46ca-acbb-1a9a662f9bc1","Quantity":1}]}
   */
  async upsertSaleFulfilmentPick(taskId, status, lines) {
    this.#require({ Fulfilment: taskId, Status: status })
    this.#requireLines(lines, 'Pick lines')
    // docs: https://dearinventory.docs.apiary.io/#reference/sale/sale-fulfilment-pick/post
    status = this.#resolveChoice(status, DRAFT_AUTHORISED_MAP)
    const body = {
      TaskID: taskId,
      Status: status,
      Lines: (Array.isArray(lines) ? lines : []).map(l => ({
        ProductID: l.productId,
        Location: l.location,
        LocationID: l.locationId,
        Quantity: l.quantity,
        BatchSN: l.batchSN,
        ExpiryDate: this.#isoDate(l.expiryDate),
      })),
    }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/sale/fulfilment/pick`, method: 'post', body, logTag: 'upsertSaleFulfilmentPick' })
  }

  /**
   * @operationName Set Sale Pack
   * @category Sales
   * @description Authorises (or drafts) the pack stage of a sale fulfilment. Supply the fulfilment TaskID and the lines being packed. The pick must be authorised first.
   * @route POST /set-sale-pack
   * @paramDef {"type":"String","label":"Fulfilment","name":"taskId","dictionary":"getSaleFulfilmentTasksDictionary","required":true,"description":"The fulfilment to act on (from Get Sale Fulfilments)."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Authorised"]}},"description":"Authorise to confirm the pack."}
   * @paramDef {"type":"Array<Object>","label":"Pack lines","name":"lines","required":true,"schemaLoader":"packLineSchema","description":"Products/locations/quantities/boxes being packed."}
   * @returns {Object}
   * @sampleResult {"TaskID":"cde5fb4a-1dac-4e9a-bc33-5dfa14eedb57","Status":"AUTHORISED"}
   */
  async upsertSaleFulfilmentPack(taskId, status, lines) {
    this.#require({ Fulfilment: taskId, Status: status })
    this.#requireLines(lines, 'Pack lines')
    // docs: https://dearinventory.docs.apiary.io/#reference/sale/sale-fulfilment-pack/post
    status = this.#resolveChoice(status, DRAFT_AUTHORISED_MAP)
    const body = {
      TaskID: taskId,
      Status: status,
      Lines: (Array.isArray(lines) ? lines : []).map(l => ({
        ProductID: l.productId,
        Location: l.location,
        LocationID: l.locationId,
        Quantity: l.quantity,
        Box: l.box,
        BatchSN: l.batchSN,
        ExpiryDate: this.#isoDate(l.expiryDate),
      })),
    }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/sale/fulfilment/pack`, method: 'post', body, logTag: 'upsertSaleFulfilmentPack' })
  }

  /**
   * @operationName Set Sale Ship
   * @category Sales
   * @description Authorises (or drafts) the ship stage of a sale fulfilment with carrier and tracking details. Supply the fulfilment TaskID. The pack must be authorised first.
   * @route POST /set-sale-ship
   * @paramDef {"type":"String","label":"Fulfilment","name":"taskId","dictionary":"getSaleFulfilmentTasksDictionary","required":true,"description":"The fulfilment to ship (from Get Sale Fulfilments)."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Authorised"]}},"description":"Authorise to confirm shipment."}
   * @paramDef {"type":"Array<Object>","label":"Shipment lines","name":"lines","required":true,"schemaLoader":"shipLineSchema","description":"Carrier, boxes, tracking number per shipment."}
   * @returns {Object}
   * @sampleResult {"TaskID":"cde5fb4a-1dac-4e9a-bc33-5dfa14eedb57","Status":"AUTHORISED","Lines":[{"Carrier":"DEFAULT Carrier","TrackingNumber":"1Z999"}]}
   */
  async upsertSaleFulfilmentShip(taskId, status, lines) {
    this.#require({ Fulfilment: taskId, Status: status })
    this.#requireLines(lines, 'Shipment lines')
    // docs: https://dearinventory.docs.apiary.io/#reference/sale/sale-fulfilment-ship/post
    status = this.#resolveChoice(status, DRAFT_AUTHORISED_MAP)
    const body = {
      TaskID: taskId,
      Status: status,
      Lines: (Array.isArray(lines) ? lines : []).map(l => ({
        Carrier: l.carrier,
        Boxes: l.boxes,
        TrackingNumber: l.trackingNumber,
        TrackingURL: l.trackingUrl,
        ShipmentDate: this.#isoDate(l.shipmentDate),
        IsShipped: l.isShipped,
      })),
    }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/sale/fulfilment/ship`, method: 'post', body, logTag: 'upsertSaleFulfilmentShip' })
  }

  /**
   * @operationName Void Sale Fulfilment
   * @category Sales
   * @description Voids a sale fulfilment, undoing the pick/pack/ship. Supply the fulfilment TaskID. This cannot be undone.
   * @route POST /void-sale-fulfilment
   * @paramDef {"type":"String","label":"Fulfilment","name":"taskId","dictionary":"getSaleFulfilmentTasksDictionary","required":true,"description":"The fulfilment to void."}
   * @returns {Object}
   * @sampleResult {"Success":true}
   */
  async voidSaleFulfilment(taskId) {
    this.#require({ Fulfilment: taskId })
    // docs: https://dearinventory.docs.apiary.io/#reference/sale/sale-fulfilment  (DELETE /sale/fulfilment?TaskID&Void=true)
    await this.#apiRequest({ url: `${ API_BASE_URL }/sale/fulfilment`, method: 'delete', query: { TaskID: taskId, Void: 'true' }, logTag: 'voidSaleFulfilment' })

    return { Success: true }
  }

  /**
   * @operationName Set Sale Invoice
   * @category Sales
   * @description Creates or updates a sale invoice with its line items. Leave the invoice task ID blank to create a new invoice; supply an existing one to update it. Authorise to issue the invoice. The order must be authorised first.
   * @route POST /set-sale-invoice
   * @paramDef {"type":"String","label":"Sale","name":"saleId","dictionary":"getSalesDictionary","required":true,"description":"The sale to invoice."}
   * @paramDef {"type":"String","label":"Invoice (to update)","name":"taskId","dictionary":"getSaleInvoiceTasksDictionary","description":"Leave blank to create a new invoice; pick an existing invoice to update it."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Authorised"]}},"description":"Authorise to issue the invoice."}
   * @paramDef {"type":"String","label":"Invoice date","name":"invoiceDate","uiComponent":{"type":"DATE_PICKER"},"description":"Defaults to today."}
   * @paramDef {"type":"String","label":"Due date","name":"invoiceDueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Payment due date."}
   * @paramDef {"type":"Array<Object>","label":"Invoice lines","name":"lines","required":true,"schemaLoader":"saleInvoiceLineSchema","description":"Products/charges on the invoice."}
   * @returns {Object}
   * @sampleResult {"SaleID":"916ab4c0-6ccb-4c93-873d-0603859050e4","Invoices":[{"TaskID":"b039f19e-66f8-4309-a4b1-abf928303c88","InvoiceNumber":"INV-00001","Status":"DRAFT"}]}
   */
  async upsertSaleInvoice(saleId, taskId, status, invoiceDate, invoiceDueDate, lines) {
    this.#require({ Sale: saleId, Status: status })
    this.#requireLines(lines, 'Invoice lines')
    // docs: https://dearinventory.docs.apiary.io/#reference/sale/sale-invoice/post  (TaskID 00000000-... creates new)
    status = this.#resolveChoice(status, DRAFT_AUTHORISED_MAP)
    const body = {
      SaleID: saleId,
      TaskID: taskId || EMPTY_GUID,
      CombineAdditionalCharges: false,
      Memo: '',
      Status: status,
      InvoiceDate: this.#isoDate(invoiceDate),
      InvoiceDueDate: this.#isoDate(invoiceDueDate),
      Lines: this.#saleLineBody(lines),
    }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/sale/invoice`, method: 'post', body, logTag: 'upsertSaleInvoice' })
  }

  /**
   * @operationName Void Sale Invoice
   * @category Sales
   * @description Voids a sale invoice. Supply the invoice TaskID. This cannot be undone.
   * @route POST /void-sale-invoice
   * @paramDef {"type":"String","label":"Invoice","name":"taskId","dictionary":"getSaleInvoiceTasksDictionary","required":true,"description":"The invoice to void."}
   * @returns {Object}
   * @sampleResult {"Success":true}
   */
  async voidSaleInvoice(taskId) {
    this.#require({ Invoice: taskId })
    // docs: https://dearinventory.docs.apiary.io/#reference/sale/sale-invoice  (DELETE /sale/invoice?TaskID&Void=true)
    await this.#apiRequest({ url: `${ API_BASE_URL }/sale/invoice`, method: 'delete', query: { TaskID: taskId, Void: 'true' }, logTag: 'voidSaleInvoice' })

    return { Success: true }
  }

  /**
   * @operationName Create Sale Payment
   * @category Sales
   * @description Records a customer payment, prepayment or refund against a sale. Supply the invoice TaskID (from Get Sale, Invoices[].TaskID), the amount and the bank/payment account. Use this to mark a sale as paid.
   * @route POST /create-sale-payment
   * @paramDef {"type":"String","label":"Invoice","name":"taskId","dictionary":"getSaleInvoiceTasksDictionary","required":true,"description":"The invoice to pay against (from Get Sale, Invoices)."}
   * @paramDef {"type":"String","label":"Payment type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Payment","Prepayment","Refund"]}},"description":"Payment (against authorised invoice), Prepayment (before invoice), or Refund (against credit note)."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Amount in the customer's currency."}
   * @paramDef {"type":"String","label":"Date paid","name":"datePaid","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"When the payment was made."}
   * @paramDef {"type":"String","label":"Bank/payment account","name":"account","dictionary":"getAccountsDictionary","required":true,"description":"Account code money is received into."}
   * @paramDef {"type":"Number","label":"Currency rate","name":"currencyRate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Rate vs base currency; leave 1 for same-currency."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"Payment reference."}
   * @returns {Object}
   * @sampleResult {"SaleID":"916ab4c0-6ccb-4c93-873d-0603859050e4","TaskID":"4733ba69-21c5-48f5-95e5-307aa9889747","ID":"6d99006a-8965-4548-8743-0268b8130704","Type":"Payment","Amount":1,"Account":"718"}
   */
  async createSalePayment(taskId, type, amount, datePaid, account, currencyRate, reference) {
    this.#require({ Invoice: taskId, 'Payment type': type, Amount: amount, 'Date paid': datePaid, 'Bank/payment account': account })
    // docs: https://dearinventory.docs.apiary.io/#reference/sale/sale-payments/post
    type = this.#resolveChoice(type, PAYMENT_TYPE_MAP)
    const body = {
      TaskID: taskId,
      Type: type,
      Reference: reference || '',
      Amount: amount,
      DatePaid: this.#isoDate(datePaid),
      Account: account,
      CurrencyRate: currencyRate === undefined ? 1 : currencyRate,
    }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/sale/payment`, method: 'post', body, logTag: 'createSalePayment' })
  }

  /**
   * @operationName Update Sale Payment
   * @category Sales
   * @description Updates an existing sale payment by its payment ID. Use this to correct an amount, account or date.
   * @route POST /update-sale-payment
   * @paramDef {"type":"String","label":"Payment ID","name":"id","required":true,"description":"The sale payment ID to update."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New amount."}
   * @paramDef {"type":"String","label":"Date paid","name":"datePaid","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"New payment date."}
   * @paramDef {"type":"String","label":"Bank/payment account","name":"account","dictionary":"getAccountsDictionary","required":true,"description":"Account code money is received into."}
   * @paramDef {"type":"Number","label":"Currency rate","name":"currencyRate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Rate vs base currency; leave 1 for same-currency."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"Payment reference."}
   * @returns {Object}
   * @sampleResult {"ID":"ee093a0c-d177-9728-1df5-628a61a939e4","Amount":357,"Account":"718"}
   */
  async updateSalePayment(id, amount, datePaid, account, currencyRate, reference) {
    this.#require({ 'Payment ID': id, Amount: amount, 'Date paid': datePaid, 'Bank/payment account': account })
    // docs: https://dearinventory.docs.apiary.io/#reference/sale/sale-payments  (PUT requires ID)
    const body = {
      ID: id,
      Amount: amount,
      DatePaid: this.#isoDate(datePaid),
      Account: account,
      CurrencyRate: currencyRate === undefined ? 1 : currencyRate,
      Reference: reference,
    }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/sale/payment`, method: 'put', body, logTag: 'updateSalePayment' })
  }

  /**
   * @operationName Delete Sale Payment
   * @category Sales
   * @description Deletes a sale payment by its payment ID. This cannot be undone.
   * @route POST /delete-sale-payment
   * @paramDef {"type":"String","label":"Payment ID","name":"id","required":true,"description":"The sale payment ID to delete."}
   * @returns {Object}
   * @sampleResult {"Success":true}
   */
  async deleteSalePayment(id) {
    this.#require({ 'Payment ID': id })
    // docs: https://dearinventory.docs.apiary.io/#reference/sale/sale-payments  (DELETE ?ID={ID})
    await this.#apiRequest({ url: `${ API_BASE_URL }/sale/payment`, method: 'delete', query: { ID: id }, logTag: 'deleteSalePayment' })

    return { Success: true }
  }

  // ==========================================================================
  //  PURCHASES - Advanced Purchase shell + lifecycle
  // ==========================================================================
  #purchaseLineBody(lines) {
    if (!Array.isArray(lines)) {
      return []
    }

    return lines.map(l => ({
      ProductID: l.productId,
      SupplierSKU: l.supplierSku,
      Quantity: l.quantity,
      Price: l.price,
      Discount: l.discount,
      TaxRule: l.taxRule,
      Comment: l.comment,
      Account: l.account,
    }))
  }

  /**
   * @operationName List Purchases
   * @category Purchases
   * @description Lists purchases (advanced purchase orders), optionally filtered by search text, status or change date. Auto-pages. Use this to browse purchasing or find a purchase before working on its order, stock or invoice.
   * @route POST /list-purchases
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Match PO number, supplier. Blank for all."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Ordering","Ordered","Receiving","Received","Invoiced","Completed","Voided"]}},"description":"Filter by purchase status."}
   * @paramDef {"type":"String","label":"Updated since","name":"updatedSince","uiComponent":{"type":"DATE_PICKER"},"description":"Only purchases changed after this date."}
   * @paramDef {"type":"Number","label":"Max per page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page 1-1000; auto-pages. Default 100."}
   * @returns {Object}
   * @sampleResult {"Total":1,"Page":1,"PurchaseList":[{"ID":"3fb1debd-1f89-476c-b7ac-826a493a2092","SupplierID":"f1d1696b-8988-4ca0-8b9d-60317e463d07","Supplier":"ABPA","OrderNumber":"PO-00007","Status":"ORDERING","OrderDate":"2017-12-08T00:00:00"}]}
   */
  async listPurchases(search, status, updatedSince, limit) {
    status = this.#resolveChoice(status, PURCHASE_STATUS_MAP)

    return await this.#listAll({
      url: `${ API_BASE_URL }/purchaseList`,
      query: { Search: search || undefined, Status: status || undefined, UpdatedSince: this.#isoDate(updatedSince) },
      collection: 'PurchaseList',
      limit,
      logTag: 'listPurchases',
    })
  }

  /**
   * @operationName Get Purchase
   * @category Purchases
   * @description Retrieves the full detail of a single purchase, including its order, stock-received and invoice stages. Pick the purchase from the dropdown.
   * @route POST /get-purchase
   * @paramDef {"type":"String","label":"Purchase","name":"purchaseId","dictionary":"getPurchasesDictionary","required":true,"description":"The purchase to fetch."}
   * @returns {Object}
   * @sampleResult {"ID":"695dbaf4-92c3-4388-a35c-0efa378db93e","SupplierID":"92c27d86-a8d3-4335-9da1-d3ebd82cb568","Supplier":"Test Supplier","Status":"ORDERING","TaxRule":"Sales Tax on Imports","Location":"Main Warehouse","Order":{"Status":"NOT AVAILABLE"}}
   */
  async getPurchase(purchaseId) {
    return await this.#apiRequest({ url: `${ API_BASE_URL }/advanced-purchase`, query: { ID: purchaseId }, logTag: 'getPurchase' })
  }

  /**
   * @operationName Create Purchase
   * @category Purchases
   * @description Creates a new purchase (advanced purchase shell). Pick the supplier from the dropdown - Cin7 needs the supplier ID, not just a name - and set the tax rule and location (both required). After creating, set the order/stock/invoice stages.
   * @route POST /create-purchase
   * @paramDef {"type":"String","label":"Supplier","name":"supplierId","dictionary":"getSuppliersDictionary","required":true,"description":"The supplier for this purchase. Pick from the list — Cin7 needs the supplier ID, not just a name."}
   * @paramDef {"type":"String","label":"Tax rule","name":"taxRule","dictionary":"getPurchaseTaxRulesDictionary","required":true,"description":"Default purchase tax rule (required by Cin7)."}
   * @paramDef {"type":"String","label":"Location","name":"location","dictionary":"getLocationsByNameDictionary","required":true,"description":"Warehouse to receive stock into."}
   * @paramDef {"type":"Number","label":"Currency rate","name":"currencyRate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Rate vs base currency; leave 1 for same-currency."}
   * @paramDef {"type":"String","label":"Approach","name":"approach","uiComponent":{"type":"DROPDOWN","options":{"values":["Invoice first","Stock first"]}},"description":"Invoice first (enter invoice before receiving) or Stock first (receive before invoicing)."}
   * @paramDef {"type":"String","label":"Purchase type","name":"purchaseType","uiComponent":{"type":"DROPDOWN","options":{"values":["Simple purchase","Advanced purchase","Service purchase"]}},"description":"Simple, Advanced, or Service purchase."}
   * @paramDef {"type":"String","label":"Tax calculation","name":"taxCalculation","uiComponent":{"type":"DROPDOWN","options":{"values":["Tax exclusive","Tax inclusive"]}},"description":"Whether line prices include tax."}
   * @paramDef {"type":"String","label":"Payment term","name":"terms","dictionary":"getPaymentTermsDictionary","description":"Payment term name."}
   * @paramDef {"type":"Boolean","label":"Blind receipt","name":"blindReceipt","uiComponent":{"type":"TOGGLE"},"description":"On = no order stage; receive stock directly."}
   * @paramDef {"type":"String","label":"Required by","name":"requiredBy","uiComponent":{"type":"DATE_PICKER"},"description":"Date goods are needed."}
   * @paramDef {"type":"String","label":"Note","name":"note","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Internal note."}
   * @returns {Object}
   * @sampleResult {"ID":"695dbaf4-92c3-4388-a35c-0efa378db93e","SupplierID":"92c27d86-a8d3-4335-9da1-d3ebd82cb568","Supplier":"Test Supplier","OrderNumber":"PO-00008","Status":"ORDERING","TaxRule":"Sales Tax on Imports","Location":"Main Warehouse"}
   */
  async createPurchase(supplierId, taxRule, location, currencyRate, approach, purchaseType, taxCalculation, terms, blindReceipt, requiredBy, note) {
    this.#require({ Supplier: supplierId, 'Tax rule': taxRule, Location: location })
    // docs: https://dearinventory.docs.apiary.io/#reference/purchase/advanced-purchase/post
    approach = this.#resolveChoice(approach, PURCHASE_APPROACH_MAP)
    purchaseType = this.#resolveChoice(purchaseType, PURCHASE_TYPE_MAP)
    taxCalculation = this.#resolveChoice(taxCalculation, TAX_CALCULATION_MAP)
    const body = {
      SupplierID: supplierId,
      TaxRule: taxRule,
      Location: location,
      CurrencyRate: currencyRate === undefined ? 1 : currencyRate,
      Approach: approach,
      PurchaseType: purchaseType,
      TaxCalculation: taxCalculation,
      Terms: terms,
      BlindReceipt: blindReceipt,
      RequiredBy: this.#isoDate(requiredBy),
      Note: note || '',
    }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/advanced-purchase`, method: 'post', body, logTag: 'createPurchase' })
  }

  /**
   * @operationName Set Purchase Order
   * @category Purchases
   * @description Creates or updates the order stage of a purchase with its line items. Authorise to send the PO. Supply the purchase ID from Create Purchase.
   * @route POST /set-purchase-order
   * @paramDef {"type":"String","label":"Purchase","name":"taskId","dictionary":"getPurchasesDictionary","required":true,"description":"The purchase (from Create Purchase) to set the order on."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Authorised"]}},"description":"Authorise to send the PO."}
   * @paramDef {"type":"String","label":"Memo","name":"memo","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Order memo."}
   * @paramDef {"type":"Array<Object>","label":"Order lines","name":"lines","required":true,"schemaLoader":"purchaseOrderLineSchema","description":"Products to order (product, quantity, price, tax rule)."}
   * @returns {Object}
   * @sampleResult {"TaskID":"02b08cd2-51d2-41e6-ab97-85bcd13e7136","Status":"AUTHORISED","Total":9}
   */
  async upsertPurchaseOrder(taskId, status, memo, lines) {
    this.#require({ Purchase: taskId, Status: status })
    this.#requireLines(lines, 'Order lines')
    // docs: https://dearinventory.docs.apiary.io/#reference/purchase/purchase-order/post
    status = this.#resolveChoice(status, DRAFT_AUTHORISED_MAP)
    const body = {
      TaskID: taskId,
      CombineAdditionalCharges: false,
      Memo: memo || '',
      Status: status,
      Lines: this.#purchaseLineBody(lines),
    }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/purchase/order`, method: 'post', body, logTag: 'upsertPurchaseOrder' })
  }

  /**
   * @operationName Set Purchase Stock Received
   * @category Purchases
   * @description Creates or updates the stock-received stage of a purchase with the received lines. Authorise to confirm goods received. Supply the purchase ID. The order must be authorised first.
   * @route POST /set-purchase-stock-received
   * @paramDef {"type":"String","label":"Purchase","name":"taskId","dictionary":"getPurchasesDictionary","required":true,"description":"The purchase to receive stock against."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Authorised"]}},"description":"Authorise to confirm goods received."}
   * @paramDef {"type":"Array<Object>","label":"Received lines","name":"lines","required":true,"schemaLoader":"stockReceivedLineSchema","description":"Products, quantities, locations received."}
   * @returns {Object}
   * @sampleResult {"TaskID":"02b08cd2-51d2-41e6-ab97-85bcd13e7136","Status":"DRAFT","Lines":[{"ProductID":"c08b3876-89cc-46c4-af52-b77f058fdf81","Quantity":3,"Received":true}]}
   */
  async upsertPurchaseStockReceived(taskId, status, lines) {
    this.#require({ Purchase: taskId, Status: status })
    this.#requireLines(lines, 'Received lines')
    // docs: https://dearinventory.docs.apiary.io/#reference/purchase/purchase-stock-received/post
    status = this.#resolveChoice(status, DRAFT_AUTHORISED_MAP)
    const body = {
      TaskID: taskId,
      Status: status,
      Lines: (Array.isArray(lines) ? lines : []).map(l => ({
        Date: this.#isoDate(l.date),
        Quantity: l.quantity,
        ProductID: l.productId,
        Location: l.location,
        LocationID: l.locationId,
        BatchSN: l.batchSN,
        ExpiryDate: this.#isoDate(l.expiryDate),
      })),
    }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/purchase/stock`, method: 'post', body, logTag: 'upsertPurchaseStockReceived' })
  }

  /**
   * @operationName Set Purchase Invoice
   * @category Purchases
   * @description Creates or updates the invoice stage of a purchase with its line items. Authorise to record the supplier invoice. Supply the purchase ID. The order must be authorised first.
   * @route POST /set-purchase-invoice
   * @paramDef {"type":"String","label":"Purchase","name":"taskId","dictionary":"getPurchasesDictionary","required":true,"description":"The purchase to invoice."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Authorised"]}},"description":"Authorise to record the supplier invoice."}
   * @paramDef {"type":"String","label":"Invoice number","name":"invoiceNumber","description":"Supplier's invoice number."}
   * @paramDef {"type":"String","label":"Invoice date","name":"invoiceDate","uiComponent":{"type":"DATE_PICKER"},"description":"Defaults to today."}
   * @paramDef {"type":"String","label":"Due date","name":"invoiceDueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Payment due date."}
   * @paramDef {"type":"Array<Object>","label":"Invoice lines","name":"lines","required":true,"schemaLoader":"purchaseInvoiceLineSchema","description":"Products/charges on the supplier invoice."}
   * @returns {Object}
   * @sampleResult {"TaskID":"02b08cd2-51d2-41e6-ab97-85bcd13e7136","Status":"AUTHORISED","Total":9}
   */
  async upsertPurchaseInvoice(taskId, status, invoiceNumber, invoiceDate, invoiceDueDate, lines) {
    this.#require({ Purchase: taskId, Status: status })
    this.#requireLines(lines, 'Invoice lines')
    // docs: https://dearinventory.docs.apiary.io/#reference/purchase/purchase-invoice/post
    status = this.#resolveChoice(status, DRAFT_AUTHORISED_MAP)
    const body = {
      TaskID: taskId,
      CombineAdditionalCharges: false,
      InvoiceNumber: invoiceNumber,
      InvoiceDate: this.#isoDate(invoiceDate),
      InvoiceDueDate: this.#isoDate(invoiceDueDate),
      Status: status,
      Lines: this.#purchaseLineBody(lines),
    }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/purchase/invoice`, method: 'post', body, logTag: 'upsertPurchaseInvoice' })
  }

  /**
   * @operationName Create Purchase Payment
   * @category Purchases
   * @description Records a supplier payment, prepayment or refund against a purchase. Supply the purchase ID, the amount and the bank/payment account.
   * @route POST /create-purchase-payment
   * @paramDef {"type":"String","label":"Purchase","name":"taskId","dictionary":"getPurchasesDictionary","required":true,"description":"The purchase to pay against."}
   * @paramDef {"type":"String","label":"Payment type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Payment","Prepayment","Refund"]}},"description":"Payment, Prepayment, or Refund."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Amount paid."}
   * @paramDef {"type":"String","label":"Date paid","name":"datePaid","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"When the payment was made."}
   * @paramDef {"type":"String","label":"Bank/payment account","name":"account","dictionary":"getAccountsDictionary","required":true,"description":"Account code money is paid from."}
   * @paramDef {"type":"Number","label":"Currency rate","name":"currencyRate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Rate vs base currency; leave 1 for same-currency."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"Payment reference."}
   * @returns {Object}
   * @sampleResult {"TaskID":"02b08cd2-51d2-41e6-ab97-85bcd13e7136","ID":"d3d96860-648f-462a-9e19-eb61e03da136","Type":"Payment","Amount":1,"Account":"718"}
   */
  async createPurchasePayment(taskId, type, amount, datePaid, account, currencyRate, reference) {
    this.#require({ Purchase: taskId, 'Payment type': type, Amount: amount, 'Date paid': datePaid, 'Bank/payment account': account })
    // docs: https://dearinventory.docs.apiary.io/#reference/purchase/purchase-payments/post
    type = this.#resolveChoice(type, PAYMENT_TYPE_MAP)
    const body = {
      TaskID: taskId,
      Type: type,
      Reference: reference || '',
      Amount: amount,
      DatePaid: this.#isoDate(datePaid),
      Account: account,
      CurrencyRate: currencyRate === undefined ? 1 : currencyRate,
    }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/purchase/payment`, method: 'post', body, logTag: 'createPurchasePayment' })
  }

  /**
   * @operationName Update Purchase Payment
   * @category Purchases
   * @description Updates an existing purchase payment by its payment ID. Use this to correct an amount, account or date.
   * @route POST /update-purchase-payment
   * @paramDef {"type":"String","label":"Payment ID","name":"id","required":true,"description":"The purchase payment ID to update."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New amount."}
   * @paramDef {"type":"String","label":"Date paid","name":"datePaid","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"New payment date."}
   * @paramDef {"type":"String","label":"Bank/payment account","name":"account","dictionary":"getAccountsDictionary","required":true,"description":"Account code money is paid from."}
   * @paramDef {"type":"Number","label":"Currency rate","name":"currencyRate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Rate vs base currency; leave 1 for same-currency."}
   * @returns {Object}
   * @sampleResult {"ID":"d3d96860-648f-462a-9e19-eb61e03da136","Amount":2,"Account":"718"}
   */
  async updatePurchasePayment(id, amount, datePaid, account, currencyRate) {
    this.#require({ 'Payment ID': id, Amount: amount, 'Date paid': datePaid, 'Bank/payment account': account })
    // docs: https://dearinventory.docs.apiary.io/#reference/purchase/purchase-payments  (PUT requires ID)
    const body = {
      ID: id,
      Amount: amount,
      DatePaid: this.#isoDate(datePaid),
      Account: account,
      CurrencyRate: currencyRate === undefined ? 1 : currencyRate,
    }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/purchase/payment`, method: 'put', body, logTag: 'updatePurchasePayment' })
  }

  /**
   * @operationName Delete Purchase Payment
   * @category Purchases
   * @description Deletes a purchase payment by its payment ID. This cannot be undone.
   * @route POST /delete-purchase-payment
   * @paramDef {"type":"String","label":"Payment ID","name":"id","required":true,"description":"The purchase payment ID to delete."}
   * @returns {Object}
   * @sampleResult {"Success":true}
   */
  async deletePurchasePayment(id) {
    this.#require({ 'Payment ID': id })
    // docs: https://dearinventory.docs.apiary.io/#reference/purchase/purchase-payments  (DELETE ?ID={ID})
    await this.#apiRequest({ url: `${ API_BASE_URL }/purchase/payment`, method: 'delete', query: { ID: id, DeleteAllocation: 'true' }, logTag: 'deletePurchasePayment' })

    return { Success: true }
  }

  /**
   * @operationName Void Purchase
   * @category Purchases
   * @description Voids an entire purchase. Pick the purchase from the dropdown. This cannot be undone.
   * @route POST /void-purchase
   * @paramDef {"type":"String","label":"Purchase","name":"id","dictionary":"getPurchasesDictionary","required":true,"description":"The purchase to void."}
   * @returns {Object}
   * @sampleResult {"Success":true}
   */
  async voidPurchase(id) {
    this.#require({ Purchase: id })
    // docs: https://dearinventory.docs.apiary.io/#reference/purchase/advanced-purchase  (DELETE /advanced-purchase?ID&Void=true)
    await this.#apiRequest({ url: `${ API_BASE_URL }/advanced-purchase`, method: 'delete', query: { ID: id, Void: 'true' }, logTag: 'voidPurchase' })

    return { Success: true }
  }

  // ==========================================================================
  //  STOCK - Adjustment
  // ==========================================================================
  #adjustmentBody(effectiveDate, status, account, reference, comment, updateOnHand, lines) {
    return {
      EffectiveDate: this.#isoDate(effectiveDate),
      Status: status,
      Account: account,
      Reference: reference,
      Comment: comment,
      UpdateOnHand: updateOnHand,
      Lines: (Array.isArray(lines) ? lines : []).map(l => ({
        ProductID: l.productId,
        Quantity: l.quantity,
        UnitCost: l.unitCost,
        LocationID: l.locationId,
        BatchSN: l.batchSN,
        ExpiryDate: this.#isoDate(l.expiryDate),
        ReceivedDate: this.#isoDate(l.receivedDate),
        Comments: l.comments,
      })),
    }
  }

  /**
   * @operationName List Stock Adjustments
   * @category Stock
   * @description Lists stock adjustments. Auto-pages. Use this to browse adjustments or find one to update or void.
   * @route POST /list-stock-adjustments
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Completed","Voided"]}},"description":"Filter by status."}
   * @paramDef {"type":"Number","label":"Max per page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page 1-1000; auto-pages. Default 100."}
   * @returns {Object}
   * @sampleResult {"Total":1,"Page":1,"StockAdjustmentList":[{"TaskID":"107e8ba9-418c-4233-bf80-369036867144","StocktakeNumber":"ST-00024","Status":"DRAFT","EffectiveDate":"2017-12-01T00:00:00"}]}
   */
  async listStockAdjustments(status, limit) {
    status = this.#resolveChoice(status, ADJUSTMENT_STATUS_FILTER_MAP)

    return await this.#listAll({ url: `${ API_BASE_URL }/stockadjustmentList`, query: { Status: status || undefined }, collection: 'StockAdjustmentList', limit, logTag: 'listStockAdjustments' })
  }

  /**
   * @operationName Get Stock Adjustment
   * @category Stock
   * @description Retrieves a single stock adjustment by its task ID, including the existing and new stock lines.
   * @route POST /get-stock-adjustment
   * @paramDef {"type":"String","label":"Stock adjustment","name":"taskId","dictionary":"getStockAdjustmentsDictionary","required":true,"description":"The stock adjustment to fetch."}
   * @returns {Object}
   * @sampleResult {"TaskID":"107e8ba9-418c-4233-bf80-369036867144","StocktakeNumber":"ST-00024","Status":"DRAFT","ExistingStockLines":[{"ProductID":"1845a9cd-e523-4a69-993b-d35f5ec31fb8","Adjustment":600}]}
   */
  async getStockAdjustment(taskId) {
    return await this.#apiRequest({ url: `${ API_BASE_URL }/stockadjustment`, query: { TaskID: taskId }, logTag: 'getStockAdjustment' })
  }

  /**
   * @operationName Create Stock Adjustment
   * @category Stock
   * @description Creates a stock adjustment to increase or decrease on-hand quantities and costs. Set the effective date, status and lines (product, quantity, unit cost, location). Set status to Completed to post it immediately.
   * @route POST /create-stock-adjustment
   * @paramDef {"type":"String","label":"Effective date","name":"effectiveDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Date the adjustment takes effect."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Completed"]}},"description":"Completed posts the adjustment immediately."}
   * @paramDef {"type":"String","label":"Adjustment account","name":"account","dictionary":"getAccountsDictionary","description":"Expense account for the adjustment."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"Custom reference."}
   * @paramDef {"type":"String","label":"Comment","name":"comment","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Notes."}
   * @paramDef {"type":"Boolean","label":"Adjust on-hand","name":"updateOnHand","uiComponent":{"type":"TOGGLE"},"description":"On = change physical on-hand; Off = change available quantity."}
   * @paramDef {"type":"Array<Object>","label":"Adjustment lines","name":"lines","required":true,"schemaLoader":"stockAdjustmentLineSchema","description":"Each: product, quantity, unit cost, location."}
   * @returns {Object}
   * @sampleResult {"TaskID":"107e8ba9-418c-4233-bf80-369036867144","StocktakeNumber":"ST-00024","Status":"DRAFT"}
   */
  async createStockAdjustment(effectiveDate, status, account, reference, comment, updateOnHand, lines) {
    this.#require({ 'Effective date': effectiveDate, Status: status })
    this.#requireLines(lines, 'Adjustment lines')
    // docs: https://dearinventory.docs.apiary.io/#reference/stock/stock-adjustment/post
    status = this.#resolveChoice(status, DRAFT_COMPLETED_MAP)
    const body = this.#adjustmentBody(effectiveDate, status, account, reference, comment, updateOnHand, lines)

    return await this.#apiRequest({ url: `${ API_BASE_URL }/stockadjustment`, method: 'post', body, logTag: 'createStockAdjustment' })
  }

  /**
   * @operationName Update Stock Adjustment
   * @category Stock
   * @description Updates an existing stock adjustment by its task ID. Use this to amend lines or complete a draft.
   * @route POST /update-stock-adjustment
   * @paramDef {"type":"String","label":"Stock adjustment","name":"taskId","dictionary":"getStockAdjustmentsDictionary","required":true,"description":"The stock adjustment to update."}
   * @paramDef {"type":"String","label":"Effective date","name":"effectiveDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Date the adjustment takes effect."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Completed"]}},"description":"Completed posts the adjustment."}
   * @paramDef {"type":"String","label":"Adjustment account","name":"account","dictionary":"getAccountsDictionary","description":"Expense account for the adjustment."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"Custom reference."}
   * @paramDef {"type":"String","label":"Comment","name":"comment","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Notes."}
   * @paramDef {"type":"Boolean","label":"Adjust on-hand","name":"updateOnHand","uiComponent":{"type":"TOGGLE"},"description":"On = change physical on-hand; Off = change available quantity."}
   * @paramDef {"type":"Array<Object>","label":"Adjustment lines","name":"lines","required":true,"schemaLoader":"stockAdjustmentLineSchema","description":"Each: product, quantity, unit cost, location."}
   * @returns {Object}
   * @sampleResult {"TaskID":"107e8ba9-418c-4233-bf80-369036867144","Status":"COMPLETED"}
   */
  async updateStockAdjustment(taskId, effectiveDate, status, account, reference, comment, updateOnHand, lines) {
    this.#require({ 'Stock adjustment': taskId, 'Effective date': effectiveDate, Status: status })
    this.#requireLines(lines, 'Adjustment lines')
    // docs: https://dearinventory.docs.apiary.io/#reference/stock/stock-adjustment  (PUT requires TaskID; body mirrors POST)
    status = this.#resolveChoice(status, DRAFT_COMPLETED_MAP)
    const body = { TaskID: taskId, ...this.#adjustmentBody(effectiveDate, status, account, reference, comment, updateOnHand, lines) }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/stockadjustment`, method: 'put', body, logTag: 'updateStockAdjustment' })
  }

  /**
   * @operationName Void Stock Adjustment
   * @category Stock
   * @description Voids a stock adjustment by its task ID. This cannot be undone.
   * @route POST /void-stock-adjustment
   * @paramDef {"type":"String","label":"Stock adjustment","name":"id","dictionary":"getStockAdjustmentsDictionary","required":true,"description":"The stock adjustment to void — pick one from the list, or paste its TaskID."}
   * @returns {Object}
   * @sampleResult {"Success":true}
   */
  async voidStockAdjustment(id) {
    this.#require({ 'Stock adjustment': id })
    // docs: https://dearinventory.docs.apiary.io/#reference/stock/stock-adjustment  (DELETE ?ID&Void=true)
    await this.#apiRequest({ url: `${ API_BASE_URL }/stockadjustment`, method: 'delete', query: { ID: id, Void: 'true' }, logTag: 'voidStockAdjustment' })

    return { Success: true }
  }

  // ==========================================================================
  //  STOCK - Transfer
  // ==========================================================================
  #transferBody(fromLocationId, toLocationId, status, completionDate, inTransitAccount, departureDate, costDistributionType, reference, lines) {
    return {
      From: fromLocationId,
      To: toLocationId,
      Status: status,
      CompletionDate: this.#isoDate(completionDate),
      InTransitAccount: inTransitAccount,
      DepartureDate: this.#isoDate(departureDate),
      CostDistributionType: costDistributionType,
      Reference: reference,
      SkipOrder: true,
      Lines: (Array.isArray(lines) ? lines : []).map(l => ({
        ProductID: l.productId,
        TransferQuantity: l.transferQuantity,
        BatchSN: l.batchSN,
        ExpiryDate: this.#isoDate(l.expiryDate),
        Comments: l.comments,
      })),
    }
  }

  /**
   * @operationName List Stock Transfers
   * @category Stock
   * @description Lists stock transfers between locations. Auto-pages.
   * @route POST /list-stock-transfers
   * @paramDef {"type":"Number","label":"Max per page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page 1-1000; auto-pages. Default 100."}
   * @returns {Object}
   * @sampleResult {"Total":1,"Page":1,"StockTransferList":[{"TaskID":"d144d7c8-b3f8-4b43-9d64-d6ee948606a2","Number":"TR-00006","Status":"DRAFT","FromLocation":"Main Warehouse","ToLocation":"Main Warehouse: Bin 1"}]}
   */
  async listStockTransfers(limit) {
    return await this.#listAll({ url: `${ API_BASE_URL }/stockTransferList`, query: {}, collection: 'StockTransferList', limit, logTag: 'listStockTransfers' })
  }

  /**
   * @operationName Get Stock Transfer
   * @category Stock
   * @description Retrieves a single stock transfer by its task ID.
   * @route POST /get-stock-transfer
   * @paramDef {"type":"String","label":"Stock transfer","name":"taskId","dictionary":"getStockTransfersDictionary","required":true,"description":"The stock transfer to fetch."}
   * @returns {Object}
   * @sampleResult {"TaskID":"d144d7c8-b3f8-4b43-9d64-d6ee948606a2","Number":"TR-00006","Status":"DRAFT","From":"cd3ed3bb-673a-4d48-b47b-5f92a973ae8c","To":"284a6935-d54a-40f6-b91d-c707604d5bec"}
   */
  async getStockTransfer(taskId) {
    return await this.#apiRequest({ url: `${ API_BASE_URL }/stockTransfer`, query: { TaskID: taskId }, logTag: 'getStockTransfer' })
  }

  /**
   * @operationName Create Stock Transfer
   * @category Stock
   * @description Moves stock between two locations. Pick the source and destination locations, set the completion date and the lines (product and quantity). Set status to Completed to post the transfer.
   * @route POST /create-stock-transfer
   * @paramDef {"type":"String","label":"From location","name":"fromLocationId","dictionary":"getLocationsDictionary","required":true,"description":"Source warehouse to move stock out of."}
   * @paramDef {"type":"String","label":"To location","name":"toLocationId","dictionary":"getLocationsDictionary","required":true,"description":"Destination warehouse to move stock into."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","In transit","Completed"]}},"description":"Completed posts the transfer."}
   * @paramDef {"type":"String","label":"Completion date","name":"completionDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Date of the transfer transaction."}
   * @paramDef {"type":"String","label":"In-transit account","name":"inTransitAccount","dictionary":"getAccountsDictionary","description":"Asset account holding value while in transit (required only for In transit status)."}
   * @paramDef {"type":"String","label":"Departure date","name":"departureDate","uiComponent":{"type":"DATE_PICKER"},"description":"When stock left (required only for In transit status)."}
   * @paramDef {"type":"String","label":"Cost distribution","name":"costDistributionType","uiComponent":{"type":"DROPDOWN","options":{"values":["By cost","By quantity","By weight","By volume"]}},"description":"How additional costs are spread across lines."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"Custom reference."}
   * @paramDef {"type":"Array<Object>","label":"Transfer lines","name":"lines","required":true,"schemaLoader":"stockTransferLineSchema","description":"Each: product and transfer quantity."}
   * @returns {Object}
   * @sampleResult {"TaskID":"d144d7c8-b3f8-4b43-9d64-d6ee948606a2","Number":"TR-00006","Status":"DRAFT","FromLocation":"Main Warehouse","ToLocation":"Main Warehouse: Bin 1"}
   */
  async createStockTransfer(fromLocationId, toLocationId, status, completionDate, inTransitAccount, departureDate, costDistributionType, reference, lines) {
    this.#require({ 'From location': fromLocationId, 'To location': toLocationId, Status: status, 'Completion date': completionDate })
    this.#requireLines(lines, 'Transfer lines')
    // docs: https://dearinventory.docs.apiary.io/#reference/stock/stock-transfer/post
    status = this.#resolveChoice(status, TRANSFER_STATUS_MAP)
    costDistributionType = this.#resolveChoice(costDistributionType, COST_DISTRIBUTION_MAP)
    const body = this.#transferBody(fromLocationId, toLocationId, status, completionDate, inTransitAccount, departureDate, costDistributionType, reference, lines)

    return await this.#apiRequest({ url: `${ API_BASE_URL }/stockTransfer`, method: 'post', body, logTag: 'createStockTransfer' })
  }

  /**
   * @operationName Update Stock Transfer
   * @category Stock
   * @description Updates an existing stock transfer by its task ID. Use this to amend lines or complete a draft.
   * @route POST /update-stock-transfer
   * @paramDef {"type":"String","label":"Stock transfer","name":"taskId","dictionary":"getStockTransfersDictionary","required":true,"description":"The stock transfer to update."}
   * @paramDef {"type":"String","label":"From location","name":"fromLocationId","dictionary":"getLocationsDictionary","required":true,"description":"Source warehouse."}
   * @paramDef {"type":"String","label":"To location","name":"toLocationId","dictionary":"getLocationsDictionary","required":true,"description":"Destination warehouse."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","In transit","Completed"]}},"description":"Completed posts the transfer."}
   * @paramDef {"type":"String","label":"Completion date","name":"completionDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Date of the transfer transaction."}
   * @paramDef {"type":"String","label":"In-transit account","name":"inTransitAccount","dictionary":"getAccountsDictionary","description":"Asset account (required for In transit)."}
   * @paramDef {"type":"String","label":"Departure date","name":"departureDate","uiComponent":{"type":"DATE_PICKER"},"description":"When stock left (required for In transit)."}
   * @paramDef {"type":"String","label":"Cost distribution","name":"costDistributionType","uiComponent":{"type":"DROPDOWN","options":{"values":["By cost","By quantity","By weight","By volume"]}},"description":"How additional costs are spread across lines."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"Custom reference."}
   * @paramDef {"type":"Array<Object>","label":"Transfer lines","name":"lines","required":true,"schemaLoader":"stockTransferLineSchema","description":"Each: product and transfer quantity."}
   * @returns {Object}
   * @sampleResult {"TaskID":"d144d7c8-b3f8-4b43-9d64-d6ee948606a2","Status":"COMPLETED"}
   */
  async updateStockTransfer(taskId, fromLocationId, toLocationId, status, completionDate, inTransitAccount, departureDate, costDistributionType, reference, lines) {
    this.#require({ 'Stock transfer': taskId, 'From location': fromLocationId, 'To location': toLocationId, Status: status, 'Completion date': completionDate })
    this.#requireLines(lines, 'Transfer lines')
    // docs: https://dearinventory.docs.apiary.io/#reference/stock/stock-transfer  (PUT requires TaskID)
    status = this.#resolveChoice(status, TRANSFER_STATUS_MAP)
    costDistributionType = this.#resolveChoice(costDistributionType, COST_DISTRIBUTION_MAP)
    const body = { TaskID: taskId, ...this.#transferBody(fromLocationId, toLocationId, status, completionDate, inTransitAccount, departureDate, costDistributionType, reference, lines) }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/stockTransfer`, method: 'put', body, logTag: 'updateStockTransfer' })
  }

  /**
   * @operationName Void Stock Transfer
   * @category Stock
   * @description Voids a stock transfer by its task ID. This cannot be undone.
   * @route POST /void-stock-transfer
   * @paramDef {"type":"String","label":"Stock transfer","name":"id","dictionary":"getStockTransfersDictionary","required":true,"description":"The stock transfer to void — pick one from the list, or paste its TaskID."}
   * @returns {Object}
   * @sampleResult {"Success":true}
   */
  async voidStockTransfer(id) {
    this.#require({ 'Stock transfer': id })
    // docs: https://dearinventory.docs.apiary.io/#reference/stock/stock-transfer  (DELETE ?ID&Void=true)
    await this.#apiRequest({ url: `${ API_BASE_URL }/stockTransfer`, method: 'delete', query: { ID: id, Void: 'true' }, logTag: 'voidStockTransfer' })

    return { Success: true }
  }

  // ==========================================================================
  //  STOCK - Take
  // ==========================================================================
  /**
   * @operationName List Stock Takes
   * @category Stock
   * @description Lists stock takes (physical counts). Auto-pages.
   * @route POST /list-stock-takes
   * @paramDef {"type":"Number","label":"Max per page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page 1-1000; auto-pages. Default 100."}
   * @returns {Object}
   * @sampleResult {"Total":1,"Page":1,"StockTakeList":[{"TaskID":"107e8ba9-418c-4233-bf80-369036867144","StocktakeNumber":"ST-00030","Status":"DRAFT"}]}
   */
  async listStockTakes(limit) {
    return await this.#listAll({ url: `${ API_BASE_URL }/stockTakeList`, query: {}, collection: 'StockTakeList', limit, logTag: 'listStockTakes' })
  }

  /**
   * @operationName Get Stock Take
   * @category Stock
   * @description Retrieves a single stock take by its task ID, including the current stock-on-hand product lines to count.
   * @route POST /get-stock-take
   * @paramDef {"type":"String","label":"Stock take","name":"taskId","dictionary":"getStockTakesDictionary","required":true,"description":"The stock take to fetch."}
   * @returns {Object}
   * @sampleResult {"TaskID":"107e8ba9-418c-4233-bf80-369036867144","StocktakeNumber":"ST-00030","Status":"IN PROGRESS","NonZeroStockOnHandProducts":[{"ProductID":"c08b3876-89cc-46c4-af52-b77f058fdf81","QuantityOnHand":50,"Adjustment":0}]}
   */
  async getStockTake(taskId) {
    return await this.#apiRequest({ url: `${ API_BASE_URL }/stocktake`, query: { TaskID: taskId }, logTag: 'getStockTake' })
  }

  /**
   * @operationName Create Stock Take
   * @category Stock
   * @description Starts a stock take (physical count) at a location. Cin7 auto-fills the current stock lines for the chosen location. Set the effective date, status, adjustment account and location, then use Update Stock Take to enter counts and complete it.
   * @route POST /create-stock-take
   * @paramDef {"type":"String","label":"Effective date","name":"effectiveDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Date of the stocktake."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","In progress"]}},"description":"Start the stocktake; Cin7 auto-fills current stock lines for the location."}
   * @paramDef {"type":"String","label":"Adjustment account","name":"account","dictionary":"getAccountsDictionary","required":true,"description":"Expense account for any adjustment."}
   * @paramDef {"type":"String","label":"Location","name":"locationId","dictionary":"getLocationsDictionary","required":true,"description":"Warehouse to count."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"Custom reference."}
   * @paramDef {"type":"Boolean","label":"Include zero-stock products","name":"useRelativeQuantity","uiComponent":{"type":"TOGGLE"},"description":"On = include products with zero stock in the count."}
   * @returns {Object}
   * @sampleResult {"TaskID":"107e8ba9-418c-4233-bf80-369036867144","StocktakeNumber":"ST-00030","Status":"IN PROGRESS"}
   */
  async createStockTake(effectiveDate, status, account, locationId, reference, useRelativeQuantity) {
    this.#require({ 'Effective date': effectiveDate, Status: status, 'Adjustment account': account, Location: locationId })
    // docs: https://dearinventory.docs.apiary.io/#reference/stock/stock-take  (required: EffectiveDate, Status, Account, LocationID)
    status = this.#resolveChoice(status, STOCKTAKE_START_MAP)
    const body = {
      EffectiveDate: this.#isoDate(effectiveDate),
      Status: status,
      Account: account,
      LocationID: locationId,
      Reference: reference,
      UseRelativeQuantity: useRelativeQuantity,
    }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/stocktake`, method: 'post', body, logTag: 'createStockTake' })
  }

  /**
   * @operationName Update Stock Take
   * @category Stock
   * @description Updates a stock take by its task ID: enter the counted adjustment per line and move it from In progress to Completed to post the resulting inventory adjustment.
   * @route POST /update-stock-take
   * @paramDef {"type":"String","label":"Stock take","name":"taskId","dictionary":"getStockTakesDictionary","required":true,"description":"The stock take to update (set counts or complete it)."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["In progress","Completed"]}},"description":"Completed posts the resulting adjustment."}
   * @paramDef {"type":"Array<Object>","label":"Counted lines","name":"lines","schemaLoader":"stockTakeLineSchema","description":"Per product/location/batch: the counted Adjustment value."}
   * @returns {Object}
   * @sampleResult {"TaskID":"107e8ba9-418c-4233-bf80-369036867144","Status":"COMPLETED"}
   */
  async updateStockTake(taskId, status, lines) {
    this.#require({ 'Stock take': taskId, Status: status })
    // docs: https://dearinventory.docs.apiary.io/#reference/stock/stock-take  (PUT moves DRAFT->IN PROGRESS->COMPLETED with line Adjustments)
    status = this.#resolveChoice(status, STOCKTAKE_COMPLETE_MAP)
    const body = {
      TaskID: taskId,
      Status: status,
      Lines: (Array.isArray(lines) ? lines : []).map(l => ({
        ProductID: l.productId,
        LocationID: l.locationId,
        Adjustment: l.adjustment,
        BatchSN: l.batchSN,
        ExpiryDate: this.#isoDate(l.expiryDate),
      })),
    }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/stocktake`, method: 'put', body, logTag: 'updateStockTake' })
  }

  /**
   * @operationName Void Stock Take
   * @category Stock
   * @description Voids a stock take by its task ID. This cannot be undone.
   * @route POST /void-stock-take
   * @paramDef {"type":"String","label":"Stock take","name":"id","dictionary":"getStockTakesDictionary","required":true,"description":"The stock take to void — pick one from the list, or paste its TaskID."}
   * @returns {Object}
   * @sampleResult {"Success":true}
   */
  async voidStockTake(id) {
    this.#require({ 'Stock take': id })
    // docs: https://dearinventory.docs.apiary.io/#reference/stock/stock-take  (DELETE ?ID&Void=true)
    await this.#apiRequest({ url: `${ API_BASE_URL }/stocktake`, method: 'delete', query: { ID: id, Void: 'true' }, logTag: 'voidStockTake' })

    return { Success: true }
  }

  // ==========================================================================
  //  LOCATIONS
  // ==========================================================================
  #locationBody(name, addressLine1, addressLine2, addressCitySuburb, addressStateProvince, addressZipPostCode, addressCountry) {
    return {
      Name: name,
      AddressLine1: addressLine1,
      AddressLine2: addressLine2,
      AddressCitySuburb: addressCitySuburb,
      AddressStateProvince: addressStateProvince,
      AddressZipPostCode: addressZipPostCode,
      AddressCountry: addressCountry,
    }
  }

  /**
   * @operationName List Locations
   * @category Reference Data
   * @description Lists warehouse locations. Auto-pages. Use to browse locations or find one before assigning stock.
   * @route POST /list-locations
   * @paramDef {"type":"String","label":"Name starts with","name":"search","description":"Filter by name prefix. Blank for all."}
   * @paramDef {"type":"Boolean","label":"Include deprecated","name":"deprecated","uiComponent":{"type":"TOGGLE"},"description":"Include deprecated locations."}
   * @paramDef {"type":"Number","label":"Max per page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page 1-1000; auto-pages. Default 100."}
   * @returns {Object}
   * @sampleResult {"Total":4,"Page":1,"LocationList":[{"ID":"aa4ab1cf-c989-45cd-8926-23d1edd6601e","Name":"Main Warehouse","IsDefault":true,"IsDeprecated":false}]}
   */
  async listLocations(search, deprecated, limit) {
    return await this.#listAll({ url: `${ API_BASE_URL }/ref/location`, query: { Name: search || undefined, Deprecated: deprecated ? 'true' : undefined }, collection: 'LocationList', limit, logTag: 'listLocations' })
  }

  /**
   * @operationName Get Location
   * @category Reference Data
   * @description Retrieves a single warehouse location by its ID, including its address. Pick the location from the dropdown.
   * @route POST /get-location
   * @paramDef {"type":"String","label":"Location","name":"locationId","dictionary":"getLocationsDictionary","required":true,"description":"The location to fetch."}
   * @returns {Object}
   * @sampleResult {"ID":"7e1e7cdc-eb4a-45d4-ae7f-e8999bb9dd8a","Name":"Test new location","IsDefault":false,"IsDeprecated":false}
   */
  async getLocation(locationId) {
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/ref/location`, query: { ID: locationId }, logTag: 'getLocation' })

    return (result && result.LocationList && result.LocationList[0]) || result
  }

  /**
   * @operationName Create Location
   * @category Reference Data
   * @description Creates a new warehouse location with an optional address.
   * @route POST /create-location
   * @paramDef {"type":"String","label":"Location name","name":"name","required":true,"description":"Unique warehouse/location name."}
   * @paramDef {"type":"String","label":"Address line 1","name":"addressLine1","description":"Street address."}
   * @paramDef {"type":"String","label":"Address line 2","name":"addressLine2","description":"Address line 2."}
   * @paramDef {"type":"String","label":"City","name":"addressCitySuburb","description":"City/suburb."}
   * @paramDef {"type":"String","label":"State","name":"addressStateProvince","description":"State/province."}
   * @paramDef {"type":"String","label":"Post code","name":"addressZipPostCode","description":"ZIP/postcode."}
   * @paramDef {"type":"String","label":"Country","name":"addressCountry","description":"Country."}
   * @returns {Object}
   * @sampleResult {"ID":"7e1e7cdc-eb4a-45d4-ae7f-e8999bb9dd8a","Name":"Test new location","IsDefault":false,"IsDeprecated":false}
   */
  async createLocation(name, addressLine1, addressLine2, addressCitySuburb, addressStateProvince, addressZipPostCode, addressCountry) {
    this.#require({ 'Location name': name })
    // docs: https://dearinventory.docs.apiary.io/#reference/location/location/post
    const body = this.#locationBody(name, addressLine1, addressLine2, addressCitySuburb, addressStateProvince, addressZipPostCode, addressCountry)

    return await this.#apiRequest({ url: `${ API_BASE_URL }/ref/location`, method: 'post', body, logTag: 'createLocation' })
  }

  /**
   * @operationName Update Location
   * @category Reference Data
   * @description Updates an existing warehouse location's name and address.
   * @route POST /update-location
   * @paramDef {"type":"String","label":"Location","name":"id","dictionary":"getLocationsDictionary","required":true,"description":"The location to update."}
   * @paramDef {"type":"String","label":"Location name","name":"name","required":true,"description":"Unique warehouse/location name."}
   * @paramDef {"type":"String","label":"Address line 1","name":"addressLine1","description":"Street address."}
   * @paramDef {"type":"String","label":"Address line 2","name":"addressLine2","description":"Address line 2."}
   * @paramDef {"type":"String","label":"City","name":"addressCitySuburb","description":"City/suburb."}
   * @paramDef {"type":"String","label":"State","name":"addressStateProvince","description":"State/province."}
   * @paramDef {"type":"String","label":"Post code","name":"addressZipPostCode","description":"ZIP/postcode."}
   * @paramDef {"type":"String","label":"Country","name":"addressCountry","description":"Country."}
   * @returns {Object}
   * @sampleResult {"ID":"7e1e7cdc-eb4a-45d4-ae7f-e8999bb9dd8a","Name":"Test new location v2"}
   */
  async updateLocation(id, name, addressLine1, addressLine2, addressCitySuburb, addressStateProvince, addressZipPostCode, addressCountry) {
    this.#require({ Location: id, 'Location name': name })
    // docs: https://dearinventory.docs.apiary.io/#reference/location/location  (PUT requires ID)
    const body = { ID: id, ...this.#locationBody(name, addressLine1, addressLine2, addressCitySuburb, addressStateProvince, addressZipPostCode, addressCountry) }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/ref/location`, method: 'put', body, logTag: 'updateLocation' })
  }

  /**
   * @operationName Delete Location
   * @category Reference Data
   * @description Permanently deletes a warehouse location. This cannot be undone.
   * @route POST /delete-location
   * @paramDef {"type":"String","label":"Location","name":"id","dictionary":"getLocationsDictionary","required":true,"description":"The location to delete."}
   * @returns {Object}
   * @sampleResult {"Success":true}
   */
  async deleteLocation(id) {
    this.#require({ Location: id })
    await this.#apiRequest({ url: `${ API_BASE_URL }/ref/location`, method: 'delete', query: { ID: id }, logTag: 'deleteLocation' })

    return { Success: true }
  }

  // ==========================================================================
  //  PRICE TIERS / PAYMENT TERMS / TAX RULES / CARRIERS / ACCOUNTS
  // ==========================================================================
  /**
   * @operationName List Price Tiers
   * @category Reference Data
   * @description Lists the 10 fixed price tiers and their names. Read-only reference.
   * @route POST /list-price-tiers
   * @returns {Object}
   * @sampleResult {"PriceTiers":[{"Code":1,"Name":"Tier 1"},{"Code":2,"Name":"Tier 2"}]}
   */
  async listPriceTiers() {
    return await this.#apiRequest({ url: `${ API_BASE_URL }/ref/priceTier`, logTag: 'listPriceTiers' })
  }

  /**
   * @operationName List Payment Terms
   * @category Reference Data
   * @description Lists payment terms. Auto-pages.
   * @route POST /list-payment-terms
   * @paramDef {"type":"String","label":"Name starts with","name":"search","description":"Filter by name prefix. Blank for all."}
   * @paramDef {"type":"Boolean","label":"Active only","name":"isActive","uiComponent":{"type":"TOGGLE"},"description":"Only return active terms."}
   * @paramDef {"type":"Number","label":"Max per page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page 1-1000; auto-pages. Default 100."}
   * @returns {Object}
   * @sampleResult {"Total":3,"Page":1,"PaymentTermList":[{"ID":"927a7013-e1d9-4194-a547-28b1b4c6b413","Name":"30 days","Duration":30,"Method":"number of days","IsActive":true,"IsDefault":false}]}
   */
  async listPaymentTerms(search, isActive, limit) {
    return await this.#listAll({ url: `${ API_BASE_URL }/ref/paymentterm`, query: { Name: search || undefined, IsActive: isActive ? 'true' : undefined }, collection: 'PaymentTermList', limit, logTag: 'listPaymentTerms' })
  }

  /**
   * @operationName Create Payment Term
   * @category Reference Data
   * @description Creates a new payment term (e.g. "30 days", "Days since end of month").
   * @route POST /create-payment-term
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Payment term name."}
   * @paramDef {"type":"Number","label":"Duration (days)","name":"duration","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of days."}
   * @paramDef {"type":"String","label":"Method","name":"method","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Number of days","Days since end of month","Last day of next month"]}},"description":"How the due date is calculated."}
   * @paramDef {"type":"Boolean","label":"Active","name":"isActive","uiComponent":{"type":"TOGGLE"},"description":"Whether the term is selectable."}
   * @paramDef {"type":"Boolean","label":"Default","name":"isDefault","uiComponent":{"type":"TOGGLE"},"description":"Make this the default term."}
   * @returns {Object}
   * @sampleResult {"Total":1,"Page":1,"PaymentTermList":[{"ID":"e6c25fa9-bb14-45b2-afe7-428e454663ef","Name":"5 days since end of month","Duration":5,"Method":"days since the end of the month","IsActive":true}]}
   */
  async createPaymentTerm(name, duration, method, isActive, isDefault) {
    this.#require({ Name: name, 'Duration (days)': duration, Method: method })
    // docs: https://dearinventory.docs.apiary.io/#reference/payment-term/payment-term/post
    method = this.#resolveChoice(method, DUE_DATE_METHOD_MAP)
    const body = { Name: name, Duration: duration, Method: method, IsActive: isActive === undefined ? true : isActive, IsDefault: isDefault === undefined ? false : isDefault }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/ref/paymentterm`, method: 'post', body, logTag: 'createPaymentTerm' })
  }

  /**
   * @operationName Update Payment Term
   * @category Reference Data
   * @description Updates an existing payment term.
   * @route POST /update-payment-term
   * @paramDef {"type":"String","label":"Payment term","name":"id","dictionary":"getPaymentTermsByIdDictionary","required":true,"description":"The payment term to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Payment term name."}
   * @paramDef {"type":"Number","label":"Duration (days)","name":"duration","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of days."}
   * @paramDef {"type":"String","label":"Method","name":"method","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Number of days","Days since end of month","Last day of next month"]}},"description":"How the due date is calculated."}
   * @paramDef {"type":"Boolean","label":"Active","name":"isActive","uiComponent":{"type":"TOGGLE"},"description":"Whether the term is selectable."}
   * @paramDef {"type":"Boolean","label":"Default","name":"isDefault","uiComponent":{"type":"TOGGLE"},"description":"Make this the default term."}
   * @returns {Object}
   * @sampleResult {"Total":1,"Page":1,"PaymentTermList":[{"ID":"e6c25fa9-bb14-45b2-afe7-428e454663ef","Name":"5 days","Duration":5}]}
   */
  async updatePaymentTerm(id, name, duration, method, isActive, isDefault) {
    this.#require({ 'Payment term': id, Name: name, 'Duration (days)': duration, Method: method })
    // docs: https://dearinventory.docs.apiary.io/#reference/payment-term/payment-term  (PUT requires ID)
    method = this.#resolveChoice(method, DUE_DATE_METHOD_MAP)
    const body = { ID: id, Name: name, Duration: duration, Method: method, IsActive: isActive, IsDefault: isDefault }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/ref/paymentterm`, method: 'put', body, logTag: 'updatePaymentTerm' })
  }

  /**
   * @operationName Delete Payment Term
   * @category Reference Data
   * @description Permanently deletes a payment term. This cannot be undone.
   * @route POST /delete-payment-term
   * @paramDef {"type":"String","label":"Payment term","name":"id","dictionary":"getPaymentTermsByIdDictionary","required":true,"description":"The payment term to delete."}
   * @returns {Object}
   * @sampleResult {"Success":true}
   */
  async deletePaymentTerm(id) {
    this.#require({ 'Payment term': id })
    await this.#apiRequest({ url: `${ API_BASE_URL }/ref/paymentterm`, method: 'delete', query: { ID: id }, logTag: 'deletePaymentTerm' })

    return { Success: true }
  }

  /**
   * @operationName List Tax Rules
   * @category Reference Data
   * @description Lists tax rules (read-only), optionally filtered to sale or purchase rules. Auto-pages. Use this to find a tax rule name to pass into a sale, purchase or product.
   * @route POST /list-tax-rules
   * @paramDef {"type":"Boolean","label":"For sales","name":"isTaxForSale","uiComponent":{"type":"TOGGLE"},"description":"Only rules usable on sales."}
   * @paramDef {"type":"Boolean","label":"For purchases","name":"isTaxForPurchase","uiComponent":{"type":"TOGGLE"},"description":"Only rules usable on purchases."}
   * @paramDef {"type":"Boolean","label":"Active only","name":"isActive","uiComponent":{"type":"TOGGLE"},"description":"Only active rules."}
   * @paramDef {"type":"Number","label":"Max per page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page 1-1000; auto-pages. Default 100."}
   * @returns {Object}
   * @sampleResult {"Total":2,"Page":1,"TaxRuleList":[{"ID":"9d707beb-19cf-4d7b-a5d9-9eaff05c504c","Name":"GST on Income","TaxPercent":10,"IsTaxForSale":true,"IsTaxForPurchase":false,"IsActive":true}]}
   */
  async listTaxRules(isTaxForSale, isTaxForPurchase, isActive, limit) {
    return await this.#listAll({
      url: `${ API_BASE_URL }/ref/tax`,
      query: { IsTaxForSale: isTaxForSale ? 'true' : undefined, IsTaxForPurchase: isTaxForPurchase ? 'true' : undefined, IsActive: isActive ? 'true' : undefined },
      collection: 'TaxRuleList',
      limit,
      logTag: 'listTaxRules',
    })
  }

  /**
   * @operationName List Carriers
   * @category Reference Data
   * @description Lists shipping carriers. Auto-pages.
   * @route POST /list-carriers
   * @paramDef {"type":"String","label":"Description starts with","name":"search","description":"Filter by description prefix. Blank for all."}
   * @paramDef {"type":"Number","label":"Max per page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page 1-1000; auto-pages. Default 100."}
   * @returns {Object}
   * @sampleResult {"Total":1,"Page":1,"CarrierList":[{"CarrierID":"729cd659-c0ca-4a8a-9771-84539cd2e7e8","Description":"DEFAULT Carrier"}]}
   */
  async listCarriers(search, limit) {
    return await this.#listAll({ url: `${ API_BASE_URL }/ref/carrier`, query: { Description: search || undefined }, collection: 'CarrierList', limit, logTag: 'listCarriers' })
  }

  /**
   * @operationName Create Carrier
   * @category Reference Data
   * @description Creates a new shipping carrier.
   * @route POST /create-carrier
   * @paramDef {"type":"String","label":"Carrier name","name":"description","required":true,"description":"Carrier name/description."}
   * @returns {Object}
   * @sampleResult {"Total":1,"Page":1,"CarrierList":[{"CarrierID":"8a5697fa-4c0b-46a5-a5bf-1864cb76623f","Description":"NEW Carrier"}]}
   */
  async createCarrier(description) {
    this.#require({ 'Carrier name': description })

    // docs: https://dearinventory.docs.apiary.io/#reference/carrier/carrier/post  (POST body { "Description": "NEW Carrier" })
    return await this.#apiRequest({ url: `${ API_BASE_URL }/ref/carrier`, method: 'post', body: { Description: description }, logTag: 'createCarrier' })
  }

  /**
   * @operationName Update Carrier
   * @category Reference Data
   * @description Renames an existing carrier.
   * @route POST /update-carrier
   * @paramDef {"type":"String","label":"Carrier","name":"carrierId","dictionary":"getCarriersByIdDictionary","required":true,"description":"The carrier to rename."}
   * @paramDef {"type":"String","label":"Carrier name","name":"description","required":true,"description":"New carrier name/description."}
   * @returns {Object}
   * @sampleResult {"Total":1,"Page":1,"CarrierList":[{"CarrierID":"8a5697fa-4c0b-46a5-a5bf-1864cb76623f","Description":"Updated Carrier"}]}
   */
  async updateCarrier(carrierId, description) {
    this.#require({ Carrier: carrierId, 'Carrier name': description })

    // docs: https://dearinventory.docs.apiary.io/#reference/carrier/carrier  (PUT requires CarrierID + Description)
    return await this.#apiRequest({ url: `${ API_BASE_URL }/ref/carrier`, method: 'put', body: { CarrierID: carrierId, Description: description }, logTag: 'updateCarrier' })
  }

  /**
   * @operationName Delete Carrier
   * @category Reference Data
   * @description Permanently deletes a carrier. This cannot be undone.
   * @route POST /delete-carrier
   * @paramDef {"type":"String","label":"Carrier","name":"carrierId","dictionary":"getCarriersByIdDictionary","required":true,"description":"The carrier to delete."}
   * @returns {Object}
   * @sampleResult {"Success":true}
   */
  async deleteCarrier(carrierId) {
    this.#require({ Carrier: carrierId })
    await this.#apiRequest({ url: `${ API_BASE_URL }/ref/carrier`, method: 'delete', query: { ID: carrierId }, logTag: 'deleteCarrier' })

    return { Success: true }
  }

  /**
   * @operationName List Accounts
   * @category Reference Data
   * @description Lists chart-of-accounts entries (read-only). Auto-pages. Use this to find an account code for payments, revenue or expenses.
   * @route POST /list-accounts
   * @paramDef {"type":"String","label":"Type","name":"type","description":"Filter by account type (e.g. Revenue, Expense, Bank)."}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"Filter by status (e.g. Active)."}
   * @paramDef {"type":"Number","label":"Max per page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page 1-1000; auto-pages. Default 100."}
   * @returns {Object}
   * @sampleResult {"Total":2,"Page":1,"AccountsList":[{"Code":"200","Name":"Sales","Type":"Revenue","Status":"Active"}]}
   */
  async listAccounts(type, status, limit) {
    return await this.#listAll({ url: `${ API_BASE_URL }/ref/account`, query: { Type: type || undefined, Status: status || undefined }, collection: 'AccountsList', limit, logTag: 'listAccounts' })
  }

  // ==========================================================================
  //  DICTIONARIES - back every resource-pick (*Id) param with one of these
  // ==========================================================================
  /**
   * @registerAs DICTIONARY
   * @operationName Get Products Dictionary
   * @description Provides a searchable list of products for dropdown selection (value = product ID).
   * @route POST /get-products-dictionary
   * @paramDef {"type":"dictionaryPayload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Baked Bread (Bread)","value":"4aadd8f6-4d3d-46ca-acbb-1a9a662f9bc1"}],"cursor":null}
   */
  async getProductsDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/product`, query: { Name: search || undefined, Limit: 100 }, logTag: 'getProductsDictionary' })

    return { items: (result.Products || []).map(p => ({ label: `${ p.Name } (${ p.SKU })`, value: p.ID })), cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Customers Dictionary
   * @description Provides a searchable list of customers for dropdown selection (value = customer ID).
   * @route POST /get-customers-dictionary
   * @paramDef {"type":"dictionaryPayload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Mary Jane","value":"7d6b441a-3067-42b1-9b81-2def95df827b","note":"AUD"}],"cursor":null}
   */
  async getCustomersDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/customer`, query: { Name: search || undefined, Limit: 100 }, logTag: 'getCustomersDictionary' })

    return { items: (result.CustomerList || []).map(c => ({ label: c.Name, value: c.ID, note: c.Currency })), cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Suppliers Dictionary
   * @description Provides a searchable list of suppliers for dropdown selection (value = supplier ID).
   * @route POST /get-suppliers-dictionary
   * @paramDef {"type":"dictionaryPayload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"ABC Furniture","value":"57144411-51ce-446f-9c96-db4243c477dc","note":"AUD"}],"cursor":null}
   */
  async getSuppliersDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/supplier`, query: { Name: search || undefined, Limit: 100 }, logTag: 'getSuppliersDictionary' })

    return { items: (result.SupplierList || []).map(s => ({ label: s.Name, value: s.ID, note: s.Currency })), cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Locations Dictionary (by ID)
   * @description Provides a searchable list of locations for dropdown selection (value = location ID, used by stock transfer/take).
   * @route POST /get-locations-dictionary
   * @paramDef {"type":"dictionaryPayload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Main Warehouse","value":"aa4ab1cf-c989-45cd-8926-23d1edd6601e"}],"cursor":null}
   */
  async getLocationsDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/ref/location`, query: { Name: search || undefined, Limit: 100 }, logTag: 'getLocationsDictionary' })

    return { items: (result.LocationList || []).map(l => ({ label: l.Name, value: l.ID })), cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Locations Dictionary (by name)
   * @description Provides a searchable list of locations for dropdown selection (value = location name, used by sale/purchase/product which key locations by name).
   * @route POST /get-locations-by-name-dictionary
   * @paramDef {"type":"dictionaryPayload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Main Warehouse","value":"Main Warehouse"}],"cursor":null}
   */
  async getLocationsByNameDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/ref/location`, query: { Name: search || undefined, Limit: 100 }, logTag: 'getLocationsByNameDictionary' })

    return { items: (result.LocationList || []).map(l => ({ label: l.Name, value: l.Name })), cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Categories Dictionary (by name)
   * @description Provides a searchable list of product categories (value = category name, what write fields expect).
   * @route POST /get-categories-dictionary
   * @paramDef {"type":"dictionaryPayload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Apparel","value":"Apparel"}],"cursor":null}
   */
  async getCategoriesDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/ref/category`, query: { Name: search || undefined, Limit: 100 }, logTag: 'getCategoriesDictionary' })

    return { items: (result.CategoryList || []).map(c => ({ label: c.Name, value: c.Name })), cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Categories Dictionary (by ID)
   * @description Provides a searchable list of product categories (value = category ID, used by update/delete).
   * @route POST /get-categories-by-id-dictionary
   * @paramDef {"type":"dictionaryPayload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Apparel","value":"1f1c7865-0058-450c-8c6a-44180b8a9705"}],"cursor":null}
   */
  async getCategoriesByIdDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/ref/category`, query: { Name: search || undefined, Limit: 100 }, logTag: 'getCategoriesByIdDictionary' })

    return { items: (result.CategoryList || []).map(c => ({ label: c.Name, value: c.ID })), cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Brands Dictionary (by name)
   * @description Provides a searchable list of brands (value = brand name, what write fields expect).
   * @route POST /get-brands-dictionary
   * @paramDef {"type":"dictionaryPayload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"New Brand","value":"New Brand"}],"cursor":null}
   */
  async getBrandsDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/ref/brand`, query: { Name: search || undefined, Limit: 100 }, logTag: 'getBrandsDictionary' })

    return { items: (result.BrandList || []).map(b => ({ label: b.Name, value: b.Name })), cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Brands Dictionary (by ID)
   * @description Provides a searchable list of brands (value = brand ID, used by update/delete).
   * @route POST /get-brands-by-id-dictionary
   * @paramDef {"type":"dictionaryPayload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"New Brand","value":"fa528b78-d8a3-4f87-b1ac-9cea985e337d"}],"cursor":null}
   */
  async getBrandsByIdDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/ref/brand`, query: { Name: search || undefined, Limit: 100 }, logTag: 'getBrandsByIdDictionary' })

    return { items: (result.BrandList || []).map(b => ({ label: b.Name, value: b.ID })), cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Units Dictionary (by name)
   * @description Provides a searchable list of units of measure (value = unit name, what write fields expect).
   * @route POST /get-units-dictionary
   * @paramDef {"type":"dictionaryPayload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Item","value":"Item"}],"cursor":null}
   */
  async getUnitsDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/ref/unit`, query: { Name: search || undefined, Limit: 100 }, logTag: 'getUnitsDictionary' })

    return { items: (result.UnitList || []).map(u => ({ label: u.Name, value: u.Name })), cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Units Dictionary (by ID)
   * @description Provides a searchable list of units of measure (value = unit ID, used by update/delete).
   * @route POST /get-units-by-id-dictionary
   * @paramDef {"type":"dictionaryPayload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Item","value":"999b3f55-78f5-4a1f-ba8b-2be682a0af61"}],"cursor":null}
   */
  async getUnitsByIdDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/ref/unit`, query: { Name: search || undefined, Limit: 100 }, logTag: 'getUnitsByIdDictionary' })

    return { items: (result.UnitList || []).map(u => ({ label: u.Name, value: u.ID })), cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Attribute Sets Dictionary
   * @description Provides a searchable list of attribute sets (value = attribute set ID).
   * @route POST /get-attribute-sets-dictionary
   * @paramDef {"type":"dictionaryPayload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Test set","value":"0ba27d98-42ca-4bf6-9b9e-9f71538bd53d"}],"cursor":null}
   */
  async getAttributeSetsDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/ref/attributeset`, query: { Name: search || undefined, Limit: 100 }, logTag: 'getAttributeSetsDictionary' })

    return { items: (result.AttributeSetList || []).map(a => ({ label: a.Name, value: a.ID })), cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Product Families Dictionary
   * @description Provides a searchable list of product families (value = family ID).
   * @route POST /get-product-families-dictionary
   * @paramDef {"type":"dictionaryPayload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Test (Test)","value":"ce9a6504-4207-4001-b430-749bf11fdc4f"}],"cursor":null}
   */
  async getProductFamiliesDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/productFamily`, query: { Limit: 100 }, logTag: 'getProductFamiliesDictionary' })
    let families = result.ProductFamilies || []

    if (search) {
      const needle = search.toLowerCase()

      families = families.filter(f => `${ f.Name || '' } ${ f.SKU || '' }`.toLowerCase().includes(needle))
    }

    return { items: families.map(f => ({ label: `${ f.Name } (${ f.SKU })`, value: f.ID })), cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Price Tiers Dictionary
   * @description Provides the list of price tiers (value = tier name, what write fields expect).
   * @route POST /get-price-tiers-dictionary
   * @paramDef {"type":"dictionaryPayload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Tier 1","value":"Tier 1"}],"cursor":null}
   */
  async getPriceTiersDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/ref/priceTier`, logTag: 'getPriceTiersDictionary' })
    let tiers = result.PriceTiers || []

    if (search) {
      const needle = search.toLowerCase()

      tiers = tiers.filter(t => (t.Name || '').toLowerCase().includes(needle))
    }

    return { items: tiers.map(t => ({ label: t.Name, value: t.Name })), cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Payment Terms Dictionary (by name)
   * @description Provides a searchable list of payment terms (value = term name, what write fields expect).
   * @route POST /get-payment-terms-dictionary
   * @paramDef {"type":"dictionaryPayload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"30 days","value":"30 days"}],"cursor":null}
   */
  async getPaymentTermsDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/ref/paymentterm`, query: { Name: search || undefined, Limit: 100 }, logTag: 'getPaymentTermsDictionary' })

    return { items: (result.PaymentTermList || []).map(t => ({ label: t.Name, value: t.Name })), cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Payment Terms Dictionary (by ID)
   * @description Provides a searchable list of payment terms (value = term ID, used by update/delete).
   * @route POST /get-payment-terms-by-id-dictionary
   * @paramDef {"type":"dictionaryPayload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"30 days","value":"927a7013-e1d9-4194-a547-28b1b4c6b413"}],"cursor":null}
   */
  async getPaymentTermsByIdDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/ref/paymentterm`, query: { Name: search || undefined, Limit: 100 }, logTag: 'getPaymentTermsByIdDictionary' })

    return { items: (result.PaymentTermList || []).map(t => ({ label: t.Name, value: t.ID })), cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Sale Tax Rules Dictionary
   * @description Provides a searchable list of sale tax rules (value = tax rule name, what write fields expect).
   * @route POST /get-sale-tax-rules-dictionary
   * @paramDef {"type":"dictionaryPayload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"GST on Income (10%)","value":"GST on Income"}],"cursor":null}
   */
  async getSaleTaxRulesDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/ref/tax`, query: { IsTaxForSale: 'true', Limit: 100 }, logTag: 'getSaleTaxRulesDictionary' })
    let rules = result.TaxRuleList || []

    if (search) {
      const needle = search.toLowerCase()

      rules = rules.filter(r => (r.Name || '').toLowerCase().includes(needle))
    }

    return { items: rules.map(r => ({ label: `${ r.Name } (${ r.TaxPercent }%)`, value: r.Name })), cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Purchase Tax Rules Dictionary
   * @description Provides a searchable list of purchase tax rules (value = tax rule name, what write fields expect).
   * @route POST /get-purchase-tax-rules-dictionary
   * @paramDef {"type":"dictionaryPayload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Sales Tax on Imports (10%)","value":"Sales Tax on Imports"}],"cursor":null}
   */
  async getPurchaseTaxRulesDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/ref/tax`, query: { IsTaxForPurchase: 'true', Limit: 100 }, logTag: 'getPurchaseTaxRulesDictionary' })
    let rules = result.TaxRuleList || []

    if (search) {
      const needle = search.toLowerCase()

      rules = rules.filter(r => (r.Name || '').toLowerCase().includes(needle))
    }

    return { items: rules.map(r => ({ label: `${ r.Name } (${ r.TaxPercent }%)`, value: r.Name })), cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Carriers Dictionary (by name)
   * @description Provides a searchable list of carriers (value = carrier name, what sale write fields expect).
   * @route POST /get-carriers-dictionary
   * @paramDef {"type":"dictionaryPayload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"DEFAULT Carrier","value":"DEFAULT Carrier"}],"cursor":null}
   */
  async getCarriersDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/ref/carrier`, query: { Description: search || undefined, Limit: 100 }, logTag: 'getCarriersDictionary' })

    return { items: (result.CarrierList || []).map(c => ({ label: c.Description, value: c.Description })), cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Carriers Dictionary (by ID)
   * @description Provides a searchable list of carriers (value = carrier ID, used by update/delete).
   * @route POST /get-carriers-by-id-dictionary
   * @paramDef {"type":"dictionaryPayload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"DEFAULT Carrier","value":"729cd659-c0ca-4a8a-9771-84539cd2e7e8"}],"cursor":null}
   */
  async getCarriersByIdDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/ref/carrier`, query: { Description: search || undefined, Limit: 100 }, logTag: 'getCarriersByIdDictionary' })

    return { items: (result.CarrierList || []).map(c => ({ label: c.Description, value: c.CarrierID })), cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Accounts Dictionary
   * @description Provides a searchable list of chart-of-accounts entries (value = account code, what payment fields expect).
   * @route POST /get-accounts-dictionary
   * @paramDef {"type":"dictionaryPayload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Sales (200)","value":"200"}],"cursor":null}
   */
  async getAccountsDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/ref/account`, query: { Limit: 100 }, logTag: 'getAccountsDictionary' })
    let accounts = result.AccountsList || []

    if (search) {
      const needle = search.toLowerCase()

      accounts = accounts.filter(a => `${ a.Name || '' } ${ a.Code || '' }`.toLowerCase().includes(needle))
    }

    return { items: accounts.map(a => ({ label: `${ a.Name } (${ a.Code })`, value: a.Code })), cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Sales Dictionary
   * @description Provides a searchable list of sales for dropdown selection (value = sale ID).
   * @route POST /get-sales-dictionary
   * @paramDef {"type":"dictionaryPayload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"SO-00001 — Hamilton Smith Pty","value":"916ab4c0-6ccb-4c93-873d-0603859050e4","note":"ORDERED"}],"cursor":null}
   */
  async getSalesDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/saleList`, query: { Search: search || undefined, Limit: 100 }, logTag: 'getSalesDictionary' })

    return { items: (result.SaleList || []).map(s => ({ label: `${ s.OrderNumber } — ${ s.Customer }`, value: s.SaleID, note: s.Status })), cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Purchases Dictionary
   * @description Provides a searchable list of purchases for dropdown selection (value = purchase ID).
   * @route POST /get-purchases-dictionary
   * @paramDef {"type":"dictionaryPayload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"PO-00007 — ABPA","value":"3fb1debd-1f89-476c-b7ac-826a493a2092","note":"ORDERING"}],"cursor":null}
   */
  async getPurchasesDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/purchaseList`, query: { Search: search || undefined, Limit: 100 }, logTag: 'getPurchasesDictionary' })

    return { items: (result.PurchaseList || []).map(p => ({ label: `${ p.OrderNumber } — ${ p.Supplier }`, value: p.ID, note: p.Status })), cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Stock Adjustments Dictionary
   * @description Provides a searchable list of stock adjustments (value = adjustment TaskID).
   * @route POST /get-stock-adjustments-dictionary
   * @paramDef {"type":"dictionaryPayload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"ST-00024","value":"107e8ba9-418c-4233-bf80-369036867144","note":"DRAFT"}],"cursor":null}
   */
  async getStockAdjustmentsDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/stockadjustmentList`, query: { Limit: 100 }, logTag: 'getStockAdjustmentsDictionary' })
    let rows = result.StockAdjustmentList || []

    if (search) {
      const needle = search.toLowerCase()

      rows = rows.filter(r => (r.StocktakeNumber || '').toLowerCase().includes(needle))
    }

    return { items: rows.map(r => ({ label: r.StocktakeNumber || r.TaskID, value: r.TaskID, note: r.Status })), cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Stock Transfers Dictionary
   * @description Provides a searchable list of stock transfers (value = transfer TaskID).
   * @route POST /get-stock-transfers-dictionary
   * @paramDef {"type":"dictionaryPayload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"TR-00006","value":"d144d7c8-b3f8-4b43-9d64-d6ee948606a2","note":"DRAFT"}],"cursor":null}
   */
  async getStockTransfersDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/stockTransferList`, query: { Limit: 100 }, logTag: 'getStockTransfersDictionary' })
    let rows = result.StockTransferList || []

    if (search) {
      const needle = search.toLowerCase()

      rows = rows.filter(r => (r.Number || '').toLowerCase().includes(needle))
    }

    return { items: rows.map(r => ({ label: r.Number || r.TaskID, value: r.TaskID, note: r.Status })), cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Stock Takes Dictionary
   * @description Provides a searchable list of stock takes (value = stocktake TaskID).
   * @route POST /get-stock-takes-dictionary
   * @paramDef {"type":"dictionaryPayload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"ST-00030","value":"107e8ba9-418c-4233-bf80-369036867144","note":"DRAFT"}],"cursor":null}
   */
  async getStockTakesDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/stockTakeList`, query: { Limit: 100 }, logTag: 'getStockTakesDictionary' })
    let rows = result.StockTakeList || []

    if (search) {
      const needle = search.toLowerCase()

      rows = rows.filter(r => (r.StocktakeNumber || '').toLowerCase().includes(needle))
    }

    return { items: rows.map(r => ({ label: r.StocktakeNumber || r.TaskID, value: r.TaskID, note: r.Status })), cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Sale Fulfilments Dictionary
   * @description Provides fulfilment tasks across recent sales (value = fulfilment TaskID). Type a sale order number to narrow the list.
   * @route POST /get-sale-fulfilment-tasks-dictionary
   * @paramDef {"type":"dictionaryPayload","label":"Payload","name":"payload","description":"Search a sale by order number; the matching sales' fulfilments are returned."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"SO-00001 — fulfilment","value":"cde5fb4a-1dac-4e9a-bc33-5dfa14eedb57","note":"NOT FULFILLED"}],"cursor":null}
   */
  async getSaleFulfilmentTasksDictionary(payload) {
    const items = await this.#saleSubTaskItems(payload, 'fulfilment')

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Sale Invoices Dictionary
   * @description Provides invoice tasks across recent sales (value = invoice TaskID). Type a sale order number to narrow the list.
   * @route POST /get-sale-invoice-tasks-dictionary
   * @paramDef {"type":"dictionaryPayload","label":"Payload","name":"payload","description":"Search a sale by order number; the matching sales' invoices are returned."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"INV-00001","value":"b039f19e-66f8-4309-a4b1-abf928303c88","note":"SO-00001"}],"cursor":null}
   */
  async getSaleInvoiceTasksDictionary(payload) {
    const items = await this.#saleSubTaskItems(payload, 'invoice')

    return { items, cursor: null }
  }

  // Shared: find the best-matching sales by search, then list their fulfilments or invoices.
  async #saleSubTaskItems(payload, kind) {
    const { search } = payload || {}
    const listed = await this.#apiRequest({ url: `${ API_BASE_URL }/saleList`, query: { Search: search || undefined, Limit: 5 }, logTag: `getSale_${ kind }_Tasks` })
    const sales = listed.SaleList || []
    const items = []

    for (const s of sales) {
      const sale = await this.#apiRequest({ url: `${ API_BASE_URL }/sale`, query: { ID: s.SaleID }, logTag: `getSale_${ kind }_Tasks` })

      if (kind === 'fulfilment') {
        (sale.Fulfilments || []).forEach(fl => items.push({ label: `${ s.OrderNumber } — fulfilment`, value: fl.TaskID, note: fl.FulFilmentStatus }))
      } else {
        (sale.Invoices || []).forEach(inv => items.push({ label: inv.InvoiceNumber || `${ s.OrderNumber } invoice`, value: inv.TaskID, note: s.OrderNumber }))
      }
    }

    return items
  }

  // ==========================================================================
  //  SCHEMA LOADERS - sub-form definitions for Array<Object> line params
  // ==========================================================================
  #saleLineFields(withAccount) {
    const fields = [
      { name: 'productId', type: 'String', label: 'Product', uiComponent: { type: 'DROPDOWN' }, dictionary: 'getProductsDictionary', required: true, description: 'Product on this line.' },
      { name: 'quantity', type: 'Number', label: 'Quantity', uiComponent: { type: 'NUMERIC_STEPPER' }, required: true, description: 'Units.' },
      { name: 'price', type: 'Number', label: 'Unit price', uiComponent: { type: 'NUMERIC_STEPPER' }, required: true, description: 'Price per unit.' },
      { name: 'discount', type: 'Number', label: 'Discount %', uiComponent: { type: 'NUMERIC_STEPPER' }, required: false, description: 'Line discount percent.' },
      { name: 'taxRule', type: 'String', label: 'Tax rule', uiComponent: { type: 'DROPDOWN' }, dictionary: 'getSaleTaxRulesDictionary', required: true, description: 'Tax rule for this line (Cin7 requires a tax rule).' },
      { name: 'comment', type: 'String', label: 'Comment', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: false, description: 'Line note.' },
    ]

    if (withAccount) {
      fields.push({ name: 'account', type: 'String', label: 'Revenue account', uiComponent: { type: 'DROPDOWN' }, dictionary: 'getAccountsDictionary', required: false, description: 'Revenue account code (defaults from product).' })
    }

    return fields
  }

  #purchaseLineFields(withAccount) {
    const fields = [
      { name: 'productId', type: 'String', label: 'Product', uiComponent: { type: 'DROPDOWN' }, dictionary: 'getProductsDictionary', required: true, description: 'Product on this line.' },
      { name: 'supplierSku', type: 'String', label: 'Supplier SKU', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: false, description: "The supplier's SKU for this product." },
      { name: 'quantity', type: 'Number', label: 'Quantity', uiComponent: { type: 'NUMERIC_STEPPER' }, required: true, description: 'Units.' },
      { name: 'price', type: 'Number', label: 'Unit price', uiComponent: { type: 'NUMERIC_STEPPER' }, required: true, description: 'Price per unit.' },
      { name: 'discount', type: 'Number', label: 'Discount %', uiComponent: { type: 'NUMERIC_STEPPER' }, required: false, description: 'Line discount percent.' },
      { name: 'taxRule', type: 'String', label: 'Tax rule', uiComponent: { type: 'DROPDOWN' }, dictionary: 'getPurchaseTaxRulesDictionary', required: true, description: 'Tax rule for this line.' },
      { name: 'comment', type: 'String', label: 'Comment', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: false, description: 'Line note.' },
    ]

    if (withAccount) {
      fields.push({ name: 'account', type: 'String', label: 'Expense account', uiComponent: { type: 'DROPDOWN' }, dictionary: 'getAccountsDictionary', required: false, description: 'Expense account code (defaults from product).' })
    }

    return fields
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /sale-line-schema
   * @returns {Object}
   */
  async saleLineSchema() {
    return this.#saleLineFields(false)
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /sale-order-line-schema
   * @returns {Object}
   */
  async saleOrderLineSchema() {
    return this.#saleLineFields(false)
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /sale-invoice-line-schema
   * @returns {Object}
   */
  async saleInvoiceLineSchema() {
    return this.#saleLineFields(true)
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /purchase-order-line-schema
   * @returns {Object}
   */
  async purchaseOrderLineSchema() {
    return this.#purchaseLineFields(false)
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /purchase-invoice-line-schema
   * @returns {Object}
   */
  async purchaseInvoiceLineSchema() {
    return this.#purchaseLineFields(true)
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /stock-received-line-schema
   * @returns {Object}
   */
  async stockReceivedLineSchema() {
    return [
      { name: 'productId', type: 'String', label: 'Product', uiComponent: { type: 'DROPDOWN' }, dictionary: 'getProductsDictionary', required: true, description: 'Product received.' },
      { name: 'quantity', type: 'Number', label: 'Quantity', uiComponent: { type: 'NUMERIC_STEPPER' }, required: true, description: 'Units received.' },
      { name: 'date', type: 'String', label: 'Received date', uiComponent: { type: 'DATE_PICKER' }, required: true, description: 'Date received.' },
      { name: 'locationId', type: 'String', label: 'Location', uiComponent: { type: 'DROPDOWN' }, dictionary: 'getLocationsDictionary', required: true, description: 'Location received into.' },
      { name: 'batchSN', type: 'String', label: 'Batch / serial', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: false, description: 'Batch number or serial.' },
      { name: 'expiryDate', type: 'String', label: 'Expiry date', uiComponent: { type: 'DATE_PICKER' }, required: false, description: 'Batch expiry date.' },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /pick-line-schema
   * @returns {Object}
   */
  async pickLineSchema() {
    return [
      { name: 'productId', type: 'String', label: 'Product', uiComponent: { type: 'DROPDOWN' }, dictionary: 'getProductsDictionary', required: true, description: 'Product picked.' },
      { name: 'locationId', type: 'String', label: 'Location', uiComponent: { type: 'DROPDOWN' }, dictionary: 'getLocationsDictionary', required: true, description: 'Location picked from.' },
      { name: 'quantity', type: 'Number', label: 'Quantity', uiComponent: { type: 'NUMERIC_STEPPER' }, required: true, description: 'Units picked.' },
      { name: 'batchSN', type: 'String', label: 'Batch / serial', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: false, description: 'Batch number or serial.' },
      { name: 'expiryDate', type: 'String', label: 'Expiry date', uiComponent: { type: 'DATE_PICKER' }, required: false, description: 'Batch expiry date.' },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /pack-line-schema
   * @returns {Object}
   */
  async packLineSchema() {
    return [
      { name: 'productId', type: 'String', label: 'Product', uiComponent: { type: 'DROPDOWN' }, dictionary: 'getProductsDictionary', required: true, description: 'Product packed.' },
      { name: 'locationId', type: 'String', label: 'Location', uiComponent: { type: 'DROPDOWN' }, dictionary: 'getLocationsDictionary', required: true, description: 'Location packed from.' },
      { name: 'quantity', type: 'Number', label: 'Quantity', uiComponent: { type: 'NUMERIC_STEPPER' }, required: true, description: 'Units packed.' },
      { name: 'box', type: 'String', label: 'Box', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: false, description: 'Box label.' },
      { name: 'batchSN', type: 'String', label: 'Batch / serial', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: false, description: 'Batch number or serial.' },
      { name: 'expiryDate', type: 'String', label: 'Expiry date', uiComponent: { type: 'DATE_PICKER' }, required: false, description: 'Batch expiry date.' },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /ship-line-schema
   * @returns {Object}
   */
  async shipLineSchema() {
    return [
      { name: 'carrier', type: 'String', label: 'Carrier', uiComponent: { type: 'DROPDOWN' }, dictionary: 'getCarriersDictionary', required: false, description: 'Shipping carrier.' },
      { name: 'boxes', type: 'String', label: 'Boxes', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: false, description: 'Number of boxes.' },
      { name: 'trackingNumber', type: 'String', label: 'Tracking number', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: false, description: 'Carrier tracking number.' },
      { name: 'trackingUrl', type: 'String', label: 'Tracking URL', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: false, description: 'Carrier tracking URL.' },
      { name: 'shipmentDate', type: 'String', label: 'Shipment date', uiComponent: { type: 'DATE_PICKER' }, required: false, description: 'Date shipped.' },
      { name: 'isShipped', type: 'Boolean', label: 'Shipped', uiComponent: { type: 'TOGGLE' }, required: false, description: 'Mark as shipped.' },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /stock-adjustment-line-schema
   * @returns {Object}
   */
  async stockAdjustmentLineSchema() {
    return [
      { name: 'productId', type: 'String', label: 'Product', uiComponent: { type: 'DROPDOWN' }, dictionary: 'getProductsDictionary', required: true, description: 'Product being adjusted.' },
      { name: 'quantity', type: 'Number', label: 'Quantity', uiComponent: { type: 'NUMERIC_STEPPER' }, required: true, description: 'Adjustment quantity (positive or negative).' },
      { name: 'unitCost', type: 'Number', label: 'Unit cost', uiComponent: { type: 'NUMERIC_STEPPER' }, required: true, description: 'Cost per unit.' },
      { name: 'locationId', type: 'String', label: 'Location', uiComponent: { type: 'DROPDOWN' }, dictionary: 'getLocationsDictionary', required: true, description: 'Location adjusted.' },
      { name: 'batchSN', type: 'String', label: 'Batch / serial', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: false, description: 'Batch number or serial.' },
      { name: 'expiryDate', type: 'String', label: 'Expiry date', uiComponent: { type: 'DATE_PICKER' }, required: false, description: 'Batch expiry date.' },
      { name: 'receivedDate', type: 'String', label: 'Received date', uiComponent: { type: 'DATE_PICKER' }, required: false, description: 'Date received.' },
      { name: 'comments', type: 'String', label: 'Comments', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: false, description: 'Line note.' },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /stock-transfer-line-schema
   * @returns {Object}
   */
  async stockTransferLineSchema() {
    return [
      { name: 'productId', type: 'String', label: 'Product', uiComponent: { type: 'DROPDOWN' }, dictionary: 'getProductsDictionary', required: true, description: 'Product being transferred.' },
      { name: 'transferQuantity', type: 'Number', label: 'Transfer quantity', uiComponent: { type: 'NUMERIC_STEPPER' }, required: true, description: 'Units to move.' },
      { name: 'batchSN', type: 'String', label: 'Batch / serial', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: false, description: 'Batch number or serial.' },
      { name: 'expiryDate', type: 'String', label: 'Expiry date', uiComponent: { type: 'DATE_PICKER' }, required: false, description: 'Batch expiry date.' },
      { name: 'comments', type: 'String', label: 'Comments', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: false, description: 'Line note.' },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /stock-take-line-schema
   * @returns {Object}
   */
  async stockTakeLineSchema() {
    return [
      { name: 'productId', type: 'String', label: 'Product', uiComponent: { type: 'DROPDOWN' }, dictionary: 'getProductsDictionary', required: true, description: 'Product counted.' },
      { name: 'locationId', type: 'String', label: 'Location', uiComponent: { type: 'DROPDOWN' }, dictionary: 'getLocationsDictionary', required: true, description: 'Location counted.' },
      { name: 'adjustment', type: 'Number', label: 'Counted adjustment', uiComponent: { type: 'NUMERIC_STEPPER' }, required: true, description: 'The counted adjustment value vs system on-hand.' },
      { name: 'batchSN', type: 'String', label: 'Batch / serial', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: false, description: 'Batch number or serial.' },
      { name: 'expiryDate', type: 'String', label: 'Expiry date', uiComponent: { type: 'DATE_PICKER' }, required: false, description: 'Batch expiry date.' },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /attribute-set-line-schema
   * @returns {Object}
   */
  async attributeSetLineSchema() {
    return [
      { name: 'attributeName', type: 'String', label: 'Attribute name', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: true, description: 'Name of the attribute.' },
      { name: 'attributeType', type: 'String', label: 'Type', uiComponent: { type: 'DROPDOWN', options: { values: ['List', 'Checkbox', 'Text'] } }, required: true, description: 'Attribute type.' },
      { name: 'attributeValues', type: 'String', label: 'List values (comma-separated)', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: false, description: 'For List type: comma-separated values (e.g. Red, Black, Blue).' },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /product-family-variant-schema
   * @returns {Object}
   */
  async productFamilyVariantSchema() {
    return [
      { name: 'sku', type: 'String', label: 'Variant SKU', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: true, description: 'Unique SKU for this variant.' },
      { name: 'name', type: 'String', label: 'Variant name', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: true, description: 'Variant display name.' },
      { name: 'option1', type: 'String', label: 'Option 1', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: false, description: 'First option value (e.g. colour).' },
      { name: 'option2', type: 'String', label: 'Option 2', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: false, description: 'Second option value (e.g. size).' },
      { name: 'option3', type: 'String', label: 'Option 3', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: false, description: 'Third option value.' },
    ]
  }

  #addressFields() {
    return [
      { name: 'line1', type: 'String', label: 'Address line 1', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: true, description: 'Street address.' },
      { name: 'line2', type: 'String', label: 'Address line 2', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: false, description: 'Address line 2.' },
      { name: 'city', type: 'String', label: 'City', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: false, description: 'City/suburb.' },
      { name: 'state', type: 'String', label: 'State', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: false, description: 'State/province.' },
      { name: 'postcode', type: 'String', label: 'Post code', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: false, description: 'ZIP/postcode.' },
      { name: 'country', type: 'String', label: 'Country', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: false, description: 'Country.' },
      { name: 'type', type: 'String', label: 'Address type', uiComponent: { type: 'DROPDOWN', options: { values: ['Billing', 'Shipping', 'Business'] } }, required: true, description: 'Address type.' },
      { name: 'defaultForType', type: 'Boolean', label: 'Default for type', uiComponent: { type: 'TOGGLE' }, required: false, description: 'Use as default for this address type.' },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /customer-address-schema
   * @returns {Object}
   */
  async customerAddressSchema() {
    return this.#addressFields()
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /supplier-address-schema
   * @returns {Object}
   */
  async supplierAddressSchema() {
    return this.#addressFields()
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /contact-schema
   * @returns {Object}
   */
  async contactSchema() {
    return [
      { name: 'name', type: 'String', label: 'Name', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: true, description: 'Contact name.' },
      { name: 'jobTitle', type: 'String', label: 'Job title', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: false, description: 'Contact job title.' },
      { name: 'phone', type: 'String', label: 'Phone', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: false, description: 'Phone number.' },
      { name: 'mobilePhone', type: 'String', label: 'Mobile phone', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: false, description: 'Mobile number.' },
      { name: 'email', type: 'String', label: 'Email', uiComponent: { type: 'SINGLE_LINE_TEXT' }, required: false, description: 'Email address.' },
      { name: 'default', type: 'Boolean', label: 'Primary contact', uiComponent: { type: 'TOGGLE' }, required: false, description: 'Mark as the primary contact.' },
    ]
  }

  // ==========================================================================
  //  TRIGGERS (realtime webhooks)
  //  GATE: webhooks require the paid Automation module on the Cin7 subscription.
  //  Auth: Cin7 has no provider HMAC; we set a bearer secret via ExternalBearerToken
  //  at upsert and verify the inbound `Authorization: Bearer <secret>` in resolve-events.
  // ==========================================================================
  /**
   * @registerAs REALTIME_TRIGGER
   * @operationName On Sale Created
   * @category Triggers
   * @description Fires when a new sale is created in Cin7 Core. Use to kick off a workflow as soon as an order arrives.
   * @route POST /on-sale-created
   * @returns {Object}
   * @sampleResult {"SaleID":"91EE7B1D-BD35-4E43-B98A-DB86BE777624","SaleOrderNumber":"SO-00044","CustomerName":"Customer name","EventType":"Sale/Created"}
   */
  async onSaleCreated() {}

  /**
   * @registerAs REALTIME_TRIGGER
   * @operationName On Sale Order Authorised
   * @category Triggers
   * @description Fires when a sale's order stage is authorised. Use to trigger fulfilment or downstream processing once an order is confirmed.
   * @route POST /on-sale-order-authorised
   * @returns {Object}
   * @sampleResult {"SaleID":"91EE7B1D-BD35-4E43-B98A-DB86BE777624","SaleOrderNumber":"SO-00044","EventType":"Sale/OrderAuthorised"}
   */
  async onSaleOrderAuthorised() {}

  /**
   * @registerAs REALTIME_TRIGGER
   * @operationName On Sale Invoice Authorised
   * @category Triggers
   * @description Fires when a sale invoice is authorised. Use to sync the invoice to accounting or notify the customer.
   * @route POST /on-sale-invoice-authorised
   * @returns {Object}
   * @sampleResult {"SaleTaskID":"91EE7B1D-BD35-4E43-B98A-DB86BE777624","OrderNumber":"SO-00044","InvoiceNumber":"INV-00039","EventType":"Sale/InvoiceAuthorised"}
   */
  async onSaleInvoiceAuthorised() {}

  /**
   * @registerAs REALTIME_TRIGGER
   * @operationName On Sale Full Payment Received
   * @category Triggers
   * @description Fires when a sale is fully paid. Use to mark an order as paid, release goods, or notify the customer.
   * @route POST /on-sale-full-payment-received
   * @returns {Object}
   * @sampleResult {"SaleID":"91ee7b1d-bd35-4e43-b98a-db86be777624","DocumentNumber":"INV-00039","DocumentType":"invoice","EventType":"Sale/FullPaymentReceived"}
   */
  async onSaleFullPaymentReceived() {}

  /**
   * @registerAs REALTIME_TRIGGER
   * @operationName On Sale Shipment Authorised
   * @category Triggers
   * @description Fires when a sale's shipment is authorised. Use to notify the customer with tracking or update a shipping system.
   * @route POST /on-sale-shipment-authorised
   * @returns {Object}
   * @sampleResult {"SaleTaskID":"91EE7B1D-BD35-4E43-B98A-DB86BE777624","OrderNumber":"SO-00044","CustomerName":"DIISR - Small Business Services","EventType":"Sale/ShipmentAuthorised"}
   */
  async onSaleShipmentAuthorised() {}

  /**
   * @registerAs REALTIME_TRIGGER
   * @operationName On Purchase Order Authorised
   * @category Triggers
   * @description Fires when a purchase order is authorised. Use to send the PO to a supplier or update procurement.
   * @route POST /on-purchase-order-authorised
   * @returns {Object}
   * @sampleResult {"TaskID":"8b1538e4-fa56-49c8-89c9-38d106439577","PurchaseOrderNumber":"PO-00005","SupplierName":"ABPA","EventType":"Purchase/OrderAuthorised"}
   */
  async onPurchaseOrderAuthorised() {}

  /**
   * @registerAs REALTIME_TRIGGER
   * @operationName On Purchase Stock Received Authorised
   * @category Triggers
   * @description Fires when stock received against a purchase is authorised. Use to update inventory-dependent workflows once goods land.
   * @route POST /on-purchase-stock-received-authorised
   * @returns {Object}
   * @sampleResult {"TaskID":"8B1538E4-FA56-49C8-89C9-38D106439577","PurchaseOrderNumber":"PO-00005","EventType":"Purchase/StockReceivedAuthorised"}
   */
  async onPurchaseStockReceivedAuthorised() {}

  /**
   * @registerAs REALTIME_TRIGGER
   * @operationName On Product Updated
   * @category Triggers
   * @description Fires when a product is created or updated. Use to keep an external catalog or storefront in sync.
   * @route POST /on-product-updated
   * @returns {Object}
   * @sampleResult {"NumberOfProducts":1,"ProductDetailsList":[{"Event":"Creation","ID":"cfda2bb8-ffb3-49cb-876b-769c85a26130","SKU":"SKU-TESTPRODUCT-1"}],"EventType":"Product/Updated"}
   */
  async onProductUpdated() {}

  /**
   * @registerAs REALTIME_TRIGGER
   * @operationName On Stock Level Changed
   * @category Triggers
   * @description Fires when available stock levels change. Use to keep storefront availability or reorder alerts current.
   * @route POST /on-stock-level-changed
   * @returns {Object}
   * @sampleResult {"ID":"3bfdf57a-bbc7-4f09-ba28-9768a09e0a60","SKU":"Bread","Name":"Baked Bread","Location":"Main Warehouse","OnHand":497,"Available":488}
   */
  async onStockLevelChanged() {}

  /**
   * @registerAs REALTIME_TRIGGER
   * @operationName On Customer Updated
   * @category Triggers
   * @description Fires when a customer is created or updated. Use to keep a CRM or marketing list in sync.
   * @route POST /on-customer-updated
   * @returns {Object}
   * @sampleResult {"NumberOfCustomers":1,"CustomerDetailsList":[{"Customer":{"ID":"b41c4eb0-7ecb-48e4-ac97-7567885976c5","Name":"114 Transport"}}],"EventType":"Customer/Updated"}
   */
  async onCustomerUpdated() {}

  /**
   * @registerAs REALTIME_TRIGGER
   * @operationName On Supplier Updated
   * @category Triggers
   * @description Fires when a supplier is created or updated. Use to keep a procurement or vendor system in sync.
   * @route POST /on-supplier-updated
   * @returns {Object}
   * @sampleResult {"NumberOfSuppliers":1,"SupplierDetailsList":[{"Supplier":{"ID":"592e5eff-3c92-4a12-a275-67de1fda66ef","Name":"ABC Furniture"}}],"EventType":"Supplier/Updated"}
   */
  async onSupplierUpdated() {}

  // Maps trigger method names -> Cin7 webhook event Types.
  #eventTypeFor(triggerName) {
    return {
      onSaleCreated: 'Sale/Created',
      onSaleOrderAuthorised: 'Sale/OrderAuthorised',
      onSaleInvoiceAuthorised: 'Sale/InvoiceAuthorised',
      onSaleFullPaymentReceived: 'Sale/FullPaymentReceived',
      onSaleShipmentAuthorised: 'Sale/ShipmentAuthorised',
      onPurchaseOrderAuthorised: 'Purchase/OrderAuthorised',
      onPurchaseStockReceivedAuthorised: 'Purchase/StockReceivedAuthorised',
      onProductUpdated: 'Product/Updated',
      onStockLevelChanged: 'Stock/AvailableStockLevelChanged',
      onCustomerUpdated: 'Customer/Updated',
      onSupplierUpdated: 'Supplier/Updated',
    }[triggerName]
  }

  #triggerNameFor(eventType) {
    const map = {
      'Sale/Created': 'onSaleCreated',
      'Sale/OrderAuthorised': 'onSaleOrderAuthorised',
      'Sale/InvoiceAuthorised': 'onSaleInvoiceAuthorised',
      'Sale/FullPaymentReceived': 'onSaleFullPaymentReceived',
      'Sale/ShipmentAuthorised': 'onSaleShipmentAuthorised',
      'Purchase/OrderAuthorised': 'onPurchaseOrderAuthorised',
      'Purchase/StockReceivedAuthorised': 'onPurchaseStockReceivedAuthorised',
      'Product/Updated': 'onProductUpdated',
      'Stock/AvailableStockLevelChanged': 'onStockLevelChanged',
      'Customer/Updated': 'onCustomerUpdated',
      'Supplier/Updated': 'onSupplierUpdated',
    }

    return map[eventType]
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    const triggerName = invocation?.eventName || invocation?.triggerName
    const eventType = this.#eventTypeFor(triggerName)
    const callbackUrl = invocation?.callbackUrl || invocation?.externalUrl
    // Generate a shared secret so Cin7 sends Authorization: Bearer <secret> on every delivery;
    // we verify it in handleTriggerResolveEvents (webhook-auth - no provider HMAC exists).
    const secret = crypto.randomBytes(32).toString('hex')

    const created = await this.#apiRequest({
      url: `${ API_BASE_URL }/webhooks`,
      method: 'post',
      body: {
        Type: eventType,
        IsActive: true,
        ExternalURL: callbackUrl,
        ExternalAuthorizationType: 'bearerauth',
        ExternalBearerToken: secret,
      },
      logTag: 'handleTriggerUpsertWebhook',
    })

    const webhookId = created?.ID || created?.WebhookID || (created?.WebhookList && created.WebhookList[0]?.ID)

    return { webhookData: { webhookId, secret }, eventScopeId: eventType }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    const headers = invocation?.headers || {}
    const authHeader = headers.authorization || headers.Authorization || ''
    const presented = authHeader.replace(/^Bearer\s+/i, '')
    const secret = invocation?.webhookData?.secret

    // Verify the bearer secret we set at upsert (timing-safe). Reject forged deliveries.
    if (!secret || !presented || !this.#secretsMatch(presented, secret)) {
      logger.warn('[handleTriggerResolveEvents] rejected delivery: bearer token mismatch')

      return { events: [] }
    }

    const body = invocation?.body
    const eventType = this.#resolveEventType(body, invocation)
    const triggerName = this.#triggerNameFor(eventType)

    if (!triggerName) {
      return { events: [] }
    }

    // Array payloads (stock level changes) emit one event per element.
    if (Array.isArray(body)) {
      return { events: body.map(item => ({ name: triggerName, data: item })) }
    }

    return { events: [{ name: triggerName, data: body }] }
  }

  #secretsMatch(presented, secret) {
    const a = Buffer.from(String(presented))
    const b = Buffer.from(String(secret))

    if (a.length !== b.length) {
      return false
    }

    return crypto.timingSafeEqual(a, b)
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    const body = invocation?.body
    const incomingType = this.#resolveEventType(body, invocation)

    const ids = (invocation?.triggers || []).filter(t => t.eventScopeId === incomingType).map(t => t.id)

    return { ids }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerDeleteWebhook(invocation) {
    const webhookId = invocation?.webhookData?.webhookId

    if (webhookId) {
      await this.#apiRequest({ url: `${ API_BASE_URL }/webhooks`, method: 'delete', query: { ID: webhookId }, logTag: 'handleTriggerDeleteWebhook' })
    }

    return {}
  }
}

Flowrunner.ServerCode.addService(Cin7Core, [
  {
    name: 'accountId',
    displayName: 'Account ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Cin7 Core Account ID from Integrations > API (Cin7 Core > Settings).',
  },
  {
    name: 'applicationKey',
    displayName: 'Application Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'An API Application Key generated in Cin7 Core > Integrations > API. Keep it secret.',
  },
])
