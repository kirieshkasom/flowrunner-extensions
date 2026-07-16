'use strict'

const API_BASE_URL = 'https://public-api.easyship.com/2024-09'

const DEFAULT_PAGE_SIZE = 25

// Friendly dropdown label -> Easyship API value maps. Options expose the labels; these resolve the
// selection back to the value the API expects at the call site.
const INCOTERMS_LABELS = { 'Duties Unpaid (DDU)': 'DDU', 'Delivered Duty Paid (DDP)': 'DDP' }
const SHIPMENT_STATE_LABELS = { Created: 'created', Cancelled: 'cancelled' }
const DOCUMENT_TYPE_LABELS = { 'Commercial Invoice': 'commercial_invoice', 'Packing Slip': 'packing_slip' }
const PAGE_SIZE_LABELS = { '4x6 inch': '4x6', A4: 'A4' }
const BATCH_STATE_LABELS = { Created: 'created', Processing: 'processing', Processed: 'processed', Failed: 'failed' }
const BATCH_TYPE_LABELS = { 'Shipment Batch': 'shipment_batch', 'Address Batch': 'address_batch', 'Label Batch': 'label_batch' }

// Batch type API value -> display label, used to humanize the Get Batches dictionary label (the
// reverse direction of BATCH_TYPE_LABELS, which maps the dropdown's friendly label to the API value).
const BATCH_TYPE_DISPLAY = {
  shipment_batch: 'Shipment Batch',
  address_batch: 'Address Batch',
  label_batch: 'Label Batch',
}

const logger = {
  info: (...args) => console.log('[Easyship Service] info:', ...args),
  debug: (...args) => console.log('[Easyship Service] debug:', ...args),
  error: (...args) => console.log('[Easyship Service] error:', ...args),
  warn: (...args) => console.log('[Easyship Service] warn:', ...args),
}

// Plain-English, remediating messages for the failures a flow builder actually hits, keyed by
// HTTP status. Never let a raw provider body reach a downstream node - it halts the flow opaquely.
const ERROR_HINTS = {
  400: 'Bad request - check that the required fields are present and correctly formatted.',
  401: 'Authentication failed - reconnect the account by entering a valid Easyship API token in the service config.',
  403: 'Permission denied - the API token is missing a required scope, or the account plan does not include this feature. Reconnect with a token that has the needed access.',
  404: 'Not found - the ID may be wrong; use the matching Get/List action (e.g. Get Shipments, List Boxes) to pick a valid one.',
  422: 'Validation failed - a field is missing or invalid. Check the field named in the message below.',
  429: 'Rate limit hit - retry in a moment.',
}

// Turn an Easyship API error into a single friendly Error. Easyship errors carry
// { error: { code, message, details:[...] } }; surface the hint plus the provider message.
function friendlyError(error, logTag) {
  const status = error?.status || error?.body?.status
  const apiError = error?.body?.error
  const apiMsg = (apiError && apiError.message) || error?.body?.message || error?.message
  const details = apiError && Array.isArray(apiError.details)
    ? apiError.details.map(d => (typeof d === 'string' ? d : (d && (d.message || d.field)) || JSON.stringify(d))).filter(Boolean).join('; ')
    : null
  const hint = ERROR_HINTS[status]
  const detail = [apiMsg, details].filter(Boolean).join(' - ')

  return new Error(hint ? `${ hint }${ detail ? ` (${ detail })` : '' }` : detail || `Easyship request failed (${ logTag }).`)
}

function cleanObject(obj) {
  if (!obj || typeof obj !== 'object') {
    return obj
  }

  const result = {}

  for (const key of Object.keys(obj)) {
    const value = obj[key]

    if (value !== undefined && value !== null && value !== '') {
      result[key] = value
    }
  }

  return result
}

// Pure polling-diff helper for the On Tracking Status Changed trigger. GET /shipments/trackings has
// no server-side time filter, so each cycle drains every page and diffs client-side: seed on the
// first run, then emit one event per new checkpoint inside a lookback window, deduped by a bounded
// seen-set and processed ascending. See docs/ai/judgment.md section 16.
const EasyshipPolling = {
  // Only checkpoints newer than (now - LOOKBACK) are candidates, so the bounded seen-set is enough
  // to de-dup them; anything older is already-delivered history. Wide enough to absorb couriers that
  // surface a checkpoint minutes-to-hours after it happened.
  LOOKBACK_MS: 2 * 60 * 60 * 1000,
  // Cap the carried seen-key set so state never grows without bound (keeps the newest keys).
  MAX_SEEN_IDS: 5000,

  // Flatten the trackings list into one candidate event per checkpoint (a tracking status update).
  toEvents(shipments) {
    const events = []

    for (const shipment of (shipments || [])) {
      const firstLeg = shipment.trackings && shipment.trackings[0]
      const trackingNumber = firstLeg && firstLeg.tracking_number

      for (const checkpoint of (shipment.checkpoints || [])) {
        if (!checkpoint || !checkpoint.checkpoint_time) continue

        const distinguisher = checkpoint.order_number != null ? checkpoint.order_number : (checkpoint.primary_status || '')

        events.push({
          id: `${ shipment.easyship_shipment_id }|${ checkpoint.checkpoint_time }|${ distinguisher }`,
          checkpoint_time: checkpoint.checkpoint_time,
          easyship_shipment_id: shipment.easyship_shipment_id,
          platform_order_number: shipment.platform_order_number || null,
          tracking_number: trackingNumber || null,
          status: shipment.status || null,
          tracking_page_url: shipment.tracking_page_url || null,
          primary_status: checkpoint.primary_status || null,
          message: checkpoint.message || null,
          location: checkpoint.location || null,
          checkpoint,
        })
      }
    }

    return events
  },

  // Compute { events, state } for one polling cycle from the fetched trackings and prior state.
  diff(shipments, nowIso, state) {
    const events = this.toEvents(shipments)

    // First run: seed the watermark + seen set and emit nothing (no backlog dump).
    if (!state || !state.since) {
      return {
        events: [],
        state: { since: nowIso, seenIds: this.boundSeen(events.map(e => e.id)) },
      }
    }

    // Window with a lookback so late-surfacing checkpoints still land; de-dup against the bounded
    // seen-set; process ascending so the oldest new checkpoint is delivered first.
    const cutoff = new Date(Date.parse(nowIso) - this.LOOKBACK_MS).toISOString()
    const seen = new Set(state.seenIds || [])
    const windowed = events.filter(e => e.checkpoint_time >= cutoff)

    const fresh = windowed
      .filter(e => !seen.has(e.id))
      .sort((a, b) => (a.checkpoint_time < b.checkpoint_time ? -1 : a.checkpoint_time > b.checkpoint_time ? 1 : 0))

    const seenIds = this.boundSeen([...(state.seenIds || []), ...windowed.map(e => e.id)])

    return { events: fresh, state: { since: nowIso, seenIds } }
  },

  // Keep the set bounded and de-duplicated, retaining the most-recently-added keys.
  boundSeen(ids) {
    const unique = [...new Set(ids)]

    return unique.length > this.MAX_SEEN_IDS ? unique.slice(unique.length - this.MAX_SEEN_IDS) : unique
  },
}

/**
 * @integrationName Easyship
 * @integrationIcon /icon.png
 **/
class EasyshipService {
  constructor(config) {
    this.apiToken = config.apiToken

    logger.debug(`constructor - apiToken present: ${ Boolean(this.apiToken) }, prefix: ${ String(this.apiToken || '').slice(0, 5) }`)
  }

  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'

    if (query) {
      query = cleanObject(query)
    }

    const send = async () => {
      const request = Flowrunner.Request[method](url)
        .set({
          'Authorization': `Bearer ${ this.apiToken }`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        })
        .query(query)

      if (body !== undefined && body !== null) {
        return await request.send(body)
      }

      return await request
    }

    const MAX_RETRIES = 6
    const BASE_DELAY_MS = 2000
    const MAX_DELAY_MS = 30_000

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      let lastError

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          return await send()
        } catch (error) {
          lastError = error
          const code = error?.body?.error?.code
          const rateLimited = code === 'too_many_requests' || error?.status === 429

          if (!rateLimited || attempt === MAX_RETRIES) {
            throw error
          }

          const retryAfterHeader = Number(error?.headers?.['retry-after'])
          const delayMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
            ? Math.min(retryAfterHeader * 1000, MAX_DELAY_MS)
            : Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS)

          logger.warn(`${ logTag } - rate limited (attempt ${ attempt + 1 }/${ MAX_RETRIES + 1 }), retrying after ${ delayMs }ms`)
          await new Promise(resolve => setTimeout(resolve, delayMs))
        }
      }

      throw lastError
    } catch (error) {
      logger.error(`${ logTag } - error: ${ JSON.stringify({ message: error.message, body: error.body }) }`)

      throw friendlyError(error, logTag)
    }
  }

  // Map a friendly dropdown label back to the API value; pass through anything not in the map.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // ============================================ DICTIONARIES ============================================

  /**
   * @typedef {Object} DictionaryItem
   * @property {String} label
   * @property {any} value
   * @property {String} note
   */

  /**
   * @typedef {Object} DictionaryResponse
   * @property {Array<DictionaryItem>} items
   * @property {String} cursor
   */

  /**
   * @typedef {Object} getAddressesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter saved addresses by company name, contact name, or city."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of address results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Addresses
   * @description Returns saved addresses from the Easyship account for selecting origin, destination, sender, or return locations in shipment-related actions.
   * @route POST /get-addresses-dictionary
   * @paramDef {"type":"getAddressesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering saved addresses."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Test Company - Kyiv","value":"e814ca75-0bc8-4d52-bdc5-0035675941a6","note":"123 Test Road, Kyiv, UA"}],"cursor":null}
   */
  async getAddressesDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getAddressesDictionary',
      url: `${ API_BASE_URL }/addresses`,
      query: {
        page: cursor || 1,
        per_page: DEFAULT_PAGE_SIZE,
      },
    })

    const addresses = response.addresses || []
    const filtered = search
      ? addresses.filter(addr => {
        const term = String(search).toLowerCase()

        return [addr.company_name, addr.contact_name, addr.city].some(v => v && String(v).toLowerCase().includes(term))
      })
      : addresses

    return {
      cursor: response.meta?.pagination?.next || null,
      items: filtered.map(addr => ({
        label: `${ addr.company_name || addr.contact_name || '[unnamed]' } - ${ addr.city || addr.country_alpha2 || '' }`.trim(),
        note: [addr.line_1, addr.city, addr.country_alpha2].filter(Boolean).join(', '),
        value: addr.id,
      })),
    }
  }

  /**
   * @typedef {Object} getCouriersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter couriers by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of courier results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Couriers
   * @description Returns couriers connected to the Easyship account for selecting a courier when creating manifests, scheduling pickups, or filtering rate requests.
   * @route POST /get-couriers-dictionary
   * @paramDef {"type":"getCouriersDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering connected couriers."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"DHL","value":"27244aee-4ef1-4e0a-8c0b-28f75d8745cf","note":"Origin: UA"}],"cursor":null}
   */
  async getCouriersDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getCouriersDictionary',
      url: `${ API_BASE_URL }/couriers`,
      query: {
        page: cursor || 1,
        per_page: DEFAULT_PAGE_SIZE,
      },
    })

    const couriers = response.couriers || []
    const filtered = search
      ? couriers.filter(c => String(c.umbrella_name || '').toLowerCase().includes(String(search).toLowerCase()))
      : couriers

    return {
      cursor: response.meta?.pagination?.next || null,
      items: filtered.map(courier => ({
        label: courier.umbrella_name || '[unnamed]',
        note: `Origin: ${ courier.origin_country_alpha2 || 'N/A' }`,
        value: courier.id,
      })),
    }
  }

  /**
   * @typedef {Object} getBoxesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter saved boxes by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of box results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Boxes
   * @description Returns custom packaging boxes saved in the Easyship account for selecting predefined box dimensions when creating shipments or requesting rates.
   * @route POST /get-boxes-dictionary
   * @paramDef {"type":"getBoxesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering saved boxes."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Small Box (10x10x5 cm)","value":"box-123","note":"Weight: 0.2kg"}],"cursor":null}
   */
  async getBoxesDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getBoxesDictionary',
      url: `${ API_BASE_URL }/boxes`,
      query: {
        page: cursor || 1,
        per_page: DEFAULT_PAGE_SIZE,
      },
    })

    const boxes = response.boxes || []
    const filtered = search
      ? boxes.filter(b => String(b.name || '').toLowerCase().includes(String(search).toLowerCase()))
      : boxes

    return {
      cursor: response.meta?.pagination?.next || null,
      items: filtered.map(box => ({
        label: `${ box.name || '[unnamed]' } (${ box.outer_length }x${ box.outer_width }x${ box.outer_height } cm)`,
        note: `Weight: ${ box.weight }kg`,
        value: box.id,
      })),
    }
  }

  /**
   * @typedef {Object} getProductsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter products by name or SKU."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of product results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Products
   * @description Returns products saved in the Easyship product catalog for selecting items when creating shipments or rate requests.
   * @route POST /get-products-dictionary
   * @paramDef {"type":"getProductsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering saved products."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Wireless Headphones","value":"prod-123","note":"SKU: WH-001"}],"cursor":null}
   */
  async getProductsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getProductsDictionary',
      url: `${ API_BASE_URL }/products`,
      query: {
        page: cursor || 1,
        per_page: DEFAULT_PAGE_SIZE,
      },
    })

    const products = response.products || []
    const filtered = search
      ? products.filter(p => {
        const term = String(search).toLowerCase()

        return [p.name, p.identifier].some(v => v && String(v).toLowerCase().includes(term))
      })
      : products

    return {
      cursor: response.meta?.pagination?.next || null,
      items: filtered.map(product => ({
        label: product.name || '[unnamed]',
        note: `SKU: ${ product.identifier || 'N/A' }`,
        value: product.id,
      })),
    }
  }

  /**
   * @typedef {Object} getShipmentsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter shipments by Easyship shipment ID or platform order number."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of shipment results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Shipments
   * @description Returns existing shipments from the Easyship account for selecting a shipment when retrieving details, scheduling pickups, generating labels, or canceling.
   * @route POST /get-shipments-dictionary
   * @paramDef {"type":"getShipmentsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering existing shipments."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"ESUS10001234","value":"ESUS10001234","note":"To: US, State: created"}],"cursor":null}
   */
  async getShipmentsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getShipmentsDictionary',
      url: `${ API_BASE_URL }/shipments`,
      query: {
        page: cursor || 1,
        per_page: DEFAULT_PAGE_SIZE,
      },
    })

    const shipments = response.shipments || []
    const orderNumberOf = s => s.order_data?.platform_order_number || s.platform_order_number
    const filtered = search
      ? shipments.filter(s => {
        const term = String(search).toLowerCase()

        return [s.easyship_shipment_id, orderNumberOf(s)].some(v => v && String(v).toLowerCase().includes(term))
      })
      : shipments

    return {
      cursor: response.meta?.pagination?.next || null,
      items: filtered.map(shipment => ({
        label: shipment.easyship_shipment_id || orderNumberOf(shipment) || '[unnamed]',
        note: `To: ${ shipment.destination_address?.country_alpha2 || 'N/A' }, State: ${ shipment.shipment_state || 'N/A' }`,
        value: shipment.easyship_shipment_id,
      })),
    }
  }

  /**
   * @typedef {Object} getPickupsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter pickups by pickup ID or included shipment ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of pickup results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Pickups
   * @description Returns scheduled courier pickups from the Easyship account for selecting a pickup to cancel.
   * @route POST /get-pickups-dictionary
   * @paramDef {"type":"getPickupsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering scheduled pickups."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Pickup on 2026-05-01","value":"f6f6f6f6-0000-4000-8000-000000000006","note":"State: confirmed"}],"cursor":null}
   */
  async getPickupsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getPickupsDictionary',
      url: `${ API_BASE_URL }/pickups`,
      query: {
        page: cursor || 1,
        per_page: DEFAULT_PAGE_SIZE,
      },
    })

    const pickups = response.pickups || []
    const filtered = search
      ? pickups.filter(p => {
        const term = String(search).toLowerCase()

        return [p.id, ...(p.easyship_shipment_ids || [])].some(v => v && String(v).toLowerCase().includes(term))
      })
      : pickups

    return {
      cursor: response.meta?.pagination?.next || null,
      items: filtered.map(pickup => ({
        label: `Pickup on ${ pickup.selected_date || 'unknown date' }`,
        note: `State: ${ pickup.state || 'N/A' }`,
        value: pickup.id,
      })),
    }
  }

  /**
   * @typedef {Object} getPickupTimeSlotsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Courier Service","name":"courierServiceId","required":true,"description":"UUID of the courier service whose available pickup slots are retrieved."}
   */

  /**
   * @typedef {Object} getPickupTimeSlotsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter available slots by date or time (e.g. \"2026-07-14\" or \"12:00\"). Filtering is performed locally on the retrieved 7-day window."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Unused - the API returns the full 7-day slot window in one response. Always returns a null cursor."}
   * @paramDef {"type":"getPickupTimeSlotsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters identifying the courier service whose pickup slots are listed."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Pickup Time Slots
   * @description Returns a courier service's available pickup time slots for the coming seven days, for picking the Schedule Pickup time slot. Loads once the courier service is set - returns no options before that.
   * @route POST /get-pickup-time-slots-dictionary
   * @paramDef {"type":"getPickupTimeSlotsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string, unused cursor, and required criteria identifying the courier service."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"2022-02-23 12:00 - 16:00","value":"01563646-58c1-4607-8fe0-cae3e33c0001","note":"Provider: USPS"}],"cursor":null}
   */
  async getPickupTimeSlotsDictionary(payload) {
    const { search, criteria } = payload || {}
    const courierServiceId = criteria?.courierServiceId

    // Dependent dictionaries can be invoked before the parent param (courierServiceId) is set -
    // return an empty list rather than calling the API with an undefined path segment.
    if (!courierServiceId) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      logTag: 'getPickupTimeSlotsDictionary',
      url: `${ API_BASE_URL }/courier_services/${ courierServiceId }/pickup_slots`,
    })

    const handover = response.courier_service_handover_option || {}
    const providerName = handover.provider_name || 'N/A'
    const items = []

    for (const day of (handover.pickup_slots || [])) {
      for (const slot of (day.time_slots || [])) {
        items.push({
          label: `${ day.date } ${ slot.from_time } - ${ slot.to_time }`,
          note: `Provider: ${ providerName }`,
          value: slot.time_slot_id,
        })
      }
    }

    const term = search ? String(search).toLowerCase() : null
    const filtered = term ? items.filter(item => item.label.toLowerCase().includes(term)) : items

    return {
      cursor: null,
      items: filtered,
    }
  }

  /**
   * @typedef {Object} getBatchesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter batches by ID, type, or state. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of batch results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Batches
   * @description Returns batch jobs (label, shipment, and address batches) from the Easyship account for selecting a batch to check the status of.
   * @route POST /get-batches-dictionary
   * @paramDef {"type":"getBatchesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering batches."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Shipment Batch - 2022-02-22T12:21:00Z","value":"01563646-58c1-4607-8fe0-cae3e33c0001","note":"State: created"}],"cursor":null}
   */
  async getBatchesDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getBatchesDictionary',
      url: `${ API_BASE_URL }/batches`,
      query: {
        page: cursor || 1,
        per_page: DEFAULT_PAGE_SIZE,
      },
    })

    const batches = response.batches || []
    const filtered = search
      ? batches.filter(b => {
        const term = String(search).toLowerCase()

        return [b.id, b.type, b.state].some(v => v && String(v).toLowerCase().includes(term))
      })
      : batches

    return {
      cursor: response.meta?.pagination?.next || null,
      items: filtered.map(batch => ({
        label: `${ BATCH_TYPE_DISPLAY[batch.type] || batch.type } - ${ batch.created_at }`,
        note: `State: ${ batch.state || 'N/A' }`,
        value: batch.id,
      })),
    }
  }

  // ========================================== END DICTIONARIES ==========================================

  // ============================================== ACCOUNT ===============================================

  /**
   * @operationName Get Account
   * @category Account
   * @description Retrieves details about the authenticated Easyship account, including company info, billing address, available credit balance, and connected payment sources. Useful for verifying API token validity or auditing account configuration.
   * @route POST /getAccount
   * @returns {Object}
   * @sampleResult {"account":{"name":"Company Inc.","easyship_company_id":"CUA997231","credit":{"available_balance":0,"balance":0,"currency":"USD"},"billing_address":{"city":"Kyiv","country_alpha2":"UA"}}}
   */
  async getAccount() {
    return this.#apiRequest({
      logTag: 'getAccount',
      url: `${ API_BASE_URL }/account`,
    })
  }

  // ============================================== ADDRESSES =============================================

  /**
   * @operationName List Addresses
   * @category Addresses
   * @description Lists saved addresses in the Easyship account with pagination support. Use this to retrieve sender, return, billing, and pickup addresses configured in the account.
   * @route POST /listAddresses
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number for pagination. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of addresses per page (1-100). Defaults to 20."}
   * @returns {Object}
   * @sampleResult {"addresses":[{"id":"e814ca75-0bc8-4d52-bdc5-0035675941a6","company_name":"Test Company","city":"Kyiv","country_alpha2":"UA"}],"meta":{"pagination":{"page":1,"next":null,"count":3}}}
   */
  async listAddresses(page, perPage) {
    return this.#apiRequest({
      logTag: 'listAddresses',
      url: `${ API_BASE_URL }/addresses`,
      query: { page: page || 1, per_page: perPage || 20 },
    })
  }

  /**
   * @typedef {Object} AddressDefaultFor
   * @property {Boolean} [pickup]
   * @property {Boolean} [billing]
   * @property {Boolean} [sender]
   * @property {Boolean} [return]
   */

  /**
   * @operationName Create Address
   * @category Addresses
   * @description Creates a new saved address in the Easyship account that can be reused as origin, destination, sender, or return address. The address can be marked as default for various purposes.
   * @route POST /createAddress
   * @paramDef {"type":"String","label":"Line 1","name":"line1","required":true,"description":"First line of the street address (max 35 characters)."}
   * @paramDef {"type":"String","label":"City","name":"city","required":true,"description":"City or suburb name (max 200 characters)."}
   * @paramDef {"type":"String","label":"Country (ISO Alpha-2)","name":"countryAlpha2","required":true,"description":"ISO 3166-1 Alpha-2 country code, e.g. US, GB, UA."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","required":true,"description":"Company or organization name (max 27 characters)."}
   * @paramDef {"type":"String","label":"Contact Name","name":"contactName","required":true,"description":"Full name of the contact person (max 22 characters)."}
   * @paramDef {"type":"String","label":"Contact Phone","name":"contactPhone","required":true,"description":"Phone number for the contact person (max 20 characters)."}
   * @paramDef {"type":"String","label":"Contact Email","name":"contactEmail","required":true,"description":"Email address for the contact person (max 50 characters)."}
   * @paramDef {"type":"String","label":"Line 2","name":"line2","description":"Optional secondary address line such as apartment or suite (max 35 characters)."}
   * @paramDef {"type":"String","label":"State","name":"state","description":"State or province name (mandatory for certain countries like US, CA, AU)."}
   * @paramDef {"type":"String","label":"Postal Code","name":"postalCode","description":"Postal or ZIP code, required for most developed countries."}
   * @paramDef {"type":"AddressDefaultFor","label":"Default For","name":"defaultFor","description":"Object with optional boolean flags (pickup, billing, sender, return) marking this address as the default for that purpose."}
   * @returns {Object}
   * @sampleResult {"address":{"id":"new-address-uuid","company_name":"Acme Inc","line_1":"123 Main St","city":"New York","country_alpha2":"US","status":"active"}}
   */
  async createAddress(line1, city, countryAlpha2, companyName, contactName, contactPhone, contactEmail, line2, state, postalCode, defaultFor) {
    return this.#apiRequest({
      logTag: 'createAddress',
      method: 'post',
      url: `${ API_BASE_URL }/addresses`,
      body: cleanObject({
        line_1: line1,
        line_2: line2,
        city,
        state,
        postal_code: postalCode,
        country_alpha2: countryAlpha2,
        company_name: companyName,
        contact_name: contactName,
        contact_phone: contactPhone,
        contact_email: contactEmail,
        default_for: defaultFor,
      }),
    })
  }

  /**
   * @operationName Update Address
   * @category Addresses
   * @description Updates an existing saved address. The Easyship 2024-09 API requires the full set of address fields on each PATCH (city, country_alpha2, line_1, company_name, contact_name, contact_phone, contact_email), so all of them must be supplied even if unchanged.
   * @route POST /updateAddress
   * @paramDef {"type":"String","label":"Address (Saved)","name":"addressId","required":true,"dictionary":"getAddressesDictionary","description":"UUID of the saved address to update."}
   * @paramDef {"type":"String","label":"Line 1","name":"line1","required":true,"description":"First line of the street address (max 35 characters)."}
   * @paramDef {"type":"String","label":"City","name":"city","required":true,"description":"City or suburb name."}
   * @paramDef {"type":"String","label":"Country (ISO Alpha-2)","name":"countryAlpha2","required":true,"description":"ISO 3166-1 Alpha-2 country code, e.g. US, GB, UA."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","required":true,"description":"Company or organization name (max 27 characters)."}
   * @paramDef {"type":"String","label":"Contact Name","name":"contactName","required":true,"description":"Full name of the contact person (max 22 characters)."}
   * @paramDef {"type":"String","label":"Contact Phone","name":"contactPhone","required":true,"description":"Phone number for the contact person (max 20 characters)."}
   * @paramDef {"type":"String","label":"Contact Email","name":"contactEmail","required":true,"description":"Email address for the contact person (max 50 characters)."}
   * @paramDef {"type":"String","label":"Line 2","name":"line2","description":"Optional secondary address line (max 35 characters)."}
   * @paramDef {"type":"String","label":"State","name":"state","description":"Updated state or province name."}
   * @paramDef {"type":"String","label":"Postal Code","name":"postalCode","description":"Updated postal or ZIP code."}
   * @paramDef {"type":"AddressDefaultFor","label":"Default For","name":"defaultFor","description":"Updated default-for flags (pickup, billing, sender, return)."}
   * @returns {Object}
   * @sampleResult {"address":{"id":"e814ca75-0bc8-4d52-bdc5-0035675941a6","company_name":"Updated Co","status":"active"}}
   */
  async updateAddress(addressId, line1, city, countryAlpha2, companyName, contactName, contactPhone, contactEmail, line2, state, postalCode, defaultFor) {
    return this.#apiRequest({
      logTag: 'updateAddress',
      method: 'patch',
      url: `${ API_BASE_URL }/addresses/${ addressId }`,
      body: cleanObject({
        line_1: line1,
        line_2: line2,
        city,
        state,
        postal_code: postalCode,
        country_alpha2: countryAlpha2,
        company_name: companyName,
        contact_name: contactName,
        contact_phone: contactPhone,
        contact_email: contactEmail,
        default_for: defaultFor,
      }),
    })
  }

  /**
   * @operationName Deactivate Address
   * @category Addresses
   * @description Deactivates a saved address so it no longer appears in address pickers and cannot be used as origin, destination, sender, or return. Easyship has no hard-delete for addresses, so deactivation is the supported way to retire one.
   * @route POST /deactivateAddress
   * @paramDef {"type":"String","label":"Address (Saved)","name":"addressId","required":true,"dictionary":"getAddressesDictionary","description":"UUID of the saved address to deactivate."}
   * @returns {Object}
   * @sampleResult {"success":{"message":"Address successfully deactivated"},"meta":{"request_id":"c3c3c3c3-0000-4000-8000-000000000003"}}
   */
  async deactivateAddress(addressId) {
    return this.#apiRequest({
      logTag: 'deactivateAddress',
      method: 'post',
      url: `${ API_BASE_URL }/addresses/${ addressId }/deactivate`,
    })
  }

  // =============================================== BOXES ================================================

  /**
   * @operationName List Boxes
   * @category Boxes
   * @description Lists custom packaging boxes saved in the Easyship account with pagination. Use this to retrieve preset box dimensions for use in rate calculations and shipment creation.
   * @route POST /listBoxes
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number for pagination. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of boxes per page (1-100). Defaults to 20."}
   * @returns {Object}
   * @sampleResult {"boxes":[{"id":"box-123","name":"Small Box","outer_length":10,"outer_width":10,"outer_height":5,"weight":0.2}],"meta":{"pagination":{"page":1,"next":null,"count":1}}}
   */
  async listBoxes(page, perPage) {
    return this.#apiRequest({
      logTag: 'listBoxes',
      url: `${ API_BASE_URL }/boxes`,
      query: { page: page || 1, per_page: perPage || 20 },
    })
  }

  /**
   * @operationName Create Box
   * @category Boxes
   * @description Creates a new custom packaging box in the Easyship account with the specified outer dimensions and weight. Boxes can be reused across rate requests and shipment creation to standardize packaging.
   * @route POST /createBox
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Display name of the box (e.g. 'Small Box', 'Mailer Envelope')."}
   * @paramDef {"type":"Number","label":"Outer Length","name":"outerLength","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Box outer length in centimeters (or inches if imperial units enabled)."}
   * @paramDef {"type":"Number","label":"Outer Width","name":"outerWidth","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Box outer width in centimeters (or inches if imperial units enabled)."}
   * @paramDef {"type":"Number","label":"Outer Height","name":"outerHeight","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Box outer height in centimeters (or inches if imperial units enabled)."}
   * @paramDef {"type":"Number","label":"Weight","name":"weight","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Empty box weight in kilograms (or pounds if imperial units enabled)."}
   * @returns {Object}
   * @sampleResult {"box":{"id":"box-new-uuid","name":"Small Box","outer_length":10,"outer_width":10,"outer_height":5,"weight":0.2}}
   */
  async createBox(name, outerLength, outerWidth, outerHeight, weight) {
    return this.#apiRequest({
      logTag: 'createBox',
      method: 'post',
      url: `${ API_BASE_URL }/boxes`,
      body: {
        name,
        outer_length: outerLength,
        outer_width: outerWidth,
        outer_height: outerHeight,
        weight,
      },
    })
  }

  /**
   * @operationName Update Box
   * @category Boxes
   * @description Updates a saved box's availability. The Easyship 2024-09 API only allows toggling whether a box is active (selectable in rate and shipment workflows) and whether it may be auto-selected during rate calculation - a box's name, dimensions, and weight are fixed once created.
   * @route POST /updateBox
   * @paramDef {"type":"String","label":"Box","name":"boxId","required":true,"dictionary":"getBoxesDictionary","description":"UUID of the saved box to update."}
   * @paramDef {"type":"Boolean","label":"Active","name":"isActive","uiComponent":{"type":"TOGGLE"},"description":"Whether the box is active and available for selection in rate and shipment workflows."}
   * @paramDef {"type":"Boolean","label":"Auto Selected","name":"autoSelected","uiComponent":{"type":"TOGGLE"},"description":"Whether Easyship may automatically choose this box when calculating rates."}
   * @returns {Object}
   * @sampleResult {"box":{"id":"e5e5e5e5-0000-4000-8000-000000000005","name":"Small Box","slug":"small-box","type":"custom","weight":0.2,"outer_dimensions":{"length":10,"width":10,"height":5},"courier":null},"meta":{"request_id":"c3c3c3c3-0000-4000-8000-000000000003"}}
   */
  async updateBox(boxId, isActive, autoSelected) {
    return this.#apiRequest({
      logTag: 'updateBox',
      method: 'patch',
      url: `${ API_BASE_URL }/boxes/${ boxId }`,
      body: cleanObject({
        is_active: isActive,
        auto_selected: autoSelected,
      }),
    })
  }

  /**
   * @operationName Delete Box
   * @category Boxes
   * @description Permanently deletes a custom box from the Easyship account. The box will no longer be available for selection in rate or shipment workflows.
   * @route POST /deleteBox
   * @paramDef {"type":"String","label":"Box","name":"boxId","required":true,"dictionary":"getBoxesDictionary","description":"UUID of the custom box to delete."}
   * @returns {Object}
   * @sampleResult {"status":"deleted"}
   */
  async deleteBox(boxId) {
    return this.#apiRequest({
      logTag: 'deleteBox',
      method: 'delete',
      url: `${ API_BASE_URL }/boxes/${ boxId }`,
    })
  }

  // ============================================== COURIERS ==============================================

  /**
   * @operationName List Couriers
   * @category Couriers
   * @description Lists couriers connected to the Easyship account, including their authentication state, origin country, and umbrella courier name. Use this to discover which courier IDs are available for manifest, pickup, and shipment workflows.
   * @route POST /listCouriers
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number for pagination. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of couriers per page (1-100). Defaults to 20."}
   * @returns {Object}
   * @sampleResult {"couriers":[{"id":"27244aee-4ef1-4e0a-8c0b-28f75d8745cf","umbrella_name":"DHL","origin_country_alpha2":"UA","easyship_courier":true,"auth":{"state":"verified"}}],"meta":{"pagination":{"page":1,"next":null,"count":2}}}
   */
  async listCouriers(page, perPage) {
    return this.#apiRequest({
      logTag: 'listCouriers',
      url: `${ API_BASE_URL }/couriers`,
      query: { page: page || 1, per_page: perPage || 20 },
    })
  }

  // =============================================== RATES ================================================

  /**
   * @typedef {Object} RateAddress
   * @property {String} country_alpha2
   * @property {String} [city]
   * @property {String} [state]
   * @property {String} [postal_code]
   * @property {String} [line_1]
   * @property {String} [line_2]
   * @property {String} [contact_name]
   * @property {String} [contact_phone]
   * @property {String} [contact_email]
   * @property {String} [company_name]
   */

  /**
   * @typedef {Object} ParcelItem
   * @property {String} description
   * @property {Number} quantity
   * @property {Number} declared_customs_value
   * @property {String} declared_currency
   * @property {String} [hs_code]
   * @property {String} [category]
   * @property {String} [origin_country_alpha2]
   * @property {Number} [actual_weight]
   * @property {String} [sku]
   */

  /**
   * @typedef {Object} ParcelBox
   * @property {Number} length
   * @property {Number} width
   * @property {Number} height
   * @property {String} [slug]
   */

  /**
   * @typedef {Object} Parcel
   * @property {Array<ParcelItem>} items
   * @property {Number} [total_actual_weight]
   * @property {ParcelBox} [box]
   */

  /**
   * @operationName Request Rates
   * @category Rates
   * @description Requests a list of shipping rates from couriers for a prospective shipment based on origin, destination, and parcel contents. Each rate carries a nested courier_service object (id, name, courier_id) - feed that courier_service.id into Create Shipment, Generate Labels, or Schedule Pickup. Returns delivery time, total charges, and incoterm-aware tax/duty estimates.
   * @route POST /requestRates
   * @paramDef {"type":"RateAddress","label":"Origin Address","name":"originAddress","required":true,"description":"Origin address for the shipment with at minimum country_alpha2 set."}
   * @paramDef {"type":"RateAddress","label":"Destination Address","name":"destinationAddress","required":true,"description":"Destination address for the shipment with at minimum country_alpha2 set."}
   * @paramDef {"type":"Array<Parcel>","label":"Parcels","name":"parcels","required":true,"description":"Array of parcels (at least one) describing the goods being shipped, including items, weight, and box dimensions."}
   * @paramDef {"type":"String","label":"Incoterms","name":"incoterms","uiComponent":{"type":"DROPDOWN","options":{"values":["Duties Unpaid (DDU)","Delivered Duty Paid (DDP)"]}},"description":"Incoterms for the shipment. DDU (default) means duties unpaid, DDP means delivered duty paid."}
   * @paramDef {"type":"Boolean","label":"Calculate Tax And Duties","name":"calculateTaxAndDuties","uiComponent":{"type":"TOGGLE"},"description":"Whether to calculate tax and duties for international shipments. Defaults to true."}
   * @paramDef {"type":"Boolean","label":"Set As Residential","name":"setAsResidential","uiComponent":{"type":"TOGGLE"},"description":"Mark destination as residential, bypassing US address validation."}
   * @paramDef {"type":"Boolean","label":"Return Shipment","name":"returnShipment","uiComponent":{"type":"TOGGLE"},"description":"Mark this rate request as for a return shipment."}
   * @returns {Object}
   * @sampleResult {"rates":[{"courier_service":{"id":"a1a1a1a1-0000-4000-8000-000000000001","name":"DHL Express Worldwide","courier_id":"b2b2b2b2-0000-4000-8000-000000000002","umbrella_name":"DHL","easyship_courier_service":true},"min_delivery_time":2,"max_delivery_time":4,"cost_rank":2,"delivery_time_rank":1,"value_for_money_rank":1,"currency":"USD","shipment_charge":40.5,"shipment_charge_total":42.55,"total_charge":42.55,"incoterms":"DDU"}],"meta":{"pagination":{"page":1,"next":null,"count":1},"request_id":"c3c3c3c3-0000-4000-8000-000000000003"}}
   */
  async requestRates(originAddress, destinationAddress, parcels, incoterms, calculateTaxAndDuties, setAsResidential, returnShipment) {
    return this.#apiRequest({
      logTag: 'requestRates',
      method: 'post',
      url: `${ API_BASE_URL }/rates`,
      body: cleanObject({
        origin_address: originAddress,
        destination_address: destinationAddress,
        parcels,
        incoterms: this.#resolveChoice(incoterms, INCOTERMS_LABELS),
        calculate_tax_and_duties: calculateTaxAndDuties,
        set_as_residential: setAsResidential,
        return: returnShipment,
      }),
    })
  }

  // ============================================= SHIPMENTS ==============================================

  /**
   * @operationName List Shipments
   * @category Shipments
   * @description Lists shipments from the Easyship account with rich filtering by date ranges, states, countries, and order numbers. Supports pagination for large result sets. Each shipment carries a nested courier_service object and a trackings array (there is no top-level tracking_number).
   * @route POST /listShipments
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number for pagination. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of shipments per page (1-100). Defaults to 20."}
   * @paramDef {"type":"String","label":"Created From","name":"createdAtFrom","description":"ISO8601 timestamp - lower bound for shipment creation date."}
   * @paramDef {"type":"String","label":"Created To","name":"createdAtTo","description":"ISO8601 timestamp - upper bound for shipment creation date."}
   * @paramDef {"type":"String","label":"Shipment State","name":"shipmentState","uiComponent":{"type":"DROPDOWN","options":{"values":["Created","Cancelled"]}},"description":"Filter by shipment state."}
   * @paramDef {"type":"String","label":"Origin Country (ISO Alpha-2)","name":"originCountryAlpha2","description":"Filter by origin country ISO 3166-1 Alpha-2 code (e.g. US)."}
   * @paramDef {"type":"String","label":"Destination Country (ISO Alpha-2)","name":"destinationCountryAlpha2","description":"Filter by destination country ISO 3166-1 Alpha-2 code (e.g. GB)."}
   * @paramDef {"type":"String","label":"Platform Order Number","name":"platformOrderNumber","description":"Filter by sales-platform order number associated with shipments."}
   * @returns {Object}
   * @sampleResult {"shipments":[{"easyship_shipment_id":"ESUS10001234","shipment_state":"created","courier_service":{"id":"a1a1a1a1-0000-4000-8000-000000000001","name":"DHL Express Worldwide","courier_id":"b2b2b2b2-0000-4000-8000-000000000002"},"trackings":[{"tracking_number":"JD014600003476120903","handler":"DHL Express","tracking_state":"in_transit"}],"destination_address":{"country_alpha2":"US"},"order_data":{"platform_order_number":"ORD-1001"}}],"meta":{"pagination":{"page":1,"next":null,"count":1}}}
   */
  async listShipments(page, perPage, createdAtFrom, createdAtTo, shipmentState, originCountryAlpha2, destinationCountryAlpha2, platformOrderNumber) {
    return this.#apiRequest({
      logTag: 'listShipments',
      url: `${ API_BASE_URL }/shipments`,
      query: cleanObject({
        page: page || 1,
        per_page: perPage || 20,
        created_at_from: createdAtFrom,
        created_at_to: createdAtTo,
        shipment_state: this.#resolveChoice(shipmentState, SHIPMENT_STATE_LABELS),
        origin_country_alpha2: originCountryAlpha2,
        destination_country_alpha2: destinationCountryAlpha2,
        platform_order_number: platformOrderNumber,
      }),
    })
  }

  /**
   * @operationName Get Shipment
   * @category Shipments
   * @description Retrieves the full details of a specific shipment by its Easyship shipment ID, including addresses, parcels, the selected courier_service, label state, per-leg trackings, and pricing.
   * @route POST /getShipment
   * @paramDef {"type":"String","label":"Shipment","name":"easyshipShipmentId","required":true,"dictionary":"getShipmentsDictionary","description":"The Easyship shipment ID returned when the shipment was created."}
   * @returns {Object}
   * @sampleResult {"shipment":{"easyship_shipment_id":"ESUS10001234","shipment_state":"created","courier_service":{"id":"a1a1a1a1-0000-4000-8000-000000000001","name":"DHL Express Worldwide","courier_id":"b2b2b2b2-0000-4000-8000-000000000002"},"trackings":[{"tracking_number":"JD014600003476120903","handler":"DHL Express","leg_number":1,"tracking_state":"in_transit","local_tracking_number":null,"alternate_tracking_number":null}],"destination_address":{"country_alpha2":"US"}}}
   */
  async getShipment(easyshipShipmentId) {
    return this.#apiRequest({
      logTag: 'getShipment',
      url: `${ API_BASE_URL }/shipments/${ easyshipShipmentId }`,
    })
  }

  /**
   * @typedef {Object} ShipmentInsurance
   * @property {Boolean} is_insured
   * @property {Number} [insured_amount]
   * @property {String} [insured_currency]
   */

  /**
   * @typedef {Object} ShipmentOrderData
   * @property {String} [platform_order_number]
   * @property {String} [platform_name]
   * @property {Number} [order_total]
   * @property {String} [order_total_currency]
   */

  /**
   * @operationName Create Shipment
   * @category Shipments
   * @description Creates a new shipment in Easyship with origin, destination, parcels, and optional courier selection. Returns the new Easyship shipment ID, available rates (each with a nested courier_service), and the selected courier_service. For label generation, follow up with the Generate Labels action.
   * @route POST /createShipment
   * @paramDef {"type":"Array<Parcel>","label":"Parcels","name":"parcels","required":true,"description":"Array of parcels describing the goods being shipped, including items, weight, and box dimensions."}
   * @paramDef {"type":"RateAddress","label":"Destination Address","name":"destinationAddress","description":"Full destination address (use either this or origin_address_id with sender/return addresses)."}
   * @paramDef {"type":"RateAddress","label":"Origin Address","name":"originAddress","description":"Origin address for the shipment. Provide either this or originAddressId."}
   * @paramDef {"type":"String","label":"Origin Address (Saved)","name":"originAddressId","dictionary":"getAddressesDictionary","description":"UUID of a saved origin address. Alternative to providing a full origin address object."}
   * @paramDef {"type":"String","label":"Courier Service","name":"courierServiceId","description":"UUID of a specific courier service to assign. Get it from a Request Rates result (rate.courier_service.id) - there is no global picker because a courier service is only valid for a given origin/destination/parcel. Omit to defer courier selection."}
   * @paramDef {"type":"String","label":"Incoterms","name":"incoterms","uiComponent":{"type":"DROPDOWN","options":{"values":["Duties Unpaid (DDU)","Delivered Duty Paid (DDP)"]}},"description":"Incoterms for the shipment. Defaults to DDU."}
   * @paramDef {"type":"ShipmentInsurance","label":"Insurance","name":"insurance","description":"Insurance configuration for the shipment (is_insured, insured_amount, insured_currency)."}
   * @paramDef {"type":"ShipmentOrderData","label":"Order Data","name":"orderData","description":"Source order metadata (platform_order_number, platform_name, order_total, order_total_currency)."}
   * @paramDef {"type":"Boolean","label":"Return Shipment","name":"returnShipment","uiComponent":{"type":"TOGGLE"},"description":"Mark this as a return shipment."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","description":"User-defined key/value pairs to attach to the shipment (max 5 keys). Free-form because the keys are chosen by you, not fixed by Easyship."}
   * @returns {Object}
   * @sampleResult {"shipment":{"easyship_shipment_id":"ESUS10001234","shipment_state":"created","courier_service":{"id":"a1a1a1a1-0000-4000-8000-000000000001","name":"DHL Express Worldwide","courier_id":"b2b2b2b2-0000-4000-8000-000000000002"},"trackings":[],"rates":[{"courier_service":{"id":"a1a1a1a1-0000-4000-8000-000000000001","name":"DHL Express Worldwide","courier_id":"b2b2b2b2-0000-4000-8000-000000000002"},"total_charge":42.55,"currency":"USD"}],"destination_address":{"country_alpha2":"US","city":"New York"},"order_data":{"platform_order_number":"ORD-1001"},"metadata":{}}}
   */
  async createShipment(parcels, destinationAddress, originAddress, originAddressId, courierServiceId, incoterms, insurance, orderData, returnShipment, metadata) {
    return this.#apiRequest({
      logTag: 'createShipment',
      method: 'post',
      url: `${ API_BASE_URL }/shipments`,
      body: cleanObject({
        parcels,
        destination_address: destinationAddress,
        origin_address: originAddress,
        origin_address_id: originAddressId,
        courier_service_id: courierServiceId,
        incoterms: this.#resolveChoice(incoterms, INCOTERMS_LABELS),
        insurance,
        order_data: orderData,
        return: returnShipment,
        metadata,
      }),
    })
  }

  /**
   * @operationName Update Shipment
   * @category Shipments
   * @description Updates an existing shipment's parcels, addresses, courier selection, or metadata. Only provided fields are modified. Cannot be used after the label has been generated.
   * @route POST /updateShipment
   * @paramDef {"type":"String","label":"Shipment","name":"easyshipShipmentId","required":true,"dictionary":"getShipmentsDictionary","description":"The Easyship shipment ID to update."}
   * @paramDef {"type":"Array<Parcel>","label":"Parcels","name":"parcels","description":"Updated array of parcels for the shipment."}
   * @paramDef {"type":"RateAddress","label":"Destination Address","name":"destinationAddress","description":"Updated destination address."}
   * @paramDef {"type":"String","label":"Courier Service","name":"courierServiceId","description":"Updated courier service UUID. Get it from a Request Rates result (rate.courier_service.id) - there is no global picker because a courier service is only valid for a given origin/destination/parcel."}
   * @paramDef {"type":"String","label":"Incoterms","name":"incoterms","uiComponent":{"type":"DROPDOWN","options":{"values":["Duties Unpaid (DDU)","Delivered Duty Paid (DDP)"]}},"description":"Updated incoterms (DDU or DDP)."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","description":"Updated user-defined key/value pairs (max 5 keys). Free-form because the keys are chosen by you, not fixed by Easyship."}
   * @returns {Object}
   * @sampleResult {"shipment":{"easyship_shipment_id":"ESUS10001234","shipment_state":"created","courier_service":{"id":"a1a1a1a1-0000-4000-8000-000000000001","name":"DHL Express Worldwide","courier_id":"b2b2b2b2-0000-4000-8000-000000000002"}}}
   */
  async updateShipment(easyshipShipmentId, parcels, destinationAddress, courierServiceId, incoterms, metadata) {
    return this.#apiRequest({
      logTag: 'updateShipment',
      method: 'patch',
      url: `${ API_BASE_URL }/shipments/${ easyshipShipmentId }`,
      body: cleanObject({
        parcels,
        destination_address: destinationAddress,
        courier_service_id: courierServiceId,
        incoterms: this.#resolveChoice(incoterms, INCOTERMS_LABELS),
        metadata,
      }),
    })
  }

  /**
   * @operationName Cancel Shipment
   * @category Shipments
   * @description Cancels an existing shipment that has not yet been picked up or has a failed label. Cancelling restores any held credit balance for unused labels.
   * @route POST /cancelShipment
   * @paramDef {"type":"String","label":"Shipment","name":"easyshipShipmentId","required":true,"dictionary":"getShipmentsDictionary","description":"The Easyship shipment ID to cancel."}
   * @returns {Object}
   * @sampleResult {"shipment":{"easyship_shipment_id":"ESUS10001234","shipment_state":"cancelled"}}
   */
  async cancelShipment(easyshipShipmentId) {
    return this.#apiRequest({
      logTag: 'cancelShipment',
      method: 'post',
      url: `${ API_BASE_URL }/shipments/${ easyshipShipmentId }/cancel`,
    })
  }

  /**
   * @operationName List Shipment Documents
   * @category Shipments
   * @description Retrieves shipping documents for a shipment, such as commercial invoices and packing slips. Returns document URLs or base64-encoded PDF data depending on the format requested.
   * @route POST /listShipmentDocuments
   * @paramDef {"type":"String","label":"Shipment","name":"easyshipShipmentId","required":true,"dictionary":"getShipmentsDictionary","description":"The Easyship shipment ID to retrieve documents for."}
   * @paramDef {"type":"String","label":"Document Type","name":"documentType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Commercial Invoice","Packing Slip"]}},"description":"Document type to retrieve. Most commonly 'commercial_invoice'."}
   * @paramDef {"type":"String","label":"Page Size","name":"pageSize","uiComponent":{"type":"DROPDOWN","options":{"values":["4x6 inch","A4"]}},"description":"Page size for the document. Defaults to A4."}
   * @returns {Object}
   * @sampleResult {"documents":[{"type":"commercial_invoice","format":"pdf","url":"https://docs.easyship.com/abc/invoice.pdf"}]}
   */
  async listShipmentDocuments(easyshipShipmentId, documentType, pageSize) {
    return this.#apiRequest({
      logTag: 'listShipmentDocuments',
      url: `${ API_BASE_URL }/shipments/${ easyshipShipmentId }/documents`,
      query: cleanObject({
        document_type: this.#resolveChoice(documentType, DOCUMENT_TYPE_LABELS),
        page_size: this.#resolveChoice(pageSize, PAGE_SIZE_LABELS),
      }),
    })
  }

  // ============================================== LABELS ================================================

  /**
   * @typedef {Object} BatchLabelShipmentItem
   * @property {String} easyship_shipment_id
   * @property {String} [courier_service_id]
   */

  /**
   * @operationName Generate Labels
   * @category Labels
   * @description Submits a batch label generation request for one or more shipments. Easyship processes label creation asynchronously and returns a batch envelope whose state moves created -> processing -> processed. Poll Get Batch Status with the returned batch.id until the state is 'processed', inspect failures with List Batch Items, then use Get Shipment to retrieve label URLs and tracking numbers.
   * @route POST /generateLabels
   * @paramDef {"type":"Array<BatchLabelShipmentItem>","label":"Shipments","name":"shipments","required":true,"description":"Array of objects, each with an easyship_shipment_id and an optional courier_service_id (from a Request Rates result) to override the courier service suggested by default."}
   * @returns {Object}
   * @sampleResult {"batch":{"id":"d4d4d4d4-0000-4000-8000-000000000004","state":"created","type":"label_batch","created_at":"2026-04-26T18:11:23Z","started_at":null,"finished_at":null},"meta":{"request_id":"c3c3c3c3-0000-4000-8000-000000000003"}}
   */
  async generateLabels(shipments) {
    return this.#apiRequest({
      logTag: 'generateLabels',
      method: 'post',
      url: `${ API_BASE_URL }/batches/labels`,
      body: { shipments },
    })
  }

  // ============================================== PICKUPS ===============================================

  /**
   * @operationName List Pickups
   * @category Pickups
   * @description Lists scheduled courier pickups in the Easyship account with pagination. Each pickup ties one or more shipments to a courier, date, and time slot.
   * @route POST /listPickups
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number for pagination. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of pickups per page (1-100). Defaults to 20."}
   * @returns {Object}
   * @sampleResult {"pickups":[{"id":"pickup-uuid","state":"confirmed","selected_date":"2026-05-01","easyship_shipment_ids":["ESUS10001234"]}],"meta":{"pagination":{"page":1,"next":null,"count":1}}}
   */
  async listPickups(page, perPage) {
    return this.#apiRequest({
      logTag: 'listPickups',
      url: `${ API_BASE_URL }/pickups`,
      query: { page: page || 1, per_page: perPage || 20 },
    })
  }

  /**
   * @operationName List Pickup Slots
   * @category Pickups
   * @description Lists a courier service's available pickup time slots in local time for the coming seven days. Feed a slot's time_slot_id (with its date) into Schedule Pickup. Some couriers return no slots - in that case Schedule Pickup accepts a manual from/to time window instead.
   * @route POST /listPickupSlots
   * @paramDef {"type":"String","label":"Courier Service","name":"courierServiceId","required":true,"description":"UUID of the courier service to list pickup slots for. Get it from a Request Rates result (rate.courier_service.id) - there is no global picker because a courier service is only valid for a given origin/destination/parcel. The courier must support pickup scheduling."}
   * @paramDef {"type":"String","label":"Origin Address (Saved)","name":"originAddressId","dictionary":"getAddressesDictionary","description":"Optional UUID of a saved origin address to scope slot availability to a specific pickup location."}
   * @returns {Object}
   * @sampleResult {"courier_service_handover_option":{"provider_name":"USPS","pickup_slots":[{"date":"2022-02-22","time_slots":[]},{"date":"2022-02-23","time_slots":[{"time_slot_id":"01563646-58c1-4607-8fe0-cae3e33c0001","from_time":"12:00","to_time":"16:00"}]}]},"meta":{"request_id":"01563646-58c1-4607-8fe0-cae3e92c4477"}}
   */
  async listPickupSlots(courierServiceId, originAddressId) {
    return this.#apiRequest({
      logTag: 'listPickupSlots',
      url: `${ API_BASE_URL }/courier_services/${ courierServiceId }/pickup_slots`,
      query: cleanObject({
        origin_address_id: originAddressId,
      }),
    })
  }

  /**
   * @operationName Schedule Pickup
   * @category Pickups
   * @description Schedules a courier pickup for one or more shipments on a given date. All shipments must use the same courier and have pending or generated labels. Provide either a time_slot_id or a manual time window. Find available slots with List Pickup Slots.
   * @route POST /schedulePickup
   * @paramDef {"type":"String","label":"Courier Service","name":"courierServiceId","required":true,"description":"UUID of the courier service for the pickup. Get it from a Request Rates result (rate.courier_service.id) - there is no global picker because a courier service is only valid for a given origin/destination/parcel. The courier must support pickup scheduling."}
   * @paramDef {"type":"String","label":"Selected Date","name":"selectedDate","required":true,"description":"Pickup date in YYYY-MM-DD format."}
   * @paramDef {"type":"Array<String>","label":"Easyship Shipment IDs","name":"easyshipShipmentIds","required":true,"description":"Array of Easyship shipment IDs to include in this pickup."}
   * @paramDef {"type":"String","label":"Time Slot","name":"timeSlotId","dictionary":"getPickupTimeSlotsDictionary","dependsOn":["courierServiceId"],"description":"Available courier pickup time slot. Options load after Courier Service is set (or chain from a List Pickup Slots result). Use this OR selectedFromTime/selectedToTime - some couriers offer no slots and need a manual time window."}
   * @paramDef {"type":"String","label":"Selected From Time","name":"selectedFromTime","description":"Start of custom pickup time window in HH:MM format. Required if timeSlotId not provided."}
   * @paramDef {"type":"String","label":"Selected To Time","name":"selectedToTime","description":"End of custom pickup time window in HH:MM format. Required if timeSlotId not provided."}
   * @returns {Object}
   * @sampleResult {"pickup":{"id":"pickup-uuid","state":"confirmed","selected_date":"2026-05-01","selected_from_time":"09:00","selected_to_time":"17:00"}}
   */
  async schedulePickup(courierServiceId, selectedDate, easyshipShipmentIds, timeSlotId, selectedFromTime, selectedToTime) {
    return this.#apiRequest({
      logTag: 'schedulePickup',
      method: 'post',
      url: `${ API_BASE_URL }/pickups`,
      body: cleanObject({
        courier_service_id: courierServiceId,
        selected_date: selectedDate,
        easyship_shipment_ids: easyshipShipmentIds,
        time_slot_id: timeSlotId,
        selected_from_time: selectedFromTime,
        selected_to_time: selectedToTime,
      }),
    })
  }

  /**
   * @operationName Cancel Pickup
   * @category Pickups
   * @description Cancels a previously scheduled courier pickup. Once cancelled, the pickup is no longer billable and shipments can be rescheduled.
   * @route POST /cancelPickup
   * @paramDef {"type":"String","label":"Pickup","name":"pickupId","required":true,"dictionary":"getPickupsDictionary","description":"UUID of the pickup to cancel."}
   * @returns {Object}
   * @sampleResult {"pickup":{"id":"pickup-uuid","state":"cancelled"}}
   */
  async cancelPickup(pickupId) {
    return this.#apiRequest({
      logTag: 'cancelPickup',
      method: 'post',
      url: `${ API_BASE_URL }/pickups/${ pickupId }/cancel`,
    })
  }

  // ============================================= MANIFESTS ==============================================

  /**
   * @operationName List Manifests
   * @category Manifests
   * @description Lists end-of-day manifests created in the Easyship account. A manifest groups a day's shipments by courier for handover scanning.
   * @route POST /listManifests
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number for pagination. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of manifests per page (1-100). Defaults to 20."}
   * @returns {Object}
   * @sampleResult {"manifests":[{"id":"manifest-uuid","courier_id":"courier-uuid","state":"generated","shipments_count":12,"manifest_url":"https://docs.easyship.com/manifest.pdf"}],"meta":{"pagination":{"page":1,"next":null,"count":1}}}
   */
  async listManifests(page, perPage) {
    return this.#apiRequest({
      logTag: 'listManifests',
      url: `${ API_BASE_URL }/manifests`,
      query: { page: page || 1, per_page: perPage || 20 },
    })
  }

  /**
   * @operationName Create Manifest
   * @category Manifests
   * @description Generates a new end-of-day manifest for a courier, optionally restricted to a specific list of shipments. Use this once all of the day's labels are printed and ready for courier handover.
   * @route POST /createManifest
   * @paramDef {"type":"String","label":"Courier","name":"courierId","required":true,"dictionary":"getCouriersDictionary","description":"UUID of the courier the manifest is generated for. Courier must support manifest creation."}
   * @paramDef {"type":"Array<String>","label":"Shipment IDs","name":"shipmentIds","description":"Optional array of Easyship shipment IDs to include. Omit to include all eligible same-day shipments for the courier."}
   * @returns {Object}
   * @sampleResult {"manifest":{"id":"manifest-uuid","courier_id":"courier-uuid","state":"generated","shipments_count":5,"manifest_url":"https://docs.easyship.com/manifest.pdf"}}
   */
  async createManifest(courierId, shipmentIds) {
    return this.#apiRequest({
      logTag: 'createManifest',
      method: 'post',
      url: `${ API_BASE_URL }/manifests`,
      body: cleanObject({
        courier_id: courierId,
        shipment_ids: shipmentIds,
      }),
    })
  }

  // ============================================= TRACKING ===============================================

  /**
   * @operationName List Trackings
   * @category Tracking
   * @description Retrieves the latest tracking status and optional checkpoint history for one or more shipments. Filter by Easyship shipment IDs or platform order numbers. The response array is keyed "shipments"; each entry carries a status, per-leg trackings, and (when requested) a checkpoints history.
   * @route POST /listTrackings
   * @paramDef {"type":"Array<String>","label":"Easyship Shipment IDs","name":"easyshipShipmentIds","description":"Optional array of Easyship shipment IDs to retrieve tracking for."}
   * @paramDef {"type":"Array<String>","label":"Platform Order Numbers","name":"platformOrderNumbers","description":"Optional array of platform order numbers to retrieve tracking for."}
   * @paramDef {"type":"Boolean","label":"Include Checkpoints","name":"includeCheckpoints","uiComponent":{"type":"TOGGLE"},"description":"Include the full history of tracking checkpoints in the response."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number for pagination. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of trackings per page (1-100). Defaults to 20."}
   * @returns {Object}
   * @sampleResult {"shipments":[{"easyship_shipment_id":"ESUS10001234","platform_order_number":"ORD-1001","origin_country_alpha2":"UA","destination_country_alpha2":"US","status":"in_transit","tracking_page_url":"https://www.trackmyshipment.co/shipment-tracking/ESUS10001234","eta_date":null,"trackings":[{"tracking_number":"JD014600003476120903","local_tracking_number":null,"alternate_tracking_number":null,"leg_number":1,"handler":"DHL Express","tracking_state":"in_transit"}],"checkpoints":[{"checkpoint_time":"2026-04-26T12:00:00Z","order_number":1,"handler":"DHL Express","message":"Shipment picked up","location":"Kyiv","city":"Kyiv","country_name":"Ukraine","country_iso3":"UKR","state":null,"postal_code":null,"primary_status":"InTransit"}]}],"meta":{"pagination":{"page":1,"next":null,"count":1},"request_id":"c3c3c3c3-0000-4000-8000-000000000003"}}
   */
  async listTrackings(easyshipShipmentIds, platformOrderNumbers, includeCheckpoints, page, perPage) {
    return this.#apiRequest({
      logTag: 'listTrackings',
      url: `${ API_BASE_URL }/shipments/trackings`,
      query: cleanObject({
        easyship_shipment_id: easyshipShipmentIds,
        platform_order_number: platformOrderNumbers,
        include_checkpoints: includeCheckpoints,
        page: page || 1,
        per_page: perPage || 20,
      }),
    })
  }

  // ============================================= PRODUCTS ===============================================

  /**
   * @operationName List Products
   * @category Products
   * @description Lists products from the Easyship product catalog with pagination. Each product entry contains physical dimensions, customs data, and pricing useful for generating shipments and rate requests.
   * @route POST /listProducts
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number for pagination. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of products per page (1-100). Defaults to 20."}
   * @returns {Object}
   * @sampleResult {"products":[{"id":"prod-uuid","name":"Wireless Headphones","identifier":"WH-001","weight":0.3,"length":20,"width":15,"height":8}],"meta":{"pagination":{"page":1,"next":null,"count":1}}}
   */
  async listProducts(page, perPage) {
    return this.#apiRequest({
      logTag: 'listProducts',
      url: `${ API_BASE_URL }/products`,
      query: { page: page || 1, per_page: perPage || 20 },
    })
  }

  /**
   * @operationName Create Product
   * @category Products
   * @description Creates a new product in the Easyship product catalog with optional dimensions, weight, customs data, and pricing. Products can later be referenced by SKU when creating shipments.
   * @route POST /createProduct
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Human-readable product name (max 200 characters)."}
   * @paramDef {"type":"String","label":"Identifier (SKU)","name":"identifier","description":"Stock keeping unit (SKU) for the product. Required if storeId or platformProductId is empty."}
   * @paramDef {"type":"Number","label":"Weight (kg)","name":"weight","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Product weight in kilograms."}
   * @paramDef {"type":"Number","label":"Length (cm)","name":"length","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Product length in centimeters."}
   * @paramDef {"type":"Number","label":"Width (cm)","name":"width","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Product width in centimeters."}
   * @paramDef {"type":"Number","label":"Height (cm)","name":"height","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Product height in centimeters."}
   * @paramDef {"type":"Number","label":"Selling Price","name":"sellingPrice","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Product selling price in the smallest currency unit corresponding to sellingPriceCurrency."}
   * @paramDef {"type":"String","label":"Selling Price Currency","name":"sellingPriceCurrency","description":"ISO-4217 currency code for sellingPrice (e.g. USD, EUR)."}
   * @paramDef {"type":"String","label":"Origin Country (ISO Alpha-2)","name":"originCountryAlpha2","description":"Manufacturing country in ISO 3166-1 Alpha-2 format (e.g. CN)."}
   * @paramDef {"type":"String","label":"HS Code","name":"hsCode","description":"Harmonized System code for customs declaration."}
   * @paramDef {"type":"Boolean","label":"Contains Liquids","name":"containsLiquids","uiComponent":{"type":"TOGGLE"},"description":"Mark product as containing liquids for restricted shipping handling."}
   * @paramDef {"type":"Boolean","label":"Contains Battery PI966","name":"containsBatteryPi966","uiComponent":{"type":"TOGGLE"},"description":"Mark product as containing PI966 battery (lithium battery packed with equipment)."}
   * @paramDef {"type":"Boolean","label":"Contains Battery PI967","name":"containsBatteryPi967","uiComponent":{"type":"TOGGLE"},"description":"Mark product as containing PI967 battery (lithium battery contained in equipment)."}
   * @returns {Object}
   * @sampleResult {"product":{"id":"prod-new-uuid","name":"Wireless Headphones","identifier":"WH-001","weight":0.3}}
   */
  async createProduct(name, identifier, weight, length, width, height, sellingPrice, sellingPriceCurrency, originCountryAlpha2, hsCode, containsLiquids, containsBatteryPi966, containsBatteryPi967) {
    return this.#apiRequest({
      logTag: 'createProduct',
      method: 'post',
      url: `${ API_BASE_URL }/products`,
      body: cleanObject({
        name,
        identifier,
        weight,
        length,
        width,
        height,
        selling_price: sellingPrice,
        selling_price_currency: sellingPriceCurrency,
        origin_country_alpha2: originCountryAlpha2,
        hs_code: hsCode,
        contains_liquids: containsLiquids,
        contains_battery_pi966: containsBatteryPi966,
        contains_battery_pi967: containsBatteryPi967,
      }),
    })
  }

  /**
   * @operationName Update Product
   * @category Products
   * @description Updates fields of an existing product in the Easyship catalog. Only provided fields are modified; all other fields remain unchanged.
   * @route POST /updateProduct
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"UUID of the product to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Updated product name (max 200 characters)."}
   * @paramDef {"type":"String","label":"Identifier (SKU)","name":"identifier","description":"Updated SKU for the product."}
   * @paramDef {"type":"Number","label":"Weight (kg)","name":"weight","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Updated product weight in kilograms."}
   * @paramDef {"type":"Number","label":"Length (cm)","name":"length","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Updated product length in centimeters."}
   * @paramDef {"type":"Number","label":"Width (cm)","name":"width","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Updated product width in centimeters."}
   * @paramDef {"type":"Number","label":"Height (cm)","name":"height","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Updated product height in centimeters."}
   * @paramDef {"type":"Number","label":"Selling Price","name":"sellingPrice","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Updated selling price."}
   * @paramDef {"type":"String","label":"Selling Price Currency","name":"sellingPriceCurrency","description":"Updated ISO-4217 currency code."}
   * @paramDef {"type":"String","label":"HS Code","name":"hsCode","description":"Updated Harmonized System code."}
   * @returns {Object}
   * @sampleResult {"product":{"id":"prod-uuid","name":"Wireless Headphones v2","identifier":"WH-001"}}
   */
  async updateProduct(productId, name, identifier, weight, length, width, height, sellingPrice, sellingPriceCurrency, hsCode) {
    return this.#apiRequest({
      logTag: 'updateProduct',
      method: 'patch',
      url: `${ API_BASE_URL }/products/${ productId }`,
      body: cleanObject({
        name,
        identifier,
        weight,
        length,
        width,
        height,
        selling_price: sellingPrice,
        selling_price_currency: sellingPriceCurrency,
        hs_code: hsCode,
      }),
    })
  }

  /**
   * @operationName Delete Product
   * @category Products
   * @description Permanently deletes a product from the Easyship product catalog. Existing shipments referencing the product are not affected.
   * @route POST /deleteProduct
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"UUID of the product to delete."}
   * @returns {Object}
   * @sampleResult {"status":"deleted"}
   */
  async deleteProduct(productId) {
    return this.#apiRequest({
      logTag: 'deleteProduct',
      method: 'delete',
      url: `${ API_BASE_URL }/products/${ productId }`,
    })
  }

  /**
   * @operationName List HS Codes
   * @category Products
   * @description Looks up Harmonized System (HS) customs codes by code or description keyword. Use a returned code as the HS Code input of Create Product, Update Product, or a parcel item's hs_code field. Requires the "public.hs_code:read" advanced scope to be enabled on the API connection, and Easyship rate-limits this endpoint (1,000 requests per day).
   * @route POST /listHsCodes
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number for pagination. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of HS codes per page (1-100). Defaults to 20."}
   * @paramDef {"type":"String","label":"HS Code Filter","name":"code","description":"Filter results by HS code (e.g. \"8517\" narrows to codes starting with 8517)."}
   * @paramDef {"type":"String","label":"Description Filter","name":"description","description":"Filter results by description keyword (e.g. \"headphones\")."}
   * @returns {Object}
   * @sampleResult {"hs_codes":[{"code":"01234567","description":"This is a book"}],"meta":{"pagination":{"page":1,"next":null,"count":1},"request_id":"01563646-58c1-4607-8fe0-cae3e92c4477"}}
   */
  async listHsCodes(page, perPage, code, description) {
    return this.#apiRequest({
      logTag: 'listHsCodes',
      url: `${ API_BASE_URL }/hs_codes`,
      query: cleanObject({
        page: page || 1,
        per_page: perPage || 20,
        code,
        description,
      }),
    })
  }

  /**
   * @operationName List Item Categories
   * @category Products
   * @description Lists Easyship's item categories with each category's slug and default HS code. Use a category's slug as the "category" field and/or its hs_code as the HS code of parcel items in Request Rates and Create Shipment, or the HS Code input of Create Product.
   * @route POST /listItemCategories
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number for pagination. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of categories per page (1-100). Defaults to 20."}
   * @returns {Object}
   * @sampleResult {"item_categories":[{"id":1,"name":"Mobile Phones","slug":"mobile_phones","hs_code":"85171300","active":true,"includes_battery":true,"contains_liquids":false,"contains_battery_pi966":false,"contains_battery_pi967":true}],"meta":{"pagination":{"page":1,"next":2,"count":25},"request_id":"01563646-58c1-4607-8fe0-cae3e92c4477"}}
   */
  async listItemCategories(page, perPage) {
    return this.#apiRequest({
      logTag: 'listItemCategories',
      url: `${ API_BASE_URL }/item_categories`,
      query: { page: page || 1, per_page: perPage || 20 },
    })
  }

  // =============================================== BATCHES ==============================================

  /**
   * @operationName List Batches
   * @category Batches
   * @description Lists batch jobs (label, shipment, and address batches) ordered by creation date, with optional state and type filters. Use it to find a batch ID, then check progress with Get Batch Status.
   * @route POST /listBatches
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number for pagination. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of batches per page (1-100). Defaults to 20."}
   * @paramDef {"type":"String","label":"State","name":"state","uiComponent":{"type":"DROPDOWN","options":{"values":["Created","Processing","Processed","Failed"]}},"description":"Filter batches by processing state."}
   * @paramDef {"type":"String","label":"Batch Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Shipment Batch","Address Batch","Label Batch"]}},"description":"Filter batches by what they create (labels, shipments, or addresses)."}
   * @returns {Object}
   * @sampleResult {"batches":[{"id":"01563646-58c1-4607-8fe0-cae3e33c0001","state":"created","type":"shipment_batch","started_at":null,"finished_at":null,"created_at":"2022-02-22T12:21:00Z"}],"meta":{"pagination":{"page":1,"next":null,"count":1},"request_id":"01563646-58c1-4607-8fe0-cae3e92c4477"}}
   */
  async listBatches(page, perPage, state, type) {
    return this.#apiRequest({
      logTag: 'listBatches',
      url: `${ API_BASE_URL }/batches`,
      query: cleanObject({
        page: page || 1,
        per_page: perPage || 20,
        state: this.#resolveChoice(state, BATCH_STATE_LABELS),
        type: this.#resolveChoice(type, BATCH_TYPE_LABELS),
      }),
    })
  }

  /**
   * @operationName Get Batch Status
   * @category Batches
   * @description Retrieves the processing status of a batch by its ID, including its state (created, processing, processed, or failed) and per-item counts. Use it after Generate Labels to poll the returned batch until its state is "processed" or "failed", then inspect failures with List Batch Items.
   * @route POST /getBatch
   * @paramDef {"type":"String","label":"Batch","name":"batchId","required":true,"dictionary":"getBatchesDictionary","description":"UUID of the batch to check, e.g. the batch.id returned by Generate Labels."}
   * @returns {Object}
   * @sampleResult {"batch":{"id":"01563646-58c1-4607-8fe0-cae3e33c0001","state":"created","type":"shipment_batch","total_count":2,"created_count":1,"processing_count":0,"processed_count":0,"failed_count":1,"started_at":null,"finished_at":null,"created_at":"2022-02-22T12:21:00Z"},"meta":{"request_id":"01563646-58c1-4607-8fe0-cae3e92c4477"}}
   */
  async getBatch(batchId) {
    return this.#apiRequest({
      logTag: 'getBatch',
      url: `${ API_BASE_URL }/batches/${ batchId }`,
    })
  }

  /**
   * @operationName List Batch Items
   * @category Batches
   * @description Lists the individual items of a batch with each item's processing state, any processing errors, and the ID of the record it produced (e.g. the created shipment). Use it after Get Batch Status reports "processed" or "failed" to see per-shipment outcomes.
   * @route POST /listBatchItems
   * @paramDef {"type":"String","label":"Batch","name":"batchId","required":true,"dictionary":"getBatchesDictionary","description":"UUID of the batch whose items are listed, e.g. the batch.id returned by Generate Labels."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number for pagination. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of batch items per page (1-100). Defaults to 20."}
   * @returns {Object}
   * @sampleResult {"batch_items":[{"id":"01563646-58c1-4607-8fe0-cae3e33c0004","type":"shipment_batch_item","reference_id":"1","state":"processed","record_type":"Shipment","record_id":"01563646-58c1-4607-8fe0-cae3e33c0002","processing_errors":[],"finished_at":"2022-02-22T12:20:00Z","created_at":"2022-02-22T12:21:00Z"}],"meta":{"pagination":{"page":1,"next":null,"count":2},"request_id":"01563646-58c1-4607-8fe0-cae3e92c4477"}}
   */
  async listBatchItems(batchId, page, perPage) {
    return this.#apiRequest({
      logTag: 'listBatchItems',
      url: `${ API_BASE_URL }/batches/${ batchId }/items`,
      query: { page: page || 1, per_page: perPage || 20 },
    })
  }

  // ============================================== TRIGGERS ==============================================

  /**
   * @registerAs POLLING_TRIGGER
   * @operationName On Tracking Status Changed
   * @category Triggers
   * @description Fires when a shipment records a new tracking checkpoint - a delivery status update such as picked up, in transit, out for delivery, or delivered - across all shipments in the account. Polling interval can be customized (minimum 30 seconds). The first cycle establishes a baseline and emits nothing; later cycles emit one event per new checkpoint.
   * @route POST /on-tracking-status-changed
   * @returns {Object}
   * @sampleResult {"id":"ESUS10001234|2026-04-26T12:00:00Z|1","checkpoint_time":"2026-04-26T12:00:00Z","easyship_shipment_id":"ESUS10001234","platform_order_number":"ORD-1001","tracking_number":"JD014600003476120903","status":"in_transit","tracking_page_url":"https://www.trackmyshipment.co/shipment-tracking/ESUS10001234","primary_status":"InTransit","message":"Shipment picked up","location":"Kyiv","checkpoint":{"checkpoint_time":"2026-04-26T12:00:00Z","handler":"DHL Express","message":"Shipment picked up","primary_status":"InTransit"}}
   */
  async onTrackingStatusChanged(invocation) {
    const state = (invocation && invocation.state) || null
    const nowIso = new Date().toISOString()

    const shipments = await this.#fetchAllTrackings()

    return EasyshipPolling.diff(shipments, nowIso, state)
  }

  // Page through every GET /shipments/trackings page for one polling cycle. Exhaust the pagination
  // fully - stopping at a fixed page count would drop shipments on later pages and skip their
  // status changes forever.
  async #fetchAllTrackings() {
    const all = []
    let page = 1

    for (;;) {
      const response = await this.#apiRequest({
        logTag: 'onTrackingStatusChanged',
        url: `${ API_BASE_URL }/shipments/trackings`,
        query: { page, per_page: 100, include_checkpoints: true },
      })

      all.push(...(response.shipments || []))

      const next = response.meta?.pagination?.next

      if (!next) break

      page = next
    }

    return all
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

Flowrunner.ServerCode.addService(EasyshipService, [
  {
    name: 'apiToken',
    displayName: 'API Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Generate a Sandbox or Production API access token in your Easyship dashboard at https://app.easyship.com/connect/api. Sandbox tokens start with "sand_", production tokens with "prod_".',
  },
])
