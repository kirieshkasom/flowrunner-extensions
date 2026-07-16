const logger = {
  info: (...args) => console.log('[CrateDB] info:', ...args),
  debug: (...args) => console.log('[CrateDB] debug:', ...args),
  error: (...args) => console.log('[CrateDB] error:', ...args),
  warn: (...args) => console.log('[CrateDB] warn:', ...args),
}

/**
 * @integrationName CrateDB
 * @integrationIcon /icon.png
 */
class CrateDBService {
  constructor(config) {
    this.url = (config.url || '').replace(/\/+$/, '')
    this.username = config.username
    this.password = config.password
  }

  #buildHeaders() {
    const headers = { 'Content-Type': 'application/json' }

    if (this.username && this.password !== undefined && this.password !== null && this.password !== '') {
      const token = Buffer.from(`${ this.username }:${ this.password }`).toString('base64')

      headers['Authorization'] = `Basic ${ token }`
    } else if (this.username && this.password === '') {
      // Auth may still be required for the configured user even with a blank password.
      const token = Buffer.from(`${ this.username }:`).toString('base64')

      headers['Authorization'] = `Basic ${ token }`
    }

    return headers
  }

  // Single private request helper — all calls to the CrateDB HTTP endpoint go through here.
  async #sqlRequest({ body, withTypes, logTag }) {
    try {
      const url = `${ this.url }/_sql${ withTypes ? '?types' : '' }`

      logger.debug(`${ logTag } - [POST::${ url }] stmt=${ body && body.stmt }`)

      const request = Flowrunner.Request.post(url).set(this.#buildHeaders())

      return await request.send(body)
    } catch (error) {
      const crateError = error.body && error.body.error
      const message = (crateError && crateError.message) || error.message
      const code = crateError && crateError.code
      const status = error.status || error.statusCode

      logger.error(`${ logTag } - failed: ${ message } (code=${ code }, status=${ status })`)

      const parts = [`CrateDB error: ${ message }`]

      if (code !== undefined && code !== null) {
        parts.push(`(code ${ code })`)
      }

      if (status !== undefined && status !== null) {
        parts.push(`[HTTP ${ status }]`)
      }

      throw new Error(parts.join(' '))
    }
  }

  /**
   * @operationName Execute SQL
   * @category SQL
   * @description Runs a single SQL statement against CrateDB over the HTTP endpoint (POST /_sql). Use it for any operation — SELECT, INSERT, UPDATE, DELETE, or DDL such as CREATE/ALTER/DROP TABLE. Optionally pass positional parameters (bound to `?` or `$1`, `$2` placeholders in the statement) to safely inject values without string concatenation. Enable "Include Column Types" to also return the CrateDB data type IDs for each column. Returns the column names, result rows, affected row count, and query duration.
   * @route POST /execute-sql
   * @appearanceColor #50BFC3 #7DD6D9
   *
   * @paramDef {"type":"String","label":"SQL Statement","name":"stmt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The SQL statement to execute, e.g. SELECT * FROM my_table WHERE id = ?. A single statement per call."}
   * @paramDef {"type":"Array","label":"Parameters","name":"args","required":false,"description":"Optional positional parameters bound to ? or $1, $2 placeholders in the statement, in order. Example: [42, \"Earth\"]."}
   * @paramDef {"type":"Boolean","label":"Include Column Types","name":"includeTypes","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"When enabled, adds a col_types array of CrateDB data type IDs for each returned column (?types query parameter)."}
   *
   * @returns {Object}
   * @sampleResult {"cols":["id","name"],"col_types":[10,4],"rows":[[1337,"Earth"],[1338,"Sun"]],"rowcount":2,"duration":1.23}
   */
  async executeSQL(stmt, args, includeTypes) {
    const logTag = '[executeSQL]'
    const body = { stmt }

    if (Array.isArray(args) && args.length > 0) {
      body.args = args
    }

    return await this.#sqlRequest({ body, withTypes: Boolean(includeTypes), logTag })
  }

  /**
   * @operationName Execute Bulk SQL
   * @category SQL
   * @description Executes one parameterized SQL statement repeatedly against CrateDB in a single batched request (POST /_sql with bulk_args). Ideal for high-throughput INSERT, UPDATE, or DELETE operations — each inner array supplies one set of positional parameters for the `?` or `$1`, `$2` placeholders in the statement. CrateDB returns a `results` array with one entry per parameter set, each carrying its own rowcount (a rowcount of -2 indicates that row failed at runtime). Note: bulk operations do not return rows, so SELECT is not supported here.
   * @route POST /execute-bulk-sql
   * @appearanceColor #50BFC3 #7DD6D9
   *
   * @paramDef {"type":"String","label":"SQL Statement","name":"stmt","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A single parameterized statement applied to each parameter set, e.g. INSERT INTO locations (id, name) VALUES (?, ?)."}
   * @paramDef {"type":"Array<Array>","label":"Bulk Parameters","name":"bulkArgs","required":true,"description":"An array of parameter sets. Each inner array is one set of positional parameters matching the placeholders in the statement, e.g. [[1337, \"Earth\"], [1338, \"Sun\"]]."}
   *
   * @returns {Object}
   * @sampleResult {"cols":[],"results":[{"rowcount":1},{"rowcount":1}],"duration":2.45}
   */
  async executeBulkSQL(stmt, bulkArgs) {
    const logTag = '[executeBulkSQL]'
    const body = { stmt, bulk_args: Array.isArray(bulkArgs) ? bulkArgs : [] }

    return await this.#sqlRequest({ body, withTypes: false, logTag })
  }
}

Flowrunner.ServerCode.addService(CrateDBService, [
  {
    name: 'url',
    displayName: 'HTTP Endpoint URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your CrateDB HTTP endpoint, e.g. https://host:4200 (strip any trailing slash). The /_sql path is appended automatically.',
  },
  {
    name: 'username',
    displayName: 'Username',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    defaultValue: 'crate',
    shared: false,
    hint: "Database user (default 'crate'). Used with the password for HTTP Basic auth.",
  },
  {
    name: 'password',
    displayName: 'Password',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Database password. Leave blank if authentication is disabled.',
  },
])
