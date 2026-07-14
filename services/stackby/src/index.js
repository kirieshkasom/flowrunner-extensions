'use strict'

const API_BASE_URL = 'https://stackby.com/api/betav1'

const logger = {
  info: (...args) => console.log('[Stackby] info:', ...args),
  debug: (...args) => console.log('[Stackby] debug:', ...args),
  error: (...args) => console.log('[Stackby] error:', ...args),
  warn: (...args) => console.log('[Stackby] warn:', ...args),
}

/**
 * @integrationName Stackby
 * @integrationIcon /icon.png
 */
class Stackby {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=[${ JSON.stringify(query || {}) }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ 'api-key': this.apiKey, 'Content-Type': 'application/json' })
        .query(query || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const body = error.body || {}
      const message = body.message || body.error || error.message || 'Unknown error'

      logger.error(`${ logTag } - failed (${ error.status || error.statusCode || '?' }): ${ message }`)

      throw new Error(`Stackby API error: ${ message }`)
    }
  }

  /**
   * @description Retrieves rows from a Stackby table. Returns each row as an object with an "id" and a "field" object holding column-name/value pairs. Supports optional view filtering and a maximum record cap. The Stack ID comes from your Stackby stack URL and the table is referenced by its display name as shown in the Stackby UI.
   *
   * @route GET /list-rows
   * @operationName List Rows
   * @category Rows
   *
   * @paramDef {"type":"String","label":"Stack ID","name":"stackId","required":true,"description":"The unique identifier of the Stack (base). Find it in your Stackby stack URL, e.g. stackby.com/... /<stackId>."}
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"description":"The display name of the table exactly as it appears in the Stackby UI (case-sensitive)."}
   * @paramDef {"type":"String","label":"View","name":"view","description":"Optional view name to return only rows visible in that view, applying its filters and sort."}
   * @paramDef {"type":"Number","label":"Max Records","name":"maxRecord","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of rows to return (default 100)."}
   *
   * @returns {Array} Array of row objects, each with an id and a field object of column values.
   * @sampleResult [{"id":"row123","field":{"Name":"Acme Corp","Status":"Active","Amount":1200}}]
   */
  async listRows(stackId, tableName, view, maxRecord) {
    const query = {}

    if (view) {
      query.view = view
    }

    if (maxRecord !== undefined && maxRecord !== null && maxRecord !== '') {
      query.maxrecord = maxRecord
    }

    const result = await this.#apiRequest({
      logTag: 'listRows',
      url: `${ API_BASE_URL }/rowlist/${ stackId }/${ encodeURIComponent(tableName) }`,
      query,
    })

    return Array.isArray(result) ? result : (result?.data || result?.rows || result || [])
  }

  /**
   * @description Retrieves a single row from a Stackby table by its unique row ID. Stackby's public API does not expose a dedicated single-row endpoint, so this fetches the table's rows and returns the one whose id matches. For large tables, prefer List Rows with a view that narrows the result set.
   *
   * @route GET /get-row
   * @operationName Get Row
   * @category Rows
   *
   * @paramDef {"type":"String","label":"Stack ID","name":"stackId","required":true,"description":"The unique identifier of the Stack (base). Find it in your Stackby stack URL."}
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"description":"The display name of the table exactly as it appears in the Stackby UI (case-sensitive)."}
   * @paramDef {"type":"String","label":"Row ID","name":"rowId","required":true,"description":"The unique identifier of the row to retrieve."}
   *
   * @returns {Object} The matching row object with its id and field values, or null if no row matches.
   * @sampleResult {"id":"row123","field":{"Name":"Acme Corp","Status":"Active","Amount":1200}}
   */
  async getRow(stackId, tableName, rowId) {
    const rows = await this.listRows(stackId, tableName)

    return rows.find(row => row.id === rowId) || null
  }

  /**
   * @description Creates one or more rows in a Stackby table. Provide an array of field objects — each object maps column names (as shown in the Stackby UI) to their values. Returns the created rows including their newly assigned row IDs.
   *
   * @route POST /create-rows
   * @operationName Create Rows
   * @category Rows
   *
   * @paramDef {"type":"String","label":"Stack ID","name":"stackId","required":true,"description":"The unique identifier of the Stack (base). Find it in your Stackby stack URL."}
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"description":"The display name of the table exactly as it appears in the Stackby UI (case-sensitive)."}
   * @paramDef {"type":"Array<Object>","label":"Rows","name":"rows","required":true,"description":"Array of field objects to create. Each object maps column names to values, e.g. [{\"Name\":\"Acme Corp\",\"Status\":\"Active\"}]."}
   *
   * @returns {Array} Array of the created row objects, each including its new id and field values.
   * @sampleResult [{"id":"row789","field":{"Name":"Acme Corp","Status":"Active"}}]
   */
  async createRows(stackId, tableName, rows) {
    if (!Array.isArray(rows)) {
      rows = rows ? [rows] : []
    }

    if (rows.length === 0) {
      throw new Error('At least one row is required to create.')
    }

    const records = rows.map(field => ({ field }))

    const result = await this.#apiRequest({
      logTag: 'createRows',
      url: `${ API_BASE_URL }/rowcreate/${ stackId }/${ encodeURIComponent(tableName) }`,
      method: 'post',
      body: { records },
    })

    return Array.isArray(result) ? result : (result?.data || result?.rows || result || [])
  }

  /**
   * @description Updates one or more existing rows in a Stackby table. Provide an array of objects, each containing the row "id" and a "field" object with the columns to change. Only the supplied columns are modified; omitted columns keep their current values. Returns the updated rows.
   *
   * @route PATCH /update-rows
   * @operationName Update Rows
   * @category Rows
   *
   * @paramDef {"type":"String","label":"Stack ID","name":"stackId","required":true,"description":"The unique identifier of the Stack (base). Find it in your Stackby stack URL."}
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"description":"The display name of the table exactly as it appears in the Stackby UI (case-sensitive)."}
   * @paramDef {"type":"Array<Object>","label":"Rows","name":"rows","required":true,"description":"Array of rows to update. Each item must include an id and a field object of columns to change, e.g. [{\"id\":\"row123\",\"field\":{\"Status\":\"Closed\"}}]."}
   *
   * @returns {Array} Array of the updated row objects with their id and field values.
   * @sampleResult [{"id":"row123","field":{"Status":"Closed"}}]
   */
  async updateRows(stackId, tableName, rows) {
    if (!Array.isArray(rows)) {
      rows = rows ? [rows] : []
    }

    if (rows.length === 0) {
      throw new Error('At least one row is required to update.')
    }

    const records = rows.map(row => ({
      id: row.id,
      field: row.field !== undefined ? row.field : row,
    }))

    const result = await this.#apiRequest({
      logTag: 'updateRows',
      url: `${ API_BASE_URL }/rowupdate/${ stackId }/${ encodeURIComponent(tableName) }`,
      method: 'patch',
      body: { records },
    })

    return Array.isArray(result) ? result : (result?.data || result?.rows || result || [])
  }

  /**
   * @description Deletes one or more rows from a Stackby table by their unique row IDs. Accepts an array of row IDs and removes each matching row. Returns the API response confirming the deletion.
   *
   * @route DELETE /delete-rows
   * @operationName Delete Rows
   * @category Rows
   *
   * @paramDef {"type":"String","label":"Stack ID","name":"stackId","required":true,"description":"The unique identifier of the Stack (base). Find it in your Stackby stack URL."}
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"description":"The display name of the table exactly as it appears in the Stackby UI (case-sensitive)."}
   * @paramDef {"type":"Array<String>","label":"Row IDs","name":"rowIds","required":true,"description":"Array of row IDs to delete, e.g. [\"row123\",\"row456\"]."}
   *
   * @returns {Object} The Stackby API response confirming the deleted rows.
   * @sampleResult {"records":[{"id":"row123","deleted":true}]}
   */
  async deleteRows(stackId, tableName, rowIds) {
    if (!Array.isArray(rowIds)) {
      rowIds = rowIds ? [rowIds] : []
    }

    if (rowIds.length === 0) {
      throw new Error('At least one row ID is required to delete.')
    }

    const queryString = rowIds.map(id => `rowIds[]=${ encodeURIComponent(id) }`).join('&')

    return this.#apiRequest({
      logTag: 'deleteRows',
      url: `${ API_BASE_URL }/rowdelete/${ stackId }/${ encodeURIComponent(tableName) }?${ queryString }`,
      method: 'delete',
    })
  }
}

Flowrunner.ServerCode.addService(Stackby, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Stackby API key. Get it from Stackby → Account/Profile → API key (or your workspace API key). Sent as the "api-key" request header.',
  },
])
