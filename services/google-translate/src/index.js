const logger = {
  info: (...args) => console.log('[Google Translate] info:', ...args),
  debug: (...args) => console.log('[Google Translate] debug:', ...args),
  error: (...args) => console.log('[Google Translate] error:', ...args),
  warn: (...args) => console.log('[Google Translate] warn:', ...args),
}

const API_BASE_URL = 'https://translation.googleapis.com/language/translate/v2'

const DEFAULT_LANGUAGE_NAMES_TARGET = 'en'

const NAMED_HTML_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: '\'',
  nbsp: ' ',
}

/**
 * The v2 API returns HTML-escaped text (e.g. &#39; for an apostrophe) even when format=text.
 * This decodes numeric (decimal and hex) and the common named entities back to plain characters.
 */
function decodeHtmlEntities(text) {
  if (typeof text !== 'string') {
    return text
  }

  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name) => NAMED_HTML_ENTITIES[name])
}

/**
 * @integrationName Google Translate
 * @integrationIcon /icon.svg
 */
class GoogleTranslateService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ 'Content-Type': 'application/json' })
        .query({ ...(query || {}), key: this.apiKey })

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.error?.message || error.body?.message ||
        (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))

      logger.error(`${ logTag } - Request failed: ${ message }`)

      throw new Error(`Google Translate API error: ${ message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  async #fetchLanguages(namesTarget) {
    const response = await this.#apiRequest({
      logTag: '[fetchLanguages]',
      url: `${ API_BASE_URL }/languages`,
      method: 'get',
      query: { target: namesTarget || DEFAULT_LANGUAGE_NAMES_TARGET },
    })

    return response.data?.languages || []
  }

  #languagesToDictionaryItems(languages, search) {
    const normalizedSearch = (search || '').trim().toLowerCase()

    const matched = normalizedSearch
      ? languages.filter(({ language, name }) =>
        (name || '').toLowerCase().includes(normalizedSearch) ||
        (language || '').toLowerCase().includes(normalizedSearch))
      : languages

    return matched.map(({ language, name }) => ({
      label: name || language,
      value: language,
      note: language,
    }))
  }

  /**
   * @operationName Translate Text
   * @category Translation
   * @description Translates text into the target language using Google Cloud Translation (v2). Accepts a single string or an array of up to 128 strings mapped from a previous step. When Source Language is empty, Google auto-detects it and returns the detected code per translation. HTML-escaped characters that the API returns in Text format (e.g. &#39;) are automatically decoded back to plain characters; in HTML format the markup is preserved as returned by Google.
   * @route POST /translate
   *
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text to translate. Enter a single string, or map an array of strings from a previous step to translate up to 128 strings in one call."}
   * @paramDef {"type":"String","label":"Target Language","name":"targetLanguage","required":true,"dictionary":"getTargetLanguagesDictionary","description":"Language to translate into. Select from the list or provide an ISO-639-1 code such as es, fr, or de."}
   * @paramDef {"type":"String","label":"Source Language","name":"sourceLanguage","dictionary":"getSourceLanguagesDictionary","description":"Language of the input text. Leave empty to let Google auto-detect it; the detected code is returned with each translation."}
   * @paramDef {"type":"String","label":"Format","name":"format","defaultValue":"Text","uiComponent":{"type":"DROPDOWN","options":{"values":["Text","HTML"]}},"description":"Format of the input text. Choose Text for plain text (default) or HTML to translate markup while preserving tags."}
   *
   * @returns {Object}
   * @sampleResult {"translations":[{"translatedText":"Hola, ¿cómo estás?","detectedSourceLanguage":"en"}]}
   */
  async translateText(text, targetLanguage, sourceLanguage, format) {
    const logTag = '[translateText]'

    const q = Array.isArray(text) ? text : [text]
    const resolvedFormat = this.#resolveChoice(format, { 'Text': 'text', 'HTML': 'html' }) || 'text'

    const body = {
      q,
      target: targetLanguage,
      format: resolvedFormat,
    }

    if (sourceLanguage) {
      body.source = sourceLanguage
    }

    const response = await this.#apiRequest({
      logTag,
      url: API_BASE_URL,
      method: 'post',
      body,
    })

    const translations = (response.data?.translations || []).map(translation => ({
      ...translation,
      translatedText: resolvedFormat === 'text'
        ? decodeHtmlEntities(translation.translatedText)
        : translation.translatedText,
    }))

    return { translations }
  }

  /**
   * @operationName Detect Language
   * @category Language Detection
   * @description Detects the language of the provided text using Google Cloud Translation (v2). Returns the most likely ISO-639-1 language code with a confidence score between 0 and 1, plus the full list of detections. Accepts a single string or an array of strings mapped from a previous step; with an array, the top-level language and confidence reflect the first string.
   * @route POST /detect
   *
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text whose language should be detected. Enter a single string, or map an array of strings from a previous step to detect each one."}
   *
   * @returns {Object}
   * @sampleResult {"language":"en","confidence":0.98,"detections":[{"language":"en","confidence":0.98,"isReliable":false}]}
   */
  async detectLanguage(text) {
    const logTag = '[detectLanguage]'

    const q = Array.isArray(text) ? text : [text]

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/detect`,
      method: 'post',
      body: { q },
    })

    // The API nests detections as an array of arrays (one inner array per input string) - flatten it.
    const detections = (response.data?.detections || [])
      .map(entry => (Array.isArray(entry) ? entry[0] : entry))
      .filter(Boolean)

    const top = detections[0] || {}

    return {
      language: top.language,
      confidence: top.confidence,
      detections,
    }
  }

  /**
   * @operationName List Languages
   * @category Language Detection
   * @description Lists all languages supported by Google Cloud Translation (v2). Each entry contains the ISO-639-1 language code (used as Target Language or Source Language in Translate Text) and the language's display name, localized to the requested Names Language.
   * @route GET /languages
   *
   * @paramDef {"type":"String","label":"Names Language","name":"namesLanguage","description":"ISO-639-1 code of the language in which to return the display names, e.g. en, es, fr. Defaults to en (English names)."}
   *
   * @returns {Object}
   * @sampleResult {"languages":[{"language":"en","name":"English"},{"language":"es","name":"Spanish"},{"language":"fr","name":"French"}]}
   */
  async listLanguages(namesLanguage) {
    const languages = await this.#fetchLanguages(namesLanguage)

    return { languages }
  }

  /**
   * @typedef {Object} getTargetLanguagesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Search string to filter languages by name or ISO-639-1 code."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. The full language list is returned in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Target Languages Dictionary
   * @description Provides the list of languages Google Cloud Translation can translate into, for selecting the Target Language in Translate Text. The option label is the English language name and the value is the ISO-639-1 code.
   * @route POST /get-target-languages-dictionary
   * @paramDef {"type":"getTargetLanguagesDictionary__payload","label":"Payload","name":"payload","description":"Contains the search string used to filter languages by name or code."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Spanish","value":"es","note":"es"},{"label":"French","value":"fr","note":"fr"}],"cursor":null}
   */
  async getTargetLanguagesDictionary(payload) {
    const { search } = payload || {}

    const languages = await this.#fetchLanguages()

    return {
      items: this.#languagesToDictionaryItems(languages, search),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getSourceLanguagesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Search string to filter languages by name or ISO-639-1 code."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. The full language list is returned in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Source Languages Dictionary
   * @description Provides the list of languages Google Cloud Translation can translate from, for selecting the optional Source Language in Translate Text. The option label is the English language name and the value is the ISO-639-1 code; leave the parameter empty to auto-detect.
   * @route POST /get-source-languages-dictionary
   * @paramDef {"type":"getSourceLanguagesDictionary__payload","label":"Payload","name":"payload","description":"Contains the search string used to filter languages by name or code."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"English","value":"en","note":"en"},{"label":"German","value":"de","note":"de"}],"cursor":null}
   */
  async getSourceLanguagesDictionary(payload) {
    const { search } = payload || {}

    const languages = await this.#fetchLanguages()

    return {
      items: this.#languagesToDictionaryItems(languages, search),
      cursor: null,
    }
  }
}

Flowrunner.ServerCode.addService(GoogleTranslateService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Google Cloud API key with the Cloud Translation API enabled. Create it in the GCP Console under APIs & Services > Credentials > Create credentials > API key. For security, restrict the key to the Cloud Translation API.',
  },
])
