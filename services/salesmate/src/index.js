const logger = {
  info: (...args) => console.log('[Salesmate] info:', ...args),
  debug: (...args) => console.log('[Salesmate] debug:', ...args),
  error: (...args) => console.log('[Salesmate] error:', ...args),
  warn: (...args) => console.log('[Salesmate] warn:', ...args),
}

const API_VERSION_PATH = 'apis/core/v4'

const DEFAULT_PAGE_SIZE = 25

function clean(obj) {
  if (!obj || typeof obj !== 'object') {
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
 * @integrationName Salesmate
 * @integrationIcon /icon.svg
 */
class SalesmateService {
  constructor(config) {
    this.linkname = config.linkname
    this.accessToken = config.accessToken
  }

  #baseUrl() {
    // Salesmate is workspace-scoped: the API lives on the customer's own subdomain.
    // linkname is the subdomain (e.g. "acme" for acme.salesmate.io) or the full host.
    const host = this.linkname && this.linkname.includes('.') ? this.linkname : `${ this.linkname }.salesmate.io`

    return `https://${ host }/${ API_VERSION_PATH }`
  }

  // x-linkname must be the full workspace host (e.g. acme.salesmate.io).
  #linkHeader() {
    return this.linkname && this.linkname.includes('.') ? this.linkname : `${ this.linkname }.salesmate.io`
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const url = `${ this.#baseUrl() }/${ path.replace(/^\//, '') }`

    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          accessToken: this.accessToken,
          'x-linkname': this.#linkHeader(),
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      const response = body !== undefined ? await request.send(body) : await request

      // Salesmate wraps successful payloads as { Data, status }.
      return response && Object.prototype.hasOwnProperty.call(response, 'Data') ? response.Data : response
    } catch (error) {
      const message = error.body?.Error?.message ||
        error.body?.Error ||
        error.body?.message ||
        (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))
      const status = error.status || error.statusCode

      logger.error(`${ logTag } - failed (${ status || 'no status' }): ${ message }`)

      throw new Error(`Salesmate API error: ${ message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Builds the paging/list body used by Salesmate's POST list/search endpoints.
  #buildListBody({ query, fields, sortBy, sortOrder, pageNo, rows, defaultFields }) {
    const body = {
      query,
      fields: fields && fields.length ? fields : defaultFields,
      sortBy: sortBy || undefined,
      sortOrder: this.#resolveChoice(sortOrder, { Ascending: 'asc', Descending: 'desc' }),
      pageNo: pageNo || 1,
      rows: rows || DEFAULT_PAGE_SIZE,
    }

    return clean(body)
  }

  // ---------------------------------------------------------------------------
  // Contacts
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Contact
   * @category Contacts
   * @description Creates a new contact in Salesmate. Provide at least a name or email. Owner and other users are referenced by numeric user id (use Get Users to look them up). Returns the created contact record including its generated id.
   * @route POST /create-contact
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Full name of the contact (e.g. \"Jane Doe\")."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Primary email address of the contact."}
   * @paramDef {"type":"String","label":"Mobile","name":"mobile","description":"Mobile phone number of the contact."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Work/landline phone number of the contact."}
   * @paramDef {"type":"String","label":"Designation","name":"designation","description":"Job title or designation of the contact."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"Name of the company the contact is associated with."}
   * @paramDef {"type":"Number","label":"Owner","name":"owner","uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getUsersDictionary","description":"Numeric id of the user who owns this contact. Select from Users."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"additionalFields","description":"Any additional standard or custom Salesmate contact fields as a key/value object, merged into the request."}
   * @returns {Object}
   * @sampleResult {"id":101,"name":"Jane Doe","email":"jane@acme.com","mobile":"+15551234567","owner":5,"createdAt":"2026-01-01T10:00:00Z"}
   */
  async createContact(name, email, mobile, phone, designation, companyName, owner, additionalFields) {
    const body = clean({
      name,
      email,
      mobile,
      phone,
      designation,
      companyName,
      owner,
      ...(additionalFields || {}),
    })

    return await this.#apiRequest({
      logTag: '[createContact]',
      path: '/contacts',
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Get Contact
   * @category Contacts
   * @description Retrieves a single contact by its numeric id, including standard and custom fields. Returns an error if no contact matches the id.
   * @route GET /get-contact
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric id of the contact to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":101,"name":"Jane Doe","email":"jane@acme.com","mobile":"+15551234567","owner":5,"createdAt":"2026-01-01T10:00:00Z"}
   */
  async getContact(contactId) {
    return await this.#apiRequest({
      logTag: '[getContact]',
      path: `/contacts/${ contactId }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Contacts
   * @category Contacts
   * @description Lists and searches contacts using Salesmate's paged query endpoint. Pass an optional free-text query, choose which fields to return, sort, and page through results. Returns the matching contacts and total row count.
   * @route POST /list-contacts
   * @paramDef {"type":"String","label":"Query","name":"query","description":"Optional free-text search across contact fields (name, email, company, etc.)."}
   * @paramDef {"type":"Array<String>","label":"Fields","name":"fields","description":"Field names to include in each result (e.g. name, email, owner). Defaults to name, email, mobile, owner."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","description":"Field name to sort by (e.g. name, createdAt)."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","defaultValue":"Descending","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction for the results."}
   * @paramDef {"type":"Number","label":"Page Number","name":"pageNo","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-based page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Rows","name":"rows","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records per page. Defaults to 25."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":101,"name":"Jane Doe","email":"jane@acme.com","owner":5}],"totalRows":1}
   */
  async listContacts(query, fields, sortBy, sortOrder, pageNo, rows) {
    const body = this.#buildListBody({
      query,
      fields,
      sortBy,
      sortOrder,
      pageNo,
      rows,
      defaultFields: ['name', 'email', 'mobile', 'owner'],
    })

    return await this.#apiRequest({
      logTag: '[listContacts]',
      path: '/contacts/search',
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Update Contact
   * @category Contacts
   * @description Updates an existing contact identified by its numeric id. Only the fields you provide are changed. Returns the updated contact record.
   * @route PUT /update-contact
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric id of the contact to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New full name for the contact."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New primary email address."}
   * @paramDef {"type":"String","label":"Mobile","name":"mobile","description":"New mobile phone number."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"New work/landline phone number."}
   * @paramDef {"type":"Number","label":"Owner","name":"owner","uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getUsersDictionary","description":"Numeric id of the user to set as owner. Select from Users."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"additionalFields","description":"Any additional standard or custom contact fields to update as a key/value object."}
   * @returns {Object}
   * @sampleResult {"id":101,"name":"Jane A. Doe","email":"jane@acme.com","owner":6}
   */
  async updateContact(contactId, name, email, mobile, phone, owner, additionalFields) {
    const body = clean({
      name,
      email,
      mobile,
      phone,
      owner,
      ...(additionalFields || {}),
    })

    return await this.#apiRequest({
      logTag: '[updateContact]',
      path: `/contacts/${ contactId }`,
      method: 'put',
      body,
    })
  }

  /**
   * @operationName Delete Contact
   * @category Contacts
   * @description Permanently deletes a contact by its numeric id. This action cannot be undone.
   * @route DELETE /delete-contact
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric id of the contact to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":101}
   */
  async deleteContact(contactId) {
    await this.#apiRequest({
      logTag: '[deleteContact]',
      path: `/contacts/${ contactId }`,
      method: 'delete',
    })

    return { deleted: true, id: contactId }
  }

  // ---------------------------------------------------------------------------
  // Companies
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Company
   * @category Companies
   * @description Creates a new company in Salesmate. Provide at least a name. Owner is referenced by numeric user id. Returns the created company record including its generated id.
   * @route POST /create-company
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Company name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Company email address."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Company phone number."}
   * @paramDef {"type":"String","label":"Website","name":"website","description":"Company website URL."}
   * @paramDef {"type":"Number","label":"Owner","name":"owner","uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getUsersDictionary","description":"Numeric id of the user who owns this company. Select from Users."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"additionalFields","description":"Any additional standard or custom company fields as a key/value object."}
   * @returns {Object}
   * @sampleResult {"id":301,"name":"Acme Inc","website":"https://acme.com","owner":5}
   */
  async createCompany(name, email, phone, website, owner, additionalFields) {
    const body = clean({
      name,
      email,
      phone,
      website,
      owner,
      ...(additionalFields || {}),
    })

    return await this.#apiRequest({
      logTag: '[createCompany]',
      path: '/companies',
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Get Company
   * @category Companies
   * @description Retrieves a single company by its numeric id, including standard and custom fields. Returns an error if no company matches the id.
   * @route GET /get-company
   * @paramDef {"type":"Number","label":"Company ID","name":"companyId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric id of the company to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":301,"name":"Acme Inc","website":"https://acme.com","owner":5}
   */
  async getCompany(companyId) {
    return await this.#apiRequest({
      logTag: '[getCompany]',
      path: `/companies/${ companyId }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Companies
   * @category Companies
   * @description Lists and searches companies using Salesmate's paged query endpoint. Pass an optional free-text query, choose which fields to return, sort, and page through results. Returns the matching companies and total row count.
   * @route POST /list-companies
   * @paramDef {"type":"String","label":"Query","name":"query","description":"Optional free-text search across company fields (name, website, etc.)."}
   * @paramDef {"type":"Array<String>","label":"Fields","name":"fields","description":"Field names to include in each result. Defaults to name, website, owner."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","description":"Field name to sort by (e.g. name, createdAt)."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","defaultValue":"Descending","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction for the results."}
   * @paramDef {"type":"Number","label":"Page Number","name":"pageNo","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-based page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Rows","name":"rows","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records per page. Defaults to 25."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":301,"name":"Acme Inc","website":"https://acme.com","owner":5}],"totalRows":1}
   */
  async listCompanies(query, fields, sortBy, sortOrder, pageNo, rows) {
    const body = this.#buildListBody({
      query,
      fields,
      sortBy,
      sortOrder,
      pageNo,
      rows,
      defaultFields: ['name', 'website', 'owner'],
    })

    return await this.#apiRequest({
      logTag: '[listCompanies]',
      path: '/companies/search',
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Update Company
   * @category Companies
   * @description Updates an existing company identified by its numeric id. Only the fields you provide are changed. Returns the updated company record.
   * @route PUT /update-company
   * @paramDef {"type":"Number","label":"Company ID","name":"companyId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric id of the company to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New company name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New company email address."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"New company phone number."}
   * @paramDef {"type":"String","label":"Website","name":"website","description":"New company website URL."}
   * @paramDef {"type":"Number","label":"Owner","name":"owner","uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getUsersDictionary","description":"Numeric id of the user to set as owner. Select from Users."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"additionalFields","description":"Any additional standard or custom company fields to update as a key/value object."}
   * @returns {Object}
   * @sampleResult {"id":301,"name":"Acme Corporation","website":"https://acme.com","owner":6}
   */
  async updateCompany(companyId, name, email, phone, website, owner, additionalFields) {
    const body = clean({
      name,
      email,
      phone,
      website,
      owner,
      ...(additionalFields || {}),
    })

    return await this.#apiRequest({
      logTag: '[updateCompany]',
      path: `/companies/${ companyId }`,
      method: 'put',
      body,
    })
  }

  /**
   * @operationName Delete Company
   * @category Companies
   * @description Permanently deletes a company by its numeric id. This action cannot be undone.
   * @route DELETE /delete-company
   * @paramDef {"type":"Number","label":"Company ID","name":"companyId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric id of the company to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":301}
   */
  async deleteCompany(companyId) {
    await this.#apiRequest({
      logTag: '[deleteCompany]',
      path: `/companies/${ companyId }`,
      method: 'delete',
    })

    return { deleted: true, id: companyId }
  }

  // ---------------------------------------------------------------------------
  // Deals
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Deal
   * @category Deals
   * @description Creates a new deal in Salesmate. Provide a title and typically a pipeline and stage (use Get Pipelines and Get Stages to look them up). Primary contact/company and owner are referenced by numeric id. Returns the created deal including its generated id.
   * @route POST /create-deal
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Title/name of the deal."}
   * @paramDef {"type":"Number","label":"Pipeline","name":"pipeline","uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getPipelinesDictionary","description":"Numeric id of the pipeline the deal belongs to. Select from Pipelines."}
   * @paramDef {"type":"Number","label":"Stage","name":"stage","uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getStagesDictionary","description":"Numeric id of the deal stage within the pipeline. Select from Stages (depends on Pipeline)."}
   * @paramDef {"type":"Number","label":"Deal Value","name":"dealValue","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Monetary value of the deal."}
   * @paramDef {"type":"Number","label":"Primary Contact","name":"primaryContact","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric id of the primary contact associated with the deal."}
   * @paramDef {"type":"Number","label":"Primary Company","name":"primaryCompany","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric id of the primary company associated with the deal."}
   * @paramDef {"type":"Number","label":"Owner","name":"owner","uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getUsersDictionary","description":"Numeric id of the user who owns this deal. Select from Users."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"additionalFields","description":"Any additional standard or custom deal fields as a key/value object."}
   * @returns {Object}
   * @sampleResult {"id":501,"title":"Website redesign","pipeline":1,"stage":2,"dealValue":12000,"owner":5}
   */
  async createDeal(title, pipeline, stage, dealValue, primaryContact, primaryCompany, owner, additionalFields) {
    const body = clean({
      title,
      pipeline,
      stage,
      dealValue,
      primaryContact,
      primaryCompany,
      owner,
      ...(additionalFields || {}),
    })

    return await this.#apiRequest({
      logTag: '[createDeal]',
      path: '/deals',
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Get Deal
   * @category Deals
   * @description Retrieves a single deal by its numeric id, including standard and custom fields. Returns an error if no deal matches the id.
   * @route GET /get-deal
   * @paramDef {"type":"Number","label":"Deal ID","name":"dealId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric id of the deal to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":501,"title":"Website redesign","pipeline":1,"stage":2,"dealValue":12000,"owner":5}
   */
  async getDeal(dealId) {
    return await this.#apiRequest({
      logTag: '[getDeal]',
      path: `/deals/${ dealId }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Deals
   * @category Deals
   * @description Lists and searches deals using Salesmate's paged query endpoint. Pass an optional free-text query, choose which fields to return, sort, and page through results. Returns the matching deals and total row count.
   * @route POST /list-deals
   * @paramDef {"type":"String","label":"Query","name":"query","description":"Optional free-text search across deal fields (title, etc.)."}
   * @paramDef {"type":"Array<String>","label":"Fields","name":"fields","description":"Field names to include in each result. Defaults to title, dealValue, stage, owner."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","description":"Field name to sort by (e.g. title, dealValue, createdAt)."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","defaultValue":"Descending","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction for the results."}
   * @paramDef {"type":"Number","label":"Page Number","name":"pageNo","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-based page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Rows","name":"rows","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records per page. Defaults to 25."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":501,"title":"Website redesign","dealValue":12000,"stage":2,"owner":5}],"totalRows":1}
   */
  async listDeals(query, fields, sortBy, sortOrder, pageNo, rows) {
    const body = this.#buildListBody({
      query,
      fields,
      sortBy,
      sortOrder,
      pageNo,
      rows,
      defaultFields: ['title', 'dealValue', 'stage', 'owner'],
    })

    return await this.#apiRequest({
      logTag: '[listDeals]',
      path: '/deals/search',
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Update Deal
   * @category Deals
   * @description Updates an existing deal identified by its numeric id. Only the fields you provide are changed. Use the write status to mark a deal open, won, or lost. Returns the updated deal record.
   * @route PUT /update-deal
   * @paramDef {"type":"Number","label":"Deal ID","name":"dealId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric id of the deal to update."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New title/name for the deal."}
   * @paramDef {"type":"Number","label":"Stage","name":"stage","uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getStagesDictionary","description":"Numeric id of the deal stage to move the deal to. Select from Stages (depends on Pipeline)."}
   * @paramDef {"type":"Number","label":"Deal Value","name":"dealValue","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New monetary value of the deal."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Won","Lost"]}},"description":"Write status of the deal."}
   * @paramDef {"type":"Number","label":"Owner","name":"owner","uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getUsersDictionary","description":"Numeric id of the user to set as owner. Select from Users."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"additionalFields","description":"Any additional standard or custom deal fields to update as a key/value object."}
   * @returns {Object}
   * @sampleResult {"id":501,"title":"Website redesign","stage":3,"dealValue":15000,"status":"open"}
   */
  async updateDeal(dealId, title, stage, dealValue, status, owner, additionalFields) {
    const body = clean({
      title,
      stage,
      dealValue,
      status: this.#resolveChoice(status, { Open: 'open', Won: 'won', Lost: 'lost' }),
      owner,
      ...(additionalFields || {}),
    })

    return await this.#apiRequest({
      logTag: '[updateDeal]',
      path: `/deals/${ dealId }`,
      method: 'put',
      body,
    })
  }

  /**
   * @operationName Delete Deal
   * @category Deals
   * @description Permanently deletes a deal by its numeric id. This action cannot be undone.
   * @route DELETE /delete-deal
   * @paramDef {"type":"Number","label":"Deal ID","name":"dealId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric id of the deal to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":501}
   */
  async deleteDeal(dealId) {
    await this.#apiRequest({
      logTag: '[deleteDeal]',
      path: `/deals/${ dealId }`,
      method: 'delete',
    })

    return { deleted: true, id: dealId }
  }

  // ---------------------------------------------------------------------------
  // Activities
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Activity
   * @category Activities
   * @description Creates a new activity (task, call, meeting, or email) in Salesmate. Provide a title and type; optionally a due date and owner. Returns the created activity including its generated id.
   * @route POST /create-activity
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Title/subject of the activity."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"defaultValue":"Task","uiComponent":{"type":"DROPDOWN","options":{"values":["Call","Meeting","Task","Email"]}},"description":"Type of activity."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"When the activity is due (ISO 8601 timestamp, e.g. 2026-02-01T15:00:00Z)."}
   * @paramDef {"type":"Number","label":"Owner","name":"owner","uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getUsersDictionary","description":"Numeric id of the user who owns this activity. Select from Users."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"additionalFields","description":"Any additional standard or custom activity fields as a key/value object."}
   * @returns {Object}
   * @sampleResult {"id":701,"title":"Discovery call","type":"Call","dueDate":"2026-02-01T15:00:00Z","owner":5}
   */
  async createActivity(title, type, dueDate, owner, additionalFields) {
    const body = clean({
      title,
      type: this.#resolveChoice(type, { Call: 'Call', Meeting: 'Meeting', Task: 'Task', Email: 'Email' }),
      dueDate,
      owner,
      ...(additionalFields || {}),
    })

    return await this.#apiRequest({
      logTag: '[createActivity]',
      path: '/activities',
      method: 'post',
      body,
    })
  }

  /**
   * @operationName List Activities
   * @category Activities
   * @description Lists and searches activities using Salesmate's paged query endpoint. Pass an optional free-text query, choose which fields to return, sort, and page through results. Returns the matching activities and total row count.
   * @route POST /list-activities
   * @paramDef {"type":"String","label":"Query","name":"query","description":"Optional free-text search across activity fields (title, etc.)."}
   * @paramDef {"type":"Array<String>","label":"Fields","name":"fields","description":"Field names to include in each result. Defaults to title, type, dueDate, owner."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","description":"Field name to sort by (e.g. dueDate, createdAt)."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","defaultValue":"Descending","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction for the results."}
   * @paramDef {"type":"Number","label":"Page Number","name":"pageNo","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-based page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Rows","name":"rows","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records per page. Defaults to 25."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":701,"title":"Discovery call","type":"Call","dueDate":"2026-02-01T15:00:00Z","owner":5}],"totalRows":1}
   */
  async listActivities(query, fields, sortBy, sortOrder, pageNo, rows) {
    const body = this.#buildListBody({
      query,
      fields,
      sortBy,
      sortOrder,
      pageNo,
      rows,
      defaultFields: ['title', 'type', 'dueDate', 'owner'],
    })

    return await this.#apiRequest({
      logTag: '[listActivities]',
      path: '/activities/search',
      method: 'post',
      body,
    })
  }

  // ---------------------------------------------------------------------------
  // Dictionaries
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} getUsersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter users by name or email."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Salesmate returns active users in one page, so this is unused but kept for compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Users Dictionary
   * @description Lists active Salesmate users for selecting an owner or assignee. The option value is the numeric user id expected by owner parameters.
   * @route POST /get-users-dictionary
   * @paramDef {"type":"getUsersDictionary__payload","label":"Payload","name":"payload","description":"Search text used to filter the list of active users."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Sam Rep (sam@acme.com)","value":"5","note":"Sales Rep"}],"cursor":null}
   */
  async getUsersDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getUsersDictionary]',
      path: '/users/active',
      method: 'get',
    })

    const users = Array.isArray(response) ? response : response?.data || []
    const term = (search || '').toLowerCase()

    const items = users
      .filter(user => {
        if (!term) {
          return true
        }

        return `${ user.name || '' } ${ user.email || '' }`.toLowerCase().includes(term)
      })
      .map(user => ({
        label: user.email ? `${ user.name } (${ user.email })` : String(user.name || user.id),
        value: String(user.id),
        note: user.role || user.designation || undefined,
      }))

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} getPipelinesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter pipelines by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Salesmate returns pipelines in one page, so this is unused but kept for compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Pipelines Dictionary
   * @description Lists deal pipelines for selecting a pipeline on a deal. The option value is the numeric pipeline id used by deal and stage parameters.
   * @route POST /get-pipelines-dictionary
   * @paramDef {"type":"getPipelinesDictionary__payload","label":"Payload","name":"payload","description":"Search text used to filter the list of pipelines."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Sales Pipeline","value":"1","note":null}],"cursor":null}
   */
  async getPipelinesDictionary(payload) {
    const { search } = payload || {}
    const pipelines = await this.#fetchPipelines()
    const term = (search || '').toLowerCase()

    const items = pipelines
      .filter(pipeline => (term ? String(pipeline.name || '').toLowerCase().includes(term) : true))
      .map(pipeline => ({
        label: String(pipeline.name || pipeline.id),
        value: String(pipeline.id),
        note: undefined,
      }))

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} getStagesDictionary__payloadCriteria
   * @paramDef {"type":"Number","label":"Pipeline","name":"pipeline","description":"The pipeline id whose stages populate the list."}
   */

  /**
   * @typedef {Object} getStagesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter stages by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Salesmate returns stages in one page, so this is unused but kept for compatibility."}
   * @paramDef {"type":"getStagesDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The pipeline whose stages to list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Stages Dictionary
   * @description Lists the deal stages for a selected pipeline. Depends on the Pipeline parameter. The option value is the numeric stage id used by a deal's stage parameter.
   * @route POST /get-stages-dictionary
   * @paramDef {"type":"getStagesDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the pipeline criteria whose stages to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Qualification","value":"2","note":"Pipeline 1"}],"cursor":null}
   */
  async getStagesDictionary(payload) {
    const { search, criteria } = payload || {}
    const pipelineId = criteria?.pipeline

    if (pipelineId === undefined || pipelineId === null || pipelineId === '') {
      return { items: [], cursor: null }
    }

    const pipelines = await this.#fetchPipelines()
    const pipeline = pipelines.find(item => String(item.id) === String(pipelineId))
    const stages = pipeline?.stages || pipeline?.dealStages || []
    const term = (search || '').toLowerCase()

    const items = stages
      .filter(stage => (term ? String(stage.name || '').toLowerCase().includes(term) : true))
      .map(stage => ({
        label: String(stage.name || stage.id),
        value: String(stage.id),
        note: `Pipeline ${ pipelineId }`,
      }))

    return { items, cursor: null }
  }

  // Shared fetch for pipelines (used by both pipeline and stage dictionaries).
  async #fetchPipelines() {
    const response = await this.#apiRequest({
      logTag: '[fetchPipelines]',
      path: '/pipelines',
      method: 'get',
    })

    return Array.isArray(response) ? response : response?.data || []
  }
}

Flowrunner.ServerCode.addService(SalesmateService, [
  {
    name: 'linkname',
    displayName: 'Workspace Name',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Salesmate workspace name — the subdomain from {linkname}.salesmate.io (e.g. "acme"). You may also paste the full host like acme.salesmate.io.',
  },
  {
    name: 'accessToken',
    displayName: 'Access Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Salesmate → Setup → Access Tokens (or API Tokens) → generate. Sent as the accessToken header.',
  },
])
