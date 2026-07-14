'use strict'

const crypto = require('node:crypto')

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'
const TOKEN_LIFETIME_SECONDS = 3600
const TOKEN_REFRESH_MARGIN_MS = 60000

const DEFAULT_QUERY_TIMEOUT_MS = 30000

const FIELD_TYPE_MAP = {
  'String': 'STRING',
  'Integer': 'INT64',
  'Float': 'FLOAT64',
  'Numeric': 'NUMERIC',
  'Big Numeric': 'BIGNUMERIC',
  'Boolean': 'BOOL',
  'Timestamp': 'TIMESTAMP',
  'Date': 'DATE',
  'Time': 'TIME',
  'DateTime': 'DATETIME',
  'Bytes': 'BYTES',
  'JSON': 'JSON',
  'Geography': 'GEOGRAPHY',
  'Record (Struct)': 'RECORD',
}

const FIELD_MODE_MAP = {
  'Nullable': 'NULLABLE',
  'Required': 'REQUIRED',
  'Repeated': 'REPEATED',
}

const logger = {
  info: (...args) => console.log('[Google BigQuery] info:', ...args),
  debug: (...args) => console.log('[Google BigQuery] debug:', ...args),
  error: (...args) => console.log('[Google BigQuery] error:', ...args),
  warn: (...args) => console.log('[Google BigQuery] warn:', ...args),
}

// ============================================================================
//  DICTIONARY PAYLOAD TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} getDatasetsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter datasets by ID."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for the next page of results."}
 */

/**
 * @typedef {Object} getTablesDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Dataset","name":"datasetId","description":"The dataset whose tables populate the list."}
 */

/**
 * @typedef {Object} getTablesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter tables by ID."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for the next page of results."}
 * @paramDef {"type":"getTablesDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The dataset whose tables to list."}
 */

/**
 * @typedef {Object} TableField
 * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Column name. Must start with a letter or underscore and contain only letters, numbers, and underscores (up to 300 characters)."}
 * @paramDef {"type":"String","label":"Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["String","Integer","Float","Numeric","Big Numeric","Boolean","Timestamp","Date","Time","DateTime","Bytes","JSON","Geography","Record (Struct)"]}},"description":"Column data type."}
 * @paramDef {"type":"String","label":"Mode","name":"mode","defaultValue":"Nullable","uiComponent":{"type":"DROPDOWN","options":{"values":["Nullable","Required","Repeated"]}},"description":"Column mode. 'Nullable' allows NULL values (default), 'Required' rejects NULLs, 'Repeated' makes the column an array."}
 * @paramDef {"type":"Array<Object>","label":"Nested Fields","name":"fields","description":"Child field definitions (same shape: name, type, mode) used only when Type is 'Record (Struct)'."}
 * @paramDef {"type":"String","label":"Description","name":"description","description":"Optional column description."}
 */

/**
 * @integrationName Google BigQuery
 * @integrationIcon /icon.svg
 */
class GoogleBigQuery {
  constructor(config) {
    this.serviceAccountKeyRaw = config.serviceAccountKey
    this.configuredProjectId = config.projectId
    this.location = (config.location || '').trim()

    this.accessToken = null
    this.accessTokenExpiresAt = 0
  }

  #getServiceAccountKey() {
    if (this.serviceAccountKey) {
      return this.serviceAccountKey
    }

    if (!this.serviceAccountKeyRaw) {
      throw new Error('Service account key is not configured')
    }

    let key

    try {
      key = JSON.parse(this.serviceAccountKeyRaw)
    } catch (error) {
      throw new Error('Service account key is not valid JSON. Paste the full contents of the JSON key file downloaded from Google Cloud.')
    }

    if (!key.client_email || !key.private_key) {
      throw new Error('Service account key is missing "client_email" or "private_key". Make sure you pasted the complete JSON key file.')
    }

    // Recover real newlines if the key was pasted with escaped "\n" sequences.
    if (!key.private_key.includes('\n')) {
      key.private_key = key.private_key.replace(/\\n/g, '\n')
    }

    this.serviceAccountKey = key

    return key
  }

  #getProjectId() {
    return this.configuredProjectId?.trim() || this.#getServiceAccountKey().project_id
  }

  #baseUrl() {
    const project = this.#getProjectId()

    if (!project) {
      throw new Error('Project ID could not be determined. Set the Project ID config item or use a key file containing "project_id".')
    }

    return `https://bigquery.googleapis.com/bigquery/v2/projects/${ encodeURIComponent(project) }`
  }

  #base64UrlEncode(input) {
    const base64 = Buffer.isBuffer(input) ? input.toString('base64') : Buffer.from(input).toString('base64')

    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  #buildSignedJwt(key) {
    const nowSeconds = Math.floor(Date.now() / 1000)

    const header = this.#base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const claims = this.#base64UrlEncode(JSON.stringify({
      iss: key.client_email,
      scope: CLOUD_PLATFORM_SCOPE,
      aud: TOKEN_URL,
      iat: nowSeconds,
      exp: nowSeconds + TOKEN_LIFETIME_SECONDS,
    }))

    const signingInput = `${ header }.${ claims }`
    const signatureBase64 = crypto.createSign('RSA-SHA256').update(signingInput).sign(key.private_key, 'base64')
    const signature = signatureBase64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

    return `${ signingInput }.${ signature }`
  }

  async #getAccessToken() {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) {
      return this.accessToken
    }

    const key = this.#getServiceAccountKey()

    logger.debug(`requesting access token for ${ key.client_email }`)

    let jwt

    try {
      jwt = this.#buildSignedJwt(key)
    } catch (error) {
      throw new Error(`Failed to sign the service account JWT: ${ error.message }. Check that "private_key" in the key file is intact.`)
    }

    const params = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    })

    let response

    try {
      response = await Flowrunner.Request.post(TOKEN_URL)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())
    } catch (error) {
      const message = error.body?.error_description || error.body?.error || error.message

      throw new Error(`Failed to obtain an access token from Google: ${ message }`)
    }

    if (!response.access_token) {
      throw new Error('Google token endpoint did not return an access token')
    }

    this.accessToken = response.access_token
    this.accessTokenExpiresAt = Date.now() + (response.expires_in || TOKEN_LIFETIME_SECONDS) * 1000

    return this.accessToken
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    const accessToken = await this.#getAccessToken()

    try {
      logger.debug(`${ logTag } - api request: [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method](url)
        .set({ 'Authorization': `Bearer ${ accessToken }`, 'Content-Type': 'application/json' })
        .query(this.#compactObject(query))

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const googleError = error.body?.error
      const reason = googleError?.errors?.[0]?.reason
      const message = googleError?.message || error.body?.message || error.message || 'API request failed'

      logger.error(`${ logTag } - error: ${ message }${ reason ? ` (reason: ${ reason })` : '' }`)

      throw new Error(`BigQuery API error: ${ message }${ reason ? ` (reason: ${ reason })` : '' }`)
    }
  }

  #compactObject(object) {
    const result = {}

    for (const [key, value] of Object.entries(object || {})) {
      if (value !== undefined && value !== null && value !== '') {
        result[key] = value
      }
    }

    return result
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // --------------------------------------------------------------------------
  //  Row conversion: BigQuery wire format {f:[{v}]} -> plain objects
  // --------------------------------------------------------------------------

  #convertScalar(value, type) {
    switch (type) {
      case 'INTEGER':

      case 'INT64': {
        const num = Number(value)

        return Number.isSafeInteger(num) ? num : value
      }

      case 'FLOAT':

      case 'FLOAT64': {
        const num = Number(value)

        return Number.isFinite(num) ? num : value
      }

      case 'BOOLEAN':
      case 'BOOL':
        return value === 'true' || value === true

      case 'TIMESTAMP': {
        const epochSeconds = Number(value)

        return Number.isFinite(epochSeconds) ? new Date(epochSeconds * 1000).toISOString() : value
      }

      default:
        return value
    }
  }

  #convertValue(value, field) {
    if (value === null || value === undefined) {
      return null
    }

    if (field.mode === 'REPEATED' && Array.isArray(value)) {
      return value.map(item => this.#convertValue(item?.v, { ...field, mode: 'NULLABLE' }))
    }

    if ((field.type === 'RECORD' || field.type === 'STRUCT') && field.fields && value?.f) {
      return this.#rowToObject(value, field.fields)
    }

    return this.#convertScalar(value, field.type)
  }

  #rowToObject(row, fields) {
    const result = {}

    fields.forEach((field, index) => {
      result[field.name] = this.#convertValue(row.f?.[index]?.v, field)
    })

    return result
  }

  #rowsToObjects(rows, schema) {
    const fields = schema?.fields || []

    return (rows || []).map(row => this.#rowToObject(row, fields))
  }

  #buildQueryParameters(params) {
    return Object.entries(params)
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => {
        let type = 'STRING'

        if (typeof value === 'number') {
          type = Number.isInteger(value) ? 'INT64' : 'FLOAT64'
        } else if (typeof value === 'boolean') {
          type = 'BOOL'
        }

        return {
          name,
          parameterType: { type },
          parameterValue: { value: value === null ? null : String(value) },
        }
      })
  }

  #mapSchemaField(field) {
    const mapped = this.#compactObject({
      name: field.name,
      type: this.#resolveChoice(field.type, FIELD_TYPE_MAP),
      mode: this.#resolveChoice(field.mode, FIELD_MODE_MAP),
      description: field.description,
    })

    if (field.fields && field.fields.length) {
      mapped.fields = field.fields.map(childField => this.#mapSchemaField(childField))
    }

    return mapped
  }

  #queryResponseToResult(response) {
    const jobId = response.jobReference?.jobId || null
    const location = response.jobReference?.location || null

    if (response.jobComplete === false) {
      return {
        jobComplete: false,
        jobId,
        location,
        pageToken: response.pageToken || null,
        message: 'The query has not finished yet. Call "Get Query Results" with this jobId to retrieve the results once the job completes.',
      }
    }

    return {
      jobComplete: true,
      jobId,
      location,
      rows: this.#rowsToObjects(response.rows, response.schema),
      totalRows: response.totalRows !== undefined ? Number(response.totalRows) : 0,
      pageToken: response.pageToken || null,
      totalBytesProcessed: response.totalBytesProcessed !== undefined ? Number(response.totalBytesProcessed) : null,
      cacheHit: response.cacheHit ?? null,
      numDmlAffectedRows: response.numDmlAffectedRows !== undefined ? Number(response.numDmlAffectedRows) : null,
    }
  }

  // ==========================================================================
  //  QUERIES
  // ==========================================================================

  /**
   * @operationName Run Query
   * @category Queries
   * @description Runs a GoogleSQL query and returns the result rows as plain JSON objects keyed by column name (BigQuery's wire format is converted automatically; INT64/FLOAT64/BOOL values are typed and TIMESTAMP values are returned as ISO 8601 strings). Supports named query parameters: reference them in SQL as @name (e.g. WHERE age > @minAge) and supply values in the Query Parameters object. Waits up to Timeout Ms for the query to finish; if it has not completed by then, returns jobComplete: false with a jobId to pass to 'Get Query Results'. DML statements (INSERT/UPDATE/DELETE/MERGE) are supported and report numDmlAffectedRows.
   * @route POST /run-query
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"SQL Query","name":"query","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The GoogleSQL query to run, e.g. SELECT name, age FROM `my_dataset.users` WHERE age > @minAge. Use @name placeholders for values supplied in Query Parameters."}
   * @paramDef {"type":"Object","label":"Query Parameters","name":"params","description":"Named query parameters as a {\"name\": value} object, referenced in the SQL as @name. Types are inferred from the JSON value: whole numbers become INT64, other numbers FLOAT64, booleans BOOL, and everything else STRING."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of rows to return in the first page. Additional rows are available via the returned pageToken and 'Get Query Results'."}
   * @paramDef {"type":"Number","label":"Timeout Ms","name":"timeoutMs","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How long to wait for the query to complete, in milliseconds (default 30000). If the query is still running after this time, jobComplete is false and results must be fetched with 'Get Query Results'."}
   *
   * @returns {Object}
   * @sampleResult {"jobComplete":true,"jobId":"job_x1AbC","location":"US","rows":[{"name":"Alice","age":30,"active":true}],"totalRows":1,"pageToken":null,"totalBytesProcessed":65536,"cacheHit":false,"numDmlAffectedRows":null}
   */
  async runQuery(query, params, maxResults, timeoutMs) {
    const body = {
      query,
      useLegacySql: false,
      timeoutMs: timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS,
    }

    if (maxResults !== undefined && maxResults !== null) {
      body.maxResults = maxResults
    }

    if (this.location) {
      body.location = this.location
    }

    if (params && Object.keys(params).length) {
      body.parameterMode = 'NAMED'
      body.queryParameters = this.#buildQueryParameters(params)
    }

    const response = await this.#apiRequest({
      url: `${ this.#baseUrl() }/queries`,
      method: 'post',
      body,
      logTag: 'runQuery',
    })

    return this.#queryResponseToResult(response)
  }

  /**
   * @operationName Get Query Results
   * @category Queries
   * @description Retrieves the results of a query job started by 'Run Query' — either to finish a query that returned jobComplete: false, or to fetch additional pages of a large result set using the pageToken from a previous call. Rows are returned as plain JSON objects keyed by column name, exactly like 'Run Query'. If the job is still running, returns jobComplete: false so you can retry.
   * @route GET /get-query-results
   *
   * @paramDef {"type":"String","label":"Job ID","name":"jobId","required":true,"description":"The query job ID returned by 'Run Query' (the jobId field of its result)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous 'Run Query' or 'Get Query Results' call to fetch the next page of rows."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of rows to return in this page."}
   *
   * @returns {Object}
   * @sampleResult {"jobComplete":true,"jobId":"job_x1AbC","location":"US","rows":[{"name":"Bob","age":25,"active":false}],"totalRows":420,"pageToken":"BFSGKPKPGV4WK===","totalBytesProcessed":1048576,"cacheHit":false,"numDmlAffectedRows":null}
   */
  async getQueryResults(jobId, pageToken, maxResults) {
    const response = await this.#apiRequest({
      url: `${ this.#baseUrl() }/queries/${ encodeURIComponent(jobId) }`,
      query: {
        pageToken,
        maxResults,
        location: this.location || undefined,
      },
      logTag: 'getQueryResults',
    })

    return this.#queryResponseToResult(response)
  }

  // ==========================================================================
  //  TABLE DATA
  // ==========================================================================

  /**
   * @operationName Insert Rows
   * @category Table Data
   * @description Streams rows into a BigQuery table via the insertAll API. Each row is a plain JSON object whose keys match the table's column names. Rows become available for querying within seconds, but note that streamed rows can take up to 90 minutes to become available for copy and export operations. Returns success: true when every row was accepted; otherwise success is false and insertErrors lists the zero-based index and error details of each rejected row.
   * @route POST /insert-rows
   *
   * @paramDef {"type":"String","label":"Dataset","name":"datasetId","required":true,"dictionary":"getDatasetsDictionary","description":"The dataset containing the target table."}
   * @paramDef {"type":"String","label":"Table","name":"tableId","required":true,"dictionary":"getTablesDictionary","dependsOn":["datasetId"],"description":"The table to insert rows into. Choose a dataset above to pick from its tables."}
   * @paramDef {"type":"Array<Object>","label":"Rows","name":"rows","required":true,"description":"The rows to insert, each a JSON object keyed by column name, e.g. [{\"name\":\"Alice\",\"age\":30}]."}
   * @paramDef {"type":"Boolean","label":"Skip Invalid Rows","name":"skipInvalidRows","uiComponent":{"type":"TOGGLE"},"description":"When enabled, valid rows are inserted even if some rows are invalid. When disabled (default), the entire request fails if any row is invalid."}
   * @paramDef {"type":"Boolean","label":"Ignore Unknown Values","name":"ignoreUnknownValues","uiComponent":{"type":"TOGGLE"},"description":"When enabled, row properties that do not match a table column are silently ignored. When disabled (default), unknown properties make the row invalid."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"insertedRowCount":2,"failedRowCount":0,"insertErrors":[]}
   */
  async insertRows(datasetId, tableId, rows, skipInvalidRows, ignoreUnknownValues) {
    if (!rows || !rows.length) {
      throw new Error('At least one row is required')
    }

    const body = {
      rows: rows.map(row => ({ json: row })),
    }

    if (skipInvalidRows !== undefined && skipInvalidRows !== null) {
      body.skipInvalidRows = skipInvalidRows
    }

    if (ignoreUnknownValues !== undefined && ignoreUnknownValues !== null) {
      body.ignoreUnknownValues = ignoreUnknownValues
    }

    const response = await this.#apiRequest({
      url: `${ this.#baseUrl() }/datasets/${ encodeURIComponent(datasetId) }/tables/${ encodeURIComponent(tableId) }/insertAll`,
      method: 'post',
      body,
      logTag: 'insertRows',
    })

    const insertErrors = response.insertErrors || []

    if (insertErrors.length) {
      logger.warn(`insertRows - ${ insertErrors.length } of ${ rows.length } rows were rejected`)
    }

    return {
      success: insertErrors.length === 0,
      insertedRowCount: rows.length - insertErrors.length,
      failedRowCount: insertErrors.length,
      insertErrors: insertErrors.map(insertError => ({
        index: insertError.index,
        errors: insertError.errors || [],
      })),
    }
  }

  /**
   * @operationName List Rows
   * @category Table Data
   * @description Reads rows directly from a BigQuery table without running a query (no query cost). Rows are returned as plain JSON objects keyed by column name, converted from BigQuery's wire format using the table's schema. Supports paging by row offset (Start Index) or by the pageToken returned from a previous call. For filtered or transformed reads, use 'Run Query' instead.
   * @route GET /list-rows
   *
   * @paramDef {"type":"String","label":"Dataset","name":"datasetId","required":true,"dictionary":"getDatasetsDictionary","description":"The dataset containing the table to read."}
   * @paramDef {"type":"String","label":"Table","name":"tableId","required":true,"dictionary":"getTablesDictionary","dependsOn":["datasetId"],"description":"The table to read rows from. Choose a dataset above to pick from its tables."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of rows to return in this page."}
   * @paramDef {"type":"Number","label":"Start Index","name":"startIndex","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based row offset to start reading from. Use either this or Page Token, not both."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous 'List Rows' call to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"rows":[{"name":"Alice","age":30,"active":true}],"totalRows":1250,"pageToken":"BGWA6VKPGV4WK==="}
   */
  async listRows(datasetId, tableId, maxResults, startIndex, pageToken) {
    const tableUrl = `${ this.#baseUrl() }/datasets/${ encodeURIComponent(datasetId) }/tables/${ encodeURIComponent(tableId) }`

    const table = await this.#apiRequest({
      url: tableUrl,
      logTag: 'listRows',
    })

    const response = await this.#apiRequest({
      url: `${ tableUrl }/data`,
      query: { maxResults, startIndex, pageToken },
      logTag: 'listRows',
    })

    return {
      rows: this.#rowsToObjects(response.rows, table.schema),
      totalRows: response.totalRows !== undefined ? Number(response.totalRows) : 0,
      pageToken: response.pageToken || null,
    }
  }

  // ==========================================================================
  //  DATASETS
  // ==========================================================================

  /**
   * @operationName List Datasets
   * @category Datasets
   * @description Lists the datasets in the project, returning each dataset's ID, location, full resource ID, and labels. Supports pagination for projects with many datasets.
   * @route GET /list-datasets
   *
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of datasets to return in this page."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous 'List Datasets' call to fetch the next page."}
   * @paramDef {"type":"Boolean","label":"Include Hidden","name":"all","uiComponent":{"type":"TOGGLE"},"description":"When enabled, also lists hidden datasets (those whose IDs begin with an underscore)."}
   *
   * @returns {Object}
   * @sampleResult {"datasets":[{"datasetId":"analytics","projectId":"my-project","location":"US","fullId":"my-project:analytics","labels":{"env":"prod"}}],"pageToken":null}
   */
  async listDatasets(maxResults, pageToken, all) {
    const response = await this.#apiRequest({
      url: `${ this.#baseUrl() }/datasets`,
      query: { maxResults, pageToken, all: all ? 'true' : undefined },
      logTag: 'listDatasets',
    })

    return {
      datasets: (response.datasets || []).map(dataset => ({
        datasetId: dataset.datasetReference?.datasetId,
        projectId: dataset.datasetReference?.projectId,
        location: dataset.location || null,
        fullId: dataset.id || null,
        labels: dataset.labels || {},
      })),
      pageToken: response.nextPageToken || null,
    }
  }

  /**
   * @operationName Create Dataset
   * @category Datasets
   * @description Creates a new dataset in the project. The dataset ID must be unique within the project and may contain only letters, numbers, and underscores (up to 1024 characters). The location is fixed at creation time and cannot be changed later; it defaults to the Location config item, or to US when neither is set.
   * @route POST /create-dataset
   *
   * @paramDef {"type":"String","label":"Dataset ID","name":"datasetId","required":true,"description":"ID for the new dataset, e.g. 'analytics'. Letters, numbers, and underscores only."}
   * @paramDef {"type":"String","label":"Location","name":"location","description":"Geographic location for the dataset's data, e.g. 'US', 'EU', or a region like 'us-central1'. Defaults to the Location config item, or 'US'. Cannot be changed after creation."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional human-readable description of the dataset."}
   *
   * @returns {Object}
   * @sampleResult {"datasetId":"analytics","projectId":"my-project","location":"US","fullId":"my-project:analytics","selfLink":"https://bigquery.googleapis.com/bigquery/v2/projects/my-project/datasets/analytics"}
   */
  async createDataset(datasetId, location, description) {
    const body = this.#compactObject({
      datasetReference: { projectId: this.#getProjectId(), datasetId },
      location: location || this.location || undefined,
      description,
    })

    const response = await this.#apiRequest({
      url: `${ this.#baseUrl() }/datasets`,
      method: 'post',
      body,
      logTag: 'createDataset',
    })

    return {
      datasetId: response.datasetReference?.datasetId,
      projectId: response.datasetReference?.projectId,
      location: response.location || null,
      fullId: response.id || null,
      selfLink: response.selfLink || null,
    }
  }

  /**
   * @operationName Delete Dataset
   * @category Datasets
   * @description Permanently deletes a dataset from the project. THIS IS DESTRUCTIVE AND CANNOT BE UNDONE. By default the request fails if the dataset still contains tables; enable Delete Contents to delete the dataset together with all of its tables, views, and data.
   * @route DELETE /delete-dataset
   *
   * @paramDef {"type":"String","label":"Dataset","name":"datasetId","required":true,"dictionary":"getDatasetsDictionary","description":"The dataset to delete permanently."}
   * @paramDef {"type":"Boolean","label":"Delete Contents","name":"deleteContents","uiComponent":{"type":"TOGGLE"},"description":"When enabled, deletes the dataset even if it still contains tables, removing all tables and their data. When disabled (default), deleting a non-empty dataset fails."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"datasetId":"analytics"}
   */
  async deleteDataset(datasetId, deleteContents) {
    await this.#apiRequest({
      url: `${ this.#baseUrl() }/datasets/${ encodeURIComponent(datasetId) }`,
      method: 'delete',
      query: { deleteContents: deleteContents ? 'true' : undefined },
      logTag: 'deleteDataset',
    })

    return { success: true, datasetId }
  }

  // ==========================================================================
  //  TABLES
  // ==========================================================================

  /**
   * @operationName List Tables
   * @category Tables
   * @description Lists the tables, views, and materialized views in a dataset, returning each object's ID, type, and creation time. Supports pagination for datasets with many tables.
   * @route GET /list-tables
   *
   * @paramDef {"type":"String","label":"Dataset","name":"datasetId","required":true,"dictionary":"getDatasetsDictionary","description":"The dataset whose tables to list."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tables to return in this page."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous 'List Tables' call to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"tables":[{"tableId":"events","datasetId":"analytics","projectId":"my-project","type":"TABLE","creationTime":"1736947200000"}],"totalItems":1,"pageToken":null}
   */
  async listTables(datasetId, maxResults, pageToken) {
    const response = await this.#apiRequest({
      url: `${ this.#baseUrl() }/datasets/${ encodeURIComponent(datasetId) }/tables`,
      query: { maxResults, pageToken },
      logTag: 'listTables',
    })

    return {
      tables: (response.tables || []).map(table => ({
        tableId: table.tableReference?.tableId,
        datasetId: table.tableReference?.datasetId,
        projectId: table.tableReference?.projectId,
        type: table.type || null,
        creationTime: table.creationTime || null,
      })),
      totalItems: response.totalItems ?? null,
      pageToken: response.nextPageToken || null,
    }
  }

  /**
   * @operationName Get Table
   * @category Tables
   * @description Retrieves a table's metadata: its full schema (column names, types, and modes), row count, size in bytes, type (table, view, or materialized view), description, and timestamps. Does not read any row data — use 'List Rows' or 'Run Query' for that.
   * @route GET /get-table
   *
   * @paramDef {"type":"String","label":"Dataset","name":"datasetId","required":true,"dictionary":"getDatasetsDictionary","description":"The dataset containing the table."}
   * @paramDef {"type":"String","label":"Table","name":"tableId","required":true,"dictionary":"getTablesDictionary","dependsOn":["datasetId"],"description":"The table to inspect. Choose a dataset above to pick from its tables."}
   *
   * @returns {Object}
   * @sampleResult {"tableId":"events","datasetId":"analytics","projectId":"my-project","type":"TABLE","schema":{"fields":[{"name":"name","type":"STRING","mode":"NULLABLE"},{"name":"age","type":"INTEGER","mode":"NULLABLE"}]},"numRows":1250,"numBytes":204800,"description":"User events","creationTime":"1736947200000","lastModifiedTime":"1736990400000","location":"US"}
   */
  async getTable(datasetId, tableId) {
    const response = await this.#apiRequest({
      url: `${ this.#baseUrl() }/datasets/${ encodeURIComponent(datasetId) }/tables/${ encodeURIComponent(tableId) }`,
      logTag: 'getTable',
    })

    return {
      tableId: response.tableReference?.tableId,
      datasetId: response.tableReference?.datasetId,
      projectId: response.tableReference?.projectId,
      type: response.type || null,
      schema: response.schema || { fields: [] },
      numRows: response.numRows !== undefined ? Number(response.numRows) : null,
      numBytes: response.numBytes !== undefined ? Number(response.numBytes) : null,
      description: response.description || null,
      creationTime: response.creationTime || null,
      lastModifiedTime: response.lastModifiedTime || null,
      location: response.location || null,
    }
  }

  /**
   * @operationName Create Table
   * @category Tables
   * @description Creates a new empty table in a dataset with the given column schema. Each schema field defines a column name, data type (String, Integer, Float, Numeric, Boolean, Timestamp, Date, JSON, Record, etc.), and mode (Nullable, Required, or Repeated). Record columns can define nested child fields. The table ID must be unique within the dataset.
   * @route POST /create-table
   *
   * @paramDef {"type":"String","label":"Dataset","name":"datasetId","required":true,"dictionary":"getDatasetsDictionary","description":"The dataset to create the table in."}
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"description":"ID for the new table, e.g. 'events'. Letters, numbers, and underscores only."}
   * @paramDef {"type":"Array<TableField>","label":"Schema Fields","name":"schemaFields","required":true,"description":"The table's column definitions."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional human-readable description of the table."}
   *
   * @returns {Object}
   * @sampleResult {"tableId":"events","datasetId":"analytics","projectId":"my-project","type":"TABLE","schema":{"fields":[{"name":"name","type":"STRING","mode":"NULLABLE"},{"name":"age","type":"INT64","mode":"NULLABLE"}]},"selfLink":"https://bigquery.googleapis.com/bigquery/v2/projects/my-project/datasets/analytics/tables/events"}
   */
  async createTable(datasetId, tableId, schemaFields, description) {
    if (!schemaFields || !schemaFields.length) {
      throw new Error('At least one schema field is required')
    }

    const body = this.#compactObject({
      tableReference: { projectId: this.#getProjectId(), datasetId, tableId },
      schema: { fields: schemaFields.map(field => this.#mapSchemaField(field)) },
      description,
    })

    const response = await this.#apiRequest({
      url: `${ this.#baseUrl() }/datasets/${ encodeURIComponent(datasetId) }/tables`,
      method: 'post',
      body,
      logTag: 'createTable',
    })

    return {
      tableId: response.tableReference?.tableId,
      datasetId: response.tableReference?.datasetId,
      projectId: response.tableReference?.projectId,
      type: response.type || null,
      schema: response.schema || { fields: [] },
      selfLink: response.selfLink || null,
    }
  }

  /**
   * @operationName Delete Table
   * @category Tables
   * @description Permanently deletes a table and all of its data from a dataset. THIS IS DESTRUCTIVE AND CANNOT BE UNDONE (recovery is only possible within the dataset's time-travel window via SQL, typically 7 days).
   * @route DELETE /delete-table
   *
   * @paramDef {"type":"String","label":"Dataset","name":"datasetId","required":true,"dictionary":"getDatasetsDictionary","description":"The dataset containing the table to delete."}
   * @paramDef {"type":"String","label":"Table","name":"tableId","required":true,"dictionary":"getTablesDictionary","dependsOn":["datasetId"],"description":"The table to delete permanently, together with all of its data."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"datasetId":"analytics","tableId":"events"}
   */
  async deleteTable(datasetId, tableId) {
    await this.#apiRequest({
      url: `${ this.#baseUrl() }/datasets/${ encodeURIComponent(datasetId) }/tables/${ encodeURIComponent(tableId) }`,
      method: 'delete',
      logTag: 'deleteTable',
    })

    return { success: true, datasetId, tableId }
  }

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================

  /**
   * @registerAs DICTIONARY
   * @operationName Get Datasets Dictionary
   * @description Lists the project's datasets for selection in dependent parameters.
   * @route POST /get-datasets-dictionary
   * @paramDef {"type":"getDatasetsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"analytics","value":"analytics","note":"US"}],"cursor":null}
   */
  async getDatasetsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      url: `${ this.#baseUrl() }/datasets`,
      query: { maxResults: 1000, pageToken: cursor },
      logTag: 'getDatasetsDictionary',
    })

    const searchLower = (search || '').toLowerCase()

    const items = (response.datasets || [])
      .map(dataset => ({
        label: dataset.datasetReference?.datasetId || '',
        value: dataset.datasetReference?.datasetId || '',
        note: dataset.location || '',
      }))
      .filter(item => !searchLower || item.label.toLowerCase().includes(searchLower))

    return { items, cursor: response.nextPageToken || null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tables Dictionary
   * @description Lists the tables of a chosen dataset for selection in dependent parameters.
   * @route POST /get-tables-dictionary
   * @paramDef {"type":"getTablesDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the dataset criteria whose tables to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"events","value":"events","note":"TABLE"}],"cursor":null}
   */
  async getTablesDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const datasetId = criteria?.datasetId

    if (!datasetId) {
      return { items: [] }
    }

    const response = await this.#apiRequest({
      url: `${ this.#baseUrl() }/datasets/${ encodeURIComponent(datasetId) }/tables`,
      query: { maxResults: 1000, pageToken: cursor },
      logTag: 'getTablesDictionary',
    })

    const searchLower = (search || '').toLowerCase()

    const items = (response.tables || [])
      .map(table => ({
        label: table.tableReference?.tableId || '',
        value: table.tableReference?.tableId || '',
        note: table.type || '',
      }))
      .filter(item => !searchLower || item.label.toLowerCase().includes(searchLower))

    return { items, cursor: response.nextPageToken || null }
  }

}

Flowrunner.ServerCode.addService(GoogleBigQuery, [
  {
    name: 'serviceAccountKey',
    displayName: 'Service Account Key (JSON)',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.TEXT,
    required: true,
    shared: false,
    hint: 'Paste the full JSON key file of a Google Cloud service account with the "BigQuery Job User" and "BigQuery Data Editor" roles. Create one under IAM & Admin > Service Accounts > Keys.',
  },
  {
    name: 'projectId',
    displayName: 'Project ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Google Cloud project ID to bill queries against. Defaults to the "project_id" from the service account key file.',
  },
  {
    name: 'location',
    displayName: 'Location',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Dataset location such as "US", "EU", or a region like "us-central1". Needed when querying datasets stored outside the US multi-region; also used as the default location for new datasets.',
  },
])
