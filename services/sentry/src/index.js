'use strict'

const logger = {
  info: (...args) => console.log('[Sentry] info:', ...args),
  debug: (...args) => console.log('[Sentry] debug:', ...args),
  error: (...args) => console.log('[Sentry] error:', ...args),
  warn: (...args) => console.log('[Sentry] warn:', ...args),
}

const DEFAULT_BASE_URL = 'https://sentry.io'

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
 * @integrationName Sentry
 * @integrationIcon /icon.svg
 */
class Sentry {
  constructor(config) {
    this.authToken = config.authToken
    this.organizationSlug = config.organizationSlug

    const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')

    this.apiBaseUrl = `${ baseUrl }/api/0`
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

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery || {}) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.authToken }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.detail || error.body?.message || error.message

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Sentry API error: ${ message }`)
    }
  }

  // ─── Projects ──────────────────────────────────────────────────────────

  /**
   * @operationName List Projects
   * @category Projects
   * @description Lists all projects the authenticated token can access within the configured organization. Returns each project's slug, name, id, platform, and status. Results are paginated with Sentry's cursor-based pagination; pass a cursor to retrieve additional pages.
   * @route GET /projects
   *
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response's Link header. Full Link-header pagination may be limited in this environment; use this to advance pages when a cursor value is available."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"1234","slug":"backend","name":"Backend","platform":"python","dateCreated":"2024-01-10T12:00:00Z","status":"active"}]
   */
  async listProjects(cursor) {
    return await this.#apiRequest({
      logTag: '[listProjects]',
      url: `${ this.apiBaseUrl }/organizations/${ this.organizationSlug }/projects/`,
      method: 'get',
      query: { cursor },
    })
  }

  /**
   * @operationName Get Project
   * @category Projects
   * @description Retrieves the full details of a single project by its slug, including platform, features, teams, and configuration. Use List Projects or the Projects dictionary to find a project slug.
   * @route GET /project
   *
   * @paramDef {"type":"String","label":"Project Slug","name":"projectSlug","required":true,"dictionary":"getProjectsDictionary","description":"The slug of the project to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1234","slug":"backend","name":"Backend","platform":"python","dateCreated":"2024-01-10T12:00:00Z","status":"active","features":["releases"]}
   */
  async getProject(projectSlug) {
    return await this.#apiRequest({
      logTag: '[getProject]',
      url: `${ this.apiBaseUrl }/projects/${ this.organizationSlug }/${ projectSlug }/`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Project
   * @category Projects
   * @description Creates a new project under a team in the organization. Requires the owning team's slug, a project name, and optionally a platform identifier (e.g. python, javascript, node). Returns the created project including its generated slug.
   * @route POST /projects
   *
   * @paramDef {"type":"String","label":"Team Slug","name":"teamSlug","required":true,"dictionary":"getTeamsDictionary","description":"The slug of the team that will own the new project."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Display name for the new project."}
   * @paramDef {"type":"String","label":"Platform","name":"platform","description":"Optional platform identifier for the project, e.g. python, javascript-react, node, go."}
   *
   * @returns {Object}
   * @sampleResult {"id":"5678","slug":"new-service","name":"New Service","platform":"node","dateCreated":"2026-07-14T10:00:00Z","status":"active"}
   */
  async createProject(teamSlug, name, platform) {
    return await this.#apiRequest({
      logTag: '[createProject]',
      url: `${ this.apiBaseUrl }/teams/${ this.organizationSlug }/${ teamSlug }/projects/`,
      method: 'post',
      body: clean({ name, platform }),
    })
  }

  /**
   * @operationName Update Project
   * @category Projects
   * @description Updates the settings of an existing project such as its display name, slug, and platform. Only provided fields are changed. Returns the updated project.
   * @route PUT /project
   *
   * @paramDef {"type":"String","label":"Project Slug","name":"projectSlug","required":true,"dictionary":"getProjectsDictionary","description":"The slug of the project to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New display name for the project."}
   * @paramDef {"type":"String","label":"New Slug","name":"newSlug","description":"New slug for the project. Must be unique within the organization."}
   * @paramDef {"type":"String","label":"Platform","name":"platform","description":"New platform identifier for the project, e.g. python, javascript-react, node."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1234","slug":"backend","name":"Backend Renamed","platform":"python","status":"active"}
   */
  async updateProject(projectSlug, name, newSlug, platform) {
    return await this.#apiRequest({
      logTag: '[updateProject]',
      url: `${ this.apiBaseUrl }/projects/${ this.organizationSlug }/${ projectSlug }/`,
      method: 'put',
      body: clean({ name, slug: newSlug, platform }),
    })
  }

  // ─── Issues ────────────────────────────────────────────────────────────

  /**
   * @operationName List Issues
   * @category Issues
   * @description Lists issues (aggregated error groups) for a project, filtered with Sentry's issue search syntax. Supports a search query (e.g. 'is:unresolved', 'is:assigned level:error'), a stats period window, and a sort order. Results are cursor-paginated. Returns each issue's id, title, culprit, status, level, event count, and first/last seen timestamps.
   * @route GET /issues
   *
   * @paramDef {"type":"String","label":"Project Slug","name":"projectSlug","required":true,"dictionary":"getProjectsDictionary","description":"The slug of the project whose issues to list."}
   * @paramDef {"type":"String","label":"Query","name":"query","description":"Sentry issue search query. Defaults to 'is:unresolved'. Examples: 'is:unresolved', 'is:assigned level:error', 'browser:Chrome'."}
   * @paramDef {"type":"String","label":"Stats Period","name":"statsPeriod","uiComponent":{"type":"DROPDOWN","options":{"values":["24h","14d","90d"]}},"description":"Time window for issue statistics and filtering. Defaults to 24h."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","uiComponent":{"type":"DROPDOWN","options":{"values":["Date","New","Priority","Frequency"]}},"description":"Sort order for results. Date = last seen, New = first seen, Priority, Frequency = event count. Defaults to Date."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response's Link header. Full Link-header pagination may be limited in this environment."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"98765","shortId":"BACKEND-1","title":"TypeError: cannot read property","culprit":"handler.process","level":"error","status":"unresolved","count":"42","userCount":8,"firstSeen":"2026-07-01T10:00:00Z","lastSeen":"2026-07-14T09:00:00Z","permalink":"https://sentry.io/organizations/acme/issues/98765/"}]
   */
  async listIssues(projectSlug, query, statsPeriod, sort, cursor) {
    const resolvedSort = this.#resolveChoice(sort, {
      Date: 'date',
      New: 'new',
      Priority: 'priority',
      Frequency: 'freq',
    })

    return await this.#apiRequest({
      logTag: '[listIssues]',
      url: `${ this.apiBaseUrl }/projects/${ this.organizationSlug }/${ projectSlug }/issues/`,
      method: 'get',
      query: {
        query: query || 'is:unresolved',
        statsPeriod: statsPeriod || '24h',
        sort: resolvedSort,
        cursor,
      },
    })
  }

  /**
   * @operationName Get Issue
   * @category Issues
   * @description Retrieves the full details of a single issue by its numeric issue id, including its status, assignee, level, tags, event counts, and metadata. The issue id can be found in a permalink or from List Issues.
   * @route GET /issue
   *
   * @paramDef {"type":"String","label":"Issue ID","name":"issueId","required":true,"description":"The numeric id of the issue (error group) to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"98765","shortId":"BACKEND-1","title":"TypeError: cannot read property","status":"unresolved","level":"error","count":"42","userCount":8,"assignedTo":null,"firstSeen":"2026-07-01T10:00:00Z","lastSeen":"2026-07-14T09:00:00Z"}
   */
  async getIssue(issueId) {
    return await this.#apiRequest({
      logTag: '[getIssue]',
      url: `${ this.apiBaseUrl }/issues/${ issueId }/`,
      method: 'get',
    })
  }

  /**
   * @operationName Update Issue
   * @category Issues
   * @description Updates an issue's status (resolve, unresolve, or ignore/mute) and/or its assignee. Set status to Resolved to mark it fixed, Unresolved to reopen it, or Ignored to mute it. Assign to a user with a value like 'user:123' or a username/email, or to a team with 'team:456'. Returns the updated issue.
   * @route PUT /issue
   *
   * @paramDef {"type":"String","label":"Issue ID","name":"issueId","required":true,"description":"The numeric id of the issue to update."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Resolved","Unresolved","Ignored"]}},"description":"New status for the issue. Resolved marks it fixed, Unresolved reopens it, Ignored mutes it."}
   * @paramDef {"type":"String","label":"Assigned To","name":"assignedTo","description":"Actor to assign the issue to. Use 'user:{id}' or a username/email for a user, or 'team:{id}' for a team. Leave empty to leave the assignee unchanged."}
   *
   * @returns {Object}
   * @sampleResult {"id":"98765","status":"resolved","assignedTo":{"type":"user","id":"123","name":"Jane Dev"},"statusDetails":{}}
   */
  async updateIssue(issueId, status, assignedTo) {
    const resolvedStatus = this.#resolveChoice(status, {
      Resolved: 'resolved',
      Unresolved: 'unresolved',
      Ignored: 'ignored',
    })

    return await this.#apiRequest({
      logTag: '[updateIssue]',
      url: `${ this.apiBaseUrl }/issues/${ issueId }/`,
      method: 'put',
      body: clean({ status: resolvedStatus, assignedTo }),
    })
  }

  /**
   * @operationName Delete Issue
   * @category Issues
   * @description Permanently deletes an issue and all of its associated events. This action cannot be undone. Returns an empty result on success.
   * @route DELETE /issue
   *
   * @paramDef {"type":"String","label":"Issue ID","name":"issueId","required":true,"description":"The numeric id of the issue to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteIssue(issueId) {
    await this.#apiRequest({
      logTag: '[deleteIssue]',
      url: `${ this.apiBaseUrl }/issues/${ issueId }/`,
      method: 'delete',
    })

    return { success: true }
  }

  /**
   * @operationName List Issue Events
   * @category Issues
   * @description Lists the individual events that belong to an issue, most recent first. Each event represents a single occurrence with its own id, timestamp, message, tags, and user context. Results are cursor-paginated.
   * @route GET /issue-events
   *
   * @paramDef {"type":"String","label":"Issue ID","name":"issueId","required":true,"description":"The numeric id of the issue whose events to list."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response's Link header. Full Link-header pagination may be limited in this environment."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"eventID":"abc123def456","message":"TypeError: cannot read property","dateCreated":"2026-07-14T09:00:00Z","tags":[{"key":"level","value":"error"}],"user":{"id":"42"}}]
   */
  async listIssueEvents(issueId, cursor) {
    return await this.#apiRequest({
      logTag: '[listIssueEvents]',
      url: `${ this.apiBaseUrl }/issues/${ issueId }/events/`,
      method: 'get',
      query: { cursor },
    })
  }

  /**
   * @operationName Get Latest Event
   * @category Issues
   * @description Retrieves the most recent event for an issue, including its full payload: message, stack trace / exception entries, tags, breadcrumbs, request context, and user. Useful for inspecting the newest occurrence of an error.
   * @route GET /issue-latest-event
   *
   * @paramDef {"type":"String","label":"Issue ID","name":"issueId","required":true,"description":"The numeric id of the issue whose latest event to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"eventID":"abc123def456","message":"TypeError: cannot read property","dateCreated":"2026-07-14T09:00:00Z","platform":"python","tags":[{"key":"level","value":"error"}],"entries":[{"type":"exception"}]}
   */
  async getLatestEvent(issueId) {
    return await this.#apiRequest({
      logTag: '[getLatestEvent]',
      url: `${ this.apiBaseUrl }/issues/${ issueId }/events/latest/`,
      method: 'get',
    })
  }

  // ─── Events ────────────────────────────────────────────────────────────

  /**
   * @operationName List Project Events
   * @category Events
   * @description Lists individual events captured for a project, most recent first, across all issues. Each event includes its id, associated issue (groupID), message, timestamp, tags, and user. Results are cursor-paginated.
   * @route GET /events
   *
   * @paramDef {"type":"String","label":"Project Slug","name":"projectSlug","required":true,"dictionary":"getProjectsDictionary","description":"The slug of the project whose events to list."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response's Link header. Full Link-header pagination may be limited in this environment."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"eventID":"abc123def456","groupID":"98765","message":"TypeError: cannot read property","dateCreated":"2026-07-14T09:00:00Z","platform":"python","tags":[{"key":"level","value":"error"}]}]
   */
  async listProjectEvents(projectSlug, cursor) {
    return await this.#apiRequest({
      logTag: '[listProjectEvents]',
      url: `${ this.apiBaseUrl }/projects/${ this.organizationSlug }/${ projectSlug }/events/`,
      method: 'get',
      query: { cursor },
    })
  }

  /**
   * @operationName Get Event
   * @category Events
   * @description Retrieves the full details of a single event within a project by its event id, including message, platform, stack trace / exception entries, tags, breadcrumbs, and context.
   * @route GET /event
   *
   * @paramDef {"type":"String","label":"Project Slug","name":"projectSlug","required":true,"dictionary":"getProjectsDictionary","description":"The slug of the project the event belongs to."}
   * @paramDef {"type":"String","label":"Event ID","name":"eventId","required":true,"description":"The event id (hexadecimal) to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"eventID":"abc123def456","groupID":"98765","message":"TypeError: cannot read property","dateCreated":"2026-07-14T09:00:00Z","platform":"python","tags":[{"key":"level","value":"error"}],"entries":[{"type":"exception"}]}
   */
  async getEvent(projectSlug, eventId) {
    return await this.#apiRequest({
      logTag: '[getEvent]',
      url: `${ this.apiBaseUrl }/projects/${ this.organizationSlug }/${ projectSlug }/events/${ eventId }/`,
      method: 'get',
    })
  }

  // ─── Releases ──────────────────────────────────────────────────────────

  /**
   * @operationName List Releases
   * @category Releases
   * @description Lists releases for the organization, most recent first. Each release includes its version, associated projects, commit count, deploy count, and creation date. Optionally filter with a query string. Results are cursor-paginated.
   * @route GET /releases
   *
   * @paramDef {"type":"String","label":"Query","name":"query","description":"Optional filter to match releases by version substring."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response's Link header. Full Link-header pagination may be limited in this environment."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"version":"1.2.3","shortVersion":"1.2.3","dateCreated":"2026-07-10T10:00:00Z","projects":[{"slug":"backend","name":"Backend"}],"commitCount":12,"deployCount":2}]
   */
  async listReleases(query, cursor) {
    return await this.#apiRequest({
      logTag: '[listReleases]',
      url: `${ this.apiBaseUrl }/organizations/${ this.organizationSlug }/releases/`,
      method: 'get',
      query: { query, cursor },
    })
  }

  /**
   * @operationName Create Release
   * @category Releases
   * @description Creates a new release for one or more projects in the organization. Provide a version identifier and the list of project slugs the release applies to. Optionally include a VCS ref (commit sha) and a URL. Returns the created release.
   * @route POST /releases
   *
   * @paramDef {"type":"String","label":"Version","name":"version","required":true,"description":"Unique version identifier for the release, e.g. '1.2.3' or a commit sha."}
   * @paramDef {"type":"Array<String>","label":"Projects","name":"projects","required":true,"description":"Slugs of the projects this release applies to."}
   * @paramDef {"type":"String","label":"Ref","name":"ref","description":"Optional VCS reference (commit sha) associated with this release."}
   * @paramDef {"type":"String","label":"URL","name":"url","description":"Optional URL pointing to the release, e.g. a build or changelog page."}
   *
   * @returns {Object}
   * @sampleResult {"version":"1.2.3","shortVersion":"1.2.3","ref":"a1b2c3d","url":"https://ci.example.com/builds/42","dateCreated":"2026-07-14T10:00:00Z","projects":[{"slug":"backend","name":"Backend"}]}
   */
  async createRelease(version, projects, ref, url) {
    return await this.#apiRequest({
      logTag: '[createRelease]',
      url: `${ this.apiBaseUrl }/organizations/${ this.organizationSlug }/releases/`,
      method: 'post',
      body: clean({ version, projects, ref, url }),
    })
  }

  /**
   * @operationName Get Release
   * @category Releases
   * @description Retrieves the details of a single release by its version, including associated projects, commit and deploy counts, authors, and the last event and deploy timestamps.
   * @route GET /release
   *
   * @paramDef {"type":"String","label":"Version","name":"version","required":true,"description":"The version identifier of the release to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"version":"1.2.3","shortVersion":"1.2.3","dateCreated":"2026-07-10T10:00:00Z","projects":[{"slug":"backend","name":"Backend"}],"commitCount":12,"deployCount":2,"lastDeploy":{"environment":"production"}}
   */
  async getRelease(version) {
    return await this.#apiRequest({
      logTag: '[getRelease]',
      url: `${ this.apiBaseUrl }/organizations/${ this.organizationSlug }/releases/${ encodeURIComponent(version) }/`,
      method: 'get',
    })
  }

  /**
   * @operationName Delete Release
   * @category Releases
   * @description Permanently deletes a release by its version. The release can only be deleted if it has no associated events. Returns an empty result on success.
   * @route DELETE /release
   *
   * @paramDef {"type":"String","label":"Version","name":"version","required":true,"description":"The version identifier of the release to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteRelease(version) {
    await this.#apiRequest({
      logTag: '[deleteRelease]',
      url: `${ this.apiBaseUrl }/organizations/${ this.organizationSlug }/releases/${ encodeURIComponent(version) }/`,
      method: 'delete',
    })

    return { success: true }
  }

  /**
   * @operationName Create Deploy
   * @category Releases
   * @description Records a deploy of a release to an environment. Provide the release version and the target environment (e.g. production, staging), and optionally a deploy name and time range. Returns the created deploy.
   * @route POST /release-deploy
   *
   * @paramDef {"type":"String","label":"Version","name":"version","required":true,"description":"The version identifier of the release being deployed."}
   * @paramDef {"type":"String","label":"Environment","name":"environment","required":true,"description":"Target environment for the deploy, e.g. production, staging, development."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Optional human-readable name for the deploy."}
   *
   * @returns {Object}
   * @sampleResult {"id":"55","version":"1.2.3","environment":"production","name":"CI deploy","dateStarted":null,"dateFinished":"2026-07-14T10:05:00Z"}
   */
  async createDeploy(version, environment, name) {
    return await this.#apiRequest({
      logTag: '[createDeploy]',
      url: `${ this.apiBaseUrl }/organizations/${ this.organizationSlug }/releases/${ encodeURIComponent(version) }/deploys/`,
      method: 'post',
      body: clean({ environment, name }),
    })
  }

  // ─── Teams ─────────────────────────────────────────────────────────────

  /**
   * @operationName List Teams
   * @category Teams
   * @description Lists all teams in the organization the token can access. Returns each team's slug, name, id, member count, and project count. Results are cursor-paginated.
   * @route GET /teams
   *
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response's Link header. Full Link-header pagination may be limited in this environment."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"7","slug":"backend-team","name":"Backend Team","memberCount":5,"dateCreated":"2024-01-05T10:00:00Z"}]
   */
  async listTeams(cursor) {
    return await this.#apiRequest({
      logTag: '[listTeams]',
      url: `${ this.apiBaseUrl }/organizations/${ this.organizationSlug }/teams/`,
      method: 'get',
      query: { cursor },
    })
  }

  // ─── Dictionaries ──────────────────────────────────────────────────────

  /**
   * @typedef {Object} getProjectsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter projects by name or slug."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of projects."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Projects Dictionary
   * @description Lists projects in the organization for selecting a project slug in dependent parameters. The option value is the project slug.
   * @route POST /get-projects-dictionary
   *
   * @paramDef {"type":"getProjectsDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor for filtering projects."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Backend","value":"backend","note":"python"}],"cursor":null}
   */
  async getProjectsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getProjectsDictionary]',
      url: `${ this.apiBaseUrl }/organizations/${ this.organizationSlug }/projects/`,
      method: 'get',
      query: { query: search, cursor },
    })

    const projects = Array.isArray(response) ? response : []

    return {
      items: projects.map(project => ({
        label: project.name || project.slug,
        value: project.slug,
        note: project.platform || undefined,
      })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getTeamsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter teams by name or slug."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of teams."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Teams Dictionary
   * @description Lists teams in the organization for selecting a team slug in dependent parameters. The option value is the team slug.
   * @route POST /get-teams-dictionary
   *
   * @paramDef {"type":"getTeamsDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor for filtering teams."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Backend Team","value":"backend-team","note":"5 members"}],"cursor":null}
   */
  async getTeamsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getTeamsDictionary]',
      url: `${ this.apiBaseUrl }/organizations/${ this.organizationSlug }/teams/`,
      method: 'get',
      query: { cursor },
    })

    let teams = Array.isArray(response) ? response : []

    if (search) {
      const term = search.toLowerCase()

      teams = teams.filter(team =>
        (team.name || '').toLowerCase().includes(term) ||
        (team.slug || '').toLowerCase().includes(term)
      )
    }

    return {
      items: teams.map(team => ({
        label: team.name || team.slug,
        value: team.slug,
        note: team.memberCount !== undefined ? `${ team.memberCount } members` : undefined,
      })),
      cursor: null,
    }
  }
}

Flowrunner.ServerCode.addService(Sentry, [
  {
    name: 'authToken',
    displayName: 'Auth Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'A Sentry auth token. Create one under Settings → Auth Tokens, or use an Internal Integration token. Needs scopes such as project:read, project:write, event:read, and project:releases.',
  },
  {
    name: 'organizationSlug',
    displayName: 'Organization Slug',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Sentry organization slug, taken from the URL: sentry.io/organizations/{slug}.',
  },
  {
    name: 'baseUrl',
    displayName: 'Base URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    defaultValue: 'https://sentry.io',
    shared: false,
    hint: 'Base URL of your Sentry instance. Leave as https://sentry.io for Sentry SaaS; self-hosted Sentry sets its own URL. The API path /api/0 is appended automatically.',
  },
])
