// ============================================================================
//  ActiveCampaign — FlowRunner extension service
//  API: ActiveCampaign v3 (https://developers.activecampaign.com/reference)
//  Auth: account API URL + API key (Api-Token header)
//  Triggers: REALTIME (SINGLE_APP) — one ActiveCampaign webhook per registered
//  trigger. Webhook deliveries arrive form-encoded (application/x-www-form-
//  urlencoded with bracketed keys); handleTriggerResolveEvents normalizes both
//  form-encoded and JSON bodies before shaping.
// ============================================================================

const logger = {
  info: (...args) => console.log('[ActiveCampaign] info:', ...args),
  debug: (...args) => console.log('[ActiveCampaign] debug:', ...args),
  error: (...args) => console.log('[ActiveCampaign] error:', ...args),
  warn: (...args) => console.log('[ActiveCampaign] warn:', ...args),
}

const CALL_TYPES = {
  SHAPE_EVENT: 'SHAPE_EVENT',
  FILTER_TRIGGER: 'FILTER_TRIGGER',
}

// Maps the friendly Event dropdown label (shown in the UI) to the ActiveCampaign
// webhook event name sent to POST /webhooks and matched against inbound deliveries.
// docs: https://developers.activecampaign.com/reference/webhooks
const EVENT_LABEL_TO_VALUE = {
  'Contact Added': 'subscribe',
  'Contact Updated': 'update',
  'Contact Tag Added': 'contact_tag_added',
  'Contact Tag Removed': 'contact_tag_removed',
  'Contact Unsubscribed': 'unsubscribe',
  'Deal Added': 'deal_add',
  'Deal Updated': 'deal_update',
  'Campaign Opened': 'open',
  'Link Clicked': 'click',
}

// All webhook sources ActiveCampaign supports, so the trigger fires no matter
// how the change was made (contact action, admin UI, API call, or automation/system).
const WEBHOOK_SOURCES = ['public', 'admin', 'api', 'system']

// Contact list-filter statuses (GET /contacts ?status=).
const CONTACT_STATUS_LABEL_TO_VALUE = {
  'Any': '-1',
  'Unconfirmed': '0',
  'Active': '1',
  'Unsubscribed': '2',
  'Bounced': '3',
}

// Deal statuses (create/update and list filter).
const DEAL_STATUS_LABEL_TO_VALUE = {
  'Open': '0',
  'Won': '1',
  'Lost': '2',
}

// Campaign statuses (GET /campaigns ?filters[status]=).
const CAMPAIGN_STATUS_LABEL_TO_VALUE = {
  'Draft': '0',
  'Scheduled': '1',
  'Sending': '2',
  'Paused': '3',
  'Stopped': '4',
  'Completed': '5',
}

// List subscription statuses (POST /contactLists).
const LIST_STATUS_LABEL_TO_VALUE = {
  'Subscribe': '1',
  'Unsubscribe': '2',
}

// ============================================================================
//  DICTIONARY PAYLOAD TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} getTagsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter tags by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for the next page of results."}
 */

/**
 * @typedef {Object} getListsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter lists by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for the next page of results."}
 */

/**
 * @typedef {Object} getFieldsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter custom fields by title."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for the next page of results."}
 */

/**
 * @typedef {Object} getPipelinesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter pipelines by title."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for the next page of results."}
 */

/**
 * @typedef {Object} getStagesDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Pipeline","name":"pipelineId","description":"The pipeline (deal group) whose stages populate the list."}
 */

/**
 * @typedef {Object} getStagesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter stages by title."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for the next page of results."}
 * @paramDef {"type":"getStagesDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The pipeline whose stages to list."}
 */

/**
 * @typedef {Object} getAutomationsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter automations by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for the next page of results."}
 */

/**
 * @integrationName ActiveCampaign
 * @integrationIcon /icon.webp
 * @integrationTriggersScope SINGLE_APP
 */
class ActiveCampaign {
  constructor(config) {
    this.config = config || {}
    this.apiKey = this.config.apiKey
    this.baseUrl = `${ String(this.config.apiUrl || '').trim().replace(/\/+$/, '') }/api/3`
  }

  // ==========================================================================
  //  CORE — every external call goes through #apiRequest
  // ==========================================================================
  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const url = `${ this.baseUrl }${ path }`

    try {
      logger.debug(`${ logTag } ${ method.toUpperCase() } ${ url }`)

      const request = Flowrunner.Request[method](url)
        .set({ 'Api-Token': this.apiKey, 'Content-Type': 'application/json' })
        .query(query || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const errors = error?.body?.errors
      const message = Array.isArray(errors) && errors.length
        ? errors.map(item => item.title || item.error || JSON.stringify(item)).join('; ')
        : error?.body?.message || error?.message || 'Request failed'

      logger.error(`${ logTag } failed: ${ message }`)

      throw new Error(`ActiveCampaign API error: ${ message }`)
    }
  }

  // Maps a friendly dropdown label to its ActiveCampaign API value. Unmapped
  // values pass through unchanged so raw API values keep working.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Drops undefined/null/'' entries so optional params never overwrite values.
  #compact(object) {
    const result = {}

    for (const [key, value] of Object.entries(object)) {
      if (value !== undefined && value !== null && value !== '') {
        result[key] = value
      }
    }

    return result
  }

  // Converts a { fieldId: value } object into the fieldValues array
  // ActiveCampaign expects on contact create/update.
  #toFieldValues(customFields) {
    if (!customFields || typeof customFields !== 'object' || Array.isArray(customFields)) {
      return undefined
    }

    const fieldValues = Object.entries(customFields).map(([field, value]) => ({ field, value }))

    return fieldValues.length ? fieldValues : undefined
  }

  // Offset-based pagination cursor for dictionaries: returns the next offset
  // while more records remain, or null when the page is the last one.
  #nextOffsetCursor(meta, offset, pageSize, receivedCount) {
    const total = Number(meta?.total)

    if (Number.isFinite(total)) {
      const next = offset + pageSize

      return next < total ? String(next) : null
    }

    return receivedCount === pageSize ? String(offset + pageSize) : null
  }

  // ==========================================================================
  //  CONTACTS
  // ==========================================================================
  /**
   * @operationName Sync Contact
   * @category Contacts
   * @description Creates a contact or updates the existing one matched by email address (upsert). Sets name, phone, and any custom field values in a single call. Use this as the default way to push contacts into ActiveCampaign without worrying about duplicates.
   * @route POST /sync-contact
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"The contact's email address. Used to match an existing contact; if none exists a new contact is created."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"The contact's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"The contact's last name."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"The contact's phone number."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Custom field values as an object of field ID to value, e.g. {\"1\":\"Blue\",\"2\":\"2024-01-15\"}. Use List Fields or the field dictionary to find field IDs. Multi-value fields use ||-delimited values, e.g. ||Option 1||Option 2||."}
   * @returns {Object}
   * @sampleResult {"id":"113","email":"jane@example.com","firstName":"Jane","lastName":"Doe","phone":"+15551234567","cdate":"2024-01-15T09:30:00-06:00","udate":"2024-01-15T09:30:00-06:00"}
   */
  async syncContact(email, firstName, lastName, phone, customFields) {
    // docs: https://developers.activecampaign.com/reference/sync-a-contacts-data
    const contact = this.#compact({ email, firstName, lastName, phone })
    const fieldValues = this.#toFieldValues(customFields)

    if (fieldValues) {
      contact.fieldValues = fieldValues
    }

    const response = await this.#apiRequest({
      path: '/contact/sync',
      method: 'post',
      body: { contact },
      logTag: 'syncContact',
    })

    return response.contact
  }

  /**
   * @operationName Get Contact
   * @category Contacts
   * @description Retrieves a single contact by its ID, including email, name, phone, and timestamps. Use List Contacts first if you only know the email address.
   * @route GET /get-contact
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The ID of the contact to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"113","email":"jane@example.com","firstName":"Jane","lastName":"Doe","phone":"+15551234567","cdate":"2024-01-15T09:30:00-06:00","udate":"2024-01-16T11:00:00-06:00"}
   */
  async getContact(contactId) {
    // docs: https://developers.activecampaign.com/reference/get-contact
    const response = await this.#apiRequest({
      path: `/contacts/${ contactId }`,
      logTag: 'getContact',
    })

    return response.contact
  }

  /**
   * @operationName List Contacts
   * @category Contacts
   * @description Lists contacts with optional filtering by exact email, free-text search (name, email, phone, organization), and subscription status, plus paging. Returns the matching contacts and the total match count.
   * @route GET /list-contacts
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Return only the contact with this exact email address."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Free-text search across name, email, phone, and organization."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Any","Unconfirmed","Active","Unsubscribed","Bounced"]}},"defaultValue":"Any","description":"Filter by subscription status."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":20,"description":"Max contacts to return per page (default 20, max 100)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":0,"description":"0-based index of the first contact to return, for paging."}
   * @returns {Object}
   * @sampleResult {"contacts":[{"id":"113","email":"jane@example.com","firstName":"Jane","lastName":"Doe"}],"total":1}
   */
  async listContacts(email, search, status, limit, offset) {
    // docs: https://developers.activecampaign.com/reference/list-all-contacts
    const query = this.#compact({
      email,
      search,
      status: this.#resolveChoice(status, CONTACT_STATUS_LABEL_TO_VALUE),
      limit: limit || 20,
      offset: offset || 0,
    })

    const response = await this.#apiRequest({
      path: '/contacts',
      query,
      logTag: 'listContacts',
    })

    return { contacts: response.contacts || [], total: Number(response.meta?.total) || 0 }
  }

  /**
   * @operationName Update Contact
   * @category Contacts
   * @description Updates an existing contact by ID. Only the fields you provide are changed; blank fields keep their current values. Use Sync Contact instead when you only know the email address.
   * @route PUT /update-contact
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The ID of the contact to update."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New email address for the contact."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"New first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"New last name."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"New phone number."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Custom field values as an object of field ID to value, e.g. {\"1\":\"Blue\"}. Use List Fields or the field dictionary to find field IDs."}
   * @returns {Object}
   * @sampleResult {"id":"113","email":"jane@example.com","firstName":"Jane","lastName":"Smith","phone":"+15551234567","udate":"2024-01-17T08:00:00-06:00"}
   */
  async updateContact(contactId, email, firstName, lastName, phone, customFields) {
    // docs: https://developers.activecampaign.com/reference/update-a-contact-new
    const contact = this.#compact({ email, firstName, lastName, phone })
    const fieldValues = this.#toFieldValues(customFields)

    if (fieldValues) {
      contact.fieldValues = fieldValues
    }

    const response = await this.#apiRequest({
      path: `/contacts/${ contactId }`,
      method: 'put',
      body: { contact },
      logTag: 'updateContact',
    })

    return response.contact
  }

  /**
   * @operationName Delete Contact
   * @category Contacts
   * @description Permanently deletes a contact and its associated data from ActiveCampaign. This cannot be undone.
   * @route DELETE /delete-contact
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The ID of the contact to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"contactId":"113"}
   */
  async deleteContact(contactId) {
    // docs: https://developers.activecampaign.com/reference/delete-contact
    await this.#apiRequest({
      path: `/contacts/${ contactId }`,
      method: 'delete',
      logTag: 'deleteContact',
    })

    return { deleted: true, contactId }
  }

  // ==========================================================================
  //  TAGS
  // ==========================================================================
  /**
   * @operationName Create Tag
   * @category Tags
   * @description Creates a new contact tag in ActiveCampaign. Tags created here can then be applied to contacts with Add Tag To Contact.
   * @route POST /create-tag
   * @paramDef {"type":"String","label":"Tag Name","name":"tag","required":true,"description":"The name of the tag to create."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description of what the tag is used for."}
   * @returns {Object}
   * @sampleResult {"id":"16","tag":"VIP Customer","tagType":"contact","description":"High-value customers","cdate":"2024-01-15T09:30:00-06:00"}
   */
  async createTag(tag, description) {
    // docs: https://developers.activecampaign.com/reference/create-a-new-tag
    const response = await this.#apiRequest({
      path: '/tags',
      method: 'post',
      body: { tag: this.#compact({ tag, tagType: 'contact', description }) },
      logTag: 'createTag',
    })

    return response.tag
  }

  /**
   * @operationName List Tags
   * @category Tags
   * @description Lists tags in the account with optional name search and paging. Returns each tag's ID, name, type, and how many contacts carry it.
   * @route GET /list-tags
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter tags by name."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":100,"description":"Max tags to return per page (default 100)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":0,"description":"0-based index of the first tag to return, for paging."}
   * @returns {Object}
   * @sampleResult {"tags":[{"id":"16","tag":"VIP Customer","tagType":"contact","subscriber_count":"42"}],"total":1}
   */
  async listTags(search, limit, offset) {
    // docs: https://developers.activecampaign.com/reference/retrieve-all-tags
    const query = this.#compact({ search, limit: limit || 100, offset: offset || 0 })

    const response = await this.#apiRequest({
      path: '/tags',
      query,
      logTag: 'listTags',
    })

    return { tags: response.tags || [], total: Number(response.meta?.total) || 0 }
  }

  /**
   * @operationName Add Tag To Contact
   * @category Tags
   * @description Applies an existing tag to a contact. Tagging can start automations that use "tag is added" as a trigger.
   * @route POST /add-tag-to-contact
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The ID of the contact to tag."}
   * @paramDef {"type":"String","label":"Tag","name":"tagId","required":true,"dictionary":"getTagsDictionary","description":"The tag to apply. Pick one from the dictionary or paste a tag ID."}
   * @returns {Object}
   * @sampleResult {"id":"3","contact":"113","tag":"16","cdate":"2024-01-15T09:30:00-06:00"}
   */
  async addTagToContact(contactId, tagId) {
    // docs: https://developers.activecampaign.com/reference/create-contact-tag
    const response = await this.#apiRequest({
      path: '/contactTags',
      method: 'post',
      body: { contactTag: { contact: contactId, tag: tagId } },
      logTag: 'addTagToContact',
    })

    return response.contactTag
  }

  /**
   * @operationName Remove Tag From Contact
   * @category Tags
   * @description Removes a tag from a contact. Looks up the contact's tag associations to find the matching one, then deletes it — you only need the contact ID and the tag, not the association ID.
   * @route DELETE /remove-tag-from-contact
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The ID of the contact to remove the tag from."}
   * @paramDef {"type":"String","label":"Tag","name":"tagId","required":true,"dictionary":"getTagsDictionary","description":"The tag to remove. Pick one from the dictionary or paste a tag ID."}
   * @returns {Object}
   * @sampleResult {"removed":true,"contactId":"113","tagId":"16","contactTagId":"3"}
   */
  async removeTagFromContact(contactId, tagId) {
    // docs: https://developers.activecampaign.com/reference/delete-contact-tag
    // DELETE /contactTags needs the association id, so resolve it from the contact's tag list first.
    const associations = await this.#apiRequest({
      path: `/contacts/${ contactId }/contactTags`,
      logTag: 'removeTagFromContact.lookup',
    })

    const match = (associations.contactTags || []).find(item => String(item.tag) === String(tagId))

    if (!match) {
      throw new Error(`ActiveCampaign API error: contact ${ contactId } does not have tag ${ tagId }`)
    }

    await this.#apiRequest({
      path: `/contactTags/${ match.id }`,
      method: 'delete',
      logTag: 'removeTagFromContact',
    })

    return { removed: true, contactId, tagId, contactTagId: match.id }
  }

  // ==========================================================================
  //  LISTS
  // ==========================================================================
  /**
   * @operationName List Lists
   * @category Lists
   * @description Lists the mailing lists in the account with optional exact-name filtering and paging. Returns each list's ID, name, and sender info.
   * @route GET /list-lists
   * @paramDef {"type":"String","label":"Name Filter","name":"name","description":"Return only the list with this exact name."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":100,"description":"Max lists to return per page (default 100)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":0,"description":"0-based index of the first list to return, for paging."}
   * @returns {Object}
   * @sampleResult {"lists":[{"id":"1","name":"Newsletter","stringid":"newsletter","sender_name":"Acme Inc","cdate":"2024-01-10T08:00:00-06:00"}],"total":1}
   */
  async listLists(name, limit, offset) {
    // docs: https://developers.activecampaign.com/reference/retrieve-all-lists
    const query = this.#compact({ limit: limit || 100, offset: offset || 0 })

    if (name) {
      query['filters[name]'] = name
    }

    const response = await this.#apiRequest({
      path: '/lists',
      query,
      logTag: 'listLists',
    })

    return { lists: response.lists || [], total: Number(response.meta?.total) || 0 }
  }

  /**
   * @operationName Update List Status For Contact
   * @category Lists
   * @description Subscribes a contact to a mailing list or unsubscribes them from it. Subscribing an unconfirmed or previously unsubscribed contact re-adds them to the list.
   * @route POST /update-list-status-for-contact
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","description":"The mailing list to change the contact's subscription on."}
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The ID of the contact whose subscription to change."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Subscribe","Unsubscribe"]}},"defaultValue":"Subscribe","description":"Whether to subscribe the contact to the list or unsubscribe them from it."}
   * @returns {Object}
   * @sampleResult {"id":"2","list":"1","contact":"113","status":"1","sdate":"2024-01-15T09:30:00-06:00"}
   */
  async updateListStatusForContact(listId, contactId, status) {
    // docs: https://developers.activecampaign.com/reference/update-list-status-for-contact
    const response = await this.#apiRequest({
      path: '/contactLists',
      method: 'post',
      body: {
        contactList: {
          list: listId,
          contact: contactId,
          status: this.#resolveChoice(status, LIST_STATUS_LABEL_TO_VALUE),
        },
      },
      logTag: 'updateListStatusForContact',
    })

    return response.contactList
  }

  // ==========================================================================
  //  CUSTOM FIELDS
  // ==========================================================================
  /**
   * @operationName List Fields
   * @category Custom Fields
   * @description Lists the contact custom field definitions in the account — IDs, titles, types, and options. Use the returned field IDs when setting custom field values on contacts.
   * @route GET /list-fields
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":100,"description":"Max fields to return per page (default 100)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":0,"description":"0-based index of the first field to return, for paging."}
   * @returns {Object}
   * @sampleResult {"fields":[{"id":"1","title":"Favorite Color","type":"dropdown","perstag":"FAVORITE_COLOR"}],"total":1}
   */
  async listFields(limit, offset) {
    // docs: https://developers.activecampaign.com/reference/retrieve-fields
    const response = await this.#apiRequest({
      path: '/fields',
      query: { limit: limit || 100, offset: offset || 0 },
      logTag: 'listFields',
    })

    return { fields: response.fields || [], total: Number(response.meta?.total) || 0 }
  }

  /**
   * @operationName Create Field Value
   * @category Custom Fields
   * @description Sets a custom field value on a contact. If the contact already has a value for the field it is replaced. For multi-value fields (checkbox, list box) use ||-delimited values, e.g. ||Option 1||Option 2||.
   * @route POST /create-field-value
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The ID of the contact to set the field value on."}
   * @paramDef {"type":"String","label":"Field","name":"fieldId","required":true,"dictionary":"getFieldsDictionary","description":"The custom field to set. Pick one from the dictionary or paste a field ID."}
   * @paramDef {"type":"String","label":"Value","name":"value","required":true,"description":"The value to store. Multi-value fields use ||-delimited values."}
   * @returns {Object}
   * @sampleResult {"id":"11","contact":"113","field":"1","value":"Blue","cdate":"2024-01-15T09:30:00-06:00"}
   */
  async createFieldValue(contactId, fieldId, value) {
    // docs: https://developers.activecampaign.com/reference/create-fieldvalue
    const response = await this.#apiRequest({
      path: '/fieldValues',
      method: 'post',
      body: { fieldValue: { contact: contactId, field: fieldId, value } },
      logTag: 'createFieldValue',
    })

    return response.fieldValue
  }

  // ==========================================================================
  //  DEALS
  // ==========================================================================
  /**
   * @operationName Create Deal
   * @category Deals
   * @description Creates a new deal in the CRM, placing it in a pipeline stage and optionally linking it to a contact and owner. The deal value is specified in cents (e.g. 45000 = $450.00).
   * @route POST /create-deal
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The name of the deal."}
   * @paramDef {"type":"Number","label":"Value (cents)","name":"value","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The deal's monetary value in cents, e.g. 45000 for $450.00."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","required":true,"defaultValue":"usd","description":"Three-letter currency code, e.g. usd, eur, gbp."}
   * @paramDef {"type":"String","label":"Pipeline","name":"pipelineId","required":true,"dictionary":"getPipelinesDictionary","description":"The pipeline (deal group) to create the deal in. Also populates the Stage picker."}
   * @paramDef {"type":"String","label":"Stage","name":"stageId","dictionary":"getStagesDictionary","dependsOn":["pipelineId"],"description":"The pipeline stage to place the deal in. Defaults to the pipeline's first stage."}
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","description":"The ID of the primary contact to attach the deal to."}
   * @paramDef {"type":"String","label":"Owner ID","name":"ownerId","description":"The ID of the user who owns the deal. Required if the pipeline auto-assigns is disabled."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A description of the deal."}
   * @returns {Object}
   * @sampleResult {"id":"45","title":"Website redesign","value":"45000","currency":"usd","group":"1","stage":"1","contact":"113","owner":"1","status":0,"cdate":"2024-01-15T09:30:00-06:00"}
   */
  async createDeal(title, value, currency, pipelineId, stageId, contactId, ownerId, description) {
    // docs: https://developers.activecampaign.com/reference/create-a-deal-new
    const deal = this.#compact({
      title,
      value,
      currency: currency ? String(currency).toLowerCase() : 'usd',
      group: pipelineId,
      stage: stageId,
      contact: contactId,
      owner: ownerId,
      description,
    })

    const response = await this.#apiRequest({
      path: '/deals',
      method: 'post',
      body: { deal },
      logTag: 'createDeal',
    })

    return response.deal
  }

  /**
   * @operationName Get Deal
   * @category Deals
   * @description Retrieves a single deal by its ID, including title, value, pipeline, stage, status, and linked contact.
   * @route GET /get-deal
   * @paramDef {"type":"String","label":"Deal ID","name":"dealId","required":true,"description":"The ID of the deal to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"45","title":"Website redesign","value":"45000","currency":"usd","group":"1","stage":"1","contact":"113","status":"0","cdate":"2024-01-15T09:30:00-06:00"}
   */
  async getDeal(dealId) {
    // docs: https://developers.activecampaign.com/reference/retrieve-a-deal
    const response = await this.#apiRequest({
      path: `/deals/${ dealId }`,
      logTag: 'getDeal',
    })

    return response.deal
  }

  /**
   * @operationName List Deals
   * @category Deals
   * @description Lists deals with optional filtering by title search, pipeline, stage, status, and linked contact, plus paging. Returns the matching deals and the total match count.
   * @route GET /list-deals
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to search for in deal titles."}
   * @paramDef {"type":"String","label":"Pipeline","name":"pipelineId","dictionary":"getPipelinesDictionary","description":"Return only deals in this pipeline (deal group)."}
   * @paramDef {"type":"String","label":"Stage","name":"stageId","dictionary":"getStagesDictionary","dependsOn":["pipelineId"],"description":"Return only deals in this pipeline stage."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Won","Lost"]}},"description":"Return only deals with this status. Leave blank for all."}
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","description":"Return only deals linked to this contact."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":20,"description":"Max deals to return per page (default 20, max 100)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":0,"description":"0-based index of the first deal to return, for paging."}
   * @returns {Object}
   * @sampleResult {"deals":[{"id":"45","title":"Website redesign","value":"45000","currency":"usd","stage":"1","status":"0"}],"total":1}
   */
  async listDeals(search, pipelineId, stageId, status, contactId, limit, offset) {
    // docs: https://developers.activecampaign.com/reference/list-all-deals
    const query = this.#compact({ limit: limit || 20, offset: offset || 0 })
    const resolvedStatus = this.#resolveChoice(status, DEAL_STATUS_LABEL_TO_VALUE)

    if (search) {
      query['filters[search]'] = search
      query['filters[search_field]'] = 'title'
    }

    if (pipelineId) query['filters[group]'] = pipelineId
    if (stageId) query['filters[stage]'] = stageId
    if (resolvedStatus !== undefined) query['filters[status]'] = resolvedStatus
    if (contactId) query['filters[contact]'] = contactId

    const response = await this.#apiRequest({
      path: '/deals',
      query,
      logTag: 'listDeals',
    })

    return { deals: response.deals || [], total: Number(response.meta?.total) || 0 }
  }

  /**
   * @operationName Update Deal
   * @category Deals
   * @description Updates an existing deal by ID — title, value, currency, stage, owner, status, or description. Only the fields you provide are changed. Use the status field to mark a deal Won or Lost.
   * @route PUT /update-deal
   * @paramDef {"type":"String","label":"Deal ID","name":"dealId","required":true,"description":"The ID of the deal to update."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New title for the deal."}
   * @paramDef {"type":"Number","label":"Value (cents)","name":"value","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New value in cents, e.g. 45000 for $450.00."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","description":"Three-letter currency code, e.g. usd, eur, gbp."}
   * @paramDef {"type":"String","label":"Pipeline","name":"pipelineId","dictionary":"getPipelinesDictionary","description":"Move the deal to this pipeline (deal group). Also populates the Stage picker."}
   * @paramDef {"type":"String","label":"Stage","name":"stageId","dictionary":"getStagesDictionary","dependsOn":["pipelineId"],"description":"Move the deal to this pipeline stage."}
   * @paramDef {"type":"String","label":"Owner ID","name":"ownerId","description":"Reassign the deal to this user ID."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Won","Lost"]}},"description":"Set the deal's status. Leave blank to keep the current status."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description for the deal."}
   * @returns {Object}
   * @sampleResult {"id":"45","title":"Website redesign","value":"50000","currency":"usd","stage":"2","status":1,"mdate":"2024-01-17T08:00:00-06:00"}
   */
  async updateDeal(dealId, title, value, currency, pipelineId, stageId, ownerId, status, description) {
    // docs: https://developers.activecampaign.com/reference/update-a-deal-new
    const deal = this.#compact({
      title,
      value,
      currency: currency ? String(currency).toLowerCase() : undefined,
      group: pipelineId,
      stage: stageId,
      owner: ownerId,
      status: this.#resolveChoice(status, DEAL_STATUS_LABEL_TO_VALUE),
      description,
    })

    const response = await this.#apiRequest({
      path: `/deals/${ dealId }`,
      method: 'put',
      body: { deal },
      logTag: 'updateDeal',
    })

    return response.deal
  }

  /**
   * @operationName List Pipelines
   * @category Deals
   * @description Lists the deal pipelines (deal groups) in the account with paging. Use the returned IDs with Create Deal, Update Deal, and List Stages.
   * @route GET /list-pipelines
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":100,"description":"Max pipelines to return per page (default 100)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":0,"description":"0-based index of the first pipeline to return, for paging."}
   * @returns {Object}
   * @sampleResult {"pipelines":[{"id":"1","title":"Sales Pipeline","currency":"usd","stages":["1","2","3"]}],"total":1}
   */
  async listPipelines(limit, offset) {
    // docs: https://developers.activecampaign.com/reference/list-all-pipelines
    const response = await this.#apiRequest({
      path: '/dealGroups',
      query: { limit: limit || 100, offset: offset || 0 },
      logTag: 'listPipelines',
    })

    return { pipelines: response.dealGroups || [], total: Number(response.meta?.total) || 0 }
  }

  /**
   * @operationName List Stages
   * @category Deals
   * @description Lists the stages of a deal pipeline in order. Use the returned stage IDs when creating, updating, or filtering deals.
   * @route GET /list-stages
   * @paramDef {"type":"String","label":"Pipeline","name":"pipelineId","required":true,"dictionary":"getPipelinesDictionary","description":"The pipeline (deal group) whose stages to list."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":100,"description":"Max stages to return per page (default 100)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":0,"description":"0-based index of the first stage to return, for paging."}
   * @returns {Object}
   * @sampleResult {"stages":[{"id":"1","title":"To Contact","group":"1","order":"1"},{"id":"2","title":"In Contact","group":"1","order":"2"}],"total":2}
   */
  async listStages(pipelineId, limit, offset) {
    // docs: https://developers.activecampaign.com/reference/list-all-deal-stages
    const query = { limit: limit || 100, offset: offset || 0 }

    if (pipelineId) {
      query['filters[d_groupid]'] = pipelineId
    }

    const response = await this.#apiRequest({
      path: '/dealStages',
      query,
      logTag: 'listStages',
    })

    return { stages: response.dealStages || [], total: Number(response.meta?.total) || 0 }
  }

  // ==========================================================================
  //  AUTOMATIONS
  // ==========================================================================
  /**
   * @operationName List Automations
   * @category Automations
   * @description Lists the automations in the account with paging. Returns each automation's ID, name, status, and how many contacts have entered it.
   * @route GET /list-automations
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":100,"description":"Max automations to return per page (default 100)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":0,"description":"0-based index of the first automation to return, for paging."}
   * @returns {Object}
   * @sampleResult {"automations":[{"id":"1","name":"Welcome Series","status":"1","entered":"120","cdate":"2024-01-10T08:00:00-06:00"}],"total":1}
   */
  async listAutomations(limit, offset) {
    // docs: https://developers.activecampaign.com/reference/list-all-automations
    const response = await this.#apiRequest({
      path: '/automations',
      query: { limit: limit || 100, offset: offset || 0 },
      logTag: 'listAutomations',
    })

    return { automations: response.automations || [], total: Number(response.meta?.total) || 0 }
  }

  /**
   * @operationName Add Contact To Automation
   * @category Automations
   * @description Adds a contact to an automation, starting them at its first step. The contact enters the automation even if they don't meet its normal start-trigger conditions.
   * @route POST /add-contact-to-automation
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The ID of the contact to add."}
   * @paramDef {"type":"String","label":"Automation","name":"automationId","required":true,"dictionary":"getAutomationsDictionary","description":"The automation to add the contact to. Pick one from the dictionary or paste an automation ID."}
   * @returns {Object}
   * @sampleResult {"id":"2","contact":"113","automation":"1","status":"1","adddate":"2024-01-15T09:30:00-06:00"}
   */
  async addContactToAutomation(contactId, automationId) {
    // docs: https://developers.activecampaign.com/reference/create-new-contactautomation
    const response = await this.#apiRequest({
      path: '/contactAutomations',
      method: 'post',
      body: { contactAutomation: { contact: contactId, automation: automationId } },
      logTag: 'addContactToAutomation',
    })

    return response.contactAutomation
  }

  // ==========================================================================
  //  CAMPAIGNS
  // ==========================================================================
  /**
   * @operationName List Campaigns
   * @category Campaigns
   * @description Lists email campaigns with optional status filtering and paging. Each campaign includes basic performance stats such as send count, unique opens, and link clicks.
   * @route GET /list-campaigns
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Scheduled","Sending","Paused","Stopped","Completed"]}},"description":"Return only campaigns with this status. Leave blank for all."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":20,"description":"Max campaigns to return per page (default 20, max 100)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":0,"description":"0-based index of the first campaign to return, for paging."}
   * @returns {Object}
   * @sampleResult {"campaigns":[{"id":"1","name":"January Newsletter","type":"single","status":"5","send_amt":"1200","uniqueopens":"480","linkclicks":"150","sdate":"2024-01-15T10:00:00-06:00"}],"total":1}
   */
  async listCampaigns(status, limit, offset) {
    // docs: https://developers.activecampaign.com/reference/list-all-campaigns
    const query = this.#compact({ limit: limit || 20, offset: offset || 0 })
    const resolvedStatus = this.#resolveChoice(status, CAMPAIGN_STATUS_LABEL_TO_VALUE)

    if (resolvedStatus !== undefined) {
      query['filters[status]'] = resolvedStatus
    }

    const response = await this.#apiRequest({
      path: '/campaigns',
      query,
      logTag: 'listCampaigns',
    })

    return { campaigns: response.campaigns || [], total: Number(response.meta?.total) || 0 }
  }

  // ==========================================================================
  //  NOTES
  // ==========================================================================
  /**
   * @operationName Add Note To Contact
   * @category Notes
   * @description Adds a note to a contact's activity timeline. Notes are visible on the contact record in ActiveCampaign.
   * @route POST /add-note-to-contact
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The ID of the contact to add the note to."}
   * @paramDef {"type":"String","label":"Note","name":"note","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text of the note."}
   * @returns {Object}
   * @sampleResult {"id":"7","note":"Called to follow up on proposal","relid":"113","reltype":"Subscriber","cdate":"2024-01-15T09:30:00-06:00"}
   */
  async addNoteToContact(contactId, note) {
    // docs: https://developers.activecampaign.com/reference/create-a-note
    const response = await this.#apiRequest({
      path: '/notes',
      method: 'post',
      body: { note: { note, relid: contactId, reltype: 'Subscriber' } },
      logTag: 'addNoteToContact',
    })

    return response.note
  }

  // ==========================================================================
  //  REALTIME TRIGGER (SINGLE_APP — one ActiveCampaign webhook per trigger)
  // ==========================================================================
  /**
   * @operationName On ActiveCampaign Event
   * @category Triggers
   * @description Fires when the chosen event happens in ActiveCampaign — a contact is added, updated, tagged, untagged, or unsubscribed; a deal is added or updated; a campaign email is opened; or a tracked link is clicked. A webhook subscribed to that single event is registered in the account, covering changes made by contacts, admins, API calls, and automations.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-activecampaign-event
   * @paramDef {"type":"String","label":"Event","name":"event","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Contact Added","Contact Updated","Contact Tag Added","Contact Tag Removed","Contact Unsubscribed","Deal Added","Deal Updated","Campaign Opened","Link Clicked"]}},"description":"Which ActiveCampaign event fires this trigger."}
   * @returns {Object}
   * @sampleResult {"event":"subscribe","date":"2024-01-15 09:30:00","initiatedBy":"api","contact":{"id":"113","email":"jane@example.com","first_name":"Jane","last_name":"Doe","tags":"vip"},"deal":null,"campaign":null,"link":null,"payload":{"type":"subscribe","contact":{"id":"113","email":"jane@example.com"}}}
   */
  onActiveCampaignEvent(callType, payload) {
    if (callType === CALL_TYPES.SHAPE_EVENT) {
      return [{ name: 'onActiveCampaignEvent', data: this.#shapeWebhookEvent(payload) }]
    }

    if (callType === CALL_TYPES.FILTER_TRIGGER) {
      const eventData = payload.eventData || payload.data || {}
      const ids = (payload.triggers || [])
        .filter(trigger => this.#resolveChoice(trigger.data?.event, EVENT_LABEL_TO_VALUE) === eventData.event)
        .map(trigger => trigger.id)

      return { ids }
    }
  }

  // ── Trigger event shaping ──────────────────────────────────────────────
  #shapeWebhookEvent(body) {
    return {
      event: body.type,
      date: body.date || body.date_time || null,
      initiatedBy: body.initiated_by || body.initiated_from || null,
      contact: body.contact || null,
      deal: body.deal || null,
      campaign: body.campaign || null,
      list: body.list || null,
      tag: body.tag || null,
      link: body.link || null,
      payload: body,
    }
  }

  // ActiveCampaign delivers webhooks as application/x-www-form-urlencoded with
  // bracketed keys (e.g. contact[email]=...). Depending on how the platform
  // pre-parses the delivery, the body may arrive as a raw form string, a flat
  // object with bracketed keys, or an already-nested object (JSON). Normalize
  // all three into one nested object.
  #parseWebhookBody(body) {
    let flat = body

    if (typeof flat === 'string') {
      const parsed = {}

      for (const [key, value] of new URLSearchParams(flat)) {
        parsed[key] = value
      }

      flat = parsed
    }

    if (!flat || typeof flat !== 'object') {
      return {}
    }

    const result = {}

    for (const [key, value] of Object.entries(flat)) {
      this.#assignBracketPath(result, key, value)
    }

    return result
  }

  // Expands one bracketed form key ("contact[fields][first_name]") into a
  // nested path on target. Non-bracketed keys are assigned as-is, and already-
  // nested object values pass through untouched.
  #assignBracketPath(target, key, value) {
    const path = key.replace(/\]/g, '').split('[').filter(part => part !== '')

    if (path.length === 0) {
      return
    }

    let node = target

    for (let index = 0; index < path.length - 1; index++) {
      const part = path[index]

      if (typeof node[part] !== 'object' || node[part] === null) {
        node[part] = {}
      }

      node = node[part]
    }

    node[path[path.length - 1]] = value
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

    const separator = invocation.callbackUrl.includes('?') ? '&' : '?'
    const url = `${ invocation.callbackUrl }${ separator }connectionId=${ invocation.connectionId }`
    const webhooks = []

    for (const event of invocation.events || []) {
      const resolvedEvent = this.#resolveChoice(event.triggerData?.event, EVENT_LABEL_TO_VALUE)

      // docs: https://developers.activecampaign.com/reference/webhooks
      const created = await this.#apiRequest({
        path: '/webhooks',
        method: 'post',
        body: {
          webhook: {
            name: `FlowRunner - ${ event.triggerData?.event || resolvedEvent } - ${ event.id }`,
            url,
            events: [resolvedEvent],
            sources: WEBHOOK_SOURCES,
          },
        },
        logTag: 'createWebhook',
      })

      webhooks.push({ triggerId: event.id, webhookId: created?.webhook?.id, event: resolvedEvent })
    }

    return { webhookData: { webhooks }, connectionId: invocation.connectionId }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerResolveEvents
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    logger.debug('handleTriggerResolveEvents invoked')

    // ActiveCampaign performs no subscription handshake, but guard the empty-body case.
    if (!invocation || (!invocation.body && !invocation.rawBody)) {
      return { handshake: true, responseToExternalService: {} }
    }

    // Deliveries are form-encoded; fall back to rawBody when the platform did not parse it.
    const body = this.#parseWebhookBody(invocation.body ?? invocation.rawBody)

    if (!body.type) {
      logger.warn('handleTriggerResolveEvents: delivery has no event type — ignoring')

      return { connectionId: invocation.queryParams?.connectionId, events: [] }
    }

    return {
      connectionId: invocation.queryParams?.connectionId,
      events: this.onActiveCampaignEvent(CALL_TYPES.SHAPE_EVENT, body),
    }
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

    for (const webhook of invocation.webhookData?.webhooks || []) {
      if (!webhook.webhookId) {
        continue
      }

      try {
        await this.#apiRequest({
          path: `/webhooks/${ webhook.webhookId }`,
          method: 'delete',
          logTag: 'deleteWebhook',
        })
      } catch (error) {
        logger.warn(`handleTriggerDeleteWebhook: failed to delete webhook ${ webhook.webhookId }: ${ error?.message }`)
      }
    }

    return { webhookData: {} }
  }

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================
  /**
   * @registerAs DICTIONARY
   * @operationName Get Tags Dictionary
   * @description Provides a searchable list of contact tags for dropdown selection in the tag actions.
   * @route POST /get-tags-dictionary
   * @paramDef {"type":"getTagsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"VIP Customer","value":"16","note":"Tag ID: 16"}],"cursor":null}
   */
  async getTagsDictionary(payload) {
    const { search, cursor } = payload || {}
    const offset = Number(cursor) || 0
    const pageSize = 100

    const query = this.#compact({ search, limit: pageSize, offset })
    const response = await this.#apiRequest({ path: '/tags', query, logTag: 'getTagsDictionary' })
    const tags = response.tags || []

    return {
      items: tags.map(tag => ({ label: tag.tag, value: tag.id, note: `Tag ID: ${ tag.id }` })),
      cursor: this.#nextOffsetCursor(response.meta, offset, pageSize, tags.length),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Lists Dictionary
   * @description Provides a searchable list of mailing lists for dropdown selection in the list actions.
   * @route POST /get-lists-dictionary
   * @paramDef {"type":"getListsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Newsletter","value":"1","note":"List ID: 1"}],"cursor":null}
   */
  async getListsDictionary(payload) {
    const { search, cursor } = payload || {}
    const offset = Number(cursor) || 0
    const pageSize = 100

    const response = await this.#apiRequest({
      path: '/lists',
      query: { limit: pageSize, offset },
      logTag: 'getListsDictionary',
    })
    const term = (search || '').toLowerCase()
    const lists = (response.lists || []).filter(list => !term || String(list.name).toLowerCase().includes(term))

    return {
      items: lists.map(list => ({ label: list.name, value: list.id, note: `List ID: ${ list.id }` })),
      cursor: this.#nextOffsetCursor(response.meta, offset, pageSize, (response.lists || []).length),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Fields Dictionary
   * @description Provides a searchable list of contact custom fields for dropdown selection in the field actions.
   * @route POST /get-fields-dictionary
   * @paramDef {"type":"getFieldsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Favorite Color","value":"1","note":"dropdown — %FAVORITE_COLOR%"}],"cursor":null}
   */
  async getFieldsDictionary(payload) {
    const { search, cursor } = payload || {}
    const offset = Number(cursor) || 0
    const pageSize = 100

    const response = await this.#apiRequest({
      path: '/fields',
      query: { limit: pageSize, offset },
      logTag: 'getFieldsDictionary',
    })
    const term = (search || '').toLowerCase()
    const fields = (response.fields || []).filter(field => !term || String(field.title).toLowerCase().includes(term))

    return {
      items: fields.map(field => ({
        label: field.title,
        value: field.id,
        note: `${ field.type } — %${ field.perstag }%`,
      })),
      cursor: this.#nextOffsetCursor(response.meta, offset, pageSize, (response.fields || []).length),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Pipelines Dictionary
   * @description Provides a searchable list of deal pipelines for dropdown selection in the deal actions.
   * @route POST /get-pipelines-dictionary
   * @paramDef {"type":"getPipelinesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Sales Pipeline","value":"1","note":"Pipeline ID: 1"}],"cursor":null}
   */
  async getPipelinesDictionary(payload) {
    const { search, cursor } = payload || {}
    const offset = Number(cursor) || 0
    const pageSize = 100

    const response = await this.#apiRequest({
      path: '/dealGroups',
      query: this.#compact({ 'filters[title]': search, limit: pageSize, offset }),
      logTag: 'getPipelinesDictionary',
    })
    const pipelines = response.dealGroups || []

    return {
      items: pipelines.map(group => ({ label: group.title, value: group.id, note: `Pipeline ID: ${ group.id }` })),
      cursor: this.#nextOffsetCursor(response.meta, offset, pageSize, pipelines.length),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Stages Dictionary
   * @description Provides a searchable list of a pipeline's deal stages for dropdown selection in the deal actions. Pick a pipeline first to populate the stages.
   * @route POST /get-stages-dictionary
   * @paramDef {"type":"getStagesDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the pipeline criteria whose stages to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"To Contact","value":"1","note":"Stage ID: 1"}],"cursor":null}
   */
  async getStagesDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const pipelineId = criteria?.pipelineId

    if (!pipelineId) {
      return { items: [], cursor: null }
    }

    const offset = Number(cursor) || 0
    const pageSize = 100
    const query = { 'filters[d_groupid]': pipelineId, limit: pageSize, offset }

    if (search) {
      query['filters[title]'] = search
    }

    const response = await this.#apiRequest({
      path: '/dealStages',
      query,
      logTag: 'getStagesDictionary',
    })
    const stages = response.dealStages || []

    return {
      items: stages.map(stage => ({ label: stage.title, value: stage.id, note: `Stage ID: ${ stage.id }` })),
      cursor: this.#nextOffsetCursor(response.meta, offset, pageSize, stages.length),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Automations Dictionary
   * @description Provides a searchable list of automations for dropdown selection in the automation actions.
   * @route POST /get-automations-dictionary
   * @paramDef {"type":"getAutomationsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Welcome Series","value":"1","note":"Automation ID: 1"}],"cursor":null}
   */
  async getAutomationsDictionary(payload) {
    const { search, cursor } = payload || {}
    const offset = Number(cursor) || 0
    const pageSize = 100

    const response = await this.#apiRequest({
      path: '/automations',
      query: { limit: pageSize, offset },
      logTag: 'getAutomationsDictionary',
    })
    const term = (search || '').toLowerCase()
    const automations = (response.automations || []).filter(
      automation => !term || String(automation.name).toLowerCase().includes(term)
    )

    return {
      items: automations.map(automation => ({
        label: automation.name,
        value: automation.id,
        note: `Automation ID: ${ automation.id }`,
      })),
      cursor: this.#nextOffsetCursor(response.meta, offset, pageSize, (response.automations || []).length),
    }
  }
}

Flowrunner.ServerCode.addService(ActiveCampaign, [
  {
    name: 'apiUrl',
    displayName: 'API URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your account API URL, e.g. https://youraccount.api-us1.com. Find it in ActiveCampaign under Settings → Developer.',
  },
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your API key. Find it in ActiveCampaign under Settings → Developer → Key.',
  },
])
