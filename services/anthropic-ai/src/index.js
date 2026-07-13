'use strict'

const API_BASE_URL = 'https://api.anthropic.com/v1'
const ANTHROPIC_VERSION = '2023-06-01'
const FILES_API_BETA = 'files-api-2025-04-14'

const DEFAULT_MODEL = 'claude-opus-4-8'
const DEFAULT_MAX_TOKENS = 4096

const MIME_TYPES = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.txt': 'text/plain',
  '.md': 'text/plain',
  '.csv': 'text/plain',
  '.json': 'application/json',
}

const EFFORT_LEVELS = {
  'Low': 'low',
  'Medium': 'medium',
  'High': 'high',
  'Extra High': 'xhigh',
  'Max': 'max',
}

const logger = {
  info: (...args) => console.log('[Anthropic Claude] info:', ...args),
  debug: (...args) => console.log('[Anthropic Claude] debug:', ...args),
  error: (...args) => console.log('[Anthropic Claude] error:', ...args),
  warn: (...args) => console.log('[Anthropic Claude] warn:', ...args),
}

/**
 * @usesFileStorage
 * @integrationName Anthropic Claude
 * @integrationIcon /icon.svg
 */
class AnthropicClaudeService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  async #apiRequest({ url, method = 'post', body, form, query, binary, beta, logTag }) {
    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }]`)

      let request = Flowrunner.Request[method](url)
        .query(query || {})
        .set({
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        })

      if (beta) {
        request.set({ 'anthropic-beta': beta })
      }

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

  #detectMimeType(url) {
    const pathname = url.split('?')[0].split('#')[0]
    const ext = ('.' + pathname.split('.').pop()).toLowerCase()

    return MIME_TYPES[ext] || 'application/octet-stream'
  }

  #extractFileName(url) {
    const pathname = url.split('?')[0].split('#')[0]

    return pathname.split('/').pop() || 'file'
  }

  async #downloadBuffer(fileUrl, logTag) {
    if (!fileUrl || !/^https?:\/\//i.test(fileUrl)) {
      throw new Error(`Invalid file URL '${ fileUrl }'. Should start with 'http://' or 'https://'`)
    }

    logger.debug(`${ logTag } - downloading file from: ${ fileUrl }`)

    const rawBytes = await Flowrunner.Request.get(fileUrl).setEncoding(null)

    return Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(rawBytes)
  }

  #extractText(content) {
    return (content || [])
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
  }

  #extractCitations(content) {
    return (content || [])
      .filter(block => block.type === 'text' && Array.isArray(block.citations))
      .flatMap(block => block.citations)
  }

  #buildThinking(thinkingMode, thinkingBudgetTokens) {
    if (thinkingMode === 'Adaptive') {
      return { type: 'adaptive' }
    }

    if (thinkingMode === 'Extended Budget') {
      return { type: 'enabled', budget_tokens: thinkingBudgetTokens || 8192 }
    }

    return undefined
  }

  /**
   * @typedef {Object} getModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by ID or display name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of models."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Models Dictionary
   * @description Provides a searchable, live list of available Claude models from the Anthropic Models API for dynamic parameter selection.
   * @route POST /get-models-dictionary
   * @paramDef {"type":"getModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Claude Opus 4.8","value":"claude-opus-4-8","note":"claude-opus-4-8"},{"label":"Claude Sonnet 4.6","value":"claude-sonnet-4-6","note":"claude-sonnet-4-6"}],"cursor":null}
   */
  async getModelsDictionary(payload) {
    const { search, cursor } = payload || {}

    const query = { limit: 100 }

    if (cursor) {
      query.after_id = cursor
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/models`,
      method: 'get',
      query,
      logTag: 'getModelsDictionary',
    })

    let models = response.data || []

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      models = models.filter(model =>
        model.id.toLowerCase().includes(searchLower) ||
        model.display_name?.toLowerCase().includes(searchLower)
      )
    }

    return {
      items: models.map(model => ({
        label: model.display_name || model.id,
        value: model.id,
        note: model.id,
      })),
      cursor: response.has_more ? response.last_id : null,
    }
  }

  /**
   * @operationName Ask Claude
   * @category Messages
   * @description Sends a single prompt to a Claude model and returns the generated text. This is the simplest way to use Claude: provide a prompt (and optionally a system instruction) and get the answer text plus token usage back. For multi-turn conversations, tool use, structured output, or thinking control, use Send Messages instead.
   * @route POST /ask-claude
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The question or instruction to send to Claude."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getModelsDictionary","defaultValue":"claude-opus-4-8","description":"The Claude model to use. Defaults to 'claude-opus-4-8'."}
   * @paramDef {"type":"String","label":"System Prompt","name":"system","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional system instruction that sets Claude's role, tone, and constraints for this request."}
   * @paramDef {"type":"Number","label":"Max Tokens","name":"maxTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens to generate. Defaults to 4096. Values above ~16000 may time out on long generations."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature between 0.0 and 1.0. Lower values are more deterministic. Note: Claude Opus 4.7+ and Fable models reject this parameter - leave it empty for those models."}
   *
   * @returns {Object}
   * @sampleResult {"text":"The capital of France is Paris.","model":"claude-opus-4-8","stopReason":"end_turn","usage":{"input_tokens":14,"output_tokens":9}}
   */
  async askClaude(prompt, model, system, maxTokens, temperature) {
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    const body = {
      model: model || DEFAULT_MODEL,
      max_tokens: maxTokens || DEFAULT_MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    }

    if (system) {
      body.system = system
    }

    if (temperature !== undefined && temperature !== null) {
      body.temperature = temperature
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/messages`,
      body,
      logTag: 'askClaude',
    })

    return {
      text: this.#extractText(response.content),
      model: response.model,
      stopReason: response.stop_reason,
      usage: response.usage,
    }
  }

  /**
   * @operationName Send Messages
   * @category Messages
   * @description Sends a full conversation to a Claude model via the Messages API with access to every advanced option: multi-turn message history, system prompt, sampling controls, stop sequences, tool definitions (function calling), structured JSON output enforced by a schema, thinking configuration (adaptive or budgeted extended thinking), and the effort level. Returns the complete API response including all content blocks (text, tool_use, thinking), stop reason, and token usage, plus a convenience 'text' field with the concatenated text output.
   * @route POST /send-messages
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getModelsDictionary","defaultValue":"claude-opus-4-8","description":"The Claude model to use. Defaults to 'claude-opus-4-8'."}
   * @paramDef {"type":"Array<Object>","label":"Messages","name":"messages","required":true,"description":"Conversation turns in Anthropic Messages format. Each item is an object like {\"role\":\"user\",\"content\":\"...\"} where content is a string or an array of content blocks (text, image, document, tool_result). The first message must have role 'user' and roles must alternate."}
   * @paramDef {"type":"Number","label":"Max Tokens","name":"maxTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens to generate. Defaults to 4096. Values above ~16000 may time out on long generations."}
   * @paramDef {"type":"String","label":"System Prompt","name":"system","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional system instruction that sets Claude's role, tone, and constraints."}
   * @paramDef {"type":"String","label":"Thinking Mode","name":"thinkingMode","uiComponent":{"type":"DROPDOWN","options":{"values":["Adaptive","Extended Budget","Off"]}},"description":"Controls Claude's internal reasoning. 'Adaptive' lets the model decide when and how much to think (recommended for Claude 4.6+). 'Extended Budget' uses a fixed thinking token budget from the Thinking Budget Tokens parameter (legacy models only - rejected by Opus 4.7+ and Fable). 'Off' or empty disables thinking."}
   * @paramDef {"type":"Number","label":"Thinking Budget Tokens","name":"thinkingBudgetTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Thinking token budget used when Thinking Mode is 'Extended Budget'. Must be at least 1024 and less than Max Tokens. Ignored for other thinking modes."}
   * @paramDef {"type":"String","label":"Effort","name":"effort","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Medium","High","Extra High","Max"]}},"description":"Controls thinking depth and overall token spend on models that support it (Claude Opus 4.5+ and Sonnet 4.6). 'Extra High' and 'Max' are Opus-tier options. Leave empty for the model default (High)."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature between 0.0 and 1.0. Note: Claude Opus 4.7+ and Fable models reject sampling parameters - leave empty for those models."}
   * @paramDef {"type":"Number","label":"Top P","name":"topP","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Nucleus sampling threshold. Use either Temperature or Top P, not both. Rejected by Claude Opus 4.7+ and Fable models."}
   * @paramDef {"type":"Number","label":"Top K","name":"topK","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Only sample from the top K token options at each step. Rejected by Claude Opus 4.7+ and Fable models."}
   * @paramDef {"type":"Array<String>","label":"Stop Sequences","name":"stopSequences","description":"Custom text sequences that cause the model to stop generating when produced."}
   * @paramDef {"type":"Array<Object>","label":"Tools","name":"tools","description":"Tool definitions in Anthropic format, each with name, description, and input_schema (JSON Schema). Server-side tools like {\"type\":\"web_search_20260209\",\"name\":\"web_search\"} are also accepted. When Claude calls a tool, the response contains tool_use content blocks."}
   * @paramDef {"type":"Object","label":"Tool Choice","name":"toolChoice","freeform":true,"uiComponent":{"type":"CODE_EDITOR","language":"json"},"description":"Controls how Claude uses the provided tools, e.g. {\"type\":\"auto\"}, {\"type\":\"any\"}, or {\"type\":\"tool\",\"name\":\"my_tool\"}."}
   * @paramDef {"type":"Object","label":"JSON Output Schema","name":"jsonSchema","freeform":true,"uiComponent":{"type":"CODE_EDITOR","language":"json"},"description":"Optional JSON Schema for structured output. When provided, the response text is guaranteed to be valid JSON matching this schema (sent as output_config.format with type 'json_schema'). All object schemas must set additionalProperties to false."}
   *
   * @returns {Object}
   * @sampleResult {"id":"msg_01XFDUDYJgAACzvnptvVoYEL","type":"message","role":"assistant","model":"claude-opus-4-8","content":[{"type":"text","text":"Here is the analysis you requested..."}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":2095,"output_tokens":503},"text":"Here is the analysis you requested..."}
   */
  async sendMessages(model, messages, maxTokens, system, thinkingMode, thinkingBudgetTokens, effort,
    temperature, topP, topK, stopSequences, tools, toolChoice, jsonSchema) {
    if (!Array.isArray(messages) || !messages.length) {
      throw new Error('Messages is required and must be a non-empty array')
    }

    const body = {
      model: model || DEFAULT_MODEL,
      max_tokens: maxTokens || DEFAULT_MAX_TOKENS,
      messages,
    }

    if (system) {
      body.system = system
    }

    const thinking = this.#buildThinking(thinkingMode, thinkingBudgetTokens)

    if (thinking) {
      body.thinking = thinking
    }

    const outputConfig = {}
    const resolvedEffort = this.#resolveChoice(effort, EFFORT_LEVELS)

    if (resolvedEffort) {
      outputConfig.effort = resolvedEffort
    }

    if (jsonSchema && Object.keys(jsonSchema).length) {
      outputConfig.format = { type: 'json_schema', schema: jsonSchema }
    }

    if (Object.keys(outputConfig).length) {
      body.output_config = outputConfig
    }

    if (temperature !== undefined && temperature !== null) {
      body.temperature = temperature
    }

    if (topP !== undefined && topP !== null) {
      body.top_p = topP
    }

    if (topK !== undefined && topK !== null) {
      body.top_k = topK
    }

    if (Array.isArray(stopSequences) && stopSequences.length) {
      body.stop_sequences = stopSequences
    }

    if (Array.isArray(tools) && tools.length) {
      body.tools = tools
    }

    if (toolChoice && Object.keys(toolChoice).length) {
      body.tool_choice = toolChoice
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/messages`,
      body,
      logTag: 'sendMessages',
    })

    return {
      ...response,
      text: this.#extractText(response.content),
    }
  }

  /**
   * @operationName Analyze Image
   * @category Messages
   * @description Analyzes an image with a Claude vision model and returns the text answer. Provide the image as a FlowRunner file, a publicly accessible URL, or an Anthropic Files API file ID (exactly one source is required). Supports JPEG, PNG, GIF, and WebP images up to 5 MB (base64) / 30 MB (URL).
   * @route POST /analyze-image
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The question or instruction about the image, e.g. 'Describe this image' or 'Extract all visible text'."}
   * @paramDef {"type":"String","label":"Image File","name":"imageFile","uiComponent":{"type":"FILE_SELECTOR"},"description":"A FlowRunner file to analyze (its URL). The file's bytes are downloaded and sent to Claude as base64. Use this OR Image URL OR Anthropic File ID."}
   * @paramDef {"type":"String","label":"Image URL","name":"imageUrl","description":"Publicly accessible URL of the image. Anthropic fetches the image directly from this URL. Use this OR Image File OR Anthropic File ID."}
   * @paramDef {"type":"String","label":"Anthropic File ID","name":"fileId","description":"ID of an image previously uploaded via the Upload File action (e.g. 'file_011CNha8iCJcU1wXNR6q4V8w'). Use this OR Image File OR Image URL."}
   * @paramDef {"type":"String","label":"Media Type","name":"mediaType","description":"MIME type of the image when using Image File (e.g. 'image/png'). Auto-detected from the file extension if not provided."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getModelsDictionary","defaultValue":"claude-opus-4-8","description":"The Claude model to use. All current Claude models support vision. Defaults to 'claude-opus-4-8'."}
   * @paramDef {"type":"Number","label":"Max Tokens","name":"maxTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens to generate. Defaults to 4096."}
   * @paramDef {"type":"String","label":"System Prompt","name":"system","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional system instruction that sets Claude's role and constraints."}
   *
   * @returns {Object}
   * @sampleResult {"text":"The image shows a bar chart of quarterly revenue. Q4 is the highest at $2.4M.","model":"claude-opus-4-8","stopReason":"end_turn","usage":{"input_tokens":1420,"output_tokens":34}}
   */
  async analyzeImage(prompt, imageFile, imageUrl, fileId, mediaType, model, maxTokens, system) {
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    const sources = [imageFile, imageUrl, fileId].filter(Boolean)

    if (sources.length !== 1) {
      throw new Error('Provide exactly one image source: Image File, Image URL, or Anthropic File ID')
    }

    let imageSource

    if (imageFile) {
      const buffer = await this.#downloadBuffer(imageFile, 'analyzeImage')

      imageSource = {
        type: 'base64',
        media_type: mediaType || this.#detectMimeType(imageFile),
        data: buffer.toString('base64'),
      }
    } else if (imageUrl) {
      imageSource = { type: 'url', url: imageUrl }
    } else {
      imageSource = { type: 'file', file_id: fileId }
    }

    const body = {
      model: model || DEFAULT_MODEL,
      max_tokens: maxTokens || DEFAULT_MAX_TOKENS,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: imageSource },
          { type: 'text', text: prompt },
        ],
      }],
    }

    if (system) {
      body.system = system
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/messages`,
      body,
      beta: fileId ? FILES_API_BETA : undefined,
      logTag: 'analyzeImage',
    })

    return {
      text: this.#extractText(response.content),
      model: response.model,
      stopReason: response.stop_reason,
      usage: response.usage,
    }
  }

  /**
   * @operationName Analyze Document
   * @category Messages
   * @description Analyzes a PDF or plain-text document with a Claude model and returns the text answer. Provide the document as a FlowRunner file, a publicly accessible URL, or an Anthropic Files API file ID (exactly one source is required). Claude reads both the text and any charts, tables, or images inside PDFs. Optionally enables citations so the answer references the exact document passages it is based on. PDFs are limited to 100 pages / 32 MB per request.
   * @route POST /analyze-document
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The question or instruction about the document, e.g. 'Summarize the key findings' or 'Extract the invoice total'."}
   * @paramDef {"type":"String","label":"Document File","name":"documentFile","uiComponent":{"type":"FILE_SELECTOR"},"description":"A FlowRunner file to analyze (its URL). The file's bytes are downloaded and sent to Claude as base64. Use this OR Document URL OR Anthropic File ID."}
   * @paramDef {"type":"String","label":"Document URL","name":"documentUrl","description":"Publicly accessible URL of the PDF. Anthropic fetches the document directly from this URL. Use this OR Document File OR Anthropic File ID."}
   * @paramDef {"type":"String","label":"Anthropic File ID","name":"fileId","description":"ID of a document previously uploaded via the Upload File action (e.g. 'file_011CNha8iCJcU1wXNR6q4V8w'). Use this OR Document File OR Document URL."}
   * @paramDef {"type":"Boolean","label":"Enable Citations","name":"enableCitations","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the response includes citations pointing to the exact passages in the document that support each claim."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getModelsDictionary","defaultValue":"claude-opus-4-8","description":"The Claude model to use. Defaults to 'claude-opus-4-8'."}
   * @paramDef {"type":"Number","label":"Max Tokens","name":"maxTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens to generate. Defaults to 4096."}
   * @paramDef {"type":"String","label":"System Prompt","name":"system","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional system instruction that sets Claude's role and constraints."}
   *
   * @returns {Object}
   * @sampleResult {"text":"The report concludes that revenue grew 18% year over year, driven primarily by the enterprise segment.","citations":[{"type":"page_location","cited_text":"revenue grew 18% YoY","document_index":0,"start_page_number":3,"end_page_number":3}],"model":"claude-opus-4-8","stopReason":"end_turn","usage":{"input_tokens":8210,"output_tokens":61}}
   */
  async analyzeDocument(prompt, documentFile, documentUrl, fileId, enableCitations, model, maxTokens, system) {
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    const sources = [documentFile, documentUrl, fileId].filter(Boolean)

    if (sources.length !== 1) {
      throw new Error('Provide exactly one document source: Document File, Document URL, or Anthropic File ID')
    }

    let documentSource

    if (documentFile) {
      const buffer = await this.#downloadBuffer(documentFile, 'analyzeDocument')

      documentSource = {
        type: 'base64',
        media_type: 'application/pdf',
        data: buffer.toString('base64'),
      }
    } else if (documentUrl) {
      documentSource = { type: 'url', url: documentUrl }
    } else {
      documentSource = { type: 'file', file_id: fileId }
    }

    const documentBlock = { type: 'document', source: documentSource }

    if (enableCitations) {
      documentBlock.citations = { enabled: true }
    }

    const body = {
      model: model || DEFAULT_MODEL,
      max_tokens: maxTokens || DEFAULT_MAX_TOKENS,
      messages: [{
        role: 'user',
        content: [
          documentBlock,
          { type: 'text', text: prompt },
        ],
      }],
    }

    if (system) {
      body.system = system
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/messages`,
      body,
      beta: fileId ? FILES_API_BETA : undefined,
      logTag: 'analyzeDocument',
    })

    return {
      text: this.#extractText(response.content),
      citations: this.#extractCitations(response.content),
      model: response.model,
      stopReason: response.stop_reason,
      usage: response.usage,
    }
  }

  /**
   * @operationName Count Tokens
   * @category Messages
   * @description Counts how many input tokens a request would consume for a specific Claude model, without running it. Token counts are model-specific. Provide either a full messages array or a simple prompt string, plus optional system prompt and tool definitions. Useful for estimating cost or checking that content fits within the context window before sending.
   * @route POST /count-tokens
   *
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getModelsDictionary","defaultValue":"claude-opus-4-8","description":"The Claude model to count tokens for. Counts differ between models. Defaults to 'claude-opus-4-8'."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text to count as a single user message. Use this OR Messages."}
   * @paramDef {"type":"Array<Object>","label":"Messages","name":"messages","description":"Full conversation in Anthropic Messages format to count. Use this OR Prompt."}
   * @paramDef {"type":"String","label":"System Prompt","name":"system","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional system instruction to include in the count."}
   * @paramDef {"type":"Array<Object>","label":"Tools","name":"tools","description":"Optional tool definitions to include in the count, in Anthropic format."}
   *
   * @returns {Object}
   * @sampleResult {"input_tokens":2095}
   */
  async countTokens(model, prompt, messages, system, tools) {
    let resolvedMessages = messages

    if (!Array.isArray(resolvedMessages) || !resolvedMessages.length) {
      if (!prompt || !prompt.trim()) {
        throw new Error('Either Prompt or Messages is required')
      }

      resolvedMessages = [{ role: 'user', content: prompt }]
    }

    const body = {
      model: model || DEFAULT_MODEL,
      messages: resolvedMessages,
    }

    if (system) {
      body.system = system
    }

    if (Array.isArray(tools) && tools.length) {
      body.tools = tools
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/messages/count_tokens`,
      body,
      logTag: 'countTokens',
    })
  }

  /**
   * @operationName Create Message Batch
   * @category Message Batches
   * @description Creates a Message Batch that processes up to 100,000 Messages API requests asynchronously at 50% of standard token prices. Each request needs a unique custom_id (1-64 alphanumeric/hyphen/underscore characters) and a params object with the standard Messages API fields (model, max_tokens, messages, etc.). Most batches finish within 1 hour; poll with Get Message Batch and fetch output with Get Message Batch Results once the processing status is 'ended'.
   * @route POST /create-batch
   *
   * @paramDef {"type":"Array<Object>","label":"Requests","name":"requests","required":true,"description":"Batch requests. Each item is {\"custom_id\":\"my-request-1\",\"params\":{\"model\":\"claude-opus-4-8\",\"max_tokens\":1024,\"messages\":[{\"role\":\"user\",\"content\":\"...\"}]}}."}
   *
   * @returns {Object}
   * @sampleResult {"id":"msgbatch_01HkcTjaV5uDC8jWR4ZsDV8d","type":"message_batch","processing_status":"in_progress","request_counts":{"processing":2,"succeeded":0,"errored":0,"canceled":0,"expired":0},"created_at":"2026-07-13T18:37:24.100435Z","expires_at":"2026-07-14T18:37:24.100435Z","results_url":null}
   */
  async createBatch(requests) {
    if (!Array.isArray(requests) || !requests.length) {
      throw new Error('Requests is required and must be a non-empty array')
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/messages/batches`,
      body: { requests },
      logTag: 'createBatch',
    })
  }

  /**
   * @operationName Get Message Batch
   * @category Message Batches
   * @description Retrieves the current state of a Message Batch, including its processing status ('in_progress', 'canceling', or 'ended'), per-request counts (processing, succeeded, errored, canceled, expired), and the results URL once processing has ended. Poll this action until processing_status is 'ended', then call Get Message Batch Results.
   * @route GET /get-batch
   *
   * @paramDef {"type":"String","label":"Batch ID","name":"batchId","required":true,"description":"The ID of the Message Batch (e.g. 'msgbatch_01HkcTjaV5uDC8jWR4ZsDV8d')."}
   *
   * @returns {Object}
   * @sampleResult {"id":"msgbatch_01HkcTjaV5uDC8jWR4ZsDV8d","type":"message_batch","processing_status":"ended","request_counts":{"processing":0,"succeeded":2,"errored":0,"canceled":0,"expired":0},"created_at":"2026-07-13T18:37:24.100435Z","ended_at":"2026-07-13T18:52:08.100435Z","results_url":"https://api.anthropic.com/v1/messages/batches/msgbatch_01HkcTjaV5uDC8jWR4ZsDV8d/results"}
   */
  async getBatch(batchId) {
    if (!batchId) {
      throw new Error('Batch ID is required')
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/messages/batches/${ encodeURIComponent(batchId) }`,
      method: 'get',
      logTag: 'getBatch',
    })
  }

  /**
   * @operationName List Message Batches
   * @category Message Batches
   * @description Lists Message Batches in the workspace, most recently created first, with cursor-based pagination. Returns each batch's ID, processing status, request counts, and timestamps.
   * @route GET /list-batches
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of batches to return per page (1-100). Defaults to 20."}
   * @paramDef {"type":"String","label":"After ID","name":"afterId","description":"Return the page of results immediately after this batch ID (for forward pagination)."}
   * @paramDef {"type":"String","label":"Before ID","name":"beforeId","description":"Return the page of results immediately before this batch ID (for backward pagination)."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"msgbatch_01HkcTjaV5uDC8jWR4ZsDV8d","type":"message_batch","processing_status":"ended","request_counts":{"processing":0,"succeeded":2,"errored":0,"canceled":0,"expired":0},"created_at":"2026-07-13T18:37:24.100435Z"}],"has_more":false,"first_id":"msgbatch_01HkcTjaV5uDC8jWR4ZsDV8d","last_id":"msgbatch_01HkcTjaV5uDC8jWR4ZsDV8d"}
   */
  async listBatches(limit, afterId, beforeId) {
    const query = {}

    if (limit) {
      query.limit = limit
    }

    if (afterId) {
      query.after_id = afterId
    }

    if (beforeId) {
      query.before_id = beforeId
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/messages/batches`,
      method: 'get',
      query,
      logTag: 'listBatches',
    })
  }

  /**
   * @operationName Cancel Message Batch
   * @category Message Batches
   * @description Cancels a Message Batch that is currently processing. The batch moves to 'canceling' and then ends; requests already processed before cancellation still produce results (and are billed), while unprocessed requests are marked canceled and not billed.
   * @route POST /cancel-batch
   *
   * @paramDef {"type":"String","label":"Batch ID","name":"batchId","required":true,"description":"The ID of the Message Batch to cancel (e.g. 'msgbatch_01HkcTjaV5uDC8jWR4ZsDV8d')."}
   *
   * @returns {Object}
   * @sampleResult {"id":"msgbatch_01HkcTjaV5uDC8jWR4ZsDV8d","type":"message_batch","processing_status":"canceling","request_counts":{"processing":1,"succeeded":1,"errored":0,"canceled":0,"expired":0},"cancel_initiated_at":"2026-07-13T18:40:00.100435Z"}
   */
  async cancelBatch(batchId) {
    if (!batchId) {
      throw new Error('Batch ID is required')
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/messages/batches/${ encodeURIComponent(batchId) }/cancel`,
      body: {},
      logTag: 'cancelBatch',
    })
  }

  /**
   * @operationName Get Message Batch Results
   * @category Message Batches
   * @description Downloads and parses the results of an ended Message Batch. Each result contains the original custom_id and a result object whose type is 'succeeded' (with the full Messages API response), 'errored', 'canceled', or 'expired'. Results may be in any order - match them to inputs by custom_id. Throws an error if the batch has not finished processing yet. Batch results are available for 29 days after creation.
   * @route GET /get-batch-results
   *
   * @executionTimeoutInSeconds 180
   *
   * @paramDef {"type":"String","label":"Batch ID","name":"batchId","required":true,"description":"The ID of the ended Message Batch (e.g. 'msgbatch_01HkcTjaV5uDC8jWR4ZsDV8d')."}
   *
   * @returns {Object}
   * @sampleResult {"processingStatus":"ended","requestCounts":{"processing":0,"succeeded":2,"errored":0,"canceled":0,"expired":0},"results":[{"custom_id":"my-request-1","result":{"type":"succeeded","message":{"id":"msg_014VwiXbi91y3JMjcpyGBHX5","role":"assistant","content":[{"type":"text","text":"Hello!"}],"stop_reason":"end_turn","usage":{"input_tokens":11,"output_tokens":6}}}}]}
   */
  async getBatchResults(batchId) {
    const batch = await this.getBatch(batchId)

    if (!batch.results_url) {
      throw new Error(
        `Batch results are not available yet (processing status: '${ batch.processing_status }'). ` +
        'Poll Get Message Batch until the processing status is \'ended\'.'
      )
    }

    const rawResults = await this.#apiRequest({
      url: batch.results_url,
      method: 'get',
      binary: true,
      logTag: 'getBatchResults',
    })

    const text = Buffer.isBuffer(rawResults) ? rawResults.toString('utf8') : String(rawResults)

    const results = text
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line))

    return {
      processingStatus: batch.processing_status,
      requestCounts: batch.request_counts,
      results,
    }
  }

  /**
   * @operationName Upload File
   * @category Files
   * @description Uploads a file from FlowRunner file storage (or any accessible URL) to the Anthropic Files API and returns its file_id. Uploaded files can then be referenced in Analyze Image, Analyze Document, or Send Messages without re-sending the bytes each time. Supports PDFs and text files (document blocks), JPEG/PNG/GIF/WebP images (image blocks), and datasets for the code execution tool. Maximum file size is 500 MB.
   * @route POST /upload-file
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"File","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"The FlowRunner file to upload (its URL). The file's bytes are downloaded and streamed to Anthropic."}
   * @paramDef {"type":"String","label":"Filename","name":"filename","description":"Filename to store with the uploaded file (1-255 characters). Defaults to the original filename from the URL."}
   * @paramDef {"type":"String","label":"MIME Type","name":"mimeType","description":"MIME type of the file (e.g. 'application/pdf', 'image/png', 'text/plain'). Auto-detected from the file extension if not provided."}
   *
   * @returns {Object}
   * @sampleResult {"id":"file_011CNha8iCJcU1wXNR6q4V8w","type":"file","filename":"report.pdf","mime_type":"application/pdf","size_bytes":1024000,"created_at":"2026-07-13T18:37:24.100435Z","downloadable":false}
   */
  async uploadFile(fileUrl, filename, mimeType) {
    const buffer = await this.#downloadBuffer(fileUrl, 'uploadFile')

    const form = new Flowrunner.Request.FormData()

    form.append('file', buffer, {
      filename: filename || this.#extractFileName(fileUrl),
      contentType: mimeType || this.#detectMimeType(fileUrl),
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/files`,
      form,
      beta: FILES_API_BETA,
      logTag: 'uploadFile',
    })
  }

  /**
   * @operationName List Files
   * @category Files
   * @description Lists files stored in the Anthropic Files API workspace with cursor-based pagination. Returns each file's ID, filename, MIME type, size, creation time, and whether it is downloadable (only files created by Claude's skills or code execution tool are downloadable).
   * @route GET /list-files
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of files to return per page (1-100). Defaults to 20."}
   * @paramDef {"type":"String","label":"After ID","name":"afterId","description":"Return the page of results immediately after this file ID (for forward pagination)."}
   * @paramDef {"type":"String","label":"Before ID","name":"beforeId","description":"Return the page of results immediately before this file ID (for backward pagination)."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"file_011CNha8iCJcU1wXNR6q4V8w","type":"file","filename":"report.pdf","mime_type":"application/pdf","size_bytes":1024000,"created_at":"2026-07-13T18:37:24.100435Z","downloadable":false}],"has_more":false,"first_id":"file_011CNha8iCJcU1wXNR6q4V8w","last_id":"file_011CNha8iCJcU1wXNR6q4V8w"}
   */
  async listFiles(limit, afterId, beforeId) {
    const query = {}

    if (limit) {
      query.limit = limit
    }

    if (afterId) {
      query.after_id = afterId
    }

    if (beforeId) {
      query.before_id = beforeId
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/files`,
      method: 'get',
      query,
      beta: FILES_API_BETA,
      logTag: 'listFiles',
    })
  }

  /**
   * @operationName Get File Metadata
   * @category Files
   * @description Retrieves metadata for a file stored in the Anthropic Files API: filename, MIME type, size in bytes, creation time, and whether the file's content can be downloaded.
   * @route GET /get-file-metadata
   *
   * @paramDef {"type":"String","label":"File ID","name":"fileId","required":true,"description":"The ID of the file (e.g. 'file_011CNha8iCJcU1wXNR6q4V8w')."}
   *
   * @returns {Object}
   * @sampleResult {"id":"file_011CNha8iCJcU1wXNR6q4V8w","type":"file","filename":"report.pdf","mime_type":"application/pdf","size_bytes":1024000,"created_at":"2026-07-13T18:37:24.100435Z","downloadable":false}
   */
  async getFileMetadata(fileId) {
    if (!fileId) {
      throw new Error('File ID is required')
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/files/${ encodeURIComponent(fileId) }`,
      method: 'get',
      beta: FILES_API_BETA,
      logTag: 'getFileMetadata',
    })
  }

  /**
   * @operationName Download File
   * @category Files
   * @description Downloads a file's content from the Anthropic Files API and saves it to FlowRunner file storage, returning the stored file's URL. Only files created by Claude (via skills or the code execution tool, marked downloadable in their metadata) can be downloaded - the API rejects downloads of files you uploaded yourself.
   * @route POST /download-file
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"File ID","name":"fileId","required":true,"description":"The ID of the downloadable file (e.g. 'file_011CNha8iCJcU1wXNR6q4V8w'). Generated-file IDs appear in code execution tool results."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for the saved file. Scope controls where the file lives: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"fileURL":"https://example.com/files/automation/tmp/chart.png","filename":"chart.png","sizeBytes":48213}
   */
  async downloadFile(fileId, fileOptions) {
    if (!fileId) {
      throw new Error('File ID is required')
    }

    const metadata = await this.getFileMetadata(fileId)

    const fileBytes = await this.#apiRequest({
      url: `${ API_BASE_URL }/files/${ encodeURIComponent(fileId) }/content`,
      method: 'get',
      binary: true,
      beta: FILES_API_BETA,
      logTag: 'downloadFile',
    })

    const buffer = Buffer.isBuffer(fileBytes) ? fileBytes : Buffer.from(fileBytes)
    const filename = metadata.filename || `claude_file_${ Date.now() }`

    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return {
      fileURL: url,
      filename,
      sizeBytes: metadata.size_bytes,
    }
  }

  /**
   * @operationName Delete File
   * @category Files
   * @description Permanently deletes a file from the Anthropic Files API. Deleted files cannot be recovered and can no longer be referenced in Messages requests.
   * @route DELETE /delete-file
   *
   * @paramDef {"type":"String","label":"File ID","name":"fileId","required":true,"description":"The ID of the file to delete (e.g. 'file_011CNha8iCJcU1wXNR6q4V8w')."}
   *
   * @returns {Object}
   * @sampleResult {"id":"file_011CNha8iCJcU1wXNR6q4V8w","type":"file_deleted"}
   */
  async deleteFile(fileId) {
    if (!fileId) {
      throw new Error('File ID is required')
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/files/${ encodeURIComponent(fileId) }`,
      method: 'delete',
      beta: FILES_API_BETA,
      logTag: 'deleteFile',
    })
  }

  /**
   * @operationName List Models
   * @category Models
   * @description Lists Claude models currently available to the API key, most recent first, with cursor-based pagination. Each entry includes the model ID (used in Messages requests), display name, and creation date.
   * @route GET /list-models
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of models to return per page (1-1000). Defaults to 20."}
   * @paramDef {"type":"String","label":"After ID","name":"afterId","description":"Return the page of results immediately after this model ID (for forward pagination)."}
   * @paramDef {"type":"String","label":"Before ID","name":"beforeId","description":"Return the page of results immediately before this model ID (for backward pagination)."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"type":"model","id":"claude-opus-4-8","display_name":"Claude Opus 4.8","created_at":"2026-05-01T00:00:00Z"},{"type":"model","id":"claude-sonnet-4-6","display_name":"Claude Sonnet 4.6","created_at":"2025-11-14T00:00:00Z"}],"has_more":false,"first_id":"claude-opus-4-8","last_id":"claude-sonnet-4-6"}
   */
  async listModels(limit, afterId, beforeId) {
    const query = {}

    if (limit) {
      query.limit = limit
    }

    if (afterId) {
      query.after_id = afterId
    }

    if (beforeId) {
      query.before_id = beforeId
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/models`,
      method: 'get',
      query,
      logTag: 'listModels',
    })
  }

  /**
   * @operationName Get Model
   * @category Models
   * @description Retrieves details for a specific Claude model, including its ID, display name, creation date, context window and output limits, and capability flags (vision, thinking modes, effort levels, structured outputs) where exposed by the API. Accepts model aliases such as 'claude-opus-4-8'.
   * @route GET /get-model
   *
   * @paramDef {"type":"String","label":"Model","name":"modelId","required":true,"dictionary":"getModelsDictionary","description":"The model ID or alias to look up (e.g. 'claude-opus-4-8')."}
   *
   * @returns {Object}
   * @sampleResult {"type":"model","id":"claude-opus-4-8","display_name":"Claude Opus 4.8","created_at":"2026-05-01T00:00:00Z"}
   */
  async getModel(modelId) {
    if (!modelId) {
      throw new Error('Model is required')
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/models/${ encodeURIComponent(modelId) }`,
      method: 'get',
      logTag: 'getModel',
    })
  }
}

Flowrunner.ServerCode.addService(AnthropicClaudeService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Anthropic API key from https://platform.claude.com/settings/keys',
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
