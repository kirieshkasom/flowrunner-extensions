const { clean, similar, searchFilter, OptionsShaper, Normalizer } = require('./utils')

const logger = {
  info: (...args) => console.log('[Asana Service] info:', ...args),
  debug: (...args) => console.log('[Asana Service] debug:', ...args),
  error: (...args) => console.log('[Asana Service] error:', ...args),
  warn: (...args) => console.log('[Asana Service] warn:', ...args),
}

const OAUTH_BASE_URL = 'https://app.asana.com/-'
const API_BASE_URL = 'https://app.asana.com/api/1.0'

const Methods = {
  GET: 'get',
  POST: 'post',
  PUT: 'put',
  DELETE: 'delete',
}

const DEFAULT_LIMIT = 100

/**
 * @requireOAuth
 * @integrationName Asana
 * @integrationIcon /icon.svg
 */
class Asana {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scope = [
      'workspaces:read',
      'projects:read',
      'projects:write',
      'tasks:read',
      'tasks:write',
      'teams:read',
      'users:read',
      'tags:read',
      'stories:write',
      'attachments:write',
      'project_templates:read',
      'task_templates:read',
    ].join(' ')
  }

  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'
    query = clean(query)

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      return await Flowrunner.Request[method](url)
        .set({
          Authorization: `Bearer ${ this.request.headers['oauth-access-token'] }`,
          'Content-Type': 'application/json',
        })
        .query(query)
        .send(body)
    } catch (error) {
      this.#handleError(error)
    }
  }

  #handleError(e) {
    const message = e?.body?.errors?.[0]?.message || e?.message || e

    throw new Error(message)
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('scope', this.scope)

    return `${ OAUTH_BASE_URL }/oauth_authorize?${ params.toString() }`
  }

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    try {
      const { access_token, expires_in } = await Flowrunner.Request.post(`${ OAUTH_BASE_URL }/oauth_token`)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .query({
          client_id: this.clientId,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
          client_secret: this.clientSecret,
        })

      return { token: access_token, expirationInSeconds: expires_in }
    } catch (error) {
      logger.error('Error refreshing token: ', error.message || error)

      throw error
    }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    const { data, expires_in, access_token, refresh_token } = await Flowrunner.Request.post(`${ OAUTH_BASE_URL }/oauth_token`)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .query({
        grant_type: 'authorization_code',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: callbackObject.redirectURI,
        code: callbackObject.code,
      })

    let user

    try {
      user = await Flowrunner.Request
        .get(`${ API_BASE_URL }/users/me`)
        .set({ Authorization: `Bearer ${ access_token }` })

    } catch (error) {
      logger.warn("Can't load user profile", { error })
    }

    return {
      token: access_token,
      refreshToken: refresh_token,
      expirationInSeconds: expires_in,
      overwrite: true,
      connectionIdentityName: `${ data.name } (${ data.email })`,
      connectionIdentityImageURL: user?.data?.photo?.image_128x128,
    }
  }

  // ========================================== DICTIONARIES ===========================================

  /**
   * @typedef {Object} DictionaryPayload
   * @property {String} [search]
   * @property {String} [cursor]
   * @property {Object} [criteria]
   */

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
   * @typedef {Object} getWorkspacesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter workspaces by their name or ID. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results. Use the returned cursor to fetch additional workspaces."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Workspaces
   * @category Organization
   * @description Retrieves all Asana workspaces accessible to the authenticated user. Workspaces are the top-level organizational units that contain projects and teams.
   *
   * @route POST /get-workspaces
   *
   * @paramDef {"type":"getWorkspacesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering workspaces."}
   *
   * @sampleResult {"cursor":"15","items":[{"label":"My Workspace","note":"ID: 123456789","value":"123456789"}]}
   * @returns {DictionaryResponse}
   */
  async getWorkspacesDictionary({ search, cursor }) {
    const { data, next_page } = await this.#apiRequest({
      url: `${ API_BASE_URL }/workspaces`,
      query: { limit: DEFAULT_LIMIT, offset: cursor },
      logTag: 'getWorkspacesDictionary',
    })

    const workspaces = search ? searchFilter(data, ['gid', 'name'], search) : data

    return {
      items: workspaces.map(OptionsShaper.base),
      cursor: next_page?.offset,
    }
  }

  /**
   * @typedef {Object} getProjectsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"description":"Unique identifier of the Asana workspace whose projects will be listed."}
   */

  /**
   * @typedef {Object} getProjectsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter projects by their name or ID. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results. Use the returned cursor to fetch additional projects."}
   * @paramDef {"type":"getProjectsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameter to identify the Asana workspace."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Projects
   * @category Project Management
   * @description Retrieves all projects from a specific Asana workspace. Projects organize related tasks and help teams collaborate on shared goals.
   *
   * @route POST /get-projects
   *
   * @paramDef {"type":"getProjectsDictionary__payload","label":"Payload","name":"payload","description":"Contains workspace ID, optional search string, and pagination cursor for retrieving and filtering projects."}
   *
   * @sampleResult {"cursor":"20","items":[{"label":"Website Redesign","note":"ID: 1122334455","value":"1122334455"}]}
   * @returns {DictionaryResponse}
   */
  async getProjectsDictionary({ search, cursor, criteria: { workspaceId } }) {
    const { data, next_page } = await this.#apiRequest({
      url: `${ API_BASE_URL }/projects`,
      query: { limit: DEFAULT_LIMIT, offset: cursor, workspace: workspaceId },
      logTag: 'getProjectsDictionary',
    })

    const projects = search ? searchFilter(data, ['gid', 'name'], search) : data

    return {
      items: projects.map(OptionsShaper.base),
      cursor: next_page?.offset,
    }
  }

  /**
   * @typedef {Object} getSectionsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Project ID","name":"projectId","required":true,"description":"Unique identifier of the Asana project whose sections will be listed."}
   */

  /**
   * @typedef {Object} getSectionsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter sections by their name or ID. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results. Use the returned cursor to fetch additional sections."}
   * @paramDef {"type":"getSectionsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameter to identify the Asana project."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Sections
   * @category Project Management
   * @description Retrieves all sections within a specific Asana project. Sections help organize tasks into logical groups like "To Do", "In Progress", and "Done".
   *
   * @route POST /get-sections
   *
   * @paramDef {"type":"getSectionsDictionary__payload","label":"Payload","name":"payload","description":"Contains project ID, optional search string, and pagination cursor for retrieving and filtering sections."}
   *
   * @sampleResult {"cursor":"20","items":[{"label":"To Do","note":"ID: 7788990011","value":"7788990011"}]}
   * @returns {DictionaryResponse}
   */
  async getSectionsDictionary({ search, cursor, criteria: { projectId } }) {
    const { data, next_page } = await this.#apiRequest({
      url: `${ API_BASE_URL }/projects/${ projectId }/sections`,
      query: { limit: DEFAULT_LIMIT, offset: cursor },
      logTag: 'getSectionsDictionary',
    })

    const projects = search ? searchFilter(data, ['gid', 'name'], search) : data

    return {
      items: projects.map(OptionsShaper.base),
      cursor: next_page?.offset,
    }
  }

  /**
   * @typedef {Object} getTeamsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"description":"Unique identifier of the Asana workspace whose teams will be listed."}
   */

  /**
   * @typedef {Object} getTeamsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter teams by their name or ID. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results. Use the returned cursor to fetch additional teams."}
   * @paramDef {"type":"getTeamsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameter to identify the Asana workspace."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Teams
   * @category Organization
   * @description Retrieves all teams within a specific Asana workspace. Teams are groups of users who collaborate on projects and share access to resources.
   *
   * @route POST /get-teams
   *
   * @paramDef {"type":"getTeamsDictionary__payload","label":"Payload","name":"payload","description":"Contains workspace ID, optional search string, and pagination cursor for retrieving and filtering teams."}
   *
   * @sampleResult {"cursor":"20","items":[{"label":"Marketing","note":"ID: 5566778899","value":"5566778899"}]}
   * @returns {DictionaryResponse}
   */
  async getTeamsDictionary({ search, cursor, criteria: { workspaceId } }) {
    const { data, next_page } = await this.#apiRequest({
      url: `${ API_BASE_URL }/workspaces/${ workspaceId }/teams`,
      query: { limit: DEFAULT_LIMIT, offset: cursor },
      logTag: 'getTeamsDictionary',
    })

    const teams = search ? searchFilter(data, ['gid', 'name'], search) : data

    return {
      items: teams.map(OptionsShaper.base),
      cursor: next_page?.offset,
    }
  }

  /**
   * @typedef {Object} getUsersDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"description":"Unique identifier of the Asana workspace whose users will be listed."}
   */

  /**
   * @typedef {Object} getUsersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter users by their name, email, or ID. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results. Use the returned cursor to fetch additional users."}
   * @paramDef {"type":"getUsersDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameter to identify the Asana workspace."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Users
   * @category Organization
   * @description Retrieves all team members and users from a specific Asana workspace. These are the people who can be assigned tasks and collaborate on projects.
   *
   * @route POST /get-users
   *
   * @paramDef {"type":"getUsersDictionary__payload","label":"Payload","name":"payload","description":"Contains workspace ID, optional search string, and pagination cursor for retrieving and filtering users."}
   *
   * @sampleResult {"cursor":"10","items":[{"label":"John Smith","note":"Email: john.smith@example.com","value":"1200120051"}]}
   * @returns {DictionaryResponse}
   */
  async getUsersDictionary({ search, cursor, criteria: { workspaceId } }) {
    const { data, next_page } = await this.#apiRequest({
      url: `${ API_BASE_URL }/users`,
      query: {
        workspace: workspaceId,
        limit: DEFAULT_LIMIT,
        offset: cursor,
        opt_fields: 'email,name,gid',
      },
      logTag: 'getUsersDictionary',
    })

    const users = search ? searchFilter(data, ['email', 'gid', 'name'], search) : data

    return {
      items: users.map(({ gid, name, email }) => ({
        label: name || '[empty]',
        note: `Email: ${ email }`,
        value: gid,
      })),
      cursor: next_page?.offset,
    }
  }

  /**
   * @typedef {Object} getTasksDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Project ID","name":"projectId","required":true,"description":"Unique identifier of the Asana project whose tasks will be listed."}
   */

  /**
   * @typedef {Object} getTasksDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter tasks by their name or ID. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results. Use the returned cursor to fetch additional tasks."}
   * @paramDef {"type":"getTasksDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameter to identify the Asana project."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tasks
   * @category Task Management
   * @description Retrieves all tasks from a specific Asana project. Tasks represent individual work items that need to be completed by team members.
   *
   * @route POST /get-tasks
   *
   * @paramDef {"type":"getTasksDictionary__payload","label":"Payload","name":"payload","description":"Contains project ID, optional search string, and pagination cursor for retrieving and filtering tasks."}
   *
   * @sampleResult {"cursor":"10","items":[{"label":"Design Homepage","note":"ID: 87654321","value":"87654321"}]}
   * @returns {DictionaryResponse}
   */
  async getTasksDictionary({ search, cursor, criteria: { projectId } }) {
    const { data, next_page } = await this.#apiRequest({
      url: `${ API_BASE_URL }/tasks`,
      query: {
        project: projectId,
        limit: DEFAULT_LIMIT,
        offset: cursor,
        opt_fields: 'name,gid',
      },
      logTag: 'getTasksDictionary',
    })

    const tasks = search ? searchFilter(data, ['gid', 'name'], search) : data

    return {
      items: tasks.map(OptionsShaper.base),
      cursor: next_page?.offset,
    }
  }

  /**
   * @typedef {Object} getProjectTemplatesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"description":"Unique identifier of the Asana workspace whose project templates will be listed."}
   */

  /**
   * @typedef {Object} getProjectTemplatesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter project templates by their name or ID. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results. Use the returned cursor to fetch additional project templates."}
   * @paramDef {"type":"getProjectTemplatesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameter to identify the Asana workspace."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Project Templates
   * @category Templates
   * @description Retrieves all project templates from a specific Asana workspace. Templates provide pre-configured project structures to quickly create new projects.
   *
   * @route POST /get-project-templates
   *
   * @paramDef {"type":"getProjectTemplatesDictionary__payload","label":"Payload","name":"payload","description":"Contains workspace ID, optional search string, and pagination cursor for retrieving and filtering project templates."}
   *
   * @sampleResult {"cursor":"20","items":[{"label":"Agile Sprint Template","note":"ID: 99887766","value":"99887766"}]}
   * @returns {DictionaryResponse}
   */
  async getProjectTemplatesDictionary({ search, cursor, criteria: { workspaceId } }) {
    const { data, next_page } = await this.#apiRequest({
      url: `${ API_BASE_URL }/project_templates`,
      query: {
        workspace: workspaceId,
        limit: DEFAULT_LIMIT,
        offset: cursor,
        opt_fields: 'name,gid',
      },
      logTag: 'getProjectTemplatesDictionary',
    })

    const templates = search ? searchFilter(data, ['gid', 'name'], search) : data

    return {
      items: templates.map(OptionsShaper.base),
      cursor: next_page?.offset,
    }
  }

  /**
   * @typedef {Object} getTaskTemplatesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Project ID","name":"projectId","required":true,"description":"Unique identifier of the Asana project whose task templates will be listed."}
   */

  /**
   * @typedef {Object} getTaskTemplatesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter task templates by their name or ID. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results. Use the returned cursor to fetch additional task templates."}
   * @paramDef {"type":"getTaskTemplatesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameter to identify the Asana project."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Task Templates Dictionary
   * @category Templates
   * @description Returns a paginated list of task templates for the specified Asana project. Note: search functionality filters task templates only within the current page of results. Use the cursor to paginate through all available task templates.
   *
   * @route POST /get-task-templates-dictionary
   *
   * @paramDef {"type":"getTaskTemplatesDictionary__payload","label":"Payload","name":"payload","description":"Contains project ID, optional search string, and pagination cursor for retrieving and filtering task templates."}
   *
   * @sampleResult {"cursor":"20","items":[{"label":"Bug Report Template","note":"ID: 11223344","value":"11223344"}]}
   * @returns {DictionaryResponse}
   */
  async getTaskTemplatesDictionary({ search, cursor, criteria: { projectId } }) {
    const { data, next_page } = await this.#apiRequest({
      url: `${ API_BASE_URL }/task_templates`,
      query: {
        project: projectId,
        limit: DEFAULT_LIMIT,
        offset: cursor,
        opt_fields: 'name,gid',
      },
      logTag: 'getTaskTemplatesDictionary',
    })

    const templates = search ? searchFilter(data, ['gid', 'name'], search) : data

    return {
      items: templates.map(OptionsShaper.base),
      cursor: next_page?.offset,
    }
  }

  /**
   * @typedef {Object} getTagsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"description":"Unique identifier of the Asana workspace whose tags will be listed."}
   */

  /**
   * @typedef {Object} getTagsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter tags by their name or ID. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results. Use the returned cursor to fetch additional tags."}
   * @paramDef {"type":"getTagsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameter to identify the Asana workspace."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tags
   * @category Organization
   * @description Retrieves all tags from a specific Asana workspace. Tags help categorize and organize tasks for better filtering and reporting.
   *
   * @route POST /get-tags
   *
   * @paramDef {"type":"getTagsDictionary__payload","label":"Payload","name":"payload","description":"Contains workspace ID, optional search string, and pagination cursor for retrieving and filtering tags."}
   *
   * @sampleResult {"cursor":"20","items":[{"label":"Priority","note":"ID: 24681357","value":"24681357"}]}
   * @returns {DictionaryResponse}
   */
  async getTagsDictionary({ search, cursor, criteria: { workspaceId } }) {
    const { data, next_page } = await this.#apiRequest({
      url: `${ API_BASE_URL }/tags`,
      query: { workspace: workspaceId, limit: DEFAULT_LIMIT, offset: cursor },
      logTag: 'getTagsDictionary',
    })

    const tags = search ? searchFilter(data, ['gid', 'name'], search) : data

    return {
      items: tags.map(OptionsShaper.base),
      cursor: next_page?.offset,
    }
  }

  // ======================================= END OF DICTIONARIES =======================================

  /**
   * @description Creates a new task in an Asana project with customizable properties like due dates, assignees, and tags. Perfect for automating task creation workflows and project management processes.
   *
   * @route POST /task
   * @operationName Create Task
   * @category Task Management
   *
   * @appearanceColor #f9566d #fb874b
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes default
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Select the Asana workspace where the task will be created."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","dependsOn":["workspaceId"],"description":"Choose the specific project to add this task to."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional deadline for when this task should be completed."}
   * @paramDef {"type":"String","label":"Start Date","name":"startAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional date when work on this task should begin. Note: Due Date must be set when using Start Date."}
   * @paramDef {"type":"String","label":"Task Title","name":"name","required":true,"description":"Clear, descriptive title for the task."}
   * @paramDef {"type":"String","label":"Task Description","name":"description","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Detailed description of what needs to be done. Supports Asana rich text formatting."}
   * @paramDef {"type":"Boolean","label":"Mark as Completed","name":"completed","uiComponent":{"type":"TOGGLE"},"description":"Create the task in a completed state (useful for logging completed work)."}
   * @paramDef {"type":"Boolean","label":"Mark as Liked","name":"liked","uiComponent":{"type":"TOGGLE"},"description":"Add a like to this task upon creation."}
   * @paramDef {"type":"String","label":"Assign To","name":"assignee","dictionary":"getUsersDictionary","dependsOn":["workspaceId"],"description":"Team member who will be responsible for completing this task."}
   * @paramDef {"type":"String","label":"Add Follower","name":"followers","dictionary":"getUsersDictionary","dependsOn":["workspaceId"],"description":"Team member who will receive notifications about task updates."}
   * @paramDef {"type":"String","label":"Add Tag","name":"tags","dictionary":"getTagsDictionary","dependsOn":["workspaceId"],"description":"Categorize this task with relevant tags for better organization."}
   *
   * @returns {Object} Created task ID
   * @sampleResult {"taskId":"12345"}
   */
  async createTask(
    workspaceId,
    projectId,
    dueAt,
    startAt,
    name,
    description,
    completed,
    liked,
    assignee,
    followers,
    tags
  ) {
    logger.debug('[createTask] Payload', {
      workspaceId,
      projectId,
      dueAt,
      startAt,
      name,
      description,
      completed,
      liked,
      assignee,
      followers,
      tags,
    })

    const data = clean({
      name,
      workspace: workspaceId,
      projects: projectId && [projectId],
      due_at: dueAt && new Date(dueAt).toISOString(),
      start_at: startAt && new Date(startAt).toISOString(),
      html_notes: description && `<body>${ description }</body>`,
      completed,
      liked,
      assignee,
      // TODO: implement dynamic options for it
      followers: followers && [followers],
      tags: tags && [tags],
    })

    const res = await this.#apiRequest({
      method: Methods.POST,
      url: `${ API_BASE_URL }/tasks`,
      body: { data },
      logTag: 'createTask',
    })

    return { taskId: res.data.gid }
  }

  /**
   * @description Updates an existing Asana task with new information such as due dates, assignees, status, or content. Perfect for automating task management and progress tracking workflows.
   *
   * @route PUT /task
   * @operationName Update Task
   * @category Task Management
   *
   * @appearanceColor #f9566d #fb874b
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes default
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Select the Asana workspace containing the task."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","dependsOn":["workspaceId"],"description":"Choose the project containing the task to update."}
   * @paramDef {"type":"String","label":"Select Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["projectId"],"description":"Choose the specific task you want to update."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Update the deadline for when this task should be completed."}
   * @paramDef {"type":"String","label":"Start Date","name":"startAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Update when work on this task should begin. Note: Due Date must be set when using Start Date."}
   * @paramDef {"type":"String","label":"Task Title","name":"name","required":true,"description":"Update the task's title or name."}
   * @paramDef {"type":"String","label":"Task Description","name":"description","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Update the detailed description of what needs to be done. Supports Asana rich text formatting."}
   * @paramDef {"type":"Boolean","label":"Mark as Completed","name":"completed","uiComponent":{"type":"TOGGLE"},"description":"Change the task's completion status."}
   * @paramDef {"type":"Boolean","label":"Mark as Liked","name":"liked","uiComponent":{"type":"TOGGLE"},"description":"Add or remove a like from this task."}
   * @paramDef {"type":"String","label":"Reassign To","name":"assignee","dictionary":"getUsersDictionary","dependsOn":["workspaceId"],"description":"Change who is responsible for completing this task."}
   * @paramDef {"type":"String","label":"Update Follower","name":"followers","dictionary":"getUsersDictionary","dependsOn":["workspaceId"],"description":"Add or change who receives notifications about task updates."}
   * @paramDef {"type":"String","label":"Update Tags","name":"tags","dictionary":"getTagsDictionary","dependsOn":["workspaceId"],"description":"Add or change tags to better categorize this task."}
   *
   * @returns {Object} Returns the complete updated task record.
   * @sampleResult {"workspace":"My workspace","notes":"qweqwe","dueOn":null,"taskUrl":"https://app.asana.com/0/1208998714551627/1208999667706630","created":"2024-12-17T15:15:33.507Z","name":"qwe","modified":"2024-12-17T15:15:34.394Z","startOn":null,"completed":false,"taskId":"1208999667706630","workspaceId":"1208998714090218"}
   */
  async updateTask(
    workspaceId,
    projectId,
    taskId,
    dueAt,
    startAt,
    name,
    description,
    completed,
    liked,
    assignee,
    followers,
    tags
  ) {
    logger.debug('[updateTask] Payload', {
      workspaceId,
      projectId,
      taskId,
      dueAt,
      startAt,
      name,
      description,
      completed,
      liked,
      assignee,
      followers,
      tags,
    })

    const data = clean({
      name,
      workspace: workspaceId,
      due_at: dueAt && new Date(dueAt).toISOString(),
      start_at: startAt && new Date(startAt).toISOString(),
      html_notes: description && `<body>${ description }</body>`,
      completed,
      liked,
      assignee,
      // TODO: implement dynamic options for it
      followers: followers && [followers],
      tags: tags && [tags],
    })

    const res = await this.#apiRequest({
      method: Methods.PUT,
      url: `${ API_BASE_URL }/tasks/${ taskId }`,
      body: { data },
      logTag: 'updateTask',
    })

    return Normalizer.task(res.data)
  }

  /**
   * @description Retrieves detailed information about a specific task including its title, description, assignee, due date, and current status.
   *
   * @route GET /task
   * @operationName Get Task by ID
   * @category Task Management
   *
   * @appearanceColor #f9566d #fb874b
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes default
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Select the Asana workspace containing the task."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","dependsOn":["workspaceId"],"description":"Choose the project containing the task."}
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["projectId"],"description":"Select the specific task to retrieve details for."}
   *
   * @returns {Object} Data about retrieved Task
   * @sampleResult {"workspace":"My workspace","notes":"qweqwe","dueOn":null,"taskUrl":"https://app.asana.com/0/1208998714551627/1208999667706630","created":"2024-12-17T15:15:33.507Z","name":"qwe","modified":"2024-12-17T15:15:34.394Z","startOn":null,"completed":false,"taskId":"1208999667706630","workspaceId":"1208998714090218"}
   */
  async getTask(workspaceId, projectId, taskId) {
    logger.debug('[getTask] Payload', { taskId })

    const res = await this.#apiRequest({
      url: `${ API_BASE_URL }/tasks/${ taskId }`,
      logTag: 'getTask',
    })

    return Normalizer.task(res.data)
  }

  /**
   * @description Searches for a task within a specific project by name. Returns the first exact match or a task with similar name.
   *
   * @route GET /task/project
   * @operationName Find Task in Project
   * @category Task Management
   * @appearanceColor #f9566d #fb874b
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes default
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Select the Asana workspace to search in."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","dependsOn":["workspaceId"],"description":"Choose the project to search for tasks in."}
   * @paramDef {"type":"String","label":"Task Name","name":"name","required":true,"description":"Enter the full or partial name of the task to find. Returns exact match or closest match."}
   *
   * @returns {Object} Data about retrieved Task.
   * @sampleResult {"workspace":"My workspace","notes":"qweqwe","dueOn":null,"taskUrl":"https://app.asana.com/0/1208998714551627/1208999667706630","created":"2024-12-17T15:15:33.507Z","name":"qwe","modified":"2024-12-17T15:15:34.394Z","startOn":null,"completed":false,"taskId":"1208999667706630","workspaceId":"1208998714090218"}
   */
  async findTaskInProject(workspaceId, projectId, name) {
    logger.debug('[findTaskInProject] Payload', { workspaceId, projectId, name })

    const tasks = []

    let offset, match

    do {
      const { data, next_page } = await this.#apiRequest({
        url: `${ API_BASE_URL }/projects/${ projectId }/tasks`,
        query: { limit: DEFAULT_LIMIT, offset },
        logTag: 'findTaskInProject',
      })

      tasks.push(...data)

      offset = next_page ? next_page.offset : null
    } while (offset)

    for (const task of tasks) {
      if (task.name === name) {
        match = task

        break
      }

      if (similar(task.name, name)) {
        match = task
      }
    }

    if (match) {
      return this.getTask(null, null, match.gid)
    }

    return null
  }

  /**
   * @description Adds a task to a specific section of a project. This method is used to move tasks into sections.
   *
   * @route POST /sections/add-task
   * @operationName Add Task to Section
   * @category Task Management
   *
   * @appearanceColor #f9566d #fb874b
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes default
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Select the Asana workspace containing the task and section."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","dependsOn":["workspaceId"],"description":"Choose the project containing the task and section."}
   * @paramDef {"type":"String","label":"Section","name":"sectionId","required":true,"dictionary":"getSectionsDictionary","dependsOn":["projectId"],"description":"Select the section where the task should be moved to."}
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["projectId"],"description":"Choose the task to move to the selected section."}
   */
  async addTaskToSection(workspaceId, projectId, sectionId, taskId) {
    logger.debug('[addTaskToSection] Payload', { workspaceId, projectId, sectionId, taskId })

    await this.#apiRequest({
      url: `${ API_BASE_URL }/sections/${ sectionId }/addTask`,
      method: Methods.POST,
      body: { data: { task: taskId } },
      logTag: 'addTaskToSection',
    })
  }

  /**
   * @description Attaches a file to an Asana task for easy access and collaboration. Supports documents, images, and other file types up to 100MB.
   *
   * @route POST /tasks/add-attachments
   * @operationName Attach File
   * @category Task Management
   *
   * @appearanceColor #f9566d #fb874b
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes default
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Select the Asana workspace containing the task."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","dependsOn":["workspaceId"],"description":"Choose the project containing the task."}
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["projectId"],"description":"Select the task to attach the file to."}
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"description":"Enter the complete URL of the file to attach to this task."}
   *
   * @returns {Object} Data about the attachment.
   * @sampleResult { "attachmentId":"data.gid", "attachmentName": "data.name" }
   */
  async attachFile(workspaceId, projectId, taskId, fileUrl) {
    logger.debug('[attachFile] Payload', { workspaceId, projectId, taskId, fileUrl })

    const url = new URL(fileUrl)
    const name = url.pathname.split('/').at(-1)

    const { data } = await this.#apiRequest({
      url: `${ API_BASE_URL }/attachments`,
      method: Methods.POST,
      body: {
        data: { resource_subtype: 'external', parent: taskId, url: fileUrl, name },
      },
      logTag: 'attachFile',
    })

    return { attachmentId: data.gid, attachmentName: data.name }
  }

  /**
   * @description Adds a comment to a task for communication and updates. Comments help team members collaborate and track progress on tasks.
   *
   * @route POST /tasks/comment
   * @operationName Add Comment
   * @category Task Management
   *
   * @appearanceColor #f9566d #fb874b
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes default
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Select the Asana workspace containing the task."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","dependsOn":["workspaceId"],"description":"Choose the project containing the task."}
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["projectId"],"description":"Select the task to add a comment to."}
   * @paramDef {"type":"String","label":"Comment Text","name":"content","required":true,"description":"Enter the comment text. Supports HTML formatting for rich text."}
   *
   * @returns {Object} Returns the ID of the new story added to the task.
   * @sampleResult {"commentId":"12345"}
   */
  async createComment(workspaceId, projectId, taskId, content) {
    logger.debug('[createComment] Payload', { workspaceId, projectId, taskId, content })

    const res = await this.#apiRequest({
      url: `${ API_BASE_URL }/tasks/${ taskId }/stories`,
      method: Methods.POST,
      body: { data: { text: content } },
      logTag: 'createComment',
    })

    return { commentId: res.data.gid }
  }

  /**
   * @description Creates a copy of an existing task with customizable properties. Useful for creating similar tasks or templates without starting from scratch.
   *
   * @route POST /tasks/duplicate
   * @operationName Duplicate Task
   * @category Task Management
   *
   * @appearanceColor #f9566d #fb874b
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes default
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Select the Asana workspace containing the task to duplicate."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","dependsOn":["workspaceId"],"description":"Choose the project containing the task to duplicate."}
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["projectId"],"description":"Select the task to create a copy of."}
   * @paramDef {"type":"String","label":"New Task Name","name":"name","required":true,"description":"Enter a name for the duplicated task."}
   * @paramDef {"type":"String","label":"Include Fields","name":"include","description":"Optional: Specify which fields to copy (assignee, attachments, dates, dependencies, followers, notes, parent, projects, subtasks, tags). Leave empty to copy all fields."}
   *
   * @returns {Object} ID of the duplicated task.
   * @sampleResult {"taskId": "1209003353331023"}
   */
  async duplicateTask(workspaceId, projectId, taskId, name, include) {
    logger.debug('[duplicateTask] Payload', { workspaceId, projectId, taskId, name })

    const data = {
      name,
      include: include || 'assignee,attachments,dates,dependencies,followers,notes,parent,projects,subtasks,tags',
    }

    const res = await this.#apiRequest({
      url: `${ API_BASE_URL }/tasks/${ taskId }/duplicate`,
      method: Methods.POST,
      body: { data },
      logTag: 'duplicateTask',
    })

    return { taskId: res.data.new_task.gid }
  }

  /**
   * @description Creates a smaller task within a parent task to break down complex work into manageable pieces.
   *
   * @route POST /tasks/add-subtasks
   * @operationName Create Subtask
   * @category Task Management
   *
   * @appearanceColor #f9566d #fb874b
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes default
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Select the Asana workspace where the parent task is located."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","dependsOn":["workspaceId"],"description":"Choose the project containing the parent task."}
   * @paramDef {"type":"String","label":"Parent Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["projectId"],"description":"Select the parent task that will contain this subtask."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional deadline for when this subtask should be completed."}
   * @paramDef {"type":"String","label":"Start Date","name":"startAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional date when work on this subtask should begin. Note: Due Date must be set when using Start Date."}
   * @paramDef {"type":"String","label":"Subtask Title","name":"name","required":true,"description":"Clear, descriptive title for the subtask."}
   * @paramDef {"type":"String","label":"Subtask Description","name":"description","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Detailed description of what needs to be done in this subtask. Supports Asana rich text formatting."}
   * @paramDef {"type":"Boolean","label":"Mark as Completed","name":"completed","uiComponent":{"type":"TOGGLE"},"description":"Create the subtask in a completed state."}
   * @paramDef {"type":"Boolean","label":"Mark as Liked","name":"liked","uiComponent":{"type":"TOGGLE"},"description":"Add a like to this subtask upon creation."}
   * @paramDef {"type":"String","label":"Assign To","name":"assignee","dictionary":"getUsersDictionary","dependsOn":["workspaceId"],"description":"Team member who will be responsible for completing this subtask."}
   * @paramDef {"type":"String","label":"Add Follower","name":"followers","dictionary":"getUsersDictionary","dependsOn":["workspaceId"],"description":"Team member who will receive notifications about subtask updates."}
   * @paramDef {"type":"String","label":"Add Tag","name":"tags","dictionary":"getTagsDictionary","dependsOn":["workspaceId"],"description":"Categorize this subtask with relevant tags for better organization."}
   *
   * @returns {Object} ID of the created subtask.
   * @sampleResult {"subtaskId":"12345"}
   */
  async createSubtask(
    workspaceId,
    projectId,
    taskId,
    dueAt,
    startAt,
    name,
    description,
    completed,
    liked,
    assignee,
    followers,
    tags
  ) {
    logger.debug('[createSubtask] Payload', {
      workspaceId,
      projectId,
      taskId,
      dueAt,
      startAt,
      name,
      description,
      completed,
      liked,
      assignee,
      followers,
      tags,
    })

    const data = clean({
      name,
      workspace: workspaceId,
      projects: projectId && [projectId],
      due_at: dueAt && new Date(dueAt).toISOString(),
      start_at: startAt && new Date(startAt).toISOString(),
      html_notes: description && `<body>${ description }</body>`,
      completed,
      liked,
      assignee,
      // TODO: implement dynamic options for it
      followers: followers && [followers],
      tags: tags && [tags],
    })

    const res = await this.#apiRequest({
      url: `${ API_BASE_URL }/tasks/${ taskId }/subtasks`,
      method: Methods.POST,
      body: { data },
      logTag: 'createSubtask',
    })

    return { subtaskId: res.data.gid }
  }

  /**
   * @description Retrieves the compact task template records for certain project.
   *
   * @route POST /task-templates/get
   * @operationName Get Task Templates
   * @category Templates
   *
   * @appearanceColor #f9566d #fb874b
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes default
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Unique identifier for the workspace."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","dependsOn":["workspaceId"],"description":"Unique identifier for the project."}
   *
   * @returns {Array} Returns the compact task template records.
   * @sampleResult [{"gid":"12345","resource_type":"task_template","name":"Packing list"}]
   */
  async getTaskTemplates(workspaceId, projectId) {
    logger.debug('[getTaskTemplates] Payload', { workspaceId, projectId })

    const res = await this.#apiRequest({
      url: `${ API_BASE_URL }/task_templates`,
      query: { project: projectId },
      logTag: 'getTaskTemplates',
    })

    return res.data.map(({ gid, name }) => ({ templateId: gid, name }))
  }

  /**
   * @description Creates a new task from a selected template.
   *
   * @route POST /task-templates/instantiate
   * @operationName Create Task from Template
   * @category Templates
   *
   * @appearanceColor #f9566d #fb874b
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes default
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Unique identifier for the workspace."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","dependsOn":["workspaceId"],"description":"Unique identifier for the project."}
   * @paramDef {"type":"String","label":"Task Template","name":"templateId","required":true,"dictionary":"getTaskTemplatesDictionary","dependsOn":["projectId"],"description":"Unique identifier for the task template."}
   * @paramDef {"type":"String","label":"Task Name","name":"name","required":true,"description":"Name for the new task."}
   *
   * @returns {Object} ID of the created task.
   * @sampleResult {"taskId": "12345"}
   */
  async createTaskFromTemplate(workspaceId, projectId, templateId, name) {
    logger.debug('[createTaskFromTemplate] Payload', { workspaceId, projectId, templateId, name })

    const { data } = await this.#apiRequest({
      url: `${ API_BASE_URL }/task_templates/${ templateId }/instantiateTask`,
      method: Methods.POST,
      body: { data: { name } },
      logTag: 'createTaskFromTemplate',
    })

    return { taskId: data.gid }
  }

  /**
   * @description Creates a new Asana project to organize tasks and collaborate with team members. Projects help structure work and track progress toward goals.
   *
   * @route POST /projects
   * @operationName Create Project
   * @category Project Management
   *
   * @appearanceColor #f9566d #fb874b
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes default
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Unique identifier for the workspace."}
   * @paramDef {"type":"String","label":"Team","name":"teamId","required":true,"dictionary":"getTeamsDictionary","dependsOn":["workspaceId"],"description":"Unique identifier for the team."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name for the new project."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","required":true,"description":"Notes for the new project."}
   *
   * @returns {Object} Returns the ID of the newly created project.
   * @sampleResult {"projectId":"12345"}
   */
  async createProject(workspaceId, teamId, name, notes) {
    logger.debug('[createProject] Payload', { workspaceId, teamId, name, notes })

    const res = await this.#apiRequest({
      url: `${ API_BASE_URL }/projects`,
      method: Methods.POST,
      body: { data: { name, notes, workspace: workspaceId, team: teamId } },
      logTag: 'createProject',
    })

    return { projectId: res.data.gid }
  }

  /**
   * @description Retrieves a project by ID.
   *
   * @route GET /projects/id
   * @operationName Get Project by ID
   * @category Project Management
   *
   * @appearanceColor #f9566d #fb874b
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes default
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Unique identifier for the workspace."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","dependsOn":["workspaceId"],"description":"Unique identifier for the project."}
   *
   * @returns {Object} Returns the complete project record for a single project.
   * @sampleResult {"teamName": "My workspace","completedAt": null,"projectUrl": "https://app.asana.com/0/1208998714551627/1208998714551627","notes": "","modifiedAt": "2024-12-17T19:01:41.399Z","ownerId": "1208998713785730","createdAt": "2024-12-17T13:12:39.900Z","archived": false,"followers": ["1208998713785730"],"ownerName": "Dima Test+2","teamId": "1208998714090220","members": ["1208998713785730"],"name": "Test+2","workspaceName": "My workspace","projectId": "1208998714551627","workspaceId": "1208998714090218"}
   */
  async getProject(workspaceId, projectId) {
    logger.debug('[getProject] Payload', { workspaceId, projectId })

    const { data } = await this.#apiRequest({
      url: `${ API_BASE_URL }/projects/${ projectId }`,
      logTag: 'getProject',
    })

    return Normalizer.project(data)
  }

  /**
   * @description Searches for a project within a workspace by name. Returns the first exact match or a project with similar name.
   *
   * @route GET /projects/name
   * @operationName Find Project by Name
   * @category Project Management
   *
   * @appearanceColor #f9566d #fb874b
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes default
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Unique identifier for the workspace."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Project name to find."}
   *
   * @returns {Object | null} Data about the created project or null if project non exist.
   * @sampleResult {"teamName": "My workspace","completedAt": null,"projectUrl": "https://app.asana.com/0/1208998714551627/1208998714551627","notes": "","modifiedAt": "2024-12-17T19:01:41.399Z","ownerId": "1208998713785730","createdAt": "2024-12-17T13:12:39.900Z","archived": false,"followers": ["1208998713785730"],"ownerName": "Dima Test+2","teamId": "1208998714090220","members": ["1208998713785730"],"name": "Test+2","workspaceName": "My workspace","projectId": "1208998714551627","workspaceId": "1208998714090218"}
   */
  async findProject(workspaceId, name) {
    logger.debug('[findProject] Payload', { workspaceId, name })

    const projects = []

    let offset, match

    do {
      const { data, next_page } = await this.#apiRequest({
        url: `${ API_BASE_URL }/workspaces/${ workspaceId }/projects`,
        query: { limit: DEFAULT_LIMIT, offset },
        logTag: 'findProject',
      })

      projects.push(...data)

      offset = next_page ? next_page.offset : null
    } while (offset)

    for (const project of projects) {
      if (project.name === name) {
        match = project

        break
      }

      if (similar(project.name, name)) {
        match = project
      }
    }

    if (match) {
      return this.getProject(null, match.gid)
    }

    return null
  }

  /**
   * @description Creates a new project from a custom template.
   *
   * @route POST /projects/from-template
   * @operationName Create Project from Template
   * @category Templates
   *
   * @appearanceColor #f9566d #fb874b
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes default
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Unique identifier for the workspace."}
   * @paramDef {"type":"String","label":"Team","name":"teamId","required":true,"dictionary":"getTeamsDictionary","dependsOn":["workspaceId"],"description":"Unique identifier for the team."}
   * @paramDef {"type":"String","label":"Template","name":"templateId","required":true,"dictionary":"getProjectTemplatesDictionary","dependsOn":["workspaceId"],"description":"Unique identifier for the template."}
   * @paramDef {"type":"String","label":"Project Name","name":"name","required":true,"description":"Name for a new project."}
   * @paramDef {"type":"String","label":"Privacy Setting","name":"privacy_setting","uiComponent":{"type":"DROPDOWN","options":{"values":["public_to_workspace","private"]}},"description":"Who will see a project."}
   *
   * @returns {Object} ID of the created project.
   * @sampleResult {"projectId":"12345"}
   */
  async createProjectFromTemplate(workspaceId, teamId, templateId, name, privacySetting) {
    logger.debug('[createProjectFromTemplate] Payload', { workspaceId, teamId, templateId, name, privacySetting })

    const res = await this.#apiRequest({
      url: `${ API_BASE_URL }/project_templates/${ templateId }/instantiateProject`,
      method: Methods.POST,
      body: { data: { name, team: teamId, privacy_setting: privacySetting } },
      logTag: 'createProjectFromTemplate',
    })

    return { projectId: res.data.gid }
  }

  /**
   * @description Creates a new section within a project.
   *
   * @route POST /projects/sections
   * @operationName Create Section
   * @category Project Management
   *
   * @appearanceColor #f9566d #fb874b
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes default
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Unique identifier for the workspace."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","dependsOn":["workspaceId"],"description":"Unique identifier for the project."}
   * @paramDef {"type":"String","label":"Section Name","name":"name","required":true,"description":"Name of new section."}
   *
   * @returns {Object} Returns the full record of the newly created section.
   * @sampleResult { "sectionId": "12345" }
   */
  async createSection(workspaceId, projectId, name) {
    logger.debug('[createSection] Payload', { workspaceId, projectId, name })

    const res = await this.#apiRequest({
      url: `${ API_BASE_URL }/projects/${ projectId }/sections`,
      method: Methods.POST,
      body: { data: { name } },
      logTag: 'createSection',
    })

    return { sectionId: res.data.gid }
  }

  /**
   * @description Finds a section by name.
   *
   * @route GET /sections/name
   * @operationName Find Section by Name
   * @category Project Management
   *
   * @appearanceColor #f9566d #fb874b
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes default
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Unique identifier for the workspace."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","dependsOn":["workspaceId"],"description":"Unique identifier for the project."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Section name to find."}
   *
   * @returns {Object} Returns the complete record for a single section.
   * @sampleResult {"createdAt": "2024-12-17T22:44:54.951Z","name": "goo","sectionId": "1209002919239968","projectName": "Test+2","projectId": "1208998714551627"}
   */
  async findSection(workspaceId, projectId, name) {
    logger.debug('[findSection] Payload', { workspaceId, projectId, name })

    const sections = []

    let offset, match

    do {
      const { data, next_page } = await this.#apiRequest({
        url: `${ API_BASE_URL }/projects/${ projectId }/sections`,
        query: { limit: DEFAULT_LIMIT, offset },
        logTag: 'findSection',
      })

      sections.push(...data)

      offset = next_page ? next_page.offset : null
    } while (offset)

    for (const section of sections) {
      if (section.name === name) {
        match = section

        break
      }

      if (similar(section.name, name)) {
        match = section
      }
    }

    if (match) {
      return this.getSectionById(null, null, match.gid)
    }

    return null
  }

  /**
   * @description Retrieves full section record by its ID.
   *
   * @route GET /sections/id
   * @operationName Get Section by ID
   * @category Project Management
   *
   * @appearanceColor #f9566d #fb874b
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes default
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Unique identifier for the workspace."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","dependsOn":["workspaceId"],"description":"Unique identifier for the project."}
   * @paramDef {"type":"String","label":"Section","name":"sectionId","required":true,"dictionary":"getSectionsDictionary","dependsOn":["projectId"],"description":"Unique identifier for the section."}
   *
   * @returns {Object} Returns the complete record for a single section.
   * @sampleResult {"createdAt": "2024-12-17T22:44:54.951Z","name": "goo","sectionId": "1209002919239968","projectName": "Test+2","projectId": "1208998714551627"}
   */
  async getSectionById(workspaceId, projectId, sectionId) {
    logger.debug('[getSectionById] Payload', { workspaceId, projectId, sectionId })

    const res = await this.#apiRequest({
      url: `${ API_BASE_URL }/sections/${ sectionId }`,
      logTag: 'getSectionById',
    })

    return Normalizer.section(res.data)
  }

  /**
   * @description Retrieves a User by email or ID.
   *
   * @route GET /users
   * @operationName Find User by email or ID
   * @category Organization
   *
   * @appearanceColor #f9566d #fb874b
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes default
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Unique identifier for the workspace."}
   * @paramDef {"type":"String","label":"Email or User ID","name":"identity","required":true,"description":"You could use a part of user email or ID. Method will return exact match (if exist) or user with matching identity."}
   *
   * @returns {Object} Returns the full user record.
   * @sampleResult {"name": "Test","userId": "1208998713785730","email": "test@gmail.com"}
   */
  async findUser(workspaceId, identity) {
    logger.debug('[findUser] Payload', { workspaceId, identity })

    const users = []

    let offset, match

    do {
      const { data, next_page } = await this.#apiRequest({
        url: `${ API_BASE_URL }/users`,
        query: {
          workspace: workspaceId,
          limit: DEFAULT_LIMIT,
          offset,
          opt_fields: 'email,gid',
        },
        logTag: 'findUser',
      })

      users.push(...data)

      offset = next_page ? next_page.offset : null
    } while (offset)

    for (const user of users) {
      if (user.gid === identity || user.email === identity) {
        match = user

        break
      }

      if (similar(user.gid, identity) || similar(user.email, identity)) {
        match = user
      }
    }

    if (match) {
      const {
        data: { email, gid, name },
      } = await this.#apiRequest({
        url: `${ API_BASE_URL }/users/${ match.gid }`,
        query: { opt_fields: 'email,gid,name' },
        logTag: 'findUser - get match ',
      })

      return { email, userId: gid, name }
    }

    return null
  }
}

Flowrunner.ServerCode.addService(Asana, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth2 Client ID for Asana API integration.',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth2 Client Secret for Asana API integration.',
  },
])

/**
 * @typedef {Object} executeCallback_ResultObject
 *
 * @property {String} token
 * @property {String} refreshToken
 * @property {Number} expirationInSeconds
 * @property {Object} userData
 * @property {String} connectionIdentityName
 */

/**
 * @typedef {Object} refreshToken_ResultObject
 *
 * @property {String} token
 * @property {Number} expirationInSeconds
 */

/**
 * @typedef {Object} chargeData
 * @property {String} token
 * @property {Number} amount
 */
