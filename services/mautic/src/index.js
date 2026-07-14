const logger = {
  info: (...args) => console.log('[Mautic] info:', ...args),
  debug: (...args) => console.log('[Mautic] debug:', ...args),
  error: (...args) => console.log('[Mautic] error:', ...args),
  warn: (...args) => console.log('[Mautic] warn:', ...args),
}

const DEFAULT_LIST_LIMIT = 30

/**
 * Removes undefined, null, and empty-string values from an object so they are
 * not sent to the Mautic API (which would otherwise overwrite fields with blanks).
 */
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
 * @integrationName Mautic
 * @integrationIcon /icon.png
 */
class MauticService {
  constructor(config) {
    this.baseUrl = (config.baseUrl || '').replace(/\/+$/, '')
    this.username = config.username
    this.password = config.password
    this.apiBase = `${ this.baseUrl }/api`
    this.authHeader = `Basic ${ Buffer.from(`${ this.username }:${ this.password }`).toString('base64') }`
  }

  /**
   * Turns Mautic's list wrapping (an object keyed by id, e.g.
   * { "1": {...}, "2": {...} }) into a plain array of resources.
   * Passes arrays through unchanged and returns [] for empty/missing input.
   */
  #normalizeList(collection) {
    if (!collection) {
      return []
    }

    if (Array.isArray(collection)) {
      return collection
    }

    return Object.values(collection)
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const url = `${ this.apiBase }${ path }`

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(query || {}) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': this.authHeader,
          'Content-Type': 'application/json',
        })
        .query(clean(query) || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const apiErrors = error.body?.errors
      const message = Array.isArray(apiErrors) && apiErrors.length
        ? apiErrors.map(e => e.message).join('; ')
        : (error.body?.message || error.message)

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Mautic API error: ${ message }`)
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Contacts
  // ─────────────────────────────────────────────────────────────

  /**
   * @operationName Create Contact
   * @category Contacts
   * @description Creates a new Mautic contact (lead). Supports the standard core fields (first name, last name, email, phone, company) plus tags and any custom contact fields via the Custom Fields object, whose keys must match your Mautic custom field aliases. Returns the created contact wrapped under the "contact" key.
   * @route POST /contacts/new
   *
   * @paramDef {"type":"String","label":"First Name","name":"firstname","description":"Contact's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastname","description":"Contact's last name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Contact's email address. Used by Mautic to de-duplicate contacts."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Contact's phone number."}
   * @paramDef {"type":"String","label":"Company","name":"company","description":"Company name to associate with the contact."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags to attach to the contact. Prefix a tag with a minus sign (-) to remove it."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Additional contact fields as key/value pairs. Keys must match your Mautic custom field aliases (e.g. jobtitle, city, points)."}
   *
   * @returns {Object}
   * @sampleResult {"contact":{"id":47,"fields":{"core":{"firstname":{"value":"Jane"},"lastname":{"value":"Doe"},"email":{"value":"jane@example.com"}}},"tags":[{"tag":"newsletter"}]}}
   */
  async createContact(firstname, lastname, email, phone, company, tags, customFields) {
    const logTag = '[createContact]'

    const body = {
      ...(customFields || {}),
      ...clean({ firstname, lastname, email, phone, company }),
    }

    if (Array.isArray(tags) && tags.length) {
      body.tags = tags
    }

    return this.#apiRequest({ logTag, path: '/contacts/new', method: 'post', body })
  }

  /**
   * @operationName Get Contact
   * @category Contacts
   * @description Retrieves a single Mautic contact by its numeric ID, including its field values, tags, and segment/company associations. Returns the contact wrapped under the "contact" key.
   * @route GET /contacts/{id}
   *
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the contact to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"contact":{"id":47,"dateAdded":"2024-01-15T10:00:00+00:00","fields":{"core":{"email":{"value":"jane@example.com"}}},"tags":[{"tag":"newsletter"}]}}
   */
  async getContact(contactId) {
    const logTag = '[getContact]'

    return this.#apiRequest({ logTag, path: `/contacts/${ contactId }` })
  }

  /**
   * @operationName List Contacts
   * @category Contacts
   * @description Lists Mautic contacts with optional full-text search, pagination, and ordering. Mautic returns the matching contacts as an object keyed by ID; this operation normalizes them into a "contacts" array and includes the "total" match count.
   * @route GET /contacts
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Search string. Supports Mautic search syntax, e.g. email:jane@example.com or segment:newsletter."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of contacts to return. Defaults to 30."}
   * @paramDef {"type":"Number","label":"Start","name":"start","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based offset of the first record to return, for pagination."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","description":"Column alias to sort by, e.g. last_active, date_added, email."}
   * @paramDef {"type":"String","label":"Order Direction","name":"orderByDir","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction for Order By. Defaults to Ascending."}
   *
   * @returns {Object}
   * @sampleResult {"total":2,"contacts":[{"id":47,"fields":{"core":{"email":{"value":"jane@example.com"}}}},{"id":48,"fields":{"core":{"email":{"value":"john@example.com"}}}}]}
   */
  async listContacts(search, limit, start, orderBy, orderByDir) {
    const logTag = '[listContacts]'

    const response = await this.#apiRequest({
      logTag,
      path: '/contacts',
      query: {
        search,
        limit: limit || DEFAULT_LIST_LIMIT,
        start,
        orderBy,
        orderByDir: this.#resolveChoice(orderByDir, { Ascending: 'ASC', Descending: 'DESC' }),
      },
    })

    return { total: response.total, contacts: this.#normalizeList(response.contacts) }
  }

  /**
   * @operationName Edit Contact
   * @category Contacts
   * @description Updates an existing Mautic contact by ID using a PATCH, which only modifies the fields you supply and leaves all others untouched. Supports the core fields plus tags and arbitrary custom fields. Returns the updated contact wrapped under the "contact" key.
   * @route PATCH /contacts/{id}/edit
   *
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the contact to update."}
   * @paramDef {"type":"String","label":"First Name","name":"firstname","description":"New first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastname","description":"New last name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New email address."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"New phone number."}
   * @paramDef {"type":"String","label":"Company","name":"company","description":"New company name."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags to set on the contact. Prefix a tag with a minus sign (-) to remove it."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Additional contact fields as key/value pairs. Keys must match your Mautic custom field aliases."}
   *
   * @returns {Object}
   * @sampleResult {"contact":{"id":47,"fields":{"core":{"firstname":{"value":"Janet"},"email":{"value":"jane@example.com"}}}}}
   */
  async editContact(contactId, firstname, lastname, email, phone, company, tags, customFields) {
    const logTag = '[editContact]'

    const body = {
      ...(customFields || {}),
      ...clean({ firstname, lastname, email, phone, company }),
    }

    if (Array.isArray(tags) && tags.length) {
      body.tags = tags
    }

    return this.#apiRequest({ logTag, path: `/contacts/${ contactId }/edit`, method: 'patch', body })
  }

  /**
   * @operationName Delete Contact
   * @category Contacts
   * @description Permanently deletes a Mautic contact by ID. Returns the deleted contact record wrapped under the "contact" key. This action cannot be undone.
   * @route DELETE /contacts/{id}
   *
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the contact to delete."}
   *
   * @returns {Object}
   * @sampleResult {"contact":{"id":47,"fields":{"core":{"email":{"value":"jane@example.com"}}}}}
   */
  async deleteContact(contactId) {
    const logTag = '[deleteContact]'

    return this.#apiRequest({ logTag, path: `/contacts/${ contactId }/delete`, method: 'delete' })
  }

  // ─────────────────────────────────────────────────────────────
  // Segments (lists)
  // ─────────────────────────────────────────────────────────────

  /**
   * @operationName List Segments
   * @category Segments
   * @description Lists Mautic segments (contact lists) with optional search and pagination. Mautic returns the segments as an object keyed by ID; this operation normalizes them into a "lists" array and includes the "total" count.
   * @route GET /segments
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to segment name and alias."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of segments to return. Defaults to 30."}
   * @paramDef {"type":"Number","label":"Start","name":"start","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based offset of the first record, for pagination."}
   *
   * @returns {Object}
   * @sampleResult {"total":1,"lists":[{"id":3,"name":"Newsletter","alias":"newsletter","isPublished":true}]}
   */
  async listSegments(search, limit, start) {
    const logTag = '[listSegments]'

    const response = await this.#apiRequest({
      logTag,
      path: '/segments',
      query: { search, limit: limit || DEFAULT_LIST_LIMIT, start },
    })

    return { total: response.total, lists: this.#normalizeList(response.lists) }
  }

  /**
   * @operationName Create Segment
   * @category Segments
   * @description Creates a new Mautic segment (contact list) with a display name and optional alias and description. Returns the created segment wrapped under the "list" key.
   * @route POST /segments/new
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Display name of the segment."}
   * @paramDef {"type":"String","label":"Alias","name":"alias","description":"Optional URL-safe alias. Mautic generates one from the name if omitted."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Optional description of the segment."}
   * @paramDef {"type":"Boolean","label":"Published","name":"isPublished","uiComponent":{"type":"TOGGLE"},"description":"Whether the segment is published. Defaults to true."}
   *
   * @returns {Object}
   * @sampleResult {"list":{"id":5,"name":"VIP Customers","alias":"vip-customers","isPublished":true}}
   */
  async createSegment(name, alias, description, isPublished) {
    const logTag = '[createSegment]'

    const body = clean({
      name,
      alias,
      description,
      isPublished: isPublished === undefined ? true : isPublished,
    })

    return this.#apiRequest({ logTag, path: '/segments/new', method: 'post', body })
  }

  /**
   * @operationName Add Contact to Segment
   * @category Segments
   * @description Adds a contact to a Mautic segment (contact list). Returns a success flag. If the contact is already a member, Mautic still reports success.
   * @route POST /segments/{segmentId}/contact/{contactId}/add
   *
   * @paramDef {"type":"Number","label":"Segment ID","name":"segmentId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getSegmentsDictionary","description":"ID of the segment to add the contact to."}
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the contact to add."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async addContactToSegment(segmentId, contactId) {
    const logTag = '[addContactToSegment]'

    return this.#apiRequest({
      logTag,
      path: `/segments/${ segmentId }/contact/${ contactId }/add`,
      method: 'post',
      body: {},
    })
  }

  /**
   * @operationName Remove Contact from Segment
   * @category Segments
   * @description Removes a contact from a Mautic segment (contact list). Returns a success flag.
   * @route POST /segments/{segmentId}/contact/{contactId}/remove
   *
   * @paramDef {"type":"Number","label":"Segment ID","name":"segmentId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getSegmentsDictionary","description":"ID of the segment to remove the contact from."}
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the contact to remove."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async removeContactFromSegment(segmentId, contactId) {
    const logTag = '[removeContactFromSegment]'

    return this.#apiRequest({
      logTag,
      path: `/segments/${ segmentId }/contact/${ contactId }/remove`,
      method: 'post',
      body: {},
    })
  }

  // ─────────────────────────────────────────────────────────────
  // Campaigns
  // ─────────────────────────────────────────────────────────────

  /**
   * @operationName List Campaigns
   * @category Campaigns
   * @description Lists Mautic campaigns with optional search and pagination. Mautic returns the campaigns as an object keyed by ID; this operation normalizes them into a "campaigns" array and includes the "total" count.
   * @route GET /campaigns
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to campaign name and alias."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of campaigns to return. Defaults to 30."}
   * @paramDef {"type":"Number","label":"Start","name":"start","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based offset of the first record, for pagination."}
   *
   * @returns {Object}
   * @sampleResult {"total":1,"campaigns":[{"id":2,"name":"Onboarding","isPublished":true}]}
   */
  async listCampaigns(search, limit, start) {
    const logTag = '[listCampaigns]'

    const response = await this.#apiRequest({
      logTag,
      path: '/campaigns',
      query: { search, limit: limit || DEFAULT_LIST_LIMIT, start },
    })

    return { total: response.total, campaigns: this.#normalizeList(response.campaigns) }
  }

  /**
   * @operationName Get Campaign
   * @category Campaigns
   * @description Retrieves a single Mautic campaign by ID, including its events and associated segments. Returns the campaign wrapped under the "campaign" key.
   * @route GET /campaigns/{id}
   *
   * @paramDef {"type":"Number","label":"Campaign ID","name":"campaignId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getCampaignsDictionary","description":"ID of the campaign to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"campaign":{"id":2,"name":"Onboarding","isPublished":true,"events":[]}}
   */
  async getCampaign(campaignId) {
    const logTag = '[getCampaign]'

    return this.#apiRequest({ logTag, path: `/campaigns/${ campaignId }` })
  }

  /**
   * @operationName Add Contact to Campaign
   * @category Campaigns
   * @description Adds a contact to a Mautic campaign, enrolling them so campaign events begin evaluating for that contact. Returns a success flag.
   * @route POST /campaigns/{campaignId}/contact/{contactId}/add
   *
   * @paramDef {"type":"Number","label":"Campaign ID","name":"campaignId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getCampaignsDictionary","description":"ID of the campaign to add the contact to."}
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the contact to add."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async addContactToCampaign(campaignId, contactId) {
    const logTag = '[addContactToCampaign]'

    return this.#apiRequest({
      logTag,
      path: `/campaigns/${ campaignId }/contact/${ contactId }/add`,
      method: 'post',
      body: {},
    })
  }

  /**
   * @operationName Remove Contact from Campaign
   * @category Campaigns
   * @description Removes a contact from a Mautic campaign, un-enrolling them so campaign events no longer fire for that contact. Returns a success flag.
   * @route POST /campaigns/{campaignId}/contact/{contactId}/remove
   *
   * @paramDef {"type":"Number","label":"Campaign ID","name":"campaignId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getCampaignsDictionary","description":"ID of the campaign to remove the contact from."}
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the contact to remove."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async removeContactFromCampaign(campaignId, contactId) {
    const logTag = '[removeContactFromCampaign]'

    return this.#apiRequest({
      logTag,
      path: `/campaigns/${ campaignId }/contact/${ contactId }/remove`,
      method: 'post',
      body: {},
    })
  }

  // ─────────────────────────────────────────────────────────────
  // Companies
  // ─────────────────────────────────────────────────────────────

  /**
   * @operationName Create Company
   * @category Companies
   * @description Creates a new Mautic company with core fields plus any custom company fields. Returns the created company wrapped under the "company" key.
   * @route POST /companies/new
   *
   * @paramDef {"type":"String","label":"Company Name","name":"companyname","required":true,"description":"Name of the company."}
   * @paramDef {"type":"String","label":"Email","name":"companyemail","description":"Company email address."}
   * @paramDef {"type":"String","label":"Website","name":"companywebsite","description":"Company website URL."}
   * @paramDef {"type":"String","label":"City","name":"companycity","description":"City of the company."}
   * @paramDef {"type":"String","label":"Country","name":"companycountry","description":"Country of the company."}
   * @paramDef {"type":"String","label":"Phone","name":"companyphone","description":"Company phone number."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Additional company fields as key/value pairs. Keys must match your Mautic company field aliases."}
   *
   * @returns {Object}
   * @sampleResult {"company":{"id":9,"fields":{"core":{"companyname":{"value":"Acme Inc"}}}}}
   */
  async createCompany(companyname, companyemail, companywebsite, companycity, companycountry, companyphone, customFields) {
    const logTag = '[createCompany]'

    const body = {
      ...(customFields || {}),
      ...clean({ companyname, companyemail, companywebsite, companycity, companycountry, companyphone }),
    }

    return this.#apiRequest({ logTag, path: '/companies/new', method: 'post', body })
  }

  /**
   * @operationName List Companies
   * @category Companies
   * @description Lists Mautic companies with optional search and pagination. Mautic returns the companies as an object keyed by ID; this operation normalizes them into a "companies" array and includes the "total" count.
   * @route GET /companies
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to company name."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of companies to return. Defaults to 30."}
   * @paramDef {"type":"Number","label":"Start","name":"start","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based offset of the first record, for pagination."}
   *
   * @returns {Object}
   * @sampleResult {"total":1,"companies":[{"id":9,"fields":{"core":{"companyname":{"value":"Acme Inc"}}}}]}
   */
  async listCompanies(search, limit, start) {
    const logTag = '[listCompanies]'

    const response = await this.#apiRequest({
      logTag,
      path: '/companies',
      query: { search, limit: limit || DEFAULT_LIST_LIMIT, start },
    })

    return { total: response.total, companies: this.#normalizeList(response.companies) }
  }

  /**
   * @operationName Get Company
   * @category Companies
   * @description Retrieves a single Mautic company by ID, including its field values. Returns the company wrapped under the "company" key.
   * @route GET /companies/{id}
   *
   * @paramDef {"type":"Number","label":"Company ID","name":"companyId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the company to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"company":{"id":9,"fields":{"core":{"companyname":{"value":"Acme Inc"},"companyemail":{"value":"info@acme.com"}}}}}
   */
  async getCompany(companyId) {
    const logTag = '[getCompany]'

    return this.#apiRequest({ logTag, path: `/companies/${ companyId }` })
  }

  /**
   * @operationName Edit Company
   * @category Companies
   * @description Updates an existing Mautic company by ID using a PATCH, modifying only the fields you supply. Returns the updated company wrapped under the "company" key.
   * @route PATCH /companies/{id}/edit
   *
   * @paramDef {"type":"Number","label":"Company ID","name":"companyId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the company to update."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyname","description":"New company name."}
   * @paramDef {"type":"String","label":"Email","name":"companyemail","description":"New company email address."}
   * @paramDef {"type":"String","label":"Website","name":"companywebsite","description":"New company website URL."}
   * @paramDef {"type":"String","label":"City","name":"companycity","description":"New company city."}
   * @paramDef {"type":"String","label":"Country","name":"companycountry","description":"New company country."}
   * @paramDef {"type":"String","label":"Phone","name":"companyphone","description":"New company phone number."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Additional company fields as key/value pairs. Keys must match your Mautic company field aliases."}
   *
   * @returns {Object}
   * @sampleResult {"company":{"id":9,"fields":{"core":{"companyname":{"value":"Acme International"}}}}}
   */
  async editCompany(companyId, companyname, companyemail, companywebsite, companycity, companycountry, companyphone, customFields) {
    const logTag = '[editCompany]'

    const body = {
      ...(customFields || {}),
      ...clean({ companyname, companyemail, companywebsite, companycity, companycountry, companyphone }),
    }

    return this.#apiRequest({ logTag, path: `/companies/${ companyId }/edit`, method: 'patch', body })
  }

  /**
   * @operationName Delete Company
   * @category Companies
   * @description Permanently deletes a Mautic company by ID. Returns the deleted company record wrapped under the "company" key. This action cannot be undone.
   * @route DELETE /companies/{id}
   *
   * @paramDef {"type":"Number","label":"Company ID","name":"companyId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the company to delete."}
   *
   * @returns {Object}
   * @sampleResult {"company":{"id":9,"fields":{"core":{"companyname":{"value":"Acme Inc"}}}}}
   */
  async deleteCompany(companyId) {
    const logTag = '[deleteCompany]'

    return this.#apiRequest({ logTag, path: `/companies/${ companyId }/delete`, method: 'delete' })
  }

  /**
   * @operationName Add Contact to Company
   * @category Companies
   * @description Associates a contact with a Mautic company. Returns a success flag.
   * @route POST /companies/{companyId}/contact/{contactId}/add
   *
   * @paramDef {"type":"Number","label":"Company ID","name":"companyId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the company to associate the contact with."}
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the contact to associate."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async addContactToCompany(companyId, contactId) {
    const logTag = '[addContactToCompany]'

    return this.#apiRequest({
      logTag,
      path: `/companies/${ companyId }/contact/${ contactId }/add`,
      method: 'post',
      body: {},
    })
  }

  // ─────────────────────────────────────────────────────────────
  // Emails
  // ─────────────────────────────────────────────────────────────

  /**
   * @operationName List Emails
   * @category Emails
   * @description Lists Mautic emails with optional search and pagination. Mautic returns the emails as an object keyed by ID; this operation normalizes them into an "emails" array and includes the "total" count.
   * @route GET /emails
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to email name and subject."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of emails to return. Defaults to 30."}
   * @paramDef {"type":"Number","label":"Start","name":"start","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based offset of the first record, for pagination."}
   *
   * @returns {Object}
   * @sampleResult {"total":1,"emails":[{"id":12,"name":"Welcome Email","subject":"Welcome!","emailType":"template","isPublished":true}]}
   */
  async listEmails(search, limit, start) {
    const logTag = '[listEmails]'

    const response = await this.#apiRequest({
      logTag,
      path: '/emails',
      query: { search, limit: limit || DEFAULT_LIST_LIMIT, start },
    })

    return { total: response.total, emails: this.#normalizeList(response.emails) }
  }

  /**
   * @operationName Send Email to Contact
   * @category Emails
   * @description Sends an existing Mautic email to a single contact by their IDs. The email must be a template email that is published. Returns a success flag.
   * @route POST /emails/{emailId}/contact/{contactId}/send
   *
   * @paramDef {"type":"Number","label":"Email ID","name":"emailId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getEmailsDictionary","description":"ID of the email to send."}
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the contact to send the email to."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async sendEmailToContact(emailId, contactId) {
    const logTag = '[sendEmailToContact]'

    return this.#apiRequest({
      logTag,
      path: `/emails/${ emailId }/contact/${ contactId }/send`,
      method: 'post',
      body: {},
    })
  }

  /**
   * @operationName Send Email to Segment
   * @category Emails
   * @description Sends an existing Mautic segment email to all contacts in one of its associated segments. The email must be a segment/list email assigned to the given segment. Returns counts of successfully sent, failed, and pending messages.
   * @route POST /emails/{emailId}/send
   *
   * @paramDef {"type":"Number","label":"Email ID","name":"emailId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getEmailsDictionary","description":"ID of the segment email to send."}
   *
   * @returns {Object}
   * @sampleResult {"success":1,"sentCount":42,"failedCount":0}
   */
  async sendEmailToSegment(emailId) {
    const logTag = '[sendEmailToSegment]'

    return this.#apiRequest({
      logTag,
      path: `/emails/${ emailId }/send`,
      method: 'post',
      body: {},
    })
  }

  // ─────────────────────────────────────────────────────────────
  // Tags
  // ─────────────────────────────────────────────────────────────

  /**
   * @operationName List Tags
   * @category Tags
   * @description Lists all Mautic tags with optional search and pagination. Mautic returns the tags as an object keyed by ID; this operation normalizes them into a "tags" array and includes the "total" count. To apply or remove tags, use Create Contact or Edit Contact with the Tags field (prefix a tag with a minus sign to remove it).
   * @route GET /tags
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to the tag name."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tags to return. Defaults to 30."}
   * @paramDef {"type":"Number","label":"Start","name":"start","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based offset of the first record, for pagination."}
   *
   * @returns {Object}
   * @sampleResult {"total":2,"tags":[{"id":1,"tag":"newsletter"},{"id":2,"tag":"vip"}]}
   */
  async listTags(search, limit, start) {
    const logTag = '[listTags]'

    const response = await this.#apiRequest({
      logTag,
      path: '/tags',
      query: { search, limit: limit || DEFAULT_LIST_LIMIT, start },
    })

    return { total: response.total, tags: this.#normalizeList(response.tags) }
  }

  // ─────────────────────────────────────────────────────────────
  // Notes
  // ─────────────────────────────────────────────────────────────

  /**
   * @operationName Create Note
   * @category Notes
   * @description Creates a note attached to a Mautic contact. Notes are timeline entries used for internal record-keeping. Returns the created note wrapped under the "note" key.
   * @route POST /notes/new
   *
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the contact the note belongs to."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Body text of the note. Supports HTML."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["General","Call","Email","Meeting"]}},"description":"Type of note. Defaults to General."}
   *
   * @returns {Object}
   * @sampleResult {"note":{"id":21,"text":"Called and left a voicemail.","type":"call","lead":{"id":47}}}
   */
  async createNote(contactId, text, type) {
    const logTag = '[createNote]'

    const body = clean({
      lead: contactId,
      text,
      type: this.#resolveChoice(type, { General: 'general', Call: 'call', Email: 'email', Meeting: 'meeting' }) || 'general',
    })

    return this.#apiRequest({ logTag, path: '/notes/new', method: 'post', body })
  }

  /**
   * @operationName List Notes
   * @category Notes
   * @description Lists Mautic contact notes with optional search and pagination. Mautic returns the notes as an object keyed by ID; this operation normalizes them into a "notes" array and includes the "total" count.
   * @route GET /notes
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter. Use lead:{id} to filter notes for a specific contact."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of notes to return. Defaults to 30."}
   * @paramDef {"type":"Number","label":"Start","name":"start","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based offset of the first record, for pagination."}
   *
   * @returns {Object}
   * @sampleResult {"total":1,"notes":[{"id":21,"text":"Called and left a voicemail.","type":"call"}]}
   */
  async listNotes(search, limit, start) {
    const logTag = '[listNotes]'

    const response = await this.#apiRequest({
      logTag,
      path: '/notes',
      query: { search, limit: limit || DEFAULT_LIST_LIMIT, start },
    })

    return { total: response.total, notes: this.#normalizeList(response.notes) }
  }

  // ─────────────────────────────────────────────────────────────
  // Forms & Stages
  // ─────────────────────────────────────────────────────────────

  /**
   * @operationName List Forms
   * @category Forms & Stages
   * @description Lists Mautic forms with optional search and pagination. Mautic returns the forms as an object keyed by ID; this operation normalizes them into a "forms" array and includes the "total" count.
   * @route GET /forms
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to form name and alias."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of forms to return. Defaults to 30."}
   * @paramDef {"type":"Number","label":"Start","name":"start","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based offset of the first record, for pagination."}
   *
   * @returns {Object}
   * @sampleResult {"total":1,"forms":[{"id":4,"name":"Contact Us","alias":"contactus","isPublished":true}]}
   */
  async listForms(search, limit, start) {
    const logTag = '[listForms]'

    const response = await this.#apiRequest({
      logTag,
      path: '/forms',
      query: { search, limit: limit || DEFAULT_LIST_LIMIT, start },
    })

    return { total: response.total, forms: this.#normalizeList(response.forms) }
  }

  /**
   * @operationName List Stages
   * @category Forms & Stages
   * @description Lists Mautic stages with optional search and pagination. Stages represent a contact's position in your marketing/sales funnel. Mautic returns the stages as an object keyed by ID; this operation normalizes them into a "stages" array and includes the "total" count.
   * @route GET /stages
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to the stage name."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of stages to return. Defaults to 30."}
   * @paramDef {"type":"Number","label":"Start","name":"start","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based offset of the first record, for pagination."}
   *
   * @returns {Object}
   * @sampleResult {"total":1,"stages":[{"id":1,"name":"Lead","weight":0,"isPublished":true}]}
   */
  async listStages(search, limit, start) {
    const logTag = '[listStages]'

    const response = await this.#apiRequest({
      logTag,
      path: '/stages',
      query: { search, limit: limit || DEFAULT_LIST_LIMIT, start },
    })

    return { total: response.total, stages: this.#normalizeList(response.stages) }
  }

  /**
   * @operationName Add Contact to Stage
   * @category Forms & Stages
   * @description Moves a contact into a Mautic stage by their IDs, setting the contact's funnel position. Returns a success flag.
   * @route POST /stages/{stageId}/contact/{contactId}/add
   *
   * @paramDef {"type":"Number","label":"Stage ID","name":"stageId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the stage to move the contact into."}
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the contact to move."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async addContactToStage(stageId, contactId) {
    const logTag = '[addContactToStage]'

    return this.#apiRequest({
      logTag,
      path: `/stages/${ stageId }/contact/${ contactId }/add`,
      method: 'post',
      body: {},
    })
  }

  // ─────────────────────────────────────────────────────────────
  // Dictionaries
  // ─────────────────────────────────────────────────────────────

  /**
   * @typedef {Object} getSegmentsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to segment name and alias."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Zero-based record offset used for pagination."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Segments Dictionary
   * @description Provides a searchable list of Mautic segments for selecting a segment in dependent parameters. The option value is the numeric segment ID.
   * @route POST /get-segments-dictionary
   * @paramDef {"type":"getSegmentsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Newsletter","value":"3","note":"newsletter"}],"cursor":"30"}
   */
  async getSegmentsDictionary(payload) {
    const logTag = '[getSegmentsDictionary]'
    const { search, cursor } = payload || {}
    const start = cursor ? Number(cursor) : 0

    const response = await this.#apiRequest({
      logTag,
      path: '/segments',
      query: { search, limit: DEFAULT_LIST_LIMIT, start },
    })

    const segments = this.#normalizeList(response.lists)

    return {
      items: segments.map(s => ({ label: s.name, value: String(s.id), note: s.alias })),
      cursor: segments.length === DEFAULT_LIST_LIMIT ? String(start + DEFAULT_LIST_LIMIT) : undefined,
    }
  }

  /**
   * @typedef {Object} getCampaignsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to campaign name and alias."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Zero-based record offset used for pagination."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Campaigns Dictionary
   * @description Provides a searchable list of Mautic campaigns for selecting a campaign in dependent parameters. The option value is the numeric campaign ID.
   * @route POST /get-campaigns-dictionary
   * @paramDef {"type":"getCampaignsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Onboarding","value":"2","note":"Published"}],"cursor":"30"}
   */
  async getCampaignsDictionary(payload) {
    const logTag = '[getCampaignsDictionary]'
    const { search, cursor } = payload || {}
    const start = cursor ? Number(cursor) : 0

    const response = await this.#apiRequest({
      logTag,
      path: '/campaigns',
      query: { search, limit: DEFAULT_LIST_LIMIT, start },
    })

    const campaigns = this.#normalizeList(response.campaigns)

    return {
      items: campaigns.map(c => ({
        label: c.name,
        value: String(c.id),
        note: c.isPublished ? 'Published' : 'Unpublished',
      })),
      cursor: campaigns.length === DEFAULT_LIST_LIMIT ? String(start + DEFAULT_LIST_LIMIT) : undefined,
    }
  }

  /**
   * @typedef {Object} getEmailsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to email name and subject."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Zero-based record offset used for pagination."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Emails Dictionary
   * @description Provides a searchable list of Mautic emails for selecting an email in dependent parameters. The option value is the numeric email ID.
   * @route POST /get-emails-dictionary
   * @paramDef {"type":"getEmailsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Welcome Email","value":"12","note":"template"}],"cursor":"30"}
   */
  async getEmailsDictionary(payload) {
    const logTag = '[getEmailsDictionary]'
    const { search, cursor } = payload || {}
    const start = cursor ? Number(cursor) : 0

    const response = await this.#apiRequest({
      logTag,
      path: '/emails',
      query: { search, limit: DEFAULT_LIST_LIMIT, start },
    })

    const emails = this.#normalizeList(response.emails)

    return {
      items: emails.map(e => ({ label: e.name, value: String(e.id), note: e.emailType })),
      cursor: emails.length === DEFAULT_LIST_LIMIT ? String(start + DEFAULT_LIST_LIMIT) : undefined,
    }
  }

  /**
   * @typedef {Object} getFormsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to form name and alias."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Zero-based record offset used for pagination."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Forms Dictionary
   * @description Provides a searchable list of Mautic forms for selecting a form in dependent parameters. The option value is the numeric form ID.
   * @route POST /get-forms-dictionary
   * @paramDef {"type":"getFormsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Contact Us","value":"4","note":"contactus"}],"cursor":"30"}
   */
  async getFormsDictionary(payload) {
    const logTag = '[getFormsDictionary]'
    const { search, cursor } = payload || {}
    const start = cursor ? Number(cursor) : 0

    const response = await this.#apiRequest({
      logTag,
      path: '/forms',
      query: { search, limit: DEFAULT_LIST_LIMIT, start },
    })

    const forms = this.#normalizeList(response.forms)

    return {
      items: forms.map(f => ({ label: f.name, value: String(f.id), note: f.alias })),
      cursor: forms.length === DEFAULT_LIST_LIMIT ? String(start + DEFAULT_LIST_LIMIT) : undefined,
    }
  }
}

Flowrunner.ServerCode.addService(MauticService, [
  {
    name: 'baseUrl',
    displayName: 'Instance URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Mautic instance URL, e.g. https://mautic.example.com (strip any trailing slash). The REST API must be enabled in Configuration -> API Settings.',
  },
  {
    name: 'username',
    displayName: 'Username',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'A Mautic user with API access.',
  },
  {
    name: 'password',
    displayName: 'Password',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: "That user's password. Basic Auth must be enabled in Mautic's Configuration -> API Settings.",
  },
])
