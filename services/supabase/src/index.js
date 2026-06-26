'use strict'

const crypto = require('crypto')

const SERVICE_NAME = 'Supabase'

const logger = {
  info: (...args) => console.log(`[${ SERVICE_NAME } Service] info:`, ...args),
  debug: (...args) => console.log(`[${ SERVICE_NAME } Service] debug:`, ...args),
  error: (...args) => console.log(`[${ SERVICE_NAME } Service] error:`, ...args),
  warn: (...args) => console.log(`[${ SERVICE_NAME } Service] warn:`, ...args),
}

/**
 * @integrationName Supabase
 * @integrationIcon /icon.png
 */
class Supabase {
  /**
   * @typedef {Object} getOperatorsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor."}
   */

  /**
   * @typedef {Object} DataField
   * @paramDef {"type":"String","label":"Column","name":"key","required":true,"dictionary":"getColumnsDictionary","description":"The column name."}
   * @paramDef {"type":"String","label":"Value","name":"value","required":true,"description":"The value for the column."}
   */

  /**
   * @param {Object} config
   * @param {String} config.supabaseUrl
   * @param {String} config.supabaseKey
   * @param {String} [config.webhookSecret]
   */
  constructor(config) {
    this.supabaseUrl = config.supabaseUrl
    this.supabaseKey = config.supabaseKey
    this.webhookSecret = config.webhookSecret
  }

  /**
   * @param {Object} options
   * @param {String} options.url - Absolute URL
   * @param {String} options.method - HTTP Method (GET, POST, PATCH, DELETE)
   * @param {Object} [options.body] - Request body
   * @param {Object} [options.query] - Query parameters
   * @param {Object} [options.headers] - Additional headers
   * @param {String} options.logTag - Tag for logging
   * @returns {Promise<any>}
   */
  async #apiRequest({ url, method, body, query, headers = {}, logTag }) {
    method = method || 'get'

    try {
      const reqHeaders = {
        apikey: this.supabaseKey,
        Authorization: `Bearer ${ this.supabaseKey }`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        ...headers,
      }

      logger.debug(
        `${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`
      )

      return await Flowrunner.Request[method](url)
        .set(reqHeaders)
        .query(query)
        .send(body)
    } catch (error) {
      logger.error(`${ logTag } - api request failed: ${ error.message }`)
      throw new Error(`Supabase API request failed: ${ error.message }`)
    }
  }

  /**
   * @typedef {Object} Filter
   * @paramDef {"type":"String","label":"Column","name":"column","required":true,"dictionary":"getColumnsDictionary","dependsOn":["table"]}
   * @paramDef {"type":"String","label":"Operator","name":"operator","required":true,"dictionary":"getOperatorsDictionary"}
   * @paramDef {"type":"String","label":"Value","name":"value","required":true}
   */

  /**
   * @operationName Select Records
   * @category CRUD
   * @description Retrieves records from a specified table with optional filtering and column selection.
   * @paramDef {"type":"String","label":"Table","name":"table","dictionary":"getTablesDictionary","required":true,"description":"The table to select from."}
   * @paramDef {"type":"String","label":"Columns","name":"columns","description":"Comma-separated list of columns to select (e.g., 'id, name'). Defaults to '*'."}
   * @paramDef {"type":"Filter","label":"Filter","name":"filter","required":false,"description":"Simple filter conditions."}
   * @paramDef {"type":"String","label":"Advanced Filter","name":"advancedFilter","description":"Raw query filter string (e.g., 'id=eq.1&status=eq.active'). Appended to Simple Filter if both are present."}
   * @returns {Array}
   * @sampleResultLoader { "methodName": "getRecordSchema", "dependsOn": ["table"] }
   */
  async select(table, columns, filter, advancedFilter) {
    const url = `${ this.supabaseUrl }/rest/v1/${ table }`
    const queryParams = {
      select: columns || '*',
    }

    if (
      filter &&
      filter.column &&
      filter.operator &&
      filter.value !== undefined
    ) {
      queryParams[filter.column] = `${ filter.operator }.${ filter.value }`
    }

    if (advancedFilter) {
      const advancedParts = advancedFilter.split('&')

      advancedParts.forEach(part => {
        const [key, value] = part.split('=')

        if (key && value) {
          queryParams[key] = value
        }
      })
    }

    return this.#apiRequest({
      url,
      method: 'get',
      query: queryParams,
      logTag: 'select',
    })
  }

  /**
   * @operationName Insert Record
   * @category CRUD
   * @description Inserts a new record into a specified table.
   * @paramDef {"type":"String","label":"Table","name":"table","dictionary":"getTablesDictionary","required":true,"description":"The table to insert into."}
   * @paramDef {"type":"Array.<DataField>","label":"Data","name":"data","required":true,"dependsOn":["table"],"description":"List of fields to insert."}
   * @returns {Object}
   * @sampleResultLoader { "methodName": "getRecordSchema", "dependsOn": ["table"] }
   */
  async insert(table, data) {
    const record = (data || []).reduce((acc, field) => {
      acc[field.key] = field.value

      return acc
    }, {})

    logger.debug(`insert - table: ${ table }, record: ${ JSON.stringify(record) }`)

    const result = await this.#apiRequest({
      url: `${ this.supabaseUrl }/rest/v1/${ table }`,
      method: 'post',
      body: record,
      headers: {
        Prefer: 'return=representation',
      },
      logTag: 'insert',
    })

    return Array.isArray(result) ? result[0] : result
  }

  /**
   * @operationName Update Record
   * @category CRUD
   * @description Updates existing records in a specified table matching the filter criteria.
   * @paramDef {"type":"String","label":"Table","name":"table","dictionary":"getTablesDictionary","required":true,"description":"The table to update."}
   * @paramDef {"type":"Array.<DataField>","label":"Data","name":"data","required":true,"description":"List of fields to update."}
   * @paramDef {"type":"Filter","label":"Filter","name":"filter","required":false,"description":"Simple filter conditions."}
   * @paramDef {"type":"String","label":"Advanced Filter","name":"advancedFilter","description":"Raw query filter string (e.g., 'id=eq.1'). Appended to Simple Filter."}
   * @returns {Array}
   * @sampleResultLoader { "methodName": "getRecordSchema", "dependsOn": ["table"] }
   */
  async update(table, data, filter, advancedFilter) {
    const record = (data || []).reduce((acc, field) => {
      acc[field.key] = field.value

      return acc
    }, {})

    const url = `${ this.supabaseUrl }/rest/v1/${ table }`
    const queryParams = {}

    if (
      filter &&
      filter.column &&
      filter.operator &&
      filter.value !== undefined
    ) {
      queryParams[filter.column] = `${ filter.operator }.${ filter.value }`
    }

    if (advancedFilter) {
      const advancedParts = advancedFilter.split('&')

      advancedParts.forEach(part => {
        const [key, value] = part.split('=')

        if (key && value) {
          queryParams[key] = value
        }
      })
    }

    if (Object.keys(queryParams).length === 0) {
      throw new Error(
        'Update requires a filter to avoid updating all records.'
      )
    }

    return this.#apiRequest({
      url,
      method: 'patch',
      body: record,
      query: queryParams,
      logTag: 'update',
    })
  }

  /**
   * @operationName Delete Record
   * @category CRUD
   * @description Deletes records from a specified table matching the filter criteria.
   * @paramDef {"type":"String","label":"Table","name":"table","dictionary":"getTablesDictionary","required":true,"description":"The table to delete from."}
   * @paramDef {"type":"Filter","label":"Filter","name":"filter","required":false,"description":"Simple filter conditions."}
   * @paramDef {"type":"String","label":"Advanced Filter","name":"advancedFilter","description":"Raw query filter string (e.g., 'id=eq.1'). Appended to Simple Filter."}
   * @returns {Array}
   * @sampleResult [{"id":1,"status":"deleted"}]
   */
  async delete(table, filter, advancedFilter) {
    const url = `${ this.supabaseUrl }/rest/v1/${ table }`
    const queryParams = {}

    if (
      filter &&
      filter.column &&
      filter.operator &&
      filter.value !== undefined
    ) {
      queryParams[filter.column] = `${ filter.operator }.${ filter.value }`
    }

    if (advancedFilter) {
      const advancedParts = advancedFilter.split('&')

      advancedParts.forEach(part => {
        const [key, value] = part.split('=')

        if (key && value) {
          queryParams[key] = value
        }
      })
    }

    if (Object.keys(queryParams).length === 0) {
      throw new Error(
        'Delete requires a filter to avoid deleting all records.'
      )
    }

    return this.#apiRequest({
      url,
      method: 'delete',
      query: queryParams,
      logTag: 'delete',
    })
  }

  /**
   * @operationName On Record Created
   * @registerAs REALTIME_TRIGGER
   * @registerAs POLLING_TRIGGER
   * @category Triggers
   * @description Triggers when a new record is created in the specified table.
   * @paramDef {"type":"String","label":"Table","name":"table","dictionary":"getTablesDictionary","required":true,"description":"The table to listen to."}
   * @paramDef {"type":"String","label":"Timestamp Column","name":"timestampColumn","description":"(Polling only) Column to track new records (e.g., 'created_at'). Defaults to 'created_at'."}
   * @sampleResult {"id":1,"created_at":"2023-01-01T00:00:00Z"}
   */
  async onRecordCreated(payload) {
    return payload
  }

  /**
   * @operationName On Record Updated
   * @registerAs REALTIME_TRIGGER
   * @registerAs POLLING_TRIGGER
   * @category Triggers
   * @description Triggers when a record is updated in the specified table.
   * @paramDef {"type":"String","label":"Table","name":"table","dictionary":"getTablesDictionary","required":true,"description":"The table to listen to."}
   * @paramDef {"type":"String","label":"Timestamp Column","name":"timestampColumn","description":"(Polling only) Column to track updates (e.g., 'updated_at'). Defaults to 'updated_at'."}
   * @sampleResult {"id":1,"updated_at":"2023-01-02T00:00:00Z"}
   */
  async onRecordUpdated(payload) {
    return payload
  }

  /**
   * @operationName On Record Deleted
   * @registerAs REALTIME_TRIGGER
   * @category Triggers
   * @description Triggers when a record is deleted from the specified table. (Realtime only)
   * @paramDef {"type":"String","label":"Table","name":"table","dictionary":"getTablesDictionary","required":true,"description":"The table to listen to."}
   * @sampleResult {"id":1,"status":"deleted"}
   */
  async onRecordDeleted(payload) {
    return payload
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tables Dictionary
   * @description Retrieves a list of tables from the database.
   * @route POST /get-tables-dictionary
   * @paramDef {"type":"getTablesDictionary__payload","label":"Payload","name":"payload","description":"Payload containing search and cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"users","value":"users","note":"Table"}],"cursor":null}
   */
  async getTablesDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ this.supabaseUrl }/rest/v1/`,
      method: 'get',
      logTag: 'getTablesDictionary',
    })

    const tables = Object.keys(response.definitions || {})
      .filter(
        name => !search || name.toLowerCase().includes(search.toLowerCase())
      )
      .map(name => ({
        label: name,
        value: name,
        note: 'Table',
      }))

    return { items: tables, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Columns Dictionary
   * @description Retrieves a list of columns for a specific table.
   * @route POST /get-columns-dictionary
   * @paramDef {"type":"getColumnsDictionary__payload","label":"Payload","name":"payload","description":"Payload containing search, cursor, and table criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"id","value":"id","note":"integer"}],"cursor":null}
   */
  async getColumnsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const table = criteria?.table

    if (!table) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      url: `${ this.supabaseUrl }/rest/v1/`,
      method: 'get',
      logTag: 'getColumnsDictionary',
    })

    const definition = response.definitions?.[table]

    if (!definition || !definition.properties) {
      return { items: [], cursor: null }
    }

    const columns = Object.entries(definition.properties)
      .filter(
        ([name]) =>
          !search || name.toLowerCase().includes(search.toLowerCase())
      )
      .map(([name, prop]) => ({
        label: name,
        value: name,
        note: prop.type || 'unknown',
      }))

    return { items: columns, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Operators Dictionary
   * @description Returns a list of supported PostgREST operators for filtering.
   * @route POST /get-operators-dictionary
   * @paramDef {"type":"getOperatorsDictionary__payload","label":"Payload","name":"payload","description":"Payload containing search and cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Equals","value":"eq","note":"="}],"cursor":null}
   */
  async getOperatorsDictionary(payload) {
    const operators = [
      { label: 'Equals', value: 'eq', note: '=' },
      { label: 'Greater Than', value: 'gt', note: '>' },
      { label: 'Less Than', value: 'lt', note: '<' },
      { label: 'Greater Than or Equal', value: 'gte', note: '>=' },
      { label: 'Less Than or Equal', value: 'lte', note: '<=' },
      { label: 'Not Equal', value: 'neq', note: '<>' },
      { label: 'Like (Pattern)', value: 'like', note: 'LIKE' },
      { label: 'ILike (Case-insensitive)', value: 'ilike', note: 'ILIKE' },
      { label: 'In List', value: 'in', note: 'IN' },
      { label: 'Is', value: 'is', note: 'IS' },
    ]

    return { items: operators, cursor: null }
  }

  /**
   * @registerAs SAMPLE_RESULT_LOADER
   * @route POST /getRecordSchema
   * @param {Object} payload
   */
  async getRecordSchema(payload) {
    const { criteria } = payload || {}
    const { table } = criteria || {}

    if (!table) return {}

    try {
      const records = await this.#apiRequest({
        url: `${ this.supabaseUrl }/rest/v1/${ table }`,
        method: 'get',
        query: { limit: 1 },
        logTag: 'getRecordSchema',
      })

      if (records && Array.isArray(records) && records.length > 0) {
        return records[0]
      }
    } catch (e) {
      logger.warn(
        `getRecordSchema - Failed to fetch sample record: ${ e.message }`
      )
    }

    return {}
  }

  /**
   * @registerAs SYSTEM
   * @description Returns the webhook URL for manual setup in Supabase Dashboard.
   */
  async handleTriggerUpsertWebhook(webhookUrl, triggers) {
    return webhookUrl
  }

  /**
   * @registerAs SYSTEM
   * @description No-op for Supabase as webhooks are managed manually.
   */
  async handleTriggerDeleteWebhook(webhookUrl, triggers) {
    return true
  }

  /**
   * @registerAs SYSTEM
   * @description Processes incoming webhook events from Supabase.
   */
  async handleTriggerResolveEvents(req) {
    if (!this.#verifyWebhookSecret(req)) {
      logger.warn('handleTriggerResolveEvents: webhook secret verification failed - rejecting delivery')

      return []
    }

    const event = req.body
    if (!event || !event.type) return []

    return [event]
  }

  // Supabase Database Webhooks do not sign payloads. When a Webhook Secret is configured, the
  // user sets the same value as an "x-webhook-secret" header (or "Authorization: Bearer <secret>")
  // on the webhook in the Supabase dashboard; every delivery is verified against it with a
  // constant-time compare before the payload is trusted. With no secret configured, deliveries
  // pass through (verification is opt-in for this manually-created webhook).
  #verifyWebhookSecret(req) {
    const expected = this.webhookSecret
    if (!expected) return true

    const headers = (req && req.headers) || {}
    const read = name => headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()]

    let provided = read('x-webhook-secret')

    if (!provided) provided = String(read('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!provided) return false

    const expectedBuffer = Buffer.from(String(expected))
    const providedBuffer = Buffer.from(String(provided))

    return expectedBuffer.length === providedBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  }

  /**
   * @registerAs SYSTEM
   * @description Filters events based on trigger configuration.
   */
  async handleTriggerSelectMatched(events, trigger) {
    const { table } = trigger.input
    const eventTypeMap = {
      onRecordCreated: 'INSERT',
      onRecordUpdated: 'UPDATE',
      onRecordDeleted: 'DELETE',
    }

    const expectedType = eventTypeMap[trigger.method]

    return events
      .filter(event => event.table === table && event.type === expectedType)
      .map(event => {
        return event.type === 'DELETE' ? event.old_record : event.record
      })
  }

  /**
   * @registerAs SYSTEM
   * @description Polls for new events based on timestamp column.
   */
  async handleTriggerPollingForEvent(trigger, lastPollTime) {
    const { table, timestampColumn = 'created_at' } = trigger.input
    const method = trigger.method

    if (method === 'onRecordDeleted') {
      return []
    }

    const time = lastPollTime || new Date(0).toISOString()

    const response = await this.#apiRequest({
      url: `${ this.supabaseUrl }/rest/v1/${ table }`,
      method: 'get',
      query: {
        [timestampColumn]: `gt.${ time }`,
        order: `${ timestampColumn }.asc`,
      },
      logTag: 'handleTriggerPollingForEvent',
    })

    return Array.isArray(response) ? response : []
  }
}

/**
 * @typedef {Object} getTablesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter tables."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor."}
 */

/**
 * @typedef {Object} getColumnsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Table","name":"table","required":true,"description":"The table to get columns from."}
 */

/**
 * @typedef {Object} getColumnsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter columns."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor."}
 * @paramDef {"type":"getColumnsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Criteria containing the table name."}
 */

Flowrunner.ServerCode.addService(Supabase, [
  {
    name: 'supabaseUrl',
    displayName: 'Project URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Your Supabase Project URL (e.g., https://xyz.supabase.co). Found in Settings > API.',
    order: 1,
  },
  {
    name: 'supabaseKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Your Supabase API Key (anon or service_role). Found in Settings > API.',
    order: 2,
  },
  {
    name: 'webhookSecret',
    displayName: 'Webhook Secret',
    type: 'STRING',
    required: false,
    hint: 'Optional shared secret for realtime triggers. Set the same value as an "x-webhook-secret" HTTP header when creating the Database Webhook (Database > Webhooks). Deliveries that omit or mismatch it are rejected.',
    order: 3,
  },
])

module.exports = Supabase
