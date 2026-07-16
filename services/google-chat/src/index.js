'use strict'

const API_BASE_URL = 'https://chat.googleapis.com/v1'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const USER_INFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

const DEFAULT_SCOPE_LIST = [
  'https://www.googleapis.com/auth/chat.messages',
  'https://www.googleapis.com/auth/chat.spaces',
  'https://www.googleapis.com/auth/chat.memberships',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const DEFAULT_PAGE_SIZE = 100

const SPACE_TYPE_FILTERS = {
  'All': undefined,
  'Space': 'spaceType = "SPACE"',
  'Group Chat': 'spaceType = "GROUP_CHAT"',
  'Direct Message': 'spaceType = "DIRECT_MESSAGE"',
}

const MESSAGE_REPLY_OPTIONS = {
  'Start New Thread': 'MESSAGE_REPLY_OPTION_UNSPECIFIED',
  'Reply Or Start New Thread': 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD',
  'Reply Or Fail': 'REPLY_MESSAGE_OR_FAIL',
}

const MESSAGE_ORDER_OPTIONS = {
  'Newest First': 'createTime DESC',
  'Oldest First': 'createTime ASC',
}

const logger = {
  info: (...args) => console.log('[Google Chat] info:', ...args),
  debug: (...args) => console.log('[Google Chat] debug:', ...args),
  error: (...args) => console.log('[Google Chat] error:', ...args),
  warn: (...args) => console.log('[Google Chat] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName Google Chat
 * @integrationIcon /icon.png
 **/
class GoogleChatService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    if (query) {
      query = cleanupObject(query)
    }

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=[${ JSON.stringify(query) }]`)

      const request = Flowrunner.Request[method](url)
        .set(this.#getAccessTokenHeader())
        .query(query || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.error?.message || error.message

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Google Chat API error: ${ message }`)
    }
  }

  #getAccessTokenHeader(accessToken) {
    return {
      Authorization: `Bearer ${ accessToken || this.request.headers['oauth-access-token'] }`,
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #normalizeSpaceName(space) {
    if (!space) {
      throw new Error('"Space" is required')
    }

    return space.startsWith('spaces/') ? space : `spaces/${ space }`
  }

  #normalizeMessageName(messageName) {
    if (!messageName) {
      throw new Error('"Message Name" is required')
    }

    if (!messageName.startsWith('spaces/') || !messageName.includes('/messages/')) {
      throw new Error('"Message Name" must be a full resource name in the format "spaces/{space}/messages/{message}"')
    }

    return messageName
  }

  #buildUserResourceName(user) {
    return user.startsWith('users/') ? user : `users/${ user }`
  }

  // ============================================= OAUTH ================================================

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('scope', this.scopes)
    params.append('access_type', 'offline')
    params.append('prompt', 'consent')

    const connectionURL = `${ OAUTH_URL }?${ params.toString() }`

    logger.debug(`composed connectionURL: ${ connectionURL }`)

    return connectionURL
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   *
   * @property {String} token
   * @property {String} [refreshToken]
   * @property {Number} [expirationInSeconds]
   * @property {Object} [userData]
   * @property {Boolean} [overwrite]
   * @property {String} connectionIdentityName
   * @property {String} [connectionIdentityImageURL]
   */

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('code', callbackObject.code)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('grant_type', 'authorization_code')
    params.append('client_secret', this.clientSecret)
    params.append('access_type', 'offline')

    const codeExchangeResponse = await Flowrunner.Request.post(TOKEN_URL)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    let userData = {}
    let connectionIdentityName = 'Google Chat Account'
    let connectionIdentityImageURL = null

    try {
      userData = await Flowrunner.Request
        .get(USER_INFO_URL)
        .set(this.#getAccessTokenHeader(codeExchangeResponse.access_token))

      if (userData.name || userData.email) {
        connectionIdentityName = userData.name
          ? `${ userData.name } (${ userData.email })`
          : userData.email
      }

      connectionIdentityImageURL = userData.picture || null
    } catch (error) {
      logger.error(`[executeCallback] userInfo error: ${ error.message }`)
    }

    return {
      token: codeExchangeResponse.access_token,
      expirationInSeconds: codeExchangeResponse.expires_in,
      refreshToken: codeExchangeResponse.refresh_token,
      connectionIdentityName,
      connectionIdentityImageURL,
      overwrite: true,
      userData,
    }
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   *
   * @property {String} token
   * @property {Number} [expirationInSeconds]
   * @property {String} [refreshToken]
   */

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    try {
      const { access_token, expires_in } = await Flowrunner.Request.post(TOKEN_URL)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .query({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        })

      return {
        token: access_token,
        expirationInSeconds: expires_in,
      }
    } catch (error) {
      logger.error(`refreshToken error: ${ error.message }`)

      if (error.body?.error === 'invalid_grant') {
        throw new Error('Refresh token expired or invalid, please re-authenticate.')
      }

      throw error
    }
  }

  // ========================================== DICTIONARIES ===========================================

  /**
   * @typedef {Object} DictionaryItem
   * @property {String} label
   * @property {any} value
   * @property {String} note
   */

  /**
   * @typedef {Object} DictionaryResponse
   * @property {Array<DictionaryItem>} items
   * @property {String} cursor
   */

  /**
   * @typedef {Object} getSpacesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter spaces by display name or resource name. Filtering is applied locally to the retrieved page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Spaces Dictionary
   * @description Lists Google Chat spaces the connected user is a member of, for selection in dependent parameters. Returns the space display name as the label and the space resource name (e.g. "spaces/AAAAAAAAAAA") as the value.
   * @route POST /get-spaces-dictionary
   * @paramDef {"type":"getSpacesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Project Phoenix","value":"spaces/AAAAAAAAAAA","note":"SPACE"}],"cursor":"nextPageToken123"}
   */
  async getSpacesDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getSpacesDictionary',
      url: `${ API_BASE_URL }/spaces`,
      query: {
        pageSize: DEFAULT_PAGE_SIZE,
        pageToken: cursor,
      },
    })

    const spaces = response.spaces || []

    const filteredSpaces = search
      ? searchFilter(spaces, ['displayName', 'name'], search)
      : spaces

    return {
      cursor: response.nextPageToken,
      items: filteredSpaces.map(space => ({
        label: space.displayName || space.name,
        value: space.name,
        note: space.spaceType,
      })),
    }
  }

  // ============================================= SPACES ===============================================

  /**
   * @description Lists Google Chat spaces the connected user is a member of, including named spaces, group chats, and direct messages. Supports filtering by space type and pagination via page token. Group chats and direct messages are listed only after the first message is sent in them.
   *
   * @route GET /list-spaces
   * @operationName List Spaces
   * @category Spaces
   *
   * @paramDef {"type":"String","label":"Space Type","name":"spaceType","defaultValue":"All","uiComponent":{"type":"DROPDOWN","options":{"values":["All","Space","Group Chat","Direct Message"]}},"description":"Filter results by space type. 'Space' returns named spaces, 'Group Chat' returns unnamed group conversations, 'Direct Message' returns 1:1 conversations. Default: 'All' (no filter)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of spaces to return per page. Maximum: 1000. Default: 100."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous List Spaces response ('nextPageToken') used to retrieve the next page of results."}
   *
   * @returns {Object}
   * @sampleResult {"spaces":[{"name":"spaces/AAAAAAAAAAA","spaceType":"SPACE","displayName":"Project Phoenix","spaceThreadingState":"THREADED_MESSAGES","spaceHistoryState":"HISTORY_ON"}],"nextPageToken":"nextPageToken123"}
   */
  async listSpaces(spaceType, pageSize, pageToken) {
    return this.#apiRequest({
      logTag: 'listSpaces',
      url: `${ API_BASE_URL }/spaces`,
      query: {
        filter: this.#resolveChoice(spaceType, SPACE_TYPE_FILTERS),
        pageSize: pageSize || DEFAULT_PAGE_SIZE,
        pageToken,
      },
    })
  }

  /**
   * @description Retrieves details about a single Google Chat space, including its display name, space type, threading state, and history settings. The connected user must be a member of the space.
   *
   * @route GET /get-space
   * @operationName Get Space
   * @category Spaces
   *
   * @paramDef {"type":"String","label":"Space","name":"space","required":true,"dictionary":"getSpacesDictionary","description":"The space to retrieve, as a resource name in the format 'spaces/{space}'. Select from the list or provide the resource name directly."}
   *
   * @returns {Object}
   * @sampleResult {"name":"spaces/AAAAAAAAAAA","spaceType":"SPACE","displayName":"Project Phoenix","spaceThreadingState":"THREADED_MESSAGES","spaceHistoryState":"HISTORY_ON","createTime":"2025-01-15T14:30:00.000Z"}
   */
  async getSpace(space) {
    return this.#apiRequest({
      logTag: 'getSpace',
      url: `${ API_BASE_URL }/${ this.#normalizeSpaceName(space) }`,
    })
  }

  /**
   * @description Creates a new named Google Chat space (spaceType SPACE) owned by the connected user. The display name must be unique within the organization and supports up to 128 characters. To create a space and add members in a single call, use Set Up Space instead.
   *
   * @route POST /create-space
   * @operationName Create Space
   * @category Spaces
   *
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","required":true,"description":"The visible name of the space. Supports up to 128 characters and must be unique within the organization."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description of the space, shown in the space details. Supports up to 150 characters."}
   *
   * @returns {Object}
   * @sampleResult {"name":"spaces/BBBBBBBBBBB","spaceType":"SPACE","displayName":"New Team Space","spaceThreadingState":"THREADED_MESSAGES","createTime":"2025-01-15T14:30:00.000Z"}
   */
  async createSpace(displayName, description) {
    if (!displayName) {
      throw new Error('"Display Name" is required')
    }

    const body = {
      spaceType: 'SPACE',
      displayName,
    }

    if (description) {
      body.spaceDetails = { description }
    }

    return this.#apiRequest({
      logTag: 'createSpace',
      method: 'post',
      url: `${ API_BASE_URL }/spaces`,
      body,
    })
  }

  /**
   * @description Creates a new named Google Chat space and adds the specified users as members in a single call. The connected user is added automatically as the space manager. Members are specified by email address or Google user ID.
   *
   * @route POST /set-up-space
   * @operationName Set Up Space
   * @category Spaces
   *
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","required":true,"description":"The visible name of the space. Supports up to 128 characters and must be unique within the organization."}
   * @paramDef {"type":"Array<String>","label":"Members","name":"members","description":"List of users to add to the space, each specified by email address (e.g. 'user@example.com') or Google user ID. The connected user is added automatically and should not be included."}
   *
   * @returns {Object}
   * @sampleResult {"name":"spaces/CCCCCCCCCCC","spaceType":"SPACE","displayName":"Onboarding Crew","spaceThreadingState":"THREADED_MESSAGES","createTime":"2025-01-15T14:30:00.000Z"}
   */
  async setUpSpace(displayName, members) {
    if (!displayName) {
      throw new Error('"Display Name" is required')
    }

    const memberList = Array.isArray(members) ? members.filter(Boolean) : []

    const body = {
      space: {
        spaceType: 'SPACE',
        displayName,
      },
    }

    if (memberList.length) {
      body.memberships = memberList.map(user => ({
        member: {
          name: this.#buildUserResourceName(String(user).trim()),
          type: 'HUMAN',
        },
      }))
    }

    return this.#apiRequest({
      logTag: 'setUpSpace',
      method: 'post',
      url: `${ API_BASE_URL }/spaces:setup`,
      body,
    })
  }

  // ============================================ MESSAGES ==============================================

  /**
   * @description Sends a text message to a Google Chat space on behalf of the connected user. Supports Google Chat text formatting (e.g. *bold*, _italic_, user mentions via <users/{id}>) and threaded replies: provide a Thread Key or Thread Name together with a Reply Option to post into an existing thread. The connected user must be a member of the space.
   *
   * @route POST /send-message
   * @operationName Send Message
   * @category Messages
   *
   * @paramDef {"type":"String","label":"Space","name":"space","required":true,"dictionary":"getSpacesDictionary","description":"The space to send the message to, as a resource name in the format 'spaces/{space}'."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The message text. Supports up to 4096 characters and Google Chat formatting syntax."}
   * @paramDef {"type":"String","label":"Thread Key","name":"threadKey","description":"Optional caller-defined thread key. Messages sent with the same thread key are grouped into the same thread. Use together with the Reply Option to reply to an existing thread or start a new one."}
   * @paramDef {"type":"String","label":"Thread Name","name":"threadName","description":"Optional thread resource name in the format 'spaces/{space}/threads/{thread}' (returned in a message's 'thread.name' field). Use instead of Thread Key to reply to a specific existing thread."}
   * @paramDef {"type":"String","label":"Reply Option","name":"replyOption","defaultValue":"Start New Thread","uiComponent":{"type":"DROPDOWN","options":{"values":["Start New Thread","Reply Or Start New Thread","Reply Or Fail"]}},"description":"How the message relates to threads. 'Start New Thread' posts a new thread and ignores thread inputs. 'Reply Or Start New Thread' replies to the specified thread, falling back to a new thread if it does not exist. 'Reply Or Fail' replies to the specified thread or fails with a not-found error."}
   *
   * @returns {Object}
   * @sampleResult {"name":"spaces/AAAAAAAAAAA/messages/BBBBBBBBBBB.CCCCCCCCCCC","sender":{"name":"users/123456789","type":"HUMAN"},"text":"Hello team!","thread":{"name":"spaces/AAAAAAAAAAA/threads/DDDDDDDDDDD"},"space":{"name":"spaces/AAAAAAAAAAA"},"createTime":"2025-01-15T14:30:00.000Z"}
   */
  async sendMessage(space, text, threadKey, threadName, replyOption) {
    if (!text) {
      throw new Error('"Text" is required')
    }

    const body = { text }

    if (threadName) {
      body.thread = { name: threadName }
    } else if (threadKey) {
      body.thread = { threadKey }
    }

    return this.#apiRequest({
      logTag: 'sendMessage',
      method: 'post',
      url: `${ API_BASE_URL }/${ this.#normalizeSpaceName(space) }/messages`,
      query: {
        messageReplyOption: body.thread
          ? this.#resolveChoice(replyOption || 'Reply Or Start New Thread', MESSAGE_REPLY_OPTIONS)
          : undefined,
      },
      body,
    })
  }

  /**
   * @description Sends a rich card message (cardsV2) to a Google Chat space on behalf of the connected user. Accepts the Google Chat cardsV2 JSON structure for interactive cards with headers, sections, widgets, buttons, and images. Optionally include fallback text shown in notifications and clients that cannot render cards.
   *
   * @route POST /send-card-message
   * @operationName Send Card Message
   * @category Messages
   *
   * @paramDef {"type":"String","label":"Space","name":"space","required":true,"dictionary":"getSpacesDictionary","description":"The space to send the card message to, as a resource name in the format 'spaces/{space}'."}
   * @paramDef {"type":"Object","label":"Card","name":"card","required":true,"description":"Card content in the Google Chat cardsV2 format. Accepts either a single card entry ({\"cardId\":\"myCard\",\"card\":{\"header\":{...},\"sections\":[...]}}), an array of such entries, or a bare card object ({\"header\":{...},\"sections\":[...]}) which is wrapped automatically. See the Google Chat card reference for the full card JSON schema (headers, sections, widgets such as textParagraph, decoratedText, image, buttonList)."}
   * @paramDef {"type":"String","label":"Fallback Text","name":"fallbackText","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional plain-text summary of the card, shown in notifications and in clients that cannot display cards."}
   * @paramDef {"type":"String","label":"Thread Key","name":"threadKey","description":"Optional caller-defined thread key to group the card message into a thread. When provided, the message replies to the matching thread or starts a new one."}
   *
   * @returns {Object}
   * @sampleResult {"name":"spaces/AAAAAAAAAAA/messages/BBBBBBBBBBB.CCCCCCCCCCC","sender":{"name":"users/123456789","type":"HUMAN"},"cardsV2":[{"cardId":"statusCard","card":{"header":{"title":"Deployment Complete"},"sections":[{"widgets":[{"textParagraph":{"text":"Build 42 deployed successfully."}}]}]}}],"space":{"name":"spaces/AAAAAAAAAAA"},"createTime":"2025-01-15T14:30:00.000Z"}
   */
  async sendCardMessage(space, card, fallbackText, threadKey) {
    if (!card) {
      throw new Error('"Card" is required')
    }

    const body = {
      cardsV2: normalizeCardsV2(card),
    }

    if (fallbackText) {
      body.text = fallbackText
    }

    if (threadKey) {
      body.thread = { threadKey }
    }

    return this.#apiRequest({
      logTag: 'sendCardMessage',
      method: 'post',
      url: `${ API_BASE_URL }/${ this.#normalizeSpaceName(space) }/messages`,
      query: {
        messageReplyOption: threadKey ? 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD' : undefined,
      },
      body,
    })
  }

  /**
   * @description Retrieves a single Google Chat message by its full resource name, including its text, sender, thread, cards, and timestamps.
   *
   * @route GET /get-message
   * @operationName Get Message
   * @category Messages
   *
   * @paramDef {"type":"String","label":"Message Name","name":"messageName","required":true,"description":"The full resource name of the message in the format 'spaces/{space}/messages/{message}' (returned in the 'name' field when a message is sent or listed)."}
   *
   * @returns {Object}
   * @sampleResult {"name":"spaces/AAAAAAAAAAA/messages/BBBBBBBBBBB.CCCCCCCCCCC","sender":{"name":"users/123456789","type":"HUMAN"},"text":"Hello team!","thread":{"name":"spaces/AAAAAAAAAAA/threads/DDDDDDDDDDD"},"space":{"name":"spaces/AAAAAAAAAAA"},"createTime":"2025-01-15T14:30:00.000Z"}
   */
  async getMessage(messageName) {
    return this.#apiRequest({
      logTag: 'getMessage',
      url: `${ API_BASE_URL }/${ this.#normalizeMessageName(messageName) }`,
    })
  }

  /**
   * @description Updates the text of an existing Google Chat message. Only messages sent by the connected user can be updated. Uses a partial update (updateMask=text), so other message properties are preserved.
   *
   * @route PATCH /update-message
   * @operationName Update Message
   * @category Messages
   *
   * @paramDef {"type":"String","label":"Message Name","name":"messageName","required":true,"description":"The full resource name of the message to update, in the format 'spaces/{space}/messages/{message}'."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The new message text. Replaces the existing text entirely. Supports Google Chat formatting syntax."}
   *
   * @returns {Object}
   * @sampleResult {"name":"spaces/AAAAAAAAAAA/messages/BBBBBBBBBBB.CCCCCCCCCCC","sender":{"name":"users/123456789","type":"HUMAN"},"text":"Updated message text","space":{"name":"spaces/AAAAAAAAAAA"},"createTime":"2025-01-15T14:30:00.000Z","lastUpdateTime":"2025-01-15T15:00:00.000Z"}
   */
  async updateMessage(messageName, text) {
    if (!text) {
      throw new Error('"Text" is required')
    }

    return this.#apiRequest({
      logTag: 'updateMessage',
      method: 'patch',
      url: `${ API_BASE_URL }/${ this.#normalizeMessageName(messageName) }`,
      query: { updateMask: 'text' },
      body: { text },
    })
  }

  /**
   * @description Deletes a Google Chat message by its full resource name. Only messages sent by the connected user (or messages the user has permission to delete, e.g. as a space manager) can be deleted.
   *
   * @route DELETE /delete-message
   * @operationName Delete Message
   * @category Messages
   *
   * @paramDef {"type":"String","label":"Message Name","name":"messageName","required":true,"description":"The full resource name of the message to delete, in the format 'spaces/{space}/messages/{message}'."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Message deleted successfully","messageName":"spaces/AAAAAAAAAAA/messages/BBBBBBBBBBB.CCCCCCCCCCC"}
   */
  async deleteMessage(messageName) {
    const name = this.#normalizeMessageName(messageName)

    await this.#apiRequest({
      logTag: 'deleteMessage',
      method: 'delete',
      url: `${ API_BASE_URL }/${ name }`,
    })

    return {
      success: true,
      message: 'Message deleted successfully',
      messageName: name,
    }
  }

  /**
   * @description Lists messages in a Google Chat space the connected user is a member of, including messages in threads. Supports pagination, sort order, and filtering by creation time or thread, e.g. 'createTime > "2025-01-01T00:00:00+00:00"' or 'thread.name = spaces/AAA/threads/BBB'.
   *
   * @route GET /list-messages
   * @operationName List Messages
   * @category Messages
   *
   * @paramDef {"type":"String","label":"Space","name":"space","required":true,"dictionary":"getSpacesDictionary","description":"The space to list messages from, as a resource name in the format 'spaces/{space}'."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of messages to return per page. Maximum: 1000. Default: 25 (API default)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous List Messages response ('nextPageToken') used to retrieve the next page of results."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Optional query filter on 'createTime' (RFC-3339 timestamp) and/or 'thread.name'. Examples: 'createTime > \"2025-01-01T00:00:00+00:00\"', 'createTime > \"2025-01-01T00:00:00+00:00\" AND thread.name = spaces/AAA/threads/BBB'."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","defaultValue":"Oldest First","uiComponent":{"type":"DROPDOWN","options":{"values":["Oldest First","Newest First"]}},"description":"Sort order by message creation time. Default: 'Oldest First' (ascending)."}
   *
   * @returns {Object}
   * @sampleResult {"messages":[{"name":"spaces/AAAAAAAAAAA/messages/BBBBBBBBBBB.CCCCCCCCCCC","sender":{"name":"users/123456789","type":"HUMAN"},"text":"Hello team!","createTime":"2025-01-15T14:30:00.000Z"}],"nextPageToken":"nextPageToken123"}
   */
  async listMessages(space, pageSize, pageToken, filter, orderBy) {
    return this.#apiRequest({
      logTag: 'listMessages',
      url: `${ API_BASE_URL }/${ this.#normalizeSpaceName(space) }/messages`,
      query: {
        pageSize,
        pageToken,
        filter,
        orderBy: this.#resolveChoice(orderBy, MESSAGE_ORDER_OPTIONS),
      },
    })
  }

  /**
   * @description Sends a text message to a Google Chat space through an incoming webhook URL. Does not use the OAuth connection — the message is posted by the webhook's Chat app identity, so it works even in spaces the connected user is not a member of. Configure an incoming webhook in the target space (space settings > Apps & integrations > Webhooks) to obtain the URL.
   *
   * @route POST /send-webhook-message
   * @operationName Send Webhook Message
   * @category Messages
   *
   * @paramDef {"type":"String","label":"Webhook URL","name":"webhookUrl","required":true,"description":"The incoming webhook URL of the target space, e.g. 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=...&token=...'."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The message text. Supports up to 4096 characters and Google Chat formatting syntax."}
   * @paramDef {"type":"String","label":"Thread Key","name":"threadKey","description":"Optional caller-defined thread key. Messages sent with the same thread key are grouped into the same thread; if no matching thread exists, a new one is started."}
   *
   * @returns {Object}
   * @sampleResult {"name":"spaces/AAAAAAAAAAA/messages/BBBBBBBBBBB.CCCCCCCCCCC","sender":{"name":"users/987654321","displayName":"Alerts Bot","type":"BOT"},"text":"Deployment finished","space":{"name":"spaces/AAAAAAAAAAA"},"createTime":"2025-01-15T14:30:00.000Z"}
   */
  async sendWebhookMessage(webhookUrl, text, threadKey) {
    if (!webhookUrl) {
      throw new Error('"Webhook URL" is required')
    }

    if (!text) {
      throw new Error('"Text" is required')
    }

    const body = { text }

    if (threadKey) {
      body.thread = { threadKey }
    }

    try {
      logger.debug('sendWebhookMessage - posting to incoming webhook')

      return await Flowrunner.Request.post(webhookUrl)
        .set({ 'Content-Type': 'application/json' })
        .query(threadKey ? { messageReplyOption: 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD' } : {})
        .send(body)
    } catch (error) {
      const message = error.body?.error?.message || error.message

      logger.error(`sendWebhookMessage - failed: ${ message }`)

      throw new Error(`Google Chat webhook error: ${ message }`)
    }
  }

  // ============================================ MEMBERS ===============================================

  /**
   * @description Lists memberships of a Google Chat space, returning each member's resource name, type (HUMAN or BOT), role, and state. The connected user must be a member of the space. Supports pagination and optional filtering by member type or role.
   *
   * @route GET /list-members
   * @operationName List Members
   * @category Members
   *
   * @paramDef {"type":"String","label":"Space","name":"space","required":true,"dictionary":"getSpacesDictionary","description":"The space to list members of, as a resource name in the format 'spaces/{space}'."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of memberships to return per page. Maximum: 1000. Default: 100."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous List Members response ('nextPageToken') used to retrieve the next page of results."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Optional query filter on 'member.type' and 'role'. Examples: 'member.type = \"HUMAN\"', 'role = \"ROLE_MANAGER\"'."}
   *
   * @returns {Object}
   * @sampleResult {"memberships":[{"name":"spaces/AAAAAAAAAAA/members/123456789","state":"JOINED","role":"ROLE_MEMBER","member":{"name":"users/123456789","type":"HUMAN"}}],"nextPageToken":"nextPageToken123"}
   */
  async listMembers(space, pageSize, pageToken, filter) {
    return this.#apiRequest({
      logTag: 'listMembers',
      url: `${ API_BASE_URL }/${ this.#normalizeSpaceName(space) }/members`,
      query: {
        pageSize: pageSize || DEFAULT_PAGE_SIZE,
        pageToken,
        filter,
      },
    })
  }

  /**
   * @description Adds a user to a Google Chat space as a member. The user is specified by email address or Google user ID. The connected user must have permission to add members to the space (typically a space manager, or any member depending on space settings).
   *
   * @route POST /add-member
   * @operationName Add Member
   * @category Members
   *
   * @paramDef {"type":"String","label":"Space","name":"space","required":true,"dictionary":"getSpacesDictionary","description":"The space to add the member to, as a resource name in the format 'spaces/{space}'."}
   * @paramDef {"type":"String","label":"User","name":"user","required":true,"description":"The user to add, specified by email address (e.g. 'user@example.com') or Google user ID (e.g. '123456789')."}
   *
   * @returns {Object}
   * @sampleResult {"name":"spaces/AAAAAAAAAAA/members/123456789","state":"JOINED","role":"ROLE_MEMBER","member":{"name":"users/123456789","type":"HUMAN"}}
   */
  async addMember(space, user) {
    if (!user) {
      throw new Error('"User" is required')
    }

    return this.#apiRequest({
      logTag: 'addMember',
      method: 'post',
      url: `${ API_BASE_URL }/${ this.#normalizeSpaceName(space) }/members`,
      body: {
        member: {
          name: this.#buildUserResourceName(user.trim()),
          type: 'HUMAN',
        },
      },
    })
  }

  /**
   * @description Removes a member from a Google Chat space. The member can be specified by email address, Google user ID, or full membership resource name. The connected user must have permission to remove the member (typically a space manager).
   *
   * @route DELETE /remove-member
   * @operationName Remove Member
   * @category Members
   *
   * @paramDef {"type":"String","label":"Space","name":"space","required":true,"dictionary":"getSpacesDictionary","description":"The space to remove the member from, as a resource name in the format 'spaces/{space}'. Ignored if a full membership resource name is provided in the Member parameter."}
   * @paramDef {"type":"String","label":"Member","name":"member","required":true,"description":"The member to remove, specified by email address (e.g. 'user@example.com'), Google user ID, or full membership resource name (e.g. 'spaces/AAA/members/123456789')."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Member removed successfully","membershipName":"spaces/AAAAAAAAAAA/members/123456789"}
   */
  async removeMember(space, member) {
    if (!member) {
      throw new Error('"Member" is required')
    }

    const membershipName = member.startsWith('spaces/')
      ? member
      : `${ this.#normalizeSpaceName(space) }/members/${ member.trim() }`

    await this.#apiRequest({
      logTag: 'removeMember',
      method: 'delete',
      url: `${ API_BASE_URL }/${ membershipName }`,
    })

    return {
      success: true,
      message: 'Member removed successfully',
      membershipName,
    }
  }
}

Flowrunner.ServerCode.addService(GoogleChatService, [
  {
    displayName: 'Client Id',
    defaultValue: '',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your OAuth 2.0 Client ID from the Google Cloud Console (used for authentication requests).',
  },
  {
    displayName: 'Client Secret',
    defaultValue: '',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your OAuth 2.0 Client Secret from the Google Cloud Console (required for secure authentication).',
  },
])

function cleanupObject(data) {
  const result = {}

  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null) {
      result[key] = data[key]
    }
  })

  return result
}

function searchFilter(list, props, searchString) {
  return list.filter(item =>
    props.some(prop => {
      const value = item[prop]

      return value && String(value).toLowerCase().includes(searchString.toLowerCase())
    })
  )
}

function normalizeCardsV2(card) {
  if (Array.isArray(card)) {
    return card
  }

  if (card.cardId || card.card) {
    return [card]
  }

  // Bare card object ({ header, sections, ... }) — wrap it into a cardsV2 entry
  return [{ cardId: `card-${ Date.now() }`, card }]
}
