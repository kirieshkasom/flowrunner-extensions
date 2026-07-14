const logger = {
  info: (...args) => console.log('[HaloPSA] info:', ...args),
  debug: (...args) => console.log('[HaloPSA] debug:', ...args),
  error: (...args) => console.log('[HaloPSA] error:', ...args),
  warn: (...args) => console.log('[HaloPSA] warn:', ...args),
}

const TOKEN_LIFETIME_SECONDS = 3600 // Halo access tokens default to ~1 hour
const TOKEN_REFRESH_MARGIN_MS = 60000

/**
 * @integrationName HaloPSA
 * @integrationIcon /icon.svg
 */
class HaloPSA {
  constructor(config) {
    // Strip any trailing slash so URL concatenation is predictable.
    this.resourceUrl = (config.resourceUrl || '').replace(/\/+$/, '')
    this.authUrl = (config.authUrl || '').replace(/\/+$/, '')
    this.tenant = (config.tenant || '').trim()
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret

    // The API is always served from {Resource URL}/api.
    this.apiBaseUrl = `${ this.resourceUrl }/api`

    // Token endpoint. Halo hosted tenants may expose a dedicated Authorisation Server that is a
    // different host from the Resource Server; in that case tokens are minted at
    // {Auth URL}/token?tenant={tenant}. When no separate Auth URL is configured, tokens are
    // minted from the Resource URL at {Resource URL}/auth/token (works for most tenants and all
    // on-premise installs).
    if (this.authUrl) {
      const tenantQuery = this.tenant ? `?tenant=${ encodeURIComponent(this.tenant) }` : ''

      this.tokenUrl = `${ this.authUrl }/token${ tenantQuery }`
    } else {
      this.tokenUrl = `${ this.resourceUrl }/auth/token`
    }
  }

  // ==================================================================================
  // Internal helpers
  // ==================================================================================

  // Mints a client_credentials access token on the first API call of each invocation and
  // caches it in memory for the lifetime of this service instance. This is a machine-to-machine
  // token (like an API key), NOT an interactive OAuth connection, so it is minted here rather
  // than through the platform's OAuth system methods.
  async #getToken() {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) {
      return this.accessToken
    }

    logger.debug('requesting a new access token (client_credentials)')

    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: 'all',
    })

    let response

    try {
      response = await Flowrunner.Request.post(this.tokenUrl)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())
    } catch (error) {
      const message = error.body?.error_description || error.body?.error || error.message

      throw new Error(`Failed to obtain a HaloPSA access token: ${ message }. Verify the Resource URL, Client ID and Client Secret.`)
    }

    if (!response.access_token) {
      throw new Error('HaloPSA token endpoint did not return an access token')
    }

    this.accessToken = response.access_token
    this.accessTokenExpiresAt = Date.now() + (response.expires_in || TOKEN_LIFETIME_SECONDS) * 1000

    return this.accessToken
  }

  // Single request helper. `body` is sent verbatim: Halo write endpoints expect a JSON ARRAY of
  // objects even for a single record, and callers pass that array through unchanged. Undefined
  // query values are stripped so blank optional params never leak into the query string.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    const accessToken = await this.#getToken()

    const cleanedQuery = {}

    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== '') {
        cleanedQuery[key] = value
      }
    }

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ 'Authorization': `Bearer ${ accessToken }`, 'Content-Type': 'application/json' })
        .query(cleanedQuery)

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.message || error.body?.error || error.body?.error_description ||
        (typeof error.body === 'string' ? error.body : undefined) || error.message
      const status = error.status || error.statusCode

      logger.error(`${ logTag } - failed (${ status }): ${ message }`)

      throw new Error(`HaloPSA API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Halo list endpoints return { record_count, <collection>: [...] }; the collection key differs
  // per resource. Normalize to a stable { items, count } shape.
  #unwrapList(response, collectionKey) {
    return {
      items: response?.[collectionKey] || [],
      count: response?.record_count ?? (response?.[collectionKey]?.length || 0),
    }
  }

  // ==================================================================================
  // Tickets
  // ==================================================================================

  /**
   * @operationName Get Tickets
   * @description Lists tickets from HaloPSA with optional full-text search and filtering by client. Supports pagination and can restrict results to open tickets only. Returns the matching tickets along with the total record count for building pages.
   * @category Tickets
   * @route GET /tickets
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Free-text search across ticket summary and details."}
   * @paramDef {"type":"Number","label":"Client ID","name":"clientId","dictionary":"getClientsDictionary","description":"Only return tickets belonging to this client."}
   * @paramDef {"type":"Boolean","label":"Open Only","name":"openOnly","defaultValue":false,"uiComponent":{"type":"TOGGLE"},"description":"When enabled, only tickets in an open (non-closed) status are returned."}
   * @paramDef {"type":"Number","label":"Page Number","name":"pageNo","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (starts at 1). Requires Page Size to enable pagination."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of tickets to return per page. Defaults to Halo's server-side limit when omitted."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":1234,"summary":"Email not working","status_id":1,"client_id":12,"client_name":"Acme Inc","tickettype_id":1,"dateoccurred":"2026-07-14T10:00:00Z"}],"count":57}
   */
  async getTickets(search, clientId, openOnly, pageNo, pageSize) {
    const usePaging = pageNo !== undefined && pageNo !== null && pageSize !== undefined && pageSize !== null

    const response = await this.#apiRequest({
      url: `${ this.apiBaseUrl }/Tickets`,
      query: {
        search: search || undefined,
        client_id: clientId || undefined,
        open_only: openOnly ? true : undefined,
        // NOTE: Halo's list pagination flag is the (Halo-specific) misspelling "pageinate",
        // NOT "paginate". Using "paginate" is silently ignored and pagination never engages.
        pageinate: usePaging ? true : undefined,
        page_no: usePaging ? pageNo : undefined,
        page_size: usePaging ? pageSize : undefined,
      },
      logTag: 'getTickets',
    })

    return this.#unwrapList(response, 'tickets')
  }

  /**
   * @operationName Get Ticket
   * @description Retrieves a single HaloPSA ticket by its ID, including its summary, details, status, priority, client, site, assigned agent and custom fields.
   * @category Tickets
   * @route GET /tickets/get
   * @paramDef {"type":"Number","label":"Ticket ID","name":"ticketId","required":true,"description":"Unique identifier of the ticket."}
   * @returns {Object}
   * @sampleResult {"id":1234,"summary":"Email not working","details":"User cannot send email.","status_id":1,"client_id":12,"client_name":"Acme Inc","tickettype_id":1,"agent_id":5,"dateoccurred":"2026-07-14T10:00:00Z"}
   */
  async getTicket(ticketId) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/Tickets/${ ticketId }`,
      logTag: 'getTicket',
    })
  }

  /**
   * @operationName Create Ticket
   * @description Creates a new ticket in HaloPSA for a client. Requires a summary, details and the client the ticket belongs to; optionally sets the ticket type, site, requesting end user, assigned agent, priority and status. Returns the created ticket.
   * @category Tickets
   * @route POST /tickets
   * @paramDef {"type":"String","label":"Summary","name":"summary","required":true,"description":"Short one-line summary (subject) of the ticket."}
   * @paramDef {"type":"String","label":"Details","name":"details","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Full description of the issue or request."}
   * @paramDef {"type":"Number","label":"Client ID","name":"clientId","required":true,"dictionary":"getClientsDictionary","description":"Client the ticket belongs to."}
   * @paramDef {"type":"Number","label":"Ticket Type ID","name":"tickettypeId","description":"ID of the ticket type. When omitted, Halo applies the default ticket type."}
   * @paramDef {"type":"Number","label":"Site ID","name":"siteId","description":"ID of the client site the ticket relates to."}
   * @paramDef {"type":"Number","label":"End User ID","name":"userId","description":"ID of the requesting end user (contact)."}
   * @paramDef {"type":"Number","label":"Agent ID","name":"agentId","dictionary":"getAgentsDictionary","description":"Agent to assign the ticket to."}
   * @paramDef {"type":"Number","label":"Priority ID","name":"priorityId","description":"ID of the priority to set on the ticket."}
   * @paramDef {"type":"Number","label":"Status ID","name":"statusId","description":"ID of the status to set on the ticket."}
   * @returns {Object}
   * @sampleResult {"id":1235,"summary":"New laptop request","status_id":1,"client_id":12,"tickettype_id":1,"agent_id":5,"dateoccurred":"2026-07-14T10:05:00Z"}
   */
  async createTicket(summary, details, clientId, tickettypeId, siteId, userId, agentId, priorityId, statusId) {
    const ticket = {
      summary,
      details,
      client_id: Number(clientId),
    }

    if (tickettypeId !== undefined && tickettypeId !== null) ticket.tickettype_id = Number(tickettypeId)
    if (siteId !== undefined && siteId !== null) ticket.site_id = Number(siteId)
    if (userId !== undefined && userId !== null) ticket.user_id = Number(userId)
    if (agentId !== undefined && agentId !== null) ticket.agent_id = Number(agentId)
    if (priorityId !== undefined && priorityId !== null) ticket.priority_id = Number(priorityId)
    if (statusId !== undefined && statusId !== null) ticket.status_id = Number(statusId)

    // Halo POST endpoints expect a JSON array of objects even for a single record.
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/Tickets`,
      method: 'post',
      body: [ticket],
      logTag: 'createTicket',
    })
  }

  /**
   * @operationName Update Ticket
   * @description Updates an existing HaloPSA ticket. Only the fields you provide are changed: summary, details, status, priority or assigned agent. The ticket ID is required to identify which ticket to update. Returns the updated ticket.
   * @category Tickets
   * @route PUT /tickets
   * @paramDef {"type":"Number","label":"Ticket ID","name":"ticketId","required":true,"description":"Unique identifier of the ticket to update."}
   * @paramDef {"type":"String","label":"Summary","name":"summary","description":"New one-line summary for the ticket."}
   * @paramDef {"type":"String","label":"Details","name":"details","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New full description for the ticket."}
   * @paramDef {"type":"Number","label":"Status ID","name":"statusId","description":"ID of the new status."}
   * @paramDef {"type":"Number","label":"Priority ID","name":"priorityId","description":"ID of the new priority."}
   * @paramDef {"type":"Number","label":"Agent ID","name":"agentId","dictionary":"getAgentsDictionary","description":"Agent to reassign the ticket to."}
   * @returns {Object}
   * @sampleResult {"id":1234,"summary":"Email not working (resolved)","status_id":9,"client_id":12,"agent_id":5}
   */
  async updateTicket(ticketId, summary, details, statusId, priorityId, agentId) {
    const ticket = { id: Number(ticketId) }

    if (summary !== undefined && summary !== '') ticket.summary = summary
    if (details !== undefined && details !== '') ticket.details = details
    if (statusId !== undefined && statusId !== null) ticket.status_id = Number(statusId)
    if (priorityId !== undefined && priorityId !== null) ticket.priority_id = Number(priorityId)
    if (agentId !== undefined && agentId !== null) ticket.agent_id = Number(agentId)

    if (Object.keys(ticket).length === 1) {
      throw new Error('Nothing to update: provide at least one field besides the Ticket ID')
    }

    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/Tickets`,
      method: 'post',
      body: [ticket],
      logTag: 'updateTicket',
    })
  }

  /**
   * @operationName Delete Ticket
   * @description Permanently deletes a HaloPSA ticket by its ID. This action cannot be undone.
   * @category Tickets
   * @route DELETE /tickets
   * @paramDef {"type":"Number","label":"Ticket ID","name":"ticketId","required":true,"description":"Unique identifier of the ticket to delete."}
   * @returns {Object}
   * @sampleResult {"ticketId":1234,"deleted":true}
   */
  async deleteTicket(ticketId) {
    await this.#apiRequest({
      url: `${ this.apiBaseUrl }/Tickets/${ ticketId }`,
      method: 'delete',
      logTag: 'deleteTicket',
    })

    return { ticketId: Number(ticketId), deleted: true }
  }

  // ==================================================================================
  // Actions (ticket updates / notes)
  // ==================================================================================

  /**
   * @operationName Get Actions
   * @description Lists the actions logged against a HaloPSA ticket. Actions include agent notes, customer replies, status changes and other timeline events. Returns the actions for the given ticket along with the total record count.
   * @category Actions
   * @route GET /actions
   * @paramDef {"type":"Number","label":"Ticket ID","name":"ticketId","required":true,"description":"Ticket whose actions should be listed."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":9001,"ticket_id":1234,"note":"Called the customer back.","outcome":"Phone Call","who":"Alex Agent","actiondatecreated":"2026-07-14T11:00:00Z"}],"count":3}
   */
  async getActions(ticketId) {
    const response = await this.#apiRequest({
      url: `${ this.apiBaseUrl }/Actions`,
      query: { ticket_id: ticketId },
      logTag: 'getActions',
    })

    return this.#unwrapList(response, 'actions')
  }

  /**
   * @operationName Create Action
   * @description Adds an action to a HaloPSA ticket, such as an agent note or a customer-facing update. The outcome labels the type of action (e.g. Note, Email, Phone Call). Optionally marks the note as private (hidden from the end user). Returns the created action.
   * @category Actions
   * @route POST /actions
   * @paramDef {"type":"Number","label":"Ticket ID","name":"ticketId","required":true,"description":"Ticket to add the action to."}
   * @paramDef {"type":"String","label":"Note","name":"note","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Body text of the action. HTML is supported."}
   * @paramDef {"type":"String","label":"Outcome","name":"outcome","defaultValue":"Note","description":"Label describing the action type, e.g. Note, Email, Phone Call. Defaults to Note."}
   * @paramDef {"type":"Boolean","label":"Private Note","name":"hiddenFromUser","defaultValue":false,"uiComponent":{"type":"TOGGLE"},"description":"When enabled, the action is a private note that is not visible to the end user."}
   * @returns {Object}
   * @sampleResult {"id":9002,"ticket_id":1234,"note":"Investigating the issue.","outcome":"Note","actiondatecreated":"2026-07-14T11:05:00Z"}
   */
  async createAction(ticketId, note, outcome, hiddenFromUser) {
    const action = {
      ticket_id: Number(ticketId),
      note,
      outcome: outcome || 'Note',
    }

    if (hiddenFromUser) {
      action.hiddenfromuser = true
    }

    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/Actions`,
      method: 'post',
      body: [action],
      logTag: 'createAction',
    })
  }

  // ==================================================================================
  // Clients
  // ==================================================================================

  /**
   * @operationName Get Clients
   * @description Lists clients (customer organizations) in HaloPSA with optional full-text search. Supports pagination. Returns matching clients and the total record count.
   * @category Clients
   * @route GET /clients
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Free-text search across client names."}
   * @paramDef {"type":"Number","label":"Page Number","name":"pageNo","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (starts at 1). Requires Page Size to enable pagination."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of clients to return per page. Defaults to Halo's server-side limit when omitted."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":12,"name":"Acme Inc","inactive":false,"toplevel_name":"Acme Group"}],"count":8}
   */
  async getClients(search, pageNo, pageSize) {
    const usePaging = pageNo !== undefined && pageNo !== null && pageSize !== undefined && pageSize !== null

    const response = await this.#apiRequest({
      url: `${ this.apiBaseUrl }/Client`,
      query: {
        search: search || undefined,
        pageinate: usePaging ? true : undefined,
        page_no: usePaging ? pageNo : undefined,
        page_size: usePaging ? pageSize : undefined,
      },
      logTag: 'getClients',
    })

    return this.#unwrapList(response, 'clients')
  }

  /**
   * @operationName Get Client
   * @description Retrieves a single HaloPSA client (customer organization) by its ID, including name, status, top-level parent and account details.
   * @category Clients
   * @route GET /clients/get
   * @paramDef {"type":"Number","label":"Client ID","name":"clientId","required":true,"dictionary":"getClientsDictionary","description":"Unique identifier of the client."}
   * @returns {Object}
   * @sampleResult {"id":12,"name":"Acme Inc","inactive":false,"toplevel_id":3,"toplevel_name":"Acme Group","website":"https://acme.example.com"}
   */
  async getClient(clientId) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/Client/${ clientId }`,
      logTag: 'getClient',
    })
  }

  /**
   * @operationName Create Client
   * @description Creates a new client (customer organization) in HaloPSA. Requires a name; optionally sets the website, main contact email and the top-level parent client for hierarchical structures. Returns the created client.
   * @category Clients
   * @route POST /clients
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the client organization."}
   * @paramDef {"type":"String","label":"Website","name":"website","description":"Client website URL."}
   * @paramDef {"type":"String","label":"Main Contact Email","name":"email","description":"Primary email address for the client."}
   * @paramDef {"type":"Number","label":"Top Level ID","name":"toplevelId","description":"ID of the top-level parent client this client sits under."}
   * @returns {Object}
   * @sampleResult {"id":13,"name":"Globex Corp","inactive":false,"website":"https://globex.example.com"}
   */
  async createClient(name, website, email, toplevelId) {
    const client = { name }

    if (website !== undefined && website !== '') client.website = website
    if (email !== undefined && email !== '') client.email = email
    if (toplevelId !== undefined && toplevelId !== null) client.toplevel_id = Number(toplevelId)

    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/Client`,
      method: 'post',
      body: [client],
      logTag: 'createClient',
    })
  }

  /**
   * @operationName Update Client
   * @description Updates an existing HaloPSA client. Only the fields you provide are changed: name, website or main contact email. The client ID is required. Returns the updated client.
   * @category Clients
   * @route PUT /clients
   * @paramDef {"type":"Number","label":"Client ID","name":"clientId","required":true,"dictionary":"getClientsDictionary","description":"Unique identifier of the client to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New client name."}
   * @paramDef {"type":"String","label":"Website","name":"website","description":"New client website URL."}
   * @paramDef {"type":"String","label":"Main Contact Email","name":"email","description":"New primary email address for the client."}
   * @returns {Object}
   * @sampleResult {"id":12,"name":"Acme International","website":"https://acme.example.com"}
   */
  async updateClient(clientId, name, website, email) {
    const client = { id: Number(clientId) }

    if (name !== undefined && name !== '') client.name = name
    if (website !== undefined && website !== '') client.website = website
    if (email !== undefined && email !== '') client.email = email

    if (Object.keys(client).length === 1) {
      throw new Error('Nothing to update: provide at least one field besides the Client ID')
    }

    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/Client`,
      method: 'post',
      body: [client],
      logTag: 'updateClient',
    })
  }

  // ==================================================================================
  // Sites
  // ==================================================================================

  /**
   * @operationName Get Sites
   * @description Lists sites (physical or logical locations) in HaloPSA, optionally filtered to a single client. Supports full-text search. Returns matching sites and the total record count.
   * @category Sites
   * @route GET /sites
   * @paramDef {"type":"Number","label":"Client ID","name":"clientId","dictionary":"getClientsDictionary","description":"Only return sites belonging to this client."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Free-text search across site names."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":45,"name":"Head Office","client_id":12,"client_name":"Acme Inc"}],"count":2}
   */
  async getSites(clientId, search) {
    const response = await this.#apiRequest({
      url: `${ this.apiBaseUrl }/Site`,
      query: {
        client_id: clientId || undefined,
        search: search || undefined,
      },
      logTag: 'getSites',
    })

    return this.#unwrapList(response, 'sites')
  }

  // ==================================================================================
  // Users (end users / contacts)
  // ==================================================================================

  /**
   * @operationName Get Users
   * @description Lists end users (customer contacts) in HaloPSA with optional full-text search and filtering by client. Returns matching users and the total record count.
   * @category Users
   * @route GET /users
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Free-text search across user names and email addresses."}
   * @paramDef {"type":"Number","label":"Client ID","name":"clientId","dictionary":"getClientsDictionary","description":"Only return users belonging to this client."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":88,"name":"Jane Doe","emailaddress":"jane@acme.example.com","client_id":12,"site_id":45}],"count":14}
   */
  async getUsers(search, clientId) {
    const response = await this.#apiRequest({
      url: `${ this.apiBaseUrl }/Users`,
      query: {
        search: search || undefined,
        client_id: clientId || undefined,
      },
      logTag: 'getUsers',
    })

    return this.#unwrapList(response, 'users')
  }

  /**
   * @operationName Get User
   * @description Retrieves a single HaloPSA end user (customer contact) by their ID, including name, email, phone, client and site.
   * @category Users
   * @route GET /users/get
   * @paramDef {"type":"Number","label":"User ID","name":"userId","required":true,"description":"Unique identifier of the end user."}
   * @returns {Object}
   * @sampleResult {"id":88,"name":"Jane Doe","emailaddress":"jane@acme.example.com","phonenumber":"+1 555 0100","client_id":12,"site_id":45}
   */
  async getUser(userId) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/Users/${ userId }`,
      logTag: 'getUser',
    })
  }

  /**
   * @operationName Create User
   * @description Creates a new end user (customer contact) in HaloPSA under a specific site. Requires a name, email address and site; optionally sets a phone number. Returns the created user.
   * @category Users
   * @route POST /users
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Full name of the end user."}
   * @paramDef {"type":"String","label":"Email Address","name":"emailAddress","required":true,"description":"Email address of the end user."}
   * @paramDef {"type":"Number","label":"Site ID","name":"siteId","required":true,"description":"ID of the site the user belongs to. Get site IDs from the Get Sites operation."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumber","description":"Phone number of the end user."}
   * @returns {Object}
   * @sampleResult {"id":89,"name":"John Smith","emailaddress":"john@acme.example.com","site_id":45,"client_id":12}
   */
  async createUser(name, emailAddress, siteId, phoneNumber) {
    const user = {
      name,
      emailaddress: emailAddress,
      site_id: Number(siteId),
    }

    if (phoneNumber !== undefined && phoneNumber !== '') user.phonenumber = phoneNumber

    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/Users`,
      method: 'post',
      body: [user],
      logTag: 'createUser',
    })
  }

  // ==================================================================================
  // Assets
  // ==================================================================================

  /**
   * @operationName Get Assets
   * @description Lists assets (configuration items such as devices, servers and software) in HaloPSA, optionally filtered by client. Supports full-text search. Returns matching assets and the total record count.
   * @category Assets
   * @route GET /assets
   * @paramDef {"type":"Number","label":"Client ID","name":"clientId","dictionary":"getClientsDictionary","description":"Only return assets belonging to this client."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Free-text search across asset names and tags."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":301,"inventory_number":"LAP-001","key_field":"Jane's Laptop","client_id":12,"assettype_id":1}],"count":22}
   */
  async getAssets(clientId, search) {
    const response = await this.#apiRequest({
      url: `${ this.apiBaseUrl }/Asset`,
      query: {
        client_id: clientId || undefined,
        search: search || undefined,
      },
      logTag: 'getAssets',
    })

    return this.#unwrapList(response, 'assets')
  }

  /**
   * @operationName Get Asset
   * @description Retrieves a single HaloPSA asset (configuration item) by its ID, including its inventory number, type, client, site and field values.
   * @category Assets
   * @route GET /assets/get
   * @paramDef {"type":"Number","label":"Asset ID","name":"assetId","required":true,"description":"Unique identifier of the asset."}
   * @returns {Object}
   * @sampleResult {"id":301,"inventory_number":"LAP-001","key_field":"Jane's Laptop","client_id":12,"site_id":45,"assettype_id":1}
   */
  async getAsset(assetId) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/Asset/${ assetId }`,
      logTag: 'getAsset',
    })
  }

  /**
   * @operationName Create Asset
   * @description Creates a new asset (configuration item) in HaloPSA for a client. Requires an asset type and client; optionally sets an inventory number and the site the asset is located at. Returns the created asset.
   * @category Assets
   * @route POST /assets
   * @paramDef {"type":"Number","label":"Asset Type ID","name":"assettypeId","required":true,"description":"ID of the asset type (configuration item type) to create."}
   * @paramDef {"type":"Number","label":"Client ID","name":"clientId","required":true,"dictionary":"getClientsDictionary","description":"Client the asset belongs to."}
   * @paramDef {"type":"String","label":"Inventory Number","name":"inventoryNumber","description":"Inventory or asset tag number."}
   * @paramDef {"type":"Number","label":"Site ID","name":"siteId","description":"ID of the site the asset is located at."}
   * @returns {Object}
   * @sampleResult {"id":302,"inventory_number":"SRV-010","client_id":12,"assettype_id":2,"site_id":45}
   */
  async createAsset(assettypeId, clientId, inventoryNumber, siteId) {
    const asset = {
      assettype_id: Number(assettypeId),
      client_id: Number(clientId),
    }

    if (inventoryNumber !== undefined && inventoryNumber !== '') asset.inventory_number = inventoryNumber
    if (siteId !== undefined && siteId !== null) asset.site_id = Number(siteId)

    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/Asset`,
      method: 'post',
      body: [asset],
      logTag: 'createAsset',
    })
  }

  // ==================================================================================
  // Agents
  // ==================================================================================

  /**
   * @operationName Get Agents
   * @description Lists agents (HaloPSA staff / technicians) in your instance, including their name, email and active status. Returns the agents and the total record count.
   * @category Agents
   * @route GET /agents
   * @paramDef {"type":"Boolean","label":"Include Inactive","name":"includeInactive","defaultValue":false,"uiComponent":{"type":"TOGGLE"},"description":"When enabled, disabled/inactive agents are included in the results."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":5,"name":"Alex Agent","email":"alex@msp.example.com","isdisabled":false}],"count":6}
   */
  async getAgents(includeInactive) {
    const response = await this.#apiRequest({
      url: `${ this.apiBaseUrl }/Agent`,
      query: {
        includeenabled: true,
        includedisabled: includeInactive ? true : undefined,
      },
      logTag: 'getAgents',
    })

    // The Agent endpoint returns a bare array in most Halo versions; normalize either shape.
    if (Array.isArray(response)) {
      return { items: response, count: response.length }
    }

    return this.#unwrapList(response, 'agents')
  }

  // ==================================================================================
  // Invoices
  // ==================================================================================

  /**
   * @operationName Get Invoices
   * @description Lists invoices in HaloPSA, optionally filtered to a single client. Returns matching invoices with their totals and the total record count.
   * @category Invoices
   * @route GET /invoices
   * @paramDef {"type":"Number","label":"Client ID","name":"clientId","dictionary":"getClientsDictionary","description":"Only return invoices belonging to this client."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":700,"client_id":12,"client_name":"Acme Inc","total":1250.00,"invoice_date":"2026-07-01T00:00:00Z","posted":true}],"count":4}
   */
  async getInvoices(clientId) {
    const response = await this.#apiRequest({
      url: `${ this.apiBaseUrl }/Invoice`,
      query: { client_id: clientId || undefined },
      logTag: 'getInvoices',
    })

    return this.#unwrapList(response, 'invoices')
  }

  // ==================================================================================
  // Dictionaries
  // ==================================================================================

  /**
   * @typedef {Object} getClientsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to client names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Clients Dictionary
   * @description Lists HaloPSA clients for selection in dependent parameters such as the client on a ticket, user or asset.
   * @route POST /get-clients-dictionary
   * @paramDef {"type":"getClientsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Acme Inc","value":"12","note":"Acme Group"}],"cursor":"2"}
   */
  async getClientsDictionary(payload) {
    const { search, cursor } = payload || {}
    const pageSize = 50
    const pageNo = cursor ? Number(cursor) : 1

    const response = await this.#apiRequest({
      url: `${ this.apiBaseUrl }/Client`,
      query: {
        search: search || undefined,
        pageinate: true,
        page_no: pageNo,
        page_size: pageSize,
      },
      logTag: 'getClientsDictionary',
    })

    const { items, count } = this.#unwrapList(response, 'clients')

    const dictionaryItems = items.map(client => ({
      label: client.name,
      value: String(client.id),
      note: client.toplevel_name || undefined,
    }))

    const hasMore = pageNo * pageSize < count

    return { items: dictionaryItems, cursor: hasMore ? String(pageNo + 1) : undefined }
  }

  /**
   * @typedef {Object} getAgentsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to agent names and email addresses."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused; agents are returned in a single page)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Agents Dictionary
   * @description Lists HaloPSA agents (staff / technicians) for selection in assignment parameters such as the agent on a ticket.
   * @route POST /get-agents-dictionary
   * @paramDef {"type":"getAgentsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Alex Agent","value":"5","note":"alex@msp.example.com"}]}
   */
  async getAgentsDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ this.apiBaseUrl }/Agent`,
      query: { includeenabled: true },
      logTag: 'getAgentsDictionary',
    })

    const items = Array.isArray(response) ? response : (response?.agents || [])
    const searchText = (search || '').toLowerCase()

    const dictionaryItems = items
      .filter(agent => !searchText ||
        agent.name?.toLowerCase().includes(searchText) ||
        agent.email?.toLowerCase().includes(searchText))
      .map(agent => ({
        label: agent.name,
        value: String(agent.id),
        note: agent.email || undefined,
      }))

    return { items: dictionaryItems }
  }
}

Flowrunner.ServerCode.addService(HaloPSA, [
  {
    name: 'resourceUrl',
    displayName: 'Resource URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Halo Resource Server URL, e.g. https://yourcompany.halopsa.com (no trailing slash). Copy it from Configuration → Integrations → Halo API. The API is served from {Resource URL}/api. Unless a separate Authorisation Server is configured below, tokens are minted from {Resource URL}/auth/token.',
  },
  {
    name: 'authUrl',
    displayName: 'Authorisation Server URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Optional. Only set this if your Halo instance shows an Authorisation Server URL that differs from the Resource Server URL (some hosted tenants). When set, tokens are minted from {Authorisation Server URL}/token. Leave blank to use {Resource URL}/auth/token.',
  },
  {
    name: 'tenant',
    displayName: 'Tenant',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Optional. The Halo tenant name, required only when a separate Authorisation Server URL is used (it is passed as ?tenant=). Find it in Configuration → Integrations → Halo API.',
  },
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Client ID of a Halo API application. In Halo, go to Configuration → Integrations → Halo API and create/open an application with the Client Credentials authentication method.',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Client Secret of the Halo API application configured for Client Credentials, shown next to the Client ID in Configuration → Integrations → Halo API.',
  },
])
