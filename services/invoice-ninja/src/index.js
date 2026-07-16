const logger = {
  info: (...args) => console.log('[Invoice Ninja] info:', ...args),
  debug: (...args) => console.log('[Invoice Ninja] debug:', ...args),
  error: (...args) => console.log('[Invoice Ninja] error:', ...args),
  warn: (...args) => console.log('[Invoice Ninja] warn:', ...args),
}

function clean(obj) {
  if (!obj) {
    return {}
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
 * @integrationName Invoice Ninja
 * @integrationIcon /icon.png
 */
class InvoiceNinjaService {
  constructor(config) {
    this.baseUrl = (config.url || '').trim().replace(/\/+$/, '')
    this.apiToken = config.apiToken
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const url = `${ this.baseUrl }/api/v1${ path }`

    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'X-Api-Token': this.apiToken,
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        })
        .query(cleanedQuery)

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const responseBody = error.body || {}
      let message = responseBody.message || error.message || 'Unknown error'

      if (responseBody.errors && typeof responseBody.errors === 'object') {
        const fieldErrors = Object.entries(responseBody.errors)
          .map(([field, messages]) => `${ field }: ${ Array.isArray(messages) ? messages.join(', ') : messages }`)
          .join('; ')

        if (fieldErrors) {
          message = `${ message } (${ fieldErrors })`
        }
      }

      const status = error.status || error.statusCode
      const suffix = status ? ` [status ${ status }]` : ''

      logger.error(`${ logTag } - failed: ${ message }${ suffix }`)

      throw new Error(`Invoice Ninja API error: ${ message }${ suffix }`)
    }
  }

  /* ============================== Clients ============================== */

  /**
   * @operationName List Clients
   * @category Clients
   * @description Retrieves a paginated list of clients. Supports a free-text search filter (matches name, id number, email and contact fields), a status filter (active, archived or deleted), page size and page number, sorting, and an include parameter to embed related records such as contacts or documents.
   * @route GET /clients
   * @paramDef {"type":"String","label":"Search Filter","name":"filter","required":false,"description":"Free-text search across client name, number, email and contacts."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Archived","Deleted"]}},"description":"Filter clients by lifecycle status."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records per page (default 20)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (default 1)."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","required":false,"description":"Sort expression, e.g. 'name|asc' or 'created_at|desc'."}
   * @paramDef {"type":"String","label":"Include","name":"include","required":false,"description":"Comma-separated related data to embed, e.g. 'contacts,documents'."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"Wpmbk5ezJn","name":"Acme Inc","balance":150,"contacts":[{"id":"abc","first_name":"Jane","email":"jane@acme.com"}]}],"meta":{"pagination":{"total":1,"count":1,"per_page":20,"current_page":1,"total_pages":1}}}
   */
  async listClients(filter, status, perPage, page, sort, include) {
    return this.#apiRequest({
      path: '/clients',
      method: 'get',
      query: {
        filter,
        status: this.#resolveChoice(status, { Active: 'active', Archived: 'archived', Deleted: 'deleted' }),
        per_page: perPage,
        page,
        sort,
        include,
      },
      logTag: 'listClients',
    })
  }

  /**
   * @operationName Get Client
   * @category Clients
   * @description Retrieves a single client by its hashed id, including balance, contacts and settings. Use the include parameter to embed related records such as invoices or documents.
   * @route GET /clients/{clientId}
   * @paramDef {"type":"String","label":"Client","name":"clientId","required":true,"dictionary":"getClientsDictionary","description":"The hashed id of the client to retrieve."}
   * @paramDef {"type":"String","label":"Include","name":"include","required":false,"description":"Comma-separated related data to embed, e.g. 'contacts,activities'."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"Wpmbk5ezJn","name":"Acme Inc","balance":150,"contacts":[{"id":"abc","first_name":"Jane","email":"jane@acme.com"}]}}
   */
  async getClient(clientId, include) {
    return this.#apiRequest({
      path: `/clients/${ clientId }`,
      method: 'get',
      query: { include },
      logTag: 'getClient',
    })
  }

  /**
   * @operationName Create Client
   * @category Clients
   * @description Creates a new client. The name field is the display/company name. Contacts is an array of contact people, each with first name, last name, email and optional phone; the first contact becomes the primary contact. Address fields and website are optional. Country is provided as a numeric country id.
   * @route POST /clients
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Client or company display name."}
   * @paramDef {"type":"Array<ClientContact>","label":"Contacts","name":"contacts","required":false,"description":"Contact people for this client. The first entry is treated as the primary contact."}
   * @paramDef {"type":"String","label":"Address Line 1","name":"address1","required":false,"description":"Street address line 1."}
   * @paramDef {"type":"String","label":"Address Line 2","name":"address2","required":false,"description":"Street address line 2."}
   * @paramDef {"type":"String","label":"City","name":"city","required":false,"description":"City."}
   * @paramDef {"type":"String","label":"State","name":"state","required":false,"description":"State, province or region."}
   * @paramDef {"type":"String","label":"Postal Code","name":"postalCode","required":false,"description":"Postal or ZIP code."}
   * @paramDef {"type":"String","label":"Country Id","name":"countryId","required":false,"description":"Numeric country id (e.g. 840 for United States)."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","required":false,"description":"Client phone number."}
   * @paramDef {"type":"String","label":"Website","name":"website","required":false,"description":"Client website URL."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"additionalFields","required":false,"description":"Any other client fields to set, merged into the request body."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"Wpmbk5ezJn","name":"Acme Inc","contacts":[{"id":"abc","first_name":"Jane","email":"jane@acme.com"}]}}
   */
  async createClient(name, contacts, address1, address2, city, state, postalCode, countryId, phone, website, additionalFields) {
    const body = clean({
      name,
      address1,
      address2,
      city,
      state,
      postal_code: postalCode,
      country_id: countryId,
      phone,
      website,
      ...(additionalFields || {}),
    })

    if (Array.isArray(contacts) && contacts.length > 0) {
      body.contacts = contacts
    }

    return this.#apiRequest({ path: '/clients', method: 'post', body, logTag: 'createClient' })
  }

  /**
   * @operationName Update Client
   * @category Clients
   * @description Updates an existing client identified by its hashed id. Only the provided fields are changed. When contacts are supplied the full contact list is replaced, so include every contact you want to keep.
   * @route PUT /clients/{clientId}
   * @paramDef {"type":"String","label":"Client","name":"clientId","required":true,"dictionary":"getClientsDictionary","description":"The hashed id of the client to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":false,"description":"Updated client or company display name."}
   * @paramDef {"type":"Array<ClientContact>","label":"Contacts","name":"contacts","required":false,"description":"Replacement contact list. Include every contact you want to retain."}
   * @paramDef {"type":"String","label":"Address Line 1","name":"address1","required":false,"description":"Street address line 1."}
   * @paramDef {"type":"String","label":"City","name":"city","required":false,"description":"City."}
   * @paramDef {"type":"String","label":"State","name":"state","required":false,"description":"State, province or region."}
   * @paramDef {"type":"String","label":"Postal Code","name":"postalCode","required":false,"description":"Postal or ZIP code."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","required":false,"description":"Client phone number."}
   * @paramDef {"type":"String","label":"Website","name":"website","required":false,"description":"Client website URL."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"additionalFields","required":false,"description":"Any other client fields to set, merged into the request body."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"Wpmbk5ezJn","name":"Acme Inc (Updated)","balance":150}}
   */
  async updateClient(clientId, name, contacts, address1, city, state, postalCode, phone, website, additionalFields) {
    const body = clean({
      name,
      address1,
      city,
      state,
      postal_code: postalCode,
      phone,
      website,
      ...(additionalFields || {}),
    })

    if (Array.isArray(contacts) && contacts.length > 0) {
      body.contacts = contacts
    }

    return this.#apiRequest({ path: `/clients/${ clientId }`, method: 'put', body, logTag: 'updateClient' })
  }

  /**
   * @operationName Delete Client
   * @category Clients
   * @description Deletes a client by its hashed id. This performs a soft delete; the client is removed from active lists but retained for audit purposes and can be restored from the Invoice Ninja UI.
   * @route DELETE /clients/{clientId}
   * @paramDef {"type":"String","label":"Client","name":"clientId","required":true,"dictionary":"getClientsDictionary","description":"The hashed id of the client to delete."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"Wpmbk5ezJn","name":"Acme Inc","is_deleted":true}}
   */
  async deleteClient(clientId) {
    return this.#apiRequest({ path: `/clients/${ clientId }`, method: 'delete', logTag: 'deleteClient' })
  }

  /* ============================== Invoices ============================== */

  /**
   * @operationName List Invoices
   * @category Invoices
   * @description Retrieves a paginated list of invoices. Filter by client, by lifecycle status, or by free-text search. Supports page size, page number and an include parameter to embed related records such as the client or line items.
   * @route GET /invoices
   * @paramDef {"type":"String","label":"Client","name":"clientId","required":false,"dictionary":"getClientsDictionary","description":"Restrict results to a single client."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Sent","Partial","Paid","Cancelled"]}},"description":"Filter invoices by status."}
   * @paramDef {"type":"String","label":"Search Filter","name":"filter","required":false,"description":"Free-text search across invoice number, po number and notes."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records per page (default 20)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (default 1)."}
   * @paramDef {"type":"String","label":"Include","name":"include","required":false,"description":"Comma-separated related data to embed, e.g. 'client,payments'."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"Opnel5aKBz","number":"0001","client_id":"Wpmbk5ezJn","amount":150,"balance":150,"status_id":"2"}],"meta":{"pagination":{"total":1,"count":1,"per_page":20,"current_page":1,"total_pages":1}}}
   */
  async listInvoices(clientId, status, filter, perPage, page, include) {
    return this.#apiRequest({
      path: '/invoices',
      method: 'get',
      query: {
        client_id: clientId,
        client_status: this.#resolveChoice(status, {
          Draft: 'draft',
          Sent: 'sent',
          Partial: 'partial',
          Paid: 'paid',
          Cancelled: 'cancelled',
        }),
        filter,
        per_page: perPage,
        page,
        include,
      },
      logTag: 'listInvoices',
    })
  }

  /**
   * @operationName Get Invoice
   * @category Invoices
   * @description Retrieves a single invoice by its hashed id, including line items, totals and status. Use the include parameter to embed related records such as the client or payments.
   * @route GET /invoices/{invoiceId}
   * @paramDef {"type":"String","label":"Invoice Id","name":"invoiceId","required":true,"description":"The hashed id of the invoice to retrieve."}
   * @paramDef {"type":"String","label":"Include","name":"include","required":false,"description":"Comma-separated related data to embed, e.g. 'client,payments'."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"Opnel5aKBz","number":"0001","client_id":"Wpmbk5ezJn","amount":150,"balance":150,"line_items":[{"product_key":"Design","cost":150,"quantity":1}]}}
   */
  async getInvoice(invoiceId, include) {
    return this.#apiRequest({
      path: `/invoices/${ invoiceId }`,
      method: 'get',
      query: { include },
      logTag: 'getInvoice',
    })
  }

  /**
   * @operationName Create Invoice
   * @category Invoices
   * @description Creates a new invoice for a client. Line items each carry a product key, notes/description, unit cost and quantity, plus optional per-line tax name and rate. Optional header fields include issue date, due date, po number, a percentage or absolute discount and public/private notes.
   * @route POST /invoices
   * @paramDef {"type":"String","label":"Client","name":"clientId","required":true,"dictionary":"getClientsDictionary","description":"The client this invoice is billed to."}
   * @paramDef {"type":"Array<InvoiceLineItem>","label":"Line Items","name":"lineItems","required":true,"description":"The invoice line items."}
   * @paramDef {"type":"String","label":"Date","name":"date","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Invoice issue date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Invoice due date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"PO Number","name":"poNumber","required":false,"description":"Purchase order number."}
   * @paramDef {"type":"Number","label":"Discount","name":"discount","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Discount amount; interpreted as a percentage when Is Amount Discount is false."}
   * @paramDef {"type":"Boolean","label":"Is Amount Discount","name":"isAmountDiscount","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"When true the discount is an absolute amount; when false it is a percentage."}
   * @paramDef {"type":"String","label":"Public Notes","name":"publicNotes","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Notes shown to the client on the invoice."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"additionalFields","required":false,"description":"Any other invoice fields to set, merged into the request body."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"Opnel5aKBz","number":"0001","client_id":"Wpmbk5ezJn","amount":150,"balance":150,"status_id":"1"}}
   */
  async createInvoice(clientId, lineItems, date, dueDate, poNumber, discount, isAmountDiscount, publicNotes, additionalFields) {
    const body = clean({
      client_id: clientId,
      date,
      due_date: dueDate,
      po_number: poNumber,
      discount,
      is_amount_discount: isAmountDiscount,
      public_notes: publicNotes,
      ...(additionalFields || {}),
    })

    body.line_items = Array.isArray(lineItems) ? lineItems : []

    return this.#apiRequest({ path: '/invoices', method: 'post', body, logTag: 'createInvoice' })
  }

  /**
   * @operationName Update Invoice
   * @category Invoices
   * @description Updates an existing invoice identified by its hashed id. Only the provided fields are changed. Supplying line items replaces the full set of line items on the invoice.
   * @route PUT /invoices/{invoiceId}
   * @paramDef {"type":"String","label":"Invoice Id","name":"invoiceId","required":true,"description":"The hashed id of the invoice to update."}
   * @paramDef {"type":"Array<InvoiceLineItem>","label":"Line Items","name":"lineItems","required":false,"description":"Replacement line items for the invoice."}
   * @paramDef {"type":"String","label":"Date","name":"date","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Invoice issue date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Invoice due date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"PO Number","name":"poNumber","required":false,"description":"Purchase order number."}
   * @paramDef {"type":"String","label":"Public Notes","name":"publicNotes","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Notes shown to the client on the invoice."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"additionalFields","required":false,"description":"Any other invoice fields to set, merged into the request body."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"Opnel5aKBz","number":"0001","client_id":"Wpmbk5ezJn","amount":200,"balance":200}}
   */
  async updateInvoice(invoiceId, lineItems, date, dueDate, poNumber, publicNotes, additionalFields) {
    const body = clean({
      date,
      due_date: dueDate,
      po_number: poNumber,
      public_notes: publicNotes,
      ...(additionalFields || {}),
    })

    if (Array.isArray(lineItems) && lineItems.length > 0) {
      body.line_items = lineItems
    }

    return this.#apiRequest({ path: `/invoices/${ invoiceId }`, method: 'put', body, logTag: 'updateInvoice' })
  }

  /**
   * @operationName Delete Invoice
   * @category Invoices
   * @description Deletes an invoice by its hashed id. This is a soft delete; the invoice is removed from active lists but retained for audit purposes and can be restored from the Invoice Ninja UI.
   * @route DELETE /invoices/{invoiceId}
   * @paramDef {"type":"String","label":"Invoice Id","name":"invoiceId","required":true,"description":"The hashed id of the invoice to delete."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"Opnel5aKBz","number":"0001","is_deleted":true}}
   */
  async deleteInvoice(invoiceId) {
    return this.#apiRequest({ path: `/invoices/${ invoiceId }`, method: 'delete', logTag: 'deleteInvoice' })
  }

  /**
   * @operationName Invoice Action
   * @category Invoices
   * @description Performs a bulk-style action on one invoice via the invoices bulk endpoint. Choose an action such as emailing the invoice to the client, marking it sent or paid, or archiving, restoring, cancelling or deleting it. The invoice id is passed to the endpoint as a single-element ids array.
   * @route POST /invoices/bulk
   * @paramDef {"type":"String","label":"Invoice Id","name":"invoiceId","required":true,"description":"The hashed id of the invoice to act on."}
   * @paramDef {"type":"String","label":"Action","name":"action","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Email","Mark Sent","Mark Paid","Archive","Restore","Cancel","Delete"]}},"description":"The action to perform on the invoice."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"Opnel5aKBz","number":"0001","status_id":"2"}]}
   */
  async invoiceAction(invoiceId, action) {
    const body = {
      action: this.#resolveChoice(action, {
        'Email': 'email',
        'Mark Sent': 'mark_sent',
        'Mark Paid': 'mark_paid',
        'Archive': 'archive',
        'Restore': 'restore',
        'Cancel': 'cancel',
        'Delete': 'delete',
      }),
      ids: [invoiceId],
    }

    return this.#apiRequest({ path: '/invoices/bulk', method: 'post', body, logTag: 'invoiceAction' })
  }

  /* ============================== Payments ============================== */

  /**
   * @operationName List Payments
   * @category Payments
   * @description Retrieves a paginated list of payments. Filter by client or by free-text search, and use the include parameter to embed related records such as the client or applied invoices.
   * @route GET /payments
   * @paramDef {"type":"String","label":"Client","name":"clientId","required":false,"dictionary":"getClientsDictionary","description":"Restrict results to a single client."}
   * @paramDef {"type":"String","label":"Search Filter","name":"filter","required":false,"description":"Free-text search across payment number and transaction reference."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records per page (default 20)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (default 1)."}
   * @paramDef {"type":"String","label":"Include","name":"include","required":false,"description":"Comma-separated related data to embed, e.g. 'client,invoices'."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"Opnel5aKBz","number":"0001","client_id":"Wpmbk5ezJn","amount":150,"applied":150}],"meta":{"pagination":{"total":1,"count":1,"per_page":20,"current_page":1,"total_pages":1}}}
   */
  async listPayments(clientId, filter, perPage, page, include) {
    return this.#apiRequest({
      path: '/payments',
      method: 'get',
      query: { client_id: clientId, filter, per_page: perPage, page, include },
      logTag: 'listPayments',
    })
  }

  /**
   * @operationName Get Payment
   * @category Payments
   * @description Retrieves a single payment by its hashed id, including the amount, applied amount and the invoices it is applied to. Use the include parameter to embed related records.
   * @route GET /payments/{paymentId}
   * @paramDef {"type":"String","label":"Payment Id","name":"paymentId","required":true,"description":"The hashed id of the payment to retrieve."}
   * @paramDef {"type":"String","label":"Include","name":"include","required":false,"description":"Comma-separated related data to embed, e.g. 'client,invoices'."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"Opnel5aKBz","number":"0001","client_id":"Wpmbk5ezJn","amount":150,"applied":150}}
   */
  async getPayment(paymentId, include) {
    return this.#apiRequest({
      path: `/payments/${ paymentId }`,
      method: 'get',
      query: { include },
      logTag: 'getPayment',
    })
  }

  /**
   * @operationName Create Payment
   * @category Payments
   * @description Records a payment for a client. The amount is the total payment received. The invoices array applies portions of the payment to specific invoices, each entry pairing an invoice id with the amount applied to it. Optional fields include the payment date, transaction reference and payment type.
   * @route POST /payments
   * @paramDef {"type":"String","label":"Client","name":"clientId","required":true,"dictionary":"getClientsDictionary","description":"The client the payment belongs to."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Total amount of the payment received."}
   * @paramDef {"type":"Array<PaymentInvoice>","label":"Applied Invoices","name":"invoices","required":false,"description":"Invoices this payment is applied to, each with an invoice id and applied amount."}
   * @paramDef {"type":"String","label":"Date","name":"date","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Payment date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"Transaction Reference","name":"transactionReference","required":false,"description":"External transaction reference or check number."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"additionalFields","required":false,"description":"Any other payment fields to set, merged into the request body."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"Opnel5aKBz","number":"0001","client_id":"Wpmbk5ezJn","amount":150,"applied":150}}
   */
  async createPayment(clientId, amount, invoices, date, transactionReference, additionalFields) {
    const body = clean({
      client_id: clientId,
      amount,
      date,
      transaction_reference: transactionReference,
      ...(additionalFields || {}),
    })

    if (Array.isArray(invoices) && invoices.length > 0) {
      body.invoices = invoices
    }

    return this.#apiRequest({ path: '/payments', method: 'post', body, logTag: 'createPayment' })
  }

  /* ============================== Products ============================== */

  /**
   * @operationName List Products
   * @category Products
   * @description Retrieves a paginated list of products from the product catalog. Supports a free-text search filter across product key and notes, page size, page number and an include parameter.
   * @route GET /products
   * @paramDef {"type":"String","label":"Search Filter","name":"filter","required":false,"description":"Free-text search across product key and notes."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records per page (default 20)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (default 1)."}
   * @paramDef {"type":"String","label":"Include","name":"include","required":false,"description":"Comma-separated related data to embed."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"Wpmbk5ezJn","product_key":"Design","notes":"Design work","price":150,"quantity":1}],"meta":{"pagination":{"total":1,"count":1,"per_page":20,"current_page":1,"total_pages":1}}}
   */
  async listProducts(filter, perPage, page, include) {
    return this.#apiRequest({
      path: '/products',
      method: 'get',
      query: { filter, per_page: perPage, page, include },
      logTag: 'listProducts',
    })
  }

  /**
   * @operationName Get Product
   * @category Products
   * @description Retrieves a single product by its hashed id, including the product key, notes, price and default quantity.
   * @route GET /products/{productId}
   * @paramDef {"type":"String","label":"Product Id","name":"productId","required":true,"description":"The hashed id of the product to retrieve."}
   * @paramDef {"type":"String","label":"Include","name":"include","required":false,"description":"Comma-separated related data to embed."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"Wpmbk5ezJn","product_key":"Design","notes":"Design work","price":150,"quantity":1}}
   */
  async getProduct(productId, include) {
    return this.#apiRequest({
      path: `/products/${ productId }`,
      method: 'get',
      query: { include },
      logTag: 'getProduct',
    })
  }

  /**
   * @operationName Create Product
   * @category Products
   * @description Creates a new product in the catalog. The product key is the item identifier or name. Optional fields include a description (notes), unit price, default quantity and tax details.
   * @route POST /products
   * @paramDef {"type":"String","label":"Product Key","name":"productKey","required":true,"description":"The product identifier or name."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Product description or notes."}
   * @paramDef {"type":"Number","label":"Price","name":"price","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unit price of the product."}
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Default quantity for this product."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"additionalFields","required":false,"description":"Any other product fields to set, merged into the request body."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"Wpmbk5ezJn","product_key":"Design","notes":"Design work","price":150,"quantity":1}}
   */
  async createProduct(productKey, notes, price, quantity, additionalFields) {
    const body = clean({
      product_key: productKey,
      notes,
      price,
      quantity,
      ...(additionalFields || {}),
    })

    return this.#apiRequest({ path: '/products', method: 'post', body, logTag: 'createProduct' })
  }

  /**
   * @operationName Update Product
   * @category Products
   * @description Updates an existing product identified by its hashed id. Only the provided fields are changed.
   * @route PUT /products/{productId}
   * @paramDef {"type":"String","label":"Product Id","name":"productId","required":true,"description":"The hashed id of the product to update."}
   * @paramDef {"type":"String","label":"Product Key","name":"productKey","required":false,"description":"Updated product identifier or name."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated product description or notes."}
   * @paramDef {"type":"Number","label":"Price","name":"price","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Updated unit price of the product."}
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Updated default quantity."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"additionalFields","required":false,"description":"Any other product fields to set, merged into the request body."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"Wpmbk5ezJn","product_key":"Design","notes":"Design work","price":175,"quantity":1}}
   */
  async updateProduct(productId, productKey, notes, price, quantity, additionalFields) {
    const body = clean({
      product_key: productKey,
      notes,
      price,
      quantity,
      ...(additionalFields || {}),
    })

    return this.#apiRequest({ path: `/products/${ productId }`, method: 'put', body, logTag: 'updateProduct' })
  }

  /* ============================== Quotes ============================== */

  /**
   * @operationName List Quotes
   * @category Quotes
   * @description Retrieves a paginated list of quotes. Filter by client or by free-text search, and use the include parameter to embed related records such as the client or line items.
   * @route GET /quotes
   * @paramDef {"type":"String","label":"Client","name":"clientId","required":false,"dictionary":"getClientsDictionary","description":"Restrict results to a single client."}
   * @paramDef {"type":"String","label":"Search Filter","name":"filter","required":false,"description":"Free-text search across quote number, po number and notes."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records per page (default 20)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (default 1)."}
   * @paramDef {"type":"String","label":"Include","name":"include","required":false,"description":"Comma-separated related data to embed, e.g. 'client'."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"Opnel5aKBz","number":"0001","client_id":"Wpmbk5ezJn","amount":150,"status_id":"2"}],"meta":{"pagination":{"total":1,"count":1,"per_page":20,"current_page":1,"total_pages":1}}}
   */
  async listQuotes(clientId, filter, perPage, page, include) {
    return this.#apiRequest({
      path: '/quotes',
      method: 'get',
      query: { client_id: clientId, filter, per_page: perPage, page, include },
      logTag: 'listQuotes',
    })
  }

  /**
   * @operationName Create Quote
   * @category Quotes
   * @description Creates a new quote for a client. Line items each carry a product key, notes/description, unit cost and quantity. Optional header fields include issue date, valid-until date, po number and public notes. A quote can later be converted into an invoice once approved.
   * @route POST /quotes
   * @paramDef {"type":"String","label":"Client","name":"clientId","required":true,"dictionary":"getClientsDictionary","description":"The client this quote is for."}
   * @paramDef {"type":"Array<InvoiceLineItem>","label":"Line Items","name":"lineItems","required":true,"description":"The quote line items."}
   * @paramDef {"type":"String","label":"Date","name":"date","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Quote issue date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"Valid Until","name":"dueDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Date the quote is valid until (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"PO Number","name":"poNumber","required":false,"description":"Purchase order number."}
   * @paramDef {"type":"String","label":"Public Notes","name":"publicNotes","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Notes shown to the client on the quote."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"additionalFields","required":false,"description":"Any other quote fields to set, merged into the request body."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"Opnel5aKBz","number":"0001","client_id":"Wpmbk5ezJn","amount":150,"status_id":"1"}}
   */
  async createQuote(clientId, lineItems, date, dueDate, poNumber, publicNotes, additionalFields) {
    const body = clean({
      client_id: clientId,
      date,
      due_date: dueDate,
      po_number: poNumber,
      public_notes: publicNotes,
      ...(additionalFields || {}),
    })

    body.line_items = Array.isArray(lineItems) ? lineItems : []

    return this.#apiRequest({ path: '/quotes', method: 'post', body, logTag: 'createQuote' })
  }

  /**
   * @operationName Approve Quote
   * @category Quotes
   * @description Approves a quote via the quotes bulk endpoint, marking it as accepted by the client. The quote id is passed to the endpoint as a single-element ids array.
   * @route POST /quotes/bulk
   * @paramDef {"type":"String","label":"Quote Id","name":"quoteId","required":true,"description":"The hashed id of the quote to approve."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"Opnel5aKBz","number":"0001","status_id":"4"}]}
   */
  async approveQuote(quoteId) {
    const body = { action: 'approve', ids: [quoteId] }

    return this.#apiRequest({ path: '/quotes/bulk', method: 'post', body, logTag: 'approveQuote' })
  }

  /* ========================= Recurring Invoices ========================= */

  /**
   * @operationName List Recurring Invoices
   * @category Recurring Invoices
   * @description Retrieves a paginated list of recurring invoices. Filter by client or by free-text search, and use the include parameter to embed related records such as the client.
   * @route GET /recurring_invoices
   * @paramDef {"type":"String","label":"Client","name":"clientId","required":false,"dictionary":"getClientsDictionary","description":"Restrict results to a single client."}
   * @paramDef {"type":"String","label":"Search Filter","name":"filter","required":false,"description":"Free-text search across recurring invoice number and notes."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records per page (default 20)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (default 1)."}
   * @paramDef {"type":"String","label":"Include","name":"include","required":false,"description":"Comma-separated related data to embed, e.g. 'client'."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"Opnel5aKBz","number":"R0001","client_id":"Wpmbk5ezJn","amount":150,"frequency_id":"5"}],"meta":{"pagination":{"total":1,"count":1,"per_page":20,"current_page":1,"total_pages":1}}}
   */
  async listRecurringInvoices(clientId, filter, perPage, page, include) {
    return this.#apiRequest({
      path: '/recurring_invoices',
      method: 'get',
      query: { client_id: clientId, filter, per_page: perPage, page, include },
      logTag: 'listRecurringInvoices',
    })
  }

  /* ============================ Dictionaries ============================ */

  /**
   * @typedef {Object} getClientsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter matched against client name and contacts."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number cursor for pagination."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Clients Dictionary
   * @description Lists clients for selection in dependent parameters, returning each client's name as the label and hashed id as the value.
   * @route POST /get-clients-dictionary
   * @paramDef {"type":"getClientsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Acme Inc","value":"Wpmbk5ezJn","note":"jane@acme.com"}],"cursor":"2"}
   */
  async getClientsDictionary(payload) {
    const { search, cursor } = payload || {}
    const page = cursor ? Number(cursor) : 1

    const response = await this.#apiRequest({
      path: '/clients',
      method: 'get',
      query: { filter: search, per_page: 50, page, status: 'active' },
      logTag: 'getClientsDictionary',
    })

    const data = Array.isArray(response?.data) ? response.data : []

    const items = data.map(client => {
      const primaryContact = Array.isArray(client.contacts) ? client.contacts[0] : undefined

      return {
        label: client.name || primaryContact?.email || client.id,
        value: client.id,
        note: primaryContact?.email || undefined,
      }
    })

    const pagination = response?.meta?.pagination
    const nextCursor = pagination && pagination.current_page < pagination.total_pages
      ? String(pagination.current_page + 1)
      : undefined

    return { items, cursor: nextCursor }
  }
}

/**
 * @typedef {Object} ClientContact
 * @paramDef {"type":"String","label":"First Name","name":"first_name","required":false,"description":"Contact first name."}
 * @paramDef {"type":"String","label":"Last Name","name":"last_name","required":false,"description":"Contact last name."}
 * @paramDef {"type":"String","label":"Email","name":"email","required":false,"description":"Contact email address."}
 * @paramDef {"type":"String","label":"Phone","name":"phone","required":false,"description":"Contact phone number."}
 */

/**
 * @typedef {Object} InvoiceLineItem
 * @paramDef {"type":"String","label":"Product Key","name":"product_key","required":false,"description":"Product identifier or item name."}
 * @paramDef {"type":"String","label":"Notes","name":"notes","required":false,"description":"Line item description."}
 * @paramDef {"type":"Number","label":"Cost","name":"cost","required":false,"description":"Unit cost of the line item."}
 * @paramDef {"type":"Number","label":"Quantity","name":"quantity","required":false,"description":"Quantity of the line item."}
 * @paramDef {"type":"String","label":"Tax Name 1","name":"tax_name1","required":false,"description":"Name of the first tax applied to this line."}
 * @paramDef {"type":"Number","label":"Tax Rate 1","name":"tax_rate1","required":false,"description":"Rate of the first tax applied to this line."}
 */

/**
 * @typedef {Object} PaymentInvoice
 * @paramDef {"type":"String","label":"Invoice Id","name":"invoice_id","required":true,"description":"The hashed id of the invoice to apply the payment to."}
 * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"description":"Amount of the payment applied to this invoice."}
 */

Flowrunner.ServerCode.addService(InvoiceNinjaService, [
  {
    name: 'url',
    displayName: 'URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Invoice Ninja URL — https://invoicing.co for the hosted app, or your self-hosted URL. Strip any trailing slash.',
  },
  {
    name: 'apiToken',
    displayName: 'API Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Invoice Ninja → Settings → Account Management → API Tokens → create a token.',
  },
])
