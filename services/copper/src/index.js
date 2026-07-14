// ============================================================================
//  SPEC: Copper (CRM)   auth: API key (X-PW-AccessToken)
//  RESOURCES:
//    - People (contacts)   ops: create, get, search, update, delete
//    - Companies           ops: create, get, search, update, delete
//    - Leads               ops: create, get, search, update, delete, convert
//    - Opportunities       ops: create, get, search, update, delete
//    - Tasks               ops: create, list, update, delete
//    - Activities          ops: create, list
//  DICTIONARIES: getUsersDictionary, getPipelinesDictionary,
//                getPipelineStagesDictionary (dependsOn pipeline),
//                getCustomerSourcesDictionary, getLossReasonsDictionary
//  TRIGGERS: SKIPPED (webhook notification callback payload could not be
//            verified within the research budget — see README). Class carries
//            no trigger annotation; CRUD-only ship.
//  Docs: https://developer.copper.com/  (Developer API v1)
// ============================================================================

const logger = {
  info: (...args) => console.log('[Copper] info:', ...args),
  debug: (...args) => console.log('[Copper] debug:', ...args),
  error: (...args) => console.log('[Copper] error:', ...args),
  warn: (...args) => console.log('[Copper] warn:', ...args),
}

const API_BASE_URL = 'https://api.copper.com/developer/v1'

// ============================================================================
//  DICTIONARY PAYLOAD TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} getUsersDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter users by name or email."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination page number for the next page of results."}
 */

/**
 * @typedef {Object} getPipelinesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter pipelines by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getPipelineStagesDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Pipeline","name":"pipelineId","description":"The pipeline whose stages populate the list."}
 */

/**
 * @typedef {Object} getPipelineStagesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter stages by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 * @paramDef {"type":"getPipelineStagesDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The pipeline whose stages to list."}
 */

/**
 * @typedef {Object} getCustomerSourcesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter customer sources by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getLossReasonsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter loss reasons by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @integrationName Copper
 * @integrationIcon /icon.png
 */
class Copper {
  constructor(config) {
    this.config = config || {}
    this.apiKey = this.config.apiKey
    this.email = this.config.email
  }

  // ==========================================================================
  //  CORE — every external call goes through #apiRequest
  // ==========================================================================
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set(this.#headers())
        .query(query || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      this.#handleError(error, logTag)
    }
  }

  #headers() {
    return {
      'X-PW-AccessToken': this.apiKey,
      'X-PW-Application': 'developer_api',
      'X-PW-UserEmail': this.email,
      'Content-Type': 'application/json',
    }
  }

  #handleError(error, logTag) {
    const body = error?.body || {}
    const status = error?.status || error?.statusCode || body.status
    // Copper returns { message, status } and sometimes { errors: [...] } on validation failures.
    const detail = Array.isArray(body.errors) && body.errors.length ? body.errors.join('; ') : undefined
    const message = detail || body.message || error?.message || 'Request failed'

    logger.error(`${ logTag } - failed (${ status || 'no status' }): ${ message }`)

    throw new Error(`Copper API error: ${ message }`)
  }

  // Maps a friendly dropdown label to its Copper API value. Unmapped values
  // (and identity dropdowns) pass through unchanged.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Splits an Array param that may also arrive as a comma-separated string.
  #toList(value) {
    if (value === undefined || value === null || value === '') return undefined

    const list = Array.isArray(value)
      ? value
      : String(value).split(',').map(part => part.trim()).filter(Boolean)

    return list.length ? list : undefined
  }

  // Builds Copper's emails array [{ email, category }] from a single email string.
  #buildEmails(email, category) {
    if (!email) return undefined

    return [{ email, category: category || 'work' }]
  }

  // Builds Copper's phone_numbers array [{ number, category }] from a single value.
  #buildPhoneNumbers(phone, category) {
    if (!phone) return undefined

    return [{ number: phone, category: category || 'work' }]
  }

  // Adds a key to the body only when the value is meaningful (not undefined/null/'').
  #assign(target, key, value) {
    if (value !== undefined && value !== null && value !== '') {
      target[key] = value
    }
  }

  // ==========================================================================
  //  PEOPLE (CONTACTS)
  // ==========================================================================
  /**
   * @operationName Create Person
   * @category People
   * @description Creates a new person (contact) in Copper. Provide a name and any contact details — email, phone, company, title, or address. Custom fields can be passed through as an array of {custom_field_definition_id, value} objects. Returns the created person including its Copper ID.
   * @route POST /people
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Full name of the person (e.g. Jane Doe)."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Primary email address for the person."}
   * @paramDef {"type":"String","label":"Email Category","name":"emailCategory","uiComponent":{"type":"DROPDOWN","options":{"values":["Work","Personal","Other"]}},"defaultValue":"Work","description":"Category for the email address."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phone","description":"Primary phone number for the person."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"Name of the company this person works for."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Job title of the person (e.g. VP of Sales)."}
   * @paramDef {"type":"String","label":"Street","name":"street","description":"Street address line."}
   * @paramDef {"type":"String","label":"City","name":"city","description":"City for the address."}
   * @paramDef {"type":"String","label":"State","name":"state","description":"State or region for the address."}
   * @paramDef {"type":"String","label":"Postal Code","name":"postalCode","description":"Postal or ZIP code for the address."}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"Two-letter country code for the address (e.g. US)."}
   * @paramDef {"type":"String","label":"Assignee","name":"assigneeId","dictionary":"getUsersDictionary","description":"The Copper user to assign this person to. Leave blank for unassigned."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags to apply to the person. Accepts a list or a comma-separated string."}
   * @paramDef {"type":"String","label":"Details","name":"details","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Freeform notes/description about the person."}
   * @paramDef {"type":"Array<Object>","label":"Custom Fields","name":"customFields","description":"Custom fields as objects: {\"custom_field_definition_id\":123,\"value\":\"...\"}. Passed through to Copper unchanged."}
   * @returns {Object}
   * @sampleResult {"id":123,"name":"Jane Doe","emails":[{"email":"jane@example.com","category":"work"}],"company_name":"Acme","title":"VP Sales","date_created":1700000000,"date_modified":1700000000}
   */
  async createPerson(name, email, emailCategory, phone, companyName, title, street, city, state, postalCode, country, assigneeId, tags, details, customFields) {
    const body = { name }

    this.#assign(body, 'emails', this.#buildEmails(email, this.#resolveChoice(emailCategory, { Work: 'work', Personal: 'personal', Other: 'other' })))
    this.#assign(body, 'phone_numbers', this.#buildPhoneNumbers(phone))
    this.#assign(body, 'company_name', companyName)
    this.#assign(body, 'title', title)
    this.#assign(body, 'assignee_id', assigneeId)
    this.#assign(body, 'details', details)
    this.#assign(body, 'tags', this.#toList(tags))

    const address = this.#buildAddress(street, city, state, postalCode, country)

    this.#assign(body, 'address', address)
    this.#assign(body, 'custom_fields', this.#toList(customFields))

    return await this.#apiRequest({ url: `${ API_BASE_URL }/people`, method: 'post', body, logTag: 'createPerson' })
  }

  #buildAddress(street, city, state, postalCode, country) {
    const address = {}

    this.#assign(address, 'street', street)
    this.#assign(address, 'city', city)
    this.#assign(address, 'state', state)
    this.#assign(address, 'postal_code', postalCode)
    this.#assign(address, 'country', country)

    return Object.keys(address).length ? address : undefined
  }

  /**
   * @operationName Get Person
   * @category People
   * @description Retrieves a single person (contact) by its Copper ID, including emails, phone numbers, company, tags, and custom fields.
   * @route GET /people/{id}
   * @paramDef {"type":"String","label":"Person ID","name":"id","required":true,"description":"The Copper ID of the person to fetch. Use Search People to find IDs."}
   * @returns {Object}
   * @sampleResult {"id":123,"name":"Jane Doe","emails":[{"email":"jane@example.com","category":"work"}],"company_name":"Acme","title":"VP Sales","tags":["lead"]}
   */
  async getPerson(id) {
    return await this.#apiRequest({ url: `${ API_BASE_URL }/people/${ id }`, logTag: 'getPerson' })
  }

  /**
   * @operationName Search People
   * @category People
   * @description Searches people (contacts) in Copper with paging, sorting, and optional name/email filters. Returns an array of matching people. Copper caps page_size at 200.
   * @route POST /people/search
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Filter by full or partial name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Filter by email address."}
   * @paramDef {"type":"Number","label":"Page Number","name":"pageNumber","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":1,"description":"1-based page of results to return (default 1)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":20,"description":"Results per page, max 200 (default 20)."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Name","Date Created","Date Modified","Company Name"]}},"defaultValue":"Name","description":"Field to sort results by."}
   * @paramDef {"type":"String","label":"Sort Direction","name":"sortDirection","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"defaultValue":"Ascending","description":"Order of the sort."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":123,"name":"Jane Doe","emails":[{"email":"jane@example.com","category":"work"}],"company_name":"Acme"}]
   */
  async searchPeople(name, email, pageNumber, pageSize, sortBy, sortDirection) {
    const body = this.#buildSearchBody({ name, email, pageNumber, pageSize, sortBy, sortDirection })

    return await this.#apiRequest({ url: `${ API_BASE_URL }/people/search`, method: 'post', body, logTag: 'searchPeople' })
  }

  // Shared search-body builder for the *_search endpoints (people, companies, leads, opportunities).
  #buildSearchBody({ name, email, pageNumber, pageSize, sortBy, sortDirection }) {
    const body = {
      page_number: pageNumber || 1,
      page_size: Math.min(pageSize || 20, 200),
    }

    this.#assign(body, 'name', name)

    if (email) {
      body.emails = [email]
    }

    const resolvedSort = this.#resolveChoice(sortBy, {
      'Name': 'name',
      'Date Created': 'date_created',
      'Date Modified': 'date_modified',
      'Company Name': 'company_name',
    })

    this.#assign(body, 'sort_by', resolvedSort)

    const resolvedDirection = this.#resolveChoice(sortDirection, { Ascending: 'asc', Descending: 'desc' })

    this.#assign(body, 'sort_direction', resolvedDirection)

    return body
  }

  /**
   * @operationName Update Person
   * @category People
   * @description Updates an existing person (contact) in Copper. Only the fields you supply are changed; leave a field blank to keep its current value. Custom fields can be passed through as an array. Returns the updated person.
   * @route PUT /people/{id}
   * @paramDef {"type":"String","label":"Person ID","name":"id","required":true,"description":"The Copper ID of the person to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New full name for the person."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New primary email address."}
   * @paramDef {"type":"String","label":"Email Category","name":"emailCategory","uiComponent":{"type":"DROPDOWN","options":{"values":["Work","Personal","Other"]}},"defaultValue":"Work","description":"Category for the email address."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phone","description":"New primary phone number."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"New company name."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New job title."}
   * @paramDef {"type":"String","label":"Assignee","name":"assigneeId","dictionary":"getUsersDictionary","description":"The Copper user to reassign this person to."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Replacement tag list. Accepts a list or a comma-separated string."}
   * @paramDef {"type":"String","label":"Details","name":"details","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New freeform notes/description."}
   * @paramDef {"type":"Array<Object>","label":"Custom Fields","name":"customFields","description":"Custom fields as objects: {\"custom_field_definition_id\":123,\"value\":\"...\"}. Passed through to Copper unchanged."}
   * @returns {Object}
   * @sampleResult {"id":123,"name":"Jane Doe","emails":[{"email":"jane@newmail.com","category":"work"}],"title":"Director","date_modified":1700001000}
   */
  async updatePerson(id, name, email, emailCategory, phone, companyName, title, assigneeId, tags, details, customFields) {
    const body = {}

    this.#assign(body, 'name', name)
    this.#assign(body, 'emails', this.#buildEmails(email, this.#resolveChoice(emailCategory, { Work: 'work', Personal: 'personal', Other: 'other' })))
    this.#assign(body, 'phone_numbers', this.#buildPhoneNumbers(phone))
    this.#assign(body, 'company_name', companyName)
    this.#assign(body, 'title', title)
    this.#assign(body, 'assignee_id', assigneeId)
    this.#assign(body, 'details', details)
    this.#assign(body, 'tags', this.#toList(tags))
    this.#assign(body, 'custom_fields', this.#toList(customFields))

    return await this.#apiRequest({ url: `${ API_BASE_URL }/people/${ id }`, method: 'put', body, logTag: 'updatePerson' })
  }

  /**
   * @operationName Delete Person
   * @category People
   * @description Permanently deletes a person (contact) from Copper by its ID. This cannot be undone.
   * @route DELETE /people/{id}
   * @paramDef {"type":"String","label":"Person ID","name":"id","required":true,"description":"The Copper ID of the person to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":123}
   */
  async deletePerson(id) {
    await this.#apiRequest({ url: `${ API_BASE_URL }/people/${ id }`, method: 'delete', logTag: 'deletePerson' })

    return { deleted: true, id }
  }

  // ==========================================================================
  //  COMPANIES
  // ==========================================================================
  /**
   * @operationName Create Company
   * @category Companies
   * @description Creates a new company in Copper. Provide a name and any details — email domain, phone, website, address, or assignee. Custom fields can be passed through as an array. Returns the created company including its Copper ID.
   * @route POST /companies
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Company name (e.g. Acme Inc)."}
   * @paramDef {"type":"String","label":"Email Domain","name":"emailDomain","description":"Primary email domain for the company (e.g. acme.com)."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phone","description":"Primary phone number for the company."}
   * @paramDef {"type":"String","label":"Street","name":"street","description":"Street address line."}
   * @paramDef {"type":"String","label":"City","name":"city","description":"City for the address."}
   * @paramDef {"type":"String","label":"State","name":"state","description":"State or region for the address."}
   * @paramDef {"type":"String","label":"Postal Code","name":"postalCode","description":"Postal or ZIP code for the address."}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"Two-letter country code for the address (e.g. US)."}
   * @paramDef {"type":"String","label":"Assignee","name":"assigneeId","dictionary":"getUsersDictionary","description":"The Copper user to assign this company to."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags to apply. Accepts a list or a comma-separated string."}
   * @paramDef {"type":"String","label":"Details","name":"details","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Freeform notes/description about the company."}
   * @paramDef {"type":"Array<Object>","label":"Custom Fields","name":"customFields","description":"Custom fields as objects: {\"custom_field_definition_id\":123,\"value\":\"...\"}. Passed through to Copper unchanged."}
   * @returns {Object}
   * @sampleResult {"id":456,"name":"Acme Inc","email_domain":"acme.com","date_created":1700000000,"date_modified":1700000000}
   */
  async createCompany(name, emailDomain, phone, street, city, state, postalCode, country, assigneeId, tags, details, customFields) {
    const body = { name }

    this.#assign(body, 'email_domain', emailDomain)
    this.#assign(body, 'phone_numbers', this.#buildPhoneNumbers(phone))
    this.#assign(body, 'assignee_id', assigneeId)
    this.#assign(body, 'details', details)
    this.#assign(body, 'tags', this.#toList(tags))
    this.#assign(body, 'address', this.#buildAddress(street, city, state, postalCode, country))
    this.#assign(body, 'custom_fields', this.#toList(customFields))

    return await this.#apiRequest({ url: `${ API_BASE_URL }/companies`, method: 'post', body, logTag: 'createCompany' })
  }

  /**
   * @operationName Get Company
   * @category Companies
   * @description Retrieves a single company by its Copper ID, including email domain, phone numbers, address, tags, and custom fields.
   * @route GET /companies/{id}
   * @paramDef {"type":"String","label":"Company ID","name":"id","required":true,"description":"The Copper ID of the company to fetch. Use Search Companies to find IDs."}
   * @returns {Object}
   * @sampleResult {"id":456,"name":"Acme Inc","email_domain":"acme.com","phone_numbers":[{"number":"555-1000","category":"work"}]}
   */
  async getCompany(id) {
    return await this.#apiRequest({ url: `${ API_BASE_URL }/companies/${ id }`, logTag: 'getCompany' })
  }

  /**
   * @operationName Search Companies
   * @category Companies
   * @description Searches companies in Copper with paging and sorting, optionally filtering by name. Returns an array of matching companies. Copper caps page_size at 200.
   * @route POST /companies/search
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Filter by full or partial company name."}
   * @paramDef {"type":"Number","label":"Page Number","name":"pageNumber","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":1,"description":"1-based page of results to return (default 1)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":20,"description":"Results per page, max 200 (default 20)."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Name","Date Created","Date Modified"]}},"defaultValue":"Name","description":"Field to sort results by."}
   * @paramDef {"type":"String","label":"Sort Direction","name":"sortDirection","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"defaultValue":"Ascending","description":"Order of the sort."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":456,"name":"Acme Inc","email_domain":"acme.com"}]
   */
  async searchCompanies(name, pageNumber, pageSize, sortBy, sortDirection) {
    const body = this.#buildSearchBody({ name, pageNumber, pageSize, sortBy, sortDirection })

    return await this.#apiRequest({ url: `${ API_BASE_URL }/companies/search`, method: 'post', body, logTag: 'searchCompanies' })
  }

  /**
   * @operationName Update Company
   * @category Companies
   * @description Updates an existing company in Copper. Only the fields you supply are changed; leave a field blank to keep its current value. Returns the updated company.
   * @route PUT /companies/{id}
   * @paramDef {"type":"String","label":"Company ID","name":"id","required":true,"description":"The Copper ID of the company to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New company name."}
   * @paramDef {"type":"String","label":"Email Domain","name":"emailDomain","description":"New primary email domain (e.g. acme.com)."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phone","description":"New primary phone number."}
   * @paramDef {"type":"String","label":"Assignee","name":"assigneeId","dictionary":"getUsersDictionary","description":"The Copper user to reassign this company to."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Replacement tag list. Accepts a list or a comma-separated string."}
   * @paramDef {"type":"String","label":"Details","name":"details","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New freeform notes/description."}
   * @paramDef {"type":"Array<Object>","label":"Custom Fields","name":"customFields","description":"Custom fields as objects: {\"custom_field_definition_id\":123,\"value\":\"...\"}. Passed through to Copper unchanged."}
   * @returns {Object}
   * @sampleResult {"id":456,"name":"Acme Corp","email_domain":"acme.com","date_modified":1700001000}
   */
  async updateCompany(id, name, emailDomain, phone, assigneeId, tags, details, customFields) {
    const body = {}

    this.#assign(body, 'name', name)
    this.#assign(body, 'email_domain', emailDomain)
    this.#assign(body, 'phone_numbers', this.#buildPhoneNumbers(phone))
    this.#assign(body, 'assignee_id', assigneeId)
    this.#assign(body, 'details', details)
    this.#assign(body, 'tags', this.#toList(tags))
    this.#assign(body, 'custom_fields', this.#toList(customFields))

    return await this.#apiRequest({ url: `${ API_BASE_URL }/companies/${ id }`, method: 'put', body, logTag: 'updateCompany' })
  }

  /**
   * @operationName Delete Company
   * @category Companies
   * @description Permanently deletes a company from Copper by its ID. This cannot be undone.
   * @route DELETE /companies/{id}
   * @paramDef {"type":"String","label":"Company ID","name":"id","required":true,"description":"The Copper ID of the company to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":456}
   */
  async deleteCompany(id) {
    await this.#apiRequest({ url: `${ API_BASE_URL }/companies/${ id }`, method: 'delete', logTag: 'deleteCompany' })

    return { deleted: true, id }
  }

  // ==========================================================================
  //  LEADS
  // ==========================================================================
  /**
   * @operationName Create Lead
   * @category Leads
   * @description Creates a new lead in Copper. Provide a name and any details — email, phone, company, title, status, or monetary value. Custom fields can be passed through as an array. Returns the created lead including its Copper ID.
   * @route POST /leads
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the lead (person or opportunity name)."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Primary email address for the lead."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phone","description":"Primary phone number for the lead."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"Company the lead is associated with."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Job title of the lead."}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"Lead status (e.g. New, Open, Unqualified, Junk, Converted). Copper accounts may customize these values."}
   * @paramDef {"type":"String","label":"Customer Source","name":"customerSourceId","dictionary":"getCustomerSourcesDictionary","description":"Where this lead originated from."}
   * @paramDef {"type":"Number","label":"Monetary Value","name":"monetaryValue","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Estimated value of the lead."}
   * @paramDef {"type":"String","label":"Assignee","name":"assigneeId","dictionary":"getUsersDictionary","description":"The Copper user to assign this lead to."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags to apply. Accepts a list or a comma-separated string."}
   * @paramDef {"type":"String","label":"Details","name":"details","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Freeform notes/description about the lead."}
   * @paramDef {"type":"Array<Object>","label":"Custom Fields","name":"customFields","description":"Custom fields as objects: {\"custom_field_definition_id\":123,\"value\":\"...\"}. Passed through to Copper unchanged."}
   * @returns {Object}
   * @sampleResult {"id":789,"name":"Big Deal Lead","email":{"email":"lead@example.com","category":"work"},"company_name":"Prospect Co","status":"New","monetary_value":5000}
   */
  async createLead(name, email, phone, companyName, title, status, customerSourceId, monetaryValue, assigneeId, tags, details, customFields) {
    const body = { name }

    // Leads use singular "email" and "phone_numbers" objects/arrays.
    if (email) {
      body.email = { email, category: 'work' }
    }

    this.#assign(body, 'phone_numbers', this.#buildPhoneNumbers(phone))
    this.#assign(body, 'company_name', companyName)
    this.#assign(body, 'title', title)
    this.#assign(body, 'status', status)
    this.#assign(body, 'customer_source_id', customerSourceId)
    this.#assign(body, 'monetary_value', monetaryValue)
    this.#assign(body, 'assignee_id', assigneeId)
    this.#assign(body, 'details', details)
    this.#assign(body, 'tags', this.#toList(tags))
    this.#assign(body, 'custom_fields', this.#toList(customFields))

    return await this.#apiRequest({ url: `${ API_BASE_URL }/leads`, method: 'post', body, logTag: 'createLead' })
  }

  /**
   * @operationName Get Lead
   * @category Leads
   * @description Retrieves a single lead by its Copper ID, including contact details, status, monetary value, and custom fields.
   * @route GET /leads/{id}
   * @paramDef {"type":"String","label":"Lead ID","name":"id","required":true,"description":"The Copper ID of the lead to fetch. Use Search Leads to find IDs."}
   * @returns {Object}
   * @sampleResult {"id":789,"name":"Big Deal Lead","company_name":"Prospect Co","status":"Open","monetary_value":5000}
   */
  async getLead(id) {
    return await this.#apiRequest({ url: `${ API_BASE_URL }/leads/${ id }`, logTag: 'getLead' })
  }

  /**
   * @operationName Search Leads
   * @category Leads
   * @description Searches leads in Copper with paging and sorting, optionally filtering by name. Returns an array of matching leads. Copper caps page_size at 200.
   * @route POST /leads/search
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Filter by full or partial lead name."}
   * @paramDef {"type":"Number","label":"Page Number","name":"pageNumber","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":1,"description":"1-based page of results to return (default 1)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":20,"description":"Results per page, max 200 (default 20)."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Name","Date Created","Date Modified"]}},"defaultValue":"Name","description":"Field to sort results by."}
   * @paramDef {"type":"String","label":"Sort Direction","name":"sortDirection","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"defaultValue":"Ascending","description":"Order of the sort."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":789,"name":"Big Deal Lead","company_name":"Prospect Co","status":"Open"}]
   */
  async searchLeads(name, pageNumber, pageSize, sortBy, sortDirection) {
    const body = this.#buildSearchBody({ name, pageNumber, pageSize, sortBy, sortDirection })

    return await this.#apiRequest({ url: `${ API_BASE_URL }/leads/search`, method: 'post', body, logTag: 'searchLeads' })
  }

  /**
   * @operationName Update Lead
   * @category Leads
   * @description Updates an existing lead in Copper. Only the fields you supply are changed; leave a field blank to keep its current value. Returns the updated lead.
   * @route PUT /leads/{id}
   * @paramDef {"type":"String","label":"Lead ID","name":"id","required":true,"description":"The Copper ID of the lead to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New name for the lead."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New primary email address."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phone","description":"New primary phone number."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"New company name."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New job title."}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"New lead status (e.g. New, Open, Unqualified). Copper accounts may customize these values."}
   * @paramDef {"type":"Number","label":"Monetary Value","name":"monetaryValue","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New estimated value of the lead."}
   * @paramDef {"type":"String","label":"Assignee","name":"assigneeId","dictionary":"getUsersDictionary","description":"The Copper user to reassign this lead to."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Replacement tag list. Accepts a list or a comma-separated string."}
   * @paramDef {"type":"Array<Object>","label":"Custom Fields","name":"customFields","description":"Custom fields as objects: {\"custom_field_definition_id\":123,\"value\":\"...\"}. Passed through to Copper unchanged."}
   * @returns {Object}
   * @sampleResult {"id":789,"name":"Big Deal Lead","status":"Qualified","monetary_value":8000,"date_modified":1700001000}
   */
  async updateLead(id, name, email, phone, companyName, title, status, monetaryValue, assigneeId, tags, customFields) {
    const body = {}

    this.#assign(body, 'name', name)

    if (email) {
      body.email = { email, category: 'work' }
    }

    this.#assign(body, 'phone_numbers', this.#buildPhoneNumbers(phone))
    this.#assign(body, 'company_name', companyName)
    this.#assign(body, 'title', title)
    this.#assign(body, 'status', status)
    this.#assign(body, 'monetary_value', monetaryValue)
    this.#assign(body, 'assignee_id', assigneeId)
    this.#assign(body, 'tags', this.#toList(tags))
    this.#assign(body, 'custom_fields', this.#toList(customFields))

    return await this.#apiRequest({ url: `${ API_BASE_URL }/leads/${ id }`, method: 'put', body, logTag: 'updateLead' })
  }

  /**
   * @operationName Delete Lead
   * @category Leads
   * @description Permanently deletes a lead from Copper by its ID. This cannot be undone.
   * @route DELETE /leads/{id}
   * @paramDef {"type":"String","label":"Lead ID","name":"id","required":true,"description":"The Copper ID of the lead to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":789}
   */
  async deleteLead(id) {
    await this.#apiRequest({ url: `${ API_BASE_URL }/leads/${ id }`, method: 'delete', logTag: 'deleteLead' })

    return { deleted: true, id }
  }

  /**
   * @operationName Convert Lead
   * @category Leads
   * @description Converts a lead into a person, company, and/or opportunity. Optionally supply the pipeline and stage and a name for the resulting opportunity. Returns the conversion result with the created record IDs.
   * @route POST /leads/{id}/convert
   * @paramDef {"type":"String","label":"Lead ID","name":"id","required":true,"description":"The Copper ID of the lead to convert."}
   * @paramDef {"type":"String","label":"Pipeline","name":"pipelineId","dictionary":"getPipelinesDictionary","description":"The pipeline for the resulting opportunity. Leave blank to skip creating an opportunity."}
   * @paramDef {"type":"String","label":"Pipeline Stage","name":"pipelineStageId","dictionary":"getPipelineStagesDictionary","dependsOn":["pipelineId"],"description":"The stage within the selected pipeline for the resulting opportunity."}
   * @paramDef {"type":"String","label":"Opportunity Name","name":"opportunityName","description":"Name for the resulting opportunity. Defaults to the lead name."}
   * @paramDef {"type":"Number","label":"Monetary Value","name":"monetaryValue","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Monetary value for the resulting opportunity."}
   * @returns {Object}
   * @sampleResult {"person":{"id":123},"company":{"id":456},"opportunity":{"id":321,"name":"Big Deal Lead","pipeline_id":11,"pipeline_stage_id":101}}
   */
  async convertLead(id, pipelineId, pipelineStageId, opportunityName, monetaryValue) {
    const details = {}

    this.#assign(details, 'name', opportunityName)
    this.#assign(details, 'pipeline_id', pipelineId)
    this.#assign(details, 'pipeline_stage_id', pipelineStageId)
    this.#assign(details, 'monetary_value', monetaryValue)

    const body = Object.keys(details).length ? { details } : {}

    return await this.#apiRequest({ url: `${ API_BASE_URL }/leads/${ id }/convert`, method: 'post', body, logTag: 'convertLead' })
  }

  // ==========================================================================
  //  OPPORTUNITIES
  // ==========================================================================
  /**
   * @operationName Create Opportunity
   * @category Opportunities
   * @description Creates a new opportunity (deal) in Copper. Requires a name and a pipeline. Optionally link a primary contact and company, set a stage, monetary value, win probability, and close date. Returns the created opportunity including its Copper ID.
   * @route POST /opportunities
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the opportunity (e.g. Acme - Annual Contract)."}
   * @paramDef {"type":"String","label":"Pipeline","name":"pipelineId","required":true,"dictionary":"getPipelinesDictionary","description":"The pipeline this opportunity belongs to."}
   * @paramDef {"type":"String","label":"Pipeline Stage","name":"pipelineStageId","dictionary":"getPipelineStagesDictionary","dependsOn":["pipelineId"],"description":"The stage within the selected pipeline."}
   * @paramDef {"type":"String","label":"Primary Contact ID","name":"primaryContactId","description":"The Copper person ID of the primary contact. Use Search People to find IDs."}
   * @paramDef {"type":"String","label":"Company ID","name":"companyId","description":"The Copper company ID this opportunity is associated with. Use Search Companies to find IDs."}
   * @paramDef {"type":"Number","label":"Monetary Value","name":"monetaryValue","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Expected monetary value of the opportunity."}
   * @paramDef {"type":"Number","label":"Win Probability","name":"winProbability","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Probability of winning, 0-100."}
   * @paramDef {"type":"String","label":"Close Date","name":"closeDate","uiComponent":{"type":"DATE_PICKER"},"description":"Expected close date. Sent to Copper in MM/DD/YYYY format."}
   * @paramDef {"type":"String","label":"Customer Source","name":"customerSourceId","dictionary":"getCustomerSourcesDictionary","description":"Where this opportunity originated from."}
   * @paramDef {"type":"String","label":"Assignee","name":"assigneeId","dictionary":"getUsersDictionary","description":"The Copper user to assign this opportunity to."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags to apply. Accepts a list or a comma-separated string."}
   * @paramDef {"type":"Array<Object>","label":"Custom Fields","name":"customFields","description":"Custom fields as objects: {\"custom_field_definition_id\":123,\"value\":\"...\"}. Passed through to Copper unchanged."}
   * @returns {Object}
   * @sampleResult {"id":321,"name":"Acme - Annual Contract","pipeline_id":11,"pipeline_stage_id":101,"monetary_value":25000,"close_date":"12/31/2024"}
   */
  async createOpportunity(name, pipelineId, pipelineStageId, primaryContactId, companyId, monetaryValue, winProbability, closeDate, customerSourceId, assigneeId, tags, customFields) {
    const body = { name, pipeline_id: pipelineId }

    this.#assign(body, 'pipeline_stage_id', pipelineStageId)
    this.#assign(body, 'primary_contact_id', primaryContactId)
    this.#assign(body, 'company_id', companyId)
    this.#assign(body, 'monetary_value', monetaryValue)
    this.#assign(body, 'win_probability', winProbability)
    this.#assign(body, 'close_date', this.#formatCloseDate(closeDate))
    this.#assign(body, 'customer_source_id', customerSourceId)
    this.#assign(body, 'assignee_id', assigneeId)
    this.#assign(body, 'tags', this.#toList(tags))
    this.#assign(body, 'custom_fields', this.#toList(customFields))

    return await this.#apiRequest({ url: `${ API_BASE_URL }/opportunities`, method: 'post', body, logTag: 'createOpportunity' })
  }

  // Copper expects close_date as MM/DD/YYYY. Accepts an ISO date or already-formatted string.
  #formatCloseDate(value) {
    if (!value) return undefined

    const date = new Date(value)

    if (Number.isNaN(date.getTime())) return value

    const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(date.getUTCDate()).padStart(2, '0')

    return `${ mm }/${ dd }/${ date.getUTCFullYear() }`
  }

  /**
   * @operationName Get Opportunity
   * @category Opportunities
   * @description Retrieves a single opportunity (deal) by its Copper ID, including pipeline, stage, monetary value, close date, and custom fields.
   * @route GET /opportunities/{id}
   * @paramDef {"type":"String","label":"Opportunity ID","name":"id","required":true,"description":"The Copper ID of the opportunity to fetch. Use Search Opportunities to find IDs."}
   * @returns {Object}
   * @sampleResult {"id":321,"name":"Acme - Annual Contract","pipeline_id":11,"pipeline_stage_id":101,"monetary_value":25000,"status":"Open"}
   */
  async getOpportunity(id) {
    return await this.#apiRequest({ url: `${ API_BASE_URL }/opportunities/${ id }`, logTag: 'getOpportunity' })
  }

  /**
   * @operationName Search Opportunities
   * @category Opportunities
   * @description Searches opportunities (deals) in Copper with paging and sorting, optionally filtering by name or pipeline. Returns an array of matching opportunities. Copper caps page_size at 200.
   * @route POST /opportunities/search
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Filter by full or partial opportunity name."}
   * @paramDef {"type":"String","label":"Pipeline","name":"pipelineId","dictionary":"getPipelinesDictionary","description":"Restrict results to a single pipeline."}
   * @paramDef {"type":"Number","label":"Page Number","name":"pageNumber","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":1,"description":"1-based page of results to return (default 1)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":20,"description":"Results per page, max 200 (default 20)."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Name","Date Created","Date Modified"]}},"defaultValue":"Name","description":"Field to sort results by."}
   * @paramDef {"type":"String","label":"Sort Direction","name":"sortDirection","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"defaultValue":"Ascending","description":"Order of the sort."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":321,"name":"Acme - Annual Contract","pipeline_id":11,"monetary_value":25000}]
   */
  async searchOpportunities(name, pipelineId, pageNumber, pageSize, sortBy, sortDirection) {
    const body = this.#buildSearchBody({ name, pageNumber, pageSize, sortBy, sortDirection })

    this.#assign(body, 'pipeline_ids', pipelineId ? [pipelineId] : undefined)

    return await this.#apiRequest({ url: `${ API_BASE_URL }/opportunities/search`, method: 'post', body, logTag: 'searchOpportunities' })
  }

  /**
   * @operationName Update Opportunity
   * @category Opportunities
   * @description Updates an existing opportunity (deal) in Copper. Only the fields you supply are changed; leave a field blank to keep its current value. Set the status to move the deal to Won or Lost. Returns the updated opportunity.
   * @route PUT /opportunities/{id}
   * @paramDef {"type":"String","label":"Opportunity ID","name":"id","required":true,"description":"The Copper ID of the opportunity to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New name for the opportunity."}
   * @paramDef {"type":"String","label":"Pipeline Stage","name":"pipelineStageId","dictionary":"getPipelineStagesDictionary","description":"Move the opportunity to a different stage. Pick a pipeline in Search first if you need stage IDs."}
   * @paramDef {"type":"Number","label":"Monetary Value","name":"monetaryValue","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New expected monetary value."}
   * @paramDef {"type":"Number","label":"Win Probability","name":"winProbability","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New probability of winning, 0-100."}
   * @paramDef {"type":"String","label":"Close Date","name":"closeDate","uiComponent":{"type":"DATE_PICKER"},"description":"New expected close date. Sent to Copper in MM/DD/YYYY format."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Won","Lost","Abandoned"]}},"description":"Deal outcome status."}
   * @paramDef {"type":"String","label":"Loss Reason","name":"lossReasonId","dictionary":"getLossReasonsDictionary","description":"Reason the opportunity was lost. Only meaningful when Status is Lost."}
   * @paramDef {"type":"String","label":"Assignee","name":"assigneeId","dictionary":"getUsersDictionary","description":"The Copper user to reassign this opportunity to."}
   * @paramDef {"type":"Array<Object>","label":"Custom Fields","name":"customFields","description":"Custom fields as objects: {\"custom_field_definition_id\":123,\"value\":\"...\"}. Passed through to Copper unchanged."}
   * @returns {Object}
   * @sampleResult {"id":321,"name":"Acme - Annual Contract","status":"Won","monetary_value":30000,"date_modified":1700001000}
   */
  async updateOpportunity(id, name, pipelineStageId, monetaryValue, winProbability, closeDate, status, lossReasonId, assigneeId, customFields) {
    const body = {}

    this.#assign(body, 'name', name)
    this.#assign(body, 'pipeline_stage_id', pipelineStageId)
    this.#assign(body, 'monetary_value', monetaryValue)
    this.#assign(body, 'win_probability', winProbability)
    this.#assign(body, 'close_date', this.#formatCloseDate(closeDate))
    this.#assign(body, 'status', this.#resolveChoice(status, { Open: 'Open', Won: 'Won', Lost: 'Lost', Abandoned: 'Abandoned' }))
    this.#assign(body, 'loss_reason_id', lossReasonId)
    this.#assign(body, 'assignee_id', assigneeId)
    this.#assign(body, 'custom_fields', this.#toList(customFields))

    return await this.#apiRequest({ url: `${ API_BASE_URL }/opportunities/${ id }`, method: 'put', body, logTag: 'updateOpportunity' })
  }

  /**
   * @operationName Delete Opportunity
   * @category Opportunities
   * @description Permanently deletes an opportunity (deal) from Copper by its ID. This cannot be undone.
   * @route DELETE /opportunities/{id}
   * @paramDef {"type":"String","label":"Opportunity ID","name":"id","required":true,"description":"The Copper ID of the opportunity to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":321}
   */
  async deleteOpportunity(id) {
    await this.#apiRequest({ url: `${ API_BASE_URL }/opportunities/${ id }`, method: 'delete', logTag: 'deleteOpportunity' })

    return { deleted: true, id }
  }

  // ==========================================================================
  //  TASKS
  // ==========================================================================
  /**
   * @operationName Create Task
   * @category Tasks
   * @description Creates a task in Copper, optionally related to a person, company, opportunity, or lead. Set a due date, reminder, assignee, priority, and status. Returns the created task including its Copper ID.
   * @route POST /tasks
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The task name/subject."}
   * @paramDef {"type":"String","label":"Related To Type","name":"relatedResourceType","uiComponent":{"type":"DROPDOWN","options":{"values":["Person","Company","Opportunity","Lead"]}},"description":"The kind of record this task is related to. Leave blank for a standalone task."}
   * @paramDef {"type":"String","label":"Related To ID","name":"relatedResourceId","description":"The Copper ID of the related record. Required if Related To Type is set."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"When the task is due."}
   * @paramDef {"type":"String","label":"Reminder Date","name":"reminderDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"When to send a reminder for the task."}
   * @paramDef {"type":"String","label":"Assignee","name":"assigneeId","dictionary":"getUsersDictionary","description":"The Copper user to assign this task to."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","uiComponent":{"type":"DROPDOWN","options":{"values":["None","High"]}},"description":"Task priority."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Completed"]}},"defaultValue":"Open","description":"Task status."}
   * @paramDef {"type":"String","label":"Details","name":"details","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Freeform notes/description for the task."}
   * @returns {Object}
   * @sampleResult {"id":901,"name":"Follow up call","related_resource":{"id":123,"type":"person"},"due_date":1700200000,"status":"Open"}
   */
  async createTask(name, relatedResourceType, relatedResourceId, dueDate, reminderDate, assigneeId, priority, status, details) {
    const body = { name }

    const resolvedType = this.#resolveChoice(relatedResourceType, {
      Person: 'person', Company: 'company', Opportunity: 'opportunity', Lead: 'lead',
    })

    if (resolvedType && relatedResourceId) {
      body.related_resource = { id: Number(relatedResourceId) || relatedResourceId, type: resolvedType }
    }

    this.#assign(body, 'due_date', this.#toUnix(dueDate))
    this.#assign(body, 'reminder_date', this.#toUnix(reminderDate))
    this.#assign(body, 'assignee_id', assigneeId)
    this.#assign(body, 'priority', this.#resolveChoice(priority, { None: 'None', High: 'High' }))
    this.#assign(body, 'status', this.#resolveChoice(status, { Open: 'Open', Completed: 'Completed' }))
    this.#assign(body, 'details', details)

    return await this.#apiRequest({ url: `${ API_BASE_URL }/tasks`, method: 'post', body, logTag: 'createTask' })
  }

  // Copper timestamps are Unix epoch seconds. Accepts an ISO date/datetime or an epoch number.
  #toUnix(value) {
    if (value === undefined || value === null || value === '') return undefined

    if (typeof value === 'number') return value

    const asNumber = Number(value)

    if (!Number.isNaN(asNumber) && String(asNumber) === String(value)) return asNumber

    const ms = new Date(value).getTime()

    return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000)
  }

  /**
   * @operationName List Tasks
   * @category Tasks
   * @description Lists tasks in Copper with paging and sorting. Returns an array of tasks. Copper caps page_size at 200.
   * @route POST /tasks/search
   * @paramDef {"type":"Number","label":"Page Number","name":"pageNumber","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":1,"description":"1-based page of results to return (default 1)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":20,"description":"Results per page, max 200 (default 20)."}
   * @paramDef {"type":"String","label":"Assignee","name":"assigneeId","dictionary":"getUsersDictionary","description":"Only return tasks assigned to this Copper user."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Name","Due Date","Date Created","Date Modified"]}},"defaultValue":"Due Date","description":"Field to sort results by."}
   * @paramDef {"type":"String","label":"Sort Direction","name":"sortDirection","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"defaultValue":"Ascending","description":"Order of the sort."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":901,"name":"Follow up call","due_date":1700200000,"status":"Open","assignee_id":55}]
   */
  async listTasks(pageNumber, pageSize, assigneeId, sortBy, sortDirection) {
    const body = {
      page_number: pageNumber || 1,
      page_size: Math.min(pageSize || 20, 200),
    }

    this.#assign(body, 'assignee_ids', assigneeId ? [assigneeId] : undefined)

    const resolvedSort = this.#resolveChoice(sortBy, {
      'Name': 'name',
      'Due Date': 'due_date',
      'Date Created': 'date_created',
      'Date Modified': 'date_modified',
    })

    this.#assign(body, 'sort_by', resolvedSort)
    this.#assign(body, 'sort_direction', this.#resolveChoice(sortDirection, { Ascending: 'asc', Descending: 'desc' }))

    return await this.#apiRequest({ url: `${ API_BASE_URL }/tasks/search`, method: 'post', body, logTag: 'listTasks' })
  }

  /**
   * @operationName Update Task
   * @category Tasks
   * @description Updates an existing task in Copper. Only the fields you supply are changed; leave a field blank to keep its current value. Set status to Completed to close the task. Returns the updated task.
   * @route PUT /tasks/{id}
   * @paramDef {"type":"String","label":"Task ID","name":"id","required":true,"description":"The Copper ID of the task to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New task name/subject."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"New due date for the task."}
   * @paramDef {"type":"String","label":"Assignee","name":"assigneeId","dictionary":"getUsersDictionary","description":"The Copper user to reassign this task to."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","uiComponent":{"type":"DROPDOWN","options":{"values":["None","High"]}},"description":"New task priority."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Completed"]}},"description":"New task status."}
   * @paramDef {"type":"String","label":"Details","name":"details","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New freeform notes/description."}
   * @returns {Object}
   * @sampleResult {"id":901,"name":"Follow up call","status":"Completed","date_modified":1700001000}
   */
  async updateTask(id, name, dueDate, assigneeId, priority, status, details) {
    const body = {}

    this.#assign(body, 'name', name)
    this.#assign(body, 'due_date', this.#toUnix(dueDate))
    this.#assign(body, 'assignee_id', assigneeId)
    this.#assign(body, 'priority', this.#resolveChoice(priority, { None: 'None', High: 'High' }))
    this.#assign(body, 'status', this.#resolveChoice(status, { Open: 'Open', Completed: 'Completed' }))
    this.#assign(body, 'details', details)

    return await this.#apiRequest({ url: `${ API_BASE_URL }/tasks/${ id }`, method: 'put', body, logTag: 'updateTask' })
  }

  /**
   * @operationName Delete Task
   * @category Tasks
   * @description Permanently deletes a task from Copper by its ID. This cannot be undone.
   * @route DELETE /tasks/{id}
   * @paramDef {"type":"String","label":"Task ID","name":"id","required":true,"description":"The Copper ID of the task to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":901}
   */
  async deleteTask(id) {
    await this.#apiRequest({ url: `${ API_BASE_URL }/tasks/${ id }`, method: 'delete', logTag: 'deleteTask' })

    return { deleted: true, id }
  }

  // ==========================================================================
  //  ACTIVITIES
  // ==========================================================================
  /**
   * @operationName Create Activity
   * @category Activities
   * @description Logs an activity (note or interaction) in Copper against a parent record such as a person, company, lead, or opportunity. The activity type is identified by a category ("user" for logged interactions, "system" for automatic) and a type ID. Returns the created activity.
   * @route POST /activities
   * @paramDef {"type":"String","label":"Activity Type Category","name":"typeCategory","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["User","System"]}},"defaultValue":"User","description":"Whether the activity type is user-defined (logged interactions like calls/notes) or system-generated."}
   * @paramDef {"type":"String","label":"Activity Type ID","name":"typeId","required":true,"description":"The activity type ID. 'note' is a built-in user type; other type IDs come from your account's activity types."}
   * @paramDef {"type":"String","label":"Parent Type","name":"parentType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Person","Company","Lead","Opportunity"]}},"description":"The kind of record the activity is logged against."}
   * @paramDef {"type":"String","label":"Parent ID","name":"parentId","required":true,"description":"The Copper ID of the parent record the activity is logged against."}
   * @paramDef {"type":"String","label":"Details","name":"details","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The activity note/details text."}
   * @returns {Object}
   * @sampleResult {"id":1001,"type":{"category":"user","id":"note"},"parent":{"type":"person","id":123},"details":"Called and left voicemail","activity_date":1700200000}
   */
  async createActivity(typeCategory, typeId, parentType, parentId, details) {
    const resolvedCategory = this.#resolveChoice(typeCategory, { User: 'user', System: 'system' })
    const resolvedParentType = this.#resolveChoice(parentType, {
      Person: 'person', Company: 'company', Lead: 'lead', Opportunity: 'opportunity',
    })

    const body = {
      type: { category: resolvedCategory, id: Number(typeId) || typeId },
      parent: { type: resolvedParentType, id: Number(parentId) || parentId },
    }

    this.#assign(body, 'details', details)

    return await this.#apiRequest({ url: `${ API_BASE_URL }/activities`, method: 'post', body, logTag: 'createActivity' })
  }

  /**
   * @operationName List Activities
   * @category Activities
   * @description Lists activities in Copper, optionally scoped to a single parent record (person, company, lead, or opportunity) and paged. Returns an array of activities. Copper caps page_size at 200.
   * @route POST /activities/search
   * @paramDef {"type":"String","label":"Parent Type","name":"parentType","uiComponent":{"type":"DROPDOWN","options":{"values":["Person","Company","Lead","Opportunity"]}},"description":"Restrict results to activities on this kind of record. Requires Parent ID."}
   * @paramDef {"type":"String","label":"Parent ID","name":"parentId","description":"The Copper ID of the parent record whose activities to list. Requires Parent Type."}
   * @paramDef {"type":"Number","label":"Page Number","name":"pageNumber","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":1,"description":"1-based page of results to return (default 1)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":20,"description":"Results per page, max 200 (default 20)."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":1001,"type":{"category":"user","id":"note"},"parent":{"type":"person","id":123},"details":"Called and left voicemail","activity_date":1700200000}]
   */
  async listActivities(parentType, parentId, pageNumber, pageSize) {
    const body = {
      page_number: pageNumber || 1,
      page_size: Math.min(pageSize || 20, 200),
    }

    const resolvedParentType = this.#resolveChoice(parentType, {
      Person: 'person', Company: 'company', Lead: 'lead', Opportunity: 'opportunity',
    })

    if (resolvedParentType && parentId) {
      body.parent = { type: resolvedParentType, id: Number(parentId) || parentId }
    }

    return await this.#apiRequest({ url: `${ API_BASE_URL }/activities/search`, method: 'post', body, logTag: 'listActivities' })
  }

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================
  /**
   * @registerAs DICTIONARY
   * @operationName Get Users Dictionary
   * @description Provides a searchable list of Copper users for assignee selection in other actions.
   * @route POST /get-users-dictionary
   * @paramDef {"type":"getUsersDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Jane Doe","value":"55","note":"jane@example.com"}],"cursor":null}
   */
  async getUsersDictionary(payload) {
    const { search, cursor } = payload || {}
    const pageNumber = Number(cursor) || 1

    const result = await this.#apiRequest({
      url: `${ API_BASE_URL }/users/search`,
      method: 'post',
      body: { page_number: pageNumber, page_size: 200 },
      logTag: 'getUsersDictionary',
    })

    const users = Array.isArray(result) ? result : []
    const term = (search || '').toLowerCase()

    const items = users
      .filter(user => !term || (user.name || '').toLowerCase().includes(term) || (user.email || '').toLowerCase().includes(term))
      .map(user => ({ label: user.name || user.email || String(user.id), value: String(user.id), note: user.email || `User ID: ${ user.id }` }))

    return { items, cursor: users.length === 200 ? String(pageNumber + 1) : null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Pipelines Dictionary
   * @description Provides a list of Copper pipelines for dropdown selection in the opportunity and lead-conversion actions.
   * @route POST /get-pipelines-dictionary
   * @paramDef {"type":"getPipelinesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Sales Pipeline","value":"11","note":"Pipeline ID: 11"}],"cursor":null}
   */
  async getPipelinesDictionary(payload) {
    const { search } = payload || {}

    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/pipelines`, logTag: 'getPipelinesDictionary' })
    const pipelines = Array.isArray(result) ? result : []
    const term = (search || '').toLowerCase()

    const items = pipelines
      .filter(pipeline => !term || (pipeline.name || '').toLowerCase().includes(term))
      .map(pipeline => ({ label: pipeline.name, value: String(pipeline.id), note: `Pipeline ID: ${ pipeline.id }` }))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Pipeline Stages Dictionary
   * @description Provides the stages for a selected pipeline for dropdown selection in the opportunity and lead-conversion actions.
   * @route POST /get-pipeline-stages-dictionary
   * @paramDef {"type":"getPipelineStagesDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the pipeline criteria whose stages to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Qualification","value":"101","note":"Stage in pipeline 11"}],"cursor":null}
   */
  async getPipelineStagesDictionary(payload) {
    const { search, criteria } = payload || {}
    const pipelineId = criteria?.pipelineId

    // Copper exposes all stages at /pipeline_stages; filter to the selected pipeline when supplied.
    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/pipeline_stages`, logTag: 'getPipelineStagesDictionary' })
    const stages = Array.isArray(result) ? result : []
    const term = (search || '').toLowerCase()

    const items = stages
      .filter(stage => !pipelineId || String(stage.pipeline_id) === String(pipelineId))
      .filter(stage => !term || (stage.name || '').toLowerCase().includes(term))
      .map(stage => ({ label: stage.name, value: String(stage.id), note: `Stage in pipeline ${ stage.pipeline_id }` }))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Customer Sources Dictionary
   * @description Provides a list of Copper customer sources for dropdown selection in the lead and opportunity actions.
   * @route POST /get-customer-sources-dictionary
   * @paramDef {"type":"getCustomerSourcesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Referral","value":"3","note":"Source ID: 3"}],"cursor":null}
   */
  async getCustomerSourcesDictionary(payload) {
    const { search } = payload || {}

    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/customer_sources`, logTag: 'getCustomerSourcesDictionary' })
    const sources = Array.isArray(result) ? result : []
    const term = (search || '').toLowerCase()

    const items = sources
      .filter(source => !term || (source.name || '').toLowerCase().includes(term))
      .map(source => ({ label: source.name, value: String(source.id), note: `Source ID: ${ source.id }` }))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Loss Reasons Dictionary
   * @description Provides a list of Copper opportunity loss reasons for dropdown selection when marking an opportunity as lost.
   * @route POST /get-loss-reasons-dictionary
   * @paramDef {"type":"getLossReasonsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Price too high","value":"7","note":"Loss reason ID: 7"}],"cursor":null}
   */
  async getLossReasonsDictionary(payload) {
    const { search } = payload || {}

    const result = await this.#apiRequest({ url: `${ API_BASE_URL }/loss_reasons`, logTag: 'getLossReasonsDictionary' })
    const reasons = Array.isArray(result) ? result : []
    const term = (search || '').toLowerCase()

    const items = reasons
      .filter(reason => !term || (reason.name || '').toLowerCase().includes(term))
      .map(reason => ({ label: reason.name, value: String(reason.id), note: `Loss reason ID: ${ reason.id }` }))

    return { items, cursor: null }
  }
}

Flowrunner.ServerCode.addService(Copper, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Copper API token. In Copper go to Settings → Integrations → API Keys → Generate API Key. Paste the API token here.',
  },
  {
    name: 'email',
    displayName: 'User Email',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'The email address of the Copper user the API key belongs to (sent as X-PW-UserEmail).',
  },
])
