'use strict'

const ROUTER_BASE_URL = 'https://router.huggingface.co/v1'
const HF_INFERENCE_BASE_URL = 'https://router.huggingface.co/hf-inference/models'
const HUB_BASE_URL = 'https://huggingface.co/api'

const DEFAULT_CHAT_MODEL = 'openai/gpt-oss-120b'
const DEFAULT_TEXT_TO_IMAGE_MODEL = 'black-forest-labs/FLUX.1-schnell'
const DEFAULT_ASR_MODEL = 'openai/whisper-large-v3'
const DEFAULT_EMBEDDING_MODEL = 'intfloat/multilingual-e5-large-instruct'
const DEFAULT_SUMMARIZATION_MODEL = 'facebook/bart-large-cnn'
const DEFAULT_TRANSLATION_MODEL = 'google-t5/t5-base'
const DEFAULT_TEXT_CLASSIFICATION_MODEL = 'distilbert/distilbert-base-uncased-finetuned-sst-2-english'
const DEFAULT_ZERO_SHOT_MODEL = 'facebook/bart-large-mnli'
const DEFAULT_FILL_MASK_MODEL = 'google-bert/bert-base-uncased'
const DEFAULT_QUESTION_ANSWERING_MODEL = 'deepset/roberta-base-squad2'

const logger = {
  info: (...args) => console.log('[Hugging Face] info:', ...args),
  debug: (...args) => console.log('[Hugging Face] debug:', ...args),
  error: (...args) => console.log('[Hugging Face] error:', ...args),
  warn: (...args) => console.log('[Hugging Face] warn:', ...args),
}

/**
 * @usesFileStorage
 * @integrationName Hugging Face
 * @integrationIcon /icon.svg
 */
class HuggingFaceService {
  constructor(config) {
    this.accessToken = config.accessToken
  }

  async #apiRequest({ url, method = 'post', body, query, binary, logTag }) {
    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }]`)

      let request = Flowrunner.Request[method](url)
        .query(query || {})
        .set({ 'Authorization': `Bearer ${ this.accessToken }` })

      if (binary) {
        request = request.setEncoding(null).unwrapBody(false)
      }

      if (body !== undefined) {
        request = request.set({ 'Content-Type': 'application/json' }).send(body)
      }

      return await request
    } catch (error) {
      error = normalizeError(error)

      const errorMsg = error.message || 'API request failed'

      logger.error(`${ logTag } - error: ${ errorMsg }`)

      throw new Error(errorMsg)
    }
  }

  async #taskRequest({ model, inputs, parameters, pipeline, binary, logTag }) {
    const body = { inputs }

    if (parameters && Object.keys(parameters).length) {
      body.parameters = parameters
    }

    const pipelinePath = pipeline ? `/pipeline/${ pipeline }` : ''

    return this.#apiRequest({
      url: `${ HF_INFERENCE_BASE_URL }/${ model }${ pipelinePath }`,
      body,
      binary,
      logTag,
    })
  }

  #definedParameters(parameters) {
    return Object.fromEntries(
      Object.entries(parameters).filter(([, value]) => value !== undefined && value !== null && value !== '')
    )
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #resolveChatModel(model, provider) {
    const resolvedModel = (model || DEFAULT_CHAT_MODEL).trim()

    if (provider && provider.trim() && !resolvedModel.includes(':')) {
      return `${ resolvedModel }:${ provider.trim() }`
    }

    return resolvedModel
  }

  async #downloadFile(fileUrl, logTag) {
    if (!fileUrl || !/^https?:\/\//i.test(fileUrl)) {
      throw new Error(`Invalid fileUrl '${ fileUrl }'. Should start with 'http://' or 'https://'`)
    }

    logger.debug(`${ logTag } - downloading file from: ${ fileUrl }`)

    const rawBytes = await Flowrunner.Request.get(fileUrl).setEncoding(null)

    return Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(rawBytes)
  }

  async #hubModelsDictionary(payload, pipelineTag, logTag) {
    const { search } = payload || {}

    const query = { sort: 'trendingScore', direction: -1, limit: 50 }

    if (pipelineTag) {
      query.pipeline_tag = pipelineTag
      query.inference_provider = 'hf-inference'
    }

    if (search?.trim()) {
      query.search = search.trim()
    }

    const models = await this.#apiRequest({
      url: `${ HUB_BASE_URL }/models`,
      method: 'get',
      query,
      logTag,
    })

    return {
      items: (models || []).map(model => ({
        label: model.id,
        value: model.id,
        note: [model.pipeline_tag, model.downloads !== undefined && `${ model.downloads } downloads`]
          .filter(Boolean).join(' · '),
      })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getChatModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — the router model list is returned in one page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Chat Models Dictionary
   * @description Provides a searchable, live list of chat models served through the Hugging Face Inference Providers router (Llama, GPT-OSS, DeepSeek, Qwen, GLM and more) for dynamic parameter selection.
   * @route POST /get-chat-models-dictionary
   * @paramDef {"type":"getChatModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"openai/gpt-oss-120b","value":"openai/gpt-oss-120b","note":"3 providers"}],"cursor":null}
   */
  async getChatModelsDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ ROUTER_BASE_URL }/models`,
      method: 'get',
      logTag: 'getChatModelsDictionary',
    })

    let models = response.data || []

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
          note: Array.isArray(model.providers) && model.providers.length
            ? `${ model.providers.length } provider${ model.providers.length === 1 ? '' : 's' }`
            : model.owned_by || null,
        })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getTextToImageModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — the list returns the top trending models in one page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Text To Image Models Dictionary
   * @description Provides a searchable list of trending text-to-image models (FLUX, Stable Diffusion and more) served by the HF Inference provider, for dynamic parameter selection.
   * @route POST /get-text-to-image-models-dictionary
   * @paramDef {"type":"getTextToImageModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"black-forest-labs/FLUX.1-schnell","value":"black-forest-labs/FLUX.1-schnell","note":"text-to-image · 812345 downloads"}],"cursor":null}
   */
  async getTextToImageModelsDictionary(payload) {
    return this.#hubModelsDictionary(payload, 'text-to-image', 'getTextToImageModelsDictionary')
  }

  /**
   * @typedef {Object} getAsrModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — the list returns the top trending models in one page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Speech Recognition Models Dictionary
   * @description Provides a searchable list of trending automatic-speech-recognition models (Whisper and more) served by the HF Inference provider, for dynamic parameter selection.
   * @route POST /get-asr-models-dictionary
   * @paramDef {"type":"getAsrModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"openai/whisper-large-v3","value":"openai/whisper-large-v3","note":"automatic-speech-recognition · 4123456 downloads"}],"cursor":null}
   */
  async getAsrModelsDictionary(payload) {
    return this.#hubModelsDictionary(payload, 'automatic-speech-recognition', 'getAsrModelsDictionary')
  }

  /**
   * @typedef {Object} getEmbeddingModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — the list returns the top trending models in one page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Embedding Models Dictionary
   * @description Provides a searchable list of trending feature-extraction (embedding) models served by the HF Inference provider, for dynamic parameter selection.
   * @route POST /get-embedding-models-dictionary
   * @paramDef {"type":"getEmbeddingModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"intfloat/multilingual-e5-large-instruct","value":"intfloat/multilingual-e5-large-instruct","note":"feature-extraction · 912345 downloads"}],"cursor":null}
   */
  async getEmbeddingModelsDictionary(payload) {
    return this.#hubModelsDictionary(payload, 'feature-extraction', 'getEmbeddingModelsDictionary')
  }

  /**
   * @typedef {Object} getSummarizationModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — the list returns the top trending models in one page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Summarization Models Dictionary
   * @description Provides a searchable list of trending summarization models (BART and more) served by the HF Inference provider, for dynamic parameter selection.
   * @route POST /get-summarization-models-dictionary
   * @paramDef {"type":"getSummarizationModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"facebook/bart-large-cnn","value":"facebook/bart-large-cnn","note":"summarization · 3123456 downloads"}],"cursor":null}
   */
  async getSummarizationModelsDictionary(payload) {
    return this.#hubModelsDictionary(payload, 'summarization', 'getSummarizationModelsDictionary')
  }

  /**
   * @typedef {Object} getTranslationModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — the list returns the top trending models in one page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Translation Models Dictionary
   * @description Provides a searchable list of trending translation models (T5, NLLB, Helsinki-NLP opus-mt and more) served by the HF Inference provider, for dynamic parameter selection.
   * @route POST /get-translation-models-dictionary
   * @paramDef {"type":"getTranslationModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"google-t5/t5-base","value":"google-t5/t5-base","note":"translation · 2123456 downloads"}],"cursor":null}
   */
  async getTranslationModelsDictionary(payload) {
    return this.#hubModelsDictionary(payload, 'translation', 'getTranslationModelsDictionary')
  }

  /**
   * @typedef {Object} getTextClassificationModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — the list returns the top trending models in one page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Text Classification Models Dictionary
   * @description Provides a searchable list of trending text-classification models (sentiment analysis, language detection and more) served by the HF Inference provider, for dynamic parameter selection.
   * @route POST /get-text-classification-models-dictionary
   * @paramDef {"type":"getTextClassificationModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"distilbert/distilbert-base-uncased-finetuned-sst-2-english","value":"distilbert/distilbert-base-uncased-finetuned-sst-2-english","note":"text-classification · 5123456 downloads"}],"cursor":null}
   */
  async getTextClassificationModelsDictionary(payload) {
    return this.#hubModelsDictionary(payload, 'text-classification', 'getTextClassificationModelsDictionary')
  }

  /**
   * @typedef {Object} getZeroShotModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — the list returns the top trending models in one page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Zero Shot Models Dictionary
   * @description Provides a searchable list of trending zero-shot-classification models (BART-MNLI, DeBERTa and more) served by the HF Inference provider, for dynamic parameter selection.
   * @route POST /get-zero-shot-models-dictionary
   * @paramDef {"type":"getZeroShotModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"facebook/bart-large-mnli","value":"facebook/bart-large-mnli","note":"zero-shot-classification · 2123456 downloads"}],"cursor":null}
   */
  async getZeroShotModelsDictionary(payload) {
    return this.#hubModelsDictionary(payload, 'zero-shot-classification', 'getZeroShotModelsDictionary')
  }

  /**
   * @typedef {Object} getFillMaskModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — the list returns the top trending models in one page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Fill Mask Models Dictionary
   * @description Provides a searchable list of trending fill-mask models (BERT, RoBERTa and more) served by the HF Inference provider, for dynamic parameter selection.
   * @route POST /get-fill-mask-models-dictionary
   * @paramDef {"type":"getFillMaskModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"google-bert/bert-base-uncased","value":"google-bert/bert-base-uncased","note":"fill-mask · 9123456 downloads"}],"cursor":null}
   */
  async getFillMaskModelsDictionary(payload) {
    return this.#hubModelsDictionary(payload, 'fill-mask', 'getFillMaskModelsDictionary')
  }

  /**
   * @typedef {Object} getQuestionAnsweringModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — the list returns the top trending models in one page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Question Answering Models Dictionary
   * @description Provides a searchable list of trending extractive question-answering models (RoBERTa-SQuAD and more) served by the HF Inference provider, for dynamic parameter selection.
   * @route POST /get-question-answering-models-dictionary
   * @paramDef {"type":"getQuestionAnsweringModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"deepset/roberta-base-squad2","value":"deepset/roberta-base-squad2","note":"question-answering · 1123456 downloads"}],"cursor":null}
   */
  async getQuestionAnsweringModelsDictionary(payload) {
    return this.#hubModelsDictionary(payload, 'question-answering', 'getQuestionAnsweringModelsDictionary')
  }

  /**
   * @typedef {Object} getHubModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — the list returns the top trending models in one page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Hub Models Dictionary
   * @description Provides a searchable list of trending Hugging Face Hub models across all tasks, for dynamic parameter selection.
   * @route POST /get-hub-models-dictionary
   * @paramDef {"type":"getHubModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"meta-llama/Llama-3.3-70B-Instruct","value":"meta-llama/Llama-3.3-70B-Instruct","note":"text-generation · 8123456 downloads"}],"cursor":null}
   */
  async getHubModelsDictionary(payload) {
    return this.#hubModelsDictionary(payload, null, 'getHubModelsDictionary')
  }

  /**
   * @operationName Chat Completion
   * @description Generates a text response for a single prompt through the Hugging Face Inference Providers router (OpenAI-compatible), which routes the request to partner providers such as Groq, Together, Cerebras, Fireworks and more. Accepts any Hub chat model ID (e.g. 'meta-llama/Llama-3.3-70B-Instruct'), an optional system prompt, JSON mode, and a provider selection policy ('fastest', 'cheapest', 'preferred' or a specific provider slug). Returns the generated text, finish reason and token usage.
   * @category Chat
   * @route POST /chat-completion
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The user message to send to the model."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getChatModelsDictionary","defaultValue":"openai/gpt-oss-120b","description":"The Hub model to use, e.g. 'meta-llama/Llama-3.3-70B-Instruct'. Defaults to 'openai/gpt-oss-120b'. May include a provider suffix like ':groq'."}
   * @paramDef {"type":"String","label":"Provider","name":"provider","description":"Optional provider selection appended to the model ID: a policy ('fastest', 'cheapest', 'preferred') or a specific provider slug such as 'groq', 'together', 'cerebras', 'fireworks-ai', 'novita'. Ignored if the model already contains a ':provider' suffix. Defaults to the router's 'fastest' policy."}
   * @paramDef {"type":"String","label":"System Prompt","name":"systemPrompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional system instructions that set the model's behavior, tone and constraints."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature between 0 and 2. Higher values produce more random output."}
   * @paramDef {"type":"Number","label":"Max Tokens","name":"maxTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens the model may generate for the completion."}
   * @paramDef {"type":"Number","label":"Top P","name":"topP","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Nucleus sampling threshold between 0 and 1. Alter this or Temperature, not both."}
   * @paramDef {"type":"Array<String>","label":"Stop Sequences","name":"stop","description":"Up to 4 sequences where the model stops generating further tokens."}
   * @paramDef {"type":"Number","label":"Seed","name":"seed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Seed for best-effort deterministic sampling. Not all providers support it."}
   * @paramDef {"type":"Boolean","label":"JSON Mode","name":"jsonMode","uiComponent":{"type":"TOGGLE"},"description":"When enabled, forces the model to return valid JSON. Your prompt should explicitly ask for JSON output. Not supported by every provider/model combination."}
   *
   * @returns {Object}
   * @sampleResult {"text":"Hugging Face Inference Providers route your request to the fastest available partner.","model":"openai/gpt-oss-120b","finishReason":"stop","usage":{"prompt_tokens":21,"completion_tokens":15,"total_tokens":36}}
   */
  async chatCompletion(prompt, model, provider, systemPrompt, temperature, maxTokens, topP, stop, seed, jsonMode) {
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    const messages = []

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt })
    }

    messages.push({ role: 'user', content: prompt })

    const body = {
      model: this.#resolveChatModel(model, provider),
      messages,
    }

    if (temperature !== undefined && temperature !== null) body.temperature = temperature
    if (maxTokens) body.max_tokens = maxTokens
    if (topP !== undefined && topP !== null) body.top_p = topP
    if (stop?.length) body.stop = stop
    if (seed !== undefined && seed !== null) body.seed = seed
    if (jsonMode) body.response_format = { type: 'json_object' }

    const response = await this.#apiRequest({
      url: `${ ROUTER_BASE_URL }/chat/completions`,
      body,
      logTag: 'chatCompletion',
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
   * @operationName Chat Completion (Advanced)
   * @description Sends a fully custom chat completion request through the Hugging Face Inference Providers router (OpenAI-compatible) with a complete messages array (multi-turn conversations, multimodal image_url content parts for vision models), tool/function calling passthrough, structured outputs via a response format object, penalties and sampling parameters. Returns the raw router response including choices, tool calls and usage.
   * @category Chat
   * @route POST /chat-completion-advanced
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Array<Object>","label":"Messages","name":"messages","required":true,"description":"Conversation messages in OpenAI format, e.g. [{\"role\":\"system\",\"content\":\"...\"},{\"role\":\"user\",\"content\":\"...\"}]. Content may also be an array of content parts (text, image_url) for vision models."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getChatModelsDictionary","defaultValue":"openai/gpt-oss-120b","description":"The Hub model to use, e.g. 'meta-llama/Llama-3.3-70B-Instruct'. Defaults to 'openai/gpt-oss-120b'. May include a provider suffix like ':groq'."}
   * @paramDef {"type":"String","label":"Provider","name":"provider","description":"Optional provider selection appended to the model ID: a policy ('fastest', 'cheapest', 'preferred') or a specific provider slug such as 'groq', 'together', 'cerebras', 'fireworks-ai', 'novita'. Ignored if the model already contains a ':provider' suffix."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature between 0 and 2."}
   * @paramDef {"type":"Number","label":"Max Tokens","name":"maxTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens the model may generate for the completion."}
   * @paramDef {"type":"Number","label":"Top P","name":"topP","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Nucleus sampling threshold between 0 and 1."}
   * @paramDef {"type":"Array<String>","label":"Stop Sequences","name":"stop","description":"Up to 4 sequences where the model stops generating further tokens."}
   * @paramDef {"type":"Number","label":"Seed","name":"seed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Seed for best-effort deterministic sampling. Not all providers support it."}
   * @paramDef {"type":"Object","label":"Response Format","name":"responseFormat","description":"Structured output specification, e.g. {\"type\":\"json_object\"} or {\"type\":\"json_schema\",\"json_schema\":{\"name\":\"result\",\"schema\":{...}}}. Provider support varies."}
   * @paramDef {"type":"Array<Object>","label":"Tools","name":"tools","description":"Tool definitions the model may call, in OpenAI function-calling format: [{\"type\":\"function\",\"function\":{\"name\":\"...\",\"description\":\"...\",\"parameters\":{...}}}]."}
   * @paramDef {"type":"String","label":"Tool Choice","name":"toolChoice","description":"Controls tool usage: 'none', 'auto', 'required', or a JSON string selecting a specific function, e.g. {\"type\":\"function\",\"function\":{\"name\":\"my_tool\"}}."}
   * @paramDef {"type":"Number","label":"Frequency Penalty","name":"frequencyPenalty","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number between -2.0 and 2.0. Positive values penalize repeated tokens, reducing verbatim repetition."}
   * @paramDef {"type":"Number","label":"Presence Penalty","name":"presencePenalty","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number between -2.0 and 2.0. Positive values encourage the model to talk about new topics."}
   *
   * @returns {Object}
   * @sampleResult {"id":"chatcmpl-9f1d8c2a","object":"chat.completion","created":1783958400,"model":"openai/gpt-oss-120b","choices":[{"index":0,"message":{"role":"assistant","content":"Hello! How can I help you today?"},"finish_reason":"stop"}],"usage":{"prompt_tokens":18,"completion_tokens":10,"total_tokens":28}}
   */
  async chatCompletionAdvanced(messages, model, provider, temperature, maxTokens, topP, stop, seed, responseFormat, tools, toolChoice, frequencyPenalty, presencePenalty) {
    if (!messages?.length) {
      throw new Error('Messages array is required and must not be empty')
    }

    const body = {
      model: this.#resolveChatModel(model, provider),
      messages,
    }

    if (temperature !== undefined && temperature !== null) body.temperature = temperature
    if (maxTokens) body.max_tokens = maxTokens
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

    return this.#apiRequest({
      url: `${ ROUTER_BASE_URL }/chat/completions`,
      body,
      logTag: 'chatCompletionAdvanced',
    })
  }

  /**
   * @operationName Generate Image
   * @description Generates an image from a text prompt using a text-to-image diffusion model (FLUX, Stable Diffusion and more) served by the Hugging Face HF Inference provider. Supports negative prompts, image dimensions, guidance scale, inference steps and a seed for reproducibility. Saves the generated image to FlowRunner file storage and returns its URL. Note: models that are cold may take extra time to load on the first request.
   * @category Images
   * @route POST /generate-image
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text description of the image to generate."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getTextToImageModelsDictionary","defaultValue":"black-forest-labs/FLUX.1-schnell","description":"The text-to-image model to use. Defaults to 'black-forest-labs/FLUX.1-schnell'."}
   * @paramDef {"type":"String","label":"Negative Prompt","name":"negativePrompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"One prompt describing what NOT to include in the generated image. Not supported by every model (e.g. FLUX ignores it)."}
   * @paramDef {"type":"Number","label":"Width","name":"width","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The width in pixels of the output image. Model-dependent; typically a multiple of 8."}
   * @paramDef {"type":"Number","label":"Height","name":"height","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The height in pixels of the output image. Model-dependent; typically a multiple of 8."}
   * @paramDef {"type":"Number","label":"Guidance Scale","name":"guidanceScale","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How closely the image follows the prompt. Higher values follow the prompt more strictly but may cause artifacts."}
   * @paramDef {"type":"Number","label":"Inference Steps","name":"numInferenceSteps","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The number of denoising steps. More steps usually produce higher quality at the expense of slower inference."}
   * @paramDef {"type":"Number","label":"Seed","name":"seed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Seed for the random number generator, for reproducible results."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   *
   * @returns {Object}
   * @sampleResult {"fileURL":"https://example.com/files/automation/tmp/hf_image_1783958400000.png","model":"black-forest-labs/FLUX.1-schnell"}
   */
  async generateImage(prompt, model, negativePrompt, width, height, guidanceScale, numInferenceSteps, seed, fileOptions) {
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    const resolvedModel = model || DEFAULT_TEXT_TO_IMAGE_MODEL

    const response = await this.#taskRequest({
      model: resolvedModel,
      inputs: prompt,
      parameters: this.#definedParameters({
        negative_prompt: negativePrompt,
        width,
        height,
        guidance_scale: guidanceScale,
        num_inference_steps: numInferenceSteps,
        seed,
      }),
      binary: true,
      logTag: 'generateImage',
    })

    const imageBytes = response?.body !== undefined ? response.body : response
    const buffer = Buffer.isBuffer(imageBytes) ? imageBytes : Buffer.from(imageBytes)

    const contentType = response?.headers?.['content-type'] || ''
    const extension = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg'
      : contentType.includes('webp') ? 'webp'
        : 'png'

    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename: `hf_image_${ Date.now() }.${ extension }`,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return { fileURL: url, model: resolvedModel }
  }

  /**
   * @operationName Transcribe Audio
   * @description Transcribes an audio file into text using an automatic-speech-recognition model (e.g. OpenAI Whisper) served by the Hugging Face HF Inference provider. Downloads the audio from the provided URL (FlowRunner file URL or any public URL; flac, mp3, wav, m4a, ogg and other common formats) and sends it base64-encoded. Optionally returns per-chunk timestamps. Note: cold models may take extra time to load on the first request.
   * @category Audio
   * @route POST /transcribe-audio
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"description":"URL of the audio file to transcribe — a FlowRunner file URL or any public 'http(s)://' URL."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getAsrModelsDictionary","defaultValue":"openai/whisper-large-v3","description":"The speech-recognition model to use. Defaults to 'openai/whisper-large-v3'."}
   * @paramDef {"type":"Boolean","label":"Return Timestamps","name":"returnTimestamps","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the response includes 'chunks' with start/end timestamps for each recognized text segment."}
   *
   * @returns {Object}
   * @sampleResult {"text":"Welcome everyone to the quarterly business review.","chunks":null}
   */
  async transcribeAudio(fileUrl, model, returnTimestamps) {
    const fileBuffer = await this.#downloadFile(fileUrl, 'transcribeAudio')

    const response = await this.#taskRequest({
      model: model || DEFAULT_ASR_MODEL,
      inputs: fileBuffer.toString('base64'),
      parameters: returnTimestamps ? { return_timestamps: true } : undefined,
      logTag: 'transcribeAudio',
    })

    return {
      text: response?.text ?? '',
      chunks: response?.chunks ?? null,
    }
  }

  /**
   * @operationName Create Embeddings
   * @description Converts one or more texts into embedding vectors using a feature-extraction model served by the Hugging Face HF Inference provider — useful for semantic search, RAG, clustering and similarity. Returns the embedding vectors together with their count and dimensionality.
   * @category Embeddings
   * @route POST /create-embeddings
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Array<String>","label":"Texts","name":"texts","required":true,"description":"One or more texts to convert into embedding vectors."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getEmbeddingModelsDictionary","defaultValue":"intfloat/multilingual-e5-large-instruct","description":"The feature-extraction model to use. Defaults to 'intfloat/multilingual-e5-large-instruct'."}
   * @paramDef {"type":"Boolean","label":"Normalize","name":"normalize","uiComponent":{"type":"TOGGLE"},"description":"Whether to L2-normalize the returned embedding vectors."}
   * @paramDef {"type":"Boolean","label":"Truncate","name":"truncate","uiComponent":{"type":"TOGGLE"},"description":"Whether to truncate inputs that exceed the model's maximum sequence length instead of failing."}
   *
   * @returns {Object}
   * @sampleResult {"embeddings":[[0.0123,-0.0456,0.0789]],"count":1,"dimensions":1024,"model":"intfloat/multilingual-e5-large-instruct"}
   */
  async createEmbeddings(texts, model, normalize, truncate) {
    if (!texts?.length) {
      throw new Error('At least one text is required')
    }

    const resolvedModel = model || DEFAULT_EMBEDDING_MODEL

    const body = { inputs: texts }

    if (normalize !== undefined && normalize !== null) body.normalize = normalize
    if (truncate !== undefined && truncate !== null) body.truncate = truncate

    const response = await this.#apiRequest({
      url: `${ HF_INFERENCE_BASE_URL }/${ resolvedModel }/pipeline/feature-extraction`,
      body,
      logTag: 'createEmbeddings',
    })

    const embeddings = Array.isArray(response?.[0]) ? response : [response]

    return {
      embeddings,
      count: embeddings.length,
      dimensions: embeddings[0]?.length ?? 0,
      model: resolvedModel,
    }
  }

  /**
   * @operationName Summarize Text
   * @description Produces a shorter version of a document while preserving its important information, using a summarization model (e.g. facebook/bart-large-cnn) served by the Hugging Face HF Inference provider. Returns the generated summary text.
   * @category Text Transformation
   * @route POST /summarize-text
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The input text to summarize."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getSummarizationModelsDictionary","defaultValue":"facebook/bart-large-cnn","description":"The summarization model to use. Defaults to 'facebook/bart-large-cnn'."}
   *
   * @returns {Object}
   * @sampleResult {"summary":"The quarterly review covered revenue growth, product launches and the expansion roadmap."}
   */
  async summarizeText(text, model) {
    if (!text || !text.trim()) {
      throw new Error('Text is required')
    }

    const response = await this.#taskRequest({
      model: model || DEFAULT_SUMMARIZATION_MODEL,
      inputs: text,
      logTag: 'summarizeText',
    })

    const item = Array.isArray(response) ? response[0] : response

    return { summary: item?.summary_text ?? '' }
  }

  /**
   * @operationName Translate Text
   * @description Translates text from one language to another using a translation model served by the Hugging Face HF Inference provider. Single-pair models (e.g. Helsinki-NLP/opus-mt-en-de) need no language codes; multilingual models (e.g. facebook/nllb-200-distilled-600M) require source and target language codes in the model's own format (e.g. FLORES-200 codes like 'eng_Latn', 'fra_Latn' for NLLB). Returns the translated text.
   * @category Text Transformation
   * @route POST /translate-text
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text to translate."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getTranslationModelsDictionary","defaultValue":"google-t5/t5-base","description":"The translation model to use. Defaults to 'google-t5/t5-base' (English to German, French or Romanian)."}
   * @paramDef {"type":"String","label":"Source Language","name":"sourceLanguage","description":"The source language code, required for multilingual models. Use the model's expected format, e.g. 'eng_Latn' for NLLB models."}
   * @paramDef {"type":"String","label":"Target Language","name":"targetLanguage","description":"The target language code, required for multilingual models. Use the model's expected format, e.g. 'deu_Latn' for NLLB models."}
   *
   * @returns {Object}
   * @sampleResult {"translation":"Das Treffen wurde auf nächsten Dienstag verschoben."}
   */
  async translateText(text, model, sourceLanguage, targetLanguage) {
    if (!text || !text.trim()) {
      throw new Error('Text is required')
    }

    const response = await this.#taskRequest({
      model: model || DEFAULT_TRANSLATION_MODEL,
      inputs: text,
      parameters: this.#definedParameters({
        src_lang: sourceLanguage,
        tgt_lang: targetLanguage,
      }),
      logTag: 'translateText',
    })

    const item = Array.isArray(response) ? response[0] : response

    return { translation: item?.translation_text ?? '' }
  }

  /**
   * @operationName Classify Text
   * @description Assigns labels with confidence scores to a text using a text-classification model served by the Hugging Face HF Inference provider — for sentiment analysis, language detection, toxicity screening and similar tasks with model-defined label sets. Returns all predicted labels with scores plus the top label.
   * @category Text Analysis
   * @route POST /classify-text
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text to classify."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getTextClassificationModelsDictionary","defaultValue":"distilbert/distilbert-base-uncased-finetuned-sst-2-english","description":"The text-classification model to use. Defaults to a sentiment analysis model (POSITIVE/NEGATIVE labels)."}
   * @paramDef {"type":"Number","label":"Top K","name":"topK","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"When specified, limits the output to the top K most probable classes."}
   *
   * @returns {Object}
   * @sampleResult {"labels":[{"label":"POSITIVE","score":0.9987},{"label":"NEGATIVE","score":0.0013}],"topLabel":"POSITIVE","topScore":0.9987}
   */
  async classifyText(text, model, topK) {
    if (!text || !text.trim()) {
      throw new Error('Text is required')
    }

    const response = await this.#taskRequest({
      model: model || DEFAULT_TEXT_CLASSIFICATION_MODEL,
      inputs: text,
      parameters: this.#definedParameters({ top_k: topK }),
      logTag: 'classifyText',
    })

    const labels = Array.isArray(response?.[0]) ? response[0] : (response || [])

    return {
      labels,
      topLabel: labels[0]?.label ?? null,
      topScore: labels[0]?.score ?? null,
    }
  }

  /**
   * @operationName Classify Text (Zero-Shot)
   * @description Classifies a text against an arbitrary set of candidate labels you provide — no training required — using a zero-shot-classification model (e.g. facebook/bart-large-mnli) served by the Hugging Face HF Inference provider. Supports multi-label mode and a custom hypothesis template. Returns each candidate label with its score plus the top label.
   * @category Text Analysis
   * @route POST /classify-text-zero-shot
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text to classify."}
   * @paramDef {"type":"Array<String>","label":"Candidate Labels","name":"candidateLabels","required":true,"description":"The set of possible class labels to classify the text into, e.g. ['refund', 'legal', 'faq']."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getZeroShotModelsDictionary","defaultValue":"facebook/bart-large-mnli","description":"The zero-shot-classification model to use. Defaults to 'facebook/bart-large-mnli'."}
   * @paramDef {"type":"Boolean","label":"Multi Label","name":"multiLabel","uiComponent":{"type":"TOGGLE"},"description":"When enabled, labels are scored independently (several can be true); otherwise scores are normalized to sum to 1."}
   * @paramDef {"type":"String","label":"Hypothesis Template","name":"hypothesisTemplate","description":"Optional sentence template used with each candidate label, e.g. 'This text is about {}.'."}
   *
   * @returns {Object}
   * @sampleResult {"labels":[{"label":"refund","score":0.8721},{"label":"faq","score":0.0912},{"label":"legal","score":0.0367}],"topLabel":"refund","topScore":0.8721}
   */
  async classifyTextZeroShot(text, candidateLabels, model, multiLabel, hypothesisTemplate) {
    if (!text || !text.trim()) {
      throw new Error('Text is required')
    }

    if (!candidateLabels?.length) {
      throw new Error('At least one candidate label is required')
    }

    const response = await this.#taskRequest({
      model: model || DEFAULT_ZERO_SHOT_MODEL,
      inputs: text,
      parameters: this.#definedParameters({
        candidate_labels: candidateLabels,
        multi_label: multiLabel,
        hypothesis_template: hypothesisTemplate,
      }),
      logTag: 'classifyTextZeroShot',
    })

    let labels

    if (Array.isArray(response)) {
      labels = Array.isArray(response[0]) ? response[0] : response
    } else if (Array.isArray(response?.labels) && Array.isArray(response?.scores)) {
      labels = response.labels.map((label, index) => ({ label, score: response.scores[index] }))
    } else {
      labels = []
    }

    return {
      labels,
      topLabel: labels[0]?.label ?? null,
      topScore: labels[0]?.score ?? null,
    }
  }

  /**
   * @operationName Fill Mask
   * @description Predicts the most likely words for a masked token in a sentence using a fill-mask model served by the Hugging Face HF Inference provider. Use the model's mask token in the input — '[MASK]' for BERT-style models, '<mask>' for RoBERTa-style models. Returns the top predictions with their scores and completed sequences.
   * @category Text Analysis
   * @route POST /fill-mask
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text containing the mask token to fill, e.g. 'The capital of France is [MASK].'."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getFillMaskModelsDictionary","defaultValue":"google-bert/bert-base-uncased","description":"The fill-mask model to use. Defaults to 'google-bert/bert-base-uncased' (mask token '[MASK]')."}
   * @paramDef {"type":"Number","label":"Top K","name":"topK","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"When specified, overrides the number of predictions to return."}
   * @paramDef {"type":"Array<String>","label":"Targets","name":"targets","description":"When provided, the model limits scoring to these candidate words instead of the whole vocabulary."}
   *
   * @returns {Object}
   * @sampleResult {"predictions":[{"sequence":"the capital of france is paris.","score":0.9713,"token":3000,"token_str":"paris"}]}
   */
  async fillMask(text, model, topK, targets) {
    if (!text || !text.trim()) {
      throw new Error('Text is required')
    }

    const response = await this.#taskRequest({
      model: model || DEFAULT_FILL_MASK_MODEL,
      inputs: text,
      parameters: this.#definedParameters({
        top_k: topK,
        targets: targets?.length ? targets : undefined,
      }),
      logTag: 'fillMask',
    })

    const predictions = Array.isArray(response?.[0]) ? response[0] : (response || [])

    return { predictions }
  }

  /**
   * @operationName Answer Question
   * @description Extracts the answer to a question from a provided context text using an extractive question-answering model (e.g. deepset/roberta-base-squad2) served by the Hugging Face HF Inference provider. Returns the best answer with its confidence score and character positions, plus alternative answers when Top K is set.
   * @category Text Analysis
   * @route POST /answer-question
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Question","name":"question","required":true,"description":"The question to answer."}
   * @paramDef {"type":"String","label":"Context","name":"context","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text containing the answer to the question."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getQuestionAnsweringModelsDictionary","defaultValue":"deepset/roberta-base-squad2","description":"The question-answering model to use. Defaults to 'deepset/roberta-base-squad2'."}
   * @paramDef {"type":"Number","label":"Top K","name":"topK","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The number of candidate answers to return, ordered by likelihood."}
   *
   * @returns {Object}
   * @sampleResult {"answer":"Paris","score":0.9832,"answers":[{"answer":"Paris","score":0.9832,"start":21,"end":26}]}
   */
  async answerQuestion(question, context, model, topK) {
    if (!question || !question.trim()) {
      throw new Error('Question is required')
    }

    if (!context || !context.trim()) {
      throw new Error('Context is required')
    }

    const response = await this.#taskRequest({
      model: model || DEFAULT_QUESTION_ANSWERING_MODEL,
      inputs: { question, context },
      parameters: this.#definedParameters({ top_k: topK }),
      logTag: 'answerQuestion',
    })

    const answers = Array.isArray(response) ? response : [response].filter(Boolean)

    return {
      answer: answers[0]?.answer ?? null,
      score: answers[0]?.score ?? null,
      answers,
    }
  }

  /**
   * @operationName Search Models
   * @description Searches the Hugging Face Hub for models by name, author, task (pipeline tag) and serving provider. Supports sorting by trending score, downloads, likes or recency, and limiting the number of results. Returns model IDs with metadata such as pipeline tag, downloads, likes and tags.
   * @category Hub
   * @route GET /search-models
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to search model names and IDs for, e.g. 'llama' or 'whisper'."}
   * @paramDef {"type":"String","label":"Author","name":"author","description":"Filter by the model author or organization, e.g. 'meta-llama' or 'google'."}
   * @paramDef {"type":"String","label":"Task","name":"pipelineTag","uiComponent":{"type":"DROPDOWN","options":{"values":["Text Generation","Text to Image","Image Text to Text","Automatic Speech Recognition","Text to Speech","Feature Extraction","Summarization","Translation","Text Classification","Zero-Shot Classification","Fill Mask","Question Answering","Image Classification","Object Detection","Text to Video"]}},"description":"Filter models by task (pipeline tag)."}
   * @paramDef {"type":"String","label":"Inference Provider","name":"inferenceProvider","description":"Filter to models served by an Inference Provider: a provider slug such as 'hf-inference', 'groq', 'together', 'fal-ai', a comma-separated list, or 'all' for models served by at least one provider."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Trending","Downloads","Likes","Last Modified","Created"]}},"defaultValue":"Trending","description":"Field to sort results by, in descending order. Defaults to 'Trending'."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of models to return. Defaults to 20."}
   *
   * @returns {Object}
   * @sampleResult {"count":1,"models":[{"id":"meta-llama/Llama-3.3-70B-Instruct","pipeline_tag":"text-generation","downloads":8123456,"likes":2456,"tags":["transformers","llama"],"createdAt":"2024-12-06T00:00:00.000Z"}]}
   */
  async searchModels(search, author, pipelineTag, inferenceProvider, sortBy, limit) {
    const query = this.#definedParameters({
      search,
      author,
      pipeline_tag: this.#resolveChoice(pipelineTag, {
        'Text Generation': 'text-generation',
        'Text to Image': 'text-to-image',
        'Image Text to Text': 'image-text-to-text',
        'Automatic Speech Recognition': 'automatic-speech-recognition',
        'Text to Speech': 'text-to-speech',
        'Feature Extraction': 'feature-extraction',
        'Summarization': 'summarization',
        'Translation': 'translation',
        'Text Classification': 'text-classification',
        'Zero-Shot Classification': 'zero-shot-classification',
        'Fill Mask': 'fill-mask',
        'Question Answering': 'question-answering',
        'Image Classification': 'image-classification',
        'Object Detection': 'object-detection',
        'Text to Video': 'text-to-video',
      }),
      inference_provider: inferenceProvider,
      sort: this.#resolveChoice(sortBy, {
        'Trending': 'trendingScore',
        'Downloads': 'downloads',
        'Likes': 'likes',
        'Last Modified': 'lastModified',
        'Created': 'createdAt',
      }) || 'trendingScore',
      direction: -1,
      limit: limit || 20,
    })

    const models = await this.#apiRequest({
      url: `${ HUB_BASE_URL }/models`,
      method: 'get',
      query,
      logTag: 'searchModels',
    })

    return { count: (models || []).length, models: models || [] }
  }

  /**
   * @operationName Get Model Info
   * @description Retrieves the details of a Hugging Face Hub model by its ID, including pipeline tag, tags, downloads, likes, library, gated status and available siblings (files). Useful for validating a model before using it in inference operations.
   * @category Hub
   * @route GET /get-model-info
   *
   * @paramDef {"type":"String","label":"Model","name":"modelId","required":true,"dictionary":"getHubModelsDictionary","description":"The model to fetch, e.g. 'meta-llama/Llama-3.3-70B-Instruct'. Pick from the list or paste a model ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":"meta-llama/Llama-3.3-70B-Instruct","modelId":"meta-llama/Llama-3.3-70B-Instruct","author":"meta-llama","pipeline_tag":"text-generation","downloads":8123456,"likes":2456,"tags":["transformers","llama"],"createdAt":"2024-12-06T00:00:00.000Z"}
   */
  async getModelInfo(modelId) {
    if (!modelId) {
      throw new Error('Model ID is required')
    }

    return this.#apiRequest({
      url: `${ HUB_BASE_URL }/models/${ modelId }`,
      method: 'get',
      logTag: 'getModelInfo',
    })
  }

  /**
   * @operationName Search Datasets
   * @description Searches the Hugging Face Hub for datasets by name and author, with sorting by trending score, downloads, likes or recency and a result limit. Returns dataset IDs with metadata such as downloads, likes and tags.
   * @category Hub
   * @route GET /search-datasets
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to search dataset names and IDs for, e.g. 'squad' or 'imdb'."}
   * @paramDef {"type":"String","label":"Author","name":"author","description":"Filter by the dataset author or organization, e.g. 'huggingface' or 'stanfordnlp'."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Trending","Downloads","Likes","Last Modified","Created"]}},"defaultValue":"Trending","description":"Field to sort results by, in descending order. Defaults to 'Trending'."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of datasets to return. Defaults to 20."}
   *
   * @returns {Object}
   * @sampleResult {"count":1,"datasets":[{"id":"stanfordnlp/imdb","author":"stanfordnlp","downloads":312456,"likes":345,"tags":["task_categories:text-classification"],"createdAt":"2022-03-02T00:00:00.000Z"}]}
   */
  async searchDatasets(search, author, sortBy, limit) {
    const query = this.#definedParameters({
      search,
      author,
      sort: this.#resolveChoice(sortBy, {
        'Trending': 'trendingScore',
        'Downloads': 'downloads',
        'Likes': 'likes',
        'Last Modified': 'lastModified',
        'Created': 'createdAt',
      }) || 'trendingScore',
      direction: -1,
      limit: limit || 20,
    })

    const datasets = await this.#apiRequest({
      url: `${ HUB_BASE_URL }/datasets`,
      method: 'get',
      query,
      logTag: 'searchDatasets',
    })

    return { count: (datasets || []).length, datasets: datasets || [] }
  }

  /**
   * @operationName Get Account Info
   * @description Retrieves the profile associated with the configured Hugging Face access token via the whoami-v2 endpoint — user or organization name, full name, email, plan and token permission details. Useful for validating that the token is correct and has the expected permissions.
   * @category Account
   * @route GET /get-account-info
   *
   * @returns {Object}
   * @sampleResult {"type":"user","id":"5f0c1ab7","name":"acme","fullname":"Acme Inc","email":"dev@acme.com","isPro":false,"orgs":[],"auth":{"type":"access_token","accessToken":{"displayName":"flowrunner","role":"fineGrained"}}}
   */
  async getAccountInfo() {
    return this.#apiRequest({
      url: `${ HUB_BASE_URL }/whoami-v2`,
      method: 'get',
      logTag: 'getAccountInfo',
    })
  }
}

Flowrunner.ServerCode.addService(HuggingFaceService, [
  {
    name: 'accessToken',
    displayName: 'Access Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Hugging Face access token from https://huggingface.co/settings/tokens. Use a fine-grained token with the "Make calls to Inference Providers" permission (read access to the Hub is recommended for model search).',
  },
])

function normalizeError(error) {
  if (error.body?.error?.message) {
    error.message = error.body.error.message
  } else if (typeof error.body?.error === 'string') {
    error.message = error.body.error
  } else if (error.body?.message) {
    error.message = error.body.message
  } else if (error.message && typeof error.message === 'object') {
    error.message = JSON.stringify(error.message)
  }

  return error
}
