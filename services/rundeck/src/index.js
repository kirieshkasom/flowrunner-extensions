const logger = {
  info: (...args) => console.log('[Rundeck] info:', ...args),
  debug: (...args) => console.log('[Rundeck] debug:', ...args),
  error: (...args) => console.log('[Rundeck] error:', ...args),
  warn: (...args) => console.log('[Rundeck] warn:', ...args),
}

const DEFAULT_API_VERSION = '47'

function clean(obj) {
  if (!obj || typeof obj !== 'object') {
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
 * @integrationName Rundeck
 * @integrationIcon /icon.jpeg
 */
class RundeckService {
  constructor(config) {
    this.url = (config.url || '').replace(/\/+$/, '')
    this.apiToken = config.apiToken
    this.apiVersion = config.apiVersion || DEFAULT_API_VERSION
    this.baseUrl = `${ this.url }/api/${ this.apiVersion }`
  }

  // Single private request helper — all Rundeck API calls go through here.
  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const url = `${ this.baseUrl }${ path }`

    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery || {}) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'X-Rundeck-Auth-Token': this.apiToken,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const responseBody = error.body || {}
      const message = responseBody.message || error.message || 'Unknown error'
      const errorCode = responseBody.errorCode
      const status = error.status || error.statusCode

      logger.error(`${ logTag } - failed (${ status || 'n/a' }): ${ message }${ errorCode ? ` [${ errorCode }]` : '' }`)

      throw new Error(`Rundeck API error${ errorCode ? ` (${ errorCode })` : '' }: ${ message }`)
    }
  }

  // Parses a user-supplied options object, ignoring non-object input.
  #normalizeOptions(options) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      return undefined
    }

    return Object.keys(options).length ? options : undefined
  }

  /**
   * @operationName List Projects
   * @category Projects
   * @description Lists all projects visible to the API token on the Rundeck server. Each project entry includes its name, optional description, and a URL to the project resource. Use a project name with the job and execution operations.
   * @route GET /projects
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional case-insensitive substring to filter the returned projects by name."}
   * @returns {Array<Object>}
   * @sampleResult [{"url":"http://rundeck.example.com/api/47/project/production","name":"production","description":"Production deployments"}]
   */
  async listProjects(search) {
    const projects = await this.#apiRequest({
      logTag: '[listProjects]',
      path: '/projects',
      method: 'get',
    })

    if (!search || !Array.isArray(projects)) {
      return projects
    }

    const needle = String(search).toLowerCase()

    return projects.filter(project => (project.name || '').toLowerCase().includes(needle))
  }

  /**
   * @operationName Get Project
   * @category Projects
   * @description Returns detailed information about a single project, including its name, description, and configuration properties. Use List Projects to discover project names.
   * @route GET /project
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"dictionary":"getProjectsDictionary","description":"Name of the project to retrieve."}
   * @returns {Object}
   * @sampleResult {"url":"http://rundeck.example.com/api/47/project/production","name":"production","description":"Production deployments","config":{"project.description":"Production deployments"}}
   */
  async getProject(project) {
    return await this.#apiRequest({
      logTag: '[getProject]',
      path: `/project/${ encodeURIComponent(project) }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Jobs
   * @category Jobs
   * @description Lists the jobs defined in a project. Each job includes its unique ID, name, group, project, and description. Use a job ID with Get Job Definition, Run Job, or Retry Job Execution. Optionally filter by job name or group.
   * @route GET /project/jobs
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"dictionary":"getProjectsDictionary","description":"Name of the project whose jobs to list."}
   * @paramDef {"type":"String","label":"Job Name Filter","name":"jobFilter","description":"Optional substring to match against job names."}
   * @paramDef {"type":"String","label":"Group Path","name":"groupPath","description":"Optional job group path to filter by (use a single '/' to match only top-level jobs, or '*' for all groups)."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":"3b8a86d5-4fc3-4cc1-95a2-8b51421c2069","name":"Deploy App","group":"deploy","project":"production","description":"Deploys the application"}]
   */
  async listJobs(project, jobFilter, groupPath) {
    return await this.#apiRequest({
      logTag: '[listJobs]',
      path: `/project/${ encodeURIComponent(project) }/jobs`,
      method: 'get',
      query: {
        jobFilter,
        groupPath,
      },
    })
  }

  /**
   * @operationName Get Job Definition
   * @category Jobs
   * @description Returns the full definition of a job in JSON format, including its options, workflow steps, node filters, schedule, and notifications. Use List Jobs to find the job ID.
   * @route GET /job
   * @paramDef {"type":"String","label":"Job ID","name":"jobId","required":true,"description":"Unique ID (UUID) of the job to retrieve."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":"3b8a86d5-4fc3-4cc1-95a2-8b51421c2069","name":"Deploy App","group":"deploy","project":"production","description":"Deploys the application","options":[{"name":"version","required":true}],"sequence":{"commands":[{"exec":"echo hello"}]}}]
   */
  async getJobDefinition(jobId) {
    return await this.#apiRequest({
      logTag: '[getJobDefinition]',
      path: `/job/${ encodeURIComponent(jobId) }`,
      method: 'get',
      query: { format: 'json' },
    })
  }

  /**
   * @operationName Run Job
   * @category Jobs
   * @description Executes a job by ID and returns the created execution, including its ID, status, and permalink. Supply job option values as an Object of name/value pairs, or a raw argString. Optionally target specific nodes with a filter, run as another user, or schedule the run for a future time. Returns immediately; use Get Execution or Get Execution State to track progress.
   * @route POST /job/executions
   * @paramDef {"type":"String","label":"Job ID","name":"jobId","required":true,"description":"Unique ID (UUID) of the job to run."}
   * @paramDef {"type":"Object","label":"Options","name":"options","description":"Job option values as key/value pairs, e.g. {\"version\":\"1.2.3\",\"env\":\"prod\"}. Takes precedence over Arg String when provided."}
   * @paramDef {"type":"String","label":"Arg String","name":"argString","description":"Raw argument string in the form '-opt value -opt2 value2'. Ignored when Options is provided."}
   * @paramDef {"type":"String","label":"Node Filter","name":"filter","description":"Node filter string to override the job's target nodes, e.g. 'tags: web' or 'name: node-01'."}
   * @paramDef {"type":"String","label":"Log Level","name":"logLevel","uiComponent":{"type":"DROPDOWN","options":{"values":["Debug","Verbose","Info","Warn","Error"]}},"description":"Log verbosity for this run."}
   * @paramDef {"type":"String","label":"As User","name":"asUser","description":"Username to run the job as. Requires 'runAs' permission for the API token."}
   * @paramDef {"type":"String","label":"Run At Time","name":"runAtTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional ISO-8601 timestamp with timezone to schedule the run for a future time, e.g. 2026-11-23T12:20:55-0800. Omit to run immediately."}
   * @returns {Object}
   * @sampleResult {"id":42,"href":"http://rundeck.example.com/api/47/execution/42","permalink":"http://rundeck.example.com/project/production/execution/show/42","status":"running","project":"production","user":"admin","job":{"id":"3b8a86d5-4fc3-4cc1-95a2-8b51421c2069","name":"Deploy App"}}
   */
  async runJob(jobId, options, argString, filter, logLevel, asUser, runAtTime) {
    const normalizedOptions = this.#normalizeOptions(options)

    const body = clean({
      options: normalizedOptions,
      argString: normalizedOptions ? undefined : argString,
      filter,
      loglevel: this.#resolveChoice(logLevel, {
        Debug: 'DEBUG',
        Verbose: 'VERBOSE',
        Info: 'INFO',
        Warn: 'WARN',
        Error: 'ERROR',
      }),
      asUser,
      runAtTime,
    })

    return await this.#apiRequest({
      logTag: '[runJob]',
      path: `/job/${ encodeURIComponent(jobId) }/executions`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Retry Job Execution
   * @category Jobs
   * @description Retries a job based on a previous failed execution, re-running only the nodes that failed (unless overridden with a node filter). Reuses the original execution's options unless new option values are supplied. Returns the newly created execution.
   * @route POST /job/retry
   * @paramDef {"type":"String","label":"Job ID","name":"jobId","required":true,"description":"Unique ID (UUID) of the job to retry."}
   * @paramDef {"type":"Number","label":"Execution ID","name":"executionId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the prior execution to retry from."}
   * @paramDef {"type":"Object","label":"Options","name":"options","description":"Optional job option values as key/value pairs to override the original execution's options."}
   * @paramDef {"type":"String","label":"Arg String","name":"argString","description":"Optional raw argument string to override options. Ignored when Options is provided."}
   * @paramDef {"type":"Boolean","label":"Failed Nodes Only","name":"failedNodes","uiComponent":{"type":"TOGGLE"},"description":"When true (default), retries only the nodes that failed in the original execution. Set false to run on all of the job's nodes."}
   * @paramDef {"type":"String","label":"As User","name":"asUser","description":"Username to run the retry as. Requires 'runAs' permission for the API token."}
   * @returns {Object}
   * @sampleResult {"id":43,"href":"http://rundeck.example.com/api/47/execution/43","permalink":"http://rundeck.example.com/project/production/execution/show/43","status":"running","project":"production","job":{"id":"3b8a86d5-4fc3-4cc1-95a2-8b51421c2069","name":"Deploy App"}}
   */
  async retryJobExecution(jobId, executionId, options, argString, failedNodes, asUser) {
    const normalizedOptions = this.#normalizeOptions(options)

    const body = clean({
      options: normalizedOptions,
      argString: normalizedOptions ? undefined : argString,
      failedNodes: failedNodes === undefined ? undefined : failedNodes,
      asUser,
    })

    return await this.#apiRequest({
      logTag: '[retryJobExecution]',
      path: `/job/${ encodeURIComponent(jobId) }/retry/${ encodeURIComponent(executionId) }`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Get Execution
   * @category Executions
   * @description Returns metadata for a single execution, including its status, job reference, start and end times, the user who ran it, options used, and permalink. Use to check the outcome of a run started with Run Job or an adhoc operation.
   * @route GET /execution
   * @paramDef {"type":"Number","label":"Execution ID","name":"executionId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the execution to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":42,"href":"http://rundeck.example.com/api/47/execution/42","permalink":"http://rundeck.example.com/project/production/execution/show/42","status":"succeeded","project":"production","user":"admin","date-started":{"unixtime":1700000000000,"date":"2026-07-14T10:00:00Z"},"date-ended":{"unixtime":1700000030000,"date":"2026-07-14T10:00:30Z"},"job":{"id":"3b8a86d5-4fc3-4cc1-95a2-8b51421c2069","name":"Deploy App"}}
   */
  async getExecution(executionId) {
    return await this.#apiRequest({
      logTag: '[getExecution]',
      path: `/execution/${ encodeURIComponent(executionId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Execution State
   * @category Executions
   * @description Returns the detailed workflow state of an execution, including the overall status, per-node and per-step states, and step progress. Use to monitor a running execution in fine detail.
   * @route GET /execution/state
   * @paramDef {"type":"Number","label":"Execution ID","name":"executionId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the execution whose state to retrieve."}
   * @returns {Object}
   * @sampleResult {"executionId":42,"completed":true,"executionState":"SUCCEEDED","startTime":"2026-07-14T10:00:00Z","endTime":"2026-07-14T10:00:30Z","allNodes":{"nodes":["node-01"]},"nodes":{"node-01":[{"executionState":"SUCCEEDED","stepctx":"1"}]}}
   */
  async getExecutionState(executionId) {
    return await this.#apiRequest({
      logTag: '[getExecutionState]',
      path: `/execution/${ encodeURIComponent(executionId) }/state`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Execution Output
   * @category Executions
   * @description Returns the log output for an execution, including timestamped log entries, their log level, source node, and step context. Supports paging by byte offset and limiting the maximum number of lines returned. Use after or during a run to inspect what happened.
   * @route GET /execution/output
   * @paramDef {"type":"Number","label":"Execution ID","name":"executionId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the execution whose output to retrieve."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Byte offset to read from within the output. Use the 'offset' from a prior response to page forward. Defaults to 0."}
   * @paramDef {"type":"Number","label":"Max Lines","name":"maxLines","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of log lines to return in this request."}
   * @returns {Object}
   * @sampleResult {"id":"42","offset":"1024","completed":true,"execCompleted":true,"execState":"succeeded","totalSize":1024,"entries":[{"time":"10:00:01","level":"NORMAL","log":"hello","node":"node-01","step":"1"}]}
   */
  async getExecutionOutput(executionId, offset, maxLines) {
    return await this.#apiRequest({
      logTag: '[getExecutionOutput]',
      path: `/execution/${ encodeURIComponent(executionId) }/output`,
      method: 'get',
      query: {
        offset,
        maxlines: maxLines,
      },
    })
  }

  /**
   * @operationName Abort Execution
   * @category Executions
   * @description Requests abortion of a currently running execution. Returns the abort request status and the execution's resulting state. Aborting is asynchronous; poll Get Execution or Get Execution State to confirm the execution has stopped.
   * @route POST /execution/abort
   * @paramDef {"type":"Number","label":"Execution ID","name":"executionId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the running execution to abort."}
   * @paramDef {"type":"String","label":"As User","name":"asUser","description":"Username to abort the execution as. Requires 'killAs' permission for the API token."}
   * @returns {Object}
   * @sampleResult {"abort":{"status":"pending","reason":""},"execution":{"id":"42","status":"running"}}
   */
  async abortExecution(executionId, asUser) {
    return await this.#apiRequest({
      logTag: '[abortExecution]',
      path: `/execution/${ encodeURIComponent(executionId) }/abort`,
      method: 'post',
      query: { asUser },
    })
  }

  /**
   * @operationName List Project Executions
   * @category Executions
   * @description Lists executions within a project, most recent first, with paging and count metadata. Filter by one or more job IDs, execution status, and limit the number returned. Use to review recent runs or find executions to retry or inspect.
   * @route GET /project/executions
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"dictionary":"getProjectsDictionary","description":"Name of the project whose executions to list."}
   * @paramDef {"type":"Array<String>","label":"Job ID Filter","name":"jobIdListFilter","description":"Optional list of job IDs (UUIDs) to restrict results to executions of those jobs."}
   * @paramDef {"type":"String","label":"Status Filter","name":"statusFilter","uiComponent":{"type":"DROPDOWN","options":{"values":["Running","Succeeded","Failed","Aborted","Timed Out","Failed With Retry","Scheduled"]}},"description":"Optional execution status to filter by."}
   * @paramDef {"type":"Number","label":"Max Results","name":"max","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of executions to return (default 20)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Offset for paging through results. Defaults to 0."}
   * @returns {Object}
   * @sampleResult {"paging":{"count":1,"total":1,"offset":0,"max":20},"executions":[{"id":42,"status":"succeeded","project":"production","permalink":"http://rundeck.example.com/project/production/execution/show/42","job":{"id":"3b8a86d5-4fc3-4cc1-95a2-8b51421c2069","name":"Deploy App"}}]}
   */
  async listProjectExecutions(project, jobIdListFilter, statusFilter, max, offset) {
    const jobIds = Array.isArray(jobIdListFilter)
      ? jobIdListFilter.filter(Boolean).join(',')
      : jobIdListFilter

    return await this.#apiRequest({
      logTag: '[listProjectExecutions]',
      path: `/project/${ encodeURIComponent(project) }/executions`,
      method: 'get',
      query: {
        jobIdListFilter: jobIds,
        statusFilter: this.#resolveChoice(statusFilter, {
          'Running': 'running',
          'Succeeded': 'succeeded',
          'Failed': 'failed',
          'Aborted': 'aborted',
          'Timed Out': 'timedout',
          'Failed With Retry': 'failed-with-retry',
          'Scheduled': 'scheduled',
        }),
        max: max || 20,
        offset,
      },
    })
  }

  /**
   * @operationName Delete Execution
   * @category Executions
   * @description Permanently deletes a single execution and its associated log output. This cannot be undone. Requires 'delete_execution' permission for the API token.
   * @route DELETE /execution
   * @paramDef {"type":"Number","label":"Execution ID","name":"executionId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the execution to permanently delete."}
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Execution 42 deleted"}
   */
  async deleteExecution(executionId) {
    const result = await this.#apiRequest({
      logTag: '[deleteExecution]',
      path: `/execution/${ encodeURIComponent(executionId) }`,
      method: 'delete',
    })

    // A 204 No Content returns an empty body; normalize to a clear success object.
    return result || { success: true, message: `Execution ${ executionId } deleted` }
  }

  /**
   * @operationName Run Adhoc Command
   * @category Adhoc
   * @description Runs an arbitrary shell command directly on the nodes of a project, without a predefined job. Returns the created execution. Target nodes with a node filter (defaults to the local Rundeck server if omitted). Requires 'run' permission on the project's adhoc resource.
   * @route POST /project/run/command
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"dictionary":"getProjectsDictionary","description":"Name of the project to run the command in."}
   * @paramDef {"type":"String","label":"Command","name":"command","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Shell command line to execute on the target nodes."}
   * @paramDef {"type":"String","label":"Node Filter","name":"filter","description":"Node filter string selecting which nodes to run on, e.g. 'tags: web' or 'name: node-01'. Defaults to the Rundeck server node."}
   * @paramDef {"type":"Number","label":"Node Thread Count","name":"nodeThreadcount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of nodes to run on in parallel."}
   * @paramDef {"type":"Boolean","label":"Keepgoing","name":"nodeKeepgoing","uiComponent":{"type":"TOGGLE"},"description":"When true, continue running on remaining nodes even if the command fails on some nodes."}
   * @paramDef {"type":"String","label":"As User","name":"asUser","description":"Username to run the command as. Requires 'runAs' permission for the API token."}
   * @returns {Object}
   * @sampleResult {"execution":{"id":44,"href":"http://rundeck.example.com/api/47/execution/44","permalink":"http://rundeck.example.com/project/production/execution/show/44"},"message":"Immediate execution scheduled (44)"}
   */
  async runAdhocCommand(project, command, filter, nodeThreadcount, nodeKeepgoing, asUser) {
    const body = clean({
      project,
      exec: command,
      filter,
      nodeThreadcount,
      nodeKeepgoing: nodeKeepgoing === undefined ? undefined : nodeKeepgoing,
      asUser,
    })

    return await this.#apiRequest({
      logTag: '[runAdhocCommand]',
      path: `/project/${ encodeURIComponent(project) }/run/command`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Run Adhoc Script
   * @category Adhoc
   * @description Runs an arbitrary script (its full text) on the nodes of a project without a predefined job. The script is uploaded and executed with the given interpreter and optional arguments. Returns the created execution. Requires 'run' permission on the project's adhoc resource.
   * @route POST /project/run/script
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"dictionary":"getProjectsDictionary","description":"Name of the project to run the script in."}
   * @paramDef {"type":"String","label":"Script","name":"script","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Full text of the script to execute on the target nodes."}
   * @paramDef {"type":"String","label":"Arg String","name":"argString","description":"Arguments passed to the script, e.g. '-name value'."}
   * @paramDef {"type":"String","label":"Node Filter","name":"filter","description":"Node filter string selecting which nodes to run on, e.g. 'tags: web'. Defaults to the Rundeck server node."}
   * @paramDef {"type":"String","label":"Script Interpreter","name":"scriptInterpreter","description":"Command used to invoke the script, e.g. '/bin/bash' or 'sudo'. Optional."}
   * @paramDef {"type":"Number","label":"Node Thread Count","name":"nodeThreadcount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of nodes to run on in parallel."}
   * @paramDef {"type":"Boolean","label":"Keepgoing","name":"nodeKeepgoing","uiComponent":{"type":"TOGGLE"},"description":"When true, continue running on remaining nodes even if the script fails on some nodes."}
   * @paramDef {"type":"String","label":"As User","name":"asUser","description":"Username to run the script as. Requires 'runAs' permission for the API token."}
   * @returns {Object}
   * @sampleResult {"execution":{"id":45,"href":"http://rundeck.example.com/api/47/execution/45","permalink":"http://rundeck.example.com/project/production/execution/show/45"},"message":"Immediate execution scheduled (45)"}
   */
  async runAdhocScript(project, script, argString, filter, scriptInterpreter, nodeThreadcount, nodeKeepgoing, asUser) {
    const body = clean({
      project,
      script,
      argString,
      filter,
      scriptInterpreter,
      nodeThreadcount,
      nodeKeepgoing: nodeKeepgoing === undefined ? undefined : nodeKeepgoing,
      asUser,
    })

    return await this.#apiRequest({
      logTag: '[runAdhocScript]',
      path: `/project/${ encodeURIComponent(project) }/run/script`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Get System Info
   * @category System
   * @description Returns Rundeck server system information, including version, build, uptime, JVM, OS, and metrics. Use this as a connection check to verify the server URL, API version, and API token are valid.
   * @route GET /system/info
   * @returns {Object}
   * @sampleResult {"system":{"timestamp":{"epoch":1700000000000,"datetime":"2026-07-14T10:00:00Z"},"rundeck":{"version":"5.0.0","build":"5.0.0-1","apiversion":47,"serverUUID":"3425B691-7319-4EEE-8425-F053C628B4BA"},"os":{"arch":"amd64","name":"Linux","version":"5.15.0"},"jvm":{"name":"OpenJDK 64-Bit Server VM","version":"11.0.20"}}}
   */
  async getSystemInfo() {
    return await this.#apiRequest({
      logTag: '[getSystemInfo]',
      path: '/system/info',
      method: 'get',
    })
  }

  /**
   * @typedef {Object} getProjectsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional case-insensitive substring to filter projects by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Rundeck returns all projects in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Projects Dictionary
   * @description Provides a searchable list of Rundeck projects for selecting a project in dependent parameters. The option value is the project name expected by the job and execution operations.
   * @route POST /get-projects-dictionary
   * @paramDef {"type":"getProjectsDictionary__payload","label":"Payload","name":"payload","description":"Search string used to filter projects by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"production","value":"production","note":"Production deployments"}],"cursor":null}
   */
  async getProjectsDictionary(payload) {
    const { search } = payload || {}

    const projects = await this.#apiRequest({
      logTag: '[getProjectsDictionary]',
      path: '/projects',
      method: 'get',
    })

    const list = Array.isArray(projects) ? projects : []
    const needle = search ? String(search).toLowerCase() : null

    const items = list
      .filter(project => !needle || (project.name || '').toLowerCase().includes(needle))
      .map(project => ({
        label: project.name,
        value: project.name,
        note: project.description || undefined,
      }))

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} getJobsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"dictionary":"getProjectsDictionary","description":"Project whose jobs to list."}
   */

  /**
   * @typedef {Object} getJobsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional case-insensitive substring to filter jobs by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Rundeck returns all jobs in one call, so this is unused but kept for API compatibility."}
   * @paramDef {"type":"getJobsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Dependent selection providing the project whose jobs to list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Jobs Dictionary
   * @description Provides a searchable list of jobs within a selected project for choosing a job in dependent parameters. Requires a project in the criteria. The option value is the job ID (UUID) expected by the job operations.
   * @route POST /get-jobs-dictionary
   * @paramDef {"type":"getJobsDictionary__payload","label":"Payload","name":"payload","description":"Search string and the project criteria used to list jobs."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"deploy/Deploy App","value":"3b8a86d5-4fc3-4cc1-95a2-8b51421c2069","note":"Deploys the application"}],"cursor":null}
   */
  async getJobsDictionary(payload) {
    const { search, criteria } = payload || {}
    const project = criteria && criteria.project

    if (!project) {
      return { items: [], cursor: null }
    }

    const jobs = await this.#apiRequest({
      logTag: '[getJobsDictionary]',
      path: `/project/${ encodeURIComponent(project) }/jobs`,
      method: 'get',
      query: { jobFilter: search || undefined },
    })

    const list = Array.isArray(jobs) ? jobs : []

    const items = list.map(job => {
      const label = job.group ? `${ job.group }/${ job.name }` : job.name

      return {
        label,
        value: job.id,
        note: job.description || undefined,
      }
    })

    return { items, cursor: null }
  }

  // Maps a friendly dropdown label to its API value; passes through unknown values.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }
}

Flowrunner.ServerCode.addService(RundeckService, [
  {
    name: 'url',
    displayName: 'Server URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Rundeck server URL, e.g. https://rundeck.example.com (strip any trailing slash).',
  },
  {
    name: 'apiToken',
    displayName: 'API Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Create one in Rundeck under Profile → User API Tokens → create a token. Sent as the X-Rundeck-Auth-Token header.',
  },
  {
    name: 'apiVersion',
    displayName: 'API Version',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    defaultValue: '47',
    shared: false,
    hint: 'Rundeck API version to target (default 47). Requests are sent to {url}/api/{apiVersion}.',
  },
])
