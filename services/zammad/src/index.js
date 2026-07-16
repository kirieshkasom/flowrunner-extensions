const logger = {
  info: (...args) => console.log('[Zammad] info:', ...args),
  debug: (...args) => console.log('[Zammad] debug:', ...args),
  error: (...args) => console.log('[Zammad] error:', ...args),
  warn: (...args) => console.log('[Zammad] warn:', ...args),
}

const DEFAULT_PER_PAGE = 50

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
 * @integrationName Zammad
 * @integrationIcon /icon.png
 */
class ZammadService {
  constructor(config) {
    this.serverUrl = String(config.serverUrl || '')
      .trim()
      .replace(/\/+$/, '')

    this.apiToken = config.apiToken
  }

  get #baseUrl() {
    return `${ this.serverUrl }/api/v1`
  }

  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const url = `${ this.#baseUrl }${ path }`

    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery || {}) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Token token=${ this.apiToken }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const errorBody = error.body || {}
      const message = errorBody.error_human || errorBody.error || error.message || 'Unknown error'

      logger.error(`${ logTag } - Request failed: ${ message }`)

      throw new Error(`Zammad API error: ${ message }`)
    }
  }

  // ==================== Tickets ====================

  /**
   * @operationName Create Ticket
   * @category Tickets
   * @description Creates a new ticket in Zammad along with its first article (message). The group and customer identify the owning team and the requester: group accepts a group name (e.g. "Users") or a numeric group ID, and customer accepts the requester's email address or a numeric user ID (Zammad auto-creates a customer if the email is unknown). State and priority accept friendly Zammad names — state one of new, open, pending reminder, pending close, closed, merged, removed; priority one of 1 low, 2 normal, 3 high — or you may pass the raw name/ID directly. The article body is the initial message; the article type defaults to note.
   * @route POST /create-ticket
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Subject/title of the ticket."}
   * @paramDef {"type":"String","label":"Group","name":"group","required":true,"dictionary":"getGroupsDictionary","description":"Group that owns the ticket. Select a group, or enter a group name (e.g. \"Users\") or numeric group ID."}
   * @paramDef {"type":"String","label":"Customer","name":"customer","required":true,"description":"Requester of the ticket: an email address (a customer is created automatically if unknown) or a numeric user ID."}
   * @paramDef {"type":"String","label":"Body","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Content of the first article (message) on the ticket."}
   * @paramDef {"type":"String","label":"Article Subject","name":"articleSubject","description":"Subject of the first article. Defaults to the ticket title when omitted."}
   * @paramDef {"type":"String","label":"Article Type","name":"articleType","defaultValue":"note","uiComponent":{"type":"DROPDOWN","options":{"values":["note","email","phone","web"]}},"description":"Communication type of the first article. Defaults to note."}
   * @paramDef {"type":"Boolean","label":"Internal Article","name":"internal","defaultValue":false,"uiComponent":{"type":"TOGGLE"},"description":"Whether the first article is internal (visible only to agents). Defaults to false."}
   * @paramDef {"type":"String","label":"State","name":"state","defaultValue":"new","uiComponent":{"type":"DROPDOWN","options":{"values":["new","open","pending reminder","pending close","closed"]}},"description":"Ticket state. Defaults to new."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","defaultValue":"2 normal","uiComponent":{"type":"DROPDOWN","options":{"values":["1 low","2 normal","3 high"]}},"description":"Ticket priority. Defaults to 2 normal."}
   *
   * @returns {Object}
   * @sampleResult {"id":123,"number":"67001","title":"Cannot log in","group_id":1,"state_id":1,"priority_id":2,"customer_id":45,"owner_id":1,"created_at":"2026-07-13T10:00:00Z","updated_at":"2026-07-13T10:00:00Z"}
   */
  async createTicket(title, group, customer, body, articleSubject, articleType, internal, state, priority) {
    const logTag = '[createTicket]'
    const isId = value => /^\d+$/.test(String(value))

    const payload = {
      title,
      body: undefined,
      article: clean({
        subject: articleSubject || title,
        body,
        type: articleType || 'note',
        internal: internal === undefined ? undefined : Boolean(internal),
      }),
    }

    if (isId(group)) {
      payload.group_id = Number(group)
    } else {
      payload.group = group
    }

    if (isId(customer)) {
      payload.customer_id = Number(customer)
    } else {
      payload.customer = customer
    }

    if (state) {
      payload.state = state
    }

    if (priority) {
      payload.priority = priority
    }

    return await this.#apiRequest({
      logTag,
      path: '/tickets',
      method: 'post',
      body: clean(payload),
    })
  }

  /**
   * @operationName Get Ticket
   * @category Tickets
   * @description Retrieves a single ticket by its ID, including title, group, state, priority, customer, owner, and timestamps. Enable Expand to resolve ID references (state, priority, group, customer, owner) into human-readable names alongside the IDs.
   * @route GET /get-ticket
   *
   * @paramDef {"type":"Number","label":"Ticket ID","name":"ticketId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the ticket to retrieve."}
   * @paramDef {"type":"Boolean","label":"Expand","name":"expand","uiComponent":{"type":"TOGGLE"},"description":"When enabled, resolves ID references (state, priority, group, customer, owner) to their names."}
   *
   * @returns {Object}
   * @sampleResult {"id":123,"number":"67001","title":"Cannot log in","group_id":1,"state_id":2,"priority_id":2,"customer_id":45,"owner_id":1,"state":"open","priority":"2 normal","group":"Users","created_at":"2026-07-13T10:00:00Z","updated_at":"2026-07-13T11:00:00Z"}
   */
  async getTicket(ticketId, expand) {
    const logTag = '[getTicket]'

    return await this.#apiRequest({
      logTag,
      path: `/tickets/${ ticketId }`,
      method: 'get',
      query: { expand: expand ? true : undefined },
    })
  }

  /**
   * @operationName List Tickets
   * @category Tickets
   * @description Lists tickets in the Zammad instance with pagination. Enable Expand to resolve ID references (state, priority, group, customer, owner) into human-readable names. For filtering by arbitrary criteria use Search Tickets.
   * @route GET /list-tickets
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of tickets per page. Defaults to 50."}
   * @paramDef {"type":"Boolean","label":"Expand","name":"expand","uiComponent":{"type":"TOGGLE"},"description":"When enabled, resolves ID references to their names in each ticket."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":123,"number":"67001","title":"Cannot log in","group_id":1,"state_id":2,"priority_id":2,"customer_id":45,"owner_id":1,"created_at":"2026-07-13T10:00:00Z","updated_at":"2026-07-13T11:00:00Z"}]
   */
  async listTickets(page, perPage, expand) {
    const logTag = '[listTickets]'

    return await this.#apiRequest({
      logTag,
      path: '/tickets',
      method: 'get',
      query: {
        page: page || 1,
        per_page: perPage || DEFAULT_PER_PAGE,
        expand: expand ? true : undefined,
      },
    })
  }

  /**
   * @operationName Update Ticket
   * @category Tickets
   * @description Updates an existing ticket. Only the provided fields are changed; all other fields keep their current values. State and priority accept friendly Zammad names (e.g. state open/closed, priority "3 high") or their raw name/ID. Group accepts a group name or numeric group ID.
   * @route PUT /update-ticket
   *
   * @paramDef {"type":"Number","label":"Ticket ID","name":"ticketId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the ticket to update."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New title for the ticket."}
   * @paramDef {"type":"String","label":"Group","name":"group","dictionary":"getGroupsDictionary","description":"New owning group. Select a group, or enter a group name or numeric group ID."}
   * @paramDef {"type":"String","label":"State","name":"state","uiComponent":{"type":"DROPDOWN","options":{"values":["new","open","pending reminder","pending close","closed"]}},"description":"New ticket state. Leave empty to keep the current state."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","uiComponent":{"type":"DROPDOWN","options":{"values":["1 low","2 normal","3 high"]}},"description":"New ticket priority. Leave empty to keep the current priority."}
   * @paramDef {"type":"String","label":"Owner","name":"owner","description":"New owner (assigned agent): an agent's email address or a numeric user ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":123,"number":"67001","title":"Cannot log in","group_id":1,"state_id":4,"priority_id":3,"customer_id":45,"owner_id":7,"created_at":"2026-07-13T10:00:00Z","updated_at":"2026-07-13T12:00:00Z"}
   */
  async updateTicket(ticketId, title, group, state, priority, owner) {
    const logTag = '[updateTicket]'
    const isId = value => /^\d+$/.test(String(value))

    const payload = clean({
      title,
      state,
      priority,
    })

    if (group) {
      if (isId(group)) {
        payload.group_id = Number(group)
      } else {
        payload.group = group
      }
    }

    if (owner) {
      if (isId(owner)) {
        payload.owner_id = Number(owner)
      } else {
        payload.owner = owner
      }
    }

    return await this.#apiRequest({
      logTag,
      path: `/tickets/${ ticketId }`,
      method: 'put',
      body: payload,
    })
  }

  /**
   * @operationName Delete Ticket
   * @category Tickets
   * @description Permanently deletes a ticket by its ID. This removes the ticket and all of its articles and cannot be undone. Ticket deletion requires an API token with admin permissions.
   * @route DELETE /delete-ticket
   *
   * @paramDef {"type":"Number","label":"Ticket ID","name":"ticketId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the ticket to delete."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"ticketId":123}
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
   * @operationName Search Tickets
   * @category Tickets
   * @description Searches tickets using Zammad's full-text query syntax. The query can be plain text or field-scoped conditions combined with AND/OR, e.g. state.name:open AND priority.name:"3 high", or customer.email:jane@example.com. Enable Expand to resolve ID references to names. Returns up to Page Size results per page.
   * @route GET /search-tickets
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Search query, e.g. \"login\" or state.name:open AND group.name:Users."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results per page. Defaults to 50."}
   * @paramDef {"type":"Boolean","label":"Expand","name":"expand","uiComponent":{"type":"TOGGLE"},"description":"When enabled, resolves ID references to their names in each result."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":123,"number":"67001","title":"Cannot log in","group_id":1,"state_id":2,"priority_id":2,"customer_id":45,"created_at":"2026-07-13T10:00:00Z","updated_at":"2026-07-13T11:00:00Z"}]
   */
  async searchTickets(query, page, perPage, expand) {
    const logTag = '[searchTickets]'

    return await this.#apiRequest({
      logTag,
      path: '/tickets/search',
      method: 'get',
      query: {
        query,
        page: page || 1,
        per_page: perPage || DEFAULT_PER_PAGE,
        expand: expand ? true : undefined,
      },
    })
  }

  // ==================== Articles ====================

  /**
   * @operationName Create Article
   * @category Articles
   * @description Adds an article (message) to an existing ticket. The article type controls the communication channel: note is an internal or public comment, email sends an email to the recipient, and phone records a phone call. Set Internal to true to keep the article visible to agents only. Provide To for email articles to address the recipient.
   * @route POST /create-article
   *
   * @paramDef {"type":"Number","label":"Ticket ID","name":"ticketId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the ticket to add the article to."}
   * @paramDef {"type":"String","label":"Body","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Content of the article."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"Subject of the article."}
   * @paramDef {"type":"String","label":"Type","name":"type","defaultValue":"note","uiComponent":{"type":"DROPDOWN","options":{"values":["note","email","phone","web"]}},"description":"Communication type of the article. Defaults to note."}
   * @paramDef {"type":"Boolean","label":"Internal","name":"internal","defaultValue":false,"uiComponent":{"type":"TOGGLE"},"description":"Whether the article is internal (visible only to agents). Defaults to false."}
   * @paramDef {"type":"String","label":"To","name":"to","description":"Recipient address for email articles, e.g. customer@example.com."}
   *
   * @returns {Object}
   * @sampleResult {"id":456,"ticket_id":123,"subject":"Re: Cannot log in","body":"We have reset your password.","type_id":10,"type":"note","internal":false,"sender":"Agent","from":"Agent Smith","to":"jane@example.com","created_at":"2026-07-13T12:00:00Z","updated_at":"2026-07-13T12:00:00Z"}
   */
  async createArticle(ticketId, body, subject, type, internal, to) {
    const logTag = '[createArticle]'

    return await this.#apiRequest({
      logTag,
      path: '/ticket_articles',
      method: 'post',
      body: clean({
        ticket_id: ticketId,
        body,
        subject,
        type: type || 'note',
        internal: internal === undefined ? undefined : Boolean(internal),
        to,
      }),
    })
  }

  /**
   * @operationName List Articles By Ticket
   * @category Articles
   * @description Lists all articles (messages) of a ticket in chronological order. Each article includes its subject, body, type, sender, and whether it is internal.
   * @route GET /list-articles-by-ticket
   *
   * @paramDef {"type":"Number","label":"Ticket ID","name":"ticketId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the ticket whose articles to list."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":456,"ticket_id":123,"subject":"Cannot log in","body":"I cannot log in.","type":"note","internal":false,"sender":"Customer","from":"jane@example.com","created_at":"2026-07-13T10:00:00Z"}]
   */
  async listArticlesByTicket(ticketId) {
    const logTag = '[listArticlesByTicket]'

    return await this.#apiRequest({
      logTag,
      path: `/ticket_articles/by_ticket/${ ticketId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Article
   * @category Articles
   * @description Retrieves a single ticket article by its ID, including its subject, body, type, sender, recipients, and internal flag.
   * @route GET /get-article
   *
   * @paramDef {"type":"Number","label":"Article ID","name":"articleId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the article to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":456,"ticket_id":123,"subject":"Cannot log in","body":"I cannot log in.","type":"note","internal":false,"sender":"Customer","from":"jane@example.com","to":null,"created_at":"2026-07-13T10:00:00Z","updated_at":"2026-07-13T10:00:00Z"}
   */
  async getArticle(articleId) {
    const logTag = '[getArticle]'

    return await this.#apiRequest({
      logTag,
      path: `/ticket_articles/${ articleId }`,
      method: 'get',
    })
  }

  // ==================== Users ====================

  /**
   * @operationName Create User
   * @category Users
   * @description Creates a new user in Zammad. Users are customers by default; assign roles such as Agent or Admin to grant elevated access. At least one of Email or Phone should be provided so the user can be identified and contacted.
   * @route POST /create-user
   *
   * @paramDef {"type":"String","label":"First Name","name":"firstname","description":"First name of the user."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastname","description":"Last name of the user."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Email address of the user. Must be unique in the instance."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Telephone number of the user."}
   * @paramDef {"type":"Array<String>","label":"Roles","name":"roles","description":"Role names to assign, e.g. Customer, Agent, Admin. Defaults to Customer when omitted."}
   *
   * @returns {Object}
   * @sampleResult {"id":45,"login":"jane@example.com","firstname":"Jane","lastname":"Doe","email":"jane@example.com","phone":"+1 555 0100","active":true,"role_ids":[3],"created_at":"2026-07-13T10:00:00Z","updated_at":"2026-07-13T10:00:00Z"}
   */
  async createUser(firstname, lastname, email, phone, roles) {
    const logTag = '[createUser]'

    return await this.#apiRequest({
      logTag,
      path: '/users',
      method: 'post',
      body: clean({
        firstname,
        lastname,
        email,
        phone,
        roles,
      }),
    })
  }

  /**
   * @operationName Get User
   * @category Users
   * @description Retrieves a single user by their ID, including name, email, phone, active state, roles, and organization association.
   * @route GET /get-user
   *
   * @paramDef {"type":"Number","label":"User ID","name":"userId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the user to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":45,"login":"jane@example.com","firstname":"Jane","lastname":"Doe","email":"jane@example.com","phone":"+1 555 0100","organization_id":9,"active":true,"role_ids":[3],"created_at":"2026-07-13T10:00:00Z","updated_at":"2026-07-13T10:00:00Z"}
   */
  async getUser(userId) {
    const logTag = '[getUser]'

    return await this.#apiRequest({
      logTag,
      path: `/users/${ userId }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Users
   * @category Users
   * @description Lists users in the Zammad instance with pagination, including their names, emails, roles, and organization associations. For finding a specific user use Search Users.
   * @route GET /list-users
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of users per page. Defaults to 50."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":45,"login":"jane@example.com","firstname":"Jane","lastname":"Doe","email":"jane@example.com","organization_id":9,"active":true,"role_ids":[3],"created_at":"2026-07-13T10:00:00Z","updated_at":"2026-07-13T10:00:00Z"}]
   */
  async listUsers(page, perPage) {
    const logTag = '[listUsers]'

    return await this.#apiRequest({
      logTag,
      path: '/users',
      method: 'get',
      query: {
        page: page || 1,
        per_page: perPage || DEFAULT_PER_PAGE,
      },
    })
  }

  /**
   * @operationName Update User
   * @category Users
   * @description Updates an existing user. Only the provided fields are changed; all other fields keep their current values. Provide Roles to replace the user's assigned roles.
   * @route PUT /update-user
   *
   * @paramDef {"type":"Number","label":"User ID","name":"userId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the user to update."}
   * @paramDef {"type":"String","label":"First Name","name":"firstname","description":"New first name of the user."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastname","description":"New last name of the user."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New email address. Must be unique in the instance."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"New telephone number of the user."}
   * @paramDef {"type":"Array<String>","label":"Roles","name":"roles","description":"Role names to assign, replacing the current roles, e.g. Customer, Agent, Admin."}
   *
   * @returns {Object}
   * @sampleResult {"id":45,"login":"jane@example.com","firstname":"Jane","lastname":"Doe","email":"jane@example.com","phone":"+1 555 0199","active":true,"role_ids":[2],"created_at":"2026-07-13T10:00:00Z","updated_at":"2026-07-13T13:00:00Z"}
   */
  async updateUser(userId, firstname, lastname, email, phone, roles) {
    const logTag = '[updateUser]'

    return await this.#apiRequest({
      logTag,
      path: `/users/${ userId }`,
      method: 'put',
      body: clean({
        firstname,
        lastname,
        email,
        phone,
        roles,
      }),
    })
  }

  /**
   * @operationName Search Users
   * @category Users
   * @description Searches users using Zammad's full-text query syntax. The query can be plain text (matches name, login, and email) or field-scoped conditions, e.g. email:jane@example.com or firstname:Jane AND active:true. Returns up to Page Size results per page.
   * @route GET /search-users
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Search query, e.g. \"Jane\" or email:jane@example.com."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results per page. Defaults to 50."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":45,"login":"jane@example.com","firstname":"Jane","lastname":"Doe","email":"jane@example.com","organization_id":9,"active":true,"created_at":"2026-07-13T10:00:00Z"}]
   */
  async searchUsers(query, page, perPage) {
    const logTag = '[searchUsers]'

    return await this.#apiRequest({
      logTag,
      path: '/users/search',
      method: 'get',
      query: {
        query,
        page: page || 1,
        per_page: perPage || DEFAULT_PER_PAGE,
      },
    })
  }

  /**
   * @operationName Get Current User
   * @category Users
   * @description Retrieves the profile of the user that owns the API token in use. This is the simplest way to verify that the server URL and API token are configured correctly.
   * @route GET /get-current-user
   *
   * @returns {Object}
   * @sampleResult {"id":1,"login":"admin@example.com","firstname":"Admin","lastname":"User","email":"admin@example.com","active":true,"role_ids":[1,2],"created_at":"2026-01-01T09:00:00Z","updated_at":"2026-07-01T09:00:00Z"}
   */
  async getCurrentUser() {
    const logTag = '[getCurrentUser]'

    return await this.#apiRequest({
      logTag,
      path: '/users/me',
      method: 'get',
    })
  }

  // ==================== Organizations ====================

  /**
   * @operationName Create Organization
   * @category Organizations
   * @description Creates a new organization in Zammad. Organizations group related users (customers) together. Domain-based assignment can automatically link users whose email matches the organization's domain when Domain Assignment is enabled.
   * @route POST /create-organization
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the organization. Must be unique in the instance."}
   * @paramDef {"type":"String","label":"Domain","name":"domain","description":"Email domain associated with the organization, e.g. example.com."}
   * @paramDef {"type":"Boolean","label":"Domain Assignment","name":"domainAssignment","uiComponent":{"type":"TOGGLE"},"description":"When enabled, users with a matching email domain are linked to this organization automatically."}
   * @paramDef {"type":"String","label":"Note","name":"note","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Internal note about the organization."}
   *
   * @returns {Object}
   * @sampleResult {"id":9,"name":"Acme Inc","domain":"acme.com","domain_assignment":false,"shared":true,"active":true,"note":"Key customer","created_at":"2026-07-13T10:00:00Z","updated_at":"2026-07-13T10:00:00Z"}
   */
  async createOrganization(name, domain, domainAssignment, note) {
    const logTag = '[createOrganization]'

    return await this.#apiRequest({
      logTag,
      path: '/organizations',
      method: 'post',
      body: clean({
        name,
        domain,
        domain_assignment: domainAssignment === undefined ? undefined : Boolean(domainAssignment),
        note,
      }),
    })
  }

  /**
   * @operationName Get Organization
   * @category Organizations
   * @description Retrieves a single organization by its ID, including its name, domain, note, and active state.
   * @route GET /get-organization
   *
   * @paramDef {"type":"Number","label":"Organization ID","name":"organizationId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the organization to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":9,"name":"Acme Inc","domain":"acme.com","domain_assignment":false,"shared":true,"active":true,"note":"Key customer","member_ids":[45],"created_at":"2026-07-13T10:00:00Z","updated_at":"2026-07-13T10:00:00Z"}
   */
  async getOrganization(organizationId) {
    const logTag = '[getOrganization]'

    return await this.#apiRequest({
      logTag,
      path: `/organizations/${ organizationId }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Organizations
   * @category Organizations
   * @description Lists organizations in the Zammad instance with pagination, including their names, domains, and notes. For finding a specific organization use Search Organizations.
   * @route GET /list-organizations
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of organizations per page. Defaults to 50."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":9,"name":"Acme Inc","domain":"acme.com","domain_assignment":false,"shared":true,"active":true,"created_at":"2026-07-13T10:00:00Z","updated_at":"2026-07-13T10:00:00Z"}]
   */
  async listOrganizations(page, perPage) {
    const logTag = '[listOrganizations]'

    return await this.#apiRequest({
      logTag,
      path: '/organizations',
      method: 'get',
      query: {
        page: page || 1,
        per_page: perPage || DEFAULT_PER_PAGE,
      },
    })
  }

  /**
   * @operationName Update Organization
   * @category Organizations
   * @description Updates an existing organization. Only the provided fields are changed; all other fields keep their current values.
   * @route PUT /update-organization
   *
   * @paramDef {"type":"Number","label":"Organization ID","name":"organizationId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the organization to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New name of the organization. Must be unique in the instance."}
   * @paramDef {"type":"String","label":"Domain","name":"domain","description":"New email domain associated with the organization."}
   * @paramDef {"type":"Boolean","label":"Domain Assignment","name":"domainAssignment","uiComponent":{"type":"TOGGLE"},"description":"When enabled, users with a matching email domain are linked to this organization automatically."}
   * @paramDef {"type":"String","label":"Note","name":"note","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New internal note about the organization."}
   *
   * @returns {Object}
   * @sampleResult {"id":9,"name":"Acme Inc","domain":"acme.io","domain_assignment":true,"shared":true,"active":true,"note":"Updated note","created_at":"2026-07-13T10:00:00Z","updated_at":"2026-07-13T13:00:00Z"}
   */
  async updateOrganization(organizationId, name, domain, domainAssignment, note) {
    const logTag = '[updateOrganization]'

    return await this.#apiRequest({
      logTag,
      path: `/organizations/${ organizationId }`,
      method: 'put',
      body: clean({
        name,
        domain,
        domain_assignment: domainAssignment === undefined ? undefined : Boolean(domainAssignment),
        note,
      }),
    })
  }

  /**
   * @operationName Search Organizations
   * @category Organizations
   * @description Searches organizations using Zammad's full-text query syntax. The query can be plain text (matches name and domain) or field-scoped conditions, e.g. name:Acme or domain:acme.com. Returns up to Page Size results per page.
   * @route GET /search-organizations
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Search query, e.g. \"Acme\" or domain:acme.com."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results per page. Defaults to 50."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":9,"name":"Acme Inc","domain":"acme.com","domain_assignment":false,"shared":true,"active":true,"created_at":"2026-07-13T10:00:00Z"}]
   */
  async searchOrganizations(query, page, perPage) {
    const logTag = '[searchOrganizations]'

    return await this.#apiRequest({
      logTag,
      path: '/organizations/search',
      method: 'get',
      query: {
        query,
        page: page || 1,
        per_page: perPage || DEFAULT_PER_PAGE,
      },
    })
  }

  // ==================== Groups ====================

  /**
   * @operationName List Groups
   * @category Groups
   * @description Lists all agent groups in the Zammad instance, including their names, active state, and assignment/notification settings. Groups organize tickets and control which agents handle them.
   * @route GET /list-groups
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":1,"name":"Users","active":true,"assignment_timeout":null,"follow_up_possible":"yes","note":"Default group","created_at":"2026-01-01T09:00:00Z","updated_at":"2026-07-01T09:00:00Z"}]
   */
  async listGroups() {
    const logTag = '[listGroups]'

    return await this.#apiRequest({
      logTag,
      path: '/groups',
      method: 'get',
    })
  }

  // ==================== Tags ====================

  /**
   * @operationName Add Tag
   * @category Tags
   * @description Adds a tag to an object (by default a ticket). Provide the object type ("Ticket"), the object's numeric ID, and the tag text. If the tag does not yet exist in the instance it is created automatically.
   * @route POST /add-tag
   *
   * @paramDef {"type":"Number","label":"Object ID","name":"objectId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the object (e.g. the ticket ID) to tag."}
   * @paramDef {"type":"String","label":"Tag","name":"tag","required":true,"description":"Tag text to add, e.g. \"vip\" or \"login-issue\"."}
   * @paramDef {"type":"String","label":"Object Type","name":"object","defaultValue":"Ticket","uiComponent":{"type":"DROPDOWN","options":{"values":["Ticket"]}},"description":"Type of object to tag. Defaults to Ticket."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"objectId":123,"object":"Ticket","tag":"vip"}
   */
  async addTag(objectId, tag, object) {
    const logTag = '[addTag]'

    await this.#apiRequest({
      logTag,
      path: '/tags/add',
      method: 'post',
      body: clean({
        object: object || 'Ticket',
        o_id: objectId,
        item: tag,
      }),
    })

    return { success: true, objectId, object: object || 'Ticket', tag }
  }

  /**
   * @operationName Remove Tag
   * @category Tags
   * @description Removes a tag from an object (by default a ticket). Provide the object type ("Ticket"), the object's numeric ID, and the tag text to remove.
   * @route DELETE /remove-tag
   *
   * @paramDef {"type":"Number","label":"Object ID","name":"objectId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the object (e.g. the ticket ID) to remove the tag from."}
   * @paramDef {"type":"String","label":"Tag","name":"tag","required":true,"description":"Tag text to remove."}
   * @paramDef {"type":"String","label":"Object Type","name":"object","defaultValue":"Ticket","uiComponent":{"type":"DROPDOWN","options":{"values":["Ticket"]}},"description":"Type of object. Defaults to Ticket."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"objectId":123,"object":"Ticket","tag":"vip"}
   */
  async removeTag(objectId, tag, object) {
    const logTag = '[removeTag]'

    await this.#apiRequest({
      logTag,
      path: '/tags/remove',
      method: 'delete',
      body: clean({
        object: object || 'Ticket',
        o_id: objectId,
        item: tag,
      }),
    })

    return { success: true, objectId, object: object || 'Ticket', tag }
  }

  /**
   * @operationName List Tags For Object
   * @category Tags
   * @description Lists all tags currently applied to an object (by default a ticket). Provide the object type ("Ticket") and the object's numeric ID.
   * @route GET /list-tags-for-object
   *
   * @paramDef {"type":"Number","label":"Object ID","name":"objectId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the object (e.g. the ticket ID) whose tags to list."}
   * @paramDef {"type":"String","label":"Object Type","name":"object","defaultValue":"Ticket","uiComponent":{"type":"DROPDOWN","options":{"values":["Ticket"]}},"description":"Type of object. Defaults to Ticket."}
   *
   * @returns {Object}
   * @sampleResult {"tags":["vip","login-issue"]}
   */
  async listTagsForObject(objectId, object) {
    const logTag = '[listTagsForObject]'

    return await this.#apiRequest({
      logTag,
      path: '/tags',
      method: 'get',
      query: {
        object: object || 'Ticket',
        o_id: objectId,
      },
    })
  }

  // ==================== Dictionaries ====================

  /**
   * @typedef {Object} getGroupsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter groups by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused; all groups are returned in one page)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Groups Dictionary
   * @description Provides a searchable list of Zammad groups for selecting a ticket's owning group. The option value is the group ID.
   * @route POST /get-groups-dictionary
   * @paramDef {"type":"getGroupsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Users","value":"1","note":"Active"}],"cursor":null}
   */
  async getGroupsDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getGroupsDictionary]'

    const groups = await this.#apiRequest({
      logTag,
      path: '/groups',
      method: 'get',
    })

    const searchText = (search || '').toLowerCase()

    const items = (groups || [])
      .filter(group => !searchText || (group.name || '').toLowerCase().includes(searchText))
      .map(group => ({
        label: group.name,
        value: String(group.id),
        note: group.active ? 'Active' : 'Inactive',
      }))

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} getUsersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter users by name, login, or email."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number of the next page)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Users Dictionary
   * @description Provides a searchable list of Zammad users for selecting a customer or owner. The option value is the user ID. Uses full-text search when a search term is provided.
   * @route POST /get-users-dictionary
   * @paramDef {"type":"getUsersDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Jane Doe","value":"45","note":"jane@example.com"}],"cursor":"2"}
   */
  async getUsersDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getUsersDictionary]'
    const page = Number(cursor) || 1
    const perPage = 50

    const users = await this.#apiRequest({
      logTag,
      path: search ? '/users/search' : '/users',
      method: 'get',
      query: {
        query: search || undefined,
        page,
        per_page: perPage,
      },
    })

    const items = (users || []).map(user => {
      const name = [user.firstname, user.lastname].filter(Boolean).join(' ').trim()

      return {
        label: name || user.login || user.email || String(user.id),
        value: String(user.id),
        note: user.email || user.login || undefined,
      }
    })

    return {
      items,
      cursor: (users || []).length === perPage ? String(page + 1) : null,
    }
  }

  /**
   * @typedef {Object} getStatesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter ticket states by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused; all states are returned in one page)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get States Dictionary
   * @description Provides a list of the ticket states configured in the Zammad instance for selecting a ticket state. The option value is the state name (e.g. open, closed), which is accepted directly by the ticket operations.
   * @route POST /get-states-dictionary
   * @paramDef {"type":"getStatesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"open","value":"open","note":"Active"}],"cursor":null}
   */
  async getStatesDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getStatesDictionary]'

    const states = await this.#apiRequest({
      logTag,
      path: '/ticket_states',
      method: 'get',
    })

    const searchText = (search || '').toLowerCase()

    const items = (states || [])
      .filter(state => !searchText || (state.name || '').toLowerCase().includes(searchText))
      .map(state => ({
        label: state.name,
        value: state.name,
        note: state.active ? 'Active' : 'Inactive',
      }))

    return { items, cursor: null }
  }
}

Flowrunner.ServerCode.addService(ZammadService, [
  {
    name: 'serverUrl',
    displayName: 'Server URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Zammad instance URL, e.g. https://support.example.com (strip any trailing slash).',
  },
  {
    name: 'apiToken',
    displayName: 'API Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'A Zammad access token. Create one under Profile → Token Access with the permissions the actions require.',
  },
])
