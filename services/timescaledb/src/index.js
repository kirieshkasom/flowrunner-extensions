const pg = require('pg')

const logger = {
  info: (...args) => console.log('[TimescaleDB] info:', ...args),
  debug: (...args) => console.log('[TimescaleDB] debug:', ...args),
  error: (...args) => console.log('[TimescaleDB] error:', ...args),
  warn: (...args) => console.log('[TimescaleDB] warn:', ...args),
}

const DEFAULT_PORT = 5432
const DEFAULT_CONNECTION_TIMEOUT_SECONDS = 10
const STATEMENT_TIMEOUT_MS = 120000
const DICTIONARY_PAGE_SIZE = 200

// ============================================================================
//  DICTIONARY PAYLOAD TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} getTablesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter tables and views by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getColumnsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Table","name":"table","description":"The table whose columns populate the list."}
 */

/**
 * @typedef {Object} getColumnsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter columns by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 * @paramDef {"type":"getColumnsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The table whose columns to list."}
 */

/**
 * @typedef {Object} getHypertablesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter hypertables by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @integrationName TimescaleDB
 * @integrationIcon /icon.png
 */
class TimescaleDB {
  constructor(config) {
    this.config = config || {}

    this.connectionString = (this.config.connectionString || '').trim()
    this.host = this.config.host
    this.port = parseInt(this.config.port, 10) || DEFAULT_PORT
    this.database = this.config.database
    this.user = this.config.user
    this.password = this.config.password
    this.ssl = this.config.ssl === true || this.config.ssl === 'true'

    const timeoutSeconds = parseInt(this.config.connectionTimeoutSeconds, 10)

    this.connectionTimeoutMillis = (timeoutSeconds > 0 ? timeoutSeconds : DEFAULT_CONNECTION_TIMEOUT_SECONDS) * 1000
  }

  // ==========================================================================
  //  CORE — connection lifecycle: one short-lived pg.Client per method call.
  //  A client is created, connected, used and always closed in finally.
  //  Connections are NEVER cached between invocations.
  // ==========================================================================
  async #withClient(logTag, fn) {
    const client = new pg.Client(this.#buildClientConfig(logTag))

    try {
      logger.debug(`${ logTag } - connecting to ${ this.#connectionLabel() }`)

      await client.connect()

      return await fn(client)
    } catch (error) {
      this.#throwPgError(error, logTag)
    } finally {
      try {
        await client.end()
      } catch (endError) {
        logger.warn(`${ logTag } - failed to close connection: ${ endError.message }`)
      }
    }
  }

  // A Connection String, when set, wins over the individual fields. When using it, the SSL
  // toggle only ADDS the managed-provider-friendly ssl config on top; when the toggle is off
  // the string's own sslmode/ssl query params stay in effect (we must not pass ssl: false,
  // as explicit config overrides values parsed from the string).
  #buildClientConfig(logTag) {
    const shared = {
      connectionTimeoutMillis: this.connectionTimeoutMillis,
      statement_timeout: STATEMENT_TIMEOUT_MS,
      query_timeout: STATEMENT_TIMEOUT_MS,
      application_name: 'flowrunner-timescaledb',
    }

    if (this.connectionString) {
      return {
        connectionString: this.connectionString,
        ...(this.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
        ...shared,
      }
    }

    if (!this.host || !this.database || !this.user) {
      logger.error(`${ logTag } - incomplete connection configuration`)

      throw new Error(
        'TimescaleDB error: incomplete connection configuration. ' +
        'Provide a Connection String (e.g. postgresql://user:password@host:5432/database), ' +
        'or fill in Host, Database, User and Password in the service configuration.'
      )
    }

    return {
      host: this.host,
      port: this.port,
      database: this.database,
      user: this.user,
      password: this.password,
      ssl: this.ssl ? { rejectUnauthorized: false } : false,
      ...shared,
    }
  }

  // Human-readable connection target for logs. Never includes credentials: the connection
  // string embeds the password, so only its host part is extracted.
  #connectionLabel() {
    if (this.connectionString) {
      const match = this.connectionString.match(/@([^/?]+)/)

      return match ? `${ match[1] } (connection string)` : 'connection string'
    }

    return `${ this.host }:${ this.port }/${ this.database }`
  }

  #throwPgError(error, logTag) {
    const parts = [error.message]

    if (error.code) parts.push(`code: ${ error.code }`)
    if (error.detail) parts.push(`detail: ${ error.detail }`)
    if (error.hint) parts.push(`hint: ${ error.hint }`)

    // ENETUNREACH against an IPv6 address means the host resolved to IPv6 only and this
    // environment has no IPv6 route - common with managed direct endpoints. Point the
    // user at an IPv4-compatible endpoint instead of leaving them with a bare ENETUNREACH.
    if (error.code === 'ENETUNREACH' && String(error.address || '').includes(':')) {
      parts.push(
        'hint: the database host resolved to an IPv6-only address and this environment has no IPv6 connectivity. ' +
        'Use an IPv4-compatible endpoint - for Supabase, copy the "Session pooler" connection string ' +
        '(postgres.<project-ref>@aws-0-<region>.pooler.supabase.com:5432) from the dashboard\'s Connect dialog ' +
        'instead of the direct db.<project-ref>.supabase.co address.'
      )
    }

    const message = parts.join(' | ')

    logger.error(`${ logTag } - failed: ${ message }`)

    throw new Error(`TimescaleDB error: ${ message }`)
  }

  // Quotes a single SQL identifier (column name). Identifiers cannot be bound
  // as query parameters, so they are escaped with double-quote doubling.
  #quoteIdent(name) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error(`Invalid identifier: ${ JSON.stringify(name) }. Identifiers must be non-empty strings.`)
    }

    return `"${ name.replace(/"/g, '""') }"`
  }

  // Quotes a table reference, supporting optional schema qualification ("public.users").
  #quoteTable(table) {
    const { schema, name } = this.#splitTable(table)

    return `${ this.#quoteIdent(schema) }.${ this.#quoteIdent(name) }`
  }

  #splitTable(table) {
    if (typeof table !== 'string' || !table.trim()) {
      throw new Error('Table name is required and must be a non-empty string.')
    }

    const separatorIndex = table.indexOf('.')

    if (separatorIndex === -1) {
      return { schema: 'public', name: table }
    }

    return { schema: table.slice(0, separatorIndex), name: table.slice(separatorIndex + 1) }
  }

  // Builds a parameterized WHERE clause from a conditions object.
  // null values become IS NULL; array values become = ANY($n); everything else uses equality.
  #buildWhere(where, params) {
    const entries = Object.entries(where || {})

    if (!entries.length) return ''

    const clauses = entries.map(([column, value]) => {
      if (value === null) {
        return `${ this.#quoteIdent(column) } IS NULL`
      }

      params.push(value)

      if (Array.isArray(value)) {
        return `${ this.#quoteIdent(column) } = ANY($${ params.length })`
      }

      return `${ this.#quoteIdent(column) } = $${ params.length }`
    })

    return ` WHERE ${ clauses.join(' AND ') }`
  }

  #requireNonEmptyObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) {
      throw new Error(`${ label } must be a non-empty object.`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Validates a SQL interval literal (e.g. "1 hour", "7 days"). TimescaleDB accepts these
  // verbatim in INTERVAL '...' positions; since they cannot be bound as parameters in DDL
  // and policy functions, they are validated to allow only safe interval-like content.
  #sanitizeInterval(value, label) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`${ label } is required and must be a non-empty interval string (e.g. "1 hour", "7 days").`)
    }

    const trimmed = value.trim()

    if (!/^[0-9a-zA-Z :.'-]+$/.test(trimmed) || trimmed.includes("'")) {
      throw new Error(
        `${ label } "${ value }" is not a valid interval. Use a simple interval like "1 hour", "30 minutes", "7 days" or "1 month".`
      )
    }

    return trimmed
  }

  // ==========================================================================
  //  SQL
  // ==========================================================================
  /**
   * @operationName Execute Query
   * @description Executes an arbitrary SQL statement (SELECT, INSERT, UPDATE, DELETE, DDL, CTEs, TimescaleDB functions, etc.) and returns the resulting rows, the affected row count, and result field metadata. Use $1, $2, ... placeholders in the SQL together with the Parameters array to safely bind values — never interpolate user input into the SQL string. Statements are limited to 120 seconds of execution time.
   * @category SQL
   * @route POST /execute-query
   * @appearanceColor #FDB515 #1C1E26
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"SQL","name":"sql","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The SQL statement to execute. Use $1, $2, ... placeholders for values bound via the Parameters array."}
   * @paramDef {"type":"Array","label":"Parameters","name":"params","description":"Values for the $1, $2, ... placeholders, in order (e.g. [\"ada@example.com\", 30]). Elements may be strings, numbers, booleans or null."}
   * @returns {Object}
   * @sampleResult {"rows":[{"id":1,"name":"Ada"}],"rowCount":1,"fields":[{"name":"id","dataTypeID":23},{"name":"name","dataTypeID":1043}]}
   */
  async executeQuery(sql, params) {
    if (typeof sql !== 'string' || !sql.trim()) {
      throw new Error('SQL statement is required.')
    }

    return this.#withClient('executeQuery', async client => {
      const result = await client.query(sql, Array.isArray(params) ? params : [])

      return {
        rows: result.rows || [],
        rowCount: result.rowCount,
        fields: (result.fields || []).map(field => ({ name: field.name, dataTypeID: field.dataTypeID })),
      }
    })
  }

  // ==========================================================================
  //  ROWS
  // ==========================================================================
  /**
   * @operationName Select Rows
   * @description Selects rows from a table without writing SQL. Supports choosing specific columns, equality-based filtering (null values match IS NULL, array values match any element), ordering, and limit/offset pagination. For joins, aggregations, or complex conditions use Execute Query instead.
   * @category Rows
   * @route POST /select-rows
   * @appearanceColor #FDB515 #1C1E26
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to read from. May be schema-qualified (e.g. public.metrics); defaults to the public schema."}
   * @paramDef {"type":"Array<String>","label":"Columns","name":"columns","description":"Column names to return. Leave empty to return all columns (SELECT *)."}
   * @paramDef {"type":"Object","label":"Where","name":"where","description":"Equality conditions as a JSON object, combined with AND (e.g. {\"device_id\":\"sensor-1\",\"deleted_at\":null}). Array values match any element."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","dictionary":"getColumnsDictionary","dependsOn":["table"],"description":"Column to sort the results by."}
   * @paramDef {"type":"String","label":"Sort Direction","name":"sortDirection","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"defaultValue":"Ascending","description":"Sort direction applied to the Order By column."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of rows to return. Leave empty for no limit."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of rows to skip before returning results."}
   * @returns {Object}
   * @sampleResult {"rows":[{"time":"2026-01-01T00:00:00.000Z","device_id":"sensor-1","temperature":21.4}],"rowCount":1}
   */
  async selectRows(table, columns, where, orderBy, sortDirection, limit, offset) {
    const params = []
    const columnList = Array.isArray(columns) && columns.length
      ? columns.map(column => this.#quoteIdent(column)).join(', ')
      : '*'

    let sql = `SELECT ${ columnList } FROM ${ this.#quoteTable(table) }`

    sql += this.#buildWhere(where, params)

    if (orderBy) {
      const direction = this.#resolveChoice(sortDirection, { 'Ascending': 'ASC', 'Descending': 'DESC' }) || 'ASC'

      sql += ` ORDER BY ${ this.#quoteIdent(orderBy) } ${ direction }`
    }

    if (limit !== undefined && limit !== null && limit !== '') {
      params.push(limit)
      sql += ` LIMIT $${ params.length }`
    }

    if (offset !== undefined && offset !== null && offset !== '') {
      params.push(offset)
      sql += ` OFFSET $${ params.length }`
    }

    return this.#withClient('selectRows', async client => {
      const result = await client.query(sql, params)

      return { rows: result.rows || [], rowCount: result.rowCount }
    })
  }

  /**
   * @operationName Insert Row
   * @description Inserts a single row into a table from a JSON object of column/value pairs and returns the full inserted row (including database-generated values such as serial IDs and defaults) via RETURNING *. Works with both regular tables and hypertables.
   * @category Rows
   * @route POST /insert-row
   * @appearanceColor #FDB515 #1C1E26
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to insert into. May be schema-qualified (e.g. public.metrics)."}
   * @paramDef {"type":"Object","label":"Data","name":"data","required":true,"description":"Column/value pairs for the new row as a JSON object (e.g. {\"time\":\"2026-01-01T00:00:00Z\",\"device_id\":\"sensor-1\",\"temperature\":21.4})."}
   * @returns {Object}
   * @sampleResult {"row":{"time":"2026-01-01T00:00:00.000Z","device_id":"sensor-1","temperature":21.4}}
   */
  async insertRow(table, data) {
    this.#requireNonEmptyObject(data, 'Data')

    const columns = Object.keys(data)
    const params = columns.map(column => data[column])
    const columnList = columns.map(column => this.#quoteIdent(column)).join(', ')
    const placeholders = columns.map((_, index) => `$${ index + 1 }`).join(', ')
    const sql = `INSERT INTO ${ this.#quoteTable(table) } (${ columnList }) VALUES (${ placeholders }) RETURNING *`

    return this.#withClient('insertRow', async client => {
      const result = await client.query(sql, params)

      return { row: result.rows[0] || null }
    })
  }

  /**
   * @operationName Insert Rows
   * @description Bulk-inserts multiple rows into a table in a single statement. The column set is the union of keys across all row objects; rows missing a key insert NULL for that column. Returns the inserted rows (via RETURNING *) and the inserted count. Ideal for batch-ingesting time-series records into a hypertable.
   * @category Rows
   * @route POST /insert-rows
   * @appearanceColor #FDB515 #1C1E26
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to insert into. May be schema-qualified (e.g. public.metrics)."}
   * @paramDef {"type":"Array<Object>","label":"Rows","name":"rows","required":true,"description":"An array of row objects with column/value pairs (e.g. [{\"time\":\"2026-01-01T00:00:00Z\",\"temperature\":21.4},{\"time\":\"2026-01-01T00:01:00Z\",\"temperature\":21.6}])."}
   * @returns {Object}
   * @sampleResult {"rows":[{"time":"2026-01-01T00:00:00.000Z","temperature":21.4},{"time":"2026-01-01T00:01:00.000Z","temperature":21.6}],"insertedCount":2}
   */
  async insertRows(table, rows) {
    if (!Array.isArray(rows) || !rows.length) {
      throw new Error('Rows must be a non-empty array of objects.')
    }

    rows.forEach((row, index) => this.#requireNonEmptyObject(row, `Rows[${ index }]`))

    const columns = [...new Set(rows.flatMap(row => Object.keys(row)))]
    const columnList = columns.map(column => this.#quoteIdent(column)).join(', ')
    const params = []

    const valuesSql = rows
      .map(row => {
        const placeholders = columns.map(column => {
          params.push(column in row ? row[column] : null)

          return `$${ params.length }`
        })

        return `(${ placeholders.join(', ') })`
      })
      .join(', ')

    const sql = `INSERT INTO ${ this.#quoteTable(table) } (${ columnList }) VALUES ${ valuesSql } RETURNING *`

    return this.#withClient('insertRows', async client => {
      const result = await client.query(sql, params)

      return { rows: result.rows || [], insertedCount: result.rowCount }
    })
  }

  /**
   * @operationName Update Rows
   * @description Updates all rows matching the equality conditions in the Where object, setting the columns provided in the Data object. Returns the updated rows (via RETURNING *) and the updated count. A non-empty Where object is required to prevent accidental full-table updates; use Execute Query for unconditional updates.
   * @category Rows
   * @route PATCH /update-rows
   * @appearanceColor #FDB515 #1C1E26
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to update. May be schema-qualified (e.g. public.metrics)."}
   * @paramDef {"type":"Object","label":"Data","name":"data","required":true,"description":"Column/value pairs to set as a JSON object (e.g. {\"status\":\"archived\"})."}
   * @paramDef {"type":"Object","label":"Where","name":"where","required":true,"description":"Equality conditions selecting the rows to update, combined with AND (e.g. {\"device_id\":\"sensor-1\"}). Null values match IS NULL; array values match any element."}
   * @returns {Object}
   * @sampleResult {"rows":[{"device_id":"sensor-1","status":"archived"}],"updatedCount":1}
   */
  async updateRows(table, data, where) {
    this.#requireNonEmptyObject(data, 'Data')
    this.#requireNonEmptyObject(where, 'Where')

    const params = []

    const assignments = Object.entries(data)
      .map(([column, value]) => {
        params.push(value)

        return `${ this.#quoteIdent(column) } = $${ params.length }`
      })
      .join(', ')

    const sql = `UPDATE ${ this.#quoteTable(table) } SET ${ assignments }${ this.#buildWhere(where, params) } RETURNING *`

    return this.#withClient('updateRows', async client => {
      const result = await client.query(sql, params)

      return { rows: result.rows || [], updatedCount: result.rowCount }
    })
  }

  /**
   * @operationName Delete Rows
   * @description Deletes all rows matching the equality conditions in the Where object and returns the number of deleted rows. A non-empty Where object is required to prevent accidental full-table deletion; use Execute Query (e.g. TRUNCATE or DELETE without WHERE) for that. To efficiently drop old time-series data, prefer Drop Chunks over row-by-row deletion.
   * @category Rows
   * @route DELETE /delete-rows
   * @appearanceColor #FDB515 #1C1E26
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to delete from. May be schema-qualified (e.g. public.metrics)."}
   * @paramDef {"type":"Object","label":"Where","name":"where","required":true,"description":"Equality conditions selecting the rows to delete, combined with AND (e.g. {\"status\":\"archived\"}). Null values match IS NULL; array values match any element."}
   * @returns {Object}
   * @sampleResult {"deletedCount":3}
   */
  async deleteRows(table, where) {
    this.#requireNonEmptyObject(where, 'Where')

    const params = []
    const sql = `DELETE FROM ${ this.#quoteTable(table) }${ this.#buildWhere(where, params) }`

    return this.#withClient('deleteRows', async client => {
      const result = await client.query(sql, params)

      return { deletedCount: result.rowCount }
    })
  }

  /**
   * @operationName Upsert Row
   * @description Inserts a row, or updates the existing row when a unique constraint on the conflict columns is violated (INSERT ... ON CONFLICT ... DO UPDATE). All non-conflict columns from Data are updated on conflict; if Data contains only conflict columns, the conflict is ignored (DO NOTHING). The conflict columns must be covered by a unique index or primary key. Returns the resulting row via RETURNING *.
   * @category Rows
   * @route POST /upsert-row
   * @appearanceColor #FDB515 #1C1E26
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to upsert into. May be schema-qualified (e.g. public.metrics)."}
   * @paramDef {"type":"Object","label":"Data","name":"data","required":true,"description":"Column/value pairs for the row as a JSON object. Must include values for all conflict columns."}
   * @paramDef {"type":"Array<String>","label":"Conflict Columns","name":"conflictColumns","required":true,"description":"Column names that identify the row (e.g. [\"time\",\"device_id\"]). Must match a unique index or primary key on the table."}
   * @returns {Object}
   * @sampleResult {"row":{"time":"2026-01-01T00:00:00.000Z","device_id":"sensor-1","temperature":21.4}}
   */
  async upsertRow(table, data, conflictColumns) {
    this.#requireNonEmptyObject(data, 'Data')

    if (!Array.isArray(conflictColumns) || !conflictColumns.length) {
      throw new Error('Conflict Columns must be a non-empty array of column names.')
    }

    const columns = Object.keys(data)
    const params = columns.map(column => data[column])
    const columnList = columns.map(column => this.#quoteIdent(column)).join(', ')
    const placeholders = columns.map((_, index) => `$${ index + 1 }`).join(', ')
    const conflictList = conflictColumns.map(column => this.#quoteIdent(column)).join(', ')

    const updateColumns = columns.filter(column => !conflictColumns.includes(column))
    const conflictAction = updateColumns.length
      ? `DO UPDATE SET ${ updateColumns.map(column => `${ this.#quoteIdent(column) } = EXCLUDED.${ this.#quoteIdent(column) }`).join(', ') }`
      : 'DO NOTHING'

    const sql =
      `INSERT INTO ${ this.#quoteTable(table) } (${ columnList }) VALUES (${ placeholders }) ` +
      `ON CONFLICT (${ conflictList }) ${ conflictAction } RETURNING *`

    return this.#withClient('upsertRow', async client => {
      const result = await client.query(sql, params)

      return { row: result.rows[0] || null }
    })
  }

  // ==========================================================================
  //  SCHEMA
  // ==========================================================================
  /**
   * @operationName Get Table Schema
   * @description Returns the column definitions of a table from information_schema.columns: column name, data type, underlying type name, nullability, default expression, maximum character length, and ordinal position. Useful for discovering a table's structure before reading, writing, or creating a hypertable.
   * @category Schema
   * @route GET /table-schema
   * @appearanceColor #FDB515 #1C1E26
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to describe. May be schema-qualified (e.g. public.metrics); defaults to the public schema."}
   * @returns {Object}
   * @sampleResult {"schema":"public","table":"metrics","columns":[{"name":"time","type":"timestamp with time zone","udtName":"timestamptz","nullable":false,"default":null,"maxLength":null,"position":1},{"name":"device_id","type":"text","udtName":"text","nullable":true,"default":null,"maxLength":null,"position":2}]}
   */
  async getTableSchema(table) {
    const { schema, name } = this.#splitTable(table)

    const sql = `
      SELECT column_name, data_type, udt_name, is_nullable, column_default, character_maximum_length, ordinal_position
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position
    `

    return this.#withClient('getTableSchema', async client => {
      const result = await client.query(sql, [schema, name])

      if (!result.rows.length) {
        throw new Error(`Table "${ schema }.${ name }" was not found or has no columns.`)
      }

      return {
        schema,
        table: name,
        columns: result.rows.map(row => ({
          name: row.column_name,
          type: row.data_type,
          udtName: row.udt_name,
          nullable: row.is_nullable === 'YES',
          default: row.column_default,
          maxLength: row.character_maximum_length,
          position: row.ordinal_position,
        })),
      }
    })
  }

  /**
   * @operationName List Tables
   * @description Lists all tables and views in user schemas (system schemas pg_catalog and information_schema are excluded), including each object's schema, name and type. Useful for discovering what data is available in the database. To list only TimescaleDB hypertables, use List Hypertables.
   * @category Schema
   * @route GET /tables
   * @appearanceColor #FDB515 #1C1E26
   * @returns {Object}
   * @sampleResult {"tables":[{"schema":"public","name":"metrics","type":"BASE TABLE"},{"schema":"public","name":"recent_metrics","type":"VIEW"}],"count":2}
   */
  async listTables() {
    const sql = `
      SELECT table_schema, table_name, table_type
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name
    `

    return this.#withClient('listTables', async client => {
      const result = await client.query(sql)

      return {
        tables: result.rows.map(row => ({ schema: row.table_schema, name: row.table_name, type: row.table_type })),
        count: result.rowCount,
      }
    })
  }

  // ==========================================================================
  //  HYPERTABLES
  // ==========================================================================
  /**
   * @operationName Create Hypertable
   * @description Converts an existing PostgreSQL table into a TimescaleDB hypertable partitioned by a time column, using SELECT create_hypertable(...). The table must already exist and the time column must be a timestamp, timestamptz, date, or integer type. Optionally set the chunk time interval (e.g. "7 days") that controls how much time each underlying chunk spans; smaller intervals suit high-ingest workloads, larger intervals suit sparse data. Pass "Migrate Existing Data" when the table already contains rows so they are moved into the new chunk structure. Returns the create_hypertable result row.
   * @category Hypertables
   * @route POST /create-hypertable
   * @appearanceColor #FDB515 #1C1E26
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The existing table to convert into a hypertable. May be schema-qualified (e.g. public.metrics)."}
   * @paramDef {"type":"String","label":"Time Column","name":"timeColumn","required":true,"dictionary":"getColumnsDictionary","dependsOn":["table"],"description":"The time/timestamp column to partition the hypertable by (e.g. time)."}
   * @paramDef {"type":"String","label":"Chunk Time Interval","name":"chunkTimeInterval","description":"Optional interval each chunk should span (e.g. \"7 days\", \"1 day\", \"12 hours\"). Leave empty to use the TimescaleDB default (7 days for timestamp columns)."}
   * @paramDef {"type":"Boolean","label":"Migrate Existing Data","name":"migrateData","uiComponent":{"type":"CHECKBOX"},"defaultValue":false,"description":"Move rows already present in the table into the hypertable's chunks. Enable this when the table is not empty."}
   * @returns {Object}
   * @sampleResult {"hypertable":{"hypertable_id":1,"schema_name":"public","table_name":"metrics","created":true}}
   */
  async createHypertable(table, timeColumn, chunkTimeInterval, migrateData) {
    if (typeof timeColumn !== 'string' || !timeColumn.trim()) {
      throw new Error('Time Column is required.')
    }

    const params = [this.#quoteTable(table), timeColumn]
    const options = []

    if (chunkTimeInterval !== undefined && chunkTimeInterval !== null && String(chunkTimeInterval).trim() !== '') {
      const interval = this.#sanitizeInterval(chunkTimeInterval, 'Chunk Time Interval')

      options.push(`chunk_time_interval => INTERVAL '${ interval }'`)
    }

    if (migrateData === true || migrateData === 'true') {
      options.push('migrate_data => TRUE')
    }

    const optionsSql = options.length ? `, ${ options.join(', ') }` : ''
    const sql = `SELECT * FROM create_hypertable($1::regclass, by_range($2)${ optionsSql })`

    return this.#withClient('createHypertable', async client => {
      const result = await client.query(sql, params)

      return { hypertable: result.rows[0] || null }
    })
  }

  /**
   * @operationName List Hypertables
   * @description Lists all TimescaleDB hypertables in the database from timescaledb_information.hypertables, including the hypertable's schema and name, owner, number of dimensions, number of chunks, compression status, and tablespaces. Use this to discover which tables are time-partitioned before running time-series operations.
   * @category Hypertables
   * @route GET /hypertables
   * @appearanceColor #FDB515 #1C1E26
   * @returns {Object}
   * @sampleResult {"hypertables":[{"schema":"public","name":"metrics","owner":"tsdbadmin","numDimensions":1,"numChunks":12,"compressionEnabled":true}],"count":1}
   */
  async listHypertables() {
    const sql = `
      SELECT hypertable_schema, hypertable_name, owner, num_dimensions, num_chunks, compression_enabled, tablespaces
      FROM timescaledb_information.hypertables
      ORDER BY hypertable_schema, hypertable_name
    `

    return this.#withClient('listHypertables', async client => {
      const result = await client.query(sql)

      return {
        hypertables: result.rows.map(row => ({
          schema: row.hypertable_schema,
          name: row.hypertable_name,
          owner: row.owner,
          numDimensions: row.num_dimensions,
          numChunks: row.num_chunks,
          compressionEnabled: row.compression_enabled,
          tablespaces: row.tablespaces,
        })),
        count: result.rowCount,
      }
    })
  }

  /**
   * @operationName Get Hypertable Chunks
   * @description Lists the underlying chunks of a hypertable from timescaledb_information.chunks, including each chunk's schema and name, the time range it covers (range_start / range_end), whether it is compressed, and whether it is a dropped chunk. Chunks are the physical partitions TimescaleDB stores time-series data in. Useful for inspecting data distribution and compression state over time.
   * @category Hypertables
   * @route GET /hypertable-chunks
   * @appearanceColor #FDB515 #1C1E26
   * @paramDef {"type":"String","label":"Hypertable","name":"table","required":true,"dictionary":"getHypertablesDictionary","description":"The hypertable whose chunks to list. May be schema-qualified (e.g. public.metrics); defaults to the public schema."}
   * @returns {Object}
   * @sampleResult {"chunks":[{"chunkSchema":"_timescaledb_internal","chunkName":"_hyper_1_1_chunk","rangeStart":"2026-01-01T00:00:00.000Z","rangeEnd":"2026-01-08T00:00:00.000Z","isCompressed":false}],"count":1}
   */
  async getHypertableChunks(table) {
    const { schema, name } = this.#splitTable(table)

    const sql = `
      SELECT chunk_schema, chunk_name, range_start, range_end, is_compressed
      FROM timescaledb_information.chunks
      WHERE hypertable_schema = $1 AND hypertable_name = $2
      ORDER BY range_start
    `

    return this.#withClient('getHypertableChunks', async client => {
      const result = await client.query(sql, [schema, name])

      return {
        chunks: result.rows.map(row => ({
          chunkSchema: row.chunk_schema,
          chunkName: row.chunk_name,
          rangeStart: row.range_start,
          rangeEnd: row.range_end,
          isCompressed: row.is_compressed,
        })),
        count: result.rowCount,
      }
    })
  }

  // ==========================================================================
  //  TIME-SERIES ANALYTICS
  // ==========================================================================
  /**
   * @operationName Time Bucket Query
   * @description Runs a TimescaleDB time_bucket aggregation without writing full SQL. Buckets rows of a hypertable (or any table) into fixed time intervals on the time column and computes the supplied aggregate expressions per bucket, e.g. bucket temperature readings into hourly averages. Builds and runs: SELECT time_bucket('{interval}', {timeColumn}) AS bucket, {aggregations} FROM {table} [WHERE {whereClause}] GROUP BY bucket ORDER BY bucket [LIMIT {limit}]. Provide the aggregations as a raw SQL expression list (e.g. "avg(temperature) AS avg_temp, max(temperature) AS max_temp") and, if needed, a raw SQL WHERE condition (bind-free). Returns one row per time bucket.
   * @category Time-Series Analytics
   * @route POST /time-bucket-query
   * @appearanceColor #FDB515 #1C1E26
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table (typically a hypertable) to aggregate. May be schema-qualified (e.g. public.metrics)."}
   * @paramDef {"type":"String","label":"Time Column","name":"timeColumn","required":true,"dictionary":"getColumnsDictionary","dependsOn":["table"],"description":"The time/timestamp column to bucket by (e.g. time)."}
   * @paramDef {"type":"String","label":"Bucket Interval","name":"interval","required":true,"description":"The width of each time bucket as an interval (e.g. \"1 hour\", \"15 minutes\", \"1 day\")."}
   * @paramDef {"type":"String","label":"Aggregations","name":"aggregations","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Raw SQL aggregate expression list evaluated per bucket (e.g. avg(temperature) AS avg_temp, count(*) AS readings)."}
   * @paramDef {"type":"String","label":"Where Clause","name":"whereClause","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional raw SQL condition (without the WHERE keyword) to filter rows before bucketing (e.g. device_id = 'sensor-1' AND time > now() - INTERVAL '7 days')."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of buckets to return. Leave empty for no limit."}
   * @returns {Object}
   * @sampleResult {"rows":[{"bucket":"2026-01-01T00:00:00.000Z","avg_temp":21.4,"readings":60}],"rowCount":1}
   */
  async timeBucketQuery(table, timeColumn, interval, aggregations, whereClause, limit) {
    if (typeof timeColumn !== 'string' || !timeColumn.trim()) {
      throw new Error('Time Column is required.')
    }

    if (typeof aggregations !== 'string' || !aggregations.trim()) {
      throw new Error('Aggregations is required (e.g. "avg(temperature) AS avg_temp").')
    }

    const bucketInterval = this.#sanitizeInterval(interval, 'Bucket Interval')
    const quotedTimeColumn = this.#quoteIdent(timeColumn)

    let sql =
      `SELECT time_bucket(INTERVAL '${ bucketInterval }', ${ quotedTimeColumn }) AS bucket, ${ aggregations.trim() } ` +
      `FROM ${ this.#quoteTable(table) }`

    if (typeof whereClause === 'string' && whereClause.trim()) {
      sql += ` WHERE ${ whereClause.trim() }`
    }

    sql += ' GROUP BY bucket ORDER BY bucket'

    const params = []

    if (limit !== undefined && limit !== null && limit !== '') {
      params.push(limit)
      sql += ` LIMIT $${ params.length }`
    }

    return this.#withClient('timeBucketQuery', async client => {
      const result = await client.query(sql, params)

      return { rows: result.rows || [], rowCount: result.rowCount }
    })
  }

  // ==========================================================================
  //  COMPRESSION & RETENTION
  // ==========================================================================
  /**
   * @operationName Enable Compression
   * @description Enables native columnar compression on a hypertable and optionally schedules an automatic compression policy. Runs ALTER TABLE {table} SET (timescaledb.compress, ...) to turn compression on — optionally segmenting by a column (segment-by, groups related rows for better compression and query performance) and ordering compressed data by a column (order-by, typically the time column descending). When "Compress Chunks Older Than" is supplied, also creates a policy (add_compression_policy) that automatically compresses chunks once their data ages past that interval. Returns whether the policy was scheduled.
   * @category Compression & Retention
   * @route POST /enable-compression
   * @appearanceColor #FDB515 #1C1E26
   * @paramDef {"type":"String","label":"Hypertable","name":"table","required":true,"dictionary":"getHypertablesDictionary","description":"The hypertable to enable compression on. May be schema-qualified (e.g. public.metrics)."}
   * @paramDef {"type":"String","label":"Segment By Column","name":"segmentBy","dictionary":"getColumnsDictionary","dependsOn":["table"],"description":"Optional column to segment compressed data by (e.g. device_id). Groups rows sharing this value for better compression and filtered-query performance."}
   * @paramDef {"type":"String","label":"Order By Column","name":"orderBy","dictionary":"getColumnsDictionary","dependsOn":["table"],"description":"Optional column to order compressed data by (typically the time column). Ordered by descending time by default."}
   * @paramDef {"type":"String","label":"Compress Chunks Older Than","name":"olderThan","description":"Optional interval; when set, schedules an automatic policy that compresses chunks whose data is older than this (e.g. \"7 days\", \"30 days\")."}
   * @returns {Object}
   * @sampleResult {"compressionEnabled":true,"policyScheduled":true,"olderThan":"7 days"}
   */
  async enableCompression(table, segmentBy, orderBy, olderThan) {
    const quotedTable = this.#quoteTable(table)
    const settings = ['timescaledb.compress']

    if (typeof segmentBy === 'string' && segmentBy.trim()) {
      settings.push(`timescaledb.compress_segmentby = '${ segmentBy.trim().replace(/'/g, "''") }'`)
    }

    if (typeof orderBy === 'string' && orderBy.trim()) {
      settings.push(`timescaledb.compress_orderby = '${ orderBy.trim().replace(/'/g, "''") } DESC'`)
    }

    const alterSql = `ALTER TABLE ${ quotedTable } SET (${ settings.join(', ') })`

    let policyScheduled = false
    let interval = null

    if (olderThan !== undefined && olderThan !== null && String(olderThan).trim() !== '') {
      interval = this.#sanitizeInterval(olderThan, 'Compress Chunks Older Than')
    }

    return this.#withClient('enableCompression', async client => {
      await client.query(alterSql)

      if (interval) {
        await client.query(`SELECT add_compression_policy($1::regclass, INTERVAL '${ interval }')`, [quotedTable])
        policyScheduled = true
      }

      return { compressionEnabled: true, policyScheduled, olderThan: interval }
    })
  }

  /**
   * @operationName Create Continuous Aggregate
   * @description Creates a TimescaleDB continuous aggregate: a materialized view that incrementally maintains a time_bucket-based rollup of a hypertable, so pre-aggregated results (e.g. hourly or daily summaries) are always fast to query. Runs CREATE MATERIALIZED VIEW {name} WITH (timescaledb.continuous) AS {selectBody} WITH NO DATA, where you supply the full SELECT body (which must include a time_bucket(...) and GROUP BY). The view is created WITH NO DATA and backfilled by its refresh policy; add a refresh policy separately (via Execute Query and add_continuous_aggregate_policy) to keep it current. Returns the created view name.
   * @category Compression & Retention
   * @route POST /create-continuous-aggregate
   * @appearanceColor #FDB515 #1C1E26
   * @paramDef {"type":"String","label":"View Name","name":"name","required":true,"description":"Name for the new continuous aggregate materialized view (e.g. metrics_hourly). May be schema-qualified."}
   * @paramDef {"type":"String","label":"Select Body","name":"selectBody","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The full SELECT statement defining the rollup, including a time_bucket(...) and GROUP BY (e.g. SELECT time_bucket('1 hour', time) AS bucket, device_id, avg(temperature) AS avg_temp FROM metrics GROUP BY bucket, device_id)."}
   * @returns {Object}
   * @sampleResult {"view":"metrics_hourly","created":true}
   */
  async createContinuousAggregate(name, selectBody) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('View Name is required.')
    }

    if (typeof selectBody !== 'string' || !selectBody.trim()) {
      throw new Error('Select Body is required and must be a SELECT statement including time_bucket(...) and GROUP BY.')
    }

    const quotedView = this.#quoteTable(name)
    const body = selectBody.trim().replace(/;\s*$/, '')
    const sql = `CREATE MATERIALIZED VIEW ${ quotedView } WITH (timescaledb.continuous) AS ${ body } WITH NO DATA`

    return this.#withClient('createContinuousAggregate', async client => {
      await client.query(sql)

      return { view: name, created: true }
    })
  }

  /**
   * @operationName Show Chunks
   * @description Lists the chunks of a hypertable using the show_chunks() function, optionally restricted to chunks whose data is older than a given interval. Returns the fully-qualified chunk relation names, oldest first. Use this to preview which chunks Drop Chunks would remove before actually dropping them.
   * @category Compression & Retention
   * @route POST /show-chunks
   * @appearanceColor #FDB515 #1C1E26
   * @paramDef {"type":"String","label":"Hypertable","name":"table","required":true,"dictionary":"getHypertablesDictionary","description":"The hypertable whose chunks to list. May be schema-qualified (e.g. public.metrics)."}
   * @paramDef {"type":"String","label":"Older Than","name":"olderThan","description":"Optional interval; when set, only chunks whose data is older than this are returned (e.g. \"30 days\", \"3 months\")."}
   * @returns {Object}
   * @sampleResult {"chunks":["_timescaledb_internal._hyper_1_1_chunk","_timescaledb_internal._hyper_1_2_chunk"],"count":2}
   */
  async showChunks(table, olderThan) {
    const quotedTable = this.#quoteTable(table)

    let sql = 'SELECT show_chunks($1::regclass) AS chunk'
    let interval = null

    if (olderThan !== undefined && olderThan !== null && String(olderThan).trim() !== '') {
      interval = this.#sanitizeInterval(olderThan, 'Older Than')
      sql = `SELECT show_chunks($1::regclass, older_than => INTERVAL '${ interval }') AS chunk`
    }

    return this.#withClient('showChunks', async client => {
      const result = await client.query(sql, [quotedTable])

      return {
        chunks: result.rows.map(row => row.chunk),
        count: result.rowCount,
      }
    })
  }

  /**
   * @operationName Drop Chunks
   * @description Permanently drops all chunks of a hypertable whose data is older than the given interval, using drop_chunks(). This is the efficient way to enforce data retention on time-series data — it removes whole physical partitions rather than deleting rows one by one, and cannot be undone. Returns the list of dropped chunk names. Preview first with Show Chunks.
   * @category Compression & Retention
   * @route POST /drop-chunks
   * @appearanceColor #FDB515 #1C1E26
   * @paramDef {"type":"String","label":"Hypertable","name":"table","required":true,"dictionary":"getHypertablesDictionary","description":"The hypertable to drop old chunks from. May be schema-qualified (e.g. public.metrics)."}
   * @paramDef {"type":"String","label":"Older Than","name":"olderThan","required":true,"description":"Drop chunks whose data is entirely older than this interval (e.g. \"90 days\", \"1 year\"). Required to avoid dropping all data."}
   * @returns {Object}
   * @sampleResult {"droppedChunks":["_timescaledb_internal._hyper_1_1_chunk"],"count":1}
   */
  async dropChunks(table, olderThan) {
    const quotedTable = this.#quoteTable(table)
    const interval = this.#sanitizeInterval(olderThan, 'Older Than')
    const sql = `SELECT drop_chunks($1::regclass, older_than => INTERVAL '${ interval }') AS chunk`

    return this.#withClient('dropChunks', async client => {
      const result = await client.query(sql, [quotedTable])

      return {
        droppedChunks: result.rows.map(row => row.chunk),
        count: result.rowCount,
      }
    })
  }

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================
  /**
   * @registerAs DICTIONARY
   * @operationName Get Tables Dictionary
   * @description Provides a searchable list of tables and views from user schemas for dynamic dropdown selection in other operations. Values are schema-qualified (e.g. public.metrics).
   * @route POST /get-tables-dictionary
   * @paramDef {"type":"getTablesDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"metrics","value":"public.metrics","note":"public · BASE TABLE"}],"cursor":null}
   */
  async getTablesDictionary(payload) {
    const { search, cursor } = payload || {}
    const offset = parseInt(cursor, 10) || 0
    const params = [search ? `%${ search }%` : null, DICTIONARY_PAGE_SIZE + 1, offset]

    const sql = `
      SELECT table_schema, table_name, table_type
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        AND ($1::text IS NULL OR table_name ILIKE $1)
      ORDER BY table_schema, table_name
      LIMIT $2 OFFSET $3
    `

    return this.#withClient('getTablesDictionary', async client => {
      const result = await client.query(sql, params)
      const hasMore = result.rows.length > DICTIONARY_PAGE_SIZE
      const rows = hasMore ? result.rows.slice(0, DICTIONARY_PAGE_SIZE) : result.rows

      return {
        items: rows.map(row => ({
          label: row.table_name,
          value: `${ row.table_schema }.${ row.table_name }`,
          note: `${ row.table_schema } · ${ row.table_type }`,
        })),
        cursor: hasMore ? String(offset + DICTIONARY_PAGE_SIZE) : null,
      }
    })
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Hypertables Dictionary
   * @description Provides a searchable list of TimescaleDB hypertables for dynamic dropdown selection in time-series operations. Values are schema-qualified (e.g. public.metrics).
   * @route POST /get-hypertables-dictionary
   * @paramDef {"type":"getHypertablesDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"metrics","value":"public.metrics","note":"public · 12 chunks"}],"cursor":null}
   */
  async getHypertablesDictionary(payload) {
    const { search, cursor } = payload || {}
    const offset = parseInt(cursor, 10) || 0
    const params = [search ? `%${ search }%` : null, DICTIONARY_PAGE_SIZE + 1, offset]

    const sql = `
      SELECT hypertable_schema, hypertable_name, num_chunks
      FROM timescaledb_information.hypertables
      WHERE ($1::text IS NULL OR hypertable_name ILIKE $1)
      ORDER BY hypertable_schema, hypertable_name
      LIMIT $2 OFFSET $3
    `

    return this.#withClient('getHypertablesDictionary', async client => {
      const result = await client.query(sql, params)
      const hasMore = result.rows.length > DICTIONARY_PAGE_SIZE
      const rows = hasMore ? result.rows.slice(0, DICTIONARY_PAGE_SIZE) : result.rows

      return {
        items: rows.map(row => ({
          label: row.hypertable_name,
          value: `${ row.hypertable_schema }.${ row.hypertable_name }`,
          note: `${ row.hypertable_schema } · ${ row.num_chunks } chunks`,
        })),
        cursor: hasMore ? String(offset + DICTIONARY_PAGE_SIZE) : null,
      }
    })
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Columns Dictionary
   * @description Provides a searchable list of column names for the table selected in a dependent parameter, with each column's data type as a note.
   * @route POST /get-columns-dictionary
   * @paramDef {"type":"getColumnsDictionary__payload","label":"Payload","name":"payload","description":"Optional search text, pagination cursor, and the selected table as criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"time","value":"time","note":"timestamp with time zone"}],"cursor":null}
   */
  async getColumnsDictionary(payload) {
    const { search, criteria } = payload || {}
    const table = criteria && criteria.table

    if (!table) {
      return { items: [], cursor: null }
    }

    const { schema, name } = this.#splitTable(table)
    const params = [schema, name, search ? `%${ search }%` : null]

    const sql = `
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
        AND ($3::text IS NULL OR column_name ILIKE $3)
      ORDER BY ordinal_position
    `

    return this.#withClient('getColumnsDictionary', async client => {
      const result = await client.query(sql, params)

      return {
        items: result.rows.map(row => ({
          label: row.column_name,
          value: row.column_name,
          note: row.data_type,
        })),
        cursor: null,
      }
    })
  }
}

Flowrunner.ServerCode.addService(TimescaleDB, [
  {
    name: 'connectionString',
    displayName: 'Connection String',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Full PostgreSQL connection URI, e.g. postgresql://user:password@host:5432/tsdb - TimescaleDB is wire-compatible with PostgreSQL. TimescaleDB Cloud (Tiger Cloud) provides a ready-to-use connection string in the service dashboard; self-managed and other providers (RDS, self-hosted) supply one too. When set, it takes precedence and the Host/Port/Database/User/Password fields below are ignored. Special characters in the password must be URL-encoded; if that is a problem, use the individual fields instead. If a host resolves to an IPv6-only address (e.g. some Supabase direct endpoints), use an IPv4-compatible pooler endpoint instead.',
  },
  {
    name: 'host',
    displayName: 'Host',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Hostname or IP address of the TimescaleDB (PostgreSQL) server (e.g. abc123.tsdb.cloud.timescale.com). Required unless a Connection String is provided. The server must be reachable from FlowRunner.',
  },
  {
    name: 'port',
    displayName: 'Port',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    defaultValue: '5432',
    hint: 'TCP port of the server. The default is 5432 (Tiger Cloud services often use a custom port such as 30000 - check your service dashboard). Ignored when a Connection String is provided.',
  },
  {
    name: 'database',
    displayName: 'Database',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Name of the database to connect to (Tiger Cloud services default to "tsdb"). Required unless a Connection String is provided.',
  },
  {
    name: 'user',
    displayName: 'User',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Database user (role) name (Tiger Cloud services default to "tsdbadmin"). Required unless a Connection String is provided.',
  },
  {
    name: 'password',
    displayName: 'Password',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Password for the database user. Required unless a Connection String is provided.',
  },
  {
    name: 'ssl',
    displayName: 'Use SSL/TLS',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.BOOL,
    required: false,
    shared: false,
    defaultValue: false,
    hint: 'Enable TLS-encrypted connections. Required by most managed databases, including TimescaleDB Cloud / Tiger Cloud, AWS RDS, and Azure. With a Connection String, enabling this adds managed-provider-friendly TLS on top of the URI; when off, any sslmode in the URI still applies.',
  },
  {
    name: 'connectionTimeoutSeconds',
    displayName: 'Connection Timeout (seconds)',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    defaultValue: '10',
    hint: 'How long to wait when establishing a connection before failing. Defaults to 10 seconds.',
  },
])
