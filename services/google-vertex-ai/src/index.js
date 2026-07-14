'use strict'

const crypto = require('node:crypto')

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'
const TOKEN_LIFETIME_SECONDS = 3600
const TOKEN_REFRESH_MARGIN_MS = 60000

const MIME_TYPES = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mpeg': 'video/mpeg',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mp3',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.md': 'text/markdown',
}

const RESPONSE_MIME_MAP = {
  'Text': 'text/plain',
  'JSON': 'application/json',
  'Enum': 'text/x.enum',
}

const TASK_TYPE_MAP = {
  'Semantic Similarity': 'SEMANTIC_SIMILARITY',
  'Classification': 'CLASSIFICATION',
  'Clustering': 'CLUSTERING',
  'Retrieval Document': 'RETRIEVAL_DOCUMENT',
  'Retrieval Query': 'RETRIEVAL_QUERY',
  'Question Answering': 'QUESTION_ANSWERING',
  'Fact Verification': 'FACT_VERIFICATION',
  'Code Retrieval Query': 'CODE_RETRIEVAL_QUERY',
}

const HARM_CATEGORY_MAP = {
  'Harassment': 'HARM_CATEGORY_HARASSMENT',
  'Hate Speech': 'HARM_CATEGORY_HATE_SPEECH',
  'Sexually Explicit': 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'Dangerous Content': 'HARM_CATEGORY_DANGEROUS_CONTENT',
  'Civic Integrity': 'HARM_CATEGORY_CIVIC_INTEGRITY',
}

const HARM_THRESHOLD_MAP = {
  'Block None': 'BLOCK_NONE',
  'Block Only High': 'BLOCK_ONLY_HIGH',
  'Block Medium And Above': 'BLOCK_MEDIUM_AND_ABOVE',
  'Block Low And Above': 'BLOCK_LOW_AND_ABOVE',
  'Off': 'OFF',
}

const logger = {
  info: (...args) => console.log('[Google Vertex AI] info:', ...args),
  debug: (...args) => console.log('[Google Vertex AI] debug:', ...args),
  error: (...args) => console.log('[Google Vertex AI] error:', ...args),
  warn: (...args) => console.log('[Google Vertex AI] warn:', ...args),
}

/**
 * @usesFileStorage
 * @integrationName Google Vertex AI
 * @integrationIcon /icon.svg
 */
class GoogleVertexAI {
  constructor(config) {
    this.serviceAccountKeyRaw = config.serviceAccountKey
    this.configuredProjectId = config.projectId
    this.region = (config.region || 'us-central1').trim()

    this.accessToken = null
    this.accessTokenExpiresAt = 0
  }

  #getServiceAccountKey() {
    if (this.serviceAccountKey) {
      return this.serviceAccountKey
    }

    if (!this.serviceAccountKeyRaw) {
      throw new Error('Service account key is not configured')
    }

    let key

    try {
      key = JSON.parse(this.serviceAccountKeyRaw)
    } catch (error) {
      throw new Error('Service account key is not valid JSON. Paste the full contents of the JSON key file downloaded from Google Cloud.')
    }

    if (!key.client_email || !key.private_key) {
      throw new Error('Service account key is missing "client_email" or "private_key". Make sure you pasted the complete JSON key file.')
    }

    // Recover real newlines if the key was pasted with escaped "\n" sequences.
    if (!key.private_key.includes('\n')) {
      key.private_key = key.private_key.replace(/\\n/g, '\n')
    }

    this.serviceAccountKey = key

    return key
  }

  #getProjectId() {
    return this.configuredProjectId?.trim() || this.#getServiceAccountKey().project_id
  }

  #baseUrl() {
    const project = this.#getProjectId()

    if (!project) {
      throw new Error('Project ID could not be determined. Set the Project ID config item or use a key file containing "project_id".')
    }

    if (this.region === 'global') {
      return `https://aiplatform.googleapis.com/v1/projects/${ project }/locations/global`
    }

    return `https://${ this.region }-aiplatform.googleapis.com/v1/projects/${ project }/locations/${ this.region }`
  }

  #base64UrlEncode(input) {
    const base64 = Buffer.isBuffer(input) ? input.toString('base64') : Buffer.from(input).toString('base64')

    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  #buildSignedJwt(key) {
    const nowSeconds = Math.floor(Date.now() / 1000)

    const header = this.#base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const claims = this.#base64UrlEncode(JSON.stringify({
      iss: key.client_email,
      scope: CLOUD_PLATFORM_SCOPE,
      aud: TOKEN_URL,
      iat: nowSeconds,
      exp: nowSeconds + TOKEN_LIFETIME_SECONDS,
    }))

    const signingInput = `${ header }.${ claims }`
    const signatureBase64 = crypto.createSign('RSA-SHA256').update(signingInput).sign(key.private_key, 'base64')
    const signature = signatureBase64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

    return `${ signingInput }.${ signature }`
  }

  async #getAccessToken() {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) {
      return this.accessToken
    }

    const key = this.#getServiceAccountKey()

    logger.debug(`requesting access token for ${ key.client_email }`)

    let jwt

    try {
      jwt = this.#buildSignedJwt(key)
    } catch (error) {
      throw new Error(`Failed to sign the service account JWT: ${ error.message }. Check that "private_key" in the key file is intact.`)
    }

    const params = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    })

    let response

    try {
      response = await Flowrunner.Request.post(TOKEN_URL)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())
    } catch (error) {
      const message = error.body?.error_description || error.body?.error || error.message

      throw new Error(`Failed to obtain an access token from Google: ${ message }`)
    }

    if (!response.access_token) {
      throw new Error('Google token endpoint did not return an access token')
    }

    this.accessToken = response.access_token
    this.accessTokenExpiresAt = Date.now() + (response.expires_in || TOKEN_LIFETIME_SECONDS) * 1000

    return this.accessToken
  }

  async #apiRequest({ url, method = 'post', body, query, logTag }) {
    const accessToken = await this.#getAccessToken()

    try {
      logger.debug(`${ logTag } - api request: [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method](url)
        .set({ 'Authorization': `Bearer ${ accessToken }`, 'Content-Type': 'application/json' })
        .query(query || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.error?.message || error.body?.message || error.message || 'API request failed'

      logger.error(`${ logTag } - error: ${ message }`)

      throw new Error(`Vertex AI API error: ${ message }`)
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

  async #buildParts(prompt, mediaUrls, logTag) {
    const parts = []

    if (mediaUrls && mediaUrls.length) {
      for (const mediaUrl of mediaUrls) {
        logger.debug(`${ logTag } - downloading inline media from: ${ mediaUrl }`)

        const bytes = await Flowrunner.Request.get(mediaUrl).setEncoding(null)
        const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)

        parts.push({
          inline_data: {
            mime_type: this.#detectMimeType(mediaUrl),
            data: buffer.toString('base64'),
          },
        })
      }
    }

    if (prompt) {
      parts.push({ text: prompt })
    }

    return parts
  }

  async #saveBufferToStorage(buffer, filename, fileOptions) {
    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return url
  }

  /**
   * @operationName Generate Content
   * @category Content Generation
   * @description Generates text with a Gemini model on Vertex AI from a single prompt. Supports an optional system instruction plus temperature and max output token controls, and returns the generated text together with the finish reason and token usage. For multi-turn history, multimodal inputs, structured JSON output, Google Search grounding, thinking control, function calling, or safety settings, use 'Generate Content (Advanced)'.
   * @route POST /generate-content
   *
   * @appearanceColor #4285F4 #5E97F6
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"defaultValue":"gemini-2.5-flash","description":"The Gemini model ID to use (e.g. 'gemini-2.5-flash', 'gemini-2.5-pro'). Model availability depends on your project and region."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text prompt or instruction for the model. Be specific about what you want the model to do."}
   * @paramDef {"type":"String","label":"System Instruction","name":"systemInstruction","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional system-level instruction to guide model behavior. Sets the context and role for the model."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Controls randomness of the output. Values between 0.0 and 2.0. Lower values produce more deterministic results."}
   * @paramDef {"type":"Number","label":"Max Output Tokens","name":"maxOutputTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens to generate in the response. Note that thinking tokens count toward this limit on reasoning models."}
   *
   * @returns {Object}
   * @sampleResult {"text":"Quantum computers use qubits, which can represent multiple states at once, to solve certain problems far faster than classical machines.","model":"gemini-2.5-flash","finishReason":"STOP","usageMetadata":{"promptTokenCount":12,"candidatesTokenCount":28,"totalTokenCount":40}}
   */
  async generateContent(model, prompt, systemInstruction, temperature, maxOutputTokens) {
    const requestBody = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    }

    if (systemInstruction) {
      requestBody.systemInstruction = { parts: [{ text: systemInstruction }] }
    }

    const generationConfig = {}

    if (temperature !== undefined && temperature !== null) {
      generationConfig.temperature = temperature
    }

    if (maxOutputTokens !== undefined && maxOutputTokens !== null) {
      generationConfig.maxOutputTokens = maxOutputTokens
    }

    if (Object.keys(generationConfig).length > 0) {
      requestBody.generationConfig = generationConfig
    }

    const response = await this.#apiRequest({
      url: `${ this.#baseUrl() }/publishers/google/models/${ model }:generateContent`,
      body: requestBody,
      logTag: 'generateContent',
    })

    const candidate = response.candidates?.[0] || {}

    return {
      text: candidate.content?.parts?.filter(part => part.text && !part.thought).map(part => part.text).join('') || '',
      model: response.modelVersion || model,
      finishReason: candidate.finishReason || null,
      usageMetadata: response.usageMetadata || null,
    }
  }

  /**
   * @operationName Generate Content (Advanced)
   * @category Content Generation
   * @description Generates content with the full Gemini feature set on Vertex AI: multimodal inputs (images, audio, video, PDFs sent inline from URLs), multi-turn conversation history, Google Search grounding with citations, custom function declarations, structured JSON output via a response schema, thinking budget control for reasoning models, safety settings, and full sampling controls (temperature, top-p, top-k, stop sequences, seed). Returns the text plus thought summaries, function calls, grounding metadata, finish reason, and token usage.
   * @route POST /generate-content-advanced
   *
   * @appearanceColor #4285F4 #5E97F6
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"defaultValue":"gemini-2.5-flash","description":"The Gemini model ID to use (e.g. 'gemini-2.5-flash', 'gemini-2.5-pro'). Model availability depends on your project and region."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text prompt or instruction for the model. Sent as the final user turn after any history."}
   * @paramDef {"type":"Array<String>","label":"Media URLs","name":"mediaUrls","description":"Optional list of publicly accessible URLs of images, audio, video, or PDFs. Each file is downloaded and sent inline (base64) with the request. Total request size must stay under 20 MB."}
   * @paramDef {"type":"Array<Object>","label":"Conversation History","name":"history","description":"Optional prior conversation turns in Gemini contents format, e.g. [{\"role\":\"user\",\"parts\":[{\"text\":\"Hi\"}]},{\"role\":\"model\",\"parts\":[{\"text\":\"Hello!\"}]}]. Prepended before the current prompt for multi-turn chat."}
   * @paramDef {"type":"String","label":"System Instruction","name":"systemInstruction","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional system-level instruction to guide model behavior. Sets the context and role for the model."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Controls randomness of the output. Values between 0.0 and 2.0. Lower values produce more deterministic results."}
   * @paramDef {"type":"Number","label":"Top P","name":"topP","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Nucleus sampling: the model considers only tokens whose cumulative probability reaches this value. Between 0.0 and 1.0."}
   * @paramDef {"type":"Number","label":"Top K","name":"topK","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Limits sampling to the K most likely next tokens."}
   * @paramDef {"type":"Number","label":"Max Output Tokens","name":"maxOutputTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens to generate in the response. Note that thinking tokens count toward this limit on reasoning models."}
   * @paramDef {"type":"Array<String>","label":"Stop Sequences","name":"stopSequences","description":"Character sequences that stop output generation when produced. Up to 5 sequences."}
   * @paramDef {"type":"Number","label":"Seed","name":"seed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Fixed random seed for best-effort reproducible outputs."}
   * @paramDef {"type":"String","label":"Response Format","name":"responseFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["Text","JSON","Enum"]}},"description":"Output format. 'JSON' produces structured JSON (combine with Response Schema for a guaranteed shape), 'Enum' restricts output to one of the schema's enum values. Defaults to 'Text'. Automatically set to 'JSON' when a Response Schema is provided."}
   * @paramDef {"type":"Object","label":"Response Schema","name":"responseSchema","description":"OpenAPI-style schema object constraining the JSON output shape, e.g. {\"type\":\"ARRAY\",\"items\":{\"type\":\"OBJECT\",\"properties\":{\"name\":{\"type\":\"STRING\"}}}}."}
   * @paramDef {"type":"Number","label":"Thinking Budget","name":"thinkingBudget","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Token budget for internal reasoning on thinking models. Use -1 for dynamic thinking, 0 to disable thinking (where supported), or a positive token count."}
   * @paramDef {"type":"Boolean","label":"Include Thoughts","name":"includeThoughts","uiComponent":{"type":"TOGGLE"},"description":"When enabled on thinking models, returns thought summaries in the 'thoughts' field of the result."}
   * @paramDef {"type":"Boolean","label":"Enable Google Search","name":"enableGoogleSearch","uiComponent":{"type":"TOGGLE"},"description":"Grounds the response in Google Search results. Grounding sources and citations are returned in 'groundingMetadata'."}
   * @paramDef {"type":"Array<Object>","label":"Function Declarations","name":"functionDeclarations","description":"Custom function declarations for function calling, each with name, description, and a JSON-schema 'parameters' object. Calls requested by the model are returned in 'functionCalls'."}
   * @paramDef {"type":"Array<SafetySetting>","label":"Safety Settings","name":"safetySettings","description":"Per-category content safety thresholds overriding the defaults."}
   *
   * @returns {Object}
   * @sampleResult {"text":"Based on current sources, the 2026 summit takes place in Geneva [1].","thoughts":null,"functionCalls":[],"groundingMetadata":{"webSearchQueries":["2026 summit location"],"groundingChunks":[{"web":{"uri":"https://example.com","title":"Summit 2026"}}]},"finishReason":"STOP","model":"gemini-2.5-flash","usageMetadata":{"promptTokenCount":24,"candidatesTokenCount":31,"totalTokenCount":55}}
   */
  async generateContentAdvanced(
    model, prompt, mediaUrls, history, systemInstruction,
    temperature, topP, topK, maxOutputTokens, stopSequences, seed,
    responseFormat, responseSchema, thinkingBudget, includeThoughts,
    enableGoogleSearch, functionDeclarations, safetySettings
  ) {
    const parts = await this.#buildParts(prompt, mediaUrls, 'generateContentAdvanced')

    const contents = []

    if (history && history.length) {
      contents.push(...history)
    }

    contents.push({ role: 'user', parts })

    const requestBody = { contents }

    if (systemInstruction) {
      requestBody.systemInstruction = { parts: [{ text: systemInstruction }] }
    }

    const generationConfig = {}
    const numericConfig = { temperature, topP, topK, maxOutputTokens, seed }

    for (const [key, value] of Object.entries(numericConfig)) {
      if (value !== undefined && value !== null) {
        generationConfig[key] = value
      }
    }

    if (stopSequences && stopSequences.length) {
      generationConfig.stopSequences = stopSequences
    }

    const responseMimeType = this.#resolveChoice(responseFormat, RESPONSE_MIME_MAP)

    if (responseMimeType && responseMimeType !== 'text/plain') {
      generationConfig.responseMimeType = responseMimeType
    }

    if (responseSchema && Object.keys(responseSchema).length) {
      generationConfig.responseSchema = responseSchema

      if (!generationConfig.responseMimeType) {
        generationConfig.responseMimeType = 'application/json'
      }
    }

    if ((thinkingBudget !== undefined && thinkingBudget !== null) || includeThoughts) {
      generationConfig.thinkingConfig = {}

      if (thinkingBudget !== undefined && thinkingBudget !== null) {
        generationConfig.thinkingConfig.thinkingBudget = thinkingBudget
      }

      if (includeThoughts) {
        generationConfig.thinkingConfig.includeThoughts = true
      }
    }

    if (Object.keys(generationConfig).length > 0) {
      requestBody.generationConfig = generationConfig
    }

    const tools = []

    if (functionDeclarations && functionDeclarations.length) {
      tools.push({ functionDeclarations })
    }

    if (enableGoogleSearch) {
      tools.push({ googleSearch: {} })
    }

    if (tools.length) {
      requestBody.tools = tools
    }

    if (safetySettings && safetySettings.length) {
      requestBody.safetySettings = safetySettings.map(setting => ({
        category: this.#resolveChoice(setting.category, HARM_CATEGORY_MAP),
        threshold: this.#resolveChoice(setting.threshold, HARM_THRESHOLD_MAP),
      }))
    }

    const response = await this.#apiRequest({
      url: `${ this.#baseUrl() }/publishers/google/models/${ model }:generateContent`,
      body: requestBody,
      logTag: 'generateContentAdvanced',
    })

    const candidate = response.candidates?.[0] || {}
    const responseParts = candidate.content?.parts || []

    return {
      text: responseParts.filter(part => part.text && !part.thought).map(part => part.text).join('') || '',
      thoughts: responseParts.filter(part => part.text && part.thought).map(part => part.text).join('') || null,
      functionCalls: responseParts.filter(part => part.functionCall).map(part => part.functionCall),
      groundingMetadata: candidate.groundingMetadata || null,
      finishReason: candidate.finishReason || null,
      model: response.modelVersion || model,
      usageMetadata: response.usageMetadata || null,
    }
  }

  /**
   * @operationName Count Tokens
   * @category Content Generation
   * @description Counts the number of tokens a text prompt would consume for a given Gemini model on Vertex AI, without generating content or incurring generation cost. Useful for staying within context windows and estimating costs before a request.
   * @route POST /count-tokens
   *
   * @appearanceColor #4285F4 #5E97F6
   *
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"defaultValue":"gemini-2.5-flash","description":"The Gemini model ID whose tokenizer to use for counting (e.g. 'gemini-2.5-flash')."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text to count tokens for."}
   *
   * @returns {Object}
   * @sampleResult {"totalTokens":31,"totalBillableCharacters":128,"promptTokensDetails":[{"modality":"TEXT","tokenCount":31}]}
   */
  async countTokens(model, text) {
    return await this.#apiRequest({
      url: `${ this.#baseUrl() }/publishers/google/models/${ model }:countTokens`,
      body: { contents: [{ role: 'user', parts: [{ text }] }] },
      logTag: 'countTokens',
    })
  }

  /**
   * @operationName Create Embeddings
   * @category Embeddings
   * @description Generates dense vector embeddings for one or more texts using a Vertex AI embedding model (e.g. 'gemini-embedding-001'). Each text is embedded in its own request for compatibility with models that accept a single instance per call, and the vectors are returned in the same order as the input texts. Supports an optional task type to optimize the embeddings for a downstream use case, and an optional output dimensionality to truncate the vectors.
   * @route POST /create-embeddings
   *
   * @appearanceColor #34A853 #81C995
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"defaultValue":"gemini-embedding-001","description":"The embedding model ID to use (e.g. 'gemini-embedding-001', 'text-embedding-005'). Model availability depends on your project and region."}
   * @paramDef {"type":"Array<String>","label":"Texts","name":"texts","required":true,"description":"One or more texts to generate embeddings for. Vectors are returned in the same order."}
   * @paramDef {"type":"String","label":"Task Type","name":"taskType","uiComponent":{"type":"DROPDOWN","options":{"values":["Semantic Similarity","Classification","Clustering","Retrieval Document","Retrieval Query","Question Answering","Fact Verification","Code Retrieval Query"]}},"description":"Optimizes the embeddings for a specific downstream task. Use 'Retrieval Document' when indexing and 'Retrieval Query' when searching."}
   * @paramDef {"type":"Number","label":"Output Dimensionality","name":"outputDimensionality","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional reduced dimension for the output vectors (e.g. 768 or 1536 instead of the model's native size)."}
   *
   * @returns {Object}
   * @sampleResult {"embeddings":[{"values":[0.0132,-0.0244,0.0087],"statistics":{"token_count":6,"truncated":false}}],"count":1,"model":"gemini-embedding-001"}
   */
  async createEmbeddings(model, texts, taskType, outputDimensionality) {
    if (!texts || !texts.length) {
      throw new Error('At least one text is required')
    }

    const resolvedTaskType = this.#resolveChoice(taskType, TASK_TYPE_MAP)

    const parameters = {}

    if (outputDimensionality !== undefined && outputDimensionality !== null) {
      parameters.outputDimensionality = outputDimensionality
    }

    const embeddings = []

    for (const text of texts) {
      const instance = { content: text }

      if (resolvedTaskType) {
        instance.task_type = resolvedTaskType
      }

      const body = { instances: [instance] }

      if (Object.keys(parameters).length) {
        body.parameters = parameters
      }

      const response = await this.#apiRequest({
        url: `${ this.#baseUrl() }/publishers/google/models/${ model }:predict`,
        body,
        logTag: 'createEmbeddings',
      })

      const prediction = response.predictions?.[0]

      if (!prediction?.embeddings) {
        throw new Error('The embedding model did not return an embedding')
      }

      embeddings.push({
        values: prediction.embeddings.values,
        statistics: prediction.embeddings.statistics || null,
      })
    }

    return { embeddings, count: embeddings.length, model }
  }

  /**
   * @operationName Generate Image
   * @category Image Generation
   * @description Generates images from a text prompt using an Imagen model on Vertex AI. Supports 1 to 4 images per request, a choice of aspect ratios, and an optional negative prompt (honored by older Imagen models only). Generated images are saved to FlowRunner file storage and returned as public URLs.
   * @route POST /generate-image
   *
   * @appearanceColor #34A853 #81C995
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"defaultValue":"imagen-4.0-generate-001","description":"The Imagen model ID to use (e.g. 'imagen-4.0-generate-001', 'imagen-4.0-fast-generate-001', 'imagen-3.0-generate-002'). Model availability depends on your project and region."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Description of the image to generate, including subject, style, lighting, and composition details."}
   * @paramDef {"type":"Number","label":"Sample Count","name":"sampleCount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of images to generate, from 1 to 4. Defaults to 1."}
   * @paramDef {"type":"String","label":"Aspect Ratio","name":"aspectRatio","uiComponent":{"type":"DROPDOWN","options":{"values":["1:1","3:4","4:3","9:16","16:9"]}},"description":"Aspect ratio of the generated images. Defaults to 1:1."}
   * @paramDef {"type":"String","label":"Negative Prompt","name":"negativePrompt","description":"Description of what to discourage in the generated images. Honored by Imagen models up to 3.0.001; newer models ignore it."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for the saved images. Scope controls where files live: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"fileURLs":["https://files.flowrunner.com/flow/imagen_1736947200000_0.png"],"count":1,"model":"imagen-4.0-generate-001"}
   */
  async generateImage(model, prompt, sampleCount, aspectRatio, negativePrompt, fileOptions) {
    const parameters = { sampleCount: sampleCount || 1 }

    if (aspectRatio) {
      parameters.aspectRatio = aspectRatio
    }

    if (negativePrompt) {
      parameters.negativePrompt = negativePrompt
    }

    const response = await this.#apiRequest({
      url: `${ this.#baseUrl() }/publishers/google/models/${ model }:predict`,
      body: { instances: [{ prompt }], parameters },
      logTag: 'generateImage',
    })

    const predictions = response.predictions || []
    const fileURLs = []
    let imageIndex = 0

    for (const prediction of predictions) {
      if (prediction.bytesBase64Encoded) {
        const buffer = Buffer.from(prediction.bytesBase64Encoded, 'base64')
        const extension = (prediction.mimeType || 'image/png').split('/').pop()
        const url = await this.#saveBufferToStorage(buffer, `imagen_${ Date.now() }_${ imageIndex++ }.${ extension }`, fileOptions)

        fileURLs.push(url)
      }
    }

    if (!fileURLs.length) {
      const filterReason = predictions.find(prediction => prediction.raiFilteredReason)?.raiFilteredReason

      throw new Error(`No image was returned by the model${ filterReason ? ` (filtered: ${ filterReason })` : '' }`)
    }

    return { fileURLs, count: fileURLs.length, model }
  }

  /**
   * @operationName Call Partner Model
   * @category Model Garden
   * @description Calls any partner or open model deployed through the Vertex AI Model Garden (Anthropic Claude, Meta Llama, Mistral, AI21, and others) via the rawPredict endpoint. The request body is passed through verbatim in the publisher's native schema, so any model-specific feature is available. For Anthropic models, use the Messages API schema and include "anthropic_version": "vertex-2023-10-16" in the body. The publisher's raw response is returned unchanged.
   * @route POST /call-partner-model
   *
   * @appearanceColor #EA4335 #F28B82
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Publisher","name":"publisher","required":true,"description":"The Model Garden publisher ID, e.g. 'anthropic', 'meta', 'mistralai', 'ai21'."}
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"description":"The publisher's model ID as listed in Model Garden, e.g. 'claude-sonnet-4-5@20250929' or 'llama-3.3-70b-instruct-maas'."}
   * @paramDef {"type":"Object","label":"Request Body","name":"requestBody","required":true,"description":"The full request body in the publisher's native schema. For Anthropic: {\"anthropic_version\":\"vertex-2023-10-16\",\"max_tokens\":1024,\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}."}
   *
   * @returns {Object}
   * @sampleResult {"id":"msg_01AbC","type":"message","role":"assistant","content":[{"type":"text","text":"Hello! How can I help you today?"}],"model":"claude-sonnet-4-5","stop_reason":"end_turn","usage":{"input_tokens":10,"output_tokens":12}}
   */
  async callPartnerModel(publisher, model, requestBody) {
    return await this.#apiRequest({
      url: `${ this.#baseUrl() }/publishers/${ encodeURIComponent(publisher) }/models/${ model }:rawPredict`,
      body: requestBody,
      logTag: 'callPartnerModel',
    })
  }

  /**
   * @operationName Predict
   * @category Model Garden
   * @description Sends a generic prediction request to any Vertex AI predict target: a custom model deployed to an endpoint, or a publisher model that uses the instances/parameters schema. Provide the target as an endpoint resource (e.g. 'endpoints/1234567890'), a full publisher path (e.g. 'publishers/google/models/text-embedding-005'), or a bare Google model ID. Instances and parameters are passed through verbatim and the raw prediction response is returned.
   * @route POST /predict
   *
   * @appearanceColor #EA4335 #F28B82
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Target","name":"target","required":true,"description":"The predict target: 'endpoints/{endpointId}' for a custom-deployed model, 'publishers/{publisher}/models/{model}' for a publisher model, or a bare model ID (treated as publishers/google/models/{id})."}
   * @paramDef {"type":"Array<Object>","label":"Instances","name":"instances","required":true,"description":"The prediction instances in the model's expected input schema."}
   * @paramDef {"type":"Object","label":"Parameters","name":"parameters","description":"Optional prediction parameters in the model's expected schema."}
   *
   * @returns {Object}
   * @sampleResult {"predictions":[{"score":0.92,"label":"positive"}],"deployedModelId":"1234567890","model":"projects/12345/locations/us-central1/models/67890"}
   */
  async predict(target, instances, parameters) {
    if (!instances || !instances.length) {
      throw new Error('At least one instance is required')
    }

    const normalizedTarget = target.includes('/') ? target : `publishers/google/models/${ target }`
    const body = { instances }

    if (parameters && Object.keys(parameters).length) {
      body.parameters = parameters
    }

    return await this.#apiRequest({
      url: `${ this.#baseUrl() }/${ normalizedTarget }:predict`,
      body,
      logTag: 'predict',
    })
  }

}

/**
 * @typedef {Object} SafetySetting
 * @paramDef {"type":"String","label":"Category","name":"category","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Harassment","Hate Speech","Sexually Explicit","Dangerous Content","Civic Integrity"]}},"description":"The harm category this threshold applies to."}
 * @paramDef {"type":"String","label":"Threshold","name":"threshold","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Block None","Block Only High","Block Medium And Above","Block Low And Above","Off"]}},"description":"Blocking threshold for the category. 'Block None' returns content with safety ratings, 'Off' disables the safety filter entirely."}
 */

Flowrunner.ServerCode.addService(GoogleVertexAI, [
  {
    name: 'serviceAccountKey',
    displayName: 'Service Account Key (JSON)',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.TEXT,
    required: true,
    shared: false,
    hint: 'Paste the full JSON key file of a Google Cloud service account with the "Vertex AI User" role. Create one under IAM & Admin > Service Accounts > Keys.',
  },
  {
    name: 'projectId',
    displayName: 'Project ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Google Cloud project ID to bill requests against. Defaults to the "project_id" from the service account key file.',
  },
  {
    name: 'region',
    displayName: 'Region',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    defaultValue: 'us-central1',
    shared: false,
    hint: 'Vertex AI region, e.g. "us-central1", "europe-west4", or "global" for the global endpoint. Model availability varies by region.',
  },
])
