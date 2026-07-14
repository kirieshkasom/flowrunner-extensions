// Intercom integration: contacts, companies, conversations, tickets, messages,
// tags, notes, events, data attributes, Help Center articles, and polling triggers.
// Auth is OAuth2; Intercom issues no refresh token (tokens are long-lived), so
// refreshToken() is a no-op passthrough. Webhooks are not API-manageable (they are
// configured only in the Developer Hub), so triggers poll the search API by created_at.

// ============================================================================
//  CONSTANTS
// ============================================================================
const API_BASE = 'https://api.intercom.io'
const AUTHORIZE_URL = 'https://app.intercom.com/oauth'
const TOKEN_URL = 'https://api.intercom.io/auth/eagle/token'
const ME_URL = 'https://api.intercom.io/me'
const INTERCOM_VERSION = '2.14'

// Default page size for list/search endpoints.
const DEFAULT_PAGE_SIZE = 50

// How many seconds the polling watermark is held behind real time. Intercom's search index can
// make a record queryable a few seconds after its created_at, so a record created at T may not
// appear until T+lag. Holding the watermark at (now - LAG) keeps re-querying that recent window
// until it ages out, so a late-indexed record is caught instead of being skipped past.
const POLL_LAG_SECONDS = 60

const ERROR_HINTS = {
  400: 'Invalid request — check the required fields and their values.',
  401: 'Authentication failed — reconnect the Intercom account.',
  403: 'Permission denied — the connected app is missing the scope for this action.',
  404: 'Not found — the ID may be wrong; use the matching "Get …"/dictionary action to pick a valid one.',
  422: 'Invalid request — check the required fields and their values.',
  429: 'Intercom rate limit hit — retry in a moment.',
}

// Friendly DROPDOWN labels the UI shows, mapped to the API values Intercom expects.
const SEARCH_OPERATOR_MAP = {
  'Equals': '=',
  'Not equals': '!=',
  'In list': 'IN',
  'Not in list': 'NIN',
  'Less than': '<',
  'Greater than': '>',
  'Contains': '~',
  'Does not contain': '!~',
  'Starts with': '^',
  'Ends with': '$',
}
const ROLE_MAP = {
  'User': 'user',
  'Lead': 'lead',
}
const CONVERSATION_CONTACT_TYPE_MAP = {
  'User': 'user',
  'Lead': 'lead',
  'Contact': 'contact',
}
const REPLY_AS_MAP = {
  'Admin — Public Reply': 'admin_comment',
  'Admin — Internal Note': 'admin_note',
  'On Behalf of User': 'user',
}
const ASSIGN_TYPE_MAP = {
  'Admin': 'admin',
  'Team': 'team',
}
const MESSAGE_TYPE_MAP = {
  'In-App': 'in_app',
  'Email': 'email',
}
const EMAIL_TEMPLATE_MAP = {
  'Plain': 'plain',
  'Personal': 'personal',
}
const SUBMIT_EVENT_IDENTIFIER_MAP = {
  'Your User ID': 'user_id',
  'Intercom Contact ID': 'id',
  'Email': 'email',
}
const LIST_EVENTS_IDENTIFIER_MAP = {
  'Your User ID': 'user_id',
  'Intercom Contact ID': 'intercom_user_id',
  'Email': 'email',
}
const DATA_ATTRIBUTE_LIST_MODEL_MAP = {
  'Contact': 'contact',
  'Company': 'company',
  'Conversation': 'conversation',
}
const DATA_ATTRIBUTE_CREATE_MODEL_MAP = {
  'Contact': 'contact',
  'Company': 'company',
}
const DATA_ATTRIBUTE_TYPE_MAP = {
  'Text': 'string',
  'Integer': 'integer',
  'Decimal': 'float',
  'True/False': 'boolean',
  'Date': 'date',
  'Date & Time': 'datetime',
  'List (Options)': 'options',
}
const ARTICLE_STATE_MAP = {
  'Draft': 'draft',
  'Published': 'published',
}
const ARTICLE_PARENT_TYPE_MAP = {
  'Collection': 'collection',
  'Section': 'section',
}
const CONSENT_TYPE_MAP = {
  'Opt In': 'opt_in',
  'Opt Out': 'opt_out',
}

// ============================================================================
//  LOGGER
// ============================================================================
const logger = {
  info: (...args) => console.log('[Intercom] info:', ...args),
  debug: (...args) => console.log('[Intercom] debug:', ...args),
  error: (...args) => console.log('[Intercom] error:', ...args),
  warn: (...args) => console.log('[Intercom] warn:', ...args),
}

// ============================================================================
//  DICTIONARY PAYLOAD TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} getContactsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to match contacts by name or email."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of contacts."}
 */

/**
 * @typedef {Object} getCompaniesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter companies by name. Filtering is performed locally on retrieved results."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination page number for the next page of companies."}
 */

/**
 * @typedef {Object} getConversationsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter conversations locally by id or subject."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of conversations."}
 */

/**
 * @typedef {Object} getAdminsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter admins by name or email. Filtering is performed locally."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Unused — admins are returned in a single list."}
 */

/**
 * @typedef {Object} getTeamsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter teams by name. Filtering is performed locally."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Unused — teams are returned in a single list."}
 */

/**
 * @typedef {Object} getAssigneesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter assignees by name or email. Filtering is performed locally."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Unused — admins and teams are returned in a single list."}
 */

/**
 * @typedef {Object} getTagsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter tags by name. Filtering is performed locally."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Unused — tags are returned in a single list."}
 */

/**
 * @typedef {Object} getTicketTypesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter ticket types by name. Filtering is performed locally."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Unused — ticket types are returned in a single list."}
 */

/**
 * @typedef {Object} getTicketsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter recent tickets locally by ticket number or title."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of tickets."}
 */

/**
 * @typedef {Object} getSubscriptionTypesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter subscription types locally."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Unused — subscription types are returned in a single list."}
 */

/**
 * @typedef {Object} getCollectionsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter collections by name. Filtering is performed locally."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of collections."}
 */

/**
 * @typedef {Object} getSegmentsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter segments by name. Filtering is performed locally."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Unused — segments are returned in a single list."}
 */

/**
 * @typedef {Object} getArticlesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter articles locally by title."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of articles."}
 */

/**
 * @typedef {Object} getDataAttributesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter data attributes by name. Filtering is performed locally."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Unused — data attributes are returned in a single list."}
 */

/**
 * @typedef {Object} getTicketStatesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter ticket states by name. Filtering is performed locally."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Unused — ticket states are returned in a single list."}
 */

/**
 * @typedef {Object} getNotesDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"description":"The contact whose notes to list."}
 */

/**
 * @typedef {Object} getNotesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter the contact's notes locally by body."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of notes."}
 * @paramDef {"type":"getNotesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the contact whose notes to list."}
 */

/**
 * @integrationName Intercom
 * @integrationIcon /icon.svg
 * @requireOAuth
 * @integrationTriggersScope SINGLE_APP
 */
class Intercom {
  constructor(config) {
    this.config = config || {}
    this.clientId = this.config.clientId
    this.clientSecret = this.config.clientSecret
  }

  // ==========================================================================
  //  CORE - every external call goes through #apiRequest
  // ==========================================================================
  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'

    try {
      logger.debug(`${ logTag } ${ method.toUpperCase() } ${ url }`)

      const hasBody = body !== undefined && body !== null
      const request = Flowrunner.Request[method](url)
        .set(this.#headers(hasBody))
        .query(query || {})

      if (hasBody) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      this.#handleError(error, logTag)
    }
  }

  // Authorization + version on every call; Content-Type only when a JSON body is sent.
  #headers(hasBody) {
    const headers = {
      Authorization: `Bearer ${ this.#getAccessToken() }`,
      Accept: 'application/json',
      'Intercom-Version': INTERCOM_VERSION,
    }

    if (hasBody) {
      headers['Content-Type'] = 'application/json'
    }

    return headers
  }

  #handleError(error, logTag) {
    const status = error?.status || error?.body?.status
    const firstError = error?.body?.errors && error.body.errors[0]
    const apiMessage = (firstError && firstError.message) || error?.body?.error?.message || error?.body?.message || error?.message || 'Request failed'

    const friendly = ERROR_HINTS[status]

    logger.error(`${ logTag } failed: ${ apiMessage }`)

    throw new Error(friendly ? `${ friendly } (${ apiMessage })` : apiMessage)
  }

  // Translate a friendly DROPDOWN label into the API value; pass through anything unmapped.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Removes keys whose value is null/undefined so optional fields are omitted from the body.
  #compact(obj) {
    const out = {}

    for (const [key, value] of Object.entries(obj)) {
      if (value !== null && value !== undefined) {
        out[key] = value
      }
    }

    return out
  }

  // Builds a single-filter search body shared by contacts/conversations/tickets search.
  // The IN / NIN operators expect a list of values, so a comma-separated Value is split into an
  // array for those operators (other operators take the single value as-is).
  #searchBody(field, operator, value, perPage) {
    const isListOperator = operator === 'IN' || operator === 'NIN'
    const queryValue = isListOperator
      ? String(value ?? '').split(',').map(part => part.trim()).filter(part => part !== '')
      : value

    return {
      query: { field, operator, value: queryValue },
      pagination: { per_page: perPage || DEFAULT_PAGE_SIZE },
    }
  }

  // ==========================================================================
  //  OAUTH2 SYSTEM METHODS
  // ==========================================================================
  #getAccessToken() {
    return this.request.headers['oauth-access-token']
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   */
  async getOAuth2ConnectionURL() {
    // redirect_uri is injected by the Flowrunner OAuth runtime (and by the local harness) - the
    // service must NOT add it. Intercom sets scopes in the Developer Hub, so no scope param either.
    const params = new URLSearchParams({
      client_id: this.clientId,
      state: this.request?.headers?.['oauth-state'] || 'intercom',
      response_type: 'code',
    })

    return `${ AUTHORIZE_URL }?${ params.toString() }`
  }

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   */
  async executeCallback(callbackObject) {
    // docs: https://developers.intercom.com/docs/build-an-integration/learn-more/authentication/setting-up-oauth
    const tokenResponse = await Flowrunner.Request.post(TOKEN_URL)
      .set({ 'Content-Type': 'application/json', Accept: 'application/json' })
      .send({
        code: callbackObject.code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      })

    const accessToken = tokenResponse.access_token || tokenResponse.token

    let identityName = null

    try {
      // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/admins/identifyadmin
      const me = await Flowrunner.Request.get(ME_URL)
        .set({ Authorization: `Bearer ${ accessToken }`, Accept: 'application/json', 'Intercom-Version': INTERCOM_VERSION })

      identityName = me?.name || me?.email || me?.app?.name || null
    } catch (error) {
      logger.warn(`executeCallback identity lookup failed: ${ error.message }`)
    }

    return {
      // Intercom tokens are long-lived and have NO expiry and NO refresh token.
      token: accessToken,
      connectionIdentityName: identityName,
      overwrite: true,
    }
  }

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   */
  async refreshToken(refreshToken) {
    // Intercom issues NO refresh token and exposes NO refresh endpoint - access tokens are valid
    // until the user revokes access. This is a documented no-op passthrough; it calls nothing.
    return { token: refreshToken }
  }

  // ==========================================================================
  //  ACTIONS - Contacts
  // ==========================================================================
  /**
   * @operationName Create Contact
   * @category Contacts
   * @description Creates a new contact (a User or a Lead) in Intercom. Provide at least an email, an external ID, or a role. Use this to add a person to your workspace before messaging, tagging, or starting a conversation with them.
   * @route POST /create-contact
   * @paramDef {"type":"String","label":"Email","name":"email","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The contact's email. At least one of Email, External ID, or Role is required."}
   * @paramDef {"type":"String","label":"Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The contact's full name."}
   * @paramDef {"type":"String","label":"Role","name":"role","uiComponent":{"type":"DROPDOWN","options":{"values":["User","Lead"]}},"description":"Whether the contact is a known User or an anonymous Lead. Defaults to lead if only an email is given."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The contact's phone in E.164 format, e.g. +353871234567."}
   * @paramDef {"type":"String","label":"External ID","name":"externalReference","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Your own unique identifier for this contact (a free-text value you supply). Use it to upsert or find the contact later."}
   * @paramDef {"type":"String","label":"Avatar URL","name":"avatar","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"A public image URL for the contact's avatar."}
   * @paramDef {"type":"Number","label":"Owner Admin ID","name":"ownerId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The admin id assigned account ownership of this contact."}
   * @paramDef {"type":"Boolean","label":"Unsubscribed From Emails","name":"unsubscribedFromEmails","uiComponent":{"type":"TOGGLE"},"description":"Whether the contact is unsubscribed from emails."}
   * @paramDef {"type":"Object","label":"Custom Attributes","name":"customAttributes","freeform":true,"description":"Workspace-defined custom data attributes for the contact, as a key/value object. Keys are defined per workspace and not known ahead of time."}
   * @returns {Object}
   * @sampleResult {"type":"contact","id":"6762f0dd1bb69f9f2193bb83","role":"user","email":"joebloggs@intercom.io","name":"Joe Bloggs","phone":null,"external_id":null,"created_at":1734537437,"updated_at":1734537437,"custom_attributes":{}}
   */
  async createContact(email, name, role, phone, externalReference, avatar, ownerId, unsubscribedFromEmails, customAttributes) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/contacts/createcontact
    if (!email && !externalReference && !role) {
      throw new Error('At least one of Email, External ID, or Role is required to create a contact.')
    }

    const body = this.#compact({
      email,
      name,
      role: this.#resolveChoice(role, ROLE_MAP),
      phone,
      external_id: externalReference,
      avatar,
      owner_id: ownerId,
      unsubscribed_from_emails: unsubscribedFromEmails,
      custom_attributes: customAttributes,
    })

    return await this.#apiRequest({ url: `${ API_BASE }/contacts`, method: 'post', body, logTag: 'createContact' })
  }

  /**
   * @operationName Get Contact
   * @category Contacts
   * @description Retrieves the full details of a single contact by its Intercom ID. Use this to read a contact's attributes, tags, companies and subscription state before acting on them.
   * @route POST /get-contact
   * @paramDef {"type":"String","label":"Contact","name":"contactId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getContactsDictionary","required":true,"description":"The contact to fetch. Pick from the list."}
   * @returns {Object}
   * @sampleResult {"type":"contact","id":"6762f0dd1bb69f9f2193bb83","role":"user","email":"joebloggs@intercom.io","name":"Joe Bloggs","created_at":1734537437,"updated_at":1734537437}
   */
  async getContact(contactId) {
    if (!contactId) {
      throw new Error('A contact is required — use Get Contacts Dictionary to pick one.')
    }

    return await this.#apiRequest({ url: `${ API_BASE }/contacts/${ contactId }`, logTag: 'getContact' })
  }

  /**
   * @operationName Get Contact by External ID
   * @category Contacts
   * @description Finds a contact by the external_id you assigned when creating it. Use this to look up a contact using your own system's identifier instead of the Intercom ID.
   * @route POST /get-contact-by-external-id
   * @paramDef {"type":"String","label":"External ID","name":"externalReference","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"Your own identifier for the contact (the external_id set on create); a free-text value you supply."}
   * @returns {Object}
   * @sampleResult {"type":"contact","id":"6762f0dd1bb69f9f2193bb83","external_id":"625e90fc55ab113b6d92175f","role":"user","email":"joebloggs@intercom.io"}
   */
  async getContactByExternalId(externalReference) {
    if (!externalReference) {
      throw new Error('An external ID is required.')
    }

    return await this.#apiRequest({ url: `${ API_BASE }/contacts/find_by_external_id/${ encodeURIComponent(externalReference) }`, logTag: 'getContactByExternalId' })
  }

  /**
   * @operationName Update Contact
   * @category Contacts
   * @description Updates an existing contact's attributes. Only the fields you set are changed. Use this to enrich or correct a contact's email, name, phone, owner or custom data.
   * @route POST /update-contact
   * @paramDef {"type":"String","label":"Contact","name":"contactId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getContactsDictionary","required":true,"description":"The contact to update."}
   * @paramDef {"type":"String","label":"Email","name":"email","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New email."}
   * @paramDef {"type":"String","label":"Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New name."}
   * @paramDef {"type":"String","label":"Role","name":"role","uiComponent":{"type":"DROPDOWN","options":{"values":["User","Lead"]}},"description":"New role — set to User to promote a lead to a known user."}
   * @paramDef {"type":"String","label":"External ID","name":"externalReference","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New external_id (your own identifier for this contact; a free-text value you supply)."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New phone (E.164)."}
   * @paramDef {"type":"Number","label":"Owner Admin ID","name":"ownerId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New owner admin id."}
   * @paramDef {"type":"Boolean","label":"Unsubscribed From Emails","name":"unsubscribedFromEmails","uiComponent":{"type":"TOGGLE"},"description":"Email subscription state."}
   * @paramDef {"type":"Object","label":"Custom Attributes","name":"customAttributes","freeform":true,"description":"Custom data attributes to set, as a key/value object. Keys are workspace-defined and not known ahead of time."}
   * @returns {Object}
   * @sampleResult {"type":"contact","id":"6762f0dd1bb69f9f2193bb83","role":"user","email":"jdoe@example.com","name":"John Doe","updated_at":1734537500}
   */
  async updateContact(contactId, email, name, role, externalReference, phone, ownerId, unsubscribedFromEmails, customAttributes) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/contacts/updatecontact
    if (!contactId) {
      throw new Error('A contact is required — use Get Contacts Dictionary to pick one.')
    }

    const body = this.#compact({
      email,
      name,
      role: this.#resolveChoice(role, ROLE_MAP),
      external_id: externalReference,
      phone,
      owner_id: ownerId,
      unsubscribed_from_emails: unsubscribedFromEmails,
      custom_attributes: customAttributes,
    })

    return await this.#apiRequest({ url: `${ API_BASE }/contacts/${ contactId }`, method: 'put', body, logTag: 'updateContact' })
  }

  /**
   * @operationName Delete Contact
   * @category Contacts
   * @description Permanently deletes a single contact from Intercom. This cannot be undone. Use Archive Contact instead if you only want to hide the contact from lists.
   * @route POST /delete-contact
   * @paramDef {"type":"String","label":"Contact","name":"contactId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getContactsDictionary","required":true,"description":"The contact to permanently delete."}
   * @returns {Object}
   * @sampleResult {"type":"contact","id":"6762f0dd1bb69f9f2193bb83","external_id":null,"deleted":true}
   */
  async deleteContact(contactId) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/contacts/deletecontact
    if (!contactId) {
      throw new Error('A contact is required — use Get Contacts Dictionary to pick one.')
    }

    return await this.#apiRequest({ url: `${ API_BASE }/contacts/${ contactId }`, method: 'delete', logTag: 'deleteContact' })
  }

  /**
   * @operationName Archive Contact
   * @category Contacts
   * @description Archives a single contact, hiding them from lists without deleting them. This is reversible with Unarchive Contact. Use this to declutter active lists while keeping the record.
   * @route POST /archive-contact
   * @paramDef {"type":"String","label":"Contact","name":"contactId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getContactsDictionary","required":true,"description":"The contact to archive (hide from lists; reversible)."}
   * @returns {Object}
   * @sampleResult {"type":"contact","id":"6762f0dd1bb69f9f2193bb83","external_id":null,"archived":true}
   */
  async archiveContact(contactId) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/contacts/archivecontact
    if (!contactId) {
      throw new Error('A contact is required — use Get Contacts Dictionary to pick one.')
    }

    return await this.#apiRequest({ url: `${ API_BASE }/contacts/${ contactId }/archive`, method: 'post', logTag: 'archiveContact' })
  }

  /**
   * @operationName Unarchive Contact
   * @category Contacts
   * @description Restores a previously archived contact, returning them to active lists. Use this to reverse an Archive Contact action.
   * @route POST /unarchive-contact
   * @paramDef {"type":"String","label":"Contact","name":"contactId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getContactsDictionary","required":true,"description":"The contact to restore from archive."}
   * @returns {Object}
   * @sampleResult {"type":"contact","id":"6762f0dd1bb69f9f2193bb83","external_id":null,"archived":false}
   */
  async unarchiveContact(contactId) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/contacts/unarchivecontact
    if (!contactId) {
      throw new Error('A contact is required — use Get Contacts Dictionary to pick one.')
    }

    return await this.#apiRequest({ url: `${ API_BASE }/contacts/${ contactId }/unarchive`, method: 'post', logTag: 'unarchiveContact' })
  }

  /**
   * @operationName List Contacts
   * @category Contacts
   * @description Returns a page of contacts from your workspace. Use the cursor to page through results. Use this to browse or export contacts, or to feed a downstream action with contact IDs.
   * @route POST /list-contacts
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":50,"description":"How many contacts per page (max 150). Default: 50."}
   * @paramDef {"type":"String","label":"Cursor","name":"startingAfter","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor from a previous page's pages.next.starting_after."}
   * @returns {Object}
   * @sampleResult {"type":"list","data":[{"type":"contact","id":"6762f0dd1bb69f9f2193bb83","role":"user","email":"joebloggs@intercom.io"}],"total_count":1,"pages":{"type":"pages","page":1,"per_page":50,"total_pages":1,"next":null}}
   */
  async listContacts(perPage, startingAfter) {
    const query = this.#compact({ per_page: perPage || DEFAULT_PAGE_SIZE, starting_after: startingAfter })

    return await this.#apiRequest({ url: `${ API_BASE }/contacts`, query, logTag: 'listContacts' })
  }

  /**
   * @operationName Search Contacts
   * @category Contacts
   * @description Searches contacts by a single attribute filter (e.g. email, name, role or created_at). Use this to find contacts matching a condition before acting on them.
   * @route POST /search-contacts
   * @paramDef {"type":"String","label":"Field","name":"field","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The contact attribute to filter on (e.g. email, name, role, created_at, external_id)."}
   * @paramDef {"type":"String","label":"Operator","name":"operator","uiComponent":{"type":"DROPDOWN","options":{"values":["Equals","Not equals","In list","Not in list","Less than","Greater than","Contains","Does not contain","Starts with","Ends with"]}},"required":true,"description":"How to compare the field to the value."}
   * @paramDef {"type":"String","label":"Value","name":"value","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The value to match (a unix timestamp for date fields like created_at). For In list / Not in list, separate multiple values with commas."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":50,"description":"Results per page. Default: 50."}
   * @returns {Object}
   * @sampleResult {"type":"list","data":[{"type":"contact","id":"6762f0dd1bb69f9f2193bb83","role":"user","email":"joebloggs@intercom.io","created_at":1734537437}],"total_count":1,"pages":{"type":"pages","page":1,"per_page":50,"total_pages":1}}
   */
  async searchContacts(field, operator, value, perPage) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/contacts/searchcontacts
    if (!field || !operator) {
      throw new Error('A field and operator are required to search contacts.')
    }

    const body = this.#searchBody(field, this.#resolveChoice(operator, SEARCH_OPERATOR_MAP), value, perPage)

    return await this.#apiRequest({ url: `${ API_BASE }/contacts/search`, method: 'post', body, logTag: 'searchContacts' })
  }

  /**
   * @operationName Merge Contact
   * @category Contacts
   * @description Merges a Lead contact into a User contact, combining their data onto the user. The "from" contact must be a lead and the "into" contact must be a user. Use this to deduplicate after a known lead signs up.
   * @route POST /merge-contact
   * @paramDef {"type":"String","label":"Lead to Merge From","name":"fromId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getContactsDictionary","required":true,"description":"The LEAD contact to merge away (must have role lead)."}
   * @paramDef {"type":"String","label":"User to Merge Into","name":"intoId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getContactsDictionary","required":true,"description":"The USER contact to merge into (must have role user)."}
   * @returns {Object}
   * @sampleResult {"type":"contact","id":"5ba682d23d7cf92bef87bfd4","role":"user","email":"joebloggs@intercom.io"}
   */
  async mergeContact(fromId, intoId) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/contacts/mergecontact
    if (!fromId || !intoId) {
      throw new Error('Both the lead to merge from and the user to merge into are required.')
    }

    return await this.#apiRequest({ url: `${ API_BASE }/contacts/merge`, method: 'post', body: { from: fromId, into: intoId }, logTag: 'mergeContact' })
  }

  // ==========================================================================
  //  ACTIONS - Companies
  // ==========================================================================
  /**
   * @operationName Create or Update Company
   * @category Companies
   * @description Creates a company, or updates it if a company with the same Company ID already exists. Use this single action to keep an account record in sync from your own system, keyed by your external Company ID.
   * @route POST /create-or-update-company
   * @paramDef {"type":"String","label":"Company ID (your own)","name":"externalCompanyReference","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Your external id for the company (a free-text value you supply); used as the upsert key. Cannot be changed once set."}
   * @paramDef {"type":"String","label":"Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Company name."}
   * @paramDef {"type":"String","label":"Plan","name":"plan","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Plan name associated with the company."}
   * @paramDef {"type":"Number","label":"Size","name":"size","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of employees."}
   * @paramDef {"type":"String","label":"Website","name":"website","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Company website URL."}
   * @paramDef {"type":"String","label":"Industry","name":"industry","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Industry the company operates in."}
   * @paramDef {"type":"Number","label":"Monthly Spend","name":"monthlySpend","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Revenue the company generates (whole integer)."}
   * @paramDef {"type":"Object","label":"Custom Attributes","name":"customAttributes","freeform":true,"description":"Custom company data attributes, as a key/value object. Keys are workspace-defined and not known ahead of time."}
   * @returns {Object}
   * @sampleResult {"type":"company","id":"531ee472cce572a6ec000006","company_id":"company_remote_id","name":"my company","plan":{"type":"plan","name":"Enterprise"},"remote_created_at":1374138000}
   */
  async createOrUpdateCompany(externalCompanyReference, name, plan, size, website, industry, monthlySpend, customAttributes) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/companies/createorupdatecompany
    const body = this.#compact({
      company_id: externalCompanyReference,
      name,
      plan,
      size,
      website,
      industry,
      monthly_spend: monthlySpend,
      custom_attributes: customAttributes,
    })

    return await this.#apiRequest({ url: `${ API_BASE }/companies`, method: 'post', body, logTag: 'createOrUpdateCompany' })
  }

  /**
   * @operationName Get Company
   * @category Companies
   * @description Retrieves a single company by its Intercom ID. Use this to read a company's plan, size, attributes and metadata.
   * @route POST /get-company
   * @paramDef {"type":"String","label":"Company","name":"companyId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getCompaniesDictionary","required":true,"description":"The Intercom company to fetch."}
   * @returns {Object}
   * @sampleResult {"type":"company","id":"531ee472cce572a6ec000006","company_id":"company_remote_id","name":"my company"}
   */
  async getCompany(companyId) {
    if (!companyId) {
      throw new Error('A company is required — use Get Companies Dictionary to pick one.')
    }

    return await this.#apiRequest({ url: `${ API_BASE }/companies/${ companyId }`, logTag: 'getCompany' })
  }

  /**
   * @operationName Find Company
   * @category Companies
   * @description Finds a company by your external Company ID or by name. Use this to locate the Intercom company record matching an account in your own system.
   * @route POST /find-company
   * @paramDef {"type":"String","label":"Company ID (your own)","name":"externalCompanyReference","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Find a company by the external company_id you assigned (a free-text value you supply)."}
   * @paramDef {"type":"String","label":"Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Find companies by name."}
   * @returns {Object}
   * @sampleResult {"type":"company","id":"531ee472cce572a6ec000006","company_id":"company_remote_id","name":"my company"}
   */
  async findCompany(externalCompanyReference, name) {
    if (!externalCompanyReference && !name) {
      throw new Error('Provide a Company ID or a name to find a company.')
    }

    const query = this.#compact({ company_id: externalCompanyReference, name })

    return await this.#apiRequest({ url: `${ API_BASE }/companies`, query, logTag: 'findCompany' })
  }

  /**
   * @operationName Update Company
   * @category Companies
   * @description Updates an existing company by its Intercom ID. Only the fields you set are changed. Note the external Company ID itself cannot be changed once set.
   * @route POST /update-company
   * @paramDef {"type":"String","label":"Company","name":"companyId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getCompaniesDictionary","required":true,"description":"The Intercom company to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New name."}
   * @paramDef {"type":"String","label":"Plan","name":"plan","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New plan."}
   * @paramDef {"type":"Number","label":"Size","name":"size","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New employee count."}
   * @paramDef {"type":"String","label":"Website","name":"website","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New website."}
   * @paramDef {"type":"String","label":"Industry","name":"industry","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New industry."}
   * @paramDef {"type":"Number","label":"Monthly Spend","name":"monthlySpend","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New monthly spend."}
   * @paramDef {"type":"Object","label":"Custom Attributes","name":"customAttributes","freeform":true,"description":"Custom company data attributes, as a key/value object. Keys are workspace-defined and not known ahead of time."}
   * @returns {Object}
   * @sampleResult {"type":"company","id":"531ee472cce572a6ec000006","company_id":"company_remote_id","name":"Intercom","plan":{"type":"plan","name":"Enterprise"}}
   */
  async updateCompany(companyId, name, plan, size, website, industry, monthlySpend, customAttributes) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/companies/updatecompany
    if (!companyId) {
      throw new Error('A company is required — use Get Companies Dictionary to pick one.')
    }

    const body = this.#compact({
      name,
      plan,
      size,
      website,
      industry,
      monthly_spend: monthlySpend,
      custom_attributes: customAttributes,
    })

    return await this.#apiRequest({ url: `${ API_BASE }/companies/${ companyId }`, method: 'put', body, logTag: 'updateCompany' })
  }

  /**
   * @operationName Delete Company
   * @category Companies
   * @description Permanently deletes a company by its Intercom ID. This cannot be undone.
   * @route POST /delete-company
   * @paramDef {"type":"String","label":"Company","name":"companyId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getCompaniesDictionary","required":true,"description":"The Intercom company to delete."}
   * @returns {Object}
   * @sampleResult {"id":"531ee472cce572a6ec000006","object":"company","deleted":true}
   */
  async deleteCompany(companyId) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/companies/deletecompany
    if (!companyId) {
      throw new Error('A company is required — use Get Companies Dictionary to pick one.')
    }

    return await this.#apiRequest({ url: `${ API_BASE }/companies/${ companyId }`, method: 'delete', logTag: 'deleteCompany' })
  }

  /**
   * @operationName List Companies
   * @category Companies
   * @description Returns a page of all companies in your workspace. Use this to browse or export companies, or to feed a downstream action with company IDs.
   * @route POST /list-companies
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":50,"description":"Companies per page. Default: 50."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-based page number."}
   * @returns {Object}
   * @sampleResult {"type":"list","data":[{"type":"company","id":"531ee472cce572a6ec000006","name":"my company","company_id":"company_remote_id"}],"total_count":1,"pages":{"type":"pages","page":1,"per_page":50,"total_pages":1}}
   */
  async listCompanies(perPage, page) {
    const body = this.#compact({ per_page: perPage || DEFAULT_PAGE_SIZE, page })

    return await this.#apiRequest({ url: `${ API_BASE }/companies/list`, method: 'post', body, logTag: 'listCompanies' })
  }

  /**
   * @operationName Attach Contact to Company
   * @category Companies
   * @description Associates a contact with a company, adding the contact to that company's member list. Use this to link a person to the account they belong to.
   * @route POST /attach-contact-to-company
   * @paramDef {"type":"String","label":"Contact","name":"contactId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getContactsDictionary","required":true,"description":"The contact to attach."}
   * @paramDef {"type":"String","label":"Company","name":"companyId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getCompaniesDictionary","required":true,"description":"The company to attach the contact to."}
   * @returns {Object}
   * @sampleResult {"type":"company","id":"531ee472cce572a6ec000006","name":"my company","company_id":"company_remote_id"}
   */
  async attachContactToCompany(contactId, companyId) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/companies/attachcontacttoacompany
    if (!contactId || !companyId) {
      throw new Error('Both a contact and a company are required.')
    }

    return await this.#apiRequest({ url: `${ API_BASE }/contacts/${ contactId }/companies`, method: 'post', body: { id: companyId }, logTag: 'attachContactToCompany' })
  }

  /**
   * @operationName Detach Contact from Company
   * @category Companies
   * @description Removes the association between a contact and a company. Use this to unlink a person from an account they no longer belong to.
   * @route POST /detach-contact-from-company
   * @paramDef {"type":"String","label":"Contact","name":"contactId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getContactsDictionary","required":true,"description":"The contact to detach."}
   * @paramDef {"type":"String","label":"Company","name":"companyId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getCompaniesDictionary","required":true,"description":"The company to detach from."}
   * @returns {Object}
   * @sampleResult {"type":"company","id":"531ee472cce572a6ec000006","name":"my company","company_id":"company_remote_id"}
   */
  async detachContactFromCompany(contactId, companyId) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/companies/detachcontactfromacompany
    if (!contactId || !companyId) {
      throw new Error('Both a contact and a company are required.')
    }

    return await this.#apiRequest({ url: `${ API_BASE }/contacts/${ contactId }/companies/${ companyId }`, method: 'delete', logTag: 'detachContactFromCompany' })
  }

  /**
   * @operationName List Company Contacts
   * @category Companies
   * @description Lists the contacts attached to a company. Use this to see every person that belongs to an account.
   * @route POST /list-company-contacts
   * @paramDef {"type":"String","label":"Company","name":"companyId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getCompaniesDictionary","required":true,"description":"The company whose attached contacts to list."}
   * @returns {Object}
   * @sampleResult {"type":"list","data":[{"type":"contact","id":"6762f0dd1bb69f9f2193bb83","email":"joebloggs@intercom.io"}],"total_count":1,"pages":{"type":"pages","page":1,"per_page":50,"total_pages":1}}
   */
  async listCompanyContacts(companyId) {
    if (!companyId) {
      throw new Error('A company is required — use Get Companies Dictionary to pick one.')
    }

    return await this.#apiRequest({ url: `${ API_BASE }/companies/${ companyId }/contacts`, logTag: 'listCompanyContacts' })
  }

  // ==========================================================================
  //  ACTIONS - Conversations
  // ==========================================================================
  /**
   * @operationName Create Conversation
   * @category Conversations
   * @description Starts a new conversation initiated by a contact (a user or lead). Use this to open a support thread on behalf of a customer. The body is plain text (HTML is not supported).
   * @route POST /create-conversation
   * @paramDef {"type":"String","label":"From Contact","name":"contactId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getContactsDictionary","required":true,"description":"The contact the conversation is from."}
   * @paramDef {"type":"String","label":"Contact Type","name":"contactType","uiComponent":{"type":"DROPDOWN","options":{"values":["User","Lead","Contact"]}},"description":"The role of the from-contact. Defaults to User."}
   * @paramDef {"type":"String","label":"Message Body","name":"body","uiComponent":{"type":"MULTI_LINE_TEXT"},"required":true,"description":"The first message of the conversation. Plain text (HTML not supported)."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Email subject (only used for email-type messages)."}
   * @returns {Object}
   * @sampleResult {"type":"conversation","id":"123","created_at":1734537500,"conversation_message":{"type":"conversation_message","id":"403918","body":"Hello there"}}
   */
  async createConversation(contactId, contactType, body, subject) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/conversations/createconversation
    if (!contactId || !body) {
      throw new Error('A from-contact and a message body are required.')
    }

    const requestBody = this.#compact({
      from: { type: this.#resolveChoice(contactType, CONVERSATION_CONTACT_TYPE_MAP) || 'user', id: contactId },
      body,
      subject,
    })

    return await this.#apiRequest({ url: `${ API_BASE }/conversations`, method: 'post', body: requestBody, logTag: 'createConversation' })
  }

  /**
   * @operationName Get Conversation
   * @category Conversations
   * @description Retrieves a single conversation with its parts (messages, notes, assignments). Use this to read a thread's full history and current state.
   * @route POST /get-conversation
   * @paramDef {"type":"String","label":"Conversation","name":"conversationId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getConversationsDictionary","required":true,"description":"The conversation to fetch."}
   * @returns {Object}
   * @sampleResult {"type":"conversation","id":"123","created_at":1734537500,"state":"open","open":true,"read":true}
   */
  async getConversation(conversationId) {
    if (!conversationId) {
      throw new Error('A conversation is required — use Get Conversations Dictionary to pick one.')
    }

    return await this.#apiRequest({ url: `${ API_BASE }/conversations/${ conversationId }`, logTag: 'getConversation' })
  }

  /**
   * @operationName List Conversations
   * @category Conversations
   * @description Returns a page of all conversations in your workspace, newest activity first. Use the cursor to page through results.
   * @route POST /list-conversations
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":50,"description":"Conversations per page. Default: 50."}
   * @paramDef {"type":"String","label":"Cursor","name":"startingAfter","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor from a previous page's pages.next.starting_after."}
   * @returns {Object}
   * @sampleResult {"type":"conversation.list","conversations":[{"type":"conversation","id":"123","created_at":1734537500,"state":"open"}],"total_count":1,"pages":{"type":"pages","page":1,"per_page":50,"total_pages":1,"next":null}}
   */
  async listConversations(perPage, startingAfter) {
    const query = this.#compact({ per_page: perPage || DEFAULT_PAGE_SIZE, starting_after: startingAfter })

    return await this.#apiRequest({ url: `${ API_BASE }/conversations`, query, logTag: 'listConversations' })
  }

  /**
   * @operationName Search Conversations
   * @category Conversations
   * @description Searches conversations by a single attribute filter (e.g. created_at, state, open). Use this to find threads matching a condition before acting on them.
   * @route POST /search-conversations
   * @paramDef {"type":"String","label":"Field","name":"field","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The conversation attribute to filter on (e.g. created_at, state, open, source.type)."}
   * @paramDef {"type":"String","label":"Operator","name":"operator","uiComponent":{"type":"DROPDOWN","options":{"values":["Equals","Not equals","In list","Not in list","Less than","Greater than","Contains","Does not contain","Starts with","Ends with"]}},"required":true,"description":"How to compare the field to the value."}
   * @paramDef {"type":"String","label":"Value","name":"value","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The value to match. For In list / Not in list, separate multiple values with commas."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":50,"description":"Results per page. Default: 50."}
   * @returns {Object}
   * @sampleResult {"type":"conversation.list","conversations":[{"type":"conversation","id":"123","created_at":1734537500,"state":"open"}],"total_count":1,"pages":{"type":"pages","page":1,"per_page":50,"total_pages":1}}
   */
  async searchConversations(field, operator, value, perPage) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/conversations/searchconversations
    if (!field || !operator) {
      throw new Error('A field and operator are required to search conversations.')
    }

    const body = this.#searchBody(field, this.#resolveChoice(operator, SEARCH_OPERATOR_MAP), value, perPage)

    return await this.#apiRequest({ url: `${ API_BASE }/conversations/search`, method: 'post', body, logTag: 'searchConversations' })
  }

  /**
   * @operationName Reply to Conversation
   * @category Conversations
   * @description Adds a reply to a conversation - a public admin comment, an internal admin note, or a reply on behalf of the user. Optionally attach up to 10 public image URLs (Intercom fetches each one server-side). Use this to respond to a customer or leave a private note for teammates.
   * @route POST /reply-to-conversation
   * @paramDef {"type":"String","label":"Conversation","name":"conversationId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getConversationsDictionary","required":true,"description":"The conversation to reply to."}
   * @paramDef {"type":"String","label":"Reply As","name":"replyAs","uiComponent":{"type":"DROPDOWN","options":{"values":["Admin — Public Reply","Admin — Internal Note","On Behalf of User"]}},"required":true,"description":"Reply as an admin (a public comment or an internal note) or on behalf of the user."}
   * @paramDef {"type":"String","label":"Body","name":"body","uiComponent":{"type":"MULTI_LINE_TEXT"},"required":true,"description":"The reply text. Notes accept some HTML."}
   * @paramDef {"type":"String","label":"Admin","name":"adminId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getAdminsDictionary","description":"The admin authoring the reply (required for admin replies)."}
   * @paramDef {"type":"String","label":"User Contact","name":"contactId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getContactsDictionary","description":"The Intercom user id (required when replying on behalf of the user)."}
   * @paramDef {"type":"Array<String>","label":"Attachment URLs","name":"attachmentUrls","description":"Up to 10 public image URLs to attach to the reply. Each must be reachable by Intercom's servers."}
   * @returns {Object}
   * @sampleResult {"type":"conversation","id":"123","conversation_parts":{"type":"conversation_part.list","conversation_parts":[{"type":"conversation_part","id":"99","part_type":"comment","body":"<p>Thanks again :)</p>"}]}}
   */
  async replyToConversation(conversationId, replyAs, body, adminId, contactId, attachmentUrls) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/conversations/replyconversation
    if (!conversationId || !replyAs || !body) {
      throw new Error('A conversation, a Reply As choice, and a body are required.')
    }

    const requestBody = this.#buildReplyBody(this.#resolveChoice(replyAs, REPLY_AS_MAP), body, adminId, contactId, attachmentUrls)

    return await this.#apiRequest({ url: `${ API_BASE }/conversations/${ conversationId }/reply`, method: 'post', body: requestBody, logTag: 'replyToConversation' })
  }

  // Shared by replyToConversation/replyToTicket - builds the admin/user reply body. The admin
  // path uses message_type comment|note; the user path replies via intercom_user_id. Both the
  // admin and user reply payloads accept attachment_urls (max 10 public image URLs).
  #buildReplyBody(replyAs, body, adminId, contactId, attachmentUrls) {
    if (attachmentUrls && attachmentUrls.length > 10) {
      throw new Error('At most 10 attachment URLs are allowed.')
    }

    const resolvedAttachmentUrls = attachmentUrls && attachmentUrls.length ? attachmentUrls : undefined

    if (replyAs === 'user') {
      if (!contactId) {
        throw new Error('A User Contact is required to reply on behalf of the user — use Get Contacts Dictionary to pick one.')
      }

      return this.#compact({ message_type: 'comment', type: 'user', intercom_user_id: contactId, body, attachment_urls: resolvedAttachmentUrls })
    }

    if (!adminId) {
      throw new Error('An Admin is required for an admin reply — use Get Admins Dictionary to pick one.')
    }

    return this.#compact({
      message_type: replyAs === 'admin_note' ? 'note' : 'comment',
      type: 'admin',
      admin_id: adminId,
      body,
      attachment_urls: resolvedAttachmentUrls,
    })
  }

  /**
   * @operationName Assign Conversation
   * @category Conversations
   * @description Assigns a conversation to an admin or a team. Set the assignee to 0 to unassign. Use this to route a thread to the right owner or inbox.
   * @route POST /assign-conversation
   * @paramDef {"type":"String","label":"Conversation","name":"conversationId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getConversationsDictionary","required":true,"description":"The conversation to assign."}
   * @paramDef {"type":"String","label":"Acting Admin","name":"adminId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getAdminsDictionary","required":true,"description":"The admin performing the assignment."}
   * @paramDef {"type":"String","label":"Assign To","name":"assigneeType","uiComponent":{"type":"DROPDOWN","options":{"values":["Admin","Team"]}},"required":true,"description":"Assign to an admin or a team."}
   * @paramDef {"type":"String","label":"Assignee","name":"assigneeId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getAssigneesDictionary","required":true,"description":"The admin or team to assign — pick from the list (admins and teams both appear). Use 0 to unassign. Must match the Assign To type."}
   * @paramDef {"type":"String","label":"Note","name":"body","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional message sent on assignment."}
   * @returns {Object}
   * @sampleResult {"type":"conversation","id":"123","admin_assignee_id":4324241,"state":"open"}
   */
  async assignConversation(conversationId, adminId, assigneeType, assigneeId, body) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/conversations/manageconversation
    if (!conversationId || !adminId || !assigneeType || assigneeId === undefined || assigneeId === null || assigneeId === '') {
      throw new Error('A conversation, acting admin, assign-to type, and assignee are required.')
    }

    const requestBody = this.#compact({
      message_type: 'assignment',
      type: this.#resolveChoice(assigneeType, ASSIGN_TYPE_MAP),
      admin_id: adminId,
      assignee_id: assigneeId,
      body,
    })

    return await this.#apiRequest({ url: `${ API_BASE }/conversations/${ conversationId }/parts`, method: 'post', body: requestBody, logTag: 'assignConversation' })
  }

  /**
   * @operationName Snooze Conversation
   * @category Conversations
   * @description Snoozes a conversation until a chosen time, after which it reopens. Use this to defer a thread you do not need to handle right now.
   * @route POST /snooze-conversation
   * @paramDef {"type":"String","label":"Conversation","name":"conversationId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getConversationsDictionary","required":true,"description":"The conversation to snooze."}
   * @paramDef {"type":"String","label":"Acting Admin","name":"adminId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getAdminsDictionary","required":true,"description":"The admin performing the action."}
   * @paramDef {"type":"Number","label":"Reopen At","name":"snoozedUntil","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"description":"Unix timestamp (seconds) when the conversation should reopen."}
   * @returns {Object}
   * @sampleResult {"type":"conversation","id":"123","state":"snoozed","snoozed_until":1673609604}
   */
  async snoozeConversation(conversationId, adminId, snoozedUntil) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/conversations/manageconversation
    if (!conversationId || !adminId || !snoozedUntil) {
      throw new Error('A conversation, acting admin, and reopen time are required.')
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/conversations/${ conversationId }/parts`,
      method: 'post',
      body: { message_type: 'snoozed', admin_id: adminId, snoozed_until: snoozedUntil },
      logTag: 'snoozeConversation',
    })
  }

  /**
   * @operationName Open Conversation
   * @category Conversations
   * @description Reopens a closed or snoozed conversation. Use this to bring a thread back into the active queue.
   * @route POST /open-conversation
   * @paramDef {"type":"String","label":"Conversation","name":"conversationId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getConversationsDictionary","required":true,"description":"The conversation to (re)open."}
   * @paramDef {"type":"String","label":"Acting Admin","name":"adminId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getAdminsDictionary","required":true,"description":"The admin performing the action."}
   * @returns {Object}
   * @sampleResult {"type":"conversation","id":"123","state":"open","open":true}
   */
  async openConversation(conversationId, adminId) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/conversations/manageconversation
    if (!conversationId || !adminId) {
      throw new Error('A conversation and acting admin are required.')
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/conversations/${ conversationId }/parts`,
      method: 'post',
      body: { message_type: 'open', admin_id: adminId },
      logTag: 'openConversation',
    })
  }

  /**
   * @operationName Close Conversation
   * @category Conversations
   * @description Closes a conversation, optionally leaving a closing message. Use this to mark a support thread as resolved.
   * @route POST /close-conversation
   * @paramDef {"type":"String","label":"Conversation","name":"conversationId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getConversationsDictionary","required":true,"description":"The conversation to close."}
   * @paramDef {"type":"String","label":"Acting Admin","name":"adminId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getAdminsDictionary","required":true,"description":"The admin performing the action."}
   * @paramDef {"type":"String","label":"Closing Message","name":"body","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional message left when closing."}
   * @returns {Object}
   * @sampleResult {"type":"conversation","id":"123","state":"closed","open":false}
   */
  async closeConversation(conversationId, adminId, body) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/conversations/manageconversation
    if (!conversationId || !adminId) {
      throw new Error('A conversation and acting admin are required.')
    }

    const requestBody = this.#compact({ message_type: 'close', type: 'admin', admin_id: adminId, body })

    return await this.#apiRequest({ url: `${ API_BASE }/conversations/${ conversationId }/parts`, method: 'post', body: requestBody, logTag: 'closeConversation' })
  }

  /**
   * @operationName Attach Contact to Conversation
   * @category Conversations
   * @description Adds another contact as a participant on an existing conversation. Use this to loop an additional customer into a shared thread.
   * @route POST /attach-contact-to-conversation
   * @paramDef {"type":"String","label":"Conversation","name":"conversationId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getConversationsDictionary","required":true,"description":"The conversation to add a participant to."}
   * @paramDef {"type":"String","label":"Acting Admin","name":"adminId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getAdminsDictionary","required":true,"description":"The admin adding the participant."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getContactsDictionary","required":true,"description":"The contact (Intercom user id) to attach."}
   * @returns {Object}
   * @sampleResult {"type":"conversation","id":"123","contacts":{"type":"contact.list","contacts":[{"type":"contact","id":"6762f19b1bb69f9f2193bbd4"}]}}
   */
  async attachContactToConversation(conversationId, adminId, contactId) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/conversations/attachcontacttoconversation
    if (!conversationId || !adminId || !contactId) {
      throw new Error('A conversation, acting admin, and contact are required.')
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/conversations/${ conversationId }/customers`,
      method: 'post',
      body: { admin_id: adminId, customer: { intercom_user_id: contactId } },
      logTag: 'attachContactToConversation',
    })
  }

  /**
   * @operationName Convert Conversation to Ticket
   * @category Conversations
   * @description Converts a conversation into a ticket of the chosen type. Use this to escalate a support chat into a tracked ticket workflow.
   * @route POST /convert-conversation-to-ticket
   * @paramDef {"type":"String","label":"Conversation","name":"conversationId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getConversationsDictionary","required":true,"description":"The conversation to convert into a ticket."}
   * @paramDef {"type":"String","label":"Ticket Type","name":"ticketTypeId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getTicketTypesDictionary","required":true,"description":"The type of ticket to create."}
   * @returns {Object}
   * @sampleResult {"type":"ticket","id":"631","ticket_id":"38","ticket_state":{"type":"ticket_state","id":"8537"}}
   */
  async convertConversationToTicket(conversationId, ticketTypeId) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/conversations/convertconversationtoticket
    if (!conversationId || !ticketTypeId) {
      throw new Error('A conversation and a ticket type are required.')
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/conversations/${ conversationId }/convert`,
      method: 'post',
      body: { ticket_type_id: ticketTypeId },
      logTag: 'convertConversationToTicket',
    })
  }

  // ==========================================================================
  //  ACTIONS - Messaging
  // ==========================================================================
  /**
   * @operationName Create Message
   * @category Messaging
   * @description Sends an admin-initiated in-app message or email to a user or lead. Use this to proactively reach out to a customer. Email messages also require a subject and a template. Note: the request value for an in-app message is "in_app" but the created message echoes it back in the response as "inapp" (no underscore) - both refer to the same in-app channel.
   * @route POST /create-message
   * @paramDef {"type":"String","label":"Message Type","name":"messageType","uiComponent":{"type":"DROPDOWN","options":{"values":["In-App","Email"]}},"required":true,"description":"Send an in-app message (request value in_app) or an email."}
   * @paramDef {"type":"Number","label":"From Admin","name":"adminId","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"description":"The admin id the message is sent from."}
   * @paramDef {"type":"String","label":"Recipient Type","name":"recipientType","uiComponent":{"type":"DROPDOWN","options":{"values":["User","Lead"]}},"required":true,"description":"Whether the recipient is a User or a Lead."}
   * @paramDef {"type":"String","label":"Recipient","name":"recipientId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getContactsDictionary","required":true,"description":"The contact id to send to."}
   * @paramDef {"type":"String","label":"Body","name":"body","uiComponent":{"type":"MULTI_LINE_TEXT"},"required":true,"description":"The message content. HTML and plaintext supported."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Email subject (required for email type)."}
   * @paramDef {"type":"String","label":"Email Template","name":"template","uiComponent":{"type":"DROPDOWN","options":{"values":["Plain","Personal"]}},"description":"Email style (required for email type)."}
   * @returns {Object}
   * @sampleResult {"type":"admin_message","id":"403918","created_at":1590000000,"body":"Hello there","message_type":"inapp"}
   */
  async createMessage(messageType, adminId, recipientType, recipientId, body, subject, template) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/messages/createmessage
    if (!messageType || !adminId || !recipientType || !recipientId || !body) {
      throw new Error('Message type, from admin, recipient type, recipient, and body are required.')
    }

    const resolvedMessageType = this.#resolveChoice(messageType, MESSAGE_TYPE_MAP)

    if (resolvedMessageType === 'email' && (!subject || !template)) {
      throw new Error('Email messages require a subject and a template.')
    }

    const requestBody = this.#compact({
      message_type: resolvedMessageType,
      from: { type: 'admin', id: adminId },
      to: { type: this.#resolveChoice(recipientType, ROLE_MAP), id: recipientId },
      body,
      subject,
      template: this.#resolveChoice(template, EMAIL_TEMPLATE_MAP),
    })

    return await this.#apiRequest({ url: `${ API_BASE }/messages`, method: 'post', body: requestBody, logTag: 'createMessage' })
  }

  // ==========================================================================
  //  ACTIONS - Tickets
  // ==========================================================================
  /**
   * @operationName Create Ticket
   * @category Tickets
   * @description Creates a ticket of the chosen type for a contact, optionally linked to a company and assigned to an admin or team. Use this to open a tracked support or task ticket.
   * @route POST /create-ticket
   * @paramDef {"type":"String","label":"Ticket Type","name":"ticketTypeId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getTicketTypesDictionary","required":true,"description":"The type of ticket to create."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getContactsDictionary","required":true,"description":"The contact the ticket is for."}
   * @paramDef {"type":"String","label":"Company","name":"companyId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getCompaniesDictionary","description":"Associate the ticket with a company."}
   * @paramDef {"type":"String","label":"Assign To Admin","name":"adminAssigneeId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getAdminsDictionary","description":"Admin to assign the ticket to."}
   * @paramDef {"type":"String","label":"Assign To Team","name":"teamAssigneeId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getTeamsDictionary","description":"Team to assign the ticket to."}
   * @paramDef {"type":"Object","label":"Ticket Attributes","name":"ticketAttributes","freeform":true,"description":"Ticket field values as a key/value object (e.g. _default_title_, _default_description_). Fields are defined per ticket type by the workspace and not known ahead of time."}
   * @returns {Object}
   * @sampleResult {"type":"ticket","id":"631","ticket_id":"38","ticket_state":{"type":"ticket_state","id":"8537"},"ticket_type":{"type":"ticket_type","id":"1234"}}
   */
  async createTicket(ticketTypeId, contactId, companyId, adminAssigneeId, teamAssigneeId, ticketAttributes) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/tickets/createticket
    if (!ticketTypeId || !contactId) {
      throw new Error('A ticket type and a contact are required.')
    }

    const assignment = this.#compact({ admin_assignee_id: adminAssigneeId, team_assignee_id: teamAssigneeId })

    const body = this.#compact({
      ticket_type_id: ticketTypeId,
      contacts: [{ id: contactId }],
      company_id: companyId,
      ticket_attributes: ticketAttributes,
      assignment: Object.keys(assignment).length ? assignment : undefined,
    })

    return await this.#apiRequest({ url: `${ API_BASE }/tickets`, method: 'post', body, logTag: 'createTicket' })
  }

  /**
   * @operationName Get Ticket
   * @category Tickets
   * @description Retrieves a single ticket by its Intercom ticket ID. Use this to read a ticket's state, type, attributes and assignment.
   * @route POST /get-ticket
   * @paramDef {"type":"String","label":"Ticket","name":"ticketId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getTicketsDictionary","required":true,"description":"The ticket to fetch."}
   * @returns {Object}
   * @sampleResult {"type":"ticket","id":"631","ticket_id":"38","ticket_state":{"type":"ticket_state","id":"8537"},"ticket_type":{"type":"ticket_type","id":"1234"}}
   */
  async getTicket(ticketId) {
    if (!ticketId) {
      throw new Error('A ticket is required — use Get Tickets Dictionary to pick one.')
    }

    return await this.#apiRequest({ url: `${ API_BASE }/tickets/${ ticketId }`, logTag: 'getTicket' })
  }

  /**
   * @operationName Update Ticket
   * @category Tickets
   * @description Updates a ticket's state, assignment, linked company or attributes. Set Open to false to close the ticket. Use this to progress or reassign a ticket.
   * @route POST /update-ticket
   * @paramDef {"type":"String","label":"Ticket","name":"ticketId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getTicketsDictionary","required":true,"description":"The ticket to update."}
   * @paramDef {"type":"String","label":"Ticket State","name":"ticketStateId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getTicketStatesDictionary","description":"The ticket state id to set."}
   * @paramDef {"type":"Boolean","label":"Open","name":"open","uiComponent":{"type":"TOGGLE"},"description":"Set false to close the ticket (also unsnoozes it)."}
   * @paramDef {"type":"Boolean","label":"Visible to User","name":"isShared","uiComponent":{"type":"TOGGLE"},"description":"Whether the ticket is visible to the user."}
   * @paramDef {"type":"String","label":"Assignee","name":"assigneeId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getAssigneesDictionary","description":"Admin or team to assign — pick from the list (admins and teams both appear). Set 0 to unassign."}
   * @paramDef {"type":"String","label":"Company","name":"companyId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getCompaniesDictionary","description":"Associate with a company."}
   * @paramDef {"type":"Object","label":"Ticket Attributes","name":"ticketAttributes","freeform":true,"description":"Ticket field values as a key/value object. Fields are defined per ticket type by the workspace and not known ahead of time."}
   * @returns {Object}
   * @sampleResult {"type":"ticket","id":"631","ticket_id":"38","open":true,"ticket_state":{"type":"ticket_state","id":"8537"}}
   */
  async updateTicket(ticketId, ticketStateId, open, isShared, assigneeId, companyId, ticketAttributes) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/tickets/updateticket
    if (!ticketId) {
      throw new Error('A ticket is required — use Get Tickets Dictionary to pick one.')
    }

    const body = this.#compact({
      ticket_state_id: ticketStateId,
      open,
      is_shared: isShared,
      assignee_id: assigneeId,
      company_id: companyId,
      ticket_attributes: ticketAttributes,
    })

    return await this.#apiRequest({ url: `${ API_BASE }/tickets/${ ticketId }`, method: 'put', body, logTag: 'updateTicket' })
  }

  /**
   * @operationName Delete Ticket
   * @category Tickets
   * @description Permanently deletes a ticket by its Intercom ticket ID. This cannot be undone.
   * @route POST /delete-ticket
   * @paramDef {"type":"String","label":"Ticket","name":"ticketId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getTicketsDictionary","required":true,"description":"The ticket to delete."}
   * @returns {Object}
   * @sampleResult {"id":"631","object":"ticket","deleted":true}
   */
  async deleteTicket(ticketId) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/tickets/deleteticket
    if (!ticketId) {
      throw new Error('A ticket is required — use Get Tickets Dictionary to pick one.')
    }

    return await this.#apiRequest({ url: `${ API_BASE }/tickets/${ ticketId }`, method: 'delete', logTag: 'deleteTicket' })
  }

  /**
   * @operationName Search Tickets
   * @category Tickets
   * @description Searches tickets by a single attribute filter (e.g. created_at, ticket_state_id, ticket_type_id, open). Tickets have no plain list endpoint, so use this to enumerate them.
   * @route POST /search-tickets
   * @paramDef {"type":"String","label":"Field","name":"field","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"Ticket attribute to filter on (e.g. created_at, ticket_state_id, ticket_type_id, open)."}
   * @paramDef {"type":"String","label":"Operator","name":"operator","uiComponent":{"type":"DROPDOWN","options":{"values":["Equals","Not equals","In list","Not in list","Less than","Greater than","Contains","Does not contain","Starts with","Ends with"]}},"required":true,"description":"How to compare the field to the value."}
   * @paramDef {"type":"String","label":"Value","name":"value","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The value to match. For In list / Not in list, separate multiple values with commas."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":50,"description":"Results per page. Default: 50."}
   * @returns {Object}
   * @sampleResult {"type":"list","tickets":[{"type":"ticket","id":"631","ticket_id":"38","ticket_state":{"type":"ticket_state","id":"8537"}}],"total_count":1,"pages":{"type":"pages","page":1,"per_page":50,"total_pages":1}}
   */
  async searchTickets(field, operator, value, perPage) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/tickets/searchtickets
    if (!field || !operator) {
      throw new Error('A field and operator are required to search tickets.')
    }

    const body = this.#searchBody(field, this.#resolveChoice(operator, SEARCH_OPERATOR_MAP), value, perPage)

    return await this.#apiRequest({ url: `${ API_BASE }/tickets/search`, method: 'post', body, logTag: 'searchTickets' })
  }

  /**
   * @operationName Reply to Ticket
   * @category Tickets
   * @description Adds a reply to a ticket - a public admin comment, an internal admin note, or a reply on behalf of the user. Optionally attach up to 10 public image URLs (Intercom fetches each one server-side). Use this to update a customer or leave a private note on the ticket.
   * @route POST /reply-to-ticket
   * @paramDef {"type":"String","label":"Ticket","name":"ticketId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getTicketsDictionary","required":true,"description":"The ticket to reply to."}
   * @paramDef {"type":"String","label":"Reply As","name":"replyAs","uiComponent":{"type":"DROPDOWN","options":{"values":["Admin — Public Reply","Admin — Internal Note","On Behalf of User"]}},"required":true,"description":"Reply as an admin (a public comment or an internal note) or on behalf of the user."}
   * @paramDef {"type":"String","label":"Body","name":"body","uiComponent":{"type":"MULTI_LINE_TEXT"},"required":true,"description":"The reply text."}
   * @paramDef {"type":"String","label":"Admin","name":"adminId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getAdminsDictionary","description":"The admin authoring the reply (required for admin replies)."}
   * @paramDef {"type":"String","label":"User Contact","name":"contactId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getContactsDictionary","description":"The Intercom user id (required when replying as the user)."}
   * @paramDef {"type":"Array<String>","label":"Attachment URLs","name":"attachmentUrls","description":"Up to 10 public image URLs to attach to the reply. Each must be reachable by Intercom's servers."}
   * @returns {Object}
   * @sampleResult {"type":"ticket_part","id":"99","part_type":"comment","body":"<p>Thanks again :)</p>","created_at":1590000000}
   */
  async replyToTicket(ticketId, replyAs, body, adminId, contactId, attachmentUrls) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/tickets/replytoticket
    if (!ticketId || !replyAs || !body) {
      throw new Error('A ticket, a Reply As choice, and a body are required.')
    }

    const requestBody = this.#buildReplyBody(this.#resolveChoice(replyAs, REPLY_AS_MAP), body, adminId, contactId, attachmentUrls)

    return await this.#apiRequest({ url: `${ API_BASE }/tickets/${ ticketId }/reply`, method: 'post', body: requestBody, logTag: 'replyToTicket' })
  }

  // ==========================================================================
  //  ACTIONS - Admins
  // ==========================================================================
  /**
   * @operationName List Admins
   * @category Admins
   * @description Lists all admins (teammates) in your workspace, including their away status. Use this to discover admin IDs for assignment, replies and away-status changes.
   * @route POST /list-admins
   * @returns {Object}
   * @sampleResult {"type":"admin.list","admins":[{"type":"admin","id":"991267460","name":"Ciaran Lee","email":"admin@email.com","away_mode_enabled":false}]}
   */
  async listAdmins() {
    return await this.#apiRequest({ url: `${ API_BASE }/admins`, logTag: 'listAdmins' })
  }

  /**
   * @operationName Get Admin
   * @category Admins
   * @description Retrieves a single admin (teammate) by ID, including name, email and away status.
   * @route POST /get-admin
   * @paramDef {"type":"String","label":"Admin","name":"adminId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getAdminsDictionary","required":true,"description":"The admin to fetch."}
   * @returns {Object}
   * @sampleResult {"type":"admin","id":"991267460","name":"Ciaran Lee","email":"admin@email.com","away_mode_enabled":false,"away_mode_reassign":false}
   */
  async getAdmin(adminId) {
    if (!adminId) {
      throw new Error('An admin is required — use Get Admins Dictionary to pick one.')
    }

    return await this.#apiRequest({ url: `${ API_BASE }/admins/${ adminId }`, logTag: 'getAdmin' })
  }

  /**
   * @operationName Set Admin Away
   * @category Admins
   * @description Sets an admin's away status on or off, and whether their new conversation replies should be reassigned. Use this to mark a teammate away (or back) automatically.
   * @route POST /set-admin-away
   * @paramDef {"type":"String","label":"Admin","name":"adminId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getAdminsDictionary","required":true,"description":"The admin whose away status to change."}
   * @paramDef {"type":"Boolean","label":"Away","name":"awayModeEnabled","uiComponent":{"type":"TOGGLE"},"required":true,"description":"True sets the admin to away; false sets them active."}
   * @paramDef {"type":"Boolean","label":"Reassign Replies","name":"awayModeReassign","uiComponent":{"type":"TOGGLE"},"description":"True reassigns new conversation replies to the default inbox."}
   * @returns {Object}
   * @sampleResult {"type":"admin","id":"991267460","name":"Ciaran Lee","email":"admin@email.com","away_mode_enabled":true,"away_mode_reassign":false}
   */
  async setAdminAway(adminId, awayModeEnabled, awayModeReassign) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/admins/setawayadmin
    if (!adminId || awayModeEnabled === undefined || awayModeEnabled === null) {
      throw new Error('An admin and an away state are required.')
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/admins/${ adminId }/away`,
      method: 'put',
      body: {
        away_mode_enabled: Boolean(awayModeEnabled),
        away_mode_reassign: awayModeReassign === undefined ? false : Boolean(awayModeReassign),
      },
      logTag: 'setAdminAway',
    })
  }

  // ==========================================================================
  //  ACTIONS - Teams
  // ==========================================================================
  /**
   * @operationName List Teams
   * @category Teams
   * @description Lists all teams in your workspace. Use this to discover team IDs for routing conversations and tickets.
   * @route POST /list-teams
   * @returns {Object}
   * @sampleResult {"type":"team.list","teams":[{"type":"team","id":"814865","name":"Example Team","admin_ids":[493881]}]}
   */
  async listTeams() {
    return await this.#apiRequest({ url: `${ API_BASE }/teams`, logTag: 'listTeams' })
  }

  /**
   * @operationName Get Team
   * @category Teams
   * @description Retrieves a single team by ID, including its name and member admin IDs.
   * @route POST /get-team
   * @paramDef {"type":"String","label":"Team","name":"teamId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getTeamsDictionary","required":true,"description":"The team to fetch."}
   * @returns {Object}
   * @sampleResult {"type":"team","id":"814865","name":"Example Team","admin_ids":[493881]}
   */
  async getTeam(teamId) {
    if (!teamId) {
      throw new Error('A team is required — use Get Teams Dictionary to pick one.')
    }

    return await this.#apiRequest({ url: `${ API_BASE }/teams/${ teamId }`, logTag: 'getTeam' })
  }

  // ==========================================================================
  //  ACTIONS - Tags
  // ==========================================================================
  /**
   * @operationName Create or Update Tag
   * @category Tags
   * @description Creates a tag with the given name, or renames an existing tag if you supply its ID. Use this to manage the tag vocabulary you apply to contacts, companies and conversations.
   * @route POST /create-or-update-tag
   * @paramDef {"type":"String","label":"Tag Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The tag name (created if new). Case-insensitive."}
   * @paramDef {"type":"String","label":"Tag (to rename)","name":"tagId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getTagsDictionary","description":"Provide an existing tag id to rename it instead of creating."}
   * @returns {Object}
   * @sampleResult {"type":"tag","id":"656452352","name":"Independent"}
   */
  async createOrUpdateTag(name, tagId) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/tags/createtag
    if (!name) {
      throw new Error('A tag name is required.')
    }

    const body = this.#compact({ name, id: tagId })

    return await this.#apiRequest({ url: `${ API_BASE }/tags`, method: 'post', body, logTag: 'createOrUpdateTag' })
  }

  /**
   * @operationName List Tags
   * @category Tags
   * @description Lists all tags in your workspace. Use this to discover tag IDs and names for tagging actions.
   * @route POST /list-tags
   * @returns {Object}
   * @sampleResult {"type":"list","data":[{"type":"tag","id":"656452352","name":"Independent"}]}
   */
  async listTags() {
    return await this.#apiRequest({ url: `${ API_BASE }/tags`, logTag: 'listTags' })
  }

  /**
   * @operationName Get Tag
   * @category Tags
   * @description Retrieves a single tag by ID, including its name.
   * @route POST /get-tag
   * @paramDef {"type":"String","label":"Tag","name":"tagId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getTagsDictionary","required":true,"description":"The tag to fetch."}
   * @returns {Object}
   * @sampleResult {"type":"tag","id":"656452352","name":"Independent"}
   */
  async getTag(tagId) {
    if (!tagId) {
      throw new Error('A tag is required — use Get Tags Dictionary to pick one.')
    }

    return await this.#apiRequest({ url: `${ API_BASE }/tags/${ tagId }`, logTag: 'getTag' })
  }

  /**
   * @operationName Delete Tag
   * @category Tags
   * @description Permanently deletes a tag from your workspace, removing it from every record it was applied to.
   * @route POST /delete-tag
   * @paramDef {"type":"String","label":"Tag","name":"tagId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getTagsDictionary","required":true,"description":"The tag to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":"656452352"}
   */
  async deleteTag(tagId) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/tags/deletetag
    if (!tagId) {
      throw new Error('A tag is required — use Get Tags Dictionary to pick one.')
    }

    return await this.#apiRequest({ url: `${ API_BASE }/tags/${ tagId }`, method: 'delete', logTag: 'deleteTag' })
  }

  /**
   * @operationName Tag Contact
   * @category Tags
   * @description Applies an existing tag to a contact. Use this to label or segment a person.
   * @route POST /tag-contact
   * @paramDef {"type":"String","label":"Contact","name":"contactId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getContactsDictionary","required":true,"description":"The contact to tag."}
   * @paramDef {"type":"String","label":"Tag","name":"tagId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getTagsDictionary","required":true,"description":"The tag to apply."}
   * @returns {Object}
   * @sampleResult {"type":"tag","id":"81","name":"Manual tag","applied_at":1663597223,"applied_by":{"type":"admin","id":"456"}}
   */
  async tagContact(contactId, tagId) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/tags/attachtagtocontact
    if (!contactId || !tagId) {
      throw new Error('Both a contact and a tag are required.')
    }

    return await this.#apiRequest({ url: `${ API_BASE }/contacts/${ contactId }/tags`, method: 'post', body: { id: tagId }, logTag: 'tagContact' })
  }

  /**
   * @operationName Untag Contact
   * @category Tags
   * @description Removes a tag from a contact. Use this to unlabel a person.
   * @route POST /untag-contact
   * @paramDef {"type":"String","label":"Contact","name":"contactId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getContactsDictionary","required":true,"description":"The contact to untag."}
   * @paramDef {"type":"String","label":"Tag","name":"tagId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getTagsDictionary","required":true,"description":"The tag to remove."}
   * @returns {Object}
   * @sampleResult {"type":"tag","id":"84","name":"Manual tag","applied_at":1663597223,"applied_by":{"type":"admin","id":"456"}}
   */
  async untagContact(contactId, tagId) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/tags/detachtagfromcontact
    if (!contactId || !tagId) {
      throw new Error('Both a contact and a tag are required.')
    }

    return await this.#apiRequest({ url: `${ API_BASE }/contacts/${ contactId }/tags/${ tagId }`, method: 'delete', logTag: 'untagContact' })
  }

  /**
   * @operationName Tag Company
   * @category Tags
   * @description Applies a tag (created if it does not exist) to a company. Use this to label or segment an account.
   * @route POST /tag-company
   * @paramDef {"type":"String","label":"Tag Name","name":"tagName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The tag name (created if not found)."}
   * @paramDef {"type":"String","label":"Company","name":"companyId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getCompaniesDictionary","required":true,"description":"The company (Intercom id) to tag."}
   * @returns {Object}
   * @sampleResult {"type":"tag","id":"656452352","name":"Independent"}
   */
  async tagCompany(tagName, companyId) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/tags/createtag
    if (!tagName || !companyId) {
      throw new Error('Both a tag name and a company are required.')
    }

    return await this.#apiRequest({ url: `${ API_BASE }/tags`, method: 'post', body: { name: tagName, companies: [{ id: companyId }] }, logTag: 'tagCompany' })
  }

  /**
   * @operationName Untag Company
   * @category Tags
   * @description Removes a tag from a company. Use this to unlabel an account.
   * @route POST /untag-company
   * @paramDef {"type":"String","label":"Tag Name","name":"tagName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The tag name to remove."}
   * @paramDef {"type":"String","label":"Company","name":"companyId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getCompaniesDictionary","required":true,"description":"The company to untag."}
   * @returns {Object}
   * @sampleResult {"type":"tag","id":"656452352","name":"Independent"}
   */
  async untagCompany(tagName, companyId) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/tags/createtag
    if (!tagName || !companyId) {
      throw new Error('Both a tag name and a company are required.')
    }

    return await this.#apiRequest({ url: `${ API_BASE }/tags`, method: 'post', body: { name: tagName, companies: [{ id: companyId, untag: true }] }, logTag: 'untagCompany' })
  }

  /**
   * @operationName Tag Conversation
   * @category Tags
   * @description Applies a tag to a conversation on behalf of an admin. Use this to categorize a support thread.
   * @route POST /tag-conversation
   * @paramDef {"type":"String","label":"Conversation","name":"conversationId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getConversationsDictionary","required":true,"description":"The conversation to tag."}
   * @paramDef {"type":"String","label":"Tag","name":"tagId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getTagsDictionary","required":true,"description":"The tag to apply."}
   * @paramDef {"type":"String","label":"Acting Admin","name":"adminId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getAdminsDictionary","required":true,"description":"The admin applying the tag."}
   * @returns {Object}
   * @sampleResult {"type":"tag","id":"86","name":"Manual tag","applied_at":1663597223,"applied_by":{"type":"admin","id":"991267618"}}
   */
  async tagConversation(conversationId, tagId, adminId) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/tags/attachtagtoconversation
    if (!conversationId || !tagId || !adminId) {
      throw new Error('A conversation, a tag, and an acting admin are required.')
    }

    return await this.#apiRequest({ url: `${ API_BASE }/conversations/${ conversationId }/tags`, method: 'post', body: { id: tagId, admin_id: adminId }, logTag: 'tagConversation' })
  }

  /**
   * @operationName Untag Conversation
   * @category Tags
   * @description Removes a tag from a conversation on behalf of an admin. Use this to uncategorize a support thread.
   * @route POST /untag-conversation
   * @paramDef {"type":"String","label":"Conversation","name":"conversationId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getConversationsDictionary","required":true,"description":"The conversation to untag."}
   * @paramDef {"type":"String","label":"Tag","name":"tagId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getTagsDictionary","required":true,"description":"The tag to remove."}
   * @paramDef {"type":"String","label":"Acting Admin","name":"adminId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getAdminsDictionary","required":true,"description":"The admin removing the tag."}
   * @returns {Object}
   * @sampleResult {"type":"tag","id":"86","name":"Manual tag"}
   */
  async untagConversation(conversationId, tagId, adminId) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/tags/detachtagfromconversation
    if (!conversationId || !tagId || !adminId) {
      throw new Error('A conversation, a tag, and an acting admin are required.')
    }

    return await this.#apiRequest({ url: `${ API_BASE }/conversations/${ conversationId }/tags/${ tagId }`, method: 'delete', body: { admin_id: adminId }, logTag: 'untagConversation' })
  }

  // ==========================================================================
  //  ACTIONS - Segments
  // ==========================================================================
  /**
   * @operationName List Segments
   * @category Segments
   * @description Lists all contact segments in your workspace, optionally with member counts. Use this to discover segment IDs for filtering and reporting.
   * @route POST /list-segments
   * @paramDef {"type":"Boolean","label":"Include Count","name":"includeCount","uiComponent":{"type":"TOGGLE"},"description":"Include the number of contacts in each segment."}
   * @returns {Object}
   * @sampleResult {"type":"segment.list","segments":[{"type":"segment","id":"56203d253cba154d39010062","name":"Active","person_type":"user","count":3}]}
   */
  async listSegments(includeCount) {
    const query = this.#compact({ include_count: includeCount === undefined ? undefined : Boolean(includeCount) })

    return await this.#apiRequest({ url: `${ API_BASE }/segments`, query, logTag: 'listSegments' })
  }

  /**
   * @operationName Get Segment
   * @category Segments
   * @description Retrieves a single segment by ID, including its name and person type.
   * @route POST /get-segment
   * @paramDef {"type":"String","label":"Segment","name":"segmentId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getSegmentsDictionary","required":true,"description":"The segment to fetch."}
   * @returns {Object}
   * @sampleResult {"type":"segment","id":"56203d253cba154d39010062","name":"Active","person_type":"user","created_at":1394621988}
   */
  async getSegment(segmentId) {
    if (!segmentId) {
      throw new Error('A segment is required — use Get Segments Dictionary to pick one.')
    }

    return await this.#apiRequest({ url: `${ API_BASE }/segments/${ segmentId }`, logTag: 'getSegment' })
  }

  // ==========================================================================
  //  ACTIONS - Notes
  // ==========================================================================
  /**
   * @operationName Create Note
   * @category Notes
   * @description Adds an internal note to a contact, visible only to teammates. Use this to record context about a person that customers should not see.
   * @route POST /create-note
   * @paramDef {"type":"String","label":"Contact","name":"contactId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getContactsDictionary","required":true,"description":"The contact to add a note to."}
   * @paramDef {"type":"String","label":"Note","name":"body","uiComponent":{"type":"MULTI_LINE_TEXT"},"required":true,"description":"The note text (internal; only visible to teammates)."}
   * @paramDef {"type":"String","label":"Author Admin","name":"adminId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getAdminsDictionary","description":"The admin who authored the note."}
   * @returns {Object}
   * @sampleResult {"type":"note","id":"31","created_at":1734537390,"body":"<p>Hello</p>","contact":{"type":"contact","id":"6762f0ad1bb69f9f2193bb62"},"author":{"type":"admin","id":"991267583","name":"Ciaran Lee"}}
   */
  async createNote(contactId, body, adminId) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/notes/createnote
    if (!contactId || !body) {
      throw new Error('A contact and a note body are required.')
    }

    const requestBody = this.#compact({ body, admin_id: adminId })

    return await this.#apiRequest({ url: `${ API_BASE }/contacts/${ contactId }/notes`, method: 'post', body: requestBody, logTag: 'createNote' })
  }

  /**
   * @operationName List Notes
   * @category Notes
   * @description Lists the internal notes attached to a contact. Use this to read everything teammates have recorded about a person.
   * @route POST /list-notes
   * @paramDef {"type":"String","label":"Contact","name":"contactId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getContactsDictionary","required":true,"description":"The contact whose notes to list."}
   * @returns {Object}
   * @sampleResult {"type":"list","data":[{"type":"note","id":"31","body":"<p>Hello</p>","author":{"type":"admin","id":"991267583"}}],"total_count":1,"pages":{"type":"pages","page":1,"per_page":50,"total_pages":1}}
   */
  async listNotes(contactId) {
    if (!contactId) {
      throw new Error('A contact is required — use Get Contacts Dictionary to pick one.')
    }

    return await this.#apiRequest({ url: `${ API_BASE }/contacts/${ contactId }/notes`, logTag: 'listNotes' })
  }

  /**
   * @operationName Get Note
   * @category Notes
   * @description Retrieves a single note by ID, including its body and author. Pick the note from the chosen contact's notes.
   * @route POST /get-note
   * @paramDef {"type":"String","label":"Contact","name":"contactId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getContactsDictionary","required":true,"description":"The contact whose note to fetch (used to populate the Note picker)."}
   * @paramDef {"type":"String","label":"Note","name":"noteId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getNotesDictionary","dependsOn":["contactId"],"required":true,"description":"The note to fetch (from the selected contact's notes)."}
   * @returns {Object}
   * @sampleResult {"type":"note","id":"31","created_at":1734537390,"body":"<p>Hello</p>","author":{"type":"admin","id":"991267583","name":"Ciaran Lee"}}
   */
  async getNote(contactId, noteId) {
    if (!noteId) {
      throw new Error('A note is required — use Get Notes Dictionary (after picking a contact) to pick one.')
    }

    return await this.#apiRequest({ url: `${ API_BASE }/notes/${ noteId }`, logTag: 'getNote' })
  }

  // ==========================================================================
  //  ACTIONS - Events
  // ==========================================================================
  /**
   * @operationName Submit Event
   * @category Events
   * @description Records a custom event for a contact (e.g. "invited-friend"). Events power behavioral targeting and timelines. Identify the contact by your user_id, their Intercom ID, or their email.
   * @route POST /submit-event
   * @paramDef {"type":"String","label":"Event Name","name":"eventName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The event that occurred — a past-tense verb-noun, e.g. invited-friend."}
   * @paramDef {"type":"String","label":"Identify By","name":"identifierType","uiComponent":{"type":"DROPDOWN","options":{"values":["Your User ID","Intercom Contact ID","Email"]}},"required":true,"description":"How to identify the contact the event belongs to."}
   * @paramDef {"type":"String","label":"Identifier","name":"identifier","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The user_id, Intercom contact id, or email matching Identify By."}
   * @paramDef {"type":"Number","label":"Occurred At","name":"createdAt","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp (seconds) when the event occurred. Defaults to now."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","freeform":true,"description":"Optional event metadata as a key/value object. Keys are caller-defined per event and not known ahead of time."}
   * @returns {Object}
   * @sampleResult {"status":"accepted"}
   */
  async submitEvent(eventName, identifierType, identifier, createdAt, metadata) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/data-events/createdataevent
    if (!eventName || !identifierType || !identifier) {
      throw new Error('An event name, an Identify By choice, and an identifier are required.')
    }

    const body = this.#compact({
      event_name: eventName,
      created_at: createdAt || Math.floor(Date.now() / 1000),
      [this.#resolveChoice(identifierType, SUBMIT_EVENT_IDENTIFIER_MAP)]: identifier,
      metadata,
    })

    // POST /events returns 202 Accepted with no body; report a stable success shape.
    await this.#apiRequest({ url: `${ API_BASE }/events`, method: 'post', body, logTag: 'submitEvent' })

    return { status: 'accepted' }
  }

  /**
   * @operationName List Events
   * @category Events
   * @description Lists the recent custom events recorded for a single contact. Identify the contact by your user_id, their Intercom ID, or their email.
   * @route POST /list-events
   * @paramDef {"type":"String","label":"Identify By","name":"identifierType","uiComponent":{"type":"DROPDOWN","options":{"values":["Your User ID","Intercom Contact ID","Email"]}},"required":true,"description":"How to identify the contact whose events to list."}
   * @paramDef {"type":"String","label":"Identifier","name":"identifier","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The user_id, intercom_user_id, or email matching Identify By."}
   * @returns {Object}
   * @sampleResult {"type":"event.list","events":[{"type":"event","event_name":"invited-friend","created_at":1671028894,"metadata":{"invite_code":"ADDAFRIEND"}}],"pages":{}}
   */
  async listEvents(identifierType, identifier) {
    if (!identifierType || !identifier) {
      throw new Error('An Identify By choice and an identifier are required.')
    }

    const query = { type: 'user', [this.#resolveChoice(identifierType, LIST_EVENTS_IDENTIFIER_MAP)]: identifier }

    return await this.#apiRequest({ url: `${ API_BASE }/events`, query, logTag: 'listEvents' })
  }

  // ==========================================================================
  //  ACTIONS - Data Attributes
  // ==========================================================================
  /**
   * @operationName List Data Attributes
   * @category Data Attributes
   * @description Lists the custom and standard data attributes defined for contacts, companies or conversations. Use this to discover the attribute schema before reading or writing custom data.
   * @route POST /list-data-attributes
   * @paramDef {"type":"String","label":"Model","name":"model","uiComponent":{"type":"DROPDOWN","options":{"values":["Contact","Company","Conversation"]}},"description":"Which object's attributes to return."}
   * @paramDef {"type":"Boolean","label":"Include Archived","name":"includeArchived","uiComponent":{"type":"TOGGLE"},"description":"Include archived attributes."}
   * @returns {Object}
   * @sampleResult {"type":"list","data":[{"type":"data_attribute","id":188,"name":"paid_subscriber","full_name":"custom_attributes.paid_subscriber","model":"contact","data_type":"boolean"}]}
   */
  async listDataAttributes(model, includeArchived) {
    const query = this.#compact({ model: this.#resolveChoice(model, DATA_ATTRIBUTE_LIST_MODEL_MAP), include_archived: includeArchived === undefined ? undefined : Boolean(includeArchived) })

    return await this.#apiRequest({ url: `${ API_BASE }/data_attributes`, query, logTag: 'listDataAttributes' })
  }

  /**
   * @operationName Create Data Attribute
   * @category Data Attributes
   * @description Creates a custom data attribute on contacts or companies. Choose its value type; for a List attribute supply the allowed option values. Use this to extend your CRM schema.
   * @route POST /create-data-attribute
   * @paramDef {"type":"String","label":"Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The attribute name shown in the UI."}
   * @paramDef {"type":"String","label":"Model","name":"model","uiComponent":{"type":"DROPDOWN","options":{"values":["Contact","Company"]}},"required":true,"description":"Whether the attribute is on Contacts or Companies."}
   * @paramDef {"type":"String","label":"Data Type","name":"dataType","uiComponent":{"type":"DROPDOWN","options":{"values":["Text","Integer","Decimal","True/False","Date","Date & Time","List (Options)"]}},"required":true,"description":"The value type of the attribute."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Readable description shown in the UI."}
   * @paramDef {"type":"Boolean","label":"Messenger Writable","name":"messengerWritable","uiComponent":{"type":"TOGGLE"},"description":"Whether the Messenger can update this attribute."}
   * @paramDef {"type":"Array<String>","label":"Options","name":"options","description":"For a List attribute, the allowed option values (at least two). Ignored for other types."}
   * @returns {Object}
   * @sampleResult {"type":"data_attribute","id":"123","name":"My Data Attribute","full_name":"custom_attributes.my_data_attribute","model":"contact","data_type":"string"}
   */
  async createDataAttribute(name, model, dataType, description, messengerWritable, options) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/data-attributes/createdataattribute
    if (!name || !model || !dataType) {
      throw new Error('A name, model, and data type are required.')
    }

    const resolvedDataType = this.#resolveChoice(dataType, DATA_ATTRIBUTE_TYPE_MAP)

    const body = this.#compact({
      name,
      model: this.#resolveChoice(model, DATA_ATTRIBUTE_CREATE_MODEL_MAP),
      data_type: resolvedDataType,
      description,
      messenger_writable: messengerWritable,
      options: resolvedDataType === 'options' && Array.isArray(options) ? options.map(value => ({ value })) : undefined,
    })

    return await this.#apiRequest({ url: `${ API_BASE }/data_attributes`, method: 'post', body, logTag: 'createDataAttribute' })
  }

  /**
   * @operationName Update Data Attribute
   * @category Data Attributes
   * @description Updates a custom data attribute - archive it, change its description or messenger access, or set new list options. Archiving (Archived = true) is how attributes are removed (there is no delete).
   * @route POST /update-data-attribute
   * @paramDef {"type":"String","label":"Data Attribute","name":"dataAttributeId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getDataAttributesDictionary","required":true,"description":"The attribute to update."}
   * @paramDef {"type":"Boolean","label":"Archived","name":"archived","uiComponent":{"type":"TOGGLE"},"description":"Archive (hide) the attribute. This is how attributes are removed."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description."}
   * @paramDef {"type":"Boolean","label":"Messenger Writable","name":"messengerWritable","uiComponent":{"type":"TOGGLE"},"description":"Messenger write access."}
   * @paramDef {"type":"Array<String>","label":"Options","name":"options","description":"For a List attribute, the new option values."}
   * @returns {Object}
   * @sampleResult {"type":"data_attribute","id":"123","name":"My Data Attribute","archived":false,"data_type":"string"}
   */
  async updateDataAttribute(dataAttributeId, archived, description, messengerWritable, options) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/data-attributes/updatedataattribute
    // Body confirmed against the Update Data Attribute Request model: archived (boolean),
    // description (string), messenger_writable (boolean), and options as an array of {value}
    // objects, e.g. [{"value":"1-10"},{"value":"11-50"}].
    // model: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/models/update_data_attribute_request
    if (!dataAttributeId) {
      throw new Error('A data attribute is required — use Get Data Attributes Dictionary to pick one.')
    }

    const body = this.#compact({
      archived: archived === undefined ? undefined : Boolean(archived),
      description,
      messenger_writable: messengerWritable === undefined ? undefined : Boolean(messengerWritable),
      options: Array.isArray(options) ? options.map(value => ({ value })) : undefined,
    })

    return await this.#apiRequest({ url: `${ API_BASE }/data_attributes/${ dataAttributeId }`, method: 'put', body, logTag: 'updateDataAttribute' })
  }

  // ==========================================================================
  //  ACTIONS - Help Center (Articles)
  // ==========================================================================
  /**
   * @operationName Create Article
   * @category Help Center
   * @description Creates a Help Center article authored by a teammate, as a draft or published. Optionally nest it under a collection. Use this to publish self-serve documentation.
   * @route POST /create-article
   * @paramDef {"type":"String","label":"Title","name":"title","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The article title."}
   * @paramDef {"type":"Number","label":"Author Admin ID","name":"authorId","uiComponent":{"type":"NUMERIC_STEPPER"},"required":true,"description":"The admin (teammate) id who authored the article."}
   * @paramDef {"type":"String","label":"Body (HTML)","name":"body","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The article content in HTML."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Short description."}
   * @paramDef {"type":"String","label":"State","name":"state","uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Published"]}},"description":"Publish immediately or keep as a draft. Defaults to draft."}
   * @paramDef {"type":"Number","label":"Parent Collection ID","name":"parentId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The collection (or section) this article belongs to."}
   * @paramDef {"type":"String","label":"Parent Type","name":"parentType","uiComponent":{"type":"DROPDOWN","options":{"values":["Collection","Section"]}},"description":"Whether the parent is a collection or a section."}
   * @returns {Object}
   * @sampleResult {"type":"article","id":"6871119","title":"Thanks for everything","state":"draft","author_id":1295,"parent_id":18,"parent_type":"collection"}
   */
  async createArticle(title, authorId, body, description, state, parentId, parentType) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/articles/createarticle
    if (!title || !authorId) {
      throw new Error('A title and an author admin id are required.')
    }

    const requestBody = this.#compact({
      title,
      author_id: authorId,
      body,
      description,
      state: this.#resolveChoice(state, ARTICLE_STATE_MAP),
      parent_id: parentId,
      parent_type: this.#resolveChoice(parentType, ARTICLE_PARENT_TYPE_MAP),
    })

    return await this.#apiRequest({ url: `${ API_BASE }/articles`, method: 'post', body: requestBody, logTag: 'createArticle' })
  }

  /**
   * @operationName Get Article
   * @category Help Center
   * @description Retrieves a single Help Center article by ID, including its title, state and content.
   * @route POST /get-article
   * @paramDef {"type":"String","label":"Article","name":"articleId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getArticlesDictionary","required":true,"description":"The article to fetch."}
   * @returns {Object}
   * @sampleResult {"type":"article","id":"6871119","title":"Thanks for everything","state":"published","author_id":1295}
   */
  async getArticle(articleId) {
    if (!articleId) {
      throw new Error('An article is required — use Get Articles Dictionary to pick one.')
    }

    return await this.#apiRequest({ url: `${ API_BASE }/articles/${ articleId }`, logTag: 'getArticle' })
  }

  /**
   * @operationName Update Article
   * @category Help Center
   * @description Updates a Help Center article's title, body, description, state or author. Only the fields you set are changed. Use this to edit or publish documentation.
   * @route POST /update-article
   * @paramDef {"type":"String","label":"Article","name":"articleId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getArticlesDictionary","required":true,"description":"The article to update."}
   * @paramDef {"type":"String","label":"Title","name":"title","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New title."}
   * @paramDef {"type":"String","label":"Body (HTML)","name":"body","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New HTML body."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description."}
   * @paramDef {"type":"String","label":"State","name":"state","uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Published"]}},"description":"Published or draft."}
   * @paramDef {"type":"Number","label":"Author Admin ID","name":"authorId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New author admin id."}
   * @returns {Object}
   * @sampleResult {"type":"article","id":"6871119","title":"Thanks for everything","state":"published","author_id":1295}
   */
  async updateArticle(articleId, title, body, description, state, authorId) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/articles/updatearticle
    if (!articleId) {
      throw new Error('An article is required — use Get Articles Dictionary to pick one.')
    }

    const requestBody = this.#compact({ title, body, description, state: this.#resolveChoice(state, ARTICLE_STATE_MAP), author_id: authorId })

    return await this.#apiRequest({ url: `${ API_BASE }/articles/${ articleId }`, method: 'put', body: requestBody, logTag: 'updateArticle' })
  }

  /**
   * @operationName Delete Article
   * @category Help Center
   * @description Permanently deletes a Help Center article by ID. This cannot be undone.
   * @route POST /delete-article
   * @paramDef {"type":"String","label":"Article","name":"articleId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getArticlesDictionary","required":true,"description":"The article to delete."}
   * @returns {Object}
   * @sampleResult {"id":"6871119","object":"article","deleted":true}
   */
  async deleteArticle(articleId) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/articles/deletearticle
    if (!articleId) {
      throw new Error('An article is required — use Get Articles Dictionary to pick one.')
    }

    return await this.#apiRequest({ url: `${ API_BASE }/articles/${ articleId }`, method: 'delete', logTag: 'deleteArticle' })
  }

  /**
   * @operationName List Articles
   * @category Help Center
   * @description Returns a page of all Help Center articles. Use the cursor to page through results.
   * @route POST /list-articles
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":50,"description":"Articles per page. Default: 50."}
   * @paramDef {"type":"String","label":"Cursor","name":"startingAfter","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor from a previous page's pages.next.starting_after."}
   * @returns {Object}
   * @sampleResult {"type":"list","data":[{"type":"article","id":"6871119","title":"Thanks for everything","state":"published"}],"total_count":1,"pages":{"type":"pages","page":1,"per_page":50,"total_pages":1,"next":null}}
   */
  async listArticles(perPage, startingAfter) {
    const query = this.#compact({ per_page: perPage || DEFAULT_PAGE_SIZE, starting_after: startingAfter })

    return await this.#apiRequest({ url: `${ API_BASE }/articles`, query, logTag: 'listArticles' })
  }

  /**
   * @operationName Search Articles
   * @category Help Center
   * @description Full-text searches Help Center articles by phrase, optionally limited to a state. Use this to find documentation matching a query.
   * @route POST /search-articles
   * @paramDef {"type":"String","label":"Search Phrase","name":"phrase","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"Text to search article content for."}
   * @paramDef {"type":"String","label":"State","name":"state","uiComponent":{"type":"DROPDOWN","options":{"values":["Published","Draft"]}},"description":"Limit to published or draft articles."}
   * @returns {Object}
   * @sampleResult {"type":"list","total_count":1,"data":{"articles":[{"type":"article","id":"6871119","title":"Thanks for everything","state":"published"}]},"pages":{"type":"pages","page":1,"per_page":50,"total_pages":1}}
   */
  async searchArticles(phrase, state) {
    if (!phrase) {
      throw new Error('A search phrase is required.')
    }

    const query = this.#compact({ phrase, state: this.#resolveChoice(state, ARTICLE_STATE_MAP) })

    return await this.#apiRequest({ url: `${ API_BASE }/articles/search`, query, logTag: 'searchArticles' })
  }

  // ==========================================================================
  //  ACTIONS - Help Center (Collections)
  // ==========================================================================
  /**
   * @operationName Create Collection
   * @category Help Center
   * @description Creates a Help Center collection (a top-level grouping of articles), optionally nested under a parent collection. Use this to organize your knowledge base.
   * @route POST /create-collection
   * @paramDef {"type":"String","label":"Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The collection name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The collection description."}
   * @paramDef {"type":"String","label":"Parent Collection","name":"parentId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getCollectionsDictionary","description":"A parent collection to nest under. Leave empty for a top-level collection."}
   * @returns {Object}
   * @sampleResult {"type":"collection","id":"6871119","name":"collection 51","description":"English description","parent_id":null}
   */
  async createCollection(name, description, parentId) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/help-center/createcollection
    if (!name) {
      throw new Error('A collection name is required.')
    }

    const body = this.#compact({ name, description, parent_id: parentId })

    return await this.#apiRequest({ url: `${ API_BASE }/help_center/collections`, method: 'post', body, logTag: 'createCollection' })
  }

  /**
   * @operationName Get Collection
   * @category Help Center
   * @description Retrieves a single Help Center collection by ID, including its name and description.
   * @route POST /get-collection
   * @paramDef {"type":"String","label":"Collection","name":"collectionId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getCollectionsDictionary","required":true,"description":"The collection to fetch."}
   * @returns {Object}
   * @sampleResult {"type":"collection","id":"6871119","name":"collection 51","description":"English description"}
   */
  async getCollection(collectionId) {
    if (!collectionId) {
      throw new Error('A collection is required — use Get Collections Dictionary to pick one.')
    }

    return await this.#apiRequest({ url: `${ API_BASE }/help_center/collections/${ collectionId }`, logTag: 'getCollection' })
  }

  /**
   * @operationName Update Collection
   * @category Help Center
   * @description Updates a Help Center collection's name, description or parent. Only the fields you set are changed.
   * @route POST /update-collection
   * @paramDef {"type":"String","label":"Collection","name":"collectionId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getCollectionsDictionary","required":true,"description":"The collection to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description."}
   * @paramDef {"type":"String","label":"Parent Collection","name":"parentId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getCollectionsDictionary","description":"New parent collection."}
   * @returns {Object}
   * @sampleResult {"type":"collection","id":"6871119","name":"collection 51","description":"English description"}
   */
  async updateCollection(collectionId, name, description, parentId) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/help-center/updatecollection
    if (!collectionId) {
      throw new Error('A collection is required — use Get Collections Dictionary to pick one.')
    }

    const body = this.#compact({ name, description, parent_id: parentId })

    return await this.#apiRequest({ url: `${ API_BASE }/help_center/collections/${ collectionId }`, method: 'put', body, logTag: 'updateCollection' })
  }

  /**
   * @operationName Delete Collection
   * @category Help Center
   * @description Permanently deletes a Help Center collection by ID. This cannot be undone.
   * @route POST /delete-collection
   * @paramDef {"type":"String","label":"Collection","name":"collectionId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getCollectionsDictionary","required":true,"description":"The collection to delete."}
   * @returns {Object}
   * @sampleResult {"id":"6871119","object":"collection","deleted":true}
   */
  async deleteCollection(collectionId) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/help-center/deletecollection
    if (!collectionId) {
      throw new Error('A collection is required — use Get Collections Dictionary to pick one.')
    }

    return await this.#apiRequest({ url: `${ API_BASE }/help_center/collections/${ collectionId }`, method: 'delete', logTag: 'deleteCollection' })
  }

  /**
   * @operationName List Collections
   * @category Help Center
   * @description Returns a page of all Help Center collections. Use the cursor to page through results.
   * @route POST /list-collections
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":50,"description":"Collections per page. Default: 50."}
   * @paramDef {"type":"String","label":"Cursor","name":"startingAfter","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Pagination cursor from a previous page's pages.next.starting_after."}
   * @returns {Object}
   * @sampleResult {"type":"list","data":[{"type":"collection","id":"6871119","name":"collection 51"}],"total_count":1,"pages":{"type":"pages","page":1,"per_page":50,"total_pages":1,"next":null}}
   */
  async listCollections(perPage, startingAfter) {
    const query = this.#compact({ per_page: perPage || DEFAULT_PAGE_SIZE, starting_after: startingAfter })

    return await this.#apiRequest({ url: `${ API_BASE }/help_center/collections`, query, logTag: 'listCollections' })
  }

  // ==========================================================================
  //  ACTIONS - Subscriptions
  // ==========================================================================
  /**
   * @operationName List Subscription Types
   * @category Subscriptions
   * @description Lists the subscription types (opt-in/opt-out preferences) available in your workspace. Use this to discover subscription IDs before attaching or detaching them on a contact.
   * @route POST /list-subscription-types
   * @returns {Object}
   * @sampleResult {"type":"list","data":[{"type":"subscription","id":"37846","state":"live","consent_type":"opt_out","content_types":["email"]}]}
   */
  async listSubscriptionTypes() {
    return await this.#apiRequest({ url: `${ API_BASE }/subscription_types`, logTag: 'listSubscriptionTypes' })
  }

  /**
   * @operationName Attach Subscription
   * @category Subscriptions
   * @description Subscribes a contact to a subscription type with an opt-in or opt-out consent. Use this to record a customer's communication preference.
   * @route POST /attach-subscription
   * @paramDef {"type":"String","label":"Contact","name":"contactId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getContactsDictionary","required":true,"description":"The contact to subscribe."}
   * @paramDef {"type":"String","label":"Subscription Type","name":"subscriptionId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getSubscriptionTypesDictionary","required":true,"description":"The subscription type to attach."}
   * @paramDef {"type":"String","label":"Consent","name":"consentType","uiComponent":{"type":"DROPDOWN","options":{"values":["Opt In","Opt Out"]}},"required":true,"description":"Whether the contact opted in or out."}
   * @returns {Object}
   * @sampleResult {"type":"subscription","id":"37846","state":"live","consent_type":"opt_in","content_types":["email"]}
   */
  async attachSubscription(contactId, subscriptionId, consentType) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/subscription-types/attachsubscriptiontypetocontact
    if (!contactId || !subscriptionId || !consentType) {
      throw new Error('A contact, a subscription type, and a consent are required.')
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/contacts/${ contactId }/subscriptions`,
      method: 'post',
      body: { id: subscriptionId, consent_type: this.#resolveChoice(consentType, CONSENT_TYPE_MAP) },
      logTag: 'attachSubscription',
    })
  }

  /**
   * @operationName Detach Subscription
   * @category Subscriptions
   * @description Removes a subscription type from a contact. Use this to clear a previously recorded communication preference.
   * @route POST /detach-subscription
   * @paramDef {"type":"String","label":"Contact","name":"contactId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getContactsDictionary","required":true,"description":"The contact to unsubscribe."}
   * @paramDef {"type":"String","label":"Subscription Type","name":"subscriptionId","uiComponent":{"type":"SINGLE_LINE_TEXT"},"dictionary":"getSubscriptionTypesDictionary","required":true,"description":"The subscription type to remove."}
   * @returns {Object}
   * @sampleResult {"type":"subscription","id":"37846","state":"live","consent_type":"opt_out"}
   */
  async detachSubscription(contactId, subscriptionId) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/subscription-types/detachsubscriptiontypetocontact
    if (!contactId || !subscriptionId) {
      throw new Error('Both a contact and a subscription type are required.')
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/contacts/${ contactId }/subscriptions/${ subscriptionId }`,
      method: 'delete',
      logTag: 'detachSubscription',
    })
  }

  // ==========================================================================
  //  ACTIONS - Visitors
  // ==========================================================================
  /**
   * @operationName Get Visitor
   * @category Visitors
   * @description Retrieves an anonymous visitor by your user_id identifier. Use this to read what Intercom knows about an unidentified web/messenger visitor.
   * @route POST /get-visitor
   * @paramDef {"type":"String","label":"Visitor User ID","name":"visitorUserReference","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"Your identifier (user_id) for the anonymous visitor; a free-text value you supply."}
   * @returns {Object}
   * @sampleResult {"type":"visitor","id":"530370b477ad7120001d","user_id":"8a88a590-e1c3-41e2-a502-e0649dbf721c","anonymous":true,"email":""}
   */
  async getVisitor(visitorUserReference) {
    if (!visitorUserReference) {
      throw new Error('A visitor user_id is required.')
    }

    return await this.#apiRequest({ url: `${ API_BASE }/visitors`, query: { user_id: visitorUserReference }, logTag: 'getVisitor' })
  }

  /**
   * @operationName Update Visitor
   * @category Visitors
   * @description Updates an anonymous visitor's name or custom attributes, identified by your user_id. Use this to enrich what Intercom knows about an unidentified visitor.
   * @route POST /update-visitor
   * @paramDef {"type":"String","label":"Visitor User ID","name":"visitorUserReference","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The visitor's user_id; a free-text value you supply."}
   * @paramDef {"type":"String","label":"Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The visitor's name."}
   * @paramDef {"type":"Object","label":"Custom Attributes","name":"customAttributes","freeform":true,"description":"Custom data attributes for the visitor, as a key/value object. Keys are workspace-defined and not known ahead of time."}
   * @returns {Object}
   * @sampleResult {"type":"visitor","id":"530370b477ad7120001d","user_id":"123","name":"Christian Bale","anonymous":true}
   */
  async updateVisitor(visitorUserReference, name, customAttributes) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/visitors/updatevisitor
    if (!visitorUserReference) {
      throw new Error('A visitor user_id is required.')
    }

    const body = this.#compact({ user_id: visitorUserReference, name, custom_attributes: customAttributes })

    return await this.#apiRequest({ url: `${ API_BASE }/visitors`, method: 'put', body, logTag: 'updateVisitor' })
  }

  /**
   * @operationName Convert Visitor
   * @category Visitors
   * @description Converts an anonymous visitor into a Lead or User contact, merging into the target contact's user_id. Use this when an unidentified visitor becomes a known person.
   * @route POST /convert-visitor
   * @paramDef {"type":"String","label":"Visitor User ID","name":"visitorUserReference","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The visitor's user_id to convert; a free-text value you supply."}
   * @paramDef {"type":"String","label":"Convert To","name":"role","uiComponent":{"type":"DROPDOWN","options":{"values":["Lead","User"]}},"required":true,"description":"Whether to convert into a Lead or a User contact."}
   * @paramDef {"type":"String","label":"Target Contact User ID","name":"targetUserReference","uiComponent":{"type":"SINGLE_LINE_TEXT"},"required":true,"description":"The user_id of the contact the visitor is merged into; a free-text value you supply."}
   * @returns {Object}
   * @sampleResult {"type":"contact","id":"8a88a590-e1c3-41e2-a502-e0649dbf721c","role":"user","email":"winstonsmith@truth.org"}
   */
  async convertVisitor(visitorUserReference, role, targetUserReference) {
    // docs: https://developers.intercom.com/docs/references/rest-api/api.intercom.io/visitors/convertvisitor
    if (!visitorUserReference || !role || !targetUserReference) {
      throw new Error('A visitor user_id, a Convert To choice, and a target contact user_id are required.')
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/visitors/convert`,
      method: 'post',
      body: { type: this.#resolveChoice(role, ROLE_MAP), user: { user_id: targetUserReference }, visitor: { user_id: visitorUserReference } },
      logTag: 'convertVisitor',
    })
  }

  // ==========================================================================
  //  DICTIONARIES - back every resource-pick (*Id) param with one of these
  // ==========================================================================
  /**
   * @registerAs DICTIONARY
   * @operationName Get Contacts Dictionary
   * @description Searchable list of contacts (by name or email) for picking a contact in other actions.
   * @route POST /get-contacts-dictionary
   * @paramDef {"type":"getContactsDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor for retrieving and filtering contacts."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Joe Bloggs","value":"6762f0dd1bb69f9f2193bb83","note":"joebloggs@intercom.io"}],"cursor":null}
   */
  async getContactsDictionary(payload) {
    const { search, cursor } = payload || {}

    let result

    if (search) {
      // Match the search term against name OR email so the picker finds either.
      result = await this.#apiRequest({
        url: `${ API_BASE }/contacts/search`,
        method: 'post',
        body: {
          query: {
            operator: 'OR',
            value: [
              { field: 'name', operator: '~', value: search },
              { field: 'email', operator: '~', value: search },
            ],
          },
          pagination: { per_page: DEFAULT_PAGE_SIZE, starting_after: cursor || undefined },
        },
        logTag: 'getContactsDictionary',
      })
    } else {
      result = await this.#apiRequest({
        url: `${ API_BASE }/contacts`,
        query: this.#compact({ per_page: DEFAULT_PAGE_SIZE, starting_after: cursor }),
        logTag: 'getContactsDictionary',
      })
    }

    const data = (result && result.data) || []

    return {
      items: data.map(contact => ({
        label: contact.name || contact.email || contact.id,
        value: contact.id,
        note: contact.email || contact.role || '',
      })),
      cursor: result?.pages?.next?.starting_after || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Companies Dictionary
   * @description Searchable list of companies for picking a company in other actions.
   * @route POST /get-companies-dictionary
   * @paramDef {"type":"getCompaniesDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination page for retrieving and filtering companies."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"my company","value":"531ee472cce572a6ec000006","note":"company_remote_id"}],"cursor":null}
   */
  async getCompaniesDictionary(payload) {
    const { search, cursor } = payload || {}

    const result = await this.#apiRequest({
      url: `${ API_BASE }/companies/list`,
      method: 'post',
      body: this.#compact({ per_page: DEFAULT_PAGE_SIZE, page: cursor ? Number(cursor) : undefined }),
      logTag: 'getCompaniesDictionary',
    })

    const data = (result && result.data) || []
    const term = search ? String(search).toLowerCase() : null

    const items = data
      .filter(company => !term || String(company.name || '').toLowerCase().includes(term))
      .map(company => ({
        label: company.name || company.company_id || company.id,
        value: company.id,
        note: company.company_id || '',
      }))

    const nextPage = result?.pages?.next
    const nextCursor = typeof nextPage === 'object' ? (nextPage.page || null) : (nextPage || null)

    return { items, cursor: nextCursor ? String(nextCursor) : null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Conversations Dictionary
   * @description Searchable list of recent conversations for picking a conversation in other actions.
   * @route POST /get-conversations-dictionary
   * @paramDef {"type":"getConversationsDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor for retrieving and filtering conversations."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"#123","value":"123","note":"open"}],"cursor":null}
   */
  async getConversationsDictionary(payload) {
    const { search, cursor } = payload || {}

    const result = await this.#apiRequest({
      url: `${ API_BASE }/conversations`,
      query: this.#compact({ per_page: DEFAULT_PAGE_SIZE, starting_after: cursor }),
      logTag: 'getConversationsDictionary',
    })

    const data = (result && result.conversations) || []
    const term = search ? String(search).toLowerCase() : null

    const items = data
      .filter(conversation => {
        if (!term) return true
        const title = conversation.title || conversation.source?.subject || ''

        return String(conversation.id).includes(term) || String(title).toLowerCase().includes(term)
      })
      .map(conversation => ({
        label: `#${ conversation.id }${ conversation.title ? ` — ${ conversation.title }` : '' }`,
        value: String(conversation.id),
        note: conversation.state || '',
      }))

    return { items, cursor: result?.pages?.next?.starting_after || null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Admins Dictionary
   * @description Searchable list of admins (teammates) for picking an admin or assignee in other actions.
   * @route POST /get-admins-dictionary
   * @paramDef {"type":"getAdminsDictionary__payload","label":"Payload","name":"payload","description":"Optional search text to filter admins locally by name or email."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Ciaran Lee","value":"991267460","note":"admin@email.com"}],"cursor":null}
   */
  async getAdminsDictionary(payload) {
    const { search } = payload || {}

    const result = await this.#apiRequest({ url: `${ API_BASE }/admins`, logTag: 'getAdminsDictionary' })
    const data = (result && result.admins) || []
    const term = search ? String(search).toLowerCase() : null

    const items = data
      .filter(admin => !term || `${ admin.name || '' } ${ admin.email || '' }`.toLowerCase().includes(term))
      .map(admin => ({
        label: admin.name || admin.email || String(admin.id),
        value: String(admin.id),
        note: admin.email || '',
      }))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Teams Dictionary
   * @description Searchable list of teams for picking a team in other actions.
   * @route POST /get-teams-dictionary
   * @paramDef {"type":"getTeamsDictionary__payload","label":"Payload","name":"payload","description":"Optional search text to filter teams locally by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Example Team","value":"814865","note":""}],"cursor":null}
   */
  async getTeamsDictionary(payload) {
    const { search } = payload || {}

    const result = await this.#apiRequest({ url: `${ API_BASE }/teams`, logTag: 'getTeamsDictionary' })
    const data = (result && result.teams) || []
    const term = search ? String(search).toLowerCase() : null

    const items = data
      .filter(team => !term || String(team.name || '').toLowerCase().includes(term))
      .map(team => ({
        label: team.name || String(team.id),
        value: String(team.id),
        note: '',
      }))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Assignees Dictionary
   * @description Searchable combined list of admins (teammates) and teams for picking an assignee. Use it when an assignment accepts either an admin or a team - each item is noted Admin or Team to disambiguate.
   * @route POST /get-assignees-dictionary
   * @paramDef {"type":"getAssigneesDictionary__payload","label":"Payload","name":"payload","description":"Optional search text to filter assignees locally by name or email."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Ciaran Lee","value":"991267460","note":"Admin · admin@email.com"},{"label":"Example Team","value":"814865","note":"Team"}],"cursor":null}
   */
  async getAssigneesDictionary(payload) {
    const { search } = payload || {}
    const term = search ? String(search).toLowerCase() : null

    const [adminsResult, teamsResult] = await Promise.all([
      this.#apiRequest({ url: `${ API_BASE }/admins`, logTag: 'getAssigneesDictionary' }),
      this.#apiRequest({ url: `${ API_BASE }/teams`, logTag: 'getAssigneesDictionary' }),
    ])

    const admins = (adminsResult && adminsResult.admins) || []
    const teams = (teamsResult && teamsResult.teams) || []

    const adminItems = admins
      .filter(admin => !term || `${ admin.name || '' } ${ admin.email || '' }`.toLowerCase().includes(term))
      .map(admin => ({
        label: admin.name || admin.email || String(admin.id),
        value: String(admin.id),
        note: admin.email ? `Admin · ${ admin.email }` : 'Admin',
      }))

    const teamItems = teams
      .filter(team => !term || String(team.name || '').toLowerCase().includes(term))
      .map(team => ({
        label: team.name || String(team.id),
        value: String(team.id),
        note: 'Team',
      }))

    return { items: [...adminItems, ...teamItems], cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tags Dictionary
   * @description Searchable list of tags for picking a tag in other actions.
   * @route POST /get-tags-dictionary
   * @paramDef {"type":"getTagsDictionary__payload","label":"Payload","name":"payload","description":"Optional search text to filter tags locally by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Independent","value":"656452352","note":""}],"cursor":null}
   */
  async getTagsDictionary(payload) {
    const { search } = payload || {}

    const result = await this.#apiRequest({ url: `${ API_BASE }/tags`, logTag: 'getTagsDictionary' })
    const data = (result && result.data) || []
    const term = search ? String(search).toLowerCase() : null

    const items = data
      .filter(tag => !term || String(tag.name || '').toLowerCase().includes(term))
      .map(tag => ({
        label: tag.name || String(tag.id),
        value: String(tag.id),
        note: '',
      }))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Ticket Types Dictionary
   * @description Searchable list of ticket types for picking a ticket type when creating or converting tickets.
   * @route POST /get-ticket-types-dictionary
   * @paramDef {"type":"getTicketTypesDictionary__payload","label":"Payload","name":"payload","description":"Optional search text to filter ticket types locally by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Bug Report","value":"1234","note":""}],"cursor":null}
   */
  async getTicketTypesDictionary(payload) {
    const { search } = payload || {}

    const result = await this.#apiRequest({ url: `${ API_BASE }/ticket_types`, logTag: 'getTicketTypesDictionary' })
    const data = (result && result.data) || []
    const term = search ? String(search).toLowerCase() : null

    const items = data
      .filter(type => !term || String(type.name || '').toLowerCase().includes(term))
      .map(type => ({
        label: type.name || String(type.id),
        value: String(type.id),
        note: type.category || '',
      }))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Ticket States Dictionary
   * @description Searchable list of ticket states for picking a state when updating a ticket.
   * @route POST /get-ticket-states-dictionary
   * @paramDef {"type":"getTicketStatesDictionary__payload","label":"Payload","name":"payload","description":"Optional search text to filter ticket states locally by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"In progress","value":"8538","note":"in_progress"}],"cursor":null}
   */
  async getTicketStatesDictionary(payload) {
    const { search } = payload || {}

    const result = await this.#apiRequest({ url: `${ API_BASE }/ticket_states`, logTag: 'getTicketStatesDictionary' })
    const data = (result && result.data) || []
    const term = search ? String(search).toLowerCase() : null

    const items = data
      .filter(state => {
        if (!term) return true
        const label = state.detail || state.internal_label || state.external_label || ''

        return String(label).toLowerCase().includes(term)
      })
      .map(state => ({
        label: state.detail || state.internal_label || state.external_label || String(state.id),
        value: String(state.id),
        note: state.category || '',
      }))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tickets Dictionary
   * @description Searchable list of recent tickets (newest first) for picking a ticket in other actions.
   * @route POST /get-tickets-dictionary
   * @paramDef {"type":"getTicketsDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor for retrieving and filtering recent tickets."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"#38","value":"631","note":"Submitted"}],"cursor":null}
   */
  async getTicketsDictionary(payload) {
    const { search, cursor } = payload || {}

    const result = await this.#apiRequest({
      url: `${ API_BASE }/tickets/search`,
      method: 'post',
      body: { query: { field: 'created_at', operator: '>', value: '0' }, pagination: { per_page: DEFAULT_PAGE_SIZE, starting_after: cursor || undefined } },
      logTag: 'getTicketsDictionary',
    })

    const data = (result && result.tickets) || []
    const term = search ? String(search).toLowerCase() : null

    const items = data
      .filter(ticket => {
        if (!term) return true
        const title = ticket.ticket_attributes?._default_title_ || ''

        return String(ticket.ticket_id || '').includes(term) || String(title).toLowerCase().includes(term)
      })
      .map(ticket => ({
        label: `#${ ticket.ticket_id || ticket.id }${ ticket.ticket_attributes?._default_title_ ? ` — ${ ticket.ticket_attributes._default_title_ }` : '' }`,
        value: String(ticket.id),
        note: ticket.ticket_state?.category || ticket.ticket_state?.id || '',
      }))

    return { items, cursor: result?.pages?.next?.starting_after || null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Subscription Types Dictionary
   * @description Searchable list of subscription types for picking a subscription in other actions.
   * @route POST /get-subscription-types-dictionary
   * @paramDef {"type":"getSubscriptionTypesDictionary__payload","label":"Payload","name":"payload","description":"Optional search text to filter subscription types locally."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Product Updates","value":"37846","note":"opt_out"}],"cursor":null}
   */
  async getSubscriptionTypesDictionary(payload) {
    const { search } = payload || {}

    const result = await this.#apiRequest({ url: `${ API_BASE }/subscription_types`, logTag: 'getSubscriptionTypesDictionary' })
    const data = (result && result.data) || []
    const term = search ? String(search).toLowerCase() : null

    const items = data
      .filter(sub => {
        if (!term) return true
        const label = this.#subscriptionLabel(sub)

        return label.toLowerCase().includes(term)
      })
      .map(sub => ({
        label: this.#subscriptionLabel(sub),
        value: String(sub.id),
        note: sub.consent_type || '',
      }))

    return { items, cursor: null }
  }

  // Builds a readable label for a subscription type (the API has no name field on all plans).
  #subscriptionLabel(sub) {
    if (sub.default_translation && sub.default_translation.name) {
      return sub.default_translation.name
    }

    return sub.state ? `${ sub.state } (${ sub.id })` : String(sub.id)
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Collections Dictionary
   * @description Searchable list of Help Center collections for picking a collection in other actions.
   * @route POST /get-collections-dictionary
   * @paramDef {"type":"getCollectionsDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor for retrieving and filtering collections."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"collection 51","value":"6871119","note":""}],"cursor":null}
   */
  async getCollectionsDictionary(payload) {
    const { search, cursor } = payload || {}

    const result = await this.#apiRequest({
      url: `${ API_BASE }/help_center/collections`,
      query: this.#compact({ per_page: DEFAULT_PAGE_SIZE, starting_after: cursor }),
      logTag: 'getCollectionsDictionary',
    })

    const data = (result && result.data) || []
    const term = search ? String(search).toLowerCase() : null

    const items = data
      .filter(collection => !term || String(collection.name || '').toLowerCase().includes(term))
      .map(collection => ({
        label: collection.name || String(collection.id),
        value: String(collection.id),
        note: '',
      }))

    return { items, cursor: result?.pages?.next?.starting_after || null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Segments Dictionary
   * @description Searchable list of contact segments for picking a segment in other actions.
   * @route POST /get-segments-dictionary
   * @paramDef {"type":"getSegmentsDictionary__payload","label":"Payload","name":"payload","description":"Optional search text to filter segments locally by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Active","value":"56203d253cba154d39010062","note":"user"}],"cursor":null}
   */
  async getSegmentsDictionary(payload) {
    const { search } = payload || {}

    const result = await this.#apiRequest({ url: `${ API_BASE }/segments`, logTag: 'getSegmentsDictionary' })
    const data = (result && result.segments) || []
    const term = search ? String(search).toLowerCase() : null

    const items = data
      .filter(segment => !term || String(segment.name || '').toLowerCase().includes(term))
      .map(segment => ({
        label: segment.name || String(segment.id),
        value: String(segment.id),
        note: segment.person_type || '',
      }))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Articles Dictionary
   * @description Searchable list of Help Center articles for picking an article in other actions.
   * @route POST /get-articles-dictionary
   * @paramDef {"type":"getArticlesDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor for retrieving and filtering articles."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Thanks for everything","value":"6871119","note":"published"}],"cursor":null}
   */
  async getArticlesDictionary(payload) {
    const { search, cursor } = payload || {}

    const result = await this.#apiRequest({
      url: `${ API_BASE }/articles`,
      query: this.#compact({ per_page: DEFAULT_PAGE_SIZE, starting_after: cursor }),
      logTag: 'getArticlesDictionary',
    })

    const data = (result && result.data) || []
    const term = search ? String(search).toLowerCase() : null

    const items = data
      .filter(article => !term || String(article.title || '').toLowerCase().includes(term))
      .map(article => ({
        label: article.title || String(article.id),
        value: String(article.id),
        note: article.state || '',
      }))

    return { items, cursor: result?.pages?.next?.starting_after || null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Data Attributes Dictionary
   * @description Searchable list of data attributes for picking an attribute to update.
   * @route POST /get-data-attributes-dictionary
   * @paramDef {"type":"getDataAttributesDictionary__payload","label":"Payload","name":"payload","description":"Optional search text to filter data attributes locally by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"custom_attributes.paid_subscriber","value":"188","note":"contact"}],"cursor":null}
   */
  async getDataAttributesDictionary(payload) {
    const { search } = payload || {}

    const result = await this.#apiRequest({ url: `${ API_BASE }/data_attributes`, logTag: 'getDataAttributesDictionary' })
    const data = (result && result.data) || []
    const term = search ? String(search).toLowerCase() : null

    const items = data
      .filter(attr => attr.id !== undefined && attr.id !== null)
      .filter(attr => !term || `${ attr.full_name || '' } ${ attr.name || '' }`.toLowerCase().includes(term))
      .map(attr => ({
        label: attr.full_name || attr.name || String(attr.id),
        value: String(attr.id),
        note: attr.model || '',
      }))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Notes Dictionary
   * @description Searchable list of a contact's notes for picking a note. Depends on the selected contact.
   * @route POST /get-notes-dictionary
   * @paramDef {"type":"getNotesDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the contact criteria identifying whose notes to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Hello","value":"31","note":"991267583"}],"cursor":null}
   */
  async getNotesDictionary(payload) {
    const { search, criteria } = payload || {}
    const contactId = criteria && criteria.contactId

    if (!contactId) {
      return { items: [], cursor: null }
    }

    const result = await this.#apiRequest({ url: `${ API_BASE }/contacts/${ contactId }/notes`, logTag: 'getNotesDictionary' })
    const data = (result && result.data) || []
    const term = search ? String(search).toLowerCase() : null

    const items = data
      .filter(note => !term || this.#stripHtml(note.body).toLowerCase().includes(term))
      .map(note => ({
        label: this.#stripHtml(note.body).slice(0, 60) || `Note ${ note.id }`,
        value: String(note.id),
        note: note.author?.id ? String(note.author.id) : '',
      }))

    return { items, cursor: result?.pages?.next?.starting_after || null }
  }

  // Strips HTML tags from a note body so dictionary labels are readable plain text.
  #stripHtml(value) {
    return String(value || '').replace(/<[^>]*>/g, '').trim()
  }

  // ==========================================================================
  //  TRIGGERS (polling) - webhooks are not API-manageable, so these poll the search API
  // ==========================================================================
  /**
   * @registerAs POLLING_TRIGGER
   * @operationName New Conversation
   * @category Triggers
   * @description Fires when a new conversation is created in your workspace. Polls the conversations search API by created_at since the last poll. Polling interval can be customized (minimum 30 seconds).
   * @route POST /on-new-conversation
   * @returns {Object}
   * @sampleResult {"type":"conversation","id":"123","created_at":1734537500,"state":"open","source":{"type":"conversation","author":{"type":"user","id":"6762f11b1bb69f9f2193bba3"}}}
   */
  async onNewConversation(invocation) {
    return this.#pollByCreatedAt({
      invocation,
      url: `${ API_BASE }/conversations/search`,
      collectionKey: 'conversations',
      logTag: 'onNewConversation',
    })
  }

  /**
   * @registerAs POLLING_TRIGGER
   * @operationName New Contact
   * @category Triggers
   * @description Fires when a new contact (user or lead) is created. Polls the contacts search API by created_at since the last poll. Polling interval can be customized (minimum 30 seconds).
   * @route POST /on-new-contact
   * @returns {Object}
   * @sampleResult {"type":"contact","id":"6762f0dd1bb69f9f2193bb83","role":"user","email":"joebloggs@intercom.io","created_at":1734537437}
   */
  async onNewContact(invocation) {
    return this.#pollByCreatedAt({
      invocation,
      url: `${ API_BASE }/contacts/search`,
      collectionKey: 'data',
      logTag: 'onNewContact',
    })
  }

  /**
   * @registerAs POLLING_TRIGGER
   * @operationName New Ticket
   * @category Triggers
   * @description Fires when a new ticket is created in your workspace. Polls the tickets search API by created_at since the last poll. Polling interval can be customized (minimum 30 seconds).
   * @route POST /on-new-ticket
   * @returns {Object}
   * @sampleResult {"type":"ticket","id":"1295","ticket_id":"1390","category":"Customer","ticket_state":{"type":"ticket_state","id":"8537"},"created_at":1734537223,"updated_at":1734537223,"open":true}
   */
  async onNewTicket(invocation) {
    return this.#pollByCreatedAt({
      invocation,
      url: `${ API_BASE }/tickets/search`,
      collectionKey: 'tickets',
      logTag: 'onNewTicket',
    })
  }

  // Shared polling logic for both triggers: search the resource by created_at since the stored
  // watermark, OLDEST-FIRST, paging through every result page so bursts larger than one page are
  // never skipped. First poll seeds state (lastCreatedAt = now) and emits nothing.
  //
  // The watermark is NOT advanced all the way to the newest record seen; it is held back to
  // (now - LAG) so the most recent LAG-second window stays inside every query. Records in that
  // window are still emitted immediately, but their IDs are kept in a bounded `seen` set so the
  // overlap re-query de-duplicates them. A record that only becomes queryable later but whose
  // created_at falls in the window is not in `seen`, so it is emitted on the poll that finally
  // surfaces it - closing the late-record gap. The watermark never moves backwards.
  async #pollByCreatedAt({ invocation, url, collectionKey, logTag }) {
    const state = (invocation && invocation.state) || {}
    const now = Math.floor(Date.now() / 1000)

    if (!state.lastCreatedAt) {
      return { events: [], state: { lastCreatedAt: now, seen: [] } }
    }

    const since = Number(state.lastCreatedAt)
    const seen = new Set(state.seen || [])

    const all = await this.#searchAllByCreatedAt({ url, collectionKey, since, logTag })

    // Emit anything at/after the watermark we have not already emitted (boundary dedupe).
    const fresh = all.filter(item => Number(item.created_at) >= since && !seen.has(String(item.id)))

    let maxCreatedAt = since

    for (const item of all) {
      maxCreatedAt = Math.max(maxCreatedAt, Number(item.created_at) || 0)
    }

    // Advance the watermark, but never past (now - LAG) so the recent, still-settling window stays
    // re-queried; never let it move backwards (floor at the previous watermark).
    const watermark = Math.max(since, Math.min(maxCreatedAt, now - POLL_LAG_SECONDS))

    // Remember every id at/after the new watermark - the only ids the next poll's `> watermark - 1`
    // query can re-return, so they are de-duplicated rather than re-emitted. `all` already includes
    // the boundary records the overlap re-surfaced, so filtering it covers both freshly-emitted and
    // previously-seen ids in the window. Bounded to the lag window, so it never grows without limit.
    const nextSeen = all
      .filter(item => Number(item.created_at) >= watermark)
      .map(item => String(item.id))

    return { events: fresh, state: { lastCreatedAt: watermark, seen: nextSeen } }
  }

  // Pages through /search OLDEST-FIRST (sort created_at ascending) following pages.next.starting_after
  // until exhausted, so no records are dropped when more than one page is created between polls. A
  // hard page cap guards against an unexpectedly large backlog stalling a single poll cycle.
  async #searchAllByCreatedAt({ url, collectionKey, since, logTag }) {
    const MAX_PAGES = 20
    const out = []
    let startingAfter
    let page = 0

    do {
      const pagination = this.#compact({ per_page: DEFAULT_PAGE_SIZE, starting_after: startingAfter })

      const result = await this.#apiRequest({
        url,
        method: 'post',
        body: {
          query: { field: 'created_at', operator: '>', value: String(since - 1) },
          sort: { field: 'created_at', order: 'ascending' },
          pagination,
        },
        logTag,
      })

      const items = (result && result[collectionKey]) || []

      out.push(...items)

      startingAfter = result?.pages?.next?.starting_after || null
      page += 1
    } while (startingAfter && page < MAX_PAGES)

    return out
  }

  /**
   * @registerAs POLLING_TRIGGER
   * @operationName Conversation Closed
   * @category Triggers
   * @description Fires when a conversation is closed. Polls the conversations search API for statistics.last_close_at (the timestamp Intercom stamps on every close, independent of the conversation's created/updated time) since the last poll, restricted to conversations that are currently in the closed state. A conversation closed and then reopened again before the next poll runs will not fire. Polling interval can be customized (minimum 30 seconds).
   * @route POST /on-conversation-closed
   * @returns {Object}
   * @sampleResult {"type":"conversation","id":"123","state":"closed","open":false,"updated_at":1734537600,"statistics":{"type":"conversation_statistics","last_close_at":1734537600}}
   */
  async onConversationClosed(invocation) {
    return this.#pollByStatField({
      invocation,
      field: 'statistics.last_close_at',
      extraFilter: { field: 'state', operator: '=', value: 'closed' },
      logTag: 'onConversationClosed',
    })
  }

  /**
   * @registerAs POLLING_TRIGGER
   * @operationName Conversation Replied
   * @category Triggers
   * @description Fires when an admin sends a public reply on a conversation. Polls the conversations search API for statistics.last_admin_reply_at (the timestamp Intercom stamps on every admin comment, independent of the conversation's created/updated time) since the last poll. Internal admin notes do not update this timestamp, so they will not fire this trigger. Polling interval can be customized (minimum 30 seconds).
   * @route POST /on-conversation-replied
   * @returns {Object}
   * @sampleResult {"type":"conversation","id":"123","state":"open","updated_at":1734537600,"statistics":{"type":"conversation_statistics","last_admin_reply_at":1734537600}}
   */
  async onConversationReplied(invocation) {
    return this.#pollByStatField({
      invocation,
      field: 'statistics.last_admin_reply_at',
      logTag: 'onConversationReplied',
    })
  }

  // Shared polling logic for the state/statistics-based conversation triggers (Closed, Replied).
  // Unlike #pollByCreatedAt (which tracks the immutable created_at field), these track a mutable
  // Intercom statistics timestamp - statistics.last_close_at / statistics.last_admin_reply_at -
  // that Intercom stamps every time the watched event (close / admin reply) happens, even on a
  // conversation created long ago. Same compound-cursor shape and lag/dedupe strategy as
  // #pollByCreatedAt: state = { lastValue, seen[] }, held back by POLL_LAG_SECONDS, with `seen`
  // bounded to the ids sitting exactly at the current watermark so a same-second burst is not
  // dropped and a boundary record is not re-emitted on the next poll's overlap re-query.
  async #pollByStatField({ invocation, field, extraFilter, logTag }) {
    const state = (invocation && invocation.state) || {}
    const now = Math.floor(Date.now() / 1000)

    if (!state.lastValue) {
      return { events: [], state: { lastValue: now, seen: [] } }
    }

    const since = Number(state.lastValue)
    const seen = new Set(state.seen || [])

    const all = await this.#searchAllByStatField({ field, extraFilter, since, logTag })
    const valueOf = item => Number(this.#getPath(item, field)) || 0

    // Emit anything at/after the watermark we have not already emitted (boundary dedupe).
    const fresh = all.filter(item => valueOf(item) >= since && !seen.has(String(item.id)))

    let maxValue = since

    for (const item of all) {
      maxValue = Math.max(maxValue, valueOf(item))
    }

    // Advance the watermark, but never past (now - LAG) so the recent, still-settling window stays
    // re-queried; never let it move backwards (floor at the previous watermark).
    const watermark = Math.max(since, Math.min(maxValue, now - POLL_LAG_SECONDS))

    // Remember every id at/after the new watermark - the only ids the next poll's `> watermark - 1`
    // query can re-return, so they are de-duplicated rather than re-emitted. Bounded to the lag
    // window, so it never grows without limit.
    const nextSeen = all
      .filter(item => valueOf(item) >= watermark)
      .map(item => String(item.id))

    return { events: fresh, state: { lastValue: watermark, seen: nextSeen } }
  }

  // Pages /conversations/search OLDEST-FIRST (sorted ascending on the tracked statistics field),
  // optionally AND-ed with one extra single-value filter (e.g. state = closed), following
  // pages.next.starting_after until exhausted. Mirrors #searchAllByCreatedAt's pagination cap.
  async #searchAllByStatField({ field, extraFilter, since, logTag }) {
    const MAX_PAGES = 20
    const out = []
    let startingAfter
    let page = 0

    const dateFilter = { field, operator: '>', value: String(since - 1) }
    const query = extraFilter ? { operator: 'AND', value: [dateFilter, extraFilter] } : dateFilter

    do {
      const pagination = this.#compact({ per_page: DEFAULT_PAGE_SIZE, starting_after: startingAfter })

      const result = await this.#apiRequest({
        url: `${ API_BASE }/conversations/search`,
        method: 'post',
        body: {
          query,
          sort: { field, order: 'ascending' },
          pagination,
        },
        logTag,
      })

      const items = (result && result.conversations) || []

      out.push(...items)

      startingAfter = result?.pages?.next?.starting_after || null
      page += 1
    } while (startingAfter && page < MAX_PAGES)

    return out
  }

  // Reads a dotted path (e.g. "statistics.last_close_at") off a response object.
  #getPath(obj, path) {
    return path.split('.').reduce((acc, key) => (acc === null || acc === undefined ? acc : acc[key]), obj)
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    return this[invocation.eventName](invocation)
  }
}

Flowrunner.ServerCode.addService(Intercom, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth2 Client ID from your Intercom app in the Developer Hub (https://app.intercom.com/a/apps/_/developer-hub).',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth2 Client Secret from your Intercom app in the Developer Hub (https://app.intercom.com/a/apps/_/developer-hub).',
  },
])
