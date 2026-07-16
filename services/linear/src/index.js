// ============================================================================
//  Linear   auth: personal API key (raw Authorization header)
//  All operations POST a GraphQL query/mutation to the single endpoint.
//  TRIGGERS: REALTIME (SINGLE_APP) — onLinearEvent (webhookCreate/webhookDelete)
// ============================================================================

const crypto = require('crypto')

// ============================================================================
//  CONSTANTS
// ============================================================================
const GRAPHQL_ENDPOINT = 'https://api.linear.app/graphql'

const CALL_TYPES = {
  SHAPE_EVENT: 'SHAPE_EVENT',
  FILTER_TRIGGER: 'FILTER_TRIGGER',
}

// Maps the friendly issue-priority dropdown label to Linear's numeric priority.
const PRIORITY_LABEL_TO_VALUE = {
  'No priority': 0,
  Urgent: 1,
  High: 2,
  Medium: 3,
  Low: 4,
}

// Maps the friendly Resource dropdown label to the Linear webhook resourceType and the
// inbound webhook payload `type` value (both are the same PascalCase entity name).
const RESOURCE_LABEL_TO_TYPE = {
  Issues: 'Issue',
  Comments: 'Comment',
  Projects: 'Project',
  'Issue Labels': 'IssueLabel',
}

// ============================================================================
//  LOGGER
// ============================================================================
const logger = {
  info: (...args) => console.log('[Linear] info:', ...args),
  debug: (...args) => console.log('[Linear] debug:', ...args),
  error: (...args) => console.log('[Linear] error:', ...args),
  warn: (...args) => console.log('[Linear] warn:', ...args),
}

// ============================================================================
//  DICTIONARY PAYLOAD TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} getTeamsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter teams by name or key."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getProjectsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter projects by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getUsersDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter users by name or email."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getLabelsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter labels by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getStatesDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Team","name":"teamId","description":"The team whose workflow states populate the list."}
 */

/**
 * @typedef {Object} getStatesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter workflow states by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 * @paramDef {"type":"getStatesDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The team whose workflow states to list."}
 */

/**
 * @integrationName Linear
 * @integrationIcon /icon.svg
 * @integrationTriggersScope SINGLE_APP
 */
class Linear {
  constructor(config) {
    this.config = config || {}
    this.apiKey = this.config.apiKey
  }

  // ==========================================================================
  //  CORE — every external call goes through #graphql
  // ==========================================================================
  // Executes a GraphQL query/mutation. Linear can return HTTP 200 with a top-level
  // `errors` array, so we always inspect it and throw the joined messages.
  async #graphql(query, variables, logTag) {
    try {
      logger.debug(`${ logTag || 'graphql' } request`)

      const response = await Flowrunner.Request.post(GRAPHQL_ENDPOINT)
        .set({ Authorization: this.apiKey, 'Content-Type': 'application/json' })
        .send({ query, variables: variables || {} })

      if (response && Array.isArray(response.errors) && response.errors.length) {
        const message = response.errors.map(error => error?.message).filter(Boolean).join('; ')

        throw new Error(message || 'Linear GraphQL request failed')
      }

      return response?.data
    } catch (error) {
      // A thrown GraphQL-errors Error has no .body; transport errors carry error.body.
      const graphqlErrors = error?.body?.errors
      const apiMessage = Array.isArray(graphqlErrors)
        ? graphqlErrors.map(item => item?.message).filter(Boolean).join('; ')
        : error?.body?.message || error?.message || 'Request failed'

      logger.error(`${ logTag || 'graphql' } failed: ${ apiMessage }`)

      throw new Error(`Linear API error: ${ apiMessage }`)
    }
  }

  // Maps a friendly dropdown label to its API value. Unmapped values pass through unchanged.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Splits an Array<String> param that may also arrive as a comma-separated string.
  #toList(value) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    const list = Array.isArray(value)
      ? value
      : String(value).split(',').map(part => part.trim()).filter(Boolean)

    return list.length ? list : undefined
  }

  // ==========================================================================
  //  ISSUES
  // ==========================================================================
  /**
   * @operationName Create Issue
   * @category Issues
   * @description Creates a new issue in a Linear team. Requires a team and a title; optionally set description (Markdown), assignee, priority, workflow state (status), labels, project, and due date. Returns the created issue with its identifier and URL.
   * @route POST /create-issue
   * @paramDef {"type":"String","label":"Team","name":"teamId","required":true,"dictionary":"getTeamsDictionary","description":"The team to create the issue in."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The issue title."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Issue description in Markdown."}
   * @paramDef {"type":"String","label":"Assignee","name":"assigneeId","dictionary":"getUsersDictionary","description":"The user to assign the issue to."}
   * @paramDef {"type":"Number","label":"Priority","name":"priority","uiComponent":{"type":"DROPDOWN","options":{"values":["No priority","Urgent","High","Medium","Low"]}},"description":"Issue priority."}
   * @paramDef {"type":"String","label":"Workflow State","name":"stateId","dictionary":"getStatesDictionary","dependsOn":["teamId"],"description":"The workflow state (status) for the issue. Pick a team first to populate the list."}
   * @paramDef {"type":"Array<String>","label":"Labels","name":"labelIds","dictionary":"getLabelsDictionary","description":"Label IDs to attach. Accepts a list or comma-separated string."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","dictionary":"getProjectsDictionary","description":"The project to add the issue to."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Due date in YYYY-MM-DD format."}
   * @returns {Object}
   * @sampleResult {"success":true,"issue":{"id":"a1b2c3d4-0000-0000-0000-000000000000","identifier":"ENG-42","title":"Fix login bug","url":"https://linear.app/acme/issue/ENG-42","priority":2,"state":{"id":"s1","name":"Todo"},"assignee":{"id":"u1","name":"Jane Doe"}}}
   */
  async createIssue(teamId, title, description, assigneeId, priority, stateId, labelIds, projectId, dueDate) {
    const input = { teamId, title }

    if (description !== undefined && description !== null && description !== '') input.description = description
    if (assigneeId) input.assigneeId = assigneeId
    if (stateId) input.stateId = stateId
    if (projectId) input.projectId = projectId
    if (dueDate) input.dueDate = dueDate

    const resolvedPriority = this.#resolveChoice(priority, PRIORITY_LABEL_TO_VALUE)

    if (resolvedPriority !== undefined && resolvedPriority !== null && resolvedPriority !== '') {
      input.priority = Number(resolvedPriority)
    }

    const labels = this.#toList(labelIds)

    if (labels) input.labelIds = labels

    const query = `
      mutation CreateIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id identifier title url priority dueDate createdAt
            state { id name }
            assignee { id name }
            team { id name key }
            project { id name }
            labels { nodes { id name } }
          }
        }
      }`

    const data = await this.#graphql(query, { input }, 'createIssue')

    return data.issueCreate
  }

  /**
   * @operationName Get Issue
   * @category Issues
   * @description Retrieves a single Linear issue by its ID (UUID) or identifier (e.g. ENG-42), including title, description, state, assignee, team, project, labels, and URL.
   * @route GET /get-issue
   * @paramDef {"type":"String","label":"Issue","name":"issueId","required":true,"description":"The issue ID (UUID) or identifier such as ENG-42."}
   * @returns {Object}
   * @sampleResult {"id":"a1b2c3d4-0000-0000-0000-000000000000","identifier":"ENG-42","title":"Fix login bug","description":"Users cannot log in.","url":"https://linear.app/acme/issue/ENG-42","priority":2,"state":{"id":"s1","name":"Todo"},"assignee":{"id":"u1","name":"Jane Doe"},"team":{"id":"t1","name":"Engineering","key":"ENG"}}
   */
  async getIssue(issueId) {
    const query = `
      query GetIssue($id: String!) {
        issue(id: $id) {
          id identifier title description url priority dueDate createdAt updatedAt
          state { id name type }
          assignee { id name email }
          creator { id name }
          team { id name key }
          project { id name }
          labels { nodes { id name } }
        }
      }`

    const data = await this.#graphql(query, { id: issueId }, 'getIssue')

    return data.issue
  }

  /**
   * @operationName List Issues
   * @category Issues
   * @description Lists issues with optional filtering by team, assignee, or workflow state, and cursor-based pagination. Returns issue nodes plus pageInfo for fetching the next page.
   * @route GET /list-issues
   * @paramDef {"type":"String","label":"Team","name":"teamId","dictionary":"getTeamsDictionary","description":"Filter to issues in this team."}
   * @paramDef {"type":"String","label":"Assignee","name":"assigneeId","dictionary":"getUsersDictionary","description":"Filter to issues assigned to this user."}
   * @paramDef {"type":"String","label":"Workflow State","name":"stateId","dictionary":"getStatesDictionary","dependsOn":["teamId"],"description":"Filter to issues in this workflow state. Pick a team first to populate the list."}
   * @paramDef {"type":"Number","label":"Limit","name":"first","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":50,"description":"Max issues to return per page (default 50, max 250)."}
   * @paramDef {"type":"String","label":"Cursor","name":"after","description":"Pagination cursor from a previous response's pageInfo.endCursor."}
   * @returns {Object}
   * @sampleResult {"nodes":[{"id":"a1b2c3d4-0000-0000-0000-000000000000","identifier":"ENG-42","title":"Fix login bug","priority":2,"state":{"id":"s1","name":"Todo"},"assignee":{"id":"u1","name":"Jane Doe"}}],"pageInfo":{"hasNextPage":false,"endCursor":"eyJvIjoxfQ"}}
   */
  async listIssues(teamId, assigneeId, stateId, first, after) {
    const filter = {}

    if (teamId) filter.team = { id: { eq: teamId } }
    if (assigneeId) filter.assignee = { id: { eq: assigneeId } }
    if (stateId) filter.state = { id: { eq: stateId } }

    const query = `
      query ListIssues($filter: IssueFilter, $first: Int, $after: String) {
        issues(filter: $filter, first: $first, after: $after) {
          nodes {
            id identifier title url priority dueDate createdAt updatedAt
            state { id name }
            assignee { id name }
            team { id name key }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`

    const data = await this.#graphql(
      query,
      { filter: Object.keys(filter).length ? filter : undefined, first: first || 50, after: after || undefined },
      'listIssues'
    )

    return data.issues
  }

  /**
   * @operationName Update Issue
   * @category Issues
   * @description Updates fields on an existing Linear issue. Provide only the fields you want to change; leave others blank to keep their current values. Supports title, description, assignee, priority, workflow state, labels, project, and due date.
   * @route PATCH /update-issue
   * @paramDef {"type":"String","label":"Issue","name":"issueId","required":true,"description":"The issue ID (UUID) to update."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New title. Leave blank to keep the current title."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description in Markdown."}
   * @paramDef {"type":"String","label":"Assignee","name":"assigneeId","dictionary":"getUsersDictionary","description":"Reassign the issue to this user."}
   * @paramDef {"type":"Number","label":"Priority","name":"priority","uiComponent":{"type":"DROPDOWN","options":{"values":["No priority","Urgent","High","Medium","Low"]}},"description":"New priority."}
   * @paramDef {"type":"String","label":"Workflow State","name":"stateId","dictionary":"getStatesDictionary","dependsOn":["teamId"],"description":"Move the issue to this workflow state."}
   * @paramDef {"type":"String","label":"Team","name":"teamId","dictionary":"getTeamsDictionary","description":"Used to populate the Workflow State picker (and moves the issue to this team if set)."}
   * @paramDef {"type":"Array<String>","label":"Labels","name":"labelIds","dictionary":"getLabelsDictionary","description":"Replace the issue's labels with these label IDs. Accepts a list or comma-separated string."}
   * @paramDef {"type":"String","label":"Project","name":"projectId","dictionary":"getProjectsDictionary","description":"Move the issue to this project."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"New due date in YYYY-MM-DD format."}
   * @returns {Object}
   * @sampleResult {"success":true,"issue":{"id":"a1b2c3d4-0000-0000-0000-000000000000","identifier":"ENG-42","title":"Fix login bug (updated)","priority":1,"state":{"id":"s2","name":"In Progress"},"assignee":{"id":"u2","name":"John Smith"}}}
   */
  async updateIssue(issueId, title, description, assigneeId, priority, stateId, teamId, labelIds, projectId, dueDate) {
    const input = {}

    if (title !== undefined && title !== null && title !== '') input.title = title
    if (description !== undefined && description !== null) input.description = description
    if (assigneeId) input.assigneeId = assigneeId
    if (stateId) input.stateId = stateId
    if (teamId) input.teamId = teamId
    if (projectId) input.projectId = projectId
    if (dueDate) input.dueDate = dueDate

    const resolvedPriority = this.#resolveChoice(priority, PRIORITY_LABEL_TO_VALUE)

    if (resolvedPriority !== undefined && resolvedPriority !== null && resolvedPriority !== '') {
      input.priority = Number(resolvedPriority)
    }

    const labels = this.#toList(labelIds)

    if (labels) input.labelIds = labels

    const query = `
      mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue {
            id identifier title url priority dueDate updatedAt
            state { id name }
            assignee { id name }
            team { id name key }
            project { id name }
            labels { nodes { id name } }
          }
        }
      }`

    const data = await this.#graphql(query, { id: issueId, input }, 'updateIssue')

    return data.issueUpdate
  }

  /**
   * @operationName Delete Issue
   * @category Issues
   * @description Archives a Linear issue. Linear does not hard-delete issues through this action; the issue is moved to the archive (issueArchive) and can be restored from Linear.
   * @route DELETE /delete-issue
   * @paramDef {"type":"String","label":"Issue","name":"issueId","required":true,"description":"The issue ID (UUID) to archive."}
   * @returns {Object}
   * @sampleResult {"success":true,"issueId":"a1b2c3d4-0000-0000-0000-000000000000"}
   */
  async deleteIssue(issueId) {
    const query = `
      mutation ArchiveIssue($id: String!) {
        issueArchive(id: $id) { success }
      }`

    const data = await this.#graphql(query, { id: issueId }, 'deleteIssue')

    return { success: data.issueArchive?.success ?? false, issueId }
  }

  /**
   * @operationName Create Comment
   * @category Issues
   * @description Adds a comment to a Linear issue. The comment body supports Markdown. Returns the created comment with its ID and URL.
   * @route POST /create-comment
   * @paramDef {"type":"String","label":"Issue","name":"issueId","required":true,"description":"The issue ID (UUID) to comment on."}
   * @paramDef {"type":"String","label":"Body","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The comment body in Markdown."}
   * @returns {Object}
   * @sampleResult {"success":true,"comment":{"id":"c1b2c3d4-0000-0000-0000-000000000000","body":"Looking into this now.","url":"https://linear.app/acme/issue/ENG-42#comment-c1b2","createdAt":"2024-01-15T09:30:00.000Z","user":{"id":"u1","name":"Jane Doe"}}}
   */
  async createComment(issueId, body) {
    const input = { issueId, body }
    const query = `
      mutation CreateComment($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
          comment { id body url createdAt user { id name } }
        }
      }`

    const data = await this.#graphql(query, { input }, 'createComment')

    return data.commentCreate
  }

  // ==========================================================================
  //  SEARCH
  // ==========================================================================
  /**
   * @operationName Search Issues
   * @category Search
   * @description Full-text searches issues across the workspace by a query string, matching titles, descriptions, and identifiers. Returns matching issue nodes with pageInfo for pagination.
   * @route GET /search-issues
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"The text to search for across issue titles, descriptions, and identifiers."}
   * @paramDef {"type":"Number","label":"Limit","name":"first","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":25,"description":"Max results to return per page (default 25)."}
   * @paramDef {"type":"String","label":"Cursor","name":"after","description":"Pagination cursor from a previous response's pageInfo.endCursor."}
   * @returns {Object}
   * @sampleResult {"nodes":[{"id":"a1b2c3d4-0000-0000-0000-000000000000","identifier":"ENG-42","title":"Fix login bug","url":"https://linear.app/acme/issue/ENG-42","state":{"id":"s1","name":"Todo"}}],"pageInfo":{"hasNextPage":false,"endCursor":"eyJvIjoxfQ"}}
   */
  async searchIssues(query, first, after) {
    const gql = `
      query SearchIssues($query: String!, $first: Int, $after: String) {
        issueSearch(query: $query, first: $first, after: $after) {
          nodes {
            id identifier title url priority createdAt
            state { id name }
            assignee { id name }
            team { id name key }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`

    const data = await this.#graphql(gql, { query, first: first || 25, after: after || undefined }, 'searchIssues')

    return data.issueSearch
  }

  // ==========================================================================
  //  TEAMS
  // ==========================================================================
  /**
   * @operationName List Teams
   * @category Teams
   * @description Lists teams in the workspace with cursor-based pagination. Returns team nodes (id, name, key, description) plus pageInfo for the next page.
   * @route GET /list-teams
   * @paramDef {"type":"Number","label":"Limit","name":"first","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":50,"description":"Max teams to return per page (default 50)."}
   * @paramDef {"type":"String","label":"Cursor","name":"after","description":"Pagination cursor from a previous response's pageInfo.endCursor."}
   * @returns {Object}
   * @sampleResult {"nodes":[{"id":"t1","name":"Engineering","key":"ENG","description":"Product engineering"}],"pageInfo":{"hasNextPage":false,"endCursor":"eyJvIjoxfQ"}}
   */
  async listTeams(first, after) {
    const query = `
      query ListTeams($first: Int, $after: String) {
        teams(first: $first, after: $after) {
          nodes { id name key description private createdAt }
          pageInfo { hasNextPage endCursor }
        }
      }`

    const data = await this.#graphql(query, { first: first || 50, after: after || undefined }, 'listTeams')

    return data.teams
  }

  /**
   * @operationName Get Team
   * @category Teams
   * @description Retrieves a single Linear team by ID, including its name, key, description, and default issue-related settings.
   * @route GET /get-team
   * @paramDef {"type":"String","label":"Team","name":"teamId","required":true,"dictionary":"getTeamsDictionary","description":"The team to fetch."}
   * @returns {Object}
   * @sampleResult {"id":"t1","name":"Engineering","key":"ENG","description":"Product engineering","private":false,"createdAt":"2023-01-01T00:00:00.000Z"}
   */
  async getTeam(teamId) {
    const query = `
      query GetTeam($id: String!) {
        team(id: $id) { id name key description private createdAt }
      }`

    const data = await this.#graphql(query, { id: teamId }, 'getTeam')

    return data.team
  }

  // ==========================================================================
  //  PROJECTS
  // ==========================================================================
  /**
   * @operationName List Projects
   * @category Projects
   * @description Lists projects in the workspace with cursor-based pagination. Returns project nodes (id, name, description, state, progress) plus pageInfo for the next page.
   * @route GET /list-projects
   * @paramDef {"type":"Number","label":"Limit","name":"first","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":50,"description":"Max projects to return per page (default 50)."}
   * @paramDef {"type":"String","label":"Cursor","name":"after","description":"Pagination cursor from a previous response's pageInfo.endCursor."}
   * @returns {Object}
   * @sampleResult {"nodes":[{"id":"p1","name":"Q1 Launch","description":"Ship v2","state":"started","progress":0.4,"url":"https://linear.app/acme/project/q1-launch"}],"pageInfo":{"hasNextPage":false,"endCursor":"eyJvIjoxfQ"}}
   */
  async listProjects(first, after) {
    const query = `
      query ListProjects($first: Int, $after: String) {
        projects(first: $first, after: $after) {
          nodes { id name description state progress url createdAt }
          pageInfo { hasNextPage endCursor }
        }
      }`

    const data = await this.#graphql(query, { first: first || 50, after: after || undefined }, 'listProjects')

    return data.projects
  }

  /**
   * @operationName Create Project
   * @category Projects
   * @description Creates a project associated with one or more teams. Requires a name and at least one team; optionally set a description and initial state. Returns the created project with its ID and URL.
   * @route POST /create-project
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The project name."}
   * @paramDef {"type":"Array<String>","label":"Teams","name":"teamIds","required":true,"dictionary":"getTeamsDictionary","description":"Team IDs to associate with the project. Accepts a list or comma-separated string."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Project description."}
   * @paramDef {"type":"String","label":"State","name":"state","uiComponent":{"type":"DROPDOWN","options":{"values":["Backlog","Planned","Started","Paused","Completed","Canceled"]}},"description":"Initial project state."}
   * @returns {Object}
   * @sampleResult {"success":true,"project":{"id":"p1","name":"Q1 Launch","description":"Ship v2","state":"planned","url":"https://linear.app/acme/project/q1-launch"}}
   */
  async createProject(name, teamIds, description, state) {
    const teams = this.#toList(teamIds)

    if (!teams || !teams.length) {
      throw new Error('Create Project requires at least one team.')
    }

    const input = { name, teamIds: teams }

    if (description !== undefined && description !== null && description !== '') input.description = description

    const resolvedState = this.#resolveChoice(state, {
      Backlog: 'backlog',
      Planned: 'planned',
      Started: 'started',
      Paused: 'paused',
      Completed: 'completed',
      Canceled: 'canceled',
    })

    if (resolvedState) input.state = resolvedState

    const query = `
      mutation CreateProject($input: ProjectCreateInput!) {
        projectCreate(input: $input) {
          success
          project { id name description state progress url createdAt }
        }
      }`

    const data = await this.#graphql(query, { input }, 'createProject')

    return data.projectCreate
  }

  /**
   * @operationName Update Project
   * @category Projects
   * @description Updates an existing Linear project. Provide only the fields you want to change; leave others blank to keep their current values. Supports name, description, and state.
   * @route PATCH /update-project
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New name. Leave blank to keep the current name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description."}
   * @paramDef {"type":"String","label":"State","name":"state","uiComponent":{"type":"DROPDOWN","options":{"values":["Backlog","Planned","Started","Paused","Completed","Canceled"]}},"description":"New project state."}
   * @returns {Object}
   * @sampleResult {"success":true,"project":{"id":"p1","name":"Q1 Launch (updated)","description":"Ship v2","state":"started","url":"https://linear.app/acme/project/q1-launch"}}
   */
  async updateProject(projectId, name, description, state) {
    const input = {}

    if (name !== undefined && name !== null && name !== '') input.name = name
    if (description !== undefined && description !== null) input.description = description

    const resolvedState = this.#resolveChoice(state, {
      Backlog: 'backlog',
      Planned: 'planned',
      Started: 'started',
      Paused: 'paused',
      Completed: 'completed',
      Canceled: 'canceled',
    })

    if (resolvedState) input.state = resolvedState

    const query = `
      mutation UpdateProject($id: String!, $input: ProjectUpdateInput!) {
        projectUpdate(id: $id, input: $input) {
          success
          project { id name description state progress url updatedAt }
        }
      }`

    const data = await this.#graphql(query, { id: projectId, input }, 'updateProject')

    return data.projectUpdate
  }

  // ==========================================================================
  //  USERS
  // ==========================================================================
  /**
   * @operationName List Users
   * @category Users
   * @description Lists members of the workspace with cursor-based pagination. Returns user nodes (id, name, email, active status) plus pageInfo for the next page.
   * @route GET /list-users
   * @paramDef {"type":"Number","label":"Limit","name":"first","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":50,"description":"Max users to return per page (default 50)."}
   * @paramDef {"type":"String","label":"Cursor","name":"after","description":"Pagination cursor from a previous response's pageInfo.endCursor."}
   * @returns {Object}
   * @sampleResult {"nodes":[{"id":"u1","name":"Jane Doe","displayName":"jane","email":"jane@acme.com","active":true}],"pageInfo":{"hasNextPage":false,"endCursor":"eyJvIjoxfQ"}}
   */
  async listUsers(first, after) {
    const query = `
      query ListUsers($first: Int, $after: String) {
        users(first: $first, after: $after) {
          nodes { id name displayName email active admin createdAt }
          pageInfo { hasNextPage endCursor }
        }
      }`

    const data = await this.#graphql(query, { first: first || 50, after: after || undefined }, 'listUsers')

    return data.users
  }

  /**
   * @operationName Get Viewer
   * @category Users
   * @description Returns the authenticated user (the owner of the API key) along with basic workspace details. Useful as a connection check to confirm the API key is valid.
   * @route GET /get-viewer
   * @returns {Object}
   * @sampleResult {"id":"u1","name":"Jane Doe","displayName":"jane","email":"jane@acme.com","admin":true,"organization":{"id":"org1","name":"Acme","urlKey":"acme"}}
   */
  async getViewer() {
    const query = `
      query Viewer {
        viewer {
          id name displayName email admin active createdAt
          organization { id name urlKey }
        }
      }`

    const data = await this.#graphql(query, {}, 'getViewer')

    return data.viewer
  }

  // ==========================================================================
  //  WORKFLOW STATES
  // ==========================================================================
  /**
   * @operationName List Workflow States
   * @category Workflow States
   * @description Lists workflow states (issue statuses such as Todo, In Progress, Done), optionally filtered to a single team. Returns state nodes (id, name, type, color, position) plus pageInfo.
   * @route GET /list-workflow-states
   * @paramDef {"type":"String","label":"Team","name":"teamId","dictionary":"getTeamsDictionary","description":"Filter to workflow states belonging to this team."}
   * @paramDef {"type":"Number","label":"Limit","name":"first","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":100,"description":"Max states to return per page (default 100)."}
   * @paramDef {"type":"String","label":"Cursor","name":"after","description":"Pagination cursor from a previous response's pageInfo.endCursor."}
   * @returns {Object}
   * @sampleResult {"nodes":[{"id":"s1","name":"Todo","type":"unstarted","color":"#e2e2e2","position":0,"team":{"id":"t1","name":"Engineering"}}],"pageInfo":{"hasNextPage":false,"endCursor":"eyJvIjoxfQ"}}
   */
  async listWorkflowStates(teamId, first, after) {
    const filter = teamId ? { team: { id: { eq: teamId } } } : undefined
    const query = `
      query ListStates($filter: WorkflowStateFilter, $first: Int, $after: String) {
        workflowStates(filter: $filter, first: $first, after: $after) {
          nodes { id name type color position team { id name } }
          pageInfo { hasNextPage endCursor }
        }
      }`

    const data = await this.#graphql(query, { filter, first: first || 100, after: after || undefined }, 'listWorkflowStates')

    return data.workflowStates
  }

  // ==========================================================================
  //  LABELS
  // ==========================================================================
  /**
   * @operationName List Labels
   * @category Labels
   * @description Lists issue labels in the workspace with cursor-based pagination. Returns label nodes (id, name, color, and the team it belongs to, if any) plus pageInfo.
   * @route GET /list-labels
   * @paramDef {"type":"Number","label":"Limit","name":"first","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":100,"description":"Max labels to return per page (default 100)."}
   * @paramDef {"type":"String","label":"Cursor","name":"after","description":"Pagination cursor from a previous response's pageInfo.endCursor."}
   * @returns {Object}
   * @sampleResult {"nodes":[{"id":"l1","name":"Bug","color":"#eb5757","team":{"id":"t1","name":"Engineering"}}],"pageInfo":{"hasNextPage":false,"endCursor":"eyJvIjoxfQ"}}
   */
  async listLabels(first, after) {
    const query = `
      query ListLabels($first: Int, $after: String) {
        issueLabels(first: $first, after: $after) {
          nodes { id name color team { id name } }
          pageInfo { hasNextPage endCursor }
        }
      }`

    const data = await this.#graphql(query, { first: first || 100, after: after || undefined }, 'listLabels')

    return data.issueLabels
  }

  // ==========================================================================
  //  REALTIME TRIGGER (SINGLE_APP)
  // ==========================================================================
  /**
   * @operationName On Linear Event
   * @category Triggers
   * @description Fires when a chosen Linear resource changes. Choose a resource type (Issues, Comments, Projects, or Issue Labels) and optionally scope to a single team. Linear registers a webhook and this trigger runs your flow on each create, update, or remove event.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-linear-event
   * @paramDef {"type":"String","label":"Resource","name":"resource","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Issues","Comments","Projects","Issue Labels"]}},"description":"Which kind of resource to watch."}
   * @paramDef {"type":"String","label":"Team","name":"teamId","dictionary":"getTeamsDictionary","description":"Optional. Limit the webhook to a single team. Leave blank to watch all public teams."}
   * @returns {Object}
   * @sampleResult {"eventId":"evt_a1b2","action":"create","type":"Issue","resource":"Issues","data":{"id":"a1b2c3d4-0000-0000-0000-000000000000","identifier":"ENG-42","title":"Fix login bug"},"createdAt":"2024-01-15T09:30:00.000Z"}
   */
  onLinearEvent(callType, payload) {
    if (callType === CALL_TYPES.SHAPE_EVENT) {
      return [{ name: 'onLinearEvent', data: this.#shapeEvent(payload) }]
    }

    if (callType === CALL_TYPES.FILTER_TRIGGER) {
      return {
        ids: this.#matchTriggers(payload, (trigger, event) => {
          const wantType = this.#resolveChoice(trigger.data.resource, RESOURCE_LABEL_TO_TYPE)

          if (wantType !== event.type) {
            return false
          }

          // Optional team scoping is enforced at webhook creation; if a team was set,
          // also confirm the event carries a matching teamId when present.
          if (trigger.data.teamId && event.teamId && trigger.data.teamId !== event.teamId) {
            return false
          }

          return true
        }),
      }
    }
  }

  #shapeEvent(body) {
    const data = body?.data || {}

    return {
      eventId: body?.webhookId ? `${ body.webhookId }-${ data.id || '' }` : data.id,
      action: body?.action,
      type: body?.type,
      resource: body?.type,
      teamId: data.teamId || data.team?.id,
      data,
      actor: body?.actor,
      url: body?.url,
      createdAt: body?.createdAt || data.createdAt,
    }
  }

  // The FILTER_TRIGGER payload carries the shaped eventData (under .data) and the registered triggers.
  #matchTriggers(payload, predicate) {
    const eventData = payload.eventData || payload.data || {}
    const event = { type: eventData.type, teamId: eventData.teamId, action: eventData.action }

    return (payload.triggers || [])
      .filter(trigger => predicate(trigger, event))
      .map(trigger => trigger.id)
  }

  // ── SYSTEM trigger handlers (SINGLE_APP) ───────────────────────────────
  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerUpsertWebhook
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    logger.debug('handleTriggerUpsertWebhook invoked')

    const url = `${ invocation.callbackUrl }${ invocation.callbackUrl.includes('?') ? '&' : '?' }connectionId=${ invocation.connectionId }`
    const webhooks = []

    for (const event of invocation.events || []) {
      const data = event.triggerData || {}
      const resourceType = this.#resolveChoice(data.resource, RESOURCE_LABEL_TO_TYPE)
      const input = {
        url,
        resourceTypes: [resourceType],
        label: `FlowRunner ${ data.resource || resourceType }`,
        enabled: true,
      }

      if (data.teamId) {
        input.teamId = data.teamId
      } else {
        input.allPublicTeams = true
      }

      const query = `
        mutation CreateWebhook($input: WebhookCreateInput!) {
          webhookCreate(input: $input) {
            success
            webhook { id enabled secret }
          }
        }`

      const result = await this.#graphql(query, { input }, 'createWebhook')
      const webhook = result?.webhookCreate?.webhook

      webhooks.push({
        triggerId: event.id,
        webhookId: webhook?.id,
        secret: webhook?.secret,
        resourceType,
        teamId: data.teamId || null,
      })
    }

    return { webhookData: { webhooks }, connectionId: invocation.connectionId }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerResolveEvents
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    logger.debug('handleTriggerResolveEvents invoked')

    if (!invocation || !invocation.body) {
      return { handshake: true, responseToExternalService: invocation?.body || {} }
    }

    if (!this.#verifyWebhookSignature(invocation)) {
      logger.warn('handleTriggerResolveEvents: webhook signature verification failed — rejecting delivery')

      return { connectionId: invocation.queryParams?.connectionId, events: [] }
    }

    const events = this.onLinearEvent(CALL_TYPES.SHAPE_EVENT, invocation.body)

    return { connectionId: invocation.queryParams?.connectionId, events }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerSelectMatched
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    logger.debug(`handleTriggerSelectMatched.${ invocation.eventName }`)

    return this[invocation.eventName](CALL_TYPES.FILTER_TRIGGER, invocation)
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerDeleteWebhook
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerDeleteWebhook(invocation) {
    logger.debug('handleTriggerDeleteWebhook invoked')

    const webhooks = invocation.webhookData?.webhooks || []

    for (const webhook of webhooks) {
      if (!webhook.webhookId) {
        continue
      }

      try {
        const query = `
          mutation DeleteWebhook($id: String!) {
            webhookDelete(id: $id) { success }
          }`

        await this.#graphql(query, { id: webhook.webhookId }, 'deleteWebhook')
      } catch (error) {
        logger.warn(`handleTriggerDeleteWebhook: failed to delete webhook ${ webhook.webhookId }: ${ error?.message }`)
      }
    }

    return { webhookData: {} }
  }

  // Verifies the inbound Linear webhook signature: hex-encoded HMAC-SHA256 of the raw
  // body using the per-webhook secret returned by webhookCreate. If no secret was stored
  // (e.g. the build-time mock), verification is skipped with a warning.
  #verifyWebhookSignature(invocation) {
    const webhooks = invocation.webhookData?.webhooks || []
    const secret = webhooks.find(hook => hook.secret)?.secret

    if (!secret) {
      logger.warn('No webhook secret stored — skipping signature verification.')

      return true
    }

    const headers = invocation.headers || {}
    const provided = headers['linear-signature'] || headers['Linear-Signature']

    if (!provided) {
      return false
    }

    const rawBody = invocation.rawBody !== undefined ? invocation.rawBody : JSON.stringify(invocation.body)
    const expected = crypto.createHmac('sha256', secret).update(Buffer.from(rawBody)).digest('hex')
    const expectedBuffer = Buffer.from(expected)
    const providedBuffer = Buffer.from(String(provided))

    return expectedBuffer.length === providedBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  }

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================
  /**
   * @registerAs DICTIONARY
   * @operationName Get Teams Dictionary
   * @description Lists teams for selection in team-scoped parameters.
   * @route POST /get-teams-dictionary
   * @paramDef {"type":"getTeamsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Engineering (ENG)","value":"t1","note":"team"}],"cursor":"eyJvIjoxfQ"}
   */
  async getTeamsDictionary(payload) {
    const { search, cursor } = payload || {}
    const filter = search ? { name: { containsIgnoreCase: search } } : undefined
    const query = `
      query TeamsDict($filter: TeamFilter, $after: String) {
        teams(filter: $filter, first: 50, after: $after) {
          nodes { id name key }
          pageInfo { hasNextPage endCursor }
        }
      }`

    const data = await this.#graphql(query, { filter, after: cursor || undefined }, 'getTeamsDictionary')
    const conn = data.teams

    return {
      items: conn.nodes.map(team => ({ label: `${ team.name } (${ team.key })`, value: team.id, note: 'team' })),
      cursor: conn.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : undefined,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Projects Dictionary
   * @description Lists projects for selection in project-scoped parameters.
   * @route POST /get-projects-dictionary
   * @paramDef {"type":"getProjectsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Q1 Launch","value":"p1","note":"started"}],"cursor":"eyJvIjoxfQ"}
   */
  async getProjectsDictionary(payload) {
    const { search, cursor } = payload || {}
    const filter = search ? { name: { containsIgnoreCase: search } } : undefined
    const query = `
      query ProjectsDict($filter: ProjectFilter, $after: String) {
        projects(filter: $filter, first: 50, after: $after) {
          nodes { id name state }
          pageInfo { hasNextPage endCursor }
        }
      }`

    const data = await this.#graphql(query, { filter, after: cursor || undefined }, 'getProjectsDictionary')
    const conn = data.projects

    return {
      items: conn.nodes.map(project => ({ label: project.name, value: project.id, note: project.state })),
      cursor: conn.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : undefined,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Users Dictionary
   * @description Lists workspace members for selection as issue assignees or in user-scoped parameters.
   * @route POST /get-users-dictionary
   * @paramDef {"type":"getUsersDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Jane Doe","value":"u1","note":"jane@acme.com"}],"cursor":"eyJvIjoxfQ"}
   */
  async getUsersDictionary(payload) {
    const { search, cursor } = payload || {}
    const filter = search ? { name: { containsIgnoreCase: search } } : undefined
    const query = `
      query UsersDict($filter: UserFilter, $after: String) {
        users(filter: $filter, first: 50, after: $after) {
          nodes { id name email }
          pageInfo { hasNextPage endCursor }
        }
      }`

    const data = await this.#graphql(query, { filter, after: cursor || undefined }, 'getUsersDictionary')
    const conn = data.users

    return {
      items: conn.nodes.map(user => ({ label: user.name, value: user.id, note: user.email })),
      cursor: conn.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : undefined,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Labels Dictionary
   * @description Lists issue labels for selection in label parameters.
   * @route POST /get-labels-dictionary
   * @paramDef {"type":"getLabelsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Bug","value":"l1","note":"label"}],"cursor":"eyJvIjoxfQ"}
   */
  async getLabelsDictionary(payload) {
    const { search, cursor } = payload || {}
    const filter = search ? { name: { containsIgnoreCase: search } } : undefined
    const query = `
      query LabelsDict($filter: IssueLabelFilter, $after: String) {
        issueLabels(filter: $filter, first: 50, after: $after) {
          nodes { id name }
          pageInfo { hasNextPage endCursor }
        }
      }`

    const data = await this.#graphql(query, { filter, after: cursor || undefined }, 'getLabelsDictionary')
    const conn = data.issueLabels

    return {
      items: conn.nodes.map(label => ({ label: label.name, value: label.id, note: 'label' })),
      cursor: conn.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : undefined,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get States Dictionary
   * @description Lists workflow states (issue statuses) for the chosen team, for selection in status parameters.
   * @route POST /get-states-dictionary
   * @paramDef {"type":"getStatesDictionary__payload","label":"Payload","name":"payload","description":"Search, pagination, and the team whose workflow states to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Todo","value":"s1","note":"unstarted"}],"cursor":"eyJvIjoxfQ"}
   */
  async getStatesDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const teamId = criteria?.teamId
    const and = []

    if (teamId) and.push({ team: { id: { eq: teamId } } })
    if (search) and.push({ name: { containsIgnoreCase: search } })

    const filter = and.length ? { and } : undefined
    const query = `
      query StatesDict($filter: WorkflowStateFilter, $after: String) {
        workflowStates(filter: $filter, first: 50, after: $after) {
          nodes { id name type }
          pageInfo { hasNextPage endCursor }
        }
      }`

    const data = await this.#graphql(query, { filter, after: cursor || undefined }, 'getStatesDictionary')
    const conn = data.workflowStates

    return {
      items: conn.nodes.map(state => ({ label: state.name, value: state.id, note: state.type })),
      cursor: conn.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : undefined,
    }
  }
}

Flowrunner.ServerCode.addService(Linear, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Linear personal API key. Get it from Linear → Settings → Security & access → Personal API keys (or Settings → API → Personal API keys).',
  },
])
