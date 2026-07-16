const logger = {
  info: (...args) => console.log('[Odoo] info:', ...args),
  debug: (...args) => console.log('[Odoo] debug:', ...args),
  error: (...args) => console.log('[Odoo] error:', ...args),
  warn: (...args) => console.log('[Odoo] warn:', ...args),
}

/**
 * @integrationName Odoo
 * @integrationIcon /icon.png
 */
class OdooService {
  constructor(config) {
    this.url = (config.url || '').trim().replace(/\/+$/, '')
    this.db = config.db
    this.username = config.username
    this.apiKey = config.apiKey
    this.uid = null
  }

  // Single JSON-RPC transport. Posts to {url}/jsonrpc and returns result, or throws on RPC error.
  async #rpc({ service, method, args, logTag }) {
    const endpoint = `${ this.url }/jsonrpc`

    try {
      logger.debug(`${ logTag } - [${ service }::${ method }]`)

      const response = await Flowrunner.Request.post(endpoint)
        .set({ 'Content-Type': 'application/json' })
        .send({
          jsonrpc: '2.0',
          method: 'call',
          params: { service, method, args },
          id: Date.now(),
        })

      if (response && response.error) {
        const data = response.error.data || {}
        const message = data.message || response.error.message || 'Unknown Odoo error'
        const debug = data.debug ? ` (${ String(data.debug).split('\n').pop() })` : ''

        logger.error(`${ logTag } - RPC error: ${ message }`)
        throw new Error(`Odoo API error: ${ message }${ debug }`)
      }

      return response.result
    } catch (error) {
      if (error.message && error.message.startsWith('Odoo API error:')) {
        throw error
      }

      const status = error.status || error.statusCode
      const message = error.body?.error?.data?.message ||
        error.body?.message ||
        (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))

      logger.error(`${ logTag } - request failed${ status ? ` (${ status })` : '' }: ${ message }`)
      throw new Error(`Odoo API error: ${ message }${ status ? ` (status ${ status })` : '' }`)
    }
  }

  // Authenticate once per invocation and cache the resolved uid.
  async #authenticate() {
    if (this.uid) {
      return this.uid
    }

    const uid = await this.#rpc({
      logTag: '[authenticate]',
      service: 'common',
      method: 'authenticate',
      args: [this.db, this.username, this.apiKey, {}],
    })

    if (!uid) {
      throw new Error('Odoo API error: authentication failed. Check the database name, username, and API key.')
    }

    this.uid = uid

    return uid
  }

  // Convenience wrapper around object::execute_kw with a resolved uid.
  async #executeKw({ model, methodName, args = [], kwargs = {}, logTag }) {
    const uid = await this.#authenticate()

    return await this.#rpc({
      logTag,
      service: 'object',
      method: 'execute_kw',
      args: [this.db, uid, this.apiKey, model, methodName, args, kwargs],
    })
  }

  #cleanKwargs(kwargs) {
    const result = {}

    for (const key in kwargs) {
      const value = kwargs[key]

      if (value !== undefined && value !== null && value !== '') {
        result[key] = value
      }
    }

    return result
  }

  /**
   * @operationName Search Read
   * @category Records
   * @description Searches records of any Odoo model and returns their field values in a single call — the primary way to query data. Provide the model technical name (e.g. res.partner, sale.order, product.product) and an optional domain filter. The domain is an array of condition triples like [["is_company","=",true],["name","ilike","Acme"]]; multiple triples are combined with implicit AND. Prefix logical operators "&", "|", "!" as separate array elements for explicit AND/OR/NOT. Use fields to limit returned columns (omit for all), plus limit, offset, and order for pagination and sorting.
   * @route POST /search-read
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"description":"Model technical name, e.g. res.partner, sale.order, product.product, crm.lead."}
   * @paramDef {"type":"Array","label":"Domain","name":"domain","description":"Array of filter triples like [[\"is_company\",\"=\",true]]. Empty array or omitted returns all records (subject to limit). Use \"|\"/\"&\"/\"!\" prefix elements for OR/AND/NOT."}
   * @paramDef {"type":"Array<String>","label":"Fields","name":"fields","description":"Field names to return, e.g. [\"name\",\"email\"]. Omit to return every field."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of records to return. Omit for the Odoo default (no limit)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of matching records to skip, for pagination. Defaults to 0."}
   * @paramDef {"type":"String","label":"Order","name":"order","description":"Sort clause, e.g. \"name asc\" or \"create_date desc, id asc\"."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":14,"name":"Deco Addict","email":"deco.addict@example.com","is_company":true}]
   */
  async searchRead(model, domain, fields, limit, offset, order) {
    return await this.#executeKw({
      logTag: '[searchRead]',
      model,
      methodName: 'search_read',
      args: [domain || []],
      kwargs: this.#cleanKwargs({ fields, limit, offset, order }),
    })
  }

  /**
   * @operationName Search
   * @category Records
   * @description Searches records of an Odoo model and returns only the matching record IDs (no field data). Use this when you just need IDs to feed into Read, Update, or Delete. The domain is an array of condition triples like [["is_company","=",true]]. Supports limit, offset, and order for pagination and sorting.
   * @route POST /search
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"description":"Model technical name, e.g. res.partner, sale.order."}
   * @paramDef {"type":"Array","label":"Domain","name":"domain","description":"Array of filter triples like [[\"is_company\",\"=\",true]]. Empty array returns all records (subject to limit)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of IDs to return. Omit for no limit."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of matching records to skip. Defaults to 0."}
   * @paramDef {"type":"String","label":"Order","name":"order","description":"Sort clause, e.g. \"create_date desc\"."}
   * @returns {Array<Number>}
   * @sampleResult [14,26,33]
   */
  async search(model, domain, limit, offset, order) {
    return await this.#executeKw({
      logTag: '[search]',
      model,
      methodName: 'search',
      args: [domain || []],
      kwargs: this.#cleanKwargs({ limit, offset, order }),
    })
  }

  /**
   * @operationName Search Count
   * @category Records
   * @description Returns the number of records of an Odoo model that match a domain filter, without retrieving them. Efficient for totals and pagination counts. The domain is an array of condition triples like [["is_company","=",true]]; an empty domain counts all records.
   * @route POST /search-count
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"description":"Model technical name, e.g. res.partner, sale.order."}
   * @paramDef {"type":"Array","label":"Domain","name":"domain","description":"Array of filter triples like [[\"is_company\",\"=\",true]]. Empty array counts all records."}
   * @returns {Number}
   * @sampleResult 42
   */
  async searchCount(model, domain) {
    return await this.#executeKw({
      logTag: '[searchCount]',
      model,
      methodName: 'search_count',
      args: [domain || []],
    })
  }

  /**
   * @operationName Read
   * @category Records
   * @description Retrieves field values for specific records of an Odoo model by their IDs. Provide the model name and a list of record IDs (typically obtained from Search). Use fields to limit which columns are returned; omit to return all fields.
   * @route POST /read
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"description":"Model technical name, e.g. res.partner, sale.order."}
   * @paramDef {"type":"Array<Number>","label":"Record IDs","name":"ids","required":true,"description":"Record IDs to read, e.g. [7,18,12]."}
   * @paramDef {"type":"Array<String>","label":"Fields","name":"fields","description":"Field names to return, e.g. [\"name\",\"email\"]. Omit to return every field."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":7,"name":"Agrolait","email":"agrolait@example.com"}]
   */
  async read(model, ids, fields) {
    return await this.#executeKw({
      logTag: '[read]',
      model,
      methodName: 'read',
      args: [ids || []],
      kwargs: this.#cleanKwargs({ fields }),
    })
  }

  /**
   * @operationName Create
   * @category Records
   * @description Creates a new record in an Odoo model and returns its new database ID. Provide the model name and a values object mapping field names to values, e.g. {"name":"Acme Inc","is_company":true,"email":"info@acme.com"}. For relational fields, pass IDs (many2one) or Odoo command tuples (one2many/many2many).
   * @route POST /create
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"description":"Model technical name, e.g. res.partner, sale.order."}
   * @paramDef {"type":"Object","label":"Values","name":"values","required":true,"description":"Field values for the new record, e.g. {\"name\":\"Acme Inc\",\"is_company\":true}."}
   * @returns {Number}
   * @sampleResult 51
   */
  async create(model, values) {
    return await this.#executeKw({
      logTag: '[create]',
      model,
      methodName: 'create',
      args: [values || {}],
    })
  }

  /**
   * @operationName Update
   * @category Records
   * @description Updates one or more existing records in an Odoo model. Provide the model name, a list of record IDs to update, and a values object with the fields to change, e.g. {"name":"New Name","active":false}. All listed records receive the same changes. Returns true on success.
   * @route PUT /update
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"description":"Model technical name, e.g. res.partner, sale.order."}
   * @paramDef {"type":"Array<Number>","label":"Record IDs","name":"ids","required":true,"description":"IDs of the records to update, e.g. [7,18]."}
   * @paramDef {"type":"Object","label":"Values","name":"values","required":true,"description":"Fields to change and their new values, e.g. {\"name\":\"Updated\"}."}
   * @returns {Boolean}
   * @sampleResult true
   */
  async update(model, ids, values) {
    return await this.#executeKw({
      logTag: '[update]',
      model,
      methodName: 'write',
      args: [ids || [], values || {}],
    })
  }

  /**
   * @operationName Delete
   * @category Records
   * @description Permanently deletes one or more records from an Odoo model. Provide the model name and a list of record IDs to remove. This is irreversible. Returns true on success.
   * @route DELETE /delete
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"description":"Model technical name, e.g. res.partner, sale.order."}
   * @paramDef {"type":"Array<Number>","label":"Record IDs","name":"ids","required":true,"description":"IDs of the records to delete, e.g. [7,18]."}
   * @returns {Boolean}
   * @sampleResult true
   */
  async delete(model, ids) {
    return await this.#executeKw({
      logTag: '[delete]',
      model,
      methodName: 'unlink',
      args: [ids || []],
    })
  }

  /**
   * @operationName Fields Get
   * @category Metadata
   * @description Introspects a model and returns metadata for its fields — useful for discovering which fields exist before building a domain or values object. Provide the model name; by default returns each field's label (string), type, and required flag. Optionally pass a custom attributes list to return additional field metadata.
   * @route POST /fields-get
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"description":"Model technical name, e.g. res.partner, sale.order."}
   * @paramDef {"type":"Array<String>","label":"Attributes","name":"attributes","description":"Field attributes to return. Defaults to [\"string\",\"type\",\"required\"]. Other options include \"help\", \"readonly\", \"selection\", \"relation\"."}
   * @returns {Object}
   * @sampleResult {"name":{"string":"Name","type":"char","required":true},"email":{"string":"Email","type":"char","required":false}}
   */
  async fieldsGet(model, attributes) {
    return await this.#executeKw({
      logTag: '[fieldsGet]',
      model,
      methodName: 'fields_get',
      args: [],
      kwargs: this.#cleanKwargs({
        attributes: attributes && attributes.length ? attributes : ['string', 'type', 'required'],
      }),
    })
  }

  /**
   * @operationName Call Method
   * @category Advanced
   * @description Escape hatch for calling any model method not covered by the dedicated operations (e.g. name_get, copy, action_confirm, message_post, or custom methods). Provide the model name, the method name, a positional args array, and an optional kwargs object. The raw result of the method is returned. Use this for workflow actions and less common ORM calls.
   * @route POST /call-method
   * @paramDef {"type":"String","label":"Model","name":"model","required":true,"description":"Model technical name, e.g. sale.order, res.partner."}
   * @paramDef {"type":"String","label":"Method","name":"method","required":true,"description":"Method to call, e.g. action_confirm, name_get, copy, message_post."}
   * @paramDef {"type":"Array","label":"Positional Args","name":"args","description":"Positional arguments array passed to the method, e.g. [[42]] to act on record 42."}
   * @paramDef {"type":"Object","label":"Keyword Args","name":"kwargs","description":"Keyword arguments object passed to the method, e.g. {\"context\":{\"lang\":\"en_US\"}}."}
   * @returns {Object}
   * @sampleResult {"result":true}
   */
  async callMethod(model, method, args, kwargs) {
    return await this.#executeKw({
      logTag: '[callMethod]',
      model,
      methodName: method,
      args: args || [],
      kwargs: kwargs || {},
    })
  }
}

Flowrunner.ServerCode.addService(OdooService, [
  {
    name: 'url',
    displayName: 'Instance URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Odoo instance URL, e.g. https://mycompany.odoo.com (a trailing slash is stripped automatically).',
  },
  {
    name: 'db',
    displayName: 'Database',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'The Odoo database name. For Odoo Online this is usually your subdomain (e.g. mycompany).',
  },
  {
    name: 'username',
    displayName: 'Username',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Odoo login (usually your email address).',
  },
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Odoo API key, used in place of your password. Generate one under Preferences → Account Security → New API Key.',
  },
])
