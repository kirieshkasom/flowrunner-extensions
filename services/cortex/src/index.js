const logger = {
  info: (...args) => console.log('[Cortex] info:', ...args),
  debug: (...args) => console.log('[Cortex] debug:', ...args),
  error: (...args) => console.log('[Cortex] error:', ...args),
  warn: (...args) => console.log('[Cortex] warn:', ...args),
}

// Friendly DROPDOWN label -> Cortex API value mappings.
const DATA_TYPE_MAP = {
  'IP': 'ip',
  'Domain': 'domain',
  'FQDN': 'fqdn',
  'URL': 'url',
  'Hash': 'hash',
  'Mail': 'mail',
  'File': 'file',
  'Other': 'other',
}

// Traffic Light Protocol / Permissible Actions Protocol both map to 0-3.
const TLP_MAP = { WHITE: 0, GREEN: 1, AMBER: 2, RED: 3 }
const PAP_MAP = { WHITE: 0, GREEN: 1, AMBER: 2, RED: 3 }

// Remove undefined/null/empty values so we never send blank fields to Cortex.
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
 * @integrationName Cortex
 * @integrationIcon /icon.png
 */
class CortexService {
  constructor(config) {
    // Normalize the instance URL: strip any trailing slash so we can safely append /api.
    this.baseUrl = (config.url || '').replace(/\/+$/, '')
    this.apiKey = config.apiKey
  }

  #apiBase() {
    return `${ this.baseUrl }/api`
  }

  // Map a friendly DROPDOWN label to the API value; pass through anything not in the map.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.apiKey }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      // Cortex returns { type, message } plus an HTTP status on errors.
      const rawBody = error.body
      let apiMessage

      if (rawBody && typeof rawBody === 'object') {
        apiMessage = rawBody.message || rawBody.type
      }

      const status = error.status || error.statusCode
      const message = apiMessage || (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))

      logger.error(`${ logTag } - failed (${ status || 'no status' }): ${ message }`)

      throw new Error(`Cortex API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  /* ---------------------------------------------------------------------------
   * Analyzers
   * ------------------------------------------------------------------------- */

  /**
   * @operationName List Analyzers
   * @category Analyzers
   * @description Lists all analyzers enabled in your Cortex organization. Analyzers are workers that investigate a single observable (IP, domain, hash, URL, email, file, etc.) against a threat-intelligence or enrichment source and produce a report. Each entry includes the analyzer id (used to run it), name, version, description and the observable dataTypes it accepts. Use this to discover which analyzers are available before running an analysis.
   * @route GET /analyzers
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"220483fde9608c580fb6a2508ff3d2d3","analyzerDefinitionId":"Abuse_Finder_2_0","name":"Abuse_Finder_2_0","version":"2.0","description":"Find abuse contacts associated with an observable","dataTypeList":["ip","domain","fqdn","url","mail"]}]
   */
  async listAnalyzers() {
    const logTag = '[listAnalyzers]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.#apiBase() }/analyzer`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Analyzer
   * @category Analyzers
   * @description Retrieves the full configuration of a single enabled analyzer by its id. Returns the analyzer definition, version, description, accepted observable dataTypes and its runtime configuration. Use List Analyzers or the Get Analyzers Dictionary to obtain a valid analyzer id.
   * @route GET /analyzer/{id}
   *
   * @paramDef {"type":"String","label":"Analyzer ID","name":"id","required":true,"dictionary":"getAnalyzersDictionary","description":"The id of the enabled analyzer to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"220483fde9608c580fb6a2508ff3d2d3","analyzerDefinitionId":"Abuse_Finder_2_0","name":"Abuse_Finder_2_0","version":"2.0","description":"Find abuse contacts associated with an observable","dataTypeList":["ip","domain","fqdn","url","mail"]}
   */
  async getAnalyzer(id) {
    const logTag = '[getAnalyzer]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.#apiBase() }/analyzer/${ encodeURIComponent(id) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Analyzers by Type
   * @category Analyzers
   * @description Lists the enabled analyzers that can process a specific observable dataType (for example every analyzer able to enrich an IP address or a file hash). Choose the observable type and Cortex returns only the matching analyzers with their ids and descriptions. Useful for building automated enrichment where the observable type is known but the analyzer is chosen dynamically.
   * @route GET /analyzers/type
   *
   * @paramDef {"type":"String","label":"Data Type","name":"dataType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["IP","Domain","FQDN","URL","Hash","Mail","File","Other"]}},"description":"The observable type to filter analyzers by."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"220483fde9608c580fb6a2508ff3d2d3","name":"Abuse_Finder_2_0","version":"2.0","dataTypeList":["ip","domain","fqdn","url","mail"]}]
   */
  async getAnalyzersByType(dataType) {
    const logTag = '[getAnalyzersByType]'

    const resolvedType = this.#resolveChoice(dataType, DATA_TYPE_MAP)

    return await this.#apiRequest({
      logTag,
      url: `${ this.#apiBase() }/analyzer/type/${ encodeURIComponent(resolvedType) }`,
      method: 'get',
    })
  }

  /* ---------------------------------------------------------------------------
   * Run Analysis
   * ------------------------------------------------------------------------- */

  /**
   * @operationName Run Analyzer
   * @category Run Analysis
   * @description Runs an analyzer against a value-based observable (IP, domain, FQDN, URL, hash, email address or arbitrary string) and returns the created job immediately. The job runs asynchronously — poll it with Get Job, fetch results with Get Job Report, or block until completion with Wait for Job Report. TLP and PAP accept friendly labels that map to Cortex numeric codes (WHITE=0, GREEN=1, AMBER=2, RED=3). Analyzer-specific settings can be supplied via Parameters. Note: file observables require multipart upload and are not supported here; use value-based observables.
   * @route POST /analyzer/{id}/run
   *
   * @paramDef {"type":"String","label":"Analyzer ID","name":"id","required":true,"dictionary":"getAnalyzersDictionary","description":"The id of the analyzer to run."}
   * @paramDef {"type":"String","label":"Observable Value","name":"data","required":true,"description":"The observable to analyze, e.g. an IP address, domain, URL, file hash or email address."}
   * @paramDef {"type":"String","label":"Data Type","name":"dataType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["IP","Domain","FQDN","URL","Hash","Mail","Other"]}},"description":"The type of the observable value being analyzed."}
   * @paramDef {"type":"String","label":"TLP","name":"tlp","uiComponent":{"type":"DROPDOWN","options":{"values":["WHITE","GREEN","AMBER","RED"]}},"defaultValue":"AMBER","description":"Traffic Light Protocol sharing level of the observable. Maps to Cortex tlp 0-3."}
   * @paramDef {"type":"String","label":"PAP","name":"pap","uiComponent":{"type":"DROPDOWN","options":{"values":["WHITE","GREEN","AMBER","RED"]}},"defaultValue":"AMBER","description":"Permissible Actions Protocol level of the observable. Maps to Cortex pap 0-3."}
   * @paramDef {"type":"String","label":"Message","name":"message","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional context or note attached to the analysis job."}
   * @paramDef {"type":"Object","label":"Parameters","name":"parameters","description":"Optional analyzer-specific parameters as a key/value object."}
   *
   * @returns {Object}
   * @sampleResult {"id":"AWNei4vH3rJ8unegCPB9","analyzerDefinitionId":"Abuse_Finder_2_0","analyzerId":"220483fde9608c580fb6a2508ff3d2d3","analyzerName":"Abuse_Finder_2_0","status":"Waiting","data":"8.8.8.8","dataType":"ip","tlp":2,"organization":"demo","createdAt":1526299593633,"createdBy":"demo"}
   */
  async runAnalyzer(id, data, dataType, tlp, pap, message, parameters) {
    const logTag = '[runAnalyzer]'

    const body = clean({
      data,
      dataType: this.#resolveChoice(dataType, DATA_TYPE_MAP),
      tlp: this.#resolveChoice(tlp, TLP_MAP),
      pap: this.#resolveChoice(pap, PAP_MAP),
      message,
      parameters: parameters || {},
    })

    return await this.#apiRequest({
      logTag,
      url: `${ this.#apiBase() }/analyzer/${ encodeURIComponent(id) }/run`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Get Job
   * @category Run Analysis
   * @description Retrieves the current state of an analysis job by its id, including its status (Waiting, InProgress, Success or Failure) and metadata such as the analyzer used, observable, timestamps and organization. This returns job status only — use Get Job Report to obtain the analysis results.
   * @route GET /jobs
   *
   * @paramDef {"type":"String","label":"Job ID","name":"id","required":true,"description":"The id of the analysis job to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"AWNei4vH3rJ8unegCPB9","analyzerName":"Abuse_Finder_2_0","status":"Success","data":"8.8.8.8","dataType":"ip","tlp":2,"createdAt":1526299593633,"startDate":1526299593923,"endDate":1526299597064}
   */
  async getJob(id) {
    const logTag = '[getJob]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.#apiBase() }/job/${ encodeURIComponent(id) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Job Report
   * @category Run Analysis
   * @description Retrieves the full report for an analysis job. If the job has finished, the response includes the job metadata plus a report object containing the analyzer's structured "full" output, a "summary" with taxonomies (level, namespace, predicate, value) and any generated artifacts (observables extracted from the analysis). If the job is still running, the report reflects its in-progress status. Use Wait for Job Report if you want to block until the report is ready.
   * @route GET /jobs/report
   *
   * @paramDef {"type":"String","label":"Job ID","name":"id","required":true,"description":"The id of the analysis job whose report to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"AWNei4vH3rJ8unegCPB9","analyzerName":"Abuse_Finder_2_0","status":"Success","data":"8.8.8.8","dataType":"ip","report":{"summary":{"taxonomies":[{"level":"info","namespace":"Abuse_Finder","predicate":"Address","value":"network-abuse@google.com"}]},"full":{"abuse_finder":{"abuse":["network-abuse@google.com"]}},"artifacts":[]}}
   */
  async getJobReport(id) {
    const logTag = '[getJobReport]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.#apiBase() }/job/${ encodeURIComponent(id) }/report`,
      method: 'get',
    })
  }

  /**
   * @operationName Wait for Job Report
   * @category Run Analysis
   * @description Blocks until an analysis job completes (or the timeout elapses) and returns its report in a single call. This is the convenient way to run a synchronous enrichment flow: run an analyzer, then wait for its report. The wait timeout is capped at one minute per request; if the analyzer is still running when the timeout is reached, the job's current (in-progress) state is returned, so long-running analyzers may need a follow-up Get Job Report call.
   * @route GET /jobs/waitreport
   *
   * @paramDef {"type":"String","label":"Job ID","name":"id","required":true,"description":"The id of the analysis job to wait on."}
   *
   * @returns {Object}
   * @sampleResult {"id":"AWNei4vH3rJ8unegCPB9","analyzerName":"Abuse_Finder_2_0","status":"Success","data":"8.8.8.8","dataType":"ip","report":{"summary":{"taxonomies":[{"level":"info","namespace":"Abuse_Finder","predicate":"Address","value":"network-abuse@google.com"}]},"full":{"abuse_finder":{"abuse":["network-abuse@google.com"]}},"artifacts":[]}}
   */
  async waitForJobReport(id) {
    const logTag = '[waitForJobReport]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.#apiBase() }/job/${ encodeURIComponent(id) }/waitreport`,
      method: 'get',
      query: { atMost: '1minute' },
    })
  }

  /**
   * @operationName List Jobs
   * @category Run Analysis
   * @description Lists analysis and responder jobs run in your Cortex organization, most recent first. Each entry includes the job id, status, analyzer/responder used, observable and timestamps. Use this to review recent analysis history or to locate a job id.
   * @route GET /jobs/list
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"AWNei4vH3rJ8unegCPB9","analyzerName":"Abuse_Finder_2_0","status":"Success","data":"8.8.8.8","dataType":"ip","createdAt":1526299593633,"endDate":1526299597064}]
   */
  async listJobs() {
    const logTag = '[listJobs]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.#apiBase() }/job`,
      method: 'get',
    })
  }

  /**
   * @operationName Delete Job
   * @category Run Analysis
   * @description Deletes an analysis job and its report from Cortex by id. This permanently removes the job record; the operation cannot be undone. Returns no content on success.
   * @route DELETE /jobs/{id}
   *
   * @paramDef {"type":"String","label":"Job ID","name":"id","required":true,"description":"The id of the analysis job to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":"AWNei4vH3rJ8unegCPB9"}
   */
  async deleteJob(id) {
    const logTag = '[deleteJob]'

    await this.#apiRequest({
      logTag,
      url: `${ this.#apiBase() }/job/${ encodeURIComponent(id) }`,
      method: 'delete',
    })

    return { success: true, id }
  }

  /* ---------------------------------------------------------------------------
   * Responders
   * ------------------------------------------------------------------------- */

  /**
   * @operationName List Responders
   * @category Responders
   * @description Lists all responders enabled in your Cortex organization. Responders are workers that take an active action in response to an observable or entity (for example blocking an IP, sending a notification, or creating a ticket) rather than just enriching it. Each entry includes the responder id, name, version, description and accepted dataTypes. Use this to discover responders before running one.
   * @route GET /responders
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"a1b2c3d4e5f6","name":"Mailer_1_0","version":"1.0","description":"Send a notification email","dataTypeList":["thehive:case","mail"]}]
   */
  async listResponders() {
    const logTag = '[listResponders]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.#apiBase() }/responder`,
      method: 'get',
    })
  }

  /**
   * @operationName Run Responder
   * @category Responders
   * @description Runs a responder against a value-based observable and returns the created responder job immediately. The job runs asynchronously — track it with Get Responder Job. TLP accepts a friendly label that maps to a Cortex numeric code (WHITE=0, GREEN=1, AMBER=2, RED=3). Use this to trigger an active response such as sending a notification or blocking an indicator.
   * @route POST /responder/{id}/run
   *
   * @paramDef {"type":"String","label":"Responder ID","name":"id","required":true,"description":"The id of the responder to run. Obtain it from List Responders."}
   * @paramDef {"type":"String","label":"Observable Value","name":"data","required":true,"description":"The observable or value the responder should act on."}
   * @paramDef {"type":"String","label":"Data Type","name":"dataType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["IP","Domain","FQDN","URL","Hash","Mail","Other"]}},"description":"The type of the observable value the responder acts on."}
   * @paramDef {"type":"String","label":"TLP","name":"tlp","uiComponent":{"type":"DROPDOWN","options":{"values":["WHITE","GREEN","AMBER","RED"]}},"defaultValue":"AMBER","description":"Traffic Light Protocol sharing level. Maps to Cortex tlp 0-3."}
   * @paramDef {"type":"String","label":"Message","name":"message","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional context or note passed to the responder."}
   *
   * @returns {Object}
   * @sampleResult {"id":"BWNei4vH3rJ8unegCPB9","responderId":"a1b2c3d4e5f6","responderName":"Mailer_1_0","status":"Waiting","data":"analyst@example.com","dataType":"mail","tlp":2,"createdAt":1526299593633}
   */
  async runResponder(id, data, dataType, tlp, message) {
    const logTag = '[runResponder]'

    const body = clean({
      data,
      dataType: this.#resolveChoice(dataType, DATA_TYPE_MAP),
      tlp: this.#resolveChoice(tlp, TLP_MAP),
      message,
    })

    return await this.#apiRequest({
      logTag,
      url: `${ this.#apiBase() }/responder/${ encodeURIComponent(id) }/run`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Get Responder Job
   * @category Responders
   * @description Retrieves the current state of a responder job by its id, including its status (Waiting, InProgress, Success or Failure) and the action's output. Use this to confirm whether a responder action completed successfully.
   * @route GET /responder/jobs
   *
   * @paramDef {"type":"String","label":"Job ID","name":"id","required":true,"description":"The id of the responder job to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"BWNei4vH3rJ8unegCPB9","responderName":"Mailer_1_0","status":"Success","data":"analyst@example.com","dataType":"mail","createdAt":1526299593633,"endDate":1526299597064}
   */
  async getResponderJob(id) {
    const logTag = '[getResponderJob]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.#apiBase() }/job/${ encodeURIComponent(id) }`,
      method: 'get',
    })
  }

  /* ---------------------------------------------------------------------------
   * Dictionaries
   * ------------------------------------------------------------------------- */

  /**
   * @typedef {Object} getAnalyzersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter analyzers by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused; Cortex returns all enabled analyzers in one call)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Analyzers Dictionary
   * @description Lists enabled analyzers for selection in dependent parameters, returning each analyzer's name as the label and its id as the value. Supports an optional name search filter.
   * @route POST /analyzers-dictionary
   *
   * @paramDef {"type":"getAnalyzersDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Abuse_Finder_2_0","value":"220483fde9608c580fb6a2508ff3d2d3","note":"2.0"}]}
   */
  async getAnalyzersDictionary(payload) {
    const logTag = '[getAnalyzersDictionary]'
    const { search } = payload || {}

    const analyzers = await this.#apiRequest({
      logTag,
      url: `${ this.#apiBase() }/analyzer`,
      method: 'get',
    })

    const list = Array.isArray(analyzers) ? analyzers : []
    const term = (search || '').toString().trim().toLowerCase()

    const items = list
      .filter(analyzer => !term || (analyzer?.name || '').toLowerCase().includes(term))
      .map(analyzer => ({
        label: analyzer?.name || analyzer?.id,
        value: analyzer?.id,
        note: analyzer?.version ? `v${ analyzer.version }` : undefined,
      }))

    return { items }
  }
}

Flowrunner.ServerCode.addService(CortexService, [
  {
    name: 'url',
    displayName: 'Instance URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Cortex URL, e.g. https://cortex.example.com (any trailing slash is stripped automatically). The API is called at {url}/api.',
  },
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'A Cortex API key sent as a Bearer token. Create one under Cortex -> Organization -> Users -> create a user and generate an API key.',
  },
])
