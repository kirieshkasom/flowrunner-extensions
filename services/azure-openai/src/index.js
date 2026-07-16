'use strict'

const DEFAULT_API_VERSION = 'v1'
const DEFAULT_TTS_SPEED = 1.0

const logger = {
  info: (...args) => console.log('[Azure OpenAI] info:', ...args),
  debug: (...args) => console.log('[Azure OpenAI] debug:', ...args),
  error: (...args) => console.log('[Azure OpenAI] error:', ...args),
  warn: (...args) => console.log('[Azure OpenAI] warn:', ...args),
}

/**
 * @usesFileStorage
 * @integrationName Azure OpenAI
 * @integrationIcon /icon.svg
 */
class AzureOpenAIService {
  constructor(config) {
    this.apiKey = config.apiKey
    this.endpoint = (config.endpoint || '').trim().replace(/\/+$/, '')
    this.apiVersion = (config.apiVersion || DEFAULT_API_VERSION).trim() || DEFAULT_API_VERSION
  }

  #isV1() {
    return this.apiVersion.toLowerCase() === 'v1'
  }

  /**
   * All external calls go through here. Two routing modes:
   * - 'v1' (default): {endpoint}/openai/v1/{path} — OpenAI-compatible surface,
   *   the deployment name is passed as the `model` property.
   * - dated api-version (e.g. 2024-10-21): legacy
   *   {endpoint}/openai/deployments/{deployment}/{path}?api-version={version}.
   */
  async #apiRequest({ path, deployment, method = 'post', body, form, binary, logTag }) {
    if (!/^https?:\/\//i.test(this.endpoint)) {
      throw new Error(
        `Invalid Azure OpenAI endpoint '${ this.endpoint }'. ` +
        'It must look like https://my-resource.openai.azure.com (no trailing slash).'
      )
    }

    const isV1 = this.#isV1()

    const url = isV1
      ? `${ this.endpoint }/openai/v1/${ path }`
      : `${ this.endpoint }/openai/deployments/${ encodeURIComponent(deployment) }/${ path }`

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }]`)

      let request = Flowrunner.Request[method](url)
        .query(isV1 ? {} : { 'api-version': this.apiVersion })
        .set({ 'api-key': this.apiKey })

      if (binary) {
        request = request.setEncoding(null).unwrapBody(false)
      }

      if (form) {
        if (isV1 && deployment) {
          form.append('model', deployment)
        }

        request.form(form)
      } else if (body !== undefined) {
        const payload = isV1 && deployment ? { model: deployment, ...body } : body

        request = request.set({ 'Content-Type': 'application/json' }).send(payload)
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

  #extractFileName(url) {
    const pathname = url.split('?')[0].split('#')[0]

    return pathname.split('/').pop() || 'audio'
  }

  async #downloadFile(fileUrl, logTag) {
    if (!fileUrl || !/^https?:\/\//i.test(fileUrl)) {
      throw new Error(`Invalid fileUrl '${ fileUrl }'. Should start with 'http://' or 'https://'`)
    }

    logger.debug(`${ logTag } - downloading file from: ${ fileUrl }`)

    const rawFileBytes = await Flowrunner.Request.get(fileUrl).setEncoding(null)

    return Buffer.isBuffer(rawFileBytes) ? rawFileBytes : Buffer.from(rawFileBytes)
  }

  async #transcribeOrTranslate({ path, deployment, fileUrl, language, prompt, responseFormat, temperature, logTag }) {
    if (!deployment || !deployment.trim()) {
      throw new Error('Deployment name is required')
    }

    const fileBuffer = await this.#downloadFile(fileUrl, logTag)

    const resolvedFormat = this.#resolveChoice(responseFormat, {
      'JSON': 'json',
      'Text': 'text',
      'SRT': 'srt',
      'Verbose JSON': 'verbose_json',
      'VTT': 'vtt',
    }) || 'json'

    const form = new Flowrunner.Request.FormData()

    form.append('file', fileBuffer, { filename: this.#extractFileName(fileUrl) })
    form.append('response_format', resolvedFormat)

    if (language) {
      form.append('language', language)
    }

    if (prompt) {
      form.append('prompt', prompt)
    }

    if (temperature !== undefined && temperature !== null) {
      form.append('temperature', String(temperature))
    }

    const response = await this.#apiRequest({ path, deployment, form, logTag })

    return typeof response === 'string' ? { text: response } : response
  }

  /**
   * @operationName Ask AI
   * @category Chat
   * @description Sends a single prompt (with an optional system instruction) to a chat model deployment and returns the generated text along with token usage. Azure content filter results are included when the resource returns them. Use "Chat Completion (Advanced)" for multi-turn conversations, tool calling, or structured outputs.
   * @route POST /ask-ai
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Deployment","name":"deployment","required":true,"description":"The deployment name you created in Azure AI Foundry / Azure OpenAI Studio (not the model name), e.g. 'my-gpt-4o'."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The user message to send to the model."}
   * @paramDef {"type":"String","label":"System Instruction","name":"system","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional system message that sets the assistant's behavior, tone, and constraints."}
   * @paramDef {"type":"Number","label":"Max Tokens","name":"maxTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Upper bound on generated tokens (sent as max_completion_tokens). Leave empty to use the model default."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature between 0 and 2. Lower values are more deterministic. Leave empty to use the model default."}
   *
   * @returns {Object}
   * @sampleResult {"text":"Azure OpenAI provides REST API access to OpenAI models hosted in your Azure subscription.","finishReason":"stop","usage":{"prompt_tokens":24,"completion_tokens":18,"total_tokens":42},"contentFilterResults":{"hate":{"filtered":false,"severity":"safe"},"violence":{"filtered":false,"severity":"safe"}}}
   */
  async askAI(deployment, prompt, system, maxTokens, temperature) {
    if (!deployment || !deployment.trim()) {
      throw new Error('Deployment name is required')
    }

    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    const messages = []

    if (system) {
      messages.push({ role: 'system', content: system })
    }

    messages.push({ role: 'user', content: prompt })

    const body = { messages }

    if (maxTokens !== undefined && maxTokens !== null) {
      body.max_completion_tokens = maxTokens
    }

    if (temperature !== undefined && temperature !== null) {
      body.temperature = temperature
    }

    const response = await this.#apiRequest({
      path: 'chat/completions',
      deployment,
      body,
      logTag: 'askAI',
    })

    const choice = response.choices?.[0]

    const result = {
      text: choice?.message?.content || '',
      finishReason: choice?.finish_reason,
      usage: response.usage,
    }

    if (choice?.content_filter_results) {
      result.contentFilterResults = choice.content_filter_results
    }

    return result
  }

  /**
   * @operationName Chat Completion (Advanced)
   * @category Chat
   * @description Full-control chat completion against a model deployment: multi-turn messages, tool/function calling, structured outputs via response_format (including json_schema), sampling controls, reasoning effort for reasoning deployments (o-series / gpt-5), and Azure "On Your Data" grounding via data_sources. Returns the raw API response, in which each choice carries Azure content_filter_results and the response includes prompt_filter_results describing content-safety evaluation of the input.
   * @route POST /chat-completion
   *
   * @executionTimeoutInSeconds 180
   *
   * @paramDef {"type":"String","label":"Deployment","name":"deployment","required":true,"description":"The deployment name you created in Azure AI Foundry / Azure OpenAI Studio (not the model name)."}
   * @paramDef {"type":"Array<Object>","label":"Messages","name":"messages","required":true,"description":"Conversation history as chat message objects, e.g. [{\"role\":\"system\",\"content\":\"You are helpful.\"},{\"role\":\"user\",\"content\":\"Hi\"}]. Supported roles: system, user, assistant, tool."}
   * @paramDef {"type":"Array<Object>","label":"Tools","name":"tools","description":"Tool definitions the model may call, e.g. [{\"type\":\"function\",\"function\":{\"name\":\"get_weather\",\"parameters\":{...}}}]. Passed through to the API unchanged."}
   * @paramDef {"type":"String","label":"Tool Choice","name":"toolChoice","description":"Controls tool usage: 'none', 'auto', 'required', or a JSON string selecting a specific function, e.g. {\"type\":\"function\",\"function\":{\"name\":\"get_weather\"}}."}
   * @paramDef {"type":"Object","label":"Response Format","name":"responseFormat","description":"Output format object, e.g. {\"type\":\"json_object\"} or a structured-outputs schema {\"type\":\"json_schema\",\"json_schema\":{\"name\":\"result\",\"strict\":true,\"schema\":{...}}}. Passed through unchanged."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature between 0 and 2. Not supported by reasoning deployments."}
   * @paramDef {"type":"Number","label":"Top P","name":"topP","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Nucleus sampling threshold between 0 and 1. Alter this or Temperature, not both."}
   * @paramDef {"type":"Number","label":"Max Completion Tokens","name":"maxCompletionTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Upper bound on generated tokens, including reasoning tokens on reasoning deployments."}
   * @paramDef {"type":"Array<String>","label":"Stop Sequences","name":"stop","description":"Up to 4 sequences at which generation stops. Not supported by reasoning deployments."}
   * @paramDef {"type":"Number","label":"Seed","name":"seed","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Best-effort deterministic sampling: repeated requests with the same seed and parameters should return similar results."}
   * @paramDef {"type":"String","label":"Reasoning Effort","name":"reasoningEffort","uiComponent":{"type":"DROPDOWN","options":{"values":["Minimal","Low","Medium","High"]}},"description":"How much internal reasoning the model performs before answering. Only send for reasoning deployments (o-series / gpt-5); other models reject it. Leave empty to omit."}
   * @paramDef {"type":"Array<Object>","label":"Data Sources","name":"dataSources","description":"Azure OpenAI 'On Your Data' grounding sources, e.g. [{\"type\":\"azure_search\",\"parameters\":{\"endpoint\":\"https://...search.windows.net\",\"index_name\":\"my-index\",\"authentication\":{...}}}]. Passed through unchanged as data_sources."}
   *
   * @returns {Object}
   * @sampleResult {"id":"chatcmpl-9x1","object":"chat.completion","created":1720000000,"model":"gpt-4o-2024-08-06","choices":[{"index":0,"message":{"role":"assistant","content":"Hello! How can I help?"},"finish_reason":"stop","content_filter_results":{"hate":{"filtered":false,"severity":"safe"}}}],"usage":{"prompt_tokens":12,"completion_tokens":9,"total_tokens":21},"prompt_filter_results":[{"prompt_index":0,"content_filter_results":{"hate":{"filtered":false,"severity":"safe"}}}]}
   */
  async chatCompletionAdvanced(deployment, messages, tools, toolChoice, responseFormat, temperature, topP,
    maxCompletionTokens, stop, seed, reasoningEffort, dataSources) {
    if (!deployment || !deployment.trim()) {
      throw new Error('Deployment name is required')
    }

    if (!Array.isArray(messages) || !messages.length) {
      throw new Error('Messages array is required and must not be empty')
    }

    const body = { messages }

    if (Array.isArray(tools) && tools.length) {
      body.tools = tools
    }

    if (toolChoice) {
      body.tool_choice = /^\s*\{/.test(toolChoice) ? JSON.parse(toolChoice) : toolChoice
    }

    if (responseFormat && Object.keys(responseFormat).length) {
      body.response_format = responseFormat
    }

    if (temperature !== undefined && temperature !== null) {
      body.temperature = temperature
    }

    if (topP !== undefined && topP !== null) {
      body.top_p = topP
    }

    if (maxCompletionTokens !== undefined && maxCompletionTokens !== null) {
      body.max_completion_tokens = maxCompletionTokens
    }

    if (Array.isArray(stop) && stop.length) {
      body.stop = stop
    }

    if (seed !== undefined && seed !== null) {
      body.seed = seed
    }

    const resolvedReasoningEffort = this.#resolveChoice(reasoningEffort, {
      'Minimal': 'minimal',
      'Low': 'low',
      'Medium': 'medium',
      'High': 'high',
    })

    if (resolvedReasoningEffort) {
      body.reasoning_effort = resolvedReasoningEffort
    }

    if (Array.isArray(dataSources) && dataSources.length) {
      body.data_sources = dataSources
    }

    return this.#apiRequest({
      path: 'chat/completions',
      deployment,
      body,
      logTag: 'chatCompletionAdvanced',
    })
  }

  /**
   * @operationName Analyze Image
   * @category Chat
   * @description Analyzes one or more images with a vision-capable chat deployment (e.g. gpt-4o) by sending the prompt together with image_url content parts. Images must be publicly reachable URLs or data URLs (data:image/...;base64,...). Returns the model's textual analysis and token usage.
   * @route POST /analyze-image
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Deployment","name":"deployment","required":true,"description":"The deployment name of a vision-capable chat model (not the model name), e.g. a gpt-4o deployment."}
   * @paramDef {"type":"Array<String>","label":"Image URLs","name":"imageUrls","required":true,"description":"One or more image URLs to analyze. Each must be a publicly accessible http(s) URL or a base64 data URL."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"What to do with the image(s), e.g. 'Describe this image' or 'Extract all visible text'."}
   * @paramDef {"type":"Number","label":"Max Tokens","name":"maxTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Upper bound on generated tokens (sent as max_completion_tokens). Leave empty to use the model default."}
   *
   * @returns {Object}
   * @sampleResult {"text":"The image shows a red bicycle leaning against a brick wall next to a blue door.","finishReason":"stop","usage":{"prompt_tokens":1105,"completion_tokens":21,"total_tokens":1126}}
   */
  async analyzeImage(deployment, imageUrls, prompt, maxTokens) {
    if (!deployment || !deployment.trim()) {
      throw new Error('Deployment name is required')
    }

    if (!Array.isArray(imageUrls) || !imageUrls.length) {
      throw new Error('At least one image URL is required')
    }

    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    const content = [
      { type: 'text', text: prompt },
      ...imageUrls.map(url => ({ type: 'image_url', image_url: { url } })),
    ]

    const body = { messages: [{ role: 'user', content }] }

    if (maxTokens !== undefined && maxTokens !== null) {
      body.max_completion_tokens = maxTokens
    }

    const response = await this.#apiRequest({
      path: 'chat/completions',
      deployment,
      body,
      logTag: 'analyzeImage',
    })

    const choice = response.choices?.[0]

    return {
      text: choice?.message?.content || '',
      finishReason: choice?.finish_reason,
      usage: response.usage,
    }
  }

  /**
   * @operationName Create Embeddings
   * @category Embeddings
   * @description Generates vector embeddings for one or more texts using an embeddings deployment (e.g. text-embedding-3-small / text-embedding-3-large). Optionally reduces the vector dimensionality (text-embedding-3 models only). Returns the raw API response with one embedding per input, in input order.
   * @route POST /create-embeddings
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Deployment","name":"deployment","required":true,"description":"The deployment name of an embeddings model (not the model name), e.g. a text-embedding-3-small deployment."}
   * @paramDef {"type":"Array<String>","label":"Input Texts","name":"input","required":true,"description":"One or more texts to embed. A single string is also accepted."}
   * @paramDef {"type":"Number","label":"Dimensions","name":"dimensions","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional number of dimensions for the output vectors. Supported by text-embedding-3 models only; leave empty to use the model's native size."}
   *
   * @returns {Object}
   * @sampleResult {"object":"list","data":[{"object":"embedding","index":0,"embedding":[0.0023,-0.0091,0.0154]}],"model":"text-embedding-3-small","usage":{"prompt_tokens":8,"total_tokens":8}}
   */
  async createEmbeddings(deployment, input, dimensions) {
    if (!deployment || !deployment.trim()) {
      throw new Error('Deployment name is required')
    }

    const resolvedInput = typeof input === 'string' ? [input] : input

    if (!Array.isArray(resolvedInput) || !resolvedInput.length) {
      throw new Error('At least one input text is required')
    }

    const body = { input: resolvedInput }

    if (dimensions !== undefined && dimensions !== null) {
      body.dimensions = dimensions
    }

    return this.#apiRequest({
      path: 'embeddings',
      deployment,
      body,
      logTag: 'createEmbeddings',
    })
  }

  /**
   * @operationName Generate Image
   * @category Images
   * @description Generates images from a text prompt using an image deployment (dall-e-3 or gpt-image-1). Handles both API response shapes: when Azure returns a hosted URL (dall-e-3) it is passed through; when it returns base64 data (gpt-image-1) the image is uploaded to FlowRunner file storage and a hosted URL is returned. Selecting 'Auto' for Size or Quality omits the parameter so each model applies its own default. Note: 'HD'/'Standard' quality and the Style parameter apply to dall-e-3 only; 'Low'/'Medium'/'High' quality applies to gpt-image-1 only.
   * @route POST /generate-image
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Deployment","name":"deployment","required":true,"description":"The deployment name of an image model (not the model name), e.g. a dall-e-3 or gpt-image-1 deployment."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text description of the image to generate. Maximum length is 4000 characters for dall-e-3 and 32000 for gpt-image-1."}
   * @paramDef {"type":"String","label":"Size","name":"size","uiComponent":{"type":"DROPDOWN","options":{"values":["Auto","1024x1024","1792x1024","1024x1792","1536x1024","1024x1536"]}},"defaultValue":"Auto","description":"Image dimensions. 1792x1024/1024x1792 are dall-e-3 sizes; 1536x1024/1024x1536 are gpt-image-1 sizes; 1024x1024 works for both. 'Auto' omits the parameter and uses the model default."}
   * @paramDef {"type":"String","label":"Quality","name":"quality","uiComponent":{"type":"DROPDOWN","options":{"values":["Auto","Standard","HD","Low","Medium","High"]}},"defaultValue":"Auto","description":"Rendering quality. 'Standard'/'HD' apply to dall-e-3; 'Low'/'Medium'/'High' apply to gpt-image-1. 'Auto' omits the parameter and uses the model default."}
   * @paramDef {"type":"String","label":"Style","name":"style","uiComponent":{"type":"DROPDOWN","options":{"values":["Vivid","Natural"]}},"description":"dall-e-3 only. 'Vivid' produces hyper-real, dramatic images; 'Natural' produces more natural-looking images. Leave empty to omit."}
   * @paramDef {"type":"Number","label":"Number of Images","name":"n","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":1,"description":"How many images to generate. dall-e-3 supports only 1; gpt-image-1 supports 1-10. Defaults to 1."}
   *
   * @returns {Object}
   * @sampleResult {"images":[{"url":"https://example.com/files/automation/tmp/azure_image_1720000000000_0.png","revisedPrompt":"A watercolor painting of a lighthouse on a rocky coast at sunset"}],"created":1720000000}
   */
  async generateImage(deployment, prompt, size, quality, style, n) {
    if (!deployment || !deployment.trim()) {
      throw new Error('Deployment name is required')
    }

    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    const body = { prompt, n: n || 1 }

    const resolvedSize = this.#resolveChoice(size, { 'Auto': 'auto' })
    const resolvedQuality = this.#resolveChoice(quality, {
      'Auto': 'auto',
      'Standard': 'standard',
      'HD': 'hd',
      'Low': 'low',
      'Medium': 'medium',
      'High': 'high',
    })
    const resolvedStyle = this.#resolveChoice(style, { 'Vivid': 'vivid', 'Natural': 'natural' })

    // 'auto' is only valid for gpt-image-1 and equals its default, while dall-e-3 rejects it —
    // omitting the parameter lets each model apply its own default.
    if (resolvedSize && resolvedSize !== 'auto') {
      body.size = resolvedSize
    }

    if (resolvedQuality && resolvedQuality !== 'auto') {
      body.quality = resolvedQuality
    }

    if (resolvedStyle) {
      body.style = resolvedStyle
    }

    const response = await this.#apiRequest({
      path: 'images/generations',
      deployment,
      body,
      logTag: 'generateImage',
    })

    const images = []

    for (let i = 0; i < (response.data || []).length; i++) {
      const item = response.data[i]
      const image = {}

      if (item.revised_prompt) {
        image.revisedPrompt = item.revised_prompt
      }

      if (item.url) {
        image.url = item.url
      } else if (item.b64_json) {
        const buffer = Buffer.from(item.b64_json, 'base64')

        const { url } = await this.flowrunner.Files.uploadFile(buffer, {
          filename: `azure_image_${ Date.now() }_${ i }.png`,
          generateUrl: true,
          overwrite: true,
          scope: 'FLOW',
        })

        image.url = url
      }

      images.push(image)
    }

    const result = { images, created: response.created }

    if (response.usage) {
      result.usage = response.usage
    }

    return result
  }

  /**
   * @operationName Transcribe Audio
   * @category Audio
   * @description Transcribes an audio file into text in its original language using a speech-to-text deployment (whisper or gpt-4o-transcribe). Downloads the audio from the provided URL (a FlowRunner file URL or any public URL), then sends it as multipart form data. Supported formats include mp3, mp4, mpeg, mpga, m4a, wav, and webm; whisper files are limited to 25 MB.
   * @route POST /transcribe-audio
   *
   * @executionTimeoutInSeconds 180
   *
   * @paramDef {"type":"String","label":"Deployment","name":"deployment","required":true,"description":"The deployment name of a speech-to-text model (not the model name), e.g. a whisper or gpt-4o-transcribe deployment."}
   * @paramDef {"type":"String","label":"Audio File URL","name":"fileUrl","required":true,"description":"URL of the audio file to transcribe — a FlowRunner file URL or any publicly accessible http(s) URL."}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"Optional ISO-639-1 code of the spoken language (e.g. 'en', 'de'). Improves accuracy and latency when known in advance."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional text to guide the model's style or supply expected vocabulary, names, and acronyms."}
   * @paramDef {"type":"String","label":"Response Format","name":"responseFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["JSON","Text","SRT","Verbose JSON","VTT"]}},"defaultValue":"JSON","description":"Output format. 'SRT', 'Verbose JSON', and 'VTT' are supported by whisper deployments only. Defaults to 'JSON'."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature between 0 and 1. Leave empty for deterministic default behavior."}
   *
   * @returns {Object}
   * @sampleResult {"text":"Welcome everyone to the quarterly business review. Today we'll discuss our growth strategy."}
   */
  async transcribeAudio(deployment, fileUrl, language, prompt, responseFormat, temperature) {
    return this.#transcribeOrTranslate({
      path: 'audio/transcriptions',
      deployment,
      fileUrl,
      language,
      prompt,
      responseFormat,
      temperature,
      logTag: 'transcribeAudio',
    })
  }

  /**
   * @operationName Translate Audio
   * @category Audio
   * @description Translates speech from an audio file in any supported language into English text using a whisper deployment. Downloads the audio from the provided URL (a FlowRunner file URL or any public URL), then sends it as multipart form data. Supported formats include mp3, mp4, mpeg, mpga, m4a, wav, and webm; files are limited to 25 MB.
   * @route POST /translate-audio
   *
   * @executionTimeoutInSeconds 180
   *
   * @paramDef {"type":"String","label":"Deployment","name":"deployment","required":true,"description":"The deployment name of a whisper model (not the model name)."}
   * @paramDef {"type":"String","label":"Audio File URL","name":"fileUrl","required":true,"description":"URL of the audio file to translate into English — a FlowRunner file URL or any publicly accessible http(s) URL."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional English text to guide the model's style or supply expected vocabulary, names, and acronyms."}
   * @paramDef {"type":"String","label":"Response Format","name":"responseFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["JSON","Text","SRT","Verbose JSON","VTT"]}},"defaultValue":"JSON","description":"Output format. Defaults to 'JSON'."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature between 0 and 1. Leave empty for deterministic default behavior."}
   *
   * @returns {Object}
   * @sampleResult {"text":"Hello, thank you for joining today's meeting. Let's start with the agenda."}
   */
  async translateAudio(deployment, fileUrl, prompt, responseFormat, temperature) {
    return this.#transcribeOrTranslate({
      path: 'audio/translations',
      deployment,
      fileUrl,
      prompt,
      responseFormat,
      temperature,
      logTag: 'translateAudio',
    })
  }

  /**
   * @operationName Text To Speech
   * @category Audio
   * @description Converts text into natural-sounding speech using a text-to-speech deployment (tts, tts-hd, or gpt-4o-mini-tts). Uploads the generated audio to FlowRunner file storage and returns its URL. The maximum input length is 4096 characters.
   * @route POST /text-to-speech
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Deployment","name":"deployment","required":true,"description":"The deployment name of a text-to-speech model (not the model name), e.g. a tts, tts-hd, or gpt-4o-mini-tts deployment."}
   * @paramDef {"type":"String","label":"Input Text","name":"input","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text to convert to speech. Maximum length is 4096 characters."}
   * @paramDef {"type":"String","label":"Voice","name":"voice","uiComponent":{"type":"DROPDOWN","options":{"values":["Alloy","Ash","Coral","Echo","Fable","Nova","Onyx","Sage","Shimmer"]}},"defaultValue":"Alloy","description":"The voice for the generated audio. Defaults to 'Alloy'."}
   * @paramDef {"type":"Number","label":"Speed","name":"speed","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":1,"description":"Playback speed between 0.25 and 4.0. Defaults to 1.0."}
   * @paramDef {"type":"String","label":"Response Format","name":"responseFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["MP3","Opus","AAC","FLAC","WAV"]}},"defaultValue":"MP3","description":"The audio file format of the output. Defaults to 'MP3'."}
   *
   * @returns {Object}
   * @sampleResult {"fileURL":"https://example.com/files/automation/tmp/tts_1720000000000.mp3"}
   */
  async textToSpeech(deployment, input, voice, speed, responseFormat) {
    if (!deployment || !deployment.trim()) {
      throw new Error('Deployment name is required')
    }

    if (!input || !input.trim()) {
      throw new Error('Input text is required')
    }

    if (input.length > 4096) {
      throw new Error('The maximum allowed text length is 4096 characters')
    }

    const resolvedVoice = this.#resolveChoice(voice, {
      'Alloy': 'alloy',
      'Ash': 'ash',
      'Coral': 'coral',
      'Echo': 'echo',
      'Fable': 'fable',
      'Nova': 'nova',
      'Onyx': 'onyx',
      'Sage': 'sage',
      'Shimmer': 'shimmer',
    }) || 'alloy'

    const resolvedFormat = this.#resolveChoice(responseFormat, {
      'MP3': 'mp3',
      'Opus': 'opus',
      'AAC': 'aac',
      'FLAC': 'flac',
      'WAV': 'wav',
    }) || 'mp3'

    const audioBytes = await this.#apiRequest({
      path: 'audio/speech',
      deployment,
      binary: true,
      body: {
        input,
        voice: resolvedVoice,
        response_format: resolvedFormat,
        speed: speed || DEFAULT_TTS_SPEED,
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
}

Flowrunner.ServerCode.addService(AzureOpenAIService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'One of the two keys of your resource: Azure portal → your Azure OpenAI resource → Keys and Endpoint.',
  },
  {
    name: 'endpoint',
    displayName: 'Endpoint',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your resource endpoint, e.g. https://my-resource.openai.azure.com — no trailing slash.',
  },
  {
    name: 'apiVersion',
    displayName: 'API Version',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    defaultValue: 'v1',
    hint: "'v1' uses the modern OpenAI-compatible surface at /openai/v1. Set a dated version like 2024-10-21 only if your resource requires the legacy per-call api-version paths.",
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
