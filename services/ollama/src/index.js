'use strict'

const SERVICE_NAME = 'Ollama'

const logger = {
  info: (...args) => console.log(`[${ SERVICE_NAME }] info:`, ...args),
  debug: (...args) => console.log(`[${ SERVICE_NAME }] debug:`, ...args),
  error: (...args) => console.log(`[${ SERVICE_NAME }] error:`, ...args),
  warn: (...args) => console.log(`[${ SERVICE_NAME }] warn:`, ...args),
}

const FORMAT_OPTIONS = { 'Text': undefined, 'JSON Object': 'json', 'JSON Schema': 'json_schema' }

const THINK_OPTIONS = {
  'Disabled': false,
  'Enabled': true,
  'Low': 'low',
  'Medium': 'medium',
  'High': 'high',
  'Max': 'max',
}

/**
 * @integrationName Ollama
 * @integrationIcon /icon.png
 */
class OllamaService {
  /**
   * @param {Object} config
   * @param {String} config.url
   * @param {String} [config.apiKey]
   */
  constructor(config) {
    this.url = (config.url || '').replace(/\/+$/, '')
    this.apiKey = config.apiKey
  }

  /**
   * All Ollama REST calls go through here. Always requests non-streaming responses.
   * Several Ollama endpoints (copy, delete) return 200 with an empty body — the raw
   * (possibly empty) response is returned and callers synthesize a result object.
   */
  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const url = `${ this.url }${ path }`

    try {
      const headers = { 'Content-Type': 'application/json' }

      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${ this.apiKey }`
      }

      logger.debug(`${ logTag } - api request: [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method](url).set(headers).query(query || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.error || error.body?.message || error.message

      logger.error(`${ logTag } - api request failed: ${ message }`)

      throw new Error(`Ollama API error: ${ message }`)
    }
  }

  /**
   * Maps a friendly dropdown label to the Ollama API value.
   */
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /**
   * Removes undefined/null entries so optional params are omitted from the request body.
   */
  #compact(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined && value !== null))
  }

  /**
   * Resolves the "format" dropdown + optional JSON schema into the Ollama `format` field:
   * a JSON schema object (structured outputs), the string 'json' (JSON mode), or undefined.
   */
  #resolveFormat(format, formatSchema, logTag) {
    if (formatSchema && typeof formatSchema === 'object' && Object.keys(formatSchema).length > 0) {
      return formatSchema
    }

    const choice = this.#resolveChoice(format, FORMAT_OPTIONS)

    if (choice === 'json_schema') {
      throw new Error(`${ logTag }: "Format Schema" must be provided when "Format" is set to "JSON Schema"`)
    }

    return choice
  }

  /**
   * Downloads a public URL into a Buffer (used to inline images for vision models).
   */
  async #downloadToBuffer(fileUrl, logTag) {
    if (!fileUrl || !/^https?:\/\//i.test(fileUrl)) {
      throw new Error(`Invalid image URL '${ fileUrl }'. Should start with 'http://' or 'https://'`)
    }

    logger.debug(`${ logTag } - downloading image from: ${ fileUrl }`)

    const rawBytes = await Flowrunner.Request.get(fileUrl).setEncoding(null)

    return Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(rawBytes)
  }

  // ---------------------------------------------------------------------------
  // Generation
  // ---------------------------------------------------------------------------

  /**
   * @operationName Generate Completion
   * @category Generation
   * @description Generates a single completion for a prompt using a local Ollama model. Supports JSON mode and structured outputs (JSON schema), thinking control for reasoning models (e.g. deepseek-r1, qwen3), and raw model options like temperature and context size. The response includes the generated text plus token counts and timings (prompt_eval_count, eval_count, total_duration in nanoseconds). If the model is not loaded yet, the first call also pays the model load time.
   * @route POST /generate-completion
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getModelsDictionary","description":"Name of a locally available model, e.g. 'llama3.2:3b'. Use List Local Models or Pull Model to see or add models."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The prompt to generate a response for."}
   * @paramDef {"type":"String","label":"System Prompt","name":"system","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional system message that overrides the model's Modelfile system prompt (e.g. 'You are a helpful assistant that answers in French.')."}
   * @paramDef {"type":"String","label":"Format","name":"format","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Text","JSON Object","JSON Schema"]}},"defaultValue":"Text","description":"Output format. 'JSON Object' forces valid JSON (also instruct the model to answer in JSON in your prompt). 'JSON Schema' enables structured outputs constrained by the schema provided in Format Schema."}
   * @paramDef {"type":"Object","label":"Format Schema","name":"formatSchema","required":false,"description":"JSON schema for structured outputs, e.g. {\"type\":\"object\",\"properties\":{\"age\":{\"type\":\"integer\"}},\"required\":[\"age\"]}. When provided it takes precedence over the Format dropdown."}
   * @paramDef {"type":"Object","label":"Model Options","name":"options","required":false,"description":"Runtime model parameters passed through verbatim, e.g. {\"temperature\":0.7,\"top_p\":0.9,\"top_k\":40,\"num_ctx\":4096,\"num_predict\":256,\"seed\":42,\"stop\":[\"\\n\"],\"repeat_penalty\":1.1}."}
   * @paramDef {"type":"String","label":"Thinking","name":"think","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Disabled","Enabled","Low","Medium","High","Max"]}},"description":"Controls thinking for reasoning models (e.g. deepseek-r1, qwen3, gpt-oss). 'Enabled'/'Disabled' toggle thinking; 'Low'/'Medium'/'High'/'Max' set an effort level on models that support it. Leave empty for the model default. Non-reasoning models reject this parameter."}
   * @paramDef {"type":"String","label":"Keep Alive","name":"keepAlive","required":false,"description":"How long the model stays loaded in memory after this request, e.g. '5m' (default), '1h', '0' to unload immediately, or '-1' to keep loaded indefinitely."}
   * @returns {Object}
   * @sampleResult {"model":"llama3.2:3b","created_at":"2026-07-13T10:15:00.000Z","response":"The sky is blue because of Rayleigh scattering.","thinking":null,"done":true,"done_reason":"stop","total_duration":5043500667,"load_duration":5025959,"prompt_eval_count":26,"prompt_eval_duration":325953000,"eval_count":290,"eval_duration":4709213000}
   */
  async generateCompletion(model, prompt, system, format, formatSchema, options, think, keepAlive) {
    const body = this.#compact({
      model,
      prompt,
      system,
      format: this.#resolveFormat(format, formatSchema, 'generateCompletion'),
      options: options && Object.keys(options).length > 0 ? options : undefined,
      think: this.#resolveChoice(think, THINK_OPTIONS),
      keep_alive: keepAlive,
      stream: false,
    })

    return this.#apiRequest({ path: '/api/generate', method: 'post', body, logTag: 'generateCompletion' })
  }

  /**
   * @operationName Chat
   * @category Generation
   * @description Sends a multi-turn conversation to a local Ollama model and returns the next assistant message. Supports tool/function calling (tool_calls are returned on the message), vision models via base64 images on messages or the convenience Image URLs parameter (downloaded and attached to the last user message), JSON mode and structured outputs (JSON schema), and thinking control for reasoning models. The response includes token counts and timings.
   * @route POST /chat
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getModelsDictionary","description":"Name of a locally available model, e.g. 'llama3.2:3b'. Vision inputs require a multimodal model such as 'llava' or 'gemma3'."}
   * @paramDef {"type":"Array<Object>","label":"Messages","name":"messages","required":true,"description":"Conversation messages, e.g. [{\"role\":\"system\",\"content\":\"You are helpful.\"},{\"role\":\"user\",\"content\":\"Hello\"}]. Roles: system, user, assistant, tool. A message may include an 'images' array of base64-encoded images for vision models, or 'tool_calls'/'tool_name' when replaying tool interactions."}
   * @paramDef {"type":"Array<String>","label":"Image URLs","name":"imageUrls","required":false,"description":"Convenience for vision models: publicly accessible image URLs that are downloaded, base64-encoded and attached to the last user message in Messages."}
   * @paramDef {"type":"Array<Object>","label":"Tools","name":"tools","required":false,"description":"Function tool definitions the model may call, passed through verbatim, e.g. [{\"type\":\"function\",\"function\":{\"name\":\"get_weather\",\"description\":\"...\",\"parameters\":{\"type\":\"object\",\"properties\":{...}}}}]. Tool calls are returned in message.tool_calls."}
   * @paramDef {"type":"String","label":"Format","name":"format","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Text","JSON Object","JSON Schema"]}},"defaultValue":"Text","description":"Output format. 'JSON Object' forces valid JSON (also instruct the model to answer in JSON in your prompt). 'JSON Schema' enables structured outputs constrained by the schema provided in Format Schema."}
   * @paramDef {"type":"Object","label":"Format Schema","name":"formatSchema","required":false,"description":"JSON schema for structured outputs, e.g. {\"type\":\"object\",\"properties\":{\"age\":{\"type\":\"integer\"}},\"required\":[\"age\"]}. When provided it takes precedence over the Format dropdown."}
   * @paramDef {"type":"Object","label":"Model Options","name":"options","required":false,"description":"Runtime model parameters passed through verbatim, e.g. {\"temperature\":0.7,\"top_p\":0.9,\"top_k\":40,\"num_ctx\":4096,\"num_predict\":256,\"seed\":42,\"stop\":[\"\\n\"],\"repeat_penalty\":1.1}."}
   * @paramDef {"type":"String","label":"Thinking","name":"think","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Disabled","Enabled","Low","Medium","High","Max"]}},"description":"Controls thinking for reasoning models (e.g. deepseek-r1, qwen3, gpt-oss). 'Enabled'/'Disabled' toggle thinking; 'Low'/'Medium'/'High'/'Max' set an effort level on models that support it. Leave empty for the model default. Non-reasoning models reject this parameter."}
   * @paramDef {"type":"String","label":"Keep Alive","name":"keepAlive","required":false,"description":"How long the model stays loaded in memory after this request, e.g. '5m' (default), '1h', '0' to unload immediately, or '-1' to keep loaded indefinitely."}
   * @returns {Object}
   * @sampleResult {"model":"llama3.2:3b","created_at":"2026-07-13T10:15:00.000Z","message":{"role":"assistant","content":"Hello! How can I help you today?","thinking":null,"tool_calls":null},"done":true,"done_reason":"stop","total_duration":4883583458,"load_duration":1334875,"prompt_eval_count":26,"prompt_eval_duration":342546000,"eval_count":298,"eval_duration":4535599000}
   */
  async chat(model, messages, imageUrls, tools, format, formatSchema, options, think, keepAlive) {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('chat: "Messages" must be a non-empty array of {role, content} objects')
    }

    const finalMessages = await this.#attachImages(messages, imageUrls)

    const body = this.#compact({
      model,
      messages: finalMessages,
      tools: Array.isArray(tools) && tools.length > 0 ? tools : undefined,
      format: this.#resolveFormat(format, formatSchema, 'chat'),
      options: options && Object.keys(options).length > 0 ? options : undefined,
      think: this.#resolveChoice(think, THINK_OPTIONS),
      keep_alive: keepAlive,
      stream: false,
    })

    return this.#apiRequest({ path: '/api/chat', method: 'post', body, logTag: 'chat' })
  }

  /**
   * Downloads Image URLs, base64-encodes them and attaches them to the last user message.
   * Returns a new messages array; the input is not mutated.
   */
  async #attachImages(messages, imageUrls) {
    if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
      return messages
    }

    const result = messages.map(message => ({ ...message }))
    const lastUserIndex = result.map(message => message.role).lastIndexOf('user')

    if (lastUserIndex === -1) {
      throw new Error('chat: "Image URLs" requires at least one message with role "user" to attach the images to')
    }

    const images = []

    for (const imageUrl of imageUrls) {
      const buffer = await this.#downloadToBuffer(imageUrl, 'chat')

      images.push(buffer.toString('base64'))
    }

    const target = result[lastUserIndex]

    target.images = [...(target.images || []), ...images]

    return result
  }

  // ---------------------------------------------------------------------------
  // Embeddings
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Embeddings
   * @category Embeddings
   * @description Generates embedding vectors for one or more input texts using a local embedding model (e.g. 'nomic-embed-text', 'mxbai-embed-large', 'all-minilm'). Returns one embedding per input, in order, in the 'embeddings' array. Inputs longer than the model's context window are truncated by default; disable truncation to get an error instead.
   * @route POST /create-embeddings
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getModelsDictionary","description":"Name of a locally available embedding model, e.g. 'nomic-embed-text'."}
   * @paramDef {"type":"Array<String>","label":"Input Texts","name":"input","required":true,"description":"One or more texts to embed. Each entry produces one vector in the 'embeddings' array, in the same order."}
   * @paramDef {"type":"Boolean","label":"Truncate","name":"truncate","required":false,"uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"Truncates each input to fit the model's context length. When disabled, inputs that exceed the context length return an error instead."}
   * @paramDef {"type":"Number","label":"Dimensions","name":"dimensions","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Truncates the output embeddings to this number of dimensions. Only supported by models with Matryoshka embeddings support."}
   * @paramDef {"type":"Object","label":"Model Options","name":"options","required":false,"description":"Runtime model parameters passed through verbatim, e.g. {\"num_ctx\":8192}."}
   * @paramDef {"type":"String","label":"Keep Alive","name":"keepAlive","required":false,"description":"How long the model stays loaded in memory after this request, e.g. '5m' (default), '0' to unload immediately, or '-1' to keep loaded indefinitely."}
   * @returns {Object}
   * @sampleResult {"model":"nomic-embed-text","embeddings":[[0.010071029,-0.0017594862,0.05007221,0.04692972]],"total_duration":14143917,"load_duration":1019500,"prompt_eval_count":8}
   */
  async createEmbeddings(model, input, truncate, dimensions, options, keepAlive) {
    if (!Array.isArray(input) || input.length === 0) {
      throw new Error('createEmbeddings: "Input Texts" must be a non-empty array of strings')
    }

    const body = this.#compact({
      model,
      input,
      truncate,
      dimensions,
      options: options && Object.keys(options).length > 0 ? options : undefined,
      keep_alive: keepAlive,
    })

    return this.#apiRequest({ path: '/api/embed', method: 'post', body, logTag: 'createEmbeddings' })
  }

  // ---------------------------------------------------------------------------
  // Model Management
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Local Models
   * @category Model Management
   * @description Lists all models available locally on the Ollama server, including name, size in bytes, digest, last modified date and details such as family, parameter size and quantization level.
   * @route GET /list-local-models
   * @returns {Object}
   * @sampleResult {"models":[{"name":"llama3.2:3b","model":"llama3.2:3b","modified_at":"2026-07-01T09:32:11.000Z","size":2019393189,"digest":"a80c4f17acd55265feec403c7aef86be0c25983ab279d83f3bcd3abbcb5b8b72","details":{"parent_model":"","format":"gguf","family":"llama","families":["llama"],"parameter_size":"3.2B","quantization_level":"Q4_K_M"}}]}
   */
  async listLocalModels() {
    return this.#apiRequest({ path: '/api/tags', method: 'get', logTag: 'listLocalModels' })
  }

  /**
   * @operationName Show Model Info
   * @category Model Management
   * @description Retrieves detailed information about a local model: its Modelfile, default parameters, prompt template, details (family, parameter size, quantization) and capabilities (e.g. 'completion', 'vision', 'tools', 'thinking'). Enable Verbose to include full tokenizer and architecture metadata (large response).
   * @route GET /show-model-info
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getModelsDictionary","description":"Name of the local model to inspect, e.g. 'llama3.2:3b'."}
   * @paramDef {"type":"Boolean","label":"Verbose","name":"verbose","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"Includes full verbose fields (e.g. complete tokenizer data) in the response. The response can be very large."}
   * @returns {Object}
   * @sampleResult {"modelfile":"# Modelfile generated by \"ollama show\"...","parameters":"stop \"<|eot_id|>\"","template":"{{ .Prompt }}","details":{"parent_model":"","format":"gguf","family":"llama","families":["llama"],"parameter_size":"3.2B","quantization_level":"Q4_K_M"},"model_info":{"general.architecture":"llama","llama.context_length":131072},"capabilities":["completion","tools"]}
   */
  async showModelInfo(model, verbose) {
    const body = this.#compact({ model, verbose })

    return this.#apiRequest({ path: '/api/show', method: 'post', body, logTag: 'showModelInfo' })
  }

  /**
   * @operationName Pull Model
   * @category Model Management
   * @description Downloads a model from the Ollama library (https://ollama.com/library) to the server, e.g. 'llama3.2:3b' or 'nomic-embed-text'. Returns {"status":"success"} when the download completes. WARNING: large models can take many minutes to download and may exceed this action's 300-second timeout — the pull continues server-side even if the action times out; re-run this action to confirm completion (interrupted pulls resume where they left off) or check List Local Models.
   * @route POST /pull-model
   * @executionTimeoutInSeconds 300
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"description":"Name of the model to download from the Ollama library, e.g. 'llama3.2:3b', 'qwen3:8b', 'nomic-embed-text'."}
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async pullModel(model) {
    return this.#apiRequest({ path: '/api/pull', method: 'post', body: { model, stream: false }, logTag: 'pullModel' })
  }

  /**
   * @operationName Copy Model
   * @category Model Management
   * @description Copies an existing local model to a new name, e.g. to tag a custom variant before editing. Fails if the source model does not exist.
   * @route POST /copy-model
   * @paramDef {"type":"String","label":"Source Model","name":"source","required":true,"dictionary":"getModelsDictionary","description":"Name of the existing local model to copy, e.g. 'llama3.2:3b'."}
   * @paramDef {"type":"String","label":"Destination Model","name":"destination","required":true,"description":"New model name to create, e.g. 'llama3.2-backup'."}
   * @returns {Object}
   * @sampleResult {"source":"llama3.2:3b","destination":"llama3.2-backup","copied":true}
   */
  async copyModel(source, destination) {
    // Ollama returns 200 with an empty body on success.
    await this.#apiRequest({ path: '/api/copy', method: 'post', body: { source, destination }, logTag: 'copyModel' })

    return { source, destination, copied: true }
  }

  /**
   * @operationName Delete Model
   * @category Model Management
   * @description Permanently deletes a model and its data from the Ollama server's local storage. Fails if the model does not exist.
   * @route DELETE /delete-model
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getModelsDictionary","description":"Name of the local model to delete, e.g. 'llama3.2:3b'."}
   * @returns {Object}
   * @sampleResult {"model":"llama3.2:3b","deleted":true}
   */
  async deleteModel(model) {
    // Ollama returns 200 with an empty body on success.
    await this.#apiRequest({ path: '/api/delete', method: 'delete', body: { model }, logTag: 'deleteModel' })

    return { model, deleted: true }
  }

  /**
   * @operationName List Running Models
   * @category Model Management
   * @description Lists the models currently loaded into memory on the Ollama server, including total size, VRAM usage (size_vram) and when each model is scheduled to be unloaded (expires_at).
   * @route GET /list-running-models
   * @returns {Object}
   * @sampleResult {"models":[{"name":"llama3.2:3b","model":"llama3.2:3b","size":3644585728,"digest":"a80c4f17acd55265feec403c7aef86be0c25983ab279d83f3bcd3abbcb5b8b72","details":{"parent_model":"","format":"gguf","family":"llama","families":["llama"],"parameter_size":"3.2B","quantization_level":"Q4_K_M"},"expires_at":"2026-07-13T10:20:00.000Z","size_vram":3644585728}]}
   */
  async listRunningModels() {
    return this.#apiRequest({ path: '/api/ps', method: 'get', logTag: 'listRunningModels' })
  }

  // ---------------------------------------------------------------------------
  // Server
  // ---------------------------------------------------------------------------

  /**
   * @operationName Get Version
   * @category Server
   * @description Retrieves the version of the Ollama server. Also useful as a connectivity check for the configured server URL.
   * @route GET /get-version
   * @returns {Object}
   * @sampleResult {"version":"0.9.6"}
   */
  async getVersion() {
    return this.#apiRequest({ path: '/api/version', method: 'get', logTag: 'getVersion' })
  }

  // ---------------------------------------------------------------------------
  // Dictionaries
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} getModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to model names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (not used — the full model list is returned)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Models Dictionary
   * @description Lists the models available locally on the Ollama server for selection in model parameters.
   * @route POST /get-models-dictionary
   * @paramDef {"type":"getModelsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"llama3.2:3b","value":"llama3.2:3b","note":"3.2B llama"}],"cursor":null}
   */
  async getModelsDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({ path: '/api/tags', method: 'get', logTag: 'getModelsDictionary' })

    let models = response?.models || []

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
          note: [model.details?.parameter_size, model.details?.family].filter(Boolean).join(' ') || undefined,
        })),
      cursor: null,
    }
  }
}

Flowrunner.ServerCode.addService(OllamaService, [
  {
    name: 'url',
    displayName: 'Server URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Ollama server URL, e.g. http://your-server:11434. The server must be reachable from FlowRunner: set OLLAMA_HOST=0.0.0.0 on the server and secure it (e.g. behind a reverse proxy).',
  },
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Optional Bearer token if your Ollama server sits behind an authenticating reverse proxy. Sent as an "Authorization: Bearer" header.',
  },
])
