'use strict'

const { signRequest } = require('./sigv4')
const { httpRequest, parseJsonResponse } = require('./aws-client')
const { CredentialProvider } = require('./credentials')
const { createLogger, mapAwsError } = require('./errors')
const { awsConfigItems } = require('./config-items')

const SIGNING_SERVICE = 'bedrock'
const JSON_CONTENT_TYPE = 'application/json'

/**
 * @integrationName AWS Bedrock
 * @integrationIcon /icon.png
 * @usesFileStorage
 */
class AwsBedrock {
  constructor(config = {}) {
    this.region = config.region || 'us-east-1'
    this.logger = createLogger('AWS Bedrock')

    this.credentials = new CredentialProvider({
      authenticationMethod: config.authenticationMethod || 'API Key',
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: this.region,
      roleArn: config.roleArn,
      externalId: config.externalId,
    })

    this.deps = { signRequest, httpRequest, parseJsonResponse }
  }

  /**
   * Signs and sends a REST-JSON request to a Bedrock endpoint, returning the parsed JSON body.
   *
   * @param {Object} opts
   * @param {string} opts.host - Full host, e.g. bedrock-runtime.us-east-1.amazonaws.com
   * @param {string} opts.method - HTTP method
   * @param {string} opts.path - URL path, already percent-encoded where needed
   * @param {Object} [opts.query] - Query string key/value pairs
   * @param {Object|string} [opts.body] - Request body (serialized to JSON when an object)
   * @param {string} [opts.contentType] - Content-Type header (default application/json)
   * @param {string} [opts.accept] - Accept header (default application/json)
   * @returns {Object}
   */
  async #send({ host, method, path, query, body, contentType, accept }) {
    const creds = await this.credentials.resolve()
    const url = new URL(`https://${ host }${ path }`)

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
      }
    }

    const hasBody = body !== undefined && body !== null
    const serialized = hasBody ? (typeof body === 'string' ? body : JSON.stringify(body)) : ''
    const headers = { accept: accept || JSON_CONTENT_TYPE }

    if (hasBody) headers['content-type'] = contentType || JSON_CONTENT_TYPE

    this.deps.signRequest(method, url.toString(), headers, serialized, creds, this.region, SIGNING_SERVICE)

    const response = await this.deps.httpRequest(method, url.toString(), headers, hasBody ? serialized : undefined)

    return this.deps.parseJsonResponse(response)
  }

  #runtimeHost() {
    return `bedrock-runtime.${ this.region }.amazonaws.com`
  }

  #controlHost() {
    return `bedrock.${ this.region }.amazonaws.com`
  }

  /**
   * @operationName Converse
   * @description Sends messages to a Bedrock foundation model through the unified Converse API, which works identically across Anthropic Claude, Amazon Nova/Titan, Meta Llama, Mistral, Cohere, and other chat models. Supply either a full messages array ([{role, content:[{text}]}]) or, for simple cases, a single prompt string (optionally with a system instruction) that is wrapped into one user message. Returns the assistant message, token usage, and stop reason.
   * @route POST /converse
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Model ID","name":"modelId","required":true,"dictionary":"getModelsDictionary","description":"Bedrock model ID or inference profile ARN, e.g. anthropic.claude-3-5-sonnet-20241022-v2:0 or us.anthropic.claude-3-5-sonnet-20241022-v2:0. Model IDs are region-gated and must be enabled in the Bedrock console for your account."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Convenience single-turn user prompt. Used to build one user message when Messages is not provided. Ignored if Messages is supplied."}
   * @paramDef {"type":"Array<Object>","label":"Messages","name":"messages","required":false,"description":"Full conversation as an array of message objects, e.g. [{\"role\":\"user\",\"content\":[{\"text\":\"Hello\"}]}]. Overrides Prompt when provided."}
   * @paramDef {"type":"String","label":"System","name":"system","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional system instruction that sets the model's persona or task. Applied as a single system content block."}
   * @paramDef {"type":"Object","label":"Inference Config","name":"inferenceConfig","required":false,"description":"Optional generation settings as plain JSON: {\"maxTokens\":1000,\"temperature\":0.5,\"topP\":0.9,\"stopSequences\":[\"END\"]}."}
   * @paramDef {"type":"Object","label":"Tool Config","name":"toolConfig","required":false,"description":"Optional tool/function-calling configuration passed through unchanged, e.g. {\"tools\":[...],\"toolChoice\":{...}}."}
   * @paramDef {"type":"Object","label":"Additional Model Request Fields","name":"additionalModelRequestFields","required":false,"description":"Optional model-specific parameters not covered by Inference Config, e.g. {\"top_k\":200}."}
   * @returns {Object}
   * @sampleResult {"message":{"role":"assistant","content":[{"text":"Hello! How can I help you today?"}]},"text":"Hello! How can I help you today?","stopReason":"end_turn","usage":{"inputTokens":10,"outputTokens":9,"totalTokens":19},"metrics":{"latencyMs":642}}
   */
  async converse(modelId, prompt, messages, system, inferenceConfig, toolConfig, additionalModelRequestFields) {
    if (!modelId) throw new Error('modelId is required.')

    let msgs = Array.isArray(messages) && messages.length ? messages : null

    if (!msgs) {
      if (!prompt) throw new Error('Provide either messages or a prompt.')
      msgs = [{ role: 'user', content: [{ text: String(prompt) }] }]
    }

    try {
      const body = { messages: msgs }

      if (system) body.system = [{ text: String(system) }]
      if (inferenceConfig && typeof inferenceConfig === 'object') body.inferenceConfig = inferenceConfig
      if (toolConfig && typeof toolConfig === 'object') body.toolConfig = toolConfig

      if (additionalModelRequestFields && typeof additionalModelRequestFields === 'object') {
        body.additionalModelRequestFields = additionalModelRequestFields
      }

      const res = await this.#send({
        host: this.#runtimeHost(),
        method: 'POST',
        path: `/model/${ encodeURIComponent(modelId) }/converse`,
        body,
      })

      const message = (res.output && res.output.message) || null
      const text = message && Array.isArray(message.content)
        ? message.content.filter(block => typeof block.text === 'string').map(block => block.text).join('')
        : null

      return {
        message,
        text,
        stopReason: res.stopReason || null,
        usage: res.usage || null,
        metrics: res.metrics || null,
      }
    } catch (error) {
      this.#handleError('converse', error)
    }
  }

  /**
   * @operationName Invoke Model
   * @description Invokes a Bedrock model directly with a raw, model-specific request body and returns the parsed model-specific response. Use this for models or parameters not covered by Converse (e.g. embeddings, image generation, or provider-native payloads). The body shape depends on the target model; see the AWS Bedrock inference parameters documentation for each provider (for example Anthropic uses {"anthropic_version":"bedrock-2023-05-31","max_tokens":1024,"messages":[...]}, Amazon Titan Text uses {"inputText":"..."}).
   * @route POST /invoke-model
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Model ID","name":"modelId","required":true,"dictionary":"getModelsDictionary","description":"Bedrock model ID or inference profile ARN. Model IDs are region-gated and must be enabled in the Bedrock console."}
   * @paramDef {"type":"Object","label":"Body","name":"body","required":true,"description":"The model-specific request payload as plain JSON. The exact shape depends on the target model provider."}
   * @paramDef {"type":"String","label":"Content Type","name":"contentType","required":false,"description":"MIME type of the request body. Must be application/json (the default)."}
   * @paramDef {"type":"String","label":"Accept","name":"accept","required":false,"description":"Desired MIME type of the response. Defaults to application/json."}
   * @returns {Object}
   * @sampleResult {"body":{"outputText":"Hello, world!","results":[{"tokenCount":5,"completionReason":"FINISH"}]}}
   */
  async invokeModel(modelId, body, contentType, accept) {
    if (!modelId) throw new Error('modelId is required.')
    if (!body || typeof body !== 'object') throw new Error('body (plain JSON object) is required.')

    try {
      const res = await this.#send({
        host: this.#runtimeHost(),
        method: 'POST',
        path: `/model/${ encodeURIComponent(modelId) }/invoke`,
        body,
        contentType: contentType || JSON_CONTENT_TYPE,
        accept: accept || JSON_CONTENT_TYPE,
      })

      return { body: res }
    } catch (error) {
      this.#handleError('invokeModel', error)
    }
  }

  /**
   * @operationName Generate Image
   * @description Generates an image from a text prompt using an image model such as amazon.titan-image-generator-v2:0 or a Stability AI model, then saves the decoded PNG to FlowRunner file storage and returns a downloadable URL. This is a convenience wrapper over Invoke Model that builds the request body for the selected model family and decodes the base64 image from the response.
   * @route POST /generate-image
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Model ID","name":"modelId","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Amazon Titan Image Generator v2","Amazon Titan Image Generator v1","Stability Stable Diffusion XL v1","Stability Stable Image Core","Stability Stable Image Ultra"]}},"description":"Image model to use. Must be enabled in the Bedrock console for your region."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text description of the image to generate."}
   * @paramDef {"type":"String","label":"Negative Prompt","name":"negativePrompt","required":false,"description":"Optional description of elements to avoid in the generated image."}
   * @paramDef {"type":"Number","label":"Width","name":"width","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Image width in pixels (Titan only; default 1024). Ignored by Stability models."}
   * @paramDef {"type":"Number","label":"Height","name":"height","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Image height in pixels (Titan only; default 1024). Ignored by Stability models."}
   * @paramDef {"type":"Number","label":"Seed","name":"seed","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional seed for reproducible generation."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"],"description":"Where to store the generated image (FLOW, WORKSPACE, or EXECUTION scope)."}
   * @returns {Object}
   * @sampleResult {"url":"https://files.flowrunner.io/output_1700000000000.png","modelId":"amazon.titan-image-generator-v2:0","filename":"bedrock_image_1700000000000.png"}
   */
  async generateImage(modelId, prompt, negativePrompt, width, height, seed, fileOptions) {
    if (!prompt) throw new Error('prompt is required.')

    const resolvedModelId = this.#resolveChoice(modelId || 'Amazon Titan Image Generator v2', {
      'Amazon Titan Image Generator v2': 'amazon.titan-image-generator-v2:0',
      'Amazon Titan Image Generator v1': 'amazon.titan-image-generator-v1',
      'Stability Stable Diffusion XL v1': 'stability.stable-diffusion-xl-v1',
      'Stability Stable Image Core': 'stability.stable-image-core-v1:0',
      'Stability Stable Image Ultra': 'stability.stable-image-ultra-v1:0',
    })

    try {
      const isTitan = resolvedModelId.startsWith('amazon.titan-image')
      const body = isTitan
        ? this.#buildTitanImageBody(prompt, negativePrompt, width, height, seed)
        : this.#buildStabilityImageBody(prompt, negativePrompt, seed)

      const res = await this.#send({
        host: this.#runtimeHost(),
        method: 'POST',
        path: `/model/${ encodeURIComponent(resolvedModelId) }/invoke`,
        body,
        contentType: JSON_CONTENT_TYPE,
        accept: JSON_CONTENT_TYPE,
      })

      const base64Image = this.#extractImageBase64(res)

      if (!base64Image) throw new Error('The model response did not contain an image.')

      const buffer = Buffer.from(base64Image, 'base64')
      const filename = `bedrock_image_${ Date.now() }.png`

      const { url } = await this.flowrunner.Files.uploadFile(buffer, {
        filename,
        generateUrl: true,
        overwrite: true,
        ...(fileOptions || { scope: 'FLOW' }),
      })

      return { url, modelId: resolvedModelId, filename }
    } catch (error) {
      this.#handleError('generateImage', error)
    }
  }

  /**
   * @operationName List Foundation Models
   * @description Lists the Amazon Bedrock foundation models available in the configured region, with optional filtering by provider name or output modality. Returns model summaries including model ID, name, provider, and supported input/output modalities. Availability is region-specific; a listed model must also be enabled for your account before it can be invoked.
   * @route GET /foundation-models
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"By Provider","name":"byProvider","required":false,"description":"Filter to a single provider, e.g. Anthropic, Amazon, Meta, Mistral AI, Cohere, Stability AI."}
   * @paramDef {"type":"String","label":"By Output Modality","name":"byOutputModality","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Text","Image","Embedding"]}},"description":"Filter to models that produce this output type."}
   * @returns {Object}
   * @sampleResult {"models":[{"modelId":"anthropic.claude-3-5-sonnet-20241022-v2:0","modelName":"Claude 3.5 Sonnet v2","providerName":"Anthropic","inputModalities":["TEXT","IMAGE"],"outputModalities":["TEXT"]}],"count":1}
   */
  async listFoundationModels(byProvider, byOutputModality) {
    try {
      const query = {}

      if (byProvider) query.byProvider = byProvider

      if (byOutputModality) {
        query.byOutputModality = this.#resolveChoice(byOutputModality, { Text: 'TEXT', Image: 'IMAGE', Embedding: 'EMBEDDING' })
      }

      const res = await this.#send({ host: this.#controlHost(), method: 'GET', path: '/foundation-models', query })
      const summaries = res.modelSummaries || []

      return {
        models: summaries.map(m => ({
          modelId: m.modelId,
          modelName: m.modelName,
          providerName: m.providerName,
          inputModalities: m.inputModalities || [],
          outputModalities: m.outputModalities || [],
        })),
        count: summaries.length,
      }
    } catch (error) {
      this.#handleError('listFoundationModels', error)
    }
  }

  /**
   * @operationName Get Foundation Model
   * @description Retrieves the full details of a single Amazon Bedrock foundation model by its model ID, including provider, supported modalities, streaming support, inference types, and lifecycle status.
   * @route GET /foundation-model
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Model ID","name":"modelId","required":true,"dictionary":"getModelsDictionary","description":"The foundation model identifier, e.g. anthropic.claude-3-5-sonnet-20241022-v2:0."}
   * @returns {Object}
   * @sampleResult {"model":{"modelId":"anthropic.claude-3-5-sonnet-20241022-v2:0","modelName":"Claude 3.5 Sonnet v2","providerName":"Anthropic","inputModalities":["TEXT","IMAGE"],"outputModalities":["TEXT"],"responseStreamingSupported":true,"inferenceTypesSupported":["INFERENCE_PROFILE"],"modelLifecycle":{"status":"ACTIVE"}}}
   */
  async getFoundationModel(modelId) {
    if (!modelId) throw new Error('modelId is required.')

    try {
      const res = await this.#send({
        host: this.#controlHost(),
        method: 'GET',
        path: `/foundation-models/${ encodeURIComponent(modelId) }`,
      })

      return { model: res.modelDetails || null }
    } catch (error) {
      this.#handleError('getFoundationModel', error)
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Models Dictionary
   * @description Provides a searchable list of Bedrock foundation models available in the configured region for dynamic dropdown selection. Each entry's label is the model name, value is the model ID, and note is the provider name.
   * @route POST /get-models-dictionary
   * @paramDef {"type":"getModelsDictionary__payload","label":"Payload","name":"payload","description":"Optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Claude 3.5 Sonnet v2","value":"anthropic.claude-3-5-sonnet-20241022-v2:0","note":"Anthropic"}],"cursor":null}
   */
  async getModelsDictionary(payload) {
    const { search } = payload || {}

    try {
      const res = await this.#send({ host: this.#controlHost(), method: 'GET', path: '/foundation-models' })
      let summaries = res.modelSummaries || []

      if (search) {
        const lower = search.toLowerCase()

        summaries = summaries.filter(m =>
          (m.modelName || '').toLowerCase().includes(lower) ||
          (m.modelId || '').toLowerCase().includes(lower) ||
          (m.providerName || '').toLowerCase().includes(lower)
        )
      }

      return {
        items: summaries.map(m => ({
          label: m.modelName || m.modelId,
          value: m.modelId,
          note: m.providerName || undefined,
        })),
        cursor: null,
      }
    } catch (error) {
      this.#handleError('getModelsDictionary', error)
    }
  }

  #buildTitanImageBody(prompt, negativePrompt, width, height, seed) {
    const imageGenerationConfig = { numberOfImages: 1, width: width || 1024, height: height || 1024 }

    if (seed !== undefined && seed !== null && seed !== '') imageGenerationConfig.seed = Number(seed)

    const textToImageParams = { text: String(prompt) }

    if (negativePrompt) textToImageParams.negativeText = String(negativePrompt)

    return { taskType: 'TEXT_IMAGE', textToImageParams, imageGenerationConfig }
  }

  #buildStabilityImageBody(prompt, negativePrompt, seed) {
    const textPrompts = [{ text: String(prompt), weight: 1 }]

    if (negativePrompt) textPrompts.push({ text: String(negativePrompt), weight: -1 })

    const body = { text_prompts: textPrompts }

    if (seed !== undefined && seed !== null && seed !== '') body.seed = Number(seed)

    return body
  }

  #extractImageBase64(response) {
    if (Array.isArray(response.images) && response.images.length) return response.images[0]
    if (Array.isArray(response.artifacts) && response.artifacts.length) return response.artifacts[0].base64
    if (typeof response.image === 'string') return response.image

    return null
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #handleError(method, error) {
    this.logger.error(`[${ method }]`, error && error.message)

    if (error && error.name === 'ResourceNotFoundException') {
      throw new Error(`Model or resource not found: ${ error.message }. Check the model ID and that it is enabled in the Bedrock console for this region.`)
    }

    if (error && error.name === 'AccessDeniedException') {
      throw new Error(`Access denied: ${ error.message }. Ensure model access is granted in the Bedrock console and the IAM identity has bedrock:InvokeModel permissions.`)
    }

    if (error && error.name === 'ValidationException') {
      throw new Error(`Invalid request: ${ error.message }. Check the model ID, message format, and inference parameters.`)
    }

    if (error && (error.name === 'ThrottlingException' || error.name === 'ServiceQuotaExceededException')) {
      throw new Error(`Request throttled by Bedrock: ${ error.message }. Retry with backoff or request a quota increase.`)
    }

    if (error && (error.name === 'ModelTimeoutException' || error.name === 'ModelNotReadyException')) {
      throw new Error(`Model unavailable: ${ error.message }. The model timed out or is not ready; retry shortly.`)
    }

    throw mapAwsError(error)
  }
}

if (typeof Flowrunner !== 'undefined') {
  Flowrunner.ServerCode.addService(AwsBedrock, awsConfigItems)
}

module.exports = { AwsBedrock }
