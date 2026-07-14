'use strict'

const API_BASE_URL = 'https://generativelanguage.googleapis.com'
const UPLOAD_BASE_URL = 'https://generativelanguage.googleapis.com/upload'
const DOWNLOAD_BASE_URL = 'https://generativelanguage.googleapis.com/download'

const MIME_TYPES = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mpeg': 'video/mpeg',
  '.mov': 'video/mov',
  '.avi': 'video/avi',
  '.wmv': 'video/wmv',
  '.mp3': 'audio/mp3',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
  '.md': 'text/markdown',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

const EXTRA_MIME_EXTENSIONS = {
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mpeg': 'mp3',
  'video/quicktime': 'mov',
  'image/heic': 'heic',
  'image/heif': 'heif',
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

const PERSON_GENERATION_MAP = {
  'Allow All': 'allow_all',
  'Allow Adults Only': 'allow_adult',
  'Don\'t Allow': 'dont_allow',
}

const logger = {
  info: (...args) => console.log('[Gemini AI Service] info:', ...args),
  debug: (...args) => console.log('[Gemini AI Service] debug:', ...args),
  error: (...args) => console.log('[Gemini AI Service] error:', ...args),
  warn: (...args) => console.log('[Gemini AI Service] warn:', ...args),
}

/**
 * @usesFileStorage
 * @integrationName Gemini AI
 * @integrationIcon /icon.svg
 */
class GeminiAIService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  async #apiRequest({ url, method, headers, body, query, form, logTag }) {
    method = method || 'get'

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }]`)

      const request = Flowrunner.Request[method](url)
        .query(query)
        .set({ 'x-goog-api-key': this.apiKey })

      if (headers) {
        request.set(headers)
      }

      if (form) {
        request.form(form)
        request.set({ 'Content-Type': 'multipart/form-data' })

        return await request
      }

      if (body) {
        return await request
          .set({ 'Content-Type': 'application/json' })
          .send(body)
      }

      return await request
    } catch (error) {
      error = normalizeError(error)

      const errorMsg = error.message || 'API request failed'

      logger.error(`${ logTag } - error: ${ errorMsg }`)

      throw new Error(errorMsg)
    }
  }

  async #waitForFileActive(fileName, logTag) {
    const maxAttempts = 60
    const delayMs = 2000

    for (let i = 0; i < maxAttempts; i++) {
      const fileInfo = await this.#apiRequest({
        url: `${ API_BASE_URL }/v1beta/${ fileName }`,
        logTag: `${ logTag } - polling file status (${ i + 1 }/${ maxAttempts })`,
      })

      if (fileInfo.state === 'ACTIVE') {
        return fileInfo
      }

      if (fileInfo.state === 'FAILED') {
        throw new Error(`File processing failed: ${ fileInfo.error?.message || 'unknown error' }`)
      }

      await new Promise(resolve => setTimeout(resolve, delayMs))
    }

    throw new Error('File processing timed out after 120 seconds')
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

  #extensionFromMimeType(mimeType) {
    if (!mimeType) {
      return 'bin'
    }

    const base = mimeType.split(';')[0].trim().toLowerCase()
    const entry = Object.entries(MIME_TYPES).find(([, mime]) => mime === base)

    if (entry) {
      return entry[0].slice(1)
    }

    return EXTRA_MIME_EXTENSIONS[base] || base.split('/').pop() || 'bin'
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #normalizeModel(model) {
    if (model.startsWith('models/') || model.startsWith('tunedModels/')) {
      return model
    }

    return `models/${ model }`
  }

  #normalizeResourceName(name, prefix) {
    return name.startsWith(`${ prefix }/`) ? name : `${ prefix }/${ name }`
  }

  async #buildParts(prompt, files, mediaUrls, logTag) {
    const parts = []

    if (files && files.length) {
      for (const file of files) {
        parts.push({
          file_data: {
            mime_type: file.mimeType || 'application/octet-stream',
            file_uri: file.uri,
          },
        })
      }
    }

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

  #pcmToWav(pcmBuffer, sampleRate, numChannels = 1, bitsPerSample = 16) {
    const byteRate = sampleRate * numChannels * bitsPerSample / 8
    const blockAlign = numChannels * bitsPerSample / 8
    const header = Buffer.alloc(44)

    header.write('RIFF', 0)
    header.writeUInt32LE(36 + pcmBuffer.length, 4)
    header.write('WAVE', 8)
    header.write('fmt ', 12)
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20)
    header.writeUInt16LE(numChannels, 22)
    header.writeUInt32LE(sampleRate, 24)
    header.writeUInt32LE(byteRate, 28)
    header.writeUInt16LE(blockAlign, 32)
    header.writeUInt16LE(bitsPerSample, 34)
    header.write('data', 36)
    header.writeUInt32LE(pcmBuffer.length, 40)

    return Buffer.concat([header, pcmBuffer])
  }

  async #modelsDictionary({ search, cursor, predicate, logTag }) {
    const query = { pageSize: 100 }

    if (cursor) {
      query.pageToken = cursor
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1beta/models`,
      query,
      logTag,
    })

    let models = (response.models || []).filter(predicate)

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      models = models.filter(model =>
        model.displayName?.toLowerCase().includes(searchLower) ||
        model.name?.toLowerCase().includes(searchLower)
      )
    }

    return {
      items: models.map(model => ({
        label: model.displayName || model.name,
        value: model.name,
        note: model.name,
      })),
      cursor: response.nextPageToken || null,
    }
  }

  /**
   * @typedef {Object} getModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Models Dictionary
   * @description Provides a searchable list of available Gemini models that support content generation for dynamic parameter selection.
   * @route POST /get-models-dictionary
   * @paramDef {"type":"getModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Gemini 2.5 Flash","value":"models/gemini-2.5-flash","note":"models/gemini-2.5-flash"},{"label":"Gemini 2.0 Flash","value":"models/gemini-2.0-flash","note":"models/gemini-2.0-flash"}],"cursor":null}
   */
  async getModelsDictionary(payload) {
    const { search, cursor } = payload || {}

    return await this.#modelsDictionary({
      search,
      cursor,
      predicate: model => model.supportedGenerationMethods?.includes('generateContent'),
      logTag: 'getModelsDictionary',
    })
  }

  /**
   * @typedef {Object} getEmbeddingModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter embedding models by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Embedding Models Dictionary
   * @description Provides a searchable list of Gemini models that support text embedding generation for dynamic parameter selection.
   * @route POST /get-embedding-models-dictionary
   * @paramDef {"type":"getEmbeddingModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering embedding models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Gemini Embedding 001","value":"models/gemini-embedding-001","note":"models/gemini-embedding-001"}],"cursor":null}
   */
  async getEmbeddingModelsDictionary(payload) {
    const { search, cursor } = payload || {}

    return await this.#modelsDictionary({
      search,
      cursor,
      predicate: model => model.supportedGenerationMethods?.includes('embedContent'),
      logTag: 'getEmbeddingModelsDictionary',
    })
  }

  /**
   * @typedef {Object} getImageModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter image generation models by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Image Models Dictionary
   * @description Provides a searchable list of Gemini models capable of generating or editing images (e.g. the gemini-*-image family) for dynamic parameter selection.
   * @route POST /get-image-models-dictionary
   * @paramDef {"type":"getImageModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering image generation models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Gemini 2.5 Flash Image","value":"models/gemini-2.5-flash-image","note":"models/gemini-2.5-flash-image"}],"cursor":null}
   */
  async getImageModelsDictionary(payload) {
    const { search, cursor } = payload || {}

    return await this.#modelsDictionary({
      search,
      cursor,
      predicate: model => /image/i.test(model.name || ''),
      logTag: 'getImageModelsDictionary',
    })
  }

  /**
   * @typedef {Object} getTtsModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter text-to-speech models by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get TTS Models Dictionary
   * @description Provides a searchable list of Gemini text-to-speech models (e.g. the gemini-*-tts family) for dynamic parameter selection.
   * @route POST /get-tts-models-dictionary
   * @paramDef {"type":"getTtsModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering text-to-speech models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Gemini 2.5 Flash Preview TTS","value":"models/gemini-2.5-flash-preview-tts","note":"models/gemini-2.5-flash-preview-tts"}],"cursor":null}
   */
  async getTtsModelsDictionary(payload) {
    const { search, cursor } = payload || {}

    return await this.#modelsDictionary({
      search,
      cursor,
      predicate: model => /tts/i.test(model.name || ''),
      logTag: 'getTtsModelsDictionary',
    })
  }

  /**
   * @typedef {Object} getVideoModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter video generation models by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Video Models Dictionary
   * @description Provides a searchable list of Veo video generation models (models that support long-running video prediction) for dynamic parameter selection.
   * @route POST /get-video-models-dictionary
   * @paramDef {"type":"getVideoModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering video generation models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Veo 3.1","value":"models/veo-3.1-generate-preview","note":"models/veo-3.1-generate-preview"}],"cursor":null}
   */
  async getVideoModelsDictionary(payload) {
    const { search, cursor } = payload || {}

    return await this.#modelsDictionary({
      search,
      cursor,
      predicate: model =>
        model.supportedGenerationMethods?.includes('predictLongRunning') || /veo/i.test(model.name || ''),
      logTag: 'getVideoModelsDictionary',
    })
  }

  /**
   * @operationName Upload File
   * @category Files
   * @description Uploads a file to the Gemini Files API for use in content generation. Downloads the file from the provided URL, uploads it to Gemini, and polls until the file is processed and ready. Supports documents, images, audio, and video files.
   * @route POST /upload-file
   *
   * @appearanceColor #4285F4 #5E97F6
   * @executionTimeoutInSeconds 180
   *
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"description":"URL of the file to upload. Must be a publicly accessible URL pointing to a document, image, audio, or video file."}
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","description":"Optional display name for the uploaded file in Gemini. Defaults to the original filename from the URL."}
   * @paramDef {"type":"String","label":"MIME Type","name":"mimeType","description":"MIME type of the file (e.g., 'application/pdf', 'image/png'). Auto-detected from the URL extension if not provided."}
   *
   * @returns {Object}
   * @sampleResult {"name":"files/abc123def456","displayName":"invoice.pdf","mimeType":"application/pdf","sizeBytes":"245760","createTime":"2025-01-15T10:30:00.000Z","expirationTime":"2025-01-17T10:30:00.000Z","uri":"https://generativelanguage.googleapis.com/v1beta/files/abc123def456","state":"ACTIVE"}
   */
  async uploadFile(fileUrl, displayName, mimeType) {
    const resolvedMimeType = mimeType || this.#detectMimeType(fileUrl)
    const resolvedDisplayName = displayName || this.#extractFileName(fileUrl)

    logger.debug(`uploadFile - downloading file from: ${ fileUrl }`)

    const fileBuffer = await Flowrunner.Request.get(fileUrl).setEncoding(null)

    const form = new Flowrunner.Request.FormData()

    form.append('metadata', JSON.stringify({
      file: { displayName: resolvedDisplayName },
    }), { contentType: 'application/json' })

    form.append('file', fileBuffer, {
      filename: resolvedDisplayName,
      contentType: resolvedMimeType,
    })

    const uploadResponse = await this.#apiRequest({
      url: `${ UPLOAD_BASE_URL }/v1beta/files`,
      method: 'post',
      form,
      logTag: 'uploadFile',
    })

    const fileName = uploadResponse.file?.name

    if (!fileName) {
      throw new Error('Upload succeeded but no file name was returned')
    }

    return await this.#waitForFileActive(fileName, 'uploadFile')
  }

  /**
   * @operationName List Files
   * @category Files
   * @description Lists files uploaded to the Gemini Files API with pagination support. Returns file metadata including name, size, MIME type, and processing state.
   * @route POST /list-files
   *
   * @appearanceColor #4285F4 #5E97F6
   *
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of files to return per page. Defaults to 10, can be up to 100."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous list response to retrieve the next page of results."}
   *
   * @returns {Object}
   * @sampleResult {"files":[{"name":"files/abc123","displayName":"invoice.pdf","mimeType":"application/pdf","sizeBytes":"245760","createTime":"2025-01-15T10:30:00.000Z","state":"ACTIVE"}],"nextPageToken":null}
   */
  async listFiles(pageSize, pageToken) {
    const query = {}

    if (pageSize) {
      query.pageSize = pageSize
    }

    if (pageToken) {
      query.pageToken = pageToken
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v1beta/files`,
      query,
      logTag: 'listFiles',
    })
  }

  /**
   * @operationName Get File Info
   * @category Files
   * @description Retrieves metadata for a specific file uploaded to the Gemini Files API. Returns details including file name, MIME type, size, creation time, and processing state.
   * @route POST /get-file-info
   *
   * @appearanceColor #4285F4 #5E97F6
   *
   * @paramDef {"type":"String","label":"File Name","name":"fileName","required":true,"description":"The resource name of the file (e.g., 'files/abc123def456'). Obtained from upload or list operations."}
   *
   * @returns {Object}
   * @sampleResult {"name":"files/abc123def456","displayName":"invoice.pdf","mimeType":"application/pdf","sizeBytes":"245760","createTime":"2025-01-15T10:30:00.000Z","expirationTime":"2025-01-17T10:30:00.000Z","uri":"https://generativelanguage.googleapis.com/v1beta/files/abc123def456","state":"ACTIVE"}
   */
  async getFileInfo(fileName) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v1beta/${ fileName }`,
      logTag: 'getFileInfo',
    })
  }

  /**
   * @operationName Delete File
   * @category Files
   * @description Deletes a file previously uploaded to the Gemini Files API. The file will no longer be available for content generation after deletion.
   * @route POST /delete-file
   *
   * @appearanceColor #EA4335 #F28B82
   *
   * @paramDef {"type":"String","label":"File Name","name":"fileName","required":true,"description":"The resource name of the file to delete (e.g., 'files/abc123def456'). Obtained from upload or list operations."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"fileName":"files/abc123def456"}
   */
  async deleteFile(fileName) {
    await this.#apiRequest({
      url: `${ API_BASE_URL }/v1beta/${ fileName }`,
      method: 'delete',
      logTag: 'deleteFile',
    })

    return { success: true, fileName }
  }

  /**
   * @operationName Generate Content
   * @category Content Generation
   * @description Generates content using a Gemini model with a text prompt and optional file reference. Supports configurable temperature, max output tokens, and response format (text or JSON). Use this to analyze uploaded files, answer questions, generate text, or produce structured JSON output. For grounding, thinking control, structured output schemas, safety settings, or tool use, see 'Generate Content (Advanced)'.
   * @route POST /generate-content
   *
   * @appearanceColor #34A853 #81C995
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getModelsDictionary","description":"The Gemini model to use for content generation. Select from available models via the dropdown."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text prompt or instruction for the model. Be specific about what you want the model to do."}
   * @paramDef {"type":"Array<FileReference>","label":"Files","name":"files","description":"Optional list of files previously uploaded to Gemini to include in the request. Each file requires a URI and MIME type."}
   * @paramDef {"type":"String","label":"System Instruction","name":"systemInstruction","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional system-level instruction to guide model behavior. Sets the context and role for the model."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Controls randomness of the output. Values between 0.0 and 2.0. Lower values produce more deterministic results."}
   * @paramDef {"type":"Number","label":"Max Output Tokens","name":"maxOutputTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens to generate in the response. Limits the length of the output."}
   * @paramDef {"type":"String","label":"Response Format","name":"responseFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["text","json"]}},"description":"Output format. Use 'text' for natural language responses or 'json' for structured JSON output. Defaults to 'text'."}
   *
   * @returns {Object}
   * @sampleResult {"text":"The document contains an invoice from Acme Corp dated January 15, 2025, for $1,250.00.","model":"models/gemini-2.5-flash","usageMetadata":{"promptTokenCount":1250,"candidatesTokenCount":45,"totalTokenCount":1295}}
   */
  async generateContent(model, prompt, files, systemInstruction, temperature, maxOutputTokens, responseFormat) {
    const parts = []

    if (files && files.length) {
      for (const file of files) {
        parts.push({
          file_data: {
            mime_type: file.mimeType || 'application/octet-stream',
            file_uri: file.uri,
          },
        })
      }
    }

    parts.push({ text: prompt })

    const requestBody = {
      contents: [{ parts }],
    }

    if (systemInstruction) {
      requestBody.systemInstruction = {
        parts: [{ text: systemInstruction }],
      }
    }

    const generationConfig = {}

    if (temperature !== undefined && temperature !== null) {
      generationConfig.temperature = temperature
    }

    if (maxOutputTokens !== undefined && maxOutputTokens !== null) {
      generationConfig.maxOutputTokens = maxOutputTokens
    }

    if (responseFormat === 'json') {
      generationConfig.responseMimeType = 'application/json'
    }

    if (Object.keys(generationConfig).length > 0) {
      requestBody.generationConfig = generationConfig
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1beta/${ model }:generateContent`,
      method: 'post',
      body: requestBody,
      logTag: 'generateContent',
    })

    const textContent = response.candidates?.[0]?.content?.parts
      ?.map(part => part.text)
      .filter(Boolean)
      .join('') || ''

    return {
      text: textContent,
      model,
      usageMetadata: response.usageMetadata || null,
    }
  }

  /**
   * @operationName Generate Content (Advanced)
   * @category Content Generation
   * @description Generates content with the full Gemini feature set: multimodal inputs (Gemini file references or media URLs sent inline), multi-turn history, Google Search grounding with citations, URL context, code execution, custom function declarations, structured JSON output via a response schema, thinking budget control for reasoning models, safety settings, context caching, and full sampling controls. Returns the text plus thoughts, function calls, grounding metadata, and usage details.
   * @route POST /generate-content-advanced
   *
   * @appearanceColor #34A853 #81C995
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getModelsDictionary","description":"The Gemini model to use for content generation. Select from available models via the dropdown."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text prompt or instruction for the model. Sent as the final user turn after any history."}
   * @paramDef {"type":"Array<FileReference>","label":"Files","name":"files","description":"Optional list of files previously uploaded to the Gemini Files API to include in the request. Each file requires a URI and MIME type. Use for large media (over ~20 MB) or files reused across requests."}
   * @paramDef {"type":"Array<String>","label":"Media URLs","name":"mediaUrls","description":"Optional list of publicly accessible URLs of images, audio, video, or PDFs. Each file is downloaded and sent inline (base64) with the request. Total request size must stay under 20 MB; use the Files API for larger media."}
   * @paramDef {"type":"Array<Object>","label":"Conversation History","name":"history","description":"Optional prior conversation turns in Gemini contents format, e.g. [{\"role\":\"user\",\"parts\":[{\"text\":\"Hi\"}]},{\"role\":\"model\",\"parts\":[{\"text\":\"Hello!\"}]}]. Prepended before the current prompt for multi-turn chat."}
   * @paramDef {"type":"String","label":"System Instruction","name":"systemInstruction","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional system-level instruction to guide model behavior. Sets the context and role for the model."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Controls randomness of the output. Values between 0.0 and 2.0. Lower values produce more deterministic results."}
   * @paramDef {"type":"Number","label":"Top P","name":"topP","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Nucleus sampling: the model considers only tokens whose cumulative probability reaches this value. Between 0.0 and 1.0."}
   * @paramDef {"type":"Number","label":"Top K","name":"topK","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Limits sampling to the K most likely next tokens."}
   * @paramDef {"type":"Number","label":"Max Output Tokens","name":"maxOutputTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens to generate in the response. Note that thinking tokens count toward this limit on reasoning models."}
   * @paramDef {"type":"Array<String>","label":"Stop Sequences","name":"stopSequences","description":"Character sequences that stop output generation when produced. Up to 5 sequences."}
   * @paramDef {"type":"Number","label":"Seed","name":"seed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Fixed random seed for best-effort reproducible outputs."}
   * @paramDef {"type":"Number","label":"Presence Penalty","name":"presencePenalty","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Penalizes tokens that already appeared in the output, encouraging new topics. Typically between -2.0 and 2.0."}
   * @paramDef {"type":"Number","label":"Frequency Penalty","name":"frequencyPenalty","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Penalizes tokens proportionally to how often they appeared in the output, reducing repetition. Typically between -2.0 and 2.0."}
   * @paramDef {"type":"String","label":"Response Format","name":"responseFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["Text","JSON","Enum"]}},"description":"Output format. 'JSON' produces structured JSON (combine with Response Schema for a guaranteed shape), 'Enum' restricts output to one of the schema's enum values. Defaults to 'Text'. Automatically set to 'JSON' when a Response Schema is provided."}
   * @paramDef {"type":"Object","label":"Response Schema","name":"responseSchema","description":"OpenAPI-style schema object constraining the JSON output shape, e.g. {\"type\":\"ARRAY\",\"items\":{\"type\":\"OBJECT\",\"properties\":{\"name\":{\"type\":\"STRING\"}}}}."}
   * @paramDef {"type":"Number","label":"Thinking Budget","name":"thinkingBudget","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Token budget for internal reasoning on thinking models. Use -1 for dynamic thinking, 0 to disable thinking (where supported), or a positive token count."}
   * @paramDef {"type":"Boolean","label":"Include Thoughts","name":"includeThoughts","uiComponent":{"type":"TOGGLE"},"description":"When enabled on thinking models, returns thought summaries in the 'thoughts' field of the result."}
   * @paramDef {"type":"Boolean","label":"Enable Google Search","name":"enableGoogleSearch","uiComponent":{"type":"TOGGLE"},"description":"Grounds the response in Google Search results. Grounding sources and citations are returned in 'groundingMetadata'."}
   * @paramDef {"type":"Boolean","label":"Enable URL Context","name":"enableUrlContext","uiComponent":{"type":"TOGGLE"},"description":"Lets the model fetch and read URLs mentioned in the prompt. Retrieval details are returned in 'urlContextMetadata'."}
   * @paramDef {"type":"Boolean","label":"Enable Code Execution","name":"enableCodeExecution","uiComponent":{"type":"TOGGLE"},"description":"Lets the model write and run Python code to solve the task. Generated code and its output are returned in 'executableCode' and 'codeExecutionResult'."}
   * @paramDef {"type":"Array<Object>","label":"Function Declarations","name":"functionDeclarations","description":"Custom function declarations for function calling, each with name, description, and a JSON-schema 'parameters' object. Calls requested by the model are returned in 'functionCalls'."}
   * @paramDef {"type":"Array<SafetySetting>","label":"Safety Settings","name":"safetySettings","description":"Per-category content safety thresholds overriding the defaults."}
   * @paramDef {"type":"String","label":"Cached Content","name":"cachedContent","description":"Name of a cached content entry (e.g. 'cachedContents/abc123') created via Context Caching operations, used as reusable prompt context at reduced cost. The model must match the cache's model."}
   *
   * @returns {Object}
   * @sampleResult {"text":"Based on current sources, the 2026 summit takes place in Geneva [1].","thoughts":null,"functionCalls":[],"executableCode":null,"codeExecutionResult":null,"groundingMetadata":{"webSearchQueries":["2026 summit location"],"groundingChunks":[{"web":{"uri":"https://example.com","title":"Summit 2026"}}]},"urlContextMetadata":null,"finishReason":"STOP","model":"models/gemini-2.5-flash","usageMetadata":{"promptTokenCount":24,"candidatesTokenCount":31,"totalTokenCount":55}}
   */
  async generateContentAdvanced(
    model, prompt, files, mediaUrls, history, systemInstruction,
    temperature, topP, topK, maxOutputTokens, stopSequences, seed, presencePenalty, frequencyPenalty,
    responseFormat, responseSchema, thinkingBudget, includeThoughts,
    enableGoogleSearch, enableUrlContext, enableCodeExecution, functionDeclarations, safetySettings, cachedContent
  ) {
    const normalizedModel = this.#normalizeModel(model)
    const parts = await this.#buildParts(prompt, files, mediaUrls, 'generateContentAdvanced')

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
    const numericConfig = { temperature, topP, topK, maxOutputTokens, seed, presencePenalty, frequencyPenalty }

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

    if (enableUrlContext) {
      tools.push({ urlContext: {} })
    }

    if (enableCodeExecution) {
      tools.push({ codeExecution: {} })
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

    if (cachedContent) {
      requestBody.cachedContent = this.#normalizeResourceName(cachedContent, 'cachedContents')
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1beta/${ normalizedModel }:generateContent`,
      method: 'post',
      body: requestBody,
      logTag: 'generateContentAdvanced',
    })

    const candidate = response.candidates?.[0] || {}
    const responseParts = candidate.content?.parts || []

    return {
      text: responseParts.filter(part => part.text && !part.thought).map(part => part.text).join('') || '',
      thoughts: responseParts.filter(part => part.text && part.thought).map(part => part.text).join('') || null,
      functionCalls: responseParts.filter(part => part.functionCall).map(part => part.functionCall),
      executableCode: responseParts.find(part => part.executableCode)?.executableCode || null,
      codeExecutionResult: responseParts.find(part => part.codeExecutionResult)?.codeExecutionResult || null,
      groundingMetadata: candidate.groundingMetadata || null,
      urlContextMetadata: candidate.urlContextMetadata || null,
      finishReason: candidate.finishReason || null,
      model: response.modelVersion || normalizedModel,
      usageMetadata: response.usageMetadata || null,
    }
  }

  /**
   * @operationName Count Tokens
   * @category Content Generation
   * @description Counts the number of tokens a prompt (and optional Gemini file references) would consume for a given model, without generating content. Useful for staying within context windows and estimating costs.
   * @route POST /count-tokens
   *
   * @appearanceColor #4285F4 #5E97F6
   *
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getModelsDictionary","description":"The Gemini model whose tokenizer to use for counting."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text to count tokens for."}
   * @paramDef {"type":"Array<FileReference>","label":"Files","name":"files","description":"Optional list of files previously uploaded to the Gemini Files API to include in the token count."}
   *
   * @returns {Object}
   * @sampleResult {"totalTokens":31,"promptTokensDetails":[{"modality":"TEXT","tokenCount":31}]}
   */
  async countTokens(model, text, files) {
    const parts = await this.#buildParts(text, files, null, 'countTokens')

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v1beta/${ this.#normalizeModel(model) }:countTokens`,
      method: 'post',
      body: { contents: [{ parts }] },
      logTag: 'countTokens',
    })
  }

  /**
   * @operationName Generate Image
   * @category Image Generation
   * @description Generates or edits images with a native Gemini image model (the gemini-*-image / 'Nano Banana' family). Optionally accepts input images by URL for editing, compositing, or style transfer. Generated images are saved to FlowRunner file storage and returned as public URLs together with any accompanying text.
   * @route POST /generate-image
   *
   * @appearanceColor #34A853 #81C995
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getImageModelsDictionary","defaultValue":"models/gemini-2.5-flash-image","description":"The Gemini image generation model to use (e.g. 'models/gemini-2.5-flash-image')."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Description of the image to generate, or editing instructions when input images are provided."}
   * @paramDef {"type":"Array<String>","label":"Input Image URLs","name":"inputImageUrls","description":"Optional list of publicly accessible image URLs to edit, combine, or use as style/subject references. Sent inline with the request."}
   * @paramDef {"type":"String","label":"Aspect Ratio","name":"aspectRatio","uiComponent":{"type":"DROPDOWN","options":{"values":["1:1","2:3","3:2","3:4","4:3","4:5","5:4","9:16","16:9","21:9"]}},"description":"Aspect ratio of the generated image. Defaults to the model's native ratio (typically 1:1)."}
   * @paramDef {"type":"String","label":"Image Size","name":"imageSize","uiComponent":{"type":"DROPDOWN","options":{"values":["1K","2K","4K"]}},"description":"Output resolution tier. Higher tiers (2K/4K) are supported by pro-grade image models only."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for the saved images. Scope controls where files live: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"fileURLs":["https://files.flowrunner.com/flow/image_1736947200000_0.png"],"text":"Here is the generated image.","usageMetadata":{"promptTokenCount":12,"candidatesTokenCount":1290,"totalTokenCount":1302}}
   */
  async generateImage(model, prompt, inputImageUrls, aspectRatio, imageSize, fileOptions) {
    const parts = await this.#buildParts(prompt, null, inputImageUrls, 'generateImage')

    const generationConfig = { responseModalities: ['TEXT', 'IMAGE'] }
    const imageConfig = {}

    if (aspectRatio) {
      imageConfig.aspectRatio = aspectRatio
    }

    if (imageSize) {
      imageConfig.imageSize = imageSize
    }

    if (Object.keys(imageConfig).length) {
      generationConfig.imageConfig = imageConfig
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1beta/${ this.#normalizeModel(model) }:generateContent`,
      method: 'post',
      body: { contents: [{ parts }], generationConfig },
      logTag: 'generateImage',
    })

    const responseParts = response.candidates?.[0]?.content?.parts || []
    const fileURLs = []
    let imageIndex = 0

    for (const part of responseParts) {
      if (part.inlineData?.data) {
        const buffer = Buffer.from(part.inlineData.data, 'base64')
        const extension = this.#extensionFromMimeType(part.inlineData.mimeType || 'image/png')
        const url = await this.#saveBufferToStorage(buffer, `image_${ Date.now() }_${ imageIndex++ }.${ extension }`, fileOptions)

        fileURLs.push(url)
      }
    }

    if (!fileURLs.length) {
      const finishReason = response.candidates?.[0]?.finishReason

      throw new Error(`No image was returned by the model${ finishReason ? ` (finish reason: ${ finishReason })` : '' }`)
    }

    return {
      fileURLs,
      text: responseParts.filter(part => part.text).map(part => part.text).join('') || null,
      usageMetadata: response.usageMetadata || null,
    }
  }

  /**
   * @operationName Generate Speech
   * @category Speech Generation
   * @description Converts text to natural speech using a Gemini text-to-speech model, with a choice of 30 prebuilt voices and optional multi-speaker dialogue (assign a distinct voice to each named speaker in the transcript). Style, tone, accent, and pace can be steered in plain language within the text. The audio is saved to FlowRunner file storage as a WAV file and returned as a public URL.
   * @route POST /generate-speech
   *
   * @appearanceColor #34A853 #81C995
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getTtsModelsDictionary","description":"The Gemini text-to-speech model to use (e.g. a gemini-*-tts model)."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text to convert to speech. For multi-speaker audio, prefix each line with the speaker name (e.g. 'Joe: Hello!'). Natural-language style directions (e.g. 'Say cheerfully:') are supported."}
   * @paramDef {"type":"String","label":"Voice Name","name":"voiceName","uiComponent":{"type":"DROPDOWN","options":{"values":["Zephyr","Puck","Charon","Kore","Fenrir","Leda","Orus","Aoede","Callirrhoe","Autonoe","Enceladus","Iapetus","Umbriel","Algieba","Despina","Erinome","Algenib","Rasalgethi","Laomedeia","Achernar","Alnilam","Schedar","Gacrux","Pulcherrima","Achird","Zubenelgenubi","Vindemiatrix","Sadachbia","Sadaltager","Sulafat"]}},"description":"Prebuilt voice for single-speaker audio. Ignored when Speakers are provided. Defaults to the model's default voice when omitted."}
   * @paramDef {"type":"Array<SpeakerVoice>","label":"Speakers","name":"speakers","description":"Optional voice assignments for multi-speaker audio (up to 2 speakers). Each entry maps a speaker name from the text to a prebuilt voice."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for the saved audio file. Scope controls where the file lives: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"fileURL":"https://files.flowrunner.com/flow/speech_1736947200000.wav","mimeType":"audio/wav","usageMetadata":{"promptTokenCount":18,"candidatesTokenCount":420,"totalTokenCount":438}}
   */
  async generateSpeech(model, text, voiceName, speakers, fileOptions) {
    const generationConfig = { responseModalities: ['AUDIO'] }

    if (speakers && speakers.length) {
      generationConfig.speechConfig = {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: speakers.map(speaker => ({
            speaker: speaker.speaker,
            voiceConfig: { prebuiltVoiceConfig: { voiceName: speaker.voiceName } },
          })),
        },
      }
    } else if (voiceName) {
      generationConfig.speechConfig = {
        voiceConfig: { prebuiltVoiceConfig: { voiceName } },
      }
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1beta/${ this.#normalizeModel(model) }:generateContent`,
      method: 'post',
      body: { contents: [{ parts: [{ text }] }], generationConfig },
      logTag: 'generateSpeech',
    })

    const audioPart = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData?.data)

    if (!audioPart) {
      throw new Error('No audio was returned by the model')
    }

    let buffer = Buffer.from(audioPart.inlineData.data, 'base64')
    let mimeType = audioPart.inlineData.mimeType || 'audio/L16;codec=pcm;rate=24000'
    let extension = this.#extensionFromMimeType(mimeType)

    if (/l16|pcm/i.test(mimeType)) {
      const sampleRate = Number(mimeType.match(/rate=(\d+)/)?.[1]) || 24000

      buffer = this.#pcmToWav(buffer, sampleRate)
      mimeType = 'audio/wav'
      extension = 'wav'
    }

    const fileURL = await this.#saveBufferToStorage(buffer, `speech_${ Date.now() }.${ extension }`, fileOptions)

    return {
      fileURL,
      mimeType,
      usageMetadata: response.usageMetadata || null,
    }
  }

  /**
   * @operationName Generate Video
   * @category Video Generation
   * @description Generates a video from a text prompt (and optional starting image) with a Veo model, waits for generation to complete, downloads the result, and saves it to FlowRunner file storage. Generation typically takes 1 to 6 minutes; for longer jobs or fire-and-forget flows, use 'Start Video Generation' with 'Get Video Operation' and 'Save Generated Video' instead.
   * @route POST /generate-video
   *
   * @appearanceColor #34A853 #81C995
   * @executionTimeoutInSeconds 600
   *
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getVideoModelsDictionary","description":"The Veo video generation model to use (e.g. 'models/veo-3.1-generate-preview')."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Description of the video to generate, including subject, action, style, and camera directions. Audio cues (dialogue, sound effects) are supported by Veo 3+ models."}
   * @paramDef {"type":"String","label":"Image URL","name":"imageUrl","description":"Optional publicly accessible image URL used as the first frame of the video (image-to-video)."}
   * @paramDef {"type":"String","label":"Negative Prompt","name":"negativePrompt","description":"Description of what to discourage in the generated video."}
   * @paramDef {"type":"String","label":"Aspect Ratio","name":"aspectRatio","uiComponent":{"type":"DROPDOWN","options":{"values":["16:9","9:16"]}},"description":"Aspect ratio of the generated video. Defaults to 16:9."}
   * @paramDef {"type":"String","label":"Resolution","name":"resolution","uiComponent":{"type":"DROPDOWN","options":{"values":["720p","1080p","4k"]}},"description":"Output resolution. Higher resolutions may be limited to specific models and aspect ratios."}
   * @paramDef {"type":"Number","label":"Duration Seconds","name":"durationSeconds","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Length of the generated video in seconds. Supported values depend on the model (typically 4, 6, or 8)."}
   * @paramDef {"type":"String","label":"Person Generation","name":"personGeneration","uiComponent":{"type":"DROPDOWN","options":{"values":["Allow All","Allow Adults Only","Don't Allow"]}},"description":"Controls whether people may appear in the video. Availability of each setting depends on region and model."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for the saved video file. Scope controls where the file lives: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"fileURL":"https://files.flowrunner.com/flow/video_1736947200000.mp4","operationName":"models/veo-3.1-generate-preview/operations/abc123","videoUri":"https://generativelanguage.googleapis.com/v1beta/files/xyz789:download?alt=media"}
   */
  async generateVideo(model, prompt, imageUrl, negativePrompt, aspectRatio, resolution, durationSeconds, personGeneration, fileOptions) {
    const { operationName } = await this.startVideoGeneration(
      model, prompt, imageUrl, negativePrompt, aspectRatio, resolution, durationSeconds, personGeneration
    )

    const maxAttempts = 54
    const delayMs = 10000

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, delayMs))

      const status = await this.getVideoOperation(operationName)

      if (status.done) {
        if (status.error) {
          throw new Error(`Video generation failed: ${ status.error.message || JSON.stringify(status.error) }`)
        }

        if (!status.videoUri) {
          throw new Error('Video generation finished but no video URI was returned')
        }

        const saved = await this.saveGeneratedVideo(status.videoUri, fileOptions)

        return { fileURL: saved.fileURL, operationName, videoUri: status.videoUri }
      }

      logger.debug(`generateVideo - operation not done yet (${ i + 1 }/${ maxAttempts })`)
    }

    throw new Error(`Video generation timed out. Use 'Get Video Operation' with operation name '${ operationName }' to check status later.`)
  }

  /**
   * @operationName Start Video Generation
   * @category Video Generation
   * @description Starts an asynchronous Veo video generation job and immediately returns the long-running operation name, without waiting for completion. Poll the job with 'Get Video Operation' and save the result with 'Save Generated Video'.
   * @route POST /start-video-generation
   *
   * @appearanceColor #34A853 #81C995
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getVideoModelsDictionary","description":"The Veo video generation model to use (e.g. 'models/veo-3.1-generate-preview')."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Description of the video to generate, including subject, action, style, and camera directions. Audio cues (dialogue, sound effects) are supported by Veo 3+ models."}
   * @paramDef {"type":"String","label":"Image URL","name":"imageUrl","description":"Optional publicly accessible image URL used as the first frame of the video (image-to-video)."}
   * @paramDef {"type":"String","label":"Negative Prompt","name":"negativePrompt","description":"Description of what to discourage in the generated video."}
   * @paramDef {"type":"String","label":"Aspect Ratio","name":"aspectRatio","uiComponent":{"type":"DROPDOWN","options":{"values":["16:9","9:16"]}},"description":"Aspect ratio of the generated video. Defaults to 16:9."}
   * @paramDef {"type":"String","label":"Resolution","name":"resolution","uiComponent":{"type":"DROPDOWN","options":{"values":["720p","1080p","4k"]}},"description":"Output resolution. Higher resolutions may be limited to specific models and aspect ratios."}
   * @paramDef {"type":"Number","label":"Duration Seconds","name":"durationSeconds","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Length of the generated video in seconds. Supported values depend on the model (typically 4, 6, or 8)."}
   * @paramDef {"type":"String","label":"Person Generation","name":"personGeneration","uiComponent":{"type":"DROPDOWN","options":{"values":["Allow All","Allow Adults Only","Don't Allow"]}},"description":"Controls whether people may appear in the video. Availability of each setting depends on region and model."}
   *
   * @returns {Object}
   * @sampleResult {"operationName":"models/veo-3.1-generate-preview/operations/abc123"}
   */
  async startVideoGeneration(model, prompt, imageUrl, negativePrompt, aspectRatio, resolution, durationSeconds, personGeneration) {
    const instance = { prompt }

    if (imageUrl) {
      logger.debug(`startVideoGeneration - downloading first-frame image from: ${ imageUrl }`)

      const bytes = await Flowrunner.Request.get(imageUrl).setEncoding(null)
      const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)

      instance.image = {
        inlineData: {
          mimeType: this.#detectMimeType(imageUrl),
          data: buffer.toString('base64'),
        },
      }
    }

    const parameters = {}

    if (negativePrompt) {
      parameters.negativePrompt = negativePrompt
    }

    if (aspectRatio) {
      parameters.aspectRatio = aspectRatio
    }

    if (resolution) {
      parameters.resolution = resolution
    }

    if (durationSeconds !== undefined && durationSeconds !== null) {
      parameters.durationSeconds = String(durationSeconds)
    }

    const resolvedPersonGeneration = this.#resolveChoice(personGeneration, PERSON_GENERATION_MAP)

    if (resolvedPersonGeneration) {
      parameters.personGeneration = resolvedPersonGeneration
    }

    const body = { instances: [instance] }

    if (Object.keys(parameters).length) {
      body.parameters = parameters
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1beta/${ this.#normalizeModel(model) }:predictLongRunning`,
      method: 'post',
      body,
      logTag: 'startVideoGeneration',
    })

    if (!response.name) {
      throw new Error('Video generation was accepted but no operation name was returned')
    }

    return { operationName: response.name }
  }

  /**
   * @operationName Get Video Operation
   * @category Video Generation
   * @description Checks the status of an asynchronous Veo video generation operation. Returns whether the job is done, the video download URI(s) once available, and the raw operation payload.
   * @route GET /get-video-operation
   *
   * @appearanceColor #4285F4 #5E97F6
   *
   * @paramDef {"type":"String","label":"Operation Name","name":"operationName","required":true,"description":"The operation name returned by 'Start Video Generation' (e.g. 'models/veo-3.1-generate-preview/operations/abc123')."}
   *
   * @returns {Object}
   * @sampleResult {"done":true,"videoUri":"https://generativelanguage.googleapis.com/v1beta/files/xyz789:download?alt=media","videoUris":["https://generativelanguage.googleapis.com/v1beta/files/xyz789:download?alt=media"],"error":null,"operation":{"name":"models/veo-3.1-generate-preview/operations/abc123","done":true}}
   */
  async getVideoOperation(operationName) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1beta/${ operationName }`,
      logTag: 'getVideoOperation',
    })

    const samples = response.response?.generateVideoResponse?.generatedSamples || []
    const videoUris = samples.map(sample => sample.video?.uri).filter(Boolean)

    return {
      done: response.done === true,
      videoUri: videoUris[0] || null,
      videoUris,
      error: response.error || null,
      operation: response,
    }
  }

  /**
   * @operationName Save Generated Video
   * @category Video Generation
   * @description Downloads a generated Veo video from its download URI (authenticating with your API key) and saves it to FlowRunner file storage, returning a public URL. Use after 'Get Video Operation' reports the job as done. Note that Google retains generated videos on their servers for a limited time (typically 2 days).
   * @route POST /save-generated-video
   *
   * @appearanceColor #34A853 #81C995
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Video URI","name":"videoUri","required":true,"description":"The video download URI from a completed video generation operation."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Storage settings for the saved video file. Scope controls where the file lives: FLOW (default), WORKSPACE, or EXECUTION."}
   *
   * @returns {Object}
   * @sampleResult {"fileURL":"https://files.flowrunner.com/flow/video_1736947200000.mp4","sizeBytes":4823041}
   */
  async saveGeneratedVideo(videoUri, fileOptions) {
    logger.debug(`saveGeneratedVideo - downloading video from: ${ videoUri }`)

    let bytes

    try {
      bytes = await Flowrunner.Request.get(videoUri)
        .set({ 'x-goog-api-key': this.apiKey })
        .setEncoding(null)
    } catch (error) {
      throw new Error(`Failed to download generated video: ${ normalizeError(error).message }`)
    }

    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    const fileURL = await this.#saveBufferToStorage(buffer, `video_${ Date.now() }.mp4`, fileOptions)

    return { fileURL, sizeBytes: buffer.length }
  }

  /**
   * @operationName Embed Content
   * @category Embeddings
   * @description Generates a numeric embedding vector for a text using a Gemini embedding model. Supports task-type optimization (e.g. retrieval, similarity, classification) and configurable output dimensionality for storage-efficient vectors. Use for semantic search, RAG pipelines, clustering, and recommendations.
   * @route POST /embed-content
   *
   * @appearanceColor #34A853 #81C995
   *
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getEmbeddingModelsDictionary","description":"The Gemini embedding model to use (e.g. 'models/gemini-embedding-001')."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text to generate an embedding for."}
   * @paramDef {"type":"String","label":"Task Type","name":"taskType","uiComponent":{"type":"DROPDOWN","options":{"values":["Semantic Similarity","Classification","Clustering","Retrieval Document","Retrieval Query","Question Answering","Fact Verification","Code Retrieval Query"]}},"description":"Optimizes the embedding for the intended downstream task. Use 'Retrieval Document' when indexing content and 'Retrieval Query' for search queries."}
   * @paramDef {"type":"Number","label":"Output Dimensionality","name":"outputDimensionality","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional reduced dimension for the output vector (e.g. 768, 1536, or 3072). Defaults to the model's full dimensionality."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Optional title of the text, applicable only when Task Type is 'Retrieval Document'."}
   *
   * @returns {Object}
   * @sampleResult {"embedding":[0.013168523,-0.008711934,-0.046782676],"dimensions":3072}
   */
  async embedContent(model, text, taskType, outputDimensionality, title) {
    const body = { content: { parts: [{ text }] } }
    const resolvedTaskType = this.#resolveChoice(taskType, TASK_TYPE_MAP)

    if (resolvedTaskType) {
      body.taskType = resolvedTaskType
    }

    if (outputDimensionality !== undefined && outputDimensionality !== null) {
      body.outputDimensionality = outputDimensionality
    }

    if (title) {
      body.title = title
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1beta/${ this.#normalizeModel(model) }:embedContent`,
      method: 'post',
      body,
      logTag: 'embedContent',
    })

    const values = response.embedding?.values || []

    return { embedding: values, dimensions: values.length }
  }

  /**
   * @operationName Batch Embed Contents
   * @category Embeddings
   * @description Generates embedding vectors for multiple texts in a single request using a Gemini embedding model. More efficient than calling 'Embed Content' repeatedly when indexing document collections.
   * @route POST /batch-embed-contents
   *
   * @appearanceColor #34A853 #81C995
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getEmbeddingModelsDictionary","description":"The Gemini embedding model to use (e.g. 'models/gemini-embedding-001')."}
   * @paramDef {"type":"Array<String>","label":"Texts","name":"texts","required":true,"description":"The list of texts to generate embeddings for. Results are returned in the same order."}
   * @paramDef {"type":"String","label":"Task Type","name":"taskType","uiComponent":{"type":"DROPDOWN","options":{"values":["Semantic Similarity","Classification","Clustering","Retrieval Document","Retrieval Query","Question Answering","Fact Verification","Code Retrieval Query"]}},"description":"Optimizes the embeddings for the intended downstream task. Use 'Retrieval Document' when indexing content and 'Retrieval Query' for search queries."}
   * @paramDef {"type":"Number","label":"Output Dimensionality","name":"outputDimensionality","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional reduced dimension for the output vectors (e.g. 768, 1536, or 3072). Defaults to the model's full dimensionality."}
   *
   * @returns {Object}
   * @sampleResult {"embeddings":[[0.013168523,-0.008711934],[0.021334235,0.001744568]],"count":2}
   */
  async batchEmbedContents(model, texts, taskType, outputDimensionality) {
    const normalizedModel = this.#normalizeModel(model)
    const resolvedTaskType = this.#resolveChoice(taskType, TASK_TYPE_MAP)

    const requests = (texts || []).map(text => {
      const request = { model: normalizedModel, content: { parts: [{ text }] } }

      if (resolvedTaskType) {
        request.taskType = resolvedTaskType
      }

      if (outputDimensionality !== undefined && outputDimensionality !== null) {
        request.outputDimensionality = outputDimensionality
      }

      return request
    })

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1beta/${ normalizedModel }:batchEmbedContents`,
      method: 'post',
      body: { requests },
      logTag: 'batchEmbedContents',
    })

    const embeddings = (response.embeddings || []).map(embedding => embedding.values || [])

    return { embeddings, count: embeddings.length }
  }

  /**
   * @operationName List Models
   * @category Models
   * @description Lists all models available through the Gemini API with their capabilities, token limits, and supported generation methods. Supports pagination.
   * @route GET /list-models
   *
   * @appearanceColor #4285F4 #5E97F6
   *
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of models to return per page. Defaults to 50, can be up to 1000."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous list response to retrieve the next page of results."}
   *
   * @returns {Object}
   * @sampleResult {"models":[{"name":"models/gemini-2.5-flash","displayName":"Gemini 2.5 Flash","inputTokenLimit":1048576,"outputTokenLimit":65536,"supportedGenerationMethods":["generateContent","countTokens"]}],"nextPageToken":null}
   */
  async listModels(pageSize, pageToken) {
    const query = {}

    if (pageSize) {
      query.pageSize = pageSize
    }

    if (pageToken) {
      query.pageToken = pageToken
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v1beta/models`,
      query,
      logTag: 'listModels',
    })
  }

  /**
   * @operationName Get Model
   * @category Models
   * @description Retrieves detailed metadata for a specific Gemini model, including its description, token limits, supported generation methods, and default sampling parameters.
   * @route GET /get-model
   *
   * @appearanceColor #4285F4 #5E97F6
   *
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getModelsDictionary","description":"The model to look up (e.g. 'models/gemini-2.5-flash')."}
   *
   * @returns {Object}
   * @sampleResult {"name":"models/gemini-2.5-flash","displayName":"Gemini 2.5 Flash","description":"Best model in terms of price-performance.","inputTokenLimit":1048576,"outputTokenLimit":65536,"supportedGenerationMethods":["generateContent","countTokens"],"temperature":1,"topP":0.95,"topK":64}
   */
  async getModel(model) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v1beta/${ this.#normalizeModel(model) }`,
      logTag: 'getModel',
    })
  }

  /**
   * @operationName Create Cached Content
   * @category Context Caching
   * @description Creates a cached content entry (explicit context caching) from text and/or uploaded Gemini files, tied to a specific model. Reusing the cache in generation requests via its name substantially reduces cost and latency for repeated large contexts. Caches require a model-dependent minimum size (typically 1,024 to 4,096 tokens) and expire after the TTL.
   * @route POST /create-cached-content
   *
   * @appearanceColor #34A853 #81C995
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getModelsDictionary","description":"The model this cache is for. Generation requests using the cache must use the same model version."}
   * @paramDef {"type":"String","label":"Text","name":"text","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text content to cache. At least one of Text or Files must be provided."}
   * @paramDef {"type":"Array<FileReference>","label":"Files","name":"files","description":"Files previously uploaded to the Gemini Files API to cache. At least one of Text or Files must be provided."}
   * @paramDef {"type":"String","label":"System Instruction","name":"systemInstruction","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional system instruction to store with the cache."}
   * @paramDef {"type":"Number","label":"TTL Seconds","name":"ttlSeconds","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Cache lifetime in seconds. Defaults to 3600 (1 hour)."}
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","description":"Optional human-readable name for the cache."}
   *
   * @returns {Object}
   * @sampleResult {"name":"cachedContents/abc123","model":"models/gemini-2.5-flash","displayName":"contract-context","createTime":"2026-01-15T10:30:00.000Z","expireTime":"2026-01-15T11:30:00.000Z","usageMetadata":{"totalTokenCount":45231}}
   */
  async createCachedContent(model, text, files, systemInstruction, ttlSeconds, displayName) {
    const parts = await this.#buildParts(text, files, null, 'createCachedContent')

    if (!parts.length) {
      throw new Error('At least one of Text or Files must be provided to create cached content')
    }

    const body = {
      model: this.#normalizeModel(model),
      contents: [{ role: 'user', parts }],
      ttl: `${ ttlSeconds || 3600 }s`,
    }

    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] }
    }

    if (displayName) {
      body.displayName = displayName
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v1beta/cachedContents`,
      method: 'post',
      body,
      logTag: 'createCachedContent',
    })
  }

  /**
   * @operationName List Cached Contents
   * @category Context Caching
   * @description Lists cached content entries with their metadata (content itself is not returned). Supports pagination.
   * @route GET /list-cached-contents
   *
   * @appearanceColor #4285F4 #5E97F6
   *
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of cached contents to return per page. Defaults to 10."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous list response to retrieve the next page of results."}
   *
   * @returns {Object}
   * @sampleResult {"cachedContents":[{"name":"cachedContents/abc123","model":"models/gemini-2.5-flash","displayName":"contract-context","createTime":"2026-01-15T10:30:00.000Z","expireTime":"2026-01-15T11:30:00.000Z"}],"nextPageToken":null}
   */
  async listCachedContents(pageSize, pageToken) {
    const query = {}

    if (pageSize) {
      query.pageSize = pageSize
    }

    if (pageToken) {
      query.pageToken = pageToken
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v1beta/cachedContents`,
      query,
      logTag: 'listCachedContents',
    })
  }

  /**
   * @operationName Get Cached Content
   * @category Context Caching
   * @description Retrieves metadata for a specific cached content entry, including its model, expiration time, and token usage.
   * @route GET /get-cached-content
   *
   * @appearanceColor #4285F4 #5E97F6
   *
   * @paramDef {"type":"String","label":"Cache Name","name":"cacheName","required":true,"description":"The resource name of the cached content (e.g. 'cachedContents/abc123')."}
   *
   * @returns {Object}
   * @sampleResult {"name":"cachedContents/abc123","model":"models/gemini-2.5-flash","displayName":"contract-context","createTime":"2026-01-15T10:30:00.000Z","expireTime":"2026-01-15T11:30:00.000Z","usageMetadata":{"totalTokenCount":45231}}
   */
  async getCachedContent(cacheName) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v1beta/${ this.#normalizeResourceName(cacheName, 'cachedContents') }`,
      logTag: 'getCachedContent',
    })
  }

  /**
   * @operationName Update Cached Content
   * @category Context Caching
   * @description Updates the expiration (TTL) of a cached content entry, extending or shortening its lifetime. Cached content itself cannot be modified after creation.
   * @route PATCH /update-cached-content
   *
   * @appearanceColor #4285F4 #5E97F6
   *
   * @paramDef {"type":"String","label":"Cache Name","name":"cacheName","required":true,"description":"The resource name of the cached content to update (e.g. 'cachedContents/abc123')."}
   * @paramDef {"type":"Number","label":"TTL Seconds","name":"ttlSeconds","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New cache lifetime in seconds, counted from now."}
   *
   * @returns {Object}
   * @sampleResult {"name":"cachedContents/abc123","model":"models/gemini-2.5-flash","expireTime":"2026-01-15T12:30:00.000Z"}
   */
  async updateCachedContent(cacheName, ttlSeconds) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v1beta/${ this.#normalizeResourceName(cacheName, 'cachedContents') }`,
      method: 'patch',
      query: { updateMask: 'ttl' },
      body: { ttl: `${ ttlSeconds }s` },
      logTag: 'updateCachedContent',
    })
  }

  /**
   * @operationName Delete Cached Content
   * @category Context Caching
   * @description Deletes a cached content entry immediately, stopping further storage charges. Generation requests referencing the deleted cache will fail.
   * @route DELETE /delete-cached-content
   *
   * @appearanceColor #EA4335 #F28B82
   *
   * @paramDef {"type":"String","label":"Cache Name","name":"cacheName","required":true,"description":"The resource name of the cached content to delete (e.g. 'cachedContents/abc123')."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"cacheName":"cachedContents/abc123"}
   */
  async deleteCachedContent(cacheName) {
    await this.#apiRequest({
      url: `${ API_BASE_URL }/v1beta/${ this.#normalizeResourceName(cacheName, 'cachedContents') }`,
      method: 'delete',
      logTag: 'deleteCachedContent',
    })

    return { success: true, cacheName }
  }

  /**
   * @operationName Create Batch Job
   * @category Batch Processing
   * @description Submits an asynchronous batch generation job at 50% of the standard API cost with a 24-hour turnaround target. Provide simple text prompts, full GenerateContentRequest objects, or the name of a JSONL input file previously uploaded via 'Upload File' (required for jobs over 20 MB, up to 2 GB). Track the job with 'Get Batch Job'.
   * @route POST /create-batch-job
   *
   * @appearanceColor #34A853 #81C995
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getModelsDictionary","description":"The Gemini model to run the batch against."}
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","description":"Optional human-readable name for the batch job."}
   * @paramDef {"type":"Array<String>","label":"Prompts","name":"prompts","description":"Simple text prompts, one request per prompt. Provide exactly one of Prompts, Requests, or Input File Name."}
   * @paramDef {"type":"Array<Object>","label":"Requests","name":"requests","description":"Full GenerateContentRequest objects for advanced control, e.g. [{\"contents\":[{\"role\":\"user\",\"parts\":[{\"text\":\"...\"}]}],\"generationConfig\":{...}}]. Provide exactly one of Prompts, Requests, or Input File Name."}
   * @paramDef {"type":"String","label":"Input File Name","name":"inputFileName","description":"Name of a JSONL file uploaded to the Gemini Files API (e.g. 'files/abc123'), each line containing {\"key\":\"...\",\"request\":{...}}. Provide exactly one of Prompts, Requests, or Input File Name."}
   *
   * @returns {Object}
   * @sampleResult {"name":"batches/abc123","state":"BATCH_STATE_PENDING","operation":{"name":"batches/abc123","metadata":{"state":"BATCH_STATE_PENDING","createTime":"2026-01-15T10:30:00.000Z"},"done":false}}
   */
  async createBatchJob(model, displayName, prompts, requests, inputFileName) {
    const inputConfig = {}

    if (inputFileName) {
      inputConfig.fileName = this.#normalizeResourceName(inputFileName, 'files')
    } else {
      const inlineRequests = []

      if (prompts && prompts.length) {
        prompts.forEach((prompt, index) => {
          inlineRequests.push({
            request: { contents: [{ role: 'user', parts: [{ text: prompt }] }] },
            metadata: { key: `prompt-${ index + 1 }` },
          })
        })
      }

      if (requests && requests.length) {
        requests.forEach((request, index) => {
          inlineRequests.push(request.request
            ? request
            : { request, metadata: { key: `request-${ index + 1 }` } })
        })
      }

      if (!inlineRequests.length) {
        throw new Error('Provide one of Prompts, Requests, or Input File Name to create a batch job')
      }

      inputConfig.requests = { requests: inlineRequests }
    }

    const batch = { inputConfig }

    if (displayName) {
      batch.displayName = displayName
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1beta/${ this.#normalizeModel(model) }:batchGenerateContent`,
      method: 'post',
      body: { batch },
      logTag: 'createBatchJob',
    })

    return {
      name: response.name || null,
      state: response.metadata?.state || null,
      operation: response,
    }
  }

  /**
   * @operationName Get Batch Job
   * @category Batch Processing
   * @description Retrieves the status and results of a batch generation job. When the job has succeeded, inline results are returned directly; file-based jobs return an output file name to download with 'Download Batch Results'.
   * @route GET /get-batch-job
   *
   * @appearanceColor #4285F4 #5E97F6
   *
   * @paramDef {"type":"String","label":"Batch Name","name":"batchName","required":true,"description":"The batch job resource name returned by 'Create Batch Job' (e.g. 'batches/abc123')."}
   *
   * @returns {Object}
   * @sampleResult {"name":"batches/abc123","state":"BATCH_STATE_SUCCEEDED","done":true,"results":[{"metadata":{"key":"prompt-1"},"response":{"candidates":[{"content":{"parts":[{"text":"Answer text"}]}}]}}],"outputFileName":null,"error":null,"operation":{"name":"batches/abc123","done":true}}
   */
  async getBatchJob(batchName) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1beta/${ this.#normalizeResourceName(batchName, 'batches') }`,
      logTag: 'getBatchJob',
    })

    const inlined = response.response?.inlinedResponses
    const results = Array.isArray(inlined) ? inlined : inlined?.inlinedResponses || null

    return {
      name: response.name || batchName,
      state: response.metadata?.state || null,
      done: response.done === true,
      results,
      outputFileName: response.response?.responsesFile || response.metadata?.output?.responsesFile || null,
      error: response.error || null,
      operation: response,
    }
  }

  /**
   * @operationName List Batch Jobs
   * @category Batch Processing
   * @description Lists batch generation jobs with their states and metadata. Supports pagination.
   * @route GET /list-batch-jobs
   *
   * @appearanceColor #4285F4 #5E97F6
   *
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of batch jobs to return per page. Defaults to 10."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous list response to retrieve the next page of results."}
   *
   * @returns {Object}
   * @sampleResult {"operations":[{"name":"batches/abc123","metadata":{"state":"BATCH_STATE_RUNNING","createTime":"2026-01-15T10:30:00.000Z"},"done":false}],"nextPageToken":null}
   */
  async listBatchJobs(pageSize, pageToken) {
    const query = {}

    if (pageSize) {
      query.pageSize = pageSize
    }

    if (pageToken) {
      query.pageToken = pageToken
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/v1beta/batches`,
      query,
      logTag: 'listBatchJobs',
    })
  }

  /**
   * @operationName Cancel Batch Job
   * @category Batch Processing
   * @description Requests cancellation of a pending or running batch generation job. Requests already processed before cancellation may still be billed.
   * @route POST /cancel-batch-job
   *
   * @appearanceColor #EA4335 #F28B82
   *
   * @paramDef {"type":"String","label":"Batch Name","name":"batchName","required":true,"description":"The batch job resource name to cancel (e.g. 'batches/abc123')."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"batchName":"batches/abc123"}
   */
  async cancelBatchJob(batchName) {
    const normalizedName = this.#normalizeResourceName(batchName, 'batches')

    await this.#apiRequest({
      url: `${ API_BASE_URL }/v1beta/${ normalizedName }:cancel`,
      method: 'post',
      body: {},
      logTag: 'cancelBatchJob',
    })

    return { success: true, batchName: normalizedName }
  }

  /**
   * @operationName Delete Batch Job
   * @category Batch Processing
   * @description Deletes a batch generation job record. This removes the job from your list but does not cancel in-flight processing; cancel first if the job is still running.
   * @route DELETE /delete-batch-job
   *
   * @appearanceColor #EA4335 #F28B82
   *
   * @paramDef {"type":"String","label":"Batch Name","name":"batchName","required":true,"description":"The batch job resource name to delete (e.g. 'batches/abc123')."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"batchName":"batches/abc123"}
   */
  async deleteBatchJob(batchName) {
    const normalizedName = this.#normalizeResourceName(batchName, 'batches')

    await this.#apiRequest({
      url: `${ API_BASE_URL }/v1beta/${ normalizedName }`,
      method: 'delete',
      logTag: 'deleteBatchJob',
    })

    return { success: true, batchName: normalizedName }
  }

  /**
   * @operationName Download Batch Results
   * @category Batch Processing
   * @description Downloads and parses the JSONL results file of a completed file-based batch job, returning the parsed result objects. Use the output file name reported by 'Get Batch Job'.
   * @route GET /download-batch-results
   *
   * @appearanceColor #4285F4 #5E97F6
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"File Name","name":"fileName","required":true,"description":"The results file resource name from a completed batch job (e.g. 'files/batch-abc123-output')."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"key":"request-1","response":{"candidates":[{"content":{"parts":[{"text":"Answer text"}]}}]}}],"count":1}
   */
  async downloadBatchResults(fileName) {
    const normalizedName = this.#normalizeResourceName(fileName, 'files')

    const raw = await this.#apiRequest({
      url: `${ DOWNLOAD_BASE_URL }/v1beta/${ normalizedName }:download`,
      query: { alt: 'media' },
      logTag: 'downloadBatchResults',
    })

    const content = Buffer.isBuffer(raw) ? raw.toString('utf8') : typeof raw === 'string' ? raw : JSON.stringify(raw)

    const results = content
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line)
        } catch (error) {
          logger.warn(`downloadBatchResults - skipping unparseable line: ${ error.message }`)

          return null
        }
      })
      .filter(Boolean)

    return { results, count: results.length }
  }

}

/**
 * @typedef {Object} FileReference
 * @paramDef {"type":"String","label":"URI","name":"uri","required":true,"description":"URI of the file to include. Can be a Gemini Files API URI, Google Cloud Storage URI, or any publicly accessible URL."}
 * @paramDef {"type":"String","label":"MIME Type","name":"mimeType","required":true,"description":"MIME type of the file (e.g., 'application/pdf', 'image/png')."}
 */

/**
 * @typedef {Object} SafetySetting
 * @paramDef {"type":"String","label":"Category","name":"category","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Harassment","Hate Speech","Sexually Explicit","Dangerous Content","Civic Integrity"]}},"description":"The harm category this threshold applies to."}
 * @paramDef {"type":"String","label":"Threshold","name":"threshold","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Block None","Block Only High","Block Medium And Above","Block Low And Above","Off"]}},"description":"Blocking threshold for the category. 'Block None' returns content with safety ratings, 'Off' disables the safety filter entirely."}
 */

/**
 * @typedef {Object} SpeakerVoice
 * @paramDef {"type":"String","label":"Speaker","name":"speaker","required":true,"description":"Speaker name exactly as it appears in the transcript text (e.g. 'Joe' for lines like 'Joe: Hello')."}
 * @paramDef {"type":"String","label":"Voice Name","name":"voiceName","required":true,"description":"Prebuilt voice to use for this speaker (e.g. 'Kore', 'Puck', 'Zephyr')."}
 */

Flowrunner.ServerCode.addService(GeminiAIService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Gemini API key from https://aistudio.google.com/apikey',
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
