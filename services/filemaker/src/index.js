const logger = {
  info: (...args) => console.log('[FileMaker] info:', ...args),
  debug: (...args) => console.log('[FileMaker] debug:', ...args),
  error: (...args) => console.log('[FileMaker] error:', ...args),
  warn: (...args) => console.log('[FileMaker] warn:', ...args),
}

/**
 * @integrationName FileMaker
 * @integrationIcon /icon.svg
 */
class FileMaker {
  constructor(config) {
    // The host is a bare hostname (e.g. fms.example.com) with no protocol or path; strip anything
    // the user may have pasted so URL construction stays predictable.
    this.host = String(config.host || '')
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$/, '')
      .replace(/\/.*$/, '')

    this.database = config.database
    this.username = config.username
    this.password = config.password

    // vLatest always resolves to the newest Data API version the server supports.
    this.apiBaseUrl = `https://${ this.host }/fmi/data/vLatest/databases/${ encodeURIComponent(this.database || '') }`
  }

  // ==================================================================================
  // Internal helpers
  // ==================================================================================

  // Mints a FileMaker Data API session token by exchanging the configured account credentials via
  // HTTP Basic auth on the first API call of each invocation, then caches it in memory for the
  // lifetime of this service instance. This is a normal database login (like an API-key exchange),
  // NOT an interactive OAuth connection, so it is minted here in a private helper rather than
  // through the platform's OAuth system methods.
  async #getToken(forceRefresh = false) {
    if (this.sessionToken && !forceRefresh) {
      return this.sessionToken
    }

    logger.debug('creating a new FileMaker Data API session (Basic auth login)')

    const basic = Buffer.from(`${ this.username }:${ this.password }`).toString('base64')

    let response

    try {
      response = await Flowrunner.Request.post(`${ this.apiBaseUrl }/sessions`)
        .set({ 'Authorization': `Basic ${ basic }`, 'Content-Type': 'application/json' })
        .send({})
    } catch (error) {
      const message = this.#extractError(error)

      throw new Error(`Failed to create a FileMaker session: ${ message }. Verify the host, database, username and password, and that the account has the fmrest (Data API) privilege.`)
    }

    // The token is returned in the response body and mirrored in the X-FM-Data-Access-Token header.
    const token = response?.response?.token

    if (!token) {
      throw new Error('FileMaker session endpoint did not return an access token')
    }

    this.sessionToken = token

    return this.sessionToken
  }

  // Extracts a human-readable message from a FileMaker error body. FileMaker wraps every response
  // (including errors) in a messages array of { code, message }; code "0" means OK and any other
  // code is a failure. HTTP-level failures may also surface as a plain string or Error message.
  #extractError(error) {
    const body = error?.body

    if (body && typeof body === 'object') {
      const failure = Array.isArray(body.messages)
        ? body.messages.find(entry => entry && entry.code !== '0')
        : undefined

      if (failure) {
        return `${ failure.message } (code ${ failure.code })`
      }

      if (typeof body.message === 'string' && body.message) {
        return body.message
      }
    }

    if (typeof body === 'string' && body) {
      return body
    }

    return error?.message || 'Unknown error'
  }

  // Single request helper. Ensures a session token, sends it as a Bearer header, and unwraps the
  // FileMaker { response, messages } envelope. A non-"0" message code is treated as a failure and
  // throws. On a 401 the session token is re-minted once and the request retried, in case a cached
  // token expired mid-invocation.
  async #apiRequest({ url, method = 'get', body, query, logTag, isRetry = false }) {
    const token = await this.#getToken()

    const cleanedQuery = {}

    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== '') {
        cleanedQuery[key] = value
      }
    }

    let response

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ 'Authorization': `Bearer ${ token }`, 'Content-Type': 'application/json' })
        .query(cleanedQuery)

      response = body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const status = error.status || error.statusCode

      // Refresh the session once on an auth failure, then retry the original request.
      if (status === 401 && !isRetry) {
        logger.warn(`${ logTag } - received 401, re-authenticating and retrying once`)
        await this.#getToken(true)

        return this.#apiRequest({ url, method, body, query, logTag, isRetry: true })
      }

      const message = this.#extractError(error)

      logger.error(`${ logTag } - failed${ status ? ` (${ status })` : '' }: ${ message }`)

      throw new Error(`FileMaker API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }

    // A 2xx response can still carry a non-"0" message code. Enforce the envelope contract.
    const messages = Array.isArray(response?.messages) ? response.messages : []
    const failure = messages.find(entry => entry && entry.code !== '0')

    if (failure) {
      logger.error(`${ logTag } - FileMaker returned code ${ failure.code }: ${ failure.message }`)

      throw new Error(`FileMaker API error: ${ failure.message } (code ${ failure.code })`)
    }

    // Return the inner response payload; fall back to the whole body if it is not wrapped.
    return response?.response !== undefined ? response.response : response
  }

  // ==================================================================================
  // Records
  // ==================================================================================

  /**
   * @operationName Get Records
   * @description Retrieves a range of records from a FileMaker layout. Records are always accessed through a layout, which determines exactly which fields, portals and related data are returned. Supports pagination via offset and limit and multi-field sorting. Returns the record set with each record's fieldData, portalData, recordId and modId.
   * @category Records
   * @route GET /layouts/{layout}/records
   * @paramDef {"type":"String","label":"Layout","name":"layout","required":true,"dictionary":"getLayoutsDictionary","description":"Name of the layout to read records from. The layout defines which fields and related data are visible."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-based index of the first record to return (default 1)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of records to return (default 100)."}
   * @paramDef {"type":"Array<Object>","label":"Sort","name":"sort","description":"Optional sort order, e.g. [{\"fieldName\":\"Name\",\"sortOrder\":\"ascend\"}]. sortOrder is \"ascend\", \"descend\" or a value list name."}
   * @returns {Object}
   * @sampleResult {"dataInfo":{"database":"Inventory","layout":"Products","table":"Products","totalRecordCount":250,"foundCount":250,"returnedCount":1},"data":[{"fieldData":{"Name":"Widget","Price":9.99},"portalData":{},"recordId":"12","modId":"3"}]}
   */
  async getRecords(layout, offset, limit, sort) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/layouts/${ encodeURIComponent(layout) }/records`,
      query: {
        _offset: offset,
        _limit: limit,
        _sort: sort ? JSON.stringify(sort) : undefined,
      },
      logTag: 'getRecords',
    })
  }

  /**
   * @operationName Get Record
   * @description Retrieves a single record from a FileMaker layout by its internal record ID. The layout determines which fields, portals and related data are returned. Returns the record's fieldData, portalData, recordId and modId.
   * @category Records
   * @route GET /layouts/{layout}/records/{recordId}
   * @paramDef {"type":"String","label":"Layout","name":"layout","required":true,"dictionary":"getLayoutsDictionary","description":"Name of the layout the record belongs to."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"description":"Internal FileMaker record ID (the recordId returned by Get/Find Records, not a field value)."}
   * @returns {Object}
   * @sampleResult {"dataInfo":{"database":"Inventory","layout":"Products","table":"Products","totalRecordCount":250,"foundCount":1,"returnedCount":1},"data":[{"fieldData":{"Name":"Widget","Price":9.99},"portalData":{},"recordId":"12","modId":"3"}]}
   */
  async getRecord(layout, recordId) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/layouts/${ encodeURIComponent(layout) }/records/${ encodeURIComponent(recordId) }`,
      logTag: 'getRecord',
    })
  }

  /**
   * @operationName Create Record
   * @description Creates a new record on the specified FileMaker layout. Provide the field values as a fieldData object keyed by field name; any field not supplied takes its default or empty value. The account must have create access to the layout's table. Returns the new record's recordId and modId.
   * @category Records
   * @route POST /layouts/{layout}/records
   * @paramDef {"type":"String","label":"Layout","name":"layout","required":true,"dictionary":"getLayoutsDictionary","description":"Name of the layout on which to create the record."}
   * @paramDef {"type":"Object","label":"Field Data","name":"fieldData","required":true,"description":"Object of field name/value pairs to set on the new record, e.g. {\"Name\":\"Widget\",\"Price\":9.99}."}
   * @returns {Object}
   * @sampleResult {"recordId":"251","modId":"0"}
   */
  async createRecord(layout, fieldData) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/layouts/${ encodeURIComponent(layout) }/records`,
      method: 'post',
      body: { fieldData: fieldData || {} },
      logTag: 'createRecord',
    })
  }

  /**
   * @operationName Edit Record
   * @description Updates an existing record on a FileMaker layout by its internal record ID. Provide only the fields you want to change in fieldData. Optionally pass the record's current modId to enforce optimistic locking — if the record was modified since that modId, the edit is rejected. Returns the updated modId.
   * @category Records
   * @route PATCH /layouts/{layout}/records/{recordId}
   * @paramDef {"type":"String","label":"Layout","name":"layout","required":true,"dictionary":"getLayoutsDictionary","description":"Name of the layout the record belongs to."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"description":"Internal FileMaker record ID of the record to edit."}
   * @paramDef {"type":"Object","label":"Field Data","name":"fieldData","required":true,"description":"Object of field name/value pairs to update, e.g. {\"Price\":12.50}."}
   * @paramDef {"type":"Number","label":"Mod ID","name":"modId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional current modId for optimistic locking; the edit fails if the record changed since this modId."}
   * @returns {Object}
   * @sampleResult {"modId":"4"}
   */
  async editRecord(layout, recordId, fieldData, modId) {
    const body = { fieldData: fieldData || {} }

    if (modId !== undefined && modId !== null && modId !== '') {
      body.modId = String(modId)
    }

    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/layouts/${ encodeURIComponent(layout) }/records/${ encodeURIComponent(recordId) }`,
      method: 'patch',
      body,
      logTag: 'editRecord',
    })
  }

  /**
   * @operationName Delete Record
   * @description Permanently deletes a single record from a FileMaker layout by its internal record ID. The account must have delete access to the layout's table. This action cannot be undone.
   * @category Records
   * @route DELETE /layouts/{layout}/records/{recordId}
   * @paramDef {"type":"String","label":"Layout","name":"layout","required":true,"dictionary":"getLayoutsDictionary","description":"Name of the layout the record belongs to."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"description":"Internal FileMaker record ID of the record to delete."}
   * @returns {Object}
   * @sampleResult {}
   */
  async deleteRecord(layout, recordId) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/layouts/${ encodeURIComponent(layout) }/records/${ encodeURIComponent(recordId) }`,
      method: 'delete',
      logTag: 'deleteRecord',
    })
  }

  /**
   * @operationName Duplicate Record
   * @description Duplicates an existing record on a FileMaker layout, creating a new record that copies the field values of the source record. Returns the new record's recordId and modId.
   * @category Records
   * @route POST /layouts/{layout}/records/{recordId}
   * @paramDef {"type":"String","label":"Layout","name":"layout","required":true,"dictionary":"getLayoutsDictionary","description":"Name of the layout the source record belongs to."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"description":"Internal FileMaker record ID of the record to duplicate."}
   * @returns {Object}
   * @sampleResult {"recordId":"252","modId":"0"}
   */
  async duplicateRecord(layout, recordId) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/layouts/${ encodeURIComponent(layout) }/records/${ encodeURIComponent(recordId) }`,
      method: 'post',
      body: {},
      logTag: 'duplicateRecord',
    })
  }

  // ==================================================================================
  // Find
  // ==================================================================================

  /**
   * @operationName Find Records
   * @description Runs a FileMaker find request against a layout and returns matching records. The query is an array of request objects, each mapping field names to search criteria; multiple objects are OR-ed together, and setting "omit":"true" on a request excludes its matches. Supports sorting, offset and limit. Returns the found set with each record's fieldData, portalData, recordId and modId.
   * @category Find
   * @route POST /layouts/{layout}/_find
   * @paramDef {"type":"String","label":"Layout","name":"layout","required":true,"dictionary":"getLayoutsDictionary","description":"Name of the layout to search."}
   * @paramDef {"type":"Array<Object>","label":"Query","name":"query","required":true,"description":"Array of find request objects, e.g. [{\"Name\":\"Widget\"},{\"Status\":\"Discontinued\",\"omit\":\"true\"}]. Use FileMaker find operators such as ==, *, > within values."}
   * @paramDef {"type":"Array<Object>","label":"Sort","name":"sort","description":"Optional sort order, e.g. [{\"fieldName\":\"Name\",\"sortOrder\":\"ascend\"}]."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-based index of the first record in the found set to return (default 1)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of records to return (default 100)."}
   * @returns {Object}
   * @sampleResult {"dataInfo":{"database":"Inventory","layout":"Products","table":"Products","totalRecordCount":250,"foundCount":3,"returnedCount":3},"data":[{"fieldData":{"Name":"Widget","Price":9.99},"portalData":{},"recordId":"12","modId":"3"}]}
   */
  async findRecords(layout, query, sort, offset, limit) {
    const body = { query: query || [] }

    if (sort) {
      body.sort = sort
    }

    if (offset !== undefined && offset !== null && offset !== '') {
      body.offset = String(offset)
    }

    if (limit !== undefined && limit !== null && limit !== '') {
      body.limit = String(limit)
    }

    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/layouts/${ encodeURIComponent(layout) }/_find`,
      method: 'post',
      body,
      logTag: 'findRecords',
    })
  }

  // ==================================================================================
  // Scripts
  // ==================================================================================

  /**
   * @operationName Run Script
   * @description Runs a FileMaker script in the context of a layout and returns the script's result and error code. An optional script parameter is passed to the script's Get(ScriptParameter). Returns scriptResult and scriptError from the executed script.
   * @category Scripts
   * @route GET /layouts/{layout}/script/{scriptName}
   * @paramDef {"type":"String","label":"Layout","name":"layout","required":true,"dictionary":"getLayoutsDictionary","description":"Layout that provides the context in which the script runs."}
   * @paramDef {"type":"String","label":"Script Name","name":"scriptName","required":true,"description":"Exact name of the FileMaker script to run."}
   * @paramDef {"type":"String","label":"Script Parameter","name":"scriptParam","description":"Optional parameter passed to the script, available via Get(ScriptParameter)."}
   * @returns {Object}
   * @sampleResult {"scriptResult":"Done","scriptError":"0"}
   */
  async runScript(layout, scriptName, scriptParam) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/layouts/${ encodeURIComponent(layout) }/script/${ encodeURIComponent(scriptName) }`,
      query: { 'script.param': scriptParam },
      logTag: 'runScript',
    })
  }

  /**
   * @operationName List Scripts
   * @description Lists all FileMaker scripts in the hosted database that are available to the authenticated account, including script folders and their nested scripts. Useful for discovering script names to use with Run Script.
   * @category Scripts
   * @route GET /scripts
   * @returns {Object}
   * @sampleResult {"scripts":[{"name":"Recalculate Totals","isFolder":false},{"name":"Reports","isFolder":true,"folderScriptNames":[{"name":"Monthly Report","isFolder":false}]}]}
   */
  async listScripts() {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/scripts`,
      logTag: 'listScripts',
    })
  }

  // ==================================================================================
  // Metadata
  // ==================================================================================

  /**
   * @operationName List Layouts
   * @description Lists all layouts in the hosted FileMaker database that are available to the authenticated account, including layout folders and their nested layouts. Records are accessed through layouts, so this is the starting point for discovering which layouts to query.
   * @category Metadata
   * @route GET /layouts
   * @returns {Object}
   * @sampleResult {"layouts":[{"name":"Products"},{"name":"Reports","isFolder":true,"folderLayoutNames":[{"name":"Sales Summary"}]}]}
   */
  async listLayouts() {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/layouts`,
      logTag: 'listLayouts',
    })
  }

  /**
   * @operationName Get Layout Metadata
   * @description Retrieves the field and portal metadata for a specific FileMaker layout, including each field's name, type, display type, whether it is auto-entered or required, and any associated value lists. Use this to understand the fieldData shape before creating or editing records.
   * @category Metadata
   * @route GET /layouts/{layout}
   * @paramDef {"type":"String","label":"Layout","name":"layout","required":true,"dictionary":"getLayoutsDictionary","description":"Name of the layout whose field and portal metadata to retrieve."}
   * @returns {Object}
   * @sampleResult {"fieldMetaData":[{"name":"Name","type":"normal","displayType":"editText","result":"text","valueList":"","repetitions":1}],"portalMetaData":{},"valueLists":[]}
   */
  async getLayoutMetadata(layout) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/layouts/${ encodeURIComponent(layout) }`,
      logTag: 'getLayoutMetadata',
    })
  }

  /**
   * @operationName Get Product Info
   * @description Returns metadata about the FileMaker Server product, including its name, build date and version. This endpoint does not require a specific database and is useful as a lightweight connection check to confirm the host and credentials resolve. Runs against the productInfo endpoint at the server root.
   * @category Metadata
   * @route GET /productInfo
   * @returns {Object}
   * @sampleResult {"productInfo":{"name":"FileMaker Data API Engine","buildDate":"01/01/2025","version":"21.0.1.62","dateFormat":"MM/dd/yyyy","timeFormat":"HH:mm:ss","timeStampFormat":"MM/dd/yyyy HH:mm:ss"}}
   */
  async getProductInfo() {
    return this.#apiRequest({
      url: `https://${ this.host }/fmi/data/vLatest/productInfo`,
      logTag: 'getProductInfo',
    })
  }

  // ==================================================================================
  // Globals
  // ==================================================================================

  /**
   * @operationName Set Global Fields
   * @description Sets the values of global fields for the current FileMaker Data API session. Global field values set this way persist only for the life of the session and are commonly used to pass context into scripts and calculations. Provide fully qualified field names (Table::GlobalField) mapped to their values in globalFields.
   * @category Globals
   * @route PATCH /globals
   * @paramDef {"type":"Object","label":"Global Fields","name":"globalFields","required":true,"description":"Object mapping fully qualified global field names to values, e.g. {\"Prefs::CurrentUser\":\"jdoe\"}."}
   * @returns {Object}
   * @sampleResult {}
   */
  async setGlobalFields(globalFields) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/globals`,
      method: 'patch',
      body: { globalFields: globalFields || {} },
      logTag: 'setGlobalFields',
    })
  }

  // ==================================================================================
  // Dictionaries
  // ==================================================================================

  /**
   * @typedef {Object} getLayoutsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to layout names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused; FileMaker returns all layouts in one response)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Layouts Dictionary
   * @description Lists the hosted database's layouts for selection in layout parameters. Folder entries are flattened so only selectable layout names are returned.
   * @route POST /get-layouts-dictionary
   * @paramDef {"type":"getLayoutsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Products","value":"Products","note":"Layout"}]}
   */
  async getLayoutsDictionary(payload) {
    const { search } = payload || {}

    const result = await this.#apiRequest({
      url: `${ this.apiBaseUrl }/layouts`,
      logTag: 'getLayoutsDictionary',
    })

    const names = []

    const collect = entries => {
      for (const entry of entries || []) {
        if (entry && entry.isFolder && Array.isArray(entry.folderLayoutNames)) {
          collect(entry.folderLayoutNames)
        } else if (entry && entry.name) {
          names.push(entry.name)
        }
      }
    }

    collect(result?.layouts)

    const needle = (search || '').trim().toLowerCase()

    const items = names
      .filter(name => !needle || name.toLowerCase().includes(needle))
      .map(name => ({ label: name, value: name, note: 'Layout' }))

    return { items }
  }
}

Flowrunner.ServerCode.addService(FileMaker, [
  {
    name: 'host',
    displayName: 'Host',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your FileMaker Server host, e.g. fms.example.com — no protocol or path.',
  },
  {
    name: 'database',
    displayName: 'Database',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'The hosted database/solution name.',
  },
  {
    name: 'username',
    displayName: 'Username',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'A FileMaker account with the Data API (fmrest) extended privilege.',
  },
  {
    name: 'password',
    displayName: 'Password',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'The account password.',
  },
])
