const mysql = require('mysql2/promise')

const logger = {
  info: (...args) => console.log('[MySQL] info:', ...args),
  debug: (...args) => console.log('[MySQL] debug:', ...args),
  error: (...args) => console.log('[MySQL] error:', ...args),
  warn: (...args) => console.log('[MySQL] warn:', ...args),
}

const DEFAULT_PORT = 3306
const DEFAULT_CONNECTION_TIMEOUT_SECONDS = 10
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
 * @integrationName MySQL
 * @integrationIcon /icon.png
 */
class MySQL {
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
  //  CORE — connection lifecycle: one short-lived connection per method call.
  //  A connection is created, used and always closed in finally.
  //  Connections are NEVER pooled or cached between invocations.
  // ==========================================================================
  async #withClient(logTag, fn) {
    let connection

    try {
      logger.debug(`${ logTag } - connecting to ${ this.#connectionLabel() }`)

      connection = await mysql.createConnection(this.#buildClientConfig(logTag))

      return await fn(connection)
    } catch (error) {
      this.#throwMySqlError(error, logTag)
    } finally {
      if (connection) {
        try {
          await connection.end()
        } catch (endError) {
          logger.warn(`${ logTag } - failed to close connection: ${ endError.message }`)
        }
      }
    }
  }

  // A Connection String, when set, wins over the individual fields. When using it, the SSL
  // toggle only ADDS the managed-provider-friendly ssl config on top; when the toggle is off
  // the string's own ssl query params stay in effect (we must not pass an explicit ssl value,
  // as explicit config overrides values parsed from the string).
  #buildClientConfig(logTag) {
    const shared = {
      connectTimeout: this.connectionTimeoutMillis,
    }

    if (this.connectionString) {
      return {
        uri: this.connectionString,
        ...(this.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
        ...shared,
      }
    }

    if (!this.host || !this.database || !this.user) {
      logger.error(`${ logTag } - incomplete connection configuration`)

      throw new Error(
        'MySQL error: incomplete connection configuration. ' +
        'Provide a Connection String (e.g. mysql://user:password@host:3306/database), ' +
        'or fill in Host, Database, User and Password in the service configuration.'
      )
    }

    return {
      host: this.host,
      port: this.port,
      database: this.database,
      user: this.user,
      password: this.password,
      ...(this.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
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

  #throwMySqlError(error, logTag) {
    const parts = [error.message]

    if (error.code) parts.push(`code: ${ error.code }`)
    if (error.errno) parts.push(`errno: ${ error.errno }`)
    if (error.sqlState) parts.push(`sqlState: ${ error.sqlState }`)

    // ENETUNREACH against an IPv6 address means the host resolved to IPv6 only and this
    // environment has no IPv6 route. Point the user at an IPv4-compatible endpoint instead
    // of leaving them with a bare ENETUNREACH.
    if (error.code === 'ENETUNREACH' && String(error.address || '').includes(':')) {
      parts.push(
        'hint: the database host resolved to an IPv6-only address and this environment has no IPv6 connectivity. ' +
        'Use an IPv4-compatible hostname or endpoint for your database server.'
      )
    }

    // A reset/dropped connection during handshake with TLS disabled is the typical symptom
    // of a managed host that requires encrypted connections.
    if (!this.ssl && ['ECONNRESET', 'EPIPE', 'HANDSHAKE_SSL_ERROR', 'HANDSHAKE_NO_SSL_SUPPORT'].includes(error.code)) {
      parts.push(
        'hint: managed MySQL hosts (e.g. PlanetScale, Aiven, Azure Database) usually require TLS - ' +
        'enable the "Use SSL/TLS" setting or add TLS parameters to the connection string.'
      )
    }

    const message = parts.join(' | ')

    logger.error(`${ logTag } - failed: ${ message }`)

    throw new Error(`MySQL error: ${ message }`)
  }

  // Quotes a single SQL identifier (column name). Identifiers cannot be bound
  // as query parameters, so they are escaped with backtick doubling.
  #quoteIdent(name) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error(`Invalid identifier: ${ JSON.stringify(name) }. Identifiers must be non-empty strings.`)
    }

    return `\`${ name.replace(/`/g, '``') }\``
  }

  // Quotes a table reference, supporting optional database qualification ("mydb.users").
  #quoteTable(table) {
    const { schema, name } = this.#splitTable(table)

    return schema ? `${ this.#quoteIdent(schema) }.${ this.#quoteIdent(name) }` : this.#quoteIdent(name)
  }

  // Splits an optionally database-qualified table reference. Unqualified names use the
  // database of the current connection (schema: null -> DATABASE() in metadata queries).
  #splitTable(table) {
    if (typeof table !== 'string' || !table.trim()) {
      throw new Error('Table name is required and must be a non-empty string.')
    }

    const separatorIndex = table.indexOf('.')

    if (separatorIndex === -1) {
      return { schema: null, name: table }
    }

    return { schema: table.slice(0, separatorIndex), name: table.slice(separatorIndex + 1) }
  }

  // Builds a parameterized WHERE clause from a conditions object.
  // null values become IS NULL; array values become IN (?, ?, ...); everything else uses equality.
  #buildWhere(where, params) {
    const entries = Object.entries(where || {})

    if (!entries.length) return ''

    const clauses = entries.map(([column, value]) => {
      if (value === null) {
        return `${ this.#quoteIdent(column) } IS NULL`
      }

      if (Array.isArray(value)) {
        if (!value.length) {
          return '1 = 0'
        }

        params.push(...value)

        return `${ this.#quoteIdent(column) } IN (${ value.map(() => '?').join(', ') })`
      }

      params.push(value)

      return `${ this.#quoteIdent(column) } = ?`
    })

    return ` WHERE ${ clauses.join(' AND ') }`
  }

  #requireNonEmptyObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) {
      throw new Error(`${ label } must be a non-empty object.`)
    }
  }

  // LIMIT/OFFSET cannot be bound reliably through the binary (prepared statement) protocol,
  // so they are validated as non-negative integers and inlined into the SQL text.
  #toNonNegativeInteger(value, label) {
    if (value === undefined || value === null || value === '') return undefined

    const parsed = Number(value)

    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`${ label } must be a non-negative integer.`)
    }

    return parsed
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
   * @description Executes an arbitrary single SQL statement (SELECT, INSERT, UPDATE, DELETE, DDL, CTEs, etc.). Use ? placeholders in the SQL together with the Parameters array to safely bind values — never interpolate user input into the SQL string. Returns rows, the row count, and result field metadata for SELECT-like statements, or affectedRows/insertId/changedRows for write statements. Statements are limited to 120 seconds of execution time.
   * @category SQL
   * @route POST /execute-query
   * @appearanceColor #00758F #F29111
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"SQL","name":"sql","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The SQL statement to execute. Use ? placeholders for values bound via the Parameters array. Multiple statements per call are not supported."}
   * @paramDef {"type":"Array","label":"Parameters","name":"params","description":"Values for the ? placeholders, in order (e.g. [\"ada@example.com\", 30]). Elements may be strings, numbers, booleans or null."}
   * @returns {Object}
   * @sampleResult {"rows":[{"id":1,"name":"Ada"}],"rowCount":1,"fields":[{"name":"id","type":3},{"name":"name","type":253}]}
   */
  async executeQuery(sql, params) {
    if (typeof sql !== 'string' || !sql.trim()) {
      throw new Error('SQL statement is required.')
    }

    return this.#withClient('executeQuery', async connection => {
      const [result, fields] = await connection.query(sql, Array.isArray(params) ? params : [])

      if (Array.isArray(result)) {
        return {
          rows: result,
          rowCount: result.length,
          fields: (fields || []).map(field => ({ name: field.name, type: field.type })),
        }
      }

      return {
        affectedRows: result.affectedRows,
        insertId: result.insertId,
        changedRows: result.changedRows,
      }
    })
  }

  // ==========================================================================
  //  ROWS
  // ==========================================================================
  /**
   * @operationName Select Rows
   * @description Selects rows from a table without writing SQL. Supports choosing specific columns, equality-based filtering (null values match IS NULL, array values match any element via IN), ordering, and limit/offset pagination. For joins, aggregations, or complex conditions use Execute Query instead.
   * @category Rows
   * @route POST /select-rows
   * @appearanceColor #00758F #F29111
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to read from. May be database-qualified (e.g. mydb.users); defaults to the configured database."}
   * @paramDef {"type":"Array<String>","label":"Columns","name":"columns","description":"Column names to return. Leave empty to return all columns (SELECT *)."}
   * @paramDef {"type":"Object","label":"Where","name":"where","description":"Equality conditions as a JSON object, combined with AND (e.g. {\"status\":\"active\",\"deleted_at\":null}). Array values match any element."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","dictionary":"getColumnsDictionary","dependsOn":["table"],"description":"Column to sort the results by."}
   * @paramDef {"type":"String","label":"Sort Direction","name":"sortDirection","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"defaultValue":"Ascending","description":"Sort direction applied to the Order By column."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of rows to return. Leave empty for no limit."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of rows to skip before returning results. Requires a Limit in MySQL; when omitted with an Offset set, a very large limit is applied automatically."}
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

    const limitValue = this.#toNonNegativeInteger(limit, 'Limit')
    const offsetValue = this.#toNonNegativeInteger(offset, 'Offset')

    if (limitValue !== undefined) {
      sql += ` LIMIT ${ limitValue }`
    } else if (offsetValue !== undefined) {
      // MySQL has no standalone OFFSET clause; an effectively-unbounded LIMIT enables it.
      sql += ' LIMIT 18446744073709551615'
    }

    if (offsetValue !== undefined) {
      sql += ` OFFSET ${ offsetValue }`
    }

    return this.#withClient('selectRows', async connection => {
      const [rows] = await connection.execute(sql, params)

      return { rows, rowCount: rows.length }
    })
  }

  /**
   * @operationName Insert Row
   * @description Inserts a single row into a table from a JSON object of column/value pairs. Returns the auto-increment ID assigned to the new row (insertId, 0 when the table has no auto-increment column), the affected row count, and an echo of the inserted data. MySQL has no RETURNING clause, so database-generated defaults are not echoed back; use Select Rows with the insertId to fetch the full row if needed.
   * @category Rows
   * @route POST /insert-row
   * @appearanceColor #00758F #F29111
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to insert into. May be database-qualified (e.g. mydb.users)."}
   * @paramDef {"type":"Object","label":"Data","name":"data","required":true,"description":"Column/value pairs for the new row as a JSON object (e.g. {\"name\":\"Ada\",\"email\":\"ada@example.com\"})."}
   * @returns {Object}
   * @sampleResult {"insertId":42,"affectedRows":1,"row":{"name":"Ada","email":"ada@example.com"}}
   */
  async insertRow(table, data) {
    this.#requireNonEmptyObject(data, 'Data')

    const columns = Object.keys(data)
    const params = columns.map(column => data[column])
    const columnList = columns.map(column => this.#quoteIdent(column)).join(', ')
    const placeholders = columns.map(() => '?').join(', ')
    const sql = `INSERT INTO ${ this.#quoteTable(table) } (${ columnList }) VALUES (${ placeholders })`

    return this.#withClient('insertRow', async connection => {
      const [result] = await connection.execute(sql, params)

      return { insertId: result.insertId, affectedRows: result.affectedRows, row: data }
    })
  }

  /**
   * @operationName Insert Rows
   * @description Bulk-inserts multiple rows into a table in a single INSERT ... VALUES (...),(...) statement. The column set is the union of keys across all row objects; rows missing a key insert NULL for that column. Returns the inserted count and the auto-increment ID of the FIRST inserted row (subsequent rows receive consecutive IDs when the table has an auto-increment column).
   * @category Rows
   * @route POST /insert-rows
   * @appearanceColor #00758F #F29111
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to insert into. May be database-qualified (e.g. mydb.users)."}
   * @paramDef {"type":"Array<Object>","label":"Rows","name":"rows","required":true,"description":"An array of row objects with column/value pairs (e.g. [{\"name\":\"Ada\"},{\"name\":\"Linus\"}])."}
   * @returns {Object}
   * @sampleResult {"insertedCount":2,"firstInsertId":42}
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

          return '?'
        })

        return `(${ placeholders.join(', ') })`
      })
      .join(', ')

    const sql = `INSERT INTO ${ this.#quoteTable(table) } (${ columnList }) VALUES ${ valuesSql }`

    return this.#withClient('insertRows', async connection => {
      const [result] = await connection.execute(sql, params)

      return { insertedCount: result.affectedRows, firstInsertId: result.insertId }
    })
  }

  /**
   * @operationName Update Rows
   * @description Updates all rows matching the equality conditions in the Where object, setting the columns provided in the Data object. Returns affectedRows (rows matched by the Where conditions) and changedRows (rows whose values actually changed). A non-empty Where object is required to prevent accidental full-table updates; use Execute Query for unconditional updates.
   * @category Rows
   * @route PATCH /update-rows
   * @appearanceColor #00758F #F29111
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to update. May be database-qualified (e.g. mydb.users)."}
   * @paramDef {"type":"Object","label":"Data","name":"data","required":true,"description":"Column/value pairs to set as a JSON object (e.g. {\"status\":\"archived\"})."}
   * @paramDef {"type":"Object","label":"Where","name":"where","required":true,"description":"Equality conditions selecting the rows to update, combined with AND (e.g. {\"status\":\"active\"}). Null values match IS NULL; array values match any element."}
   * @returns {Object}
   * @sampleResult {"affectedRows":3,"changedRows":2}
   */
  async updateRows(table, data, where) {
    this.#requireNonEmptyObject(data, 'Data')
    this.#requireNonEmptyObject(where, 'Where')

    const params = []

    const assignments = Object.entries(data)
      .map(([column, value]) => {
        params.push(value)

        return `${ this.#quoteIdent(column) } = ?`
      })
      .join(', ')

    const sql = `UPDATE ${ this.#quoteTable(table) } SET ${ assignments }${ this.#buildWhere(where, params) }`

    return this.#withClient('updateRows', async connection => {
      const [result] = await connection.execute(sql, params)

      return { affectedRows: result.affectedRows, changedRows: result.changedRows }
    })
  }

  /**
   * @operationName Delete Rows
   * @description Deletes all rows matching the equality conditions in the Where object and returns the number of deleted rows. A non-empty Where object is required to prevent accidental full-table deletion; use Execute Query (e.g. TRUNCATE or DELETE without WHERE) for that.
   * @category Rows
   * @route DELETE /delete-rows
   * @appearanceColor #00758F #F29111
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to delete from. May be database-qualified (e.g. mydb.users)."}
   * @paramDef {"type":"Object","label":"Where","name":"where","required":true,"description":"Equality conditions selecting the rows to delete, combined with AND (e.g. {\"status\":\"archived\"}). Null values match IS NULL; array values match any element."}
   * @returns {Object}
   * @sampleResult {"affectedRows":3}
   */
  async deleteRows(table, where) {
    this.#requireNonEmptyObject(where, 'Where')

    const params = []
    const sql = `DELETE FROM ${ this.#quoteTable(table) }${ this.#buildWhere(where, params) }`

    return this.#withClient('deleteRows', async connection => {
      const [result] = await connection.execute(sql, params)

      return { affectedRows: result.affectedRows }
    })
  }

  /**
   * @operationName Upsert Row
   * @description Inserts a row, or updates the existing row when it would violate a PRIMARY KEY or UNIQUE index (INSERT ... ON DUPLICATE KEY UPDATE). MySQL keys the conflict off the table's unique indexes automatically; the Unique Columns parameter only excludes those columns from the update set. Returns the auto-increment ID and affectedRows (1 = inserted, 2 = existing row updated, 0 = existing row already had identical values).
   * @category Rows
   * @route POST /upsert-row
   * @appearanceColor #00758F #F29111
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to upsert into. May be database-qualified (e.g. mydb.users)."}
   * @paramDef {"type":"Object","label":"Data","name":"data","required":true,"description":"Column/value pairs for the row as a JSON object. Should include values for the unique key that identifies the row."}
   * @paramDef {"type":"Array<String>","label":"Unique Columns","name":"uniqueColumns","description":"Columns of the unique key identifying the row (e.g. [\"email\"]). These are excluded from the ON DUPLICATE KEY UPDATE set; MySQL itself determines conflicts from the table's unique indexes. Leave empty to update every provided column on conflict."}
   * @returns {Object}
   * @sampleResult {"insertId":42,"affectedRows":2}
   */
  async upsertRow(table, data, uniqueColumns) {
    this.#requireNonEmptyObject(data, 'Data')

    const excluded = Array.isArray(uniqueColumns) ? uniqueColumns : []
    const columns = Object.keys(data)
    const params = columns.map(column => data[column])
    const columnList = columns.map(column => this.#quoteIdent(column)).join(', ')
    const placeholders = columns.map(() => '?').join(', ')

    const updateColumns = columns.filter(column => !excluded.includes(column))
    // When every provided column is part of the unique key there is nothing to update;
    // a self-assignment keeps the statement valid and leaves the existing row untouched.
    const assignments = updateColumns.length
      ? updateColumns.map(column => `${ this.#quoteIdent(column) } = VALUES(${ this.#quoteIdent(column) })`).join(', ')
      : `${ this.#quoteIdent(columns[0]) } = ${ this.#quoteIdent(columns[0]) }`

    const sql =
      `INSERT INTO ${ this.#quoteTable(table) } (${ columnList }) VALUES (${ placeholders }) ` +
      `ON DUPLICATE KEY UPDATE ${ assignments }`

    return this.#withClient('upsertRow', async connection => {
      const [result] = await connection.execute(sql, params)

      return { insertId: result.insertId, affectedRows: result.affectedRows }
    })
  }

  // ==========================================================================
  //  SCHEMA
  // ==========================================================================
  /**
   * @operationName Get Table Schema
   * @description Returns the column definitions of a table from information_schema.columns: column name, full type (e.g. varchar(255)), base data type, nullability, default expression, key membership (PRI/UNI/MUL), extra attributes (e.g. auto_increment), maximum character length, and ordinal position. Useful for discovering a table's structure before reading or writing.
   * @category Schema
   * @route GET /table-schema
   * @appearanceColor #00758F #F29111
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to describe. May be database-qualified (e.g. mydb.users); defaults to the configured database."}
   * @returns {Object}
   * @sampleResult {"database":"mydb","table":"users","columns":[{"name":"id","type":"int","dataType":"int","nullable":false,"default":null,"key":"PRI","extra":"auto_increment","maxLength":null,"position":1},{"name":"email","type":"varchar(255)","dataType":"varchar","nullable":false,"default":null,"key":"UNI","extra":"","maxLength":255,"position":2}]}
   */
  async getTableSchema(table) {
    const { schema, name } = this.#splitTable(table)

    const sql = `
      SELECT
        column_name AS name,
        column_type AS type,
        data_type AS dataType,
        is_nullable AS nullable,
        column_default AS defaultValue,
        column_key AS keyType,
        extra AS extra,
        character_maximum_length AS maxLength,
        ordinal_position AS position,
        table_schema AS tableSchema
      FROM information_schema.columns
      WHERE table_schema = COALESCE(?, DATABASE()) AND table_name = ?
      ORDER BY ordinal_position
    `

    return this.#withClient('getTableSchema', async connection => {
      const [rows] = await connection.execute(sql, [schema, name])

      if (!rows.length) {
        throw new Error(`Table "${ schema ? `${ schema }.` : '' }${ name }" was not found or has no columns.`)
      }

      return {
        database: rows[0].tableSchema,
        table: name,
        columns: rows.map(row => ({
          name: row.name,
          type: row.type,
          dataType: row.dataType,
          nullable: row.nullable === 'YES',
          default: row.defaultValue,
          key: row.keyType,
          extra: row.extra,
          maxLength: row.maxLength,
          position: row.position,
        })),
      }
    })
  }

  /**
   * @operationName List Tables
   * @description Lists all tables and views in the current database (the one selected by the connection), including each object's name and type. Useful for discovering what data is available in the database.
   * @category Schema
   * @route GET /tables
   * @appearanceColor #00758F #F29111
   * @returns {Object}
   * @sampleResult {"database":"mydb","tables":[{"name":"users","type":"BASE TABLE"},{"name":"active_users","type":"VIEW"}],"count":2}
   */
  async listTables() {
    const sql = `
      SELECT table_schema AS tableSchema, table_name AS name, table_type AS type
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
      ORDER BY table_name
    `

    return this.#withClient('listTables', async connection => {
      const [rows] = await connection.execute(sql)

      return {
        database: rows.length ? rows[0].tableSchema : null,
        tables: rows.map(row => ({ name: row.name, type: row.type })),
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
   * @description Provides a searchable list of tables and views from the current database for dynamic dropdown selection in other operations.
   * @route POST /get-tables-dictionary
   * @paramDef {"type":"getTablesDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"users","value":"users","note":"BASE TABLE"}],"cursor":null}
   */
  async getTablesDictionary(payload) {
    const { search, cursor } = payload || {}
    const offset = parseInt(cursor, 10) || 0

    const sql = `
      SELECT table_name AS name, table_type AS type
      FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name LIKE ?
      ORDER BY table_name
      LIMIT ${ DICTIONARY_PAGE_SIZE + 1 } OFFSET ${ offset }
    `

    return this.#withClient('getTablesDictionary', async connection => {
      const [result] = await connection.execute(sql, [search ? `%${ search }%` : '%'])
      const hasMore = result.length > DICTIONARY_PAGE_SIZE
      const rows = hasMore ? result.slice(0, DICTIONARY_PAGE_SIZE) : result

      return {
        items: rows.map(row => ({ label: row.name, value: row.name, note: row.type })),
        cursor: hasMore ? String(offset + DICTIONARY_PAGE_SIZE) : null,
      }
    })
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Columns Dictionary
   * @description Provides a searchable list of column names for the table selected in a dependent parameter, with each column's type as a note.
   * @route POST /get-columns-dictionary
   * @paramDef {"type":"getColumnsDictionary__payload","label":"Payload","name":"payload","description":"Optional search text, pagination cursor, and the selected table as criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"email","value":"email","note":"varchar(255)"}],"cursor":null}
   */
  async getColumnsDictionary(payload) {
    const { search, criteria } = payload || {}
    const table = criteria && criteria.table

    if (!table) {
      return { items: [], cursor: null }
    }

    const { schema, name } = this.#splitTable(table)

    const sql = `
      SELECT column_name AS name, column_type AS type
      FROM information_schema.columns
      WHERE table_schema = COALESCE(?, DATABASE()) AND table_name = ? AND column_name LIKE ?
      ORDER BY ordinal_position
    `

    return this.#withClient('getColumnsDictionary', async connection => {
      const [rows] = await connection.execute(sql, [schema, name, search ? `%${ search }%` : '%'])

      return {
        items: rows.map(row => ({ label: row.name, value: row.name, note: row.type })),
        cursor: null,
      }
    })
  }
}

Flowrunner.ServerCode.addService(MySQL, [
  {
    name: 'connectionString',
    displayName: 'Connection String',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Full MySQL connection URI, e.g. mysql://user:password@db.example.com:3306/mydb - most managed providers (PlanetScale, Aiven, RDS, DigitalOcean) supply one. When set, it takes precedence and the Host/Port/Database/User/Password fields below are ignored. Special characters in the password must be URL-encoded; if that is a problem, use the individual fields instead.',
  },
  {
    name: 'host',
    displayName: 'Host',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Hostname or IP address of the MySQL server (e.g. db.example.com). Required unless a Connection String is provided. The server must be reachable from FlowRunner.',
  },
  {
    name: 'port',
    displayName: 'Port',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    defaultValue: '3306',
    hint: 'TCP port of the MySQL server. The default is 3306. Ignored when a Connection String is provided.',
  },
  {
    name: 'database',
    displayName: 'Database',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Name of the database (schema) to connect to. Required unless a Connection String is provided.',
  },
  {
    name: 'user',
    displayName: 'User',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Database user name. Required unless a Connection String is provided.',
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
    hint: 'Enable TLS-encrypted connections. Required by most managed databases (e.g. PlanetScale, Aiven, AWS RDS, Azure Database). With a Connection String, enabling this adds managed-provider-friendly TLS on top of the URI; when off, any ssl parameters in the URI still apply.',
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
