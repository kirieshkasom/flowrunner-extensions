const oracledb = require('oracledb')

const logger = {
  info: (...args) => console.log('[Oracle Database] info:', ...args),
  debug: (...args) => console.log('[Oracle Database] debug:', ...args),
  error: (...args) => console.log('[Oracle Database] error:', ...args),
  warn: (...args) => console.log('[Oracle Database] warn:', ...args),
}

const DEFAULT_PORT = '1521'
const DICTIONARY_PAGE_SIZE = 200

// node-oracledb runs in Thin mode by default (pure JavaScript, no Oracle Instant Client). Rows
// are returned as plain objects keyed by column name. initOracleClient is deliberately NOT called
// — doing so would switch the driver to Thick mode and require the native client libraries.
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT

// ============================================================================
//  DICTIONARY PAYLOAD TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} getTablesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter tables by name (matched case-insensitively)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getColumnsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Table","name":"table","description":"The table whose columns populate the list."}
 */

/**
 * @typedef {Object} getColumnsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter columns by name (matched case-insensitively)."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 * @paramDef {"type":"getColumnsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The table whose columns to list."}
 */

/**
 * @integrationName Oracle Database
 * @integrationIcon /icon.svg
 */
class OracleDatabase {
  constructor(config) {
    this.config = config || {}

    this.connectString = (this.config.connectString || '').trim()
    this.host = (this.config.host || '').trim()
    this.port = (this.config.port || '').trim() || DEFAULT_PORT
    this.serviceName = (this.config.serviceName || '').trim()
    this.user = this.config.user
    this.password = this.config.password
  }

  // ==========================================================================
  //  CORE — connection lifecycle: one short-lived connection per method call.
  //  A standalone connection is opened, used and always closed in finally.
  //  Connections are NEVER pooled or cached between invocations (Thin mode).
  // ==========================================================================
  async #withConnection(logTag, fn) {
    let connection

    try {
      logger.debug(`${ logTag } - connecting to ${ this.#connectionLabel() }`)

      connection = await oracledb.getConnection(this.#buildConnectionConfig(logTag))

      return await fn(connection)
    } catch (error) {
      this.#throwOracleError(error, logTag)
    } finally {
      if (connection) {
        try {
          await connection.close()
        } catch (closeError) {
          logger.warn(`${ logTag } - failed to close connection: ${ closeError.message }`)
        }
      }
    }
  }

  // Builds the getConnection() attributes. A Connection String (Easy Connect or an Autonomous
  // Database TLS descriptor), when set, wins over the individual Host/Port/Service Name fields.
  // Thin mode supports Autonomous Database TLS connect strings directly, with no wallet.
  #buildConnectionConfig(logTag) {
    if (!this.user || !this.password) {
      logger.error(`${ logTag } - missing credentials`)

      throw new Error('Oracle Database error: User and Password are required in the service configuration.')
    }

    const connectString = this.#effectiveConnectString()

    if (!connectString) {
      logger.error(`${ logTag } - incomplete connection configuration`)

      throw new Error(
        'Oracle Database error: incomplete connection configuration. ' +
        'Provide a Connect String (e.g. dbhost:1521/ORCLPDB1 or an Autonomous Database TLS connect string), ' +
        'or fill in Host and Service Name in the service configuration.'
      )
    }

    return {
      user: this.user,
      password: this.password,
      connectString,
    }
  }

  // The effective Easy Connect / TLS descriptor: the explicit Connect String if provided,
  // otherwise assembled from host:port/serviceName.
  #effectiveConnectString() {
    if (this.connectString) {
      return this.connectString
    }

    if (this.host && this.serviceName) {
      return `${ this.host }:${ this.port }/${ this.serviceName }`
    }

    return ''
  }

  // Human-readable connection target for logs. Never includes credentials.
  #connectionLabel() {
    if (this.connectString) {
      return 'connect string'
    }

    return `${ this.host }:${ this.port }/${ this.serviceName }`
  }

  #throwOracleError(error, logTag) {
    const parts = [error.message]

    // node-oracledb surfaces the numeric ORA code on errorNum (e.g. 1017 -> ORA-01017).
    if (typeof error.errorNum === 'number' && error.errorNum > 0) {
      parts.push(`code: ORA-${ String(error.errorNum).padStart(5, '0') }`)
    }

    if (error.code) parts.push(`code: ${ error.code }`)

    const text = `${ error.message || '' } ${ error.code || '' }`

    // ORA-01017: invalid username/password.
    if (error.errorNum === 1017 || text.includes('ORA-01017')) {
      parts.push('hint: invalid username or password — check the User and Password settings.')
    }

    // ORA-12154 / ORA-12514 / ORA-12541: the listener could not resolve or serve the requested
    // service. Almost always a wrong Service Name, Host or Port in the connect string.
    if ([12154, 12514, 12541].includes(error.errorNum) || /ORA-1215[41]|ORA-12541/.test(text)) {
      parts.push(
        'hint: the listener could not resolve the connection — verify the Host, Port and Service Name ' +
        '(Easy Connect is host:port/service_name, e.g. dbhost:1521/ORCLPDB1), or paste the full ' +
        'Autonomous Database TLS connect string into the Connect String field.'
      )
    }

    // ENETUNREACH against an IPv6 address means the host resolved to IPv6 only and this
    // environment has no IPv6 route — common with some managed/Autonomous endpoints.
    if (error.code === 'ENETUNREACH' && String(error.address || '').includes(':')) {
      parts.push(
        'hint: the database host resolved to an IPv6-only address and this environment has no IPv6 connectivity. ' +
        'Use an IPv4-compatible hostname or endpoint for your database server.'
      )
    }

    const message = parts.join(' | ')

    logger.error(`${ logTag } - failed: ${ message }`)

    throw new Error(`Oracle Database error: ${ message }`)
  }

  // Quotes a single SQL identifier (table or column name). Identifiers cannot be bound as
  // query parameters, so they are escaped with double-quote doubling. Note: quoting an
  // identifier makes it case-sensitive in Oracle, so it must match the stored (usually
  // UPPERCASE) name exactly.
  #quoteIdent(name) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error(`Invalid identifier: ${ JSON.stringify(name) }. Identifiers must be non-empty strings.`)
    }

    return `"${ name.replace(/"/g, '""') }"`
  }

  #requireNonEmptyObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) {
      throw new Error(`${ label } must be a non-empty object.`)
    }
  }

  // Normalizes the caller-supplied binds into a value oracledb accepts (named object or
  // positional array). Anything else (including undefined) becomes an empty array.
  #normalizeBinds(binds) {
    if (Array.isArray(binds)) return binds

    if (binds && typeof binds === 'object') return binds

    return []
  }

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
   * @description Runs a single SELECT statement and returns the resulting rows as objects keyed by column name, the row count, and column metadata. Bind values with named placeholders (:name) or positional placeholders (:1, :2, ...) via the Binds parameter — never interpolate user input into the SQL string. Use the Max Rows parameter to cap large result sets. For INSERT/UPDATE/DELETE/DDL use Execute Statement instead. Statements are limited to 120 seconds of execution time.
   * @category SQL
   * @route POST /execute-query
   * @appearanceColor #C74634 #F80000
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"SQL","name":"sql","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The SELECT statement to run. Use :name or :1, :2 placeholders for values bound via the Binds parameter. Do not include a trailing semicolon."}
   * @paramDef {"type":"Object","label":"Binds","name":"binds","description":"Bind values as a JSON object for named binds (e.g. {\"email\":\"ada@example.com\",\"minAge\":30}) or a JSON array for positional binds (e.g. [\"ada@example.com\",30])."}
   * @paramDef {"type":"Number","label":"Max Rows","name":"maxRows","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of rows to fetch. Leave empty or 0 for all rows."}
   * @returns {Object}
   * @sampleResult {"rows":[{"ID":1,"NAME":"Ada"}],"rowCount":1,"columns":["ID","NAME"]}
   */
  async executeQuery(sql, binds, maxRows) {
    if (typeof sql !== 'string' || !sql.trim()) {
      throw new Error('SQL statement is required.')
    }

    const maxRowsValue = this.#toNonNegativeInteger(maxRows, 'Max Rows')

    return this.#withConnection('executeQuery', async connection => {
      const result = await connection.execute(sql, this.#normalizeBinds(binds), {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        ...(maxRowsValue !== undefined ? { maxRows: maxRowsValue } : {}),
      })

      return {
        rows: result.rows || [],
        rowCount: (result.rows || []).length,
        columns: (result.metaData || []).map(column => column.name),
      }
    })
  }

  /**
   * @operationName Execute Statement
   * @description Runs a single write or DDL statement (INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, etc.) with autoCommit enabled and returns the number of rows affected. Bind values with named placeholders (:name) or positional placeholders (:1, :2, ...) via the Binds parameter — never interpolate user input into the SQL string. For SELECT statements use Execute Query; for PL/SQL blocks use Execute PL/SQL Block. Statements are limited to 120 seconds of execution time.
   * @category SQL
   * @route POST /execute-statement
   * @appearanceColor #C74634 #F80000
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"SQL","name":"sql","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The INSERT/UPDATE/DELETE/DDL statement to run. Use :name or :1, :2 placeholders for values bound via the Binds parameter. Do not include a trailing semicolon."}
   * @paramDef {"type":"Object","label":"Binds","name":"binds","description":"Bind values as a JSON object for named binds (e.g. {\"id\":42,\"status\":\"active\"}) or a JSON array for positional binds (e.g. [42,\"active\"])."}
   * @returns {Object}
   * @sampleResult {"rowsAffected":1}
   */
  async executeStatement(sql, binds) {
    if (typeof sql !== 'string' || !sql.trim()) {
      throw new Error('SQL statement is required.')
    }

    return this.#withConnection('executeStatement', async connection => {
      const result = await connection.execute(sql, this.#normalizeBinds(binds), {
        autoCommit: true,
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      })

      return { rowsAffected: result.rowsAffected || 0 }
    })
  }

  /**
   * @operationName Execute PL/SQL Block
   * @description Runs an anonymous PL/SQL block (BEGIN ... END;) with autoCommit enabled and returns any OUT bind values. Use named placeholders (:name) in the block. For OUT/IN OUT binds, describe each with a direction object in the Binds parameter: {"result":{"dir":"out","type":"number"}}. Directions are "in" (default), "out", or "inout"; types are "string", "number", or "date". IN binds may be provided as plain values (e.g. {"id":42}). Blocks are limited to 120 seconds of execution time.
   * @category SQL
   * @route POST /execute-plsql-block
   * @appearanceColor #C74634 #F80000
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"PL/SQL Block","name":"block","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The anonymous PL/SQL block to run, e.g. BEGIN :result := add_numbers(:a, :b); END;"}
   * @paramDef {"type":"Object","label":"Binds","name":"binds","description":"Bind values keyed by name. IN binds may be plain values (e.g. {\"a\":2}); OUT/IN OUT binds use a direction object (e.g. {\"result\":{\"dir\":\"out\",\"type\":\"number\"}})."}
   * @returns {Object}
   * @sampleResult {"outBinds":{"result":5},"rowsAffected":0}
   */
  async executePlsqlBlock(block, binds) {
    if (typeof block !== 'string' || !block.trim()) {
      throw new Error('PL/SQL Block is required.')
    }

    const resolvedBinds = this.#resolveBindDirections(binds)

    return this.#withConnection('executePlsqlBlock', async connection => {
      const result = await connection.execute(block, resolvedBinds, {
        autoCommit: true,
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      })

      return { outBinds: result.outBinds || {}, rowsAffected: result.rowsAffected || 0 }
    })
  }

  // Maps the {dir, type} bind descriptors used in the public PL/SQL API onto oracledb's
  // BIND_* / type constants, leaving plain-value (IN) binds untouched.
  #resolveBindDirections(binds) {
    if (!binds || typeof binds !== 'object' || Array.isArray(binds)) {
      return this.#normalizeBinds(binds)
    }

    const dirMap = { in: oracledb.BIND_IN, out: oracledb.BIND_OUT, inout: oracledb.BIND_INOUT }
    const typeMap = { string: oracledb.STRING, number: oracledb.NUMBER, date: oracledb.DATE }
    const resolved = {}

    for (const [name, value] of Object.entries(binds)) {
      if (value && typeof value === 'object' && !Array.isArray(value) && 'dir' in value) {
        const descriptor = { ...value }

        descriptor.dir = dirMap[String(value.dir).toLowerCase()] || oracledb.BIND_IN

        if (value.type !== undefined) {
          descriptor.type = typeMap[String(value.type).toLowerCase()] || value.type
        }

        resolved[name] = descriptor
      } else {
        resolved[name] = value
      }
    }

    return resolved
  }

  // ==========================================================================
  //  ROWS
  // ==========================================================================
  /**
   * @operationName Select Rows
   * @description Selects rows from a table without writing SQL. Supports choosing specific columns, ordering, and a row limit (FETCH FIRST n ROWS ONLY). Filtering is done with a raw WHERE clause (bind its values with the Where Binds parameter). For joins, aggregations, or complex queries use Execute Query instead. Table and column names are usually UPPERCASE in Oracle.
   * @category Rows
   * @route POST /select-rows
   * @appearanceColor #C74634 #F80000
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to read from (usually UPPERCASE, e.g. EMPLOYEES)."}
   * @paramDef {"type":"Array<String>","label":"Columns","name":"columns","description":"Column names to return. Leave empty to return all columns (SELECT *)."}
   * @paramDef {"type":"String","label":"Where Clause","name":"whereClause","description":"A raw SQL WHERE condition WITHOUT the WHERE keyword (e.g. STATUS = :status AND AGE > :minAge). Bind its values via Where Binds — do not concatenate user input. Trusted input only."}
   * @paramDef {"type":"Object","label":"Where Binds","name":"whereBinds","description":"Bind values for the Where Clause placeholders, as a JSON object for named binds (e.g. {\"status\":\"active\"}) or a JSON array for positional binds."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","dictionary":"getColumnsDictionary","dependsOn":["table"],"description":"Column to sort the results by."}
   * @paramDef {"type":"String","label":"Sort Direction","name":"sortDirection","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"defaultValue":"Ascending","description":"Sort direction applied to the Order By column."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of rows to return (FETCH FIRST n ROWS ONLY). Leave empty for no limit."}
   * @returns {Object}
   * @sampleResult {"rows":[{"ID":1,"NAME":"Ada","STATUS":"active"}],"rowCount":1}
   */
  async selectRows(table, columns, whereClause, whereBinds, orderBy, sortDirection, limit) {
    const columnList = Array.isArray(columns) && columns.length
      ? columns.map(column => this.#quoteIdent(column)).join(', ')
      : '*'

    let sql = `SELECT ${ columnList } FROM ${ this.#quoteIdent(table) }`

    if (typeof whereClause === 'string' && whereClause.trim()) {
      sql += ` WHERE ${ whereClause.trim() }`
    }

    if (orderBy) {
      const direction = this.#resolveChoice(sortDirection, { 'Ascending': 'ASC', 'Descending': 'DESC' }) || 'ASC'

      sql += ` ORDER BY ${ this.#quoteIdent(orderBy) } ${ direction }`
    }

    const limitValue = this.#toNonNegativeInteger(limit, 'Limit')

    if (limitValue !== undefined) {
      sql += ` FETCH FIRST ${ limitValue } ROWS ONLY`
    }

    return this.#withConnection('selectRows', async connection => {
      const result = await connection.execute(sql, this.#normalizeBinds(whereBinds), {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      })

      return { rows: result.rows || [], rowCount: (result.rows || []).length }
    })
  }

  /**
   * @operationName Insert Row
   * @description Inserts a single row into a table from a JSON object of column/value pairs and returns the number of rows affected. Values are bound as parameters; column names are quoted. Oracle has no RETURNING-into-object shortcut here, so database-generated values (e.g. identity IDs, defaults) are not echoed back — use Select Rows afterwards to fetch them if needed. Column names are usually UPPERCASE.
   * @category Rows
   * @route POST /insert-row
   * @appearanceColor #C74634 #F80000
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to insert into (usually UPPERCASE, e.g. EMPLOYEES)."}
   * @paramDef {"type":"Object","label":"Data","name":"data","required":true,"description":"Column/value pairs for the new row as a JSON object (e.g. {\"NAME\":\"Ada\",\"EMAIL\":\"ada@example.com\"}). Keys must match the stored column names (usually UPPERCASE)."}
   * @returns {Object}
   * @sampleResult {"rowsAffected":1}
   */
  async insertRow(table, data) {
    this.#requireNonEmptyObject(data, 'Data')

    const columns = Object.keys(data)
    const binds = {}
    const columnList = []
    const placeholders = []

    columns.forEach((column, index) => {
      const bindName = `b${ index }`

      binds[bindName] = data[column]
      columnList.push(this.#quoteIdent(column))
      placeholders.push(`:${ bindName }`)
    })

    const sql = `INSERT INTO ${ this.#quoteIdent(table) } (${ columnList.join(', ') }) VALUES (${ placeholders.join(', ') })`

    return this.#withConnection('insertRow', async connection => {
      const result = await connection.execute(sql, binds, { autoCommit: true })

      return { rowsAffected: result.rowsAffected || 0 }
    })
  }

  /**
   * @operationName Update Rows
   * @description Updates all rows matching a raw WHERE clause, setting the columns provided in the Data object (bound as parameters). Returns the number of rows affected. A non-empty Where Clause is required to prevent accidental full-table updates; use Execute Statement for unconditional updates. Column names are usually UPPERCASE.
   * @category Rows
   * @route PATCH /update-rows
   * @appearanceColor #C74634 #F80000
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to update (usually UPPERCASE, e.g. EMPLOYEES)."}
   * @paramDef {"type":"Object","label":"Data","name":"data","required":true,"description":"Column/value pairs to set as a JSON object (e.g. {\"STATUS\":\"archived\"}). Keys must match the stored column names (usually UPPERCASE)."}
   * @paramDef {"type":"String","label":"Where Clause","name":"whereClause","required":true,"description":"A raw SQL WHERE condition WITHOUT the WHERE keyword (e.g. ID = :id). Bind its values via Where Binds — do not concatenate user input. Trusted input only."}
   * @paramDef {"type":"Object","label":"Where Binds","name":"whereBinds","description":"Bind values for the Where Clause placeholders, as a JSON object for named binds (e.g. {\"id\":42}) or a JSON array for positional binds. Named binds must not collide with the Data column names."}
   * @returns {Object}
   * @sampleResult {"rowsAffected":3}
   */
  async updateRows(table, data, whereClause, whereBinds) {
    this.#requireNonEmptyObject(data, 'Data')

    if (typeof whereClause !== 'string' || !whereClause.trim()) {
      throw new Error('Where Clause is required and must be a non-empty string.')
    }

    // The SET values are bound by name (:s0, :s1, ...). To keep the merged bind object
    // unambiguous, the Where Clause must also use named binds; positional WHERE binds (a JSON
    // array) cannot be combined with named SET binds.
    const normalizedWhere = this.#normalizeBinds(whereBinds)

    if (Array.isArray(normalizedWhere) && normalizedWhere.length) {
      throw new Error(
        'Update Rows requires named binds (:name) in the Where Clause because the SET values use named binds. ' +
        'Provide Where Binds as a JSON object, e.g. {"id":42}.'
      )
    }

    const columns = Object.keys(data)
    const binds = { ...normalizedWhere }
    const assignments = columns.map((column, index) => {
      const bindName = `s${ index }`

      binds[bindName] = data[column]

      return `${ this.#quoteIdent(column) } = :${ bindName }`
    })

    const sql = `UPDATE ${ this.#quoteIdent(table) } SET ${ assignments.join(', ') } WHERE ${ whereClause.trim() }`

    return this.#withConnection('updateRows', async connection => {
      const result = await connection.execute(sql, binds, { autoCommit: true })

      return { rowsAffected: result.rowsAffected || 0 }
    })
  }

  /**
   * @operationName Delete Rows
   * @description Deletes all rows matching a raw WHERE clause (bind its values with the Where Binds parameter) and returns the number of rows affected. A non-empty Where Clause is required to prevent accidental full-table deletion; use Execute Statement (e.g. TRUNCATE, or DELETE without WHERE) for that. Column names are usually UPPERCASE.
   * @category Rows
   * @route DELETE /delete-rows
   * @appearanceColor #C74634 #F80000
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to delete from (usually UPPERCASE, e.g. EMPLOYEES)."}
   * @paramDef {"type":"String","label":"Where Clause","name":"whereClause","required":true,"description":"A raw SQL WHERE condition WITHOUT the WHERE keyword (e.g. STATUS = :status). Bind its values via Where Binds — do not concatenate user input. Trusted input only."}
   * @paramDef {"type":"Object","label":"Where Binds","name":"whereBinds","description":"Bind values for the Where Clause placeholders, as a JSON object for named binds (e.g. {\"status\":\"archived\"}) or a JSON array for positional binds."}
   * @returns {Object}
   * @sampleResult {"rowsAffected":3}
   */
  async deleteRows(table, whereClause, whereBinds) {
    if (typeof whereClause !== 'string' || !whereClause.trim()) {
      throw new Error('Where Clause is required and must be a non-empty string.')
    }

    const sql = `DELETE FROM ${ this.#quoteIdent(table) } WHERE ${ whereClause.trim() }`

    return this.#withConnection('deleteRows', async connection => {
      const result = await connection.execute(sql, this.#normalizeBinds(whereBinds), { autoCommit: true })

      return { rowsAffected: result.rowsAffected || 0 }
    })
  }

  // ==========================================================================
  //  SCHEMA
  // ==========================================================================
  /**
   * @operationName Describe Table
   * @description Returns the column definitions of a table from USER_TAB_COLUMNS in the connected user's schema: column name, data type, nullability, and length. The table name is matched case-insensitively (Oracle stores identifiers UPPERCASE by default). Useful for discovering a table's structure before reading or writing.
   * @category Schema
   * @route GET /describe-table
   * @appearanceColor #C74634 #F80000
   * @paramDef {"type":"String","label":"Table","name":"table","required":true,"dictionary":"getTablesDictionary","description":"The table to describe (matched case-insensitively; Oracle stores names UPPERCASE)."}
   * @returns {Object}
   * @sampleResult {"table":"EMPLOYEES","columns":[{"name":"ID","dataType":"NUMBER","nullable":false,"length":22},{"name":"NAME","dataType":"VARCHAR2","nullable":true,"length":100}]}
   */
  async describeTable(table) {
    if (typeof table !== 'string' || !table.trim()) {
      throw new Error('Table name is required and must be a non-empty string.')
    }

    const sql = `
      SELECT column_name, data_type, nullable, data_length
      FROM user_tab_columns
      WHERE table_name = UPPER(:tableName)
      ORDER BY column_id
    `

    return this.#withConnection('describeTable', async connection => {
      const result = await connection.execute(sql, { tableName: table.trim() }, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      })

      const rows = result.rows || []

      if (!rows.length) {
        throw new Error(`Table "${ table.trim().toUpperCase() }" was not found in the current schema or has no columns.`)
      }

      return {
        table: table.trim().toUpperCase(),
        columns: rows.map(row => ({
          name: row.COLUMN_NAME,
          dataType: row.DATA_TYPE,
          nullable: row.NULLABLE === 'Y',
          length: row.DATA_LENGTH,
        })),
      }
    })
  }

  /**
   * @operationName List Tables
   * @description Lists all tables owned by the connected user (from USER_TABLES), ordered by name. Table names are returned as stored (usually UPPERCASE). Useful for discovering what data is available in the schema.
   * @category Schema
   * @route GET /list-tables
   * @appearanceColor #C74634 #F80000
   * @returns {Object}
   * @sampleResult {"tables":["DEPARTMENTS","EMPLOYEES"],"count":2}
   */
  async listTables() {
    const sql = 'SELECT table_name FROM user_tables ORDER BY table_name'

    return this.#withConnection('listTables', async connection => {
      const result = await connection.execute(sql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT })
      const rows = result.rows || []

      return {
        tables: rows.map(row => row.TABLE_NAME),
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
   * @description Provides a searchable list of tables owned by the connected user for dynamic dropdown selection in other operations. Values are the stored (usually UPPERCASE) table names.
   * @route POST /get-tables-dictionary
   * @paramDef {"type":"getTablesDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"EMPLOYEES","value":"EMPLOYEES","note":"Table"}],"cursor":null}
   */
  async getTablesDictionary(payload) {
    const { search, cursor } = payload || {}
    const offset = parseInt(cursor, 10) || 0

    const sql = `
      SELECT table_name FROM user_tables
      WHERE (:searchText IS NULL OR table_name LIKE :searchPattern)
      ORDER BY table_name
      OFFSET :rowOffset ROWS FETCH NEXT :rowLimit ROWS ONLY
    `

    const binds = {
      searchText: search ? search : null,
      searchPattern: search ? `%${ search.toUpperCase() }%` : '%',
      rowOffset: offset,
      rowLimit: DICTIONARY_PAGE_SIZE + 1,
    }

    return this.#withConnection('getTablesDictionary', async connection => {
      const result = await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT })
      const allRows = result.rows || []
      const hasMore = allRows.length > DICTIONARY_PAGE_SIZE
      const rows = hasMore ? allRows.slice(0, DICTIONARY_PAGE_SIZE) : allRows

      return {
        items: rows.map(row => ({ label: row.TABLE_NAME, value: row.TABLE_NAME, note: 'Table' })),
        cursor: hasMore ? String(offset + DICTIONARY_PAGE_SIZE) : null,
      }
    })
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Columns Dictionary
   * @description Provides a searchable list of column names for the table selected in a dependent parameter, with each column's data type as a note. The table is matched case-insensitively.
   * @route POST /get-columns-dictionary
   * @paramDef {"type":"getColumnsDictionary__payload","label":"Payload","name":"payload","description":"Optional search text, pagination cursor, and the selected table as criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"EMAIL","value":"EMAIL","note":"VARCHAR2"}],"cursor":null}
   */
  async getColumnsDictionary(payload) {
    const { search, criteria } = payload || {}
    const table = criteria && criteria.table

    if (!table) {
      return { items: [], cursor: null }
    }

    const sql = `
      SELECT column_name, data_type
      FROM user_tab_columns
      WHERE table_name = UPPER(:tableName)
        AND (:searchText IS NULL OR column_name LIKE :searchPattern)
      ORDER BY column_id
    `

    const binds = {
      tableName: String(table).trim(),
      searchText: search ? search : null,
      searchPattern: search ? `%${ search.toUpperCase() }%` : '%',
    }

    return this.#withConnection('getColumnsDictionary', async connection => {
      const result = await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT })

      return {
        items: (result.rows || []).map(row => ({
          label: row.COLUMN_NAME,
          value: row.COLUMN_NAME,
          note: row.DATA_TYPE,
        })),
        cursor: null,
      }
    })
  }
}

Flowrunner.ServerCode.addService(OracleDatabase, [
  {
    name: 'connectString',
    displayName: 'Connect String',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Oracle Easy Connect string in the form host:port/service_name (e.g. dbhost:1521/ORCLPDB1), OR a full Oracle Autonomous Database TLS connect string. When set, it takes precedence over the Host/Port/Service Name fields below. Thin mode supports the Autonomous Database TLS connect string directly, with no wallet.',
  },
  {
    name: 'host',
    displayName: 'Host',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Hostname or IP address of the database server (e.g. dbhost.example.com). Used only when no Connect String is provided. The server must be reachable from FlowRunner.',
  },
  {
    name: 'port',
    displayName: 'Port',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    defaultValue: '1521',
    hint: 'TCP listener port of the database server. The default is 1521. Ignored when a Connect String is provided.',
  },
  {
    name: 'serviceName',
    displayName: 'Service Name',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'The Oracle service name (Easy Connect uses host:port/service_name, e.g. ORCLPDB1). Used only when no Connect String is provided.',
  },
  {
    name: 'user',
    displayName: 'User',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Database username.',
  },
  {
    name: 'password',
    displayName: 'Password',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Password for the database user.',
  },
])
