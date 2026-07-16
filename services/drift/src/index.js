// Drift integration: conversational marketing / live chat.
// Covers Contacts, Conversations, Messages, Users (agents) and Accounts.
// Auth is a Bearer token (OAuth app access token or a personal access token from the
// Drift Developer portal). The Drift Platform API remains active under the driftapi.com
// host after the Salesloft acquisition; endpoints and auth are unchanged.

// ============================================================================
//  CONSTANTS
// ============================================================================
const API_BASE = 'https://driftapi.com'

const DEFAULT_LIMIT = 50

const ERROR_HINTS = {
  400: 'Invalid request — check the required fields and their values.',
  401: 'Authentication failed — check the Drift access token.',
  403: 'Permission denied — the token is missing the scope required for this action.',
  404: 'Not found — the ID may be wrong; use the matching "Get …"/dictionary action to pick a valid one.',
  409: 'Conflict — a record with these details may already exist.',
  429: 'Drift rate limit hit — retry in a moment.',
}

// Friendly DROPDOWN labels the UI shows, mapped to the API values Drift expects.
const CONVERSATION_STATUS_MAP = {
  'Open': 'open',
  'Closed': 'closed',
  'Pending': 'pending',
}
const MESSAGE_TYPE_MAP = {
  'Chat': 'chat',
  'Private Note': 'private_note',
  'Private (Chat Only)': 'private',
}

// ============================================================================
//  LOGGER
// ============================================================================
const logger = {
  info: (...args) => console.log('[Drift] info:', ...args),
  debug: (...args) => console.log('[Drift] debug:', ...args),
  error: (...args) => console.log('[Drift] error:', ...args),
  warn: (...args) => console.log('[Drift] warn:', ...args),
}

/**
 * @integrationName Drift
 * @integrationIcon /icon.svg
 */
class Drift {
  constructor(config) {
    this.accessToken = config.accessToken
  }

  // ==========================================================================
  //  CORE - every external call goes through #apiRequest
  // ==========================================================================
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const hasBody = body !== undefined && body !== null
      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set(this.#headers(hasBody))
        .query(query || {})

      return hasBody ? await request.send(body) : await request
    } catch (error) {
      this.#handleError(error, logTag)
    }
  }

  // Authorization on every call; Content-Type only when a JSON body is sent.
  #headers(hasBody) {
    const headers = {
      Authorization: `Bearer ${ this.accessToken }`,
      Accept: 'application/json',
    }

    if (hasBody) {
      headers['Content-Type'] = 'application/json'
    }

    return headers
  }

  #handleError(error, logTag) {
    const status = error?.status || error?.statusCode || error?.body?.status
    const apiMessage = error?.body?.error?.message ||
      error?.body?.error ||
      error?.body?.message ||
      error?.message ||
      'Request failed'
    const friendly = ERROR_HINTS[status]

    logger.error(`${ logTag } failed: ${ typeof apiMessage === 'string' ? apiMessage : JSON.stringify(apiMessage) }`)

    const detail = typeof apiMessage === 'string' ? apiMessage : JSON.stringify(apiMessage)

    throw new Error(friendly ? `Drift API error: ${ friendly } (${ detail })` : `Drift API error: ${ detail }`)
  }

  // Translate a friendly DROPDOWN label into the API value; pass through anything unmapped.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Removes keys whose value is null/undefined so optional fields are omitted.
  #compact(obj) {
    const out = {}

    for (const [key, value] of Object.entries(obj || {})) {
      if (value !== null && value !== undefined && value !== '') {
        out[key] = value
      }
    }

    return out
  }

  // ==========================================================================
  //  CONTACTS
  // ==========================================================================

  /**
   * @operationName Create Contact
   * @description Creates a Drift contact from a set of attributes. Email is the only
   * required attribute; any other standard or custom attributes (name, phone, externalId,
   * etc.) may be supplied through the Attributes object. Returns the created contact with
   * its Drift-assigned numeric ID.
   * @category Contacts
   * @route POST /contacts
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Email address of the contact. Required and used as the primary identifier."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Full display name of the contact."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Contact phone number."}
   * @paramDef {"type":"String","label":"External ID","name":"externalId","description":"Your own identifier for the contact, used to reconcile it with an external system."}
   * @paramDef {"type":"Object","label":"Additional Attributes","name":"attributes","description":"Any other standard or custom contact attributes as key/value pairs. Merged with the fields above."}
   * @returns {Object}
   * @sampleResult {"data":{"id":9001,"createdAt":1700000000000,"attributes":{"email":"jane@example.com","name":"Jane Doe","phone":"+15551234567"}}}
   */
  async createContact(email, name, phone, externalId, attributes) {
    const merged = this.#compact({ email, name, phone, externalId, ...(attributes || {}) })

    return await this.#apiRequest({
      url: `${ API_BASE }/contacts`,
      method: 'post',
      body: { attributes: merged },
      logTag: 'createContact',
    })
  }

  /**
   * @operationName Get Contact
   * @description Retrieves a single Drift contact by its numeric contact ID, including all
   * standard and custom attributes stored on the contact.
   * @category Contacts
   * @route GET /contacts/{contactId}
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"Numeric ID of the Drift contact to retrieve."}
   * @returns {Object}
   * @sampleResult {"data":{"id":9001,"createdAt":1700000000000,"attributes":{"email":"jane@example.com","name":"Jane Doe"}}}
   */
  async getContact(contactId) {
    return await this.#apiRequest({
      url: `${ API_BASE }/contacts/${ encodeURIComponent(contactId) }`,
      logTag: 'getContact',
    })
  }

  /**
   * @operationName Get Contact by Email
   * @description Looks up Drift contacts matching an exact email address. Drift returns the
   * matching contacts (typically one) with their full attribute sets. Useful when you only
   * hold the email and need the Drift contact ID.
   * @category Contacts
   * @route GET /contacts
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Exact email address to search for."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":9001,"createdAt":1700000000000,"attributes":{"email":"jane@example.com","name":"Jane Doe"}}]}
   */
  async getContactByEmail(email) {
    return await this.#apiRequest({
      url: `${ API_BASE }/contacts`,
      query: { email },
      logTag: 'getContactByEmail',
    })
  }

  /**
   * @operationName List Contacts
   * @description Lists Drift contacts, optionally filtered to an exact email address. When no
   * email is supplied Drift returns contacts accessible to the token. Returns each contact
   * with its attributes.
   * @category Contacts
   * @route GET /contacts/list
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Optional exact email address to filter the results by."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":9001,"createdAt":1700000000000,"attributes":{"email":"jane@example.com","name":"Jane Doe"}}]}
   */
  async listContacts(email) {
    return await this.#apiRequest({
      url: `${ API_BASE }/contacts`,
      query: this.#compact({ email }),
      logTag: 'listContacts',
    })
  }

  /**
   * @operationName Update Contact
   * @description Updates attributes on an existing Drift contact identified by its numeric ID.
   * Only the attributes you provide are changed; omitted attributes are left untouched. Pass
   * any standard or custom attributes through the fields below or the Additional Attributes object.
   * @category Contacts
   * @route PATCH /contacts/{contactId}
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"Numeric ID of the Drift contact to update."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New email address for the contact."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New display name for the contact."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"New phone number for the contact."}
   * @paramDef {"type":"Object","label":"Additional Attributes","name":"attributes","description":"Any other standard or custom attributes to set, as key/value pairs. Merged with the fields above."}
   * @returns {Object}
   * @sampleResult {"data":{"id":9001,"updatedAt":1700000100000,"attributes":{"email":"jane@example.com","name":"Jane A. Doe"}}}
   */
  async updateContact(contactId, email, name, phone, attributes) {
    const merged = this.#compact({ email, name, phone, ...(attributes || {}) })

    return await this.#apiRequest({
      url: `${ API_BASE }/contacts/${ encodeURIComponent(contactId) }`,
      method: 'patch',
      body: { attributes: merged },
      logTag: 'updateContact',
    })
  }

  /**
   * @operationName Delete Contact
   * @description Permanently deletes a Drift contact by its numeric ID. This cannot be undone.
   * @category Contacts
   * @route DELETE /contacts/{contactId}
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"Numeric ID of the Drift contact to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":"9001"}
   */
  async deleteContact(contactId) {
    await this.#apiRequest({
      url: `${ API_BASE }/contacts/${ encodeURIComponent(contactId) }`,
      method: 'delete',
      logTag: 'deleteContact',
    })

    return { deleted: true, id: String(contactId) }
  }

  // ==========================================================================
  //  CONVERSATIONS
  // ==========================================================================

  /**
   * @operationName List Conversations
   * @description Lists Drift conversations, most-recent first. Optionally filter by status
   * (Open, Closed or Pending) and cap the number returned. Each entry includes the
   * conversation ID, status, participants and timestamps.
   * @category Conversations
   * @route GET /conversations
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Closed","Pending"]}},"description":"Optional conversation status to filter by."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of conversations to return (default 50)."}
   * @returns {Object}
   * @sampleResult {"data":{"conversations":[{"id":501,"status":"open","contactId":9001,"inboxId":1,"createdAt":1700000000000}],"next":null}}
   */
  async listConversations(status, limit) {
    const query = this.#compact({
      statusId: this.#resolveChoice(status, CONVERSATION_STATUS_MAP),
      limit: limit || DEFAULT_LIMIT,
    })

    return await this.#apiRequest({
      url: `${ API_BASE }/conversations`,
      query,
      logTag: 'listConversations',
    })
  }

  /**
   * @operationName Get Conversation
   * @description Retrieves a single Drift conversation by its numeric ID, including status,
   * participants, associated contact and timestamps.
   * @category Conversations
   * @route GET /conversations/{conversationId}
   * @paramDef {"type":"String","label":"Conversation ID","name":"conversationId","required":true,"description":"Numeric ID of the conversation to retrieve."}
   * @returns {Object}
   * @sampleResult {"data":{"id":501,"status":"open","contactId":9001,"inboxId":1,"createdAt":1700000000000,"updatedAt":1700000100000}}
   */
  async getConversation(conversationId) {
    return await this.#apiRequest({
      url: `${ API_BASE }/conversations/${ encodeURIComponent(conversationId) }`,
      logTag: 'getConversation',
    })
  }

  /**
   * @operationName Get Conversation Messages
   * @description Retrieves the messages in a Drift conversation in chronological order,
   * including message body, author (contact or agent) and type. Supports paging with an
   * optional cursor returned as "next" in a previous response.
   * @category Conversations
   * @route GET /conversations/{conversationId}/messages
   * @paramDef {"type":"String","label":"Conversation ID","name":"conversationId","required":true,"description":"Numeric ID of the conversation whose messages to retrieve."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Optional pagination cursor from the \"next\" value of a previous response."}
   * @returns {Object}
   * @sampleResult {"data":{"messages":[{"id":7001,"conversationId":501,"body":"Hi, how can I help?","type":"chat","author":{"type":"user","id":3001}}],"next":null}}
   */
  async getConversationMessages(conversationId, cursor) {
    return await this.#apiRequest({
      url: `${ API_BASE }/conversations/${ encodeURIComponent(conversationId) }/messages`,
      query: this.#compact({ cursor }),
      logTag: 'getConversationMessages',
    })
  }

  /**
   * @operationName Send Message
   * @description Posts a message into an existing Drift conversation. Choose the message type:
   * Chat is a normal reply visible to the site visitor, while Private Note / Private are
   * internal notes visible only to agents. Returns the created message.
   * @category Conversations
   * @route POST /conversations/{conversationId}/messages
   * @paramDef {"type":"String","label":"Conversation ID","name":"conversationId","required":true,"description":"Numeric ID of the conversation to post the message into."}
   * @paramDef {"type":"String","label":"Message Body","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text of the message to send."}
   * @paramDef {"type":"String","label":"Type","name":"type","defaultValue":"Chat","uiComponent":{"type":"DROPDOWN","options":{"values":["Chat","Private Note","Private (Chat Only)"]}},"description":"Message type. Chat is visible to the visitor; the private options are internal agent-only notes."}
   * @returns {Object}
   * @sampleResult {"data":{"id":7002,"conversationId":501,"body":"Thanks for reaching out!","type":"chat","createdAt":1700000200000}}
   */
  async sendMessage(conversationId, body, type) {
    const requestBody = this.#compact({
      type: this.#resolveChoice(type, MESSAGE_TYPE_MAP) || 'chat',
      body,
    })

    return await this.#apiRequest({
      url: `${ API_BASE }/conversations/${ encodeURIComponent(conversationId) }/messages`,
      method: 'post',
      body: requestBody,
      logTag: 'sendMessage',
    })
  }

  /**
   * @operationName Update Conversation Status
   * @description Changes the status of a Drift conversation to Open, Closed or Pending.
   * Closing a conversation removes it from the active queue; reopening returns it.
   * @category Conversations
   * @route POST /conversations/{conversationId}/status
   * @paramDef {"type":"String","label":"Conversation ID","name":"conversationId","required":true,"description":"Numeric ID of the conversation to update."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Closed","Pending"]}},"description":"New status for the conversation."}
   * @returns {Object}
   * @sampleResult {"data":{"id":501,"status":"closed","updatedAt":1700000300000}}
   */
  async updateConversationStatus(conversationId, status) {
    return await this.#apiRequest({
      url: `${ API_BASE }/conversations/${ encodeURIComponent(conversationId) }/status`,
      method: 'post',
      body: { status: this.#resolveChoice(status, CONVERSATION_STATUS_MAP) },
      logTag: 'updateConversationStatus',
    })
  }

  /**
   * @operationName Create Conversation
   * @description Starts a new Drift conversation on behalf of a contact and posts its first
   * message. Supply the contact's email plus the opening message body. Returns the created
   * conversation with its ID.
   * @category Conversations
   * @route POST /conversations/new
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Email address of the contact the conversation is with. The contact is created if it does not exist."}
   * @paramDef {"type":"String","label":"Message Body","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text of the first message in the conversation."}
   * @returns {Object}
   * @sampleResult {"data":{"conversationId":502,"messageId":7100,"status":"open","createdAt":1700000400000}}
   */
  async createConversation(email, body) {
    const requestBody = {
      email,
      message: { body, type: 'chat' },
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/conversations/new`,
      method: 'post',
      body: requestBody,
      logTag: 'createConversation',
    })
  }

  // ==========================================================================
  //  USERS (agents)
  // ==========================================================================

  /**
   * @operationName List Users
   * @description Lists the Drift users (agents / team members) on the account, including their
   * ID, name, email and availability. Use this to find the agent IDs referenced by
   * conversations and assignments.
   * @category Users
   * @route GET /users/list
   * @returns {Object}
   * @sampleResult {"data":[{"id":3001,"name":"Alex Agent","email":"alex@example.com","availability":"AVAILABLE","bot":false}]}
   */
  async listUsers() {
    return await this.#apiRequest({
      url: `${ API_BASE }/users/list`,
      logTag: 'listUsers',
    })
  }

  /**
   * @operationName Get User
   * @description Retrieves a single Drift user (agent) by their numeric ID, including name,
   * email, role and availability.
   * @category Users
   * @route GET /users/{userId}
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"description":"Numeric ID of the Drift user (agent) to retrieve."}
   * @returns {Object}
   * @sampleResult {"data":{"id":3001,"name":"Alex Agent","email":"alex@example.com","availability":"AVAILABLE","bot":false}}
   */
  async getUser(userId) {
    return await this.#apiRequest({
      url: `${ API_BASE }/users/${ encodeURIComponent(userId) }`,
      logTag: 'getUser',
    })
  }

  // ==========================================================================
  //  ACCOUNTS
  // ==========================================================================

  /**
   * @operationName List Accounts
   * @description Lists Drift accounts (target companies used for account-based marketing).
   * Returns each account with its owner, domain and custom attributes. Supports paging with an
   * optional cursor returned as "next" in a previous response.
   * @category Accounts
   * @route GET /accounts
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Optional pagination cursor from the \"next\" value of a previous response."}
   * @returns {Object}
   * @sampleResult {"data":[{"ownerId":3001,"name":"Acme Corp","domain":"acme.com","targeted":true,"customProperties":[]}],"next":null}
   */
  async listAccounts(cursor) {
    return await this.#apiRequest({
      url: `${ API_BASE }/accounts`,
      query: this.#compact({ next: cursor }),
      logTag: 'listAccounts',
    })
  }

  /**
   * @operationName Get Account
   * @description Retrieves a single Drift account by its account ID, including owner, domain
   * and custom attributes.
   * @category Accounts
   * @route GET /accounts/{accountId}
   * @paramDef {"type":"String","label":"Account ID","name":"accountId","required":true,"description":"ID of the Drift account to retrieve."}
   * @returns {Object}
   * @sampleResult {"data":{"ownerId":3001,"name":"Acme Corp","domain":"acme.com","targeted":true,"customProperties":[]}}
   */
  async getAccount(accountId) {
    return await this.#apiRequest({
      url: `${ API_BASE }/accounts/${ encodeURIComponent(accountId) }`,
      logTag: 'getAccount',
    })
  }

  /**
   * @operationName Create or Update Account
   * @description Creates a Drift account or updates it if one with the same account ID already
   * exists. Provide the account name and (optionally) the ID, owner, domain and custom
   * properties. Custom properties are supplied as key/value pairs.
   * @category Accounts
   * @route POST /accounts/create
   * @paramDef {"type":"String","label":"Account Name","name":"name","required":true,"description":"Display name of the account (company)."}
   * @paramDef {"type":"String","label":"Account ID","name":"accountId","description":"Your identifier for the account. Provide to update an existing account; omit to let Drift assign one."}
   * @paramDef {"type":"String","label":"Domain","name":"domain","description":"Primary web domain of the account, e.g. acme.com."}
   * @paramDef {"type":"String","label":"Owner ID","name":"ownerId","description":"Numeric ID of the Drift user who owns the account."}
   * @paramDef {"type":"Object","label":"Custom Properties","name":"customProperties","description":"Additional account attributes as key/value pairs."}
   * @returns {Object}
   * @sampleResult {"data":{"accountId":"acct_123","name":"Acme Corp","domain":"acme.com","ownerId":3001}}
   */
  async createOrUpdateAccount(name, accountId, domain, ownerId, customProperties) {
    const body = this.#compact({
      name,
      accountId,
      domain,
      ownerId,
      customProperties: this.#toPropertyArray(customProperties),
    })

    return await this.#apiRequest({
      url: `${ API_BASE }/accounts/create`,
      method: 'post',
      body,
      logTag: 'createOrUpdateAccount',
    })
  }

  // Drift account custom properties travel as an array of {name, value}; accept a plain object.
  #toPropertyArray(props) {
    if (!props || typeof props !== 'object') return undefined

    const entries = Object.entries(props)

    if (entries.length === 0) return undefined

    return entries.map(([name, value]) => ({ name, value }))
  }

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================

  /**
   * @typedef {Object} getUsersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter users by name or email."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused; Drift returns the full user list)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Users Dictionary
   * @description Lists Drift users (agents) as selectable options for dependent parameters,
   * optionally filtered by a search term over name and email.
   * @route POST /get-users-dictionary
   * @paramDef {"type":"getUsersDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Alex Agent","value":"3001","note":"alex@example.com"}]}
   */
  async getUsersDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE }/users/list`,
      logTag: 'getUsersDictionary',
    })

    const users = Array.isArray(response?.data) ? response.data : []
    const term = (search || '').trim().toLowerCase()

    const items = users
      .filter(user => {
        if (!term) return true

        const name = (user.name || '').toLowerCase()
        const email = (user.email || '').toLowerCase()

        return name.includes(term) || email.includes(term)
      })
      .map(user => ({
        label: user.name || user.email || String(user.id),
        value: String(user.id),
        note: user.email || undefined,
      }))

    return { items }
  }
}

Flowrunner.ServerCode.addService(Drift, [
  {
    name: 'accessToken',
    displayName: 'Access Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Drift → Settings → App Settings → your developer app → OAuth access token, or a personal access token from the Drift Developer portal (dev.drift.com).',
  },
])
