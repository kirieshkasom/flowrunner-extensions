const logger = {
  info: (...args) => console.log('[SyncroMSP] info:', ...args),
  debug: (...args) => console.log('[SyncroMSP] debug:', ...args),
  error: (...args) => console.log('[SyncroMSP] error:', ...args),
  warn: (...args) => console.log('[SyncroMSP] warn:', ...args),
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
 * @integrationName SyncroMSP
 * @integrationIcon /icon.png
 */
class SyncroMSPService {
  constructor(config) {
    this.subdomain = config.subdomain
    this.apiKey = config.apiKey
  }

  #baseUrl() {
    return `https://${ this.subdomain }.syncromsp.com/api/v1`
  }

  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const url = `${ this.#baseUrl() }${ path }`

    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.apiKey }`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const body = error.body || {}
      const detail =
        body.error ||
        (Array.isArray(body.errors) ? body.errors.join(', ') : body.errors) ||
        body.message ||
        error.message
      const status = error.status || error.statusCode
      const message = status ? `${ detail } (HTTP ${ status })` : detail

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`SyncroMSP API error: ${ message }`)
    }
  }

  // ─── Tickets ───────────────────────────────────────────────────────────

  /**
   * @operationName List Tickets
   * @category Tickets
   * @description Retrieves a paginated list of tickets (25 per page). Filter by search text, customer, or status. Returns each ticket with its number, subject, status, priority, customer, and timestamps, plus a meta object with pagination details (page, total_pages, total_entries).
   * @route GET /tickets
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (25 tickets per page). Defaults to 1."}
   * @paramDef {"type":"String","label":"Search Query","name":"query","description":"Free-text search across ticket subject and number."}
   * @paramDef {"type":"Number","label":"Customer ID","name":"customerId","dictionary":"getCustomersDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Restrict results to tickets belonging to this customer."}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"Filter by ticket status label exactly as configured in Syncro (e.g. 'New', 'In Progress', 'Resolved')."}
   *
   * @returns {Object}
   * @sampleResult {"tickets":[{"id":123,"number":1001,"subject":"Laptop won't boot","status":"New","priority":"2 Normal","customer_id":456,"customer_business_then_name":"Acme Inc","created_at":"2025-01-10T12:00:00Z"}],"meta":{"total_pages":4,"total_entries":90,"per_page":25,"page":1}}
   */
  async listTickets(page, query, customerId, status) {
    return await this.#apiRequest({
      logTag: '[listTickets]',
      path: '/tickets',
      method: 'get',
      query: { page, query, customer_id: customerId, status },
    })
  }

  /**
   * @operationName Get Ticket
   * @category Tickets
   * @description Retrieves a single ticket by its ID, including full details such as subject, description, status, priority, problem type, assigned tech, associated customer and asset, comments, and timestamps.
   * @route GET /tickets/{id}
   *
   * @paramDef {"type":"Number","label":"Ticket ID","name":"ticketId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The unique ID of the ticket to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"ticket":{"id":123,"number":1001,"subject":"Laptop won't boot","status":"New","priority":"2 Normal","problem_type":"Hardware","customer_id":456,"created_at":"2025-01-10T12:00:00Z","comments":[]}}
   */
  async getTicket(ticketId) {
    return await this.#apiRequest({
      logTag: '[getTicket]',
      path: `/tickets/${ ticketId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Ticket
   * @category Tickets
   * @description Creates a new ticket for a customer. Requires a subject and customer ID. Optionally set the problem type, status, priority, and initial description. Returns the created ticket including its number and ID.
   * @route POST /tickets
   *
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Short summary of the issue shown as the ticket title."}
   * @paramDef {"type":"Number","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the customer this ticket belongs to."}
   * @paramDef {"type":"String","label":"Problem Type","name":"problemType","description":"Category of the problem as configured in Syncro (e.g. 'Hardware', 'Software', 'Network')."}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"Initial ticket status label exactly as configured in Syncro (e.g. 'New'). Defaults to your account's default new-ticket status."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","uiComponent":{"type":"DROPDOWN","options":{"values":["Urgent","High","Normal","Low"]}},"description":"Ticket priority. Maps to Syncro's numbered priority labels."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional initial description or details of the issue."}
   *
   * @returns {Object}
   * @sampleResult {"ticket":{"id":123,"number":1001,"subject":"Laptop won't boot","status":"New","priority":"2 Normal","customer_id":456,"created_at":"2025-01-10T12:00:00Z"}}
   */
  async createTicket(subject, customerId, problemType, status, priority, description) {
    const body = clean({
      subject,
      customer_id: customerId,
      problem_type: problemType,
      status,
      priority: this.#resolvePriority(priority),
      description,
    })

    return await this.#apiRequest({
      logTag: '[createTicket]',
      path: '/tickets',
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Update Ticket
   * @category Tickets
   * @description Updates an existing ticket's fields. Provide the ticket ID and only the fields you want to change; omitted fields are left unchanged. Returns the updated ticket.
   * @route PUT /tickets/{id}
   *
   * @paramDef {"type":"Number","label":"Ticket ID","name":"ticketId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The unique ID of the ticket to update."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"New subject/title for the ticket."}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"New ticket status label exactly as configured in Syncro (e.g. 'In Progress', 'Resolved')."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","uiComponent":{"type":"DROPDOWN","options":{"values":["Urgent","High","Normal","Low"]}},"description":"New ticket priority."}
   * @paramDef {"type":"String","label":"Problem Type","name":"problemType","description":"New problem type/category."}
   *
   * @returns {Object}
   * @sampleResult {"ticket":{"id":123,"number":1001,"subject":"Laptop won't boot","status":"In Progress","priority":"1 High","customer_id":456}}
   */
  async updateTicket(ticketId, subject, status, priority, problemType) {
    const body = clean({
      subject,
      status,
      priority: this.#resolvePriority(priority),
      problem_type: problemType,
    })

    return await this.#apiRequest({
      logTag: '[updateTicket]',
      path: `/tickets/${ ticketId }`,
      method: 'put',
      body,
    })
  }

  /**
   * @operationName Delete Ticket
   * @category Tickets
   * @description Permanently deletes a ticket by its ID. This action cannot be undone.
   * @route DELETE /tickets/{id}
   *
   * @paramDef {"type":"Number","label":"Ticket ID","name":"ticketId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The unique ID of the ticket to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteTicket(ticketId) {
    return await this.#apiRequest({
      logTag: '[deleteTicket]',
      path: `/tickets/${ ticketId }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Create Ticket Comment
   * @category Tickets
   * @description Adds a comment to an existing ticket. Set 'Hidden' to make the comment private (visible only to technicians) and 'Do Not Email' to suppress the customer notification email. Returns the created comment.
   * @route POST /tickets/{id}/comment
   *
   * @paramDef {"type":"Number","label":"Ticket ID","name":"ticketId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The ID of the ticket to comment on."}
   * @paramDef {"type":"String","label":"Body","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text content of the comment."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"Optional subject line for the comment."}
   * @paramDef {"type":"Boolean","label":"Hidden","name":"hidden","uiComponent":{"type":"CHECKBOX"},"description":"When true, the comment is private and hidden from the customer. Defaults to false."}
   * @paramDef {"type":"Boolean","label":"Do Not Email","name":"doNotEmail","uiComponent":{"type":"CHECKBOX"},"description":"When true, suppresses the notification email to the customer. Defaults to false."}
   *
   * @returns {Object}
   * @sampleResult {"comment":{"id":789,"ticket_id":123,"subject":"Update","body":"Replaced the RAM.","hidden":false,"created_at":"2025-01-11T09:00:00Z"}}
   */
  async createTicketComment(ticketId, body, subject, hidden, doNotEmail) {
    const payload = clean({
      subject,
      body,
      hidden: hidden === undefined ? undefined : !!hidden,
      do_not_email: doNotEmail === undefined ? undefined : !!doNotEmail,
    })

    return await this.#apiRequest({
      logTag: '[createTicketComment]',
      path: `/tickets/${ ticketId }/comment`,
      method: 'post',
      body: payload,
    })
  }

  // ─── Customers ─────────────────────────────────────────────────────────

  /**
   * @operationName List Customers
   * @category Customers
   * @description Retrieves a paginated list of customers (25 per page). Filter by search text across name, email, and phone. Returns each customer with contact details and a meta object with pagination information.
   * @route GET /customers
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (25 customers per page). Defaults to 1."}
   * @paramDef {"type":"String","label":"Search Query","name":"query","description":"Free-text search across customer name, email, and phone."}
   *
   * @returns {Object}
   * @sampleResult {"customers":[{"id":456,"business_name":"Acme Inc","firstname":"Jane","lastname":"Doe","email":"jane@acme.com","phone":"555-0100"}],"meta":{"total_pages":2,"total_entries":40,"per_page":25,"page":1}}
   */
  async listCustomers(page, query) {
    return await this.#apiRequest({
      logTag: '[listCustomers]',
      path: '/customers',
      method: 'get',
      query: { page, query },
    })
  }

  /**
   * @operationName Get Customer
   * @category Customers
   * @description Retrieves a single customer by ID, including business name, contact name, email, phone, address, and associated contacts.
   * @route GET /customers/{id}
   *
   * @paramDef {"type":"Number","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The unique ID of the customer to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"customer":{"id":456,"business_name":"Acme Inc","firstname":"Jane","lastname":"Doe","email":"jane@acme.com","phone":"555-0100","address":"1 Main St","city":"Springfield"}}
   */
  async getCustomer(customerId) {
    return await this.#apiRequest({
      logTag: '[getCustomer]',
      path: `/customers/${ customerId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Customer
   * @category Customers
   * @description Creates a new customer. Provide a business name and/or first and last name, plus optional contact details. Returns the created customer with its ID.
   * @route POST /customers
   *
   * @paramDef {"type":"String","label":"Business Name","name":"businessName","description":"Company/business name. Provide this and/or first + last name."}
   * @paramDef {"type":"String","label":"First Name","name":"firstname","description":"Contact first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastname","description":"Contact last name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Primary email address for the customer."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Primary phone number for the customer."}
   * @paramDef {"type":"String","label":"Address","name":"address","description":"Street address line for the customer."}
   *
   * @returns {Object}
   * @sampleResult {"customer":{"id":456,"business_name":"Acme Inc","firstname":"Jane","lastname":"Doe","email":"jane@acme.com","phone":"555-0100"}}
   */
  async createCustomer(businessName, firstname, lastname, email, phone, address) {
    const body = clean({
      business_name: businessName,
      firstname,
      lastname,
      email,
      phone,
      address,
    })

    return await this.#apiRequest({
      logTag: '[createCustomer]',
      path: '/customers',
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Update Customer
   * @category Customers
   * @description Updates an existing customer's details. Provide the customer ID and only the fields to change; omitted fields are left unchanged. Returns the updated customer.
   * @route PUT /customers/{id}
   *
   * @paramDef {"type":"Number","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The unique ID of the customer to update."}
   * @paramDef {"type":"String","label":"Business Name","name":"businessName","description":"New business/company name."}
   * @paramDef {"type":"String","label":"First Name","name":"firstname","description":"New contact first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastname","description":"New contact last name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New primary email address."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"New primary phone number."}
   * @paramDef {"type":"String","label":"Address","name":"address","description":"New street address line."}
   *
   * @returns {Object}
   * @sampleResult {"customer":{"id":456,"business_name":"Acme Corp","firstname":"Jane","lastname":"Doe","email":"jane@acme.com","phone":"555-0199"}}
   */
  async updateCustomer(customerId, businessName, firstname, lastname, email, phone, address) {
    const body = clean({
      business_name: businessName,
      firstname,
      lastname,
      email,
      phone,
      address,
    })

    return await this.#apiRequest({
      logTag: '[updateCustomer]',
      path: `/customers/${ customerId }`,
      method: 'put',
      body,
    })
  }

  /**
   * @operationName Delete Customer
   * @category Customers
   * @description Permanently deletes a customer by ID. This action cannot be undone and may fail if the customer has associated records.
   * @route DELETE /customers/{id}
   *
   * @paramDef {"type":"Number","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The unique ID of the customer to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteCustomer(customerId) {
    return await this.#apiRequest({
      logTag: '[deleteCustomer]',
      path: `/customers/${ customerId }`,
      method: 'delete',
    })
  }

  // ─── Contacts ──────────────────────────────────────────────────────────

  /**
   * @operationName List Contacts
   * @category Contacts
   * @description Retrieves a paginated list of contacts, optionally scoped to a single customer. Returns each contact with name, email, phone, and the customer they belong to, plus a meta object with pagination details.
   * @route GET /contacts
   *
   * @paramDef {"type":"Number","label":"Customer ID","name":"customerId","dictionary":"getCustomersDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Restrict results to contacts belonging to this customer."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (25 contacts per page). Defaults to 1."}
   *
   * @returns {Object}
   * @sampleResult {"contacts":[{"id":321,"customer_id":456,"name":"Bob Smith","email":"bob@acme.com","phone":"555-0111"}],"meta":{"total_pages":1,"total_entries":3,"per_page":25,"page":1}}
   */
  async listContacts(customerId, page) {
    return await this.#apiRequest({
      logTag: '[listContacts]',
      path: '/contacts',
      method: 'get',
      query: { customer_id: customerId, page },
    })
  }

  /**
   * @operationName Get Contact
   * @category Contacts
   * @description Retrieves a single contact by ID, including name, email, phone, notes, and the customer they belong to.
   * @route GET /contacts/{id}
   *
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The unique ID of the contact to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"contact":{"id":321,"customer_id":456,"name":"Bob Smith","email":"bob@acme.com","phone":"555-0111"}}
   */
  async getContact(contactId) {
    return await this.#apiRequest({
      logTag: '[getContact]',
      path: `/contacts/${ contactId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Contact
   * @category Contacts
   * @description Creates a new contact under a customer. Requires the customer ID. Provide the contact's name and optional email, phone, and notes. Returns the created contact.
   * @route POST /contacts
   *
   * @paramDef {"type":"Number","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the customer this contact belongs to."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Full name of the contact."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Email address of the contact."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Phone number of the contact."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional notes about the contact."}
   *
   * @returns {Object}
   * @sampleResult {"contact":{"id":321,"customer_id":456,"name":"Bob Smith","email":"bob@acme.com","phone":"555-0111"}}
   */
  async createContact(customerId, name, email, phone, notes) {
    const body = clean({
      customer_id: customerId,
      name,
      email,
      phone,
      notes,
    })

    return await this.#apiRequest({
      logTag: '[createContact]',
      path: '/contacts',
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Update Contact
   * @category Contacts
   * @description Updates an existing contact. Provide the contact ID and only the fields to change; omitted fields are left unchanged. Returns the updated contact.
   * @route PUT /contacts/{id}
   *
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The unique ID of the contact to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New full name of the contact."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New email address of the contact."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"New phone number of the contact."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New notes about the contact."}
   *
   * @returns {Object}
   * @sampleResult {"contact":{"id":321,"customer_id":456,"name":"Bob Smith","email":"bob@acme.com","phone":"555-0199"}}
   */
  async updateContact(contactId, name, email, phone, notes) {
    const body = clean({
      name,
      email,
      phone,
      notes,
    })

    return await this.#apiRequest({
      logTag: '[updateContact]',
      path: `/contacts/${ contactId }`,
      method: 'put',
      body,
    })
  }

  // ─── Assets ────────────────────────────────────────────────────────────

  /**
   * @operationName List Assets
   * @category Assets
   * @description Retrieves a paginated list of customer assets (devices, equipment). Filter by customer or search text. Returns each asset with name, type, serial, and the customer it belongs to, plus a meta object with pagination details.
   * @route GET /customer_assets
   *
   * @paramDef {"type":"Number","label":"Customer ID","name":"customerId","dictionary":"getCustomersDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Restrict results to assets belonging to this customer."}
   * @paramDef {"type":"String","label":"Search Query","name":"query","description":"Free-text search across asset name and details."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (25 assets per page). Defaults to 1."}
   *
   * @returns {Object}
   * @sampleResult {"assets":[{"id":654,"name":"WS-01","asset_type_name":"Workstation","customer_id":456,"asset_serial":"SN123"}],"meta":{"total_pages":1,"total_entries":5,"per_page":25,"page":1}}
   */
  async listAssets(customerId, query, page) {
    return await this.#apiRequest({
      logTag: '[listAssets]',
      path: '/customer_assets',
      method: 'get',
      query: { customer_id: customerId, query, page },
    })
  }

  /**
   * @operationName Get Asset
   * @category Assets
   * @description Retrieves a single customer asset by ID, including its name, type, serial number, properties, RMM data, and the customer it belongs to.
   * @route GET /customer_assets/{id}
   *
   * @paramDef {"type":"Number","label":"Asset ID","name":"assetId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The unique ID of the asset to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"asset":{"id":654,"name":"WS-01","asset_type_name":"Workstation","customer_id":456,"asset_serial":"SN123","properties":{}}}
   */
  async getAsset(assetId) {
    return await this.#apiRequest({
      logTag: '[getAsset]',
      path: `/customer_assets/${ assetId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Asset
   * @category Assets
   * @description Creates a new customer asset. Requires a name and the customer ID. Provide an asset type (label as configured in Syncro) to categorize the asset. Returns the created asset.
   * @route POST /customer_assets
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Display name of the asset (e.g. 'WS-01', 'Reception PC')."}
   * @paramDef {"type":"Number","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the customer this asset belongs to."}
   * @paramDef {"type":"String","label":"Asset Type","name":"assetType","description":"Asset type label as configured in Syncro (e.g. 'Workstation', 'Server', 'Printer')."}
   *
   * @returns {Object}
   * @sampleResult {"asset":{"id":654,"name":"WS-01","asset_type_name":"Workstation","customer_id":456}}
   */
  async createAsset(name, customerId, assetType) {
    const body = clean({
      name,
      customer_id: customerId,
      asset_type: assetType,
    })

    return await this.#apiRequest({
      logTag: '[createAsset]',
      path: '/customer_assets',
      method: 'post',
      body,
    })
  }

  // ─── Invoices ──────────────────────────────────────────────────────────

  /**
   * @operationName List Invoices
   * @category Invoices
   * @description Retrieves a paginated list of invoices, optionally scoped to a single customer. Returns each invoice with number, total, balance due, status, and the customer, plus a meta object with pagination details.
   * @route GET /invoices
   *
   * @paramDef {"type":"Number","label":"Customer ID","name":"customerId","dictionary":"getCustomersDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Restrict results to invoices belonging to this customer."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (25 invoices per page). Defaults to 1."}
   *
   * @returns {Object}
   * @sampleResult {"invoices":[{"id":987,"number":"INV-1001","customer_id":456,"total":250.0,"balance_due":250.0,"paid":false}],"meta":{"total_pages":1,"total_entries":2,"per_page":25,"page":1}}
   */
  async listInvoices(customerId, page) {
    return await this.#apiRequest({
      logTag: '[listInvoices]',
      path: '/invoices',
      method: 'get',
      query: { customer_id: customerId, page },
    })
  }

  /**
   * @operationName Get Invoice
   * @category Invoices
   * @description Retrieves a single invoice by ID, including its number, line items, totals, balance due, payment status, and the customer it belongs to.
   * @route GET /invoices/{id}
   *
   * @paramDef {"type":"Number","label":"Invoice ID","name":"invoiceId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The unique ID of the invoice to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"invoice":{"id":987,"number":"INV-1001","customer_id":456,"total":250.0,"balance_due":250.0,"line_items":[{"name":"Labor","quantity":1,"price":250.0}]}}
   */
  async getInvoice(invoiceId) {
    return await this.#apiRequest({
      logTag: '[getInvoice]',
      path: `/invoices/${ invoiceId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Invoice
   * @category Invoices
   * @description Creates a new invoice for a customer. Requires the customer ID and an array of line items. Each line item is an object with fields such as name, quantity, and price. Returns the created invoice.
   * @route POST /invoices
   *
   * @paramDef {"type":"Number","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the customer this invoice belongs to."}
   * @paramDef {"type":"Array<Object>","label":"Line Items","name":"lineItems","required":true,"description":"Array of line item objects, each with fields like name, quantity, price, and optional product_id (e.g. [{\"name\":\"Labor\",\"quantity\":1,\"price\":250}])."}
   *
   * @returns {Object}
   * @sampleResult {"invoice":{"id":987,"number":"INV-1001","customer_id":456,"total":250.0,"line_items":[{"name":"Labor","quantity":1,"price":250.0}]}}
   */
  async createInvoice(customerId, lineItems) {
    const body = clean({
      customer_id: customerId,
      line_items: lineItems,
    })

    return await this.#apiRequest({
      logTag: '[createInvoice]',
      path: '/invoices',
      method: 'post',
      body,
    })
  }

  // ─── RMM Alerts ────────────────────────────────────────────────────────

  /**
   * @operationName List RMM Alerts
   * @category RMM Alerts
   * @description Retrieves a paginated list of RMM (remote monitoring) alerts. Filter by resolved status to see only open or only resolved alerts. Returns each alert with its description, severity, asset, and status, plus a meta object with pagination details.
   * @route GET /rmm_alerts
   *
   * @paramDef {"type":"Boolean","label":"Resolved","name":"resolved","uiComponent":{"type":"CHECKBOX"},"description":"Filter by resolved state. True returns only resolved alerts; false returns only open alerts. Omit to return all."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (25 alerts per page). Defaults to 1."}
   *
   * @returns {Object}
   * @sampleResult {"rmm_alerts":[{"id":555,"description":"Disk space low","severity":"warning","resolved":false,"asset_id":654,"created_at":"2025-01-12T08:00:00Z"}],"meta":{"total_pages":1,"total_entries":1,"per_page":25,"page":1}}
   */
  async listRmmAlerts(resolved, page) {
    return await this.#apiRequest({
      logTag: '[listRmmAlerts]',
      path: '/rmm_alerts',
      method: 'get',
      query: { resolved: resolved === undefined ? undefined : !!resolved, page },
    })
  }

  /**
   * @operationName Update RMM Alert
   * @category RMM Alerts
   * @description Updates an RMM alert to resolve or mute it. Set 'Resolved' to mark the alert as handled, and/or 'Muted' to silence further notifications. Returns the updated alert.
   * @route PUT /rmm_alerts/{id}
   *
   * @paramDef {"type":"Number","label":"Alert ID","name":"alertId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The unique ID of the RMM alert to update."}
   * @paramDef {"type":"Boolean","label":"Resolved","name":"resolved","uiComponent":{"type":"CHECKBOX"},"description":"Set true to mark the alert as resolved."}
   * @paramDef {"type":"Boolean","label":"Muted","name":"muted","uiComponent":{"type":"CHECKBOX"},"description":"Set true to mute the alert and suppress further notifications."}
   *
   * @returns {Object}
   * @sampleResult {"rmm_alert":{"id":555,"description":"Disk space low","resolved":true,"muted":false}}
   */
  async updateRmmAlert(alertId, resolved, muted) {
    const body = clean({
      resolved: resolved === undefined ? undefined : !!resolved,
      muted: muted === undefined ? undefined : !!muted,
    })

    return await this.#apiRequest({
      logTag: '[updateRmmAlert]',
      path: `/rmm_alerts/${ alertId }`,
      method: 'put',
      body,
    })
  }

  // ─── Products ──────────────────────────────────────────────────────────

  /**
   * @operationName List Products
   * @category Products
   * @description Retrieves a paginated list of products and services from your catalog. Filter by search text. Returns each product with name, price, SKU, and description, plus a meta object with pagination details.
   * @route GET /products
   *
   * @paramDef {"type":"String","label":"Search Query","name":"query","description":"Free-text search across product name and description."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (25 products per page). Defaults to 1."}
   *
   * @returns {Object}
   * @sampleResult {"products":[{"id":42,"name":"Labor - Hourly","price_cost":50.0,"price_retail":125.0,"description":"Standard labor rate"}],"meta":{"total_pages":1,"total_entries":10,"per_page":25,"page":1}}
   */
  async listProducts(query, page) {
    return await this.#apiRequest({
      logTag: '[listProducts]',
      path: '/products',
      method: 'get',
      query: { query, page },
    })
  }

  // ─── Dictionaries ──────────────────────────────────────────────────────

  /**
   * @typedef {Object} getCustomersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter customers by business name, contact name, or email."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) returned from a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Customers Dictionary
   * @description Provides a searchable, paginated list of customers for selecting a Customer ID in other operations. The option value is the numeric customer ID; the label is the business name or full contact name.
   * @route POST /get-customers-dictionary
   *
   * @paramDef {"type":"getCustomersDictionary__payload","label":"Payload","name":"payload","description":"Contains an optional search string and pagination cursor for filtering customers."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Acme Inc","value":456,"note":"jane@acme.com"}],"cursor":"2"}
   */
  async getCustomersDictionary(payload) {
    const { search, cursor } = payload || {}
    const page = cursor ? parseInt(cursor, 10) : 1

    try {
      const response = await this.#apiRequest({
        logTag: '[getCustomersDictionary]',
        path: '/customers',
        method: 'get',
        query: { page, query: search },
      })

      const customers = response.customers || []

      const items = customers.map(customer => {
        const fullName = [customer.firstname, customer.lastname].filter(Boolean).join(' ').trim()
        const label = customer.business_name || fullName || `Customer ${ customer.id }`
        const note = customer.email || fullName || undefined

        return { label, value: customer.id, note }
      })

      const meta = response.meta || {}
      const totalPages = meta.total_pages || 1
      const nextCursor = page < totalPages ? String(page + 1) : null

      return { items, cursor: nextCursor }
    } catch (error) {
      logger.error(`[getCustomersDictionary] Error: ${ error.message }`)

      return { items: [] }
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  #resolvePriority(value) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    const mapping = {
      Urgent: '0 Urgent',
      High: '1 High',
      Normal: '2 Normal',
      Low: '3 Low',
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }
}

Flowrunner.ServerCode.addService(SyncroMSPService, [
  {
    name: 'subdomain',
    displayName: 'Subdomain',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: "Your Syncro subdomain — e.g. 'acme' for acme.syncromsp.com",
  },
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Syncro → Admin → API Tokens → New Token with the needed permissions',
  },
])
