const logger = {
  info: (...args) => console.log('[Bubble] info:', ...args),
  debug: (...args) => console.log('[Bubble] debug:', ...args),
  error: (...args) => console.log('[Bubble] error:', ...args),
  warn: (...args) => console.log('[Bubble] warn:', ...args),
}

const ENVIRONMENT_PATHS = {
  Live: '/api/1.1',
  Development: '/version-test/api/1.1',
}

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
 * @integrationName Bubble
 * @integrationIcon /icon.jpeg
 */
class BubbleService {
  constructor(config) {
    this.apiToken = config.apiToken

    const appUrl = (config.appUrl || '').trim().replace(/\/+$/, '')

    this.environment = this.#resolveChoice(config.environment, {
      Live: 'Live',
      Development: 'Development',
    }) || 'Live'

    const envPath = ENVIRONMENT_PATHS[this.environment] || ENVIRONMENT_PATHS.Live

    this.baseUrl = `${ appUrl }${ envPath }`
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, headers, rawBody, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery || {}) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.apiToken }`,
          'Content-Type': 'application/json',
          ...(headers || {}),
        })
        .query(cleanedQuery || {})

      if (rawBody !== undefined) {
        return await request.send(rawBody)
      }

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const status = error.status || error.statusCode
      const message = error.body?.message || error.body?.status || error.message || 'Unknown error'

      logger.error(`${ logTag } - failed (${ status }): ${ message }`)

      throw new Error(`Bubble API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  #objUrl(typeName, id) {
    const type = encodeURIComponent(String(typeName || '').trim())
    const base = `${ this.baseUrl }/obj/${ type }`

    return id ? `${ base }/${ encodeURIComponent(String(id).trim()) }` : base
  }

  /**
   * @operationName Get Thing
   * @category Data
   * @description Retrieves a single thing (database record) by its unique id from a Bubble app data type. The data type name is the lowercase singular name of the type as defined in your app's database (e.g. "user", "order"). Returns the full object with all fields the API token is permitted to view, including Bubble's built-in fields (_id, Created Date, Modified Date, Created By).
   * @route GET /get-thing
   * @paramDef {"type":"String","label":"Data Type","name":"typeName","required":true,"description":"The Bubble data type name, lowercase singular (e.g. \"user\", \"order\", \"blog_post\")."}
   * @paramDef {"type":"String","label":"Thing ID","name":"id","required":true,"description":"The unique _id of the thing to retrieve."}
   * @returns {Object}
   * @sampleResult {"response":{"_id":"1583277659147x123456789","Created Date":"2020-03-03T22:00:59.147Z","Modified Date":"2020-03-03T22:00:59.147Z","name":"Acme Corp","status":"active"}}
   */
  async getThing(typeName, id) {
    const logTag = '[getThing]'

    return await this.#apiRequest({
      logTag,
      url: this.#objUrl(typeName, id),
      method: 'get',
    })
  }

  /**
   * @operationName List / Search Things
   * @category Data
   * @description Retrieves a paginated list of things from a Bubble data type, optionally filtered by search constraints and sorted. Constraints is a JSON array of objects, each { "key": <field name>, "constraint_type": <type>, "value": <value> }. Supported constraint_type values: "equals", "not equal", "is_empty", "is_not_empty", "text contains", "not text contains", "greater than", "less than", "in", "not in", "contains", "not contains", "empty", "not empty", "geographic_search". Example: [{"key":"status","constraint_type":"equals","value":"active"},{"key":"age","constraint_type":"greater than","value":18}]. Bubble caps results at 100 per call; use the returned cursor to page through more. Response is wrapped in { response: { results, cursor, count, remaining } }.
   * @route GET /list-things
   * @paramDef {"type":"String","label":"Data Type","name":"typeName","required":true,"description":"The Bubble data type name, lowercase singular (e.g. \"user\", \"order\")."}
   * @paramDef {"type":"Array<Object>","label":"Constraints","name":"constraints","required":false,"description":"JSON array of search constraints. Each item is {\"key\":\"<field>\",\"constraint_type\":\"<type>\",\"value\":<value>}. Types: equals, not equal, is_empty, is_not_empty, text contains, not text contains, greater than, less than, in, not in, contains, not contains, empty, not empty, geographic_search. Omit for no filtering."}
   * @paramDef {"type":"String","label":"Sort Field","name":"sortField","required":false,"description":"Field name to sort by (e.g. \"Created Date\", \"name\"). Leave empty for Bubble's default order."}
   * @paramDef {"type":"Boolean","label":"Descending","name":"descending","uiComponent":{"type":"CHECKBOX"},"required":false,"description":"Sort in descending order when true. Defaults to false (ascending). Requires Sort Field."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"required":false,"description":"Maximum number of things to return (1-100). Defaults to Bubble's server default (100)."}
   * @paramDef {"type":"Number","label":"Cursor","name":"cursor","uiComponent":{"type":"NUMERIC_STEPPER"},"required":false,"description":"Zero-based offset of the first result to return, for pagination. Use the cursor+count from a previous response to fetch the next page. Defaults to 0."}
   * @returns {Object}
   * @sampleResult {"response":{"results":[{"_id":"1583277659147x123456789","name":"Acme Corp","status":"active","Created Date":"2020-03-03T22:00:59.147Z"}],"cursor":0,"count":1,"remaining":0}}
   */
  async listThings(typeName, constraints, sortField, descending, limit, cursor) {
    const logTag = '[listThings]'

    const query = {
      sort_field: sortField,
      descending: descending === true ? 'true' : undefined,
      limit,
      cursor,
    }

    if (constraints !== undefined && constraints !== null && constraints !== '') {
      query.constraints = typeof constraints === 'string' ? constraints : JSON.stringify(constraints)
    }

    return await this.#apiRequest({
      logTag,
      url: this.#objUrl(typeName),
      method: 'get',
      query,
    })
  }

  /**
   * @operationName Create Thing
   * @category Data
   * @description Creates a new thing (database record) in a Bubble data type. Provide the fields as an object whose keys are your data type's field names and whose values are the field values (strings, numbers, booleans, dates as ISO strings, or lists as arrays). Fields must be exposed for creation via the API in your app's privacy rules. Returns the new thing's id, e.g. { "id": "1583277659147x..." }.
   * @route POST /create-thing
   * @paramDef {"type":"String","label":"Data Type","name":"typeName","required":true,"description":"The Bubble data type name, lowercase singular (e.g. \"user\", \"order\")."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"description":"Object of field name/value pairs for the new thing, e.g. {\"name\":\"Acme Corp\",\"status\":\"active\",\"age\":30}."}
   * @returns {Object}
   * @sampleResult {"status":"success","id":"1583277659147x123456789"}
   */
  async createThing(typeName, fields) {
    const logTag = '[createThing]'

    return await this.#apiRequest({
      logTag,
      url: this.#objUrl(typeName),
      method: 'post',
      body: fields || {},
    })
  }

  /**
   * @operationName Modify Thing
   * @category Data
   * @description Partially updates an existing thing. Only the fields you supply are changed; all other fields keep their current values. Provide the fields object with just the keys you want to update. To fully overwrite a thing (clearing unspecified fields) use Replace Thing instead. Returns no body on success.
   * @route PATCH /modify-thing
   * @paramDef {"type":"String","label":"Data Type","name":"typeName","required":true,"description":"The Bubble data type name, lowercase singular (e.g. \"user\", \"order\")."}
   * @paramDef {"type":"String","label":"Thing ID","name":"id","required":true,"description":"The unique _id of the thing to modify."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"description":"Object of field name/value pairs to update. Only listed fields change; e.g. {\"status\":\"archived\"}."}
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async modifyThing(typeName, id, fields) {
    const logTag = '[modifyThing]'

    const response = await this.#apiRequest({
      logTag,
      url: this.#objUrl(typeName, id),
      method: 'patch',
      body: fields || {},
    })

    return response || { status: 'success' }
  }

  /**
   * @operationName Replace Thing
   * @category Data
   * @description Fully replaces an existing thing with the provided fields. Any field not included in the fields object is reset to empty. Use Modify Thing when you only want to change a subset of fields. Returns no body on success.
   * @route PUT /replace-thing
   * @paramDef {"type":"String","label":"Data Type","name":"typeName","required":true,"description":"The Bubble data type name, lowercase singular (e.g. \"user\", \"order\")."}
   * @paramDef {"type":"String","label":"Thing ID","name":"id","required":true,"description":"The unique _id of the thing to replace."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"description":"Complete object of field name/value pairs for the thing. Fields omitted here are cleared."}
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async replaceThing(typeName, id, fields) {
    const logTag = '[replaceThing]'

    const response = await this.#apiRequest({
      logTag,
      url: this.#objUrl(typeName, id),
      method: 'put',
      body: fields || {},
    })

    return response || { status: 'success' }
  }

  /**
   * @operationName Delete Thing
   * @category Data
   * @description Permanently deletes a thing from a Bubble data type by its id. This cannot be undone. The data type's "Delete via API" privacy rule must allow the operation. Returns no body on success.
   * @route DELETE /delete-thing
   * @paramDef {"type":"String","label":"Data Type","name":"typeName","required":true,"description":"The Bubble data type name, lowercase singular (e.g. \"user\", \"order\")."}
   * @paramDef {"type":"String","label":"Thing ID","name":"id","required":true,"description":"The unique _id of the thing to delete."}
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async deleteThing(typeName, id) {
    const logTag = '[deleteThing]'

    const response = await this.#apiRequest({
      logTag,
      url: this.#objUrl(typeName, id),
      method: 'delete',
    })

    return response || { status: 'success' }
  }

  /**
   * @operationName Bulk Create Things
   * @category Data
   * @description Creates many things at once in a single data type. Provide an array of objects, each object being one thing's field/value pairs. Bubble processes them as newline-delimited JSON (Content-Type text/plain). The response is a newline-delimited list of per-item results, one line per input object, each indicating success (with the new id) or an error. Ideal for importing datasets efficiently.
   * @route POST /bulk-create-things
   * @paramDef {"type":"String","label":"Data Type","name":"typeName","required":true,"description":"The Bubble data type name, lowercase singular (e.g. \"user\", \"order\")."}
   * @paramDef {"type":"Array<Object>","label":"Things","name":"things","required":true,"description":"Array of objects, one per thing to create, e.g. [{\"name\":\"A\"},{\"name\":\"B\"}]. Each object's keys are field names."}
   * @returns {Object}
   * @sampleResult {"results":[{"status":"success","id":"1583277659147x111"},{"status":"success","id":"1583277659147x222"}],"raw":"{\"status\":\"success\",\"id\":\"1583277659147x111\"}\n{\"status\":\"success\",\"id\":\"1583277659147x222\"}"}
   */
  async bulkCreateThings(typeName, things) {
    const logTag = '[bulkCreateThings]'

    const list = Array.isArray(things) ? things : [things]
    const ndjson = list.map(item => JSON.stringify(item)).join('\n')

    const raw = await this.#apiRequest({
      logTag,
      url: `${ this.#objUrl(typeName) }/bulk`,
      method: 'post',
      headers: { 'Content-Type': 'text/plain' },
      rawBody: ndjson,
    })

    const text = typeof raw === 'string' ? raw : (raw && raw.body ? String(raw.body) : String(raw))

    const results = text
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line)
        } catch (error) {
          return { status: 'error', raw: line }
        }
      })

    return { results, raw: text }
  }

  /**
   * @operationName Trigger Workflow
   * @category Workflow
   * @description Triggers a Bubble backend workflow (API endpoint) by name and passes parameters to it. The workflow name is the endpoint name you defined under Backend Workflows in your app; it must be exposed as a public API workflow and its authentication must allow the API token. Parameters are sent as a JSON body whose keys match the workflow's expected parameter keys. Returns whatever the workflow's response step returns (defaults to a status and any custom response fields).
   * @route POST /trigger-workflow
   * @paramDef {"type":"String","label":"Workflow Name","name":"workflowName","required":true,"description":"The backend API workflow endpoint name (e.g. \"send_welcome_email\")."}
   * @paramDef {"type":"Object","label":"Parameters","name":"parameters","required":false,"description":"Object of parameter key/value pairs to pass to the workflow, e.g. {\"user_id\":\"1583...\",\"email\":\"a@b.com\"}. Omit if the workflow takes no parameters."}
   * @returns {Object}
   * @sampleResult {"status":"success","response":{"result":"ok"}}
   */
  async triggerWorkflow(workflowName, parameters) {
    const logTag = '[triggerWorkflow]'

    const name = encodeURIComponent(String(workflowName || '').trim())

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/wf/${ name }`,
      method: 'post',
      body: parameters || {},
    })
  }
}

Flowrunner.ServerCode.addService(BubbleService, [
  {
    name: 'appUrl',
    displayName: 'App URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Bubble app URL, e.g. https://myapp.bubbleapps.io or your custom domain. Omit any trailing slash and any /version-test path.',
  },
  {
    name: 'apiToken',
    displayName: 'API Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'A Bubble API token. In your app go to Settings -> API, enable the Data API, and generate a token. Sent as an Authorization: Bearer header.',
  },
  {
    name: 'environment',
    displayName: 'Environment',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    options: ['Live', 'Development'],
    defaultValue: 'Live',
    required: false,
    shared: false,
    hint: 'Which Bubble branch to target. Development targets the version-test (test) branch of your app; Live targets the deployed app.',
  },
])
