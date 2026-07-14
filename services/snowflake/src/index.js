const logger = {
  info: (...args) => console.log('[Snowflake] info:', ...args),
  debug: (...args) => console.log('[Snowflake] debug:', ...args),
  error: (...args) => console.log('[Snowflake] error:', ...args),
  warn: (...args) => console.log('[Snowflake] warn:', ...args),
}

const DEFAULT_STATEMENT_TIMEOUT_SECONDS = 60

// ============================================================================
//  DICTIONARY PAYLOAD TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} getDatabasesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter databases by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getSchemasDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Database","name":"database","description":"The database whose schemas populate the list."}
 */

/**
 * @typedef {Object} getSchemasDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter schemas by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 * @paramDef {"type":"getSchemasDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The database whose schemas to list."}
 */

/**
 * @typedef {Object} getTablesDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Database","name":"database","description":"The database containing the schema."}
 * @paramDef {"type":"String","label":"Schema","name":"schema","description":"The schema whose tables populate the list."}
 */

/**
 * @typedef {Object} getTablesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter tables by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 * @paramDef {"type":"getTablesDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The database and schema whose tables to list."}
 */

/**
 * @typedef {Object} getWarehousesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter warehouses by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @integrationName Snowflake
 * @integrationIcon /icon.svg
 */
class Snowflake {
  constructor(config) {
    this.config = config || {}

    // Accept both a bare identifier ("myorg-myaccount", "xy12345.us-east-1") and a pasted
    // account URL; strip protocol and the .snowflakecomputing.com suffix. Underscores in
    // account locators are not valid in hostnames and must become hyphens.
    this.accountIdentifier = String(this.config.accountIdentifier || '')
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\.snowflakecomputing\.com.*$/i, '')
      .replace(/\/.*$/, '')
      .replace(/_/g, '-')

    this.token = (this.config.token || '').trim()
    this.database = (this.config.database || '').trim()
    this.schema = (this.config.schema || '').trim()
    this.warehouse = (this.config.warehouse || '').trim()
    this.role = (this.config.role || '').trim()
  }

  // ==========================================================================
  //  CORE
  // ==========================================================================
  #baseUrl() {
    if (!this.accountIdentifier) {
      throw new Error(
        'Snowflake error: Account Identifier is not configured. ' +
        'Set it to the part of your account URL before ".snowflakecomputing.com" ' +
        '(e.g. myorg-myaccount or xy12345.us-east-1).'
      )
    }

    return `https://${ this.accountIdentifier }.snowflakecomputing.com/api/v2`
  }

  // Single request helper - all Snowflake SQL API calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.token }`,
          'X-Snowflake-Authorization-Token-Type': 'PROGRAMMATIC_ACCESS_TOKEN',
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'flowrunner-snowflake/1.0',
        })
        .query(query || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const details = error.body || {}
      const parts = [details.message || error.message]

      if (details.code) parts.push(`code: ${ details.code }`)
      if (details.sqlState) parts.push(`sqlState: ${ details.sqlState }`)

      const message = parts.join(' | ')

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Snowflake API error: ${ message }`)
    }
  }

  // Quotes a single Snowflake identifier (database, schema, table). Identifiers cannot be
  // bound as query parameters, so they are escaped with double-quote doubling.
  #quoteIdent(name) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error(`Invalid identifier: ${ JSON.stringify(name) }. Identifiers must be non-empty strings.`)
    }

    return `"${ name.trim().replace(/"/g, '""') }"`
  }

  #requireValue(value, label) {
    const resolved = (value || '').trim()

    if (!resolved) {
      throw new Error(`${ label } is required. Provide it as a parameter or set a default in the service configuration.`)
    }

    return resolved
  }

  // Resolves execution context (database/schema/warehouse/role), letting per-request
  // parameters override the configured defaults. Empty values are omitted entirely.
  #buildContext({ database, schema, warehouse, role } = {}) {
    const context = {}
    const resolvedDatabase = (database || this.database || '').trim()
    const resolvedSchema = (schema || this.schema || '').trim()
    const resolvedWarehouse = (warehouse || this.warehouse || '').trim()
    const resolvedRole = (role || this.role || '').trim()

    if (resolvedDatabase) context.database = resolvedDatabase
    if (resolvedSchema) context.schema = resolvedSchema
    if (resolvedWarehouse) context.warehouse = resolvedWarehouse
    if (resolvedRole) context.role = resolvedRole

    return context
  }

  // Converts a positional parameter array into the SQL API bindings object:
  // ["a", 1, 2.5, true] -> {"1":{type:"TEXT",value:"a"},"2":{type:"FIXED",value:"1"},...}.
  // Binding values must always be strings per the SQL API contract.
  #buildBindings(params) {
    if (!Array.isArray(params) || !params.length) return undefined

    const bindings = {}

    params.forEach((value, index) => {
      const key = String(index + 1)

      if (value === null || value === undefined) {
        bindings[key] = { type: 'TEXT', value: null }
      } else if (typeof value === 'boolean') {
        bindings[key] = { type: 'BOOLEAN', value: String(value) }
      } else if (typeof value === 'number') {
        bindings[key] = { type: Number.isInteger(value) ? 'FIXED' : 'REAL', value: String(value) }
      } else if (typeof value === 'object') {
        bindings[key] = { type: 'TEXT', value: JSON.stringify(value) }
      } else {
        bindings[key] = { type: 'TEXT', value: String(value) }
      }
    })

    return bindings
  }

  // The SQL API returns results as resultSetMetaData.rowType[] (column descriptors) plus
  // data as an array of arrays of strings. Converts that into plain row objects keyed by
  // column name, with light type coercion (numbers/booleans) for common column types.
  #rowsToObjects(rowType, data) {
    const columns = rowType || []

    return (data || []).map(row => {
      const record = {}

      columns.forEach((column, index) => {
        record[column.name] = this.#coerceValue(row[index], column)
      })

      return record
    })
  }

  #coerceValue(value, column) {
    if (value === null || value === undefined) return null

    const type = String(column.type || '').toLowerCase()

    if (type === 'boolean') {
      return value === 'true' || value === '1'
    }

    if (type === 'fixed' || type === 'real' || type === 'float' || type === 'double') {
      const numeric = Number(value)

      // Only coerce when the conversion is lossless; very large NUMBER(38,0) values
      // (e.g. IDs) that would lose precision stay as strings.
      return Number.isFinite(numeric) && String(numeric) === String(value) ? numeric : value
    }

    return value
  }

  // A 202-style body (statement still executing) has a statementHandle but no result set.
  #isInProgress(response) {
    return !!response && !response.resultSetMetaData && !!response.statementHandle
  }

  #formatResult(response) {
    const metadata = response.resultSetMetaData || {}
    const rows = this.#rowsToObjects(metadata.rowType, response.data)
    const partitions = metadata.partitionInfo || []

    const result = {
      rows,
      rowCount: typeof metadata.numRows === 'number' ? metadata.numRows : rows.length,
      returnedRowCount: rows.length,
      statementHandle: response.statementHandle || null,
    }

    if (partitions.length > 1) {
      result.partitionCount = partitions.length
      result.partitions = partitions.map((partition, index) => ({ partition: index, rowCount: partition.rowCount }))

      result.note =
        'The result set is split into multiple partitions; only partition 0 is included in "rows". ' +
        'Use Get Statement Results with this statementHandle and a partition number to fetch the rest.'
    }

    return result
  }

  // Runs a statement synchronously (used by the metadata convenience actions and
  // dictionaries) and returns the converted row objects.
  async #executeStatement(statement, logTag, context = {}) {
    const response = await this.#apiRequest({
      url: `${ this.#baseUrl() }/statements`,
      method: 'post',
      query: { async: false },
      body: {
        statement,
        timeout: DEFAULT_STATEMENT_TIMEOUT_SECONDS,
        ...this.#buildContext(context),
      },
      logTag,
    })

    if (this.#isInProgress(response)) {
      throw new Error(
        `Snowflake API error: statement is still executing (handle ${ response.statementHandle }). ` +
        'Use Get Statement Results to retrieve it once complete.'
      )
    }

    const metadata = response.resultSetMetaData || {}

    return this.#rowsToObjects(metadata.rowType, response.data)
  }

  #filterBySearch(rows, search, key = 'name') {
    if (!search) return rows

    const needle = String(search).toLowerCase()

    return rows.filter(row => String(row[key] || '').toLowerCase().includes(needle))
  }

  // ==========================================================================
  //  SQL
  // ==========================================================================
  /**
   * @operationName Execute SQL
   * @description Executes a SQL statement (SELECT, INSERT, UPDATE, DELETE, MERGE, DDL, CALL, SHOW, etc.) via the Snowflake SQL API. Use ? positional placeholders together with the Parameters array to safely bind values - never interpolate user input into the SQL string (binding is not supported in multi-statement requests). Results are converted from Snowflake's columnar wire format into plain row objects keyed by column name, with numbers and booleans coerced to native types. If the statement does not finish within the API's synchronous window (~45 seconds), the action returns {"inProgress": true} with a statementHandle - poll Get Statement Results with that handle to retrieve the rows. Result sets larger than one partition include partition info; fetch the remaining partitions with Get Statement Results.
   * @category SQL
   * @route POST /execute-sql
   * @appearanceColor #29B5E8 #56CCF2
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Statement","name":"statement","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The SQL statement to execute. Use ? placeholders for values bound via the Parameters array."}
   * @paramDef {"type":"Array","label":"Parameters","name":"params","description":"Values for the ? placeholders, in order (e.g. [\"ada@example.com\", 30, true]). Elements may be strings, numbers, booleans or null; types are inferred automatically (TEXT, FIXED, REAL, BOOLEAN)."}
   * @paramDef {"type":"String","label":"Database","name":"database","dictionary":"getDatabasesDictionary","description":"Database to run the statement in. Overrides the configured default. Case-sensitive; must match the name shown by SHOW DATABASES."}
   * @paramDef {"type":"String","label":"Schema","name":"schema","dictionary":"getSchemasDictionary","dependsOn":["database"],"description":"Schema to run the statement in. Overrides the configured default."}
   * @paramDef {"type":"String","label":"Warehouse","name":"warehouse","dictionary":"getWarehousesDictionary","description":"Virtual warehouse that provides compute for the statement. Overrides the configured default."}
   * @paramDef {"type":"String","label":"Role","name":"role","description":"Role to use for the statement. Overrides the configured default."}
   * @paramDef {"type":"Number","label":"Timeout (seconds)","name":"timeout","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum execution time for the statement in seconds. Defaults to the account's STATEMENT_TIMEOUT_IN_SECONDS parameter."}
   * @returns {Object}
   * @sampleResult {"rows":[{"ID":1,"NAME":"Ada","ACTIVE":true}],"rowCount":1,"returnedRowCount":1,"statementHandle":"01b2c3d4-0000-1234-0000-000000000000"}
   */
  async executeSql(statement, params, database, schema, warehouse, role, timeout) {
    if (typeof statement !== 'string' || !statement.trim()) {
      throw new Error('SQL statement is required.')
    }

    const body = {
      statement,
      ...this.#buildContext({ database, schema, warehouse, role }),
    }

    const timeoutSeconds = parseInt(timeout, 10)

    if (timeoutSeconds > 0) body.timeout = timeoutSeconds

    const bindings = this.#buildBindings(params)

    if (bindings) body.bindings = bindings

    const response = await this.#apiRequest({
      url: `${ this.#baseUrl() }/statements`,
      method: 'post',
      query: { async: false },
      body,
      logTag: 'executeSql',
    })

    if (this.#isInProgress(response)) {
      return {
        inProgress: true,
        statementHandle: response.statementHandle,
        message:
          'The statement is still executing. Call Get Statement Results with this statementHandle ' +
          'to retrieve the results once it completes.',
      }
    }

    return this.#formatResult(response)
  }

  /**
   * @operationName Get Statement Results
   * @description Retrieves the status and results of a previously submitted statement by its handle. Returns {"inProgress": true} while the statement is still executing. For large result sets Snowflake splits the data into partitions: partition 0 is returned by default, and each additional partition can be fetched by passing its number. Rows are converted into plain objects keyed by column name.
   * @category SQL
   * @route GET /statement-results
   * @appearanceColor #29B5E8 #56CCF2
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Statement Handle","name":"statementHandle","required":true,"description":"The statementHandle returned by Execute SQL."}
   * @paramDef {"type":"Number","label":"Partition","name":"partition","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based result partition to fetch (default 0). The partition list is included in the Execute SQL result for multi-partition result sets."}
   * @returns {Object}
   * @sampleResult {"rows":[{"ID":2,"NAME":"Linus"}],"rowCount":150000,"returnedRowCount":4096,"statementHandle":"01b2c3d4-0000-1234-0000-000000000000","partition":1}
   */
  async getStatementResults(statementHandle, partition) {
    const handle = this.#requireValue(statementHandle, 'Statement Handle')
    const partitionNumber = parseInt(partition, 10) || 0
    const url = `${ this.#baseUrl() }/statements/${ encodeURIComponent(handle) }`

    const response = await this.#apiRequest({
      url,
      method: 'get',
      query: { partition: partitionNumber },
      logTag: 'getStatementResults',
    })

    if (this.#isInProgress(response)) {
      return {
        inProgress: true,
        statementHandle: handle,
        message: 'The statement is still executing. Retry Get Statement Results shortly.',
      }
    }

    // Partition responses beyond 0 may omit the column metadata; fetch it from
    // partition 0 so rows can still be converted into named objects.
    let rowType = response.resultSetMetaData && response.resultSetMetaData.rowType

    if (!rowType && partitionNumber > 0) {
      const first = await this.#apiRequest({ url, method: 'get', logTag: 'getStatementResults(metadata)' })

      rowType = first.resultSetMetaData && first.resultSetMetaData.rowType
    }

    const merged = {
      ...response,
      resultSetMetaData: { ...(response.resultSetMetaData || {}), rowType },
      statementHandle: response.statementHandle || handle,
    }

    return { ...this.#formatResult(merged), partition: partitionNumber }
  }

  /**
   * @operationName Cancel Statement
   * @description Cancels a running statement by its handle. Useful for stopping long-running queries submitted with Execute SQL that returned an inProgress response. Returns Snowflake's confirmation message.
   * @category SQL
   * @route POST /cancel-statement
   * @appearanceColor #29B5E8 #56CCF2
   * @paramDef {"type":"String","label":"Statement Handle","name":"statementHandle","required":true,"description":"The statementHandle of the running statement to cancel."}
   * @returns {Object}
   * @sampleResult {"statementHandle":"01b2c3d4-0000-1234-0000-000000000000","message":"successfully canceled","code":"090001","sqlState":"00000"}
   */
  async cancelStatement(statementHandle) {
    const handle = this.#requireValue(statementHandle, 'Statement Handle')

    const response = await this.#apiRequest({
      url: `${ this.#baseUrl() }/statements/${ encodeURIComponent(handle) }/cancel`,
      method: 'post',
      body: {},
      logTag: 'cancelStatement',
    })

    return {
      statementHandle: response.statementHandle || handle,
      message: response.message || null,
      code: response.code || null,
      sqlState: response.sqlState || null,
    }
  }

  // ==========================================================================
  //  METADATA
  // ==========================================================================
  /**
   * @operationName List Databases
   * @description Lists all databases visible to the configured role using SHOW DATABASES, including each database's name, owner, origin, comment and creation time.
   * @category Metadata
   * @route GET /databases
   * @appearanceColor #29B5E8 #56CCF2
   * @returns {Object}
   * @sampleResult {"databases":[{"name":"ANALYTICS","owner":"SYSADMIN","kind":"STANDARD","comment":""}],"count":1}
   */
  async listDatabases() {
    const rows = await this.#executeStatement('SHOW DATABASES', 'listDatabases')

    return { databases: rows, count: rows.length }
  }

  /**
   * @operationName List Schemas
   * @description Lists all schemas in a database using SHOW SCHEMAS IN DATABASE, including each schema's name, owner and comment. Uses the configured default database when none is provided.
   * @category Metadata
   * @route GET /schemas
   * @appearanceColor #29B5E8 #56CCF2
   * @paramDef {"type":"String","label":"Database","name":"database","dictionary":"getDatabasesDictionary","description":"The database whose schemas to list. Defaults to the database configured for the service."}
   * @returns {Object}
   * @sampleResult {"database":"ANALYTICS","schemas":[{"name":"PUBLIC","owner":"SYSADMIN","comment":""}],"count":1}
   */
  async listSchemas(database) {
    const resolvedDatabase = this.#requireValue(database || this.database, 'Database')

    const rows = await this.#executeStatement(
      `SHOW SCHEMAS IN DATABASE ${ this.#quoteIdent(resolvedDatabase) }`,
      'listSchemas'
    )

    return { database: resolvedDatabase, schemas: rows, count: rows.length }
  }

  /**
   * @operationName List Tables
   * @description Lists all tables in a schema using SHOW TABLES IN SCHEMA, including each table's name, kind, row count, size in bytes, owner and comment. Uses the configured default database/schema when not provided.
   * @category Metadata
   * @route GET /tables
   * @appearanceColor #29B5E8 #56CCF2
   * @paramDef {"type":"String","label":"Database","name":"database","dictionary":"getDatabasesDictionary","description":"The database containing the schema. Defaults to the database configured for the service."}
   * @paramDef {"type":"String","label":"Schema","name":"schema","dictionary":"getSchemasDictionary","dependsOn":["database"],"description":"The schema whose tables to list. Defaults to the schema configured for the service."}
   * @returns {Object}
   * @sampleResult {"database":"ANALYTICS","schema":"PUBLIC","tables":[{"name":"ORDERS","kind":"TABLE","rows":1500,"owner":"SYSADMIN"}],"count":1}
   */
  async listTables(database, schema) {
    const resolvedDatabase = this.#requireValue(database || this.database, 'Database')
    const resolvedSchema = this.#requireValue(schema || this.schema, 'Schema')

    const rows = await this.#executeStatement(
      `SHOW TABLES IN SCHEMA ${ this.#quoteIdent(resolvedDatabase) }.${ this.#quoteIdent(resolvedSchema) }`,
      'listTables'
    )

    return { database: resolvedDatabase, schema: resolvedSchema, tables: rows, count: rows.length }
  }

  /**
   * @operationName List Warehouses
   * @description Lists all virtual warehouses visible to the configured role using SHOW WAREHOUSES, including each warehouse's name, state (STARTED/SUSPENDED), size and owner. Useful for choosing the compute to run statements on.
   * @category Metadata
   * @route GET /warehouses
   * @appearanceColor #29B5E8 #56CCF2
   * @returns {Object}
   * @sampleResult {"warehouses":[{"name":"COMPUTE_WH","state":"STARTED","size":"X-Small","owner":"SYSADMIN"}],"count":1}
   */
  async listWarehouses() {
    const rows = await this.#executeStatement('SHOW WAREHOUSES', 'listWarehouses')

    return { warehouses: rows, count: rows.length }
  }

  /**
   * @operationName Get Table Schema
   * @description Returns the column definitions of a table using DESCRIBE TABLE: column name, Snowflake data type, nullability, default expression, and primary/unique key flags. Useful for discovering a table's structure before reading or writing. Uses the configured default database/schema when not provided.
   * @category Metadata
   * @route GET /table-schema
   * @appearanceColor #29B5E8 #56CCF2
   * @paramDef {"type":"String","label":"Database","name":"database","dictionary":"getDatabasesDictionary","description":"The database containing the table. Defaults to the database configured for the service."}
   * @paramDef {"type":"String","label":"Schema","name":"schema","dictionary":"getSchemasDictionary","dependsOn":["database"],"description":"The schema containing the table. Defaults to the schema configured for the service."}
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","dependsOn":["database","schema"],"description":"The table to describe."}
   * @returns {Object}
   * @sampleResult {"database":"ANALYTICS","schema":"PUBLIC","table":"ORDERS","columns":[{"name":"ID","type":"NUMBER(38,0)","nullable":false,"default":null,"primaryKey":true,"uniqueKey":false,"comment":null}],"count":1}
   */
  async getTableSchema(database, schema, table) {
    const resolvedDatabase = this.#requireValue(database || this.database, 'Database')
    const resolvedSchema = this.#requireValue(schema || this.schema, 'Schema')
    const resolvedTable = this.#requireValue(table, 'Table')

    const qualified =
      `${ this.#quoteIdent(resolvedDatabase) }.${ this.#quoteIdent(resolvedSchema) }.${ this.#quoteIdent(resolvedTable) }`

    const rows = await this.#executeStatement(`DESCRIBE TABLE ${ qualified }`, 'getTableSchema')

    return {
      database: resolvedDatabase,
      schema: resolvedSchema,
      table: resolvedTable,
      columns: rows.map(row => ({
        name: row['name'],
        type: row['type'],
        kind: row['kind'],
        nullable: row['null?'] === 'Y',
        default: row['default'],
        primaryKey: row['primary key'] === 'Y',
        uniqueKey: row['unique key'] === 'Y',
        comment: row['comment'],
      })),
      count: rows.length,
    }
  }

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================
  /**
   * @registerAs DICTIONARY
   * @operationName Get Databases Dictionary
   * @description Provides a searchable list of databases (via SHOW DATABASES) for dynamic dropdown selection in other operations.
   * @route POST /get-databases-dictionary
   * @paramDef {"type":"getDatabasesDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"ANALYTICS","value":"ANALYTICS","note":"owner: SYSADMIN"}],"cursor":null}
   */
  async getDatabasesDictionary(payload) {
    const { search } = payload || {}
    const rows = await this.#executeStatement('SHOW DATABASES', 'getDatabasesDictionary')

    return {
      items: this.#filterBySearch(rows, search).map(row => ({
        label: row.name,
        value: row.name,
        note: row.owner ? `owner: ${ row.owner }` : null,
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Schemas Dictionary
   * @description Provides a searchable list of schemas in the selected database (via SHOW SCHEMAS IN DATABASE) for dynamic dropdown selection. Falls back to the configured default database when none is selected.
   * @route POST /get-schemas-dictionary
   * @paramDef {"type":"getSchemasDictionary__payload","label":"Payload","name":"payload","description":"Optional search text, pagination cursor, and the selected database as criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"PUBLIC","value":"PUBLIC","note":"owner: SYSADMIN"}],"cursor":null}
   */
  async getSchemasDictionary(payload) {
    const { search, criteria } = payload || {}
    const database = ((criteria && criteria.database) || this.database || '').trim()

    if (!database) {
      return { items: [], cursor: null }
    }

    const rows = await this.#executeStatement(
      `SHOW SCHEMAS IN DATABASE ${ this.#quoteIdent(database) }`,
      'getSchemasDictionary'
    )

    return {
      items: this.#filterBySearch(rows, search).map(row => ({
        label: row.name,
        value: row.name,
        note: row.owner ? `owner: ${ row.owner }` : null,
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tables Dictionary
   * @description Provides a searchable list of tables in the selected database and schema (via SHOW TABLES IN SCHEMA) for dynamic dropdown selection. Falls back to the configured defaults when the criteria are not selected.
   * @route POST /get-tables-dictionary
   * @paramDef {"type":"getTablesDictionary__payload","label":"Payload","name":"payload","description":"Optional search text, pagination cursor, and the selected database/schema as criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"ORDERS","value":"ORDERS","note":"TABLE · 1500 rows"}],"cursor":null}
   */
  async getTablesDictionary(payload) {
    const { search, criteria } = payload || {}
    const database = ((criteria && criteria.database) || this.database || '').trim()
    const schema = ((criteria && criteria.schema) || this.schema || '').trim()

    if (!database || !schema) {
      return { items: [], cursor: null }
    }

    const rows = await this.#executeStatement(
      `SHOW TABLES IN SCHEMA ${ this.#quoteIdent(database) }.${ this.#quoteIdent(schema) }`,
      'getTablesDictionary'
    )

    return {
      items: this.#filterBySearch(rows, search).map(row => ({
        label: row.name,
        value: row.name,
        note: [row.kind, row.rows !== null && row.rows !== undefined ? `${ row.rows } rows` : null]
          .filter(Boolean)
          .join(' · ') || null,
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Warehouses Dictionary
   * @description Provides a searchable list of virtual warehouses (via SHOW WAREHOUSES) for dynamic dropdown selection, with each warehouse's state and size as a note.
   * @route POST /get-warehouses-dictionary
   * @paramDef {"type":"getWarehousesDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"COMPUTE_WH","value":"COMPUTE_WH","note":"STARTED · X-Small"}],"cursor":null}
   */
  async getWarehousesDictionary(payload) {
    const { search } = payload || {}
    const rows = await this.#executeStatement('SHOW WAREHOUSES', 'getWarehousesDictionary')

    return {
      items: this.#filterBySearch(rows, search).map(row => ({
        label: row.name,
        value: row.name,
        note: [row.state, row.size].filter(Boolean).join(' · ') || null,
      })),
      cursor: null,
    }
  }
}

Flowrunner.ServerCode.addService(Snowflake, [
  {
    name: 'accountIdentifier',
    displayName: 'Account Identifier',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Snowflake account identifier, e.g. myorg-myaccount or xy12345.us-east-1 - the part before ".snowflakecomputing.com" in your account URL. Find it in Snowsight under your account menu (bottom-left) → Account → View account details.',
  },
  {
    name: 'token',
    displayName: 'Programmatic Access Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'A Snowflake programmatic access token (PAT). Create one in Snowsight under your user profile → Settings → Authentication → Programmatic access tokens. Password authentication is not supported by the SQL API. Note: if a network policy is required for PATs in your account, requests must originate from an allowed network.',
  },
  {
    name: 'database',
    displayName: 'Default Database',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Database used when an operation does not specify one. Case-sensitive; must match the name shown by SHOW DATABASES (usually uppercase).',
  },
  {
    name: 'schema',
    displayName: 'Default Schema',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Schema used when an operation does not specify one (e.g. PUBLIC). Case-sensitive.',
  },
  {
    name: 'warehouse',
    displayName: 'Default Warehouse',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Virtual warehouse used to execute statements when an operation does not specify one (e.g. COMPUTE_WH). Required for queries that need compute. Case-sensitive.',
  },
  {
    name: 'role',
    displayName: 'Default Role',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Role used for statements when an operation does not specify one. Falls back to the token user\'s default role when empty. Case-sensitive.',
  },
])
