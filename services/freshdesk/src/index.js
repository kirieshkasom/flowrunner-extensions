const logger = {
  info: (...args) => console.log('[Freshdesk] info:', ...args),
  debug: (...args) => console.log('[Freshdesk] debug:', ...args),
  error: (...args) => console.log('[Freshdesk] error:', ...args),
  warn: (...args) => console.log('[Freshdesk] warn:', ...args),
}

const DEFAULT_PAGE_SIZE = 30

const PRIORITY_MAP = { 'Low': 1, 'Medium': 2, 'High': 3, 'Urgent': 4 }
const STATUS_MAP = { 'Open': 2, 'Pending': 3, 'Resolved': 4, 'Closed': 5 }
const SOURCE_MAP = { 'Email': 1, 'Portal': 2, 'Phone': 3, 'Chat': 7 }
const TICKET_FILTER_MAP = {
  'New & My Open': 'new_and_my_open',
  'Watching': 'watching',
  'Spam': 'spam',
  'Deleted': 'deleted',
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
 * @integrationName Freshdesk
 * @integrationIcon /icon.svg
 */
class FreshdeskService {
  constructor(config) {
    this.domain = String(config.domain || '')
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\.freshdesk\.com.*$/i, '')
      .replace(/\/.*$/, '')

    this.apiKey = config.apiKey
  }

  get #baseUrl() {
    return `https://${ this.domain }.freshdesk.com/api/v2`
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const url = `${ this.#baseUrl }${ path }`

    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery || {}) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Basic ${ Buffer.from(`${ this.apiKey }:X`).toString('base64') }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const errorBody = error.body || {}
      let message = errorBody.description || error.message || 'Unknown error'

      if (Array.isArray(errorBody.errors) && errorBody.errors.length) {
        const details = errorBody.errors
          .map(item => (item.field ? `${ item.field }: ${ item.message }` : item.message))
          .filter(Boolean)
          .join('; ')

        if (details) {
          message = `${ message } (${ details })`
        }
      }

      const status = error.status || error.statusCode

      if (status === 429) {
        const retryAfter = error.response?.headers?.['retry-after'] || error.headers?.['retry-after']

        message = `Rate limit exceeded${ retryAfter ? `, retry after ${ retryAfter } seconds` : '' }. ${ message }`
      }

      logger.error(`${ logTag } - Request failed: ${ message }`)

      throw new Error(`Freshdesk API error: ${ message }`)
    }
  }

  // ==================== Tickets ====================

  /**
   * @operationName Create Ticket
   * @category Tickets
   * @description Creates a new support ticket in Freshdesk. Provide either the requester Email or an existing Requester ID. The description supports HTML markup. Priority, status, and source accept friendly labels; group and agent can be selected from your Freshdesk account. Account-specific fields can be set via Custom Fields (keys must match the field names from List Ticket Fields, e.g. cf_order_id).
   * @route POST /create-ticket
   *
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Subject line of the ticket."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Body of the ticket. HTML markup is supported."}
   * @paramDef {"type":"String","label":"Requester Email","name":"email","description":"Email address of the requester. If no contact exists with this email, a new contact is created automatically. Required unless Requester ID is provided."}
   * @paramDef {"type":"Number","label":"Requester ID","name":"requesterId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of an existing contact to set as the requester. Required unless Requester Email is provided."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","defaultValue":"Low","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Medium","High","Urgent"]}},"description":"Ticket priority. Defaults to Low."}
   * @paramDef {"type":"String","label":"Status","name":"status","defaultValue":"Open","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Pending","Resolved","Closed"]}},"description":"Ticket status. Defaults to Open."}
   * @paramDef {"type":"String","label":"Source","name":"source","defaultValue":"Portal","uiComponent":{"type":"DROPDOWN","options":{"values":["Email","Portal","Phone","Chat"]}},"description":"Channel through which the ticket was created. Defaults to Portal."}
   * @paramDef {"type":"String","label":"Type","name":"type","description":"Category of the ticket, e.g. Question, Incident, Problem, Feature Request. Must match a type configured in your Freshdesk account."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags to associate with the ticket."}
   * @paramDef {"type":"Array<String>","label":"CC Emails","name":"ccEmails","description":"Email addresses added to the CC field of the incoming ticket email."}
   * @paramDef {"type":"String","label":"Group","name":"groupId","dictionary":"getGroupsDictionary","description":"Group to assign the ticket to. Select from your Freshdesk groups or enter a group ID."}
   * @paramDef {"type":"String","label":"Agent","name":"responderId","dictionary":"getAgentsDictionary","description":"Agent to assign the ticket to. Select from your Freshdesk agents or enter an agent ID."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Key/value pairs of custom ticket fields, e.g. {\"cf_order_id\":\"12345\"}. Use List Ticket Fields to discover available field names."}
   *
   * @returns {Object}
   * @sampleResult {"id":42,"subject":"Cannot log in","description_text":"I cannot log in to my account","status":2,"priority":1,"source":2,"type":"Question","requester_id":2043000123456,"responder_id":null,"group_id":null,"tags":["login"],"cc_emails":[],"custom_fields":{},"created_at":"2026-07-13T10:00:00Z","updated_at":"2026-07-13T10:00:00Z"}
   */
  async createTicket(subject, description, email, requesterId, priority, status, source, type, tags, ccEmails, groupId, responderId, customFields) {
    const logTag = '[createTicket]'

    return await this.#apiRequest({
      logTag,
      path: '/tickets',
      method: 'post',
      body: clean({
        subject,
        description,
        email,
        requester_id: requesterId,
        priority: this.#resolveChoice(priority, PRIORITY_MAP) ?? 1,
        status: this.#resolveChoice(status, STATUS_MAP) ?? 2,
        source: this.#resolveChoice(source, SOURCE_MAP) ?? 2,
        type,
        tags,
        cc_emails: ccEmails,
        group_id: groupId ? Number(groupId) : undefined,
        responder_id: responderId ? Number(responderId) : undefined,
        custom_fields: customFields,
      }),
    })
  }

  /**
   * @operationName Get Ticket
   * @category Tickets
   * @description Retrieves a single ticket by its ID, including subject, description, status, priority, requester, assignment, tags, and custom fields. Optionally embeds the ticket's conversations (up to the 10 most recent) in the response.
   * @route GET /get-ticket
   *
   * @paramDef {"type":"Number","label":"Ticket ID","name":"ticketId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the ticket to retrieve."}
   * @paramDef {"type":"Boolean","label":"Include Conversations","name":"includeConversations","uiComponent":{"type":"TOGGLE"},"description":"When enabled, embeds the ticket's 10 most recent conversations in the response. Use List Ticket Conversations for full pagination."}
   *
   * @returns {Object}
   * @sampleResult {"id":42,"subject":"Cannot log in","description_text":"I cannot log in to my account","status":2,"priority":1,"source":2,"type":"Question","requester_id":2043000123456,"responder_id":2043000654321,"group_id":2043000112233,"tags":["login"],"custom_fields":{},"conversations":[{"id":2043001234567,"body_text":"We are looking into it","private":false,"user_id":2043000654321,"created_at":"2026-07-13T11:00:00Z"}],"created_at":"2026-07-13T10:00:00Z","updated_at":"2026-07-13T11:00:00Z"}
   */
  async getTicket(ticketId, includeConversations) {
    const logTag = '[getTicket]'

    return await this.#apiRequest({
      logTag,
      path: `/tickets/${ ticketId }`,
      method: 'get',
      query: {
        include: includeConversations ? 'conversations' : undefined,
      },
    })
  }

  /**
   * @operationName List Tickets
   * @category Tickets
   * @description Lists tickets in the Freshdesk account, sorted by creation date (newest first). Supports the predefined Freshdesk views (New & My Open, Watching, Spam, Deleted), an updated-since timestamp filter, and pagination. Note: without the Updated Since filter, Freshdesk only returns tickets created in the past 30 days. For arbitrary criteria use Search Tickets.
   * @route GET /list-tickets
   *
   * @paramDef {"type":"String","label":"Filter","name":"filter","uiComponent":{"type":"DROPDOWN","options":{"values":["New & My Open","Watching","Spam","Deleted"]}},"description":"Predefined Freshdesk view to filter tickets by. Leave empty to list all accessible tickets."}
   * @paramDef {"type":"String","label":"Updated Since","name":"updatedSince","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return tickets updated at or after this time (ISO 8601, e.g. 2026-07-01T00:00:00Z). Also lifts the default 30-day creation window."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of tickets per page (max 100). Defaults to 30."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":42,"subject":"Cannot log in","status":2,"priority":1,"source":2,"requester_id":2043000123456,"responder_id":null,"group_id":null,"tags":["login"],"created_at":"2026-07-13T10:00:00Z","updated_at":"2026-07-13T11:00:00Z"}]
   */
  async listTickets(filter, updatedSince, page, perPage) {
    const logTag = '[listTickets]'

    return await this.#apiRequest({
      logTag,
      path: '/tickets',
      method: 'get',
      query: {
        filter: this.#resolveChoice(filter, TICKET_FILTER_MAP),
        updated_since: updatedSince,
        page: page || 1,
        per_page: perPage || DEFAULT_PAGE_SIZE,
      },
    })
  }

  /**
   * @operationName Update Ticket
   * @category Tickets
   * @description Updates an existing ticket. Only the provided fields are changed; all other fields keep their current values. Priority and status accept friendly labels, and group/agent assignment can be selected from your Freshdesk account.
   * @route PUT /update-ticket
   *
   * @paramDef {"type":"Number","label":"Ticket ID","name":"ticketId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the ticket to update."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"New subject line for the ticket."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New body for the ticket. HTML markup is supported."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Medium","High","Urgent"]}},"description":"New ticket priority. Leave empty to keep the current priority."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Pending","Resolved","Closed"]}},"description":"New ticket status. Leave empty to keep the current status."}
   * @paramDef {"type":"String","label":"Type","name":"type","description":"New ticket type, e.g. Question, Incident, Problem, Feature Request. Must match a type configured in your Freshdesk account."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags for the ticket. Replaces the existing tags when provided."}
   * @paramDef {"type":"String","label":"Group","name":"groupId","dictionary":"getGroupsDictionary","description":"Group to assign the ticket to. Select from your Freshdesk groups or enter a group ID."}
   * @paramDef {"type":"String","label":"Agent","name":"responderId","dictionary":"getAgentsDictionary","description":"Agent to assign the ticket to. Select from your Freshdesk agents or enter an agent ID."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Key/value pairs of custom ticket fields to update, e.g. {\"cf_order_id\":\"12345\"}."}
   *
   * @returns {Object}
   * @sampleResult {"id":42,"subject":"Cannot log in","status":4,"priority":2,"source":2,"type":"Question","requester_id":2043000123456,"responder_id":2043000654321,"group_id":2043000112233,"tags":["login","resolved"],"custom_fields":{},"created_at":"2026-07-13T10:00:00Z","updated_at":"2026-07-13T12:00:00Z"}
   */
  async updateTicket(ticketId, subject, description, priority, status, type, tags, groupId, responderId, customFields) {
    const logTag = '[updateTicket]'

    return await this.#apiRequest({
      logTag,
      path: `/tickets/${ ticketId }`,
      method: 'put',
      body: clean({
        subject,
        description,
        priority: this.#resolveChoice(priority, PRIORITY_MAP),
        status: this.#resolveChoice(status, STATUS_MAP),
        type,
        tags,
        group_id: groupId ? Number(groupId) : undefined,
        responder_id: responderId ? Number(responderId) : undefined,
        custom_fields: customFields,
      }),
    })
  }

  /**
   * @operationName Delete Ticket
   * @category Tickets
   * @description Deletes a ticket by its ID. The ticket is moved to the Freshdesk trash (Deleted view) and can be restored by an administrator from the Freshdesk UI within 30 days.
   * @route DELETE /delete-ticket
   *
   * @paramDef {"type":"Number","label":"Ticket ID","name":"ticketId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the ticket to delete."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"ticketId":42}
   */
  async deleteTicket(ticketId) {
    const logTag = '[deleteTicket]'

    await this.#apiRequest({
      logTag,
      path: `/tickets/${ ticketId }`,
      method: 'delete',
    })

    return { deleted: true, ticketId }
  }

  /**
   * @operationName Add Reply
   * @category Tickets
   * @description Adds a public reply to a ticket. The reply is sent to the requester by email and appears in the ticket's conversation thread. The body supports HTML markup.
   * @route POST /add-reply
   *
   * @paramDef {"type":"Number","label":"Ticket ID","name":"ticketId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the ticket to reply to."}
   * @paramDef {"type":"String","label":"Body","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Content of the reply. HTML markup is supported."}
   * @paramDef {"type":"Array<String>","label":"CC Emails","name":"ccEmails","description":"Email addresses added to the CC field of the outgoing reply email."}
   * @paramDef {"type":"Array<String>","label":"BCC Emails","name":"bccEmails","description":"Email addresses added to the BCC field of the outgoing reply email."}
   *
   * @returns {Object}
   * @sampleResult {"id":2043001234567,"ticket_id":42,"body_text":"We have reset your password.","user_id":2043000654321,"cc_emails":[],"bcc_emails":[],"from_email":"support@yourcompany.freshdesk.com","created_at":"2026-07-13T12:00:00Z","updated_at":"2026-07-13T12:00:00Z"}
   */
  async addReply(ticketId, body, ccEmails, bccEmails) {
    const logTag = '[addReply]'

    return await this.#apiRequest({
      logTag,
      path: `/tickets/${ ticketId }/reply`,
      method: 'post',
      body: clean({
        body,
        cc_emails: ccEmails,
        bcc_emails: bccEmails,
      }),
    })
  }

  /**
   * @operationName Add Note
   * @category Tickets
   * @description Adds a note to a ticket's conversation thread. Notes are private (visible only to agents) by default; set Private to false to create a public note visible to the requester. The body supports HTML markup.
   * @route POST /add-note
   *
   * @paramDef {"type":"Number","label":"Ticket ID","name":"ticketId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the ticket to add the note to."}
   * @paramDef {"type":"String","label":"Body","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Content of the note. HTML markup is supported."}
   * @paramDef {"type":"Boolean","label":"Private","name":"private","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"Whether the note is visible only to agents. Defaults to true (private)."}
   *
   * @returns {Object}
   * @sampleResult {"id":2043001234568,"ticket_id":42,"body_text":"Customer verified via phone.","private":true,"incoming":false,"user_id":2043000654321,"created_at":"2026-07-13T12:05:00Z","updated_at":"2026-07-13T12:05:00Z"}
   */
  async addNote(ticketId, body, isPrivate) {
    const logTag = '[addNote]'

    return await this.#apiRequest({
      logTag,
      path: `/tickets/${ ticketId }/notes`,
      method: 'post',
      body: clean({
        body,
        private: isPrivate === undefined ? true : Boolean(isPrivate),
      }),
    })
  }

  /**
   * @operationName Search Tickets
   * @category Tickets
   * @description Searches tickets using the Freshdesk query language. Combine field conditions with AND/OR and group them with parentheses, e.g. priority:4 AND status:2, or type:'Question' OR tag:'urgent'. Numeric field values: priority 1=Low 2=Medium 3=High 4=Urgent; status 2=Open 3=Pending 4=Resolved 5=Closed. Other searchable fields include agent_id, group_id, tag, created_at, updated_at, due_by, and custom fields. Returns up to 30 results per page, maximum 10 pages (300 results).
   * @route GET /search-tickets
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Freshdesk search query, e.g. priority:4 AND status:2, or created_at:>'2026-07-01'. Do not include the surrounding double quotes; they are added automatically."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (1-10, 30 results per page). Defaults to 1."}
   *
   * @returns {Object}
   * @sampleResult {"total":2,"results":[{"id":42,"subject":"Cannot log in","status":2,"priority":4,"requester_id":2043000123456,"tags":["login"],"created_at":"2026-07-13T10:00:00Z","updated_at":"2026-07-13T11:00:00Z"}]}
   */
  async searchTickets(query, page) {
    const logTag = '[searchTickets]'
    const normalizedQuery = String(query || '').trim().replace(/^"+|"+$/g, '')

    return await this.#apiRequest({
      logTag,
      path: '/search/tickets',
      method: 'get',
      query: {
        query: `"${ normalizedQuery }"`,
        page: page || 1,
      },
    })
  }

  /**
   * @operationName List Ticket Conversations
   * @category Tickets
   * @description Lists all conversations (replies and notes) of a ticket in chronological order, with pagination. Each entry indicates whether it is private, incoming, and which user created it.
   * @route GET /list-ticket-conversations
   *
   * @paramDef {"type":"Number","label":"Ticket ID","name":"ticketId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the ticket whose conversations to list."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of conversations per page (max 100). Defaults to 30."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":2043001234567,"ticket_id":42,"body_text":"We have reset your password.","private":false,"incoming":false,"user_id":2043000654321,"from_email":"support@yourcompany.freshdesk.com","created_at":"2026-07-13T12:00:00Z"}]
   */
  async listTicketConversations(ticketId, page, perPage) {
    const logTag = '[listTicketConversations]'

    return await this.#apiRequest({
      logTag,
      path: `/tickets/${ ticketId }/conversations`,
      method: 'get',
      query: {
        page: page || 1,
        per_page: perPage || DEFAULT_PAGE_SIZE,
      },
    })
  }

  // ==================== Contacts ====================

  /**
   * @operationName Create Contact
   * @category Contacts
   * @description Creates a new contact (customer) in Freshdesk. At least one of Email or Phone is required. Custom contact fields can be set via Custom Fields using the field names configured in your account.
   * @route POST /create-contact
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Full name of the contact."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Primary email address of the contact. Must be unique in the account. Required unless Phone is provided."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Telephone number of the contact. Required unless Email is provided."}
   * @paramDef {"type":"Number","label":"Company ID","name":"companyId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the company the contact belongs to. Use List Companies to find company IDs."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Key/value pairs of custom contact fields, e.g. {\"department\":\"Sales\"}."}
   *
   * @returns {Object}
   * @sampleResult {"id":2043000123456,"name":"Jane Doe","email":"jane.doe@example.com","phone":"+1 555 0100","company_id":2043000998877,"active":false,"custom_fields":{},"created_at":"2026-07-13T10:00:00Z","updated_at":"2026-07-13T10:00:00Z"}
   */
  async createContact(name, email, phone, companyId, customFields) {
    const logTag = '[createContact]'

    return await this.#apiRequest({
      logTag,
      path: '/contacts',
      method: 'post',
      body: clean({
        name,
        email,
        phone,
        company_id: companyId,
        custom_fields: customFields,
      }),
    })
  }

  /**
   * @operationName Get Contact
   * @category Contacts
   * @description Retrieves a single contact by its ID, including name, email, phone, company association, tags, and custom fields.
   * @route GET /get-contact
   *
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the contact to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":2043000123456,"name":"Jane Doe","email":"jane.doe@example.com","phone":"+1 555 0100","mobile":null,"company_id":2043000998877,"active":true,"tags":[],"custom_fields":{},"created_at":"2026-07-13T10:00:00Z","updated_at":"2026-07-13T10:00:00Z"}
   */
  async getContact(contactId) {
    const logTag = '[getContact]'

    return await this.#apiRequest({
      logTag,
      path: `/contacts/${ contactId }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Contacts
   * @category Contacts
   * @description Lists contacts in the Freshdesk account with pagination. Optionally filters by an exact email address, which is the fastest way to look up a specific contact. For fuzzy matching use Search Contacts.
   * @route GET /list-contacts
   *
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Exact email address to filter by. Returns the matching contact only."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of contacts per page (max 100). Defaults to 30."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":2043000123456,"name":"Jane Doe","email":"jane.doe@example.com","phone":"+1 555 0100","company_id":2043000998877,"active":true,"created_at":"2026-07-13T10:00:00Z","updated_at":"2026-07-13T10:00:00Z"}]
   */
  async listContacts(email, page, perPage) {
    const logTag = '[listContacts]'

    return await this.#apiRequest({
      logTag,
      path: '/contacts',
      method: 'get',
      query: {
        email,
        page: page || 1,
        per_page: perPage || DEFAULT_PAGE_SIZE,
      },
    })
  }

  /**
   * @operationName Update Contact
   * @category Contacts
   * @description Updates an existing contact. Only the provided fields are changed; all other fields keep their current values.
   * @route PUT /update-contact
   *
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the contact to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New full name of the contact."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New primary email address. Must be unique in the account."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"New telephone number of the contact."}
   * @paramDef {"type":"Number","label":"Company ID","name":"companyId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the company the contact belongs to."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Key/value pairs of custom contact fields to update."}
   *
   * @returns {Object}
   * @sampleResult {"id":2043000123456,"name":"Jane Doe","email":"jane.doe@example.com","phone":"+1 555 0199","company_id":2043000998877,"active":true,"custom_fields":{},"created_at":"2026-07-13T10:00:00Z","updated_at":"2026-07-13T13:00:00Z"}
   */
  async updateContact(contactId, name, email, phone, companyId, customFields) {
    const logTag = '[updateContact]'

    return await this.#apiRequest({
      logTag,
      path: `/contacts/${ contactId }`,
      method: 'put',
      body: clean({
        name,
        email,
        phone,
        company_id: companyId,
        custom_fields: customFields,
      }),
    })
  }

  /**
   * @operationName Delete Contact
   * @category Contacts
   * @description Soft-deletes a contact by its ID. The contact is marked as deleted and their open tickets remain in the account; a soft-deleted contact can be restored from the Freshdesk UI.
   * @route DELETE /delete-contact
   *
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the contact to delete."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"contactId":2043000123456}
   */
  async deleteContact(contactId) {
    const logTag = '[deleteContact]'

    await this.#apiRequest({
      logTag,
      path: `/contacts/${ contactId }`,
      method: 'delete',
    })

    return { deleted: true, contactId }
  }

  /**
   * @operationName Search Contacts
   * @category Contacts
   * @description Searches contacts using the Freshdesk query language. Combine field conditions with AND/OR, e.g. name:'Jane' OR email:'jane.doe@example.com'. Searchable fields include name, email, mobile, phone, tag, company_id, and custom fields. Returns up to 30 results per page, maximum 10 pages (300 results).
   * @route GET /search-contacts
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Freshdesk search query, e.g. email:'jane.doe@example.com' or tag:'vip'. Do not include the surrounding double quotes; they are added automatically."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (1-10, 30 results per page). Defaults to 1."}
   *
   * @returns {Object}
   * @sampleResult {"total":1,"results":[{"id":2043000123456,"name":"Jane Doe","email":"jane.doe@example.com","phone":"+1 555 0100","company_id":2043000998877,"active":true,"created_at":"2026-07-13T10:00:00Z"}]}
   */
  async searchContacts(query, page) {
    const logTag = '[searchContacts]'
    const normalizedQuery = String(query || '').trim().replace(/^"+|"+$/g, '')

    return await this.#apiRequest({
      logTag,
      path: '/search/contacts',
      method: 'get',
      query: {
        query: `"${ normalizedQuery }"`,
        page: page || 1,
      },
    })
  }

  // ==================== Companies ====================

  /**
   * @operationName Create Company
   * @category Companies
   * @description Creates a new company in Freshdesk. Company names must be unique in the account. Domains associated with the company are used to automatically link contacts by their email domain.
   * @route POST /create-company
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the company. Must be unique in the account."}
   * @paramDef {"type":"Array<String>","label":"Domains","name":"domains","description":"Email domains associated with the company, e.g. example.com. Contacts with matching email domains are linked automatically."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Description of the company."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Key/value pairs of custom company fields."}
   *
   * @returns {Object}
   * @sampleResult {"id":2043000998877,"name":"Acme Inc","domains":["acme.com"],"description":"Key enterprise customer","note":null,"custom_fields":{},"created_at":"2026-07-13T10:00:00Z","updated_at":"2026-07-13T10:00:00Z"}
   */
  async createCompany(name, domains, description, customFields) {
    const logTag = '[createCompany]'

    return await this.#apiRequest({
      logTag,
      path: '/companies',
      method: 'post',
      body: clean({
        name,
        domains,
        description,
        custom_fields: customFields,
      }),
    })
  }

  /**
   * @operationName List Companies
   * @category Companies
   * @description Lists companies in the Freshdesk account with pagination, including their names, domains, and custom fields.
   * @route GET /list-companies
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of companies per page (max 100). Defaults to 30."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":2043000998877,"name":"Acme Inc","domains":["acme.com"],"description":"Key enterprise customer","created_at":"2026-07-13T10:00:00Z","updated_at":"2026-07-13T10:00:00Z"}]
   */
  async listCompanies(page, perPage) {
    const logTag = '[listCompanies]'

    return await this.#apiRequest({
      logTag,
      path: '/companies',
      method: 'get',
      query: {
        page: page || 1,
        per_page: perPage || DEFAULT_PAGE_SIZE,
      },
    })
  }

  /**
   * @operationName Get Company
   * @category Companies
   * @description Retrieves a single company by its ID, including name, domains, description, and custom fields.
   * @route GET /get-company
   *
   * @paramDef {"type":"Number","label":"Company ID","name":"companyId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the company to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":2043000998877,"name":"Acme Inc","domains":["acme.com"],"description":"Key enterprise customer","note":null,"custom_fields":{},"created_at":"2026-07-13T10:00:00Z","updated_at":"2026-07-13T10:00:00Z"}
   */
  async getCompany(companyId) {
    const logTag = '[getCompany]'

    return await this.#apiRequest({
      logTag,
      path: `/companies/${ companyId }`,
      method: 'get',
    })
  }

  // ==================== Admin ====================

  /**
   * @operationName List Agents
   * @category Admin
   * @description Lists agents in the Freshdesk account with pagination, including their contact details, availability, and ticket scope. Optionally filters by an exact email address.
   * @route GET /list-agents
   *
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Exact email address to filter by. Returns the matching agent only."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of agents per page (max 100). Defaults to 30."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":2043000654321,"available":true,"occasional":false,"ticket_scope":1,"contact":{"name":"John Agent","email":"john@yourcompany.com","active":true},"created_at":"2026-01-10T09:00:00Z","updated_at":"2026-07-01T09:00:00Z"}]
   */
  async listAgents(email, page, perPage) {
    const logTag = '[listAgents]'

    return await this.#apiRequest({
      logTag,
      path: '/agents',
      method: 'get',
      query: {
        email,
        page: page || 1,
        per_page: perPage || DEFAULT_PAGE_SIZE,
      },
    })
  }

  /**
   * @operationName List Groups
   * @category Admin
   * @description Lists agent groups in the Freshdesk account with pagination, including their names, descriptions, and escalation settings.
   * @route GET /list-groups
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of groups per page (max 100). Defaults to 30."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":2043000112233,"name":"Billing","description":"Handles billing questions","escalate_to":2043000654321,"unassigned_for":"30m","created_at":"2026-01-10T09:00:00Z","updated_at":"2026-07-01T09:00:00Z"}]
   */
  async listGroups(page, perPage) {
    const logTag = '[listGroups]'

    return await this.#apiRequest({
      logTag,
      path: '/groups',
      method: 'get',
      query: {
        page: page || 1,
        per_page: perPage || DEFAULT_PAGE_SIZE,
      },
    })
  }

  /**
   * @operationName List Ticket Fields
   * @category Admin
   * @description Lists all ticket fields configured in the Freshdesk account, including default and custom fields with their names, labels, types, choices, and whether they are required. Use this to discover the custom field names (e.g. cf_order_id) accepted by Create Ticket and Update Ticket.
   * @route GET /list-ticket-fields
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":2043000445566,"name":"cf_order_id","label":"Order ID","type":"custom_text","required_for_agents":false,"required_for_customers":false,"default":false,"created_at":"2026-01-10T09:00:00Z","updated_at":"2026-01-10T09:00:00Z"}]
   */
  async listTicketFields() {
    const logTag = '[listTicketFields]'

    return await this.#apiRequest({
      logTag,
      path: '/ticket_fields',
      method: 'get',
    })
  }

  // ==================== Dictionaries ====================

  /**
   * @typedef {Object} getAgentsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter agents by name or email."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number of the next page)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Agents Dictionary
   * @description Provides a searchable list of Freshdesk agents for selecting a ticket assignee. The option value is the agent ID.
   * @route POST /get-agents-dictionary
   * @paramDef {"type":"getAgentsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"John Agent","value":"2043000654321","note":"john@yourcompany.com"}],"cursor":"2"}
   */
  async getAgentsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getAgentsDictionary]'
    const page = Number(cursor) || 1
    const perPage = 100

    const agents = await this.#apiRequest({
      logTag,
      path: '/agents',
      method: 'get',
      query: { page, per_page: perPage },
    })

    const searchText = (search || '').toLowerCase()

    const items = (agents || [])
      .filter(agent => {
        if (!searchText) {
          return true
        }

        const name = agent.contact?.name || ''
        const agentEmail = agent.contact?.email || ''

        return name.toLowerCase().includes(searchText) || agentEmail.toLowerCase().includes(searchText)
      })
      .map(agent => ({
        label: agent.contact?.name || agent.contact?.email || String(agent.id),
        value: String(agent.id),
        note: agent.contact?.email || undefined,
      }))

    return {
      items,
      cursor: (agents || []).length === perPage ? String(page + 1) : null,
    }
  }

  /**
   * @typedef {Object} getGroupsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter groups by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number of the next page)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Groups Dictionary
   * @description Provides a searchable list of Freshdesk agent groups for selecting a ticket group. The option value is the group ID.
   * @route POST /get-groups-dictionary
   * @paramDef {"type":"getGroupsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Billing","value":"2043000112233","note":"Handles billing questions"}],"cursor":null}
   */
  async getGroupsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getGroupsDictionary]'
    const page = Number(cursor) || 1
    const perPage = 100

    const groups = await this.#apiRequest({
      logTag,
      path: '/groups',
      method: 'get',
      query: { page, per_page: perPage },
    })

    const searchText = (search || '').toLowerCase()

    const items = (groups || [])
      .filter(group => !searchText || (group.name || '').toLowerCase().includes(searchText))
      .map(group => ({
        label: group.name,
        value: String(group.id),
        note: group.description || undefined,
      }))

    return {
      items,
      cursor: (groups || []).length === perPage ? String(page + 1) : null,
    }
  }
}

Flowrunner.ServerCode.addService(FreshdeskService, [
  {
    name: 'domain',
    displayName: 'Domain',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Freshdesk subdomain. For yourcompany.freshdesk.com enter "yourcompany".',
  },
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Freshdesk API key. Find it in Freshdesk under Profile Settings → View API Key.',
  },
])
