'use strict'

const API_BASE_URL = 'https://api.mistral.ai/v1'

const DEFAULT_CHAT_MODEL = 'mistral-medium-latest'
const DEFAULT_OCR_MODEL = 'mistral-ocr-latest'
const DEFAULT_EMBEDDING_MODEL = 'mistral-embed'
const DEFAULT_FIM_MODEL = 'codestral-latest'
const DEFAULT_MODERATION_MODEL = 'mistral-moderation-latest'
const DEFAULT_TRANSCRIPTION_MODEL = 'voxtral-mini-latest'
const DEFAULT_TTS_MODEL = 'voxtral-tts-latest'
const DEFAULT_TTS_FORMAT = 'mp3'

const logger = {
  info: (...args) => console.log('[Mistral AI] info:', ...args),
  debug: (...args) => console.log('[Mistral AI] debug:', ...args),
  error: (...args) => console.log('[Mistral AI] error:', ...args),
  warn: (...args) => console.log('[Mistral AI] warn:', ...args),
}

/**
 * @usesFileStorage
 * @integrationName Mistral AI
 * @integrationIcon /icon.svg
 */
class MistralAIService {
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
      const errorMsg = normalizeError(error)

      logger.error(`${ logTag } - error: ${ errorMsg }`)

      throw new Error(`Mistral AI API error: ${ errorMsg }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #resolveMessages(messages) {
    return (messages || []).map(message => ({
      role: this.#resolveChoice(message.role, { System: 'system', User: 'user', Assistant: 'assistant' }) || 'user',
      content: message.content,
    }))
  }

  #extractFileName(url, fallback) {
    const pathname = url.split('?')[0].split('#')[0]

    return decodeURIComponent(pathname.split('/').pop() || fallback)
  }

  async #downloadBuffer(fileUrl) {
    if (!fileUrl || !/^https?:\/\//i.test(fileUrl)) {
      throw new Error(`Invalid file URL '${ fileUrl }'. It must start with 'http://' or 'https://'`)
    }

    const rawBytes = await Flowrunner.Request.get(fileUrl).setEncoding(null)

    return Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(rawBytes)
  }

  #extractConversationText(outputs) {
    const messages = (outputs || []).filter(entry => entry.type === 'message.output')
    const lastMessage = messages[messages.length - 1]

    if (!lastMessage) {
      return ''
    }

    if (typeof lastMessage.content === 'string') {
      return lastMessage.content
    }

    return (lastMessage.content || [])
      .map(chunk => (typeof chunk === 'string' ? chunk : chunk.text || ''))
      .join('')
  }

  // ---------------------------------------------------------------------------
  // Dictionaries
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} getModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — Mistral's model list is not paginated."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Models Dictionary
   * @description Provides a searchable, live list of all Mistral AI models available to your account for dynamic parameter selection.
   * @route POST /get-models-dictionary
   * @paramDef {"type":"getModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"mistral-medium-latest","value":"mistral-medium-latest","note":"Frontier multimodal model"},{"label":"codestral-latest","value":"codestral-latest","note":"Code generation model"}],"cursor":null}
   */
  async getModelsDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/models`,
      method: 'get',
      logTag: 'getModelsDictionary',
    })

    let models = response.data || []

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      models = models.filter(model => model.id.toLowerCase().includes(searchLower))
    }

    return {
      items: models
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(model => ({ label: model.id, value: model.id, note: model.description || model.id })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getAgentsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter agents by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — the first 100 agents are returned."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Agents Dictionary
   * @description Provides a searchable, live list of agents created in your Mistral AI workspace for dynamic parameter selection.
   * @route POST /get-agents-dictionary
   * @paramDef {"type":"getAgentsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering agents."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Support Assistant","value":"ag_0684xxx","note":"mistral-medium-latest"}],"cursor":null}
   */
  async getAgentsDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/agents`,
      method: 'get',
      query: { page: 0, page_size: 100 },
      logTag: 'getAgentsDictionary',
    })

    let agents = Array.isArray(response) ? response : response.data || []

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      agents = agents.filter(agent => (agent.name || '').toLowerCase().includes(searchLower))
    }

    return {
      items: agents.map(agent => ({
        label: agent.name || agent.id,
        value: agent.id,
        note: agent.model || agent.description || agent.id,
      })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getVoicesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter voices by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — the first 100 voices are returned."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Voices Dictionary
   * @description Provides a searchable, live list of preset and custom text-to-speech voices available in your Mistral AI account.
   * @route POST /get-voices-dictionary
   * @paramDef {"type":"getVoicesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering voices."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Aria","value":"voice_0684xxx","note":"Aria"}],"cursor":null}
   */
  async getVoicesDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/audio/voices`,
      method: 'get',
      query: { limit: 100 },
      logTag: 'getVoicesDictionary',
    })

    let voices = response.items || response.data || []

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      voices = voices.filter(voice => (voice.name || voice.id || '').toLowerCase().includes(searchLower))
    }

    return {
      items: voices.map(voice => ({
        label: voice.name || voice.id,
        value: voice.id,
        note: voice.name || voice.id,
      })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getFilesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter files by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — the first 100 files are returned."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Files Dictionary
   * @description Provides a searchable, live list of files uploaded to your Mistral AI account for dynamic parameter selection.
   * @route POST /get-files-dictionary
   * @paramDef {"type":"getFilesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering files."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"invoice.pdf","value":"file_0684xxx","note":"ocr, 245120 bytes"}],"cursor":null}
   */
  async getFilesDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/files`,
      method: 'get',
      query: { page: 0, page_size: 100 },
      logTag: 'getFilesDictionary',
    })

    let files = response.data || []

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      files = files.filter(file => (file.filename || '').toLowerCase().includes(searchLower))
    }

    return {
      items: files.map(file => ({
        label: file.filename || file.id,
        value: file.id,
        note: `${ file.purpose || 'file' }, ${ file.bytes || 0 } bytes`,
      })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getLibrariesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter libraries by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — all accessible libraries are returned."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Libraries Dictionary
   * @description Provides a searchable, live list of document libraries in your Mistral AI workspace for dynamic parameter selection.
   * @route POST /get-libraries-dictionary
   * @paramDef {"type":"getLibrariesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering libraries."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Product Docs","value":"lib_0684xxx","note":"12 documents"}],"cursor":null}
   */
  async getLibrariesDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/libraries`,
      method: 'get',
      logTag: 'getLibrariesDictionary',
    })

    let libraries = Array.isArray(response) ? response : response.data || response.items || []

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      libraries = libraries.filter(library => (library.name || '').toLowerCase().includes(searchLower))
    }

    return {
      items: libraries.map(library => ({
        label: library.name || library.id,
        value: library.id,
        note: library.nb_documents !== undefined ? `${ library.nb_documents } documents` : library.description || library.id,
      })),
      cursor: null,
    }
  }

  // ---------------------------------------------------------------------------
  // Chat
  // ---------------------------------------------------------------------------

  /**
   * @operationName Ask AI
   * @description Sends a single prompt to a Mistral chat model and returns the generated answer text. Supports an optional system prompt, sampling controls (temperature, top-p), token limits, deterministic seeding, guardrail injection, JSON output mode, and stop sequences. Use "Create Chat Completion" for full multi-message conversations.
   * @category Chat
   * @route POST /ask-ai
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The user message to send to the model."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getModelsDictionary","defaultValue":"mistral-medium-latest","description":"The chat model to use. Defaults to 'mistral-medium-latest'."}
   * @paramDef {"type":"String","label":"System Prompt","name":"systemPrompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional system instructions that steer the model's behavior and tone."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature. Recommended range is 0.0 to 0.7; lower values give more deterministic output."}
   * @paramDef {"type":"Number","label":"Top P","name":"topP","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Nucleus sampling: only tokens within the top P probability mass are considered. Value between 0 and 1."}
   * @paramDef {"type":"Number","label":"Max Tokens","name":"maxTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens to generate in the response."}
   * @paramDef {"type":"String","label":"Response Format","name":"responseFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["Text","JSON Object"]}},"defaultValue":"Text","description":"Output format. 'JSON Object' forces the model to return valid JSON."}
   * @paramDef {"type":"Array<String>","label":"Stop Sequences","name":"stop","description":"Optional list of sequences at which generation stops."}
   * @paramDef {"type":"Boolean","label":"Safe Prompt","name":"safePrompt","uiComponent":{"type":"TOGGLE"},"description":"Injects Mistral's safety guardrail prompt before the conversation."}
   * @paramDef {"type":"Number","label":"Random Seed","name":"randomSeed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Seed for deterministic sampling across repeated calls."}
   *
   * @returns {Object}
   * @sampleResult {"text":"The Eiffel Tower is 330 meters tall.","model":"mistral-medium-latest","finishReason":"stop","usage":{"prompt_tokens":14,"completion_tokens":11,"total_tokens":25}}
   */
  async askAI(prompt, model, systemPrompt, temperature, topP, maxTokens, responseFormat, stop, safePrompt, randomSeed) {
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

    if (temperature !== undefined) body.temperature = temperature
    if (topP !== undefined) body.top_p = topP
    if (maxTokens !== undefined) body.max_tokens = maxTokens
    if (stop?.length) body.stop = stop
    if (safePrompt !== undefined) body.safe_prompt = safePrompt
    if (randomSeed !== undefined) body.random_seed = randomSeed

    const formatType = this.#resolveChoice(responseFormat, { 'Text': 'text', 'JSON Object': 'json_object' })

    if (formatType && formatType !== 'text') {
      body.response_format = { type: formatType }
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/chat/completions`,
      body,
      logTag: 'askAI',
    })

    const choice = response.choices?.[0]

    return {
      text: choice?.message?.content ?? '',
      model: response.model,
      finishReason: choice?.finish_reason,
      usage: response.usage,
    }
  }

  /**
   * @typedef {Object} ChatMessage
   * @paramDef {"type":"String","label":"Role","name":"role","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["System","User","Assistant"]}},"description":"The author of the message."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The message text."}
   */

  /**
   * @operationName Create Chat Completion
   * @description Runs a full multi-message chat completion against any Mistral chat model and returns the raw API response, including choices and token usage. Supports system/user/assistant message history, sampling controls, repetition penalties, deterministic seeding, guardrail injection, stop sequences, and structured output (JSON mode or a custom JSON Schema).
   * @category Chat
   * @route POST /create-chat-completion
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"Array<ChatMessage>","label":"Messages","name":"messages","required":true,"description":"Ordered conversation history to send to the model."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getModelsDictionary","defaultValue":"mistral-medium-latest","description":"The chat model to use. Defaults to 'mistral-medium-latest'."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature. Recommended range is 0.0 to 0.7; lower values give more deterministic output."}
   * @paramDef {"type":"Number","label":"Top P","name":"topP","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Nucleus sampling: only tokens within the top P probability mass are considered. Value between 0 and 1."}
   * @paramDef {"type":"Number","label":"Max Tokens","name":"maxTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens to generate in the response."}
   * @paramDef {"type":"String","label":"Response Format","name":"responseFormatType","uiComponent":{"type":"DROPDOWN","options":{"values":["Text","JSON Object","JSON Schema"]}},"defaultValue":"Text","description":"Output format. 'JSON Object' forces valid JSON; 'JSON Schema' additionally validates against the schema provided in 'JSON Schema' parameter."}
   * @paramDef {"type":"Object","label":"JSON Schema","name":"jsonSchema","description":"JSON Schema object the response must conform to. Required when Response Format is 'JSON Schema'."}
   * @paramDef {"type":"Array<String>","label":"Stop Sequences","name":"stop","description":"Optional list of sequences at which generation stops."}
   * @paramDef {"type":"Boolean","label":"Safe Prompt","name":"safePrompt","uiComponent":{"type":"TOGGLE"},"description":"Injects Mistral's safety guardrail prompt before the conversation."}
   * @paramDef {"type":"Number","label":"Random Seed","name":"randomSeed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Seed for deterministic sampling across repeated calls."}
   * @paramDef {"type":"Number","label":"Presence Penalty","name":"presencePenalty","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Penalizes tokens that already appeared, encouraging topic diversity. Value between -2 and 2."}
   * @paramDef {"type":"Number","label":"Frequency Penalty","name":"frequencyPenalty","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Penalizes tokens proportionally to their frequency so far, reducing repetition. Value between -2 and 2."}
   *
   * @returns {Object}
   * @sampleResult {"id":"cmpl-e5cc70bb28c444948073e77776eb30ef","object":"chat.completion","model":"mistral-medium-latest","choices":[{"index":0,"message":{"role":"assistant","content":"Here is the answer..."},"finish_reason":"stop"}],"usage":{"prompt_tokens":16,"completion_tokens":34,"total_tokens":50}}
   */
  async createChatCompletion(messages, model, temperature, topP, maxTokens, responseFormatType, jsonSchema, stop, safePrompt, randomSeed, presencePenalty, frequencyPenalty) {
    if (!messages?.length) {
      throw new Error('At least one message is required')
    }

    const body = {
      model: model || DEFAULT_CHAT_MODEL,
      messages: this.#resolveMessages(messages),
    }

    if (temperature !== undefined) body.temperature = temperature
    if (topP !== undefined) body.top_p = topP
    if (maxTokens !== undefined) body.max_tokens = maxTokens
    if (stop?.length) body.stop = stop
    if (safePrompt !== undefined) body.safe_prompt = safePrompt
    if (randomSeed !== undefined) body.random_seed = randomSeed
    if (presencePenalty !== undefined) body.presence_penalty = presencePenalty
    if (frequencyPenalty !== undefined) body.frequency_penalty = frequencyPenalty

    const formatType = this.#resolveChoice(responseFormatType, {
      'Text': 'text',
      'JSON Object': 'json_object',
      'JSON Schema': 'json_schema',
    })

    if (formatType === 'json_object') {
      body.response_format = { type: 'json_object' }
    } else if (formatType === 'json_schema') {
      if (!jsonSchema) {
        throw new Error('JSON Schema parameter is required when Response Format is set to \'JSON Schema\'')
      }

      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'response', schema: jsonSchema, strict: true },
      }
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/chat/completions`,
      body,
      logTag: 'createChatCompletion',
    })
  }

  /**
   * @operationName Analyze Image
   * @description Analyzes one or more images with a multimodal Mistral model (e.g. mistral-medium-latest, mistral-small-latest, pixtral) and answers a prompt about them. Accepts publicly accessible image URLs or base64 data URLs and returns the model's textual analysis.
   * @category Chat
   * @route POST /analyze-image
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The question or instruction about the image(s), e.g. 'What is in this picture?'."}
   * @paramDef {"type":"Array<String>","label":"Image URLs","name":"imageUrls","required":true,"description":"One or more image URLs to analyze. Accepts https URLs or base64 data URLs (data:image/png;base64,...)."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getModelsDictionary","defaultValue":"mistral-medium-latest","description":"A vision-capable model. Defaults to 'mistral-medium-latest'."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature. Recommended range is 0.0 to 0.7."}
   * @paramDef {"type":"Number","label":"Max Tokens","name":"maxTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens to generate in the response."}
   *
   * @returns {Object}
   * @sampleResult {"text":"The image shows a red bicycle leaning against a brick wall.","model":"mistral-medium-latest","finishReason":"stop","usage":{"prompt_tokens":1021,"completion_tokens":18,"total_tokens":1039}}
   */
  async analyzeImage(prompt, imageUrls, model, temperature, maxTokens) {
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    if (!imageUrls?.length) {
      throw new Error('At least one image URL is required')
    }

    const body = {
      model: model || DEFAULT_CHAT_MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...imageUrls.map(url => ({ type: 'image_url', image_url: url })),
        ],
      }],
    }

    if (temperature !== undefined) body.temperature = temperature
    if (maxTokens !== undefined) body.max_tokens = maxTokens

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/chat/completions`,
      body,
      logTag: 'analyzeImage',
    })

    const choice = response.choices?.[0]

    return {
      text: choice?.message?.content ?? '',
      model: response.model,
      finishReason: choice?.finish_reason,
      usage: response.usage,
    }
  }

  // ---------------------------------------------------------------------------
  // Document AI / OCR
  // ---------------------------------------------------------------------------

  /**
   * @operationName OCR Document
   * @description Extracts text and structure from a PDF or image using Mistral Document AI (OCR). Returns per-page markdown, optional embedded images as base64, and optional paragraph-level content blocks with bounding boxes. Accepts a document URL, an image URL, or the ID of a file previously uploaded with the 'ocr' purpose.
   * @category Document AI
   * @route POST /ocr-document
   *
   * @executionTimeoutInSeconds 600
   *
   * @paramDef {"type":"String","label":"Source Type","name":"sourceType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Document URL","Image URL","Uploaded File"]}},"defaultValue":"Document URL","description":"How the document is provided: a public PDF/document URL, a public image URL, or a Mistral file ID."}
   * @paramDef {"type":"String","label":"Document","name":"source","required":true,"description":"The document URL, image URL, or uploaded file ID matching the selected Source Type."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getModelsDictionary","defaultValue":"mistral-ocr-latest","description":"The OCR model to use. Defaults to 'mistral-ocr-latest'."}
   * @paramDef {"type":"String","label":"Pages","name":"pages","description":"Optional pages to process as comma-separated numbers and ranges, e.g. '0,2-4'. Page numbering starts at 0. All pages are processed when omitted."}
   * @paramDef {"type":"Boolean","label":"Include Image Base64","name":"includeImageBase64","uiComponent":{"type":"TOGGLE"},"description":"Include images extracted from the document as base64 data in the response."}
   * @paramDef {"type":"Boolean","label":"Include Blocks","name":"includeBlocks","uiComponent":{"type":"TOGGLE"},"description":"Return paragraph-level content blocks with bounding boxes and structural labels in reading order."}
   * @paramDef {"type":"String","label":"Table Format","name":"tableFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["Markdown","HTML"]}},"description":"Format used for tables in the extracted output. Defaults to Markdown."}
   *
   * @returns {Object}
   * @sampleResult {"model":"mistral-ocr-latest","pages":[{"index":0,"markdown":"# Invoice\\n\\nTotal: $120.00","images":[],"dimensions":{"dpi":200,"height":2200,"width":1700}}],"usage_info":{"pages_processed":1}}
   */
  async ocrDocument(sourceType, source, model, pages, includeImageBase64, includeBlocks, tableFormat) {
    if (!source || !source.trim()) {
      throw new Error('Document source is required')
    }

    const resolvedType = this.#resolveChoice(sourceType, {
      'Document URL': 'document_url',
      'Image URL': 'image_url',
      'Uploaded File': 'file',
    }) || 'document_url'

    let document

    if (resolvedType === 'document_url') {
      document = { type: 'document_url', document_url: source }
    } else if (resolvedType === 'image_url') {
      document = { type: 'image_url', image_url: source }
    } else {
      document = { type: 'file', file_id: source }
    }

    const body = {
      model: model || DEFAULT_OCR_MODEL,
      document,
    }

    if (pages?.trim()) {
      body.pages = parsePageRanges(pages)
    }

    if (includeImageBase64 !== undefined) body.include_image_base64 = includeImageBase64
    if (includeBlocks !== undefined) body.include_blocks = includeBlocks

    const resolvedTableFormat = this.#resolveChoice(tableFormat, { Markdown: 'markdown', HTML: 'html' })

    if (resolvedTableFormat) body.table_format = resolvedTableFormat

    return this.#apiRequest({
      url: `${ API_BASE_URL }/ocr`,
      body,
      logTag: 'ocrDocument',
    })
  }

  // ---------------------------------------------------------------------------
  // Embeddings
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Embeddings
   * @description Generates vector embeddings for one or more input texts using a Mistral embedding model ('mistral-embed' for natural language, 'codestral-embed' for code). Returns one embedding vector per input in the same order. Output dimension and data type can be customized for codestral-embed.
   * @category Embeddings
   * @route POST /create-embeddings
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"Array<String>","label":"Input Texts","name":"inputs","required":true,"description":"List of texts to embed. Each entry produces one embedding vector."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getModelsDictionary","defaultValue":"mistral-embed","description":"The embedding model to use. Defaults to 'mistral-embed'."}
   * @paramDef {"type":"Number","label":"Output Dimension","name":"outputDimension","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional dimension of the output vectors. Supported by 'codestral-embed'."}
   * @paramDef {"type":"String","label":"Output Data Type","name":"outputDtype","uiComponent":{"type":"DROPDOWN","options":{"values":["Float","Int8","Uint8","Binary","Ubinary"]}},"description":"Optional numeric representation of the output vectors. Supported by 'codestral-embed'. Defaults to Float."}
   *
   * @returns {Object}
   * @sampleResult {"id":"embd-aad6fc62b17349b192ef09225058bc45","object":"list","model":"mistral-embed","data":[{"object":"embedding","index":0,"embedding":[-0.0165,0.0716,0.0187]}],"usage":{"prompt_tokens":9,"total_tokens":9}}
   */
  async createEmbeddings(inputs, model, outputDimension, outputDtype) {
    if (!inputs?.length) {
      throw new Error('At least one input text is required')
    }

    const body = {
      model: model || DEFAULT_EMBEDDING_MODEL,
      input: inputs,
    }

    if (outputDimension !== undefined) body.output_dimension = outputDimension

    const resolvedDtype = this.#resolveChoice(outputDtype, {
      Float: 'float',
      Int8: 'int8',
      Uint8: 'uint8',
      Binary: 'binary',
      Ubinary: 'ubinary',
    })

    if (resolvedDtype) body.output_dtype = resolvedDtype

    return this.#apiRequest({
      url: `${ API_BASE_URL }/embeddings`,
      body,
      logTag: 'createEmbeddings',
    })
  }

  // ---------------------------------------------------------------------------
  // Code (FIM)
  // ---------------------------------------------------------------------------

  /**
   * @operationName FIM Completion
   * @description Performs a fill-in-the-middle code completion with a Codestral model: given a code prompt (prefix) and an optional suffix, generates the code that belongs between them. Ideal for code insertion, function body generation, and autocomplete-style tasks.
   * @category Code
   * @route POST /fim-completion
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Prompt (Prefix)","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The code before the insertion point that the model should continue."}
   * @paramDef {"type":"String","label":"Suffix","name":"suffix","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional code after the insertion point. The model generates content that fits between prompt and suffix."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getModelsDictionary","defaultValue":"codestral-latest","description":"The Codestral model to use. Defaults to 'codestral-latest'."}
   * @paramDef {"type":"Number","label":"Max Tokens","name":"maxTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens to generate."}
   * @paramDef {"type":"Number","label":"Min Tokens","name":"minTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Minimum number of tokens to generate."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature. Recommended range is 0.0 to 0.7."}
   * @paramDef {"type":"Number","label":"Top P","name":"topP","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Nucleus sampling parameter between 0 and 1."}
   * @paramDef {"type":"Array<String>","label":"Stop Sequences","name":"stop","description":"Optional list of sequences at which generation stops."}
   * @paramDef {"type":"Number","label":"Random Seed","name":"randomSeed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Seed for deterministic sampling across repeated calls."}
   *
   * @returns {Object}
   * @sampleResult {"text":"  return a + b;","model":"codestral-latest","finishReason":"stop","usage":{"prompt_tokens":12,"completion_tokens":8,"total_tokens":20}}
   */
  async fimCompletion(prompt, suffix, model, maxTokens, minTokens, temperature, topP, stop, randomSeed) {
    if (!prompt) {
      throw new Error('Prompt is required')
    }

    const body = {
      model: model || DEFAULT_FIM_MODEL,
      prompt,
    }

    if (suffix !== undefined && suffix !== '') body.suffix = suffix
    if (maxTokens !== undefined) body.max_tokens = maxTokens
    if (minTokens !== undefined) body.min_tokens = minTokens
    if (temperature !== undefined) body.temperature = temperature
    if (topP !== undefined) body.top_p = topP
    if (stop?.length) body.stop = stop
    if (randomSeed !== undefined) body.random_seed = randomSeed

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/fim/completions`,
      body,
      logTag: 'fimCompletion',
    })

    const choice = response.choices?.[0]

    return {
      text: choice?.message?.content ?? '',
      model: response.model,
      finishReason: choice?.finish_reason,
      usage: response.usage,
    }
  }

  // ---------------------------------------------------------------------------
  // Moderation
  // ---------------------------------------------------------------------------

  /**
   * @operationName Moderate Text
   * @description Classifies one or more raw texts for harmful content with Mistral's moderation model. Each result contains boolean flags and confidence scores across nine safety categories: sexual, hate_and_discrimination, violence_and_threats, dangerous_and_criminal_content, selfharm, health, financial, law, and pii.
   * @category Moderation
   * @route POST /moderate-text
   *
   * @paramDef {"type":"Array<String>","label":"Texts","name":"inputs","required":true,"description":"List of text strings to classify. One result is returned per input."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getModelsDictionary","defaultValue":"mistral-moderation-latest","description":"The moderation model to use. Defaults to 'mistral-moderation-latest'."}
   *
   * @returns {Object}
   * @sampleResult {"id":"mod-e5cc70bb28c444948073e77776eb30ef","model":"mistral-moderation-latest","results":[{"categories":{"sexual":false,"hate_and_discrimination":false,"violence_and_threats":true,"dangerous_and_criminal_content":false,"selfharm":false,"health":false,"financial":false,"law":false,"pii":false},"category_scores":{"sexual":0.001,"hate_and_discrimination":0.02,"violence_and_threats":0.94,"dangerous_and_criminal_content":0.01,"selfharm":0.0,"health":0.0,"financial":0.0,"law":0.0,"pii":0.001}}]}
   */
  async moderateText(inputs, model) {
    if (!inputs?.length) {
      throw new Error('At least one input text is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/moderations`,
      body: {
        model: model || DEFAULT_MODERATION_MODEL,
        input: inputs,
      },
      logTag: 'moderateText',
    })
  }

  /**
   * @operationName Moderate Conversation
   * @description Classifies a chat conversation for harmful content with Mistral's conversational moderation endpoint, which assesses the last message in the context of the full conversation. Returns boolean flags and confidence scores across nine safety categories, including jailbreak-style risks that only appear in conversational context.
   * @category Moderation
   * @route POST /moderate-conversation
   *
   * @paramDef {"type":"Array<ChatMessage>","label":"Messages","name":"messages","required":true,"description":"The conversation to classify, in order. The last message is assessed in the context of the preceding ones."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getModelsDictionary","defaultValue":"mistral-moderation-latest","description":"The moderation model to use. Defaults to 'mistral-moderation-latest'."}
   *
   * @returns {Object}
   * @sampleResult {"id":"mod-e5cc70bb28c444948073e77776eb30ef","model":"mistral-moderation-latest","results":[{"categories":{"sexual":false,"hate_and_discrimination":false,"violence_and_threats":false,"dangerous_and_criminal_content":true,"selfharm":false,"health":false,"financial":false,"law":false,"pii":false},"category_scores":{"sexual":0.001,"hate_and_discrimination":0.001,"violence_and_threats":0.03,"dangerous_and_criminal_content":0.89,"selfharm":0.0,"health":0.0,"financial":0.0,"law":0.0,"pii":0.001}}]}
   */
  async moderateConversation(messages, model) {
    if (!messages?.length) {
      throw new Error('At least one message is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/chat/moderations`,
      body: {
        model: model || DEFAULT_MODERATION_MODEL,
        input: this.#resolveMessages(messages),
      },
      logTag: 'moderateConversation',
    })
  }

  // ---------------------------------------------------------------------------
  // Audio
  // ---------------------------------------------------------------------------

  /**
   * @operationName Transcribe Audio
   * @description Transcribes an audio file into text using Mistral's Voxtral speech-to-text models. Accepts a public audio URL (including FlowRunner file URLs) or a previously uploaded Mistral file ID. Supports speaker diarization, custom vocabulary biasing (up to 100 terms), segment/word-level timestamps, and recordings up to 3 hours.
   * @category Audio
   * @route POST /transcribe-audio
   *
   * @executionTimeoutInSeconds 600
   *
   * @paramDef {"type":"String","label":"Audio File URL","name":"fileUrl","description":"Public URL of the audio file to transcribe. Provide either this or an uploaded File ID."}
   * @paramDef {"type":"String","label":"File ID","name":"fileId","dictionary":"getFilesDictionary","description":"ID of an audio file previously uploaded to Mistral. Provide either this or an Audio File URL."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getModelsDictionary","defaultValue":"voxtral-mini-latest","description":"The transcription model to use. Defaults to 'voxtral-mini-latest'."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Optional ISO language code of the audio (e.g. 'en'). Improves accuracy when known in advance."}
   * @paramDef {"type":"Boolean","label":"Diarize","name":"diarize","uiComponent":{"type":"TOGGLE"},"description":"Identify and label distinct speakers in the transcription."}
   * @paramDef {"type":"Array<String>","label":"Timestamp Granularities","name":"timestampGranularities","uiComponent":{"type":"DROPDOWN","options":{"values":["Segment","Word"]}},"description":"Timestamp detail levels to include in the response."}
   * @paramDef {"type":"Array<String>","label":"Context Bias Terms","name":"contextBias","description":"Optional list of up to 100 domain-specific terms or names to bias recognition toward."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature for transcription variability. Use 0 for the most deterministic output."}
   *
   * @returns {Object}
   * @sampleResult {"text":"Welcome everyone to the quarterly review.","language":"en","model":"voxtral-mini-latest","segments":[],"usage":{"prompt_audio_seconds":42,"prompt_tokens":375,"completion_tokens":21,"total_tokens":396}}
   */
  async transcribeAudio(fileUrl, fileId, model, language, diarize, timestampGranularities, contextBias, temperature) {
    if (!fileUrl && !fileId) {
      throw new Error('Either an Audio File URL or a File ID is required')
    }

    const form = new Flowrunner.Request.FormData()

    form.append('model', model || DEFAULT_TRANSCRIPTION_MODEL)

    if (fileUrl) {
      form.append('file_url', fileUrl)
    } else {
      form.append('file_id', fileId)
    }

    if (language) form.append('language', language)
    if (diarize !== undefined) form.append('diarize', String(diarize))
    if (temperature !== undefined) form.append('temperature', String(temperature))

    for (const granularity of timestampGranularities || []) {
      form.append('timestamp_granularities', this.#resolveChoice(granularity, { Segment: 'segment', Word: 'word' }))
    }

    for (const term of contextBias || []) {
      form.append('context_bias', term)
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/audio/transcriptions`,
      form,
      logTag: 'transcribeAudio',
    })
  }

  /**
   * @operationName Text to Speech
   * @description Converts text into natural-sounding speech using Mistral's Voxtral TTS model, with support for preset and custom (cloned) voices. Saves the generated audio to FlowRunner file storage and returns its URL.
   * @category Audio
   * @route POST /text-to-speech
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Input Text","name":"input","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text to convert to speech."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getModelsDictionary","defaultValue":"voxtral-tts-latest","description":"The text-to-speech model to use. Defaults to 'voxtral-tts-latest'."}
   * @paramDef {"type":"String","label":"Voice","name":"voiceId","dictionary":"getVoicesDictionary","description":"The preset or custom voice to speak with. Uses the model's default voice when omitted."}
   * @paramDef {"type":"String","label":"Output Format","name":"responseFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["MP3","WAV","FLAC","Opus","PCM"]}},"defaultValue":"MP3","description":"Audio file format of the generated speech. Defaults to MP3."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   *
   * @returns {Object}
   * @sampleResult {"fileURL":"https://files.example.com/flows/tts_1720000000000.mp3"}
   */
  async textToSpeech(input, model, voiceId, responseFormat, fileOptions) {
    if (!input || !input.trim()) {
      throw new Error('Input text is required')
    }

    const resolvedFormat = this.#resolveChoice(responseFormat, {
      MP3: 'mp3',
      WAV: 'wav',
      FLAC: 'flac',
      Opus: 'opus',
      PCM: 'pcm',
    }) || DEFAULT_TTS_FORMAT

    const body = {
      model: model || DEFAULT_TTS_MODEL,
      input,
      response_format: resolvedFormat,
    }

    if (voiceId) body.voice_id = voiceId

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/audio/speech`,
      body,
      logTag: 'textToSpeech',
    })

    let buffer

    if (Buffer.isBuffer(response)) {
      buffer = response
    } else if (response?.audio_data) {
      buffer = Buffer.from(response.audio_data, 'base64')
    } else if (typeof response === 'string') {
      buffer = Buffer.from(response, 'binary')
    } else {
      throw new Error('Unexpected text-to-speech response: no audio data returned')
    }

    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename: `tts_${ Date.now() }.${ resolvedFormat }`,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return { fileURL: url }
  }

  // ---------------------------------------------------------------------------
  // Files
  // ---------------------------------------------------------------------------

  /**
   * @operationName Upload File
   * @description Uploads a file from FlowRunner file storage (or any accessible URL) to Mistral for later use in OCR, batch processing, fine-tuning, or audio transcription. Individual files can be up to 512 MB. Returns the created Mistral file object including its ID.
   * @category Files
   * @route POST /upload-file
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"File","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"The FlowRunner file to upload (its URL). The file's bytes are streamed to Mistral."}
   * @paramDef {"type":"String","label":"Purpose","name":"purpose","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["OCR","Batch","Fine-tune"]}},"defaultValue":"OCR","description":"What the file will be used for on the Mistral platform."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","description":"Optional name to store the file under. Defaults to the source file's name."}
   *
   * @returns {Object}
   * @sampleResult {"id":"497f6eca-6276-4993-bfeb-53cbbbba6f09","object":"file","filename":"invoice.pdf","bytes":245120,"purpose":"ocr","sample_type":"ocr_input","source":"upload","created_at":1720000000}
   */
  async uploadFile(fileUrl, purpose, fileName) {
    const buffer = await this.#downloadBuffer(fileUrl)

    const resolvedPurpose = this.#resolveChoice(purpose, {
      'OCR': 'ocr',
      'Batch': 'batch',
      'Fine-tune': 'fine-tune',
    }) || 'ocr'

    const form = new Flowrunner.Request.FormData()

    form.append('purpose', resolvedPurpose)
    form.append('file', buffer, { filename: fileName || this.#extractFileName(fileUrl, 'upload.bin') })

    return this.#apiRequest({
      url: `${ API_BASE_URL }/files`,
      form,
      logTag: 'uploadFile',
    })
  }

  /**
   * @operationName List Files
   * @description Lists files uploaded to your Mistral AI account with pagination, optional name search, and purpose filtering. Returns file metadata including IDs, sizes, purposes, and creation timestamps.
   * @category Files
   * @route GET /list-files
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based page number. Defaults to 0."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of files per page. Defaults to 100."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter files by name."}
   * @paramDef {"type":"String","label":"Purpose","name":"purpose","uiComponent":{"type":"DROPDOWN","options":{"values":["OCR","Batch","Fine-tune"]}},"description":"Optional purpose to filter by."}
   *
   * @returns {Object}
   * @sampleResult {"object":"list","data":[{"id":"497f6eca-6276-4993-bfeb-53cbbbba6f09","object":"file","filename":"invoice.pdf","bytes":245120,"purpose":"ocr","created_at":1720000000}],"total":1}
   */
  async listFiles(page, pageSize, search, purpose) {
    const query = {
      page: page ?? 0,
      page_size: pageSize ?? 100,
    }

    if (search) query.search = search

    const resolvedPurpose = this.#resolveChoice(purpose, {
      'OCR': 'ocr',
      'Batch': 'batch',
      'Fine-tune': 'fine-tune',
    })

    if (resolvedPurpose) query.purpose = resolvedPurpose

    return this.#apiRequest({
      url: `${ API_BASE_URL }/files`,
      method: 'get',
      query,
      logTag: 'listFiles',
    })
  }

  /**
   * @operationName Get File
   * @description Retrieves metadata about a single file uploaded to Mistral, including its name, size, purpose, source, and creation timestamp.
   * @category Files
   * @route GET /get-file
   *
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The ID of the file to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"497f6eca-6276-4993-bfeb-53cbbbba6f09","object":"file","filename":"invoice.pdf","bytes":245120,"purpose":"ocr","sample_type":"ocr_input","source":"upload","created_at":1720000000}
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
   * @description Permanently deletes a file from your Mistral AI account. Returns a confirmation object indicating whether the deletion succeeded.
   * @category Files
   * @route DELETE /delete-file
   *
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The ID of the file to delete."}
   *
   * @returns {Object}
   * @sampleResult {"id":"497f6eca-6276-4993-bfeb-53cbbbba6f09","object":"file","deleted":true}
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
   * @operationName Get File Signed URL
   * @description Generates a temporary signed download URL for a file stored on Mistral (e.g. batch job results). The URL expires after the specified number of hours, between 1 and 168 (default 24).
   * @category Files
   * @route GET /get-file-signed-url
   *
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The ID of the file to generate a download URL for."}
   * @paramDef {"type":"Number","label":"Expiry (Hours)","name":"expiryHours","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":24,"description":"Number of hours before the signed URL expires, between 1 and 168. Defaults to 24."}
   *
   * @returns {Object}
   * @sampleResult {"url":"https://storage.mistral.ai/signed/497f6eca?expires=1720086400&signature=abc123"}
   */
  async getFileSignedUrl(fileId, expiryHours) {
    if (!fileId) {
      throw new Error('File ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/files/${ encodeURIComponent(fileId) }/url`,
      method: 'get',
      query: { expiry: expiryHours ?? 24 },
      logTag: 'getFileSignedUrl',
    })
  }

  /**
   * @operationName Download File
   * @description Downloads a file's content from Mistral (e.g. batch job output) and saves it to FlowRunner file storage. Returns the stored file's URL together with its original name.
   * @category Files
   * @route POST /download-file
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The ID of the Mistral file to download."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   *
   * @returns {Object}
   * @sampleResult {"fileURL":"https://files.example.com/flows/batch_results.jsonl","filename":"batch_results.jsonl"}
   */
  async downloadFile(fileId, fileOptions) {
    if (!fileId) {
      throw new Error('File ID is required')
    }

    const metadata = await this.#apiRequest({
      url: `${ API_BASE_URL }/files/${ encodeURIComponent(fileId) }`,
      method: 'get',
      logTag: 'downloadFile',
    })

    const bytes = await this.#apiRequest({
      url: `${ API_BASE_URL }/files/${ encodeURIComponent(fileId) }/content`,
      method: 'get',
      binary: true,
      logTag: 'downloadFile',
    })

    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    const filename = metadata.filename || `mistral_file_${ Date.now() }.bin`

    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return { fileURL: url, filename }
  }

  // ---------------------------------------------------------------------------
  // Batch
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Batch Job
   * @description Creates an asynchronous batch job that processes a .jsonl file of API requests (uploaded with the 'batch' purpose) at a 50% discount compared to synchronous calls. Supports the chat completions, embeddings, FIM, moderation, and OCR endpoints. Jobs run within the specified timeout window (default 24 hours).
   * @category Batch
   * @route POST /create-batch-job
   *
   * @paramDef {"type":"Array<String>","label":"Input File IDs","name":"inputFiles","required":true,"description":"IDs of .jsonl files (uploaded with the 'batch' purpose) containing the request payloads."}
   * @paramDef {"type":"String","label":"Endpoint","name":"endpoint","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Chat Completions","Embeddings","FIM Completions","Moderations","Chat Moderations","OCR"]}},"defaultValue":"Chat Completions","description":"The Mistral API endpoint each request in the batch is sent to."}
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getModelsDictionary","description":"The model used to process every request in the batch."}
   * @paramDef {"type":"Number","label":"Timeout (Hours)","name":"timeoutHours","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum hours the job may run before timing out. Defaults to 24."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","description":"Optional key-value pairs to associate with the job, e.g. {\"job_type\":\"nightly\"}."}
   *
   * @returns {Object}
   * @sampleResult {"id":"b4a5e7c2-1234-4b6a-9def-0123456789ab","object":"batch","endpoint":"/v1/chat/completions","model":"mistral-medium-latest","status":"QUEUED","total_requests":100,"completed_requests":0,"succeeded_requests":0,"failed_requests":0,"created_at":1720000000}
   */
  async createBatchJob(inputFiles, endpoint, model, timeoutHours, metadata) {
    if (!inputFiles?.length) {
      throw new Error('At least one input file ID is required')
    }

    if (!model) {
      throw new Error('Model is required')
    }

    const resolvedEndpoint = this.#resolveChoice(endpoint, {
      'Chat Completions': '/v1/chat/completions',
      'Embeddings': '/v1/embeddings',
      'FIM Completions': '/v1/fim/completions',
      'Moderations': '/v1/moderations',
      'Chat Moderations': '/v1/chat/moderations',
      'OCR': '/v1/ocr',
    }) || '/v1/chat/completions'

    const body = {
      input_files: inputFiles,
      endpoint: resolvedEndpoint,
      model,
    }

    if (timeoutHours !== undefined) body.timeout_hours = timeoutHours
    if (metadata) body.metadata = metadata

    return this.#apiRequest({
      url: `${ API_BASE_URL }/batch/jobs`,
      body,
      logTag: 'createBatchJob',
    })
  }

  /**
   * @operationName List Batch Jobs
   * @description Lists batch jobs in your Mistral AI organization with pagination and optional status filtering. Returns each job's ID, endpoint, model, request counters, and current status.
   * @category Batch
   * @route GET /list-batch-jobs
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based page number. Defaults to 0."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of jobs per page. Defaults to 100."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Queued","Running","Success","Failed","Timeout Exceeded","Cancellation Requested","Cancelled"]}},"description":"Optional status to filter jobs by."}
   * @paramDef {"type":"Boolean","label":"Created By Me","name":"createdByMe","uiComponent":{"type":"TOGGLE"},"description":"Only return jobs created by the current API key's user."}
   *
   * @returns {Object}
   * @sampleResult {"object":"list","data":[{"id":"b4a5e7c2-1234-4b6a-9def-0123456789ab","object":"batch","endpoint":"/v1/chat/completions","model":"mistral-medium-latest","status":"RUNNING","total_requests":100,"completed_requests":42}],"total":1}
   */
  async listBatchJobs(page, pageSize, status, createdByMe) {
    const query = {
      page: page ?? 0,
      page_size: pageSize ?? 100,
    }

    const resolvedStatus = this.#resolveChoice(status, {
      'Queued': 'QUEUED',
      'Running': 'RUNNING',
      'Success': 'SUCCESS',
      'Failed': 'FAILED',
      'Timeout Exceeded': 'TIMEOUT_EXCEEDED',
      'Cancellation Requested': 'CANCELLATION_REQUESTED',
      'Cancelled': 'CANCELLED',
    })

    if (resolvedStatus) query.status = resolvedStatus
    if (createdByMe !== undefined) query.created_by_me = createdByMe

    return this.#apiRequest({
      url: `${ API_BASE_URL }/batch/jobs`,
      method: 'get',
      query,
      logTag: 'listBatchJobs',
    })
  }

  /**
   * @operationName Get Batch Job
   * @description Retrieves the current state of a batch job, including its status, request counters (total, completed, succeeded, failed), timestamps, and the output/error file IDs once finished.
   * @category Batch
   * @route GET /get-batch-job
   *
   * @paramDef {"type":"String","label":"Job ID","name":"jobId","required":true,"description":"The ID of the batch job to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"b4a5e7c2-1234-4b6a-9def-0123456789ab","object":"batch","endpoint":"/v1/chat/completions","model":"mistral-medium-latest","status":"SUCCESS","total_requests":100,"completed_requests":100,"succeeded_requests":98,"failed_requests":2,"output_file":"497f6eca-6276-4993-bfeb-53cbbbba6f09","error_file":null,"created_at":1720000000,"completed_at":1720003600}
   */
  async getBatchJob(jobId) {
    if (!jobId) {
      throw new Error('Job ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/batch/jobs/${ encodeURIComponent(jobId) }`,
      method: 'get',
      logTag: 'getBatchJob',
    })
  }

  /**
   * @operationName Cancel Batch Job
   * @description Requests cancellation of a queued or running batch job. Requests already completed before cancellation remain available in the job's output file.
   * @category Batch
   * @route POST /cancel-batch-job
   *
   * @paramDef {"type":"String","label":"Job ID","name":"jobId","required":true,"description":"The ID of the batch job to cancel."}
   *
   * @returns {Object}
   * @sampleResult {"id":"b4a5e7c2-1234-4b6a-9def-0123456789ab","object":"batch","status":"CANCELLATION_REQUESTED","total_requests":100,"completed_requests":42}
   */
  async cancelBatchJob(jobId) {
    if (!jobId) {
      throw new Error('Job ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/batch/jobs/${ encodeURIComponent(jobId) }/cancel`,
      method: 'post',
      body: {},
      logTag: 'cancelBatchJob',
    })
  }

  // ---------------------------------------------------------------------------
  // Agents
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Agent
   * @description Creates a reusable Mistral agent that bundles a model, system instructions, built-in tools (web search, code interpreter, image generation, document libraries), and completion settings into a single versioned configuration addressable by agent ID in conversations.
   * @category Agents
   * @route POST /create-agent
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"A human-readable name for the agent."}
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getModelsDictionary","description":"The chat model the agent runs on."}
   * @paramDef {"type":"String","label":"Instructions","name":"instructions","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"System-level instructions that define the agent's behavior and persona."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Optional description of what the agent does."}
   * @paramDef {"type":"Boolean","label":"Enable Web Search","name":"enableWebSearch","uiComponent":{"type":"TOGGLE"},"description":"Give the agent access to the built-in web search tool."}
   * @paramDef {"type":"Boolean","label":"Enable Code Interpreter","name":"enableCodeInterpreter","uiComponent":{"type":"TOGGLE"},"description":"Give the agent access to the built-in code interpreter tool."}
   * @paramDef {"type":"Boolean","label":"Enable Image Generation","name":"enableImageGeneration","uiComponent":{"type":"TOGGLE"},"description":"Give the agent access to the built-in image generation tool."}
   * @paramDef {"type":"Array<String>","label":"Library IDs","name":"libraryIds","description":"Optional document library IDs the agent can search via the document library tool."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Default sampling temperature for the agent's completions. Recommended range is 0.0 to 0.7."}
   * @paramDef {"type":"Number","label":"Max Tokens","name":"maxTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Default maximum number of tokens the agent generates per response."}
   *
   * @returns {Object}
   * @sampleResult {"id":"ag_0684xxx","object":"agent","name":"Support Assistant","model":"mistral-medium-latest","instructions":"You are a helpful support agent.","tools":[{"type":"web_search"}],"version":0,"created_at":"2026-07-01T10:00:00Z"}
   */
  async createAgent(name, model, instructions, description, enableWebSearch, enableCodeInterpreter, enableImageGeneration, libraryIds, temperature, maxTokens) {
    if (!name || !model) {
      throw new Error('Name and Model are required')
    }

    const tools = []

    if (enableWebSearch) tools.push({ type: 'web_search' })
    if (enableCodeInterpreter) tools.push({ type: 'code_interpreter' })
    if (enableImageGeneration) tools.push({ type: 'image_generation' })
    if (libraryIds?.length) tools.push({ type: 'document_library', library_ids: libraryIds })

    const body = { name, model }

    if (instructions) body.instructions = instructions
    if (description) body.description = description
    if (tools.length) body.tools = tools

    const completionArgs = {}

    if (temperature !== undefined) completionArgs.temperature = temperature
    if (maxTokens !== undefined) completionArgs.max_tokens = maxTokens
    if (Object.keys(completionArgs).length) body.completion_args = completionArgs

    return this.#apiRequest({
      url: `${ API_BASE_URL }/agents`,
      body,
      logTag: 'createAgent',
    })
  }

  /**
   * @operationName Update Agent
   * @description Updates an existing Mistral agent's name, model, instructions, or description. Each update creates a new agent version; only the provided fields are changed.
   * @category Agents
   * @route PATCH /update-agent
   *
   * @paramDef {"type":"String","label":"Agent","name":"agentId","required":true,"dictionary":"getAgentsDictionary","description":"The ID of the agent to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New name for the agent."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getModelsDictionary","description":"New model for the agent."}
   * @paramDef {"type":"String","label":"Instructions","name":"instructions","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New system-level instructions for the agent."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"New description for the agent."}
   *
   * @returns {Object}
   * @sampleResult {"id":"ag_0684xxx","object":"agent","name":"Support Assistant v2","model":"mistral-medium-latest","instructions":"You are a helpful support agent.","version":1,"updated_at":"2026-07-02T10:00:00Z"}
   */
  async updateAgent(agentId, name, model, instructions, description) {
    if (!agentId) {
      throw new Error('Agent ID is required')
    }

    const body = {}

    if (name !== undefined) body.name = name
    if (model !== undefined) body.model = model
    if (instructions !== undefined) body.instructions = instructions
    if (description !== undefined) body.description = description

    if (!Object.keys(body).length) {
      throw new Error('At least one field to update is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/agents/${ encodeURIComponent(agentId) }`,
      method: 'patch',
      body,
      logTag: 'updateAgent',
    })
  }

  /**
   * @operationName List Agents
   * @description Lists agents created in your Mistral AI workspace with pagination. Returns each agent's ID, name, model, tools, and version information.
   * @category Agents
   * @route GET /list-agents
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based page number. Defaults to 0."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of agents per page. Defaults to 20."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"ag_0684xxx","object":"agent","name":"Support Assistant","model":"mistral-medium-latest","tools":[{"type":"web_search"}],"version":0}]
   */
  async listAgents(page, pageSize) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/agents`,
      method: 'get',
      query: {
        page: page ?? 0,
        page_size: pageSize ?? 20,
      },
      logTag: 'listAgents',
    })
  }

  /**
   * @operationName Get Agent
   * @description Retrieves the full configuration of a single Mistral agent, including its model, instructions, tools, completion settings, and version history metadata.
   * @category Agents
   * @route GET /get-agent
   *
   * @paramDef {"type":"String","label":"Agent","name":"agentId","required":true,"dictionary":"getAgentsDictionary","description":"The ID of the agent to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"ag_0684xxx","object":"agent","name":"Support Assistant","model":"mistral-medium-latest","instructions":"You are a helpful support agent.","tools":[{"type":"web_search"}],"version":0,"created_at":"2026-07-01T10:00:00Z"}
   */
  async getAgent(agentId) {
    if (!agentId) {
      throw new Error('Agent ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/agents/${ encodeURIComponent(agentId) }`,
      method: 'get',
      logTag: 'getAgent',
    })
  }

  /**
   * @operationName Delete Agent
   * @description Permanently deletes an agent from your Mistral AI workspace. Existing conversations that referenced the agent are not deleted.
   * @category Agents
   * @route DELETE /delete-agent
   *
   * @paramDef {"type":"String","label":"Agent","name":"agentId","required":true,"dictionary":"getAgentsDictionary","description":"The ID of the agent to delete."}
   *
   * @returns {Object}
   * @sampleResult {"id":"ag_0684xxx","object":"agent.deleted","deleted":true}
   */
  async deleteAgent(agentId) {
    if (!agentId) {
      throw new Error('Agent ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/agents/${ encodeURIComponent(agentId) }`,
      method: 'delete',
      logTag: 'deleteAgent',
    })
  }

  // ---------------------------------------------------------------------------
  // Conversations
  // ---------------------------------------------------------------------------

  /**
   * @operationName Start Conversation
   * @description Starts a new server-side conversation with either a base model or an existing agent. The conversation history is stored by Mistral (unless storing is disabled) so follow-up messages can be appended later by conversation ID. Returns the conversation ID, the assistant's reply text, and all output entries (including any tool executions).
   * @category Conversations
   * @route POST /start-conversation
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Input","name":"inputs","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The first user message of the conversation."}
   * @paramDef {"type":"String","label":"Agent","name":"agentId","dictionary":"getAgentsDictionary","description":"Run the conversation with this agent. Provide either an Agent or a Model, not both."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getModelsDictionary","description":"Run the conversation directly on this base model. Provide either an Agent or a Model, not both."}
   * @paramDef {"type":"String","label":"Instructions","name":"instructions","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional system instructions. Only used when running on a base model (agents carry their own instructions)."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Optional name for the conversation."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Optional description of the conversation."}
   * @paramDef {"type":"Boolean","label":"Store History","name":"store","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"Persist the conversation on Mistral's servers so it can be continued later. Defaults to true."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature. Only used when running on a base model."}
   * @paramDef {"type":"Number","label":"Max Tokens","name":"maxTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens to generate. Only used when running on a base model."}
   *
   * @returns {Object}
   * @sampleResult {"conversationId":"conv_0684xxx","text":"Albert Einstein was a theoretical physicist...","outputs":[{"type":"message.output","role":"assistant","content":"Albert Einstein was a theoretical physicist..."}],"usage":{"prompt_tokens":12,"completion_tokens":45,"total_tokens":57}}
   */
  async startConversation(inputs, agentId, model, instructions, name, description, store, temperature, maxTokens) {
    if (!inputs || !inputs.trim()) {
      throw new Error('Input is required')
    }

    if (!agentId && !model) {
      throw new Error('Either an Agent or a Model is required')
    }

    if (agentId && model) {
      throw new Error('Provide either an Agent or a Model, not both')
    }

    const body = { inputs }

    if (agentId) {
      body.agent_id = agentId
    } else {
      body.model = model

      if (instructions) body.instructions = instructions

      const completionArgs = {}

      if (temperature !== undefined) completionArgs.temperature = temperature
      if (maxTokens !== undefined) completionArgs.max_tokens = maxTokens
      if (Object.keys(completionArgs).length) body.completion_args = completionArgs
    }

    if (name) body.name = name
    if (description) body.description = description
    if (store !== undefined) body.store = store

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/conversations`,
      body,
      logTag: 'startConversation',
    })

    return {
      conversationId: response.conversation_id,
      text: this.#extractConversationText(response.outputs),
      outputs: response.outputs,
      usage: response.usage,
    }
  }

  /**
   * @operationName Append to Conversation
   * @description Appends a new user message to an existing stored conversation and runs the completion (including any agent tool executions). Returns the assistant's reply text and all new output entries.
   * @category Conversations
   * @route POST /append-to-conversation
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Conversation ID","name":"conversationId","required":true,"description":"The ID of the conversation to continue."}
   * @paramDef {"type":"String","label":"Input","name":"inputs","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The next user message to append."}
   *
   * @returns {Object}
   * @sampleResult {"conversationId":"conv_0684xxx","text":"He was born on March 14, 1879, in Ulm, Germany.","outputs":[{"type":"message.output","role":"assistant","content":"He was born on March 14, 1879, in Ulm, Germany."}],"usage":{"prompt_tokens":70,"completion_tokens":18,"total_tokens":88}}
   */
  async appendToConversation(conversationId, inputs) {
    if (!conversationId) {
      throw new Error('Conversation ID is required')
    }

    if (!inputs || !inputs.trim()) {
      throw new Error('Input is required')
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/conversations/${ encodeURIComponent(conversationId) }`,
      body: { inputs },
      logTag: 'appendToConversation',
    })

    return {
      conversationId: response.conversation_id || conversationId,
      text: this.#extractConversationText(response.outputs),
      outputs: response.outputs,
      usage: response.usage,
    }
  }

  /**
   * @operationName Get Conversation
   * @description Retrieves metadata about a stored conversation, including its name, description, associated model or agent, and timestamps.
   * @category Conversations
   * @route GET /get-conversation
   *
   * @paramDef {"type":"String","label":"Conversation ID","name":"conversationId","required":true,"description":"The ID of the conversation to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"conv_0684xxx","object":"conversation","name":"Einstein Q&A","model":"mistral-medium-latest","created_at":"2026-07-01T10:00:00Z","updated_at":"2026-07-01T10:05:00Z"}
   */
  async getConversation(conversationId) {
    if (!conversationId) {
      throw new Error('Conversation ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/conversations/${ encodeURIComponent(conversationId) }`,
      method: 'get',
      logTag: 'getConversation',
    })
  }

  /**
   * @operationName List Conversations
   * @description Lists stored conversations in your Mistral AI workspace with pagination, newest first. Returns each conversation's ID, name, model or agent, and timestamps.
   * @category Conversations
   * @route GET /list-conversations
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based page number. Defaults to 0."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of conversations per page. Defaults to 20."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"conv_0684xxx","object":"conversation","name":"Einstein Q&A","model":"mistral-medium-latest","created_at":"2026-07-01T10:00:00Z"}]
   */
  async listConversations(page, pageSize) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/conversations`,
      method: 'get',
      query: {
        page: page ?? 0,
        page_size: pageSize ?? 20,
      },
      logTag: 'listConversations',
    })
  }

  /**
   * @operationName Get Conversation History
   * @description Retrieves all entries of a stored conversation in order, including user messages, assistant messages, tool executions, and agent handoffs.
   * @category Conversations
   * @route GET /get-conversation-history
   *
   * @paramDef {"type":"String","label":"Conversation ID","name":"conversationId","required":true,"description":"The ID of the conversation whose history to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"object":"conversation.history","conversation_id":"conv_0684xxx","entries":[{"type":"message.input","role":"user","content":"Who is Albert Einstein?"},{"type":"message.output","role":"assistant","content":"Albert Einstein was a theoretical physicist..."}]}
   */
  async getConversationHistory(conversationId) {
    if (!conversationId) {
      throw new Error('Conversation ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/conversations/${ encodeURIComponent(conversationId) }/history`,
      method: 'get',
      logTag: 'getConversationHistory',
    })
  }

  /**
   * @operationName Get Conversation Messages
   * @description Retrieves only the user and assistant messages of a stored conversation in order, omitting tool executions and other non-message entries.
   * @category Conversations
   * @route GET /get-conversation-messages
   *
   * @paramDef {"type":"String","label":"Conversation ID","name":"conversationId","required":true,"description":"The ID of the conversation whose messages to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"object":"conversation.messages","conversation_id":"conv_0684xxx","messages":[{"role":"user","content":"Who is Albert Einstein?"},{"role":"assistant","content":"Albert Einstein was a theoretical physicist..."}]}
   */
  async getConversationMessages(conversationId) {
    if (!conversationId) {
      throw new Error('Conversation ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/conversations/${ encodeURIComponent(conversationId) }/messages`,
      method: 'get',
      logTag: 'getConversationMessages',
    })
  }

  // ---------------------------------------------------------------------------
  // Libraries
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Library
   * @description Creates a document library that agents can search through the built-in document library tool (retrieval-augmented generation). Documents uploaded to the library are automatically processed and indexed.
   * @category Libraries
   * @route POST /create-library
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"A human-readable name for the library."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description of the library's contents; helps agents decide when to search it."}
   * @paramDef {"type":"Number","label":"Chunk Size","name":"chunkSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional chunk size (in characters, 256 to 32768) used when splitting documents for indexing."}
   *
   * @returns {Object}
   * @sampleResult {"id":"lib_0684xxx","name":"Product Docs","description":"Product manuals and FAQs","chunk_size":4096,"nb_documents":0,"created_at":"2026-07-01T10:00:00Z"}
   */
  async createLibrary(name, description, chunkSize) {
    if (!name || !name.trim()) {
      throw new Error('Library name is required')
    }

    const body = { name }

    if (description) body.description = description
    if (chunkSize !== undefined) body.chunk_size = chunkSize

    return this.#apiRequest({
      url: `${ API_BASE_URL }/libraries`,
      body,
      logTag: 'createLibrary',
    })
  }

  /**
   * @operationName List Libraries
   * @description Lists all document libraries you created or that were shared with you, including document counts, total sizes, and ownership information.
   * @category Libraries
   * @route GET /list-libraries
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"lib_0684xxx","name":"Product Docs","description":"Product manuals and FAQs","nb_documents":12,"total_size":10485760,"created_at":"2026-07-01T10:00:00Z"}]}
   */
  async listLibraries() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/libraries`,
      method: 'get',
      logTag: 'listLibraries',
    })
  }

  /**
   * @operationName Upload Library Document
   * @description Uploads a document from FlowRunner file storage into a Mistral document library, where it is automatically processed and indexed for agent retrieval. Returns the created document's metadata.
   * @category Libraries
   * @route POST /upload-library-document
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Library","name":"libraryId","required":true,"dictionary":"getLibrariesDictionary","description":"The library to upload the document into."}
   * @paramDef {"type":"String","label":"File","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"The FlowRunner file to upload (its URL). The file's bytes are streamed to Mistral."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","description":"Optional name to store the document under. Defaults to the source file's name."}
   *
   * @returns {Object}
   * @sampleResult {"id":"doc_0684xxx","library_id":"lib_0684xxx","name":"manual.pdf","extension":"pdf","size":245120,"processing_status":"Processing","created_at":"2026-07-01T10:00:00Z"}
   */
  async uploadLibraryDocument(libraryId, fileUrl, fileName) {
    if (!libraryId) {
      throw new Error('Library ID is required')
    }

    const buffer = await this.#downloadBuffer(fileUrl)

    const form = new Flowrunner.Request.FormData()

    form.append('file', buffer, { filename: fileName || this.#extractFileName(fileUrl, 'document.bin') })

    return this.#apiRequest({
      url: `${ API_BASE_URL }/libraries/${ encodeURIComponent(libraryId) }/documents`,
      form,
      logTag: 'uploadLibraryDocument',
    })
  }

  /**
   * @operationName List Library Documents
   * @description Lists documents stored in a Mistral document library with pagination and optional name search. Returns each document's ID, name, size, and processing status.
   * @category Libraries
   * @route GET /list-library-documents
   *
   * @paramDef {"type":"String","label":"Library","name":"libraryId","required":true,"dictionary":"getLibrariesDictionary","description":"The library whose documents to list."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based page number. Defaults to 0."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of documents per page. Defaults to 100."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter documents by name."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"doc_0684xxx","library_id":"lib_0684xxx","name":"manual.pdf","extension":"pdf","size":245120,"processing_status":"Completed"}],"pagination":{"total_items":1,"total_pages":1,"current_page":0,"page_size":100}}
   */
  async listLibraryDocuments(libraryId, page, pageSize, search) {
    if (!libraryId) {
      throw new Error('Library ID is required')
    }

    const query = {
      page: page ?? 0,
      page_size: pageSize ?? 100,
    }

    if (search) query.search = search

    return this.#apiRequest({
      url: `${ API_BASE_URL }/libraries/${ encodeURIComponent(libraryId) }/documents`,
      method: 'get',
      query,
      logTag: 'listLibraryDocuments',
    })
  }

  // ---------------------------------------------------------------------------
  // Models
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Models
   * @description Lists all Mistral AI models available to your account, including chat, code, embedding, OCR, moderation, and audio models, with their capabilities and context window sizes.
   * @category Models
   * @route GET /list-models
   *
   * @returns {Object}
   * @sampleResult {"object":"list","data":[{"id":"mistral-medium-latest","object":"model","owned_by":"mistralai","max_context_length":131072,"capabilities":{"completion_chat":true,"vision":true,"function_calling":true}}]}
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
   * @description Retrieves detailed information about a single Mistral AI model, including its capabilities (chat, vision, function calling, fine-tuning), context window size, and aliases.
   * @category Models
   * @route GET /get-model
   *
   * @paramDef {"type":"String","label":"Model","name":"modelId","required":true,"dictionary":"getModelsDictionary","description":"The ID of the model to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"mistral-medium-latest","object":"model","owned_by":"mistralai","max_context_length":131072,"aliases":["mistral-medium-2505"],"capabilities":{"completion_chat":true,"vision":true,"function_calling":true,"fine_tuning":false}}
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

Flowrunner.ServerCode.addService(MistralAIService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Mistral AI API key. Create one in La Plateforme at https://console.mistral.ai/api-keys',
  },
])

function normalizeError(error) {
  const detail = error.body?.message || error.body?.detail || error.body?.error?.message

  if (typeof detail === 'string') {
    return detail
  }

  if (detail !== undefined) {
    return JSON.stringify(detail)
  }

  if (error.message && typeof error.message === 'object') {
    return JSON.stringify(error.message)
  }

  return error.message || 'API request failed'
}

function parsePageRanges(pages) {
  const result = []

  for (const part of pages.split(',')) {
    const trimmed = part.trim()

    if (!trimmed) {
      continue
    }

    const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/)

    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10)
      const end = parseInt(rangeMatch[2], 10)

      for (let i = start; i <= end; i++) {
        result.push(i)
      }
    } else if (/^\d+$/.test(trimmed)) {
      result.push(parseInt(trimmed, 10))
    } else {
      throw new Error(`Invalid pages value '${ trimmed }'. Use comma-separated numbers and ranges, e.g. '0,2-4'`)
    }
  }

  return result
}
