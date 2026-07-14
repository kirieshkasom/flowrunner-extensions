'use strict'

const API_BASE_URL = 'https://api.deepseek.com'
const BETA_API_BASE_URL = 'https://api.deepseek.com/beta'

const DEFAULT_CHAT_MODEL = 'deepseek-v4-flash'
const DEFAULT_FIM_MODEL = 'deepseek-v4-pro'

const THINKING_MODE_MAPPING = { 'Enabled': 'enabled', 'Disabled': 'disabled' }
const REASONING_EFFORT_MAPPING = { 'High': 'high', 'Max': 'max' }

const logger = {
  info: (...args) => console.log('[DeepSeek] info:', ...args),
  debug: (...args) => console.log('[DeepSeek] debug:', ...args),
  error: (...args) => console.log('[DeepSeek] error:', ...args),
  warn: (...args) => console.log('[DeepSeek] warn:', ...args),
}

/**
 * @integrationName DeepSeek
 * @integrationIcon /icon.png
 */
class DeepSeekService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  async #apiRequest({ url, method = 'post', body, query, logTag }) {
    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }]`)

      const request = Flowrunner.Request[method](url)
        .query(query || {})
        .set({ 'Authorization': `Bearer ${ this.apiKey }` })

      if (body !== undefined) {
        request.set({ 'Content-Type': 'application/json' }).send(body)
      }

      return await request
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

  #applyChatOptions(body, { thinkingMode, reasoningEffort, temperature, topP, maxTokens, stop }) {
    const resolvedThinking = this.#resolveChoice(thinkingMode, THINKING_MODE_MAPPING)
    const resolvedEffort = this.#resolveChoice(reasoningEffort, REASONING_EFFORT_MAPPING)

    if (resolvedThinking === 'enabled' || resolvedThinking === 'disabled') {
      body.thinking = { type: resolvedThinking }
    }

    if (resolvedEffort) body.reasoning_effort = resolvedEffort
    if (temperature !== undefined && temperature !== null) body.temperature = temperature
    if (topP !== undefined && topP !== null) body.top_p = topP
    if (maxTokens) body.max_tokens = maxTokens
    if (stop?.length) body.stop = stop

    return body
  }

  /**
   * @typedef {Object} getModelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter models by ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused — DeepSeek's model list is not paginated."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Models Dictionary
   * @description Provides a searchable, live list of models available through the DeepSeek API (e.g. deepseek-v4-flash and deepseek-v4-pro) for dynamic parameter selection.
   * @route POST /get-models-dictionary
   * @paramDef {"type":"getModelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering models."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"deepseek-v4-flash","value":"deepseek-v4-flash","note":"deepseek"},{"label":"deepseek-v4-pro","value":"deepseek-v4-pro","note":"deepseek"}],"cursor":null}
   */
  async getModelsDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/models`,
      method: 'get',
      logTag: 'getModelsDictionary',
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
          note: model.owned_by || null,
        })),
      cursor: null,
    }
  }

  /**
   * @operationName Chat Completion
   * @description Generates a text response for a single prompt using a DeepSeek model (deepseek-v4-flash or deepseek-v4-pro, both with a 1M-token context window and up to 384K output tokens). Supports an optional system prompt, thinking mode for extended reasoning (enabled by default on deepseek-v4-flash), reasoning effort control, and JSON mode for structured output. Context caching is automatic — cache hit/miss token counts are returned in usage. Returns the generated text, the model's reasoning content when thinking mode is active, finish reason and token usage.
   * @category Chat
   * @route POST /chat-completion
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The user message to send to the model."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getModelsDictionary","defaultValue":"deepseek-v4-flash","description":"The DeepSeek model to use. Defaults to 'deepseek-v4-flash'; use 'deepseek-v4-pro' for the most capable model."}
   * @paramDef {"type":"String","label":"System Prompt","name":"systemPrompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional system instructions that set the model's behavior, tone and constraints."}
   * @paramDef {"type":"String","label":"Thinking Mode","name":"thinkingMode","uiComponent":{"type":"DROPDOWN","options":{"values":["Default","Enabled","Disabled"]}},"defaultValue":"Default","description":"Controls the model's extended reasoning. 'Default' uses the model's own default (thinking is on by default for deepseek-v4-flash), 'Enabled' forces thinking mode and returns reasoning content, 'Disabled' turns it off for faster, cheaper responses."}
   * @paramDef {"type":"String","label":"Reasoning Effort","name":"reasoningEffort","uiComponent":{"type":"DROPDOWN","options":{"values":["High","Max"]}},"description":"How much effort the model spends thinking when thinking mode is active. Defaults to 'High'; 'Max' allows the deepest reasoning at higher cost and latency. Only applies in thinking mode."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature between 0 and 2. Higher values produce more random output. Defaults to 1. May be ignored in thinking mode."}
   * @paramDef {"type":"Number","label":"Top P","name":"topP","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Nucleus sampling threshold between 0 and 1. Defaults to 1. Alter this or Temperature, not both."}
   * @paramDef {"type":"Number","label":"Max Tokens","name":"maxTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens the model may generate, including reasoning tokens (up to 384K)."}
   * @paramDef {"type":"Array<String>","label":"Stop Sequences","name":"stop","description":"Up to 16 sequences where the model stops generating further tokens."}
   * @paramDef {"type":"Boolean","label":"JSON Mode","name":"jsonMode","uiComponent":{"type":"TOGGLE"},"description":"When enabled, forces the model to return valid JSON via response_format json_object. Your prompt should explicitly ask for JSON output and include an example of the desired structure."}
   *
   * @returns {Object}
   * @sampleResult {"text":"FlowRunner automates workflows by connecting your apps with AI-powered steps.","reasoningContent":null,"model":"deepseek-v4-flash","finishReason":"stop","usage":{"prompt_tokens":21,"completion_tokens":16,"total_tokens":37,"prompt_cache_hit_tokens":0,"prompt_cache_miss_tokens":21}}
   */
  async chatCompletion(prompt, model, systemPrompt, thinkingMode, reasoningEffort, temperature, topP, maxTokens, stop, jsonMode) {
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    const messages = []

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt })
    }

    messages.push({ role: 'user', content: prompt })

    const body = this.#applyChatOptions(
      { model: model || DEFAULT_CHAT_MODEL, messages },
      { thinkingMode, reasoningEffort, temperature, topP, maxTokens, stop }
    )

    if (jsonMode) body.response_format = { type: 'json_object' }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/chat/completions`,
      body,
      logTag: 'chatCompletion',
    })

    const choice = response.choices?.[0]

    return {
      text: choice?.message?.content ?? '',
      reasoningContent: choice?.message?.reasoning_content ?? null,
      model: response.model,
      finishReason: choice?.finish_reason ?? null,
      usage: response.usage ?? null,
    }
  }

  /**
   * @operationName Chat Completion (Advanced)
   * @description Sends a fully custom chat completion request to DeepSeek with a complete messages array (multi-turn conversations with system, user, assistant and tool roles), tool/function calling passthrough (up to 128 functions), structured output via a response format object, thinking mode and reasoning effort controls, log probabilities, and sampling parameters. Returns the raw DeepSeek API response including choices, reasoning_content, tool calls, and usage with automatic context-cache hit/miss token counts. Note: DeepSeek has deprecated frequency_penalty and presence_penalty — they are no longer supported.
   * @category Chat
   * @route POST /chat-completion-advanced
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"Array<Object>","label":"Messages","name":"messages","required":true,"description":"Conversation messages in OpenAI-compatible format, e.g. [{\"role\":\"system\",\"content\":\"...\"},{\"role\":\"user\",\"content\":\"...\"}]. Supports system, user, assistant and tool roles for multi-turn and tool-calling conversations."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getModelsDictionary","defaultValue":"deepseek-v4-flash","description":"The DeepSeek model to use. Defaults to 'deepseek-v4-flash'."}
   * @paramDef {"type":"String","label":"Thinking Mode","name":"thinkingMode","uiComponent":{"type":"DROPDOWN","options":{"values":["Default","Enabled","Disabled"]}},"defaultValue":"Default","description":"Controls the model's extended reasoning. 'Default' uses the model's own default (thinking is on by default for deepseek-v4-flash), 'Enabled' forces thinking mode and returns reasoning_content, 'Disabled' turns it off."}
   * @paramDef {"type":"String","label":"Reasoning Effort","name":"reasoningEffort","uiComponent":{"type":"DROPDOWN","options":{"values":["High","Max"]}},"description":"How much effort the model spends thinking when thinking mode is active. Defaults to 'High'. Only applies in thinking mode."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature between 0 and 2. Defaults to 1. May be ignored in thinking mode."}
   * @paramDef {"type":"Number","label":"Top P","name":"topP","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Nucleus sampling threshold between 0 and 1. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Max Tokens","name":"maxTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens the model may generate, including reasoning tokens (up to 384K)."}
   * @paramDef {"type":"Array<String>","label":"Stop Sequences","name":"stop","description":"Up to 16 sequences where the model stops generating further tokens."}
   * @paramDef {"type":"Object","label":"Response Format","name":"responseFormat","description":"Structured output specification, e.g. {\"type\":\"json_object\"} to force valid JSON or {\"type\":\"text\"} (default)."}
   * @paramDef {"type":"Array<Object>","label":"Tools","name":"tools","description":"Up to 128 tool definitions the model may call, in OpenAI function-calling format: [{\"type\":\"function\",\"function\":{\"name\":\"...\",\"description\":\"...\",\"parameters\":{...}}}]."}
   * @paramDef {"type":"String","label":"Tool Choice","name":"toolChoice","description":"Controls tool usage: 'none', 'auto', 'required', or a JSON string selecting a specific function, e.g. {\"type\":\"function\",\"function\":{\"name\":\"my_tool\"}}."}
   * @paramDef {"type":"Boolean","label":"Log Probabilities","name":"logprobs","uiComponent":{"type":"TOGGLE"},"description":"When enabled, returns log probabilities of each output token in the response."}
   * @paramDef {"type":"Number","label":"Top Log Probabilities","name":"topLogprobs","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of most likely tokens (0-20) to return at each position, each with its log probability. Requires Log Probabilities to be enabled."}
   *
   * @returns {Object}
   * @sampleResult {"id":"chatcmpl-3f5c8a2e","object":"chat.completion","created":1752345600,"model":"deepseek-v4-flash","choices":[{"index":0,"message":{"role":"assistant","content":"Hello! How can I help you today?","reasoning_content":null},"finish_reason":"stop"}],"usage":{"prompt_tokens":18,"completion_tokens":10,"total_tokens":28,"prompt_cache_hit_tokens":0,"prompt_cache_miss_tokens":18}}
   */
  async chatCompletionAdvanced(messages, model, thinkingMode, reasoningEffort, temperature, topP, maxTokens, stop, responseFormat, tools, toolChoice, logprobs, topLogprobs) {
    if (!messages?.length) {
      throw new Error('Messages array is required and must not be empty')
    }

    const body = this.#applyChatOptions(
      { model: model || DEFAULT_CHAT_MODEL, messages },
      { thinkingMode, reasoningEffort, temperature, topP, maxTokens, stop }
    )

    if (responseFormat) body.response_format = responseFormat
    if (tools?.length) body.tools = tools
    if (logprobs !== undefined && logprobs !== null) body.logprobs = logprobs
    if (topLogprobs !== undefined && topLogprobs !== null) body.top_logprobs = topLogprobs

    if (toolChoice) {
      body.tool_choice = /^\s*\{/.test(toolChoice) ? JSON.parse(toolChoice) : toolChoice
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/chat/completions`,
      body,
      logTag: 'chatCompletionAdvanced',
    })
  }

  /**
   * @operationName Chat Prefix Completion
   * @description Completes a response that must start with the exact text you provide, using DeepSeek's beta chat prefix completion feature. Useful for forcing output structure — e.g. start a code block with '```python\n' and stop at '```' to get pure code, or begin a JSON object with '{'. The prefix is sent as the final assistant message with the prefix flag, and the model continues from it. Returns the continuation (without the prefix), plus the full text with the prefix prepended.
   * @category Chat
   * @route POST /chat-prefix-completion
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The user message describing what the model should produce."}
   * @paramDef {"type":"String","label":"Assistant Prefix","name":"assistantPrefix","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The exact text the model's response must begin with, e.g. '```python\\n' or '{'. The model continues generating from this prefix."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getModelsDictionary","defaultValue":"deepseek-v4-pro","description":"The DeepSeek model to use. Defaults to 'deepseek-v4-pro'."}
   * @paramDef {"type":"String","label":"System Prompt","name":"systemPrompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional system instructions that set the model's behavior, tone and constraints."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature between 0 and 2. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Max Tokens","name":"maxTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens the model may generate for the continuation."}
   * @paramDef {"type":"Array<String>","label":"Stop Sequences","name":"stop","description":"Up to 16 sequences where the model stops generating, e.g. ['```'] to end at a closing code fence."}
   *
   * @returns {Object}
   * @sampleResult {"text":"def quick_sort(arr):\n    if len(arr) <= 1:\n        return arr\n","fullText":"```python\ndef quick_sort(arr):\n    if len(arr) <= 1:\n        return arr\n","model":"deepseek-v4-pro","finishReason":"stop","usage":{"prompt_tokens":32,"completion_tokens":24,"total_tokens":56}}
   */
  async chatPrefixCompletion(prompt, assistantPrefix, model, systemPrompt, temperature, maxTokens, stop) {
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    if (!assistantPrefix) {
      throw new Error('Assistant Prefix is required')
    }

    const messages = []

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt })
    }

    messages.push({ role: 'user', content: prompt })
    messages.push({ role: 'assistant', content: assistantPrefix, prefix: true })

    const body = { model: model || DEFAULT_FIM_MODEL, messages }

    if (temperature !== undefined && temperature !== null) body.temperature = temperature
    if (maxTokens) body.max_tokens = maxTokens
    if (stop?.length) body.stop = stop

    const response = await this.#apiRequest({
      url: `${ BETA_API_BASE_URL }/chat/completions`,
      body,
      logTag: 'chatPrefixCompletion',
    })

    const choice = response.choices?.[0]
    const text = choice?.message?.content ?? ''

    return {
      text,
      fullText: `${ assistantPrefix }${ text }`,
      model: response.model,
      finishReason: choice?.finish_reason ?? null,
      usage: response.usage ?? null,
    }
  }

  /**
   * @operationName FIM Completion
   * @description Generates a fill-in-the-middle (FIM) completion using DeepSeek's beta completions endpoint — ideal for code completion where the text before (prompt) and after (suffix) the insertion point are known. FIM runs in non-thinking mode and is currently supported only by the deepseek-v4-pro model. Returns the generated middle text, finish reason and token usage.
   * @category Completions
   * @route POST /fim-completion
   *
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text before the insertion point, e.g. 'def fib(a):'."}
   * @paramDef {"type":"String","label":"Suffix","name":"suffix","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text after the insertion point, e.g. '    return fib(a-1) + fib(a-2)'. Omit for plain prefix completion."}
   * @paramDef {"type":"String","label":"Model","name":"model","dictionary":"getModelsDictionary","defaultValue":"deepseek-v4-pro","description":"The model to use. FIM completion currently supports only 'deepseek-v4-pro'."}
   * @paramDef {"type":"Number","label":"Max Tokens","name":"maxTokens","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tokens to generate for the completion."}
   * @paramDef {"type":"Number","label":"Temperature","name":"temperature","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sampling temperature between 0 and 2. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Top P","name":"topP","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Nucleus sampling threshold between 0 and 1. Defaults to 1."}
   * @paramDef {"type":"Array<String>","label":"Stop Sequences","name":"stop","description":"Up to 16 sequences where the model stops generating further tokens."}
   * @paramDef {"type":"Boolean","label":"Echo","name":"echo","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the prompt is echoed back at the start of the returned text."}
   *
   * @returns {Object}
   * @sampleResult {"text":"    if a <= 1:\n        return a\n","model":"deepseek-v4-pro","finishReason":"stop","usage":{"prompt_tokens":16,"completion_tokens":12,"total_tokens":28}}
   */
  async fimCompletion(prompt, suffix, model, maxTokens, temperature, topP, stop, echo) {
    if (!prompt || !prompt.trim()) {
      throw new Error('Prompt is required')
    }

    const body = {
      model: model || DEFAULT_FIM_MODEL,
      prompt,
    }

    if (suffix) body.suffix = suffix
    if (maxTokens) body.max_tokens = maxTokens
    if (temperature !== undefined && temperature !== null) body.temperature = temperature
    if (topP !== undefined && topP !== null) body.top_p = topP
    if (stop?.length) body.stop = stop
    if (echo !== undefined && echo !== null) body.echo = echo

    const response = await this.#apiRequest({
      url: `${ BETA_API_BASE_URL }/completions`,
      body,
      logTag: 'fimCompletion',
    })

    const choice = response.choices?.[0]

    return {
      text: choice?.text ?? '',
      model: response.model,
      finishReason: choice?.finish_reason ?? null,
      usage: response.usage ?? null,
    }
  }

  /**
   * @operationName List Models
   * @description Lists all models currently available through the DeepSeek API (e.g. deepseek-v4-flash and deepseek-v4-pro) with their IDs and owning organization. Note: legacy model names 'deepseek-chat' and 'deepseek-reasoner' are deprecated as of 2026-07-24.
   * @category Models
   * @route GET /list-models
   *
   * @returns {Object}
   * @sampleResult {"object":"list","data":[{"id":"deepseek-v4-flash","object":"model","owned_by":"deepseek"},{"id":"deepseek-v4-pro","object":"model","owned_by":"deepseek"}]}
   */
  async listModels() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/models`,
      method: 'get',
      logTag: 'listModels',
    })
  }

  /**
   * @operationName Get Balance
   * @description Retrieves the DeepSeek account's current balance, including whether the balance is sufficient for API calls and a per-currency (USD/CNY) breakdown of total, granted and topped-up balances.
   * @category Account
   * @route GET /get-balance
   *
   * @returns {Object}
   * @sampleResult {"is_available":true,"balance_infos":[{"currency":"USD","total_balance":"110.00","granted_balance":"10.00","topped_up_balance":"100.00"}]}
   */
  async getBalance() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/user/balance`,
      method: 'get',
      logTag: 'getBalance',
    })
  }
}

Flowrunner.ServerCode.addService(DeepSeekService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your DeepSeek API key from https://platform.deepseek.com/api_keys',
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
