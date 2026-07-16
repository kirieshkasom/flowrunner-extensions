const logger = {
  info: (...args) => console.log('[Taiga] info:', ...args),
  debug: (...args) => console.log('[Taiga] debug:', ...args),
  error: (...args) => console.log('[Taiga] error:', ...args),
  warn: (...args) => console.log('[Taiga] warn:', ...args),
}

/**
 * @integrationName Taiga
 * @integrationIcon /icon.svg
 */
class Taiga {
  constructor(config) {
    // Strip any trailing slash so URL concatenation is predictable. Defaults to the hosted app.
    this.url = (config.url || 'https://api.taiga.io').replace(/\/+$/, '')
    this.username = config.username
    this.password = config.password

    this.apiBaseUrl = `${ this.url }/api/v1`
    this.authUrl = `${ this.url }/api/v1/auth`
  }

  // ==================================================================================
  // Internal helpers
  // ==================================================================================

  // Mints a Taiga auth_token by exchanging the configured username/password on the first API call
  // of each invocation and caches it in memory for the lifetime of this service instance. This is a
  // normal username/password login (like an API key exchange), NOT an interactive OAuth connection,
  // so it is minted here rather than through the platform's OAuth system methods.
  async #getToken(forceRefresh = false) {
    if (this.authToken && !forceRefresh) {
      return this.authToken
    }

    logger.debug('requesting a new Taiga auth token (normal login)')

    let response

    try {
      response = await Flowrunner.Request.post(this.authUrl)
        .set({ 'Content-Type': 'application/json' })
        .send({ type: 'normal', username: this.username, password: this.password })
    } catch (error) {
      const message = this.#extractError(error)

      throw new Error(`Failed to obtain a Taiga auth token: ${ message }. Verify the API URL, username and password.`)
    }

    if (!response.auth_token) {
      throw new Error('Taiga auth endpoint did not return an auth_token')
    }

    this.authToken = response.auth_token

    return this.authToken
  }

  // Extracts a human-readable message from a Taiga error body. Taiga returns { _error_message }
  // for general errors and { field: [messages] } for field-level validation errors.
  #extractError(error) {
    const body = error?.body

    if (body && typeof body === 'object') {
      if (body._error_message) {
        return body._error_message
      }

      const fieldErrors = Object.entries(body)
        .filter(([key]) => key !== '_error_type')
        .map(([key, value]) => `${ key }: ${ Array.isArray(value) ? value.join(', ') : value }`)

      if (fieldErrors.length) {
        return fieldErrors.join('; ')
      }
    }

    if (typeof body === 'string' && body) {
      return body
    }

    return error?.message || 'Unknown error'
  }

  // Single request helper. Sends the cached token as a Bearer header. On a 401 the token is
  // re-minted once and the request retried, in case a cached token expired mid-invocation.
  async #apiRequest({ url, method = 'get', body, query, logTag, isRetry = false }) {
    const authToken = await this.#getToken()

    const cleanedQuery = {}

    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== '') {
        cleanedQuery[key] = value
      }
    }

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ 'Authorization': `Bearer ${ authToken }`, 'Content-Type': 'application/json' })
        .query(cleanedQuery)

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const status = error.status || error.statusCode

      // Refresh the token once on an auth failure, then retry the original request.
      if (status === 401 && !isRetry) {
        logger.warn(`${ logTag } - received 401, refreshing token and retrying once`)
        await this.#getToken(true)

        return this.#apiRequest({ url, method, body, query, logTag, isRetry: true })
      }

      const message = this.#extractError(error)

      logger.error(`${ logTag } - failed (${ status }): ${ message }`)

      throw new Error(`Taiga API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // ==================================================================================
  // Projects
  // ==================================================================================

  /**
   * @operationName List Projects
   * @description Lists Taiga projects visible to the authenticated user. Optionally filter to projects a specific member belongs to, or look up a project by its slug. Returns an array of project summaries including id, name, slug and description.
   * @category Projects
   * @route GET /projects
   * @paramDef {"type":"Number","label":"Member User ID","name":"member","description":"Only return projects that include this user (by user ID) as a member."}
   * @paramDef {"type":"String","label":"Slug","name":"slug","description":"Only return the project with this exact slug."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":1,"name":"Sample Project","slug":"sample-project","description":"A demo project","is_private":true,"owner":{"id":5,"username":"jane"}}]
   */
  async listProjects(member, slug) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/projects`,
      query: { member, slug },
      logTag: 'listProjects',
    })
  }

  /**
   * @operationName Get Project
   * @description Retrieves a single Taiga project by its numeric ID, including its name, slug, description, members, enabled modules and configured statuses for user stories, tasks and issues.
   * @category Projects
   * @route GET /projects/{id}
   * @paramDef {"type":"Number","label":"Project ID","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"Unique numeric identifier of the project."}
   * @returns {Object}
   * @sampleResult {"id":1,"name":"Sample Project","slug":"sample-project","description":"A demo project","total_milestones":3,"us_statuses":[{"id":1,"name":"New"}]}
   */
  async getProject(projectId) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/projects/${ projectId }`,
      logTag: 'getProject',
    })
  }

  /**
   * @operationName Get Project by Slug
   * @description Retrieves a single Taiga project by its slug (the human-readable identifier in project URLs) rather than its numeric ID. Returns the same detailed project object as Get Project.
   * @category Projects
   * @route GET /projects/by_slug
   * @paramDef {"type":"String","label":"Slug","name":"slug","required":true,"description":"The project slug, e.g. \"my-team-project\"."}
   * @returns {Object}
   * @sampleResult {"id":1,"name":"Sample Project","slug":"sample-project","description":"A demo project","us_statuses":[{"id":1,"name":"New"}]}
   */
  async getProjectBySlug(slug) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/projects/by_slug`,
      query: { slug },
      logTag: 'getProjectBySlug',
    })
  }

  // ==================================================================================
  // User Stories
  // ==================================================================================

  /**
   * @operationName List User Stories
   * @description Lists user stories, optionally filtered by project, status and milestone (sprint). Returns an array of user story objects including subject, status, assignee, points and the version number required for updates.
   * @category User Stories
   * @route GET /userstories
   * @paramDef {"type":"Number","label":"Project ID","name":"project","dictionary":"getProjectsDictionary","description":"Only return user stories belonging to this project."}
   * @paramDef {"type":"Number","label":"Status ID","name":"status","description":"Only return user stories in this user story status (by status ID)."}
   * @paramDef {"type":"Number","label":"Milestone ID","name":"milestone","description":"Only return user stories in this milestone/sprint (by milestone ID)."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":11,"ref":42,"subject":"As a user I can log in","status":1,"project":1,"milestone":3,"version":2,"is_closed":false}]
   */
  async listUserStories(project, status, milestone) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/userstories`,
      query: { project, status, milestone },
      logTag: 'listUserStories',
    })
  }

  /**
   * @operationName Get User Story
   * @description Retrieves a single user story by its ID, including subject, description, status, assignee, tags, points and its current version number (needed to perform an update).
   * @category User Stories
   * @route GET /userstories/{id}
   * @paramDef {"type":"Number","label":"User Story ID","name":"userStoryId","required":true,"description":"Unique numeric identifier of the user story."}
   * @returns {Object}
   * @sampleResult {"id":11,"ref":42,"subject":"As a user I can log in","description":"Login flow","status":1,"project":1,"version":2}
   */
  async getUserStory(userStoryId) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/userstories/${ userStoryId }`,
      logTag: 'getUserStory',
    })
  }

  /**
   * @operationName Create User Story
   * @description Creates a new user story in a Taiga project. Requires the project ID and a subject; optionally set the description, status, milestone (sprint) and tags. Returns the created user story including its new ID, ref and version.
   * @category User Stories
   * @route POST /userstories
   * @paramDef {"type":"Number","label":"Project ID","name":"project","required":true,"dictionary":"getProjectsDictionary","description":"ID of the project the user story belongs to."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Short title of the user story."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Full description of the user story."}
   * @paramDef {"type":"Number","label":"Status ID","name":"status","description":"User story status ID to assign. Defaults to the project's default status when omitted."}
   * @paramDef {"type":"Number","label":"Milestone ID","name":"milestone","description":"Milestone/sprint ID to place the user story in."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"List of tag names to attach to the user story."}
   * @returns {Object}
   * @sampleResult {"id":11,"ref":42,"subject":"As a user I can log in","project":1,"status":1,"version":1}
   */
  async createUserStory(project, subject, description, status, milestone, tags) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/userstories`,
      method: 'post',
      body: { project, subject, description, status, milestone, tags },
      logTag: 'createUserStory',
    })
  }

  /**
   * @operationName Update User Story
   * @description Updates fields on an existing user story. Taiga uses optimistic concurrency control, so you MUST pass the story's current version (from Get User Story) — the update is rejected if the version is stale. Only the fields you provide are changed.
   * @category User Stories
   * @route PATCH /userstories/{id}
   * @paramDef {"type":"Number","label":"User Story ID","name":"userStoryId","required":true,"description":"Unique numeric identifier of the user story to update."}
   * @paramDef {"type":"Number","label":"Version","name":"version","required":true,"description":"Current version number of the user story (from Get User Story). Required for optimistic locking."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"New title of the user story."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description of the user story."}
   * @paramDef {"type":"Number","label":"Status ID","name":"status","description":"New user story status ID."}
   * @paramDef {"type":"Number","label":"Milestone ID","name":"milestone","description":"New milestone/sprint ID (or null to move to the backlog)."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Replacement list of tag names."}
   * @returns {Object}
   * @sampleResult {"id":11,"ref":42,"subject":"Updated subject","project":1,"status":2,"version":3}
   */
  async updateUserStory(userStoryId, version, subject, description, status, milestone, tags) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/userstories/${ userStoryId }`,
      method: 'patch',
      body: { version, subject, description, status, milestone, tags },
      logTag: 'updateUserStory',
    })
  }

  /**
   * @operationName Delete User Story
   * @description Permanently deletes a user story by its ID. This also removes its tasks and cannot be undone. Returns a confirmation object.
   * @category User Stories
   * @route DELETE /userstories/{id}
   * @paramDef {"type":"Number","label":"User Story ID","name":"userStoryId","required":true,"description":"Unique numeric identifier of the user story to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":11}
   */
  async deleteUserStory(userStoryId) {
    await this.#apiRequest({
      url: `${ this.apiBaseUrl }/userstories/${ userStoryId }`,
      method: 'delete',
      logTag: 'deleteUserStory',
    })

    return { deleted: true, id: userStoryId }
  }

  // ==================================================================================
  // Tasks
  // ==================================================================================

  /**
   * @operationName List Tasks
   * @description Lists tasks, optionally filtered by project and by the user story they belong to. Returns an array of task objects including subject, status, assignee and the version number required for updates.
   * @category Tasks
   * @route GET /tasks
   * @paramDef {"type":"Number","label":"Project ID","name":"project","dictionary":"getProjectsDictionary","description":"Only return tasks belonging to this project."}
   * @paramDef {"type":"Number","label":"User Story ID","name":"userStory","description":"Only return tasks belonging to this user story (by user story ID)."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":21,"ref":100,"subject":"Write tests","status":1,"project":1,"user_story":11,"version":1}]
   */
  async listTasks(project, userStory) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/tasks`,
      query: { project, user_story: userStory },
      logTag: 'listTasks',
    })
  }

  /**
   * @operationName Get Task
   * @description Retrieves a single task by its ID, including subject, description, status, assignee, its parent user story and its current version number (needed to perform an update).
   * @category Tasks
   * @route GET /tasks/{id}
   * @paramDef {"type":"Number","label":"Task ID","name":"taskId","required":true,"description":"Unique numeric identifier of the task."}
   * @returns {Object}
   * @sampleResult {"id":21,"ref":100,"subject":"Write tests","status":1,"project":1,"user_story":11,"version":1}
   */
  async getTask(taskId) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/tasks/${ taskId }`,
      logTag: 'getTask',
    })
  }

  /**
   * @operationName Create Task
   * @description Creates a new task in a Taiga project. Requires the project ID and a subject; optionally attach it to a user story and set its status. Returns the created task including its new ID, ref and version.
   * @category Tasks
   * @route POST /tasks
   * @paramDef {"type":"Number","label":"Project ID","name":"project","required":true,"dictionary":"getProjectsDictionary","description":"ID of the project the task belongs to."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Short title of the task."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Full description of the task."}
   * @paramDef {"type":"Number","label":"User Story ID","name":"userStory","description":"ID of the parent user story to attach this task to."}
   * @paramDef {"type":"Number","label":"Status ID","name":"status","description":"Task status ID to assign. Defaults to the project's default status when omitted."}
   * @returns {Object}
   * @sampleResult {"id":21,"ref":100,"subject":"Write tests","project":1,"user_story":11,"status":1,"version":1}
   */
  async createTask(project, subject, description, userStory, status) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/tasks`,
      method: 'post',
      body: { project, subject, description, user_story: userStory, status },
      logTag: 'createTask',
    })
  }

  /**
   * @operationName Update Task
   * @description Updates fields on an existing task. Taiga uses optimistic concurrency control, so you MUST pass the task's current version (from Get Task) — the update is rejected if the version is stale. Only the fields you provide are changed.
   * @category Tasks
   * @route PATCH /tasks/{id}
   * @paramDef {"type":"Number","label":"Task ID","name":"taskId","required":true,"description":"Unique numeric identifier of the task to update."}
   * @paramDef {"type":"Number","label":"Version","name":"version","required":true,"description":"Current version number of the task (from Get Task). Required for optimistic locking."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"New title of the task."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description of the task."}
   * @paramDef {"type":"Number","label":"Status ID","name":"status","description":"New task status ID."}
   * @paramDef {"type":"Number","label":"User Story ID","name":"userStory","description":"New parent user story ID (or null to detach)."}
   * @returns {Object}
   * @sampleResult {"id":21,"ref":100,"subject":"Updated task","project":1,"status":2,"version":2}
   */
  async updateTask(taskId, version, subject, description, status, userStory) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/tasks/${ taskId }`,
      method: 'patch',
      body: { version, subject, description, status, user_story: userStory },
      logTag: 'updateTask',
    })
  }

  /**
   * @operationName Delete Task
   * @description Permanently deletes a task by its ID. This action cannot be undone. Returns a confirmation object.
   * @category Tasks
   * @route DELETE /tasks/{id}
   * @paramDef {"type":"Number","label":"Task ID","name":"taskId","required":true,"description":"Unique numeric identifier of the task to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":21}
   */
  async deleteTask(taskId) {
    await this.#apiRequest({
      url: `${ this.apiBaseUrl }/tasks/${ taskId }`,
      method: 'delete',
      logTag: 'deleteTask',
    })

    return { deleted: true, id: taskId }
  }

  // ==================================================================================
  // Issues
  // ==================================================================================

  /**
   * @operationName List Issues
   * @description Lists issues, optionally filtered by project. Returns an array of issue objects including subject, type, status, priority, severity, assignee and the version number required for updates.
   * @category Issues
   * @route GET /issues
   * @paramDef {"type":"Number","label":"Project ID","name":"project","dictionary":"getProjectsDictionary","description":"Only return issues belonging to this project."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":31,"ref":200,"subject":"Login button broken","status":1,"priority":3,"severity":2,"type":1,"project":1,"version":1}]
   */
  async listIssues(project) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/issues`,
      query: { project },
      logTag: 'listIssues',
    })
  }

  /**
   * @operationName Get Issue
   * @description Retrieves a single issue by its ID, including subject, description, type, status, priority, severity, assignee and its current version number (needed to perform an update).
   * @category Issues
   * @route GET /issues/{id}
   * @paramDef {"type":"Number","label":"Issue ID","name":"issueId","required":true,"description":"Unique numeric identifier of the issue."}
   * @returns {Object}
   * @sampleResult {"id":31,"ref":200,"subject":"Login button broken","status":1,"priority":3,"severity":2,"type":1,"project":1,"version":1}
   */
  async getIssue(issueId) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/issues/${ issueId }`,
      logTag: 'getIssue',
    })
  }

  /**
   * @operationName Create Issue
   * @description Creates a new issue in a Taiga project. Requires the project ID and a subject; optionally set the priority, severity, issue type and status (each referenced by its numeric ID from the project configuration). Returns the created issue including its new ID, ref and version.
   * @category Issues
   * @route POST /issues
   * @paramDef {"type":"Number","label":"Project ID","name":"project","required":true,"dictionary":"getProjectsDictionary","description":"ID of the project the issue belongs to."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Short title of the issue."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Full description of the issue."}
   * @paramDef {"type":"Number","label":"Priority ID","name":"priority","description":"Priority ID from the project configuration."}
   * @paramDef {"type":"Number","label":"Severity ID","name":"severity","description":"Severity ID from the project configuration."}
   * @paramDef {"type":"Number","label":"Type ID","name":"type","description":"Issue type ID from the project configuration."}
   * @paramDef {"type":"Number","label":"Status ID","name":"status","description":"Issue status ID. Defaults to the project's default status when omitted."}
   * @returns {Object}
   * @sampleResult {"id":31,"ref":200,"subject":"Login button broken","project":1,"priority":3,"severity":2,"type":1,"status":1,"version":1}
   */
  async createIssue(project, subject, description, priority, severity, type, status) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/issues`,
      method: 'post',
      body: { project, subject, description, priority, severity, type, status },
      logTag: 'createIssue',
    })
  }

  /**
   * @operationName Update Issue
   * @description Updates fields on an existing issue. Taiga uses optimistic concurrency control, so you MUST pass the issue's current version (from Get Issue) — the update is rejected if the version is stale. Only the fields you provide are changed.
   * @category Issues
   * @route PATCH /issues/{id}
   * @paramDef {"type":"Number","label":"Issue ID","name":"issueId","required":true,"description":"Unique numeric identifier of the issue to update."}
   * @paramDef {"type":"Number","label":"Version","name":"version","required":true,"description":"Current version number of the issue (from Get Issue). Required for optimistic locking."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"New title of the issue."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description of the issue."}
   * @paramDef {"type":"Number","label":"Priority ID","name":"priority","description":"New priority ID."}
   * @paramDef {"type":"Number","label":"Severity ID","name":"severity","description":"New severity ID."}
   * @paramDef {"type":"Number","label":"Type ID","name":"type","description":"New issue type ID."}
   * @paramDef {"type":"Number","label":"Status ID","name":"status","description":"New issue status ID."}
   * @returns {Object}
   * @sampleResult {"id":31,"ref":200,"subject":"Updated issue","project":1,"status":2,"version":2}
   */
  async updateIssue(issueId, version, subject, description, priority, severity, type, status) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/issues/${ issueId }`,
      method: 'patch',
      body: { version, subject, description, priority, severity, type, status },
      logTag: 'updateIssue',
    })
  }

  // ==================================================================================
  // Epics
  // ==================================================================================

  /**
   * @operationName List Epics
   * @description Lists epics, optionally filtered by project. Epics group related user stories across sprints. Returns an array of epic objects including subject, status, color and the version number required for updates.
   * @category Epics
   * @route GET /epics
   * @paramDef {"type":"Number","label":"Project ID","name":"project","dictionary":"getProjectsDictionary","description":"Only return epics belonging to this project."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":41,"ref":300,"subject":"Onboarding revamp","status":1,"project":1,"color":"#3498db","version":1}]
   */
  async listEpics(project) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/epics`,
      query: { project },
      logTag: 'listEpics',
    })
  }

  /**
   * @operationName Create Epic
   * @description Creates a new epic in a Taiga project. Requires the project ID and a subject; optionally set the description. Returns the created epic including its new ID, ref and version.
   * @category Epics
   * @route POST /epics
   * @paramDef {"type":"Number","label":"Project ID","name":"project","required":true,"dictionary":"getProjectsDictionary","description":"ID of the project the epic belongs to."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Short title of the epic."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Full description of the epic."}
   * @returns {Object}
   * @sampleResult {"id":41,"ref":300,"subject":"Onboarding revamp","project":1,"status":1,"version":1}
   */
  async createEpic(project, subject, description) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/epics`,
      method: 'post',
      body: { project, subject, description },
      logTag: 'createEpic',
    })
  }

  // ==================================================================================
  // Milestones (Sprints)
  // ==================================================================================

  /**
   * @operationName List Milestones
   * @description Lists milestones (sprints) for a project, including their name, start and finish dates, and roll-up statistics such as total and closed points. Returns an array of milestone objects.
   * @category Milestones
   * @route GET /milestones
   * @paramDef {"type":"Number","label":"Project ID","name":"project","dictionary":"getProjectsDictionary","description":"Only return milestones belonging to this project."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":3,"name":"Sprint 1","slug":"sprint-1","project":1,"estimated_start":"2026-07-01","estimated_finish":"2026-07-14","closed":false}]
   */
  async listMilestones(project) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/milestones`,
      query: { project },
      logTag: 'listMilestones',
    })
  }

  /**
   * @operationName Create Milestone
   * @description Creates a new milestone (sprint) in a Taiga project. Requires the project ID, a name and the estimated start and finish dates (ISO date, YYYY-MM-DD). Returns the created milestone including its new ID and slug.
   * @category Milestones
   * @route POST /milestones
   * @paramDef {"type":"Number","label":"Project ID","name":"project","required":true,"dictionary":"getProjectsDictionary","description":"ID of the project the milestone belongs to."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the milestone/sprint, e.g. \"Sprint 5\"."}
   * @paramDef {"type":"Date","label":"Estimated Start","name":"estimatedStart","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Planned start date of the sprint (YYYY-MM-DD)."}
   * @paramDef {"type":"Date","label":"Estimated Finish","name":"estimatedFinish","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Planned finish date of the sprint (YYYY-MM-DD)."}
   * @returns {Object}
   * @sampleResult {"id":3,"name":"Sprint 5","slug":"sprint-5","project":1,"estimated_start":"2026-07-01","estimated_finish":"2026-07-14"}
   */
  async createMilestone(project, name, estimatedStart, estimatedFinish) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/milestones`,
      method: 'post',
      body: {
        project,
        name,
        estimated_start: estimatedStart,
        estimated_finish: estimatedFinish,
      },
      logTag: 'createMilestone',
    })
  }

  // ==================================================================================
  // Members / Me
  // ==================================================================================

  /**
   * @operationName Get Me
   * @description Returns the profile of the authenticated Taiga user (id, username, full name, email). Useful as a connection check to confirm the configured credentials are valid.
   * @category Members
   * @route GET /users/me
   * @returns {Object}
   * @sampleResult {"id":5,"username":"jane","full_name":"Jane Doe","email":"jane@example.com","photo":null}
   */
  async getMe() {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/users/me`,
      logTag: 'getMe',
    })
  }

  /**
   * @operationName List Memberships
   * @description Lists project memberships, optionally filtered by project. Each membership links a user to a project with a role. Returns an array of membership objects including user, role, email and status.
   * @category Members
   * @route GET /memberships
   * @paramDef {"type":"Number","label":"Project ID","name":"project","dictionary":"getProjectsDictionary","description":"Only return memberships for this project."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":7,"user":5,"project":1,"role":2,"role_name":"Product Owner","full_name":"Jane Doe","is_admin":true}]
   */
  async listMemberships(project) {
    return this.#apiRequest({
      url: `${ this.apiBaseUrl }/memberships`,
      query: { project },
      logTag: 'listMemberships',
    })
  }

  // ==================================================================================
  // Dictionaries
  // ==================================================================================

  /**
   * @typedef {Object} getProjectsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter matched against project names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused; Taiga returns all visible projects)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Projects Dictionary
   * @description Lists the projects visible to the authenticated user for selection in dependent parameters, returning each project's name as the label and its numeric ID as the value.
   * @route POST /get-projects-dictionary
   * @paramDef {"type":"getProjectsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Sample Project","value":1,"note":"sample-project"}]}
   */
  async getProjectsDictionary(payload) {
    const { search } = payload || {}

    const projects = await this.#apiRequest({
      url: `${ this.apiBaseUrl }/projects`,
      logTag: 'getProjectsDictionary',
    })

    const term = (search || '').trim().toLowerCase()

    const items = (Array.isArray(projects) ? projects : [])
      .filter(project => !term || (project.name || '').toLowerCase().includes(term))
      .map(project => ({ label: project.name, value: project.id, note: project.slug }))

    return { items }
  }
}

Flowrunner.ServerCode.addService(Taiga, [
  {
    name: 'url',
    displayName: 'API URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    defaultValue: 'https://api.taiga.io',
    hint: 'Taiga API URL — https://api.taiga.io for the hosted app, or your self-hosted URL + /api if needed. Strip any trailing slash.',
  },
  {
    name: 'username',
    displayName: 'Username',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Taiga username or email.',
  },
  {
    name: 'password',
    displayName: 'Password',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Taiga password.',
  },
])
