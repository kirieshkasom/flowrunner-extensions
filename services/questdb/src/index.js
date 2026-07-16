const logger = {
  info: (...args) => console.log('[QuestDB] info:', ...args),
  debug: (...args) => console.log('[QuestDB] debug:', ...args),
  error: (...args) => console.log('[QuestDB] error:', ...args),
  warn: (...args) => console.log('[QuestDB] warn:', ...args),
}

/**
 * @integrationName QuestDB
 * @integrationIcon /icon.png
 */
class QuestDBService {
  constructor(config) {
    this.url = (config.url || '').trim().replace(/\/+$/, '')
    this.username = config.username
    this.password = config.password
  }

  #authHeaders() {
    const headers = { 'Accept': 'application/json' }

    if (this.username || this.password) {
      const token = Buffer.from(`${ this.username || '' }:${ this.password || '' }`).toString('base64')

      headers.Authorization = `Basic ${ token }`
    }

    return headers
  }

  #clean(obj) {
    const result = {}

    for (const key in obj) {
      const value = obj[key]

      if (value !== undefined && value !== null && value !== '') {
        result[key] = value
      }
    }

    return result
  }

  // All external calls go through here. QuestDB returns the response body directly.
  async #apiRequest({ path, method = 'get', query, encoding, logTag }) {
    if (!this.url) {
      throw new Error('QuestDB API error: The REST endpoint URL is not configured.')
    }

    const target = `${ this.url }${ path }`

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ target }] q=${ JSON.stringify(this.#clean(query || {})) }`)

      let request = Flowrunner.Request[method.toLowerCase()](target)
        .set(this.#authHeaders())
        .query(this.#clean(query || {}))

      if (encoding !== undefined) {
        request = request.setEncoding(encoding)
      }

      return await request
    } catch (error) {
      // QuestDB reports SQL errors as HTTP 400 with { query, error, position }.
      const responseBody = error.body
      const sqlError = responseBody && typeof responseBody === 'object' ? responseBody.error : undefined
      const status = error.status || error.statusCode

      if (sqlError) {
        const position = responseBody.position
        const suffix = position !== undefined && position !== null ? ` (position ${ position })` : ''

        logger.error(`${ logTag } - SQL error [${ status }]: ${ sqlError }${ suffix }`)

        const detailed = new Error(`QuestDB SQL error [${ status }]: ${ sqlError }${ suffix }`)

        detailed.status = status
        detailed.position = position
        detailed.query = responseBody.query

        throw detailed
      }

      const message = (responseBody && responseBody.error) ||
        (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))

      logger.error(`${ logTag } - request failed [${ status }]: ${ message }`)

      throw new Error(`QuestDB API error [${ status || 'unknown' }]: ${ message }`)
    }
  }

  /**
   * @operationName Execute Query
   * @category Query
   * @description Runs a SQL statement against QuestDB via the REST /exec endpoint and returns the result as JSON. Use this for SELECT queries (returns a column definition list and a row dataset), as well as DDL (CREATE/DROP/ALTER TABLE) and DML (INSERT/UPDATE) statements. QuestDB is a high-performance time-series SQL database. The response includes the executed query, a columns array of {name, type}, a dataset of row arrays, a row count, and server-side timings. Optionally cap the number of returned rows with the limit parameter (either a single count like "100" or a 1-based inclusive range like "10,20").
   * @route GET /exec
   *
   * @paramDef {"type":"String","label":"SQL Query","name":"query","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The SQL statement to execute, e.g. SELECT * FROM trades WHERE symbol = 'BTC-USD' ORDER BY timestamp DESC. Supports SELECT, plus DDL and DML statements."}
   * @paramDef {"type":"String","label":"Row Limit","name":"limit","description":"Optional cap on returned rows. A single number (e.g. \"100\") returns the first N rows; a range (e.g. \"10,20\") returns rows 10 through 20 inclusive. Leave empty for the server default."}
   * @paramDef {"type":"Boolean","label":"Include Count","name":"count","uiComponent":{"type":"CHECKBOX"},"description":"When true, includes the total row count in the response. Defaults to true."}
   * @paramDef {"type":"Boolean","label":"Skip Metadata","name":"skipMetadata","uiComponent":{"type":"CHECKBOX"},"description":"When true, omits the columns metadata from the response for a smaller payload. Defaults to false."}
   *
   * @returns {Object}
   * @sampleResult {"query":"SELECT symbol, price, timestamp FROM trades LIMIT 2","columns":[{"name":"symbol","type":"SYMBOL"},{"name":"price","type":"DOUBLE"},{"name":"timestamp","type":"TIMESTAMP"}],"timestamp":2,"dataset":[["BTC-USD",42350.5,"2024-01-15T10:30:00.000000Z"],["ETH-USD",2510.75,"2024-01-15T10:30:01.000000Z"]],"count":2,"timings":{"compiler":38000,"execute":120000,"count":0}}
   */
  async executeQuery(query, limit, count, skipMetadata) {
    return await this.#apiRequest({
      logTag: '[executeQuery]',
      path: '/exec',
      method: 'get',
      query: {
        query,
        limit,
        count: count === false ? 'false' : 'true',
        nm: skipMetadata === true ? 'true' : undefined,
      },
    })
  }

  /**
   * @operationName Export Query as CSV
   * @category Query
   * @description Runs a SQL query against QuestDB via the REST /exp endpoint and returns the full result set as CSV text (with a header row). Use this when you need the raw tabular data for a file, spreadsheet, or downstream CSV processing rather than a JSON dataset. Optionally cap rows with the limit parameter (a single count like "1000" or a range like "10,20").
   * @route GET /export
   *
   * @paramDef {"type":"String","label":"SQL Query","name":"query","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The SELECT statement whose result set should be exported as CSV, e.g. SELECT * FROM trades WHERE timestamp > dateadd('d', -1, now())."}
   * @paramDef {"type":"String","label":"Row Limit","name":"limit","description":"Optional cap on returned rows. A single number (e.g. \"1000\") returns the first N rows; a range (e.g. \"10,20\") returns rows 10 through 20 inclusive. Leave empty for all rows."}
   *
   * @returns {String}
   * @sampleResult "symbol,price,timestamp\r\nBTC-USD,42350.5,2024-01-15T10:30:00.000000Z\r\nETH-USD,2510.75,2024-01-15T10:30:01.000000Z\r\n"
   */
  async exportQuery(query, limit) {
    const result = await this.#apiRequest({
      logTag: '[exportQuery]',
      path: '/exp',
      method: 'get',
      query: {
        query,
        limit,
      },
    })

    // /exp returns raw CSV text; normalize buffers to a string.
    return Buffer.isBuffer(result) ? result.toString('utf8') : result
  }

  /**
   * @operationName Check Health
   * @category System
   * @description Verifies connectivity and authentication to the QuestDB REST endpoint by executing a trivial query (SELECT 1) through /exec. Returns an object indicating whether the instance is reachable, the configured endpoint URL, and the round-trip latency in milliseconds. Use this to validate configuration before running real queries.
   * @route GET /health
   *
   * @returns {Object}
   * @sampleResult {"healthy":true,"url":"http://localhost:9000","latencyMs":12}
   */
  async checkHealth() {
    const startedAt = Date.now()

    await this.#apiRequest({
      logTag: '[checkHealth]',
      path: '/exec',
      method: 'get',
      query: { query: 'select 1', count: 'false' },
    })

    return {
      healthy: true,
      url: this.url,
      latencyMs: Date.now() - startedAt,
    }
  }
}

Flowrunner.ServerCode.addService(QuestDBService, [
  {
    name: 'url',
    displayName: 'REST Endpoint URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your QuestDB REST endpoint, e.g. http://host:9000 (strip any trailing slash).',
  },
  {
    name: 'username',
    displayName: 'Username',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Username for HTTP Basic auth (only if authentication is enabled on your QuestDB instance).',
  },
  {
    name: 'password',
    displayName: 'Password',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Password for HTTP Basic auth (only if authentication is enabled).',
  },
])
