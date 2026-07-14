const logger = {
  info: (...args) => console.log('[Harvest] info:', ...args),
  debug: (...args) => console.log('[Harvest] debug:', ...args),
  error: (...args) => console.log('[Harvest] error:', ...args),
  warn: (...args) => console.log('[Harvest] warn:', ...args),
}

const API_BASE_URL = 'https://api.harvestapp.com/v2'
const USER_AGENT = 'FlowRunner'

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
 * @integrationName Harvest
 * @integrationIcon /icon.png
 */
class HarvestService {
  constructor(config) {
    this.accountId = config.accountId
    this.accessToken = config.accessToken
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.accessToken }`,
          'Harvest-Account-Id': this.accountId,
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(clean(body)) : await request
    } catch (error) {
      const message = error.body?.message || error.body?.error || error.message
      logger.error(`${ logTag } - failed: ${ message }`)
      throw new Error(`Harvest API error: ${ message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // ==========================================================================
  // Time Entries
  // ==========================================================================

  /**
   * @operationName Create Time Entry
   * @category Time Entries
   * @description Creates a time entry for a project and task on a given date. Provide either a decimal hours value (for accounts that track time via duration) or a started_time (for accounts that track time via start/end times). If you omit both hours and ended_time, a running timer is created (see Start Timer). spent_date must be YYYY-MM-DD. By default the entry is logged for the authenticated user unless a User ID is supplied.
   * @route POST /time-entries
   * @paramDef {"type":"Number","label":"Project ID","name":"projectId","required":true,"description":"ID of the project to log time against. Use Get Projects Dictionary to look one up."}
   * @paramDef {"type":"Number","label":"Task ID","name":"taskId","required":true,"description":"ID of the task. Must be a task assigned to the project — use Get Task Assignments Dictionary."}
   * @paramDef {"type":"String","label":"Spent Date","name":"spentDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Date the time was spent, in YYYY-MM-DD format."}
   * @paramDef {"type":"Number","label":"Hours","name":"hours","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Decimal hours for duration-tracking accounts (e.g. 1.5). Omit to leave the timer running."}
   * @paramDef {"type":"String","label":"Started Time","name":"startedTime","description":"Start time for start/end-time accounts, e.g. \"8:00am\"."}
   * @paramDef {"type":"String","label":"Ended Time","name":"endedTime","description":"End time for start/end-time accounts, e.g. \"11:30am\". Omit to leave the timer running."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional notes describing the work."}
   * @paramDef {"type":"Number","label":"User ID","name":"userId","description":"Optional user to log time for. Defaults to the authenticated user."}
   * @returns {Object}
   * @sampleResult {"id":636718192,"spent_date":"2017-03-21","user":{"id":1782959,"name":"Kim Allen"},"project":{"id":14307913,"name":"Marketing Website"},"task":{"id":8083365,"name":"Graphic Design"},"hours":1.0,"notes":null,"billable":true,"is_running":false}
   */
  async createTimeEntry(projectId, taskId, spentDate, hours, startedTime, endedTime, notes, userId) {
    return await this.#apiRequest({
      logTag: '[createTimeEntry]',
      url: `${ API_BASE_URL }/time_entries`,
      method: 'post',
      body: {
        project_id: projectId,
        task_id: taskId,
        spent_date: spentDate,
        hours,
        started_time: startedTime,
        ended_time: endedTime,
        notes,
        user_id: userId,
      },
    })
  }

  /**
   * @operationName Start Timer
   * @category Time Entries
   * @description Starts a running timer by creating a time entry with no hours (duration-tracking accounts) or no ended_time (start/end-time accounts). The returned entry has is_running set to true. Use Stop Timer with the returned ID to stop it. Note: whether a timer runs depends on the account's tracking mode — check Get Company (wants_timestamp_timers) to confirm which fields the account expects.
   * @route POST /time-entries/start
   * @paramDef {"type":"Number","label":"Project ID","name":"projectId","required":true,"description":"ID of the project to track time against. Use Get Projects Dictionary."}
   * @paramDef {"type":"Number","label":"Task ID","name":"taskId","required":true,"description":"ID of a task assigned to the project. Use Get Task Assignments Dictionary."}
   * @paramDef {"type":"String","label":"Spent Date","name":"spentDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Date the timer applies to, in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"Started Time","name":"startedTime","description":"Optional start time for start/end-time accounts, e.g. \"8:00am\". Defaults to now if omitted."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional notes describing the work."}
   * @paramDef {"type":"Number","label":"User ID","name":"userId","description":"Optional user to start the timer for. Defaults to the authenticated user."}
   * @returns {Object}
   * @sampleResult {"id":636718192,"spent_date":"2017-03-21","project":{"id":14307913,"name":"Marketing Website"},"task":{"id":8083365,"name":"Graphic Design"},"hours":0.0,"is_running":true}
   */
  async startTimer(projectId, taskId, spentDate, startedTime, notes, userId) {
    return await this.#apiRequest({
      logTag: '[startTimer]',
      url: `${ API_BASE_URL }/time_entries`,
      method: 'post',
      body: {
        project_id: projectId,
        task_id: taskId,
        spent_date: spentDate,
        started_time: startedTime,
        notes,
        user_id: userId,
      },
    })
  }

  /**
   * @operationName Stop Timer
   * @category Time Entries
   * @description Stops a running time entry timer. Only affects entries that are currently running; the response reflects the recorded hours and is_running set to false.
   * @route PATCH /time-entries/stop
   * @paramDef {"type":"Number","label":"Time Entry ID","name":"timeEntryId","required":true,"description":"ID of the running time entry to stop."}
   * @returns {Object}
   * @sampleResult {"id":636718192,"hours":1.0,"is_running":false,"project":{"id":14307913,"name":"Marketing Website"},"task":{"id":8083365,"name":"Graphic Design"}}
   */
  async stopTimer(timeEntryId) {
    return await this.#apiRequest({
      logTag: '[stopTimer]',
      url: `${ API_BASE_URL }/time_entries/${ timeEntryId }/stop`,
      method: 'patch',
    })
  }

  /**
   * @operationName Restart Timer
   * @category Time Entries
   * @description Restarts a stopped time entry, creating a new running timer for the same project/task/date. Only affects entries that are not currently running; the response has is_running set to true.
   * @route PATCH /time-entries/restart
   * @paramDef {"type":"Number","label":"Time Entry ID","name":"timeEntryId","required":true,"description":"ID of the stopped time entry to restart."}
   * @returns {Object}
   * @sampleResult {"id":636718192,"hours":1.0,"is_running":true,"project":{"id":14307913,"name":"Marketing Website"},"task":{"id":8083365,"name":"Graphic Design"}}
   */
  async restartTimer(timeEntryId) {
    return await this.#apiRequest({
      logTag: '[restartTimer]',
      url: `${ API_BASE_URL }/time_entries/${ timeEntryId }/restart`,
      method: 'patch',
    })
  }

  /**
   * @operationName Get Time Entry
   * @category Time Entries
   * @description Retrieves a single time entry by its ID, including the associated user, project, task, hours, billing state, and running status.
   * @route GET /time-entries/get
   * @paramDef {"type":"Number","label":"Time Entry ID","name":"timeEntryId","required":true,"description":"ID of the time entry to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":636718192,"spent_date":"2017-03-21","user":{"id":1782959,"name":"Kim Allen"},"project":{"id":14307913,"name":"Marketing Website"},"task":{"id":8083365,"name":"Graphic Design"},"hours":1.0,"billable":true,"is_running":false}
   */
  async getTimeEntry(timeEntryId) {
    return await this.#apiRequest({
      logTag: '[getTimeEntry]',
      url: `${ API_BASE_URL }/time_entries/${ timeEntryId }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Time Entries
   * @category Time Entries
   * @description Lists time entries, optionally filtered by user, client, project, running status, and a from/to date range. Results are paginated; use the Page parameter to walk through pages (per_page up to 2000). Returns the time_entries array plus pagination metadata (per_page, total_pages, next_page, page).
   * @route GET /time-entries/list
   * @paramDef {"type":"Number","label":"User ID","name":"userId","description":"Filter to time entries belonging to a specific user."}
   * @paramDef {"type":"Number","label":"Client ID","name":"clientId","description":"Filter to time entries belonging to a specific client. Use Get Clients Dictionary."}
   * @paramDef {"type":"Number","label":"Project ID","name":"projectId","description":"Filter to time entries belonging to a specific project. Use Get Projects Dictionary."}
   * @paramDef {"type":"Boolean","label":"Is Running","name":"isRunning","uiComponent":{"type":"CHECKBOX"},"description":"When true, return only currently running entries."}
   * @paramDef {"type":"String","label":"From","name":"from","uiComponent":{"type":"DATE_PICKER"},"description":"Only return entries with a spent_date on or after this date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"To","name":"to","uiComponent":{"type":"DATE_PICKER"},"description":"Only return entries with a spent_date on or before this date (YYYY-MM-DD)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (default 1)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page, 1-2000 (default 2000)."}
   * @returns {Object}
   * @sampleResult {"time_entries":[{"id":636718192,"spent_date":"2017-03-21","hours":1.0,"is_running":false}],"per_page":2000,"total_pages":1,"page":1,"next_page":null}
   */
  async listTimeEntries(userId, clientId, projectId, isRunning, from, to, page, perPage) {
    return await this.#apiRequest({
      logTag: '[listTimeEntries]',
      url: `${ API_BASE_URL }/time_entries`,
      method: 'get',
      query: {
        user_id: userId,
        client_id: clientId,
        project_id: projectId,
        is_running: isRunning,
        from,
        to,
        page,
        per_page: perPage,
      },
    })
  }

  /**
   * @operationName Update Time Entry
   * @category Time Entries
   * @description Updates an existing time entry. Only the fields you supply are changed. Use this to correct hours, move the entry to a different project or task, adjust the date, or edit notes.
   * @route PATCH /time-entries/update
   * @paramDef {"type":"Number","label":"Time Entry ID","name":"timeEntryId","required":true,"description":"ID of the time entry to update."}
   * @paramDef {"type":"Number","label":"Project ID","name":"projectId","description":"New project ID. Use Get Projects Dictionary."}
   * @paramDef {"type":"Number","label":"Task ID","name":"taskId","description":"New task ID. Use Get Task Assignments Dictionary."}
   * @paramDef {"type":"String","label":"Spent Date","name":"spentDate","uiComponent":{"type":"DATE_PICKER"},"description":"New spent date in YYYY-MM-DD format."}
   * @paramDef {"type":"Number","label":"Hours","name":"hours","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New decimal hours value."}
   * @paramDef {"type":"String","label":"Started Time","name":"startedTime","description":"New start time, e.g. \"8:00am\" (start/end-time accounts)."}
   * @paramDef {"type":"String","label":"Ended Time","name":"endedTime","description":"New end time, e.g. \"11:30am\" (start/end-time accounts)."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New notes for the entry."}
   * @returns {Object}
   * @sampleResult {"id":636718192,"spent_date":"2017-03-21","hours":2.0,"notes":"Updated notes","is_running":false}
   */
  async updateTimeEntry(timeEntryId, projectId, taskId, spentDate, hours, startedTime, endedTime, notes) {
    return await this.#apiRequest({
      logTag: '[updateTimeEntry]',
      url: `${ API_BASE_URL }/time_entries/${ timeEntryId }`,
      method: 'patch',
      body: {
        project_id: projectId,
        task_id: taskId,
        spent_date: spentDate,
        hours,
        started_time: startedTime,
        ended_time: endedTime,
        notes,
      },
    })
  }

  /**
   * @operationName Delete Time Entry
   * @category Time Entries
   * @description Permanently deletes a time entry. Non-admin users can only delete entries that are not closed/approved. Returns an empty object on success.
   * @route DELETE /time-entries/delete
   * @paramDef {"type":"Number","label":"Time Entry ID","name":"timeEntryId","required":true,"description":"ID of the time entry to delete."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteTimeEntry(timeEntryId) {
    await this.#apiRequest({
      logTag: '[deleteTimeEntry]',
      url: `${ API_BASE_URL }/time_entries/${ timeEntryId }`,
      method: 'delete',
    })

    return { success: true }
  }

  // ==========================================================================
  // Projects
  // ==========================================================================

  /**
   * @operationName List Projects
   * @category Projects
   * @description Lists projects, optionally filtered by active status and client. Results are paginated (per_page up to 2000). Returns the projects array plus pagination metadata (per_page, total_pages, next_page, page). Requires Administrator or Manager permissions on the Harvest account.
   * @route GET /projects/list
   * @paramDef {"type":"Boolean","label":"Is Active","name":"isActive","uiComponent":{"type":"CHECKBOX"},"description":"When true, return only active projects; when false, only archived ones."}
   * @paramDef {"type":"Number","label":"Client ID","name":"clientId","description":"Filter to projects belonging to a specific client. Use Get Clients Dictionary."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (default 1)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page, 1-2000 (default 2000)."}
   * @returns {Object}
   * @sampleResult {"projects":[{"id":14308069,"name":"Online Store - Phase 1","is_active":true,"is_billable":true,"client":{"id":5735776,"name":"123 Industries"}}],"per_page":2000,"total_pages":1,"page":1,"next_page":null}
   */
  async listProjects(isActive, clientId, page, perPage) {
    return await this.#apiRequest({
      logTag: '[listProjects]',
      url: `${ API_BASE_URL }/projects`,
      method: 'get',
      query: {
        is_active: isActive,
        client_id: clientId,
        page,
        per_page: perPage,
      },
    })
  }

  /**
   * @operationName Get Project
   * @category Projects
   * @description Retrieves a single project by its ID, including client, billing configuration, budget, and rate details.
   * @route GET /projects/get
   * @paramDef {"type":"Number","label":"Project ID","name":"projectId","required":true,"description":"ID of the project to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":14308069,"name":"Online Store - Phase 1","code":"OS1","is_active":true,"is_billable":true,"bill_by":"Project","hourly_rate":100.0,"budget":200.0,"client":{"id":5735776,"name":"123 Industries"}}
   */
  async getProject(projectId) {
    return await this.#apiRequest({
      logTag: '[getProject]',
      url: `${ API_BASE_URL }/projects/${ projectId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Project
   * @category Projects
   * @description Creates a new project for a client. name, client_id, is_billable, bill_by, and budget_by are required by Harvest. Bill By controls how the project is invoiced and Budget By controls how the budget is tracked. Optionally set an hourly rate, budget amount, and notes.
   * @route POST /projects
   * @paramDef {"type":"Number","label":"Client ID","name":"clientId","required":true,"description":"ID of the client this project belongs to. Use Get Clients Dictionary."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the project."}
   * @paramDef {"type":"Boolean","label":"Is Billable","name":"isBillable","required":true,"uiComponent":{"type":"CHECKBOX"},"description":"Whether the project is billable."}
   * @paramDef {"type":"String","label":"Bill By","name":"billBy","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Project","Tasks","People","None"]}},"description":"How the project is billed."}
   * @paramDef {"type":"String","label":"Budget By","name":"budgetBy","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Hours Per Project","Total Project Fees","Hours Per Task","Fees Per Task","Hours Per Person","No Budget"]}},"description":"How the project budget is tracked."}
   * @paramDef {"type":"Number","label":"Budget","name":"budget","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Budget value in hours or currency depending on Budget By."}
   * @paramDef {"type":"Number","label":"Hourly Rate","name":"hourlyRate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Default hourly rate for the project."}
   * @paramDef {"type":"Boolean","label":"Is Fixed Fee","name":"isFixedFee","uiComponent":{"type":"CHECKBOX"},"description":"Whether the project is a fixed-fee project."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Notes about the project."}
   * @returns {Object}
   * @sampleResult {"id":14308069,"name":"Online Store - Phase 1","is_active":true,"is_billable":true,"bill_by":"Project","budget_by":"project","hourly_rate":100.0,"client":{"id":5735776,"name":"123 Industries"}}
   */
  async createProject(clientId, name, isBillable, billBy, budgetBy, budget, hourlyRate, isFixedFee, notes) {
    return await this.#apiRequest({
      logTag: '[createProject]',
      url: `${ API_BASE_URL }/projects`,
      method: 'post',
      body: {
        client_id: clientId,
        name,
        is_billable: isBillable,
        bill_by: this.#resolveChoice(billBy, { None: 'none' }),
        budget_by: this.#resolveChoice(budgetBy, {
          'Hours Per Project': 'project',
          'Total Project Fees': 'project_cost',
          'Hours Per Task': 'task',
          'Fees Per Task': 'task_fees',
          'Hours Per Person': 'person',
          'No Budget': 'none',
        }),
        budget,
        hourly_rate: hourlyRate,
        is_fixed_fee: isFixedFee,
        notes,
      },
    })
  }

  /**
   * @operationName Update Project
   * @category Projects
   * @description Updates an existing project. Only the fields you supply are changed. Use this to rename a project, change its billing/budget configuration, adjust the rate, or archive it via Is Active.
   * @route PATCH /projects/update
   * @paramDef {"type":"Number","label":"Project ID","name":"projectId","required":true,"description":"ID of the project to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New project name."}
   * @paramDef {"type":"Boolean","label":"Is Active","name":"isActive","uiComponent":{"type":"CHECKBOX"},"description":"Set false to archive the project, true to reactivate it."}
   * @paramDef {"type":"Boolean","label":"Is Billable","name":"isBillable","uiComponent":{"type":"CHECKBOX"},"description":"Whether the project is billable."}
   * @paramDef {"type":"String","label":"Bill By","name":"billBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Project","Tasks","People","None"]}},"description":"How the project is billed."}
   * @paramDef {"type":"Number","label":"Budget","name":"budget","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New budget value."}
   * @paramDef {"type":"Number","label":"Hourly Rate","name":"hourlyRate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New default hourly rate."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New notes about the project."}
   * @returns {Object}
   * @sampleResult {"id":14308069,"name":"Online Store - Phase 2","is_active":true,"is_billable":true,"bill_by":"Project","hourly_rate":120.0}
   */
  async updateProject(projectId, name, isActive, isBillable, billBy, budget, hourlyRate, notes) {
    return await this.#apiRequest({
      logTag: '[updateProject]',
      url: `${ API_BASE_URL }/projects/${ projectId }`,
      method: 'patch',
      body: {
        name,
        is_active: isActive,
        is_billable: isBillable,
        bill_by: this.#resolveChoice(billBy, { None: 'none' }),
        budget,
        hourly_rate: hourlyRate,
        notes,
      },
    })
  }

  /**
   * @operationName Delete Project
   * @category Projects
   * @description Permanently deletes a project along with its time entries and expenses. To preserve historical data, archive the project via Update Project (Is Active = false) instead. Returns an empty object on success.
   * @route DELETE /projects/delete
   * @paramDef {"type":"Number","label":"Project ID","name":"projectId","required":true,"description":"ID of the project to delete."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteProject(projectId) {
    await this.#apiRequest({
      logTag: '[deleteProject]',
      url: `${ API_BASE_URL }/projects/${ projectId }`,
      method: 'delete',
    })

    return { success: true }
  }

  // ==========================================================================
  // Clients
  // ==========================================================================

  /**
   * @operationName List Clients
   * @category Clients
   * @description Lists clients, optionally filtered by active status. Results are paginated (per_page up to 2000). Returns the clients array plus pagination metadata (per_page, total_pages, next_page, page).
   * @route GET /clients/list
   * @paramDef {"type":"Boolean","label":"Is Active","name":"isActive","uiComponent":{"type":"CHECKBOX"},"description":"When true, return only active clients; when false, only archived ones."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (default 1)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page, 1-2000 (default 2000)."}
   * @returns {Object}
   * @sampleResult {"clients":[{"id":5735776,"name":"123 Industries","is_active":true,"currency":"EUR"}],"per_page":2000,"total_pages":1,"page":1,"next_page":null}
   */
  async listClients(isActive, page, perPage) {
    return await this.#apiRequest({
      logTag: '[listClients]',
      url: `${ API_BASE_URL }/clients`,
      method: 'get',
      query: {
        is_active: isActive,
        page,
        per_page: perPage,
      },
    })
  }

  /**
   * @operationName Get Client
   * @category Clients
   * @description Retrieves a single client by its ID, including name, active status, currency, and address.
   * @route GET /clients/get
   * @paramDef {"type":"Number","label":"Client ID","name":"clientId","required":true,"description":"ID of the client to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":5735776,"name":"123 Industries","is_active":true,"currency":"EUR","address":"123 Main St"}
   */
  async getClient(clientId) {
    return await this.#apiRequest({
      logTag: '[getClient]',
      url: `${ API_BASE_URL }/clients/${ clientId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Client
   * @category Clients
   * @description Creates a new client. Only name is required. Optionally set the currency (ISO code such as USD, EUR, GBP) used for the client's invoices and projects.
   * @route POST /clients
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the client."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","description":"ISO 4217 currency code, e.g. USD, EUR, GBP. Defaults to the account currency."}
   * @paramDef {"type":"Boolean","label":"Is Active","name":"isActive","uiComponent":{"type":"CHECKBOX"},"description":"Whether the client is active. Defaults to true."}
   * @paramDef {"type":"String","label":"Address","name":"address","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Physical address for the client."}
   * @returns {Object}
   * @sampleResult {"id":5735776,"name":"123 Industries","is_active":true,"currency":"EUR"}
   */
  async createClient(name, currency, isActive, address) {
    return await this.#apiRequest({
      logTag: '[createClient]',
      url: `${ API_BASE_URL }/clients`,
      method: 'post',
      body: {
        name,
        currency,
        is_active: isActive,
        address,
      },
    })
  }

  /**
   * @operationName Update Client
   * @category Clients
   * @description Updates an existing client. Only the fields you supply are changed. Use this to rename a client, change its currency or address, or archive it via Is Active.
   * @route PATCH /clients/update
   * @paramDef {"type":"Number","label":"Client ID","name":"clientId","required":true,"description":"ID of the client to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New client name."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","description":"New ISO 4217 currency code, e.g. USD, EUR, GBP."}
   * @paramDef {"type":"Boolean","label":"Is Active","name":"isActive","uiComponent":{"type":"CHECKBOX"},"description":"Set false to archive the client, true to reactivate it."}
   * @paramDef {"type":"String","label":"Address","name":"address","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New physical address for the client."}
   * @returns {Object}
   * @sampleResult {"id":5735776,"name":"123 Industries LLC","is_active":true,"currency":"USD"}
   */
  async updateClient(clientId, name, currency, isActive, address) {
    return await this.#apiRequest({
      logTag: '[updateClient]',
      url: `${ API_BASE_URL }/clients/${ clientId }`,
      method: 'patch',
      body: {
        name,
        currency,
        is_active: isActive,
        address,
      },
    })
  }

  /**
   * @operationName Delete Client
   * @category Clients
   * @description Permanently deletes a client. A client can only be deleted if it has no projects, invoices, estimates, or expenses associated with it. Returns an empty object on success.
   * @route DELETE /clients/delete
   * @paramDef {"type":"Number","label":"Client ID","name":"clientId","required":true,"description":"ID of the client to delete."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteClient(clientId) {
    await this.#apiRequest({
      logTag: '[deleteClient]',
      url: `${ API_BASE_URL }/clients/${ clientId }`,
      method: 'delete',
    })

    return { success: true }
  }

  // ==========================================================================
  // Tasks
  // ==========================================================================

  /**
   * @operationName List Tasks
   * @category Tasks
   * @description Lists tasks in the account, optionally filtered by active status. Results are paginated (per_page up to 2000). Returns the tasks array plus pagination metadata (per_page, total_pages, next_page, page). Note: to log time you must use a task assigned to the project — see List Task Assignments.
   * @route GET /tasks/list
   * @paramDef {"type":"Boolean","label":"Is Active","name":"isActive","uiComponent":{"type":"CHECKBOX"},"description":"When true, return only active tasks; when false, only archived ones."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (default 1)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page, 1-2000 (default 2000)."}
   * @returns {Object}
   * @sampleResult {"tasks":[{"id":8083365,"name":"Graphic Design","billable_by_default":true,"is_default":true,"is_active":true}],"per_page":2000,"total_pages":1,"page":1,"next_page":null}
   */
  async listTasks(isActive, page, perPage) {
    return await this.#apiRequest({
      logTag: '[listTasks]',
      url: `${ API_BASE_URL }/tasks`,
      method: 'get',
      query: {
        is_active: isActive,
        page,
        per_page: perPage,
      },
    })
  }

  /**
   * @operationName Get Task
   * @category Tasks
   * @description Retrieves a single task by its ID, including its name, default billable state, default hourly rate, and active status.
   * @route GET /tasks/get
   * @paramDef {"type":"Number","label":"Task ID","name":"taskId","required":true,"description":"ID of the task to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":8083365,"name":"Graphic Design","billable_by_default":true,"default_hourly_rate":100.0,"is_default":true,"is_active":true}
   */
  async getTask(taskId) {
    return await this.#apiRequest({
      logTag: '[getTask]',
      url: `${ API_BASE_URL }/tasks/${ taskId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Task
   * @category Tasks
   * @description Creates a new task in the account. Only name is required. Optionally set whether it is billable by default, a default hourly rate, and whether it should be automatically added to future projects (Is Default).
   * @route POST /tasks
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the task."}
   * @paramDef {"type":"Boolean","label":"Billable By Default","name":"billableByDefault","uiComponent":{"type":"CHECKBOX"},"description":"Whether the task is billable by default when added to a project."}
   * @paramDef {"type":"Number","label":"Default Hourly Rate","name":"defaultHourlyRate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Default hourly rate used for this task."}
   * @paramDef {"type":"Boolean","label":"Is Default","name":"isDefault","uiComponent":{"type":"CHECKBOX"},"description":"Whether the task is added to new projects automatically."}
   * @returns {Object}
   * @sampleResult {"id":8083800,"name":"Business Development","billable_by_default":false,"default_hourly_rate":0.0,"is_default":false,"is_active":true}
   */
  async createTask(name, billableByDefault, defaultHourlyRate, isDefault) {
    return await this.#apiRequest({
      logTag: '[createTask]',
      url: `${ API_BASE_URL }/tasks`,
      method: 'post',
      body: {
        name,
        billable_by_default: billableByDefault,
        default_hourly_rate: defaultHourlyRate,
        is_default: isDefault,
      },
    })
  }

  /**
   * @operationName Update Task
   * @category Tasks
   * @description Updates an existing task. Only the fields you supply are changed. Use this to rename a task, change its default billable state or rate, or archive it via Is Active.
   * @route PATCH /tasks/update
   * @paramDef {"type":"Number","label":"Task ID","name":"taskId","required":true,"description":"ID of the task to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New task name."}
   * @paramDef {"type":"Boolean","label":"Billable By Default","name":"billableByDefault","uiComponent":{"type":"CHECKBOX"},"description":"Whether the task is billable by default."}
   * @paramDef {"type":"Number","label":"Default Hourly Rate","name":"defaultHourlyRate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New default hourly rate."}
   * @paramDef {"type":"Boolean","label":"Is Active","name":"isActive","uiComponent":{"type":"CHECKBOX"},"description":"Set false to archive the task, true to reactivate it."}
   * @returns {Object}
   * @sampleResult {"id":8083800,"name":"Business Consulting","billable_by_default":true,"default_hourly_rate":150.0,"is_active":true}
   */
  async updateTask(taskId, name, billableByDefault, defaultHourlyRate, isActive) {
    return await this.#apiRequest({
      logTag: '[updateTask]',
      url: `${ API_BASE_URL }/tasks/${ taskId }`,
      method: 'patch',
      body: {
        name,
        billable_by_default: billableByDefault,
        default_hourly_rate: defaultHourlyRate,
        is_active: isActive,
      },
    })
  }

  /**
   * @operationName Delete Task
   * @category Tasks
   * @description Permanently deletes a task. A task can only be deleted if it has no time entries associated with it. Returns an empty object on success.
   * @route DELETE /tasks/delete
   * @paramDef {"type":"Number","label":"Task ID","name":"taskId","required":true,"description":"ID of the task to delete."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteTask(taskId) {
    await this.#apiRequest({
      logTag: '[deleteTask]',
      url: `${ API_BASE_URL }/tasks/${ taskId }`,
      method: 'delete',
    })

    return { success: true }
  }

  /**
   * @operationName List Task Assignments
   * @category Tasks
   * @description Lists the tasks assigned to a specific project. Only these tasks are valid for logging time against the project (use their task_id with Create Time Entry / Start Timer). Results are paginated (per_page up to 2000). Returns the task_assignments array plus pagination metadata.
   * @route GET /projects/task-assignments/list
   * @paramDef {"type":"Number","label":"Project ID","name":"projectId","required":true,"description":"ID of the project whose task assignments to list. Use Get Projects Dictionary."}
   * @paramDef {"type":"Boolean","label":"Is Active","name":"isActive","uiComponent":{"type":"CHECKBOX"},"description":"When true, return only active task assignments."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (default 1)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page, 1-2000 (default 2000)."}
   * @returns {Object}
   * @sampleResult {"task_assignments":[{"id":155505016,"is_active":true,"billable":true,"task":{"id":8083365,"name":"Graphic Design"}}],"per_page":2000,"total_pages":1,"page":1,"next_page":null}
   */
  async listTaskAssignments(projectId, isActive, page, perPage) {
    return await this.#apiRequest({
      logTag: '[listTaskAssignments]',
      url: `${ API_BASE_URL }/projects/${ projectId }/task_assignments`,
      method: 'get',
      query: {
        is_active: isActive,
        page,
        per_page: perPage,
      },
    })
  }

  // ==========================================================================
  // Invoices
  // ==========================================================================

  /**
   * @operationName List Invoices
   * @category Invoices
   * @description Lists invoices, optionally filtered by client, state, and an issue-date from/to range. Results are paginated (per_page up to 2000). Returns the invoices array plus pagination metadata (per_page, total_pages, next_page, page).
   * @route GET /invoices/list
   * @paramDef {"type":"Number","label":"Client ID","name":"clientId","description":"Filter to invoices for a specific client. Use Get Clients Dictionary."}
   * @paramDef {"type":"String","label":"State","name":"state","uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Open","Paid","Closed"]}},"description":"Filter by invoice state."}
   * @paramDef {"type":"String","label":"From","name":"from","uiComponent":{"type":"DATE_PICKER"},"description":"Only return invoices issued on or after this date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"To","name":"to","uiComponent":{"type":"DATE_PICKER"},"description":"Only return invoices issued on or before this date (YYYY-MM-DD)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (default 1)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page, 1-2000 (default 2000)."}
   * @returns {Object}
   * @sampleResult {"invoices":[{"id":13150403,"number":"1001","amount":288.9,"state":"open","client":{"id":5735776,"name":"123 Industries"}}],"per_page":2000,"total_pages":1,"page":1,"next_page":null}
   */
  async listInvoices(clientId, state, from, to, page, perPage) {
    return await this.#apiRequest({
      logTag: '[listInvoices]',
      url: `${ API_BASE_URL }/invoices`,
      method: 'get',
      query: {
        client_id: clientId,
        state: this.#resolveChoice(state, {
          Draft: 'draft',
          Open: 'open',
          Paid: 'paid',
          Closed: 'closed',
        }),
        from,
        to,
        page,
        per_page: perPage,
      },
    })
  }

  /**
   * @operationName Get Invoice
   * @category Invoices
   * @description Retrieves a single invoice by its ID, including its client, line items, amounts, state, and dates.
   * @route GET /invoices/get
   * @paramDef {"type":"Number","label":"Invoice ID","name":"invoiceId","required":true,"description":"ID of the invoice to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":13150403,"number":"1001","amount":288.9,"state":"open","client":{"id":5735776,"name":"123 Industries"},"line_items":[{"kind":"Service","description":"Design","quantity":1.0,"unit_price":100.0,"amount":100.0}]}
   */
  async getInvoice(invoiceId) {
    return await this.#apiRequest({
      logTag: '[getInvoice]',
      url: `${ API_BASE_URL }/invoices/${ invoiceId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Invoice
   * @category Invoices
   * @description Creates a draft invoice for a client. Provide a subject and an array of line items, where each line item is an object with fields such as kind (e.g. "Service"), description, quantity, and unit_price. The invoice is created in draft state; use Send Invoice to email it.
   * @route POST /invoices
   * @paramDef {"type":"Number","label":"Client ID","name":"clientId","required":true,"description":"ID of the client to invoice. Use Get Clients Dictionary."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"Subject line for the invoice."}
   * @paramDef {"type":"Array<Object>","label":"Line Items","name":"lineItems","description":"Array of line item objects, e.g. [{\"kind\":\"Service\",\"description\":\"Design work\",\"quantity\":10,\"unit_price\":100}]."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Notes shown on the invoice."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","description":"ISO 4217 currency code for the invoice, e.g. USD. Defaults to the client's currency."}
   * @returns {Object}
   * @sampleResult {"id":13150453,"number":"","amount":100.0,"state":"draft","client":{"id":5735776,"name":"123 Industries"},"line_items":[{"kind":"Service","description":"Design work","quantity":1.0,"unit_price":100.0,"amount":100.0}]}
   */
  async createInvoice(clientId, subject, lineItems, notes, currency) {
    return await this.#apiRequest({
      logTag: '[createInvoice]',
      url: `${ API_BASE_URL }/invoices`,
      method: 'post',
      body: {
        client_id: clientId,
        subject,
        line_items: lineItems,
        notes,
        currency,
      },
    })
  }

  /**
   * @operationName Update Invoice
   * @category Invoices
   * @description Updates an existing invoice. Only the fields you supply are changed. Note: supplying line_items replaces the full set of line items on the invoice.
   * @route PATCH /invoices/update
   * @paramDef {"type":"Number","label":"Invoice ID","name":"invoiceId","required":true,"description":"ID of the invoice to update."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"New subject line for the invoice."}
   * @paramDef {"type":"Array<Object>","label":"Line Items","name":"lineItems","description":"Replacement array of line item objects. Supplying this replaces all existing line items."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New notes shown on the invoice."}
   * @paramDef {"type":"String","label":"Issue Date","name":"issueDate","uiComponent":{"type":"DATE_PICKER"},"description":"New issue date in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"New due date in YYYY-MM-DD format."}
   * @returns {Object}
   * @sampleResult {"id":13150453,"subject":"Q1 Services","amount":200.0,"state":"draft"}
   */
  async updateInvoice(invoiceId, subject, lineItems, notes, issueDate, dueDate) {
    return await this.#apiRequest({
      logTag: '[updateInvoice]',
      url: `${ API_BASE_URL }/invoices/${ invoiceId }`,
      method: 'patch',
      body: {
        subject,
        line_items: lineItems,
        notes,
        issue_date: issueDate,
        due_date: dueDate,
      },
    })
  }

  /**
   * @operationName Delete Invoice
   * @category Invoices
   * @description Permanently deletes an invoice. Returns an empty object on success.
   * @route DELETE /invoices/delete
   * @paramDef {"type":"Number","label":"Invoice ID","name":"invoiceId","required":true,"description":"ID of the invoice to delete."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteInvoice(invoiceId) {
    await this.#apiRequest({
      logTag: '[deleteInvoice]',
      url: `${ API_BASE_URL }/invoices/${ invoiceId }`,
      method: 'delete',
    })

    return { success: true }
  }

  /**
   * @operationName Send Invoice
   * @category Invoices
   * @description Sends an invoice by email by creating an invoice message. Provide one or more recipient email addresses. Optionally include a subject and body, and choose whether to send a copy to yourself and attach the invoice as a PDF.
   * @route POST /invoices/send
   * @paramDef {"type":"Number","label":"Invoice ID","name":"invoiceId","required":true,"description":"ID of the invoice to send."}
   * @paramDef {"type":"Array<String>","label":"Recipient Emails","name":"recipientEmails","required":true,"description":"Email addresses to send the invoice to."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"Subject line for the email."}
   * @paramDef {"type":"String","label":"Body","name":"body","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Body text for the email."}
   * @paramDef {"type":"Boolean","label":"Include Link","name":"includeLink","uiComponent":{"type":"CHECKBOX"},"description":"Include a link to the online client invoice in the email."}
   * @paramDef {"type":"Boolean","label":"Attach PDF","name":"attachPdf","uiComponent":{"type":"CHECKBOX"},"description":"Attach the invoice as a PDF to the email."}
   * @returns {Object}
   * @sampleResult {"id":27835324,"sent_by":"Bob Powell","subject":"Invoice #1001","recipients":[{"name":"","email":"client@example.com"}],"send_me_a_copy":false}
   */
  async sendInvoice(invoiceId, recipientEmails, subject, body, includeLink, attachPdf) {
    const recipients = (recipientEmails || []).map(email => ({ email }))

    return await this.#apiRequest({
      logTag: '[sendInvoice]',
      url: `${ API_BASE_URL }/invoices/${ invoiceId }/messages`,
      method: 'post',
      body: {
        recipients,
        subject,
        body,
        include_link_to_client_invoice: includeLink,
        attach_pdf: attachPdf,
      },
    })
  }

  // ==========================================================================
  // Users & Company
  // ==========================================================================

  /**
   * @operationName Get Current User
   * @category Users & Company
   * @description Retrieves the user account associated with the access token, including name, email, role, and timezone. Useful for identifying who a Personal Access Token belongs to.
   * @route GET /users/me
   * @returns {Object}
   * @sampleResult {"id":1782959,"first_name":"Kim","last_name":"Allen","email":"kim@example.com","is_active":true,"timezone":"Eastern Time (US & Canada)"}
   */
  async getCurrentUser() {
    return await this.#apiRequest({
      logTag: '[getCurrentUser]',
      url: `${ API_BASE_URL }/users/me`,
      method: 'get',
    })
  }

  /**
   * @operationName List Users
   * @category Users & Company
   * @description Lists users in the account, optionally filtered by active status. Results are paginated (per_page up to 2000). Returns the users array plus pagination metadata (per_page, total_pages, next_page, page). Requires Administrator permissions.
   * @route GET /users/list
   * @paramDef {"type":"Boolean","label":"Is Active","name":"isActive","uiComponent":{"type":"CHECKBOX"},"description":"When true, return only active users; when false, only archived ones."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (default 1)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Records per page, 1-2000 (default 2000)."}
   * @returns {Object}
   * @sampleResult {"users":[{"id":1782959,"first_name":"Kim","last_name":"Allen","email":"kim@example.com","is_active":true}],"per_page":2000,"total_pages":1,"page":1,"next_page":null}
   */
  async listUsers(isActive, page, perPage) {
    return await this.#apiRequest({
      logTag: '[listUsers]',
      url: `${ API_BASE_URL }/users`,
      method: 'get',
      query: {
        is_active: isActive,
        page,
        per_page: perPage,
      },
    })
  }

  /**
   * @operationName Get Company
   * @category Users & Company
   * @description Retrieves the company settings for the authenticated account. Useful as a connection check and to determine the account's time-tracking mode: wants_timestamp_timers indicates start/end-time tracking, and decimal_dates_and_times indicates decimal-hours entry. Also returns week start day, currency, and plan type.
   * @route GET /company
   * @returns {Object}
   * @sampleResult {"base_uri":"https://123.harvestapp.com","full_domain":"123.harvestapp.com","name":"123 Industries","is_active":true,"wants_timestamp_timers":false,"decimal_dates_and_times":true,"week_start_day":"Monday","time_format":"hours_minutes"}
   */
  async getCompany() {
    return await this.#apiRequest({
      logTag: '[getCompany]',
      url: `${ API_BASE_URL }/company`,
      method: 'get',
    })
  }

  // ==========================================================================
  // Dictionaries
  // ==========================================================================

  /**
   * @typedef {Object} getProjectsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter projects by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) returned by a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Projects Dictionary
   * @description Provides a searchable list of active projects for selecting a Project ID in other operations. The option value is the numeric project ID.
   * @route POST /projects-dictionary
   * @paramDef {"type":"getProjectsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for listing projects."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Online Store - Phase 1","value":"14308069","note":"123 Industries"}],"cursor":null}
   */
  async getProjectsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getProjectsDictionary]',
      url: `${ API_BASE_URL }/projects`,
      method: 'get',
      query: {
        is_active: true,
        page: cursor || 1,
        per_page: 100,
      },
    })

    const term = (search || '').toLowerCase()
    const projects = (response.projects || []).filter(p => !term || (p.name || '').toLowerCase().includes(term))

    return {
      items: projects.map(project => ({
        label: project.name,
        value: String(project.id),
        note: project.client?.name || undefined,
      })),
      cursor: response.next_page ? String(response.next_page) : null,
    }
  }

  /**
   * @typedef {Object} getClientsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter clients by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) returned by a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Clients Dictionary
   * @description Provides a searchable list of active clients for selecting a Client ID in other operations. The option value is the numeric client ID.
   * @route POST /clients-dictionary
   * @paramDef {"type":"getClientsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for listing clients."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"123 Industries","value":"5735776","note":"EUR"}],"cursor":null}
   */
  async getClientsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getClientsDictionary]',
      url: `${ API_BASE_URL }/clients`,
      method: 'get',
      query: {
        is_active: true,
        page: cursor || 1,
        per_page: 100,
      },
    })

    const term = (search || '').toLowerCase()
    const clients = (response.clients || []).filter(c => !term || (c.name || '').toLowerCase().includes(term))

    return {
      items: clients.map(client => ({
        label: client.name,
        value: String(client.id),
        note: client.currency || undefined,
      })),
      cursor: response.next_page ? String(response.next_page) : null,
    }
  }

  /**
   * @typedef {Object} getTaskAssignmentsDictionary__payloadCriteria
   * @paramDef {"type":"Number","label":"Project ID","name":"project","required":true,"description":"ID of the project whose assigned tasks to list."}
   */

  /**
   * @typedef {Object} getTaskAssignmentsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter tasks by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) returned by a previous call."}
   * @paramDef {"type":"getTaskAssignmentsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Dependency criteria; the selected project whose task assignments to list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Task Assignments Dictionary
   * @description Provides a searchable list of tasks assigned to a specific project, for selecting a valid Task ID when logging time against that project. Depends on the project. The option value is the numeric task ID.
   * @route POST /task-assignments-dictionary
   * @paramDef {"type":"getTaskAssignmentsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the project criteria to list task assignments for."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Graphic Design","value":"8083365","note":"Billable"}],"cursor":null}
   */
  async getTaskAssignmentsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const projectId = criteria?.project

    if (!projectId) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      logTag: '[getTaskAssignmentsDictionary]',
      url: `${ API_BASE_URL }/projects/${ projectId }/task_assignments`,
      method: 'get',
      query: {
        is_active: true,
        page: cursor || 1,
        per_page: 100,
      },
    })

    const term = (search || '').toLowerCase()
    const assignments = (response.task_assignments || [])
      .filter(a => a.task && (!term || (a.task.name || '').toLowerCase().includes(term)))

    return {
      items: assignments.map(assignment => ({
        label: assignment.task.name,
        value: String(assignment.task.id),
        note: assignment.billable ? 'Billable' : 'Non-billable',
      })),
      cursor: response.next_page ? String(response.next_page) : null,
    }
  }
}

Flowrunner.ServerCode.addService(HarvestService, [
  {
    name: 'accountId',
    displayName: 'Account ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Harvest Account ID (sent as the Harvest-Account-Id header). Find it in Harvest under Settings → Developers, or at https://id.getharvest.com/developers.',
  },
  {
    name: 'accessToken',
    displayName: 'Access Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'A Personal Access Token. Create one at https://id.getharvest.com/developers. Sent as an Authorization: Bearer header.',
  },
])
