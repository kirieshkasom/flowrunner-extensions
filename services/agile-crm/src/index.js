const logger = {
  info: (...args) => console.log('[Agile CRM] info:', ...args),
  debug: (...args) => console.log('[Agile CRM] debug:', ...args),
  error: (...args) => console.log('[Agile CRM] error:', ...args),
  warn: (...args) => console.log('[Agile CRM] warn:', ...args),
}

// SYSTEM contact/company properties that map from simple params to Agile's properties array.
const SYSTEM_PROPERTY_NAMES = [
  'first_name',
  'last_name',
  'name',
  'email',
  'phone',
  'company',
  'title',
  'website',
  'address',
  'image',
]

/**
 * @integrationName Agile CRM
 * @integrationIcon /icon.png
 */
class AgileCRM {
  constructor(config) {
    this.domain = config.domain
    this.email = config.email
    this.apiKey = config.apiKey
    this.baseUrl = `https://${ config.domain }.agilecrm.com/dev/api`
    this.authHeader = `Basic ${ Buffer.from(`${ config.email }:${ config.apiKey }`).toString('base64') }`
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ path, method = 'get', body, form, query, logTag }) {
    const url = `${ this.baseUrl }${ path }`

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ 'Authorization': this.authHeader, 'Accept': 'application/json' })
        .query(query || {})

      if (form !== undefined) {
        // Agile's form-encoded endpoints (tags, some list endpoints).
        request.set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        const params = new URLSearchParams()

        Object.entries(form).forEach(([key, value]) => {
          if (value === undefined || value === null) return
          params.append(key, typeof value === 'string' ? value : JSON.stringify(value))
        })

        return await request.send(params.toString())
      }

      if (body !== undefined) {
        request.set({ 'Content-Type': 'application/json' })

        return await request.send(body)
      }

      return await request
    } catch (error) {
      // Agile errors can be plain text, or JSON with a message.
      const message =
        error.body?.message ||
        (typeof error.body === 'string' && error.body) ||
        error.response?.text ||
        error.message ||
        'Unknown error'
      const status = error.status || error.statusCode
      logger.error(`${ logTag } - failed (${ status || 'n/a' }): ${ message }`)
      throw new Error(`Agile CRM API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  // Maps friendly dropdown labels to their API tokens; passes through unknown values.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /**
   * Builds Agile's properties array from simple fields, then appends any raw
   * properties passthrough (raw entries win on duplicate names).
   */
  #buildProperties(simpleFields, rawProperties) {
    const properties = []
    const subtypes = {
      email: 'work',
      phone: 'work',
      address: 'home',
    }

    Object.entries(simpleFields || {}).forEach(([name, value]) => {
      if (value === undefined || value === null || value === '') return
      const property = { type: 'SYSTEM', name, value }
      if (subtypes[name]) property.subtype = subtypes[name]
      properties.push(property)
    })

    if (Array.isArray(rawProperties)) {
      rawProperties.forEach(property => {
        if (!property || !property.name) return
        // Default type to CUSTOM unless it is a known system field.
        const type = property.type || (SYSTEM_PROPERTY_NAMES.includes(property.name) ? 'SYSTEM' : 'CUSTOM')
        properties.push({ ...property, type })
      })
    }

    return properties
  }

  /**
   * Flattens Agile's properties array into a simple { name: value } object for
   * convenient downstream use, keeping the last value seen per name.
   */
  #flattenProperties(record) {
    if (!record || !Array.isArray(record.properties)) return record
    const simple = {}

    record.properties.forEach(property => {
      if (property && property.name !== undefined) simple[property.name] = property.value
    })

    return { ...record, simple }
  }

  // ==========================================================================
  // Contacts
  // ==========================================================================

  /**
   * @operationName Create Contact
   * @description Creates a new person contact in Agile CRM. Provide any of the simple fields (first name, last name, email, phone, company, title) which are converted into Agile's properties array, and/or pass a raw properties array for custom fields and non-default subtypes. Tags may be attached at creation.
   * @category Contacts
   * @route POST /contacts
   * @paramDef {"type":"String","label":"First Name","name":"firstName","required":false,"description":"Contact first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","required":false,"description":"Contact last name."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":false,"description":"Contact email address (stored with subtype 'work')."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","required":false,"description":"Contact phone number (stored with subtype 'work')."}
   * @paramDef {"type":"String","label":"Company","name":"company","required":false,"description":"Company name the contact belongs to."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":false,"description":"Contact job title."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","required":false,"description":"Tags to attach to the contact."}
   * @paramDef {"type":"Array<Object>","label":"Raw Properties","name":"properties","required":false,"description":"Advanced: raw Agile properties array to append or override. Each item: {type:'SYSTEM'|'CUSTOM', name, value, subtype}. Use for custom fields or non-default subtypes (e.g. personal email)."}
   * @returns {Object}
   * @sampleResult {"id":5685809876205568,"type":"PERSON","tags":["lead"],"properties":[{"type":"SYSTEM","name":"first_name","value":"John"},{"type":"SYSTEM","name":"email","subtype":"work","value":"john@example.com"}],"simple":{"first_name":"John","email":"john@example.com"}}
   */
  async createContact(firstName, lastName, email, phone, company, title, tags, properties) {
    const body = {
      type: 'PERSON',
      properties: this.#buildProperties(
        { first_name: firstName, last_name: lastName, email, phone, company, title },
        properties
      ),
    }
    if (Array.isArray(tags) && tags.length) body.tags = tags

    const result = await this.#apiRequest({ path: '/contacts', method: 'post', body, logTag: 'createContact' })

    return this.#flattenProperties(result)
  }

  /**
   * @operationName Get Contact
   * @description Retrieves a single contact by its Agile CRM id. The response includes the raw properties array plus a flattened 'simple' object for convenient field access.
   * @category Contacts
   * @route GET /contacts/{id}
   * @paramDef {"type":"String","label":"Contact ID","name":"id","required":true,"description":"The Agile CRM contact id."}
   * @returns {Object}
   * @sampleResult {"id":5685809876205568,"type":"PERSON","properties":[{"type":"SYSTEM","name":"first_name","value":"John"}],"simple":{"first_name":"John"}}
   */
  async getContact(id) {
    const result = await this.#apiRequest({ path: `/contacts/${ id }`, method: 'get', logTag: 'getContact' })

    return this.#flattenProperties(result)
  }

  /**
   * @operationName Get Contact by Email
   * @description Looks up a contact by its email address. Returns the matching contact with the raw properties array and a flattened 'simple' object, or an error if no contact matches.
   * @category Contacts
   * @route GET /contacts/search/email
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"The email address to search for (case-sensitive)."}
   * @returns {Object}
   * @sampleResult {"id":5685809876205568,"type":"PERSON","properties":[{"type":"SYSTEM","name":"email","subtype":"work","value":"john@example.com"}],"simple":{"email":"john@example.com"}}
   */
  async getContactByEmail(email) {
    const result = await this.#apiRequest({
      path: `/contacts/search/email/${ encodeURIComponent(email) }`,
      method: 'get',
      logTag: 'getContactByEmail',
    })

    return this.#flattenProperties(result)
  }

  /**
   * @operationName List Contacts
   * @description Retrieves a page of contacts from Agile CRM using cursor-based pagination. Returns an array of contacts (each with a flattened 'simple' object) and a cursor for the next page when more results are available.
   * @category Contacts
   * @route GET /contacts
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of contacts to return per page (default 20, max 100)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"description":"Pagination cursor from a previous response to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":5685809876205568,"type":"PERSON","simple":{"first_name":"John"}}],"cursor":"CjsSNWoRc35hZ2lsZS1jcm0="}
   */
  async listContacts(pageSize, cursor) {
    const result = await this.#apiRequest({
      path: '/contacts',
      method: 'get',
      query: { page_size: pageSize || 20, cursor },
      logTag: 'listContacts',
    })

    return this.#paginate(result)
  }

  /**
   * @operationName Update Contact
   * @description Updates properties on an existing contact. Provide the contact id plus any simple fields to change and/or a raw properties array. Only the supplied properties are modified; omitted properties are left untouched.
   * @category Contacts
   * @route PUT /contacts
   * @paramDef {"type":"String","label":"Contact ID","name":"id","required":true,"description":"The Agile CRM contact id to update."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","required":false,"description":"New first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","required":false,"description":"New last name."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":false,"description":"New email address (subtype 'work')."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","required":false,"description":"New phone number (subtype 'work')."}
   * @paramDef {"type":"String","label":"Company","name":"company","required":false,"description":"New company name."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":false,"description":"New job title."}
   * @paramDef {"type":"Array<Object>","label":"Raw Properties","name":"properties","required":false,"description":"Advanced: raw Agile properties array to set. Each item: {type:'SYSTEM'|'CUSTOM', name, value, subtype}."}
   * @returns {Object}
   * @sampleResult {"id":5685809876205568,"type":"PERSON","properties":[{"type":"SYSTEM","name":"title","value":"VP Sales"}],"simple":{"title":"VP Sales"}}
   */
  async updateContact(id, firstName, lastName, email, phone, company, title, properties) {
    const body = {
      id,
      properties: this.#buildProperties(
        { first_name: firstName, last_name: lastName, email, phone, company, title },
        properties
      ),
    }
    const result = await this.#apiRequest({
      path: '/contacts/edit-properties',
      method: 'put',
      body,
      logTag: 'updateContact',
    })

    return this.#flattenProperties(result)
  }

  /**
   * @operationName Delete Contact
   * @description Permanently deletes a contact by id. This action cannot be undone.
   * @category Contacts
   * @route DELETE /contacts/{id}
   * @paramDef {"type":"String","label":"Contact ID","name":"id","required":true,"description":"The Agile CRM contact id to delete."}
   * @returns {Object}
   * @sampleResult {"success":true,"id":"5685809876205568"}
   */
  async deleteContact(id) {
    await this.#apiRequest({ path: `/contacts/${ id }`, method: 'delete', logTag: 'deleteContact' })

    return { success: true, id: String(id) }
  }

  /**
   * @operationName Search Contacts
   * @description Full-text search across contacts or companies by keyword. Filter by record type and control page size. Returns matching records, each with a flattened 'simple' object.
   * @category Contacts
   * @route GET /search
   * @paramDef {"type":"String","label":"Query","name":"q","required":true,"description":"Keyword to search for (matches name, email, and other fields)."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Person","Company"]}},"defaultValue":"Person","description":"Restrict results to people or companies."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of results to return (default 10)."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":5685809876205568,"type":"PERSON","simple":{"first_name":"John","email":"john@example.com"}}]
   */
  async searchContacts(q, type, pageSize) {
    const result = await this.#apiRequest({
      path: '/search',
      method: 'get',
      query: {
        q,
        type: this.#resolveChoice(type, { Person: 'PERSON', Company: 'COMPANY' }) || 'PERSON',
        page_size: pageSize || 10,
      },
      logTag: 'searchContacts',
    })

    return (Array.isArray(result) ? result : []).map(item => this.#flattenProperties(item))
  }

  /**
   * @operationName Add Tags to Contact
   * @description Adds one or more tags to a contact identified by email address. Tags already present are left unchanged.
   * @category Contacts
   * @route POST /contacts/tags/add
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Email address of the contact to tag (case-sensitive)."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","required":true,"description":"Tags to add to the contact."}
   * @returns {Object}
   * @sampleResult {"success":true,"email":"john@example.com","tags":["lead","vip"]}
   */
  async addTagsToContact(email, tags) {
    await this.#apiRequest({
      path: '/contacts/email/tags/add',
      method: 'post',
      form: { email, tags: Array.isArray(tags) ? tags : [tags] },
      logTag: 'addTagsToContact',
    })

    return { success: true, email, tags }
  }

  /**
   * @operationName Delete Tags from Contact
   * @description Removes one or more tags from a contact identified by email address.
   * @category Contacts
   * @route POST /contacts/tags/delete
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Email address of the contact (case-sensitive)."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","required":true,"description":"Tags to remove from the contact."}
   * @returns {Object}
   * @sampleResult {"success":true,"email":"john@example.com","tags":["vip"]}
   */
  async deleteTagsFromContact(email, tags) {
    await this.#apiRequest({
      path: '/contacts/email/tags/delete',
      method: 'post',
      form: { email, tags: Array.isArray(tags) ? tags : [tags] },
      logTag: 'deleteTagsFromContact',
    })

    return { success: true, email, tags }
  }

  // ==========================================================================
  // Companies
  // ==========================================================================

  /**
   * @operationName Create Company
   * @description Creates a company record in Agile CRM. Provide the company name and optional website/phone which are converted into Agile's properties array, and/or pass a raw properties array for custom fields.
   * @category Companies
   * @route POST /companies
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Company name."}
   * @paramDef {"type":"String","label":"Website","name":"website","required":false,"description":"Company website URL."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","required":false,"description":"Company phone number (subtype 'work')."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","required":false,"description":"Tags to attach to the company."}
   * @paramDef {"type":"Array<Object>","label":"Raw Properties","name":"properties","required":false,"description":"Advanced: raw Agile properties array. Each item: {type:'SYSTEM'|'CUSTOM', name, value, subtype}."}
   * @returns {Object}
   * @sampleResult {"id":5123456789012345,"type":"COMPANY","properties":[{"type":"SYSTEM","name":"name","value":"Acme Inc"}],"simple":{"name":"Acme Inc"}}
   */
  async createCompany(name, website, phone, tags, properties) {
    const body = {
      type: 'COMPANY',
      properties: this.#buildProperties({ name, website, phone }, properties),
    }
    if (Array.isArray(tags) && tags.length) body.tags = tags

    const result = await this.#apiRequest({ path: '/contacts', method: 'post', body, logTag: 'createCompany' })

    return this.#flattenProperties(result)
  }

  /**
   * @operationName Get Company
   * @description Retrieves a single company by its Agile CRM id, including the raw properties array and a flattened 'simple' object.
   * @category Companies
   * @route GET /companies/{id}
   * @paramDef {"type":"String","label":"Company ID","name":"id","required":true,"description":"The Agile CRM company id."}
   * @returns {Object}
   * @sampleResult {"id":5123456789012345,"type":"COMPANY","properties":[{"type":"SYSTEM","name":"name","value":"Acme Inc"}],"simple":{"name":"Acme Inc"}}
   */
  async getCompany(id) {
    const result = await this.#apiRequest({ path: `/contacts/${ id }`, method: 'get', logTag: 'getCompany' })

    return this.#flattenProperties(result)
  }

  /**
   * @operationName List Companies
   * @description Retrieves a page of companies using cursor-based pagination. Returns an array of companies (each with a flattened 'simple' object) and a cursor for the next page when available.
   * @category Companies
   * @route GET /companies
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of companies to return per page (default 25)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"description":"Pagination cursor from a previous response to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":5123456789012345,"type":"COMPANY","simple":{"name":"Acme Inc"}}],"cursor":"CjsSNWoRc35hZ2lsZS1jcm0="}
   */
  async listCompanies(pageSize, cursor) {
    const result = await this.#apiRequest({
      path: '/contacts/companies/list',
      method: 'post',
      form: { page_size: pageSize || 25, cursor },
      logTag: 'listCompanies',
    })

    return this.#paginate(result)
  }

  /**
   * @operationName Update Company
   * @description Updates properties on an existing company. Provide the company id plus any simple fields to change and/or a raw properties array. Only supplied properties are modified.
   * @category Companies
   * @route PUT /companies
   * @paramDef {"type":"String","label":"Company ID","name":"id","required":true,"description":"The Agile CRM company id to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":false,"description":"New company name."}
   * @paramDef {"type":"String","label":"Website","name":"website","required":false,"description":"New website URL."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","required":false,"description":"New phone number (subtype 'work')."}
   * @paramDef {"type":"Array<Object>","label":"Raw Properties","name":"properties","required":false,"description":"Advanced: raw Agile properties array to set. Each item: {type:'SYSTEM'|'CUSTOM', name, value, subtype}."}
   * @returns {Object}
   * @sampleResult {"id":5123456789012345,"type":"COMPANY","properties":[{"type":"SYSTEM","name":"name","value":"Acme LLC"}],"simple":{"name":"Acme LLC"}}
   */
  async updateCompany(id, name, website, phone, properties) {
    const body = {
      id,
      properties: this.#buildProperties({ name, website, phone }, properties),
    }
    const result = await this.#apiRequest({
      path: '/contacts/edit-properties',
      method: 'put',
      body,
      logTag: 'updateCompany',
    })

    return this.#flattenProperties(result)
  }

  /**
   * @operationName Delete Company
   * @description Permanently deletes a company by id. This action cannot be undone.
   * @category Companies
   * @route DELETE /companies/{id}
   * @paramDef {"type":"String","label":"Company ID","name":"id","required":true,"description":"The Agile CRM company id to delete."}
   * @returns {Object}
   * @sampleResult {"success":true,"id":"5123456789012345"}
   */
  async deleteCompany(id) {
    await this.#apiRequest({ path: `/contacts/${ id }`, method: 'delete', logTag: 'deleteCompany' })

    return { success: true, id: String(id) }
  }

  // ==========================================================================
  // Deals
  // ==========================================================================

  /**
   * @operationName Create Deal
   * @description Creates a deal (opportunity) in Agile CRM. Expected value is required. Associate the deal with a track (pipeline) and milestone using the Get Tracks and Get Milestones dictionaries, and optionally link it to contacts.
   * @category Deals
   * @route POST /deals
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Deal name."}
   * @paramDef {"type":"Number","label":"Expected Value","name":"expectedValue","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Expected monetary value of the deal (required by Agile CRM)."}
   * @paramDef {"type":"String","label":"Milestone","name":"milestone","required":false,"dictionary":"getMilestonesDictionary","description":"Milestone name within the selected track (case-sensitive; must match your domain configuration)."}
   * @paramDef {"type":"String","label":"Track","name":"pipelineId","required":false,"dictionary":"getTracksDictionary","description":"Track (pipeline) id the deal belongs to. Defaults to the default track when omitted."}
   * @paramDef {"type":"Number","label":"Probability","name":"probability","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Win probability percentage (0-100)."}
   * @paramDef {"type":"Number","label":"Close Date","name":"closeDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Expected close date as a Unix timestamp in seconds."}
   * @paramDef {"type":"Array<String>","label":"Contact IDs","name":"contactIds","required":false,"description":"Ids of contacts to associate with the deal."}
   * @returns {Object}
   * @sampleResult {"id":6001234567890123,"name":"Website Redesign","expected_value":5000,"milestone":"Prospect","probability":75}
   */
  async createDeal(name, expectedValue, milestone, pipelineId, probability, closeDate, contactIds) {
    const body = { name, expected_value: expectedValue }
    if (milestone !== undefined) body.milestone = milestone
    if (pipelineId !== undefined) body.pipeline_id = pipelineId
    if (probability !== undefined) body.probability = probability
    if (closeDate !== undefined) body.close_date = closeDate
    if (Array.isArray(contactIds) && contactIds.length) body.contact_ids = contactIds

    return await this.#apiRequest({ path: '/opportunity', method: 'post', body, logTag: 'createDeal' })
  }

  /**
   * @operationName Get Deal
   * @description Retrieves a single deal (opportunity) by its Agile CRM id.
   * @category Deals
   * @route GET /deals/{id}
   * @paramDef {"type":"String","label":"Deal ID","name":"id","required":true,"description":"The Agile CRM deal id."}
   * @returns {Object}
   * @sampleResult {"id":6001234567890123,"name":"Website Redesign","expected_value":5000,"milestone":"Prospect"}
   */
  async getDeal(id) {
    return await this.#apiRequest({ path: `/opportunity/${ id }`, method: 'get', logTag: 'getDeal' })
  }

  /**
   * @operationName List Deals
   * @description Retrieves a page of deals (opportunities) using cursor-based pagination. Returns the deals array and a cursor for the next page when available.
   * @category Deals
   * @route GET /deals
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of deals to return per page (default 10)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","required":false,"description":"Pagination cursor from a previous response to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":6001234567890123,"name":"Website Redesign","expected_value":5000}],"cursor":"CjsSNWoRc35hZ2lsZS1jcm0="}
   */
  async listDeals(pageSize, cursor) {
    const result = await this.#apiRequest({
      path: '/opportunity',
      method: 'get',
      query: { page_size: pageSize || 10, cursor },
      logTag: 'listDeals',
    })

    return this.#paginate(result)
  }

  /**
   * @operationName Update Deal
   * @description Partially updates a deal. Provide the deal id plus any fields to change; omitted fields are left unchanged. Use the Get Tracks and Get Milestones dictionaries to select a track and milestone.
   * @category Deals
   * @route PUT /deals
   * @paramDef {"type":"String","label":"Deal ID","name":"id","required":true,"description":"The Agile CRM deal id to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":false,"description":"New deal name."}
   * @paramDef {"type":"Number","label":"Expected Value","name":"expectedValue","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New expected monetary value."}
   * @paramDef {"type":"String","label":"Milestone","name":"milestone","required":false,"dictionary":"getMilestonesDictionary","description":"New milestone name (case-sensitive)."}
   * @paramDef {"type":"String","label":"Track","name":"pipelineId","required":false,"dictionary":"getTracksDictionary","description":"New track (pipeline) id."}
   * @paramDef {"type":"Number","label":"Probability","name":"probability","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New win probability percentage (0-100)."}
   * @paramDef {"type":"Number","label":"Close Date","name":"closeDate","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"New expected close date as a Unix timestamp in seconds."}
   * @returns {Object}
   * @sampleResult {"id":6001234567890123,"name":"Website Redesign","milestone":"Won","probability":100}
   */
  async updateDeal(id, name, expectedValue, milestone, pipelineId, probability, closeDate) {
    const body = { id }
    if (name !== undefined) body.name = name
    if (expectedValue !== undefined) body.expected_value = expectedValue
    if (milestone !== undefined) body.milestone = milestone
    if (pipelineId !== undefined) body.pipeline_id = pipelineId
    if (probability !== undefined) body.probability = probability
    if (closeDate !== undefined) body.close_date = closeDate

    return await this.#apiRequest({
      path: '/opportunity/partial-update',
      method: 'put',
      body,
      logTag: 'updateDeal',
    })
  }

  /**
   * @operationName Delete Deal
   * @description Permanently deletes a deal (opportunity) by id. This action cannot be undone.
   * @category Deals
   * @route DELETE /deals/{id}
   * @paramDef {"type":"String","label":"Deal ID","name":"id","required":true,"description":"The Agile CRM deal id to delete."}
   * @returns {Object}
   * @sampleResult {"success":true,"id":"6001234567890123"}
   */
  async deleteDeal(id) {
    await this.#apiRequest({ path: `/opportunity/${ id }`, method: 'delete', logTag: 'deleteDeal' })

    return { success: true, id: String(id) }
  }

  // ==========================================================================
  // Tasks
  // ==========================================================================

  /**
   * @operationName Create Task
   * @description Creates a task in Agile CRM. Set a subject, task type, priority, and due date (Unix timestamp in seconds), and optionally associate it with contacts.
   * @category Tasks
   * @route POST /tasks
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Task subject / title."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Call","Email","Follow Up","Meeting","Milestone","Send","Tweet","Other"]}},"defaultValue":"Call","description":"Category of the task."}
   * @paramDef {"type":"String","label":"Priority","name":"priorityType","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["High","Normal","Low"]}},"defaultValue":"Normal","description":"Task priority."}
   * @paramDef {"type":"Number","label":"Due Date","name":"due","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"Due date as a Unix timestamp in seconds."}
   * @paramDef {"type":"Array<String>","label":"Contact IDs","name":"contacts","required":false,"description":"Ids of contacts to associate with the task."}
   * @returns {Object}
   * @sampleResult {"id":6100000000000000,"subject":"Call John","type":"CALL","priority_type":"HIGH","due":1479580200}
   */
  async createTask(subject, type, priorityType, due, contacts) {
    const body = {
      subject,
      type: this.#resolveChoice(type, {
        'Call': 'CALL',
        'Email': 'EMAIL',
        'Follow Up': 'FOLLOW_UP',
        'Meeting': 'MEETING',
        'Milestone': 'MILESTONE',
        'Send': 'SEND',
        'Tweet': 'TWEET',
        'Other': 'OTHER',
      }) || 'CALL',
      priority_type: this.#resolveChoice(priorityType, { High: 'HIGH', Normal: 'NORMAL', Low: 'LOW' }) || 'NORMAL',
    }
    if (due !== undefined) body.due = due
    if (Array.isArray(contacts) && contacts.length) body.contacts = contacts

    return await this.#apiRequest({ path: '/tasks', method: 'post', body, logTag: 'createTask' })
  }

  /**
   * @operationName List Pending Tasks
   * @description Retrieves pending (incomplete) tasks due within the given number of days from today.
   * @category Tasks
   * @route GET /tasks/pending
   * @paramDef {"type":"Number","label":"Days","name":"days","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of days ahead to include pending tasks for (default 7)."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":6100000000000000,"subject":"Call John","type":"CALL","priority_type":"HIGH"}]
   */
  async listPendingTasks(days) {
    const result = await this.#apiRequest({
      path: `/tasks/pending/${ days || 7 }`,
      method: 'get',
      logTag: 'listPendingTasks',
    })

    return Array.isArray(result) ? result : []
  }

  /**
   * @operationName Update Task
   * @description Updates an existing task. Provide the task id plus any fields to change; omitted fields are left unchanged.
   * @category Tasks
   * @route PUT /tasks
   * @paramDef {"type":"String","label":"Task ID","name":"id","required":true,"description":"The Agile CRM task id to update."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":false,"description":"New task subject."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Call","Email","Follow Up","Meeting","Milestone","Send","Tweet","Other"]}},"description":"New task category."}
   * @paramDef {"type":"String","label":"Priority","name":"priorityType","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["High","Normal","Low"]}},"description":"New task priority."}
   * @paramDef {"type":"Number","label":"Due Date","name":"due","required":false,"uiComponent":{"type":"DATE_PICKER"},"description":"New due date as a Unix timestamp in seconds."}
   * @paramDef {"type":"Boolean","label":"Completed","name":"isComplete","required":false,"uiComponent":{"type":"TOGGLE"},"description":"Whether the task is marked complete."}
   * @returns {Object}
   * @sampleResult {"id":6100000000000000,"subject":"Call John","status":"YET_TO_START","type":"CALL"}
   */
  async updateTask(id, subject, type, priorityType, due, isComplete) {
    const body = { id }
    if (subject !== undefined) body.subject = subject

    if (type !== undefined) {
      body.type = this.#resolveChoice(type, {
        'Call': 'CALL',
        'Email': 'EMAIL',
        'Follow Up': 'FOLLOW_UP',
        'Meeting': 'MEETING',
        'Milestone': 'MILESTONE',
        'Send': 'SEND',
        'Tweet': 'TWEET',
        'Other': 'OTHER',
      })
    }

    if (priorityType !== undefined) {
      body.priority_type = this.#resolveChoice(priorityType, { High: 'HIGH', Normal: 'NORMAL', Low: 'LOW' })
    }

    if (due !== undefined) body.due = due
    if (isComplete !== undefined) body.status = isComplete ? 'COMPLETED' : 'YET_TO_START'

    return await this.#apiRequest({ path: '/tasks', method: 'put', body, logTag: 'updateTask' })
  }

  /**
   * @operationName Delete Task
   * @description Permanently deletes a task by id. This action cannot be undone.
   * @category Tasks
   * @route DELETE /tasks/{id}
   * @paramDef {"type":"String","label":"Task ID","name":"id","required":true,"description":"The Agile CRM task id to delete."}
   * @returns {Object}
   * @sampleResult {"success":true,"id":"6100000000000000"}
   */
  async deleteTask(id) {
    await this.#apiRequest({ path: `/tasks/${ id }`, method: 'delete', logTag: 'deleteTask' })

    return { success: true, id: String(id) }
  }

  // ==========================================================================
  // Notes
  // ==========================================================================

  /**
   * @operationName Create Note
   * @description Creates a note and links it to one or more contacts. Provide a subject, description, and the contact ids to associate.
   * @category Notes
   * @route POST /notes
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Note subject / title."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Note body / details."}
   * @paramDef {"type":"Array<String>","label":"Contact IDs","name":"contactIds","required":true,"description":"Ids of contacts to attach the note to."}
   * @returns {Object}
   * @sampleResult {"id":6200000000000000,"subject":"Discovery call","description":"Discussed requirements","contact_ids":["5685809876205568"]}
   */
  async createNote(subject, description, contactIds) {
    const body = { subject, contact_ids: Array.isArray(contactIds) ? contactIds : [contactIds] }
    if (description !== undefined) body.description = description

    return await this.#apiRequest({ path: '/notes', method: 'post', body, logTag: 'createNote' })
  }

  /**
   * @operationName List Notes for Contact
   * @description Retrieves all notes attached to a specific contact, ordered by most recent first.
   * @category Notes
   * @route GET /contacts/{contactId}/notes
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The Agile CRM contact id whose notes to retrieve."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":6200000000000000,"subject":"Discovery call","description":"Discussed requirements"}]
   */
  async listNotesForContact(contactId) {
    const result = await this.#apiRequest({
      path: `/contacts/${ contactId }/notes`,
      method: 'get',
      logTag: 'listNotesForContact',
    })

    return Array.isArray(result) ? result : []
  }

  // ==========================================================================
  // Dictionaries
  // ==========================================================================

  /**
   * @typedef {Object} getTracksDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to track names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused; tracks are returned in a single page)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tracks Dictionary
   * @description Lists deal tracks (pipelines) configured in your Agile CRM domain for selection in dependent parameters. The value is the track id.
   * @category Deals
   * @route POST /get-tracks-dictionary
   * @paramDef {"type":"getTracksDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Sales Pipeline","value":"5700000000000000","note":"Track"}]}
   */
  async getTracksDictionary(payload) {
    const { search } = payload || {}
    const tracks = await this.#apiRequest({ path: '/tracks', method: 'get', logTag: 'getTracksDictionary' })

    const items = (Array.isArray(tracks) ? tracks : [])
      .filter(track => !search || String(track.name || '').toLowerCase().includes(search.toLowerCase()))
      .map(track => ({ label: track.name, value: String(track.id), note: 'Track' }))

    return { items }
  }

  /**
   * @typedef {Object} getMilestonesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Track","name":"pipelineId","dictionary":"getTracksDictionary","description":"Track (pipeline) id to list milestones for. Omit to use the default track."}
   */

  /**
   * @typedef {Object} getMilestonesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to milestone names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused; milestones are returned in a single page)."}
   * @paramDef {"type":"getMilestonesDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Dependency input selecting which track's milestones to return."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Milestones Dictionary
   * @description Lists the milestones for a deal track (pipeline) in your Agile CRM domain. When a track is selected via criteria, its milestones are returned; otherwise the default track's milestones are used. Milestone names are used as-is on deals and are case-sensitive.
   * @category Deals
   * @route POST /get-milestones-dictionary
   * @paramDef {"type":"getMilestonesDictionary__payload","label":"Payload","name":"payload","description":"Search, pagination, and track-dependency input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Prospect","value":"Prospect","note":"Milestone"}]}
   */
  async getMilestonesDictionary(payload) {
    const { search, criteria } = payload || {}
    const pipelineId = criteria?.pipelineId

    const tracks = await this.#apiRequest({ path: '/tracks', method: 'get', logTag: 'getMilestonesDictionary' })
    const list = Array.isArray(tracks) ? tracks : []

    let track
    if (pipelineId) track = list.find(entry => String(entry.id) === String(pipelineId))
    if (!track) track = list.find(entry => entry.is_default) || list[0]

    // Agile returns a track's milestones as a comma-separated string.
    const milestones = String(track?.milestones || '')
      .split(',')
      .map(name => name.trim())
      .filter(Boolean)

    const items = milestones
      .filter(name => !search || name.toLowerCase().includes(search.toLowerCase()))
      .map(name => ({ label: name, value: name, note: 'Milestone' }))

    return { items }
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Normalizes Agile's list responses into { items, cursor }. Agile returns the
   * next cursor on the last element of the array.
   */
  #paginate(result) {
    const list = Array.isArray(result) ? result : []
    const items = list.map(item => this.#flattenProperties(item))
    const cursor = list.length ? list[list.length - 1].cursor : undefined

    return cursor ? { items, cursor } : { items }
  }
}

Flowrunner.ServerCode.addService(AgileCRM, [
  {
    name: 'domain',
    displayName: 'Subdomain',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Agile CRM subdomain, e.g. "yourcompany" from yourcompany.agilecrm.com',
  },
  {
    name: 'email',
    displayName: 'Account Email',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Agile CRM account email address.',
  },
  {
    name: 'apiKey',
    displayName: 'REST API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Agile CRM -> Admin Settings -> API & Analytics -> REST API key.',
  },
])
