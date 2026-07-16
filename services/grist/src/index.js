'use strict'

const DEFAULT_BASE_URL = 'https://docs.getgrist.com'

const logger = {
  info: (...args) => console.log('[Grist] info:', ...args),
  debug: (...args) => console.log('[Grist] debug:', ...args),
  error: (...args) => console.log('[Grist] error:', ...args),
  warn: (...args) => console.log('[Grist] warn:', ...args),
}

/**
 * @integrationName Grist
 * @integrationIcon /icon.png
 */
class Grist {
  constructor(config) {
    const rawBaseUrl = (config.baseUrl || DEFAULT_BASE_URL).trim()

    // Strip any trailing slash so `${baseUrl}/api/...` never doubles up.
    this.baseUrl = rawBaseUrl.replace(/\/+$/, '')
    this.apiBase = `${ this.baseUrl }/api`
    this.apiKey = config.apiKey
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=[${ JSON.stringify(query || {}) }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ 'Authorization': `Bearer ${ this.apiKey }`, 'Content-Type': 'application/json' })
        .query(query || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const errorBody = error.body || {}
      const details = errorBody.details
        ? ` (${ typeof errorBody.details === 'string' ? errorBody.details : JSON.stringify(errorBody.details) })`
        : ''
      const message = `${ errorBody.error || error.message }${ details }`

      logger.error(`${ logTag } - failed [${ error.status || error.statusCode || '?' }]: ${ message }`)

      throw new Error(`Grist API error: ${ message }`)
    }
  }

  // Normalizes user-supplied "fields" input into an array of { fields } records.
  // Accepts a single plain object of column values, or an already-built array.
  #toRecordsArray(input) {
    if (Array.isArray(input)) {
      return input.map(item => {
        if (item && typeof item === 'object' && 'fields' in item) {
          return item
        }

        return { fields: item || {} }
      })
    }

    if (input && typeof input === 'object') {
      return [{ fields: input }]
    }

    return []
  }

  // ========================================== DICTIONARIES ===========================================

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

  #searchFilter(items, keys, search) {
    if (!search) {
      return items
    }

    const needle = String(search).toLowerCase()

    return items.filter(item => keys.some(key => String(item[key] ?? '').toLowerCase().includes(needle)))
  }

  async #listWorkspaces(orgId = 'current') {
    return this.#apiRequest({
      logTag: 'listWorkspaces',
      url: `${ this.apiBase }/orgs/${ orgId }/workspaces`,
    })
  }

  async #collectDocs(orgId = 'current') {
    const workspaces = await this.#listWorkspaces(orgId)
    const docs = []

    for (const workspace of workspaces || []) {
      for (const doc of workspace.docs || []) {
        docs.push({ id: doc.id, name: doc.name, workspace: workspace.name })
      }
    }

    return docs
  }

  /**
   * @typedef {Object} getDocsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text used to filter documents by name or ID. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Reserved pagination cursor. Grist returns all documents in one page, so this is unused."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Documents Dictionary
   * @description Lists Grist documents available in the current organization for selection in dependent parameters. Walks every workspace in the org and returns each document with its workspace as a note. Supports local search filtering by document name or ID.
   * @category Documents
   *
   * @route POST /get-docs-dictionary
   *
   * @paramDef {"type":"getDocsDictionary__payload","label":"Payload","name":"payload","description":"Optional search string and pagination cursor for retrieving and filtering documents."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Sales CRM","value":"abc123XyZ","note":"Workspace: Sales"}]}
   */
  async getDocsDictionary(payload) {
    const { search } = payload || {}
    const docs = await this.#collectDocs('current')
    const filtered = this.#searchFilter(docs, ['id', 'name'], search)

    return {
      items: filtered.map(doc => ({
        label: doc.name || '[unnamed]',
        value: doc.id,
        note: doc.workspace ? `Workspace: ${ doc.workspace }` : `ID: ${ doc.id }`,
      })),
    }
  }

  /**
   * @typedef {Object} getTablesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Document ID","name":"docId","required":true,"description":"Identifier of the Grist document whose tables will be listed."}
   */

  /**
   * @typedef {Object} getTablesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text used to filter tables by ID. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Reserved pagination cursor. Grist returns all tables in one page, so this is unused."}
   * @paramDef {"type":"getTablesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the Grist document whose tables should be listed."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tables Dictionary
   * @description Lists tables in a Grist document for selection in dependent parameters. In Grist the table ID doubles as its display name, so the label and value are identical. Supports local search filtering by table ID.
   * @category Tables
   *
   * @route POST /get-tables-dictionary
   *
   * @paramDef {"type":"getTablesDictionary__payload","label":"Payload","name":"payload","description":"Document ID plus optional search string for retrieving and filtering tables."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Contacts","value":"Contacts","note":"Table ID: Contacts"}]}
   */
  async getTablesDictionary(payload) {
    const { search, criteria } = payload || {}
    const docId = criteria?.docId

    const { tables } = await this.#apiRequest({
      logTag: 'getTablesDictionary',
      url: `${ this.apiBase }/docs/${ docId }/tables`,
    })

    const filtered = this.#searchFilter(tables || [], ['id'], search)

    return {
      items: filtered.map(({ id }) => ({
        label: id,
        value: id,
        note: `Table ID: ${ id }`,
      })),
    }
  }

  /**
   * @typedef {Object} getColumnsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Document ID","name":"docId","required":true,"description":"Identifier of the Grist document containing the table."}
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"description":"Identifier of the table whose columns will be listed."}
   */

  /**
   * @typedef {Object} getColumnsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text used to filter columns by ID or label. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Reserved pagination cursor. Grist returns all columns in one page, so this is unused."}
   * @paramDef {"type":"getColumnsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the document and table whose columns should be listed."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Columns Dictionary
   * @description Lists columns for a table in a Grist document for selection in dependent parameters. The value is the column ID used as the key inside record "fields" objects, while the label shows the human-friendly column label. Supports local search filtering by column ID or label.
   * @category Columns
   *
   * @route POST /get-columns-dictionary
   *
   * @paramDef {"type":"getColumnsDictionary__payload","label":"Payload","name":"payload","description":"Document ID, table ID, and optional search string for retrieving and filtering columns."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Full Name","value":"Name","note":"Type: Text"}]}
   */
  async getColumnsDictionary(payload) {
    const { search, criteria } = payload || {}
    const docId = criteria?.docId
    const tableId = criteria?.tableId

    const { columns } = await this.#apiRequest({
      logTag: 'getColumnsDictionary',
      url: `${ this.apiBase }/docs/${ docId }/tables/${ tableId }/columns`,
    })

    const normalized = (columns || []).map(column => ({
      id: column.id,
      label: column.fields?.label || column.id,
      type: column.fields?.type || 'Any',
    }))

    const filtered = this.#searchFilter(normalized, ['id', 'label'], search)

    return {
      items: filtered.map(column => ({
        label: column.label,
        value: column.id,
        note: `Type: ${ column.type }`,
      })),
    }
  }

  // ======================================= END OF DICTIONARIES =======================================

  // ============================================ RECORDS ==============================================

  /**
   * @description Retrieves records from a table in a Grist document. Each record is returned as an object with a numeric row "id" and a "fields" object keyed by column ID. Supports server-side filtering by exact column values, sorting, and a result limit. The filter expects a JSON object mapping column IDs to arrays of allowed values, for example {"Status":["Open","Pending"]}.
   *
   * @route GET /list-records
   * @operationName List Records
   * @category Records
   *
   * @paramDef {"type":"String","label":"Document ID","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The ID of the Grist document, taken from the document URL."}
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getTablesDictionary","dependsOn":["docId"],"description":"The ID of the table to read records from."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","description":"Optional exact-match filter as a JSON object mapping column IDs to arrays of allowed values. Example: {\"Status\":[\"Open\"],\"Owner\":[\"Alice\",\"Bob\"]}. Only records matching all specified columns are returned."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","description":"Optional comma-separated list of column IDs to sort by. Prefix a column with a minus sign for descending order, for example \"-Created,Name\"."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional maximum number of records to return. Omit to return all matching records."}
   *
   * @returns {Array<Object>} Array of records, each shaped as {"id":123,"fields":{...}}.
   * @sampleResult [{"id":1,"fields":{"Name":"Alice","Status":"Open"}},{"id":2,"fields":{"Name":"Bob","Status":"Pending"}}]
   */
  async listRecords(docId, tableId, filter, sort, limit) {
    const query = {}

    if (filter !== undefined && filter !== null && filter !== '') {
      query.filter = typeof filter === 'string' ? filter : JSON.stringify(filter)
    }

    if (sort) {
      query.sort = sort
    }

    if (limit !== undefined && limit !== null && limit !== '') {
      query.limit = limit
    }

    const result = await this.#apiRequest({
      logTag: 'listRecords',
      url: `${ this.apiBase }/docs/${ docId }/tables/${ tableId }/records`,
      query,
    })

    return result?.records || []
  }

  /**
   * @description Adds one or more records to a table in a Grist document. Provide a "fields" object mapping column IDs to values for a single record, or an array of such objects (or an array of {fields} records) to add several at once. Grist assigns each new record a numeric row ID and returns those IDs.
   *
   * @route POST /add-records
   * @operationName Add Records
   * @category Records
   *
   * @paramDef {"type":"String","label":"Document ID","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The ID of the Grist document."}
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getTablesDictionary","dependsOn":["docId"],"description":"The ID of the table to add records to."}
   * @paramDef {"type":"Object","label":"Fields or Records","name":"fields","required":true,"description":"Column values for the new record(s). Pass a single object like {\"Name\":\"Alice\",\"Status\":\"Open\"} to add one record, or an array of such objects to add many. Keys are column IDs."}
   *
   * @returns {Object} Object containing the created records with their assigned row IDs.
   * @sampleResult {"records":[{"id":11},{"id":12}]}
   */
  async addRecords(docId, tableId, fields) {
    const records = this.#toRecordsArray(fields)

    return this.#apiRequest({
      logTag: 'addRecords',
      url: `${ this.apiBase }/docs/${ docId }/tables/${ tableId }/records`,
      method: 'post',
      body: { records },
    })
  }

  /**
   * @description Updates existing records in a table in a Grist document. Provide an array of records, each with a numeric row "id" identifying the record and a "fields" object holding the column values to change. Only the supplied columns are modified; other columns are left untouched. Returns no body on success.
   *
   * @route PATCH /update-records
   * @operationName Update Records
   * @category Records
   *
   * @paramDef {"type":"String","label":"Document ID","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The ID of the Grist document."}
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getTablesDictionary","dependsOn":["docId"],"description":"The ID of the table containing the records to update."}
   * @paramDef {"type":"Array<Object>","label":"Records","name":"records","required":true,"description":"Array of records to update. Each item must include a numeric \"id\" (the row ID) and a \"fields\" object of column values to change, for example [{\"id\":5,\"fields\":{\"Status\":\"Closed\"}}]."}
   *
   * @returns {Object} Confirmation of the update with the count of records processed.
   * @sampleResult {"updated":2}
   */
  async updateRecords(docId, tableId, records) {
    if (!Array.isArray(records)) {
      throw new Error('The "records" parameter must be an array of {id, fields} objects.')
    }

    await this.#apiRequest({
      logTag: 'updateRecords',
      url: `${ this.apiBase }/docs/${ docId }/tables/${ tableId }/records`,
      method: 'patch',
      body: { records },
    })

    return { updated: records.length }
  }

  /**
   * @description Adds new records or updates existing ones (upsert) in a table in a Grist document. Each item has a "require" object identifying a record by column values and a "fields" object with the values to write. If a record matching every "require" column already exists it is updated with "fields"; otherwise a new record is created using both "require" and "fields". This makes it ideal for idempotent syncs keyed on a unique column such as an email or external ID.
   *
   * @route PUT /add-or-update-records
   * @operationName Add or Update Records
   * @category Records
   *
   * @paramDef {"type":"String","label":"Document ID","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The ID of the Grist document."}
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getTablesDictionary","dependsOn":["docId"],"description":"The ID of the table to upsert records into."}
   * @paramDef {"type":"Array<Object>","label":"Records","name":"records","required":true,"description":"Array of upsert items. Each item has \"require\" (column values that identify a record) and \"fields\" (column values to write). Example: [{\"require\":{\"Email\":\"a@x.com\"},\"fields\":{\"Name\":\"Alice\"}}]."}
   * @paramDef {"type":"Boolean","label":"Do Not Add","name":"noAdd","uiComponent":{"type":"TOGGLE"},"description":"When enabled, existing matches are updated but no new records are created for items that do not match."}
   * @paramDef {"type":"Boolean","label":"Do Not Update","name":"noUpdate","uiComponent":{"type":"TOGGLE"},"description":"When enabled, missing records are added but existing matches are left unchanged."}
   *
   * @returns {Object} Confirmation of the upsert with the count of records processed.
   * @sampleResult {"processed":3}
   */
  async addOrUpdateRecords(docId, tableId, records, noAdd, noUpdate) {
    if (!Array.isArray(records)) {
      throw new Error('The "records" parameter must be an array of {require, fields} objects.')
    }

    const query = {}

    if (noAdd) {
      query.noadd = true
    }

    if (noUpdate) {
      query.noupdate = true
    }

    await this.#apiRequest({
      logTag: 'addOrUpdateRecords',
      url: `${ this.apiBase }/docs/${ docId }/tables/${ tableId }/records`,
      method: 'put',
      query,
      body: { records },
    })

    return { processed: records.length }
  }

  /**
   * @description Deletes records from a table in a Grist document by their numeric row IDs. Provide an array of row IDs to remove. This operation is permanent, so the row IDs should be confirmed beforehand, typically via List Records. Returns no body on success.
   *
   * @route POST /delete-records
   * @operationName Delete Records
   * @category Records
   *
   * @paramDef {"type":"String","label":"Document ID","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The ID of the Grist document."}
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getTablesDictionary","dependsOn":["docId"],"description":"The ID of the table to delete records from."}
   * @paramDef {"type":"Array<Number>","label":"Row IDs","name":"rowIds","required":true,"description":"Array of numeric row IDs to delete, for example [3,7,12]. Use List Records to look up row IDs."}
   *
   * @returns {Object} Confirmation of the deletion with the count of records removed.
   * @sampleResult {"deleted":3}
   */
  async deleteRecords(docId, tableId, rowIds) {
    if (!Array.isArray(rowIds) || rowIds.length === 0) {
      throw new Error('The "rowIds" parameter must be a non-empty array of numeric row IDs.')
    }

    await this.#apiRequest({
      logTag: 'deleteRecords',
      url: `${ this.apiBase }/docs/${ docId }/tables/${ tableId }/records/delete`,
      method: 'post',
      body: rowIds,
    })

    return { deleted: rowIds.length }
  }

  // ============================================= TABLES ==============================================

  /**
   * @description Lists all tables in a Grist document. Each table is returned with its ID, which in Grist doubles as the table's display name and is used as the tableId in record and column operations.
   *
   * @route GET /list-tables
   * @operationName List Tables
   * @category Tables
   *
   * @paramDef {"type":"String","label":"Document ID","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The ID of the Grist document whose tables to list."}
   *
   * @returns {Array<Object>} Array of tables, each with an "id" and metadata "fields".
   * @sampleResult [{"id":"Contacts","fields":{"tableRef":1}},{"id":"Deals","fields":{"tableRef":2}}]
   */
  async listTables(docId) {
    const result = await this.#apiRequest({
      logTag: 'listTables',
      url: `${ this.apiBase }/docs/${ docId }/tables`,
    })

    return result?.tables || []
  }

  /**
   * @description Creates a new table in a Grist document with a set of columns. The table ID becomes both the identifier and the display name. Each column is defined by an ID and a "fields" object holding at least a "label" and a "type" (for example Text, Numeric, Int, Bool, Date, DateTime, Choice, Ref). Grist automatically adds a manual sort column.
   *
   * @route POST /create-table
   * @operationName Create Table
   * @category Tables
   *
   * @paramDef {"type":"String","label":"Document ID","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The ID of the Grist document in which to create the table."}
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"description":"The ID and display name for the new table, for example \"Contacts\"."}
   * @paramDef {"type":"Array<Object>","label":"Columns","name":"columns","required":true,"description":"Array of column definitions. Each item has an \"id\" and a \"fields\" object with \"label\" and \"type\". Example: [{\"id\":\"Name\",\"fields\":{\"label\":\"Name\",\"type\":\"Text\"}}]."}
   *
   * @returns {Object} Object containing the created table with its ID.
   * @sampleResult {"tables":[{"id":"Contacts"}]}
   */
  async createTable(docId, tableId, columns) {
    const normalizedColumns = Array.isArray(columns) ? columns : []

    return this.#apiRequest({
      logTag: 'createTable',
      url: `${ this.apiBase }/docs/${ docId }/tables`,
      method: 'post',
      body: {
        tables: [
          {
            id: tableId,
            columns: normalizedColumns,
          },
        ],
      },
    })
  }

  /**
   * @description Renames a table in a Grist document. Because a Grist table's ID is also its display name, changing the table ID renames it. Provide the current table ID and the new table ID. Returns confirmation with the new ID.
   *
   * @route PATCH /modify-table
   * @operationName Modify Table
   * @category Tables
   *
   * @paramDef {"type":"String","label":"Document ID","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The ID of the Grist document containing the table."}
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getTablesDictionary","dependsOn":["docId"],"description":"The current ID of the table to modify."}
   * @paramDef {"type":"String","label":"New Table ID","name":"newTableId","required":true,"description":"The new ID and display name for the table."}
   *
   * @returns {Object} Confirmation with the new table ID.
   * @sampleResult {"tables":[{"id":"Customers"}]}
   */
  async modifyTable(docId, tableId, newTableId) {
    await this.#apiRequest({
      logTag: 'modifyTable',
      url: `${ this.apiBase }/docs/${ docId }/tables`,
      method: 'patch',
      body: {
        tables: [
          {
            id: tableId,
            fields: { tableId: newTableId },
          },
        ],
      },
    })

    return { tables: [{ id: newTableId }] }
  }

  // ============================================ COLUMNS ==============================================

  /**
   * @description Lists all columns of a table in a Grist document. Each column is returned with its ID and a "fields" object describing its label, type, and formula. The column ID is the key used inside record "fields" objects.
   *
   * @route GET /list-columns
   * @operationName List Columns
   * @category Columns
   *
   * @paramDef {"type":"String","label":"Document ID","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The ID of the Grist document."}
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getTablesDictionary","dependsOn":["docId"],"description":"The ID of the table whose columns to list."}
   *
   * @returns {Array<Object>} Array of columns, each with an "id" and a "fields" object.
   * @sampleResult [{"id":"Name","fields":{"label":"Name","type":"Text"}},{"id":"Age","fields":{"label":"Age","type":"Int"}}]
   */
  async listColumns(docId, tableId) {
    const result = await this.#apiRequest({
      logTag: 'listColumns',
      url: `${ this.apiBase }/docs/${ docId }/tables/${ tableId }/columns`,
    })

    return result?.columns || []
  }

  /**
   * @description Adds one or more columns to a table in a Grist document. Each column is defined by an ID and a "fields" object with at least a "label" and a "type" (for example Text, Numeric, Int, Bool, Date, DateTime, Choice, Ref). Returns the created columns.
   *
   * @route POST /add-columns
   * @operationName Add Columns
   * @category Columns
   *
   * @paramDef {"type":"String","label":"Document ID","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The ID of the Grist document."}
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getTablesDictionary","dependsOn":["docId"],"description":"The ID of the table to add columns to."}
   * @paramDef {"type":"Array<Object>","label":"Columns","name":"columns","required":true,"description":"Array of column definitions. Each item has an \"id\" and a \"fields\" object with \"label\" and \"type\". Example: [{\"id\":\"Email\",\"fields\":{\"label\":\"Email\",\"type\":\"Text\"}}]."}
   *
   * @returns {Object} Object containing the created columns.
   * @sampleResult {"columns":[{"id":"Email"}]}
   */
  async addColumns(docId, tableId, columns) {
    const normalizedColumns = Array.isArray(columns) ? columns : []

    return this.#apiRequest({
      logTag: 'addColumns',
      url: `${ this.apiBase }/docs/${ docId }/tables/${ tableId }/columns`,
      method: 'post',
      body: { columns: normalizedColumns },
    })
  }

  // ===================================== DOCUMENTS & WORKSPACES ======================================

  /**
   * @description Lists the workspaces in a Grist organization along with the documents inside each workspace. Use the organization ID or the keyword "current" to target the organization associated with the API key. Useful for discovering document IDs to use in record operations.
   *
   * @route GET /list-workspaces
   * @operationName List Workspaces
   * @category Documents & Workspaces
   *
   * @paramDef {"type":"String","label":"Organization ID","name":"orgId","defaultValue":"current","description":"The organization ID, or \"current\" for the org tied to the API key. Team sites use their subdomain as the org ID."}
   *
   * @returns {Array<Object>} Array of workspaces, each with an "id", "name", and nested "docs".
   * @sampleResult [{"id":42,"name":"Sales","docs":[{"id":"abc123XyZ","name":"Sales CRM"}]}]
   */
  async listWorkspaces(orgId) {
    return this.#listWorkspaces(orgId || 'current')
  }

  /**
   * @description Lists all documents in a Grist organization by walking every workspace and flattening their documents into a single array. Each document is returned with its ID, name, and the workspace it belongs to. Handy for finding the document ID that appears in a Grist document URL.
   *
   * @route GET /list-documents
   * @operationName List Documents
   * @category Documents & Workspaces
   *
   * @paramDef {"type":"String","label":"Organization ID","name":"orgId","defaultValue":"current","description":"The organization ID, or \"current\" for the org tied to the API key."}
   *
   * @returns {Array<Object>} Array of documents, each with "id", "name", and "workspace".
   * @sampleResult [{"id":"abc123XyZ","name":"Sales CRM","workspace":"Sales"}]
   */
  async listDocuments(orgId) {
    return this.#collectDocs(orgId || 'current')
  }

  /**
   * @description Retrieves metadata for a single Grist document, including its name, workspace, access level, and timestamps. The document ID is the identifier that appears in the document URL.
   *
   * @route GET /get-document
   * @operationName Get Document
   * @category Documents & Workspaces
   *
   * @paramDef {"type":"String","label":"Document ID","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The ID of the Grist document to retrieve, taken from the document URL."}
   *
   * @returns {Object} The document metadata object.
   * @sampleResult {"id":"abc123XyZ","name":"Sales CRM","access":"owners","isPinned":false}
   */
  async getDocument(docId) {
    return this.#apiRequest({
      logTag: 'getDocument',
      url: `${ this.apiBase }/docs/${ docId }`,
    })
  }

  // ============================================== SQL ===============================================

  /**
   * @description Runs a read-only SQL SELECT query against a Grist document and returns the matching rows. Grist exposes each table as a SQLite table named after its table ID, so you can join tables, aggregate, and filter with standard SQLite syntax. Only SELECT statements are permitted; write statements are rejected. Results are returned as records shaped like {"fields":{...}}.
   *
   * @route GET /query-with-sql
   * @operationName Query with SQL
   * @category SQL
   *
   * @paramDef {"type":"String","label":"Document ID","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The ID of the Grist document to query."}
   * @paramDef {"type":"String","label":"SQL Query","name":"query","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A read-only SQL SELECT statement over the document's tables, for example: SELECT Name, Status FROM Contacts WHERE Status = 'Open'. Table and column names are the Grist table and column IDs."}
   *
   * @returns {Array<Object>} Array of result records, each shaped as {"fields":{...}}.
   * @sampleResult [{"fields":{"Name":"Alice","Status":"Open"}},{"fields":{"Name":"Bob","Status":"Open"}}]
   */
  async queryWithSql(docId, query) {
    if (!query || !String(query).trim()) {
      throw new Error('A non-empty SQL SELECT query is required.')
    }

    const result = await this.#apiRequest({
      logTag: 'queryWithSql',
      url: `${ this.apiBase }/docs/${ docId }/sql`,
      query: { q: query },
    })

    return result?.records || []
  }

  // ========================================== ATTACHMENTS ============================================

  /**
   * @description Lists metadata for attachments stored in a Grist document, such as file name, size, and MIME type. Attachments in Grist are files referenced by Attachment-type columns. Uploading attachments is not supported by this integration.
   *
   * @route GET /list-attachments
   * @operationName List Attachments
   * @category Attachments
   *
   * @paramDef {"type":"String","label":"Document ID","name":"docId","required":true,"dictionary":"getDocsDictionary","description":"The ID of the Grist document whose attachments to list."}
   *
   * @returns {Array<Object>} Array of attachment metadata records with "id" and "fields".
   * @sampleResult [{"id":1,"fields":{"fileName":"invoice.pdf","fileSize":20481,"mimeType":"application/pdf"}}]
   */
  async listAttachments(docId) {
    const result = await this.#apiRequest({
      logTag: 'listAttachments',
      url: `${ this.apiBase }/docs/${ docId }/attachments`,
    })

    return result?.records || []
  }
}

Flowrunner.ServerCode.addService(Grist, [
  {
    name: 'baseUrl',
    displayName: 'Base URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    defaultValue: DEFAULT_BASE_URL,
    hint: 'Grist base URL. Team sites use https://{team}.getgrist.com; self-hosted set your own URL. ' +
      'Defaults to https://docs.getgrist.com. Do not include a trailing slash.',
  },
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Grist API key from Profile Settings > API Key.',
  },
])
