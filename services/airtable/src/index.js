'use strict'
const { generateCodeVerifier, generateCodeChallenge, searchFilter } = require('./utils')

const OAUTH_BASE_URL = 'https://airtable.com/oauth2/v1'
const API_BASE_URL = 'https://api.airtable.com/v0'

const DEFAULT_SCOPE_LIST = [
  'schema.bases:read',
  'user.email:read',
  'webhook:manage',
  'schema.bases:write',
  'data.records:read',
  'data.records:write',
  'data.recordComments:read',
  'data.recordComments:write',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const DEFAULT_LIMIT = 100

const logger = {
  info: (...args) => console.log('[Airtable Service] info:', ...args),
  debug: (...args) => console.log('[Airtable Service] debug:', ...args),
  error: (...args) => console.log('[Airtable Service] error:', ...args),
  warn: (...args) => console.log('[Airtable Service] warn:', ...args),
}

class ResponseError extends Error {
  constructor(message, httpStatusCode, data) {
    super(message)

    this.message = message
    this.httpStatusCode = httpStatusCode
    this.data = data
  }

  toJSON() {
    return {
      message: this.message,
      httpStatusCode: this.httpStatusCode,
      data: this.data,
    }
  }
}

/**
 *  @requireOAuth
 *  @integrationName Airtable
 *  @integrationTriggersScope SINGLE_APP
 *  @integrationIcon /icon.webp
 **/
class Airtable {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      return await Flowrunner.Request[method](url)
        .set(this.#getAccessTokenHeader())
        .query(query)
        .send(body)
    } catch (error) {
      if (error.body?.error) {
        const airtableError = error
        const airtableErrorBody = error.body?.error

        delete airtableError.headers // to keep log message much cleaner

        logger.debug(`${ logTag } - api error: ${ JSON.stringify(airtableError) }`)
        logger.debug(`${ logTag } - airtableErrorBody: ${ JSON.stringify(airtableErrorBody) }`)

        let errorMessage = airtableErrorBody // it can be an object {message:"..."} or a string

        if (typeof airtableErrorBody === 'object') {
          errorMessage = airtableErrorBody.message || airtableErrorBody.type
        }

        error = new ResponseError(`[AirtableError]: ${ errorMessage }`, airtableError.status, {
          type: airtableErrorBody.type,
        })
      }

      logger.error(`${ logTag } - error: ${ error.message }`)

      throw error
    }
  }

  #getAccessTokenHeader(accessToken) {
    return {
      Authorization: `Bearer ${ accessToken || this.request.headers['oauth-access-token'] }`,
    }
  }

  #getSecretTokenHeader() {
    const token = Buffer.from(`${ this.clientId }:${ this.clientSecret }`).toString('base64')

    return {
      Authorization: `Basic ${ token }`,
    }
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    const codeVerifier = generateCodeVerifier()
    const codeChallenge = generateCodeChallenge(codeVerifier)

    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('scope', this.scopes)
    params.append('code_challenge', codeChallenge)
    params.append('code_challenge_method', 'S256')
    params.append('state', codeVerifier)

    return `${ OAUTH_BASE_URL }/authorize?${ params.toString() }`
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   *
   * @property {String} token
   * @property {Number} [expirationInSeconds]
   */

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    const params = new URLSearchParams()

    params.append('grant_type', 'refresh_token')
    params.append('refresh_token', refreshToken)

    try {
      const response = await Flowrunner.Request.post(`${ OAUTH_BASE_URL }/token`)
        .set(this.#getSecretTokenHeader())
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      return {
        token: response.access_token,
        expirationInSeconds: response.expires_in,
        refreshToken: response.refresh_token || refreshToken,
      }
    } catch (error) {
      logger.error(`refreshToken: ${ error.message }`)

      throw error
    }
  }

  /**/

  /**
   * @typedef {Object} executeCallback_ResultObject
   *
   * @property {String} token
   * @property {String} [refreshToken]
   * @property {Number} [expirationInSeconds]
   * @property {Object} [userData]
   * @property {Boolean} [overwrite]
   * @property {String} connectionIdentityName
   * @property {String} [connectionIdentityImageURL]
   */

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    const params = new URLSearchParams()

    params.append('grant_type', 'authorization_code')
    params.append('client_secret', this.clientSecret)
    params.append('code', callbackObject.code)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('code_verifier', callbackObject['state'])

    let codeExchangeResponse = {}

    try {
      codeExchangeResponse = await Flowrunner.Request.post(`${ OAUTH_BASE_URL }/token`)
        .set(this.#getSecretTokenHeader())
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      logger.debug(`[executeCallback] codeExchangeResponse response: ${ JSON.stringify(codeExchangeResponse) }`)
    } catch (error) {
      logger.error(`[executeCallback] codeExchangeResponse error: ${ error.message }`)

      return {}
    }

    let userInfo = {}

    try {
      userInfo = await Flowrunner.Request
        .get(`${ API_BASE_URL }/meta/whoami`)
        .set(this.#getAccessTokenHeader(codeExchangeResponse['access_token']))

      logger.debug(`[executeCallback] userInfo response: ${ JSON.stringify(userInfo) }`)
    } catch (error) {
      logger.error(`[executeCallback] userInfo error: ${ error.message }`)

      return {}
    }

    return {
      token: codeExchangeResponse['access_token'],
      expirationInSeconds: codeExchangeResponse['expires_in'],
      refreshToken: codeExchangeResponse['refresh_token'],
      connectionIdentityName: userInfo.email || 'Unknown Airtable Account',
      connectionIdentityImageURL: null, // Airtable does not provide public account avatar
      overwrite: true,
      userData: userInfo,
    }
  }

  // /**
  //  * @private
  //  */
  // async getCurrentAccountInfo() {
  //   return this.#apiRequest({
  //     logTag: 'getCurrentAccountInfo',
  //     url: `${API_BASE_URL}/meta/whoami`,
  //   })
  // }

  async #getAllTablesSchema(baseId) {
    const { tables } = await this.#apiRequest({
      logTag: 'getAllTablesSchema',
      url: `${ API_BASE_URL }/meta/bases/${ baseId }/tables`,
    })

    return tables
  }

  async #getTableSchema(baseId, tableIdOrName) {
    const tables = await this.#getAllTablesSchema(baseId)

    return tables.find(table => {
      return table.id === tableIdOrName || table.name === tableIdOrName
    })
  }

  // ========================================== DICTIONARIES ===========================================

  /**
   * @typedef {Object} DictionaryPayload
   * @property {String} [search]
   * @property {String} [cursor]
   * @property {Object} [criteria]
   */

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
   * @typedef {Object} getBasesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter bases by their name or ID. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Bases
   * @description Returns a paginated list of Airtable bases accessible by the authenticated user. Supports search filtering to find specific bases by name or ID.
   * @category Bases
   *
   * @route POST /get-bases
   *
   * @paramDef {"type":"getBasesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering bases."}
   *
   * @sampleResult {"cursor":"next_page_offset","items":[{"label":"My Workspace","note":"ID: appABC123XYZ","value":"appABC123XYZ"}]}
   * @returns {DictionaryResponse}
   */
  async getBasesDictionary({ search, cursor }) {
    const { bases, offset } = await this.#apiRequest({
      logTag: 'getBasesDictionary',
      url: `${ API_BASE_URL }/meta/bases`,
      query: {
        offset: cursor,
      },
    })

    const filteredBases = search
      ? searchFilter(bases, ['id', 'name'], search)
      : bases

    return {
      cursor: offset,
      items: filteredBases.map(({ id, name }) => ({
        label: name || '[empty]',
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @typedef {Object} getTablesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Base ID","name":"baseId","required":true,"description":"Unique identifier of the Airtable base for which to list tables."}
   */

  /**
   * @typedef {Object} getTablesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter tables by their name or ID. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"getTablesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters to identify the specific Airtable record."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tables
   * @description Returns a list of tables for the specified Airtable base. Supports search filtering to find specific tables by name or ID.
   * @category Tables
   *
   * @route POST /get-tables
   *
   * @paramDef {"type":"getTablesDictionary__payload","label":"Payload","name":"payload","description":"Contains base ID and optional search string for retrieving and filtering tables."}
   *
   * @sampleResult {"items":[{"label":"Tasks","note":"ID: tbl7bQ6QQHL6zqBq1","value":"tbl7bQ6QQHL6zqBq1"}]}
   * @returns {DictionaryResponse}
   */
  async getTablesDictionary({ search, criteria: { baseId } }) {
    const { tables } = await this.#apiRequest({
      logTag: 'getTablesDictionary',
      url: `${ API_BASE_URL }/meta/bases/${ baseId }/tables`,
    })

    const filteredTables = search
      ? searchFilter(tables, ['id', 'name'], search)
      : tables

    return {
      items: filteredTables.map(({ id, name }) => ({
        label: name || '[empty]',
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @typedef {Object} getFieldsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Base ID","name":"baseId","required":true,"description":"Unique identifier of the Airtable base containing the table."}
   * @paramDef {"type":"String","label":"Table ID or Name","name":"tableIdOrName","required":true,"description":"Identifier or name of the table within the base whose fields will be listed."}
   */

  /**
   * @typedef {Object} getFieldsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter fields by their name or ID. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"getFieldsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters to identify the specific table within an Airtable base."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Fields
   * @description Returns a list of fields for the specified table in an Airtable base. Supports search filtering to find specific fields by name or ID.
   * @category data-fields
   *
   * @route POST /get-fields
   *
   * @paramDef {"type":"getFieldsDictionary__payload","label":"Payload","name":"payload","description":"Contains base ID, table ID or name, and optional search string for retrieving and filtering fields."}
   *
   * @sampleResult {"items":[{"label":"Name","note":"ID: fldABC123","value":"fldABC123"}]}
   * @returns {DictionaryResponse}
   */
  async getFieldsDictionary({ search, criteria: { baseId, tableIdOrName } }) {
    const { tables } = await this.#apiRequest({
      logTag: 'getFieldsDictionary',
      url: `${ API_BASE_URL }/meta/bases/${ baseId }/tables`,
    })

    const currentTable = tables.find(table => table.id === tableIdOrName)
    const filteredFields = search
      ? searchFilter(currentTable.fields, ['id', 'name'], search)
      : currentTable.fields

    return {
      items: filteredFields.map(({ id, name }) => ({
        label: name || '[empty]',
        note: `ID: ${ id }`,
        value: name,
      })),
    }
  }

  /**
   * @typedef {Object} getLastModifiedColumnsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Base ID","name":"baseId","required":true,"description":"Unique identifier of the Airtable base containing the table."}
   * @paramDef {"type":"String","label":"Table ID or Name","name":"tableIdOrName","required":true,"description":"Identifier or name of the table within the base whose last modified columns will be listed."}
   */

  /**
   * @typedef {Object} getLastModifiedColumnsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter fields by their name or ID. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"getLastModifiedColumnsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters to identify the specific table within an Airtable base."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Last Modified Columns
   * @description Returns a list of last modified time columns for the specified table in an Airtable base. These timestamp fields track when records were last updated and are essential for trigger configuration.
   * @category data-fields
   *
   * @route POST /get-last-modified-columns
   *
   * @paramDef {"type":"getLastModifiedColumnsDictionary__payload","label":"Payload","name":"payload","description":"Contains base ID, table ID or name, and optional search string for retrieving and filtering last modified columns."}
   *
   * @sampleResult {"items":[{"label":"Last Modified","note":"ID: fldABC123","value":"Last Modified"}]}
   * @returns {DictionaryResponse}
   */
  async getLastModifiedColumnsDictionary({ search, criteria: { baseId, tableIdOrName } }) {
    const table = await this.#getTableSchema(baseId, tableIdOrName)
    const tableFields = table?.fields || []

    const lastModifiedColumns = tableFields.filter(field => {
      return field.type === 'lastModifiedTime'
    })

    const filteredFields = search
      ? searchFilter(lastModifiedColumns, ['id', 'name'], search)
      : lastModifiedColumns

    return {
      items: filteredFields.map(({ id, name }) => ({
        label: name || '[empty]',
        note: `ID: ${ id }`,
        value: name,
      })),
    }
  }

  /**
   * @typedef {Object} getRecordsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Base ID","name":"baseId","required":true,"description":"Unique identifier of the Airtable base containing the table."}
   * @paramDef {"type":"String","label":"Table ID or Name","name":"tableIdOrName","required":true,"description":"Identifier or name of the table within the base whose records will be listed."}
   */

  /**
   * @typedef {Object} getRecordsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter records by their ID. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"getRecordsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters to identify the specific table within an Airtable base."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Records
   * @description Returns a list of records for the specified table in an Airtable base. Useful for selecting specific records for operations like updates, deletions, or data retrieval.
   * @category Records
   *
   * @route POST /get-records
   *
   * @paramDef {"type":"getRecordsDictionary__payload","label":"Payload","name":"payload","description":"Contains base ID, table ID or name, and optional search string for retrieving and filtering records."}
   *
   * @sampleResult {"items":[{"label":"recABC123","note":"ID: recABC123","value":"recABC123"}]}
   * @returns {DictionaryResponse}
   */
  async getRecordsDictionary({ search, criteria: { baseId, tableIdOrName } }) {
    const { records } = await this.#apiRequest({
      logTag: 'getRecordsDictionary',
      url: `${ API_BASE_URL }/${ baseId }/${ tableIdOrName }`,
    })

    const filteredRecords = search
      ? searchFilter(records, ['id'], search)
      : records

    return {
      items: filteredRecords.map(({ id }) => ({
        label: id,
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @typedef {Object} getCommentsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Base ID","name":"baseId","required":true,"description":"Unique identifier of the Airtable base."}
   * @paramDef {"type":"String","label":"Table ID or Name","name":"tableIdOrName","required":true,"description":"Identifier or name of the table within the base."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"description":"Unique identifier of the record whose comments will be listed."}
   */

  /**
   * @typedef {Object} getCommentsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter comments by their ID or text content. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results (page size: 100 items)."}
   * @paramDef {"type":"getCommentsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters to identify the specific record within an Airtable base."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Comments
   * @description Returns a paginated list of comments for the specified record in an Airtable table. Useful for selecting specific comments for operations like updates or deletions.
   * @category Comments
   *
   * @route POST /get-comments
   *
   * @paramDef {"type":"getCommentsDictionary__payload","label":"Payload","name":"payload","description":"Contains base ID, table ID or name, record ID, optional search string, and pagination cursor for retrieving and filtering comments."}
   *
   * @sampleResult {"cursor":"next_page_offset","items":[{"label":"This is a sample comment text","note":"ID: comment_123abc","value":"comment_123abc"}]}
   * @returns {DictionaryResponse}
   */
  async getCommentsDictionary({ search, cursor, criteria: { baseId, tableIdOrName, recordId } }) {
    const { comments, offset } = await this.#apiRequest({
      logTag: 'getCommentsDictionary',
      url: `${ API_BASE_URL }/${ baseId }/${ tableIdOrName }/${ recordId }/comments`,
      query: {
        pageSize: DEFAULT_LIMIT,
        offset: cursor,
      },
    })

    const filteredComments = search
      ? searchFilter(comments, ['id', 'text'], search)
      : comments

    return {
      cursor: offset,
      items: filteredComments.map(({ id, text }) => ({
        label: text || '[empty]',
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  // ======================================= END OF DICTIONARIES =======================================

  /**
   * @description Retrieves all accessible Airtable bases for the authenticated user. Perfect for AI agents to discover available workspaces and their access permissions before performing data operations.
   *
   * @route GET /getBases
   * @operationName Get All Bases
   * @category Bases
   *
   * @appearanceColor #25B5F8 #FFBE00
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes schema.bases:read
   *
   * @returns {Array} Returns the list of bases the token can access, 1000 bases at a time.
   * @sampleResult [{"id":"example_id_ICXNqxSDhG","name":"Example Name","permissionLevel":"create"},{"id":"example_id_5uCNmRmfl6","name":"Example Name 2","permissionLevel":"edit"}]
   */
  async getBases() {
    const result = await this.#apiRequest({
      logTag: 'getBases',
      url: `${ API_BASE_URL }/meta/bases`,
    })

    return result.bases
  }

  /**
   * @description Retrieves the complete schema for an Airtable base, including all tables, fields, views, and their configurations. Essential for AI agents to understand data structure before performing operations.
   *
   * @route GET /getBaseSchema
   * @operationName Get Base Schema
   * @category Bases
   *
   * @appearanceColor #25B5F8 #FFBE00
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes schema.bases:read
   *
   * @paramDef {"type":"String","label":"Base ID","name":"baseId","required":true,"dictionary":"getBasesDictionary","description":"The unique identifier of the base whose schema you want to retrieve."}
   *
   * @returns {Object} Returns the schema of the tables in the specified base.
   * @sampleResult {"tables":[{"description":"Example Description","fields":[{"description":"Example Field Description","id":"example_id_123456","name":"Example Field Name","type":"singleLineText"}],"id":"example_id_654321","name":"Example Table Name","primaryFieldId":"example_id_111111","views":[{"id":"example_id_222222","name":"Example View Name","type":"grid"}]}]}
   */
  async getBaseSchema(baseId) {
    return this.#apiRequest({
      logTag: 'getBaseSchema',
      url: `${ API_BASE_URL }/meta/bases/${ baseId }/tables`,
    })
  }

  /**
   * @description Creates a new Airtable base with specified tables and initial structure. Perfect for AI agents to dynamically provision new workspaces and data structures for projects or applications.
   *
   * @route POST /createBase
   * @operationName Create Base
   * @category Bases
   *
   * @appearanceColor #25B5F8 #FFBE00
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes schema.bases:write
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the new base."}
   * @paramDef {"type":"Array.<Object>","label":"Tables","name":"tables","required":true,"description":"Array of table definitions to create in the base. Each table should include name, fields, and description."}
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"description":"The ID of the workspace where the base will be created. Find this in your Airtable workspace URL."}
   *
   * @returns {Object} Returns the schema for the newly created base.
   * @sampleResult {"id": "example_id_SL098jqM", "tables": [{"description": "Example Table Description", "fields": [{"description": "Example Field Description", "id": "example_id_field1", "name": "Example Field Name", "type": "singleLineText"}, {"id": "example_id_field2", "name": "Example Field", "type": "singleLineText"}], "id": "example_id_table", "name": "Example Table Name", "primaryFieldId": "example_id_primary_field", "views": [{"id": "example_id_view", "name": "Example View Name", "type": "grid"}]}]}
   */
  async createBase(name, tables, workspaceId) {
    if (!Array.isArray(tables)) {
      tables = []
    }

    return this.#apiRequest({
      logTag: 'createBase',
      url: `${ API_BASE_URL }/meta/bases`,
      method: 'post',
      body: {
        name,
        tables,
        workspaceId,
      },
    })
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    return this[invocation.eventName](invocation)
  }

  /**
   * @operationName On New or Updated Record
   * @description Continuously monitors an Airtable table for new or updated records using configurable polling intervals. Perfect for AI agents that need real-time data synchronization and automated responses to data changes. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   * @category Records
   *
   * @route POST /onNewOrUpdatedRecord
   * @appearanceColor #25B5F8 #FFBE00
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Base ID","name":"baseId","required":true,"dictionary":"getBasesDictionary","description":"The ID of the base where the table to monitor is located."}
   * @paramDef {"type":"String","label":"Table ID Or Name","name":"tableIdOrName","required":true,"dictionary":"getTablesDictionary","dependsOn":["baseId"],"description":"The ID or name of the table to monitor for new or updated records."}
   * @paramDef {"type":"String","label":"Last Modified Column","name":"lastModifiedColumn","required":true,"dictionary":"getLastModifiedColumnsDictionary","dependsOn":["baseId","tableIdOrName"],"description":"The 'Last Modified Time' field that tracks when records are changed. This timestamp field enables the trigger to detect and process only the most recently modified records."}
   *
   * @returns {Object} Return new or updated record
   * @sampleResultLoader { "methodName":"onNewOrUpdatedRecord_SampleResultLoader", "dependsOn":["baseId", "tableIdOrName"] }
   */
  async onNewOrUpdatedRecord(invocation) {
    const { baseId, tableIdOrName, lastModifiedColumn } = invocation.triggerData

    const records = await this.#getLatestRecords(baseId, tableIdOrName, lastModifiedColumn)

    if (invocation.learningMode) {
      const record = records[0]

      logger.debug(`[onNewOrUpdatedRecord] learningMode record.id=${ record?.id }`)

      return {
        events: [record],
        state: null,
      }
    }

    if (!invocation.state?.records) {
      logger.debug(`[onNewOrUpdatedRecord] init with records.length=${ records.length }`)

      return {
        events: [],
        state: { records },
      }
    }

    const prevRecords = new Map(
      invocation.state.records.map(({ id, fields }) => [
        id,
        fields[lastModifiedColumn],
      ])
    )

    const newOrUpdatedRecords = records.filter(
      record => !prevRecords.has(record.id) || record.fields[lastModifiedColumn] !== prevRecords.get(record.id)
    )

    logger.debug(`[onNewOrUpdatedRecord] events.length=${ newOrUpdatedRecords.length }`)

    return {
      events: newOrUpdatedRecords,
      state: { records },
    }
  }

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   *
   * @route POST /onNewOrUpdatedRecord_SampleResultLoader
   * @param {Object} payload
   */
  async onNewOrUpdatedRecord_SampleResultLoader({ criteria }) {
    const { baseId, tableIdOrName } = criteria

    const result = await this.#apiRequest({
      logTag: 'onNewOrUpdatedRecord_SampleResultLoader',
      url: `${ API_BASE_URL }/${ baseId }/${ tableIdOrName }`,
      query: {
        pageSize: 1,
      },
    })

    const record = (result?.records || [])[0]

    if (record) {
      const table = await this.#getTableSchema(baseId, tableIdOrName)
      const tableFields = table?.fields || []

      tableFields.forEach(field => {
        if (!(field.name in record.fields)) {
          record.fields[field.name] = null
        }
      })
    }

    return record || {}
  }

  /**
   * @operationName On New Record
   * @description Monitors an Airtable table for newly created records using configurable polling intervals. Perfect for triggering workflows when fresh data is added. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   * @category Records
   *
   * @route POST /onNewRecord
   * @executionTimeoutInSeconds 120
   * @appearanceColor #25B5F8 #FFBE00
   *
   * @paramDef {"type":"String","label":"Base ID","name":"baseId","required":true,"dictionary":"getBasesDictionary","description":"The ID of the base where the table to monitor for new records is located."}
   * @paramDef {"type":"String","label":"Table ID Or Name","name":"tableIdOrName","required":true,"dictionary":"getTablesDictionary","dependsOn":["baseId"],"description":"The ID or name of the table to monitor for new records."}
   *
   * @returns {Object} Return new record
   * @sampleResultLoader { "methodName":"onNewOrUpdatedRecord_SampleResultLoader", "dependsOn":["baseId", "tableIdOrName"] }
   */
  async onNewRecord(invocation) {
    const { baseId, tableIdOrName } = invocation.triggerData

    const createdColumn = await this.#getCreatedColumnName(baseId, tableIdOrName)
    const records = await this.#getLatestRecords(baseId, tableIdOrName, createdColumn)

    if (invocation.learningMode) {
      return {
        events: [records[0]],
        state: null,
      }
    }

    if (!invocation.state?.records) {
      return {
        events: [],
        state: { records },
      }
    }

    const prevRecords = new Set(invocation.state.records.map(({ id }) => id))

    const newRecords = records.filter(record => !prevRecords.has(record.id))

    return {
      events: newRecords,
      state: { records },
    }
  }

  async #getCreatedColumnName(baseId, tableIdOrName) {
    const { tables } = await this.#apiRequest({
      logTag: 'getCreatedColumnName',
      url: `${ API_BASE_URL }/meta/bases/${ baseId }/tables`,
    })

    const currentTable = tables.find(table => table.id === tableIdOrName)
    const createdColumn = currentTable.fields.find(field => field.type === 'createdTime')

    if (!createdColumn) {
      throw new Error(`There is no a column with type "createdTime" in the "${ tableIdOrName }" table`)
    }

    return createdColumn.name
  }

  async #getLatestRecords(baseId, tableIdOrName, sortByColumn) {
    const result = await this.#apiRequest({
      logTag: 'getLatestRecords',
      url: `${ API_BASE_URL }/${ baseId }/${ tableIdOrName }`,
      query: {
        'sort[0][field]': sortByColumn,
        'sort[0][direction]': 'desc',
      },
    })

    return result?.records || []
  }

  /**
   * @description Creates a new table within an existing Airtable base with specified fields and structure. Ideal for AI agents to dynamically provision data storage as needed for different use cases.
   *
   * @route POST /createTable
   * @operationName Create Table
   * @category Tables
   *
   * @appearanceColor #25B5F8 #FFBE00
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes schema.bases:write
   *
   * @paramDef {"type":"String","label":"Base ID","name":"baseId","required":true,"dictionary":"getBasesDictionary","description":"The ID of the base where the table will be created."}
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"description":"The name of the table to be created."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Optional description of the table's purpose and content."}
   * @paramDef {"type":"Array.<Object>","label":"Fields","name":"fields","required":true,"description":"Array of field definitions, where each field includes name, type, and optional configuration."}
   *
   * @returns {Object} The response from the Airtable API with the created table details.
   * @sampleResult {"description":"Example Description","fields":[{"description":"Example Field Description","id":"example_id_field_1","name":"Example Name","type":"singleLineText"}],"id":"example_id_table_1","name":"Example Table Name","primaryFieldId":"example_id_field_1","views":[{"id":"example_id_view_1","name":"Example View Name","type":"grid"}]}
   */
  async createTable(baseId, tableName, description, fields) {
    if (!Array.isArray(fields)) {
      fields = []
    }

    return this.#apiRequest({
      logTag: 'createTable',
      url: `${ API_BASE_URL }/meta/bases/${ baseId }/tables`,
      method: 'post',
      body: {
        name: tableName,
        description: description || '',
        fields,
      },
    })
  }

  /**
   * @description Updates the name and/or description of an existing table. Useful for AI agents to maintain organized data structures as requirements evolve.
   *
   * @route PUT /updateTable
   * @operationName Update Table
   * @category Tables
   *
   * @appearanceColor #25B5F8 #FFBE00
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes schema.bases:write
   *
   * @paramDef {"type":"String","label":"Base ID","name":"baseId","required":true,"dictionary":"getBasesDictionary","description":"The ID of the base containing the table to update."}
   * @paramDef {"type":"String","label":"Table ID Or Name","name":"tableIdOrName","required":true,"dictionary":"getTablesDictionary","dependsOn":["baseId"],"description":"The ID or name of the table to be updated."}
   * @paramDef {"type":"String","label":"New Name","name":"newName","description":"Optional new name for the table. Leave blank to keep current name."}
   * @paramDef {"type":"String","label":"New Description","name":"newDescription","description":"Optional new description for the table. Leave blank to keep current description."}
   *
   * @returns {Object} The response from the Airtable API with the updated table details.
   * @sampleResult {"description":"Example Description","fields":[{"description":"Example Field Description","id":"example_id_field_1","name":"Example Name","type":"singleLineText"}],"id":"example_id_table_1","name":"Example Table Name","primaryFieldId":"example_id_field_1","views":[{"id":"example_id_view_1","name":"Example View Name","type":"grid"}]}
   */
  async updateTable(baseId, tableIdOrName, newName, newDescription) {
    const body = {}

    if (newName) {
      body.name = newName
    }

    if (newDescription) {
      body.description = newDescription
    }

    const result = await this.#apiRequest({
      logTag: 'updateTable',
      url: `${ API_BASE_URL }/meta/bases/${ baseId }/tables/${ tableIdOrName }`,
      method: 'patch',
      body,
    })

    delete result.fields

    return result
  }

  /**
   * @description Retrieves a single record from an Airtable table using flexible search options. Perfect for AI agents to locate specific records based on field values or complex search formulas.
   *
   * @route GET /findRecord
   * @operationName Find Record
   * @category Records
   *
   * @appearanceColor #25B5F8 #FFBE00
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes data.records:read
   *
   * @paramDef {"type":"String","label":"Base ID","name":"baseId","required":true,"dictionary":"getBasesDictionary","description":"The ID of the Airtable base."}
   * @paramDef {"type":"String","label":"Table ID Or Name","name":"tableIdOrName","required":true,"dictionary":"getTablesDictionary","dependsOn":["baseId"],"description":"The ID of the table where the record exists."}
   * @paramDef {"type":"String","label":"Search by Field","name":"searchByField","dictionary":"getFieldsDictionary","dependsOn":["baseId","tableIdOrName"],"description":"Select a field from the base to match against the search value."}
   * @paramDef {"type":"String","label":"Search Value","name":"searchValue","description":"The value to search for in the specified field. For dates, use ISO format (YYYY-MM-DD). For text, exact or partial matching is supported based on the exactMatch setting."}
   * @paramDef {"type":"Boolean","label":"Search for Exact Match","name":"exactMatch","uiComponent":{"type":"TOGGLE"},"description":"When enabled, searches for exact matches only. Disable for partial text matching or when searching date fields with ranges."}
   * @paramDef {"type":"String","label":"Search Formula","name":"searchFormula","description":"Advanced: Use Airtable formula syntax for complex searches. Example: 'AND({Name} = \"John\", {Age} > 25)'. Overrides simple field-based search when provided."}
   *
   * @returns {Object} The first matching record object containing id, fields, and createdTime, or null if no record is found.
   * @sampleResult {"createdTime":"2022-09-12T21:03:48.000Z","fields":{"Name":"John Doe","Email":"john@example.com","Status":"Active"},"id":"recABC123XYZ"}
   */
  async findRecord(baseId, tableIdOrName, searchByField, searchValue, exactMatch, searchFormula) {
    logger.debug('findRecord - run the "findRecords" method')

    const records = await this.findRecords(
      baseId,
      tableIdOrName,
      searchByField,
      searchValue,
      exactMatch,
      searchFormula,
      1
    )

    return records && records[0]
  }

  /**
   * @description Retrieves multiple records from an Airtable table using flexible search criteria and formulas. Supports both simple field-based searches and complex Airtable formula syntax for advanced filtering.
   *
   * @route GET /findRecords
   * @operationName Find Many Records
   * @category Records
   *
   * @appearanceColor #25B5F8 #FFBE00
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes data.records:read
   *
   * @paramDef {"type":"String","label":"Base ID","name":"baseId","required":true,"dictionary":"getBasesDictionary","description":"The ID of the Airtable base."}
   * @paramDef {"type":"String","label":"Table ID Or Name","name":"tableIdOrName","required":true,"dictionary":"getTablesDictionary","dependsOn":["baseId"],"description":"The ID of the table where the record exists."}
   * @paramDef {"type":"String","label":"Search by Field","name":"searchByField","dictionary":"getFieldsDictionary","dependsOn":["baseId","tableIdOrName"],"description":"Select a field from the base to match against the search value."}
   * @paramDef {"type":"String","label":"Search Value","name":"searchValue","description":"The value to search for in the specified field. For dates, use ISO format (YYYY-MM-DD)."}
   * @paramDef {"type":"Boolean","label":"Search for Exact Match","name":"exactMatch","uiComponent":{"type":"TOGGLE"},"description":"When enabled, searches for exact matches only. Disable for partial text matching or when searching date fields."}
   * @paramDef {"type":"String","label":"Search Formula","name":"searchFormula","description":"Advanced Airtable formula syntax for complex searches. Example: 'AND({Name} = \"John\", {Age} > 25)'. Overrides simple field-based search."}
   * @paramDef {"type":"Number","label":"Max Records","name":"maxRecords","description":"Maximum number of records to return. Limit is 100 records per request."}
   *
   * @returns {Array} Returns list of records with fields and cell values.
   * @sampleResult [{"createdTime":"2022-09-12T21:03:48.000Z","fields":{},"id":"example_id_record_1"}]
   */
  async findRecords(baseId, tableIdOrName, searchByField, searchValue, exactMatch, searchFormula, maxRecords) {
    const query = {}

    if (maxRecords) {
      query.maxRecords = maxRecords
    }

    if (searchFormula) {
      query.filterByFormula = searchFormula
    } else if (searchByField && searchValue !== undefined) {
      query.filterByFormula = exactMatch
        ? `{${ searchByField }} = ${ JSON.stringify(searchValue) }`
        : `SEARCH('${ searchValue }', {${ searchByField }} & "") > 0`
    }

    const result = await this.#apiRequest({
      logTag: 'findRecords',
      url: `${ API_BASE_URL }/${ baseId }/${ tableIdOrName }`,
      query,
    })

    return result?.records
  }

  /**
   * @description Intelligently updates an existing record if found, or creates a new record if none exists. Perfect for AI agents implementing upsert operations without manual record existence checks.
   *
   * @route POST /createOrUpdateRecord
   * @operationName Create or Update Record
   * @category Records
   *
   * @appearanceColor #25B5F8 #FFBE00
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes data.records:write
   *
   * @paramDef {"type":"String","label":"Base ID","name":"baseId","required":true,"dictionary":"getBasesDictionary","description":"The ID of the Airtable base."}
   * @paramDef {"type":"String","label":"Table ID Or Name","name":"tableIdOrName","required":true,"dictionary":"getTablesDictionary","dependsOn":["baseId"],"description":"The ID of the table where the record exists."}
   * @paramDef {"type":"String","label":"Lookup Field","name":"lookupField","required":true,"dictionary":"getFieldsDictionary","dependsOn":["baseId","tableIdOrName"],"description":"Primary field used to identify existing records. The value for this field must be included in the 'fields' parameter."}
   * @paramDef {"type":"String","label":"Secondary Lookup Field","name":"secondaryLookupField","dictionary":"getFieldsDictionary","dependsOn":["baseId","tableIdOrName"],"description":"Optional second field for unique identification when primary lookup field alone is insufficient. Enables compound key lookups."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"description":"Object containing all field values for the record. Must include values for lookup fields. Example: {\"Name\": \"John Doe\", \"Email\": \"john@example.com\"}"}
   *
   * @returns {Object} Returns the created or updated record object with all field values, creation time, and unique ID.
   * @sampleResult {"createdTime":"2022-09-12T21:03:48.000Z","fields":{"Name":"John Doe","Email":"john@example.com","Status":"Updated"},"id":"recABC123XYZ"}
   */
  async createOrUpdateRecord(baseId, tableIdOrName, lookupField, secondaryLookupField, fields) {
    logger.debug('createOrUpdateRecord - run the "findRecord" method')

    const lookupValue1 = fields[lookupField]
    const lookupValue2 = fields[secondaryLookupField]

    if (!lookupField) {
      throw new Error('Lookup field is required')
    }

    if (lookupValue1 === undefined) {
      throw new Error(`Fields object must contain value by the lookupField="${ lookupField }"`)
    }

    const searchValue1 = JSON.stringify(lookupValue1)
    const searchValue2 = secondaryLookupField
      ? JSON.stringify(lookupValue2)
      : null

    const searchFormula = secondaryLookupField
      ? `AND({${ lookupField }} = ${ searchValue1 }, {${ secondaryLookupField }} = ${ searchValue2 })`
      : `${ lookupField } = ${ searchValue1 }`

    logger.debug(
      `createOrUpdateRecord - run the "findRecords" method to search a record with formula=[${ searchFormula }]`
    )

    const records = await this.findRecords(baseId, tableIdOrName, null, null, null, searchFormula, 2)

    if (records.length === 1) {
      logger.debug('createOrUpdateRecord - found a record, run the "updateRecord" method to update the record')

      const result = await this.updateRecord(baseId, tableIdOrName, records[0].id, fields)

      return { ...result, isNew: false }
    }

    logger.debug(
      `createOrUpdateRecord - ${ records.length ? records.length : 'no' } records found, ` +
      'run the "createRecord" method to create a new record'
    )

    const result = await this.createRecord(baseId, tableIdOrName, fields)

    return { ...result, isNew: true }
  }

  /**
   * @description Creates a new record in an Airtable table with specified field values. Perfect for AI agents to add structured data, populate databases, or create entries based on processed information.
   *
   * @route POST /createRecord
   * @operationName Create Record
   * @category Records
   *
   * @appearanceColor #25B5F8 #FFBE00
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes data.records:write
   *
   * @paramDef {"type":"String","label":"Base ID","name":"baseId","required":true,"dictionary":"getBasesDictionary","description":"The unique identifier of the Airtable base where the record will be created."}
   * @paramDef {"type":"String","label":"Table ID Or Name","name":"tableIdOrName","required":true,"dictionary":"getTablesDictionary","dependsOn":["baseId"],"description":"The ID or name of the table where the new record will be added."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"description":"Object containing field names as keys and their values. Example: {\"Name\": \"John Doe\", \"Email\": \"john@example.com\", \"Status\": \"Active\"}"}
   *
   * @returns {Object} Returns the newly created record object with id, fields, and creation timestamp.
   * @sampleResult {"createdTime":"2022-09-12T21:03:48.000Z","fields":{"Name":"John Doe","Email":"john@example.com","Status":"Active"},"id":"recABC123XYZ"}
   */
  async createRecord(baseId, tableIdOrName, fields) {
    return await this.#apiRequest({
      logTag: 'createRecord',
      url: `${ API_BASE_URL }/${ baseId }/${ tableIdOrName }`,
      method: 'post',
      body: {
        fields,
      },
    })
  }

  /**
   * @description Creates multiple new records in batch (up to 10 records). Efficient for AI agents to bulk-insert structured data while maintaining referential integrity and reducing API calls.
   *
   * @route POST /createRecords
   * @operationName Create Records
   * @category Records
   *
   * @appearanceColor #25B5F8 #FFBE00
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes data.records:write
   *
   * @paramDef {"type":"String","label":"Base ID","name":"baseId","required":true,"dictionary":"getBasesDictionary","description":"The ID of the Airtable base."}
   * @paramDef {"type":"String","label":"Table ID Or Name","name":"tableIdOrName","required":true,"dictionary":"getTablesDictionary","dependsOn":["baseId"],"description":"The ID of the table where the records will be created."}
   * @paramDef {"type":"Array.<Object>","label":"Records","name":"records","required":true,"description":"Array of record objects to create. Each object should contain field values."}
   *
   * @returns {Array} Returns array of the newly created record objects with their IDs and field values.
   * @sampleResult [{"createdTime":"2022-09-12T21:03:48.000Z","fields":{},"id":"example_id_record_1"}]
   */
  async createRecords(baseId, tableIdOrName, records) {
    records = records.map(fields => ({ fields }))

    const result = await this.#apiRequest({
      logTag: 'createRecords',
      url: `${ API_BASE_URL }/${ baseId }/${ tableIdOrName }`,
      method: 'post',
      body: {
        records,
      },
    })

    return result.records
  }

  /**
   * @description Updates specific fields in an existing Airtable record while preserving other field values. Perfect for AI agents to modify data based on processed information or user interactions.
   *
   * @route PUT /updateRecord
   * @operationName Update Record
   * @category Records
   *
   * @appearanceColor #25B5F8 #FFBE00
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes data.records:write
   *
   * @paramDef {"type":"String","label":"Base ID","name":"baseId","required":true,"dictionary":"getBasesDictionary","description":"The ID of the Airtable base."}
   * @paramDef {"type":"String","label":"Table ID Or Name","name":"tableIdOrName","required":true,"dictionary":"getTablesDictionary","dependsOn":["baseId"],"description":"The ID of the table where the record exists."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"dictionary":"getRecordsDictionary","dependsOn":["baseId","tableIdOrName"],"description":"Unique identifier of the specific record to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"description":"Object containing field names as keys and new values to update. Only specified fields will be modified."}
   *
   * @returns {Object} The response from the Airtable API with the updated record details.
   * @sampleResult {"createdTime":"2022-09-12T21:03:48.000Z","fields":{},"id":"example_id_record_1"}
   */
  async updateRecord(baseId, tableIdOrName, recordId, fields) {
    return this.#apiRequest({
      logTag: 'updateRecord',
      url: `${ API_BASE_URL }/${ baseId }/${ tableIdOrName }/${ recordId }`,
      method: 'patch',
      body: { fields },
    })
  }

  /**
   * @description Deletes multiple records in batch using their unique identifiers. Efficient for AI agents to clean up obsolete data or perform bulk maintenance operations.
   *
   * @route DELETE /deleteRecords
   * @operationName Delete Records
   * @category Records
   *
   * @appearanceColor #25B5F8 #FFBE00
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes data.records:write
   *
   * @paramDef {"type":"String","label":"Base ID","name":"baseId","required":true,"dictionary":"getBasesDictionary","description":"The ID of the Airtable base."}
   * @paramDef {"type":"String","label":"Table ID Or Name","name":"tableIdOrName","required":true,"dictionary":"getTablesDictionary","dependsOn":["baseId"],"description":"The ID of the table where the records exist."}
   * @paramDef {"type":"String","label":"Record ID(s)","name":"recordIds","required":true,"dictionary":"getRecordsDictionary","dependsOn":["baseId","tableIdOrName"],"description":"Array of record IDs to delete. Can be a single ID or multiple IDs for batch deletion."}
   *
   * @returns {Array} The response from the Airtable API with the deleted records.
   * @sampleResult [{"deleted":true,"id":"example_record_id_UtocSouk"},{"deleted":true,"id":"example_record_id_4aVqkeOQ"}]
   */
  async deleteRecords(baseId, tableIdOrName, recordIds) {
    if (!Array.isArray(recordIds)) {
      recordIds = []
    }

    if (recordIds.length === 0) {
      throw new Error('No record IDs provided for deletion.')
    }

    const queryString = recordIds.map(id => `records[]=${ id }`).join('&')

    const result = await this.#apiRequest({
      logTag: 'deleteRecords',
      url: `${ API_BASE_URL }/${ baseId }/${ tableIdOrName }?${ queryString }`,
      method: 'delete',
    })

    return result.records
  }

  /**
   * @description Deletes a single record by its unique identifier. Useful for AI agents to remove specific data entries based on business logic or data lifecycle management.
   *
   * @route DELETE /deleteRecord
   * @operationName Delete Record
   * @category Records
   *
   * @appearanceColor #25B5F8 #FFBE00
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes data.records:write
   *
   * @paramDef {"type":"String","label":"Base ID", "name":"baseId","required":true,"dictionary":"getBasesDictionary","description":"The ID of the Airtable base."}
   * @paramDef {"type":"String","label":"Table ID Or Name","name":"tableIdOrName","required":true,"dictionary":"getTablesDictionary","dependsOn":["baseId"],"description":"The ID of the table where the record exists."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"dictionary":"getRecordsDictionary","dependsOn":["baseId","tableIdOrName"],"description":"Unique identifier of the record to delete."}
   *
   * @returns {Object} The response from the Airtable API with the deleted record details.
   * @sampleResult {"deleted":true,"id":"example_record_id_cSoLbck"}
   */
  async deleteRecord(baseId, tableIdOrName, recordId) {
    return this.#apiRequest({
      logTag: 'deleteRecord',
      url: `${ API_BASE_URL }/${ baseId }/${ tableIdOrName }/${ recordId }`,
      method: 'delete',
    })
  }

  /**
   * @description Retrieves up to 100 comments for a specific record, ordered from newest to oldest. Perfect for AI agents to analyze collaboration history and track record discussions.
   *
   * @route GET /getComments
   * @operationName Get Latest Comments
   * @category Comments
   *
   * @appearanceColor #25B5F8 #FFBE00
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes data.recordComments:read
   *
   * @paramDef {"type":"String","label":"Base ID","name":"baseId","required":true,"dictionary":"getBasesDictionary","description":"The ID of the Airtable base."}
   * @paramDef {"type":"String","label":"Table ID Or Name","name":"tableIdOrName","required":true,"dictionary":"getTablesDictionary","dependsOn":["baseId"],"description":"The ID of the table where the record exists."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"dictionary":"getRecordsDictionary","dependsOn":["baseId","tableIdOrName"],"description":"The ID of the record for which to retrieve comments."}
   *
   * @returns {Array} An array of comments related to the specified record.
   * @sampleResult [{"author":{"email":"example@example.com","id":"example_id_user_1","name":"Example Name"},"createdTime":"2021-03-01T09:00:00.000Z","id":"example_id_comment_1","lastUpdatedTime":null,"text":"Example comment text"}]
   */
  async getLatestComments(baseId, tableIdOrName, recordId) {
    const result = await this.#apiRequest({
      logTag: 'getLatestComments',
      url: `${ API_BASE_URL }/${ baseId }/${ tableIdOrName }/${ recordId }/comments`,
    })

    return result.comments
  }

  /**
   * @description Creates a new comment on a specific record for collaboration and documentation purposes. Ideal for AI agents to add contextual notes, status updates, or processing logs.
   *
   * @route POST /createComment
   * @operationName Create Comment
   * @category Comments
   *
   * @appearanceColor #25B5F8 #FFBE00
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes data.recordComments:write
   *
   * @paramDef {"type":"String","label":"Base ID","name":"baseId","required":true,"dictionary":"getBasesDictionary","description":"The ID of the Airtable base."}
   * @paramDef {"type":"String","label":"Table ID Or Name","name":"tableIdOrName","required":true,"dictionary":"getTablesDictionary","dependsOn":["baseId"],"description":"The name or ID of the table containing the record."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"dictionary":"getRecordsDictionary","dependsOn":["baseId","tableIdOrName"],"description":"The ID of the record to which the comment will be added."}
   * @paramDef {"type":"String","label":"Comment","name":"comment","required":true,"description":"The comment text to add to the record."}
   *
   * @returns {Object} The response from the Airtable API.
   * @sampleResult {"author":{"email":"example@example.com","id":"example_id_user_1","name":"Example Name"},"createdTime":"2021-03-01T09:00:00.000Z","id":"example_id_comment_1","lastUpdatedTime":null,"text":"Example comment text"}
   */
  async createComment(baseId, tableIdOrName, recordId, comment) {
    return this.#apiRequest({
      logTag: 'createComment',
      url: `${ API_BASE_URL }/${ baseId }/${ tableIdOrName }/${ recordId }/comments`,
      method: 'post',
      body: { text: comment },
    })
  }

  /**
   * @description Updates the text content of an existing comment on a record. Note that users can only update comments they created. Perfect for AI agents to correct or enhance previously added notes.
   *
   * @route PUT /updateComment
   * @operationName Update Comment
   * @category Comments
   *
   * @appearanceColor #25B5F8 #FFBE00
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes data.recordComments:write
   *
   * @paramDef {"type":"String","label":"Base ID","name":"baseId","required":true,"dictionary":"getBasesDictionary","description":"The ID of the Airtable base."}
   * @paramDef {"type":"String","label":"Table ID Or Name","name":"tableIdOrName","required":true,"dictionary":"getTablesDictionary","dependsOn":["baseId"],"description":"The ID or name of the table containing the comment."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"dictionary":"getRecordsDictionary","dependsOn":["baseId","tableIdOrName"],"description":"The ID of the record containing the comment."}
   * @paramDef {"type":"String","label":"Comment ID","name":"commentId","required":true,"dictionary":"getCommentsDictionary","dependsOn":["baseId","tableIdOrName","recordId"],"description":"The ID of the comment to be updated."}
   * @paramDef {"type":"String","label":"New Text","name":"newText","required":true,"description":"The new text content for the comment."}
   *
   * @returns {Object} The response from the Airtable API with the updated comment details.
   * @sampleResult {"author":{"email":"example@example.com","id":"example_id_user_1","name":"Example Name"},"createdTime":"2021-03-01T09:00:00.000Z","id":"example_id_comment_1","lastUpdatedTime":"2021-05-01T09:00:00.000Z","text":"Example comment text"}
   */
  async updateComment(baseId, tableIdOrName, recordId, commentId, newText) {
    return this.#apiRequest({
      logTag: 'updateComment',
      url: `${ API_BASE_URL }/${ baseId }/${ tableIdOrName }/${ recordId }/comments/${ commentId }`,
      method: 'patch',
      body: { text: newText },
    })
  }

  /**
   * @description Deletes a comment from a record. Users can only delete comments they created (Enterprise Admins can delete any comment). Useful for AI agents to clean up outdated or incorrect notes.
   *
   * @route DELETE /deleteComment
   * @operationName Delete Comment
   * @category Comments
   *
   * @appearanceColor #25B5F8 #FFBE00
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes data.recordComments:write
   *
   * @paramDef {"type":"String","label":"Base ID","name":"baseId","required":true,"dictionary":"getBasesDictionary","description":"The ID of the Airtable base."}
   * @paramDef {"type":"String","label":"Table ID Or Name","name":"tableIdOrName","required":true,"dictionary":"getTablesDictionary","dependsOn":["baseId"],"description":"The ID or name of the table where the comment exists."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"dictionary":"getRecordsDictionary","dependsOn":["baseId","tableIdOrName"],"description":"The ID of the record where the comment exists."}
   * @paramDef {"type":"String","label":"Comment ID","name":"commentId","required":true,"dictionary":"getCommentsDictionary","dependsOn":["baseId","tableIdOrName","recordId"],"description":"The ID of the comment to be deleted."}
   *
   * @returns {Object} The response from the Airtable API confirming the deletion.
   * @sampleResult {"deleted":true,"id":"example_comment_id_Mg9zaEPw6"}
   */
  async deleteComment(baseId, tableIdOrName, recordId, commentId) {
    if (!commentId) {
      throw new Error('No comment ID provided for deletion.')
    }

    return this.#apiRequest({
      logTag: 'deleteComment',
      url: `${ API_BASE_URL }/${ baseId }/${ tableIdOrName }/${ recordId }/comments/${ commentId }`,
      method: 'delete',
    })
  }
}

Flowrunner.ServerCode.addService(Airtable, [
  {
    order: 0,
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    name: 'clientId',
    hint: 'Your OAuth 2.0 Client ID from the Airtable Developer Hub (Create and manage OAuth integrations).',
  },
  {
    order: 1,
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    name: 'clientSecret',
    hint: 'Your OAuth 2.0 Client Secret from the Airtable Developer Hub (Required for secure authentication).',
  },
])
