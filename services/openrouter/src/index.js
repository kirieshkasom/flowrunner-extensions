'use strict'

const API_BASE_URL = 'https://openrouter.ai/api/v1'

const DEFAULT_CHAT_MODEL = 'openrouter/auto'
const DEFAULT_VISION_MODEL = 'google/gemini-2.5-flash'
const DEFAULT_EMBEDDINGS_MODEL = 'openai/text-embedding-3-small'
const DEFAULT_RERANK_MODEL = 'cohere/rerank-v3.5'
const DICTIONARY_PAGE_SIZE = 50

const MEDIA_TYPE_EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

const logger = {
  info: (...args) => console.log('[OpenRouter] info:', ...args),
  debug: (...args) => console.log('[OpenRouter] debug:', ...args),
  error: (...args) => console.log('[OpenRouter] error:', ...args),
  warn: (...args) => console.log('[OpenRouter] warn:', ...args),
}

/**
 * @usesFileStorage
 * @integrationName OpenRouter
 * @integrationIcon /icon.png
 */
class OpenRouterService {
  constructor(config) {
    this.apiKey = config.apiKey
    this.httpReferer = config.httpReferer
    this.appTitle = config.appTitle
  }

  async #apiRequest({ url, method = 'post', body, form, query, binary, logTag }) {
    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }]`)

      const headers = { 'Authorization': `Bearer ${ this.apiKey }` }

      if (this.httpReferer) {
        headers['HTTP-Referer'] = this.httpReferer
      }

      if (this.appTitle) {
        headers['X-OpenRouter-Title'] = this.appTitle
      }

      let request = Flowrunner.Request[method](url)
        .query(query || {})
        .set(headers)

      if (binary) {
        request = request.setEncoding(null).unwrapBody(false)
      }

      if (form) {
        request.form(form)
      } else if (body !== undefined) {
        request = request.set({ 'Content-Type': 'application/json' }).send(body)
      }

      const response = await request

      return binary && response?.body !== undefined ? response.body : response
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

  #extractFileName(url, fallback) {
    const pathname = url.split('?')[0].split('#')[0]

    return pathname.split('/').pop() || fallback
  }

  async #downloadFile(fileUrl, logTag) {
    if (!fileUrl || !/^https?:\/\//i.test(fileUrl)) {
      throw new Error(`Invalid fileUrl '${ fileUrl }'. Should start with 'http://' or 'https://'`)
    }

    logger.debug(`${ logTag } - downloading file from: ${ fileUrl }`)

    const rawBytes = await Flowrunner.Request.get(fileUrl).setEncoding(null)

    return Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(rawBytes)
  }

  #formatModelItems(models) {
    return models.map(model => {
      const promptPrice = Number(model.pricing?.prompt)
      const completionPrice = Number(model.pricing?.completion)

      const note = [
        model.context_length && `${ model.context_length } ctx`,
        Number.isFinite(promptPrice) && `$${ (promptPrice * 1e6).toFixed(2) }/M in`,
        Number.isFinite(completionPrice) && `$${ (completionPrice * 1e6).toFixed(2) }/M out`,
      ].filter(Boolean).join(' · ')

      return { label: model.name || model.id, value: model.id, note: note || model.id }
    })
  }

  // Dictionary over the paginated GET /models endpoint (server-side search via 'q' and offset pagination).
  async #serverModelsDictionary(payload, extraQuery, filterFn, logTag) {
    const { search, cursor } = payload || {}
    const offset = parseInt(cursor, 10) || 0

    const query = { limit: DICTIONARY_PAGE_SIZE, offset, ...extraQuery }

    if (search?.trim()) {
      query.q = search.trim()
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/models`,
      method: 'get',
      query,
      logTag,
    })

    const fetched = response.data || []
    const models = filterFn ? fetched.filter(filterFn) : fetched

    return {
      items: this.#formatModelItems(models),
      cursor: response.links?.next ? String(offset + fetched.length) : null,
    }
  }

  // Dictionary over small, unpaginated model list endpoints (client-side search and offset pagination).
  async #staticModelsDictionary(payload, url, logTag) {
    const { search, cursor } = payload || {}
    const offset = parseInt(cursor, 10) || 0

    const response = await this.#apiRequest({ url, method: 'get', logTag })

    let models = response.data || []

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      models = models.filter(model =>
        model.id.toLowerCase().includes(searchLower) || (model.name || '').toLowerCase().includes(searchLower))
    }

    const page = models.slice(offset, offset + DICTIONARY_PAGE_SIZE)

    return {
      items: this.#formatModelItems(page),
      cursor: offset + DICTIONARY_PAGE_SIZE < models.length ? String(offset + DICTIONARY_PAGE_SIZE) : null,
    }
  }

  /**
   * @typedef {Object} getModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by name or slug."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (offset) returned by a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Models Dictionary
   * @description Provides a searchable, paginated list of all models available through OpenRouter (hundreds of models across every provider) with context size and pricing shown for each model.
   * @route POST /get-models-dictionary
   * @paramDef {"type":"getModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Claude Sonnet 4.5","value":"anthropic/claude-sonnet-4.5","note":"1000000 ctx · $3.00/M in · $15.00/M out"}],"cursor":"50"}
   */
  async getModelsDictionary(payload) {
    return this.#serverModelsDictionary(payload, {}, null, 'getModelsDictionary')
  }

  /**
   * @typedef {Object} getChatModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by name or slug."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (offset) returned by a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Chat Models Dictionary
   * @description Provides a searchable, paginated list of OpenRouter models that produce text output, suitable for chat completion requests.
   * @route POST /get-chat-models-dictionary
   * @paramDef {"type":"getChatModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Auto Router","value":"openrouter/auto","note":"2000000 ctx"},{"label":"GPT-5.2","value":"openai/gpt-5.2","note":"400000 ctx · $1.25/M in · $10.00/M out"}],"cursor":"50"}
   */
  async getChatModelsDictionary(payload) {
    return this.#serverModelsDictionary(payload, { output_modalities: 'text' }, null, 'getChatModelsDictionary')
  }

  /**
   * @typedef {Object} getVisionModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by name or slug."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (offset) returned by a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Vision Models Dictionary
   * @description Provides a searchable, paginated list of multimodal OpenRouter models that accept image input and produce text output, suitable for image analysis.
   * @route POST /get-vision-models-dictionary
   * @paramDef {"type":"getVisionModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Gemini 2.5 Flash","value":"google/gemini-2.5-flash","note":"1048576 ctx · $0.30/M in · $2.50/M out"}],"cursor":null}
   */
  async getVisionModelsDictionary(payload) {
    return this.#serverModelsDictionary(
      payload,
      { input_modalities: 'image', output_modalities: 'text' },
      null,
      'getVisionModelsDictionary'
    )
  }

  /**
   * @typedef {Object} getImageModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by name or slug."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (offset) returned by a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Image Models Dictionary
   * @description Provides a searchable list of OpenRouter image generation models (e.g. Seedream, FLUX, Gemini image models) for the Generate Image operation.
   * @route POST /get-image-models-dictionary
   * @paramDef {"type":"getImageModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Seedream 4.5","value":"bytedance-seed/seedream-4.5","note":"$0.03/M in"}],"cursor":null}
   */
  async getImageModelsDictionary(payload) {
    return this.#staticModelsDictionary(payload, `${ API_BASE_URL }/images/models`, 'getImageModelsDictionary')
  }

  /**
   * @typedef {Object} getVideoModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by name or slug."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (offset) returned by a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Video Models Dictionary
   * @description Provides a searchable list of OpenRouter video generation models (e.g. Veo, Sora, Seedance) for the Generate Video operation.
   * @route POST /get-video-models-dictionary
   * @paramDef {"type":"getVideoModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Veo 3.1","value":"google/veo-3.1","note":"google/veo-3.1"}],"cursor":null}
   */
  async getVideoModelsDictionary(payload) {
    return this.#staticModelsDictionary(payload, `${ API_BASE_URL }/videos/models`, 'getVideoModelsDictionary')
  }

  /**
   * @typedef {Object} getEmbeddingsModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by name or slug."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (offset) returned by a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Embeddings Models Dictionary
   * @description Provides a searchable list of OpenRouter embeddings models for the Create Embeddings operation.
   * @route POST /get-embeddings-models-dictionary
   * @paramDef {"type":"getEmbeddingsModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Text Embedding 3 Small","value":"openai/text-embedding-3-small","note":"8191 ctx · $0.02/M in"}],"cursor":null}
   */
  async getEmbeddingsModelsDictionary(payload) {
    return this.#staticModelsDictionary(payload, `${ API_BASE_URL }/embeddings/models`, 'getEmbeddingsModelsDictionary')
  }

  /**
   * @typedef {Object} getTtsModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by name or slug."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (offset) returned by a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get TTS Models Dictionary
   * @description Provides a searchable, paginated list of OpenRouter text-to-speech models (audio-output models exposing selectable voices) for the Text to Speech operation.
   * @route POST /get-tts-models-dictionary
   * @paramDef {"type":"getTtsModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Voxtral Mini TTS","value":"mistralai/voxtral-mini-tts-2603","note":"2048 ctx"}],"cursor":null}
   */
  async getTtsModelsDictionary(payload) {
    return this.#serverModelsDictionary(
      payload,
      { output_modalities: 'audio' },
      model => Boolean(model.supported_voices?.length) || /tts/i.test(model.id),
      'getTtsModelsDictionary'
    )
  }

  /**
   * @typedef {Object} getSttModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by name or slug."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (offset) returned by a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get STT Models Dictionary
   * @description Provides a searchable, paginated list of OpenRouter models that accept audio input and produce text output (e.g. Whisper, Voxtral, Gemini) for the Transcribe Audio operation.
   * @route POST /get-stt-models-dictionary
   * @paramDef {"type":"getSttModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Whisper Large v3","value":"openai/whisper-large-v3","note":"448 ctx"}],"cursor":null}
   */
  async getSttModelsDictionary(payload) {
    return this.#serverModelsDictionary(
      payload,
      { input_modalities: 'audio', output_modalities: 'text' },
      null,
      'getSttModelsDictionary'
    )
  }

  /**
   * @typedef {Object} getRerankModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by name or slug."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (offset) returned by a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Rerank Models Dictionary
   * @description Provides a searchable list of OpenRouter rerank models (e.g. Cohere Rerank) for the Rerank Documents operation.
   * @route POST /get-rerank-models-dictionary
   * @paramDef {"type":"getRerankModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Rerank v3.5","value":"cohere/rerank-v3.5","note":"4096 ctx"}],"cursor":null}
   */
  async getRerankModelsDictionary(payload) {
    const search = payload?.search?.trim() ? payload.search : 'rerank'

    return this.#serverModelsDictionary(
      { ...payload, search },
      {},
      model => /rerank/i.test(model.id),
      'getRerankModelsDictionary'
    )
  }

  /**
   * @typedef {Object} getVoicesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Model","name":"model","description":"The text-to-speech model whose voices to list."}
   */

  /**
   * @typedef {Object} getVoicesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter voices by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — voice lists are not paginated."}
   * @paramDef {"type":"getVoicesDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The text-to-speech model whose voices to list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Voices Dictionary
   * @description Provides the list of voices supported by the selected OpenRouter text-to-speech model, read live from the model's metadata.
   * @route POST /get-voices-dictionary
   * @paramDef {"type":"getVoicesDictionary__payload","label":"Payload","name":"payload","description":"Search text and the TTS model criteria whose voices to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"en_paul_neutral","value":"en_paul_neutral","note":"mistralai/voxtral-mini-tts-2603"}],"cursor":null}
   */
  async getVoicesDictionary(payload) {
    const { search, criteria } = payload || {}
    const model = criteria?.model

    if (!model) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/models`,
      method: 'get',
      query: { q: model.split(':')[0] },
      logTag: 'getVoicesDictionary',
    })

    const match = (response.data || []).find(item => item.id === model || item.canonical_slug === model)

    let voices = match?.supported_voices || []

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      voices = voices.filter(voice => String(voice).toLowerCase().includes(searchLower))
    }

    return {
      items: voices.map(voice => ({ label: String(voice), value: String(voice), note: model })),
      cursor: null,
    }
  }

  /**
   * @operationName Chat Completion
   * @description Generates a text response for a single prompt using any of the hundreds of models available through OpenRouter (OpenAI, Anthropic, Google, Meta, Mistral, DeepSeek and more) via one unified API. Supports an optional system prompt, model fallbacks for automatic failover, provider sorting (cheapest/fastest/lowest latency), reasoning effort for reasoning models, JSON mode and OpenRouter's web search plugin for grounded answers. Defaults to the 'openrouter/auto' router, which picks the best model for the prompt. Returns the generated text, extracted reasoning (when available), the model and provider that served the request, finish reason, token usage and the generation ID for cost lookup via Get Generation.
   * @category Chat
   * @route POST /chat-completion
   *
   * @executionTimeoutInSeconds 180
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The user message to send to the model."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getChatModelsDictionary","defaultValue":"openrouter/auto","description":"The model to use, e.g. 'anthropic/claude-sonnet-4.5' or 'openai/gpt-5.2'. Defaults to 'openrouter/auto', which routes to the best model for the prompt."}
   * @paramDef {"type":"String","label":"System Prompt","name":"systemPrompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional system instructions that set the model's behavior, tone and constraints."}
   * @paramDef {"type":"Array<String>","label":"Fallback Models","name":"fallbackModels","description":"Optional ordered list of fallback model slugs. If the primary model is unavailable or errors, OpenRouter automatically retries with these models in order."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature between 0 and 2. Higher values produce more random output. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Max Completion Tokens","name":"maxCompletionTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens the model may generate for the completion."}
   * @paramDef {"type":"Number","label":"Top P","name":"topP","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Nucleus sampling threshold between 0 and 1. Defaults to 1. Alter this or Temperature, not both."}
   * @paramDef {"type":"Number","label":"Seed","name":"seed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Seed for best-effort deterministic sampling. Determinism is not guaranteed by all providers."}
   * @paramDef {"type":"Array<String>","label":"Stop Sequences","name":"stop","description":"Up to 4 sequences where the model stops generating further tokens."}
   * @paramDef {"type":"Boolean","label":"JSON Mode","name":"jsonMode","uiComponent":{"type":"TOGGLE"},"description":"When enabled, forces the model to return valid JSON. Your prompt should explicitly ask for JSON output."}
   * @paramDef {"type":"Boolean","label":"Enable Web Search","name":"enableWebSearch","uiComponent":{"type":"TOGGLE"},"description":"When enabled, activates OpenRouter's web search plugin so the model can ground its answer in current web results (adds per-search cost)."}
   * @paramDef {"type":"String","label":"Reasoning Effort","name":"reasoningEffort","uiComponent":{"type":"DROPDOWN","options":{"values":["None","Minimal","Low","Medium","High","XHigh","Max"]}},"description":"How much effort a reasoning-capable model spends thinking before answering. Leave empty to use the model's default; ignored by non-reasoning models."}
   * @paramDef {"type":"String","label":"Provider Sort","name":"providerSort","uiComponent":{"type":"DROPDOWN","options":{"values":["Price","Throughput","Latency"]}},"description":"Sorts the available providers for the model: 'Price' always uses the cheapest provider, 'Throughput' the fastest, 'Latency' the lowest time-to-first-token. Leave empty for OpenRouter's default load balancing."}
   *
   * @returns {Object}
   * @sampleResult {"text":"Model routing lets you use hundreds of AI models through one API.","reasoning":null,"model":"anthropic/claude-sonnet-4.5","provider":"Anthropic","finishReason":"stop","usage":{"prompt_tokens":24,"completion_tokens":14,"total_tokens":38},"id":"gen-1234567890-abcdef"}
   */
  async chatCompletion(prompt, model, systemPrompt, fallbackModels, temperature, maxCompletionTokens, topP, seed, stop, jsonMode, enableWebSearch, reasoningEffort, providerSort) {
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

    if (fallbackModels?.length) body.models = fallbackModels
    if (temperature !== undefined && temperature !== null) body.temperature = temperature
    if (maxCompletionTokens) body.max_completion_tokens = maxCompletionTokens
    if (topP !== undefined && topP !== null) body.top_p = topP
    if (seed !== undefined && seed !== null) body.seed = seed
    if (stop?.length) body.stop = stop
    if (jsonMode) body.response_format = { type: 'json_object' }
    if (enableWebSearch) body.plugins = [{ id: 'web' }]

    const resolvedEffort = this.#resolveChoice(reasoningEffort, {
      'None': 'none', 'Minimal': 'minimal', 'Low': 'low', 'Medium': 'medium',
      'High': 'high', 'XHigh': 'xhigh', 'Max': 'max',
    })

    if (resolvedEffort) body.reasoning = { effort: resolvedEffort }

    const resolvedSort = this.#resolveChoice(providerSort, {
      'Price': 'price', 'Throughput': 'throughput', 'Latency': 'latency',
    })

    if (resolvedSort) body.provider = { sort: resolvedSort }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/chat/completions`,
      body,
      logTag: 'chatCompletion',
    })

    const choice = response.choices?.[0]

    return {
      text: choice?.message?.content ?? '',
      reasoning: choice?.message?.reasoning ?? null,
      model: response.model,
      provider: response.provider ?? null,
      finishReason: choice?.finish_reason ?? null,
      usage: response.usage ?? null,
      id: response.id ?? null,
    }
  }

  /**
   * @operationName Chat Completion (Advanced)
   * @description Sends a fully custom chat completion request through OpenRouter's unified API with complete control over the request: full messages array (multi-turn conversations, multimodal content parts), model fallbacks, the complete provider routing preferences object (order, only, ignore, quantizations, sort, allow_fallbacks, data_collection, max_price, require_parameters), reasoning configuration, plugins (web search, file parser, auto router, context compression and more), tool/function calling passthrough, structured outputs via a response format object (json_object or json_schema) and all sampling parameters. Returns the raw OpenRouter API response including choices, tool calls, provider and usage.
   * @category Chat
   * @route POST /chat-completion-advanced
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"Array<Object>","label":"Messages","name":"messages","required":true,"description":"Conversation messages in OpenAI format, e.g. [{\"role\":\"system\",\"content\":\"...\"},{\"role\":\"user\",\"content\":\"...\"}]. Content may also be an array of content parts (text, image_url, input_audio, file) for multimodal models."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getChatModelsDictionary","defaultValue":"openrouter/auto","description":"The model to use. Defaults to 'openrouter/auto', which routes to the best model for the prompt."}
   * @paramDef {"type":"Array<String>","label":"Fallback Models","name":"models","description":"Optional ordered list of fallback model slugs tried automatically if the primary model is unavailable or errors."}
   * @paramDef {"type":"Object","label":"Provider Preferences","name":"provider","description":"OpenRouter provider routing preferences object, e.g. {\"order\":[\"anthropic\",\"openai\"],\"only\":[\"anthropic\"],\"ignore\":[\"deepinfra\"],\"quantizations\":[\"fp16\",\"bf16\"],\"sort\":\"price\",\"allow_fallbacks\":false,\"data_collection\":\"deny\",\"require_parameters\":true,\"max_price\":{\"prompt\":\"1\",\"completion\":\"5\"}}."}
   * @paramDef {"type":"Object","label":"Reasoning","name":"reasoning","description":"Reasoning configuration for reasoning-capable models, e.g. {\"effort\":\"high\"} (none/minimal/low/medium/high/xhigh/max), {\"max_tokens\":2000} or {\"enabled\":true,\"summary\":\"auto\"}."}
   * @paramDef {"type":"Array<Object>","label":"Plugins","name":"plugins","description":"OpenRouter plugins to enable, e.g. [{\"id\":\"web\",\"max_results\":5}] for web search, [{\"id\":\"file-parser\"}] for PDF parsing or [{\"id\":\"context-compression\"}] for middle-out compression of over-length prompts."}
   * @paramDef {"type":"Array<Object>","label":"Tools","name":"tools","description":"Tool definitions the model may call, in OpenAI function-calling format: [{\"type\":\"function\",\"function\":{\"name\":\"...\",\"description\":\"...\",\"parameters\":{...}}}]."}
   * @paramDef {"type":"String","label":"Tool Choice","name":"toolChoice","description":"Controls tool usage: 'none', 'auto', 'required', or a JSON string selecting a specific function, e.g. {\"type\":\"function\",\"function\":{\"name\":\"my_tool\"}}."}
   * @paramDef {"type":"Object","label":"Response Format","name":"responseFormat","description":"Structured output specification, e.g. {\"type\":\"json_object\"} or {\"type\":\"json_schema\",\"json_schema\":{\"name\":\"result\",\"strict\":true,\"schema\":{...}}}."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature between 0 and 2. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Top P","name":"topP","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Nucleus sampling threshold between 0 and 1. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Top K","name":"topK","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Limits sampling to the K most likely tokens at each step. Not supported by all providers."}
   * @paramDef {"type":"Number","label":"Min P","name":"minP","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Minimum probability threshold relative to the most likely token, between 0 and 1. Not supported by all providers."}
   * @paramDef {"type":"Number","label":"Max Completion Tokens","name":"maxCompletionTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens the model may generate for the completion."}
   * @paramDef {"type":"Array<String>","label":"Stop Sequences","name":"stop","description":"Up to 4 sequences where the model stops generating further tokens."}
   * @paramDef {"type":"Number","label":"Seed","name":"seed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Seed for best-effort deterministic sampling."}
   * @paramDef {"type":"Number","label":"Frequency Penalty","name":"frequencyPenalty","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number between -2.0 and 2.0. Positive values penalize repeated tokens, reducing verbatim repetition."}
   * @paramDef {"type":"Number","label":"Presence Penalty","name":"presencePenalty","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number between -2.0 and 2.0. Positive values encourage the model to talk about new topics."}
   * @paramDef {"type":"Number","label":"Repetition Penalty","name":"repetitionPenalty","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Penalizes tokens that already appeared in the text. 1.0 means no penalty; values above 1.0 penalize repetition more strongly. Not supported by all providers."}
   * @paramDef {"type":"String","label":"User","name":"user","description":"Optional stable identifier for your end user, used by OpenRouter and providers for abuse detection and per-user analytics."}
   *
   * @returns {Object}
   * @sampleResult {"id":"gen-1234567890-abcdef","object":"chat.completion","created":1752345600,"model":"anthropic/claude-sonnet-4.5","provider":"Anthropic","choices":[{"index":0,"message":{"role":"assistant","content":"Hello! How can I help you today?"},"finish_reason":"stop"}],"usage":{"prompt_tokens":18,"completion_tokens":10,"total_tokens":28}}
   */
  async chatCompletionAdvanced(messages, model, models, provider, reasoning, plugins, tools, toolChoice, responseFormat, temperature, topP, topK, minP, maxCompletionTokens, stop, seed, frequencyPenalty, presencePenalty, repetitionPenalty, user) {
    if (!messages?.length) {
      throw new Error('Messages array is required and must not be empty')
    }

    const body = {
      model: model || DEFAULT_CHAT_MODEL,
      messages,
    }

    if (models?.length) body.models = models
    if (provider && Object.keys(provider).length) body.provider = provider
    if (reasoning && Object.keys(reasoning).length) body.reasoning = reasoning
    if (plugins?.length) body.plugins = plugins
    if (tools?.length) body.tools = tools
    if (responseFormat) body.response_format = responseFormat
    if (temperature !== undefined && temperature !== null) body.temperature = temperature
    if (topP !== undefined && topP !== null) body.top_p = topP
    if (topK !== undefined && topK !== null) body.top_k = topK
    if (minP !== undefined && minP !== null) body.min_p = minP
    if (maxCompletionTokens) body.max_completion_tokens = maxCompletionTokens
    if (stop?.length) body.stop = stop
    if (seed !== undefined && seed !== null) body.seed = seed
    if (frequencyPenalty !== undefined && frequencyPenalty !== null) body.frequency_penalty = frequencyPenalty
    if (presencePenalty !== undefined && presencePenalty !== null) body.presence_penalty = presencePenalty
    if (repetitionPenalty !== undefined && repetitionPenalty !== null) body.repetition_penalty = repetitionPenalty
    if (user) body.user = user

    if (toolChoice) {
      body.tool_choice = /^\s*\{/.test(toolChoice) ? JSON.parse(toolChoice) : toolChoice
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/chat/completions`,
      body,
      logTag: 'chatCompletionAdvanced',
    })
  }

  /**
   * @operationName Analyze Image
   * @description Analyzes one or more images with any multimodal model available through OpenRouter and answers a prompt about them — describe content, extract text, compare images or answer visual questions. Accepts public image URLs or base64 data URLs. Supports JSON mode for structured extraction. Returns the answer text, the model and provider that served the request, finish reason and token usage.
   * @category Chat
   * @route POST /analyze-image
   *
   * @executionTimeoutInSeconds 180
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The question or instruction about the image(s), e.g. 'Describe this image' or 'Extract all visible text'."}
   * @paramDef {"type":"Array<String>","label":"Image URLs","name":"imageUrls","required":true,"description":"Image URLs to analyze. Each may be a public 'https://' URL or a base64 data URL like 'data:image/jpeg;base64,...'."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getVisionModelsDictionary","defaultValue":"google/gemini-2.5-flash","description":"The multimodal vision model to use. Defaults to 'google/gemini-2.5-flash'."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature between 0 and 2. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Max Completion Tokens","name":"maxCompletionTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens the model may generate for the answer."}
   * @paramDef {"type":"Boolean","label":"JSON Mode","name":"jsonMode","uiComponent":{"type":"TOGGLE"},"description":"When enabled, forces the model to return valid JSON. Your prompt should explicitly ask for JSON output."}
   *
   * @returns {Object}
   * @sampleResult {"text":"The image shows a golden retriever sitting in a park on a sunny day.","model":"google/gemini-2.5-flash","provider":"Google","finishReason":"stop","usage":{"prompt_tokens":812,"completion_tokens":18,"total_tokens":830}}
   */
  async analyzeImage(prompt, imageUrls, model, temperature, maxCompletionTokens, jsonMode) {
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    if (!imageUrls?.length) {
      throw new Error('At least one image URL is required')
    }

    const content = [
      { type: 'text', text: prompt },
      ...imageUrls.map(url => ({ type: 'image_url', image_url: { url } })),
    ]

    const body = {
      model: model || DEFAULT_VISION_MODEL,
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
      provider: response.provider ?? null,
      finishReason: choice?.finish_reason ?? null,
      usage: response.usage ?? null,
    }
  }

  /**
   * @operationName Generate Image
   * @description Generates one or more images from a text prompt using any image generation model available through OpenRouter (Seedream, FLUX, Gemini image models, GPT Image and more). Supports aspect ratio, resolution tier, output format, quality, background treatment, deterministic seeds and reference images for image-to-image generation. Saves each generated image to FlowRunner file storage and returns their URLs together with generation usage and cost.
   * @category Images
   * @route POST /generate-image
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text description of the desired image."}
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getImageModelsDictionary","description":"The image generation model to use, e.g. 'bytedance-seed/seedream-4.5'."}
   * @paramDef {"type":"String","label":"Aspect Ratio","name":"aspectRatio","uiComponent":{"type":"DROPDOWN","options":{"values":["1:1","2:3","3:2","3:4","4:3","4:5","5:4","9:16","16:9","21:9","9:21","2:1","1:2","Auto"]}},"description":"Aspect ratio of the generated image. Providers clamp to their supported subset. Leave empty for the model's default."}
   * @paramDef {"type":"String","label":"Resolution","name":"resolution","uiComponent":{"type":"DROPDOWN","options":{"values":["512","1K","2K","4K"]}},"description":"Normalized resolution tier of the generated image. Concrete pixel dimensions are derived per provider. Leave empty for the model's default."}
   * @paramDef {"type":"String","label":"Output Format","name":"outputFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["PNG","JPEG","WEBP","SVG"]}},"description":"Encoding of the returned image. SVG is only supported by vectorization models. Leave empty for the model's default (usually PNG)."}
   * @paramDef {"type":"String","label":"Quality","name":"quality","uiComponent":{"type":"DROPDOWN","options":{"values":["Auto","Low","Medium","High"]}},"description":"Rendering quality. Providers without a quality knob ignore this."}
   * @paramDef {"type":"String","label":"Background","name":"background","uiComponent":{"type":"DROPDOWN","options":{"values":["Auto","Transparent","Opaque"]}},"description":"Background treatment. 'Transparent' requires PNG or WEBP output format."}
   * @paramDef {"type":"Number","label":"Number of Images","name":"numberOfImages","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of images to generate (1-10). Providers that only support single-image generation reject values above 1. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Seed","name":"seed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Seed for deterministic generation. Repeated requests with the same seed and parameters should return the same image. Determinism is not guaranteed by all providers."}
   * @paramDef {"type":"Array<String>","label":"Reference Image URLs","name":"referenceImageUrls","description":"Up to 16 reference images to guide image-to-image generation, as public 'https://' URLs or base64 data URLs."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   *
   * @returns {Object}
   * @sampleResult {"images":[{"fileURL":"https://example.com/files/automation/tmp/openrouter_image_1752345600000_0.png","mediaType":"image/png"}],"created":1752345600,"usage":{"prompt_tokens":0,"completion_tokens":4175,"total_tokens":4175,"cost":0.04}}
   */
  async generateImage(prompt, model, aspectRatio, resolution, outputFormat, quality, background, numberOfImages, seed, referenceImageUrls, fileOptions) {
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    if (!model) {
      throw new Error('Model is required')
    }

    const resolvedFormat = this.#resolveChoice(outputFormat, {
      'PNG': 'png', 'JPEG': 'jpeg', 'WEBP': 'webp', 'SVG': 'svg',
    })

    const body = { model, prompt }

    if (aspectRatio) body.aspect_ratio = this.#resolveChoice(aspectRatio, { 'Auto': 'auto' })
    if (resolution) body.resolution = resolution
    if (resolvedFormat) body.output_format = resolvedFormat
    if (quality) body.quality = this.#resolveChoice(quality, { 'Auto': 'auto', 'Low': 'low', 'Medium': 'medium', 'High': 'high' })
    if (background) body.background = this.#resolveChoice(background, { 'Auto': 'auto', 'Transparent': 'transparent', 'Opaque': 'opaque' })
    if (numberOfImages) body.n = numberOfImages
    if (seed !== undefined && seed !== null) body.seed = seed

    if (referenceImageUrls?.length) {
      body.input_references = referenceImageUrls.map(url => ({ type: 'image_url', image_url: { url } }))
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/images`,
      body,
      logTag: 'generateImage',
    })

    const timestamp = Date.now()
    const images = []

    for (const [index, image] of (response.data || []).entries()) {
      const extension = MEDIA_TYPE_EXTENSIONS[image.media_type] || resolvedFormat || 'png'
      const buffer = Buffer.from(image.b64_json, 'base64')

      const { url } = await this.flowrunner.Files.uploadFile(buffer, {
        filename: `openrouter_image_${ timestamp }_${ index }.${ extension }`,
        generateUrl: true,
        overwrite: true,
        ...(fileOptions || { scope: 'FLOW' }),
      })

      images.push({ fileURL: url, mediaType: image.media_type || null })
    }

    return {
      images,
      created: response.created ?? null,
      usage: response.usage ?? null,
    }
  }

  /**
   * @operationName Text to Speech
   * @description Converts text into speech audio using any text-to-speech model available through OpenRouter (e.g. OpenAI TTS, Voxtral). Saves the generated audio to FlowRunner file storage and returns its URL.
   * @category Audio
   * @route POST /text-to-speech
   *
   * @executionTimeoutInSeconds 180
   *
   * @paramDef {"type":"String","label":"Input Text","name":"input","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text to convert to speech."}
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getTtsModelsDictionary","description":"The text-to-speech model to use, e.g. 'openai/gpt-4o-mini-tts'."}
   * @paramDef {"type":"String","label":"Voice","name":"voice","required":true,"dictionary":"getVoicesDictionary","dependsOn":["model"],"description":"The voice to use. Choose a model above to pick from its supported voices."}
   * @paramDef {"type":"String","label":"Response Format","name":"responseFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["MP3","PCM"]}},"defaultValue":"MP3","description":"Audio output format: 'MP3' for a ready-to-play file or 'PCM' for raw 16-bit little-endian samples. Defaults to 'MP3'."}
   * @paramDef {"type":"Number","label":"Speed","name":"speed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Playback speed multiplier. Only used by models that support it (e.g. OpenAI TTS); ignored by other providers. Defaults to 1."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   *
   * @returns {Object}
   * @sampleResult {"fileURL":"https://example.com/files/automation/tmp/tts_1752345600000.mp3"}
   */
  async textToSpeech(input, model, voice, responseFormat, speed, fileOptions) {
    if (!input || !input.trim()) {
      throw new Error('Input text is required')
    }

    if (!model) {
      throw new Error('Model is required')
    }

    if (!voice) {
      throw new Error('Voice is required')
    }

    const resolvedFormat = this.#resolveChoice(responseFormat, { 'MP3': 'mp3', 'PCM': 'pcm' }) || 'mp3'

    const body = {
      model,
      input,
      voice,
      response_format: resolvedFormat,
    }

    if (speed) body.speed = speed

    const audioBytes = await this.#apiRequest({
      url: `${ API_BASE_URL }/audio/speech`,
      binary: true,
      body,
      logTag: 'textToSpeech',
    })

    const buffer = Buffer.isBuffer(audioBytes) ? audioBytes : Buffer.from(audioBytes)

    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename: `tts_${ Date.now() }.${ resolvedFormat }`,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return { fileURL: url }
  }

  /**
   * @operationName Transcribe Audio
   * @description Transcribes an audio file into text using any speech-to-text model available through OpenRouter (Whisper, Voxtral, Gemini and more). Downloads the audio from the provided URL (FlowRunner file URL or any public URL, max 25 MB) and returns the transcription with usage. Verbose JSON output adds detected language, duration and segment/word-level timestamps on OpenAI-compatible providers.
   * @category Audio
   * @route POST /transcribe-audio
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"description":"URL of the audio file to transcribe — a FlowRunner file URL or any public 'http(s)://' URL. Maximum size is 25 MB."}
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getSttModelsDictionary","description":"The speech-to-text model to use, e.g. 'openai/whisper-large-v3'."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Optional ISO-639-1 language code of the audio (e.g. 'en', 'ja'). Auto-detected if omitted."}
   * @paramDef {"type":"String","label":"Response Format","name":"responseFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["JSON","Verbose JSON"]}},"defaultValue":"JSON","description":"'JSON' returns the text and usage; 'Verbose JSON' additionally returns task, language, duration and segment-level timestamps (OpenAI-compatible providers only)."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature for the transcription. Defaults to 0 for deterministic output."}
   * @paramDef {"type":"Array<String>","label":"Timestamp Granularities","name":"timestampGranularities","uiComponent":{"type":"DROPDOWN","options":{"values":["Word","Segment"]}},"description":"Timestamp detail levels to include. Selecting any value automatically switches the response format to 'Verbose JSON'."}
   *
   * @returns {Object}
   * @sampleResult {"text":"Welcome everyone to the quarterly business review.","usage":{"input_tokens":83,"output_tokens":12,"total_tokens":95,"seconds":9.2,"cost":0.000508}}
   */
  async transcribeAudio(fileUrl, model, language, responseFormat, temperature, timestampGranularities) {
    if (!model) {
      throw new Error('Model is required')
    }

    const fileBuffer = await this.#downloadFile(fileUrl, 'transcribeAudio')

    const granularities = (timestampGranularities || [])
      .map(value => this.#resolveChoice(value, { 'Word': 'word', 'Segment': 'segment' }))
      .filter(Boolean)

    let resolvedFormat = this.#resolveChoice(responseFormat, { 'JSON': 'json', 'Verbose JSON': 'verbose_json' }) || 'json'

    if (granularities.length) {
      resolvedFormat = 'verbose_json'
    }

    const form = new Flowrunner.Request.FormData()

    form.append('file', fileBuffer, { filename: this.#extractFileName(fileUrl, 'audio') })
    form.append('model', model)
    form.append('response_format', resolvedFormat)

    if (language) form.append('language', language)
    if (temperature !== undefined && temperature !== null) form.append('temperature', String(temperature))

    for (const granularity of granularities) {
      form.append('timestamp_granularities[]', granularity)
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/audio/transcriptions`,
      form,
      logTag: 'transcribeAudio',
    })
  }

  /**
   * @operationName Generate Video
   * @description Submits an asynchronous video generation job using any video model available through OpenRouter (Veo, Sora, Seedance and more). Returns immediately with a job ID and status — poll the job with Get Video Status and save the finished video with Download Video, or provide a callback URL to be notified when the job completes.
   * @category Video
   * @route POST /generate-video
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text description of the desired video."}
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getVideoModelsDictionary","description":"The video generation model to use, e.g. 'google/veo-3.1'."}
   * @paramDef {"type":"Number","label":"Duration","name":"duration","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Duration of the generated video in seconds. Supported values vary per model."}
   * @paramDef {"type":"String","label":"Aspect Ratio","name":"aspectRatio","uiComponent":{"type":"DROPDOWN","options":{"values":["16:9","9:16","1:1","4:3","3:4","3:2","2:3","21:9","9:21"]}},"description":"Aspect ratio of the generated video. Leave empty for the model's default."}
   * @paramDef {"type":"String","label":"Resolution","name":"resolution","uiComponent":{"type":"DROPDOWN","options":{"values":["480p","720p","1080p","1K","2K","4K"]}},"description":"Resolution of the generated video. Leave empty for the model's default."}
   * @paramDef {"type":"Boolean","label":"Generate Audio","name":"generateAudio","uiComponent":{"type":"TOGGLE"},"description":"Whether to generate audio alongside the video, on models that support it."}
   * @paramDef {"type":"Number","label":"Seed","name":"seed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Seed for deterministic generation. Determinism is not guaranteed by all providers."}
   * @paramDef {"type":"String","label":"Callback URL","name":"callbackUrl","description":"Optional HTTPS URL that receives a webhook notification when the video generation job completes."}
   *
   * @returns {Object}
   * @sampleResult {"id":"job-abc123","status":"pending","polling_url":"/api/v1/videos/job-abc123"}
   */
  async generateVideo(prompt, model, duration, aspectRatio, resolution, generateAudio, seed, callbackUrl) {
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    if (!model) {
      throw new Error('Model is required')
    }

    const body = { model, prompt }

    if (duration) body.duration = duration
    if (aspectRatio) body.aspect_ratio = aspectRatio
    if (resolution) body.resolution = resolution
    if (generateAudio !== undefined && generateAudio !== null) body.generate_audio = generateAudio
    if (seed !== undefined && seed !== null) body.seed = seed
    if (callbackUrl) body.callback_url = callbackUrl

    return this.#apiRequest({
      url: `${ API_BASE_URL }/videos`,
      body,
      logTag: 'generateVideo',
    })
  }

  /**
   * @operationName Get Video Status
   * @description Polls the status of a video generation job by its job ID. The status progresses through pending, in_progress and completed (or failed/cancelled/expired). Once completed, the response includes the generation ID for cost lookup and unsigned URLs of the results; save the video with Download Video.
   * @category Video
   * @route GET /get-video-status
   *
   * @paramDef {"type":"String","label":"Job ID","name":"jobId","required":true,"description":"The video generation job ID returned by Generate Video."}
   *
   * @returns {Object}
   * @sampleResult {"id":"job-abc123","status":"completed","polling_url":"/api/v1/videos/job-abc123","generation_id":"gen-xyz789","unsigned_urls":["https://cdn.openrouter.ai/videos/job-abc123-0.mp4"],"usage":{"cost":0.4}}
   */
  async getVideoStatus(jobId) {
    if (!jobId) {
      throw new Error('Job ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/videos/${ encodeURIComponent(jobId) }`,
      method: 'get',
      logTag: 'getVideoStatus',
    })
  }

  /**
   * @operationName Download Video
   * @description Downloads the finished video content of a completed video generation job, saves it to FlowRunner file storage and returns its URL. Use the index parameter to pick a specific result when the job produced multiple videos.
   * @category Video
   * @route POST /download-video
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Job ID","name":"jobId","required":true,"description":"The completed video generation job ID returned by Generate Video."}
   * @paramDef {"type":"Number","label":"Index","name":"index","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based index of the video to download when the job produced multiple results. Defaults to 0."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   *
   * @returns {Object}
   * @sampleResult {"fileURL":"https://example.com/files/automation/tmp/openrouter_video_job-abc123.mp4"}
   */
  async downloadVideo(jobId, index, fileOptions) {
    if (!jobId) {
      throw new Error('Job ID is required')
    }

    const videoBytes = await this.#apiRequest({
      url: `${ API_BASE_URL }/videos/${ encodeURIComponent(jobId) }/content`,
      method: 'get',
      binary: true,
      query: index ? { index } : {},
      logTag: 'downloadVideo',
    })

    const buffer = Buffer.isBuffer(videoBytes) ? videoBytes : Buffer.from(videoBytes)

    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename: `openrouter_video_${ jobId }${ index ? `_${ index }` : '' }.mp4`,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return { fileURL: url }
  }

  /**
   * @operationName Create Embeddings
   * @description Generates embedding vectors for one or more texts using any embeddings model available through OpenRouter (OpenAI, Google, Qwen, Mistral and more). Returns the embedding vectors together with the model used and token usage — ideal for semantic search, clustering and RAG pipelines.
   * @category Embeddings
   * @route POST /create-embeddings
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Array<String>","label":"Texts","name":"texts","required":true,"description":"One or more texts to embed. Each text produces one embedding vector in the result."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getEmbeddingsModelsDictionary","defaultValue":"openai/text-embedding-3-small","description":"The embeddings model to use. Defaults to 'openai/text-embedding-3-small'."}
   * @paramDef {"type":"Number","label":"Dimensions","name":"dimensions","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of dimensions for the output vectors, on models that support shortening embeddings. Leave empty for the model's default."}
   * @paramDef {"type":"String","label":"Input Type","name":"inputType","uiComponent":{"type":"DROPDOWN","options":{"values":["Search Query","Search Document","Classification","Clustering"]}},"description":"Hint for how the embeddings will be used, on models that support it (e.g. Cohere, Voyage). Leave empty for the model's default."}
   *
   * @returns {Object}
   * @sampleResult {"object":"list","model":"openai/text-embedding-3-small","data":[{"object":"embedding","index":0,"embedding":[0.0023064255,-0.009327292,0.015797347]}],"usage":{"prompt_tokens":8,"total_tokens":8}}
   */
  async createEmbeddings(texts, model, dimensions, inputType) {
    if (!texts?.length) {
      throw new Error('At least one text is required')
    }

    const body = {
      model: model || DEFAULT_EMBEDDINGS_MODEL,
      input: texts,
    }

    if (dimensions) body.dimensions = dimensions

    const resolvedInputType = this.#resolveChoice(inputType, {
      'Search Query': 'search_query',
      'Search Document': 'search_document',
      'Classification': 'classification',
      'Clustering': 'clustering',
    })

    if (resolvedInputType) body.input_type = resolvedInputType

    return this.#apiRequest({
      url: `${ API_BASE_URL }/embeddings`,
      body,
      logTag: 'createEmbeddings',
    })
  }

  /**
   * @operationName Rerank Documents
   * @description Reranks a list of documents by relevance to a search query using a rerank model available through OpenRouter (e.g. Cohere Rerank). Returns the documents sorted by relevance score with their original indexes — ideal as a precision step after vector search in RAG pipelines.
   * @category Embeddings
   * @route POST /rerank-documents
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"The search query to rank the documents against."}
   * @paramDef {"type":"Array<String>","label":"Documents","name":"documents","required":true,"description":"The list of documents (plain texts) to rerank."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getRerankModelsDictionary","defaultValue":"cohere/rerank-v3.5","description":"The rerank model to use. Defaults to 'cohere/rerank-v3.5'."}
   * @paramDef {"type":"Number","label":"Top N","name":"topN","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of most relevant documents to return. Leave empty to return all documents ranked."}
   *
   * @returns {Object}
   * @sampleResult {"id":"gen-rerank-1234567890-abc","model":"cohere/rerank-v3.5","results":[{"index":0,"relevance_score":0.98,"document":{"text":"Paris is the capital of France."}}],"usage":{"search_units":1,"total_tokens":150}}
   */
  async rerankDocuments(query, documents, model, topN) {
    if (!query || !query.trim()) {
      throw new Error('Query is required')
    }

    if (!documents?.length) {
      throw new Error('At least one document is required')
    }

    const body = {
      model: model || DEFAULT_RERANK_MODEL,
      query,
      documents,
    }

    if (topN) body.top_n = topN

    return this.#apiRequest({
      url: `${ API_BASE_URL }/rerank`,
      body,
      logTag: 'rerankDocuments',
    })
  }

  /**
   * @operationName Get Generation
   * @description Retrieves detailed request and usage metadata for a past generation by its ID (returned by every chat completion), including the exact total cost in credits, native and normalized token counts, cached/reasoning token counts, provider name, latency, generation time and finish reason. Use it for precise per-request cost accounting.
   * @category Insights
   * @route GET /get-generation
   *
   * @paramDef {"type":"String","label":"Generation ID","name":"generationId","required":true,"description":"The generation ID, e.g. 'gen-1234567890-abcdef', as returned in the 'id' field of a chat completion response."}
   *
   * @returns {Object}
   * @sampleResult {"id":"gen-1234567890-abcdef","model":"anthropic/claude-sonnet-4.5","provider_name":"Anthropic","total_cost":0.00492,"cache_discount":0,"tokens_prompt":24,"tokens_completion":14,"native_tokens_prompt":26,"native_tokens_completion":14,"native_tokens_reasoning":0,"generation_time":842,"latency":315,"finish_reason":"stop","created_at":"2026-07-13T10:15:00Z"}
   */
  async getGeneration(generationId) {
    if (!generationId) {
      throw new Error('Generation ID is required')
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/generation`,
      method: 'get',
      query: { id: generationId },
      logTag: 'getGeneration',
    })

    return response.data ?? response
  }

  /**
   * @operationName List Models
   * @description Lists models available through OpenRouter with rich filtering: free-text search, use-case category, input/output modalities, minimum context length, maximum prompt price and server-side sorting (popularity, newest, price, context, throughput, latency, intelligence). Each model includes its pricing, context length, architecture, supported parameters and description.
   * @category Models
   * @route GET /list-models
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Free-text search by model name or slug, e.g. 'claude' or 'deepseek'."}
   * @paramDef {"type":"String","label":"Category","name":"category","uiComponent":{"type":"DROPDOWN","options":{"values":["Programming","Roleplay","Marketing","Marketing/SEO","Technology","Science","Translation","Legal","Finance","Health","Trivia","Academia"]}},"description":"Filter models by use-case category."}
   * @paramDef {"type":"Array<String>","label":"Input Modalities","name":"inputModalities","uiComponent":{"type":"DROPDOWN","options":{"values":["Text","Image","Audio","File"]}},"description":"Only return models that accept all of the selected input modalities."}
   * @paramDef {"type":"Array<String>","label":"Output Modalities","name":"outputModalities","uiComponent":{"type":"DROPDOWN","options":{"values":["Text","Image","Audio","Embeddings"]}},"description":"Only return models that produce all of the selected output modalities."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","uiComponent":{"type":"DROPDOWN","options":{"values":["Most Popular","Newest","Top Weekly","Price: Low to High","Price: High to Low","Context: High to Low","Throughput: High to Low","Latency: Low to High","Intelligence: High to Low","Coding: High to Low"]}},"description":"Server-side sort order for the returned models."}
   * @paramDef {"type":"Number","label":"Min Context Length","name":"minContextLength","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Minimum context length in tokens. Models with a smaller context window are excluded."}
   * @paramDef {"type":"Number","label":"Max Prompt Price","name":"maxPromptPrice","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum prompt price in USD per million tokens. Set to 0 to list only free models."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of models to return (max 1000). Defaults to 500."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of models to skip, for pagination."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"anthropic/claude-sonnet-4.5","name":"Claude Sonnet 4.5","context_length":1000000,"pricing":{"prompt":"0.000003","completion":"0.000015"},"architecture":{"input_modalities":["text","image"],"output_modalities":["text"]},"supported_parameters":["temperature","top_p","tools"]}],"total_count":523}
   */
  async listModels(search, category, inputModalities, outputModalities, sort, minContextLength, maxPromptPrice, limit, offset) {
    const query = {}

    if (search?.trim()) query.q = search.trim()

    const resolvedCategory = this.#resolveChoice(category, {
      'Programming': 'programming', 'Roleplay': 'roleplay', 'Marketing': 'marketing',
      'Marketing/SEO': 'marketing/seo', 'Technology': 'technology', 'Science': 'science',
      'Translation': 'translation', 'Legal': 'legal', 'Finance': 'finance',
      'Health': 'health', 'Trivia': 'trivia', 'Academia': 'academia',
    })

    if (resolvedCategory) query.category = resolvedCategory

    const modalityMapping = {
      'Text': 'text', 'Image': 'image', 'Audio': 'audio', 'File': 'file', 'Embeddings': 'embeddings',
    }

    if (inputModalities?.length) {
      query.input_modalities = inputModalities.map(value => this.#resolveChoice(value, modalityMapping)).join(',')
    }

    if (outputModalities?.length) {
      query.output_modalities = outputModalities.map(value => this.#resolveChoice(value, modalityMapping)).join(',')
    }

    const resolvedSort = this.#resolveChoice(sort, {
      'Most Popular': 'most-popular',
      'Newest': 'newest',
      'Top Weekly': 'top-weekly',
      'Price: Low to High': 'pricing-low-to-high',
      'Price: High to Low': 'pricing-high-to-low',
      'Context: High to Low': 'context-high-to-low',
      'Throughput: High to Low': 'throughput-high-to-low',
      'Latency: Low to High': 'latency-low-to-high',
      'Intelligence: High to Low': 'intelligence-high-to-low',
      'Coding: High to Low': 'coding-high-to-low',
    })

    if (resolvedSort) query.sort = resolvedSort
    if (minContextLength) query.context = minContextLength
    if (maxPromptPrice !== undefined && maxPromptPrice !== null) query.max_price = maxPromptPrice
    if (limit) query.limit = limit
    if (offset) query.offset = offset

    return this.#apiRequest({
      url: `${ API_BASE_URL }/models`,
      method: 'get',
      query,
      logTag: 'listModels',
    })
  }

  /**
   * @operationName Get Model Endpoints
   * @description Retrieves all provider endpoints serving a specific model, with each endpoint's provider name, pricing, context length, max completion tokens, quantization, supported parameters, uptime and status. Use it to compare providers before pinning routing with provider preferences.
   * @category Models
   * @route GET /get-model-endpoints
   *
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getModelsDictionary","description":"The model whose provider endpoints to list. Pick from the list or paste a model slug like 'anthropic/claude-sonnet-4.5'."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"id":"anthropic/claude-sonnet-4.5","name":"Claude Sonnet 4.5","endpoints":[{"provider_name":"Anthropic","context_length":1000000,"max_completion_tokens":64000,"quantization":null,"pricing":{"prompt":"0.000003","completion":"0.000015"},"supported_parameters":["temperature","tools"],"status":0,"uptime_last_30m":99.8}]}}
   */
  async getModelEndpoints(model) {
    if (!model || !model.includes('/')) {
      throw new Error("Model is required and must be a full slug like 'author/slug'")
    }

    const [author, ...slugParts] = model.split('/')
    const slug = slugParts.join('/')

    return this.#apiRequest({
      url: `${ API_BASE_URL }/models/${ encodeURIComponent(author) }/${ encodeURIComponent(slug) }/endpoints`,
      method: 'get',
      logTag: 'getModelEndpoints',
    })
  }

  /**
   * @operationName List Providers
   * @description Lists all inference providers available through OpenRouter with their slugs (for use in provider routing preferences), headquarters, datacenter regions, and privacy policy, terms of service and status page URLs.
   * @category Models
   * @route GET /list-providers
   *
   * @returns {Object}
   * @sampleResult {"data":[{"name":"OpenAI","slug":"openai","headquarters":"US","datacenters":["US","IE"],"privacy_policy_url":"https://openai.com/privacy","terms_of_service_url":"https://openai.com/terms","status_page_url":"https://status.openai.com"}]}
   */
  async listProviders() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/providers`,
      method: 'get',
      logTag: 'listProviders',
    })
  }

  /**
   * @operationName Get Credits
   * @description Retrieves the total credits purchased and total credits used for the OpenRouter account. The remaining balance is total_credits minus total_usage — useful for balance monitoring and low-credit alerts in flows.
   * @category Account
   * @route GET /get-credits
   *
   * @returns {Object}
   * @sampleResult {"total_credits":100.5,"total_usage":25.75}
   */
  async getCredits() {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/credits`,
      method: 'get',
      logTag: 'getCredits',
    })

    return response.data ?? response
  }

  /**
   * @operationName Get Key Info
   * @description Retrieves information about the API key used for this connection, including its label, spending limit, remaining limit, limit reset interval, free-tier status and current usage — useful for monitoring spend and rate limit headroom in flows.
   * @category Account
   * @route GET /get-key-info
   *
   * @returns {Object}
   * @sampleResult {"label":"sk-or-v1-au7...890","usage":25.5,"limit":100,"limit_remaining":74.5,"limit_reset":"monthly","is_free_tier":false,"is_provisioning_key":false,"expires_at":null}
   */
  async getKeyInfo() {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/key`,
      method: 'get',
      logTag: 'getKeyInfo',
    })

    return response.data ?? response
  }

  /**
   * @operationName Get Activity
   * @description Retrieves the account's usage activity for the last 30 days, grouped by day, model and provider — each item includes request count, prompt/completion/reasoning token totals and spend. Optionally filter to a single UTC date.
   * @category Account
   * @route GET /get-activity
   *
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Optional single UTC date within the last 30 days to filter by, in 'YYYY-MM-DD' format."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"date":"2026-07-12","model":"anthropic/claude-sonnet-4.5","model_permaslug":"anthropic/claude-sonnet-4.5","provider_name":"Anthropic","requests":42,"prompt_tokens":10500,"completion_tokens":8300,"reasoning_tokens":1200,"usage":0.61}]}
   */
  async getActivity(date) {
    const query = {}

    if (date) {
      query.date = String(date).slice(0, 10)
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/activity`,
      method: 'get',
      query,
      logTag: 'getActivity',
    })
  }
}

Flowrunner.ServerCode.addService(OpenRouterService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your OpenRouter API key from https://openrouter.ai/settings/keys',
  },
  {
    name: 'httpReferer',
    displayName: 'App URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: "Optional. Your app's URL, sent as the HTTP-Referer attribution header used by OpenRouter for app rankings.",
  },
  {
    name: 'appTitle',
    displayName: 'App Title',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: "Optional. Your app's display name, sent as the X-OpenRouter-Title attribution header shown on openrouter.ai rankings.",
  },
])

function normalizeError(error) {
  if (error.body?.error?.message) {
    error.message = error.body.error.message
  } else if (error.body?.message) {
    error.message = error.body.message
  } else if (error.message && typeof error.message === 'object') {
    error.message = JSON.stringify(error.message)
  }

  return error
}
