const logger = {
  info: (...args) => console.log('[Leafy Plant] info:', ...args),
  debug: (...args) => console.log('[Leafy Plant] debug:', ...args),
  error: (...args) => console.log('[Leafy Plant] error:', ...args),
  warn: (...args) => console.log('[Leafy Plant] warn:', ...args),
}

const API_BASE_URL = 'https://diagnosis-6uvrn44owq-ew.a.run.app'

const DEFAULT_SEARCH_LIMIT = 10

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
 * @integrationName Leafy Plant
 * @integrationIcon /logo.png
 */
class LeafyPlantService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery)

      const response = body !== undefined ? await request.send(body) : await request

      if (response && response.status === 'error') {
        throw new Error(`Leafy Plant API error: ${ response.message || 'Unknown error' }`)
      }

      return response
    } catch (error) {
      if (error.message && error.message.startsWith('Leafy Plant API error:')) {
        throw error
      }

      const message = error.body?.message ||
        (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))

      logger.error(`${ logTag } - Request failed: ${ message }`)

      throw new Error(`Leafy Plant API error: ${ message }`)
    }
  }

  /**
   * @operationName Identify Plant
   * @category Identification
   * @description Identifies a plant species from a publicly accessible image URL. Returns the scientific name, a confidence score, common names, and plant family. Use the returned plant_name with Get Care Guide or Diagnose Plant.
   * @route POST /identify
   * @appearanceColor #3CB371 #5FD392
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Image URL","name":"imageUrl","required":true,"description":"Public URL of the plant image (jpg/png/webp). Leafy fetches and processes it server-side."}
   * @paramDef {"type":"String","label":"Language","name":"language","uiComponent":{"type":"DROPDOWN","options":{"values":["en","fr","pt"]}},"description":"Language for returned plant names and notes. Defaults to en."}
   *
   * @returns {Object}
   * @sampleResult {"status":"ok","plant_name":"Monstera deliciosa","plant_id":"plant_monstera_deliciosa","confidence":0.92,"common_names":["Swiss cheese plant","Split-leaf philodendron"],"family":"Araceae","notes":"Tropical plant native to southern Mexico","language":"en"}
   */
  async identifyPlant(imageUrl, language) {
    const logTag = '[identifyPlant]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/identify`,
      method: 'post',
      body: clean({
        image_url: imageUrl,
        language: language || 'en',
      }),
    })
  }

  /**
   * @operationName Get Care Guide
   * @category Care
   * @description Returns a detailed care guide for a plant including watering, light, humidity, temperature, fertilizing, repotting schedules, and common issues. Accepts a scientific or common plant name.
   * @route POST /care
   * @appearanceColor #3CB371 #5FD392
   *
   * @paramDef {"type":"String","label":"Plant Name","name":"plantName","required":true,"dictionary":"searchPlantsDictionary","description":"Scientific or common plant name. Search and select a plant, or type a name directly."}
   * @paramDef {"type":"String","label":"Language","name":"language","uiComponent":{"type":"DROPDOWN","options":{"values":["en","fr","pt"]}},"description":"Language for the returned care guide. Defaults to en."}
   *
   * @returns {Object}
   * @sampleResult {"status":"ok","plant_name":"Monstera deliciosa","matched_profile":"monstera","language":"en","watering":"Water every 7-14 days, allow soil to dry between waterings","light":"Bright indirect light, tolerates lower light","humidity":"Prefers 60-80% humidity","temperature":"18-30C (64-86F)","fertilizing":"Balanced liquid fertilizer monthly during growing season","repotting":"Every 2 years in spring","common_issues":["Overwatering","Root rot","Spider mites"]}
   */
  async getCareGuide(plantName, language) {
    const logTag = '[getCareGuide]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/care`,
      method: 'post',
      body: clean({
        plantName,
        language: language || 'en',
      }),
    })
  }

  /**
   * @operationName Search Plants
   * @category Identification
   * @description Searches the Leafy plant database by common or scientific name. Returns a list of matching plants with their IDs, family, and common names for use in Get Care Guide or Diagnose Plant.
   * @route GET /search
   * @appearanceColor #3CB371 #5FD392
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Search term (common or scientific plant name)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of results (1-50). Defaults to 10."}
   * @paramDef {"type":"String","label":"Language","name":"lang","uiComponent":{"type":"DROPDOWN","options":{"values":["en","fr","pt"]}},"description":"Language for returned names. Defaults to en."}
   *
   * @returns {Object}
   * @sampleResult {"status":"ok","query":"monstera","results":[{"plant_id":"plant_monstera_deliciosa","name":"Monstera deliciosa","family":"Araceae","common_names":["Swiss cheese plant"]}],"total":3}
   */
  async searchPlants(query, limit, lang) {
    const logTag = '[searchPlants]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/search`,
      method: 'get',
      query: {
        q: query,
        limit: limit || DEFAULT_SEARCH_LIMIT,
        lang: lang || 'en',
      },
    })
  }

  /**
   * @operationName Diagnose Plant
   * @category Care
   * @description Diagnoses likely plant health issues from a plant name and a list of observed symptoms. Returns a ranked list of probable diseases or pests with confidence scores and treatment recommendations.
   * @route POST /diagnose
   * @appearanceColor #3CB371 #5FD392
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Plant Name","name":"plantName","required":true,"dictionary":"searchPlantsDictionary","description":"Scientific or common plant name. Search and select a plant, or type a name directly."}
   * @paramDef {"type":"Array<String>","label":"Symptoms","name":"userSymptoms","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"List of observed symptoms, e.g. yellow leaves, soft stem, musty smell."}
   * @paramDef {"type":"String","label":"Language","name":"language","uiComponent":{"type":"DROPDOWN","options":{"values":["en","fr","pt"]}},"description":"Language for the diagnosis. Defaults to en."}
   *
   * @returns {Object}
   * @sampleResult {"status":"ok","diagnosis":[{"name":"Root rot","confidence":0.87,"description":"Fungal decay of the roots caused by overwatering.","treatment":"Remove affected roots, repot in fresh dry soil, and reduce watering frequency."}]}
   */
  async diagnosePlant(plantName, userSymptoms, language) {
    const logTag = '[diagnosePlant]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/diagnose`,
      method: 'post',
      body: clean({
        plantName,
        userSymptoms: userSymptoms && userSymptoms.length ? userSymptoms : undefined,
        language: language || 'en',
      }),
    })
  }

  /**
   * @operationName Health Check
   * @category Utility
   * @description Checks Leafy Plant API availability. Use this to validate connectivity and report the running service version.
   * @route GET /health
   * @appearanceColor #3CB371 #5FD392
   *
   * @returns {Object}
   * @sampleResult {"status":"ok","service":"leafy-diagnosis","version":"1.1.0"}
   */
  async healthCheck() {
    const logTag = '[healthCheck]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/health`,
      method: 'get',
    })
  }

  /**
   * @typedef {Object} searchPlantsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Search string to filter plants by common or scientific name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Leafy search returns results in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Search Plants Dictionary
   * @description Provides a searchable list of plants from the Leafy database for selecting a plant name in Get Care Guide and Diagnose Plant. The option value is the plant name expected by those operations.
   * @route POST /search-plants-dictionary
   * @paramDef {"type":"searchPlantsDictionary__payload","label":"Payload","name":"payload","description":"Contains the search string used to filter plants by common or scientific name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Monstera deliciosa","value":"Monstera deliciosa","note":"Araceae - Swiss cheese plant"}],"cursor":null}
   */
  async searchPlantsDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[searchPlantsDictionary]'

    if (!search) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/search`,
      method: 'get',
      query: {
        q: search,
        limit: DEFAULT_SEARCH_LIMIT,
      },
    })

    const results = response.results || []

    return {
      items: results.map(plant => {
        const commonNames = (plant.common_names || []).join(', ')
        const noteParts = [plant.family, commonNames].filter(Boolean)

        return {
          label: plant.name,
          value: plant.name,
          note: noteParts.join(' - ') || undefined,
        }
      }),
      cursor: null,
    }
  }
}

Flowrunner.ServerCode.addService(LeafyPlantService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Leafy Plant API key (sent as the x-api-key header). Get it from https://leafyplant.app/developers',
  },
])
