'use strict'

const API_BASE_URL = 'https://api.openai.com'

const DEFAULT_MODERATION_MODEL = 'omni-moderation-latest'
const DEFAULT_TTS_MODEL = 'tts-1'
const DEFAULT_TTS_VOICE = 'alloy'
const DEFAULT_TTS_RESPONSE_FORMAT = 'mp3'
const DEFAULT_TTS_SPEED = 1.0
const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe'
const DEFAULT_TRANSCRIPTION_TEMPERATURE = 0
const DEFAULT_RESPONSES_MODEL = 'gpt-4o'
const DEFAULT_CHAT_MODEL = 'gpt-4o'
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small'
const DEFAULT_IMAGE_MODEL = 'gpt-image-1'
const DEFAULT_VIDEO_MODEL = 'sora-2'
const TRANSLATION_MODEL = 'whisper-1'
const BATCH_COMPLETION_WINDOW = '24h'

const REASONING_EFFORT_OPTIONS = { 'None': 'none', 'Minimal': 'minimal', 'Low': 'low', 'Medium': 'medium', 'High': 'high' }
const SORT_ORDER_OPTIONS = { 'Ascending': 'asc', 'Descending': 'desc' }
const FILE_PURPOSE_OPTIONS = {
  'Assistants': 'assistants', 'Batch': 'batch', 'Fine-tune': 'fine-tune',
  'Vision': 'vision', 'User Data': 'user_data', 'Evals': 'evals',
}
const IMAGE_SIZE_OPTIONS = {
  'Auto': 'auto', 'Square (1024x1024)': '1024x1024', 'Landscape (1536x1024)': '1536x1024',
  'Portrait (1024x1536)': '1024x1536', 'Wide (1792x1024)': '1792x1024', 'Tall (1024x1792)': '1024x1792',
  'Small (256x256)': '256x256', 'Medium (512x512)': '512x512',
}
const IMAGE_QUALITY_OPTIONS = {
  'Auto': 'auto', 'Low': 'low', 'Medium': 'medium', 'High': 'high', 'Standard': 'standard', 'HD': 'hd',
}
const IMAGE_BACKGROUND_OPTIONS = { 'Auto': 'auto', 'Transparent': 'transparent', 'Opaque': 'opaque' }
const IMAGE_OUTPUT_FORMAT_OPTIONS = { 'PNG': 'png', 'JPEG': 'jpeg', 'WebP': 'webp' }
const CHAT_RESPONSE_FORMAT_OPTIONS = { 'Text': 'text', 'JSON Object': 'json_object', 'JSON Schema': 'json_schema' }
const BATCH_ENDPOINT_OPTIONS = {
  'Responses': '/v1/responses', 'Chat Completions': '/v1/chat/completions',
  'Embeddings': '/v1/embeddings', 'Completions': '/v1/completions',
}
const VECTOR_STORE_FILE_FILTER_OPTIONS = {
  'In Progress': 'in_progress', 'Completed': 'completed', 'Failed': 'failed', 'Cancelled': 'cancelled',
}
const VIDEO_MODEL_OPTIONS = { 'Sora 2': 'sora-2', 'Sora 2 Pro': 'sora-2-pro' }
const VIDEO_SECONDS_OPTIONS = { '4 Seconds': '4', '8 Seconds': '8', '12 Seconds': '12' }
const VIDEO_SIZE_OPTIONS = {
  'Portrait (720x1280)': '720x1280', 'Landscape (1280x720)': '1280x720',
  'Portrait HD (1024x1792)': '1024x1792', 'Landscape HD (1792x1024)': '1792x1024',
}
const VIDEO_VARIANT_OPTIONS = { 'Video': 'video', 'Thumbnail': 'thumbnail', 'Spritesheet': 'spritesheet' }
const VIDEO_VARIANT_EXTENSIONS = { video: 'mp4', thumbnail: 'webp', spritesheet: 'jpg' }

const logger = {
  info: (...args) => console.log('[OpenAI] info:', ...args),
  debug: (...args) => console.log('[OpenAI] debug:', ...args),
  error: (...args) => console.log('[OpenAI] error:', ...args),
  warn: (...args) => console.log('[OpenAI] warn:', ...args),
}

/**
 * @usesFileStorage
 * @integrationName OpenAI
 * @integrationIcon /icon.svg
 */
class OpenAIService {
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

  #extractFileName(url) {
    const pathname = url.split('?')[0].split('#')[0]

    return pathname.split('/').pop() || 'audio'
  }

  #compact(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined && value !== null))
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  async #downloadToBuffer(fileUrl, logTag) {
    if (!fileUrl || !/^https?:\/\//i.test(fileUrl)) {
      throw new Error(`Invalid file URL '${ fileUrl }'. Should start with 'http://' or 'https://'`)
    }

    logger.debug(`${ logTag } - downloading file from: ${ fileUrl }`)

    const rawBytes = await Flowrunner.Request.get(fileUrl).setEncoding(null)

    return Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(rawBytes)
  }

  async #uploadImagesFromResponse(response, extension, fileOptions) {
    const files = []

    for (const item of response.data || []) {
      if (item.b64_json) {
        const buffer = Buffer.from(item.b64_json, 'base64')

        const { url } = await this.flowrunner.Files.uploadFile(buffer, {
          filename: `image_${ Date.now() }_${ files.length }.${ extension }`,
          generateUrl: true,
          overwrite: true,
          ...(fileOptions || { scope: 'FLOW' }),
        })

        files.push({ fileURL: url, revisedPrompt: item.revised_prompt })
      } else if (item.url) {
        files.push({ fileURL: item.url, revisedPrompt: item.revised_prompt })
      }
    }

    return files
  }

  async #getModelsDictionary(payload, filterFn) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/models`,
      method: 'get',
      logTag: 'getModelsDictionary',
    })

    let models = (response.data || []).filter(model => filterFn(model.id))

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      models = models.filter(model => model.id.toLowerCase().includes(searchLower))
    }

    return {
      items: models
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(model => ({ label: model.id, value: model.id, note: model.id })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getTtsModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — OpenAI's model list is not paginated."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get TTS Models Dictionary
   * @description Provides a searchable, live list of OpenAI text-to-speech models for dynamic parameter selection.
   * @route POST /get-tts-models-dictionary
   * @paramDef {"type":"getTtsModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"gpt-4o-mini-tts","value":"gpt-4o-mini-tts","note":"gpt-4o-mini-tts"},{"label":"tts-1","value":"tts-1","note":"tts-1"},{"label":"tts-1-hd","value":"tts-1-hd","note":"tts-1-hd"}],"cursor":null}
   */
  async getTtsModelsDictionary(payload) {
    return this.#getModelsDictionary(payload, id => /^tts-|-tts$/.test(id))
  }

  /**
   * @typedef {Object} getTranscriptionModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — OpenAI's model list is not paginated."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Transcription Models Dictionary
   * @description Provides a searchable, live list of OpenAI speech-to-text models for dynamic parameter selection.
   * @route POST /get-transcription-models-dictionary
   * @paramDef {"type":"getTranscriptionModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"gpt-4o-transcribe","value":"gpt-4o-transcribe","note":"gpt-4o-transcribe"},{"label":"whisper-1","value":"whisper-1","note":"whisper-1"}],"cursor":null}
   */
  async getTranscriptionModelsDictionary(payload) {
    return this.#getModelsDictionary(payload, id => /whisper|transcribe/.test(id))
  }

  /**
   * @typedef {Object} getWebSearchModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — OpenAI's model list is not paginated."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Web Search Models Dictionary
   * @description Provides a searchable, live list of OpenAI models that support the Responses API web search tool.
   * @route POST /get-web-search-models-dictionary
   * @paramDef {"type":"getWebSearchModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"gpt-4o","value":"gpt-4o","note":"gpt-4o"},{"label":"gpt-4.1","value":"gpt-4.1","note":"gpt-4.1"}],"cursor":null}
   */
  async getWebSearchModelsDictionary(payload) {
    return this.#getModelsDictionary(payload, id =>
      /^(gpt-|o[134])/.test(id) &&
      !/tts|transcribe|whisper|embedding|moderation|dall-e|image|audio|realtime|computer-use/.test(id))
  }

  /**
   * @typedef {Object} getModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — OpenAI's model list is not paginated."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Models Dictionary
   * @description Provides a searchable, live list of all models available to the account for dynamic parameter selection.
   * @route POST /get-models-dictionary
   * @paramDef {"type":"getModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"gpt-4o","value":"gpt-4o","note":"gpt-4o"},{"label":"text-embedding-3-small","value":"text-embedding-3-small","note":"text-embedding-3-small"}],"cursor":null}
   */
  async getModelsDictionary(payload) {
    return this.#getModelsDictionary(payload, () => true)
  }

  /**
   * @typedef {Object} getChatModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — OpenAI's model list is not paginated."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Chat Models Dictionary
   * @description Provides a searchable, live list of OpenAI text-generation models (GPT and o-series) suitable for the Responses and Chat Completions APIs.
   * @route POST /get-chat-models-dictionary
   * @paramDef {"type":"getChatModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"gpt-4.1","value":"gpt-4.1","note":"gpt-4.1"},{"label":"gpt-4o","value":"gpt-4o","note":"gpt-4o"}],"cursor":null}
   */
  async getChatModelsDictionary(payload) {
    return this.#getModelsDictionary(payload, id =>
      /^(gpt-|o[134])/.test(id) &&
      !/tts|transcribe|whisper|embedding|moderation|dall-e|image|audio|realtime|computer-use/.test(id))
  }

  /**
   * @typedef {Object} getEmbeddingModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — OpenAI's model list is not paginated."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Embedding Models Dictionary
   * @description Provides a searchable, live list of OpenAI embedding models for dynamic parameter selection.
   * @route POST /get-embedding-models-dictionary
   * @paramDef {"type":"getEmbeddingModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"text-embedding-3-large","value":"text-embedding-3-large","note":"text-embedding-3-large"},{"label":"text-embedding-3-small","value":"text-embedding-3-small","note":"text-embedding-3-small"}],"cursor":null}
   */
  async getEmbeddingModelsDictionary(payload) {
    return this.#getModelsDictionary(payload, id => /embedding/.test(id))
  }

  /**
   * @typedef {Object} getImageModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — OpenAI's model list is not paginated."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Image Models Dictionary
   * @description Provides a searchable, live list of OpenAI image generation models (gpt-image and DALL·E families) for dynamic parameter selection.
   * @route POST /get-image-models-dictionary
   * @paramDef {"type":"getImageModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"dall-e-3","value":"dall-e-3","note":"dall-e-3"},{"label":"gpt-image-1","value":"gpt-image-1","note":"gpt-image-1"}],"cursor":null}
   */
  async getImageModelsDictionary(payload) {
    return this.#getModelsDictionary(payload, id => /^(dall-e|gpt-image)/.test(id))
  }

  /**
   * @typedef {Object} getFilesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter files by filename or ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous dictionary response."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Files Dictionary
   * @description Provides a searchable, paginated list of files uploaded to the OpenAI account for dynamic parameter selection.
   * @route POST /get-files-dictionary
   * @paramDef {"type":"getFilesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"batch_input.jsonl","value":"file-abc123","note":"batch"}],"cursor":null}
   */
  async getFilesDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/files`,
      method: 'get',
      query: this.#compact({ limit: 100, after: cursor || undefined }),
      logTag: 'getFilesDictionary',
    })

    let files = response.data || []

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      files = files.filter(file =>
        (file.filename || '').toLowerCase().includes(searchLower) ||
        (file.id || '').toLowerCase().includes(searchLower))
    }

    return {
      items: files.map(file => ({ label: file.filename || file.id, value: file.id, note: file.purpose })),
      cursor: response.has_more ? response.last_id : null,
    }
  }

  /**
   * @typedef {Object} getVectorStoresDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter vector stores by name or ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous dictionary response."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Vector Stores Dictionary
   * @description Provides a searchable, paginated list of vector stores in the OpenAI account for dynamic parameter selection.
   * @route POST /get-vector-stores-dictionary
   * @paramDef {"type":"getVectorStoresDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Support FAQ","value":"vs_abc123","note":"completed"}],"cursor":null}
   */
  async getVectorStoresDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/vector_stores`,
      method: 'get',
      query: this.#compact({ limit: 100, after: cursor || undefined }),
      logTag: 'getVectorStoresDictionary',
    })

    let stores = response.data || []

    if (search?.trim()) {
      const searchLower = search.toLowerCase()

      stores = stores.filter(store =>
        (store.name || '').toLowerCase().includes(searchLower) ||
        (store.id || '').toLowerCase().includes(searchLower))
    }

    return {
      items: stores.map(store => ({ label: store.name || store.id, value: store.id, note: store.status })),
      cursor: response.has_more ? response.last_id : null,
    }
  }

  /**
   * @operationName Moderate Content
   * @description Analyzes text and image inputs for harmful content across multiple safety categories (harassment, hate speech, violence, sexual content, self-harm, and more) using OpenAI's Moderation API. Returns per-category flags and confidence scores for each input.
   * @category Moderation
   * @route POST /moderate-content
   *
   * @paramDef {"type":"Array<String>","label":"Text Inputs","name":"textInputs","description":"List of text strings to check for policy violations."}
   * @paramDef {"type":"Array<String>","label":"Image Inputs","name":"imageInputs","description":"List of publicly accessible image URLs to check for policy violations."}
   *
   * @returns {Object}
   * @sampleResult {"flagged":true,"categories":{"harassment":true,"hate":true,"violence":true,"sexual":false,"self-harm":false},"category_scores":{"harassment":0.92,"hate":0.88,"violence":0.79,"sexual":0.12,"self-harm":0.0},"category_applied_input_types":{"harassment":["text"],"hate":["text"],"violence":["text"],"sexual":["text"],"self-harm":["text"]}}
   */
  async moderateContent(textInputs, imageInputs) {
    const input = [
      ...(textInputs || []).map(text => ({ type: 'text', text })),
      ...(imageInputs || []).map(url => ({ type: 'image_url', image_url: { url } })),
    ]

    if (!input.length) {
      throw new Error('At least one text or image input is required')
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/moderations`,
      body: { model: DEFAULT_MODERATION_MODEL, input },
      logTag: 'moderateContent',
    })

    return response.results[0]
  }

  /**
   * @operationName Text to Speech
   * @description Converts text into natural-sounding speech audio using OpenAI's text-to-speech models. Uploads the generated audio file and returns its URL. The maximum allowed input length is 4096 characters. With the 'gpt-4o-mini-tts' model, optional voice instructions can control tone, accent, pacing, and emotion.
   * @category Audio
   * @route POST /text-to-speech
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Input Text","name":"input","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text to convert to speech. Maximum length is 4096 characters."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getTtsModelsDictionary","defaultValue":"tts-1","description":"The text-to-speech model to use. Defaults to 'tts-1'."}
   * @paramDef {"type":"String","label":"Voice","name":"voice","uiComponent":{"type":"DROPDOWN","options":{"values":["alloy","ash","coral","echo","fable","onyx","nova","sage","shimmer","ballad","verse","marin","cedar"]}},"defaultValue":"alloy","description":"The voice to use for the generated audio. Defaults to 'alloy'. The 'ballad', 'verse', 'marin', and 'cedar' voices require the 'gpt-4o-mini-tts' model."}
   * @paramDef {"type":"String","label":"Response Format","name":"responseFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["mp3","opus","aac","flac","wav","pcm"]}},"defaultValue":"mp3","description":"The audio file format of the output. Defaults to 'mp3'."}
   * @paramDef {"type":"Number","label":"Speed","name":"speed","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":1,"description":"The speed of the generated audio, between 0.25 and 4.0. Defaults to 1.0."}
   * @paramDef {"type":"String","label":"Voice Instructions","name":"instructions","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional instructions controlling how the text is spoken (tone, accent, pacing, emotion), e.g. 'Speak in a cheerful and positive tone.'. Only supported by the 'gpt-4o-mini-tts' model — not by 'tts-1' or 'tts-1-hd'."}
   *
   * @returns {Object}
   * @sampleResult {"fileURL":"https://example.com/files/automation/tmp/result.mp3"}
   */
  async textToSpeech(input, model, voice, responseFormat, speed, instructions) {
    if (!input || !input.trim()) {
      throw new Error('Input text is required')
    }

    if (input.length > 4096) {
      throw new Error('The maximum allowed text length is 4096 characters')
    }

    const resolvedFormat = responseFormat || DEFAULT_TTS_RESPONSE_FORMAT

    const audioBytes = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/audio/speech`,
      binary: true,
      body: {
        model: model || DEFAULT_TTS_MODEL,
        input,
        voice: voice || DEFAULT_TTS_VOICE,
        response_format: resolvedFormat,
        speed: speed || DEFAULT_TTS_SPEED,
        ...(instructions ? { instructions } : {}),
      },
      logTag: 'textToSpeech',
    })

    const buffer = Buffer.isBuffer(audioBytes) ? audioBytes : Buffer.from(audioBytes)

    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename: `tts_${ Date.now() }.${ resolvedFormat }`,
      generateUrl: true,
      overwrite: true,
      scope: 'FLOW',
    })

    return { fileURL: url }
  }

  /**
   * @operationName Speech to Text
   * @description Transcribes an audio file into text using OpenAI's speech recognition models. Downloads the audio from the provided URL and returns the transcribed text.
   * @category Audio
   * @route POST /speech-to-text
   *
   * @executionTimeoutInSeconds 180
   *
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"description":"Publicly accessible URL of the audio file to transcribe. Must start with 'http://' or 'https://'."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getTranscriptionModelsDictionary","defaultValue":"gpt-4o-transcribe","description":"The transcription model to use. Defaults to 'gpt-4o-transcribe'."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Optional ISO-639-1 language code of the audio (e.g. 'en'). Improves accuracy and latency if known in advance."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional text to guide the model's style or provide context, such as expected vocabulary or names."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":0,"description":"Sampling temperature between 0 and 1. Defaults to 0 for deterministic output."}
   *
   * @returns {Object}
   * @sampleResult {"text":"Welcome everyone to the quarterly business review. Today, we'll discuss our growth strategy and key performance indicators."}
   */
  async speechToText(fileUrl, model, language, prompt, temperature) {
    if (!fileUrl || !/^https?:\/\//i.test(fileUrl)) {
      throw new Error(`Invalid fileUrl '${ fileUrl }'. Should start with 'http://' or 'https://'`)
    }

    logger.debug(`speechToText - downloading file from: ${ fileUrl }`)

    const rawFileBytes = await Flowrunner.Request.get(fileUrl).setEncoding(null)
    const fileBuffer = Buffer.isBuffer(rawFileBytes) ? rawFileBytes : Buffer.from(rawFileBytes)

    const form = new Flowrunner.Request.FormData()

    form.append('file', fileBuffer, { filename: this.#extractFileName(fileUrl) })
    form.append('model', model || DEFAULT_TRANSCRIPTION_MODEL)
    form.append('response_format', 'text')
    form.append('temperature', String(temperature ?? DEFAULT_TRANSCRIPTION_TEMPERATURE))

    if (language) {
      form.append('language', language)
    }

    if (prompt) {
      form.append('prompt', prompt)
    }

    const text = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/audio/transcriptions`,
      form,
      logTag: 'speechToText',
    })

    return { text: typeof text === 'string' ? text : String(text) }
  }

  /**
   * @operationName Translate Audio
   * @description Translates spoken audio in any supported language into English text using OpenAI's Whisper model. Downloads the audio from the provided URL, sends it to the Audio Translations API, and returns the English translation.
   * @category Audio
   * @route POST /translate-audio
   *
   * @executionTimeoutInSeconds 180
   *
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"description":"Publicly accessible URL of the audio file to translate into English. Must start with 'http://' or 'https://'."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional English text to guide the model's style or provide context, such as expected vocabulary or names."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature between 0 and 1. Lower values produce more deterministic output."}
   *
   * @returns {Object}
   * @sampleResult {"text":"Hello, welcome to our quarterly business review."}
   */
  async translateAudio(fileUrl, prompt, temperature) {
    const fileBuffer = await this.#downloadToBuffer(fileUrl, 'translateAudio')

    const form = new Flowrunner.Request.FormData()

    form.append('file', fileBuffer, { filename: this.#extractFileName(fileUrl) })
    form.append('model', TRANSLATION_MODEL)
    form.append('response_format', 'text')

    if (prompt) {
      form.append('prompt', prompt)
    }

    if (temperature !== undefined && temperature !== null) {
      form.append('temperature', String(temperature))
    }

    const text = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/audio/translations`,
      form,
      logTag: 'translateAudio',
    })

    return { text: typeof text === 'string' ? text : String(text) }
  }

  /**
   * @operationName Web Search
   * @description Generates a grounded answer to a prompt by letting the model search the web for current information. Returns the answer text along with cited source URLs.
   * @category Web Search
   * @route POST /web-search
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The question or instruction to answer using current web search results."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getWebSearchModelsDictionary","defaultValue":"gpt-4o","description":"The model to use for the search-grounded response. Defaults to 'gpt-4o'."}
   *
   * @returns {Object}
   * @sampleResult {"text":"The current Node.js LTS release line is 22.x.","sources":[{"title":"Node.js Releases","url":"https://nodejs.org/en/about/previous-releases"}]}
   */
  async webSearch(prompt, model) {
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/responses`,
      body: {
        model: model || DEFAULT_RESPONSES_MODEL,
        input: prompt,
        tools: [{ type: 'web_search' }],
      },
      logTag: 'webSearch',
    })

    const message = (response.output || []).find(item => item.type === 'message')
    const textContent = (message?.content || []).find(item => item.type === 'output_text')

    const sources = (textContent?.annotations || [])
      .filter(annotation => annotation.type === 'url_citation')
      .map(annotation => ({ title: annotation.title, url: annotation.url }))

    return {
      text: textContent?.text || '',
      sources,
    }
  }

  /**
   * @operationName Create Response
   * @description Generates a model response via OpenAI's Responses API — the primary interface for text generation. Supports plain text input or a full input items array (multi-turn conversations, vision image parts), system instructions, reasoning effort for reasoning models, structured JSON output via a JSON schema, conversation chaining via a previous response ID, background execution, custom function tools, and OpenAI's built-in tools: web search, file search over vector stores, and code interpreter. Returns the full response object with a convenience 'outputText' field containing the concatenated assistant text.
   * @category Responses
   * @route POST /create-response
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Input Text","name":"input","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Plain text input to the model. Either this or Input Items is required."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getChatModelsDictionary","defaultValue":"gpt-4o","description":"The model to use. Defaults to 'gpt-4o'. Pick from the live model list or paste a model ID."}
   * @paramDef {"type":"String","label":"Instructions","name":"instructions","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"System/developer instructions that steer the model's behavior for this response."}
   * @paramDef {"type":"Array<Object>","label":"Input Items","name":"inputItems","description":"Advanced: full input items array instead of plain text, e.g. [{\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"Describe this image\"},{\"type\":\"input_image\",\"image_url\":\"https://...\"}]}]. Supports multi-turn conversations and vision content parts. Takes precedence over Input Text when provided."}
   * @paramDef {"type":"String","label":"Previous Response ID","name":"previousResponseId","description":"ID of a previous response to continue the conversation from. The model receives the full prior context automatically."}
   * @paramDef {"type":"Boolean","label":"Store","name":"store","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"Whether to store the response on OpenAI's servers so it can be retrieved later or chained via Previous Response ID. Defaults to true."}
   * @paramDef {"type":"Boolean","label":"Background","name":"background","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the response is generated asynchronously in the background. Poll it with 'Get Response' until its status is 'completed'. Useful for long reasoning tasks."}
   * @paramDef {"type":"String","label":"Reasoning Effort","name":"reasoningEffort","uiComponent":{"type":"DROPDOWN","options":{"values":["None","Minimal","Low","Medium","High"]}},"description":"Reasoning effort for reasoning-capable models (o-series, GPT-5 family). Higher effort improves quality on hard problems at higher latency and cost. Leave empty to use the model's default. Not supported by non-reasoning models."}
   * @paramDef {"type":"Number","label":"Max Output Tokens","name":"maxOutputTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Upper bound on generated tokens, including reasoning tokens."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature between 0 and 2. Higher values make output more random. Not supported by reasoning models."}
   * @paramDef {"type":"Number","label":"Top P","name":"topP","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Nucleus sampling threshold between 0 and 1. Alter this or Temperature, not both."}
   * @paramDef {"type":"String","label":"JSON Schema Name","name":"jsonSchemaName","description":"Name for the structured output schema. Used only when JSON Schema is provided. Defaults to 'response'."}
   * @paramDef {"type":"Object","label":"JSON Schema","name":"jsonSchema","description":"JSON Schema for structured output, e.g. {\"type\":\"object\",\"properties\":{\"city\":{\"type\":\"string\"}},\"required\":[\"city\"],\"additionalProperties\":false}. When provided, the model is constrained to return JSON matching this schema (strict mode)."}
   * @paramDef {"type":"Boolean","label":"Enable Web Search","name":"enableWebSearch","uiComponent":{"type":"TOGGLE"},"description":"Adds OpenAI's built-in web search tool so the model can look up current information and cite sources."}
   * @paramDef {"type":"Array<String>","label":"File Search Vector Store IDs","name":"vectorStoreIds","description":"Vector store IDs to search with OpenAI's built-in file search tool (RAG over your uploaded files). Providing at least one ID enables the tool."}
   * @paramDef {"type":"Boolean","label":"Enable Code Interpreter","name":"enableCodeInterpreter","uiComponent":{"type":"TOGGLE"},"description":"Adds OpenAI's built-in code interpreter tool so the model can write and run Python code in a sandboxed container."}
   * @paramDef {"type":"Array<Object>","label":"Tools","name":"tools","description":"Additional tool definitions passed through verbatim, e.g. custom function tools: [{\"type\":\"function\",\"name\":\"get_weather\",\"description\":\"...\",\"parameters\":{...}}]. Function calls appear in the output array as 'function_call' items."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","description":"Up to 16 key-value string pairs to attach to the response, e.g. {\"flow\":\"onboarding\"}."}
   *
   * @returns {Object}
   * @sampleResult {"id":"resp_abc123","object":"response","status":"completed","model":"gpt-4o-2024-08-06","output":[{"type":"message","id":"msg_abc123","role":"assistant","content":[{"type":"output_text","text":"Hello! How can I help you today?","annotations":[]}]}],"usage":{"input_tokens":12,"output_tokens":10,"total_tokens":22},"outputText":"Hello! How can I help you today?"}
   */
  async createResponse(input, model, instructions, inputItems, previousResponseId, store, background, reasoningEffort,
    maxOutputTokens, temperature, topP, jsonSchemaName, jsonSchema, enableWebSearch, vectorStoreIds,
    enableCodeInterpreter, tools, metadata) {
    const resolvedInput = inputItems?.length ? inputItems : input

    if (!resolvedInput || (typeof resolvedInput === 'string' && !resolvedInput.trim())) {
      throw new Error('Either Input Text or Input Items is required')
    }

    const resolvedTools = []

    if (enableWebSearch) {
      resolvedTools.push({ type: 'web_search' })
    }

    if (vectorStoreIds?.length) {
      resolvedTools.push({ type: 'file_search', vector_store_ids: vectorStoreIds })
    }

    if (enableCodeInterpreter) {
      resolvedTools.push({ type: 'code_interpreter', container: { type: 'auto' } })
    }

    if (tools?.length) {
      resolvedTools.push(...tools)
    }

    const effort = this.#resolveChoice(reasoningEffort, REASONING_EFFORT_OPTIONS)

    const body = this.#compact({
      model: model || DEFAULT_RESPONSES_MODEL,
      input: resolvedInput,
      instructions: instructions || undefined,
      previous_response_id: previousResponseId || undefined,
      store,
      background: background || undefined,
      reasoning: effort ? { effort } : undefined,
      max_output_tokens: maxOutputTokens,
      temperature,
      top_p: topP,
      text: jsonSchema
        ? { format: { type: 'json_schema', name: jsonSchemaName || 'response', schema: jsonSchema, strict: true } }
        : undefined,
      tools: resolvedTools.length ? resolvedTools : undefined,
      metadata,
    })

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/responses`,
      body,
      logTag: 'createResponse',
    })

    return { ...response, outputText: extractOutputText(response) }
  }

  /**
   * @operationName Get Response
   * @description Retrieves a previously created model response by its ID, including its status, output items, and token usage. Use this to poll background responses until they complete, or to inspect stored responses. Adds a convenience 'outputText' field with the concatenated assistant text.
   * @category Responses
   * @route GET /get-response
   *
   * @paramDef {"type":"String","label":"Response ID","name":"responseId","required":true,"description":"The ID of the response to retrieve, e.g. 'resp_abc123'."}
   *
   * @returns {Object}
   * @sampleResult {"id":"resp_abc123","object":"response","status":"completed","model":"gpt-4o-2024-08-06","output":[{"type":"message","id":"msg_abc123","role":"assistant","content":[{"type":"output_text","text":"Hello! How can I help you today?","annotations":[]}]}],"usage":{"input_tokens":12,"output_tokens":10,"total_tokens":22},"outputText":"Hello! How can I help you today?"}
   */
  async getResponse(responseId) {
    if (!responseId) {
      throw new Error('Response ID is required')
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/responses/${ encodeURIComponent(responseId) }`,
      method: 'get',
      logTag: 'getResponse',
    })

    return { ...response, outputText: extractOutputText(response) }
  }

  /**
   * @operationName Cancel Response
   * @description Cancels an in-progress model response that was created with Background enabled. Only background responses can be cancelled.
   * @category Responses
   * @route POST /cancel-response
   *
   * @paramDef {"type":"String","label":"Response ID","name":"responseId","required":true,"description":"The ID of the background response to cancel, e.g. 'resp_abc123'."}
   *
   * @returns {Object}
   * @sampleResult {"id":"resp_abc123","object":"response","status":"cancelled","model":"gpt-4o-2024-08-06","output":[]}
   */
  async cancelResponse(responseId) {
    if (!responseId) {
      throw new Error('Response ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/responses/${ encodeURIComponent(responseId) }/cancel`,
      body: {},
      logTag: 'cancelResponse',
    })
  }

  /**
   * @operationName Delete Response
   * @description Permanently deletes a stored model response by its ID from OpenAI's servers.
   * @category Responses
   * @route DELETE /delete-response
   *
   * @paramDef {"type":"String","label":"Response ID","name":"responseId","required":true,"description":"The ID of the response to delete, e.g. 'resp_abc123'."}
   *
   * @returns {Object}
   * @sampleResult {"id":"resp_abc123","object":"response","deleted":true}
   */
  async deleteResponse(responseId) {
    if (!responseId) {
      throw new Error('Response ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/responses/${ encodeURIComponent(responseId) }`,
      method: 'delete',
      logTag: 'deleteResponse',
    })
  }

  /**
   * @operationName List Response Input Items
   * @description Lists the input items (messages, tool calls, etc.) that were used to generate a stored response, with cursor-based pagination.
   * @category Responses
   * @route GET /list-response-input-items
   *
   * @paramDef {"type":"String","label":"Response ID","name":"responseId","required":true,"description":"The ID of the response whose input items to list, e.g. 'resp_abc123'."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of items to return, between 1 and 100. Defaults to 20."}
   * @paramDef {"type":"String","label":"After","name":"after","description":"Pagination cursor: an item ID after which to continue listing."}
   * @paramDef {"type":"String","label":"Order","name":"order","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort order of the returned items. Defaults to descending."}
   *
   * @returns {Object}
   * @sampleResult {"object":"list","data":[{"id":"msg_abc123","type":"message","role":"user","content":[{"type":"input_text","text":"Tell me a joke"}]}],"first_id":"msg_abc123","last_id":"msg_abc123","has_more":false}
   */
  async listResponseInputItems(responseId, limit, after, order) {
    if (!responseId) {
      throw new Error('Response ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/responses/${ encodeURIComponent(responseId) }/input_items`,
      method: 'get',
      query: this.#compact({
        limit,
        after: after || undefined,
        order: this.#resolveChoice(order, SORT_ORDER_OPTIONS),
      }),
      logTag: 'listResponseInputItems',
    })
  }

  /**
   * @operationName Create Chat Completion
   * @description Generates a model response via OpenAI's Chat Completions API from a full messages array (system/user/assistant/tool roles, including vision image content parts). Supports sampling controls, max completion tokens and reasoning effort for reasoning models, deterministic seeding, stop sequences, structured output (JSON object or strict JSON schema), and function tool calling with tool choice. Returns the raw completion with choices and token usage. For new workflows, prefer 'Create Response' — the Responses API is OpenAI's primary interface.
   * @category Chat
   * @route POST /create-chat-completion
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"Array<Object>","label":"Messages","name":"messages","required":true,"description":"Conversation messages, e.g. [{\"role\":\"system\",\"content\":\"You are helpful.\"},{\"role\":\"user\",\"content\":\"Hello\"}]. Content may also be an array of content parts for vision models, e.g. [{\"type\":\"text\",\"text\":\"Describe this\"},{\"type\":\"image_url\",\"image_url\":{\"url\":\"https://...\"}}]."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getChatModelsDictionary","defaultValue":"gpt-4o","description":"The model to use. Defaults to 'gpt-4o'. Pick from the live model list or paste a model ID."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature between 0 and 2. Higher values make output more random. Not supported by reasoning models."}
   * @paramDef {"type":"Number","label":"Top P","name":"topP","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Nucleus sampling threshold between 0 and 1. Alter this or Temperature, not both."}
   * @paramDef {"type":"Number","label":"Max Completion Tokens","name":"maxCompletionTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Upper bound on generated tokens, including reasoning tokens. Replaces the deprecated 'max_tokens' parameter."}
   * @paramDef {"type":"String","label":"Reasoning Effort","name":"reasoningEffort","uiComponent":{"type":"DROPDOWN","options":{"values":["None","Minimal","Low","Medium","High"]}},"description":"Reasoning effort for reasoning-capable models (o-series, GPT-5 family). Leave empty to use the model's default. Not supported by non-reasoning models."}
   * @paramDef {"type":"Number","label":"Frequency Penalty","name":"frequencyPenalty","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Between -2.0 and 2.0. Positive values penalize tokens by their existing frequency, reducing verbatim repetition."}
   * @paramDef {"type":"Number","label":"Presence Penalty","name":"presencePenalty","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Between -2.0 and 2.0. Positive values penalize tokens that already appeared, encouraging new topics."}
   * @paramDef {"type":"Number","label":"Seed","name":"seed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Best-effort deterministic sampling seed. Repeated requests with the same seed and parameters should return similar results."}
   * @paramDef {"type":"Array<String>","label":"Stop Sequences","name":"stop","description":"Up to 4 sequences where the model stops generating further tokens."}
   * @paramDef {"type":"String","label":"Response Format","name":"responseFormatType","uiComponent":{"type":"DROPDOWN","options":{"values":["Text","JSON Object","JSON Schema"]}},"description":"Output format. 'JSON Object' guarantees valid JSON; 'JSON Schema' additionally constrains the output to the provided JSON Schema (strict structured output). Defaults to 'Text'."}
   * @paramDef {"type":"String","label":"JSON Schema Name","name":"jsonSchemaName","description":"Name for the structured output schema. Used only when Response Format is 'JSON Schema'. Defaults to 'response'."}
   * @paramDef {"type":"Object","label":"JSON Schema","name":"jsonSchema","description":"JSON Schema the output must adhere to when Response Format is 'JSON Schema', e.g. {\"type\":\"object\",\"properties\":{\"city\":{\"type\":\"string\"}},\"required\":[\"city\"],\"additionalProperties\":false}."}
   * @paramDef {"type":"Array<Object>","label":"Tools","name":"tools","description":"Function tool definitions the model may call, e.g. [{\"type\":\"function\",\"function\":{\"name\":\"get_weather\",\"description\":\"...\",\"parameters\":{...}}}]. Tool calls are returned in choices[0].message.tool_calls."}
   * @paramDef {"type":"String","label":"Tool Choice","name":"toolChoice","description":"Controls tool usage: 'auto' (default), 'none', 'required', or a specific tool as JSON, e.g. {\"type\":\"function\",\"function\":{\"name\":\"get_weather\"}}."}
   * @paramDef {"type":"Boolean","label":"Store","name":"store","uiComponent":{"type":"TOGGLE"},"description":"Whether to store this completion on OpenAI's servers for later retrieval in the dashboard (e.g. for evals or distillation)."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","description":"Up to 16 key-value string pairs to attach to the completion, e.g. {\"flow\":\"onboarding\"}."}
   *
   * @returns {Object}
   * @sampleResult {"id":"chatcmpl-abc123","object":"chat.completion","created":1741570283,"model":"gpt-4o-2024-08-06","choices":[{"index":0,"message":{"role":"assistant","content":"Hello! How can I help you today?"},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":10,"total_tokens":22}}
   */
  async createChatCompletion(messages, model, temperature, topP, maxCompletionTokens, reasoningEffort,
    frequencyPenalty, presencePenalty, seed, stop, responseFormatType, jsonSchemaName, jsonSchema,
    tools, toolChoice, store, metadata) {
    if (!messages?.length) {
      throw new Error('Messages array is required and must not be empty')
    }

    let responseFormat

    const formatType = this.#resolveChoice(responseFormatType, CHAT_RESPONSE_FORMAT_OPTIONS)

    if (formatType === 'json_schema') {
      if (!jsonSchema) {
        throw new Error("JSON Schema is required when Response Format is 'JSON Schema'")
      }

      responseFormat = {
        type: 'json_schema',
        json_schema: { name: jsonSchemaName || 'response', schema: jsonSchema, strict: true },
      }
    } else if (formatType && formatType !== 'text') {
      responseFormat = { type: formatType }
    }

    let resolvedToolChoice = toolChoice || undefined

    if (typeof resolvedToolChoice === 'string' && resolvedToolChoice.trim().startsWith('{')) {
      try {
        resolvedToolChoice = JSON.parse(resolvedToolChoice)
      } catch {
        // keep the raw string; the API will validate it
      }
    }

    const body = this.#compact({
      model: model || DEFAULT_CHAT_MODEL,
      messages,
      temperature,
      top_p: topP,
      max_completion_tokens: maxCompletionTokens,
      reasoning_effort: this.#resolveChoice(reasoningEffort, REASONING_EFFORT_OPTIONS),
      frequency_penalty: frequencyPenalty,
      presence_penalty: presencePenalty,
      seed,
      stop: stop?.length ? stop : undefined,
      response_format: responseFormat,
      tools: tools?.length ? tools : undefined,
      tool_choice: resolvedToolChoice,
      store,
      metadata,
    })

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/chat/completions`,
      body,
      logTag: 'createChatCompletion',
    })
  }

  /**
   * @operationName Create Embeddings
   * @description Generates vector embeddings for one or more text inputs using OpenAI's embedding models. Supports the 'dimensions' parameter of the text-embedding-3 family to produce shortened vectors. Returns the embedding vectors with token usage, ordered to match the inputs.
   * @category Embeddings
   * @route POST /create-embeddings
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Array<String>","label":"Texts","name":"texts","required":true,"description":"Text inputs to embed. Each input must not exceed the model's token limit (8192 tokens for text-embedding-3 models)."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getEmbeddingModelsDictionary","defaultValue":"text-embedding-3-small","description":"The embedding model to use. Defaults to 'text-embedding-3-small'."}
   * @paramDef {"type":"Number","label":"Dimensions","name":"dimensions","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of dimensions for the output embeddings. Only supported by text-embedding-3 and later models, which allow shortening vectors (e.g. 256, 512, 1024) without losing their concept-representing properties."}
   *
   * @returns {Object}
   * @sampleResult {"object":"list","data":[{"object":"embedding","index":0,"embedding":[0.0023,-0.0091,0.0154]}],"model":"text-embedding-3-small","usage":{"prompt_tokens":8,"total_tokens":8}}
   */
  async createEmbeddings(texts, model, dimensions) {
    if (!texts?.length) {
      throw new Error('At least one text input is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/embeddings`,
      body: this.#compact({
        model: model || DEFAULT_EMBEDDING_MODEL,
        input: texts,
        dimensions,
      }),
      logTag: 'createEmbeddings',
    })
  }

  /**
   * @operationName Generate Image
   * @description Generates images from a text prompt using OpenAI's image models ('gpt-image-1' or the DALL·E family). Supports size, quality, transparent backgrounds and output format (gpt-image-1), and multiple images per request. Generated images are uploaded to FlowRunner file storage and returned as URLs, along with the revised prompt when the model provides one.
   * @category Images
   * @route POST /generate-image
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text description of the desired image. Maximum length is 32000 characters for 'gpt-image-1', 4000 for 'dall-e-3', and 1000 for 'dall-e-2'."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getImageModelsDictionary","defaultValue":"gpt-image-1","description":"The image generation model to use. Defaults to 'gpt-image-1'."}
   * @paramDef {"type":"String","label":"Size","name":"size","uiComponent":{"type":"DROPDOWN","options":{"values":["Auto","Square (1024x1024)","Landscape (1536x1024)","Portrait (1024x1536)","Wide (1792x1024)","Tall (1024x1792)","Small (256x256)","Medium (512x512)"]}},"defaultValue":"Auto","description":"Image dimensions. 'gpt-image-1' supports Auto, Square, Landscape (1536x1024) and Portrait (1024x1536); 'dall-e-3' supports Square, Wide (1792x1024) and Tall (1024x1792); 'dall-e-2' supports Small, Medium and Square."}
   * @paramDef {"type":"String","label":"Quality","name":"quality","uiComponent":{"type":"DROPDOWN","options":{"values":["Auto","Low","Medium","High","Standard","HD"]}},"defaultValue":"Auto","description":"Rendering quality. 'gpt-image-1' supports Auto, Low, Medium and High; 'dall-e-3' supports Standard and HD; 'dall-e-2' supports only Standard."}
   * @paramDef {"type":"Number","label":"Number of Images","name":"n","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of images to generate, between 1 and 10. 'dall-e-3' supports only 1. Defaults to 1."}
   * @paramDef {"type":"String","label":"Background","name":"background","uiComponent":{"type":"DROPDOWN","options":{"values":["Auto","Transparent","Opaque"]}},"description":"Background transparency, supported by 'gpt-image-1' only. 'Transparent' requires the PNG or WebP output format."}
   * @paramDef {"type":"String","label":"Output Format","name":"outputFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["PNG","JPEG","WebP"]}},"description":"Image file format, supported by 'gpt-image-1' only. Defaults to PNG. DALL·E models always produce PNG."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"FlowRunner storage settings for the generated image files."}
   *
   * @returns {Object}
   * @sampleResult {"files":[{"fileURL":"https://example.com/files/automation/tmp/image_1720000000000_0.png","revisedPrompt":"A photorealistic red fox standing in a snowy forest at dawn"}],"usage":{"input_tokens":50,"output_tokens":4160,"total_tokens":4210}}
   */
  async generateImage(prompt, model, size, quality, n, background, outputFormat, fileOptions) {
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    const resolvedModel = model || DEFAULT_IMAGE_MODEL
    const isGptImage = resolvedModel.startsWith('gpt-image')

    const resolvedSize = this.#resolveChoice(size, IMAGE_SIZE_OPTIONS)
    const resolvedQuality = this.#resolveChoice(quality, IMAGE_QUALITY_OPTIONS)
    const resolvedFormat = this.#resolveChoice(outputFormat, IMAGE_OUTPUT_FORMAT_OPTIONS)

    const body = this.#compact({
      model: resolvedModel,
      prompt,
      n,
      size: resolvedSize === 'auto' ? (isGptImage ? 'auto' : undefined) : resolvedSize,
      quality: resolvedQuality === 'auto' ? (isGptImage ? 'auto' : undefined) : resolvedQuality,
      background: isGptImage ? this.#resolveChoice(background, IMAGE_BACKGROUND_OPTIONS) : undefined,
      output_format: isGptImage ? resolvedFormat : undefined,
      response_format: isGptImage ? undefined : 'b64_json',
    })

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/images/generations`,
      body,
      logTag: 'generateImage',
    })

    const files = await this.#uploadImagesFromResponse(response, (isGptImage && resolvedFormat) || 'png', fileOptions)

    return { files, usage: response.usage }
  }

  /**
   * @operationName Edit Image
   * @description Edits or extends existing images from a text prompt using OpenAI's image models. With 'gpt-image-1', multiple input images can be combined into a new composition; an optional mask marks the transparent areas to be repainted (inpainting). Source images are downloaded from the provided URLs, and the edited results are uploaded to FlowRunner file storage and returned as URLs.
   * @category Images
   * @route POST /edit-image
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"Array<String>","label":"Image URLs","name":"imageUrls","required":true,"description":"Publicly accessible URLs of the source images. 'gpt-image-1' accepts up to 16 PNG, WebP or JPEG images (max 50MB each); 'dall-e-2' accepts exactly one square PNG under 4MB."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text description of the desired edited image. Maximum length is 32000 characters for 'gpt-image-1' and 1000 for 'dall-e-2'."}
   * @paramDef {"type":"String","label":"Mask URL","name":"maskUrl","description":"Optional URL of a PNG mask whose fully transparent areas indicate where the first image should be edited. Must have the same dimensions as the first image."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getImageModelsDictionary","defaultValue":"gpt-image-1","description":"The image edit model to use: 'gpt-image-1' or 'dall-e-2'. Defaults to 'gpt-image-1'."}
   * @paramDef {"type":"String","label":"Size","name":"size","uiComponent":{"type":"DROPDOWN","options":{"values":["Auto","Square (1024x1024)","Landscape (1536x1024)","Portrait (1024x1536)","Small (256x256)","Medium (512x512)"]}},"defaultValue":"Auto","description":"Output image dimensions. 'gpt-image-1' supports Auto, Square, Landscape and Portrait; 'dall-e-2' supports Small, Medium and Square."}
   * @paramDef {"type":"String","label":"Quality","name":"quality","uiComponent":{"type":"DROPDOWN","options":{"values":["Auto","Low","Medium","High"]}},"description":"Rendering quality, supported by 'gpt-image-1' only. Defaults to Auto."}
   * @paramDef {"type":"Number","label":"Number of Images","name":"n","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of edited images to generate, between 1 and 10. Defaults to 1."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"FlowRunner storage settings for the edited image files."}
   *
   * @returns {Object}
   * @sampleResult {"files":[{"fileURL":"https://example.com/files/automation/tmp/image_1720000000000_0.png"}],"usage":{"input_tokens":150,"output_tokens":4160,"total_tokens":4310}}
   */
  async editImage(imageUrls, prompt, maskUrl, model, size, quality, n, fileOptions) {
    if (!imageUrls?.length) {
      throw new Error('At least one image URL is required')
    }

    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    const resolvedModel = model || DEFAULT_IMAGE_MODEL
    const isGptImage = resolvedModel.startsWith('gpt-image')

    const form = new Flowrunner.Request.FormData()
    const imageFieldName = imageUrls.length > 1 ? 'image[]' : 'image'

    for (const imageUrl of imageUrls) {
      const imageBuffer = await this.#downloadToBuffer(imageUrl, 'editImage')

      form.append(imageFieldName, imageBuffer, { filename: this.#extractFileName(imageUrl) })
    }

    if (maskUrl) {
      const maskBuffer = await this.#downloadToBuffer(maskUrl, 'editImage')

      form.append('mask', maskBuffer, { filename: this.#extractFileName(maskUrl) })
    }

    form.append('model', resolvedModel)
    form.append('prompt', prompt)

    if (n) {
      form.append('n', String(n))
    }

    const resolvedSize = this.#resolveChoice(size, IMAGE_SIZE_OPTIONS)

    if (resolvedSize && (resolvedSize !== 'auto' || isGptImage)) {
      form.append('size', resolvedSize)
    }

    const resolvedQuality = this.#resolveChoice(quality, IMAGE_QUALITY_OPTIONS)

    if (isGptImage && resolvedQuality) {
      form.append('quality', resolvedQuality)
    }

    if (!isGptImage) {
      form.append('response_format', 'b64_json')
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/images/edits`,
      form,
      logTag: 'editImage',
    })

    const files = await this.#uploadImagesFromResponse(response, 'png', fileOptions)

    return { files, usage: response.usage }
  }

  /**
   * @operationName Upload File
   * @description Uploads a file to the OpenAI account by downloading it from the provided URL. Uploaded files can be used across the API: batch inputs (purpose 'batch'), file search / vector stores (purpose 'assistants'), vision inputs (purpose 'vision'), fine-tuning datasets (purpose 'fine-tune'), and general Responses API inputs (purpose 'user_data'). Returns the created file object with its ID.
   * @category Files
   * @route POST /upload-file
   *
   * @executionTimeoutInSeconds 180
   *
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"description":"Publicly accessible URL of the file to upload. Must start with 'http://' or 'https://'."}
   * @paramDef {"type":"String","label":"Purpose","name":"purpose","uiComponent":{"type":"DROPDOWN","options":{"values":["User Data","Assistants","Batch","Fine-tune","Vision","Evals"]}},"defaultValue":"User Data","description":"The intended use of the file. 'Batch' requires a .jsonl file; 'Fine-tune' requires a .jsonl training file; 'Assistants' is used for file search and vector stores."}
   * @paramDef {"type":"String","label":"Filename","name":"filename","description":"Optional filename override. By default the name is derived from the URL."}
   *
   * @returns {Object}
   * @sampleResult {"id":"file-abc123","object":"file","bytes":120000,"created_at":1741570283,"filename":"batch_input.jsonl","purpose":"batch"}
   */
  async uploadFile(fileUrl, purpose, filename) {
    const fileBuffer = await this.#downloadToBuffer(fileUrl, 'uploadFile')

    const form = new Flowrunner.Request.FormData()

    form.append('file', fileBuffer, { filename: filename || this.#extractFileName(fileUrl) })
    form.append('purpose', this.#resolveChoice(purpose, FILE_PURPOSE_OPTIONS) || 'user_data')

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/files`,
      form,
      logTag: 'uploadFile',
    })
  }

  /**
   * @operationName List Files
   * @description Lists the files uploaded to the OpenAI account, optionally filtered by purpose, with cursor-based pagination and sorting by creation date.
   * @category Files
   * @route GET /list-files
   *
   * @paramDef {"type":"String","label":"Purpose","name":"purpose","uiComponent":{"type":"DROPDOWN","options":{"values":["User Data","Assistants","Batch","Fine-tune","Vision","Evals"]}},"description":"Optional filter: only return files with this purpose."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of files to return, between 1 and 10000. Defaults to 10000."}
   * @paramDef {"type":"String","label":"After","name":"after","description":"Pagination cursor: a file ID after which to continue listing."}
   * @paramDef {"type":"String","label":"Order","name":"order","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort order by creation date. Defaults to descending."}
   *
   * @returns {Object}
   * @sampleResult {"object":"list","data":[{"id":"file-abc123","object":"file","bytes":120000,"created_at":1741570283,"filename":"batch_input.jsonl","purpose":"batch"}],"has_more":false}
   */
  async listFiles(purpose, limit, after, order) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/files`,
      method: 'get',
      query: this.#compact({
        purpose: this.#resolveChoice(purpose, FILE_PURPOSE_OPTIONS),
        limit,
        after: after || undefined,
        order: this.#resolveChoice(order, SORT_ORDER_OPTIONS),
      }),
      logTag: 'listFiles',
    })
  }

  /**
   * @operationName Get File
   * @description Retrieves the metadata of an uploaded file by its ID, including filename, size in bytes, purpose, and creation date.
   * @category Files
   * @route GET /get-file
   *
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The file to fetch. Pick from the list or paste a file ID, e.g. 'file-abc123'."}
   *
   * @returns {Object}
   * @sampleResult {"id":"file-abc123","object":"file","bytes":120000,"created_at":1741570283,"filename":"batch_input.jsonl","purpose":"batch"}
   */
  async getFile(fileId) {
    if (!fileId) {
      throw new Error('File ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/files/${ encodeURIComponent(fileId) }`,
      method: 'get',
      logTag: 'getFile',
    })
  }

  /**
   * @operationName Delete File
   * @description Permanently deletes an uploaded file from the OpenAI account by its ID.
   * @category Files
   * @route DELETE /delete-file
   *
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The file to delete. Pick from the list or paste a file ID, e.g. 'file-abc123'."}
   *
   * @returns {Object}
   * @sampleResult {"id":"file-abc123","object":"file","deleted":true}
   */
  async deleteFile(fileId) {
    if (!fileId) {
      throw new Error('File ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/files/${ encodeURIComponent(fileId) }`,
      method: 'delete',
      logTag: 'deleteFile',
    })
  }

  /**
   * @operationName Download File Content
   * @description Downloads the content of a file stored in the OpenAI account (e.g. a batch output or error file), uploads it to FlowRunner file storage, and returns its URL. The original filename and size are included in the result.
   * @category Files
   * @route POST /download-file-content
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The file whose content to download. Pick from the list or paste a file ID, e.g. 'file-abc123'."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"FlowRunner storage settings for the downloaded file."}
   *
   * @returns {Object}
   * @sampleResult {"fileURL":"https://example.com/files/automation/tmp/batch_abc123_output.jsonl","filename":"batch_abc123_output.jsonl","bytes":52400}
   */
  async downloadFileContent(fileId, fileOptions) {
    if (!fileId) {
      throw new Error('File ID is required')
    }

    const metadata = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/files/${ encodeURIComponent(fileId) }`,
      method: 'get',
      logTag: 'downloadFileContent',
    })

    const contentBytes = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/files/${ encodeURIComponent(fileId) }/content`,
      method: 'get',
      binary: true,
      logTag: 'downloadFileContent',
    })

    const buffer = Buffer.isBuffer(contentBytes) ? contentBytes : Buffer.from(contentBytes)

    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename: metadata.filename || `openai_file_${ Date.now() }`,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return { fileURL: url, filename: metadata.filename, bytes: metadata.bytes }
  }

  /**
   * @operationName Create Batch
   * @description Creates a batch job that processes a .jsonl file of API requests asynchronously within 24 hours at 50% of the standard cost. The input file must first be uploaded with purpose 'Batch' (see 'Upload File') and contain one request per line with 'custom_id', 'method', 'url', and 'body' fields. Poll the batch with 'Get Batch' and download results via 'Download File Content' using the batch's output_file_id.
   * @category Batches
   * @route POST /create-batch
   *
   * @paramDef {"type":"String","label":"Input File","name":"inputFileId","required":true,"dictionary":"getFilesDictionary","description":"The uploaded .jsonl input file (purpose 'batch') containing the requests. Pick from the list or paste a file ID."}
   * @paramDef {"type":"String","label":"Endpoint","name":"endpoint","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Chat Completions","Responses","Embeddings","Completions"]}},"defaultValue":"Chat Completions","description":"The API endpoint every request in the batch targets. All requests in one batch must use the same endpoint."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","description":"Up to 16 key-value string pairs to attach to the batch, e.g. {\"job\":\"nightly-summaries\"}."}
   *
   * @returns {Object}
   * @sampleResult {"id":"batch_abc123","object":"batch","endpoint":"/v1/chat/completions","input_file_id":"file-abc123","completion_window":"24h","status":"validating","created_at":1741570283,"request_counts":{"total":0,"completed":0,"failed":0}}
   */
  async createBatch(inputFileId, endpoint, metadata) {
    if (!inputFileId) {
      throw new Error('Input file ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/batches`,
      body: this.#compact({
        input_file_id: inputFileId,
        endpoint: this.#resolveChoice(endpoint, BATCH_ENDPOINT_OPTIONS) || BATCH_ENDPOINT_OPTIONS['Chat Completions'],
        completion_window: BATCH_COMPLETION_WINDOW,
        metadata,
      }),
      logTag: 'createBatch',
    })
  }

  /**
   * @operationName Get Batch
   * @description Retrieves the current state of a batch job by its ID, including status (validating, in_progress, completed, failed, expired, cancelled), request counts, and the output_file_id and error_file_id for downloading results once finished.
   * @category Batches
   * @route GET /get-batch
   *
   * @paramDef {"type":"String","label":"Batch ID","name":"batchId","required":true,"description":"The ID of the batch to fetch, e.g. 'batch_abc123'."}
   *
   * @returns {Object}
   * @sampleResult {"id":"batch_abc123","object":"batch","endpoint":"/v1/chat/completions","input_file_id":"file-abc123","output_file_id":"file-def456","completion_window":"24h","status":"completed","created_at":1741570283,"completed_at":1741573883,"request_counts":{"total":100,"completed":98,"failed":2}}
   */
  async getBatch(batchId) {
    if (!batchId) {
      throw new Error('Batch ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/batches/${ encodeURIComponent(batchId) }`,
      method: 'get',
      logTag: 'getBatch',
    })
  }

  /**
   * @operationName List Batches
   * @description Lists the batch jobs in the OpenAI account with their statuses and request counts, using cursor-based pagination.
   * @category Batches
   * @route GET /list-batches
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of batches to return, between 1 and 100. Defaults to 20."}
   * @paramDef {"type":"String","label":"After","name":"after","description":"Pagination cursor: a batch ID after which to continue listing."}
   *
   * @returns {Object}
   * @sampleResult {"object":"list","data":[{"id":"batch_abc123","object":"batch","endpoint":"/v1/chat/completions","status":"completed","created_at":1741570283,"request_counts":{"total":100,"completed":98,"failed":2}}],"first_id":"batch_abc123","last_id":"batch_abc123","has_more":false}
   */
  async listBatches(limit, after) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/batches`,
      method: 'get',
      query: this.#compact({ limit, after: after || undefined }),
      logTag: 'listBatches',
    })
  }

  /**
   * @operationName Cancel Batch
   * @description Cancels an in-progress batch job by its ID. The batch moves to 'cancelling' for up to 10 minutes and then 'cancelled'; partial results of already-completed requests remain available in the output file.
   * @category Batches
   * @route POST /cancel-batch
   *
   * @paramDef {"type":"String","label":"Batch ID","name":"batchId","required":true,"description":"The ID of the batch to cancel, e.g. 'batch_abc123'."}
   *
   * @returns {Object}
   * @sampleResult {"id":"batch_abc123","object":"batch","endpoint":"/v1/chat/completions","status":"cancelling","created_at":1741570283,"request_counts":{"total":100,"completed":23,"failed":1}}
   */
  async cancelBatch(batchId) {
    if (!batchId) {
      throw new Error('Batch ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/batches/${ encodeURIComponent(batchId) }/cancel`,
      body: {},
      logTag: 'cancelBatch',
    })
  }

  /**
   * @operationName Create Vector Store
   * @description Creates a vector store for semantic file search (RAG). Optionally attaches already-uploaded files (purpose 'Assistants'), which are automatically chunked and embedded. The resulting vector store can be searched directly with 'Search Vector Store' or used by the file search tool in 'Create Response'.
   * @category Vector Stores
   * @route POST /create-vector-store
   *
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Human-readable name of the vector store."}
   * @paramDef {"type":"Array<String>","label":"File IDs","name":"fileIds","description":"IDs of uploaded files (purpose 'assistants') to add to the vector store, e.g. ['file-abc123']."}
   * @paramDef {"type":"Number","label":"Expires After Days","name":"expiresAfterDays","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional expiration policy: the vector store is deleted this many days after it was last active."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","description":"Up to 16 key-value string pairs to attach to the vector store, e.g. {\"project\":\"support-kb\"}."}
   *
   * @returns {Object}
   * @sampleResult {"id":"vs_abc123","object":"vector_store","name":"Support FAQ","status":"in_progress","usage_bytes":0,"created_at":1741570283,"file_counts":{"in_progress":3,"completed":0,"failed":0,"cancelled":0,"total":3}}
   */
  async createVectorStore(name, fileIds, expiresAfterDays, metadata) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/vector_stores`,
      body: this.#compact({
        name: name || undefined,
        file_ids: fileIds?.length ? fileIds : undefined,
        expires_after: expiresAfterDays ? { anchor: 'last_active_at', days: expiresAfterDays } : undefined,
        metadata,
      }),
      logTag: 'createVectorStore',
    })
  }

  /**
   * @operationName List Vector Stores
   * @description Lists the vector stores in the OpenAI account with their statuses, file counts and storage usage, using cursor-based pagination.
   * @category Vector Stores
   * @route GET /list-vector-stores
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of vector stores to return, between 1 and 100. Defaults to 20."}
   * @paramDef {"type":"String","label":"After","name":"after","description":"Pagination cursor: a vector store ID after which to continue listing."}
   * @paramDef {"type":"String","label":"Order","name":"order","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort order by creation date. Defaults to descending."}
   *
   * @returns {Object}
   * @sampleResult {"object":"list","data":[{"id":"vs_abc123","object":"vector_store","name":"Support FAQ","status":"completed","usage_bytes":123456,"file_counts":{"in_progress":0,"completed":3,"failed":0,"cancelled":0,"total":3}}],"first_id":"vs_abc123","last_id":"vs_abc123","has_more":false}
   */
  async listVectorStores(limit, after, order) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/vector_stores`,
      method: 'get',
      query: this.#compact({
        limit,
        after: after || undefined,
        order: this.#resolveChoice(order, SORT_ORDER_OPTIONS),
      }),
      logTag: 'listVectorStores',
    })
  }

  /**
   * @operationName Get Vector Store
   * @description Retrieves a vector store by its ID, including its status, file counts, storage usage, and expiration policy.
   * @category Vector Stores
   * @route GET /get-vector-store
   *
   * @paramDef {"type":"String","label":"Vector Store","name":"vectorStoreId","required":true,"dictionary":"getVectorStoresDictionary","description":"The vector store to fetch. Pick from the list or paste a vector store ID, e.g. 'vs_abc123'."}
   *
   * @returns {Object}
   * @sampleResult {"id":"vs_abc123","object":"vector_store","name":"Support FAQ","status":"completed","usage_bytes":123456,"created_at":1741570283,"file_counts":{"in_progress":0,"completed":3,"failed":0,"cancelled":0,"total":3}}
   */
  async getVectorStore(vectorStoreId) {
    if (!vectorStoreId) {
      throw new Error('Vector store ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/vector_stores/${ encodeURIComponent(vectorStoreId) }`,
      method: 'get',
      logTag: 'getVectorStore',
    })
  }

  /**
   * @operationName Delete Vector Store
   * @description Permanently deletes a vector store by its ID. The underlying uploaded files are not deleted and remain in the account.
   * @category Vector Stores
   * @route DELETE /delete-vector-store
   *
   * @paramDef {"type":"String","label":"Vector Store","name":"vectorStoreId","required":true,"dictionary":"getVectorStoresDictionary","description":"The vector store to delete. Pick from the list or paste a vector store ID, e.g. 'vs_abc123'."}
   *
   * @returns {Object}
   * @sampleResult {"id":"vs_abc123","object":"vector_store.deleted","deleted":true}
   */
  async deleteVectorStore(vectorStoreId) {
    if (!vectorStoreId) {
      throw new Error('Vector store ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/vector_stores/${ encodeURIComponent(vectorStoreId) }`,
      method: 'delete',
      logTag: 'deleteVectorStore',
    })
  }

  /**
   * @operationName Add File to Vector Store
   * @description Attaches an already-uploaded file to a vector store. The file is automatically chunked and embedded; poll 'List Vector Store Files' or 'Get Vector Store' until processing completes.
   * @category Vector Stores
   * @route POST /add-file-to-vector-store
   *
   * @paramDef {"type":"String","label":"Vector Store","name":"vectorStoreId","required":true,"dictionary":"getVectorStoresDictionary","description":"The vector store to add the file to. Pick from the list or paste a vector store ID."}
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The uploaded file to attach (purpose 'assistants'). Pick from the list or paste a file ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":"file-abc123","object":"vector_store.file","vector_store_id":"vs_abc123","status":"in_progress","created_at":1741570283}
   */
  async addFileToVectorStore(vectorStoreId, fileId) {
    if (!vectorStoreId) {
      throw new Error('Vector store ID is required')
    }

    if (!fileId) {
      throw new Error('File ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/vector_stores/${ encodeURIComponent(vectorStoreId) }/files`,
      body: { file_id: fileId },
      logTag: 'addFileToVectorStore',
    })
  }

  /**
   * @operationName List Vector Store Files
   * @description Lists the files attached to a vector store with their processing statuses, optionally filtered by status, using cursor-based pagination.
   * @category Vector Stores
   * @route GET /list-vector-store-files
   *
   * @paramDef {"type":"String","label":"Vector Store","name":"vectorStoreId","required":true,"dictionary":"getVectorStoresDictionary","description":"The vector store whose files to list. Pick from the list or paste a vector store ID."}
   * @paramDef {"type":"String","label":"Status Filter","name":"filter","uiComponent":{"type":"DROPDOWN","options":{"values":["In Progress","Completed","Failed","Cancelled"]}},"description":"Optional filter: only return files with this processing status."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of files to return, between 1 and 100. Defaults to 20."}
   * @paramDef {"type":"String","label":"After","name":"after","description":"Pagination cursor: a file ID after which to continue listing."}
   *
   * @returns {Object}
   * @sampleResult {"object":"list","data":[{"id":"file-abc123","object":"vector_store.file","vector_store_id":"vs_abc123","status":"completed","created_at":1741570283}],"first_id":"file-abc123","last_id":"file-abc123","has_more":false}
   */
  async listVectorStoreFiles(vectorStoreId, filter, limit, after) {
    if (!vectorStoreId) {
      throw new Error('Vector store ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/vector_stores/${ encodeURIComponent(vectorStoreId) }/files`,
      method: 'get',
      query: this.#compact({
        filter: this.#resolveChoice(filter, VECTOR_STORE_FILE_FILTER_OPTIONS),
        limit,
        after: after || undefined,
      }),
      logTag: 'listVectorStoreFiles',
    })
  }

  /**
   * @operationName Remove File from Vector Store
   * @description Detaches a file from a vector store by its ID. The underlying uploaded file is not deleted and remains in the account.
   * @category Vector Stores
   * @route DELETE /remove-file-from-vector-store
   *
   * @paramDef {"type":"String","label":"Vector Store","name":"vectorStoreId","required":true,"dictionary":"getVectorStoresDictionary","description":"The vector store to remove the file from. Pick from the list or paste a vector store ID."}
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The file to detach. Pick from the list or paste a file ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":"file-abc123","object":"vector_store.file.deleted","deleted":true}
   */
  async removeFileFromVectorStore(vectorStoreId, fileId) {
    if (!vectorStoreId) {
      throw new Error('Vector store ID is required')
    }

    if (!fileId) {
      throw new Error('File ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/vector_stores/${ encodeURIComponent(vectorStoreId) }/files/${ encodeURIComponent(fileId) }`,
      method: 'delete',
      logTag: 'removeFileFromVectorStore',
    })
  }

  /**
   * @operationName Search Vector Store
   * @description Performs a semantic similarity search over a vector store and returns the most relevant file chunks with their scores — a direct RAG retrieval step without invoking a model. Supports optional query rewriting for better retrieval quality.
   * @category Vector Stores
   * @route POST /search-vector-store
   *
   * @paramDef {"type":"String","label":"Vector Store","name":"vectorStoreId","required":true,"dictionary":"getVectorStoresDictionary","description":"The vector store to search. Pick from the list or paste a vector store ID."}
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The natural-language search query."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of result chunks to return, between 1 and 50. Defaults to 10."}
   * @paramDef {"type":"Boolean","label":"Rewrite Query","name":"rewriteQuery","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the query is automatically rewritten to improve vector search relevance."}
   *
   * @returns {Object}
   * @sampleResult {"object":"vector_store.search_results.page","search_query":["return policy"],"data":[{"file_id":"file-abc123","filename":"faq.pdf","score":0.92,"content":[{"type":"text","text":"Our return policy allows returns within 30 days of purchase."}]}],"has_more":false,"next_page":null}
   */
  async searchVectorStore(vectorStoreId, query, maxResults, rewriteQuery) {
    if (!vectorStoreId) {
      throw new Error('Vector store ID is required')
    }

    if (!query || !query.trim()) {
      throw new Error('Query is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/vector_stores/${ encodeURIComponent(vectorStoreId) }/search`,
      body: this.#compact({
        query,
        max_num_results: maxResults,
        rewrite_query: rewriteQuery,
      }),
      logTag: 'searchVectorStore',
    })
  }

  /**
   * @operationName Create Video
   * @description Starts an asynchronous video generation job from a text prompt using OpenAI's Sora models. Optionally accepts an input reference image used as the first frame. Returns immediately with a job object; poll it with 'Get Video' until its status is 'completed', then fetch the file with 'Download Video Content'.
   * @category Videos
   * @route POST /create-video
   *
   * @executionTimeoutInSeconds 180
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text description of the desired video: subjects, camera, lighting, and motion."}
   * @paramDef {"type":"String","label":"Model","name":"model","uiComponent":{"type":"DROPDOWN","options":{"values":["Sora 2","Sora 2 Pro"]}},"defaultValue":"Sora 2","description":"The video generation model. 'Sora 2 Pro' produces higher quality at higher cost and supports the HD resolutions."}
   * @paramDef {"type":"String","label":"Duration","name":"seconds","uiComponent":{"type":"DROPDOWN","options":{"values":["4 Seconds","8 Seconds","12 Seconds"]}},"defaultValue":"4 Seconds","description":"Clip duration. Defaults to 4 seconds."}
   * @paramDef {"type":"String","label":"Size","name":"size","uiComponent":{"type":"DROPDOWN","options":{"values":["Portrait (720x1280)","Landscape (1280x720)","Portrait HD (1024x1792)","Landscape HD (1792x1024)"]}},"defaultValue":"Portrait (720x1280)","description":"Output resolution. The HD resolutions require the 'Sora 2 Pro' model."}
   * @paramDef {"type":"String","label":"Input Reference Image URL","name":"inputReferenceUrl","description":"Optional publicly accessible URL of an image to use as the first frame of the video. Its dimensions must match the selected Size."}
   *
   * @returns {Object}
   * @sampleResult {"id":"video_abc123","object":"video","model":"sora-2","status":"queued","progress":0,"created_at":1741570283,"size":"720x1280","seconds":"4"}
   */
  async createVideo(prompt, model, seconds, size, inputReferenceUrl) {
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    const resolvedModel = this.#resolveChoice(model, VIDEO_MODEL_OPTIONS) || DEFAULT_VIDEO_MODEL
    const resolvedSeconds = this.#resolveChoice(seconds, VIDEO_SECONDS_OPTIONS)
    const resolvedSize = this.#resolveChoice(size, VIDEO_SIZE_OPTIONS)

    if (inputReferenceUrl) {
      const referenceBuffer = await this.#downloadToBuffer(inputReferenceUrl, 'createVideo')

      const form = new Flowrunner.Request.FormData()

      form.append('input_reference', referenceBuffer, { filename: this.#extractFileName(inputReferenceUrl) })
      form.append('model', resolvedModel)
      form.append('prompt', prompt)

      if (resolvedSeconds) {
        form.append('seconds', resolvedSeconds)
      }

      if (resolvedSize) {
        form.append('size', resolvedSize)
      }

      return this.#apiRequest({
        url: `${ API_BASE_URL }/v1/videos`,
        form,
        logTag: 'createVideo',
      })
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/videos`,
      body: this.#compact({
        model: resolvedModel,
        prompt,
        seconds: resolvedSeconds,
        size: resolvedSize,
      }),
      logTag: 'createVideo',
    })
  }

  /**
   * @operationName Remix Video
   * @description Creates a new video generation job based on a completed video, applying the changes described in the prompt while preserving the original's structure. Returns a new job object; poll it with 'Get Video'.
   * @category Videos
   * @route POST /remix-video
   *
   * @paramDef {"type":"String","label":"Video ID","name":"videoId","required":true,"description":"The ID of the completed video to remix, e.g. 'video_abc123'."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Description of the changes to apply to the source video."}
   *
   * @returns {Object}
   * @sampleResult {"id":"video_def456","object":"video","model":"sora-2","status":"queued","progress":0,"created_at":1741570283,"remixed_from_video_id":"video_abc123","size":"720x1280","seconds":"4"}
   */
  async remixVideo(videoId, prompt) {
    if (!videoId) {
      throw new Error('Video ID is required')
    }

    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/videos/${ encodeURIComponent(videoId) }/remix`,
      body: { prompt },
      logTag: 'remixVideo',
    })
  }

  /**
   * @operationName Get Video
   * @description Retrieves a video generation job by its ID, including its status (queued, in_progress, completed, failed) and progress percentage. Poll this until the status is 'completed', then use 'Download Video Content'.
   * @category Videos
   * @route GET /get-video
   *
   * @paramDef {"type":"String","label":"Video ID","name":"videoId","required":true,"description":"The ID of the video job to fetch, e.g. 'video_abc123'."}
   *
   * @returns {Object}
   * @sampleResult {"id":"video_abc123","object":"video","model":"sora-2","status":"completed","progress":100,"created_at":1741570283,"completed_at":1741570583,"expires_at":1741657283,"size":"720x1280","seconds":"4"}
   */
  async getVideo(videoId) {
    if (!videoId) {
      throw new Error('Video ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/videos/${ encodeURIComponent(videoId) }`,
      method: 'get',
      logTag: 'getVideo',
    })
  }

  /**
   * @operationName List Videos
   * @description Lists the video generation jobs in the OpenAI account with their statuses, using cursor-based pagination.
   * @category Videos
   * @route GET /list-videos
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of videos to return per page. Defaults to 20."}
   * @paramDef {"type":"String","label":"After","name":"after","description":"Pagination cursor: a video ID after which to continue listing."}
   * @paramDef {"type":"String","label":"Order","name":"order","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort order by creation date. Defaults to descending."}
   *
   * @returns {Object}
   * @sampleResult {"object":"list","data":[{"id":"video_abc123","object":"video","model":"sora-2","status":"completed","progress":100,"size":"720x1280","seconds":"4"}],"first_id":"video_abc123","last_id":"video_abc123","has_more":false}
   */
  async listVideos(limit, after, order) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/videos`,
      method: 'get',
      query: this.#compact({
        limit,
        after: after || undefined,
        order: this.#resolveChoice(order, SORT_ORDER_OPTIONS),
      }),
      logTag: 'listVideos',
    })
  }

  /**
   * @operationName Delete Video
   * @description Permanently deletes a video generation job and its assets from OpenAI's servers by its ID.
   * @category Videos
   * @route DELETE /delete-video
   *
   * @paramDef {"type":"String","label":"Video ID","name":"videoId","required":true,"description":"The ID of the video to delete, e.g. 'video_abc123'."}
   *
   * @returns {Object}
   * @sampleResult {"id":"video_abc123","object":"video.deleted","deleted":true}
   */
  async deleteVideo(videoId) {
    if (!videoId) {
      throw new Error('Video ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/videos/${ encodeURIComponent(videoId) }`,
      method: 'delete',
      logTag: 'deleteVideo',
    })
  }

  /**
   * @operationName Download Video Content
   * @description Downloads the rendered content of a completed Sora video job (the MP4 video, a thumbnail image, or a spritesheet), uploads it to FlowRunner file storage, and returns its URL. Generated videos expire on OpenAI's servers, so download them promptly after completion.
   * @category Videos
   * @route POST /download-video-content
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Video ID","name":"videoId","required":true,"description":"The ID of the completed video job, e.g. 'video_abc123'."}
   * @paramDef {"type":"String","label":"Variant","name":"variant","uiComponent":{"type":"DROPDOWN","options":{"values":["Video","Thumbnail","Spritesheet"]}},"defaultValue":"Video","description":"Which asset to download: the MP4 video, a WebP thumbnail, or a JPG spritesheet of frames."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"FlowRunner storage settings for the downloaded file."}
   *
   * @returns {Object}
   * @sampleResult {"fileURL":"https://example.com/files/automation/tmp/video_abc123.mp4"}
   */
  async downloadVideoContent(videoId, variant, fileOptions) {
    if (!videoId) {
      throw new Error('Video ID is required')
    }

    const resolvedVariant = this.#resolveChoice(variant, VIDEO_VARIANT_OPTIONS) || 'video'
    const extension = VIDEO_VARIANT_EXTENSIONS[resolvedVariant] || 'mp4'

    const contentBytes = await this.#apiRequest({
      url: `${ API_BASE_URL }/v1/videos/${ encodeURIComponent(videoId) }/content`,
      method: 'get',
      binary: true,
      query: resolvedVariant === 'video' ? {} : { variant: resolvedVariant },
      logTag: 'downloadVideoContent',
    })

    const buffer = Buffer.isBuffer(contentBytes) ? contentBytes : Buffer.from(contentBytes)

    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename: `${ videoId }.${ extension }`,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return { fileURL: url }
  }

  /**
   * @operationName List Models
   * @description Lists all models currently available to the account, including their owners and creation dates. Useful for discovering the exact model IDs to use in other operations.
   * @category Models
   * @route GET /list-models
   *
   * @returns {Object}
   * @sampleResult {"object":"list","data":[{"id":"gpt-4o","object":"model","created":1715367049,"owned_by":"system"},{"id":"text-embedding-3-small","object":"model","created":1705948997,"owned_by":"system"}]}
   */
  async listModels() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/models`,
      method: 'get',
      logTag: 'listModels',
    })
  }

  /**
   * @operationName Get Model
   * @description Retrieves the basic details of a specific model by its ID, confirming that it is available to the account.
   * @category Models
   * @route GET /get-model
   *
   * @paramDef {"type":"String","label":"Model","name":"modelId","required":true,"dictionary":"getModelsDictionary","description":"The model to fetch. Pick from the list or paste a model ID, e.g. 'gpt-4o'."}
   *
   * @returns {Object}
   * @sampleResult {"id":"gpt-4o","object":"model","created":1715367049,"owned_by":"system"}
   */
  async getModel(modelId) {
    if (!modelId) {
      throw new Error('Model ID is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/v1/models/${ encodeURIComponent(modelId) }`,
      method: 'get',
      logTag: 'getModel',
    })
  }
}

Flowrunner.ServerCode.addService(OpenAIService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your OpenAI API key from https://platform.openai.com/api-keys',
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

function extractOutputText(response) {
  return (response.output || [])
    .filter(item => item.type === 'message')
    .flatMap(message => (message.content || [])
      .filter(part => part.type === 'output_text')
      .map(part => part.text))
    .join('\n')
}
