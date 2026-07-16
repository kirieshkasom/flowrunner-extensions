const logger = {
  info: (...args) => console.log('[Wekan] info:', ...args),
  debug: (...args) => console.log('[Wekan] debug:', ...args),
  error: (...args) => console.log('[Wekan] error:', ...args),
  warn: (...args) => console.log('[Wekan] warn:', ...args),
}

// Wekan board colors (config/const.js ALLOWED_BOARD_COLORS). Presented to users as
// friendly, capitalized labels and mapped back to the raw API tokens in code.
const BOARD_COLOR_MAP = {
  'Belize': 'belize',
  'Nephritis': 'nephritis',
  'Pomegranate': 'pomegranate',
  'Pumpkin': 'pumpkin',
  'Wisteria': 'wisteria',
  'Moderate Pink': 'moderatepink',
  'Strong Cyan': 'strongcyan',
  'Lime Green': 'limegreen',
  'Midnight': 'midnight',
  'Dark': 'dark',
  'Relax': 'relax',
  'Corteza': 'corteza',
  'Clear Blue': 'clearblue',
  'Natural': 'natural',
  'Modern': 'modern',
  'Modern Dark': 'moderndark',
  'Exo Dark': 'exodark',
  'Clean Dark': 'cleandark',
  'Clean Light': 'cleanlight',
}

const PERMISSION_MAP = {
  'Public': 'public',
  'Private': 'private',
}

/**
 * @integrationName Wekan
 * @integrationIcon /icon.png
 */
class Wekan {
  constructor(config) {
    // Strip any trailing slash so URL concatenation stays predictable.
    this.baseUrl = (config.url || '').replace(/\/+$/, '')
    this.username = config.username
    this.password = config.password

    // All REST endpoints are served under {url}/api.
    this.apiBaseUrl = `${ this.baseUrl }/api`
  }

  // ==================================================================================
  // Internal helpers
  // ==================================================================================

  // Logs into Wekan on the first API call of each invocation and caches the resulting
  // bearer token and userId in memory for the lifetime of this service instance. Wekan uses
  // password login rather than an interactive OAuth flow, so the token is minted here (in a
  // private helper) instead of through the platform's OAuth system methods.
  // Pass { force: true } to discard a cached session and re-login (used on a 401).
  async #getSession({ force = false } = {}) {
    if (!force && this.token && this.userId) {
      return { token: this.token, userId: this.userId }
    }

    logger.debug('logging in to Wekan (password grant)')

    let response

    try {
      // POST {url}/users/login with a form-encoded body. Note: this is NOT under /api.
      response = await Flowrunner.Request.post(`${ this.baseUrl }/users/login`)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(new URLSearchParams({ username: this.username, password: this.password }).toString())
    } catch (error) {
      const message = this.#extractError(error)

      throw new Error(`Wekan login failed: ${ message }. Verify the Server URL, username and password.`)
    }

    if (!response || !response.token) {
      throw new Error('Wekan login did not return a token. Verify the username and password.')
    }

    this.token = response.token
    // Wekan returns the logged-in user's id as `id`.
    this.userId = response.id || response._id

    return { token: this.token, userId: this.userId }
  }

  // Normalizes the many shapes Wekan uses for errors: a plain string, { error, reason },
  // { message }, or a Meteor-style { error, message }.
  #extractError(error) {
    const body = error?.body

    if (typeof body === 'string' && body) return body

    return (
      body?.reason ||
      body?.message ||
      (typeof body?.error === 'string' ? body.error : undefined) ||
      error?.message ||
      'Unknown error'
    )
  }

  // Single request helper. Ensures a session, attaches the bearer token, strips blank query
  // values, and transparently re-logs-in exactly once on a 401 (expired/invalid token).
  async #apiRequest({ url, method = 'get', body, query, logTag, _retried = false }) {
    const { token } = await this.#getSession()

    const cleanedQuery = {}

    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== '') {
        cleanedQuery[key] = value
      }
    }

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ 'Authorization': `Bearer ${ token }`, 'Content-Type': 'application/json' })
        .query(cleanedQuery)

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const status = error.status || error.statusCode

      // Token expired or was revoked: re-login once, then retry the original request.
      if (status === 401 && !_retried) {
        logger.warn(`${ logTag } - received 401, re-logging in and retrying once`)
        await this.#getSession({ force: true })

        return this.#apiRequest({ url, method, body, query, logTag, _retried: true })
      }

      const message = this.#extractError(error)

      logger.error(`${ logTag } - failed (${ status }): ${ message }`)

      throw new Error(`Wekan API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Returns the userId captured at login, ensuring a session exists first.
  async #currentUserId() {
    const { userId } = await this.#getSession()

    return userId
  }

  // ==================================================================================
  // Boards
  // ==================================================================================

  /**
   * @operationName Get User Boards
   * @description Lists all boards owned by or shared with the currently authenticated Wekan user (the account configured on this connection). Each entry includes the board id, title and slug. Use this to discover board ids for the other operations.
   * @category Boards
   * @route GET /boards
   * @returns {Array<Object>}
   * @sampleResult [{"_id":"abcd1234","title":"Product Roadmap","slug":"product-roadmap","archived":false}]
   */
  async getUserBoards() {
    const userId = await this.#currentUserId()

    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/users/${ userId }/boards`,
      logTag: 'getUserBoards',
    })
  }

  /**
   * @operationName Get Board
   * @description Retrieves a single Wekan board by its id, including its title, permission (public or private), color, members and other metadata.
   * @category Boards
   * @route GET /boards/{boardId}
   * @paramDef {"type":"String","label":"Board","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The board to retrieve."}
   * @returns {Object}
   * @sampleResult {"_id":"abcd1234","title":"Product Roadmap","permission":"private","color":"belize","members":[{"userId":"u1","isAdmin":true}]}
   */
  async getBoard(boardId) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/boards/${ boardId }`,
      logTag: 'getBoard',
    })
  }

  /**
   * @operationName Create Board
   * @description Creates a new Wekan board with the given title. You choose whether the board is public or private and its color theme, and set the owner (the user id that will own the board — defaults to the authenticated user). Wekan automatically provisions a default swimlane and list for the new board. Returns the new board's id and its default swimlane id.
   * @category Boards
   * @route POST /boards
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Title of the new board."}
   * @paramDef {"type":"String","label":"Owner User ID","name":"owner","description":"User id that will own the board. Defaults to the authenticated user when omitted."}
   * @paramDef {"type":"String","label":"Permission","name":"permission","defaultValue":"Private","uiComponent":{"type":"DROPDOWN","options":{"values":["Public","Private"]}},"description":"Whether the board is visible publicly or only to its members. Defaults to Private."}
   * @paramDef {"type":"String","label":"Color","name":"color","defaultValue":"Belize","uiComponent":{"type":"DROPDOWN","options":{"values":["Belize","Nephritis","Pomegranate","Pumpkin","Wisteria","Moderate Pink","Strong Cyan","Lime Green","Midnight","Dark","Relax","Corteza","Clear Blue","Natural","Modern","Modern Dark","Exo Dark","Clean Dark","Clean Light"]}},"description":"Board color theme. Defaults to Belize."}
   * @returns {Object}
   * @sampleResult {"_id":"newboard1","defaultSwimlaneId":"swim1"}
   */
  async createBoard(title, owner, permission, color) {
    const ownerId = owner || (await this.#currentUserId())

    const body = {
      title,
      owner: ownerId,
      permission: this.#resolveChoice(permission, PERMISSION_MAP) || 'private',
      color: this.#resolveChoice(color, BOARD_COLOR_MAP) || 'belize',
    }

    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/boards`,
      method: 'post',
      body,
      logTag: 'createBoard',
    })
  }

  /**
   * @operationName Delete Board
   * @description Permanently deletes a Wekan board by its id, along with all of its swimlanes, lists and cards. This action cannot be undone.
   * @category Boards
   * @route DELETE /boards/{boardId}
   * @paramDef {"type":"String","label":"Board","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The board to delete."}
   * @returns {Object}
   * @sampleResult {"boardId":"abcd1234","deleted":true}
   */
  async deleteBoard(boardId) {
    await this.#apiRequest({
      url: `${ this.apiBaseUrl }/boards/${ boardId }`,
      method: 'delete',
      logTag: 'deleteBoard',
    })

    return { boardId, deleted: true }
  }

  /**
   * @operationName Get Board's Cards Count
   * @description Returns the total number of cards on a Wekan board. Useful for reporting or for checking whether a board is empty before deleting it.
   * @category Boards
   * @route GET /boards/{boardId}/cards_count
   * @paramDef {"type":"String","label":"Board","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The board to count cards on."}
   * @returns {Object}
   * @sampleResult {"board_cards_count":42}
   */
  async getBoardCardsCount(boardId) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/boards/${ boardId }/cards_count`,
      logTag: 'getBoardCardsCount',
    })
  }

  // ==================================================================================
  // Lists
  // ==================================================================================

  /**
   * @operationName Get Lists
   * @description Lists all of the columns (lists) on a Wekan board, in board order. Each entry includes the list id and title. Cards belong to a list, so use this to discover list ids.
   * @category Lists
   * @route GET /boards/{boardId}/lists
   * @paramDef {"type":"String","label":"Board","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The board whose lists to retrieve."}
   * @returns {Array<Object>}
   * @sampleResult [{"_id":"list1","title":"To Do"},{"_id":"list2","title":"Doing"}]
   */
  async getLists(boardId) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/boards/${ boardId }/lists`,
      logTag: 'getLists',
    })
  }

  /**
   * @operationName Get List
   * @description Retrieves a single list (column) on a Wekan board by its id, including its title and settings.
   * @category Lists
   * @route GET /boards/{boardId}/lists/{listId}
   * @paramDef {"type":"String","label":"Board","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The board the list belongs to."}
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","description":"The list to retrieve."}
   * @returns {Object}
   * @sampleResult {"_id":"list1","title":"To Do","boardId":"abcd1234","archived":false}
   */
  async getList(boardId, listId) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/boards/${ boardId }/lists/${ listId }`,
      logTag: 'getList',
    })
  }

  /**
   * @operationName Create List
   * @description Creates a new list (column) on a Wekan board with the given title. The list is appended to the board. Returns the id of the new list.
   * @category Lists
   * @route POST /boards/{boardId}/lists
   * @paramDef {"type":"String","label":"Board","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The board to add the list to."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Title of the new list."}
   * @returns {Object}
   * @sampleResult {"_id":"list3"}
   */
  async createList(boardId, title) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/boards/${ boardId }/lists`,
      method: 'post',
      body: { title },
      logTag: 'createList',
    })
  }

  /**
   * @operationName Delete List
   * @description Permanently deletes a list (column) from a Wekan board by its id. This action cannot be undone.
   * @category Lists
   * @route DELETE /boards/{boardId}/lists/{listId}
   * @paramDef {"type":"String","label":"Board","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The board the list belongs to."}
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","description":"The list to delete."}
   * @returns {Object}
   * @sampleResult {"boardId":"abcd1234","listId":"list1","deleted":true}
   */
  async deleteList(boardId, listId) {
    await this.#apiRequest({
      url: `${ this.apiBaseUrl }/boards/${ boardId }/lists/${ listId }`,
      method: 'delete',
      logTag: 'deleteList',
    })

    return { boardId, listId, deleted: true }
  }

  // ==================================================================================
  // Cards
  // ==================================================================================

  /**
   * @operationName Get Cards in List
   * @description Lists all cards contained in a specific list (column) on a Wekan board. Each entry includes the card id, title and description. Use this to discover card ids.
   * @category Cards
   * @route GET /boards/{boardId}/lists/{listId}/cards
   * @paramDef {"type":"String","label":"Board","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The board the list belongs to."}
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","description":"The list whose cards to retrieve."}
   * @returns {Array<Object>}
   * @sampleResult [{"_id":"card1","title":"Design homepage","description":"Draft the layout"}]
   */
  async getCardsInList(boardId, listId) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/boards/${ boardId }/lists/${ listId }/cards`,
      logTag: 'getCardsInList',
    })
  }

  /**
   * @operationName Get Card
   * @description Retrieves a single Wekan card by its id, including its title, description, due date, assignees, labels, members and swimlane. The board id and list id that contain the card are also required.
   * @category Cards
   * @route GET /boards/{boardId}/lists/{listId}/cards/{cardId}
   * @paramDef {"type":"String","label":"Board","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The board the card belongs to."}
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","description":"The list the card belongs to."}
   * @paramDef {"type":"String","label":"Card ID","name":"cardId","required":true,"description":"The card to retrieve."}
   * @returns {Object}
   * @sampleResult {"_id":"card1","title":"Design homepage","description":"Draft the layout","listId":"list1","swimlaneId":"swim1","dueAt":"2026-07-20T00:00:00.000Z"}
   */
  async getCard(boardId, listId, cardId) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/boards/${ boardId }/lists/${ listId }/cards/${ cardId }`,
      logTag: 'getCard',
    })
  }

  /**
   * @operationName Create Card
   * @description Creates a new card in a list on a Wekan board. Requires a title, the author (the user id creating the card — defaults to the authenticated user) and the swimlane the card is placed in. Every board has a default swimlane; use Get Swimlanes to find its id, or pass it explicitly. Optionally sets a description. Returns the id of the new card.
   * @category Cards
   * @route POST /boards/{boardId}/lists/{listId}/cards
   * @paramDef {"type":"String","label":"Board","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The board to add the card to."}
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","description":"The list to add the card to."}
   * @paramDef {"type":"String","label":"Swimlane ID","name":"swimlaneId","required":true,"description":"The swimlane the card is placed in. Every board has a default swimlane; get its id from the Get Swimlanes operation."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Title of the new card."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description body for the card."}
   * @paramDef {"type":"String","label":"Author User ID","name":"authorId","description":"User id recorded as the card's author. Defaults to the authenticated user when omitted."}
   * @returns {Object}
   * @sampleResult {"_id":"card2"}
   */
  async createCard(boardId, listId, swimlaneId, title, description, authorId) {
    const author = authorId || (await this.#currentUserId())

    const body = {
      title,
      authorId: author,
      swimlaneId,
      description: description || '',
    }

    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/boards/${ boardId }/lists/${ listId }/cards`,
      method: 'post',
      body,
      logTag: 'createCard',
    })
  }

  /**
   * @operationName Edit Card
   * @description Updates an existing Wekan card. Only the fields you provide are changed: title, description, due date, or the list the card lives in (moving it between columns). The board id, list id and card id are required to locate the card. Returns the card id.
   * @category Cards
   * @route PUT /boards/{boardId}/lists/{listId}/cards/{cardId}
   * @paramDef {"type":"String","label":"Board","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The board the card belongs to."}
   * @paramDef {"type":"String","label":"Current List","name":"listId","required":true,"dictionary":"getListsDictionary","description":"The list the card currently belongs to."}
   * @paramDef {"type":"String","label":"Card ID","name":"cardId","required":true,"description":"The card to update."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New title for the card."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description body for the card."}
   * @paramDef {"type":"String","label":"Move To List","name":"newListId","dictionary":"getListsDictionary","description":"Move the card to this list. Provide a list id on the same board."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Due date/time for the card, as an ISO 8601 timestamp."}
   * @returns {Object}
   * @sampleResult {"_id":"card1"}
   */
  async editCard(boardId, listId, cardId, title, description, newListId, dueAt) {
    const body = {}

    if (title !== undefined && title !== '') body.title = title
    if (description !== undefined) body.description = description
    if (newListId !== undefined && newListId !== '') body.listId = newListId
    if (dueAt !== undefined && dueAt !== '') body.dueAt = dueAt

    if (Object.keys(body).length === 0) {
      throw new Error('Nothing to update: provide at least one field to change on the card.')
    }

    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/boards/${ boardId }/lists/${ listId }/cards/${ cardId }`,
      method: 'put',
      body,
      logTag: 'editCard',
    })
  }

  /**
   * @operationName Delete Card
   * @description Permanently deletes a card from a Wekan board by its id. This action cannot be undone.
   * @category Cards
   * @route DELETE /boards/{boardId}/lists/{listId}/cards/{cardId}
   * @paramDef {"type":"String","label":"Board","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The board the card belongs to."}
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","description":"The list the card belongs to."}
   * @paramDef {"type":"String","label":"Card ID","name":"cardId","required":true,"description":"The card to delete."}
   * @returns {Object}
   * @sampleResult {"boardId":"abcd1234","listId":"list1","cardId":"card1","deleted":true}
   */
  async deleteCard(boardId, listId, cardId) {
    await this.#apiRequest({
      url: `${ this.apiBaseUrl }/boards/${ boardId }/lists/${ listId }/cards/${ cardId }`,
      method: 'delete',
      logTag: 'deleteCard',
    })

    return { boardId, listId, cardId, deleted: true }
  }

  /**
   * @operationName Get Cards by Swimlane
   * @description Lists all cards that belong to a specific swimlane (horizontal row) on a Wekan board, across every list. Use this to see all cards grouped in one swimlane regardless of which column they are in.
   * @category Cards
   * @route GET /boards/{boardId}/swimlanes/{swimlaneId}/cards
   * @paramDef {"type":"String","label":"Board","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The board the swimlane belongs to."}
   * @paramDef {"type":"String","label":"Swimlane ID","name":"swimlaneId","required":true,"description":"The swimlane whose cards to retrieve. Get swimlane ids from the Get Swimlanes operation."}
   * @returns {Array<Object>}
   * @sampleResult [{"_id":"card1","title":"Design homepage","listId":"list1","swimlaneId":"swim1"}]
   */
  async getCardsBySwimlane(boardId, swimlaneId) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/boards/${ boardId }/swimlanes/${ swimlaneId }/cards`,
      logTag: 'getCardsBySwimlane',
    })
  }

  // ==================================================================================
  // Swimlanes
  // ==================================================================================

  /**
   * @operationName Get Swimlanes
   * @description Lists all swimlanes (horizontal rows) on a Wekan board. Every board has at least one Default swimlane. Use this to find the swimlane id required when creating cards.
   * @category Swimlanes
   * @route GET /boards/{boardId}/swimlanes
   * @paramDef {"type":"String","label":"Board","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The board whose swimlanes to retrieve."}
   * @returns {Array<Object>}
   * @sampleResult [{"_id":"swim1","title":"Default"}]
   */
  async getSwimlanes(boardId) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/boards/${ boardId }/swimlanes`,
      logTag: 'getSwimlanes',
    })
  }

  /**
   * @operationName Create Swimlane
   * @description Creates a new swimlane (horizontal row) on a Wekan board with the given title. Returns the id of the new swimlane.
   * @category Swimlanes
   * @route POST /boards/{boardId}/swimlanes
   * @paramDef {"type":"String","label":"Board","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The board to add the swimlane to."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Title of the new swimlane."}
   * @returns {Object}
   * @sampleResult {"_id":"swim2"}
   */
  async createSwimlane(boardId, title) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/boards/${ boardId }/swimlanes`,
      method: 'post',
      body: { title },
      logTag: 'createSwimlane',
    })
  }

  // ==================================================================================
  // Checklists
  // ==================================================================================

  /**
   * @operationName Get Card Checklists
   * @description Lists all checklists attached to a specific card on a Wekan board. Each entry includes the checklist id and title.
   * @category Checklists
   * @route GET /boards/{boardId}/cards/{cardId}/checklists
   * @paramDef {"type":"String","label":"Board","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The board the card belongs to."}
   * @paramDef {"type":"String","label":"Card ID","name":"cardId","required":true,"description":"The card whose checklists to retrieve."}
   * @returns {Array<Object>}
   * @sampleResult [{"_id":"chk1","title":"Acceptance criteria","cardId":"card1"}]
   */
  async getCardChecklists(boardId, cardId) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/boards/${ boardId }/cards/${ cardId }/checklists`,
      logTag: 'getCardChecklists',
    })
  }

  /**
   * @operationName Create Checklist
   * @description Creates a new checklist on a card on a Wekan board with the given title. Checklist items are added separately. Returns the id of the new checklist.
   * @category Checklists
   * @route POST /boards/{boardId}/cards/{cardId}/checklists
   * @paramDef {"type":"String","label":"Board","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The board the card belongs to."}
   * @paramDef {"type":"String","label":"Card ID","name":"cardId","required":true,"description":"The card to add the checklist to."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Title of the new checklist."}
   * @returns {Object}
   * @sampleResult {"_id":"chk2"}
   */
  async createChecklist(boardId, cardId, title) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/boards/${ boardId }/cards/${ cardId }/checklists`,
      method: 'post',
      body: { title },
      logTag: 'createChecklist',
    })
  }

  // ==================================================================================
  // Dictionaries
  // ==================================================================================

  /**
   * @typedef {Object} getBoardsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to board titles."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused; boards are returned in a single page)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Boards Dictionary
   * @description Lists the authenticated user's Wekan boards for selection in board parameters throughout the service.
   * @route POST /get-boards-dictionary
   * @paramDef {"type":"getBoardsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Product Roadmap","value":"abcd1234"}]}
   */
  async getBoardsDictionary(payload) {
    const { search } = payload || {}
    const userId = await this.#currentUserId()

    const boards = await this.#apiRequest({
      url: `${ this.apiBaseUrl }/users/${ userId }/boards`,
      logTag: 'getBoardsDictionary',
    })

    const searchText = (search || '').toLowerCase()

    const items = (Array.isArray(boards) ? boards : [])
      .filter(board => !searchText || board.title?.toLowerCase().includes(searchText))
      .map(board => ({
        label: board.title,
        value: String(board._id),
      }))

    return { items }
  }

  /**
   * @typedef {Object} getListsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Board","name":"boardId","dictionary":"getBoardsDictionary","description":"The board whose lists to load."}
   */

  /**
   * @typedef {Object} getListsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to list titles."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused; lists are returned in a single page)."}
   * @paramDef {"type":"getListsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The board to scope the lists to."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Lists Dictionary
   * @description Lists the columns (lists) on a selected Wekan board for selection in list parameters. Depends on the chosen board.
   * @route POST /get-lists-dictionary
   * @paramDef {"type":"getListsDictionary__payload","label":"Payload","name":"payload","description":"Search, pagination and board-scoping input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"To Do","value":"list1"}]}
   */
  async getListsDictionary(payload) {
    const { search, criteria } = payload || {}
    const boardId = criteria?.boardId

    if (!boardId) {
      return { items: [] }
    }

    const lists = await this.#apiRequest({
      url: `${ this.apiBaseUrl }/boards/${ boardId }/lists`,
      logTag: 'getListsDictionary',
    })

    const searchText = (search || '').toLowerCase()

    const items = (Array.isArray(lists) ? lists : [])
      .filter(list => !searchText || list.title?.toLowerCase().includes(searchText))
      .map(list => ({
        label: list.title,
        value: String(list._id),
      }))

    return { items }
  }
}

Flowrunner.ServerCode.addService(Wekan, [
  {
    name: 'url',
    displayName: 'Server URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Wekan server URL, e.g. https://wekan.example.com (the trailing slash is stripped automatically). The REST API is served from {url}/api.',
  },
  {
    name: 'username',
    displayName: 'Username',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Wekan username or email address. Used with the password to log in and obtain an API token.',
  },
  {
    name: 'password',
    displayName: 'Password',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Wekan password. Exchanged for a bearer token via POST {url}/users/login on each connection.',
  },
])
