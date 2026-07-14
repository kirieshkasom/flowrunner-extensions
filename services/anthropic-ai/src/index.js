'use strict'

const API_BASE_URL = 'https://api.anthropic.com/v1'
const ANTHROPIC_VERSION = '2023-06-01'
const FILES_API_BETA = 'files-api-2025-04-14'
const MANAGED_AGENTS_BETA = 'managed-agents-2026-04-01'
const SESSION_FILES_BETA = `${ FILES_API_BETA },${ MANAGED_AGENTS_BETA }`

const DEFAULT_MODEL = 'claude-opus-4-8'
const DEFAULT_MAX_TOKENS = 4096
const AGENT_TOOLSET_TYPE = 'agent_toolset_20260401'

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

const NETWORKING_TYPES = {
  'Unrestricted': 'unrestricted',
  'Limited': 'limited',
}

const TOOL_CONFIRMATION_RESULTS = {
  'Allow': 'allow',
  'Deny': 'deny',
}

const SESSION_EVENT_TYPES = {
  'Agent Message': 'agent.message',
  'Agent Thinking': 'agent.thinking',
  'Agent Tool Use': 'agent.tool_use',
  'Agent Tool Result': 'agent.tool_result',
  'Agent MCP Tool Use': 'agent.mcp_tool_use',
  'Agent MCP Tool Result': 'agent.mcp_tool_result',
  'Agent Custom Tool Use': 'agent.custom_tool_use',
  'Session Idle': 'session.status_idle',
  'Session Running': 'session.status_running',
  'Session Terminated': 'session.status_terminated',
  'Session Error': 'session.error',
  'User Message': 'user.message',
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
 * @integrationTriggersScope SINGLE_APP
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

  #buildListQuery(limit, afterId, beforeId) {
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

    return query
  }

  #buildAgentBody(name, model, systemPrompt, description, enableAgentToolset, advancedTools, mcpServers, metadata) {
    if (!name || !name.trim()) {
      throw new Error('Name is required')
    }

    const body = {
      name,
      model: model || DEFAULT_MODEL,
    }

    if (systemPrompt) {
      body.system = systemPrompt
    }

    if (description) {
      body.description = description
    }

    const tools = []

    if (enableAgentToolset !== false) {
      tools.push({ type: AGENT_TOOLSET_TYPE })
    }

    if (Array.isArray(advancedTools) && advancedTools.length) {
      tools.push(...advancedTools)
    }

    if (tools.length) {
      body.tools = tools
    }

    if (Array.isArray(mcpServers) && mcpServers.length) {
      body.mcp_servers = mcpServers
    }

    if (metadata && Object.keys(metadata).length) {
      body.metadata = metadata
    }

    return body
  }

  async #sendSessionEvents(sessionId, events, logTag) {
    if (!sessionId) {
      throw new Error('Session ID is required')
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/sessions/${ encodeURIComponent(sessionId) }/events`,
      body: { events },
      beta: MANAGED_AGENTS_BETA,
      logTag,
    })
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

  // ==========================================================================
  //  MANAGED AGENTS (beta) - Dictionaries
  // ==========================================================================

  /**
   * @typedef {Object} getAgentsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter agents by name or ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of agents."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Agents Dictionary
   * @description Provides a searchable list of Managed Agents from the Anthropic Agents API for dynamic parameter selection.
   * @route POST /get-agents-dictionary
   * @paramDef {"type":"getAgentsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering agents."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Research Agent","value":"agent_01ABC123def456","note":"claude-opus-4-8"}],"cursor":null}
   */
  async getAgentsDictionary(payload) {
    const { search, cursor } = payload || {}

    const query = { limit: 100 }

    if (cursor) {
      query.after_id = cursor
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/agents`,
      method: 'get',
      query,
      beta: MANAGED_AGENTS_BETA,
      logTag: 'getAgentsDictionary',
    })

    let agents = response.data || []

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      agents = agents.filter(agent =>
        agent.name?.toLowerCase().includes(searchLower) ||
        agent.id.toLowerCase().includes(searchLower)
      )
    }

    return {
      items: agents.map(agent => ({
        label: agent.name || agent.id,
        value: agent.id,
        note: typeof agent.model === 'string' ? agent.model : agent.model?.id || agent.id,
      })),
      cursor: response.has_more ? response.last_id : null,
    }
  }

  /**
   * @typedef {Object} getEnvironmentsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter environments by name or ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of environments."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Environments Dictionary
   * @description Provides a searchable list of Managed Agents environments from the Anthropic Environments API for dynamic parameter selection.
   * @route POST /get-environments-dictionary
   * @paramDef {"type":"getEnvironmentsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering environments."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"default-cloud","value":"env_01ABC123def456","note":"cloud"}],"cursor":null}
   */
  async getEnvironmentsDictionary(payload) {
    const { search, cursor } = payload || {}

    const query = { limit: 100 }

    if (cursor) {
      query.after_id = cursor
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/environments`,
      method: 'get',
      query,
      beta: MANAGED_AGENTS_BETA,
      logTag: 'getEnvironmentsDictionary',
    })

    let environments = response.data || []

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      environments = environments.filter(environment =>
        environment.name?.toLowerCase().includes(searchLower) ||
        environment.id.toLowerCase().includes(searchLower)
      )
    }

    return {
      items: environments.map(environment => ({
        label: environment.name || environment.id,
        value: environment.id,
        note: environment.config?.type || environment.id,
      })),
      cursor: response.has_more ? response.last_id : null,
    }
  }

  /**
   * @typedef {Object} getSessionsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter sessions by title or ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of sessions."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Sessions Dictionary
   * @description Provides a searchable list of Managed Agents sessions from the Anthropic Sessions API for dynamic parameter selection. Each option shows the session title (or ID) with its current status as a note.
   * @route POST /get-sessions-dictionary
   * @paramDef {"type":"getSessionsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering sessions."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Quarterly report","value":"sesn_011CZxAbc123","note":"idle"}],"cursor":null}
   */
  async getSessionsDictionary(payload) {
    const { search, cursor } = payload || {}

    const query = { limit: 100 }

    if (cursor) {
      query.after_id = cursor
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/sessions`,
      method: 'get',
      query,
      beta: MANAGED_AGENTS_BETA,
      logTag: 'getSessionsDictionary',
    })

    let sessions = response.data || []

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      sessions = sessions.filter(session =>
        session.title?.toLowerCase().includes(searchLower) ||
        session.id.toLowerCase().includes(searchLower)
      )
    }

    return {
      items: sessions.map(session => ({
        label: session.title || session.id,
        value: session.id,
        note: session.status || session.id,
      })),
      cursor: response.has_more ? response.last_id : null,
    }
  }

  // ==========================================================================
  //  MANAGED AGENTS (beta) - Agents
  // ==========================================================================

  /**
   * @operationName Create Agent
   * @category Agents
   * @description Creates a persisted, versioned Managed Agent (beta) that defines the agent's model, system prompt, and tools. Create the agent once and reference its ID in Create Session for every run - do not create a new agent per run. By default the agent gets the built-in agent toolset (bash, read, write, edit, glob, grep, web_fetch, web_search); disable it or add custom/MCP toolsets via the advanced parameters. Name must be 1-256 characters.
   * @route POST /create-agent
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Human-readable agent name (1-256 characters)."}
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getModelsDictionary","defaultValue":"claude-opus-4-8","description":"The Claude model the agent runs on. Defaults to 'claude-opus-4-8'."}
   * @paramDef {"type":"String","label":"System Prompt","name":"systemPrompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"System prompt that defines the agent's behavior and persona (up to 100,000 characters)."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Description of what the agent does (up to 2048 characters)."}
   * @paramDef {"type":"Boolean","label":"Enable Agent Toolset","name":"enableAgentToolset","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"When enabled (default), the agent gets the built-in agent toolset: bash, read, write, edit, glob, grep, web_fetch, and web_search."}
   * @paramDef {"type":"Array<Object>","label":"Advanced Tools","name":"advancedTools","description":"Additional tool definitions appended to the tools array. Supports custom client-side tools like {\"type\":\"custom\",\"name\":\"run_tests\",\"description\":\"...\",\"input_schema\":{...}} and MCP toolsets like {\"type\":\"mcp_toolset\",\"mcp_server_name\":\"github\"}. Maximum 128 tools per agent."}
   * @paramDef {"type":"Array<Object>","label":"MCP Servers","name":"mcpServers","description":"MCP server connections in Anthropic format, e.g. [{\"type\":\"url\",\"name\":\"github\",\"url\":\"https://api.githubcopilot.com/mcp/\"}]. Declare servers here (no auth) and reference them from Advanced Tools with an mcp_toolset entry. Maximum 20 servers with unique names."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","freeform":true,"uiComponent":{"type":"CODE_EDITOR","language":"json"},"description":"Arbitrary key-value pairs stored with the agent (max 16 pairs, keys up to 64 chars, values up to 512 chars)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"agent_01ABC123def456","type":"agent","name":"Research Agent","model":"claude-opus-4-8","system":"You are a research assistant.","tools":[{"type":"agent_toolset_20260401"}],"version":1772585501101368000,"created_at":"2026-07-13T18:37:24.100435Z","updated_at":"2026-07-13T18:37:24.100435Z"}
   */
  async createAgent(name, model, systemPrompt, description, enableAgentToolset, advancedTools, mcpServers, metadata) {
    const body = this.#buildAgentBody(name, model, systemPrompt, description, enableAgentToolset, advancedTools, mcpServers, metadata)

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/agents`,
      body,
      beta: MANAGED_AGENTS_BETA,
      logTag: 'createAgent',
    })
  }

  /**
   * @operationName Get Agent
   * @category Agents
   * @description Retrieves a Managed Agent's full configuration: name, model, system prompt, tools, MCP servers, current version number, and timestamps.
   * @route GET /get-agent
   *
   * @paramDef {"type":"String","label":"Agent","name":"agentId","required":true,"dictionary":"getAgentsDictionary","description":"The agent to retrieve (e.g. 'agent_01ABC123def456')."}
   *
   * @returns {Object}
   * @sampleResult {"id":"agent_01ABC123def456","type":"agent","name":"Research Agent","model":"claude-opus-4-8","system":"You are a research assistant.","tools":[{"type":"agent_toolset_20260401"}],"version":1772585501101368000,"created_at":"2026-07-13T18:37:24.100435Z","updated_at":"2026-07-13T18:37:24.100435Z"}
   */
  async getAgent(agentId) {
    if (!agentId) {
      throw new Error('Agent ID is required')
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/agents/${ encodeURIComponent(agentId) }`,
      method: 'get',
      beta: MANAGED_AGENTS_BETA,
      logTag: 'getAgent',
    })
  }

  /**
   * @operationName List Agents
   * @category Agents
   * @description Lists Managed Agents in the workspace with cursor-based pagination. Each entry includes the agent's ID, name, model, current version, and timestamps.
   * @route GET /list-agents
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of agents to return per page (1-100). Defaults to 20."}
   * @paramDef {"type":"String","label":"After ID","name":"afterId","description":"Return the page of results immediately after this agent ID (for forward pagination)."}
   * @paramDef {"type":"String","label":"Before ID","name":"beforeId","description":"Return the page of results immediately before this agent ID (for backward pagination)."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"agent_01ABC123def456","type":"agent","name":"Research Agent","model":"claude-opus-4-8","version":1772585501101368000,"created_at":"2026-07-13T18:37:24.100435Z"}],"has_more":false,"first_id":"agent_01ABC123def456","last_id":"agent_01ABC123def456"}
   */
  async listAgents(limit, afterId, beforeId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/agents`,
      method: 'get',
      query: this.#buildListQuery(limit, afterId, beforeId),
      beta: MANAGED_AGENTS_BETA,
      logTag: 'listAgents',
    })
  }

  /**
   * @operationName Update Agent
   * @category Agents
   * @description Updates a Managed Agent's configuration. Agent versions are immutable, so every update creates a new version; sessions already running keep the version they were created with, and new sessions use the latest version unless pinned. The provided configuration replaces the agent's current one, so supply the complete desired configuration (same parameters as Create Agent), not just the changed fields.
   * @route POST /update-agent
   *
   * @paramDef {"type":"String","label":"Agent","name":"agentId","required":true,"dictionary":"getAgentsDictionary","description":"The agent to update (e.g. 'agent_01ABC123def456')."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Human-readable agent name (1-256 characters)."}
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getModelsDictionary","defaultValue":"claude-opus-4-8","description":"The Claude model the agent runs on."}
   * @paramDef {"type":"String","label":"System Prompt","name":"systemPrompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"System prompt that defines the agent's behavior and persona (up to 100,000 characters)."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Description of what the agent does (up to 2048 characters)."}
   * @paramDef {"type":"Boolean","label":"Enable Agent Toolset","name":"enableAgentToolset","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"When enabled (default), the agent gets the built-in agent toolset: bash, read, write, edit, glob, grep, web_fetch, and web_search."}
   * @paramDef {"type":"Array<Object>","label":"Advanced Tools","name":"advancedTools","description":"Additional tool definitions appended to the tools array. Supports custom client-side tools like {\"type\":\"custom\",\"name\":\"run_tests\",\"description\":\"...\",\"input_schema\":{...}} and MCP toolsets like {\"type\":\"mcp_toolset\",\"mcp_server_name\":\"github\"}. Maximum 128 tools per agent."}
   * @paramDef {"type":"Array<Object>","label":"MCP Servers","name":"mcpServers","description":"MCP server connections in Anthropic format, e.g. [{\"type\":\"url\",\"name\":\"github\",\"url\":\"https://api.githubcopilot.com/mcp/\"}]. Maximum 20 servers with unique names."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","freeform":true,"uiComponent":{"type":"CODE_EDITOR","language":"json"},"description":"Arbitrary key-value pairs stored with the agent (max 16 pairs, keys up to 64 chars, values up to 512 chars)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"agent_01ABC123def456","type":"agent","name":"Research Agent","model":"claude-opus-4-8","system":"You are a meticulous research assistant.","tools":[{"type":"agent_toolset_20260401"}],"version":1772585999200412000,"created_at":"2026-07-13T18:37:24.100435Z","updated_at":"2026-07-13T19:02:11.331812Z"}
   */
  async updateAgent(agentId, name, model, systemPrompt, description, enableAgentToolset, advancedTools, mcpServers, metadata) {
    if (!agentId) {
      throw new Error('Agent ID is required')
    }

    const body = this.#buildAgentBody(name, model, systemPrompt, description, enableAgentToolset, advancedTools, mcpServers, metadata)

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/agents/${ encodeURIComponent(agentId) }`,
      body,
      beta: MANAGED_AGENTS_BETA,
      logTag: 'updateAgent',
    })
  }

  /**
   * @operationName Archive Agent
   * @category Agents
   * @description Archives a Managed Agent. WARNING: this is PERMANENT and cannot be undone - there is no unarchive and agents have no delete. The agent becomes read-only, new sessions can no longer reference it, and only sessions already running continue to completion. Do not archive an agent that production flows still create sessions from.
   * @route POST /archive-agent
   *
   * @paramDef {"type":"String","label":"Agent","name":"agentId","required":true,"dictionary":"getAgentsDictionary","description":"The agent to archive permanently (e.g. 'agent_01ABC123def456')."}
   *
   * @returns {Object}
   * @sampleResult {"id":"agent_01ABC123def456","type":"agent","name":"Research Agent","model":"claude-opus-4-8","version":1772585501101368000,"archived_at":"2026-07-13T19:10:00.000000Z"}
   */
  async archiveAgent(agentId) {
    if (!agentId) {
      throw new Error('Agent ID is required')
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/agents/${ encodeURIComponent(agentId) }/archive`,
      body: {},
      beta: MANAGED_AGENTS_BETA,
      logTag: 'archiveAgent',
    })
  }

  /**
   * @operationName List Agent Versions
   * @category Agents
   * @description Lists the immutable versions of a Managed Agent, created each time the agent is updated. Use a version number with Create Session's Agent Version parameter to pin a session to a known-good configuration for reproducibility or rollback.
   * @route GET /list-agent-versions
   *
   * @paramDef {"type":"String","label":"Agent","name":"agentId","required":true,"dictionary":"getAgentsDictionary","description":"The agent whose versions to list (e.g. 'agent_01ABC123def456')."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of versions to return per page (1-100). Defaults to 20."}
   * @paramDef {"type":"String","label":"After ID","name":"afterId","description":"Return the page of results immediately after this version (for forward pagination)."}
   * @paramDef {"type":"String","label":"Before ID","name":"beforeId","description":"Return the page of results immediately before this version (for backward pagination)."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"version":1772585999200412000,"name":"Research Agent","model":"claude-opus-4-8","created_at":"2026-07-13T19:02:11.331812Z"},{"version":1772585501101368000,"name":"Research Agent","model":"claude-opus-4-8","created_at":"2026-07-13T18:37:24.100435Z"}],"has_more":false}
   */
  async listAgentVersions(agentId, limit, afterId, beforeId) {
    if (!agentId) {
      throw new Error('Agent ID is required')
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/agents/${ encodeURIComponent(agentId) }/versions`,
      method: 'get',
      query: this.#buildListQuery(limit, afterId, beforeId),
      beta: MANAGED_AGENTS_BETA,
      logTag: 'listAgentVersions',
    })
  }

  // ==========================================================================
  //  MANAGED AGENTS (beta) - Environments
  // ==========================================================================

  /**
   * @operationName Create Environment
   * @category Agent Environments
   * @description Creates a reusable Managed Agents cloud environment - the template for the sandboxed containers where an agent's tools (bash, file operations, code) execute. Environments are created once and shared across many sessions. Environment names must be unique in the workspace; creating one with an existing name fails with a 409 conflict. Networking is either 'Unrestricted' (full egress) or 'Limited' (deny-by-default with an allowlist of hosts and opt-in flags for package managers and MCP servers).
   * @route POST /create-environment
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Unique environment name. Creating an environment with an existing name returns a 409 conflict."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description of what the environment is for."}
   * @paramDef {"type":"String","label":"Networking","name":"networkingType","uiComponent":{"type":"DROPDOWN","options":{"values":["Unrestricted","Limited"]}},"defaultValue":"Unrestricted","description":"Container network policy. 'Unrestricted' allows full internet egress; 'Limited' denies by default and only allows the hosts and features opted into below."}
   * @paramDef {"type":"Array<String>","label":"Allowed Hosts","name":"allowedHosts","description":"Hostnames the container may reach when Networking is 'Limited', e.g. [\"api.example.com\"]. Ignored for 'Unrestricted'. Note: under 'Limited', MCP server domains must be listed here or Allow MCP Servers enabled, or MCP tools silently fail."}
   * @paramDef {"type":"Boolean","label":"Allow Package Managers","name":"allowPackageManagers","uiComponent":{"type":"TOGGLE"},"description":"When Networking is 'Limited', permits access to package registries (PyPI, npm, etc.). Defaults to false. Ignored for 'Unrestricted'."}
   * @paramDef {"type":"Boolean","label":"Allow MCP Servers","name":"allowMcpServers","uiComponent":{"type":"TOGGLE"},"description":"When Networking is 'Limited', permits the agent's configured MCP server endpoints without listing them in Allowed Hosts. Defaults to false. Ignored for 'Unrestricted'."}
   *
   * @returns {Object}
   * @sampleResult {"id":"env_01ABC123def456","type":"environment","name":"default-cloud","description":"General purpose environment","config":{"type":"cloud","networking":{"type":"unrestricted"}},"created_at":"2026-07-13T18:37:24.100435Z"}
   */
  async createEnvironment(name, description, networkingType, allowedHosts, allowPackageManagers, allowMcpServers) {
    if (!name || !name.trim()) {
      throw new Error('Name is required')
    }

    const resolvedNetworking = this.#resolveChoice(networkingType, NETWORKING_TYPES) || 'unrestricted'
    const networking = { type: resolvedNetworking }

    if (resolvedNetworking === 'limited') {
      if (Array.isArray(allowedHosts) && allowedHosts.length) {
        networking.allowed_hosts = allowedHosts
      }

      if (allowPackageManagers !== undefined && allowPackageManagers !== null) {
        networking.allow_package_managers = allowPackageManagers
      }

      if (allowMcpServers !== undefined && allowMcpServers !== null) {
        networking.allow_mcp_servers = allowMcpServers
      }
    }

    const body = {
      name,
      config: { type: 'cloud', networking },
    }

    if (description) {
      body.description = description
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/environments`,
      body,
      beta: MANAGED_AGENTS_BETA,
      logTag: 'createEnvironment',
    })
  }

  /**
   * @operationName List Environments
   * @category Agent Environments
   * @description Lists Managed Agents environments in the workspace with cursor-based pagination. Each entry includes the environment's ID, name, and container configuration (type and networking policy).
   * @route GET /list-environments
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of environments to return per page (1-100). Defaults to 20."}
   * @paramDef {"type":"String","label":"After ID","name":"afterId","description":"Return the page of results immediately after this environment ID (for forward pagination)."}
   * @paramDef {"type":"String","label":"Before ID","name":"beforeId","description":"Return the page of results immediately before this environment ID (for backward pagination)."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"env_01ABC123def456","type":"environment","name":"default-cloud","config":{"type":"cloud","networking":{"type":"unrestricted"}},"created_at":"2026-07-13T18:37:24.100435Z"}],"has_more":false,"first_id":"env_01ABC123def456","last_id":"env_01ABC123def456"}
   */
  async listEnvironments(limit, afterId, beforeId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/environments`,
      method: 'get',
      query: this.#buildListQuery(limit, afterId, beforeId),
      beta: MANAGED_AGENTS_BETA,
      logTag: 'listEnvironments',
    })
  }

  /**
   * @operationName Get Environment
   * @category Agent Environments
   * @description Retrieves a Managed Agents environment's details: name, description, container configuration (type and networking policy), and timestamps.
   * @route GET /get-environment
   *
   * @paramDef {"type":"String","label":"Environment","name":"environmentId","required":true,"dictionary":"getEnvironmentsDictionary","description":"The environment to retrieve (e.g. 'env_01ABC123def456')."}
   *
   * @returns {Object}
   * @sampleResult {"id":"env_01ABC123def456","type":"environment","name":"default-cloud","description":"General purpose environment","config":{"type":"cloud","networking":{"type":"unrestricted"}},"created_at":"2026-07-13T18:37:24.100435Z"}
   */
  async getEnvironment(environmentId) {
    if (!environmentId) {
      throw new Error('Environment ID is required')
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/environments/${ encodeURIComponent(environmentId) }`,
      method: 'get',
      beta: MANAGED_AGENTS_BETA,
      logTag: 'getEnvironment',
    })
  }

  /**
   * @operationName Delete Environment
   * @category Agent Environments
   * @description Permanently deletes a Managed Agents environment. Deleted environments cannot be recovered, and new sessions can no longer reference them.
   * @route DELETE /delete-environment
   *
   * @paramDef {"type":"String","label":"Environment","name":"environmentId","required":true,"dictionary":"getEnvironmentsDictionary","description":"The environment to delete (e.g. 'env_01ABC123def456')."}
   *
   * @returns {Object}
   * @sampleResult {"id":"env_01ABC123def456","deleted":true}
   */
  async deleteEnvironment(environmentId) {
    if (!environmentId) {
      throw new Error('Environment ID is required')
    }

    await this.#apiRequest({
      url: `${ API_BASE_URL }/environments/${ encodeURIComponent(environmentId) }`,
      method: 'delete',
      beta: MANAGED_AGENTS_BETA,
      logTag: 'deleteEnvironment',
    })

    return { id: environmentId, deleted: true }
  }

  // ==========================================================================
  //  MANAGED AGENTS (beta) - Sessions
  // ==========================================================================

  /**
   * @operationName Create Session
   * @category Agent Sessions
   * @description Starts a Managed Agents session: a stateful run of a pre-created agent inside an environment's sandboxed container. Sessions run asynchronously - after creating one, use Send Message To Session (or Define Outcome) to kick off work, the On Session Idle trigger to detect completion, and Get Session Result to read the agent's answer. Optionally pin a specific agent version, mount file or GitHub repository resources into the container (session creation blocks until all resources are mounted), and attach vaults with MCP credentials.
   * @route POST /create-session
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Agent","name":"agentId","required":true,"dictionary":"getAgentsDictionary","description":"The agent to run (e.g. 'agent_01ABC123def456'). Uses the agent's latest version unless Agent Version is set."}
   * @paramDef {"type":"Number","label":"Agent Version","name":"agentVersion","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional agent version to pin the session to (from List Agent Versions). Leave empty to use the latest version."}
   * @paramDef {"type":"String","label":"Environment","name":"environmentId","required":true,"dictionary":"getEnvironmentsDictionary","description":"The environment whose container configuration the session runs in (e.g. 'env_01ABC123def456')."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Human-readable session title, shown in dashboards and used by the On Session Idle trigger's Title Contains filter."}
   * @paramDef {"type":"Array<Object>","label":"Resources","name":"resources","description":"Resources mounted into the container at startup. File: {\"type\":\"file\",\"file_id\":\"file_...\",\"mount_path\":\"/workspace/data.csv\"} (upload via the Upload File action first; mount_path must be absolute). GitHub: {\"type\":\"github_repository\",\"url\":\"https://github.com/owner/repo\",\"authorization_token\":\"ghp_...\",\"mount_path\":\"/workspace/repo\",\"checkout\":{\"type\":\"branch\",\"name\":\"main\"}}."}
   * @paramDef {"type":"Array<String>","label":"Vault IDs","name":"vaultIds","description":"Vault IDs (e.g. ['vlt_01ABC...']) holding MCP credentials for the agent's declared MCP servers. Anthropic matches credentials to servers by URL and auto-refreshes OAuth tokens."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","freeform":true,"uiComponent":{"type":"CODE_EDITOR","language":"json"},"description":"Arbitrary key-value pairs stored with the session."}
   *
   * @returns {Object}
   * @sampleResult {"id":"sesn_011CZxAbc123","type":"session","title":"Quarterly report","status":"idle","environment_id":"env_01ABC123def456","agent":{"type":"agent","id":"agent_01ABC123def456","version":1772585501101368000},"resources":[],"created_at":"2026-07-13T18:37:24.100435Z","updated_at":"2026-07-13T18:37:24.100435Z"}
   */
  async createSession(agentId, agentVersion, environmentId, title, resources, vaultIds, metadata) {
    if (!agentId) {
      throw new Error('Agent ID is required')
    }

    if (!environmentId) {
      throw new Error('Environment ID is required')
    }

    const hasVersion = agentVersion !== undefined && agentVersion !== null

    const body = {
      agent: hasVersion ? { type: 'agent', id: agentId, version: agentVersion } : agentId,
      environment_id: environmentId,
    }

    if (title) {
      body.title = title
    }

    if (Array.isArray(resources) && resources.length) {
      body.resources = resources
    }

    if (Array.isArray(vaultIds) && vaultIds.length) {
      body.vault_ids = vaultIds
    }

    if (metadata && Object.keys(metadata).length) {
      body.metadata = metadata
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/sessions`,
      body,
      beta: MANAGED_AGENTS_BETA,
      logTag: 'createSession',
    })
  }

  /**
   * @operationName Get Session
   * @category Agent Sessions
   * @description Retrieves a Managed Agents session's current state: status ('idle', 'running', 'rescheduling', or 'terminated'), title, agent reference, attached resources, token usage, and outcome evaluations when Define Outcome was used.
   * @route GET /get-session
   *
   * @paramDef {"type":"String","label":"Session","name":"sessionId","required":true,"dictionary":"getSessionsDictionary","description":"The session to retrieve (e.g. 'sesn_011CZxAbc123')."}
   *
   * @returns {Object}
   * @sampleResult {"id":"sesn_011CZxAbc123","type":"session","title":"Quarterly report","status":"idle","environment_id":"env_01ABC123def456","agent":{"type":"agent","id":"agent_01ABC123def456","version":1772585501101368000},"usage":{"input_tokens":3571,"output_tokens":727,"cache_read_input_tokens":6656},"outcome_evaluations":[],"created_at":"2026-07-13T18:37:24.100435Z","updated_at":"2026-07-13T18:52:08.100435Z"}
   */
  async getSession(sessionId) {
    if (!sessionId) {
      throw new Error('Session ID is required')
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/sessions/${ encodeURIComponent(sessionId) }`,
      method: 'get',
      beta: MANAGED_AGENTS_BETA,
      logTag: 'getSession',
    })
  }

  /**
   * @operationName List Sessions
   * @category Agent Sessions
   * @description Lists Managed Agents sessions in the workspace with cursor-based pagination. Each entry includes the session's ID, title, status, agent reference, and timestamps.
   * @route GET /list-sessions
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of sessions to return per page (1-100). Defaults to 20."}
   * @paramDef {"type":"String","label":"After ID","name":"afterId","description":"Return the page of results immediately after this session ID (for forward pagination)."}
   * @paramDef {"type":"String","label":"Before ID","name":"beforeId","description":"Return the page of results immediately before this session ID (for backward pagination)."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"sesn_011CZxAbc123","type":"session","title":"Quarterly report","status":"idle","created_at":"2026-07-13T18:37:24.100435Z","updated_at":"2026-07-13T18:52:08.100435Z"}],"has_more":false,"first_id":"sesn_011CZxAbc123","last_id":"sesn_011CZxAbc123"}
   */
  async listSessions(limit, afterId, beforeId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/sessions`,
      method: 'get',
      query: this.#buildListQuery(limit, afterId, beforeId),
      beta: MANAGED_AGENTS_BETA,
      logTag: 'listSessions',
    })
  }

  /**
   * @operationName Archive Session
   * @category Agent Sessions
   * @description Archives a Managed Agents session, making it read-only. Archiving is the routine cleanup step for finished sessions and is not reversible; the event history remains readable. To remove a session and its history entirely, use Delete Session instead. Archiving fails while the session is still 'running' - wait for it to go idle first.
   * @route POST /archive-session
   *
   * @paramDef {"type":"String","label":"Session","name":"sessionId","required":true,"dictionary":"getSessionsDictionary","description":"The session to archive (e.g. 'sesn_011CZxAbc123')."}
   *
   * @returns {Object}
   * @sampleResult {"id":"sesn_011CZxAbc123","type":"session","title":"Quarterly report","status":"idle","archived_at":"2026-07-13T19:10:00.000000Z","created_at":"2026-07-13T18:37:24.100435Z"}
   */
  async archiveSession(sessionId) {
    if (!sessionId) {
      throw new Error('Session ID is required')
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/sessions/${ encodeURIComponent(sessionId) }/archive`,
      body: {},
      beta: MANAGED_AGENTS_BETA,
      logTag: 'archiveSession',
    })
  }

  /**
   * @operationName Delete Session
   * @category Agent Sessions
   * @description Permanently deletes a Managed Agents session, including its event history, container, and checkpoints. Deleted sessions cannot be recovered. Deletion fails while the session is still 'running' - wait for it to go idle first.
   * @route DELETE /delete-session
   *
   * @paramDef {"type":"String","label":"Session","name":"sessionId","required":true,"dictionary":"getSessionsDictionary","description":"The session to delete permanently (e.g. 'sesn_011CZxAbc123')."}
   *
   * @returns {Object}
   * @sampleResult {"id":"sesn_011CZxAbc123","deleted":true}
   */
  async deleteSession(sessionId) {
    if (!sessionId) {
      throw new Error('Session ID is required')
    }

    await this.#apiRequest({
      url: `${ API_BASE_URL }/sessions/${ encodeURIComponent(sessionId) }`,
      method: 'delete',
      beta: MANAGED_AGENTS_BETA,
      logTag: 'deleteSession',
    })

    return { id: sessionId, deleted: true }
  }

  /**
   * @operationName Get Session Result
   * @category Agent Sessions
   * @description Convenience action that reads a Managed Agents session's answer: fetches the session and its events, concatenates the text of the agent's messages produced after the most recent user message (or outcome definition), and returns it together with the session status, the stop reason from the last idle transition, and token usage. Typically used after the On Session Idle trigger fires. A stop reason of 'end_turn' means the agent finished normally; 'requires_action' means it is waiting for a tool confirmation or custom tool result.
   * @route GET /get-session-result
   *
   * @executionTimeoutInSeconds 180
   *
   * @paramDef {"type":"String","label":"Session","name":"sessionId","required":true,"dictionary":"getSessionsDictionary","description":"The session to read the result from (e.g. 'sesn_011CZxAbc123')."}
   *
   * @returns {Object}
   * @sampleResult {"sessionId":"sesn_011CZxAbc123","title":"Quarterly report","status":"idle","resultText":"The report is complete. Revenue grew 18% year over year, driven primarily by the enterprise segment.","lastStopReason":"end_turn","usage":{"input_tokens":3571,"output_tokens":727,"cache_read_input_tokens":6656}}
   */
  async getSessionResult(sessionId) {
    if (!sessionId) {
      throw new Error('Session ID is required')
    }

    const session = await this.getSession(sessionId)

    const MAX_EVENT_PAGES = 10
    const PAGE_SIZE = 1000
    let events = []

    for (let page = 1; page <= MAX_EVENT_PAGES; page++) {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/sessions/${ encodeURIComponent(sessionId) }/events`,
        method: 'get',
        query: { limit: PAGE_SIZE, page },
        beta: MANAGED_AGENTS_BETA,
        logTag: 'getSessionResult',
      })

      const pageEvents = response.data || []

      events = events.concat(pageEvents)

      if (pageEvents.length < PAGE_SIZE || response.has_more === false) {
        break
      }
    }

    let lastUserIndex = -1

    events.forEach((event, index) => {
      if (event.type === 'user.message' || event.type === 'user.define_outcome') {
        lastUserIndex = index
      }
    })

    const resultText = events
      .filter((event, index) => index > lastUserIndex && event.type === 'agent.message')
      .map(event => this.#extractText(event.content))
      .filter(Boolean)
      .join('\n\n')

    const idleEvents = events.filter(event => event.type === 'session.status_idle')
    const lastIdle = idleEvents[idleEvents.length - 1]

    return {
      sessionId,
      title: session.title || null,
      status: session.status,
      resultText,
      lastStopReason: lastIdle?.stop_reason?.type || null,
      usage: session.usage || null,
    }
  }

  /**
   * @operationName List Session Output Files
   * @category Agent Sessions
   * @description Lists the output files a Managed Agents session's agent wrote to /mnt/session/outputs/ in its container. Each entry includes the file's ID, filename, MIME type, and size; download the content with the Download File action. Note: there is a brief indexing lag (a few seconds) between the session going idle and output files appearing - retry once if the list is empty right after completion.
   * @route GET /list-session-output-files
   *
   * @paramDef {"type":"String","label":"Session","name":"sessionId","required":true,"dictionary":"getSessionsDictionary","description":"The session whose output files to list (e.g. 'sesn_011CZxAbc123')."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of files to return per page (1-100). Defaults to 20."}
   * @paramDef {"type":"String","label":"After ID","name":"afterId","description":"Return the page of results immediately after this file ID (for forward pagination)."}
   * @paramDef {"type":"String","label":"Before ID","name":"beforeId","description":"Return the page of results immediately before this file ID (for backward pagination)."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"file_011CNha8iCJcU1wXNR6q4V8w","type":"file","filename":"report.xlsx","mime_type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","size_bytes":48213,"created_at":"2026-07-13T18:52:08.100435Z","downloadable":true}],"has_more":false,"first_id":"file_011CNha8iCJcU1wXNR6q4V8w","last_id":"file_011CNha8iCJcU1wXNR6q4V8w"}
   */
  async listSessionOutputFiles(sessionId, limit, afterId, beforeId) {
    if (!sessionId) {
      throw new Error('Session ID is required')
    }

    const query = this.#buildListQuery(limit, afterId, beforeId)

    query.scope_id = sessionId

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/files`,
      method: 'get',
      query,
      beta: SESSION_FILES_BETA,
      logTag: 'listSessionOutputFiles',
    })
  }

  // ==========================================================================
  //  MANAGED AGENTS (beta) - Session Events
  // ==========================================================================

  /**
   * @operationName Send Message To Session
   * @category Agent Session Events
   * @description Sends a user text message to a Managed Agents session. This is how work is kicked off and steered: the agent transitions to 'running', processes the message, and goes back to 'idle' when done (detect that with the On Session Idle trigger, then read the answer with Get Session Result). Messages can be sent while the session is 'running' or 'idle' - they are queued and processed in order.
   * @route POST /send-message-to-session
   *
   * @paramDef {"type":"String","label":"Session","name":"sessionId","required":true,"dictionary":"getSessionsDictionary","description":"The session to send the message to (e.g. 'sesn_011CZxAbc123')."}
   * @paramDef {"type":"String","label":"Message","name":"message","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The user message text to send to the agent."}
   *
   * @returns {Object}
   * @sampleResult {"events":[{"id":"sevt_01ABC123def456","type":"user.message","content":[{"type":"text","text":"Summarize the mounted report"}],"processed_at":null}]}
   */
  async sendMessageToSession(sessionId, message) {
    if (!message || !message.trim()) {
      throw new Error('Message is required')
    }

    return await this.#sendSessionEvents(sessionId, [
      { type: 'user.message', content: [{ type: 'text', text: message }] },
    ], 'sendMessageToSession')
  }

  /**
   * @operationName Send Custom Tool Result
   * @category Agent Session Events
   * @description Returns the result of a custom (client-side) tool call to a Managed Agents session. When an agent invokes a custom tool declared in its configuration, the session emits an 'agent.custom_tool_use' event and goes idle with stop reason 'requires_action' until this action supplies the result; the agent then resumes running. Use the event's ID as the Custom Tool Use ID.
   * @route POST /send-custom-tool-result
   *
   * @paramDef {"type":"String","label":"Session","name":"sessionId","required":true,"dictionary":"getSessionsDictionary","description":"The session waiting for the tool result (e.g. 'sesn_011CZxAbc123')."}
   * @paramDef {"type":"String","label":"Custom Tool Use ID","name":"customToolUseId","required":true,"description":"The ID of the 'agent.custom_tool_use' event being answered (e.g. 'sevt_01ABC123def456'), found via Get Session Events."}
   * @paramDef {"type":"String","label":"Result Text","name":"resultText","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The tool's output, sent back to the agent as text."}
   * @paramDef {"type":"Boolean","label":"Is Error","name":"isError","uiComponent":{"type":"TOGGLE"},"description":"Enable when the tool execution failed; the agent treats the result text as an error message and adapts."}
   *
   * @returns {Object}
   * @sampleResult {"events":[{"id":"sevt_01DEF789ghi012","type":"user.custom_tool_result","custom_tool_use_id":"sevt_01ABC123def456","processed_at":null}]}
   */
  async sendCustomToolResult(sessionId, customToolUseId, resultText, isError) {
    if (!customToolUseId) {
      throw new Error('Custom Tool Use ID is required')
    }

    if (resultText === undefined || resultText === null || resultText === '') {
      throw new Error('Result Text is required')
    }

    const event = {
      type: 'user.custom_tool_result',
      custom_tool_use_id: customToolUseId,
      content: [{ type: 'text', text: String(resultText) }],
    }

    if (isError !== undefined && isError !== null) {
      event.is_error = isError
    }

    return await this.#sendSessionEvents(sessionId, [event], 'sendCustomToolResult')
  }

  /**
   * @operationName Send Tool Confirmation
   * @category Agent Session Events
   * @description Approves or denies a pending tool call in a Managed Agents session. When an agent's tool is configured with an 'always_ask' permission policy, the session emits an 'agent.tool_use' event and goes idle with stop reason 'requires_action' until this action responds. Use the tool-use event's ID (a 'sevt_...' value) as the Tool Use ID. On deny, an optional message tells the agent why so it can adjust its approach.
   * @route POST /send-tool-confirmation
   *
   * @paramDef {"type":"String","label":"Session","name":"sessionId","required":true,"dictionary":"getSessionsDictionary","description":"The session waiting for the confirmation (e.g. 'sesn_011CZxAbc123')."}
   * @paramDef {"type":"String","label":"Tool Use ID","name":"toolUseId","required":true,"description":"The ID of the 'agent.tool_use' event being confirmed (e.g. 'sevt_01ABC123def456'), found via Get Session Events."}
   * @paramDef {"type":"String","label":"Result","name":"result","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Allow","Deny"]}},"defaultValue":"Allow","description":"Whether to allow or deny the pending tool call."}
   * @paramDef {"type":"String","label":"Deny Message","name":"denyMessage","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional explanation delivered to the agent when denying, e.g. 'Read .env.example instead'. Ignored when allowing."}
   *
   * @returns {Object}
   * @sampleResult {"events":[{"id":"sevt_01DEF789ghi012","type":"user.tool_confirmation","tool_use_id":"sevt_01ABC123def456","result":"allow","processed_at":null}]}
   */
  async sendToolConfirmation(sessionId, toolUseId, result, denyMessage) {
    if (!toolUseId) {
      throw new Error('Tool Use ID is required')
    }

    const resolvedResult = this.#resolveChoice(result, TOOL_CONFIRMATION_RESULTS)

    if (resolvedResult !== 'allow' && resolvedResult !== 'deny') {
      throw new Error("Result must be 'Allow' or 'Deny'")
    }

    const event = {
      type: 'user.tool_confirmation',
      tool_use_id: toolUseId,
      result: resolvedResult,
    }

    if (resolvedResult === 'deny' && denyMessage) {
      event.deny_message = denyMessage
    }

    return await this.#sendSessionEvents(sessionId, [event], 'sendToolConfirmation')
  }

  /**
   * @operationName Interrupt Session
   * @category Agent Session Events
   * @description Interrupts a running Managed Agents session. The interrupt jumps ahead of any queued messages; the agent stops at the next safe boundary and the session goes idle. The agent does not see the interrupt as a message - send a follow-up with Send Message To Session to explain what to do instead. If an outcome is active, the interrupt marks its evaluation as 'interrupted'.
   * @route POST /interrupt-session
   *
   * @paramDef {"type":"String","label":"Session","name":"sessionId","required":true,"dictionary":"getSessionsDictionary","description":"The running session to interrupt (e.g. 'sesn_011CZxAbc123')."}
   *
   * @returns {Object}
   * @sampleResult {"events":[{"id":"sevt_01DEF789ghi012","type":"user.interrupt","processed_at":null}]}
   */
  async interruptSession(sessionId) {
    return await this.#sendSessionEvents(sessionId, [{ type: 'user.interrupt' }], 'interruptSession')
  }

  /**
   * @operationName Define Outcome
   * @category Agent Session Events
   * @description Starts a rubric-graded work loop in a Managed Agents session. Send this INSTEAD of a first message: the agent begins working on the described task immediately, and an independent grader scores each iteration against the rubric, feeding gaps back until the rubric is satisfied, Max Iterations is reached, or the session is interrupted. Write the rubric as explicit, independently checkable criteria (e.g. 'the CSV has a numeric price column'), not vague goals. Track progress via Get Session Events ('span.outcome_evaluation_end' events carry the result and explanation) or Get Session's outcome_evaluations field. Provide the rubric as text OR as a previously uploaded file ID (exactly one).
   * @route POST /define-outcome
   *
   * @paramDef {"type":"String","label":"Session","name":"sessionId","required":true,"dictionary":"getSessionsDictionary","description":"The session to define the outcome in (e.g. 'sesn_011CZxAbc123')."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The task the agent works toward, e.g. 'Build a DCF model for Costco in .xlsx'. No separate first message is needed."}
   * @paramDef {"type":"String","label":"Rubric Text","name":"rubricText","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The grading rubric as Markdown text with explicit, independently gradeable criteria. Use this OR Rubric File ID."}
   * @paramDef {"type":"String","label":"Rubric File ID","name":"rubricFileId","description":"ID of a rubric file previously uploaded via the Upload File action (e.g. 'file_011CNha8iCJcU1wXNR6q4V8w'), reusable across sessions. Use this OR Rubric Text."}
   * @paramDef {"type":"Number","label":"Max Iterations","name":"maxIterations","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum iterate-grade-revise cycles before the loop stops. Defaults to 3, maximum 20."}
   *
   * @returns {Object}
   * @sampleResult {"events":[{"id":"sevt_01DEF789ghi012","type":"user.define_outcome","outcome_id":"outc_01ABC123def456","description":"Build a DCF model for Costco in .xlsx","max_iterations":5,"processed_at":null}]}
   */
  async defineOutcome(sessionId, description, rubricText, rubricFileId, maxIterations) {
    if (!description || !description.trim()) {
      throw new Error('Description is required')
    }

    const rubricSources = [rubricText, rubricFileId].filter(Boolean)

    if (rubricSources.length !== 1) {
      throw new Error('Provide exactly one rubric source: Rubric Text or Rubric File ID')
    }

    const event = {
      type: 'user.define_outcome',
      description,
      rubric: rubricText
        ? { type: 'text', content: rubricText }
        : { type: 'file', file_id: rubricFileId },
    }

    if (maxIterations) {
      event.max_iterations = maxIterations
    }

    return await this.#sendSessionEvents(sessionId, [event], 'defineOutcome')
  }

  /**
   * @operationName Get Session Events
   * @category Agent Session Events
   * @description Lists a Managed Agents session's event history with pagination: agent messages, thinking, tool use and results, status transitions ('session.status_idle' carries the stop reason), errors, outcome evaluation spans, and the user events sent to the session. Optionally filters the returned page to a single event type (the filter is applied client-side to the fetched page).
   * @route GET /get-session-events
   *
   * @paramDef {"type":"String","label":"Session","name":"sessionId","required":true,"dictionary":"getSessionsDictionary","description":"The session whose events to list (e.g. 'sesn_011CZxAbc123')."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of events to return per page. Defaults to 1000."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to fetch. Defaults to the first page."}
   * @paramDef {"type":"String","label":"Event Type","name":"eventType","uiComponent":{"type":"DROPDOWN","options":{"values":["Agent Message","Agent Thinking","Agent Tool Use","Agent Tool Result","Agent MCP Tool Use","Agent MCP Tool Result","Agent Custom Tool Use","Session Idle","Session Running","Session Terminated","Session Error","User Message"]}},"description":"Optional filter that keeps only events of this type from the fetched page. Leave empty to return all event types."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"sevt_01ABC123def456","type":"agent.message","content":[{"type":"text","text":"The report is complete."}],"processed_at":"2026-07-13T18:52:08.100435Z"},{"id":"sevt_01DEF789ghi012","type":"session.status_idle","stop_reason":{"type":"end_turn"},"processed_at":"2026-07-13T18:52:09.100435Z"}],"has_more":false}
   */
  async getSessionEvents(sessionId, limit, page, eventType) {
    if (!sessionId) {
      throw new Error('Session ID is required')
    }

    const query = {}

    if (limit) {
      query.limit = limit
    }

    if (page) {
      query.page = page
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/sessions/${ encodeURIComponent(sessionId) }/events`,
      method: 'get',
      query,
      beta: MANAGED_AGENTS_BETA,
      logTag: 'getSessionEvents',
    })

    const resolvedType = this.#resolveChoice(eventType, SESSION_EVENT_TYPES)

    if (resolvedType) {
      return {
        ...response,
        data: (response.data || []).filter(event => event.type === resolvedType),
      }
    }

    return response
  }

  // ==========================================================================
  //  TRIGGERS (polling) - state-diff based
  // ==========================================================================

  /**
   * @registerAs POLLING_TRIGGER
   * @operationName On Session Idle
   * @category Triggers
   * @description Fires when a Managed Agents session finishes working - i.e. transitions into the 'idle' or 'terminated' status from an active one (or first appears already settled after being created between polls). Watches the 100 most recent sessions in the workspace, optionally filtered by title. Pair with Get Session Result to read the agent's answer once this fires; note that 'idle' also occurs when the agent is waiting for a tool confirmation or custom tool result, so check the stop reason via Get Session Result if the session uses those. Polling interval can be customized (minimum 30 seconds).
   * @route POST /on-session-idle
   *
   * @paramDef {"type":"String","label":"Title Contains","name":"titleContains","description":"Only fire for sessions whose title contains this text (case-insensitive). Leave empty to watch all sessions."}
   *
   * @returns {Object}
   * @sampleResult {"sessionId":"sesn_011CZxAbc123","title":"Quarterly report","status":"idle","createdAt":"2026-07-13T18:37:24.100435Z","updatedAt":"2026-07-13T18:52:08.100435Z"}
   */
  async onSessionIdle(invocation) {
    const { titleContains } = invocation.triggerData || {}
    const state = invocation.state || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/sessions`,
      method: 'get',
      query: { limit: 100 },
      beta: MANAGED_AGENTS_BETA,
      logTag: 'onSessionIdle',
    })

    let sessions = response.data || []

    if (titleContains?.trim()) {
      const needle = titleContains.toLowerCase()

      sessions = sessions.filter(session => (session.title || '').toLowerCase().includes(needle))
    }

    const currentStatuses = {}

    for (const session of sessions) {
      currentStatuses[session.id] = session.status
    }

    // First poll: record the current status of every watched session and emit nothing, so
    // sessions that are already idle or terminated when the flow starts are not replayed
    // as fresh completions.
    if (!state.statuses) {
      return { events: [], state: { statuses: currentStatuses } }
    }

    const isSettled = status => status === 'idle' || status === 'terminated'

    const events = sessions
      .filter(session => {
        if (!isSettled(session.status)) {
          return false
        }

        const previous = state.statuses[session.id]

        // Emit on a transition from an active status, or for a session that appeared (and
        // settled) since the previous poll. Sessions already settled on the prior poll are
        // skipped so each completion fires exactly once.
        return previous === undefined ? true : !isSettled(previous)
      })
      // Polling events are raw data objects (the platform routes them to this trigger already);
      // wrapping them in {name, data} prevents delivery.
      .map(session => ({
        sessionId: session.id,
        title: session.title || null,
        status: session.status,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
      }))

    // Merge into the previous map (capped) so sessions that scroll out of the 100-session
    // window stay remembered and cannot re-emit if they scroll back in; the oldest tracked
    // entries are evicted first.
    const MAX_TRACKED_SESSIONS = 1000
    const merged = { ...state.statuses, ...currentStatuses }
    const keys = Object.keys(merged)

    const statuses = keys.length > MAX_TRACKED_SESSIONS
      ? Object.fromEntries(keys.slice(keys.length - MAX_TRACKED_SESSIONS).map(key => [key, merged[key]]))
      : merged

    return { events, state: { statuses } }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    return this[invocation.eventName](invocation)
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
