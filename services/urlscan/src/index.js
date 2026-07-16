const logger = {
  info: (...args) => console.log('[urlscan.io] info:', ...args),
  debug: (...args) => console.log('[urlscan.io] debug:', ...args),
  error: (...args) => console.log('[urlscan.io] error:', ...args),
  warn: (...args) => console.log('[urlscan.io] warn:', ...args),
}

const API_BASE_URL = 'https://urlscan.io/api/v1'
const SITE_BASE_URL = 'https://urlscan.io'

const DEFAULT_SEARCH_SIZE = 100
const WAIT_TIMEOUT_SECONDS = 40
const WAIT_INITIAL_DELAY_MS = 8000
const WAIT_POLL_INTERVAL_MS = 5000

const VISIBILITY_MAP = { Public: 'public', Unlisted: 'unlisted', Private: 'private' }

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

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * @usesFileStorage
 * @integrationName urlscan.io
 * @integrationIcon /icon.png
 */
class UrlscanService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery || {}) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'API-Key': this.apiKey,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const status = error.status || error.statusCode
      const errBody = error.body || {}
      const parts = [errBody.message, errBody.description].filter(Boolean)
      let message = parts.join(' - ') || error.message

      if (status === 429) {
        message = `Rate limit exceeded (HTTP 429). ${ message || '' } Respect the X-Rate-Limit-* response headers and back off before retrying.`
      }

      logger.error(`${ logTag } - failed (status ${ status }): ${ message }`)

      const wrapped = new Error(`urlscan.io API error: ${ message }`)
      wrapped.status = status
      throw wrapped
    }
  }

  /**
   * @operationName Submit Scan
   * @category Scanning
   * @description Submits a URL to urlscan.io for scanning and returns immediately with a scan UUID and result links. The scan itself runs asynchronously: results are NOT available in this response. Wait 10-30 seconds after submitting, then call Get Scan Result with the returned uuid (it returns HTTP 404 until the scan finishes). To submit and retrieve the finished result in a single step, use Scan and Wait instead. Visibility controls who can see the scan: Public scans appear in the community feed and search; Unlisted scans are hidden from the feed but accessible by link; Private scans are only visible to your account. Optionally supply tags (max 10), a custom User-Agent, an HTTP referer to send, and a two-letter ISO country code for the scan location.
   * @route POST /scan
   * @appearanceColor #E85C4A #F07A6A
   *
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"The URL to scan, including scheme (e.g. https://example.com)."}
   * @paramDef {"type":"String","label":"Visibility","name":"visibility","uiComponent":{"type":"DROPDOWN","options":{"values":["Public","Unlisted","Private"]}},"description":"Who can see this scan. Defaults to your account's configured default when omitted."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Optional user-defined tags to attach to the scan (max 10)."}
   * @paramDef {"type":"String","label":"Custom User-Agent","name":"customagent","description":"Optional User-Agent string to send when loading the page."}
   * @paramDef {"type":"String","label":"Referer","name":"referer","description":"Optional HTTP Referer header to send when loading the page."}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"Optional two-letter ISO-3166-1 country code selecting the scan location (e.g. us, de, jp)."}
   *
   * @returns {Object}
   * @sampleResult {"message":"Submission successful","uuid":"0e37e828-a9d9-45c0-ac50-1ca579b86c72","result":"https://urlscan.io/result/0e37e828-a9d9-45c0-ac50-1ca579b86c72/","api":"https://urlscan.io/api/v1/result/0e37e828-a9d9-45c0-ac50-1ca579b86c72/","visibility":"public","options":{"useragent":"Mozilla/5.0"},"url":"https://example.com","country":"de"}
   */
  async submitScan(url, visibility, tags, customagent, referer, country) {
    const logTag = '[submitScan]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/scan/`,
      method: 'post',
      body: clean({
        url,
        visibility: this.#resolveChoice(visibility, VISIBILITY_MAP),
        tags: Array.isArray(tags) && tags.length ? tags : undefined,
        customagent,
        referer,
        country,
      }),
    })
  }

  /**
   * @operationName Get Scan Result
   * @category Scanning
   * @description Retrieves the full analysis for a previously submitted scan by its UUID. Results take roughly 10-30 seconds to become available after submission; until the scan finishes this endpoint returns HTTP 404 (surfaced here as a "not ready" error), so submit first, wait, then fetch. A deleted scan returns HTTP 410. The result includes page metadata, request/response lists, contacted domains and IPs, detected technologies, verdicts, screenshot and DOM links, and overall statistics. For a one-step submit-and-retrieve, use Scan and Wait.
   * @route GET /result
   * @appearanceColor #E85C4A #F07A6A
   *
   * @paramDef {"type":"String","label":"Scan UUID","name":"uuid","required":true,"description":"The scan UUID returned by Submit Scan."}
   *
   * @returns {Object}
   * @sampleResult {"task":{"uuid":"0e37e828-a9d9-45c0-ac50-1ca579b86c72","url":"https://example.com","visibility":"public","time":"2026-07-14T12:00:00.000Z"},"page":{"url":"https://example.com/","domain":"example.com","ip":"93.184.216.34","country":"US","server":"ECS"},"stats":{"requests":12,"uniqIPs":4,"malicious":0},"verdicts":{"overall":{"score":0,"malicious":false}},"lists":{"ips":["93.184.216.34"],"domains":["example.com"]}}
   */
  async getScanResult(uuid) {
    const logTag = '[getScanResult]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/result/${ encodeURIComponent(uuid) }/`,
      method: 'get',
    })
  }

  /**
   * @operationName Scan and Wait
   * @category Scanning
   * @description Convenience operation that submits a URL for scanning and then polls for the finished result in a single call. It waits ~8 seconds after submission, then polls every 5 seconds until the result is ready (HTTP 200) or a ~40 second timeout is reached. On success it returns the full scan result plus the scan uuid. If the scan has not completed within the timeout, it returns the submission details with ready=false and the uuid so you can fetch the result later with Get Scan Result. Visibility and the other options behave exactly as in Submit Scan.
   * @route POST /scan-and-wait
   * @appearanceColor #E85C4A #F07A6A
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"The URL to scan, including scheme (e.g. https://example.com)."}
   * @paramDef {"type":"String","label":"Visibility","name":"visibility","uiComponent":{"type":"DROPDOWN","options":{"values":["Public","Unlisted","Private"]}},"description":"Who can see this scan. Defaults to your account's configured default when omitted."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Optional user-defined tags to attach to the scan (max 10)."}
   * @paramDef {"type":"String","label":"Custom User-Agent","name":"customagent","description":"Optional User-Agent string to send when loading the page."}
   * @paramDef {"type":"String","label":"Referer","name":"referer","description":"Optional HTTP Referer header to send when loading the page."}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"Optional two-letter ISO-3166-1 country code selecting the scan location (e.g. us, de, jp)."}
   *
   * @returns {Object}
   * @sampleResult {"ready":true,"uuid":"0e37e828-a9d9-45c0-ac50-1ca579b86c72","result":{"task":{"uuid":"0e37e828-a9d9-45c0-ac50-1ca579b86c72","url":"https://example.com"},"page":{"domain":"example.com","ip":"93.184.216.34"},"verdicts":{"overall":{"malicious":false}}}}
   */
  async scanAndWait(url, visibility, tags, customagent, referer, country) {
    const logTag = '[scanAndWait]'

    const submission = await this.submitScan(url, visibility, tags, customagent, referer, country)
    const uuid = submission.uuid

    const deadline = Date.now() + WAIT_TIMEOUT_SECONDS * 1000

    await delay(WAIT_INITIAL_DELAY_MS)

    while (Date.now() < deadline) {
      try {
        const result = await this.getScanResult(uuid)

        return { ready: true, uuid, result }
      } catch (error) {
        if (error.status && error.status !== 404) {
          throw error
        }

        logger.debug(`${ logTag } - scan ${ uuid } not ready yet, retrying`)
      }

      await delay(WAIT_POLL_INTERVAL_MS)
    }

    logger.warn(`${ logTag } - scan ${ uuid } did not complete within ${ WAIT_TIMEOUT_SECONDS }s`)

    return { ready: false, uuid, submission }
  }

  /**
   * @operationName Search Scans
   * @category Search
   * @description Searches urlscan.io's database of historical scans using ElasticSearch query string syntax. The query (q) supports field filters such as domain:example.com, page.url:"...", ip:1.2.3.4, filename:*.exe, hash:<sha256>, and boolean operators (AND, OR, NOT). Returns public scans plus your own unlisted and private scans. Use size to control how many results are returned and search_after (the sort value from the last result of a previous page) for pagination.
   * @route GET /search
   * @appearanceColor #E85C4A #F07A6A
   *
   * @paramDef {"type":"String","label":"Query","name":"q","required":true,"description":"ElasticSearch query string, e.g. domain:example.com, page.url:\"login\", ip:1.2.3.4, filename:*.exe, hash:<sha256>."}
   * @paramDef {"type":"Number","label":"Size","name":"size","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results to return (default 100; maximum depends on your subscription)."}
   * @paramDef {"type":"String","label":"Search After","name":"search_after","description":"Pagination cursor: the comma-separated sort value from the last result of the previous page."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"_id":"0e37e828-a9d9-45c0-ac50-1ca579b86c72","task":{"url":"https://example.com","time":"2026-07-14T12:00:00.000Z"},"page":{"domain":"example.com","ip":"93.184.216.34"},"sort":[1720958400000,"0e37e828"]}],"total":1,"has_more":false}
   */
  async searchScans(q, size, search_after) {
    const logTag = '[searchScans]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/search/`,
      method: 'get',
      query: {
        q,
        size: size || DEFAULT_SEARCH_SIZE,
        search_after,
      },
    })
  }

  /**
   * @operationName Get Screenshot
   * @category Artifacts
   * @description Downloads the full-page screenshot (PNG) captured for a completed scan and stores it in FlowRunner file storage, returning a downloadable URL. The screenshot is only available after the scan has finished; if it has not been stored yet this returns a "not available" error. Provide the scan UUID from Submit Scan or a search result.
   * @route GET /screenshot
   * @appearanceColor #E85C4A #F07A6A
   *
   * @paramDef {"type":"String","label":"Scan UUID","name":"uuid","required":true,"description":"The scan UUID whose screenshot should be downloaded."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"],"description":"Optional file storage settings (scope: FLOW, WORKSPACE, or EXECUTION)."}
   *
   * @returns {Object}
   * @sampleResult {"uuid":"0e37e828-a9d9-45c0-ac50-1ca579b86c72","url":"https://files.flowrunner.io/urlscan_0e37e828.png","filename":"urlscan_0e37e828-a9d9-45c0-ac50-1ca579b86c72.png"}
   */
  async getScreenshot(uuid, fileOptions) {
    const logTag = '[getScreenshot]'
    const url = `${ SITE_BASE_URL }/screenshots/${ encodeURIComponent(uuid) }.png`

    let bytes

    try {
      logger.debug(`${ logTag } - [GET::${ url }]`)
      bytes = await Flowrunner.Request.get(url).set({ 'API-Key': this.apiKey }).setEncoding(null)
    } catch (error) {
      const status = error.status || error.statusCode

      if (status === 404) {
        throw new Error(`urlscan.io API error: Screenshot for scan ${ uuid } is not available yet. Wait for the scan to complete before downloading.`)
      }

      throw new Error(`urlscan.io API error: ${ error.body?.message || error.message }`)
    }

    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    const filename = `urlscan_${ uuid }.png`

    const uploaded = await this.flowrunner.Files.uploadFile(buffer, {
      filename,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return { uuid, url: uploaded.url, filename }
  }

  /**
   * @operationName Get DOM Snapshot
   * @category Artifacts
   * @description Returns the raw DOM snapshot (rendered HTML) captured for a completed scan as text. Useful for inspecting the final page content, injected scripts, and form markup. The snapshot is only available after the scan has finished; if it has not been stored yet this returns a "not available" error. Provide the scan UUID from Submit Scan or a search result.
   * @route GET /dom
   * @appearanceColor #E85C4A #F07A6A
   *
   * @paramDef {"type":"String","label":"Scan UUID","name":"uuid","required":true,"description":"The scan UUID whose DOM snapshot should be retrieved."}
   *
   * @returns {Object}
   * @sampleResult {"uuid":"0e37e828-a9d9-45c0-ac50-1ca579b86c72","dom":"<!DOCTYPE html><html><head><title>Example Domain</title></head><body>...</body></html>"}
   */
  async getDomSnapshot(uuid) {
    const logTag = '[getDomSnapshot]'
    const url = `${ SITE_BASE_URL }/dom/${ encodeURIComponent(uuid) }/`

    try {
      logger.debug(`${ logTag } - [GET::${ url }]`)
      const dom = await Flowrunner.Request.get(url).set({ 'API-Key': this.apiKey })

      return { uuid, dom: typeof dom === 'string' ? dom : JSON.stringify(dom) }
    } catch (error) {
      const status = error.status || error.statusCode

      if (status === 404) {
        throw new Error(`urlscan.io API error: DOM snapshot for scan ${ uuid } is not available yet. Wait for the scan to complete before retrieving it.`)
      }

      throw new Error(`urlscan.io API error: ${ error.body?.message || error.message }`)
    }
  }

  /**
   * @operationName Get Live Screenshot
   * @category Artifacts
   * @description Captures a live screenshot of any URL on demand (independent of a scan) and stores it in FlowRunner file storage, returning a downloadable URL. This uses urlscan.io's liveshot service to render the page immediately rather than reading a stored scan artifact. Useful for a quick visual preview without submitting a full scan.
   * @route POST /liveshot
   * @appearanceColor #E85C4A #F07A6A
   *
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"The URL to capture a live screenshot of, including scheme (e.g. https://example.com)."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"],"description":"Optional file storage settings (scope: FLOW, WORKSPACE, or EXECUTION)."}
   *
   * @returns {Object}
   * @sampleResult {"url":"https://files.flowrunner.io/liveshot_1720958400000.png","filename":"liveshot_1720958400000.png"}
   */
  async getLiveScreenshot(url, fileOptions) {
    const logTag = '[getLiveScreenshot]'
    const liveshotUrl = `${ SITE_BASE_URL }/liveshot/?url=${ encodeURIComponent(url) }`

    let bytes

    try {
      logger.debug(`${ logTag } - [GET::${ liveshotUrl }]`)
      bytes = await Flowrunner.Request.get(liveshotUrl).set({ 'API-Key': this.apiKey }).setEncoding(null)
    } catch (error) {
      throw new Error(`urlscan.io API error: ${ error.body?.message || error.message }`)
    }

    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    const filename = `liveshot_${ Date.now() }.png`

    const uploaded = await this.flowrunner.Files.uploadFile(buffer, {
      filename,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return { url: uploaded.url, filename }
  }

  /**
   * @operationName Get Quotas
   * @category Account
   * @description Returns your account's API quota and current usage for each action (such as scanning, searching, and result retrieval), broken down by rate-limit window (minute, hour, day). Use this to check remaining capacity before running batches. Also serves as a connection check: a successful response confirms the API key is valid.
   * @route GET /quotas
   * @appearanceColor #E85C4A #F07A6A
   *
   * @returns {Object}
   * @sampleResult {"limits":{"public":{"day":{"limit":1000,"used":12,"remaining":988},"hour":{"limit":100,"used":3,"remaining":97}},"search":{"day":{"limit":1000,"used":5,"remaining":995}}}}
   */
  async getQuotas() {
    const logTag = '[getQuotas]'

    return await this.#apiRequest({
      logTag,
      url: `${ SITE_BASE_URL }/user/quotas/`,
      method: 'get',
    })
  }
}

Flowrunner.ServerCode.addService(UrlscanService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your urlscan.io API key, sent as the API-Key header. Get it from urlscan.io -> Settings & API -> API key.',
  },
])
