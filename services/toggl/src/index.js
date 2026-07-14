const logger = {
  info: (...args) => console.log('[Toggl Track] info:', ...args),
  debug: (...args) => console.log('[Toggl Track] debug:', ...args),
  error: (...args) => console.log('[Toggl Track] error:', ...args),
  warn: (...args) => console.log('[Toggl Track] warn:', ...args),
}

const API_BASE_URL = 'https://api.track.toggl.com/api/v9'

const CREATED_WITH = 'FlowRunner'

const DEFAULT_DICTIONARY_LIMIT = 200

/**
 * Removes undefined and null values from an object so they are not sent to the API.
 * Empty strings are preserved because Toggl treats them as meaningful for some fields.
 */
function clean(obj) {
  if (!obj) {
    return obj
  }

  const result = {}

  for (const key in obj) {
    const value = obj[key]

    if (value !== undefined && value !== null) {
      result[key] = value
    }
  }

  return result
}

/**
 * @integrationName Toggl Track
 * @integrationIcon /icon.png
 */
class TogglTrackService {
  constructor(config) {
    this.apiToken = config.apiToken
  }

  /**
   * Builds the HTTP Basic auth header. Toggl authenticates with the API token as the
   * username and the literal string "api_token" as the password, base64 encoded.
   */
  #authHeader() {
    const encoded = Buffer.from(`${ this.apiToken }:api_token`).toString('base64')

    return `Basic ${ encoded }`
  }

  /**
   * Maps a friendly dropdown label to the value expected by the API. When the value is
   * not present in the mapping (already an API value or free text) it is returned as-is.
   */
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery || {}) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': this.#authHeader(),
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      // Toggl frequently returns plain-text error bodies; surface the text when present,
      // and fall back to a structured message otherwise.
      let message

      if (typeof error.body === 'string' && error.body.trim()) {
        message = error.body.trim()
      } else if (error.body?.message) {
        message = error.body.message
      } else if (typeof error.message === 'string') {
        message = error.message
      } else {
        message = JSON.stringify(error.message)
      }

      logger.error(`${ logTag } - failed (${ error.status || error.statusCode || 'n/a' }): ${ message }`)

      throw new Error(`Toggl Track API error: ${ message }`)
    }
  }

  // ==========================================================================
  // Time Entries
  // ==========================================================================

  /**
   * @operationName Create Time Entry
   * @category Time Entries
   * @description Creates a time entry in the given workspace. Provide a start time in ISO 8601 format and a duration in seconds for a completed entry. To create a running (unfinished) entry, set duration to -1 and start to the current time (see the Start Timer operation for a dedicated helper). Optionally associate a project, task, tags, and billable status.
   * @route POST /workspaces/{workspaceId}/time-entries
   * @appearanceColor #E57CD8 #F09FE6
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Workspace that owns the time entry. Select one or leave blank to use your default workspace."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Text description of what you worked on."}
   * @paramDef {"type":"String","label":"Start","name":"start","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start time in ISO 8601 format (e.g. 2026-07-14T09:00:00Z). Required by Toggl; defaults to the current time when omitted."}
   * @paramDef {"type":"Number","label":"Duration (seconds)","name":"duration","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Entry length in seconds for a completed entry. Use -1 for a running entry. Defaults to -1 (running) when omitted."}
   * @paramDef {"type":"String","label":"Stop","name":"stop","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional stop time in ISO 8601 format for a completed entry."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","dictionary":"getProjectsDictionary","dependsOn":["workspaceId"],"description":"Project to associate. Select a workspace first, or paste a numeric project ID."}
   * @paramDef {"type":"Number","label":"Task ID","name":"taskId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional numeric task ID within the project to associate."}
   * @paramDef {"type":"Array<String>","label":"Tag IDs","name":"tagIds","description":"Optional list of numeric tag IDs to attach to the entry."}
   * @paramDef {"type":"Boolean","label":"Billable","name":"billable","uiComponent":{"type":"CHECKBOX"},"description":"Whether the entry is billable. Requires a paid workspace plan."}
   *
   * @returns {Object}
   * @sampleResult {"id":123456789,"workspace_id":987654,"project_id":11223344,"task_id":null,"description":"Design review","start":"2026-07-14T09:00:00+00:00","stop":"2026-07-14T10:30:00+00:00","duration":5400,"billable":false,"tags":["design"],"tag_ids":[55],"created_with":"FlowRunner","at":"2026-07-14T10:30:00+00:00"}
   */
  async createTimeEntry(workspaceId, description, start, duration, stop, projectId, taskId, tagIds, billable) {
    const logTag = '[createTimeEntry]'
    const wid = await this.#resolveWorkspaceId(workspaceId)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ wid }/time_entries`,
      method: 'post',
      body: clean({
        workspace_id: Number(wid),
        description,
        start: start || new Date().toISOString(),
        duration: duration === undefined || duration === null ? -1 : Number(duration),
        stop,
        project_id: projectId !== undefined && projectId !== null && projectId !== '' ? Number(projectId) : undefined,
        task_id: taskId !== undefined && taskId !== null ? Number(taskId) : undefined,
        tag_ids: Array.isArray(tagIds) && tagIds.length ? tagIds.map(Number) : undefined,
        billable,
        created_with: CREATED_WITH,
      }),
    })
  }

  /**
   * @operationName Start Timer
   * @category Time Entries
   * @description Starts a new running time entry in the given workspace. This is a convenience wrapper around Create Time Entry that applies Toggl's running-entry convention automatically: it sets start to the current time and duration to -1, which marks the entry as unfinished. Use Stop Timer or Get Current Running Entry to manage it afterward.
   * @route POST /workspaces/{workspaceId}/time-entries/start
   * @appearanceColor #E57CD8 #F09FE6
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Workspace that owns the running entry. Select one or leave blank to use your default workspace."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Text description of what you are working on."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","dictionary":"getProjectsDictionary","dependsOn":["workspaceId"],"description":"Project to associate. Select a workspace first, or paste a numeric project ID."}
   * @paramDef {"type":"Number","label":"Task ID","name":"taskId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional numeric task ID within the project to associate."}
   * @paramDef {"type":"Array<String>","label":"Tag IDs","name":"tagIds","description":"Optional list of numeric tag IDs to attach to the running entry."}
   * @paramDef {"type":"Boolean","label":"Billable","name":"billable","uiComponent":{"type":"CHECKBOX"},"description":"Whether the entry is billable. Requires a paid workspace plan."}
   *
   * @returns {Object}
   * @sampleResult {"id":123456790,"workspace_id":987654,"project_id":11223344,"description":"Working on report","start":"2026-07-14T11:00:00+00:00","stop":null,"duration":-1,"billable":false,"tags":[],"created_with":"FlowRunner","at":"2026-07-14T11:00:00+00:00"}
   */
  async startTimer(workspaceId, description, projectId, taskId, tagIds, billable) {
    const logTag = '[startTimer]'
    const wid = await this.#resolveWorkspaceId(workspaceId)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ wid }/time_entries`,
      method: 'post',
      body: clean({
        workspace_id: Number(wid),
        description,
        start: new Date().toISOString(),
        duration: -1,
        project_id: projectId !== undefined && projectId !== null && projectId !== '' ? Number(projectId) : undefined,
        task_id: taskId !== undefined && taskId !== null ? Number(taskId) : undefined,
        tag_ids: Array.isArray(tagIds) && tagIds.length ? tagIds.map(Number) : undefined,
        billable,
        created_with: CREATED_WITH,
      }),
    })
  }

  /**
   * @operationName Stop Timer
   * @category Time Entries
   * @description Stops a running time entry. Toggl sets the stop time to the current moment and computes the final duration from the entry's start time. The entry must currently be running (duration -1) and belong to the given workspace.
   * @route PATCH /workspaces/{workspaceId}/time-entries/{timeEntryId}/stop
   * @appearanceColor #E57CD8 #F09FE6
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Workspace that owns the running entry. Select one or leave blank to use your default workspace."}
   * @paramDef {"type":"Number","label":"Time Entry ID","name":"timeEntryId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the running time entry to stop."}
   *
   * @returns {Object}
   * @sampleResult {"id":123456790,"workspace_id":987654,"description":"Working on report","start":"2026-07-14T11:00:00+00:00","stop":"2026-07-14T12:15:00+00:00","duration":4500,"billable":false,"at":"2026-07-14T12:15:00+00:00"}
   */
  async stopTimer(workspaceId, timeEntryId) {
    const logTag = '[stopTimer]'
    const wid = await this.#resolveWorkspaceId(workspaceId)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ wid }/time_entries/${ timeEntryId }/stop`,
      method: 'patch',
    })
  }

  /**
   * @operationName Get Current Running Entry
   * @category Time Entries
   * @description Returns the time entry that is currently running for the authenticated user across all workspaces, or null when nothing is running. A running entry has a duration of -1 and no stop time.
   * @route GET /me/time-entries/current
   * @appearanceColor #E57CD8 #F09FE6
   *
   * @returns {Object}
   * @sampleResult {"id":123456790,"workspace_id":987654,"project_id":11223344,"description":"Working on report","start":"2026-07-14T11:00:00+00:00","stop":null,"duration":-1,"billable":false,"tags":[],"at":"2026-07-14T11:00:00+00:00"}
   */
  async getCurrentRunningEntry() {
    const logTag = '[getCurrentRunningEntry]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/me/time_entries/current`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Time Entry
   * @category Time Entries
   * @description Retrieves a single time entry by its numeric ID for the authenticated user. Includes description, timing, duration, project/task association, tags, and billable status.
   * @route GET /me/time-entries/{timeEntryId}
   * @appearanceColor #E57CD8 #F09FE6
   *
   * @paramDef {"type":"Number","label":"Time Entry ID","name":"timeEntryId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the time entry to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":123456789,"workspace_id":987654,"project_id":11223344,"description":"Design review","start":"2026-07-14T09:00:00+00:00","stop":"2026-07-14T10:30:00+00:00","duration":5400,"billable":false,"tags":["design"],"at":"2026-07-14T10:30:00+00:00"}
   */
  async getTimeEntry(timeEntryId) {
    const logTag = '[getTimeEntry]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/me/time_entries/${ timeEntryId }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Time Entries
   * @category Time Entries
   * @description Lists the authenticated user's time entries, most recent first. Optionally filter by an inclusive start date and exclusive end date (ISO 8601 date or datetime). When no range is given, Toggl returns entries from roughly the last nine days. Dates more than three months apart are rejected by the API.
   * @route GET /me/time-entries
   * @appearanceColor #E57CD8 #F09FE6
   *
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Inclusive lower bound in ISO 8601 (e.g. 2026-07-01 or 2026-07-01T00:00:00Z)."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Exclusive upper bound in ISO 8601. Must be within three months of the start date."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":123456789,"workspace_id":987654,"project_id":11223344,"description":"Design review","start":"2026-07-14T09:00:00+00:00","stop":"2026-07-14T10:30:00+00:00","duration":5400,"billable":false,"tags":["design"],"at":"2026-07-14T10:30:00+00:00"}]
   */
  async listTimeEntries(startDate, endDate) {
    const logTag = '[listTimeEntries]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/me/time_entries`,
      method: 'get',
      query: {
        start_date: startDate,
        end_date: endDate,
      },
    })
  }

  /**
   * @operationName Update Time Entry
   * @category Time Entries
   * @description Updates fields on an existing time entry. Only the fields you provide are changed. You can adjust the description, start/stop times, duration, project/task association, tags, and billable status.
   * @route PUT /workspaces/{workspaceId}/time-entries/{timeEntryId}
   * @appearanceColor #E57CD8 #F09FE6
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Workspace that owns the time entry. Select one or leave blank to use your default workspace."}
   * @paramDef {"type":"Number","label":"Time Entry ID","name":"timeEntryId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the time entry to update."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"New description text."}
   * @paramDef {"type":"String","label":"Start","name":"start","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"New start time in ISO 8601 format."}
   * @paramDef {"type":"String","label":"Stop","name":"stop","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"New stop time in ISO 8601 format."}
   * @paramDef {"type":"Number","label":"Duration (seconds)","name":"duration","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New duration in seconds. Use -1 to mark the entry as running."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","dictionary":"getProjectsDictionary","dependsOn":["workspaceId"],"description":"Project to associate. Select a workspace first, or paste a numeric project ID."}
   * @paramDef {"type":"Number","label":"Task ID","name":"taskId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric task ID within the project to associate."}
   * @paramDef {"type":"Array<String>","label":"Tag IDs","name":"tagIds","description":"List of numeric tag IDs; replaces the existing tags on the entry."}
   * @paramDef {"type":"Boolean","label":"Billable","name":"billable","uiComponent":{"type":"CHECKBOX"},"description":"Whether the entry is billable. Requires a paid workspace plan."}
   *
   * @returns {Object}
   * @sampleResult {"id":123456789,"workspace_id":987654,"project_id":11223344,"description":"Design review (updated)","start":"2026-07-14T09:00:00+00:00","stop":"2026-07-14T10:45:00+00:00","duration":6300,"billable":true,"tags":["design"],"at":"2026-07-14T10:45:00+00:00"}
   */
  async updateTimeEntry(workspaceId, timeEntryId, description, start, stop, duration, projectId, taskId, tagIds, billable) {
    const logTag = '[updateTimeEntry]'
    const wid = await this.#resolveWorkspaceId(workspaceId)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ wid }/time_entries/${ timeEntryId }`,
      method: 'put',
      body: clean({
        workspace_id: Number(wid),
        description,
        start,
        stop,
        duration: duration !== undefined && duration !== null ? Number(duration) : undefined,
        project_id: projectId !== undefined && projectId !== null && projectId !== '' ? Number(projectId) : undefined,
        task_id: taskId !== undefined && taskId !== null ? Number(taskId) : undefined,
        tag_ids: Array.isArray(tagIds) ? tagIds.map(Number) : undefined,
        billable,
      }),
    })
  }

  /**
   * @operationName Delete Time Entry
   * @category Time Entries
   * @description Permanently deletes a time entry from the given workspace. This action cannot be undone.
   * @route DELETE /workspaces/{workspaceId}/time-entries/{timeEntryId}
   * @appearanceColor #E57CD8 #F09FE6
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Workspace that owns the time entry. Select one or leave blank to use your default workspace."}
   * @paramDef {"type":"Number","label":"Time Entry ID","name":"timeEntryId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the time entry to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"timeEntryId":123456789}
   */
  async deleteTimeEntry(workspaceId, timeEntryId) {
    const logTag = '[deleteTimeEntry]'
    const wid = await this.#resolveWorkspaceId(workspaceId)

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ wid }/time_entries/${ timeEntryId }`,
      method: 'delete',
    })

    return { success: true, timeEntryId: Number(timeEntryId) }
  }

  // ==========================================================================
  // Projects
  // ==========================================================================

  /**
   * @operationName List Projects
   * @category Projects
   * @description Lists projects in a workspace. Optionally filter by active status to return only active, only archived, or all projects.
   * @route GET /workspaces/{workspaceId}/projects
   * @appearanceColor #E57CD8 #F09FE6
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Workspace to list projects from. Select one or leave blank to use your default workspace."}
   * @paramDef {"type":"String","label":"Active Filter","name":"active","uiComponent":{"type":"DROPDOWN","options":{"values":["All","Active Only","Archived Only"]}},"description":"Filter projects by active status. Defaults to All."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":11223344,"workspace_id":987654,"client_id":778899,"name":"Website Redesign","active":true,"is_private":true,"billable":false,"color":"#0b83d9","at":"2026-07-01T08:00:00+00:00"}]
   */
  async listProjects(workspaceId, active) {
    const logTag = '[listProjects]'
    const wid = await this.#resolveWorkspaceId(workspaceId)

    const activeValue = this.#resolveChoice(active, {
      'All': 'both',
      'Active Only': 'true',
      'Archived Only': 'false',
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ wid }/projects`,
      method: 'get',
      query: {
        active: activeValue === 'both' ? undefined : activeValue,
      },
    })
  }

  /**
   * @operationName Get Project
   * @category Projects
   * @description Retrieves a single project by its numeric ID within a workspace, including its client, color, billable, privacy, and active status.
   * @route GET /workspaces/{workspaceId}/projects/{projectId}
   * @appearanceColor #E57CD8 #F09FE6
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Workspace that owns the project. Select one or leave blank to use your default workspace."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","dependsOn":["workspaceId"],"description":"Project to retrieve. Select a workspace first, or paste a numeric project ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":11223344,"workspace_id":987654,"client_id":778899,"name":"Website Redesign","active":true,"is_private":true,"billable":false,"color":"#0b83d9","at":"2026-07-01T08:00:00+00:00"}
   */
  async getProject(workspaceId, projectId) {
    const logTag = '[getProject]'
    const wid = await this.#resolveWorkspaceId(workspaceId)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ wid }/projects/${ projectId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Project
   * @category Projects
   * @description Creates a project in a workspace. Only the name is required. Optionally set a client, hex color, billable and privacy flags, and whether the project starts active.
   * @route POST /workspaces/{workspaceId}/projects
   * @appearanceColor #E57CD8 #F09FE6
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Workspace to create the project in. Select one or leave blank to use your default workspace."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Project name."}
   * @paramDef {"type":"String","label":"Client","name":"clientId","dictionary":"getClientsDictionary","dependsOn":["workspaceId"],"description":"Client to associate. Select a workspace first, or paste a numeric client ID."}
   * @paramDef {"type":"String","label":"Color","name":"color","description":"Project color as a hex string, e.g. #0b83d9."}
   * @paramDef {"type":"Boolean","label":"Active","name":"active","uiComponent":{"type":"CHECKBOX"},"description":"Whether the project is active. Defaults to true."}
   * @paramDef {"type":"Boolean","label":"Billable","name":"billable","uiComponent":{"type":"CHECKBOX"},"description":"Whether the project is billable. Requires a paid workspace plan."}
   * @paramDef {"type":"Boolean","label":"Private","name":"isPrivate","uiComponent":{"type":"CHECKBOX"},"description":"Whether the project is private to workspace admins and members. Defaults to true."}
   *
   * @returns {Object}
   * @sampleResult {"id":11223344,"workspace_id":987654,"client_id":778899,"name":"Website Redesign","active":true,"is_private":true,"billable":false,"color":"#0b83d9","at":"2026-07-14T08:00:00+00:00"}
   */
  async createProject(workspaceId, name, clientId, color, active, billable, isPrivate) {
    const logTag = '[createProject]'
    const wid = await this.#resolveWorkspaceId(workspaceId)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ wid }/projects`,
      method: 'post',
      body: clean({
        name,
        client_id: clientId !== undefined && clientId !== null && clientId !== '' ? Number(clientId) : undefined,
        color,
        active,
        billable,
        is_private: isPrivate,
      }),
    })
  }

  /**
   * @operationName Update Project
   * @category Projects
   * @description Updates an existing project. Only the fields you provide are changed. You can rename it, reassign the client, change the color, or toggle billable, privacy, and active status (set active to false to archive).
   * @route PUT /workspaces/{workspaceId}/projects/{projectId}
   * @appearanceColor #E57CD8 #F09FE6
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Workspace that owns the project. Select one or leave blank to use your default workspace."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","dependsOn":["workspaceId"],"description":"Project to update. Select a workspace first, or paste a numeric project ID."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New project name."}
   * @paramDef {"type":"String","label":"Client","name":"clientId","dictionary":"getClientsDictionary","dependsOn":["workspaceId"],"description":"Client to associate. Select a workspace first, or paste a numeric client ID."}
   * @paramDef {"type":"String","label":"Color","name":"color","description":"Project color as a hex string, e.g. #0b83d9."}
   * @paramDef {"type":"Boolean","label":"Active","name":"active","uiComponent":{"type":"CHECKBOX"},"description":"Whether the project is active. Set to false to archive it."}
   * @paramDef {"type":"Boolean","label":"Billable","name":"billable","uiComponent":{"type":"CHECKBOX"},"description":"Whether the project is billable. Requires a paid workspace plan."}
   * @paramDef {"type":"Boolean","label":"Private","name":"isPrivate","uiComponent":{"type":"CHECKBOX"},"description":"Whether the project is private to workspace admins and members."}
   *
   * @returns {Object}
   * @sampleResult {"id":11223344,"workspace_id":987654,"client_id":778899,"name":"Website Redesign v2","active":true,"is_private":true,"billable":true,"color":"#e36a00","at":"2026-07-14T09:00:00+00:00"}
   */
  async updateProject(workspaceId, projectId, name, clientId, color, active, billable, isPrivate) {
    const logTag = '[updateProject]'
    const wid = await this.#resolveWorkspaceId(workspaceId)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ wid }/projects/${ projectId }`,
      method: 'put',
      body: clean({
        name,
        client_id: clientId !== undefined && clientId !== null && clientId !== '' ? Number(clientId) : undefined,
        color,
        active,
        billable,
        is_private: isPrivate,
      }),
    })
  }

  /**
   * @operationName Delete Project
   * @category Projects
   * @description Permanently deletes a project from a workspace. Time entries previously associated with the project lose that association. This action cannot be undone.
   * @route DELETE /workspaces/{workspaceId}/projects/{projectId}
   * @appearanceColor #E57CD8 #F09FE6
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Workspace that owns the project. Select one or leave blank to use your default workspace."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","dependsOn":["workspaceId"],"description":"Project to delete. Select a workspace first, or paste a numeric project ID."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"projectId":11223344}
   */
  async deleteProject(workspaceId, projectId) {
    const logTag = '[deleteProject]'
    const wid = await this.#resolveWorkspaceId(workspaceId)

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ wid }/projects/${ projectId }`,
      method: 'delete',
    })

    return { success: true, projectId: Number(projectId) }
  }

  // ==========================================================================
  // Clients
  // ==========================================================================

  /**
   * @operationName List Clients
   * @category Clients
   * @description Lists all clients in a workspace, including their name and archived status.
   * @route GET /workspaces/{workspaceId}/clients
   * @appearanceColor #E57CD8 #F09FE6
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Workspace to list clients from. Select one or leave blank to use your default workspace."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":778899,"wid":987654,"name":"Acme Corp","archived":false,"at":"2026-06-01T10:00:00+00:00"}]
   */
  async listClients(workspaceId) {
    const logTag = '[listClients]'
    const wid = await this.#resolveWorkspaceId(workspaceId)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ wid }/clients`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Client
   * @category Clients
   * @description Creates a client in a workspace. Only the client name is required.
   * @route POST /workspaces/{workspaceId}/clients
   * @appearanceColor #E57CD8 #F09FE6
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Workspace to create the client in. Select one or leave blank to use your default workspace."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Client name."}
   *
   * @returns {Object}
   * @sampleResult {"id":778899,"wid":987654,"name":"Acme Corp","archived":false,"at":"2026-07-14T10:00:00+00:00"}
   */
  async createClient(workspaceId, name) {
    const logTag = '[createClient]'
    const wid = await this.#resolveWorkspaceId(workspaceId)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ wid }/clients`,
      method: 'post',
      body: clean({
        name,
        wid: Number(wid),
      }),
    })
  }

  /**
   * @operationName Update Client
   * @category Clients
   * @description Renames an existing client in a workspace.
   * @route PUT /workspaces/{workspaceId}/clients/{clientId}
   * @appearanceColor #E57CD8 #F09FE6
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Workspace that owns the client. Select one or leave blank to use your default workspace."}
   * @paramDef {"type":"String","label":"Client","name":"clientId","required":true,"dictionary":"getClientsDictionary","dependsOn":["workspaceId"],"description":"Client to update. Select a workspace first, or paste a numeric client ID."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"New client name."}
   *
   * @returns {Object}
   * @sampleResult {"id":778899,"wid":987654,"name":"Acme Corporation","archived":false,"at":"2026-07-14T11:00:00+00:00"}
   */
  async updateClient(workspaceId, clientId, name) {
    const logTag = '[updateClient]'
    const wid = await this.#resolveWorkspaceId(workspaceId)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ wid }/clients/${ clientId }`,
      method: 'put',
      body: clean({
        name,
        wid: Number(wid),
      }),
    })
  }

  /**
   * @operationName Delete Client
   * @category Clients
   * @description Permanently deletes a client from a workspace. Projects previously assigned to the client lose that association. This action cannot be undone.
   * @route DELETE /workspaces/{workspaceId}/clients/{clientId}
   * @appearanceColor #E57CD8 #F09FE6
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Workspace that owns the client. Select one or leave blank to use your default workspace."}
   * @paramDef {"type":"String","label":"Client","name":"clientId","required":true,"dictionary":"getClientsDictionary","dependsOn":["workspaceId"],"description":"Client to delete. Select a workspace first, or paste a numeric client ID."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"clientId":778899}
   */
  async deleteClient(workspaceId, clientId) {
    const logTag = '[deleteClient]'
    const wid = await this.#resolveWorkspaceId(workspaceId)

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ wid }/clients/${ clientId }`,
      method: 'delete',
    })

    return { success: true, clientId: Number(clientId) }
  }

  // ==========================================================================
  // Tags
  // ==========================================================================

  /**
   * @operationName List Tags
   * @category Tags
   * @description Lists all tags in a workspace. Tag IDs returned here can be attached to time entries.
   * @route GET /workspaces/{workspaceId}/tags
   * @appearanceColor #E57CD8 #F09FE6
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Workspace to list tags from. Select one or leave blank to use your default workspace."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":55,"workspace_id":987654,"name":"design","at":"2026-06-01T10:00:00+00:00"}]
   */
  async listTags(workspaceId) {
    const logTag = '[listTags]'
    const wid = await this.#resolveWorkspaceId(workspaceId)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ wid }/tags`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Tag
   * @category Tags
   * @description Creates a tag in a workspace. Only the tag name is required.
   * @route POST /workspaces/{workspaceId}/tags
   * @appearanceColor #E57CD8 #F09FE6
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Workspace to create the tag in. Select one or leave blank to use your default workspace."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Tag name."}
   *
   * @returns {Object}
   * @sampleResult {"id":55,"workspace_id":987654,"name":"design","at":"2026-07-14T10:00:00+00:00"}
   */
  async createTag(workspaceId, name) {
    const logTag = '[createTag]'
    const wid = await this.#resolveWorkspaceId(workspaceId)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ wid }/tags`,
      method: 'post',
      body: clean({
        name,
        workspace_id: Number(wid),
      }),
    })
  }

  /**
   * @operationName Update Tag
   * @category Tags
   * @description Renames an existing tag in a workspace.
   * @route PUT /workspaces/{workspaceId}/tags/{tagId}
   * @appearanceColor #E57CD8 #F09FE6
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Workspace that owns the tag. Select one or leave blank to use your default workspace."}
   * @paramDef {"type":"String","label":"Tag","name":"tagId","required":true,"dictionary":"getTagsDictionary","dependsOn":["workspaceId"],"description":"Tag to update. Select a workspace first, or paste a numeric tag ID."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"New tag name."}
   *
   * @returns {Object}
   * @sampleResult {"id":55,"workspace_id":987654,"name":"ux-design","at":"2026-07-14T11:00:00+00:00"}
   */
  async updateTag(workspaceId, tagId, name) {
    const logTag = '[updateTag]'
    const wid = await this.#resolveWorkspaceId(workspaceId)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ wid }/tags/${ tagId }`,
      method: 'put',
      body: clean({
        name,
      }),
    })
  }

  /**
   * @operationName Delete Tag
   * @category Tags
   * @description Permanently deletes a tag from a workspace. The tag is removed from any time entries it was attached to. This action cannot be undone.
   * @route DELETE /workspaces/{workspaceId}/tags/{tagId}
   * @appearanceColor #E57CD8 #F09FE6
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Workspace that owns the tag. Select one or leave blank to use your default workspace."}
   * @paramDef {"type":"String","label":"Tag","name":"tagId","required":true,"dictionary":"getTagsDictionary","dependsOn":["workspaceId"],"description":"Tag to delete. Select a workspace first, or paste a numeric tag ID."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"tagId":55}
   */
  async deleteTag(workspaceId, tagId) {
    const logTag = '[deleteTag]'
    const wid = await this.#resolveWorkspaceId(workspaceId)

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ wid }/tags/${ tagId }`,
      method: 'delete',
    })

    return { success: true, tagId: Number(tagId) }
  }

  // ==========================================================================
  // Tasks
  // ==========================================================================

  /**
   * @operationName List Tasks
   * @category Tasks
   * @description Lists tasks belonging to a project in a workspace. Tasks are a paid-plan feature and represent sub-units of work within a project.
   * @route GET /workspaces/{workspaceId}/projects/{projectId}/tasks
   * @appearanceColor #E57CD8 #F09FE6
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Workspace that owns the project. Select one or leave blank to use your default workspace."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","dependsOn":["workspaceId"],"description":"Project whose tasks to list. Select a workspace first, or paste a numeric project ID."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":44556677,"workspace_id":987654,"project_id":11223344,"name":"Wireframes","active":true,"estimated_seconds":0,"at":"2026-07-01T08:00:00+00:00"}]
   */
  async listTasks(workspaceId, projectId) {
    const logTag = '[listTasks]'
    const wid = await this.#resolveWorkspaceId(workspaceId)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ wid }/projects/${ projectId }/tasks`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Task
   * @category Tasks
   * @description Creates a task within a project. Only the task name is required. Optionally set an estimate in seconds and whether the task starts active. Tasks require a paid workspace plan.
   * @route POST /workspaces/{workspaceId}/projects/{projectId}/tasks
   * @appearanceColor #E57CD8 #F09FE6
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Workspace that owns the project. Select one or leave blank to use your default workspace."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","dependsOn":["workspaceId"],"description":"Project to create the task in. Select a workspace first, or paste a numeric project ID."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Task name."}
   * @paramDef {"type":"Number","label":"Estimated Seconds","name":"estimatedSeconds","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional time estimate for the task, in seconds."}
   * @paramDef {"type":"Boolean","label":"Active","name":"active","uiComponent":{"type":"CHECKBOX"},"description":"Whether the task is active. Defaults to true."}
   *
   * @returns {Object}
   * @sampleResult {"id":44556677,"workspace_id":987654,"project_id":11223344,"name":"Wireframes","active":true,"estimated_seconds":3600,"at":"2026-07-14T08:00:00+00:00"}
   */
  async createTask(workspaceId, projectId, name, estimatedSeconds, active) {
    const logTag = '[createTask]'
    const wid = await this.#resolveWorkspaceId(workspaceId)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ wid }/projects/${ projectId }/tasks`,
      method: 'post',
      body: clean({
        name,
        estimated_seconds: estimatedSeconds !== undefined && estimatedSeconds !== null ? Number(estimatedSeconds) : undefined,
        active,
      }),
    })
  }

  /**
   * @operationName Update Task
   * @category Tasks
   * @description Updates a task within a project. Only the fields you provide are changed. You can rename it, change its estimate, or toggle active status. Tasks require a paid workspace plan.
   * @route PUT /workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}
   * @appearanceColor #E57CD8 #F09FE6
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Workspace that owns the project. Select one or leave blank to use your default workspace."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","dependsOn":["workspaceId"],"description":"Project that owns the task. Select a workspace first, or paste a numeric project ID."}
   * @paramDef {"type":"Number","label":"Task ID","name":"taskId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the task to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New task name."}
   * @paramDef {"type":"Number","label":"Estimated Seconds","name":"estimatedSeconds","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New time estimate for the task, in seconds."}
   * @paramDef {"type":"Boolean","label":"Active","name":"active","uiComponent":{"type":"CHECKBOX"},"description":"Whether the task is active. Set to false to mark it done."}
   *
   * @returns {Object}
   * @sampleResult {"id":44556677,"workspace_id":987654,"project_id":11223344,"name":"Wireframes v2","active":false,"estimated_seconds":7200,"at":"2026-07-14T09:00:00+00:00"}
   */
  async updateTask(workspaceId, projectId, taskId, name, estimatedSeconds, active) {
    const logTag = '[updateTask]'
    const wid = await this.#resolveWorkspaceId(workspaceId)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ wid }/projects/${ projectId }/tasks/${ taskId }`,
      method: 'put',
      body: clean({
        name,
        estimated_seconds: estimatedSeconds !== undefined && estimatedSeconds !== null ? Number(estimatedSeconds) : undefined,
        active,
      }),
    })
  }

  /**
   * @operationName Delete Task
   * @category Tasks
   * @description Permanently deletes a task from a project. This action cannot be undone. Tasks require a paid workspace plan.
   * @route DELETE /workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}
   * @appearanceColor #E57CD8 #F09FE6
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Workspace that owns the project. Select one or leave blank to use your default workspace."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","dependsOn":["workspaceId"],"description":"Project that owns the task. Select a workspace first, or paste a numeric project ID."}
   * @paramDef {"type":"Number","label":"Task ID","name":"taskId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the task to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"taskId":44556677}
   */
  async deleteTask(workspaceId, projectId, taskId) {
    const logTag = '[deleteTask]'
    const wid = await this.#resolveWorkspaceId(workspaceId)

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ wid }/projects/${ projectId }/tasks/${ taskId }`,
      method: 'delete',
    })

    return { success: true, taskId: Number(taskId) }
  }

  // ==========================================================================
  // Workspace / User
  // ==========================================================================

  /**
   * @operationName Get Me
   * @category Workspace & User
   * @description Returns the authenticated user's profile, including default workspace ID, email, full name, timezone, and preferences. Enable Include Related Data to also embed the user's workspaces, projects, clients, and tags in a single response.
   * @route GET /me
   * @appearanceColor #E57CD8 #F09FE6
   *
   * @paramDef {"type":"Boolean","label":"Include Related Data","name":"withRelatedData","uiComponent":{"type":"CHECKBOX"},"description":"When true, embeds the user's workspaces, projects, clients, and tags in the response. Defaults to false."}
   *
   * @returns {Object}
   * @sampleResult {"id":112233,"api_token":"***","email":"user@example.com","fullname":"Jane Doe","timezone":"UTC","default_workspace_id":987654,"beginning_of_week":1,"at":"2026-07-14T08:00:00+00:00"}
   */
  async getMe(withRelatedData) {
    const logTag = '[getMe]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/me`,
      method: 'get',
      query: {
        with_related_data: withRelatedData === true ? true : undefined,
      },
    })
  }

  /**
   * @operationName List Workspace Users
   * @category Workspace & User
   * @description Lists the users who are members of a workspace, including their name, email, and admin status.
   * @route GET /workspaces/{workspaceId}/users
   * @appearanceColor #E57CD8 #F09FE6
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Workspace whose members to list. Select one or leave blank to use your default workspace."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":112233,"name":"Jane Doe","email":"user@example.com","admin":true,"active":true}]
   */
  async listWorkspaceUsers(workspaceId) {
    const logTag = '[listWorkspaceUsers]'
    const wid = await this.#resolveWorkspaceId(workspaceId)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ wid }/users`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Workspace
   * @category Workspace & User
   * @description Retrieves a single workspace by its numeric ID, including its name, organization, plan, and default settings.
   * @route GET /workspaces/{workspaceId}
   * @appearanceColor #E57CD8 #F09FE6
   *
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Workspace to retrieve. Select one or leave blank to use your default workspace."}
   *
   * @returns {Object}
   * @sampleResult {"id":987654,"organization_id":445566,"name":"My Workspace","premium":true,"admin":true,"default_currency":"USD","default_hourly_rate":0,"at":"2026-07-01T08:00:00+00:00"}
   */
  async getWorkspace(workspaceId) {
    const logTag = '[getWorkspace]'
    const wid = await this.#resolveWorkspaceId(workspaceId)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ wid }`,
      method: 'get',
    })
  }

  // ==========================================================================
  // Dictionaries
  // ==========================================================================

  /**
   * @typedef {Object} getWorkspacesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter workspaces by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Toggl returns all workspaces in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Workspaces Dictionary
   * @description Lists the authenticated user's workspaces for selecting a workspace in dependent parameters. The option value is the numeric workspace ID.
   * @route POST /get-workspaces-dictionary
   * @paramDef {"type":"getWorkspacesDictionary__payload","label":"Payload","name":"payload","description":"Optional search string and pagination cursor for filtering workspaces."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"My Workspace","value":"987654","note":"Workspace ID 987654"}],"cursor":null}
   */
  async getWorkspacesDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getWorkspacesDictionary]'

    const workspaces = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces`,
      method: 'get',
    })

    return {
      items: this.#toItems(workspaces, search, ws => ({
        label: ws.name,
        value: String(ws.id),
        note: `Workspace ID ${ ws.id }`,
      })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getProjectsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","description":"Workspace whose projects to list. Falls back to your default workspace when omitted."}
   */

  /**
   * @typedef {Object} getProjectsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter projects by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused; kept for API compatibility."}
   * @paramDef {"type":"getProjectsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Dependent selection context containing the workspace ID."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Projects Dictionary
   * @description Lists projects within the selected workspace for selecting a project in dependent parameters. The option value is the numeric project ID.
   * @route POST /get-projects-dictionary
   * @paramDef {"type":"getProjectsDictionary__payload","label":"Payload","name":"payload","description":"Search string, pagination cursor, and criteria with the workspace ID to list projects for."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Website Redesign","value":"11223344","note":"Active"}],"cursor":null}
   */
  async getProjectsDictionary(payload) {
    const { search, criteria } = payload || {}
    const logTag = '[getProjectsDictionary]'
    const wid = await this.#resolveWorkspaceId(criteria?.workspaceId)

    const projects = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ wid }/projects`,
      method: 'get',
    })

    return {
      items: this.#toItems(projects, search, project => ({
        label: project.name,
        value: String(project.id),
        note: project.active ? 'Active' : 'Archived',
      })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getClientsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","description":"Workspace whose clients to list. Falls back to your default workspace when omitted."}
   */

  /**
   * @typedef {Object} getClientsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter clients by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused; kept for API compatibility."}
   * @paramDef {"type":"getClientsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Dependent selection context containing the workspace ID."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Clients Dictionary
   * @description Lists clients within the selected workspace for selecting a client in dependent parameters. The option value is the numeric client ID.
   * @route POST /get-clients-dictionary
   * @paramDef {"type":"getClientsDictionary__payload","label":"Payload","name":"payload","description":"Search string, pagination cursor, and criteria with the workspace ID to list clients for."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Acme Corp","value":"778899","note":"Client ID 778899"}],"cursor":null}
   */
  async getClientsDictionary(payload) {
    const { search, criteria } = payload || {}
    const logTag = '[getClientsDictionary]'
    const wid = await this.#resolveWorkspaceId(criteria?.workspaceId)

    const clients = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ wid }/clients`,
      method: 'get',
    })

    return {
      items: this.#toItems(clients, search, client => ({
        label: client.name,
        value: String(client.id),
        note: `Client ID ${ client.id }`,
      })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getTagsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","description":"Workspace whose tags to list. Falls back to your default workspace when omitted."}
   */

  /**
   * @typedef {Object} getTagsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter tags by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Unused; kept for API compatibility."}
   * @paramDef {"type":"getTagsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Dependent selection context containing the workspace ID."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tags Dictionary
   * @description Lists tags within the selected workspace for selecting a tag in dependent parameters. The option value is the numeric tag ID.
   * @route POST /get-tags-dictionary
   * @paramDef {"type":"getTagsDictionary__payload","label":"Payload","name":"payload","description":"Search string, pagination cursor, and criteria with the workspace ID to list tags for."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"design","value":"55","note":"Tag ID 55"}],"cursor":null}
   */
  async getTagsDictionary(payload) {
    const { search, criteria } = payload || {}
    const logTag = '[getTagsDictionary]'
    const wid = await this.#resolveWorkspaceId(criteria?.workspaceId)

    const tags = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ wid }/tags`,
      method: 'get',
    })

    return {
      items: this.#toItems(tags, search, tag => ({
        label: tag.name,
        value: String(tag.id),
        note: `Tag ID ${ tag.id }`,
      })),
      cursor: null,
    }
  }

  // ==========================================================================
  // Internal helpers
  // ==========================================================================

  /**
   * Resolves the workspace ID to use for an operation. When a value is supplied it is used
   * directly; otherwise the authenticated user's default workspace ID is fetched from /me.
   */
  async #resolveWorkspaceId(workspaceId) {
    if (workspaceId !== undefined && workspaceId !== null && workspaceId !== '') {
      return workspaceId
    }

    const me = await this.#apiRequest({
      logTag: '[resolveWorkspaceId]',
      url: `${ API_BASE_URL }/me`,
      method: 'get',
    })

    if (!me || !me.default_workspace_id) {
      throw new Error('Toggl Track API error: no workspace provided and no default workspace found on the account.')
    }

    return me.default_workspace_id
  }

  /**
   * Filters a list by an optional case-insensitive search on the item name, caps the result
   * count, and maps each item to a dictionary option via the supplied mapper.
   */
  #toItems(list, search, mapper) {
    const rows = Array.isArray(list) ? list : []
    const term = (search || '').toLowerCase()

    const filtered = term
      ? rows.filter(row => (row.name || '').toLowerCase().includes(term))
      : rows

    return filtered.slice(0, DEFAULT_DICTIONARY_LIMIT).map(mapper)
  }
}

Flowrunner.ServerCode.addService(TogglTrackService, [
  {
    name: 'apiToken',
    displayName: 'API Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Toggl Track API token. In Toggl Track, go to Profile Settings and scroll to the bottom to find your API Token.',
  },
])
