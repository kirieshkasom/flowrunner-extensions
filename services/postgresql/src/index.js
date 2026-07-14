const pg = require('pg')

const logger = {
  info: (...args) => console.log('[PostgreSQL] info:', ...args),
  debug: (...args) => console.log('[PostgreSQL] debug:', ...args),
  error: (...args) => console.log('[PostgreSQL] error:', ...args),
  warn: (...args) => console.log('[PostgreSQL] warn:', ...args),
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
 * @integrationName PostgreSQL
 * @integrationIcon /icon.png
 */
class PostgreSQL {
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
      application_name: 'flowrunner-postgresql',
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
        'PostgreSQL error: incomplete connection configuration. ' +
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
    // environment has no IPv6 route - common with Supabase's direct endpoint. Point the
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

    throw new Error(`PostgreSQL error: ${ message }`)
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

  // ==========================================================================
  //  SQL
  // ==========================================================================
  /**
   * @operationName Execute Query
   * @description Executes an arbitrary SQL statement (SELECT, INSERT, UPDATE, DELETE, DDL, CTEs, etc.) and returns the resulting rows, the affected row count, and result field metadata. Use $1, $2, ... placeholders in the SQL together with the Parameters array to safely bind values — never interpolate user input into the SQL string. Statements are limited to 120 seconds of execution time.
   * @category SQL
   * @route POST /execute-query
   * @appearanceColor #336791 #4E8CBF
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
   * @appearanceColor #336791 #4E8CBF
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to read from. May be schema-qualified (e.g. public.users); defaults to the public schema."}
   * @paramDef {"type":"Array<String>","label":"Columns","name":"columns","description":"Column names to return. Leave empty to return all columns (SELECT *)."}
   * @paramDef {"type":"Object","label":"Where","name":"where","description":"Equality conditions as a JSON object, combined with AND (e.g. {\"status\":\"active\",\"deleted_at\":null}). Array values match any element."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","dictionary":"getColumnsDictionary","dependsOn":["table"],"description":"Column to sort the results by."}
   * @paramDef {"type":"String","label":"Sort Direction","name":"sortDirection","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"defaultValue":"Ascending","description":"Sort direction applied to the Order By column."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of rows to return. Leave empty for no limit."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of rows to skip before returning results."}
   * @returns {Object}
   * @sampleResult {"rows":[{"id":1,"name":"Ada","status":"active"}],"rowCount":1}
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
   * @description Inserts a single row into a table from a JSON object of column/value pairs and returns the full inserted row (including database-generated values such as serial IDs and defaults) via RETURNING *.
   * @category Rows
   * @route POST /insert-row
   * @appearanceColor #336791 #4E8CBF
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to insert into. May be schema-qualified (e.g. public.users)."}
   * @paramDef {"type":"Object","label":"Data","name":"data","required":true,"description":"Column/value pairs for the new row as a JSON object (e.g. {\"name\":\"Ada\",\"email\":\"ada@example.com\"})."}
   * @returns {Object}
   * @sampleResult {"row":{"id":1,"name":"Ada","email":"ada@example.com","created_at":"2026-01-01T00:00:00.000Z"}}
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
   * @description Bulk-inserts multiple rows into a table in a single statement. The column set is the union of keys across all row objects; rows missing a key insert NULL for that column. Returns the inserted rows (via RETURNING *) and the inserted count.
   * @category Rows
   * @route POST /insert-rows
   * @appearanceColor #336791 #4E8CBF
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to insert into. May be schema-qualified (e.g. public.users)."}
   * @paramDef {"type":"Array<Object>","label":"Rows","name":"rows","required":true,"description":"An array of row objects with column/value pairs (e.g. [{\"name\":\"Ada\"},{\"name\":\"Linus\"}])."}
   * @returns {Object}
   * @sampleResult {"rows":[{"id":1,"name":"Ada"},{"id":2,"name":"Linus"}],"insertedCount":2}
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
   * @appearanceColor #336791 #4E8CBF
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to update. May be schema-qualified (e.g. public.users)."}
   * @paramDef {"type":"Object","label":"Data","name":"data","required":true,"description":"Column/value pairs to set as a JSON object (e.g. {\"status\":\"archived\"})."}
   * @paramDef {"type":"Object","label":"Where","name":"where","required":true,"description":"Equality conditions selecting the rows to update, combined with AND (e.g. {\"status\":\"active\"}). Null values match IS NULL; array values match any element."}
   * @returns {Object}
   * @sampleResult {"rows":[{"id":1,"name":"Ada","status":"archived"}],"updatedCount":1}
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
   * @description Deletes all rows matching the equality conditions in the Where object and returns the number of deleted rows. A non-empty Where object is required to prevent accidental full-table deletion; use Execute Query (e.g. TRUNCATE or DELETE without WHERE) for that.
   * @category Rows
   * @route DELETE /delete-rows
   * @appearanceColor #336791 #4E8CBF
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to delete from. May be schema-qualified (e.g. public.users)."}
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
   * @appearanceColor #336791 #4E8CBF
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to upsert into. May be schema-qualified (e.g. public.users)."}
   * @paramDef {"type":"Object","label":"Data","name":"data","required":true,"description":"Column/value pairs for the row as a JSON object. Must include values for all conflict columns."}
   * @paramDef {"type":"Array<String>","label":"Conflict Columns","name":"conflictColumns","required":true,"description":"Column names that identify the row (e.g. [\"email\"]). Must match a unique index or primary key on the table."}
   * @returns {Object}
   * @sampleResult {"row":{"id":1,"email":"ada@example.com","name":"Ada"}}
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
   * @description Returns the column definitions of a table from information_schema.columns: column name, data type, underlying type name, nullability, default expression, maximum character length, and ordinal position. Useful for discovering a table's structure before reading or writing.
   * @category Schema
   * @route GET /table-schema
   * @appearanceColor #336791 #4E8CBF
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to describe. May be schema-qualified (e.g. public.users); defaults to the public schema."}
   * @returns {Object}
   * @sampleResult {"schema":"public","table":"users","columns":[{"name":"id","type":"integer","udtName":"int4","nullable":false,"default":"nextval('users_id_seq'::regclass)","maxLength":null,"position":1},{"name":"email","type":"character varying","udtName":"varchar","nullable":false,"default":null,"maxLength":255,"position":2}]}
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
   * @description Lists all tables and views in user schemas (system schemas pg_catalog and information_schema are excluded), including each object's schema, name and type. Useful for discovering what data is available in the database.
   * @category Schema
   * @route GET /tables
   * @appearanceColor #336791 #4E8CBF
   * @returns {Object}
   * @sampleResult {"tables":[{"schema":"public","name":"users","type":"BASE TABLE"},{"schema":"public","name":"active_users","type":"VIEW"}],"count":2}
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
  //  DICTIONARIES
  // ==========================================================================
  /**
   * @registerAs DICTIONARY
   * @operationName Get Tables Dictionary
   * @description Provides a searchable list of tables and views from user schemas for dynamic dropdown selection in other operations. Values are schema-qualified (e.g. public.users).
   * @route POST /get-tables-dictionary
   * @paramDef {"type":"getTablesDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"users","value":"public.users","note":"public · BASE TABLE"}],"cursor":null}
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
   * @operationName Get Columns Dictionary
   * @description Provides a searchable list of column names for the table selected in a dependent parameter, with each column's data type as a note.
   * @route POST /get-columns-dictionary
   * @paramDef {"type":"getColumnsDictionary__payload","label":"Payload","name":"payload","description":"Optional search text, pagination cursor, and the selected table as criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"email","value":"email","note":"character varying"}],"cursor":null}
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

Flowrunner.ServerCode.addService(PostgreSQL, [
  {
    name: 'connectionString',
    displayName: 'Connection String',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Full PostgreSQL connection URI, e.g. postgresql://user:password@db.example.com:5432/mydb - most managed providers (Supabase, Neon, RDS, Heroku) supply one. When set, it takes precedence and the Host/Port/Database/User/Password fields below are ignored. Special characters in the password must be URL-encoded; if that is a problem, use the individual fields instead. Supabase: use the "Session pooler" connection string from the Connect dialog - the direct db.<project-ref>.supabase.co endpoint is IPv6-only and usually unreachable.',
  },
  {
    name: 'host',
    displayName: 'Host',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Hostname or IP address of the PostgreSQL server (e.g. db.example.com). Required unless a Connection String is provided. The server must be reachable from FlowRunner.',
  },
  {
    name: 'port',
    displayName: 'Port',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    defaultValue: '5432',
    hint: 'TCP port of the PostgreSQL server. The default is 5432. Ignored when a Connection String is provided.',
  },
  {
    name: 'database',
    displayName: 'Database',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Name of the database to connect to. Required unless a Connection String is provided.',
  },
  {
    name: 'user',
    displayName: 'User',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Database user (role) name. Required unless a Connection String is provided.',
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
    hint: 'Enable TLS-encrypted connections. Required by most managed databases (e.g. AWS RDS, Google Cloud SQL, Azure Database, Heroku Postgres). With a Connection String, enabling this adds managed-provider-friendly TLS on top of the URI; when off, any sslmode in the URI still applies.',
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
