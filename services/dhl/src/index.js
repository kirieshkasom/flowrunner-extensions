const logger = {
  info: (...args) => console.log('[DHL] info:', ...args),
  debug: (...args) => console.log('[DHL] debug:', ...args),
  error: (...args) => console.log('[DHL] error:', ...args),
  warn: (...args) => console.log('[DHL] warn:', ...args),
}

const API_BASE_URL = 'https://api-eu.dhl.com'

// Friendly dropdown label -> Shipment Tracking - Unified `service` API value.
const SERVICE_MAP = {
  'Express': 'express',
  'Parcel Germany': 'parcel-de',
  'eCommerce': 'ecommerce',
  'DGF (Global Forwarding)': 'dgf',
  'Parcel UK': 'parcel-uk',
  'Post Germany': 'post-de',
  'Same Day': 'sameday',
  'Freight': 'freight',
  'Parcel Netherlands': 'parcel-nl',
  'Parcel Poland': 'parcel-pl',
}

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
 * @integrationName DHL
 * @integrationIcon /icon.svg
 */
class DHLService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  // Maps a friendly dropdown label to its API value; passes through unknown values unchanged.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Single private request helper — all DHL API calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'DHL-API-Key': this.apiKey,
          'Accept': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      // DHL surfaces errors as RFC 7807 problem details: { status, title, detail }.
      const problem = error.body || {}
      const status = problem.status || error.status || error.statusCode
      const parts = [problem.title, problem.detail].filter(Boolean)
      const message = parts.length ? parts.join(' - ') : (error.message || 'Unknown error')

      logger.error(`${ logTag } - failed (${ status || 'n/a' }): ${ message }`)

      throw new Error(`DHL API error${ status ? ` [${ status }]` : '' }: ${ message }`)
    }
  }

  /**
   * @operationName Track Shipment
   * @category Tracking
   * @description Tracks a shipment across all DHL business units using the Shipment Tracking - Unified API. Provide a tracking number and, optionally, the specific DHL service to disambiguate when a number is shared across units. Returns a shipments array where each entry includes the current status, origin and destination, estimated delivery time, service details, and a chronological list of tracking events (timestamp, status code, description, and location). Returns a 404 when no tracking information is available for the number. Requires the API key to be subscribed to the "Shipment Tracking - Unified" product in the DHL Developer Portal.
   * @route GET /track/shipments
   * @appearanceColor #d50029 #fecc00
   *
   * @paramDef {"type":"String","label":"Tracking Number","name":"trackingNumber","required":true,"description":"The shipment tracking number to look up."}
   * @paramDef {"type":"String","label":"Service","name":"service","uiComponent":{"type":"DROPDOWN","options":{"values":["Express","Parcel Germany","eCommerce","DGF (Global Forwarding)","Parcel UK","Post Germany","Same Day","Freight","Parcel Netherlands","Parcel Poland"]}},"description":"Optional DHL business unit to target. Use when a tracking number is shared across services; leave empty to search across all units."}
   * @paramDef {"type":"String","label":"Requester Country Code","name":"requesterCountryCode","description":"Optional ISO 3166-1 alpha-2 country code of the requester (e.g. US, DE). Influences localized results and available detail."}
   * @paramDef {"type":"String","label":"Origin Country Code","name":"originCountryCode","description":"Optional ISO 3166-1 alpha-2 country code of the shipment origin (e.g. DE), used to disambiguate the tracking number."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Optional ISO 639-1 language code for event descriptions (e.g. en, de). Defaults to en."}
   *
   * @returns {Object}
   * @sampleResult {"shipments":[{"id":"00340434292135100186","service":"parcel-de","origin":{"address":{"countryCode":"DE","addressLocality":"Bonn"}},"destination":{"address":{"countryCode":"DE","addressLocality":"Cologne"}},"status":{"timestamp":"2026-07-13T14:32:00","statusCode":"transit","status":"In transit","location":{"address":{"addressLocality":"Cologne"}}},"details":{"product":{"productName":"PAKET"},"totalNumberOfPieces":1},"events":[{"timestamp":"2026-07-12T09:10:00","statusCode":"pre-transit","status":"Order data transmitted electronically","location":{"address":{"addressLocality":"Bonn"}}},{"timestamp":"2026-07-13T14:32:00","statusCode":"transit","status":"Shipment is in transit","location":{"address":{"addressLocality":"Cologne"}}}]}]}
   */
  async trackShipment(trackingNumber, service, requesterCountryCode, originCountryCode, language) {
    const logTag = '[trackShipment]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/track/shipments`,
      method: 'get',
      query: {
        trackingNumber,
        service: this.#resolveChoice(service, SERVICE_MAP),
        requesterCountryCode,
        originCountryCode,
        language,
      },
    })
  }

  /**
   * @operationName Find Locations by Address
   * @category Location Finder
   * @description Finds DHL service points, post offices, parcel lockers, and other locations near a postal address using the Location Finder API. Provide a country code and any combination of city, postal code, and street. Returns a locations array where each entry includes the location id, name, type, full address, geo-coordinates, distance, opening hours, and supported service types. Requires the API key to be subscribed to the "Location Finder" product in the DHL Developer Portal.
   * @route GET /location-finder/find-by-address
   * @appearanceColor #d50029 #fecc00
   *
   * @paramDef {"type":"String","label":"Country Code","name":"countryCode","required":true,"description":"ISO 3166-1 alpha-2 country code to search within (e.g. DE, GB, US)."}
   * @paramDef {"type":"String","label":"City / Locality","name":"addressLocality","description":"City or locality name to narrow the search (e.g. Bonn)."}
   * @paramDef {"type":"String","label":"Postal Code","name":"postalCode","description":"Postal / ZIP code to narrow the search."}
   * @paramDef {"type":"String","label":"Street Address","name":"streetAddress","description":"Street name and number to narrow the search."}
   * @paramDef {"type":"String","label":"Provider Type","name":"providerType","uiComponent":{"type":"DROPDOWN","options":{"values":["Parcel","Express"]}},"description":"Optional DHL network to filter by."}
   * @paramDef {"type":"String","label":"Location Type","name":"locationType","uiComponent":{"type":"DROPDOWN","options":{"values":["Service Point","Post Office","Postbank","Parcel Locker","PO Box","Post Box"]}},"description":"Optional type of location to return."}
   * @paramDef {"type":"Number","label":"Radius (meters)","name":"radius","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Search radius in meters (default 500, max 1000000)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of locations to return."}
   *
   * @returns {Object}
   * @sampleResult {"locations":[{"url":"/location-finder/v1/locations/8003-4008202","location":{"ids":[{"locationId":"8003-4008202","provider":"parcel"}],"keyword":"Postfiliale","keywordId":"502","type":"postoffice"},"name":"Postfiliale 502","distance":26,"place":{"address":{"countryCode":"DE","postalCode":"53113","addressLocality":"Bonn","streetAddress":"Charles-de-Gaulle-Str. 20"},"geo":{"latitude":50.7160101,"longitude":7.1298043}},"openingHours":[{"dayOfWeek":"http://schema.org/Monday","opens":"09:00","closes":"18:00"}],"serviceTypes":["parcel:pick-up","parcel:drop-off"]}]}
   */
  async findLocationsByAddress(countryCode, addressLocality, postalCode, streetAddress, providerType, locationType, radius, limit) {
    const logTag = '[findLocationsByAddress]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/location-finder/v1/find-by-address`,
      method: 'get',
      query: {
        countryCode,
        addressLocality,
        postalCode,
        streetAddress,
        providerType: this.#resolveChoice(providerType, { 'Parcel': 'parcel', 'Express': 'express' }),
        locationType: this.#resolveChoice(locationType, {
          'Service Point': 'servicepoint',
          'Post Office': 'postoffice',
          'Postbank': 'postbank',
          'Parcel Locker': 'locker',
          'PO Box': 'pobox',
          'Post Box': 'postbox',
        }),
        radius,
        limit,
      },
    })
  }

  /**
   * @operationName Find Locations by Geo
   * @category Location Finder
   * @description Finds DHL service points, post offices, parcel lockers, and other locations near a geographic coordinate using the Location Finder API. Provide latitude and longitude, and optionally a radius and result limit. Returns a locations array where each entry includes the location id, name, type, full address, geo-coordinates, distance, opening hours, and supported service types. Requires the API key to be subscribed to the "Location Finder" product in the DHL Developer Portal.
   * @route GET /location-finder/find-by-geo
   * @appearanceColor #d50029 #fecc00
   *
   * @paramDef {"type":"Number","label":"Latitude","name":"latitude","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Decimal latitude of the search center (e.g. 50.7160101)."}
   * @paramDef {"type":"Number","label":"Longitude","name":"longitude","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Decimal longitude of the search center (e.g. 7.1298043)."}
   * @paramDef {"type":"String","label":"Provider Type","name":"providerType","uiComponent":{"type":"DROPDOWN","options":{"values":["Parcel","Express"]}},"description":"Optional DHL network to filter by."}
   * @paramDef {"type":"String","label":"Location Type","name":"locationType","uiComponent":{"type":"DROPDOWN","options":{"values":["Service Point","Post Office","Postbank","Parcel Locker","PO Box","Post Box"]}},"description":"Optional type of location to return."}
   * @paramDef {"type":"Number","label":"Radius (meters)","name":"radius","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Search radius in meters (default 500, max 1000000)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of locations to return."}
   *
   * @returns {Object}
   * @sampleResult {"locations":[{"url":"/location-finder/v1/locations/8003-4008202","location":{"ids":[{"locationId":"8003-4008202","provider":"parcel"}],"keyword":"Postfiliale","keywordId":"502","type":"postoffice"},"name":"Postfiliale 502","distance":26,"place":{"address":{"countryCode":"DE","postalCode":"53113","addressLocality":"Bonn","streetAddress":"Charles-de-Gaulle-Str. 20"},"geo":{"latitude":50.7160101,"longitude":7.1298043}},"openingHours":[{"dayOfWeek":"http://schema.org/Monday","opens":"09:00","closes":"18:00"}],"serviceTypes":["parcel:pick-up","parcel:drop-off"]}]}
   */
  async findLocationsByGeo(latitude, longitude, providerType, locationType, radius, limit) {
    const logTag = '[findLocationsByGeo]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/location-finder/v1/find-by-geo`,
      method: 'get',
      query: {
        latitude,
        longitude,
        providerType: this.#resolveChoice(providerType, { 'Parcel': 'parcel', 'Express': 'express' }),
        locationType: this.#resolveChoice(locationType, {
          'Service Point': 'servicepoint',
          'Post Office': 'postoffice',
          'Postbank': 'postbank',
          'Parcel Locker': 'locker',
          'PO Box': 'pobox',
          'Post Box': 'postbox',
        }),
        radius,
        limit,
      },
    })
  }

  /**
   * @operationName Get Location by ID
   * @category Location Finder
   * @description Retrieves the full details of a single DHL location by its location id (as returned by Find Locations by Address or Find Locations by Geo) using the Location Finder API. Returns the location's name, type, full address, geo-coordinates, opening hours, closure periods, contact information, and supported service types. Requires the API key to be subscribed to the "Location Finder" product in the DHL Developer Portal.
   * @route GET /location-finder/locations/{locationId}
   * @appearanceColor #d50029 #fecc00
   *
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","required":true,"description":"The DHL location id to retrieve (e.g. 8003-4008202), taken from a Find Locations result."}
   *
   * @returns {Object}
   * @sampleResult {"url":"/location-finder/v1/locations/8003-4008202","location":{"ids":[{"locationId":"8003-4008202","provider":"parcel"}],"keyword":"Postfiliale","keywordId":"502","type":"postoffice"},"name":"Postfiliale 502","place":{"address":{"countryCode":"DE","postalCode":"53113","addressLocality":"Bonn","streetAddress":"Charles-de-Gaulle-Str. 20"},"geo":{"latitude":50.7160101,"longitude":7.1298043}},"openingHours":[{"dayOfWeek":"http://schema.org/Monday","opens":"09:00","closes":"18:00"}],"contactInformation":{"phone":"+49-228-1234567"},"serviceTypes":["parcel:pick-up","parcel:drop-off"]}
   */
  async getLocationById(locationId) {
    const logTag = '[getLocationById]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/location-finder/v1/locations/${ encodeURIComponent(locationId) }`,
      method: 'get',
    })
  }
}

Flowrunner.ServerCode.addService(DHLService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'DHL Developer Portal -> your app -> API Key (sent as the DHL-API-Key header). The key must be subscribed to both the "Shipment Tracking - Unified" and "Location Finder" products.',
  },
])
