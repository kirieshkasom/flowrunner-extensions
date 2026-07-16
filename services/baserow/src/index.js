'use strict'

const logger = {
  info: (...args) => console.log('[Baserow] info:', ...args),
  debug: (...args) => console.log('[Baserow] debug:', ...args),
  error: (...args) => console.log('[Baserow] error:', ...args),
  warn: (...args) => console.log('[Baserow] warn:', ...args),
}

const DEFAULT_BASE_URL = 'https://api.baserow.io'

// UI dropdown label -> Baserow field type token.
const FIELD_TYPE_MAP = {
  'Text': 'text',
  'Long Text': 'long_text',
  'Number': 'number',
  'Boolean': 'boolean',
  'Date': 'date',
  'Single Select': 'single_select',
  'Email': 'email',
  'URL': 'url',
  'Phone': 'phone_number',
}

/**
 * @integrationName Baserow
 * @integrationIcon /icon.png
 */
class Baserow {
  constructor(config) {
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
    // Database token: `Authorization: Token <x>`. Works ONLY for row data
    // endpoints (/api/database/rows/...).
    this.apiToken = config.apiToken
    // JWT access token: `Authorization: JWT <x>`. Required for structure /
    // metadata endpoints (applications, tables, fields).
    this.jwtToken = config.jwtToken
  }

  #apiBase() {
    return `${ this.baseUrl }/api`
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Resolve the Authorization header for the endpoint being called. Baserow
  // splits credentials: database tokens (Token) work only for row data, while
  // structure/metadata endpoints (applications, tables, fields) require a JWT.
  #authHeader(auth) {
    if (auth === 'jwt') {
      if (!this.jwtToken) {
        throw new Error('Baserow API error: this operation manages database structure (applications, tables or fields) and requires a JWT access token. Set the "JWT Access Token" configuration item; a database token alone cannot perform it.')
      }

      return `JWT ${ this.jwtToken }`
    }

    if (!this.apiToken) {
      throw new Error('Baserow API error: this operation requires a database token. Set the "Database Token" configuration item.')
    }

    return `Token ${ this.apiToken }`
  }

  // Single private request helper — all external calls go through here.
  // `auth` selects the credential: 'token' (database token, row data) or
  // 'jwt' (JWT access token, structure/metadata).
  async #apiRequest({ url, method = 'get', body, query, logTag, auth = 'token' }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ 'Authorization': this.#authHeader(auth), 'Content-Type': 'application/json' })
        .query(query || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const errorBody = error.body || {}
      const message = errorBody.detail || errorBody.error || error.message

      logger.error(`${ logTag } - failed: ${ JSON.stringify(errorBody) || message }`)

      throw new Error(`Baserow API error${ errorBody.error ? ` [${ errorBody.error }]` : '' }: ${ message }`)
    }
  }

  // ========================================== DICTIONARIES ===========================================

  /**
   * @typedef {Object} getDatabasesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter databases by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Databases Dictionary
   * @description Lists Baserow databases (applications of type "database") accessible with the configured token, for selection in dependent parameters.
   * @category Databases
   * @route POST /get-databases-dictionary
   * @paramDef {"type":"getDatabasesDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"CRM","value":"123","note":"Workspace: 45"}]}
   */
  async getDatabasesDictionary(payload) {
    const { search } = payload || {}

    const applications = await this.#apiRequest({
      logTag: 'getDatabasesDictionary',
      url: `${ this.#apiBase() }/applications/`,
      auth: 'jwt',
    })

    const databases = (applications || []).filter(app => app.type === 'database')
    const filtered = search
      ? databases.filter(db => (db.name || '').toLowerCase().includes(search.toLowerCase()))
      : databases

    return {
      items: filtered.map(db => ({
        label: db.name || '[empty]',
        value: String(db.id),
        note: `Workspace: ${ db.workspace?.id ?? db.group?.id ?? '' }`,
      })),
    }
  }

  /**
   * @typedef {Object} getTablesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Database ID","name":"databaseId","required":true,"description":"Identifier of the Baserow database whose tables will be listed."}
   */

  /**
   * @typedef {Object} getTablesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter tables by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   * @paramDef {"type":"getTablesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters identifying the database."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tables Dictionary
   * @description Lists tables within the specified Baserow database, for selection in dependent parameters.
   * @category Tables
   * @route POST /get-tables-dictionary
   * @paramDef {"type":"getTablesDictionary__payload","label":"Payload","name":"payload","description":"Database ID plus optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Contacts","value":"678","note":"ID: 678"}]}
   */
  async getTablesDictionary(payload) {
    const { search, criteria } = payload || {}
    const databaseId = criteria?.databaseId

    const tables = await this.#apiRequest({
      logTag: 'getTablesDictionary',
      url: `${ this.#apiBase() }/database/tables/database/${ databaseId }/`,
      auth: 'jwt',
    })

    const filtered = search
      ? (tables || []).filter(t => (t.name || '').toLowerCase().includes(search.toLowerCase()))
      : (tables || [])

    return {
      items: filtered.map(t => ({
        label: t.name || '[empty]',
        value: String(t.id),
        note: `ID: ${ t.id }`,
      })),
    }
  }

  /**
   * @typedef {Object} getFieldsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"description":"Identifier of the Baserow table whose fields will be listed."}
   */

  /**
   * @typedef {Object} getFieldsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter fields by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   * @paramDef {"type":"getFieldsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters identifying the table."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Fields Dictionary
   * @description Lists fields (columns) of the specified Baserow table, for selection in dependent parameters. Each item's value is the field name so it can be used directly with user_field_names row operations.
   * @category Fields
   * @route POST /get-fields-dictionary
   * @paramDef {"type":"getFieldsDictionary__payload","label":"Payload","name":"payload","description":"Table ID plus optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Name","value":"Name","note":"Type: text (id 999)"}]}
   */
  async getFieldsDictionary(payload) {
    const { search, criteria } = payload || {}
    const tableId = criteria?.tableId

    const fields = await this.#apiRequest({
      logTag: 'getFieldsDictionary',
      url: `${ this.#apiBase() }/database/fields/table/${ tableId }/`,
      auth: 'jwt',
    })

    const filtered = search
      ? (fields || []).filter(f => (f.name || '').toLowerCase().includes(search.toLowerCase()))
      : (fields || [])

    return {
      items: filtered.map(f => ({
        label: f.name || '[empty]',
        value: f.name,
        note: `Type: ${ f.type } (id ${ f.id })`,
      })),
    }
  }

  // ======================================= END OF DICTIONARIES =======================================

  // ============================================ DATABASES ============================================

  /**
   * @description Lists all Baserow databases the configured token can access. Databases are the "database" type applications within your workspaces; each groups a set of tables. Use the returned database IDs with the table operations.
   * @route GET /list-databases
   * @operationName List Databases
   * @category Databases
   * @returns {Array<Object>}
   * @sampleResult [{"id":123,"name":"CRM","order":1,"type":"database","workspace":{"id":45,"name":"My Workspace"}}]
   */
  async listDatabases() {
    const applications = await this.#apiRequest({
      logTag: 'listDatabases',
      url: `${ this.#apiBase() }/applications/`,
      auth: 'jwt',
    })

    return (applications || []).filter(app => app.type === 'database')
  }

  // ============================================= TABLES ==============================================

  /**
   * @description Lists all tables within the specified Baserow database, including each table's ID, name and order. Use a table ID with the row and field operations.
   * @route GET /list-tables
   * @operationName List Tables
   * @category Tables
   * @paramDef {"type":"String","label":"Database ID","name":"databaseId","required":true,"dictionary":"getDatabasesDictionary","description":"Identifier of the database whose tables to list."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":678,"name":"Contacts","order":1,"database_id":123}]
   */
  async listTables(databaseId) {
    return this.#apiRequest({
      logTag: 'listTables',
      url: `${ this.#apiBase() }/database/tables/database/${ databaseId }/`,
      auth: 'jwt',
    })
  }

  /**
   * @description Retrieves metadata for a single Baserow table by its ID, including its name, order and parent database.
   * @route GET /get-table
   * @operationName Get Table
   * @category Tables
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"description":"Identifier of the table to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":678,"name":"Contacts","order":1,"database_id":123}
   */
  async getTable(tableId) {
    return this.#apiRequest({
      logTag: 'getTable',
      url: `${ this.#apiBase() }/database/tables/${ tableId }/`,
      auth: 'jwt',
    })
  }

  /**
   * @description Creates a new table in the specified Baserow database. Optionally seeds the table with initial rows: provide a 2D array where the first inner array is the header row of column names and each subsequent array is a data row. When no data is supplied Baserow creates the table with default fields and rows.
   * @route POST /create-table
   * @operationName Create Table
   * @category Tables
   * @paramDef {"type":"String","label":"Database ID","name":"databaseId","required":true,"dictionary":"getDatabasesDictionary","description":"Identifier of the database in which to create the table."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name for the new table."}
   * @paramDef {"type":"Array<Object>","label":"Initial Rows","name":"data","required":false,"description":"Optional 2D array of initial content. The first inner array is the header row (column names); each following inner array is a row of cell values aligned to the header."}
   * @returns {Object}
   * @sampleResult {"id":678,"name":"Contacts","order":1,"database_id":123}
   */
  async createTable(databaseId, name, data) {
    const body = { name }

    if (Array.isArray(data) && data.length > 0) {
      body.data = data
      body.first_row_header = true
    }

    return this.#apiRequest({
      logTag: 'createTable',
      url: `${ this.#apiBase() }/database/tables/database/${ databaseId }/`,
      method: 'post',
      body,
      auth: 'jwt',
    })
  }

  // ============================================= FIELDS ==============================================

  /**
   * @description Lists all fields (columns) of the specified Baserow table, including each field's ID, name, type and type-specific configuration. Useful for discovering the schema before reading or writing rows.
   * @route GET /list-fields
   * @operationName List Fields
   * @category Fields
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getTablesDictionary","description":"Identifier of the table whose fields to list."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":999,"name":"Name","type":"text","primary":true,"table_id":678}]
   */
  async listFields(tableId) {
    return this.#apiRequest({
      logTag: 'listFields',
      url: `${ this.#apiBase() }/database/fields/table/${ tableId }/`,
      auth: 'jwt',
    })
  }

  /**
   * @description Creates a new field (column) in the specified Baserow table. Choose the field type from the dropdown; type-specific settings (for example the "select_options" for a Single Select, or "number_decimal_places" for a Number) can be supplied via the Options object and are merged into the request.
   * @route POST /create-field
   * @operationName Create Field
   * @category Fields
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getTablesDictionary","description":"Identifier of the table in which to create the field."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name for the new field."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Text","Long Text","Number","Boolean","Date","Single Select","Email","URL","Phone"]}},"description":"The Baserow field type to create."}
   * @paramDef {"type":"Object","label":"Options","name":"options","required":false,"description":"Optional type-specific settings merged into the request body, e.g. {\"select_options\":[{\"value\":\"Open\",\"color\":\"blue\"}]} for Single Select, or {\"number_decimal_places\":2} for Number."}
   * @returns {Object}
   * @sampleResult {"id":1010,"name":"Status","type":"single_select","table_id":678}
   */
  async createField(tableId, name, type, options) {
    const resolvedType = this.#resolveChoice(type, FIELD_TYPE_MAP)

    const body = {
      name,
      type: resolvedType,
      ...(options && typeof options === 'object' ? options : {}),
    }

    return this.#apiRequest({
      logTag: 'createField',
      url: `${ this.#apiBase() }/database/fields/table/${ tableId }/`,
      method: 'post',
      body,
      auth: 'jwt',
    })
  }

  // ============================================== ROWS ===============================================

  /**
   * @description Lists rows from a Baserow table with pagination, search, ordering and filtering. When "Use Field Names" is enabled (default) rows are keyed by human-readable field names instead of internal field_123 IDs. Filtering: pass a Filters object whose keys use Baserow's "filter__{field}__{type}" syntax mapping to the value to match, for example {"filter__Name__contains":"Acme","filter__Age__higher_than":"18"}. When multiple filters are supplied, the Filter Type parameter controls whether they are combined with AND or OR. Ordering: pass a comma-separated list of field names to Order By; prefix a name with "-" for descending, e.g. "-Created,Name". Returns the page of rows plus the total count and the URL of the next page (null when there are no more).
   * @route GET /list-rows
   * @operationName List Rows
   * @category Rows
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getTablesDictionary","description":"Identifier of the table to read rows from."}
   * @paramDef {"type":"Number","label":"Page","name":"page","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-based page number to retrieve (default 1)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"size","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of rows per page (default 100, maximum 200)."}
   * @paramDef {"type":"String","label":"Search","name":"search","required":false,"description":"Optional full-text search; only rows with a matching value in any visible field are returned."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","required":false,"description":"Comma-separated field names to sort by. Prefix a name with '-' for descending order, e.g. '-Created,Name'."}
   * @paramDef {"type":"Object","label":"Filters","name":"filters","required":false,"description":"Optional filters using Baserow's 'filter__{field}__{type}' key syntax, e.g. {\"filter__Name__contains\":\"Acme\",\"filter__Status__single_select_equal\":\"Open\"}."}
   * @paramDef {"type":"String","label":"Filter Type","name":"filterType","required":false,"defaultValue":"AND","uiComponent":{"type":"DROPDOWN","options":{"values":["AND","OR"]}},"description":"How multiple filters are combined. AND requires all to match; OR requires any."}
   * @paramDef {"type":"Boolean","label":"Use Field Names","name":"userFieldNames","required":false,"defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"When enabled (default) rows are keyed by human-readable field names instead of internal field_123 IDs."}
   * @returns {Object}
   * @sampleResult {"count":2,"next":"https://api.baserow.io/api/database/rows/table/678/?page=2","previous":null,"results":[{"id":1,"order":"1.00000000000000000000","Name":"Acme","Status":"Open"}]}
   */
  async listRows(tableId, page, size, search, orderBy, filters, filterType, userFieldNames) {
    const query = {
      user_field_names: userFieldNames === false ? false : true,
    }

    if (page !== undefined && page !== null) {
      query.page = page
    }

    if (size !== undefined && size !== null) {
      query.size = size
    }

    if (search) {
      query.search = search
    }

    if (orderBy) {
      query.order_by = orderBy
    }

    if (filterType) {
      query.filter_type = filterType
    }

    if (filters && typeof filters === 'object') {
      Object.assign(query, filters)
    }

    const result = await this.#apiRequest({
      logTag: 'listRows',
      url: `${ this.#apiBase() }/database/rows/table/${ tableId }/`,
      query,
    })

    return {
      count: result?.count,
      next: result?.next || null,
      previous: result?.previous || null,
      results: result?.results || [],
    }
  }

  /**
   * @description Retrieves a single row from a Baserow table by its row ID. When "Use Field Names" is enabled (default) the returned row is keyed by human-readable field names instead of internal field_123 IDs.
   * @route GET /get-row
   * @operationName Get Row
   * @category Rows
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getTablesDictionary","description":"Identifier of the table containing the row."}
   * @paramDef {"type":"String","label":"Row ID","name":"rowId","required":true,"description":"Identifier of the row to retrieve."}
   * @paramDef {"type":"Boolean","label":"Use Field Names","name":"userFieldNames","required":false,"defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"When enabled (default) the row is keyed by human-readable field names instead of internal field_123 IDs."}
   * @returns {Object}
   * @sampleResult {"id":1,"order":"1.00000000000000000000","Name":"Acme","Status":"Open"}
   */
  async getRow(tableId, rowId, userFieldNames) {
    return this.#apiRequest({
      logTag: 'getRow',
      url: `${ this.#apiBase() }/database/rows/table/${ tableId }/${ rowId }/`,
      query: { user_field_names: userFieldNames === false ? false : true },
    })
  }

  /**
   * @description Creates a new row in a Baserow table. Provide a Data object of the row's field values. When "Use Field Names" is enabled (default) the Data keys are human-readable field names (e.g. {"Name":"Acme","Status":"Open"}); disable it to key by internal field_123 IDs. Returns the created row.
   * @route POST /create-row
   * @operationName Create Row
   * @category Rows
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getTablesDictionary","description":"Identifier of the table in which to create the row."}
   * @paramDef {"type":"Object","label":"Data","name":"data","required":true,"description":"Object of field values for the new row, keyed by field name when Use Field Names is enabled, e.g. {\"Name\":\"Acme\",\"Status\":\"Open\"}."}
   * @paramDef {"type":"Boolean","label":"Use Field Names","name":"userFieldNames","required":false,"defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"When enabled (default) the Data object is keyed by human-readable field names instead of internal field_123 IDs."}
   * @returns {Object}
   * @sampleResult {"id":3,"order":"3.00000000000000000000","Name":"Acme","Status":"Open"}
   */
  async createRow(tableId, data, userFieldNames) {
    return this.#apiRequest({
      logTag: 'createRow',
      url: `${ this.#apiBase() }/database/rows/table/${ tableId }/`,
      method: 'post',
      query: { user_field_names: userFieldNames === false ? false : true },
      body: data || {},
    })
  }

  /**
   * @description Updates an existing row in a Baserow table. Only the fields included in the Data object are modified; omitted fields keep their current values. When "Use Field Names" is enabled (default) the Data keys are human-readable field names. Returns the updated row.
   * @route PATCH /update-row
   * @operationName Update Row
   * @category Rows
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getTablesDictionary","description":"Identifier of the table containing the row."}
   * @paramDef {"type":"String","label":"Row ID","name":"rowId","required":true,"description":"Identifier of the row to update."}
   * @paramDef {"type":"Object","label":"Data","name":"data","required":true,"description":"Object of field values to change, keyed by field name when Use Field Names is enabled. Omitted fields are left unchanged."}
   * @paramDef {"type":"Boolean","label":"Use Field Names","name":"userFieldNames","required":false,"defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"When enabled (default) the Data object is keyed by human-readable field names instead of internal field_123 IDs."}
   * @returns {Object}
   * @sampleResult {"id":1,"order":"1.00000000000000000000","Name":"Acme Inc","Status":"Won"}
   */
  async updateRow(tableId, rowId, data, userFieldNames) {
    return this.#apiRequest({
      logTag: 'updateRow',
      url: `${ this.#apiBase() }/database/rows/table/${ tableId }/${ rowId }/`,
      method: 'patch',
      query: { user_field_names: userFieldNames === false ? false : true },
      body: data || {},
    })
  }

  /**
   * @description Deletes a single row from a Baserow table by its row ID. The row is moved to the trash and can be restored from the Baserow interface. Returns a confirmation object.
   * @route DELETE /delete-row
   * @operationName Delete Row
   * @category Rows
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getTablesDictionary","description":"Identifier of the table containing the row."}
   * @paramDef {"type":"String","label":"Row ID","name":"rowId","required":true,"description":"Identifier of the row to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"tableId":"678","rowId":"1"}
   */
  async deleteRow(tableId, rowId) {
    await this.#apiRequest({
      logTag: 'deleteRow',
      url: `${ this.#apiBase() }/database/rows/table/${ tableId }/${ rowId }/`,
      method: 'delete',
    })

    return { deleted: true, tableId: String(tableId), rowId: String(rowId) }
  }

  /**
   * @description Moves a row to a new position within its Baserow table, changing its order. Provide the "Before Row ID" of the row that the moved row should be placed before; leave it empty to move the row to the end of the table. Returns the moved row with its updated order.
   * @route PATCH /move-row
   * @operationName Move Row
   * @category Rows
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getTablesDictionary","description":"Identifier of the table containing the row."}
   * @paramDef {"type":"String","label":"Row ID","name":"rowId","required":true,"description":"Identifier of the row to move."}
   * @paramDef {"type":"String","label":"Before Row ID","name":"beforeId","required":false,"description":"Identifier of the row to position the moved row before. Leave empty to move the row to the end of the table."}
   * @paramDef {"type":"Boolean","label":"Use Field Names","name":"userFieldNames","required":false,"defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"When enabled (default) the returned row is keyed by human-readable field names instead of internal field_123 IDs."}
   * @returns {Object}
   * @sampleResult {"id":1,"order":"2.50000000000000000000","Name":"Acme","Status":"Open"}
   */
  async moveRow(tableId, rowId, beforeId, userFieldNames) {
    const query = { user_field_names: userFieldNames === false ? false : true }

    if (beforeId) {
      query.before_id = beforeId
    }

    return this.#apiRequest({
      logTag: 'moveRow',
      url: `${ this.#apiBase() }/database/rows/table/${ tableId }/${ rowId }/move/`,
      method: 'patch',
      query,
    })
  }

  /**
   * @description Creates multiple rows in a Baserow table in a single request. Provide an array of row objects; when "Use Field Names" is enabled (default) each object is keyed by human-readable field names. Returns the array of created rows.
   * @route POST /create-rows
   * @operationName Create Rows (Batch)
   * @category Rows
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getTablesDictionary","description":"Identifier of the table in which to create the rows."}
   * @paramDef {"type":"Array<Object>","label":"Rows","name":"items","required":true,"description":"Array of row objects to create, each keyed by field name when Use Field Names is enabled, e.g. [{\"Name\":\"Acme\"},{\"Name\":\"Globex\"}]."}
   * @paramDef {"type":"Boolean","label":"Use Field Names","name":"userFieldNames","required":false,"defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"When enabled (default) each row object is keyed by human-readable field names instead of internal field_123 IDs."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":3,"Name":"Acme"},{"id":4,"Name":"Globex"}]}
   */
  async createRows(tableId, items, userFieldNames) {
    return this.#apiRequest({
      logTag: 'createRows',
      url: `${ this.#apiBase() }/database/rows/table/${ tableId }/batch/`,
      method: 'post',
      query: { user_field_names: userFieldNames === false ? false : true },
      body: { items: Array.isArray(items) ? items : [] },
    })
  }

  /**
   * @description Updates multiple rows in a Baserow table in a single request. Each object in the array must include the row's "id"; the remaining keys are the field values to change. When "Use Field Names" is enabled (default) those keys are human-readable field names. Returns the array of updated rows.
   * @route PATCH /update-rows
   * @operationName Update Rows (Batch)
   * @category Rows
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getTablesDictionary","description":"Identifier of the table containing the rows."}
   * @paramDef {"type":"Array<Object>","label":"Rows","name":"items","required":true,"description":"Array of row objects to update. Each must include the row's numeric 'id' plus the field values to change, e.g. [{\"id\":1,\"Status\":\"Won\"},{\"id\":2,\"Status\":\"Lost\"}]."}
   * @paramDef {"type":"Boolean","label":"Use Field Names","name":"userFieldNames","required":false,"defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"When enabled (default) each row object is keyed by human-readable field names instead of internal field_123 IDs."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":1,"Status":"Won"},{"id":2,"Status":"Lost"}]}
   */
  async updateRows(tableId, items, userFieldNames) {
    return this.#apiRequest({
      logTag: 'updateRows',
      url: `${ this.#apiBase() }/database/rows/table/${ tableId }/batch/`,
      method: 'patch',
      query: { user_field_names: userFieldNames === false ? false : true },
      body: { items: Array.isArray(items) ? items : [] },
    })
  }

  /**
   * @description Deletes multiple rows from a Baserow table in a single request by their row IDs. The rows are moved to the trash and can be restored from the Baserow interface. Returns a confirmation object.
   * @route POST /delete-rows
   * @operationName Delete Rows (Batch)
   * @category Rows
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getTablesDictionary","description":"Identifier of the table containing the rows."}
   * @paramDef {"type":"Array<Number>","label":"Row IDs","name":"items","required":true,"description":"Array of numeric row IDs to delete, e.g. [1,2,3]."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"tableId":"678","items":[1,2,3]}
   */
  async deleteRows(tableId, items) {
    const ids = Array.isArray(items) ? items : []

    await this.#apiRequest({
      logTag: 'deleteRows',
      url: `${ this.#apiBase() }/database/rows/table/${ tableId }/batch-delete/`,
      method: 'post',
      body: { items: ids },
    })

    return { deleted: true, tableId: String(tableId), items: ids }
  }
}

Flowrunner.ServerCode.addService(Baserow, [
  {
    name: 'baseUrl',
    displayName: 'Base URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    defaultValue: 'https://api.baserow.io',
    hint: 'Leave as https://api.baserow.io for Baserow Cloud. Self-hosted instances set their own URL, e.g. https://baserow.example.com (strip any trailing slash).',
  },
  {
    name: 'apiToken',
    displayName: 'Database Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'A Baserow database token (sent as "Authorization: Token ..."). In Baserow, open Settings → Database tokens and create a token scoped to the database(s) you want to access. This token powers all row operations (list, get, create, update, delete, move, and batch) but CANNOT list or create tables/fields/databases — those require the JWT Access Token below.',
  },
  {
    name: 'jwtToken',
    displayName: 'JWT Access Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Optional JWT access token (sent as "Authorization: JWT ..."). Baserow requires a JWT — not a database token — for structure operations: List/Get Databases, List/Get/Create Table, List/Create Field, and the Databases/Tables/Fields dictionaries. Obtain one via POST /api/user/token-auth/ with your email and password and paste the returned "access_token" here. Leave blank if you only need row operations. Note that JWT access tokens are short-lived and must be refreshed periodically.',
  },
])
