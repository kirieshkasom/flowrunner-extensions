'use strict'

const logger = {
  info: (...args) => console.log('[Coda] info:', ...args),
  debug: (...args) => console.log('[Coda] debug:', ...args),
  error: (...args) => console.log('[Coda] error:', ...args),
  warn: (...args) => console.log('[Coda] warn:', ...args),
}

const API_BASE_URL = 'https://coda.io/apis/v1'

function clean(obj) {
  if (!obj || typeof obj !== 'object') {
    return obj
  }

  const result = {}

  for (const key in obj) {
    const value = obj[key]

    if (value !== undefined && value !== null && value !== '') {
      result[key] = value
    }
  }

  return result
}

/**
 * @integrationName Coda
 * @integrationIcon /icon.svg
 */
class Coda {
  constructor(config) {
    this.apiToken = config.apiToken
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.apiToken }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery)

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.message || error.body?.statusMessage || error.message
      logger.error(`${ logTag } - request failed: ${ message }`)
      throw new Error(`Coda API error: ${ message }`)
    }
  }

  // ─── Value conversion helpers ──────────────────────────────────────────

  /**
   * Flattens a Coda row's `values` map into a clean object keyed by column id
   * (or column name, when the row was requested with useColumnNames=true).
   * Preserves the row metadata alongside a `values` object.
   */
  #normalizeRow(row) {
    if (!row || typeof row !== 'object') {
      return row
    }

    const values = {}

    for (const key in row.values || {}) {
      values[key] = row.values[key]
    }

    return {
      id: row.id,
      name: row.name,
      index: row.index,
      href: row.href,
      browserLink: row.browserLink,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      values,
    }
  }

  /**
   * Converts a user-supplied {column: value} map into the Coda cells array
   * shape expected by the insert/update endpoints: [{column, value}].
   */
  #toCells(valueMap) {
    if (!valueMap || typeof valueMap !== 'object') {
      return []
    }

    return Object.keys(valueMap).map(column => ({
      column,
      value: valueMap[column],
    }))
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Docs
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * @operationName List Docs
   * @category Docs
   * @description Lists Coda docs available to the authenticated account. Supports free-text search and filtering to docs the account owns. Results are paginated; pass the returned nextPageToken to retrieve the next page.
   * @route GET /docs
   *
   * @paramDef {"type":"String","label":"Query","name":"query","description":"Optional free-text search to filter docs by title."}
   * @paramDef {"type":"Boolean","label":"Owned Only","name":"isOwner","uiComponent":{"type":"CHECKBOX"},"description":"When true, returns only docs owned by the authenticated account."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of docs to return per page (default 25)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous response's nextPageToken to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"AbCDeFGH","type":"doc","href":"https://coda.io/apis/v1/docs/AbCDeFGH","browserLink":"https://coda.io/d/_dAbCDeFGH","name":"Project Tracker","owner":"user@example.com","createdAt":"2023-01-01T00:00:00.000Z","updatedAt":"2023-06-01T00:00:00.000Z"}],"href":"https://coda.io/apis/v1/docs","nextPageToken":"eyJsaW1pdCI6MjV9","nextPageLink":"https://coda.io/apis/v1/docs?pageToken=eyJsaW1pdCI6MjV9"}
   */
  async listDocs(query, isOwner, limit, pageToken) {
    return this.#apiRequest({
      logTag: '[listDocs]',
      url: `${ API_BASE_URL }/docs`,
      query: { query, isOwner, limit, pageToken },
    })
  }

  /**
   * @operationName Get Doc
   * @category Docs
   * @description Retrieves metadata for a single doc, including its name, owner, folder, workspace, and browser link.
   * @route GET /get-doc
   *
   * @paramDef {"type":"String","label":"Doc","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The doc to retrieve. Search and select a doc, or enter a doc ID directly."}
   *
   * @returns {Object}
   * @sampleResult {"id":"AbCDeFGH","type":"doc","href":"https://coda.io/apis/v1/docs/AbCDeFGH","browserLink":"https://coda.io/d/_dAbCDeFGH","name":"Project Tracker","owner":"user@example.com","ownerName":"Jane Doe","createdAt":"2023-01-01T00:00:00.000Z","updatedAt":"2023-06-01T00:00:00.000Z","workspace":{"id":"ws-abc","type":"workspace"},"folder":{"id":"fl-abc","type":"folder"}}
   */
  async getDoc(docId) {
    return this.#apiRequest({
      logTag: '[getDoc]',
      url: `${ API_BASE_URL }/docs/${ encodeURIComponent(docId) }`,
    })
  }

  /**
   * @operationName Create Doc
   * @category Docs
   * @description Creates a new Coda doc. Optionally copy an existing doc by providing its source doc ID, and optionally place the new doc in a specific folder.
   * @route POST /docs
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Title for the new doc."}
   * @paramDef {"type":"String","label":"Source Doc","name":"sourceDoc","dictionary":"getDocsDictionary","description":"Optional ID of an existing doc to copy from. Leave empty to create a blank doc."}
   * @paramDef {"type":"String","label":"Folder ID","name":"folderId","description":"Optional ID of the folder to create the doc in. Defaults to the account's default folder."}
   * @paramDef {"type":"String","label":"Timezone","name":"timezone","description":"Optional IANA timezone for the doc, e.g. America/Los_Angeles."}
   *
   * @returns {Object}
   * @sampleResult {"id":"NewDocId","type":"doc","href":"https://coda.io/apis/v1/docs/NewDocId","browserLink":"https://coda.io/d/_dNewDocId","name":"Q3 Planning","owner":"user@example.com","createdAt":"2023-06-01T00:00:00.000Z","updatedAt":"2023-06-01T00:00:00.000Z"}
   */
  async createDoc(title, sourceDoc, folderId, timezone) {
    return this.#apiRequest({
      logTag: '[createDoc]',
      url: `${ API_BASE_URL }/docs`,
      method: 'post',
      body: clean({ title, sourceDoc, folderId, timezone }),
    })
  }

  /**
   * @operationName Delete Doc
   * @category Docs
   * @description Permanently deletes a doc. This action cannot be undone.
   * @route DELETE /delete-doc
   *
   * @paramDef {"type":"String","label":"Doc","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The doc to delete. Search and select a doc, or enter a doc ID directly."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"docId":"AbCDeFGH"}
   */
  async deleteDoc(docId) {
    await this.#apiRequest({
      logTag: '[deleteDoc]',
      url: `${ API_BASE_URL }/docs/${ encodeURIComponent(docId) }`,
      method: 'delete',
    })

    return { deleted: true, docId }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Tables
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * @operationName List Tables
   * @category Tables
   * @description Lists the tables and views in a doc. By default only base tables are returned; use the table type filter to include views.
   * @route GET /list-tables
   *
   * @paramDef {"type":"String","label":"Doc","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The doc whose tables to list. Search and select a doc, or enter a doc ID directly."}
   * @paramDef {"type":"String","label":"Table Type","name":"tableTypes","uiComponent":{"type":"DROPDOWN","options":{"values":["Tables","Views","All"]}},"description":"Which table types to include. Defaults to Tables."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tables to return per page (default 25)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous response's nextPageToken to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"grid-abc123","type":"table","tableType":"table","href":"https://coda.io/apis/v1/docs/AbCDeFGH/tables/grid-abc123","browserLink":"https://coda.io/d/_dAbCDeFGH#Tasks","name":"Tasks","parent":{"id":"canvas-abc","type":"page","name":"Overview"},"rowCount":42}],"href":"https://coda.io/apis/v1/docs/AbCDeFGH/tables","nextPageToken":null}
   */
  async listTables(docId, tableTypes, limit, pageToken) {
    return this.#apiRequest({
      logTag: '[listTables]',
      url: `${ API_BASE_URL }/docs/${ encodeURIComponent(docId) }/tables`,
      query: {
        tableTypes: this.#resolveTableTypes(tableTypes),
        limit,
        pageToken,
      },
    })
  }

  #resolveTableTypes(value) {
    const mapping = { Tables: 'table', Views: 'view', All: undefined }

    if (value === undefined || value === null || value === '' || value === 'All') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /**
   * @operationName Get Table
   * @category Tables
   * @description Retrieves metadata for a single table or view, including its display column, row count, and parent page.
   * @route GET /get-table
   *
   * @paramDef {"type":"String","label":"Doc","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The doc that contains the table. Search and select a doc, or enter a doc ID directly."}
   * @paramDef {"type":"String","label":"Table","name":"tableId","required":true,"dictionary":"getTablesDictionary","description":"The table to retrieve. Select a doc first, then search and select a table, or enter a table ID/name directly."}
   *
   * @returns {Object}
   * @sampleResult {"id":"grid-abc123","type":"table","tableType":"table","href":"https://coda.io/apis/v1/docs/AbCDeFGH/tables/grid-abc123","name":"Tasks","rowCount":42,"displayColumn":{"id":"c-name","type":"column","name":"Name"},"parent":{"id":"canvas-abc","type":"page","name":"Overview"}}
   */
  async getTable(docId, tableId) {
    return this.#apiRequest({
      logTag: '[getTable]',
      url: `${ API_BASE_URL }/docs/${ encodeURIComponent(docId) }/tables/${ encodeURIComponent(tableId) }`,
    })
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Rows
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * @operationName List Rows
   * @category Rows
   * @description Lists rows in a table, returning each row's cell values as a clean object. By default values are keyed by column name for readability; disable "Use Column Names" to key them by stable column ID instead. Supports a column:value filter query using Coda's query syntax (e.g. `c-abc:"Done"` or `"Status":"Done"`), a visible-only filter, and pagination.
   * @route GET /list-rows
   *
   * @paramDef {"type":"String","label":"Doc","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The doc that contains the table. Search and select a doc, or enter a doc ID directly."}
   * @paramDef {"type":"String","label":"Table","name":"tableId","required":true,"dictionary":"getTablesDictionary","description":"The table to list rows from. Select a doc first, then search and select a table, or enter a table ID/name directly."}
   * @paramDef {"type":"String","label":"Query Filter","name":"query","description":"Optional column filter using Coda query syntax: `<columnIdOrName>:<value>`, e.g. `\"Status\":\"Done\"`. Only rows matching the value are returned."}
   * @paramDef {"type":"Boolean","label":"Use Column Names","name":"useColumnNames","defaultValue":true,"uiComponent":{"type":"CHECKBOX"},"description":"When true (default), row values are keyed by column name. When false, values are keyed by stable column ID (recommended for automations, since names can change)."}
   * @paramDef {"type":"Boolean","label":"Visible Rows Only","name":"visibleOnly","uiComponent":{"type":"CHECKBOX"},"description":"When true, returns only rows visible after applying the table/view's active filter."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of rows to return per page (default 25)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous response's nextPageToken to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"i-row123","name":"Draft blog post","index":1,"href":"https://coda.io/apis/v1/docs/AbCDeFGH/tables/grid-abc123/rows/i-row123","browserLink":"https://coda.io/d/_dAbCDeFGH#Tasks/r1","createdAt":"2023-01-01T00:00:00.000Z","updatedAt":"2023-06-01T00:00:00.000Z","values":{"Name":"Draft blog post","Status":"In Progress","Due":"2023-06-15"}}],"href":"https://coda.io/apis/v1/docs/AbCDeFGH/tables/grid-abc123/rows","nextPageToken":null}
   */
  async listRows(docId, tableId, query, useColumnNames, visibleOnly, limit, pageToken) {
    const response = await this.#apiRequest({
      logTag: '[listRows]',
      url: `${ API_BASE_URL }/docs/${ encodeURIComponent(docId) }/tables/${ encodeURIComponent(tableId) }/rows`,
      query: {
        query,
        useColumnNames: useColumnNames === undefined ? true : useColumnNames,
        visibleOnly,
        limit,
        pageToken,
        valueFormat: 'simpleWithArrays',
      },
    })

    return {
      ...response,
      items: (response.items || []).map(row => this.#normalizeRow(row)),
    }
  }

  /**
   * @operationName Get Row
   * @category Rows
   * @description Retrieves a single row and returns its cell values as a clean object. By default values are keyed by column name; disable "Use Column Names" to key them by stable column ID.
   * @route GET /get-row
   *
   * @paramDef {"type":"String","label":"Doc","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The doc that contains the table. Search and select a doc, or enter a doc ID directly."}
   * @paramDef {"type":"String","label":"Table","name":"tableId","required":true,"dictionary":"getTablesDictionary","description":"The table that contains the row. Select a doc first, then search and select a table."}
   * @paramDef {"type":"String","label":"Row ID","name":"rowId","required":true,"description":"The ID or name of the row to retrieve."}
   * @paramDef {"type":"Boolean","label":"Use Column Names","name":"useColumnNames","defaultValue":true,"uiComponent":{"type":"CHECKBOX"},"description":"When true (default), row values are keyed by column name. When false, values are keyed by stable column ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":"i-row123","name":"Draft blog post","index":1,"href":"https://coda.io/apis/v1/docs/AbCDeFGH/tables/grid-abc123/rows/i-row123","browserLink":"https://coda.io/d/_dAbCDeFGH#Tasks/r1","createdAt":"2023-01-01T00:00:00.000Z","updatedAt":"2023-06-01T00:00:00.000Z","values":{"Name":"Draft blog post","Status":"In Progress","Due":"2023-06-15"}}
   */
  async getRow(docId, tableId, rowId, useColumnNames) {
    const row = await this.#apiRequest({
      logTag: '[getRow]',
      url: `${ API_BASE_URL }/docs/${ encodeURIComponent(docId) }/tables/${ encodeURIComponent(tableId) }/rows/${ encodeURIComponent(rowId) }`,
      query: {
        useColumnNames: useColumnNames === undefined ? true : useColumnNames,
        valueFormat: 'simpleWithArrays',
      },
    })

    return this.#normalizeRow(row)
  }

  /**
   * @operationName Insert or Upsert Rows
   * @category Rows
   * @description Inserts one or more rows into a table. Each row is a simple {column: value} map (keys may be column IDs or names) that is converted into Coda's cell format automatically. Provide Key Columns to upsert: rows whose key-column values match existing rows are updated instead of inserted. This is an asynchronous mutation — Coda returns a requestId immediately and the change may take a moment to appear; the added row IDs are returned but are not yet queryable until the mutation completes.
   * @route POST /insert-rows
   *
   * @paramDef {"type":"String","label":"Doc","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The doc that contains the table. Search and select a doc, or enter a doc ID directly."}
   * @paramDef {"type":"String","label":"Table","name":"tableId","required":true,"dictionary":"getTablesDictionary","description":"The table to insert rows into. Select a doc first, then search and select a table."}
   * @paramDef {"type":"Array<Object>","label":"Rows","name":"rows","required":true,"description":"Array of row objects. Each object is a {column: value} map keyed by column ID or column name, e.g. [{\"Name\":\"New task\",\"Status\":\"To Do\"}]."}
   * @paramDef {"type":"Array<String>","label":"Key Columns","name":"keyColumns","description":"Optional column IDs or names to match on for upsert. When provided, incoming rows that match existing rows on these columns are updated instead of inserted."}
   *
   * @returns {Object}
   * @sampleResult {"requestId":"abc-123-def","addedRowIds":["i-newRow1","i-newRow2"]}
   */
  async insertRows(docId, tableId, rows, keyColumns) {
    const rowList = Array.isArray(rows) ? rows : [rows]

    const body = {
      rows: rowList.map(row => ({ cells: this.#toCells(row) })),
    }

    if (Array.isArray(keyColumns) && keyColumns.length > 0) {
      body.keyColumns = keyColumns
    }

    return this.#apiRequest({
      logTag: '[insertRows]',
      url: `${ API_BASE_URL }/docs/${ encodeURIComponent(docId) }/tables/${ encodeURIComponent(tableId) }/rows`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Update Row
   * @category Rows
   * @description Updates a single row's cell values. Provide a {column: value} map (keys may be column IDs or names); only the supplied columns are changed. This is an asynchronous mutation — Coda returns a requestId immediately and the change may take a moment to appear.
   * @route PUT /update-row
   *
   * @paramDef {"type":"String","label":"Doc","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The doc that contains the table. Search and select a doc, or enter a doc ID directly."}
   * @paramDef {"type":"String","label":"Table","name":"tableId","required":true,"dictionary":"getTablesDictionary","description":"The table that contains the row. Select a doc first, then search and select a table."}
   * @paramDef {"type":"String","label":"Row ID","name":"rowId","required":true,"description":"The ID or name of the row to update."}
   * @paramDef {"type":"Object","label":"Values","name":"values","required":true,"description":"A {column: value} map of the columns to update, keyed by column ID or name, e.g. {\"Status\":\"Done\"}."}
   *
   * @returns {Object}
   * @sampleResult {"requestId":"abc-123-def","id":"i-row123"}
   */
  async updateRow(docId, tableId, rowId, values) {
    return this.#apiRequest({
      logTag: '[updateRow]',
      url: `${ API_BASE_URL }/docs/${ encodeURIComponent(docId) }/tables/${ encodeURIComponent(tableId) }/rows/${ encodeURIComponent(rowId) }`,
      method: 'put',
      body: { row: { cells: this.#toCells(values) } },
    })
  }

  /**
   * @operationName Delete Row
   * @category Rows
   * @description Deletes a single row from a table. This is an asynchronous mutation — Coda returns a requestId immediately and the change may take a moment to apply.
   * @route DELETE /delete-row
   *
   * @paramDef {"type":"String","label":"Doc","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The doc that contains the table. Search and select a doc, or enter a doc ID directly."}
   * @paramDef {"type":"String","label":"Table","name":"tableId","required":true,"dictionary":"getTablesDictionary","description":"The table that contains the row. Select a doc first, then search and select a table."}
   * @paramDef {"type":"String","label":"Row ID","name":"rowId","required":true,"description":"The ID or name of the row to delete."}
   *
   * @returns {Object}
   * @sampleResult {"requestId":"abc-123-def","id":"i-row123"}
   */
  async deleteRow(docId, tableId, rowId) {
    return this.#apiRequest({
      logTag: '[deleteRow]',
      url: `${ API_BASE_URL }/docs/${ encodeURIComponent(docId) }/tables/${ encodeURIComponent(tableId) }/rows/${ encodeURIComponent(rowId) }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Delete Multiple Rows
   * @category Rows
   * @description Deletes multiple rows from a table in a single request by their row IDs. This is an asynchronous mutation — Coda returns a requestId immediately and the changes may take a moment to apply.
   * @route DELETE /delete-rows
   *
   * @paramDef {"type":"String","label":"Doc","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The doc that contains the table. Search and select a doc, or enter a doc ID directly."}
   * @paramDef {"type":"String","label":"Table","name":"tableId","required":true,"dictionary":"getTablesDictionary","description":"The table that contains the rows. Select a doc first, then search and select a table."}
   * @paramDef {"type":"Array<String>","label":"Row IDs","name":"rowIds","required":true,"description":"Array of row IDs to delete, e.g. [\"i-row123\",\"i-row456\"]."}
   *
   * @returns {Object}
   * @sampleResult {"requestId":"abc-123-def","rowIds":["i-row123","i-row456"]}
   */
  async deleteRows(docId, tableId, rowIds) {
    return this.#apiRequest({
      logTag: '[deleteRows]',
      url: `${ API_BASE_URL }/docs/${ encodeURIComponent(docId) }/tables/${ encodeURIComponent(tableId) }/rows`,
      method: 'delete',
      body: { rowIds: Array.isArray(rowIds) ? rowIds : [rowIds] },
    })
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Columns
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * @operationName List Columns
   * @category Columns
   * @description Lists the columns in a table, including each column's name, type, formula flag, and display flag.
   * @route GET /list-columns
   *
   * @paramDef {"type":"String","label":"Doc","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The doc that contains the table. Search and select a doc, or enter a doc ID directly."}
   * @paramDef {"type":"String","label":"Table","name":"tableId","required":true,"dictionary":"getTablesDictionary","description":"The table whose columns to list. Select a doc first, then search and select a table."}
   * @paramDef {"type":"Boolean","label":"Visible Only","name":"visibleOnly","uiComponent":{"type":"CHECKBOX"},"description":"When true, returns only columns visible in the table/view."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of columns to return per page (default 25)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous response's nextPageToken to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"c-name","type":"column","href":"https://coda.io/apis/v1/docs/AbCDeFGH/tables/grid-abc123/columns/c-name","name":"Name","display":true,"calculated":false,"format":{"type":"text","isArray":false}}],"href":"https://coda.io/apis/v1/docs/AbCDeFGH/tables/grid-abc123/columns","nextPageToken":null}
   */
  async listColumns(docId, tableId, visibleOnly, limit, pageToken) {
    return this.#apiRequest({
      logTag: '[listColumns]',
      url: `${ API_BASE_URL }/docs/${ encodeURIComponent(docId) }/tables/${ encodeURIComponent(tableId) }/columns`,
      query: { visibleOnly, limit, pageToken },
    })
  }

  /**
   * @operationName Get Column
   * @category Columns
   * @description Retrieves metadata for a single column, including its type/format and whether it is calculated (formula) or the display column.
   * @route GET /get-column
   *
   * @paramDef {"type":"String","label":"Doc","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The doc that contains the table. Search and select a doc, or enter a doc ID directly."}
   * @paramDef {"type":"String","label":"Table","name":"tableId","required":true,"dictionary":"getTablesDictionary","description":"The table that contains the column. Select a doc first, then search and select a table."}
   * @paramDef {"type":"String","label":"Column","name":"columnId","required":true,"dictionary":"getColumnsDictionary","description":"The column to retrieve. Select a doc and table first, then search and select a column."}
   *
   * @returns {Object}
   * @sampleResult {"id":"c-status","type":"column","href":"https://coda.io/apis/v1/docs/AbCDeFGH/tables/grid-abc123/columns/c-status","name":"Status","display":false,"calculated":false,"format":{"type":"select","isArray":false,"options":["To Do","In Progress","Done"]}}
   */
  async getColumn(docId, tableId, columnId) {
    return this.#apiRequest({
      logTag: '[getColumn]',
      url: `${ API_BASE_URL }/docs/${ encodeURIComponent(docId) }/tables/${ encodeURIComponent(tableId) }/columns/${ encodeURIComponent(columnId) }`,
    })
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Formulas & Controls
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * @operationName List Formulas
   * @category Formulas & Controls
   * @description Lists the named formulas defined at the doc level. Named formulas expose computed values that can be read via Get Formula.
   * @route GET /list-formulas
   *
   * @paramDef {"type":"String","label":"Doc","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The doc whose formulas to list. Search and select a doc, or enter a doc ID directly."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of formulas to return per page (default 25)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous response's nextPageToken to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"f-abc","type":"formula","href":"https://coda.io/apis/v1/docs/AbCDeFGH/formulas/f-abc","name":"Total Revenue"}],"href":"https://coda.io/apis/v1/docs/AbCDeFGH/formulas","nextPageToken":null}
   */
  async listFormulas(docId, limit, pageToken) {
    return this.#apiRequest({
      logTag: '[listFormulas]',
      url: `${ API_BASE_URL }/docs/${ encodeURIComponent(docId) }/formulas`,
      query: { limit, pageToken },
    })
  }

  /**
   * @operationName Get Formula
   * @category Formulas & Controls
   * @description Retrieves a named formula and its current computed value.
   * @route GET /get-formula
   *
   * @paramDef {"type":"String","label":"Doc","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The doc that contains the formula. Search and select a doc, or enter a doc ID directly."}
   * @paramDef {"type":"String","label":"Formula ID","name":"formulaId","required":true,"description":"The ID or name of the formula to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"f-abc","type":"formula","href":"https://coda.io/apis/v1/docs/AbCDeFGH/formulas/f-abc","name":"Total Revenue","value":124500}
   */
  async getFormula(docId, formulaId) {
    return this.#apiRequest({
      logTag: '[getFormula]',
      url: `${ API_BASE_URL }/docs/${ encodeURIComponent(docId) }/formulas/${ encodeURIComponent(formulaId) }`,
    })
  }

  /**
   * @operationName List Controls
   * @category Formulas & Controls
   * @description Lists the controls (buttons, sliders, selects, and other interactive elements) defined in a doc. Read a control's current value via Get Control.
   * @route GET /list-controls
   *
   * @paramDef {"type":"String","label":"Doc","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The doc whose controls to list. Search and select a doc, or enter a doc ID directly."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of controls to return per page (default 25)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous response's nextPageToken to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"ctrl-abc","type":"control","controlType":"slider","href":"https://coda.io/apis/v1/docs/AbCDeFGH/controls/ctrl-abc","name":"Target"}],"href":"https://coda.io/apis/v1/docs/AbCDeFGH/controls","nextPageToken":null}
   */
  async listControls(docId, limit, pageToken) {
    return this.#apiRequest({
      logTag: '[listControls]',
      url: `${ API_BASE_URL }/docs/${ encodeURIComponent(docId) }/controls`,
      query: { limit, pageToken },
    })
  }

  /**
   * @operationName Get Control
   * @category Formulas & Controls
   * @description Retrieves a single control, including its type and current value.
   * @route GET /get-control
   *
   * @paramDef {"type":"String","label":"Doc","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The doc that contains the control. Search and select a doc, or enter a doc ID directly."}
   * @paramDef {"type":"String","label":"Control ID","name":"controlId","required":true,"description":"The ID or name of the control to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"ctrl-abc","type":"control","controlType":"slider","href":"https://coda.io/apis/v1/docs/AbCDeFGH/controls/ctrl-abc","name":"Target","value":75}
   */
  async getControl(docId, controlId) {
    return this.#apiRequest({
      logTag: '[getControl]',
      url: `${ API_BASE_URL }/docs/${ encodeURIComponent(docId) }/controls/${ encodeURIComponent(controlId) }`,
    })
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Buttons
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * @operationName Push Button
   * @category Buttons
   * @description Presses a button in a button column for a specific row, running its configured action (e.g. run an automation, open a link, or push data). This is an asynchronous mutation — Coda returns a requestId immediately and the button's effect may take a moment to apply.
   * @route POST /push-button
   *
   * @paramDef {"type":"String","label":"Doc","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The doc that contains the table. Search and select a doc, or enter a doc ID directly."}
   * @paramDef {"type":"String","label":"Table","name":"tableId","required":true,"dictionary":"getTablesDictionary","description":"The table that contains the button column. Select a doc first, then search and select a table."}
   * @paramDef {"type":"String","label":"Row ID","name":"rowId","required":true,"description":"The ID or name of the row whose button to press."}
   * @paramDef {"type":"String","label":"Button Column","name":"columnId","required":true,"dictionary":"getColumnsDictionary","description":"The button column to press. Select a doc and table first, then search and select the button column."}
   *
   * @returns {Object}
   * @sampleResult {"requestId":"abc-123-def","rowId":"i-row123","columnId":"c-button"}
   */
  async pushButton(docId, tableId, rowId, columnId) {
    return this.#apiRequest({
      logTag: '[pushButton]',
      url: `${ API_BASE_URL }/docs/${ encodeURIComponent(docId) }/tables/${ encodeURIComponent(tableId) }/rows/${ encodeURIComponent(rowId) }/buttons/${ encodeURIComponent(columnId) }`,
      method: 'post',
    })
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Pages
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * @operationName List Pages
   * @category Pages
   * @description Lists the pages (sections) in a doc, including their names, subtitles, and hierarchy.
   * @route GET /list-pages
   *
   * @paramDef {"type":"String","label":"Doc","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The doc whose pages to list. Search and select a doc, or enter a doc ID directly."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of pages to return per page (default 25)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous response's nextPageToken to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"canvas-abc","type":"page","href":"https://coda.io/apis/v1/docs/AbCDeFGH/pages/canvas-abc","name":"Overview","subtitle":"Project summary","browserLink":"https://coda.io/d/_dAbCDeFGH#_suOverview"}],"href":"https://coda.io/apis/v1/docs/AbCDeFGH/pages","nextPageToken":null}
   */
  async listPages(docId, limit, pageToken) {
    return this.#apiRequest({
      logTag: '[listPages]',
      url: `${ API_BASE_URL }/docs/${ encodeURIComponent(docId) }/pages`,
      query: { limit, pageToken },
    })
  }

  /**
   * @operationName Get Page
   * @category Pages
   * @description Retrieves metadata for a single page (section), including its name, subtitle, icon, and browser link.
   * @route GET /get-page
   *
   * @paramDef {"type":"String","label":"Doc","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The doc that contains the page. Search and select a doc, or enter a doc ID directly."}
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","required":true,"description":"The ID or name of the page to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"canvas-abc","type":"page","href":"https://coda.io/apis/v1/docs/AbCDeFGH/pages/canvas-abc","name":"Overview","subtitle":"Project summary","browserLink":"https://coda.io/d/_dAbCDeFGH#_suOverview","children":[]}
   */
  async getPage(docId, pageId) {
    return this.#apiRequest({
      logTag: '[getPage]',
      url: `${ API_BASE_URL }/docs/${ encodeURIComponent(docId) }/pages/${ encodeURIComponent(pageId) }`,
    })
  }

  /**
   * @operationName Create Page
   * @category Pages
   * @description Creates a new page (section) in a doc. Optionally set a subtitle and seed the page with rich text or HTML content. This is an asynchronous mutation — Coda returns the new page ID and a requestId immediately, and the page may take a moment to fully render.
   * @route POST /create-page
   *
   * @paramDef {"type":"String","label":"Doc","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The doc to create the page in. Search and select a doc, or enter a doc ID directly."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name (title) for the new page."}
   * @paramDef {"type":"String","label":"Subtitle","name":"subtitle","description":"Optional subtitle displayed under the page name."}
   * @paramDef {"type":"String","label":"Content","name":"content","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional initial page content. Provide Markdown or HTML text (see Content Format)."}
   * @paramDef {"type":"String","label":"Content Format","name":"contentFormat","defaultValue":"Markdown","uiComponent":{"type":"DROPDOWN","options":{"values":["Markdown","HTML"]}},"description":"Format of the Content field. Defaults to Markdown."}
   *
   * @returns {Object}
   * @sampleResult {"requestId":"abc-123-def","id":"canvas-new123","browserLink":"https://coda.io/d/_dAbCDeFGH#_sunew123"}
   */
  async createPage(docId, name, subtitle, content, contentFormat) {
    const body = clean({ name, subtitle })

    if (content) {
      body.pageContent = {
        type: 'canvas',
        canvasContent: {
          format: this.#resolveContentFormat(contentFormat),
          content,
        },
      }
    }

    return this.#apiRequest({
      logTag: '[createPage]',
      url: `${ API_BASE_URL }/docs/${ encodeURIComponent(docId) }/pages`,
      method: 'post',
      body,
    })
  }

  #resolveContentFormat(value) {
    const mapping = { Markdown: 'markdown', HTML: 'html' }

    if (value === undefined || value === null || value === '') {
      return 'markdown'
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Dictionaries
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * @typedef {Object} getDocsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter docs by title."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token from a previous response for retrieving the next page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Docs Dictionary
   * @description Provides a searchable list of docs for selecting a doc in dependent parameters. The option value is the doc ID.
   * @route POST /get-docs-dictionary
   *
   * @paramDef {"type":"getDocsDictionary__payload","label":"Payload","name":"payload","description":"Contains the optional search string and pagination cursor for filtering docs."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Project Tracker","value":"AbCDeFGH","note":"Owned by user@example.com"}],"cursor":"eyJsaW1pdCI6MjV9"}
   */
  async getDocsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getDocsDictionary]',
      url: `${ API_BASE_URL }/docs`,
      query: { query: search, pageToken: cursor, limit: 25 },
    })

    return {
      items: (response.items || []).map(doc => ({
        label: doc.name,
        value: doc.id,
        note: doc.owner ? `Owned by ${ doc.owner }` : undefined,
      })),
      cursor: response.nextPageToken || undefined,
    }
  }

  /**
   * @typedef {Object} getTablesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Doc ID","name":"docId","required":true,"description":"The doc whose tables to list."}
   */

  /**
   * @typedef {Object} getTablesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter tables by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token from a previous response for retrieving the next page."}
   * @paramDef {"type":"getTablesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required context: the doc ID whose tables to list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tables Dictionary
   * @description Provides a searchable list of tables and views in a doc for selecting a table in dependent parameters. Requires a doc ID. The option value is the table ID.
   * @route POST /get-tables-dictionary
   *
   * @paramDef {"type":"getTablesDictionary__payload","label":"Payload","name":"payload","description":"Contains the search string, pagination cursor, and criteria (doc ID) for listing tables."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Tasks","value":"grid-abc123","note":"table - 42 rows"}],"cursor":null}
   */
  async getTablesDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const docId = criteria?.docId

    if (!docId) {
      return { items: [], cursor: undefined }
    }

    const response = await this.#apiRequest({
      logTag: '[getTablesDictionary]',
      url: `${ API_BASE_URL }/docs/${ encodeURIComponent(docId) }/tables`,
      query: { tableTypes: 'table', pageToken: cursor, limit: 25 },
    })

    let items = (response.items || []).map(table => ({
      label: table.name,
      value: table.id,
      note: [table.tableType, table.rowCount !== undefined ? `${ table.rowCount } rows` : null].filter(Boolean).join(' - ') || undefined,
    }))

    if (search) {
      const term = search.toLowerCase()
      items = items.filter(item => item.label.toLowerCase().includes(term))
    }

    return { items, cursor: response.nextPageToken || undefined }
  }

  /**
   * @typedef {Object} getColumnsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Doc ID","name":"docId","required":true,"description":"The doc that contains the table."}
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"description":"The table whose columns to list."}
   */

  /**
   * @typedef {Object} getColumnsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter columns by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token from a previous response for retrieving the next page."}
   * @paramDef {"type":"getColumnsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required context: the doc ID and table ID whose columns to list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Columns Dictionary
   * @description Provides a searchable list of columns in a table for selecting a column in dependent parameters. Requires a doc ID and table ID. The option value is the column ID.
   * @route POST /get-columns-dictionary
   *
   * @paramDef {"type":"getColumnsDictionary__payload","label":"Payload","name":"payload","description":"Contains the search string, pagination cursor, and criteria (doc ID and table ID) for listing columns."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Status","value":"c-status","note":"select"}],"cursor":null}
   */
  async getColumnsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const docId = criteria?.docId
    const tableId = criteria?.tableId

    if (!docId || !tableId) {
      return { items: [], cursor: undefined }
    }

    const response = await this.#apiRequest({
      logTag: '[getColumnsDictionary]',
      url: `${ API_BASE_URL }/docs/${ encodeURIComponent(docId) }/tables/${ encodeURIComponent(tableId) }/columns`,
      query: { pageToken: cursor, limit: 50 },
    })

    let items = (response.items || []).map(column => ({
      label: column.name,
      value: column.id,
      note: column.format?.type || undefined,
    }))

    if (search) {
      const term = search.toLowerCase()
      items = items.filter(item => item.label.toLowerCase().includes(term))
    }

    return { items, cursor: response.nextPageToken || undefined }
  }
}

Flowrunner.ServerCode.addService(Coda, [
  {
    name: 'apiToken',
    displayName: 'API Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Coda API token, sent as a Bearer token. Generate it in Coda under Account Settings → API Settings → Generate API token.',
  },
])
