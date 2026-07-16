const logger = {
  info: (...args) => console.log('[Magento 2] info:', ...args),
  debug: (...args) => console.log('[Magento 2] debug:', ...args),
  error: (...args) => console.log('[Magento 2] error:', ...args),
  warn: (...args) => console.log('[Magento 2] warn:', ...args),
}

/**
 * Removes undefined, null and empty-string values from a flat object.
 */
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
 * @integrationName Magento 2
 * @integrationIcon /icon.svg
 */
class Magento2Service {
  constructor(config) {
    this.baseUrl = (config.baseUrl || '').replace(/\/+$/, '')
    this.accessToken = config.accessToken
    this.apiBaseUrl = `${ this.baseUrl }/rest/V1`
  }

  /**
   * Single private request helper. Flowrunner.Request returns the response body directly.
   * Magento errors surface parameterized messages: { message: "%1 ...", parameters: [...] }.
   */
  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const url = `${ this.apiBaseUrl }${ path }`

    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.accessToken }`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        })
        .query(cleanedQuery)

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = this.#formatMagentoError(error)

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Magento 2 API error: ${ message }`)
    }
  }

  /**
   * Interpolates Magento's parameterized error messages: "%1" placeholders are
   * replaced with values from body.parameters (array or object keyed by name).
   */
  #formatMagentoError(error) {
    const body = error.body || {}
    let message = body.message || error.message

    if (!message) {
      return 'Unknown error'
    }

    const params = body.parameters

    if (params) {
      if (Array.isArray(params)) {
        params.forEach((value, index) => {
          message = message.split(`%${ index + 1 }`).join(String(value))
        })
      } else if (typeof params === 'object') {
        Object.keys(params).forEach(key => {
          message = message.split(`%${ key }`).join(String(params[key]))
        })
      }
    }

    return message
  }

  /**
   * Flattens filters, pagination and sort orders into Magento's verbose
   * searchCriteria query string keys.
   *
   * Magento uses snake_case filter_groups / condition_type but camelCase
   * pageSize / currentPage. Each filter goes into its own filter group (AND
   * semantics between groups), which is the most common expectation for a
   * simple filter list.
   *
   * @param {Array<Object>} filters   [{ field, value, conditionType }]
   * @param {Number}        pageSize
   * @param {Number}        currentPage
   * @param {Array<Object>} sortOrders [{ field, direction }]
   * @returns {Object} flat query object ready for .query(...)
   */
  #buildSearchCriteria(filters, pageSize, currentPage, sortOrders) {
    const query = {}

    const filterList = Array.isArray(filters) ? filters : []

    filterList.forEach((filter, groupIndex) => {
      if (!filter || filter.field === undefined || filter.field === null || filter.field === '') {
        return
      }

      const prefix = `searchCriteria[filter_groups][${ groupIndex }][filters][0]`

      query[`${ prefix }[field]`] = filter.field

      if (filter.value !== undefined && filter.value !== null) {
        query[`${ prefix }[value]`] = filter.value
      }

      if (filter.conditionType) {
        query[`${ prefix }[condition_type]`] = filter.conditionType
      }
    })

    const sortList = Array.isArray(sortOrders) ? sortOrders : []

    sortList.forEach((sort, index) => {
      if (!sort || !sort.field) {
        return
      }

      query[`searchCriteria[sortOrders][${ index }][field]`] = sort.field
      query[`searchCriteria[sortOrders][${ index }][direction]`] = (sort.direction || 'ASC').toUpperCase()
    })

    if (pageSize !== undefined && pageSize !== null && pageSize !== '') {
      query['searchCriteria[pageSize]'] = pageSize
    }

    if (currentPage !== undefined && currentPage !== null && currentPage !== '') {
      query['searchCriteria[currentPage]'] = currentPage
    }

    // Ensure at least an empty searchCriteria is sent so Magento returns a list.
    if (Object.keys(query).length === 0) {
      query['searchCriteria'] = ''
    }

    return query
  }

  // =========================================================================
  // Products
  // =========================================================================

  /**
   * @operationName List Products
   * @category Products
   * @description Retrieves a paginated list of catalog products using Magento searchCriteria filters. Provide an array of filters (each with field, value and conditionType) to narrow results — e.g. filter by status, type_id, name (with a "like" condition and % wildcards) or price. Returns matching product items plus total_count and the applied search_criteria.
   * @route GET /products
   *
   * @paramDef {"type":"Array<Object>","label":"Filters","name":"filters","required":false,"description":"searchCriteria filters. Each item: {field, value, conditionType}. conditionType is one of eq, neq, like, gt, lt, gteq, lteq, in, nin, from, to. Example: [{\"field\":\"status\",\"value\":1,\"conditionType\":\"eq\"}]. Use % wildcards with like."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"required":false,"description":"Number of products per page (default 20)."}
   * @paramDef {"type":"Number","label":"Current Page","name":"currentPage","uiComponent":{"type":"NUMERIC_STEPPER"},"required":false,"description":"Page number to retrieve, starting at 1 (default 1)."}
   * @paramDef {"type":"Array<Object>","label":"Sort Orders","name":"sortOrders","required":false,"description":"Optional sort orders. Each item: {field, direction} where direction is ASC or DESC. Example: [{\"field\":\"created_at\",\"direction\":\"DESC\"}]."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":1,"sku":"24-MB01","name":"Joust Duffle Bag","attribute_set_id":15,"price":34,"status":1,"visibility":4,"type_id":"simple","created_at":"2023-01-01 00:00:00"}],"search_criteria":{"filter_groups":[],"page_size":20,"current_page":1},"total_count":2045}
   */
  async listProducts(filters, pageSize, currentPage, sortOrders) {
    return await this.#apiRequest({
      logTag: '[listProducts]',
      path: '/products',
      method: 'get',
      query: this.#buildSearchCriteria(filters, pageSize || 20, currentPage || 1, sortOrders),
    })
  }

  /**
   * @operationName Get Product
   * @category Products
   * @description Retrieves a single catalog product by its SKU, including price, status, visibility, type, attribute set and custom attributes.
   * @route GET /products/{sku}
   *
   * @paramDef {"type":"String","label":"SKU","name":"sku","required":true,"description":"The product SKU to retrieve (e.g. 24-MB01)."}
   *
   * @returns {Object}
   * @sampleResult {"id":1,"sku":"24-MB01","name":"Joust Duffle Bag","attribute_set_id":15,"price":34,"status":1,"visibility":4,"type_id":"simple","weight":1,"custom_attributes":[{"attribute_code":"description","value":"<p>The sporty Joust Duffle Bag.</p>"}]}
   */
  async getProduct(sku) {
    return await this.#apiRequest({
      logTag: '[getProduct]',
      path: `/products/${ encodeURIComponent(sku) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Product
   * @category Products
   * @description Creates a new catalog product. SKU and name are required. Status is Enabled/Disabled and Visibility controls where the product appears (Not Visible, Catalog, Search, or Catalog & Search). Use custom attributes for attributes such as description, url_key or category_ids. Defaults: attribute set 4 (Default), type "simple".
   * @route POST /products
   *
   * @paramDef {"type":"String","label":"SKU","name":"sku","required":true,"description":"Unique product SKU."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Product display name."}
   * @paramDef {"type":"Number","label":"Price","name":"price","uiComponent":{"type":"NUMERIC_STEPPER"},"required":false,"description":"Product price."}
   * @paramDef {"type":"Number","label":"Attribute Set ID","name":"attributeSetId","uiComponent":{"type":"NUMERIC_STEPPER"},"required":false,"description":"Attribute set ID (default 4, the Default set)."}
   * @paramDef {"type":"String","label":"Type","name":"typeId","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Simple","Virtual","Downloadable","Configurable","Grouped","Bundle"]}},"description":"Product type. Defaults to Simple."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Enabled","Disabled"]}},"description":"Product status. Defaults to Enabled."}
   * @paramDef {"type":"String","label":"Visibility","name":"visibility","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Not Visible Individually","Catalog","Search","Catalog, Search"]}},"description":"Where the product is visible. Defaults to Catalog, Search."}
   * @paramDef {"type":"Number","label":"Weight","name":"weight","uiComponent":{"type":"NUMERIC_STEPPER"},"required":false,"description":"Product weight."}
   * @paramDef {"type":"Array<Object>","label":"Custom Attributes","name":"customAttributes","required":false,"description":"Additional attributes. Each item: {attribute_code, value}. Example: [{\"attribute_code\":\"description\",\"value\":\"Great product\"}]."}
   *
   * @returns {Object}
   * @sampleResult {"id":2046,"sku":"NEW-SKU-01","name":"New Product","attribute_set_id":4,"price":19.99,"status":1,"visibility":4,"type_id":"simple","weight":1}
   */
  async createProduct(sku, name, price, attributeSetId, typeId, status, visibility, weight, customAttributes) {
    const product = clean({
      sku,
      name,
      price,
      attribute_set_id: attributeSetId || 4,
      type_id: this.#resolveChoice(typeId, {
        'Simple': 'simple',
        'Virtual': 'virtual',
        'Downloadable': 'downloadable',
        'Configurable': 'configurable',
        'Grouped': 'grouped',
        'Bundle': 'bundle',
      }) || 'simple',
      status: this.#resolveChoice(status, { 'Enabled': 1, 'Disabled': 2 }) ?? 1,
      visibility: this.#resolveChoice(visibility, {
        'Not Visible Individually': 1,
        'Catalog': 2,
        'Search': 3,
        'Catalog, Search': 4,
      }) ?? 4,
      weight,
    })

    if (Array.isArray(customAttributes) && customAttributes.length > 0) {
      product.custom_attributes = customAttributes
    }

    return await this.#apiRequest({
      logTag: '[createProduct]',
      path: '/products',
      method: 'post',
      body: { product },
    })
  }

  /**
   * @operationName Update Product
   * @category Products
   * @description Updates an existing catalog product identified by SKU. Only the fields you provide are changed. Pass custom attributes to update attributes such as description or category assignments.
   * @route PUT /products/{sku}
   *
   * @paramDef {"type":"String","label":"SKU","name":"sku","required":true,"description":"SKU of the product to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":false,"description":"New product name."}
   * @paramDef {"type":"Number","label":"Price","name":"price","uiComponent":{"type":"NUMERIC_STEPPER"},"required":false,"description":"New price."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Enabled","Disabled"]}},"description":"New product status."}
   * @paramDef {"type":"String","label":"Visibility","name":"visibility","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Not Visible Individually","Catalog","Search","Catalog, Search"]}},"description":"New visibility."}
   * @paramDef {"type":"Number","label":"Weight","name":"weight","uiComponent":{"type":"NUMERIC_STEPPER"},"required":false,"description":"New weight."}
   * @paramDef {"type":"Array<Object>","label":"Custom Attributes","name":"customAttributes","required":false,"description":"Attributes to update. Each item: {attribute_code, value}."}
   *
   * @returns {Object}
   * @sampleResult {"id":2046,"sku":"NEW-SKU-01","name":"Updated Product","attribute_set_id":4,"price":24.99,"status":1,"visibility":4,"type_id":"simple"}
   */
  async updateProduct(sku, name, price, status, visibility, weight, customAttributes) {
    const product = clean({
      sku,
      name,
      price,
      status: this.#resolveChoice(status, { 'Enabled': 1, 'Disabled': 2 }),
      visibility: this.#resolveChoice(visibility, {
        'Not Visible Individually': 1,
        'Catalog': 2,
        'Search': 3,
        'Catalog, Search': 4,
      }),
      weight,
    })

    if (Array.isArray(customAttributes) && customAttributes.length > 0) {
      product.custom_attributes = customAttributes
    }

    return await this.#apiRequest({
      logTag: '[updateProduct]',
      path: `/products/${ encodeURIComponent(sku) }`,
      method: 'put',
      body: { product },
    })
  }

  /**
   * @operationName Delete Product
   * @category Products
   * @description Permanently deletes a catalog product by SKU. Returns true on success.
   * @route DELETE /products/{sku}
   *
   * @paramDef {"type":"String","label":"SKU","name":"sku","required":true,"description":"SKU of the product to delete."}
   *
   * @returns {Boolean}
   * @sampleResult {"result":true}
   */
  async deleteProduct(sku) {
    const result = await this.#apiRequest({
      logTag: '[deleteProduct]',
      path: `/products/${ encodeURIComponent(sku) }`,
      method: 'delete',
    })

    return { result }
  }

  /**
   * @operationName Update Stock
   * @category Products
   * @description Updates the stock item (quantity and stock status) for a product SKU. Requires the stock item ID, which you can find on the product's stockItems data. Set quantity and whether the product is in stock.
   * @route PUT /products/{sku}/stockItems/{itemId}
   *
   * @paramDef {"type":"String","label":"SKU","name":"sku","required":true,"description":"Product SKU whose stock is being updated."}
   * @paramDef {"type":"Number","label":"Stock Item ID","name":"itemId","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"description":"The stock item ID (item_id) for the product."}
   * @paramDef {"type":"Number","label":"Quantity","name":"qty","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"description":"New quantity on hand."}
   * @paramDef {"type":"Boolean","label":"Is In Stock","name":"isInStock","uiComponent":{"type":"TOGGLE"},"required":false,"description":"Whether the product is in stock. Defaults to true."}
   *
   * @returns {Number}
   * @sampleResult {"result":1}
   */
  async updateStock(sku, itemId, qty, isInStock) {
    const result = await this.#apiRequest({
      logTag: '[updateStock]',
      path: `/products/${ encodeURIComponent(sku) }/stockItems/${ itemId }`,
      method: 'put',
      body: {
        stockItem: {
          qty,
          is_in_stock: isInStock === undefined ? true : isInStock,
        },
      },
    })

    return { result }
  }

  /**
   * @operationName Get Stock Item
   * @category Products
   * @description Retrieves the stock item (inventory) details for a product SKU, including quantity, stock status, and the item_id needed to update stock.
   * @route GET /stockItems/{sku}
   *
   * @paramDef {"type":"String","label":"SKU","name":"sku","required":true,"description":"Product SKU to look up stock for."}
   *
   * @returns {Object}
   * @sampleResult {"item_id":1,"product_id":1,"stock_id":1,"qty":100,"is_in_stock":true,"manage_stock":true,"min_qty":0}
   */
  async getStockItem(sku) {
    return await this.#apiRequest({
      logTag: '[getStockItem]',
      path: `/stockItems/${ encodeURIComponent(sku) }`,
      method: 'get',
    })
  }

  // =========================================================================
  // Orders
  // =========================================================================

  /**
   * @operationName List Orders
   * @category Orders
   * @description Retrieves a paginated list of sales orders using searchCriteria filters. Common filters: status (e.g. pending, processing, complete, canceled, holded), customer_email, created_at (with from/to conditions). Returns order items plus total_count.
   * @route GET /orders
   *
   * @paramDef {"type":"Array<Object>","label":"Filters","name":"filters","required":false,"description":"searchCriteria filters. Each item: {field, value, conditionType}. Example: [{\"field\":\"status\",\"value\":\"pending\",\"conditionType\":\"eq\"}] or a date range with created_at + from/to."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"required":false,"description":"Orders per page (default 20)."}
   * @paramDef {"type":"Number","label":"Current Page","name":"currentPage","uiComponent":{"type":"NUMERIC_STEPPER"},"required":false,"description":"Page number, starting at 1 (default 1)."}
   * @paramDef {"type":"Array<Object>","label":"Sort Orders","name":"sortOrders","required":false,"description":"Optional sort orders. Each item: {field, direction} (ASC/DESC)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"entity_id":1,"increment_id":"000000001","status":"pending","customer_email":"jane@example.com","grand_total":36.39,"created_at":"2023-06-01 12:00:00"}],"total_count":150}
   */
  async listOrders(filters, pageSize, currentPage, sortOrders) {
    return await this.#apiRequest({
      logTag: '[listOrders]',
      path: '/orders',
      method: 'get',
      query: this.#buildSearchCriteria(filters, pageSize || 20, currentPage || 1, sortOrders),
    })
  }

  /**
   * @operationName Get Order
   * @category Orders
   * @description Retrieves a single sales order by its entity ID, including line items, totals, status, addresses and payment information.
   * @route GET /orders/{id}
   *
   * @paramDef {"type":"Number","label":"Order ID","name":"id","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"description":"The order entity ID."}
   *
   * @returns {Object}
   * @sampleResult {"entity_id":1,"increment_id":"000000001","status":"processing","state":"processing","customer_email":"jane@example.com","grand_total":36.39,"items":[{"item_id":1,"sku":"24-MB01","qty_ordered":1,"price":34}]}
   */
  async getOrder(id) {
    return await this.#apiRequest({
      logTag: '[getOrder]',
      path: `/orders/${ id }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Invoice for Order
   * @category Orders
   * @description Creates an invoice for an order, optionally capturing payment and notifying the customer. Leave items empty to invoice all invoiceable items, or provide specific order item IDs and quantities. Returns the new invoice ID.
   * @route POST /order/{orderId}/invoice
   *
   * @paramDef {"type":"Number","label":"Order ID","name":"orderId","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"description":"The order entity ID to invoice."}
   * @paramDef {"type":"Boolean","label":"Capture Payment","name":"capture","uiComponent":{"type":"TOGGLE"},"required":false,"description":"Whether to capture payment when creating the invoice. Defaults to false."}
   * @paramDef {"type":"Boolean","label":"Notify Customer","name":"notify","uiComponent":{"type":"TOGGLE"},"required":false,"description":"Whether to email the invoice to the customer. Defaults to false."}
   * @paramDef {"type":"Array<Object>","label":"Items","name":"items","required":false,"description":"Optional specific items to invoice. Each item: {order_item_id, qty}. Leave empty to invoice all invoiceable items."}
   *
   * @returns {Number}
   * @sampleResult {"invoiceId":5}
   */
  async createInvoiceForOrder(orderId, capture, notify, items) {
    const body = clean({
      capture: capture === undefined ? false : capture,
      notify: notify === undefined ? false : notify,
    })

    if (Array.isArray(items) && items.length > 0) {
      body.items = items
    }

    const invoiceId = await this.#apiRequest({
      logTag: '[createInvoiceForOrder]',
      path: `/order/${ orderId }/invoice`,
      method: 'post',
      body,
    })

    return { invoiceId }
  }

  /**
   * @operationName Create Shipment
   * @category Orders
   * @description Creates a shipment for an order, optionally with specific items and tracking numbers, and can notify the customer. Leave items empty to ship all shippable items. Returns the new shipment ID.
   * @route POST /order/{orderId}/ship
   *
   * @paramDef {"type":"Number","label":"Order ID","name":"orderId","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"description":"The order entity ID to ship."}
   * @paramDef {"type":"Array<Object>","label":"Items","name":"items","required":false,"description":"Optional items to ship. Each item: {order_item_id, qty}. Leave empty to ship all shippable items."}
   * @paramDef {"type":"Array<Object>","label":"Tracks","name":"tracks","required":false,"description":"Optional tracking entries. Each item: {track_number, title, carrier_code}. Example: [{\"track_number\":\"1Z999\",\"title\":\"UPS\",\"carrier_code\":\"ups\"}]."}
   * @paramDef {"type":"Boolean","label":"Notify Customer","name":"notify","uiComponent":{"type":"TOGGLE"},"required":false,"description":"Whether to email the shipment to the customer. Defaults to false."}
   *
   * @returns {Number}
   * @sampleResult {"shipmentId":3}
   */
  async createShipment(orderId, items, tracks, notify) {
    const body = clean({
      notify: notify === undefined ? false : notify,
    })

    if (Array.isArray(items) && items.length > 0) {
      body.items = items
    }

    if (Array.isArray(tracks) && tracks.length > 0) {
      body.tracks = tracks
    }

    const shipmentId = await this.#apiRequest({
      logTag: '[createShipment]',
      path: `/order/${ orderId }/ship`,
      method: 'post',
      body,
    })

    return { shipmentId }
  }

  /**
   * @operationName Add Order Comment
   * @category Orders
   * @description Adds a comment to an order's status history, optionally changing the order status and notifying the customer.
   * @route POST /orders/{id}/comments
   *
   * @paramDef {"type":"Number","label":"Order ID","name":"id","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"description":"The order entity ID."}
   * @paramDef {"type":"String","label":"Comment","name":"comment","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The comment text."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"description":"Optional order status to set alongside the comment (e.g. processing, complete)."}
   * @paramDef {"type":"Boolean","label":"Notify Customer","name":"isCustomerNotified","uiComponent":{"type":"TOGGLE"},"required":false,"description":"Whether to email the comment to the customer. Defaults to false."}
   *
   * @returns {Boolean}
   * @sampleResult {"result":true}
   */
  async addOrderComment(id, comment, status, isCustomerNotified) {
    const result = await this.#apiRequest({
      logTag: '[addOrderComment]',
      path: `/orders/${ id }/comments`,
      method: 'post',
      body: {
        statusHistory: clean({
          comment,
          status,
          is_customer_notified: isCustomerNotified ? 1 : 0,
        }),
      },
    })

    return { result }
  }

  /**
   * @operationName Cancel Order
   * @category Orders
   * @description Cancels an order by its entity ID. Only orders in a cancelable state can be canceled. Returns true on success.
   * @route POST /orders/{id}/cancel
   *
   * @paramDef {"type":"Number","label":"Order ID","name":"id","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"description":"The order entity ID to cancel."}
   *
   * @returns {Boolean}
   * @sampleResult {"result":true}
   */
  async cancelOrder(id) {
    const result = await this.#apiRequest({
      logTag: '[cancelOrder]',
      path: `/orders/${ id }/cancel`,
      method: 'post',
    })

    return { result }
  }

  /**
   * @operationName Hold Order
   * @category Orders
   * @description Places an order on hold by its entity ID. A held order cannot be invoiced or shipped until it is unheld. Returns true on success.
   * @route POST /orders/{id}/hold
   *
   * @paramDef {"type":"Number","label":"Order ID","name":"id","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"description":"The order entity ID to hold."}
   *
   * @returns {Boolean}
   * @sampleResult {"result":true}
   */
  async holdOrder(id) {
    const result = await this.#apiRequest({
      logTag: '[holdOrder]',
      path: `/orders/${ id }/hold`,
      method: 'post',
    })

    return { result }
  }

  /**
   * @operationName Unhold Order
   * @category Orders
   * @description Releases an order from hold by its entity ID, returning it to its previous state. Returns true on success.
   * @route POST /orders/{id}/unhold
   *
   * @paramDef {"type":"Number","label":"Order ID","name":"id","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"description":"The order entity ID to unhold."}
   *
   * @returns {Boolean}
   * @sampleResult {"result":true}
   */
  async unholdOrder(id) {
    const result = await this.#apiRequest({
      logTag: '[unholdOrder]',
      path: `/orders/${ id }/unhold`,
      method: 'post',
    })

    return { result }
  }

  // =========================================================================
  // Customers
  // =========================================================================

  /**
   * @operationName List Customers
   * @category Customers
   * @description Searches customers using searchCriteria filters. Common filters: email, firstname, lastname, created_at, group_id. Returns matching customer items plus total_count.
   * @route GET /customers/search
   *
   * @paramDef {"type":"Array<Object>","label":"Filters","name":"filters","required":false,"description":"searchCriteria filters. Each item: {field, value, conditionType}. Example: [{\"field\":\"email\",\"value\":\"%example.com\",\"conditionType\":\"like\"}]."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"required":false,"description":"Customers per page (default 20)."}
   * @paramDef {"type":"Number","label":"Current Page","name":"currentPage","uiComponent":{"type":"NUMERIC_STEPPER"},"required":false,"description":"Page number, starting at 1 (default 1)."}
   * @paramDef {"type":"Array<Object>","label":"Sort Orders","name":"sortOrders","required":false,"description":"Optional sort orders. Each item: {field, direction} (ASC/DESC)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":1,"email":"jane@example.com","firstname":"Jane","lastname":"Doe","group_id":1,"created_at":"2023-01-01 00:00:00"}],"total_count":42}
   */
  async listCustomers(filters, pageSize, currentPage, sortOrders) {
    return await this.#apiRequest({
      logTag: '[listCustomers]',
      path: '/customers/search',
      method: 'get',
      query: this.#buildSearchCriteria(filters, pageSize || 20, currentPage || 1, sortOrders),
    })
  }

  /**
   * @operationName Get Customer
   * @category Customers
   * @description Retrieves a single customer by ID, including email, name, group, store, and address book.
   * @route GET /customers/{id}
   *
   * @paramDef {"type":"Number","label":"Customer ID","name":"id","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"description":"The customer ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":1,"email":"jane@example.com","firstname":"Jane","lastname":"Doe","group_id":1,"store_id":1,"website_id":1,"addresses":[]}
   */
  async getCustomer(id) {
    return await this.#apiRequest({
      logTag: '[getCustomer]',
      path: `/customers/${ id }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Customer
   * @category Customers
   * @description Creates a new customer account. Email, first name and last name are required. Optionally set a password (otherwise the customer must set one via email), and the website and customer group.
   * @route POST /customers
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Customer email address (used as the login)."}
   * @paramDef {"type":"String","label":"First Name","name":"firstname","required":true,"description":"Customer first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastname","required":true,"description":"Customer last name."}
   * @paramDef {"type":"String","label":"Password","name":"password","required":false,"description":"Optional account password. If omitted, the customer receives an email to set one."}
   * @paramDef {"type":"Number","label":"Website ID","name":"websiteId","uiComponent":{"type":"NUMERIC_STEPPER"},"required":false,"description":"Website ID the customer belongs to (default 1)."}
   * @paramDef {"type":"Number","label":"Group ID","name":"groupId","uiComponent":{"type":"NUMERIC_STEPPER"},"required":false,"description":"Customer group ID (default 1, General)."}
   *
   * @returns {Object}
   * @sampleResult {"id":2,"email":"new@example.com","firstname":"New","lastname":"Customer","group_id":1,"website_id":1,"store_id":1}
   */
  async createCustomer(email, firstname, lastname, password, websiteId, groupId) {
    const body = {
      customer: clean({
        email,
        firstname,
        lastname,
        website_id: websiteId,
        group_id: groupId,
      }),
    }

    if (password) {
      body.password = password
    }

    return await this.#apiRequest({
      logTag: '[createCustomer]',
      path: '/customers',
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Update Customer
   * @category Customers
   * @description Updates an existing customer identified by ID. Only the fields you provide are changed. Note that Magento requires the email on update, so it is always sent when provided.
   * @route PUT /customers/{id}
   *
   * @paramDef {"type":"Number","label":"Customer ID","name":"id","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"description":"The customer ID to update."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":false,"description":"New email address."}
   * @paramDef {"type":"String","label":"First Name","name":"firstname","required":false,"description":"New first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastname","required":false,"description":"New last name."}
   * @paramDef {"type":"Number","label":"Group ID","name":"groupId","uiComponent":{"type":"NUMERIC_STEPPER"},"required":false,"description":"New customer group ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":2,"email":"updated@example.com","firstname":"Updated","lastname":"Customer","group_id":2,"website_id":1}
   */
  async updateCustomer(id, email, firstname, lastname, groupId) {
    return await this.#apiRequest({
      logTag: '[updateCustomer]',
      path: `/customers/${ id }`,
      method: 'put',
      body: {
        customer: clean({
          id,
          email,
          firstname,
          lastname,
          group_id: groupId,
        }),
      },
    })
  }

  /**
   * @operationName Delete Customer
   * @category Customers
   * @description Permanently deletes a customer account by ID. Returns true on success.
   * @route DELETE /customers/{id}
   *
   * @paramDef {"type":"Number","label":"Customer ID","name":"id","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"description":"The customer ID to delete."}
   *
   * @returns {Boolean}
   * @sampleResult {"result":true}
   */
  async deleteCustomer(id) {
    const result = await this.#apiRequest({
      logTag: '[deleteCustomer]',
      path: `/customers/${ id }`,
      method: 'delete',
    })

    return { result }
  }

  // =========================================================================
  // Categories
  // =========================================================================

  /**
   * @operationName List Categories
   * @category Categories
   * @description Retrieves the category tree starting from a root category. Returns a nested tree with each category's id, name, is_active, level, and children_data. Optionally set the root category ID and how many levels deep to traverse.
   * @route GET /categories
   *
   * @paramDef {"type":"Number","label":"Root Category ID","name":"rootCategoryId","uiComponent":{"type":"NUMERIC_STEPPER"},"required":false,"description":"Category ID to start the tree from. Defaults to the store root."}
   * @paramDef {"type":"Number","label":"Depth","name":"depth","uiComponent":{"type":"NUMERIC_STEPPER"},"required":false,"description":"Number of levels to include below the root. Leave empty for the full tree."}
   *
   * @returns {Object}
   * @sampleResult {"id":2,"name":"Default Category","is_active":true,"level":1,"children_data":[{"id":3,"name":"Gear","is_active":true,"level":2,"children_data":[]}]}
   */
  async listCategories(rootCategoryId, depth) {
    return await this.#apiRequest({
      logTag: '[listCategories]',
      path: '/categories',
      method: 'get',
      query: clean({
        rootCategoryId,
        depth,
      }),
    })
  }

  /**
   * @operationName Get Category
   * @category Categories
   * @description Retrieves a single category by ID, including name, parent, active status, path, and custom attributes.
   * @route GET /categories/{id}
   *
   * @paramDef {"type":"Number","label":"Category ID","name":"id","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"description":"The category ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":3,"parent_id":2,"name":"Gear","is_active":true,"position":1,"level":2,"path":"1/2/3","include_in_menu":true}
   */
  async getCategory(id) {
    return await this.#apiRequest({
      logTag: '[getCategory]',
      path: `/categories/${ id }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Category
   * @category Categories
   * @description Creates a new category under a parent category. Name is required. Set the parent category ID (defaults to the store root, 2) and whether the category is active.
   * @route POST /categories
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Category name."}
   * @paramDef {"type":"Number","label":"Parent ID","name":"parentId","uiComponent":{"type":"NUMERIC_STEPPER"},"required":false,"dictionary":"getCategoriesDictionary","description":"Parent category ID (default 2, the default root category). Search and select a category."}
   * @paramDef {"type":"Boolean","label":"Is Active","name":"isActive","uiComponent":{"type":"TOGGLE"},"required":false,"description":"Whether the category is active. Defaults to true."}
   *
   * @returns {Object}
   * @sampleResult {"id":10,"parent_id":2,"name":"New Category","is_active":true,"position":5,"level":2}
   */
  async createCategory(name, parentId, isActive) {
    return await this.#apiRequest({
      logTag: '[createCategory]',
      path: '/categories',
      method: 'post',
      body: {
        category: clean({
          name,
          parent_id: parentId || 2,
          is_active: isActive === undefined ? true : isActive,
        }),
      },
    })
  }

  /**
   * @operationName Get Products in Category
   * @category Categories
   * @description Retrieves the list of products assigned to a category, with each product's SKU, position, and category ID.
   * @route GET /categories/{id}/products
   *
   * @paramDef {"type":"Number","label":"Category ID","name":"id","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"dictionary":"getCategoriesDictionary","description":"The category ID to list products for."}
   *
   * @returns {Array<Object>}
   * @sampleResult {"products":[{"sku":"24-MB01","position":1,"category_id":"3"},{"sku":"24-MB04","position":2,"category_id":"3"}]}
   */
  async getProductsInCategory(id) {
    const products = await this.#apiRequest({
      logTag: '[getProductsInCategory]',
      path: `/categories/${ id }/products`,
      method: 'get',
    })

    return { products }
  }

  // =========================================================================
  // Invoices / Shipments / Credit Memos
  // =========================================================================

  /**
   * @operationName List Invoices
   * @category Sales Documents
   * @description Retrieves a paginated list of invoices using searchCriteria filters. Common filters: order_id, state, created_at. Returns invoice items plus total_count.
   * @route GET /invoices
   *
   * @paramDef {"type":"Array<Object>","label":"Filters","name":"filters","required":false,"description":"searchCriteria filters. Each item: {field, value, conditionType}. Example: [{\"field\":\"order_id\",\"value\":1,\"conditionType\":\"eq\"}]."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"required":false,"description":"Invoices per page (default 20)."}
   * @paramDef {"type":"Number","label":"Current Page","name":"currentPage","uiComponent":{"type":"NUMERIC_STEPPER"},"required":false,"description":"Page number, starting at 1 (default 1)."}
   * @paramDef {"type":"Array<Object>","label":"Sort Orders","name":"sortOrders","required":false,"description":"Optional sort orders. Each item: {field, direction} (ASC/DESC)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"entity_id":1,"increment_id":"000000001","order_id":1,"state":2,"grand_total":36.39,"created_at":"2023-06-01 12:05:00"}],"total_count":80}
   */
  async listInvoices(filters, pageSize, currentPage, sortOrders) {
    return await this.#apiRequest({
      logTag: '[listInvoices]',
      path: '/invoices',
      method: 'get',
      query: this.#buildSearchCriteria(filters, pageSize || 20, currentPage || 1, sortOrders),
    })
  }

  /**
   * @operationName Get Invoice
   * @category Sales Documents
   * @description Retrieves a single invoice by its entity ID, including line items and totals.
   * @route GET /invoices/{id}
   *
   * @paramDef {"type":"Number","label":"Invoice ID","name":"id","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"description":"The invoice entity ID."}
   *
   * @returns {Object}
   * @sampleResult {"entity_id":1,"increment_id":"000000001","order_id":1,"state":2,"grand_total":36.39,"items":[{"entity_id":1,"sku":"24-MB01","qty":1,"price":34}]}
   */
  async getInvoice(id) {
    return await this.#apiRequest({
      logTag: '[getInvoice]',
      path: `/invoices/${ id }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Shipments
   * @category Sales Documents
   * @description Retrieves a paginated list of shipments using searchCriteria filters. Common filters: order_id, created_at. Returns shipment items plus total_count.
   * @route GET /shipments
   *
   * @paramDef {"type":"Array<Object>","label":"Filters","name":"filters","required":false,"description":"searchCriteria filters. Each item: {field, value, conditionType}. Example: [{\"field\":\"order_id\",\"value\":1,\"conditionType\":\"eq\"}]."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"required":false,"description":"Shipments per page (default 20)."}
   * @paramDef {"type":"Number","label":"Current Page","name":"currentPage","uiComponent":{"type":"NUMERIC_STEPPER"},"required":false,"description":"Page number, starting at 1 (default 1)."}
   * @paramDef {"type":"Array<Object>","label":"Sort Orders","name":"sortOrders","required":false,"description":"Optional sort orders. Each item: {field, direction} (ASC/DESC)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"entity_id":1,"increment_id":"000000001","order_id":1,"total_qty":1,"created_at":"2023-06-02 09:00:00"}],"total_count":60}
   */
  async listShipments(filters, pageSize, currentPage, sortOrders) {
    return await this.#apiRequest({
      logTag: '[listShipments]',
      path: '/shipments',
      method: 'get',
      query: this.#buildSearchCriteria(filters, pageSize || 20, currentPage || 1, sortOrders),
    })
  }

  /**
   * @operationName List Credit Memos
   * @category Sales Documents
   * @description Retrieves a paginated list of credit memos (refunds) using searchCriteria filters. Common filters: order_id, state, created_at. Returns credit memo items plus total_count.
   * @route GET /creditmemos
   *
   * @paramDef {"type":"Array<Object>","label":"Filters","name":"filters","required":false,"description":"searchCriteria filters. Each item: {field, value, conditionType}. Example: [{\"field\":\"order_id\",\"value\":1,\"conditionType\":\"eq\"}]."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"required":false,"description":"Credit memos per page (default 20)."}
   * @paramDef {"type":"Number","label":"Current Page","name":"currentPage","uiComponent":{"type":"NUMERIC_STEPPER"},"required":false,"description":"Page number, starting at 1 (default 1)."}
   * @paramDef {"type":"Array<Object>","label":"Sort Orders","name":"sortOrders","required":false,"description":"Optional sort orders. Each item: {field, direction} (ASC/DESC)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"entity_id":1,"increment_id":"000000001","order_id":1,"state":2,"grand_total":36.39,"created_at":"2023-06-05 10:00:00"}],"total_count":12}
   */
  async listCreditMemos(filters, pageSize, currentPage, sortOrders) {
    return await this.#apiRequest({
      logTag: '[listCreditMemos]',
      path: '/creditmemos',
      method: 'get',
      query: this.#buildSearchCriteria(filters, pageSize || 20, currentPage || 1, sortOrders),
    })
  }

  // =========================================================================
  // Dictionaries
  // =========================================================================

  /**
   * @typedef {Object} getCategoriesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter categories by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. The category tree is returned in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Categories Dictionary
   * @description Provides a searchable, flattened list of categories from the store category tree for selecting a category (e.g. a parent category). Labels are indented by tree depth; the option value is the numeric category ID.
   * @route POST /get-categories-dictionary
   * @paramDef {"type":"getCategoriesDictionary__payload","label":"Payload","name":"payload","description":"Contains the optional search string used to filter categories by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Default Category","value":"2","note":"Level 1"},{"label":"  Gear","value":"3","note":"Level 2"}],"cursor":null}
   */
  async getCategoriesDictionary(payload) {
    const { search } = payload || {}

    const tree = await this.#apiRequest({
      logTag: '[getCategoriesDictionary]',
      path: '/categories',
      method: 'get',
    })

    const items = []
    const searchLower = (search || '').toLowerCase()

    const walk = node => {
      if (!node) {
        return
      }

      const level = typeof node.level === 'number' ? node.level : 0
      const indent = '  '.repeat(Math.max(0, level - 1))
      const name = node.name || `Category ${ node.id }`

      if (!searchLower || name.toLowerCase().includes(searchLower)) {
        items.push({
          label: `${ indent }${ name }`,
          value: String(node.id),
          note: `Level ${ level }`,
        })
      }

      const children = node.children_data || []

      children.forEach(walk)
    }

    walk(tree)

    return { items, cursor: null }
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  /**
   * Maps a friendly dropdown label to its API value. Returns undefined for
   * empty input and passes through unknown values unchanged.
   */
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }
}

Flowrunner.ServerCode.addService(Magento2Service, [
  {
    name: 'baseUrl',
    displayName: 'Store Base URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Magento store base URL, e.g. https://store.example.com (strip any trailing slash). The service appends /rest/V1.',
  },
  {
    name: 'accessToken',
    displayName: 'Access Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Magento Admin -> System -> Integrations: create an integration and use its Access Token, or an admin bearer token. Sent as Authorization: Bearer <token>.',
  },
])
