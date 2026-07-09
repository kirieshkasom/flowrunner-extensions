'use strict'

const API_BASE_URL = 'https://ssapi.shipstation.com'

// Polling-trigger tuning. Overlap absorbs provider lag (a record can become queryable a few
// minutes after its createDate); the page cap bounds a single poll (ShipStation rate-limits to
// 40 requests/minute); the seen-id set de-dups the overlap window.
const POLL_OVERLAP_MS = 15 * 60 * 1000
const POLL_MAX_PAGES = 25
const POLL_PAGE_SIZE = 250
const POLL_MAX_SEEN_IDS = 5000
// Fallback look-back used only when an account has zero records to seed the watermark from. Wider
// than any real timezone offset so the first real record cannot fall before the window.
const POLL_SEED_LOOKBACK_MS = 24 * 60 * 60 * 1000

const logger = {
  info: (...args) => console.log('[ShipStation Service] info:', ...args),
  debug: (...args) => console.log('[ShipStation Service] debug:', ...args),
  error: (...args) => console.log('[ShipStation Service] error:', ...args),
  warn: (...args) => console.log('[ShipStation Service] warn:', ...args),
}

function clean(obj) {
  if (!obj || typeof obj !== 'object') return obj

  const result = {}

  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null && value !== '') {
      result[key] = value
    }
  }

  return result
}

/**
 * @integrationName ShipStation
 * @integrationIcon /icon.png
 **/
class ShipStation {
  constructor(config) {
    this.apiKey = config.apiKey
    this.apiSecret = config.apiSecret
    this.auth = Buffer.from(`${ this.apiKey }:${ this.apiSecret }`).toString('base64')
  }

  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'
    query = clean(query)

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      const request = Flowrunner.Request[method](url)
        .set({
          Authorization: `Basic ${ this.auth }`,
          'Content-Type': 'application/json',
        })
        .query(query)

      if (body !== undefined && body !== null) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      const apiMessage = error?.body?.ExceptionMessage ||
        error?.body?.Message ||
        error?.body?.message ||
        (typeof error?.body === 'string' ? error.body : null) ||
        error?.message ||
        'Unknown ShipStation API error.'

      logger.error(`${ logTag } - error: ${ apiMessage }`)

      throw new Error(`ShipStation API request failed: ${ apiMessage }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /* ============================================================
   * Dictionary Methods
   * ============================================================ */

  /**
   * @typedef {Object} getCarriersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter carriers by name or code. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Carriers Dictionary
   * @description Provides a searchable list of carriers connected to the ShipStation account for dynamic parameter selection. Returns each carrier's display name and short carrier code (e.g. usps, fedex, ups).
   * @route POST /get-carriers-dictionary
   * @paramDef {"type":"getCarriersDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering carriers."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"FedEx","value":"fedex","note":"Code: fedex"}],"cursor":null}
   */
  async getCarriersDictionary(payload) {
    const { search } = payload || {}

    const carriers = await this.#apiRequest({
      url: `${ API_BASE_URL }/carriers`,
      logTag: 'getCarriersDictionary',
    })

    let items = (carriers || []).map(carrier => ({
      label: carrier.nickname || carrier.name,
      value: carrier.code,
      note: `Code: ${ carrier.code }`,
    }))

    if (search) {
      const term = search.toLowerCase()
      items = items.filter(item => item.label.toLowerCase().includes(term) || item.value.toLowerCase().includes(term))
    }

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} getCarrierServicesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Carrier Code","name":"carrierCode","required":true,"description":"The carrier code (for example 'usps' or 'fedex') whose services should be listed."}
   */

  /**
   * @typedef {Object} getCarrierServicesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter services by name or code. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   * @paramDef {"type":"getCarrierServicesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters identifying the carrier whose services should be returned."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Carrier Services Dictionary
   * @description Provides a searchable list of shipping services available for the selected carrier. The carrier code must be supplied via criteria so that the correct services are returned.
   * @route POST /get-carrier-services-dictionary
   * @paramDef {"type":"getCarrierServicesDictionary__payload","label":"Payload","name":"payload","description":"Contains search, cursor, and criteria for filtering carrier services."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"USPS Priority Mail","value":"usps_priority_mail","note":"Domestic"}],"cursor":null}
   */
  async getCarrierServicesDictionary(payload) {
    const { search, criteria } = payload || {}
    const carrierCode = criteria?.carrierCode

    if (!carrierCode) {
      return { items: [], cursor: null }
    }

    const services = await this.#apiRequest({
      url: `${ API_BASE_URL }/carriers/listservices`,
      query: { carrierCode },
      logTag: 'getCarrierServicesDictionary',
    })

    let items = (services || []).map(service => ({
      label: service.name,
      value: service.code,
      note: service.domestic ? 'Domestic' : 'International',
    }))

    if (search) {
      const term = search.toLowerCase()
      items = items.filter(item => item.label.toLowerCase().includes(term) || item.value.toLowerCase().includes(term))
    }

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} getCarrierPackagesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Carrier Code","name":"carrierCode","required":true,"description":"The carrier code (for example 'usps' or 'fedex') whose package types should be listed."}
   */

  /**
   * @typedef {Object} getCarrierPackagesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter package types by name or code. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   * @paramDef {"type":"getCarrierPackagesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters identifying the carrier whose package types should be returned."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Carrier Packages Dictionary
   * @description Provides a searchable list of package types available for the selected carrier. The carrier code must be supplied via criteria so that the correct package codes are returned.
   * @route POST /get-carrier-packages-dictionary
   * @paramDef {"type":"getCarrierPackagesDictionary__payload","label":"Payload","name":"payload","description":"Contains search, cursor, and criteria for filtering carrier package types."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Package","value":"package","note":"Code: package"}],"cursor":null}
   */
  async getCarrierPackagesDictionary(payload) {
    const { search, criteria } = payload || {}
    const carrierCode = criteria?.carrierCode

    if (!carrierCode) {
      return { items: [], cursor: null }
    }

    const packages = await this.#apiRequest({
      url: `${ API_BASE_URL }/carriers/listpackages`,
      query: { carrierCode },
      logTag: 'getCarrierPackagesDictionary',
    })

    let items = (packages || []).map(pkg => ({
      label: pkg.name,
      value: pkg.code,
      note: `Code: ${ pkg.code }`,
    }))

    if (search) {
      const term = search.toLowerCase()
      items = items.filter(item => item.label.toLowerCase().includes(term) || item.value.toLowerCase().includes(term))
    }

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} getStoresDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter stores by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Stores Dictionary
   * @description Provides a searchable list of stores connected to the ShipStation account for dynamic parameter selection. Includes both active and inactive stores.
   * @route POST /get-stores-dictionary
   * @paramDef {"type":"getStoresDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering stores."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"My Shopify Store","value":12345,"note":"Marketplace: Shopify"}],"cursor":null}
   */
  async getStoresDictionary(payload) {
    const { search } = payload || {}

    const stores = await this.#apiRequest({
      url: `${ API_BASE_URL }/stores`,
      query: { showInactive: true },
      logTag: 'getStoresDictionary',
    })

    let items = (stores || []).map(store => ({
      label: store.storeName,
      value: store.storeId,
      note: store.marketplaceName ? `Marketplace: ${ store.marketplaceName }` : `ID: ${ store.storeId }`,
    }))

    if (search) {
      const term = search.toLowerCase()
      items = items.filter(item => item.label.toLowerCase().includes(term))
    }

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} getWarehousesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter warehouses (Ship From Locations) by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Warehouses Dictionary
   * @description Provides a searchable list of warehouses (called Ship From Locations in the ShipStation UI) for dynamic parameter selection.
   * @route POST /get-warehouses-dictionary
   * @paramDef {"type":"getWarehousesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering warehouses."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Main Warehouse","value":98765,"note":"Default"}],"cursor":null}
   */
  async getWarehousesDictionary(payload) {
    const { search } = payload || {}

    const warehouses = await this.#apiRequest({
      url: `${ API_BASE_URL }/warehouses`,
      logTag: 'getWarehousesDictionary',
    })

    let items = (warehouses || []).map(warehouse => ({
      label: warehouse.warehouseName,
      value: warehouse.warehouseId,
      note: warehouse.isDefault ? 'Default' : `ID: ${ warehouse.warehouseId }`,
    }))

    if (search) {
      const term = search.toLowerCase()
      items = items.filter(item => item.label.toLowerCase().includes(term))
    }

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} getTagsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter tags by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tags Dictionary
   * @description Provides a searchable list of the order tags configured in the ShipStation account for dynamic parameter selection. Returns each tag's name and numeric tag ID.
   * @route POST /get-tags-dictionary
   * @paramDef {"type":"getTagsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering tags."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Backorder","value":8362,"note":"Color: #800080"}],"cursor":null}
   */
  async getTagsDictionary(payload) {
    const { search } = payload || {}

    const tags = await this.#apiRequest({
      url: `${ API_BASE_URL }/accounts/listtags`,
      logTag: 'getTagsDictionary',
    })

    let items = (tags || []).map(tag => ({
      label: tag.name,
      value: tag.tagId,
      note: tag.color ? `Color: ${ tag.color }` : `ID: ${ tag.tagId }`,
    }))

    if (search) {
      const term = search.toLowerCase()
      items = items.filter(item => item.label.toLowerCase().includes(term))
    }

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Order Statuses Dictionary
   * @description Provides the static list of order statuses supported by ShipStation for filtering and updating orders.
   * @route POST /get-order-statuses-dictionary
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Awaiting Shipment","value":"awaiting_shipment","note":"Order ready to ship"}]}
   */
  getOrderStatusesDictionary() {
    return {
      items: [
        { label: 'Awaiting Payment', value: 'awaiting_payment', note: 'Order placed but not paid yet' },
        { label: 'Awaiting Shipment', value: 'awaiting_shipment', note: 'Order ready to ship' },
        { label: 'Pending Fulfillment', value: 'pending_fulfillment', note: 'Order is being fulfilled externally' },
        { label: 'Shipped', value: 'shipped', note: 'Order has been shipped' },
        { label: 'On Hold', value: 'on_hold', note: 'Order is on hold' },
        { label: 'Cancelled', value: 'cancelled', note: 'Order was cancelled' },
        { label: 'Rejected Fulfillment', value: 'rejected_fulfillment', note: 'External fulfillment rejected' },
      ],
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Webhook Events Dictionary
   * @description Provides the static list of webhook event types that can be subscribed to in ShipStation.
   * @route POST /get-webhook-events-dictionary
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Order Notify","value":"ORDER_NOTIFY","note":"Triggered when an order is created or updated"}]}
   */
  getWebhookEventsDictionary() {
    return {
      items: [
        { label: 'Order Notify', value: 'ORDER_NOTIFY', note: 'Triggered when an order is created or updated' },
        { label: 'Item Order Notify', value: 'ITEM_ORDER_NOTIFY', note: 'Triggered for each item on a new or updated order' },
        { label: 'Ship Notify', value: 'SHIP_NOTIFY', note: 'Triggered when a shipment is created' },
        { label: 'Item Ship Notify', value: 'ITEM_SHIP_NOTIFY', note: 'Triggered for each item on a shipment' },
        { label: 'Fulfillment Shipped', value: 'FULFILLMENT_SHIPPED', note: 'Triggered when a fulfillment is shipped' },
        { label: 'Fulfillment Rejected', value: 'FULFILLMENT_REJECTED', note: 'Triggered when a fulfillment is rejected' },
      ],
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Confirmation Types Dictionary
   * @description Provides the static list of delivery confirmation options supported by ShipStation when creating shipments or labels.
   * @route POST /get-confirmation-types-dictionary
   * @returns {Object}
   * @sampleResult {"items":[{"label":"None","value":"none","note":"No confirmation"}]}
   */
  getConfirmationTypesDictionary() {
    return {
      items: [
        { label: 'None', value: 'none', note: 'No confirmation required' },
        { label: 'Delivery', value: 'delivery', note: 'Delivery confirmation' },
        { label: 'Signature', value: 'signature', note: 'Signature required' },
        { label: 'Adult Signature', value: 'adult_signature', note: 'Adult signature required' },
        { label: 'Direct Signature', value: 'direct_signature', note: 'Direct signature required' },
      ],
    }
  }

  /* ============================================================
   * Schema Loader Methods
   * ============================================================ */

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @operationName Insurance Options Fields
   * @description Builds the sub-form for the Insurance Options object on Create Shipment Label - provider, insure flag, and insured value.
   * @route POST /insurance-options-schema
   * @paramDef {"type":"Object","label":"Payload","name":"payload","required":true,"description":"Schema-loader payload (any depends-on values under criteria)."}
   * @returns {Array}
   */
  createInsuranceOptionsSchema() {
    return [
      {
        type: 'String',
        name: 'provider',
        label: 'Insurance Provider',
        required: false,
        description: 'Which insurance provider to use.',
        uiComponent: { type: 'DROPDOWN', options: { values: ['Shipsurance', 'Carrier', 'Third-Party Provider', 'XCover', 'ParcelGuard'] } },
      },
      {
        type: 'Boolean',
        name: 'insureShipment',
        label: 'Insure Shipment',
        required: false,
        description: 'Whether the shipment should be insured.',
        uiComponent: { type: 'TOGGLE' },
      },
      {
        type: 'Number',
        name: 'insuredValue',
        label: 'Insured Value',
        required: false,
        description: 'Declared value to insure, in the account currency.',
        uiComponent: { type: 'NUMERIC_STEPPER' },
      },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @operationName International Options Fields
   * @description Builds the sub-form for the International Options object on Create Shipment Label - customs contents, customs line items, and non-delivery handling.
   * @route POST /international-options-schema
   * @paramDef {"type":"Object","label":"Payload","name":"payload","required":true,"description":"Schema-loader payload (any depends-on values under criteria)."}
   * @returns {Array}
   */
  createInternationalOptionsSchema() {
    return [
      {
        type: 'String',
        name: 'contents',
        label: 'Contents',
        required: false,
        description: 'What the international shipment contains.',
        uiComponent: { type: 'DROPDOWN', options: { values: ['Merchandise', 'Documents', 'Gift', 'Returned Goods', 'Sample'] } },
      },
      {
        type: 'Array',
        name: 'customsItems',
        label: 'Customs Items',
        required: false,
        description: 'Line items for the customs declaration. Each item is an object with: description (string), quantity (number), value (number, USD), harmonizedTariffCode (string), and countryOfOrigin (two-letter ISO code).',
      },
      {
        type: 'String',
        name: 'nonDelivery',
        label: 'Non-Delivery Handling',
        required: false,
        description: 'What the carrier should do if the parcel cannot be delivered.',
        uiComponent: { type: 'DROPDOWN', options: { values: ['Return to Sender', 'Treat as Abandoned'] } },
      },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @operationName Advanced Options Fields
   * @description Builds the sub-form for the Advanced Options object on Create Shipment Label - warehouse, store, handling flags, custom fields, and bill-to settings. Read-only fields (mergedOrSplit, mergedIds, parentId) are omitted.
   * @route POST /advanced-options-schema
   * @paramDef {"type":"Object","label":"Payload","name":"payload","required":true,"description":"Schema-loader payload (any depends-on values under criteria)."}
   * @returns {Array}
   */
  createAdvancedOptionsSchema() {
    return [
      {
        type: 'String',
        name: 'warehouseId',
        label: 'Warehouse',
        required: false,
        description: 'Ship From Location (warehouse) to use for this label.',
        dictionary: 'getWarehousesDictionary',
      },
      {
        type: 'String',
        name: 'storeId',
        label: 'Store',
        required: false,
        description: 'Store to associate with this shipment.',
        dictionary: 'getStoresDictionary',
      },
      {
        type: 'Boolean',
        name: 'nonMachinable',
        label: 'Non-Machinable',
        required: false,
        description: 'Whether the parcel is non-machinable.',
        uiComponent: { type: 'TOGGLE' },
      },
      {
        type: 'Boolean',
        name: 'saturdayDelivery',
        label: 'Saturday Delivery',
        required: false,
        description: 'Whether Saturday delivery is requested.',
        uiComponent: { type: 'TOGGLE' },
      },
      {
        type: 'Boolean',
        name: 'containsAlcohol',
        label: 'Contains Alcohol',
        required: false,
        description: 'Whether the shipment contains alcohol.',
        uiComponent: { type: 'TOGGLE' },
      },
      {
        type: 'String',
        name: 'customField1',
        label: 'Custom Field 1',
        required: false,
        description: 'Custom reference field 1, stored on the shipment.',
      },
      {
        type: 'String',
        name: 'customField2',
        label: 'Custom Field 2',
        required: false,
        description: 'Custom reference field 2, stored on the shipment.',
      },
      {
        type: 'String',
        name: 'customField3',
        label: 'Custom Field 3',
        required: false,
        description: 'Custom reference field 3, stored on the shipment.',
      },
      {
        type: 'String',
        name: 'source',
        label: 'Source',
        required: false,
        description: 'Sales channel or source to attribute the shipment to.',
      },
      {
        type: 'String',
        name: 'billToParty',
        label: 'Bill To Party',
        required: false,
        description: 'Which party is billed for the shipping charges.',
        uiComponent: { type: 'DROPDOWN', options: { values: ['My Account', 'My Other Account', 'Recipient', 'Third Party'] } },
      },
      {
        type: 'String',
        name: 'billToAccount',
        label: 'Bill To Account',
        required: false,
        description: 'Carrier account number billed when Bill To Party is Recipient or Third Party.',
      },
      {
        type: 'String',
        name: 'billToPostalCode',
        label: 'Bill To Postal Code',
        required: false,
        description: 'Postal code of the billed account.',
      },
      {
        type: 'String',
        name: 'billToCountryCode',
        label: 'Bill To Country Code',
        required: false,
        description: 'Two-letter ISO country code of the billed account.',
      },
    ]
  }

  /* ============================================================
   * Order Action Methods
   * ============================================================ */

  /**
   * @description Retrieves a paginated list of orders from ShipStation, with optional filtering by customer, status, store, dates, order number, and item keyword. Useful for syncing orders, building dashboards, or driving order-based automations.
   * @route POST /list-orders
   * @operationName List Orders
   * @category Orders
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Order Status","name":"orderStatus","dictionary":"getOrderStatusesDictionary","description":"Filters orders to those with the specified status. Leave blank to return orders in all statuses."}
   * @paramDef {"type":"String","label":"Store","name":"storeId","dictionary":"getStoresDictionary","description":"Filters orders to a single store. Leave blank to include orders from every store."}
   * @paramDef {"type":"String","label":"Customer Name","name":"customerName","description":"Filters orders to those whose customer name matches the specified value."}
   * @paramDef {"type":"String","label":"Item Keyword","name":"itemKeyword","description":"Searches across SKU, description, and option values on order items."}
   * @paramDef {"type":"String","label":"Order Number","name":"orderNumber","description":"Performs a starts-with search on the order number field."}
   * @paramDef {"type":"String","label":"Create Date Start","name":"createDateStart","uiComponent":{"type":"DATE_PICKER"},"description":"Returns orders created in ShipStation on or after this date."}
   * @paramDef {"type":"String","label":"Create Date End","name":"createDateEnd","uiComponent":{"type":"DATE_PICKER"},"description":"Returns orders created in ShipStation on or before this date."}
   * @paramDef {"type":"String","label":"Modify Date Start","name":"modifyDateStart","uiComponent":{"type":"DATE_PICKER"},"description":"Returns orders modified on or after this date."}
   * @paramDef {"type":"String","label":"Modify Date End","name":"modifyDateEnd","uiComponent":{"type":"DATE_PICKER"},"description":"Returns orders modified on or before this date."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Order Date","Modify Date","Create Date"]}},"description":"Field to sort the result set by."}
   * @paramDef {"type":"String","label":"Sort Direction","name":"sortDir","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction. ASC for ascending, DESC for descending."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (1-based)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of orders per page. Maximum allowed value is 500."}
   *
   * @returns {Object}
   * @sampleResult {"orders":[{"orderId":94113592,"orderNumber":"101","orderKey":"abc","orderDate":"2025-08-20T07:30:00.000","orderStatus":"awaiting_shipment","customerEmail":"buyer@example.com","orderTotal":76.50}],"total":1,"page":1,"pages":1}
   */
  async listOrders(
    orderStatus,
    storeId,
    customerName,
    itemKeyword,
    orderNumber,
    createDateStart,
    createDateEnd,
    modifyDateStart,
    modifyDateEnd,
    sortBy,
    sortDir,
    page,
    pageSize
  ) {
    sortBy = this.#resolveChoice(sortBy, { 'Order Date': 'OrderDate', 'Modify Date': 'ModifyDate', 'Create Date': 'CreateDate' })
    sortDir = this.#resolveChoice(sortDir, { Ascending: 'ASC', Descending: 'DESC' })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/orders`,
      query: {
        orderStatus,
        storeId,
        customerName,
        itemKeyword,
        orderNumber,
        createDateStart,
        createDateEnd,
        modifyDateStart,
        modifyDateEnd,
        sortBy,
        sortDir,
        page,
        pageSize,
      },
      logTag: 'listOrders',
    })
  }

  /**
   * @description Retrieves the full details of a single order by its ShipStation order ID, including line items, addresses, totals, weights, dimensions, and advanced options.
   * @route POST /get-order
   * @operationName Get Order
   * @category Orders
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Order ID","name":"orderId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The unique ShipStation order ID to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"orderId":94113592,"orderNumber":"101","orderStatus":"awaiting_shipment","customerEmail":"buyer@example.com","items":[],"shipTo":{"name":"Jane Doe","city":"Austin","state":"TX","postalCode":"78701","country":"US"},"orderTotal":76.50}
   */
  async getOrder(orderId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/orders/${ orderId }`,
      logTag: 'getOrder',
    })
  }

  /**
   * @typedef {Object} ShipStationAddress
   * @property {String} name - Recipient or contact name
   * @property {String} company - Company name
   * @property {String} street1 - First line of the street address
   * @property {String} street2 - Second line of the street address
   * @property {String} street3 - Third line of the street address
   * @property {String} city - City
   * @property {String} state - State or province code
   * @property {String} postalCode - ZIP or postal code
   * @property {String} country - Two-letter ISO country code
   * @property {String} phone - Contact phone number
   * @property {Boolean} residential - Whether the address is residential
   */

  /**
   * @typedef {Object} ShipStationOrderItem
   * @property {String} sku - Stock keeping unit
   * @property {String} name - Item display name
   * @property {Number} quantity - Quantity ordered
   * @property {Number} unitPrice - Unit price
   * @property {String} imageUrl - Product image URL
   * @property {Object} weight - Item weight ({value, units})
   */

  /**
   * @description Creates a new order or updates an existing one in ShipStation. Supplying an existing orderKey updates the matching order; otherwise a new order is created. Includes shipping and billing addresses, line items, totals, and shipping preferences.
   * @route POST /create-or-update-order
   * @operationName Create or Update Order
   * @category Orders
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Order Number","name":"orderNumber","required":true,"description":"User-defined identifier for the order. Maximum 50 characters."}
   * @paramDef {"type":"String","label":"Order Date","name":"orderDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Date the order was placed, in ISO 8601 format."}
   * @paramDef {"type":"String","label":"Order Status","name":"orderStatus","required":true,"dictionary":"getOrderStatusesDictionary","description":"Current status of the order."}
   * @paramDef {"type":"ShipStationAddress","label":"Bill To","name":"billTo","required":true,"description":"Billing address object."}
   * @paramDef {"type":"ShipStationAddress","label":"Ship To","name":"shipTo","required":true,"description":"Shipping address object."}
   * @paramDef {"type":"String","label":"Order Key","name":"orderKey","description":"Unique key from the source system. If supplied and matches an existing order, the order is updated rather than created."}
   * @paramDef {"type":"String","label":"Customer Username","name":"customerUsername","description":"Username of the customer who placed the order. Required to generate a customer profile."}
   * @paramDef {"type":"String","label":"Customer Email","name":"customerEmail","description":"Email address of the customer."}
   * @paramDef {"type":"Array<ShipStationOrderItem>","label":"Items","name":"items","description":"Array of line item objects belonging to the order."}
   * @paramDef {"type":"Number","label":"Amount Paid","name":"amountPaid","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Total amount paid by the customer."}
   * @paramDef {"type":"Number","label":"Tax Amount","name":"taxAmount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Total tax charged on the order."}
   * @paramDef {"type":"Number","label":"Shipping Amount","name":"shippingAmount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Shipping cost charged to the customer."}
   * @paramDef {"type":"String","label":"Customer Notes","name":"customerNotes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Notes provided by the customer at checkout."}
   * @paramDef {"type":"String","label":"Internal Notes","name":"internalNotes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Internal notes visible only to the seller."}
   * @paramDef {"type":"Boolean","label":"Gift","name":"gift","uiComponent":{"type":"TOGGLE"},"description":"Indicates whether the order is a gift."}
   * @paramDef {"type":"String","label":"Gift Message","name":"giftMessage","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional gift message to include with the order."}
   *
   * @returns {Object}
   * @sampleResult {"orderId":94113592,"orderNumber":"101","orderKey":"abc","orderStatus":"awaiting_shipment","customerEmail":"buyer@example.com","orderTotal":76.50,"createDate":"2025-08-20T07:30:00.000"}
   */
  async createOrUpdateOrder(
    orderNumber,
    orderDate,
    orderStatus,
    billTo,
    shipTo,
    orderKey,
    customerUsername,
    customerEmail,
    items,
    amountPaid,
    taxAmount,
    shippingAmount,
    customerNotes,
    internalNotes,
    gift,
    giftMessage
  ) {
    const body = clean({
      orderNumber,
      orderDate,
      orderStatus,
      billTo,
      shipTo,
      orderKey,
      customerUsername,
      customerEmail,
      items,
      amountPaid,
      taxAmount,
      shippingAmount,
      customerNotes,
      internalNotes,
      gift,
      giftMessage,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/orders/createorder`,
      method: 'post',
      body,
      logTag: 'createOrUpdateOrder',
    })
  }

  /**
   * @description Permanently deletes an order from ShipStation. The order is removed from the database and cannot be recovered.
   * @route POST /delete-order
   * @operationName Delete Order
   * @category Orders
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Order ID","name":"orderId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The unique ShipStation order ID to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Order #94113592 was deleted successfully."}
   */
  async deleteOrder(orderId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/orders/${ orderId }`,
      method: 'delete',
      logTag: 'deleteOrder',
    })
  }

  /**
   * @description Marks an existing order as shipped without creating a label in ShipStation. Useful when the shipment was created outside of ShipStation but should still be reflected in the order record.
   * @route POST /mark-order-as-shipped
   * @operationName Mark Order as Shipped
   * @category Orders
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Order ID","name":"orderId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The unique ShipStation order ID to mark as shipped."}
   * @paramDef {"type":"String","label":"Carrier Code","name":"carrierCode","required":true,"dictionary":"getCarriersDictionary","description":"Carrier code (for example 'usps' or 'fedex') that performed the shipment."}
   * @paramDef {"type":"String","label":"Ship Date","name":"shipDate","uiComponent":{"type":"DATE_PICKER"},"description":"Date the order was shipped. Defaults to today if not supplied."}
   * @paramDef {"type":"String","label":"Tracking Number","name":"trackingNumber","description":"Carrier tracking number for the shipment."}
   * @paramDef {"type":"Boolean","label":"Notify Customer","name":"notifyCustomer","uiComponent":{"type":"TOGGLE"},"description":"Whether to email shipping notification to the customer."}
   * @paramDef {"type":"Boolean","label":"Notify Sales Channel","name":"notifySalesChannel","uiComponent":{"type":"TOGGLE"},"description":"Whether to send shipment status to the sales channel (marketplace)."}
   *
   * @returns {Object}
   * @sampleResult {"orderId":94113592,"orderNumber":"101","orderStatus":"shipped"}
   */
  async markOrderAsShipped(orderId, carrierCode, shipDate, trackingNumber, notifyCustomer, notifySalesChannel) {
    const body = clean({
      orderId,
      carrierCode,
      shipDate,
      trackingNumber,
      notifyCustomer,
      notifySalesChannel,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/orders/markasshipped`,
      method: 'post',
      body,
      logTag: 'markOrderAsShipped',
    })
  }

  /**
   * @description Places an order on hold until a specified date. On the hold-until date the order automatically returns to the awaiting_shipment status.
   * @route POST /hold-order-until
   * @operationName Hold Order Until
   * @category Orders
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Order ID","name":"orderId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The unique ShipStation order ID to hold."}
   * @paramDef {"type":"String","label":"Hold Until Date","name":"holdUntilDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Date the hold expires. The order returns to awaiting_shipment on this date."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Order #94113592 was held until 2025-08-30."}
   */
  async holdOrderUntil(orderId, holdUntilDate) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/orders/holduntil`,
      method: 'post',
      body: { orderId, holdUntilDate },
      logTag: 'holdOrderUntil',
    })
  }

  /**
   * @description Restores an order from on-hold status back to awaiting_shipment immediately, regardless of any previously set hold-until date.
   * @route POST /restore-order-from-hold
   * @operationName Restore Order from Hold
   * @category Orders
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Order ID","name":"orderId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The unique ShipStation order ID to restore from hold."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Order #94113592 was restored from hold."}
   */
  async restoreOrderFromHold(orderId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/orders/restorefromhold`,
      method: 'post',
      body: { orderId },
      logTag: 'restoreOrderFromHold',
    })
  }

  /**
   * @description Adds a tag to an existing order, useful for categorizing or triggering downstream automations based on tag membership.
   * @route POST /add-tag-to-order
   * @operationName Add Tag to Order
   * @category Orders
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Order ID","name":"orderId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The unique ShipStation order ID to tag."}
   * @paramDef {"type":"Number","label":"Tag ID","name":"tagId","required":true,"dictionary":"getTagsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The tag to apply. Pick one of the account's order tags; List Order Tags shows them all."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Tag added successfully."}
   */
  async addTagToOrder(orderId, tagId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/orders/addtag`,
      method: 'post',
      body: { orderId, tagId },
      logTag: 'addTagToOrder',
    })
  }

  /**
   * @description Removes a previously applied tag from an order. Reverses an earlier add-tag action without affecting the order otherwise.
   * @route POST /remove-tag-from-order
   * @operationName Remove Tag from Order
   * @category Orders
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Order ID","name":"orderId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The unique ShipStation order ID to untag."}
   * @paramDef {"type":"Number","label":"Tag ID","name":"tagId","required":true,"dictionary":"getTagsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The tag to remove from the order. Pick one of the account's order tags; List Order Tags shows them all."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Tag removed successfully."}
   */
  async removeTagFromOrder(orderId, tagId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/orders/removetag`,
      method: 'post',
      body: { orderId, tagId },
      logTag: 'removeTagFromOrder',
    })
  }

  /**
   * @description Retrieves the order tags configured in the ShipStation account, each with its numeric ID, name, and display color. Use this to discover the tag IDs accepted by Add Tag to Order and Remove Tag from Order.
   * @route POST /list-tags
   * @operationName List Order Tags
   * @category Orders
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult [{"tagId":8362,"name":"Backorder","color":"#800080"}]
   */
  async listTags() {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/accounts/listtags`,
      logTag: 'listTags',
    })
  }

  /* ============================================================
   * Shipment Action Methods
   * ============================================================ */

  /**
   * @description Retrieves a paginated list of shipments matching optional filters such as recipient, carrier, service, tracking number, store, and date ranges. Useful for tracking dashboards or post-fulfillment automations.
   * @route POST /list-shipments
   * @operationName List Shipments
   * @category Shipments
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Recipient Name","name":"recipientName","description":"Filters shipments to those whose recipient name matches the specified value."}
   * @paramDef {"type":"String","label":"Recipient Country Code","name":"recipientCountryCode","description":"Two-letter ISO country code of the recipient (for example 'US')."}
   * @paramDef {"type":"String","label":"Order Number","name":"orderNumber","description":"Filters shipments to those tied to the specified order number."}
   * @paramDef {"type":"Number","label":"Order ID","name":"orderId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Filters shipments to those tied to the specified order ID."}
   * @paramDef {"type":"String","label":"Carrier Code","name":"carrierCode","dictionary":"getCarriersDictionary","description":"Filters shipments to those sent via the selected carrier."}
   * @paramDef {"type":"String","label":"Service Code","name":"serviceCode","dictionary":"getCarrierServicesDictionary","dependsOn":["carrierCode"],"description":"Filters shipments to those using the selected shipping service."}
   * @paramDef {"type":"String","label":"Tracking Number","name":"trackingNumber","description":"Filters shipments to the one with the specified tracking number."}
   * @paramDef {"type":"String","label":"Store","name":"storeId","dictionary":"getStoresDictionary","description":"Filters shipments to a single store."}
   * @paramDef {"type":"String","label":"Create Date Start","name":"createDateStart","uiComponent":{"type":"DATE_PICKER"},"description":"Returns shipments created on or after this date."}
   * @paramDef {"type":"String","label":"Create Date End","name":"createDateEnd","uiComponent":{"type":"DATE_PICKER"},"description":"Returns shipments created on or before this date."}
   * @paramDef {"type":"String","label":"Ship Date Start","name":"shipDateStart","uiComponent":{"type":"DATE_PICKER"},"description":"Returns shipments shipped on or after this date."}
   * @paramDef {"type":"String","label":"Ship Date End","name":"shipDateEnd","uiComponent":{"type":"DATE_PICKER"},"description":"Returns shipments shipped on or before this date."}
   * @paramDef {"type":"Boolean","label":"Include Shipment Items","name":"includeShipmentItems","uiComponent":{"type":"TOGGLE"},"description":"Whether to include the array of items inside each shipment. Defaults to false."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Ship Date","Create Date"]}},"description":"Field to sort the result set by."}
   * @paramDef {"type":"String","label":"Sort Direction","name":"sortDir","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction. ASC for ascending, DESC for descending."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (1-based)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of shipments per page. Maximum allowed value is 500."}
   *
   * @returns {Object}
   * @sampleResult {"shipments":[{"shipmentId":12345,"orderId":94113592,"orderNumber":"101","createDate":"2025-08-21T08:00:00","shipDate":"2025-08-21","trackingNumber":"9400111202555842761524","carrierCode":"stamps_com","serviceCode":"usps_priority_mail","voided":false}],"total":1,"page":1,"pages":1}
   */
  async listShipments(
    recipientName,
    recipientCountryCode,
    orderNumber,
    orderId,
    carrierCode,
    serviceCode,
    trackingNumber,
    storeId,
    createDateStart,
    createDateEnd,
    shipDateStart,
    shipDateEnd,
    includeShipmentItems,
    sortBy,
    sortDir,
    page,
    pageSize
  ) {
    sortBy = this.#resolveChoice(sortBy, { 'Ship Date': 'ShipDate', 'Create Date': 'CreateDate' })
    sortDir = this.#resolveChoice(sortDir, { Ascending: 'ASC', Descending: 'DESC' })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/shipments`,
      query: {
        recipientName,
        recipientCountryCode,
        orderNumber,
        orderId,
        carrierCode,
        serviceCode,
        trackingNumber,
        storeId,
        createDateStart,
        createDateEnd,
        shipDateStart,
        shipDateEnd,
        includeShipmentItems,
        sortBy,
        sortDir,
        page,
        pageSize,
      },
      logTag: 'listShipments',
    })
  }

  /**
   * @typedef {Object} ShipStationWeight
   * @property {Number} value - Weight value
   * @property {String} units - Units: 'pounds', 'ounces', or 'grams'
   */

  /**
   * @typedef {Object} ShipStationDimensions
   * @property {Number} length - Length value
   * @property {Number} width - Width value
   * @property {Number} height - Height value
   * @property {String} units - Units: 'inches' or 'centimeters'
   */

  /**
   * @description Returns the available shipping rates for the supplied carrier between the supplied origin and destination addresses. Useful for letting customers select shipping options at checkout or for choosing the cheapest service before purchasing a label.
   * @route POST /get-shipment-rates
   * @operationName Get Shipment Rates
   * @category Shipments
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Carrier Code","name":"carrierCode","required":true,"dictionary":"getCarriersDictionary","description":"Carrier whose rates should be queried (for example 'usps' or 'fedex')."}
   * @paramDef {"type":"String","label":"From Postal Code","name":"fromPostalCode","required":true,"description":"Origin postal code."}
   * @paramDef {"type":"String","label":"To Postal Code","name":"toPostalCode","required":true,"description":"Destination postal code."}
   * @paramDef {"type":"String","label":"To Country","name":"toCountry","required":true,"description":"Destination country as a two-letter ISO code (for example 'US')."}
   * @paramDef {"type":"ShipStationWeight","label":"Weight","name":"weight","required":true,"description":"Package weight object with value and units (pounds, ounces, or grams)."}
   * @paramDef {"type":"String","label":"Service Code","name":"serviceCode","dictionary":"getCarrierServicesDictionary","dependsOn":["carrierCode"],"description":"Limit rates to a specific service. Leave blank to receive rates for all services."}
   * @paramDef {"type":"String","label":"Package Code","name":"packageCode","dictionary":"getCarrierPackagesDictionary","dependsOn":["carrierCode"],"description":"Specific package type. Leave blank to use the default package."}
   * @paramDef {"type":"String","label":"From City","name":"fromCity","description":"Origin city name (optional)."}
   * @paramDef {"type":"String","label":"From State","name":"fromState","description":"Origin state code (optional)."}
   * @paramDef {"type":"String","label":"To City","name":"toCity","description":"Destination city name (optional)."}
   * @paramDef {"type":"String","label":"To State","name":"toState","description":"Destination state code. Required when calculating UPS rates."}
   * @paramDef {"type":"ShipStationDimensions","label":"Dimensions","name":"dimensions","description":"Package dimensions object containing length, width, height and units."}
   * @paramDef {"type":"String","label":"Confirmation","name":"confirmation","dictionary":"getConfirmationTypesDictionary","description":"Type of delivery confirmation to request."}
   * @paramDef {"type":"Boolean","label":"Residential","name":"residential","uiComponent":{"type":"TOGGLE"},"description":"Whether the destination address is residential. Defaults to false (commercial)."}
   *
   * @returns {Object}
   * @sampleResult [{"serviceName":"USPS Priority Mail","serviceCode":"usps_priority_mail","shipmentCost":7.62,"otherCost":0}]
   */
  async getShipmentRates(
    carrierCode,
    fromPostalCode,
    toPostalCode,
    toCountry,
    weight,
    serviceCode,
    packageCode,
    fromCity,
    fromState,
    toCity,
    toState,
    dimensions,
    confirmation,
    residential
  ) {
    const body = clean({
      carrierCode,
      fromPostalCode,
      toPostalCode,
      toCountry,
      weight,
      serviceCode,
      packageCode,
      fromCity,
      fromState,
      toCity,
      toState,
      dimensions,
      confirmation,
      residential,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/shipments/getrates`,
      method: 'post',
      body,
      logTag: 'getShipmentRates',
    })
  }

  /**
   * @description Creates a shipping label for the supplied carrier and service and returns label data, tracking number, and rate. Charges the connected carrier account for the label cost.
   * @route POST /create-shipment-label
   * @operationName Create Shipment Label
   * @category Shipments
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Carrier Code","name":"carrierCode","required":true,"dictionary":"getCarriersDictionary","description":"Carrier code (for example 'usps' or 'fedex') that should issue the label."}
   * @paramDef {"type":"String","label":"Service Code","name":"serviceCode","required":true,"dictionary":"getCarrierServicesDictionary","dependsOn":["carrierCode"],"description":"Service code identifying the chosen shipping service."}
   * @paramDef {"type":"String","label":"Package Code","name":"packageCode","required":true,"dictionary":"getCarrierPackagesDictionary","dependsOn":["carrierCode"],"description":"Package type code (for example 'package' or 'flat_rate_envelope')."}
   * @paramDef {"type":"String","label":"Ship Date","name":"shipDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Date the label should ship."}
   * @paramDef {"type":"ShipStationWeight","label":"Weight","name":"weight","required":true,"description":"Package weight object with value and units."}
   * @paramDef {"type":"ShipStationAddress","label":"Ship From","name":"shipFrom","required":true,"description":"Ship-from address."}
   * @paramDef {"type":"ShipStationAddress","label":"Ship To","name":"shipTo","required":true,"description":"Ship-to address."}
   * @paramDef {"type":"ShipStationDimensions","label":"Dimensions","name":"dimensions","description":"Package dimensions object."}
   * @paramDef {"type":"String","label":"Confirmation","name":"confirmation","dictionary":"getConfirmationTypesDictionary","description":"Type of delivery confirmation to request."}
   * @paramDef {"type":"Object","label":"Insurance Options","name":"insuranceOptions","schemaLoader":"createInsuranceOptionsSchema","description":"Insurance settings, including provider, insureShipment flag, and insuredValue."}
   * @paramDef {"type":"Object","label":"International Options","name":"internationalOptions","schemaLoader":"createInternationalOptionsSchema","description":"Customs information for international shipments."}
   * @paramDef {"type":"Object","label":"Advanced Options","name":"advancedOptions","schemaLoader":"createAdvancedOptionsSchema","description":"Carrier-specific advanced options such as warehouseId, billToParty, and saturdayDelivery."}
   * @paramDef {"type":"Boolean","label":"Test Label","name":"testLabel","uiComponent":{"type":"TOGGLE"},"description":"Whether to create a test label that does not charge the carrier account."}
   *
   * @returns {Object}
   * @sampleResult {"shipmentId":12345,"orderId":94113592,"trackingNumber":"9400111202555842761524","shipmentCost":7.62,"insuranceCost":0,"labelData":"<base64-encoded PDF>","formData":null}
   */
  async createShipmentLabel(
    carrierCode,
    serviceCode,
    packageCode,
    shipDate,
    weight,
    shipFrom,
    shipTo,
    dimensions,
    confirmation,
    insuranceOptions,
    internationalOptions,
    advancedOptions,
    testLabel
  ) {
    if (insuranceOptions?.provider) {
      insuranceOptions.provider = this.#resolveChoice(insuranceOptions.provider, { Shipsurance: 'shipsurance', Carrier: 'carrier', 'Third-Party Provider': 'provider', XCover: 'xcover', ParcelGuard: 'parcelguard' })
    }

    if (internationalOptions?.contents) {
      internationalOptions.contents = this.#resolveChoice(internationalOptions.contents, { Merchandise: 'merchandise', Documents: 'documents', Gift: 'gift', 'Returned Goods': 'returned_goods', Sample: 'sample' })
    }

    if (internationalOptions?.nonDelivery) {
      internationalOptions.nonDelivery = this.#resolveChoice(internationalOptions.nonDelivery, { 'Return to Sender': 'return_to_sender', 'Treat as Abandoned': 'treat_as_abandoned' })
    }

    if (advancedOptions?.billToParty) {
      advancedOptions.billToParty = this.#resolveChoice(advancedOptions.billToParty, { 'My Account': 'my_account', 'My Other Account': 'my_other_account', Recipient: 'recipient', 'Third Party': 'third_party' })
    }

    const body = clean({
      carrierCode,
      serviceCode,
      packageCode,
      shipDate,
      weight,
      shipFrom,
      shipTo,
      dimensions,
      confirmation,
      insuranceOptions,
      internationalOptions,
      advancedOptions,
      testLabel,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/shipments/createlabel`,
      method: 'post',
      body,
      logTag: 'createShipmentLabel',
    })
  }

  /**
   * @description Voids a previously created shipping label so that the carrier does not charge the account for it. The label may not be voidable after a carrier-defined cutoff window.
   * @route POST /void-shipment-label
   * @operationName Void Shipment Label
   * @category Shipments
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Shipment ID","name":"shipmentId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The shipment ID whose label should be voided."}
   *
   * @returns {Object}
   * @sampleResult {"approved":true,"message":"Label voided successfully."}
   */
  async voidShipmentLabel(shipmentId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/shipments/voidlabel`,
      method: 'post',
      body: { shipmentId },
      logTag: 'voidShipmentLabel',
    })
  }

  /**
   * @description Creates a shipping label for an order that already exists in ShipStation and returns the label data, tracking number, and cost. The order supplies the addresses, so only the carrier, service, confirmation, and ship date are required. The returned labelData is a base64-encoded PDF. Charges the connected carrier account unless Test Label is on.
   * @route POST /create-label-for-order
   * @operationName Create Label for Order
   * @category Shipments
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Order ID","name":"orderId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The unique ShipStation order ID to create the label for."}
   * @paramDef {"type":"String","label":"Carrier Code","name":"carrierCode","required":true,"dictionary":"getCarriersDictionary","description":"Carrier code (for example 'usps' or 'fedex') that should issue the label."}
   * @paramDef {"type":"String","label":"Service Code","name":"serviceCode","required":true,"dictionary":"getCarrierServicesDictionary","dependsOn":["carrierCode"],"description":"Service code identifying the chosen shipping service."}
   * @paramDef {"type":"String","label":"Confirmation","name":"confirmation","required":true,"dictionary":"getConfirmationTypesDictionary","description":"Type of delivery confirmation to request. Choose None for no confirmation."}
   * @paramDef {"type":"String","label":"Ship Date","name":"shipDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Date the label should ship."}
   * @paramDef {"type":"String","label":"Package Code","name":"packageCode","dictionary":"getCarrierPackagesDictionary","dependsOn":["carrierCode"],"description":"Package type code (for example 'package' or 'flat_rate_envelope'). Leave blank to use the order's package."}
   * @paramDef {"type":"ShipStationWeight","label":"Weight","name":"weight","description":"Package weight object with value and units. Leave blank to use the order's weight."}
   * @paramDef {"type":"ShipStationDimensions","label":"Dimensions","name":"dimensions","description":"Package dimensions object containing length, width, height, and units."}
   * @paramDef {"type":"Object","label":"Insurance Options","name":"insuranceOptions","schemaLoader":"createInsuranceOptionsSchema","description":"Insurance settings, including provider, insureShipment flag, and insuredValue."}
   * @paramDef {"type":"Object","label":"International Options","name":"internationalOptions","schemaLoader":"createInternationalOptionsSchema","description":"Customs information for international shipments."}
   * @paramDef {"type":"Object","label":"Advanced Options","name":"advancedOptions","schemaLoader":"createAdvancedOptionsSchema","description":"Carrier-specific advanced options such as warehouseId, billToParty, and saturdayDelivery."}
   * @paramDef {"type":"Boolean","label":"Test Label","name":"testLabel","uiComponent":{"type":"TOGGLE"},"description":"Whether to create a test label that does not charge the carrier account."}
   *
   * @returns {Object}
   * @sampleResult {"shipmentId":12345,"shipmentCost":7.62,"insuranceCost":0,"trackingNumber":"9400111202555842761524","labelData":"<base64-encoded PDF>","formData":null}
   */
  async createLabelForOrder(
    orderId,
    carrierCode,
    serviceCode,
    confirmation,
    shipDate,
    packageCode,
    weight,
    dimensions,
    insuranceOptions,
    internationalOptions,
    advancedOptions,
    testLabel
  ) {
    if (insuranceOptions?.provider) {
      insuranceOptions.provider = this.#resolveChoice(insuranceOptions.provider, { Shipsurance: 'shipsurance', Carrier: 'carrier', 'Third-Party Provider': 'provider', XCover: 'xcover', ParcelGuard: 'parcelguard' })
    }

    if (internationalOptions?.contents) {
      internationalOptions.contents = this.#resolveChoice(internationalOptions.contents, { Merchandise: 'merchandise', Documents: 'documents', Gift: 'gift', 'Returned Goods': 'returned_goods', Sample: 'sample' })
    }

    if (internationalOptions?.nonDelivery) {
      internationalOptions.nonDelivery = this.#resolveChoice(internationalOptions.nonDelivery, { 'Return to Sender': 'return_to_sender', 'Treat as Abandoned': 'treat_as_abandoned' })
    }

    if (advancedOptions?.billToParty) {
      advancedOptions.billToParty = this.#resolveChoice(advancedOptions.billToParty, { 'My Account': 'my_account', 'My Other Account': 'my_other_account', Recipient: 'recipient', 'Third Party': 'third_party' })
    }

    const body = clean({
      orderId,
      carrierCode,
      serviceCode,
      confirmation,
      shipDate,
      packageCode,
      weight,
      dimensions,
      insuranceOptions,
      internationalOptions,
      advancedOptions,
      testLabel,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/orders/createlabelfororder`,
      method: 'post',
      body,
      logTag: 'createLabelForOrder',
    })
  }

  /**
   * @description Retrieves a paginated list of fulfillments - shipments recorded against orders by an external marketplace or fulfillment provider rather than shipped through ShipStation - with optional filtering by fulfillment, order, tracking number, recipient, and date ranges. Useful for reconciling externally fulfilled orders and tracking their delivery.
   * @route POST /list-fulfillments
   * @operationName List Fulfillments
   * @category Shipments
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Fulfillment ID","name":"fulfillmentId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Filters to the single fulfillment with this ID."}
   * @paramDef {"type":"Number","label":"Order ID","name":"orderId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Filters fulfillments to those tied to the specified order ID."}
   * @paramDef {"type":"String","label":"Order Number","name":"orderNumber","description":"Filters fulfillments to those tied to the specified order number."}
   * @paramDef {"type":"String","label":"Tracking Number","name":"trackingNumber","description":"Filters fulfillments to the one with the specified tracking number."}
   * @paramDef {"type":"String","label":"Recipient Name","name":"recipientName","description":"Filters fulfillments to those whose recipient name matches the specified value."}
   * @paramDef {"type":"String","label":"Create Date Start","name":"createDateStart","uiComponent":{"type":"DATE_PICKER"},"description":"Returns fulfillments created on or after this date."}
   * @paramDef {"type":"String","label":"Create Date End","name":"createDateEnd","uiComponent":{"type":"DATE_PICKER"},"description":"Returns fulfillments created on or before this date."}
   * @paramDef {"type":"String","label":"Ship Date Start","name":"shipDateStart","uiComponent":{"type":"DATE_PICKER"},"description":"Returns fulfillments shipped on or after this date."}
   * @paramDef {"type":"String","label":"Ship Date End","name":"shipDateEnd","uiComponent":{"type":"DATE_PICKER"},"description":"Returns fulfillments shipped on or before this date."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Ship Date","Create Date"]}},"description":"Field to sort the result set by."}
   * @paramDef {"type":"String","label":"Sort Direction","name":"sortDir","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction. ASC for ascending, DESC for descending."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (1-based)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of fulfillments per page. Maximum allowed value is 500."}
   *
   * @returns {Object}
   * @sampleResult {"fulfillments":[{"fulfillmentId":33859002,"orderId":94113592,"orderNumber":"101","userId":"a1b2c3","customerEmail":"buyer@example.com","trackingNumber":"9400111202555842761524","createDate":"2025-08-21T08:00:00.000","shipDate":"2025-08-21T00:00:00.000","voidDate":null,"deliveryDate":null,"carrierCode":"stamps_com","fulfillmentProviderCode":null,"fulfillmentServiceCode":null,"fulfillmentFee":0,"voidRequested":false,"voided":false,"marketplaceNotified":true,"notifyErrorMessage":null,"shipTo":{"name":"Jane Doe","company":null,"street1":"123 Main St","street2":null,"street3":null,"city":"Austin","state":"TX","postalCode":"78701","country":"US","phone":"5125550100","residential":null,"addressVerified":null}}],"total":1,"page":1,"pages":1}
   */
  async listFulfillments(
    fulfillmentId,
    orderId,
    orderNumber,
    trackingNumber,
    recipientName,
    createDateStart,
    createDateEnd,
    shipDateStart,
    shipDateEnd,
    sortBy,
    sortDir,
    page,
    pageSize
  ) {
    sortBy = this.#resolveChoice(sortBy, { 'Ship Date': 'ShipDate', 'Create Date': 'CreateDate' })
    sortDir = this.#resolveChoice(sortDir, { Ascending: 'ASC', Descending: 'DESC' })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/fulfillments`,
      query: {
        fulfillmentId,
        orderId,
        orderNumber,
        trackingNumber,
        recipientName,
        createDateStart,
        createDateEnd,
        shipDateStart,
        shipDateEnd,
        sortBy,
        sortDir,
        page,
        pageSize,
      },
      logTag: 'listFulfillments',
    })
  }

  /* ============================================================
   * Customer Action Methods
   * ============================================================ */

  /**
   * @description Retrieves a paginated list of customers, with optional filtering by state, country, marketplace, and tag. Useful for syncing customer data to a CRM or for personalized outreach.
   * @route POST /list-customers
   * @operationName List Customers
   * @category Customers
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"State Code","name":"stateCode","description":"Filters customers to those who reside in the specified state code."}
   * @paramDef {"type":"String","label":"Country Code","name":"countryCode","description":"Filters customers to those who reside in the specified two-letter ISO country code."}
   * @paramDef {"type":"Number","label":"Marketplace ID","name":"marketplaceId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Filters customers to those who purchased from the specified marketplace."}
   * @paramDef {"type":"Number","label":"Tag ID","name":"tagId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Filters customers to those tagged with the specified tag ID."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Name","Modify Date","Create Date"]}},"description":"Field to sort the result set by."}
   * @paramDef {"type":"String","label":"Sort Direction","name":"sortDir","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction. ASC for ascending, DESC for descending."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (1-based)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of customers per page. Maximum allowed value is 500."}
   *
   * @returns {Object}
   * @sampleResult {"customers":[{"customerId":12345,"createDate":"2025-08-15T10:00:00","name":"Jane Doe","email":"jane@example.com","city":"Austin","state":"TX","postalCode":"78701","countryCode":"US"}],"total":1,"page":1,"pages":1}
   */
  async listCustomers(stateCode, countryCode, marketplaceId, tagId, sortBy, sortDir, page, pageSize) {
    sortBy = this.#resolveChoice(sortBy, { Name: 'Name', 'Modify Date': 'ModifyDate', 'Create Date': 'CreateDate' })
    sortDir = this.#resolveChoice(sortDir, { Ascending: 'ASC', Descending: 'DESC' })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/customers`,
      query: {
        stateCode,
        countryCode,
        marketplaceId,
        tagId,
        sortBy,
        sortDir,
        page,
        pageSize,
      },
      logTag: 'listCustomers',
    })
  }

  /**
   * @description Retrieves the full details of a single customer by ShipStation customer ID, including address, marketplace usernames, and tags.
   * @route POST /get-customer
   * @operationName Get Customer
   * @category Customers
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Customer ID","name":"customerId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The unique ShipStation customer ID to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"customerId":12345,"createDate":"2025-08-15T10:00:00","name":"Jane Doe","email":"jane@example.com","city":"Austin","state":"TX","postalCode":"78701","countryCode":"US","tags":[]}
   */
  async getCustomer(customerId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/customers/${ customerId }`,
      logTag: 'getCustomer',
    })
  }

  /* ============================================================
   * Product Action Methods
   * ============================================================ */

  /**
   * @description Retrieves a paginated list of products from the ShipStation product catalog, with optional filtering by SKU, name, category, type, tag, UPC, or creation date.
   * @route POST /list-products
   * @operationName List Products
   * @category Products
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"SKU","name":"sku","description":"Filters products to those that match the specified SKU."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Filters products by name."}
   * @paramDef {"type":"String","label":"Product Category ID","name":"productCategoryId","description":"Filters products to those in the specified category. Enter the category ID directly - ShipStation exposes no endpoint to list product categories, so this cannot be a pick list."}
   * @paramDef {"type":"String","label":"Product Type ID","name":"productTypeId","description":"Filters products to those of the specified type. Enter the type ID directly - ShipStation exposes no endpoint to list product types, so this cannot be a pick list."}
   * @paramDef {"type":"String","label":"Tag ID","name":"tagId","description":"Filters products to those with the specified tag. Enter the tag ID directly - ShipStation exposes no endpoint to list product tags, so this cannot be a pick list."}
   * @paramDef {"type":"String","label":"UPC","name":"upc","description":"Filters products to those with the specified UPC code."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","uiComponent":{"type":"DATE_PICKER"},"description":"Returns products created after the specified date."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","uiComponent":{"type":"DATE_PICKER"},"description":"Returns products created before the specified date."}
   * @paramDef {"type":"Boolean","label":"Show Inactive","name":"showInactive","uiComponent":{"type":"TOGGLE"},"description":"Whether to include inactive products in the result set."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","uiComponent":{"type":"DROPDOWN","options":{"values":["SKU","Modify Date","Create Date"]}},"description":"Field to sort the result set by."}
   * @paramDef {"type":"String","label":"Sort Direction","name":"sortDir","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction. ASC for ascending, DESC for descending."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (1-based)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of products per page. Maximum allowed value is 500."}
   *
   * @returns {Object}
   * @sampleResult {"products":[{"productId":99887,"sku":"WIDGET-001","name":"Blue Widget","price":12.99,"upc":"012345678905","active":true,"createDate":"2025-07-01T09:00:00"}],"total":1,"page":1,"pages":1}
   */
  async listProducts(
    sku,
    name,
    productCategoryId,
    productTypeId,
    tagId,
    upc,
    startDate,
    endDate,
    showInactive,
    sortBy,
    sortDir,
    page,
    pageSize
  ) {
    sortBy = this.#resolveChoice(sortBy, { SKU: 'SKU', 'Modify Date': 'ModifyDate', 'Create Date': 'CreateDate' })
    sortDir = this.#resolveChoice(sortDir, { Ascending: 'ASC', Descending: 'DESC' })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/products`,
      query: {
        sku,
        name,
        productCategoryId,
        productTypeId,
        tagId,
        upc,
        startDate,
        endDate,
        showInactive,
        sortBy,
        sortDir,
        page,
        pageSize,
      },
      logTag: 'listProducts',
    })
  }

  /**
   * @description Retrieves the full details of a single product by ShipStation product ID, including pricing, weight, dimensions, fulfillment SKU, and tags.
   * @route POST /get-product
   * @operationName Get Product
   * @category Products
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Product ID","name":"productId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The unique ShipStation product ID to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"productId":99887,"sku":"WIDGET-001","name":"Blue Widget","price":12.99,"defaultCost":4.50,"weightOz":2.5,"active":true}
   */
  async getProduct(productId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/products/${ productId }`,
      logTag: 'getProduct',
    })
  }

  /**
   * @description Updates an existing product in the ShipStation catalog. Only the fields you supply are changed - the current product is fetched first and your changes are merged over it. This is required because ShipStation's update API replaces the entire product, so any field left blank would otherwise be cleared. All fields except Product ID are optional.
   * @route POST /update-product
   * @operationName Update Product
   * @category Products
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Product ID","name":"productId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The unique ShipStation product ID to update."}
   * @paramDef {"type":"String","label":"SKU","name":"sku","description":"Stock keeping unit identifying the product."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Product display name."}
   * @paramDef {"type":"Number","label":"Price","name":"price","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Default price for the product."}
   * @paramDef {"type":"Number","label":"Default Cost","name":"defaultCost","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Default cost (cost of goods) for the product."}
   * @paramDef {"type":"Number","label":"Weight (Ounces)","name":"weightOz","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Product weight in ounces."}
   * @paramDef {"type":"String","label":"UPC","name":"upc","description":"Universal Product Code identifying the product."}
   * @paramDef {"type":"Boolean","label":"Active","name":"active","uiComponent":{"type":"TOGGLE"},"description":"Whether the product is active."}
   * @paramDef {"type":"String","label":"Warehouse Location","name":"warehouseLocation","description":"Bin or shelf location used during fulfillment."}
   * @paramDef {"type":"String","label":"Fulfillment SKU","name":"fulfillmentSku","description":"Alternate SKU used by the fulfillment system."}
   * @paramDef {"type":"String","label":"Internal Notes","name":"internalNotes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Internal notes for the product, visible only to the seller."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"The requested product has been updated"}
   */
  async updateProduct(
    productId,
    sku,
    name,
    price,
    defaultCost,
    weightOz,
    upc,
    active,
    warehouseLocation,
    fulfillmentSku,
    internalNotes
  ) {
    // ShipStation's PUT /products/{id} is a full replace - "the entire resource must be provided"
    // - so fetch the current product first and overlay only the supplied fields. Without this
    // merge, every field left blank would be nulled out on the live product (silent data loss).
    const existing = await this.#apiRequest({
      url: `${ API_BASE_URL }/products/${ productId }`,
      logTag: 'updateProduct',
    })

    const updates = clean({
      sku,
      name,
      price,
      defaultCost,
      weightOz,
      upc,
      active,
      warehouseLocation,
      fulfillmentSku,
      internalNotes,
    })

    const body = { ...existing, ...updates, productId }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/products/${ productId }`,
      method: 'put',
      body,
      logTag: 'updateProduct',
    })
  }

  /* ============================================================
   * Warehouse Action Methods
   * ============================================================ */

  /**
   * @description Retrieves the list of warehouses (Ship From Locations) configured in the ShipStation account, including their origin and return addresses.
   * @route POST /list-warehouses
   * @operationName List Warehouses
   * @category Warehouses
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult [{"warehouseId":98765,"warehouseName":"Main Warehouse","originAddress":{"name":"My Company","street1":"123 Main St","city":"Austin","state":"TX","postalCode":"78701","country":"US"},"isDefault":true}]
   */
  async listWarehouses() {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/warehouses`,
      logTag: 'listWarehouses',
    })
  }

  /**
   * @description Retrieves the full details of a single warehouse (Ship From Location) by ID, including origin and return addresses.
   * @route POST /get-warehouse
   * @operationName Get Warehouse
   * @category Warehouses
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Warehouse ID","name":"warehouseId","required":true,"dictionary":"getWarehousesDictionary","description":"The unique ShipStation warehouse ID to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"warehouseId":98765,"warehouseName":"Main Warehouse","originAddress":{"name":"My Company","street1":"123 Main St","city":"Austin","state":"TX","postalCode":"78701","country":"US"},"isDefault":true}
   */
  async getWarehouse(warehouseId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/warehouses/${ warehouseId }`,
      logTag: 'getWarehouse',
    })
  }

  /**
   * @description Creates a new warehouse (Ship From Location) in ShipStation with the supplied origin and optional return address.
   * @route POST /create-warehouse
   * @operationName Create Warehouse
   * @category Warehouses
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Warehouse Name","name":"warehouseName","required":true,"description":"Display name for the warehouse."}
   * @paramDef {"type":"ShipStationAddress","label":"Origin Address","name":"originAddress","required":true,"description":"Origin address used as the ship-from location."}
   * @paramDef {"type":"ShipStationAddress","label":"Return Address","name":"returnAddress","description":"Optional return address. Defaults to the origin address when omitted."}
   * @paramDef {"type":"Boolean","label":"Is Default","name":"isDefault","uiComponent":{"type":"TOGGLE"},"description":"Whether the new warehouse should be the default Ship From Location."}
   *
   * @returns {Object}
   * @sampleResult {"warehouseId":98766,"warehouseName":"Secondary Warehouse","createDate":"2025-08-26T12:00:00","isDefault":false}
   */
  async createWarehouse(warehouseName, originAddress, returnAddress, isDefault) {
    const body = clean({
      warehouseName,
      originAddress,
      returnAddress,
      isDefault,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/warehouses/createwarehouse`,
      method: 'post',
      body,
      logTag: 'createWarehouse',
    })
  }

  /**
   * @description Permanently deletes a warehouse (Ship From Location). The warehouse cannot be the default Ship From Location.
   * @route POST /delete-warehouse
   * @operationName Delete Warehouse
   * @category Warehouses
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Warehouse ID","name":"warehouseId","required":true,"dictionary":"getWarehousesDictionary","description":"The unique ShipStation warehouse ID to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Warehouse deleted successfully."}
   */
  async deleteWarehouse(warehouseId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/warehouses/${ warehouseId }`,
      method: 'delete',
      logTag: 'deleteWarehouse',
    })
  }

  /* ============================================================
   * Store Action Methods
   * ============================================================ */

  /**
   * @description Retrieves the list of stores connected to the ShipStation account, with an option to include inactive stores or filter by marketplace.
   * @route POST /list-stores
   * @operationName List Stores
   * @category Stores
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Boolean","label":"Show Inactive","name":"showInactive","uiComponent":{"type":"TOGGLE"},"description":"Whether to include inactive stores in the result set."}
   * @paramDef {"type":"Number","label":"Marketplace ID","name":"marketplaceId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Returns stores of this marketplace type."}
   *
   * @returns {Object}
   * @sampleResult [{"storeId":54321,"storeName":"My Shopify Store","marketplaceId":2,"marketplaceName":"Shopify","accountName":"My Shop","active":true}]
   */
  async listStores(showInactive, marketplaceId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/stores`,
      query: { showInactive, marketplaceId },
      logTag: 'listStores',
    })
  }

  /**
   * @description Retrieves the full configuration of a single store by ShipStation store ID, including marketplace details, refresh status, and contact info.
   * @route POST /get-store
   * @operationName Get Store
   * @category Stores
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Store ID","name":"storeId","required":true,"dictionary":"getStoresDictionary","description":"The unique ShipStation store ID to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"storeId":54321,"storeName":"My Shopify Store","marketplaceId":2,"marketplaceName":"Shopify","accountName":"My Shop","active":true,"refreshDate":"2025-08-26T11:00:00"}
   */
  async getStore(storeId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/stores/${ storeId }`,
      logTag: 'getStore',
    })
  }

  /**
   * @description Triggers a manual refresh on the specified store so that ShipStation pulls in the latest orders. The optional date range limits which orders are fetched.
   * @route POST /refresh-store
   * @operationName Refresh Store
   * @category Stores
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Store ID","name":"storeId","required":true,"dictionary":"getStoresDictionary","description":"The unique ShipStation store ID to refresh."}
   * @paramDef {"type":"String","label":"Refresh Date","name":"refreshDate","uiComponent":{"type":"DATE_PICKER"},"description":"Optional date used as the lower bound when pulling in new orders."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Store refresh in progress."}
   */
  async refreshStore(storeId, refreshDate) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/stores/refreshstore`,
      method: 'post',
      body: clean({ storeId, refreshDate }),
      logTag: 'refreshStore',
    })
  }

  /* ============================================================
   * Carrier Action Methods
   * ============================================================ */

  /**
   * @description Retrieves the list of carriers connected to the ShipStation account, including their account numbers, balances, and shipping provider IDs.
   * @route POST /list-carriers
   * @operationName List Carriers
   * @category Carriers
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult [{"name":"Stamps.com","code":"stamps_com","accountNumber":"1234","requiresFundedAccount":true,"balance":50.00,"primary":true}]
   */
  async listCarriers() {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/carriers`,
      logTag: 'listCarriers',
    })
  }

  /**
   * @description Retrieves the list of shipping services available from the specified carrier (for example USPS Priority Mail or FedEx 2 Day).
   * @route POST /list-carrier-services
   * @operationName List Carrier Services
   * @category Carriers
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Carrier Code","name":"carrierCode","required":true,"dictionary":"getCarriersDictionary","description":"Carrier whose services should be listed."}
   *
   * @returns {Object}
   * @sampleResult [{"carrierCode":"stamps_com","code":"usps_priority_mail","name":"USPS Priority Mail","domestic":true,"international":false}]
   */
  async listCarrierServices(carrierCode) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/carriers/listservices`,
      query: { carrierCode },
      logTag: 'listCarrierServices',
    })
  }

  /**
   * @description Retrieves the list of package types available from the specified carrier (for example envelopes, flat rate boxes, custom packages).
   * @route POST /list-carrier-packages
   * @operationName List Carrier Packages
   * @category Carriers
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Carrier Code","name":"carrierCode","required":true,"dictionary":"getCarriersDictionary","description":"Carrier whose package types should be listed."}
   *
   * @returns {Object}
   * @sampleResult [{"carrierCode":"stamps_com","code":"package","name":"Package","domestic":true,"international":true}]
   */
  async listCarrierPackages(carrierCode) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/carriers/listpackages`,
      query: { carrierCode },
      logTag: 'listCarrierPackages',
    })
  }

  /* ============================================================
   * Webhook Action Methods
   * ============================================================ */

  /**
   * @description Retrieves the list of webhooks currently registered on the ShipStation account, including each webhook's event, target URL, friendly name, and store filter.
   * @route POST /list-webhooks
   * @operationName List Webhooks
   * @category Webhooks
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"webhooks":[{"WebHookID":111222,"SellerID":654321,"HookType":"SHIP_NOTIFY","MessageFormat":"Json","Url":"https://example.com/hook","Name":"Ship Notify Hook","Active":true,"StoreID":null}]}
   */
  async listWebhooks() {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/webhooks`,
      logTag: 'listWebhooks',
    })
  }

  /**
   * @description Subscribes a new webhook so that ShipStation POSTs an event payload to the specified target URL whenever the chosen event occurs.
   * @route POST /subscribe-webhook
   * @operationName Subscribe Webhook
   * @category Webhooks
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Target URL","name":"target_url","required":true,"description":"Public HTTPS URL that will receive webhook POST requests."}
   * @paramDef {"type":"String","label":"Event","name":"event","required":true,"dictionary":"getWebhookEventsDictionary","description":"Type of event to subscribe to."}
   * @paramDef {"type":"String","label":"Store","name":"store_id","dictionary":"getStoresDictionary","description":"Optional store ID to limit the webhook to events from that single store."}
   * @paramDef {"type":"String","label":"Friendly Name","name":"friendly_name","description":"Optional human-readable name for the webhook."}
   *
   * @returns {Object}
   * @sampleResult {"id":111222}
   */
  async subscribeWebhook(target_url, event, store_id, friendly_name) {
    const body = clean({
      target_url,
      event,
      store_id,
      friendly_name,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/webhooks/subscribe`,
      method: 'post',
      body,
      logTag: 'subscribeWebhook',
    })
  }

  /**
   * @description Unsubscribes (deletes) an existing webhook by webhook ID so that ShipStation stops posting events to its target URL.
   * @route POST /unsubscribe-webhook
   * @operationName Unsubscribe Webhook
   * @category Webhooks
   * @appearanceColor #1A75BB #5BA3D9
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Webhook ID","name":"webhookId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The unique webhook ID to unsubscribe."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Webhook unsubscribed successfully."}
   */
  async unsubscribeWebhook(webhookId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/webhooks/${ webhookId }`,
      method: 'delete',
      logTag: 'unsubscribeWebhook',
    })
  }

  /* ============================================================
   * Trigger Methods (polling)
   * ============================================================ */

  // ShipStation timestamps are account-local with no timezone (e.g. "2025-08-20T07:30:00.6270000").
  // We read the wall-clock AS UTC so the account's real offset cancels out of every comparison,
  // and we emit the same tz-less shape the API filters on - keeping the polling watermark in a
  // single, consistent representation (see judgment.md #16, cursor-representation drift).
  #toEpoch(value) {
    const normalized = String(value).replace(/(\.\d{3})\d*/, '$1').replace(/[zZ]$/, '')

    return Date.parse(`${ normalized }Z`)
  }

  #toShipStationDate(epochMs) {
    return new Date(epochMs).toISOString().replace(/\.\d{3}Z$/, '')
  }

  /**
   * @description Fires when a new order is created in ShipStation, optionally limited to a single store or order status. Orders are matched by their ShipStation creation date. Polling interval can be customized (minimum 30 seconds).
   * @route POST /on-new-order
   * @operationName On New Order
   * @category Triggers
   * @registerAs POLLING_TRIGGER
   * @appearanceColor #1A75BB #5BA3D9
   *
   * @paramDef {"type":"String","label":"Store","name":"storeId","dictionary":"getStoresDictionary","description":"Only fire for orders from this store. Leave blank to watch every store."}
   * @paramDef {"type":"String","label":"Order Status","name":"orderStatus","dictionary":"getOrderStatusesDictionary","description":"Only fire for orders in this status. Leave blank to watch all statuses."}
   *
   * @returns {Object}
   * @sampleResult {"orderId":94113592,"orderNumber":"101","orderKey":"abc","orderDate":"2025-08-20T07:30:00.000","createDate":"2025-08-20T07:31:00.000","modifyDate":"2025-08-20T07:31:00.000","orderStatus":"awaiting_shipment","customerEmail":"buyer@example.com","orderTotal":76.50}
   */
  async onNewOrder(invocation) {
    const triggerData = invocation.triggerData || {}
    const { storeId, orderStatus } = triggerData
    const state = invocation.state || {}

    // First cycle: seed the watermark from the newest order and emit nothing (no backlog replay).
    if (!state.since) {
      const newest = await this.#apiRequest({
        url: `${ API_BASE_URL }/orders`,
        query: { storeId, orderStatus, sortBy: 'CreateDate', sortDir: 'DESC', page: 1, pageSize: 1 },
        logTag: 'onNewOrder',
      })

      const latest = (newest?.orders || [])[0]
      const since = latest?.createDate || this.#toShipStationDate(Date.now() - POLL_SEED_LOOKBACK_MS)

      return { events: [], state: { since, seenIds: [] } }
    }

    // Window by createDate with overlap, ascending, so the boundary is the oldest new order and
    // any undrained pages sit above the watermark (picked up on the next poll, never skipped).
    const createDateStart = this.#toShipStationDate(this.#toEpoch(state.since) - POLL_OVERLAP_MS)
    const seen = new Set(state.seenIds || [])

    const orders = []
    let page = 1
    let pages = 1

    do {
      const result = await this.#apiRequest({
        url: `${ API_BASE_URL }/orders`,
        query: { storeId, orderStatus, createDateStart, sortBy: 'CreateDate', sortDir: 'ASC', page, pageSize: POLL_PAGE_SIZE },
        logTag: 'onNewOrder',
      })

      orders.push(...(result?.orders || []))
      pages = result?.pages || 1
      page += 1
    } while (page <= pages && page <= POLL_MAX_PAGES)

    // Advance the watermark only to the newest createDate actually drained. Because the sort is
    // ascending, any records beyond the page cap have a later createDate and remain above `since`.
    let since = state.since

    for (const order of orders) {
      if (order.createDate && this.#toEpoch(order.createDate) > this.#toEpoch(since)) {
        since = order.createDate
      }
    }

    const events = orders.filter(order => !seen.has(order.orderId))
    const seenIds = [...orders.map(order => order.orderId), ...(state.seenIds || [])].slice(0, POLL_MAX_SEEN_IDS)

    return { events, state: { since, seenIds } }
  }

  /**
   * @description Fires when a new shipment (label) is created in ShipStation, optionally limited to a single carrier or store. Shipments are matched by their ShipStation creation date. Polling interval can be customized (minimum 30 seconds).
   * @route POST /on-new-shipment
   * @operationName On New Shipment
   * @category Triggers
   * @registerAs POLLING_TRIGGER
   * @appearanceColor #1A75BB #5BA3D9
   *
   * @paramDef {"type":"String","label":"Carrier Code","name":"carrierCode","dictionary":"getCarriersDictionary","description":"Only fire for shipments sent via this carrier. Leave blank to watch every carrier."}
   * @paramDef {"type":"String","label":"Store","name":"storeId","dictionary":"getStoresDictionary","description":"Only fire for shipments from this store. Leave blank to watch every store."}
   *
   * @returns {Object}
   * @sampleResult {"shipmentId":12345,"orderId":94113592,"orderNumber":"101","createDate":"2025-08-21T08:00:00.000","shipDate":"2025-08-21","trackingNumber":"9400111202555842761524","carrierCode":"stamps_com","serviceCode":"usps_priority_mail","shipmentCost":7.62,"voided":false}
   */
  async onNewShipment(invocation) {
    const triggerData = invocation.triggerData || {}
    const { carrierCode, storeId } = triggerData
    const state = invocation.state || {}

    // First cycle: seed the watermark from the newest shipment and emit nothing (no backlog replay).
    if (!state.since) {
      const newest = await this.#apiRequest({
        url: `${ API_BASE_URL }/shipments`,
        query: { carrierCode, storeId, sortBy: 'CreateDate', sortDir: 'DESC', page: 1, pageSize: 1 },
        logTag: 'onNewShipment',
      })

      const latest = (newest?.shipments || [])[0]
      const since = latest?.createDate || this.#toShipStationDate(Date.now() - POLL_SEED_LOOKBACK_MS)

      return { events: [], state: { since, seenIds: [] } }
    }

    // Window by createDate with overlap, ascending, so undrained pages stay above the watermark.
    const createDateStart = this.#toShipStationDate(this.#toEpoch(state.since) - POLL_OVERLAP_MS)
    const seen = new Set(state.seenIds || [])

    const shipments = []
    let page = 1
    let pages = 1

    do {
      const result = await this.#apiRequest({
        url: `${ API_BASE_URL }/shipments`,
        query: { carrierCode, storeId, createDateStart, sortBy: 'CreateDate', sortDir: 'ASC', page, pageSize: POLL_PAGE_SIZE },
        logTag: 'onNewShipment',
      })

      shipments.push(...(result?.shipments || []))
      pages = result?.pages || 1
      page += 1
    } while (page <= pages && page <= POLL_MAX_PAGES)

    let since = state.since

    for (const shipment of shipments) {
      if (shipment.createDate && this.#toEpoch(shipment.createDate) > this.#toEpoch(since)) {
        since = shipment.createDate
      }
    }

    const events = shipments.filter(shipment => !seen.has(shipment.shipmentId))
    const seenIds = [...shipments.map(shipment => shipment.shipmentId), ...(state.seenIds || [])].slice(0, POLL_MAX_SEEN_IDS)

    return { events, state: { since, seenIds } }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    return this[invocation.eventName](invocation)
  }
}

Flowrunner.ServerCode.addService(ShipStation, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: 'STRING',
    required: true,
    shared: false,
    hint: 'ShipStation API Key. Generate it from your ShipStation account under Settings > Account > API Settings.',
  },
  {
    name: 'apiSecret',
    displayName: 'API Secret',
    type: 'STRING',
    required: true,
    shared: false,
    hint: 'ShipStation API Secret paired with the API Key. Generate both from Settings > Account > API Settings.',
  },
])
