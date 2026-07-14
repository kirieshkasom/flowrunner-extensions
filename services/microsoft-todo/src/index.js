const OAUTH_BASE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const API_BASE_URL = 'https://graph.microsoft.com/v1.0'
const TODO_BASE_URL = `${ API_BASE_URL }/me/todo`
const PAGE_SIZE_DICTIONARY = 20

const DEFAULT_SCOPE_LIST = [
  'offline_access',
  'User.Read',
  'Tasks.ReadWrite',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const logger = {
  info: (...args) => console.log('[Microsoft To Do] info:', ...args),
  debug: (...args) => console.log('[Microsoft To Do] debug:', ...args),
  error: (...args) => console.log('[Microsoft To Do] error:', ...args),
  warn: (...args) => console.log('[Microsoft To Do] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName Microsoft To Do
 * @integrationIcon /icon.svg
 **/
class MicrosoftToDoService {
  /**
   * @typedef {Object} getTaskListsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter task lists by display name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination link for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getTasksDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Task List ID","name":"taskListId","required":true,"description":"The ID of the task list whose tasks to list."}
   */

  /**
   * @typedef {Object} getTasksDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter tasks by title. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination link for retrieving the next page of results."}
   * @paramDef {"type":"getTasksDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The task list whose tasks to list."}
   */
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  #getAccessTokenHeader(accessToken) {
    return {
      Authorization: `Bearer ${ this.request.headers['oauth-access-token'] || accessToken }`,
    }
  }

  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'
    query = cleanupObject(query)

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      return await Flowrunner.Request[method](url).set(this.#getAccessTokenHeader()).query(query).send(body)
    } catch (error) {
      const message = error.body?.error?.message || error.message

      logger.error(`${ logTag } - error: ${ message }`)

      throw new Error(`Microsoft To Do API error: ${ message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #buildDateTimeTimeZone(dateTime, timeZone) {
    if (!dateTime) {
      return undefined
    }

    const value = String(dateTime).trim()
    const normalized = value.includes('T') ? value : `${ value }T00:00:00`

    return {
      dateTime: normalized.replace(/(Z|[+-]\d{2}:\d{2})$/, ''),
      timeZone: timeZone || 'UTC',
    }
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()
    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('scope', this.scopes)
    params.append('response_mode', 'query')

    return `${ OAUTH_BASE_URL }/authorize?${ params.toString() }`
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   * @property {String} token
   * @property {String} refreshToken
   * @property {Number} expirationInSeconds
   * @property {Object} userData
   * @property {String} connectionIdentityName
   * @property {Boolean} overwrite
   */

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    const code = callbackObject.code
    const url = `${ OAUTH_BASE_URL }/token`

    const params = new URLSearchParams()
    params.append('client_id', this.clientId)
    params.append('code', code)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('grant_type', 'authorization_code')
    params.append('client_secret', this.clientSecret)

    const response = await Flowrunner.Request.post(url)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    let userData = {}

    try {
      userData = await Flowrunner.Request.get(`${ API_BASE_URL }/me`).set({
        Authorization: `Bearer ${ response.access_token }`,
        'Content-Type': 'application/json',
      })

      logger.debug(`[executeCallback] userData response: ${ JSON.stringify(userData, null, 2) }`)
    } catch (error) {
      logger.error(`[executeCallback] getUserProfile error: ${ error.message }`)
    }

    return {
      token: response.access_token,
      refreshToken: response.refresh_token,
      expirationInSeconds: response.expires_in,
      connectionIdentityName: constructIdentityName(userData),
      overwrite: true,
      userData: userData,
    }
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   * @property {String} token
   * @property {Number} expirationInSeconds
   * @property {String} refreshToken
   */

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    const url = `${ OAUTH_BASE_URL }/token`

    const params = new URLSearchParams()
    params.append('client_id', this.clientId)
    params.append('scope', this.scopes)
    params.append('refresh_token', refreshToken)
    params.append('grant_type', 'refresh_token')
    params.append('client_secret', this.clientSecret)

    try {
      const response = await Flowrunner.Request.post(url)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      return {
        token: response.access_token,
        refreshToken: response.refresh_token,
        expirationInSeconds: response.expires_in,
      }
    } catch (error) {
      logger.error('Error refreshing token: ', error.message || error)
      throw error
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Task Lists Dictionary
   * @description Provides a searchable list of the signed-in user's To Do task lists for dynamic parameter selection.
   * @route POST /get-task-lists-dictionary
   * @paramDef {"type":"getTaskListsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering task lists."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Tasks","value":"AQMkADAwATM0MDAAMS0yMDVhLTgxOTAtMDACLTAwCgAuAAAD","note":"Default list"}],"cursor":null}
   */
  async getTaskListsDictionary(payload) {
    const { search, cursor } = payload || {}
    const url = cursor ? cursor : `${ TODO_BASE_URL }/lists`
    const query = cursor ? undefined : { $top: PAGE_SIZE_DICTIONARY }

    const response = await this.#apiRequest({
      url,
      query,
      logTag: 'getTaskListsDictionary',
    })

    const lists = response.value || []
    const filteredLists = search ? searchFilter(lists, ['displayName'], search) : lists

    return {
      cursor: response['@odata.nextLink'] || null,
      items: filteredLists.map(({ id, displayName, wellknownListName }) => ({
        label: displayName,
        note: wellknownListName && wellknownListName !== 'none' ? 'Default list' : `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tasks Dictionary
   * @description Provides a searchable list of tasks within a selected task list for dynamic parameter selection. Requires a task list to be chosen first.
   * @route POST /get-tasks-dictionary
   * @paramDef {"type":"getTasksDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string, pagination cursor, and the task list criteria whose tasks to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Prepare quarterly report","value":"AAMkADAwATM0MDAAMS0yMDVhLTgxOTAtMDACLTAwCgBGAAAD","note":"Status: notStarted"}],"cursor":null}
   */
  async getTasksDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const taskListId = criteria?.taskListId

    if (!taskListId) {
      return { items: [], cursor: null }
    }

    const url = cursor ? cursor : `${ TODO_BASE_URL }/lists/${ taskListId }/tasks`
    const query = cursor ? undefined : { $top: PAGE_SIZE_DICTIONARY }

    const response = await this.#apiRequest({
      url,
      query,
      logTag: 'getTasksDictionary',
    })

    const tasks = response.value || []
    const filteredTasks = search ? searchFilter(tasks, ['title'], search) : tasks

    return {
      cursor: response['@odata.nextLink'] || null,
      items: filteredTasks.map(({ id, title, status }) => ({
        label: title,
        note: `Status: ${ status }`,
        value: id,
      })),
    }
  }

  /**
   * @operationName Create Task List
   * @category Task Lists
   * @appearanceColor #2564CF #185ABD
   * @description Creates a new task list in the signed-in user's Microsoft To Do account with the given display name.
   * @route POST /create-task-list
   * @paramDef {"type":"String","label":"List Name","name":"displayName","required":true,"description":"The display name of the new task list."}
   * @returns {Object}
   * @sampleResult {"id":"AQMkADAwATM0MDAAMS0yMDVhLTgxOTAtMDACLTAwCgAuAAAD","displayName":"Groceries","isOwner":true,"isShared":false,"wellknownListName":"none"}
   */
  async createTaskList(displayName) {
    if (!displayName) {
      throw new Error('Parameter "List Name" is required')
    }

    return this.#apiRequest({
      url: `${ TODO_BASE_URL }/lists`,
      logTag: 'createTaskList',
      method: 'post',
      body: { displayName },
    })
  }

  /**
   * @operationName List Task Lists
   * @category Task Lists
   * @appearanceColor #2564CF #185ABD
   * @description Retrieves the signed-in user's To Do task lists, including each list's ID, display name, ownership, sharing status, and well-known list name (such as the default Tasks list).
   * @route GET /list-task-lists
   * @paramDef {"type":"Number","label":"Max Results","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The maximum number of task lists to retrieve per page. Defaults to the Microsoft Graph server-side page size when omitted."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"URL to retrieve the next page of results. If provided, all other parameters are ignored."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"AQMkADAwATM0MDAAMS0yMDVhLTgxOTAtMDACLTAwCgAuAAAD","displayName":"Tasks","isOwner":true,"isShared":false,"wellknownListName":"defaultList"}],"@odata.nextLink":"https://graph.microsoft.com/v1.0/me/todo/lists?$skiptoken=abc"}
   */
  async listTaskLists(top, nextLink) {
    if (nextLink) {
      return this.#apiRequest({
        url: nextLink,
        logTag: 'listTaskLists',
      })
    }

    return this.#apiRequest({
      url: `${ TODO_BASE_URL }/lists`,
      logTag: 'listTaskLists',
      query: { $top: top },
    })
  }

  /**
   * @operationName Update Task List
   * @category Task Lists
   * @appearanceColor #2564CF #185ABD
   * @description Renames an existing task list. Well-known lists such as the default Tasks list cannot be renamed.
   * @route PATCH /update-task-list
   * @paramDef {"type":"String","label":"Task List","name":"taskListId","required":true,"dictionary":"getTaskListsDictionary","description":"The task list to rename. Choose a list or paste a task list ID."}
   * @paramDef {"type":"String","label":"New List Name","name":"displayName","required":true,"description":"The new display name for the task list."}
   * @returns {Object}
   * @sampleResult {"id":"AQMkADAwATM0MDAAMS0yMDVhLTgxOTAtMDACLTAwCgAuAAAD","displayName":"Weekly Groceries","isOwner":true,"isShared":false,"wellknownListName":"none"}
   */
  async updateTaskList(taskListId, displayName) {
    if (!taskListId) {
      throw new Error('Parameter "Task List" is required')
    }

    if (!displayName) {
      throw new Error('Parameter "New List Name" is required')
    }

    return this.#apiRequest({
      url: `${ TODO_BASE_URL }/lists/${ taskListId }`,
      logTag: 'updateTaskList',
      method: 'patch',
      body: { displayName },
    })
  }

  /**
   * @operationName Delete Task List
   * @category Task Lists
   * @appearanceColor #2564CF #185ABD
   * @description Permanently deletes a task list and all tasks it contains. Well-known lists such as the default Tasks list cannot be deleted.
   * @route DELETE /delete-task-list
   * @paramDef {"type":"String","label":"Task List","name":"taskListId","required":true,"dictionary":"getTaskListsDictionary","description":"The task list to delete. Choose a list or paste a task list ID."}
   * @returns {Object}
   * @sampleResult {"message":"Task list deleted successfully"}
   */
  async deleteTaskList(taskListId) {
    if (!taskListId) {
      throw new Error('Parameter "Task List" is required')
    }

    await this.#apiRequest({
      url: `${ TODO_BASE_URL }/lists/${ taskListId }`,
      logTag: 'deleteTaskList',
      method: 'delete',
    })

    return { message: 'Task list deleted successfully' }
  }

  /**
   * @operationName Create Task
   * @category Tasks
   * @appearanceColor #2564CF #185ABD
   * @description Creates a new task in a task list. Supports a plain-text body, due date, reminder, importance level, categories, and an optional Microsoft Graph recurrence pattern for repeating tasks.
   * @route POST /create-task
   * @paramDef {"type":"String","label":"Task List","name":"taskListId","required":true,"dictionary":"getTaskListsDictionary","description":"The task list in which to create the task. Choose a list or paste a task list ID."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"A brief title of the task."}
   * @paramDef {"type":"String","label":"Body","name":"bodyContent","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional plain-text notes describing the task in detail."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDateTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional date (YYYY-MM-DD) or date-time (YYYY-MM-DDTHH:mm:ss) when the task is due, interpreted in the specified Time Zone."}
   * @paramDef {"type":"String","label":"Reminder Date","name":"reminderDateTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional date-time (YYYY-MM-DDTHH:mm:ss) for a reminder alert, interpreted in the specified Time Zone. Setting a reminder automatically turns the reminder on."}
   * @paramDef {"type":"String","label":"Time Zone","name":"timeZone","defaultValue":"UTC","description":"The time zone in which the due date and reminder are interpreted, such as UTC, Pacific Standard Time, or America/New_York. Defaults to UTC."}
   * @paramDef {"type":"String","label":"Importance","name":"importance","defaultValue":"Normal","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Normal","High"]}},"description":"The importance of the task. High-importance tasks are marked with a star in Microsoft To Do. Defaults to Normal."}
   * @paramDef {"type":"Array<String>","label":"Categories","name":"categories","description":"Optional list of Outlook category names to associate with the task, e.g. [\"Red category\",\"Work\"]."}
   * @paramDef {"type":"Object","label":"Recurrence","name":"recurrence","description":"Optional Microsoft Graph patternedRecurrence object for repeating tasks, e.g. {\"pattern\":{\"type\":\"daily\",\"interval\":1},\"range\":{\"type\":\"noEnd\",\"startDate\":\"2026-07-14\"}}. Passed through to the API as-is."}
   * @returns {Object}
   * @sampleResult {"id":"AAMkADAwATM0MDAAMS0yMDVhLTgxOTAtMDACLTAwCgBGAAAD","title":"Prepare quarterly report","status":"notStarted","importance":"high","body":{"content":"Include revenue breakdown","contentType":"text"},"dueDateTime":{"dateTime":"2026-07-20T00:00:00.0000000","timeZone":"UTC"},"categories":["Work"],"createdDateTime":"2026-07-14T10:00:00Z","lastModifiedDateTime":"2026-07-14T10:00:00Z"}
   */
  async createTask(taskListId, title, bodyContent, dueDateTime, reminderDateTime, timeZone, importance, categories, recurrence) {
    if (!taskListId) {
      throw new Error('Parameter "Task List" is required')
    }

    if (!title) {
      throw new Error('Parameter "Title" is required')
    }

    const reminder = this.#buildDateTimeTimeZone(reminderDateTime, timeZone)

    const body = cleanupObject({
      title,
      body: bodyContent ? { content: bodyContent, contentType: 'text' } : undefined,
      dueDateTime: this.#buildDateTimeTimeZone(dueDateTime, timeZone),
      reminderDateTime: reminder,
      isReminderOn: reminder ? true : undefined,
      importance: this.#resolveChoice(importance, { Low: 'low', Normal: 'normal', High: 'high' }),
      categories: categories && categories.length ? categories : undefined,
      recurrence,
    })

    return this.#apiRequest({
      url: `${ TODO_BASE_URL }/lists/${ taskListId }/tasks`,
      logTag: 'createTask',
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Get Task
   * @category Tasks
   * @appearanceColor #2564CF #185ABD
   * @description Retrieves a single task by its ID, including its title, body, status, importance, due date, reminder, categories, and recurrence settings.
   * @route GET /get-task
   * @paramDef {"type":"String","label":"Task List","name":"taskListId","required":true,"dictionary":"getTaskListsDictionary","description":"The task list that contains the task. Choose a list or paste a task list ID."}
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["taskListId"],"description":"The task to retrieve. Choose a task list above to pick from its tasks, or paste a task ID."}
   * @returns {Object}
   * @sampleResult {"id":"AAMkADAwATM0MDAAMS0yMDVhLTgxOTAtMDACLTAwCgBGAAAD","title":"Prepare quarterly report","status":"inProgress","importance":"high","body":{"content":"Include revenue breakdown","contentType":"text"},"dueDateTime":{"dateTime":"2026-07-20T00:00:00.0000000","timeZone":"UTC"},"isReminderOn":false,"categories":["Work"],"createdDateTime":"2026-07-14T10:00:00Z","lastModifiedDateTime":"2026-07-14T12:00:00Z"}
   */
  async getTask(taskListId, taskId) {
    if (!taskListId) {
      throw new Error('Parameter "Task List" is required')
    }

    if (!taskId) {
      throw new Error('Parameter "Task" is required')
    }

    return this.#apiRequest({
      url: `${ TODO_BASE_URL }/lists/${ taskListId }/tasks/${ taskId }`,
      logTag: 'getTask',
    })
  }

  /**
   * @operationName List Tasks
   * @category Tasks
   * @appearanceColor #2564CF #185ABD
   * @description Retrieves tasks from a task list, optionally filtered by completion status. Supports paging via Max Results and Skip, or via the Next Page Link returned by a previous call.
   * @route GET /list-tasks
   * @paramDef {"type":"String","label":"Task List","name":"taskListId","required":true,"dictionary":"getTaskListsDictionary","description":"The task list whose tasks to retrieve. Choose a list or paste a task list ID."}
   * @paramDef {"type":"String","label":"Status","name":"status","defaultValue":"All","uiComponent":{"type":"DROPDOWN","options":{"values":["All","Completed","Not Completed"]}},"description":"Filter tasks by completion status. Defaults to All."}
   * @paramDef {"type":"Number","label":"Max Results","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The maximum number of tasks to retrieve per page. Defaults to the Microsoft Graph server-side page size when omitted."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The number of tasks to skip before returning results. Useful for offset-based paging."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"URL to retrieve the next page of results. If provided, all other parameters are ignored."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"AAMkADAwATM0MDAAMS0yMDVhLTgxOTAtMDACLTAwCgBGAAAD","title":"Prepare quarterly report","status":"notStarted","importance":"normal","dueDateTime":{"dateTime":"2026-07-20T00:00:00.0000000","timeZone":"UTC"}}],"@odata.nextLink":"https://graph.microsoft.com/v1.0/me/todo/lists/AQMkADAw/tasks?$skip=10"}
   */
  async listTasks(taskListId, status, top, skip, nextLink) {
    if (nextLink) {
      return this.#apiRequest({
        url: nextLink,
        logTag: 'listTasks',
      })
    }

    if (!taskListId) {
      throw new Error('Parameter "Task List" is required')
    }

    const filter = this.#resolveChoice(status, {
      'All': undefined,
      'Completed': "status eq 'completed'",
      'Not Completed': "status ne 'completed'",
    })

    return this.#apiRequest({
      url: `${ TODO_BASE_URL }/lists/${ taskListId }/tasks`,
      logTag: 'listTasks',
      query: {
        $filter: filter,
        $top: top,
        $skip: skip,
      },
    })
  }

  /**
   * @operationName Update Task
   * @category Tasks
   * @appearanceColor #2564CF #185ABD
   * @description Updates one or more properties of an existing task. Only the provided fields are changed; omitted fields keep their current values. Use Complete Task or Reopen Task to change the completion status.
   * @route PATCH /update-task
   * @paramDef {"type":"String","label":"Task List","name":"taskListId","required":true,"dictionary":"getTaskListsDictionary","description":"The task list that contains the task. Choose a list or paste a task list ID."}
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["taskListId"],"description":"The task to update. Choose a task list above to pick from its tasks, or paste a task ID."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"A new title for the task."}
   * @paramDef {"type":"String","label":"Body","name":"bodyContent","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New plain-text notes for the task. Replaces the existing body."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDateTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"New date (YYYY-MM-DD) or date-time (YYYY-MM-DDTHH:mm:ss) when the task is due, interpreted in the specified Time Zone."}
   * @paramDef {"type":"String","label":"Reminder Date","name":"reminderDateTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"New date-time (YYYY-MM-DDTHH:mm:ss) for a reminder alert, interpreted in the specified Time Zone. Setting a reminder automatically turns the reminder on."}
   * @paramDef {"type":"String","label":"Time Zone","name":"timeZone","defaultValue":"UTC","description":"The time zone in which the due date and reminder are interpreted, such as UTC, Pacific Standard Time, or America/New_York. Defaults to UTC."}
   * @paramDef {"type":"String","label":"Importance","name":"importance","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Normal","High"]}},"description":"A new importance level for the task."}
   * @paramDef {"type":"Array<String>","label":"Categories","name":"categories","description":"New list of Outlook category names for the task. Replaces the existing categories."}
   * @paramDef {"type":"Object","label":"Recurrence","name":"recurrence","description":"New Microsoft Graph patternedRecurrence object for the task, e.g. {\"pattern\":{\"type\":\"weekly\",\"interval\":1,\"daysOfWeek\":[\"monday\"]},\"range\":{\"type\":\"noEnd\",\"startDate\":\"2026-07-14\"}}. Passed through to the API as-is."}
   * @returns {Object}
   * @sampleResult {"id":"AAMkADAwATM0MDAAMS0yMDVhLTgxOTAtMDACLTAwCgBGAAAD","title":"Prepare quarterly report v2","status":"notStarted","importance":"high","body":{"content":"Include revenue and cost breakdown","contentType":"text"},"dueDateTime":{"dateTime":"2026-07-22T00:00:00.0000000","timeZone":"UTC"},"lastModifiedDateTime":"2026-07-14T15:00:00Z"}
   */
  async updateTask(taskListId, taskId, title, bodyContent, dueDateTime, reminderDateTime, timeZone, importance, categories, recurrence) {
    if (!taskListId) {
      throw new Error('Parameter "Task List" is required')
    }

    if (!taskId) {
      throw new Error('Parameter "Task" is required')
    }

    const reminder = this.#buildDateTimeTimeZone(reminderDateTime, timeZone)

    const body = cleanupObject({
      title,
      body: bodyContent ? { content: bodyContent, contentType: 'text' } : undefined,
      dueDateTime: this.#buildDateTimeTimeZone(dueDateTime, timeZone),
      reminderDateTime: reminder,
      isReminderOn: reminder ? true : undefined,
      importance: this.#resolveChoice(importance, { Low: 'low', Normal: 'normal', High: 'high' }),
      categories: categories && categories.length ? categories : undefined,
      recurrence,
    })

    if (!Object.keys(body).length) {
      throw new Error('At least one field to update must be provided')
    }

    return this.#apiRequest({
      url: `${ TODO_BASE_URL }/lists/${ taskListId }/tasks/${ taskId }`,
      logTag: 'updateTask',
      method: 'patch',
      body,
    })
  }

  /**
   * @operationName Complete Task
   * @category Tasks
   * @appearanceColor #2564CF #185ABD
   * @description Marks a task as completed. For recurring tasks, Microsoft To Do automatically creates the next occurrence.
   * @route PATCH /complete-task
   * @paramDef {"type":"String","label":"Task List","name":"taskListId","required":true,"dictionary":"getTaskListsDictionary","description":"The task list that contains the task. Choose a list or paste a task list ID."}
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["taskListId"],"description":"The task to mark as completed. Choose a task list above to pick from its tasks, or paste a task ID."}
   * @returns {Object}
   * @sampleResult {"id":"AAMkADAwATM0MDAAMS0yMDVhLTgxOTAtMDACLTAwCgBGAAAD","title":"Prepare quarterly report","status":"completed","completedDateTime":{"dateTime":"2026-07-14T16:00:00.0000000","timeZone":"UTC"},"lastModifiedDateTime":"2026-07-14T16:00:00Z"}
   */
  async completeTask(taskListId, taskId) {
    if (!taskListId) {
      throw new Error('Parameter "Task List" is required')
    }

    if (!taskId) {
      throw new Error('Parameter "Task" is required')
    }

    return this.#apiRequest({
      url: `${ TODO_BASE_URL }/lists/${ taskListId }/tasks/${ taskId }`,
      logTag: 'completeTask',
      method: 'patch',
      body: { status: 'completed' },
    })
  }

  /**
   * @operationName Reopen Task
   * @category Tasks
   * @appearanceColor #2564CF #185ABD
   * @description Reopens a completed task by setting its status back to not started, clearing the completion date.
   * @route PATCH /reopen-task
   * @paramDef {"type":"String","label":"Task List","name":"taskListId","required":true,"dictionary":"getTaskListsDictionary","description":"The task list that contains the task. Choose a list or paste a task list ID."}
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["taskListId"],"description":"The task to reopen. Choose a task list above to pick from its tasks, or paste a task ID."}
   * @returns {Object}
   * @sampleResult {"id":"AAMkADAwATM0MDAAMS0yMDVhLTgxOTAtMDACLTAwCgBGAAAD","title":"Prepare quarterly report","status":"notStarted","completedDateTime":null,"lastModifiedDateTime":"2026-07-14T17:00:00Z"}
   */
  async reopenTask(taskListId, taskId) {
    if (!taskListId) {
      throw new Error('Parameter "Task List" is required')
    }

    if (!taskId) {
      throw new Error('Parameter "Task" is required')
    }

    return this.#apiRequest({
      url: `${ TODO_BASE_URL }/lists/${ taskListId }/tasks/${ taskId }`,
      logTag: 'reopenTask',
      method: 'patch',
      body: { status: 'notStarted' },
    })
  }

  /**
   * @operationName Delete Task
   * @category Tasks
   * @appearanceColor #2564CF #185ABD
   * @description Permanently deletes a task from a task list, including all of its checklist items.
   * @route DELETE /delete-task
   * @paramDef {"type":"String","label":"Task List","name":"taskListId","required":true,"dictionary":"getTaskListsDictionary","description":"The task list that contains the task. Choose a list or paste a task list ID."}
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["taskListId"],"description":"The task to delete. Choose a task list above to pick from its tasks, or paste a task ID."}
   * @returns {Object}
   * @sampleResult {"message":"Task deleted successfully"}
   */
  async deleteTask(taskListId, taskId) {
    if (!taskListId) {
      throw new Error('Parameter "Task List" is required')
    }

    if (!taskId) {
      throw new Error('Parameter "Task" is required')
    }

    await this.#apiRequest({
      url: `${ TODO_BASE_URL }/lists/${ taskListId }/tasks/${ taskId }`,
      logTag: 'deleteTask',
      method: 'delete',
    })

    return { message: 'Task deleted successfully' }
  }

  /**
   * @operationName Add Checklist Item
   * @category Checklist Items
   * @appearanceColor #2564CF #185ABD
   * @description Adds a checklist item (subtask) to a task. Checklist items appear as steps under the task in Microsoft To Do.
   * @route POST /add-checklist-item
   * @paramDef {"type":"String","label":"Task List","name":"taskListId","required":true,"dictionary":"getTaskListsDictionary","description":"The task list that contains the task. Choose a list or paste a task list ID."}
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["taskListId"],"description":"The task to add the checklist item to. Choose a task list above to pick from its tasks, or paste a task ID."}
   * @paramDef {"type":"String","label":"Item Name","name":"displayName","required":true,"description":"The display name of the checklist item."}
   * @returns {Object}
   * @sampleResult {"id":"e3a26c2e-7c8f-4f21-9f5a-1b2c3d4e5f60","displayName":"Gather sales figures","isChecked":false,"createdDateTime":"2026-07-14T10:05:00Z"}
   */
  async addChecklistItem(taskListId, taskId, displayName) {
    if (!taskListId) {
      throw new Error('Parameter "Task List" is required')
    }

    if (!taskId) {
      throw new Error('Parameter "Task" is required')
    }

    if (!displayName) {
      throw new Error('Parameter "Item Name" is required')
    }

    return this.#apiRequest({
      url: `${ TODO_BASE_URL }/lists/${ taskListId }/tasks/${ taskId }/checklistItems`,
      logTag: 'addChecklistItem',
      method: 'post',
      body: { displayName },
    })
  }

  /**
   * @operationName List Checklist Items
   * @category Checklist Items
   * @appearanceColor #2564CF #185ABD
   * @description Retrieves all checklist items (subtasks) of a task, including each item's ID, display name, checked state, and timestamps.
   * @route GET /list-checklist-items
   * @paramDef {"type":"String","label":"Task List","name":"taskListId","required":true,"dictionary":"getTaskListsDictionary","description":"The task list that contains the task. Choose a list or paste a task list ID."}
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["taskListId"],"description":"The task whose checklist items to retrieve. Choose a task list above to pick from its tasks, or paste a task ID."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"e3a26c2e-7c8f-4f21-9f5a-1b2c3d4e5f60","displayName":"Gather sales figures","isChecked":true,"checkedDateTime":"2026-07-14T11:00:00Z","createdDateTime":"2026-07-14T10:05:00Z"}]}
   */
  async listChecklistItems(taskListId, taskId) {
    if (!taskListId) {
      throw new Error('Parameter "Task List" is required')
    }

    if (!taskId) {
      throw new Error('Parameter "Task" is required')
    }

    return this.#apiRequest({
      url: `${ TODO_BASE_URL }/lists/${ taskListId }/tasks/${ taskId }/checklistItems`,
      logTag: 'listChecklistItems',
    })
  }

  /**
   * @operationName Check Or Uncheck Checklist Item
   * @category Checklist Items
   * @appearanceColor #2564CF #185ABD
   * @description Marks a checklist item (subtask) as checked or unchecked.
   * @route PATCH /check-or-uncheck-checklist-item
   * @paramDef {"type":"String","label":"Task List","name":"taskListId","required":true,"dictionary":"getTaskListsDictionary","description":"The task list that contains the task. Choose a list or paste a task list ID."}
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["taskListId"],"description":"The task that contains the checklist item. Choose a task list above to pick from its tasks, or paste a task ID."}
   * @paramDef {"type":"String","label":"Checklist Item ID","name":"checklistItemId","required":true,"description":"The ID of the checklist item to update. Use List Checklist Items to find it."}
   * @paramDef {"type":"Boolean","label":"Checked","name":"isChecked","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"Whether the checklist item is checked (completed). Turn off to uncheck the item. Defaults to checked."}
   * @returns {Object}
   * @sampleResult {"id":"e3a26c2e-7c8f-4f21-9f5a-1b2c3d4e5f60","displayName":"Gather sales figures","isChecked":true,"checkedDateTime":"2026-07-14T11:00:00Z","createdDateTime":"2026-07-14T10:05:00Z"}
   */
  async checkOrUncheckChecklistItem(taskListId, taskId, checklistItemId, isChecked) {
    if (!taskListId) {
      throw new Error('Parameter "Task List" is required')
    }

    if (!taskId) {
      throw new Error('Parameter "Task" is required')
    }

    if (!checklistItemId) {
      throw new Error('Parameter "Checklist Item ID" is required')
    }

    return this.#apiRequest({
      url: `${ TODO_BASE_URL }/lists/${ taskListId }/tasks/${ taskId }/checklistItems/${ checklistItemId }`,
      logTag: 'checkOrUncheckChecklistItem',
      method: 'patch',
      body: { isChecked: isChecked !== false },
    })
  }

  /**
   * @operationName Delete Checklist Item
   * @category Checklist Items
   * @appearanceColor #2564CF #185ABD
   * @description Permanently deletes a checklist item (subtask) from a task.
   * @route DELETE /delete-checklist-item
   * @paramDef {"type":"String","label":"Task List","name":"taskListId","required":true,"dictionary":"getTaskListsDictionary","description":"The task list that contains the task. Choose a list or paste a task list ID."}
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["taskListId"],"description":"The task that contains the checklist item. Choose a task list above to pick from its tasks, or paste a task ID."}
   * @paramDef {"type":"String","label":"Checklist Item ID","name":"checklistItemId","required":true,"description":"The ID of the checklist item to delete. Use List Checklist Items to find it."}
   * @returns {Object}
   * @sampleResult {"message":"Checklist item deleted successfully"}
   */
  async deleteChecklistItem(taskListId, taskId, checklistItemId) {
    if (!taskListId) {
      throw new Error('Parameter "Task List" is required')
    }

    if (!taskId) {
      throw new Error('Parameter "Task" is required')
    }

    if (!checklistItemId) {
      throw new Error('Parameter "Checklist Item ID" is required')
    }

    await this.#apiRequest({
      url: `${ TODO_BASE_URL }/lists/${ taskListId }/tasks/${ taskId }/checklistItems/${ checklistItemId }`,
      logTag: 'deleteChecklistItem',
      method: 'delete',
    })

    return { message: 'Checklist item deleted successfully' }
  }
}

Flowrunner.ServerCode.addService(MicrosoftToDoService, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth2 Client ID (Application ID) of your Microsoft Entra app registration.',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth2 Client Secret of your Microsoft Entra app registration.',
  },
])

function searchFilter(list, props, searchString) {
  const caseInsensitiveSearch = searchString.toLowerCase()

  return list.filter(item =>
    props.some(prop => {
      const value = prop.split('.').reduce((acc, key) => acc?.[key], item)

      return value && String(value).toLowerCase().includes(caseInsensitiveSearch)
    })
  )
}

function cleanupObject(data) {
  if (!data) {
    return
  }

  const result = {}

  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null) {
      result[key] = data[key]
    }
  })

  return result
}

function constructIdentityName(user) {
  const email = user.mail || user.userPrincipalName

  if (email && user.displayName) {
    return `${ email } (${ user.displayName })`
  }

  return email || user.displayName || 'Microsoft To Do Connection'
}
