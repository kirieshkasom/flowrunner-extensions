'use strict'

const API_BASE_URL = 'https://api.cohere.com'

const DEFAULT_CHAT_MODEL = 'command-a-plus-05-2026'
const DEFAULT_EMBED_MODEL = 'embed-v4.0'
const DEFAULT_RERANK_MODEL = 'rerank-v4.0-pro'
const DEFAULT_TRANSCRIBE_MODEL = 'cohere-transcribe-03-2026'

const logger = {
  info: (...args) => console.log('[Cohere] info:', ...args),
  debug: (...args) => console.log('[Cohere] debug:', ...args),
  error: (...args) => console.log('[Cohere] error:', ...args),
  warn: (...args) => console.log('[Cohere] warn:', ...args),
}

/**
 * @integrationName Cohere
 * @integrationIcon /icon.png
 */
class CohereService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  async #apiRequest({ url, method = 'post', body, form, query, logTag }) {
    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }]`)

      const request = Flowrunner.Request[method](url)
        .query(query || {})
        .set({ 'Authorization': `Bearer ${ this.apiKey }` })

      if (form) {
        request.form(form)

        return await request
      }

      if (body !== undefined) {
        request.set({ 'Content-Type': 'application/json' })

        return await request.send(body)
      }

      return await request
    } catch (error) {
      const message = error.body?.message || error.body?.data?.message || error.message || 'API request failed'

      logger.error(`${ logTag } - error: ${ typeof message === 'object' ? JSON.stringify(message) : message }`)

      throw new Error(`Cohere API error: ${ typeof message === 'object' ? JSON.stringify(message) : message }`)
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

  #extractMessageContent(message) {
    const blocks = message?.content || []

    const text = blocks.filter(block => block.type === 'text').map(block => block.text).join('')
    const thinking = blocks.filter(block => block.type === 'thinking').map(block => block.thinking).join('')

    return { text, thinking: thinking || null }
  }

  async #modelsDictionary(payload, endpoint) {
    const { search, cursor } = payload || {}

    const query = { page_size: 100 }

    if (endpoint) query.endpoint = endpoint
    if (cursor) query.page_token = cursor

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/models`,
      method: 'get',
      query,
      logTag: 'modelsDictionary',
    })

    let models = (response.models || []).filter(model => !model.is_deprecated)

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      models = models.filter(model => model.name.toLowerCase().includes(searchLower))
    }

    return {
      items: models
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(model => ({
          label: model.name,
          value: model.name,
          note: [
            (model.endpoints || []).join(', '),
            model.context_length && `${ model.context_length } ctx`,
          ].filter(Boolean).join(' · '),
        })),
      cursor: response.next_page_token || null,
    }
  }

  /**
   * @typedef {Object} getModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor returned by a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Models Dictionary
   * @description Provides a searchable, live list of all non-deprecated Cohere models across every endpoint (chat, embed, rerank, classify) for dynamic parameter selection.
   * @route POST /get-models-dictionary
   * @paramDef {"type":"getModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"command-a-plus-05-2026","value":"command-a-plus-05-2026","note":"chat · 128000 ctx"}],"cursor":null}
   */
  async getModelsDictionary(payload) {
    return this.#modelsDictionary(payload, undefined)
  }

  /**
   * @typedef {Object} getChatModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor returned by a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Chat Models Dictionary
   * @description Provides a searchable, live list of Cohere models compatible with the Chat endpoint (Command family, Aya models) for dynamic parameter selection.
   * @route POST /get-chat-models-dictionary
   * @paramDef {"type":"getChatModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"command-a-plus-05-2026","value":"command-a-plus-05-2026","note":"chat · 128000 ctx"},{"label":"command-a-03-2025","value":"command-a-03-2025","note":"chat · 256000 ctx"}],"cursor":null}
   */
  async getChatModelsDictionary(payload) {
    return this.#modelsDictionary(payload, 'chat')
  }

  /**
   * @typedef {Object} getEmbedModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor returned by a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Embed Models Dictionary
   * @description Provides a searchable, live list of Cohere models compatible with the Embed endpoint (Embed v4.0, Embed v3 English/multilingual) for dynamic parameter selection.
   * @route POST /get-embed-models-dictionary
   * @paramDef {"type":"getEmbedModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"embed-v4.0","value":"embed-v4.0","note":"embed · 128000 ctx"}],"cursor":null}
   */
  async getEmbedModelsDictionary(payload) {
    return this.#modelsDictionary(payload, 'embed')
  }

  /**
   * @typedef {Object} getRerankModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor returned by a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Rerank Models Dictionary
   * @description Provides a searchable, live list of Cohere models compatible with the Rerank endpoint (Rerank v4.0 Pro/Fast, Rerank v3.5) for dynamic parameter selection.
   * @route POST /get-rerank-models-dictionary
   * @paramDef {"type":"getRerankModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"rerank-v4.0-pro","value":"rerank-v4.0-pro","note":"rerank · 32000 ctx"}],"cursor":null}
   */
  async getRerankModelsDictionary(payload) {
    return this.#modelsDictionary(payload, 'rerank')
  }

  /**
   * @typedef {Object} getClassifyModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor returned by a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Classify Models Dictionary
   * @description Provides a searchable, live list of Cohere models compatible with the Classify endpoint, including fine-tuned classification models in your account.
   * @route POST /get-classify-models-dictionary
   * @paramDef {"type":"getClassifyModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"embed-multilingual-v3.0","value":"embed-multilingual-v3.0","note":"classify, embed · 512 ctx"}],"cursor":null}
   */
  async getClassifyModelsDictionary(payload) {
    return this.#modelsDictionary(payload, 'classify')
  }

  /**
   * @typedef {Object} getDatasetsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter datasets by name or ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — the dataset list is returned in one page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Datasets Dictionary
   * @description Provides a searchable, live list of datasets in the Cohere account (embed inputs, batch inputs and generated results) with their types and validation statuses, for dynamic parameter selection.
   * @route POST /get-datasets-dictionary
   * @paramDef {"type":"getDatasetsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering datasets."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"support-tickets","value":"dataset_xkjd93kl","note":"batch-chat-v2-input · validated"}],"cursor":null}
   */
  async getDatasetsDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/datasets`,
      method: 'get',
      logTag: 'getDatasetsDictionary',
    })

    let datasets = response.datasets || []

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      datasets = datasets.filter(dataset =>
        (dataset.name || '').toLowerCase().includes(searchLower) || dataset.id.toLowerCase().includes(searchLower))
    }

    return {
      items: datasets.map(dataset => ({
        label: dataset.name || dataset.id,
        value: dataset.id,
        note: [dataset.dataset_type, dataset.validation_status].filter(Boolean).join(' · '),
      })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getBatchesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter batches by name or ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor returned by a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Batches Dictionary
   * @description Provides a searchable, live list of Cohere batch jobs with their statuses and models, for dynamic parameter selection.
   * @route POST /get-batches-dictionary
   * @paramDef {"type":"getBatchesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering batches."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Nightly summaries","value":"batch_abc123","note":"BATCH_STATUS_COMPLETED · command-a-03-2025"}],"cursor":null}
   */
  async getBatchesDictionary(payload) {
    const { search, cursor } = payload || {}

    const query = { page_size: 100 }

    if (cursor) query.page_token = cursor

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/batches`,
      method: 'get',
      query,
      logTag: 'getBatchesDictionary',
    })

    let batches = response.batches || []

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      batches = batches.filter(batch =>
        (batch.name || '').toLowerCase().includes(searchLower) || (batch.id || '').toLowerCase().includes(searchLower))
    }

    return {
      items: batches.map(batch => ({
        label: batch.name || batch.id,
        value: batch.id,
        note: [batch.status, batch.model].filter(Boolean).join(' · '),
      })),
      cursor: response.next_page_token || null,
    }
  }

  /**
   * @typedef {Object} getEmbedJobsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter embed jobs by name or ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — the embed job list is returned in one page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Embed Jobs Dictionary
   * @description Provides a searchable, live list of Cohere embed jobs with their statuses and models, for dynamic parameter selection.
   * @route POST /get-embed-jobs-dictionary
   * @paramDef {"type":"getEmbedJobsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering embed jobs."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"docs-embeddings","value":"ej_abc123","note":"complete · embed-v4.0"}],"cursor":null}
   */
  async getEmbedJobsDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/embed-jobs`,
      method: 'get',
      logTag: 'getEmbedJobsDictionary',
    })

    let jobs = response.embed_jobs || []

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      jobs = jobs.filter(job =>
        (job.name || '').toLowerCase().includes(searchLower) || (job.job_id || '').toLowerCase().includes(searchLower))
    }

    return {
      items: jobs.map(job => ({
        label: job.name || job.job_id,
        value: job.job_id,
        note: [job.status, job.model].filter(Boolean).join(' · '),
      })),
      cursor: null,
    }
  }

  /**
   * @operationName Chat
   * @description Generates a text response to a single prompt using a Cohere Command model via the v2 Chat API. Supports an optional system prompt, JSON mode for structured output, safety modes, deterministic seeding and reasoning ('thinking') controls for reasoning-capable models such as Command A Plus and Command A Reasoning. Returns the generated text, extracted reasoning (when produced), finish reason and token usage.
   * @category Chat
   * @route POST /chat
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Message","name":"message","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The user message to send to the model."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getChatModelsDictionary","defaultValue":"command-a-plus-05-2026","description":"The Cohere chat model to use. Defaults to 'command-a-plus-05-2026', the flagship Command model."}
   * @paramDef {"type":"String","label":"System Prompt","name":"systemPrompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional system instructions that set the model's behavior, tone and constraints."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Non-negative sampling temperature. Lower values are less random. Defaults to 0.3."}
   * @paramDef {"type":"Number","label":"Max Tokens","name":"maxTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of output tokens the model may generate. Defaults to the model's maximum output limit."}
   * @paramDef {"type":"Number","label":"Top P","name":"topP","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Nucleus sampling threshold between 0.01 and 0.99. Only tokens with total probability mass p are considered. Defaults to 0.75."}
   * @paramDef {"type":"Number","label":"Top K","name":"topK","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Only the top k most likely tokens are considered at each step, between 0 and 500. 0 disables k-sampling (default)."}
   * @paramDef {"type":"Number","label":"Seed","name":"seed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Best-effort deterministic sampling seed. Repeated requests with the same seed and parameters should return the same result."}
   * @paramDef {"type":"Array<String>","label":"Stop Sequences","name":"stopSequences","description":"Up to 5 strings; the model stops generating when it produces any of them."}
   * @paramDef {"type":"Boolean","label":"JSON Mode","name":"jsonMode","uiComponent":{"type":"TOGGLE"},"description":"When enabled, forces the model to return a valid JSON object. Your message should explicitly ask for JSON output."}
   * @paramDef {"type":"String","label":"Safety Mode","name":"safetyMode","uiComponent":{"type":"DROPDOWN","options":{"values":["Contextual","Strict","Off"]}},"description":"Safety instruction inserted into the prompt. Defaults to 'Contextual'. 'Off' omits the safety instruction (not supported by all models)."}
   * @paramDef {"type":"String","label":"Thinking","name":"thinkingMode","uiComponent":{"type":"DROPDOWN","options":{"values":["Enabled","Disabled"]}},"description":"Controls reasoning for reasoning-capable models (Command A Plus, Command A Reasoning). Reasoning is enabled by default on supported models; select 'Disabled' to turn it off. Leave empty for the model default."}
   * @paramDef {"type":"Number","label":"Thinking Token Budget","name":"thinkingTokenBudget","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens the model may spend on reasoning. Only applies when thinking is enabled."}
   *
   * @returns {Object}
   * @sampleResult {"id":"c14c80c3-18eb-4519-9460-6c92edd8cfb4","text":"Large language models are neural networks trained on vast text corpora to generate and understand language.","thinking":null,"finishReason":"COMPLETE","usage":{"billed_units":{"input_tokens":12,"output_tokens":21},"tokens":{"input_tokens":68,"output_tokens":21}}}
   */
  async chat(message, model, systemPrompt, temperature, maxTokens, topP, topK, seed, stopSequences, jsonMode, safetyMode, thinkingMode, thinkingTokenBudget) {
    if (!message || !message.trim()) {
      throw new Error('Message is required')
    }

    const messages = []

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt })
    }

    messages.push({ role: 'user', content: message })

    const body = {
      stream: false,
      model: model || DEFAULT_CHAT_MODEL,
      messages,
    }

    if (temperature !== undefined && temperature !== null) body.temperature = temperature
    if (maxTokens) body.max_tokens = maxTokens
    if (topP !== undefined && topP !== null) body.p = topP
    if (topK !== undefined && topK !== null) body.k = topK
    if (seed !== undefined && seed !== null) body.seed = seed
    if (stopSequences?.length) body.stop_sequences = stopSequences
    if (jsonMode) body.response_format = { type: 'json_object' }

    const resolvedSafetyMode = this.#resolveChoice(safetyMode, {
      'Contextual': 'CONTEXTUAL', 'Strict': 'STRICT', 'Off': 'OFF',
    })

    if (resolvedSafetyMode) body.safety_mode = resolvedSafetyMode

    const resolvedThinking = this.#resolveChoice(thinkingMode, { 'Enabled': 'enabled', 'Disabled': 'disabled' })

    if (resolvedThinking) {
      body.thinking = { type: resolvedThinking }

      if (resolvedThinking === 'enabled' && thinkingTokenBudget) {
        body.thinking.token_budget = thinkingTokenBudget
      }
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/chat`,
      body,
      logTag: 'chat',
    })

    const { text, thinking } = this.#extractMessageContent(response.message)

    return {
      id: response.id,
      text,
      thinking,
      finishReason: response.finish_reason ?? null,
      usage: response.usage ?? null,
    }
  }

  /**
   * @operationName Chat (Advanced)
   * @description Sends a fully custom request to the Cohere v2 Chat API with a complete messages array (multi-turn conversations, multimodal image content for vision models), tool/function calling passthrough with strict tools, grounded documents, structured outputs via a response format object with JSON schema, citation options, safety modes, reasoning ('thinking') configuration, penalties and full sampling controls. Returns the raw Cohere API response including the assistant message content blocks, tool calls, citations and usage.
   * @category Chat
   * @route POST /chat-advanced
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Array<Object>","label":"Messages","name":"messages","required":true,"description":"Conversation messages in Cohere v2 format, e.g. [{\"role\":\"system\",\"content\":\"...\"},{\"role\":\"user\",\"content\":\"...\"}]. Content may also be an array of content blocks (text, image_url) for vision models, and 'assistant'/'tool' messages are supported for multi-turn tool use."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getChatModelsDictionary","defaultValue":"command-a-plus-05-2026","description":"The Cohere chat model to use. Defaults to 'command-a-plus-05-2026'."}
   * @paramDef {"type":"Array<Object>","label":"Tools","name":"tools","description":"Tool definitions the model may call, e.g. [{\"type\":\"function\",\"function\":{\"name\":\"...\",\"description\":\"...\",\"parameters\":{...}}}]. Tool calls are returned in message.tool_calls."}
   * @paramDef {"type":"Boolean","label":"Strict Tools","name":"strictTools","uiComponent":{"type":"TOGGLE"},"description":"When enabled, tool calls are forced to follow the tool parameter definitions strictly (structured outputs for tools)."}
   * @paramDef {"type":"String","label":"Tool Choice","name":"toolChoice","uiComponent":{"type":"DROPDOWN","options":{"values":["Required","None"]}},"description":"'Required' forces the model to call at least one tool; 'None' forbids tool calls. Leave empty to let the model decide. Supported by Command R7B and newer."}
   * @paramDef {"type":"Array<Object>","label":"Documents","name":"documents","description":"Documents the model can ground on and cite, each either a plain string or an object like {\"id\":\"doc_1\",\"data\":{\"title\":\"...\",\"text\":\"...\"}}. For a simpler grounded-answer experience use the 'Chat with Documents' operation."}
   * @paramDef {"type":"Object","label":"Response Format","name":"responseFormat","description":"Structured output specification: {\"type\":\"json_object\"} or {\"type\":\"json_object\",\"json_schema\":{...}} with a JSON schema the output must adhere to. Not supported together with documents or tools."}
   * @paramDef {"type":"String","label":"Citation Mode","name":"citationMode","uiComponent":{"type":"DROPDOWN","options":{"values":["Enabled","Disabled","Fast","Accurate","Off"]}},"description":"Citation generation mode used when documents are provided. Defaults to 'Enabled'. 'Accurate' is higher quality, 'Fast' is lower latency."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Non-negative sampling temperature. Defaults to 0.3."}
   * @paramDef {"type":"Number","label":"Max Tokens","name":"maxTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of output tokens the model may generate."}
   * @paramDef {"type":"Number","label":"Top P","name":"topP","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Nucleus sampling threshold between 0.01 and 0.99. Defaults to 0.75."}
   * @paramDef {"type":"Number","label":"Top K","name":"topK","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Only the top k most likely tokens are considered, between 0 and 500. 0 disables k-sampling (default)."}
   * @paramDef {"type":"Number","label":"Seed","name":"seed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Best-effort deterministic sampling seed."}
   * @paramDef {"type":"Array<String>","label":"Stop Sequences","name":"stopSequences","description":"Up to 5 strings; the model stops generating when it produces any of them."}
   * @paramDef {"type":"Number","label":"Frequency Penalty","name":"frequencyPenalty","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Between 0.0 and 1.0. Penalizes tokens proportionally to how often they already appeared, reducing repetition."}
   * @paramDef {"type":"Number","label":"Presence Penalty","name":"presencePenalty","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Between 0.0 and 1.0. Penalizes all tokens that already appeared, regardless of frequency."}
   * @paramDef {"type":"String","label":"Safety Mode","name":"safetyMode","uiComponent":{"type":"DROPDOWN","options":{"values":["Contextual","Strict","Off"]}},"description":"Safety instruction inserted into the prompt. Defaults to 'Contextual'. Not configurable in combination with tools or documents."}
   * @paramDef {"type":"Object","label":"Thinking","name":"thinking","description":"Reasoning configuration for reasoning-capable models, e.g. {\"type\":\"enabled\",\"token_budget\":2000} or {\"type\":\"disabled\"}."}
   * @paramDef {"type":"Boolean","label":"Log Probabilities","name":"logprobs","uiComponent":{"type":"TOGGLE"},"description":"When enabled, log probabilities of the generated tokens are included in the response."}
   *
   * @returns {Object}
   * @sampleResult {"id":"c14c80c3-18eb-4519-9460-6c92edd8cfb4","finish_reason":"COMPLETE","message":{"role":"assistant","content":[{"type":"text","text":"Hello! How can I help you today?"}]},"usage":{"billed_units":{"input_tokens":5,"output_tokens":10},"tokens":{"input_tokens":71,"output_tokens":10}}}
   */
  async chatAdvanced(messages, model, tools, strictTools, toolChoice, documents, responseFormat, citationMode, temperature, maxTokens, topP, topK, seed, stopSequences, frequencyPenalty, presencePenalty, safetyMode, thinking, logprobs) {
    if (!messages?.length) {
      throw new Error('Messages array is required and must not be empty')
    }

    const body = {
      stream: false,
      model: model || DEFAULT_CHAT_MODEL,
      messages,
    }

    if (tools?.length) body.tools = tools
    if (strictTools !== undefined && strictTools !== null) body.strict_tools = strictTools
    if (documents?.length) body.documents = documents
    if (responseFormat) body.response_format = responseFormat
    if (temperature !== undefined && temperature !== null) body.temperature = temperature
    if (maxTokens) body.max_tokens = maxTokens
    if (topP !== undefined && topP !== null) body.p = topP
    if (topK !== undefined && topK !== null) body.k = topK
    if (seed !== undefined && seed !== null) body.seed = seed
    if (stopSequences?.length) body.stop_sequences = stopSequences
    if (frequencyPenalty !== undefined && frequencyPenalty !== null) body.frequency_penalty = frequencyPenalty
    if (presencePenalty !== undefined && presencePenalty !== null) body.presence_penalty = presencePenalty
    if (thinking) body.thinking = thinking
    if (logprobs) body.logprobs = true

    const resolvedToolChoice = this.#resolveChoice(toolChoice, { 'Required': 'REQUIRED', 'None': 'NONE' })

    if (resolvedToolChoice) body.tool_choice = resolvedToolChoice

    const resolvedCitationMode = this.#resolveChoice(citationMode, {
      'Enabled': 'ENABLED', 'Disabled': 'DISABLED', 'Fast': 'FAST', 'Accurate': 'ACCURATE', 'Off': 'OFF',
    })

    if (resolvedCitationMode) body.citation_options = { mode: resolvedCitationMode }

    const resolvedSafetyMode = this.#resolveChoice(safetyMode, {
      'Contextual': 'CONTEXTUAL', 'Strict': 'STRICT', 'Off': 'OFF',
    })

    if (resolvedSafetyMode) body.safety_mode = resolvedSafetyMode

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v2/chat`,
      body,
      logTag: 'chatAdvanced',
    })
  }

  /**
   * @operationName Chat with Documents
   * @description Generates a grounded answer to a question using the provided documents as context (Retrieval-Augmented Generation) via the Cohere v2 Chat API — Cohere's signature RAG capability. The model answers strictly from the supplied documents and returns fine-grained citations that map each answer span to the source documents, so every claim is verifiable. Returns the answer text, the citations array (prominently), finish reason and token usage.
   * @category Chat
   * @route POST /chat-with-documents
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Message","name":"message","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The question or instruction to answer using the documents."}
   * @paramDef {"type":"Array<Object>","label":"Documents","name":"documents","required":true,"description":"Documents to ground the answer on. Each item is either a plain string or an object like {\"id\":\"doc_1\",\"data\":{\"title\":\"Q2 Report\",\"text\":\"Revenue grew 25%...\"}}. Custom IDs are echoed back in the citations."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getChatModelsDictionary","defaultValue":"command-a-plus-05-2026","description":"The Cohere chat model to use. Defaults to 'command-a-plus-05-2026'."}
   * @paramDef {"type":"String","label":"Citation Mode","name":"citationMode","uiComponent":{"type":"DROPDOWN","options":{"values":["Enabled","Disabled","Fast","Accurate","Off"]}},"description":"Citation generation mode. Defaults to 'Enabled'. 'Accurate' produces higher-quality citations, 'Fast' reduces latency, 'Off' disables citations."}
   * @paramDef {"type":"String","label":"System Prompt","name":"systemPrompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional system instructions that set the model's behavior when answering from the documents."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Non-negative sampling temperature. Lower values keep answers closer to the documents. Defaults to 0.3."}
   * @paramDef {"type":"Number","label":"Max Tokens","name":"maxTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of output tokens the model may generate."}
   *
   * @returns {Object}
   * @sampleResult {"id":"c14c80c3-18eb-4519-9460-6c92edd8cfb4","text":"Revenue grew 25% in Q2, driven primarily by enterprise subscriptions.","citations":[{"start":8,"end":31,"text":"25% in Q2","sources":[{"type":"document","id":"doc_1","document":{"id":"doc_1","title":"Q2 Report","text":"Revenue grew 25%..."}}]}],"finishReason":"COMPLETE","usage":{"billed_units":{"input_tokens":120,"output_tokens":18},"tokens":{"input_tokens":410,"output_tokens":18}}}
   */
  async chatWithDocuments(message, documents, model, citationMode, systemPrompt, temperature, maxTokens) {
    if (!message || !message.trim()) {
      throw new Error('Message is required')
    }

    if (!documents?.length) {
      throw new Error('At least one document is required')
    }

    const messages = []

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt })
    }

    messages.push({ role: 'user', content: message })

    const body = {
      stream: false,
      model: model || DEFAULT_CHAT_MODEL,
      messages,
      documents,
    }

    if (temperature !== undefined && temperature !== null) body.temperature = temperature
    if (maxTokens) body.max_tokens = maxTokens

    const resolvedCitationMode = this.#resolveChoice(citationMode, {
      'Enabled': 'ENABLED', 'Disabled': 'DISABLED', 'Fast': 'FAST', 'Accurate': 'ACCURATE', 'Off': 'OFF',
    })

    if (resolvedCitationMode) body.citation_options = { mode: resolvedCitationMode }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/chat`,
      body,
      logTag: 'chatWithDocuments',
    })

    const { text } = this.#extractMessageContent(response.message)

    return {
      id: response.id,
      text,
      citations: response.message?.citations || [],
      finishReason: response.finish_reason ?? null,
      usage: response.usage ?? null,
    }
  }

  /**
   * @operationName Create Embeddings
   * @description Generates embeddings for texts and/or images using the Cohere v2 Embed API. Supports Embed v4.0 (multimodal, adjustable 256-1536 output dimensions) and the Embed v3 family, multiple embedding types (float, quantized int8/uint8, binary, base64) and input-type optimization for search, classification or clustering use cases. Up to 96 texts per call; images are passed as base64 data URIs. Returns the embeddings keyed by embedding type, plus billing metadata.
   * @category Embeddings
   * @route POST /create-embeddings
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Array<String>","label":"Texts","name":"texts","description":"Up to 96 texts to embed. Provide texts, images or structured inputs."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getEmbedModelsDictionary","defaultValue":"embed-v4.0","description":"The embedding model to use. Defaults to 'embed-v4.0' (multimodal, 128k context)."}
   * @paramDef {"type":"String","label":"Input Type","name":"inputType","required":true,"defaultValue":"Search Document","uiComponent":{"type":"DROPDOWN","options":{"values":["Search Document","Search Query","Classification","Clustering","Image"]}},"description":"Optimizes embeddings for the intended use: 'Search Document' for vectors stored in a database, 'Search Query' for queries against it, 'Classification' for classifier features, 'Clustering' for clustering, 'Image' for image inputs. Required for v3 and newer models."}
   * @paramDef {"type":"Array<String>","label":"Embedding Types","name":"embeddingTypes","uiComponent":{"type":"DROPDOWN","options":{"values":["Float","Int8","Uint8","Binary","Ubinary","Base64"]}},"description":"The embedding formats to return. Defaults to float embeddings. Quantized types (int8/uint8/binary/ubinary) are valid for v3 and newer models."}
   * @paramDef {"type":"Number","label":"Output Dimension","name":"outputDimension","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of dimensions of the output embedding for models that support it (embed-v4.0: 256, 512, 1024 or 1536)."}
   * @paramDef {"type":"Array<String>","label":"Images","name":"images","description":"Images to embed, each as a base64 data URI (JPEG, PNG, WebP or GIF), e.g. 'data:image/png;base64,...'. Use with Input Type 'Image'."}
   * @paramDef {"type":"Array<Object>","label":"Structured Inputs","name":"inputs","description":"Advanced: mixed text-and-image inputs in Cohere v2 format, e.g. [{\"content\":[{\"type\":\"text\",\"text\":\"...\"},{\"type\":\"image_url\",\"image_url\":{\"url\":\"data:image/png;base64,...\"}}]}]. Use instead of Texts/Images for multimodal documents."}
   * @paramDef {"type":"String","label":"Truncate","name":"truncate","uiComponent":{"type":"DROPDOWN","options":{"values":["None","Start","End"]}},"description":"How to handle inputs longer than the model maximum: 'None' returns an error, 'Start' discards the beginning, 'End' discards the end (default)."}
   * @paramDef {"type":"Number","label":"Max Tokens","name":"maxTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens per input before truncation is applied."}
   *
   * @returns {Object}
   * @sampleResult {"id":"5807ee2e-0cda-445a-9ec8-864c60a06606","embeddings":{"float":[[0.0121,-0.0431,0.0587]]},"texts":["hello world"],"meta":{"api_version":{"version":"2"},"billed_units":{"input_tokens":2}}}
   */
  async createEmbeddings(texts, model, inputType, embeddingTypes, outputDimension, images, inputs, truncate, maxTokens) {
    if (!texts?.length && !images?.length && !inputs?.length) {
      throw new Error('At least one of Texts, Images or Structured Inputs is required')
    }

    const body = {
      model: model || DEFAULT_EMBED_MODEL,
      input_type: this.#resolveChoice(inputType, {
        'Search Document': 'search_document',
        'Search Query': 'search_query',
        'Classification': 'classification',
        'Clustering': 'clustering',
        'Image': 'image',
      }) || 'search_document',
    }

    if (texts?.length) body.texts = texts
    if (images?.length) body.images = images
    if (inputs?.length) body.inputs = inputs
    if (outputDimension) body.output_dimension = outputDimension
    if (maxTokens) body.max_tokens = maxTokens

    const resolvedEmbeddingTypes = (embeddingTypes || [])
      .map(value => this.#resolveChoice(value, {
        'Float': 'float', 'Int8': 'int8', 'Uint8': 'uint8', 'Binary': 'binary', 'Ubinary': 'ubinary', 'Base64': 'base64',
      }))
      .filter(Boolean)

    if (resolvedEmbeddingTypes.length) body.embedding_types = resolvedEmbeddingTypes

    const resolvedTruncate = this.#resolveChoice(truncate, { 'None': 'NONE', 'Start': 'START', 'End': 'END' })

    if (resolvedTruncate) body.truncate = resolvedTruncate

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v2/embed`,
      body,
      logTag: 'createEmbeddings',
    })
  }

  /**
   * @operationName Rerank Documents
   * @description Ranks a list of documents by semantic relevance to a query using the Cohere v2 Rerank API — ideal for improving search quality and RAG retrieval. Returns results ordered by relevance, each with the original index, a normalized relevance score between 0 and 1, and the original document text for convenience. Long documents are automatically truncated to the per-document token limit.
   * @category Rerank
   * @route POST /rerank-documents
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The search query to rank the documents against."}
   * @paramDef {"type":"Array<String>","label":"Documents","name":"documents","required":true,"description":"The document texts to rank."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getRerankModelsDictionary","defaultValue":"rerank-v4.0-pro","description":"The rerank model to use. Defaults to 'rerank-v4.0-pro' (multilingual, 32k context); use 'rerank-v4.0-fast' for lower latency."}
   * @paramDef {"type":"Number","label":"Top N","name":"topN","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of ranked results to return. Omit to return all documents ranked."}
   * @paramDef {"type":"Number","label":"Max Tokens Per Document","name":"maxTokensPerDoc","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Documents longer than this are automatically truncated. Defaults to 4096."}
   *
   * @returns {Object}
   * @sampleResult {"id":"07734bd2-2473-4f07-94e1-0d9f0e6843cf","results":[{"index":2,"relevance_score":0.9812,"document":"Reranking reorders search results by semantic relevance."}],"meta":{"api_version":{"version":"2"},"billed_units":{"search_units":1}}}
   */
  async rerankDocuments(query, documents, model, topN, maxTokensPerDoc) {
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
    if (maxTokensPerDoc) body.max_tokens_per_doc = maxTokensPerDoc

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/rerank`,
      body,
      logTag: 'rerankDocuments',
    })

    return {
      ...response,
      results: (response.results || []).map(result => ({
        ...result,
        document: documents[result.index] ?? null,
      })),
    }
  }

  /**
   * @operationName Classify Text
   * @description Classifies up to 96 texts using the Cohere Classify API, either few-shot with inline labeled examples (at least 2 examples per label recommended) or with a fine-tuned classification model that needs no examples. Returns a prediction, confidence score and per-label confidences for every input. Note: Cohere lists this v1 endpoint under its legacy APIs; it remains fully operational but is no longer actively evolved.
   * @category Classification
   * @route POST /classify-text
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Array<String>","label":"Inputs","name":"inputs","required":true,"description":"Up to 96 texts to classify."}
   * @paramDef {"type":"Array<Object>","label":"Examples","name":"examples","description":"Labeled examples for few-shot classification, e.g. [{\"text\":\"I love it\",\"label\":\"positive\"},{\"text\":\"Terrible\",\"label\":\"negative\"}]. Required unless a fine-tuned classification model is used."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getClassifyModelsDictionary","description":"Optional classification model — typically a fine-tuned Classify model ID. Fine-tuned models do not require examples."}
   * @paramDef {"type":"String","label":"Truncate","name":"truncate","uiComponent":{"type":"DROPDOWN","options":{"values":["None","Start","End"]}},"description":"How to handle inputs longer than the model maximum: 'None' returns an error, 'Start' discards the beginning, 'End' discards the end (default)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"801ec26d-46f7-4b16-9a53-1d8a0c1052c5","classifications":[{"id":"3f9b8f7a","input":"I love this product","prediction":"positive","confidence":0.98,"labels":{"positive":{"confidence":0.98},"negative":{"confidence":0.02}},"classification_type":"single-label"}],"meta":{"api_version":{"version":"1"},"billed_units":{"classifications":1}}}
   */
  async classifyText(inputs, examples, model, truncate) {
    if (!inputs?.length) {
      throw new Error('At least one input text is required')
    }

    if (!examples?.length && !model) {
      throw new Error('Either Examples or a fine-tuned classification Model is required')
    }

    const body = { inputs }

    if (examples?.length) body.examples = examples
    if (model) body.model = model

    const resolvedTruncate = this.#resolveChoice(truncate, { 'None': 'NONE', 'Start': 'START', 'End': 'END' })

    if (resolvedTruncate) body.truncate = resolvedTruncate

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/classify`,
      body,
      logTag: 'classifyText',
    })
  }

  /**
   * @operationName Tokenize Text
   * @description Splits a text (1 to 65,536 characters) into tokens using the tokenizer of the specified Cohere model. Returns the token IDs and the corresponding token strings — useful for counting tokens before a chat or embed call.
   * @category Tokenization
   * @route POST /tokenize-text
   *
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text to tokenize, between 1 and 65,536 characters."}
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getModelsDictionary","defaultValue":"command-a-plus-05-2026","description":"The model whose tokenizer to use. Defaults to 'command-a-plus-05-2026'."}
   *
   * @returns {Object}
   * @sampleResult {"tokens":[8466,5169,2594,8],"token_strings":["token","ize"," me","!"],"meta":{"api_version":{"version":"1"}}}
   */
  async tokenizeText(text, model) {
    if (!text) {
      throw new Error('Text is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/tokenize`,
      body: { text, model: model || DEFAULT_CHAT_MODEL },
      logTag: 'tokenizeText',
    })
  }

  /**
   * @operationName Detokenize Text
   * @description Converts a list of token IDs back into the original text using the tokenizer of the specified Cohere model — the inverse of Tokenize Text.
   * @category Tokenization
   * @route POST /detokenize-text
   *
   * @paramDef {"type":"Array<Number>","label":"Tokens","name":"tokens","required":true,"description":"The list of token IDs to convert back into text."}
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getModelsDictionary","defaultValue":"command-a-plus-05-2026","description":"The model whose tokenizer to use. Defaults to 'command-a-plus-05-2026'."}
   *
   * @returns {Object}
   * @sampleResult {"text":"tokenize me!","meta":{"api_version":{"version":"1"}}}
   */
  async detokenizeText(tokens, model) {
    if (!tokens?.length) {
      throw new Error('Tokens array is required and must not be empty')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/detokenize`,
      body: { tokens, model: model || DEFAULT_CHAT_MODEL },
      logTag: 'detokenizeText',
    })
  }

  /**
   * @operationName Transcribe Audio
   * @description Transcribes an audio file into text using Cohere Transcribe (state-of-the-art speech recognition across 14 languages including English, German, French, Spanish, Chinese, Arabic, Japanese and Korean) via the v2 Audio Transcriptions API. Downloads the audio from the provided URL (FlowRunner file URL or any public URL; flac, mp3, mpeg, mpga, ogg or wav, max 25MB) and returns the transcribed text.
   * @category Audio
   * @route POST /transcribe-audio
   *
   * @executionTimeoutInSeconds 180
   *
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"description":"URL of the audio file to transcribe — a FlowRunner file URL or any public 'http(s)://' URL. Supported formats: flac, mp3, mpeg, mpga, ogg, wav (max 25MB)."}
   * @paramDef {"type":"String","label":"Language","name":"language","required":true,"defaultValue":"en","description":"ISO-639-1 language code of the audio, e.g. 'en', 'de', 'fr', 'es', 'pt', 'it', 'nl', 'pl', 'el', 'vi', 'zh', 'ar', 'ja' or 'ko'."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getModelsDictionary","defaultValue":"cohere-transcribe-03-2026","description":"The transcription model to use. Defaults to 'cohere-transcribe-03-2026'."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature between 0 and 1. Lower values are more focused and deterministic."}
   *
   * @returns {Object}
   * @sampleResult {"text":"Welcome everyone to the quarterly business review. Today we will discuss our growth strategy."}
   */
  async transcribeAudio(fileUrl, language, model, temperature) {
    if (!language || !language.trim()) {
      throw new Error('Language is required')
    }

    const fileBuffer = await this.#downloadFile(fileUrl, 'transcribeAudio')

    const form = new Flowrunner.Request.FormData()

    form.append('file', fileBuffer, { filename: this.#extractFileName(fileUrl, 'audio') })
    form.append('model', model || DEFAULT_TRANSCRIBE_MODEL)
    form.append('language', language)

    if (temperature !== undefined && temperature !== null) {
      form.append('temperature', String(temperature))
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v2/audio/transcriptions`,
      form,
      logTag: 'transcribeAudio',
    })
  }

  /**
   * @operationName Create Batch
   * @description Creates and starts an asynchronous batch job that processes a previously uploaded and validated dataset of requests (dataset type 'batch-chat-v2-input', 'batch-embed-v2-input', 'batch-openai-chat-input' or 'batch-chat-input') with the chosen model. Poll the batch with Get Batch; once completed, the results are available as a new dataset referenced by output_dataset_id.
   * @category Batches
   * @route POST /create-batch
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"A name for the batch job, e.g. 'Nightly summaries'."}
   * @paramDef {"type":"String","label":"Input Dataset","name":"inputDatasetId","required":true,"dictionary":"getDatasetsDictionary","description":"The validated dataset of batch requests to process. Pick from the list or paste a dataset ID."}
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getModelsDictionary","description":"The model that processes every request in the batch, e.g. 'command-a-03-2025' or 'embed-v4.0'."}
   *
   * @returns {Object}
   * @sampleResult {"batch":{"id":"batch_abc123","name":"Nightly summaries","input_dataset_id":"dataset_xkjd93kl","model":"command-a-03-2025","status":"BATCH_STATUS_QUEUED","created_at":"2026-07-13T10:00:00Z"}}
   */
  async createBatch(name, inputDatasetId, model) {
    if (!name || !inputDatasetId || !model) {
      throw new Error('Name, Input Dataset and Model are required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v2/batches`,
      body: { name, input_dataset_id: inputDatasetId, model },
      logTag: 'createBatch',
    })
  }

  /**
   * @operationName List Batches
   * @description Lists the batch jobs of the authenticated user with their statuses, models, record counts and input/output dataset IDs. Supports pagination via page size (up to 1000, default 50) and page token.
   * @category Batches
   * @route GET /list-batches
   *
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of batches to return, up to 1000. Defaults to 50."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous List Batches response (next_page_token)."}
   *
   * @returns {Object}
   * @sampleResult {"batches":[{"id":"batch_abc123","name":"Nightly summaries","status":"BATCH_STATUS_COMPLETED","model":"command-a-03-2025","num_records":100,"num_successful_records":100,"num_failed_records":0}],"next_page_token":null}
   */
  async listBatches(pageSize, pageToken) {
    const query = {}

    if (pageSize) query.page_size = pageSize
    if (pageToken) query.page_token = pageToken

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v2/batches`,
      method: 'get',
      query,
      logTag: 'listBatches',
    })
  }

  /**
   * @operationName Get Batch
   * @description Retrieves the current state of a batch job by its ID, including status (queued, in progress, completed, failed, canceled), record counts, token totals and the output_dataset_id for downloading results once completed.
   * @category Batches
   * @route GET /get-batch
   *
   * @paramDef {"type":"String","label":"Batch","name":"batchId","required":true,"dictionary":"getBatchesDictionary","description":"The batch to fetch. Pick from the list or paste a batch ID."}
   *
   * @returns {Object}
   * @sampleResult {"batch":{"id":"batch_abc123","name":"Nightly summaries","status":"BATCH_STATUS_COMPLETED","model":"command-a-03-2025","input_dataset_id":"dataset_xkjd93kl","output_dataset_id":"dataset_out456","num_records":100,"num_successful_records":100,"num_failed_records":0}}
   */
  async getBatch(batchId) {
    if (!batchId) {
      throw new Error('Batch ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v2/batches/${ encodeURIComponent(batchId) }`,
      method: 'get',
      logTag: 'getBatch',
    })
  }

  /**
   * @operationName Cancel Batch
   * @description Cancels an in-progress batch job by its ID. The batch moves to the canceling and then canceled status; records already processed are billed.
   * @category Batches
   * @route POST /cancel-batch
   *
   * @paramDef {"type":"String","label":"Batch","name":"batchId","required":true,"dictionary":"getBatchesDictionary","description":"The batch to cancel. Pick from the list or paste a batch ID."}
   *
   * @returns {Object}
   * @sampleResult {"cancelled":true,"batchId":"batch_abc123"}
   */
  async cancelBatch(batchId) {
    if (!batchId) {
      throw new Error('Batch ID is required')
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v2/batches/${ encodeURIComponent(batchId) }:cancel`,
      body: {},
      logTag: 'cancelBatch',
    })

    return { cancelled: true, batchId, ...(response || {}) }
  }

  /**
   * @operationName Create Dataset
   * @description Uploads a file to Cohere as a dataset for use with the Batch API or Embed Jobs API. Provide either the URL of an existing file (FlowRunner file URL or any public URL) or raw content as text (JSONL, CSV or TXT depending on the dataset type). The dataset is validated asynchronously — check its validation status with Get Dataset before using it. Returns the new dataset ID.
   * @category Datasets
   * @route POST /create-dataset
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the dataset."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"defaultValue":"Embed Input","uiComponent":{"type":"DROPDOWN","options":{"values":["Embed Input","Batch Chat Input (v2)","Batch Embed Input (v2)","Batch OpenAI Chat Input","Batch Chat Input (v1)"]}},"description":"The dataset type, used to validate the uploaded data: 'Embed Input' for the Embed Jobs API, the 'Batch ...' types for the Batch API (JSONL of chat or embed requests)."}
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","description":"URL of the file to upload — a FlowRunner file URL or any public 'http(s)://' URL. Provide this or File Content."}
   * @paramDef {"type":"String","label":"File Content","name":"fileContent","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Raw file content to upload as text (e.g. JSONL with one request per line). Provide this or File URL."}
   * @paramDef {"type":"String","label":"Filename","name":"filename","description":"Optional filename for the upload; the extension determines parsing (.jsonl, .csv, .txt). Defaults to the name from the URL or a generated '.jsonl' name."}
   * @paramDef {"type":"Boolean","label":"Skip Malformed Input","name":"skipMalformedInput","uiComponent":{"type":"TOGGLE"},"description":"When enabled, rows with malformed input are dropped (and reported in warnings) instead of failing validation."}
   * @paramDef {"type":"Boolean","label":"Keep Original File","name":"keepOriginalFile","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the original uploaded file is stored alongside the parsed dataset."}
   * @paramDef {"type":"String","label":"Text Separator","name":"textSeparator","description":"For raw .txt uploads: the separator used to split the file into entries."}
   * @paramDef {"type":"String","label":"CSV Delimiter","name":"csvDelimiter","description":"For .csv uploads: the delimiter character used in the file."}
   *
   * @returns {Object}
   * @sampleResult {"id":"dataset_xkjd93kl"}
   */
  async createDataset(name, type, fileUrl, fileContent, filename, skipMalformedInput, keepOriginalFile, textSeparator, csvDelimiter) {
    if (!name || !name.trim()) {
      throw new Error('Name is required')
    }

    let fileBuffer
    let resolvedFilename = filename

    if (fileUrl) {
      fileBuffer = await this.#downloadFile(fileUrl, 'createDataset')
      resolvedFilename = resolvedFilename || this.#extractFileName(fileUrl, `dataset_${ Date.now() }.jsonl`)
    } else if (fileContent && fileContent.trim()) {
      fileBuffer = Buffer.from(fileContent, 'utf8')
      resolvedFilename = resolvedFilename || `dataset_${ Date.now() }.jsonl`
    } else {
      throw new Error('Either File URL or File Content is required')
    }

    const query = {
      name,
      type: this.#resolveChoice(type, {
        'Embed Input': 'embed-input',
        'Batch Chat Input (v2)': 'batch-chat-v2-input',
        'Batch Embed Input (v2)': 'batch-embed-v2-input',
        'Batch OpenAI Chat Input': 'batch-openai-chat-input',
        'Batch Chat Input (v1)': 'batch-chat-input',
      }) || 'embed-input',
    }

    if (skipMalformedInput !== undefined && skipMalformedInput !== null) query.skip_malformed_input = skipMalformedInput
    if (keepOriginalFile !== undefined && keepOriginalFile !== null) query.keep_original_file = keepOriginalFile
    if (textSeparator) query.text_separator = textSeparator
    if (csvDelimiter) query.csv_delimiter = csvDelimiter

    const form = new Flowrunner.Request.FormData()

    form.append('data', fileBuffer, { filename: resolvedFilename })

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/datasets`,
      form,
      query,
      logTag: 'createDataset',
    })
  }

  /**
   * @operationName List Datasets
   * @description Lists datasets in the Cohere account with their types, validation statuses and download URLs. Supports filtering by dataset type, validation status and creation date range, plus limit/offset pagination.
   * @category Datasets
   * @route GET /list-datasets
   *
   * @paramDef {"type":"String","label":"Dataset Type","name":"datasetType","uiComponent":{"type":"DROPDOWN","options":{"values":["Embed Input","Embed Result","Batch Chat Input (v2)","Batch Embed Input (v2)","Batch OpenAI Chat Input","Batch Chat Input (v1)","Cluster Result","Cluster Outliers"]}},"description":"Optional filter by dataset type."}
   * @paramDef {"type":"String","label":"Validation Status","name":"validationStatus","uiComponent":{"type":"DROPDOWN","options":{"values":["Unknown","Queued","Processing","Failed","Validated","Skipped"]}},"description":"Optional filter by validation status."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of datasets to return."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of datasets to skip from the start of the results."}
   * @paramDef {"type":"String","label":"Created Before","name":"before","description":"Optional ISO 8601 timestamp; only datasets created before this date are returned, e.g. '2026-07-01T00:00:00Z'."}
   * @paramDef {"type":"String","label":"Created After","name":"after","description":"Optional ISO 8601 timestamp; only datasets created after this date are returned, e.g. '2026-06-01T00:00:00Z'."}
   *
   * @returns {Object}
   * @sampleResult {"datasets":[{"id":"dataset_xkjd93kl","name":"support-tickets","dataset_type":"batch-chat-v2-input","validation_status":"validated","created_at":"2026-07-13T10:00:00Z"}]}
   */
  async listDatasets(datasetType, validationStatus, limit, offset, before, after) {
    const query = {}

    const resolvedType = this.#resolveChoice(datasetType, {
      'Embed Input': 'embed-input',
      'Embed Result': 'embed-result',
      'Batch Chat Input (v2)': 'batch-chat-v2-input',
      'Batch Embed Input (v2)': 'batch-embed-v2-input',
      'Batch OpenAI Chat Input': 'batch-openai-chat-input',
      'Batch Chat Input (v1)': 'batch-chat-input',
      'Cluster Result': 'cluster-result',
      'Cluster Outliers': 'cluster-outliers',
    })

    const resolvedStatus = this.#resolveChoice(validationStatus, {
      'Unknown': 'unknown', 'Queued': 'queued', 'Processing': 'processing',
      'Failed': 'failed', 'Validated': 'validated', 'Skipped': 'skipped',
    })

    if (resolvedType) query.datasetType = resolvedType
    if (resolvedStatus) query.validationStatus = resolvedStatus
    if (limit) query.limit = limit
    if (offset) query.offset = offset
    if (before) query.before = before
    if (after) query.after = after

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/datasets`,
      method: 'get',
      query,
      logTag: 'listDatasets',
    })
  }

  /**
   * @operationName Get Dataset
   * @description Retrieves a dataset by its ID, including its type, validation status, any validation error/warnings, and the dataset parts with download URLs for retrieving the data (e.g. batch job results or embed job outputs).
   * @category Datasets
   * @route GET /get-dataset
   *
   * @paramDef {"type":"String","label":"Dataset","name":"datasetId","required":true,"dictionary":"getDatasetsDictionary","description":"The dataset to fetch. Pick from the list or paste a dataset ID."}
   *
   * @returns {Object}
   * @sampleResult {"dataset":{"id":"dataset_xkjd93kl","name":"support-tickets","dataset_type":"batch-chat-v2-input","validation_status":"validated","created_at":"2026-07-13T10:00:00Z","dataset_parts":[{"id":"part_1","name":"part_1.jsonl","url":"https://storage.googleapis.com/..."}]}}
   */
  async getDataset(datasetId) {
    if (!datasetId) {
      throw new Error('Dataset ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/datasets/${ encodeURIComponent(datasetId) }`,
      method: 'get',
      logTag: 'getDataset',
    })
  }

  /**
   * @operationName Delete Dataset
   * @description Permanently deletes a dataset from the Cohere account by its ID. Datasets are also automatically deleted 30 days after creation.
   * @category Datasets
   * @route DELETE /delete-dataset
   *
   * @paramDef {"type":"String","label":"Dataset","name":"datasetId","required":true,"dictionary":"getDatasetsDictionary","description":"The dataset to delete. Pick from the list or paste a dataset ID."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"datasetId":"dataset_xkjd93kl"}
   */
  async deleteDataset(datasetId) {
    if (!datasetId) {
      throw new Error('Dataset ID is required')
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/datasets/${ encodeURIComponent(datasetId) }`,
      method: 'delete',
      logTag: 'deleteDataset',
    })

    return { deleted: true, datasetId, ...(response || {}) }
  }

  /**
   * @operationName Get Dataset Usage
   * @description Retrieves the total dataset storage usage for the organization in bytes. Each organization can store up to 10GB of datasets across all users.
   * @category Datasets
   * @route GET /get-dataset-usage
   *
   * @returns {Object}
   * @sampleResult {"organization_usage":8000000}
   */
  async getDatasetUsage() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/datasets/usage`,
      method: 'get',
      logTag: 'getDatasetUsage',
    })
  }

  /**
   * @operationName Create Embed Job
   * @description Starts an asynchronous embed job that embeds an entire validated dataset of type 'embed-input' — the way to embed large corpora beyond the 96-text limit of Create Embeddings. Supports input-type optimization, multiple embedding types and truncation control. Poll the job with Get Embed Job; results are delivered as a new dataset referenced by output_dataset_id.
   * @category Embed Jobs
   * @route POST /create-embed-job
   *
   * @paramDef {"type":"String","label":"Dataset","name":"datasetId","required":true,"dictionary":"getDatasetsDictionary","description":"The dataset to embed. Must be of type 'embed-input' with validation status 'validated'."}
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getEmbedModelsDictionary","defaultValue":"embed-v4.0","description":"The embedding model to use, e.g. 'embed-v4.0' or 'embed-multilingual-v3.0'."}
   * @paramDef {"type":"String","label":"Input Type","name":"inputType","required":true,"defaultValue":"Search Document","uiComponent":{"type":"DROPDOWN","options":{"values":["Search Document","Search Query","Classification","Clustering","Image"]}},"description":"Optimizes embeddings for the intended use. 'Search Document' is typical for building a vector database."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Optional name for the embed job."}
   * @paramDef {"type":"Array<String>","label":"Embedding Types","name":"embeddingTypes","uiComponent":{"type":"DROPDOWN","options":{"values":["Float","Int8","Uint8","Binary","Ubinary","Base64"]}},"description":"The embedding formats to return. Defaults to float embeddings."}
   * @paramDef {"type":"String","label":"Truncate","name":"truncate","uiComponent":{"type":"DROPDOWN","options":{"values":["Start","End"]}},"description":"How to handle inputs longer than the model maximum: 'Start' discards the beginning, 'End' discards the end (default)."}
   *
   * @returns {Object}
   * @sampleResult {"job_id":"ej_abc123"}
   */
  async createEmbedJob(datasetId, model, inputType, name, embeddingTypes, truncate) {
    if (!datasetId) {
      throw new Error('Dataset ID is required')
    }

    const body = {
      dataset_id: datasetId,
      model: model || DEFAULT_EMBED_MODEL,
      input_type: this.#resolveChoice(inputType, {
        'Search Document': 'search_document',
        'Search Query': 'search_query',
        'Classification': 'classification',
        'Clustering': 'clustering',
        'Image': 'image',
      }) || 'search_document',
    }

    if (name) body.name = name

    const resolvedEmbeddingTypes = (embeddingTypes || [])
      .map(value => this.#resolveChoice(value, {
        'Float': 'float', 'Int8': 'int8', 'Uint8': 'uint8', 'Binary': 'binary', 'Ubinary': 'ubinary', 'Base64': 'base64',
      }))
      .filter(Boolean)

    if (resolvedEmbeddingTypes.length) body.embedding_types = resolvedEmbeddingTypes

    const resolvedTruncate = this.#resolveChoice(truncate, { 'Start': 'START', 'End': 'END' })

    if (resolvedTruncate) body.truncate = resolvedTruncate

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/embed-jobs`,
      body,
      logTag: 'createEmbedJob',
    })
  }

  /**
   * @operationName List Embed Jobs
   * @description Lists all embed jobs of the authenticated user with their statuses, models and input/output dataset IDs.
   * @category Embed Jobs
   * @route GET /list-embed-jobs
   *
   * @returns {Object}
   * @sampleResult {"embed_jobs":[{"job_id":"ej_abc123","name":"docs-embeddings","status":"complete","model":"embed-v4.0","input_dataset_id":"dataset_xkjd93kl","output_dataset_id":"dataset_out456","created_at":"2026-07-13T10:00:00Z","truncate":"END"}]}
   */
  async listEmbedJobs() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/embed-jobs`,
      method: 'get',
      logTag: 'listEmbedJobs',
    })
  }

  /**
   * @operationName Get Embed Job
   * @description Retrieves the details of an embed job by its ID, including status, model, input dataset and — once complete — the output_dataset_id containing the generated embeddings (downloadable via Get Dataset).
   * @category Embed Jobs
   * @route GET /get-embed-job
   *
   * @paramDef {"type":"String","label":"Embed Job","name":"jobId","required":true,"dictionary":"getEmbedJobsDictionary","description":"The embed job to fetch. Pick from the list or paste a job ID."}
   *
   * @returns {Object}
   * @sampleResult {"job_id":"ej_abc123","name":"docs-embeddings","status":"complete","model":"embed-v4.0","input_dataset_id":"dataset_xkjd93kl","output_dataset_id":"dataset_out456","created_at":"2026-07-13T10:00:00Z","truncate":"END"}
   */
  async getEmbedJob(jobId) {
    if (!jobId) {
      throw new Error('Embed Job ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/embed-jobs/${ encodeURIComponent(jobId) }`,
      method: 'get',
      logTag: 'getEmbedJob',
    })
  }

  /**
   * @operationName Cancel Embed Job
   * @description Cancels an active embed job by its ID. The embedding process is terminated; embeddings processed before cancellation are billed but partial results are not made available.
   * @category Embed Jobs
   * @route POST /cancel-embed-job
   *
   * @paramDef {"type":"String","label":"Embed Job","name":"jobId","required":true,"dictionary":"getEmbedJobsDictionary","description":"The embed job to cancel. Pick from the list or paste a job ID."}
   *
   * @returns {Object}
   * @sampleResult {"cancelled":true,"jobId":"ej_abc123"}
   */
  async cancelEmbedJob(jobId) {
    if (!jobId) {
      throw new Error('Embed Job ID is required')
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/embed-jobs/${ encodeURIComponent(jobId) }/cancel`,
      body: {},
      logTag: 'cancelEmbedJob',
    })

    return { cancelled: true, jobId, ...(response || {}) }
  }

  /**
   * @operationName List Models
   * @description Lists the models available through the Cohere API with their compatible endpoints, context lengths, deprecation status and supported features. Supports filtering by endpoint (chat, embed, rerank, classify), returning only the default model for an endpoint, and page-based pagination.
   * @category Models
   * @route GET /list-models
   *
   * @paramDef {"type":"String","label":"Endpoint","name":"endpoint","uiComponent":{"type":"DROPDOWN","options":{"values":["Chat","Embed","Rerank","Classify"]}},"description":"Optional filter: only return models compatible with this endpoint."}
   * @paramDef {"type":"Boolean","label":"Default Only","name":"defaultOnly","uiComponent":{"type":"TOGGLE"},"description":"When enabled, returns only the default model for the selected endpoint. Requires the Endpoint filter to be set."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of models to return per page, between 1 and 1000. Defaults to 20."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous List Models response (next_page_token)."}
   *
   * @returns {Object}
   * @sampleResult {"models":[{"name":"command-a-plus-05-2026","endpoints":["chat"],"context_length":128000,"is_deprecated":false,"finetuned":false,"features":["tools","vision","thinking"]}],"next_page_token":null}
   */
  async listModels(endpoint, defaultOnly, pageSize, pageToken) {
    const query = {}

    const resolvedEndpoint = this.#resolveChoice(endpoint, {
      'Chat': 'chat', 'Embed': 'embed', 'Rerank': 'rerank', 'Classify': 'classify',
    })

    if (resolvedEndpoint) query.endpoint = resolvedEndpoint
    if (defaultOnly) query.default_only = true
    if (pageSize) query.page_size = pageSize
    if (pageToken) query.page_token = pageToken

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/models`,
      method: 'get',
      query,
      logTag: 'listModels',
    })
  }

  /**
   * @operationName Get Model
   * @description Retrieves the details of a specific Cohere model by its name, including compatible endpoints, context length, deprecation status, tokenizer URL, supported features and default sampling parameters.
   * @category Models
   * @route GET /get-model
   *
   * @paramDef {"type":"String","label":"Model","name":"modelName","required":true,"dictionary":"getModelsDictionary","description":"The model to fetch. Pick from the list or paste a model name."}
   *
   * @returns {Object}
   * @sampleResult {"name":"command-a-plus-05-2026","endpoints":["chat"],"finetuned":false,"context_length":128000,"is_deprecated":false,"tokenizer_url":"https://storage.googleapis.com/cohere-public/tokenizers/command-a-plus-05-2026.json","features":["tools","vision","thinking"]}
   */
  async getModel(modelName) {
    if (!modelName) {
      throw new Error('Model name is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/models/${ encodeURIComponent(modelName) }`,
      method: 'get',
      logTag: 'getModel',
    })
  }
}

Flowrunner.ServerCode.addService(CohereService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Cohere API key from https://dashboard.cohere.com/api-keys',
  },
])
