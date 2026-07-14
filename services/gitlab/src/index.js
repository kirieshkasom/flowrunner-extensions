'use strict'

const logger = {
  info: (...args) => console.log('[GitLab] info:', ...args),
  debug: (...args) => console.log('[GitLab] debug:', ...args),
  error: (...args) => console.log('[GitLab] error:', ...args),
  warn: (...args) => console.log('[GitLab] warn:', ...args),
}

/**
 * @integrationName GitLab
 * @integrationIcon /icon.png
 */
class GitLab {
  constructor(config) {
    this.config = config || {}
    // Strip a trailing slash so `${baseUrl}/api/v4` never doubles up.
    const rawBaseUrl = (this.config.baseUrl || 'https://gitlab.com').trim()
    this.baseUrl = rawBaseUrl.replace(/\/+$/, '')
    this.accessToken = this.config.accessToken
    this.apiBase = `${ this.baseUrl }/api/v4`
  }

  // ======================================== INTERNAL HELPERS ========================================

  /**
   * Encodes a project reference for use in a URL path segment. Accepts either a numeric project ID
   * (e.g. 12345 or "12345") or a namespaced path (e.g. "my-group/my-project"). Numeric IDs pass
   * through unchanged; a path is URL-encoded in full so slashes become %2F.
   * @private
   * @param {string|number} project
   * @returns {string}
   */
  #encodeProject(project) {
    const value = String(project == null ? '' : project).trim()

    // A pure integer ID is used verbatim; anything else is treated as a group/project path.
    if (/^\d+$/.test(value)) {
      return value
    }

    return encodeURIComponent(value)
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #cleanObject(obj) {
    if (!obj) return obj

    Object.keys(obj).forEach(key => {
      if (obj[key] === undefined || obj[key] === null || obj[key] === '') {
        delete obj[key]
      }
    })

    return obj
  }

  #handleError(error) {
    // GitLab is inconsistent: validation errors use { message: ... } (string or object keyed by
    // field), while some endpoints use { error: ... }. Surface whichever is present.
    const body = error?.body || {}
    let message

    if (typeof body.message === 'string') {
      message = body.message
    } else if (body.message && typeof body.message === 'object') {
      message = JSON.stringify(body.message)
    } else if (typeof body.error === 'string') {
      message = body.error
    } else if (typeof error?.message === 'string') {
      message = error.message
    } else {
      message = `request failed${ error?.status ? ` (HTTP ${ error.status })` : '' }`
    }

    const wrapped = new Error(`GitLab API error: ${ message }`)
    wrapped.status = error?.status || error?.statusCode
    wrapped.body = error?.body
    throw wrapped
  }

  async #apiRequest({ url, method = 'get', body, query }) {
    try {
      logger.debug(`[#apiRequest] ${ method.toUpperCase() } ${ url }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ 'PRIVATE-TOKEN': this.accessToken, 'Content-Type': 'application/json' })
        .query(query || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      logger.error('[#apiRequest] Error:', JSON.stringify(error?.body || error?.message || error))
      this.#handleError(error)
    }
  }

  // ======================================== DICTIONARIES ========================================

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
   * @typedef {Object} getProjectsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter projects by name or path."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Projects
   * @category Projects
   * @description Lists projects the authenticated user is a member of, for selecting a project in dependent parameters. Returns each project's numeric ID as the value.
   * @route POST /get-projects-dictionary
   * @paramDef {"type":"getProjectsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"cursor":null,"items":[{"label":"my-group / my-project","value":"12345","note":"Path: my-group/my-project"}]}
   */
  async getProjectsDictionary(payload) {
    const { search, cursor } = payload || {}
    const page = cursor ? parseInt(cursor, 10) : 1

    const response = await this.#apiRequest({
      url: `${ this.apiBase }/projects`,
      query: this.#cleanObject({ membership: true, search, per_page: 100, page, order_by: 'last_activity_at' }),
    })

    const projects = response || []

    return {
      items: projects.map(project => ({
        label: project.name_with_namespace || project.path_with_namespace,
        value: String(project.id),
        note: `Path: ${ project.path_with_namespace }`,
      })),
      cursor: projects.length === 100 ? String(page + 1) : null,
    }
  }

  /**
   * @typedef {Object} getBranchesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"description":"Project ID or 'group/project' path.","dictionary":"getProjectsDictionary"}
   */

  /**
   * @typedef {Object} getBranchesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter branches by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number)."}
   * @paramDef {"type":"getBranchesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Project information."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Branches
   * @category Repository
   * @description Lists branches in the selected project, for choosing a branch in dependent parameters.
   * @route POST /get-branches-dictionary
   * @paramDef {"type":"getBranchesDictionary__payload","label":"Payload","name":"payload","description":"Search, pagination and project criteria."}
   * @returns {DictionaryResponse}
   * @sampleResult {"cursor":null,"items":[{"label":"main","value":"main","note":"Default: true"}]}
   */
  async getBranchesDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const encoded = this.#encodeProject(criteria?.project)
    const page = cursor ? parseInt(cursor, 10) : 1

    const response = await this.#apiRequest({
      url: `${ this.apiBase }/projects/${ encoded }/repository/branches`,
      query: this.#cleanObject({ search, per_page: 100, page }),
    })

    const branches = response || []

    return {
      items: branches.map(branch => ({
        label: branch.name,
        value: branch.name,
        note: `Default: ${ Boolean(branch.default) }`,
      })),
      cursor: branches.length === 100 ? String(page + 1) : null,
    }
  }

  // ======================================== PROJECTS ========================================

  /**
   * @description Lists projects the authenticated user is a member of. Supports free-text search and page-based pagination (up to 100 per page). Results are ordered by most recent activity.
   * @route GET /list-projects
   * @operationName List Projects
   * @category Projects
   * @appearanceColor #FC6D26 #E24329
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter projects by name or path."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (default 1)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page, 1-100 (default 20)."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":12345,"name":"My Project","path_with_namespace":"my-group/my-project","default_branch":"main","visibility":"private","web_url":"https://gitlab.com/my-group/my-project"}]
   */
  async listProjects(search, page, perPage) {
    return await this.#apiRequest({
      url: `${ this.apiBase }/projects`,
      query: this.#cleanObject({
        membership: true,
        search,
        page: page || undefined,
        per_page: perPage || undefined,
        order_by: 'last_activity_at',
      }),
    })
  }

  /**
   * @description Retrieves a single project by its numeric ID or URL-encoded 'group/project' path, including its default branch, visibility, statistics and namespace details.
   * @route GET /get-project
   * @operationName Get Project
   * @category Projects
   * @appearanceColor #FC6D26 #E24329
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"description":"Project ID or 'group/project' path.","dictionary":"getProjectsDictionary"}
   *
   * @returns {Object}
   * @sampleResult {"id":12345,"name":"My Project","path_with_namespace":"my-group/my-project","default_branch":"main","visibility":"private","star_count":3,"web_url":"https://gitlab.com/my-group/my-project"}
   */
  async getProject(project) {
    return await this.#apiRequest({
      url: `${ this.apiBase }/projects/${ this.#encodeProject(project) }`,
    })
  }

  // ======================================== ISSUES ========================================

  /**
   * @description Creates a new issue in a project. Labels are passed as a comma-separated string, assignees as a comma-separated list of numeric user IDs. Optionally set a milestone and due date.
   * @route POST /create-issue
   * @operationName Create Issue
   * @category Issues
   * @appearanceColor #FC6D26 #E24329
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"description":"Project ID or 'group/project' path.","dictionary":"getProjectsDictionary"}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The issue title."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"The issue description (Markdown supported).","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Labels","name":"labels","description":"Comma-separated list of label names to apply."}
   * @paramDef {"type":"String","label":"Assignee IDs","name":"assigneeIds","description":"Comma-separated list of numeric user IDs to assign."}
   * @paramDef {"type":"Number","label":"Milestone ID","name":"milestoneId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The numeric milestone ID to associate."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Due date in YYYY-MM-DD format."}
   *
   * @returns {Object}
   * @sampleResult {"id":76,"iid":6,"project_id":12345,"title":"Found a bug","state":"opened","web_url":"https://gitlab.com/my-group/my-project/-/issues/6"}
   */
  async createIssue(project, title, description, labels, assigneeIds, milestoneId, dueDate) {
    const body = this.#cleanObject({
      title,
      description,
      labels,
      assignee_ids: assigneeIds ? assigneeIds.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)) : undefined,
      milestone_id: milestoneId || undefined,
      due_date: dueDate,
    })

    return await this.#apiRequest({
      url: `${ this.apiBase }/projects/${ this.#encodeProject(project) }/issues`,
      method: 'post',
      body,
    })
  }

  /**
   * @description Retrieves a single issue by its project-scoped internal ID (iid), including state, labels, assignees and milestone.
   * @route GET /get-issue
   * @operationName Get Issue
   * @category Issues
   * @appearanceColor #FC6D26 #E24329
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"description":"Project ID or 'group/project' path.","dictionary":"getProjectsDictionary"}
   * @paramDef {"type":"Number","label":"Issue IID","name":"issueIid","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The project-scoped internal ID of the issue."}
   *
   * @returns {Object}
   * @sampleResult {"id":76,"iid":6,"project_id":12345,"title":"Found a bug","state":"opened","labels":["bug"],"web_url":"https://gitlab.com/my-group/my-project/-/issues/6"}
   */
  async getIssue(project, issueIid) {
    return await this.#apiRequest({
      url: `${ this.apiBase }/projects/${ this.#encodeProject(project) }/issues/${ issueIid }`,
    })
  }

  /**
   * @description Lists issues in a project. Filter by state, labels, assignee username and free-text search. Supports page-based pagination.
   * @route GET /list-issues
   * @operationName List Issues
   * @category Issues
   * @appearanceColor #FC6D26 #E24329
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"description":"Project ID or 'group/project' path.","dictionary":"getProjectsDictionary"}
   * @paramDef {"type":"String","label":"State","name":"state","defaultValue":"All","uiComponent":{"type":"DROPDOWN","options":{"values":["Opened","Closed","All"]}},"description":"Filter issues by state."}
   * @paramDef {"type":"String","label":"Labels","name":"labels","description":"Comma-separated list of label names to filter by."}
   * @paramDef {"type":"String","label":"Assignee Username","name":"assigneeUsername","description":"Filter to issues assigned to this username."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Free-text search over title and description."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (default 1)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page, 1-100 (default 20)."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":76,"iid":6,"project_id":12345,"title":"Found a bug","state":"opened","labels":["bug"],"web_url":"https://gitlab.com/my-group/my-project/-/issues/6"}]
   */
  async listIssues(project, state, labels, assigneeUsername, search, page, perPage) {
    return await this.#apiRequest({
      url: `${ this.apiBase }/projects/${ this.#encodeProject(project) }/issues`,
      query: this.#cleanObject({
        state: this.#resolveChoice(state, { Opened: 'opened', Closed: 'closed', All: 'all' }),
        labels,
        assignee_username: assigneeUsername,
        search,
        page: page || undefined,
        per_page: perPage || undefined,
      }),
    })
  }

  /**
   * @description Updates an existing issue by its internal ID (iid). You can change the title, description, labels, assignees, milestone and due date. Setting State to Close or Reopen transitions the issue accordingly; leaving it blank keeps the current state.
   * @route PUT /update-issue
   * @operationName Update Issue
   * @category Issues
   * @appearanceColor #FC6D26 #E24329
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"description":"Project ID or 'group/project' path.","dictionary":"getProjectsDictionary"}
   * @paramDef {"type":"Number","label":"Issue IID","name":"issueIid","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The project-scoped internal ID of the issue."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New issue title."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"New issue description (Markdown supported).","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"State Event","name":"stateEvent","uiComponent":{"type":"DROPDOWN","options":{"values":["Close","Reopen"]}},"description":"Optionally close or reopen the issue."}
   * @paramDef {"type":"String","label":"Labels","name":"labels","description":"Comma-separated list of label names (replaces existing)."}
   * @paramDef {"type":"String","label":"Assignee IDs","name":"assigneeIds","description":"Comma-separated list of numeric user IDs to assign."}
   * @paramDef {"type":"Number","label":"Milestone ID","name":"milestoneId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The numeric milestone ID to associate."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Due date in YYYY-MM-DD format."}
   *
   * @returns {Object}
   * @sampleResult {"id":76,"iid":6,"project_id":12345,"title":"Updated title","state":"closed","web_url":"https://gitlab.com/my-group/my-project/-/issues/6"}
   */
  async updateIssue(project, issueIid, title, description, stateEvent, labels, assigneeIds, milestoneId, dueDate) {
    const body = this.#cleanObject({
      title,
      description,
      state_event: this.#resolveChoice(stateEvent, { Close: 'close', Reopen: 'reopen' }),
      labels,
      assignee_ids: assigneeIds ? assigneeIds.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)) : undefined,
      milestone_id: milestoneId || undefined,
      due_date: dueDate,
    })

    return await this.#apiRequest({
      url: `${ this.apiBase }/projects/${ this.#encodeProject(project) }/issues/${ issueIid }`,
      method: 'put',
      body,
    })
  }

  /**
   * @description Adds a note (comment) to an issue, identified by its internal ID (iid). The note body supports GitLab-flavored Markdown.
   * @route POST /create-issue-note
   * @operationName Create Issue Note
   * @category Issues
   * @appearanceColor #FC6D26 #E24329
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"description":"Project ID or 'group/project' path.","dictionary":"getProjectsDictionary"}
   * @paramDef {"type":"Number","label":"Issue IID","name":"issueIid","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The project-scoped internal ID of the issue."}
   * @paramDef {"type":"String","label":"Body","name":"body","required":true,"description":"The comment body (Markdown supported).","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   *
   * @returns {Object}
   * @sampleResult {"id":302,"body":"This is a comment.","author":{"username":"octocat"},"created_at":"2024-01-01T12:00:00Z","noteable_iid":6}
   */
  async createIssueNote(project, issueIid, body) {
    return await this.#apiRequest({
      url: `${ this.apiBase }/projects/${ this.#encodeProject(project) }/issues/${ issueIid }/notes`,
      method: 'post',
      body: { body },
    })
  }

  // ======================================== MERGE REQUESTS ========================================

  /**
   * @description Creates a merge request from a source branch into a target branch. Optionally set a description and request removal of the source branch when the MR is merged.
   * @route POST /create-merge-request
   * @operationName Create Merge Request
   * @category Merge Requests
   * @appearanceColor #FC6D26 #E24329
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"description":"Project ID or 'group/project' path.","dictionary":"getProjectsDictionary"}
   * @paramDef {"type":"String","label":"Source Branch","name":"sourceBranch","required":true,"description":"The branch containing the changes.","dictionary":"getBranchesDictionary","dependsOn":["project"]}
   * @paramDef {"type":"String","label":"Target Branch","name":"targetBranch","required":true,"description":"The branch to merge into.","dictionary":"getBranchesDictionary","dependsOn":["project"]}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The merge request title."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"The merge request description (Markdown supported).","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"Boolean","label":"Remove Source Branch","name":"removeSourceBranch","uiComponent":{"type":"CHECKBOX"},"description":"Remove the source branch when the MR is merged."}
   *
   * @returns {Object}
   * @sampleResult {"id":101,"iid":12,"project_id":12345,"title":"Add feature","state":"opened","source_branch":"feature","target_branch":"main","web_url":"https://gitlab.com/my-group/my-project/-/merge_requests/12"}
   */
  async createMergeRequest(project, sourceBranch, targetBranch, title, description, removeSourceBranch) {
    const body = this.#cleanObject({
      source_branch: sourceBranch,
      target_branch: targetBranch,
      title,
      description,
      remove_source_branch: removeSourceBranch === undefined ? undefined : Boolean(removeSourceBranch),
    })

    return await this.#apiRequest({
      url: `${ this.apiBase }/projects/${ this.#encodeProject(project) }/merge_requests`,
      method: 'post',
      body,
    })
  }

  /**
   * @description Retrieves a single merge request by its project-scoped internal ID (iid), including state, source/target branches and merge status.
   * @route GET /get-merge-request
   * @operationName Get Merge Request
   * @category Merge Requests
   * @appearanceColor #FC6D26 #E24329
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"description":"Project ID or 'group/project' path.","dictionary":"getProjectsDictionary"}
   * @paramDef {"type":"Number","label":"Merge Request IID","name":"mergeRequestIid","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The project-scoped internal ID of the merge request."}
   *
   * @returns {Object}
   * @sampleResult {"id":101,"iid":12,"project_id":12345,"title":"Add feature","state":"opened","source_branch":"feature","target_branch":"main","merge_status":"can_be_merged","web_url":"https://gitlab.com/my-group/my-project/-/merge_requests/12"}
   */
  async getMergeRequest(project, mergeRequestIid) {
    return await this.#apiRequest({
      url: `${ this.apiBase }/projects/${ this.#encodeProject(project) }/merge_requests/${ mergeRequestIid }`,
    })
  }

  /**
   * @description Lists merge requests in a project. Filter by state and free-text search. Supports page-based pagination.
   * @route GET /list-merge-requests
   * @operationName List Merge Requests
   * @category Merge Requests
   * @appearanceColor #FC6D26 #E24329
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"description":"Project ID or 'group/project' path.","dictionary":"getProjectsDictionary"}
   * @paramDef {"type":"String","label":"State","name":"state","defaultValue":"All","uiComponent":{"type":"DROPDOWN","options":{"values":["Opened","Closed","Merged","All"]}},"description":"Filter merge requests by state."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Free-text search over title and description."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (default 1)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page, 1-100 (default 20)."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":101,"iid":12,"project_id":12345,"title":"Add feature","state":"opened","source_branch":"feature","target_branch":"main","web_url":"https://gitlab.com/my-group/my-project/-/merge_requests/12"}]
   */
  async listMergeRequests(project, state, search, page, perPage) {
    return await this.#apiRequest({
      url: `${ this.apiBase }/projects/${ this.#encodeProject(project) }/merge_requests`,
      query: this.#cleanObject({
        state: this.#resolveChoice(state, { Opened: 'opened', Closed: 'closed', Merged: 'merged', All: 'all' }),
        search,
        page: page || undefined,
        per_page: perPage || undefined,
      }),
    })
  }

  /**
   * @description Updates an existing merge request by its internal ID (iid). You can change the title, description and target branch. Setting State to Close or Reopen transitions the MR accordingly; leaving it blank keeps the current state.
   * @route PUT /update-merge-request
   * @operationName Update Merge Request
   * @category Merge Requests
   * @appearanceColor #FC6D26 #E24329
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"description":"Project ID or 'group/project' path.","dictionary":"getProjectsDictionary"}
   * @paramDef {"type":"Number","label":"Merge Request IID","name":"mergeRequestIid","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The project-scoped internal ID of the merge request."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New merge request title."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"New merge request description (Markdown supported).","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Target Branch","name":"targetBranch","description":"New target branch.","dictionary":"getBranchesDictionary","dependsOn":["project"]}
   * @paramDef {"type":"String","label":"State Event","name":"stateEvent","uiComponent":{"type":"DROPDOWN","options":{"values":["Close","Reopen"]}},"description":"Optionally close or reopen the merge request."}
   *
   * @returns {Object}
   * @sampleResult {"id":101,"iid":12,"project_id":12345,"title":"Updated title","state":"closed","target_branch":"main","web_url":"https://gitlab.com/my-group/my-project/-/merge_requests/12"}
   */
  async updateMergeRequest(project, mergeRequestIid, title, description, targetBranch, stateEvent) {
    const body = this.#cleanObject({
      title,
      description,
      target_branch: targetBranch,
      state_event: this.#resolveChoice(stateEvent, { Close: 'close', Reopen: 'reopen' }),
    })

    return await this.#apiRequest({
      url: `${ this.apiBase }/projects/${ this.#encodeProject(project) }/merge_requests/${ mergeRequestIid }`,
      method: 'put',
      body,
    })
  }

  /**
   * @description Merges a merge request identified by its internal ID (iid). Optionally set a custom merge commit message and squash the commits into one on merge.
   * @route PUT /merge-merge-request
   * @operationName Merge Merge Request
   * @category Merge Requests
   * @appearanceColor #FC6D26 #E24329
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"description":"Project ID or 'group/project' path.","dictionary":"getProjectsDictionary"}
   * @paramDef {"type":"Number","label":"Merge Request IID","name":"mergeRequestIid","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The project-scoped internal ID of the merge request."}
   * @paramDef {"type":"String","label":"Merge Commit Message","name":"mergeCommitMessage","description":"Custom merge commit message.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"Boolean","label":"Squash","name":"squash","uiComponent":{"type":"CHECKBOX"},"description":"Squash commits into a single commit on merge."}
   *
   * @returns {Object}
   * @sampleResult {"id":101,"iid":12,"project_id":12345,"title":"Add feature","state":"merged","merge_commit_sha":"abc123","web_url":"https://gitlab.com/my-group/my-project/-/merge_requests/12"}
   */
  async mergeMergeRequest(project, mergeRequestIid, mergeCommitMessage, squash) {
    const body = this.#cleanObject({
      merge_commit_message: mergeCommitMessage,
      squash: squash === undefined ? undefined : Boolean(squash),
    })

    return await this.#apiRequest({
      url: `${ this.apiBase }/projects/${ this.#encodeProject(project) }/merge_requests/${ mergeRequestIid }/merge`,
      method: 'put',
      body,
    })
  }

  /**
   * @description Adds a note (comment) to a merge request, identified by its internal ID (iid). The note body supports GitLab-flavored Markdown.
   * @route POST /create-merge-request-note
   * @operationName Add Merge Request Note
   * @category Merge Requests
   * @appearanceColor #FC6D26 #E24329
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"description":"Project ID or 'group/project' path.","dictionary":"getProjectsDictionary"}
   * @paramDef {"type":"Number","label":"Merge Request IID","name":"mergeRequestIid","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The project-scoped internal ID of the merge request."}
   * @paramDef {"type":"String","label":"Body","name":"body","required":true,"description":"The comment body (Markdown supported).","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   *
   * @returns {Object}
   * @sampleResult {"id":305,"body":"Looks good.","author":{"username":"octocat"},"created_at":"2024-01-01T12:00:00Z","noteable_iid":12}
   */
  async addMergeRequestNote(project, mergeRequestIid, body) {
    return await this.#apiRequest({
      url: `${ this.apiBase }/projects/${ this.#encodeProject(project) }/merge_requests/${ mergeRequestIid }/notes`,
      method: 'post',
      body: { body },
    })
  }

  // ======================================== REPOSITORY ========================================

  /**
   * @description Lists branches in a project's repository. Supports free-text search and page-based pagination.
   * @route GET /list-branches
   * @operationName List Branches
   * @category Repository
   * @appearanceColor #FC6D26 #E24329
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"description":"Project ID or 'group/project' path.","dictionary":"getProjectsDictionary"}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter branches by name."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (default 1)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page, 1-100 (default 20)."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"name":"main","default":true,"protected":true,"commit":{"id":"abc123","short_id":"abc123"},"web_url":"https://gitlab.com/my-group/my-project/-/tree/main"}]
   */
  async listBranches(project, search, page, perPage) {
    return await this.#apiRequest({
      url: `${ this.apiBase }/projects/${ this.#encodeProject(project) }/repository/branches`,
      query: this.#cleanObject({ search, page: page || undefined, per_page: perPage || undefined }),
    })
  }

  /**
   * @description Creates a new branch in a project's repository from an existing branch, tag or commit SHA (the ref).
   * @route POST /create-branch
   * @operationName Create Branch
   * @category Repository
   * @appearanceColor #FC6D26 #E24329
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"description":"Project ID or 'group/project' path.","dictionary":"getProjectsDictionary"}
   * @paramDef {"type":"String","label":"Branch","name":"branch","required":true,"description":"Name of the new branch."}
   * @paramDef {"type":"String","label":"Ref","name":"ref","required":true,"description":"Branch name, tag or commit SHA to create the branch from.","dictionary":"getBranchesDictionary","dependsOn":["project"]}
   *
   * @returns {Object}
   * @sampleResult {"name":"new-feature","default":false,"protected":false,"commit":{"id":"abc123","short_id":"abc123"},"web_url":"https://gitlab.com/my-group/my-project/-/tree/new-feature"}
   */
  async createBranch(project, branch, ref) {
    return await this.#apiRequest({
      url: `${ this.apiBase }/projects/${ this.#encodeProject(project) }/repository/branches`,
      method: 'post',
      query: { branch, ref },
    })
  }

  /**
   * @description Deletes a branch from a project's repository. This action is permanent.
   * @route DELETE /delete-branch
   * @operationName Delete Branch
   * @category Repository
   * @appearanceColor #FC6D26 #E24329
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"description":"Project ID or 'group/project' path.","dictionary":"getProjectsDictionary"}
   * @paramDef {"type":"String","label":"Branch","name":"branch","required":true,"description":"Name of the branch to delete.","dictionary":"getBranchesDictionary","dependsOn":["project"]}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"branch":"new-feature"}
   */
  async deleteBranch(project, branch) {
    await this.#apiRequest({
      url: `${ this.apiBase }/projects/${ this.#encodeProject(project) }/repository/branches/${ encodeURIComponent(branch) }`,
      method: 'delete',
    })

    return { success: true, branch }
  }

  /**
   * @description Retrieves a file from a project's repository at a given ref (branch, tag or commit). The file content is decoded from base64 into UTF-8 text and returned as `content`, alongside metadata and a `raw` flag indicating the content was decoded.
   * @route GET /get-file
   * @operationName Get File
   * @category Repository
   * @appearanceColor #FC6D26 #E24329
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"description":"Project ID or 'group/project' path.","dictionary":"getProjectsDictionary"}
   * @paramDef {"type":"String","label":"File Path","name":"filePath","required":true,"description":"Path to the file in the repository (e.g. src/index.js)."}
   * @paramDef {"type":"String","label":"Ref","name":"ref","required":true,"description":"Branch, tag or commit SHA to read from.","dictionary":"getBranchesDictionary","dependsOn":["project"]}
   *
   * @returns {Object}
   * @sampleResult {"file_name":"index.js","file_path":"src/index.js","size":1024,"ref":"main","blob_id":"abc123","content":"console.log('hi')","raw":true}
   */
  async getFile(project, filePath, ref) {
    const response = await this.#apiRequest({
      url: `${ this.apiBase }/projects/${ this.#encodeProject(project) }/repository/files/${ encodeURIComponent(filePath) }`,
      query: { ref },
    })

    let decoded = null

    if (response && response.encoding === 'base64' && typeof response.content === 'string') {
      decoded = Buffer.from(response.content, 'base64').toString('utf8')
    } else if (response) {
      decoded = response.content
    }

    return {
      ...response,
      content: decoded,
      raw: true,
    }
  }

  /**
   * @description Creates a new file or updates an existing file in a project's repository on a given branch, producing a commit. If the file already exists it is updated; otherwise it is created.
   * @route POST /save-file
   * @operationName Create or Update File
   * @category Repository
   * @appearanceColor #FC6D26 #E24329
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"description":"Project ID or 'group/project' path.","dictionary":"getProjectsDictionary"}
   * @paramDef {"type":"String","label":"File Path","name":"filePath","required":true,"description":"Path to the file in the repository (e.g. src/index.js)."}
   * @paramDef {"type":"String","label":"Branch","name":"branch","required":true,"description":"Branch to commit the change to.","dictionary":"getBranchesDictionary","dependsOn":["project"]}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"description":"The new file content (plain text).","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Commit Message","name":"commitMessage","required":true,"description":"The commit message for this change."}
   *
   * @returns {Object}
   * @sampleResult {"file_path":"src/index.js","branch":"main"}
   */
  async saveFile(project, filePath, branch, content, commitMessage) {
    const encodedProject = this.#encodeProject(project)
    const url = `${ this.apiBase }/projects/${ encodedProject }/repository/files/${ encodeURIComponent(filePath) }`
    const body = { branch, content, commit_message: commitMessage }

    // Determine whether the file already exists on this branch to choose create (POST) vs update (PUT).
    let exists = false

    try {
      await this.#apiRequest({ url, query: { ref: branch } })
      exists = true
    } catch (error) {
      if (error.status !== 404) throw error
    }

    return await this.#apiRequest({
      url,
      method: exists ? 'put' : 'post',
      body,
    })
  }

  /**
   * @description Lists commits in a project's repository. Optionally filter by ref (branch, tag or commit) and supports page-based pagination.
   * @route GET /list-commits
   * @operationName List Commits
   * @category Repository
   * @appearanceColor #FC6D26 #E24329
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"description":"Project ID or 'group/project' path.","dictionary":"getProjectsDictionary"}
   * @paramDef {"type":"String","label":"Ref","name":"ref","description":"Branch, tag or commit SHA to list commits from.","dictionary":"getBranchesDictionary","dependsOn":["project"]}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (default 1)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page, 1-100 (default 20)."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"abc123","short_id":"abc123","title":"Add feature","author_name":"Octocat","created_at":"2024-01-01T12:00:00Z","web_url":"https://gitlab.com/my-group/my-project/-/commit/abc123"}]
   */
  async listCommits(project, ref, page, perPage) {
    return await this.#apiRequest({
      url: `${ this.apiBase }/projects/${ this.#encodeProject(project) }/repository/commits`,
      query: this.#cleanObject({ ref_name: ref, page: page || undefined, per_page: perPage || undefined }),
    })
  }

  /**
   * @description Creates a commit on a branch with one or more file actions in a single request. Each action is an object with `action` (create, update or delete), `file_path`, and `content` (for create/update). Useful for atomic multi-file commits.
   * @route POST /create-commit
   * @operationName Create Commit
   * @category Repository
   * @appearanceColor #FC6D26 #E24329
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"description":"Project ID or 'group/project' path.","dictionary":"getProjectsDictionary"}
   * @paramDef {"type":"String","label":"Branch","name":"branch","required":true,"description":"Branch to commit to.","dictionary":"getBranchesDictionary","dependsOn":["project"]}
   * @paramDef {"type":"String","label":"Commit Message","name":"commitMessage","required":true,"description":"The commit message."}
   * @paramDef {"type":"Array<Object>","label":"Actions","name":"actions","required":true,"description":"Array of file action objects, each with action (create/update/delete), file_path, and content."}
   *
   * @returns {Object}
   * @sampleResult {"id":"abc123","short_id":"abc123","title":"Update files","author_name":"Octocat","created_at":"2024-01-01T12:00:00Z","web_url":"https://gitlab.com/my-group/my-project/-/commit/abc123"}
   */
  async createCommit(project, branch, commitMessage, actions) {
    const body = {
      branch,
      commit_message: commitMessage,
      actions: Array.isArray(actions) ? actions : [],
    }

    return await this.#apiRequest({
      url: `${ this.apiBase }/projects/${ this.#encodeProject(project) }/repository/commits`,
      method: 'post',
      body,
    })
  }

  // ======================================== PIPELINES ========================================

  /**
   * @description Lists CI/CD pipelines in a project. Optionally filter by ref (branch/tag) and status. Supports page-based pagination.
   * @route GET /list-pipelines
   * @operationName List Pipelines
   * @category Pipelines
   * @appearanceColor #FC6D26 #E24329
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"description":"Project ID or 'group/project' path.","dictionary":"getProjectsDictionary"}
   * @paramDef {"type":"String","label":"Ref","name":"ref","description":"Branch or tag name to filter pipelines by.","dictionary":"getBranchesDictionary","dependsOn":["project"]}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Running","Pending","Success","Failed","Canceled","Skipped","Manual","Created"]}},"description":"Filter pipelines by status."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (default 1)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page, 1-100 (default 20)."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":501,"iid":10,"project_id":12345,"status":"success","ref":"main","sha":"abc123","web_url":"https://gitlab.com/my-group/my-project/-/pipelines/501"}]
   */
  async listPipelines(project, ref, status, page, perPage) {
    return await this.#apiRequest({
      url: `${ this.apiBase }/projects/${ this.#encodeProject(project) }/pipelines`,
      query: this.#cleanObject({
        ref,
        status: this.#resolveChoice(status, {
          Running: 'running',
          Pending: 'pending',
          Success: 'success',
          Failed: 'failed',
          Canceled: 'canceled',
          Skipped: 'skipped',
          Manual: 'manual',
          Created: 'created',
        }),
        page: page || undefined,
        per_page: perPage || undefined,
      }),
    })
  }

  /**
   * @description Retrieves a single CI/CD pipeline by its numeric ID, including status, ref, commit SHA and timing details.
   * @route GET /get-pipeline
   * @operationName Get Pipeline
   * @category Pipelines
   * @appearanceColor #FC6D26 #E24329
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"description":"Project ID or 'group/project' path.","dictionary":"getProjectsDictionary"}
   * @paramDef {"type":"Number","label":"Pipeline ID","name":"pipelineId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The numeric pipeline ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":501,"iid":10,"project_id":12345,"status":"success","ref":"main","sha":"abc123","duration":120,"web_url":"https://gitlab.com/my-group/my-project/-/pipelines/501"}
   */
  async getPipeline(project, pipelineId) {
    return await this.#apiRequest({
      url: `${ this.apiBase }/projects/${ this.#encodeProject(project) }/pipelines/${ pipelineId }`,
    })
  }

  /**
   * @description Triggers a new CI/CD pipeline on a given ref (branch or tag). The pipeline runs the project's .gitlab-ci.yml configuration.
   * @route POST /trigger-pipeline
   * @operationName Trigger Pipeline
   * @category Pipelines
   * @appearanceColor #FC6D26 #E24329
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"description":"Project ID or 'group/project' path.","dictionary":"getProjectsDictionary"}
   * @paramDef {"type":"String","label":"Ref","name":"ref","required":true,"description":"Branch or tag to run the pipeline on.","dictionary":"getBranchesDictionary","dependsOn":["project"]}
   *
   * @returns {Object}
   * @sampleResult {"id":502,"iid":11,"project_id":12345,"status":"created","ref":"main","sha":"abc123","web_url":"https://gitlab.com/my-group/my-project/-/pipelines/502"}
   */
  async triggerPipeline(project, ref) {
    return await this.#apiRequest({
      url: `${ this.apiBase }/projects/${ this.#encodeProject(project) }/pipeline`,
      method: 'post',
      body: { ref },
    })
  }

  /**
   * @description Retries the failed and canceled jobs in an existing pipeline, identified by its numeric ID. Returns the updated pipeline.
   * @route POST /retry-pipeline
   * @operationName Retry Pipeline
   * @category Pipelines
   * @appearanceColor #FC6D26 #E24329
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"description":"Project ID or 'group/project' path.","dictionary":"getProjectsDictionary"}
   * @paramDef {"type":"Number","label":"Pipeline ID","name":"pipelineId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The numeric pipeline ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":501,"iid":10,"project_id":12345,"status":"running","ref":"main","sha":"abc123","web_url":"https://gitlab.com/my-group/my-project/-/pipelines/501"}
   */
  async retryPipeline(project, pipelineId) {
    return await this.#apiRequest({
      url: `${ this.apiBase }/projects/${ this.#encodeProject(project) }/pipelines/${ pipelineId }/retry`,
      method: 'post',
    })
  }

  /**
   * @description Cancels a running pipeline and its jobs, identified by its numeric ID. Returns the updated pipeline.
   * @route POST /cancel-pipeline
   * @operationName Cancel Pipeline
   * @category Pipelines
   * @appearanceColor #FC6D26 #E24329
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"description":"Project ID or 'group/project' path.","dictionary":"getProjectsDictionary"}
   * @paramDef {"type":"Number","label":"Pipeline ID","name":"pipelineId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The numeric pipeline ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":501,"iid":10,"project_id":12345,"status":"canceled","ref":"main","sha":"abc123","web_url":"https://gitlab.com/my-group/my-project/-/pipelines/501"}
   */
  async cancelPipeline(project, pipelineId) {
    return await this.#apiRequest({
      url: `${ this.apiBase }/projects/${ this.#encodeProject(project) }/pipelines/${ pipelineId }/cancel`,
      method: 'post',
    })
  }

  // ======================================== RELEASES ========================================

  /**
   * @description Lists releases in a project, ordered by release date. Supports page-based pagination.
   * @route GET /list-releases
   * @operationName List Releases
   * @category Releases
   * @appearanceColor #FC6D26 #E24329
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"description":"Project ID or 'group/project' path.","dictionary":"getProjectsDictionary"}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (default 1)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page, 1-100 (default 20)."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"tag_name":"v1.0.0","name":"Version 1.0.0","description":"First release","created_at":"2024-01-01T12:00:00Z","_links":{"self":"https://gitlab.com/my-group/my-project/-/releases/v1.0.0"}}]
   */
  async listReleases(project, page, perPage) {
    return await this.#apiRequest({
      url: `${ this.apiBase }/projects/${ this.#encodeProject(project) }/releases`,
      query: this.#cleanObject({ page: page || undefined, per_page: perPage || undefined }),
    })
  }

  /**
   * @description Creates a release for a project from a tag. If the tag does not yet exist, provide a ref (branch or commit SHA) and GitLab creates the tag from it. Optionally set a display name and description.
   * @route POST /create-release
   * @operationName Create Release
   * @category Releases
   * @appearanceColor #FC6D26 #E24329
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"description":"Project ID or 'group/project' path.","dictionary":"getProjectsDictionary"}
   * @paramDef {"type":"String","label":"Tag Name","name":"tagName","required":true,"description":"The Git tag for the release (created from Ref if it does not exist)."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Display name of the release."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Release notes (Markdown supported).","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Ref","name":"ref","description":"Branch or commit SHA to create the tag from, if the tag does not already exist.","dictionary":"getBranchesDictionary","dependsOn":["project"]}
   *
   * @returns {Object}
   * @sampleResult {"tag_name":"v1.0.0","name":"Version 1.0.0","description":"First release","created_at":"2024-01-01T12:00:00Z","_links":{"self":"https://gitlab.com/my-group/my-project/-/releases/v1.0.0"}}
   */
  async createRelease(project, tagName, name, description, ref) {
    const body = this.#cleanObject({
      tag_name: tagName,
      name,
      description,
      ref,
    })

    return await this.#apiRequest({
      url: `${ this.apiBase }/projects/${ this.#encodeProject(project) }/releases`,
      method: 'post',
      body,
    })
  }
}

Flowrunner.ServerCode.addService(GitLab, [
  {
    name: 'baseUrl',
    displayName: 'Base URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    defaultValue: 'https://gitlab.com',
    hint: 'For GitLab SaaS use https://gitlab.com. For a self-managed instance, use its URL (e.g. https://gitlab.example.com). Any trailing slash is stripped automatically.',
  },
  {
    name: 'accessToken',
    displayName: 'Access Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'A personal access token with the "api" scope. Create one in GitLab under Preferences > Access Tokens.',
  },
])

module.exports = GitLab
