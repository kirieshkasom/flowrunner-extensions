const logger = {
  info: (...args) => console.log('[Jina AI] info:', ...args),
  debug: (...args) => console.log('[Jina AI] debug:', ...args),
  error: (...args) => console.log('[Jina AI] error:', ...args),
  warn: (...args) => console.log('[Jina AI] warn:', ...args),
}

// Jina AI spans several hosts; each operation targets the appropriate base.
const API_HOST = 'https://api.jina.ai/v1'
const READER_HOST = 'https://r.jina.ai'
const SEARCH_HOST = 'https://s.jina.ai'
const DEEPSEARCH_HOST = 'https://deepsearch.jina.ai/v1'

const DEFAULT_EMBEDDINGS_MODEL = 'jina-embeddings-v3'
const DEFAULT_RERANKER_MODEL = 'jina-reranker-v2-base-multilingual'
const DEFAULT_CLASSIFIER_MODEL = 'jina-embeddings-v3'
const DEFAULT_DEEPSEARCH_MODEL = 'jina-deepsearch-v1'

function clean(obj) {
  if (!obj) {
    return obj
  }

  const result = {}

  for (const key in obj) {
    const value = obj[key]

    if (value !== undefined && value !== null && value !== '') {
      result[key] = value
    }
  }

  return result
}

/**
 * @integrationName Jina AI
 * @integrationIcon /icon.png
 */
class JinaService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Single request helper. `base` is a full host root; each op passes the host it needs.
  async #request({ base, path = '', method = 'post', body, query, headers, logTag }) {
    const url = `${ base }${ path }`

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set(clean({
          'Authorization': `Bearer ${ this.apiKey }`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...headers,
        }))
        .query(clean(query) || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.detail || error.body?.message ||
        (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))
      const status = error.status || error.statusCode

      logger.error(`${ logTag } - failed${ status ? ` (${ status })` : '' }: ${ message }`)

      throw new Error(`Jina AI API error: ${ message }`)
    }
  }

  /**
   * @operationName Create Embeddings
   * @category Embeddings
   * @description Generates vector embeddings for one or more input texts using Jina's embedding models (default jina-embeddings-v3). Supports task-specific embeddings (retrieval query/passage, text matching, classification, separation), optional output dimensionality reduction via Matryoshka (dimensions), and late chunking for long documents. Returns one embedding vector per input plus token usage. Use the resulting vectors for semantic search, RAG, or similarity workloads.
   * @route POST /embeddings
   * @appearanceColor #EB6161 #009191
   *
   * @paramDef {"type":"Array<String>","label":"Input Texts","name":"input","required":true,"description":"One or more texts to embed. Each string produces one embedding vector."}
   * @paramDef {"type":"String","label":"Model","name":"model","description":"Embedding model to use. Defaults to jina-embeddings-v3. Other options include jina-embeddings-v2-base-en and jina-clip-v2."}
   * @paramDef {"type":"String","label":"Task","name":"task","uiComponent":{"type":"DROPDOWN","options":{"values":["Retrieval Query","Retrieval Passage","Text Matching","Classification","Separation"]}},"description":"Downstream task the embeddings are optimized for (jina-embeddings-v3 only). Retrieval Query for search queries, Retrieval Passage for documents to be indexed."}
   * @paramDef {"type":"Number","label":"Dimensions","name":"dimensions","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional truncated output dimensionality (Matryoshka). Lower values reduce vector size at some quality cost. Leave empty for the model default (e.g. 1024)."}
   * @paramDef {"type":"Boolean","label":"Late Chunking","name":"lateChunking","uiComponent":{"type":"CHECKBOX"},"description":"When true, applies late chunking to better preserve context across long inputs. Defaults to false."}
   * @paramDef {"type":"String","label":"Embedding Type","name":"embeddingType","uiComponent":{"type":"DROPDOWN","options":{"values":["Float","Base64","Binary","Ubinary"]}},"description":"Numeric format of returned embeddings. Defaults to Float."}
   *
   * @returns {Object}
   * @sampleResult {"model":"jina-embeddings-v3","object":"list","usage":{"total_tokens":8,"prompt_tokens":8},"data":[{"object":"embedding","index":0,"embedding":[0.017,-0.041,0.052]}]}
   */
  async createEmbeddings(input, model, task, dimensions, lateChunking, embeddingType) {
    const logTag = '[createEmbeddings]'

    const body = clean({
      model: model || DEFAULT_EMBEDDINGS_MODEL,
      input: Array.isArray(input) ? input : [input],
      task: this.#resolveChoice(task, {
        'Retrieval Query': 'retrieval.query',
        'Retrieval Passage': 'retrieval.passage',
        'Text Matching': 'text-matching',
        'Classification': 'classification',
        'Separation': 'separation',
      }),
      dimensions,
      late_chunking: lateChunking === undefined ? undefined : Boolean(lateChunking),
      embedding_type: this.#resolveChoice(embeddingType, {
        Float: 'float',
        Base64: 'base64',
        Binary: 'binary',
        Ubinary: 'ubinary',
      }),
    })

    return this.#request({ logTag, base: API_HOST, path: '/embeddings', method: 'post', body })
  }

  /**
   * @operationName Rerank Documents
   * @category Search & Ranking
   * @description Reorders a set of candidate documents by semantic relevance to a query using Jina's reranker models (default jina-reranker-v2-base-multilingual). Returns each document's original index and a relevance_score, sorted most-relevant first, optionally including the document text. Ideal as a second-stage reranker after vector or keyword retrieval in a RAG pipeline.
   * @route POST /rerank
   * @appearanceColor #EB6161 #009191
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"The search query the documents are ranked against."}
   * @paramDef {"type":"Array<String>","label":"Documents","name":"documents","required":true,"description":"Candidate documents to rank by relevance to the query."}
   * @paramDef {"type":"String","label":"Model","name":"model","description":"Reranker model. Defaults to jina-reranker-v2-base-multilingual."}
   * @paramDef {"type":"Number","label":"Top N","name":"topN","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Return only the top N most relevant documents. Leave empty to rank all documents."}
   * @paramDef {"type":"Boolean","label":"Return Documents","name":"returnDocuments","uiComponent":{"type":"CHECKBOX"},"description":"When true, includes each document's text in the results. Defaults to true."}
   *
   * @returns {Object}
   * @sampleResult {"model":"jina-reranker-v2-base-multilingual","usage":{"total_tokens":38},"results":[{"index":2,"relevance_score":0.92,"document":{"text":"Paris is the capital of France."}},{"index":0,"relevance_score":0.14,"document":{"text":"Berlin is a large city."}}]}
   */
  async rerankDocuments(query, documents, model, topN, returnDocuments) {
    const logTag = '[rerankDocuments]'

    const body = clean({
      model: model || DEFAULT_RERANKER_MODEL,
      query,
      documents: Array.isArray(documents) ? documents : [documents],
      top_n: topN,
      return_documents: returnDocuments === undefined ? undefined : Boolean(returnDocuments),
    })

    return this.#request({ logTag, base: API_HOST, path: '/rerank', method: 'post', body })
  }

  /**
   * @operationName Read URL
   * @category Reader
   * @description Fetches a web page through Jina Reader and returns clean, LLM-ready content (markdown by default). Renders the page server-side, strips boilerplate, and can return markdown, HTML, plain text, or a screenshot. Optionally appends a summary of all links on the page or targets a specific CSS selector. This is the ideal way to feed live web content into an AI/RAG workflow.
   * @route POST /read-url
   * @appearanceColor #EB6161 #009191
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"The web page URL to read and convert to clean content."}
   * @paramDef {"type":"String","label":"Return Format","name":"returnFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["Markdown","HTML","Text","Screenshot"]}},"description":"Output format for the page content. Defaults to Markdown."}
   * @paramDef {"type":"Boolean","label":"With Links Summary","name":"withLinksSummary","uiComponent":{"type":"CHECKBOX"},"description":"When true, appends a de-duplicated summary of all links found on the page. Defaults to false."}
   * @paramDef {"type":"Boolean","label":"With Images Summary","name":"withImagesSummary","uiComponent":{"type":"CHECKBOX"},"description":"When true, appends a summary of all images found on the page. Defaults to false."}
   * @paramDef {"type":"String","label":"Target Selector","name":"targetSelector","description":"Optional CSS selector to extract only a specific part of the page (e.g. article, #main). Leave empty to read the whole page."}
   *
   * @returns {Object}
   * @sampleResult {"code":200,"status":20000,"data":{"title":"Example Domain","url":"https://example.com/","content":"# Example Domain\n\nThis domain is for use in illustrative examples...","usage":{"tokens":42}}}
   */
  async readUrl(url, returnFormat, withLinksSummary, withImagesSummary, targetSelector) {
    const logTag = '[readUrl]'

    const headers = clean({
      'X-Return-Format': this.#resolveChoice(returnFormat, {
        Markdown: 'markdown',
        HTML: 'html',
        Text: 'text',
        Screenshot: 'screenshot',
      }),
      'X-With-Links-Summary': withLinksSummary ? 'true' : undefined,
      'X-With-Images-Summary': withImagesSummary ? 'true' : undefined,
      'X-Target-Selector': targetSelector,
    })

    return this.#request({
      logTag,
      base: READER_HOST,
      path: '/',
      method: 'post',
      headers,
      body: { url },
    })
  }

  /**
   * @operationName Search Web
   * @category Reader
   * @description Runs a web search through Jina Search and returns the top results already fetched and cleaned into LLM-ready content, so each result carries usable page text rather than just a snippet. Choose the content format for the returned pages. Ideal for grounding AI answers with fresh web content in a single call.
   * @route POST /search-web
   * @appearanceColor #EB6161 #009191
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"The web search query."}
   * @paramDef {"type":"String","label":"Return Format","name":"returnFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["Markdown","HTML","Text"]}},"description":"Output format for each fetched result's content. Defaults to Markdown."}
   * @paramDef {"type":"String","label":"Site","name":"site","description":"Optional domain to restrict the search to (e.g. jina.ai). Leave empty to search the whole web."}
   *
   * @returns {Object}
   * @sampleResult {"code":200,"status":20000,"data":[{"title":"Jina AI","url":"https://jina.ai/","description":"Your Search Foundation, Supercharged.","content":"# Jina AI\n\n..."}]}
   */
  async searchWeb(query, returnFormat, site) {
    const logTag = '[searchWeb]'

    const headers = clean({
      'X-Return-Format': this.#resolveChoice(returnFormat, {
        Markdown: 'markdown',
        HTML: 'html',
        Text: 'text',
      }),
      'X-Site': site,
    })

    return this.#request({
      logTag,
      base: SEARCH_HOST,
      path: '/',
      method: 'post',
      headers,
      body: { q: query },
    })
  }

  /**
   * @operationName Classify Texts
   * @category Classification
   * @description Performs zero-shot classification of one or more input texts against a set of candidate labels using a Jina embedding or classifier model. No training is required: provide the texts and the labels, and each input is assigned the best-matching label with a confidence score. Useful for intent detection, content moderation, and routing.
   * @route POST /classify
   * @appearanceColor #EB6161 #009191
   *
   * @paramDef {"type":"Array<String>","label":"Input Texts","name":"input","required":true,"description":"One or more texts to classify."}
   * @paramDef {"type":"Array<String>","label":"Labels","name":"labels","required":true,"description":"Candidate labels for zero-shot classification. Each input is assigned the best-matching label."}
   * @paramDef {"type":"String","label":"Model","name":"model","description":"Embedding or classifier model used for zero-shot classification. Defaults to jina-embeddings-v3."}
   *
   * @returns {Object}
   * @sampleResult {"usage":{"total_tokens":19},"data":[{"index":0,"prediction":"positive","score":0.81,"predictions":[{"label":"positive","score":0.81},{"label":"negative","score":0.19}]}]}
   */
  async classifyTexts(input, labels, model) {
    const logTag = '[classifyTexts]'

    const body = clean({
      model: model || DEFAULT_CLASSIFIER_MODEL,
      input: Array.isArray(input) ? input : [input],
      labels: Array.isArray(labels) ? labels : [labels],
    })

    return this.#request({ logTag, base: API_HOST, path: '/classify', method: 'post', body })
  }

  /**
   * @operationName Segment Text
   * @category Classification
   * @description Tokenizes and splits long text into smaller chunks using Jina Segmenter. Returns the total token count and, when requested, the list of text chunks bounded by a maximum chunk length. Use it to prepare documents for embedding or LLM context windows in a RAG pipeline.
   * @route POST /segment
   * @appearanceColor #EB6161 #009191
   *
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"description":"The text to tokenize and segment into chunks."}
   * @paramDef {"type":"String","label":"Tokenizer","name":"tokenizer","uiComponent":{"type":"DROPDOWN","options":{"values":["Cl100k Base","O200k Base","P50k Base","R50k Base","Gpt2","Llama3"]}},"description":"Tokenizer used to count tokens and bound chunks. Defaults to Cl100k Base."}
   * @paramDef {"type":"Boolean","label":"Return Chunks","name":"returnChunks","uiComponent":{"type":"CHECKBOX"},"description":"When true, returns the segmented text chunks (not just the token count). Defaults to true."}
   * @paramDef {"type":"Number","label":"Max Chunk Length","name":"maxChunkLength","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of characters per chunk. Defaults to 1000."}
   *
   * @returns {Object}
   * @sampleResult {"num_tokens":120,"tokenizer":"cl100k_base","num_chunks":2,"chunk_positions":[[0,512],[512,1024]],"chunks":["First chunk of text...","Second chunk of text..."]}
   */
  async segmentText(content, tokenizer, returnChunks, maxChunkLength) {
    const logTag = '[segmentText]'

    const body = clean({
      content,
      tokenizer: this.#resolveChoice(tokenizer, {
        'Cl100k Base': 'cl100k_base',
        'O200k Base': 'o200k_base',
        'P50k Base': 'p50k_base',
        'R50k Base': 'r50k_base',
        'Gpt2': 'gpt2',
        'Llama3': 'llama3',
      }),
      return_chunks: returnChunks === undefined ? true : Boolean(returnChunks),
      max_chunk_length: maxChunkLength,
    })

    return this.#request({ logTag, base: API_HOST, path: '/segment', method: 'post', body })
  }

  /**
   * @operationName Deep Search
   * @category Reader
   * @description Runs an agentic deep-research search with jina-deepsearch-v1. Given a conversation (messages), it iteratively searches the web, reads pages, and reasons to produce a grounded, cited answer to complex questions. OpenAI chat-completions compatible. Returns the assistant's answer and, when available, the sources it consulted. Slower than a plain search but far more thorough.
   * @route POST /deep-search
   * @appearanceColor #EB6161 #009191
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"The research question to investigate. Sent as a single user message."}
   * @paramDef {"type":"String","label":"System Prompt","name":"systemPrompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional system instruction to steer the research (tone, focus, output format). Leave empty for default behavior."}
   * @paramDef {"type":"String","label":"Model","name":"model","description":"DeepSearch model. Defaults to jina-deepsearch-v1."}
   *
   * @returns {Object}
   * @sampleResult {"id":"chatcmpl-abc","object":"chat.completion","model":"jina-deepsearch-v1","choices":[{"index":0,"message":{"role":"assistant","content":"Based on current sources, ..."},"finish_reason":"stop"}],"usage":{"total_tokens":4211}}
   */
  async deepSearch(query, systemPrompt, model) {
    const logTag = '[deepSearch]'

    const messages = []

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt })
    }

    messages.push({ role: 'user', content: query })

    const body = {
      model: model || DEFAULT_DEEPSEARCH_MODEL,
      messages,
      stream: false,
    }

    return this.#request({
      logTag,
      base: DEEPSEARCH_HOST,
      path: '/chat/completions',
      method: 'post',
      body,
    })
  }
}

Flowrunner.ServerCode.addService(JinaService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Jina AI API key (a jina_... token, sent as a Bearer token). Get it from https://jina.ai/api-dashboard. A free tier is available.',
  },
])
