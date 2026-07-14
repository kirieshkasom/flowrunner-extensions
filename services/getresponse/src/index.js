'use strict'

const API_BASE_URL = 'https://api.getresponse.com/v3'

const logger = {
  info: (...args) => console.log('[GetResponse] info:', ...args),
  debug: (...args) => console.log('[GetResponse] debug:', ...args),
  error: (...args) => console.log('[GetResponse] error:', ...args),
  warn: (...args) => console.log('[GetResponse] warn:', ...args),
}

/**
 * @integrationName GetResponse
 * @integrationIcon /icon.png
 */
class GetResponse {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  // All external calls go through this single helper.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'X-Auth-Token': `api-key ${ this.apiKey }`,
          'Content-Type': 'application/json',
        })
        .query(query || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const responseBody = error.body || {}
      const parts = []

      if (responseBody.message) parts.push(responseBody.message)
      if (responseBody.code) parts.push(`code ${ responseBody.code }`)

      if (responseBody.context) {
        parts.push(`context: ${ JSON.stringify(responseBody.context) }`)
      }

      const message = parts.length ? parts.join(' | ') : error.message
      logger.error(`${ logTag } - failed: ${ message }`)
      throw new Error(`GetResponse API error: ${ message }`)
    }
  }

  // Removes keys whose value is undefined/null/'' so partial payloads stay clean.
  #clean(object) {
    return Object.fromEntries(
      Object.entries(object).filter(([, value]) => {
        return value !== undefined && value !== null && value !== ''
      })
    )
  }

  // ─── Dictionary Typedefs ───────────────────────────────────────────────

  /**
   * @typedef {Object} getCampaignsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to campaign (list) names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getTagsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to tag names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getCustomFieldsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to custom field names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getFromFieldsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to from-field names or email addresses."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) for retrieving the next page of results."}
   */

  // ─── Dictionary Methods ────────────────────────────────────────────────

  /**
   * @operationName Get Campaigns Dictionary
   * @description Lists GetResponse campaigns (contact lists) for selection in dependent parameters such as the campaign a contact is added to.
   * @route POST /get-campaigns-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getCampaignsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering campaigns."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Newsletter Subscribers","value":"V","note":"ID: V"}]}
   */
  async getCampaignsDictionary(payload) {
    const { search } = payload || {}
    const logTag = 'getCampaignsDictionary'

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/campaigns`,
        query: { perPage: 1000, ...(search ? { 'query[name]': search } : {}) },
        logTag,
      })

      const items = (response || []).map(campaign => ({
        label: campaign.name,
        value: campaign.campaignId,
        note: `ID: ${ campaign.campaignId }`,
      }))

      return { items }
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)

      return { items: [] }
    }
  }

  /**
   * @operationName Get Tags Dictionary
   * @description Lists GetResponse tags for selection in dependent parameters such as tags applied to a contact.
   * @route POST /get-tags-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getTagsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering tags."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"VIP","value":"abc123","note":"ID: abc123"}]}
   */
  async getTagsDictionary(payload) {
    const { search } = payload || {}
    const logTag = 'getTagsDictionary'

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/tags`,
        query: { perPage: 1000, ...(search ? { 'query[name]': search } : {}) },
        logTag,
      })

      const items = (response || []).map(tag => ({
        label: tag.name,
        value: tag.tagId,
        note: `ID: ${ tag.tagId }`,
      }))

      return { items }
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)

      return { items: [] }
    }
  }

  /**
   * @operationName Get Custom Fields Dictionary
   * @description Lists GetResponse custom fields for selection when mapping custom field values on a contact.
   * @route POST /get-custom-fields-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getCustomFieldsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering custom fields."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Birthday","value":"xyz789","note":"Type: date"}]}
   */
  async getCustomFieldsDictionary(payload) {
    const { search } = payload || {}
    const logTag = 'getCustomFieldsDictionary'

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/custom-fields`,
        query: { perPage: 1000 },
        logTag,
      })

      let items = (response || []).map(field => ({
        label: field.name,
        value: field.customFieldId,
        note: `Type: ${ field.type }`,
      }))

      if (search) {
        const term = search.toLowerCase()
        items = items.filter(item => item.label.toLowerCase().includes(term))
      }

      return { items }
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)

      return { items: [] }
    }
  }

  /**
   * @operationName Get From Fields Dictionary
   * @description Lists GetResponse verified from-fields (sender addresses) for selection when creating newsletters.
   * @route POST /get-from-fields-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getFromFieldsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering from-fields."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"John Doe <john@example.com>","value":"fromField1","note":"john@example.com"}]}
   */
  async getFromFieldsDictionary(payload) {
    const { search } = payload || {}
    const logTag = 'getFromFieldsDictionary'

    try {
      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/from-fields`,
        query: { perPage: 1000 },
        logTag,
      })

      let items = (response || []).map(field => ({
        label: `${ field.name } <${ field.email }>`,
        value: field.fromFieldId,
        note: field.email,
      }))

      if (search) {
        const term = search.toLowerCase()
        items = items.filter(item => item.label.toLowerCase().includes(term))
      }

      return { items }
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)

      return { items: [] }
    }
  }

  // ─── Contacts ──────────────────────────────────────────────────────────

  /**
   * @operationName Create Contact
   * @category Contacts
   * @description Adds a new contact to a GetResponse campaign (list). The contact is added subject to the campaign's opt-in settings (a single opt-in campaign adds them immediately, a double opt-in campaign sends a confirmation email). Supports custom field values, tags, and an autoresponder day-of-cycle. Adding an email that already exists in the campaign returns a conflict error.
   * @route POST /contacts
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Email address of the contact to add."}
   * @paramDef {"type":"String","label":"Campaign ID","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","description":"ID of the campaign (list) the contact is added to."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Full name of the contact."}
   * @paramDef {"type":"Number","label":"Day Of Cycle","name":"dayOfCycle","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Autoresponder cycle day the contact starts on. Set to 0 to start at the beginning; omit to leave the contact out of the autoresponder cycle."}
   * @paramDef {"type":"Array<Object>","label":"Custom Field Values","name":"customFieldValues","description":"Custom field assignments. Each item is an object like {\"customFieldId\":\"abc\",\"value\":[\"1990-01-01\"]}. The value property must be an array of strings."}
   * @paramDef {"type":"Array<String>","label":"Tag IDs","name":"tagIds","description":"IDs of tags to apply to the contact. Use the Get Tags Dictionary to look up tag IDs."}
   * @returns {Object}
   * @sampleResult {"httpStatus":202,"code":1,"message":"Queued for processing"}
   */
  async createContact(email, campaignId, name, dayOfCycle, customFieldValues, tagIds) {
    const logTag = 'createContact'

    try {
      const body = this.#clean({
        email,
        name,
        campaign: campaignId ? { campaignId } : undefined,
        dayOfCycle: dayOfCycle === undefined || dayOfCycle === null
          ? undefined
          : String(dayOfCycle),
        customFieldValues: Array.isArray(customFieldValues) && customFieldValues.length
          ? customFieldValues
          : undefined,
        tags: Array.isArray(tagIds) && tagIds.length
          ? tagIds.map(tagId => ({ tagId }))
          : undefined,
      })

      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/contacts`,
        method: 'post',
        body,
        logTag,
      })

      // A successful create returns HTTP 202 with an empty body.
      return response || { httpStatus: 202, code: 1, message: 'Queued for processing' }
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to create contact: ${ error.message }`)
    }
  }

  /**
   * @operationName Get Contact
   * @category Contacts
   * @description Retrieves a single contact by its GetResponse contact ID, including name, email, campaign, tags, custom field values, and engagement metadata.
   * @route GET /contacts/{contactId}
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"ID of the contact to retrieve."}
   * @returns {Object}
   * @sampleResult {"contactId":"xyz","email":"jane@example.com","name":"Jane Doe","campaign":{"campaignId":"V","name":"Newsletter"},"createdOn":"2024-01-01T00:00:00+0000"}
   */
  async getContact(contactId) {
    const logTag = 'getContact'

    try {
      return await this.#apiRequest({
        url: `${ API_BASE_URL }/contacts/${ contactId }`,
        logTag,
      })
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to get contact: ${ error.message }`)
    }
  }

  /**
   * @operationName List Contacts
   * @category Contacts
   * @description Retrieves a paginated list of contacts, optionally filtered by email or campaign. Supports sorting and page size control. Returns up to 1000 contacts per page.
   * @route GET /contacts
   *
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Filter to contacts whose email contains this value."}
   * @paramDef {"type":"String","label":"Campaign ID","name":"campaignId","dictionary":"getCampaignsDictionary","description":"Filter to contacts in this campaign (list)."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Email Ascending","Email Descending","Name Ascending","Name Descending","Newest First","Oldest First"]}},"defaultValue":"Newest First","description":"Field and direction used to sort results."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":100,"description":"Number of contacts per page (1-1000, default 100)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":1,"description":"Page number to retrieve (starts at 1)."}
   * @returns {Array<Object>}
   * @sampleResult [{"contactId":"xyz","email":"jane@example.com","name":"Jane Doe","campaign":{"campaignId":"V"}}]
   */
  async listContacts(email, campaignId, sortBy, perPage, page) {
    const logTag = 'listContacts'

    const sort = this.#resolveChoice(sortBy, {
      'Email Ascending': { email: 'asc' },
      'Email Descending': { email: 'desc' },
      'Name Ascending': { name: 'asc' },
      'Name Descending': { name: 'desc' },
      'Newest First': { createdOn: 'desc' },
      'Oldest First': { createdOn: 'asc' },
    }) || { createdOn: 'desc' }

    try {
      const query = { perPage: perPage || 100, page: page || 1 }

      if (email) query['query[email]'] = email
      if (campaignId) query['query[campaignId]'] = campaignId

      Object.entries(sort).forEach(([field, direction]) => {
        query[`sort[${ field }]`] = direction
      })

      return await this.#apiRequest({
        url: `${ API_BASE_URL }/contacts`,
        query,
        logTag,
      })
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to list contacts: ${ error.message }`)
    }
  }

  /**
   * @operationName Search Contacts
   * @category Contacts
   * @description Searches contacts by an exact email address across all campaigns, returning every matching contact record. Useful for locating a contact when you only know their email.
   * @route GET /search-contacts
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Exact email address to search for."}
   * @returns {Array<Object>}
   * @sampleResult [{"contactId":"xyz","email":"jane@example.com","name":"Jane Doe","campaign":{"campaignId":"V"}}]
   */
  async searchContacts(email) {
    const logTag = 'searchContacts'

    try {
      return await this.#apiRequest({
        url: `${ API_BASE_URL }/contacts`,
        query: { 'query[email]': email, perPage: 1000 },
        logTag,
      })
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to search contacts: ${ error.message }`)
    }
  }

  /**
   * @operationName Update Contact
   * @category Contacts
   * @description Updates an existing contact identified by its contact ID. Only the provided fields are changed; omitted fields are left untouched. Supports updating name, autoresponder day-of-cycle, custom field values, and tags.
   * @route POST /contacts/{contactId}
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"ID of the contact to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New full name for the contact."}
   * @paramDef {"type":"Number","label":"Day Of Cycle","name":"dayOfCycle","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New autoresponder cycle day for the contact."}
   * @paramDef {"type":"Array<Object>","label":"Custom Field Values","name":"customFieldValues","description":"Custom field assignments to set. Each item is an object like {\"customFieldId\":\"abc\",\"value\":[\"new value\"]}. The value property must be an array of strings."}
   * @paramDef {"type":"Array<String>","label":"Tag IDs","name":"tagIds","description":"IDs of tags to set on the contact. Use the Get Tags Dictionary to look up tag IDs."}
   * @returns {Object}
   * @sampleResult {"contactId":"xyz","email":"jane@example.com","name":"Jane D. Updated"}
   */
  async updateContact(contactId, name, dayOfCycle, customFieldValues, tagIds) {
    const logTag = 'updateContact'

    try {
      const body = this.#clean({
        name,
        dayOfCycle: dayOfCycle === undefined || dayOfCycle === null
          ? undefined
          : String(dayOfCycle),
        customFieldValues: Array.isArray(customFieldValues) && customFieldValues.length
          ? customFieldValues
          : undefined,
        tags: Array.isArray(tagIds) && tagIds.length
          ? tagIds.map(tagId => ({ tagId }))
          : undefined,
      })

      return await this.#apiRequest({
        url: `${ API_BASE_URL }/contacts/${ contactId }`,
        method: 'post',
        body,
        logTag,
      })
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to update contact: ${ error.message }`)
    }
  }

  /**
   * @operationName Delete Contact
   * @category Contacts
   * @description Permanently removes a contact from GetResponse by contact ID. This action cannot be undone.
   * @route DELETE /contacts/{contactId}
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"ID of the contact to delete."}
   * @returns {Object}
   * @sampleResult {"success":true,"contactId":"xyz"}
   */
  async deleteContact(contactId) {
    const logTag = 'deleteContact'

    try {
      await this.#apiRequest({
        url: `${ API_BASE_URL }/contacts/${ contactId }`,
        method: 'delete',
        logTag,
      })

      return { success: true, contactId }
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to delete contact: ${ error.message }`)
    }
  }

  // ─── Campaigns (Lists) ─────────────────────────────────────────────────

  /**
   * @operationName List Campaigns
   * @category Campaigns
   * @description Retrieves all campaigns (contact lists) in the GetResponse account, including their IDs, names, and configuration. In GetResponse a "campaign" is a subscriber list.
   * @route GET /campaigns
   *
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Optional filter matching campaigns whose name contains this value."}
   * @returns {Array<Object>}
   * @sampleResult [{"campaignId":"V","name":"Newsletter Subscribers","isDefault":"true","createdOn":"2024-01-01T00:00:00+0000"}]
   */
  async listCampaigns(name) {
    const logTag = 'listCampaigns'

    try {
      return await this.#apiRequest({
        url: `${ API_BASE_URL }/campaigns`,
        query: { perPage: 1000, ...(name ? { 'query[name]': name } : {}) },
        logTag,
      })
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to list campaigns: ${ error.message }`)
    }
  }

  /**
   * @operationName Get Campaign
   * @category Campaigns
   * @description Retrieves a single campaign (contact list) by its ID, including opt-in type, confirmation settings, and profile details.
   * @route GET /campaigns/{campaignId}
   *
   * @paramDef {"type":"String","label":"Campaign ID","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","description":"ID of the campaign to retrieve."}
   * @returns {Object}
   * @sampleResult {"campaignId":"V","name":"Newsletter Subscribers","optinTypes":{"email":"single","import":"single","webform":"single"}}
   */
  async getCampaign(campaignId) {
    const logTag = 'getCampaign'

    try {
      return await this.#apiRequest({
        url: `${ API_BASE_URL }/campaigns/${ campaignId }`,
        logTag,
      })
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to get campaign: ${ error.message }`)
    }
  }

  /**
   * @operationName Create Campaign
   * @category Campaigns
   * @description Creates a new campaign (contact list). The name must be unique, lowercase, and may only contain letters, numbers, hyphens, underscores, and periods. Optionally sets the confirmation subscription language.
   * @route POST /campaigns
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Unique campaign name. Must be lowercase and contain only letters, numbers, hyphens, underscores, and periods."}
   * @paramDef {"type":"String","label":"Language Code","name":"languageCode","description":"Two-letter language code for confirmation messages (for example en, pl, es). Defaults to the account language."}
   * @returns {Object}
   * @sampleResult {"campaignId":"W","name":"my-new-list","description":"","languageCode":"EN"}
   */
  async createCampaign(name, languageCode) {
    const logTag = 'createCampaign'

    try {
      const body = this.#clean({ name, languageCode })

      return await this.#apiRequest({
        url: `${ API_BASE_URL }/campaigns`,
        method: 'post',
        body,
        logTag,
      })
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to create campaign: ${ error.message }`)
    }
  }

  // ─── Newsletters ───────────────────────────────────────────────────────

  /**
   * @operationName Create Newsletter
   * @category Newsletters
   * @description Creates and schedules a newsletter (one-off email broadcast) to a campaign. Requires a subject, a verified from-field, HTML and/or plain-text content, and the target campaign. By default the newsletter is sent immediately; set Send On to schedule it for a future time.
   * @route POST /newsletters
   *
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Subject line of the newsletter."}
   * @paramDef {"type":"String","label":"From Field ID","name":"fromFieldId","required":true,"dictionary":"getFromFieldsDictionary","description":"ID of the verified from-field (sender) used to send the newsletter."}
   * @paramDef {"type":"String","label":"Campaign ID","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","description":"ID of the campaign (list) the newsletter is sent to."}
   * @paramDef {"type":"String","label":"HTML Content","name":"html","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"HTML body of the newsletter. Provide HTML content, plain content, or both."}
   * @paramDef {"type":"String","label":"Plain Content","name":"plain","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Plain-text body of the newsletter. Provide HTML content, plain content, or both."}
   * @paramDef {"type":"String","label":"Reply-To Field ID","name":"replyToFieldId","dictionary":"getFromFieldsDictionary","description":"ID of the from-field used as the reply-to address. Defaults to the from-field when omitted."}
   * @paramDef {"type":"String","label":"Send On","name":"sendOn","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"ISO 8601 timestamp to schedule sending. When omitted the newsletter is sent immediately."}
   * @returns {Object}
   * @sampleResult {"newsletterId":"n1","subject":"Weekly Update","status":"enqueued","campaign":{"campaignId":"V"}}
   */
  async createNewsletter(subject, fromFieldId, campaignId, html, plain, replyToFieldId, sendOn) {
    const logTag = 'createNewsletter'

    try {
      const content = this.#clean({ html, plain })
      const body = this.#clean({
        subject,
        fromField: fromFieldId ? { fromFieldId } : undefined,
        replyTo: replyToFieldId ? { fromFieldId: replyToFieldId } : undefined,
        campaign: campaignId ? { campaignId } : undefined,
        content: Object.keys(content).length ? content : undefined,
        sendSettings: sendOn
          ? { selectedCampaigns: [campaignId], timeTravel: 'false', perfectTiming: 'false' }
          : undefined,
        sendOn,
      })

      return await this.#apiRequest({
        url: `${ API_BASE_URL }/newsletters`,
        method: 'post',
        body,
        logTag,
      })
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to create newsletter: ${ error.message }`)
    }
  }

  /**
   * @operationName List Newsletters
   * @category Newsletters
   * @description Retrieves a paginated list of newsletters (email broadcasts) in the account, including their subjects, statuses, and target campaigns.
   * @route GET /newsletters
   *
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":100,"description":"Number of newsletters per page (1-1000, default 100)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":1,"description":"Page number to retrieve (starts at 1)."}
   * @returns {Array<Object>}
   * @sampleResult [{"newsletterId":"n1","subject":"Weekly Update","status":"sent","campaign":{"campaignId":"V"}}]
   */
  async listNewsletters(perPage, page) {
    const logTag = 'listNewsletters'

    try {
      return await this.#apiRequest({
        url: `${ API_BASE_URL }/newsletters`,
        query: { perPage: perPage || 100, page: page || 1 },
        logTag,
      })
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to list newsletters: ${ error.message }`)
    }
  }

  /**
   * @operationName Get Newsletter
   * @category Newsletters
   * @description Retrieves a single newsletter by its ID, including subject, status, content, statistics, and send settings.
   * @route GET /newsletters/{newsletterId}
   *
   * @paramDef {"type":"String","label":"Newsletter ID","name":"newsletterId","required":true,"description":"ID of the newsletter to retrieve."}
   * @returns {Object}
   * @sampleResult {"newsletterId":"n1","subject":"Weekly Update","status":"sent","content":{"html":"<p>Hi</p>"}}
   */
  async getNewsletter(newsletterId) {
    const logTag = 'getNewsletter'

    try {
      return await this.#apiRequest({
        url: `${ API_BASE_URL }/newsletters/${ newsletterId }`,
        logTag,
      })
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to get newsletter: ${ error.message }`)
    }
  }

  // ─── Autoresponders ────────────────────────────────────────────────────

  /**
   * @operationName List Autoresponders
   * @category Autoresponders
   * @description Retrieves a paginated list of autoresponders (automated cycle emails) in the account, including their names, statuses, trigger settings, and target campaigns.
   * @route GET /autoresponders
   *
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":100,"description":"Number of autoresponders per page (1-1000, default 100)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":1,"description":"Page number to retrieve (starts at 1)."}
   * @returns {Array<Object>}
   * @sampleResult [{"autoresponderId":"a1","name":"Welcome Series Day 0","status":"active","triggerSettings":{"dayOfCycle":0}}]
   */
  async listAutoresponders(perPage, page) {
    const logTag = 'listAutoresponders'

    try {
      return await this.#apiRequest({
        url: `${ API_BASE_URL }/autoresponders`,
        query: { perPage: perPage || 100, page: page || 1 },
        logTag,
      })
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to list autoresponders: ${ error.message }`)
    }
  }

  /**
   * @operationName Get Autoresponder
   * @category Autoresponders
   * @description Retrieves a single autoresponder by its ID, including its name, status, trigger settings, content, and statistics.
   * @route GET /autoresponders/{autoresponderId}
   *
   * @paramDef {"type":"String","label":"Autoresponder ID","name":"autoresponderId","required":true,"description":"ID of the autoresponder to retrieve."}
   * @returns {Object}
   * @sampleResult {"autoresponderId":"a1","name":"Welcome Series Day 0","status":"active","triggerSettings":{"dayOfCycle":0}}
   */
  async getAutoresponder(autoresponderId) {
    const logTag = 'getAutoresponder'

    try {
      return await this.#apiRequest({
        url: `${ API_BASE_URL }/autoresponders/${ autoresponderId }`,
        logTag,
      })
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to get autoresponder: ${ error.message }`)
    }
  }

  // ─── Tags ──────────────────────────────────────────────────────────────

  /**
   * @operationName List Tags
   * @category Tags
   * @description Retrieves all tags defined in the GetResponse account, including their IDs, names, and colors. Tags are used to segment and organize contacts.
   * @route GET /tags
   *
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Optional filter matching tags whose name contains this value."}
   * @returns {Array<Object>}
   * @sampleResult [{"tagId":"abc123","name":"VIP","color":"BLUE","createdOn":"2024-01-01T00:00:00+0000"}]
   */
  async listTags(name) {
    const logTag = 'listTags'

    try {
      return await this.#apiRequest({
        url: `${ API_BASE_URL }/tags`,
        query: { perPage: 1000, ...(name ? { 'query[name]': name } : {}) },
        logTag,
      })
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to list tags: ${ error.message }`)
    }
  }

  /**
   * @operationName Create Tag
   * @category Tags
   * @description Creates a new tag that can be applied to contacts. The name may contain only letters, numbers, underscores, and hyphens. An optional color helps visually distinguish the tag in the GetResponse UI.
   * @route POST /tags
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Tag name. May contain only letters, numbers, underscores, and hyphens."}
   * @paramDef {"type":"String","label":"Color","name":"color","uiComponent":{"type":"DROPDOWN","options":{"values":["Gray","Red","Orange","Yellow","Green","Teal","Blue","Purple","Pink"]}},"description":"Display color for the tag in the GetResponse UI."}
   * @returns {Object}
   * @sampleResult {"tagId":"abc123","name":"VIP","color":"BLUE"}
   */
  async createTag(name, color) {
    const logTag = 'createTag'

    const resolvedColor = this.#resolveChoice(color, {
      Gray: 'GRAY',
      Red: 'RED',
      Orange: 'ORANGE',
      Yellow: 'YELLOW',
      Green: 'GREEN',
      Teal: 'TEAL',
      Blue: 'BLUE',
      Purple: 'PURPLE',
      Pink: 'PINK',
    })

    try {
      const body = this.#clean({ name, color: resolvedColor })

      return await this.#apiRequest({
        url: `${ API_BASE_URL }/tags`,
        method: 'post',
        body,
        logTag,
      })
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to create tag: ${ error.message }`)
    }
  }

  /**
   * @operationName Delete Tag
   * @category Tags
   * @description Permanently deletes a tag by its ID. The tag is removed from all contacts it was applied to. This action cannot be undone.
   * @route DELETE /tags/{tagId}
   *
   * @paramDef {"type":"String","label":"Tag ID","name":"tagId","required":true,"dictionary":"getTagsDictionary","description":"ID of the tag to delete."}
   * @returns {Object}
   * @sampleResult {"success":true,"tagId":"abc123"}
   */
  async deleteTag(tagId) {
    const logTag = 'deleteTag'

    try {
      await this.#apiRequest({
        url: `${ API_BASE_URL }/tags/${ tagId }`,
        method: 'delete',
        logTag,
      })

      return { success: true, tagId }
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to delete tag: ${ error.message }`)
    }
  }

  // ─── Custom Fields ─────────────────────────────────────────────────────

  /**
   * @operationName List Custom Fields
   * @category Custom Fields
   * @description Retrieves all custom fields defined in the GetResponse account, including their IDs, names, types, and predefined values. Custom fields store additional structured data on contacts.
   * @route GET /custom-fields
   *
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":100,"description":"Number of custom fields per page (1-1000, default 100)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":1,"description":"Page number to retrieve (starts at 1)."}
   * @returns {Array<Object>}
   * @sampleResult [{"customFieldId":"xyz789","name":"birthday","type":"date","valueType":"date","hidden":"false"}]
   */
  async listCustomFields(perPage, page) {
    const logTag = 'listCustomFields'

    try {
      return await this.#apiRequest({
        url: `${ API_BASE_URL }/custom-fields`,
        query: { perPage: perPage || 100, page: page || 1 },
        logTag,
      })
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to list custom fields: ${ error.message }`)
    }
  }

  /**
   * @operationName Create Custom Field
   * @category Custom Fields
   * @description Creates a new custom field for storing structured data on contacts. Choose a field type (for example text, number, date, or a multiple-choice list). For choice-based types, supply the allowed values.
   * @route POST /custom-fields
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Custom field name. Must be lowercase and contain only letters, numbers, and underscores."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Text","Textarea","Number","Date","Datetime","Country","Phone","URL","Checkbox","Radio","Single Select","Multi Select"]}},"defaultValue":"Text","description":"Data type of the custom field."}
   * @paramDef {"type":"Boolean","label":"Hidden","name":"hidden","uiComponent":{"type":"CHECKBOX"},"defaultValue":false,"description":"When true the field is hidden from the contact-facing forms."}
   * @paramDef {"type":"Array<String>","label":"Values","name":"values","description":"Predefined allowed values. Required for choice-based types (Checkbox, Radio, Single Select, Multi Select) and ignored for others."}
   * @returns {Object}
   * @sampleResult {"customFieldId":"xyz789","name":"birthday","type":"date","hidden":"false","values":[]}
   */
  async createCustomField(name, type, hidden, values) {
    const logTag = 'createCustomField'

    const resolvedType = this.#resolveChoice(type, {
      Text: 'text',
      Textarea: 'textarea',
      Number: 'number',
      Date: 'date',
      Datetime: 'datetime',
      Country: 'country',
      Phone: 'phone',
      URL: 'url',
      Checkbox: 'checkbox',
      Radio: 'radio',
      'Single Select': 'single_select',
      'Multi Select': 'multi_select',
    })

    try {
      const body = this.#clean({
        name,
        type: resolvedType,
        hidden: hidden ? 'true' : 'false',
        values: Array.isArray(values) && values.length ? values : undefined,
      })

      return await this.#apiRequest({
        url: `${ API_BASE_URL }/custom-fields`,
        method: 'post',
        body,
        logTag,
      })
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to create custom field: ${ error.message }`)
    }
  }

  // ─── From Fields ───────────────────────────────────────────────────────

  /**
   * @operationName List From Fields
   * @category From Fields
   * @description Retrieves all from-fields (verified sender addresses) in the GetResponse account, including their IDs, names, email addresses, and verification status. From-fields are used as the sender of newsletters.
   * @route GET /from-fields
   *
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":100,"description":"Number of from-fields per page (1-1000, default 100)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":1,"description":"Page number to retrieve (starts at 1)."}
   * @returns {Array<Object>}
   * @sampleResult [{"fromFieldId":"fromField1","name":"John Doe","email":"john@example.com","isActive":"true","isDefault":"true"}]
   */
  async listFromFields(perPage, page) {
    const logTag = 'listFromFields'

    try {
      return await this.#apiRequest({
        url: `${ API_BASE_URL }/from-fields`,
        query: { perPage: perPage || 100, page: page || 1 },
        logTag,
      })
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to list from-fields: ${ error.message }`)
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  // Maps a friendly dropdown label to its API value; passes through unknowns.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }
}

Flowrunner.ServerCode.addService(GetResponse, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your GetResponse API key. Generate it in GetResponse under Menu > Integrations & API > API > Generate API key.',
  },
])
