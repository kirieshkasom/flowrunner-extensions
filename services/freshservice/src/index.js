const logger = {
  info: (...args) => console.log('[Freshservice] info:', ...args),
  debug: (...args) => console.log('[Freshservice] debug:', ...args),
  error: (...args) => console.log('[Freshservice] error:', ...args),
  warn: (...args) => console.log('[Freshservice] warn:', ...args),
}

const DEFAULT_PAGE_SIZE = 30

// Ticket enums
const PRIORITY_MAP = { 'Low': 1, 'Medium': 2, 'High': 3, 'Urgent': 4 }
const TICKET_STATUS_MAP = { 'Open': 2, 'Pending': 3, 'Resolved': 4, 'Closed': 5 }
const SOURCE_MAP = { 'Email': 1, 'Portal': 2, 'Phone': 3, 'Chat': 4, 'Feedback Widget': 5, 'Yammer': 6, 'AWS Cloudwatch': 7, 'Pagerduty': 8, 'Walkup': 9, 'Slack': 10 }
const URGENCY_MAP = { 'Low': 1, 'Medium': 2, 'High': 3 }
const IMPACT_MAP = { 'Low': 1, 'Medium': 2, 'High': 3 }

// Change enums
const CHANGE_STATUS_MAP = { 'Open': 1, 'Planning': 2, 'Awaiting Approval': 3, 'Pending Release': 4, 'Pending Review': 5, 'Closed': 6 }
const CHANGE_TYPE_MAP = { 'Minor': 1, 'Standard': 2, 'Major': 3, 'Emergency': 4 }
const RISK_MAP = { 'Low': 1, 'Medium': 2, 'High': 3, 'Very High': 4 }

// Problem enums
const PROBLEM_STATUS_MAP = { 'Open': 1, 'Change Requested': 2, 'Closed': 3 }

// Release enums
const RELEASE_STATUS_MAP = { 'Open': 1, 'On Hold': 2, 'In Progress': 3, 'Incomplete': 4, 'Completed': 5 }
const RELEASE_TYPE_MAP = { 'Minor': 1, 'Standard': 2, 'Major': 3, 'Emergency': 4 }

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
 * @integrationName Freshservice
 * @integrationIcon /icon.png
 */
class FreshserviceService {
  constructor(config) {
    this.domain = String(config.domain || '')
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\.freshservice\.com.*$/i, '')
      .replace(/\/.*$/, '')

    this.apiKey = config.apiKey
  }

  get #baseUrl() {
    return `https://${ this.domain }.freshservice.com/api/v2`
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
          .map(item => {
            const base = item.field ? `${ item.field }: ${ item.message }` : item.message

            return item.code ? `${ base } [${ item.code }]` : base
          })
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

      throw new Error(`Freshservice API error: ${ message }`)
    }
  }

  // ==================== Tickets ====================

  /**
   * @operationName Create Ticket
   * @category Tickets
   * @description Creates a new service desk ticket (incident/service request) in Freshservice. Provide either the requester Email or an existing Requester ID. The description supports HTML markup. Priority, status, source, urgency, and impact accept friendly labels; group and agent can be selected from your account. Account-specific fields can be set via Custom Fields (keys must match the field names configured in your account, e.g. cf_order_id).
   * @route POST /create-ticket
   *
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Subject line of the ticket."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Body of the ticket. HTML markup is supported."}
   * @paramDef {"type":"String","label":"Requester Email","name":"email","description":"Email address of the requester. If no requester exists with this email, a new one is created automatically. Required unless Requester ID is provided."}
   * @paramDef {"type":"Number","label":"Requester ID","name":"requesterId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of an existing requester. Required unless Requester Email is provided."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","defaultValue":"Low","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Medium","High","Urgent"]}},"description":"Ticket priority. Defaults to Low."}
   * @paramDef {"type":"String","label":"Status","name":"status","defaultValue":"Open","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Pending","Resolved","Closed"]}},"description":"Ticket status. Defaults to Open."}
   * @paramDef {"type":"String","label":"Source","name":"source","defaultValue":"Portal","uiComponent":{"type":"DROPDOWN","options":{"values":["Email","Portal","Phone","Chat","Feedback Widget","Yammer","AWS Cloudwatch","Pagerduty","Walkup","Slack"]}},"description":"Channel through which the ticket was created. Defaults to Portal."}
   * @paramDef {"type":"String","label":"Urgency","name":"urgency","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Medium","High"]}},"description":"Urgency of the ticket."}
   * @paramDef {"type":"String","label":"Impact","name":"impact","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Medium","High"]}},"description":"Impact of the ticket."}
   * @paramDef {"type":"String","label":"Group","name":"groupId","dictionary":"getGroupsDictionary","description":"Group to assign the ticket to. Select from your groups or enter a group ID."}
   * @paramDef {"type":"String","label":"Agent","name":"responderId","dictionary":"getAgentsDictionary","description":"Agent to assign the ticket to. Select from your agents or enter an agent ID."}
   * @paramDef {"type":"String","label":"Category","name":"category","description":"Ticket category. Must match a category configured in your account."}
   * @paramDef {"type":"Number","label":"Department ID","name":"departmentId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the department the requester belongs to."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags to associate with the ticket."}
   * @paramDef {"type":"Array<String>","label":"CC Emails","name":"ccEmails","description":"Email addresses added to the CC field of the ticket."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Key/value pairs of custom ticket fields, e.g. {\"cf_order_id\":\"12345\"}."}
   *
   * @returns {Object}
   * @sampleResult {"id":42,"subject":"Laptop not booting","description_text":"My laptop won't turn on","status":2,"priority":1,"source":2,"requester_id":2043000123456,"responder_id":null,"group_id":null,"department_id":null,"category":"Hardware","tags":["hardware"],"cc_emails":[],"custom_fields":{},"created_at":"2026-07-14T10:00:00Z","updated_at":"2026-07-14T10:00:00Z"}
   */
  async createTicket(subject, description, email, requesterId, priority, status, source, urgency, impact, groupId, responderId, category, departmentId, tags, ccEmails, customFields) {
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
        status: this.#resolveChoice(status, TICKET_STATUS_MAP) ?? 2,
        source: this.#resolveChoice(source, SOURCE_MAP) ?? 2,
        urgency: this.#resolveChoice(urgency, URGENCY_MAP),
        impact: this.#resolveChoice(impact, IMPACT_MAP),
        group_id: groupId ? Number(groupId) : undefined,
        responder_id: responderId ? Number(responderId) : undefined,
        category,
        department_id: departmentId,
        tags,
        cc_emails: ccEmails,
        custom_fields: customFields,
      }),
    })
  }

  /**
   * @operationName Get Ticket
   * @category Tickets
   * @description Retrieves a single ticket by its ID, including subject, description, status, priority, requester, assignment, tags, and custom fields. Optionally embeds the ticket's conversations, requester, and stats in the response.
   * @route GET /get-ticket
   *
   * @paramDef {"type":"Number","label":"Ticket ID","name":"ticketId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the ticket to retrieve."}
   * @paramDef {"type":"Boolean","label":"Include Conversations","name":"includeConversations","uiComponent":{"type":"TOGGLE"},"description":"When enabled, embeds the ticket's conversations in the response. Use List Conversations for full pagination."}
   *
   * @returns {Object}
   * @sampleResult {"id":42,"subject":"Laptop not booting","description_text":"My laptop won't turn on","status":2,"priority":1,"source":2,"requester_id":2043000123456,"responder_id":2043000654321,"group_id":2043000112233,"category":"Hardware","tags":["hardware"],"custom_fields":{},"created_at":"2026-07-14T10:00:00Z","updated_at":"2026-07-14T11:00:00Z"}
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
   * @description Lists tickets in the Freshservice account with pagination. Supports predefined filters (New & My Open, Watching, Spam, Deleted), an updated-since timestamp filter, and sorting. Note: without the Updated Since filter, only tickets created in the past 30 days are returned.
   * @route GET /list-tickets
   *
   * @paramDef {"type":"String","label":"Filter","name":"filter","uiComponent":{"type":"DROPDOWN","options":{"values":["New & My Open","Watching","Spam","Deleted"]}},"description":"Predefined view to filter tickets by. Leave empty to list all accessible tickets."}
   * @paramDef {"type":"String","label":"Updated Since","name":"updatedSince","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return tickets updated at or after this time (ISO 8601, e.g. 2026-07-01T00:00:00Z). Also lifts the default 30-day creation window."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Created At","Due By","Updated At"]}},"description":"Field to sort by. Defaults to Created At."}
   * @paramDef {"type":"String","label":"Order Type","name":"orderType","uiComponent":{"type":"DROPDOWN","options":{"values":["Descending","Ascending"]}},"description":"Sort direction. Defaults to Descending."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of tickets per page (max 100). Defaults to 30."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":42,"subject":"Laptop not booting","status":2,"priority":1,"source":2,"requester_id":2043000123456,"responder_id":null,"group_id":null,"tags":["hardware"],"created_at":"2026-07-14T10:00:00Z","updated_at":"2026-07-14T11:00:00Z"}]
   */
  async listTickets(filter, updatedSince, orderBy, orderType, page, perPage) {
    const logTag = '[listTickets]'

    return await this.#apiRequest({
      logTag,
      path: '/tickets',
      method: 'get',
      query: {
        filter: this.#resolveChoice(filter, { 'New & My Open': 'new_and_my_open', 'Watching': 'watching', 'Spam': 'spam', 'Deleted': 'deleted' }),
        updated_since: updatedSince,
        order_by: this.#resolveChoice(orderBy, { 'Created At': 'created_at', 'Due By': 'due_by', 'Updated At': 'updated_at' }),
        order_type: this.#resolveChoice(orderType, { 'Descending': 'desc', 'Ascending': 'asc' }),
        page: page || 1,
        per_page: perPage || DEFAULT_PAGE_SIZE,
      },
    })
  }

  /**
   * @operationName Update Ticket
   * @category Tickets
   * @description Updates an existing ticket. Only the provided fields are changed; all other fields keep their current values. Priority, status, urgency, and impact accept friendly labels, and group/agent assignment can be selected from your account.
   * @route PUT /update-ticket
   *
   * @paramDef {"type":"Number","label":"Ticket ID","name":"ticketId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the ticket to update."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"New subject line for the ticket."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New body for the ticket. HTML markup is supported."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Medium","High","Urgent"]}},"description":"New ticket priority. Leave empty to keep the current priority."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Pending","Resolved","Closed"]}},"description":"New ticket status. Leave empty to keep the current status."}
   * @paramDef {"type":"String","label":"Urgency","name":"urgency","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Medium","High"]}},"description":"New urgency. Leave empty to keep the current urgency."}
   * @paramDef {"type":"String","label":"Impact","name":"impact","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Medium","High"]}},"description":"New impact. Leave empty to keep the current impact."}
   * @paramDef {"type":"String","label":"Group","name":"groupId","dictionary":"getGroupsDictionary","description":"Group to assign the ticket to. Select from your groups or enter a group ID."}
   * @paramDef {"type":"String","label":"Agent","name":"responderId","dictionary":"getAgentsDictionary","description":"Agent to assign the ticket to. Select from your agents or enter an agent ID."}
   * @paramDef {"type":"String","label":"Category","name":"category","description":"New ticket category. Must match a category configured in your account."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags for the ticket. Replaces the existing tags when provided."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Key/value pairs of custom ticket fields to update, e.g. {\"cf_order_id\":\"12345\"}."}
   *
   * @returns {Object}
   * @sampleResult {"id":42,"subject":"Laptop not booting","status":4,"priority":2,"source":2,"requester_id":2043000123456,"responder_id":2043000654321,"group_id":2043000112233,"category":"Hardware","tags":["hardware","resolved"],"custom_fields":{},"created_at":"2026-07-14T10:00:00Z","updated_at":"2026-07-14T12:00:00Z"}
   */
  async updateTicket(ticketId, subject, description, priority, status, urgency, impact, groupId, responderId, category, tags, customFields) {
    const logTag = '[updateTicket]'

    return await this.#apiRequest({
      logTag,
      path: `/tickets/${ ticketId }`,
      method: 'put',
      body: clean({
        subject,
        description,
        priority: this.#resolveChoice(priority, PRIORITY_MAP),
        status: this.#resolveChoice(status, TICKET_STATUS_MAP),
        urgency: this.#resolveChoice(urgency, URGENCY_MAP),
        impact: this.#resolveChoice(impact, IMPACT_MAP),
        group_id: groupId ? Number(groupId) : undefined,
        responder_id: responderId ? Number(responderId) : undefined,
        category,
        tags,
        custom_fields: customFields,
      }),
    })
  }

  /**
   * @operationName Delete Ticket
   * @category Tickets
   * @description Deletes a ticket by its ID. The ticket is moved to the trash (Deleted view) and can be restored with Restore Ticket.
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
   * @operationName Restore Ticket
   * @category Tickets
   * @description Restores a previously deleted ticket by its ID, moving it out of the trash and back into active tickets.
   * @route PUT /restore-ticket
   *
   * @paramDef {"type":"Number","label":"Ticket ID","name":"ticketId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the ticket to restore."}
   *
   * @returns {Object}
   * @sampleResult {"restored":true,"ticketId":42}
   */
  async restoreTicket(ticketId) {
    const logTag = '[restoreTicket]'

    await this.#apiRequest({
      logTag,
      path: `/tickets/${ ticketId }/restore`,
      method: 'put',
    })

    return { restored: true, ticketId }
  }

  /**
   * @operationName Reply to Ticket
   * @category Tickets
   * @description Adds a public reply to a ticket. The reply is sent to the requester by email and appears in the ticket's conversation thread. The body supports HTML markup.
   * @route POST /reply-to-ticket
   *
   * @paramDef {"type":"Number","label":"Ticket ID","name":"ticketId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the ticket to reply to."}
   * @paramDef {"type":"String","label":"Body","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Content of the reply. HTML markup is supported."}
   * @paramDef {"type":"Array<String>","label":"CC Emails","name":"ccEmails","description":"Email addresses added to the CC field of the outgoing reply email."}
   * @paramDef {"type":"Array<String>","label":"BCC Emails","name":"bccEmails","description":"Email addresses added to the BCC field of the outgoing reply email."}
   *
   * @returns {Object}
   * @sampleResult {"id":2043001234567,"ticket_id":42,"body_text":"We have replaced the power supply.","user_id":2043000654321,"cc_emails":[],"bcc_emails":[],"from_email":"support@yourcompany.freshservice.com","created_at":"2026-07-14T12:00:00Z","updated_at":"2026-07-14T12:00:00Z"}
   */
  async replyToTicket(ticketId, body, ccEmails, bccEmails) {
    const logTag = '[replyToTicket]'

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
   * @sampleResult {"id":2043001234568,"ticket_id":42,"body_text":"Verified device serial with user.","private":true,"incoming":false,"user_id":2043000654321,"created_at":"2026-07-14T12:05:00Z","updated_at":"2026-07-14T12:05:00Z"}
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

  // ==================== Conversations ====================

  /**
   * @operationName List Conversations
   * @category Conversations
   * @description Lists all conversations (replies and notes) of a ticket in chronological order, with pagination. Each entry indicates whether it is private, incoming, and which user created it.
   * @route GET /list-conversations
   *
   * @paramDef {"type":"Number","label":"Ticket ID","name":"ticketId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the ticket whose conversations to list."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of conversations per page (max 100). Defaults to 30."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":2043001234567,"ticket_id":42,"body_text":"We have replaced the power supply.","private":false,"incoming":false,"user_id":2043000654321,"from_email":"support@yourcompany.freshservice.com","created_at":"2026-07-14T12:00:00Z"}]
   */
  async listConversations(ticketId, page, perPage) {
    const logTag = '[listConversations]'

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

  // ==================== Changes ====================

  /**
   * @operationName Create Change
   * @category Changes
   * @description Creates a new change request in Freshservice, used to plan and track modifications to IT infrastructure or services. Priority, status, change type, risk, and impact accept friendly labels. Planned start/end dates should be ISO 8601 timestamps.
   * @route POST /create-change
   *
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Subject line of the change."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Detailed description of the change. HTML markup is supported."}
   * @paramDef {"type":"Number","label":"Requester ID","name":"requesterId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the requester who raised the change."}
   * @paramDef {"type":"String","label":"Agent","name":"agentId","dictionary":"getAgentsDictionary","description":"Agent responsible for the change. Select from your agents or enter an agent ID."}
   * @paramDef {"type":"String","label":"Group","name":"groupId","dictionary":"getGroupsDictionary","description":"Group assigned to the change. Select from your groups or enter a group ID."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","defaultValue":"Low","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Medium","High","Urgent"]}},"description":"Change priority. Defaults to Low."}
   * @paramDef {"type":"String","label":"Status","name":"status","defaultValue":"Open","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Planning","Awaiting Approval","Pending Release","Pending Review","Closed"]}},"description":"Change status. Defaults to Open."}
   * @paramDef {"type":"String","label":"Change Type","name":"changeType","uiComponent":{"type":"DROPDOWN","options":{"values":["Minor","Standard","Major","Emergency"]}},"description":"Type of change."}
   * @paramDef {"type":"String","label":"Risk","name":"risk","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Medium","High","Very High"]}},"description":"Risk level of the change."}
   * @paramDef {"type":"String","label":"Impact","name":"impact","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Medium","High"]}},"description":"Impact of the change."}
   * @paramDef {"type":"String","label":"Planned Start Date","name":"plannedStartDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Planned start of the change (ISO 8601, e.g. 2026-07-20T09:00:00Z)."}
   * @paramDef {"type":"String","label":"Planned End Date","name":"plannedEndDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Planned end of the change (ISO 8601)."}
   * @paramDef {"type":"String","label":"Category","name":"category","description":"Change category. Must match a category configured in your account."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Key/value pairs of custom change fields."}
   *
   * @returns {Object}
   * @sampleResult {"id":15,"subject":"Upgrade database cluster","status":1,"priority":1,"change_type":2,"risk":1,"impact":1,"planned_start_date":"2026-07-20T09:00:00Z","planned_end_date":"2026-07-20T12:00:00Z","group_id":null,"agent_id":null,"custom_fields":{},"created_at":"2026-07-14T10:00:00Z","updated_at":"2026-07-14T10:00:00Z"}
   */
  async createChange(subject, description, requesterId, agentId, groupId, priority, status, changeType, risk, impact, plannedStartDate, plannedEndDate, category, customFields) {
    const logTag = '[createChange]'

    return await this.#apiRequest({
      logTag,
      path: '/changes',
      method: 'post',
      body: clean({
        subject,
        description,
        requester_id: requesterId,
        agent_id: agentId ? Number(agentId) : undefined,
        group_id: groupId ? Number(groupId) : undefined,
        priority: this.#resolveChoice(priority, PRIORITY_MAP) ?? 1,
        status: this.#resolveChoice(status, CHANGE_STATUS_MAP) ?? 1,
        change_type: this.#resolveChoice(changeType, CHANGE_TYPE_MAP),
        risk: this.#resolveChoice(risk, RISK_MAP),
        impact: this.#resolveChoice(impact, IMPACT_MAP),
        planned_start_date: plannedStartDate,
        planned_end_date: plannedEndDate,
        category,
        custom_fields: customFields,
      }),
    })
  }

  /**
   * @operationName Get Change
   * @category Changes
   * @description Retrieves a single change request by its ID, including subject, description, status, priority, risk, impact, planned schedule, and assignment.
   * @route GET /get-change
   *
   * @paramDef {"type":"Number","label":"Change ID","name":"changeId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the change to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":15,"subject":"Upgrade database cluster","status":1,"priority":1,"change_type":2,"risk":1,"impact":1,"group_id":2043000112233,"agent_id":2043000654321,"planned_start_date":"2026-07-20T09:00:00Z","planned_end_date":"2026-07-20T12:00:00Z","custom_fields":{},"created_at":"2026-07-14T10:00:00Z","updated_at":"2026-07-14T11:00:00Z"}
   */
  async getChange(changeId) {
    const logTag = '[getChange]'

    return await this.#apiRequest({
      logTag,
      path: `/changes/${ changeId }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Changes
   * @category Changes
   * @description Lists change requests in the Freshservice account with pagination.
   * @route GET /list-changes
   *
   * @paramDef {"type":"String","label":"Updated Since","name":"updatedSince","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return changes updated at or after this time (ISO 8601)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of changes per page (max 100). Defaults to 30."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":15,"subject":"Upgrade database cluster","status":1,"priority":1,"change_type":2,"risk":1,"impact":1,"created_at":"2026-07-14T10:00:00Z","updated_at":"2026-07-14T11:00:00Z"}]
   */
  async listChanges(updatedSince, page, perPage) {
    const logTag = '[listChanges]'

    return await this.#apiRequest({
      logTag,
      path: '/changes',
      method: 'get',
      query: {
        updated_since: updatedSince,
        page: page || 1,
        per_page: perPage || DEFAULT_PAGE_SIZE,
      },
    })
  }

  /**
   * @operationName Update Change
   * @category Changes
   * @description Updates an existing change request. Only the provided fields are changed; all other fields keep their current values. Priority, status, change type, risk, and impact accept friendly labels.
   * @route PUT /update-change
   *
   * @paramDef {"type":"Number","label":"Change ID","name":"changeId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the change to update."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"New subject line for the change."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description for the change. HTML markup is supported."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Medium","High","Urgent"]}},"description":"New priority. Leave empty to keep the current priority."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Planning","Awaiting Approval","Pending Release","Pending Review","Closed"]}},"description":"New status. Leave empty to keep the current status."}
   * @paramDef {"type":"String","label":"Risk","name":"risk","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Medium","High","Very High"]}},"description":"New risk level. Leave empty to keep the current risk."}
   * @paramDef {"type":"String","label":"Impact","name":"impact","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Medium","High"]}},"description":"New impact. Leave empty to keep the current impact."}
   * @paramDef {"type":"String","label":"Agent","name":"agentId","dictionary":"getAgentsDictionary","description":"Agent responsible for the change. Select from your agents or enter an agent ID."}
   * @paramDef {"type":"String","label":"Group","name":"groupId","dictionary":"getGroupsDictionary","description":"Group assigned to the change. Select from your groups or enter a group ID."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Key/value pairs of custom change fields to update."}
   *
   * @returns {Object}
   * @sampleResult {"id":15,"subject":"Upgrade database cluster","status":4,"priority":2,"change_type":2,"risk":1,"impact":1,"group_id":2043000112233,"agent_id":2043000654321,"custom_fields":{},"created_at":"2026-07-14T10:00:00Z","updated_at":"2026-07-14T12:00:00Z"}
   */
  async updateChange(changeId, subject, description, priority, status, risk, impact, agentId, groupId, customFields) {
    const logTag = '[updateChange]'

    return await this.#apiRequest({
      logTag,
      path: `/changes/${ changeId }`,
      method: 'put',
      body: clean({
        subject,
        description,
        priority: this.#resolveChoice(priority, PRIORITY_MAP),
        status: this.#resolveChoice(status, CHANGE_STATUS_MAP),
        risk: this.#resolveChoice(risk, RISK_MAP),
        impact: this.#resolveChoice(impact, IMPACT_MAP),
        agent_id: agentId ? Number(agentId) : undefined,
        group_id: groupId ? Number(groupId) : undefined,
        custom_fields: customFields,
      }),
    })
  }

  /**
   * @operationName Delete Change
   * @category Changes
   * @description Deletes a change request by its ID.
   * @route DELETE /delete-change
   *
   * @paramDef {"type":"Number","label":"Change ID","name":"changeId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the change to delete."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"changeId":15}
   */
  async deleteChange(changeId) {
    const logTag = '[deleteChange]'

    await this.#apiRequest({
      logTag,
      path: `/changes/${ changeId }`,
      method: 'delete',
    })

    return { deleted: true, changeId }
  }

  // ==================== Problems ====================

  /**
   * @operationName Create Problem
   * @category Problems
   * @description Creates a new problem record in Freshservice, used to investigate and resolve the root cause of one or more incidents. Priority, status, and impact accept friendly labels. Due By should be an ISO 8601 timestamp.
   * @route POST /create-problem
   *
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Subject line of the problem."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Detailed description of the problem. HTML markup is supported."}
   * @paramDef {"type":"Number","label":"Requester ID","name":"requesterId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the requester who raised the problem."}
   * @paramDef {"type":"String","label":"Agent","name":"agentId","dictionary":"getAgentsDictionary","description":"Agent responsible for the problem. Select from your agents or enter an agent ID."}
   * @paramDef {"type":"String","label":"Group","name":"groupId","dictionary":"getGroupsDictionary","description":"Group assigned to the problem. Select from your groups or enter a group ID."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","defaultValue":"Low","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Medium","High","Urgent"]}},"description":"Problem priority. Defaults to Low."}
   * @paramDef {"type":"String","label":"Status","name":"status","defaultValue":"Open","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Change Requested","Closed"]}},"description":"Problem status. Defaults to Open."}
   * @paramDef {"type":"String","label":"Impact","name":"impact","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Medium","High"]}},"description":"Impact of the problem."}
   * @paramDef {"type":"String","label":"Due By","name":"dueBy","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Timestamp by which the problem is expected to be resolved (ISO 8601)."}
   * @paramDef {"type":"String","label":"Category","name":"category","description":"Problem category. Must match a category configured in your account."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Key/value pairs of custom problem fields."}
   *
   * @returns {Object}
   * @sampleResult {"id":8,"subject":"Recurring VPN drops","status":1,"priority":1,"impact":2,"group_id":null,"agent_id":null,"due_by":"2026-07-21T17:00:00Z","custom_fields":{},"created_at":"2026-07-14T10:00:00Z","updated_at":"2026-07-14T10:00:00Z"}
   */
  async createProblem(subject, description, requesterId, agentId, groupId, priority, status, impact, dueBy, category, customFields) {
    const logTag = '[createProblem]'

    return await this.#apiRequest({
      logTag,
      path: '/problems',
      method: 'post',
      body: clean({
        subject,
        description,
        requester_id: requesterId,
        agent_id: agentId ? Number(agentId) : undefined,
        group_id: groupId ? Number(groupId) : undefined,
        priority: this.#resolveChoice(priority, PRIORITY_MAP) ?? 1,
        status: this.#resolveChoice(status, PROBLEM_STATUS_MAP) ?? 1,
        impact: this.#resolveChoice(impact, IMPACT_MAP),
        due_by: dueBy,
        category,
        custom_fields: customFields,
      }),
    })
  }

  /**
   * @operationName Get Problem
   * @category Problems
   * @description Retrieves a single problem record by its ID, including subject, description, status, priority, impact, and assignment.
   * @route GET /get-problem
   *
   * @paramDef {"type":"Number","label":"Problem ID","name":"problemId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the problem to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":8,"subject":"Recurring VPN drops","status":1,"priority":1,"impact":2,"group_id":2043000112233,"agent_id":2043000654321,"due_by":"2026-07-21T17:00:00Z","custom_fields":{},"created_at":"2026-07-14T10:00:00Z","updated_at":"2026-07-14T11:00:00Z"}
   */
  async getProblem(problemId) {
    const logTag = '[getProblem]'

    return await this.#apiRequest({
      logTag,
      path: `/problems/${ problemId }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Problems
   * @category Problems
   * @description Lists problem records in the Freshservice account with pagination.
   * @route GET /list-problems
   *
   * @paramDef {"type":"String","label":"Updated Since","name":"updatedSince","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return problems updated at or after this time (ISO 8601)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of problems per page (max 100). Defaults to 30."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":8,"subject":"Recurring VPN drops","status":1,"priority":1,"impact":2,"created_at":"2026-07-14T10:00:00Z","updated_at":"2026-07-14T11:00:00Z"}]
   */
  async listProblems(updatedSince, page, perPage) {
    const logTag = '[listProblems]'

    return await this.#apiRequest({
      logTag,
      path: '/problems',
      method: 'get',
      query: {
        updated_since: updatedSince,
        page: page || 1,
        per_page: perPage || DEFAULT_PAGE_SIZE,
      },
    })
  }

  /**
   * @operationName Update Problem
   * @category Problems
   * @description Updates an existing problem record. Only the provided fields are changed; all other fields keep their current values. Priority, status, and impact accept friendly labels.
   * @route PUT /update-problem
   *
   * @paramDef {"type":"Number","label":"Problem ID","name":"problemId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the problem to update."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"New subject line for the problem."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description for the problem. HTML markup is supported."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Medium","High","Urgent"]}},"description":"New priority. Leave empty to keep the current priority."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Change Requested","Closed"]}},"description":"New status. Leave empty to keep the current status."}
   * @paramDef {"type":"String","label":"Impact","name":"impact","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Medium","High"]}},"description":"New impact. Leave empty to keep the current impact."}
   * @paramDef {"type":"String","label":"Agent","name":"agentId","dictionary":"getAgentsDictionary","description":"Agent responsible for the problem. Select from your agents or enter an agent ID."}
   * @paramDef {"type":"String","label":"Group","name":"groupId","dictionary":"getGroupsDictionary","description":"Group assigned to the problem. Select from your groups or enter a group ID."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Key/value pairs of custom problem fields to update."}
   *
   * @returns {Object}
   * @sampleResult {"id":8,"subject":"Recurring VPN drops","status":2,"priority":2,"impact":2,"group_id":2043000112233,"agent_id":2043000654321,"custom_fields":{},"created_at":"2026-07-14T10:00:00Z","updated_at":"2026-07-14T12:00:00Z"}
   */
  async updateProblem(problemId, subject, description, priority, status, impact, agentId, groupId, customFields) {
    const logTag = '[updateProblem]'

    return await this.#apiRequest({
      logTag,
      path: `/problems/${ problemId }`,
      method: 'put',
      body: clean({
        subject,
        description,
        priority: this.#resolveChoice(priority, PRIORITY_MAP),
        status: this.#resolveChoice(status, PROBLEM_STATUS_MAP),
        impact: this.#resolveChoice(impact, IMPACT_MAP),
        agent_id: agentId ? Number(agentId) : undefined,
        group_id: groupId ? Number(groupId) : undefined,
        custom_fields: customFields,
      }),
    })
  }

  /**
   * @operationName Delete Problem
   * @category Problems
   * @description Deletes a problem record by its ID.
   * @route DELETE /delete-problem
   *
   * @paramDef {"type":"Number","label":"Problem ID","name":"problemId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the problem to delete."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"problemId":8}
   */
  async deleteProblem(problemId) {
    const logTag = '[deleteProblem]'

    await this.#apiRequest({
      logTag,
      path: `/problems/${ problemId }`,
      method: 'delete',
    })

    return { deleted: true, problemId }
  }

  // ==================== Releases ====================

  /**
   * @operationName Create Release
   * @category Releases
   * @description Creates a new release in Freshservice, used to plan and coordinate the rollout of one or more changes. Priority, status, and release type accept friendly labels. Planned start/end dates should be ISO 8601 timestamps.
   * @route POST /create-release
   *
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Subject line of the release."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Detailed description of the release. HTML markup is supported."}
   * @paramDef {"type":"String","label":"Agent","name":"agentId","dictionary":"getAgentsDictionary","description":"Agent responsible for the release. Select from your agents or enter an agent ID."}
   * @paramDef {"type":"String","label":"Group","name":"groupId","dictionary":"getGroupsDictionary","description":"Group assigned to the release. Select from your groups or enter a group ID."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","defaultValue":"Low","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Medium","High","Urgent"]}},"description":"Release priority. Defaults to Low."}
   * @paramDef {"type":"String","label":"Status","name":"status","defaultValue":"Open","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","On Hold","In Progress","Incomplete","Completed"]}},"description":"Release status. Defaults to Open."}
   * @paramDef {"type":"String","label":"Release Type","name":"releaseType","uiComponent":{"type":"DROPDOWN","options":{"values":["Minor","Standard","Major","Emergency"]}},"description":"Type of release."}
   * @paramDef {"type":"String","label":"Planned Start Date","name":"plannedStartDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Planned start of the release (ISO 8601)."}
   * @paramDef {"type":"String","label":"Planned End Date","name":"plannedEndDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Planned end of the release (ISO 8601)."}
   * @paramDef {"type":"String","label":"Category","name":"category","description":"Release category. Must match a category configured in your account."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Key/value pairs of custom release fields."}
   *
   * @returns {Object}
   * @sampleResult {"id":5,"subject":"Q3 platform rollout","status":1,"priority":1,"release_type":2,"planned_start_date":"2026-07-25T09:00:00Z","planned_end_date":"2026-07-25T18:00:00Z","group_id":null,"agent_id":null,"custom_fields":{},"created_at":"2026-07-14T10:00:00Z","updated_at":"2026-07-14T10:00:00Z"}
   */
  async createRelease(subject, description, agentId, groupId, priority, status, releaseType, plannedStartDate, plannedEndDate, category, customFields) {
    const logTag = '[createRelease]'

    return await this.#apiRequest({
      logTag,
      path: '/releases',
      method: 'post',
      body: clean({
        subject,
        description,
        agent_id: agentId ? Number(agentId) : undefined,
        group_id: groupId ? Number(groupId) : undefined,
        priority: this.#resolveChoice(priority, PRIORITY_MAP) ?? 1,
        status: this.#resolveChoice(status, RELEASE_STATUS_MAP) ?? 1,
        release_type: this.#resolveChoice(releaseType, RELEASE_TYPE_MAP),
        planned_start_date: plannedStartDate,
        planned_end_date: plannedEndDate,
        category,
        custom_fields: customFields,
      }),
    })
  }

  /**
   * @operationName Get Release
   * @category Releases
   * @description Retrieves a single release by its ID, including subject, description, status, priority, release type, and planned schedule.
   * @route GET /get-release
   *
   * @paramDef {"type":"Number","label":"Release ID","name":"releaseId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the release to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":5,"subject":"Q3 platform rollout","status":1,"priority":1,"release_type":2,"group_id":2043000112233,"agent_id":2043000654321,"planned_start_date":"2026-07-25T09:00:00Z","planned_end_date":"2026-07-25T18:00:00Z","custom_fields":{},"created_at":"2026-07-14T10:00:00Z","updated_at":"2026-07-14T11:00:00Z"}
   */
  async getRelease(releaseId) {
    const logTag = '[getRelease]'

    return await this.#apiRequest({
      logTag,
      path: `/releases/${ releaseId }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Releases
   * @category Releases
   * @description Lists releases in the Freshservice account with pagination.
   * @route GET /list-releases
   *
   * @paramDef {"type":"String","label":"Updated Since","name":"updatedSince","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return releases updated at or after this time (ISO 8601)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of releases per page (max 100). Defaults to 30."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":5,"subject":"Q3 platform rollout","status":1,"priority":1,"release_type":2,"created_at":"2026-07-14T10:00:00Z","updated_at":"2026-07-14T11:00:00Z"}]
   */
  async listReleases(updatedSince, page, perPage) {
    const logTag = '[listReleases]'

    return await this.#apiRequest({
      logTag,
      path: '/releases',
      method: 'get',
      query: {
        updated_since: updatedSince,
        page: page || 1,
        per_page: perPage || DEFAULT_PAGE_SIZE,
      },
    })
  }

  // ==================== Assets ====================

  /**
   * @operationName Create Asset
   * @category Assets
   * @description Creates a new asset in the Freshservice CMDB. An Asset Type ID is required and determines which type-specific fields apply. Type-specific attributes are passed via Type Fields as key/value pairs (keys follow the pattern of the asset type's field names). Impact accepts a friendly label.
   * @route POST /create-asset
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Display name of the asset."}
   * @paramDef {"type":"Number","label":"Asset Type ID","name":"assetTypeId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the asset type (e.g. Hardware, Software). Retrieve asset type IDs from your account's Asset Types."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Description of the asset."}
   * @paramDef {"type":"String","label":"Asset Tag","name":"assetTag","description":"Unique asset tag used to identify the asset."}
   * @paramDef {"type":"String","label":"Impact","name":"impact","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Medium","High"]}},"description":"Business impact of the asset."}
   * @paramDef {"type":"Object","label":"Type Fields","name":"typeFields","description":"Key/value pairs of asset-type-specific fields, e.g. {\"product_1000123456\":\"Dell XPS\",\"serial_number_1000123456\":\"SN-42\"}."}
   *
   * @returns {Object}
   * @sampleResult {"id":101,"display_id":42,"name":"Laptop-042","description":"Dell XPS 15","asset_type_id":1000123456,"impact":"low","asset_tag":"ASSET-042","type_fields":{},"created_at":"2026-07-14T10:00:00Z","updated_at":"2026-07-14T10:00:00Z"}
   */
  async createAsset(name, assetTypeId, description, assetTag, impact, typeFields) {
    const logTag = '[createAsset]'

    return await this.#apiRequest({
      logTag,
      path: '/assets',
      method: 'post',
      body: clean({
        name,
        asset_type_id: assetTypeId,
        description,
        asset_tag: assetTag,
        impact: this.#resolveChoice(impact, { 'Low': 'low', 'Medium': 'medium', 'High': 'high' }),
        type_fields: typeFields,
      }),
    })
  }

  /**
   * @operationName Get Asset
   * @category Assets
   * @description Retrieves a single asset by its display ID (the number shown in the Freshservice UI), including its name, type, impact, asset tag, and type-specific fields.
   * @route GET /get-asset
   *
   * @paramDef {"type":"Number","label":"Display ID","name":"displayId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Display ID of the asset (the number shown in the Freshservice UI, e.g. 42)."}
   * @paramDef {"type":"Boolean","label":"Include Type Fields","name":"includeTypeFields","uiComponent":{"type":"TOGGLE"},"description":"When enabled, includes the asset's type-specific fields in the response."}
   *
   * @returns {Object}
   * @sampleResult {"id":101,"display_id":42,"name":"Laptop-042","description":"Dell XPS 15","asset_type_id":1000123456,"impact":"low","asset_tag":"ASSET-042","type_fields":{},"created_at":"2026-07-14T10:00:00Z","updated_at":"2026-07-14T10:00:00Z"}
   */
  async getAsset(displayId, includeTypeFields) {
    const logTag = '[getAsset]'

    return await this.#apiRequest({
      logTag,
      path: `/assets/${ displayId }`,
      method: 'get',
      query: {
        include: includeTypeFields ? 'type_fields' : undefined,
      },
    })
  }

  /**
   * @operationName List Assets
   * @category Assets
   * @description Lists assets in the Freshservice CMDB with pagination. Optionally filters using the Freshservice filter query syntax (e.g. "asset_type_id:1000123456").
   * @route GET /list-assets
   *
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Freshservice filter query, e.g. asset_type_id:1000123456 AND impact:'high'. Leave empty to list all assets."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of assets per page (max 100). Defaults to 30."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":101,"display_id":42,"name":"Laptop-042","asset_type_id":1000123456,"impact":"low","asset_tag":"ASSET-042","created_at":"2026-07-14T10:00:00Z","updated_at":"2026-07-14T10:00:00Z"}]
   */
  async listAssets(filter, page, perPage) {
    const logTag = '[listAssets]'

    return await this.#apiRequest({
      logTag,
      path: '/assets',
      method: 'get',
      query: {
        filter_query: filter ? `"${ String(filter).trim().replace(/^"+|"+$/g, '') }"` : undefined,
        page: page || 1,
        per_page: perPage || DEFAULT_PAGE_SIZE,
      },
    })
  }

  /**
   * @operationName Update Asset
   * @category Assets
   * @description Updates an existing asset identified by its display ID. Only the provided fields are changed; all other fields keep their current values. Impact accepts a friendly label.
   * @route PUT /update-asset
   *
   * @paramDef {"type":"Number","label":"Display ID","name":"displayId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Display ID of the asset to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New display name of the asset."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description of the asset."}
   * @paramDef {"type":"String","label":"Asset Tag","name":"assetTag","description":"New asset tag."}
   * @paramDef {"type":"String","label":"Impact","name":"impact","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Medium","High"]}},"description":"New business impact. Leave empty to keep the current impact."}
   * @paramDef {"type":"Object","label":"Type Fields","name":"typeFields","description":"Key/value pairs of asset-type-specific fields to update."}
   *
   * @returns {Object}
   * @sampleResult {"id":101,"display_id":42,"name":"Laptop-042","description":"Dell XPS 15 (2026)","asset_type_id":1000123456,"impact":"medium","asset_tag":"ASSET-042","type_fields":{},"created_at":"2026-07-14T10:00:00Z","updated_at":"2026-07-14T12:00:00Z"}
   */
  async updateAsset(displayId, name, description, assetTag, impact, typeFields) {
    const logTag = '[updateAsset]'

    return await this.#apiRequest({
      logTag,
      path: `/assets/${ displayId }`,
      method: 'put',
      body: clean({
        name,
        description,
        asset_tag: assetTag,
        impact: this.#resolveChoice(impact, { 'Low': 'low', 'Medium': 'medium', 'High': 'high' }),
        type_fields: typeFields,
      }),
    })
  }

  /**
   * @operationName Delete Asset
   * @category Assets
   * @description Deletes an asset by its display ID. The asset is moved to the trash and can be restored from the Freshservice UI.
   * @route DELETE /delete-asset
   *
   * @paramDef {"type":"Number","label":"Display ID","name":"displayId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Display ID of the asset to delete."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"displayId":42}
   */
  async deleteAsset(displayId) {
    const logTag = '[deleteAsset]'

    await this.#apiRequest({
      logTag,
      path: `/assets/${ displayId }`,
      method: 'delete',
    })

    return { deleted: true, displayId }
  }

  // ==================== Agents ====================

  /**
   * @operationName List Agents
   * @category Agents
   * @description Lists agents in the Freshservice account with pagination, including their contact details, availability, and roles. Optionally filters by an exact email address.
   * @route GET /list-agents
   *
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Exact email address to filter by. Returns the matching agent only."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of agents per page (max 100). Defaults to 30."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":2043000654321,"first_name":"John","last_name":"Agent","email":"john@yourcompany.com","active":true,"occasional":false,"created_at":"2026-01-10T09:00:00Z","updated_at":"2026-07-01T09:00:00Z"}]
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
   * @operationName Get Agent
   * @category Agents
   * @description Retrieves a single agent by their ID, including name, email, availability, roles, and group memberships.
   * @route GET /get-agent
   *
   * @paramDef {"type":"Number","label":"Agent ID","name":"agentId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the agent to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":2043000654321,"first_name":"John","last_name":"Agent","email":"john@yourcompany.com","active":true,"occasional":false,"group_ids":[2043000112233],"created_at":"2026-01-10T09:00:00Z","updated_at":"2026-07-01T09:00:00Z"}
   */
  async getAgent(agentId) {
    const logTag = '[getAgent]'

    return await this.#apiRequest({
      logTag,
      path: `/agents/${ agentId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Current Agent
   * @category Agents
   * @description Retrieves the agent associated with the API key used for authentication. Useful as a connection check to verify that the domain and API key are configured correctly.
   * @route GET /get-current-agent
   *
   * @returns {Object}
   * @sampleResult {"id":2043000654321,"first_name":"John","last_name":"Agent","email":"john@yourcompany.com","active":true,"occasional":false,"created_at":"2026-01-10T09:00:00Z","updated_at":"2026-07-01T09:00:00Z"}
   */
  async getCurrentAgent() {
    const logTag = '[getCurrentAgent]'

    return await this.#apiRequest({
      logTag,
      path: '/agents/me',
      method: 'get',
    })
  }

  // ==================== Requesters ====================

  /**
   * @operationName Create Requester
   * @category Requesters
   * @description Creates a new requester (end user) in Freshservice. At least one of Primary Email, Work Phone, or Mobile Phone is required. Custom requester fields can be set via Custom Fields.
   * @route POST /create-requester
   *
   * @paramDef {"type":"String","label":"First Name","name":"firstName","required":true,"description":"First name of the requester."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Last name of the requester."}
   * @paramDef {"type":"String","label":"Primary Email","name":"primaryEmail","description":"Primary email address of the requester. Must be unique. Required unless a phone number is provided."}
   * @paramDef {"type":"String","label":"Job Title","name":"jobTitle","description":"Job title of the requester."}
   * @paramDef {"type":"String","label":"Work Phone","name":"workPhone","description":"Work phone number of the requester."}
   * @paramDef {"type":"String","label":"Mobile Phone","name":"mobilePhone","description":"Mobile phone number of the requester."}
   * @paramDef {"type":"Array<String>","label":"Department IDs","name":"departmentIds","description":"IDs of the departments the requester belongs to."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Key/value pairs of custom requester fields."}
   *
   * @returns {Object}
   * @sampleResult {"id":2043000123456,"first_name":"Jane","last_name":"Doe","primary_email":"jane.doe@example.com","job_title":"Analyst","work_phone_number":"+1 555 0100","mobile_phone_number":null,"active":true,"custom_fields":{},"created_at":"2026-07-14T10:00:00Z","updated_at":"2026-07-14T10:00:00Z"}
   */
  async createRequester(firstName, lastName, primaryEmail, jobTitle, workPhone, mobilePhone, departmentIds, customFields) {
    const logTag = '[createRequester]'

    return await this.#apiRequest({
      logTag,
      path: '/requesters',
      method: 'post',
      body: clean({
        first_name: firstName,
        last_name: lastName,
        primary_email: primaryEmail,
        job_title: jobTitle,
        work_phone_number: workPhone,
        mobile_phone_number: mobilePhone,
        department_ids: departmentIds,
        custom_fields: customFields,
      }),
    })
  }

  /**
   * @operationName Get Requester
   * @category Requesters
   * @description Retrieves a single requester by their ID, including name, email, phone numbers, job title, and department associations.
   * @route GET /get-requester
   *
   * @paramDef {"type":"Number","label":"Requester ID","name":"requesterId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the requester to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":2043000123456,"first_name":"Jane","last_name":"Doe","primary_email":"jane.doe@example.com","job_title":"Analyst","work_phone_number":"+1 555 0100","mobile_phone_number":null,"active":true,"department_ids":[],"custom_fields":{},"created_at":"2026-07-14T10:00:00Z","updated_at":"2026-07-14T10:00:00Z"}
   */
  async getRequester(requesterId) {
    const logTag = '[getRequester]'

    return await this.#apiRequest({
      logTag,
      path: `/requesters/${ requesterId }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Requesters
   * @category Requesters
   * @description Lists requesters (end users) in the Freshservice account with pagination. Optionally filters by an exact email address.
   * @route GET /list-requesters
   *
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Exact email address to filter by. Returns the matching requester only."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of requesters per page (max 100). Defaults to 30."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":2043000123456,"first_name":"Jane","last_name":"Doe","primary_email":"jane.doe@example.com","job_title":"Analyst","active":true,"created_at":"2026-07-14T10:00:00Z","updated_at":"2026-07-14T10:00:00Z"}]
   */
  async listRequesters(email, page, perPage) {
    const logTag = '[listRequesters]'

    return await this.#apiRequest({
      logTag,
      path: '/requesters',
      method: 'get',
      query: {
        email,
        page: page || 1,
        per_page: perPage || DEFAULT_PAGE_SIZE,
      },
    })
  }

  /**
   * @operationName Update Requester
   * @category Requesters
   * @description Updates an existing requester. Only the provided fields are changed; all other fields keep their current values.
   * @route PUT /update-requester
   *
   * @paramDef {"type":"Number","label":"Requester ID","name":"requesterId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the requester to update."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"New first name of the requester."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"New last name of the requester."}
   * @paramDef {"type":"String","label":"Primary Email","name":"primaryEmail","description":"New primary email address. Must be unique."}
   * @paramDef {"type":"String","label":"Job Title","name":"jobTitle","description":"New job title of the requester."}
   * @paramDef {"type":"String","label":"Work Phone","name":"workPhone","description":"New work phone number."}
   * @paramDef {"type":"String","label":"Mobile Phone","name":"mobilePhone","description":"New mobile phone number."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Key/value pairs of custom requester fields to update."}
   *
   * @returns {Object}
   * @sampleResult {"id":2043000123456,"first_name":"Jane","last_name":"Doe","primary_email":"jane.doe@example.com","job_title":"Senior Analyst","work_phone_number":"+1 555 0199","active":true,"custom_fields":{},"created_at":"2026-07-14T10:00:00Z","updated_at":"2026-07-14T13:00:00Z"}
   */
  async updateRequester(requesterId, firstName, lastName, primaryEmail, jobTitle, workPhone, mobilePhone, customFields) {
    const logTag = '[updateRequester]'

    return await this.#apiRequest({
      logTag,
      path: `/requesters/${ requesterId }`,
      method: 'put',
      body: clean({
        first_name: firstName,
        last_name: lastName,
        primary_email: primaryEmail,
        job_title: jobTitle,
        work_phone_number: workPhone,
        mobile_phone_number: mobilePhone,
        custom_fields: customFields,
      }),
    })
  }

  // ==================== Groups ====================

  /**
   * @operationName List Groups
   * @category Groups
   * @description Lists agent groups in the Freshservice account with pagination, including their names, descriptions, and business hours.
   * @route GET /list-groups
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of groups per page (max 100). Defaults to 30."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":2043000112233,"name":"Network Team","description":"Handles network incidents","business_hours_id":null,"escalate_to":2043000654321,"created_at":"2026-01-10T09:00:00Z","updated_at":"2026-07-01T09:00:00Z"}]
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

  // ==================== Dictionaries ====================

  /**
   * @typedef {Object} getAgentsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter agents by name or email."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number of the next page)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Agents Dictionary
   * @description Provides a searchable list of Freshservice agents for selecting an assignee. The option value is the agent ID.
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

        const name = `${ agent.first_name || '' } ${ agent.last_name || '' }`.trim()
        const agentEmail = agent.email || ''

        return name.toLowerCase().includes(searchText) || agentEmail.toLowerCase().includes(searchText)
      })
      .map(agent => {
        const name = `${ agent.first_name || '' } ${ agent.last_name || '' }`.trim()

        return {
          label: name || agent.email || String(agent.id),
          value: String(agent.id),
          note: agent.email || undefined,
        }
      })

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
   * @description Provides a searchable list of Freshservice agent groups for selecting a group. The option value is the group ID.
   * @route POST /get-groups-dictionary
   * @paramDef {"type":"getGroupsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Network Team","value":"2043000112233","note":"Handles network incidents"}],"cursor":null}
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

  // ==================== Triggers ====================

  /**
   * @registerAs POLLING_TRIGGER
   * @operationName On New Ticket
   * @category Triggers
   * @description Fires when a new ticket is created in Freshservice. Polls the account for recently created tickets and emits each newly created ticket as a separate event. On the first run it establishes a baseline and does not emit historical tickets.
   * @route POST /on-new-ticket
   * @returns {Array<Object>}
   * @sampleResult [{"id":42,"subject":"Laptop not booting","status":2,"priority":1,"source":2,"requester_id":2043000123456,"created_at":"2026-07-14T10:00:00Z","updated_at":"2026-07-14T10:00:00Z"}]
   */
  async handleTriggerPollingForEvent(state) {
    const logTag = '[handleTriggerPollingForEvent]'
    const previousState = state || {}
    const lastSeenCreatedAt = previousState.lastSeenCreatedAt

    const tickets = await this.#apiRequest({
      logTag,
      path: '/tickets',
      method: 'get',
      query: {
        order_by: 'created_at',
        order_type: 'desc',
        per_page: 100,
      },
    })

    const list = Array.isArray(tickets) ? tickets : (tickets?.tickets || [])

    // Newest created_at across the batch becomes the new watermark.
    let newWatermark = lastSeenCreatedAt

    for (const ticket of list) {
      if (ticket.created_at && (!newWatermark || ticket.created_at > newWatermark)) {
        newWatermark = ticket.created_at
      }
    }

    // First run: establish baseline, emit nothing.
    if (!lastSeenCreatedAt) {
      return {
        state: { lastSeenCreatedAt: newWatermark || new Date().toISOString() },
        events: [],
      }
    }

    const events = list
      .filter(ticket => ticket.created_at && ticket.created_at > lastSeenCreatedAt)
      .sort((a, b) => (a.created_at > b.created_at ? 1 : -1))

    return {
      state: { lastSeenCreatedAt: newWatermark || lastSeenCreatedAt },
      events,
    }
  }
}

Flowrunner.ServerCode.addService(FreshserviceService, [
  {
    name: 'domain',
    displayName: 'Domain',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Freshservice domain — the subdomain only, e.g. "acme" for acme.freshservice.com.',
  },
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Freshservice API key. Find it in Freshservice under Profile Settings → Your API Key.',
  },
])
