const sql = require('mssql')

const logger = {
  info: (...args) => console.log('[Microsoft SQL Server] info:', ...args),
  debug: (...args) => console.log('[Microsoft SQL Server] debug:', ...args),
  error: (...args) => console.log('[Microsoft SQL Server] error:', ...args),
  warn: (...args) => console.log('[Microsoft SQL Server] warn:', ...args),
}

const DEFAULT_PORT = 1433
const DEFAULT_CONNECTION_TIMEOUT_SECONDS = 15
const REQUEST_TIMEOUT_MS = 120000
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
 * @integrationName Microsoft SQL Server
 * @integrationIcon /icon.svg
 */
class MicrosoftSQLServer {
  constructor(config) {
    this.config = config || {}

    this.connectionString = (this.config.connectionString || '').trim()
    this.host = this.config.host
    this.port = parseInt(this.config.port, 10) || DEFAULT_PORT
    this.database = this.config.database
    this.user = this.config.user
    this.password = this.config.password
    this.encrypt = this.config.encrypt === true || this.config.encrypt === 'true'
    this.trustServerCertificate = this.config.trustServerCertificate === true || this.config.trustServerCertificate === 'true'

    const timeoutSeconds = parseInt(this.config.connectionTimeoutSeconds, 10)

    this.connectionTimeoutMillis = (timeoutSeconds > 0 ? timeoutSeconds : DEFAULT_CONNECTION_TIMEOUT_SECONDS) * 1000
  }

  // ==========================================================================
  //  CORE — connection lifecycle: one short-lived ConnectionPool per method
  //  call. A pool is created, connected, used and always closed in finally.
  //  Connections are NEVER cached between invocations. new sql.ConnectionPool
  //  is used instead of sql.connect() to avoid the driver's shared global
  //  pool, which is unsafe with concurrent invocations.
  // ==========================================================================
  async #withConnection(logTag, fn) {
    const pool = new sql.ConnectionPool(this.#buildConnectionConfig(logTag))

    try {
      logger.debug(`${ logTag } - connecting to ${ this.#connectionLabel() }`)

      await pool.connect()

      return await fn(pool)
    } catch (error) {
      this.#throwSqlError(error, logTag)
    } finally {
      try {
        await pool.close()
      } catch (closeError) {
        logger.warn(`${ logTag } - failed to close connection: ${ closeError.message }`)
      }
    }
  }

  // A Connection String, when set, wins over the individual fields. It is parsed with the
  // driver's own parser (ADO.NET style: Server=host,1433;Database=db;User Id=u;Password=p;
  // Encrypt=true) so encryption settings come from the string itself — the Encrypt and
  // Trust Server Certificate toggles apply to field-based configuration only.
  #buildConnectionConfig(logTag) {
    const shared = {
      requestTimeout: REQUEST_TIMEOUT_MS,
      pool: { max: 1, min: 0 },
    }

    if (this.connectionString) {
      let parsed

      try {
        parsed = sql.ConnectionPool.parseConnectionString(this.connectionString)
      } catch (parseError) {
        logger.error(`${ logTag } - invalid connection string: ${ parseError.message }`)

        throw new Error(
          'Microsoft SQL Server error: the Connection String could not be parsed. ' +
          'Use the ADO.NET format, e.g. Server=db.example.com,1433;Database=mydb;User Id=myuser;Password=mypassword;Encrypt=true'
        )
      }

      if (!parsed.server) {
        logger.error(`${ logTag } - connection string has no server`)

        throw new Error(
          'Microsoft SQL Server error: the Connection String does not specify a server. ' +
          'Include a Server= entry, e.g. Server=db.example.com,1433'
        )
      }

      // The string's own Connection Timeout wins when present; the configured default applies otherwise.
      return {
        connectionTimeout: this.connectionTimeoutMillis,
        ...parsed,
        ...shared,
      }
    }

    if (!this.host || !this.database || !this.user) {
      logger.error(`${ logTag } - incomplete connection configuration`)

      throw new Error(
        'Microsoft SQL Server error: incomplete connection configuration. ' +
        'Provide a Connection String (e.g. Server=db.example.com,1433;Database=mydb;User Id=myuser;Password=mypassword;Encrypt=true), ' +
        'or fill in Host, Database, User and Password in the service configuration.'
      )
    }

    return {
      server: this.host,
      port: this.port,
      database: this.database,
      user: this.user,
      password: this.password,
      options: {
        encrypt: this.encrypt,
        trustServerCertificate: this.trustServerCertificate,
      },
      connectionTimeout: this.connectionTimeoutMillis,
      ...shared,
    }
  }

  // Human-readable connection target for logs. Never includes credentials: the connection
  // string embeds the password, so only its Server= part is extracted.
  #connectionLabel() {
    if (this.connectionString) {
      const match = this.connectionString.match(/server\s*=\s*(?:tcp:)?([^;]+)/i)

      return match ? `${ match[1].trim() } (connection string)` : 'connection string'
    }

    return `${ this.host }:${ this.port }/${ this.database }`
  }

  #throwSqlError(error, logTag) {
    const parts = [error.message]

    if (error.code) parts.push(`code: ${ error.code }`)
    if (error.number) parts.push(`number: ${ error.number }`)
    if (error.lineNumber) parts.push(`line: ${ error.lineNumber }`)

    // ENETUNREACH against an IPv6 address means the host resolved to IPv6 only and this
    // environment has no IPv6 route. Point the user at an IPv4-compatible endpoint instead
    // of leaving them with a bare ENETUNREACH. The socket error may be nested by the driver.
    const chain = [error, error.originalError, error.originalError && error.originalError.originalError].filter(Boolean)
    const netError = chain.find(nested => nested.code === 'ENETUNREACH')

    if ((netError && String(netError.address || '').includes(':')) || /ENETUNREACH/.test(error.message || '')) {
      parts.push(
        'hint: the database host may have resolved to an IPv6-only address while this environment has no IPv6 connectivity. ' +
        'Use a hostname or endpoint that resolves to an IPv4 address, and verify the server is reachable from FlowRunner.'
      )
    }

    const message = parts.join(' | ')

    logger.error(`${ logTag } - failed: ${ message }`)

    throw new Error(`Microsoft SQL Server error: ${ message }`)
  }

  // Binds positional values as named parameters @p1, @p2, ... and runs the statement.
  async #runQuery(pool, sqlText, params) {
    const request = pool.request()

    ;(params || []).forEach((value, index) => request.input(`p${ index + 1 }`, value))

    return request.query(sqlText)
  }

  // Quotes a single SQL identifier (column name). Identifiers cannot be bound
  // as query parameters, so they are escaped with bracket quoting (] doubled).
  #quoteIdent(name) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error(`Invalid identifier: ${ JSON.stringify(name) }. Identifiers must be non-empty strings.`)
    }

    return `[${ name.replace(/]/g, ']]') }]`
  }

  // Quotes a table reference, supporting optional schema qualification ("dbo.Users").
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
      return { schema: 'dbo', name: table }
    }

    return { schema: table.slice(0, separatorIndex), name: table.slice(separatorIndex + 1) }
  }

  // Builds a parameterized WHERE clause from a conditions object.
  // null values become IS NULL; array values become IN (@p1, @p2, ...) with one bound
  // parameter per element (an empty array matches nothing); everything else uses equality.
  #buildWhere(where, params) {
    const entries = Object.entries(where || {})

    if (!entries.length) return ''

    const clauses = entries.map(([column, value]) => {
      if (value === null) {
        return `${ this.#quoteIdent(column) } IS NULL`
      }

      if (Array.isArray(value)) {
        if (!value.length) return '1 = 0'

        const placeholders = value.map(element => {
          params.push(element)

          return `@p${ params.length }`
        })

        return `${ this.#quoteIdent(column) } IN (${ placeholders.join(', ') })`
      }

      params.push(value)

      return `${ this.#quoteIdent(column) } = @p${ params.length }`
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
   * @description Executes an arbitrary T-SQL statement (SELECT, INSERT, UPDATE, DELETE, DDL, CTEs, stored procedure calls via EXEC, etc.) and returns the resulting rows and the affected row counts. Use @p1, @p2, ... placeholders in the SQL together with the Parameters array to safely bind values — never interpolate user input into the SQL string. Statements are limited to 120 seconds of execution time.
   * @category SQL
   * @route POST /execute-query
   * @appearanceColor #A91D22 #E8262C
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"SQL","name":"sqlText","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The T-SQL statement to execute. Use @p1, @p2, ... placeholders for values bound via the Parameters array."}
   * @paramDef {"type":"Array","label":"Parameters","name":"params","description":"Values for the @p1, @p2, ... placeholders, in order (e.g. [\"ada@example.com\", 30]). Elements may be strings, numbers, booleans or null."}
   * @returns {Object}
   * @sampleResult {"recordset":[{"id":1,"name":"Ada"}],"rowsAffected":[1]}
   */
  async executeQuery(sqlText, params) {
    if (typeof sqlText !== 'string' || !sqlText.trim()) {
      throw new Error('SQL statement is required.')
    }

    return this.#withConnection('executeQuery', async pool => {
      const result = await this.#runQuery(pool, sqlText, Array.isArray(params) ? params : [])

      return {
        recordset: result.recordset || [],
        rowsAffected: result.rowsAffected || [],
      }
    })
  }

  // ==========================================================================
  //  ROWS
  // ==========================================================================
  /**
   * @operationName Select Rows
   * @description Selects rows from a table without writing SQL. Supports choosing specific columns, equality-based filtering (null values match IS NULL, array values match any element via IN), ordering, and limit/offset pagination (TOP when only a limit is given, OFFSET ... FETCH when an offset is given). For joins, aggregations, or complex conditions use Execute Query instead.
   * @category Rows
   * @route POST /select-rows
   * @appearanceColor #A91D22 #E8262C
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to read from. May be schema-qualified (e.g. dbo.Users); defaults to the dbo schema."}
   * @paramDef {"type":"Array<String>","label":"Columns","name":"columns","description":"Column names to return. Leave empty to return all columns (SELECT *)."}
   * @paramDef {"type":"Object","label":"Where","name":"where","description":"Equality conditions as a JSON object, combined with AND (e.g. {\"status\":\"active\",\"deleted_at\":null}). Array values match any element."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","dictionary":"getColumnsDictionary","dependsOn":["table"],"description":"Column to sort the results by."}
   * @paramDef {"type":"String","label":"Sort Direction","name":"sortDirection","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"defaultValue":"Ascending","description":"Sort direction applied to the Order By column."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of rows to return. Leave empty for no limit."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of rows to skip before returning results. When set without an Order By column, an arbitrary stable ordering is applied."}
   * @returns {Object}
   * @sampleResult {"rows":[{"id":1,"name":"Ada","status":"active"}],"rowCount":1}
   */
  async selectRows(table, columns, where, orderBy, sortDirection, limit, offset) {
    const params = []
    const columnList = Array.isArray(columns) && columns.length
      ? columns.map(column => this.#quoteIdent(column)).join(', ')
      : '*'

    const whereSql = this.#buildWhere(where, params)

    let orderSql = ''

    if (orderBy) {
      const direction = this.#resolveChoice(sortDirection, { 'Ascending': 'ASC', 'Descending': 'DESC' }) || 'ASC'

      orderSql = ` ORDER BY ${ this.#quoteIdent(orderBy) } ${ direction }`
    }

    const limitValue = limit === undefined || limit === null || limit === '' ? null : parseInt(limit, 10)
    const offsetValue = offset === undefined || offset === null || offset === '' ? null : parseInt(offset, 10)

    let sqlText

    if (offsetValue !== null) {
      // OFFSET ... FETCH requires an ORDER BY clause; fall back to an arbitrary ordering.
      if (!orderSql) orderSql = ' ORDER BY (SELECT NULL)'

      params.push(offsetValue)

      let pagingSql = ` OFFSET @p${ params.length } ROWS`

      if (limitValue !== null) {
        params.push(limitValue)
        pagingSql += ` FETCH NEXT @p${ params.length } ROWS ONLY`
      }

      sqlText = `SELECT ${ columnList } FROM ${ this.#quoteTable(table) }${ whereSql }${ orderSql }${ pagingSql }`
    } else if (limitValue !== null) {
      params.push(limitValue)
      sqlText = `SELECT TOP (@p${ params.length }) ${ columnList } FROM ${ this.#quoteTable(table) }${ whereSql }${ orderSql }`
    } else {
      sqlText = `SELECT ${ columnList } FROM ${ this.#quoteTable(table) }${ whereSql }${ orderSql }`
    }

    return this.#withConnection('selectRows', async pool => {
      const result = await this.#runQuery(pool, sqlText, params)
      const rows = result.recordset || []

      return { rows, rowCount: rows.length }
    })
  }

  /**
   * @operationName Insert Row
   * @description Inserts a single row into a table from a JSON object of column/value pairs and returns the full inserted row (including database-generated values such as IDENTITY values and defaults) via OUTPUT INSERTED.*. Note: OUTPUT cannot be used on tables with enabled triggers — use Execute Query with OUTPUT ... INTO for those.
   * @category Rows
   * @route POST /insert-row
   * @appearanceColor #A91D22 #E8262C
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to insert into. May be schema-qualified (e.g. dbo.Users)."}
   * @paramDef {"type":"Object","label":"Data","name":"data","required":true,"description":"Column/value pairs for the new row as a JSON object (e.g. {\"name\":\"Ada\",\"email\":\"ada@example.com\"})."}
   * @returns {Object}
   * @sampleResult {"row":{"id":1,"name":"Ada","email":"ada@example.com","created_at":"2026-01-01T00:00:00.000Z"}}
   */
  async insertRow(table, data) {
    this.#requireNonEmptyObject(data, 'Data')

    const columns = Object.keys(data)
    const params = columns.map(column => data[column])
    const columnList = columns.map(column => this.#quoteIdent(column)).join(', ')
    const placeholders = columns.map((_, index) => `@p${ index + 1 }`).join(', ')
    const sqlText = `INSERT INTO ${ this.#quoteTable(table) } (${ columnList }) OUTPUT INSERTED.* VALUES (${ placeholders })`

    return this.#withConnection('insertRow', async pool => {
      const result = await this.#runQuery(pool, sqlText, params)

      return { row: (result.recordset && result.recordset[0]) || null }
    })
  }

  /**
   * @operationName Insert Rows
   * @description Bulk-inserts multiple rows into a table in a single statement. The column set is the union of keys across all row objects; rows missing a key insert NULL for that column. Returns the inserted rows (via OUTPUT INSERTED.*) and the inserted count. SQL Server limits a single statement to 1000 row value expressions and about 2100 bound parameters — split larger batches across multiple calls.
   * @category Rows
   * @route POST /insert-rows
   * @appearanceColor #A91D22 #E8262C
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to insert into. May be schema-qualified (e.g. dbo.Users)."}
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

          return `@p${ params.length }`
        })

        return `(${ placeholders.join(', ') })`
      })
      .join(', ')

    const sqlText = `INSERT INTO ${ this.#quoteTable(table) } (${ columnList }) OUTPUT INSERTED.* VALUES ${ valuesSql }`

    return this.#withConnection('insertRows', async pool => {
      const result = await this.#runQuery(pool, sqlText, params)
      const inserted = result.recordset || []

      return { rows: inserted, insertedCount: (result.rowsAffected && result.rowsAffected[0]) || inserted.length }
    })
  }

  /**
   * @operationName Update Rows
   * @description Updates all rows matching the equality conditions in the Where object, setting the columns provided in the Data object. Returns the updated rows (via OUTPUT INSERTED.*) and the updated count. A non-empty Where object is required to prevent accidental full-table updates; use Execute Query for unconditional updates.
   * @category Rows
   * @route PATCH /update-rows
   * @appearanceColor #A91D22 #E8262C
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to update. May be schema-qualified (e.g. dbo.Users)."}
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

        return `${ this.#quoteIdent(column) } = @p${ params.length }`
      })
      .join(', ')

    const sqlText = `UPDATE ${ this.#quoteTable(table) } SET ${ assignments } OUTPUT INSERTED.*${ this.#buildWhere(where, params) }`

    return this.#withConnection('updateRows', async pool => {
      const result = await this.#runQuery(pool, sqlText, params)
      const updated = result.recordset || []

      return { rows: updated, updatedCount: (result.rowsAffected && result.rowsAffected[0]) || updated.length }
    })
  }

  /**
   * @operationName Delete Rows
   * @description Deletes all rows matching the equality conditions in the Where object and returns the number of deleted rows. A non-empty Where object is required to prevent accidental full-table deletion; use Execute Query (e.g. TRUNCATE TABLE or DELETE without WHERE) for that.
   * @category Rows
   * @route DELETE /delete-rows
   * @appearanceColor #A91D22 #E8262C
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to delete from. May be schema-qualified (e.g. dbo.Users)."}
   * @paramDef {"type":"Object","label":"Where","name":"where","required":true,"description":"Equality conditions selecting the rows to delete, combined with AND (e.g. {\"status\":\"archived\"}). Null values match IS NULL; array values match any element."}
   * @returns {Object}
   * @sampleResult {"deletedCount":3}
   */
  async deleteRows(table, where) {
    this.#requireNonEmptyObject(where, 'Where')

    const params = []
    const sqlText = `DELETE FROM ${ this.#quoteTable(table) }${ this.#buildWhere(where, params) }`

    return this.#withConnection('deleteRows', async pool => {
      const result = await this.#runQuery(pool, sqlText, params)

      return { deletedCount: (result.rowsAffected && result.rowsAffected[0]) || 0 }
    })
  }

  /**
   * @operationName Upsert Row
   * @description Inserts a row, or updates the existing row when a row with the same key column values already exists (MERGE ... WHEN MATCHED THEN UPDATE WHEN NOT MATCHED THEN INSERT). All non-key columns from Data are updated on match; Data must include values for every key column. The key columns should be covered by a primary key or unique index to guarantee a single match. Returns the resulting row via OUTPUT INSERTED.*.
   * @category Rows
   * @route POST /upsert-row
   * @appearanceColor #A91D22 #E8262C
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to upsert into. May be schema-qualified (e.g. dbo.Users)."}
   * @paramDef {"type":"Object","label":"Data","name":"data","required":true,"description":"Column/value pairs for the row as a JSON object. Must include values for all key columns."}
   * @paramDef {"type":"Array<String>","label":"Key Columns","name":"keyColumns","required":true,"description":"Column names that identify the row (e.g. [\"email\"]). Should match a primary key or unique index on the table."}
   * @returns {Object}
   * @sampleResult {"row":{"id":1,"email":"ada@example.com","name":"Ada"}}
   */
  async upsertRow(table, data, keyColumns) {
    this.#requireNonEmptyObject(data, 'Data')

    if (!Array.isArray(keyColumns) || !keyColumns.length) {
      throw new Error('Key Columns must be a non-empty array of column names.')
    }

    const columns = Object.keys(data)
    const missingKeys = keyColumns.filter(column => !columns.includes(column))

    if (missingKeys.length) {
      throw new Error(`Data must include values for all key columns. Missing: ${ missingKeys.join(', ') }.`)
    }

    const params = columns.map(column => data[column])
    const sourceSelect = columns.map((column, index) => `@p${ index + 1 } AS ${ this.#quoteIdent(column) }`).join(', ')
    const onClause = keyColumns.map(column => `[target].${ this.#quoteIdent(column) } = [source].${ this.#quoteIdent(column) }`).join(' AND ')
    const columnList = columns.map(column => this.#quoteIdent(column)).join(', ')
    const insertValues = columns.map(column => `[source].${ this.#quoteIdent(column) }`).join(', ')

    // When Data holds only key columns there is nothing meaningful to update on match,
    // but MERGE only OUTPUTs rows an action was taken on — assign the first key column
    // to itself as a no-op so the matched row is still returned.
    const updateColumns = columns.filter(column => !keyColumns.includes(column))
    const updateSet = (updateColumns.length ? updateColumns : keyColumns.slice(0, 1))
      .map(column => `[target].${ this.#quoteIdent(column) } = [source].${ this.#quoteIdent(column) }`)
      .join(', ')

    const sqlText =
      `MERGE ${ this.#quoteTable(table) } AS [target] ` +
      `USING (SELECT ${ sourceSelect }) AS [source] ` +
      `ON (${ onClause }) ` +
      `WHEN MATCHED THEN UPDATE SET ${ updateSet } ` +
      `WHEN NOT MATCHED THEN INSERT (${ columnList }) VALUES (${ insertValues }) ` +
      'OUTPUT INSERTED.*;'

    return this.#withConnection('upsertRow', async pool => {
      const result = await this.#runQuery(pool, sqlText, params)

      return { row: (result.recordset && result.recordset[0]) || null }
    })
  }

  // ==========================================================================
  //  SCHEMA
  // ==========================================================================
  /**
   * @operationName Get Table Schema
   * @description Returns the column definitions of a table from INFORMATION_SCHEMA.COLUMNS: column name, data type, nullability, default expression, maximum character length, and ordinal position. Useful for discovering a table's structure before reading or writing.
   * @category Schema
   * @route GET /table-schema
   * @appearanceColor #A91D22 #E8262C
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to describe. May be schema-qualified (e.g. dbo.Users); defaults to the dbo schema."}
   * @returns {Object}
   * @sampleResult {"schema":"dbo","table":"Users","columns":[{"name":"id","type":"int","nullable":false,"default":null,"maxLength":null,"position":1},{"name":"email","type":"nvarchar","nullable":false,"default":null,"maxLength":255,"position":2}]}
   */
  async getTableSchema(table) {
    const { schema, name } = this.#splitTable(table)

    const sqlText = `
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, CHARACTER_MAXIMUM_LENGTH, ORDINAL_POSITION
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = @p1 AND TABLE_NAME = @p2
      ORDER BY ORDINAL_POSITION
    `

    return this.#withConnection('getTableSchema', async pool => {
      const result = await this.#runQuery(pool, sqlText, [schema, name])
      const rows = result.recordset || []

      if (!rows.length) {
        throw new Error(`Table "${ schema }.${ name }" was not found or has no columns.`)
      }

      return {
        schema,
        table: name,
        columns: rows.map(row => ({
          name: row.COLUMN_NAME,
          type: row.DATA_TYPE,
          nullable: row.IS_NULLABLE === 'YES',
          default: row.COLUMN_DEFAULT,
          maxLength: row.CHARACTER_MAXIMUM_LENGTH,
          position: row.ORDINAL_POSITION,
        })),
      }
    })
  }

  /**
   * @operationName List Tables
   * @description Lists all base tables in the database from INFORMATION_SCHEMA.TABLES (views are excluded), including each table's schema and name. Useful for discovering what data is available in the database.
   * @category Schema
   * @route GET /tables
   * @appearanceColor #A91D22 #E8262C
   * @returns {Object}
   * @sampleResult {"tables":[{"schema":"dbo","name":"Users"},{"schema":"sales","name":"Orders"}],"count":2}
   */
  async listTables() {
    const sqlText = `
      SELECT TABLE_SCHEMA, TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_SCHEMA, TABLE_NAME
    `

    return this.#withConnection('listTables', async pool => {
      const result = await this.#runQuery(pool, sqlText, [])
      const rows = result.recordset || []

      return {
        tables: rows.map(row => ({ schema: row.TABLE_SCHEMA, name: row.TABLE_NAME })),
        count: rows.length,
      }
    })
  }

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================
  /**
   * @registerAs DICTIONARY
   * @operationName Get Tables Dictionary
   * @description Provides a searchable list of tables and views for dynamic dropdown selection in other operations. Values are schema-qualified (e.g. dbo.Users).
   * @route POST /get-tables-dictionary
   * @paramDef {"type":"getTablesDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Users","value":"dbo.Users","note":"dbo · BASE TABLE"}],"cursor":null}
   */
  async getTablesDictionary(payload) {
    const { search, cursor } = payload || {}
    const offset = parseInt(cursor, 10) || 0
    const params = [search ? `%${ search }%` : null, offset, DICTIONARY_PAGE_SIZE + 1]

    const sqlText = `
      SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
      FROM INFORMATION_SCHEMA.TABLES
      WHERE (@p1 IS NULL OR TABLE_NAME LIKE @p1)
      ORDER BY TABLE_SCHEMA, TABLE_NAME
      OFFSET @p2 ROWS FETCH NEXT @p3 ROWS ONLY
    `

    return this.#withConnection('getTablesDictionary', async pool => {
      const result = await this.#runQuery(pool, sqlText, params)
      const rows = result.recordset || []
      const hasMore = rows.length > DICTIONARY_PAGE_SIZE
      const page = hasMore ? rows.slice(0, DICTIONARY_PAGE_SIZE) : rows

      return {
        items: page.map(row => ({
          label: row.TABLE_NAME,
          value: `${ row.TABLE_SCHEMA }.${ row.TABLE_NAME }`,
          note: `${ row.TABLE_SCHEMA } · ${ row.TABLE_TYPE }`,
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
   * @sampleResult {"items":[{"label":"email","value":"email","note":"nvarchar"}],"cursor":null}
   */
  async getColumnsDictionary(payload) {
    const { search, criteria } = payload || {}
    const table = criteria && criteria.table

    if (!table) {
      return { items: [], cursor: null }
    }

    const { schema, name } = this.#splitTable(table)
    const params = [schema, name, search ? `%${ search }%` : null]

    const sqlText = `
      SELECT COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = @p1 AND TABLE_NAME = @p2
        AND (@p3 IS NULL OR COLUMN_NAME LIKE @p3)
      ORDER BY ORDINAL_POSITION
    `

    return this.#withConnection('getColumnsDictionary', async pool => {
      const result = await this.#runQuery(pool, sqlText, params)
      const rows = result.recordset || []

      return {
        items: rows.map(row => ({
          label: row.COLUMN_NAME,
          value: row.COLUMN_NAME,
          note: row.DATA_TYPE,
        })),
        cursor: null,
      }
    })
  }
}

Flowrunner.ServerCode.addService(MicrosoftSQLServer, [
  {
    name: 'connectionString',
    displayName: 'Connection String',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Full SQL Server connection string in ADO.NET format, e.g. Server=db.example.com,1433;Database=mydb;User Id=myuser;Password=mypassword;Encrypt=true - Azure SQL provides one on the database\'s "Connection strings" page. When set, it takes precedence and the Host/Port/Database/User/Password fields and the Encrypt/Trust Server Certificate toggles below are ignored; include Encrypt= and TrustServerCertificate= in the string itself.',
  },
  {
    name: 'host',
    displayName: 'Host',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Hostname or IP address of the SQL Server instance (e.g. db.example.com or yourserver.database.windows.net). Required unless a Connection String is provided. The server must be reachable from FlowRunner.',
  },
  {
    name: 'port',
    displayName: 'Port',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    defaultValue: '1433',
    hint: 'TCP port of the SQL Server instance. The default is 1433. Ignored when a Connection String is provided.',
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
    hint: 'SQL Server login name. Required unless a Connection String is provided. Some older Azure SQL setups require the user@server form (e.g. myuser@yourserver).',
  },
  {
    name: 'password',
    displayName: 'Password',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Password for the SQL Server login. Required unless a Connection String is provided.',
  },
  {
    name: 'encrypt',
    displayName: 'Encrypt Connection',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.BOOL,
    required: false,
    shared: false,
    defaultValue: true,
    hint: 'Enable TLS encryption for the connection. Required for Azure SQL Database and recommended for any server reachable over the internet. Applies to field-based configuration only; with a Connection String, set Encrypt= in the string.',
  },
  {
    name: 'trustServerCertificate',
    displayName: 'Trust Server Certificate',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.BOOL,
    required: false,
    shared: false,
    defaultValue: false,
    hint: 'Accept the server\'s TLS certificate without validation. Enable for servers with self-signed certificates (local development, some on-premises installs). Applies to field-based configuration only; with a Connection String, set TrustServerCertificate= in the string.',
  },
  {
    name: 'connectionTimeoutSeconds',
    displayName: 'Connection Timeout (seconds)',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    defaultValue: '15',
    hint: 'How long to wait when establishing a connection before failing. Defaults to 15 seconds.',
  },
])
