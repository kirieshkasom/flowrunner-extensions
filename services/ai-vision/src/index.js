const VisionProviders = {
  OPEN_AI: {
    name: 'OpenAI',
    format: 'openai',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    configKey: 'openAIAPIKey',
    structuredOutput: true,
    tokenParam(model) {
      // GPT-5 and the o-series reject max_tokens; they require max_completion_tokens.
      return /^(gpt-5|gpt-6|o[1-9])/i.test(model)
        ? 'max_completion_tokens'
        : 'max_tokens'
    },
    isConfigured(config) {
      return !!config[this.configKey]
    },
    getHeaders(config) {
      return {
        Authorization: `Bearer ${ config[this.configKey] }`,
        'Content-Type': 'application/json',
      }
    },
    models: [
      {
        id: 'gpt-5.6-sol',
        description:
          'Frontier GPT-5.6 model for the most complex multimodal reasoning',
      },
      {
        id: 'gpt-5.6-terra',
        description: 'GPT-5.6 model balancing intelligence and cost',
      },
      {
        id: 'gpt-5.6-luna',
        description:
          'GPT-5.6 model optimized for cost-sensitive, high-volume image workloads',
      },
      {
        id: 'gpt-5.5',
        description:
          'Strong general-purpose GPT-5.5 vision model for professional tasks',
      },
      {
        id: 'gpt-4.1',
        description:
          'Stable GPT-4.1 vision model, kept as a non-reasoning legacy option',
      },
    ],
  },

  MISTRAL: {
    name: 'Mistral',
    format: 'openai',
    baseUrl: 'https://api.mistral.ai/v1/chat/completions',
    configKey: 'mistralAPIKey',
    structuredOutput: true,
    isConfigured(config) {
      return !!config[this.configKey]
    },
    getHeaders(config) {
      return {
        Authorization: `Bearer ${ config[this.configKey] }`,
        'Content-Type': 'application/json',
      }
    },
    models: [
      {
        id: 'mistral-large-latest',
        description:
          'Mistral Large 3, the most capable Mistral multimodal model for complex vision analysis',
      },
      {
        id: 'mistral-medium-latest',
        description:
          'Mistral Medium 3.5 multimodal model, the successor to Pixtral Large',
      },
      {
        id: 'mistral-small-latest',
        description:
          'Mistral Small 3.2, a compact vision model for fast, cost-effective tasks',
      },
    ],
  },

  TOGETHER_AI: {
    name: 'Together AI',
    format: 'openai',
    baseUrl: 'https://api.together.xyz/v1/chat/completions',
    configKey: 'togetherAIAPIKey',
    structuredOutput: false,
    isConfigured(config) {
      return !!config[this.configKey]
    },
    getHeaders(config) {
      return {
        Authorization: `Bearer ${ config[this.configKey] }`,
        'Content-Type': 'application/json',
      }
    },
    models: [
      {
        id: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
        description:
          'Llama 4 Maverick, a natively multimodal 128-expert MoE and the most capable serverless vision model',
      },
      {
        id: 'meta-llama/Llama-4-Scout-17B-16E-Instruct',
        description: 'Llama 4 Scout, a long-context multimodal MoE model',
      },
      {
        id: 'Qwen/Qwen2.5-VL-72B-Instruct',
        description:
          'Qwen2.5-VL 72B vision-language model, strong on documents, charts, and OCR',
      },
    ],
  },

  FIREWORKS_AI: {
    name: 'Fireworks AI',
    format: 'openai',
    baseUrl: 'https://api.fireworks.ai/inference/v1/chat/completions',
    configKey: 'fireworksAIAPIKey',
    structuredOutput: false,
    isConfigured(config) {
      return !!config[this.configKey]
    },
    getHeaders(config) {
      return {
        Authorization: `Bearer ${ config[this.configKey] }`,
        'Content-Type': 'application/json',
      }
    },
    models: [
      {
        id: 'accounts/fireworks/models/qwen3-vl-235b-a22b-instruct',
        description:
          'Qwen3-VL 235B (22B active) flagship vision-language model for complex visual reasoning',
      },
      {
        id: 'accounts/fireworks/models/llama4-maverick-instruct-basic',
        description:
          'Llama 4 Maverick multimodal MoE with strong image comprehension',
      },
      {
        id: 'accounts/fireworks/models/qwen3-vl-8b-instruct',
        description:
          'Compact, fast Qwen3-VL 8B vision-language model for cost-efficient image tasks',
      },
    ],
  },

  XAI: {
    name: 'xAI',
    format: 'openai',
    baseUrl: 'https://api.x.ai/v1/chat/completions',
    configKey: 'xaiAPIKey',
    structuredOutput: false,
    isConfigured(config) {
      return !!config[this.configKey]
    },
    getHeaders(config) {
      return {
        Authorization: `Bearer ${ config[this.configKey] }`,
        'Content-Type': 'application/json',
      }
    },
    models: [
      {
        id: 'grok-4.5',
        description:
          'Flagship Grok model, natively multimodal for advanced image understanding',
      },
      {
        id: 'grok-4.3',
        description: 'General-purpose Grok 4 model with text and image input',
      },
    ],
  },

  COHERE: {
    name: 'Cohere',
    format: 'openai',
    baseUrl: 'https://api.cohere.com/compatibility/v1/chat/completions',
    configKey: 'cohereAPIKey',
    structuredOutput: false,
    fetchImagesToBase64: true,
    isConfigured(config) {
      return !!config[this.configKey]
    },
    getHeaders(config) {
      return {
        Authorization: `Bearer ${ config[this.configKey] }`,
        'Content-Type': 'application/json',
      }
    },
    models: [
      {
        id: 'command-a-plus-05-2026',
        description:
          'Newest Command A+ model unifying vision, reasoning, and agentic tool-use',
      },
      {
        id: 'command-a-vision-07-2025',
        description: 'Dedicated Command A vision model for enterprise image analysis',
      },
    ],
  },

  HUGGING_FACE: {
    name: 'Hugging Face',
    format: 'openai',
    baseUrl: 'https://router.huggingface.co/v1/chat/completions',
    configKey: 'huggingFaceToken',
    structuredOutput: false,
    fetchImagesToBase64: true,
    isConfigured(config) {
      return !!config[this.configKey]
    },
    getHeaders(config) {
      return {
        Authorization: `Bearer ${ config[this.configKey] }`,
        'Content-Type': 'application/json',
      }
    },
    models: [
      {
        id: 'Qwen/Qwen3-VL-8B-Instruct',
        description:
          'Qwen3-VL 8B, the newest Qwen vision-language model routable via HF Inference Providers',
      },
      {
        id: 'meta-llama/Llama-4-Scout-17B-16E-Instruct',
        description:
          'Meta Llama 4 Scout multimodal MoE served through HF router providers',
      },
      {
        id: 'Qwen/Qwen2.5-VL-7B-Instruct',
        description:
          'Qwen 2.5 7B vision-language model with broad provider coverage',
      },
    ],
  },

  MOONSHOT_AI: {
    name: 'Moonshot AI',
    format: 'openai',
    baseUrl: 'https://api.moonshot.ai/v1/chat/completions',
    configKey: 'moonshotAIAPIKey',
    structuredOutput: false,
    isConfigured(config) {
      return !!config[this.configKey]
    },
    getHeaders(config) {
      return {
        Authorization: `Bearer ${ config[this.configKey] }`,
        'Content-Type': 'application/json',
      }
    },
    models: [
      {
        id: 'kimi-latest',
        description:
          'Auto-updating alias for the latest vision-capable Kimi model',
      },
      {
        id: 'kimi-k2.5',
        description:
          'Kimi K2.5, a native multimodal MoE model with the MoonViT vision encoder',
      },
      {
        id: 'moonshot-v1-128k-vision-preview',
        description: 'Moonshot vision model with a 128K context window',
      },
    ],
  },

  ANTHROPIC: {
    name: 'Anthropic',
    format: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    configKey: 'anthropicAPIKey',
    structuredOutput: true,
    isConfigured(config) {
      return !!config[this.configKey]
    },
    getHeaders(config) {
      return {
        'x-api-key': config[this.configKey],
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      }
    },
    models: [
      {
        id: 'claude-opus-4-8',
        description:
          'Claude Opus 4.8, the most capable model for complex visual reasoning',
      },
      {
        id: 'claude-sonnet-5',
        description:
          'Claude Sonnet 5 with a strong balance of vision quality and speed',
      },
      {
        id: 'claude-sonnet-4-6',
        description:
          'Claude Sonnet 4.6 with excellent vision and reasoning balance',
      },
      {
        id: 'claude-haiku-4-5',
        description:
          'Claude Haiku 4.5 optimized for fast, cost-effective vision tasks',
      },
    ],
  },

  GOOGLE_GEMINI: {
    name: 'Google Gemini',
    format: 'gemini',
    configKey: 'googleGeminiAPIKey',
    structuredOutput: true,
    isConfigured(config) {
      return !!config[this.configKey]
    },
    getUrl(config, model) {
      return `https://generativelanguage.googleapis.com/v1beta/models/${ model }:generateContent`
    },
    getHeaders(config) {
      return {
        'x-goog-api-key': config[this.configKey],
        'Content-Type': 'application/json',
      }
    },
    models: [
      {
        id: 'gemini-3.1-pro-preview',
        description:
          'Flagship Gemini 3 Pro model for the most advanced multimodal reasoning',
      },
      {
        id: 'gemini-3.5-flash',
        description:
          'GA frontier Flash model balancing high intelligence with fast, cost-effective image understanding',
      },
      {
        id: 'gemini-2.5-pro',
        description:
          'Stable high-capability Gemini model for detailed image analysis and long context',
      },
      {
        id: 'gemini-2.5-flash',
        description:
          'Stable, fast, budget-friendly Gemini model for general image tasks',
      },
    ],
  },
}

const VisionProvidersList = Object.entries(VisionProviders).map(
  ([id, provider]) => ({
    ...provider,
    id,
  })
)

// ============================= Request Format Builders =============================

// Image formats accepted by the vision providers, keyed by file extension.
const IMAGE_MIME_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
}

// The tool name used to coax structured JSON out of Anthropic (see below).
const STRUCTURED_TOOL_NAME = 'emit_structured_data'

function mimeTypeFromUrl(url) {
  const match = String(url)
    .split('?')[0]
    .match(/\.([a-z0-9]+)$/i)

  return match ? IMAGE_MIME_TYPES[match[1].toLowerCase()] : undefined
}

function parseDataUri(url) {
  const matches = String(url).match(/^data:([^;]+);base64,(.+)$/)

  return matches ? { mimeType: matches[1], data: matches[2] } : null
}

function buildOpenAIRequestBody(model, prompt, imageUrls, maxTokens, tokenField) {
  const content = [{ type: 'text', text: prompt }]

  for (const url of imageUrls) {
    content.push({ type: 'image_url', image_url: { url } })
  }

  const body = { model, messages: [{ role: 'user', content }] }

  if (maxTokens) {
    body[tokenField || 'max_tokens'] = maxTokens
  }

  return body
}

function buildAnthropicRequestBody(model, prompt, imageUrls, maxTokens) {
  const content = imageUrls.map(anthropicImageBlock)

  content.push({ type: 'text', text: prompt })

  const body = {
    model,
    max_tokens: maxTokens || 4096,
    messages: [{ role: 'user', content }],
  }

  // Claude Sonnet 5 runs adaptive thinking by default, which spends extra tokens and
  // returns thinking blocks that this extension's single-shot vision calls do not need.
  // The disabled setting is accepted for this model only, so it is not sent for the others.
  if (model === 'claude-sonnet-5') {
    body.thinking = { type: 'disabled' }
  }

  return body
}

// Anthropic takes inline images as a base64 source; only real http(s) links use the url source.
function anthropicImageBlock(url) {
  const dataUri = parseDataUri(url)

  if (dataUri) {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: dataUri.mimeType,
        data: dataUri.data,
      },
    }
  }

  return { type: 'image', source: { type: 'url', url } }
}

function buildGeminiRequestBody(prompt, imageUrls) {
  const parts = []

  for (const url of imageUrls) {
    const dataUri = parseDataUri(url)

    if (dataUri) {
      parts.push({
        inline_data: { mime_type: dataUri.mimeType, data: dataUri.data },
      })
    } else {
      parts.push({
        file_data: {
          file_uri: url,
          mime_type: mimeTypeFromUrl(url) || 'image/jpeg',
        },
      })
    }
  }

  parts.push({ text: prompt })

  return { contents: [{ parts }] }
}

// ============================= Structured Output Builders =============================

function addStructuredOutputOpenAI(body, structure) {
  // strict mode is intentionally left off: it rejects an ordinary user schema unless every
  // object sets additionalProperties:false and lists all keys in required, which a caller's
  // free-form schema will not. Without strict the model still targets the schema.
  body.response_format = {
    type: 'json_schema',
    json_schema: {
      name: 'response',
      schema: structure,
    },
  }

  return body
}

function addStructuredOutputAnthropic(body, structure) {
  // Anthropic has no JSON-schema response format, so a single forced tool call whose
  // input_schema is the caller's structure makes the model emit conforming JSON.
  body.tools = [
    {
      name: STRUCTURED_TOOL_NAME,
      description:
        'Return the image analysis as structured data matching the required schema.',
      input_schema: structure,
    },
  ]

  body.tool_choice = { type: 'tool', name: STRUCTURED_TOOL_NAME }

  return body
}

function addStructuredOutputGemini(body, structure) {
  body.generationConfig = {
    responseMimeType: 'application/json',
    responseSchema: structure,
  }

  return body
}

function addStructuredOutputFallback(prompt, structure) {
  return (
    prompt +
    '\n\nYou must respond with valid JSON matching this schema:\n' +
    JSON.stringify(structure, null, 2) +
    '\n\nRespond ONLY with valid JSON, no other text.'
  )
}

// Parse the model's JSON text, tolerating a ```json ... ``` markdown fence around it.
function parseStructuredJson(text) {
  if (!text || typeof text !== 'string') {
    throw new Error(
      'Failed to parse structured output. The model returned no text to parse.'
    )
  }

  let cleaned = text.trim()
  const fenced = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)

  if (fenced) {
    cleaned = fenced[1].trim()
  }

  try {
    return JSON.parse(cleaned)
  } catch {
    throw new Error(
      'Failed to parse structured output. The model did not return valid JSON.'
    )
  }
}

// ============================= Response Extractors =============================

function extractOpenAIResponseText(response) {
  return response?.choices?.[0]?.message?.content || ''
}

function extractAnthropicResponseText(response) {
  const textBlock = response?.content?.find(b => b.type === 'text')

  return textBlock?.text || ''
}

function extractGeminiResponseText(response) {
  return response?.candidates?.[0]?.content?.parts?.[0]?.text || ''
}

// ============================= Error Handling =============================

// Remediating hints keyed by HTTP status; {provider} is filled in with the provider name.
const ERROR_HINTS = {
  401: 'Authentication failed - check the {provider} API key in the service configuration.',
  403: 'Access denied - check the {provider} API key and its permissions in the service configuration.',
  413: 'The request is too large - reduce the image size or the number of images.',
  429: 'Rate limit reached for {provider} - wait a moment and try again.',
}

// Pull the human-readable message out of whatever shape the provider error arrives in.
function extractProviderMessage(error) {
  const raw = error && error.message

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)

      return parsed?.error?.message || parsed?.message || raw
    } catch {
      return raw
    }
  }

  if (raw && typeof raw === 'object') {
    return raw?.error?.message || raw?.message
  }

  return undefined
}

function normalizeAPIError(error, providerName) {
  const provider = providerName || 'the AI provider'
  const status = error?.status ?? error?.statusCode ?? error?.code
  const apiMessage = extractProviderMessage(error)

  const hintTemplate = ERROR_HINTS[status]

  if (hintTemplate) {
    const hint = hintTemplate.replace('{provider}', provider)

    return new Error(apiMessage ? `${ hint } (${ apiMessage })` : hint)
  }

  // Surface a content-policy refusal in plain terms rather than as a raw provider body.
  if (apiMessage && /content.?policy|safety|refus/i.test(apiMessage)) {
    return new Error(
      `The ${ provider } model refused the request due to its content policy: ${ apiMessage }`
    )
  }

  return apiMessage ? new Error(apiMessage) : error
}

// ============================= Logger =============================

const logger = {
  info: (...args) => console.log('[AI Vision] info:', ...args),
  debug: (...args) => console.log('[AI Vision] debug:', ...args),
  error: (...args) => console.log('[AI Vision] error:', ...args),
  warn: (...args) => console.log('[AI Vision] warn:', ...args),
}

// ============================= Service Class =============================

/**
 * @integrationName AI Vision
 * @integrationIcon /icon.png
 */
class AIVision {
  constructor(config) {
    this.config = config
  }

  // ============================= Private Methods =============================

  async #apiRequest({ url, method, body, headers, logTag, providerName }) {
    method = method || 'post'

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }]`)

      return await Flowrunner.Request[method](url).set(headers).send(body)
    } catch (error) {
      error = normalizeAPIError(error, providerName)

      logger.error(`${ logTag } - error: ${ error.message }`)

      throw error
    }
  }

  // Some compatibility endpoints (Cohere, Hugging Face) reject remote image URLs, so their
  // provider is flagged to fetch the bytes here and inline them as a base64 data URI.
  async #prepareImageUrls(provider, imageUrls) {
    if (!provider.fetchImagesToBase64) {
      return imageUrls
    }

    const prepared = []

    for (const url of imageUrls) {
      if (url.startsWith('data:')) {
        prepared.push(url)
      } else {
        prepared.push(await this.#fetchImageAsDataUri(url))
      }
    }

    return prepared
  }

  async #fetchImageAsDataUri(url) {
    const bytes = await Flowrunner.Request.get(url).setEncoding(null)
    const base64 = Buffer.from(bytes).toString('base64')
    const mimeType = mimeTypeFromUrl(url) || 'image/jpeg'

    return `data:${ mimeType };base64,${ base64 }`
  }

  #getProvider(providerId) {
    if (!providerId) {
      throw new Error(
        'The "provider" parameter is required. Please select an AI vision provider.'
      )
    }

    const provider = VisionProviders[providerId]

    if (!provider) {
      throw new Error(
        `Unknown vision provider: "${ providerId }". Please select a valid provider from the list.`
      )
    }

    if (!provider.isConfigured(this.config)) {
      throw new Error(
        `The "${ provider.name }" provider is not configured. Please add your API key in the service configuration.`
      )
    }

    return provider
  }

  #getProviderUrl(provider, model) {
    if (provider.getUrl) {
      return provider.getUrl(this.config, model)
    }

    return provider.baseUrl
  }

  #buildRequestBody(provider, model, prompt, imageUrls, maxTokens) {
    switch (provider.format) {
      case 'openai': {
        const tokenField = provider.tokenParam
          ? provider.tokenParam(model)
          : 'max_tokens'

        return buildOpenAIRequestBody(
          model,
          prompt,
          imageUrls,
          maxTokens,
          tokenField
        )
      }

      case 'anthropic':
        return buildAnthropicRequestBody(model, prompt, imageUrls, maxTokens)
      case 'gemini':
        return buildGeminiRequestBody(prompt, imageUrls)
      default:
        throw new Error(`Unsupported provider format: "${ provider.format }".`)
    }
  }

  #buildStructuredRequestBody(
    provider,
    model,
    prompt,
    imageUrls,
    structure,
    maxTokens
  ) {
    if (provider.structuredOutput) {
      const body = this.#buildRequestBody(
        provider,
        model,
        prompt,
        imageUrls,
        maxTokens
      )

      switch (provider.format) {
        case 'openai':
          return addStructuredOutputOpenAI(body, structure)
        case 'anthropic':
          return addStructuredOutputAnthropic(body, structure)
        case 'gemini':
          return addStructuredOutputGemini(body, structure)
        default:
          throw new Error(`Unsupported provider format: "${ provider.format }".`)
      }
    }

    const modifiedPrompt = addStructuredOutputFallback(prompt, structure)

    return this.#buildRequestBody(
      provider,
      model,
      modifiedPrompt,
      imageUrls,
      maxTokens
    )
  }

  #extractResponseText(provider, response) {
    switch (provider.format) {
      case 'openai':
        return extractOpenAIResponseText(response)
      case 'anthropic':
        return extractAnthropicResponseText(response)
      case 'gemini':
        return extractGeminiResponseText(response)
      default:
        throw new Error(`Unsupported provider format: "${ provider.format }".`)
    }
  }

  #extractStructuredResult(provider, response) {
    // Anthropic returns the structured data as the input of the forced tool call.
    if (provider.format === 'anthropic' && provider.structuredOutput) {
      const toolBlock = response?.content?.find(b => b.type === 'tool_use')

      if (toolBlock && toolBlock.input) {
        return toolBlock.input
      }
    }

    return parseStructuredJson(this.#extractResponseText(provider, response))
  }

  // ============================= Action Methods =============================

  /**
   * @operationName Analyze Image
   * @description Analyzes one or more images using a selected AI vision provider and model. Supports 10 providers including OpenAI, Anthropic, Google Gemini, Mistral, and others. Send image URLs or base64 data URIs along with a text prompt to receive detailed image analysis.
   * @category Image Analysis
   * @route POST /analyze-image
   * @appearanceColor #6B4EFF #8B6FFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Provider","name":"provider","required":true,"dictionary":"getVisionProvidersDictionary","description":"AI provider to use for image analysis."}
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getVisionProviderModelsDictionary","dependsOn":["provider"],"description":"Vision model to use for analysis."}
   * @paramDef {"type":"Array<String>","label":"Image URLs","name":"imageUrls","required":true,"description":"One or more image URLs to analyze. Supports HTTP/HTTPS URLs and base64 data URIs."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text prompt with instructions for image analysis."}
   * @paramDef {"type":"Number","label":"Max Tokens","name":"maxTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens in the response. Default varies by provider."}
   *
   * @returns {Object}
   * @sampleResult {"text":"The image shows a golden retriever sitting on a green lawn with a white fence and trees in the background.","provider":"OpenAI","model":"gpt-5.6-sol"}
   */
  async analyzeImage(provider, model, imageUrls, prompt, maxTokens) {
    const logTag = '[analyzeImage]'

    imageUrls = normalizeImageUrls(imageUrls)

    if (!imageUrls.length) {
      throw new Error(
        'The "imageUrls" parameter is required. Please provide at least one image URL.'
      )
    }

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      throw new Error(
        'The "prompt" parameter is required and must be a non-empty string.'
      )
    }

    if (!model) {
      throw new Error(
        'The "model" parameter is required. Please select a vision model.'
      )
    }

    const providerDef = this.#getProvider(provider)
    const url = this.#getProviderUrl(providerDef, model)
    const headers = providerDef.getHeaders(this.config)
    const preparedImageUrls = await this.#prepareImageUrls(
      providerDef,
      imageUrls
    )
    const body = this.#buildRequestBody(
      providerDef,
      model,
      prompt.trim(),
      preparedImageUrls,
      maxTokens
    )

    logger.debug(
      `${ logTag } Sending request to ${ providerDef.name } with model ${ model }`
    )

    const response = await this.#apiRequest({
      url,
      method: 'post',
      body,
      headers,
      logTag,
      providerName: providerDef.name,
    })
    const text = this.#extractResponseText(providerDef, response)

    logger.debug(`${ logTag } Analysis completed successfully`)

    return {
      text,
      provider: providerDef.name,
      model,
    }
  }

  /**
   * @operationName Analyze Image with Structured Output
   * @description Analyzes images and returns a structured JSON response matching a provided JSON Schema. Ideal for extracting specific data points, classifications, or structured information from images. OpenAI, Google Gemini, and Mistral constrain the response to the schema natively; Anthropic uses a forced tool call to the schema; the remaining providers are instructed to reply with matching JSON.
   * @category Image Analysis
   * @route POST /analyze-image-structured
   * @appearanceColor #4E3ECC #7B6FFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Provider","name":"provider","required":true,"dictionary":"getVisionProvidersDictionary","description":"AI provider to use for image analysis."}
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"dictionary":"getVisionProviderModelsDictionary","dependsOn":["provider"],"description":"Vision model to use for analysis."}
   * @paramDef {"type":"Array<String>","label":"Image URLs","name":"imageUrls","required":true,"description":"One or more image URLs to analyze. Supports HTTP/HTTPS URLs and base64 data URIs."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text prompt with instructions for image analysis."}
   * @paramDef {"type":"Object","label":"Structure","name":"structure","required":true,"description":"A JSON Schema object describing the fields to extract. Its keys are defined by the caller and are not known ahead of time, so it is passed through as free-form JSON (for example {\"type\":\"object\",\"properties\":{\"label\":{\"type\":\"string\"}}})."}
   * @paramDef {"type":"Number","label":"Max Tokens","name":"maxTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens in the response. Default varies by provider."}
   *
   * @returns {Object}
   * @sampleResult {"result":{"objects":["dog","lawn","fence","trees"],"description":"A golden retriever on a green lawn"},"provider":"OpenAI","model":"gpt-5.6-sol"}
   */
  async analyzeImageWithStructuredOutput(
    provider,
    model,
    imageUrls,
    prompt,
    structure,
    maxTokens
  ) {
    const logTag = '[analyzeImageWithStructuredOutput]'

    imageUrls = normalizeImageUrls(imageUrls)

    if (!imageUrls.length) {
      throw new Error(
        'The "imageUrls" parameter is required. Please provide at least one image URL.'
      )
    }

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      throw new Error(
        'The "prompt" parameter is required and must be a non-empty string.'
      )
    }

    if (!model) {
      throw new Error(
        'The "model" parameter is required. Please select a vision model.'
      )
    }

    if (!structure || typeof structure !== 'object') {
      throw new Error(
        'The "structure" parameter is required and must be a valid JSON Schema object.'
      )
    }

    const providerDef = this.#getProvider(provider)
    const url = this.#getProviderUrl(providerDef, model)
    const headers = providerDef.getHeaders(this.config)
    const preparedImageUrls = await this.#prepareImageUrls(
      providerDef,
      imageUrls
    )
    const body = this.#buildStructuredRequestBody(
      providerDef,
      model,
      prompt.trim(),
      preparedImageUrls,
      structure,
      maxTokens
    )

    logger.debug(
      `${ logTag } Sending structured request to ${ providerDef.name } with model ${ model }`
    )

    const response = await this.#apiRequest({
      url,
      method: 'post',
      body,
      headers,
      logTag,
      providerName: providerDef.name,
    })

    logger.debug(`${ logTag } Structured analysis completed successfully`)

    const result = this.#extractStructuredResult(providerDef, response)

    return {
      result,
      provider: providerDef.name,
      model,
    }
  }

  // ============================= Dictionary Methods =============================

  /**
   * @typedef {Object} getVisionProvidersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter vision providers by name."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Vision Providers
   * @description Provides a searchable list of configured AI vision providers for dynamic parameter selection.
   * @route POST /get-vision-providers-dictionary
   *
   * @paramDef {"type":"getVisionProvidersDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering vision providers."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"OpenAI","value":"OPEN_AI","note":"\u2705 Configured"},{"label":"Anthropic","value":"ANTHROPIC","note":"\u274c Not Configured \u2014 API Key is missing"}]}
   */
  async getVisionProvidersDictionary(payload) {
    const { search } = payload || {}

    let providers = VisionProvidersList

    if (search) {
      const searchLower = search.toLowerCase()

      providers = providers.filter(p =>
        p.name.toLowerCase().includes(searchLower)
      )
    }

    const items = providers.map(provider => ({
      label: provider.name,
      value: provider.id,
      note: provider.isConfigured(this.config)
        ? '\u2705 Configured'
        : '\u274c Not Configured \u2014 API Key is missing',
    }))

    return { items }
  }

  /**
   * @typedef {Object} getVisionProviderModelsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Provider","name":"provider","required":true,"description":"The vision provider ID to retrieve available models for."}
   */

  /**
   * @typedef {Object} getVisionProviderModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by name."}
   * @paramDef {"type":"getVisionProviderModelsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters to identify the vision provider."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Vision Provider Models
   * @description Provides a searchable list of available vision models for the selected AI provider.
   * @route POST /get-vision-provider-models-dictionary
   *
   * @paramDef {"type":"getVisionProviderModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains search, cursor, and criteria for filtering vision models by provider."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"gpt-5.6-sol","value":"gpt-5.6-sol","note":"Frontier GPT-5.6 model for the most complex multimodal reasoning"}]}
   */
  async getVisionProviderModelsDictionary(payload) {
    const { search, criteria } = payload || {}
    const providerId = criteria?.provider

    if (!providerId || !VisionProviders[providerId]) {
      return { items: [] }
    }

    let models = VisionProviders[providerId].models

    if (search) {
      const searchLower = search.toLowerCase()

      models = models.filter(
        m =>
          m.id.toLowerCase().includes(searchLower) ||
          m.description.toLowerCase().includes(searchLower)
      )
    }

    const items = models.map(model => ({
      label: model.id,
      value: model.id,
      note: model.description,
    }))

    return { items }
  }
}

// ============================= Utility Functions =============================

function normalizeImageUrls(imageUrls) {
  if (!imageUrls) {
    return []
  }

  if (typeof imageUrls === 'string') {
    return [imageUrls]
  }

  if (Array.isArray(imageUrls)) {
    return imageUrls.filter(url => url && typeof url === 'string')
  }

  return []
}

// ============================= Service Registration =============================

Flowrunner.ServerCode.addService(AIVision, [
  {
    displayName: 'OpenAI API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    name: 'openAIAPIKey',
    hint: 'Your OpenAI API key for GPT-5 vision models.',
  },
  {
    displayName: 'Anthropic API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    name: 'anthropicAPIKey',
    hint: 'Your Anthropic API key for Claude vision models.',
  },
  {
    displayName: 'Google Gemini API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    name: 'googleGeminiAPIKey',
    hint: 'Your Google Gemini API key from AI Studio.',
  },
  {
    displayName: 'Mistral AI API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    name: 'mistralAPIKey',
    hint: 'Your Mistral API key for Mistral vision models.',
  },
  {
    displayName: 'Cohere API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    name: 'cohereAPIKey',
    hint: 'Your Cohere API key for Command vision models.',
  },
  {
    displayName: 'Together AI API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    name: 'togetherAIAPIKey',
    hint: 'Your Together AI API key for Llama vision models.',
  },
  {
    displayName: 'Fireworks AI API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    name: 'fireworksAIAPIKey',
    hint: 'Your Fireworks AI API key for vision models.',
  },
  {
    displayName: 'xAI API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    name: 'xaiAPIKey',
    hint: 'Your xAI API key for Grok vision models.',
  },
  {
    displayName: 'Hugging Face Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    name: 'huggingFaceToken',
    hint: 'Your Hugging Face access token for vision models.',
  },
  {
    displayName: 'Moonshot AI API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    name: 'moonshotAIAPIKey',
    hint: 'Your Moonshot AI API key from platform.moonshot.ai (the international endpoint). Keys from the China platform (platform.moonshot.cn) are a separate system and will not work here.',
  },
])
