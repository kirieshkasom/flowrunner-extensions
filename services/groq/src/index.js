'use strict'

const API_BASE_URL = 'https://api.groq.com/openai/v1'

const DEFAULT_CHAT_MODEL = 'llama-3.3-70b-versatile'
const DEFAULT_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct'
const DEFAULT_TRANSCRIPTION_MODEL = 'whisper-large-v3-turbo'
const DEFAULT_TRANSLATION_MODEL = 'whisper-large-v3'
const DEFAULT_TTS_MODEL = 'canopylabs/orpheus-v1-english'
const DEFAULT_TTS_VOICE = 'troy'
const DEFAULT_TTS_RESPONSE_FORMAT = 'wav'
const MAX_VISION_IMAGES = 5

const TTS_VOICES = {
  'canopylabs/orpheus-v1-english': [
    { label: 'Autumn (female)', value: 'autumn' },
    { label: 'Diana (female)', value: 'diana' },
    { label: 'Hannah (female)', value: 'hannah' },
    { label: 'Austin (male)', value: 'austin' },
    { label: 'Daniel (male)', value: 'daniel' },
    { label: 'Troy (male)', value: 'troy' },
  ],
  'canopylabs/orpheus-arabic-saudi': [
    { label: 'Lulwa (female)', value: 'lulwa' },
    { label: 'Noura (female)', value: 'noura' },
    { label: 'Aisha (female)', value: 'aisha' },
    { label: 'Abdullah (male)', value: 'abdullah' },
    { label: 'Fahad (male)', value: 'fahad' },
    { label: 'Sultan (male)', value: 'sultan' },
  ],
}

const logger = {
  info: (...args) => console.log('[Groq] info:', ...args),
  debug: (...args) => console.log('[Groq] debug:', ...args),
  error: (...args) => console.log('[Groq] error:', ...args),
  warn: (...args) => console.log('[Groq] warn:', ...args),
}

/**
 * @usesFileStorage
 * @integrationName Groq
 * @integrationIcon /icon.svg
 */
class GroqService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  async #apiRequest({ url, method = 'post', body, form, query, binary, logTag }) {
    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }]`)

      let request = Flowrunner.Request[method](url)
        .query(query || {})
        .set({ 'Authorization': `Bearer ${ this.apiKey }` })

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

  async #modelsDictionary(payload, filterFn) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/models`,
      method: 'get',
      logTag: 'modelsDictionary',
    })

    let models = (response.data || []).filter(model => filterFn(model.id))

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      models = models.filter(model => model.id.toLowerCase().includes(searchLower))
    }

    return {
      items: models
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(model => ({
          label: model.id,
          value: model.id,
          note: [model.owned_by, model.context_window && `${ model.context_window } ctx`].filter(Boolean).join(' · '),
        })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — Groq's model list is not paginated."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Models Dictionary
   * @description Provides a searchable, live list of all active Groq models (chat, vision, speech-to-text, text-to-speech, guard and agentic models) for dynamic parameter selection.
   * @route POST /get-models-dictionary
   * @paramDef {"type":"getModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"llama-3.3-70b-versatile","value":"llama-3.3-70b-versatile","note":"Meta · 131072 ctx"}],"cursor":null}
   */
  async getModelsDictionary(payload) {
    return this.#modelsDictionary(payload, () => true)
  }

  /**
   * @typedef {Object} getChatModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — Groq's model list is not paginated."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Chat Models Dictionary
   * @description Provides a searchable, live list of Groq chat/completion models (text, vision, reasoning and agentic models), excluding speech-to-text, text-to-speech and prompt-guard models.
   * @route POST /get-chat-models-dictionary
   * @paramDef {"type":"getChatModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"llama-3.3-70b-versatile","value":"llama-3.3-70b-versatile","note":"Meta · 131072 ctx"},{"label":"openai/gpt-oss-120b","value":"openai/gpt-oss-120b","note":"OpenAI · 131072 ctx"}],"cursor":null}
   */
  async getChatModelsDictionary(payload) {
    return this.#modelsDictionary(payload, id => !/whisper|orpheus|tts|playai|prompt-guard/i.test(id))
  }

  /**
   * @typedef {Object} getTranscriptionModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — Groq's model list is not paginated."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Transcription Models Dictionary
   * @description Provides a searchable, live list of Groq speech-to-text (Whisper) models for audio transcription and translation.
   * @route POST /get-transcription-models-dictionary
   * @paramDef {"type":"getTranscriptionModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"whisper-large-v3","value":"whisper-large-v3","note":"OpenAI · 448 ctx"},{"label":"whisper-large-v3-turbo","value":"whisper-large-v3-turbo","note":"OpenAI · 448 ctx"}],"cursor":null}
   */
  async getTranscriptionModelsDictionary(payload) {
    return this.#modelsDictionary(payload, id => /whisper/i.test(id))
  }

  /**
   * @typedef {Object} getTtsModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — Groq's model list is not paginated."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get TTS Models Dictionary
   * @description Provides a searchable, live list of Groq text-to-speech models (Orpheus family) for dynamic parameter selection.
   * @route POST /get-tts-models-dictionary
   * @paramDef {"type":"getTtsModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"canopylabs/orpheus-v1-english","value":"canopylabs/orpheus-v1-english","note":"CanopyLabs"}],"cursor":null}
   */
  async getTtsModelsDictionary(payload) {
    return this.#modelsDictionary(payload, id => /orpheus|tts|playai/i.test(id))
  }

  /**
   * @typedef {Object} getVoicesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Model","name":"model","description":"The text-to-speech model whose voices to list."}
   */

  /**
   * @typedef {Object} getVoicesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter voices by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — the voice list is not paginated."}
   * @paramDef {"type":"getVoicesDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The text-to-speech model whose voices to list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Voices Dictionary
   * @description Provides the list of voices available for the selected Groq text-to-speech model (English or Arabic Orpheus voices).
   * @route POST /get-voices-dictionary
   * @paramDef {"type":"getVoicesDictionary__payload","label":"Payload","name":"payload","description":"Search text and the TTS model criteria whose voices to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Troy (male)","value":"troy","note":"canopylabs/orpheus-v1-english"}],"cursor":null}
   */
  async getVoicesDictionary(payload) {
    const { search, criteria } = payload || {}
    const model = criteria?.model

    let voices = TTS_VOICES[model] || Object.entries(TTS_VOICES)
      .flatMap(([modelId, modelVoices]) => modelVoices.map(voice => ({ ...voice, model: modelId })))

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      voices = voices.filter(voice => voice.label.toLowerCase().includes(searchLower))
    }

    return {
      items: voices.map(voice => ({ label: voice.label, value: voice.value, note: voice.model || model })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getFilesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter files by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — Groq's file list is not paginated."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Files Dictionary
   * @description Provides a searchable, live list of files uploaded to Groq (batch input and result files) for dynamic parameter selection.
   * @route POST /get-files-dictionary
   * @paramDef {"type":"getFilesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering files."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"batch_input.jsonl","value":"file_01jh6x76wtemjr74t1fh0faj5t","note":"batch · 2464 bytes"}],"cursor":null}
   */
  async getFilesDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/files`,
      method: 'get',
      logTag: 'getFilesDictionary',
    })

    let files = response.data || []

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      files = files.filter(file => (file.filename || file.id).toLowerCase().includes(searchLower))
    }

    return {
      items: files.map(file => ({
        label: file.filename || file.id,
        value: file.id,
        note: [file.purpose, file.bytes !== undefined && `${ file.bytes } bytes`].filter(Boolean).join(' · '),
      })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getBatchesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter batches by ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor returned by a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Batches Dictionary
   * @description Provides a searchable, live list of Groq batch jobs for dynamic parameter selection, showing each batch's status and target endpoint.
   * @route POST /get-batches-dictionary
   * @paramDef {"type":"getBatchesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering batches."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"batch_01jh6xa7reempvjyh6n3yst2zw","value":"batch_01jh6xa7reempvjyh6n3yst2zw","note":"completed · /v1/chat/completions"}],"cursor":null}
   */
  async getBatchesDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/batches`,
      method: 'get',
      query: cursor ? { after: cursor } : {},
      logTag: 'getBatchesDictionary',
    })

    let batches = response.data || []

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      batches = batches.filter(batch => batch.id.toLowerCase().includes(searchLower))
    }

    return {
      items: batches.map(batch => ({
        label: batch.id,
        value: batch.id,
        note: [batch.status, batch.endpoint].filter(Boolean).join(' · '),
      })),
      cursor: response.has_more ? batches[batches.length - 1]?.id : null,
    }
  }

  /**
   * @operationName Chat Completion
   * @description Generates a text response for a single prompt using a Groq-hosted model (Llama, GPT-OSS, Qwen, Compound and more) with industry-leading inference speed. Supports an optional system prompt, JSON mode for structured output, and reasoning controls for reasoning-capable models. Returns the generated text, extracted reasoning (when available), finish reason and token usage.
   * @category Chat
   * @route POST /chat-completion
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The user message to send to the model."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getChatModelsDictionary","defaultValue":"llama-3.3-70b-versatile","description":"The Groq model to use. Defaults to 'llama-3.3-70b-versatile'."}
   * @paramDef {"type":"String","label":"System Prompt","name":"systemPrompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional system instructions that set the model's behavior, tone and constraints."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature between 0 and 2. Higher values produce more random output. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Max Completion Tokens","name":"maxCompletionTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens the model may generate for the completion."}
   * @paramDef {"type":"Number","label":"Top P","name":"topP","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Nucleus sampling threshold between 0 and 1. Defaults to 1. Alter this or Temperature, not both."}
   * @paramDef {"type":"Array<String>","label":"Stop Sequences","name":"stop","description":"Up to 4 sequences where the model stops generating further tokens."}
   * @paramDef {"type":"Number","label":"Seed","name":"seed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Seed for best-effort deterministic sampling. Repeated requests with the same seed and parameters should return similar results."}
   * @paramDef {"type":"Boolean","label":"JSON Mode","name":"jsonMode","uiComponent":{"type":"TOGGLE"},"description":"When enabled, forces the model to return valid JSON. Your prompt should explicitly ask for JSON output."}
   * @paramDef {"type":"String","label":"Reasoning Effort","name":"reasoningEffort","uiComponent":{"type":"DROPDOWN","options":{"values":["None","Default","Low","Medium","High"]}},"description":"How much effort a reasoning model spends thinking. 'Low'/'Medium'/'High' apply to GPT-OSS models; 'None'/'Default' apply to Qwen models. Leave empty for non-reasoning models."}
   * @paramDef {"type":"String","label":"Reasoning Format","name":"reasoningFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["Parsed","Raw","Hidden"]}},"description":"How reasoning output is returned by non-GPT-OSS reasoning models (e.g. Qwen): 'Parsed' returns it in a separate field, 'Raw' keeps think tags in the content, 'Hidden' returns only the final answer. Must be 'Parsed' or 'Hidden' when combined with JSON mode."}
   *
   * @returns {Object}
   * @sampleResult {"text":"Fast inference lets AI applications respond in real time.","reasoning":null,"model":"llama-3.3-70b-versatile","finishReason":"stop","usage":{"prompt_tokens":24,"completion_tokens":12,"total_tokens":36}}
   */
  async chatCompletion(prompt, model, systemPrompt, temperature, maxCompletionTokens, topP, stop, seed, jsonMode, reasoningEffort, reasoningFormat) {
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
      'None': 'none', 'Default': 'default', 'Low': 'low', 'Medium': 'medium', 'High': 'high',
    })
    const resolvedFormat = this.#resolveChoice(reasoningFormat, {
      'Parsed': 'parsed', 'Raw': 'raw', 'Hidden': 'hidden',
    })

    if (resolvedEffort) body.reasoning_effort = resolvedEffort
    if (resolvedFormat) body.reasoning_format = resolvedFormat

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
      finishReason: choice?.finish_reason ?? null,
      usage: response.usage ?? null,
    }
  }

  /**
   * @operationName Chat Completion (Advanced)
   * @description Sends a fully custom chat completion request to Groq with a complete messages array (multi-turn conversations, multimodal content parts), tool/function calling passthrough, structured outputs via a response format object (json_object or json_schema), reasoning controls, penalties and sampling parameters. Returns the raw Groq API response including choices, tool calls and usage.
   * @category Chat
   * @route POST /chat-completion-advanced
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Array<Object>","label":"Messages","name":"messages","required":true,"description":"Conversation messages in Groq/OpenAI format, e.g. [{\"role\":\"system\",\"content\":\"...\"},{\"role\":\"user\",\"content\":\"...\"}]. Content may also be an array of content parts (text, image_url) for multimodal models."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getChatModelsDictionary","defaultValue":"llama-3.3-70b-versatile","description":"The Groq model to use. Defaults to 'llama-3.3-70b-versatile'."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature between 0 and 2. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Max Completion Tokens","name":"maxCompletionTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens the model may generate for the completion."}
   * @paramDef {"type":"Number","label":"Top P","name":"topP","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Nucleus sampling threshold between 0 and 1. Defaults to 1."}
   * @paramDef {"type":"Array<String>","label":"Stop Sequences","name":"stop","description":"Up to 4 sequences where the model stops generating further tokens."}
   * @paramDef {"type":"Number","label":"Seed","name":"seed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Seed for best-effort deterministic sampling."}
   * @paramDef {"type":"Object","label":"Response Format","name":"responseFormat","description":"Structured output specification, e.g. {\"type\":\"json_object\"} or {\"type\":\"json_schema\",\"json_schema\":{\"name\":\"result\",\"schema\":{...}}}."}
   * @paramDef {"type":"Array<Object>","label":"Tools","name":"tools","description":"Tool definitions the model may call, in OpenAI function-calling format: [{\"type\":\"function\",\"function\":{\"name\":\"...\",\"description\":\"...\",\"parameters\":{...}}}]."}
   * @paramDef {"type":"String","label":"Tool Choice","name":"toolChoice","description":"Controls tool usage: 'none', 'auto', 'required', or a JSON string selecting a specific function, e.g. {\"type\":\"function\",\"function\":{\"name\":\"my_tool\"}}."}
   * @paramDef {"type":"String","label":"Reasoning Effort","name":"reasoningEffort","uiComponent":{"type":"DROPDOWN","options":{"values":["None","Default","Low","Medium","High"]}},"description":"How much effort a reasoning model spends thinking. 'Low'/'Medium'/'High' apply to GPT-OSS models; 'None'/'Default' apply to Qwen models."}
   * @paramDef {"type":"String","label":"Reasoning Format","name":"reasoningFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["Parsed","Raw","Hidden"]}},"description":"How reasoning output is returned by non-GPT-OSS reasoning models. Cannot be combined with Include Reasoning."}
   * @paramDef {"type":"Boolean","label":"Include Reasoning","name":"includeReasoning","uiComponent":{"type":"TOGGLE"},"description":"GPT-OSS models only: whether to include the model's reasoning in the response. Cannot be combined with Reasoning Format."}
   * @paramDef {"type":"Number","label":"Frequency Penalty","name":"frequencyPenalty","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number between -2.0 and 2.0. Positive values penalize repeated tokens, reducing verbatim repetition."}
   * @paramDef {"type":"Number","label":"Presence Penalty","name":"presencePenalty","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number between -2.0 and 2.0. Positive values encourage the model to talk about new topics."}
   *
   * @returns {Object}
   * @sampleResult {"id":"chatcmpl-8302f6dc","object":"chat.completion","created":1752345600,"model":"llama-3.3-70b-versatile","choices":[{"index":0,"message":{"role":"assistant","content":"Hello! How can I help you today?"},"finish_reason":"stop"}],"usage":{"prompt_tokens":18,"completion_tokens":10,"total_tokens":28}}
   */
  async chatCompletionAdvanced(messages, model, temperature, maxCompletionTokens, topP, stop, seed, responseFormat, tools, toolChoice, reasoningEffort, reasoningFormat, includeReasoning, frequencyPenalty, presencePenalty) {
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
    if (frequencyPenalty !== undefined && frequencyPenalty !== null) body.frequency_penalty = frequencyPenalty
    if (presencePenalty !== undefined && presencePenalty !== null) body.presence_penalty = presencePenalty

    if (toolChoice) {
      body.tool_choice = /^\s*\{/.test(toolChoice) ? JSON.parse(toolChoice) : toolChoice
    }

    const resolvedEffort = this.#resolveChoice(reasoningEffort, {
      'None': 'none', 'Default': 'default', 'Low': 'low', 'Medium': 'medium', 'High': 'high',
    })
    const resolvedFormat = this.#resolveChoice(reasoningFormat, {
      'Parsed': 'parsed', 'Raw': 'raw', 'Hidden': 'hidden',
    })

    if (resolvedEffort) body.reasoning_effort = resolvedEffort
    if (resolvedFormat) body.reasoning_format = resolvedFormat
    if (includeReasoning !== undefined && includeReasoning !== null) body.include_reasoning = includeReasoning

    return this.#apiRequest({
      url: `${ API_BASE_URL }/chat/completions`,
      body,
      logTag: 'chatCompletionAdvanced',
    })
  }

  /**
   * @operationName Analyze Image
   * @description Analyzes up to 5 images with a Groq multimodal vision model (e.g. Llama 4 Scout) and answers a prompt about them — describe content, extract text, compare images or answer visual questions. Accepts public image URLs or base64 data URLs (max 20MB per URL image, 4MB per base64 image). Supports JSON mode for structured extraction.
   * @category Vision
   * @route POST /analyze-image
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The question or instruction about the image(s), e.g. 'Describe this image' or 'Extract all visible text'."}
   * @paramDef {"type":"Array<String>","label":"Image URLs","name":"imageUrls","required":true,"description":"Up to 5 image URLs. Each may be a public 'https://' URL (max 20MB) or a base64 data URL like 'data:image/jpeg;base64,...' (max 4MB)."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getChatModelsDictionary","defaultValue":"meta-llama/llama-4-scout-17b-16e-instruct","description":"The multimodal vision model to use. Defaults to 'meta-llama/llama-4-scout-17b-16e-instruct'."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature between 0 and 2. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Max Completion Tokens","name":"maxCompletionTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens the model may generate for the answer."}
   * @paramDef {"type":"Boolean","label":"JSON Mode","name":"jsonMode","uiComponent":{"type":"TOGGLE"},"description":"When enabled, forces the model to return valid JSON. Your prompt should explicitly ask for JSON output."}
   *
   * @returns {Object}
   * @sampleResult {"text":"The image shows a golden retriever sitting in a park on a sunny day.","model":"meta-llama/llama-4-scout-17b-16e-instruct","finishReason":"stop","usage":{"prompt_tokens":870,"completion_tokens":18,"total_tokens":888}}
   */
  async analyzeImage(prompt, imageUrls, model, temperature, maxCompletionTokens, jsonMode) {
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    if (!imageUrls?.length) {
      throw new Error('At least one image URL is required')
    }

    if (imageUrls.length > MAX_VISION_IMAGES) {
      throw new Error(`A maximum of ${ MAX_VISION_IMAGES } images per request is supported`)
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
      finishReason: choice?.finish_reason ?? null,
      usage: response.usage ?? null,
    }
  }

  /**
   * @operationName Transcribe Audio
   * @description Transcribes an audio file into text in its original language using Groq's ultra-fast Whisper models. Downloads the audio from the provided URL (FlowRunner file URL or any public URL; flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm). Supports plain text, JSON and verbose JSON output with optional word/segment timestamps.
   * @category Audio
   * @route POST /transcribe-audio
   *
   * @executionTimeoutInSeconds 180
   *
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"description":"URL of the audio file to transcribe — a FlowRunner file URL or any public 'http(s)://' URL."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getTranscriptionModelsDictionary","defaultValue":"whisper-large-v3-turbo","description":"The Whisper model to use. Defaults to 'whisper-large-v3-turbo' (fastest); use 'whisper-large-v3' for maximum accuracy."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Optional ISO-639-1 language code of the audio (e.g. 'en', 'de'). Improves accuracy and latency if known in advance."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional text to guide the model's style or spell out uncommon words, names and acronyms expected in the audio."}
   * @paramDef {"type":"String","label":"Response Format","name":"responseFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["JSON","Text","Verbose JSON"]}},"defaultValue":"JSON","description":"Output format: 'JSON' returns {text}, 'Text' returns plain text, 'Verbose JSON' adds duration, language and segments."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature between 0 and 1. Defaults to 0 for deterministic output."}
   * @paramDef {"type":"Array<String>","label":"Timestamp Granularities","name":"timestampGranularities","uiComponent":{"type":"DROPDOWN","options":{"values":["Word","Segment"]}},"description":"Timestamp detail levels to include. Selecting any value automatically switches the response format to 'Verbose JSON'."}
   *
   * @returns {Object}
   * @sampleResult {"text":"Welcome everyone to the quarterly business review. Today we'll discuss our growth strategy."}
   */
  async transcribeAudio(fileUrl, model, language, prompt, responseFormat, temperature, timestampGranularities) {
    return this.#speechToText({
      endpoint: 'transcriptions',
      defaultModel: DEFAULT_TRANSCRIPTION_MODEL,
      fileUrl, model, language, prompt, responseFormat, temperature, timestampGranularities,
      logTag: 'transcribeAudio',
    })
  }

  /**
   * @operationName Translate Audio
   * @description Translates speech from an audio file in any supported language into English text using Groq's Whisper models. Downloads the audio from the provided URL (FlowRunner file URL or any public URL; flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm). Supports plain text, JSON and verbose JSON output.
   * @category Audio
   * @route POST /translate-audio
   *
   * @executionTimeoutInSeconds 180
   *
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"description":"URL of the audio file to translate — a FlowRunner file URL or any public 'http(s)://' URL."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getTranscriptionModelsDictionary","defaultValue":"whisper-large-v3","description":"The Whisper model to use. Defaults to 'whisper-large-v3' (translation is not supported by 'whisper-large-v3-turbo')."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional English text to guide the model's style or spell out uncommon words, names and acronyms expected in the audio."}
   * @paramDef {"type":"String","label":"Response Format","name":"responseFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["JSON","Text","Verbose JSON"]}},"defaultValue":"JSON","description":"Output format: 'JSON' returns {text}, 'Text' returns plain text, 'Verbose JSON' adds duration, language and segments."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature between 0 and 1. Defaults to 0 for deterministic output."}
   *
   * @returns {Object}
   * @sampleResult {"text":"Hello everyone, thank you for joining today's meeting about our expansion plans."}
   */
  async translateAudio(fileUrl, model, prompt, responseFormat, temperature) {
    return this.#speechToText({
      endpoint: 'translations',
      defaultModel: DEFAULT_TRANSLATION_MODEL,
      fileUrl, model, prompt, responseFormat, temperature,
      logTag: 'translateAudio',
    })
  }

  async #speechToText({ endpoint, defaultModel, fileUrl, model, language, prompt, responseFormat, temperature, timestampGranularities, logTag }) {
    const fileBuffer = await this.#downloadFile(fileUrl, logTag)

    const granularities = (timestampGranularities || [])
      .map(value => this.#resolveChoice(value, { 'Word': 'word', 'Segment': 'segment' }))
      .filter(Boolean)

    let resolvedFormat = this.#resolveChoice(responseFormat, {
      'JSON': 'json', 'Text': 'text', 'Verbose JSON': 'verbose_json',
    }) || 'json'

    if (granularities.length) {
      resolvedFormat = 'verbose_json'
    }

    const form = new Flowrunner.Request.FormData()

    form.append('file', fileBuffer, { filename: this.#extractFileName(fileUrl, 'audio') })
    form.append('model', model || defaultModel)
    form.append('response_format', resolvedFormat)

    if (temperature !== undefined && temperature !== null) form.append('temperature', String(temperature))
    if (language) form.append('language', language)
    if (prompt) form.append('prompt', prompt)

    for (const granularity of granularities) {
      form.append('timestamp_granularities[]', granularity)
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/audio/${ endpoint }`,
      form,
      logTag,
    })

    return typeof response === 'string' ? { text: response } : response
  }

  /**
   * @operationName Text to Speech
   * @description Converts text into natural-sounding speech audio using Groq's Orpheus text-to-speech models (English and Arabic voices). The English model supports expressive vocal directions via bracketed tags in the input, e.g. '[cheerful]' or '[whisper]'. Saves the generated audio to FlowRunner file storage and returns its URL.
   * @category Audio
   * @route POST /text-to-speech
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Input Text","name":"input","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text to convert to speech. The English Orpheus model supports bracketed vocal directions like '[cheerful]' or '[dramatic]'."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getTtsModelsDictionary","defaultValue":"canopylabs/orpheus-v1-english","description":"The text-to-speech model to use. Defaults to 'canopylabs/orpheus-v1-english'; use 'canopylabs/orpheus-arabic-saudi' for Arabic."}
   * @paramDef {"type":"String","label":"Voice","name":"voice","dictionary":"getVoicesDictionary","dependsOn":["model"],"defaultValue":"troy","description":"The voice to use. Choose a model above to pick from its voices. Defaults to 'troy'."}
   * @paramDef {"type":"String","label":"Response Format","name":"responseFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["WAV","MP3","FLAC","OGG","MULAW"]}},"defaultValue":"WAV","description":"The audio file format of the output. Defaults to 'WAV'."}
   * @paramDef {"type":"Number","label":"Sample Rate","name":"sampleRate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Output sample rate in Hz. Supported values: 8000, 16000, 22050, 24000, 32000, 44100, 48000. Defaults to 48000."}
   * @paramDef {"type":"Number","label":"Speed","name":"speed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Speed of the generated audio, between 0.5 and 5. Defaults to 1."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   *
   * @returns {Object}
   * @sampleResult {"fileURL":"https://example.com/files/automation/tmp/tts_1752345600000.wav"}
   */
  async textToSpeech(input, model, voice, responseFormat, sampleRate, speed, fileOptions) {
    if (!input || !input.trim()) {
      throw new Error('Input text is required')
    }

    const resolvedFormat = this.#resolveChoice(responseFormat, {
      'WAV': 'wav', 'MP3': 'mp3', 'FLAC': 'flac', 'OGG': 'ogg', 'MULAW': 'mulaw',
    }) || DEFAULT_TTS_RESPONSE_FORMAT

    const body = {
      model: model || DEFAULT_TTS_MODEL,
      input,
      voice: voice || DEFAULT_TTS_VOICE,
      response_format: resolvedFormat,
    }

    if (sampleRate) body.sample_rate = sampleRate
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
   * @operationName Upload File
   * @description Uploads a JSONL file to Groq for batch processing. Provide either the URL of an existing JSONL file (FlowRunner file URL or any public URL) or raw JSONL content as text. Batch input files support up to 50,000 lines and 200MB. Returns the created file object with its ID for use in Create Batch.
   * @category Files
   * @route POST /upload-file
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","description":"URL of the JSONL file to upload — a FlowRunner file URL or any public 'http(s)://' URL. Provide this or JSONL Content."}
   * @paramDef {"type":"String","label":"JSONL Content","name":"jsonlContent","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Raw JSONL content to upload, one batch request object per line. Provide this or File URL."}
   * @paramDef {"type":"String","label":"Filename","name":"filename","description":"Optional filename to store the upload under. Defaults to the name from the URL or a generated 'batch_<timestamp>.jsonl'."}
   *
   * @returns {Object}
   * @sampleResult {"id":"file_01jh6x76wtemjr74t1fh0faj5t","object":"file","bytes":2464,"created_at":1752345600,"filename":"batch_input.jsonl","purpose":"batch"}
   */
  async uploadFile(fileUrl, jsonlContent, filename) {
    let fileBuffer
    let resolvedFilename = filename

    if (fileUrl) {
      fileBuffer = await this.#downloadFile(fileUrl, 'uploadFile')
      resolvedFilename = resolvedFilename || this.#extractFileName(fileUrl, `batch_${ Date.now() }.jsonl`)
    } else if (jsonlContent && jsonlContent.trim()) {
      fileBuffer = Buffer.from(jsonlContent, 'utf8')
      resolvedFilename = resolvedFilename || `batch_${ Date.now() }.jsonl`
    } else {
      throw new Error('Either File URL or JSONL Content is required')
    }

    const form = new Flowrunner.Request.FormData()

    form.append('file', fileBuffer, { filename: resolvedFilename })
    form.append('purpose', 'batch')

    return this.#apiRequest({
      url: `${ API_BASE_URL }/files`,
      form,
      logTag: 'uploadFile',
    })
  }

  /**
   * @operationName List Files
   * @description Lists all files uploaded to Groq, including batch input files and generated batch output/error files, with their IDs, names, sizes and purposes.
   * @category Files
   * @route GET /list-files
   *
   * @returns {Object}
   * @sampleResult {"object":"list","data":[{"id":"file_01jh6x76wtemjr74t1fh0faj5t","object":"file","bytes":2464,"created_at":1752345600,"filename":"batch_input.jsonl","purpose":"batch"}]}
   */
  async listFiles() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/files`,
      method: 'get',
      logTag: 'listFiles',
    })
  }

  /**
   * @operationName Get File
   * @description Retrieves the metadata of a file stored in Groq by its ID, including filename, size, purpose and creation time.
   * @category Files
   * @route GET /get-file
   *
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The file to fetch. Pick from the list or paste a file ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":"file_01jh6x76wtemjr74t1fh0faj5t","object":"file","bytes":2464,"created_at":1752345600,"filename":"batch_input.jsonl","purpose":"batch"}
   */
  async getFile(fileId) {
    if (!fileId) {
      throw new Error('File ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/files/${ encodeURIComponent(fileId) }`,
      method: 'get',
      logTag: 'getFile',
    })
  }

  /**
   * @operationName Delete File
   * @description Permanently deletes a file stored in Groq by its ID. Returns a deletion confirmation object.
   * @category Files
   * @route DELETE /delete-file
   *
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The file to delete. Pick from the list or paste a file ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":"file_01jh6x76wtemjr74t1fh0faj5t","object":"file","deleted":true}
   */
  async deleteFile(fileId) {
    if (!fileId) {
      throw new Error('File ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/files/${ encodeURIComponent(fileId) }`,
      method: 'delete',
      logTag: 'deleteFile',
    })
  }

  /**
   * @operationName Download File Content
   * @description Downloads the content of a file stored in Groq (typically JSONL batch results from a batch's output_file_id or error_file_id), saves it to FlowRunner file storage and returns its URL. Optionally also returns the raw JSONL text for direct parsing in the flow.
   * @category Files
   * @route POST /download-file-content
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The file whose content to download. Pick from the list or paste a file ID (e.g. a batch's output_file_id)."}
   * @paramDef {"type":"Boolean","label":"Include Content","name":"includeContent","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the raw file text is also returned in the 'content' property. Avoid for very large result files."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   *
   * @returns {Object}
   * @sampleResult {"fileURL":"https://example.com/files/automation/tmp/batch_results.jsonl","filename":"batch_results.jsonl","content":null}
   */
  async downloadFileContent(fileId, includeContent, fileOptions) {
    if (!fileId) {
      throw new Error('File ID is required')
    }

    const contentBytes = await this.#apiRequest({
      url: `${ API_BASE_URL }/files/${ encodeURIComponent(fileId) }/content`,
      method: 'get',
      binary: true,
      logTag: 'downloadFileContent',
    })

    const buffer = Buffer.isBuffer(contentBytes) ? contentBytes : Buffer.from(contentBytes)

    let filename = `groq_file_${ Date.now() }.jsonl`

    try {
      const metadata = await this.getFile(fileId)

      if (metadata?.filename) {
        filename = metadata.filename
      }
    } catch (error) {
      logger.warn(`downloadFileContent - could not resolve filename, using '${ filename }'`)
    }

    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return {
      fileURL: url,
      filename,
      content: includeContent ? buffer.toString('utf8') : null,
    }
  }

  /**
   * @operationName Create Batch
   * @description Creates an asynchronous batch job that processes a previously uploaded JSONL file of API requests at a 50% cost discount. Supports chat completions (including vision), audio transcriptions and audio translations. The batch completes within the chosen completion window; poll it with Get Batch and download results with Download File Content.
   * @category Batches
   * @route POST /create-batch
   *
   * @paramDef {"type":"String","label":"Input File","name":"inputFileId","required":true,"dictionary":"getFilesDictionary","description":"The uploaded JSONL input file containing the batch requests. Pick from the list or paste a file ID."}
   * @paramDef {"type":"String","label":"Endpoint","name":"endpoint","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Chat Completions","Audio Transcriptions","Audio Translations"]}},"defaultValue":"Chat Completions","description":"The API endpoint every request in the batch targets."}
   * @paramDef {"type":"String","label":"Completion Window","name":"completionWindow","uiComponent":{"type":"DROPDOWN","options":{"values":["24 Hours","48 Hours","72 Hours","7 Days"]}},"defaultValue":"24 Hours","description":"Time window in which the batch must complete. Longer windows improve completion odds during heavy load. Defaults to 24 hours."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","description":"Optional custom key-value metadata to attach to the batch, e.g. {\"job\":\"nightly-summaries\"}."}
   *
   * @returns {Object}
   * @sampleResult {"id":"batch_01jh6xa7reempvjyh6n3yst2zw","object":"batch","endpoint":"/v1/chat/completions","input_file_id":"file_01jh6x76wtemjr74t1fh0faj5t","completion_window":"24h","status":"validating","created_at":1752345600,"request_counts":{"total":0,"completed":0,"failed":0}}
   */
  async createBatch(inputFileId, endpoint, completionWindow, metadata) {
    if (!inputFileId) {
      throw new Error('Input file ID is required')
    }

    const body = {
      input_file_id: inputFileId,
      endpoint: this.#resolveChoice(endpoint, {
        'Chat Completions': '/v1/chat/completions',
        'Audio Transcriptions': '/v1/audio/transcriptions',
        'Audio Translations': '/v1/audio/translations',
      }) || '/v1/chat/completions',
      completion_window: this.#resolveChoice(completionWindow, {
        '24 Hours': '24h', '48 Hours': '48h', '72 Hours': '72h', '7 Days': '7d',
      }) || '24h',
    }

    if (metadata && Object.keys(metadata).length) {
      body.metadata = metadata
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/batches`,
      body,
      logTag: 'createBatch',
    })
  }

  /**
   * @operationName Get Batch
   * @description Retrieves the current state of a batch job by its ID, including status (validating, in_progress, finalizing, completed, failed, expired, cancelled), request counts, and the output_file_id / error_file_id for downloading results once finished.
   * @category Batches
   * @route GET /get-batch
   *
   * @paramDef {"type":"String","label":"Batch","name":"batchId","required":true,"dictionary":"getBatchesDictionary","description":"The batch to fetch. Pick from the list or paste a batch ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":"batch_01jh6xa7reempvjyh6n3yst2zw","object":"batch","endpoint":"/v1/chat/completions","status":"completed","output_file_id":"file_01jh6xa9foempge5se4cq2cmss","error_file_id":null,"created_at":1752345600,"completed_at":1752349200,"request_counts":{"total":3,"completed":3,"failed":0}}
   */
  async getBatch(batchId) {
    if (!batchId) {
      throw new Error('Batch ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/batches/${ encodeURIComponent(batchId) }`,
      method: 'get',
      logTag: 'getBatch',
    })
  }

  /**
   * @operationName List Batches
   * @description Lists batch jobs in the Groq account with their statuses, endpoints and request counts. Supports pagination via the limit and after parameters.
   * @category Batches
   * @route GET /list-batches
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of batches to return, between 1 and 100. Defaults to 20."}
   * @paramDef {"type":"String","label":"After","name":"after","description":"Pagination cursor — a batch ID; results after this batch are returned."}
   *
   * @returns {Object}
   * @sampleResult {"object":"list","data":[{"id":"batch_01jh6xa7reempvjyh6n3yst2zw","object":"batch","endpoint":"/v1/chat/completions","status":"completed","created_at":1752345600,"request_counts":{"total":3,"completed":3,"failed":0}}],"has_more":false}
   */
  async listBatches(limit, after) {
    const query = {}

    if (limit) query.limit = limit
    if (after) query.after = after

    return this.#apiRequest({
      url: `${ API_BASE_URL }/batches`,
      method: 'get',
      query,
      logTag: 'listBatches',
    })
  }

  /**
   * @operationName Cancel Batch
   * @description Cancels an in-progress batch job by its ID. The batch moves to 'cancelling' and then 'cancelled'; any completed requests are still available in the output file.
   * @category Batches
   * @route POST /cancel-batch
   *
   * @paramDef {"type":"String","label":"Batch","name":"batchId","required":true,"dictionary":"getBatchesDictionary","description":"The batch to cancel. Pick from the list or paste a batch ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":"batch_01jh6xa7reempvjyh6n3yst2zw","object":"batch","endpoint":"/v1/chat/completions","status":"cancelling","created_at":1752345600,"request_counts":{"total":3,"completed":1,"failed":0}}
   */
  async cancelBatch(batchId) {
    if (!batchId) {
      throw new Error('Batch ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/batches/${ encodeURIComponent(batchId) }/cancel`,
      body: {},
      logTag: 'cancelBatch',
    })
  }

  /**
   * @operationName List Models
   * @description Lists all currently active models available through the Groq API, including chat, vision, reasoning, speech-to-text, text-to-speech, guard and agentic models, with their owners and context window sizes.
   * @category Models
   * @route GET /list-models
   *
   * @returns {Object}
   * @sampleResult {"object":"list","data":[{"id":"llama-3.3-70b-versatile","object":"model","created":1733447754,"owned_by":"Meta","active":true,"context_window":131072}]}
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
   * @description Retrieves the details of a specific Groq model by its ID, including owner, active status and context window size.
   * @category Models
   * @route GET /get-model
   *
   * @paramDef {"type":"String","label":"Model","name":"modelId","required":true,"dictionary":"getModelsDictionary","description":"The model to fetch. Pick from the list or paste a model ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":"llama-3.3-70b-versatile","object":"model","created":1733447754,"owned_by":"Meta","active":true,"context_window":131072}
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
}

Flowrunner.ServerCode.addService(GroqService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Groq API key from https://console.groq.com/keys',
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
