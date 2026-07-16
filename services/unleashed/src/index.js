'use strict'

const crypto = require('crypto')

const API_BASE_URL = 'https://api.unleashedsoftware.com'

const logger = {
  info: (...args) => console.log('[Unleashed Software] info:', ...args),
  debug: (...args) => console.log('[Unleashed Software] debug:', ...args),
  error: (...args) => console.log('[Unleashed Software] error:', ...args),
  warn: (...args) => console.log('[Unleashed Software] warn:', ...args),
}

/**
 * @integrationName Unleashed Software
 * @integrationIcon /icon.png
 */
class UnleashedSoftware {
  constructor(config) {
    this.apiId = config.apiId
    this.apiKey = config.apiKey
  }

  /**
   * Build the query string EXACTLY as it will be signed and sent.
   * - Omits null/undefined/empty-string values.
   * - Encodes keys and values, joins with '&'. Order is deterministic (insertion order).
   * Returns the string WITHOUT a leading '?' (empty string when no params).
   */
  #buildQueryString(query) {
    if (!query) return ''

    const parts = []

    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue
      parts.push(`${ encodeURIComponent(key) }=${ encodeURIComponent(value) }`)
    }

    return parts.join('&')
  }

  /**
   * HMAC-SHA256 of the query string using the API Key as the secret, base64 encoded.
   * Per Unleashed: sign the query string exactly as it appears after '?', or the empty
   * string when there are no query parameters.
   */
  #sign(queryString) {
    return crypto
      .createHmac('sha256', this.apiKey)
      .update(queryString, 'utf8')
      .digest('base64')
  }

  /**
   * Single private request helper — all external calls go through here.
   * `path` is the endpoint path (e.g. '/Products/1'); the page number lives in the PATH.
   * `query` holds the params that go into (and get signed as) the query string.
   */
  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const queryString = this.#buildQueryString(query)
    const signature = this.#sign(queryString)
    const url = queryString ? `${ API_BASE_URL }${ path }?${ queryString }` : `${ API_BASE_URL }${ path }`

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url).set({
        'api-auth-id': this.apiId,
        'api-auth-signature': signature,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      })

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message =
        error.body?.description ||
        error.body?.Description ||
        (typeof error.body === 'string' ? error.body : undefined) ||
        error.message
      const status = error.status || error.statusCode
      logger.error(`${ logTag } - failed${ status ? ` (${ status })` : '' }: ${ message }`)
      throw new Error(`Unleashed Software API error${ status ? ` [${ status }]` : '' }: ${ message }`)
    }
  }

  // Normalize a page number to a positive integer (Unleashed pages are 1-based).
  #page(page) {
    const n = parseInt(page, 10)

    return Number.isFinite(n) && n > 0 ? n : 1
  }

  // ─── Products ──────────────────────────────────────────────────────────

  /**
   * @operationName Get Products
   * @description Retrieves a paginated list of products from the Unleashed inventory catalog. Supports filtering by product code and product description. The page number is supplied via the Page parameter and results are returned as a flat list of product objects (the response envelope's Items array is unwrapped), alongside pagination metadata. Default page size is 200 unless overridden.
   * @category Products
   * @route GET /products
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (1-based). Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of products per page (default 200). Reduce for faster responses."}
   * @paramDef {"type":"String","label":"Product Code","name":"productCode","description":"Filter results to products matching this exact product code."}
   * @paramDef {"type":"String","label":"Product Description","name":"productDescription","description":"Filter results to products whose description matches this value."}
   * @returns {Object}
   * @sampleResult {"pagination":{"NumberOfItems":1,"PageSize":200,"PageNumber":1,"NumberOfPages":1},"items":[{"Guid":"23280680-a2bd-4873-a390-501e0f3399d1","ProductCode":"WIDGET-1","ProductDescription":"Blue Widget"}]}
   */
  async getProducts(page, pageSize, productCode, productDescription) {
    const response = await this.#apiRequest({
      path: `/Products/${ this.#page(page) }`,
      query: { pageSize, productCode, productDescription },
      logTag: 'getProducts',
    })

    return { pagination: response?.Pagination, items: response?.Items || [] }
  }

  /**
   * @operationName Get Product
   * @description Retrieves a single product by its Unleashed GUID, returning the full product record including code, description, units, pricing, dimensions, and supplier details.
   * @category Products
   * @route GET /product
   * @paramDef {"type":"String","label":"Product GUID","name":"guid","required":true,"description":"The unique Unleashed GUID of the product to retrieve."}
   * @returns {Object}
   * @sampleResult {"Guid":"23280680-a2bd-4873-a390-501e0f3399d1","ProductCode":"WIDGET-1","ProductDescription":"Blue Widget","DefaultSellPrice":25.00}
   */
  async getProduct(guid) {
    return this.#apiRequest({
      path: `/Products/${ encodeURIComponent(guid) }`,
      logTag: 'getProduct',
    })
  }

  // ─── Stock ─────────────────────────────────────────────────────────────

  /**
   * @operationName Get Stock On Hand
   * @description Retrieves a paginated list of stock-on-hand records across all warehouses, showing available, allocated, and on-hand quantities per product. Supports filtering by product code. The Items array is unwrapped into a flat list with pagination metadata.
   * @category Stock
   * @route GET /stock-on-hand
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (1-based). Defaults to 1."}
   * @paramDef {"type":"String","label":"Product Code","name":"productCode","description":"Filter stock records to products matching this exact product code."}
   * @returns {Object}
   * @sampleResult {"pagination":{"NumberOfItems":1,"PageSize":200,"PageNumber":1,"NumberOfPages":1},"items":[{"ProductCode":"WIDGET-1","QtyOnHand":42.0,"AvailableQty":40.0}]}
   */
  async getStockOnHand(page, productCode) {
    const response = await this.#apiRequest({
      path: `/StockOnHand/${ this.#page(page) }`,
      query: { productCode },
      logTag: 'getStockOnHand',
    })

    return { pagination: response?.Pagination, items: response?.Items || [] }
  }

  /**
   * @operationName Get Stock On Hand by Product
   * @description Retrieves the stock-on-hand record for a single product identified by its GUID, returning on-hand, allocated, and available quantities together with warehouse-level breakdowns.
   * @category Stock
   * @route GET /stock-on-hand-by-product
   * @paramDef {"type":"String","label":"Product GUID","name":"productGuid","required":true,"description":"The unique Unleashed GUID of the product whose stock levels to retrieve."}
   * @returns {Object}
   * @sampleResult {"ProductCode":"WIDGET-1","QtyOnHand":42.0,"AllocatedQty":2.0,"AvailableQty":40.0}
   */
  async getStockOnHandByProduct(productGuid) {
    return this.#apiRequest({
      path: `/StockOnHand/${ encodeURIComponent(productGuid) }`,
      logTag: 'getStockOnHandByProduct',
    })
  }

  // ─── Customers ─────────────────────────────────────────────────────────

  /**
   * @operationName Get Customers
   * @description Retrieves a paginated list of customers, optionally filtered by customer code. Returns customer records including codes, names, contact details, and addresses. The Items array is unwrapped into a flat list with pagination metadata.
   * @category Customers
   * @route GET /customers
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (1-based). Defaults to 1."}
   * @paramDef {"type":"String","label":"Customer Code","name":"customerCode","description":"Filter results to customers matching this exact customer code."}
   * @returns {Object}
   * @sampleResult {"pagination":{"NumberOfItems":1,"PageSize":200,"PageNumber":1,"NumberOfPages":1},"items":[{"Guid":"b9f21e05-07fe-4d9d-b460-a09db4c3caa9","CustomerCode":"ACME","CustomerName":"Acme Ltd"}]}
   */
  async getCustomers(page, customerCode) {
    const response = await this.#apiRequest({
      path: `/Customers/${ this.#page(page) }`,
      query: { customerCode },
      logTag: 'getCustomers',
    })

    return { pagination: response?.Pagination, items: response?.Items || [] }
  }

  /**
   * @operationName Get Customer
   * @description Retrieves a single customer by its Unleashed GUID, returning the full customer record including code, name, contacts, addresses, currency, and tax settings.
   * @category Customers
   * @route GET /customer
   * @paramDef {"type":"String","label":"Customer GUID","name":"guid","required":true,"description":"The unique Unleashed GUID of the customer to retrieve."}
   * @returns {Object}
   * @sampleResult {"Guid":"b9f21e05-07fe-4d9d-b460-a09db4c3caa9","CustomerCode":"ACME","CustomerName":"Acme Ltd"}
   */
  async getCustomer(guid) {
    return this.#apiRequest({
      path: `/Customers/${ encodeURIComponent(guid) }`,
      logTag: 'getCustomer',
    })
  }

  // ─── Suppliers ─────────────────────────────────────────────────────────

  /**
   * @operationName Get Suppliers
   * @description Retrieves a paginated list of suppliers, returning supplier records including codes, names, contact details, and payment terms. The Items array is unwrapped into a flat list with pagination metadata.
   * @category Suppliers
   * @route GET /suppliers
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (1-based). Defaults to 1."}
   * @returns {Object}
   * @sampleResult {"pagination":{"NumberOfItems":1,"PageSize":200,"PageNumber":1,"NumberOfPages":1},"items":[{"Guid":"7c1f2e05-07fe-4d9d-b460-a09db4c3caa9","SupplierCode":"SUP1","SupplierName":"Supplier One"}]}
   */
  async getSuppliers(page) {
    const response = await this.#apiRequest({
      path: `/Suppliers/${ this.#page(page) }`,
      logTag: 'getSuppliers',
    })

    return { pagination: response?.Pagination, items: response?.Items || [] }
  }

  // ─── Sales Orders ──────────────────────────────────────────────────────

  /**
   * @operationName Get Sales Orders
   * @description Retrieves a paginated list of sales orders, optionally filtered by order status and start date. Order status accepts one of the standard Unleashed lifecycle states. Returns order records including customer, lines, totals, and status. The Items array is unwrapped into a flat list with pagination metadata.
   * @category Sales Orders
   * @route GET /sales-orders
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (1-based). Defaults to 1."}
   * @paramDef {"type":"String","label":"Order Status","name":"orderStatus","uiComponent":{"type":"DROPDOWN","options":{"values":["Parked","Placed","Backordered","Picking","Picked","Packed","Dispatched","Completed","Deleted"]}},"description":"Filter to sales orders in this status."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","uiComponent":{"type":"DATE_PICKER"},"description":"Return sales orders created on or after this date (YYYY-MM-DD)."}
   * @returns {Object}
   * @sampleResult {"pagination":{"NumberOfItems":1,"PageSize":200,"PageNumber":1,"NumberOfPages":1},"items":[{"Guid":"e2c7d67a-1c96-4fa8-bf59-b23c2d69f22a","OrderNumber":"SO-0001","OrderStatus":"Placed","Total":30.00}]}
   */
  async getSalesOrders(page, orderStatus, startDate) {
    const response = await this.#apiRequest({
      path: `/SalesOrders/${ this.#page(page) }`,
      query: { orderStatus, startDate },
      logTag: 'getSalesOrders',
    })

    return { pagination: response?.Pagination, items: response?.Items || [] }
  }

  /**
   * @operationName Get Sales Order
   * @description Retrieves a single sales order by its Unleashed GUID, returning the full order record including customer, warehouse, currency, sales order lines, taxes, and totals.
   * @category Sales Orders
   * @route GET /sales-order
   * @paramDef {"type":"String","label":"Sales Order GUID","name":"guid","required":true,"description":"The unique Unleashed GUID of the sales order to retrieve."}
   * @returns {Object}
   * @sampleResult {"Guid":"e2c7d67a-1c96-4fa8-bf59-b23c2d69f22a","OrderNumber":"SO-0001","OrderStatus":"Placed","Total":30.00}
   */
  async getSalesOrder(guid) {
    return this.#apiRequest({
      path: `/SalesOrders/${ encodeURIComponent(guid) }`,
      logTag: 'getSalesOrder',
    })
  }

  /**
   * @operationName Create Sales Order
   * @description Creates a new sales order in Unleashed for the given customer and line items. The customer is identified by GUID (Customer object) and each line references a product by GUID with an order quantity and optional unit price. Optionally set the initial order status, warehouse GUID, and comments. Line and order totals are calculated by Unleashed when not supplied.
   * @category Sales Orders
   * @route POST /sales-orders
   * @paramDef {"type":"String","label":"Customer GUID","name":"customerGuid","required":true,"description":"The Unleashed GUID of the customer this order is for."}
   * @paramDef {"type":"Array<SalesOrderLineInput>","label":"Sales Order Lines","name":"salesOrderLines","required":true,"description":"The line items for the order, each referencing a product GUID and order quantity."}
   * @paramDef {"type":"String","label":"Order Status","name":"orderStatus","uiComponent":{"type":"DROPDOWN","options":{"values":["Parked","Placed"]}},"description":"Initial status for the new order. Defaults to Parked."}
   * @paramDef {"type":"String","label":"Warehouse GUID","name":"warehouseGuid","description":"Optional Unleashed GUID of the warehouse to fulfil the order from. Defaults to the account's default warehouse."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional free-text comments to attach to the order."}
   * @returns {Object}
   * @sampleResult {"Guid":"e2c7d67a-1c96-4fa8-bf59-b23c2d69f22a","OrderNumber":"SO-0002","OrderStatus":"Parked","Customer":{"Guid":"b9f21e05-07fe-4d9d-b460-a09db4c3caa9"}}
   */
  async createSalesOrder(customerGuid, salesOrderLines, orderStatus, warehouseGuid, comments) {
    const body = {
      OrderStatus: orderStatus || 'Parked',
      Customer: { Guid: customerGuid },
      SalesOrderLines: (salesOrderLines || []).map(line => ({
        Product: { Guid: line.productGuid },
        OrderQuantity: line.orderQuantity,
        ...(line.unitPrice !== undefined && line.unitPrice !== null ? { UnitPrice: line.unitPrice } : {}),
      })),
    }

    if (warehouseGuid) body.Warehouse = { Guid: warehouseGuid }
    if (comments) body.Comments = comments

    return this.#apiRequest({
      path: '/SalesOrders',
      method: 'post',
      body,
      logTag: 'createSalesOrder',
    })
  }

  // ─── Purchase Orders ───────────────────────────────────────────────────

  /**
   * @operationName Get Purchase Orders
   * @description Retrieves a paginated list of purchase orders, returning order records including supplier, lines, totals, and status. The Items array is unwrapped into a flat list with pagination metadata.
   * @category Purchase Orders
   * @route GET /purchase-orders
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (1-based). Defaults to 1."}
   * @returns {Object}
   * @sampleResult {"pagination":{"NumberOfItems":1,"PageSize":200,"PageNumber":1,"NumberOfPages":1},"items":[{"Guid":"a1c7d67a-1c96-4fa8-bf59-b23c2d69f22a","OrderNumber":"PO-0001","OrderStatus":"Placed"}]}
   */
  async getPurchaseOrders(page) {
    const response = await this.#apiRequest({
      path: `/PurchaseOrders/${ this.#page(page) }`,
      logTag: 'getPurchaseOrders',
    })

    return { pagination: response?.Pagination, items: response?.Items || [] }
  }

  // ─── Warehouses ────────────────────────────────────────────────────────

  /**
   * @operationName Get Warehouses
   * @description Retrieves the full list of warehouses configured in the Unleashed account, returning each warehouse's GUID, code, name, address, and default flag. The Items array is unwrapped into a flat list.
   * @category Warehouses
   * @route GET /warehouses
   * @returns {Object}
   * @sampleResult {"pagination":{"NumberOfItems":1,"PageSize":200,"PageNumber":1,"NumberOfPages":1},"items":[{"Guid":"dba8974c-f12f-423d-b2c7-194847e54834","WarehouseCode":"MAIN","WarehouseName":"Main Warehouse","IsDefault":true}]}
   */
  async getWarehouses() {
    const response = await this.#apiRequest({
      path: '/Warehouses',
      logTag: 'getWarehouses',
    })

    return { pagination: response?.Pagination, items: response?.Items || [] }
  }
}

/**
 * @typedef {Object} SalesOrderLineInput
 * @property {String} productGuid The Unleashed GUID of the product for this line.
 * @property {Number} orderQuantity The quantity of the product being ordered.
 * @property {Number} [unitPrice] Optional unit price; when omitted, Unleashed uses the product's default sell price.
 */

Flowrunner.ServerCode.addService(UnleashedSoftware, [
  {
    name: 'apiId',
    displayName: 'API ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Unleashed API ID. In Unleashed go to Integration → Unleashed API → API ID.',
  },
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Unleashed API Key, shown alongside the API ID in Integration → Unleashed API.',
  },
])
