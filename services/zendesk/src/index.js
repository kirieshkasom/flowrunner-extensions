// ============================================================================
//  Zendesk — FlowRunner extension
//  Auth: API token (Basic base64('{email}/token:{apiToken}'))
//  Base: https://{subdomain}.zendesk.com/api/v2
//  Resources: Tickets, Ticket Comments, Search, Users, Organizations, Groups
//  Triggers: REALTIME (SINGLE_APP) — On Ticket Event (webhook + business-rule
//            trigger pair; both resource ids are stored in webhookData)
// ============================================================================

const logger = {
  info: (...args) => console.log('[Zendesk] info:', ...args),
  debug: (...args) => console.log('[Zendesk] debug:', ...args),
  error: (...args) => console.log('[Zendesk] error:', ...args),
  warn: (...args) => console.log('[Zendesk] warn:', ...args),
}

const CALL_TYPES = {
  SHAPE_EVENT: 'SHAPE_EVENT',
  FILTER_TRIGGER: 'FILTER_TRIGGER',
}

// ── Friendly dropdown label → Zendesk API value mappings ────────────────────
const PRIORITY_MAP = { Low: 'low', Normal: 'normal', High: 'high', Urgent: 'urgent' }
const TICKET_TYPE_MAP = { Question: 'question', Incident: 'incident', Problem: 'problem', Task: 'task' }
const STATUS_MAP = { New: 'new', Open: 'open', Pending: 'pending', Hold: 'hold', Solved: 'solved' }
const USER_ROLE_MAP = { 'End User': 'end-user', Agent: 'agent', Admin: 'admin' }
const TICKETS_SORT_MAP = { 'Created At': 'created_at', 'Updated At': 'updated_at', ID: 'id', Status: 'status', Subject: 'subject' }
const SEARCH_SORT_MAP = { 'Created At': 'created_at', 'Updated At': 'updated_at', Priority: 'priority', Status: 'status', 'Ticket Type': 'ticket_type' }
const SORT_ORDER_MAP = { Ascending: 'asc', Descending: 'desc' }

// Trigger event dropdown label → Zendesk business-rule trigger `update_type`
// condition value, and → the fixed `event` marker baked into the webhook body
// template (used to route inbound deliveries back to the right trigger).
const TRIGGER_EVENT_TO_UPDATE_TYPE = { 'Ticket Created': 'Create', 'Ticket Updated': 'Change' }
const TRIGGER_EVENT_TO_EVENT_KEY = { 'Ticket Created': 'created', 'Ticket Updated': 'updated' }

const ERROR_HINTS = {
  401: 'Authentication failed — check the subdomain, agent email, and API token, and make sure token access is enabled in Admin Center.',
  403: 'Access denied — the authenticated agent lacks permission for this resource.',
  404: 'Not found — the ID may be wrong or the record was deleted.',
  409: 'Conflict — a record with the same unique value (e.g. email) already exists.',
  422: 'Unprocessable — one of the field values is invalid for this Zendesk account.',
  429: 'Rate limit hit — retry in a moment.',
}

// ============================================================================
//  DICTIONARY PAYLOAD TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} getAgentsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter agents by name or email."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getGroupsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter groups by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @integrationName Zendesk
 * @integrationIcon /icon.svg
 * @integrationTriggersScope SINGLE_APP
 */
class Zendesk {
  constructor(config) {
    this.config = config || {}

    // Accept 'yourcompany', 'yourcompany.zendesk.com', or a full URL.
    this.subdomain = String(this.config.subdomain || '')
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\.zendesk\.com.*$/, '')
      .replace(/\/.*$/, '')

    this.email = this.config.email
    this.apiToken = this.config.apiToken
    this.baseUrl = `https://${ this.subdomain }.zendesk.com/api/v2`
  }

  // ==========================================================================
  //  CORE — every external call goes through #apiRequest
  // ==========================================================================
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          Authorization: `Basic ${ Buffer.from(`${ this.email }/token:${ this.apiToken }`).toString('base64') }`,
          'Content-Type': 'application/json',
        })
        .query(query || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const status = error?.status || error?.statusCode
      // Zendesk error bodies: {error, description} or {error: {title, message}, details: {...}}
      const errorField = error?.body?.error
      const apiMessage =
        (typeof errorField === 'object' && errorField !== null
          ? [errorField.title, errorField.message].filter(Boolean).join(': ')
          : errorField) ||
        error?.body?.description ||
        error?.message ||
        'Request failed'
      const details = error?.body?.details ? ` Details: ${ JSON.stringify(error.body.details) }` : ''
      const hint = ERROR_HINTS[status]

      logger.error(`${ logTag } - failed: ${ apiMessage }${ details }`)

      throw new Error(`Zendesk API error: ${ hint ? `${ hint } (${ apiMessage })` : apiMessage }${ details }`)
    }
  }

  // Maps a friendly dropdown label to its API value; unmapped values pass through.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Strips undefined/null keys so partial updates only send what the user set.
  #compact(object) {
    const result = {}

    for (const [key, value] of Object.entries(object)) {
      if (value !== undefined && value !== null) {
        result[key] = value
      }
    }

    return result
  }

  // Splits an Array<String> param that may also arrive as a comma-separated string.
  #toList(value) {
    if (value === undefined || value === null || value === '') return undefined

    const list = Array.isArray(value)
      ? value
      : String(value).split(',').map(part => part.trim()).filter(Boolean)

    return list.length ? list : undefined
  }

  #toNumber(value) {
    if (value === undefined || value === null || value === '') return undefined

    return Number(value)
  }

  // Extracts the ?page= number from a Zendesk next_page URL for cursor-style pagination.
  #nextPageCursor(response) {
    if (!response?.next_page) return undefined

    const match = String(response.next_page).match(/[?&]page=(\d+)/)

    return match ? match[1] : undefined
  }

  // ==========================================================================
  //  TICKETS
  // ==========================================================================
  /**
   * @operationName Create Ticket
   * @category Tickets
   * @description Creates a new Zendesk ticket with a first comment. Supports setting priority, type, status, requester (by email — the user is created if it does not exist), assignee, group, tags, and custom fields. Returns the created ticket.
   * @route POST /create-ticket
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"The ticket subject line."}
   * @paramDef {"type":"String","label":"Comment Body","name":"commentBody","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Plain-text body of the first comment (the ticket description)."}
   * @paramDef {"type":"String","label":"Comment HTML Body","name":"htmlBody","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional HTML version of the first comment. When provided it takes precedence over the plain-text body in the agent interface."}
   * @paramDef {"type":"Boolean","label":"Public Comment","name":"publicComment","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"Whether the first comment is visible to the requester (true) or an internal note (false). Defaults to true."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Normal","High","Urgent"]}},"description":"Urgency of the ticket."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Question","Incident","Problem","Task"]}},"description":"The kind of ticket."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["New","Open","Pending","Hold","Solved"]}},"description":"Initial ticket status. Defaults to New when omitted."}
   * @paramDef {"type":"String","label":"Requester Email","name":"requesterEmail","description":"Email of the end user the ticket is for. If no Zendesk user has this email, one is created automatically. Defaults to the authenticated agent when omitted."}
   * @paramDef {"type":"String","label":"Requester Name","name":"requesterName","description":"Name for the requester, used when a new user is created from the requester email."}
   * @paramDef {"type":"String","label":"Assignee","name":"assigneeId","dictionary":"getAgentsDictionary","description":"The agent to assign the ticket to. Pick from the agents list or paste a Zendesk user ID."}
   * @paramDef {"type":"String","label":"Group","name":"groupId","dictionary":"getGroupsDictionary","description":"The group to assign the ticket to. Pick from the groups list or paste a Zendesk group ID."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags to set on the ticket, e.g. [\"billing\",\"vip\"]."}
   * @paramDef {"type":"Array<Object>","label":"Custom Fields","name":"customFields","description":"Custom ticket field values, passed through as-is. Each item is {\"id\": <field id>, \"value\": <value>}, e.g. [{\"id\":360001234567,\"value\":\"gold\"}]."}
   * @returns {Object}
   * @sampleResult {"id":35436,"url":"https://yourcompany.zendesk.com/api/v2/tickets/35436.json","subject":"Printer on fire","description":"The printer is literally on fire.","status":"new","priority":"urgent","type":"incident","requester_id":20978392,"assignee_id":235323,"group_id":98738,"tags":["printer","urgent"],"custom_fields":[{"id":360001234567,"value":"gold"}],"created_at":"2026-07-13T09:30:00Z","updated_at":"2026-07-13T09:30:00Z"}
   */
  async createTicket(subject, commentBody, htmlBody, publicComment, priority, type, status, requesterEmail, requesterName, assigneeId, groupId, tags, customFields) {
    // docs: https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/#create-ticket
    const ticket = this.#compact({
      subject,
      comment: this.#compact({
        body: commentBody,
        html_body: htmlBody,
        public: publicComment === undefined ? undefined : Boolean(publicComment),
      }),
      priority: this.#resolveChoice(priority, PRIORITY_MAP),
      type: this.#resolveChoice(type, TICKET_TYPE_MAP),
      status: this.#resolveChoice(status, STATUS_MAP),
      assignee_id: this.#toNumber(assigneeId),
      group_id: this.#toNumber(groupId),
      tags: this.#toList(tags),
      custom_fields: Array.isArray(customFields) && customFields.length ? customFields : undefined,
    })

    if (requesterEmail) {
      ticket.requester = this.#compact({ email: requesterEmail, name: requesterName })
    }

    const response = await this.#apiRequest({
      url: `${ this.baseUrl }/tickets.json`,
      method: 'post',
      body: { ticket },
      logTag: 'createTicket',
    })

    return response.ticket
  }

  /**
   * @operationName Get Ticket
   * @category Tickets
   * @description Retrieves a single Zendesk ticket by ID, including subject, description, status, priority, requester, assignee, group, tags, and custom fields.
   * @route GET /get-ticket
   * @paramDef {"type":"Number","label":"Ticket ID","name":"ticketId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The ID of the ticket to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":35436,"url":"https://yourcompany.zendesk.com/api/v2/tickets/35436.json","subject":"Printer on fire","description":"The printer is literally on fire.","status":"open","priority":"urgent","type":"incident","requester_id":20978392,"assignee_id":235323,"group_id":98738,"tags":["printer","urgent"],"created_at":"2026-07-13T09:30:00Z","updated_at":"2026-07-13T10:15:00Z"}
   */
  async getTicket(ticketId) {
    // docs: https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/#show-ticket
    const response = await this.#apiRequest({
      url: `${ this.baseUrl }/tickets/${ ticketId }.json`,
      logTag: 'getTicket',
    })

    return response.ticket
  }

  /**
   * @operationName List Tickets
   * @category Tickets
   * @description Lists tickets in the Zendesk account with sorting and page-based pagination (up to 100 per page). Returns the tickets plus the total count and next page number when more results exist.
   * @route GET /list-tickets
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","defaultValue":"Created At","uiComponent":{"type":"DROPDOWN","options":{"values":["Created At","Updated At","ID","Status","Subject"]}},"description":"Field to sort the tickets by."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","defaultValue":"Descending","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Direction to sort in."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Tickets per page, 1-100. Defaults to 100."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to fetch, starting at 1."}
   * @returns {Object}
   * @sampleResult {"tickets":[{"id":35436,"subject":"Printer on fire","status":"open","priority":"urgent","requester_id":20978392,"created_at":"2026-07-13T09:30:00Z"}],"count":101,"nextPage":"2"}
   */
  async listTickets(sortBy, sortOrder, perPage, page) {
    // docs: https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/#list-tickets
    const response = await this.#apiRequest({
      url: `${ this.baseUrl }/tickets.json`,
      query: this.#compact({
        sort_by: this.#resolveChoice(sortBy, TICKETS_SORT_MAP),
        sort_order: this.#resolveChoice(sortOrder, SORT_ORDER_MAP),
        per_page: this.#toNumber(perPage) || 100,
        page: this.#toNumber(page),
      }),
      logTag: 'listTickets',
    })

    return {
      tickets: response.tickets || [],
      count: response.count,
      nextPage: this.#nextPageCursor(response) || null,
    }
  }

  /**
   * @operationName Update Ticket
   * @category Tickets
   * @description Updates an existing ticket's subject, status, priority, type, assignee, group, or tags. Only the fields you provide are changed; tags, when provided, replace the ticket's existing tags. Returns the updated ticket.
   * @route PUT /update-ticket
   * @paramDef {"type":"Number","label":"Ticket ID","name":"ticketId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The ID of the ticket to update."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"New subject line."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["New","Open","Pending","Hold","Solved"]}},"description":"New ticket status."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Normal","High","Urgent"]}},"description":"New ticket priority."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Question","Incident","Problem","Task"]}},"description":"New ticket type."}
   * @paramDef {"type":"String","label":"Assignee","name":"assigneeId","dictionary":"getAgentsDictionary","description":"Agent to reassign the ticket to. Pick from the agents list or paste a Zendesk user ID."}
   * @paramDef {"type":"String","label":"Group","name":"groupId","dictionary":"getGroupsDictionary","description":"Group to reassign the ticket to. Pick from the groups list or paste a Zendesk group ID."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags to set on the ticket. Replaces the existing tags entirely."}
   * @returns {Object}
   * @sampleResult {"id":35436,"subject":"Printer on fire","status":"solved","priority":"high","type":"incident","assignee_id":235323,"group_id":98738,"tags":["printer","resolved"],"updated_at":"2026-07-13T12:00:00Z"}
   */
  async updateTicket(ticketId, subject, status, priority, type, assigneeId, groupId, tags) {
    // docs: https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/#update-ticket
    const ticket = this.#compact({
      subject,
      status: this.#resolveChoice(status, STATUS_MAP),
      priority: this.#resolveChoice(priority, PRIORITY_MAP),
      type: this.#resolveChoice(type, TICKET_TYPE_MAP),
      assignee_id: this.#toNumber(assigneeId),
      group_id: this.#toNumber(groupId),
      tags: this.#toList(tags),
    })

    const response = await this.#apiRequest({
      url: `${ this.baseUrl }/tickets/${ ticketId }.json`,
      method: 'put',
      body: { ticket },
      logTag: 'updateTicket',
    })

    return response.ticket
  }

  /**
   * @operationName Add Comment To Ticket
   * @category Tickets
   * @description Adds a comment (public reply or private internal note) to an existing ticket, optionally changing the ticket status in the same update. Returns the updated ticket.
   * @route PUT /add-comment-to-ticket
   * @paramDef {"type":"Number","label":"Ticket ID","name":"ticketId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The ID of the ticket to comment on."}
   * @paramDef {"type":"String","label":"Comment Body","name":"commentBody","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Plain-text body of the comment."}
   * @paramDef {"type":"String","label":"Comment HTML Body","name":"htmlBody","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional HTML version of the comment. Takes precedence over the plain-text body in the agent interface."}
   * @paramDef {"type":"Boolean","label":"Public Comment","name":"publicComment","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"Whether the comment is visible to the requester (true) or an internal note visible to agents only (false). Defaults to true."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["New","Open","Pending","Hold","Solved"]}},"description":"Optionally set a new ticket status along with the comment (e.g. Solved when replying with a resolution)."}
   * @returns {Object}
   * @sampleResult {"id":35436,"subject":"Printer on fire","status":"open","priority":"urgent","updated_at":"2026-07-13T12:30:00Z"}
   */
  async addCommentToTicket(ticketId, commentBody, htmlBody, publicComment, status) {
    // docs: https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/#update-ticket
    const ticket = this.#compact({
      comment: this.#compact({
        body: commentBody,
        html_body: htmlBody,
        public: publicComment === undefined ? true : Boolean(publicComment),
      }),
      status: this.#resolveChoice(status, STATUS_MAP),
    })

    const response = await this.#apiRequest({
      url: `${ this.baseUrl }/tickets/${ ticketId }.json`,
      method: 'put',
      body: { ticket },
      logTag: 'addCommentToTicket',
    })

    return response.ticket
  }

  /**
   * @operationName Delete Ticket
   * @category Tickets
   * @description Deletes a ticket by ID, moving it to the account's deleted tickets (recoverable for 30 days by an admin). Requires admin permission or an agent with delete rights.
   * @route DELETE /delete-ticket
   * @paramDef {"type":"Number","label":"Ticket ID","name":"ticketId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The ID of the ticket to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"ticketId":35436}
   */
  async deleteTicket(ticketId) {
    // docs: https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/#delete-ticket
    await this.#apiRequest({
      url: `${ this.baseUrl }/tickets/${ ticketId }.json`,
      method: 'delete',
      logTag: 'deleteTicket',
    })

    return { deleted: true, ticketId: this.#toNumber(ticketId) }
  }

  /**
   * @operationName Search Tickets
   * @category Tickets
   * @description Searches tickets using the Zendesk search syntax. "type:ticket" is added automatically so results are always tickets. Combine keywords and filters like "status:open", "priority>=high", "assignee:jane@example.com", "tags:vip", "created>2026-01-01", e.g. "printer status:open priority:urgent". Returns up to 100 results per page.
   * @route GET /search-tickets
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Zendesk search query. Filters: status:open|pending|solved, priority:low..urgent (supports > >= < <=), type is forced to ticket, requester:/assignee: (email or name), group:, organization:, tags:, subject:, created>/updated> with YYYY-MM-DD dates, plus free-text keywords."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Created At","Updated At","Priority","Status","Ticket Type"]}},"description":"Field to sort results by. When omitted, results are sorted by relevance."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","defaultValue":"Descending","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Direction to sort in."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page, 1-100. Defaults to 100."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to fetch, starting at 1. Search returns at most 1000 results overall."}
   * @returns {Object}
   * @sampleResult {"results":[{"id":35436,"subject":"Printer on fire","status":"open","priority":"urgent","result_type":"ticket","created_at":"2026-07-13T09:30:00Z"}],"count":42,"nextPage":"2"}
   */
  async searchTickets(query, sortBy, sortOrder, perPage, page) {
    // docs: https://developer.zendesk.com/api-reference/ticketing/ticket-management/search/
    const fullQuery = /\btype:ticket\b/.test(query) ? query : `type:ticket ${ query }`

    const response = await this.#apiRequest({
      url: `${ this.baseUrl }/search.json`,
      query: this.#compact({
        query: fullQuery,
        sort_by: this.#resolveChoice(sortBy, SEARCH_SORT_MAP),
        sort_order: this.#resolveChoice(sortOrder, SORT_ORDER_MAP),
        per_page: this.#toNumber(perPage) || 100,
        page: this.#toNumber(page),
      }),
      logTag: 'searchTickets',
    })

    return {
      results: response.results || [],
      count: response.count,
      nextPage: this.#nextPageCursor(response) || null,
    }
  }

  /**
   * @operationName List Ticket Comments
   * @category Tickets
   * @description Lists all comments on a ticket in chronological order, including each comment's author, plain-text and HTML bodies, public/private flag, and attachments.
   * @route GET /list-ticket-comments
   * @paramDef {"type":"Number","label":"Ticket ID","name":"ticketId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The ID of the ticket whose comments to list."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Comments per page, 1-100. Defaults to 100."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to fetch, starting at 1."}
   * @returns {Object}
   * @sampleResult {"comments":[{"id":1274,"type":"Comment","author_id":235323,"body":"Thanks for reaching out, we are on it.","public":true,"attachments":[],"created_at":"2026-07-13T10:00:00Z"}],"count":3,"nextPage":null}
   */
  async listTicketComments(ticketId, perPage, page) {
    // docs: https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_comments/#list-comments
    const response = await this.#apiRequest({
      url: `${ this.baseUrl }/tickets/${ ticketId }/comments.json`,
      query: this.#compact({
        per_page: this.#toNumber(perPage) || 100,
        page: this.#toNumber(page),
      }),
      logTag: 'listTicketComments',
    })

    return {
      comments: response.comments || [],
      count: response.count,
      nextPage: this.#nextPageCursor(response) || null,
    }
  }

  // ==========================================================================
  //  USERS
  // ==========================================================================
  /**
   * @operationName Create User
   * @category Users
   * @description Creates a new Zendesk user (end user, agent, or admin) with an optional phone number and organization. Fails with a duplicate error if a user with the same email already exists.
   * @route POST /create-user
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The user's full name."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"The user's primary email address. Must be unique in the Zendesk account."}
   * @paramDef {"type":"String","label":"Role","name":"role","defaultValue":"End User","uiComponent":{"type":"DROPDOWN","options":{"values":["End User","Agent","Admin"]}},"description":"The user's role. Creating agents or admins consumes a paid seat."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"The user's phone number in E.164 format, e.g. +14155550100."}
   * @paramDef {"type":"Number","label":"Organization ID","name":"organizationId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the organization to add the user to."}
   * @returns {Object}
   * @sampleResult {"id":20978392,"url":"https://yourcompany.zendesk.com/api/v2/users/20978392.json","name":"Jane Doe","email":"jane@example.com","role":"end-user","phone":"+14155550100","organization_id":57542,"created_at":"2026-07-13T09:00:00Z"}
   */
  async createUser(name, email, role, phone, organizationId) {
    // docs: https://developer.zendesk.com/api-reference/ticketing/users/users/#create-user
    const user = this.#compact({
      name,
      email,
      role: this.#resolveChoice(role, USER_ROLE_MAP),
      phone,
      organization_id: this.#toNumber(organizationId),
    })

    const response = await this.#apiRequest({
      url: `${ this.baseUrl }/users.json`,
      method: 'post',
      body: { user },
      logTag: 'createUser',
    })

    return response.user
  }

  /**
   * @operationName Get User
   * @category Users
   * @description Retrieves a single Zendesk user by ID, including name, email, role, phone, organization, and tags.
   * @route GET /get-user
   * @paramDef {"type":"Number","label":"User ID","name":"userId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The ID of the user to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":20978392,"name":"Jane Doe","email":"jane@example.com","role":"end-user","phone":"+14155550100","organization_id":57542,"active":true,"created_at":"2026-07-13T09:00:00Z","updated_at":"2026-07-13T09:00:00Z"}
   */
  async getUser(userId) {
    // docs: https://developer.zendesk.com/api-reference/ticketing/users/users/#show-user
    const response = await this.#apiRequest({
      url: `${ this.baseUrl }/users/${ userId }.json`,
      logTag: 'getUser',
    })

    return response.user
  }

  /**
   * @operationName Search Users
   * @category Users
   * @description Searches users by name, email, phone, or other identity. Also supports Zendesk search filters like "role:agent" or "organization:57542" combined with keywords. Returns up to 100 users per page.
   * @route GET /search-users
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Search text — a name, email address, or phone number. Also accepts filters such as role:end-user|agent|admin and organization:<id>."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Users per page, 1-100. Defaults to 100."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to fetch, starting at 1."}
   * @returns {Object}
   * @sampleResult {"users":[{"id":20978392,"name":"Jane Doe","email":"jane@example.com","role":"end-user","organization_id":57542}],"count":1,"nextPage":null}
   */
  async searchUsers(query, perPage, page) {
    // docs: https://developer.zendesk.com/api-reference/ticketing/users/users/#search-users
    const response = await this.#apiRequest({
      url: `${ this.baseUrl }/users/search.json`,
      query: this.#compact({
        query,
        per_page: this.#toNumber(perPage) || 100,
        page: this.#toNumber(page),
      }),
      logTag: 'searchUsers',
    })

    return {
      users: response.users || [],
      count: response.count,
      nextPage: this.#nextPageCursor(response) || null,
    }
  }

  /**
   * @operationName Update User
   * @category Users
   * @description Updates an existing user's name, email, role, phone, or organization. Only the fields you provide are changed. Note that a new email is added as a secondary, unverified identity. Returns the updated user.
   * @route PUT /update-user
   * @paramDef {"type":"Number","label":"User ID","name":"userId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The ID of the user to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New full name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New email address. Added as a secondary, unverified identity rather than replacing the primary one."}
   * @paramDef {"type":"String","label":"Role","name":"role","uiComponent":{"type":"DROPDOWN","options":{"values":["End User","Agent","Admin"]}},"description":"New role. Promoting to agent or admin consumes a paid seat."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"New phone number in E.164 format."}
   * @paramDef {"type":"Number","label":"Organization ID","name":"organizationId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the organization to move the user to."}
   * @returns {Object}
   * @sampleResult {"id":20978392,"name":"Jane Smith","email":"jane@example.com","role":"end-user","phone":"+14155550100","organization_id":57542,"updated_at":"2026-07-13T11:00:00Z"}
   */
  async updateUser(userId, name, email, role, phone, organizationId) {
    // docs: https://developer.zendesk.com/api-reference/ticketing/users/users/#update-user
    const user = this.#compact({
      name,
      email,
      role: this.#resolveChoice(role, USER_ROLE_MAP),
      phone,
      organization_id: this.#toNumber(organizationId),
    })

    const response = await this.#apiRequest({
      url: `${ this.baseUrl }/users/${ userId }.json`,
      method: 'put',
      body: { user },
      logTag: 'updateUser',
    })

    return response.user
  }

  /**
   * @operationName List Agents
   * @category Users
   * @description Lists the agents in the Zendesk account (users with the agent role) with page-based pagination. Useful for finding assignee IDs.
   * @route GET /list-agents
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Agents per page, 1-100. Defaults to 100."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to fetch, starting at 1."}
   * @returns {Object}
   * @sampleResult {"users":[{"id":235323,"name":"Alex Agent","email":"alex@yourcompany.com","role":"agent","active":true}],"count":5,"nextPage":null}
   */
  async listAgents(perPage, page) {
    // docs: https://developer.zendesk.com/api-reference/ticketing/users/users/#list-users
    const response = await this.#apiRequest({
      url: `${ this.baseUrl }/users.json`,
      query: this.#compact({
        role: 'agent',
        per_page: this.#toNumber(perPage) || 100,
        page: this.#toNumber(page),
      }),
      logTag: 'listAgents',
    })

    return {
      users: response.users || [],
      count: response.count,
      nextPage: this.#nextPageCursor(response) || null,
    }
  }

  // ==========================================================================
  //  ORGANIZATIONS
  // ==========================================================================
  /**
   * @operationName Create Organization
   * @category Organizations
   * @description Creates a new Zendesk organization. Users whose email domain matches one of the organization's domain names are automatically added to it.
   * @route POST /create-organization
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The organization name. Must be unique in the Zendesk account."}
   * @paramDef {"type":"Array<String>","label":"Domain Names","name":"domainNames","description":"Email domains associated with the organization, e.g. [\"example.com\"]. New users with matching email domains are added automatically."}
   * @paramDef {"type":"String","label":"Details","name":"details","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Details about the organization, such as its address."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Internal notes about the organization."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags to set on the organization."}
   * @returns {Object}
   * @sampleResult {"id":57542,"url":"https://yourcompany.zendesk.com/api/v2/organizations/57542.json","name":"Acme Inc","domain_names":["acme.com"],"details":"123 Main St","notes":"Enterprise customer","tags":["enterprise"],"created_at":"2026-07-13T09:00:00Z"}
   */
  async createOrganization(name, domainNames, details, notes, tags) {
    // docs: https://developer.zendesk.com/api-reference/ticketing/organizations/organizations/#create-organization
    const organization = this.#compact({
      name,
      domain_names: this.#toList(domainNames),
      details,
      notes,
      tags: this.#toList(tags),
    })

    const response = await this.#apiRequest({
      url: `${ this.baseUrl }/organizations.json`,
      method: 'post',
      body: { organization },
      logTag: 'createOrganization',
    })

    return response.organization
  }

  /**
   * @operationName List Organizations
   * @category Organizations
   * @description Lists the organizations in the Zendesk account with page-based pagination (up to 100 per page).
   * @route GET /list-organizations
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Organizations per page, 1-100. Defaults to 100."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to fetch, starting at 1."}
   * @returns {Object}
   * @sampleResult {"organizations":[{"id":57542,"name":"Acme Inc","domain_names":["acme.com"],"tags":["enterprise"],"created_at":"2026-07-13T09:00:00Z"}],"count":12,"nextPage":null}
   */
  async listOrganizations(perPage, page) {
    // docs: https://developer.zendesk.com/api-reference/ticketing/organizations/organizations/#list-organizations
    const response = await this.#apiRequest({
      url: `${ this.baseUrl }/organizations.json`,
      query: this.#compact({
        per_page: this.#toNumber(perPage) || 100,
        page: this.#toNumber(page),
      }),
      logTag: 'listOrganizations',
    })

    return {
      organizations: response.organizations || [],
      count: response.count,
      nextPage: this.#nextPageCursor(response) || null,
    }
  }

  /**
   * @operationName Get Organization
   * @category Organizations
   * @description Retrieves a single Zendesk organization by ID, including its name, domain names, details, notes, and tags.
   * @route GET /get-organization
   * @paramDef {"type":"Number","label":"Organization ID","name":"organizationId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The ID of the organization to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":57542,"name":"Acme Inc","domain_names":["acme.com"],"details":"123 Main St","notes":"Enterprise customer","tags":["enterprise"],"created_at":"2026-07-13T09:00:00Z","updated_at":"2026-07-13T09:00:00Z"}
   */
  async getOrganization(organizationId) {
    // docs: https://developer.zendesk.com/api-reference/ticketing/organizations/organizations/#show-organization
    const response = await this.#apiRequest({
      url: `${ this.baseUrl }/organizations/${ organizationId }.json`,
      logTag: 'getOrganization',
    })

    return response.organization
  }

  // ==========================================================================
  //  REALTIME TRIGGER (SINGLE_APP)
  //  Zendesk needs TWO resources per subscription:
  //    1. a webhook (POST /webhooks, subscriptions: ['conditional_ticket_events'])
  //    2. a business-rule trigger (POST /triggers) whose notification_webhook
  //       action posts a JSON template with {{ticket.*}} placeholders to it.
  //  Both ids are stored in webhookData and deleted together.
  // ==========================================================================
  /**
   * @operationName On Ticket Event
   * @category Triggers
   * @description Fires when a ticket is created or updated in Zendesk. Provisions a Zendesk webhook plus a business-rule trigger that posts the ticket's ID, subject, status, priority, type, requester, assignee, and URL to FlowRunner in real time.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-ticket-event
   * @paramDef {"type":"String","label":"Event","name":"event","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Ticket Created","Ticket Updated"]}},"description":"Which ticket change fires this trigger. Ticket Updated fires on any update to an existing ticket (status change, new comment, reassignment, etc.)."}
   * @returns {Object}
   * @sampleResult {"event":"created","ticketId":"35436","subject":"Printer on fire","status":"Open","priority":"Urgent","type":"Incident","requesterEmail":"jane@example.com","requesterName":"Jane Doe","assigneeEmail":"alex@yourcompany.com","ticketUrl":"https://yourcompany.zendesk.com/agent/tickets/35436"}
   */
  onTicketEvent(callType, payload) {
    if (callType === CALL_TYPES.SHAPE_EVENT) {
      return [{ name: 'onTicketEvent', data: this.#shapeTicketEvent(payload) }]
    }

    if (callType === CALL_TYPES.FILTER_TRIGGER) {
      return {
        ids: this.#matchTriggers(payload, (trigger, event) =>
          this.#resolveChoice(trigger.data.event, TRIGGER_EVENT_TO_EVENT_KEY) === event.event),
      }
    }
  }

  // Shapes the inbound webhook body (already our JSON template) into the trigger event.
  #shapeTicketEvent(body) {
    return {
      event: body.event,
      ticketId: body.ticketId,
      subject: body.subject,
      status: body.status,
      priority: body.priority,
      type: body.type,
      requesterEmail: body.requesterEmail,
      requesterName: body.requesterName,
      assigneeEmail: body.assigneeEmail,
      ticketUrl: body.ticketUrl,
    }
  }

  #matchTriggers(payload, predicate) {
    const eventData = payload.eventData || payload.data || {}

    return (payload.triggers || [])
      .filter(trigger => predicate(trigger, eventData))
      .map(trigger => trigger.id)
  }

  // Builds the JSON body template the Zendesk trigger posts to the webhook.
  // {{ticket.*}} placeholders are rendered by Zendesk at notification time;
  // the `event` marker is fixed per subscription so inbound deliveries can be
  // routed back to the right FlowRunner trigger.
  #buildWebhookBodyTemplate(eventKey) {
    return JSON.stringify({
      event: eventKey,
      ticketId: '{{ticket.id}}',
      subject: '{{ticket.title}}',
      status: '{{ticket.status}}',
      priority: '{{ticket.priority}}',
      type: '{{ticket.ticket_type}}',
      requesterEmail: '{{ticket.requester.email}}',
      requesterName: '{{ticket.requester.name}}',
      assigneeEmail: '{{ticket.assignee.email}}',
      ticketUrl: '{{ticket.link}}',
    })
  }

  // ── SYSTEM trigger handlers (SINGLE_APP) ──────────────────────────────────
  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerUpsertWebhook
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    logger.debug(`handleTriggerUpsertWebhook.invocation: ${ JSON.stringify(invocation) }`)

    const address = `${ invocation.callbackUrl }${ invocation.callbackUrl.includes('?') ? '&' : '?' }connectionId=${ invocation.connectionId }`
    const webhooks = []

    for (const event of invocation.events || []) {
      const eventLabel = event.triggerData?.event
      const updateType = this.#resolveChoice(eventLabel, TRIGGER_EVENT_TO_UPDATE_TYPE)
      const eventKey = this.#resolveChoice(eventLabel, TRIGGER_EVENT_TO_EVENT_KEY)

      // 1) Create the webhook the business-rule trigger will notify.
      // docs: https://developer.zendesk.com/api-reference/webhooks/webhooks-api/webhooks/#create-or-clone-webhook
      const webhookResponse = await this.#apiRequest({
        url: `${ this.baseUrl }/webhooks`,
        method: 'post',
        body: {
          webhook: {
            name: `FlowRunner ${ eventLabel } (${ event.id })`,
            endpoint: address,
            http_method: 'POST',
            request_format: 'json',
            status: 'active',
            subscriptions: ['conditional_ticket_events'],
          },
        },
        logTag: 'createWebhook',
      })
      const webhookId = webhookResponse?.webhook?.id

      // 2) Create the business-rule trigger that posts the ticket template to it.
      // docs: https://developer.zendesk.com/api-reference/ticketing/business-rules/triggers/#create-trigger
      let zendeskTriggerId

      try {
        const triggerResponse = await this.#apiRequest({
          url: `${ this.baseUrl }/triggers.json`,
          method: 'post',
          body: {
            trigger: {
              title: `FlowRunner ${ eventLabel } (${ event.id })`,
              active: true,
              conditions: {
                all: [{ field: 'update_type', operator: 'is', value: updateType }],
                any: [],
              },
              actions: [
                {
                  field: 'notification_webhook',
                  value: [String(webhookId), this.#buildWebhookBodyTemplate(eventKey)],
                },
              ],
            },
          },
          logTag: 'createZendeskTrigger',
        })

        zendeskTriggerId = triggerResponse?.trigger?.id
      } catch (error) {
        // Don't strand the webhook if the trigger half of the pair failed.
        await this.#safeDelete(`${ this.baseUrl }/webhooks/${ webhookId }`, 'rollbackWebhook')

        throw error
      }

      webhooks.push({ triggerId: event.id, webhookId, zendeskTriggerId, event: eventLabel })
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

    // Zendesk performs no subscription handshake, but guard the empty-body case defensively.
    if (!invocation || !invocation.body || !invocation.body.ticketId) {
      return { handshake: true, responseToExternalService: invocation?.body || {} }
    }

    return {
      connectionId: invocation.queryParams?.connectionId,
      events: this.onTicketEvent(CALL_TYPES.SHAPE_EVENT, invocation.body),
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
      // Delete the business-rule trigger first so nothing keeps notifying the webhook.
      if (webhook.zendeskTriggerId) {
        await this.#safeDelete(`${ this.baseUrl }/triggers/${ webhook.zendeskTriggerId }.json`, 'deleteZendeskTrigger')
      }

      if (webhook.webhookId) {
        await this.#safeDelete(`${ this.baseUrl }/webhooks/${ webhook.webhookId }`, 'deleteWebhook')
      }
    }

    return { webhookData: {} }
  }

  async #safeDelete(url, logTag) {
    try {
      await this.#apiRequest({ url, method: 'delete', logTag })
    } catch (error) {
      logger.warn(`${ logTag }: cleanup failed for ${ url }: ${ error?.message }`)
    }
  }

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================
  /**
   * @registerAs DICTIONARY
   * @operationName Get Agents Dictionary
   * @description Provides a searchable list of agents and admins (valid ticket assignees) for dropdown selection in ticket actions.
   * @route POST /get-agents-dictionary
   * @paramDef {"type":"getAgentsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Alex Agent","value":"235323","note":"alex@yourcompany.com"}],"cursor":null}
   */
  async getAgentsDictionary(payload) {
    const { search, cursor } = payload || {}

    // role[] repeats, so it goes in the URL; .query would not serialize the array correctly.
    const response = await this.#apiRequest({
      url: `${ this.baseUrl }/users.json?role[]=agent&role[]=admin`,
      query: this.#compact({ per_page: 100, page: this.#toNumber(cursor) }),
      logTag: 'getAgentsDictionary',
    })

    const searchText = (search || '').toLowerCase()
    const users = (response.users || []).filter(user =>
      !searchText ||
      String(user.name || '').toLowerCase().includes(searchText) ||
      String(user.email || '').toLowerCase().includes(searchText))

    return {
      items: users.map(user => ({ label: user.name, value: String(user.id), note: user.email || user.role })),
      cursor: this.#nextPageCursor(response) || null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Groups Dictionary
   * @description Provides a searchable list of agent groups for dropdown selection in ticket actions.
   * @route POST /get-groups-dictionary
   * @paramDef {"type":"getGroupsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Support","value":"98738","note":"Group ID: 98738"}],"cursor":null}
   */
  async getGroupsDictionary(payload) {
    const { search, cursor } = payload || {}

    // docs: https://developer.zendesk.com/api-reference/ticketing/groups/groups/#list-groups
    const response = await this.#apiRequest({
      url: `${ this.baseUrl }/groups.json`,
      query: this.#compact({ per_page: 100, page: this.#toNumber(cursor) }),
      logTag: 'getGroupsDictionary',
    })

    const searchText = (search || '').toLowerCase()
    const groups = (response.groups || []).filter(group =>
      !searchText || String(group.name || '').toLowerCase().includes(searchText))

    return {
      items: groups.map(group => ({ label: group.name, value: String(group.id), note: `Group ID: ${ group.id }` })),
      cursor: this.#nextPageCursor(response) || null,
    }
  }
}

Flowrunner.ServerCode.addService(Zendesk, [
  {
    name: 'subdomain',
    displayName: 'Subdomain',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Zendesk subdomain — the "yourcompany" part of yourcompany.zendesk.com.',
  },
  {
    name: 'email',
    displayName: 'Email',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'The agent email address the API token belongs to.',
  },
  {
    name: 'apiToken',
    displayName: 'API Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Zendesk API token. Create one in Admin Center → Apps and integrations → APIs → Zendesk API.',
  },
])
