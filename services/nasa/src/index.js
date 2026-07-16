const logger = {
  info: (...args) => console.log('[NASA] info:', ...args),
  debug: (...args) => console.log('[NASA] debug:', ...args),
  error: (...args) => console.log('[NASA] error:', ...args),
  warn: (...args) => console.log('[NASA] warn:', ...args),
}

const API_BASE_URL = 'https://api.nasa.gov'
const IMAGES_API_BASE_URL = 'https://images-api.nasa.gov'

const ROVERS = { Curiosity: 'curiosity', Opportunity: 'opportunity', Spirit: 'spirit', Perseverance: 'perseverance' }
const CAMERAS = {
  'Front Hazard Avoidance Camera': 'FHAZ',
  'Rear Hazard Avoidance Camera': 'RHAZ',
  'Mast Camera': 'MAST',
  'Chemistry and Camera Complex': 'CHEMCAM',
  'Mars Hand Lens Imager': 'MAHLI',
  'Mars Descent Imager': 'MARDI',
  'Navigation Camera': 'NAVCAM',
  'Panoramic Camera': 'PANCAM',
  'Miniature Thermal Emission Spectrometer (Mini-TES)': 'MINITES',
}

/**
 * @integrationName NASA
 * @integrationIcon /icon.svg
 */
class NASA {
  constructor(config) {
    this.apiKey = config.apiKey || 'DEMO_KEY'
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #cleanQuery(query) {
    const cleaned = {}

    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== '') cleaned[key] = value
    }

    return cleaned
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag, withKey = true }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)
      const finalQuery = this.#cleanQuery({ ...(query || {}), ...(withKey ? { api_key: this.apiKey } : {}) })
      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ 'Content-Type': 'application/json' })
        .query(finalQuery)

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const nasaError = error.body?.error
      const message = nasaError?.message || error.body?.error_message || error.body?.msg || error.message
      const code = nasaError?.code || error.status || error.statusCode
      logger.error(`${ logTag } - failed: ${ message }`)
      throw new Error(`NASA API error${ code ? ` (${ code })` : '' }: ${ message }`)
    }
  }

  /**
   * @operationName Get APOD
   * @description Retrieves NASA's Astronomy Picture of the Day (APOD): a curated image or video with an explanation written by a professional astronomer. Provide a single date for one entry, a start_date/end_date range for multiple entries, or a count for a set of random entries (date and range cannot be combined with count). Set thumbs to true to include a thumbnail URL when the media is a video.
   * @category Astronomy Picture of the Day
   * @route GET /apod
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Date of the APOD image (YYYY-MM-DD). Defaults to today. Cannot be combined with Count."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","uiComponent":{"type":"DATE_PICKER"},"description":"Start of a date range (YYYY-MM-DD) to return multiple entries. Cannot be combined with Count."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","uiComponent":{"type":"DATE_PICKER"},"description":"End of the date range (YYYY-MM-DD). Defaults to today when Start Date is set."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Return this many randomly chosen APOD entries. Cannot be combined with Date or a date range."}
   * @paramDef {"type":"Boolean","label":"Include Thumbnails","name":"thumbs","uiComponent":{"type":"CHECKBOX"},"description":"When true, return a thumbnail URL for video content."}
   * @returns {Object}
   * @sampleResult {"date":"2026-07-14","title":"A Double Asteroid","explanation":"Why is this asteroid a double?...","url":"https://apod.nasa.gov/apod/image/2607/torifune.jpg","media_type":"image","service_version":"v1","copyright":"JAXA"}
   */
  async getAPOD(date, startDate, endDate, count, thumbs) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/planetary/apod`,
      query: { date, start_date: startDate, end_date: endDate, count, thumbs },
      logTag: 'getAPOD',
    })
  }

  /**
   * @operationName Get Mars Rover Photos
   * @description Retrieves images taken by cameras aboard a NASA Mars rover on a specific Martian sol (mission day) or Earth date. You must supply either Sol or Earth Date. Optionally filter by a specific camera and paginate through results (25 photos per page). Supported rovers: Curiosity, Opportunity, Spirit, and Perseverance.
   * @category Mars Rover Photos
   * @route GET /mars-photos
   * @paramDef {"type":"String","label":"Rover","name":"rover","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Curiosity","Opportunity","Spirit","Perseverance"]}},"description":"The Mars rover to query."}
   * @paramDef {"type":"Number","label":"Sol","name":"sol","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Martian sol (mission day, starting at 0) the photos were taken. Provide either Sol or Earth Date."}
   * @paramDef {"type":"String","label":"Earth Date","name":"earthDate","uiComponent":{"type":"DATE_PICKER"},"description":"Earth date the photos were taken (YYYY-MM-DD). Provide either Sol or Earth Date."}
   * @paramDef {"type":"String","label":"Camera","name":"camera","uiComponent":{"type":"DROPDOWN","options":{"values":["Front Hazard Avoidance Camera","Rear Hazard Avoidance Camera","Mast Camera","Chemistry and Camera Complex","Mars Hand Lens Imager","Mars Descent Imager","Navigation Camera","Panoramic Camera","Miniature Thermal Emission Spectrometer (Mini-TES)"]}},"description":"Filter to a single onboard camera. Availability varies by rover."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number of results (25 photos per page). Defaults to 1."}
   * @returns {Object}
   * @sampleResult {"photos":[{"id":102693,"sol":1000,"camera":{"id":20,"name":"FHAZ","full_name":"Front Hazard Avoidance Camera"},"img_src":"https://mars.nasa.gov/msl-raw-images/.../FLB_486265257EDR_F0481570FHAZ00323M_.JPG","earth_date":"2015-05-30","rover":{"id":5,"name":"Curiosity","status":"active"}}]}
   */
  async getMarsRoverPhotos(rover, sol, earthDate, camera, page) {
    const roverSlug = this.#resolveChoice(rover, ROVERS)

    return this.#apiRequest({
      url: `${ API_BASE_URL }/mars-photos/api/v1/rovers/${ encodeURIComponent(roverSlug) }/photos`,
      query: { sol, earth_date: earthDate, camera: this.#resolveChoice(camera, CAMERAS), page },
      logTag: 'getMarsRoverPhotos',
    })
  }

  /**
   * @operationName Get Rover Manifest
   * @description Retrieves the mission manifest for a NASA Mars rover, summarizing its landing/launch dates, mission status, maximum sol and Earth date reached, total photos taken, and a per-sol breakdown of available photos and cameras. Useful for discovering which sols and cameras have imagery before fetching photos.
   * @category Mars Rover Photos
   * @route GET /rover-manifest
   * @paramDef {"type":"String","label":"Rover","name":"rover","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Curiosity","Opportunity","Spirit","Perseverance"]}},"description":"The Mars rover whose manifest to retrieve."}
   * @returns {Object}
   * @sampleResult {"photo_manifest":{"name":"Curiosity","landing_date":"2012-08-06","launch_date":"2011-11-26","status":"active","max_sol":4102,"max_date":"2024-02-19","total_photos":695670,"photos":[{"sol":0,"earth_date":"2012-08-06","total_photos":3702,"cameras":["CHEMCAM","FHAZ","MARDI","RHAZ"]}]}}
   */
  async getRoverManifest(rover) {
    const roverSlug = this.#resolveChoice(rover, ROVERS)

    return this.#apiRequest({
      url: `${ API_BASE_URL }/mars-photos/api/v1/manifests/${ encodeURIComponent(roverSlug) }`,
      logTag: 'getRoverManifest',
    })
  }

  /**
   * @operationName Get Latest Photos
   * @description Retrieves the most recent images taken by a NASA Mars rover, from its latest available sol. Returns the same photo structure as Get Mars Rover Photos but without requiring a sol or Earth date. Supported rovers: Curiosity, Opportunity, Spirit, and Perseverance.
   * @category Mars Rover Photos
   * @route GET /latest-photos
   * @paramDef {"type":"String","label":"Rover","name":"rover","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Curiosity","Opportunity","Spirit","Perseverance"]}},"description":"The Mars rover whose latest photos to retrieve."}
   * @returns {Object}
   * @sampleResult {"latest_photos":[{"id":1152643,"sol":4102,"camera":{"id":20,"name":"FHAZ","full_name":"Front Hazard Avoidance Camera"},"img_src":"https://mars.nasa.gov/msl-raw-images/.../FRB_762503490EDR_F1060660FHAZ00337M_.JPG","earth_date":"2024-02-19","rover":{"id":5,"name":"Curiosity","status":"active"}}]}
   */
  async getLatestPhotos(rover) {
    const roverSlug = this.#resolveChoice(rover, ROVERS)

    return this.#apiRequest({
      url: `${ API_BASE_URL }/mars-photos/api/v1/rovers/${ encodeURIComponent(roverSlug) }/latest_photos`,
      logTag: 'getLatestPhotos',
    })
  }

  /**
   * @operationName Get Asteroids Feed
   * @description Retrieves a feed of near-Earth objects (asteroids) with close-approach data within a date range, from NASA's NeoWs (Near Earth Object Web Service). The date range cannot exceed 7 days. If End Date is omitted it defaults to 7 days after Start Date; if both are omitted the next 7 days from today are returned. Results are grouped by close-approach date.
   * @category Asteroids NeoWs
   * @route GET /asteroids-feed
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","uiComponent":{"type":"DATE_PICKER"},"description":"Start of the close-approach date range (YYYY-MM-DD). Defaults to today."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","uiComponent":{"type":"DATE_PICKER"},"description":"End of the close-approach date range (YYYY-MM-DD), at most 7 days after Start Date."}
   * @returns {Object}
   * @sampleResult {"element_count":25,"near_earth_objects":{"2026-07-14":[{"id":"2465633","name":"465633 (2009 JR5)","absolute_magnitude_h":20.44,"is_potentially_hazardous_asteroid":true,"close_approach_data":[{"close_approach_date":"2026-07-14","relative_velocity":{"kilometers_per_hour":"66647.35"}}]}]}}
   */
  async getAsteroidsFeed(startDate, endDate) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/neo/rest/v1/feed`,
      query: { start_date: startDate, end_date: endDate },
      logTag: 'getAsteroidsFeed',
    })
  }

  /**
   * @operationName Lookup Asteroid
   * @description Retrieves detailed information for a single near-Earth object by its NeoWs asteroid ID, including size estimates, orbital data, hazard classification, and the full history of close approaches to Earth and other bodies.
   * @category Asteroids NeoWs
   * @route GET /asteroid-lookup
   * @paramDef {"type":"String","label":"Asteroid ID","name":"asteroidId","required":true,"description":"The NeoWs asteroid reference ID (e.g. 3542519). Obtainable from the Asteroids Feed or Browse Asteroids results."}
   * @returns {Object}
   * @sampleResult {"id":"3542519","neo_reference_id":"3542519","name":"(2010 PK9)","absolute_magnitude_h":21.87,"estimated_diameter":{"kilometers":{"estimated_diameter_min":0.16,"estimated_diameter_max":0.36}},"is_potentially_hazardous_asteroid":true,"orbital_data":{"orbit_id":"12"}}
   */
  async lookupAsteroid(asteroidId) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/neo/rest/v1/neo/${ encodeURIComponent(asteroidId) }`,
      logTag: 'lookupAsteroid',
    })
  }

  /**
   * @operationName Browse Asteroids
   * @description Retrieves a paginated list of all near-Earth objects in NASA's NeoWs dataset, ordered by NeoWs reference ID. Use Page and Size to iterate through the full catalog (tens of thousands of objects). Returns each object's size, hazard status, and close-approach data.
   * @category Asteroids NeoWs
   * @route GET /asteroids-browse
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based page number. Defaults to 0."}
   * @paramDef {"type":"Number","label":"Size","name":"size","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of objects per page (max 20). Defaults to 20."}
   * @returns {Object}
   * @sampleResult {"links":{"next":"http://api.nasa.gov/neo/rest/v1/neo/browse?page=1&size=20"},"page":{"size":20,"total_elements":61964,"total_pages":3099,"number":0},"near_earth_objects":[{"id":"2000433","name":"433 Eros (A898 PA)","is_potentially_hazardous_asteroid":false}]}
   */
  async browseAsteroids(page, size) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/neo/rest/v1/neo/browse`,
      query: { page, size },
      logTag: 'browseAsteroids',
    })
  }

  /**
   * @operationName Get EPIC Natural
   * @description Retrieves metadata for EPIC (Earth Polychromatic Imaging Camera) natural-color images of the full sunlit Earth captured by the DSCOVR spacecraft. Omit Date to get the most recent available imagery, or provide a date (YYYY-MM-DD) to get imagery for that day. Each entry includes the image identifier, caption, and centroid coordinates; build the full image URL from the returned identifier and date.
   * @category EPIC Earth Imagery
   * @route GET /epic-natural
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Imagery date (YYYY-MM-DD). Omit for the most recent available natural-color imagery."}
   * @returns {Array<Object>}
   * @sampleResult [{"identifier":"20260712010436","caption":"This image was taken by NASA's EPIC camera onboard the NOAA DSCOVR spacecraft","image":"epic_1b_20260712010436","version":"04","date":"2026-07-12 00:59:45","centroid_coordinates":{"lat":13.96,"lon":172.84}}]
   */
  async getEPICNatural(date) {
    const path = date ? `/EPIC/api/natural/date/${ encodeURIComponent(date) }` : '/EPIC/api/natural'

    return this.#apiRequest({ url: `${ API_BASE_URL }${ path }`, logTag: 'getEPICNatural' })
  }

  /**
   * @operationName Get EPIC Enhanced
   * @description Retrieves metadata for EPIC (Earth Polychromatic Imaging Camera) enhanced-color images of the full sunlit Earth captured by the DSCOVR spacecraft. Enhanced imagery has additional color/contrast processing applied. Omit Date for the most recent available imagery, or provide a date (YYYY-MM-DD) for that day. Build the full image URL from the returned identifier and date.
   * @category EPIC Earth Imagery
   * @route GET /epic-enhanced
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Imagery date (YYYY-MM-DD). Omit for the most recent available enhanced-color imagery."}
   * @returns {Array<Object>}
   * @sampleResult [{"identifier":"20260712010436","caption":"This image was taken by NASA's EPIC camera onboard the NOAA DSCOVR spacecraft","image":"epic_RGB_20260712010436","version":"04","date":"2026-07-12 00:59:45","centroid_coordinates":{"lat":13.96,"lon":172.84}}]
   */
  async getEPICEnhanced(date) {
    const path = date ? `/EPIC/api/enhanced/date/${ encodeURIComponent(date) }` : '/EPIC/api/enhanced'

    return this.#apiRequest({ url: `${ API_BASE_URL }${ path }`, logTag: 'getEPICEnhanced' })
  }

  /**
   * @operationName Get Earth Imagery
   * @description Retrieves a Landsat 8 satellite image of the Earth's surface for a given latitude and longitude, from NASA's Earth imagery API. Optionally specify a date to get the closest available image on or before it, and a degree width (dim) for the image footprint. Returns image metadata including a URL to the rendered PNG.
   * @category Earth
   * @route GET /earth-imagery
   * @paramDef {"type":"Number","label":"Latitude","name":"lat","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Latitude of the point of interest (decimal degrees)."}
   * @paramDef {"type":"Number","label":"Longitude","name":"lon","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Longitude of the point of interest (decimal degrees)."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Return the closest image on or before this date (YYYY-MM-DD). Defaults to the most recent image."}
   * @paramDef {"type":"Number","label":"Dimension","name":"dim","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Width and height of the image in degrees (e.g. 0.1). Defaults to 0.025."}
   * @returns {Object}
   * @sampleResult {"date":"2018-01-01T00:00:00","url":"https://earthengine.googleapis.com/api/thumb?thumbid=...&token=...","id":"LANDSAT/LC08/C01/T1_SR/LC08_127059_20180101"}
   */
  async getEarthImagery(lat, lon, date, dim) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/planetary/earth/imagery`,
      query: { lat, lon, date, dim },
      logTag: 'getEarthImagery',
    })
  }

  /**
   * @operationName Get Earth Assets
   * @description Retrieves the list of available Landsat 8 imagery dates for a given latitude and longitude from NASA's Earth API. Use this to discover which dates have imagery before requesting a specific image via Get Earth Imagery.
   * @category Earth
   * @route GET /earth-assets
   * @paramDef {"type":"Number","label":"Latitude","name":"lat","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Latitude of the point of interest (decimal degrees)."}
   * @paramDef {"type":"Number","label":"Longitude","name":"lon","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Longitude of the point of interest (decimal degrees)."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Beginning of the date range (YYYY-MM-DD) to search for available imagery."}
   * @paramDef {"type":"Number","label":"Dimension","name":"dim","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Width and height of the search area in degrees (e.g. 0.1). Defaults to 0.025."}
   * @returns {Object}
   * @sampleResult {"count":1,"results":[{"date":"2018-01-01T00:00:00","id":"LANDSAT/LC08/C01/T1_SR/LC08_127059_20180101"}]}
   */
  async getEarthAssets(lat, lon, date, dim) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/planetary/earth/assets`,
      query: { lat, lon, date, dim },
      logTag: 'getEarthAssets',
    })
  }

  /**
   * @operationName Get Solar Flares
   * @description Retrieves solar flare (FLR) events within a date range from NASA's DONKI (Space Weather Database Of Notifications, Knowledge, Information). Each event includes begin/peak/end times, flare class type, source location, active region number, and linked instruments. If dates are omitted, DONKI defaults to the last 30 days.
   * @category DONKI Space Weather
   * @route GET /solar-flares
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","uiComponent":{"type":"DATE_PICKER"},"description":"Start of the event date range (YYYY-MM-DD). Defaults to 30 days ago."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","uiComponent":{"type":"DATE_PICKER"},"description":"End of the event date range (YYYY-MM-DD). Defaults to today."}
   * @returns {Array<Object>}
   * @sampleResult [{"flrID":"2024-05-01T05:53:00-FLR-001","beginTime":"2024-05-01T05:53Z","peakTime":"2024-05-01T06:57Z","endTime":"2024-05-01T07:35Z","classType":"C5.3","sourceLocation":"S15W76","activeRegionNum":13657}]
   */
  async getSolarFlares(startDate, endDate) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/DONKI/FLR`,
      query: { startDate, endDate },
      logTag: 'getSolarFlares',
    })
  }

  /**
   * @operationName Get Geomagnetic Storms
   * @description Retrieves geomagnetic storm (GST) events within a date range from NASA's DONKI space weather database. Each event includes its start time and a series of observed Kp index readings that quantify the storm's intensity, plus links to related solar events. If dates are omitted, DONKI defaults to the last 30 days.
   * @category DONKI Space Weather
   * @route GET /geomagnetic-storms
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","uiComponent":{"type":"DATE_PICKER"},"description":"Start of the event date range (YYYY-MM-DD). Defaults to 30 days ago."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","uiComponent":{"type":"DATE_PICKER"},"description":"End of the event date range (YYYY-MM-DD). Defaults to today."}
   * @returns {Array<Object>}
   * @sampleResult [{"gstID":"2024-05-02T15:00:00-GST-001","startTime":"2024-05-02T15:00Z","allKpIndex":[{"observedTime":"2024-05-02T18:00Z","kpIndex":6.67,"source":"NOAA"}]}]
   */
  async getGeomagneticStorms(startDate, endDate) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/DONKI/GST`,
      query: { startDate, endDate },
      logTag: 'getGeomagneticStorms',
    })
  }

  /**
   * @operationName Get CMEs
   * @description Retrieves coronal mass ejection (CME) events within a date range from NASA's DONKI space weather database. Each event includes the start time, source location, associated instruments, analyses (speed, direction, and half-angle), and linked events. If dates are omitted, DONKI defaults to the last 30 days.
   * @category DONKI Space Weather
   * @route GET /cmes
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","uiComponent":{"type":"DATE_PICKER"},"description":"Start of the event date range (YYYY-MM-DD). Defaults to 30 days ago."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","uiComponent":{"type":"DATE_PICKER"},"description":"End of the event date range (YYYY-MM-DD). Defaults to today."}
   * @returns {Array<Object>}
   * @sampleResult [{"activityID":"2024-05-02T14:09:00-CME-001","startTime":"2024-05-02T14:09Z","sourceLocation":"S17E08","note":"","cmeAnalyses":[{"speed":586,"type":"C","latitude":-20,"longitude":-5,"halfAngle":36}]}]
   */
  async getCMEs(startDate, endDate) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/DONKI/CME`,
      query: { startDate, endDate },
      logTag: 'getCMEs',
    })
  }

  /**
   * @operationName Search NASA Images
   * @description Searches NASA's public Image and Video Library for media matching a free-text query. This endpoint does not require an API key. Optionally restrict results to a specific media type (image, video, or audio). Returns a collection of matching assets with titles, descriptions, thumbnail links, and asset URLs.
   * @category Image Library
   * @route GET /image-search
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Free-text search terms (e.g. \"apollo 11\", \"nebula\")."}
   * @paramDef {"type":"String","label":"Media Type","name":"mediaType","uiComponent":{"type":"DROPDOWN","options":{"values":["Image","Video","Audio"]}},"description":"Restrict results to a single media type. Omit to search all types."}
   * @returns {Object}
   * @sampleResult {"collection":{"version":"1.1","href":"http://images-api.nasa.gov/search?q=moon","items":[{"href":"https://images-assets.nasa.gov/image/PIA12235/collection.json","data":[{"title":"The Moon","nasa_id":"PIA12235","media_type":"image"}]}],"metadata":{"total_hits":8500}}}
   */
  async searchNASAImages(query, mediaType) {
    return this.#apiRequest({
      url: `${ IMAGES_API_BASE_URL }/search`,
      query: { q: query, media_type: this.#resolveChoice(mediaType, { Image: 'image', Video: 'video', Audio: 'audio' }) },
      logTag: 'searchNASAImages',
      withKey: false,
    })
  }
}

Flowrunner.ServerCode.addService(NASA, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    defaultValue: 'DEMO_KEY',
    hint: 'NASA API key from api.nasa.gov (DEMO_KEY works for light testing with low rate limits).',
  },
])
