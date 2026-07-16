const logger = {
  info: (...args) => console.log('[LingvaNex] info:', ...args),
  debug: (...args) => console.log('[LingvaNex] debug:', ...args),
  error: (...args) => console.log('[LingvaNex] error:', ...args),
  warn: (...args) => console.log('[LingvaNex] warn:', ...args),
}

const API_BASE_URL = 'https://api-b2b.backenster.com/b1/api/v3'

const PLATFORM = 'api'

const TRANSLATE_MODE_MAP = {
  HTML: 'html',
  Text: 'text',
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
 * @integrationName LingvaNex
 * @integrationIcon /icon.svg
 */
class LingvaNexService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.apiKey }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      const response = body !== undefined ? await request.send(body) : await request

      // The LingvaNex API returns HTTP 200 with a non-null `err` field on logical failures.
      if (response && response.err !== undefined && response.err !== null && response.err !== '') {
        throw new Error(`LingvaNex API error: ${ response.err }`)
      }

      return response
    } catch (error) {
      if (error.message && error.message.startsWith('LingvaNex API error:')) {
        throw error
      }

      const apiErr = error.body?.err || error.body?.message
      const status = error.status || error.statusCode
      const message = apiErr || (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))

      logger.error(`${ logTag } - failed${ status ? ` (status ${ status })` : '' }: ${ message }`)

      throw new Error(`LingvaNex API error: ${ message }${ status ? ` (status ${ status })` : '' }`)
    }
  }

  /**
   * @operationName Translate
   * @category Translation
   * @description Translates text or HTML from one language to another using the LingvaNex Cloud translation engine. The input can be a single string or an array of strings (each translated independently). If the source language is omitted, LingvaNex auto-detects it. Language codes use the underscore locale form (lowercase language, uppercase country) such as en_GB, es_ES, fr_FR, ru_RU. Choose HTML mode to preserve markup/tags or Text mode for plain text. Optionally enable transliteration to also receive romanized forms of the source and target text.
   * @route POST /translate
   * @appearanceColor #2563EB #60A5FA
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"To Language","name":"to","required":true,"description":"Target language code in underscore locale form (e.g. en_GB, es_ES, fr_FR, de_DE, ru_RU). Use Get Languages to look up available codes."}
   * @paramDef {"type":"Array<String>","label":"Text","name":"data","required":true,"description":"The text or HTML to translate. Provide a single string, or multiple strings to translate several segments in one call. Each entry is translated independently."}
   * @paramDef {"type":"String","label":"From Language","name":"from","description":"Source language code in underscore locale form (e.g. en_GB, es_ES). Leave empty to auto-detect the source language."}
   * @paramDef {"type":"String","label":"Translate Mode","name":"translateMode","uiComponent":{"type":"DROPDOWN","options":{"values":["HTML","Text"]}},"description":"HTML preserves markup and tags during translation; Text treats the input as plain text. Defaults to HTML."}
   * @paramDef {"type":"Boolean","label":"Enable Transliteration","name":"enableTransliteration","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, the response also includes romanized (transliterated) forms of the source and target text. Defaults to false."}
   *
   * @returns {Object}
   * @sampleResult {"err":null,"result":"Bonjour le monde","sourceTransliteration":"Hello world","targetTransliteration":"Bonjour le monde","from":"en_GB","cacheUse":0}
   */
  async translate(to, data, from, translateMode, enableTransliteration) {
    const logTag = '[translate]'

    const body = clean({
      platform: PLATFORM,
      from,
      to,
      data: Array.isArray(data) && data.length === 1 ? data[0] : data,
      translateMode: this.#resolveChoice(translateMode, TRANSLATE_MODE_MAP) || 'html',
      enableTransliteration: enableTransliteration === true ? true : undefined,
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/translate`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Get Languages
   * @category Translation
   * @description Returns the full list of languages supported by LingvaNex, including each language's underscore locale code (e.g. en_GB, es_ES, fr_FR, ru_RU), display name, English name, code alpha, and flag/icon references. Use these codes for the From Language and To Language fields of Translate. Provide an optional interface code to localize the returned language names.
   * @route GET /getLanguages
   * @appearanceColor #2563EB #60A5FA
   *
   * @paramDef {"type":"String","label":"Names Language","name":"code","description":"Optional interface language code (underscore locale form, e.g. en_GB) used to localize the returned language names. Defaults to en_GB."}
   *
   * @returns {Object}
   * @sampleResult {"err":null,"result":[{"full_code":"en_GB","code_alpha_1":"en","englishName":"English","codeName":"English","flagPath":"/flags/afrikaans.png","modes":[{"name":"Translation","value":true}]}]}
   */
  async getLanguages(code) {
    const logTag = '[getLanguages]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/getLanguages`,
      method: 'get',
      query: {
        platform: PLATFORM,
        code: code || 'en_GB',
      },
    })
  }

  /**
   * @operationName Detect Language
   * @category Translation
   * @description Detects the most likely source language of the supplied text and returns its underscore locale code (e.g. en_GB, es_ES, ru_RU). Accepts a single string or an array of strings. Use the detected code as the From Language for a subsequent Translate call.
   * @route POST /detect
   * @appearanceColor #2563EB #60A5FA
   *
   * @paramDef {"type":"Array<String>","label":"Text","name":"data","required":true,"description":"The text to analyze. Provide a single string, or multiple strings to detect the language of each."}
   *
   * @returns {Object}
   * @sampleResult {"err":null,"result":"en_GB"}
   */
  async detectLanguage(data) {
    const logTag = '[detectLanguage]'

    const body = clean({
      platform: PLATFORM,
      data: Array.isArray(data) && data.length === 1 ? data[0] : data,
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/detect`,
      method: 'post',
      body,
    })
  }
}

Flowrunner.ServerCode.addService(LingvaNexService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your LingvaNex B2B Cloud API key. Get it from LingvaNex → account → API key. Sent as the Authorization: Bearer header.',
  },
])
