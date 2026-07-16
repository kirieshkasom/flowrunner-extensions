const logger = {
  info: (...args) => console.log('[Clockify] info:', ...args),
  debug: (...args) => console.log('[Clockify] debug:', ...args),
  error: (...args) => console.log('[Clockify] error:', ...args),
  warn: (...args) => console.log('[Clockify] warn:', ...args),
}

const API_BASE_URL = 'https://api.clockify.me/api/v1'
const REPORTS_BASE_URL = 'https://reports.api.clockify.me/v1'

const DEFAULT_PAGE_SIZE = 50
const DICTIONARY_PAGE_SIZE = 50

// Clockify's fixed project palette (hex codes). Labels are the friendly color names.
const PROJECT_COLOR_MAP = {
  Red: '#F44336',
  Pink: '#E91E63',
  Purple: '#9C27B0',
  'Deep Purple': '#673AB7',
  Indigo: '#3F51B5',
  Blue: '#2196F3',
  'Light Blue': '#03A9F4',
  Cyan: '#00BCD4',
  Teal: '#009688',
  Green: '#4CAF50',
  'Light Green': '#8BC34A',
  Lime: '#CDDC39',
  Yellow: '#FFEB3B',
  Amber: '#FFC107',
  Orange: '#FF9800',
  'Deep Orange': '#FF5722',
  Brown: '#795548',
  Grey: '#9E9E9E',
  'Blue Grey': '#607D8B',
}

const TASK_STATUS_MAP = {
  Active: 'ACTIVE',
  Done: 'DONE',
}

const SUMMARY_GROUP_MAP = {
  Project: 'PROJECT',
  Client: 'CLIENT',
  Task: 'TASK',
  Tag: 'TAG',
  User: 'USER',
  Date: 'DATE',
}

function clean(obj) {
  if (!obj) {
    return obj
  }

  const result = {}

  for (const key in obj) {
    const value = obj[key]

    if (value !== undefined && value !== null && value !== '') {
      result[key] = value
    }
  }

  return result
}

/**
 * @integrationName Clockify
 * @integrationIcon /icon.png
 */
class ClockifyService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'X-Api-Key': this.apiKey,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const body = error.body || {}
      const message = body.message || error.message
      const code = body.code !== undefined ? ` (code ${ body.code })` : ''

      logger.error(`${ logTag } - failed: ${ message }${ code }`)

      throw new Error(`Clockify API error: ${ message }${ code }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Returns the id of the active user, used for user-scoped time-entry routes.
  async #getUserId() {
    const user = await this.#apiRequest({
      logTag: '[getUserId]',
      url: `${ API_BASE_URL }/user`,
      method: 'get',
    })

    return user.id
  }

  /* ============================ Time Entries ============================ */

  /**
   * @operationName Add Time Entry
   * @category Time Entries
   * @description Creates a time entry for the authenticated user in a workspace. Provide a start time (ISO-8601) and optionally an end time to log a completed entry; omit the end time to leave the entry running. Supports linking to a project, task, and tags, and setting billable status.
   * @route POST /add-time-entry
   * @appearanceColor #03A9F4 #4FC3F7
   *
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The workspace where the time entry is created."}
   * @paramDef {"type":"String","label":"Start Time","name":"start","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start time of the entry in ISO-8601 format, e.g. 2024-01-15T08:00:00Z."}
   * @paramDef {"type":"String","label":"End Time","name":"end","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional end time in ISO-8601 format. Leave empty to start a running entry."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description of the work performed."}
   * @paramDef {"type":"String","label":"Project ID","name":"projectId","dictionary":"getProjectsDictionary","description":"Optional project to associate with the entry."}
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","description":"Optional task ID within the selected project."}
   * @paramDef {"type":"Array<String>","label":"Tag IDs","name":"tagIds","description":"Optional list of tag IDs to attach to the entry."}
   * @paramDef {"type":"Boolean","label":"Billable","name":"billable","uiComponent":{"type":"TOGGLE"},"description":"Whether the entry is billable."}
   *
   * @returns {Object}
   * @sampleResult {"id":"64c1f0a2b1e2c3d4e5f60001","description":"Design review","projectId":"64b0a1...","taskId":null,"userId":"5f8a...","billable":true,"timeInterval":{"start":"2024-01-15T08:00:00Z","end":"2024-01-15T09:30:00Z","duration":"PT1H30M"},"tagIds":["5e9a..."],"workspaceId":"5f7c..."}
   */
  async addTimeEntry(workspaceId, start, end, description, projectId, taskId, tagIds, billable) {
    const logTag = '[addTimeEntry]'
    const userId = await this.#getUserId()

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ workspaceId }/user/${ userId }/time-entries`,
      method: 'post',
      body: clean({
        start,
        end,
        description,
        projectId,
        taskId,
        tagIds: tagIds && tagIds.length ? tagIds : undefined,
        billable,
      }),
    })
  }

  /**
   * @operationName Start Timer
   * @category Time Entries
   * @description Starts a running timer for the authenticated user by creating a time entry with the current time as the start and no end time. Any timer already running is stopped automatically by Clockify. Optionally associate the timer with a description, project, task, and tags.
   * @route POST /start-timer
   * @appearanceColor #03A9F4 #4FC3F7
   *
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The workspace where the timer starts."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description of the work being timed."}
   * @paramDef {"type":"String","label":"Project ID","name":"projectId","dictionary":"getProjectsDictionary","description":"Optional project to associate with the timer."}
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","description":"Optional task ID within the selected project."}
   * @paramDef {"type":"Array<String>","label":"Tag IDs","name":"tagIds","description":"Optional list of tag IDs to attach to the entry."}
   * @paramDef {"type":"Boolean","label":"Billable","name":"billable","uiComponent":{"type":"TOGGLE"},"description":"Whether the entry is billable."}
   *
   * @returns {Object}
   * @sampleResult {"id":"64c1f0a2b1e2c3d4e5f60002","description":"Writing docs","projectId":"64b0a1...","userId":"5f8a...","billable":false,"timeInterval":{"start":"2024-01-15T10:00:00Z","end":null,"duration":null},"workspaceId":"5f7c..."}
   */
  async startTimer(workspaceId, description, projectId, taskId, tagIds, billable) {
    const logTag = '[startTimer]'
    const userId = await this.#getUserId()

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ workspaceId }/user/${ userId }/time-entries`,
      method: 'post',
      body: clean({
        start: new Date().toISOString(),
        description,
        projectId,
        taskId,
        tagIds: tagIds && tagIds.length ? tagIds : undefined,
        billable,
      }),
    })
  }

  /**
   * @operationName Stop Timer
   * @category Time Entries
   * @description Stops the currently running timer for the authenticated user by setting its end time to the current time. Returns the completed time entry. Fails if no timer is currently running.
   * @route PATCH /stop-timer
   * @appearanceColor #03A9F4 #4FC3F7
   *
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The workspace whose running timer should be stopped."}
   *
   * @returns {Object}
   * @sampleResult {"id":"64c1f0a2b1e2c3d4e5f60002","description":"Writing docs","userId":"5f8a...","billable":false,"timeInterval":{"start":"2024-01-15T10:00:00Z","end":"2024-01-15T11:15:00Z","duration":"PT1H15M"},"workspaceId":"5f7c..."}
   */
  async stopTimer(workspaceId) {
    const logTag = '[stopTimer]'
    const userId = await this.#getUserId()

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ workspaceId }/user/${ userId }/time-entries`,
      method: 'patch',
      body: { end: new Date().toISOString() },
    })
  }

  /**
   * @operationName Get Time Entry
   * @category Time Entries
   * @description Retrieves a single time entry by its ID from a workspace, including its description, project, task, tags, billable flag, and time interval with computed duration.
   * @route GET /get-time-entry
   *
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The workspace that contains the time entry."}
   * @paramDef {"type":"String","label":"Time Entry ID","name":"timeEntryId","required":true,"description":"The ID of the time entry to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"64c1f0a2b1e2c3d4e5f60001","description":"Design review","projectId":"64b0a1...","userId":"5f8a...","billable":true,"timeInterval":{"start":"2024-01-15T08:00:00Z","end":"2024-01-15T09:30:00Z","duration":"PT1H30M"},"tagIds":["5e9a..."],"workspaceId":"5f7c..."}
   */
  async getTimeEntry(workspaceId, timeEntryId) {
    const logTag = '[getTimeEntry]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ workspaceId }/time-entries/${ timeEntryId }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Time Entries
   * @category Time Entries
   * @description Lists time entries for the authenticated user in a workspace, most recent first. Supports filtering by a start/end date range and by project, plus pagination. Set Hydrated to true to receive expanded project, task, and tag objects instead of just their IDs.
   * @route GET /list-time-entries
   *
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The workspace to list time entries from."}
   * @paramDef {"type":"String","label":"Range Start","name":"start","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional lower bound of the entry start time (ISO-8601)."}
   * @paramDef {"type":"String","label":"Range End","name":"end","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional upper bound of the entry start time (ISO-8601)."}
   * @paramDef {"type":"String","label":"Project ID","name":"projectId","dictionary":"getProjectsDictionary","description":"Optional project to filter entries by."}
   * @paramDef {"type":"Boolean","label":"Hydrated","name":"hydrated","uiComponent":{"type":"TOGGLE"},"description":"If true, returns expanded project, task, and tag objects instead of IDs."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number for pagination (default 1)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page, max 5000 (default 50)."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"64c1f0a2b1e2c3d4e5f60001","description":"Design review","projectId":"64b0a1...","billable":true,"timeInterval":{"start":"2024-01-15T08:00:00Z","end":"2024-01-15T09:30:00Z","duration":"PT1H30M"}}]
   */
  async listTimeEntries(workspaceId, start, end, projectId, hydrated, page, pageSize) {
    const logTag = '[listTimeEntries]'
    const userId = await this.#getUserId()

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ workspaceId }/user/${ userId }/time-entries`,
      method: 'get',
      query: {
        start,
        end,
        project: projectId,
        hydrated,
        page: page || 1,
        'page-size': pageSize || DEFAULT_PAGE_SIZE,
      },
    })
  }

  /**
   * @operationName Update Time Entry
   * @category Time Entries
   * @description Updates an existing time entry by its ID. All fields are replaced with the values provided, so include every field you want to keep. Supports changing the start/end time, description, project, task, tags, and billable status.
   * @route PUT /update-time-entry
   * @appearanceColor #03A9F4 #4FC3F7
   *
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The workspace that contains the time entry."}
   * @paramDef {"type":"String","label":"Time Entry ID","name":"timeEntryId","required":true,"description":"The ID of the time entry to update."}
   * @paramDef {"type":"String","label":"Start Time","name":"start","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start time in ISO-8601 format. Required by Clockify on update."}
   * @paramDef {"type":"String","label":"End Time","name":"end","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional end time in ISO-8601 format."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Description of the work performed."}
   * @paramDef {"type":"String","label":"Project ID","name":"projectId","dictionary":"getProjectsDictionary","description":"Project to associate with the entry."}
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","description":"Task ID within the selected project."}
   * @paramDef {"type":"Array<String>","label":"Tag IDs","name":"tagIds","description":"List of tag IDs to attach to the entry."}
   * @paramDef {"type":"Boolean","label":"Billable","name":"billable","uiComponent":{"type":"TOGGLE"},"description":"Whether the entry is billable."}
   *
   * @returns {Object}
   * @sampleResult {"id":"64c1f0a2b1e2c3d4e5f60001","description":"Design review (updated)","projectId":"64b0a1...","billable":false,"timeInterval":{"start":"2024-01-15T08:00:00Z","end":"2024-01-15T10:00:00Z","duration":"PT2H"},"workspaceId":"5f7c..."}
   */
  async updateTimeEntry(workspaceId, timeEntryId, start, end, description, projectId, taskId, tagIds, billable) {
    const logTag = '[updateTimeEntry]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ workspaceId }/time-entries/${ timeEntryId }`,
      method: 'put',
      body: clean({
        start,
        end,
        description,
        projectId,
        taskId,
        tagIds: tagIds && tagIds.length ? tagIds : undefined,
        billable,
      }),
    })
  }

  /**
   * @operationName Delete Time Entry
   * @category Time Entries
   * @description Permanently deletes a time entry by its ID from a workspace. This action cannot be undone.
   * @route DELETE /delete-time-entry
   * @appearanceColor #F44336 #E57373
   *
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The workspace that contains the time entry."}
   * @paramDef {"type":"String","label":"Time Entry ID","name":"timeEntryId","required":true,"description":"The ID of the time entry to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":"64c1f0a2b1e2c3d4e5f60001"}
   */
  async deleteTimeEntry(workspaceId, timeEntryId) {
    const logTag = '[deleteTimeEntry]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ workspaceId }/time-entries/${ timeEntryId }`,
      method: 'delete',
    })

    return { success: true, id: timeEntryId }
  }

  /* ============================ Projects ============================ */

  /**
   * @operationName List Projects
   * @category Projects
   * @description Lists projects in a workspace, optionally filtered by name and archived status, with pagination. Returns each project's name, client, color, billable and public flags, and archived state.
   * @route GET /list-projects
   *
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The workspace to list projects from."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Optional case-insensitive name filter."}
   * @paramDef {"type":"Boolean","label":"Archived","name":"archived","uiComponent":{"type":"TOGGLE"},"description":"If set, returns only archived (true) or only active (false) projects."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number for pagination (default 1)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page (default 50)."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"64b0a1b2c3d4e5f600010001","name":"Website Redesign","clientId":"5e9a...","clientName":"Acme","color":"#2196F3","billable":true,"public":false,"archived":false,"workspaceId":"5f7c..."}]
   */
  async listProjects(workspaceId, name, archived, page, pageSize) {
    const logTag = '[listProjects]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ workspaceId }/projects`,
      method: 'get',
      query: {
        name,
        archived,
        page: page || 1,
        'page-size': pageSize || DEFAULT_PAGE_SIZE,
      },
    })
  }

  /**
   * @operationName Get Project
   * @category Projects
   * @description Retrieves a single project by its ID from a workspace, including its name, client, color, billable and public flags, estimate settings, and archived state.
   * @route GET /get-project
   *
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The workspace that contains the project."}
   * @paramDef {"type":"String","label":"Project ID","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The ID of the project to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"64b0a1b2c3d4e5f600010001","name":"Website Redesign","clientId":"5e9a...","color":"#2196F3","billable":true,"public":false,"archived":false,"workspaceId":"5f7c..."}
   */
  async getProject(workspaceId, projectId) {
    const logTag = '[getProject]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ workspaceId }/projects/${ projectId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Project
   * @category Projects
   * @description Creates a new project in a workspace. Requires a name, and optionally accepts a client, color, billable and public flags, and a note. The color must be one of Clockify's supported project colors.
   * @route POST /create-project
   * @appearanceColor #4CAF50 #81C784
   *
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The workspace to create the project in."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The project name."}
   * @paramDef {"type":"String","label":"Client ID","name":"clientId","dictionary":"getClientsDictionary","description":"Optional client to associate with the project."}
   * @paramDef {"type":"String","label":"Color","name":"color","uiComponent":{"type":"DROPDOWN","options":{"values":["Red","Pink","Purple","Deep Purple","Indigo","Blue","Light Blue","Cyan","Teal","Green","Light Green","Lime","Yellow","Amber","Orange","Deep Orange","Brown","Grey","Blue Grey"]}},"description":"Project color used in the Clockify UI."}
   * @paramDef {"type":"Boolean","label":"Billable","name":"billable","uiComponent":{"type":"TOGGLE"},"description":"Whether time on this project is billable by default."}
   * @paramDef {"type":"Boolean","label":"Public","name":"isPublic","uiComponent":{"type":"TOGGLE"},"description":"Whether the project is visible to all workspace members."}
   * @paramDef {"type":"String","label":"Note","name":"note","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional note describing the project."}
   *
   * @returns {Object}
   * @sampleResult {"id":"64b0a1b2c3d4e5f600010002","name":"Mobile App","clientId":"5e9a...","color":"#4CAF50","billable":true,"public":true,"archived":false,"note":"Q1 initiative","workspaceId":"5f7c..."}
   */
  async createProject(workspaceId, name, clientId, color, billable, isPublic, note) {
    const logTag = '[createProject]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ workspaceId }/projects`,
      method: 'post',
      body: clean({
        name,
        clientId,
        color: this.#resolveChoice(color, PROJECT_COLOR_MAP),
        billable,
        isPublic,
        note,
      }),
    })
  }

  /**
   * @operationName Update Project
   * @category Projects
   * @description Updates an existing project by its ID. Only the fields provided are changed. Supports updating the name, client, color, billable and public flags, note, and archived status.
   * @route PUT /update-project
   * @appearanceColor #4CAF50 #81C784
   *
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The workspace that contains the project."}
   * @paramDef {"type":"String","label":"Project ID","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The ID of the project to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New project name."}
   * @paramDef {"type":"String","label":"Client ID","name":"clientId","dictionary":"getClientsDictionary","description":"Client to associate with the project."}
   * @paramDef {"type":"String","label":"Color","name":"color","uiComponent":{"type":"DROPDOWN","options":{"values":["Red","Pink","Purple","Deep Purple","Indigo","Blue","Light Blue","Cyan","Teal","Green","Light Green","Lime","Yellow","Amber","Orange","Deep Orange","Brown","Grey","Blue Grey"]}},"description":"Project color used in the Clockify UI."}
   * @paramDef {"type":"Boolean","label":"Billable","name":"billable","uiComponent":{"type":"TOGGLE"},"description":"Whether time on this project is billable by default."}
   * @paramDef {"type":"Boolean","label":"Public","name":"isPublic","uiComponent":{"type":"TOGGLE"},"description":"Whether the project is visible to all workspace members."}
   * @paramDef {"type":"Boolean","label":"Archived","name":"archived","uiComponent":{"type":"TOGGLE"},"description":"Whether to archive (true) or unarchive (false) the project."}
   * @paramDef {"type":"String","label":"Note","name":"note","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Note describing the project."}
   *
   * @returns {Object}
   * @sampleResult {"id":"64b0a1b2c3d4e5f600010001","name":"Website Redesign v2","color":"#FF9800","billable":true,"public":false,"archived":false,"workspaceId":"5f7c..."}
   */
  async updateProject(workspaceId, projectId, name, clientId, color, billable, isPublic, archived, note) {
    const logTag = '[updateProject]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ workspaceId }/projects/${ projectId }`,
      method: 'put',
      body: clean({
        name,
        clientId,
        color: this.#resolveChoice(color, PROJECT_COLOR_MAP),
        billable,
        isPublic,
        archived,
        note,
      }),
    })
  }

  /**
   * @operationName Delete Project
   * @category Projects
   * @description Permanently deletes a project by its ID from a workspace. The project must be archived before it can be deleted. This action cannot be undone.
   * @route DELETE /delete-project
   * @appearanceColor #F44336 #E57373
   *
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The workspace that contains the project."}
   * @paramDef {"type":"String","label":"Project ID","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The ID of the project to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":"64b0a1b2c3d4e5f600010001"}
   */
  async deleteProject(workspaceId, projectId) {
    const logTag = '[deleteProject]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ workspaceId }/projects/${ projectId }`,
      method: 'delete',
    })

    return { success: true, id: projectId }
  }

  /* ============================ Tasks ============================ */

  /**
   * @operationName List Tasks
   * @category Tasks
   * @description Lists tasks belonging to a project within a workspace, with pagination. Returns each task's name, status, assignees, and estimate.
   * @route GET /list-tasks
   *
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The workspace that contains the project."}
   * @paramDef {"type":"String","label":"Project ID","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project to list tasks from."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number for pagination (default 1)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page (default 50)."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"64d0a1b2c3d4e5f600020001","name":"Homepage layout","projectId":"64b0a1...","assigneeIds":["5f8a..."],"status":"ACTIVE","estimate":"PT4H"}]
   */
  async listTasks(workspaceId, projectId, page, pageSize) {
    const logTag = '[listTasks]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ workspaceId }/projects/${ projectId }/tasks`,
      method: 'get',
      query: {
        page: page || 1,
        'page-size': pageSize || DEFAULT_PAGE_SIZE,
      },
    })
  }

  /**
   * @operationName Create Task
   * @category Tasks
   * @description Creates a task within a project. Requires a task name, and optionally accepts a list of assignee user IDs and a time estimate in ISO-8601 duration format (e.g. PT4H for four hours).
   * @route POST /create-task
   * @appearanceColor #4CAF50 #81C784
   *
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The workspace that contains the project."}
   * @paramDef {"type":"String","label":"Project ID","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project to create the task in."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The task name."}
   * @paramDef {"type":"Array<String>","label":"Assignee IDs","name":"assigneeIds","description":"Optional list of user IDs to assign to the task."}
   * @paramDef {"type":"String","label":"Estimate","name":"estimate","description":"Optional time estimate in ISO-8601 duration format, e.g. PT4H30M."}
   *
   * @returns {Object}
   * @sampleResult {"id":"64d0a1b2c3d4e5f600020002","name":"API integration","projectId":"64b0a1...","assigneeIds":["5f8a..."],"status":"ACTIVE","estimate":"PT4H"}
   */
  async createTask(workspaceId, projectId, name, assigneeIds, estimate) {
    const logTag = '[createTask]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ workspaceId }/projects/${ projectId }/tasks`,
      method: 'post',
      body: clean({
        name,
        assigneeIds: assigneeIds && assigneeIds.length ? assigneeIds : undefined,
        estimate,
      }),
    })
  }

  /**
   * @operationName Update Task
   * @category Tasks
   * @description Updates a task within a project by its ID. Supports changing the task name, assignees, estimate, and status (Active or Done).
   * @route PUT /update-task
   * @appearanceColor #4CAF50 #81C784
   *
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The workspace that contains the project."}
   * @paramDef {"type":"String","label":"Project ID","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project that contains the task."}
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The ID of the task to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The task name. Required by Clockify on update."}
   * @paramDef {"type":"Array<String>","label":"Assignee IDs","name":"assigneeIds","description":"List of user IDs to assign to the task."}
   * @paramDef {"type":"String","label":"Estimate","name":"estimate","description":"Time estimate in ISO-8601 duration format, e.g. PT4H30M."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Done"]}},"description":"The task status."}
   *
   * @returns {Object}
   * @sampleResult {"id":"64d0a1b2c3d4e5f600020001","name":"Homepage layout","projectId":"64b0a1...","assigneeIds":["5f8a..."],"status":"DONE","estimate":"PT4H"}
   */
  async updateTask(workspaceId, projectId, taskId, name, assigneeIds, estimate, status) {
    const logTag = '[updateTask]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ workspaceId }/projects/${ projectId }/tasks/${ taskId }`,
      method: 'put',
      body: clean({
        name,
        assigneeIds: assigneeIds && assigneeIds.length ? assigneeIds : undefined,
        estimate,
        status: this.#resolveChoice(status, TASK_STATUS_MAP),
      }),
    })
  }

  /**
   * @operationName Delete Task
   * @category Tasks
   * @description Permanently deletes a task from a project by its ID. This action cannot be undone.
   * @route DELETE /delete-task
   * @appearanceColor #F44336 #E57373
   *
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The workspace that contains the project."}
   * @paramDef {"type":"String","label":"Project ID","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project that contains the task."}
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The ID of the task to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":"64d0a1b2c3d4e5f600020001"}
   */
  async deleteTask(workspaceId, projectId, taskId) {
    const logTag = '[deleteTask]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ workspaceId }/projects/${ projectId }/tasks/${ taskId }`,
      method: 'delete',
    })

    return { success: true, id: taskId }
  }

  /* ============================ Clients ============================ */

  /**
   * @operationName List Clients
   * @category Clients
   * @description Lists clients in a workspace, optionally filtered by name, with pagination. Returns each client's name, note, and archived state.
   * @route GET /list-clients
   *
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The workspace to list clients from."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Optional case-insensitive name filter."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number for pagination (default 1)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page (default 50)."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"5e9a1b2c3d4e5f6000030001","name":"Acme Corp","note":"Retainer client","archived":false,"workspaceId":"5f7c..."}]
   */
  async listClients(workspaceId, name, page, pageSize) {
    const logTag = '[listClients]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ workspaceId }/clients`,
      method: 'get',
      query: {
        name,
        page: page || 1,
        'page-size': pageSize || DEFAULT_PAGE_SIZE,
      },
    })
  }

  /**
   * @operationName Create Client
   * @category Clients
   * @description Creates a new client in a workspace. Requires a name and optionally accepts a note.
   * @route POST /create-client
   * @appearanceColor #4CAF50 #81C784
   *
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The workspace to create the client in."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The client name."}
   * @paramDef {"type":"String","label":"Note","name":"note","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional note describing the client."}
   *
   * @returns {Object}
   * @sampleResult {"id":"5e9a1b2c3d4e5f6000030002","name":"Globex","note":"New lead","archived":false,"workspaceId":"5f7c..."}
   */
  async createClient(workspaceId, name, note) {
    const logTag = '[createClient]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ workspaceId }/clients`,
      method: 'post',
      body: clean({ name, note }),
    })
  }

  /**
   * @operationName Update Client
   * @category Clients
   * @description Updates an existing client by its ID. Supports changing the name, note, and archived status.
   * @route PUT /update-client
   * @appearanceColor #4CAF50 #81C784
   *
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The workspace that contains the client."}
   * @paramDef {"type":"String","label":"Client ID","name":"clientId","required":true,"dictionary":"getClientsDictionary","description":"The ID of the client to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The client name. Required by Clockify on update."}
   * @paramDef {"type":"String","label":"Note","name":"note","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Note describing the client."}
   * @paramDef {"type":"Boolean","label":"Archived","name":"archived","uiComponent":{"type":"TOGGLE"},"description":"Whether to archive (true) or unarchive (false) the client."}
   *
   * @returns {Object}
   * @sampleResult {"id":"5e9a1b2c3d4e5f6000030001","name":"Acme Corporation","note":"Retainer client","archived":false,"workspaceId":"5f7c..."}
   */
  async updateClient(workspaceId, clientId, name, note, archived) {
    const logTag = '[updateClient]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ workspaceId }/clients/${ clientId }`,
      method: 'put',
      body: clean({ name, note, archived }),
    })
  }

  /**
   * @operationName Delete Client
   * @category Clients
   * @description Permanently deletes a client by its ID from a workspace. This action cannot be undone.
   * @route DELETE /delete-client
   * @appearanceColor #F44336 #E57373
   *
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The workspace that contains the client."}
   * @paramDef {"type":"String","label":"Client ID","name":"clientId","required":true,"dictionary":"getClientsDictionary","description":"The ID of the client to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":"5e9a1b2c3d4e5f6000030001"}
   */
  async deleteClient(workspaceId, clientId) {
    const logTag = '[deleteClient]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ workspaceId }/clients/${ clientId }`,
      method: 'delete',
    })

    return { success: true, id: clientId }
  }

  /* ============================ Tags ============================ */

  /**
   * @operationName List Tags
   * @category Tags
   * @description Lists tags in a workspace with pagination. Returns each tag's name and archived state.
   * @route GET /list-tags
   *
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The workspace to list tags from."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Optional case-insensitive name filter."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number for pagination (default 1)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page (default 50)."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"5e9a1b2c3d4e5f6000040001","name":"Billable","archived":false,"workspaceId":"5f7c..."}]
   */
  async listTags(workspaceId, name, page, pageSize) {
    const logTag = '[listTags]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ workspaceId }/tags`,
      method: 'get',
      query: {
        name,
        page: page || 1,
        'page-size': pageSize || DEFAULT_PAGE_SIZE,
      },
    })
  }

  /**
   * @operationName Create Tag
   * @category Tags
   * @description Creates a new tag in a workspace. Requires a tag name.
   * @route POST /create-tag
   * @appearanceColor #4CAF50 #81C784
   *
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The workspace to create the tag in."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The tag name."}
   *
   * @returns {Object}
   * @sampleResult {"id":"5e9a1b2c3d4e5f6000040002","name":"Urgent","archived":false,"workspaceId":"5f7c..."}
   */
  async createTag(workspaceId, name) {
    const logTag = '[createTag]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ workspaceId }/tags`,
      method: 'post',
      body: clean({ name }),
    })
  }

  /* ============================ Users ============================ */

  /**
   * @operationName Get Current User
   * @category Users
   * @description Retrieves the profile of the user that owns the API key, including their ID, name, email, active workspace, and default workspace. Use this to discover the default workspace ID for other operations.
   * @route GET /get-current-user
   *
   * @returns {Object}
   * @sampleResult {"id":"5f8a1b2c3d4e5f6000050001","email":"jane@example.com","name":"Jane Doe","activeWorkspace":"5f7c...","defaultWorkspace":"5f7c...","status":"ACTIVE"}
   */
  async getCurrentUser() {
    const logTag = '[getCurrentUser]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/user`,
      method: 'get',
    })
  }

  /**
   * @operationName List Workspace Users
   * @category Users
   * @description Lists members of a workspace, optionally filtered by name or email, with pagination. Returns each member's ID, name, email, and status.
   * @route GET /list-workspace-users
   *
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The workspace to list members from."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Optional case-insensitive name filter."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Optional email filter."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number for pagination (default 1)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page (default 50)."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"5f8a1b2c3d4e5f6000050001","email":"jane@example.com","name":"Jane Doe","status":"ACTIVE","activeWorkspace":"5f7c..."}]
   */
  async listWorkspaceUsers(workspaceId, name, email, page, pageSize) {
    const logTag = '[listWorkspaceUsers]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ workspaceId }/users`,
      method: 'get',
      query: {
        name,
        email,
        page: page || 1,
        'page-size': pageSize || DEFAULT_PAGE_SIZE,
      },
    })
  }

  /* ============================ Reports ============================ */

  /**
   * @operationName Generate Summary Report
   * @category Reports
   * @description Generates a summary time report for a workspace over a date range, grouped by the dimensions you choose (e.g. Project then Task). Returns total tracked and billable time plus grouped breakdowns. This operation uses Clockify's separate reports host (reports.api.clockify.me).
   * @route POST /generate-summary-report
   * @appearanceColor #673AB7 #9575CD
   *
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The workspace to report on."}
   * @paramDef {"type":"String","label":"Date Range Start","name":"dateRangeStart","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start of the report range in ISO-8601 format, e.g. 2024-01-01T00:00:00Z."}
   * @paramDef {"type":"String","label":"Date Range End","name":"dateRangeEnd","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"End of the report range in ISO-8601 format, e.g. 2024-01-31T23:59:59Z."}
   * @paramDef {"type":"Array<String>","label":"Group By","name":"groups","uiComponent":{"type":"DROPDOWN","options":{"values":["Project","Client","Task","Tag","User","Date"]}},"description":"Ordered grouping dimensions for the summary (first is the top-level group). Defaults to Project."}
   *
   * @returns {Object}
   * @sampleResult {"totals":[{"totalTime":18000,"totalBillableTime":14400,"entriesCount":6,"totalAmount":0}],"groupOne":[{"name":"Website Redesign","duration":18000,"amount":0,"children":[]}]}
   */
  async generateSummaryReport(workspaceId, dateRangeStart, dateRangeEnd, groups) {
    const logTag = '[generateSummaryReport]'

    const resolvedGroups = (groups && groups.length ? groups : ['Project'])
      .map(group => this.#resolveChoice(group, SUMMARY_GROUP_MAP))

    return await this.#apiRequest({
      logTag,
      url: `${ REPORTS_BASE_URL }/workspaces/${ workspaceId }/reports/summary`,
      method: 'post',
      body: {
        dateRangeStart,
        dateRangeEnd,
        summaryFilter: { groups: resolvedGroups },
      },
    })
  }

  /* ============================ Dictionaries ============================ */

  /**
   * @typedef {Object} getWorkspacesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter matched against workspace names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Clockify returns all workspaces in one call, so this is unused but kept for compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Workspaces Dictionary
   * @description Provides a selectable list of the workspaces the API key can access, for choosing a Workspace ID on other operations. The option value is the workspace ID.
   * @route POST /get-workspaces-dictionary
   * @paramDef {"type":"getWorkspacesDictionary__payload","label":"Payload","name":"payload","description":"Contains the optional search string for filtering workspaces by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Acme Workspace","value":"5f7c1b2c3d4e5f6000000001","note":"Workspace"}],"cursor":null}
   */
  async getWorkspacesDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getWorkspacesDictionary]'

    const workspaces = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces`,
      method: 'get',
    })

    const term = (search || '').toLowerCase()
    const filtered = term
      ? (workspaces || []).filter(w => (w.name || '').toLowerCase().includes(term))
      : (workspaces || [])

    return {
      items: filtered.map(w => ({
        label: w.name,
        value: w.id,
        note: 'Workspace',
      })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getProjectsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"description":"The workspace whose projects should be listed."}
   */

  /**
   * @typedef {Object} getProjectsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter matched against project names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) for fetching further results."}
   * @paramDef {"type":"getProjectsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Contains the workspace ID whose projects should be listed."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Projects Dictionary
   * @description Provides a selectable list of projects in a chosen workspace, for choosing a Project ID on other operations. Requires a workspace ID in the criteria. The option value is the project ID.
   * @route POST /get-projects-dictionary
   * @paramDef {"type":"getProjectsDictionary__payload","label":"Payload","name":"payload","description":"Contains search, cursor, and criteria with the workspace ID to list projects from."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Website Redesign","value":"64b0a1b2c3d4e5f600010001","note":"Acme"}],"cursor":"2"}
   */
  async getProjectsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const workspaceId = criteria?.workspaceId
    const logTag = '[getProjectsDictionary]'

    if (!workspaceId) {
      return { items: [], cursor: null }
    }

    const page = cursor ? parseInt(cursor, 10) : 1

    const projects = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ workspaceId }/projects`,
      method: 'get',
      query: {
        name: search,
        page,
        'page-size': DICTIONARY_PAGE_SIZE,
      },
    })

    const list = projects || []

    return {
      items: list.map(p => ({
        label: p.name,
        value: p.id,
        note: p.clientName || undefined,
      })),
      cursor: list.length === DICTIONARY_PAGE_SIZE ? String(page + 1) : null,
    }
  }

  /**
   * @typedef {Object} getClientsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"description":"The workspace whose clients should be listed."}
   */

  /**
   * @typedef {Object} getClientsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter matched against client names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) for fetching further results."}
   * @paramDef {"type":"getClientsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Contains the workspace ID whose clients should be listed."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Clients Dictionary
   * @description Provides a selectable list of clients in a chosen workspace, for choosing a Client ID on other operations. Requires a workspace ID in the criteria. The option value is the client ID.
   * @route POST /get-clients-dictionary
   * @paramDef {"type":"getClientsDictionary__payload","label":"Payload","name":"payload","description":"Contains search, cursor, and criteria with the workspace ID to list clients from."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Acme Corp","value":"5e9a1b2c3d4e5f6000030001","note":"Client"}],"cursor":null}
   */
  async getClientsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const workspaceId = criteria?.workspaceId
    const logTag = '[getClientsDictionary]'

    if (!workspaceId) {
      return { items: [], cursor: null }
    }

    const page = cursor ? parseInt(cursor, 10) : 1

    const clients = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ workspaceId }/clients`,
      method: 'get',
      query: {
        name: search,
        page,
        'page-size': DICTIONARY_PAGE_SIZE,
      },
    })

    const list = clients || []

    return {
      items: list.map(c => ({
        label: c.name,
        value: c.id,
        note: 'Client',
      })),
      cursor: list.length === DICTIONARY_PAGE_SIZE ? String(page + 1) : null,
    }
  }

  /**
   * @typedef {Object} getTagsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"description":"The workspace whose tags should be listed."}
   */

  /**
   * @typedef {Object} getTagsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter matched against tag names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) for fetching further results."}
   * @paramDef {"type":"getTagsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Contains the workspace ID whose tags should be listed."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tags Dictionary
   * @description Provides a selectable list of tags in a chosen workspace, for choosing Tag IDs on other operations. Requires a workspace ID in the criteria. The option value is the tag ID.
   * @route POST /get-tags-dictionary
   * @paramDef {"type":"getTagsDictionary__payload","label":"Payload","name":"payload","description":"Contains search, cursor, and criteria with the workspace ID to list tags from."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Billable","value":"5e9a1b2c3d4e5f6000040001","note":"Tag"}],"cursor":null}
   */
  async getTagsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const workspaceId = criteria?.workspaceId
    const logTag = '[getTagsDictionary]'

    if (!workspaceId) {
      return { items: [], cursor: null }
    }

    const page = cursor ? parseInt(cursor, 10) : 1

    const tags = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/workspaces/${ workspaceId }/tags`,
      method: 'get',
      query: {
        name: search,
        page,
        'page-size': DICTIONARY_PAGE_SIZE,
      },
    })

    const list = tags || []

    return {
      items: list.map(t => ({
        label: t.name,
        value: t.id,
        note: 'Tag',
      })),
      cursor: list.length === DICTIONARY_PAGE_SIZE ? String(page + 1) : null,
    }
  }
}

Flowrunner.ServerCode.addService(ClockifyService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Clockify API key, sent as the X-Api-Key header. Get it from Clockify -> Profile Settings -> API -> Generate.',
  },
])
