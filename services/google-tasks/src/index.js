'use strict'

const API_BASE_URL = 'https://tasks.googleapis.com/tasks/v1'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const USER_INFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

const DEFAULT_SCOPE_LIST = [
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const TASK_STATUS_OPTIONS = {
  'Needs Action': 'needsAction',
  'Completed': 'completed',
}

const logger = {
  info: (...args) => console.log('[Google Tasks] info:', ...args),
  debug: (...args) => console.log('[Google Tasks] debug:', ...args),
  error: (...args) => console.log('[Google Tasks] error:', ...args),
  warn: (...args) => console.log('[Google Tasks] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName Google Tasks
 * @integrationIcon /icon.svg
 **/
class GoogleTasksService {
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

      throw new Error(`Google Tasks API error: ${ message }`)
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

  #requireValue(value, label) {
    if (value === undefined || value === null || value === '') {
      throw new Error(`"${ label }" is required`)
    }

    return typeof value === 'string' ? value.trim() : value
  }

  // Accepts an RFC 3339 string, a date-only string (e.g. "2026-07-20") or an epoch-milliseconds
  // number (as produced by date pickers) and normalizes it to an RFC 3339 timestamp.
  #normalizeTimestamp(value, label) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    const date = new Date(typeof value === 'number' ? value : String(value).trim())

    if (isNaN(date.getTime())) {
      throw new Error(`"${ label }" must be a valid date (RFC 3339 timestamp, e.g. "2026-07-20T00:00:00Z", or a date like "2026-07-20")`)
    }

    return date.toISOString()
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
    let connectionIdentityName = 'Google Tasks Account'
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
   * @typedef {Object} getTaskListsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter task lists by title. Filtering is applied locally to the retrieved page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Task Lists Dictionary
   * @description Lists the connected user's Google Tasks task lists for selection in dependent parameters. Returns the task list title as the label and the task list ID as the value.
   * @route POST /get-task-lists-dictionary
   * @paramDef {"type":"getTaskListsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"My Tasks","value":"MTIzNDU2Nzg5MDEyMzQ1Njc4OTA","note":"Updated 2026-07-10"}],"cursor":"nextPageToken123"}
   */
  async getTaskListsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getTaskListsDictionary',
      url: `${ API_BASE_URL }/users/@me/lists`,
      query: {
        maxResults: 1000,
        pageToken: cursor,
      },
    })

    const taskLists = response.items || []

    const filteredTaskLists = search
      ? searchFilter(taskLists, ['title'], search)
      : taskLists

    return {
      cursor: response.nextPageToken,
      items: filteredTaskLists.map(taskList => ({
        label: taskList.title,
        value: taskList.id,
        note: taskList.updated ? `Updated ${ String(taskList.updated).slice(0, 10) }` : undefined,
      })),
    }
  }

  // =========================================== TASK LISTS =============================================

  /**
   * @description Creates a new task list in the connected user's Google Tasks account. The title supports up to 1024 characters. A user can have up to 2000 task lists.
   *
   * @route POST /create-task-list
   * @operationName Create Task List
   * @category Task Lists
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The title of the new task list. Supports up to 1024 characters."}
   *
   * @returns {Object}
   * @sampleResult {"kind":"tasks#taskList","id":"MTIzNDU2Nzg5MDEyMzQ1Njc4OTA","title":"Groceries","updated":"2026-07-14T10:15:00.000Z","selfLink":"https://www.googleapis.com/tasks/v1/users/@me/lists/MTIzNDU2Nzg5MDEyMzQ1Njc4OTA"}
   */
  async createTaskList(title) {
    return this.#apiRequest({
      logTag: 'createTaskList',
      method: 'post',
      url: `${ API_BASE_URL }/users/@me/lists`,
      body: { title: this.#requireValue(title, 'Title') },
    })
  }

  /**
   * @description Lists all task lists in the connected user's Google Tasks account, including the default "My Tasks" list. Supports pagination via page token. Returns up to 1000 task lists per page (the API default and maximum).
   *
   * @route GET /list-task-lists
   * @operationName List Task Lists
   * @category Task Lists
   *
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of task lists to return per page. Maximum and default: 1000."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous List Task Lists response ('nextPageToken') used to retrieve the next page of results."}
   *
   * @returns {Object}
   * @sampleResult {"kind":"tasks#taskLists","items":[{"kind":"tasks#taskList","id":"MTIzNDU2Nzg5MDEyMzQ1Njc4OTA","title":"My Tasks","updated":"2026-07-14T10:15:00.000Z"}],"nextPageToken":"nextPageToken123"}
   */
  async listTaskLists(maxResults, pageToken) {
    return this.#apiRequest({
      logTag: 'listTaskLists',
      url: `${ API_BASE_URL }/users/@me/lists`,
      query: {
        maxResults,
        pageToken,
      },
    })
  }

  /**
   * @description Renames an existing task list in the connected user's Google Tasks account. Uses a partial update (PATCH), so other task list properties are preserved.
   *
   * @route PATCH /update-task-list
   * @operationName Update Task List
   * @category Task Lists
   *
   * @paramDef {"type":"String","label":"Task List","name":"taskList","required":true,"dictionary":"getTaskListsDictionary","description":"The task list to rename. Select from the list or provide the task list ID directly."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The new title of the task list. Supports up to 1024 characters."}
   *
   * @returns {Object}
   * @sampleResult {"kind":"tasks#taskList","id":"MTIzNDU2Nzg5MDEyMzQ1Njc4OTA","title":"Weekend Errands","updated":"2026-07-14T10:20:00.000Z","selfLink":"https://www.googleapis.com/tasks/v1/users/@me/lists/MTIzNDU2Nzg5MDEyMzQ1Njc4OTA"}
   */
  async updateTaskList(taskList, title) {
    return this.#apiRequest({
      logTag: 'updateTaskList',
      method: 'patch',
      url: `${ API_BASE_URL }/users/@me/lists/${ encodeURIComponent(this.#requireValue(taskList, 'Task List')) }`,
      body: { title: this.#requireValue(title, 'Title') },
    })
  }

  /**
   * @description Permanently deletes a task list from the connected user's Google Tasks account, including all tasks it contains. The user's default task list cannot be deleted. This action cannot be undone.
   *
   * @route DELETE /delete-task-list
   * @operationName Delete Task List
   * @category Task Lists
   *
   * @paramDef {"type":"String","label":"Task List","name":"taskList","required":true,"dictionary":"getTaskListsDictionary","description":"The task list to delete. Select from the list or provide the task list ID directly."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Task list deleted successfully","taskListId":"MTIzNDU2Nzg5MDEyMzQ1Njc4OTA"}
   */
  async deleteTaskList(taskList) {
    const taskListId = this.#requireValue(taskList, 'Task List')

    await this.#apiRequest({
      logTag: 'deleteTaskList',
      method: 'delete',
      url: `${ API_BASE_URL }/users/@me/lists/${ encodeURIComponent(taskListId) }`,
    })

    return {
      success: true,
      message: 'Task list deleted successfully',
      taskListId,
    }
  }

  // ============================================== TASKS ===============================================

  /**
   * @description Creates a new task in a Google Tasks task list. Supports a title (up to 1024 characters), notes (up to 8192 characters), and a due date. Note: the Google Tasks API stores only the date portion of the due date — any time-of-day information is discarded and cannot be read back. Optionally position the task as a subtask (Parent Task ID) and/or after a specific sibling (Previous Task ID); by default the task is created at the top level, in the first position.
   *
   * @route POST /create-task
   * @operationName Create Task
   * @category Tasks
   *
   * @paramDef {"type":"String","label":"Task List","name":"taskList","required":true,"dictionary":"getTaskListsDictionary","description":"The task list to create the task in. Select from the list or provide the task list ID directly."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The title of the task. Supports up to 1024 characters."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional notes describing the task. Supports up to 8192 characters."}
   * @paramDef {"type":"String","label":"Due Date","name":"due","uiComponent":{"type":"DATE_PICKER"},"description":"Optional due date as an RFC 3339 timestamp (e.g. '2026-07-20T00:00:00Z') or a date (e.g. '2026-07-20'). The Google Tasks API records only the date — the time portion is discarded."}
   * @paramDef {"type":"String","label":"Parent Task ID","name":"parent","description":"Optional ID of an existing task in the same list to create this task under as a subtask. Omit to create the task at the top level."}
   * @paramDef {"type":"String","label":"Previous Task ID","name":"previous","description":"Optional ID of an existing sibling task after which this task is inserted. Omit to create the task in the first position among its siblings."}
   *
   * @returns {Object}
   * @sampleResult {"kind":"tasks#task","id":"YWJjZGVmZ2hpamtsbW5vcA","title":"Buy groceries","updated":"2026-07-14T10:30:00.000Z","position":"00000000000000000001","status":"needsAction","due":"2026-07-20T00:00:00.000Z","notes":"Milk, eggs, bread","webViewLink":"https://tasks.google.com/task/YWJjZGVmZ2hpamtsbW5vcA","selfLink":"https://www.googleapis.com/tasks/v1/lists/MTIzNDU2Nzg5MDEyMzQ1Njc4OTA/tasks/YWJjZGVmZ2hpamtsbW5vcA"}
   */
  async createTask(taskList, title, notes, due, parent, previous) {
    const body = cleanupObject({
      title: this.#requireValue(title, 'Title'),
      notes,
      due: this.#normalizeTimestamp(due, 'Due Date'),
    })

    return this.#apiRequest({
      logTag: 'createTask',
      method: 'post',
      url: `${ API_BASE_URL }/lists/${ encodeURIComponent(this.#requireValue(taskList, 'Task List')) }/tasks`,
      query: {
        parent,
        previous,
      },
      body,
    })
  }

  /**
   * @description Retrieves a single task from a Google Tasks task list by its ID, including its title, notes, status, due date, completion date, position, and parent.
   *
   * @route GET /get-task
   * @operationName Get Task
   * @category Tasks
   *
   * @paramDef {"type":"String","label":"Task List","name":"taskList","required":true,"dictionary":"getTaskListsDictionary","description":"The task list containing the task. Select from the list or provide the task list ID directly."}
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The ID of the task to retrieve (returned in the 'id' field when a task is created or listed)."}
   *
   * @returns {Object}
   * @sampleResult {"kind":"tasks#task","id":"YWJjZGVmZ2hpamtsbW5vcA","title":"Buy groceries","updated":"2026-07-14T10:30:00.000Z","position":"00000000000000000001","status":"needsAction","due":"2026-07-20T00:00:00.000Z","notes":"Milk, eggs, bread","webViewLink":"https://tasks.google.com/task/YWJjZGVmZ2hpamtsbW5vcA"}
   */
  async getTask(taskList, taskId) {
    return this.#apiRequest({
      logTag: 'getTask',
      url: `${ API_BASE_URL }/lists/${ encodeURIComponent(this.#requireValue(taskList, 'Task List')) }/tasks/${ encodeURIComponent(this.#requireValue(taskId, 'Task ID')) }`,
    })
  }

  /**
   * @description Lists tasks in a Google Tasks task list, with optional filtering by due date range and completion date range, and pagination. Completed tasks are included by default; to also see tasks completed in Google's own clients (which are cleared to a hidden state), enable Show Hidden as well. Returns up to 100 tasks per page (API default: 20).
   *
   * @route GET /list-tasks
   * @operationName List Tasks
   * @category Tasks
   *
   * @paramDef {"type":"String","label":"Task List","name":"taskList","required":true,"dictionary":"getTaskListsDictionary","description":"The task list to list tasks from. Select from the list or provide the task list ID directly."}
   * @paramDef {"type":"Boolean","label":"Show Completed","name":"showCompleted","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"Whether completed tasks are included in the result. Default: true. Note: tasks completed in first-party Google clients are hidden after clearing — enable Show Hidden to include them."}
   * @paramDef {"type":"Boolean","label":"Show Hidden","name":"showHidden","defaultValue":false,"uiComponent":{"type":"TOGGLE"},"description":"Whether hidden tasks (completed tasks that have been cleared) are included in the result. Default: false."}
   * @paramDef {"type":"String","label":"Due After","name":"dueMin","uiComponent":{"type":"DATE_PICKER"},"description":"Lower bound for a task's due date to filter by, as an RFC 3339 timestamp or a date (e.g. '2026-07-01'). Optional."}
   * @paramDef {"type":"String","label":"Due Before","name":"dueMax","uiComponent":{"type":"DATE_PICKER"},"description":"Upper bound for a task's due date to filter by, as an RFC 3339 timestamp or a date (e.g. '2026-07-31'). Optional."}
   * @paramDef {"type":"String","label":"Completed After","name":"completedMin","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Lower bound for a task's completion date to filter by, as an RFC 3339 timestamp (e.g. '2026-07-01T00:00:00Z'). Optional."}
   * @paramDef {"type":"String","label":"Completed Before","name":"completedMax","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Upper bound for a task's completion date to filter by, as an RFC 3339 timestamp (e.g. '2026-07-31T23:59:59Z'). Optional."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tasks to return per page. Maximum: 100. Default: 20."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous List Tasks response ('nextPageToken') used to retrieve the next page of results."}
   *
   * @returns {Object}
   * @sampleResult {"kind":"tasks#tasks","items":[{"kind":"tasks#task","id":"YWJjZGVmZ2hpamtsbW5vcA","title":"Buy groceries","status":"needsAction","due":"2026-07-20T00:00:00.000Z","position":"00000000000000000001","updated":"2026-07-14T10:30:00.000Z"}],"nextPageToken":"nextPageToken123"}
   */
  async listTasks(taskList, showCompleted, showHidden, dueMin, dueMax, completedMin, completedMax, maxResults, pageToken) {
    return this.#apiRequest({
      logTag: 'listTasks',
      url: `${ API_BASE_URL }/lists/${ encodeURIComponent(this.#requireValue(taskList, 'Task List')) }/tasks`,
      query: {
        showCompleted,
        showHidden,
        dueMin: this.#normalizeTimestamp(dueMin, 'Due After'),
        dueMax: this.#normalizeTimestamp(dueMax, 'Due Before'),
        completedMin: this.#normalizeTimestamp(completedMin, 'Completed After'),
        completedMax: this.#normalizeTimestamp(completedMax, 'Completed Before'),
        maxResults,
        pageToken,
      },
    })
  }

  /**
   * @description Updates an existing task in a Google Tasks task list. Only the provided fields are changed (partial update via PATCH); omitted fields keep their current values. Note: the Google Tasks API stores only the date portion of the due date — any time-of-day information is discarded. Setting Status to 'Completed' records the completion time automatically; setting it to 'Needs Action' reopens the task.
   *
   * @route PATCH /update-task
   * @operationName Update Task
   * @category Tasks
   *
   * @paramDef {"type":"String","label":"Task List","name":"taskList","required":true,"dictionary":"getTaskListsDictionary","description":"The task list containing the task. Select from the list or provide the task list ID directly."}
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The ID of the task to update."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New title of the task. Supports up to 1024 characters. Leave empty to keep the current title."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New notes for the task. Supports up to 8192 characters. Leave empty to keep the current notes."}
   * @paramDef {"type":"String","label":"Due Date","name":"due","uiComponent":{"type":"DATE_PICKER"},"description":"New due date as an RFC 3339 timestamp or a date (e.g. '2026-07-20'). The Google Tasks API records only the date — the time portion is discarded. Leave empty to keep the current due date."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Needs Action","Completed"]}},"description":"New status of the task. 'Completed' marks the task done and records the completion time; 'Needs Action' reopens it. Leave empty to keep the current status."}
   *
   * @returns {Object}
   * @sampleResult {"kind":"tasks#task","id":"YWJjZGVmZ2hpamtsbW5vcA","title":"Buy groceries and snacks","updated":"2026-07-14T11:00:00.000Z","position":"00000000000000000001","status":"needsAction","due":"2026-07-21T00:00:00.000Z","notes":"Milk, eggs, bread, chips"}
   */
  async updateTask(taskList, taskId, title, notes, due, status) {
    const resolvedStatus = this.#resolveChoice(status, TASK_STATUS_OPTIONS)

    const body = cleanupObject({
      title,
      notes,
      due: this.#normalizeTimestamp(due, 'Due Date'),
      status: resolvedStatus,
    })

    if (resolvedStatus === 'needsAction') {
      // The completion timestamp must be cleared explicitly when reopening a task
      body.completed = null
    }

    if (!Object.keys(body).length) {
      throw new Error('At least one of "Title", "Notes", "Due Date" or "Status" must be provided')
    }

    return this.#apiRequest({
      logTag: 'updateTask',
      method: 'patch',
      url: `${ API_BASE_URL }/lists/${ encodeURIComponent(this.#requireValue(taskList, 'Task List')) }/tasks/${ encodeURIComponent(this.#requireValue(taskId, 'Task ID')) }`,
      body,
    })
  }

  /**
   * @description Marks a task in a Google Tasks task list as completed. The completion time is recorded automatically by the API. Completed tasks remain in the list (in a completed state) until they are cleared with Clear Completed Tasks.
   *
   * @route PATCH /complete-task
   * @operationName Complete Task
   * @category Tasks
   *
   * @paramDef {"type":"String","label":"Task List","name":"taskList","required":true,"dictionary":"getTaskListsDictionary","description":"The task list containing the task. Select from the list or provide the task list ID directly."}
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The ID of the task to mark as completed."}
   *
   * @returns {Object}
   * @sampleResult {"kind":"tasks#task","id":"YWJjZGVmZ2hpamtsbW5vcA","title":"Buy groceries","updated":"2026-07-14T12:00:00.000Z","position":"00000000000000000001","status":"completed","completed":"2026-07-14T12:00:00.000Z","due":"2026-07-20T00:00:00.000Z"}
   */
  async completeTask(taskList, taskId) {
    return this.#apiRequest({
      logTag: 'completeTask',
      method: 'patch',
      url: `${ API_BASE_URL }/lists/${ encodeURIComponent(this.#requireValue(taskList, 'Task List')) }/tasks/${ encodeURIComponent(this.#requireValue(taskId, 'Task ID')) }`,
      body: { status: 'completed' },
    })
  }

  /**
   * @description Reopens a completed task in a Google Tasks task list by setting its status back to 'needsAction' and clearing its completion time. If the task was hidden after being cleared, it becomes visible again.
   *
   * @route PATCH /reopen-task
   * @operationName Reopen Task
   * @category Tasks
   *
   * @paramDef {"type":"String","label":"Task List","name":"taskList","required":true,"dictionary":"getTaskListsDictionary","description":"The task list containing the task. Select from the list or provide the task list ID directly."}
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The ID of the completed task to reopen."}
   *
   * @returns {Object}
   * @sampleResult {"kind":"tasks#task","id":"YWJjZGVmZ2hpamtsbW5vcA","title":"Buy groceries","updated":"2026-07-14T12:30:00.000Z","position":"00000000000000000001","status":"needsAction","due":"2026-07-20T00:00:00.000Z"}
   */
  async reopenTask(taskList, taskId) {
    return this.#apiRequest({
      logTag: 'reopenTask',
      method: 'patch',
      url: `${ API_BASE_URL }/lists/${ encodeURIComponent(this.#requireValue(taskList, 'Task List')) }/tasks/${ encodeURIComponent(this.#requireValue(taskId, 'Task ID')) }`,
      body: { status: 'needsAction', completed: null },
    })
  }

  /**
   * @description Permanently deletes a task from a Google Tasks task list. If the task has subtasks, they are deleted as well. This action cannot be undone.
   *
   * @route DELETE /delete-task
   * @operationName Delete Task
   * @category Tasks
   *
   * @paramDef {"type":"String","label":"Task List","name":"taskList","required":true,"dictionary":"getTaskListsDictionary","description":"The task list containing the task. Select from the list or provide the task list ID directly."}
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The ID of the task to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Task deleted successfully","taskId":"YWJjZGVmZ2hpamtsbW5vcA","taskListId":"MTIzNDU2Nzg5MDEyMzQ1Njc4OTA"}
   */
  async deleteTask(taskList, taskId) {
    const taskListId = this.#requireValue(taskList, 'Task List')
    const id = this.#requireValue(taskId, 'Task ID')

    await this.#apiRequest({
      logTag: 'deleteTask',
      method: 'delete',
      url: `${ API_BASE_URL }/lists/${ encodeURIComponent(taskListId) }/tasks/${ encodeURIComponent(id) }`,
    })

    return {
      success: true,
      message: 'Task deleted successfully',
      taskId: id,
      taskListId,
    }
  }

  /**
   * @description Moves a task to another position in its Google Tasks task list, or to a different task list. Provide a Parent Task ID to make the task a subtask, a Previous Task ID to place it after a specific sibling, and/or a Destination Task List to move it to another list. Omitting Parent and Previous moves the task to the top level, in the first position.
   *
   * @route POST /move-task
   * @operationName Move Task
   * @category Tasks
   *
   * @paramDef {"type":"String","label":"Task List","name":"taskList","required":true,"dictionary":"getTaskListsDictionary","description":"The task list currently containing the task. Select from the list or provide the task list ID directly."}
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The ID of the task to move."}
   * @paramDef {"type":"String","label":"Parent Task ID","name":"parent","description":"Optional ID of the task to become the new parent (making this task a subtask). Omit to move the task to the top level. An assigned task cannot be a parent or have a parent."}
   * @paramDef {"type":"String","label":"Previous Task ID","name":"previous","description":"Optional ID of the sibling task after which this task is placed. Omit to move the task to the first position among its siblings."}
   * @paramDef {"type":"String","label":"Destination Task List","name":"destinationTaskList","dictionary":"getTaskListsDictionary","description":"Optional target task list to move the task into. Omit to move the task within its current list."}
   *
   * @returns {Object}
   * @sampleResult {"kind":"tasks#task","id":"YWJjZGVmZ2hpamtsbW5vcA","title":"Buy groceries","updated":"2026-07-14T13:00:00.000Z","position":"00000000000000000002","status":"needsAction","parent":"cGFyZW50VGFza0lk"}
   */
  async moveTask(taskList, taskId, parent, previous, destinationTaskList) {
    return this.#apiRequest({
      logTag: 'moveTask',
      method: 'post',
      url: `${ API_BASE_URL }/lists/${ encodeURIComponent(this.#requireValue(taskList, 'Task List')) }/tasks/${ encodeURIComponent(this.#requireValue(taskId, 'Task ID')) }/move`,
      query: {
        parent,
        previous,
        destinationTasklist: destinationTaskList,
      },
    })
  }

  /**
   * @description Clears all completed tasks from a Google Tasks task list. The cleared tasks are not deleted — they are marked as hidden and no longer appear in default task listings, but can still be retrieved with List Tasks when Show Hidden is enabled.
   *
   * @route POST /clear-completed-tasks
   * @operationName Clear Completed Tasks
   * @category Tasks
   *
   * @paramDef {"type":"String","label":"Task List","name":"taskList","required":true,"dictionary":"getTaskListsDictionary","description":"The task list to clear completed tasks from. Select from the list or provide the task list ID directly."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Completed tasks cleared successfully","taskListId":"MTIzNDU2Nzg5MDEyMzQ1Njc4OTA"}
   */
  async clearCompletedTasks(taskList) {
    const taskListId = this.#requireValue(taskList, 'Task List')

    await this.#apiRequest({
      logTag: 'clearCompletedTasks',
      method: 'post',
      url: `${ API_BASE_URL }/lists/${ encodeURIComponent(taskListId) }/clear`,
    })

    return {
      success: true,
      message: 'Completed tasks cleared successfully',
      taskListId,
    }
  }
}

Flowrunner.ServerCode.addService(GoogleTasksService, [
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
