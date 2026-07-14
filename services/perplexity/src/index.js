'use strict'

const API_BASE_URL = 'https://api.perplexity.ai'

const DEFAULT_SONAR_MODEL = 'sonar'
const DEFAULT_EMBEDDINGS_MODEL = 'pplx-embed-v1-0.6b'
const DEFAULT_CONTEXT_EMBEDDINGS_MODEL = 'pplx-embed-context-v1-0.6b'

const SONAR_MODELS = {
  'Sonar': 'sonar',
  'Sonar Pro': 'sonar-pro',
  'Sonar Reasoning Pro': 'sonar-reasoning-pro',
  'Sonar Deep Research': 'sonar-deep-research',
}

const MESSAGE_ROLES = { 'System': 'system', 'User': 'user', 'Assistant': 'assistant' }

const SEARCH_MODES = { 'Web': 'web', 'Academic': 'academic', 'SEC Filings': 'sec' }

const RECENCY_FILTERS = { 'Hour': 'hour', 'Day': 'day', 'Week': 'week', 'Month': 'month', 'Year': 'year' }

const SEARCH_CONTEXT_SIZES = { 'Low': 'low', 'Medium': 'medium', 'High': 'high' }

const SEARCH_TYPES = { 'Auto': 'auto', 'Fast': 'fast', 'Pro': 'pro' }

const REASONING_EFFORTS = { 'Minimal': 'minimal', 'Low': 'low', 'Medium': 'medium', 'High': 'high' }

const AGENT_PRESETS = { 'Fast': 'fast', 'Low': 'low', 'Medium': 'medium', 'High': 'high', 'Extra High': 'xhigh' }

const AGENT_REASONING_EFFORTS = {
  'Minimal': 'minimal', 'Low': 'low', 'Medium': 'medium', 'High': 'high', 'Extra High': 'xhigh', 'Max': 'max',
}

const AGENT_TOOLS = {
  'Web Search': 'web_search',
  'Finance Search': 'finance_search',
  'People Search': 'people_search',
  'Fetch URL': 'fetch_url',
  'Sandbox': 'sandbox',
}

const EMBEDDINGS_MODELS = {
  'Perplexity Embed v1 (0.6B)': 'pplx-embed-v1-0.6b',
  'Perplexity Embed v1 (4B)': 'pplx-embed-v1-4b',
}

const CONTEXT_EMBEDDINGS_MODELS = {
  'Perplexity Contextual Embed v1 (0.6B)': 'pplx-embed-context-v1-0.6b',
  'Perplexity Contextual Embed v1 (4B)': 'pplx-embed-context-v1-4b',
}

const ENCODING_FORMATS = { 'Base64 Int8': 'base64_int8', 'Base64 Binary': 'base64_binary' }

const logger = {
  info: (...args) => console.log('[Perplexity] info:', ...args),
  debug: (...args) => console.log('[Perplexity] debug:', ...args),
  error: (...args) => console.log('[Perplexity] error:', ...args),
  warn: (...args) => console.log('[Perplexity] warn:', ...args),
}

/**
 * @integrationName Perplexity
 * @integrationIcon /icon.png
 */
class PerplexityService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  async #apiRequest({ url, method = 'post', body, query, logTag }) {
    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }]`)

      const request = Flowrunner.Request[method](url)
        .query(query || {})
        .set({ 'Authorization': `Bearer ${ this.apiKey }` })

      if (body !== undefined) {
        request.set({ 'Content-Type': 'application/json' }).send(body)
      }

      return await request
    } catch (error) {
      const errorMsg = normalizeErrorMessage(error)

      logger.error(`${ logTag } - error: ${ errorMsg }`)

      throw new Error(errorMsg)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #normalizeMessages(messages) {
    return messages.map(message => ({
      ...message,
      role: this.#resolveChoice(message.role, MESSAGE_ROLES) || message.role,
    }))
  }

  #buildJsonSchemaResponseFormat(jsonSchema) {
    if (!jsonSchema || !Object.keys(jsonSchema).length) {
      return undefined
    }

    // Accept either a full { type, json_schema } object or a bare JSON Schema.
    if (jsonSchema.type === 'json_schema' && jsonSchema.json_schema) {
      return jsonSchema
    }

    return { type: 'json_schema', json_schema: { schema: jsonSchema } }
  }

  /**
   * @typedef {Object} ChatMessage
   * @paramDef {"type":"String","label":"Role","name":"role","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["System","User","Assistant"]}},"description":"The author of the message. 'System' sets behavior, 'User' asks, 'Assistant' holds prior model replies."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text content of the message."}
   */

  /**
   * @typedef {Object} DocumentChunks
   * @paramDef {"type":"Array<String>","label":"Chunks","name":"chunks","required":true,"description":"The ordered text chunks of a single document. Each document supports up to 32K tokens."}
   */

  /**
   * @typedef {Object} getAgentModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — Perplexity's model list is not paginated."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Agent Models Dictionary
   * @description Provides a searchable, live list of models available for the Perplexity Agent API (Perplexity Sonar plus frontier models from OpenAI, Anthropic, Google and xAI) for dynamic parameter selection.
   * @route POST /get-agent-models-dictionary
   * @paramDef {"type":"getAgentModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"perplexity/sonar","value":"perplexity/sonar","note":"perplexity"},{"label":"anthropic/claude-sonnet-5","value":"anthropic/claude-sonnet-5","note":"anthropic"}],"cursor":null}
   */
  async getAgentModelsDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/models`,
      method: 'get',
      logTag: 'getAgentModelsDictionary',
    })

    let models = response.data || []

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      models = models.filter(model => model.id.toLowerCase().includes(searchLower))
    }

    return {
      items: models
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(model => ({ label: model.id, value: model.id, note: model.owned_by || null })),
      cursor: null,
    }
  }

  /**
   * @operationName Ask
   * @description Asks Perplexity a question and returns a web-grounded answer using a Sonar model. Perplexity searches the live web (or academic papers / SEC filings), synthesizes an answer and returns the text together with its citations, the underlying search results, and optional related follow-up questions. 'Sonar Deep Research' performs exhaustive multi-step research and can take several minutes — prefer Create Async Chat Completion for it.
   * @category Sonar
   * @route POST /ask
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The question or instruction to send to Perplexity."}
   * @paramDef {"type":"String","label":"Model","name":"model","uiComponent":{"type":"DROPDOWN","options":{"values":["Sonar","Sonar Pro","Sonar Reasoning Pro","Sonar Deep Research"]}},"defaultValue":"Sonar","description":"The Sonar model to use. 'Sonar' is fast and cost-effective, 'Sonar Pro' handles complex queries, 'Sonar Reasoning Pro' adds chain-of-thought reasoning, 'Sonar Deep Research' produces exhaustive research reports."}
   * @paramDef {"type":"String","label":"System Prompt","name":"systemPrompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional system instructions that set the answer's tone, format and constraints. Note: the system prompt does not affect which sources are searched."}
   * @paramDef {"type":"String","label":"Search Mode","name":"searchMode","uiComponent":{"type":"DROPDOWN","options":{"values":["Web","Academic","SEC Filings"]}},"defaultValue":"Web","description":"Where Perplexity searches: the general web, scholarly sources ('Academic'), or SEC filings."}
   * @paramDef {"type":"String","label":"Search Recency","name":"searchRecencyFilter","uiComponent":{"type":"DROPDOWN","options":{"values":["Hour","Day","Week","Month","Year"]}},"description":"Only use sources published within this time window. Leave empty for no recency restriction."}
   * @paramDef {"type":"Array<String>","label":"Search Domain Filter","name":"searchDomainFilter","description":"Restrict or exclude web domains, e.g. [\"wikipedia.org\",\"-reddit.com\"] (prefix with '-' to exclude). Up to 20 entries."}
   * @paramDef {"type":"Boolean","label":"Return Related Questions","name":"returnRelatedQuestions","uiComponent":{"type":"TOGGLE"},"description":"When enabled, Perplexity also returns suggested follow-up questions."}
   * @paramDef {"type":"Number","label":"Max Tokens","name":"maxTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens the model may generate for the answer (up to 128000)."}
   *
   * @returns {Object}
   * @sampleResult {"answer":"SpaceX's Starship completed its latest orbital test in June 2026, achieving full booster recovery.","citations":["https://www.spacex.com/updates"],"searchResults":[{"title":"Starship Flight Updates","url":"https://www.spacex.com/updates","date":"2026-06-12"}],"relatedQuestions":["What is the next Starship launch date?"],"model":"sonar","usage":{"prompt_tokens":14,"completion_tokens":42,"total_tokens":56},"id":"b7a1c3ee-2f1a-4b8e-9a3d-4c0f0e6d1a22"}
   */
  async ask(prompt, model, systemPrompt, searchMode, searchRecencyFilter, searchDomainFilter, returnRelatedQuestions, maxTokens) {
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    const messages = []

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt })
    }

    messages.push({ role: 'user', content: prompt })

    const body = {
      model: this.#resolveChoice(model, SONAR_MODELS) || DEFAULT_SONAR_MODEL,
      messages,
    }

    const resolvedSearchMode = this.#resolveChoice(searchMode, SEARCH_MODES)
    const resolvedRecency = this.#resolveChoice(searchRecencyFilter, RECENCY_FILTERS)

    if (resolvedSearchMode && resolvedSearchMode !== 'web') body.search_mode = resolvedSearchMode
    if (resolvedRecency) body.search_recency_filter = resolvedRecency
    if (searchDomainFilter?.length) body.search_domain_filter = searchDomainFilter
    if (returnRelatedQuestions) body.return_related_questions = true
    if (maxTokens) body.max_tokens = maxTokens

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/sonar`,
      body,
      logTag: 'ask',
    })

    return {
      answer: response.choices?.[0]?.message?.content ?? '',
      citations: response.citations ?? [],
      searchResults: response.search_results ?? [],
      relatedQuestions: response.related_questions ?? [],
      model: response.model,
      usage: response.usage ?? null,
      id: response.id,
    }
  }

  /**
   * @operationName Chat Completion (Advanced)
   * @description Sends a fully custom chat completion request to Perplexity's Sonar API with a complete messages array and every available control: search mode (web/academic/SEC), domain, language, recency and publish/update date filters, image results and image filters, related questions, web search options (context size, search type, user location), structured JSON output via a JSON Schema, and reasoning effort for reasoning models. Returns the raw API response including choices, citations, search results, images and usage.
   * @category Sonar
   * @route POST /chat-completion-advanced
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"Array<ChatMessage>","label":"Messages","name":"messages","required":true,"description":"The conversation so far. Roles must alternate correctly: optional 'System' messages first, then 'User', with 'User' and 'Assistant' alternating and the last message from 'User'."}
   * @paramDef {"type":"String","label":"Model","name":"model","uiComponent":{"type":"DROPDOWN","options":{"values":["Sonar","Sonar Pro","Sonar Reasoning Pro","Sonar Deep Research"]}},"defaultValue":"Sonar","description":"The Sonar model to use. 'Sonar Deep Research' performs long-running exhaustive research — prefer Create Async Chat Completion for it."}
   * @paramDef {"type":"Number","label":"Max Tokens","name":"maxTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens the model may generate (up to 128000)."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature between 0 and 2. Higher values produce more random output."}
   * @paramDef {"type":"Number","label":"Top P","name":"topP","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Nucleus sampling threshold between 0 and 1. Alter this or Temperature, not both."}
   * @paramDef {"type":"String","label":"Search Mode","name":"searchMode","uiComponent":{"type":"DROPDOWN","options":{"values":["Web","Academic","SEC Filings"]}},"defaultValue":"Web","description":"Where Perplexity searches: the general web, scholarly sources ('Academic'), or SEC filings."}
   * @paramDef {"type":"Boolean","label":"Disable Search","name":"disableSearch","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the model answers without performing any web search (no citations)."}
   * @paramDef {"type":"Boolean","label":"Enable Search Classifier","name":"enableSearchClassifier","uiComponent":{"type":"TOGGLE"},"description":"When enabled, a classifier decides automatically whether the query actually needs a web search, saving cost on queries that don't."}
   * @paramDef {"type":"Array<String>","label":"Search Domain Filter","name":"searchDomainFilter","description":"Restrict or exclude web domains, e.g. [\"wikipedia.org\",\"-reddit.com\"] (prefix with '-' to exclude). Up to 20 entries."}
   * @paramDef {"type":"Array<String>","label":"Search Language Filter","name":"searchLanguageFilter","description":"Restrict sources to these languages as ISO 639-1 codes, e.g. [\"en\",\"de\"]. Up to 20 entries."}
   * @paramDef {"type":"String","label":"Search Recency","name":"searchRecencyFilter","uiComponent":{"type":"DROPDOWN","options":{"values":["Hour","Day","Week","Month","Year"]}},"description":"Only use sources published within this time window."}
   * @paramDef {"type":"String","label":"Published After","name":"searchAfterDateFilter","description":"Only use sources published after this date, in MM/DD/YYYY format, e.g. '03/01/2026'."}
   * @paramDef {"type":"String","label":"Published Before","name":"searchBeforeDateFilter","description":"Only use sources published before this date, in MM/DD/YYYY format."}
   * @paramDef {"type":"String","label":"Last Updated After","name":"lastUpdatedAfterFilter","description":"Only use sources last updated after this date, in MM/DD/YYYY format."}
   * @paramDef {"type":"String","label":"Last Updated Before","name":"lastUpdatedBeforeFilter","description":"Only use sources last updated before this date, in MM/DD/YYYY format."}
   * @paramDef {"type":"Boolean","label":"Return Images","name":"returnImages","uiComponent":{"type":"TOGGLE"},"description":"When enabled, image results from the search are included in the response."}
   * @paramDef {"type":"Array<String>","label":"Image Format Filter","name":"imageFormatFilter","description":"Only return images of these formats, e.g. [\"jpeg\",\"png\"]. Requires Return Images."}
   * @paramDef {"type":"Array<String>","label":"Image Domain Filter","name":"imageDomainFilter","description":"Restrict or exclude image source domains (prefix with '-' to exclude). Requires Return Images."}
   * @paramDef {"type":"Boolean","label":"Return Related Questions","name":"returnRelatedQuestions","uiComponent":{"type":"TOGGLE"},"description":"When enabled, Perplexity also returns suggested follow-up questions."}
   * @paramDef {"type":"String","label":"Search Context Size","name":"searchContextSize","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Medium","High"]}},"description":"How much search context is retrieved for the answer: 'Low' minimizes cost, 'High' maximizes comprehensiveness. Defaults to 'Low'."}
   * @paramDef {"type":"String","label":"Search Type","name":"searchType","uiComponent":{"type":"DROPDOWN","options":{"values":["Auto","Fast","Pro"]}},"description":"The web search tier: 'Fast' prioritizes latency, 'Pro' prioritizes quality, 'Auto' lets Perplexity choose."}
   * @paramDef {"type":"Object","label":"User Location","name":"userLocation","description":"Approximate user location to refine search relevance, e.g. {\"country\":\"US\",\"city\":\"Austin\",\"region\":\"Texas\"} or {\"latitude\":30.27,\"longitude\":-97.74}."}
   * @paramDef {"type":"Object","label":"JSON Schema","name":"jsonSchema","description":"A JSON Schema the answer must conform to, e.g. {\"type\":\"object\",\"properties\":{\"title\":{\"type\":\"string\"}},\"required\":[\"title\"]}. When provided, the model returns structured JSON instead of prose."}
   * @paramDef {"type":"String","label":"Reasoning Effort","name":"reasoningEffort","uiComponent":{"type":"DROPDOWN","options":{"values":["Minimal","Low","Medium","High"]}},"description":"How much effort a reasoning model spends thinking. Applies to reasoning models such as 'Sonar Reasoning Pro' and 'Sonar Deep Research'."}
   * @paramDef {"type":"String","label":"Language Preference","name":"languagePreference","description":"Preferred response language as an ISO 639-1 code, e.g. 'en' or 'es'."}
   *
   * @returns {Object}
   * @sampleResult {"id":"b7a1c3ee-2f1a-4b8e-9a3d-4c0f0e6d1a22","model":"sonar-pro","created":1752345600,"object":"chat.completion","choices":[{"index":0,"finish_reason":"stop","message":{"role":"assistant","content":"Here is what the latest sources report..."}}],"citations":["https://example.com/article"],"search_results":[{"title":"Latest article","url":"https://example.com/article","date":"2026-07-01"}],"usage":{"prompt_tokens":18,"completion_tokens":120,"total_tokens":138}}
   */
  async chatCompletionAdvanced(messages, model, maxTokens, temperature, topP, searchMode, disableSearch, enableSearchClassifier, searchDomainFilter, searchLanguageFilter, searchRecencyFilter, searchAfterDateFilter, searchBeforeDateFilter, lastUpdatedAfterFilter, lastUpdatedBeforeFilter, returnImages, imageFormatFilter, imageDomainFilter, returnRelatedQuestions, searchContextSize, searchType, userLocation, jsonSchema, reasoningEffort, languagePreference) {
    if (!messages?.length) {
      throw new Error('Messages array is required and must not be empty')
    }

    const body = {
      model: this.#resolveChoice(model, SONAR_MODELS) || DEFAULT_SONAR_MODEL,
      messages: this.#normalizeMessages(messages),
    }

    if (maxTokens) body.max_tokens = maxTokens
    if (temperature !== undefined && temperature !== null) body.temperature = temperature
    if (topP !== undefined && topP !== null) body.top_p = topP

    const resolvedSearchMode = this.#resolveChoice(searchMode, SEARCH_MODES)

    if (resolvedSearchMode && resolvedSearchMode !== 'web') body.search_mode = resolvedSearchMode
    if (disableSearch) body.disable_search = true
    if (enableSearchClassifier) body.enable_search_classifier = true
    if (searchDomainFilter?.length) body.search_domain_filter = searchDomainFilter
    if (searchLanguageFilter?.length) body.search_language_filter = searchLanguageFilter

    const resolvedRecency = this.#resolveChoice(searchRecencyFilter, RECENCY_FILTERS)

    if (resolvedRecency) body.search_recency_filter = resolvedRecency
    if (searchAfterDateFilter) body.search_after_date_filter = searchAfterDateFilter
    if (searchBeforeDateFilter) body.search_before_date_filter = searchBeforeDateFilter
    if (lastUpdatedAfterFilter) body.last_updated_after_filter = lastUpdatedAfterFilter
    if (lastUpdatedBeforeFilter) body.last_updated_before_filter = lastUpdatedBeforeFilter
    if (returnImages) body.return_images = true
    if (imageFormatFilter?.length) body.image_format_filter = imageFormatFilter
    if (imageDomainFilter?.length) body.image_domain_filter = imageDomainFilter
    if (returnRelatedQuestions) body.return_related_questions = true

    const webSearchOptions = {}
    const resolvedContextSize = this.#resolveChoice(searchContextSize, SEARCH_CONTEXT_SIZES)
    const resolvedSearchType = this.#resolveChoice(searchType, SEARCH_TYPES)

    if (resolvedContextSize) webSearchOptions.search_context_size = resolvedContextSize
    if (resolvedSearchType) webSearchOptions.search_type = resolvedSearchType
    if (userLocation && Object.keys(userLocation).length) webSearchOptions.user_location = userLocation
    if (Object.keys(webSearchOptions).length) body.web_search_options = webSearchOptions

    const responseFormat = this.#buildJsonSchemaResponseFormat(jsonSchema)

    if (responseFormat) body.response_format = responseFormat

    const resolvedEffort = this.#resolveChoice(reasoningEffort, REASONING_EFFORTS)

    if (resolvedEffort) body.reasoning_effort = resolvedEffort
    if (languagePreference) body.language_preference = languagePreference

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/sonar`,
      body,
      logTag: 'chatCompletionAdvanced',
    })
  }

  /**
   * @operationName Search the Web
   * @description Searches the web with Perplexity's standalone Search API and returns ranked results (title, URL, snippet, publication date and last-updated date) without any LLM answer generation. Supports multiple queries in one call, domain, country, recency and publish/update date filters, and control over how much page content is extracted per result.
   * @category Search
   * @route POST /search-web
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"The search query to execute, e.g. 'latest advances in solid-state batteries'."}
   * @paramDef {"type":"Array<String>","label":"Additional Queries","name":"additionalQueries","description":"Optional extra queries executed together with the main query in a single multi-query request."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results to return, between 1 and 20. Defaults to 10."}
   * @paramDef {"type":"Number","label":"Max Tokens Per Page","name":"maxTokensPerPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum content tokens extracted from each result page."}
   * @paramDef {"type":"Number","label":"Max Total Tokens","name":"maxTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum combined content tokens across all results (up to 1000000)."}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"Bias results to a country, as an ISO 3166-1 alpha-2 code, e.g. 'US' or 'DE'."}
   * @paramDef {"type":"Array<String>","label":"Search Language Filter","name":"searchLanguageFilter","description":"Restrict results to these languages as ISO 639-1 codes, e.g. [\"en\",\"fr\"]. Up to 20 entries."}
   * @paramDef {"type":"Array<String>","label":"Search Domain Filter","name":"searchDomainFilter","description":"Restrict or exclude web domains, e.g. [\"wikipedia.org\",\"-reddit.com\"] (prefix with '-' to exclude). Up to 20 entries."}
   * @paramDef {"type":"String","label":"Search Recency","name":"searchRecencyFilter","uiComponent":{"type":"DROPDOWN","options":{"values":["Hour","Day","Week","Month","Year"]}},"description":"Only return results published within this time window."}
   * @paramDef {"type":"String","label":"Published After","name":"searchAfterDateFilter","description":"Only return results published after this date, in MM/DD/YYYY format."}
   * @paramDef {"type":"String","label":"Published Before","name":"searchBeforeDateFilter","description":"Only return results published before this date, in MM/DD/YYYY format."}
   * @paramDef {"type":"String","label":"Last Updated After","name":"lastUpdatedAfterFilter","description":"Only return results last updated after this date, in MM/DD/YYYY format."}
   * @paramDef {"type":"String","label":"Last Updated Before","name":"lastUpdatedBeforeFilter","description":"Only return results last updated before this date, in MM/DD/YYYY format."}
   * @paramDef {"type":"String","label":"Search Context Size","name":"searchContextSize","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Medium","High"]}},"description":"How much content is extracted per result: 'Low' returns minimal snippets, 'High' returns detailed content. Defaults to 'High'."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"title":"Solid-state battery breakthrough announced","url":"https://example.com/news/battery","snippet":"Researchers unveiled a new electrolyte...","date":"2026-07-02","last_updated":"2026-07-03"}],"id":"srch_9f2c1b","server_time":"2026-07-13T10:15:00Z"}
   */
  async searchWeb(query, additionalQueries, maxResults, maxTokensPerPage, maxTokens, country, searchLanguageFilter, searchDomainFilter, searchRecencyFilter, searchAfterDateFilter, searchBeforeDateFilter, lastUpdatedAfterFilter, lastUpdatedBeforeFilter, searchContextSize) {
    if (!query || !query.trim()) {
      throw new Error('Query is required')
    }

    const body = {
      query: additionalQueries?.length ? [query, ...additionalQueries] : query,
    }

    if (maxResults) body.max_results = maxResults
    if (maxTokensPerPage) body.max_tokens_per_page = maxTokensPerPage
    if (maxTokens) body.max_tokens = maxTokens
    if (country) body.country = country
    if (searchLanguageFilter?.length) body.search_language_filter = searchLanguageFilter
    if (searchDomainFilter?.length) body.search_domain_filter = searchDomainFilter

    const resolvedRecency = this.#resolveChoice(searchRecencyFilter, RECENCY_FILTERS)

    if (resolvedRecency) body.search_recency_filter = resolvedRecency
    if (searchAfterDateFilter) body.search_after_date_filter = searchAfterDateFilter
    if (searchBeforeDateFilter) body.search_before_date_filter = searchBeforeDateFilter
    if (lastUpdatedAfterFilter) body.last_updated_after_filter = lastUpdatedAfterFilter
    if (lastUpdatedBeforeFilter) body.last_updated_before_filter = lastUpdatedBeforeFilter

    const resolvedContextSize = this.#resolveChoice(searchContextSize, SEARCH_CONTEXT_SIZES)

    if (resolvedContextSize) body.search_context_size = resolvedContextSize

    return this.#apiRequest({
      url: `${ API_BASE_URL }/search`,
      body,
      logTag: 'searchWeb',
    })
  }

  /**
   * @operationName Create Async Chat Completion
   * @description Submits a Sonar chat completion for asynchronous processing and returns immediately with a request ID and status. Ideal for long-running 'Sonar Deep Research' jobs that exceed synchronous timeouts. Poll the request with Get Async Chat Completion until its status is COMPLETED, then read the result from its 'response' property. Async results are retained for 7 days.
   * @category Async Sonar
   * @route POST /create-async-chat-completion
   *
   * @paramDef {"type":"Array<ChatMessage>","label":"Messages","name":"messages","required":true,"description":"The conversation to process. Roles must alternate correctly: optional 'System' messages first, then alternating 'User'/'Assistant', ending with 'User'."}
   * @paramDef {"type":"String","label":"Model","name":"model","uiComponent":{"type":"DROPDOWN","options":{"values":["Sonar","Sonar Pro","Sonar Reasoning Pro","Sonar Deep Research"]}},"defaultValue":"Sonar Deep Research","description":"The Sonar model to use. 'Sonar Deep Research' is the typical choice for async processing."}
   * @paramDef {"type":"Number","label":"Max Tokens","name":"maxTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens the model may generate (up to 128000)."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature between 0 and 2."}
   * @paramDef {"type":"String","label":"Search Mode","name":"searchMode","uiComponent":{"type":"DROPDOWN","options":{"values":["Web","Academic","SEC Filings"]}},"defaultValue":"Web","description":"Where Perplexity searches: the general web, scholarly sources ('Academic'), or SEC filings."}
   * @paramDef {"type":"Array<String>","label":"Search Domain Filter","name":"searchDomainFilter","description":"Restrict or exclude web domains (prefix with '-' to exclude). Up to 20 entries."}
   * @paramDef {"type":"String","label":"Search Recency","name":"searchRecencyFilter","uiComponent":{"type":"DROPDOWN","options":{"values":["Hour","Day","Week","Month","Year"]}},"description":"Only use sources published within this time window."}
   * @paramDef {"type":"Boolean","label":"Return Related Questions","name":"returnRelatedQuestions","uiComponent":{"type":"TOGGLE"},"description":"When enabled, Perplexity also returns suggested follow-up questions."}
   * @paramDef {"type":"String","label":"Reasoning Effort","name":"reasoningEffort","uiComponent":{"type":"DROPDOWN","options":{"values":["Minimal","Low","Medium","High"]}},"description":"How much effort the model spends on research and reasoning. Higher effort produces deeper reports at higher cost and latency."}
   * @paramDef {"type":"Object","label":"JSON Schema","name":"jsonSchema","description":"A JSON Schema the answer must conform to. When provided, the model returns structured JSON instead of prose."}
   * @paramDef {"type":"String","label":"Idempotency Key","name":"idempotencyKey","description":"Optional unique key that prevents duplicate submissions if the same request is retried."}
   *
   * @returns {Object}
   * @sampleResult {"id":"req_1f4a9c2b","status":"CREATED","model":"sonar-deep-research","created_at":1752345600,"started_at":null,"completed_at":null,"response":null}
   */
  async createAsyncChatCompletion(messages, model, maxTokens, temperature, searchMode, searchDomainFilter, searchRecencyFilter, returnRelatedQuestions, reasoningEffort, jsonSchema, idempotencyKey) {
    if (!messages?.length) {
      throw new Error('Messages array is required and must not be empty')
    }

    const request = {
      model: this.#resolveChoice(model, SONAR_MODELS) || 'sonar-deep-research',
      messages: this.#normalizeMessages(messages),
    }

    if (maxTokens) request.max_tokens = maxTokens
    if (temperature !== undefined && temperature !== null) request.temperature = temperature

    const resolvedSearchMode = this.#resolveChoice(searchMode, SEARCH_MODES)

    if (resolvedSearchMode && resolvedSearchMode !== 'web') request.search_mode = resolvedSearchMode
    if (searchDomainFilter?.length) request.search_domain_filter = searchDomainFilter

    const resolvedRecency = this.#resolveChoice(searchRecencyFilter, RECENCY_FILTERS)

    if (resolvedRecency) request.search_recency_filter = resolvedRecency
    if (returnRelatedQuestions) request.return_related_questions = true

    const resolvedEffort = this.#resolveChoice(reasoningEffort, REASONING_EFFORTS)

    if (resolvedEffort) request.reasoning_effort = resolvedEffort

    const responseFormat = this.#buildJsonSchemaResponseFormat(jsonSchema)

    if (responseFormat) request.response_format = responseFormat

    const body = { request }

    if (idempotencyKey) body.idempotency_key = idempotencyKey

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/async/sonar`,
      body,
      logTag: 'createAsyncChatCompletion',
    })
  }

  /**
   * @operationName Get Async Chat Completion
   * @description Retrieves the status and result of an asynchronous Sonar chat completion by its request ID. Status is one of CREATED, IN_PROGRESS, COMPLETED or FAILED; once COMPLETED, the full chat completion (answer, citations, search results, usage) is available in the 'response' property.
   * @category Async Sonar
   * @route GET /get-async-chat-completion
   *
   * @paramDef {"type":"String","label":"Request ID","name":"requestId","required":true,"description":"The ID returned by Create Async Chat Completion."}
   *
   * @returns {Object}
   * @sampleResult {"id":"req_1f4a9c2b","status":"COMPLETED","model":"sonar-deep-research","created_at":1752345600,"started_at":1752345605,"completed_at":1752345900,"response":{"id":"b7a1c3ee","model":"sonar-deep-research","choices":[{"index":0,"finish_reason":"stop","message":{"role":"assistant","content":"# Research Report..."}}],"citations":["https://example.com"],"usage":{"prompt_tokens":22,"completion_tokens":2048,"total_tokens":2070}}}
   */
  async getAsyncChatCompletion(requestId) {
    if (!requestId) {
      throw new Error('Request ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/async/sonar/${ encodeURIComponent(requestId) }`,
      method: 'get',
      logTag: 'getAsyncChatCompletion',
    })
  }

  /**
   * @operationName List Async Chat Completions
   * @description Lists the asynchronous Sonar chat completion requests submitted with your API key, with their IDs, statuses, models and timestamps. Supports pagination via the limit and next token parameters.
   * @category Async Sonar
   * @route GET /list-async-chat-completions
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of requests to return per page."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","description":"Pagination token from a previous response to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"requests":[{"id":"req_1f4a9c2b","status":"COMPLETED","model":"sonar-deep-research","created_at":1752345600,"completed_at":1752345900}],"next_token":null}
   */
  async listAsyncChatCompletions(limit, nextToken) {
    const query = {}

    if (limit) query.limit = limit
    if (nextToken) query.next_token = nextToken

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/async/sonar`,
      method: 'get',
      query,
      logTag: 'listAsyncChatCompletions',
    })
  }

  /**
   * @operationName Create Agent Response
   * @description Generates a response with Perplexity's Agent API, which orchestrates frontier models (Perplexity Sonar, OpenAI GPT, Anthropic Claude, Google Gemini, xAI Grok) with built-in tools: web search, finance search, people search, URL fetching and a code sandbox. Supports multi-turn conversations via a previous response ID, effort presets, reasoning control, multi-step research loops, structured JSON output, and background (asynchronous) execution polled with Get Agent Response.
   * @category Agent
   * @route POST /create-agent-response
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Input","name":"input","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The user's query or task for the agent."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getAgentModelsDictionary","description":"The model to use, in 'provider/model-name' format (e.g. 'perplexity/sonar', 'anthropic/claude-sonnet-5'). Pick from the list or paste an ID. Leave empty to use the preset's default."}
   * @paramDef {"type":"String","label":"Preset","name":"preset","uiComponent":{"type":"DROPDOWN","options":{"values":["Fast","Low","Medium","High","Extra High"]}},"description":"Pre-configured effort level that balances speed, depth and cost. 'Fast' answers quickly; 'Extra High' researches deeply."}
   * @paramDef {"type":"String","label":"Instructions","name":"instructions","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"System-level directives that steer the agent's behavior, tone and output format."}
   * @paramDef {"type":"String","label":"Reasoning Effort","name":"reasoningEffort","uiComponent":{"type":"DROPDOWN","options":{"values":["Minimal","Low","Medium","High","Extra High","Max"]}},"description":"How much effort the model spends reasoning before answering."}
   * @paramDef {"type":"Array<String>","label":"Tools","name":"tools","uiComponent":{"type":"DROPDOWN","options":{"values":["Web Search","Finance Search","People Search","Fetch URL","Sandbox"]}},"description":"Built-in tools the agent may use. Leave empty for the default toolset."}
   * @paramDef {"type":"String","label":"Previous Response ID","name":"previousResponseId","description":"ID of an earlier agent response (e.g. 'resp_...') to continue that conversation with full context."}
   * @paramDef {"type":"Boolean","label":"Background","name":"background","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the request is queued asynchronously and returns immediately with a 'queued' status — poll it with Get Agent Response. Recommended for deep research tasks."}
   * @paramDef {"type":"Boolean","label":"Store","name":"store","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"Whether to persist the response so it can be retrieved later and continued via Previous Response ID. Defaults to enabled."}
   * @paramDef {"type":"Number","label":"Max Output Tokens","name":"maxOutputTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens the agent may generate. Required when using Anthropic models."}
   * @paramDef {"type":"Number","label":"Max Steps","name":"maxSteps","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum research loop iterations (tool calls plus reasoning rounds), between 1 and 100."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature between 0 and 2."}
   * @paramDef {"type":"Number","label":"Top P","name":"topP","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Nucleus sampling threshold between 0 and 1."}
   * @paramDef {"type":"Object","label":"JSON Schema","name":"jsonSchema","description":"A JSON Schema the final answer must conform to. When provided, the agent returns structured JSON instead of prose."}
   * @paramDef {"type":"String","label":"Language Preference","name":"languagePreference","description":"Preferred response language as an ISO 639-1 code, e.g. 'en' or 'fr'."}
   *
   * @returns {Object}
   * @sampleResult {"id":"resp_68e1f2a9","object":"response","created_at":1752345600,"status":"completed","model":"perplexity/sonar","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Based on current sources, here is the summary..."}]}],"usage":{"input_tokens":32,"output_tokens":180,"total_tokens":212,"cost":{"currency":"USD","total_cost":0.004}}}
   */
  async createAgentResponse(input, model, preset, instructions, reasoningEffort, tools, previousResponseId, background, store, maxOutputTokens, maxSteps, temperature, topP, jsonSchema, languagePreference) {
    if (!input || !input.trim()) {
      throw new Error('Input is required')
    }

    const body = { input }

    if (model) body.model = model

    const resolvedPreset = this.#resolveChoice(preset, AGENT_PRESETS)

    if (resolvedPreset) body.preset = resolvedPreset
    if (instructions) body.instructions = instructions

    const resolvedEffort = this.#resolveChoice(reasoningEffort, AGENT_REASONING_EFFORTS)

    if (resolvedEffort) body.reasoning = { effort: resolvedEffort }

    if (tools?.length) {
      body.tools = tools
        .map(tool => this.#resolveChoice(tool, AGENT_TOOLS))
        .filter(Boolean)
        .map(type => ({ type }))
    }

    if (previousResponseId) body.previous_response_id = previousResponseId
    if (background) body.background = true
    if (store !== undefined && store !== null) body.store = store
    if (maxOutputTokens) body.max_output_tokens = maxOutputTokens
    if (maxSteps) body.max_steps = maxSteps
    if (temperature !== undefined && temperature !== null) body.temperature = temperature
    if (topP !== undefined && topP !== null) body.top_p = topP

    const responseFormat = this.#buildJsonSchemaResponseFormat(jsonSchema)

    if (responseFormat) body.response_format = responseFormat
    if (languagePreference) body.language_preference = languagePreference

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/agent`,
      body,
      logTag: 'createAgentResponse',
    })
  }

  /**
   * @operationName Get Agent Response
   * @description Retrieves a previously created (stored or background) Agent API response by its ID. Returns a snapshot with its status (queued, in_progress, completed, failed, incomplete or cancelled), the output items (messages, search results, tool calls) and token usage. Use this to poll background agent requests until completion.
   * @category Agent
   * @route GET /get-agent-response
   *
   * @paramDef {"type":"String","label":"Response ID","name":"responseId","required":true,"description":"The agent response identifier, e.g. 'resp_68e1f2a9', returned by Create Agent Response."}
   *
   * @returns {Object}
   * @sampleResult {"id":"resp_68e1f2a9","object":"response","created_at":1752345600,"status":"completed","model":"perplexity/sonar","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Here is the completed research summary..."}]}],"usage":{"input_tokens":32,"output_tokens":180,"total_tokens":212}}
   */
  async getAgentResponse(responseId) {
    if (!responseId) {
      throw new Error('Response ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/agent/${ encodeURIComponent(responseId) }`,
      method: 'get',
      logTag: 'getAgentResponse',
    })
  }

  /**
   * @operationName List Models
   * @description Lists the models available for the Perplexity Agent API, including Perplexity's own Sonar models and frontier models from OpenAI, Anthropic, Google and xAI, with their IDs in 'provider/model-name' format and owners. Note: the Sonar chat completion endpoints use the fixed model set 'sonar', 'sonar-pro', 'sonar-reasoning-pro' and 'sonar-deep-research'.
   * @category Models
   * @route GET /list-models
   *
   * @returns {Object}
   * @sampleResult {"object":"list","data":[{"id":"perplexity/sonar","object":"model","created":1752345600,"owned_by":"perplexity"},{"id":"anthropic/claude-sonnet-5","object":"model","created":1752345600,"owned_by":"anthropic"}]}
   */
  async listModels() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/models`,
      method: 'get',
      logTag: 'listModels',
    })
  }

  /**
   * @operationName Create Embeddings
   * @description Generates vector embeddings for up to 512 texts with Perplexity's embedding models. Each text supports up to 32K tokens (120K tokens combined per request). Embeddings are returned base64-encoded (int8 or binary quantization) with configurable output dimensions, together with token usage and cost.
   * @category Embeddings
   * @route POST /create-embeddings
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Array<String>","label":"Input Texts","name":"input","required":true,"description":"The texts to embed — between 1 and 512 entries, each up to 32K tokens."}
   * @paramDef {"type":"String","label":"Model","name":"model","uiComponent":{"type":"DROPDOWN","options":{"values":["Perplexity Embed v1 (0.6B)","Perplexity Embed v1 (4B)"]}},"defaultValue":"Perplexity Embed v1 (0.6B)","description":"The embedding model to use. The 0.6B model outputs up to 1024 dimensions; the 4B model outputs up to 2560 dimensions with higher quality."}
   * @paramDef {"type":"Number","label":"Dimensions","name":"dimensions","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Output embedding dimensions, between 128 and the model's maximum (1024 for 0.6B, 2560 for 4B). Defaults to the model's full dimensionality."}
   * @paramDef {"type":"String","label":"Encoding Format","name":"encodingFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["Base64 Int8","Base64 Binary"]}},"defaultValue":"Base64 Int8","description":"Quantization of the returned base64-encoded vectors: int8 (higher fidelity) or binary (most compact)."}
   *
   * @returns {Object}
   * @sampleResult {"object":"list","data":[{"object":"embedding","index":0,"embedding":"AAECAwQFBgc..."}],"model":"pplx-embed-v1-0.6b","usage":{"prompt_tokens":12,"total_tokens":12,"cost":{"input_cost":0.0000012,"total_cost":0.0000012,"currency":"USD"}}}
   */
  async createEmbeddings(input, model, dimensions, encodingFormat) {
    if (!input?.length) {
      throw new Error('Input texts array is required and must not be empty')
    }

    const body = {
      input,
      model: this.#resolveChoice(model, EMBEDDINGS_MODELS) || DEFAULT_EMBEDDINGS_MODEL,
    }

    if (dimensions) body.dimensions = dimensions

    const resolvedFormat = this.#resolveChoice(encodingFormat, ENCODING_FORMATS)

    if (resolvedFormat) body.encoding_format = resolvedFormat

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/embeddings`,
      body,
      logTag: 'createEmbeddings',
    })
  }

  /**
   * @operationName Create Contextualized Embeddings
   * @description Generates contextualized embeddings for chunked documents with Perplexity's contextual embedding models: each chunk's vector is computed with awareness of its surrounding document, improving retrieval quality for RAG pipelines. Supports up to 512 documents and 16,000 chunks per request (32K tokens per document, 120K tokens combined). Vectors are returned base64-encoded with configurable dimensions.
   * @category Embeddings
   * @route POST /create-contextualized-embeddings
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Array<DocumentChunks>","label":"Documents","name":"documents","required":true,"description":"The documents to embed, each provided as its ordered list of text chunks."}
   * @paramDef {"type":"String","label":"Model","name":"model","uiComponent":{"type":"DROPDOWN","options":{"values":["Perplexity Contextual Embed v1 (0.6B)","Perplexity Contextual Embed v1 (4B)"]}},"defaultValue":"Perplexity Contextual Embed v1 (0.6B)","description":"The contextual embedding model to use. The 0.6B model outputs up to 1024 dimensions; the 4B model outputs up to 2560 dimensions with higher quality."}
   * @paramDef {"type":"Number","label":"Dimensions","name":"dimensions","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Output embedding dimensions, between 128 and the model's maximum (1024 for 0.6B, 2560 for 4B). Defaults to the model's full dimensionality."}
   * @paramDef {"type":"String","label":"Encoding Format","name":"encodingFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["Base64 Int8","Base64 Binary"]}},"defaultValue":"Base64 Int8","description":"Quantization of the returned base64-encoded vectors: int8 (higher fidelity) or binary (most compact)."}
   *
   * @returns {Object}
   * @sampleResult {"object":"list","data":[{"object":"embedding","index":0,"embeddings":["AAECAwQFBgc...","CAkKCwwNDg8..."]}],"model":"pplx-embed-context-v1-0.6b","usage":{"prompt_tokens":48,"total_tokens":48,"cost":{"input_cost":0.0000048,"total_cost":0.0000048,"currency":"USD"}}}
   */
  async createContextualizedEmbeddings(documents, model, dimensions, encodingFormat) {
    if (!documents?.length) {
      throw new Error('Documents array is required and must not be empty')
    }

    const input = documents.map(document => document?.chunks || [])

    if (input.some(chunks => !chunks.length)) {
      throw new Error('Every document must contain at least one chunk')
    }

    const body = {
      input,
      model: this.#resolveChoice(model, CONTEXT_EMBEDDINGS_MODELS) || DEFAULT_CONTEXT_EMBEDDINGS_MODEL,
    }

    if (dimensions) body.dimensions = dimensions

    const resolvedFormat = this.#resolveChoice(encodingFormat, ENCODING_FORMATS)

    if (resolvedFormat) body.encoding_format = resolvedFormat

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/contextualizedembeddings`,
      body,
      logTag: 'createContextualizedEmbeddings',
    })
  }
}

Flowrunner.ServerCode.addService(PerplexityService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Perplexity API key. Create one in the API portal at https://www.perplexity.ai/account/api/keys',
  },
])

function normalizeErrorMessage(error) {
  if (error.body?.error?.message) {
    return error.body.error.message
  }

  if (error.body?.detail) {
    return typeof error.body.detail === 'string' ? error.body.detail : JSON.stringify(error.body.detail)
  }

  if (error.body?.message) {
    return error.body.message
  }

  if (error.message && typeof error.message === 'object') {
    return JSON.stringify(error.message)
  }

  return error.message || 'API request failed'
}
