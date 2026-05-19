'use strict'

const API_BASE_URL = 'https://api.dataforseo.com/v3'
const DEFAULT_LANGUAGE_CODE = 'en'
const DEFAULT_LOCATION_CODE = 2840
const DEFAULT_DEPTH = 10
const LOCATIONS_CACHE_TTL_MS = 24 * 60 * 60 * 1000

const logger = {
  info: (...args) => console.log('[DataForSEO Service] info:', ...args),
  debug: (...args) => console.log('[DataForSEO Service] debug:', ...args),
  error: (...args) => console.log('[DataForSEO Service] error:', ...args),
  warn: (...args) => console.log('[DataForSEO Service] warn:', ...args),
}

/**
 * @integrationName DataForSEO
 * @integrationIcon /logo.png
 */
class DataForSEOService {
  /**
   * @typedef {Object} getLocationsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter locations by name. Filtering is performed locally on cached results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getLanguagesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter languages by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  constructor(config) {
    this.login = config.login
    this.password = config.password
    this._locationsCache = null
  }

  #getAuthHeader() {
    const credentials = Buffer.from(`${ this.login }:${ this.password }`).toString('base64')

    return {
      'Authorization': `Basic ${ credentials }`,
      'Content-Type': 'application/json',
    }
  }

  async #apiRequest({ url, method, body, logTag }) {
    method = method || 'post'

    const payload = method === 'get' ? undefined : (Array.isArray(body) ? body : [body])

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }]`)

      const response = await Flowrunner.Request[method](url)
        .set(this.#getAuthHeader())
        .send(payload)

      if (response.status_code !== 20000) {
        throw new Error(response.status_message || `API error: status ${ response.status_code }`)
      }

      if (!response.tasks || !response.tasks.length) {
        throw new Error('No tasks returned in API response')
      }

      const task = response.tasks[0]

      if (task.status_code !== 20000) {
        throw new Error(task.status_message || `Task error: status ${ task.status_code }`)
      }

      return task.result || []
    } catch (error) {
      logger.error(`${ logTag } - error: ${ error.message }`)
      throw error
    }
  }

  #parseKeywords(input, maxCount, endpointName) {
    const keywords = [...new Set(
      input
        .split(',')
        .map(k => k.trim().toLowerCase())
        .filter(Boolean)
    )]

    if (keywords.length > maxCount) {
      throw new Error(`Keyword count (${ keywords.length }) exceeds maximum (${ maxCount }) for ${ endpointName }. Reduce input or split across multiple calls.`)
    }

    return keywords
  }

  #normalizeTarget(target) {
    let normalized = target

    normalized = normalized.replace(/^https?:\/\//i, '')
    normalized = normalized.replace(/^www\./i, '')
    normalized = normalized.replace(/\/.*$/, '')
    normalized = normalized.toLowerCase().replace(/\/$/, '')

    if (normalized !== target) {
      logger.warn(`[Keywords For Site] target normalized: '${ target }' -> '${ normalized }'`)
    }

    return normalized
  }

  // ──────────────────────────────────────────────
  //  SERP Actions
  // ──────────────────────────────────────────────

  /**
   * @operationName Google Organic Search
   * @category SERP
   * @appearanceColor #1A73E8 #4A9AF5
   * @description Retrieves Google organic search results live for a keyword in a specific location and language. The 'resultFormat' parameter selects payload richness: 'regular' returns organic, paid, and featured_snippet items (sufficient for rank tracking and URL/title/description analysis); 'advanced' additionally returns knowledge_graph, local_pack, ai_overview, people_also_ask, carousels, and other SERP features. Both formats cost the same per call; cost scales with the 'depth' parameter (billed per 10 results).
   * @route POST /serp-google-organic
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Keyword","name":"keyword","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The search query to look up in Google organic results."}
   * @paramDef {"type":"Number","label":"Location","name":"locationCode","default":2840,"dictionary":"getLocationsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"DataForSEO location code for geo-targeted results. Default is 2840 (United States)."}
   * @paramDef {"type":"String","label":"Language","name":"languageCode","default":"en","dictionary":"getLanguagesDictionary","description":"Language code for search results. Default is en (English)."}
   * @paramDef {"type":"Number","label":"Result Depth","name":"depth","default":10,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of search results to retrieve, from 10 to 200. DataForSEO bills in 10-result increments; depth=20 costs twice depth=10, and so on. Default is 10."}
   * @paramDef {"type":"String","label":"Device","name":"device","default":"desktop","uiComponent":{"type":"DROPDOWN","options":{"values":["desktop","mobile"]}},"description":"Device type to emulate for the search. Desktop and mobile SERPs can differ significantly."}
   * @paramDef {"type":"String","label":"Result Format","name":"resultFormat","default":"regular","uiComponent":{"type":"DROPDOWN","options":{"values":["regular","advanced"]}},"description":"'regular' returns organic, paid, and featured_snippet items only — slimmer payload, easier to parse. 'advanced' adds rich SERP features (knowledge_graph, local_pack, ai_overview, people_also_ask, carousels). Cost is identical; choose 'advanced' only when you need those extra item types."}
   *
   * @returns {Object}
   * @sampleResult {"keyword":"flowrunner","type":"organic","se_domain":"google.com","location_code":2840,"language_code":"en","check_url":"https://www.google.com/search?q=flowrunner&num=10&hl=en&gl=US","se_results_count":12500000,"items_count":10,"items":[{"type":"featured_snippet","rank_group":1,"rank_absolute":1,"domain":"example.com","title":"What is FlowRunner?","description":"FlowRunner is a workflow automation platform...","url":"https://example.com/flowrunner"},{"type":"organic","rank_group":1,"rank_absolute":2,"domain":"example.com","title":"FlowRunner - Workflow Automation","url":"https://example.com/flowrunner","description":"FlowRunner is a powerful workflow automation platform...","breadcrumb":"https://example.com › products › flowrunner"}]}
   */
  async serpGoogleOrganic(keyword, locationCode, languageCode, depth, device, resultFormat) {
    locationCode = locationCode || DEFAULT_LOCATION_CODE
    languageCode = languageCode || DEFAULT_LANGUAGE_CODE
    depth = depth || DEFAULT_DEPTH
    device = device || 'desktop'
    resultFormat = resultFormat || 'regular'

    const result = await this.#apiRequest({
      url: `${ API_BASE_URL }/serp/google/organic/live/${ resultFormat }`,
      body: { keyword, location_code: locationCode, language_code: languageCode, depth, device },
      logTag: 'serpGoogleOrganic',
    })

    return result[0] || {}
  }

  /**
   * @operationName Google Maps Search
   * @category SERP
   * @appearanceColor #1A73E8 #4A9AF5
   * @description Retrieves Google Maps local search results live for a keyword. Returns business listings with names, addresses, ratings, and review counts. Ideal for local SEO monitoring, competitor mapping, and location-based market analysis. DataForSEO offers only an Advanced variant for Maps (no Regular).
   * @route POST /serp-google-maps
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Keyword","name":"keyword","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The search query to look up in Google Maps results."}
   * @paramDef {"type":"Number","label":"Location","name":"locationCode","default":2840,"dictionary":"getLocationsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"DataForSEO location code for geo-targeted results. Default is 2840 (United States)."}
   * @paramDef {"type":"String","label":"Language","name":"languageCode","default":"en","dictionary":"getLanguagesDictionary","description":"Language code for search results. Default is en (English)."}
   * @paramDef {"type":"Number","label":"Result Depth","name":"depth","default":100,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of search results to retrieve, from 10 to 700. Unlike Google/Bing Organic, Maps is billed per 100-result SERP — lowering depth below 100 does not reduce cost, only the number of returned results. Default is 100."}
   *
   * @returns {Object}
   * @sampleResult {"keyword":"pizza near me","type":"maps","se_domain":"google.com","location_code":2840,"language_code":"en","items_count":10,"items":[{"type":"maps_search","rank_group":1,"rank_absolute":1,"domain":"example.com","title":"Joe's Pizza","url":"https://www.google.com/maps/place/Joe's+Pizza","rating":{"rating_type":"Max5","value":4.5,"votes_count":1250},"address":"123 Main St, New York, NY 10001","phone":"+12125551234"}]}
   */
  async serpGoogleMaps(keyword, locationCode, languageCode, depth) {
    locationCode = locationCode || DEFAULT_LOCATION_CODE
    languageCode = languageCode || DEFAULT_LANGUAGE_CODE
    depth = depth || 100

    const result = await this.#apiRequest({
      url: `${ API_BASE_URL }/serp/google/maps/live/advanced`,
      body: { keyword, location_code: locationCode, language_code: languageCode, depth },
      logTag: 'serpGoogleMaps',
    })

    return result[0] || {}
  }

  /**
   * @operationName Bing Organic Search
   * @category SERP
   * @appearanceColor #1A73E8 #4A9AF5
   * @description Retrieves Bing organic search results live for a keyword. The 'resultFormat' parameter selects payload richness: 'regular' returns organic, paid, and featured_snippet items (sufficient for rank tracking); 'advanced' adds rich SERP features. Both formats cost the same per call; cost scales with 'depth' (billed per 10 results). Useful for tracking Bing-specific rankings and diversifying search visibility analysis beyond Google.
   * @route POST /serp-bing-organic
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Keyword","name":"keyword","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The search query to look up in Bing organic results."}
   * @paramDef {"type":"Number","label":"Location","name":"locationCode","default":2840,"dictionary":"getLocationsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"DataForSEO location code for geo-targeted results. Default is 2840 (United States)."}
   * @paramDef {"type":"String","label":"Language","name":"languageCode","default":"en","dictionary":"getLanguagesDictionary","description":"Language code for search results. Default is en (English)."}
   * @paramDef {"type":"Number","label":"Result Depth","name":"depth","default":10,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of search results to retrieve, from 10 to 200. DataForSEO bills in 10-result increments; depth=20 costs twice depth=10, and so on. Default is 10."}
   * @paramDef {"type":"String","label":"Result Format","name":"resultFormat","default":"regular","uiComponent":{"type":"DROPDOWN","options":{"values":["regular","advanced"]}},"description":"'regular' returns organic, paid, and featured_snippet items only — slimmer payload, easier to parse. 'advanced' adds rich SERP features. Cost is identical; choose 'advanced' only when you need the extra item types."}
   *
   * @returns {Object}
   * @sampleResult {"keyword":"flowrunner","type":"organic","se_domain":"bing.com","location_code":2840,"language_code":"en","se_results_count":8400000,"items_count":10,"items":[{"type":"organic","rank_group":1,"rank_absolute":1,"domain":"example.com","title":"FlowRunner - Workflow Automation","url":"https://example.com/flowrunner","description":"FlowRunner is a powerful workflow automation platform...","breadcrumb":"https://example.com › products › flowrunner"}]}
   */
  async serpBingOrganic(keyword, locationCode, languageCode, depth, resultFormat) {
    locationCode = locationCode || DEFAULT_LOCATION_CODE
    languageCode = languageCode || DEFAULT_LANGUAGE_CODE
    depth = depth || DEFAULT_DEPTH
    resultFormat = resultFormat || 'regular'

    const result = await this.#apiRequest({
      url: `${ API_BASE_URL }/serp/bing/organic/live/${ resultFormat }`,
      body: { keyword, location_code: locationCode, language_code: languageCode, depth },
      logTag: 'serpBingOrganic',
    })

    return result[0] || {}
  }

  // ──────────────────────────────────────────────
  //  Keywords Data Actions
  // ──────────────────────────────────────────────

  /**
   * @operationName Get Keyword Search Volume
   * @category Keywords Data
   * @appearanceColor #1A73E8 #4A9AF5
   * @description Retrieves Google Ads search volume data for up to 1000 keywords in a single call. Returns monthly search volumes, CPC, competition level, and historical trends from the Google Ads API. This is the canonical volume source that marketers reference for traffic estimation and bid planning.
   * @route POST /keywords-search-volume
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Keywords","name":"keywords","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Comma-separated list of keywords to retrieve search volume for. Up to 1000 keywords per call. Whitespace-tolerant; duplicate and empty entries are removed before the API call."}
   * @paramDef {"type":"Number","label":"Location","name":"locationCode","default":2840,"dictionary":"getLocationsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"DataForSEO location code for geo-targeted results. Default is 2840 (United States)."}
   * @paramDef {"type":"String","label":"Language","name":"languageCode","default":"en","dictionary":"getLanguagesDictionary","description":"Language code for search results. Default is en (English)."}
   *
   * @returns {Object}
   * @sampleResult [{"keyword":"seo tools","search_volume":12100,"cpc":7.5,"competition":0.86,"competition_level":"HIGH","monthly_searches":[{"year":2025,"month":1,"search_volume":14800},{"year":2025,"month":2,"search_volume":12100}]}]
   */
  async keywordsSearchVolume(keywords, locationCode, languageCode) {
    locationCode = locationCode || DEFAULT_LOCATION_CODE
    languageCode = languageCode || DEFAULT_LANGUAGE_CODE

    const parsedKeywords = this.#parseKeywords(keywords, 1000, 'Get Keyword Search Volume')

    const result = await this.#apiRequest({
      url: `${ API_BASE_URL }/keywords_data/google_ads/search_volume/live`,
      body: { keywords: parsedKeywords, location_code: locationCode, language_code: languageCode },
      logTag: 'keywordsSearchVolume',
    })

    return result
  }

  // ──────────────────────────────────────────────
  //  Keyword Research Actions (DataForSEO Labs)
  // ──────────────────────────────────────────────

  /**
   * @operationName Get Keyword Overview
   * @category Keyword Research
   * @appearanceColor #1A73E8 #4A9AF5
   * @description Retrieves comprehensive keyword metrics for up to 700 keywords in a single call. Returns search volume, CPC, competition, keyword difficulty (0-100), search intent classification, and SERP feature data from DataForSEO Labs. More cost-effective than Google Ads API for enriched keyword analysis.
   * @route POST /labs-keyword-overview
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Keywords","name":"keywords","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Comma-separated list of keywords to analyze. Up to 700 keywords per call. Whitespace-tolerant; duplicate and empty entries are removed before the API call."}
   * @paramDef {"type":"Number","label":"Location","name":"locationCode","default":2840,"dictionary":"getLocationsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"DataForSEO location code for geo-targeted results. Default is 2840 (United States)."}
   * @paramDef {"type":"String","label":"Language","name":"languageCode","default":"en","dictionary":"getLanguagesDictionary","description":"Language code for search results. Default is en (English)."}
   *
   * @returns {Object}
   * @sampleResult [{"keyword":"seo tools","keyword_info":{"search_volume":12100,"cpc":7.5,"competition":0.86,"competition_level":"HIGH","monthly_searches":[{"year":2025,"month":1,"search_volume":14800}]},"keyword_properties":{"keyword_difficulty":72,"core_keyword":"seo tools","detected_language":"en"},"serp_info":{"se_results_count":450000000,"serp_item_types":["organic","paid","featured_snippet"]},"search_intent_info":{"main_intent":"commercial","foreign_intent":["informational"]},"avg_backlinks_info":{"backlinks":1250,"referring_domains":380}}]
   */
  async labsKeywordOverview(keywords, locationCode, languageCode) {
    locationCode = locationCode || DEFAULT_LOCATION_CODE
    languageCode = languageCode || DEFAULT_LANGUAGE_CODE

    const parsedKeywords = this.#parseKeywords(keywords, 700, 'Get Keyword Overview')

    const result = await this.#apiRequest({
      url: `${ API_BASE_URL }/dataforseo_labs/google/keyword_overview/live`,
      body: { keywords: parsedKeywords, location_code: locationCode, language_code: languageCode },
      logTag: 'labsKeywordOverview',
    })

    const items = result[0]?.items || []

    return items
  }

  /**
   * @operationName Get Bulk Keyword Difficulty
   * @category Keyword Research
   * @appearanceColor #1A73E8 #4A9AF5
   * @description Retrieves keyword difficulty scores (0-100 logarithmic scale) for up to 1000 keywords in a single call. The difficulty score indicates how hard it is to rank in the top-10 organic results. Ideal for large-scale opportunity scoring and content prioritization pipelines.
   * @route POST /labs-bulk-keyword-difficulty
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Keywords","name":"keywords","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Comma-separated list of keywords to score. Up to 1000 keywords per call. Whitespace-tolerant; duplicate and empty entries are removed before the API call."}
   * @paramDef {"type":"Number","label":"Location","name":"locationCode","default":2840,"dictionary":"getLocationsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"DataForSEO location code for geo-targeted results. Default is 2840 (United States)."}
   * @paramDef {"type":"String","label":"Language","name":"languageCode","default":"en","dictionary":"getLanguagesDictionary","description":"Language code for search results. Default is en (English)."}
   *
   * @returns {Object}
   * @sampleResult [{"se_type":"google","keyword":"seo tools","keyword_difficulty":72},{"se_type":"google","keyword":"best seo software","keyword_difficulty":65},{"se_type":"google","keyword":"keyword research tool","keyword_difficulty":58}]
   */
  async labsBulkKeywordDifficulty(keywords, locationCode, languageCode) {
    locationCode = locationCode || DEFAULT_LOCATION_CODE
    languageCode = languageCode || DEFAULT_LANGUAGE_CODE

    const parsedKeywords = this.#parseKeywords(keywords, 1000, 'Get Bulk Keyword Difficulty')

    const result = await this.#apiRequest({
      url: `${ API_BASE_URL }/dataforseo_labs/google/bulk_keyword_difficulty/live`,
      body: { keywords: parsedKeywords, location_code: locationCode, language_code: languageCode },
      logTag: 'labsBulkKeywordDifficulty',
    })

    const items = result[0]?.items || []

    return items
  }

  /**
   * @operationName Get Related Keywords
   * @category Keyword Research
   * @appearanceColor #1A73E8 #4A9AF5
   * @description Expands a single seed keyword into a tree of related keywords using SERP-overlap analysis. Returns keyword metrics including search volume, difficulty, CPC, and search intent for each related term. Depth controls expansion breadth and cost. Depth of keyword expansion. Higher depths return exponentially more keywords but cost proportionally more. depth=0: returns the seed keyword only (~$0.01 per call). depth=1: ~50-100 keywords (~$0.01-0.02 per call). depth=2: ~500-1500 keywords (~$0.06-0.16 per call). depth=3: ~2000-3500 keywords (~$0.21-0.36 per call). depth=4: up to 4680 keywords (~$0.48 per call). Default of 1 is conservative.
   * @route POST /labs-related-keywords
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Seed Keyword","name":"keyword","required":true,"description":"The seed keyword to expand into related terms. A single keyword or phrase."}
   * @paramDef {"type":"Number","label":"Location","name":"locationCode","default":2840,"dictionary":"getLocationsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"DataForSEO location code for geo-targeted results. Default is 2840 (United States)."}
   * @paramDef {"type":"String","label":"Language","name":"languageCode","default":"en","dictionary":"getLanguagesDictionary","description":"Language code for search results. Default is en (English)."}
   * @paramDef {"type":"Number","label":"Depth","name":"depth","default":1,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Depth of keyword expansion. Higher depths return exponentially more keywords but cost proportionally more. depth=0: returns the seed keyword only (~$0.01 per call). depth=1: ~50-100 keywords (~$0.01-0.02 per call). depth=2: ~500-1500 keywords (~$0.06-0.16 per call). depth=3: ~2000-3500 keywords (~$0.21-0.36 per call). depth=4: up to 4680 keywords (~$0.48 per call). Default of 1 is conservative. Increase only when expansion breadth matters more than per-call cost."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","default":100,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of related keywords to return. Default is 100, maximum is 1000."}
   *
   * @returns {Object}
   * @sampleResult {"seed_keyword":"seo tools","seed_keyword_data":{"keyword":"seo tools","keyword_info":{"search_volume":12100,"cpc":7.5,"competition":0.86},"keyword_properties":{"keyword_difficulty":72}},"items_count":15,"items":[{"keyword_data":{"keyword":"best seo tools","keyword_info":{"search_volume":6600,"cpc":6.2,"competition":0.78},"keyword_properties":{"keyword_difficulty":65},"search_intent_info":{"main_intent":"commercial"}},"related_keywords":["top seo software","seo tool comparison"]}]}
   */
  async labsRelatedKeywords(keyword, locationCode, languageCode, depth, limit) {
    locationCode = locationCode || DEFAULT_LOCATION_CODE
    languageCode = languageCode || DEFAULT_LANGUAGE_CODE
    depth = depth ?? 1
    limit = limit || 100

    if (depth < 0 || depth > 4) {
      throw new Error(`Invalid depth (${ depth }). Must be between 0 and 4.`)
    }

    const result = await this.#apiRequest({
      url: `${ API_BASE_URL }/dataforseo_labs/google/related_keywords/live`,
      body: { keyword, location_code: locationCode, language_code: languageCode, depth, limit },
      logTag: 'labsRelatedKeywords',
    })

    return result[0] || {}
  }

  /**
   * @operationName Get Keyword Suggestions
   * @category Keyword Research
   * @appearanceColor #1A73E8 #4A9AF5
   * @description Generates long-tail keyword suggestions from a single seed keyword using DataForSEO Labs full-text discovery. Returns keyword metrics including search volume, difficulty, CPC, and search intent for each suggestion. Ideal for content ideation and finding low-competition keyword opportunities.
   * @route POST /labs-keyword-suggestions
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Seed Keyword","name":"keyword","required":true,"description":"The seed keyword to generate suggestions from. A single keyword or phrase."}
   * @paramDef {"type":"Number","label":"Location","name":"locationCode","default":2840,"dictionary":"getLocationsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"DataForSEO location code for geo-targeted results. Default is 2840 (United States)."}
   * @paramDef {"type":"String","label":"Language","name":"languageCode","default":"en","dictionary":"getLanguagesDictionary","description":"Language code for search results. Default is en (English)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","default":100,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of keyword suggestions to return. Default is 100, maximum is 1000."}
   *
   * @returns {Object}
   * @sampleResult {"seed_keyword":"seo tools","items_count":10,"items":[{"keyword":"free seo tools","keyword_info":{"search_volume":8100,"cpc":4.2,"competition":0.65,"competition_level":"MEDIUM"},"keyword_properties":{"keyword_difficulty":55,"core_keyword":"seo tools"},"search_intent_info":{"main_intent":"commercial"}}]}
   */
  async labsKeywordSuggestions(keyword, locationCode, languageCode, limit) {
    locationCode = locationCode || DEFAULT_LOCATION_CODE
    languageCode = languageCode || DEFAULT_LANGUAGE_CODE
    limit = limit || 100

    const result = await this.#apiRequest({
      url: `${ API_BASE_URL }/dataforseo_labs/google/keyword_suggestions/live`,
      body: { keyword, location_code: locationCode, language_code: languageCode, limit },
      logTag: 'labsKeywordSuggestions',
    })

    return result[0] || {}
  }

  /**
   * @operationName Get Keywords For Site
   * @category Keyword Research
   * @appearanceColor #1A73E8 #4A9AF5
   * @description Discovers keywords that a target domain ranks for in organic search. Returns keyword metrics including search volume, difficulty, CPC, and search intent. Ideal for competitor keyword analysis, content gap discovery, and understanding a site's organic search footprint.
   * @route POST /labs-keywords-for-site
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Target Domain","name":"target","required":true,"description":"Domain to analyze. Accepts bare domain only - no protocol, no path, no trailing slash. example.com is correct. https://example.com, example.com/blog, and www.example.com are incorrect (use bare domain; subdomains controlled via the includeSubdomains parameter). The action will normalize input that includes a protocol or trailing slash, but path-specific or subdomain-specific targets will produce confusing results."}
   * @paramDef {"type":"Number","label":"Location","name":"locationCode","default":2840,"dictionary":"getLocationsDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"DataForSEO location code for geo-targeted results. Default is 2840 (United States)."}
   * @paramDef {"type":"String","label":"Language","name":"languageCode","default":"en","dictionary":"getLanguagesDictionary","description":"Language code for search results. Default is en (English)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","default":100,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of keywords to return. Default is 100, maximum is 1000."}
   * @paramDef {"type":"Boolean","label":"Include Subdomains","name":"includeSubdomains","default":true,"uiComponent":{"type":"TOGGLE"},"description":"Whether to include keywords from all subdomains of the target domain. Enabled by default."}
   *
   * @returns {Object}
   * @sampleResult {"target":"example.com","items_count":10,"items":[{"keyword":"example website","keyword_info":{"search_volume":2400,"cpc":1.2,"competition":0.3,"competition_level":"LOW"},"keyword_properties":{"keyword_difficulty":28,"core_keyword":"example website"},"search_intent_info":{"main_intent":"navigational"}}]}
   */
  async labsKeywordsForSite(target, locationCode, languageCode, limit, includeSubdomains) {
    locationCode = locationCode || DEFAULT_LOCATION_CODE
    languageCode = languageCode || DEFAULT_LANGUAGE_CODE
    limit = limit || 100
    includeSubdomains = includeSubdomains ?? true

    const normalizedTarget = this.#normalizeTarget(target)

    const result = await this.#apiRequest({
      url: `${ API_BASE_URL }/dataforseo_labs/google/keywords_for_site/live`,
      body: {
        target: normalizedTarget,
        location_code: locationCode,
        language_code: languageCode,
        limit,
        include_subdomains: includeSubdomains,
      },
      logTag: 'labsKeywordsForSite',
    })

    return result[0] || {}
  }

  // ──────────────────────────────────────────────
  //  Dictionary Methods
  // ──────────────────────────────────────────────

  /**
   * @registerAs DICTIONARY
   * @operationName Get Locations Dictionary
   * @description Provides a searchable list of DataForSEO locations with country codes for geo-targeted searches. Results are cached for 24 hours to minimize API calls.
   * @route POST /get-locations-dictionary
   * @paramDef {"type":"getLocationsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering locations."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"United States","value":2840,"note":"US"},{"label":"United Kingdom","value":2826,"note":"GB"}],"cursor":null}
   */
  async getLocationsDictionary(payload) {
    const { search } = payload || {}

    if (!this._locationsCache || (Date.now() - this._locationsCache.fetchedAt > LOCATIONS_CACHE_TTL_MS)) {
      logger.debug('getLocationsDictionary - fetching fresh locations list')

      const response = await Flowrunner.Request.get(`${ API_BASE_URL }/serp/google/locations`)
        .set(this.#getAuthHeader())

      const tasks = response.tasks || []
      const locations = tasks[0]?.result || []

      this._locationsCache = {
        items: locations.map(loc => ({
          label: loc.location_name,
          value: loc.location_code,
          note: loc.country_iso_code,
        })),
        fetchedAt: Date.now(),
      }

      logger.info(`getLocationsDictionary - cached ${ this._locationsCache.items.length } locations`)
    }

    let items = this._locationsCache.items

    if (search) {
      const lowerSearch = search.toLowerCase()

      items = items.filter(item =>
        item.label.toLowerCase().includes(lowerSearch) ||
        (item.note && item.note.toLowerCase().includes(lowerSearch))
      )
    }

    return {
      items: items.slice(0, 50),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Languages Dictionary
   * @description Provides a searchable list of languages supported by DataForSEO for search queries.
   * @route POST /get-languages-dictionary
   * @paramDef {"type":"getLanguagesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering languages."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"English","value":"en"},{"label":"Spanish","value":"es"},{"label":"French","value":"fr"}],"cursor":null}
   */
  async getLanguagesDictionary(payload) {
    const { search } = payload || {}

    const response = await Flowrunner.Request.get(`${ API_BASE_URL }/serp/google/languages`)
      .set(this.#getAuthHeader())

    const tasks = response.tasks || []
    const languages = tasks[0]?.result || []

    let items = languages.map(lang => ({
      label: lang.language_name,
      value: lang.language_code,
    }))

    if (search) {
      const lowerSearch = search.toLowerCase()

      items = items.filter(item =>
        item.label.toLowerCase().includes(lowerSearch) ||
        item.value.toLowerCase().includes(lowerSearch)
      )
    }

    return {
      items,
      cursor: null,
    }
  }
}

Flowrunner.ServerCode.addService(DataForSEOService, [
  {
    name: 'login',
    displayName: 'API Login',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'DataForSEO API login (email used at sign-up).',
  },
  {
    name: 'password',
    displayName: 'API Password',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'DataForSEO API password from app.dataforseo.com/api-access.',
  },
])
