'use strict'

const API_BASE_URL = 'https://api.quickbase.com/v1'

const logger = {
  info: (...args) => console.log('[Quick Base] info:', ...args),
  debug: (...args) => console.log('[Quick Base] debug:', ...args),
  error: (...args) => console.log('[Quick Base] error:', ...args),
  warn: (...args) => console.log('[Quick Base] warn:', ...args),
}

// Maps the friendly Field Type dropdown labels to Quick Base API fieldType tokens.
const FIELD_TYPE_MAP = {
  'Text': 'text',
  'Text - Multiple Choice': 'text-multiple-choice',
  'Rich Text': 'rich-text',
  'Numeric': 'numeric',
  'Currency': 'currency',
  'Percent': 'percent',
  'Rating': 'rating',
  'Date': 'date',
  'Date / Time': 'datetime',
  'Time of Day': 'timeofday',
  'Duration': 'duration',
  'Checkbox': 'checkbox',
  'Phone Number': 'phone',
  'Email': 'email',
  'URL': 'url',
  'User': 'user',
  'List - User': 'multiuser',
  'Address': 'address',
  'File Attachment': 'file',
}

/**
 * @integrationName Quick Base
 * @integrationIcon /icon.svg
 * @usesFileStorage
 */
class QuickBase {
  constructor(config) {
    this.userToken = config.userToken
    this.realmHostname = config.realmHostname
  }

  #headers() {
    return {
      'Authorization': `QB-USER-TOKEN ${ this.userToken }`,
      'QB-Realm-Hostname': this.realmHostname,
      'Content-Type': 'application/json',
    }
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set(this.#headers())
        .query(query || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const body = error.body || {}
      const message = body.message || error.message
      const description = body.description ? ` - ${ body.description }` : ''

      logger.error(`${ logTag } - failed: ${ message }${ description }`)

      throw new Error(`Quick Base API error: ${ message }${ description }`)
    }
  }

  // Maps a friendly dropdown label to its API value; passes through unknown values unchanged.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
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

  /**
   * @typedef {Object} getTablesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"App ID","name":"appId","required":true,"description":"The Quick Base application ID (dbid) whose tables should be listed. Found in the app URL after /db/."}
   */

  /**
   * @typedef {Object} getTablesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied locally to table names and IDs."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused; Quick Base returns all tables in one response)."}
   * @paramDef {"type":"getTablesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the Quick Base application whose tables should be listed."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tables Dictionary
   * @description Lists the tables in a Quick Base application for selection in dependent parameters. Each item's value is the table ID (dbid) used by record, field, and report operations.
   * @category Tables
   *
   * @route POST /get-tables-dictionary
   *
   * @paramDef {"type":"getTablesDictionary__payload","label":"Payload","name":"payload","description":"Application ID plus optional search and pagination input."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Tasks","value":"bqr5abcd1","note":"ID: bqr5abcd1"}]}
   */
  async getTablesDictionary(payload) {
    const { search, criteria } = payload || {}
    const appId = criteria?.appId

    const tables = await this.#apiRequest({
      logTag: 'getTablesDictionary',
      url: `${ API_BASE_URL }/tables`,
      query: { appId },
    })

    const term = (search || '').toLowerCase()
    const filtered = term
      ? (tables || []).filter(t => `${ t.name } ${ t.id }`.toLowerCase().includes(term))
      : (tables || [])

    return {
      items: filtered.map(table => ({
        label: table.name || '[unnamed table]',
        value: table.id,
        note: `ID: ${ table.id }`,
      })),
    }
  }

  /**
   * @typedef {Object} getFieldsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"description":"The Quick Base table ID (dbid) whose fields should be listed."}
   */

  /**
   * @typedef {Object} getFieldsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied locally to field labels and field IDs."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused; Quick Base returns all fields in one response)."}
   * @paramDef {"type":"getFieldsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the table whose fields should be listed."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Fields Dictionary
   * @description Lists the fields of a Quick Base table, mapping each field label to its numeric field ID (fid). Quick Base keys records by fid, not by field name, so use this dictionary to discover the fids you must supply in the Select, Where, and Data parameters of record operations.
   * @category Fields
   *
   * @route POST /get-fields-dictionary
   *
   * @paramDef {"type":"getFieldsDictionary__payload","label":"Payload","name":"payload","description":"Table ID plus optional search and pagination input."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Record ID#","value":"3","note":"fid: 3 (recordid)"},{"label":"Title","value":"6","note":"fid: 6 (text)"}]}
   */
  async getFieldsDictionary(payload) {
    const { search, criteria } = payload || {}
    const tableId = criteria?.tableId

    const fields = await this.#apiRequest({
      logTag: 'getFieldsDictionary',
      url: `${ API_BASE_URL }/fields`,
      query: { tableId },
    })

    const term = (search || '').toLowerCase()
    const filtered = term
      ? (fields || []).filter(f => `${ f.label } ${ f.id }`.toLowerCase().includes(term))
      : (fields || [])

    return {
      items: filtered.map(field => ({
        label: field.label || `[field ${ field.id }]`,
        value: String(field.id),
        note: `fid: ${ field.id }${ field.fieldType ? ` (${ field.fieldType })` : '' }`,
      })),
    }
  }

  /**
   * @typedef {Object} getAppTablesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"App ID","name":"appId","required":true,"description":"The Quick Base application ID (dbid) whose tables should be listed."}
   */

  /**
   * @typedef {Object} getAppTablesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied locally to table names and IDs."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused)."}
   * @paramDef {"type":"getAppTablesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the Quick Base application whose tables should be listed."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get App Tables Dictionary
   * @description Lists the tables in a Quick Base application by application ID. Alias of the tables dictionary provided for selecting a table when only an app ID is known (for example after Get App).
   * @category Apps
   *
   * @route POST /get-app-tables-dictionary
   *
   * @paramDef {"type":"getAppTablesDictionary__payload","label":"Payload","name":"payload","description":"Application ID plus optional search and pagination input."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Projects","value":"bqr5abcd1","note":"ID: bqr5abcd1"}]}
   */
  async getAppTablesDictionary(payload) {
    return this.getTablesDictionary(payload)
  }

  // ======================================= END OF DICTIONARIES =======================================

  // ============================================= RECORDS =============================================

  /**
   * @description Queries records from a Quick Base table using the Quick Base query language. Records are keyed by numeric field IDs (fids), so the Select parameter is an array of fids and the returned data is keyed by fid, e.g. {"6": {"value": "Task A"}}. The Where clause uses the Quick Base query syntax {fid.OPERATOR.'value'} joined with AND / OR — supported operators include EX (equals), XEX (not equals), CT (contains), XCT (not contains), SW (starts with), XSW (does not start with), GT / GTE / LT / LTE (numeric comparisons), BF / OBF / AF / OAF (date before / on-or-before / after / on-or-after), IR / XIR (date in / not in range), HAS / XHAS (user-list membership) and TV (compares underlying keys). Operators must be uppercase. Use the Get Fields Dictionary to look up fids. Optionally set Map Field Labels to also return a fieldLabels map (fid -> label) for readability.
   *
   * @route POST /records/query
   * @operationName Query Records
   * @category Records
   *
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"description":"The table ID (dbid) to query. Find it in the Quick Base table URL after /db/, or use the List Tables / Get Tables Dictionary operations."}
   * @paramDef {"type":"Array<String>","label":"Select (Field IDs)","name":"select","description":"Array of numeric field IDs (fids) to return, e.g. [\"3\",\"6\",\"7\"]. Omit to return the table's default report columns. Use Get Fields Dictionary to look up fids."}
   * @paramDef {"type":"String","label":"Where","name":"where","description":"Quick Base query, e.g. {6.CT.'urgent'}AND{7.GT.'100'}. Omit to return all records. Operators: EX, XEX, CT, XCT, SW, XSW, GT, GTE, LT, LTE, BF, OBF, AF, OAF, IR, XIR, HAS, XHAS, TV (uppercase)."}
   * @paramDef {"type":"Array<Object>","label":"Sort By","name":"sortBy","description":"Array of sort clauses, each {\"fieldId\":<fid>,\"order\":\"ASC\"|\"DESC\"}, e.g. [{\"fieldId\":6,\"order\":\"DESC\"}]."}
   * @paramDef {"type":"Array<Object>","label":"Group By","name":"groupBy","description":"Array of grouping clauses, each {\"fieldId\":<fid>,\"grouping\":\"equal-values\"}."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records to skip for pagination (default 0)."}
   * @paramDef {"type":"Number","label":"Top","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of records to return in this page (Quick Base default and max is typically up to a few thousand)."}
   * @paramDef {"type":"Boolean","label":"Map Field Labels","name":"mapFieldLabels","uiComponent":{"type":"TOGGLE"},"description":"When enabled, also returns a fieldLabels object mapping each returned fid to its human-readable field label."}
   *
   * @returns {Object} Object with data (array of fid-keyed records), fields (metadata for returned fields), metadata (numRecords, numFields, skip, top, totalRecords), and optionally fieldLabels.
   * @sampleResult {"data":[{"3":{"value":1},"6":{"value":"Task A"}}],"fields":[{"id":3,"label":"Record ID#","type":"recordid"},{"id":6,"label":"Title","type":"text"}],"metadata":{"numFields":2,"numRecords":1,"skip":0,"totalRecords":1}}
   */
  async queryRecords(tableId, select, where, sortBy, groupBy, skip, top, mapFieldLabels) {
    const options = {}

    if (skip !== undefined && skip !== null) {
      options.skip = skip
    }

    if (top !== undefined && top !== null) {
      options.top = top
    }

    const body = { from: tableId }

    if (Array.isArray(select) && select.length) {
      body.select = select.map(fid => Number(fid))
    }

    if (where) {
      body.where = where
    }

    if (Array.isArray(sortBy) && sortBy.length) {
      body.sortBy = sortBy
    }

    if (Array.isArray(groupBy) && groupBy.length) {
      body.groupBy = groupBy
    }

    if (Object.keys(options).length) {
      body.options = options
    }

    const result = await this.#apiRequest({
      logTag: 'queryRecords',
      url: `${ API_BASE_URL }/records/query`,
      method: 'post',
      body,
    })

    if (mapFieldLabels) {
      const fieldLabels = {}

      for (const field of result?.fields || []) {
        fieldLabels[String(field.id)] = field.label
      }

      return { ...result, fieldLabels }
    }

    return result
  }

  /**
   * @description Inserts or updates records in a Quick Base table. Records are keyed by numeric field IDs (fids); each record in Data is an object of the form {"<fid>": {"value": <value>}}, e.g. [{"6": {"value": "Task A"}, "7": {"value": 100}}]. To UPDATE existing records, include the record's key field in each record's data and set Merge Field ID to that key field's fid (defaults to the table's built-in Record ID# field, fid 3); records whose key value matches an existing record are updated, others are inserted. Fields To Return is an array of fids to include for each affected record in the response.
   *
   * @route POST /records
   * @operationName Insert/Update Records
   * @category Records
   *
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"description":"The table ID (dbid) to insert or update records in. Find it in the Quick Base table URL after /db/, or use the List Tables / Get Tables Dictionary operations."}
   * @paramDef {"type":"Array<Object>","label":"Data","name":"data","required":true,"description":"Array of fid-keyed records, e.g. [{\"6\":{\"value\":\"Task A\"},\"7\":{\"value\":100}}]. Use Get Fields Dictionary to look up fids."}
   * @paramDef {"type":"Number","label":"Merge Field ID","name":"mergeFieldId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Field ID (fid) of a unique key field used to match existing records for upsert. Include this field's value in each record. Defaults to the built-in Record ID# field (fid 3) when omitted."}
   * @paramDef {"type":"Array<String>","label":"Fields To Return","name":"fieldsToReturn","description":"Array of numeric field IDs (fids) to return for each created or updated record, e.g. [\"3\",\"6\"]."}
   *
   * @returns {Object} Object with metadata (createdRecordIds, updatedRecordIds, unchangedRecordIds, totalNumberOfRecordsProcessed) and data (returned fields for affected records).
   * @sampleResult {"data":[{"3":{"value":1},"6":{"value":"Task A"}}],"metadata":{"createdRecordIds":[1],"lineErrors":{},"totalNumberOfRecordsProcessed":1,"unchangedRecordIds":[],"updatedRecordIds":[]}}
   */
  async upsertRecords(tableId, data, mergeFieldId, fieldsToReturn) {
    const body = {
      to: tableId,
      data: Array.isArray(data) ? data : [],
    }

    if (mergeFieldId !== undefined && mergeFieldId !== null) {
      body.mergeFieldId = Number(mergeFieldId)
    }

    if (Array.isArray(fieldsToReturn) && fieldsToReturn.length) {
      body.fieldsToReturn = fieldsToReturn.map(fid => Number(fid))
    }

    return this.#apiRequest({
      logTag: 'upsertRecords',
      url: `${ API_BASE_URL }/records`,
      method: 'post',
      body,
    })
  }

  /**
   * @description Deletes records from a Quick Base table that match a Quick Base query. The Where clause uses the Quick Base query syntax {fid.OPERATOR.'value'} joined with AND / OR, for example {3.EX.'42'} to delete the record whose Record ID# is 42, or {7.LT.'0'} to delete records where fid 7 is negative. To delete every record in the table use the query {3.GT.'0'}. Returns the number of records deleted.
   *
   * @route DELETE /records
   * @operationName Delete Records
   * @category Records
   *
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"description":"The table ID (dbid) to delete records from. Find it in the Quick Base table URL after /db/, or use the List Tables / Get Tables Dictionary operations."}
   * @paramDef {"type":"String","label":"Where","name":"where","required":true,"description":"Quick Base query selecting the records to delete, e.g. {3.EX.'42'}. Use {3.GT.'0'} to delete all records. Operators must be uppercase."}
   *
   * @returns {Object} Object with numberDeleted indicating how many records were removed.
   * @sampleResult {"numberDeleted":1}
   */
  async deleteRecords(tableId, where) {
    return this.#apiRequest({
      logTag: 'deleteRecords',
      url: `${ API_BASE_URL }/records`,
      method: 'delete',
      body: { from: tableId, where },
    })
  }

  // ============================================== TABLES =============================================

  /**
   * @description Lists all tables in a Quick Base application. Returns each table's ID (dbid), name, description, and key field ID. The table ID is required by record, field, and report operations.
   *
   * @route GET /tables
   * @operationName List Tables
   * @category Tables
   *
   * @paramDef {"type":"String","label":"App ID","name":"appId","required":true,"description":"The Quick Base application ID (dbid). Found in the app URL after /db/, e.g. bqr5abcd1."}
   *
   * @returns {Array<Object>} Array of table metadata objects.
   * @sampleResult [{"id":"bqr5abcd1","name":"Tasks","description":"Task tracking","keyFieldId":3,"singleRecordName":"Task"}]
   */
  async listTables(appId) {
    return this.#apiRequest({
      logTag: 'listTables',
      url: `${ API_BASE_URL }/tables`,
      query: { appId },
    })
  }

  /**
   * @description Retrieves metadata for a single Quick Base table, including its name, description, key field ID, default sort field, and record naming. Requires both the table ID and the ID of the application that owns it.
   *
   * @route GET /tables/{tableId}
   * @operationName Get Table
   * @category Tables
   *
   * @paramDef {"type":"String","label":"App ID","name":"appId","required":true,"description":"The Quick Base application ID (dbid) that owns the table."}
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getAppTablesDictionary","dependsOn":["appId"],"description":"The table ID (dbid) to retrieve."}
   *
   * @returns {Object} Table metadata object.
   * @sampleResult {"id":"bqr5abcd1","name":"Tasks","description":"Task tracking","keyFieldId":3,"singleRecordName":"Task","pluralRecordName":"Tasks"}
   */
  async getTable(appId, tableId) {
    return this.#apiRequest({
      logTag: 'getTable',
      url: `${ API_BASE_URL }/tables/${ tableId }`,
      query: { appId },
    })
  }

  /**
   * @description Creates a new table in a Quick Base application. A table is created with default built-in fields (such as Record ID# and Date Created); use Create Field afterward to add custom fields. Returns the new table's metadata including its ID (dbid).
   *
   * @route POST /tables
   * @operationName Create Table
   * @category Tables
   *
   * @paramDef {"type":"String","label":"App ID","name":"appId","required":true,"description":"The Quick Base application ID (dbid) in which to create the table."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the new table."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description of the table's purpose."}
   * @paramDef {"type":"String","label":"Single Record Name","name":"singleRecordName","description":"Optional singular noun for a record in this table, e.g. Task."}
   * @paramDef {"type":"String","label":"Plural Record Name","name":"pluralRecordName","description":"Optional plural noun for records in this table, e.g. Tasks."}
   *
   * @returns {Object} The newly created table's metadata.
   * @sampleResult {"id":"bqr5abcd2","name":"Invoices","description":"","keyFieldId":3,"singleRecordName":"Invoice","pluralRecordName":"Invoices"}
   */
  async createTable(appId, name, description, singleRecordName, pluralRecordName) {
    const body = { name }

    if (description) {
      body.description = description
    }

    if (singleRecordName) {
      body.singleRecordName = singleRecordName
    }

    if (pluralRecordName) {
      body.pluralRecordName = pluralRecordName
    }

    return this.#apiRequest({
      logTag: 'createTable',
      url: `${ API_BASE_URL }/tables`,
      method: 'post',
      query: { appId },
      body,
    })
  }

  /**
   * @description Updates the name, description, or record naming of an existing Quick Base table. Only the provided values are changed; omitted values are left unchanged.
   *
   * @route POST /tables/{tableId}
   * @operationName Update Table
   * @category Tables
   *
   * @paramDef {"type":"String","label":"App ID","name":"appId","required":true,"description":"The Quick Base application ID (dbid) that owns the table."}
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getAppTablesDictionary","dependsOn":["appId"],"description":"The table ID (dbid) to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Optional new table name. Leave blank to keep the current name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional new description. Leave blank to keep the current description."}
   * @paramDef {"type":"String","label":"Single Record Name","name":"singleRecordName","description":"Optional new singular record noun."}
   * @paramDef {"type":"String","label":"Plural Record Name","name":"pluralRecordName","description":"Optional new plural record noun."}
   *
   * @returns {Object} The updated table's metadata.
   * @sampleResult {"id":"bqr5abcd1","name":"Tasks (Renamed)","description":"Updated","keyFieldId":3,"singleRecordName":"Task","pluralRecordName":"Tasks"}
   */
  async updateTable(appId, tableId, name, description, singleRecordName, pluralRecordName) {
    const body = {}

    if (name) {
      body.name = name
    }

    if (description !== undefined && description !== null && description !== '') {
      body.description = description
    }

    if (singleRecordName) {
      body.singleRecordName = singleRecordName
    }

    if (pluralRecordName) {
      body.pluralRecordName = pluralRecordName
    }

    return this.#apiRequest({
      logTag: 'updateTable',
      url: `${ API_BASE_URL }/tables/${ tableId }`,
      method: 'post',
      query: { appId },
      body,
    })
  }

  /**
   * @description Permanently deletes a Quick Base table and all of its records. This action cannot be undone. Returns the ID of the deleted table.
   *
   * @route DELETE /tables/{tableId}
   * @operationName Delete Table
   * @category Tables
   *
   * @paramDef {"type":"String","label":"App ID","name":"appId","required":true,"description":"The Quick Base application ID (dbid) that owns the table."}
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"dictionary":"getAppTablesDictionary","dependsOn":["appId"],"description":"The table ID (dbid) to delete."}
   *
   * @returns {Object} Object confirming the deleted table.
   * @sampleResult {"deletedTableId":"bqr5abcd1"}
   */
  async deleteTable(appId, tableId) {
    return this.#apiRequest({
      logTag: 'deleteTable',
      url: `${ API_BASE_URL }/tables/${ tableId }`,
      method: 'delete',
      query: { appId },
    })
  }

  // ============================================== FIELDS =============================================

  /**
   * @description Lists all fields in a Quick Base table. Each field includes its numeric field ID (fid), label, and field type. Because Quick Base keys records by fid rather than by name, this operation is the primary way to discover the fids you must supply to record operations.
   *
   * @route GET /fields
   * @operationName List Fields
   * @category Fields
   *
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"description":"The table ID (dbid) whose fields should be listed."}
   *
   * @returns {Array<Object>} Array of field metadata objects.
   * @sampleResult [{"id":3,"label":"Record ID#","fieldType":"recordid","required":false,"unique":true},{"id":6,"label":"Title","fieldType":"text","required":true,"unique":false}]
   */
  async listFields(tableId) {
    return this.#apiRequest({
      logTag: 'listFields',
      url: `${ API_BASE_URL }/fields`,
      query: { tableId },
    })
  }

  /**
   * @description Retrieves metadata for a single field in a Quick Base table by its numeric field ID (fid), including its label, field type, required/unique flags, and type-specific properties.
   *
   * @route GET /fields/{fieldId}
   * @operationName Get Field
   * @category Fields
   *
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"description":"The table ID (dbid) that owns the field. Find it in the Quick Base table URL after /db/, or use the List Tables / Get Tables Dictionary operations."}
   * @paramDef {"type":"Number","label":"Field ID","name":"fieldId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The numeric field ID (fid) to retrieve. Use Get Fields Dictionary or List Fields to look it up."}
   *
   * @returns {Object} Field metadata object.
   * @sampleResult {"id":6,"label":"Title","fieldType":"text","required":true,"unique":false,"properties":{"maxLength":0}}
   */
  async getField(tableId, fieldId) {
    return this.#apiRequest({
      logTag: 'getField',
      url: `${ API_BASE_URL }/fields/${ fieldId }`,
      query: { tableId },
    })
  }

  /**
   * @description Creates a new field in a Quick Base table. Choose a Field Type from the dropdown (for example Text, Numeric, Date, Checkbox, Email); the selection is mapped to the Quick Base API field type token. Returns the created field's metadata, including its assigned numeric field ID (fid).
   *
   * @route POST /fields
   * @operationName Create Field
   * @category Fields
   *
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"description":"The table ID (dbid) in which to create the field. Find it in the Quick Base table URL after /db/, or use the List Tables / Get Tables Dictionary operations."}
   * @paramDef {"type":"String","label":"Label","name":"label","required":true,"description":"The label (display name) of the new field."}
   * @paramDef {"type":"String","label":"Field Type","name":"fieldType","required":true,"defaultValue":"Text","uiComponent":{"type":"DROPDOWN","options":{"values":["Text","Text - Multiple Choice","Rich Text","Numeric","Currency","Percent","Rating","Date","Date / Time","Time of Day","Duration","Checkbox","Phone Number","Email","URL","User","List - User","Address","File Attachment"]}},"description":"The type of field to create."}
   * @paramDef {"type":"Boolean","label":"Required","name":"required","uiComponent":{"type":"TOGGLE"},"description":"Whether a value is required for this field on every record."}
   * @paramDef {"type":"Boolean","label":"Unique","name":"unique","uiComponent":{"type":"TOGGLE"},"description":"Whether values in this field must be unique across records."}
   *
   * @returns {Object} The newly created field's metadata, including its fid.
   * @sampleResult {"id":10,"label":"Amount","fieldType":"numeric","required":false,"unique":false}
   */
  async createField(tableId, label, fieldType, required, unique) {
    const body = {
      label,
      fieldType: this.#resolveChoice(fieldType, FIELD_TYPE_MAP),
    }

    if (required !== undefined && required !== null) {
      body.required = required
    }

    if (unique !== undefined && unique !== null) {
      body.unique = unique
    }

    return this.#apiRequest({
      logTag: 'createField',
      url: `${ API_BASE_URL }/fields`,
      method: 'post',
      query: { tableId },
      body,
    })
  }

  /**
   * @description Deletes one or more fields from a Quick Base table by their numeric field IDs (fids). Deleting a field permanently removes its data from every record and cannot be undone. Returns the fids that were deleted and any errors.
   *
   * @route DELETE /fields
   * @operationName Delete Fields
   * @category Fields
   *
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"description":"The table ID (dbid) whose fields should be deleted. Find it in the Quick Base table URL after /db/, or use the List Tables / Get Tables Dictionary operations."}
   * @paramDef {"type":"Array<String>","label":"Field IDs","name":"fieldIds","required":true,"description":"Array of numeric field IDs (fids) to delete, e.g. [\"10\",\"11\"]. Use Get Fields Dictionary to look them up."}
   *
   * @returns {Object} Object listing the deleted field IDs and any errors.
   * @sampleResult {"deletedFieldIds":[10,11],"errors":[]}
   */
  async deleteFields(tableId, fieldIds) {
    const ids = (Array.isArray(fieldIds) ? fieldIds : []).map(id => Number(id))

    return this.#apiRequest({
      logTag: 'deleteFields',
      url: `${ API_BASE_URL }/fields`,
      method: 'delete',
      query: { tableId },
      body: { fieldIds: ids },
    })
  }

  // =============================================== APPS ==============================================

  /**
   * @description Retrieves metadata for a Quick Base application by its application ID (dbid), including the app name, description, creation and update timestamps, and app-level variables. Quick Base has no list-all-apps endpoint, so the application ID must be provided; find it in the app URL after /db/.
   *
   * @route GET /apps/{appId}
   * @operationName Get App
   * @category Apps
   *
   * @paramDef {"type":"String","label":"App ID","name":"appId","required":true,"description":"The Quick Base application ID (dbid). Found in the app URL after /db/, e.g. bqr5abcd1. Quick Base provides no endpoint to list all apps, so this must be supplied directly."}
   *
   * @returns {Object} Application metadata object.
   * @sampleResult {"id":"bqr5abcd1","name":"Project Tracker","description":"Tracks projects","created":"2024-01-01T00:00:00Z","updated":"2024-06-01T00:00:00Z","hasEveryoneOnTheInternet":false}
   */
  async getApp(appId) {
    return this.#apiRequest({
      logTag: 'getApp',
      url: `${ API_BASE_URL }/apps/${ appId }`,
    })
  }

  // ============================================= REPORTS ============================================

  /**
   * @description Lists all reports defined on a Quick Base table. Each report includes its ID, name, type, and description. Use the report ID with Run Report to execute a pre-built report and retrieve its data.
   *
   * @route GET /reports
   * @operationName List Reports
   * @category Reports
   *
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"description":"The table ID (dbid) whose reports should be listed. Find it in the Quick Base table URL after /db/, or use the List Tables / Get Tables Dictionary operations."}
   *
   * @returns {Array<Object>} Array of report metadata objects.
   * @sampleResult [{"id":"1","name":"List All","type":"table","description":"Default list report"}]
   */
  async listReports(tableId) {
    return this.#apiRequest({
      logTag: 'listReports',
      url: `${ API_BASE_URL }/reports`,
      query: { tableId },
    })
  }

  /**
   * @description Runs a pre-built Quick Base report by its report ID against a table and returns the resulting records. Report data is keyed by numeric field IDs (fids) just like a record query, and the response includes field metadata and pagination info. Use Skip and Top to page through large reports.
   *
   * @route POST /reports/{reportId}/run
   * @operationName Run Report
   * @category Reports
   *
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"description":"The table ID (dbid) that owns the report. Find it in the Quick Base table URL after /db/, or use the List Tables / Get Tables Dictionary operations."}
   * @paramDef {"type":"String","label":"Report ID","name":"reportId","required":true,"description":"The ID of the report to run, as returned by List Reports."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records to skip for pagination (default 0)."}
   * @paramDef {"type":"Number","label":"Top","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of records to return in this page."}
   *
   * @returns {Object} Object with data (fid-keyed records), fields (metadata), and metadata (numRecords, totalRecords, skip, top).
   * @sampleResult {"data":[{"3":{"value":1},"6":{"value":"Task A"}}],"fields":[{"id":3,"label":"Record ID#","type":"recordid"}],"metadata":{"numRecords":1,"totalRecords":1,"skip":0}}
   */
  async runReport(tableId, reportId, skip, top) {
    const query = { tableId }

    if (skip !== undefined && skip !== null) {
      query.skip = skip
    }

    if (top !== undefined && top !== null) {
      query.top = top
    }

    return this.#apiRequest({
      logTag: 'runReport',
      url: `${ API_BASE_URL }/reports/${ reportId }/run`,
      method: 'post',
      query,
    })
  }

  // =============================================== FILES =============================================

  /**
   * @description Downloads a file stored in a Quick Base File Attachment field and saves it to FlowRunner file storage, returning a URL to the stored file. Quick Base returns file contents as base64; this operation decodes them and uploads the bytes. Identify the file by the table ID, record ID, the File Attachment field's numeric field ID (fid), and the version number (use 0 for the most recent version).
   *
   * @route GET /files/{tableId}/{recordId}/{fieldId}/{versionNumber}
   * @operationName Download File
   * @category Files
   *
   * @paramDef {"type":"String","label":"Table ID","name":"tableId","required":true,"description":"The table ID (dbid) containing the record and file field. Find it in the Quick Base table URL after /db/, or use the List Tables / Get Tables Dictionary operations."}
   * @paramDef {"type":"Number","label":"Record ID","name":"recordId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The Record ID# (fid 3 value) of the record holding the file."}
   * @paramDef {"type":"Number","label":"Field ID","name":"fieldId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The numeric field ID (fid) of the File Attachment field. Use Get Fields Dictionary to find it."}
   * @paramDef {"type":"Number","label":"Version Number","name":"versionNumber","required":true,"defaultValue":0,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The file version to download. Use 0 for the most recent version."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","description":"Optional name for the stored file. Defaults to a generated name."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   *
   * @returns {Object} Object with the stored file url, filename, and size in bytes.
   * @sampleResult {"url":"https://files.flowrunner.com/quickbase_1700000000000.pdf","filename":"quickbase_1700000000000.pdf","size":10240}
   */
  async downloadFile(tableId, recordId, fieldId, versionNumber, fileName, fileOptions) {
    const version = versionNumber === undefined || versionNumber === null ? 0 : versionNumber

    const base64 = await this.#apiRequest({
      logTag: 'downloadFile',
      url: `${ API_BASE_URL }/files/${ tableId }/${ recordId }/${ fieldId }/${ version }`,
    })

    // Quick Base returns the file body as base64-encoded text.
    const base64String = typeof base64 === 'string' ? base64 : (base64?.data || '')
    const buffer = Buffer.from(base64String, 'base64')

    const safeName = fileName || `quickbase_${ Date.now() }`

    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename: safeName,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return { url, filename: safeName, size: buffer.length }
  }
}

Flowrunner.ServerCode.addService(QuickBase, [
  {
    name: 'realmHostname',
    displayName: 'Realm Hostname',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Quick Base realm host, e.g. yourcompany.quickbase.com (the host part of your Quick Base URL).',
  },
  {
    name: 'userToken',
    displayName: 'User Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'A Quick Base user token. Create one under My Preferences > Manage user tokens > New user token.',
  },
])
