const crypto = require('crypto')

const logger = {
  info: (...args) => console.log('[Azure Table Storage] info:', ...args),
  debug: (...args) => console.log('[Azure Table Storage] debug:', ...args),
  error: (...args) => console.log('[Azure Table Storage] error:', ...args),
  warn: (...args) => console.log('[Azure Table Storage] warn:', ...args),
}

const API_VERSION = '2019-02-02'

/**
 * @integrationName Azure Table Storage
 * @integrationIcon /icon.svg
 */
class AzureTableStorage {
  constructor(config) {
    this.accountName = config.accountName
    this.accountKey = config.accountKey
    this.baseUrl = this.accountName ? `https://${ this.accountName }.table.core.windows.net` : null
  }

  // ==========================================================================
  //  AUTH - SharedKeyLite
  // ==========================================================================
  // StringToSign for the Table service (SharedKeyLite) is exactly:
  //   Date + "\n" + CanonicalizedResource
  // where Date is the x-ms-date (RFC1123) value and CanonicalizedResource is
  //   "/{accountName}" + urlPathBeforeQuery + ("?comp={comp}" only when a comp
  //   query param is present). No other query params are canonicalized.
  #sign(urlPath, query, date) {
    let canonicalizedResource = `/${ this.accountName }${ urlPath }`

    if (query && query.comp !== undefined && query.comp !== null && query.comp !== '') {
      canonicalizedResource += `?comp=${ query.comp }`
    }

    const stringToSign = `${ date }\n${ canonicalizedResource }`
    const signature = crypto
      .createHmac('sha256', Buffer.from(this.accountKey, 'base64'))
      .update(stringToSign, 'utf8')
      .digest('base64')

    return `SharedKeyLite ${ this.accountName }:${ signature }`
  }

  // ==========================================================================
  //  CORE - every external call goes through #apiRequest
  // ==========================================================================
  async #apiRequest({ urlPath, method = 'get', body, query, headers, logTag, unwrap = false }) {
    if (!this.accountName || !this.accountKey) {
      throw new Error('Azure Storage account name and account key are required — set them in this connection.')
    }

    const date = new Date().toUTCString()
    const url = `${ this.baseUrl }${ urlPath }`

    const requestHeaders = {
      'x-ms-date': date,
      'x-ms-version': API_VERSION,
      'Authorization': this.#sign(urlPath, query, date),
      'Accept': 'application/json;odata=nometadata',
      'DataServiceVersion': '3.0;NetFx',
      'MaxDataServiceVersion': '3.0;NetFx',
      ...(headers || {}),
    }

    if (body !== undefined) {
      requestHeaders['Content-Type'] = 'application/json'
    }

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ urlPath }]`)

      let request = Flowrunner.Request[method.toLowerCase()](url)
        .set(requestHeaders)
        .query(query || {})

      if (unwrap) {
        request = request.unwrapBody(false)
      }

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const odataError = error.body?.['odata.error']
      const code = odataError?.code || error.code
      const message = odataError?.message?.value || error.body?.message || error.message
      const status = error.status || error.statusCode

      logger.error(`${ logTag } - failed (${ status || '?' }/${ code || '?' }): ${ message }`)

      throw new Error(`Azure Table Storage API error${ status ? ` (${ status })` : '' }${ code ? ` [${ code }]` : '' }: ${ message }`)
    }
  }

  // Doubles single quotes inside a key value and returns it quoted for use in an
  // entity URI, e.g. p1 -> 'p1', O'Brien -> 'O''Brien'. Also URL-encodes.
  #encodeKey(value) {
    const escaped = String(value).replace(/'/g, "''")

    return `'${ encodeURIComponent(escaped) }'`
  }

  #entityPath(tableName, partitionKey, rowKey) {
    return `/${ encodeURIComponent(tableName) }(PartitionKey=${ this.#encodeKey(partitionKey) },RowKey=${ this.#encodeKey(rowKey) })`
  }

  // ==========================================================================
  //  TABLES
  // ==========================================================================

  /**
   * @operationName List Tables
   * @category Tables
   * @description Lists all tables in the storage account. Returns an array of table objects, each containing a TableName. Table Storage returns up to 1000 tables per page; when more exist, use the returned nextTableName as the continuation token to fetch the next page.
   * @route GET /list-tables
   * @appearanceColor #0078D4 #4093E6
   * @paramDef {"type":"String","label":"Continuation Token","name":"nextTableName","required":false,"description":"Optional continuation token (NextTableName) returned by a previous call to fetch the next page of tables."}
   * @returns {Object}
   * @sampleResult {"tables":[{"TableName":"Customers"},{"TableName":"Orders"}],"nextTableName":null}
   */
  async listTables(nextTableName) {
    const query = {}

    if (nextTableName) query.NextTableName = nextTableName

    const response = await this.#apiRequest({
      urlPath: '/Tables',
      method: 'get',
      query,
      logTag: 'listTables',
      unwrap: true,
    })

    const headers = response?.headers || {}

    return {
      tables: response?.body?.value || [],
      nextTableName: headers['x-ms-continuation-nexttablename'] || null,
    }
  }

  /**
   * @operationName Create Table
   * @category Tables
   * @description Creates a new table in the storage account. Table names may contain only alphanumeric characters, must start with a letter, and be 3 to 63 characters long. Fails with a 409 conflict if a table with the same name already exists.
   * @route POST /create-table
   * @appearanceColor #0078D4 #4093E6
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"description":"Name of the table to create (3-63 alphanumeric characters, starting with a letter)."}
   * @returns {Object}
   * @sampleResult {"TableName":"Customers"}
   */
  async createTable(tableName) {
    if (!tableName) throw new Error('tableName is required.')

    const response = await this.#apiRequest({
      urlPath: '/Tables',
      method: 'post',
      body: { TableName: tableName },
      logTag: 'createTable',
    })

    return response || { TableName: tableName }
  }

  /**
   * @operationName Delete Table
   * @category Tables
   * @description Permanently deletes a table and all entities it contains from the storage account. This action is irreversible. Fails with a 404 if the table does not exist.
   * @route DELETE /delete-table
   * @appearanceColor #0078D4 #4093E6
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"dictionary":"getTablesDictionary","description":"Name of the table to delete."}
   * @returns {Object}
   * @sampleResult {"success":true,"tableName":"Customers"}
   */
  async deleteTable(tableName) {
    if (!tableName) throw new Error('tableName is required.')

    await this.#apiRequest({
      urlPath: `/Tables(${ this.#encodeKey(tableName) })`,
      method: 'delete',
      logTag: 'deleteTable',
    })

    return { success: true, tableName }
  }

  /**
   * @operationName Query Tables
   * @category Tables
   * @description Queries tables in the storage account using an optional OData $filter and $top limit. For example, use "TableName eq 'Customers'" to look up a specific table. Returns matching table objects plus a continuation token when more results are available.
   * @route GET /query-tables
   * @appearanceColor #0078D4 #4093E6
   * @paramDef {"type":"String","label":"Filter","name":"filter","required":false,"description":"Optional OData $filter expression over table metadata, e.g. TableName eq 'Customers'."}
   * @paramDef {"type":"Number","label":"Top","name":"top","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tables to return (up to 1000 per page)."}
   * @paramDef {"type":"String","label":"Continuation Token","name":"nextTableName","required":false,"description":"Optional continuation token (NextTableName) from a previous call to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"tables":[{"TableName":"Customers"}],"nextTableName":null}
   */
  async queryTables(filter, top, nextTableName) {
    const query = {}

    if (filter) query.$filter = filter
    if (top !== undefined && top !== null && top !== '') query.$top = top
    if (nextTableName) query.NextTableName = nextTableName

    const response = await this.#apiRequest({
      urlPath: '/Tables',
      method: 'get',
      query,
      logTag: 'queryTables',
      unwrap: true,
    })

    const headers = response?.headers || {}

    return {
      tables: response?.body?.value || [],
      nextTableName: headers['x-ms-continuation-nexttablename'] || null,
    }
  }

  // ==========================================================================
  //  ENTITIES
  // ==========================================================================

  /**
   * @operationName Query Entities
   * @category Entities
   * @description Queries entities in a table using an optional OData $filter, $select, and $top. Entities are keyed by PartitionKey + RowKey; filters can target these or any custom property, e.g. "PartitionKey eq 'us' and Age gt 30". Returns matching entities plus continuation tokens (nextPartitionKey / nextRowKey) when the result set spans multiple pages (max 1000 entities per page).
   * @route GET /query-entities
   * @appearanceColor #0078D4 #4093E6
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"dictionary":"getTablesDictionary","description":"Name of the table to query."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","required":false,"description":"Optional OData $filter expression, e.g. PartitionKey eq 'us' and Age gt 30. String literals must be single-quoted."}
   * @paramDef {"type":"String","label":"Select","name":"select","required":false,"description":"Optional comma-separated list of properties to return, e.g. PartitionKey,RowKey,Name."}
   * @paramDef {"type":"Number","label":"Top","name":"top","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of entities to return (up to 1000 per page)."}
   * @paramDef {"type":"String","label":"Next Partition Key","name":"nextPartitionKey","required":false,"description":"Continuation token (NextPartitionKey) from a previous call to fetch the next page."}
   * @paramDef {"type":"String","label":"Next Row Key","name":"nextRowKey","required":false,"description":"Continuation token (NextRowKey) from a previous call to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"value":[{"PartitionKey":"us","RowKey":"1","Name":"Ada","Age":30}],"nextPartitionKey":null,"nextRowKey":null}
   */
  async queryEntities(tableName, filter, select, top, nextPartitionKey, nextRowKey) {
    if (!tableName) throw new Error('tableName is required.')

    const query = {}

    if (filter) query.$filter = filter
    if (select) query.$select = select
    if (top !== undefined && top !== null && top !== '') query.$top = top
    if (nextPartitionKey) query.NextPartitionKey = nextPartitionKey
    if (nextRowKey) query.NextRowKey = nextRowKey

    const response = await this.#apiRequest({
      urlPath: `/${ encodeURIComponent(tableName) }()`,
      method: 'get',
      query,
      logTag: 'queryEntities',
      unwrap: true,
    })

    const headers = response?.headers || {}

    return {
      value: response?.body?.value || [],
      nextPartitionKey: headers['x-ms-continuation-nextpartitionkey'] || null,
      nextRowKey: headers['x-ms-continuation-nextrowkey'] || null,
    }
  }

  /**
   * @operationName Get Entity
   * @category Entities
   * @description Retrieves a single entity from a table by its PartitionKey and RowKey. Optionally limit the returned properties with $select. Returns the entity object, or fails with a 404 if no matching entity exists.
   * @route GET /get-entity
   * @appearanceColor #0078D4 #4093E6
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"dictionary":"getTablesDictionary","description":"Name of the table to read from."}
   * @paramDef {"type":"String","label":"Partition Key","name":"partitionKey","required":true,"description":"The PartitionKey of the entity to retrieve."}
   * @paramDef {"type":"String","label":"Row Key","name":"rowKey","required":true,"description":"The RowKey of the entity to retrieve."}
   * @paramDef {"type":"String","label":"Select","name":"select","required":false,"description":"Optional comma-separated list of properties to return, e.g. Name,Age."}
   * @returns {Object}
   * @sampleResult {"PartitionKey":"us","RowKey":"1","Name":"Ada","Age":30}
   */
  async getEntity(tableName, partitionKey, rowKey, select) {
    if (!tableName) throw new Error('tableName is required.')
    if (partitionKey === undefined || partitionKey === null) throw new Error('partitionKey is required.')
    if (rowKey === undefined || rowKey === null) throw new Error('rowKey is required.')

    const query = {}

    if (select) query.$select = select

    return this.#apiRequest({
      urlPath: this.#entityPath(tableName, partitionKey, rowKey),
      method: 'get',
      query,
      logTag: 'getEntity',
    })
  }

  /**
   * @operationName Insert Entity
   * @category Entities
   * @description Inserts a new entity into a table. Supply PartitionKey and RowKey (which together form the unique primary key) plus any number of custom properties. Property values are typed automatically (strings, numbers, and booleans are inferred); to force an EDM type add a companion "<Name>@odata.type" property. Fails with a 409 conflict if an entity with the same keys already exists.
   * @route POST /insert-entity
   * @appearanceColor #0078D4 #4093E6
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"dictionary":"getTablesDictionary","description":"Name of the table to insert into."}
   * @paramDef {"type":"String","label":"Partition Key","name":"partitionKey","required":true,"description":"The PartitionKey for the new entity."}
   * @paramDef {"type":"String","label":"Row Key","name":"rowKey","required":true,"description":"The RowKey for the new entity (unique within the partition)."}
   * @paramDef {"type":"Object","label":"Properties","name":"properties","required":false,"description":"Custom properties for the entity as plain JSON, e.g. {\"Name\":\"Ada\",\"Age\":30}. Merged with PartitionKey and RowKey into the request body."}
   * @returns {Object}
   * @sampleResult {"PartitionKey":"us","RowKey":"1","Name":"Ada","Age":30}
   */
  async insertEntity(tableName, partitionKey, rowKey, properties) {
    if (!tableName) throw new Error('tableName is required.')
    if (partitionKey === undefined || partitionKey === null) throw new Error('partitionKey is required.')
    if (rowKey === undefined || rowKey === null) throw new Error('rowKey is required.')

    const body = { ...(properties || {}), PartitionKey: partitionKey, RowKey: rowKey }

    const response = await this.#apiRequest({
      urlPath: `/${ encodeURIComponent(tableName) }`,
      method: 'post',
      body,
      logTag: 'insertEntity',
    })

    return response || body
  }

  /**
   * @operationName Update Entity (Replace)
   * @category Entities
   * @description Replaces an existing entity identified by PartitionKey and RowKey with the supplied properties. This is a full replace: any property not included in the request is removed from the stored entity. Uses an unconditional update (If-Match:*), overwriting regardless of the current ETag. Fails with a 404 if the entity does not exist. Use Insert-Or-Replace Entity to upsert instead.
   * @route PUT /update-entity
   * @appearanceColor #0078D4 #4093E6
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"dictionary":"getTablesDictionary","description":"Name of the table containing the entity."}
   * @paramDef {"type":"String","label":"Partition Key","name":"partitionKey","required":true,"description":"The PartitionKey of the entity to replace."}
   * @paramDef {"type":"String","label":"Row Key","name":"rowKey","required":true,"description":"The RowKey of the entity to replace."}
   * @paramDef {"type":"Object","label":"Properties","name":"properties","required":false,"description":"The full set of custom properties for the entity as plain JSON. Any omitted property is removed. Merged with PartitionKey and RowKey into the request body."}
   * @returns {Object}
   * @sampleResult {"success":true,"PartitionKey":"us","RowKey":"1"}
   */
  async updateEntity(tableName, partitionKey, rowKey, properties) {
    if (!tableName) throw new Error('tableName is required.')
    if (partitionKey === undefined || partitionKey === null) throw new Error('partitionKey is required.')
    if (rowKey === undefined || rowKey === null) throw new Error('rowKey is required.')

    const body = { ...(properties || {}), PartitionKey: partitionKey, RowKey: rowKey }

    await this.#apiRequest({
      urlPath: this.#entityPath(tableName, partitionKey, rowKey),
      method: 'put',
      body,
      headers: { 'If-Match': '*' },
      logTag: 'updateEntity',
    })

    return { success: true, PartitionKey: partitionKey, RowKey: rowKey }
  }

  /**
   * @operationName Merge Entity
   * @category Entities
   * @description Partially updates an existing entity identified by PartitionKey and RowKey. Only the supplied properties are set or added; properties not included are retained. Uses an unconditional merge (If-Match:*). Fails with a 404 if the entity does not exist. Use Insert-Or-Merge Entity to upsert instead.
   * @route POST /merge-entity
   * @appearanceColor #0078D4 #4093E6
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"dictionary":"getTablesDictionary","description":"Name of the table containing the entity."}
   * @paramDef {"type":"String","label":"Partition Key","name":"partitionKey","required":true,"description":"The PartitionKey of the entity to merge."}
   * @paramDef {"type":"String","label":"Row Key","name":"rowKey","required":true,"description":"The RowKey of the entity to merge."}
   * @paramDef {"type":"Object","label":"Properties","name":"properties","required":false,"description":"Properties to set or add as plain JSON. Omitted properties are retained. Merged with PartitionKey and RowKey into the request body."}
   * @returns {Object}
   * @sampleResult {"success":true,"PartitionKey":"us","RowKey":"1"}
   */
  async mergeEntity(tableName, partitionKey, rowKey, properties) {
    if (!tableName) throw new Error('tableName is required.')
    if (partitionKey === undefined || partitionKey === null) throw new Error('partitionKey is required.')
    if (rowKey === undefined || rowKey === null) throw new Error('rowKey is required.')

    const body = { ...(properties || {}), PartitionKey: partitionKey, RowKey: rowKey }

    // MERGE is issued as POST with the X-HTTP-Method override so it works through
    // standard HTTP verbs. If-Match:* makes it an unconditional (non-upsert) merge.
    await this.#apiRequest({
      urlPath: this.#entityPath(tableName, partitionKey, rowKey),
      method: 'post',
      body,
      headers: { 'If-Match': '*', 'X-HTTP-Method': 'MERGE' },
      logTag: 'mergeEntity',
    })

    return { success: true, PartitionKey: partitionKey, RowKey: rowKey }
  }

  /**
   * @operationName Insert-Or-Replace Entity
   * @category Entities
   * @description Upserts an entity: replaces it if PartitionKey + RowKey already exist, or inserts it otherwise. This is a full replace, so any property not included is removed from the stored entity. No If-Match header is sent, so the operation always succeeds regardless of the current ETag.
   * @route PUT /insert-or-replace-entity
   * @appearanceColor #0078D4 #4093E6
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"dictionary":"getTablesDictionary","description":"Name of the table to upsert into."}
   * @paramDef {"type":"String","label":"Partition Key","name":"partitionKey","required":true,"description":"The PartitionKey of the entity."}
   * @paramDef {"type":"String","label":"Row Key","name":"rowKey","required":true,"description":"The RowKey of the entity."}
   * @paramDef {"type":"Object","label":"Properties","name":"properties","required":false,"description":"The full set of custom properties as plain JSON. Any omitted property is removed. Merged with PartitionKey and RowKey into the request body."}
   * @returns {Object}
   * @sampleResult {"success":true,"PartitionKey":"us","RowKey":"1"}
   */
  async insertOrReplaceEntity(tableName, partitionKey, rowKey, properties) {
    if (!tableName) throw new Error('tableName is required.')
    if (partitionKey === undefined || partitionKey === null) throw new Error('partitionKey is required.')
    if (rowKey === undefined || rowKey === null) throw new Error('rowKey is required.')

    const body = { ...(properties || {}), PartitionKey: partitionKey, RowKey: rowKey }

    await this.#apiRequest({
      urlPath: this.#entityPath(tableName, partitionKey, rowKey),
      method: 'put',
      body,
      logTag: 'insertOrReplaceEntity',
    })

    return { success: true, PartitionKey: partitionKey, RowKey: rowKey }
  }

  /**
   * @operationName Insert-Or-Merge Entity
   * @category Entities
   * @description Upserts an entity: merges into it if PartitionKey + RowKey already exist, or inserts it otherwise. Only the supplied properties are set or added; existing properties not included are retained. No If-Match header is sent, so the operation always succeeds regardless of the current ETag.
   * @route POST /insert-or-merge-entity
   * @appearanceColor #0078D4 #4093E6
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"dictionary":"getTablesDictionary","description":"Name of the table to upsert into."}
   * @paramDef {"type":"String","label":"Partition Key","name":"partitionKey","required":true,"description":"The PartitionKey of the entity."}
   * @paramDef {"type":"String","label":"Row Key","name":"rowKey","required":true,"description":"The RowKey of the entity."}
   * @paramDef {"type":"Object","label":"Properties","name":"properties","required":false,"description":"Properties to set or add as plain JSON. Omitted properties are retained. Merged with PartitionKey and RowKey into the request body."}
   * @returns {Object}
   * @sampleResult {"success":true,"PartitionKey":"us","RowKey":"1"}
   */
  async insertOrMergeEntity(tableName, partitionKey, rowKey, properties) {
    if (!tableName) throw new Error('tableName is required.')
    if (partitionKey === undefined || partitionKey === null) throw new Error('partitionKey is required.')
    if (rowKey === undefined || rowKey === null) throw new Error('rowKey is required.')

    const body = { ...(properties || {}), PartitionKey: partitionKey, RowKey: rowKey }

    // Upsert-merge: MERGE verb via override header, and no If-Match so it also inserts.
    await this.#apiRequest({
      urlPath: this.#entityPath(tableName, partitionKey, rowKey),
      method: 'post',
      body,
      headers: { 'X-HTTP-Method': 'MERGE' },
      logTag: 'insertOrMergeEntity',
    })

    return { success: true, PartitionKey: partitionKey, RowKey: rowKey }
  }

  /**
   * @operationName Delete Entity
   * @category Entities
   * @description Permanently deletes a single entity identified by PartitionKey and RowKey. Uses an unconditional delete (If-Match:*), removing the entity regardless of its current ETag. Fails with a 404 if the entity does not exist.
   * @route DELETE /delete-entity
   * @appearanceColor #0078D4 #4093E6
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"dictionary":"getTablesDictionary","description":"Name of the table containing the entity."}
   * @paramDef {"type":"String","label":"Partition Key","name":"partitionKey","required":true,"description":"The PartitionKey of the entity to delete."}
   * @paramDef {"type":"String","label":"Row Key","name":"rowKey","required":true,"description":"The RowKey of the entity to delete."}
   * @returns {Object}
   * @sampleResult {"success":true,"PartitionKey":"us","RowKey":"1"}
   */
  async deleteEntity(tableName, partitionKey, rowKey) {
    if (!tableName) throw new Error('tableName is required.')
    if (partitionKey === undefined || partitionKey === null) throw new Error('partitionKey is required.')
    if (rowKey === undefined || rowKey === null) throw new Error('rowKey is required.')

    await this.#apiRequest({
      urlPath: this.#entityPath(tableName, partitionKey, rowKey),
      method: 'delete',
      headers: { 'If-Match': '*' },
      logTag: 'deleteEntity',
    })

    return { success: true, PartitionKey: partitionKey, RowKey: rowKey }
  }

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================

  /**
   * @typedef {Object} getTablesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional case-insensitive substring to filter table names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (NextTableName continuation token) from a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tables Dictionary
   * @category Tables
   * @description Lists tables in the storage account for selection in dependent parameters. Supports substring search over table names and continuation-token pagination.
   * @route POST /get-tables-dictionary
   * @paramDef {"type":"getTablesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Customers","value":"Customers","note":"Table"}],"cursor":null}
   */
  async getTablesDictionary(payload) {
    const { search, cursor } = payload || {}

    const query = {}

    if (cursor) query.NextTableName = cursor

    const response = await this.#apiRequest({
      urlPath: '/Tables',
      method: 'get',
      query,
      logTag: 'getTablesDictionary',
      unwrap: true,
    })

    const headers = response?.headers || {}
    let tables = response?.body?.value || []

    if (search) {
      const needle = String(search).toLowerCase()

      tables = tables.filter(table => String(table.TableName || '').toLowerCase().includes(needle))
    }

    return {
      items: tables.map(table => ({ label: table.TableName, value: table.TableName, note: 'Table' })),
      cursor: headers['x-ms-continuation-nexttablename'] || null,
    }
  }
}

Flowrunner.ServerCode.addService(AzureTableStorage, [
  {
    name: 'accountName',
    displayName: 'Account Name',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Azure Storage account name, e.g. mystorageacct.',
  },
  {
    name: 'accountKey',
    displayName: 'Account Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Azure Portal → Storage account → Access keys → key1 (base64-encoded key).',
  },
])
