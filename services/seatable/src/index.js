'use strict'

const logger = {
  info: (...args) => console.log('[SeaTable] info:', ...args),
  debug: (...args) => console.log('[SeaTable] debug:', ...args),
  error: (...args) => console.log('[SeaTable] error:', ...args),
  warn: (...args) => console.log('[SeaTable] warn:', ...args),
}

const DEFAULT_SERVER_URL = 'https://cloud.seatable.io'
const APP_ACCESS_TOKEN_PATH = '/api/v2.1/dtable/app-access-token/'

/**
 * @integrationName SeaTable
 * @integrationIcon /icon.png
 */
class SeaTable {
  constructor(config) {
    this.serverUrl = (config.serverUrl || DEFAULT_SERVER_URL).replace(/\/+$/, '')
    this.apiToken = config.apiToken

    // Cached base access context (see #getBaseContext). Base access tokens are
    // short-lived (~3 days); we refresh on-demand and on 401.
    this._baseContext = null
  }

  // ============================ TWO-TIER AUTHENTICATION ============================

  /**
   * Exchanges the long-lived Base API Token for a short-lived base access token and
   * caches the returned base coordinates (dtable_uuid + dtable_server gateway URL).
   * All data/row operations authenticate with the base access token (Bearer) against
   * the API gateway (api-gateway/api/v2) rather than the main SeaTable server.
   *
   * @param {Boolean} [forceRefresh] When true, ignores any cached context and re-exchanges.
   * @returns {Object} { accessToken, dtableUuid, dtableServer }
   */
  async #getBaseContext(forceRefresh) {
    if (this._baseContext && !forceRefresh) {
      return this._baseContext
    }

    let response

    try {
      response = await Flowrunner.Request
        .get(`${ this.serverUrl }${ APP_ACCESS_TOKEN_PATH }`)
        .set({ Authorization: `Token ${ this.apiToken }` })
    } catch (error) {
      throw this.#toError('getBaseContext', error)
    }

    if (!response || !response.access_token) {
      throw new Error('SeaTable API error: failed to obtain a base access token. Verify the Base API Token and Server URL.')
    }

    // dtable_server is the API gateway base URL for data operations (e.g.
    // https://cloud.seatable.io/api-gateway/) and always ends with a slash. As of
    // SeaTable 5.3 all base operations route through this gateway; the legacy
    // dtable-server/dtable-db endpoints are no longer supported.
    const dtableServer = (response.dtable_server || `${ this.serverUrl }/api-gateway/`).replace(/\/*$/, '/')

    this._baseContext = {
      accessToken: response.access_token,
      dtableUuid: response.dtable_uuid,
      dtableServer,
      workspaceId: response.workspace_id,
      dtableName: response.dtable_name,
    }

    logger.debug(`getBaseContext - resolved base "${ response.dtable_name }" (${ response.dtable_uuid })`)

    return this._baseContext
  }

  #toError(logTag, error) {
    const body = error?.body || {}
    const message = body.error_msg || body.detail || body.error || error?.message || 'Unknown error'

    logger.error(`${ logTag } - failed: ${ message }`)

    return new Error(`SeaTable API error: ${ message }`)
  }

  /**
   * Single entry point for all base data operations. Resolves the base context,
   * issues the request against the API gateway, and transparently retries
   * once with a freshly exchanged access token if the base token has expired (401).
   *
   * @param {Object} options
   * @returns {any} The response body.
   */
  async #dataRequest({ path, method = 'get', body, query, logTag }) {
    const attempt = async forceRefresh => {
      const { accessToken, dtableServer, dtableUuid } = await this.#getBaseContext(forceRefresh)
      const url = `${ dtableServer }api/v2/dtables/${ dtableUuid }/${ path }`

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ Authorization: `Bearer ${ accessToken }`, 'Content-Type': 'application/json' })
        .query(query || {})

      return body !== undefined ? request.send(body) : request
    }

    try {
      return await attempt(false)
    } catch (error) {
      const status = error?.status || error?.statusCode

      if (status === 401 || status === 403) {
        logger.warn(`${ logTag } - base access token rejected (${ status }); re-exchanging and retrying`)

        try {
          return await attempt(true)
        } catch (retryError) {
          throw this.#toError(logTag, retryError)
        }
      }

      throw this.#toError(logTag, error)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // ================================ DICTIONARIES ================================

  /**
   * @typedef {Object} DictionaryItem
   * @property {String} label
   * @property {any} value
   * @property {String} note
   */

  /**
   * @typedef {Object} DictionaryResponse
   * @property {Array<DictionaryItem>} items
   * @property {String} cursor
   */

  /**
   * @typedef {Object} getTablesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter tables by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused because base metadata is returned in a single response."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tables Dictionary
   * @description Lists all tables in the connected SeaTable base for selection in dependent parameters. Table names are used as identifiers throughout the row API.
   * @category Metadata
   *
   * @route POST /get-tables-dictionary
   *
   * @paramDef {"type":"getTablesDictionary__payload","label":"Payload","name":"payload","description":"Optional search string and pagination cursor for retrieving and filtering tables."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Tasks","value":"Tasks","note":"12 columns"}]}
   */
  async getTablesDictionary(payload) {
    const { search } = payload || {}
    const { tables } = await this.#getMetadata()

    const filtered = search
      ? tables.filter(table => (table.name || '').toLowerCase().includes(search.toLowerCase()))
      : tables

    return {
      items: filtered.map(table => ({
        label: table.name || '[empty]',
        value: table.name,
        note: `${ (table.columns || []).length } columns`,
      })),
    }
  }

  /**
   * @typedef {Object} getColumnsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"description":"Name of the table whose columns should be listed."}
   */

  /**
   * @typedef {Object} getColumnsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter columns by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused because base metadata is returned in a single response."}
   * @paramDef {"type":"getColumnsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the table whose columns should be returned."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Columns Dictionary
   * @description Lists the columns of a specific table in the connected SeaTable base. Column names are the keys used inside row objects for append and update operations.
   * @category Metadata
   *
   * @route POST /get-columns-dictionary
   *
   * @paramDef {"type":"getColumnsDictionary__payload","label":"Payload","name":"payload","description":"Table criteria plus optional search string and pagination cursor for retrieving and filtering columns."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Name","value":"Name","note":"text"}]}
   */
  async getColumnsDictionary(payload) {
    const { search, criteria } = payload || {}
    const tableName = criteria?.tableName
    const { tables } = await this.#getMetadata()

    const table = (tables || []).find(item => item.name === tableName)
    const columns = table?.columns || []

    const filtered = search
      ? columns.filter(column => (column.name || '').toLowerCase().includes(search.toLowerCase()))
      : columns

    return {
      items: filtered.map(column => ({
        label: column.name || '[empty]',
        value: column.name,
        note: column.type || 'column',
      })),
    }
  }

  async #getMetadata() {
    const result = await this.#dataRequest({
      logTag: 'getMetadata',
      path: 'metadata/',
    })

    return result?.metadata || { tables: [] }
  }

  // ================================== METADATA ==================================

  /**
   * @description Retrieves the full schema of the connected SeaTable base, including every table with its columns, column types, and views. Use this to discover table names (which identify tables in the row API) and column names (which key the values inside row objects) before performing data operations.
   *
   * @route GET /getBaseMetadata
   * @operationName Get Base Metadata
   * @category Metadata
   *
   * @returns {Object} The base metadata containing the tables array with their columns and views.
   * @sampleResult {"tables":[{"_id":"0000","name":"Tasks","columns":[{"key":"0000","name":"Name","type":"text"},{"key":"88o8","name":"Done","type":"checkbox"}],"views":[{"_id":"0000","name":"Default View"}]}]}
   */
  async getBaseMetadata() {
    return this.#getMetadata()
  }

  // ==================================== ROWS ====================================

  /**
   * @description Retrieves rows from a table in the connected SeaTable base via the API gateway. Supports selecting a specific view, pagination via start offset and limit (max 1000 per request), and optionally returning column keys instead of readable column names. Returns the matching rows keyed by column name.
   *
   * @route GET /listRows
   * @operationName List Rows
   * @category Rows
   *
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"dictionary":"getTablesDictionary","description":"Name of the table to read rows from."}
   * @paramDef {"type":"String","label":"View Name","name":"viewName","description":"Optional view to read rows from. When omitted, the table's default view is used."}
   * @paramDef {"type":"Number","label":"Start","name":"start","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based offset of the first row to return (default 0)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of rows to return (default 100, max 1000)."}
   * @paramDef {"type":"Boolean","label":"Convert Keys","name":"convertKeys","uiComponent":{"type":"TOGGLE"},"description":"When enabled (default), rows are keyed by readable column names. Disable to receive rows keyed by internal column keys instead."}
   *
   * @returns {Object} An object with a rows array; each row is keyed by column name plus a _id field.
   * @sampleResult {"rows":[{"_id":"aBcD1234","Name":"Write report","Done":false}]}
   */
  async listRows(tableName, viewName, start, limit, convertKeys) {
    const query = { table_name: tableName }

    if (viewName) query.view_name = viewName
    if (start !== undefined && start !== null) query.start = start
    query.limit = limit !== undefined && limit !== null ? limit : 100
    query.convert_keys = convertKeys === undefined || convertKeys === null ? true : convertKeys

    return this.#dataRequest({
      logTag: 'listRows',
      path: 'rows/',
      query,
    })
  }

  /**
   * @description Retrieves a single row by its ID from a table in the connected SeaTable base. Returns the row keyed by column name.
   *
   * @route GET /getRow
   * @operationName Get Row
   * @category Rows
   *
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"dictionary":"getTablesDictionary","description":"Name of the table containing the row."}
   * @paramDef {"type":"String","label":"Row ID","name":"rowId","required":true,"description":"Unique identifier of the row to retrieve."}
   *
   * @returns {Object} The row object keyed by column name plus a _id field.
   * @sampleResult {"_id":"aBcD1234","Name":"Write report","Done":false}
   */
  async getRow(tableName, rowId) {
    return this.#dataRequest({
      logTag: 'getRow',
      path: `rows/${ rowId }/`,
      query: { table_name: tableName },
    })
  }

  /**
   * @description Appends a single new row to a table in the connected SeaTable base. The row object must be keyed by column NAME (not column key). Returns the created row including its generated ID.
   *
   * @route POST /appendRow
   * @operationName Append Row
   * @category Rows
   *
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"dictionary":"getTablesDictionary","description":"Name of the table to append the row to."}
   * @paramDef {"type":"Object","label":"Row","name":"row","required":true,"description":"Object of column values keyed by column name. Example: {\"Name\":\"Write report\",\"Done\":false}."}
   *
   * @returns {Object} The created row including its generated _id.
   * @sampleResult {"_id":"aBcD1234","Name":"Write report","Done":false}
   */
  async appendRow(tableName, row) {
    return this.#dataRequest({
      logTag: 'appendRow',
      path: 'rows/',
      method: 'post',
      body: { table_name: tableName, row },
    })
  }

  /**
   * @description Updates an existing row in a table in the connected SeaTable base. Only the columns supplied in the row object are modified; other column values are preserved. The row object must be keyed by column NAME.
   *
   * @route PUT /updateRow
   * @operationName Update Row
   * @category Rows
   *
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"dictionary":"getTablesDictionary","description":"Name of the table containing the row."}
   * @paramDef {"type":"String","label":"Row ID","name":"rowId","required":true,"description":"Unique identifier of the row to update."}
   * @paramDef {"type":"Object","label":"Row","name":"row","required":true,"description":"Object of column values to change, keyed by column name. Only the provided columns are updated."}
   *
   * @returns {Object} A success indicator from the SeaTable API.
   * @sampleResult {"success":true}
   */
  async updateRow(tableName, rowId, row) {
    return this.#dataRequest({
      logTag: 'updateRow',
      path: 'rows/',
      method: 'put',
      body: { table_name: tableName, row_id: rowId, row },
    })
  }

  /**
   * @description Deletes a single row by its ID from a table in the connected SeaTable base.
   *
   * @route DELETE /deleteRow
   * @operationName Delete Row
   * @category Rows
   *
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"dictionary":"getTablesDictionary","description":"Name of the table containing the row."}
   * @paramDef {"type":"String","label":"Row ID","name":"rowId","required":true,"description":"Unique identifier of the row to delete."}
   *
   * @returns {Object} A success indicator from the SeaTable API.
   * @sampleResult {"success":true}
   */
  async deleteRow(tableName, rowId) {
    return this.#dataRequest({
      logTag: 'deleteRow',
      path: 'rows/',
      method: 'delete',
      body: { table_name: tableName, row_id: rowId },
    })
  }

  /**
   * @description Appends multiple rows to a table in a single request (up to 1000 rows). Each row object must be keyed by column NAME. Far more efficient than appending rows one at a time.
   *
   * @route POST /appendRows
   * @operationName Append Rows
   * @category Rows
   *
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"dictionary":"getTablesDictionary","description":"Name of the table to append rows to."}
   * @paramDef {"type":"Array<Object>","label":"Rows","name":"rows","required":true,"description":"Array of row objects, each keyed by column name. Example: [{\"Name\":\"A\"},{\"Name\":\"B\"}]."}
   *
   * @returns {Object} The batch append result reporting how many rows were inserted.
   * @sampleResult {"inserted_row_count":2}
   */
  async appendRows(tableName, rows) {
    if (!Array.isArray(rows)) rows = []

    return this.#dataRequest({
      logTag: 'appendRows',
      path: 'batch-append-rows/',
      method: 'post',
      body: { table_name: tableName, rows },
    })
  }

  /**
   * @description Updates multiple rows in a single request. Each update must specify the target row_id and an object of column values (keyed by column NAME). Far more efficient than updating rows one at a time.
   *
   * @route PUT /updateRows
   * @operationName Update Rows
   * @category Rows
   *
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"dictionary":"getTablesDictionary","description":"Name of the table containing the rows."}
   * @paramDef {"type":"Array<Object>","label":"Updates","name":"updates","required":true,"description":"Array of update objects, each shaped like {\"row_id\":\"aBcD1234\",\"row\":{\"Name\":\"New value\"}}. Row values are keyed by column name."}
   *
   * @returns {Object} A success indicator from the SeaTable API.
   * @sampleResult {"success":true}
   */
  async updateRows(tableName, updates) {
    if (!Array.isArray(updates)) updates = []

    return this.#dataRequest({
      logTag: 'updateRows',
      path: 'batch-update-rows/',
      method: 'put',
      body: { table_name: tableName, updates },
    })
  }

  /**
   * @description Deletes multiple rows in a single request by supplying an array of row IDs. Far more efficient than deleting rows one at a time.
   *
   * @route DELETE /deleteRows
   * @operationName Delete Rows
   * @category Rows
   *
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"dictionary":"getTablesDictionary","description":"Name of the table containing the rows."}
   * @paramDef {"type":"Array<String>","label":"Row IDs","name":"rowIds","required":true,"description":"Array of row IDs to delete. Example: [\"aBcD1234\",\"eFgH5678\"]."}
   *
   * @returns {Object} A success indicator from the SeaTable API.
   * @sampleResult {"success":true}
   */
  async deleteRows(tableName, rowIds) {
    if (!Array.isArray(rowIds)) rowIds = []

    return this.#dataRequest({
      logTag: 'deleteRows',
      path: 'batch-delete-rows/',
      method: 'delete',
      body: { table_name: tableName, row_ids: rowIds },
    })
  }

  // ===================================== SQL =====================================

  /**
   * @description Runs a read-only SQL SELECT statement against the connected SeaTable base and returns the matching rows plus column metadata. SeaTable supports a rich SQL dialect over base tables (WHERE, ORDER BY, GROUP BY, JOIN, LIMIT). Column keys in results are converted to human-readable column names. This is a powerful way to query and aggregate data without paging through rows manually.
   *
   * @route POST /queryWithSql
   * @operationName Query with SQL
   * @category SQL
   *
   * @paramDef {"type":"String","label":"SQL","name":"sql","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A SELECT statement to run against the base. Table and column names containing spaces must be wrapped in backticks. Example: SELECT `Name`, `Done` FROM `Tasks` WHERE `Done` = false LIMIT 100."}
   *
   * @returns {Object} An object with a results array of matching rows and a metadata array describing the returned columns.
   * @sampleResult {"success":true,"results":[{"Name":"Write report","Done":false}],"metadata":[{"key":"0000","name":"Name","type":"text"}]}
   */
  async queryWithSql(sql) {
    return this.#dataRequest({
      logTag: 'queryWithSql',
      path: 'sql/',
      method: 'post',
      body: { sql, convert_keys: true },
    })
  }

  // ==================================== LINKS ====================================

  /**
   * @description Lists the linked rows for a specific link column of a given row in the connected SeaTable base. Use Get Base Metadata to find the link column's key. Returns the IDs of the rows linked through that column.
   *
   * @route GET /listRowLinks
   * @operationName List Row Links
   * @category Links
   *
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"description":"The _id of the table containing the source row (found via Get Base Metadata)."}
   * @paramDef {"type":"String","label":"Link Column Key","name":"linkColumnKey","required":true,"description":"The key of the link column (found via Get Base Metadata)."}
   * @paramDef {"type":"Array<String>","label":"Row IDs","name":"rowIds","required":true,"description":"Array of source row IDs whose linked rows should be returned. Example: [\"aBcD1234\"]."}
   *
   * @returns {Object} A map of source row ID to the array of rows it links to through the specified column.
   * @sampleResult {"aBcD1234":[{"row_id":"xYz98765","display_value":"Project Alpha"}]}
   */
  async listRowLinks(tableId, linkColumnKey, rowIds) {
    if (!Array.isArray(rowIds)) rowIds = []

    return this.#dataRequest({
      logTag: 'listRowLinks',
      path: 'query-links/',
      method: 'post',
      body: { table_id: tableId, link_column_key: linkColumnKey, rows: rowIds },
    })
  }

  /**
   * @description Creates a link between a row in one table and a row in a linked table through a link column. Use Get Base Metadata to obtain the table IDs and link column key.
   *
   * @route POST /addLink
   * @operationName Add Link
   * @category Links
   *
   * @paramDef {"type":"String","label":"Link Column Key","name":"linkColumnKey","required":true,"description":"The key of the link column joining the two tables (found via Get Base Metadata)."}
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"dictionary":"getTablesDictionary","description":"Name of the table containing the source row."}
   * @paramDef {"type":"String","label":"Other Table Name","name":"otherTableName","required":true,"dictionary":"getTablesDictionary","description":"Name of the linked (target) table."}
   * @paramDef {"type":"String","label":"Row ID","name":"rowId","required":true,"description":"ID of the source row in the source table."}
   * @paramDef {"type":"String","label":"Other Row ID","name":"otherRowId","required":true,"description":"ID of the target row in the linked table to connect to."}
   *
   * @returns {Object} A success indicator from the SeaTable API.
   * @sampleResult {"success":true}
   */
  async addLink(linkColumnKey, tableName, otherTableName, rowId, otherRowId) {
    return this.#dataRequest({
      logTag: 'addLink',
      path: 'links/',
      method: 'post',
      body: {
        link_id: linkColumnKey,
        table_name: tableName,
        other_table_name: otherTableName,
        row_id: rowId,
        other_row_id: otherRowId,
      },
    })
  }

  /**
   * @description Removes an existing link between a source row and a target row through a link column. Use Get Base Metadata to obtain the link column key and table names.
   *
   * @route DELETE /removeLink
   * @operationName Remove Link
   * @category Links
   *
   * @paramDef {"type":"String","label":"Link Column Key","name":"linkColumnKey","required":true,"description":"The key of the link column joining the two tables (found via Get Base Metadata)."}
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"dictionary":"getTablesDictionary","description":"Name of the table containing the source row."}
   * @paramDef {"type":"String","label":"Other Table Name","name":"otherTableName","required":true,"dictionary":"getTablesDictionary","description":"Name of the linked (target) table."}
   * @paramDef {"type":"String","label":"Row ID","name":"rowId","required":true,"description":"ID of the source row in the source table."}
   * @paramDef {"type":"String","label":"Other Row ID","name":"otherRowId","required":true,"description":"ID of the target row in the linked table to disconnect from."}
   *
   * @returns {Object} A success indicator from the SeaTable API.
   * @sampleResult {"success":true}
   */
  async removeLink(linkColumnKey, tableName, otherTableName, rowId, otherRowId) {
    return this.#dataRequest({
      logTag: 'removeLink',
      path: 'links/',
      method: 'delete',
      body: {
        link_id: linkColumnKey,
        table_name: tableName,
        other_table_name: otherTableName,
        row_id: rowId,
        other_row_id: otherRowId,
      },
    })
  }
}

Flowrunner.ServerCode.addService(SeaTable, [
  {
    name: 'serverUrl',
    displayName: 'Server URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    defaultValue: 'https://cloud.seatable.io',
    hint: 'SeaTable server URL. Leave as https://cloud.seatable.io for SeaTable Cloud, or set your own server URL when self-hosting. Strip any trailing slash.',
  },
  {
    name: 'apiToken',
    displayName: 'API Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'A Base API Token. In SeaTable, open your base, click the ... menu, choose Advanced, then API Tokens, and create a Base API Token.',
  },
])
