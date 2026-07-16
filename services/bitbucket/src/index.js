'use strict'

const API_BASE_URL = 'https://api.bitbucket.org/2.0'

const logger = {
  info: (...args) => console.log('[Bitbucket] info:', ...args),
  debug: (...args) => console.log('[Bitbucket] debug:', ...args),
  error: (...args) => console.log('[Bitbucket] error:', ...args),
  warn: (...args) => console.log('[Bitbucket] warn:', ...args),
}

/**
 * @integrationName Bitbucket
 * @integrationIcon /icon.svg
 */
class Bitbucket {
  constructor(config) {
    this.config = config || {}
    this.email = this.config.email
    this.apiToken = this.config.apiToken
    this.workspace = this.config.workspace
  }

  #authHeader() {
    const raw = `${ this.email }:${ this.apiToken }`
    const encoded = Buffer.from(raw).toString('base64')

    return {
      Authorization: `Basic ${ encoded }`,
      Accept: 'application/json',
    }
  }

  #handleError(error) {
    // Bitbucket error payloads are shaped { type: "error", error: { message, detail } } on error.body.
    const bodyMessage = typeof error?.body?.error?.message === 'string' ? error.body.error.message : null
    const detail = typeof error?.body?.error?.detail === 'string' ? error.body.error.detail : null
    const errMessage = typeof error?.message === 'string' ? error.message : null

    let message = bodyMessage || errMessage || `request failed${ error?.status ? ` (HTTP ${ error.status })` : '' }`

    if (detail && detail !== message) {
      message = `${ message }: ${ detail }`
    }

    const wrapped = new Error(`Bitbucket API error: ${ message }`)
    wrapped.status = error?.status
    wrapped.body = error?.body
    throw wrapped
  }

  async #apiRequest({ url, method = 'get', body, query, logTag = '#apiRequest' }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set(this.#authHeader())
        .set({ 'Content-Type': 'application/json' })
        .query(query || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      logger.error(`${ logTag } - failed:`, JSON.stringify(error?.body || error?.message || error))
      this.#handleError(error)
    }
  }

  /**
   * Follows Bitbucket's next-URL pagination. Bitbucket returns { values, next } where `next`
   * is a fully-qualified URL to the next page. Collects up to `maxPages` pages of `values`.
   * @private
   */
  async #paginate({ url, query, maxPages = 10, logTag = '#paginate' }) {
    const collected = []
    let nextUrl = url
    let nextQuery = query
    let pages = 0

    while (nextUrl && pages < maxPages) {
      const response = await this.#apiRequest({ url: nextUrl, query: nextQuery, logTag })

      if (Array.isArray(response?.values)) {
        collected.push(...response.values)
      }

      nextUrl = response?.next || null
      // `next` already carries all query params, so drop the initial query on subsequent pages.
      nextQuery = undefined
      pages += 1
    }

    return collected
  }

  #cleanObject(obj) {
    if (!obj) return obj

    Object.keys(obj).forEach(key => {
      if (obj[key] === undefined || obj[key] === null) {
        delete obj[key]
      }
    })

    return obj
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #splitList(value) {
    if (!value) return undefined

    if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean)

    return String(value).split(',').map(s => s.trim()).filter(Boolean)
  }

  // ======================================== DICTIONARIES ========================================

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
   * @typedef {Object} getRepositoriesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter repositories by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Repositories Dictionary
   * @category Repositories
   * @description Lists repositories in the configured workspace for selection in dependent parameters. Returns each repository's slug as the value.
   * @route POST /get-repositories-dictionary
   * @param {getRepositoriesDictionary__payload} payload
   * @returns {DictionaryResponse}
   * @sampleResult {"cursor":null,"items":[{"label":"my-repo","value":"my-repo","note":"Private: true"}]}
   */
  async getRepositoriesDictionary(payload) {
    const { search, cursor } = payload || {}
    const page = cursor ? parseInt(cursor, 10) : 1

    const query = { pagelen: 100, page, sort: '-updated_on' }

    if (search) query.q = `name ~ "${ search.replace(/"/g, '') }"`

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/repositories/${ this.workspace }`,
      query,
      logTag: 'getRepositoriesDictionary',
    })

    const repos = response?.values || []

    return {
      items: repos.map(repo => ({
        label: repo.name,
        value: repo.slug,
        note: `Private: ${ repo.is_private }`,
      })),
      cursor: response?.next ? String(page + 1) : null,
    }
  }

  /**
   * @typedef {Object} getBranchesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Repository","name":"repo_slug","required":true,"description":"Repository slug.","dictionary":"getRepositoriesDictionary"}
   */

  /**
   * @typedef {Object} getBranchesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter branches by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number)."}
   * @paramDef {"type":"getBranchesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Repository information."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Branches Dictionary
   * @category Branches
   * @description Lists branches for a repository in the configured workspace for selection in dependent parameters.
   * @route POST /get-branches-dictionary
   * @param {getBranchesDictionary__payload} payload
   * @returns {DictionaryResponse}
   * @sampleResult {"cursor":null,"items":[{"label":"main","value":"main","note":"Target: a1b2c3d"}]}
   */
  async getBranchesDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const repoSlug = criteria?.repo_slug
    const page = cursor ? parseInt(cursor, 10) : 1

    const query = { pagelen: 100, page }

    if (search) query.q = `name ~ "${ search.replace(/"/g, '') }"`

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/repositories/${ this.workspace }/${ repoSlug }/refs/branches`,
      query,
      logTag: 'getBranchesDictionary',
    })

    const branches = response?.values || []

    return {
      items: branches.map(branch => ({
        label: branch.name,
        value: branch.name,
        note: `Target: ${ (branch.target?.hash || '').substring(0, 7) }`,
      })),
      cursor: response?.next ? String(page + 1) : null,
    }
  }

  // ======================================== REPOSITORIES ========================================

  /**
   * @description Lists repositories in the configured workspace. Supports filtering by the caller's permission role, a BBQL query string, and sorting. Aggregates results across paginated responses.
   * @route GET /list-repositories
   * @operationName List Repositories
   * @category Repositories
   * @appearanceColor #0052cc #2684ff
   *
   * @paramDef {"type":"String","label":"Role","name":"role","description":"Filter by the caller's permission on the repository.","uiComponent":{"type":"DROPDOWN","options":{"values":["Owner","Admin","Contributor","Member"]}}}
   * @paramDef {"type":"String","label":"Query","name":"q","description":"Bitbucket query language filter, e.g. name ~ \"api\"."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","description":"Sort field.","uiComponent":{"type":"DROPDOWN","options":{"values":["Recently Updated","Least Recently Updated","Name (A-Z)","Name (Z-A)","Recently Created"]}}}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"uuid":"{abc}","name":"my-repo","slug":"my-repo","full_name":"my-workspace/my-repo","is_private":true,"mainbranch":{"name":"main"}}]
   */
  async listRepositories(role, q, sort) {
    const query = this.#cleanObject({
      role: this.#resolveChoice(role, {
        Owner: 'owner',
        Admin: 'admin',
        Contributor: 'contributor',
        Member: 'member',
      }),
      q,
      sort: this.#resolveChoice(sort, {
        'Recently Updated': '-updated_on',
        'Least Recently Updated': 'updated_on',
        'Name (A-Z)': 'name',
        'Name (Z-A)': '-name',
        'Recently Created': '-created_on',
      }),
      pagelen: 100,
    })

    return await this.#paginate({
      url: `${ API_BASE_URL }/repositories/${ this.workspace }`,
      query,
      logTag: 'listRepositories',
    })
  }

  /**
   * @description Retrieves detailed information about a single repository in the configured workspace, including its main branch, size, language, and links.
   * @route GET /get-repository
   * @operationName Get Repository
   * @category Repositories
   * @appearanceColor #0052cc #2684ff
   *
   * @paramDef {"type":"String","label":"Repository","name":"repo_slug","required":true,"description":"Repository slug.","dictionary":"getRepositoriesDictionary"}
   *
   * @returns {Object}
   * @sampleResult {"uuid":"{abc}","name":"my-repo","slug":"my-repo","full_name":"my-workspace/my-repo","is_private":true,"language":"javascript","size":12345,"mainbranch":{"name":"main"}}
   */
  async getRepository(repo_slug) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repositories/${ this.workspace }/${ repo_slug }`,
      logTag: 'getRepository',
    })
  }

  // ======================================== ISSUES ========================================

  /**
   * @description Creates an issue in a repository's issue tracker. The issue tracker must be enabled for the repository. Kind and priority are optional and default to Bug and Major respectively.
   * @route POST /create-issue
   * @operationName Create Issue
   * @category Issues
   * @appearanceColor #0052cc #2684ff
   *
   * @paramDef {"type":"String","label":"Repository","name":"repo_slug","required":true,"description":"Repository slug. The issue tracker must be enabled for this repository.","dictionary":"getRepositoriesDictionary"}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Issue title."}
   * @paramDef {"type":"String","label":"Content","name":"content","description":"Issue description in Markdown.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Kind","name":"kind","description":"Issue kind.","uiComponent":{"type":"DROPDOWN","options":{"values":["Bug","Enhancement","Proposal","Task"]}}}
   * @paramDef {"type":"String","label":"Priority","name":"priority","description":"Issue priority.","uiComponent":{"type":"DROPDOWN","options":{"values":["Trivial","Minor","Major","Critical","Blocker"]}}}
   * @paramDef {"type":"String","label":"Assignee","name":"assignee","description":"Account ID or UUID of the user to assign the issue to."}
   *
   * @returns {Object}
   * @sampleResult {"id":1,"title":"Found a bug","kind":"bug","priority":"major","state":"new","content":{"raw":"Details"}}
   */
  async createIssue(repo_slug, title, content, kind, priority, assignee) {
    const body = this.#cleanObject({
      title,
      content: content ? { raw: content } : undefined,
      kind: this.#resolveChoice(kind, {
        Bug: 'bug',
        Enhancement: 'enhancement',
        Proposal: 'proposal',
        Task: 'task',
      }),
      priority: this.#resolveChoice(priority, {
        Trivial: 'trivial',
        Minor: 'minor',
        Major: 'major',
        Critical: 'critical',
        Blocker: 'blocker',
      }),
      assignee: assignee ? { account_id: assignee } : undefined,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repositories/${ this.workspace }/${ repo_slug }/issues`,
      method: 'post',
      body,
      logTag: 'createIssue',
    })
  }

  /**
   * @description Retrieves a single issue from a repository's issue tracker by its numeric ID.
   * @route GET /get-issue
   * @operationName Get Issue
   * @category Issues
   * @appearanceColor #0052cc #2684ff
   *
   * @paramDef {"type":"String","label":"Repository","name":"repo_slug","required":true,"description":"Repository slug.","dictionary":"getRepositoriesDictionary"}
   * @paramDef {"type":"String","label":"Issue ID","name":"issue_id","required":true,"description":"Numeric ID of the issue."}
   *
   * @returns {Object}
   * @sampleResult {"id":1,"title":"Found a bug","kind":"bug","priority":"major","state":"new","content":{"raw":"Details"}}
   */
  async getIssue(repo_slug, issue_id) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repositories/${ this.workspace }/${ repo_slug }/issues/${ issue_id }`,
      logTag: 'getIssue',
    })
  }

  /**
   * @description Lists issues in a repository's issue tracker. Supports an optional Bitbucket query language filter (e.g. state = "new"). Aggregates results across paginated responses.
   * @route GET /list-issues
   * @operationName List Issues
   * @category Issues
   * @appearanceColor #0052cc #2684ff
   *
   * @paramDef {"type":"String","label":"Repository","name":"repo_slug","required":true,"description":"Repository slug.","dictionary":"getRepositoriesDictionary"}
   * @paramDef {"type":"String","label":"Query","name":"q","description":"Bitbucket query language filter, e.g. state = \"new\" AND priority = \"major\"."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":1,"title":"Found a bug","kind":"bug","priority":"major","state":"new"}]
   */
  async listIssues(repo_slug, q) {
    const query = this.#cleanObject({ q, pagelen: 50 })

    return await this.#paginate({
      url: `${ API_BASE_URL }/repositories/${ this.workspace }/${ repo_slug }/issues`,
      query,
      logTag: 'listIssues',
    })
  }

  /**
   * @description Updates an existing issue. Only the fields you provide are changed. State transitions the issue (e.g. New, Resolved, Closed).
   * @route PUT /update-issue
   * @operationName Update Issue
   * @category Issues
   * @appearanceColor #0052cc #2684ff
   *
   * @paramDef {"type":"String","label":"Repository","name":"repo_slug","required":true,"description":"Repository slug.","dictionary":"getRepositoriesDictionary"}
   * @paramDef {"type":"String","label":"Issue ID","name":"issue_id","required":true,"description":"Numeric ID of the issue."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New issue title."}
   * @paramDef {"type":"String","label":"Content","name":"content","description":"New issue description in Markdown.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"State","name":"state","description":"New issue state.","uiComponent":{"type":"DROPDOWN","options":{"values":["New","Open","Resolved","On Hold","Invalid","Duplicate","Won't Fix","Closed"]}}}
   * @paramDef {"type":"String","label":"Kind","name":"kind","description":"New issue kind.","uiComponent":{"type":"DROPDOWN","options":{"values":["Bug","Enhancement","Proposal","Task"]}}}
   * @paramDef {"type":"String","label":"Priority","name":"priority","description":"New issue priority.","uiComponent":{"type":"DROPDOWN","options":{"values":["Trivial","Minor","Major","Critical","Blocker"]}}}
   * @paramDef {"type":"String","label":"Assignee","name":"assignee","description":"Account ID or UUID of the user to assign the issue to."}
   *
   * @returns {Object}
   * @sampleResult {"id":1,"title":"Updated title","kind":"bug","priority":"critical","state":"resolved"}
   */
  async updateIssue(repo_slug, issue_id, title, content, state, kind, priority, assignee) {
    const body = this.#cleanObject({
      title,
      content: content ? { raw: content } : undefined,
      state: this.#resolveChoice(state, {
        New: 'new',
        Open: 'open',
        Resolved: 'resolved',
        'On Hold': 'on hold',
        Invalid: 'invalid',
        Duplicate: 'duplicate',
        "Won't Fix": 'wontfix',
        Closed: 'closed',
      }),
      kind: this.#resolveChoice(kind, {
        Bug: 'bug',
        Enhancement: 'enhancement',
        Proposal: 'proposal',
        Task: 'task',
      }),
      priority: this.#resolveChoice(priority, {
        Trivial: 'trivial',
        Minor: 'minor',
        Major: 'major',
        Critical: 'critical',
        Blocker: 'blocker',
      }),
      assignee: assignee ? { account_id: assignee } : undefined,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repositories/${ this.workspace }/${ repo_slug }/issues/${ issue_id }`,
      method: 'put',
      body,
      logTag: 'updateIssue',
    })
  }

  /**
   * @description Adds a comment to an existing issue in a repository's issue tracker.
   * @route POST /add-issue-comment
   * @operationName Add Issue Comment
   * @category Issues
   * @appearanceColor #0052cc #2684ff
   *
   * @paramDef {"type":"String","label":"Repository","name":"repo_slug","required":true,"description":"Repository slug.","dictionary":"getRepositoriesDictionary"}
   * @paramDef {"type":"String","label":"Issue ID","name":"issue_id","required":true,"description":"Numeric ID of the issue."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"description":"Comment body in Markdown.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   *
   * @returns {Object}
   * @sampleResult {"id":10,"content":{"raw":"Thanks for the report"},"user":{"display_name":"Jane"},"created_on":"2024-01-01T12:00:00Z"}
   */
  async addIssueComment(repo_slug, issue_id, content) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repositories/${ this.workspace }/${ repo_slug }/issues/${ issue_id }/comments`,
      method: 'post',
      body: { content: { raw: content } },
      logTag: 'addIssueComment',
    })
  }

  // ======================================== PULL REQUESTS ========================================

  /**
   * @description Creates a pull request from a source branch into a destination branch. Optionally closes the source branch on merge and adds reviewers by account ID (comma-separated).
   * @route POST /create-pull-request
   * @operationName Create Pull Request
   * @category Pull Requests
   * @appearanceColor #0052cc #2684ff
   *
   * @paramDef {"type":"String","label":"Repository","name":"repo_slug","required":true,"description":"Repository slug.","dictionary":"getRepositoriesDictionary"}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Pull request title."}
   * @paramDef {"type":"String","label":"Source Branch","name":"source_branch","required":true,"description":"Name of the source branch.","dictionary":"getBranchesDictionary","dependsOn":["repo_slug"]}
   * @paramDef {"type":"String","label":"Destination Branch","name":"destination_branch","description":"Name of the destination branch. Defaults to the repository main branch when omitted.","dictionary":"getBranchesDictionary","dependsOn":["repo_slug"]}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Pull request description in Markdown.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"Boolean","label":"Close Source Branch","name":"close_source_branch","description":"Close the source branch when the pull request merges.","uiComponent":{"type":"CHECKBOX"}}
   * @paramDef {"type":"String","label":"Reviewers","name":"reviewers","description":"Account IDs or UUIDs of reviewers. Pass as a comma-separated string."}
   *
   * @returns {Object}
   * @sampleResult {"id":1,"title":"Add feature","state":"OPEN","source":{"branch":{"name":"feature"}},"destination":{"branch":{"name":"main"}}}
   */
  async createPullRequest(repo_slug, title, source_branch, destination_branch, description, close_source_branch, reviewers) {
    const reviewerList = this.#splitList(reviewers)

    const body = this.#cleanObject({
      title,
      source: { branch: { name: source_branch } },
      destination: destination_branch ? { branch: { name: destination_branch } } : undefined,
      description,
      close_source_branch: close_source_branch === undefined ? undefined : Boolean(close_source_branch),
      reviewers: reviewerList ? reviewerList.map(id => ({ account_id: id })) : undefined,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repositories/${ this.workspace }/${ repo_slug }/pullrequests`,
      method: 'post',
      body,
      logTag: 'createPullRequest',
    })
  }

  /**
   * @description Retrieves a single pull request by its numeric ID, including source and destination branches, author, state, and links.
   * @route GET /get-pull-request
   * @operationName Get Pull Request
   * @category Pull Requests
   * @appearanceColor #0052cc #2684ff
   *
   * @paramDef {"type":"String","label":"Repository","name":"repo_slug","required":true,"description":"Repository slug.","dictionary":"getRepositoriesDictionary"}
   * @paramDef {"type":"String","label":"Pull Request ID","name":"pull_request_id","required":true,"description":"Numeric ID of the pull request."}
   *
   * @returns {Object}
   * @sampleResult {"id":1,"title":"Add feature","state":"OPEN","source":{"branch":{"name":"feature"}},"destination":{"branch":{"name":"main"}}}
   */
  async getPullRequest(repo_slug, pull_request_id) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repositories/${ this.workspace }/${ repo_slug }/pullrequests/${ pull_request_id }`,
      logTag: 'getPullRequest',
    })
  }

  /**
   * @description Lists pull requests in a repository, optionally filtered by state. Aggregates results across paginated responses.
   * @route GET /list-pull-requests
   * @operationName List Pull Requests
   * @category Pull Requests
   * @appearanceColor #0052cc #2684ff
   *
   * @paramDef {"type":"String","label":"Repository","name":"repo_slug","required":true,"description":"Repository slug.","dictionary":"getRepositoriesDictionary"}
   * @paramDef {"type":"String","label":"State","name":"state","description":"Filter by pull request state.","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Merged","Declined","Superseded"]}}}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":1,"title":"Add feature","state":"OPEN","source":{"branch":{"name":"feature"}},"destination":{"branch":{"name":"main"}}}]
   */
  async listPullRequests(repo_slug, state) {
    const query = this.#cleanObject({
      state: this.#resolveChoice(state, {
        Open: 'OPEN',
        Merged: 'MERGED',
        Declined: 'DECLINED',
        Superseded: 'SUPERSEDED',
      }),
      pagelen: 50,
    })

    return await this.#paginate({
      url: `${ API_BASE_URL }/repositories/${ this.workspace }/${ repo_slug }/pullrequests`,
      query,
      logTag: 'listPullRequests',
    })
  }

  /**
   * @description Updates an existing pull request. Only the fields you provide are changed.
   * @route PUT /update-pull-request
   * @operationName Update Pull Request
   * @category Pull Requests
   * @appearanceColor #0052cc #2684ff
   *
   * @paramDef {"type":"String","label":"Repository","name":"repo_slug","required":true,"description":"Repository slug.","dictionary":"getRepositoriesDictionary"}
   * @paramDef {"type":"String","label":"Pull Request ID","name":"pull_request_id","required":true,"description":"Numeric ID of the pull request."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New pull request title."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"New pull request description in Markdown.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Destination Branch","name":"destination_branch","description":"New destination branch name.","dictionary":"getBranchesDictionary","dependsOn":["repo_slug"]}
   * @paramDef {"type":"Boolean","label":"Close Source Branch","name":"close_source_branch","description":"Close the source branch when the pull request merges.","uiComponent":{"type":"CHECKBOX"}}
   *
   * @returns {Object}
   * @sampleResult {"id":1,"title":"Updated title","state":"OPEN","destination":{"branch":{"name":"develop"}}}
   */
  async updatePullRequest(repo_slug, pull_request_id, title, description, destination_branch, close_source_branch) {
    const body = this.#cleanObject({
      title,
      description,
      destination: destination_branch ? { branch: { name: destination_branch } } : undefined,
      close_source_branch: close_source_branch === undefined ? undefined : Boolean(close_source_branch),
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repositories/${ this.workspace }/${ repo_slug }/pullrequests/${ pull_request_id }`,
      method: 'put',
      body,
      logTag: 'updatePullRequest',
    })
  }

  /**
   * @description Approves a pull request on behalf of the authenticated user.
   * @route POST /approve-pull-request
   * @operationName Approve Pull Request
   * @category Pull Requests
   * @appearanceColor #0052cc #2684ff
   *
   * @paramDef {"type":"String","label":"Repository","name":"repo_slug","required":true,"description":"Repository slug.","dictionary":"getRepositoriesDictionary"}
   * @paramDef {"type":"String","label":"Pull Request ID","name":"pull_request_id","required":true,"description":"Numeric ID of the pull request."}
   *
   * @returns {Object}
   * @sampleResult {"approved":true,"state":"approved","user":{"display_name":"Jane"}}
   */
  async approvePullRequest(repo_slug, pull_request_id) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repositories/${ this.workspace }/${ repo_slug }/pullrequests/${ pull_request_id }/approve`,
      method: 'post',
      logTag: 'approvePullRequest',
    })
  }

  /**
   * @description Removes the authenticated user's approval from a pull request.
   * @route DELETE /unapprove-pull-request
   * @operationName Unapprove Pull Request
   * @category Pull Requests
   * @appearanceColor #0052cc #2684ff
   *
   * @paramDef {"type":"String","label":"Repository","name":"repo_slug","required":true,"description":"Repository slug.","dictionary":"getRepositoriesDictionary"}
   * @paramDef {"type":"String","label":"Pull Request ID","name":"pull_request_id","required":true,"description":"Numeric ID of the pull request."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async unapprovePullRequest(repo_slug, pull_request_id) {
    await this.#apiRequest({
      url: `${ API_BASE_URL }/repositories/${ this.workspace }/${ repo_slug }/pullrequests/${ pull_request_id }/approve`,
      method: 'delete',
      logTag: 'unapprovePullRequest',
    })

    return { success: true }
  }

  /**
   * @description Merges a pull request into its destination branch using the selected merge strategy. Optionally sets a commit message and closes the source branch.
   * @route POST /merge-pull-request
   * @operationName Merge Pull Request
   * @category Pull Requests
   * @appearanceColor #0052cc #2684ff
   *
   * @paramDef {"type":"String","label":"Repository","name":"repo_slug","required":true,"description":"Repository slug.","dictionary":"getRepositoriesDictionary"}
   * @paramDef {"type":"String","label":"Pull Request ID","name":"pull_request_id","required":true,"description":"Numeric ID of the pull request."}
   * @paramDef {"type":"String","label":"Merge Strategy","name":"merge_strategy","description":"Strategy used to merge the pull request.","uiComponent":{"type":"DROPDOWN","options":{"values":["Merge Commit","Squash","Fast Forward"]}}}
   * @paramDef {"type":"String","label":"Message","name":"message","description":"Commit message for the merge commit.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"Boolean","label":"Close Source Branch","name":"close_source_branch","description":"Close the source branch after merging.","uiComponent":{"type":"CHECKBOX"}}
   *
   * @returns {Object}
   * @sampleResult {"id":1,"title":"Add feature","state":"MERGED","merge_commit":{"hash":"a1b2c3d"}}
   */
  async mergePullRequest(repo_slug, pull_request_id, merge_strategy, message, close_source_branch) {
    const body = this.#cleanObject({
      merge_strategy: this.#resolveChoice(merge_strategy, {
        'Merge Commit': 'merge_commit',
        Squash: 'squash',
        'Fast Forward': 'fast_forward',
      }),
      message,
      close_source_branch: close_source_branch === undefined ? undefined : Boolean(close_source_branch),
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repositories/${ this.workspace }/${ repo_slug }/pullrequests/${ pull_request_id }/merge`,
      method: 'post',
      body,
      logTag: 'mergePullRequest',
    })
  }

  /**
   * @description Declines (rejects) an open pull request without merging it.
   * @route POST /decline-pull-request
   * @operationName Decline Pull Request
   * @category Pull Requests
   * @appearanceColor #0052cc #2684ff
   *
   * @paramDef {"type":"String","label":"Repository","name":"repo_slug","required":true,"description":"Repository slug.","dictionary":"getRepositoriesDictionary"}
   * @paramDef {"type":"String","label":"Pull Request ID","name":"pull_request_id","required":true,"description":"Numeric ID of the pull request."}
   *
   * @returns {Object}
   * @sampleResult {"id":1,"title":"Add feature","state":"DECLINED"}
   */
  async declinePullRequest(repo_slug, pull_request_id) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repositories/${ this.workspace }/${ repo_slug }/pullrequests/${ pull_request_id }/decline`,
      method: 'post',
      logTag: 'declinePullRequest',
    })
  }

  /**
   * @description Adds a comment to a pull request. Comments are rendered as Markdown.
   * @route POST /add-pull-request-comment
   * @operationName Add Pull Request Comment
   * @category Pull Requests
   * @appearanceColor #0052cc #2684ff
   *
   * @paramDef {"type":"String","label":"Repository","name":"repo_slug","required":true,"description":"Repository slug.","dictionary":"getRepositoriesDictionary"}
   * @paramDef {"type":"String","label":"Pull Request ID","name":"pull_request_id","required":true,"description":"Numeric ID of the pull request."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"description":"Comment body in Markdown.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   *
   * @returns {Object}
   * @sampleResult {"id":10,"content":{"raw":"Looks good"},"user":{"display_name":"Jane"},"created_on":"2024-01-01T12:00:00Z"}
   */
  async addPullRequestComment(repo_slug, pull_request_id, content) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repositories/${ this.workspace }/${ repo_slug }/pullrequests/${ pull_request_id }/comments`,
      method: 'post',
      body: { content: { raw: content } },
      logTag: 'addPullRequestComment',
    })
  }

  // ======================================== SOURCE ========================================

  /**
   * @description Retrieves the raw contents of a file at a given commit or branch. The commit reference can be a branch name (e.g. main), a tag, or a full commit hash.
   * @route GET /get-file
   * @operationName Get File
   * @category Source
   * @appearanceColor #0052cc #2684ff
   *
   * @paramDef {"type":"String","label":"Repository","name":"repo_slug","required":true,"description":"Repository slug.","dictionary":"getRepositoriesDictionary"}
   * @paramDef {"type":"String","label":"Commit or Branch","name":"commit","required":true,"description":"Commit hash, tag, or branch name (e.g. main).","dictionary":"getBranchesDictionary","dependsOn":["repo_slug"]}
   * @paramDef {"type":"String","label":"File Path","name":"path","required":true,"description":"Path to the file within the repository, e.g. src/index.js."}
   *
   * @returns {Object}
   * @sampleResult {"path":"src/index.js","commit":"main","content":"console.log('hello')"}
   */
  async getFile(repo_slug, commit, path) {
    const cleanPath = String(path).replace(/^\/+/, '')

    const raw = await this.#apiRequest({
      url: `${ API_BASE_URL }/repositories/${ this.workspace }/${ repo_slug }/src/${ encodeURIComponent(commit) }/${ cleanPath }`,
      logTag: 'getFile',
    })

    const content = typeof raw === 'string' ? raw : (raw != null ? String(raw) : '')

    return { path: cleanPath, commit, content }
  }

  /**
   * @description Lists the contents of a directory in a repository at a given commit or branch. Returns files and subdirectories. Aggregates results across paginated responses.
   * @route GET /list-directory
   * @operationName List Directory
   * @category Source
   * @appearanceColor #0052cc #2684ff
   *
   * @paramDef {"type":"String","label":"Repository","name":"repo_slug","required":true,"description":"Repository slug.","dictionary":"getRepositoriesDictionary"}
   * @paramDef {"type":"String","label":"Commit or Branch","name":"commit","required":true,"description":"Commit hash, tag, or branch name (e.g. main).","dictionary":"getBranchesDictionary","dependsOn":["repo_slug"]}
   * @paramDef {"type":"String","label":"Directory Path","name":"path","description":"Path to the directory within the repository. Leave empty for the repository root."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"type":"commit_file","path":"src/index.js","size":1024},{"type":"commit_directory","path":"src/lib"}]
   */
  async listDirectory(repo_slug, commit, path) {
    const cleanPath = path ? `${ String(path).replace(/^\/+/, '').replace(/\/+$/, '') }/` : ''

    return await this.#paginate({
      url: `${ API_BASE_URL }/repositories/${ this.workspace }/${ repo_slug }/src/${ encodeURIComponent(commit) }/${ cleanPath }`,
      query: { pagelen: 100 },
      logTag: 'listDirectory',
    })
  }

  /**
   * @description Creates or updates a file in a repository and commits the change to a branch. If the file exists it is overwritten; otherwise it is created. The commit is pushed to the specified branch.
   * @route POST /create-or-update-file
   * @operationName Create or Update File
   * @category Source
   * @appearanceColor #0052cc #2684ff
   *
   * @paramDef {"type":"String","label":"Repository","name":"repo_slug","required":true,"description":"Repository slug.","dictionary":"getRepositoriesDictionary"}
   * @paramDef {"type":"String","label":"File Path","name":"path","required":true,"description":"Path to the file within the repository, e.g. docs/README.md."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"description":"New file content.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Commit Message","name":"message","required":true,"description":"Commit message for the change."}
   * @paramDef {"type":"String","label":"Branch","name":"branch","required":true,"description":"Branch to commit to.","dictionary":"getBranchesDictionary","dependsOn":["repo_slug"]}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"path":"docs/README.md","branch":"main","message":"Update README"}
   */
  async createOrUpdateFile(repo_slug, path, content, message, branch) {
    const cleanPath = String(path).replace(/^\/+/, '')

    const formData = new Flowrunner.Request.FormData()
    formData.append('message', message)
    formData.append('branch', branch)
    // The file path is used as the form field name; its value is the file content.
    formData.append(cleanPath, content)

    try {
      logger.debug(`createOrUpdateFile - [POST::/src] ${ cleanPath } @ ${ branch }`)

      await Flowrunner.Request.post(`${ API_BASE_URL }/repositories/${ this.workspace }/${ repo_slug }/src`)
        .set(this.#authHeader())
        .form(formData)
    } catch (error) {
      logger.error('createOrUpdateFile - failed:', JSON.stringify(error?.body || error?.message || error))
      this.#handleError(error)
    }

    return { success: true, path: cleanPath, branch, message }
  }

  /**
   * @description Lists commits in a repository, optionally starting from a specific branch, tag, or commit. Aggregates results across paginated responses.
   * @route GET /list-commits
   * @operationName List Commits
   * @category Source
   * @appearanceColor #0052cc #2684ff
   *
   * @paramDef {"type":"String","label":"Repository","name":"repo_slug","required":true,"description":"Repository slug.","dictionary":"getRepositoriesDictionary"}
   * @paramDef {"type":"String","label":"Commit or Branch","name":"revision","description":"Branch name, tag, or commit hash to start listing from. Defaults to the main branch.","dictionary":"getBranchesDictionary","dependsOn":["repo_slug"]}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"hash":"a1b2c3d","message":"Fix bug","author":{"raw":"Jane <jane@example.com>"},"date":"2024-01-01T12:00:00Z"}]
   */
  async listCommits(repo_slug, revision) {
    const suffix = revision ? `/${ encodeURIComponent(revision) }` : ''

    return await this.#paginate({
      url: `${ API_BASE_URL }/repositories/${ this.workspace }/${ repo_slug }/commits${ suffix }`,
      query: { pagelen: 50 },
      logTag: 'listCommits',
    })
  }

  // ======================================== BRANCHES ========================================

  /**
   * @description Lists branches in a repository. Aggregates results across paginated responses.
   * @route GET /list-branches
   * @operationName List Branches
   * @category Branches
   * @appearanceColor #0052cc #2684ff
   *
   * @paramDef {"type":"String","label":"Repository","name":"repo_slug","required":true,"description":"Repository slug.","dictionary":"getRepositoriesDictionary"}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"name":"main","type":"branch","target":{"hash":"a1b2c3d"}}]
   */
  async listBranches(repo_slug) {
    return await this.#paginate({
      url: `${ API_BASE_URL }/repositories/${ this.workspace }/${ repo_slug }/refs/branches`,
      query: { pagelen: 100 },
      logTag: 'listBranches',
    })
  }

  /**
   * @description Creates a new branch pointing at a target commit hash. The target must be an existing commit in the repository.
   * @route POST /create-branch
   * @operationName Create Branch
   * @category Branches
   * @appearanceColor #0052cc #2684ff
   *
   * @paramDef {"type":"String","label":"Repository","name":"repo_slug","required":true,"description":"Repository slug.","dictionary":"getRepositoriesDictionary"}
   * @paramDef {"type":"String","label":"Branch Name","name":"name","required":true,"description":"Name of the new branch."}
   * @paramDef {"type":"String","label":"Target Hash","name":"target_hash","required":true,"description":"Commit hash the new branch should point at."}
   *
   * @returns {Object}
   * @sampleResult {"name":"feature/new","type":"branch","target":{"hash":"a1b2c3d"}}
   */
  async createBranch(repo_slug, name, target_hash) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repositories/${ this.workspace }/${ repo_slug }/refs/branches`,
      method: 'post',
      body: { name, target: { hash: target_hash } },
      logTag: 'createBranch',
    })
  }

  /**
   * @description Deletes a branch from a repository. This action is permanent.
   * @route DELETE /delete-branch
   * @operationName Delete Branch
   * @category Branches
   * @appearanceColor #0052cc #2684ff
   *
   * @paramDef {"type":"String","label":"Repository","name":"repo_slug","required":true,"description":"Repository slug.","dictionary":"getRepositoriesDictionary"}
   * @paramDef {"type":"String","label":"Branch Name","name":"name","required":true,"description":"Name of the branch to delete.","dictionary":"getBranchesDictionary","dependsOn":["repo_slug"]}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"name":"feature/old"}
   */
  async deleteBranch(repo_slug, name) {
    await this.#apiRequest({
      url: `${ API_BASE_URL }/repositories/${ this.workspace }/${ repo_slug }/refs/branches/${ encodeURIComponent(name) }`,
      method: 'delete',
      logTag: 'deleteBranch',
    })

    return { success: true, name }
  }

  // ======================================== PIPELINES ========================================

  /**
   * @description Lists pipeline runs for a repository. Pipelines must be enabled for the repository. Aggregates results across paginated responses.
   * @route GET /list-pipelines
   * @operationName List Pipelines
   * @category Pipelines
   * @appearanceColor #0052cc #2684ff
   *
   * @paramDef {"type":"String","label":"Repository","name":"repo_slug","required":true,"description":"Repository slug. Pipelines must be enabled for this repository.","dictionary":"getRepositoriesDictionary"}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"uuid":"{abc}","build_number":42,"state":{"name":"COMPLETED","result":{"name":"SUCCESSFUL"}}}]
   */
  async listPipelines(repo_slug) {
    return await this.#paginate({
      url: `${ API_BASE_URL }/repositories/${ this.workspace }/${ repo_slug }/pipelines`,
      query: { pagelen: 30, sort: '-created_on' },
      logTag: 'listPipelines',
    })
  }

  /**
   * @description Triggers a new pipeline run for a branch. Pipelines must be enabled and a bitbucket-pipelines.yml must be present on the branch.
   * @route POST /trigger-pipeline
   * @operationName Trigger Pipeline
   * @category Pipelines
   * @appearanceColor #0052cc #2684ff
   *
   * @paramDef {"type":"String","label":"Repository","name":"repo_slug","required":true,"description":"Repository slug. Pipelines must be enabled for this repository.","dictionary":"getRepositoriesDictionary"}
   * @paramDef {"type":"String","label":"Branch","name":"branch","required":true,"description":"Branch to run the pipeline on.","dictionary":"getBranchesDictionary","dependsOn":["repo_slug"]}
   *
   * @returns {Object}
   * @sampleResult {"uuid":"{abc}","build_number":43,"state":{"name":"PENDING"},"target":{"ref_name":"main","ref_type":"branch"}}
   */
  async triggerPipeline(repo_slug, branch) {
    const body = {
      target: {
        ref_type: 'branch',
        type: 'pipeline_ref_target',
        ref_name: branch,
      },
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repositories/${ this.workspace }/${ repo_slug }/pipelines`,
      method: 'post',
      body,
      logTag: 'triggerPipeline',
    })
  }

  /**
   * @description Retrieves a single pipeline run by its UUID, including its state and result.
   * @route GET /get-pipeline
   * @operationName Get Pipeline
   * @category Pipelines
   * @appearanceColor #0052cc #2684ff
   *
   * @paramDef {"type":"String","label":"Repository","name":"repo_slug","required":true,"description":"Repository slug.","dictionary":"getRepositoriesDictionary"}
   * @paramDef {"type":"String","label":"Pipeline UUID","name":"pipeline_uuid","required":true,"description":"UUID of the pipeline, e.g. {abc-123}."}
   *
   * @returns {Object}
   * @sampleResult {"uuid":"{abc}","build_number":42,"state":{"name":"COMPLETED","result":{"name":"SUCCESSFUL"}}}
   */
  async getPipeline(repo_slug, pipeline_uuid) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repositories/${ this.workspace }/${ repo_slug }/pipelines/${ encodeURIComponent(pipeline_uuid) }`,
      logTag: 'getPipeline',
    })
  }

  /**
   * @description Stops a running pipeline by its UUID. Stopping is asynchronous; the pipeline moves to a stopped state shortly after.
   * @route POST /stop-pipeline
   * @operationName Stop Pipeline
   * @category Pipelines
   * @appearanceColor #0052cc #2684ff
   *
   * @paramDef {"type":"String","label":"Repository","name":"repo_slug","required":true,"description":"Repository slug.","dictionary":"getRepositoriesDictionary"}
   * @paramDef {"type":"String","label":"Pipeline UUID","name":"pipeline_uuid","required":true,"description":"UUID of the pipeline to stop, e.g. {abc-123}."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"pipeline_uuid":"{abc}"}
   */
  async stopPipeline(repo_slug, pipeline_uuid) {
    await this.#apiRequest({
      url: `${ API_BASE_URL }/repositories/${ this.workspace }/${ repo_slug }/pipelines/${ encodeURIComponent(pipeline_uuid) }/stopPipeline`,
      method: 'post',
      logTag: 'stopPipeline',
    })

    return { success: true, pipeline_uuid }
  }
}

Flowrunner.ServerCode.addService(Bitbucket, [
  {
    name: 'email',
    displayName: 'Account Email',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Atlassian account email address. Used with the API token for Basic authentication.',
  },
  {
    name: 'apiToken',
    displayName: 'API Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'An Atlassian API token created at id.atlassian.com > Security > API tokens. App Passwords are deprecated; use an API token scoped for repository, pull request, issue, and pipeline access.',
  },
  {
    name: 'workspace',
    displayName: 'Workspace ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your workspace ID, taken from the URL bitbucket.org/{workspace}.',
  },
])
