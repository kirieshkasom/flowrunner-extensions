const logger = {
  info: (...args) => console.log('[Jenkins] info:', ...args),
  debug: (...args) => console.log('[Jenkins] debug:', ...args),
  error: (...args) => console.log('[Jenkins] error:', ...args),
  warn: (...args) => console.log('[Jenkins] warn:', ...args),
}

/**
 * @integrationName Jenkins
 * @integrationIcon /icon.svg
 */
class JenkinsService {
  constructor(config) {
    this.baseUrl = (config.baseUrl || '').replace(/\/+$/, '')
    this.username = config.username
    this.apiToken = config.apiToken
    this.authHeader = `Basic ${ Buffer.from(`${ this.username }:${ this.apiToken }`).toString('base64') }`
    this.crumb = null
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  /**
   * Turns a job path like 'folder/sub/job' into '/job/folder/job/sub/job/job'.
   * Accepts a leading slash, extra slashes, or already-encoded segments.
   */
  #jobPath(path) {
    if (!path) {
      throw new Error('Jenkins API error: A job name or path is required.')
    }

    const segments = String(path)
      .split('/')
      .map(segment => segment.trim())
      .filter(Boolean)

    if (!segments.length) {
      throw new Error('Jenkins API error: A job name or path is required.')
    }

    return segments.map(segment => `/job/${ encodeURIComponent(segment) }`).join('')
  }

  /**
   * Fetches a CSRF crumb from Jenkins. Returns { field, value } or null when the
   * crumb issuer is disabled (Jenkins responds 404). The crumb is cached for the
   * lifetime of the instance.
   */
  async #getCrumb() {
    if (this.crumb !== null) {
      return this.crumb || null
    }

    try {
      const response = await Flowrunner.Request
        .get(`${ this.baseUrl }/crumbIssuer/api/json`)
        .set({ Authorization: this.authHeader, Accept: 'application/json' })

      if (response && response.crumb && response.crumbRequestField) {
        this.crumb = { field: response.crumbRequestField, value: response.crumb }

        return this.crumb
      }

      this.crumb = false

      return null
    } catch (error) {
      const status = error.status || error.statusCode

      // 404 => crumb issuer disabled; any other lookup failure should not block the request.
      logger.debug(`#getCrumb - crumb unavailable (status ${ status }); continuing without a crumb.`)
      this.crumb = false

      return null
    }
  }

  #buildError(error, logTag) {
    const status = error.status || error.statusCode
    let message = error.body?.message || error.message || 'Unknown error'

    // Jenkins frequently returns HTML error pages; keep the message readable.
    if (typeof message === 'string' && /<html|<!DOCTYPE/i.test(message)) {
      message = 'Jenkins returned an error page.'
    } else if (typeof message !== 'string') {
      message = JSON.stringify(message)
    }

    if (status) {
      message = `HTTP ${ status } - ${ message }`
    }

    if (status === 401 || status === 403) {
      message += ' Check that your username and API token are correct and, for write operations, that a CSRF crumb is being sent (403 often indicates a crumb/permission problem).'
    } else if (status === 404) {
      message += ' The requested job, build, or resource was not found - verify the job path (folders use forward slashes, e.g. folder/job).'
    }

    logger.error(`${ logTag } - failed: ${ message }`)

    return new Error(`Jenkins API error: ${ message }`)
  }

  /**
   * Single request helper for JSON/text/raw responses.
   * When rawResponse is true the full response object ({ headers, body, status })
   * is returned so callers can read response headers (e.g. Location, X-Jenkins).
   */
  async #apiRequest({ method = 'get', path, query, body, contentType, accept, logTag, rawResponse = false, isText = false }) {
    try {
      const url = `${ this.baseUrl }${ path }`

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const headers = { Authorization: this.authHeader }

      if (accept) {
        headers.Accept = accept
      }

      if (contentType) {
        headers['Content-Type'] = contentType
      }

      // Attach a CSRF crumb to write requests when the crumb issuer is enabled.
      if (method.toLowerCase() !== 'get') {
        const crumb = await this.#getCrumb()

        if (crumb) {
          headers[crumb.field] = crumb.value
        }
      }

      let request = Flowrunner.Request[method.toLowerCase()](url)
        .set(headers)
        .query(query || {})

      if (isText || rawResponse) {
        request = request.setEncoding(null).unwrapBody(false)
      }

      const response = body !== undefined ? await request.send(body) : await request

      if (rawResponse) {
        return response
      }

      if (isText) {
        const raw = response.body

        return Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw ?? '')
      }

      return response
    } catch (error) {
      throw this.#buildError(error, logTag)
    }
  }

  #jobUrl(name) {
    return `${ this.baseUrl }${ this.#jobPath(name) }/`
  }

  // ------------------------------------------------------------------
  // Jobs
  // ------------------------------------------------------------------

  /**
   * @operationName List Jobs
   * @category Jobs
   * @description Lists all top-level jobs on the Jenkins instance with their name, URL, and status color. The color encodes build status: blue (success), red (failure), yellow (unstable), and grey/notbuilt (never run); an "_anime" suffix (e.g. blue_anime) means a build is currently in progress. Jobs inside folders are not expanded here - open a folder job and use its nested path (e.g. folder/job) with Get Job.
   * @route GET /jobs
   * @paramDef {"type":"Boolean","label":"Include Sub-Folders","name":"includeFolders","uiComponent":{"type":"CHECKBOX"},"description":"When true, recursively lists jobs inside folders using Jenkins tree recursion (may be slow on large instances). Defaults to false."}
   * @returns {Object}
   * @sampleResult {"jobs":[{"name":"my-app-build","url":"https://jenkins.example.com/job/my-app-build/","color":"blue"},{"name":"nightly-tests","url":"https://jenkins.example.com/job/nightly-tests/","color":"red"}]}
   */
  async listJobs(includeFolders) {
    const tree = includeFolders
      ? 'jobs[name,url,color,jobs[name,url,color,jobs[name,url,color]]]'
      : 'jobs[name,url,color]'

    return await this.#apiRequest({
      logTag: '[listJobs]',
      method: 'get',
      path: '/api/json',
      query: { tree },
      accept: 'application/json',
    })
  }

  /**
   * @operationName Get Job
   * @category Jobs
   * @description Retrieves detailed information about a single job, including its description, whether it is buildable, recent builds, health report score, and pointers to the last build, last successful build, and last failed build. Use a folder path (e.g. folder/job) for jobs nested inside folders.
   * @route GET /job
   * @paramDef {"type":"String","label":"Job Path","name":"jobPath","required":true,"dictionary":"getJobsDictionary","description":"Job name, or folder path for nested jobs (e.g. my-folder/my-job). Select a top-level job from the list or type a path directly."}
   * @returns {Object}
   * @sampleResult {"name":"my-app-build","url":"https://jenkins.example.com/job/my-app-build/","buildable":true,"color":"blue","healthReport":[{"description":"Build stability: No recent builds failed.","score":100}],"lastBuild":{"number":42,"url":"https://jenkins.example.com/job/my-app-build/42/"},"lastSuccessfulBuild":{"number":42},"builds":[{"number":42},{"number":41}]}
   */
  async getJob(jobPath) {
    return await this.#apiRequest({
      logTag: '[getJob]',
      method: 'get',
      path: `${ this.#jobPath(jobPath) }/api/json`,
      accept: 'application/json',
    })
  }

  /**
   * @operationName Get Job Config
   * @category Jobs
   * @description Retrieves the raw config.xml definition of a job as XML text. Useful for backing up a job, inspecting its configuration, or supplying it to Create Job / Copy Job. Requires Job/Configure (extended read) permission.
   * @route GET /job/config
   * @paramDef {"type":"String","label":"Job Path","name":"jobPath","required":true,"dictionary":"getJobsDictionary","description":"Job name, or folder path for nested jobs (e.g. my-folder/my-job)."}
   * @returns {Object}
   * @sampleResult {"jobPath":"my-app-build","configXml":"<?xml version='1.1' encoding='UTF-8'?>\n<project>\n  <description></description>\n  <builders/>\n</project>"}
   */
  async getJobConfig(jobPath) {
    const configXml = await this.#apiRequest({
      logTag: '[getJobConfig]',
      method: 'get',
      path: `${ this.#jobPath(jobPath) }/config.xml`,
      accept: 'application/xml',
      isText: true,
    })

    return { jobPath, configXml }
  }

  /**
   * @operationName Create Job
   * @category Jobs
   * @description Creates a new job from a config.xml definition. The job is created at the top level unless a folder path is supplied. Provide a valid Jenkins config.xml as the body - you can obtain one from an existing job via Get Job Config. Fails if a job with the same name already exists.
   * @route POST /job/create
   * @paramDef {"type":"String","label":"Job Name","name":"name","required":true,"description":"Name for the new job. Must be unique within its parent."}
   * @paramDef {"type":"String","label":"Config XML","name":"configXml","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The complete config.xml definition for the new job. Typically obtained from Get Job Config of a similar job."}
   * @paramDef {"type":"String","label":"Folder Path","name":"folderPath","description":"Optional folder path to create the job inside (e.g. my-folder or my-folder/sub-folder). Leave empty to create at the top level."}
   * @returns {Object}
   * @sampleResult {"created":true,"name":"my-new-job","folderPath":null}
   */
  async createJob(name, configXml, folderPath) {
    const parentPath = folderPath ? this.#jobPath(folderPath) : ''

    await this.#apiRequest({
      logTag: '[createJob]',
      method: 'post',
      path: `${ parentPath }/createItem`,
      query: { name },
      body: configXml,
      contentType: 'application/xml',
    })

    return { created: true, name, folderPath: folderPath || null }
  }

  /**
   * @operationName Copy Job
   * @category Jobs
   * @description Creates a new job by copying an existing job's configuration. The new job is disabled by default in Jenkins after copying; use Enable Job to activate it. Both jobs live at the same level unless a folder path is supplied.
   * @route POST /job/copy
   * @paramDef {"type":"String","label":"New Job Name","name":"name","required":true,"description":"Name for the new (copied) job."}
   * @paramDef {"type":"String","label":"Source Job Name","name":"fromName","required":true,"description":"Name of the existing job to copy. This must be a job name within the same parent, not a full folder path."}
   * @paramDef {"type":"String","label":"Folder Path","name":"folderPath","description":"Optional folder path that contains the source job and will contain the copy (e.g. my-folder). Leave empty for top-level jobs."}
   * @returns {Object}
   * @sampleResult {"copied":true,"name":"my-app-build-copy","from":"my-app-build","folderPath":null}
   */
  async copyJob(name, fromName, folderPath) {
    const parentPath = folderPath ? this.#jobPath(folderPath) : ''

    await this.#apiRequest({
      logTag: '[copyJob]',
      method: 'post',
      path: `${ parentPath }/createItem`,
      query: { name, mode: 'copy', from: fromName },
    })

    return { copied: true, name, from: fromName, folderPath: folderPath || null }
  }

  /**
   * @operationName Enable Job
   * @category Jobs
   * @description Enables a job so it can be built and its triggers become active. Safe to call on an already-enabled job.
   * @route POST /job/enable
   * @paramDef {"type":"String","label":"Job Path","name":"jobPath","required":true,"dictionary":"getJobsDictionary","description":"Job name, or folder path for nested jobs (e.g. my-folder/my-job)."}
   * @returns {Object}
   * @sampleResult {"enabled":true,"jobPath":"my-app-build"}
   */
  async enableJob(jobPath) {
    await this.#apiRequest({
      logTag: '[enableJob]',
      method: 'post',
      path: `${ this.#jobPath(jobPath) }/enable`,
    })

    return { enabled: true, jobPath }
  }

  /**
   * @operationName Disable Job
   * @category Jobs
   * @description Disables a job so it cannot be built manually or by its triggers. Any queued or running builds are unaffected. Safe to call on an already-disabled job.
   * @route POST /job/disable
   * @paramDef {"type":"String","label":"Job Path","name":"jobPath","required":true,"dictionary":"getJobsDictionary","description":"Job name, or folder path for nested jobs (e.g. my-folder/my-job)."}
   * @returns {Object}
   * @sampleResult {"disabled":true,"jobPath":"my-app-build"}
   */
  async disableJob(jobPath) {
    await this.#apiRequest({
      logTag: '[disableJob]',
      method: 'post',
      path: `${ this.#jobPath(jobPath) }/disable`,
    })

    return { disabled: true, jobPath }
  }

  /**
   * @operationName Delete Job
   * @category Jobs
   * @description Permanently deletes a job and all of its build history. This action cannot be undone. Use a folder path for nested jobs.
   * @route POST /job/delete
   * @paramDef {"type":"String","label":"Job Path","name":"jobPath","required":true,"dictionary":"getJobsDictionary","description":"Job name, or folder path for nested jobs (e.g. my-folder/my-job)."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"jobPath":"my-old-job"}
   */
  async deleteJob(jobPath) {
    await this.#apiRequest({
      logTag: '[deleteJob]',
      method: 'post',
      path: `${ this.#jobPath(jobPath) }/doDelete`,
    })

    return { deleted: true, jobPath }
  }

  // ------------------------------------------------------------------
  // Builds
  // ------------------------------------------------------------------

  /**
   * @operationName Trigger Build
   * @category Builds
   * @description Triggers a new build of a job and returns the queue item location. When parameters are supplied the build is submitted to buildWithParameters (as URL-encoded form data); otherwise a plain build is triggered. Builds do not start immediately - Jenkins places them in the queue, so the response returns the queue item URL/ID rather than a build number. Poll Get Queue or Get Build (using lastBuild) to track progress.
   * @route POST /job/build
   * @paramDef {"type":"String","label":"Job Path","name":"jobPath","required":true,"dictionary":"getJobsDictionary","description":"Job name, or folder path for nested jobs (e.g. my-folder/my-job)."}
   * @paramDef {"type":"Object","label":"Build Parameters","name":"parameters","description":"Optional key/value build parameters (e.g. {\"BRANCH\":\"main\",\"DEPLOY\":\"true\"}). When provided, the job must be parameterized. Values are sent as form data. Leave empty for a plain build."}
   * @returns {Object}
   * @sampleResult {"triggered":true,"jobPath":"my-app-build","parameterized":true,"queueLocation":"https://jenkins.example.com/queue/item/531/","queueItemId":531}
   */
  async triggerBuild(jobPath, parameters) {
    const jobBase = this.#jobPath(jobPath)
    const hasParams = parameters && typeof parameters === 'object' && Object.keys(parameters).length > 0

    let request

    try {
      const crumbHeaders = { Authorization: this.authHeader }
      const crumb = await this.#getCrumb()

      if (crumb) {
        crumbHeaders[crumb.field] = crumb.value
      }

      if (hasParams) {
        const query = {}

        for (const [key, value] of Object.entries(parameters)) {
          query[key] = typeof value === 'object' ? JSON.stringify(value) : String(value)
        }

        logger.debug(`[triggerBuild] - [POST::${ this.baseUrl }${ jobBase }/buildWithParameters]`)

        request = Flowrunner.Request
          .post(`${ this.baseUrl }${ jobBase }/buildWithParameters`)
          .set(crumbHeaders)
          .query(query)
      } else {
        logger.debug(`[triggerBuild] - [POST::${ this.baseUrl }${ jobBase }/build]`)

        request = Flowrunner.Request
          .post(`${ this.baseUrl }${ jobBase }/build`)
          .set(crumbHeaders)
      }

      const response = await request.setEncoding(null).unwrapBody(false)
      const headers = response.headers || {}
      const queueLocation = headers.location || headers.Location || null
      let queueItemId = null

      if (queueLocation) {
        const match = queueLocation.match(/\/queue\/item\/(\d+)/)

        queueItemId = match ? Number(match[1]) : null
      }

      return {
        triggered: true,
        jobPath,
        parameterized: Boolean(hasParams),
        queueLocation,
        queueItemId,
      }
    } catch (error) {
      throw this.#buildError(error, '[triggerBuild]')
    }
  }

  /**
   * @operationName Get Build
   * @category Builds
   * @description Retrieves details of a specific build, including its result (SUCCESS, FAILURE, UNSTABLE, ABORTED, or null while running), duration, timestamp, whether it is still building, and the parameters/causes that started it. The build number accepts numeric values or Jenkins aliases such as lastBuild, lastSuccessfulBuild, lastFailedBuild, and lastCompletedBuild.
   * @route GET /job/build
   * @paramDef {"type":"String","label":"Job Path","name":"jobPath","required":true,"dictionary":"getJobsDictionary","description":"Job name, or folder path for nested jobs (e.g. my-folder/my-job)."}
   * @paramDef {"type":"String","label":"Build Number","name":"buildNumber","required":true,"description":"Build number (e.g. 42) or an alias: lastBuild, lastSuccessfulBuild, lastFailedBuild, lastStableBuild, or lastCompletedBuild.","uiComponent":{"type":"DROPDOWN","options":{"values":["lastBuild","lastSuccessfulBuild","lastFailedBuild","lastStableBuild","lastCompletedBuild"]}}}
   * @returns {Object}
   * @sampleResult {"number":42,"result":"SUCCESS","building":false,"duration":45231,"timestamp":1720900000000,"url":"https://jenkins.example.com/job/my-app-build/42/","displayName":"#42"}
   */
  async getBuild(jobPath, buildNumber) {
    return await this.#apiRequest({
      logTag: '[getBuild]',
      method: 'get',
      path: `${ this.#jobPath(jobPath) }/${ encodeURIComponent(buildNumber) }/api/json`,
      accept: 'application/json',
    })
  }

  /**
   * @operationName Get Build Console Output
   * @category Builds
   * @description Returns the full plain-text console log for a build. For very large or in-progress builds prefer Get Build Log Tail. The build number accepts numeric values or aliases such as lastBuild and lastSuccessfulBuild.
   * @route GET /job/build/console
   * @paramDef {"type":"String","label":"Job Path","name":"jobPath","required":true,"dictionary":"getJobsDictionary","description":"Job name, or folder path for nested jobs (e.g. my-folder/my-job)."}
   * @paramDef {"type":"String","label":"Build Number","name":"buildNumber","required":true,"description":"Build number (e.g. 42) or an alias like lastBuild."}
   * @returns {Object}
   * @sampleResult {"jobPath":"my-app-build","buildNumber":"42","consoleOutput":"Started by user admin\nRunning as SYSTEM\n[my-app-build] $ /bin/sh -xe /tmp/build.sh\n+ echo hello\nhello\nFinished: SUCCESS\n"}
   */
  async getBuildConsoleOutput(jobPath, buildNumber) {
    const consoleOutput = await this.#apiRequest({
      logTag: '[getBuildConsoleOutput]',
      method: 'get',
      path: `${ this.#jobPath(jobPath) }/${ encodeURIComponent(buildNumber) }/consoleText`,
      accept: 'text/plain',
      isText: true,
    })

    return { jobPath, buildNumber, consoleOutput }
  }

  /**
   * @operationName Get Build Log Tail
   * @category Builds
   * @description Returns the last portion of a build's console log - useful for quickly checking the outcome of a large or running build without downloading the entire log. The number of lines is capped at the tail of the full console text.
   * @route GET /job/build/log-tail
   * @paramDef {"type":"String","label":"Job Path","name":"jobPath","required":true,"dictionary":"getJobsDictionary","description":"Job name, or folder path for nested jobs (e.g. my-folder/my-job)."}
   * @paramDef {"type":"String","label":"Build Number","name":"buildNumber","required":true,"description":"Build number (e.g. 42) or an alias like lastBuild."}
   * @paramDef {"type":"Number","label":"Lines","name":"lines","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of trailing lines to return (default 50, maximum 1000)."}
   * @returns {Object}
   * @sampleResult {"jobPath":"my-app-build","buildNumber":"lastBuild","lines":50,"totalLines":312,"logTail":"+ echo done\ndone\nFinished: SUCCESS\n"}
   */
  async getBuildLogTail(jobPath, buildNumber, lines) {
    const consoleOutput = await this.#apiRequest({
      logTag: '[getBuildLogTail]',
      method: 'get',
      path: `${ this.#jobPath(jobPath) }/${ encodeURIComponent(buildNumber) }/consoleText`,
      accept: 'text/plain',
      isText: true,
    })

    let count = Number(lines)

    if (!Number.isFinite(count) || count <= 0) {
      count = 50
    }

    count = Math.min(count, 1000)

    const allLines = consoleOutput.split('\n')
    const tail = allLines.slice(-count).join('\n')

    return {
      jobPath,
      buildNumber,
      lines: count,
      totalLines: allLines.length,
      logTail: tail,
    }
  }

  /**
   * @operationName Stop Build
   * @category Builds
   * @description Stops (aborts) a running build. Has no effect if the build has already completed. The build number accepts numeric values or aliases like lastBuild.
   * @route POST /job/build/stop
   * @paramDef {"type":"String","label":"Job Path","name":"jobPath","required":true,"dictionary":"getJobsDictionary","description":"Job name, or folder path for nested jobs (e.g. my-folder/my-job)."}
   * @paramDef {"type":"String","label":"Build Number","name":"buildNumber","required":true,"description":"Build number (e.g. 42) or an alias like lastBuild."}
   * @returns {Object}
   * @sampleResult {"stopped":true,"jobPath":"my-app-build","buildNumber":"42"}
   */
  async stopBuild(jobPath, buildNumber) {
    await this.#apiRequest({
      logTag: '[stopBuild]',
      method: 'post',
      path: `${ this.#jobPath(jobPath) }/${ encodeURIComponent(buildNumber) }/stop`,
    })

    return { stopped: true, jobPath, buildNumber }
  }

  // ------------------------------------------------------------------
  // Queue
  // ------------------------------------------------------------------

  /**
   * @operationName Get Queue
   * @category Queue
   * @description Retrieves the current build queue - all items waiting to be executed, including why each is queued (e.g. waiting for an available executor), the associated task/job, and its queue item ID. Use a queue item ID with Cancel Queue Item.
   * @route GET /queue
   * @returns {Object}
   * @sampleResult {"items":[{"id":531,"blocked":false,"stuck":false,"why":"Waiting for next available executor","task":{"name":"my-app-build","url":"https://jenkins.example.com/job/my-app-build/"}}]}
   */
  async getQueue() {
    return await this.#apiRequest({
      logTag: '[getQueue]',
      method: 'get',
      path: '/queue/api/json',
      accept: 'application/json',
    })
  }

  /**
   * @operationName Cancel Queue Item
   * @category Queue
   * @description Cancels a queued build before it starts executing, identified by its queue item ID (from Get Queue or the queueItemId returned by Trigger Build). Has no effect if the item has already started or left the queue.
   * @route POST /queue/cancel
   * @paramDef {"type":"Number","label":"Queue Item ID","name":"id","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The numeric queue item ID to cancel."}
   * @returns {Object}
   * @sampleResult {"cancelled":true,"id":531}
   */
  async cancelQueueItem(id) {
    await this.#apiRequest({
      logTag: '[cancelQueueItem]',
      method: 'post',
      path: '/queue/cancelItem',
      query: { id },
    })

    return { cancelled: true, id: Number(id) }
  }

  // ------------------------------------------------------------------
  // System
  // ------------------------------------------------------------------

  /**
   * @operationName Get Jenkins Info
   * @category System
   * @description Retrieves top-level information about the Jenkins instance, including the top-level jobs, the node/executor mode, quieting-down status, and the Jenkins version (read from the X-Jenkins response header when available). Useful for a health/overview check.
   * @route GET /info
   * @returns {Object}
   * @sampleResult {"version":"2.452.3","mode":"NORMAL","nodeName":"","numExecutors":2,"quietingDown":false,"useSecurity":true,"jobs":[{"name":"my-app-build","url":"https://jenkins.example.com/job/my-app-build/","color":"blue"}]}
   */
  async getJenkinsInfo() {
    const response = await this.#apiRequest({
      logTag: '[getJenkinsInfo]',
      method: 'get',
      path: '/api/json',
      accept: 'application/json',
      rawResponse: true,
    })

    const headers = response.headers || {}
    const version = headers['x-jenkins'] || headers['X-Jenkins'] || null
    const rawBody = response.body
    const body = Buffer.isBuffer(rawBody)
      ? JSON.parse(rawBody.toString('utf8'))
      : (typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody) || {}

    return {
      version,
      mode: body.mode,
      nodeName: body.nodeName,
      numExecutors: body.numExecutors,
      quietingDown: body.quietingDown,
      useSecurity: body.useSecurity,
      jobs: body.jobs || [],
    }
  }

  /**
   * @operationName Get Views
   * @category System
   * @description Lists all views configured on the Jenkins instance with their name and URL. Views are named, filtered groupings of jobs (e.g. the default "All" view, or custom dashboards).
   * @route GET /views
   * @returns {Object}
   * @sampleResult {"views":[{"name":"all","url":"https://jenkins.example.com/"},{"name":"Deployments","url":"https://jenkins.example.com/view/Deployments/"}]}
   */
  async getViews() {
    return await this.#apiRequest({
      logTag: '[getViews]',
      method: 'get',
      path: '/api/json',
      query: { tree: 'views[name,url]' },
      accept: 'application/json',
    })
  }

  // ------------------------------------------------------------------
  // Dictionaries
  // ------------------------------------------------------------------

  /**
   * @typedef {Object} getJobsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter top-level jobs by name (case-insensitive)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Jenkins returns all top-level jobs in one response, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Jobs Dictionary
   * @description Provides a searchable list of top-level jobs for selecting a Job Path in other operations. The option value is the job name. Jobs nested inside folders are not listed here - for those, type the folder path manually (e.g. my-folder/my-job).
   * @route POST /get-jobs-dictionary
   * @paramDef {"type":"getJobsDictionary__payload","label":"Payload","name":"payload","description":"Contains the optional search string used to filter jobs by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"my-app-build","value":"my-app-build","note":"blue"},{"label":"nightly-tests","value":"nightly-tests","note":"red"}],"cursor":null}
   */
  async getJobsDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getJobsDictionary]',
      method: 'get',
      path: '/api/json',
      query: { tree: 'jobs[name,url,color,_class]' },
      accept: 'application/json',
    })

    const jobs = response.jobs || []
    const term = (search || '').toLowerCase()

    const items = jobs
      .filter(job => !term || (job.name || '').toLowerCase().includes(term))
      .map(job => {
        const isFolder = typeof job._class === 'string' && /folder/i.test(job._class)

        return {
          label: job.name,
          value: job.name,
          note: isFolder ? 'folder (open and use folder/job path)' : (job.color || undefined),
        }
      })

    return { items, cursor: null }
  }
}

Flowrunner.ServerCode.addService(JenkinsService, [
  {
    name: 'baseUrl',
    displayName: 'Jenkins URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Jenkins base URL, e.g. https://jenkins.example.com (strip any trailing slash).',
  },
  {
    name: 'username',
    displayName: 'Username',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Jenkins username (the account that owns the API token).',
  },
  {
    name: 'apiToken',
    displayName: 'API Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Generate in Jenkins: click your name (top right) -> Configure -> API Token -> Add new token. Used with Basic authentication.',
  },
])
