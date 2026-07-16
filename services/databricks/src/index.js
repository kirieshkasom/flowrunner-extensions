'use strict'

const logger = {
  info: (...args) => console.log('[Databricks] info:', ...args),
  debug: (...args) => console.log('[Databricks] debug:', ...args),
  error: (...args) => console.log('[Databricks] error:', ...args),
  warn: (...args) => console.log('[Databricks] warn:', ...args),
}

/**
 * @integrationName Databricks
 * @integrationIcon /icon.png
 */
class Databricks {
  constructor(config) {
    this.workspaceUrl = (config.workspaceUrl || '').replace(/\/+$/, '')
    this.apiToken = config.apiToken
  }

  // ─── Core request helper ──────────────────────────────────────────────

  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const url = `${ this.workspaceUrl }${ path }`

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          Authorization: `Bearer ${ this.apiToken }`,
          'Content-Type': 'application/json',
        })
        .query(query || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const details = error.body?.message || error.body?.error_code || error.message
      const status = error.status || error.statusCode
      logger.error(`${ logTag } - failed (${ status }): ${ details }`)
      throw new Error(`Databricks API error${ status ? ` [${ status }]` : '' }: ${ details }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #compact(obj) {
    return Object.fromEntries(
      Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== '')
    )
  }

  // ─── Dictionary Typedefs ──────────────────────────────────────────────

  /**
   * @typedef {Object} getWarehousesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter warehouses by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused; warehouses are returned in a single page)."}
   */

  /**
   * @typedef {Object} getJobsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter jobs by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token from a previous page to fetch the next set of jobs."}
   */

  // ─── Dictionary Methods ───────────────────────────────────────────────

  /**
   * @operationName Get Warehouses Dictionary
   * @description Lists SQL warehouses for selection in dependent parameters such as Warehouse ID. Each item maps the warehouse name to its ID.
   * @route POST /get-warehouses-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getWarehousesDictionary__payload","label":"Payload","name":"payload","description":"Contains an optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Serverless Starter","value":"abc123def456","note":"RUNNING"}]}
   */
  async getWarehousesDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      path: '/api/2.0/sql/warehouses',
      logTag: 'getWarehousesDictionary',
    })

    let items = (response.warehouses || []).map(w => ({
      label: w.name,
      value: w.id,
      note: w.state || w.cluster_size,
    }))

    if (search) {
      const term = search.toLowerCase()
      items = items.filter(i => (i.label || '').toLowerCase().includes(term))
    }

    return { items }
  }

  /**
   * @operationName Get Jobs Dictionary
   * @description Lists workspace jobs for selection in dependent parameters such as Job ID. Each item maps the job name to its numeric job ID and supports name search and pagination.
   * @route POST /get-jobs-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getJobsDictionary__payload","label":"Payload","name":"payload","description":"Contains an optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Nightly ETL","value":"620916987432618","note":"Job ID: 620916987432618"}],"cursor":"CAEQ..."}
   */
  async getJobsDictionary(payload) {
    const { search, cursor } = payload || {}

    const query = this.#compact({
      name: search,
      page_token: cursor,
      limit: 25,
      expand_tasks: false,
    })

    const response = await this.#apiRequest({
      path: '/api/2.1/jobs/list',
      query,
      logTag: 'getJobsDictionary',
    })

    const items = (response.jobs || []).map(job => ({
      label: job.settings?.name || `Job ${ job.job_id }`,
      value: String(job.job_id),
      note: `Job ID: ${ job.job_id }`,
    }))

    return { items, cursor: response.next_page_token }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SQL
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * @operationName Execute SQL Statement
   * @description Runs a SQL statement on a SQL warehouse using the Statement Execution API. Set Wait Timeout to a value from 5 to 50 seconds to run synchronously and receive results inline in the response when the statement finishes quickly; if the statement is still running when the timeout elapses, the response returns a statement_id with a PENDING/RUNNING status that you poll with Get Statement Result. Use a Wait Timeout of 0 for fully asynchronous execution. Supply named parameters (referenced as ":name" in the statement) via the Parameters array to safely bind values. Inline results are limited to 25 MiB; use the EXTERNAL_LINKS disposition for larger result sets.
   * @category SQL
   * @route POST /execute-statement
   *
   * @paramDef {"type":"String","label":"Warehouse ID","name":"warehouseId","required":true,"dictionary":"getWarehousesDictionary","description":"The ID of the SQL warehouse that runs the statement."}
   * @paramDef {"type":"String","label":"SQL Statement","name":"statement","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The SQL text to execute. Reference named parameters as :name."}
   * @paramDef {"type":"String","label":"Catalog","name":"catalog","description":"Optional Unity Catalog catalog to use as the default for the statement."}
   * @paramDef {"type":"String","label":"Schema","name":"schema","description":"Optional schema (database) to use as the default for the statement."}
   * @paramDef {"type":"Array<Object>","label":"Parameters","name":"parameters","description":"Named parameter bindings. Each entry is an object with name, value, and optional type (e.g. STRING, INT, DECIMAL(18,2), DATE). Referenced in the statement as :name."}
   * @paramDef {"type":"Number","label":"Wait Timeout (seconds)","name":"waitTimeout","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Seconds to wait synchronously for results: 0 for async, or 5-50 for sync (default 10)."}
   * @paramDef {"type":"String","label":"Result Disposition","name":"disposition","uiComponent":{"type":"DROPDOWN","options":{"values":["Inline","External Links"]}},"defaultValue":"Inline","description":"How results are returned: Inline embeds up to 25 MiB in the response; External Links returns presigned URLs for large results."}
   * @paramDef {"type":"String","label":"On Wait Timeout","name":"onWaitTimeout","uiComponent":{"type":"DROPDOWN","options":{"values":["Continue","Cancel"]}},"defaultValue":"Continue","description":"What happens if the statement is still running when the wait timeout elapses: Continue keeps it running (poll for results) or Cancel aborts it."}
   * @returns {Object}
   * @sampleResult {"statement_id":"01ef-abc","status":{"state":"SUCCEEDED"},"manifest":{"schema":{"columns":[{"name":"count","type_text":"BIGINT"}]}},"result":{"data_array":[["42"]]}}
   */
  async executeStatement(
    warehouseId,
    statement,
    catalog,
    schema,
    parameters,
    waitTimeout,
    disposition,
    onWaitTimeout
  ) {
    const timeout = waitTimeout === undefined || waitTimeout === null ? 10 : Number(waitTimeout)

    const body = this.#compact({
      warehouse_id: warehouseId,
      statement,
      catalog,
      schema,
      parameters: Array.isArray(parameters) && parameters.length ? parameters : undefined,
      wait_timeout: `${ timeout }s`,
      disposition: this.#resolveChoice(disposition, {
        Inline: 'INLINE',
        'External Links': 'EXTERNAL_LINKS',
      }),
      on_wait_timeout: this.#resolveChoice(onWaitTimeout, {
        Continue: 'CONTINUE',
        Cancel: 'CANCEL',
      }),
    })

    return this.#apiRequest({
      path: '/api/2.0/sql/statements',
      method: 'post',
      body,
      logTag: 'executeStatement',
    })
  }

  /**
   * @operationName Get Statement Result
   * @description Retrieves the current status and, when available, the result data for a previously submitted SQL statement. Use this to poll asynchronous executions until status.state is SUCCEEDED (or a terminal FAILED/CANCELED/CLOSED state). Returns the manifest (column schema) and the inline result chunk when the disposition was INLINE.
   * @category SQL
   * @route GET /get-statement-result
   *
   * @paramDef {"type":"String","label":"Statement ID","name":"statementId","required":true,"description":"The statement_id returned by Execute SQL Statement."}
   * @returns {Object}
   * @sampleResult {"statement_id":"01ef-abc","status":{"state":"SUCCEEDED"},"manifest":{"total_row_count":1},"result":{"data_array":[["42"]]}}
   */
  async getStatementResult(statementId) {
    return this.#apiRequest({
      path: `/api/2.0/sql/statements/${ encodeURIComponent(statementId) }`,
      logTag: 'getStatementResult',
    })
  }

  /**
   * @operationName Cancel Statement
   * @description Requests cancellation of a running SQL statement. Cancellation is best-effort; a statement that has already completed cannot be canceled.
   * @category SQL
   * @route POST /cancel-statement
   *
   * @paramDef {"type":"String","label":"Statement ID","name":"statementId","required":true,"description":"The statement_id to cancel."}
   * @returns {Object}
   * @sampleResult {}
   */
  async cancelStatement(statementId) {
    return this.#apiRequest({
      path: `/api/2.0/sql/statements/${ encodeURIComponent(statementId) }/cancel`,
      method: 'post',
      logTag: 'cancelStatement',
    })
  }

  /**
   * @operationName List SQL Warehouses
   * @description Lists all SQL warehouses in the workspace, including their ID, name, state (RUNNING, STOPPED, STARTING, etc.), and cluster size. Useful for discovering the warehouse ID needed to execute SQL statements.
   * @category SQL
   * @route GET /list-warehouses
   *
   * @returns {Object}
   * @sampleResult {"warehouses":[{"id":"abc123def456","name":"Serverless Starter","state":"RUNNING","cluster_size":"Small"}]}
   */
  async listWarehouses() {
    return this.#apiRequest({
      path: '/api/2.0/sql/warehouses',
      logTag: 'listWarehouses',
    })
  }

  /**
   * @operationName Get SQL Warehouse
   * @description Retrieves detailed information about a single SQL warehouse, including its state, size, auto-stop settings, and JDBC/ODBC connection details.
   * @category SQL
   * @route GET /get-warehouse
   *
   * @paramDef {"type":"String","label":"Warehouse ID","name":"warehouseId","required":true,"dictionary":"getWarehousesDictionary","description":"The ID of the SQL warehouse to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"abc123def456","name":"Serverless Starter","state":"RUNNING","cluster_size":"Small","auto_stop_mins":10}
   */
  async getWarehouse(warehouseId) {
    return this.#apiRequest({
      path: `/api/2.0/sql/warehouses/${ encodeURIComponent(warehouseId) }`,
      logTag: 'getWarehouse',
    })
  }

  /**
   * @operationName Start SQL Warehouse
   * @description Starts a stopped SQL warehouse so it can serve queries. The call returns immediately; the warehouse transitions through STARTING to RUNNING asynchronously (poll Get SQL Warehouse to confirm).
   * @category SQL
   * @route POST /start-warehouse
   *
   * @paramDef {"type":"String","label":"Warehouse ID","name":"warehouseId","required":true,"dictionary":"getWarehousesDictionary","description":"The ID of the SQL warehouse to start."}
   * @returns {Object}
   * @sampleResult {}
   */
  async startWarehouse(warehouseId) {
    return this.#apiRequest({
      path: `/api/2.0/sql/warehouses/${ encodeURIComponent(warehouseId) }/start`,
      method: 'post',
      logTag: 'startWarehouse',
    })
  }

  /**
   * @operationName Stop SQL Warehouse
   * @description Stops a running SQL warehouse to save cost. The call returns immediately; the warehouse transitions to STOPPED asynchronously.
   * @category SQL
   * @route POST /stop-warehouse
   *
   * @paramDef {"type":"String","label":"Warehouse ID","name":"warehouseId","required":true,"dictionary":"getWarehousesDictionary","description":"The ID of the SQL warehouse to stop."}
   * @returns {Object}
   * @sampleResult {}
   */
  async stopWarehouse(warehouseId) {
    return this.#apiRequest({
      path: `/api/2.0/sql/warehouses/${ encodeURIComponent(warehouseId) }/stop`,
      method: 'post',
      logTag: 'stopWarehouse',
    })
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Jobs
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * @operationName List Jobs
   * @description Lists jobs in the workspace with pagination. Optionally filter by job name and control whether each job's task definitions are expanded. Returns a next_page_token when more results are available.
   * @category Jobs
   * @route GET /list-jobs
   *
   * @paramDef {"type":"String","label":"Name Filter","name":"name","description":"Optional job name to filter by (case-insensitive contains match)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of jobs to return per page (1-100, default 20)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous response's next_page_token."}
   * @paramDef {"type":"Boolean","label":"Expand Tasks","name":"expandTasks","uiComponent":{"type":"TOGGLE"},"description":"Whether to include each job's task and cluster definitions in the response."}
   * @returns {Object}
   * @sampleResult {"jobs":[{"job_id":620916987432618,"settings":{"name":"Nightly ETL"}}],"has_more":false}
   */
  async listJobs(name, limit, pageToken, expandTasks) {
    const query = this.#compact({
      name,
      limit,
      page_token: pageToken,
      expand_tasks: expandTasks,
    })

    return this.#apiRequest({
      path: '/api/2.1/jobs/list',
      query,
      logTag: 'listJobs',
    })
  }

  /**
   * @operationName Get Job
   * @description Retrieves the full configuration of a single job, including its tasks, schedule, cluster settings, and parameters.
   * @category Jobs
   * @route GET /get-job
   *
   * @paramDef {"type":"String","label":"Job ID","name":"jobId","required":true,"dictionary":"getJobsDictionary","description":"The numeric ID of the job to retrieve."}
   * @returns {Object}
   * @sampleResult {"job_id":620916987432618,"settings":{"name":"Nightly ETL","tasks":[{"task_key":"main"}]}}
   */
  async getJob(jobId) {
    return this.#apiRequest({
      path: '/api/2.1/jobs/get',
      query: { job_id: jobId },
      logTag: 'getJob',
    })
  }

  /**
   * @operationName Run Job Now
   * @description Triggers an immediate run of an existing job and returns the new run_id. Optionally override parameters: provide Notebook Params (a map of key/value strings passed to notebook tasks) and/or Job Parameters (a map of job-level parameter values). Use Get Run to track the triggered run to completion.
   * @category Jobs
   * @route POST /run-job-now
   *
   * @paramDef {"type":"String","label":"Job ID","name":"jobId","required":true,"dictionary":"getJobsDictionary","description":"The numeric ID of the job to run."}
   * @paramDef {"type":"Object","label":"Notebook Params","name":"notebookParams","description":"Optional map of key/value string pairs passed to notebook tasks as widget values."}
   * @paramDef {"type":"Object","label":"Job Parameters","name":"jobParameters","description":"Optional map of job-level parameter names to values, overriding the job's defaults for this run."}
   * @returns {Object}
   * @sampleResult {"run_id":455644833,"number_in_job":455644833}
   */
  async runJobNow(jobId, notebookParams, jobParameters) {
    const body = this.#compact({
      job_id: this.#toJobId(jobId),
      notebook_params: notebookParams,
      job_parameters: jobParameters,
    })

    return this.#apiRequest({
      path: '/api/2.1/jobs/run-now',
      method: 'post',
      body,
      logTag: 'runJobNow',
    })
  }

  /**
   * @operationName List Job Runs
   * @description Lists runs for a specific job (or all jobs if no Job ID is given), with pagination. Optionally restrict to active or completed runs.
   * @category Jobs
   * @route GET /list-runs
   *
   * @paramDef {"type":"String","label":"Job ID","name":"jobId","dictionary":"getJobsDictionary","description":"Optional numeric job ID to list runs for. Omit to list runs across all jobs."}
   * @paramDef {"type":"Boolean","label":"Active Only","name":"activeOnly","uiComponent":{"type":"TOGGLE"},"description":"If true, return only runs that are currently active (pending or running)."}
   * @paramDef {"type":"Boolean","label":"Completed Only","name":"completedOnly","uiComponent":{"type":"TOGGLE"},"description":"If true, return only runs that have already completed."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of runs to return per page (1-25, default 20)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous response's next_page_token."}
   * @returns {Object}
   * @sampleResult {"runs":[{"run_id":455644833,"state":{"life_cycle_state":"TERMINATED","result_state":"SUCCESS"}}],"has_more":false}
   */
  async listRuns(jobId, activeOnly, completedOnly, limit, pageToken) {
    const query = this.#compact({
      job_id: jobId ? this.#toJobId(jobId) : undefined,
      active_only: activeOnly,
      completed_only: completedOnly,
      limit,
      page_token: pageToken,
    })

    return this.#apiRequest({
      path: '/api/2.1/jobs/runs/list',
      query,
      logTag: 'listRuns',
    })
  }

  /**
   * @operationName Get Run
   * @description Retrieves the metadata and current state of a single job run, including its lifecycle state, result state, tasks, and timing information.
   * @category Jobs
   * @route GET /get-run
   *
   * @paramDef {"type":"String","label":"Run ID","name":"runId","required":true,"description":"The numeric ID of the run to retrieve."}
   * @returns {Object}
   * @sampleResult {"run_id":455644833,"state":{"life_cycle_state":"TERMINATED","result_state":"SUCCESS"},"start_time":1700000000000}
   */
  async getRun(runId) {
    return this.#apiRequest({
      path: '/api/2.1/jobs/runs/get',
      query: { run_id: runId },
      logTag: 'getRun',
    })
  }

  /**
   * @operationName Get Run Output
   * @description Retrieves the output and result of a single task run, such as a notebook's exit value, SQL query output, or run error metadata. Applies to an individual task run rather than a multi-task parent run.
   * @category Jobs
   * @route GET /get-run-output
   *
   * @paramDef {"type":"String","label":"Run ID","name":"runId","required":true,"description":"The numeric ID of the task run to retrieve output for."}
   * @returns {Object}
   * @sampleResult {"notebook_output":{"result":"done","truncated":false},"metadata":{"run_id":455644833}}
   */
  async getRunOutput(runId) {
    return this.#apiRequest({
      path: '/api/2.1/jobs/runs/get-output',
      query: { run_id: runId },
      logTag: 'getRunOutput',
    })
  }

  /**
   * @operationName Cancel Run
   * @description Requests cancellation of an active job run. The run transitions to a TERMINATED lifecycle state with a CANCELED result state asynchronously; runs that have already completed are unaffected.
   * @category Jobs
   * @route POST /cancel-run
   *
   * @paramDef {"type":"String","label":"Run ID","name":"runId","required":true,"description":"The numeric ID of the run to cancel."}
   * @returns {Object}
   * @sampleResult {}
   */
  async cancelRun(runId) {
    return this.#apiRequest({
      path: '/api/2.1/jobs/runs/cancel',
      method: 'post',
      body: { run_id: this.#toRunId(runId) },
      logTag: 'cancelRun',
    })
  }

  #toJobId(jobId) {
    const n = Number(jobId)

    return Number.isNaN(n) ? jobId : n
  }

  #toRunId(runId) {
    const n = Number(runId)

    return Number.isNaN(n) ? runId : n
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Clusters
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * @operationName List Clusters
   * @description Lists all-purpose and job clusters in the workspace, including each cluster's ID, name, state (RUNNING, TERMINATED, PENDING, etc.), node type, and Spark version.
   * @category Clusters
   * @route GET /list-clusters
   *
   * @returns {Object}
   * @sampleResult {"clusters":[{"cluster_id":"0101-abc","cluster_name":"Shared","state":"RUNNING","node_type_id":"i3.xlarge"}]}
   */
  async listClusters() {
    return this.#apiRequest({
      path: '/api/2.0/clusters/list',
      logTag: 'listClusters',
    })
  }

  /**
   * @operationName Get Cluster
   * @description Retrieves detailed information about a single cluster, including its state, configuration, autoscaling settings, and Spark version.
   * @category Clusters
   * @route GET /get-cluster
   *
   * @paramDef {"type":"String","label":"Cluster ID","name":"clusterId","required":true,"description":"The ID of the cluster to retrieve."}
   * @returns {Object}
   * @sampleResult {"cluster_id":"0101-abc","cluster_name":"Shared","state":"RUNNING","spark_version":"13.3.x-scala2.12"}
   */
  async getCluster(clusterId) {
    return this.#apiRequest({
      path: '/api/2.0/clusters/get',
      query: { cluster_id: clusterId },
      logTag: 'getCluster',
    })
  }

  /**
   * @operationName Start Cluster
   * @description Starts a terminated cluster with its existing configuration. The call returns immediately; the cluster transitions through PENDING to RUNNING asynchronously (poll Get Cluster to confirm).
   * @category Clusters
   * @route POST /start-cluster
   *
   * @paramDef {"type":"String","label":"Cluster ID","name":"clusterId","required":true,"description":"The ID of the cluster to start."}
   * @returns {Object}
   * @sampleResult {}
   */
  async startCluster(clusterId) {
    return this.#apiRequest({
      path: '/api/2.0/clusters/start',
      method: 'post',
      body: { cluster_id: clusterId },
      logTag: 'startCluster',
    })
  }

  /**
   * @operationName Terminate Cluster
   * @description Terminates a running cluster. The cluster is not permanently deleted and can be restarted later with Start Cluster. The call returns immediately; termination completes asynchronously.
   * @category Clusters
   * @route POST /terminate-cluster
   *
   * @paramDef {"type":"String","label":"Cluster ID","name":"clusterId","required":true,"description":"The ID of the cluster to terminate."}
   * @returns {Object}
   * @sampleResult {}
   */
  async terminateCluster(clusterId) {
    return this.#apiRequest({
      path: '/api/2.0/clusters/delete',
      method: 'post',
      body: { cluster_id: clusterId },
      logTag: 'terminateCluster',
    })
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Unity Catalog
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * @operationName List Catalogs
   * @description Lists all Unity Catalog catalogs the caller can access in the metastore, including each catalog's name, owner, and comment.
   * @category Unity Catalog
   * @route GET /list-catalogs
   *
   * @returns {Object}
   * @sampleResult {"catalogs":[{"name":"main","owner":"account users","metastore_id":"abc"}]}
   */
  async listCatalogs() {
    return this.#apiRequest({
      path: '/api/2.1/unity-catalog/catalogs',
      logTag: 'listCatalogs',
    })
  }

  /**
   * @operationName List Schemas
   * @description Lists the schemas (databases) within a Unity Catalog catalog. Requires the catalog name.
   * @category Unity Catalog
   * @route GET /list-schemas
   *
   * @paramDef {"type":"String","label":"Catalog Name","name":"catalogName","required":true,"description":"The name of the catalog whose schemas to list."}
   * @returns {Object}
   * @sampleResult {"schemas":[{"name":"default","catalog_name":"main","full_name":"main.default"}]}
   */
  async listSchemas(catalogName) {
    return this.#apiRequest({
      path: '/api/2.1/unity-catalog/schemas',
      query: { catalog_name: catalogName },
      logTag: 'listSchemas',
    })
  }

  /**
   * @operationName List Tables
   * @description Lists the tables within a Unity Catalog schema. Requires both the catalog name and the schema name.
   * @category Unity Catalog
   * @route GET /list-tables
   *
   * @paramDef {"type":"String","label":"Catalog Name","name":"catalogName","required":true,"description":"The name of the catalog containing the schema."}
   * @paramDef {"type":"String","label":"Schema Name","name":"schemaName","required":true,"description":"The name of the schema whose tables to list."}
   * @returns {Object}
   * @sampleResult {"tables":[{"name":"customers","catalog_name":"main","schema_name":"default","full_name":"main.default.customers","table_type":"MANAGED"}]}
   */
  async listTables(catalogName, schemaName) {
    return this.#apiRequest({
      path: '/api/2.1/unity-catalog/tables',
      query: { catalog_name: catalogName, schema_name: schemaName },
      logTag: 'listTables',
    })
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DBFS / Workspace
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * @operationName List DBFS Path
   * @description Lists the contents of a directory in the Databricks File System (DBFS), returning each entry's path, whether it is a directory, and file size.
   * @category Files
   * @route GET /list-dbfs
   *
   * @paramDef {"type":"String","label":"Path","name":"path","required":true,"description":"The DBFS path to list, e.g. /FileStore or dbfs:/mnt/data."}
   * @returns {Object}
   * @sampleResult {"files":[{"path":"/FileStore/data.csv","is_dir":false,"file_size":1024}]}
   */
  async listDbfs(path) {
    return this.#apiRequest({
      path: '/api/2.0/dbfs/list',
      query: { path },
      logTag: 'listDbfs',
    })
  }

  /**
   * @operationName List Workspace Path
   * @description Lists the contents of a workspace directory, returning each object's path, type (NOTEBOOK, DIRECTORY, FILE, LIBRARY, REPO), and language for notebooks.
   * @category Files
   * @route GET /list-workspace
   *
   * @paramDef {"type":"String","label":"Path","name":"path","required":true,"description":"The workspace path to list, e.g. /Users/me@example.com or /Shared."}
   * @returns {Object}
   * @sampleResult {"objects":[{"path":"/Users/me/etl","object_type":"NOTEBOOK","language":"PYTHON"}]}
   */
  async listWorkspace(path) {
    return this.#apiRequest({
      path: '/api/2.0/workspace/list',
      query: { path },
      logTag: 'listWorkspace',
    })
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Current User
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * @operationName Get Current User
   * @description Returns the SCIM profile of the user or service principal associated with the API token, including user name, display name, and email. Useful as a connection and credential validity check.
   * @category Account
   * @route GET /get-current-user
   *
   * @returns {Object}
   * @sampleResult {"id":"1234567890","userName":"me@example.com","displayName":"Me","active":true}
   */
  async getCurrentUser() {
    return this.#apiRequest({
      path: '/api/2.0/preview/scim/v2/Me',
      logTag: 'getCurrentUser',
    })
  }
}

Flowrunner.ServerCode.addService(Databricks, [
  {
    name: 'workspaceUrl',
    displayName: 'Workspace URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Databricks workspace URL, e.g. https://dbc-abc123.cloud.databricks.com (strip any trailing slash).',
  },
  {
    name: 'apiToken',
    displayName: 'API Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'A Databricks personal access token. Generate it under Databricks → Settings → Developer → Access tokens.',
  },
])
