const logger = {
  info: (...args) => console.log('[Help Scout] info:', ...args),
  debug: (...args) => console.log('[Help Scout] debug:', ...args),
  error: (...args) => console.log('[Help Scout] error:', ...args),
  warn: (...args) => console.log('[Help Scout] warn:', ...args),
}

const API_BASE_URL = 'https://api.helpscout.net/v2'
const TOKEN_URL = 'https://api.helpscout.net/v2/oauth2/token'

const TOKEN_LIFETIME_SECONDS = 172800 // Help Scout tokens live ~2 days
const TOKEN_REFRESH_MARGIN_MS = 60000

/**
 * @integrationName Help Scout
 * @integrationIcon /icon.png
 */
class HelpScout {
  constructor(config) {
    this.appId = config.appId
    this.appSecret = config.appSecret
  }

  // ==================================================================================
  // Internal helpers
  // ==================================================================================

  async #getAccessToken() {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) {
      return this.accessToken
    }

    logger.debug('requesting a new access token (client_credentials)')

    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.appId,
      client_secret: this.appSecret,
    })

    let response

    try {
      response = await Flowrunner.Request.post(TOKEN_URL)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())
    } catch (error) {
      const message = error.body?.error_description || error.body?.error || error.message

      throw new Error(`Failed to obtain a Help Scout access token: ${ message }. Check the App ID and App Secret.`)
    }

    if (!response.access_token) {
      throw new Error('Help Scout token endpoint did not return an access token')
    }

    this.accessToken = response.access_token
    this.accessTokenExpiresAt = Date.now() + (response.expires_in || TOKEN_LIFETIME_SECONDS) * 1000

    return this.accessToken
  }

  async #apiRequest({ url, method = 'get', body, query, logTag, rawResponse }) {
    const accessToken = await this.#getAccessToken()

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      let request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ 'Authorization': `Bearer ${ accessToken }`, 'Content-Type': 'application/json' })
        .query(query || {})

      // rawResponse resolves to { status, headers, body } instead of the bare body - needed
      // when the useful result is a response header (Help Scout returns the created id
      // in the Resource-Id header of an otherwise empty 201 response).
      if (rawResponse) {
        request = request.unwrapBody(false)
      }

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const details = (error.body?._embedded?.errors || [])
        .map(item => [item.path, item.message].filter(Boolean).join(': '))
        .join('; ')

      const message = [error.body?.message || error.message, details].filter(Boolean).join(' - ')

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Help Scout API error: ${ message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #getCreatedResourceId(rawResponse) {
    const headers = rawResponse?.headers || {}
    const key = Object.keys(headers).find(name => name.toLowerCase() === 'resource-id')

    return key ? Number(headers[key]) : null
  }

  #unwrapPage(response, embeddedKey) {
    return {
      items: response?._embedded?.[embeddedKey] || [],
      page: response?.page || null,
    }
  }

  #toIsoDate(value) {
    if (!value) {
      return undefined
    }

    const date = new Date(value)

    if (isNaN(date.getTime())) {
      throw new Error(`Invalid date value: "${ value }"`)
    }

    return date.toISOString()
  }

  async #patchConversation(conversationId, op, path, value, logTag) {
    await this.#apiRequest({
      url: `${ API_BASE_URL }/conversations/${ conversationId }`,
      method: 'patch',
      body: { op, path, value },
      rawResponse: true,
      logTag,
    })
  }

  async #putConversationTags(conversationId, tags, logTag) {
    await this.#apiRequest({
      url: `${ API_BASE_URL }/conversations/${ conversationId }/tags`,
      method: 'put',
      body: { tags },
      rawResponse: true,
      logTag,
    })
  }

  // ==================================================================================
  // Conversations
  // ==================================================================================

  /**
   * @operationName Create Conversation
   * @description Creates a new conversation in a Help Scout mailbox with an initial thread. The customer is identified by email and is created automatically if they do not exist yet. The initial thread can be a customer message (as if the customer wrote in), a reply from your team, or an internal note. Optionally applies tags and assigns the conversation to a user. Returns the newly created conversation.
   * @category Conversations
   * @route POST /conversations
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Subject line of the conversation."}
   * @paramDef {"type":"String","label":"Mailbox","name":"mailboxId","required":true,"dictionary":"getMailboxesDictionary","description":"Mailbox where the conversation is created."}
   * @paramDef {"type":"String","label":"Customer Email","name":"customerEmail","required":true,"description":"Email address of the customer the conversation is with. The customer is created automatically if not found."}
   * @paramDef {"type":"String","label":"Message Body","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text of the initial thread. HTML is supported for email conversations."}
   * @paramDef {"type":"String","label":"Thread Type","name":"threadType","defaultValue":"Customer","uiComponent":{"type":"DROPDOWN","options":{"values":["Customer","Reply","Note"]}},"description":"Type of the initial thread: Customer (message written by the customer), Reply (response from your team, sent to the customer), or Note (internal note visible only to your team)."}
   * @paramDef {"type":"String","label":"Type","name":"type","defaultValue":"Email","uiComponent":{"type":"DROPDOWN","options":{"values":["Email","Chat","Phone"]}},"description":"Conversation channel type."}
   * @paramDef {"type":"String","label":"Status","name":"status","defaultValue":"Active","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Pending","Closed"]}},"description":"Initial status of the conversation."}
   * @paramDef {"type":"String","label":"Customer First Name","name":"customerFirstName","description":"First name used when the customer has to be created."}
   * @paramDef {"type":"String","label":"Customer Last Name","name":"customerLastName","description":"Last name used when the customer has to be created."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags to apply to the conversation."}
   * @paramDef {"type":"String","label":"Assign To","name":"assignTo","dictionary":"getUsersDictionary","description":"User to assign the conversation to. Leave empty to keep it unassigned."}
   * @returns {Object}
   * @sampleResult {"id":12345,"number":101,"subject":"Order question","status":"active","type":"email","mailboxId":85742,"createdAt":"2026-07-13T10:00:00Z","primaryCustomer":{"id":501,"email":"customer@example.com"},"tags":[{"id":9,"tag":"vip"}]}
   */
  async createConversation(subject, mailboxId, customerEmail, body, threadType, type, status, customerFirstName, customerLastName, tags, assignTo) {
    const resolvedThreadType = this.#resolveChoice(threadType, { Customer: 'customer', Reply: 'reply', Note: 'note' }) || 'customer'

    const thread = { type: resolvedThreadType, text: body }

    if (resolvedThreadType !== 'note') {
      thread.customer = { email: customerEmail }
    }

    const payload = {
      subject,
      mailboxId: Number(mailboxId),
      type: this.#resolveChoice(type, { Email: 'email', Chat: 'chat', Phone: 'phone' }) || 'email',
      status: this.#resolveChoice(status, { Active: 'active', Pending: 'pending', Closed: 'closed' }) || 'active',
      customer: {
        email: customerEmail,
        firstName: customerFirstName || undefined,
        lastName: customerLastName || undefined,
      },
      threads: [thread],
    }

    if (tags?.length) {
      payload.tags = tags
    }

    if (assignTo) {
      payload.assignTo = Number(assignTo)
    }

    const rawResponse = await this.#apiRequest({
      url: `${ API_BASE_URL }/conversations`,
      method: 'post',
      body: payload,
      rawResponse: true,
      logTag: 'createConversation',
    })

    const conversationId = this.#getCreatedResourceId(rawResponse)

    if (!conversationId) {
      return { id: null, created: true }
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/conversations/${ conversationId }`,
      logTag: 'createConversation:fetch',
    })
  }

  /**
   * @operationName Get Conversation
   * @description Retrieves a single conversation by its ID, including subject, status, assignee, tags, customer and mailbox references. Optionally embeds the full list of threads (messages, replies and notes) in the response.
   * @category Conversations
   * @route GET /conversations/get
   * @paramDef {"type":"Number","label":"Conversation ID","name":"conversationId","required":true,"description":"Unique identifier of the conversation."}
   * @paramDef {"type":"Boolean","label":"Include Threads","name":"includeThreads","defaultValue":false,"uiComponent":{"type":"TOGGLE"},"description":"When enabled, the conversation threads (messages, replies, notes) are embedded in the response."}
   * @returns {Object}
   * @sampleResult {"id":12345,"number":101,"subject":"Order question","status":"active","type":"email","mailboxId":85742,"assignee":{"id":256,"email":"agent@example.com"},"primaryCustomer":{"id":501,"email":"customer@example.com"},"tags":[{"id":9,"tag":"vip"}],"createdAt":"2026-07-13T10:00:00Z"}
   */
  async getConversation(conversationId, includeThreads) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/conversations/${ conversationId }`,
      query: includeThreads ? { embed: 'threads' } : undefined,
      logTag: 'getConversation',
    })
  }

  /**
   * @operationName List Conversations
   * @description Lists conversations with optional filters: mailbox, status, tag, modification date and Help Scout's advanced search query syntax (e.g. (subject:"refund" AND tag:"vip")). Results are paginated with 25 conversations per page; use the Page parameter and the returned page metadata to iterate.
   * @category Conversations
   * @route GET /conversations
   * @paramDef {"type":"String","label":"Mailbox","name":"mailboxId","dictionary":"getMailboxesDictionary","description":"Filter conversations by mailbox."}
   * @paramDef {"type":"String","label":"Status","name":"status","defaultValue":"Active","uiComponent":{"type":"DROPDOWN","options":{"values":["All","Active","Open","Pending","Closed","Spam"]}},"description":"Filter by conversation status. Open returns both active and pending conversations."}
   * @paramDef {"type":"String","label":"Tag","name":"tag","description":"Filter by tag name. Multiple tags may be provided as a comma-separated list (matches conversations that have all of them)."}
   * @paramDef {"type":"String","label":"Modified Since","name":"modifiedSince","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return conversations modified after this date and time."}
   * @paramDef {"type":"String","label":"Search Query","name":"query","description":"Advanced search query using Help Scout search syntax, e.g. (subject:\"refund\" AND tag:\"vip\")."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (starts at 1, 25 conversations per page)."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":12345,"number":101,"subject":"Order question","status":"active","mailboxId":85742,"createdAt":"2026-07-13T10:00:00Z"}],"page":{"size":25,"totalElements":120,"totalPages":5,"number":1}}
   */
  async listConversations(mailboxId, status, tag, modifiedSince, query, page) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/conversations`,
      query: {
        mailbox: mailboxId || undefined,
        status: this.#resolveChoice(status, { All: 'all', Active: 'active', Open: 'open', Pending: 'pending', Closed: 'closed', Spam: 'spam' }),
        tag: tag || undefined,
        modifiedSince: this.#toIsoDate(modifiedSince),
        query: query || undefined,
        page: page || undefined,
      },
      logTag: 'listConversations',
    })

    return this.#unwrapPage(response, 'conversations')
  }

  /**
   * @operationName Update Conversation
   * @description Updates a conversation's subject, status and/or assignee. Each provided field is applied as a separate patch operation; fields left empty are not changed. To unassign a conversation, use the Assign Conversation operation with the Unassign option.
   * @category Conversations
   * @route PATCH /conversations/update
   * @paramDef {"type":"Number","label":"Conversation ID","name":"conversationId","required":true,"description":"Unique identifier of the conversation to update."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"New subject for the conversation."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Pending","Closed","Spam"]}},"description":"New status for the conversation."}
   * @paramDef {"type":"String","label":"Assign To","name":"assignTo","dictionary":"getUsersDictionary","description":"User to assign the conversation to."}
   * @returns {Object}
   * @sampleResult {"conversationId":12345,"updatedFields":["subject","status"]}
   */
  async updateConversation(conversationId, subject, status, assignTo) {
    const updatedFields = []

    if (subject) {
      await this.#patchConversation(conversationId, 'replace', '/subject', subject, 'updateConversation:subject')
      updatedFields.push('subject')
    }

    const resolvedStatus = this.#resolveChoice(status, { Active: 'active', Pending: 'pending', Closed: 'closed', Spam: 'spam' })

    if (resolvedStatus) {
      await this.#patchConversation(conversationId, 'replace', '/status', resolvedStatus, 'updateConversation:status')
      updatedFields.push('status')
    }

    if (assignTo) {
      await this.#patchConversation(conversationId, 'replace', '/assignTo', Number(assignTo), 'updateConversation:assignTo')
      updatedFields.push('assignTo')
    }

    if (!updatedFields.length) {
      throw new Error('Nothing to update: provide at least one of Subject, Status or Assign To')
    }

    return { conversationId, updatedFields }
  }

  /**
   * @operationName Delete Conversation
   * @description Permanently deletes a conversation by its ID. This action cannot be undone - the conversation and all of its threads are removed from Help Scout.
   * @category Conversations
   * @route DELETE /conversations/delete
   * @paramDef {"type":"Number","label":"Conversation ID","name":"conversationId","required":true,"description":"Unique identifier of the conversation to delete."}
   * @returns {Object}
   * @sampleResult {"conversationId":12345,"deleted":true}
   */
  async deleteConversation(conversationId) {
    await this.#apiRequest({
      url: `${ API_BASE_URL }/conversations/${ conversationId }`,
      method: 'delete',
      rawResponse: true,
      logTag: 'deleteConversation',
    })

    return { conversationId, deleted: true }
  }

  /**
   * @operationName Add Reply
   * @description Adds a reply thread to an existing conversation. The reply is sent to the customer by email (unless created as a draft). The customer must be identified by their Help Scout customer ID or email address. Optionally changes the conversation status in the same call.
   * @category Conversations
   * @route POST /conversations/reply
   * @paramDef {"type":"Number","label":"Conversation ID","name":"conversationId","required":true,"description":"Unique identifier of the conversation to reply to."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Reply text. HTML is supported."}
   * @paramDef {"type":"Number","label":"Customer ID","name":"customerId","description":"Help Scout ID of the customer the reply is addressed to. Provide this or Customer Email."}
   * @paramDef {"type":"String","label":"Customer Email","name":"customerEmail","description":"Email address of the customer the reply is addressed to. Provide this or Customer ID."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Pending","Closed"]}},"description":"Optionally change the conversation status when the reply is published."}
   * @paramDef {"type":"Boolean","label":"Draft","name":"draft","defaultValue":false,"uiComponent":{"type":"TOGGLE"},"description":"When enabled, the reply is saved as a draft instead of being sent to the customer."}
   * @returns {Object}
   * @sampleResult {"conversationId":12345,"threadId":98765,"created":true}
   */
  async addReply(conversationId, text, customerId, customerEmail, status, draft) {
    if (!customerId && !customerEmail) {
      throw new Error('Provide either Customer ID or Customer Email to address the reply')
    }

    const payload = {
      text,
      customer: customerId ? { id: Number(customerId) } : { email: customerEmail },
    }

    const resolvedStatus = this.#resolveChoice(status, { Active: 'active', Pending: 'pending', Closed: 'closed' })

    if (resolvedStatus) {
      payload.status = resolvedStatus
    }

    if (draft) {
      payload.draft = true
    }

    const rawResponse = await this.#apiRequest({
      url: `${ API_BASE_URL }/conversations/${ conversationId }/reply`,
      method: 'post',
      body: payload,
      rawResponse: true,
      logTag: 'addReply',
    })

    return { conversationId, threadId: this.#getCreatedResourceId(rawResponse), created: true }
  }

  /**
   * @operationName Add Note
   * @description Adds an internal note thread to an existing conversation. Notes are visible only to your team, never to the customer. Optionally changes the conversation status in the same call.
   * @category Conversations
   * @route POST /conversations/note
   * @paramDef {"type":"Number","label":"Conversation ID","name":"conversationId","required":true,"description":"Unique identifier of the conversation to add the note to."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Note text. HTML is supported."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Pending","Closed"]}},"description":"Optionally change the conversation status when the note is added."}
   * @returns {Object}
   * @sampleResult {"conversationId":12345,"threadId":98766,"created":true}
   */
  async addNote(conversationId, text, status) {
    const payload = { text }

    const resolvedStatus = this.#resolveChoice(status, { Active: 'active', Pending: 'pending', Closed: 'closed' })

    if (resolvedStatus) {
      payload.status = resolvedStatus
    }

    const rawResponse = await this.#apiRequest({
      url: `${ API_BASE_URL }/conversations/${ conversationId }/notes`,
      method: 'post',
      body: payload,
      rawResponse: true,
      logTag: 'addNote',
    })

    return { conversationId, threadId: this.#getCreatedResourceId(rawResponse), created: true }
  }

  /**
   * @operationName List Threads
   * @description Lists all threads of a conversation in reverse chronological order: customer messages, team replies, internal notes and line items (status changes, assignments). Each thread includes its type, author, body text and timestamps.
   * @category Conversations
   * @route GET /conversations/threads
   * @paramDef {"type":"Number","label":"Conversation ID","name":"conversationId","required":true,"description":"Unique identifier of the conversation."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":98765,"type":"customer","status":"active","body":"Where is my order?","createdBy":{"id":501,"type":"customer","email":"customer@example.com"},"createdAt":"2026-07-13T10:00:00Z"}],"page":{"size":25,"totalElements":3,"totalPages":1,"number":1}}
   */
  async listThreads(conversationId) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/conversations/${ conversationId }/threads`,
      logTag: 'listThreads',
    })

    return this.#unwrapPage(response, 'threads')
  }

  /**
   * @operationName Assign Conversation
   * @description Assigns a conversation to a Help Scout user, or removes the current assignee when the Unassign option is enabled.
   * @category Conversations
   * @route PATCH /conversations/assign
   * @paramDef {"type":"Number","label":"Conversation ID","name":"conversationId","required":true,"description":"Unique identifier of the conversation."}
   * @paramDef {"type":"String","label":"Assign To","name":"userId","dictionary":"getUsersDictionary","description":"User to assign the conversation to. Required unless Unassign is enabled."}
   * @paramDef {"type":"Boolean","label":"Unassign","name":"unassign","defaultValue":false,"uiComponent":{"type":"TOGGLE"},"description":"When enabled, the current assignee is removed instead of assigning a user."}
   * @returns {Object}
   * @sampleResult {"conversationId":12345,"assignedTo":256}
   */
  async assignConversation(conversationId, userId, unassign) {
    if (unassign) {
      await this.#apiRequest({
        url: `${ API_BASE_URL }/conversations/${ conversationId }`,
        method: 'patch',
        body: { op: 'remove', path: '/assignTo' },
        rawResponse: true,
        logTag: 'assignConversation:unassign',
      })

      return { conversationId, assignedTo: null }
    }

    if (!userId) {
      throw new Error('Provide a user in Assign To, or enable Unassign')
    }

    await this.#patchConversation(conversationId, 'replace', '/assignTo', Number(userId), 'assignConversation')

    return { conversationId, assignedTo: Number(userId) }
  }

  /**
   * @operationName Add Tags
   * @description Adds one or more tags to a conversation, preserving the tags it already has. Tags that do not exist yet in your Help Scout account are created automatically.
   * @category Conversations
   * @route PUT /conversations/tags/add
   * @paramDef {"type":"Number","label":"Conversation ID","name":"conversationId","required":true,"description":"Unique identifier of the conversation."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","required":true,"description":"Tag names to add to the conversation."}
   * @returns {Object}
   * @sampleResult {"conversationId":12345,"tags":["vip","refund"]}
   */
  async addTags(conversationId, tags) {
    if (!tags?.length) {
      throw new Error('Provide at least one tag to add')
    }

    const conversation = await this.#apiRequest({
      url: `${ API_BASE_URL }/conversations/${ conversationId }`,
      logTag: 'addTags:fetch',
    })

    const existingTags = (conversation.tags || []).map(item => item.tag)
    const mergedTags = [...new Set([...existingTags, ...tags])]

    await this.#putConversationTags(conversationId, mergedTags, 'addTags')

    return { conversationId, tags: mergedTags }
  }

  /**
   * @operationName Remove Tags
   * @description Removes one or more tags from a conversation, keeping all other tags in place. Tag names that are not currently applied to the conversation are ignored.
   * @category Conversations
   * @route PUT /conversations/tags/remove
   * @paramDef {"type":"Number","label":"Conversation ID","name":"conversationId","required":true,"description":"Unique identifier of the conversation."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","required":true,"description":"Tag names to remove from the conversation."}
   * @returns {Object}
   * @sampleResult {"conversationId":12345,"tags":["vip"]}
   */
  async removeTags(conversationId, tags) {
    if (!tags?.length) {
      throw new Error('Provide at least one tag to remove')
    }

    const conversation = await this.#apiRequest({
      url: `${ API_BASE_URL }/conversations/${ conversationId }`,
      logTag: 'removeTags:fetch',
    })

    const tagsToRemove = new Set(tags.map(tag => tag.toLowerCase()))
    const remainingTags = (conversation.tags || [])
      .map(item => item.tag)
      .filter(tag => !tagsToRemove.has(tag.toLowerCase()))

    await this.#putConversationTags(conversationId, remainingTags, 'removeTags')

    return { conversationId, tags: remainingTags }
  }

  // ==================================================================================
  // Customers
  // ==================================================================================

  /**
   * @operationName Create Customer
   * @description Creates a new customer record in Help Scout with a name, email address and optional phone number and organization. Returns the newly created customer. Fails if a customer with the same email already exists.
   * @category Customers
   * @route POST /customers
   * @paramDef {"type":"String","label":"First Name","name":"firstName","required":true,"description":"Customer's first name (maximum 40 characters)."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Customer's email address."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Customer's last name (maximum 40 characters)."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Customer's phone number."}
   * @paramDef {"type":"String","label":"Organization","name":"organization","description":"Company or organization the customer belongs to."}
   * @returns {Object}
   * @sampleResult {"id":501,"firstName":"Jane","lastName":"Doe","organization":"Acme Inc","createdAt":"2026-07-13T10:00:00Z","_embedded":{"emails":[{"id":1,"value":"jane@example.com","type":"work"}]}}
   */
  async createCustomer(firstName, email, lastName, phone, organization) {
    const payload = {
      firstName,
      lastName: lastName || undefined,
      organization: organization || undefined,
      emails: [{ type: 'work', value: email }],
    }

    if (phone) {
      payload.phones = [{ type: 'work', value: phone }]
    }

    const rawResponse = await this.#apiRequest({
      url: `${ API_BASE_URL }/customers`,
      method: 'post',
      body: payload,
      rawResponse: true,
      logTag: 'createCustomer',
    })

    const customerId = this.#getCreatedResourceId(rawResponse)

    if (!customerId) {
      return { id: null, created: true }
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/customers/${ customerId }`,
      logTag: 'createCustomer:fetch',
    })
  }

  /**
   * @operationName Get Customer
   * @description Retrieves a single customer by their ID, including name, organization, job title and embedded contact entries (emails, phones, social profiles, websites, chat handles and address).
   * @category Customers
   * @route GET /customers/get
   * @paramDef {"type":"Number","label":"Customer ID","name":"customerId","required":true,"description":"Unique identifier of the customer."}
   * @returns {Object}
   * @sampleResult {"id":501,"firstName":"Jane","lastName":"Doe","organization":"Acme Inc","jobTitle":"CTO","createdAt":"2026-07-13T10:00:00Z","_embedded":{"emails":[{"id":1,"value":"jane@example.com","type":"work"}],"phones":[]}}
   */
  async getCustomer(customerId) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/customers/${ customerId }`,
      logTag: 'getCustomer',
    })
  }

  /**
   * @operationName List Customers
   * @description Lists customers with optional filters by email address, first name, last name or Help Scout's advanced search query syntax. Results are paginated with 50 customers per page.
   * @category Customers
   * @route GET /customers
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Only return customers with this exact email address."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"Filter customers by first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Filter customers by last name."}
   * @paramDef {"type":"String","label":"Search Query","name":"query","description":"Advanced search query using Help Scout search syntax, e.g. (email:\"jane@example.com\" OR organization:\"Acme\")."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (starts at 1, 50 customers per page)."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":501,"firstName":"Jane","lastName":"Doe","organization":"Acme Inc","_embedded":{"emails":[{"value":"jane@example.com","type":"work"}]}}],"page":{"size":50,"totalElements":2,"totalPages":1,"number":1}}
   */
  async listCustomers(email, firstName, lastName, query, page) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/customers`,
      query: {
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        query: query || (email ? `(email:"${ email }")` : undefined),
        page: page || undefined,
      },
      logTag: 'listCustomers',
    })

    return this.#unwrapPage(response, 'customers')
  }

  /**
   * @operationName Update Customer
   * @description Updates a customer's profile fields: first name, last name, job title, organization, location and background notes. Only the provided fields are changed; existing values are preserved for the rest. Contact entries (emails, phones) are managed by Help Scout as separate sub-resources and are not modified by this operation.
   * @category Customers
   * @route PUT /customers/update
   * @paramDef {"type":"Number","label":"Customer ID","name":"customerId","required":true,"description":"Unique identifier of the customer to update."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"New first name (maximum 40 characters)."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"New last name (maximum 40 characters)."}
   * @paramDef {"type":"String","label":"Job Title","name":"jobTitle","description":"New job title."}
   * @paramDef {"type":"String","label":"Organization","name":"organization","description":"New company or organization."}
   * @paramDef {"type":"String","label":"Location","name":"location","description":"New location, e.g. a city or country."}
   * @paramDef {"type":"String","label":"Background","name":"background","description":"New background notes about the customer."}
   * @returns {Object}
   * @sampleResult {"customerId":501,"updatedFields":["jobTitle","organization"]}
   */
  async updateCustomer(customerId, firstName, lastName, jobTitle, organization, location, background) {
    const current = await this.#apiRequest({
      url: `${ API_BASE_URL }/customers/${ customerId }`,
      logTag: 'updateCustomer:fetch',
    })

    const changes = { firstName, lastName, jobTitle, organization, location, background }
    const updatedFields = Object.keys(changes).filter(key => changes[key] !== undefined && changes[key] !== null && changes[key] !== '')

    if (!updatedFields.length) {
      throw new Error('Nothing to update: provide at least one customer field')
    }

    const payload = {
      firstName: current.firstName,
      lastName: current.lastName,
      jobTitle: current.jobTitle,
      organization: current.organization,
      location: current.location,
      background: current.background,
      photoUrl: current.photoUrl,
      gender: current.gender,
      age: current.age,
    }

    for (const field of updatedFields) {
      payload[field] = changes[field]
    }

    for (const key of Object.keys(payload)) {
      if (payload[key] === undefined || payload[key] === null || payload[key] === '') {
        delete payload[key]
      }
    }

    await this.#apiRequest({
      url: `${ API_BASE_URL }/customers/${ customerId }`,
      method: 'put',
      body: payload,
      rawResponse: true,
      logTag: 'updateCustomer',
    })

    return { customerId, updatedFields }
  }

  // ==================================================================================
  // Mailboxes
  // ==================================================================================

  /**
   * @operationName List Mailboxes
   * @description Lists all mailboxes the connected Help Scout app has access to, including their IDs, names, slugs and email addresses.
   * @category Mailboxes
   * @route GET /mailboxes
   * @returns {Object}
   * @sampleResult {"items":[{"id":85742,"name":"Support","slug":"5fbcm4pxs2kx0cwx","email":"support@example.com","createdAt":"2025-01-01T00:00:00Z"}],"page":{"size":50,"totalElements":2,"totalPages":1,"number":1}}
   */
  async listMailboxes() {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/mailboxes`,
      logTag: 'listMailboxes',
    })

    return this.#unwrapPage(response, 'mailboxes')
  }

  /**
   * @operationName List Mailbox Folders
   * @description Lists the folders of a mailbox (e.g. Unassigned, Mine, Drafts, Assigned, Closed, Spam and custom folders) with the count of active and total conversations in each.
   * @category Mailboxes
   * @route GET /mailboxes/folders
   * @paramDef {"type":"String","label":"Mailbox","name":"mailboxId","required":true,"dictionary":"getMailboxesDictionary","description":"Mailbox whose folders are listed."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":1965,"name":"Unassigned","type":"open","userId":0,"totalCount":12,"activeCount":3,"updatedAt":"2026-07-13T10:00:00Z"}],"page":{"size":50,"totalElements":6,"totalPages":1,"number":1}}
   */
  async listMailboxFolders(mailboxId) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/mailboxes/${ mailboxId }/folders`,
      logTag: 'listMailboxFolders',
    })

    return this.#unwrapPage(response, 'folders')
  }

  // ==================================================================================
  // Users
  // ==================================================================================

  /**
   * @operationName List Users
   * @description Lists Help Scout users (team members) with optional filters by email address or mailbox membership. Each user includes their ID, name, email, role and timezone. Results are paginated with 50 users per page.
   * @category Users
   * @route GET /users
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Only return the user with this email address."}
   * @paramDef {"type":"String","label":"Mailbox","name":"mailboxId","dictionary":"getMailboxesDictionary","description":"Only return users with access to this mailbox."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (starts at 1, 50 users per page)."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":256,"firstName":"Alex","lastName":"Agent","email":"agent@example.com","role":"user","timezone":"America/New_York","type":"user"}],"page":{"size":50,"totalElements":4,"totalPages":1,"number":1}}
   */
  async listUsers(email, mailboxId, page) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/users`,
      query: {
        email: email || undefined,
        mailbox: mailboxId || undefined,
        page: page || undefined,
      },
      logTag: 'listUsers',
    })

    return this.#unwrapPage(response, 'users')
  }

  /**
   * @operationName Get Me
   * @description Retrieves the Help Scout account owner profile associated with the configured app credentials. Useful as a connection check to verify that the App ID and App Secret are valid.
   * @category Users
   * @route GET /users/me
   * @returns {Object}
   * @sampleResult {"id":256,"firstName":"Alex","lastName":"Agent","email":"agent@example.com","role":"owner","timezone":"America/New_York","type":"user","createdAt":"2025-01-01T00:00:00Z"}
   */
  async getMe() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/users/me`,
      logTag: 'getMe',
    })
  }

  // ==================================================================================
  // Tags
  // ==================================================================================

  /**
   * @operationName List Tags
   * @description Lists all tags used across your Help Scout account, including each tag's ID, name, color and the number of conversations it is applied to. Results are paginated with 100 tags per page.
   * @category Tags
   * @route GET /tags
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (starts at 1, 100 tags per page)."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":9,"name":"vip","slug":"vip","color":"none","ticketCount":37,"createdAt":"2025-01-01T00:00:00Z"}],"page":{"size":100,"totalElements":12,"totalPages":1,"number":1}}
   */
  async listTags(page) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/tags`,
      query: { page: page || undefined },
      logTag: 'listTags',
    })

    return this.#unwrapPage(response, 'tags')
  }

  // ==================================================================================
  // Dictionaries
  // ==================================================================================

  /**
   * @typedef {Object} getMailboxesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to mailbox names and email addresses."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Mailboxes Dictionary
   * @description Lists Help Scout mailboxes for selection in dependent parameters.
   * @route POST /get-mailboxes-dictionary
   * @paramDef {"type":"getMailboxesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Support","value":"85742","note":"support@example.com"}]}
   */
  async getMailboxesDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/mailboxes`,
      query: { page: cursor || undefined },
      logTag: 'getMailboxesDictionary',
    })

    const { items, page } = this.#unwrapPage(response, 'mailboxes')

    const searchText = (search || '').toLowerCase()

    const dictionaryItems = items
      .filter(mailbox => !searchText ||
        mailbox.name?.toLowerCase().includes(searchText) ||
        mailbox.email?.toLowerCase().includes(searchText))
      .map(mailbox => ({
        label: mailbox.name,
        value: String(mailbox.id),
        note: mailbox.email,
      }))

    const hasMore = page && page.number < page.totalPages

    return { items: dictionaryItems, cursor: hasMore ? String(page.number + 1) : undefined }
  }

  /**
   * @typedef {Object} getUsersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to user names and email addresses."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Users Dictionary
   * @description Lists Help Scout users (team members) for selection in assignment parameters.
   * @route POST /get-users-dictionary
   * @paramDef {"type":"getUsersDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Alex Agent","value":"256","note":"agent@example.com"}]}
   */
  async getUsersDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/users`,
      query: { page: cursor || undefined },
      logTag: 'getUsersDictionary',
    })

    const { items, page } = this.#unwrapPage(response, 'users')

    const searchText = (search || '').toLowerCase()

    const dictionaryItems = items
      .filter(user => !searchText ||
        `${ user.firstName } ${ user.lastName }`.toLowerCase().includes(searchText) ||
        user.email?.toLowerCase().includes(searchText))
      .map(user => ({
        label: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email,
        value: String(user.id),
        note: user.email,
      }))

    const hasMore = page && page.number < page.totalPages

    return { items: dictionaryItems, cursor: hasMore ? String(page.number + 1) : undefined }
  }
}

Flowrunner.ServerCode.addService(HelpScout, [
  {
    name: 'appId',
    displayName: 'App ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'App ID of your Help Scout OAuth2 app. In Help Scout, open Your Profile → My Apps → Create My App and copy the App ID.',
  },
  {
    name: 'appSecret',
    displayName: 'App Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'App Secret of your Help Scout OAuth2 app. In Help Scout, open Your Profile → My Apps → Create My App and copy the App Secret.',
  },
])
