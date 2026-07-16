const logger = {
  info: (...args) => console.log('[OpenThesaurus] info:', ...args),
  debug: (...args) => console.log('[OpenThesaurus] debug:', ...args),
  error: (...args) => console.log('[OpenThesaurus] error:', ...args),
  warn: (...args) => console.log('[OpenThesaurus] warn:', ...args),
}

const API_BASE_URL = 'https://www.openthesaurus.de'

// OpenThesaurus asks that automated clients identify themselves with contact info.
const USER_AGENT = 'FlowRunner-OpenThesaurus-Extension (https://flowrunner.io)'

/**
 * @integrationName OpenThesaurus
 * @integrationIcon /icon.png
 */
class OpenThesaurusService {
  constructor() {}

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', query, logTag }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(query || {}) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ 'User-Agent': USER_AGENT })
        .query(query || {})

      return await request
    } catch (error) {
      const status = error.status || error.statusCode
      const message = error.body?.message || error.message || 'Unknown error'

      logger.error(`${ logTag } - failed (status ${ status }): ${ message }`)

      throw new Error(`OpenThesaurus API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  /**
   * @operationName Get Synonyms
   * @category Thesaurus
   * @description Looks up German synonyms for a word using the OpenThesaurus thesaurus. Returns synonym groups (synsets), where every term in a group is a synonym of the query word — note that OpenThesaurus is a GERMAN-language dictionary, so both the query and all returned terms are German words. If the word is unknown the synsets array is simply empty (this is not an error). Optional flags expand the response: enable Similar Words to get up to five phonetically close terms (useful for typos), Substring Matches for words containing the query, Starts With for words beginning with the query, and Sub/Super Synsets to include the hyponyms (more specific) and hypernyms (more general) of each synonym group. Enable Base Form to also resolve the query's base/dictionary form.
   * @route GET /get-synonyms
   * @appearanceColor #0B7AC4 #4FB3E8
   *
   * @paramDef {"type":"String","label":"Word","name":"word","required":true,"description":"The German word to look up synonyms for, e.g. 'Test' or 'gehen'."}
   * @paramDef {"type":"Boolean","label":"Similar Words","name":"similar","uiComponent":{"type":"CHECKBOX"},"description":"When true, also return up to five phonetically similar words with their Levenshtein distance. Helpful for typos or uncertain spelling. Defaults to false."}
   * @paramDef {"type":"Boolean","label":"Substring Matches","name":"substring","uiComponent":{"type":"CHECKBOX"},"description":"When true, also return up to ten words that contain the query word as a substring. Defaults to false."}
   * @paramDef {"type":"Boolean","label":"Starts With","name":"startsWith","uiComponent":{"type":"CHECKBOX"},"description":"When true, also return words that begin with the query word. Defaults to false."}
   * @paramDef {"type":"Boolean","label":"Include Sub-Synsets","name":"subSynsets","uiComponent":{"type":"CHECKBOX"},"description":"When true, include the hyponyms (more specific terms) for each synonym group. Defaults to false."}
   * @paramDef {"type":"Boolean","label":"Include Super-Synsets","name":"superSynsets","uiComponent":{"type":"CHECKBOX"},"description":"When true, include the hypernyms (more general terms) for each synonym group. Defaults to false."}
   * @paramDef {"type":"Boolean","label":"Base Form","name":"baseForm","uiComponent":{"type":"CHECKBOX"},"description":"When true, also resolve and return the base (dictionary) form of the query word. Defaults to false."}
   *
   * @returns {Object}
   * @sampleResult {"metaData":{"apiVersion":"0.2","copyright":"Copyright (C) 2026 Daniel Naber (www.danielnaber.de)","license":"Creative Commons Attribution-ShareAlike 4.0 or GNU LESSER GENERAL PUBLIC LICENSE Version 2.1","source":"https://www.openthesaurus.de"},"synsets":[{"id":292,"categories":[],"terms":[{"term":"Erprobung"},{"term":"Probe"},{"term":"Prüfung"},{"term":"Test"},{"term":"Versuch"}]}],"similarterms":[{"term":"Text","distance":1}]}
   */
  async getSynonyms(word, similar, substring, startsWith, subSynsets, superSynsets, baseForm) {
    const logTag = '[getSynonyms]'

    // format=application/json is REQUIRED on every call — the API defaults to XML otherwise.
    const query = { q: word, format: 'application/json' }

    // Map each Boolean to its query param only when explicitly true.
    if (similar === true) query.similar = 'true'
    if (substring === true) query.substring = 'true'
    if (startsWith === true) query.startswith = 'true'
    if (subSynsets === true) query.subsynsets = 'true'
    if (superSynsets === true) query.supersynsets = 'true'
    if (baseForm === true) query.baseform = 'true'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/synonyme/search`,
      method: 'get',
      query,
    })
  }
}

// OpenThesaurus is a free, public, no-auth API, so no config items are required.
Flowrunner.ServerCode.addService(OpenThesaurusService, [])
