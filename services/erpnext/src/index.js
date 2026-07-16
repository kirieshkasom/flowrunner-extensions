const logger = {
  info: (...args) => console.log('[ERPNext] info:', ...args),
  debug: (...args) => console.log('[ERPNext] debug:', ...args),
  error: (...args) => console.log('[ERPNext] error:', ...args),
  warn: (...args) => console.log('[ERPNext] warn:', ...args),
}

function stripTrailingSlash(url) {
  return typeof url === 'string' ? url.replace(/\/+$/, '') : url
}

// Parse a value that may already be an object/array, or a JSON string.
function parseJsonParam(value, label) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  if (typeof value === 'object') {
    return value
  }

  try {
    return JSON.parse(value)
  } catch (error) {
    throw new Error(`ERPNext API error: invalid JSON for ${ label }: ${ error.message }`)
  }
}

// Frappe list/get params expect JSON-encoded strings in the query string.
function encodeJsonParam(value) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  return typeof value === 'string' ? value : JSON.stringify(value)
}

// Strip out undefined/null/'' so we never send empty query params.
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
 * @integrationName ERPNext
 * @integrationIcon /icon.png
 */
class ERPNextService {
  constructor(config) {
    this.siteUrl = stripTrailingSlash(config.siteUrl)
    this.apiKey = config.apiKey
    this.apiSecret = config.apiSecret
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const url = `${ this.siteUrl }${ path }`

    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `token ${ this.apiKey }:${ this.apiSecret }`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = this.#extractError(error)
      const status = error.status || error.statusCode

      logger.error(`${ logTag } - failed${ status ? ` (${ status })` : '' }: ${ message }`)

      throw new Error(`ERPNext API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  // Frappe returns HTML tracebacks on 500 plus JSON { exc_type, _server_messages }.
  // Surface the cleanest human-readable message we can find.
  #extractError(error) {
    const body = error.body

    if (body && typeof body === 'object') {
      // _server_messages is a JSON-encoded array of JSON-encoded message objects.
      if (body._server_messages) {
        try {
          const parsed = JSON.parse(body._server_messages)
          const messages = (Array.isArray(parsed) ? parsed : [parsed]).map(entry => {
            try {
              const obj = typeof entry === 'string' ? JSON.parse(entry) : entry

              return obj && obj.message ? obj.message : entry
            } catch (_) {
              return entry
            }
          })

          const joined = messages.filter(Boolean).join('; ').replace(/<[^>]+>/g, '').trim()

          if (joined) {
            return joined
          }
        } catch (_) {
          // fall through to other fields
        }
      }

      if (body.exc_type || body.message) {
        return [body.exc_type, body.message].filter(Boolean).join(': ')
      }
    }

    if (typeof body === 'string' && body) {
      // HTML traceback — collapse to a short single line.
      return body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
    }

    return typeof error.message === 'string' ? error.message : JSON.stringify(error.message)
  }

  /**
   * @operationName List Documents
   * @category Documents
   * @description Retrieves a list of documents of a given DocType (e.g. Customer, Sales Order, Item, Sales Invoice, Contact, Lead). Supports Frappe filters, field selection, sorting, and pagination. Filters use the Frappe triple format [["field","operator","value"]] with operators like =, !=, >, <, >=, <=, like, in, not in, between. Returns the matching records under the data array.
   * @route GET /list-documents
   *
   * @paramDef {"type":"String","label":"DocType","name":"doctype","required":true,"description":"The DocType to list, e.g. Customer, Sales Order, Item, Sales Invoice, Contact, Lead."}
   * @paramDef {"type":"Array","label":"Filters","name":"filters","description":"Frappe filters as a JSON array of triples, e.g. [[\"status\",\"=\",\"Open\"],[\"grand_total\",\">\",1000]]. Leave empty for no filter."}
   * @paramDef {"type":"Array<String>","label":"Fields","name":"fields","description":"Field names to return, e.g. [\"name\",\"customer_name\",\"grand_total\"]. Defaults to [\"name\"] if omitted; use [\"*\"] for all fields."}
   * @paramDef {"type":"Number","label":"Limit Page Length","name":"limitPageLength","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of records to return (page size). Frappe default is 20; set 0 for no limit."}
   * @paramDef {"type":"Number","label":"Limit Start","name":"limitStart","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Offset of the first record for pagination (default 0)."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","description":"Sort expression, e.g. \"modified desc\" or \"creation asc\"."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"name":"SAL-ORD-2024-00001","customer_name":"Acme Inc","grand_total":1500,"status":"To Deliver and Bill"}]}
   */
  async listDocuments(doctype, filters, fields, limitPageLength, limitStart, orderBy) {
    const logTag = '[listDocuments]'

    return await this.#apiRequest({
      logTag,
      path: `/api/resource/${ encodeURIComponent(doctype) }`,
      method: 'get',
      query: {
        filters: encodeJsonParam(parseJsonParam(filters, 'filters')),
        fields: encodeJsonParam(parseJsonParam(fields, 'fields')),
        limit_page_length: limitPageLength === undefined || limitPageLength === null ? undefined : limitPageLength,
        limit_start: limitStart,
        order_by: orderBy,
      },
    })
  }

  /**
   * @operationName Get Document
   * @category Documents
   * @description Retrieves a single document by its DocType and name (primary key). Returns the full document, including child tables, under the data object.
   * @route GET /get-document
   *
   * @paramDef {"type":"String","label":"DocType","name":"doctype","required":true,"description":"The DocType of the document, e.g. Customer, Sales Order, Item."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The document name (primary key / ID), e.g. SAL-ORD-2024-00001 or a customer name."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"name":"CUST-00001","doctype":"Customer","customer_name":"Acme Inc","customer_group":"Commercial","territory":"United States"}}
   */
  async getDocument(doctype, name) {
    const logTag = '[getDocument]'

    return await this.#apiRequest({
      logTag,
      path: `/api/resource/${ encodeURIComponent(doctype) }/${ encodeURIComponent(name) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Document
   * @category Documents
   * @description Creates a new document of the given DocType. Provide the field values as an object matching the DocType schema (including any child table rows). Returns the created document under the data object.
   * @route POST /create-document
   *
   * @paramDef {"type":"String","label":"DocType","name":"doctype","required":true,"description":"The DocType to create, e.g. Customer, Sales Order, Item, Contact, Lead."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"description":"Field values for the new document as an object, e.g. {\"customer_name\":\"Acme Inc\",\"customer_group\":\"Commercial\",\"territory\":\"United States\"}. Also accepts a JSON string."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"name":"CUST-00042","doctype":"Customer","customer_name":"Acme Inc","customer_group":"Commercial","territory":"United States"}}
   */
  async createDocument(doctype, fields) {
    const logTag = '[createDocument]'
    const body = parseJsonParam(fields, 'fields')

    return await this.#apiRequest({
      logTag,
      path: `/api/resource/${ encodeURIComponent(doctype) }`,
      method: 'post',
      body: body || {},
    })
  }

  /**
   * @operationName Update Document
   * @category Documents
   * @description Updates an existing document by DocType and name. Send only the fields you want to change as a partial object; unspecified fields are left untouched. Returns the updated document under the data object.
   * @route PUT /update-document
   *
   * @paramDef {"type":"String","label":"DocType","name":"doctype","required":true,"description":"The DocType of the document, e.g. Customer, Sales Order, Item."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The document name (primary key / ID) to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"description":"Partial field values to update as an object, e.g. {\"customer_group\":\"Individual\"}. Also accepts a JSON string."}
   *
   * @returns {Object}
   * @sampleResult {"data":{"name":"CUST-00042","doctype":"Customer","customer_name":"Acme Inc","customer_group":"Individual"}}
   */
  async updateDocument(doctype, name, fields) {
    const logTag = '[updateDocument]'
    const body = parseJsonParam(fields, 'fields')

    return await this.#apiRequest({
      logTag,
      path: `/api/resource/${ encodeURIComponent(doctype) }/${ encodeURIComponent(name) }`,
      method: 'put',
      body: body || {},
    })
  }

  /**
   * @operationName Delete Document
   * @category Documents
   * @description Deletes a document by DocType and name. This is permanent. Returns a confirmation message on success.
   * @route DELETE /delete-document
   *
   * @paramDef {"type":"String","label":"DocType","name":"doctype","required":true,"description":"The DocType of the document, e.g. Customer, Sales Order, Item."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The document name (primary key / ID) to delete."}
   *
   * @returns {Object}
   * @sampleResult {"message":"ok"}
   */
  async deleteDocument(doctype, name) {
    const logTag = '[deleteDocument]'

    return await this.#apiRequest({
      logTag,
      path: `/api/resource/${ encodeURIComponent(doctype) }/${ encodeURIComponent(name) }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Count Documents
   * @category Query
   * @description Counts documents of a given DocType, optionally constrained by Frappe filters. Uses frappe.client.get_count. Returns the count under the message field.
   * @route GET /count-documents
   *
   * @paramDef {"type":"String","label":"DocType","name":"doctype","required":true,"description":"The DocType to count, e.g. Sales Order, Customer, Item."}
   * @paramDef {"type":"Array","label":"Filters","name":"filters","description":"Frappe filters as a JSON array of triples, e.g. [[\"status\",\"=\",\"Open\"]]. Leave empty to count all documents."}
   *
   * @returns {Object}
   * @sampleResult {"message":128}
   */
  async countDocuments(doctype, filters) {
    const logTag = '[countDocuments]'

    return await this.#apiRequest({
      logTag,
      path: '/api/method/frappe.client.get_count',
      method: 'get',
      query: {
        doctype,
        filters: encodeJsonParam(parseJsonParam(filters, 'filters')),
      },
    })
  }

  /**
   * @operationName Get Value
   * @category Query
   * @description Fetches one or more field values from the first document matching a DocType and filters, using frappe.client.get_value. Provide a single fieldname or a JSON array of field names. Returns the value(s) under the message object.
   * @route GET /get-value
   *
   * @paramDef {"type":"String","label":"DocType","name":"doctype","required":true,"description":"The DocType to read from, e.g. Customer, Item, Sales Order."}
   * @paramDef {"type":"String","label":"Field Name","name":"fieldname","required":true,"description":"Field to read, e.g. \"customer_group\". For multiple fields pass a JSON array string, e.g. [\"customer_group\",\"territory\"]."}
   * @paramDef {"type":"Array","label":"Filters","name":"filters","description":"Frappe filters as a JSON array of triples selecting the document, e.g. [[\"customer_name\",\"=\",\"Acme Inc\"]]. A document name string is also accepted."}
   *
   * @returns {Object}
   * @sampleResult {"message":{"customer_group":"Commercial","territory":"United States"}}
   */
  async getValue(doctype, fieldname, filters) {
    const logTag = '[getValue]'

    return await this.#apiRequest({
      logTag,
      path: '/api/method/frappe.client.get_value',
      method: 'get',
      query: {
        doctype,
        fieldname: encodeJsonParam(parseJsonParam(fieldname, 'fieldname')) || fieldname,
        filters: encodeJsonParam(parseJsonParam(filters, 'filters')),
      },
    })
  }

  /**
   * @operationName Submit Document
   * @category Documents
   * @description Submits a submittable document (sets docstatus to 1) via frappe.client.submit. Provide the full document JSON, which must include doctype and name. Use this for documents like Sales Order, Sales Invoice, and Purchase Order that require submission. Returns the submitted document under the message object.
   * @route POST /submit-document
   *
   * @paramDef {"type":"Object","label":"Document","name":"doc","required":true,"description":"The full document object to submit, including its doctype and name, e.g. {\"doctype\":\"Sales Order\",\"name\":\"SAL-ORD-2024-00001\"}. Also accepts a JSON string. Fetch it first with Get Document if needed."}
   *
   * @returns {Object}
   * @sampleResult {"message":{"name":"SAL-ORD-2024-00001","doctype":"Sales Order","docstatus":1}}
   */
  async submitDocument(doc) {
    const logTag = '[submitDocument]'
    const parsed = parseJsonParam(doc, 'doc')

    return await this.#apiRequest({
      logTag,
      path: '/api/method/frappe.client.submit',
      method: 'post',
      body: { doc: parsed || {} },
    })
  }

  /**
   * @operationName Cancel Document
   * @category Documents
   * @description Cancels a previously submitted document (sets docstatus to 2) via frappe.client.cancel. Provide the DocType and document name. Returns the cancelled document under the message object.
   * @route POST /cancel-document
   *
   * @paramDef {"type":"String","label":"DocType","name":"doctype","required":true,"description":"The DocType of the submitted document, e.g. Sales Order, Sales Invoice."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name (ID) of the submitted document to cancel."}
   *
   * @returns {Object}
   * @sampleResult {"message":{"name":"SAL-ORD-2024-00001","doctype":"Sales Order","docstatus":2}}
   */
  async cancelDocument(doctype, name) {
    const logTag = '[cancelDocument]'

    return await this.#apiRequest({
      logTag,
      path: '/api/method/frappe.client.cancel',
      method: 'post',
      body: { doctype, name },
    })
  }

  /**
   * @operationName Run Method
   * @category Advanced
   * @description Calls a whitelisted server-side method by its dotted path via /api/method (e.g. frappe.client.get_list or a custom whitelisted method). Pass parameters as an object; they are sent as the POST body. Returns whatever the method returns under the message field. Use with care — only whitelisted methods are callable and the call may change server state.
   * @route POST /run-method
   *
   * @paramDef {"type":"String","label":"Method","name":"method","required":true,"description":"Dotted path of the whitelisted method, e.g. frappe.client.get_list or myapp.api.do_something."}
   * @paramDef {"type":"Object","label":"Params","name":"params","description":"Arguments for the method as an object, e.g. {\"doctype\":\"Customer\",\"limit_page_length\":5}. Also accepts a JSON string. Leave empty for no arguments."}
   *
   * @returns {Object}
   * @sampleResult {"message":[{"name":"CUST-00001"},{"name":"CUST-00002"}]}
   */
  async runMethod(method, params) {
    const logTag = '[runMethod]'
    const body = parseJsonParam(params, 'params')

    return await this.#apiRequest({
      logTag,
      path: `/api/method/${ String(method).split('/').map(encodeURIComponent).join('/') }`,
      method: 'post',
      body: body || {},
    })
  }
}

Flowrunner.ServerCode.addService(ERPNextService, [
  {
    name: 'siteUrl',
    displayName: 'Site URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your ERPNext site URL, e.g. https://mycompany.erpnext.com (strip any trailing slash).',
  },
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Generate in ERPNext under User → API Access → Generate Keys, then copy the API Key.',
  },
  {
    name: 'apiSecret',
    displayName: 'API Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'The API Secret shown once when you generate keys under User → API Access → Generate Keys.',
  },
])
