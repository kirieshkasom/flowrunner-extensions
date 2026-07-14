const logger = {
  info: (...args) => console.log('[Adalo] info:', ...args),
  debug: (...args) => console.log('[Adalo] debug:', ...args),
  error: (...args) => console.log('[Adalo] error:', ...args),
  warn: (...args) => console.log('[Adalo] warn:', ...args),
}

const API_BASE_URL = 'https://api.adalo.com/v0/apps'

const DEFAULT_LIMIT = 100

function clean(obj) {
  if (!obj) {
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
 * @integrationName Adalo
 * @integrationIcon /icon.png
 */
class AdaloService {
  constructor(config) {
    this.apiKey = config.apiKey
    this.appId = config.appId
  }

  #collectionUrl(collectionId, recordId) {
    const base = `${ API_BASE_URL }/${ encodeURIComponent(this.appId) }/collections/${ encodeURIComponent(collectionId) }`

    return recordId !== undefined && recordId !== null && recordId !== ''
      ? `${ base }/${ encodeURIComponent(recordId) }`
      : base
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.apiKey }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const status = error.status || error.statusCode
      const message = error.body?.error || error.body?.message || error.message

      logger.error(`${ logTag } - failed${ status ? ` (${ status })` : '' }: ${ message }`)

      throw new Error(`Adalo API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  /**
   * @operationName List Records
   * @category Records
   * @description Lists records in an Adalo collection with pagination. Returns an object with a "records" array of the collection's records; each record includes its "id" plus every field of the collection. Use "offset" and "limit" to page through large collections. Note: Adalo enforces a rate limit of roughly 5 requests per second (HTTP 429 when exceeded).
   * @route GET /list-records
   * @appearanceColor #3F51B5 #7986CB
   *
   * @paramDef {"type":"String","label":"Collection ID","name":"collectionId","required":true,"description":"The collection identifier from the app's API section (Adalo → App → Settings → App Access → API Documentation). Free-text; specific to your app."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records to skip for pagination. Defaults to 0."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of records to return per page. Defaults to 100."}
   *
   * @returns {Object}
   * @sampleResult {"records":[{"id":1,"Name":"Ada Lovelace","Email":"ada@example.com"},{"id":2,"Name":"Grace Hopper","Email":"grace@example.com"}],"offset":0,"limit":100}
   */
  async listRecords(collectionId, offset, limit) {
    const logTag = '[listRecords]'

    return await this.#apiRequest({
      logTag,
      url: this.#collectionUrl(collectionId),
      method: 'get',
      query: {
        offset: offset !== undefined && offset !== null ? offset : 0,
        limit: limit !== undefined && limit !== null ? limit : DEFAULT_LIMIT,
      },
    })
  }

  /**
   * @operationName Get Record
   * @category Records
   * @description Retrieves a single record from an Adalo collection by its record ID. Returns the record object with its "id" and all collection fields. Note: Adalo enforces a rate limit of roughly 5 requests per second (HTTP 429 when exceeded).
   * @route GET /get-record
   * @appearanceColor #3F51B5 #7986CB
   *
   * @paramDef {"type":"String","label":"Collection ID","name":"collectionId","required":true,"description":"The collection identifier from the app's API section (Adalo → App → Settings → App Access → API Documentation). Free-text; specific to your app."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"description":"The unique ID of the record to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":1,"Name":"Ada Lovelace","Email":"ada@example.com","created_at":"2026-07-14T10:00:00.000Z"}
   */
  async getRecord(collectionId, recordId) {
    const logTag = '[getRecord]'

    return await this.#apiRequest({
      logTag,
      url: this.#collectionUrl(collectionId, recordId),
      method: 'get',
    })
  }

  /**
   * @operationName Create Record
   * @category Records
   * @description Creates a new record in an Adalo collection. Pass a "fields" object whose keys are the collection's field names (or their numeric property IDs) and whose values are the data to store. Returns the newly created record including its generated "id". Note: Adalo enforces a rate limit of roughly 5 requests per second (HTTP 429 when exceeded).
   * @route POST /create-record
   * @appearanceColor #3F51B5 #7986CB
   *
   * @paramDef {"type":"String","label":"Collection ID","name":"collectionId","required":true,"description":"The collection identifier from the app's API section (Adalo → App → Settings → App Access → API Documentation). Free-text; specific to your app."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"description":"Object of field values for the new record. Keys must match the collection's field names (or numeric property IDs) exactly, e.g. {\"Name\":\"Ada\",\"Email\":\"ada@example.com\"}."}
   *
   * @returns {Object}
   * @sampleResult {"id":3,"Name":"Ada Lovelace","Email":"ada@example.com","created_at":"2026-07-14T10:00:00.000Z"}
   */
  async createRecord(collectionId, fields) {
    const logTag = '[createRecord]'

    return await this.#apiRequest({
      logTag,
      url: this.#collectionUrl(collectionId),
      method: 'post',
      body: fields || {},
    })
  }

  /**
   * @operationName Update Record
   * @category Records
   * @description Updates an existing record in an Adalo collection. Pass a "fields" object containing only the field(s) you want to change; omitted fields are left unchanged (partial update). Returns the updated record. Note: Adalo enforces a rate limit of roughly 5 requests per second (HTTP 429 when exceeded).
   * @route PUT /update-record
   * @appearanceColor #3F51B5 #7986CB
   *
   * @paramDef {"type":"String","label":"Collection ID","name":"collectionId","required":true,"description":"The collection identifier from the app's API section (Adalo → App → Settings → App Access → API Documentation). Free-text; specific to your app."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"description":"The unique ID of the record to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"description":"Object of field values to change. Include only the fields to update; keys must match the collection's field names (or numeric property IDs) exactly."}
   *
   * @returns {Object}
   * @sampleResult {"id":1,"Name":"Ada Lovelace","Email":"ada.new@example.com","updated_at":"2026-07-14T11:00:00.000Z"}
   */
  async updateRecord(collectionId, recordId, fields) {
    const logTag = '[updateRecord]'

    return await this.#apiRequest({
      logTag,
      url: this.#collectionUrl(collectionId, recordId),
      method: 'put',
      body: fields || {},
    })
  }

  /**
   * @operationName Delete Record
   * @category Records
   * @description Deletes a record from an Adalo collection by its record ID. On success Adalo returns an empty response (HTTP 200/204); this operation returns a confirmation object. Note: Adalo enforces a rate limit of roughly 5 requests per second (HTTP 429 when exceeded).
   * @route DELETE /delete-record
   * @appearanceColor #3F51B5 #7986CB
   *
   * @paramDef {"type":"String","label":"Collection ID","name":"collectionId","required":true,"description":"The collection identifier from the app's API section (Adalo → App → Settings → App Access → API Documentation). Free-text; specific to your app."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"description":"The unique ID of the record to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"collectionId":"t_abc123","recordId":"1"}
   */
  async deleteRecord(collectionId, recordId) {
    const logTag = '[deleteRecord]'

    await this.#apiRequest({
      logTag,
      url: this.#collectionUrl(collectionId, recordId),
      method: 'delete',
    })

    return { success: true, collectionId, recordId }
  }
}

Flowrunner.ServerCode.addService(AdaloService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Adalo → App Settings → App Access → generate an API key. Sent as the Authorization: Bearer header.',
  },
  {
    name: 'appId',
    displayName: 'App ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Adalo App ID (found in the app\'s API section / the app URL).',
  },
])
