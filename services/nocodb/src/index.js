'use strict'

const logger = {
  info: (...args) => console.log('[NocoDB] info:', ...args),
  debug: (...args) => console.log('[NocoDB] debug:', ...args),
  error: (...args) => console.log('[NocoDB] error:', ...args),
  warn: (...args) => console.log('[NocoDB] warn:', ...args),
}

/**
 * @integrationName NocoDB
 * @integrationIcon /icon.png
 */
class NocoDB {
  constructor(config) {
    // Strip any trailing slash so path concatenation stays clean.
    this.baseUrl = (config.baseUrl || '').replace(/\/+$/, '')
    this.apiToken = config.apiToken
  }

  #apiBase() {
    return `${ this.baseUrl }/api/v2`
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ 'xc-token': this.apiToken, 'Content-Type': 'application/json' })
        .query(query || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const errorBody = error.body || {}
      const message = errorBody.msg || errorBody.message || errorBody.error || error.message

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`NocoDB API error: ${ message }`)
    }
  }

  // Normalizes a value that may arrive as a single object/id or an array into an array.
  #toArray(value) {
    if (value === undefined || value === null) {
      return []
    }

    return Array.isArray(value) ? value : [value]
  }

  // ========================================== DICTIONARIES ===========================================

  /**
   * @typedef {Object} getBasesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied locally to base titles."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Bases Dictionary
   * @description Lists NocoDB bases (projects) accessible with the configured API token, for selection in dependent parameters. Supports optional local search filtering by title.
   * @category Bases & Tables
   * @route POST /get-bases-dictionary
   * @paramDef {"type":"getBasesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"CRM","value":"p_abc123","note":"ID: p_abc123"}]}
   */
  async getBasesDictionary(payload) {
    const { search } = payload || {}

    const result = await this.#apiRequest({
      logTag: 'getBasesDictionary',
      url: `${ this.#apiBase() }/meta/bases/`,
    })

    const bases = result?.list || []
    const filtered = search
      ? bases.filter(base => `${ base.title || '' }`.toLowerCase().includes(search.toLowerCase()))
      : bases

    return {
      items: filtered.map(base => ({
        label: base.title || '[untitled]',
        value: base.id,
        note: `ID: ${ base.id }`,
      })),
    }
  }

  /**
   * @typedef {Object} getTablesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Base ID","name":"baseId","required":true,"description":"Identifier of the base whose tables should be listed."}
   */

  /**
   * @typedef {Object} getTablesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied locally to table titles."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   * @paramDef {"type":"getTablesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the base whose tables are listed."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tables Dictionary
   * @description Lists tables within a NocoDB base for selection in dependent parameters. Values returned are table IDs used by the Records API. Supports optional local search filtering by title.
   * @category Bases & Tables
   * @route POST /get-tables-dictionary
   * @paramDef {"type":"getTablesDictionary__payload","label":"Payload","name":"payload","description":"Base criteria, search text, and pagination cursor input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Contacts","value":"m_xyz789","note":"ID: m_xyz789"}]}
   */
  async getTablesDictionary(payload) {
    const { search, criteria } = payload || {}
    const { baseId } = criteria || {}

    const result = await this.#apiRequest({
      logTag: 'getTablesDictionary',
      url: `${ this.#apiBase() }/meta/bases/${ baseId }/tables`,
    })

    const tables = result?.list || []
    const filtered = search
      ? tables.filter(table => `${ table.title || '' }`.toLowerCase().includes(search.toLowerCase()))
      : tables

    return {
      items: filtered.map(table => ({
        label: table.title || '[untitled]',
        value: table.id,
        note: `ID: ${ table.id }`,
      })),
    }
  }

  /**
   * @typedef {Object} getFieldsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"description":"Identifier of the table whose fields (columns) should be listed."}
   */

  /**
   * @typedef {Object} getFieldsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied locally to field titles."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   * @paramDef {"type":"getFieldsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the table whose fields are listed."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Fields Dictionary
   * @description Lists fields (columns) of a NocoDB table, derived from the table's metadata, for selection in dependent parameters. Values returned are field titles. Supports optional local search filtering.
   * @category Fields
   * @route POST /get-fields-dictionary
   * @paramDef {"type":"getFieldsDictionary__payload","label":"Payload","name":"payload","description":"Table criteria, search text, and pagination cursor input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Name","value":"Name","note":"SingleLineText (ID: c_field1)"}]}
   */
  async getFieldsDictionary(payload) {
    const { search, criteria } = payload || {}
    const { tableId } = criteria || {}

    const table = await this.#apiRequest({
      logTag: 'getFieldsDictionary',
      url: `${ this.#apiBase() }/meta/tables/${ tableId }`,
    })

    const columns = table?.columns || []
    const filtered = search
      ? columns.filter(column => `${ column.title || '' }`.toLowerCase().includes(search.toLowerCase()))
      : columns

    return {
      items: filtered.map(column => ({
        label: column.title || '[untitled]',
        value: column.title,
        note: `${ column.uidt || 'Field' } (ID: ${ column.id })`,
      })),
    }
  }

  /**
   * @typedef {Object} getViewsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"description":"Identifier of the table whose views should be listed."}
   */

  /**
   * @typedef {Object} getViewsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied locally to view titles."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   * @paramDef {"type":"getViewsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the table whose views are listed."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Views Dictionary
   * @description Lists views of a NocoDB table for selection in dependent parameters. View IDs can be supplied to the List Records operation to constrain and order results according to a view. Supports optional local search filtering.
   * @category Views
   * @route POST /get-views-dictionary
   * @paramDef {"type":"getViewsDictionary__payload","label":"Payload","name":"payload","description":"Table criteria, search text, and pagination cursor input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Grid view","value":"v_abc123","note":"grid (ID: v_abc123)"}]}
   */
  async getViewsDictionary(payload) {
    const { search, criteria } = payload || {}
    const { tableId } = criteria || {}

    const result = await this.#apiRequest({
      logTag: 'getViewsDictionary',
      url: `${ this.#apiBase() }/meta/tables/${ tableId }/views`,
    })

    const views = result?.list || []
    const filtered = search
      ? views.filter(view => `${ view.title || '' }`.toLowerCase().includes(search.toLowerCase()))
      : views

    return {
      items: filtered.map(view => ({
        label: view.title || '[untitled]',
        value: view.id,
        note: `${ view.type || 'view' } (ID: ${ view.id })`,
      })),
    }
  }

  // ======================================= END OF DICTIONARIES =======================================

  // ============================================ RECORDS =============================================

  /**
   * @operationName List Records
   * @description Retrieves records from a NocoDB table with support for field selection, sorting, filtering, and pagination. The "where" parameter uses NocoDB filter syntax: each condition is written as (field,operator,value) and conditions are joined with ~and or ~or, for example (Status,eq,Active)~and(Age,gt,21). Common operators include eq, neq, gt, ge (>=), lt, le (<=), like, nlike, in, isnull, notnull, isblank, notblank. Returns the matching records along with pagination metadata (pageInfo).
   * @category Records
   * @route GET /records
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getTablesDictionary","description":"Identifier of the table to read records from (e.g. m_xyz789)."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"Comma-separated list of field titles to include, e.g. \"Name,Email,Status\". Leave blank to return all fields."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","description":"Comma-separated field titles to sort by. Prefix a field with '-' for descending order, e.g. \"-CreatedAt,Name\"."}
   * @paramDef {"type":"String","label":"Where","name":"where","description":"NocoDB filter expression, e.g. (Status,eq,Active)~and(Age,gt,21). See the operation description for supported operators."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of records to return (NocoDB default 25, maximum 1000)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records to skip for pagination (default 0)."}
   * @paramDef {"type":"String","label":"View ID","name":"viewId","dictionary":"getViewsDictionary","dependsOn":["tableId"],"description":"Optional view whose configured filters and sorts constrain the returned records."}
   * @returns {Object}
   * @sampleResult {"list":[{"Id":1,"Name":"John Doe","Status":"Active"}],"pageInfo":{"totalRows":1,"page":1,"pageSize":25,"isFirstPage":true,"isLastPage":true}}
   */
  async listRecords(tableId, fields, sort, where, limit, offset, viewId) {
    const query = {}

    if (fields) {
      query.fields = fields
    }

    if (sort) {
      query.sort = sort
    }

    if (where) {
      query.where = where
    }

    if (limit !== undefined && limit !== null && limit !== '') {
      query.limit = limit
    }

    if (offset !== undefined && offset !== null && offset !== '') {
      query.offset = offset
    }

    if (viewId) {
      query.viewId = viewId
    }

    return this.#apiRequest({
      logTag: 'listRecords',
      url: `${ this.#apiBase() }/tables/${ tableId }/records`,
      query,
    })
  }

  /**
   * @operationName Get Record
   * @description Retrieves a single record from a NocoDB table by its primary key value. Optionally limits the returned fields.
   * @category Records
   * @route GET /records/get
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getTablesDictionary","description":"Identifier of the table containing the record."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"description":"Primary key value of the record to retrieve."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"Comma-separated list of field titles to include. Leave blank to return all fields."}
   * @returns {Object}
   * @sampleResult {"Id":1,"Name":"John Doe","Email":"john@example.com","Status":"Active"}
   */
  async getRecord(tableId, recordId, fields) {
    const query = {}

    if (fields) {
      query.fields = fields
    }

    return this.#apiRequest({
      logTag: 'getRecord',
      url: `${ this.#apiBase() }/tables/${ tableId }/records/${ recordId }`,
      query,
    })
  }

  /**
   * @operationName Create Records
   * @description Inserts one or more records into a NocoDB table. Accepts either a single record object or an array of record objects, where each object maps field titles to values. Returns the identifiers of the created records.
   * @category Records
   * @route POST /records
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getTablesDictionary","description":"Identifier of the table to insert into."}
   * @paramDef {"type":"Object","label":"Records","name":"records","required":true,"description":"A single record object (e.g. {\"Name\":\"John\",\"Status\":\"Active\"}) or an array of such objects for bulk insertion."}
   * @returns {Array}
   * @sampleResult [{"Id":1}]
   */
  async createRecords(tableId, records) {
    return this.#apiRequest({
      logTag: 'createRecords',
      url: `${ this.#apiBase() }/tables/${ tableId }/records`,
      method: 'post',
      body: this.#toArray(records),
    })
  }

  /**
   * @operationName Update Records
   * @description Updates one or more existing records in a NocoDB table. Each record object must include the primary key field (typically "Id") together with the field values to change. Accepts a single object or an array of objects. Returns the identifiers of the updated records.
   * @category Records
   * @route PATCH /records
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getTablesDictionary","description":"Identifier of the table to update."}
   * @paramDef {"type":"Object","label":"Records","name":"records","required":true,"description":"A single record object including its Id (e.g. {\"Id\":1,\"Status\":\"Closed\"}) or an array of such objects for bulk updates."}
   * @returns {Array}
   * @sampleResult [{"Id":1}]
   */
  async updateRecords(tableId, records) {
    return this.#apiRequest({
      logTag: 'updateRecords',
      url: `${ this.#apiBase() }/tables/${ tableId }/records`,
      method: 'patch',
      body: this.#toArray(records),
    })
  }

  /**
   * @operationName Delete Records
   * @description Deletes one or more records from a NocoDB table by primary key. Accepts a single Id value, a single object containing an Id (e.g. {"Id":1}), or an array of either. Returns the identifiers of the deleted records.
   * @category Records
   * @route DELETE /records
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getTablesDictionary","description":"Identifier of the table to delete from."}
   * @paramDef {"type":"Object","label":"Record IDs","name":"recordIds","required":true,"description":"A single Id, a single {\"Id\":value} object, or an array of Ids/objects identifying the records to delete."}
   * @returns {Array}
   * @sampleResult [{"Id":1}]
   */
  async deleteRecords(tableId, recordIds) {
    const body = this.#toArray(recordIds).map(item => {
      return item !== null && typeof item === 'object' ? item : { Id: item }
    })

    return this.#apiRequest({
      logTag: 'deleteRecords',
      url: `${ this.#apiBase() }/tables/${ tableId }/records`,
      method: 'delete',
      body,
    })
  }

  /**
   * @operationName Count Records
   * @description Returns the number of records in a NocoDB table, optionally constrained by a "where" filter expression using NocoDB filter syntax, for example (Status,eq,Active)~and(Age,gt,21).
   * @category Records
   * @route GET /records/count
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getTablesDictionary","description":"Identifier of the table to count records in."}
   * @paramDef {"type":"String","label":"Where","name":"where","description":"Optional NocoDB filter expression to count only matching records, e.g. (Status,eq,Active)."}
   * @paramDef {"type":"String","label":"View ID","name":"viewId","dictionary":"getViewsDictionary","dependsOn":["tableId"],"description":"Optional view whose configured filters constrain the count."}
   * @returns {Object}
   * @sampleResult {"count":42}
   */
  async countRecords(tableId, where, viewId) {
    const query = {}

    if (where) {
      query.where = where
    }

    if (viewId) {
      query.viewId = viewId
    }

    return this.#apiRequest({
      logTag: 'countRecords',
      url: `${ this.#apiBase() }/tables/${ tableId }/records/count`,
      query,
    })
  }

  // ========================================= LINKED RECORDS =========================================

  /**
   * @operationName List Linked Records
   * @description Lists the records linked to a given record through a specific link (relation) field. Useful for reading the related rows on the far side of a linked-to-another-table relationship.
   * @category Linked Records
   * @route GET /links
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getTablesDictionary","description":"Identifier of the table that owns the link field."}
   * @paramDef {"type":"String","label":"Link Field ID","name":"linkFieldId","required":true,"dictionary":"getFieldsDictionary","dependsOn":["tableId"],"description":"Identifier of the link (relation) column on the table."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"description":"Primary key value of the record whose linked records are listed."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"Comma-separated field titles to include from the linked records. Leave blank to return all fields."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of linked records to return (NocoDB default 25, maximum 1000)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of linked records to skip for pagination (default 0)."}
   * @returns {Object}
   * @sampleResult {"list":[{"Id":5,"Name":"Related Row"}],"pageInfo":{"totalRows":1,"page":1,"pageSize":25,"isFirstPage":true,"isLastPage":true}}
   */
  async listLinkedRecords(tableId, linkFieldId, recordId, fields, limit, offset) {
    const query = {}

    if (fields) {
      query.fields = fields
    }

    if (limit !== undefined && limit !== null && limit !== '') {
      query.limit = limit
    }

    if (offset !== undefined && offset !== null && offset !== '') {
      query.offset = offset
    }

    return this.#apiRequest({
      logTag: 'listLinkedRecords',
      url: `${ this.#apiBase() }/tables/${ tableId }/links/${ linkFieldId }/records/${ recordId }`,
      query,
    })
  }

  /**
   * @operationName Link Records
   * @description Creates links between a source record and one or more target records through a link (relation) field. Accepts a single target Id, a single {"Id":value} object, or an array of either. Returns true on success.
   * @category Linked Records
   * @route POST /links
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getTablesDictionary","description":"Identifier of the table that owns the link field."}
   * @paramDef {"type":"String","label":"Link Field ID","name":"linkFieldId","required":true,"dictionary":"getFieldsDictionary","dependsOn":["tableId"],"description":"Identifier of the link (relation) column on the table."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"description":"Primary key value of the source record to link from."}
   * @paramDef {"type":"Object","label":"Target Record IDs","name":"targetRecordIds","required":true,"description":"A single target Id, a single {\"Id\":value} object, or an array of either identifying the records to link."}
   * @returns {Boolean}
   * @sampleResult true
   */
  async linkRecords(tableId, linkFieldId, recordId, targetRecordIds) {
    const body = this.#toArray(targetRecordIds).map(item => {
      return item !== null && typeof item === 'object' ? item : { Id: item }
    })

    return this.#apiRequest({
      logTag: 'linkRecords',
      url: `${ this.#apiBase() }/tables/${ tableId }/links/${ linkFieldId }/records/${ recordId }`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Unlink Records
   * @description Removes links between a source record and one or more target records through a link (relation) field. Accepts a single target Id, a single {"Id":value} object, or an array of either. Returns true on success.
   * @category Linked Records
   * @route DELETE /links
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getTablesDictionary","description":"Identifier of the table that owns the link field."}
   * @paramDef {"type":"String","label":"Link Field ID","name":"linkFieldId","required":true,"dictionary":"getFieldsDictionary","dependsOn":["tableId"],"description":"Identifier of the link (relation) column on the table."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"description":"Primary key value of the source record to unlink from."}
   * @paramDef {"type":"Object","label":"Target Record IDs","name":"targetRecordIds","required":true,"description":"A single target Id, a single {\"Id\":value} object, or an array of either identifying the records to unlink."}
   * @returns {Boolean}
   * @sampleResult true
   */
  async unlinkRecords(tableId, linkFieldId, recordId, targetRecordIds) {
    const body = this.#toArray(targetRecordIds).map(item => {
      return item !== null && typeof item === 'object' ? item : { Id: item }
    })

    return this.#apiRequest({
      logTag: 'unlinkRecords',
      url: `${ this.#apiBase() }/tables/${ tableId }/links/${ linkFieldId }/records/${ recordId }`,
      method: 'delete',
      body,
    })
  }

  // ========================================= BASES & TABLES =========================================

  /**
   * @operationName List Bases
   * @description Returns all NocoDB bases (projects) accessible with the configured API token, including their identifiers and titles.
   * @category Bases & Tables
   * @route GET /bases
   * @returns {Object}
   * @sampleResult {"list":[{"id":"p_abc123","title":"CRM","type":"database"}],"pageInfo":{"totalRows":1,"page":1,"pageSize":25,"isFirstPage":true,"isLastPage":true}}
   */
  async listBases() {
    return this.#apiRequest({
      logTag: 'listBases',
      url: `${ this.#apiBase() }/meta/bases/`,
    })
  }

  /**
   * @operationName Get Base
   * @description Retrieves the metadata of a single NocoDB base by its identifier.
   * @category Bases & Tables
   * @route GET /bases/get
   * @paramDef {"type":"String","label":"Base ID","name":"baseId","required":true,"dictionary":"getBasesDictionary","description":"Identifier of the base to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"p_abc123","title":"CRM","type":"database","meta":{}}
   */
  async getBase(baseId) {
    return this.#apiRequest({
      logTag: 'getBase',
      url: `${ this.#apiBase() }/meta/bases/${ baseId }`,
    })
  }

  /**
   * @operationName List Tables
   * @description Returns all tables belonging to a NocoDB base, including their identifiers and titles. Table identifiers are used by the Records API.
   * @category Bases & Tables
   * @route GET /tables
   * @paramDef {"type":"String","label":"Base ID","name":"baseId","required":true,"dictionary":"getBasesDictionary","description":"Identifier of the base whose tables are listed."}
   * @returns {Object}
   * @sampleResult {"list":[{"id":"m_xyz789","title":"Contacts","type":"table"}]}
   */
  async listTables(baseId) {
    return this.#apiRequest({
      logTag: 'listTables',
      url: `${ this.#apiBase() }/meta/bases/${ baseId }/tables`,
    })
  }

  /**
   * @operationName Get Table
   * @description Retrieves the full metadata of a NocoDB table, including its columns (fields) with their titles, identifiers, and data types. Useful for understanding table structure before reading or writing records.
   * @category Bases & Tables
   * @route GET /tables/get
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getTablesDictionary","description":"Identifier of the table to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"m_xyz789","title":"Contacts","columns":[{"id":"c_field1","title":"Name","uidt":"SingleLineText"}]}
   */
  async getTable(tableId) {
    return this.#apiRequest({
      logTag: 'getTable',
      url: `${ this.#apiBase() }/meta/tables/${ tableId }`,
    })
  }

  /**
   * @operationName Create Table
   * @description Creates a new table within a NocoDB base. Provide the table name and an array of column definitions. Each column object follows NocoDB's schema, for example {"title":"Name","uidt":"SingleLineText"}. Common uidt values include SingleLineText, LongText, Number, Decimal, Checkbox, Date, DateTime, Email, PhoneNumber and SingleSelect.
   * @category Bases & Tables
   * @route POST /tables
   * @paramDef {"type":"String","label":"Base ID","name":"baseId","required":true,"dictionary":"getBasesDictionary","description":"Identifier of the base in which to create the table."}
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"description":"Title of the new table."}
   * @paramDef {"type":"Array<Object>","label":"Columns","name":"columns","required":true,"description":"Array of column definition objects, e.g. [{\"title\":\"Name\",\"uidt\":\"SingleLineText\"},{\"title\":\"Age\",\"uidt\":\"Number\"}]."}
   * @returns {Object}
   * @sampleResult {"id":"m_new123","title":"Projects","columns":[{"id":"c_col1","title":"Name","uidt":"SingleLineText"}]}
   */
  async createTable(baseId, tableName, columns) {
    return this.#apiRequest({
      logTag: 'createTable',
      url: `${ this.#apiBase() }/meta/bases/${ baseId }/tables`,
      method: 'post',
      body: {
        table_name: tableName,
        title: tableName,
        columns: Array.isArray(columns) ? columns : [],
      },
    })
  }

  // ============================================= VIEWS =============================================

  /**
   * @operationName List Views
   * @description Returns all views defined on a NocoDB table, including their identifiers, titles, and types (grid, gallery, form, kanban, calendar). View identifiers can be supplied to the List Records and Count Records operations.
   * @category Views
   * @route GET /views
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getTablesDictionary","description":"Identifier of the table whose views are listed."}
   * @returns {Object}
   * @sampleResult {"list":[{"id":"v_abc123","title":"Grid view","type":"grid"}]}
   */
  async listViews(tableId) {
    return this.#apiRequest({
      logTag: 'listViews',
      url: `${ this.#apiBase() }/meta/tables/${ tableId }/views`,
    })
  }
}

Flowrunner.ServerCode.addService(NocoDB, [
  {
    name: 'baseUrl',
    displayName: 'Instance URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your NocoDB instance URL, e.g. https://app.nocodb.com (cloud) or https://nocodb.example.com (self-hosted). Any trailing slash is stripped automatically.',
  },
  {
    name: 'apiToken',
    displayName: 'API Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your NocoDB API token. Create one in NocoDB via your account menu, then Account Settings, then Tokens, then Create new token. Sent as the xc-token header.',
  },
])
