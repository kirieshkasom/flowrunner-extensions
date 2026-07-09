'use strict'

const API_BASE_URL = 'https://api.goshippo.com'
const SHIPPO_API_VERSION = '2018-02-08'
const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100

const logger = {
  info: (...args) => console.log('[Shippo Service] info:', ...args),
  debug: (...args) => console.log('[Shippo Service] debug:', ...args),
  error: (...args) => console.log('[Shippo Service] error:', ...args),
  warn: (...args) => console.log('[Shippo Service] warn:', ...args),
}

const STATIC_DICTIONARIES = {
  distanceUnits: [
    { label: 'Inches (in)', value: 'in', note: 'Imperial' },
    { label: 'Centimeters (cm)', value: 'cm', note: 'Metric' },
    { label: 'Feet (ft)', value: 'ft', note: 'Imperial' },
    { label: 'Millimeters (mm)', value: 'mm', note: 'Metric' },
    { label: 'Meters (m)', value: 'm', note: 'Metric' },
    { label: 'Yards (yd)', value: 'yd', note: 'Imperial' },
  ],
  massUnits: [
    { label: 'Grams (g)', value: 'g', note: 'Metric' },
    { label: 'Ounces (oz)', value: 'oz', note: 'Imperial' },
    { label: 'Pounds (lb)', value: 'lb', note: 'Imperial' },
    { label: 'Kilograms (kg)', value: 'kg', note: 'Metric' },
  ],
  labelFileTypes: [
    { label: 'PNG', value: 'PNG', note: 'Default thermal-printer-friendly raster' },
    { label: 'PNG 2.3x7.5', value: 'PNG_2.3x7.5', note: 'Narrow thermal printer format' },
    { label: 'PDF', value: 'PDF', note: 'Standard PDF label' },
    { label: 'PDF 4x6', value: 'PDF_4x6', note: '4x6 inch label PDF' },
    { label: 'PDF 4x8', value: 'PDF_4x8', note: '4x8 inch label PDF' },
    { label: 'PDF A4', value: 'PDF_A4', note: 'A4 paper format' },
    { label: 'PDF A6', value: 'PDF_A6', note: 'A6 paper format' },
    { label: 'ZPLII', value: 'ZPLII', note: 'Zebra thermal printer code' },
  ],
  carriers: [
    { label: 'USPS', value: 'usps', note: 'United States Postal Service' },
    { label: 'FedEx', value: 'fedex', note: 'FedEx domestic and international' },
    { label: 'UPS', value: 'ups', note: 'United Parcel Service' },
    { label: 'DHL Express', value: 'dhl_express', note: 'International express' },
    { label: 'DHL eCommerce', value: 'dhl_ecommerce', note: 'Domestic and global parcels' },
    { label: 'DHL Germany', value: 'dhl_germany', note: 'Deutsche Post DHL' },
    { label: 'Canada Post', value: 'canada_post', note: 'Canadian national postal carrier' },
    { label: 'Australia Post', value: 'australia_post', note: 'Australian national postal carrier' },
    { label: 'Royal Mail', value: 'royal_mail', note: 'United Kingdom postal carrier' },
    { label: 'Aramex', value: 'aramex', note: 'Middle East and global logistics' },
    { label: 'Asendia US', value: 'asendia_us', note: 'International e-commerce shipping' },
    { label: 'Bring', value: 'bring', note: 'Norwegian/Nordic postal carrier' },
    { label: 'Colissimo', value: 'colissimo', note: 'French national parcel carrier' },
    { label: 'DPD', value: 'dpd', note: 'European parcel delivery' },
    { label: 'GLS', value: 'gls', note: 'European parcel logistics' },
    { label: 'Hermes', value: 'hermes', note: 'European consumer parcel carrier' },
    { label: 'OnTrac', value: 'ontrac', note: 'Western US regional carrier' },
    { label: 'Poste Italiane', value: 'poste_italiane', note: 'Italian national postal carrier' },
    { label: 'PostNL', value: 'postnl', note: 'Dutch national postal carrier' },
    { label: 'Purolator', value: 'purolator', note: 'Canadian courier service' },
    { label: 'Sendle', value: 'sendle', note: 'Australian carbon-neutral delivery' },
    { label: 'TNT', value: 'tnt', note: 'TNT Express international' },
    { label: 'New Zealand Post', value: 'newzealand_post', note: 'New Zealand national postal carrier' },
    { label: 'Singapore Post', value: 'singapore_post', note: 'Singapore national postal carrier' },
  ],
  currencies: [
    { label: 'USD - United States Dollar', value: 'USD', note: 'United States' },
    { label: 'EUR - Euro', value: 'EUR', note: 'European Union' },
    { label: 'GBP - British Pound', value: 'GBP', note: 'United Kingdom' },
    { label: 'CAD - Canadian Dollar', value: 'CAD', note: 'Canada' },
    { label: 'AUD - Australian Dollar', value: 'AUD', note: 'Australia' },
    { label: 'NZD - New Zealand Dollar', value: 'NZD', note: 'New Zealand' },
    { label: 'JPY - Japanese Yen', value: 'JPY', note: 'Japan' },
    { label: 'CNY - Chinese Yuan', value: 'CNY', note: 'China' },
    { label: 'HKD - Hong Kong Dollar', value: 'HKD', note: 'Hong Kong' },
    { label: 'SGD - Singapore Dollar', value: 'SGD', note: 'Singapore' },
    { label: 'CHF - Swiss Franc', value: 'CHF', note: 'Switzerland' },
    { label: 'SEK - Swedish Krona', value: 'SEK', note: 'Sweden' },
    { label: 'NOK - Norwegian Krone', value: 'NOK', note: 'Norway' },
    { label: 'DKK - Danish Krone', value: 'DKK', note: 'Denmark' },
    { label: 'MXN - Mexican Peso', value: 'MXN', note: 'Mexico' },
    { label: 'BRL - Brazilian Real', value: 'BRL', note: 'Brazil' },
    { label: 'INR - Indian Rupee', value: 'INR', note: 'India' },
    { label: 'ZAR - South African Rand', value: 'ZAR', note: 'South Africa' },
  ],
  countries: [
    { label: 'United States', value: 'US', note: 'North America' },
    { label: 'Canada', value: 'CA', note: 'North America' },
    { label: 'Mexico', value: 'MX', note: 'North America' },
    { label: 'United Kingdom', value: 'GB', note: 'Europe' },
    { label: 'Ireland', value: 'IE', note: 'Europe' },
    { label: 'France', value: 'FR', note: 'Europe' },
    { label: 'Germany', value: 'DE', note: 'Europe' },
    { label: 'Spain', value: 'ES', note: 'Europe' },
    { label: 'Italy', value: 'IT', note: 'Europe' },
    { label: 'Netherlands', value: 'NL', note: 'Europe' },
    { label: 'Belgium', value: 'BE', note: 'Europe' },
    { label: 'Switzerland', value: 'CH', note: 'Europe' },
    { label: 'Austria', value: 'AT', note: 'Europe' },
    { label: 'Sweden', value: 'SE', note: 'Europe' },
    { label: 'Norway', value: 'NO', note: 'Europe' },
    { label: 'Denmark', value: 'DK', note: 'Europe' },
    { label: 'Finland', value: 'FI', note: 'Europe' },
    { label: 'Poland', value: 'PL', note: 'Europe' },
    { label: 'Portugal', value: 'PT', note: 'Europe' },
    { label: 'Greece', value: 'GR', note: 'Europe' },
    { label: 'Czech Republic', value: 'CZ', note: 'Europe' },
    { label: 'Hungary', value: 'HU', note: 'Europe' },
    { label: 'Australia', value: 'AU', note: 'Oceania' },
    { label: 'New Zealand', value: 'NZ', note: 'Oceania' },
    { label: 'Japan', value: 'JP', note: 'Asia' },
    { label: 'China', value: 'CN', note: 'Asia' },
    { label: 'Hong Kong', value: 'HK', note: 'Asia' },
    { label: 'Singapore', value: 'SG', note: 'Asia' },
    { label: 'South Korea', value: 'KR', note: 'Asia' },
    { label: 'India', value: 'IN', note: 'Asia' },
    { label: 'Thailand', value: 'TH', note: 'Asia' },
    { label: 'Vietnam', value: 'VN', note: 'Asia' },
    { label: 'Philippines', value: 'PH', note: 'Asia' },
    { label: 'Malaysia', value: 'MY', note: 'Asia' },
    { label: 'Indonesia', value: 'ID', note: 'Asia' },
    { label: 'Brazil', value: 'BR', note: 'South America' },
    { label: 'Argentina', value: 'AR', note: 'South America' },
    { label: 'Chile', value: 'CL', note: 'South America' },
    { label: 'Colombia', value: 'CO', note: 'South America' },
    { label: 'United Arab Emirates', value: 'AE', note: 'Middle East' },
    { label: 'Saudi Arabia', value: 'SA', note: 'Middle East' },
    { label: 'Israel', value: 'IL', note: 'Middle East' },
    { label: 'Turkey', value: 'TR', note: 'Middle East' },
    { label: 'South Africa', value: 'ZA', note: 'Africa' },
    { label: 'Egypt', value: 'EG', note: 'Africa' },
    { label: 'Nigeria', value: 'NG', note: 'Africa' },
  ],
  contentsTypes: [
    { label: 'Documents', value: 'DOCUMENTS', note: 'Paper documents only' },
    { label: 'Gift', value: 'GIFT', note: 'Personal gift' },
    { label: 'Sample', value: 'SAMPLE', note: 'Product sample of no commercial value' },
    { label: 'Merchandise', value: 'MERCHANDISE', note: 'Commercial goods' },
    { label: 'Humanitarian Donation', value: 'HUMANITARIAN_DONATION', note: 'Aid or charity goods' },
    { label: 'Return Merchandise', value: 'RETURN_MERCHANDISE', note: 'Returned goods to origin' },
    { label: 'Other', value: 'OTHER', note: 'Specify in contentsExplanation' },
  ],
  nonDeliveryOptions: [
    { label: 'Return to Sender', value: 'RETURN', note: 'Return at sender expense' },
    { label: 'Abandon', value: 'ABANDON', note: 'Treat as abandoned' },
  ],
  incoterms: [
    { label: 'DDP - Delivered Duty Paid', value: 'DDP', note: 'Sender covers all duties and taxes' },
    { label: 'DDU - Delivered Duty Unpaid', value: 'DDU', note: 'Recipient pays duties' },
    { label: 'FCA - Free Carrier', value: 'FCA', note: 'Sender clears for export' },
    { label: 'EXW - Ex Works', value: 'EXW', note: 'Buyer arranges transport' },
    { label: 'FOB - Free On Board', value: 'FOB', note: 'Sender delivers to port of shipment' },
  ],
  eelPfcs: [
    { label: 'NOEEI 30.37(a)', value: 'NOEEI_30_37_a', note: 'Shipments under USD 2500 to non-restricted destinations' },
    { label: 'NOEEI 30.37(h)', value: 'NOEEI_30_37_h', note: 'Tools of trade returning to US' },
    { label: 'NOEEI 30.36', value: 'NOEEI_30_36', note: 'Shipments to Canada under USD 2500' },
    { label: 'NOEEI 30.37(f)', value: 'NOEEI_30_37_f', note: 'Hand-carried gifts and personal effects' },
    { label: 'AES ITN', value: 'AES_ITN', note: 'Required for shipments above USD 2500 (use AES Internal Transaction Number)' },
  ],
  orderStatuses: [
    { label: 'Unknown', value: 'UNKNOWN', note: 'Status not yet determined' },
    { label: 'Awaiting Payment', value: 'AWAITPAY', note: 'Awaiting buyer payment' },
    { label: 'Paid', value: 'PAID', note: 'Order paid and ready to fulfill' },
    { label: 'Refunded', value: 'REFUNDED', note: 'Refunded to buyer' },
    { label: 'Cancelled', value: 'CANCELLED', note: 'Cancelled before fulfillment' },
    { label: 'Partially Fulfilled', value: 'PARTIALLY_FULFILLED', note: 'Some line items shipped' },
    { label: 'Shipped', value: 'SHIPPED', note: 'Shipped to buyer' },
  ],
  serviceLevelsByCarrier: {
    usps: [
      { label: 'USPS Priority Mail', value: 'usps_priority' },
      { label: 'USPS Priority Mail Express', value: 'usps_priority_express' },
      { label: 'USPS First-Class Package', value: 'usps_first' },
      { label: 'USPS Parcel Select Ground', value: 'usps_parcel_select' },
      { label: 'USPS Media Mail', value: 'usps_media_mail' },
      { label: 'USPS Priority Mail International', value: 'usps_priority_mail_international' },
      { label: 'USPS Priority Mail Express International', value: 'usps_priority_mail_express_international' },
      { label: 'USPS First-Class Package International', value: 'usps_first_class_package_international_service' },
    ],
    fedex: [
      { label: 'FedEx Ground', value: 'fedex_ground' },
      { label: 'FedEx Home Delivery', value: 'fedex_home_delivery' },
      { label: 'FedEx 2 Day', value: 'fedex_2_day' },
      { label: 'FedEx Standard Overnight', value: 'fedex_standard_overnight' },
      { label: 'FedEx Priority Overnight', value: 'fedex_priority_overnight' },
      { label: 'FedEx International Economy', value: 'fedex_international_economy' },
      { label: 'FedEx International Priority', value: 'fedex_international_priority' },
    ],
    ups: [
      { label: 'UPS Ground', value: 'ups_ground' },
      { label: 'UPS 3 Day Select', value: 'ups_3_day_select' },
      { label: 'UPS 2nd Day Air', value: 'ups_2nd_day_air' },
      { label: 'UPS Next Day Air', value: 'ups_next_day_air' },
      { label: 'UPS Next Day Air Saver', value: 'ups_next_day_air_saver' },
      { label: 'UPS Worldwide Expedited', value: 'ups_worldwide_expedited' },
      { label: 'UPS Worldwide Express', value: 'ups_worldwide_express' },
      { label: 'UPS Worldwide Saver', value: 'ups_worldwide_saver' },
    ],
    dhl_express: [
      { label: 'DHL Express Worldwide', value: 'dhl_express_worldwide' },
      { label: 'DHL Express Domestic', value: 'dhl_express_domestic' },
      { label: 'DHL Express 9:00', value: 'dhl_express_9_00' },
      { label: 'DHL Express 10:30', value: 'dhl_express_10_30' },
      { label: 'DHL Express 12:00', value: 'dhl_express_12_00' },
    ],
    canada_post: [
      { label: 'Canada Post Regular Parcel', value: 'canada_post_regular_parcel' },
      { label: 'Canada Post Expedited Parcel', value: 'canada_post_expedited_parcel' },
      { label: 'Canada Post Xpresspost', value: 'canada_post_xpresspost' },
      { label: 'Canada Post Priority', value: 'canada_post_priority' },
    ],
    australia_post: [
      { label: 'Australia Post Parcel Post', value: 'australia_post_parcel_post' },
      { label: 'Australia Post Express Post', value: 'australia_post_express_post' },
      { label: 'Australia Post Standard International', value: 'australia_post_standard_international' },
      { label: 'Australia Post Express International', value: 'australia_post_express_international' },
    ],
    royal_mail: [
      { label: 'Royal Mail 1st Class', value: 'royal_mail_first_class' },
      { label: 'Royal Mail 2nd Class', value: 'royal_mail_second_class' },
      { label: 'Royal Mail Tracked 24', value: 'royal_mail_tracked_24' },
      { label: 'Royal Mail Tracked 48', value: 'royal_mail_tracked_48' },
    ],
  },
}

/**
 * @integrationName Shippo
 * @integrationIcon /icon.png
 * @integrationTriggersScope SINGLE_APP
 **/
class Shippo {
  constructor({ apiKey }) {
    this.apiKey = apiKey
  }

  async #apiRequest({ method, endpoint, query, payload }) {
    const url = API_BASE_URL + endpoint
    const httpMethod = (method || 'get').toLowerCase()
    const logTag = '[apiRequest]'

    try {
      logger.debug(`${ logTag } ${ httpMethod.toUpperCase() } ${ url } query=${ JSON.stringify(query || {}) }`)

      return await Flowrunner.Request[httpMethod](url)
        .set({
          Authorization: `ShippoToken ${ this.apiKey }`,
          'Shippo-API-Version': SHIPPO_API_VERSION,
          'Content-Type': 'application/json',
        })
        .query(query || null)
        .send(payload || null)
    } catch (error) {
      const status = error?.status || error?.statusCode
      const body = error?.body || error?.message || error
      const detail = typeof body === 'object' ? JSON.stringify(body) : String(body)

      const hint = {
        400: 'Bad request - check the parameters and payload sent to Shippo.',
        401: 'Authentication failed - verify the Shippo API token.',
        403: 'Forbidden - the Shippo API token lacks permission for this request.',
        404: 'Not found - the requested Shippo resource does not exist.',
        429: 'Rate limited - too many requests to Shippo. Retry after a short delay.',
      }[status]

      logger.error(`${ logTag } request failed status=${ status } body=${ detail }`)

      const prefix = `Shippo API request failed (${ status || 'no-status' })`

      throw new Error(hint ? `${ prefix }: ${ hint } ${ detail }` : `${ prefix }: ${ detail }`)
    }
  }

  #buildPaging(page, results) {
    const query = {}

    if (page && Number(page) > 0) {
      query.page = Number(page)
    }

    if (results && Number(results) > 0) {
      query.results = Math.min(Number(results), MAX_PAGE_SIZE)
    }

    return query
  }

  #applySearch(items, search) {
    if (!search) {
      return items
    }

    const needle = String(search).toLowerCase()

    return items.filter(item => String(item.label || '').toLowerCase().includes(needle) ||
      String(item.value || '').toLowerCase().includes(needle))
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  async #listDictionary(endpoint, payload, mapItem) {
    payload = payload || {}

    const cursor = payload.cursor
    const page = cursor ? Number(cursor) : 1

    const response = await this.#apiRequest({
      method: 'get',
      endpoint,
      query: { page, results: DEFAULT_PAGE_SIZE },
    })

    const items = (response?.results || []).map(mapItem)
    const filtered = this.#applySearch(items, payload.search)
    const nextCursor = response?.next ? String(page + 1) : null

    return { items: filtered, cursor: nextCursor }
  }

  /* =========================================================================
   * Shared typedefs
   * =======================================================================*/

  /**
   * @typedef {Object} DictionaryPayload
   * @property {String} [search]
   * @property {String} [cursor]
   * @property {Object} [criteria]
   */

  /**
   * @typedef {Object} DictionaryItem
   * @property {String} label
   * @property {any} value
   * @property {String} [note]
   */

  /**
   * @typedef {Object} DictionaryResponse
   * @property {Array<DictionaryItem>} items
   * @property {String} [cursor]
   */

  /**
   * @typedef {Object} ShippoListResponse
   * @property {Number} count
   * @property {String} [next]
   * @property {String} [previous]
   * @property {Array<Object>} results
   */

  /**
   * @typedef {Object} Address
   * @property {String} object_id
   * @property {String} object_state
   * @property {String} object_purpose
   * @property {String} name
   * @property {String} company
   * @property {String} street1
   * @property {String} street2
   * @property {String} city
   * @property {String} state
   * @property {String} zip
   * @property {String} country
   * @property {String} phone
   * @property {String} email
   * @property {Boolean} is_residential
   * @property {Object} [validation_results]
   */

  /**
   * @typedef {Object} Parcel
   * @property {String} object_id
   * @property {String} object_state
   * @property {String} length
   * @property {String} width
   * @property {String} height
   * @property {String} distance_unit
   * @property {String} weight
   * @property {String} mass_unit
   * @property {String} [template]
   */

  /**
   * @typedef {Object} Rate
   * @property {String} object_id
   * @property {String} amount
   * @property {String} currency
   * @property {String} provider
   * @property {String} servicelevel_token
   * @property {String} servicelevel_name
   * @property {Number} estimated_days
   * @property {Object} attributes
   */

  /**
   * @typedef {Object} Shipment
   * @property {String} object_id
   * @property {String} status
   * @property {Object} address_from
   * @property {Object} address_to
   * @property {Array<Object>} parcels
   * @property {Array<Rate>} rates
   * @property {String} [carrier_account]
   */

  /**
   * @typedef {Object} Transaction
   * @property {String} object_id
   * @property {String} status
   * @property {String} object_state
   * @property {String} rate
   * @property {String} tracking_number
   * @property {String} tracking_url_provider
   * @property {String} tracking_status
   * @property {String} label_url
   * @property {String} commercial_invoice_url
   * @property {Array<Object>} messages
   */

  /**
   * @typedef {Object} Tracker
   * @property {String} carrier
   * @property {String} tracking_number
   * @property {Object} address_from
   * @property {Object} address_to
   * @property {Object} tracking_status
   * @property {Array<Object>} tracking_history
   * @property {String} eta
   * @property {String} servicelevel
   */

  /**
   * @typedef {Object} CustomsItem
   * @property {String} object_id
   * @property {String} description
   * @property {String} quantity
   * @property {String} net_weight
   * @property {String} mass_unit
   * @property {String} value_amount
   * @property {String} value_currency
   * @property {String} origin_country
   * @property {String} [tariff_number]
   * @property {String} [sku_code]
   * @property {String} [hs_code]
   */

  /**
   * @typedef {Object} CustomsDeclaration
   * @property {String} object_id
   * @property {String} status
   * @property {String} contents_type
   * @property {String} contents_explanation
   * @property {String} non_delivery_option
   * @property {Boolean} certify
   * @property {String} certify_signer
   * @property {Array<String>} items
   * @property {String} [incoterm]
   * @property {String} [eel_pfc]
   */

  /**
   * @typedef {Object} CarrierAccount
   * @property {String} object_id
   * @property {String} carrier
   * @property {String} account_id
   * @property {Boolean} active
   * @property {Boolean} is_shippo_account
   * @property {Object} [parameters]
   */

  /**
   * @typedef {Object} Manifest
   * @property {String} object_id
   * @property {String} status
   * @property {String} carrier_account
   * @property {String} shipment_date
   * @property {String} address_from
   * @property {Array<String>} transactions
   * @property {String} [documents]
   */

  /**
   * @typedef {Object} Refund
   * @property {String} object_id
   * @property {String} status
   * @property {String} transaction
   */

  /**
   * @typedef {Object} Order
   * @property {String} object_id
   * @property {String} order_number
   * @property {String} order_status
   * @property {Object} to_address
   * @property {Object} [from_address]
   * @property {Array<Object>} line_items
   * @property {String} placed_at
   */

  /**
   * @typedef {Object} Pickup
   * @property {String} object_id
   * @property {String} status
   * @property {String} carrier_account
   * @property {String} requested_start_time
   * @property {String} requested_end_time
   * @property {Array<String>} transactions
   * @property {String} confirmation_code
   */

  /**
   * @typedef {Object} ServiceGroup
   * @property {String} object_id
   * @property {String} name
   * @property {String} type
   * @property {String} description
   * @property {Array<Object>} service_levels
   * @property {Number} rate_adjustment
   * @property {String} [flat_rate]
   * @property {String} [flat_rate_currency]
   * @property {String} [free_shipping_threshold_min]
   * @property {String} [free_shipping_threshold_currency]
   * @property {Boolean} is_active
   */

  /**
   * @typedef {Object} Webhook
   * @property {String} object_id
   * @property {String} url
   * @property {String} event
   * @property {Boolean} is_test
   * @property {Boolean} active
   */

  /**
   * @typedef {Object} Batch
   * @property {String} object_id
   * @property {String} status
   * @property {String} default_carrier_account
   * @property {String} default_servicelevel_token
   * @property {String} label_filetype
   * @property {Array<String>} label_url
   * @property {String} metadata
   * @property {Object} object_results
   * @property {Object} batch_shipments
   * @property {String} object_owner
   */

  /* =========================================================================
   * Dictionary methods
   * =======================================================================*/

  /**
   * @typedef {Object} getCarrierAccountsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","required":false,"description":"Search text used to narrow returned items by label or value."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"description":"Pagination cursor from a previous response."}
   */

  /**
   * @operationName Get Carrier Accounts Dictionary
   * @description Returns connected carrier accounts as dropdown options. Test API tokens automatically expose Shippo's default test accounts (USPS, FedEx, DHL Express).
   * @route POST /getCarrierAccountsDictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getCarrierAccountsDictionary__payload","label":"Payload","name":"payload","description":"Dictionary payload containing search and cursor."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"USPS (****1234)","value":"b741b99f95e841639b54272834bcdd40","note":"active"}],"cursor":null}
   */
  async getCarrierAccountsDictionary(payload) {
    payload = payload || {}

    const cursor = payload.cursor
    const page = cursor ? Number(cursor) : 1

    const response = await this.#apiRequest({
      method: 'get',
      endpoint: '/carrier_accounts',
      query: { page, results: DEFAULT_PAGE_SIZE },
    })

    const items = (response?.results || []).map(account => {
      const accountIdRaw = account.account_id || ''
      const accountIdSuffix = accountIdRaw.length > 4 ? accountIdRaw.slice(-4) : accountIdRaw

      return {
        label: `${ (account.carrier || '').toUpperCase() }${ accountIdSuffix ? ` (****${ accountIdSuffix })` : '' }`,
        value: account.object_id,
        note: account.active ? 'active' : 'inactive',
      }
    })

    const filtered = this.#applySearch(items, payload.search)
    const nextCursor = response?.next ? String(page + 1) : null

    return { items: filtered, cursor: nextCursor }
  }

  /**
   * @typedef {Object} ResourceDictionaryPayload
   * @paramDef {"type":"String","label":"Search","name":"search","required":false,"description":"Search text used to narrow returned items by label or value."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"description":"Pagination cursor from a previous response."}
   */

  /**
   * @operationName Get Addresses Dictionary
   * @description Returns saved addresses as dropdown options so users pick a sender or recipient instead of pasting an object_id.
   * @route POST /getAddressesDictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"ResourceDictionaryPayload","label":"Payload","name":"payload","description":"Dictionary payload containing search and cursor."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Mr. Hippo - San Francisco","value":"d799c2679e644279b59fe661ac8fa488","note":"215 Clayton St., San Francisco, CA, US"}],"cursor":null}
   */
  getAddressesDictionary(payload) {
    return this.#listDictionary('/addresses', payload, address => ({
      label: [address.name, address.city].filter(Boolean).join(' - ') || address.object_id,
      value: address.object_id,
      note: [address.street1, address.city, address.state, address.country].filter(Boolean).join(', '),
    }))
  }

  /**
   * @operationName Get Parcels Dictionary
   * @description Returns saved parcels as dropdown options so users pick a package instead of pasting an object_id.
   * @route POST /getParcelsDictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"ResourceDictionaryPayload","label":"Payload","name":"payload","description":"Dictionary payload containing search and cursor."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"10x5x2 in, 1.5 lb","value":"7df2ecf8b4224763ab7c71fae7ec8274","note":"VALID"}],"cursor":null}
   */
  getParcelsDictionary(payload) {
    return this.#listDictionary('/parcels', payload, parcel => ({
      label: parcel.template ||
        `${ parcel.length }x${ parcel.width }x${ parcel.height } ${ parcel.distance_unit }, ${ parcel.weight } ${ parcel.mass_unit }`,
      value: parcel.object_id,
      note: parcel.object_state || '',
    }))
  }

  /**
   * @operationName Get Shipments Dictionary
   * @description Returns saved shipments as dropdown options so users pick a shipment instead of pasting an object_id.
   * @route POST /getShipmentsDictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"ResourceDictionaryPayload","label":"Payload","name":"payload","description":"Dictionary payload containing search and cursor."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"To Las Vegas (SUCCESS)","value":"adcfdddf8ec64b84ad22772bce3ea37a","note":"SUCCESS"}],"cursor":null}
   */
  getShipmentsDictionary(payload) {
    return this.#listDictionary('/shipments', payload, shipment => ({
      label: shipment.address_to?.city
        ? `To ${ shipment.address_to.city } (${ shipment.status })`
        : `Shipment (${ shipment.status })`,
      value: shipment.object_id,
      note: shipment.status || '',
    }))
  }

  /**
   * @operationName Get Transactions Dictionary
   * @description Returns purchased labels (transactions) as dropdown options so users pick one instead of pasting an object_id.
   * @route POST /getTransactionsDictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"ResourceDictionaryPayload","label":"Payload","name":"payload","description":"Dictionary payload containing search and cursor."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"9499907123456123456781 (SUCCESS)","value":"915d94940ea54c3a80cbfa328722f5a1","note":"SUCCESS"}],"cursor":null}
   */
  getTransactionsDictionary(payload) {
    return this.#listDictionary('/transactions', payload, transaction => ({
      label: transaction.tracking_number
        ? `${ transaction.tracking_number } (${ transaction.status })`
        : `Label (${ transaction.status })`,
      value: transaction.object_id,
      note: transaction.status || '',
    }))
  }

  /**
   * @operationName Get Refunds Dictionary
   * @description Returns requested refunds as dropdown options so users pick one instead of pasting an object_id.
   * @route POST /getRefundsDictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"ResourceDictionaryPayload","label":"Payload","name":"payload","description":"Dictionary payload containing search and cursor."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Refund SUCCESS","value":"d24c5179d3214f098cc0797fc2b1450c","note":"transaction 915d94940ea54c3a80cbfa328722f5a1"}],"cursor":null}
   */
  getRefundsDictionary(payload) {
    return this.#listDictionary('/refunds', payload, refund => ({
      label: `Refund ${ refund.status }`,
      value: refund.object_id,
      note: refund.transaction ? `transaction ${ refund.transaction }` : '',
    }))
  }

  /**
   * @operationName Get Manifests Dictionary
   * @description Returns created manifests as dropdown options so users pick one instead of pasting an object_id.
   * @route POST /getManifestsDictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"ResourceDictionaryPayload","label":"Payload","name":"payload","description":"Dictionary payload containing search and cursor."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"2024-04-12T08:00:00Z (SUCCESS)","value":"f2e10b27797642e6b22b97c0a51d8221","note":"SUCCESS"}],"cursor":null}
   */
  getManifestsDictionary(payload) {
    return this.#listDictionary('/manifests', payload, manifest => ({
      label: manifest.shipment_date
        ? `${ manifest.shipment_date } (${ manifest.status })`
        : `Manifest (${ manifest.status })`,
      value: manifest.object_id,
      note: manifest.status || '',
    }))
  }

  /**
   * @operationName Get Customs Items Dictionary
   * @description Returns created customs items as dropdown options so users pick one instead of pasting an object_id.
   * @route POST /getCustomsItemsDictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"ResourceDictionaryPayload","label":"Payload","name":"payload","description":"Dictionary payload containing search and cursor."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"T-Shirt","value":"55358464c7b740aca199b395536981bd","note":"qty 2"}],"cursor":null}
   */
  getCustomsItemsDictionary(payload) {
    return this.#listDictionary('/customs/items', payload, item => ({
      label: item.description || item.object_id,
      value: item.object_id,
      note: item.quantity ? `qty ${ item.quantity }` : '',
    }))
  }

  /**
   * @operationName Get Customs Declarations Dictionary
   * @description Returns created customs declarations as dropdown options so users pick one instead of pasting an object_id.
   * @route POST /getCustomsDeclarationsDictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"ResourceDictionaryPayload","label":"Payload","name":"payload","description":"Dictionary payload containing search and cursor."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"MERCHANDISE (VALID)","value":"adcfdddf8ec64b84ad22772bce3ea37a","note":"VALID"}],"cursor":null}
   */
  getCustomsDeclarationsDictionary(payload) {
    return this.#listDictionary('/customs/declarations', payload, declaration => ({
      label: `${ declaration.contents_type } (${ declaration.status })`,
      value: declaration.object_id,
      note: declaration.status || '',
    }))
  }

  /**
   * @operationName Get Orders Dictionary
   * @description Returns Shippo orders as dropdown options so users pick one instead of pasting an object_id.
   * @route POST /getOrdersDictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"ResourceDictionaryPayload","label":"Payload","name":"payload","description":"Dictionary payload containing search and cursor."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"#1068 (PAID)","value":"4f2bc588e4e5446cb3f9fdb7cd5e190b","note":"PAID"}],"cursor":null}
   */
  getOrdersDictionary(payload) {
    return this.#listDictionary('/orders', payload, order => ({
      label: order.order_number
        ? `${ order.order_number } (${ order.order_status })`
        : order.object_id,
      value: order.object_id,
      note: order.order_status || '',
    }))
  }

  /**
   * @operationName Get Webhooks Dictionary
   * @description Returns registered webhook subscriptions as dropdown options so users pick one instead of pasting an object_id.
   * @route POST /getWebhooksDictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"ResourceDictionaryPayload","label":"Payload","name":"payload","description":"Dictionary payload containing search and cursor."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"track_updated - https://example.com/webhook","value":"abc12345abc12345abc12345abc12345","note":"active"}],"cursor":null}
   */
  getWebhooksDictionary(payload) {
    return this.#listDictionary('/webhooks', payload, webhook => ({
      label: webhook.url ? `${ webhook.event } - ${ webhook.url }` : (webhook.event || webhook.object_id),
      value: webhook.object_id,
      note: webhook.active ? 'active' : 'inactive',
    }))
  }

  /**
   * @operationName Get Service Groups Dictionary
   * @description Returns configured service groups as dropdown options so users pick one instead of pasting an object_id.
   * @route POST /getServiceGroupsDictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"ResourceDictionaryPayload","label":"Payload","name":"payload","description":"Dictionary payload containing search."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"USPS Domestic","value":"7f3e7a8e62094a8d9d08d7e8d27a2fbe","note":"LIVE_RATE"}]}
   */
  async getServiceGroupsDictionary(payload) {
    const response = await this.#apiRequest({ method: 'get', endpoint: '/service-groups' })
    const list = Array.isArray(response) ? response : (response?.results || [])

    const items = list.map(group => ({
      label: group.name || group.object_id,
      value: group.object_id,
      note: group.type || '',
    }))

    return { items: this.#applySearch(items, payload?.search) }
  }

  /**
   * @typedef {Object} getDistanceUnitsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","required":false,"description":"Search text used to narrow returned items by label or value."}
   */

  /**
   * @operationName Get Distance Units Dictionary
   * @description Returns the distance units accepted by Shippo for parcel dimensions.
   * @route POST /getDistanceUnitsDictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getDistanceUnitsDictionary__payload","label":"Payload","name":"payload","description":"Dictionary payload containing search."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Inches (in)","value":"in","note":"Imperial"}]}
   */
  getDistanceUnitsDictionary(payload) {
    return { items: this.#applySearch(STATIC_DICTIONARIES.distanceUnits, payload?.search) }
  }

  /**
   * @typedef {Object} getMassUnitsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","required":false,"description":"Search text used to narrow returned items by label or value."}
   */

  /**
   * @operationName Get Mass Units Dictionary
   * @description Returns the mass units accepted by Shippo for parcel weights.
   * @route POST /getMassUnitsDictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getMassUnitsDictionary__payload","label":"Payload","name":"payload","description":"Dictionary payload containing search."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Pounds (lb)","value":"lb","note":"Imperial"}]}
   */
  getMassUnitsDictionary(payload) {
    return { items: this.#applySearch(STATIC_DICTIONARIES.massUnits, payload?.search) }
  }

  /**
   * @typedef {Object} getLabelFileTypesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","required":false,"description":"Search text used to narrow returned items by label or value."}
   */

  /**
   * @operationName Get Label File Types Dictionary
   * @description Returns the label file types Shippo can produce when purchasing a label.
   * @route POST /getLabelFileTypesDictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getLabelFileTypesDictionary__payload","label":"Payload","name":"payload","description":"Dictionary payload containing search."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"PDF 4x6","value":"PDF_4x6","note":"4x6 inch label PDF"}]}
   */
  getLabelFileTypesDictionary(payload) {
    return { items: this.#applySearch(STATIC_DICTIONARIES.labelFileTypes, payload?.search) }
  }

  /**
   * @typedef {Object} getCarriersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","required":false,"description":"Search text used to narrow returned items by label or value."}
   */

  /**
   * @operationName Get Carriers Dictionary
   * @description Returns the common Shippo carrier tokens used in tracking and rate operations.
   * @route POST /getCarriersDictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getCarriersDictionary__payload","label":"Payload","name":"payload","description":"Dictionary payload containing search."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"USPS","value":"usps","note":"United States Postal Service"}]}
   */
  getCarriersDictionary(payload) {
    return { items: this.#applySearch(STATIC_DICTIONARIES.carriers, payload?.search) }
  }

  /**
   * @typedef {Object} getCurrenciesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","required":false,"description":"Search text used to narrow returned items by label or value."}
   */

  /**
   * @operationName Get Currencies Dictionary
   * @description Returns common ISO 4217 currency codes for use in customs declarations and rate conversions.
   * @route POST /getCurrenciesDictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getCurrenciesDictionary__payload","label":"Payload","name":"payload","description":"Dictionary payload containing search."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"USD - United States Dollar","value":"USD","note":"United States"}]}
   */
  getCurrenciesDictionary(payload) {
    return { items: this.#applySearch(STATIC_DICTIONARIES.currencies, payload?.search) }
  }

  /**
   * @typedef {Object} getCountriesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","required":false,"description":"Search text used to narrow returned items by label or value."}
   */

  /**
   * @operationName Get Countries Dictionary
   * @description Returns ISO 3166-1 alpha-2 country codes for common shipping origins and destinations.
   * @route POST /getCountriesDictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getCountriesDictionary__payload","label":"Payload","name":"payload","description":"Dictionary payload containing search."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"United States","value":"US","note":"North America"}]}
   */
  getCountriesDictionary(payload) {
    return { items: this.#applySearch(STATIC_DICTIONARIES.countries, payload?.search) }
  }

  /**
   * @typedef {Object} getContentsTypesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","required":false,"description":"Search text used to narrow returned items by label or value."}
   */

  /**
   * @operationName Get Contents Types Dictionary
   * @description Returns the contents types accepted on customs declarations.
   * @route POST /getContentsTypesDictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getContentsTypesDictionary__payload","label":"Payload","name":"payload","description":"Dictionary payload containing search."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Merchandise","value":"MERCHANDISE","note":"Commercial goods"}]}
   */
  getContentsTypesDictionary(payload) {
    return { items: this.#applySearch(STATIC_DICTIONARIES.contentsTypes, payload?.search) }
  }

  /**
   * @typedef {Object} getNonDeliveryOptionsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","required":false,"description":"Search text used to narrow returned items by label or value."}
   */

  /**
   * @operationName Get Non-Delivery Options Dictionary
   * @description Returns the non-delivery options used on customs declarations to instruct carriers when delivery fails.
   * @route POST /getNonDeliveryOptionsDictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getNonDeliveryOptionsDictionary__payload","label":"Payload","name":"payload","description":"Dictionary payload containing search."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Return to Sender","value":"RETURN","note":"Return at sender expense"}]}
   */
  getNonDeliveryOptionsDictionary(payload) {
    return { items: this.#applySearch(STATIC_DICTIONARIES.nonDeliveryOptions, payload?.search) }
  }

  /**
   * @typedef {Object} getIncotermsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","required":false,"description":"Search text used to narrow returned items by label or value."}
   */

  /**
   * @operationName Get Incoterms Dictionary
   * @description Returns the international commercial terms supported on Shippo customs declarations.
   * @route POST /getIncotermsDictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getIncotermsDictionary__payload","label":"Payload","name":"payload","description":"Dictionary payload containing search."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"DDP - Delivered Duty Paid","value":"DDP","note":"Sender covers all duties and taxes"}]}
   */
  getIncotermsDictionary(payload) {
    return { items: this.#applySearch(STATIC_DICTIONARIES.incoterms, payload?.search) }
  }

  /**
   * @typedef {Object} getEELPFCsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","required":false,"description":"Search text used to narrow returned items by label or value."}
   */

  /**
   * @operationName Get EEL PFC Codes Dictionary
   * @description Returns Electronic Export Information (EEI) Proof of Filing Citations supported by Shippo for US international shipments.
   * @route POST /getEELPFCsDictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getEELPFCsDictionary__payload","label":"Payload","name":"payload","description":"Dictionary payload containing search."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"NOEEI 30.37(a)","value":"NOEEI_30_37_a","note":"Shipments under USD 2500 to non-restricted destinations"}]}
   */
  getEELPFCsDictionary(payload) {
    return { items: this.#applySearch(STATIC_DICTIONARIES.eelPfcs, payload?.search) }
  }

  /**
   * @typedef {Object} getOrderStatusesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","required":false,"description":"Search text used to narrow returned items by label or value."}
   */

  /**
   * @operationName Get Order Statuses Dictionary
   * @description Returns the order status values used by Shippo orders.
   * @route POST /getOrderStatusesDictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getOrderStatusesDictionary__payload","label":"Payload","name":"payload","description":"Dictionary payload containing search."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Paid","value":"PAID","note":"Order paid and ready to fulfill"}]}
   */
  getOrderStatusesDictionary(payload) {
    return { items: this.#applySearch(STATIC_DICTIONARIES.orderStatuses, payload?.search) }
  }

  /**
   * @typedef {Object} getServiceLevelsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Carrier","name":"carrier","required":false,"description":"Lower-case Shippo carrier token (for example usps, fedex, ups) used to filter the returned service levels."}
   */

  /**
   * @typedef {Object} getServiceLevelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","required":false,"description":"Search text used to narrow returned items by label or value."}
   * @paramDef {"type":"getServiceLevelsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":false,"description":"Dependent criteria used to filter results by carrier."}
   */

  /**
   * @operationName Get Service Levels Dictionary
   * @description Returns Shippo service levels filtered by the selected carrier. When no carrier is provided returns service levels for all major carriers.
   * @route POST /getServiceLevelsDictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getServiceLevelsDictionary__payload","label":"Payload","name":"payload","description":"Dictionary payload containing search and carrier criteria."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"USPS Priority Mail","value":"usps_priority","note":"usps"}]}
   */
  getServiceLevelsDictionary(payload) {
    payload = payload || {}

    const carrier = payload.criteria?.carrier
    const map = STATIC_DICTIONARIES.serviceLevelsByCarrier

    let items = []

    if (carrier && map[carrier]) {
      items = map[carrier].map(item => ({ ...item, note: carrier }))
    } else {
      items = Object.entries(map)
        .flatMap(([carrierKey, levels]) => levels.map(level => ({ ...level, note: carrierKey })))
    }

    return { items: this.#applySearch(items, payload.search) }
  }

  /* =========================================================================
   * Schema loaders - sub-forms for Object params
   * =======================================================================*/

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /address-schema
   * @paramDef {"type":"Object","label":"Criteria","name":"criteria"}
   * @returns {Object}
   */
  async addressSchema() {
    return [
      { type: 'String', label: 'Name', name: 'name', required: true, description: 'First and last name of the contact at the address.' },
      { type: 'String', label: 'Company', name: 'company', required: false, description: 'Company name of the contact at the address.' },
      { type: 'String', label: 'Street Line 1', name: 'street1', required: true, description: 'Primary street address (number and street name).' },
      { type: 'String', label: 'Street Line 2', name: 'street2', required: false, description: 'Apartment, suite, or unit number.' },
      { type: 'String', label: 'City', name: 'city', required: true, description: 'City of the address.' },
      { type: 'String', label: 'State', name: 'state', required: false, description: 'Two-letter state or province code (required for US, Canada and Australia).' },
      { type: 'String', label: 'ZIP / Postal Code', name: 'zip', required: false, description: 'Postal code (required for many destinations including the US).' },
      { type: 'String', label: 'Country', name: 'country', required: true, dictionary: 'getCountriesDictionary', description: 'ISO 3166-1 alpha-2 country code (for example US, CA, GB).' },
      { type: 'String', label: 'Phone', name: 'phone', required: false, description: 'Phone number in international format. Required by some carriers for international shipments.' },
      { type: 'String', label: 'Email', name: 'email', required: false, description: 'Email address used by carriers for delivery notifications.' },
    ]
  }

  /* =========================================================================
   * Addresses
   * =======================================================================*/

  /**
   * @description Creates a new address record in your Shippo account. When validation is enabled Shippo immediately validates the address and returns the validation_results object alongside the saved address.
   * @route POST /createAddress
   *
   * @operationName Create Address
   * @category Addresses
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"First and last name of the contact at the address."}
   * @paramDef {"type":"String","label":"Company","name":"company","required":false,"description":"Company name of the contact at the address."}
   * @paramDef {"type":"String","label":"Street Line 1","name":"street1","required":true,"description":"Primary street address (number and street name)."}
   * @paramDef {"type":"String","label":"Street Line 2","name":"street2","required":false,"description":"Apartment, suite, or unit number."}
   * @paramDef {"type":"String","label":"Street Line 3","name":"street3","required":false,"description":"Additional street information used in some international formats."}
   * @paramDef {"type":"String","label":"City","name":"city","required":true,"description":"City of the address."}
   * @paramDef {"type":"String","label":"State","name":"state","required":false,"description":"Two-letter state or province code (required for US, Canada and Australia)."}
   * @paramDef {"type":"String","label":"ZIP / Postal Code","name":"zip","required":false,"description":"Postal code (required for many destinations including the US)."}
   * @paramDef {"type":"String","label":"Country","name":"country","required":true,"dictionary":"getCountriesDictionary","description":"ISO 3166-1 alpha-2 country code (for example US, CA, GB)."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","required":false,"description":"Phone number in international format. Required by some carriers for international shipments."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":false,"description":"Email address used by carriers for delivery notifications."}
   * @paramDef {"type":"Boolean","label":"Is Residential","name":"isResidential","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"Set to true if the address is a residence. Affects pricing for some carriers."}
   * @paramDef {"type":"Boolean","label":"Validate","name":"validate","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"When true Shippo validates the address and returns validation_results in the response."}
   *
   * @returns {Address}
   * @sampleResult {"object_id":"d799c2679e644279b59fe661ac8fa488","object_state":"VALID","object_purpose":"PURCHASE","name":"Mr. Hippo","company":"Shippo","street1":"215 Clayton St.","street2":"","city":"San Francisco","state":"CA","zip":"94117","country":"US","phone":"+1 555 341 9393","email":"support@goshippo.com","is_residential":false,"validation_results":{"is_valid":true,"messages":[]}}
   */
  async createAddress(name, company, street1, street2, street3, city, state, zip, country, phone, email, isResidential, validate) {
    const payload = {
      name,
      company,
      street1,
      street2,
      street3,
      city,
      state,
      zip,
      country,
      phone,
      email,
      is_residential: isResidential,
      validate: validate === true,
    }

    return this.#apiRequest({ method: 'post', endpoint: '/addresses', payload })
  }

  /**
   * @description Lists previously created addresses with pagination. Use to retrieve saved senders and recipients.
   * @route POST /listAddresses
   *
   * @operationName List Addresses
   * @category Addresses
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Results Per Page","name":"results","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of items per page (1-100). Defaults to 25."}
   *
   * @returns {ShippoListResponse}
   * @sampleResult {"count":1,"next":null,"previous":null,"results":[{"object_id":"d799c2679e644279b59fe661ac8fa488","object_state":"VALID","name":"Mr. Hippo","company":"Shippo","street1":"215 Clayton St.","city":"San Francisco","state":"CA","zip":"94117","country":"US"}]}
   */
  async listAddresses(page, results) {
    return this.#apiRequest({ method: 'get', endpoint: '/addresses', query: this.#buildPaging(page, results) })
  }

  /**
   * @description Retrieves a single address by its Shippo object identifier.
   * @route POST /getAddress
   *
   * @operationName Get Address
   * @category Addresses
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Address ID","name":"addressId","required":true,"dictionary":"getAddressesDictionary","description":"The Shippo object_id of the address to retrieve."}
   *
   * @returns {Address}
   * @sampleResult {"object_id":"d799c2679e644279b59fe661ac8fa488","object_state":"VALID","name":"Mr. Hippo","street1":"215 Clayton St.","city":"San Francisco","state":"CA","zip":"94117","country":"US"}
   */
  async getAddress(addressId) {
    return this.#apiRequest({ method: 'get', endpoint: `/addresses/${ encodeURIComponent(addressId) }` })
  }

  /**
   * @description Validates an existing address against carrier databases and returns validation_results indicating whether the address is deliverable.
   * @route POST /validateAddress
   *
   * @operationName Validate Address
   * @category Addresses
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Address ID","name":"addressId","required":true,"dictionary":"getAddressesDictionary","description":"The Shippo object_id of the address to validate."}
   *
   * @returns {Address}
   * @sampleResult {"object_id":"d799c2679e644279b59fe661ac8fa488","object_state":"VALID","validation_results":{"is_valid":true,"messages":[{"source":"USPS","code":"address_corrected","text":"The address as submitted has been corrected."}]}}
   */
  async validateAddress(addressId) {
    return this.#apiRequest({
      method: 'get',
      endpoint: `/addresses/${ encodeURIComponent(addressId) }/validate`,
    })
  }

  /* =========================================================================
   * Parcels
   * =======================================================================*/

  /**
   * @description Creates a parcel describing the dimensions and weight of a package. Provide either explicit dimensions or a Shippo predefined package template token.
   * @route POST /createParcel
   *
   * @operationName Create Parcel
   * @category Parcels
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Length","name":"length","required":true,"description":"Length of the parcel as a string (for example 10 or 10.5)."}
   * @paramDef {"type":"String","label":"Width","name":"width","required":true,"description":"Width of the parcel as a string."}
   * @paramDef {"type":"String","label":"Height","name":"height","required":true,"description":"Height of the parcel as a string."}
   * @paramDef {"type":"String","label":"Distance Unit","name":"distanceUnit","required":true,"dictionary":"getDistanceUnitsDictionary","description":"Unit for length, width and height (in, cm, ft, mm, m, yd)."}
   * @paramDef {"type":"String","label":"Weight","name":"weight","required":true,"description":"Weight of the parcel as a string (for example 2 or 2.75)."}
   * @paramDef {"type":"String","label":"Mass Unit","name":"massUnit","required":true,"dictionary":"getMassUnitsDictionary","description":"Unit for the parcel weight (g, oz, lb, kg)."}
   * @paramDef {"type":"String","label":"Template","name":"template","required":false,"description":"Optional Shippo predefined package token (for example USPS_FlatRateGiftCardEnvelope). When provided, dimensions can match the template and Shippo will use that packaging."}
   *
   * @returns {Parcel}
   * @sampleResult {"object_id":"7df2ecf8b4224763ab7c71fae7ec8274","object_state":"VALID","length":"10","width":"5","height":"2","distance_unit":"in","weight":"1.5","mass_unit":"lb","template":null}
   */
  async createParcel(length, width, height, distanceUnit, weight, massUnit, template) {
    const payload = {
      length,
      width,
      height,
      distance_unit: distanceUnit,
      weight,
      mass_unit: massUnit,
      template: template || null,
    }

    return this.#apiRequest({ method: 'post', endpoint: '/parcels', payload })
  }

  /**
   * @description Lists previously created parcels with pagination.
   * @route POST /listParcels
   *
   * @operationName List Parcels
   * @category Parcels
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Results Per Page","name":"results","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of items per page (1-100). Defaults to 25."}
   *
   * @returns {ShippoListResponse}
   * @sampleResult {"count":1,"next":null,"previous":null,"results":[{"object_id":"7df2ecf8b4224763ab7c71fae7ec8274","length":"10","width":"5","height":"2","distance_unit":"in","weight":"1.5","mass_unit":"lb"}]}
   */
  async listParcels(page, results) {
    return this.#apiRequest({ method: 'get', endpoint: '/parcels', query: this.#buildPaging(page, results) })
  }

  /**
   * @description Retrieves a single parcel by its Shippo object identifier.
   * @route POST /getParcel
   *
   * @operationName Get Parcel
   * @category Parcels
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Parcel ID","name":"parcelId","required":true,"dictionary":"getParcelsDictionary","description":"The Shippo object_id of the parcel to retrieve."}
   *
   * @returns {Parcel}
   * @sampleResult {"object_id":"7df2ecf8b4224763ab7c71fae7ec8274","object_state":"VALID","length":"10","width":"5","height":"2","distance_unit":"in","weight":"1.5","mass_unit":"lb"}
   */
  async getParcel(parcelId) {
    return this.#apiRequest({ method: 'get', endpoint: `/parcels/${ encodeURIComponent(parcelId) }` })
  }

  /* =========================================================================
   * Shipments
   * =======================================================================*/

  /**
   * @description Creates a shipment from existing addresses and parcels (or inline address/parcel objects) and triggers Shippo to fetch live rates from your connected carriers. Pass async=true to defer rate fetching for large shipments.
   * @route POST /createShipment
   *
   * @operationName Create Shipment
   * @category Shipments
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Object","label":"Address From","name":"addressFrom","required":true,"schemaLoader":"addressSchema","description":"Sender address. Fill the address sub-form, or wire a complete Address object (for example the output of Create Address or Get Address)."}
   * @paramDef {"type":"Object","label":"Address To","name":"addressTo","required":true,"schemaLoader":"addressSchema","description":"Recipient address. Fill the address sub-form, or wire a complete Address object (for example the output of Create Address or Get Address)."}
   * @paramDef {"type":"Array<Object>","label":"Parcels","name":"parcels","required":true,"description":"Array of parcels in the shipment. Each entry can be either a parcel object_id string or an inline parcel object describing dimensions and weight."}
   * @paramDef {"type":"String","label":"Customs Declaration ID","name":"customsDeclaration","required":false,"dictionary":"getCustomsDeclarationsDictionary","description":"Optional Shippo object_id of a customs declaration. Required for international non-document shipments."}
   * @paramDef {"type":"Object","label":"Extra","name":"extra","required":false,"description":"Optional carrier extras passed through to Shippo, as a JSON object. Which keys apply and their shape vary by carrier, and several values are themselves nested objects (for example {\"signature_confirmation\":\"ADULT\",\"insurance\":{\"amount\":\"100\",\"currency\":\"USD\"},\"reference_1\":\"PO-123\"}), so there is no fixed sub-form."}
   * @paramDef {"type":"Boolean","label":"Async","name":"async","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"When true Shippo returns immediately with status QUEUED and resolves rates in the background."}
   *
   * @returns {Shipment}
   * @sampleResult {"object_id":"adcfdddf8ec64b84ad22772bce3ea37a","status":"SUCCESS","address_from":{"object_id":"d799c2679e644279b59fe661ac8fa488","name":"Mr. Hippo","city":"San Francisco","state":"CA","zip":"94117","country":"US"},"address_to":{"object_id":"4f406a13253945a8bf3d180ef1d9b4ac","name":"Ms. Hippo","city":"Las Vegas","state":"NV","zip":"89109","country":"US"},"parcels":[{"object_id":"7df2ecf8b4224763ab7c71fae7ec8274"}],"rates":[{"object_id":"545ab0a1a6ea4c9f9adb2512f9e66d05","amount":"5.50","currency":"USD","provider":"USPS","servicelevel_token":"usps_priority","servicelevel_name":"Priority Mail","estimated_days":2}]}
   */
  async createShipment(addressFrom, addressTo, parcels, customsDeclaration, extra, async) {
    const payload = {
      address_from: addressFrom,
      address_to: addressTo,
      parcels: Array.isArray(parcels) ? parcels : [parcels].filter(Boolean),
      async: async === true,
    }

    if (customsDeclaration) {
      payload.customs_declaration = customsDeclaration
    }

    if (extra) {
      payload.extra = extra
    }

    return this.#apiRequest({ method: 'post', endpoint: '/shipments', payload })
  }

  /**
   * @description Lists previously created shipments with pagination.
   * @route POST /listShipments
   *
   * @operationName List Shipments
   * @category Shipments
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Results Per Page","name":"results","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of items per page (1-100). Defaults to 25."}
   *
   * @returns {ShippoListResponse}
   * @sampleResult {"count":1,"next":null,"previous":null,"results":[{"object_id":"adcfdddf8ec64b84ad22772bce3ea37a","status":"SUCCESS","rates":[{"object_id":"545ab0a1a6ea4c9f9adb2512f9e66d05","amount":"5.50"}]}]}
   */
  async listShipments(page, results) {
    return this.#apiRequest({ method: 'get', endpoint: '/shipments', query: this.#buildPaging(page, results) })
  }

  /**
   * @description Retrieves a single shipment by its Shippo object identifier including all rates calculated for it.
   * @route POST /getShipment
   *
   * @operationName Get Shipment
   * @category Shipments
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Shipment ID","name":"shipmentId","required":true,"dictionary":"getShipmentsDictionary","description":"The Shippo object_id of the shipment to retrieve."}
   *
   * @returns {Shipment}
   * @sampleResult {"object_id":"adcfdddf8ec64b84ad22772bce3ea37a","status":"SUCCESS","rates":[{"object_id":"545ab0a1a6ea4c9f9adb2512f9e66d05","amount":"5.50","provider":"USPS"}]}
   */
  async getShipment(shipmentId) {
    return this.#apiRequest({ method: 'get', endpoint: `/shipments/${ encodeURIComponent(shipmentId) }` })
  }

  /**
   * @description Returns the rates for a shipment, optionally converted to a different currency.
   * @route POST /getShipmentRates
   *
   * @operationName Get Shipment Rates
   * @category Shipments
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Shipment ID","name":"shipmentId","required":true,"dictionary":"getShipmentsDictionary","description":"The Shippo object_id of the shipment whose rates should be retrieved."}
   * @paramDef {"type":"String","label":"Currency Code","name":"currencyCode","required":false,"dictionary":"getCurrenciesDictionary","description":"Optional ISO currency code (for example USD, EUR). When provided rates are converted to this currency using Shippo's daily exchange rates."}
   * @paramDef {"type":"Number","label":"Page","name":"page","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number for paginated rate results. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Results Per Page","name":"results","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of rates per page (1-100). Defaults to 25."}
   *
   * @returns {ShippoListResponse}
   * @sampleResult {"count":2,"next":null,"previous":null,"results":[{"object_id":"545ab0a1a6ea4c9f9adb2512f9e66d05","amount":"5.50","currency":"USD","provider":"USPS","servicelevel_token":"usps_priority","estimated_days":2}]}
   */
  async getShipmentRates(shipmentId, currencyCode, page, results) {
    const segments = [`/shipments/${ encodeURIComponent(shipmentId) }/rates`]

    if (currencyCode) {
      segments.push(`/${ encodeURIComponent(currencyCode) }`)
    }

    return this.#apiRequest({
      method: 'get',
      endpoint: segments.join(''),
      query: this.#buildPaging(page, results),
    })
  }

  /* =========================================================================
   * Rates
   * =======================================================================*/

  /**
   * @description Retrieves a single rate by its Shippo object identifier. Use to inspect the rate metadata before purchasing a label.
   * @route POST /getRate
   *
   * @operationName Get Rate
   * @category Rates
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Rate ID","name":"rateId","required":true,"description":"The Shippo object_id of the rate to retrieve. Rates belong to a shipment and are not independently listable, so take this from the rates array returned by Create Shipment or Get Shipment Rates."}
   *
   * @returns {Rate}
   * @sampleResult {"object_id":"545ab0a1a6ea4c9f9adb2512f9e66d05","amount":"5.50","currency":"USD","provider":"USPS","servicelevel_token":"usps_priority","servicelevel_name":"Priority Mail","estimated_days":2,"attributes":["CHEAPEST"]}
   */
  async getRate(rateId) {
    return this.#apiRequest({ method: 'get', endpoint: `/rates/${ encodeURIComponent(rateId) }` })
  }

  /* =========================================================================
   * Transactions / Labels
   * =======================================================================*/

  /**
   * @description Purchases a shipping label from a previously calculated rate. Returns a transaction containing the label_url, tracking_number and tracking_url_provider when status is SUCCESS.
   * @route POST /createTransaction
   *
   * @operationName Create Transaction (Buy Label)
   * @category Transactions
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Rate ID","name":"rateId","required":true,"description":"The Shippo object_id of the rate to purchase. Rates belong to a shipment and are not independently listable, so take this from the rates array returned by Create Shipment or Get Shipment Rates."}
   * @paramDef {"type":"String","label":"Label File Type","name":"labelFileType","required":false,"dictionary":"getLabelFileTypesDictionary","description":"Output format for the generated label. Defaults to the carrier account default when omitted."}
   * @paramDef {"type":"String","label":"Metadata","name":"metadata","required":false,"description":"Optional reference string echoed back on the transaction (max 100 characters)."}
   * @paramDef {"type":"Boolean","label":"Async","name":"async","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"When true Shippo returns immediately with status QUEUED and processes the purchase in the background."}
   *
   * @returns {Transaction}
   * @sampleResult {"object_id":"915d94940ea54c3a80cbfa328722f5a1","status":"SUCCESS","object_state":"VALID","rate":"545ab0a1a6ea4c9f9adb2512f9e66d05","tracking_number":"9499907123456123456781","tracking_url_provider":"https://tools.usps.com/go/TrackConfirmAction.action?tLabels=9499907123456123456781","tracking_status":"UNKNOWN","label_url":"https://shippo-delivery.s3.amazonaws.com/example.pdf","commercial_invoice_url":null,"messages":[]}
   */
  async createTransaction(rateId, labelFileType, metadata, async) {
    const payload = {
      rate: rateId,
      label_file_type: labelFileType || null,
      metadata: metadata || null,
      async: async === true,
    }

    return this.#apiRequest({ method: 'post', endpoint: '/transactions', payload })
  }

  /**
   * @description Lists transactions (purchased labels) with optional filters.
   * @route POST /listTransactions
   *
   * @operationName List Transactions
   * @category Transactions
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Results Per Page","name":"results","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of items per page (1-100). Defaults to 25."}
   * @paramDef {"type":"String","label":"Rate ID","name":"rate","required":false,"description":"Filter to transactions for this rate object_id."}
   * @paramDef {"type":"String","label":"Carrier Account ID","name":"carrierAccount","required":false,"dictionary":"getCarrierAccountsDictionary","description":"Filter to transactions purchased through this carrier account."}
   * @paramDef {"type":"String","label":"Object Status","name":"objectStatus","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Success","Error","Queued","Waiting","Refunded","Refund Pending","Refund Rejected"]}},"description":"Filter by transaction object_status."}
   * @paramDef {"type":"String","label":"Tracking Status","name":"trackingStatus","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Unknown","Pre-Transit","In Transit","Delivered","Returned","Failure"]}},"description":"Filter by tracking_status."}
   *
   * @returns {ShippoListResponse}
   * @sampleResult {"count":1,"next":null,"previous":null,"results":[{"object_id":"915d94940ea54c3a80cbfa328722f5a1","status":"SUCCESS","tracking_number":"9499907123456123456781","label_url":"https://shippo-delivery.s3.amazonaws.com/example.pdf"}]}
   */
  async listTransactions(page, results, rate, carrierAccount, objectStatus, trackingStatus) {
    const query = this.#buildPaging(page, results)

    objectStatus = this.#resolveChoice(objectStatus, {
      Success: 'SUCCESS',
      Error: 'ERROR',
      Queued: 'QUEUED',
      Waiting: 'WAITING',
      Refunded: 'REFUNDED',
      'Refund Pending': 'REFUNDPENDING',
      'Refund Rejected': 'REFUNDREJECTED',
    })

    trackingStatus = this.#resolveChoice(trackingStatus, {
      Unknown: 'UNKNOWN',
      'Pre-Transit': 'PRE_TRANSIT',
      'In Transit': 'TRANSIT',
      Delivered: 'DELIVERED',
      Returned: 'RETURNED',
      Failure: 'FAILURE',
    })

    if (rate) query.rate = rate
    if (carrierAccount) query.carrier_account = carrierAccount
    if (objectStatus) query.object_status = objectStatus
    if (trackingStatus) query.tracking_status = trackingStatus

    return this.#apiRequest({ method: 'get', endpoint: '/transactions', query })
  }

  /**
   * @description Retrieves a single transaction (purchased label) by its Shippo object identifier.
   * @route POST /getTransaction
   *
   * @operationName Get Transaction
   * @category Transactions
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Transaction ID","name":"transactionId","required":true,"dictionary":"getTransactionsDictionary","description":"The Shippo object_id of the transaction to retrieve."}
   *
   * @returns {Transaction}
   * @sampleResult {"object_id":"915d94940ea54c3a80cbfa328722f5a1","status":"SUCCESS","tracking_number":"9499907123456123456781","label_url":"https://shippo-delivery.s3.amazonaws.com/example.pdf"}
   */
  async getTransaction(transactionId) {
    return this.#apiRequest({ method: 'get', endpoint: `/transactions/${ encodeURIComponent(transactionId) }` })
  }

  /* =========================================================================
   * Batches
   * =======================================================================*/

  /**
   * @typedef {Object} BatchShipment
   * @paramDef {"type":"Object","label":"Shipment","name":"shipment","required":true,"description":"The shipment to rate and label. Provide address_from and address_to (each a saved address object_id string or an inline address object) and parcels (an array of parcel object_id strings or inline parcel objects)."}
   * @paramDef {"type":"String","label":"Carrier Account ID","name":"carrier_account","required":false,"dictionary":"getCarrierAccountsDictionary","description":"Optional per-shipment carrier account object_id. Overrides the batch default for this one shipment."}
   * @paramDef {"type":"String","label":"Service Level Token","name":"servicelevel_token","required":false,"dictionary":"getServiceLevelsDictionary","description":"Optional per-shipment Shippo service level token (for example usps_priority). Overrides the batch default for this one shipment."}
   * @paramDef {"type":"String","label":"Metadata","name":"metadata","required":false,"description":"Optional reference string echoed back on this batch shipment."}
   */

  /**
   * @description Creates a batch to buy shipping labels for many shipments at once. Shippo validates the batch asynchronously, so the response starts in status VALIDATING - poll Get Batch until it reaches VALID, then call Purchase Batch.
   * @route POST /createBatch
   *
   * @operationName Create Batch
   * @category Batches
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Default Carrier Account ID","name":"defaultCarrierAccount","required":true,"dictionary":"getCarrierAccountsDictionary","description":"The Shippo object_id of the carrier account used by default for every shipment in the batch that does not name its own."}
   * @paramDef {"type":"String","label":"Default Service Level Token","name":"defaultServicelevelToken","required":true,"dictionary":"getServiceLevelsDictionary","description":"Shippo service level token (for example usps_priority) used by default for every shipment in the batch that does not name its own."}
   * @paramDef {"type":"Array<BatchShipment>","label":"Batch Shipments","name":"batchShipments","required":true,"description":"Array of shipments to include in the batch. Each entry has a shipment (address_from, address_to, parcels) plus optional per-shipment carrier_account and servicelevel_token that override the batch defaults."}
   * @paramDef {"type":"String","label":"Label File Type","name":"labelFileType","required":false,"dictionary":"getLabelFileTypesDictionary","description":"Output format for the generated labels. Defaults to the format configured in the Shippo dashboard when omitted."}
   * @paramDef {"type":"String","label":"Metadata","name":"metadata","required":false,"description":"Optional reference string echoed back on the batch (max 100 characters)."}
   *
   * @returns {Batch}
   * @sampleResult {"object_id":"c6937c15a99440758b75cde7f18e2a0d","status":"VALIDATING","default_carrier_account":"b741b99f95e841639b54272834bcdd40","default_servicelevel_token":"usps_priority","label_filetype":"PDF_4x6","label_url":[],"metadata":"BATCH #170","object_results":{"creation_failed":0,"creation_succeeded":0,"purchase_failed":0,"purchase_succeeded":0},"batch_shipments":{"count":0,"next":null,"previous":null,"results":[]},"object_owner":"support@goshippo.com"}
   */
  async createBatch(defaultCarrierAccount, defaultServicelevelToken, batchShipments, labelFileType, metadata) {
    const payload = {
      default_carrier_account: defaultCarrierAccount,
      default_servicelevel_token: defaultServicelevelToken,
      batch_shipments: Array.isArray(batchShipments) ? batchShipments : [batchShipments].filter(Boolean),
    }

    if (labelFileType) {
      payload.label_filetype = labelFileType
    }

    if (metadata) {
      payload.metadata = metadata
    }

    return this.#apiRequest({ method: 'post', endpoint: '/batches', payload })
  }

  /**
   * @description Retrieves a batch by its Shippo object_id. The object_results counts show validation and purchase progress and batch_shipments lists each shipment's status. Use it to poll an async batch until status is VALID (ready to purchase) or PURCHASED (labels ready in label_url).
   * @route POST /getBatch
   *
   * @operationName Get Batch
   * @category Batches
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Batch ID","name":"batchId","required":true,"description":"The Shippo object_id of the batch to retrieve. Shippo has no list-batches endpoint, so take this from the output of Create Batch."}
   * @paramDef {"type":"Number","label":"Page","name":"page","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number of the batch_shipments sub-list to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Results Per Page","name":"results","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of batch shipments per page (1-100). Defaults to 5."}
   *
   * @returns {Batch}
   * @sampleResult {"object_id":"c6937c15a99440758b75cde7f18e2a0d","status":"VALID","default_carrier_account":"b741b99f95e841639b54272834bcdd40","default_servicelevel_token":"usps_priority","label_filetype":"PDF_4x6","label_url":[],"metadata":"BATCH #170","object_results":{"creation_failed":0,"creation_succeeded":2,"purchase_failed":0,"purchase_succeeded":0},"batch_shipments":{"count":2,"next":null,"previous":null,"results":[{"object_id":"40f2cf49a3464614b998cc0eb61e768d","status":"VALID","carrier_account":"b741b99f95e841639b54272834bcdd40","servicelevel_token":"usps_priority","shipment":"6a2579a51e4f4e49a5eb5d9c6853bd39","transaction":null,"messages":[]}]},"object_owner":"support@goshippo.com"}
   */
  async getBatch(batchId, page, results) {
    return this.#apiRequest({
      method: 'get',
      endpoint: `/batches/${ encodeURIComponent(batchId) }`,
      query: this.#buildPaging(page, results),
    })
  }

  /**
   * @description Purchases every valid shipment in a batch, generating all the shipping labels in one call. The batch moves to status PURCHASING and then PURCHASED - poll Get Batch until label_url holds the combined label documents.
   * @route POST /purchaseBatch
   *
   * @operationName Purchase Batch
   * @category Batches
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Batch ID","name":"batchId","required":true,"description":"The Shippo object_id of the batch to purchase. Take this from the output of Create Batch. The batch must be in status VALID."}
   *
   * @returns {Batch}
   * @sampleResult {"object_id":"c6937c15a99440758b75cde7f18e2a0d","status":"PURCHASING","default_carrier_account":"b741b99f95e841639b54272834bcdd40","default_servicelevel_token":"usps_priority","label_filetype":"PDF_4x6","label_url":[],"metadata":"BATCH #170","object_results":{"creation_failed":0,"creation_succeeded":2,"purchase_failed":0,"purchase_succeeded":0},"batch_shipments":{"count":2,"next":null,"previous":null,"results":[]},"object_owner":"support@goshippo.com"}
   */
  async purchaseBatch(batchId) {
    return this.#apiRequest({
      method: 'post',
      endpoint: `/batches/${ encodeURIComponent(batchId) }/purchase`,
    })
  }

  /**
   * @description Adds one or more shipments to an existing batch. Send the same shipment entries you would pass to Create Batch; Shippo validates them asynchronously and updates the batch's object_results counts.
   * @route POST /addShipmentsToBatch
   *
   * @operationName Add Shipments to Batch
   * @category Batches
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Batch ID","name":"batchId","required":true,"description":"The Shippo object_id of the batch to add shipments to. Take this from the output of Create Batch."}
   * @paramDef {"type":"Array<BatchShipment>","label":"Batch Shipments","name":"batchShipments","required":true,"description":"Array of shipments to add. Each entry has a shipment (address_from, address_to, parcels) plus optional per-shipment carrier_account and servicelevel_token."}
   *
   * @returns {Batch}
   * @sampleResult {"object_id":"c6937c15a99440758b75cde7f18e2a0d","status":"VALIDATING","default_carrier_account":"b741b99f95e841639b54272834bcdd40","default_servicelevel_token":"usps_priority","label_filetype":"PDF_4x6","label_url":[],"metadata":"BATCH #170","object_results":{"creation_failed":0,"creation_succeeded":2,"purchase_failed":0,"purchase_succeeded":0},"batch_shipments":{"count":3,"next":null,"previous":null,"results":[]},"object_owner":"support@goshippo.com"}
   */
  async addShipmentsToBatch(batchId, batchShipments) {
    const payload = Array.isArray(batchShipments) ? batchShipments : [batchShipments].filter(Boolean)

    return this.#apiRequest({
      method: 'post',
      endpoint: `/batches/${ encodeURIComponent(batchId) }/add_shipments`,
      payload,
    })
  }

  /**
   * @description Removes shipments from a batch by their batch-shipment object_ids. Each id is the object_id of an entry in the batch's batch_shipments list (from Get Batch), not the underlying shipment object_id. Returns the updated batch.
   * @route POST /removeShipmentsFromBatch
   *
   * @operationName Remove Shipments from Batch
   * @category Batches
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Batch ID","name":"batchId","required":true,"description":"The Shippo object_id of the batch to remove shipments from. Take this from the output of Create Batch."}
   * @paramDef {"type":"Array<String>","label":"Batch Shipment IDs","name":"batchShipmentIds","required":true,"description":"Array of batch-shipment object_ids to remove. Each is the object_id of an entry in the batch's batch_shipments list (from Get Batch), not the underlying shipment object_id. A comma-separated string is also accepted."}
   *
   * @returns {Batch}
   * @sampleResult {"object_id":"c6937c15a99440758b75cde7f18e2a0d","status":"VALIDATING","default_carrier_account":"b741b99f95e841639b54272834bcdd40","default_servicelevel_token":"usps_priority","label_filetype":"PDF_4x6","label_url":[],"metadata":"BATCH #170","object_results":{"creation_failed":0,"creation_succeeded":1,"purchase_failed":0,"purchase_succeeded":0},"batch_shipments":{"count":1,"next":null,"previous":null,"results":[]},"object_owner":"support@goshippo.com"}
   */
  async removeShipmentsFromBatch(batchId, batchShipmentIds) {
    const payload = Array.isArray(batchShipmentIds)
      ? batchShipmentIds
      : String(batchShipmentIds || '').split(',').map(id => id.trim()).filter(Boolean)

    return this.#apiRequest({
      method: 'post',
      endpoint: `/batches/${ encodeURIComponent(batchId) }/remove_shipments`,
      payload,
    })
  }

  /* =========================================================================
   * Tracking
   * =======================================================================*/

  /**
   * @description Registers a tracker so Shippo begins polling the carrier and emitting tracking webhooks for the supplied carrier and tracking number.
   * @route POST /createTracker
   *
   * @operationName Create Tracker
   * @category Tracking
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Carrier","name":"carrier","required":true,"dictionary":"getCarriersDictionary","description":"Lower-case Shippo carrier token (for example usps, fedex, ups)."}
   * @paramDef {"type":"String","label":"Tracking Number","name":"trackingNumber","required":true,"description":"The carrier tracking number to register."}
   * @paramDef {"type":"String","label":"Metadata","name":"metadata","required":false,"description":"Optional reference string echoed back on tracker events (max 100 characters)."}
   *
   * @returns {Tracker}
   * @sampleResult {"carrier":"usps","tracking_number":"9499907123456123456781","tracking_status":{"status":"TRANSIT","status_details":"Your shipment has been accepted.","status_date":"2024-04-12T12:00:00Z","location":{"city":"San Francisco","state":"CA","zip":"94117","country":"US"}},"tracking_history":[],"eta":"2024-04-15T18:00:00Z","servicelevel":{"name":"Priority Mail","token":"usps_priority"}}
   */
  async createTracker(carrier, trackingNumber, metadata) {
    const payload = {
      carrier,
      tracking_number: trackingNumber,
      metadata: metadata || null,
    }

    return this.#apiRequest({ method: 'post', endpoint: '/tracks', payload })
  }

  /**
   * @description Retrieves the latest tracking status and history for a carrier + tracking number combination.
   * @route POST /getTrackingStatus
   *
   * @operationName Get Tracking Status
   * @category Tracking
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Carrier","name":"carrier","required":true,"dictionary":"getCarriersDictionary","description":"Lower-case Shippo carrier token (for example usps, fedex, ups)."}
   * @paramDef {"type":"String","label":"Tracking Number","name":"trackingNumber","required":true,"description":"The carrier tracking number to look up."}
   *
   * @returns {Tracker}
   * @sampleResult {"carrier":"usps","tracking_number":"9499907123456123456781","tracking_status":{"status":"DELIVERED","status_details":"Your shipment has been delivered at the destination.","status_date":"2024-04-15T15:30:00Z","location":{"city":"Las Vegas","state":"NV","zip":"89109","country":"US"}},"tracking_history":[{"status":"PRE_TRANSIT","status_date":"2024-04-12T08:00:00Z"},{"status":"TRANSIT","status_date":"2024-04-13T14:00:00Z"},{"status":"DELIVERED","status_date":"2024-04-15T15:30:00Z"}],"eta":"2024-04-15T18:00:00Z"}
   */
  async getTrackingStatus(carrier, trackingNumber) {
    return this.#apiRequest({
      method: 'get',
      endpoint: `/tracks/${ encodeURIComponent(carrier) }/${ encodeURIComponent(trackingNumber) }`,
    })
  }

  /* =========================================================================
   * Refunds
   * =======================================================================*/

  /**
   * @description Requests a refund for a purchased label transaction. Async refunds return immediately with status QUEUED.
   * @route POST /createRefund
   *
   * @operationName Create Refund
   * @category Refunds
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Transaction ID","name":"transactionId","required":true,"dictionary":"getTransactionsDictionary","description":"The Shippo object_id of the transaction (label) to refund."}
   * @paramDef {"type":"Boolean","label":"Async","name":"async","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"When true Shippo processes the refund asynchronously and returns immediately with status QUEUED."}
   *
   * @returns {Refund}
   * @sampleResult {"object_id":"d24c5179d3214f098cc0797fc2b1450c","status":"QUEUED","transaction":"915d94940ea54c3a80cbfa328722f5a1"}
   */
  async createRefund(transactionId, async) {
    const payload = {
      transaction: transactionId,
      async: async === true,
    }

    return this.#apiRequest({ method: 'post', endpoint: '/refunds', payload })
  }

  /**
   * @description Lists previously requested refunds with pagination.
   * @route POST /listRefunds
   *
   * @operationName List Refunds
   * @category Refunds
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Results Per Page","name":"results","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of items per page (1-100). Defaults to 25."}
   *
   * @returns {ShippoListResponse}
   * @sampleResult {"count":1,"next":null,"previous":null,"results":[{"object_id":"d24c5179d3214f098cc0797fc2b1450c","status":"SUCCESS","transaction":"915d94940ea54c3a80cbfa328722f5a1"}]}
   */
  async listRefunds(page, results) {
    return this.#apiRequest({ method: 'get', endpoint: '/refunds', query: this.#buildPaging(page, results) })
  }

  /**
   * @description Retrieves a single refund by its Shippo object identifier.
   * @route POST /getRefund
   *
   * @operationName Get Refund
   * @category Refunds
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Refund ID","name":"refundId","required":true,"dictionary":"getRefundsDictionary","description":"The Shippo object_id of the refund to retrieve."}
   *
   * @returns {Refund}
   * @sampleResult {"object_id":"d24c5179d3214f098cc0797fc2b1450c","status":"SUCCESS","transaction":"915d94940ea54c3a80cbfa328722f5a1"}
   */
  async getRefund(refundId) {
    return this.#apiRequest({ method: 'get', endpoint: `/refunds/${ encodeURIComponent(refundId) }` })
  }

  /* =========================================================================
   * Manifests
   * =======================================================================*/

  /**
   * @description Creates a carrier end-of-day manifest covering one or more transactions. Required by some carriers (notably USPS) to scan and pick up the day's shipments.
   * @route POST /createManifest
   *
   * @operationName Create Manifest
   * @category Manifests
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Carrier Account ID","name":"carrierAccount","required":true,"dictionary":"getCarrierAccountsDictionary","description":"The Shippo object_id of the carrier account that will accept the manifest."}
   * @paramDef {"type":"String","label":"Shipment Date","name":"shipmentDate","required":true,"description":"Pickup or shipment date in ISO 8601 format (for example 2024-04-12T08:00:00Z)."}
   * @paramDef {"type":"String","label":"Address From ID","name":"addressFrom","required":true,"description":"The Shippo object_id of the address from which the carrier will pick up the shipments."}
   * @paramDef {"type":"Array<String>","label":"Transaction IDs","name":"transactions","required":true,"description":"Array of Shippo transaction object_ids to include in the manifest."}
   * @paramDef {"type":"Boolean","label":"Async","name":"async","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"When true the manifest is created asynchronously; the response returns immediately with status QUEUED."}
   *
   * @returns {Manifest}
   * @sampleResult {"object_id":"f2e10b27797642e6b22b97c0a51d8221","status":"SUCCESS","carrier_account":"b741b99f95e841639b54272834bcdd40","shipment_date":"2024-04-12T08:00:00Z","address_from":"d799c2679e644279b59fe661ac8fa488","transactions":["915d94940ea54c3a80cbfa328722f5a1"],"documents":["https://shippo-delivery.s3.amazonaws.com/manifests/example.pdf"]}
   */
  async createManifest(carrierAccount, shipmentDate, addressFrom, transactions, async) {
    const payload = {
      carrier_account: carrierAccount,
      shipment_date: shipmentDate,
      address_from: addressFrom,
      transactions: Array.isArray(transactions) ? transactions : [transactions].filter(Boolean),
      async: async === true,
    }

    return this.#apiRequest({ method: 'post', endpoint: '/manifests', payload })
  }

  /**
   * @description Lists previously created manifests with pagination.
   * @route POST /listManifests
   *
   * @operationName List Manifests
   * @category Manifests
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Results Per Page","name":"results","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of items per page (1-100). Defaults to 25."}
   *
   * @returns {ShippoListResponse}
   * @sampleResult {"count":1,"next":null,"previous":null,"results":[{"object_id":"f2e10b27797642e6b22b97c0a51d8221","status":"SUCCESS","shipment_date":"2024-04-12T08:00:00Z"}]}
   */
  async listManifests(page, results) {
    return this.#apiRequest({ method: 'get', endpoint: '/manifests', query: this.#buildPaging(page, results) })
  }

  /**
   * @description Retrieves a single manifest by its Shippo object identifier.
   * @route POST /getManifest
   *
   * @operationName Get Manifest
   * @category Manifests
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Manifest ID","name":"manifestId","required":true,"dictionary":"getManifestsDictionary","description":"The Shippo object_id of the manifest to retrieve."}
   *
   * @returns {Manifest}
   * @sampleResult {"object_id":"f2e10b27797642e6b22b97c0a51d8221","status":"SUCCESS","shipment_date":"2024-04-12T08:00:00Z","documents":["https://shippo-delivery.s3.amazonaws.com/manifests/example.pdf"]}
   */
  async getManifest(manifestId) {
    return this.#apiRequest({ method: 'get', endpoint: `/manifests/${ encodeURIComponent(manifestId) }` })
  }

  /* =========================================================================
   * Customs Items
   * =======================================================================*/

  /**
   * @description Creates a customs item describing a single line of an international customs declaration.
   * @route POST /createCustomsItem
   *
   * @operationName Create Customs Item
   * @category Customs
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Description","name":"description","required":true,"description":"Plain language description of the item (max 60 characters for some carriers)."}
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of identical units of this item."}
   * @paramDef {"type":"String","label":"Net Weight","name":"netWeight","required":true,"description":"Weight of a single unit, as a string (for example 0.5)."}
   * @paramDef {"type":"String","label":"Mass Unit","name":"massUnit","required":true,"dictionary":"getMassUnitsDictionary","description":"Unit for the net_weight (g, oz, lb, kg)."}
   * @paramDef {"type":"String","label":"Value Amount","name":"valueAmount","required":true,"description":"Declared value of a single unit, as a string (for example 19.99)."}
   * @paramDef {"type":"String","label":"Value Currency","name":"valueCurrency","required":true,"dictionary":"getCurrenciesDictionary","description":"ISO currency code for the declared value (for example USD)."}
   * @paramDef {"type":"String","label":"Origin Country","name":"originCountry","required":true,"dictionary":"getCountriesDictionary","description":"ISO 3166-1 alpha-2 country code where the item was manufactured."}
   * @paramDef {"type":"String","label":"Tariff Number","name":"tariffNumber","required":false,"description":"Optional carrier-specific harmonized tariff classification number."}
   * @paramDef {"type":"String","label":"SKU Code","name":"skuCode","required":false,"description":"Optional SKU code for the item."}
   * @paramDef {"type":"String","label":"HS Code","name":"hsCode","required":false,"description":"Optional Harmonized System code identifying the item internationally."}
   * @paramDef {"type":"String","label":"Metadata","name":"metadata","required":false,"description":"Optional reference string echoed back on the customs item."}
   *
   * @returns {CustomsItem}
   * @sampleResult {"object_id":"55358464c7b740aca199b395536981bd","description":"T-Shirt","quantity":"2","net_weight":"0.5","mass_unit":"lb","value_amount":"19.99","value_currency":"USD","origin_country":"US","tariff_number":"6109.10","sku_code":"TS-001","hs_code":"610910","metadata":"order #1234"}
   */
  async createCustomsItem(description, quantity, netWeight, massUnit, valueAmount, valueCurrency, originCountry, tariffNumber, skuCode, hsCode, metadata) {
    const payload = {
      description,
      quantity,
      net_weight: netWeight,
      mass_unit: massUnit,
      value_amount: valueAmount,
      value_currency: valueCurrency,
      origin_country: originCountry,
      tariff_number: tariffNumber || null,
      sku_code: skuCode || null,
      hs_code: hsCode || null,
      metadata: metadata || null,
    }

    return this.#apiRequest({ method: 'post', endpoint: '/customs/items', payload })
  }

  /**
   * @description Lists previously created customs items with pagination.
   * @route POST /listCustomsItems
   *
   * @operationName List Customs Items
   * @category Customs
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Results Per Page","name":"results","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of items per page (1-100). Defaults to 25."}
   *
   * @returns {ShippoListResponse}
   * @sampleResult {"count":1,"next":null,"previous":null,"results":[{"object_id":"55358464c7b740aca199b395536981bd","description":"T-Shirt","quantity":"2"}]}
   */
  async listCustomsItems(page, results) {
    return this.#apiRequest({ method: 'get', endpoint: '/customs/items', query: this.#buildPaging(page, results) })
  }

  /**
   * @description Retrieves a single customs item by its Shippo object identifier.
   * @route POST /getCustomsItem
   *
   * @operationName Get Customs Item
   * @category Customs
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Customs Item ID","name":"customsItemId","required":true,"dictionary":"getCustomsItemsDictionary","description":"The Shippo object_id of the customs item to retrieve."}
   *
   * @returns {CustomsItem}
   * @sampleResult {"object_id":"55358464c7b740aca199b395536981bd","description":"T-Shirt","quantity":"2","value_amount":"19.99","value_currency":"USD","origin_country":"US"}
   */
  async getCustomsItem(customsItemId) {
    return this.#apiRequest({ method: 'get', endpoint: `/customs/items/${ encodeURIComponent(customsItemId) }` })
  }

  /* =========================================================================
   * Customs Declarations
   * =======================================================================*/

  /**
   * @description Creates a customs declaration grouping previously created customs items into a complete document attachable to international shipments.
   * @route POST /createCustomsDeclaration
   *
   * @operationName Create Customs Declaration
   * @category Customs
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Contents Type","name":"contentsType","required":true,"dictionary":"getContentsTypesDictionary","description":"Type of contents being shipped (DOCUMENTS, MERCHANDISE, GIFT, etc.)."}
   * @paramDef {"type":"String","label":"Contents Explanation","name":"contentsExplanation","required":false,"description":"Required when contents_type is OTHER. Free-text description of the contents."}
   * @paramDef {"type":"String","label":"Non-Delivery Option","name":"nonDeliveryOption","required":true,"dictionary":"getNonDeliveryOptionsDictionary","description":"Carrier instruction when delivery fails (RETURN or ABANDON)."}
   * @paramDef {"type":"Boolean","label":"Certify","name":"certify","required":true,"uiComponent":{"type":"CHECKBOX"},"description":"Must be true to certify that the information on the declaration is accurate."}
   * @paramDef {"type":"String","label":"Certify Signer","name":"certifySigner","required":true,"description":"Name of the person certifying the declaration. Required when certify is true."}
   * @paramDef {"type":"Array<String>","label":"Customs Item IDs","name":"items","required":true,"description":"Array of Shippo customs item object_ids to include on the declaration."}
   * @paramDef {"type":"String","label":"Incoterm","name":"incoterm","required":false,"dictionary":"getIncotermsDictionary","description":"Optional Incoterm controlling who pays duties and taxes."}
   * @paramDef {"type":"String","label":"EEL / PFC","name":"eelPfc","required":false,"dictionary":"getEELPFCsDictionary","description":"Optional Electronic Export Information citation for US international shipments."}
   * @paramDef {"type":"String","label":"B13A Filing Option","name":"b13aFilingOption","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Filed Electronically","Summary Reporting","Not Required"]}},"description":"Optional B13A filing option for Canadian exports."}
   * @paramDef {"type":"String","label":"B13A Number","name":"b13aNumber","required":false,"description":"Optional B13A filing reference number."}
   *
   * @returns {CustomsDeclaration}
   * @sampleResult {"object_id":"adcfdddf8ec64b84ad22772bce3ea37a","status":"VALID","contents_type":"MERCHANDISE","contents_explanation":"","non_delivery_option":"RETURN","certify":true,"certify_signer":"Mr. Hippo","items":["55358464c7b740aca199b395536981bd"],"incoterm":"DDP","eel_pfc":"NOEEI_30_37_a"}
   */
  async createCustomsDeclaration(contentsType, contentsExplanation, nonDeliveryOption, certify, certifySigner, items, incoterm, eelPfc, b13aFilingOption, b13aNumber) {
    const payload = {
      contents_type: contentsType,
      contents_explanation: contentsExplanation || '',
      non_delivery_option: nonDeliveryOption,
      certify: certify === true,
      certify_signer: certifySigner,
      items: Array.isArray(items) ? items : [items].filter(Boolean),
    }

    b13aFilingOption = this.#resolveChoice(b13aFilingOption, {
      'Filed Electronically': 'FILED_ELECTRONICALLY',
      'Summary Reporting': 'SUMMARY_REPORTING',
      'Not Required': 'NOT_REQUIRED',
    })

    if (incoterm) payload.incoterm = incoterm
    if (eelPfc) payload.eel_pfc = eelPfc
    if (b13aFilingOption) payload.b13a_filing_option = b13aFilingOption
    if (b13aNumber) payload.b13a_number = b13aNumber

    return this.#apiRequest({ method: 'post', endpoint: '/customs/declarations', payload })
  }

  /**
   * @description Lists previously created customs declarations with pagination.
   * @route POST /listCustomsDeclarations
   *
   * @operationName List Customs Declarations
   * @category Customs
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Results Per Page","name":"results","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of items per page (1-100). Defaults to 25."}
   *
   * @returns {ShippoListResponse}
   * @sampleResult {"count":1,"next":null,"previous":null,"results":[{"object_id":"adcfdddf8ec64b84ad22772bce3ea37a","status":"VALID","contents_type":"MERCHANDISE"}]}
   */
  async listCustomsDeclarations(page, results) {
    return this.#apiRequest({
      method: 'get',
      endpoint: '/customs/declarations',
      query: this.#buildPaging(page, results),
    })
  }

  /**
   * @description Retrieves a single customs declaration by its Shippo object identifier.
   * @route POST /getCustomsDeclaration
   *
   * @operationName Get Customs Declaration
   * @category Customs
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Customs Declaration ID","name":"customsDeclarationId","required":true,"dictionary":"getCustomsDeclarationsDictionary","description":"The Shippo object_id of the customs declaration to retrieve."}
   *
   * @returns {CustomsDeclaration}
   * @sampleResult {"object_id":"adcfdddf8ec64b84ad22772bce3ea37a","status":"VALID","contents_type":"MERCHANDISE","items":["55358464c7b740aca199b395536981bd"]}
   */
  async getCustomsDeclaration(customsDeclarationId) {
    return this.#apiRequest({
      method: 'get',
      endpoint: `/customs/declarations/${ encodeURIComponent(customsDeclarationId) }`,
    })
  }

  /* =========================================================================
   * Carrier Accounts
   * =======================================================================*/

  /**
   * @description Lists carrier accounts connected to the authenticated Shippo account. In test mode this typically returns Shippo's default test accounts (USPS, FedEx, DHL Express).
   * @route POST /listCarrierAccounts
   *
   * @operationName List Carrier Accounts
   * @category Carrier Accounts
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Carrier","name":"carrier","required":false,"dictionary":"getCarriersDictionary","description":"Optional carrier token used to filter the returned accounts."}
   * @paramDef {"type":"Boolean","label":"Include Service Levels","name":"serviceLevels","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"When true Shippo includes service-level information in the response."}
   * @paramDef {"type":"Number","label":"Page","name":"page","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Results Per Page","name":"results","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of items per page (1-100). Defaults to 25."}
   *
   * @returns {ShippoListResponse}
   * @sampleResult {"count":1,"next":null,"previous":null,"results":[{"object_id":"b741b99f95e841639b54272834bcdd40","carrier":"usps","account_id":"shippo_USPS","active":true,"is_shippo_account":true}]}
   */
  async listCarrierAccounts(carrier, serviceLevels, page, results) {
    const query = this.#buildPaging(page, results)

    if (carrier) query.carrier = carrier
    if (serviceLevels) query.service_levels = true

    return this.#apiRequest({ method: 'get', endpoint: '/carrier_accounts', query })
  }

  /**
   * @description Retrieves a single carrier account by its Shippo object identifier.
   * @route POST /getCarrierAccount
   *
   * @operationName Get Carrier Account
   * @category Carrier Accounts
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Carrier Account ID","name":"carrierAccountId","required":true,"dictionary":"getCarrierAccountsDictionary","description":"The Shippo object_id of the carrier account to retrieve."}
   *
   * @returns {CarrierAccount}
   * @sampleResult {"object_id":"b741b99f95e841639b54272834bcdd40","carrier":"usps","account_id":"shippo_USPS","active":true,"is_shippo_account":true,"parameters":{}}
   */
  async getCarrierAccount(carrierAccountId) {
    return this.#apiRequest({
      method: 'get',
      endpoint: `/carrier_accounts/${ encodeURIComponent(carrierAccountId) }`,
    })
  }

  /**
   * @description Connects one of your own carrier accounts (USPS, FedEx, UPS, DHL and others) to Shippo so its negotiated rates and labels become available. Carrier login credentials go in the carrier-specific parameters object.
   * @route POST /createCarrierAccount
   *
   * @operationName Create Carrier Account
   * @category Carrier Accounts
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Carrier","name":"carrier","required":true,"dictionary":"getCarriersDictionary","description":"Lower-case Shippo carrier token for the account (for example ups, fedex, dhl_express)."}
   * @paramDef {"type":"String","label":"Account ID","name":"accountId","required":true,"description":"Your account number with the carrier (not a Shippo object_id) - type it in. Shippo masks this value in every API response."}
   * @paramDef {"type":"Object","label":"Parameters","name":"parameters","required":false,"description":"Carrier-specific credentials and settings as a JSON object. Which keys apply varies by carrier (for example FedEx needs first_name, last_name, phone_number and an address; UPS differs), so there is no fixed sub-form - see Shippo's carrier accounts guide for the keys each carrier expects."}
   * @paramDef {"type":"Boolean","label":"Active","name":"active","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"Whether Shippo uses this account when fetching rates. Defaults to true."}
   * @paramDef {"type":"String","label":"Metadata","name":"metadata","required":false,"description":"Optional reference string echoed back on the carrier account."}
   *
   * @returns {CarrierAccount}
   * @sampleResult {"object_id":"3a2c8f8d7d8c4f0a9d5e6b7c8a9b0c1d","carrier":"fedex","account_id":"****","parameters":{},"active":true,"is_shippo_account":false,"test":false,"metadata":""}
   */
  async createCarrierAccount(carrier, accountId, parameters, active, metadata) {
    const payload = {
      carrier,
      account_id: accountId,
    }

    if (parameters && typeof parameters === 'object') {
      payload.parameters = parameters
    }

    if (active !== undefined && active !== null) {
      payload.active = active === true
    }

    if (metadata) {
      payload.metadata = metadata
    }

    return this.#apiRequest({ method: 'post', endpoint: '/carrier_accounts', payload })
  }

  /**
   * @description Updates a connected carrier account - toggle it active or inactive, or refresh its carrier-specific credentials. The carrier and account_id together identify the account and cannot be changed.
   * @route POST /updateCarrierAccount
   *
   * @operationName Update Carrier Account
   * @category Carrier Accounts
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Carrier Account ID","name":"carrierAccountId","required":true,"dictionary":"getCarrierAccountsDictionary","description":"The Shippo object_id of the carrier account to update."}
   * @paramDef {"type":"Boolean","label":"Active","name":"active","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"Set false to deactivate the account so Shippo stops using it for rates, or true to reactivate it."}
   * @paramDef {"type":"Object","label":"Parameters","name":"parameters","required":false,"description":"Carrier-specific credentials to change, as a JSON object. Only the keys you send are updated; a key sent as null clears its stored value, and a masked field left as its six-asterisk placeholder is left unchanged. Keys vary by carrier."}
   * @paramDef {"type":"String","label":"Metadata","name":"metadata","required":false,"description":"Optional reference string to store on the carrier account."}
   *
   * @returns {CarrierAccount}
   * @sampleResult {"object_id":"b741b99f95e841639b54272834bcdd40","carrier":"fedex","account_id":"****","parameters":{},"active":false,"is_shippo_account":false,"test":false,"metadata":""}
   */
  async updateCarrierAccount(carrierAccountId, active, parameters, metadata) {
    const payload = {}

    if (active !== undefined && active !== null) {
      payload.active = active === true
    }

    if (parameters && typeof parameters === 'object') {
      payload.parameters = parameters
    }

    if (metadata !== undefined && metadata !== null) {
      payload.metadata = metadata
    }

    return this.#apiRequest({
      method: 'put',
      endpoint: `/carrier_accounts/${ encodeURIComponent(carrierAccountId) }`,
      payload,
    })
  }

  /* =========================================================================
   * Orders
   * =======================================================================*/

  /**
   * @description Lists Shippo orders with optional filters.
   * @route POST /listOrders
   *
   * @operationName List Orders
   * @category Orders
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Results Per Page","name":"results","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of items per page (1-100). Defaults to 25."}
   * @paramDef {"type":"String","label":"Order Status","name":"orderStatus","required":false,"dictionary":"getOrderStatusesDictionary","description":"Filter by order status (UNKNOWN, AWAITPAY, PAID, REFUNDED, CANCELLED, PARTIALLY_FULFILLED, SHIPPED)."}
   * @paramDef {"type":"String","label":"Search Query","name":"q","required":false,"description":"Optional case-insensitive substring filter applied across order number and customer fields."}
   *
   * @returns {ShippoListResponse}
   * @sampleResult {"count":1,"next":null,"previous":null,"results":[{"object_id":"4f2bc588e4e5446cb3f9fdb7cd5e190b","order_number":"#1068","order_status":"PAID","placed_at":"2024-04-12T15:05:21.622Z","total_price":"30.00"}]}
   */
  async listOrders(page, results, orderStatus, q) {
    const query = this.#buildPaging(page, results)

    if (orderStatus) query.order_status = orderStatus
    if (q) query.q = q

    return this.#apiRequest({ method: 'get', endpoint: '/orders', query })
  }

  /**
   * @description Retrieves a single Shippo order by its object identifier.
   * @route POST /getOrder
   *
   * @operationName Get Order
   * @category Orders
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Order ID","name":"orderId","required":true,"dictionary":"getOrdersDictionary","description":"The Shippo object_id of the order to retrieve."}
   *
   * @returns {Order}
   * @sampleResult {"object_id":"4f2bc588e4e5446cb3f9fdb7cd5e190b","order_number":"#1068","order_status":"PAID","placed_at":"2024-04-12T15:05:21.622Z","total_price":"30.00","line_items":[]}
   */
  async getOrder(orderId) {
    return this.#apiRequest({ method: 'get', endpoint: `/orders/${ encodeURIComponent(orderId) }` })
  }

  /**
   * @description Creates a Shippo order from external e-commerce data so it can later be fulfilled and shipped.
   * @route POST /createOrder
   *
   * @operationName Create Order
   * @category Orders
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Order Number","name":"orderNumber","required":true,"description":"Externally generated order number (for example #1068)."}
   * @paramDef {"type":"String","label":"Order Status","name":"orderStatus","required":true,"dictionary":"getOrderStatusesDictionary","description":"Order status (UNKNOWN, AWAITPAY, PAID, REFUNDED, CANCELLED, PARTIALLY_FULFILLED, SHIPPED)."}
   * @paramDef {"type":"Object","label":"To Address","name":"toAddress","required":true,"schemaLoader":"addressSchema","description":"Recipient address. Fill the address sub-form, or wire a complete Address object (for example the output of Create Address or Get Address)."}
   * @paramDef {"type":"Object","label":"From Address","name":"fromAddress","required":false,"schemaLoader":"addressSchema","description":"Optional sender address. Fill the address sub-form, or wire a complete Address object (for example the output of Create Address or Get Address)."}
   * @paramDef {"type":"Array<Object>","label":"Line Items","name":"lineItems","required":true,"description":"Array of line items in the order. Each item should include title, quantity, total_price, currency, weight and weight_unit."}
   * @paramDef {"type":"String","label":"Placed At","name":"placedAt","required":true,"description":"ISO 8601 timestamp when the order was placed (for example 2024-04-12T15:05:21Z)."}
   * @paramDef {"type":"String","label":"Total Price","name":"totalPrice","required":false,"description":"Order subtotal as a string (for example 30.00)."}
   * @paramDef {"type":"String","label":"Total Tax","name":"totalTax","required":false,"description":"Order tax amount as a string."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","required":false,"dictionary":"getCurrenciesDictionary","description":"ISO currency code for the order totals."}
   * @paramDef {"type":"String","label":"Weight","name":"weight","required":false,"description":"Total order weight as a string."}
   * @paramDef {"type":"String","label":"Weight Unit","name":"weightUnit","required":false,"dictionary":"getMassUnitsDictionary","description":"Unit for the order weight."}
   * @paramDef {"type":"String","label":"Shipping Cost","name":"shippingCost","required":false,"description":"Shipping cost charged to the customer, as a string."}
   * @paramDef {"type":"String","label":"Shipping Cost Currency","name":"shippingCostCurrency","required":false,"dictionary":"getCurrenciesDictionary","description":"ISO currency code for the shipping cost. Required by Shippo whenever a shipping cost is provided."}
   * @paramDef {"type":"String","label":"Shipping Method","name":"shippingMethod","required":false,"description":"Free-text shipping method name (for example USPS Priority Mail)."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","required":false,"description":"Optional order notes."}
   *
   * @returns {Order}
   * @sampleResult {"object_id":"4f2bc588e4e5446cb3f9fdb7cd5e190b","order_number":"#1068","order_status":"PAID","placed_at":"2024-04-12T15:05:21Z","total_price":"30.00","total_tax":"2.40","currency":"USD","weight":"1.5","weight_unit":"lb","shipping_cost":"5.50","shipping_cost_currency":"USD","shipping_method":"USPS Priority","line_items":[]}
   */
  async createOrder(orderNumber, orderStatus, toAddress, fromAddress, lineItems, placedAt, totalPrice, totalTax, currency, weight, weightUnit, shippingCost, shippingCostCurrency, shippingMethod, notes) {
    const payload = {
      order_number: orderNumber,
      order_status: orderStatus,
      to_address: toAddress,
      from_address: fromAddress || undefined,
      line_items: Array.isArray(lineItems) ? lineItems : [],
      placed_at: placedAt,
      total_price: totalPrice,
      total_tax: totalTax,
      currency,
      weight,
      weight_unit: weightUnit,
      shipping_cost: shippingCost,
      shipping_cost_currency: shippingCostCurrency,
      shipping_method: shippingMethod,
      notes,
    }

    return this.#apiRequest({ method: 'post', endpoint: '/orders', payload })
  }

  /* =========================================================================
   * Pickups
   * =======================================================================*/

  /**
   * @typedef {Object} PickupLocation
   * @paramDef {"type":"String","label":"Building Location Type","name":"building_location_type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Front Door","Back Door","Side Door","Knock on Door","Ring Bell","Reception","Office","Mail Room","In / At Mailbox","Security Deck (DHL Express only)","Shipping Dock (DHL Express only)","Other"]}},"description":"Where the parcels will be available for pickup. Security Deck and Shipping Dock are only supported for DHL Express."}
   * @paramDef {"type":"Object","label":"Address","name":"address","required":true,"description":"Pickup address. Provide either a Shippo address object_id (as a string) or a complete inline address object."}
   * @paramDef {"type":"String","label":"Building Type","name":"building_type","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Apartment","Building","Department","Floor","Room","Suite"]}},"description":"The type of building where the pickup is located."}
   * @paramDef {"type":"String","label":"Instructions","name":"instructions","required":false,"description":"Pickup instructions for the courier. Mandatory when Building Location Type is Other."}
   */

  /**
   * @description Schedules a carrier pickup for one or more transactions. Provide ISO 8601 timestamps for the requested pickup window and the carrier-specific location object.
   * @route POST /createPickup
   *
   * @operationName Create Pickup
   * @category Pickups
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Carrier Account ID","name":"carrierAccount","required":true,"dictionary":"getCarrierAccountsDictionary","description":"The Shippo object_id of the carrier account scheduling the pickup."}
   * @paramDef {"type":"PickupLocation","label":"Location","name":"location","required":true,"description":"Pickup location details including building_location_type (Front Door, Knock on Door, etc.), building_type, instructions and address (object_id or inline)."}
   * @paramDef {"type":"String","label":"Requested Start Time","name":"requestedStartTime","required":true,"description":"ISO 8601 timestamp for the earliest pickup time (for example 2024-04-12T08:00:00Z)."}
   * @paramDef {"type":"String","label":"Requested End Time","name":"requestedEndTime","required":true,"description":"ISO 8601 timestamp for the latest pickup time."}
   * @paramDef {"type":"Array<String>","label":"Transaction IDs","name":"transactions","required":true,"description":"Array of Shippo transaction object_ids to include in the pickup."}
   * @paramDef {"type":"Boolean","label":"Is Test","name":"isTest","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"When true Shippo treats the pickup as a test request and does not actually schedule with the carrier."}
   *
   * @returns {Pickup}
   * @sampleResult {"object_id":"e0cf70d568dc4e0c9d62c1eb6a78ec40","status":"SUCCESS","carrier_account":"b741b99f95e841639b54272834bcdd40","requested_start_time":"2024-04-12T08:00:00Z","requested_end_time":"2024-04-12T18:00:00Z","confirmation_code":"WTC310058750","location":{"building_location_type":"Front Door","building_type":"office","instructions":"Use side entrance"},"transactions":["915d94940ea54c3a80cbfa328722f5a1"]}
   */
  async createPickup(carrierAccount, location, requestedStartTime, requestedEndTime, transactions, isTest) {
    let resolvedLocation = location

    if (resolvedLocation && typeof resolvedLocation === 'object' && !Array.isArray(resolvedLocation)) {
      resolvedLocation = { ...resolvedLocation }

      if (resolvedLocation.building_location_type !== undefined && resolvedLocation.building_location_type !== null) {
        resolvedLocation.building_location_type = this.#resolveChoice(resolvedLocation.building_location_type, {
          'In / At Mailbox': 'In/At Mailbox',
          'Security Deck (DHL Express only)': 'Security Deck',
          'Shipping Dock (DHL Express only)': 'Shipping Dock',
        })
      }

      if (resolvedLocation.building_type !== undefined && resolvedLocation.building_type !== null) {
        resolvedLocation.building_type = this.#resolveChoice(resolvedLocation.building_type, {
          Apartment: 'apartment',
          Building: 'building',
          Department: 'department',
          Floor: 'floor',
          Room: 'room',
          Suite: 'suite',
        })
      }
    }

    const payload = {
      carrier_account: carrierAccount,
      location: resolvedLocation || {},
      requested_start_time: requestedStartTime,
      requested_end_time: requestedEndTime,
      transactions: Array.isArray(transactions) ? transactions : [transactions].filter(Boolean),
      is_test: isTest === true,
    }

    return this.#apiRequest({ method: 'post', endpoint: '/pickups', payload })
  }

  /**
   * @description Retrieves a single pickup by its Shippo object identifier.
   * @route POST /getPickup
   *
   * @operationName Get Pickup
   * @category Pickups
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Pickup ID","name":"pickupId","required":true,"description":"The Shippo object_id of the pickup to retrieve. Shippo has no list-pickups endpoint, so take this from the output of Create Pickup."}
   *
   * @returns {Pickup}
   * @sampleResult {"object_id":"e0cf70d568dc4e0c9d62c1eb6a78ec40","status":"SUCCESS","carrier_account":"b741b99f95e841639b54272834bcdd40","confirmation_code":"WTC310058750"}
   */
  async getPickup(pickupId) {
    return this.#apiRequest({ method: 'get', endpoint: `/pickups/${ encodeURIComponent(pickupId) }` })
  }

  /* =========================================================================
   * Service Groups
   * =======================================================================*/

  /**
   * @description Lists service groups configured on your Shippo account. Service groups bundle service levels for use on rate-at-checkout integrations.
   * @route POST /listServiceGroups
   *
   * @operationName List Service Groups
   * @category Service Groups
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 60
   *
   * @returns {Array<ServiceGroup>}
   * @sampleResult [{"object_id":"7f3e7a8e62094a8d9d08d7e8d27a2fbe","name":"USPS Domestic","type":"LIVE_RATE","description":"Live USPS rates","service_levels":[{"account_object_id":"b741b99f95e841639b54272834bcdd40","service_level_token":"usps_priority"}],"flat_rate":"5","flat_rate_currency":"USD","rate_adjustment":0,"is_active":true}]
   */
  async listServiceGroups() {
    return this.#apiRequest({ method: 'get', endpoint: '/service-groups' })
  }

  /**
   * @typedef {Object} ServiceGroupServiceLevel
   * @paramDef {"type":"String","label":"Carrier Account ID","name":"account_object_id","required":true,"dictionary":"getCarrierAccountsDictionary","description":"The Shippo object_id of the carrier account that offers this service level."}
   * @paramDef {"type":"String","label":"Service Level Token","name":"service_level_token","required":true,"dictionary":"getServiceLevelsDictionary","description":"Shippo service level token identifying the carrier service (for example usps_priority, fedex_ground)."}
   */

  /**
   * @description Creates a new service group bundling carrier service levels for live-rate, flat-rate or free-shipping checkout flows.
   * @route POST /createServiceGroup
   *
   * @operationName Create Service Group
   * @category Service Groups
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Display name for the service group shown to customers at checkout."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":true,"description":"Description shown to buyers at checkout."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Live Rate","Flat Rate","Free Shipping"]}},"description":"Pricing model. LIVE_RATE and FLAT_RATE both require Flat Rate and Flat Rate Currency (for LIVE_RATE the flat rate is the fallback returned when no live rate matches a service level). FREE_SHIPPING requires Free Shipping Threshold Min and Free Shipping Threshold Currency."}
   * @paramDef {"type":"Array<ServiceGroupServiceLevel>","label":"Service Levels","name":"serviceLevels","required":true,"description":"Array of service levels (each with account_object_id and service_level_token) to include in the group."}
   * @paramDef {"type":"String","label":"Flat Rate","name":"flatRate","required":false,"description":"Flat rate amount as a string (integers or decimals, for example 5 or 5.50). Required unless Type is FREE_SHIPPING."}
   * @paramDef {"type":"String","label":"Flat Rate Currency","name":"flatRateCurrency","required":false,"dictionary":"getCurrenciesDictionary","description":"ISO 4217 currency code for the flat rate (for example USD). Required unless Type is FREE_SHIPPING."}
   * @paramDef {"type":"String","label":"Free Shipping Threshold Min","name":"freeShippingThresholdMin","required":false,"description":"Minimum cart total (as a string) above which shipping is free. Required when Type is FREE_SHIPPING."}
   * @paramDef {"type":"String","label":"Free Shipping Threshold Currency","name":"freeShippingThresholdCurrency","required":false,"dictionary":"getCurrenciesDictionary","description":"ISO 4217 currency code for the free-shipping threshold (for example USD). Required when Type is FREE_SHIPPING."}
   * @paramDef {"type":"Number","label":"Rate Adjustment","name":"rateAdjustment","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Integer percent (%) applied to the returned rate. For example 5 adds 5% (a $5.00 rate becomes $5.25); negative values discount the rate. Omit for no adjustment."}
   *
   * @returns {ServiceGroup}
   * @sampleResult {"object_id":"7f3e7a8e62094a8d9d08d7e8d27a2fbe","name":"USPS Domestic","description":"Live USPS rates","type":"LIVE_RATE","service_levels":[{"account_object_id":"b741b99f95e841639b54272834bcdd40","service_level_token":"usps_priority"}],"flat_rate":"5","flat_rate_currency":"USD","rate_adjustment":0,"is_active":true}
   */
  async createServiceGroup(name, description, type, serviceLevels, flatRate, flatRateCurrency, freeShippingThresholdMin, freeShippingThresholdCurrency, rateAdjustment) {
    type = this.#resolveChoice(type, {
      'Live Rate': 'LIVE_RATE',
      'Flat Rate': 'FLAT_RATE',
      'Free Shipping': 'FREE_SHIPPING',
    })

    const payload = {
      name,
      description,
      type,
      service_levels: Array.isArray(serviceLevels) ? serviceLevels : [],
    }

    if (flatRate !== undefined && flatRate !== null && flatRate !== '') {
      payload.flat_rate = String(flatRate)
    }

    if (flatRateCurrency) {
      payload.flat_rate_currency = flatRateCurrency
    }

    if (freeShippingThresholdMin !== undefined && freeShippingThresholdMin !== null && freeShippingThresholdMin !== '') {
      payload.free_shipping_threshold_min = String(freeShippingThresholdMin)
    }

    if (freeShippingThresholdCurrency) {
      payload.free_shipping_threshold_currency = freeShippingThresholdCurrency
    }

    if (rateAdjustment !== undefined && rateAdjustment !== null && rateAdjustment !== '') {
      const rateAdjustmentPercent = parseInt(rateAdjustment, 10)

      if (Number.isNaN(rateAdjustmentPercent)) {
        throw new Error('Rate Adjustment must be an integer percent (for example 5 or -10).')
      }

      payload.rate_adjustment = rateAdjustmentPercent
    }

    return this.#apiRequest({ method: 'post', endpoint: '/service-groups', payload })
  }

  /**
   * @description Deletes a service group by its Shippo object identifier. Returns the deleted service group identifier on success.
   * @route POST /deleteServiceGroup
   *
   * @operationName Delete Service Group
   * @category Service Groups
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Service Group ID","name":"serviceGroupId","required":true,"dictionary":"getServiceGroupsDictionary","description":"The Shippo object_id of the service group to delete."}
   *
   * @returns {String}
   * @sampleResult "7f3e7a8e62094a8d9d08d7e8d27a2fbe"
   */
  async deleteServiceGroup(serviceGroupId) {
    await this.#apiRequest({
      method: 'delete',
      endpoint: `/service-groups/${ encodeURIComponent(serviceGroupId) }`,
    })

    return serviceGroupId
  }

  /* =========================================================================
   * Webhooks (administration)
   * =======================================================================*/

  /**
   * @description Lists webhook subscriptions registered on the authenticated Shippo account.
   * @route POST /listWebhooks
   *
   * @operationName List Webhooks
   * @category Webhooks
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 60
   *
   * @returns {ShippoListResponse}
   * @sampleResult {"count":1,"next":null,"previous":null,"results":[{"object_id":"abc12345abc12345abc12345abc12345","url":"https://example.com/webhook","event":"track_updated","is_test":false,"active":true}]}
   */
  async listWebhooks() {
    return this.#apiRequest({ method: 'get', endpoint: '/webhooks' })
  }

  /**
   * @description Retrieves a single webhook subscription by its Shippo object identifier.
   * @route POST /getWebhook
   *
   * @operationName Get Webhook
   * @category Webhooks
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Webhook ID","name":"webhookId","required":true,"dictionary":"getWebhooksDictionary","description":"The Shippo object_id of the webhook to retrieve."}
   *
   * @returns {Webhook}
   * @sampleResult {"object_id":"abc12345abc12345abc12345abc12345","url":"https://example.com/webhook","event":"track_updated","is_test":false,"active":true}
   */
  async getWebhook(webhookId) {
    return this.#apiRequest({
      method: 'get',
      endpoint: `/webhooks/${ encodeURIComponent(webhookId) }`,
    })
  }

  /**
   * @description Registers a webhook so Shippo POSTs a notification to your URL whenever the chosen event happens (a tracking update, a label transaction, or a batch change). Pair it with your own endpoint or the On Tracking Status Updated trigger.
   * @route POST /createWebhook
   *
   * @operationName Create Webhook
   * @category Webhooks
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"HTTPS URL that Shippo POSTs each event to."}
   * @paramDef {"type":"String","label":"Event","name":"event","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":[{"value":"track_updated","label":"Tracking Updated"},{"value":"transaction_created","label":"Transaction Created"},{"value":"transaction_updated","label":"Transaction Updated"},{"value":"batch_created","label":"Batch Created"},{"value":"batch_purchased","label":"Batch Purchased"},{"value":"all","label":"All Events"}]}},"description":"Which event triggers this webhook."}
   * @paramDef {"type":"Boolean","label":"Is Test","name":"isTest","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"When true the webhook only fires for objects created with a test API token. Defaults to false."}
   * @paramDef {"type":"Boolean","label":"Active","name":"active","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"Whether the webhook is active and receiving events. Defaults to true."}
   *
   * @returns {Webhook}
   * @sampleResult {"object_id":"abc12345abc12345abc12345abc12345","url":"https://example.com/shippo-webhook","event":"track_updated","is_test":false,"active":true,"object_created":"2024-04-12T08:00:00Z","object_updated":"2024-04-12T08:00:00Z","object_owner":"support@goshippo.com"}
   */
  async createWebhook(url, event, isTest, active) {
    const payload = {
      url,
      event,
      is_test: isTest === true,
    }

    if (active !== undefined && active !== null) {
      payload.active = active === true
    }

    return this.#apiRequest({ method: 'post', endpoint: '/webhooks', payload })
  }

  /**
   * @description Updates a registered webhook - change the destination URL, the event it listens for, or toggle it active. Shippo requires both URL and event on every update.
   * @route POST /updateWebhook
   *
   * @operationName Update Webhook
   * @category Webhooks
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Webhook ID","name":"webhookId","required":true,"dictionary":"getWebhooksDictionary","description":"The Shippo object_id of the webhook to update."}
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"HTTPS URL that Shippo POSTs each event to."}
   * @paramDef {"type":"String","label":"Event","name":"event","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":[{"value":"track_updated","label":"Tracking Updated"},{"value":"transaction_created","label":"Transaction Created"},{"value":"transaction_updated","label":"Transaction Updated"},{"value":"batch_created","label":"Batch Created"},{"value":"batch_purchased","label":"Batch Purchased"},{"value":"all","label":"All Events"}]}},"description":"Which event triggers this webhook."}
   * @paramDef {"type":"Boolean","label":"Is Test","name":"isTest","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"When true the webhook only fires for objects created with a test API token."}
   * @paramDef {"type":"Boolean","label":"Active","name":"active","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"Whether the webhook is active and receiving events."}
   *
   * @returns {Webhook}
   * @sampleResult {"object_id":"abc12345abc12345abc12345abc12345","url":"https://example.com/shippo-webhook","event":"transaction_updated","is_test":false,"active":true,"object_created":"2024-04-12T08:00:00Z","object_updated":"2024-04-13T09:30:00Z","object_owner":"support@goshippo.com"}
   */
  async updateWebhook(webhookId, url, event, isTest, active) {
    const payload = {
      url,
      event,
      is_test: isTest === true,
    }

    if (active !== undefined && active !== null) {
      payload.active = active === true
    }

    return this.#apiRequest({
      method: 'put',
      endpoint: `/webhooks/${ encodeURIComponent(webhookId) }`,
      payload,
    })
  }

  /**
   * @description Deletes a registered webhook so Shippo stops sending it events.
   * @route POST /deleteWebhook
   *
   * @operationName Delete Webhook
   * @category Webhooks
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Webhook ID","name":"webhookId","required":true,"dictionary":"getWebhooksDictionary","description":"The Shippo object_id of the webhook to delete."}
   *
   * @returns {Object}
   * @sampleResult {"object_id":"abc12345abc12345abc12345abc12345","deleted":true}
   */
  async deleteWebhook(webhookId) {
    await this.#apiRequest({
      method: 'delete',
      endpoint: `/webhooks/${ encodeURIComponent(webhookId) }`,
    })

    return { object_id: webhookId, deleted: true }
  }

  /* =========================================================================
   * Polling Trigger
   * =======================================================================*/

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerPollingForEvent
   *
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation","description":"Polling invocation payload provided by FlowRunner."}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    const eventName = invocation?.eventName

    if (!eventName || typeof this[eventName] !== 'function') {
      throw new Error(`Unknown polling event "${ eventName }"`)
    }

    return this[eventName](invocation)
  }

  /**
   * @operationName On Tracking Status Updated
   * @description Polls Shippo for the current tracking status of a specific carrier and tracking number combination and emits an event whenever the status changes (UNKNOWN, PRE_TRANSIT, TRANSIT, DELIVERED, RETURNED, FAILURE).
   * @route POST /onTrackingUpdated
   *
   * @registerAs POLLING_TRIGGER
   * @category Tracking
   * @appearanceColor #10B97F #0E8C6B
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Carrier","name":"carrier","required":true,"dictionary":"getCarriersDictionary","description":"Lower-case Shippo carrier token (for example usps, fedex, ups)."}
   * @paramDef {"type":"String","label":"Tracking Number","name":"trackingNumber","required":true,"description":"Carrier tracking number to monitor."}
   *
   * @returns {Tracker}
   * @sampleResult {"carrier":"usps","tracking_number":"9499907123456123456781","tracking_status":{"status":"DELIVERED","status_details":"Your shipment has been delivered at the destination.","status_date":"2024-04-15T15:30:00Z","location":{"city":"Las Vegas","state":"NV","zip":"89109","country":"US"}},"tracking_history":[{"status":"PRE_TRANSIT","status_date":"2024-04-12T08:00:00Z"},{"status":"TRANSIT","status_date":"2024-04-13T14:00:00Z"},{"status":"DELIVERED","status_date":"2024-04-15T15:30:00Z"}],"eta":"2024-04-15T18:00:00Z","servicelevel":{"name":"Priority Mail","token":"usps_priority"}}
   */
  async onTrackingUpdated(invocation) {
    const triggerData = invocation?.triggerData || {}
    const { carrier, trackingNumber } = triggerData

    if (!carrier || !trackingNumber) {
      throw new Error('Both "carrier" and "trackingNumber" are required for the On Tracking Status Updated trigger.')
    }

    const tracker = await this.getTrackingStatus(carrier, trackingNumber)
    const currentStatus = tracker?.tracking_status?.status || null
    const currentStatusDate = tracker?.tracking_status?.status_date || null

    if (invocation?.learningMode) {
      logger.debug(`[onTrackingUpdated] learningMode status=${ currentStatus }`)

      return {
        events: [tracker],
        state: null,
      }
    }

    const previousState = invocation?.state || {}

    if (!previousState.status) {
      logger.debug(`[onTrackingUpdated] init state status=${ currentStatus }`)

      return {
        events: [],
        state: {
          status: currentStatus,
          statusDate: currentStatusDate,
        },
      }
    }

    const statusChanged = previousState.status !== currentStatus ||
      (currentStatusDate && previousState.statusDate !== currentStatusDate)

    logger.debug(`[onTrackingUpdated] previous=${ previousState.status } current=${ currentStatus } changed=${ statusChanged }`)

    return {
      events: statusChanged ? [tracker] : [],
      state: {
        status: currentStatus,
        statusDate: currentStatusDate,
      },
    }
  }
}

Flowrunner.ServerCode.addService(Shippo, [
  {
    displayName: 'API Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    name: 'apiKey',
    shared: false,
    hint: 'Get from https://apps.goshippo.com/settings/api. Test tokens start with "shippo_test_", live tokens start with "shippo_live_". Shippo auto-routes requests based on the prefix.',
  },
])
