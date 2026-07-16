'use strict'

const API_BASE_URL = 'https://api.x.ai/v1'

const DEFAULT_CHAT_MODEL = 'grok-4.5'
const DEFAULT_IMAGE_MODEL = 'grok-imagine-image'
const DEFAULT_VIDEO_MODEL = 'grok-imagine-video'

const SEARCH_SOURCE_TYPES = { 'Web': 'web', 'X': 'x', 'News': 'news', 'RSS': 'rss' }

const logger = {
  info: (...args) => console.log('[xAI Grok] info:', ...args),
  debug: (...args) => console.log('[xAI Grok] debug:', ...args),
  error: (...args) => console.log('[xAI Grok] error:', ...args),
  warn: (...args) => console.log('[xAI Grok] warn:', ...args),
}

/**
 * @usesFileStorage
 * @integrationName xAI Grok
 * @integrationIcon /icon.svg
 */
class XaiGrokService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  async #apiRequest({ url, method = 'post', body, query, logTag }) {
    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }]`)

      let request = Flowrunner.Request[method](url)
        .query(query || {})
        .set({ 'Authorization': `Bearer ${ this.apiKey }` })

      if (body !== undefined) {
        request = request.set({ 'Content-Type': 'application/json' }).send(body)
      }

      return await request
    } catch (error) {
      error = normalizeError(error)

      const errorMsg = error.message || 'API request failed'

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

  #normalizeDate(value) {
    if (!value) {
      return undefined
    }

    const date = new Date(value)

    return isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10)
  }

  #filterBySearch(items, search, labelFn) {
    if (!search?.trim()) {
      return items
    }

    const searchLower = search.toLowerCase()

    return items.filter(item => labelFn(item).toLowerCase().includes(searchLower))
  }

  async #saveGeneratedImages(images, fileOptions, logTag) {
    const results = []

    for (let i = 0; i < images.length; i++) {
      const image = images[i]
      const extension = (image.mime_type || 'image/png').split('/').pop().replace('jpeg', 'jpg')
      const buffer = Buffer.from(image.b64_json, 'base64')

      logger.debug(`${ logTag } - saving generated image ${ i + 1 }/${ images.length } to file storage`)

      const { url } = await this.flowrunner.Files.uploadFile(buffer, {
        filename: `xai_image_${ Date.now() }_${ i }.${ extension }`,
        generateUrl: true,
        overwrite: true,
        ...(fileOptions || { scope: 'FLOW' }),
      })

      results.push({ url, revisedPrompt: image.revised_prompt ?? null, mimeType: image.mime_type ?? null })
    }

    return results
  }

  /**
   * @typedef {Object} getModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — xAI's model list is not paginated."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Models Dictionary
   * @description Provides a searchable, live list of all xAI models available to the API key (chat, image understanding, image generation and video generation models) for dynamic parameter selection.
   * @route POST /get-models-dictionary
   * @paramDef {"type":"getModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"grok-4.5","value":"grok-4.5","note":"xai"},{"label":"grok-imagine-image","value":"grok-imagine-image","note":"xai"}],"cursor":null}
   */
  async getModelsDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/models`,
      method: 'get',
      logTag: 'getModelsDictionary',
    })

    const models = this.#filterBySearch(response.data || [], search, model => model.id)

    return {
      items: models
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(model => ({ label: model.id, value: model.id, note: model.owned_by || null })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getChatModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — xAI's model list is not paginated."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Chat Models Dictionary
   * @description Provides a searchable, live list of xAI Grok language models (chat, reasoning and image understanding models) with context window sizes and input modalities for dynamic parameter selection.
   * @route POST /get-chat-models-dictionary
   * @paramDef {"type":"getChatModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"grok-4.5","value":"grok-4.5","note":"500000 ctx · text+image"}],"cursor":null}
   */
  async getChatModelsDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/language-models`,
      method: 'get',
      logTag: 'getChatModelsDictionary',
    })

    const models = this.#filterBySearch(response.models || response.data || [], search, model => model.id)

    return {
      items: models
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(model => ({
          label: model.id,
          value: model.id,
          note: [
            model.context_length && `${ model.context_length } ctx`,
            model.input_modalities?.length && model.input_modalities.join('+'),
          ].filter(Boolean).join(' · ') || null,
        })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getImageModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — xAI's model list is not paginated."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Image Models Dictionary
   * @description Provides a searchable, live list of xAI image generation models (Grok Imagine) for dynamic parameter selection.
   * @route POST /get-image-models-dictionary
   * @paramDef {"type":"getImageModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"grok-imagine-image","value":"grok-imagine-image","note":"image output"},{"label":"grok-imagine-image-quality","value":"grok-imagine-image-quality","note":"image output"}],"cursor":null}
   */
  async getImageModelsDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/image-generation-models`,
      method: 'get',
      logTag: 'getImageModelsDictionary',
    })

    const models = this.#filterBySearch(response.models || response.data || [], search, model => model.id)

    return {
      items: models
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(model => ({
          label: model.id,
          value: model.id,
          note: model.output_modalities?.length ? `${ model.output_modalities.join('+') } output` : null,
        })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getVideoModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — xAI's model list is not paginated."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Video Models Dictionary
   * @description Provides a searchable, live list of xAI video generation models (Grok Imagine video) for dynamic parameter selection.
   * @route POST /get-video-models-dictionary
   * @paramDef {"type":"getVideoModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"grok-imagine-video","value":"grok-imagine-video","note":"video output"},{"label":"grok-imagine-video-1.5","value":"grok-imagine-video-1.5","note":"video output"}],"cursor":null}
   */
  async getVideoModelsDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/video-generation-models`,
      method: 'get',
      logTag: 'getVideoModelsDictionary',
    })

    const models = this.#filterBySearch(response.models || response.data || [], search, model => model.id)

    return {
      items: models
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(model => ({
          label: model.id,
          value: model.id,
          note: model.output_modalities?.length ? `${ model.output_modalities.join('+') } output` : null,
        })),
      cursor: null,
    }
  }

  /**
   * @operationName Chat Completion
   * @description Generates a text response for a single prompt using an xAI Grok model (Grok 4.5, Grok 4.3 and more). Supports an optional system prompt, JSON mode for structured output, deterministic sampling via seed, and reasoning effort control on supported models (currently grok-4.3). Returns the generated text, reasoning content (when the model exposes it), finish reason and token usage.
   * @category Chat
   * @route POST /chat-completion
   *
   * @executionTimeoutInSeconds 180
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The user message to send to the model."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getChatModelsDictionary","defaultValue":"grok-4.5","description":"The Grok model to use. Defaults to 'grok-4.5'."}
   * @paramDef {"type":"String","label":"System Prompt","name":"systemPrompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional system instructions that set the model's behavior, tone and constraints."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature between 0 and 2. Higher values produce more random output. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Max Completion Tokens","name":"maxCompletionTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Upper bound for the number of tokens the model may generate, including visible output and reasoning tokens."}
   * @paramDef {"type":"Number","label":"Top P","name":"topP","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Nucleus sampling threshold between 0 and 1. Defaults to 1. Alter this or Temperature, not both."}
   * @paramDef {"type":"Array<String>","label":"Stop Sequences","name":"stop","description":"Up to 4 sequences where the model stops generating further tokens."}
   * @paramDef {"type":"Number","label":"Seed","name":"seed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Seed for best-effort deterministic sampling. Repeated requests with the same seed and parameters should return similar results."}
   * @paramDef {"type":"Boolean","label":"JSON Mode","name":"jsonMode","uiComponent":{"type":"TOGGLE"},"description":"When enabled, forces the model to return valid JSON. Your prompt should explicitly ask for JSON output."}
   * @paramDef {"type":"String","label":"Reasoning Effort","name":"reasoningEffort","uiComponent":{"type":"DROPDOWN","options":{"values":["None","Low","Medium","High"]}},"description":"How much effort the model spends reasoning before answering: 'None' disables reasoning, 'Low' is the model default. Currently only supported by 'grok-4.3'; leave empty for other models."}
   *
   * @returns {Object}
   * @sampleResult {"text":"Reusable rockets cut launch costs by allowing the most expensive hardware to fly many times.","reasoningContent":null,"model":"grok-4.5","finishReason":"stop","usage":{"prompt_tokens":21,"completion_tokens":18,"total_tokens":39}}
   */
  async chatCompletion(prompt, model, systemPrompt, temperature, maxCompletionTokens, topP, stop, seed, jsonMode, reasoningEffort) {
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    const messages = []

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt })
    }

    messages.push({ role: 'user', content: prompt })

    const body = {
      model: model || DEFAULT_CHAT_MODEL,
      messages,
    }

    if (temperature !== undefined && temperature !== null) body.temperature = temperature
    if (maxCompletionTokens) body.max_completion_tokens = maxCompletionTokens
    if (topP !== undefined && topP !== null) body.top_p = topP
    if (stop?.length) body.stop = stop
    if (seed !== undefined && seed !== null) body.seed = seed
    if (jsonMode) body.response_format = { type: 'json_object' }

    const resolvedEffort = this.#resolveChoice(reasoningEffort, {
      'None': 'none', 'Low': 'low', 'Medium': 'medium', 'High': 'high',
    })

    if (resolvedEffort) body.reasoning_effort = resolvedEffort

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/chat/completions`,
      body,
      logTag: 'chatCompletion',
    })

    const choice = response.choices?.[0]

    return {
      text: choice?.message?.content ?? '',
      reasoningContent: choice?.message?.reasoning_content ?? null,
      model: response.model,
      finishReason: choice?.finish_reason ?? null,
      usage: response.usage ?? null,
    }
  }

  /**
   * @operationName Chat Completion (Advanced)
   * @description Sends a fully custom chat completion request to xAI with a complete messages array (multi-turn conversations, multimodal image_url content parts), tool/function calling passthrough, structured outputs via a response format object (json_object or json_schema), Live Search parameters, reasoning effort, penalties and sampling controls. Set Deferred to run the request asynchronously and receive a request ID for later retrieval with Get Deferred Completion. Returns the raw xAI API response including choices, tool calls, citations and usage.
   * @category Chat
   * @route POST /chat-completion-advanced
   *
   * @executionTimeoutInSeconds 180
   *
   * @paramDef {"type":"Array<Object>","label":"Messages","name":"messages","required":true,"description":"Conversation messages in xAI/OpenAI format, e.g. [{\"role\":\"system\",\"content\":\"...\"},{\"role\":\"user\",\"content\":\"...\"}]. Content may also be an array of content parts (text, image_url) for image understanding."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getChatModelsDictionary","defaultValue":"grok-4.5","description":"The Grok model to use. Defaults to 'grok-4.5'."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature between 0 and 2. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Max Completion Tokens","name":"maxCompletionTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Upper bound for the number of tokens the model may generate, including visible output and reasoning tokens."}
   * @paramDef {"type":"Number","label":"Top P","name":"topP","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Nucleus sampling threshold between 0 and 1. Defaults to 1."}
   * @paramDef {"type":"Array<String>","label":"Stop Sequences","name":"stop","description":"Up to 4 sequences where the model stops generating further tokens."}
   * @paramDef {"type":"Number","label":"Seed","name":"seed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Seed for best-effort deterministic sampling."}
   * @paramDef {"type":"Object","label":"Response Format","name":"responseFormat","description":"Structured output specification, e.g. {\"type\":\"json_object\"} or {\"type\":\"json_schema\",\"json_schema\":{\"name\":\"result\",\"schema\":{...}}}."}
   * @paramDef {"type":"Array<Object>","label":"Tools","name":"tools","description":"Tool definitions the model may call (max 128), in OpenAI function-calling format: [{\"type\":\"function\",\"function\":{\"name\":\"...\",\"description\":\"...\",\"parameters\":{...}}}]."}
   * @paramDef {"type":"String","label":"Tool Choice","name":"toolChoice","description":"Controls tool usage: 'none', 'auto', 'required', or a JSON string selecting a specific function, e.g. {\"type\":\"function\",\"function\":{\"name\":\"my_tool\"}}."}
   * @paramDef {"type":"Object","label":"Search Parameters","name":"searchParameters","description":"Live Search configuration passed through as-is, e.g. {\"mode\":\"auto\",\"sources\":[{\"type\":\"web\"},{\"type\":\"x\"}],\"return_citations\":true,\"max_search_results\":10}. For a guided experience use the 'Ask with Live Search' operation instead."}
   * @paramDef {"type":"String","label":"Reasoning Effort","name":"reasoningEffort","uiComponent":{"type":"DROPDOWN","options":{"values":["None","Low","Medium","High"]}},"description":"How much effort the model spends reasoning before answering. Currently only supported by 'grok-4.3'; leave empty for other models."}
   * @paramDef {"type":"Number","label":"Frequency Penalty","name":"frequencyPenalty","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number between -2.0 and 2.0. Positive values penalize repeated tokens, reducing verbatim repetition."}
   * @paramDef {"type":"Number","label":"Presence Penalty","name":"presencePenalty","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number between -2.0 and 2.0. Positive values encourage the model to talk about new topics."}
   * @paramDef {"type":"Boolean","label":"Deferred","name":"deferred","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the request runs asynchronously and only a request ID is returned. Poll the result with 'Get Deferred Completion'."}
   *
   * @returns {Object}
   * @sampleResult {"id":"chatcmpl-2f3a9c1e","object":"chat.completion","created":1783958400,"model":"grok-4.5","choices":[{"index":0,"message":{"role":"assistant","content":"Hello! How can I help you today?"},"finish_reason":"stop"}],"usage":{"prompt_tokens":18,"completion_tokens":10,"total_tokens":28}}
   */
  async chatCompletionAdvanced(messages, model, temperature, maxCompletionTokens, topP, stop, seed, responseFormat, tools, toolChoice, searchParameters, reasoningEffort, frequencyPenalty, presencePenalty, deferred) {
    if (!messages?.length) {
      throw new Error('Messages array is required and must not be empty')
    }

    const body = {
      model: model || DEFAULT_CHAT_MODEL,
      messages,
    }

    if (temperature !== undefined && temperature !== null) body.temperature = temperature
    if (maxCompletionTokens) body.max_completion_tokens = maxCompletionTokens
    if (topP !== undefined && topP !== null) body.top_p = topP
    if (stop?.length) body.stop = stop
    if (seed !== undefined && seed !== null) body.seed = seed
    if (responseFormat) body.response_format = responseFormat
    if (tools?.length) body.tools = tools
    if (searchParameters && Object.keys(searchParameters).length) body.search_parameters = searchParameters
    if (frequencyPenalty !== undefined && frequencyPenalty !== null) body.frequency_penalty = frequencyPenalty
    if (presencePenalty !== undefined && presencePenalty !== null) body.presence_penalty = presencePenalty
    if (deferred) body.deferred = true

    if (toolChoice) {
      body.tool_choice = /^\s*\{/.test(toolChoice) ? JSON.parse(toolChoice) : toolChoice
    }

    const resolvedEffort = this.#resolveChoice(reasoningEffort, {
      'None': 'none', 'Low': 'low', 'Medium': 'medium', 'High': 'high',
    })

    if (resolvedEffort) body.reasoning_effort = resolvedEffort

    return this.#apiRequest({
      url: `${ API_BASE_URL }/chat/completions`,
      body,
      logTag: 'chatCompletionAdvanced',
    })
  }

  /**
   * @operationName Get Deferred Completion
   * @description Retrieves the result of a deferred chat completion by its request ID (obtained from 'Chat Completion (Advanced)' with Deferred enabled). Returns the full chat completion response when ready, or a pending status while the request is still processing. Deferred results are available for retrieval for 24 hours.
   * @category Chat
   * @route GET /get-deferred-completion
   *
   * @paramDef {"type":"String","label":"Request ID","name":"requestId","required":true,"description":"The request ID returned by a deferred chat completion request."}
   *
   * @returns {Object}
   * @sampleResult {"id":"chatcmpl-2f3a9c1e","object":"chat.completion","created":1783958400,"model":"grok-4.5","choices":[{"index":0,"message":{"role":"assistant","content":"Here is the result."},"finish_reason":"stop"}],"usage":{"prompt_tokens":30,"completion_tokens":8,"total_tokens":38}}
   */
  async getDeferredCompletion(requestId) {
    if (!requestId) {
      throw new Error('Request ID is required')
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/chat/deferred-completion/${ encodeURIComponent(requestId) }`,
      method: 'get',
      logTag: 'getDeferredCompletion',
    })

    return response?.choices ? response : { status: 'pending', request_id: requestId }
  }

  /**
   * @operationName Ask with Live Search
   * @description Answers a prompt with real-time information using xAI's Live Search: the Grok model searches live data sources (web, X posts, news, RSS feeds) and grounds its answer in what it finds. Supports source selection, date-range filters, country targeting, allowed/excluded websites, X handle filters and a result limit. Returns the answer text together with the citations (source URLs) the model used.
   * @category Live Search
   * @route POST /ask-with-live-search
   *
   * @executionTimeoutInSeconds 180
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The question or instruction to answer using live search results, e.g. 'What are the latest developments in EU AI regulation?'."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getChatModelsDictionary","defaultValue":"grok-4.5","description":"The Grok model to use. Defaults to 'grok-4.5'."}
   * @paramDef {"type":"String","label":"System Prompt","name":"systemPrompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional system instructions that set the model's behavior, tone and constraints."}
   * @paramDef {"type":"String","label":"Search Mode","name":"mode","uiComponent":{"type":"DROPDOWN","options":{"values":["Auto","On","Off"]}},"defaultValue":"Auto","description":"'Auto' lets the model decide whether and where to search, 'On' always searches, 'Off' disables search. Defaults to 'Auto'."}
   * @paramDef {"type":"Array<String>","label":"Sources","name":"sources","uiComponent":{"type":"DROPDOWN","options":{"values":["Web","X","News","RSS"]}},"description":"Data sources to search. When omitted, xAI searches web and X by default. Select 'RSS' together with RSS Feed URLs to search specific feeds."}
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","uiComponent":{"type":"DATE_PICKER"},"description":"Only consider search data from this date onward (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"To Date","name":"toDate","uiComponent":{"type":"DATE_PICKER"},"description":"Only consider search data up to this date (YYYY-MM-DD)."}
   * @paramDef {"type":"Number","label":"Max Search Results","name":"maxSearchResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of search results the model may consider. Defaults to 20."}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"ISO alpha-2 country code (e.g. 'US', 'DE') to prioritize in web and news search results."}
   * @paramDef {"type":"Array<String>","label":"Allowed Websites","name":"allowedWebsites","description":"Restrict web search to these websites only (max 5, e.g. 'wikipedia.org'). Cannot be combined with Excluded Websites."}
   * @paramDef {"type":"Array<String>","label":"Excluded Websites","name":"excludedWebsites","description":"Exclude these websites from web and news search (max 5). Cannot be combined with Allowed Websites."}
   * @paramDef {"type":"Array<String>","label":"Included X Handles","name":"includedXHandles","description":"Only consider X posts from these handles, without the '@' (max 10). Cannot be combined with Excluded X Handles."}
   * @paramDef {"type":"Array<String>","label":"Excluded X Handles","name":"excludedXHandles","description":"Exclude X posts from these handles, without the '@' (max 10). Cannot be combined with Included X Handles."}
   * @paramDef {"type":"Array<String>","label":"RSS Feed URLs","name":"rssLinks","description":"RSS feed URLs to fetch data from when the 'RSS' source is used."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature between 0 and 2. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Max Completion Tokens","name":"maxCompletionTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Upper bound for the number of tokens the model may generate for the answer."}
   *
   * @returns {Object}
   * @sampleResult {"text":"The EU AI Act's obligations for general-purpose AI models took effect in August 2025, with enforcement ramping up through 2026.","citations":["https://digital-strategy.ec.europa.eu/en/policies/ai-act","https://x.com/EU_Commission/status/1905123456789012345"],"model":"grok-4.5","finishReason":"stop","usage":{"prompt_tokens":156,"completion_tokens":42,"total_tokens":198}}
   */
  async askWithLiveSearch(prompt, model, systemPrompt, mode, sources, fromDate, toDate, maxSearchResults, country, allowedWebsites, excludedWebsites, includedXHandles, excludedXHandles, rssLinks, temperature, maxCompletionTokens) {
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    const searchParameters = {
      mode: this.#resolveChoice(mode, { 'Auto': 'auto', 'On': 'on', 'Off': 'off' }) || 'auto',
      return_citations: true,
    }

    const fromDateValue = this.#normalizeDate(fromDate)
    const toDateValue = this.#normalizeDate(toDate)

    if (fromDateValue) searchParameters.from_date = fromDateValue
    if (toDateValue) searchParameters.to_date = toDateValue
    if (maxSearchResults) searchParameters.max_search_results = maxSearchResults

    const selectedTypes = new Set(
      (sources || []).map(source => this.#resolveChoice(source, SEARCH_SOURCE_TYPES)).filter(Boolean)
    )

    if (!selectedTypes.size) {
      if (country || allowedWebsites?.length || excludedWebsites?.length) selectedTypes.add('web')
      if (includedXHandles?.length || excludedXHandles?.length) selectedTypes.add('x')
      if (rssLinks?.length) selectedTypes.add('rss')
    }

    if (selectedTypes.size) {
      searchParameters.sources = [...selectedTypes].map(type => {
        const source = { type }

        if (type === 'web' || type === 'news') {
          if (country) source.country = country
          if (excludedWebsites?.length) source.excluded_websites = excludedWebsites
        }

        if (type === 'web' && allowedWebsites?.length) source.allowed_websites = allowedWebsites

        if (type === 'x') {
          if (includedXHandles?.length) source.included_x_handles = includedXHandles
          if (excludedXHandles?.length) source.excluded_x_handles = excludedXHandles
        }

        if (type === 'rss' && rssLinks?.length) source.links = rssLinks

        return source
      })
    }

    const messages = []

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt })
    }

    messages.push({ role: 'user', content: prompt })

    const body = {
      model: model || DEFAULT_CHAT_MODEL,
      messages,
      search_parameters: searchParameters,
    }

    if (temperature !== undefined && temperature !== null) body.temperature = temperature
    if (maxCompletionTokens) body.max_completion_tokens = maxCompletionTokens

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/chat/completions`,
      body,
      logTag: 'askWithLiveSearch',
    })

    const choice = response.choices?.[0]

    return {
      text: choice?.message?.content ?? '',
      citations: response.citations ?? [],
      model: response.model,
      finishReason: choice?.finish_reason ?? null,
      usage: response.usage ?? null,
    }
  }

  /**
   * @operationName Analyze Image
   * @description Analyzes one or more images with a vision-capable Grok model and answers a prompt about them — describe content, extract text, compare images or answer visual questions. Accepts public image URLs or base64 data URLs (jpg/jpeg and png, up to 20MiB per image). Supports JSON mode for structured extraction.
   * @category Vision
   * @route POST /analyze-image
   *
   * @executionTimeoutInSeconds 180
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The question or instruction about the image(s), e.g. 'Describe this image' or 'Extract all visible text'."}
   * @paramDef {"type":"Array<String>","label":"Image URLs","name":"imageUrls","required":true,"description":"Image URLs to analyze. Each may be a public 'https://' URL or a base64 data URL like 'data:image/jpeg;base64,...'. Supported formats: jpg/jpeg and png, up to 20MiB per image."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getChatModelsDictionary","defaultValue":"grok-4.5","description":"The vision-capable Grok model to use. Defaults to 'grok-4.5'."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature between 0 and 2. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Max Completion Tokens","name":"maxCompletionTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Upper bound for the number of tokens the model may generate for the answer."}
   * @paramDef {"type":"Boolean","label":"JSON Mode","name":"jsonMode","uiComponent":{"type":"TOGGLE"},"description":"When enabled, forces the model to return valid JSON. Your prompt should explicitly ask for JSON output."}
   *
   * @returns {Object}
   * @sampleResult {"text":"The image shows a Falcon 9 rocket lifting off at sunset, with the exhaust plume illuminated in orange.","model":"grok-4.5","finishReason":"stop","usage":{"prompt_tokens":812,"completion_tokens":22,"total_tokens":834}}
   */
  async analyzeImage(prompt, imageUrls, model, temperature, maxCompletionTokens, jsonMode) {
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    if (!imageUrls?.length) {
      throw new Error('At least one image URL is required')
    }

    const content = [
      ...imageUrls.map(url => ({ type: 'image_url', image_url: { url } })),
      { type: 'text', text: prompt },
    ]

    const body = {
      model: model || DEFAULT_CHAT_MODEL,
      messages: [{ role: 'user', content }],
    }

    if (temperature !== undefined && temperature !== null) body.temperature = temperature
    if (maxCompletionTokens) body.max_completion_tokens = maxCompletionTokens
    if (jsonMode) body.response_format = { type: 'json_object' }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/chat/completions`,
      body,
      logTag: 'analyzeImage',
    })

    const choice = response.choices?.[0]

    return {
      text: choice?.message?.content ?? '',
      model: response.model,
      finishReason: choice?.finish_reason ?? null,
      usage: response.usage ?? null,
    }
  }

  /**
   * @operationName Generate Image
   * @description Generates one or more images from a text prompt using xAI's Grok Imagine image models. Supports aspect ratio and resolution control. By default returns xAI-hosted image URLs; optionally saves the generated images to FlowRunner file storage instead for permanent access. Also returns the revised prompt the model actually used for each image.
   * @category Image Generation
   * @route POST /generate-image
   *
   * @executionTimeoutInSeconds 180
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A description of the image to generate."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getImageModelsDictionary","defaultValue":"grok-imagine-image","description":"The image generation model to use. Defaults to 'grok-imagine-image'; use 'grok-imagine-image-quality' for higher quality output."}
   * @paramDef {"type":"Number","label":"Number of Images","name":"n","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many images to generate for the prompt. Defaults to 1."}
   * @paramDef {"type":"String","label":"Aspect Ratio","name":"aspectRatio","uiComponent":{"type":"DROPDOWN","options":{"values":["auto","1:1","16:9","9:16","4:3","3:4","3:2","2:3","2:1","1:2","19.5:9","9:19.5","20:9","9:20"]}},"description":"The aspect ratio of the generated image. 'auto' lets the model choose. Defaults to 'auto'."}
   * @paramDef {"type":"String","label":"Resolution","name":"resolution","uiComponent":{"type":"DROPDOWN","options":{"values":["1k","2k"]}},"description":"The output resolution class of the generated image. Defaults to '1k'."}
   * @paramDef {"type":"Boolean","label":"Save to File Storage","name":"saveToFileStorage","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the generated images are saved to FlowRunner file storage and permanent FlowRunner URLs are returned instead of temporary xAI-hosted URLs."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   *
   * @returns {Object}
   * @sampleResult {"images":[{"url":"https://imgen.x.ai/xai-imgen/xai-tmp-imgen-d7c8e9f0.jpeg","revisedPrompt":"A photorealistic image of a red fox standing in fresh snow at dawn.","mimeType":"image/jpeg"}],"model":"grok-imagine-image"}
   */
  async generateImage(prompt, model, n, aspectRatio, resolution, saveToFileStorage, fileOptions) {
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    const body = {
      model: model || DEFAULT_IMAGE_MODEL,
      prompt,
      response_format: saveToFileStorage ? 'b64_json' : 'url',
    }

    if (n) body.n = n
    if (aspectRatio) body.aspect_ratio = aspectRatio
    if (resolution) body.resolution = resolution

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/images/generations`,
      body,
      logTag: 'generateImage',
    })

    const data = response.data || []

    const images = saveToFileStorage
      ? await this.#saveGeneratedImages(data, fileOptions, 'generateImage')
      : data.map(image => ({
        url: image.url,
        revisedPrompt: image.revised_prompt ?? null,
        mimeType: image.mime_type ?? null,
      }))

    return { images, model: body.model }
  }

  /**
   * @operationName Edit Image
   * @description Edits an existing image (or combines multiple reference images) with natural-language instructions using xAI's Grok Imagine models — change styles, add or remove objects, or merge content from several references. By default returns xAI-hosted image URLs; optionally saves the results to FlowRunner file storage for permanent access.
   * @category Image Generation
   * @route POST /edit-image
   *
   * @executionTimeoutInSeconds 180
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Natural-language editing instructions, e.g. 'Make the sky stormy and add lightning'."}
   * @paramDef {"type":"Array<String>","label":"Image URLs","name":"imageUrls","required":true,"description":"The image(s) to edit. Provide one URL for a single-image edit or several URLs for multi-reference editing. Each may be a public 'https://' URL, a base64 data URL, or an xAI file ID."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getImageModelsDictionary","defaultValue":"grok-imagine-image","description":"The image generation model to use. Defaults to 'grok-imagine-image'."}
   * @paramDef {"type":"Number","label":"Number of Images","name":"n","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many edited variants to generate. Defaults to 1."}
   * @paramDef {"type":"Boolean","label":"Save to File Storage","name":"saveToFileStorage","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the edited images are saved to FlowRunner file storage and permanent FlowRunner URLs are returned instead of temporary xAI-hosted URLs."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   *
   * @returns {Object}
   * @sampleResult {"images":[{"url":"https://imgen.x.ai/xai-imgen/xai-tmp-imgen-a1b2c3d4.jpeg","revisedPrompt":"The original landscape photo with a dark stormy sky and a lightning bolt striking in the distance.","mimeType":"image/jpeg"}],"model":"grok-imagine-image"}
   */
  async editImage(prompt, imageUrls, model, n, saveToFileStorage, fileOptions) {
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    if (!imageUrls?.length) {
      throw new Error('At least one image URL is required')
    }

    const body = {
      model: model || DEFAULT_IMAGE_MODEL,
      prompt,
      response_format: saveToFileStorage ? 'b64_json' : 'url',
    }

    if (imageUrls.length === 1) {
      body.image = imageUrls[0]
    } else {
      body.images = imageUrls
    }

    if (n) body.n = n

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/images/edits`,
      body,
      logTag: 'editImage',
    })

    const data = response.data || []

    const images = saveToFileStorage
      ? await this.#saveGeneratedImages(data, fileOptions, 'editImage')
      : data.map(image => ({
        url: image.url,
        revisedPrompt: image.revised_prompt ?? null,
        mimeType: image.mime_type ?? null,
      }))

    return { images, model: body.model }
  }

  /**
   * @operationName Generate Video
   * @description Starts an asynchronous video generation with xAI's Grok Imagine video models from a text prompt and an optional starting image (image-to-video). Video generation runs in the background — this operation returns a request ID immediately; poll 'Get Video Result' with that ID until the video is ready. Duration ranges from 1 to 15 seconds (default 8).
   * @category Video Generation
   * @route POST /generate-video
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A description of the video to generate, including scene, motion and style."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getVideoModelsDictionary","defaultValue":"grok-imagine-video","description":"The video generation model to use. Defaults to 'grok-imagine-video'; use 'grok-imagine-video-1.5' for the latest generation."}
   * @paramDef {"type":"Number","label":"Duration (Seconds)","name":"duration","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Length of the generated video in seconds, between 1 and 15. Defaults to 8."}
   * @paramDef {"type":"String","label":"Resolution","name":"resolution","uiComponent":{"type":"DROPDOWN","options":{"values":["480p","720p","1080p"]}},"description":"The output resolution of the generated video."}
   * @paramDef {"type":"String","label":"Aspect Ratio","name":"aspectRatio","description":"The aspect ratio of the generated video, e.g. '16:9', '9:16' or '1:1'."}
   * @paramDef {"type":"String","label":"Image URL","name":"imageUrl","description":"Optional starting image for image-to-video generation — a public 'https://' URL or an xAI file ID."}
   *
   * @returns {Object}
   * @sampleResult {"request_id":"vg_7f2b1c9d-3e4a-4f5b-8c6d-9e0f1a2b3c4d","status":"pending"}
   */
  async generateVideo(prompt, model, duration, resolution, aspectRatio, imageUrl) {
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    const body = {
      model: model || DEFAULT_VIDEO_MODEL,
      prompt,
    }

    if (duration) body.duration = duration
    if (resolution) body.resolution = resolution
    if (aspectRatio) body.aspect_ratio = aspectRatio
    if (imageUrl) body.image = imageUrl

    return this.#apiRequest({
      url: `${ API_BASE_URL }/videos/generations`,
      body,
      logTag: 'generateVideo',
    })
  }

  /**
   * @operationName Edit Video
   * @description Starts an asynchronous edit of an existing video using natural-language instructions with xAI's Grok Imagine video models — restyle scenes, change elements or adjust the mood. Returns a request ID immediately; poll 'Get Video Result' with that ID until the edited video is ready.
   * @category Video Generation
   * @route POST /edit-video
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Natural-language editing instructions, e.g. 'Turn the scene into nighttime with neon lights'."}
   * @paramDef {"type":"String","label":"Video URL","name":"videoUrl","required":true,"description":"The video to edit — a public 'https://' URL or an xAI file ID."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getVideoModelsDictionary","defaultValue":"grok-imagine-video","description":"The video generation model to use. Defaults to 'grok-imagine-video'."}
   *
   * @returns {Object}
   * @sampleResult {"request_id":"vg_1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d","status":"pending"}
   */
  async editVideo(prompt, videoUrl, model) {
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    if (!videoUrl) {
      throw new Error('Video URL is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/videos/edits`,
      body: {
        model: model || DEFAULT_VIDEO_MODEL,
        prompt,
        video: videoUrl,
      },
      logTag: 'editVideo',
    })
  }

  /**
   * @operationName Extend Video
   * @description Starts an asynchronous extension of an existing video, generating a continuation described by the prompt with xAI's Grok Imagine video models. The extension can add 2 to 10 seconds (default 6). Returns a request ID immediately; poll 'Get Video Result' with that ID until the extended video is ready.
   * @category Video Generation
   * @route POST /extend-video
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A description of how the video should continue."}
   * @paramDef {"type":"String","label":"Video URL","name":"videoUrl","required":true,"description":"The video to extend — a public 'https://' URL or an xAI file ID."}
   * @paramDef {"type":"Number","label":"Duration (Seconds)","name":"duration","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Length of the continuation in seconds, between 2 and 10. Defaults to 6."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getVideoModelsDictionary","defaultValue":"grok-imagine-video","description":"The video generation model to use. Defaults to 'grok-imagine-video'."}
   *
   * @returns {Object}
   * @sampleResult {"request_id":"vg_9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a","status":"pending"}
   */
  async extendVideo(prompt, videoUrl, duration, model) {
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    if (!videoUrl) {
      throw new Error('Video URL is required')
    }

    const body = {
      model: model || DEFAULT_VIDEO_MODEL,
      prompt,
      video: videoUrl,
    }

    if (duration) body.duration = duration

    return this.#apiRequest({
      url: `${ API_BASE_URL }/videos/extensions`,
      body,
      logTag: 'extendVideo',
    })
  }

  /**
   * @operationName Get Video Result
   * @description Retrieves the result of an asynchronous video generation, edit or extension request by its request ID. Returns the status and, once complete, the generated video's URL, duration and moderation flag along with usage cost data. Poll this operation until the status indicates completion.
   * @category Video Generation
   * @route GET /get-video-result
   *
   * @paramDef {"type":"String","label":"Request ID","name":"requestId","required":true,"description":"The request ID returned by 'Generate Video', 'Edit Video' or 'Extend Video'."}
   *
   * @returns {Object}
   * @sampleResult {"status":"completed","video":{"url":"https://vidgen.x.ai/xai-vidgen/xai-tmp-vidgen-e5f6a7b8.mp4","duration":8,"respect_moderation":true},"model":"grok-imagine-video"}
   */
  async getVideoResult(requestId) {
    if (!requestId) {
      throw new Error('Request ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/videos/${ encodeURIComponent(requestId) }`,
      method: 'get',
      logTag: 'getVideoResult',
    })
  }

  /**
   * @operationName Tokenize Text
   * @description Tokenizes text with a specified Grok model's tokenizer and returns the token list and token count. Useful for estimating prompt cost and checking context window fit before sending a request.
   * @category Utilities
   * @route POST /tokenize-text
   *
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text to tokenize."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getChatModelsDictionary","defaultValue":"grok-4.5","description":"The model whose tokenizer to use. Defaults to 'grok-4.5'."}
   *
   * @returns {Object}
   * @sampleResult {"tokenCount":5,"tokens":[{"token_id":21873,"string_token":"Hello","token_bytes":[72,101,108,108,111]}]}
   */
  async tokenizeText(text, model) {
    if (!text) {
      throw new Error('Text is required')
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/tokenize-text`,
      body: {
        text,
        model: model || DEFAULT_CHAT_MODEL,
      },
      logTag: 'tokenizeText',
    })

    const tokens = Array.isArray(response) ? response : (response.tokens || response.token_ids || [])

    return { tokenCount: tokens.length, tokens }
  }

  /**
   * @operationName Get API Key Info
   * @description Retrieves information about the configured xAI API key, including its name, redacted value, access control list (permitted endpoints and models), and whether the key or team is blocked or disabled. Useful for verifying connectivity and permissions.
   * @category Account
   * @route GET /get-api-key-info
   *
   * @returns {Object}
   * @sampleResult {"redacted_api_key":"xai-...A1b2","user_id":"59fbe5f2-040b-46d5-8325-868bb8f23eb2","name":"Production key","create_time":"2026-01-15T17:18:11.735448Z","modify_time":"2026-06-20T18:47:19.171331Z","acls":["api-key:model:*","api-key:endpoint:*"],"api_key_id":"ae1e1841-4326-4b36-a8a9-8a1a7237db11","team_id":"5ea6f6bd-7815-4b8a-9135-28b2d7ba6722","api_key_blocked":false,"api_key_disabled":false,"team_blocked":false}
   */
  async getApiKeyInfo() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/api-key`,
      method: 'get',
      logTag: 'getApiKeyInfo',
    })
  }

  /**
   * @operationName List Models
   * @description Lists all xAI models available to the configured API key across every modality (chat, image understanding, image generation and video generation) with basic information. Use the dedicated language/image/video model listings for full metadata including pricing.
   * @category Models
   * @route GET /list-models
   *
   * @returns {Object}
   * @sampleResult {"object":"list","data":[{"id":"grok-4.5","object":"model","created":1783296000,"owned_by":"xai"},{"id":"grok-imagine-image","object":"model","created":1782000000,"owned_by":"xai"}]}
   */
  async listModels() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/models`,
      method: 'get',
      logTag: 'listModels',
    })
  }

  /**
   * @operationName Get Model
   * @description Retrieves basic information about a specific xAI model by its ID, including its owner, creation date and pricing basics.
   * @category Models
   * @route GET /get-model
   *
   * @paramDef {"type":"String","label":"Model","name":"modelId","required":true,"dictionary":"getModelsDictionary","description":"The model to fetch. Pick from the list or paste a model ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":"grok-4.5","object":"model","created":1783296000,"owned_by":"xai"}
   */
  async getModel(modelId) {
    if (!modelId) {
      throw new Error('Model ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/models/${ encodeURIComponent(modelId) }`,
      method: 'get',
      logTag: 'getModel',
    })
  }

  /**
   * @operationName List Language Models
   * @description Lists all xAI Grok language models (chat and image understanding) with full metadata: context window, aliases, input/output modalities, per-token prompt/completion/cached pricing and Live Search pricing.
   * @category Models
   * @route GET /list-language-models
   *
   * @returns {Object}
   * @sampleResult {"models":[{"id":"grok-4.5","fingerprint":"fp_8e1f2a3b","aliases":["grok-4.5-latest"],"version":"1.0.0","input_modalities":["text","image"],"output_modalities":["text"],"context_length":500000,"prompt_text_token_price":20000,"completion_text_token_price":60000,"cached_prompt_text_token_price":5000,"search_price":250000}]}
   */
  async listLanguageModels() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/language-models`,
      method: 'get',
      logTag: 'listLanguageModels',
    })
  }

  /**
   * @operationName List Image Generation Models
   * @description Lists all xAI image generation models (Grok Imagine) with full metadata: aliases, modalities, per-image pricing and maximum prompt length.
   * @category Models
   * @route GET /list-image-generation-models
   *
   * @returns {Object}
   * @sampleResult {"models":[{"id":"grok-imagine-image","fingerprint":"fp_4c5d6e7f","aliases":[],"version":"1.0.0","input_modalities":["text"],"output_modalities":["image"],"image_price":200000,"max_prompt_length":1024}]}
   */
  async listImageGenerationModels() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/image-generation-models`,
      method: 'get',
      logTag: 'listImageGenerationModels',
    })
  }

  /**
   * @operationName List Video Generation Models
   * @description Lists all xAI video generation models (Grok Imagine video) with full metadata: aliases, modalities and pricing.
   * @category Models
   * @route GET /list-video-generation-models
   *
   * @returns {Object}
   * @sampleResult {"models":[{"id":"grok-imagine-video","fingerprint":"fp_1a2b3c4d","aliases":[],"version":"1.0.0","input_modalities":["text","image"],"output_modalities":["video"]}]}
   */
  async listVideoGenerationModels() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/video-generation-models`,
      method: 'get',
      logTag: 'listVideoGenerationModels',
    })
  }
}

Flowrunner.ServerCode.addService(XaiGrokService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your xAI API key from https://console.x.ai (API Keys page)',
  },
])

function normalizeError(error) {
  if (error.body?.error?.message) {
    error.message = error.body.error.message
  } else if (typeof error.body?.error === 'string') {
    error.message = error.body.error
  } else if (error.body?.message) {
    error.message = error.body.message
  } else if (error.message && typeof error.message === 'object') {
    error.message = JSON.stringify(error.message)
  }

  return error
}
