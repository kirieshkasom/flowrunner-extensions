const logger = {
  info: (...args) => console.log('[OpenWeatherMap] info:', ...args),
  debug: (...args) => console.log('[OpenWeatherMap] debug:', ...args),
  error: (...args) => console.log('[OpenWeatherMap] error:', ...args),
  warn: (...args) => console.log('[OpenWeatherMap] warn:', ...args),
}

const API_BASE_URL = 'https://api.openweathermap.org'

const UNITS_MAPPING = {
  'Standard (Kelvin)': 'standard',
  'Metric (Celsius)': 'metric',
  'Imperial (Fahrenheit)': 'imperial',
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
 * @integrationName OpenWeatherMap
 * @integrationIcon /icon.png
 */
class OpenWeatherMapService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Builds the location portion of a query. Callers pass whichever of q / lat+lon / zip / id
  // the user supplied; the first present (in that precedence order) is used.
  #buildLocation({ q, lat, lon, zip, id }, logTag) {
    if (q !== undefined && q !== null && q !== '') {
      return { q }
    }

    if (lat !== undefined && lat !== null && lat !== '' && lon !== undefined && lon !== null && lon !== '') {
      return { lat, lon }
    }

    if (zip !== undefined && zip !== null && zip !== '') {
      return { zip }
    }

    if (id !== undefined && id !== null && id !== '') {
      return { id }
    }

    throw new Error(`${ logTag } OpenWeatherMap error: a location is required. Provide a city name (City), or Latitude and Longitude, or a ZIP code, or a City ID.`)
  }

  async #apiRequest({ url, query, logTag }) {
    try {
      const cleanedQuery = clean({ ...query, appid: this.apiKey })

      logger.debug(`${ logTag } - API request: [GET::${ url }]`)

      return await Flowrunner.Request.get(url).query(cleanedQuery)
    } catch (error) {
      // OpenWeatherMap error bodies look like { "cod": 401, "message": "Invalid API key" }.
      const body = error.body || {}
      const cod = body.cod !== undefined ? body.cod : (error.status || error.statusCode)
      const message = body.message || error.message || 'Unknown error'

      logger.error(`${ logTag } - Request failed (cod ${ cod }): ${ message }`)

      throw new Error(`OpenWeatherMap API error${ cod !== undefined ? ` (${ cod })` : '' }: ${ message }`)
    }
  }

  /**
   * @operationName Get Current Weather
   * @category Weather
   * @description Retrieves current weather conditions for a location, including temperature, feels-like, humidity, pressure, wind, cloud cover, and a weather description. Specify the location by exactly one of: city name (optionally "City,State,Country"), latitude and longitude, ZIP code (optionally "zip,country"), or numeric city ID. Optionally choose a unit system and a response language.
   * @route GET /current-weather
   * @appearanceColor #EB6E4B #F0946E
   *
   * @paramDef {"type":"String","label":"City","name":"city","description":"City name, optionally with state and country codes, e.g. \"London\" or \"London,GB\". Provide one of City, Latitude+Longitude, ZIP Code, or City ID."}
   * @paramDef {"type":"Number","label":"Latitude","name":"latitude","description":"Latitude (-90 to 90). Use together with Longitude as an alternative to City."}
   * @paramDef {"type":"Number","label":"Longitude","name":"longitude","description":"Longitude (-180 to 180). Use together with Latitude as an alternative to City."}
   * @paramDef {"type":"String","label":"ZIP Code","name":"zipCode","description":"ZIP/postal code, optionally with country code, e.g. \"90210\" or \"90210,US\". Defaults to US when no country is given."}
   * @paramDef {"type":"String","label":"City ID","name":"cityId","description":"Numeric OpenWeatherMap city ID. Alternative to City."}
   * @paramDef {"type":"String","label":"Units","name":"units","uiComponent":{"type":"DROPDOWN","options":{"values":["Standard (Kelvin)","Metric (Celsius)","Imperial (Fahrenheit)"]}},"description":"Unit system for temperature and wind. Defaults to Standard (Kelvin)."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Two-letter language code for the weather description, e.g. en, es, fr, de. Optional."}
   *
   * @returns {Object}
   * @sampleResult {"coord":{"lon":10.99,"lat":44.34},"weather":[{"id":501,"main":"Rain","description":"moderate rain","icon":"10d"}],"base":"stations","main":{"temp":298.48,"feels_like":298.74,"temp_min":297.56,"temp_max":300.05,"pressure":1015,"humidity":64},"visibility":10000,"wind":{"speed":0.62,"deg":349,"gust":1.18},"clouds":{"all":100},"dt":1661870592,"sys":{"country":"IT","sunrise":1661834187,"sunset":1661882248},"timezone":7200,"id":3163858,"name":"Zocca","cod":200}
   */
  async getCurrentWeather(city, latitude, longitude, zipCode, cityId, units, language) {
    const logTag = '[getCurrentWeather]'

    const location = this.#buildLocation({ q: city, lat: latitude, lon: longitude, zip: zipCode, id: cityId }, logTag)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/data/2.5/weather`,
      query: {
        ...location,
        units: this.#resolveChoice(units, UNITS_MAPPING),
        lang: language,
      },
    })
  }

  /**
   * @operationName Get 5 Day / 3 Hour Forecast
   * @category Weather
   * @description Retrieves a 5-day weather forecast in 3-hour steps (up to 40 timestamps) for a location. Specify the location by exactly one of: city name, latitude and longitude, ZIP code, or numeric city ID. Use Count to limit the number of returned timestamps.
   * @route GET /forecast
   * @appearanceColor #EB6E4B #F0946E
   *
   * @paramDef {"type":"String","label":"City","name":"city","description":"City name, optionally with state and country codes, e.g. \"London\" or \"London,GB\". Provide one of City, Latitude+Longitude, ZIP Code, or City ID."}
   * @paramDef {"type":"Number","label":"Latitude","name":"latitude","description":"Latitude (-90 to 90). Use together with Longitude as an alternative to City."}
   * @paramDef {"type":"Number","label":"Longitude","name":"longitude","description":"Longitude (-180 to 180). Use together with Latitude as an alternative to City."}
   * @paramDef {"type":"String","label":"ZIP Code","name":"zipCode","description":"ZIP/postal code, optionally with country code, e.g. \"90210,US\". Defaults to US when no country is given."}
   * @paramDef {"type":"String","label":"City ID","name":"cityId","description":"Numeric OpenWeatherMap city ID. Alternative to City."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of 3-hour timestamps to return (1-40). Leave empty to return all 40."}
   * @paramDef {"type":"String","label":"Units","name":"units","uiComponent":{"type":"DROPDOWN","options":{"values":["Standard (Kelvin)","Metric (Celsius)","Imperial (Fahrenheit)"]}},"description":"Unit system for temperature and wind. Defaults to Standard (Kelvin)."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Two-letter language code for weather descriptions, e.g. en, es, fr. Optional."}
   *
   * @returns {Object}
   * @sampleResult {"cod":"200","message":0,"cnt":1,"list":[{"dt":1661871600,"main":{"temp":296.76,"feels_like":296.98,"temp_min":296.76,"temp_max":297.87,"pressure":1015,"humidity":69},"weather":[{"id":500,"main":"Rain","description":"light rain","icon":"10d"}],"clouds":{"all":100},"wind":{"speed":0.62,"deg":349,"gust":1.18},"visibility":10000,"pop":0.32,"dt_txt":"2022-08-30 15:00:00"}],"city":{"id":3163858,"name":"Zocca","coord":{"lat":44.34,"lon":10.99},"country":"IT","timezone":7200,"sunrise":1661834187,"sunset":1661882248}}
   */
  async getForecast(city, latitude, longitude, zipCode, cityId, count, units, language) {
    const logTag = '[getForecast]'

    const location = this.#buildLocation({ q: city, lat: latitude, lon: longitude, zip: zipCode, id: cityId }, logTag)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/data/2.5/forecast`,
      query: {
        ...location,
        cnt: count,
        units: this.#resolveChoice(units, UNITS_MAPPING),
        lang: language,
      },
    })
  }

  /**
   * @operationName Get Air Pollution
   * @category Air Quality
   * @description Retrieves current air quality data for a set of coordinates, including the Air Quality Index (AQI, 1=Good to 5=Very Poor) and pollutant concentrations in μg/m³ (CO, NO, NO2, O3, SO2, PM2.5, PM10, NH3).
   * @route GET /air-pollution
   * @appearanceColor #EB6E4B #F0946E
   *
   * @paramDef {"type":"Number","label":"Latitude","name":"latitude","required":true,"description":"Latitude (-90 to 90) of the location."}
   * @paramDef {"type":"Number","label":"Longitude","name":"longitude","required":true,"description":"Longitude (-180 to 180) of the location."}
   *
   * @returns {Object}
   * @sampleResult {"coord":{"lon":50,"lat":50},"list":[{"main":{"aqi":1},"components":{"co":201.94,"no":0.019,"no2":0.771,"o3":68.66,"so2":0.641,"pm2_5":0.5,"pm10":0.54,"nh3":0.124},"dt":1605182400}]}
   */
  async getAirPollution(latitude, longitude) {
    const logTag = '[getAirPollution]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/data/2.5/air_pollution`,
      query: { lat: latitude, lon: longitude },
    })
  }

  /**
   * @operationName Get Air Pollution Forecast
   * @category Air Quality
   * @description Retrieves an air quality forecast for a set of coordinates, covering the next 4 days with hourly granularity. Each entry includes the Air Quality Index (AQI, 1=Good to 5=Very Poor) and pollutant concentrations in μg/m³.
   * @route GET /air-pollution-forecast
   * @appearanceColor #EB6E4B #F0946E
   *
   * @paramDef {"type":"Number","label":"Latitude","name":"latitude","required":true,"description":"Latitude (-90 to 90) of the location."}
   * @paramDef {"type":"Number","label":"Longitude","name":"longitude","required":true,"description":"Longitude (-180 to 180) of the location."}
   *
   * @returns {Object}
   * @sampleResult {"coord":{"lon":50,"lat":50},"list":[{"main":{"aqi":1},"components":{"co":203.6,"no":0.03,"no2":0.83,"o3":66.52,"so2":0.7,"pm2_5":0.63,"pm10":0.68,"nh3":0.14},"dt":1605892800}]}
   */
  async getAirPollutionForecast(latitude, longitude) {
    const logTag = '[getAirPollutionForecast]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/data/2.5/air_pollution/forecast`,
      query: { lat: latitude, lon: longitude },
    })
  }

  /**
   * @operationName Get Air Pollution History
   * @category Air Quality
   * @description Retrieves historical air quality data for a set of coordinates over a time range. Provide the start and end as Unix timestamps (UTC seconds). Each entry includes the Air Quality Index (AQI, 1=Good to 5=Very Poor) and pollutant concentrations in μg/m³.
   * @route GET /air-pollution-history
   * @appearanceColor #EB6E4B #F0946E
   *
   * @paramDef {"type":"Number","label":"Latitude","name":"latitude","required":true,"description":"Latitude (-90 to 90) of the location."}
   * @paramDef {"type":"Number","label":"Longitude","name":"longitude","required":true,"description":"Longitude (-180 to 180) of the location."}
   * @paramDef {"type":"Number","label":"Start","name":"start","required":true,"description":"Start of the time range as a Unix timestamp (UTC seconds)."}
   * @paramDef {"type":"Number","label":"End","name":"end","required":true,"description":"End of the time range as a Unix timestamp (UTC seconds)."}
   *
   * @returns {Object}
   * @sampleResult {"coord":{"lon":50,"lat":50},"list":[{"main":{"aqi":1},"components":{"co":201.94,"no":0.019,"no2":0.771,"o3":68.66,"so2":0.641,"pm2_5":0.5,"pm10":0.54,"nh3":0.124},"dt":1606223802}]}
   */
  async getAirPollutionHistory(latitude, longitude, start, end) {
    const logTag = '[getAirPollutionHistory]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/data/2.5/air_pollution/history`,
      query: { lat: latitude, lon: longitude, start, end },
    })
  }

  /**
   * @operationName Direct Geocoding
   * @category Geocoding
   * @description Converts a place name into geographic coordinates. Accepts a city name, optionally with state and country codes ("City,State,Country" — state codes apply to the US only). Returns up to 5 matching locations with their latitude, longitude, country, state, and localized names.
   * @route GET /geocoding-direct
   * @appearanceColor #EB6E4B #F0946E
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Place name, optionally with state and country codes, e.g. \"London\", \"London,GB\", or \"Springfield,IL,US\"."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of results to return (1-5). Defaults to 5."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"name":"London","local_names":{"en":"London","fr":"Londres"},"lat":51.5073219,"lon":-0.1276474,"country":"GB","state":"England"}]
   */
  async geocodingDirect(query, limit) {
    const logTag = '[geocodingDirect]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/geo/1.0/direct`,
      query: { q: query, limit },
    })
  }

  /**
   * @operationName Reverse Geocoding
   * @category Geocoding
   * @description Converts geographic coordinates into place names. Returns up to 5 nearby locations with their name, country, state, and localized names.
   * @route GET /geocoding-reverse
   * @appearanceColor #EB6E4B #F0946E
   *
   * @paramDef {"type":"Number","label":"Latitude","name":"latitude","required":true,"description":"Latitude (-90 to 90) of the location."}
   * @paramDef {"type":"Number","label":"Longitude","name":"longitude","required":true,"description":"Longitude (-180 to 180) of the location."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of results to return (1-5). Defaults to 5."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"name":"London","local_names":{"en":"London","fr":"Londres"},"lat":51.5073219,"lon":-0.1276474,"country":"GB","state":"England"}]
   */
  async geocodingReverse(latitude, longitude, limit) {
    const logTag = '[geocodingReverse]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/geo/1.0/reverse`,
      query: { lat: latitude, lon: longitude, limit },
    })
  }

  /**
   * @operationName Zip Geocoding
   * @category Geocoding
   * @description Converts a ZIP/postal code into geographic coordinates and a place name. Provide the code optionally with a country code ("zip,country"); defaults to US when no country is given.
   * @route GET /geocoding-zip
   * @appearanceColor #EB6E4B #F0946E
   *
   * @paramDef {"type":"String","label":"ZIP Code","name":"zipCode","required":true,"description":"ZIP/postal code, optionally with country code, e.g. \"90210\" or \"90210,US\"."}
   *
   * @returns {Object}
   * @sampleResult {"zip":"90210","name":"Beverly Hills","lat":34.0901,"lon":-118.4065,"country":"US"}
   */
  async geocodingZip(zipCode) {
    const logTag = '[geocodingZip]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/geo/1.0/zip`,
      query: { zip: zipCode },
    })
  }

  /**
   * @operationName One Call Current & Forecast
   * @category One Call 3.0
   * @description Retrieves current, minutely (1 hour), hourly (48 hours), and daily (8 days) weather plus government weather alerts for a set of coordinates in a single call. Use Exclude to omit sections you do not need. NOTE: One Call API 3.0 requires the separate "One Call by Call" subscription on your OpenWeatherMap account — it is not covered by the free plan.
   * @route GET /one-call
   * @appearanceColor #EB6E4B #F0946E
   *
   * @paramDef {"type":"Number","label":"Latitude","name":"latitude","required":true,"description":"Latitude (-90 to 90) of the location."}
   * @paramDef {"type":"Number","label":"Longitude","name":"longitude","required":true,"description":"Longitude (-180 to 180) of the location."}
   * @paramDef {"type":"Array<String>","label":"Exclude","name":"exclude","uiComponent":{"type":"DROPDOWN","options":{"values":["current","minutely","hourly","daily","alerts"]}},"description":"Data sections to omit from the response. Optional; leave empty to return all sections."}
   * @paramDef {"type":"String","label":"Units","name":"units","uiComponent":{"type":"DROPDOWN","options":{"values":["Standard (Kelvin)","Metric (Celsius)","Imperial (Fahrenheit)"]}},"description":"Unit system for temperature and wind. Defaults to Standard (Kelvin)."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Two-letter language code for weather descriptions, e.g. en, es, fr. Optional."}
   *
   * @returns {Object}
   * @sampleResult {"lat":33.44,"lon":-94.04,"timezone":"America/Chicago","timezone_offset":-18000,"current":{"dt":1684929490,"sunrise":1684926645,"sunset":1684977332,"temp":292.55,"feels_like":292.87,"pressure":1014,"humidity":89,"uvi":0.16,"clouds":53,"visibility":10000,"wind_speed":3.13,"wind_deg":93,"weather":[{"id":803,"main":"Clouds","description":"broken clouds","icon":"04d"}]}}
   */
  async oneCall(latitude, longitude, exclude, units, language) {
    const logTag = '[oneCall]'

    const excludeValue = Array.isArray(exclude) && exclude.length > 0 ? exclude.join(',') : undefined

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/data/3.0/onecall`,
      query: {
        lat: latitude,
        lon: longitude,
        exclude: excludeValue,
        units: this.#resolveChoice(units, UNITS_MAPPING),
        lang: language,
      },
    })
  }

  /**
   * @operationName One Call Timemachine
   * @category One Call 3.0
   * @description Retrieves historical or near-future weather for a single moment (from January 1, 1979 up to 4 days ahead) at a set of coordinates. Provide the moment as a Unix timestamp (UTC seconds). NOTE: One Call API 3.0 requires the separate "One Call by Call" subscription on your OpenWeatherMap account — it is not covered by the free plan.
   * @route GET /one-call-timemachine
   * @appearanceColor #EB6E4B #F0946E
   *
   * @paramDef {"type":"Number","label":"Latitude","name":"latitude","required":true,"description":"Latitude (-90 to 90) of the location."}
   * @paramDef {"type":"Number","label":"Longitude","name":"longitude","required":true,"description":"Longitude (-180 to 180) of the location."}
   * @paramDef {"type":"Number","label":"Timestamp","name":"timestamp","required":true,"description":"The moment to query as a Unix timestamp (UTC seconds). Supported from 1979-01-01 up to 4 days ahead."}
   * @paramDef {"type":"String","label":"Units","name":"units","uiComponent":{"type":"DROPDOWN","options":{"values":["Standard (Kelvin)","Metric (Celsius)","Imperial (Fahrenheit)"]}},"description":"Unit system for temperature and wind. Defaults to Standard (Kelvin)."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Two-letter language code for weather descriptions, e.g. en, es, fr. Optional."}
   *
   * @returns {Object}
   * @sampleResult {"lat":52.2297,"lon":21.0122,"timezone":"Europe/Warsaw","timezone_offset":3600,"data":[{"dt":1645888976,"sunrise":1645853361,"sunset":1645891727,"temp":279.13,"feels_like":276.44,"pressure":1029,"humidity":64,"clouds":0,"visibility":10000,"wind_speed":3.6,"wind_deg":340,"weather":[{"id":800,"main":"Clear","description":"clear sky","icon":"01d"}]}]}
   */
  async oneCallTimemachine(latitude, longitude, timestamp, units, language) {
    const logTag = '[oneCallTimemachine]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/data/3.0/onecall/timemachine`,
      query: {
        lat: latitude,
        lon: longitude,
        dt: timestamp,
        units: this.#resolveChoice(units, UNITS_MAPPING),
        lang: language,
      },
    })
  }
}

Flowrunner.ServerCode.addService(OpenWeatherMapService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your OpenWeatherMap API key, sent as the appid query parameter. Find it under API keys in your account (https://openweathermap.org/api). New keys take ~1-2 hours to activate.',
  },
])
