const logger = {
  info: (...args) => console.log('[Mindee] info:', ...args),
  debug: (...args) => console.log('[Mindee] debug:', ...args),
  error: (...args) => console.log('[Mindee] error:', ...args),
  warn: (...args) => console.log('[Mindee] warn:', ...args),
}

// Mindee V2 API (app.mindee.com). The legacy V1 surface
// (https://api.mindee.net/v1/products/{account}/{endpoint}/vN/predict with an
// "Authorization: Token <key>" header) is the older platform.mindee.com product
// and is not used here. V2 is asynchronous only: enqueue an inference, poll the
// job, then fetch the result. Models are selected by their model_id UUID, which
// you create in the Mindee platform from the model catalog.
const API_BASE_URL = 'https://api-v2.mindee.net/v2'

// Async polling defaults. The API times out an inference after 590s, so cap the
// wait well under a comfortable action timeout and poll on a fixed interval.
const POLL_INTERVAL_MS = 2000
const MAX_POLL_ATTEMPTS = 25

/**
 * @integrationName Mindee
 * @integrationIcon /icon.png
 */
class MindeeService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  // Normalize a downloaded file body to a Buffer. Flowrunner.Request auto-parses
  // the response by Content-Type, so a JSON/text source can arrive as a parsed
  // object/string rather than bytes despite .setEncoding(null); re-serialize those.
  #toBuffer(body) {
    if (Buffer.isBuffer(body)) {
      return body
    }

    if (typeof body === 'string') {
      return Buffer.from(body)
    }

    return Buffer.from(JSON.stringify(body))
  }

  // Derive a filename (with extension) from a URL so Mindee can detect the mime type.
  #fileNameFromUrl(fileUrl) {
    try {
      const raw = decodeURIComponent(String(fileUrl).split('?')[0].split('/').pop() || '')

      return raw && raw.includes('.') ? raw : `document_${ Date.now() }.pdf`
    } catch (error) {
      return `document_${ Date.now() }.pdf`
    }
  }

  // Single request helper. Every V2 call sends the raw API key in the
  // Authorization header (no "Bearer"/"Token" prefix). On success Flowrunner.Request
  // returns the parsed response body directly.
  async #apiRequest({ url, method = 'get', form, query, logTag }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ Authorization: this.apiKey })
        .query(query || {})

      // Multipart uploads set their own boundary via .form(FormData); do not add a
      // Content-Type header manually.
      return form !== undefined ? await request.form(form) : await request
    } catch (error) {
      // V2 errors follow RFC 9457: { status, title, detail, code, errors:[{pointer,detail}] }.
      const problem = error.body || {}
      const fieldErrors = Array.isArray(problem.errors)
        ? problem.errors.map(item => item?.detail).filter(Boolean).join('; ')
        : ''
      const message = [problem.detail || problem.title, fieldErrors].filter(Boolean).join(' — ') ||
        error.message

      logger.error(`${ logTag } - failed (${ error.status || error.statusCode || problem.status || '?' }): ${ message }`)

      throw new Error(`Mindee API error: ${ message }`)
    }
  }

  // Build the multipart body for an enqueue call. Downloads the file at fileUrl and
  // attaches it as the `file` field alongside the model_id and any feature flags.
  async #buildEnqueueForm({ modelId, fileUrl, options, logTag }) {
    if (!modelId) {
      throw new Error('Mindee API error: a model ID is required.')
    }

    if (!fileUrl) {
      throw new Error('Mindee API error: a document URL is required.')
    }

    logger.debug(`${ logTag } - downloading ${ fileUrl }`)

    const fileBytes = this.#toBuffer(await Flowrunner.Request.get(fileUrl).setEncoding(null))
    const filename = this.#fileNameFromUrl(fileUrl)

    const formData = new Flowrunner.Request.FormData()

    formData.append('model_id', String(modelId))
    formData.append('file', fileBytes, { filename })
    formData.append('filename', filename)

    for (const [key, value] of Object.entries(options || {})) {
      if (value !== undefined && value !== null && value !== '') {
        formData.append(key, String(value))
      }
    }

    return formData
  }

  // Enqueue an extraction inference and return the created job object.
  async #enqueueExtraction({ modelId, fileUrl, options, logTag }) {
    const form = await this.#buildEnqueueForm({ modelId, fileUrl, options, logTag })

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/products/extraction/enqueue`,
      method: 'post',
      form,
    })

    return response?.job || response
  }

  // Poll a job by id until it reaches a terminal state (Processed / Failed) or the
  // attempt budget is exhausted. Returns the final job object.
  async #pollJob({ jobId, logTag, attempts = MAX_POLL_ATTEMPTS }) {
    let lastJob = null

    for (let attempt = 0; attempt < attempts; attempt++) {
      // redirect=false keeps the job payload (with result_url) instead of 302-ing
      // straight to the result endpoint.
      const response = await this.#apiRequest({
        logTag,
        url: `${ API_BASE_URL }/jobs/${ jobId }`,
        method: 'get',
        query: { redirect: false },
      })

      lastJob = response?.job || response
      const status = lastJob?.status

      if (status === 'Processed' || status === 'Failed') {
        return lastJob
      }

      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
    }

    logger.warn(`${ logTag } - job ${ jobId } did not finish within ${ attempts } polls`)

    return lastJob
  }

  // Fetch a completed extraction result by inference id.
  async #getExtractionResult({ inferenceId, logTag }) {
    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/products/extraction/results/${ inferenceId }`,
      method: 'get',
    })

    return response?.inference || response
  }

  // Flatten a V2 result.fields tree into plain values. Each node is one of:
  // SimpleFieldResult ({ value }), ListFieldResult ({ items:[...] }), or
  // ObjectFieldResult ({ fields:{...} }). Returns a nested plain object/array.
  #flattenFields(fields) {
    if (!fields || typeof fields !== 'object') {
      return fields
    }

    const output = {}

    for (const [key, node] of Object.entries(fields)) {
      output[key] = this.#flattenNode(node)
    }

    return output
  }

  #flattenNode(node) {
    if (node === null || node === undefined || typeof node !== 'object') {
      return node
    }

    if (Array.isArray(node.items)) {
      return node.items.map(item => this.#flattenNode(item))
    }

    if (node.fields && typeof node.fields === 'object') {
      return this.#flattenFields(node.fields)
    }

    if (Object.prototype.hasOwnProperty.call(node, 'value')) {
      return node.value
    }

    return node
  }

  /**
   * @operationName Extract Document
   * @category Extraction
   * @description Runs a document through a Mindee V2 extraction model and waits for the result. Provide the model ID (a UUID you create in the Mindee platform from the model catalog — e.g. the prebuilt Invoice, Receipt, Passport, ID, Resume, or US Driver License model, or your own custom model) and a document URL. The file is downloaded and enqueued, the job is polled until it finishes, and a flattened `fields` object (simple values, nested objects, and lists) is returned alongside the complete raw inference. Because parsing is asynchronous, allow up to roughly a minute for large or multi-page documents.
   * @route POST /extract-document
   * @appearanceColor #6A5CFF #8B7DFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Model ID","name":"modelId","required":true,"description":"The Mindee V2 model UUID to run. Find it in the Mindee platform on your model's page (Model ID)."}
   * @paramDef {"type":"String","label":"Document URL","name":"documentUrl","required":true,"description":"URL of the file to parse (PDF, JPG, PNG, WEBP, TIFF, HEIC). Can be a public URL or a FlowRunner file URL. The file is downloaded and uploaded to Mindee."}
   * @paramDef {"type":"Boolean","label":"Include Confidence","name":"includeConfidence","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"Include per-field confidence levels in the raw inference. Defaults to false."}
   * @paramDef {"type":"Boolean","label":"Include Raw Text (OCR)","name":"includeRawText","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"Include the full OCR text of the document in the raw inference. Defaults to false."}
   *
   * @returns {Object}
   * @sampleResult {"status":"Processed","inferenceId":"c0ffee00-1111-2222-3333-444455556666","fields":{"supplier_name":"ACME Corp","total_amount":110,"invoice_number":"INV-001","line_items":[{"description":"Widget A","quantity":2,"total_amount":100}]},"raw":{"inference":{"id":"c0ffee00-1111-2222-3333-444455556666","model":{"id":"model-uuid"},"result":{"fields":{}}}}}
   */
  async extractDocument(modelId, documentUrl, includeConfidence, includeRawText) {
    const logTag = '[extractDocument]'

    const job = await this.#enqueueExtraction({
      logTag,
      modelId,
      fileUrl: documentUrl,
      options: {
        confidence: includeConfidence ? 'true' : undefined,
        raw_text: includeRawText ? 'true' : undefined,
      },
    })

    if (!job?.id) {
      throw new Error('Mindee API error: enqueue did not return a job id.')
    }

    const finished = await this.#pollJob({ jobId: job.id, logTag })

    if (finished?.status === 'Failed') {
      const detail = finished?.error?.detail || finished?.error?.title || 'inference failed'

      throw new Error(`Mindee API error: ${ detail }`)
    }

    const inferenceId = finished?.id || job.id
    const inference = await this.#getExtractionResult({ inferenceId, logTag })

    return {
      status: finished?.status || 'Processed',
      inferenceId: inference?.id || inferenceId,
      fields: this.#flattenFields(inference?.result?.fields),
      raw: { inference },
    }
  }

  /**
   * @operationName Enqueue Inference
   * @category Extraction
   * @description Enqueues a document for extraction without waiting for the result, returning the created job (with its id and polling/result URLs). Use this for high-volume or webhook-driven flows where you retrieve the outcome later via Get Job Status and Get Inference Result, or via a configured Mindee webhook. Provide the model ID and a document URL; the file is downloaded and uploaded to Mindee. Optionally supply webhook IDs (comma-separated) to have Mindee notify your endpoints when the job completes.
   * @route POST /enqueue-inference
   * @appearanceColor #6A5CFF #8B7DFF
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Model ID","name":"modelId","required":true,"description":"The Mindee V2 model UUID to run. Find it in the Mindee platform on your model's page (Model ID)."}
   * @paramDef {"type":"String","label":"Document URL","name":"documentUrl","required":true,"description":"URL of the file to parse (PDF, JPG, PNG, WEBP, TIFF, HEIC). Can be a public URL or a FlowRunner file URL. The file is downloaded and uploaded to Mindee."}
   * @paramDef {"type":"Array<String>","label":"Webhook IDs","name":"webhookIds","required":false,"description":"Optional Mindee webhook UUIDs to notify when the job completes."}
   * @paramDef {"type":"String","label":"Alias","name":"alias","required":false,"description":"Optional free-form label to tag the request with your own identifier."}
   *
   * @returns {Object}
   * @sampleResult {"id":"11112222-3333-4444-5555-666677778888","model_id":"model-uuid","status":"Processing","polling_url":"https://api-v2.mindee.net/v2/jobs/11112222-3333-4444-5555-666677778888","result_url":null,"filename":"invoice.pdf"}
   */
  async enqueueInference(modelId, documentUrl, webhookIds, alias) {
    const logTag = '[enqueueInference]'
    const ids = (webhookIds || []).filter(Boolean)

    return await this.#enqueueExtraction({
      logTag,
      modelId,
      fileUrl: documentUrl,
      options: {
        alias,
        webhook_ids: ids.length ? ids.join(',') : undefined,
      },
    })
  }

  /**
   * @operationName Get Job Status
   * @category Jobs
   * @description Retrieves the current status of an asynchronous inference job by its id. Returns the job object, whose `status` is one of Processing, Processed, or Failed; once processed, `result_url` points to the completed inference. Use this to poll a job created by Enqueue Inference before fetching its result.
   * @route GET /get-job-status
   * @appearanceColor #6A5CFF #8B7DFF
   *
   * @paramDef {"type":"String","label":"Job ID","name":"jobId","required":true,"description":"The job UUID returned by Enqueue Inference."}
   *
   * @returns {Object}
   * @sampleResult {"id":"11112222-3333-4444-5555-666677778888","model_id":"model-uuid","status":"Processed","polling_url":"https://api-v2.mindee.net/v2/jobs/11112222-3333-4444-5555-666677778888","result_url":"https://api-v2.mindee.net/v2/products/extraction/results/c0ffee00-1111-2222-3333-444455556666","filename":"invoice.pdf","error":null}
   */
  async getJobStatus(jobId) {
    if (!jobId) {
      throw new Error('Mindee API error: a job ID is required.')
    }

    const response = await this.#apiRequest({
      logTag: '[getJobStatus]',
      url: `${ API_BASE_URL }/jobs/${ jobId }`,
      method: 'get',
      query: { redirect: false },
    })

    return response?.job || response
  }

  /**
   * @operationName Get Inference Result
   * @category Jobs
   * @description Fetches a completed extraction inference by its id and returns a flattened `fields` object (simple values, nested objects, and lists) alongside the complete raw inference. Use this after Get Job Status reports the job as Processed. The inference id is the completed job's id.
   * @route GET /get-inference-result
   * @appearanceColor #6A5CFF #8B7DFF
   *
   * @paramDef {"type":"String","label":"Inference ID","name":"inferenceId","required":true,"description":"The inference UUID (the completed job's id) to fetch results for."}
   *
   * @returns {Object}
   * @sampleResult {"inferenceId":"c0ffee00-1111-2222-3333-444455556666","fields":{"supplier_name":"ACME Corp","total_amount":110,"invoice_number":"INV-001","line_items":[{"description":"Widget A","quantity":2,"total_amount":100}]},"raw":{"inference":{"id":"c0ffee00-1111-2222-3333-444455556666","model":{"id":"model-uuid"},"result":{"fields":{}}}}}
   */
  async getInferenceResult(inferenceId) {
    if (!inferenceId) {
      throw new Error('Mindee API error: an inference ID is required.')
    }

    const inference = await this.#getExtractionResult({ inferenceId, logTag: '[getInferenceResult]' })

    return {
      inferenceId: inference?.id || inferenceId,
      fields: this.#flattenFields(inference?.result?.fields),
      raw: { inference },
    }
  }
}

Flowrunner.ServerCode.addService(MindeeService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Mindee V2 API key, sent as the raw "Authorization: <key>" header (no Bearer/Token prefix). Create one in the Mindee platform (app.mindee.com) under API Keys.',
  },
])
