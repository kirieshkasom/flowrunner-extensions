const logger = {
  info: (...args) => console.log('[Todoist] info:', ...args),
  debug: (...args) => console.log('[Todoist] debug:', ...args),
  error: (...args) => console.log('[Todoist] error:', ...args),
  warn: (...args) => console.log('[Todoist] warn:', ...args),
}

const API_BASE_URL = 'https://api.todoist.com/api/v1'

const DEFAULT_LIMIT = 50

// Todoist priority is inverted: the API's 4 is the most urgent (P1) and 1 is
// the lowest (P4/normal). These maps translate between the friendly dropdown
// labels shown to users and the raw integer the API expects.
const PRIORITY_LABEL_TO_API = {
  'P1 Urgent': 4,
  'P2 High': 3,
  'P3 Medium': 2,
  'P4 Normal': 1,
}

// Todoist color names are lowercase snake_case tokens; the dropdowns show
// friendly Title Case labels and these maps translate to the API values.
const COLOR_LABEL_TO_API = {
  'Berry Red': 'berry_red',
  'Red': 'red',
  'Orange': 'orange',
  'Yellow': 'yellow',
  'Olive Green': 'olive_green',
  'Lime Green': 'lime_green',
  'Green': 'green',
  'Mint Green': 'mint_green',
  'Teal': 'teal',
  'Sky Blue': 'sky_blue',
  'Light Blue': 'light_blue',
  'Blue': 'blue',
  'Grape': 'grape',
  'Violet': 'violet',
  'Lavender': 'lavender',
  'Magenta': 'magenta',
  'Salmon': 'salmon',
  'Charcoal': 'charcoal',
  'Grey': 'grey',
  'Taupe': 'taupe',
}

const VIEW_STYLE_LABEL_TO_API = {
  'List': 'list',
  'Board': 'board',
  'Calendar': 'calendar',
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
 * @integrationName Todoist
 * @integrationIcon /icon.svg
 */
class TodoistService {
  constructor(config) {
    this.apiToken = config.apiToken
  }

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

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.apiToken }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      const response = body !== undefined ? await request.send(body) : await request

      // Close/reopen/delete return 204 No Content (empty body). Synthesize a
      // consistent success payload so downstream flows always get an object.
      if (response === undefined || response === null || response === '') {
        return { success: true }
      }

      return response
    } catch (error) {
      // Todoist may return a JSON error object ({error, error_tag, ...}) or a
      // plain-text message; surface whichever is present.
      const body = error.body
      let message

      if (body && typeof body === 'object') {
        message = body.error || body.error_tag || body.message
      } else if (typeof body === 'string' && body) {
        message = body
      }

      message = message || error.message || 'Unknown error'

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Todoist API error: ${ message }`)
    }
  }

  // ---------------------------------------------------------------------------
  // Tasks
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Task
   * @category Tasks
   * @description Creates a new task. Provide task content (the title), which is required. Optionally set a description, place the task in a project and section, make it a subtask via a parent task, attach labels, set a priority, assign a due date, and assign it to a collaborator. Due dates can be given either as natural language via Due String (e.g. "tomorrow at 5pm", "every Monday") or as a fixed calendar date via Due Date (YYYY-MM-DD); if both are supplied Due String takes precedence.
   * @route POST /tasks
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"description":"The task title. Supports Todoist Markdown for links and formatting."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional longer note shown under the task title."}
   * @paramDef {"type":"String","label":"Project","name":"project_id","dictionary":"getProjectsDictionary","description":"The project to add the task to. Defaults to the user's Inbox when omitted."}
   * @paramDef {"type":"String","label":"Section","name":"section_id","dictionary":"getSectionsDictionary","description":"The section within the project to place the task in."}
   * @paramDef {"type":"String","label":"Parent Task","name":"parent_id","description":"The ID of a parent task to create this task as a subtask."}
   * @paramDef {"type":"Array<String>","label":"Labels","name":"labels","description":"Label names to attach to the task (e.g. \"waiting\", \"urgent\")."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","uiComponent":{"type":"DROPDOWN","options":{"values":["P1 Urgent","P2 High","P3 Medium","P4 Normal"]}},"description":"Task priority. P1 Urgent is the highest; P4 Normal is the default."}
   * @paramDef {"type":"String","label":"Due String","name":"due_string","description":"Natural-language due date, e.g. \"tomorrow at 5pm\", \"next Monday\", \"every day\". Takes precedence over Due Date when both are set."}
   * @paramDef {"type":"String","label":"Due Date","name":"due_date","uiComponent":{"type":"DATE_PICKER"},"description":"Fixed due date in YYYY-MM-DD format. Ignored if Due String is provided."}
   * @paramDef {"type":"String","label":"Assignee","name":"assignee_id","description":"The collaborator user ID to assign the task to (shared projects only). Use Get Collaborators to find IDs."}
   * @returns {Object}
   * @sampleResult {"id":"2995104339","content":"Buy milk","description":"","project_id":"2203306141","section_id":null,"parent_id":null,"labels":["shopping"],"priority":1,"due":{"date":"2026-07-15","string":"tomorrow","is_recurring":false},"url":"https://app.todoist.com/app/task/2995104339","is_completed":false}
   */
  async createTask(content, description, project_id, section_id, parent_id, labels, priority, due_string, due_date, assignee_id) {
    const logTag = '[createTask]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/tasks`,
      method: 'post',
      body: clean({
        content,
        description,
        project_id,
        section_id,
        parent_id,
        labels: labels && labels.length ? labels : undefined,
        priority: this.#resolveChoice(priority, PRIORITY_LABEL_TO_API),
        due_string,
        due_date,
        assignee_id,
      }),
    })
  }

  /**
   * @operationName Get Task
   * @category Tasks
   * @description Retrieves a single active task by its ID, including its content, project, labels, priority, and due date.
   * @route GET /tasks/{taskId}
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The ID of the task to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"2995104339","content":"Buy milk","description":"","project_id":"2203306141","section_id":null,"labels":["shopping"],"priority":1,"due":{"date":"2026-07-15","string":"tomorrow","is_recurring":false},"url":"https://app.todoist.com/app/task/2995104339","is_completed":false}
   */
  async getTask(taskId) {
    const logTag = '[getTask]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/tasks/${ taskId }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Tasks
   * @category Tasks
   * @description Lists active (non-completed) tasks. Narrow the results by project, section, or label, or use a Todoist filter query (e.g. "today | overdue", "@work & p1") for advanced filtering. Results are paginated via a cursor; pass the returned next_cursor back in as Cursor to fetch the next page.
   * @route GET /tasks
   * @paramDef {"type":"String","label":"Project","name":"project_id","dictionary":"getProjectsDictionary","description":"Only return tasks in this project."}
   * @paramDef {"type":"String","label":"Section","name":"section_id","dictionary":"getSectionsDictionary","description":"Only return tasks in this section."}
   * @paramDef {"type":"String","label":"Label","name":"label","dictionary":"getLabelsDictionary","description":"Only return tasks carrying this label name."}
   * @paramDef {"type":"String","label":"Filter Query","name":"filter","description":"A Todoist filter query for advanced selection, e.g. \"today | overdue\", \"@work & p1\"."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum tasks per page (default 50, max 200)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response's next_cursor. Omit for the first page."}
   * @returns {Object}
   * @sampleResult {"results":[{"id":"2995104339","content":"Buy milk","project_id":"2203306141","priority":1,"is_completed":false}],"next_cursor":"eyJvIjoxfQ"}
   */
  async listTasks(project_id, section_id, label, filter, limit, cursor) {
    const logTag = '[listTasks]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/tasks`,
      method: 'get',
      query: {
        project_id,
        section_id,
        label,
        filter,
        limit: limit || DEFAULT_LIMIT,
        cursor,
      },
    })
  }

  /**
   * @operationName Update Task
   * @category Tasks
   * @description Updates an existing task. Only the fields you provide are changed; leave a field empty to keep its current value. Supports changing content, description, labels, priority, due date (natural language or fixed date), and assignee.
   * @route POST /tasks/{taskId}
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The ID of the task to update."}
   * @paramDef {"type":"String","label":"Content","name":"content","description":"New task title."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New longer note for the task."}
   * @paramDef {"type":"Array<String>","label":"Labels","name":"labels","description":"Replacement set of label names. Replaces all existing labels."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","uiComponent":{"type":"DROPDOWN","options":{"values":["P1 Urgent","P2 High","P3 Medium","P4 Normal"]}},"description":"New task priority. P1 Urgent is the highest."}
   * @paramDef {"type":"String","label":"Due String","name":"due_string","description":"New natural-language due date, e.g. \"next Friday\". Takes precedence over Due Date."}
   * @paramDef {"type":"String","label":"Due Date","name":"due_date","uiComponent":{"type":"DATE_PICKER"},"description":"New fixed due date in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"Assignee","name":"assignee_id","description":"New collaborator user ID to assign the task to (shared projects only)."}
   * @returns {Object}
   * @sampleResult {"id":"2995104339","content":"Buy oat milk","description":"","project_id":"2203306141","labels":["shopping"],"priority":2,"due":{"date":"2026-07-16","string":"next friday","is_recurring":false},"is_completed":false}
   */
  async updateTask(taskId, content, description, labels, priority, due_string, due_date, assignee_id) {
    const logTag = '[updateTask]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/tasks/${ taskId }`,
      method: 'post',
      body: clean({
        content,
        description,
        labels: labels && labels.length ? labels : undefined,
        priority: this.#resolveChoice(priority, PRIORITY_LABEL_TO_API),
        due_string,
        due_date,
        assignee_id,
      }),
    })
  }

  /**
   * @operationName Close Task
   * @category Tasks
   * @description Completes (closes) a task. For recurring tasks this advances the task to its next occurrence instead of removing it. Returns a success confirmation.
   * @route POST /tasks/{taskId}/close
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The ID of the task to complete."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async closeTask(taskId) {
    const logTag = '[closeTask]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/tasks/${ taskId }/close`,
      method: 'post',
    })
  }

  /**
   * @operationName Reopen Task
   * @category Tasks
   * @description Reopens a completed task, restoring it (and any completed ancestors/sections) to the active state. Returns a success confirmation.
   * @route POST /tasks/{taskId}/reopen
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The ID of the completed task to reopen."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async reopenTask(taskId) {
    const logTag = '[reopenTask]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/tasks/${ taskId }/reopen`,
      method: 'post',
    })
  }

  /**
   * @operationName Delete Task
   * @category Tasks
   * @description Permanently deletes a task and all of its subtasks. This cannot be undone. Returns a success confirmation.
   * @route DELETE /tasks/{taskId}
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The ID of the task to delete."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteTask(taskId) {
    const logTag = '[deleteTask]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/tasks/${ taskId }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Move Task
   * @category Tasks
   * @description Moves a task to a different project and/or section, or nests it under a parent task. Provide at least one destination: a project, a section, or a parent task ID.
   * @route POST /tasks/{taskId}/move
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The ID of the task to move."}
   * @paramDef {"type":"String","label":"Project","name":"project_id","dictionary":"getProjectsDictionary","description":"Destination project ID."}
   * @paramDef {"type":"String","label":"Section","name":"section_id","dictionary":"getSectionsDictionary","description":"Destination section ID within the project."}
   * @paramDef {"type":"String","label":"Parent Task","name":"parent_id","description":"Destination parent task ID, to nest this task as a subtask."}
   * @returns {Object}
   * @sampleResult {"id":"2995104339","content":"Buy milk","project_id":"2302163455","section_id":"7025","parent_id":null,"is_completed":false}
   */
  async moveTask(taskId, project_id, section_id, parent_id) {
    const logTag = '[moveTask]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/tasks/${ taskId }/move`,
      method: 'post',
      body: clean({
        project_id,
        section_id,
        parent_id,
      }),
    })
  }

  // ---------------------------------------------------------------------------
  // Projects
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Project
   * @category Projects
   * @description Creates a new project. Only the name is required. Optionally set a color, nest it under a parent project, mark it as a favorite, and choose its default view style (list, board, or calendar).
   * @route POST /projects
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The project name."}
   * @paramDef {"type":"String","label":"Color","name":"color","uiComponent":{"type":"DROPDOWN","options":{"values":["Berry Red","Red","Orange","Yellow","Olive Green","Lime Green","Green","Mint Green","Teal","Sky Blue","Light Blue","Blue","Grape","Violet","Lavender","Magenta","Salmon","Charcoal","Grey","Taupe"]}},"description":"Project color from the Todoist palette. Defaults to Charcoal."}
   * @paramDef {"type":"String","label":"Parent Project","name":"parent_id","dictionary":"getProjectsDictionary","description":"Parent project ID, to create this as a sub-project."}
   * @paramDef {"type":"Boolean","label":"Is Favorite","name":"is_favorite","uiComponent":{"type":"TOGGLE"},"description":"Whether the project is marked as a favorite."}
   * @paramDef {"type":"String","label":"View Style","name":"view_style","uiComponent":{"type":"DROPDOWN","options":{"values":["List","Board","Calendar"]}},"description":"Default view for the project. Defaults to List."}
   * @returns {Object}
   * @sampleResult {"id":"2302163455","name":"Shopping","color":"charcoal","parent_id":null,"is_favorite":false,"view_style":"list","url":"https://app.todoist.com/app/project/2302163455"}
   */
  async createProject(name, color, parent_id, is_favorite, view_style) {
    const logTag = '[createProject]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/projects`,
      method: 'post',
      body: clean({
        name,
        color: this.#resolveChoice(color, COLOR_LABEL_TO_API),
        parent_id,
        is_favorite,
        view_style: this.#resolveChoice(view_style, VIEW_STYLE_LABEL_TO_API),
      }),
    })
  }

  /**
   * @operationName List Projects
   * @category Projects
   * @description Lists the user's projects, paginated via a cursor. Pass the returned next_cursor back in as Cursor to fetch the next page.
   * @route GET /projects
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum projects per page (default 50, max 200)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response's next_cursor. Omit for the first page."}
   * @returns {Object}
   * @sampleResult {"results":[{"id":"2203306141","name":"Inbox","color":"grey","is_favorite":false,"is_inbox_project":true,"view_style":"list"}],"next_cursor":null}
   */
  async listProjects(limit, cursor) {
    const logTag = '[listProjects]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/projects`,
      method: 'get',
      query: {
        limit: limit || DEFAULT_LIMIT,
        cursor,
      },
    })
  }

  /**
   * @operationName Get Project
   * @category Projects
   * @description Retrieves a single project by its ID, including its name, color, view style, and favorite status.
   * @route GET /projects/{projectId}
   * @paramDef {"type":"String","label":"Project ID","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The ID of the project to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"2203306141","name":"Inbox","color":"grey","is_favorite":false,"is_inbox_project":true,"view_style":"list"}
   */
  async getProject(projectId) {
    const logTag = '[getProject]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/projects/${ projectId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Update Project
   * @category Projects
   * @description Updates an existing project. Only the fields you provide are changed. Supports renaming, changing color, toggling favorite status, and changing the view style.
   * @route POST /projects/{projectId}
   * @paramDef {"type":"String","label":"Project ID","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The ID of the project to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New project name."}
   * @paramDef {"type":"String","label":"Color","name":"color","uiComponent":{"type":"DROPDOWN","options":{"values":["Berry Red","Red","Orange","Yellow","Olive Green","Lime Green","Green","Mint Green","Teal","Sky Blue","Light Blue","Blue","Grape","Violet","Lavender","Magenta","Salmon","Charcoal","Grey","Taupe"]}},"description":"New project color from the Todoist palette."}
   * @paramDef {"type":"Boolean","label":"Is Favorite","name":"is_favorite","uiComponent":{"type":"TOGGLE"},"description":"Whether the project is marked as a favorite."}
   * @paramDef {"type":"String","label":"View Style","name":"view_style","uiComponent":{"type":"DROPDOWN","options":{"values":["List","Board","Calendar"]}},"description":"New default view for the project."}
   * @returns {Object}
   * @sampleResult {"id":"2302163455","name":"Groceries","color":"lime_green","is_favorite":true,"view_style":"board"}
   */
  async updateProject(projectId, name, color, is_favorite, view_style) {
    const logTag = '[updateProject]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/projects/${ projectId }`,
      method: 'post',
      body: clean({
        name,
        color: this.#resolveChoice(color, COLOR_LABEL_TO_API),
        is_favorite,
        view_style: this.#resolveChoice(view_style, VIEW_STYLE_LABEL_TO_API),
      }),
    })
  }

  /**
   * @operationName Delete Project
   * @category Projects
   * @description Permanently deletes a project along with all of its sections and tasks. This cannot be undone. Returns a success confirmation.
   * @route DELETE /projects/{projectId}
   * @paramDef {"type":"String","label":"Project ID","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The ID of the project to delete."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteProject(projectId) {
    const logTag = '[deleteProject]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/projects/${ projectId }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Get Collaborators
   * @category Projects
   * @description Lists all collaborators on a shared project, returning each person's user ID, name, and email. Use the returned IDs as the Assignee when creating or updating tasks.
   * @route GET /projects/{projectId}/collaborators
   * @paramDef {"type":"String","label":"Project ID","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The ID of the shared project."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum collaborators per page (default 50, max 200)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response's next_cursor. Omit for the first page."}
   * @returns {Object}
   * @sampleResult {"results":[{"id":"2671362","name":"Alice","email":"alice@example.com"}],"next_cursor":null}
   */
  async getCollaborators(projectId, limit, cursor) {
    const logTag = '[getCollaborators]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/projects/${ projectId }/collaborators`,
      method: 'get',
      query: {
        limit: limit || DEFAULT_LIMIT,
        cursor,
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Sections
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Section
   * @category Sections
   * @description Creates a new section within a project. Both the section name and the target project are required.
   * @route POST /sections
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The section name."}
   * @paramDef {"type":"String","label":"Project","name":"project_id","required":true,"dictionary":"getProjectsDictionary","description":"The project to add the section to."}
   * @paramDef {"type":"Number","label":"Order","name":"order","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional position of the section among the project's sections (smallest first)."}
   * @returns {Object}
   * @sampleResult {"id":"7025","project_id":"2203306141","name":"Groceries","order":1}
   */
  async createSection(name, project_id, order) {
    const logTag = '[createSection]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sections`,
      method: 'post',
      body: clean({
        name,
        project_id,
        order,
      }),
    })
  }

  /**
   * @operationName List Sections
   * @category Sections
   * @description Lists sections, optionally restricted to a single project, paginated via a cursor. Pass the returned next_cursor back in as Cursor to fetch the next page.
   * @route GET /sections
   * @paramDef {"type":"String","label":"Project","name":"project_id","dictionary":"getProjectsDictionary","description":"Only return sections in this project."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum sections per page (default 50, max 200)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response's next_cursor. Omit for the first page."}
   * @returns {Object}
   * @sampleResult {"results":[{"id":"7025","project_id":"2203306141","name":"Groceries","order":1}],"next_cursor":null}
   */
  async listSections(project_id, limit, cursor) {
    const logTag = '[listSections]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sections`,
      method: 'get',
      query: {
        project_id,
        limit: limit || DEFAULT_LIMIT,
        cursor,
      },
    })
  }

  /**
   * @operationName Delete Section
   * @category Sections
   * @description Permanently deletes a section and all tasks within it. This cannot be undone. Returns a success confirmation.
   * @route DELETE /sections/{sectionId}
   * @paramDef {"type":"String","label":"Section ID","name":"sectionId","required":true,"description":"The ID of the section to delete."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteSection(sectionId) {
    const logTag = '[deleteSection]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sections/${ sectionId }`,
      method: 'delete',
    })
  }

  // ---------------------------------------------------------------------------
  // Labels
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Label
   * @category Labels
   * @description Creates a new personal label. Only the name is required. Optionally set a color, an ordering position, and mark it as a favorite.
   * @route POST /labels
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The label name (without a leading @)."}
   * @paramDef {"type":"String","label":"Color","name":"color","uiComponent":{"type":"DROPDOWN","options":{"values":["Berry Red","Red","Orange","Yellow","Olive Green","Lime Green","Green","Mint Green","Teal","Sky Blue","Light Blue","Blue","Grape","Violet","Lavender","Magenta","Salmon","Charcoal","Grey","Taupe"]}},"description":"Label color from the Todoist palette. Defaults to Charcoal."}
   * @paramDef {"type":"Number","label":"Order","name":"order","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional position of the label in the label list (smallest first)."}
   * @paramDef {"type":"Boolean","label":"Is Favorite","name":"is_favorite","uiComponent":{"type":"TOGGLE"},"description":"Whether the label is marked as a favorite."}
   * @returns {Object}
   * @sampleResult {"id":"2156154810","name":"waiting","color":"charcoal","order":1,"is_favorite":false}
   */
  async createLabel(name, color, order, is_favorite) {
    const logTag = '[createLabel]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/labels`,
      method: 'post',
      body: clean({
        name,
        color: this.#resolveChoice(color, COLOR_LABEL_TO_API),
        order,
        is_favorite,
      }),
    })
  }

  /**
   * @operationName List Labels
   * @category Labels
   * @description Lists the user's personal labels, paginated via a cursor. Pass the returned next_cursor back in as Cursor to fetch the next page.
   * @route GET /labels
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum labels per page (default 50, max 200)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response's next_cursor. Omit for the first page."}
   * @returns {Object}
   * @sampleResult {"results":[{"id":"2156154810","name":"waiting","color":"charcoal","order":1,"is_favorite":false}],"next_cursor":null}
   */
  async listLabels(limit, cursor) {
    const logTag = '[listLabels]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/labels`,
      method: 'get',
      query: {
        limit: limit || DEFAULT_LIMIT,
        cursor,
      },
    })
  }

  /**
   * @operationName Update Label
   * @category Labels
   * @description Updates an existing personal label. Only the fields you provide are changed. Supports renaming, changing color, reordering, and toggling favorite status. Renaming updates the label on all tasks that carry it.
   * @route POST /labels/{labelId}
   * @paramDef {"type":"String","label":"Label ID","name":"labelId","required":true,"description":"The ID of the label to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New label name."}
   * @paramDef {"type":"String","label":"Color","name":"color","uiComponent":{"type":"DROPDOWN","options":{"values":["Berry Red","Red","Orange","Yellow","Olive Green","Lime Green","Green","Mint Green","Teal","Sky Blue","Light Blue","Blue","Grape","Violet","Lavender","Magenta","Salmon","Charcoal","Grey","Taupe"]}},"description":"New label color from the Todoist palette."}
   * @paramDef {"type":"Number","label":"Order","name":"order","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New position of the label in the label list."}
   * @paramDef {"type":"Boolean","label":"Is Favorite","name":"is_favorite","uiComponent":{"type":"TOGGLE"},"description":"Whether the label is marked as a favorite."}
   * @returns {Object}
   * @sampleResult {"id":"2156154810","name":"blocked","color":"red","order":1,"is_favorite":true}
   */
  async updateLabel(labelId, name, color, order, is_favorite) {
    const logTag = '[updateLabel]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/labels/${ labelId }`,
      method: 'post',
      body: clean({
        name,
        color: this.#resolveChoice(color, COLOR_LABEL_TO_API),
        order,
        is_favorite,
      }),
    })
  }

  /**
   * @operationName Delete Label
   * @category Labels
   * @description Permanently deletes a personal label and removes it from all tasks that carry it. This cannot be undone. Returns a success confirmation.
   * @route DELETE /labels/{labelId}
   * @paramDef {"type":"String","label":"Label ID","name":"labelId","required":true,"description":"The ID of the label to delete."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteLabel(labelId) {
    const logTag = '[deleteLabel]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/labels/${ labelId }`,
      method: 'delete',
    })
  }

  // ---------------------------------------------------------------------------
  // Comments
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Comment
   * @category Comments
   * @description Adds a comment to a task or a project. Provide the comment content plus exactly one of Task ID or Project ID to indicate where the comment belongs.
   * @route POST /comments
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The comment text. Supports Todoist Markdown."}
   * @paramDef {"type":"String","label":"Task ID","name":"task_id","description":"The task to comment on. Provide either this or Project ID, not both."}
   * @paramDef {"type":"String","label":"Project","name":"project_id","dictionary":"getProjectsDictionary","description":"The project to comment on. Provide either this or Task ID, not both."}
   * @returns {Object}
   * @sampleResult {"id":"2992679862","task_id":"2995104339","project_id":null,"content":"Need this by Friday","posted_at":"2026-07-14T10:15:00.000000Z"}
   */
  async createComment(content, task_id, project_id) {
    const logTag = '[createComment]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/comments`,
      method: 'post',
      body: clean({
        content,
        task_id,
        project_id,
      }),
    })
  }

  /**
   * @operationName List Comments
   * @category Comments
   * @description Lists comments on a task or a project. Provide exactly one of Task ID or Project ID. Results are paginated via a cursor; pass the returned next_cursor back in as Cursor to fetch the next page.
   * @route GET /comments
   * @paramDef {"type":"String","label":"Task ID","name":"task_id","description":"List comments on this task. Provide either this or Project ID."}
   * @paramDef {"type":"String","label":"Project","name":"project_id","dictionary":"getProjectsDictionary","description":"List comments on this project. Provide either this or Task ID."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum comments per page (default 50, max 200)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response's next_cursor. Omit for the first page."}
   * @returns {Object}
   * @sampleResult {"results":[{"id":"2992679862","task_id":"2995104339","content":"Need this by Friday","posted_at":"2026-07-14T10:15:00.000000Z"}],"next_cursor":null}
   */
  async listComments(task_id, project_id, limit, cursor) {
    const logTag = '[listComments]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/comments`,
      method: 'get',
      query: {
        task_id,
        project_id,
        limit: limit || DEFAULT_LIMIT,
        cursor,
      },
    })
  }

  /**
   * @operationName Get Comment
   * @category Comments
   * @description Retrieves a single comment by its ID, including its content, author, and the task or project it belongs to.
   * @route GET /comments/{commentId}
   * @paramDef {"type":"String","label":"Comment ID","name":"commentId","required":true,"description":"The ID of the comment to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"2992679862","task_id":"2995104339","project_id":null,"content":"Need this by Friday","posted_at":"2026-07-14T10:15:00.000000Z"}
   */
  async getComment(commentId) {
    const logTag = '[getComment]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/comments/${ commentId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Update Comment
   * @category Comments
   * @description Updates the content of an existing comment.
   * @route POST /comments/{commentId}
   * @paramDef {"type":"String","label":"Comment ID","name":"commentId","required":true,"description":"The ID of the comment to update."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The new comment text."}
   * @returns {Object}
   * @sampleResult {"id":"2992679862","task_id":"2995104339","project_id":null,"content":"Updated: need this by Thursday","posted_at":"2026-07-14T10:15:00.000000Z"}
   */
  async updateComment(commentId, content) {
    const logTag = '[updateComment]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/comments/${ commentId }`,
      method: 'post',
      body: clean({
        content,
      }),
    })
  }

  /**
   * @operationName Delete Comment
   * @category Comments
   * @description Permanently deletes a comment. This cannot be undone. Returns a success confirmation.
   * @route DELETE /comments/{commentId}
   * @paramDef {"type":"String","label":"Comment ID","name":"commentId","required":true,"description":"The ID of the comment to delete."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteComment(commentId) {
    const logTag = '[deleteComment]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/comments/${ commentId }`,
      method: 'delete',
    })
  }

  // ---------------------------------------------------------------------------
  // Dictionaries
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} getProjectsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter projects by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Projects Dictionary
   * @description Lists projects for selecting a project in dependent parameters. The option value is the project ID.
   * @route POST /get-projects-dictionary
   * @paramDef {"type":"getProjectsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Inbox","value":"2203306141","note":"Inbox"}],"cursor":null}
   */
  async getProjectsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getProjectsDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/projects`,
      method: 'get',
      query: {
        limit: DEFAULT_LIMIT,
        cursor,
      },
    })

    const results = response.results || []
    const term = (search || '').toLowerCase()

    const items = results
      .filter(project => !term || (project.name || '').toLowerCase().includes(term))
      .map(project => ({
        label: project.name,
        value: project.id,
        note: project.is_inbox_project ? 'Inbox' : undefined,
      }))

    return { items, cursor: response.next_cursor || null }
  }

  /**
   * @typedef {Object} getSectionsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Project","name":"project_id","description":"The project whose sections should be listed."}
   */

  /**
   * @typedef {Object} getSectionsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter sections by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   * @paramDef {"type":"getSectionsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Dependent selection: the project to list sections for."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Sections Dictionary
   * @description Lists sections within a selected project for dependent parameters. Depends on the chosen project. The option value is the section ID.
   * @route POST /get-sections-dictionary
   * @paramDef {"type":"getSectionsDictionary__payload","label":"Payload","name":"payload","description":"Search, pagination, and the project criteria to scope sections."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Groceries","value":"7025","note":null}],"cursor":null}
   */
  async getSectionsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const logTag = '[getSectionsDictionary]'
    const projectId = criteria && criteria.project_id

    if (!projectId) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/sections`,
      method: 'get',
      query: {
        project_id: projectId,
        limit: DEFAULT_LIMIT,
        cursor,
      },
    })

    const results = response.results || []
    const term = (search || '').toLowerCase()

    const items = results
      .filter(section => !term || (section.name || '').toLowerCase().includes(term))
      .map(section => ({
        label: section.name,
        value: section.id,
        note: undefined,
      }))

    return { items, cursor: response.next_cursor || null }
  }

  /**
   * @typedef {Object} getLabelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter labels by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Labels Dictionary
   * @description Lists the user's personal labels for selecting a label in dependent parameters. The option value is the label name (which is what filtering endpoints expect).
   * @route POST /get-labels-dictionary
   * @paramDef {"type":"getLabelsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"waiting","value":"waiting","note":null}],"cursor":null}
   */
  async getLabelsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getLabelsDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/labels`,
      method: 'get',
      query: {
        limit: DEFAULT_LIMIT,
        cursor,
      },
    })

    const results = response.results || []
    const term = (search || '').toLowerCase()

    const items = results
      .filter(label => !term || (label.name || '').toLowerCase().includes(term))
      .map(label => ({
        label: label.name,
        value: label.name,
        note: undefined,
      }))

    return { items, cursor: response.next_cursor || null }
  }
}

Flowrunner.ServerCode.addService(TodoistService, [
  {
    name: 'apiToken',
    displayName: 'API Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Todoist API token. Find it in Todoist under Settings → Integrations → Developer → API token.',
  },
])
