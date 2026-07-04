'use strict'

const API_URL = 'https://api.monday.com/v2'

const READ_ONLY_COLUMN_TYPES = new Set([
  'name', 'auto_number', 'creation_log', 'last_updated', 'formula',
  'subtasks', 'mirror', 'button', 'dependency', 'file', 'board_relation', 'doc',
])

const COLUMN_TYPE_UI_MAP = {
  'text': { type: 'String', uiComponent: { type: 'SINGLE_LINE_TEXT' }, hint: 'Plain text value.' },
  'long_text': { type: 'String', uiComponent: { type: 'MULTI_LINE_TEXT' }, hint: 'Long text or rich text content.' },
  'numbers': { type: 'Number', uiComponent: { type: 'NUMERIC' }, hint: 'Numeric value.' },
  'status': { type: 'String', uiComponent: { type: 'SINGLE_LINE_TEXT' }, hint: 'Status label (e.g. "Done", "Working on it").' },
  'dropdown': { type: 'String', uiComponent: { type: 'SINGLE_LINE_TEXT' }, hint: 'Dropdown label (comma-separated for multiple).' },
  'date': { type: 'String', uiComponent: { type: 'SINGLE_LINE_TEXT' }, hint: 'Date in YYYY-MM-DD format.' },
  'checkbox': { type: 'Boolean', uiComponent: { type: 'TOGGLE' }, hint: 'Checked or unchecked.' },
  'email': { type: 'String', uiComponent: { type: 'SINGLE_LINE_TEXT' }, hint: 'Email address.' },
  'phone': { type: 'String', uiComponent: { type: 'SINGLE_LINE_TEXT' }, hint: 'Phone number.' },
  'link': { type: 'String', uiComponent: { type: 'SINGLE_LINE_TEXT' }, hint: 'URL.' },
  'rating': { type: 'Number', uiComponent: { type: 'NUMERIC_STEPPER' }, hint: 'Rating value (1-5).' },
  'hour': { type: 'String', uiComponent: { type: 'SINGLE_LINE_TEXT' }, hint: 'Time in HH:MM format.' },
  'color_picker': { type: 'String', uiComponent: { type: 'SINGLE_LINE_TEXT' }, hint: 'Color index number.' },
  'country': { type: 'String', uiComponent: { type: 'SINGLE_LINE_TEXT' }, hint: 'Country code (e.g. "US").' },
  'people': { type: 'String', uiComponent: { type: 'SINGLE_LINE_TEXT' }, hint: 'Person ID (comma-separated for multiple).' },
  'timeline': { type: 'String', uiComponent: { type: 'SINGLE_LINE_TEXT' }, hint: 'JSON: {"from":"YYYY-MM-DD","to":"YYYY-MM-DD"}.' },
  'tags': { type: 'String', uiComponent: { type: 'SINGLE_LINE_TEXT' }, hint: 'Comma-separated tag IDs.' },
  'week': { type: 'String', uiComponent: { type: 'SINGLE_LINE_TEXT' }, hint: 'JSON: {"week":{"startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD"}}.' },
  'location': { type: 'String', uiComponent: { type: 'SINGLE_LINE_TEXT' }, hint: 'JSON: {"lat":0,"lng":0,"address":"..."}.' },
}
const OAUTH_AUTHORIZE_URL = 'https://auth.monday.com/oauth2/authorize'
const OAUTH_TOKEN_URL = 'https://auth.monday.com/oauth2/token'
const DEFAULT_SCOPES = 'me:read boards:read boards:write workspaces:read workspaces:write users:read teams:read updates:read updates:write'

const logger = {
  info: (...args) => console.log('[Monday.com Service] info:', ...args),
  debug: (...args) => console.log('[Monday.com Service] debug:', ...args),
  error: (...args) => console.log('[Monday.com Service] error:', ...args),
  warn: (...args) => console.log('[Monday.com Service] warn:', ...args),
}

/**
 * @integrationName Monday.com
 * @integrationIcon /icon.png
 * @requireOAuth
 **/
class MondayDotCom {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
  }

  #getAccessToken() {
    return this.request.headers['oauth-access-token']
  }

  async #graphqlRequest({ query, variables, logTag }) {
    try {
      logger.debug(`${ logTag } - GraphQL request`)

      const body = { query }

      if (variables) {
        body.variables = variables
      }

      const response = await Flowrunner.Request.post(API_URL)
        .set({
          'Authorization': this.#getAccessToken(),
          'Content-Type': 'application/json',
          'API-Version': '2024-10',
        })
        .send(body)

      if (response.errors?.length) {
        const errorMsg = response.errors.map(e => e.message).join('; ')
        throw new Error(errorMsg)
      }

      return response.data
    } catch (error) {
      logger.error(`${ logTag } - Error: ${ error.message }`)
      throw error
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // ─── OAuth2 System Methods ──────────────────────────────────────────────

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('scope', DEFAULT_SCOPES)

    return `${ OAUTH_AUTHORIZE_URL }?${ params.toString() }`
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   *
   * @property {String} token
   * @property {Number} [expirationInSeconds]
   */

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    // Monday.com tokens do not expire and refresh tokens are not supported.
    // Return the existing token to satisfy the FlowRunner framework contract.
    return {
      token: this.#getAccessToken(),
    }
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
    let tokenResponse = {}

    try {
      // Monday's token endpoint follows RFC 6749: the body must be
      // application/x-www-form-urlencoded, not JSON (a JSON body is not parsed).
      const formBody = new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code: callbackObject.code,
        redirect_uri: callbackObject.redirectURI,
      }).toString()

      tokenResponse = await Flowrunner.Request.post(OAUTH_TOKEN_URL)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(formBody)

      logger.debug(`[executeCallback] tokenResponse: ${ JSON.stringify(tokenResponse) }`)
    } catch (error) {
      logger.error(`[executeCallback] tokenResponse error: ${ error.message }`)

      return {}
    }

    let userInfo = {}

    try {
      userInfo = await Flowrunner.Request.post(API_URL)
        .set({
          'Authorization': tokenResponse.access_token,
          'Content-Type': 'application/json',
          'API-Version': '2024-10',
        })
        .send({ query: '{ me { id name email photo_thumb } }' })

      logger.debug(`[executeCallback] userInfo: ${ JSON.stringify(userInfo) }`)
    } catch (error) {
      logger.error(`[executeCallback] userInfo error: ${ error.message }`)

      // The access token is already valid; a failed profile lookup must not
      // discard it. Return the token with a generic identity name.
      return {
        token: tokenResponse.access_token,
        connectionIdentityName: 'Monday.com Account',
        overwrite: true,
      }
    }

    const user = userInfo.data?.me || {}

    return {
      token: tokenResponse.access_token,
      connectionIdentityName: user.email || user.name || 'Unknown Monday.com Account',
      connectionIdentityImageURL: user.photo_thumb || null,
      overwrite: true,
    }
  }

  // ─── Dictionary Typedefs ───────────────────────────────────────────────

  /**
   * @typedef {Object} getWorkspacesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter workspaces by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getBoardsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter boards by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getUsersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter users by name or email."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getGroupsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Board ID","name":"boardId","required":true,"description":"The board ID to retrieve groups for."}
   */

  /**
   * @typedef {Object} getGroupsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter groups by title."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   * @paramDef {"type":"getGroupsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters including the board ID to retrieve groups for."}
   */

  /**
   * @typedef {Object} getColumnsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Board ID","name":"boardId","required":true,"description":"The board ID to retrieve columns for."}
   */

  /**
   * @typedef {Object} getColumnsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter columns by title."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   * @paramDef {"type":"getColumnsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters including the board ID to retrieve columns for."}
   */

  /**
   * @typedef {Object} getItemsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Board ID","name":"boardId","required":true,"description":"The board ID to retrieve items for."}
   */

  /**
   * @typedef {Object} getItemsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter items by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   * @paramDef {"type":"getItemsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters including the board ID to retrieve items for."}
   */

  // ─── Dictionary Methods ────────────────────────────────────────────────

  /**
   * @operationName Get Workspaces Dictionary
   * @description Retrieves available Monday.com workspaces for use in dynamic selection fields.
   * @route POST /get-workspaces-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getWorkspacesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering workspaces."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Main Workspace","value":"12345"}]}
   */
  async getWorkspacesDictionary(payload) {
    const { search } = payload || {}

    try {
      const data = await this.#graphqlRequest({
        query: '{ workspaces { id name } }',
        logTag: 'getWorkspacesDictionary',
      })

      let items = (data.workspaces || []).map(ws => ({
        label: ws.name,
        value: String(ws.id),
      }))

      if (search) {
        const term = search.toLowerCase()
        items = items.filter(item => item.label.toLowerCase().includes(term))
      }

      return { items }
    } catch (error) {
      logger.error('[getWorkspacesDictionary] Error:', error.message)

      return { items: [] }
    }
  }

  /**
   * @operationName Get Boards Dictionary
   * @description Retrieves available Monday.com boards for use in dynamic selection fields with pagination support.
   * @route POST /get-boards-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getBoardsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering boards."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Project Tracker","value":"9876543210","note":"public"}],"cursor":"2"}
   */
  async getBoardsDictionary(payload) {
    const { search, cursor } = payload || {}
    const pageNum = cursor ? parseInt(cursor, 10) : 1

    try {
      const data = await this.#graphqlRequest({
        query: `{ boards(limit: 100, page: ${ pageNum }) { id name board_kind } }`,
        logTag: 'getBoardsDictionary',
      })

      let items = (data.boards || []).map(board => ({
        label: board.name,
        value: String(board.id),
        note: board.board_kind,
      }))

      if (search) {
        const term = search.toLowerCase()
        items = items.filter(item => item.label.toLowerCase().includes(term))
      }

      const nextCursor = (data.boards || []).length === 100 ? String(pageNum + 1) : null

      return { items, cursor: nextCursor }
    } catch (error) {
      logger.error('[getBoardsDictionary] Error:', error.message)

      return { items: [] }
    }
  }

  /**
   * @operationName Get Users Dictionary
   * @description Retrieves available Monday.com users for use in dynamic selection fields.
   * @route POST /get-users-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getUsersDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering users."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"John Doe (john@example.com)","value":"12345678"}]}
   */
  async getUsersDictionary(payload) {
    const { search } = payload || {}

    try {
      const data = await this.#graphqlRequest({
        query: '{ users(limit: 100) { id name email } }',
        logTag: 'getUsersDictionary',
      })

      let items = (data.users || []).map(user => ({
        label: `${ user.name } (${ user.email })`,
        value: String(user.id),
      }))

      if (search) {
        const term = search.toLowerCase()
        items = items.filter(item => item.label.toLowerCase().includes(term))
      }

      return { items }
    } catch (error) {
      logger.error('[getUsersDictionary] Error:', error.message)

      return { items: [] }
    }
  }

  /**
   * @operationName Get Groups Dictionary
   * @description Retrieves available groups for a specific Monday.com board.
   * @route POST /get-groups-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getGroupsDictionary__payload","label":"Payload","name":"payload","description":"Contains search, cursor, and criteria with the board ID to retrieve groups for."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"To Do","value":"topics"}]}
   */
  async getGroupsDictionary(payload) {
    const { search, criteria } = payload || {}
    const boardId = criteria?.boardId

    if (!boardId) {
      return { items: [] }
    }

    try {
      const data = await this.#graphqlRequest({
        query: `{ boards(ids: [${ boardId }]) { groups { id title } } }`,
        logTag: 'getGroupsDictionary',
      })

      const groups = data.boards?.[0]?.groups || []

      let items = groups.map(group => ({
        label: group.title,
        value: group.id,
      }))

      if (search) {
        const term = search.toLowerCase()
        items = items.filter(item => item.label.toLowerCase().includes(term))
      }

      return { items }
    } catch (error) {
      logger.error('[getGroupsDictionary] Error:', error.message)

      return { items: [] }
    }
  }

  /**
   * @operationName Get Columns Dictionary
   * @description Retrieves available columns for a specific Monday.com board.
   * @route POST /get-columns-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getColumnsDictionary__payload","label":"Payload","name":"payload","description":"Contains search, cursor, and criteria with the board ID to retrieve columns for."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Status (status)","value":"status","note":"status"}]}
   */
  async getColumnsDictionary(payload) {
    const { search, criteria } = payload || {}
    const boardId = criteria?.boardId

    if (!boardId) {
      return { items: [] }
    }

    try {
      const data = await this.#graphqlRequest({
        query: `{ boards(ids: [${ boardId }]) { columns { id title type } } }`,
        logTag: 'getColumnsDictionary',
      })

      const columns = data.boards?.[0]?.columns || []

      let items = columns.map(col => ({
        label: `${ col.title } (${ col.type })`,
        value: col.id,
        note: col.type,
      }))

      if (search) {
        const term = search.toLowerCase()
        items = items.filter(item => item.label.toLowerCase().includes(term))
      }

      return { items }
    } catch (error) {
      logger.error('[getColumnsDictionary] Error:', error.message)

      return { items: [] }
    }
  }

  /**
   * @operationName Get Items Dictionary
   * @description Retrieves available items for a specific Monday.com board with cursor-based pagination.
   * @route POST /get-items-dictionary
   *
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"getItemsDictionary__payload","label":"Payload","name":"payload","description":"Contains search, cursor, and criteria with the board ID to retrieve items for."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Task 1","value":"1234567890"}],"cursor":"next_page_cursor"}
   */
  async getItemsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const boardId = criteria?.boardId

    if (!boardId) {
      return { items: [] }
    }

    try {
      // items_page accepts only limit/query_params. Continuation must go through
      // the root next_items_page(limit, cursor) query, not a cursor arg on items_page.
      let itemsPage

      if (cursor) {
        const data = await this.#graphqlRequest({
          query: `{ next_items_page(limit: 100, cursor: "${ cursor }") { cursor items { id name } } }`,
          logTag: 'getItemsDictionary',
        })

        itemsPage = data.next_items_page || {}
      } else {
        const data = await this.#graphqlRequest({
          query: `{ boards(ids: [${ boardId }]) { items_page(limit: 100) { cursor items { id name } } } }`,
          logTag: 'getItemsDictionary',
        })

        itemsPage = data.boards?.[0]?.items_page || {}
      }

      const rawItems = itemsPage.items || []

      let items = rawItems.map(item => ({
        label: item.name,
        value: String(item.id),
      }))

      if (search) {
        const term = search.toLowerCase()
        items = items.filter(item => item.label.toLowerCase().includes(term))
      }

      return { items, cursor: itemsPage.cursor || null }
    } catch (error) {
      logger.error('[getItemsDictionary] Error:', error.message)

      return { items: [] }
    }
  }

  // ─── Items ─────────────────────────────────────────────────────────────

  /**
   * @description Create a new item on a Monday.com board within a specified group, with optional column values.
   * @route POST /create-item
   *
   * @operationName Create Item
   * @category Items
   * @appearanceColor #6161FF #9C9CFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Board ID","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board to create the item on."}
   * @paramDef {"type":"String","label":"Group ID","name":"groupId","required":true,"dictionary":"getGroupsDictionary","dependsOn":["boardId"],"description":"The ID of the group within the board where the item will be created."}
   * @paramDef {"type":"String","label":"Item Name","name":"itemName","required":true,"description":"The name of the new item."}
   * @paramDef {"type":"Object","label":"Column Values","name":"columnValues","schemaLoader":"columnValuesSchemaLoader","dependsOn":["boardId"],"description":"Column values to set on the new item. Fields are dynamically loaded based on the selected board."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1234567890","name":"New Task"}
   */
  async createItem(boardId, groupId, itemName, columnValues) {
    const logTag = 'createItem'

    try {
      let columnValuesClause = ''

      if (columnValues) {
        const formatted = await this.#formatColumnValues(columnValues, boardId)
        columnValuesClause = `, column_values: ${ JSON.stringify(formatted) }`
      }

      const escapedName = itemName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

      const data = await this.#graphqlRequest({
        query: `mutation { create_item(board_id: ${ boardId }, group_id: "${ groupId }", item_name: "${ escapedName }"${ columnValuesClause }) { id name } }`,
        logTag,
      })

      return data.create_item
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to create item: ${ error.message }`)
    }
  }

  /**
   * @description Retrieve detailed information about a specific Monday.com item, including its column values, group, and board.
   * @route POST /get-item
   *
   * @operationName Get Item
   * @category Items
   * @appearanceColor #6161FF #9C9CFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Board ID","name":"boardId","dictionary":"getBoardsDictionary","description":"The board that contains the item. Pick it to choose the item from a list; leave blank if you already have the item ID."}
   * @paramDef {"type":"String","label":"Item ID","name":"itemId","required":true,"dictionary":"getItemsDictionary","dependsOn":["boardId"],"description":"The unique ID of the item to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1234567890","name":"Task Name","created_at":"2025-01-15T10:30:00Z","updated_at":"2025-01-16T08:00:00Z","group":{"id":"topics","title":"To Do"},"board":{"id":"9876543210","name":"My Board"},"column_values":[{"id":"status","column":{"title":"Status"},"text":"Working on it","type":"status","value":"{\"index\":1}"}]}
   */
  async getItem(boardId, itemId) {
    const logTag = 'getItem'

    try {
      const data = await this.#graphqlRequest({
        query: `{ items(ids: [${ itemId }]) { id name created_at updated_at group { id title } board { id name } column_values { id column { title } text type value } } }`,
        logTag,
      })

      const item = data.items?.[0]

      if (!item) {
        throw new Error(`Item with ID ${ itemId } not found.`)
      }

      return item
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to get item: ${ error.message }`)
    }
  }

  /**
   * @description Update the name of a specific item on a Monday.com board.
   * @route POST /update-item-name
   *
   * @operationName Update Item Name
   * @category Items
   * @appearanceColor #6161FF #9C9CFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Board ID","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board containing the item."}
   * @paramDef {"type":"String","label":"Item ID","name":"itemId","required":true,"dictionary":"getItemsDictionary","dependsOn":["boardId"],"description":"The ID of the item to rename."}
   * @paramDef {"type":"String","label":"New Name","name":"newName","required":true,"description":"The new name for the item."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1234567890","name":"Updated Task Name"}
   */
  async updateItemName(boardId, itemId, newName) {
    const logTag = 'updateItemName'

    try {
      const escapedName = newName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

      const data = await this.#graphqlRequest({
        query: `mutation { change_simple_column_value(board_id: ${ boardId }, item_id: ${ itemId }, column_id: "name", value: "${ escapedName }") { id name } }`,
        logTag,
      })

      return data.change_simple_column_value
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to update item name: ${ error.message }`)
    }
  }

  /**
   * @description Change the value of a specific column for an item on a Monday.com board.
   * @route POST /change-column-value
   *
   * @operationName Change Column Value
   * @category Items
   * @appearanceColor #6161FF #9C9CFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Board ID","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board containing the item."}
   * @paramDef {"type":"String","label":"Item ID","name":"itemId","required":true,"dictionary":"getItemsDictionary","dependsOn":["boardId"],"description":"The ID of the item to update."}
   * @paramDef {"type":"String","label":"Column ID","name":"columnId","required":true,"dictionary":"getColumnsDictionary","dependsOn":["boardId"],"description":"The ID of the column to change."}
   * @paramDef {"type":"String","label":"Value","name":"value","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON string of the column value (e.g. '{\"label\":\"Done\"}' for status, '{\"date\":\"2025-01-15\"}' for date)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1234567890","name":"Task Name"}
   */
  async changeColumnValue(boardId, itemId, columnId, value) {
    const logTag = 'changeColumnValue'

    try {
      const jsonValue = this.#toColumnJson(value)

      const data = await this.#graphqlRequest({
        query: `mutation { change_column_value(board_id: ${ boardId }, item_id: ${ itemId }, column_id: "${ columnId }", value: ${ JSON.stringify(jsonValue) }) { id name } }`,
        logTag,
      })

      return data.change_column_value
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to change column value: ${ error.message }`)
    }
  }

  /**
   * @description Change multiple column values at once for an item on a Monday.com board.
   * @route POST /change-multiple-column-values
   *
   * @operationName Change Multiple Column Values
   * @category Items
   * @appearanceColor #6161FF #9C9CFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Board ID","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board containing the item."}
   * @paramDef {"type":"String","label":"Item ID","name":"itemId","required":true,"dictionary":"getItemsDictionary","dependsOn":["boardId"],"description":"The ID of the item to update."}
   * @paramDef {"type":"Object","label":"Column Values","name":"columnValues","required":true,"schemaLoader":"columnValuesSchemaLoader","dependsOn":["boardId"],"description":"Column values to update. Fields are dynamically loaded based on the selected board."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1234567890","name":"Task Name"}
   */
  async changeMultipleColumnValues(boardId, itemId, columnValues) {
    const logTag = 'changeMultipleColumnValues'

    try {
      const formatted = await this.#formatColumnValues(columnValues, boardId)

      const data = await this.#graphqlRequest({
        query: `mutation { change_multiple_column_values(board_id: ${ boardId }, item_id: ${ itemId }, column_values: ${ JSON.stringify(formatted) }) { id name } }`,
        logTag,
      })

      return data.change_multiple_column_values
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to change multiple column values: ${ error.message }`)
    }
  }

  /**
   * @description Move an item to a different group within the same Monday.com board.
   * @route POST /move-item-to-group
   *
   * @operationName Move Item to Group
   * @category Items
   * @appearanceColor #6161FF #9C9CFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Board ID","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board containing the item."}
   * @paramDef {"type":"String","label":"Item ID","name":"itemId","required":true,"dictionary":"getItemsDictionary","dependsOn":["boardId"],"description":"The ID of the item to move."}
   * @paramDef {"type":"String","label":"Group ID","name":"groupId","required":true,"dictionary":"getGroupsDictionary","dependsOn":["boardId"],"description":"The ID of the target group to move the item to."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1234567890","name":"Task Name"}
   */
  async moveItemToGroup(boardId, itemId, groupId) {
    const logTag = 'moveItemToGroup'

    try {
      const data = await this.#graphqlRequest({
        query: `mutation { move_item_to_group(item_id: ${ itemId }, group_id: "${ groupId }") { id name } }`,
        logTag,
      })

      return data.move_item_to_group
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to move item to group: ${ error.message }`)
    }
  }

  /**
   * @description Archive an item on Monday.com, removing it from the active board view while preserving its data.
   * @route POST /archive-item
   *
   * @operationName Archive Item
   * @category Items
   * @appearanceColor #6161FF #9C9CFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Board ID","name":"boardId","dictionary":"getBoardsDictionary","description":"The board that contains the item. Pick it to choose the item from a list; leave blank if you already have the item ID."}
   * @paramDef {"type":"String","label":"Item ID","name":"itemId","required":true,"dictionary":"getItemsDictionary","dependsOn":["boardId"],"description":"The unique ID of the item to archive."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1234567890","name":"Archived Task"}
   */
  async archiveItem(boardId, itemId) {
    const logTag = 'archiveItem'

    try {
      const data = await this.#graphqlRequest({
        query: `mutation { archive_item(item_id: ${ itemId }) { id name } }`,
        logTag,
      })

      return data.archive_item
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to archive item: ${ error.message }`)
    }
  }

  /**
   * @description Permanently delete an item from a Monday.com board. This action cannot be undone.
   * @route POST /delete-item
   *
   * @operationName Delete Item
   * @category Items
   * @appearanceColor #6161FF #9C9CFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Board ID","name":"boardId","dictionary":"getBoardsDictionary","description":"The board that contains the item. Pick it to choose the item from a list; leave blank if you already have the item ID."}
   * @paramDef {"type":"String","label":"Item ID","name":"itemId","required":true,"dictionary":"getItemsDictionary","dependsOn":["boardId"],"description":"The unique ID of the item to delete."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1234567890"}
   */
  async deleteItem(boardId, itemId) {
    const logTag = 'deleteItem'

    try {
      const data = await this.#graphqlRequest({
        query: `mutation { delete_item(item_id: ${ itemId }) { id } }`,
        logTag,
      })

      return data.delete_item
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to delete item: ${ error.message }`)
    }
  }

  // ─── Subitems ──────────────────────────────────────────────────────────

  /**
   * @description Create a new subitem under an existing Monday.com item, with optional column values.
   * @route POST /create-subitem
   *
   * @operationName Create Subitem
   * @category Subitems
   * @appearanceColor #6161FF #9C9CFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Board ID","name":"boardId","dictionary":"getBoardsDictionary","description":"The board that contains the parent item. Pick it to choose the parent item from a list; leave blank if you already have the item ID."}
   * @paramDef {"type":"String","label":"Parent Item ID","name":"parentItemId","required":true,"dictionary":"getItemsDictionary","dependsOn":["boardId"],"description":"The ID of the parent item to create the subitem under."}
   * @paramDef {"type":"String","label":"Subitem Name","name":"subitemName","required":true,"description":"The name of the new subitem."}
   * @paramDef {"type":"String","label":"Column Values","name":"columnValues","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON object mapping column IDs to their values for the subitem."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1234567891","name":"New Subitem","board":{"id":"9876543211"}}
   */
  async createSubitem(boardId, parentItemId, subitemName, columnValues) {
    const logTag = 'createSubitem'

    try {
      let columnValuesClause = ''

      if (columnValues) {
        const formatted = await this.#formatColumnValues(columnValues)
        columnValuesClause = `, column_values: ${ JSON.stringify(formatted) }`
      }

      const escapedName = subitemName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

      const data = await this.#graphqlRequest({
        query: `mutation { create_subitem(parent_item_id: ${ parentItemId }, item_name: "${ escapedName }"${ columnValuesClause }) { id name board { id } } }`,
        logTag,
      })

      return data.create_subitem
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to create subitem: ${ error.message }`)
    }
  }

  /**
   * @description Permanently delete a subitem from Monday.com. This action cannot be undone.
   * @route POST /delete-subitem
   *
   * @operationName Delete Subitem
   * @category Subitems
   * @appearanceColor #6161FF #9C9CFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Subitem ID","name":"subitemId","required":true,"freeform":true,"description":"The unique ID of the subitem to delete. Subitems are nested under a parent item and monday.com has no top-level subitem list, so no picker is offered - copy the ID from a Create Subitem step or from the subitems of a Get Item step."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1234567891"}
   */
  async deleteSubitem(subitemId) {
    const logTag = 'deleteSubitem'

    try {
      const data = await this.#graphqlRequest({
        query: `mutation { delete_item(item_id: ${ subitemId }) { id } }`,
        logTag,
      })

      return data.delete_item
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to delete subitem: ${ error.message }`)
    }
  }

  // ─── Updates ───────────────────────────────────────────────────────────

  /**
   * @description Post an update (comment) on a Monday.com item. Supports HTML formatting for rich text content.
   * @route POST /create-update
   *
   * @operationName Create Update
   * @category Updates
   * @appearanceColor #6161FF #9C9CFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Board ID","name":"boardId","dictionary":"getBoardsDictionary","description":"The board that contains the item. Pick it to choose the item from a list; leave blank if you already have the item ID."}
   * @paramDef {"type":"String","label":"Item ID","name":"itemId","required":true,"dictionary":"getItemsDictionary","dependsOn":["boardId"],"description":"The ID of the item to post the update on."}
   * @paramDef {"type":"String","label":"Body","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The update content. Supports HTML formatting (e.g. '<p>Task completed</p>')."}
   *
   * @returns {Object}
   * @sampleResult {"id":"2345678901","body":"Task completed successfully.","created_at":"2025-01-15T12:00:00Z","creator":{"id":"12345678","name":"John Doe"}}
   */
  async createUpdate(boardId, itemId, body) {
    const logTag = 'createUpdate'

    try {
      const escapedBody = body.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')

      const data = await this.#graphqlRequest({
        query: `mutation { create_update(item_id: ${ itemId }, body: "${ escapedBody }") { id body created_at creator { id name } } }`,
        logTag,
      })

      return data.create_update
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to create update: ${ error.message }`)
    }
  }

  /**
   * @description Permanently delete an update (comment) from Monday.com. This action cannot be undone.
   * @route POST /delete-update
   *
   * @operationName Delete Update
   * @category Updates
   * @appearanceColor #6161FF #9C9CFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Update ID","name":"updateId","required":true,"freeform":true,"description":"The unique ID of the update to delete. Updates are comments posted on an item and monday.com has no scoped update picker, so no dictionary is offered - copy the ID returned by a Create Update step."}
   *
   * @returns {Object}
   * @sampleResult {"id":"2345678901"}
   */
  async deleteUpdate(updateId) {
    const logTag = 'deleteUpdate'

    try {
      const data = await this.#graphqlRequest({
        query: `mutation { delete_update(id: ${ updateId }) { id } }`,
        logTag,
      })

      return data.delete_update
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to delete update: ${ error.message }`)
    }
  }

  // ─── Boards ────────────────────────────────────────────────────────────

  /**
   * @description Create a new board in Monday.com with a specified visibility level and optional workspace assignment.
   * @route POST /create-board
   *
   * @operationName Create Board
   * @category Boards
   * @appearanceColor #6161FF #9C9CFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Board Name","name":"boardName","required":true,"description":"The name for the new board."}
   * @paramDef {"type":"String","label":"Board Kind","name":"boardKind","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Public","Private","Shareable"]}},"description":"The visibility level of the board. 'public' is visible to all team members, 'private' is visible to board members only, 'share' is visible to invited guests."}
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","dictionary":"getWorkspacesDictionary","description":"The ID of the workspace to create the board in. If not provided, the board is created in the main workspace."}
   *
   * @returns {Object}
   * @sampleResult {"id":"9876543210","name":"New Board","board_kind":"public"}
   */
  async createBoard(boardName, boardKind, workspaceId) {
    const logTag = 'createBoard'

    try {
      boardKind = this.#resolveChoice(boardKind, { Public: 'public', Private: 'private', Shareable: 'share' })

      const escapedName = boardName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      const workspaceClause = workspaceId ? `, workspace_id: ${ workspaceId }` : ''

      const data = await this.#graphqlRequest({
        query: `mutation { create_board(board_name: "${ escapedName }", board_kind: ${ boardKind }${ workspaceClause }) { id name board_kind } }`,
        logTag,
      })

      return data.create_board
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to create board: ${ error.message }`)
    }
  }

  /**
   * @description Duplicate an existing Monday.com board with options to include structure only, items, or items with updates.
   * @route POST /duplicate-board
   *
   * @operationName Duplicate Board
   * @category Boards
   * @appearanceColor #6161FF #9C9CFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Board ID","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board to duplicate."}
   * @paramDef {"type":"String","label":"Duplicate Type","name":"duplicateType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Structure Only","Structure and Items","Structure, Items and Updates"]}},"description":"The level of duplication: 'duplicate_board_with_structure' copies structure only, 'duplicate_board_with_pulses' includes items, 'duplicate_board_with_pulses_and_updates' includes items and all updates."}
   * @paramDef {"type":"String","label":"Board Name","name":"boardName","description":"Optional custom name for the duplicated board. If not provided, the original board name is used."}
   *
   * @returns {Object}
   * @sampleResult {"board":{"id":"1111111111","name":"My Board (copy)"}}
   */
  async duplicateBoard(boardId, duplicateType, boardName) {
    const logTag = 'duplicateBoard'

    try {
      duplicateType = this.#resolveChoice(duplicateType, { 'Structure Only': 'duplicate_board_with_structure', 'Structure and Items': 'duplicate_board_with_pulses', 'Structure, Items and Updates': 'duplicate_board_with_pulses_and_updates' })

      let boardNameClause = ''

      if (boardName) {
        const escapedName = boardName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        boardNameClause = `, board_name: "${ escapedName }"`
      }

      const data = await this.#graphqlRequest({
        query: `mutation { duplicate_board(board_id: ${ boardId }, duplicate_type: ${ duplicateType }${ boardNameClause }) { board { id name } } }`,
        logTag,
      })

      return data.duplicate_board
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to duplicate board: ${ error.message }`)
    }
  }

  /**
   * @description Retrieve detailed information about a specific Monday.com board, including its columns, groups, and owners.
   * @route POST /get-board
   *
   * @operationName Get Board
   * @category Boards
   * @appearanceColor #6161FF #9C9CFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Board ID","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"9876543210","name":"Project Tracker","description":"Track all project tasks","board_kind":"public","state":"active","permissions":"everyone","columns":[{"id":"status","title":"Status","type":"status"}],"groups":[{"id":"topics","title":"To Do","color":"#579BFC"}],"owners":[{"id":"12345678","name":"John Doe"}]}
   */
  async getBoard(boardId) {
    const logTag = 'getBoard'

    try {
      const data = await this.#graphqlRequest({
        query: `{ boards(ids: [${ boardId }]) { id name description board_kind state permissions columns { id title type } groups { id title color } owners { id name } } }`,
        logTag,
      })

      const board = data.boards?.[0]

      if (!board) {
        throw new Error(`Board with ID ${ boardId } not found.`)
      }

      return board
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to get board: ${ error.message }`)
    }
  }

  /**
   * @description Permanently delete a Monday.com board and all of its data. This action cannot be undone.
   * @route POST /delete-board
   *
   * @operationName Delete Board
   * @category Boards
   * @appearanceColor #6161FF #9C9CFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Board ID","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board to delete."}
   *
   * @returns {Object}
   * @sampleResult {"id":"9876543210"}
   */
  async deleteBoard(boardId) {
    const logTag = 'deleteBoard'

    try {
      const data = await this.#graphqlRequest({
        query: `mutation { delete_board(board_id: ${ boardId }) { id } }`,
        logTag,
      })

      return data.delete_board
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to delete board: ${ error.message }`)
    }
  }

  // ─── Groups ────────────────────────────────────────────────────────────

  /**
   * @description Create a new group on a Monday.com board to organize items.
   * @route POST /create-group
   *
   * @operationName Create Group
   * @category Groups
   * @appearanceColor #6161FF #9C9CFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Board ID","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board to create the group on."}
   * @paramDef {"type":"String","label":"Group Name","name":"groupName","required":true,"description":"The name for the new group."}
   *
   * @returns {Object}
   * @sampleResult {"id":"new_group_12345","title":"In Progress"}
   */
  async createGroup(boardId, groupName) {
    const logTag = 'createGroup'

    try {
      const escapedName = groupName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

      const data = await this.#graphqlRequest({
        query: `mutation { create_group(board_id: ${ boardId }, group_name: "${ escapedName }") { id title } }`,
        logTag,
      })

      return data.create_group
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to create group: ${ error.message }`)
    }
  }

  /**
   * @description Permanently delete a group and all its items from a Monday.com board. This action cannot be undone.
   * @route POST /delete-group
   *
   * @operationName Delete Group
   * @category Groups
   * @appearanceColor #6161FF #9C9CFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Board ID","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board containing the group."}
   * @paramDef {"type":"String","label":"Group ID","name":"groupId","required":true,"dictionary":"getGroupsDictionary","dependsOn":["boardId"],"description":"The ID of the group to delete."}
   *
   * @returns {Object}
   * @sampleResult {"id":"topics","deleted":true}
   */
  async deleteGroup(boardId, groupId) {
    const logTag = 'deleteGroup'

    try {
      const data = await this.#graphqlRequest({
        query: `mutation { delete_group(board_id: ${ boardId }, group_id: "${ groupId }") { id deleted } }`,
        logTag,
      })

      return data.delete_group
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to delete group: ${ error.message }`)
    }
  }

  /**
   * @description Duplicate a group within a Monday.com board, including all of its items and column values.
   * @route POST /duplicate-group
   *
   * @operationName Duplicate Group
   * @category Groups
   * @appearanceColor #6161FF #9C9CFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Board ID","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board containing the group to duplicate."}
   * @paramDef {"type":"String","label":"Group ID","name":"groupId","required":true,"dictionary":"getGroupsDictionary","dependsOn":["boardId"],"description":"The ID of the group to duplicate."}
   * @paramDef {"type":"Boolean","label":"Add to Top","name":"addToTop","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the duplicated group is placed at the top of the board instead of below the original."}
   *
   * @returns {Object}
   * @sampleResult {"id":"new_group_67890","title":"To Do (copy)"}
   */
  async duplicateGroup(boardId, groupId, addToTop) {
    const logTag = 'duplicateGroup'

    try {
      const addToTopClause = addToTop ? ', add_to_top: true' : ''

      const data = await this.#graphqlRequest({
        query: `mutation { duplicate_group(board_id: ${ boardId }, group_id: "${ groupId }"${ addToTopClause }) { id title } }`,
        logTag,
      })

      return data.duplicate_group
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to duplicate group: ${ error.message }`)
    }
  }

  // ─── Workspaces ────────────────────────────────────────────────────────

  /**
   * @description Create a new workspace in Monday.com with a specified visibility level and optional description.
   * @route POST /create-workspace
   *
   * @operationName Create Workspace
   * @category Workspaces
   * @appearanceColor #6161FF #9C9CFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Workspace Name","name":"workspaceName","required":true,"description":"The name for the new workspace."}
   * @paramDef {"type":"String","label":"Workspace Kind","name":"workspaceKind","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Closed"]}},"description":"The visibility level of the workspace. 'open' is accessible to all team members, 'closed' is accessible to invited members only."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"An optional description of the workspace purpose and contents."}
   *
   * @returns {Object}
   * @sampleResult {"id":"654321","name":"Engineering","kind":"open","description":"Engineering team workspace"}
   */
  async createWorkspace(workspaceName, workspaceKind, description) {
    const logTag = 'createWorkspace'

    try {
      workspaceKind = this.#resolveChoice(workspaceKind, { Open: 'open', Closed: 'closed' })

      const escapedName = workspaceName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      let descriptionClause = ''

      if (description) {
        const escapedDesc = description.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
        descriptionClause = `, description: "${ escapedDesc }"`
      }

      const data = await this.#graphqlRequest({
        query: `mutation { create_workspace(name: "${ escapedName }", kind: ${ workspaceKind }${ descriptionClause }) { id name kind description } }`,
        logTag,
      })

      return data.create_workspace
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to create workspace: ${ error.message }`)
    }
  }

  // ─── Columns ────────────────────────────────────────────────────────────

  /**
   * @description Create a new column on a Monday.com board with the specified type and title.
   * @route POST /create-column
   *
   * @operationName Create Column
   * @category Columns
   * @appearanceColor #6161FF #9C9CFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Board ID","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the board to add the column to."}
   * @paramDef {"type":"String","label":"Column Title","name":"title","required":true,"description":"The display title for the new column."}
   * @paramDef {"type":"String","label":"Column Type","name":"columnType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Text","Long Text","Numbers","Status","Dropdown","Date","Checkbox","Email","Phone","Link","Rating","Hour","Color Picker","Country","People","Timeline","Tags","Week","Location"]}},"description":"The type of column to create."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Optional description for the column."}
   *
   * @returns {Object}
   * @sampleResult {"id":"text_col_1","title":"Notes","type":"text"}
   */
  async createColumn(boardId, title, columnType, description) {
    const logTag = 'createColumn'

    try {
      columnType = this.#resolveChoice(columnType, { Text: 'text', 'Long Text': 'long_text', Numbers: 'numbers', Status: 'status', Dropdown: 'dropdown', Date: 'date', Checkbox: 'checkbox', Email: 'email', Phone: 'phone', Link: 'link', Rating: 'rating', Hour: 'hour', 'Color Picker': 'color_picker', Country: 'country', People: 'people', Timeline: 'timeline', Tags: 'tags', Week: 'week', Location: 'location' })

      const escapedTitle = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      let descriptionClause = ''

      if (description) {
        const escapedDesc = description.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        descriptionClause = `, description: "${ escapedDesc }"`
      }

      const data = await this.#graphqlRequest({
        query: `mutation { create_column(board_id: ${ boardId }, title: "${ escapedTitle }", column_type: ${ columnType }${ descriptionClause }) { id title type } }`,
        logTag,
      })

      return data.create_column
    } catch (error) {
      logger.error(`[${ logTag }] Error:`, error.message)
      throw new Error(`Failed to create column: ${ error.message }`)
    }
  }

  // ─── Dynamic Param Schema Loaders ─────────────────────────────────────

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @paramDef {"type":"Object","name":"payload","required":true}
   * @returns {Array}
   */
  async columnValuesSchemaLoader({ criteria }) {
    const { boardId } = criteria

    if (!boardId) {
      return []
    }

    try {
      const data = await this.#graphqlRequest({
        query: `{ boards(ids: [${ boardId }]) { columns { id title type } } }`,
        logTag: 'columnValuesSchemaLoader',
      })

      const columns = data.boards?.[0]?.columns || []

      return columns
        .filter(col => !READ_ONLY_COLUMN_TYPES.has(col.type))
        .map(col => {
          const mapping = COLUMN_TYPE_UI_MAP[col.type] || { type: 'String', uiComponent: { type: 'SINGLE_LINE_TEXT' }, hint: `Column type: ${ col.type }.` }

          return {
            type: mapping.type,
            label: col.title,
            name: col.id,
            description: mapping.hint,
            uiComponent: mapping.uiComponent,
          }
        })
    } catch (error) {
      logger.error(`[columnValuesSchemaLoader] Error: ${ error.message }`)

      return []
    }
  }

  // ─── Polling Triggers ──────────────────────────────────────────────────

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    return this[invocation.eventName](invocation)
  }

  /**
   * @operationName On New Item
   * @description Monitors a Monday.com board for newly created items. Triggers when a new item is added to the specified board. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   * @category Items
   *
   * @route POST /onNewItem
   * @appearanceColor #6161FF #9C9CFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Board ID","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the Monday.com board to monitor for new items."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1234567890","name":"New Task","created_at":"2025-01-15T10:30:00Z","group":{"id":"topics","title":"To Do"},"column_values":[{"id":"status","column":{"title":"Status"},"text":"Working on it","type":"status"}]}
   */
  async onNewItem(invocation) {
    const { boardId } = invocation.triggerData

    const items = await this.#fetchBoardItems(boardId)

    if (invocation.learningMode) {
      const item = items[0]

      logger.debug(`[onNewItem] learningMode item.id=${ item?.id }`)

      return {
        events: [item],
        state: null,
      }
    }

    if (!invocation.state?.itemIds) {
      logger.debug(`[onNewItem] init with items.length=${ items.length }`)

      return {
        events: [],
        state: { itemIds: items.map(i => i.id) },
      }
    }

    const prevIds = new Set(invocation.state.itemIds)
    const newItems = items.filter(item => !prevIds.has(item.id))

    logger.debug(`[onNewItem] events.length=${ newItems.length }`)

    return {
      events: newItems,
      state: { itemIds: items.map(i => i.id) },
    }
  }

  /**
   * @operationName On Item Column Change
   * @description Monitors a Monday.com board for changes to item column values. Detects when any column value is updated. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   * @category Items
   *
   * @route POST /onItemColumnChange
   * @appearanceColor #6161FF #9C9CFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Board ID","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The ID of the Monday.com board to monitor for column value changes."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1234567890","name":"Updated Task","updated_at":"2025-01-16T08:00:00Z","group":{"id":"topics","title":"To Do"},"column_values":[{"id":"status","column":{"title":"Status"},"text":"Done","type":"status"}]}
   */
  async onItemColumnChange(invocation) {
    const { boardId } = invocation.triggerData

    const items = await this.#fetchBoardItemsWithUpdatedAt(boardId)

    if (invocation.learningMode) {
      const item = items[0]

      logger.debug(`[onItemColumnChange] learningMode item.id=${ item?.id }`)

      return {
        events: [item],
        state: null,
      }
    }

    if (!invocation.state?.itemTimestamps) {
      logger.debug(`[onItemColumnChange] init with items.length=${ items.length }`)

      const itemTimestamps = {}

      items.forEach(item => {
        itemTimestamps[item.id] = item.updated_at
      })

      return {
        events: [],
        state: { itemTimestamps },
      }
    }

    const prevTimestamps = invocation.state.itemTimestamps
    const changedItems = items.filter(item => {
      const prevTimestamp = prevTimestamps[item.id]

      return !prevTimestamp || prevTimestamp !== item.updated_at
    })

    logger.debug(`[onItemColumnChange] events.length=${ changedItems.length }`)

    const newTimestamps = {}

    items.forEach(item => {
      newTimestamps[item.id] = item.updated_at
    })

    return {
      events: changedItems,
      state: { itemTimestamps: newTimestamps },
    }
  }

  // ─── Private Helpers ───────────────────────────────────────────────────

  /**
   * Build the column_values JSON string Monday.com expects.
   *
   * The schema-loader path supplies a flat Object keyed by column id with scalar
   * values; each scalar is wrapped into that column type's nested JSON shape
   * (status → {label}, date → {date}, people → {personsAndTeams}, ...) so Monday
   * accepts it. A pre-formatted String (createSubitem / advanced raw JSON) is
   * passed through unchanged.
   */
  async #formatColumnValues(columnValues, boardId) {
    if (typeof columnValues === 'string') {
      return columnValues
    }

    const typeByColumnId = boardId ? await this.#getColumnTypeMap(boardId) : {}
    const result = {}

    for (const [columnId, rawValue] of Object.entries(columnValues || {})) {
      if (rawValue === undefined || rawValue === null || rawValue === '') {
        continue
      }

      result[columnId] = this.#wrapColumnValue(typeByColumnId[columnId], rawValue)
    }

    return JSON.stringify(result)
  }

  /**
   * Fetch a { columnId: columnType } map for a board so flat schema-loader values
   * can be wrapped into their per-type shapes. Returns {} on any failure.
   */
  async #getColumnTypeMap(boardId) {
    try {
      const data = await this.#graphqlRequest({
        query: `{ boards(ids: [${ boardId }]) { columns { id type } } }`,
        logTag: 'getColumnTypeMap',
      })

      const columns = data?.boards?.[0]?.columns || []
      const map = {}

      columns.forEach(col => {
        map[col.id] = col.type
      })

      return map
    } catch (error) {
      logger.error(`[getColumnTypeMap] Error: ${ error.message }`)

      return {}
    }
  }

  /**
   * Wrap a single flat scalar into the nested JSON shape Monday.com requires for
   * its column type. text/long_text/numbers (and any unrecognised type) stay
   * scalar. If the value is already a JSON object/array (advanced users), it is
   * honoured as-is so exact Monday shapes can always be supplied.
   */
  #wrapColumnValue(columnType, value) {
    switch (columnType) {
      case 'status':
        return this.#asObject(value) || { label: String(value) }
      case 'dropdown':
        return this.#asObject(value) || { labels: this.#toList(value) }
      case 'date':
        return this.#asObject(value) || { date: String(value) }
      case 'checkbox':
        return this.#asObject(value) || (this.#toBoolean(value) ? { checked: 'true' } : {})
      case 'people':
        return this.#asObject(value) || { personsAndTeams: this.#toList(value).map(id => ({ id: Number(id), kind: 'person' })) }
      case 'email':
        return this.#asObject(value) || { email: String(value), text: String(value) }
      case 'link':
        return this.#asObject(value) || { url: String(value), text: String(value) }
      case 'phone':
        return this.#asObject(value) || { phone: String(value) }
      case 'country':
        return this.#asObject(value) || { countryCode: String(value) }

      case 'hour': {
        const asObject = this.#asObject(value)

        if (asObject) {
          return asObject
        }

        const [hour, minute] = String(value).split(':')

        return { hour: Number(hour), minute: Number(minute || 0) }
      }

      case 'tags':
        return this.#asObject(value) || { tag_ids: this.#toList(value).map(Number) }
      case 'timeline':
      case 'week':
      case 'location':
        // Structured columns: the user supplies the full JSON object (see column hints).
        return this.#asObject(value) || value
      default:
        // text, long_text, numbers, rating, color_picker, and unknown types: plain scalar.
        return value
    }
  }

  /**
   * Return a parsed object/array when the value already is one (or is a JSON
   * object/array String); otherwise null so a scalar wrap is applied instead.
   */
  #asObject(value) {
    if (value !== null && typeof value === 'object') {
      return value
    }

    if (typeof value === 'string') {
      const trimmed = value.trim()

      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          return JSON.parse(trimmed)
        } catch {
          return null
        }
      }
    }

    return null
  }

  /** Split a comma-separated String (or pass an Array through) into a trimmed, non-empty list. */
  #toList(value) {
    if (Array.isArray(value)) {
      return value
    }

    return String(value).split(',').map(part => part.trim()).filter(Boolean)
  }

  /** Coerce a checkbox value (Boolean toggle or String) to a Boolean. */
  #toBoolean(value) {
    return value === true || value === 1 || value === 'true' || value === '1'
  }

  /**
   * Ensure a value is valid JSON for Monday.com's column value parameter.
   * If already valid JSON, returns as-is. Otherwise wraps as a JSON string.
   */
  #toColumnJson(value) {
    if (typeof value !== 'string') {
      return JSON.stringify(value)
    }

    try {
      JSON.parse(value)

      return value
    } catch {
      return JSON.stringify(value)
    }
  }

  async #fetchBoardItems(boardId) {
    return this.#collectBoardItems(
      boardId,
      'id name created_at group { id title } column_values { id column { title } text type }',
      'fetchBoardItems'
    )
  }

  async #fetchBoardItemsWithUpdatedAt(boardId) {
    return this.#collectBoardItems(
      boardId,
      'id name updated_at group { id title } column_values { id column { title } text type }',
      'fetchBoardItemsWithUpdatedAt'
    )
  }

  /**
   * Collect every item on a board, following next_items_page cursors past the
   * first 100 so polling triggers never miss items on large boards.
   */
  async #collectBoardItems(boardId, itemFields, logTag) {
    const MAX_PAGES = 100
    const items = []

    try {
      const first = await this.#graphqlRequest({
        query: `{ boards(ids: [${ boardId }]) { items_page(limit: 100) { cursor items { ${ itemFields } } } } }`,
        logTag,
      })

      let page = first.boards?.[0]?.items_page
      let pageCount = 0

      while (page) {
        items.push(...(page.items || []))

        const nextCursor = page.cursor

        if (!nextCursor || ++pageCount >= MAX_PAGES) {
          break
        }

        const next = await this.#graphqlRequest({
          query: `{ next_items_page(limit: 100, cursor: "${ nextCursor }") { cursor items { ${ itemFields } } } }`,
          logTag,
        })

        page = next.next_items_page
      }

      return items
    } catch (error) {
      logger.error(`[${ logTag }] Error: ${ error.message }`)

      return items
    }
  }
}

Flowrunner.ServerCode.addService(MondayDotCom, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your Monday.com app Client ID from the Developer Center.',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your Monday.com app Client Secret from the Developer Center.',
  },
])
