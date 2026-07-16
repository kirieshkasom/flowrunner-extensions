const logger = {
  info: (...args) => console.log('[Splunk] info:', ...args),
  debug: (...args) => console.log('[Splunk] debug:', ...args),
  error: (...args) => console.log('[Splunk] error:', ...args),
  warn: (...args) => console.log('[Splunk] warn:', ...args),
}

/**
 * Removes undefined, null and empty-string values so we never send blank
 * query params or body fields to Splunk.
 */
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
 * @integrationName Splunk
 * @integrationIcon /icon.svg
 */
class SplunkService {
  constructor(config) {
    this.managementUrl = (config.managementUrl || '').replace(/\/+$/, '')
    this.authToken = config.authToken
    this.hecUrl = (config.hecUrl || '').replace(/\/+$/, '')
    this.hecToken = config.hecToken
  }

  /**
   * Single entry point for all Splunk management (REST) API calls. Adds the
   * Bearer auth header and forces output_mode=json so Splunk returns JSON
   * instead of its default XML. Splunk error bodies look like
   * { messages: [{ type, text }] } — those are joined and surfaced.
   */
  async #restRequest({ path, method = 'get', body, query, form, logTag }) {
    const url = `${ this.managementUrl }${ path }`

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ 'Authorization': `Bearer ${ this.authToken }` })
        .query(clean({ output_mode: 'json', ...(query || {}) }))

      if (form !== undefined) {
        return await request
          .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
          .send(clean(form))
      }

      if (body !== undefined) {
        return await request.set({ 'Content-Type': 'application/json' }).send(body)
      }

      return await request
    } catch (error) {
      throw this.#toError(error, logTag)
    }
  }

  /**
   * Sends an event to the HTTP Event Collector. HEC uses a different host and a
   * different auth scheme (Authorization: Splunk <hecToken>) than the REST API.
   */
  async #hecRequest({ path, body, query, logTag }) {
    if (!this.hecUrl || !this.hecToken) {
      throw new Error('Splunk API error: HEC URL and HEC Token must be configured to send events.')
    }

    const url = `${ this.hecUrl }${ path }`

    try {
      logger.debug(`${ logTag } - [POST::${ url }]`)

      return await Flowrunner.Request.post(url)
        .set({ 'Authorization': `Splunk ${ this.hecToken }`, 'Content-Type': 'application/json' })
        .query(clean(query || {}))
        .send(body)
    } catch (error) {
      throw this.#toError(error, logTag)
    }
  }

  /**
   * Normalizes a Splunk error into a single thrown Error. Splunk returns
   * { messages: [{ type, text }] } (REST) or { text, code } (HEC).
   */
  #toError(error, logTag) {
    const responseBody = error.body
    let detail

    if (responseBody && Array.isArray(responseBody.messages) && responseBody.messages.length) {
      detail = responseBody.messages.map(message => message.text).filter(Boolean).join('; ')
    } else if (responseBody && responseBody.text) {
      detail = responseBody.text
    } else {
      detail = error.message
    }

    const status = error.status || error.statusCode
    const message = status ? `${ detail } (status ${ status })` : detail

    logger.error(`${ logTag } - failed: ${ message }`)

    return new Error(`Splunk API error: ${ message }`)
  }

  /**
   * @operationName Create Search Job
   * @category Search
   * @description Starts an asynchronous Splunk search job and returns its search ID (sid). The search string must be a valid SPL query and, unless it begins with a generating command (such as tstats, metadata, inputlookup, or a leading pipe), it must start with "search " — for example "search index=main error". This is the first step of the standard search flow: create the job here, poll Get Search Job Status until isDone is true, then call Get Search Results with the sid. For quick, small searches consider Run Oneshot Search instead, which returns results in a single call.
   * @route POST /search/jobs
   * @paramDef {"type":"String","label":"Search Query (SPL)","name":"search","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The SPL to run, e.g. \"search index=main sourcetype=access_combined status=500 | stats count by uri\". Must start with \"search \" unless it begins with a generating command."}
   * @paramDef {"type":"String","label":"Earliest Time","name":"earliestTime","description":"Start of the search time range. Accepts a relative modifier (e.g. -24h, -7d@d) or an epoch/ISO timestamp. Optional; if omitted the search default is used."}
   * @paramDef {"type":"String","label":"Latest Time","name":"latestTime","description":"End of the search time range. Accepts a relative modifier (e.g. now, @d) or an epoch/ISO timestamp. Optional."}
   * @paramDef {"type":"String","label":"Execution Mode","name":"execMode","defaultValue":"Normal (async)","uiComponent":{"type":"DROPDOWN","options":{"values":["Normal (async)","Blocking (wait for completion)"]}},"description":"Normal returns the sid immediately and runs the job in the background. Blocking waits until the job finishes before returning. Defaults to Normal."}
   * @returns {Object}
   * @sampleResult {"sid":"1720000000.123","messages":[]}
   */
  async createSearchJob(search, earliestTime, latestTime, execMode) {
    const logTag = '[createSearchJob]'

    return await this.#restRequest({
      logTag,
      path: '/services/search/jobs',
      method: 'post',
      form: {
        search,
        earliest_time: earliestTime,
        latest_time: latestTime,
        exec_mode: this.#resolveChoice(execMode, {
          'Normal (async)': 'normal',
          'Blocking (wait for completion)': 'blocking',
        }) || 'normal',
      },
    })
  }

  /**
   * @operationName Get Search Job Status
   * @category Search
   * @description Retrieves the current status of a search job by its search ID (sid). Poll this after Create Search Job and inspect the job's dispatchState and isDone properties: when isDone is 1 the results are ready to fetch with Get Search Results. Also returns useful metadata such as eventCount, resultCount, scanCount and doneProgress.
   * @route GET /search/jobs/{sid}
   * @paramDef {"type":"String","label":"Search Job ID (sid)","name":"sid","required":true,"description":"The search ID returned by Create Search Job."}
   * @returns {Object}
   * @sampleResult {"entry":[{"name":"1720000000.123","content":{"dispatchState":"DONE","isDone":true,"isFailed":false,"doneProgress":1,"eventCount":42,"resultCount":42,"scanCount":42}}]}
   */
  async getSearchJobStatus(sid) {
    const logTag = '[getSearchJobStatus]'

    return await this.#restRequest({
      logTag,
      path: `/services/search/jobs/${ encodeURIComponent(sid) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Search Results
   * @category Search
   * @description Returns the results of a completed search job by its search ID (sid). Only call this once Get Search Job Status reports isDone; results for a still-running job may be empty or partial. Use count and offset to page through large result sets (count 0 returns all available results). Results come back as an array of row objects under the "results" key.
   * @route GET /search/jobs/{sid}/results
   * @paramDef {"type":"String","label":"Search Job ID (sid)","name":"sid","required":true,"description":"The search ID returned by Create Search Job."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of results to return. Use 0 to return all available results. Defaults to 100."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Index of the first result to return, for pagination. Defaults to 0."}
   * @returns {Object}
   * @sampleResult {"preview":false,"init_offset":0,"results":[{"_time":"2026-07-13T10:00:00.000+00:00","host":"web01","status":"500","count":"7"}],"fields":[{"name":"_time"},{"name":"host"},{"name":"status"},{"name":"count"}]}
   */
  async getSearchResults(sid, count, offset) {
    const logTag = '[getSearchResults]'

    return await this.#restRequest({
      logTag,
      path: `/services/search/jobs/${ encodeURIComponent(sid) }/results`,
      method: 'get',
      query: {
        count: count === undefined || count === null ? 100 : count,
        offset: offset || 0,
      },
    })
  }

  /**
   * @operationName Run Oneshot Search
   * @category Search
   * @description Runs a search synchronously and returns the results directly in a single call, without managing a job lifecycle. This is the simplest way to run a bounded search — internally it dispatches the job with exec_mode=oneshot. Best for small, fast, time-bounded searches; for long-running or very large searches use Create Search Job with the poll-and-fetch flow instead. The SPL must start with "search " unless it begins with a generating command.
   * @route POST /search/oneshot
   * @paramDef {"type":"String","label":"Search Query (SPL)","name":"search","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The SPL to run, e.g. \"search index=main error | head 100\". Must start with \"search \" unless it begins with a generating command."}
   * @paramDef {"type":"String","label":"Earliest Time","name":"earliestTime","description":"Start of the search time range (e.g. -1h, -24h@h, or an epoch/ISO timestamp). Optional."}
   * @paramDef {"type":"String","label":"Latest Time","name":"latestTime","description":"End of the search time range (e.g. now, @h, or an epoch/ISO timestamp). Optional."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of results to return. Use 0 for all. Defaults to 100."}
   * @returns {Object}
   * @sampleResult {"preview":false,"init_offset":0,"results":[{"_time":"2026-07-13T10:00:00.000+00:00","host":"web01","status":"500"}],"fields":[{"name":"_time"},{"name":"host"},{"name":"status"}]}
   */
  async runOneshotSearch(search, earliestTime, latestTime, count) {
    const logTag = '[runOneshotSearch]'

    return await this.#restRequest({
      logTag,
      path: '/services/search/jobs',
      method: 'post',
      query: { count: count === undefined || count === null ? 100 : count },
      form: {
        search,
        earliest_time: earliestTime,
        latest_time: latestTime,
        exec_mode: 'oneshot',
      },
    })
  }

  /**
   * @operationName Cancel Search Job
   * @category Search
   * @description Cancels a running search job and deletes it, freeing the resources it holds. Use this to stop a long-running job you no longer need or to clean up finished jobs. Applying a control action of "cancel" both stops and removes the job identified by its search ID (sid).
   * @route POST /search/jobs/{sid}/cancel
   * @paramDef {"type":"String","label":"Search Job ID (sid)","name":"sid","required":true,"description":"The search ID of the job to cancel and remove."}
   * @returns {Object}
   * @sampleResult {"messages":[{"type":"INFO","text":"Search job cancelled."}]}
   */
  async cancelSearchJob(sid) {
    const logTag = '[cancelSearchJob]'

    return await this.#restRequest({
      logTag,
      path: `/services/search/jobs/${ encodeURIComponent(sid) }/control`,
      method: 'post',
      form: { action: 'cancel' },
    })
  }

  /**
   * @operationName List Saved Searches
   * @category Saved Searches
   * @description Lists saved searches (including scheduled searches and alerts) available to the authenticated user. Returns each saved search's name and its configuration, including the underlying SPL, cron schedule and alert settings. Use count and offset to page through large collections.
   * @route GET /saved/searches
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of saved searches to return. Use 0 for all. Defaults to 30."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Index of the first saved search to return, for pagination. Defaults to 0."}
   * @returns {Object}
   * @sampleResult {"entry":[{"name":"Errors last 24h","content":{"search":"index=main error","cron_schedule":"0 * * * *","is_scheduled":true,"disabled":false}}]}
   */
  async listSavedSearches(count, offset) {
    const logTag = '[listSavedSearches]'

    return await this.#restRequest({
      logTag,
      path: '/services/saved/searches',
      method: 'get',
      query: {
        count: count === undefined || count === null ? 30 : count,
        offset: offset || 0,
      },
    })
  }

  /**
   * @operationName Get Saved Search
   * @category Saved Searches
   * @description Retrieves the full configuration of a single saved search by name, including its SPL query, time range, schedule and alert/action settings. Use the exact saved search name as it appears in Splunk.
   * @route GET /saved/searches/{name}
   * @paramDef {"type":"String","label":"Saved Search Name","name":"name","required":true,"description":"The exact name of the saved search, e.g. \"Errors last 24h\"."}
   * @returns {Object}
   * @sampleResult {"entry":[{"name":"Errors last 24h","content":{"search":"index=main error","dispatch.earliest_time":"-24h","cron_schedule":"0 * * * *","is_scheduled":true,"disabled":false}}]}
   */
  async getSavedSearch(name) {
    const logTag = '[getSavedSearch]'

    return await this.#restRequest({
      logTag,
      path: `/services/saved/searches/${ encodeURIComponent(name) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Run Saved Search
   * @category Saved Searches
   * @description Dispatches (runs) a saved search by name and returns the search ID (sid) of the job it creates. The saved search executes with its stored SPL and time range; poll Get Search Job Status with the returned sid and then fetch results with Get Search Results, just like a manually created job. Optionally override the time range for this run only.
   * @route POST /saved/searches/{name}/dispatch
   * @paramDef {"type":"String","label":"Saved Search Name","name":"name","required":true,"description":"The exact name of the saved search to run, e.g. \"Errors last 24h\"."}
   * @paramDef {"type":"String","label":"Earliest Time","name":"earliestTime","description":"Optional override for the start of the time range for this run (e.g. -1h). Leave empty to use the saved search's configured range."}
   * @paramDef {"type":"String","label":"Latest Time","name":"latestTime","description":"Optional override for the end of the time range for this run (e.g. now). Leave empty to use the saved search's configured range."}
   * @returns {Object}
   * @sampleResult {"sid":"scheduler__admin__search__RMD5abcdef_1720000000.456"}
   */
  async runSavedSearch(name, earliestTime, latestTime) {
    const logTag = '[runSavedSearch]'

    return await this.#restRequest({
      logTag,
      path: `/services/saved/searches/${ encodeURIComponent(name) }/dispatch`,
      method: 'post',
      form: {
        'dispatch.earliest_time': earliestTime,
        'dispatch.latest_time': latestTime,
      },
    })
  }

  /**
   * @operationName Send Event
   * @category HTTP Event Collector
   * @description Sends a single structured event to Splunk through the HTTP Event Collector (HEC). Requires the HEC URL and HEC Token config items to be set. The event payload can be a JSON object or a plain string; you may also set sourcetype, index, host and an explicit event time (epoch seconds). The target index and sourcetype must be permitted by the HEC token's configuration in Splunk.
   * @route POST /hec/event
   * @paramDef {"type":"String","label":"Event","name":"event","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The event data. Provide a JSON object as text (e.g. {\"action\":\"login\",\"user\":\"alice\"}) or a plain log line. JSON text is parsed and sent as a structured object."}
   * @paramDef {"type":"String","label":"Sourcetype","name":"sourcetype","description":"Sourcetype to assign to the event, e.g. \"_json\" or \"my:app:logs\". Optional."}
   * @paramDef {"type":"String","label":"Index","name":"index","description":"Target index for the event. Must be allowed by the HEC token. Optional."}
   * @paramDef {"type":"String","label":"Host","name":"host","description":"Host value to associate with the event. Optional."}
   * @paramDef {"type":"Number","label":"Event Time (epoch seconds)","name":"time","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Explicit event timestamp in epoch seconds. Optional; if omitted Splunk uses the receive time."}
   * @returns {Object}
   * @sampleResult {"text":"Success","code":0}
   */
  async sendEvent(event, sourcetype, index, host, time) {
    const logTag = '[sendEvent]'

    const body = clean({
      event: this.#parseMaybeJson(event),
      sourcetype,
      index,
      host,
      time,
    })

    return await this.#hecRequest({
      logTag,
      path: '/services/collector/event',
      body,
    })
  }

  /**
   * @operationName Send Raw Event
   * @category HTTP Event Collector
   * @description Sends raw, unstructured data to Splunk through the HTTP Event Collector (HEC) raw endpoint. The entire request body is ingested verbatim as one or more events (Splunk applies line-breaking and timestamp extraction per the sourcetype). Requires the HEC URL and HEC Token config items. Use sourcetype, index and host query parameters to control how the raw data is indexed.
   * @route POST /hec/raw
   * @paramDef {"type":"String","label":"Raw Data","name":"data","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The raw text to ingest. Sent verbatim; can be a single line or a multi-line block that Splunk will break into events."}
   * @paramDef {"type":"String","label":"Sourcetype","name":"sourcetype","description":"Sourcetype to apply to the raw data, controlling line-breaking and field extraction. Optional."}
   * @paramDef {"type":"String","label":"Index","name":"index","description":"Target index for the raw data. Must be allowed by the HEC token. Optional."}
   * @paramDef {"type":"String","label":"Host","name":"host","description":"Host value to associate with the ingested data. Optional."}
   * @returns {Object}
   * @sampleResult {"text":"Success","code":0}
   */
  async sendRawEvent(data, sourcetype, index, host) {
    const logTag = '[sendRawEvent]'

    if (!this.hecUrl || !this.hecToken) {
      throw new Error('Splunk API error: HEC URL and HEC Token must be configured to send events.')
    }

    const url = `${ this.hecUrl }/services/collector/raw`

    try {
      logger.debug(`${ logTag } - [POST::${ url }]`)

      return await Flowrunner.Request.post(url)
        .set({ 'Authorization': `Splunk ${ this.hecToken }`, 'Content-Type': 'text/plain' })
        .query(clean({ sourcetype, index, host }))
        .send(data)
    } catch (error) {
      throw this.#toError(error, logTag)
    }
  }

  /**
   * @operationName List Indexes
   * @category Indexes
   * @description Lists the data indexes configured on the Splunk instance, including internal indexes. Returns each index's name and configuration, such as its current event count, sizes, retention (frozenTimePeriodInSecs) and disabled state. Use count and offset to page through the collection.
   * @route GET /data/indexes
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of indexes to return. Use 0 for all. Defaults to 30."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Index of the first result to return, for pagination. Defaults to 0."}
   * @returns {Object}
   * @sampleResult {"entry":[{"name":"main","content":{"totalEventCount":123456,"currentDBSizeMB":512,"maxTotalDataSizeMB":500000,"frozenTimePeriodInSecs":188697600,"disabled":false}}]}
   */
  async listIndexes(count, offset) {
    const logTag = '[listIndexes]'

    return await this.#restRequest({
      logTag,
      path: '/services/data/indexes',
      method: 'get',
      query: {
        count: count === undefined || count === null ? 30 : count,
        offset: offset || 0,
      },
    })
  }

  /**
   * @operationName Get Index
   * @category Indexes
   * @description Retrieves the configuration and statistics of a single index by name, including its total event count, disk usage, retention policy and enabled/disabled state. Use the exact index name (e.g. "main", "_internal").
   * @route GET /data/indexes/{name}
   * @paramDef {"type":"String","label":"Index Name","name":"name","required":true,"description":"The exact name of the index, e.g. \"main\"."}
   * @returns {Object}
   * @sampleResult {"entry":[{"name":"main","content":{"totalEventCount":123456,"currentDBSizeMB":512,"maxTotalDataSizeMB":500000,"frozenTimePeriodInSecs":188697600,"disabled":false}}]}
   */
  async getIndex(name) {
    const logTag = '[getIndex]'

    return await this.#restRequest({
      logTag,
      path: `/services/data/indexes/${ encodeURIComponent(name) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Server Info
   * @category Server
   * @description Returns general information about the Splunk server, including its version, build, GUID, server name, roles, OS details and license state. Useful as a lightweight connection and authentication check for the management (REST) endpoint and Bearer token.
   * @route GET /server/info
   * @returns {Object}
   * @sampleResult {"entry":[{"name":"server-info","content":{"version":"9.2.1","build":"78803f08aabb","serverName":"splunk-host","guid":"ABCDEF01-2345-6789-ABCD-EF0123456789","os_name":"Linux","numberOfCores":8}}]}
   */
  async getServerInfo() {
    const logTag = '[getServerInfo]'

    return await this.#restRequest({
      logTag,
      path: '/services/server/info',
      method: 'get',
    })
  }

  /**
   * Maps a friendly dropdown label to the raw API value. Returns the value
   * unchanged when it is not present in the mapping (e.g. a free-typed value).
   */
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /**
   * Attempts to parse a string as JSON so structured events are sent as
   * objects; falls back to the original string for plain log lines.
   */
  #parseMaybeJson(value) {
    if (typeof value !== 'string') {
      return value
    }

    const trimmed = value.trim()

    if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) {
      return value
    }

    try {
      return JSON.parse(trimmed)
    } catch (error) {
      return value
    }
  }
}

Flowrunner.ServerCode.addService(SplunkService, [
  {
    name: 'managementUrl',
    displayName: 'Management URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Splunk management/REST endpoint, e.g. https://myhost:8089 (strip any trailing slash).',
  },
  {
    name: 'authToken',
    displayName: 'Auth Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Splunk -> Settings -> Tokens -> create a Bearer token (or an app token). Sent as Authorization: Bearer <token>.',
  },
  {
    name: 'hecUrl',
    displayName: 'HEC URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'HTTP Event Collector endpoint, e.g. https://myhost:8088 (strip any trailing slash). Only needed for Send Event / Send Raw Event.',
  },
  {
    name: 'hecToken',
    displayName: 'HEC Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'The HTTP Event Collector token value. Sent as Authorization: Splunk <token>. Only needed for Send Event / Send Raw Event.',
  },
])
