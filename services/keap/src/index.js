const logger = {
  info: (...args) => console.log('[Keap Service] info:', ...args),
  debug: (...args) => console.log('[Keap Service] debug:', ...args),
  error: (...args) => console.log('[Keap Service] error:', ...args),
  warn: (...args) => console.log('[Keap Service] warn:', ...args),
}

// Keap (formerly Infusionsoft) REST API.
// v1 is the primary/most complete surface. A small number of resources also expose a v2
// surface (/crm/rest/v2). We use v1 throughout and note v2 where it is the modern equivalent.
const API_BASE_V1 = 'https://api.infusionsoft.com/crm/rest/v1'

// REST Hook subscriptions (webhooks) live on the account-wide /hooks resource.
// A subscription is created per event key (e.g. contact.add) with a hookUrl target; Keap then
// POSTs matching events to that URL. On subscribe, Keap performs a verification handshake: it
// sends an X-Hook-Secret header which the target must echo back to confirm ownership.
const HOOKS_BASE = `${ API_BASE_V1 }/hooks`

// Human-readable dropdown labels mapped to the raw Keap REST Hook event keys.
const EVENT_LABEL_TO_KEY = {
  'Contact Added': 'contact.add',
  'Contact Updated': 'contact.edit',
  'Contact Deleted': 'contact.delete',
  'Opportunity Added': 'opportunity.add',
  'Opportunity Updated': 'opportunity.edit',
  'Opportunity Deleted': 'opportunity.delete',
  'Order Added': 'order.add',
  'Task Added': 'task.add',
}

const CALL_TYPES = { SHAPE_EVENT: 'SHAPE_EVENT', FILTER_TRIGGER: 'FILTER_TRIGGER' }

/**
 * @integrationName Keap
 * @integrationIcon /icon.png
 * @integrationTriggersScope SINGLE_APP
 */
class KeapService {
  constructor(config) {
    // Personal Access Token (PAT) or Service Account Key created at https://keys.developer.keap.com,
    // OR an OAuth2 access token. All are sent to the REST API as `Authorization: Bearer <token>`.
    this.apiKey = config.apiKey
  }

  // Maps a human-readable dropdown label to its API value. If the value isn't a known label
  // (already an API value, or free text), it is returned unchanged.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ 'Authorization': `Bearer ${ this.apiKey }`, 'Content-Type': 'application/json' })
        .query(query || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      // Keap error bodies expose either a top-level `message` or an XML-RPC style `fault`.
      const message = error.body?.message || error.body?.fault?.message || error.body?.fault || error.message
      logger.error(`${ logTag } - failed: ${ message }`)
      throw new Error(`Keap API error: ${ message }`)
    }
  }

  // ==========================================================================
  //  CONTACTS
  // ==========================================================================
  /**
   * @operationName Create Contact
   * @category Contacts
   * @description Creates a new contact in Keap. Supply names, one or more email addresses (each with a field slot such as EMAIL1), phone numbers, company, addresses and custom field values. Use Duplicate Option to instead upsert (merge into an existing contact) when an email or name matches.
   * @route POST /create-contact
   * @paramDef {"type":"String","label":"Given Name","name":"givenName","description":"The contact's first name."}
   * @paramDef {"type":"String","label":"Family Name","name":"familyName","description":"The contact's last name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"The contact's primary email address. Stored in the EMAIL1 slot."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"The contact's primary phone number. Stored in the PHONE1 slot."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"The name of the company to associate with the contact."}
   * @paramDef {"type":"Object","label":"Address","name":"address","description":"Primary address object, e.g. {\"line1\":\"123 Main St\",\"locality\":\"Denver\",\"region\":\"CO\",\"postal_code\":\"80202\",\"country_code\":\"USA\"}."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Custom field values as {\"<fieldId>\":\"value\"}. Field IDs come from the Keap custom field settings; values are sent as an array of {id,content} entries."}
   * @paramDef {"type":"String","label":"Duplicate Option","name":"duplicateOption","uiComponent":{"type":"DROPDOWN","options":{"values":["Create New","Match Email","Match Email and Name"]}},"description":"How to handle duplicates. 'Create New' always inserts. 'Match Email' / 'Match Email and Name' upsert into an existing contact when a match is found."}
   * @returns {Object}
   * @sampleResult {"id":12345,"given_name":"Jane","family_name":"Doe","email_addresses":[{"email":"jane@example.com","field":"EMAIL1"}],"date_created":"2024-01-15T09:30:00.000Z"}
   */
  async createContact(givenName, familyName, email, phone, companyName, address, customFields, duplicateOption) {
    const body = {}

    if (givenName !== undefined) {
      body.given_name = givenName
    }

    if (familyName !== undefined) {
      body.family_name = familyName
    }

    if (email !== undefined) {
      body.email_addresses = [{ email, field: 'EMAIL1' }]
    }

    if (phone !== undefined) {
      body.phone_numbers = [{ number: phone, field: 'PHONE1' }]
    }

    if (companyName !== undefined) {
      body.company = { company_name: companyName }
    }

    if (address !== undefined) {
      body.addresses = [{ ...address, field: 'BILLING' }]
    }

    if (customFields && typeof customFields === 'object') {
      body.custom_fields = Object.entries(customFields).map(([id, content]) => ({ id: Number(id), content }))
    }

    const query = {}
    const resolvedDuplicate = this.#resolveChoice(duplicateOption, {
      'Create New': undefined,
      'Match Email': 'Email',
      'Match Email and Name': 'EmailAndName',
    })

    if (resolvedDuplicate) {
      query.duplicate_option = resolvedDuplicate
    }

    return this.#apiRequest({ url: `${ API_BASE_V1 }/contacts`, method: 'post', body, query, logTag: 'createContact' })
  }

  /**
   * @operationName Get Contact
   * @category Contacts
   * @description Retrieves a single contact by ID, including names, email addresses, phone numbers, company, addresses, tags and custom fields.
   * @route GET /get-contact
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The numeric ID of the contact to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":12345,"given_name":"Jane","family_name":"Doe","email_addresses":[{"email":"jane@example.com","field":"EMAIL1"}],"tag_ids":[101,102]}
   */
  async getContact(contactId) {
    return this.#apiRequest({ url: `${ API_BASE_V1 }/contacts/${ contactId }`, logTag: 'getContact' })
  }

  /**
   * @operationName List Contacts
   * @category Contacts
   * @description Lists contacts with optional email and given-name filters. Supports paging with limit (max 1000) and offset. Returns a `contacts` array plus a `count` of total matches.
   * @route GET /list-contacts
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Filter to contacts with this exact email address."}
   * @paramDef {"type":"String","label":"Given Name","name":"givenName","description":"Filter to contacts with this first name."}
   * @paramDef {"type":"String","label":"Family Name","name":"familyName","description":"Filter to contacts with this last name."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of contacts to return (default 50, max 1000)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records to skip for pagination (default 0)."}
   * @returns {Object}
   * @sampleResult {"count":1,"contacts":[{"id":12345,"given_name":"Jane","family_name":"Doe","email_addresses":[{"email":"jane@example.com","field":"EMAIL1"}]}]}
   */
  async listContacts(email, givenName, familyName, limit, offset) {
    const query = {}

    if (email !== undefined) {
      query.email = email
    }

    if (givenName !== undefined) {
      query.given_name = givenName
    }

    if (familyName !== undefined) {
      query.family_name = familyName
    }

    if (limit !== undefined) {
      query.limit = limit
    }

    if (offset !== undefined) {
      query.offset = offset
    }

    return this.#apiRequest({ url: `${ API_BASE_V1 }/contacts`, query, logTag: 'listContacts' })
  }

  /**
   * @operationName Update Contact
   * @category Contacts
   * @description Updates an existing contact by ID. Only the fields you supply are changed. Names, primary email/phone, company, address and custom fields can all be updated.
   * @route PATCH /update-contact
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The numeric ID of the contact to update."}
   * @paramDef {"type":"String","label":"Given Name","name":"givenName","description":"New first name."}
   * @paramDef {"type":"String","label":"Family Name","name":"familyName","description":"New last name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New primary email (EMAIL1 slot)."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"New primary phone (PHONE1 slot)."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"New company name to associate."}
   * @paramDef {"type":"Object","label":"Address","name":"address","description":"Primary billing address object to replace the existing one."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Custom field values as {\"<fieldId>\":\"value\"}."}
   * @returns {Object}
   * @sampleResult {"id":12345,"given_name":"Janet","family_name":"Doe","email_addresses":[{"email":"janet@example.com","field":"EMAIL1"}]}
   */
  async updateContact(contactId, givenName, familyName, email, phone, companyName, address, customFields) {
    const body = {}

    if (givenName !== undefined) {
      body.given_name = givenName
    }

    if (familyName !== undefined) {
      body.family_name = familyName
    }

    if (email !== undefined) {
      body.email_addresses = [{ email, field: 'EMAIL1' }]
    }

    if (phone !== undefined) {
      body.phone_numbers = [{ number: phone, field: 'PHONE1' }]
    }

    if (companyName !== undefined) {
      body.company = { company_name: companyName }
    }

    if (address !== undefined) {
      body.addresses = [{ ...address, field: 'BILLING' }]
    }

    if (customFields && typeof customFields === 'object') {
      body.custom_fields = Object.entries(customFields).map(([id, content]) => ({ id: Number(id), content }))
    }

    return this.#apiRequest({ url: `${ API_BASE_V1 }/contacts/${ contactId }`, method: 'patch', body, logTag: 'updateContact' })
  }

  /**
   * @operationName Delete Contact
   * @category Contacts
   * @description Permanently deletes a contact by ID. This cannot be undone.
   * @route DELETE /delete-contact
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The numeric ID of the contact to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"contactId":"12345"}
   */
  async deleteContact(contactId) {
    await this.#apiRequest({ url: `${ API_BASE_V1 }/contacts/${ contactId }`, method: 'delete', logTag: 'deleteContact' })

    return { deleted: true, contactId }
  }

  // ==========================================================================
  //  TAGS
  // ==========================================================================
  /**
   * @operationName List Tags
   * @category Tags
   * @description Lists tags defined in the Keap account. Supports paging with limit and offset. Returns a `tags` array and a total `count`.
   * @route GET /list-tags
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of tags to return (default 50, max 1000)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records to skip for pagination (default 0)."}
   * @returns {Object}
   * @sampleResult {"count":1,"tags":[{"id":101,"name":"Newsletter","description":"Newsletter subscribers","category":{"id":5,"name":"Marketing"}}]}
   */
  async listTags(limit, offset) {
    const query = {}

    if (limit !== undefined) {
      query.limit = limit
    }

    if (offset !== undefined) {
      query.offset = offset
    }

    return this.#apiRequest({ url: `${ API_BASE_V1 }/tags`, query, logTag: 'listTags' })
  }

  /**
   * @operationName Create Tag
   * @category Tags
   * @description Creates a new tag. Optionally place it in a tag category by ID.
   * @route POST /create-tag
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the new tag."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Optional description of the tag."}
   * @paramDef {"type":"String","label":"Category ID","name":"categoryId","description":"Optional tag category ID to file the tag under."}
   * @returns {Object}
   * @sampleResult {"id":101,"name":"Newsletter","description":"Newsletter subscribers","category":{"id":5}}
   */
  async createTag(name, description, categoryId) {
    const body = { name }

    if (description !== undefined) {
      body.description = description
    }

    if (categoryId !== undefined) {
      body.category = { id: Number(categoryId) }
    }

    return this.#apiRequest({ url: `${ API_BASE_V1 }/tags`, method: 'post', body, logTag: 'createTag' })
  }

  /**
   * @operationName Apply Tag to Contact
   * @category Tags
   * @description Applies one or more tags to a contact. Pass the contact ID and a list of tag IDs.
   * @route POST /apply-tag
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The contact to tag."}
   * @paramDef {"type":"Array<String>","label":"Tag IDs","name":"tagIds","required":true,"description":"List of tag IDs to apply to the contact."}
   * @returns {Object}
   * @sampleResult {"contactId":"12345","tagIds":["101","102"],"applied":true}
   */
  async applyTagToContact(contactId, tagIds) {
    const ids = (tagIds || []).map(id => Number(id))

    await this.#apiRequest({
      url: `${ API_BASE_V1 }/contacts/${ contactId }/tags`,
      method: 'post',
      body: { tagIds: ids },
      logTag: 'applyTagToContact',
    })

    return { contactId, tagIds, applied: true }
  }

  /**
   * @operationName Remove Tag from Contact
   * @category Tags
   * @description Removes a single tag from a contact.
   * @route DELETE /remove-tag
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The contact to remove the tag from."}
   * @paramDef {"type":"String","label":"Tag ID","name":"tagId","required":true,"description":"The tag ID to remove."}
   * @returns {Object}
   * @sampleResult {"contactId":"12345","tagId":"101","removed":true}
   */
  async removeTagFromContact(contactId, tagId) {
    await this.#apiRequest({
      url: `${ API_BASE_V1 }/contacts/${ contactId }/tags/${ tagId }`,
      method: 'delete',
      logTag: 'removeTagFromContact',
    })

    return { contactId, tagId, removed: true }
  }

  // ==========================================================================
  //  COMPANIES
  // ==========================================================================
  /**
   * @operationName Create Company
   * @category Companies
   * @description Creates a new company record. The company name is required; email, phone, website and address are optional.
   * @route POST /create-company
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","required":true,"description":"The name of the company."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Company email address (EMAIL1 slot)."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Company phone number (PHONE1 slot)."}
   * @paramDef {"type":"String","label":"Website","name":"website","description":"Company website URL."}
   * @paramDef {"type":"Object","label":"Address","name":"address","description":"Company address object, e.g. {\"line1\":\"123 Main St\",\"locality\":\"Denver\",\"region\":\"CO\",\"postal_code\":\"80202\",\"country_code\":\"USA\"}."}
   * @returns {Object}
   * @sampleResult {"id":555,"company_name":"Acme Inc","email_address":"info@acme.com","website":"https://acme.com"}
   */
  async createCompany(companyName, email, phone, website, address) {
    const body = { company_name: companyName }

    if (email !== undefined) {
      body.email_address = email
    }

    if (phone !== undefined) {
      body.phone_number = { number: phone, field: 'PHONE1' }
    }

    if (website !== undefined) {
      body.website = website
    }

    if (address !== undefined) {
      body.address = address
    }

    return this.#apiRequest({ url: `${ API_BASE_V1 }/companies`, method: 'post', body, logTag: 'createCompany' })
  }

  /**
   * @operationName Get Company
   * @category Companies
   * @description Retrieves a single company by ID.
   * @route GET /get-company
   * @paramDef {"type":"String","label":"Company ID","name":"companyId","required":true,"description":"The numeric ID of the company to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":555,"company_name":"Acme Inc","email_address":"info@acme.com"}
   */
  async getCompany(companyId) {
    return this.#apiRequest({ url: `${ API_BASE_V1 }/companies/${ companyId }`, logTag: 'getCompany' })
  }

  /**
   * @operationName List Companies
   * @category Companies
   * @description Lists companies with an optional company-name filter and paging via limit and offset.
   * @route GET /list-companies
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"Filter to companies whose name matches this value."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of companies to return (default 50, max 1000)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records to skip for pagination (default 0)."}
   * @returns {Object}
   * @sampleResult {"count":1,"companies":[{"id":555,"company_name":"Acme Inc","email_address":"info@acme.com"}]}
   */
  async listCompanies(companyName, limit, offset) {
    const query = {}

    if (companyName !== undefined) {
      query.company_name = companyName
    }

    if (limit !== undefined) {
      query.limit = limit
    }

    if (offset !== undefined) {
      query.offset = offset
    }

    return this.#apiRequest({ url: `${ API_BASE_V1 }/companies`, query, logTag: 'listCompanies' })
  }

  /**
   * @operationName Update Company
   * @category Companies
   * @description Updates an existing company by ID. Only supplied fields are changed.
   * @route PATCH /update-company
   * @paramDef {"type":"String","label":"Company ID","name":"companyId","required":true,"description":"The numeric ID of the company to update."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"New company name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New company email address."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"New company phone number."}
   * @paramDef {"type":"String","label":"Website","name":"website","description":"New company website URL."}
   * @paramDef {"type":"Object","label":"Address","name":"address","description":"New company address object."}
   * @returns {Object}
   * @sampleResult {"id":555,"company_name":"Acme Corporation","website":"https://acme.com"}
   */
  async updateCompany(companyId, companyName, email, phone, website, address) {
    const body = {}

    if (companyName !== undefined) {
      body.company_name = companyName
    }

    if (email !== undefined) {
      body.email_address = email
    }

    if (phone !== undefined) {
      body.phone_number = { number: phone, field: 'PHONE1' }
    }

    if (website !== undefined) {
      body.website = website
    }

    if (address !== undefined) {
      body.address = address
    }

    return this.#apiRequest({ url: `${ API_BASE_V1 }/companies/${ companyId }`, method: 'patch', body, logTag: 'updateCompany' })
  }

  // ==========================================================================
  //  OPPORTUNITIES
  // ==========================================================================
  /**
   * @operationName Create Opportunity
   * @category Opportunities
   * @description Creates a sales opportunity linked to a contact and placed in a pipeline stage. Title, contact ID and stage ID are required; user (owner) and projected revenue are optional.
   * @route POST /create-opportunity
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The opportunity title / name."}
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The ID of the contact this opportunity belongs to."}
   * @paramDef {"type":"String","label":"Stage ID","name":"stageId","required":true,"dictionary":"getOpportunityStagesDictionary","description":"The pipeline stage ID for the opportunity. Use the stages dictionary to pick one."}
   * @paramDef {"type":"String","label":"Owner User ID","name":"userId","description":"The ID of the Keap user who owns this opportunity."}
   * @paramDef {"type":"Number","label":"Projected Revenue Low","name":"projectedRevenueLow","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Low end of projected revenue for this opportunity."}
   * @paramDef {"type":"Number","label":"Projected Revenue High","name":"projectedRevenueHigh","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"High end of projected revenue for this opportunity."}
   * @returns {Object}
   * @sampleResult {"id":900,"opportunity_title":"New Deal","contact":{"id":12345},"stage":{"id":2,"name":"Qualified"}}
   */
  async createOpportunity(title, contactId, stageId, userId, projectedRevenueLow, projectedRevenueHigh) {
    const body = {
      opportunity_title: title,
      contact: { id: Number(contactId) },
      stage: { id: Number(stageId) },
    }

    if (userId !== undefined) {
      body.user = { id: Number(userId) }
    }

    if (projectedRevenueLow !== undefined) {
      body.projected_revenue_low = projectedRevenueLow
    }

    if (projectedRevenueHigh !== undefined) {
      body.projected_revenue_high = projectedRevenueHigh
    }

    return this.#apiRequest({ url: `${ API_BASE_V1 }/opportunities`, method: 'post', body, logTag: 'createOpportunity' })
  }

  /**
   * @operationName Get Opportunity
   * @category Opportunities
   * @description Retrieves a single opportunity by ID, including its contact, stage and projected revenue.
   * @route GET /get-opportunity
   * @paramDef {"type":"String","label":"Opportunity ID","name":"opportunityId","required":true,"description":"The numeric ID of the opportunity to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":900,"opportunity_title":"New Deal","contact":{"id":12345},"stage":{"id":2,"name":"Qualified"}}
   */
  async getOpportunity(opportunityId) {
    return this.#apiRequest({ url: `${ API_BASE_V1 }/opportunities/${ opportunityId }`, logTag: 'getOpportunity' })
  }

  /**
   * @operationName List Opportunities
   * @category Opportunities
   * @description Lists opportunities with optional stage-ID and user-ID filters and paging via limit and offset.
   * @route GET /list-opportunities
   * @paramDef {"type":"String","label":"Stage ID","name":"stageId","dictionary":"getOpportunityStagesDictionary","description":"Filter to opportunities in this pipeline stage."}
   * @paramDef {"type":"String","label":"Owner User ID","name":"userId","description":"Filter to opportunities owned by this Keap user."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of opportunities to return (default 50, max 1000)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records to skip for pagination (default 0)."}
   * @returns {Object}
   * @sampleResult {"count":1,"opportunities":[{"id":900,"opportunity_title":"New Deal","stage":{"id":2,"name":"Qualified"}}]}
   */
  async listOpportunities(stageId, userId, limit, offset) {
    const query = {}

    if (stageId !== undefined) {
      query.stage_id = stageId
    }

    if (userId !== undefined) {
      query.user_id = userId
    }

    if (limit !== undefined) {
      query.limit = limit
    }

    if (offset !== undefined) {
      query.offset = offset
    }

    return this.#apiRequest({ url: `${ API_BASE_V1 }/opportunities`, query, logTag: 'listOpportunities' })
  }

  /**
   * @operationName Update Opportunity
   * @category Opportunities
   * @description Updates an existing opportunity by ID. Only supplied fields are changed; commonly used to move an opportunity to a new stage.
   * @route PATCH /update-opportunity
   * @paramDef {"type":"String","label":"Opportunity ID","name":"opportunityId","required":true,"description":"The numeric ID of the opportunity to update."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New opportunity title."}
   * @paramDef {"type":"String","label":"Stage ID","name":"stageId","dictionary":"getOpportunityStagesDictionary","description":"Move the opportunity to this pipeline stage."}
   * @paramDef {"type":"String","label":"Owner User ID","name":"userId","description":"Reassign the opportunity to this Keap user."}
   * @returns {Object}
   * @sampleResult {"id":900,"opportunity_title":"New Deal","stage":{"id":3,"name":"Proposal Sent"}}
   */
  async updateOpportunity(opportunityId, title, stageId, userId) {
    const body = {}

    if (title !== undefined) {
      body.opportunity_title = title
    }

    if (stageId !== undefined) {
      body.stage = { id: Number(stageId) }
    }

    if (userId !== undefined) {
      body.user = { id: Number(userId) }
    }

    return this.#apiRequest({ url: `${ API_BASE_V1 }/opportunities/${ opportunityId }`, method: 'patch', body, logTag: 'updateOpportunity' })
  }

  // ==========================================================================
  //  ORDERS & PRODUCTS
  // ==========================================================================
  /**
   * @operationName List Orders
   * @category Orders & Products
   * @description Lists e-commerce orders with optional contact-ID filter, paid/unpaid filter, and paging via limit and offset.
   * @route GET /list-orders
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","description":"Filter to orders belonging to this contact."}
   * @paramDef {"type":"Boolean","label":"Paid Only","name":"paid","uiComponent":{"type":"TOGGLE"},"description":"When true, return only paid orders."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of orders to return (default 50, max 1000)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records to skip for pagination (default 0)."}
   * @returns {Object}
   * @sampleResult {"count":1,"orders":[{"id":700,"title":"Order #700","total":"49.99","status":"PAID","contact":{"id":12345}}]}
   */
  async listOrders(contactId, paid, limit, offset) {
    const query = {}

    if (contactId !== undefined) {
      query.contact_id = contactId
    }

    if (paid !== undefined) {
      query.paid = paid
    }

    if (limit !== undefined) {
      query.limit = limit
    }

    if (offset !== undefined) {
      query.offset = offset
    }

    return this.#apiRequest({ url: `${ API_BASE_V1 }/orders`, query, logTag: 'listOrders' })
  }

  /**
   * @operationName Get Order
   * @category Orders & Products
   * @description Retrieves a single order by ID, including line items, totals and payment status.
   * @route GET /get-order
   * @paramDef {"type":"String","label":"Order ID","name":"orderId","required":true,"description":"The numeric ID of the order to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":700,"title":"Order #700","total":"49.99","status":"PAID","order_items":[{"id":1,"name":"Pro Plan","quantity":1}]}
   */
  async getOrder(orderId) {
    return this.#apiRequest({ url: `${ API_BASE_V1 }/orders/${ orderId }`, logTag: 'getOrder' })
  }

  /**
   * @operationName List Products
   * @category Orders & Products
   * @description Lists products in the Keap store. Optionally include inactive products. Supports paging via limit and offset.
   * @route GET /list-products
   * @paramDef {"type":"Boolean","label":"Active Only","name":"activeOnly","uiComponent":{"type":"TOGGLE"},"description":"When true, exclude inactive products (default returns all)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of products to return (default 50, max 1000)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records to skip for pagination (default 0)."}
   * @returns {Object}
   * @sampleResult {"count":1,"products":[{"id":10,"product_name":"Pro Plan","product_price":49.99,"active":true}]}
   */
  async listProducts(activeOnly, limit, offset) {
    const query = {}

    if (activeOnly !== undefined) {
      query.active = activeOnly
    }

    if (limit !== undefined) {
      query.limit = limit
    }

    if (offset !== undefined) {
      query.offset = offset
    }

    return this.#apiRequest({ url: `${ API_BASE_V1 }/products`, query, logTag: 'listProducts' })
  }

  // ==========================================================================
  //  NOTES & TASKS
  // ==========================================================================
  /**
   * @operationName Create Note
   * @category Notes & Tasks
   * @description Creates a note attached to a contact. Provide a title, body and note type (Call, Email, Fax, Letter, Other).
   * @route POST /create-note
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The contact the note is attached to."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"The note title / subject."}
   * @paramDef {"type":"String","label":"Body","name":"body","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The note text."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Call","Email","Fax","Letter","Other"]}},"description":"The kind of note."}
   * @returns {Object}
   * @sampleResult {"id":800,"title":"Follow-up call","body":"Discussed pricing","type":"Call","contact_id":12345}
   */
  async createNote(contactId, title, body, type) {
    const payload = { contact_id: Number(contactId) }

    if (title !== undefined) {
      payload.title = title
    }

    if (body !== undefined) {
      payload.body = body
    }

    const resolvedType = this.#resolveChoice(type, {
      Call: 'Call',
      Email: 'Email',
      Fax: 'Fax',
      Letter: 'Letter',
      Other: 'Other',
    })

    if (resolvedType !== undefined) {
      payload.type = resolvedType
    }

    return this.#apiRequest({ url: `${ API_BASE_V1 }/notes`, method: 'post', body: payload, logTag: 'createNote' })
  }

  /**
   * @operationName Create Task
   * @category Notes & Tasks
   * @description Creates a task, optionally linked to a contact and given a due date. Provide a title and optional description.
   * @route POST /create-task
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The task title."}
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","description":"The contact the task relates to."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"When the task is due, in ISO 8601 format (e.g. 2024-02-01T17:00:00.000Z)."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional task description / notes."}
   * @returns {Object}
   * @sampleResult {"id":600,"title":"Call Jane","due_date":"2024-02-01T17:00:00.000Z","contact":{"id":12345},"completed":false}
   */
  async createTask(title, contactId, dueDate, description) {
    const body = { title }

    if (contactId !== undefined) {
      body.contact = { id: Number(contactId) }
    }

    if (dueDate !== undefined) {
      body.due_date = dueDate
    }

    if (description !== undefined) {
      body.description = description
    }

    return this.#apiRequest({ url: `${ API_BASE_V1 }/tasks`, method: 'post', body, logTag: 'createTask' })
  }

  /**
   * @operationName List Tasks
   * @category Notes & Tasks
   * @description Lists tasks with optional contact-ID filter, completion status filter, and paging via limit and offset.
   * @route GET /list-tasks
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","description":"Filter to tasks for this contact."}
   * @paramDef {"type":"Boolean","label":"Completed","name":"completed","uiComponent":{"type":"TOGGLE"},"description":"When set, filter tasks by completion state."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of tasks to return (default 50, max 1000)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records to skip for pagination (default 0)."}
   * @returns {Object}
   * @sampleResult {"count":1,"tasks":[{"id":600,"title":"Call Jane","completed":false,"due_date":"2024-02-01T17:00:00.000Z"}]}
   */
  async listTasks(contactId, completed, limit, offset) {
    const query = {}

    if (contactId !== undefined) {
      query.contact_id = contactId
    }

    if (completed !== undefined) {
      query.completed = completed
    }

    if (limit !== undefined) {
      query.limit = limit
    }

    if (offset !== undefined) {
      query.offset = offset
    }

    return this.#apiRequest({ url: `${ API_BASE_V1 }/tasks`, query, logTag: 'listTasks' })
  }

  // ==========================================================================
  //  CAMPAIGNS
  // ==========================================================================
  /**
   * @operationName List Campaigns
   * @category Campaigns
   * @description Lists marketing campaigns in the Keap account. Supports paging via limit and offset. Returns a `campaigns` array and total `count`.
   * @route GET /list-campaigns
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of campaigns to return (default 50, max 1000)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records to skip for pagination (default 0)."}
   * @returns {Object}
   * @sampleResult {"count":1,"campaigns":[{"id":300,"name":"Welcome Sequence","active_contact_count":42}]}
   */
  async listCampaigns(limit, offset) {
    const query = {}

    if (limit !== undefined) {
      query.limit = limit
    }

    if (offset !== undefined) {
      query.offset = offset
    }

    return this.#apiRequest({ url: `${ API_BASE_V1 }/campaigns`, query, logTag: 'listCampaigns' })
  }

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================
  /**
   * @typedef {Object} getTagsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to tag names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (numeric offset) returned by a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tags Dictionary
   * @description Lists tags for selection in dependent parameters. Returns id/name pairs with the tag category as a note.
   * @route POST /get-tags-dictionary
   * @paramDef {"type":"getTagsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Newsletter","value":"101","note":"Marketing"}],"cursor":"50"}
   */
  async getTagsDictionary(payload) {
    const { search, cursor } = payload || {}
    const offset = cursor ? Number(cursor) : 0
    const limit = 50
    const response = await this.#apiRequest({
      url: `${ API_BASE_V1 }/tags`,
      query: { limit, offset },
      logTag: 'getTagsDictionary',
    })

    let tags = response.tags || []

    if (search) {
      const needle = search.toLowerCase()
      tags = tags.filter(tag => (tag.name || '').toLowerCase().includes(needle))
    }

    const items = tags.map(tag => ({
      label: tag.name,
      value: String(tag.id),
      note: tag.category?.name || undefined,
    }))

    return { items, cursor: tags.length === limit ? String(offset + limit) : undefined }
  }

  /**
   * @typedef {Object} getProductsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to product names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (numeric offset) returned by a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Products Dictionary
   * @description Lists products for selection in dependent parameters. Returns id/name pairs with the price as a note.
   * @route POST /get-products-dictionary
   * @paramDef {"type":"getProductsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Pro Plan","value":"10","note":"$49.99"}],"cursor":"50"}
   */
  async getProductsDictionary(payload) {
    const { search, cursor } = payload || {}
    const offset = cursor ? Number(cursor) : 0
    const limit = 50
    const response = await this.#apiRequest({
      url: `${ API_BASE_V1 }/products`,
      query: { limit, offset },
      logTag: 'getProductsDictionary',
    })

    let products = response.products || []

    if (search) {
      const needle = search.toLowerCase()
      products = products.filter(product => (product.product_name || '').toLowerCase().includes(needle))
    }

    const items = products.map(product => ({
      label: product.product_name,
      value: String(product.id),
      note: product.product_price !== undefined ? `$${ product.product_price }` : undefined,
    }))

    return { items, cursor: products.length === limit ? String(offset + limit) : undefined }
  }

  /**
   * @typedef {Object} getCampaignsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to campaign names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (numeric offset) returned by a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Campaigns Dictionary
   * @description Lists marketing campaigns for selection in dependent parameters. Returns id/name pairs.
   * @route POST /get-campaigns-dictionary
   * @paramDef {"type":"getCampaignsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Welcome Sequence","value":"300","note":"42 active contacts"}],"cursor":"50"}
   */
  async getCampaignsDictionary(payload) {
    const { search, cursor } = payload || {}
    const offset = cursor ? Number(cursor) : 0
    const limit = 50
    const response = await this.#apiRequest({
      url: `${ API_BASE_V1 }/campaigns`,
      query: { limit, offset },
      logTag: 'getCampaignsDictionary',
    })

    let campaigns = response.campaigns || []

    if (search) {
      const needle = search.toLowerCase()
      campaigns = campaigns.filter(campaign => (campaign.name || '').toLowerCase().includes(needle))
    }

    const items = campaigns.map(campaign => ({
      label: campaign.name,
      value: String(campaign.id),
      note: campaign.active_contact_count !== undefined ? `${ campaign.active_contact_count } active contacts` : undefined,
    }))

    return { items, cursor: campaigns.length === limit ? String(offset + limit) : undefined }
  }

  /**
   * @typedef {Object} getOpportunityStagesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to stage names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Stages are returned in a single call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Opportunity Stages Dictionary
   * @description Lists opportunity pipeline stages for selection in dependent parameters. Reads /opportunity/stage_pipeline and flattens each pipeline's stages into id/name pairs, with the parent pipeline as a note.
   * @route POST /get-opportunity-stages-dictionary
   * @paramDef {"type":"getOpportunityStagesDictionary__payload","label":"Payload","name":"payload","description":"Search input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Qualified","value":"2","note":"Sales Pipeline"}],"cursor":null}
   */
  async getOpportunityStagesDictionary(payload) {
    const { search } = payload || {}
    const pipelines = await this.#apiRequest({
      url: `${ API_BASE_V1 }/opportunity/stage_pipeline`,
      logTag: 'getOpportunityStagesDictionary',
    })

    const items = []

    for (const pipeline of pipelines || []) {
      for (const stage of pipeline.stages || []) {
        items.push({ label: stage.stage_name || stage.name, value: String(stage.id), note: pipeline.name })
      }
    }

    const filtered = search
      ? items.filter(item => (item.label || '').toLowerCase().includes(search.toLowerCase()))
      : items

    return { items: filtered, cursor: null }
  }

  // ==========================================================================
  //  REALTIME TRIGGER (SINGLE_APP — Keap REST Hooks)
  // ==========================================================================
  /**
   * @operationName On Keap Event
   * @category Triggers
   * @description Fires when a chosen account-wide Keap event occurs — a contact is added, updated or deleted; an opportunity is added, updated or deleted; an order is added; or a task is added. Keap registers a REST Hook subscription for the selected event key and delivers matching events to this flow.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-keap-event
   * @paramDef {"type":"String","label":"Event","name":"event","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Contact Added","Contact Updated","Contact Deleted","Opportunity Added","Opportunity Updated","Opportunity Deleted","Order Added","Task Added"]}},"description":"Which Keap account event fires this trigger."}
   * @returns {Object}
   * @sampleResult {"eventKey":"contact.add","objectType":"contact","objectKeys":[{"apiUrl":"contacts/12345","id":12345,"timestamp":"2024-01-15T09:30:00.000Z"}]}
   */
  onKeapEvent(callType, payload) {
    if (callType === CALL_TYPES.SHAPE_EVENT) {
      return [{ name: 'onKeapEvent', data: this.#shapeKeapEvent(payload) }]
    }

    if (callType === CALL_TYPES.FILTER_TRIGGER) {
      return {
        ids: this.#matchTriggers(payload, (trigger, event) =>
          this.#resolveChoice(trigger.data.event, EVENT_LABEL_TO_KEY) === event.eventKey),
      }
    }
  }

  // Normalizes a Keap REST Hook delivery body into a stable shape.
  #shapeKeapEvent(body) {
    const eventKey = body.event_key || body.eventKey
    const objectType = String(eventKey || '').split('.')[0]

    return {
      eventKey,
      objectType,
      objectKeys: body.object_keys || body.objectKeys || [],
    }
  }

  // FILTER_TRIGGER payload carries the shaped eventData (under .data) and the registered triggers.
  #matchTriggers(payload, predicate) {
    const eventData = payload.eventData || payload.data || {}
    const event = { eventKey: eventData.eventKey }

    return (payload.triggers || [])
      .filter(trigger => predicate(trigger, event))
      .map(trigger => trigger.id)
  }

  // ── SYSTEM trigger handlers (SINGLE_APP) ───────────────────────────────
  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerUpsertWebhook
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    logger.debug(`handleTriggerUpsertWebhook.invocation: ${ JSON.stringify(invocation) }`)

    const hookUrl = `${ invocation.callbackUrl }${ invocation.callbackUrl.includes('?') ? '&' : '?' }connectionId=${ invocation.connectionId }`
    const hooks = []

    for (const event of invocation.events || []) {
      const data = event.triggerData || {}
      const eventKey = this.#resolveChoice(data.event, EVENT_LABEL_TO_KEY)

      // Keap creates a REST Hook subscription per event key. It responds with a `key` (subscription
      // id) and initial `status` (usually "Unverified" until the X-Hook-Secret handshake completes,
      // which is handled in handleTriggerResolveEvents on the first delivery).
      const created = await this.#apiRequest({
        url: HOOKS_BASE,
        method: 'post',
        body: { eventKey, hookUrl },
        logTag: 'createHook',
      })

      hooks.push({ triggerId: event.id, hookKey: created?.key, eventKey })
    }

    return { webhookData: { hooks }, connectionId: invocation.connectionId }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerResolveEvents
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    logger.debug('handleTriggerResolveEvents invoked')

    const headers = invocation?.headers || {}
    // Header names can arrive in varying case; normalize the one we need.
    const hookSecret = headers['x-hook-secret'] || headers['X-Hook-Secret'] || headers['X-HOOK-SECRET']

    // REST Hook verification handshake: on subscription Keap sends an X-Hook-Secret header that must
    // be echoed back verbatim to confirm we own the endpoint. There is no event payload in this call.
    if (hookSecret) {
      logger.debug('handleTriggerResolveEvents: responding to X-Hook-Secret verification handshake')

      return {
        handshake: true,
        responseHeaders: { 'X-Hook-Secret': hookSecret },
        responseToExternalService: invocation?.body || {},
      }
    }

    if (!invocation || !invocation.body) {
      return { connectionId: invocation?.queryParams?.connectionId, events: [] }
    }

    const events = this.onKeapEvent(CALL_TYPES.SHAPE_EVENT, invocation.body)

    return { connectionId: invocation.queryParams?.connectionId, events }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerSelectMatched
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    logger.debug(`handleTriggerSelectMatched.${ invocation.eventName }`)

    return this[invocation.eventName](CALL_TYPES.FILTER_TRIGGER, invocation)
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerDeleteWebhook
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerDeleteWebhook(invocation) {
    logger.debug('handleTriggerDeleteWebhook invoked')

    const hooks = invocation.webhookData?.hooks || []

    for (const hook of hooks) {
      if (!hook.hookKey) {
        continue
      }

      try {
        await this.#apiRequest({
          url: `${ HOOKS_BASE }/${ hook.hookKey }`,
          method: 'delete',
          logTag: 'deleteHook',
        })
      } catch (error) {
        logger.warn(`handleTriggerDeleteWebhook: failed to delete hook ${ hook.hookKey }: ${ error?.message }`)
      }
    }

    return { webhookData: {} }
  }
}

Flowrunner.ServerCode.addService(KeapService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'In Keap, create a Personal Access Token (PAT) or Service Account Key at https://keys.developer.keap.com, OR use an OAuth2 access token. It is sent to the REST API as Authorization: Bearer.',
  },
])
