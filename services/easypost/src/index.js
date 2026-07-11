'use strict'

const BASE_URL = 'https://api.easypost.com/v2'

const logger = {
  info: (...args) => console.log('[EasyPost Service] info:', ...args),
  debug: (...args) => console.log('[EasyPost Service] debug:', ...args),
  error: (...args) => console.log('[EasyPost Service] error:', ...args),
  warn: (...args) => console.log('[EasyPost Service] warn:', ...args),
}

function cleanupObject(obj) {
  if (!obj || typeof obj !== 'object') return obj

  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== '')
  )
}

const ERROR_HINTS = {
  401: 'Authentication failed - check the API Key in the service config and reconnect the account.',
  403: 'Permission denied - this API key cannot access that resource; verify your EasyPost account access.',
  404: 'Not found - the ID may be wrong; use the matching "Get..." action to pick a valid one.',
  422: 'Invalid request - check the field values noted below and try again.',
  429: 'Rate limit hit - retry in a moment.',
}

/**
 * @integrationName EasyPost
 * @integrationIcon /icon.png
 * @integrationTriggersScope SINGLE_APP
 **/
class EasyPost {
  constructor(config) {
    this.auth = Buffer.from(config.apiKey + ':').toString('base64')
  }

  async #apiRequest({ url, method = 'get', body, query, logTag = 'apiRequest' }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }] ${ url }`)

      const request = Flowrunner.Request[method](url)
        .set({
          Authorization: `Basic ${ this.auth }`,
          'Content-Type': 'application/json',
        })
        .query(query || {})

      if (body) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      this.#handleError(error, logTag)
    }
  }

  // Map a provider failure to plain English that tells the user what to do - never leak a raw
  // EasyPost error body into a downstream flow node.
  #handleError(error, logTag) {
    const status = error?.status || error?.code || error?.body?.status
    const apiError = error?.body?.error
    const fieldErrors = Array.isArray(apiError?.errors)
      ? apiError.errors.map(e => (e && e.field ? `${ e.field }: ${ e.message || e.suggestion || '' }` : (e?.message || String(e)))).filter(Boolean).join('; ')
      : ''
    const apiMessage = fieldErrors || apiError?.message || error?.body?.message || error?.message || 'Request failed'
    const hint = ERROR_HINTS[status] || (typeof status === 'number' && status >= 500
      ? 'EasyPost had a temporary error - retry in a moment.'
      : undefined)

    logger.error(`${ logTag } failed (${ status || 'no status' }): ${ apiMessage }`)

    throw new Error(hint ? `${ hint } (${ apiMessage })` : apiMessage)
  }

  // Accept an Array<String> OR a comma-separated string for bulk ID params; '' / [] -> undefined.
  #toList(value) {
    if (value === undefined || value === null || value === '') return undefined

    const arr = Array.isArray(value)
      ? value
      : String(value).split(',').map(s => s.trim()).filter(Boolean)

    return arr.length ? arr : undefined
  }

  // ─── Dictionary Typedefs ─────────────────────────────────────────────────

  /**
   * @typedef {Object} getAddressesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter addresses by name or street."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (before_id) for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getCarrierAccountsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter carrier accounts by type or description."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getShipmentsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter shipments by recipient name or city."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (before_id) for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getBatchesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter batches by reference or ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (before_id) for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getShipmentRatesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Shipment ID","name":"shipmentId","required":true,"description":"The shipment ID to retrieve available rates for."}
   */

  /**
   * @typedef {Object} getShipmentRatesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter rates by carrier or service name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   * @paramDef {"type":"getShipmentRatesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters including the shipment ID to retrieve rates for."}
   */

  /**
   * @typedef {Object} getTrackersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter trackers by tracking code or carrier."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (before_id) for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getPickupsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter pickups by status or confirmation number."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (before_id) for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getInsurancesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter insurance policies by tracking code or reference."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (before_id) for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getWebhooksDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter webhooks by URL."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Unused - the webhook list is not paginated."}
   */

  // ─── Dictionary Methods ──────────────────────────────────────────────────

  /**
   * @operationName Get Addresses Dictionary
   * @description Retrieves saved EasyPost addresses for use in dynamic selection fields with pagination support.
   * @route POST /get-addresses-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getAddressesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering addresses."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"John Smith, 123 Main St, New York NY","value":"adr_abc123","note":"ID: adr_abc123"}],"cursor":"adr_abc123"}
   */
  async getAddressesDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = { page_size: 20 }

    if (cursor) {
      query.before_id = cursor
    }

    const response = await this.#apiRequest({
      url: `${ BASE_URL }/addresses`,
      method: 'get',
      query,
      logTag: 'getAddressesDictionary',
    })

    const addresses = response.addresses || []

    let items = addresses.map(addr => ({
      label: `${ addr.name || 'N/A' }, ${ addr.street1 || '' }, ${ addr.city || '' } ${ addr.state || '' }`.trim(),
      value: addr.id,
      note: `ID: ${ addr.id }`,
    }))

    if (search) {
      const term = search.toLowerCase()
      items = items.filter(item => item.label.toLowerCase().includes(term))
    }

    const nextCursor = addresses.length === 20 ? addresses[addresses.length - 1].id : null

    return { items, cursor: nextCursor }
  }

  /**
   * @operationName Get Carrier Accounts Dictionary
   * @description Retrieves configured EasyPost carrier accounts for use in dynamic selection fields.
   * @route POST /get-carrier-accounts-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getCarrierAccountsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering carrier accounts."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"UPS - Primary UPS Account","value":"ca_abc123","note":"ID: ca_abc123"}],"cursor":null}
   */
  async getCarrierAccountsDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ BASE_URL }/carrier_accounts`,
      method: 'get',
      logTag: 'getCarrierAccountsDictionary',
    })

    const accounts = Array.isArray(response) ? response : (response.carrier_accounts || [])

    let items = accounts.map(account => ({
      label: `${ account.type || 'Unknown' }${ account.description ? ' - ' + account.description : '' }`,
      value: account.id,
      note: `ID: ${ account.id }`,
    }))

    if (search) {
      const term = search.toLowerCase()
      items = items.filter(item => item.label.toLowerCase().includes(term))
    }

    return { items, cursor: null }
  }

  /**
   * @operationName Get Shipments Dictionary
   * @description Retrieves EasyPost shipments for use in dynamic selection fields with pagination support.
   * @route POST /get-shipments-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getShipmentsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering shipments."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"John Smith, New York NY 10001","value":"shp_abc123","note":"unknown"}],"cursor":"shp_abc123"}
   */
  async getShipmentsDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = { page_size: 20 }

    if (cursor) {
      query.before_id = cursor
    }

    const response = await this.#apiRequest({
      url: `${ BASE_URL }/shipments`,
      method: 'get',
      query,
      logTag: 'getShipmentsDictionary',
    })

    const shipments = response.shipments || []

    let items = shipments.map(shp => {
      const to = shp.to_address || {}
      const label = `${ to.name || 'N/A' }, ${ to.city || '' } ${ to.state || '' } ${ to.zip || '' }`.trim()

      return {
        label,
        value: shp.id,
        note: shp.status || 'unknown',
      }
    })

    if (search) {
      const term = search.toLowerCase()
      items = items.filter(item => item.label.toLowerCase().includes(term))
    }

    const nextCursor = shipments.length === 20 ? shipments[shipments.length - 1].id : null

    return { items, cursor: nextCursor }
  }

  /**
   * @operationName Get Batches Dictionary
   * @description Retrieves EasyPost batches for use in dynamic selection fields with pagination support.
   * @route POST /get-batches-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getBatchesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering batches."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Holiday Shipments Batch","value":"batch_abc123","note":"created"}],"cursor":"batch_abc123"}
   */
  async getBatchesDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = { page_size: 20 }

    if (cursor) {
      query.before_id = cursor
    }

    const response = await this.#apiRequest({
      url: `${ BASE_URL }/batches`,
      method: 'get',
      query,
      logTag: 'getBatchesDictionary',
    })

    const batches = response.batches || []

    let items = batches.map(batch => ({
      label: batch.reference || batch.id,
      value: batch.id,
      note: batch.state || 'unknown',
    }))

    if (search) {
      const term = search.toLowerCase()
      items = items.filter(item => item.label.toLowerCase().includes(term))
    }

    const nextCursor = batches.length === 20 ? batches[batches.length - 1].id : null

    return { items, cursor: nextCursor }
  }

  /**
   * @operationName Get Shipment Rates Dictionary
   * @description Retrieves available shipping rates for a specific shipment, including carrier, service, and price details.
   * @route POST /get-shipment-rates-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getShipmentRatesDictionary__payload","label":"Payload","name":"payload","description":"Contains search, cursor, and criteria including shipment ID to retrieve rates for."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"USPS Priority @ $7.58","value":"rate_abc123","note":"delivery_days: 2"}],"cursor":null}
   */
  async getShipmentRatesDictionary(payload) {
    const { search, criteria } = payload || {}
    const shipmentId = criteria?.shipmentId

    if (!shipmentId) {
      return { items: [] }
    }

    const response = await this.#apiRequest({
      url: `${ BASE_URL }/shipments/${ shipmentId }`,
      method: 'get',
      logTag: 'getShipmentRatesDictionary',
    })

    const rates = response.rates || []

    let items = rates.map(rate => ({
      label: `${ rate.carrier } ${ rate.service } @ $${ rate.rate }`,
      value: rate.id,
      note: `delivery_days: ${ rate.delivery_days || 'N/A' }`,
    }))

    if (search) {
      const term = search.toLowerCase()
      items = items.filter(item => item.label.toLowerCase().includes(term))
    }

    return { items, cursor: null }
  }

  /**
   * @operationName Get Label Formats Dictionary
   * @description Provides available shipping label file formats for selection.
   * @route POST /get-label-formats-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"PNG","value":"PNG","note":"Portable Network Graphics image format"},{"label":"PDF","value":"PDF","note":"Portable Document Format"}]}
   */
  getLabelFormatsDictionary() {
    return {
      items: [
        { label: 'PNG', value: 'PNG', note: 'Portable Network Graphics image format' },
        { label: 'PDF', value: 'PDF', note: 'Portable Document Format' },
        { label: 'ZPL', value: 'ZPL', note: 'Zebra Programming Language for thermal printers' },
        { label: 'EPL2', value: 'EPL2', note: 'Eltron Programming Language for thermal printers' },
      ],
    }
  }

  /**
   * @operationName Get Trackers Dictionary
   * @description Retrieves EasyPost trackers for use in dynamic selection fields with pagination support.
   * @route POST /get-trackers-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getTrackersDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering trackers."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"9400111899223456789012 (USPS)","value":"trk_abc123","note":"delivered"}],"cursor":"trk_abc123"}
   */
  async getTrackersDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = { page_size: 20 }

    if (cursor) {
      query.before_id = cursor
    }

    const response = await this.#apiRequest({
      url: `${ BASE_URL }/trackers`,
      method: 'get',
      query,
      logTag: 'getTrackersDictionary',
    })

    const trackers = response.trackers || []

    let items = trackers.map(trk => ({
      label: `${ trk.tracking_code || trk.id } (${ trk.carrier || 'Unknown' })`,
      value: trk.id,
      note: trk.status || 'unknown',
    }))

    if (search) {
      const term = search.toLowerCase()
      items = items.filter(item => item.label.toLowerCase().includes(term))
    }

    const nextCursor = trackers.length === 20 ? trackers[trackers.length - 1].id : null

    return { items, cursor: nextCursor }
  }

  /**
   * @operationName Get Pickups Dictionary
   * @description Retrieves EasyPost pickups for use in dynamic selection fields with pagination support.
   * @route POST /get-pickups-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getPickupsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering pickups."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Pickup pickup_abc123","value":"pickup_abc123","note":"scheduled"}],"cursor":"pickup_abc123"}
   */
  async getPickupsDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = { page_size: 20 }

    if (cursor) {
      query.before_id = cursor
    }

    const response = await this.#apiRequest({
      url: `${ BASE_URL }/pickups`,
      method: 'get',
      query,
      logTag: 'getPickupsDictionary',
    })

    const pickups = response.pickups || []

    let items = pickups.map(pickup => ({
      label: pickup.reference || `Pickup ${ pickup.id }`,
      value: pickup.id,
      note: pickup.status || 'unknown',
    }))

    if (search) {
      const term = search.toLowerCase()
      items = items.filter(item => item.label.toLowerCase().includes(term))
    }

    const nextCursor = pickups.length === 20 ? pickups[pickups.length - 1].id : null

    return { items, cursor: nextCursor }
  }

  /**
   * @operationName Get Insurances Dictionary
   * @description Retrieves EasyPost insurance policies for use in dynamic selection fields with pagination support.
   * @route POST /get-insurances-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getInsurancesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering insurance policies."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"9400111899223456789012 - $100.00","value":"ins_abc123","note":"purchased"}],"cursor":"ins_abc123"}
   */
  async getInsurancesDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = { page_size: 20 }

    if (cursor) {
      query.before_id = cursor
    }

    const response = await this.#apiRequest({
      url: `${ BASE_URL }/insurances`,
      method: 'get',
      query,
      logTag: 'getInsurancesDictionary',
    })

    const insurances = response.insurances || []

    let items = insurances.map(ins => ({
      label: `${ ins.tracking_code || ins.reference || ins.id } - $${ ins.amount }`,
      value: ins.id,
      note: ins.status || 'unknown',
    }))

    if (search) {
      const term = search.toLowerCase()
      items = items.filter(item => item.label.toLowerCase().includes(term))
    }

    const nextCursor = insurances.length === 20 ? insurances[insurances.length - 1].id : null

    return { items, cursor: nextCursor }
  }

  /**
   * @operationName Get Contents Types Dictionary
   * @description Provides the customs contents-type categories accepted by EasyPost customs declarations.
   * @route POST /get-contents-types-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Merchandise","value":"merchandise","note":"Commercial goods for sale"}]}
   */
  getContentsTypesDictionary() {
    return {
      items: [
        { label: 'Documents', value: 'documents', note: 'Printed documents only' },
        { label: 'Gift', value: 'gift', note: 'Non-commercial gift' },
        { label: 'Merchandise', value: 'merchandise', note: 'Commercial goods for sale' },
        { label: 'Returned Goods', value: 'returned_goods', note: 'Items being returned to sender' },
        { label: 'Sample', value: 'sample', note: 'Product samples, not for sale' },
        { label: 'Dangerous Goods', value: 'dangerous_goods', note: 'Hazardous materials' },
        { label: 'Humanitarian Donation', value: 'humanitarian_donation', note: 'Donated relief goods' },
        { label: 'Other', value: 'other', note: 'Describe in Contents Explanation' },
      ],
    }
  }

  /**
   * @operationName Get Restriction Types Dictionary
   * @description Provides the customs restriction-type categories accepted by EasyPost customs declarations.
   * @route POST /get-restriction-types-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"None","value":"none","note":"No restrictions"}]}
   */
  getRestrictionTypesDictionary() {
    return {
      items: [
        { label: 'None', value: 'none', note: 'No restrictions' },
        { label: 'Other', value: 'other', note: 'Describe in Restriction Comments' },
        { label: 'Quarantine', value: 'quarantine', note: 'Subject to quarantine' },
        { label: 'Sanitary / Phytosanitary Inspection', value: 'sanitary_phytosanitary_inspection', note: 'Subject to health inspection' },
      ],
    }
  }

  /**
   * @operationName Get Non-Delivery Options Dictionary
   * @description Provides the options for what a carrier should do with an undeliverable international shipment.
   * @route POST /get-non-delivery-options-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Return to Sender","value":"return","note":"Default"}]}
   */
  getNonDeliveryOptionsDictionary() {
    return {
      items: [
        { label: 'Return to Sender', value: 'return', note: 'Default' },
        { label: 'Abandon the Shipment', value: 'abandon', note: 'Carrier disposes of the package' },
      ],
    }
  }

  /**
   * @operationName Get Webhooks Dictionary
   * @description Retrieves configured EasyPost webhook endpoints for use in dynamic selection fields.
   * @route POST /get-webhooks-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getWebhooksDictionary__payload","label":"Payload","name":"payload","description":"Contains an optional search string to filter webhooks by URL."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"https://example.com/easypost","value":"hook_d393bda62d1511f09d140fc7cf06773a","note":"active"}],"cursor":null}
   */
  async getWebhooksDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ BASE_URL }/webhooks`,
      method: 'get',
      logTag: 'getWebhooksDictionary',
    })

    const webhooks = response.webhooks || []

    let items = webhooks.map(hook => ({
      label: hook.url,
      value: hook.id,
      note: hook.disabled_at ? 'disabled' : 'active',
    }))

    if (search) {
      const term = search.toLowerCase()
      items = items.filter(item => item.label.toLowerCase().includes(term))
    }

    return { items, cursor: null }
  }

  // ─── Schema Loaders ──────────────────────────────────────────────────────

  /**
   * @operationName Customs Item Schema
   * @description Sub-form fields for one customs line item.
   * @route POST /customs-item-schema
   *
   * @registerAs PARAM_SCHEMA_DEFINITION
   *
   * @paramDef {"type":"Object","label":"Criteria","name":"criteria"}
   * @returns {Object}
   */
  customsItemSchema() {
    return [
      { type: 'String', label: 'Description', name: 'description', required: true, description: 'What the item is (e.g. T-shirt).' },
      { type: 'Number', label: 'Quantity', name: 'quantity', required: true, uiComponent: { type: 'NUMERIC_STEPPER' }, description: 'How many units of this item are in the package.' },
      { type: 'Number', label: 'Weight (oz)', name: 'weight', required: true, uiComponent: { type: 'NUMERIC_STEPPER' }, description: 'Total weight of this line item in ounces.' },
      { type: 'Number', label: 'Value (USD)', name: 'value', required: true, uiComponent: { type: 'NUMERIC_STEPPER' }, description: 'Total declared value of this line item in US dollars.' },
      { type: 'String', label: 'HS Tariff Number', name: 'hs_tariff_number', required: true, description: 'Harmonized System tariff code for customs classification (e.g. 123456).' },
      { type: 'String', label: 'Origin Country', name: 'origin_country', required: true, description: 'Two-letter ISO code of the country where the item was made (e.g. US).' },
      { type: 'String', label: 'Currency', name: 'currency', required: false, description: 'Currency of the declared value. Defaults to USD.' },
      { type: 'String', label: 'Manufacturer', name: 'manufacturer', required: false, description: "Name of the item's manufacturer." },
      { type: 'String', label: 'Code', name: 'code', required: false, description: 'Your internal SKU or product code for this item.' },
      { type: 'String', label: 'ECCN', name: 'eccn', required: false, description: 'Export Control Classification Number, if the item is export-controlled.' },
      { type: 'String', label: 'Commodity Identifier', name: 'printed_commodity_identifier', required: false, description: 'Identifier printed on the customs form for this commodity.' },
    ]
  }

  /**
   * @operationName Webhook Custom Header Schema
   * @description Sub-form fields for one custom HTTP header sent with webhook deliveries.
   * @route POST /webhook-custom-header-schema
   *
   * @registerAs PARAM_SCHEMA_DEFINITION
   *
   * @paramDef {"type":"Object","label":"Criteria","name":"criteria"}
   * @returns {Object}
   */
  webhookCustomHeaderSchema() {
    return [
      { type: 'String', label: 'Header Name', name: 'name', required: true, description: 'HTTP header name to send with each webhook delivery (e.g. X-Header-Name).' },
      { type: 'String', label: 'Header Value', name: 'value', required: true, description: 'Value to send for this header.' },
    ]
  }

  // ─── Actions: Addresses ──────────────────────────────────────────────────

  /**
   * @operationName Create Address
   * @description Creates a new address in EasyPost. Optionally verifies the address during creation to ensure deliverability.
   * @route POST /create-address
   * @category Addresses
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Full name of the person at this address."}
   * @paramDef {"type":"String","label":"Street 1","name":"street1","required":true,"description":"Primary street line of the address."}
   * @paramDef {"type":"String","label":"Street 2","name":"street2","description":"Secondary street line (apartment, suite, unit, etc.)."}
   * @paramDef {"type":"String","label":"City","name":"city","required":true,"description":"City of the address."}
   * @paramDef {"type":"String","label":"State","name":"state","required":true,"description":"State or province code (e.g. NY, CA, ON)."}
   * @paramDef {"type":"String","label":"ZIP Code","name":"zip","required":true,"description":"Postal or ZIP code of the address."}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"Two-letter ISO country code. Defaults to US if not specified."}
   * @paramDef {"type":"String","label":"Company","name":"company","description":"Company or organization name at this address."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Phone number associated with this address."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Email address associated with this address."}
   * @paramDef {"type":"Boolean","label":"Verify Address","name":"verify","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the address will be verified during creation to ensure deliverability."}
   *
   * @returns {Object}
   * @sampleResult {"id":"adr_abc123","object":"Address","name":"John Smith","company":"Acme Corp","street1":"123 Main St","street2":"Suite 100","city":"New York","state":"NY","zip":"10001","country":"US","phone":"5551234567","email":"john@example.com","verifications":{"delivery":{"success":true}}}
   */
  async createAddress(name, street1, street2, city, state, zip, country, company, phone, email, verify) {
    const logTag = 'createAddress'

    const addressData = cleanupObject({
      name,
      street1,
      street2,
      city,
      state,
      zip,
      country: country || 'US',
      company,
      phone,
      email,
    })

    const endpoint = verify
      ? `${ BASE_URL }/addresses/create_and_verify`
      : `${ BASE_URL }/addresses`

    const response = await this.#apiRequest({
      url: endpoint,
      method: 'post',
      body: { address: addressData },
      logTag,
    })

    return verify ? response.address || response : response
  }

  /**
   * @operationName Get Address
   * @description Retrieves the details of a specific saved address by its ID.
   * @route POST /get-address
   * @category Addresses
   *
   * @paramDef {"type":"String","label":"Address","name":"addressId","required":true,"dictionary":"getAddressesDictionary","description":"The address to retrieve details for."}
   *
   * @returns {Object}
   * @sampleResult {"id":"adr_abc123","object":"Address","name":"John Smith","street1":"123 Main St","city":"New York","state":"NY","zip":"10001","country":"US","phone":"5551234567"}
   */
  async getAddress(addressId) {
    return await this.#apiRequest({
      url: `${ BASE_URL }/addresses/${ addressId }`,
      method: 'get',
      logTag: 'getAddress',
    })
  }

  /**
   * @operationName Verify Address
   * @description Verifies an existing address for deliverability and accuracy. Returns verification results including any suggested corrections.
   * @route POST /verify-address
   * @category Addresses
   *
   * @paramDef {"type":"String","label":"Address","name":"addressId","required":true,"dictionary":"getAddressesDictionary","description":"The address to verify for deliverability."}
   *
   * @returns {Object}
   * @sampleResult {"id":"adr_abc123","object":"Address","name":"John Smith","company":"","street1":"417 MONTGOMERY ST FL 5","street2":"","city":"SAN FRANCISCO","state":"CA","zip":"94104-1129","country":"US","mode":"test","residential":false,"verifications":{"zip4":{"success":true,"errors":[],"details":null},"delivery":{"success":true,"errors":[],"details":{"latitude":37.79342,"longitude":-122.40288,"time_zone":"America/Los_Angeles"}}}}
   */
  async verifyAddress(addressId) {
    const response = await this.#apiRequest({
      url: `${ BASE_URL }/addresses/${ addressId }/verify`,
      method: 'get',
      logTag: 'verifyAddress',
    })

    return response.address || response
  }

  /**
   * @operationName List Addresses
   * @description Retrieves a paginated list of all saved addresses associated with the EasyPost account.
   * @route POST /list-addresses
   * @category Addresses
   *
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of addresses to return per page. Default: 20."}
   * @paramDef {"type":"String","label":"Before ID","name":"beforeId","description":"Opaque pagination cursor - copy the last address ID from a previous page to fetch older records. (No listable set to pick from.)"}
   * @paramDef {"type":"String","label":"After ID","name":"afterId","description":"Opaque pagination cursor - copy the first address ID from a previous page to fetch newer records. (No listable set to pick from.)"}
   *
   * @returns {Object}
   * @sampleResult {"addresses":[{"id":"adr_abc123","object":"Address","name":"John Smith","street1":"123 Main St","city":"New York","state":"NY","zip":"10001","country":"US"}],"has_more":false}
   */
  async listAddresses(pageSize, beforeId, afterId) {
    const query = cleanupObject({
      page_size: pageSize || 20,
      before_id: beforeId,
      after_id: afterId,
    })

    return await this.#apiRequest({
      url: `${ BASE_URL }/addresses`,
      method: 'get',
      query,
      logTag: 'listAddresses',
    })
  }

  // ─── Actions: Parcels ────────────────────────────────────────────────────

  /**
   * @operationName Create Parcel
   * @description Creates a reusable parcel object defining package dimensions and weight for shipment creation.
   * @route POST /create-parcel
   * @category Parcels
   *
   * @paramDef {"type":"Number","label":"Weight (oz)","name":"weight","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Weight of the parcel in ounces."}
   * @paramDef {"type":"Number","label":"Length (in)","name":"length","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Length of the parcel in inches."}
   * @paramDef {"type":"Number","label":"Width (in)","name":"width","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Width of the parcel in inches."}
   * @paramDef {"type":"Number","label":"Height (in)","name":"height","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Height of the parcel in inches."}
   * @paramDef {"type":"String","label":"Predefined Package","name":"predefinedPackage","description":"Predefined carrier package type (e.g. FlatRateEnvelope, MediumFlatRateBox). Overrides length, width, and height."}
   *
   * @returns {Object}
   * @sampleResult {"id":"prcl_abc123","object":"Parcel","weight":16.0,"length":10.0,"width":8.0,"height":4.0,"predefined_package":null}
   */
  async createParcel(weight, length, width, height, predefinedPackage) {
    const parcelData = cleanupObject({
      weight,
      length,
      width,
      height,
      predefined_package: predefinedPackage,
    })

    return await this.#apiRequest({
      url: `${ BASE_URL }/parcels`,
      method: 'post',
      body: { parcel: parcelData },
      logTag: 'createParcel',
    })
  }

  /**
   * @operationName Get Parcel
   * @description Retrieves the details of a specific parcel by its ID, including dimensions and weight.
   * @route POST /get-parcel
   * @category Parcels
   *
   * @paramDef {"type":"String","label":"Parcel ID","name":"parcelId","required":true,"description":"The ID of the parcel to retrieve (e.g. prcl_abc123). EasyPost has no list-parcels endpoint, so paste the ID returned by Create Parcel."}
   *
   * @returns {Object}
   * @sampleResult {"id":"prcl_abc123","object":"Parcel","weight":16.0,"length":10.0,"width":8.0,"height":4.0,"predefined_package":null}
   */
  async getParcel(parcelId) {
    return await this.#apiRequest({
      url: `${ BASE_URL }/parcels/${ parcelId }`,
      method: 'get',
      logTag: 'getParcel',
    })
  }

  // ─── Actions: Customs ────────────────────────────────────────────────────

  /**
   * @operationName Create Customs Info
   * @description Creates a customs declaration (with its line items) required for international shipments. Attach the returned ID when creating a shipment that crosses a border.
   * @route POST /create-customs-info
   * @category Customs
   *
   * @paramDef {"type":"String","label":"Contents Type","name":"contentsType","required":true,"dictionary":"getContentsTypesDictionary","description":"The category of the package contents for customs (e.g. merchandise, gift, documents)."}
   * @paramDef {"type":"String","label":"Customs Signer","name":"customsSigner","required":true,"description":"Full name of the person certifying that the customs information is accurate."}
   * @paramDef {"type":"Boolean","label":"Certify Accuracy","name":"customsCertify","required":true,"uiComponent":{"type":"TOGGLE"},"description":"Confirms the customs information provided is accurate. Must be enabled for the signer name to be used on the customs form."}
   * @paramDef {"type":"String","label":"EEL / PFC Code","name":"eelPfc","required":true,"description":"Export code for US customs. Use \"NOEEI 30.37(a)\" for shipments valued under $2,500; higher-value shipments need the code from your AES filing."}
   * @paramDef {"type":"String","label":"Restriction Type","name":"restrictionType","required":true,"dictionary":"getRestrictionTypesDictionary","description":"Whether the contents are subject to any import restrictions (quarantine, inspection)."}
   * @paramDef {"type":"Array.<Object>","label":"Customs Items","name":"customsItems","required":true,"schemaLoader":"customsItemSchema","description":"The line items being declared - one entry per distinct product in the package, with description, quantity, weight, value, tariff code, and origin country."}
   * @paramDef {"type":"String","label":"Contents Explanation","name":"contentsExplanation","description":"Human-readable explanation of the contents. Set this when Contents Type is \"other\"."}
   * @paramDef {"type":"String","label":"If Undeliverable","name":"nonDeliveryOption","dictionary":"getNonDeliveryOptionsDictionary","description":"What the carrier should do if the shipment cannot be delivered. Defaults to returning it to the sender."}
   * @paramDef {"type":"String","label":"Restriction Comments","name":"restrictionComments","description":"Details about the restriction. Set this when Restriction Type is \"other\"."}
   *
   * @returns {Object}
   * @sampleResult {"id":"cstinfo_400bef43bd354af1a1bcb3f9e8922ee5","object":"CustomsInfo","created_at":"2025-05-09T20:39:15Z","contents_explanation":"","contents_type":"merchandise","customs_certify":true,"customs_signer":"Steve Brule","eel_pfc":"NOEEI 30.37(a)","non_delivery_option":"return","restriction_comments":null,"restriction_type":"none","mode":"test","declaration":null,"customs_items":[{"id":"cstitem_4e7df04b42fa4ad4a2212620e0d8b78f","object":"CustomsItem","description":"T-shirt","hs_tariff_number":"123456","origin_country":"US","quantity":1,"value":"10.0","weight":5.0}]}
   */
  async createCustomsInfo(contentsType, customsSigner, customsCertify, eelPfc, restrictionType, customsItems, contentsExplanation, nonDeliveryOption, restrictionComments) {
    if (!Array.isArray(customsItems) || !customsItems.length) {
      throw new Error('At least one customs item is required.')
    }

    const customsInfoData = cleanupObject({
      customs_signer: customsSigner,
      contents_type: contentsType,
      contents_explanation: contentsExplanation,
      restriction_type: restrictionType,
      restriction_comments: restrictionComments,
      eel_pfc: eelPfc,
      non_delivery_option: nonDeliveryOption,
      customs_items: customsItems,
    })

    // customs_certify is a required boolean - set it after cleanup so "false" always survives.
    customsInfoData.customs_certify = customsCertify

    return await this.#apiRequest({
      url: `${ BASE_URL }/customs_infos`,
      method: 'post',
      body: { customs_info: customsInfoData },
      logTag: 'createCustomsInfo',
    })
  }

  /**
   * @operationName Get Customs Info
   * @description Retrieves an existing customs declaration by its ID, including its line items.
   * @route POST /get-customs-info
   * @category Customs
   *
   * @paramDef {"type":"String","label":"Customs Info ID","name":"customsInfoId","required":true,"freeform":true,"description":"The ID of the customs declaration to retrieve (e.g. cstinfo_abc123). EasyPost has no list-customs-infos endpoint, so paste the ID returned by Create Customs Info."}
   *
   * @returns {Object}
   * @sampleResult {"id":"cstinfo_400bef43bd354af1a1bcb3f9e8922ee5","object":"CustomsInfo","contents_type":"merchandise","customs_certify":true,"customs_signer":"Steve Brule","eel_pfc":"NOEEI 30.37(a)","non_delivery_option":"return","restriction_type":"none","mode":"test","customs_items":[{"id":"cstitem_4e7df04b42fa4ad4a2212620e0d8b78f","description":"T-shirt","quantity":1,"value":"10.0","weight":5.0}]}
   */
  async getCustomsInfo(customsInfoId) {
    return await this.#apiRequest({
      url: `${ BASE_URL }/customs_infos/${ customsInfoId }`,
      method: 'get',
      logTag: 'getCustomsInfo',
    })
  }

  /**
   * @operationName Create Customs Item
   * @description Creates a standalone customs line item describing one product for international shipping. Items are immutable once created. To include items in a customs declaration, add them directly in Create Customs Info instead - this standalone object is retrievable by ID only.
   * @route POST /create-customs-item
   * @category Customs
   *
   * @paramDef {"type":"String","label":"Description","name":"description","required":true,"description":"What the item is (e.g. T-shirt)."}
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many units of this item are in the package."}
   * @paramDef {"type":"Number","label":"Weight (oz)","name":"weight","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Total weight of this line item in ounces."}
   * @paramDef {"type":"Number","label":"Value (USD)","name":"value","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Total declared value of this line item in US dollars."}
   * @paramDef {"type":"String","label":"HS Tariff Number","name":"hsTariffNumber","required":true,"description":"Harmonized System tariff code for customs classification (e.g. 123456)."}
   * @paramDef {"type":"String","label":"Origin Country","name":"originCountry","required":true,"description":"Two-letter ISO code of the country where the item was made (e.g. US)."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","description":"Currency of the declared value. Defaults to USD."}
   * @paramDef {"type":"String","label":"Manufacturer","name":"manufacturer","description":"Name of the item's manufacturer."}
   * @paramDef {"type":"String","label":"Code","name":"code","description":"Your internal SKU or product code for this item."}
   * @paramDef {"type":"String","label":"ECCN","name":"eccn","description":"Export Control Classification Number, if the item is export-controlled."}
   * @paramDef {"type":"String","label":"Commodity Identifier","name":"printedCommodityIdentifier","description":"Identifier printed on the customs form for this commodity."}
   *
   * @returns {Object}
   * @sampleResult {"id":"cstitem_4e7df04b42fa4ad4a2212620e0d8b78f","object":"CustomsItem","created_at":"2025-05-09T20:39:16Z","description":"T-shirt","hs_tariff_number":"123456","origin_country":"US","quantity":1,"value":"10.0","weight":5.0,"code":"123","mode":"test"}
   */
  async createCustomsItem(description, quantity, weight, value, hsTariffNumber, originCountry, currency, manufacturer, code, eccn, printedCommodityIdentifier) {
    const customsItemData = cleanupObject({
      description,
      quantity,
      weight,
      value,
      hs_tariff_number: hsTariffNumber,
      origin_country: originCountry,
      currency,
      manufacturer,
      code,
      eccn,
      printed_commodity_identifier: printedCommodityIdentifier,
    })

    return await this.#apiRequest({
      url: `${ BASE_URL }/customs_items`,
      method: 'post',
      body: { customs_item: customsItemData },
      logTag: 'createCustomsItem',
    })
  }

  /**
   * @operationName Get Customs Item
   * @description Retrieves an existing customs line item by its ID.
   * @route POST /get-customs-item
   * @category Customs
   *
   * @paramDef {"type":"String","label":"Customs Item ID","name":"customsItemId","required":true,"freeform":true,"description":"The ID of the customs item to retrieve (e.g. cstitem_abc123). EasyPost has no list-customs-items endpoint, so paste the ID returned by Create Customs Item."}
   *
   * @returns {Object}
   * @sampleResult {"id":"cstitem_4e7df04b42fa4ad4a2212620e0d8b78f","object":"CustomsItem","description":"T-shirt","hs_tariff_number":"123456","origin_country":"US","quantity":1,"value":"10.0","weight":5.0,"mode":"test"}
   */
  async getCustomsItem(customsItemId) {
    return await this.#apiRequest({
      url: `${ BASE_URL }/customs_items/${ customsItemId }`,
      method: 'get',
      logTag: 'getCustomsItem',
    })
  }

  // ─── Actions: Shipments ──────────────────────────────────────────────────

  /**
   * @operationName Create Shipment
   * @description Creates a new shipment with inline from/to addresses and parcel details. Returns the shipment with available carrier rates for purchasing.
   * @route POST /create-shipment
   * @category Shipments
   *
   * @paramDef {"type":"String","label":"From Name","name":"fromName","required":true,"description":"Full name of the sender."}
   * @paramDef {"type":"String","label":"From Street","name":"fromStreet1","required":true,"description":"Sender's primary street address."}
   * @paramDef {"type":"String","label":"From City","name":"fromCity","required":true,"description":"Sender's city."}
   * @paramDef {"type":"String","label":"From State","name":"fromState","required":true,"description":"Sender's state or province code."}
   * @paramDef {"type":"String","label":"From ZIP","name":"fromZip","required":true,"description":"Sender's postal or ZIP code."}
   * @paramDef {"type":"String","label":"From Country","name":"fromCountry","description":"Sender's two-letter ISO country code. Defaults to US."}
   * @paramDef {"type":"String","label":"To Name","name":"toName","required":true,"description":"Full name of the recipient."}
   * @paramDef {"type":"String","label":"To Street","name":"toStreet1","required":true,"description":"Recipient's primary street address."}
   * @paramDef {"type":"String","label":"To City","name":"toCity","required":true,"description":"Recipient's city."}
   * @paramDef {"type":"String","label":"To State","name":"toState","required":true,"description":"Recipient's state or province code."}
   * @paramDef {"type":"String","label":"To ZIP","name":"toZip","required":true,"description":"Recipient's postal or ZIP code."}
   * @paramDef {"type":"String","label":"To Country","name":"toCountry","description":"Recipient's two-letter ISO country code. Defaults to US."}
   * @paramDef {"type":"Number","label":"Weight (oz)","name":"weight","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Parcel weight in ounces."}
   * @paramDef {"type":"Number","label":"Length (in)","name":"length","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Parcel length in inches."}
   * @paramDef {"type":"Number","label":"Width (in)","name":"width","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Parcel width in inches."}
   * @paramDef {"type":"Number","label":"Height (in)","name":"height","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Parcel height in inches."}
   * @paramDef {"type":"String","label":"Predefined Package","name":"predefinedPackage","description":"Predefined carrier package type (e.g. FlatRateEnvelope). Overrides dimensions."}
   * @paramDef {"type":"String","label":"Label Format","name":"labelFormat","dictionary":"getLabelFormatsDictionary","description":"Preferred label file format for the label produced when this shipment is bought. Defaults to the carrier's format (usually PNG)."}
   * @paramDef {"type":"String","label":"Restrict to Carrier Account","name":"carrierAccountId","dictionary":"getCarrierAccountsDictionary","description":"Optional carrier account to limit which carriers are rated. Leave empty to rate against all connected carriers."}
   * @paramDef {"type":"String","label":"Customs Info ID","name":"customsInfoId","freeform":true,"description":"For international shipments: the customs declaration to attach (e.g. cstinfo_abc123). Paste the ID returned by Create Customs Info."}
   *
   * @returns {Object}
   * @sampleResult {"id":"shp_abc123","object":"Shipment","status":"unknown","to_address":{"id":"adr_to123","name":"Jane Doe","street1":"456 Oak Ave","city":"Los Angeles","state":"CA","zip":"90001","country":"US"},"from_address":{"id":"adr_from123","name":"John Smith","street1":"123 Main St","city":"New York","state":"NY","zip":"10001","country":"US"},"parcel":{"id":"prcl_abc123","weight":16.0},"options":{"label_format":"PDF"},"customs_info":{"id":"cstinfo_400bef43bd354af1a1bcb3f9e8922ee5"},"rates":[{"id":"rate_abc123","carrier":"USPS","service":"Priority","rate":"7.58","delivery_days":2}]}
   */
  async createShipment(fromName, fromStreet1, fromCity, fromState, fromZip, fromCountry, toName, toStreet1, toCity, toState, toZip, toCountry, weight, length, width, height, predefinedPackage, labelFormat, carrierAccountId, customsInfoId) {
    const shipmentData = {
      from_address: cleanupObject({
        name: fromName,
        street1: fromStreet1,
        city: fromCity,
        state: fromState,
        zip: fromZip,
        country: fromCountry || 'US',
      }),
      to_address: cleanupObject({
        name: toName,
        street1: toStreet1,
        city: toCity,
        state: toState,
        zip: toZip,
        country: toCountry || 'US',
      }),
      parcel: cleanupObject({
        weight,
        length,
        width,
        height,
        predefined_package: predefinedPackage,
      }),
    }

    if (labelFormat) {
      shipmentData.options = { label_format: labelFormat }
    }

    if (carrierAccountId) {
      shipmentData.carrier_accounts = [carrierAccountId]
    }

    if (customsInfoId) {
      shipmentData.customs_info = { id: customsInfoId }
    }

    return await this.#apiRequest({
      url: `${ BASE_URL }/shipments`,
      method: 'post',
      body: { shipment: shipmentData },
      logTag: 'createShipment',
    })
  }

  /**
   * @operationName Create Shipment from Saved
   * @description Creates a new shipment using previously saved address and parcel IDs. Returns the shipment with available carrier rates.
   * @route POST /create-shipment-from-saved
   * @category Shipments
   *
   * @paramDef {"type":"String","label":"From Address","name":"fromAddressId","required":true,"dictionary":"getAddressesDictionary","description":"The saved sender address to use for this shipment."}
   * @paramDef {"type":"String","label":"To Address","name":"toAddressId","required":true,"dictionary":"getAddressesDictionary","description":"The saved recipient address to use for this shipment."}
   * @paramDef {"type":"String","label":"Parcel ID","name":"parcelId","required":true,"description":"The ID of a previously created parcel to use (e.g. prcl_abc123). EasyPost has no list-parcels endpoint, so paste the ID returned by Create Parcel."}
   * @paramDef {"type":"String","label":"Label Format","name":"labelFormat","dictionary":"getLabelFormatsDictionary","description":"Preferred label file format for the label produced when this shipment is bought. Defaults to the carrier's format (usually PNG)."}
   * @paramDef {"type":"String","label":"Restrict to Carrier Account","name":"carrierAccountId","dictionary":"getCarrierAccountsDictionary","description":"Optional carrier account to limit which carriers are rated. Leave empty to rate against all connected carriers."}
   * @paramDef {"type":"String","label":"Customs Info ID","name":"customsInfoId","freeform":true,"description":"For international shipments: the customs declaration to attach (e.g. cstinfo_abc123). Paste the ID returned by Create Customs Info."}
   *
   * @returns {Object}
   * @sampleResult {"id":"shp_abc123","object":"Shipment","status":"unknown","to_address":{"id":"adr_to123","name":"Jane Doe"},"from_address":{"id":"adr_from123","name":"John Smith"},"parcel":{"id":"prcl_abc123","weight":16.0},"customs_info":{"id":"cstinfo_400bef43bd354af1a1bcb3f9e8922ee5"},"rates":[{"id":"rate_abc123","carrier":"USPS","service":"Priority","rate":"7.58","delivery_days":2}]}
   */
  async createShipmentFromSaved(fromAddressId, toAddressId, parcelId, labelFormat, carrierAccountId, customsInfoId) {
    const shipmentData = {
      from_address: { id: fromAddressId },
      to_address: { id: toAddressId },
      parcel: { id: parcelId },
    }

    if (labelFormat) {
      shipmentData.options = { label_format: labelFormat }
    }

    if (carrierAccountId) {
      shipmentData.carrier_accounts = [carrierAccountId]
    }

    if (customsInfoId) {
      shipmentData.customs_info = { id: customsInfoId }
    }

    return await this.#apiRequest({
      url: `${ BASE_URL }/shipments`,
      method: 'post',
      body: { shipment: shipmentData },
      logTag: 'createShipmentFromSaved',
    })
  }

  /**
   * @operationName Create and Buy Shipment
   * @description Creates a shipment and purchases the label in a single step by naming the carrier service directly (e.g. NextDayAir, Priority) - no separate rate-selection step. Returns the shipment with tracking code and label already attached. Use the two-step Create Shipment + Buy Shipment when you want to compare rates first.
   * @route POST /create-and-buy-shipment
   * @category Shipments
   *
   * @paramDef {"type":"String","label":"From Name","name":"fromName","required":true,"description":"Full name of the sender."}
   * @paramDef {"type":"String","label":"From Street","name":"fromStreet1","required":true,"description":"Sender's primary street address."}
   * @paramDef {"type":"String","label":"From City","name":"fromCity","required":true,"description":"Sender's city."}
   * @paramDef {"type":"String","label":"From State","name":"fromState","required":true,"description":"Sender's state or province code."}
   * @paramDef {"type":"String","label":"From ZIP","name":"fromZip","required":true,"description":"Sender's postal or ZIP code."}
   * @paramDef {"type":"String","label":"From Country","name":"fromCountry","description":"Sender's two-letter ISO country code. Defaults to US."}
   * @paramDef {"type":"String","label":"To Name","name":"toName","required":true,"description":"Full name of the recipient."}
   * @paramDef {"type":"String","label":"To Street","name":"toStreet1","required":true,"description":"Recipient's primary street address."}
   * @paramDef {"type":"String","label":"To City","name":"toCity","required":true,"description":"Recipient's city."}
   * @paramDef {"type":"String","label":"To State","name":"toState","required":true,"description":"Recipient's state or province code."}
   * @paramDef {"type":"String","label":"To ZIP","name":"toZip","required":true,"description":"Recipient's postal or ZIP code."}
   * @paramDef {"type":"String","label":"To Country","name":"toCountry","description":"Recipient's two-letter ISO country code. Defaults to US."}
   * @paramDef {"type":"Number","label":"Weight (oz)","name":"weight","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Parcel weight in ounces."}
   * @paramDef {"type":"Number","label":"Length (in)","name":"length","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Parcel length in inches."}
   * @paramDef {"type":"Number","label":"Width (in)","name":"width","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Parcel width in inches."}
   * @paramDef {"type":"Number","label":"Height (in)","name":"height","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Parcel height in inches."}
   * @paramDef {"type":"String","label":"Carrier Service","name":"service","required":true,"description":"The exact carrier service to buy (e.g. Priority for USPS, NextDayAir for UPS). Must be a service the selected carrier account offers - carrier-specific, so entered as text."}
   * @paramDef {"type":"String","label":"Carrier Account","name":"carrierAccountId","required":true,"dictionary":"getCarrierAccountsDictionary","description":"The carrier account to purchase from. Required so EasyPost knows which carrier's service to buy."}
   * @paramDef {"type":"String","label":"Customs Info ID","name":"customsInfoId","freeform":true,"description":"For international shipments: the customs declaration to attach (e.g. cstinfo_abc123). Paste the ID returned by Create Customs Info; EasyPost has no list endpoint for these."}
   * @paramDef {"type":"String","label":"Label Format","name":"labelFormat","dictionary":"getLabelFormatsDictionary","description":"Preferred label file format for the purchased label. Defaults to the carrier's format (usually PNG)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"shp_abc123","object":"Shipment","status":"unknown","tracking_code":"9405500208303109884175","postage_label":{"id":"pl_abc123","label_url":"https://easypost-files.s3.amazonaws.com/files/postage_label/label.png","label_file_type":"image/png","label_date":"2025-05-09T20:39:15Z"},"selected_rate":{"id":"rate_abc123","carrier":"UPS","service":"NextDayAir","rate":"31.25"},"customs_info":{"id":"cstinfo_400bef43bd354af1a1bcb3f9e8922ee5"},"tracker":{"id":"trk_abc123","status":"pre_transit"}}
   */
  async createAndBuyShipment(fromName, fromStreet1, fromCity, fromState, fromZip, fromCountry, toName, toStreet1, toCity, toState, toZip, toCountry, weight, length, width, height, service, carrierAccountId, customsInfoId, labelFormat) {
    const shipmentData = {
      from_address: cleanupObject({
        name: fromName,
        street1: fromStreet1,
        city: fromCity,
        state: fromState,
        zip: fromZip,
        country: fromCountry || 'US',
      }),
      to_address: cleanupObject({
        name: toName,
        street1: toStreet1,
        city: toCity,
        state: toState,
        zip: toZip,
        country: toCountry || 'US',
      }),
      parcel: cleanupObject({ weight, length, width, height }),
      service,
      carrier_accounts: [carrierAccountId],
    }

    if (customsInfoId) {
      shipmentData.customs_info = { id: customsInfoId }
    }

    if (labelFormat) {
      shipmentData.options = { label_format: labelFormat }
    }

    return await this.#apiRequest({
      url: `${ BASE_URL }/shipments`,
      method: 'post',
      body: { shipment: shipmentData },
      logTag: 'createAndBuyShipment',
    })
  }

  /**
   * @operationName Get Shipment
   * @description Retrieves the full details of a specific shipment, including addresses, parcel, rates, and tracking information.
   * @route POST /get-shipment
   * @category Shipments
   *
   * @paramDef {"type":"String","label":"Shipment","name":"shipmentId","required":true,"dictionary":"getShipmentsDictionary","description":"The shipment to retrieve details for."}
   *
   * @returns {Object}
   * @sampleResult {"id":"shp_abc123","object":"Shipment","status":"delivered","tracking_code":"9400111899223456789012","to_address":{"name":"Jane Doe","city":"Los Angeles","state":"CA"},"from_address":{"name":"John Smith","city":"New York","state":"NY"},"selected_rate":{"carrier":"USPS","service":"Priority","rate":"7.58"}}
   */
  async getShipment(shipmentId) {
    return await this.#apiRequest({
      url: `${ BASE_URL }/shipments/${ shipmentId }`,
      method: 'get',
      logTag: 'getShipment',
    })
  }

  /**
   * @operationName List Shipments
   * @description Retrieves a paginated list of all shipments associated with the EasyPost account.
   * @route POST /list-shipments
   * @category Shipments
   *
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of shipments to return per page. Default: 20."}
   * @paramDef {"type":"String","label":"Before ID","name":"beforeId","description":"Opaque pagination cursor - copy the last shipment ID from a previous page to fetch older records. (No listable set to pick from.)"}
   * @paramDef {"type":"String","label":"After ID","name":"afterId","description":"Opaque pagination cursor - copy the first shipment ID from a previous page to fetch newer records. (No listable set to pick from.)"}
   *
   * @returns {Object}
   * @sampleResult {"shipments":[{"id":"shp_abc123","object":"Shipment","status":"delivered","tracking_code":"9400111899223456789012","to_address":{"name":"Jane Doe","city":"Los Angeles"}}],"has_more":false}
   */
  async listShipments(pageSize, beforeId, afterId) {
    const query = cleanupObject({
      page_size: pageSize || 20,
      before_id: beforeId,
      after_id: afterId,
    })

    return await this.#apiRequest({
      url: `${ BASE_URL }/shipments`,
      method: 'get',
      query,
      logTag: 'listShipments',
    })
  }

  /**
   * @operationName Buy Shipment
   * @description Purchases a shipping label for a shipment at the selected rate. This is the primary method for buying postage.
   * @route POST /buy-shipment
   * @category Shipments
   *
   * @paramDef {"type":"String","label":"Shipment","name":"shipmentId","required":true,"dictionary":"getShipmentsDictionary","description":"The shipment to purchase a label for."}
   * @paramDef {"type":"String","label":"Rate","name":"rateId","required":true,"dictionary":"getShipmentRatesDictionary","dependsOn":["shipmentId"],"description":"The shipping rate to purchase. Rates are loaded based on the selected shipment."}
   * @paramDef {"type":"String","label":"Insurance Amount (USD)","name":"insurance","description":"Optional coverage amount in USD to insure the shipment during purchase (e.g. 100.00). Leave empty for no insurance. To change the label file format, set Label Format on Create Shipment or use Convert Label Format."}
   *
   * @returns {Object}
   * @sampleResult {"id":"shp_abc123","object":"Shipment","status":"unknown","tracking_code":"9400111899223456789012","postage_label":{"id":"pl_abc123","label_url":"https://easypost-files.s3.amazonaws.com/files/postage_label/label.png","label_file_type":"image/png"},"selected_rate":{"id":"rate_abc123","carrier":"USPS","service":"Priority","rate":"7.58"},"tracker":{"id":"trk_abc123","status":"pre_transit"}}
   */
  async buyShipment(shipmentId, rateId, insurance) {
    const body = {
      rate: { id: rateId },
    }

    if (insurance) {
      body.insurance = insurance
    }

    return await this.#apiRequest({
      url: `${ BASE_URL }/shipments/${ shipmentId }/buy`,
      method: 'post',
      body,
      logTag: 'buyShipment',
    })
  }

  /**
   * @operationName Convert Label Format
   * @description Converts a purchased shipment label to a different file format (e.g. from PNG to PDF).
   * @route POST /convert-label-format
   * @category Shipments
   *
   * @paramDef {"type":"String","label":"Shipment","name":"shipmentId","required":true,"dictionary":"getShipmentsDictionary","description":"The shipment whose label format to convert."}
   * @paramDef {"type":"String","label":"Label Format","name":"labelFormat","required":true,"dictionary":"getLabelFormatsDictionary","description":"The target file format for the label conversion."}
   *
   * @returns {Object}
   * @sampleResult {"id":"shp_abc123","postage_label":{"id":"pl_abc123","label_url":"https://easypost-files.s3.amazonaws.com/files/postage_label/label.pdf","label_file_type":"application/pdf"}}
   */
  async convertLabelFormat(shipmentId, labelFormat) {
    return await this.#apiRequest({
      url: `${ BASE_URL }/shipments/${ shipmentId }/label`,
      method: 'get',
      query: { file_format: labelFormat },
      logTag: 'convertLabelFormat',
    })
  }

  /**
   * @operationName Refund Shipment
   * @description Requests a postage refund for a purchased shipment by its ID. USPS labels are refundable within 30 days if unscanned; UPS and FedEx within 90 days. The refund starts as "submitted" and the carrier confirms it asynchronously. Distinct from Create Refund, which refunds by carrier and tracking codes instead of a shipment ID.
   * @route POST /refund-shipment
   * @category Shipments
   *
   * @paramDef {"type":"String","label":"Shipment","name":"shipmentId","required":true,"dictionary":"getShipmentsDictionary","description":"The purchased shipment to refund."}
   *
   * @returns {Object}
   * @sampleResult {"id":"shp_abc123","object":"Shipment","status":"delivered","tracking_code":"9400111899223456789012","refund_status":"submitted","selected_rate":{"id":"rate_abc123","carrier":"USPS","service":"Priority","rate":"7.58"}}
   */
  async refundShipment(shipmentId) {
    return await this.#apiRequest({
      url: `${ BASE_URL }/shipments/${ shipmentId }/refund`,
      method: 'post',
      body: {},
      logTag: 'refundShipment',
    })
  }

  // ─── Actions: Tracking ───────────────────────────────────────────────────

  /**
   * @operationName Create Tracker
   * @description Creates a new tracking object for monitoring a package shipment across carriers. Tracking updates are generated automatically.
   * @route POST /create-tracker
   * @category Tracking
   *
   * @paramDef {"type":"String","label":"Tracking Code","name":"trackingCode","required":true,"description":"The carrier-provided tracking number for the shipment."}
   * @paramDef {"type":"String","label":"Carrier","name":"carrier","required":true,"description":"The carrier name (e.g. USPS, UPS, FedEx, DHL)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"trk_abc123","object":"Tracker","tracking_code":"9400111899223456789012","status":"in_transit","carrier":"USPS","est_delivery_date":"2025-01-20T00:00:00Z","tracking_details":[{"message":"Arrived at USPS facility","status":"in_transit","datetime":"2025-01-18T14:30:00Z"}]}
   */
  async createTracker(trackingCode, carrier) {
    return await this.#apiRequest({
      url: `${ BASE_URL }/trackers`,
      method: 'post',
      body: {
        tracker: {
          tracking_code: trackingCode,
          carrier,
        },
      },
      logTag: 'createTracker',
    })
  }

  /**
   * @operationName Get Tracker
   * @description Retrieves the full tracking details for a specific tracker, including all tracking events and estimated delivery date.
   * @route POST /get-tracker
   * @category Tracking
   *
   * @paramDef {"type":"String","label":"Tracker","name":"trackerId","required":true,"dictionary":"getTrackersDictionary","description":"The tracker to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"trk_abc123","object":"Tracker","tracking_code":"9400111899223456789012","status":"delivered","carrier":"USPS","est_delivery_date":"2025-01-20T00:00:00Z","tracking_details":[{"message":"Delivered","status":"delivered","datetime":"2025-01-20T10:15:00Z"}]}
   */
  async getTracker(trackerId) {
    return await this.#apiRequest({
      url: `${ BASE_URL }/trackers/${ trackerId }`,
      method: 'get',
      logTag: 'getTracker',
    })
  }

  /**
   * @operationName List Trackers
   * @description Retrieves a paginated list of all trackers with optional filtering by tracking code or carrier.
   * @route POST /list-trackers
   * @category Tracking
   *
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of trackers to return per page. Default: 20."}
   * @paramDef {"type":"String","label":"Before ID","name":"beforeId","description":"Opaque pagination cursor - copy the last tracker ID from a previous page to fetch older records. (No listable set to pick from.)"}
   * @paramDef {"type":"String","label":"After ID","name":"afterId","description":"Opaque pagination cursor - copy the first tracker ID from a previous page to fetch newer records. (No listable set to pick from.)"}
   * @paramDef {"type":"String","label":"Tracking Code","name":"trackingCode","description":"Filter trackers by a specific tracking code."}
   * @paramDef {"type":"String","label":"Carrier","name":"carrier","description":"Filter trackers by carrier name (e.g. USPS, UPS, FedEx)."}
   *
   * @returns {Object}
   * @sampleResult {"trackers":[{"id":"trk_abc123","tracking_code":"9400111899223456789012","status":"delivered","carrier":"USPS"}],"has_more":false}
   */
  async listTrackers(pageSize, beforeId, afterId, trackingCode, carrier) {
    const query = cleanupObject({
      page_size: pageSize || 20,
      before_id: beforeId,
      after_id: afterId,
      tracking_code: trackingCode,
      carrier,
    })

    return await this.#apiRequest({
      url: `${ BASE_URL }/trackers`,
      method: 'get',
      query,
      logTag: 'listTrackers',
    })
  }

  /**
   * @operationName Delete Tracker
   * @description Permanently deletes a tracker and its associated tracking data.
   * @route POST /delete-tracker
   * @category Tracking
   *
   * @paramDef {"type":"String","label":"Tracker","name":"trackerId","required":true,"dictionary":"getTrackersDictionary","description":"The tracker to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteTracker(trackerId) {
    return await this.#apiRequest({
      url: `${ BASE_URL }/trackers/${ trackerId }`,
      method: 'delete',
      logTag: 'deleteTracker',
    })
  }

  // ─── Actions: Batches ────────────────────────────────────────────────────

  /**
   * @operationName Create Batch
   * @description Creates a new batch for processing multiple shipments together. Optionally adds shipments to the batch during creation.
   * @route POST /create-batch
   * @category Batches
   *
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"A custom reference identifier for this batch (e.g. order number, date)."}
   * @paramDef {"type":"Array<String>","label":"Shipment IDs","name":"shipmentIds","description":"Shipment IDs to include in the batch (e.g. shp_abc123). Accepts a list or a comma-separated string."}
   *
   * @returns {Object}
   * @sampleResult {"id":"batch_abc123","object":"Batch","state":"created","reference":"Holiday Shipments","num_shipments":2,"shipments":[{"id":"shp_abc123"}]}
   */
  async createBatch(reference, shipmentIds) {
    const body = {}

    if (reference) {
      body.reference = reference
    }

    const ids = this.#toList(shipmentIds)

    if (ids) {
      body.shipments = ids.map(id => ({ id }))
    }

    return await this.#apiRequest({
      url: `${ BASE_URL }/batches`,
      method: 'post',
      body: { batch: body },
      logTag: 'createBatch',
    })
  }

  /**
   * @operationName Get Batch
   * @description Retrieves the full details of a specific batch, including its state and shipment information.
   * @route POST /get-batch
   * @category Batches
   *
   * @paramDef {"type":"String","label":"Batch","name":"batchId","required":true,"dictionary":"getBatchesDictionary","description":"The batch to retrieve details for."}
   *
   * @returns {Object}
   * @sampleResult {"id":"batch_abc123","object":"Batch","state":"purchased","reference":"Holiday Shipments","num_shipments":5,"shipments":[{"id":"shp_abc123","tracking_code":"9400111899223456789012"}],"label_url":null}
   */
  async getBatch(batchId) {
    return await this.#apiRequest({
      url: `${ BASE_URL }/batches/${ batchId }`,
      method: 'get',
      logTag: 'getBatch',
    })
  }

  /**
   * @operationName List Batches
   * @description Retrieves a paginated list of all batches associated with the EasyPost account.
   * @route POST /list-batches
   * @category Batches
   *
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of batches to return per page. Default: 20."}
   * @paramDef {"type":"String","label":"Before ID","name":"beforeId","description":"Opaque pagination cursor - copy the last batch ID from a previous page to fetch older records. (No listable set to pick from.)"}
   * @paramDef {"type":"String","label":"After ID","name":"afterId","description":"Opaque pagination cursor - copy the first batch ID from a previous page to fetch newer records. (No listable set to pick from.)"}
   *
   * @returns {Object}
   * @sampleResult {"batches":[{"id":"batch_abc123","object":"Batch","state":"created","reference":"Holiday Shipments","num_shipments":5}],"has_more":false}
   */
  async listBatches(pageSize, beforeId, afterId) {
    const query = cleanupObject({
      page_size: pageSize || 20,
      before_id: beforeId,
      after_id: afterId,
    })

    return await this.#apiRequest({
      url: `${ BASE_URL }/batches`,
      method: 'get',
      query,
      logTag: 'listBatches',
    })
  }

  /**
   * @operationName Add Shipments to Batch
   * @description Adds one or more shipments to an existing batch for bulk processing.
   * @route POST /add-shipments-to-batch
   * @category Batches
   *
   * @paramDef {"type":"String","label":"Batch","name":"batchId","required":true,"dictionary":"getBatchesDictionary","description":"The batch to add shipments to."}
   * @paramDef {"type":"Array<String>","label":"Shipment IDs","name":"shipmentIds","required":true,"description":"Shipment IDs to add to the batch (e.g. shp_abc123). Accepts a list or a comma-separated string."}
   *
   * @returns {Object}
   * @sampleResult {"id":"batch_abc123","object":"Batch","state":"created","num_shipments":7}
   */
  async addShipmentsToBatch(batchId, shipmentIds) {
    const ids = this.#toList(shipmentIds)

    if (!ids) {
      throw new Error('At least one shipment ID is required.')
    }

    return await this.#apiRequest({
      url: `${ BASE_URL }/batches/${ batchId }/add_shipments`,
      method: 'post',
      body: { shipments: ids.map(id => ({ id })) },
      logTag: 'addShipmentsToBatch',
    })
  }

  /**
   * @operationName Remove Shipments from Batch
   * @description Removes one or more shipments from an existing batch.
   * @route POST /remove-shipments-from-batch
   * @category Batches
   *
   * @paramDef {"type":"String","label":"Batch","name":"batchId","required":true,"dictionary":"getBatchesDictionary","description":"The batch to remove shipments from."}
   * @paramDef {"type":"Array<String>","label":"Shipment IDs","name":"shipmentIds","required":true,"description":"Shipment IDs to remove from the batch (e.g. shp_abc123). Accepts a list or a comma-separated string."}
   *
   * @returns {Object}
   * @sampleResult {"id":"batch_abc123","object":"Batch","state":"created","num_shipments":3}
   */
  async removeShipmentsFromBatch(batchId, shipmentIds) {
    const ids = this.#toList(shipmentIds)

    if (!ids) {
      throw new Error('At least one shipment ID is required.')
    }

    return await this.#apiRequest({
      url: `${ BASE_URL }/batches/${ batchId }/remove_shipments`,
      method: 'post',
      body: { shipments: ids.map(id => ({ id })) },
      logTag: 'removeShipmentsFromBatch',
    })
  }

  /**
   * @operationName Buy Batch
   * @description Purchases labels for all shipments in a batch. Each shipment must have a selected rate before buying.
   * @route POST /buy-batch
   * @category Batches
   *
   * @paramDef {"type":"String","label":"Batch","name":"batchId","required":true,"dictionary":"getBatchesDictionary","description":"The batch to purchase labels for."}
   *
   * @returns {Object}
   * @sampleResult {"id":"batch_abc123","object":"Batch","state":"purchasing","num_shipments":5}
   */
  async buyBatch(batchId) {
    return await this.#apiRequest({
      url: `${ BASE_URL }/batches/${ batchId }/buy`,
      method: 'post',
      body: {},
      logTag: 'buyBatch',
    })
  }

  /**
   * @operationName Generate Batch Label
   * @description Generates a consolidated label document for all shipments in a purchased batch in the specified format.
   * @route POST /generate-batch-label
   * @category Batches
   *
   * @paramDef {"type":"String","label":"Batch","name":"batchId","required":true,"dictionary":"getBatchesDictionary","description":"The batch to generate a consolidated label for."}
   * @paramDef {"type":"String","label":"Label Format","name":"labelFormat","required":true,"dictionary":"getLabelFormatsDictionary","description":"The file format for the consolidated batch label."}
   *
   * @returns {Object}
   * @sampleResult {"id":"batch_abc123","object":"Batch","state":"label_generating","label_url":null}
   */
  async generateBatchLabel(batchId, labelFormat) {
    return await this.#apiRequest({
      url: `${ BASE_URL }/batches/${ batchId }/label`,
      method: 'post',
      body: { file_format: labelFormat },
      logTag: 'generateBatchLabel',
    })
  }

  // ─── Actions: Pickups ────────────────────────────────────────────────────

  /**
   * @operationName Create Pickup
   * @description Schedules a carrier pickup for a shipment at the specified address and time window.
   * @route POST /create-pickup
   * @category Pickups
   *
   * @paramDef {"type":"String","label":"Shipment","name":"shipmentId","required":true,"dictionary":"getShipmentsDictionary","description":"The shipment to schedule a pickup for."}
   * @paramDef {"type":"String","label":"Pickup Address","name":"addressId","required":true,"dictionary":"getAddressesDictionary","description":"The address where the carrier should pick up the package."}
   * @paramDef {"type":"String","label":"Earliest Pickup Time","name":"minDatetime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"The earliest date and time the carrier can pick up the package."}
   * @paramDef {"type":"String","label":"Latest Pickup Time","name":"maxDatetime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"The latest date and time the carrier can pick up the package."}
   * @paramDef {"type":"String","label":"Instructions","name":"instructions","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Special instructions for the carrier driver (e.g. gate code, leave at front desk)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"pickup_abc123","object":"Pickup","status":"unknown","min_datetime":"2025-01-20T09:00:00Z","max_datetime":"2025-01-20T17:00:00Z","is_account_address":false,"instructions":"Ring doorbell","pickup_rates":[{"carrier":"USPS","service":"NextDay","rate":"5.00"}]}
   */
  async createPickup(shipmentId, addressId, minDatetime, maxDatetime, instructions) {
    const pickupData = cleanupObject({
      shipment: { id: shipmentId },
      address: { id: addressId },
      min_datetime: minDatetime,
      max_datetime: maxDatetime,
      instructions,
    })

    return await this.#apiRequest({
      url: `${ BASE_URL }/pickups`,
      method: 'post',
      body: { pickup: pickupData },
      logTag: 'createPickup',
    })
  }

  /**
   * @operationName Get Pickup
   * @description Retrieves the full details of a specific pickup including status, rates, and scheduling information.
   * @route POST /get-pickup
   * @category Pickups
   *
   * @paramDef {"type":"String","label":"Pickup","name":"pickupId","required":true,"dictionary":"getPickupsDictionary","description":"The pickup to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"pickup_abc123","object":"Pickup","status":"scheduled","min_datetime":"2025-01-20T09:00:00Z","max_datetime":"2025-01-20T17:00:00Z","pickup_rates":[{"carrier":"USPS","service":"NextDay","rate":"5.00"}]}
   */
  async getPickup(pickupId) {
    return await this.#apiRequest({
      url: `${ BASE_URL }/pickups/${ pickupId }`,
      method: 'get',
      logTag: 'getPickup',
    })
  }

  /**
   * @operationName Buy Pickup
   * @description Purchases a pickup at the specified carrier and service level. The pickup must have been created first.
   * @route POST /buy-pickup
   * @category Pickups
   *
   * @paramDef {"type":"String","label":"Pickup","name":"pickupId","required":true,"dictionary":"getPickupsDictionary","description":"The pickup to purchase."}
   * @paramDef {"type":"String","label":"Carrier","name":"carrier","required":true,"description":"The carrier to use for the pickup (e.g. USPS, UPS, FedEx)."}
   * @paramDef {"type":"String","label":"Service","name":"service","required":true,"description":"The service level for the pickup (e.g. NextDay, SameDay)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"pickup_abc123","object":"Pickup","status":"scheduled","confirmation":"PICKUP123456","pickup_rates":[{"carrier":"USPS","service":"NextDay","rate":"5.00"}]}
   */
  async buyPickup(pickupId, carrier, service) {
    return await this.#apiRequest({
      url: `${ BASE_URL }/pickups/${ pickupId }/buy`,
      method: 'post',
      body: { carrier, service },
      logTag: 'buyPickup',
    })
  }

  /**
   * @operationName Cancel Pickup
   * @description Cancels a previously scheduled carrier pickup. Once canceled, the carrier will not attempt collection.
   * @route POST /cancel-pickup
   * @category Pickups
   *
   * @paramDef {"type":"String","label":"Pickup","name":"pickupId","required":true,"dictionary":"getPickupsDictionary","description":"The pickup to cancel."}
   *
   * @returns {Object}
   * @sampleResult {"id":"pickup_abc123","object":"Pickup","status":"canceled","confirmation":"PICKUP123456","pickup_rates":[{"carrier":"USPS","service":"NextDay","rate":"5.00"}]}
   */
  async cancelPickup(pickupId) {
    return await this.#apiRequest({
      url: `${ BASE_URL }/pickups/${ pickupId }/cancel`,
      method: 'post',
      body: {},
      logTag: 'cancelPickup',
    })
  }

  // ─── Actions: Insurance ──────────────────────────────────────────────────

  /**
   * @operationName Create Insurance
   * @description Creates a standalone insurance policy for a shipment with a specified coverage amount.
   * @route POST /create-insurance
   * @category Insurance
   *
   * @paramDef {"type":"String","label":"Tracking Code","name":"trackingCode","required":true,"description":"The carrier tracking number for the shipment to insure."}
   * @paramDef {"type":"String","label":"Carrier","name":"carrier","required":true,"description":"The carrier name for the shipment (e.g. USPS, UPS, FedEx)."}
   * @paramDef {"type":"String","label":"Amount (USD)","name":"amount","required":true,"description":"The insurance coverage amount in USD (e.g. 100.00). Maximum $5,000."}
   * @paramDef {"type":"String","label":"To Address","name":"toAddressId","dictionary":"getAddressesDictionary","description":"Optional destination address for the insured shipment. Improves coverage accuracy; not required."}
   * @paramDef {"type":"String","label":"From Address","name":"fromAddressId","dictionary":"getAddressesDictionary","description":"Optional origin address for the insured shipment. Improves coverage accuracy; not required."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"A custom reference identifier for this insurance policy."}
   *
   * @returns {Object}
   * @sampleResult {"id":"ins_abc123","object":"Insurance","status":"pending","tracking_code":"9400111899223456789012","carrier":"USPS","amount":"100.00","reference":"ORDER-12345","to_address":{"id":"adr_to123"},"from_address":{"id":"adr_from123"}}
   */
  async createInsurance(trackingCode, carrier, amount, toAddressId, fromAddressId, reference) {
    const insuranceData = cleanupObject({
      tracking_code: trackingCode,
      carrier,
      amount,
      reference,
    })

    if (toAddressId) {
      insuranceData.to_address = { id: toAddressId }
    }

    if (fromAddressId) {
      insuranceData.from_address = { id: fromAddressId }
    }

    return await this.#apiRequest({
      url: `${ BASE_URL }/insurances`,
      method: 'post',
      body: { insurance: insuranceData },
      logTag: 'createInsurance',
    })
  }

  /**
   * @operationName Get Insurance
   * @description Retrieves the full details of a specific insurance policy, including status and coverage information.
   * @route POST /get-insurance
   * @category Insurance
   *
   * @paramDef {"type":"String","label":"Insurance","name":"insuranceId","required":true,"dictionary":"getInsurancesDictionary","description":"The insurance policy to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"ins_abc123","object":"Insurance","status":"pending","tracking_code":"9400111899223456789012","carrier":"USPS","amount":"100.00","reference":"ORDER-12345"}
   */
  async getInsurance(insuranceId) {
    return await this.#apiRequest({
      url: `${ BASE_URL }/insurances/${ insuranceId }`,
      method: 'get',
      logTag: 'getInsurance',
    })
  }

  /**
   * @operationName Refund Insurance
   * @description Requests a refund for an existing insurance policy. The insurance must be in a refundable state.
   * @route POST /refund-insurance
   * @category Insurance
   *
   * @paramDef {"type":"String","label":"Insurance","name":"insuranceId","required":true,"dictionary":"getInsurancesDictionary","description":"The insurance policy to refund."}
   *
   * @returns {Object}
   * @sampleResult {"id":"ins_abc123","object":"Insurance","status":"cancelled","amount":"100.00"}
   */
  async refundInsurance(insuranceId) {
    return await this.#apiRequest({
      url: `${ BASE_URL }/insurances/${ insuranceId }/refund`,
      method: 'post',
      body: {},
      logTag: 'refundInsurance',
    })
  }

  // ─── Actions: Refunds ────────────────────────────────────────────────────

  /**
   * @operationName Create Refund
   * @description Requests a postage refund for one or more shipments by providing the carrier and tracking codes.
   * @route POST /create-refund
   * @category Refunds
   *
   * @paramDef {"type":"String","label":"Carrier","name":"carrier","required":true,"description":"The carrier name for the shipments to refund (e.g. USPS, UPS, FedEx)."}
   * @paramDef {"type":"Array<String>","label":"Tracking Codes","name":"trackingCodes","required":true,"description":"Tracking codes to refund (e.g. 9400111899223456789012). Accepts a list or a comma-separated string."}
   *
   * @returns {Object}
   * @sampleResult [{"id":"rfnd_abc123","object":"Refund","tracking_code":"9400111899223456789012","confirmation_number":"REFUND123","status":"submitted","carrier":"USPS"}]
   */
  async createRefund(carrier, trackingCodes) {
    const codes = this.#toList(trackingCodes)

    if (!codes) {
      throw new Error('At least one tracking code is required.')
    }

    return await this.#apiRequest({
      url: `${ BASE_URL }/refunds`,
      method: 'post',
      body: {
        refund: {
          carrier,
          tracking_codes: codes,
        },
      },
      logTag: 'createRefund',
    })
  }

  // ─── Actions: Webhooks ───────────────────────────────────────────────────

  /**
   * @operationName List Webhooks
   * @description Retrieves all webhook endpoints configured on the EasyPost account, including whether each is active or disabled.
   * @route POST /list-webhooks
   * @category Webhooks
   *
   * @returns {Object}
   * @sampleResult {"webhooks":[{"id":"hook_d393bda62d1511f09d140fc7cf06773a","object":"Webhook","mode":"test","url":"http://example.com","created_at":"2025-05-09T20:40:22Z","disabled_at":null,"custom_headers":[{"name":"X-Header-Name","value":"header_value"}]}]}
   */
  async listWebhooks() {
    return await this.#apiRequest({
      url: `${ BASE_URL }/webhooks`,
      method: 'get',
      logTag: 'listWebhooks',
    })
  }

  /**
   * @operationName Create Webhook
   * @description Registers a URL to receive EasyPost event notifications (tracking updates, batch state changes, etc.). This manages the account's webhook endpoints; it does not create a FlowRunner trigger.
   * @route POST /create-webhook
   * @category Webhooks
   *
   * @paramDef {"type":"String","label":"Webhook URL","name":"url","required":true,"description":"The publicly reachable URL EasyPost should send event notifications to."}
   * @paramDef {"type":"String","label":"Webhook Secret","name":"webhookSecret","description":"Optional secret EasyPost uses to sign deliveries so your endpoint can verify they are authentic. Never logged."}
   * @paramDef {"type":"Array.<Object>","label":"Custom Headers","name":"customHeaders","schemaLoader":"webhookCustomHeaderSchema","description":"Optional HTTP headers (name and value) EasyPost includes with every delivery to this URL."}
   *
   * @returns {Object}
   * @sampleResult {"id":"hook_d31edbc62d1511f0a15761d2f710980c","object":"Webhook","mode":"test","url":"https://example.com/easypost","created_at":"2025-05-09T20:40:21Z","disabled_at":null,"custom_headers":[{"name":"X-Header-Name","value":"header_value"}]}
   */
  async createWebhook(url, webhookSecret, customHeaders) {
    const webhookData = cleanupObject({
      url,
      webhook_secret: webhookSecret,
      custom_headers: customHeaders,
    })

    return await this.#apiRequest({
      url: `${ BASE_URL }/webhooks`,
      method: 'post',
      body: { webhook: webhookData },
      logTag: 'createWebhook',
    })
  }

  /**
   * @operationName Get Webhook
   * @description Retrieves the details of a specific webhook endpoint, including whether it has been disabled.
   * @route POST /get-webhook
   * @category Webhooks
   *
   * @paramDef {"type":"String","label":"Webhook","name":"webhookId","required":true,"dictionary":"getWebhooksDictionary","description":"The webhook endpoint to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"hook_d393bda62d1511f09d140fc7cf06773a","object":"Webhook","mode":"test","url":"http://example.com","created_at":"2025-05-09T20:40:22Z","disabled_at":null,"custom_headers":[]}
   */
  async getWebhook(webhookId) {
    return await this.#apiRequest({
      url: `${ BASE_URL }/webhooks/${ webhookId }`,
      method: 'get',
      logTag: 'getWebhook',
    })
  }

  /**
   * @operationName Update Webhook
   * @description Updates a webhook endpoint's signing secret or custom delivery headers. The URL itself cannot be changed - delete and recreate the webhook to point elsewhere. Updating a disabled webhook re-enables it.
   * @route POST /update-webhook
   * @category Webhooks
   *
   * @paramDef {"type":"String","label":"Webhook","name":"webhookId","required":true,"dictionary":"getWebhooksDictionary","description":"The webhook endpoint to update."}
   * @paramDef {"type":"String","label":"Webhook Secret","name":"webhookSecret","description":"New signing secret for delivery verification. Never logged."}
   * @paramDef {"type":"Array.<Object>","label":"Custom Headers","name":"customHeaders","schemaLoader":"webhookCustomHeaderSchema","description":"Replacement set of HTTP headers (name and value) to include with every delivery."}
   *
   * @returns {Object}
   * @sampleResult {"id":"hook_d393bda62d1511f09d140fc7cf06773a","object":"Webhook","mode":"test","url":"http://example.com","created_at":"2025-05-09T20:40:22Z","disabled_at":null,"custom_headers":[{"name":"X-Header-Name","value":"header_value"}]}
   */
  async updateWebhook(webhookId, webhookSecret, customHeaders) {
    const body = cleanupObject({
      webhook_secret: webhookSecret,
      custom_headers: customHeaders,
    })

    if (!Object.keys(body).length) {
      throw new Error('Provide a webhook secret or custom headers to update.')
    }

    return await this.#apiRequest({
      url: `${ BASE_URL }/webhooks/${ webhookId }`,
      method: 'patch',
      body,
      logTag: 'updateWebhook',
    })
  }

  /**
   * @operationName Delete Webhook
   * @description Permanently removes a webhook endpoint. EasyPost stops sending event notifications to its URL immediately.
   * @route POST /delete-webhook
   * @category Webhooks
   *
   * @paramDef {"type":"String","label":"Webhook","name":"webhookId","required":true,"dictionary":"getWebhooksDictionary","description":"The webhook endpoint to delete."}
   *
   * @returns {Object}
   * @sampleResult {}
   */
  async deleteWebhook(webhookId) {
    return await this.#apiRequest({
      url: `${ BASE_URL }/webhooks/${ webhookId }`,
      method: 'delete',
      logTag: 'deleteWebhook',
    })
  }

  // ─── Polling Trigger ─────────────────────────────────────────────────────

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    return this[invocation.eventName](invocation)
  }

  /**
   * @operationName On Tracking Updated
   * @description Monitors one tracking code and fires only when its carrier status changes (e.g. in_transit to delivered), emitting the updated tracker. It does not fire on every poll, and the first poll establishes a baseline without firing, so past status changes are not replayed. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   * @category Tracking
   *
   * @route POST /on-tracking-updated
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Tracking Code","name":"trackingCode","required":true,"description":"The carrier tracking number to monitor for status changes."}
   * @paramDef {"type":"String","label":"Carrier","name":"carrier","required":true,"description":"The carrier name (e.g. USPS, UPS, FedEx, DHL)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"trk_abc123","object":"Tracker","tracking_code":"9400111899223456789012","status":"delivered","carrier":"USPS","est_delivery_date":"2025-01-20T00:00:00Z","tracking_details":[{"message":"Delivered, In/At Mailbox","status":"delivered","datetime":"2025-01-20T10:15:00Z","source":"USPS","tracking_location":{"city":"Los Angeles","state":"CA","country":"US","zip":"90001"}}]}
   */
  async onTrackingUpdated(invocation) {
    const { trackingCode, carrier } = invocation.triggerData

    logger.debug(`[onTrackingUpdated] trackingCode=${ trackingCode } carrier=${ carrier }`)

    let tracker

    try {
      tracker = await this.#apiRequest({
        url: `${ BASE_URL }/trackers`,
        method: 'post',
        body: {
          tracker: {
            tracking_code: trackingCode,
            carrier,
          },
        },
        logTag: 'onTrackingUpdated',
      })
    } catch (error) {
      logger.error(`[onTrackingUpdated] Error creating/fetching tracker: ${ error.message }`)

      return { events: [], state: invocation.state || {} }
    }

    const currentStatus = tracker.status

    if (invocation.learningMode) {
      logger.debug('[onTrackingUpdated] learningMode, returning sample tracker')

      return {
        events: [tracker],
        state: null,
      }
    }

    if (!invocation.state?.lastStatus) {
      logger.debug(`[onTrackingUpdated] init with status=${ currentStatus }`)

      return {
        events: [],
        state: { lastStatus: currentStatus },
      }
    }

    if (currentStatus !== invocation.state.lastStatus) {
      logger.debug(`[onTrackingUpdated] status changed: ${ invocation.state.lastStatus } -> ${ currentStatus }`)

      return {
        events: [tracker],
        state: { lastStatus: currentStatus },
      }
    }

    logger.debug(`[onTrackingUpdated] no change, status=${ currentStatus }`)

    return {
      events: [],
      state: { lastStatus: currentStatus },
    }
  }
}

Flowrunner.ServerCode.addService(EasyPost, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your EasyPost API key. Found in the API Keys section of your EasyPost dashboard.',
  },
])
