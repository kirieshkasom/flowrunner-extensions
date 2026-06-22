'use strict'

const API_BASE_URL = 'https://api.github.com'
const OAUTH_URL = 'https://github.com/login/oauth/authorize'
const TOKEN_URL = 'https://github.com/login/oauth/access_token'

const logger = {
  info: (...args) => console.log('[GitHub Service] info:', ...args),
  debug: (...args) => console.log('[GitHub Service] debug:', ...args),
  error: (...args) => console.log('[GitHub Service] error:', ...args),
  warn: (...args) => console.log('[GitHub Service] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName GitHub
 * @integrationIcon /icon.png
 * @integrationTriggersScope SINGLE_APP
 */
class GitHub {
  constructor(config) {
    this.config = config || {}
    this.clientId = this.config.clientId
    this.clientSecret = this.config.clientSecret
  }

  #getAccessToken() {
    return this.request.headers['oauth-access-token']
  }

  #getAuthorizationHeader() {
    return {
      Authorization: `Bearer ${ this.#getAccessToken() }`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'FlowRunner-GitHub-Extension',
    }
  }

  #handleError(error) {
    // GitHub puts its error payload on error.body. Flowrunner can set error.message to an empty
    // object for body-less responses (e.g. a 404 on DELETE), so only trust string messages —
    // otherwise the message renders as "[object Object]".
    const bodyMessage = typeof error?.body?.message === 'string' ? error.body.message : null
    const errMessage = typeof error?.message === 'string' ? error.message : null
    let message = bodyMessage || errMessage || `request failed${ error?.status ? ` (HTTP ${ error.status })` : '' }`

    if (error?.body?.errors && Array.isArray(error.body.errors)) {
      const details = error.body.errors.map(e => {
        if (e.message) return e.message

        return `${ e.resource } ${ e.code }${ e.field ? ` (field: ${ e.field })` : '' }`
      }).join(', ')
      message = `${ message }: ${ details }`
    }

    // Preserve status and body so callers can branch on them — e.g. the find* methods return
    // null on a 404 rather than throwing.
    const wrapped = new Error(`GitHub API error: ${ message }`)
    wrapped.status = error?.status
    wrapped.body = error?.body
    throw wrapped
  }

  async #apiRequest({ url, method = 'get', body, query }) {
    try {
      logger.debug(`[#apiRequest] ${ method.toUpperCase() } ${ url }`)

      return await Flowrunner.Request[method](url)
        .set(this.#getAuthorizationHeader())
        .set({ 'Content-Type': 'application/json' })
        .query(query)
        .send(body)
    } catch (error) {
      logger.error('[#apiRequest] Error:', JSON.stringify(error, null, 2))
      this.#handleError(error)
    }
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
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // ======================================== OAUTH SYSTEM METHODS ========================================

  /**
     * @registerAs SYSTEM
     * @route GET /getOAuth2ConnectionURL
     * @returns {String}
     */
  async getOAuth2ConnectionURL() {
    // redirect_uri is injected by the Flowrunner OAuth runtime — the service must NOT add it.
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('scope', 'repo delete_repo user admin:org read:org gist notifications')

    return `${ OAUTH_URL }?${ params.toString() }`
  }

  /**
     * @typedef {Object} executeCallback_ResultObject
     * @property {String} token - The access token
     * @property {String} [refreshToken] - The refresh token (GitHub doesn't provide refresh tokens)
     * @property {Number} expirationInSeconds - Token expiration time in seconds
     * @property {String} connectionIdentityName - User's display name
     * @property {String} [connectionIdentityImageURL] - User's profile picture URL
     * @property {Boolean} overwrite - Whether to overwrite existing connection
     * @property {Object} userData - Complete user data from GitHub
     */

  /**
     * @registerAs SYSTEM
     * @route POST /executeCallback
     * @param {Object} callbackObject
     * @returns {executeCallback_ResultObject}
     */
  async executeCallback(callbackObject) {
    try {
      // Exchange authorization code for access token
      const tokenResponse = await Flowrunner.Request.post(TOKEN_URL)
        .set({
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'FlowRunner-GitHub-Extension',
        })
        .send({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code: callbackObject.code,
          redirect_uri: callbackObject.redirectURI,
        })

      // Get user information
      const userResponse = await Flowrunner.Request.get(`${ API_BASE_URL }/user`)
        .set({
          Authorization: `Bearer ${ tokenResponse.access_token }`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'FlowRunner-GitHub-Extension',
        })

      return {
        token: tokenResponse.access_token,
        refreshToken: null,
        expirationInSeconds: 0,
        connectionIdentityName: userResponse.name || userResponse.login || 'GitHub User',
        connectionIdentityImageURL: userResponse.avatar_url,
        overwrite: true,
        userData: userResponse,
      }
    } catch (error) {
      logger.error('OAuth callback execution failed:', error)
      throw new Error(`OAuth callback execution failed: ${ error.message }`)
    }
  }

  /**
      * @registerAs SYSTEM
      * @route POST /refreshToken
      * @returns {Object}
      */
  async refreshToken() {
    // GitHub OAuth App user access tokens do not expire and no refresh token is issued
    // (executeCallback returns refreshToken: null, expirationInSeconds: 0). There is nothing
    // to refresh, so return the existing stored token unchanged.
    const token = this.#getAccessToken()

    if (!token) {
      throw new Error('No access token available')
    }

    return {
      token,
      refreshToken: null,
      expirationInSeconds: 0,
    }
  }

  /**
      * Parse repository parameter - handles both string "owner/repo" and object {owner, repo} formats
      * @private
      * @param {string|object} repository - Either "owner/repo" string or {owner, repo} object  
      * @returns {{owner: string|null, repo: string|null}}
      */
  #parseRepository(repository) {
    if (!repository) {
      return { owner: null, repo: null }
    }

    // If it's an object with owner/repo properties (backward compatibility)
    if (typeof repository === 'object' && repository.owner && repository.repo) {
      return { owner: repository.owner, repo: repository.repo }
    }

    // If it's a string in "owner/repo" format
    if (typeof repository === 'string') {
      // Split by '/', filter out empty strings (handles trailing slashes), take first 2
      const parts = repository.split('/').filter(part => part.trim())
      const [owner, repo] = parts

      return { owner: owner || null, repo: repo || null }
    }

    return { owner: null, repo: null }
  }

  // ======================================== TRIGGER SYSTEM METHOD ========================================
  /**
     * @registerAs SYSTEM
     * @param {Object} invocation
     * @returns {Object}
     */
  async handleTriggerPollingForEvent(invocation) {
    return this[invocation.eventName](invocation)
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
     * @registerAs DICTIONARY
     * @operationName Get Repositories
     * @category Repositories
     * @description Retrieves all repositories accessible to the authenticated user
     * @route POST /get-repositories-dictionary
     * @param {DictionaryPayload} payload
     * @returns {DictionaryResponse}
     * @sampleResult {"cursor":null,"items":[{"label":"my-repo","value":"my-repo","note":"ID: 123456"}]}
     */
  async getRepositoriesDictionary({ search, cursor }) {
    const page = cursor ? parseInt(cursor) : 1
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/user/repos`,
      query: { per_page: 100, page, sort: 'updated' },
    })

    let repos = response || []

    if (search) {
      const searchLower = search.toLowerCase()

      repos = repos.filter(repo =>
        repo.name.toLowerCase().includes(searchLower) ||
                repo.full_name.toLowerCase().includes(searchLower)
      )
    }

    return {
      items: repos.map(repo => ({
        label: repo.full_name,
        value: repo.full_name, // Must return "owner/repo" format for parsing
        note: `Owner: ${ repo.owner.login }`,
      })),
      cursor: repos.length === 100 ? String(page + 1) : null,
    }
  }

  /**
     * @typedef {Object} getBranchesDictionary__payloadCriteria
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     */

  /**
     * @typedef {Object} getBranchesDictionary__payload
     * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter branches by name"}
     * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor"}
     * @paramDef {"type":"getBranchesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Repository information"}
     */

  /**
     * @registerAs DICTIONARY
     * @operationName Get Branches
     * @category Repositories
     * @description Retrieves all branches from a repository
     * @route POST /get-branches-dictionary
     * @param {getBranchesDictionary__payload} payload
     * @returns {DictionaryResponse}
     * @sampleResult {"cursor":null,"items":[{"label":"main","value":"main","note":"Protected: true"}]}
     */
  async getBranchesDictionary({ search, cursor, criteria }) {
    const { owner, repo } = this.#parseRepository(criteria?.repository)
    const page = cursor ? parseInt(cursor) : 1

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/branches`,
      query: { per_page: 100, page },
    })

    let branches = response || []

    if (search) {
      const searchLower = search.toLowerCase()
      branches = branches.filter(branch => branch.name.toLowerCase().includes(searchLower))
    }

    return {
      items: branches.map(branch => ({
        label: branch.name,
        value: branch.name,
        note: `Protected: ${ branch.protected }`,
      })),
      cursor: branches.length === 100 ? String(page + 1) : null,
    }
  }

  /**
     * @typedef {Object} getLabelsDictionary__payloadCriteria
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     */

  /**
     * @typedef {Object} getLabelsDictionary__payload
     * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter labels by name"}
     * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor"}
     * @paramDef {"type":"getLabelsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Repository information"}
     */

  /**
     * @registerAs DICTIONARY
     * @operationName Get Labels
     * @category Issues
     * @description Retrieves all labels from a repository
     * @route POST /get-labels-dictionary
     * @param {getLabelsDictionary__payload} payload
     * @returns {DictionaryResponse}
     * @sampleResult {"cursor":null,"items":[{"label":"bug","value":"bug","note":"Color: #d73a4a"}]}
     */
  async getLabelsDictionary({ search, cursor, criteria }) {
    const { owner, repo } = this.#parseRepository(criteria?.repository)
    const page = cursor ? parseInt(cursor) : 1

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/labels`,
      query: { per_page: 100, page },
    })

    let labels = response || []

    if (search) {
      const searchLower = search.toLowerCase()
      labels = labels.filter(label => label.name.toLowerCase().includes(searchLower))
    }

    return {
      items: labels.map(label => ({
        label: label.name,
        value: label.name,
        note: `Color: #${ label.color }`,
      })),
      cursor: labels.length === 100 ? String(page + 1) : null,
    }
  }

  /**
     * @typedef {Object} getMilestonesDictionary__payloadCriteria
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     */

  /**
     * @typedef {Object} getMilestonesDictionary__payload
     * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter milestones by title"}
     * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor"}
     * @paramDef {"type":"getMilestonesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Repository information"}
     */

  /**
     * @registerAs DICTIONARY
     * @operationName Get Milestones
     * @category Issues
     * @description Retrieves all milestones from a repository
     * @route POST /get-milestones-dictionary
     * @param {getMilestonesDictionary__payload} payload
     * @returns {DictionaryResponse}
     * @sampleResult {"cursor":null,"items":[{"label":"v1.0","value":"1","note":"Due: 2024-12-31"}]}
     */
  async getMilestonesDictionary({ search, cursor, criteria }) {
    const { owner, repo } = this.#parseRepository(criteria?.repository)
    const page = cursor ? parseInt(cursor) : 1

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/milestones`,
      query: { per_page: 100, page, state: 'all' },
    })

    let milestones = response || []

    if (search) {
      const searchLower = search.toLowerCase()
      milestones = milestones.filter(ms => ms.title.toLowerCase().includes(searchLower))
    }

    return {
      items: milestones.map(ms => ({
        label: ms.title,
        value: String(ms.number),
        note: `Due: ${ ms.due_on || 'No due date' }`,
      })),
      cursor: milestones.length === 100 ? String(page + 1) : null,
    }
  }

  /**
     * @registerAs DICTIONARY
     * @operationName Get Users
     * @category Users
     * @description Retrieves GitHub users for assignee selection
     * @route POST /get-users-dictionary
     * @param {DictionaryPayload} payload
     * @returns {DictionaryResponse}
     * @sampleResult {"cursor":null,"items":[{"label":"octocat","value":"octocat","note":"ID: 1"}]}
     */
  async getUsersDictionary({ search, cursor }) {
    if (!search) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/search/users`,
      query: { q: search, per_page: 50 },
    })

    const users = response.items || []

    return {
      items: users.map(user => ({
        label: user.login,
        value: user.login,
        note: `ID: ${ user.id }`,
      })),
      cursor: null,
    }
  }

  /**
     * @registerAs DICTIONARY
     * @operationName Get Organizations
     * @category Organizations
     * @description Retrieves organizations the user belongs to
     * @route POST /get-organizations-dictionary
     * @param {DictionaryPayload} payload
     * @returns {DictionaryResponse}
     * @sampleResult {"cursor":null,"items":[{"label":"github","value":"github","note":"ID: 1"}]}
     */
  async getOrganizationsDictionary({ search, cursor }) {
    const page = cursor ? parseInt(cursor) : 1

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/user/orgs`,
      query: { per_page: 100, page },
    })

    let orgs = response || []

    if (search) {
      const searchLower = search.toLowerCase()
      orgs = orgs.filter(org => org.login.toLowerCase().includes(searchLower))
    }

    return {
      items: orgs.map(org => ({
        label: org.login,
        value: org.login,
        note: `ID: ${ org.id }`,
      })),
      cursor: orgs.length === 100 ? String(page + 1) : null,
    }
  }

  /**
     * @registerAs DICTIONARY
     * @operationName Get Owners
     * @category Owners
     * @description Retrieves available repository owners (user + organizations)
     * @route POST /get-owners-dictionary
     * @param {DictionaryPayload} payload
     * @returns {DictionaryResponse}
     * @sampleResult {"cursor":null,"items":[{"label":"octocat (You)","value":"octocat","note":"User"},{"label":"github","value":"github","note":"Organization"}]}
     */
  async getOwnersDictionary({ search, cursor }) {
    // Get all repositories the user has access to
    const repos = await this.#apiRequest({
      url: `${ API_BASE_URL }/user/repos`,
      query: { per_page: 100, affiliation: 'owner,collaborator,organization_member' },
    })

    // Extract unique owners from all accessible repositories
    const ownerMap = new Map()

    for (const repo of repos || []) {
      const owner = repo.owner

      if (!ownerMap.has(owner.login)) {
        ownerMap.set(owner.login, {
          login: owner.login,
          id: owner.id,
          type: owner.type, // 'User' or 'Organization'
        })
      }
    }

    // Convert to array and sort (current user first, then alphabetically)
    const currentUser = await this.#apiRequest({
      url: `${ API_BASE_URL }/user`,
    })

    let owners = Array.from(ownerMap.values())

    // Filter by search if provided
    if (search) {
      const searchLower = search.toLowerCase()
      owners = owners.filter(owner => owner.login.toLowerCase().includes(searchLower))
    }

    // Sort: current user first, then alphabetically
    owners.sort((a, b) => {
      if (a.login === currentUser.login) return -1
      if (b.login === currentUser.login) return 1

      return a.login.localeCompare(b.login)
    })

    return {
      items: owners.map(owner => ({
        label: owner.login === currentUser.login ? `${ owner.login } (You)` : owner.login,
        value: owner.login,
        note: owner.type,
      })),
      cursor: null,
    }
  }

  /**
     * @typedef {Object} getTeamsDictionary__payloadCriteria
     * @paramDef {"type":"String","label":"Organization","name":"org","required":true,"description":"Organization name"}
     */

  /**
     * @typedef {Object} getTeamsDictionary__payload
     * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter teams by name"}
     * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor"}
     * @paramDef {"type":"getTeamsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Organization information"}
     */

  /**
     * @registerAs DICTIONARY
     * @operationName Get Teams
     * @category Organizations
     * @description Retrieves teams from an organization
     * @route POST /get-teams-dictionary
     * @param {getTeamsDictionary__payload} payload
     * @returns {DictionaryResponse}
     * @sampleResult {"cursor":null,"items":[{"label":"developers","value":"developers","note":"ID: 1"}]}
     */
  async getTeamsDictionary({ search, cursor, criteria }) {
    const { org } = criteria
    const page = cursor ? parseInt(cursor) : 1

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/orgs/${ org }/teams`,
      query: { per_page: 100, page },
    })

    let teams = response || []

    if (search) {
      const searchLower = search.toLowerCase()
      teams = teams.filter(team => team.name.toLowerCase().includes(searchLower))
    }

    return {
      items: teams.map(team => ({
        label: team.name,
        value: team.slug,
        note: `ID: ${ team.id }`,
      })),
      cursor: teams.length === 100 ? String(page + 1) : null,
    }
  }

  /**
     * @registerAs DICTIONARY
     * @operationName Get Gists
     * @category Gists
     * @description Retrieves user's gists
     * @route POST /get-gists-dictionary
     * @param {DictionaryPayload} payload
     * @returns {DictionaryResponse}
     * @sampleResult {"cursor":null,"items":[{"label":"example.js","value":"abc123","note":"Created: 2024-01-01"}]}
     */
  async getGistsDictionary({ search, cursor }) {
    const page = cursor ? parseInt(cursor) : 1

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/gists`,
      query: { per_page: 100, page },
    })

    let gists = response || []

    if (search) {
      const searchLower = search.toLowerCase()

      gists = gists.filter(gist =>
        gist.description?.toLowerCase().includes(searchLower) ||
                Object.keys(gist.files || {}).some(f => f.toLowerCase().includes(searchLower))
      )
    }

    return {
      items: gists.map(gist => ({
        label: gist.description || Object.keys(gist.files || {})[0] || 'Unnamed',
        value: gist.id,
        note: `Created: ${ new Date(gist.created_at).toLocaleDateString() }`,
      })),
      cursor: gists.length === 100 ? String(page + 1) : null,
    }
  }

  /**
     * @typedef {Object} getIssuesDictionary__payloadCriteria
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     */

  /**
     * @typedef {Object} getIssuesDictionary__payload
     * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter issues by title"}
     * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor"}
     * @paramDef {"type":"getIssuesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Repository information"}
     */

  /**
     * @registerAs DICTIONARY
     * @operationName Get Issues
     * @category Issues
     * @description Retrieves issues from a repository
     * @route POST /get-issues-dictionary
     * @param {getIssuesDictionary__payload} payload
     * @returns {DictionaryResponse}
     * @sampleResult {"cursor":null,"items":[{"label":"Bug in login","value":"1","note":"State: open"}]}
     */
  async getIssuesDictionary({ search, cursor, criteria }) {
    const { owner, repo } = this.#parseRepository(criteria?.repository)
    const page = cursor ? parseInt(cursor) : 1

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/issues`,
      query: { per_page: 100, page, state: 'all' },
    })

    let issues = response || []

    if (search) {
      const searchLower = search.toLowerCase()
      issues = issues.filter(issue => issue.title.toLowerCase().includes(searchLower))
    }

    return {
      items: issues.map(issue => ({
        label: `#${ issue.number }: ${ issue.title }`,
        value: String(issue.number),
        note: `State: ${ issue.state }`,
      })),
      cursor: issues.length === 100 ? String(page + 1) : null,
    }
  }

  /**
     * @typedef {Object} getPullRequestsDictionary__payloadCriteria
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     */

  /**
     * @typedef {Object} getPullRequestsDictionary__payload
     * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter pull requests by title"}
     * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor"}
     * @paramDef {"type":"getPullRequestsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Repository information"}
     */

  /**
     * @registerAs DICTIONARY
     * @operationName Get Pull Requests
     * @category Pull Requests
     * @description Retrieves pull requests from a repository
     * @route POST /get-pull-requests-dictionary
     * @param {getPullRequestsDictionary__payload} payload
     * @returns {DictionaryResponse}
     * @sampleResult {"cursor":null,"items":[{"label":"Feature: Add login","value":"1","note":"State: open"}]}
     */
  async getPullRequestsDictionary({ search, cursor, criteria }) {
    const { owner, repo } = this.#parseRepository(criteria?.repository)
    const page = cursor ? parseInt(cursor) : 1

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/pulls`,
      query: { per_page: 100, page, state: 'all' },
    })

    let prs = response || []

    if (search) {
      const searchLower = search.toLowerCase()
      prs = prs.filter(pr => pr.title.toLowerCase().includes(searchLower))
    }

    return {
      items: prs.map(pr => ({
        label: `#${ pr.number }: ${ pr.title }`,
        value: String(pr.number),
        note: `State: ${ pr.state }`,
      })),
      cursor: prs.length === 100 ? String(page + 1) : null,
    }
  }

  /**
     * @typedef {Object} getReleasesDictionary__payloadCriteria
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     */

  /**
     * @typedef {Object} getReleasesDictionary__payload
     * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter releases by name or tag"}
     * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor"}
     * @paramDef {"type":"getReleasesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Repository information"}
     */

  /**
     * @registerAs DICTIONARY
     * @operationName Get Releases
     * @category Repositories
     * @description Retrieves releases from a repository
     * @route POST /get-releases-dictionary
     * @param {getReleasesDictionary__payload} payload
     * @returns {DictionaryResponse}
     * @sampleResult {"cursor":null,"items":[{"label":"v1.0.0","value":"1","note":"Tag: v1.0.0"}]}
     */
  async getReleasesDictionary({ search, cursor, criteria }) {
    const { owner, repo } = this.#parseRepository(criteria?.repository)
    const page = cursor ? parseInt(cursor) : 1

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/releases`,
      query: { per_page: 100, page },
    })

    let releases = response || []

    if (search) {
      const searchLower = search.toLowerCase()
      releases = releases.filter(r => (r.name || r.tag_name || '').toLowerCase().includes(searchLower))
    }

    return {
      items: releases.map(r => ({
        label: r.name || r.tag_name,
        value: String(r.id),
        note: `Tag: ${ r.tag_name }`,
      })),
      cursor: releases.length === 100 ? String(page + 1) : null,
    }
  }

  /**
     * @typedef {Object} getWebhooksDictionary__payloadCriteria
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     */

  /**
     * @typedef {Object} getWebhooksDictionary__payload
     * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter webhooks by URL"}
     * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor"}
     * @paramDef {"type":"getWebhooksDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Repository information"}
     */

  /**
     * @registerAs DICTIONARY
     * @operationName Get Webhooks
     * @category Webhooks
     * @description Retrieves webhooks configured on a repository
     * @route POST /get-webhooks-dictionary
     * @param {getWebhooksDictionary__payload} payload
     * @returns {DictionaryResponse}
     * @sampleResult {"cursor":null,"items":[{"label":"https://example.com/webhook","value":"1","note":"Events: push"}]}
     */
  async getWebhooksDictionary({ search, cursor, criteria }) {
    const { owner, repo } = this.#parseRepository(criteria?.repository)
    const page = cursor ? parseInt(cursor) : 1

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/hooks`,
      query: { per_page: 100, page },
    })

    let hooks = response || []

    if (search) {
      const searchLower = search.toLowerCase()
      hooks = hooks.filter(h => (h.config?.url || '').toLowerCase().includes(searchLower))
    }

    return {
      items: hooks.map(h => ({
        label: h.config?.url || h.name,
        value: String(h.id),
        note: `Events: ${ (h.events || []).join(', ') }`,
      })),
      cursor: hooks.length === 100 ? String(page + 1) : null,
    }
  }

  /**
     * @registerAs DICTIONARY
     * @operationName Get Repository IDs
     * @category Repositories
     * @description Retrieves accessible repositories, returning each repository's numeric ID (for environment endpoints)
     * @route POST /get-repository-ids-dictionary
     * @param {DictionaryPayload} payload
     * @returns {DictionaryResponse}
     * @sampleResult {"cursor":null,"items":[{"label":"octocat/Hello-World","value":"1296269","note":"ID: 1296269"}]}
     */
  async getRepositoryIdsDictionary({ search, cursor }) {
    const page = cursor ? parseInt(cursor) : 1

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/user/repos`,
      query: { per_page: 100, page, sort: 'updated' },
    })

    let repos = response || []

    if (search) {
      const searchLower = search.toLowerCase()
      repos = repos.filter(repo => repo.full_name.toLowerCase().includes(searchLower))
    }

    return {
      items: repos.map(repo => ({
        label: repo.full_name,
        value: String(repo.id),
        note: `ID: ${ repo.id }`,
      })),
      cursor: repos.length === 100 ? String(page + 1) : null,
    }
  }

  /**
     * @typedef {Object} getWorkflowsDictionary__payloadCriteria
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     */

  /**
     * @typedef {Object} getWorkflowsDictionary__payload
     * @paramDef {"type":"String","label":"Search","name":"search","description":"Filter workflows by name"}
     * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor"}
     * @paramDef {"type":"getWorkflowsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Repository information"}
     */

  /**
     * @registerAs DICTIONARY
     * @operationName Get Workflows
     * @category Actions
     * @description Retrieves GitHub Actions workflows defined in a repository
     * @route POST /get-workflows-dictionary
     * @param {getWorkflowsDictionary__payload} payload
     * @returns {DictionaryResponse}
     * @sampleResult {"cursor":null,"items":[{"label":"CI","value":"161335","note":"File: .github/workflows/ci.yml"}]}
     */
  async getWorkflowsDictionary({ search, cursor, criteria }) {
    const { owner, repo } = this.#parseRepository(criteria?.repository)
    const page = cursor ? parseInt(cursor) : 1

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/actions/workflows`,
      query: { per_page: 100, page },
    })

    let workflows = response?.workflows || []

    if (search) {
      const searchLower = search.toLowerCase()
      workflows = workflows.filter(workflow => workflow.name.toLowerCase().includes(searchLower))
    }

    return {
      items: workflows.map(workflow => ({
        label: workflow.name,
        value: String(workflow.id),
        note: `File: ${ workflow.path }`,
      })),
      cursor: workflows.length === 100 ? String(page + 1) : null,
    }
  }

  /**
     * @description Retrieves information about the authenticated user
     * @route POST /get-current-user
     * @operationName Get Current User
     * @category User Management
     * @appearanceColor #24292f #57606a
     *
     * @returns {Object}
     * @sampleResult {"login":"octocat","id":1,"avatar_url":"https://github.com/images/error/octocat_happy.gif","name":"The Octocat","company":"GitHub","blog":"https://github.com/blog","location":"San Francisco","email":"octocat@github.com","bio":"There once was...","public_repos":2,"public_gists":1,"followers":20,"following":0}
     */
  async getCurrentUser() {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/user`,
    })
  }

  // ======================================== ACTIONS ========================================

  /**
     * @description Creates a new issue in a repository
     * @route POST /create-issue
     * @operationName Create Issue
     * @category Issues
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Issue title"}
     * @paramDef {"type":"String","label":"Body","name":"body","description":"Issue description","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     * @paramDef {"type":"String","label":"Assignees","name":"assignees","description":"Logins of users to assign to this issue. Pass as comma-separated string.","dictionary":"getUsersDictionary"}
     * @paramDef {"type":"String","label":"Milestone","name":"milestone","description":"The number of the milestone to associate this issue with.","dictionary":"getMilestonesDictionary","dependsOn":["repository"]}
     * @paramDef {"type":"String","label":"Labels","name":"labels","description":"Labels to apply to this issue. Pass as comma-separated string.","dictionary":"getLabelsDictionary","dependsOn":["repository"]}
     *
     * @returns {Object}
     * @sampleResult {"id":1,"number":1347,"title":"Found a bug","body":"I'm having a problem with this.","state":"open","html_url":"https://github.com/owner/repo/issues/1347"}
     */
  async createIssue(repository, title, body, assignees, milestone, labels) {
    const { owner, repo } = this.#parseRepository(repository)

    const requestBody = this.#cleanObject({
      title,
      body,
      assignees: assignees ? assignees.split(',').map(s => s.trim()) : undefined,
      milestone: milestone ? parseInt(milestone) : undefined,
      labels: labels ? labels.split(',').map(s => s.trim()) : undefined,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/issues`,
      method: 'post',
      body: requestBody,
    })
  }

  /**
     * @description Updates an existing issue in a repository
     * @route POST /update-issue
     * @operationName Update Issue
     * @category Issues
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Issue Number","name":"issueNumber","required":true,"description":"The number of the issue to update.","dictionary":"getIssuesDictionary","dependsOn":["repository"]}
     * @paramDef {"type":"String","label":"Title","name":"title","description":"New issue title"}
     * @paramDef {"type":"String","label":"Body","name":"body","description":"New issue description","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     * @paramDef {"type":"String","label":"State","name":"state","description":"State of the issue.","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Closed"]}}}
     * @paramDef {"type":"String","label":"Assignees","name":"assignees","description":"Logins of users to assign to this issue. Pass as comma-separated string.","dictionary":"getUsersDictionary"}
     * @paramDef {"type":"String","label":"Milestone","name":"milestone","description":"The number of the milestone to associate this issue with.","dictionary":"getMilestonesDictionary","dependsOn":["repository"]}
     * @paramDef {"type":"String","label":"Labels","name":"labels","description":"Labels to apply to this issue. Pass as comma-separated string.","dictionary":"getLabelsDictionary","dependsOn":["repository"]}
     *
     * @returns {Object}
     * @sampleResult {"id":1,"number":1347,"title":"Updated title","body":"Updated body.","state":"closed","html_url":"https://github.com/owner/repo/issues/1347"}
     */
  async updateIssue(repository, issueNumber, title, body, state, assignees, milestone, labels) {
    const { owner, repo } = this.#parseRepository(repository)

    const requestBody = this.#cleanObject({
      title,
      body,
      state: this.#resolveChoice(state, { Open: 'open', Closed: 'closed' }),
      assignees: assignees ? assignees.split(',').map(s => s.trim()) : undefined,
      milestone: milestone ? parseInt(milestone) : undefined,
      labels: labels ? labels.split(',').map(s => s.trim()) : undefined,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/issues/${ issueNumber }`,
      method: 'patch',
      body: requestBody,
    })
  }

  /**
     * @description Creates a new comment on an issue or pull request
     * @route POST /create-issue-comment
     * @operationName Create Issue Comment
     * @category Issues
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Issue Number","name":"issueNumber","required":true,"description":"The number of the issue or pull request to comment on.","dictionary":"getIssuesDictionary","dependsOn":["repository"]}
     * @paramDef {"type":"String","label":"Comment Body","name":"body","required":true,"description":"The contents of the comment.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     *
     * @returns {Object}
     * @sampleResult {"id":1,"body":"This is a comment.","user":{"login":"octocat"},"created_at":"2024-01-01T12:00:00Z"}
     */
  async createIssueComment(repository, issueNumber, body) {
    const { owner, repo } = this.#parseRepository(repository)

    const requestBody = { body }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/issues/${ issueNumber }/comments`,
      method: 'post',
      body: requestBody,
    })
  }

  /**
     * @description Creates a new repository for the authenticated user
     * @route POST /create-repository
     * @operationName Create Repository
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the repository."}
     * @paramDef {"type":"String","label":"Description","name":"description","description":"A short description of the repository.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     * @paramDef {"type":"String","label":"Homepage","name":"homepage","description":"A URL with more information about the repository."}
     * @paramDef {"type":"Boolean","label":"Private","name":"private","description":"Whether the repository is private or public. Default: false."}
     * @paramDef {"type":"Boolean","label":"Has Issues","name":"has_issues","description":"Whether issues are enabled. Default: true."}
     * @paramDef {"type":"Boolean","label":"Has Projects","name":"has_projects","description":"Whether projects are enabled. Default: true."}
     * @paramDef {"type":"Boolean","label":"Has Wiki","name":"has_wiki","description":"Whether the wiki is enabled. Default: true."}
     * @paramDef {"type":"String","label":"Visibility","name":"visibility","description":"Can be 'public', 'private', or 'internal'. Default: 'public'.","uiComponent":{"type":"DROPDOWN","options":{"values":["Public","Private","Internal"]}}}
     *
     * @returns {Object}
     * @sampleResult {"id":1296269,"node_id":"MDEwOlJlcG9zaXRvcnkxMjk2MjY5","name":"Hello-World","full_name":"octocat/Hello-World","owner":{"login":"octocat"},"private":false,"html_url":"https://github.com/octocat/Hello-World","description":"This is your first repo!","fork":false,"url":"https://api.github.com/repos/octocat/Hello-World","created_at":"2011-01-26T19:01:12Z","updated_at":"2011-01-26T19:14:43Z","pushed_at":"2011-01-26T19:06:43Z","git_url":"git://github.com/octocat/Hello-World.git","ssh_url":"git@github.com:octocat/Hello-World.git","clone_url":"https://github.com/octocat/Hello-World.git","svn_url":"https://svn.github.com/octocat/Hello-World","homepage":"https://github.com","size":108,"stargazers_count":80,"watchers_count":80,"language":"C","has_issues":true,"has_projects":true,"has_downloads":true,"has_wiki":true,"has_pages":false,"forks_count":4,"mirror_url":null,"open_issues_count":0,"forks":4,"open_issues":0,"watchers":80,"default_branch":"master","permissions":{"admin":true,"push":true,"pull":true}}
     */
  async createRepository(name, description, homepage, isPrivate, has_issues, has_projects, has_wiki, visibility) {
    const requestBody = this.#cleanObject({
      name,
      description,
      homepage,
      private: isPrivate,
      has_issues,
      has_projects,
      has_wiki,
      visibility: this.#resolveChoice(visibility, { Public: 'public', Private: 'private', Internal: 'internal' }),
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/user/repos`,
      method: 'post',
      body: requestBody,
    })
  }

  /**
     * @description Creates a new repository under the specified organization
     * @route POST /create-organization-repository
     * @operationName Create Organization Repository
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Organization","name":"org","required":true,"description":"The organization name.","dictionary":"getOrganizationsDictionary"}
     * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the repository."}
     * @paramDef {"type":"String","label":"Description","name":"description","description":"A short description of the repository.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     * @paramDef {"type":"String","label":"Homepage","name":"homepage","description":"A URL with more information about the repository."}
     * @paramDef {"type":"Boolean","label":"Private","name":"private","description":"Whether the repository is private or public. Default: false."}
     * @paramDef {"type":"Boolean","label":"Has Issues","name":"has_issues","description":"Whether issues are enabled. Default: true."}
     * @paramDef {"type":"Boolean","label":"Has Projects","name":"has_projects","description":"Whether projects are enabled. Default: true."}
     * @paramDef {"type":"Boolean","label":"Has Wiki","name":"has_wiki","description":"Whether the wiki is enabled. Default: true."}
     * @paramDef {"type":"String","label":"Visibility","name":"visibility","description":"Can be 'public', 'private', or 'internal'. Default: 'public'.","uiComponent":{"type":"DROPDOWN","options":{"values":["Public","Private","Internal"]}}}
     *
     * @returns {Object}
     * @sampleResult {"id":1296269,"node_id":"MDEwOlJlcG9zaXRvcnkxMjk2MjY5","name":"Hello-World","full_name":"octocat/Hello-World","owner":{"login":"octocat"},"private":false,"html_url":"https://github.com/octocat/Hello-World","description":"This is your first repo!","fork":false,"url":"https://api.github.com/repos/octocat/Hello-World","created_at":"2011-01-26T19:01:12Z","updated_at":"2011-01-26T19:14:43Z","pushed_at":"2011-01-26T19:06:43Z","git_url":"git://github.com/octocat/Hello-World.git","ssh_url":"git@github.com:octocat/Hello-World.git","clone_url":"https://github.com/octocat/Hello-World.git","svn_url":"https://svn.github.com/octocat/Hello-World","homepage":"https://github.com","size":108,"stargazers_count":80,"watchers_count":80,"language":"C","has_issues":true,"has_projects":true,"has_downloads":true,"has_wiki":true,"has_pages":false,"forks_count":4,"mirror_url":null,"open_issues_count":0,"forks":4,"open_issues":0,"watchers":80,"default_branch":"master","permissions":{"admin":true,"push":true,"pull":true}}
     */
  async createOrganizationRepository(org, name, description, homepage, isPrivate, has_issues, has_projects, has_wiki, visibility) {
    const requestBody = this.#cleanObject({
      name,
      description,
      homepage,
      private: isPrivate,
      has_issues,
      has_projects,
      has_wiki,
      visibility: this.#resolveChoice(visibility, { Public: 'public', Private: 'private', Internal: 'internal' }),
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/orgs/${ org }/repos`,
      method: 'post',
      body: requestBody,
    })
  }

  /**
     * @description Deletes a repository
     * @route POST /delete-repository
     * @operationName Delete Repository
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     *
     * @returns {Object}
     * @sampleResult {}
     */
  async deleteRepository(repository) {
    const { owner, repo } = this.#parseRepository(repository)

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }`,
      method: 'delete',
    })
  }

  /**
     * @description Creates a new pull request
     * @route POST /create-pull-request
     * @operationName Create Pull Request
     * @category Pull Requests
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The title of the pull request."}
     * @paramDef {"type":"String","label":"Head Branch","name":"head","required":true,"description":"The name of the branch where your changes are implemented.","dictionary":"getBranchesDictionary","dependsOn":["repository"]}
     * @paramDef {"type":"String","label":"Base Branch","name":"base","required":true,"description":"The name of the branch you want the changes pulled into.","dictionary":"getBranchesDictionary","dependsOn":["repository"]}
     * @paramDef {"type":"String","label":"Body","name":"body","description":"The contents of the pull request.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     * @paramDef {"type":"Boolean","label":"Draft","name":"draft","description":"Indicates whether the pull request is a draft. Default: false."}
     *
     * @returns {Object}
     * @sampleResult {"id":1,"number":1347,"title":"New feature","body":"Please review this.","state":"open","html_url":"https://github.com/owner/repo/pull/1347"}
     */
  async createPullRequest(repository, title, head, base, body, draft) {
    const { owner, repo } = this.#parseRepository(repository)

    const requestBody = this.#cleanObject({
      title,
      head,
      base,
      body,
      draft,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/pulls`,
      method: 'post',
      body: requestBody,
    })
  }

  /**
     * @description Merges a pull request
     * @route POST /merge-pull-request
     * @operationName Merge Pull Request
     * @category Pull Requests
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Pull Request Number","name":"pullNumber","required":true,"description":"The number of the pull request to merge.","dictionary":"getPullRequestsDictionary","dependsOn":["repository"]}
     * @paramDef {"type":"String","label":"Commit Title","name":"commit_title","description":"Title for the merge commit message."}
     * @paramDef {"type":"String","label":"Commit Message","name":"commit_message","description":"Extra detail to append to the merge commit message.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     * @paramDef {"type":"String","label":"Merge Method","name":"merge_method","description":"Merge method to use.","defaultValue":"merge","uiComponent":{"type":"DROPDOWN","options":{"values":["Merge","Squash","Rebase"]}}}
     *
     * @returns {Object}
     * @sampleResult {"sha":"6dcb09b5b57875f334f61aebed695e2e4193db5e","merged":true,"message":"Pull Request successfully merged"}
     */
  async mergePullRequest(repository, pullNumber, commit_title, commit_message, merge_method) {
    const { owner, repo } = this.#parseRepository(repository)

    const requestBody = this.#cleanObject({
      commit_title,
      commit_message,
      merge_method: this.#resolveChoice(merge_method, { Merge: 'merge', Squash: 'squash', Rebase: 'rebase' }),
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/pulls/${ pullNumber }/merge`,
      method: 'put',
      body: requestBody,
    })
  }

  /**
     * @description Creates a new gist for the authenticated user
     * @route POST /create-gist
     * @operationName Create Gist
     * @category Gists
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Description","name":"description","description":"Description of the gist.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     * @paramDef {"type":"Boolean","label":"Public","name":"public","description":"Whether the gist is public or private. Default: false."}
     * @paramDef {"type":"Object","label":"Files","name":"files","required":true,"freeform":true,"description":"An object of files to create in the gist. The key is the filename and the value is an object with a 'content' property. Example: {\"file1.txt\": {\"content\": \"Hello World\"}}","uiComponent":{"type":"CODE_EDITOR","language":"json"}}
     *
     * @returns {Object}
     * @sampleResult {"id":"aa5a31d61ae5e9bbccbc","description":"A simple hello world","public":true,"files":{"hello.rb":{"filename":"hello.rb","type":"text/plain","language":"Ruby","raw_url":"https://gist.github.com/raw/365370/8c4d2d43d178df44f4c03a7f2ac0ff512853564e/hello.rb","size":16,"content":"hello world!"}},"url":"https://api.github.com/gists/aa5a31d61ae5e9bbccbc","forks_url":"https://api.github.com/gists/aa5a31d61ae5e9bbccbc/forks","commits_url":"https://api.github.com/gists/aa5a31d61ae5e9bbccbc/commits"}
     */
  async createGist(description, isPublic, files) {
    const requestBody = this.#cleanObject({
      description,
      public: isPublic,
      files,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/gists`,
      method: 'post',
      body: requestBody,
    })
  }

  /**
     * @description Deletes a gist
     * @route POST /delete-gist
     * @operationName Delete Gist
     * @category Gists
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Gist ID","name":"gistId","required":true,"description":"The ID of the gist to delete.","dictionary":"getGistsDictionary"}
     *
     * @returns {Object}
     * @sampleResult {}
     */
  async deleteGist(gistId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/gists/${ gistId }`,
      method: 'delete',
    })
  }

  /**
     * @description Creates a new release in a repository
     * @route POST /create-release
     * @operationName Create Release
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Tag Name","name":"tag_name","required":true,"description":"The name of the tag."}
     * @paramDef {"type":"String","label":"Target Commitish","name":"target_commitish","description":"Specifies the commitish value that determines where the Git tag is created from. Can be any branch or commit SHA. Default: the repository's default branch.","dictionary":"getBranchesDictionary","dependsOn":["repository"]}
     * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the release."}
     * @paramDef {"type":"String","label":"Body","name":"body","description":"Text describing the contents of the tag.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     * @paramDef {"type":"Boolean","label":"Draft","name":"draft","description":"Whether to create a draft (unpublished) release. Default: false."}
     * @paramDef {"type":"Boolean","label":"Prerelease","name":"prerelease","description":"Whether to identify the release as a prerelease. Default: false."}
     * @paramDef {"type":"Boolean","label":"Generate Release Notes","name":"generate_release_notes","description":"Whether to automatically generate the name and body for this release. Default: false."}
     *
     * @returns {Object}
     * @sampleResult {"id":1,"tag_name":"v1.0.0","target_commitish":"main","name":"v1.0.0","body":"Description of the release","draft":false,"prerelease":false,"created_at":"2024-01-01T12:00:00Z","published_at":"2024-01-01T12:00:00Z","html_url":"https://github.com/owner/repo/releases/tag/v1.0.0"}
     */
  async createRelease(repository, tag_name, target_commitish, name, body, draft, prerelease, generate_release_notes) {
    const { owner, repo } = this.#parseRepository(repository)

    const requestBody = this.#cleanObject({
      tag_name,
      target_commitish,
      name,
      body,
      draft,
      prerelease,
      generate_release_notes,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/releases`,
      method: 'post',
      body: requestBody,
    })
  }

  /**
     * @description Deletes a release from a repository
     * @route POST /delete-release
     * @operationName Delete Release
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Release ID","name":"release_id","required":true,"description":"The ID of the release to delete.","dictionary":"getReleasesDictionary","dependsOn":["repository"]}
     *
     * @returns {Object}
     * @sampleResult {}
     */
  async deleteRelease(repository, release_id) {
    const { owner, repo } = this.#parseRepository(repository)

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/releases/${ release_id }`,
      method: 'delete',
    })
  }

  /**
     * @description Creates a new branch in a repository
     * @route POST /create-branch
     * @operationName Create Branch
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"New Branch Name","name":"branch","required":true,"description":"The name of the new branch."}
     * @paramDef {"type":"String","label":"Source Branch/SHA","name":"sha","required":true,"description":"The SHA1 value for the commit that the new branch will point to. Can be a branch name or commit SHA.","dictionary":"getBranchesDictionary","dependsOn":["repository"]}
     *
     * @returns {Object}
     * @sampleResult {"ref":"refs/heads/new-branch","node_id":"MDM6UmVmcmVmcy9oZWFkcy9uZXctYnJhbmNo","url":"https://api.github.com/repos/octocat/Hello-World/git/refs/heads/new-branch","object":{"sha":"c5b97d5ae6c19d5c5df71a34c7fbeeda2479ccbc","type":"commit","url":"https://api.github.com/repos/octocat/Hello-World/git/commits/c5b97d5ae6c19d5c5df71a34c7fbeeda2479ccbc"}}
     */
  async createBranch(repository, branch, sha) {
    const { owner, repo } = this.#parseRepository(repository)

    const requestBody = {
      ref: `refs/heads/${ branch }`,
      sha,
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/git/refs`,
      method: 'post',
      body: requestBody,
    })
  }

  /**
     * @description Deletes a branch from a repository
     * @route POST /delete-branch
     * @operationName Delete Branch
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Branch Name","name":"branch","required":true,"description":"The name of the branch to delete.","dictionary":"getBranchesDictionary","dependsOn":["repository"]}
     *
     * @returns {Object}
     * @sampleResult {}
     */
  async deleteBranch(repository, branch) {
    const { owner, repo } = this.#parseRepository(repository)

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/git/refs/heads/${ branch }`,
      method: 'delete',
    })
  }

  /**
     * @description Creates a new file in a repository
     * @route POST /create-file
     * @operationName Create File
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Path","name":"path","required":true,"description":"The path to the file."}
     * @paramDef {"type":"String","label":"Message","name":"message","required":true,"description":"The commit message."}
     * @paramDef {"type":"String","label":"Content","name":"content","required":true,"description":"The new file content, Base64 encoded.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     * @paramDef {"type":"String","label":"Branch","name":"branch","description":"The branch name. Default: the repository's default branch.","defaultValue":"main","dictionary":"getBranchesDictionary","dependsOn":["repository"]}
     *
     * @returns {Object}
     * @sampleResult {"content":{"name":"README.md","path":"README.md","sha":"9d0a391c42947019553579f500a399f264963a26","size":10,"url":"https://api.github.com/repos/octocat/Hello-World/contents/README.md","html_url":"https://github.com/octocat/Hello-World/blob/master/README.md","git_url":"https://api.github.com/repos/octocat/Hello-World/git/blobs/9d0a391c42947019553579f500a399f264963a26","type":"file","_links":{"self":"https://api.github.com/repos/octocat/Hello-World/contents/README.md","git":"https://api.github.com/repos/octocat/Hello-World/git/blobs/9d0a391c42947019553579f500a399f264963a26","html":"https://github.com/octocat/Hello-World/blob/master/README.md"}},"commit":{"sha":"7638417db6d59f3c431d3e1f261cc637155684cd","node_id":"MDY6Q29tbWl0NzYzODQxN2RiNmQ1OWYzYzQzMWQzZTFmMjYxY2M2MzcxNTU2ODRjZA==","url":"https://api.github.com/repos/octocat/Hello-World/git/commits/7638417db6d59f3c431d3e1f261cc637155684cd","html_url":"https://github.com/octocat/Hello-World/commit/7638417db6d59f3c431d3e1f261cc637155684cd","author":{"name":"Octocat","email":"octocat@github.com","date":"2012-03-06T23:06:50Z"},"committer":{"name":"Octocat","email":"octocat@github.com","date":"2012-03-06T23:06:50Z"},"message":"Added README.md","tree":{"sha":"b0b1f3b3a1708573100c9a7b9f3b3a1708573100","url":"https://api.github.com/repos/octocat/Hello-World/git/trees/b0b1f3b3a1708573100c9a7b9f3b3a1708573100"},"parents":[{"sha":"6dcb09b5b57875f334f61aebed695e2e4193db5e","url":"https://api.github.com/repos/octocat/Hello-World/git/commits/6dcb09b5b57875f334f61aebed695e2e4193db5e","html_url":"https://github.com/octocat/Hello-World/commit/6dcb09b5b57875f334f61aebed695e2e4193db5e"}]}}
     */
  async createFile(repository, path, message, content, branch) {
    const { owner, repo } = this.#parseRepository(repository)

    const requestBody = this.#cleanObject({
      message,
      content,
      branch,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/contents/${ path }`,
      method: 'put',
      body: requestBody,
    })
  }

  /**
     * @description Updates an existing file in a repository
     * @route POST /update-file
     * @operationName Update File
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Path","name":"path","required":true,"description":"The path to the file."}
     * @paramDef {"type":"String","label":"Message","name":"message","required":true,"description":"The commit message."}
     * @paramDef {"type":"String","label":"Content","name":"content","required":true,"description":"The new file content, Base64 encoded.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     * @paramDef {"type":"String","label":"SHA","name":"sha","required":true,"description":"The blob SHA of the file being replaced. You can get this by calling the Get Repository Content API."}
     * @paramDef {"type":"String","label":"Branch","name":"branch","description":"The branch name. Default: the repository's default branch.","defaultValue":"main","dictionary":"getBranchesDictionary","dependsOn":["repository"]}
     *
     * @returns {Object}
     * @sampleResult {"content":{"name":"README.md","path":"README.md","sha":"9d0a391c42947019553579f500a399f264963a26","size":10,"url":"https://api.github.com/repos/octocat/Hello-World/contents/README.md","html_url":"https://github.com/octocat/Hello-World/blob/master/README.md","git_url":"https://api.github.com/repos/octocat/Hello-World/git/blobs/9d0a391c42947019553579f500a399f264963a26","type":"file","_links":{"self":"https://api.github.com/repos/octocat/Hello-World/contents/README.md","git":"https://api.github.com/repos/octocat/Hello-World/git/blobs/9d0a391c42947019553579f500a399f264963a26","html":"https://github.com/octocat/Hello-World/blob/master/README.md"}},"commit":{"sha":"7638417db6d59f3c431d3e1f261cc637155684cd","node_id":"MDY6Q29tbWl0NzYzODQxN2RiNmQ1OWYzYzQzMWQzZTFmMjYxY2M2MzcxNTU2ODRjZA==","url":"https://api.github.com/repos/octocat/Hello-World/git/commits/7638417db6d59f3c431d3e1f261cc637155684cd","html_url":"https://github.com/octocat/Hello-World/commit/7638417db6d59f3c431d3e1f261cc637155684cd","author":{"name":"Octocat","email":"octocat@github.com","date":"2012-03-06T23:06:50Z"},"committer":{"name":"Octocat","email":"octocat@github.com","date":"2012-03-06T23:06:50Z"},"message":"Added README.md","tree":{"sha":"b0b1f3b3a1708573100c9a7b9f3b3a1708573100","url":"https://api.github.com/repos/octocat/Hello-World/git/trees/b0b1f3b3a1708573100c9a7b9f3b3a1708573100"},"parents":[{"sha":"6dcb09b5b57875f334f61aebed695e2e4193db5e","url":"https://api.github.com/repos/octocat/Hello-World/git/commits/6dcb09b5b57875f334f61aebed695e2e4193db5e","html_url":"https://github.com/octocat/Hello-World/commit/6dcb09b5b57875f334f61aebed695e2e4193db5e"}]}}
     */
  async updateFile(repository, path, message, content, sha, branch) {
    const { owner, repo } = this.#parseRepository(repository)

    const requestBody = this.#cleanObject({
      message,
      content,
      sha,
      branch,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/contents/${ path }`,
      method: 'put',
      body: requestBody,
    })
  }

  /**
     * @description Deletes a file from a repository
     * @route POST /delete-file
     * @operationName Delete File
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Path","name":"path","required":true,"description":"The path to the file."}
     * @paramDef {"type":"String","label":"Message","name":"message","required":true,"description":"The commit message."}
     * @paramDef {"type":"String","label":"SHA","name":"sha","required":true,"description":"The blob SHA of the file to delete. You can get this by calling the Get Repository Content API."}
     * @paramDef {"type":"String","label":"Branch","name":"branch","description":"The branch name. Default: the repository's default branch.","defaultValue":"main","dictionary":"getBranchesDictionary","dependsOn":["repository"]}
     *
     * @returns {Object}
     * @sampleResult {"commit":{"sha":"7638417db6d59f3c431d3e1f261cc637155684cd","node_id":"MDY6Q29tbWl0NzYzODQxN2RiNmQ1OWYzYzQzMWQzZTFmMjYxY2M2MzcxNTU2ODRjZA==","url":"https://api.github.com/repos/octocat/Hello-World/git/commits/7638417db6d59f3c431d3e1f261cc637155684cd","html_url":"https://github.com/octocat/Hello-World/commit/7638417db6d59f3c431d3e1f261cc637155684cd","author":{"name":"Octocat","email":"octocat@github.com","date":"2012-03-06T23:06:50Z"},"committer":{"name":"Octocat","email":"octocat@github.com","date":"2012-03-06T23:06:50Z"},"message":"Deleted README.md","tree":{"sha":"b0b1f3b3a1708573100c9a7b9f3b3a1708573100","url":"https://api.github.com/repos/octocat/Hello-World/git/trees/b0b1f3b3a1708573100c9a7b9f3b3a1708573100"},"parents":[{"sha":"6dcb09b5b57875f334f61aebed695e2e4193db5e","url":"https://api.github.com/repos/octocat/Hello-World/git/commits/6dcb09b5b57875f334f61aebed695e2e4193db5e","html_url":"https://github.com/octocat/Hello-World/commit/6dcb09b5b57875f334f61aebed695e2e4193db5e"}]}}
     */
  async deleteFile(repository, path, message, sha, branch) {
    const { owner, repo } = this.#parseRepository(repository)

    const requestBody = this.#cleanObject({
      message,
      sha,
      branch,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/contents/${ path }`,
      method: 'delete',
      body: requestBody,
    })
  }

  /**
     * @description Retrieves the contents of a file or directory in a repository. When the path points to a file, GitHub returns a single object containing the Base64-encoded file content along with its sha, size and type ("file"). When the path points to a directory (or is empty, meaning the repository root), GitHub returns an array of entries, each describing a file or subdirectory with its name, path, sha, size and type. Use the optional ref to read from a specific branch, tag, or commit SHA.
     * @route POST /get-repository-contents
     * @operationName Get Contents
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Path","name":"path","description":"The path to the file or directory. Leave empty to list the repository root directory."}
     * @paramDef {"type":"String","label":"Ref","name":"ref","description":"The branch name, tag, or commit SHA to read from. Default: the repository's default branch.","dictionary":"getBranchesDictionary","dependsOn":["repository"]}
     *
     * @returns {Object}
     * @sampleResult [{"name":"README.md","path":"README.md","sha":"9d0a391c42947019553579f500a399f264963a26","size":10,"type":"file","html_url":"https://github.com/octocat/Hello-World/blob/master/README.md","download_url":"https://raw.githubusercontent.com/octocat/Hello-World/master/README.md"},{"name":"src","path":"src","sha":"a84d88e7554fc1fa21bcbc4efae3c782a70d2b9d","size":0,"type":"dir","html_url":"https://github.com/octocat/Hello-World/tree/master/src","download_url":null}]
     */
  async getRepositoryContents(repository, path, ref) {
    const { owner, repo } = this.#parseRepository(repository)

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/contents/${ path || '' }`,
      query: this.#cleanObject({ ref }),
    })
  }

  /**
     * @description Retrieves a single file from a repository and returns its decoded UTF-8 text content. This is a convenience wrapper over the repository contents endpoint: it fetches the file, decodes the Base64 content GitHub returns, and provides the decoded text alongside the file's sha, size and URLs. Use the optional ref to read from a specific branch, tag, or commit SHA. Throws an error if the path points to a directory or is otherwise not a file. Intended for text files; binary files may not decode cleanly to UTF-8.
     * @route POST /get-file-content
     * @operationName Get File Content
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Path","name":"path","required":true,"description":"The path to the file."}
     * @paramDef {"type":"String","label":"Ref","name":"ref","description":"The branch name, tag, or commit SHA to read from. Default: the repository's default branch.","dictionary":"getBranchesDictionary","dependsOn":["repository"]}
     *
     * @returns {Object}
     * @sampleResult {"path":"README.md","sha":"9d0a391c42947019553579f500a399f264963a26","size":24,"encoding":"utf-8","content":"# Hello-World\nMy first repo!\n","html_url":"https://github.com/octocat/Hello-World/blob/master/README.md","download_url":"https://raw.githubusercontent.com/octocat/Hello-World/master/README.md"}
     */
  async getFileContent(repository, path, ref) {
    const { owner, repo } = this.#parseRepository(repository)

    const file = await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/contents/${ path }`,
      query: this.#cleanObject({ ref }),
    })

    if (Array.isArray(file) || !file || file.content === undefined) {
      throw new Error(`Path is a directory or not a file: ${ path }`)
    }

    return {
      path: file.path,
      sha: file.sha,
      size: file.size,
      encoding: 'utf-8',
      content: Buffer.from(file.content, 'base64').toString('utf-8'),
      html_url: file.html_url,
      download_url: file.download_url,
    }
  }

  /**
     * @description Lists commits for a repository. Returns the commits in reverse chronological order. You can narrow the results by branch or commit SHA to start from, a file or directory path, an author, and a date range. Supports pagination via per-page and page parameters.
     * @route POST /list-commits
     * @operationName List Commits
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"SHA or Branch","name":"sha","description":"Branch name or commit SHA to start listing commits from. Default: the repository's default branch.","dictionary":"getBranchesDictionary","dependsOn":["repository"]}
     * @paramDef {"type":"String","label":"Path","name":"path","description":"Only return commits that touch this file or directory path."}
     * @paramDef {"type":"String","label":"Author","name":"author","description":"GitHub login or email address to filter commits by author."}
     * @paramDef {"type":"String","label":"Since","name":"since","description":"Only commits after this date will be returned. ISO 8601 format (YYYY-MM-DDTHH:MM:SSZ)."}
     * @paramDef {"type":"String","label":"Until","name":"until","description":"Only commits before this date will be returned. ISO 8601 format (YYYY-MM-DDTHH:MM:SSZ)."}
     * @paramDef {"type":"Number","label":"Per Page","name":"perPage","description":"Number of results per page (max 100). Default: 30.","uiComponent":{"type":"NUMERIC_STEPPER"}}
     * @paramDef {"type":"Number","label":"Page","name":"page","description":"Page number of the results to fetch. Default: 1.","uiComponent":{"type":"NUMERIC_STEPPER"}}
     *
     * @returns {Object}
     * @sampleResult [{"sha":"6dcb09b5b57875f334f61aebed695e2e4193db5e","commit":{"author":{"name":"Monalisa Octocat","email":"support@github.com","date":"2011-04-14T16:00:49Z"},"committer":{"name":"Monalisa Octocat","email":"support@github.com","date":"2011-04-14T16:00:49Z"},"message":"Fix all the bugs","comment_count":0},"author":{"login":"octocat","id":1},"committer":{"login":"octocat","id":1},"html_url":"https://github.com/octocat/Hello-World/commit/6dcb09b5b57875f334f61aebed695e2e4193db5e"}]
     */
  async listCommits(repository, sha, path, author, since, until, perPage, page) {
    const { owner, repo } = this.#parseRepository(repository)

    const query = this.#cleanObject({
      sha,
      path,
      author,
      since,
      until,
      per_page: perPage,
      page,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/commits`,
      query,
    })
  }

  /**
     * @description Retrieves a single commit from a repository, identified by a commit SHA, branch name, or tag. The response includes the full commit details, including the author and committer, the commit message, the list of changed files with per-file additions/deletions, and aggregate stats for the commit.
     * @route POST /get-commit
     * @operationName Get Commit
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Ref","name":"ref","required":true,"description":"The commit SHA, branch name, or tag to retrieve."}
     *
     * @returns {Object}
     * @sampleResult {"sha":"6dcb09b5b57875f334f61aebed695e2e4193db5e","commit":{"author":{"name":"Monalisa Octocat","email":"support@github.com","date":"2011-04-14T16:00:49Z"},"committer":{"name":"Monalisa Octocat","email":"support@github.com","date":"2011-04-14T16:00:49Z"},"message":"Fix all the bugs"},"author":{"login":"octocat","id":1},"committer":{"login":"octocat","id":1},"html_url":"https://github.com/octocat/Hello-World/commit/6dcb09b5b57875f334f61aebed695e2e4193db5e","stats":{"total":108,"additions":104,"deletions":4},"files":[{"filename":"file1.txt","additions":10,"deletions":2,"changes":12,"status":"modified"}]}
     */
  async getCommit(repository, ref) {
    const { owner, repo } = this.#parseRepository(repository)

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/commits/${ ref }`,
    })
  }

  /**
     * @description Adds a collaborator to a repository
     * @route POST /add-collaborator
     * @operationName Add Collaborator
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Username","name":"username","required":true,"description":"The username of the collaborator to add.","dictionary":"getUsersDictionary"}
     * @paramDef {"type":"String","label":"Permission","name":"permission","description":"The permission to grant the collaborator. Default: 'pull'.","uiComponent":{"type":"DROPDOWN","options":{"values":["Read","Triage","Write","Maintain","Admin"]}}}
     *
     * @returns {Object}
     * @sampleResult {"status":"201 Created"}
     */
  async addCollaborator(repository, username, permission) {
    const { owner, repo } = this.#parseRepository(repository)

    const requestBody = this.#cleanObject({
      permission: this.#resolveChoice(permission, { Read: 'pull', Triage: 'triage', Write: 'push', Maintain: 'maintain', Admin: 'admin' }),
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/collaborators/${ username }`,
      method: 'put',
      body: requestBody,
    })
  }

  /**
     * @description Removes a collaborator from a repository
     * @route POST /remove-collaborator
     * @operationName Remove Collaborator
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Username","name":"username","required":true,"description":"The username of the collaborator to remove.","dictionary":"getUsersDictionary"}
     *
     * @returns {Object}
     * @sampleResult {}
     */
  async removeCollaborator(repository, username) {
    const { owner, repo } = this.#parseRepository(repository)

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/collaborators/${ username }`,
      method: 'delete',
    })
  }

  /**
     * @description Adds a label to an issue or pull request
     * @route POST /add-label-to-issue
     * @operationName Add Label to Issue/PR
     * @category Issues
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Issue Number","name":"issueNumber","required":true,"description":"The number of the issue or pull request.","dictionary":"getIssuesDictionary","dependsOn":["repository"]}
     * @paramDef {"type":"String","label":"Labels","name":"labels","required":true,"description":"Labels to add to the issue. Pass as comma-separated string.","dictionary":"getLabelsDictionary","dependsOn":["repository"]}
     *
     * @returns {Object}
     * @sampleResult [{"id":208045946,"node_id":"MDU6TGFiZWwyMDgwNDU5NDY=","url":"https://api.github.com/repos/octocat/Hello-World/labels/bug","name":"bug","color":"f29513","default":true}]
     */
  async addLabelToIssue(repository, issueNumber, labels) {
    const { owner, repo } = this.#parseRepository(repository)

    const requestBody = labels.split(',').map(s => s.trim())

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/issues/${ issueNumber }/labels`,
      method: 'post',
      body: requestBody,
    })
  }

  /**
     * @description Removes a label from an issue or pull request
     * @route POST /remove-label-from-issue
     * @operationName Remove Label from Issue/PR
     * @category Issues
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Issue Number","name":"issueNumber","required":true,"description":"The number of the issue or pull request.","dictionary":"getIssuesDictionary","dependsOn":["repository"]}
     * @paramDef {"type":"String","label":"Label Name","name":"labelName","required":true,"description":"The name of the label to remove.","dictionary":"getLabelsDictionary","dependsOn":["repository"]}
     *
     * @returns {Object}
     * @sampleResult []
     */
  async removeLabelFromIssue(repository, issueNumber, labelName) {
    const { owner, repo } = this.#parseRepository(repository)

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/issues/${ issueNumber }/labels/${ labelName }`,
      method: 'delete',
    })
  }

  /**
     * @description Assigns users to an issue or pull request
     * @route POST /assign-issue
     * @operationName Assign Issue/PR
     * @category Issues
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Issue Number","name":"issueNumber","required":true,"description":"The number of the issue or pull request.","dictionary":"getIssuesDictionary","dependsOn":["repository"]}
     * @paramDef {"type":"String","label":"Assignees","name":"assignees","required":true,"description":"Logins of users to assign to this issue. Pass as comma-separated string.","dictionary":"getUsersDictionary"}
     *
     * @returns {Object}
     * @sampleResult {"id":1,"number":1347,"title":"Found a bug","body":"I'm having a problem with this.","state":"open","assignees":[{"login":"octocat"}],"html_url":"https://github.com/owner/repo/issues/1347"}
     */
  async assignIssue(repository, issueNumber, assignees) {
    const { owner, repo } = this.#parseRepository(repository)

    const requestBody = {
      assignees: assignees.split(',').map(s => s.trim()),
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/issues/${ issueNumber }/assignees`,
      method: 'post',
      body: requestBody,
    })
  }

  /**
     * @description Unassigns users from an issue or pull request
     * @route POST /unassign-issue
     * @operationName Unassign Issue/PR
     * @category Issues
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Issue Number","name":"issueNumber","required":true,"description":"The number of the issue or pull request.","dictionary":"getIssuesDictionary","dependsOn":["repository"]}
     * @paramDef {"type":"String","label":"Assignees","name":"assignees","required":true,"description":"Logins of users to unassign from this issue. Pass as comma-separated string.","dictionary":"getUsersDictionary"}
     *
     * @returns {Object}
     * @sampleResult {"id":1,"number":1347,"title":"Found a bug","body":"I'm having a problem with this.","state":"open","assignees":[],"html_url":"https://github.com/owner/repo/issues/1347"}
     */
  async unassignIssue(repository, issueNumber, assignees) {
    const { owner, repo } = this.#parseRepository(repository)

    const requestBody = {
      assignees: assignees.split(',').map(s => s.trim()),
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/issues/${ issueNumber }/assignees`,
      method: 'delete',
      body: requestBody,
    })
  }

  /**
     * @description Creates a new webhook for a repository
     * @route POST /create-repository-webhook
     * @operationName Create Repository Webhook
     * @category Webhooks
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Config URL","name":"config_url","required":true,"description":"The URL to which the payloads will be delivered."}
     * @paramDef {"type":"String","label":"Config Content Type","name":"config_content_type","description":"The media type used to serialize the payloads. Default: 'json'.","uiComponent":{"type":"DROPDOWN","options":{"values":["JSON","Form"]}}}
     * @paramDef {"type":"String","label":"Config Secret","name":"config_secret","description":"If provided, the `secret` will be sent as the `X-Hub-Signature` header in each webhook delivery."}
     * @paramDef {"type":"Boolean","label":"Active","name":"active","description":"Determines if the webhook is active. Default: true."}
     * @paramDef {"type":"String","label":"Events","name":"events","description":"A list of events to subscribe to. Pass as comma-separated string. Default: 'push'.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     *
     * @returns {Object}
     * @sampleResult {"type":"Repository","id":1,"name":"web","active":true,"events":["push"],"config":{"url":"https://example.com/webhook","content_type":"json"},"updated_at":"2024-01-01T12:00:00Z","created_at":"2024-01-01T12:00:00Z","url":"https://api.github.com/repos/octocat/Hello-World/hooks/1","test_url":"https://api.github.com/repos/octocat/Hello-World/hooks/1/test","ping_url":"https://api.github.com/repos/octocat/Hello-World/hooks/1/ping"}
     */
  async createRepositoryWebhook(repository, config_url, config_content_type, config_secret, active, events) {
    const { owner, repo } = this.#parseRepository(repository)

    const requestBody = this.#cleanObject({
      name: 'web',
      active,
      events: events ? events.split(',').map(s => s.trim()) : undefined,
      config: this.#cleanObject({
        url: config_url,
        content_type: this.#resolveChoice(config_content_type, { JSON: 'json', Form: 'application/x-www-form-urlencoded' }),
        secret: config_secret,
      }),
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/hooks`,
      method: 'post',
      body: requestBody,
    })
  }

  /**
     * @description Deletes a webhook from a repository
     * @route POST /delete-repository-webhook
     * @operationName Delete Repository Webhook
     * @category Webhooks
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Hook ID","name":"hook_id","required":true,"description":"The ID of the webhook to delete.","dictionary":"getWebhooksDictionary","dependsOn":["repository"]}
     *
     * @returns {Object}
     * @sampleResult {}
     */
  async deleteRepositoryWebhook(repository, hook_id) {
    const { owner, repo } = this.#parseRepository(repository)

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/hooks/${ hook_id }`,
      method: 'delete',
    })
  }

  /**
     * @description Creates a new team in an organization
     * @route POST /create-team
     * @operationName Create Team
     * @category Organizations
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Organization","name":"org","required":true,"description":"The organization name.","dictionary":"getOrganizationsDictionary"}
     * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the team."}
     * @paramDef {"type":"String","label":"Description","name":"description","description":"The description of the team.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     * @paramDef {"type":"String","label":"Privacy","name":"privacy","description":"The level of privacy for the team. Default: 'secret'.","uiComponent":{"type":"DROPDOWN","options":{"values":["Secret","Closed"]}}}
     * @paramDef {"type":"String","label":"Parent Team ID","name":"parent_team_id","description":"The ID of the parent team to create a nested team.","dictionary":"getTeamsDictionary","dependsOn":["org"]}
     *
     * @returns {Object}
     * @sampleResult {"id":1,"node_id":"MDQ6VGVhbTE=","url":"https://api.github.com/teams/1","html_url":"https://github.com/orgs/github/teams/justice-league","name":"Justice League","slug":"justice-league","description":"A great team.","privacy":"secret","permission":"pull","members_url":"https://api.github.com/teams/1/members{/member}","repositories_url":"https://api.github.com/teams/1/repos","parent":{"id":2,"node_id":"MDQ6VGVhbTI=","url":"https://api.github.com/teams/2","html_url":"https://github.com/orgs/github/teams/super-heroes","name":"Super Heroes","slug":"super-heroes","description":"","privacy":"closed","permission":"pull","members_url":"https://api.github.com/teams/2/members{/member}","repositories_url":"https://api.github.com/teams/2/repos"}}
     */
  async createTeam(org, name, description, privacy, parent_team_id) {
    const requestBody = this.#cleanObject({
      name,
      description,
      privacy: this.#resolveChoice(privacy, { Secret: 'secret', Closed: 'closed' }),
      parent_team_id: parent_team_id ? parseInt(parent_team_id) : undefined,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/orgs/${ org }/teams`,
      method: 'post',
      body: requestBody,
    })
  }

  /**
     * @description Deletes a team from an organization
     * @route POST /delete-team
     * @operationName Delete Team
     * @category Organizations
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Organization","name":"org","required":true,"description":"The organization name.","dictionary":"getOrganizationsDictionary"}
     * @paramDef {"type":"String","label":"Team Slug","name":"team_slug","required":true,"description":"The slug of the team to delete.","dictionary":"getTeamsDictionary","dependsOn":["org"]}
     *
     * @returns {Object}
     * @sampleResult {}
     */
  async deleteTeam(org, team_slug) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/orgs/${ org }/teams/${ team_slug }`,
      method: 'delete',
    })
  }

  /**
     * @description Adds a team member to a team
     * @route POST /add-team-member
     * @operationName Add Team Member
     * @category Organizations
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Organization","name":"org","required":true,"description":"The organization name.","dictionary":"getOrganizationsDictionary"}
     * @paramDef {"type":"String","label":"Team Slug","name":"team_slug","required":true,"description":"The slug of the team.","dictionary":"getTeamsDictionary","dependsOn":["org"]}
     * @paramDef {"type":"String","label":"Username","name":"username","required":true,"description":"The username of the user to add to the team.","dictionary":"getUsersDictionary"}
     * @paramDef {"type":"String","label":"Role","name":"role","description":"The role that the user will have in the team. Default: 'member'.","uiComponent":{"type":"DROPDOWN","options":{"values":["Member","Maintainer"]}}}
     *
     * @returns {Object}
     * @sampleResult {"status":"200 OK"}
     */
  async addTeamMember(org, team_slug, username, role) {
    const requestBody = this.#cleanObject({
      role: this.#resolveChoice(role, { Member: 'member', Maintainer: 'maintainer' }),
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/orgs/${ org }/teams/${ team_slug }/memberships/${ username }`,
      method: 'put',
      body: requestBody,
    })
  }

  /**
     * @description Removes a team member from a team
     * @route POST /remove-team-member
     * @operationName Remove Team Member
     * @category Organizations
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Organization","name":"org","required":true,"description":"The organization name.","dictionary":"getOrganizationsDictionary"}
     * @paramDef {"type":"String","label":"Team Slug","name":"team_slug","required":true,"description":"The slug of the team.","dictionary":"getTeamsDictionary","dependsOn":["org"]}
     * @paramDef {"type":"String","label":"Username","name":"username","required":true,"description":"The username of the user to remove from the team.","dictionary":"getUsersDictionary"}
     *
     * @returns {Object}
     * @sampleResult {}
     */
  async removeTeamMember(org, team_slug, username) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/orgs/${ org }/teams/${ team_slug }/memberships/${ username }`,
      method: 'delete',
    })
  }

  /**
     * @description Adds a repository to a team
     * @route POST /add-team-repository
     * @operationName Add Team Repository
     * @category Organizations
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Organization","name":"org","required":true,"description":"The organization name.","dictionary":"getOrganizationsDictionary"}
     * @paramDef {"type":"String","label":"Team Slug","name":"team_slug","required":true,"description":"The slug of the team.","dictionary":"getTeamsDictionary","dependsOn":["org"]}
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Permission","name":"permission","description":"The permission to grant the team on this repository. Default: 'pull'.","uiComponent":{"type":"DROPDOWN","options":{"values":["Read","Triage","Write","Maintain","Admin"]}}}
     *
     * @returns {Object}
     * @sampleResult {"status":"204 No Content"}
     */
  async addTeamRepository(org, team_slug, owner, repo, permission) {
    const requestBody = this.#cleanObject({
      permission: this.#resolveChoice(permission, { Read: 'pull', Triage: 'triage', Write: 'push', Maintain: 'maintain', Admin: 'admin' }),
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/orgs/${ org }/teams/${ team_slug }/repos/${ owner }/${ repo }`,
      method: 'put',
      body: requestBody,
    })
  }

  /**
     * @description Removes a repository from a team
     * @route POST /remove-team-repository
     * @operationName Remove Team Repository
     * @category Organizations
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Organization","name":"org","required":true,"description":"The organization name.","dictionary":"getOrganizationsDictionary"}
     * @paramDef {"type":"String","label":"Team Slug","name":"team_slug","required":true,"description":"The slug of the team.","dictionary":"getTeamsDictionary","dependsOn":["org"]}
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     *
     * @returns {Object}
     * @sampleResult {}
     */
  async removeTeamRepository(org, team_slug, owner, repo) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/orgs/${ org }/teams/${ team_slug }/repos/${ owner }/${ repo }`,
      method: 'delete',
    })
  }

  /**
     * @description Forks a repository
     * @route POST /fork-repository
     * @operationName Fork Repository
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Organization","name":"organization","description":"The organization to fork the repository into. If not specified, the repository is forked into the authenticated user's account.","dictionary":"getOrganizationsDictionary"}
     *
     * @returns {Object}
     * @sampleResult {"id":1296269,"node_id":"MDEwOlJlcG9zaXRvcnkxMjk2MjY5","name":"Hello-World","full_name":"octocat/Hello-World","owner":{"login":"octocat"},"private":false,"html_url":"https://github.com/octocat/Hello-World","description":"This is your first repo!","fork":true}
     */
  async forkRepository(repository, organization) {
    const { owner, repo } = this.#parseRepository(repository)

    const requestBody = this.#cleanObject({
      organization,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/forks`,
      method: 'post',
      body: requestBody,
    })
  }

  /**
     * @description Stars a repository
     * @route POST /star-repository
     * @operationName Star Repository
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     *
     * @returns {Object}
     * @sampleResult {}
     */
  async starRepository(repository) {
    const { owner, repo } = this.#parseRepository(repository)

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/user/starred/${ owner }/${ repo }`,
      method: 'put',
    })
  }

  /**
     * @description Unstars a repository
     * @route POST /unstar-repository
     * @operationName Unstar Repository
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     *
     * @returns {Object}
     * @sampleResult {}
     */
  async unstarRepository(repository) {
    const { owner, repo } = this.#parseRepository(repository)

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/user/starred/${ owner }/${ repo }`,
      method: 'delete',
    })
  }

  /**
     * @description Watches a repository
     * @route POST /watch-repository
     * @operationName Watch Repository
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Subscribed State","name":"subscribed","required":true,"description":"Describes the level of subscription. 'true' to subscribe to all notifications, 'false' to ignore all notifications.","uiComponent":{"type":"DROPDOWN","options":{"values":["Subscribed","Ignored"]}}}
     *
     * @returns {Object}
     * @sampleResult {"subscribed":true,"ignored":false,"reason":null,"created_at":"2024-01-01T12:00:00Z","url":"https://api.github.com/repos/octocat/Hello-World/subscription","repository_url":"https://api.github.com/repos/octocat/Hello-World"}
     */
  async watchRepository(repository, subscribed) {
    const { owner, repo } = this.#parseRepository(repository)

    const isSubscribed = this.#resolveChoice(subscribed, { Subscribed: true, Ignored: false })

    const requestBody = {
      subscribed: isSubscribed === true,
      ignored: isSubscribed === false,
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/subscription`,
      method: 'put',
      body: requestBody,
    })
  }

  /**
     * @description Unwatches a repository
     * @route POST /unwatch-repository
     * @operationName Unwatch Repository
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     *
     * @returns {Object}
     * @sampleResult {}
     */
  async unwatchRepository(repository) {
    const { owner, repo } = this.#parseRepository(repository)

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/subscription`,
      method: 'delete',
    })
  }

  /**
     * @description Creates a new project in a repository
     * @route POST /create-repository-project
     * @operationName Create Repository Project
     * @category Projects
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the project."}
     * @paramDef {"type":"String","label":"Body","name":"body","description":"The body of the project.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     *
     * @returns {Object}
     * @sampleResult {"id":1002604,"node_id":"MDc6UHVsbFJlcXVlc3QxMDAyNjA0","url":"https://api.github.com/repos/octocat/Hello-World/projects/1","html_url":"https://github.com/octocat/Hello-World/projects/1","columns_url":"https://api.github.com/repos/octocat/Hello-World/projects/1/columns","name":"New Project","body":"This is a new project.","number":1,"state":"open","creator":{"login":"octocat"}}
     */
  async createRepositoryProject(repository, name, body) {
    const { owner, repo } = this.#parseRepository(repository)

    const requestBody = this.#cleanObject({
      name,
      body,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/projects`,
      method: 'post',
      body: requestBody,
    })
  }

  /**
     * @description Creates a new project in an organization
     * @route POST /create-organization-project
     * @operationName Create Organization Project
     * @category Projects
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Organization","name":"org","required":true,"description":"The organization name.","dictionary":"getOrganizationsDictionary"}
     * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the project."}
     * @paramDef {"type":"String","label":"Body","name":"body","description":"The body of the project.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     *
     * @returns {Object}
     * @sampleResult {"id":1002604,"node_id":"MDc6UHVsbFJlcXVlc3QxMDAyNjA0","url":"https://api.github.com/orgs/github/projects/1","html_url":"https://github.com/orgs/github/projects/1","columns_url":"https://api.github.com/orgs/github/projects/1/columns","name":"New Project","body":"This is a new project.","number":1,"state":"open","creator":{"login":"octocat"}}
     */
  async createOrganizationProject(org, name, body) {
    const requestBody = this.#cleanObject({
      name,
      body,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/orgs/${ org }/projects`,
      method: 'post',
      body: requestBody,
    })
  }

  /**
     * @description Deletes a project
     * @route POST /delete-project
     * @operationName Delete Project
     * @category Projects
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Project ID","name":"project_id","required":true,"description":"The ID of the project to delete."}
     *
     * @returns {Object}
     * @sampleResult {}
     */
  async deleteProject(project_id) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/projects/${ project_id }`,
      method: 'delete',
    })
  }

  /**
     * @description Creates a new label for a repository
     * @route POST /create-label
     * @operationName Create Label
     * @category Issues
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the label."}
     * @paramDef {"type":"String","label":"Color","name":"color","required":true,"description":"The hexadecimal color code for the label, without the '#'. Example: 'f29513'."}
     * @paramDef {"type":"String","label":"Description","name":"description","description":"A short description of the label.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     *
     * @returns {Object}
     * @sampleResult {"id":208045946,"node_id":"MDU6TGFiZWwyMDgwNDU5NDY=","url":"https://api.github.com/repos/octocat/Hello-World/labels/bug","name":"bug","color":"f29513","default":true,"description":"Something isn't working"}
     */
  async createLabel(repository, name, color, description) {
    const { owner, repo } = this.#parseRepository(repository)

    const requestBody = this.#cleanObject({
      name,
      color: color ? color.replace(/^#/, '') : color, // Strip leading # if present
      description,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/labels`,
      method: 'post',
      body: requestBody,
    })
  }

  /**
     * @description Updates an existing label in a repository
     * @route POST /update-label
     * @operationName Update Label
     * @category Issues
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Current Name","name":"current_name","required":true,"description":"The current name of the label.","dictionary":"getLabelsDictionary","dependsOn":["repository"]}
     * @paramDef {"type":"String","label":"New Name","name":"new_name","description":"The new name of the label."}
     * @paramDef {"type":"String","label":"Color","name":"color","description":"The hexadecimal color code for the label, without the '#'. Example: 'f29513'."}
     * @paramDef {"type":"String","label":"Description","name":"description","description":"A short description of the label.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     *
     * @returns {Object}
     * @sampleResult {"id":208045946,"node_id":"MDU6TGFiZWwyMDgwNDU5NDY=","url":"https://api.github.com/repos/octocat/Hello-World/labels/bug","name":"bug","color":"f29513","default":true,"description":"Something isn't working"}
     */
  async updateLabel(repository, current_name, new_name, color, description) {
    const { owner, repo } = this.#parseRepository(repository)

    const requestBody = this.#cleanObject({
      new_name,
      color,
      description,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/labels/${ current_name }`,
      method: 'patch',
      body: requestBody,
    })
  }

  /**
     * @description Deletes a label from a repository
     * @route POST /delete-label
     * @operationName Delete Label
     * @category Issues
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Label Name","name":"label_name","required":true,"description":"The name of the label to delete.","dictionary":"getLabelsDictionary","dependsOn":["repository"]}
     *
     * @returns {Object}
     * @sampleResult {}
     */
  async deleteLabel(repository, label_name) {
    const { owner, repo } = this.#parseRepository(repository)

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/labels/${ label_name }`,
      method: 'delete',
    })
  }

  /**
     * @description Creates a new milestone in a repository
     * @route POST /create-milestone
     * @operationName Create Milestone
     * @category Issues
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The title of the milestone."}
     * @paramDef {"type":"String","label":"State","name":"state","description":"The state of the milestone.","defaultValue":"open","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Closed"]}}}
     * @paramDef {"type":"String","label":"Description","name":"description","description":"A short description of the milestone.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     * @paramDef {"type":"String","label":"Due On","name":"due_on","description":"The milestone due date in ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ."}
     *
     * @returns {Object}
     * @sampleResult {"url":"https://api.github.com/repos/octocat/Hello-World/milestones/1","html_url":"https://github.com/octocat/Hello-World/milestones/1","labels_url":"https://api.github.com/repos/octocat/Hello-World/milestones/1/labels","id":1002604,"node_id":"MDk6TWlsZXN0b25lMTAwMjYwNA==","number":1,"state":"open","title":"v1.0","description":"First release","creator":{"login":"octocat"},"open_issues":4,"closed_issues":8,"created_at":"2024-01-01T12:00:00Z","updated_at":"2024-01-01T12:00:00Z","due_on":"2024-12-31T23:59:59Z","closed_at":null}
     */
  async createMilestone(repository, title, state, description, due_on) {
    const { owner, repo } = this.#parseRepository(repository)

    const requestBody = this.#cleanObject({
      title,
      state: this.#resolveChoice(state, { Open: 'open', Closed: 'closed' }),
      description,
      due_on,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/milestones`,
      method: 'post',
      body: requestBody,
    })
  }

  /**
     * @description Updates an existing milestone in a repository
     * @route POST /update-milestone
     * @operationName Update Milestone
     * @category Issues
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Milestone Number","name":"milestone_number","required":true,"description":"The number of the milestone to update.","dictionary":"getMilestonesDictionary","dependsOn":["repository"]}
     * @paramDef {"type":"String","label":"Title","name":"title","description":"The title of the milestone."}
        * @paramDef {"type":"String","label":"State","name":"state","description":"The state of the milestone.","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Closed"]}}}
     * @paramDef {"type":"String","label":"Description","name":"description","description":"A short description of the milestone.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     * @paramDef {"type":"String","label":"Due On","name":"due_on","description":"The milestone due date in ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ."}
     *
     * @returns {Object}
     * @sampleResult {"url":"https://api.github.com/repos/octocat/Hello-World/milestones/1","html_url":"https://github.com/octocat/Hello-World/milestones/1","labels_url":"https://api.github.com/repos/octocat/Hello-World/milestones/1/labels","id":1002604,"node_id":"MDk6TWlsZXN0b25lMTAwMjYwNA==","number":1,"state":"closed","title":"v1.0","description":"First release","creator":{"login":"octocat"},"open_issues":0,"closed_issues":12,"created_at":"2024-01-01T12:00:00Z","updated_at":"2024-01-01T12:00:00Z","due_on":"2024-12-31T23:59:59Z","closed_at":"2024-01-05T12:00:00Z"}
     */
  async updateMilestone(repository, milestone_number, title, state, description, due_on) {
    const { owner, repo } = this.#parseRepository(repository)

    const requestBody = this.#cleanObject({
      title,
      state: this.#resolveChoice(state, { Open: 'open', Closed: 'closed' }),
      description,
      due_on,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/milestones/${ milestone_number }`,
      method: 'patch',
      body: requestBody,
    })
  }

  /**
     * @description Deletes a milestone from a repository
     * @route POST /delete-milestone
     * @operationName Delete Milestone
     * @category Issues
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Milestone Number","name":"milestone_number","required":true,"description":"The number of the milestone to delete.","dictionary":"getMilestonesDictionary","dependsOn":["repository"]}
     *
     * @returns {Object}
     * @sampleResult {}
     */
  async deleteMilestone(repository, milestone_number) {
    const { owner, repo } = this.#parseRepository(repository)

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/milestones/${ milestone_number }`,
      method: 'delete',
    })
  }

  /**
     * @description Creates a new deploy key for a repository
     * @route POST /create-deploy-key
     * @operationName Create Deploy Key
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"A name for the key."}
     * @paramDef {"type":"String","label":"Key","name":"key","required":true,"description":"The public key.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     * @paramDef {"type":"Boolean","label":"Read Only","name":"read_only","description":"If true, the key will only be able to read repository contents. Otherwise, the key will be able to read and write.","defaultValue":true}
     *
     * @returns {Object}
     * @sampleResult {"id":1,"key":"ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC7...","url":"https://api.github.com/repos/octocat/Hello-World/keys/1","title":"deploy key","verified":true,"created_at":"2024-01-01T12:00:00Z","read_only":true}
     */
  async createDeployKey(repository, title, key, read_only) {
    const { owner, repo } = this.#parseRepository(repository)

    const requestBody = this.#cleanObject({
      title,
      key,
      read_only,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/keys`,
      method: 'post',
      body: requestBody,
    })
  }

  /**
     * @description Deletes a deploy key from a repository
     * @route POST /delete-deploy-key
     * @operationName Delete Deploy Key
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Key ID","name":"key_id","required":true,"description":"The ID of the deploy key to delete."}
     *
     * @returns {Object}
     * @sampleResult {}
     */
  async deleteDeployKey(repository, key_id) {
    const { owner, repo } = this.#parseRepository(repository)

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/keys/${ key_id }`,
      method: 'delete',
    })
  }

  /**
     * @description Creates a new repository dispatch event
     * @route POST /create-repository-dispatch-event
     * @operationName Create Repository Dispatch Event
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Event Type","name":"event_type","required":true,"description":"A custom webhook event name. Must be 100 characters or fewer."}
     * @paramDef {"type":"Object","label":"Client Payload","name":"client_payload","freeform":true,"description":"JSON payload with extra information about the webhook event that your action will receive.","uiComponent":{"type":"CODE_EDITOR","language":"json"}}
     *
     * @returns {Object}
     * @sampleResult {}
     */
  async createRepositoryDispatchEvent(repository, event_type, client_payload) {
    const { owner, repo } = this.#parseRepository(repository)

    const requestBody = this.#cleanObject({
      event_type,
      client_payload,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/dispatches`,
      method: 'post',
      body: requestBody,
    })
  }

  /**
     * @description Creates a new discussion in a repository
     * @route POST /create-discussion
     * @operationName Create Discussion
     * @category Discussions
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The discussion's title."}
     * @paramDef {"type":"String","label":"Body","name":"body","required":true,"description":"The discussion's body text.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     * @paramDef {"type":"String","label":"Category Name","name":"category_name","required":true,"description":"The name of the discussion category.","uiComponent":{"type":"DROPDOWN","options":{"values":["Announcements","General","Ideas","Q&A","Show and Tell"]}}}
     *
     * @returns {Object}
     * @sampleResult {"id":1,"node_id":"D_kwDOA_j_M84AAAE_","repository_url":"https://api.github.com/repos/octocat/Hello-World","html_url":"https://github.com/octocat/Hello-World/discussions/1","title":"My first discussion","body":"This is the body of my first discussion.","category":{"id":1,"node_id":"DIC_kwDOA_j_M84AAAE_","repository_id":1,"emoji":"👋","name":"General","description":"General discussion"},"state":"open","locked":false,"comments":0,"created_at":"2024-01-01T12:00:00Z","updated_at":"2024-01-01T12:00:00Z","author":{"login":"octocat"}}
     */
  async createDiscussion(repository, title, body, category_name) {
    const { owner, repo } = this.#parseRepository(repository)

    const categories = await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/discussions/categories`,
    })

    const category = categories.find(cat => cat.name === category_name)

    if (!category) {
      throw new Error(`Discussion category '${ category_name }' not found.`)
    }

    const requestBody = {
      title,
      body,
      category_id: category.id,
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/discussions`,
      method: 'post',
      body: requestBody,
    })
  }

  /**
     * @description Creates a new comment on a discussion
     * @route POST /create-discussion-comment
     * @operationName Create Discussion Comment
     * @category Discussions
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Discussion Number","name":"discussion_number","required":true,"description":"The number of the discussion to comment on."}
     * @paramDef {"type":"String","label":"Body","name":"body","required":true,"description":"The contents of the comment.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     *
     * @returns {Object}
     * @sampleResult {"id":1,"node_id":"DC_kwDOA_j_M84AAAE_","html_url":"https://github.com/octocat/Hello-World/discussions/1#discussioncomment-1","discussion_url":"https://api.github.com/repos/octocat/Hello-World/discussions/1","body":"This is a discussion comment.","author":{"login":"octocat"},"created_at":"2024-01-01T12:00:00Z","updated_at":"2024-01-01T12:00:00Z"}
     */
  async createDiscussionComment(repository, discussion_number, body) {
    const { owner, repo } = this.#parseRepository(repository)

    const requestBody = { body }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/discussions/${ discussion_number }/comments`,
      method: 'post',
      body: requestBody,
    })
  }

  /**
     * @description Creates a new secret for a repository
     * @route POST /create-repository-secret
     * @operationName Create Repository Secret
     * @category Secrets
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Secret Name","name":"secret_name","required":true,"description":"The name of the secret."}
     * @paramDef {"type":"String","label":"Encrypted Value","name":"encrypted_value","required":true,"description":"The encrypted value of the secret. You must encrypt the secret using LibSodium. For more information, see 'Encrypting secrets for the REST API'.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     * @paramDef {"type":"String","label":"Key ID","name":"key_id","required":true,"description":"The ID of the key you used to encrypt the secret. You can get this by calling the Get Repository Public Key API."}
     *
     * @returns {Object}
     * @sampleResult {}
     */
  async createRepositorySecret(repository, secret_name, encrypted_value, key_id) {
    const { owner, repo } = this.#parseRepository(repository)

    const requestBody = {
      encrypted_value,
      key_id,
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/actions/secrets/${ secret_name }`,
      method: 'put',
      body: requestBody,
    })
  }

  /**
     * @description Deletes a secret from a repository
     * @route POST /delete-repository-secret
     * @operationName Delete Repository Secret
     * @category Secrets
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Secret Name","name":"secret_name","required":true,"description":"The name of the secret to delete."}
     *
     * @returns {Object}
     * @sampleResult {}
     */
  async deleteRepositorySecret(repository, secret_name) {
    const { owner, repo } = this.#parseRepository(repository)

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/actions/secrets/${ secret_name }`,
      method: 'delete',
    })
  }

  /**
     * @description Creates a new secret for an organization
     * @route POST /create-organization-secret
     * @operationName Create Organization Secret
     * @category Secrets
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Organization","name":"org","required":true,"description":"The organization name.","dictionary":"getOrganizationsDictionary"}
     * @paramDef {"type":"String","label":"Secret Name","name":"secret_name","required":true,"description":"The name of the secret."}
     * @paramDef {"type":"String","label":"Encrypted Value","name":"encrypted_value","required":true,"description":"The encrypted value of the secret. You must encrypt the secret using LibSodium. For more information, see 'Encrypting secrets for the REST API'.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     * @paramDef {"type":"String","label":"Key ID","name":"key_id","required":true,"description":"The ID of the key you used to encrypt the secret. You can get this by calling the Get Organization Public Key API."}
     * @paramDef {"type":"String","label":"Visibility","name":"visibility","description":"The visibility of the secret. Default: 'private'.","uiComponent":{"type":"DROPDOWN","options":{"values":["All Repositories","Private Repositories","Selected Repositories"]}}}
     * @paramDef {"type":"String","label":"Selected Repository IDs","name":"selected_repository_ids","description":"An array of repository IDs that can access the secret. Required when visibility is 'selected'. Pass as comma-separated string of IDs."}
     *
     * @returns {Object}
     * @sampleResult {}
     */
  async createOrganizationSecret(org, secret_name, encrypted_value, key_id, visibility, selected_repository_ids) {
    const requestBody = this.#cleanObject({
      encrypted_value,
      key_id,
      visibility: this.#resolveChoice(visibility, { 'All Repositories': 'all', 'Private Repositories': 'private', 'Selected Repositories': 'selected' }),
      selected_repository_ids: selected_repository_ids ? selected_repository_ids.split(',').map(s => parseInt(s.trim())) : undefined,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/orgs/${ org }/actions/secrets/${ secret_name }`,
      method: 'put',
      body: requestBody,
    })
  }

  /**
     * @description Deletes a secret from an organization
     * @route POST /delete-organization-secret
     * @operationName Delete Organization Secret
     * @category Secrets
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Organization","name":"org","required":true,"description":"The organization name.","dictionary":"getOrganizationsDictionary"}
     * @paramDef {"type":"String","label":"Secret Name","name":"secret_name","required":true,"description":"The name of the secret to delete."}
     *
     * @returns {Object}
     * @sampleResult {}
     */
  async deleteOrganizationSecret(org, secret_name) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/orgs/${ org }/actions/secrets/${ secret_name }`,
      method: 'delete',
    })
  }

  /**
     * @description Creates a new environment secret for a repository
     * @route POST /create-environment-secret
     * @operationName Create Environment Secret
     * @category Secrets
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository ID","name":"repository_id","required":true,"description":"The ID of the repository.","dictionary":"getRepositoryIdsDictionary"}
     * @paramDef {"type":"String","label":"Environment Name","name":"environment_name","required":true,"description":"The name of the environment."}
     * @paramDef {"type":"String","label":"Secret Name","name":"secret_name","required":true,"description":"The name of the secret."}
     * @paramDef {"type":"String","label":"Encrypted Value","name":"encrypted_value","required":true,"description":"The encrypted value of the secret. You must encrypt the secret using LibSodium. For more information, see 'Encrypting secrets for the REST API'.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     * @paramDef {"type":"String","label":"Key ID","name":"key_id","required":true,"description":"The ID of the key you used to encrypt the secret. You can get this by calling the Get Environment Public Key API."}
     *
     * @returns {Object}
     * @sampleResult {}
     */
  async createEnvironmentSecret(repository_id, environment_name, secret_name, encrypted_value, key_id) {
    const requestBody = {
      encrypted_value,
      key_id,
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repositories/${ repository_id }/environments/${ environment_name }/secrets/${ secret_name }`,
      method: 'put',
      body: requestBody,
    })
  }

  /**
     * @description Deletes an environment secret from a repository
     * @route POST /delete-environment-secret
     * @operationName Delete Environment Secret
     * @category Secrets
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository ID","name":"repository_id","required":true,"description":"The ID of the repository.","dictionary":"getRepositoryIdsDictionary"}
     * @paramDef {"type":"String","label":"Environment Name","name":"environment_name","required":true,"description":"The name of the environment."}
     * @paramDef {"type":"String","label":"Secret Name","name":"secret_name","required":true,"description":"The name of the secret to delete."}
     *
     * @returns {Object}
     * @sampleResult {}
     */
  async deleteEnvironmentSecret(repository_id, environment_name, secret_name) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repositories/${ repository_id }/environments/${ environment_name }/secrets/${ secret_name }`,
      method: 'delete',
    })
  }

  /**
     * @description Creates a new repository variable
     * @route POST /create-repository-variable
     * @operationName Create Repository Variable
     * @category Variables
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Variable Name","name":"name","required":true,"description":"The name of the variable."}
     * @paramDef {"type":"String","label":"Value","name":"value","required":true,"description":"The value of the variable.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     *
     * @returns {Object}
     * @sampleResult {}
     */
  async createRepositoryVariable(repository, name, value) {
    const { owner, repo } = this.#parseRepository(repository)

    const requestBody = {
      name,
      value,
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/actions/variables`,
      method: 'post',
      body: requestBody,
    })
  }

  /**
     * @description Updates an existing repository variable
     * @route POST /update-repository-variable
     * @operationName Update Repository Variable
     * @category Variables
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Variable Name","name":"name","required":true,"description":"The name of the variable to update."}
     * @paramDef {"type":"String","label":"New Name","name":"new_name","description":"The new name of the variable."}
     * @paramDef {"type":"String","label":"New Value","name":"value","description":"The new value of the variable.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     *
     * @returns {Object}
     * @sampleResult {}
     */
  async updateRepositoryVariable(repository, name, new_name, value) {
    const { owner, repo } = this.#parseRepository(repository)

    const requestBody = this.#cleanObject({
      name: new_name,
      value,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/actions/variables/${ name }`,
      method: 'patch',
      body: requestBody,
    })
  }

  /**
     * @description Deletes a repository variable
     * @route POST /delete-repository-variable
     * @operationName Delete Repository Variable
     * @category Variables
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Variable Name","name":"name","required":true,"description":"The name of the variable to delete."}
     *
     * @returns {Object}
     * @sampleResult {}
     */
  async deleteRepositoryVariable(repository, name) {
    const { owner, repo } = this.#parseRepository(repository)

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/actions/variables/${ name }`,
      method: 'delete',
    })
  }

  /**
     * @description Creates a new organization variable
     * @route POST /create-organization-variable
     * @operationName Create Organization Variable
     * @category Variables
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Organization","name":"org","required":true,"description":"The organization name.","dictionary":"getOrganizationsDictionary"}
     * @paramDef {"type":"String","label":"Variable Name","name":"name","required":true,"description":"The name of the variable."}
     * @paramDef {"type":"String","label":"Value","name":"value","required":true,"description":"The value of the variable.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     * @paramDef {"type":"String","label":"Visibility","name":"visibility","description":"The visibility of the variable. Default: 'private'.","uiComponent":{"type":"DROPDOWN","options":{"values":["All Repositories","Private Repositories","Selected Repositories"]}}}
     * @paramDef {"type":"String","label":"Selected Repository IDs","name":"selected_repository_ids","description":"An array of repository IDs that can access the variable. Required when visibility is 'selected'. Pass as comma-separated string of IDs."}
     *
     * @returns {Object}
     * @sampleResult {}
     */
  async createOrganizationVariable(org, name, value, visibility, selected_repository_ids) {
    const requestBody = this.#cleanObject({
      name,
      value,
      visibility: this.#resolveChoice(visibility, { 'All Repositories': 'all', 'Private Repositories': 'private', 'Selected Repositories': 'selected' }),
      selected_repository_ids: selected_repository_ids ? selected_repository_ids.split(',').map(s => parseInt(s.trim())) : undefined,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/orgs/${ org }/actions/variables`,
      method: 'post',
      body: requestBody,
    })
  }

  /**
     * @description Updates an existing organization variable
     * @route POST /update-organization-variable
     * @operationName Update Organization Variable
     * @category Variables
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Organization","name":"org","required":true,"description":"The organization name.","dictionary":"getOrganizationsDictionary"}
     * @paramDef {"type":"String","label":"Variable Name","name":"name","required":true,"description":"The name of the variable to update."}
     * @paramDef {"type":"String","label":"New Name","name":"new_name","description":"The new name of the variable."}
     * @paramDef {"type":"String","label":"New Value","name":"value","description":"The new value of the variable.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     * @paramDef {"type":"String","label":"Visibility","name":"visibility","description":"The visibility of the variable. Default: 'private'.","uiComponent":{"type":"DROPDOWN","options":{"values":["All Repositories","Private Repositories","Selected Repositories"]}}}
     * @paramDef {"type":"String","label":"Selected Repository IDs","name":"selected_repository_ids","description":"An array of repository IDs that can access the variable. Required when visibility is 'selected'. Pass as comma-separated string of IDs."}
     *
     * @returns {Object}
     * @sampleResult {}
     */
  async updateOrganizationVariable(org, name, new_name, value, visibility, selected_repository_ids) {
    const requestBody = this.#cleanObject({
      name: new_name,
      value,
      visibility: this.#resolveChoice(visibility, { 'All Repositories': 'all', 'Private Repositories': 'private', 'Selected Repositories': 'selected' }),
      selected_repository_ids: selected_repository_ids ? selected_repository_ids.split(',').map(s => parseInt(s.trim())) : undefined,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/orgs/${ org }/actions/variables/${ name }`,
      method: 'patch',
      body: requestBody,
    })
  }

  /**
     * @description Deletes an organization variable
     * @route POST /delete-organization-variable
     * @operationName Delete Organization Variable
     * @category Variables
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Organization","name":"org","required":true,"description":"The organization name.","dictionary":"getOrganizationsDictionary"}
     * @paramDef {"type":"String","label":"Variable Name","name":"name","required":true,"description":"The name of the variable to delete."}
     *
     * @returns {Object}
     * @sampleResult {}
     */
  async deleteOrganizationVariable(org, name) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/orgs/${ org }/actions/variables/${ name }`,
      method: 'delete',
    })
  }

  /**
     * @description Creates a new environment variable
     * @route POST /create-environment-variable
     * @operationName Create Environment Variable
     * @category Variables
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository ID","name":"repository_id","required":true,"description":"The ID of the repository.","dictionary":"getRepositoryIdsDictionary"}
     * @paramDef {"type":"String","label":"Environment Name","name":"environment_name","required":true,"description":"The name of the environment."}
     * @paramDef {"type":"String","label":"Variable Name","name":"name","required":true,"description":"The name of the variable."}
     * @paramDef {"type":"String","label":"Value","name":"value","required":true,"description":"The value of the variable.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     *
     * @returns {Object}
     * @sampleResult {}
     */
  async createEnvironmentVariable(repository_id, environment_name, name, value) {
    const requestBody = {
      name,
      value,
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repositories/${ repository_id }/environments/${ environment_name }/variables`,
      method: 'post',
      body: requestBody,
    })
  }

  /**
     * @description Updates an existing environment variable
     * @route POST /update-environment-variable
     * @operationName Update Environment Variable
     * @category Variables
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository ID","name":"repository_id","required":true,"description":"The ID of the repository.","dictionary":"getRepositoryIdsDictionary"}
     * @paramDef {"type":"String","label":"Environment Name","name":"environment_name","required":true,"description":"The name of the environment."}
     * @paramDef {"type":"String","label":"Variable Name","name":"name","required":true,"description":"The name of the variable to update."}
     * @paramDef {"type":"String","label":"New Name","name":"new_name","description":"The new name of the variable."}
     * @paramDef {"type":"String","label":"New Value","name":"value","description":"The new value of the variable.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     *
     * @returns {Object}
     * @sampleResult {}
     */
  async updateEnvironmentVariable(repository_id, environment_name, name, new_name, value) {
    const requestBody = this.#cleanObject({
      name: new_name,
      value,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repositories/${ repository_id }/environments/${ environment_name }/variables/${ name }`,
      method: 'patch',
      body: requestBody,
    })
  }

  /**
     * @description Deletes an environment variable
     * @route POST /delete-environment-variable
     * @operationName Delete Environment Variable
     * @category Variables
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository ID","name":"repository_id","required":true,"description":"The ID of the repository.","dictionary":"getRepositoryIdsDictionary"}
     * @paramDef {"type":"String","label":"Environment Name","name":"environment_name","required":true,"description":"The name of the environment."}
     * @paramDef {"type":"String","label":"Variable Name","name":"name","required":true,"description":"The name of the variable to delete."}
     *
     * @returns {Object}
     * @sampleResult {}
     */
  async deleteEnvironmentVariable(repository_id, environment_name, name) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repositories/${ repository_id }/environments/${ environment_name }/variables/${ name }`,
      method: 'delete',
    })
  }

  // ======================================== SEARCH ACTIONS ========================================

  /**
     * @description Checks if a user is a member of an organization
     * @route POST /check-organization-membership
     * @operationName Check Organization Membership
     * @category Organizations
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Organization","name":"org","required":true,"description":"The organization name.","dictionary":"getOrganizationsDictionary"}
     * @paramDef {"type":"String","label":"Username","name":"username","required":true,"description":"The username to check."}
     *
     * @returns {Object}
     * @sampleResult {"state":"active","role":"member","user":{"login":"octocat","id":1},"organization":{"login":"github","id":1}}
     */
  async checkOrganizationMembership(org, username) {
    try {
      return await this.#apiRequest({
        url: `${ API_BASE_URL }/orgs/${ org }/memberships/${ username }`,
      })
    } catch (error) {
      if (error.status === 404) {
        return null // Not a member
      }

      throw error
    }
  }

  /**
     * @description Finds a branch in a repository
     * @route POST /find-branch
     * @operationName Find Branch
     * @category Branches
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Branch Name","name":"branch","required":true,"description":"The name of the branch to find."}
     *
     * @returns {Object}
     * @sampleResult {"name":"main","commit":{"sha":"c5b97d5ae6c19d5c5df71a34c7fbe5a4fd0e6133","url":"https://api.github.com/repos/octocat/Hello-World/commits/c5b97d5ae6c19d5c5df71a34c7fbe5a4fd0e6133"},"protected":true}
     */
  async findBranch(repository, branch) {
    const { owner, repo } = this.#parseRepository(repository)

    try {
      return await this.#apiRequest({
        url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/branches/${ branch }`,
      })
    } catch (error) {
      if (error.status === 404) {
        return null
      }

      throw error
    }
  }

  /**
     * @description Finds an organization by name
     * @route POST /find-organization
     * @operationName Find Organization
     * @category Organizations
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Organization Name","name":"org","required":true,"description":"The name of the organization."}
     *
     * @returns {Object}
     * @sampleResult {"login":"github","id":1,"node_id":"MDEyOk9yZ2FuaXphdGlvbjE=","url":"https://api.github.com/orgs/github","repos_url":"https://api.github.com/orgs/github/repos","events_url":"https://api.github.com/orgs/github/events","hooks_url":"https://api.github.com/orgs/github/hooks","issues_url":"https://api.github.com/orgs/github/issues","members_url":"https://api.github.com/orgs/github/members{/member}","public_members_url":"https://api.github.com/orgs/github/public_members{/member}","avatar_url":"https://github.com/images/error/octocat_happy.gif","description":"A great organization"}
     */
  async findOrganization(org) {
    try {
      return await this.#apiRequest({
        url: `${ API_BASE_URL }/orgs/${ org }`,
      })
    } catch (error) {
      if (error.status === 404) {
        return null
      }

      throw error
    }
  }

  /**
     * @description Finds a repository by owner and name
     * @route POST /find-repository
     * @operationName Find Repository
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     *
     * @returns {Object}
     * @sampleResult {"id":1296269,"node_id":"MDEwOlJlcG9zaXRvcnkxMjk2MjY5","name":"Hello-World","full_name":"octocat/Hello-World","private":false,"owner":{"login":"octocat","id":1},"html_url":"https://github.com/octocat/Hello-World","description":"This is your first repo!","fork":false,"url":"https://api.github.com/repos/octocat/Hello-World","created_at":"2011-01-26T19:01:12Z","updated_at":"2011-01-26T19:14:43Z","pushed_at":"2011-01-26T19:06:43Z","git_url":"git://github.com/octocat/Hello-World.git","ssh_url":"git@github.com:octocat/Hello-World.git","clone_url":"https://github.com/octocat/Hello-World.git","svn_url":"https://svn.github.com/octocat/Hello-World","homepage":"https://github.com","size":108,"stargazers_count":80,"watchers_count":80,"language":"C","has_issues":true,"has_projects":true,"has_downloads":true,"has_wiki":true,"has_pages":false,"forks_count":9,"mirror_url":null,"archived":false,"disabled":false,"open_issues_count":0,"license":{"key":"mit","name":"MIT License","spdx_id":"MIT","url":"https://api.github.com/licenses/mit","node_id":"MDc6TGljZW5zZTEz"},"allow_forking":true,"is_template":false,"topics":["octocat","atom","electron","api"],"visibility":"public","forks":9,"open_issues":0,"watchers":80,"default_branch":"master"}
     */
  async findRepository(repository) {
    const { owner, repo } = this.#parseRepository(repository)

    try {
      return await this.#apiRequest({
        url: `${ API_BASE_URL }/repos/${ owner }/${ repo }`,
      })
    } catch (error) {
      if (error.status === 404) {
        return null
      }

      throw error
    }
  }

  /**
     * @description Finds an issue by number
     * @route POST /find-issue
     * @operationName Find Issue
     * @category Issues
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Issue Number","name":"issue_number","required":true,"description":"The number of the issue."}
     *
     * @returns {Object}
     * @sampleResult {"url":"https://api.github.com/repos/octocat/Hello-World/issues/1347","repository_url":"https://api.github.com/repos/octocat/Hello-World","labels_url":"https://api.github.com/repos/octocat/Hello-World/issues/1347/labels{/name}","comments_url":"https://api.github.com/repos/octocat/Hello-World/issues/1347/comments","events_url":"https://api.github.com/repos/octocat/Hello-World/issues/1347/events","html_url":"https://github.com/octocat/Hello-World/issues/1347","id":1,"node_id":"MDU6SXNzdWUx","number":1347,"title":"Found a bug","user":{"login":"octocat","id":1},"labels":[{"id":208045946,"node_id":"MDU6TGFiZWwyMDgwNDU5NDY=","url":"https://api.github.com/repos/octocat/Hello-World/labels/bug","name":"bug","color":"f29513","default":true}],"state":"open","locked":false,"assignee":null,"assignees":[],"milestone":null,"comments":0,"created_at":"2011-04-22T13:33:48Z","updated_at":"2011-04-22T13:33:48Z","closed_at":null,"author_association":"OWNER","active_lock_reason":"too heated","body":"I'm having a problem with this.","reactions":{"url":"https://api.github.com/repos/octocat/Hello-World/issues/1347/reactions","total_count":0,"+1":0,"-1":0,"laugh":0,"hooray":0,"confused":0,"heart":0,"rocket":0,"eyes":0},"timeline_url":"https://api.github.com/repos/octocat/Hello-World/issues/1347/timeline","performed_via_github_app":null,"state_reason":"completed"}
     */
  async findIssue(repository, issue_number) {
    const { owner, repo } = this.#parseRepository(repository)

    try {
      return await this.#apiRequest({
        url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/issues/${ issue_number }`,
      })
    } catch (error) {
      if (error.status === 404) {
        return null
      }

      throw error
    }
  }

  /**
     * @description Finds a pull request by number
     * @route POST /find-pull-request
     * @operationName Find Pull Request
     * @category Pull Requests
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Pull Request Number","name":"pull_number","required":true,"description":"The number of the pull request."}
     *
     * @returns {Object}
     * @sampleResult {"url":"https://api.github.com/repos/octocat/Hello-World/pulls/1347","id":1,"node_id":"MDExOlB1bGxSZXF1ZXN0MQ==","html_url":"https://github.com/octocat/Hello-World/pull/1347","diff_url":"https://github.com/octocat/Hello-World/pull/1347.diff","patch_url":"https://github.com/octocat/Hello-World/pull/1347.patch","issue_url":"https://api.github.com/repos/octocat/Hello-World/issues/1347","commits_url":"https://api.github.com/repos/octocat/Hello-World/pulls/1347/commits","review_comments_url":"https://api.github.com/repos/octocat/Hello-World/pulls/1347/comments","review_comment_url":"https://api.github.com/repos/octocat/Hello-World/pulls/comments{/number}","comments_url":"https://api.github.com/repos/octocat/Hello-World/issues/1347/comments","statuses_url":"https://api.github.com/repos/octocat/Hello-World/statuses/6dcb09b5b57875f334f61aebed695e2e4193db5e","number":1347,"state":"open","locked":true,"title":"Amazing new feature","user":{"login":"octocat","id":1},"body":"Please pull these awesome changes in!","created_at":"2011-01-26T19:01:12Z","updated_at":"2011-01-26T19:01:12Z","closed_at":"2011-01-26T19:01:12Z","merged_at":"2011-01-26T19:01:12Z","merge_commit_sha":"e5bd3914e1e96877412767374d16f761a2ce236b","assignee":null,"assignees":[],"requested_reviewers":[],"requested_teams":[],"labels":[],"milestone":null,"draft":false,"commits":3,"additions":100,"deletions":3,"changed_files":5}
     */
  async findPullRequest(repository, pull_number) {
    const { owner, repo } = this.#parseRepository(repository)

    try {
      return await this.#apiRequest({
        url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/pulls/${ pull_number }`,
      })
    } catch (error) {
      if (error.status === 404) {
        return null
      }

      throw error
    }
  }

  /**
     * @description Finds a user by username
     * @route POST /find-user
     * @operationName Find User
     * @category Users
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Username","name":"username","required":true,"description":"The username to find."}
     *
     * @returns {Object}
     * @sampleResult {"login":"octocat","id":1,"node_id":"MDQ6VXNlcjE=","avatar_url":"https://github.com/images/error/octocat_happy.gif","gravatar_id":"","url":"https://api.github.com/users/octocat","html_url":"https://github.com/octocat","followers_url":"https://api.github.com/users/octocat/followers","following_url":"https://api.github.com/users/octocat/following{/other_user}","gists_url":"https://api.github.com/users/octocat/gists{/gist_id}","starred_url":"https://api.github.com/users/octocat/starred{/owner}{/repo}","subscriptions_url":"https://api.github.com/users/octocat/subscriptions","organizations_url":"https://api.github.com/users/octocat/orgs","repos_url":"https://api.github.com/users/octocat/repos","events_url":"https://api.github.com/users/octocat/events{/privacy}","received_events_url":"https://api.github.com/users/octocat/received_events","type":"User","site_admin":false,"name":"monalisa octocat","company":"GitHub","blog":"https://github.com/blog","location":"San Francisco","email":"octocat@github.com","hireable":false,"bio":"There once was...","twitter_username":"monatheoctocat","public_repos":2,"public_gists":1,"followers":20,"following":0,"created_at":"2008-01-14T04:33:35Z","updated_at":"2008-01-14T04:33:35Z"}
     */
  async findUser(username) {
    try {
      return await this.#apiRequest({
        url: `${ API_BASE_URL }/users/${ username }`,
      })
    } catch (error) {
      if (error.status === 404) {
        return null
      }

      throw error
    }
  }

  /**
     * @description Finds an issue by title or creates a new one if not found
     * @route POST /find-or-create-issue
     * @operationName Find or Create Issue
     * @category Issues
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The title of the issue."}
     * @paramDef {"type":"String","label":"Body","name":"body","description":"The body of the issue (used if creating new).","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     *
     * @returns {Object}
     * @sampleResult {"url":"https://api.github.com/repos/octocat/Hello-World/issues/1347","id":1,"number":1347,"title":"Found a bug","state":"open","body":"I'm having a problem with this."}
     */
  async findOrCreateIssue(repository, title, body) {
    const { owner, repo } = this.#parseRepository(repository)

    // 1. Search for existing issue
    const searchResponse = await this.#apiRequest({
      url: `${ API_BASE_URL }/search/issues`,
      query: {
        q: `repo:${ owner }/${ repo } is:issue "${ title }" in:title`,
        per_page: 1,
      },
    })

    if (searchResponse.items && searchResponse.items.length > 0) {
      // Found it!
      return searchResponse.items[0]
    }

    // 2. Create new issue if not found
    const requestBody = this.#cleanObject({
      title,
      body,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/issues`,
      method: 'post',
      body: requestBody,
    })
  }

  /**
     * @description Finds a pull request by title or creates a new one if not found
     * @route POST /find-or-create-pull-request
     * @operationName Find or Create Pull Request
     * @category Pull Requests
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The title of the pull request."}
     * @paramDef {"type":"String","label":"Head Branch","name":"head","required":true,"description":"The name of the branch where your changes are implemented.","dictionary":"getBranchesDictionary","dependsOn":["repository"]}
     * @paramDef {"type":"String","label":"Base Branch","name":"base","required":true,"description":"The name of the branch you want the changes pulled into.","dictionary":"getBranchesDictionary","dependsOn":["repository"]}
     * @paramDef {"type":"String","label":"Body","name":"body","description":"The contents of the pull request (used if creating new).","uiComponent":{"type":"MULTI_LINE_TEXT"}}
     *
     * @returns {Object}
     * @sampleResult {"url":"https://api.github.com/repos/octocat/Hello-World/pulls/1347","id":1,"number":1347,"title":"New Feature","state":"open","body":"Please pull these awesome changes in!"}
     */
  async findOrCreatePullRequest(repository, title, head, base, body) {
    const { owner, repo } = this.#parseRepository(repository)

    // 1. Search for existing PR
    const searchResponse = await this.#apiRequest({
      url: `${ API_BASE_URL }/search/issues`,
      query: {
        q: `repo:${ owner }/${ repo } is:pr "${ title }" in:title`,
        per_page: 1,
      },
    })

    if (searchResponse.items && searchResponse.items.length > 0) {
      // Found it! (Note: Search API returns issue objects for PRs, but they contain PR links)
      // We should fetch the full PR object
      const prNumber = searchResponse.items[0].number

      return await this.#apiRequest({
        url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/pulls/${ prNumber }`,
      })
    }

    // 2. Create new PR if not found
    const requestBody = this.#cleanObject({
      title,
      head,
      base,
      body,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/pulls`,
      method: 'post',
      body: requestBody,
    })
  }

  /**
     * @description Searches for repositories across GitHub using GitHub's search syntax (e.g. "tetris language:assembly stars:>100"). Returns matching repositories ranked by best match, or by the optional sort and order parameters. Results are paginated and the response includes the total number of matches and an incomplete_results flag indicating whether the search timed out before completion.
     * @route POST /search-repositories
     * @operationName Search Repositories
     * @category Search
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"The search query using GitHub search syntax (e.g. \"tetris language:assembly stars:>100\")."}
     * @paramDef {"type":"String","label":"Sort","name":"sort","description":"The field to sort results by. Default: best match.","uiComponent":{"type":"DROPDOWN","options":{"values":["Stars","Forks","Help Wanted Issues","Updated"]}}}
     * @paramDef {"type":"String","label":"Order","name":"order","description":"The sort order. Default: desc.","uiComponent":{"type":"DROPDOWN","options":{"values":["Descending","Ascending"]}}}
     * @paramDef {"type":"Number","label":"Per Page","name":"perPage","description":"Number of results per page (max 100). Default: 30.","uiComponent":{"type":"NUMERIC_STEPPER"}}
     * @paramDef {"type":"Number","label":"Page","name":"page","description":"Page number of the results to fetch. Default: 1.","uiComponent":{"type":"NUMERIC_STEPPER"}}
     *
     * @returns {Object}
     * @sampleResult {"total_count":40,"incomplete_results":false,"items":[{"id":3081286,"name":"Tetris","full_name":"dtrupenn/Tetris","owner":{"login":"dtrupenn","id":872147},"private":false,"html_url":"https://github.com/dtrupenn/Tetris","description":"A C implementation of Tetris using Pennsim","stargazers_count":1,"language":"Assembly","forks_count":0}]}
     */
  async searchRepositories(query, sort, order, perPage, page) {
    const searchQuery = this.#cleanObject({
      q: query,
      sort: this.#resolveChoice(sort, { Stars: 'stars', Forks: 'forks', 'Help Wanted Issues': 'help-wanted-issues', Updated: 'updated' }),
      order: this.#resolveChoice(order, { Descending: 'desc', Ascending: 'asc' }),
      per_page: perPage,
      page,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/search/repositories`,
      query: searchQuery,
    })
  }

  /**
     * @description Searches issues and pull requests across GitHub using GitHub's search syntax. GitHub's issue search covers both issues and pull requests, so results may include either type; you can scope the query with qualifiers such as "is:issue", "is:pr", "repo:owner/name", "is:open" or "label:bug". Results are paginated and the response includes the total number of matches and an incomplete_results flag.
     * @route POST /search-issues
     * @operationName Search Issues and Pull Requests
     * @category Search
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"The search query using GitHub search syntax (e.g. \"repo:octocat/Hello-World is:issue is:open label:bug\")."}
     * @paramDef {"type":"String","label":"Sort","name":"sort","description":"The field to sort results by. Default: best match.","uiComponent":{"type":"DROPDOWN","options":{"values":["Comments","Created","Updated"]}}}
     * @paramDef {"type":"String","label":"Order","name":"order","description":"The sort order. Default: desc.","uiComponent":{"type":"DROPDOWN","options":{"values":["Descending","Ascending"]}}}
     * @paramDef {"type":"Number","label":"Per Page","name":"perPage","description":"Number of results per page (max 100). Default: 30.","uiComponent":{"type":"NUMERIC_STEPPER"}}
     * @paramDef {"type":"Number","label":"Page","name":"page","description":"Page number of the results to fetch. Default: 1.","uiComponent":{"type":"NUMERIC_STEPPER"}}
     *
     * @returns {Object}
     * @sampleResult {"total_count":280,"incomplete_results":false,"items":[{"id":35802,"number":132,"title":"Line Number Indexes Beyond 20 Not Displayed","state":"open","html_url":"https://github.com/octocat/Spoon-Knife/issues/132","user":{"login":"Nick3C","id":90254},"labels":[{"name":"bug"}],"comments":15,"created_at":"2009-07-12T20:10:41Z","updated_at":"2009-07-19T09:23:43Z","body":"You should add a method..."}]}
     */
  async searchIssues(query, sort, order, perPage, page) {
    const searchQuery = this.#cleanObject({
      q: query,
      sort: this.#resolveChoice(sort, { Comments: 'comments', Created: 'created', Updated: 'updated' }),
      order: this.#resolveChoice(order, { Descending: 'desc', Ascending: 'asc' }),
      per_page: perPage,
      page,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/search/issues`,
      query: searchQuery,
    })
  }

  // ======================================== ACTIONS (WORKFLOWS) ========================================

  /**
     * @description Lists all GitHub Actions workflows defined in a repository. Returns the total count and the workflow definitions, including each workflow's ID, name, path, and current state.
     * @route POST /list-workflows
     * @operationName List Workflows
     * @category Actions
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"Number","label":"Per Page","name":"perPage","description":"Number of results per page (max 100). Default: 30.","uiComponent":{"type":"NUMERIC_STEPPER"}}
     * @paramDef {"type":"Number","label":"Page","name":"page","description":"Page number of the results to fetch. Default: 1.","uiComponent":{"type":"NUMERIC_STEPPER"}}
     *
     * @returns {Object}
     * @sampleResult {"total_count":2,"workflows":[{"id":161335,"node_id":"MDg6V29ya2Zsb3cxNjEzMzU=","name":"CI","path":".github/workflows/ci.yml","state":"active","created_at":"2020-01-08T23:48:37.000-08:00","updated_at":"2020-01-08T23:50:21.000-08:00","url":"https://api.github.com/repos/octocat/Hello-World/actions/workflows/161335","html_url":"https://github.com/octocat/Hello-World/blob/master/.github/workflows/ci.yml","badge_url":"https://github.com/octocat/Hello-World/workflows/CI/badge.svg"}]}
     */
  async listWorkflows(repository, perPage, page) {
    const { owner, repo } = this.#parseRepository(repository)

    const query = this.#cleanObject({
      per_page: perPage,
      page,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/actions/workflows`,
      query,
    })
  }

  /**
     * @description Lists GitHub Actions workflow runs for a repository. Optionally scope the results to a single workflow by providing a workflow ID or filename, and filter by branch, triggering event, run status, or the user who triggered the run.
     * @route POST /list-workflow-runs
     * @operationName List Workflow Runs
     * @category Actions
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Workflow","name":"workflowId","description":"A workflow ID or filename to scope runs to. Leave empty to list runs across all workflows.","dictionary":"getWorkflowsDictionary","dependsOn":["repository"]}
     * @paramDef {"type":"String","label":"Branch","name":"branch","description":"Returns runs associated with a branch name.","dictionary":"getBranchesDictionary","dependsOn":["repository"]}
     * @paramDef {"type":"String","label":"Event","name":"event","description":"Returns runs triggered by the event specified (e.g. push, pull_request, workflow_dispatch)."}
     * @paramDef {"type":"String","label":"Status","name":"status","description":"Returns runs with the check run status or conclusion specified.","uiComponent":{"type":"DROPDOWN","options":{"values":["Queued","In Progress","Completed","Success","Failure","Cancelled","Skipped","Timed Out","Action Required"]}}}
     * @paramDef {"type":"String","label":"Actor","name":"actor","description":"Returns runs triggered by the user with this login.","dictionary":"getUsersDictionary"}
     * @paramDef {"type":"Number","label":"Per Page","name":"perPage","description":"Number of results per page (max 100). Default: 30.","uiComponent":{"type":"NUMERIC_STEPPER"}}
     * @paramDef {"type":"Number","label":"Page","name":"page","description":"Page number of the results to fetch. Default: 1.","uiComponent":{"type":"NUMERIC_STEPPER"}}
     *
     * @returns {Object}
     * @sampleResult {"total_count":1,"workflow_runs":[{"id":30433642,"name":"CI","node_id":"MDEyOldvcmtmbG93IFJ1bjI2OTI4OQ==","head_branch":"main","head_sha":"acb5820ced9479c074f688cc328bf03f341a511d","run_number":562,"event":"push","status":"completed","conclusion":"success","workflow_id":161335,"url":"https://api.github.com/repos/octocat/Hello-World/actions/runs/30433642","html_url":"https://github.com/octocat/Hello-World/actions/runs/30433642","created_at":"2020-01-22T19:33:08Z","updated_at":"2020-01-22T19:33:08Z"}]}
     */
  async listWorkflowRuns(repository, workflowId, branch, event, status, actor, perPage, page) {
    const { owner, repo } = this.#parseRepository(repository)

    const query = this.#cleanObject({
      branch,
      event,
      status: this.#resolveChoice(status, { Queued: 'queued', 'In Progress': 'in_progress', Completed: 'completed', Success: 'success', Failure: 'failure', Cancelled: 'cancelled', Skipped: 'skipped', 'Timed Out': 'timed_out', 'Action Required': 'action_required' }),
      actor,
      per_page: perPage,
      page,
    })

    const url = workflowId
      ? `${ API_BASE_URL }/repos/${ owner }/${ repo }/actions/workflows/${ workflowId }/runs`
      : `${ API_BASE_URL }/repos/${ owner }/${ repo }/actions/runs`

    return await this.#apiRequest({ url, query })
  }

  /**
     * @description Retrieves a single GitHub Actions workflow run by its ID, returning the full run object including status, conclusion, triggering event, commit, timing, and related URLs.
     * @route POST /get-workflow-run
     * @operationName Get Workflow Run
     * @category Actions
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Run ID","name":"runId","required":true,"description":"The unique identifier of the workflow run."}
     *
     * @returns {Object}
     * @sampleResult {"id":30433642,"name":"CI","node_id":"MDEyOldvcmtmbG93IFJ1bjI2OTI4OQ==","head_branch":"main","head_sha":"acb5820ced9479c074f688cc328bf03f341a511d","run_number":562,"event":"push","status":"completed","conclusion":"success","workflow_id":161335,"url":"https://api.github.com/repos/octocat/Hello-World/actions/runs/30433642","html_url":"https://github.com/octocat/Hello-World/actions/runs/30433642","created_at":"2020-01-22T19:33:08Z","updated_at":"2020-01-22T19:33:08Z"}
     */
  async getWorkflowRun(repository, runId) {
    const { owner, repo } = this.#parseRepository(repository)

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/actions/runs/${ runId }`,
    })
  }

  /**
     * @description Lists the jobs that belong to a GitHub Actions workflow run. By default returns jobs from the latest attempt; set the filter to 'all' to include jobs from previous attempts. Each job includes its status, conclusion, steps, and timing.
     * @route POST /list-workflow-run-jobs
     * @operationName List Workflow Run Jobs
     * @category Actions
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Run ID","name":"runId","required":true,"description":"The unique identifier of the workflow run."}
     * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Filters jobs by their attempt. Default: latest.","uiComponent":{"type":"DROPDOWN","options":{"values":["Latest","All"]}}}
     * @paramDef {"type":"Number","label":"Per Page","name":"perPage","description":"Number of results per page (max 100). Default: 30.","uiComponent":{"type":"NUMERIC_STEPPER"}}
     * @paramDef {"type":"Number","label":"Page","name":"page","description":"Page number of the results to fetch. Default: 1.","uiComponent":{"type":"NUMERIC_STEPPER"}}
     *
     * @returns {Object}
     * @sampleResult {"total_count":1,"jobs":[{"id":399444496,"run_id":30433642,"node_id":"MDg6Q2hlY2tSdW4zOTk0NDQ0OTY=","head_sha":"acb5820ced9479c074f688cc328bf03f341a511d","status":"completed","conclusion":"success","name":"build","started_at":"2020-01-20T17:42:40Z","completed_at":"2020-01-20T17:44:39Z","steps":[{"name":"Set up job","status":"completed","conclusion":"success","number":1}],"url":"https://api.github.com/repos/octocat/Hello-World/actions/jobs/399444496","html_url":"https://github.com/octocat/Hello-World/runs/399444496"}]}
     */
  async listWorkflowRunJobs(repository, runId, filter, perPage, page) {
    const { owner, repo } = this.#parseRepository(repository)

    const query = this.#cleanObject({
      filter: this.#resolveChoice(filter, { Latest: 'latest', All: 'all' }),
      per_page: perPage,
      page,
    })

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/actions/runs/${ runId }/jobs`,
      query,
    })
  }

  /**
     * @description Manually triggers a GitHub Actions workflow that defines a 'workflow_dispatch' event. Specify the git ref (branch or tag) to run on and any inputs the workflow defines. GitHub returns no content on success, so this method returns { success: true }.
     * @route POST /trigger-workflow-dispatch
     * @operationName Trigger Workflow
     * @category Actions
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Workflow","name":"workflowId","required":true,"description":"The workflow ID or filename to run.","dictionary":"getWorkflowsDictionary","dependsOn":["repository"]}
     * @paramDef {"type":"String","label":"Ref","name":"ref","required":true,"description":"The git reference (branch or tag) the workflow run should use.","dictionary":"getBranchesDictionary","dependsOn":["repository"]}
     * @paramDef {"type":"Object","label":"Inputs","name":"inputs","description":"Key/value inputs that must match the workflow's defined workflow_dispatch inputs."}
     *
     * @returns {Object}
     * @sampleResult {"success":true}
     */
  async triggerWorkflowDispatch(repository, workflowId, ref, inputs) {
    const { owner, repo } = this.#parseRepository(repository)

    const requestBody = this.#cleanObject({
      ref,
      inputs,
    })

    await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/actions/workflows/${ workflowId }/dispatches`,
      method: 'post',
      body: requestBody,
    })

    return { success: true }
  }

  // ======================================== TRIGGERS ========================================

  /**
     * @description Triggers when a new issue is opened in a repository
     * @registerAs POLLING_TRIGGER
     * @route POST /on-issue-opened
     * @operationName On Issue Opened
     * @category Issues
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     *
     * @returns {Object}
     * @sampleResult {"action":"opened","issue":{"url":"https://api.github.com/repos/octocat/Hello-World/issues/1347","repository_url":"https://api.github.com/repos/octocat/Hello-World","labels_url":"https://api.github.com/repos/octocat/Hello-World/issues/1347/labels{/name}","comments_url":"https://api.github.com/repos/octocat/Hello-World/issues/1347/comments","events_url":"https://api.github.com/repos/octocat/Hello-World/issues/1347/events","html_url":"https://github.com/octocat/Hello-World/issues/1347","id":1,"node_id":"MDU6SXNzdWUx","number":1347,"title":"Found a bug","user":{"login":"octocat"},"labels":[{"id":208045946,"node_id":"MDU6TGFiZWwyMDgwNDU5NDY=","url":"https://api.github.com/repos/octocat/Hello-World/labels/bug","name":"bug","color":"f29513","default":true}],"state":"open","locked":false,"assignee":null,"assignees":[],"milestone":null,"comments":0,"created_at":"2011-04-22T13:33:48Z","updated_at":"2011-04-22T13:33:48Z","closed_at":null,"author_association":"OWNER","body":"I'm having a problem with this.","reactions":{"url":"https://api.github.com/repos/octocat/Hello-World/issues/1347/reactions","total_count":0,"+1":0,"-1":0,"laugh":0,"hooray":0,"confused":0,"heart":0,"rocket":0,"eyes":0},"timeline_url":"https://api.github.com/repos/octocat/Hello-World/issues/1347/timeline","performed_via_github_app":null,"state_reason":null},"sender":{"login":"octocat"}}
     */
  async onIssueOpened(invocation) {
    const { owner, repo } = this.#parseRepository(invocation.params.repository)

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/issues/events`,
      query: { per_page: 30, sort: 'created', direction: 'desc' },
    })

    // Scan the recent events page for the most recent 'opened' event so newer activity
    // (labeled, commented, closed, ...) on top doesn't mask a fresh issue open.
    const openedEvent = (response || []).find(e => e.event === 'opened' && e.issue)

    if (openedEvent) {
      return {
        action: 'opened',
        issue: openedEvent.issue,
        sender: openedEvent.actor,
      }
    }

    return null
  }

  /**
     * @description Triggers when a new pull request is opened in a repository
     * @registerAs POLLING_TRIGGER
     * @route POST /on-pull-request-opened
     * @operationName On Pull Request Opened
     * @category Pull Requests
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     *
     * @returns {Object}
     * @sampleResult {"action":"opened","number":1,"pull_request":{"url":"https://api.github.com/repos/octocat/Hello-World/pulls/1","id":1,"node_id":"MDExOlB1bGxSZXF1ZXN0MQ==","html_url":"https://github.com/octocat/Hello-World/pull/1","diff_url":"https://github.com/octocat/Hello-World/pull/1.diff","patch_url":"https://github.com/octocat/Hello-World/pull/1.patch","issue_url":"https://api.github.com/repos/octocat/Hello-World/issues/1","number":1,"state":"open","locked":false,"title":"New feature","user":{"login":"octocat"},"body":"Please review this.","created_at":"2024-01-01T12:00:00Z","updated_at":"2024-01-01T12:00:00Z","closed_at":null,"merged_at":null,"merge_commit_sha":"e5bd3914e1e96877412767374d16f761a2ce236b","assignee":null,"assignees":[],"requested_reviewers":[],"requested_teams":[],"labels":[],"milestone":null,"draft":false,"commits_url":"https://api.github.com/repos/octocat/Hello-World/pulls/1/commits","review_comments_url":"https://api.github.com/repos/octocat/Hello-World/pulls/1/comments","review_comment_url":"https://api.github.com/repos/octocat/Hello-World/pulls/comments{/number}","comments_url":"https://api.github.com/repos/octocat/Hello-World/issues/1/comments","statuses_url":"https://api.github.com/repos/octocat/Hello-World/statuses/6dcb09b5b57875f334f61aebed695e2e4193db5e","head":{"label":"octocat:new-feature","ref":"new-feature","sha":"6dcb09b5b57875f334f61aebed695e2e4193db5e","user":{"login":"octocat"},"repo":{"id":1296269,"node_id":"MDEwOlJlcG9zaXRvcnkxMjk2MjY5","name":"Hello-World","full_name":"octocat/Hello-World","private":false,"owner":{"login":"octocat"}}},"base":{"label":"octocat:main","ref":"main","sha":"f95f8dce33246490d8b16b240d0d457485f4924a","user":{"login":"octocat"},"repo":{"id":1296269,"node_id":"MDEwOlJlcG9zaXRvcnkxMjk2MjY5","name":"Hello-World","full_name":"octocat/Hello-World","private":false,"owner":{"login":"octocat"}}}},"repository":{"id":1296269,"node_id":"MDEwOlJlcG9zaXRvcnkxMjk2MjY5","name":"Hello-World","full_name":"octocat/Hello-World","private":false,"owner":{"login":"octocat"}},"sender":{"login":"octocat"}}
     */
  async onPullRequestOpened(invocation) {
    const { owner, repo } = this.#parseRepository(invocation.params.repository)

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/pulls`,
      query: { state: 'open', sort: 'created', direction: 'desc', per_page: 1 },
    })

    const latestPull = response[0]

    if (latestPull && latestPull.created_at === latestPull.updated_at) { // Check if it's newly created
      return {
        action: 'opened',
        number: latestPull.number,
        pull_request: latestPull,
        repository: latestPull.base?.repo,
        sender: latestPull.user,
      }
    }

    return null
  }

  /**
     * @description Triggers when a new commit is pushed to a repository
     * @registerAs POLLING_TRIGGER
     * @route POST /on-push
     * @operationName On Push
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Branch","name":"branch","description":"The branch to monitor for pushes. Leave empty to monitor all branches.","dictionary":"getBranchesDictionary","dependsOn":["repository"]}
     *
     * @returns {Object}
     * @sampleResult {"ref":"refs/heads/main","before":"0000000000000000000000000000000000000000","after":"c477c19d22383b06798097241234567890abcdef","repository":{"id":1296269,"node_id":"MDEwOlJlcG9zaXRvcnkxMjk2MjY5","name":"Hello-World","full_name":"octocat/Hello-World","private":false,"owner":{"login":"octocat"}},"pusher":{"name":"octocat","email":"octocat@github.com"},"created":true,"deleted":false,"forced":false,"base_ref":null,"compare":"https://github.com/octocat/Hello-World/compare/0000000000000000000000000000000000000000...c477c19d22383b06798097241234567890abcdef","commits":[{"id":"c477c19d22383b06798097241234567890abcdef","tree_id":"a11d01f22383b06798097241234567890abcdef","distinct":true,"message":"Initial commit","timestamp":"2024-01-01T12:00:00Z","url":"https://github.com/octocat/Hello-World/commit/c477c19d22383b06798097241234567890abcdef","author":{"name":"octocat","email":"octocat@github.com","username":"octocat"},"committer":{"name":"octocat","email":"octocat@github.com","username":"octocat"},"added":["README.md"],"removed":[],"modified":[]}]}
     */
  async onPush(invocation) {
    const { owner, repo } = this.#parseRepository(invocation.params.repository)
    const branch = invocation.params.branch

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/events`,
      query: { per_page: 1 },
    })

    const latestEvent = response[0]

    if (latestEvent && latestEvent.type === 'PushEvent' && latestEvent.payload) {
      const ref = latestEvent.payload.ref.split('/').pop()

      if (!branch || ref === branch) {
        return latestEvent.payload
      }
    }

    return null
  }

  /**
     * @description Triggers when a new star is added to a repository
     * @registerAs POLLING_TRIGGER
     * @route POST /on-star
     * @operationName On Star
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     *
     * @returns {Object}
     * @sampleResult {"action":"created","starred_at":"2024-01-01T12:00:00Z","sender":{"login":"octocat"}}
     */
  async onStar(invocation) {
    const { owner, repo } = this.#parseRepository(invocation.params.repository)

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/stargazers`,
      query: { per_page: 1, sort: 'created', direction: 'desc' },
      headers: { 'Accept': 'application/vnd.github.v3.star+json' }, // To get starred_at
    })

    const latestStar = response[0]

    if (latestStar && latestStar.starred_at) {
      return {
        action: 'created',
        starred_at: latestStar.starred_at,
        sender: latestStar.user,
      }
    }

    return null
  }

  /**
     * @description Triggers when a new release is published in a repository
     * @registerAs POLLING_TRIGGER
     * @route POST /on-release-published
     * @operationName On Release Published
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     *
     * @returns {Object}
     * @sampleResult {"action":"published","release":{"url":"https://api.github.com/repos/octocat/Hello-World/releases/1","id":1,"node_id":"MDc6UmVsZWFzZTE=","tag_name":"v1.0.0","target_commitish":"main","name":"v1.0.0","body":"Description of the release","draft":false,"prerelease":false,"created_at":"2024-01-01T12:00:00Z","published_at":"2024-01-01T12:00:00Z","author":{"login":"octocat"}},"sender":{"login":"octocat"}}
     */
  async onReleasePublished(invocation) {
    const { owner, repo } = this.#parseRepository(invocation.params.repository)

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/releases`,
      query: { per_page: 1, sort: 'created', direction: 'desc' },
    })

    const latestRelease = response[0]

    if (latestRelease && latestRelease.published_at && !latestRelease.draft) {
      return {
        action: 'published',
        release: latestRelease,
        sender: latestRelease.author,
      }
    }

    return null
  }

  /**
     * @description Triggers when a new branch is created in a repository
     * @registerAs POLLING_TRIGGER
     * @route POST /on-new-branch
     * @operationName New Branch
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     *
     * @returns {Object}
     * @sampleResult {"ref":"refs/heads/new-feature","node_id":"MDM6UmVmMTk2MTY0Mzpyzdfs","url":"https://api.github.com/repos/owner/repo/git/refs/heads/new-feature","object":{"sha":"aa218f562","type":"commit","url":"https://api.github.com/repos/owner/repo/git/commits/aa218f562"}}
     */
  async onNewBranch(invocation) {
    const { owner, repo } = this.#parseRepository(invocation.params.repository)

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/branches`,
      query: { per_page: 100 },
    })

    // Return the most recently created branch
    if (response && response.length > 0) {
      return response[0]
    }

    return null
  }

  /**
     * @description Triggers when a new commit comment is created
     * @registerAs POLLING_TRIGGER
     * @route POST /on-new-commit-comment
     * @operationName New Commit Comment
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     *
     * @returns {Object}
     * @sampleResult {"html_url":"https://github.com/owner/repo/commit/abc#commitcomment-1","url":"https://api.github.com/repos/owner/repo/comments/1","id":1,"node_id":"MDEzOkNvbW1pdENvbW1lbnQx","body":"Great commit!","user":{"login":"octocat"},"created_at":"2011-04-14T16:00:49Z"}
     */
  async onNewCommitComment(invocation) {
    const { owner, repo } = this.#parseRepository(invocation.params.repository)

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/comments`,
      query: { per_page: 1 },
    })

    if (response && response.length > 0) {
      return response[0]
    }

    return null
  }

  /**
     * @description Triggers on any repository event
     * @registerAs POLLING_TRIGGER
     * @route POST /on-new-repo-event
     * @operationName New Repo Event
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     *
     * @returns {Object}
     * @sampleResult {"id":"12345","type":"PushEvent","actor":{"login":"octocat"},"repo":{"name":"owner/repo"},"created_at":"2011-09-06T17:26:27Z"}
     */
  async onNewRepoEvent(invocation) {
    const { owner, repo } = this.#parseRepository(invocation.params.repository)

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/events`,
      query: { per_page: 1 },
    })

    if (response && response.length > 0) {
      return response[0]
    }

    return null
  }

  /**
     * @description Triggers on any GitHub event for the authenticated user
     * @registerAs POLLING_TRIGGER
     * @route POST /on-new-global-event
     * @operationName New Global Event
     * @category Users
     * @appearanceColor #24292f #57606a
     *
     * @returns {Object}
     * @sampleResult {"id":"12345","type":"WatchEvent","actor":{"login":"octocat"},"repo":{"name":"owner/repo"},"created_at":"2011-09-06T17:26:27Z"}
     */
  async onNewGlobalEvent(invocation) {
    const user = await this.#apiRequest({
      url: `${ API_BASE_URL }/user`,
    })

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/users/${ user.login }/events`,
      query: { per_page: 1 },
    })

    if (response && response.length > 0) {
      return response[0]
    }

    return null
  }

  /**
     * @description Triggers when a new label is created in a repository
     * @registerAs POLLING_TRIGGER
     * @route POST /on-new-label
     * @operationName New Label
     * @category Issues
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     *
     * @returns {Object}
     * @sampleResult {"id":208045946,"node_id":"MDU6TGFiZWwyMDgwNDU5NDY=","url":"https://api.github.com/repos/owner/repo/labels/bug","name":"bug","color":"f29513","default":true,"description":"Something isn't working"}
     */
  async onNewLabel(invocation) {
    const { owner, repo } = this.#parseRepository(invocation.params.repository)

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/labels`,
      query: { per_page: 100 },
    })

    if (response && response.length > 0) {
      return response[0]
    }

    return null
  }

  /**
     * @description Triggers when a new milestone is created in a repository
     * @registerAs POLLING_TRIGGER
     * @route POST /on-new-milestone
     * @operationName New Milestone
     * @category Issues
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     *
     * @returns {Object}
     * @sampleResult {"url":"https://api.github.com/repos/owner/repo/milestones/1","html_url":"https://github.com/owner/repo/milestones/v1.0","id":1002604,"number":1,"state":"open","title":"v1.0","description":"Tracking milestone for version 1.0","creator":{"login":"octocat"},"open_issues":4,"closed_issues":8,"created_at":"2011-04-10T20:09:31Z","updated_at":"2014-03-03T18:58:10Z","closed_at":null,"due_on":"2012-10-09T23:39:01Z"}
     */
  async onNewMilestone(invocation) {
    const { owner, repo } = this.#parseRepository(invocation.params.repository)

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/milestones`,
      query: { per_page: 100, state: 'all', sort: 'created', direction: 'desc' },
    })

    if (response && response.length > 0) {
      return response[0]
    }

    return null
  }

  /**
     * @description Triggers when a new collaborator is added to a repository
     * @registerAs POLLING_TRIGGER
     * @route POST /on-new-collaborator
     * @operationName New Collaborator
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     *
     * @returns {Object}
     * @sampleResult {"login":"octocat","id":1,"node_id":"MDQ6VXNlcjE=","avatar_url":"https://github.com/images/error/octocat_happy.gif","permissions":{"admin":false,"push":true,"pull":true},"role_name":"write"}
     */
  async onNewCollaborator(invocation) {
    const { owner, repo } = this.#parseRepository(invocation.params.repository)

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/collaborators`,
      query: { per_page: 100 },
    })

    if (response && response.length > 0) {
      return response[0]
    }

    return null
  }

  /**
     * @description Triggers when a new commit is pushed to a repository
     * @registerAs POLLING_TRIGGER
     * @route POST /on-new-commit
     * @operationName New Commit
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     * @paramDef {"type":"String","label":"Branch","name":"branch","description":"Branch to monitor (leave empty for default branch)","dictionary":"getBranchesDictionary","dependsOn":["repository"]}
     *
     * @returns {Object}
     * @sampleResult {"sha":"6dcb09b5b57875f334f61aebed695e2e4193db5e","node_id":"MDY6Q29tbWl0NmRjYjA5YjViNTc4NzVmMzM0ZjYxYWViZWQ2OTVlMmU0MTkzZGI1ZQ==","commit":{"author":{"name":"Monalisa Octocat","email":"support@github.com","date":"2011-04-14T16:00:49Z"},"committer":{"name":"Monalisa Octocat","email":"support@github.com","date":"2011-04-14T16:00:49Z"},"message":"Fix all the bugs","tree":{"sha":"6dcb09b5b57875f334f61aebed695e2e4193db5e","url":"https://api.github.com/repos/owner/repo/tree/6dcb09b5b57875f334f61aebed695e2e4193db5e"}}}
     */
  async onNewCommit(invocation) {
    const { owner, repo } = this.#parseRepository(invocation.params.repository)
    const branch = invocation.params.branch || 'main'

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/commits`,
      query: { sha: branch, per_page: 1 },
    })

    if (response && response.length > 0) {
      return response[0]
    }

    return null
  }

  /**
     * @description Triggers when a new gist is created
     * @registerAs POLLING_TRIGGER
     * @route POST /on-new-gist
     * @operationName New Gist
     * @category Gists
     * @appearanceColor #24292f #57606a
     *
     * @returns {Object}
     * @sampleResult {"url":"https://api.github.com/gists/aa5a315d61ae9438b18d","id":"aa5a315d61ae9438b18d","description":"Hello World Examples","public":true,"owner":{"login":"octocat"},"created_at":"2010-04-14T02:15:15Z","updated_at":"2011-06-20T11:34:15Z"}
     */
  async onNewGist(invocation) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/gists`,
      query: { per_page: 1 },
    })

    if (response && response.length > 0) {
      return response[0]
    }

    return null
  }

  /**
     * @description Triggers when the authenticated user is mentioned
     * @registerAs POLLING_TRIGGER
     * @route POST /on-new-mention
     * @operationName New Mention
     * @category Notifications
     * @appearanceColor #24292f #57606a
     *
     * @returns {Object}
     * @sampleResult {"id":"1","reason":"mention","unread":true,"updated_at":"2014-11-07T22:01:45Z","last_read_at":null,"subject":{"title":"Greetings","url":"https://api.github.com/repos/owner/repo/issues/1","type":"Issue"},"repository":{"id":1296269,"name":"Hello-World","full_name":"octocat/Hello-World"}}
     */
  async onNewMention(invocation) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/notifications`,
      query: { per_page: 100 },
    })

    const mentions = (response || []).filter(n => n.reason === 'mention')

    if (mentions.length > 0) {
      return mentions[0]
    }

    return null
  }

  /**
     * @description Triggers when a new notification is received
     * @registerAs POLLING_TRIGGER
     * @route POST /on-new-notification
     * @operationName New Notification
     * @category Notifications
     * @appearanceColor #24292f #57606a
     *
     * @returns {Object}
     * @sampleResult {"id":"1","reason":"subscribed","unread":true,"updated_at":"2014-11-07T22:01:45Z","last_read_at":null,"subject":{"title":"Greetings","url":"https://api.github.com/repos/owner/repo/issues/1","type":"Issue"},"repository":{"id":1296269,"name":"Hello-World","full_name":"octocat/Hello-World"}}
     */
  async onNewNotification(invocation) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/notifications`,
      query: { per_page: 1 },
    })

    if (response && response.length > 0) {
      return response[0]
    }

    return null
  }

  /**
     * @description Triggers when the user joins a new organization
     * @registerAs POLLING_TRIGGER
     * @route POST /on-new-organization
     * @operationName New Organization
     * @category Organizations
     * @appearanceColor #24292f #57606a
     *
     * @returns {Object}
     * @sampleResult {"login":"github","id":1,"node_id":"MDEyOk9yZ2FuaXphdGlvbjE=","url":"https://api.github.com/orgs/github","description":"How people build software"}
     */
  async onNewOrganization(invocation) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/user/orgs`,
      query: { per_page: 100 },
    })

    if (response && response.length > 0) {
      return response[0]
    }

    return null
  }

  /**
     * @description Triggers when a review is requested from the user
     * @registerAs POLLING_TRIGGER
     * @route POST /on-new-review-request
     * @operationName New Review Request
     * @category Pull Requests
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     *
     * @returns {Object}
     * @sampleResult {"url":"https://api.github.com/repos/owner/repo/pulls/1","id":1,"number":1,"state":"open","title":"new-feature","user":{"login":"octocat"},"created_at":"2011-01-26T19:01:12Z","requested_reviewers":[{"login":"other-user"}]}
     */
  async onNewReviewRequest(invocation) {
    const { owner, repo } = this.#parseRepository(invocation.params.repository)

    const user = await this.#apiRequest({
      url: `${ API_BASE_URL }/user`,
    })

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/pulls`,
      query: { state: 'open', per_page: 100 },
    })

    const reviewRequests = (response || []).filter(pr =>
      pr.requested_reviewers && pr.requested_reviewers.some(r => r.login === user.login)
    )

    if (reviewRequests.length > 0) {
      return reviewRequests[0]
    }

    return null
  }

  /**
     * @description Triggers when a new watcher (stargazer) is added to a repository
     * @registerAs POLLING_TRIGGER
     * @route POST /on-new-watcher
     * @operationName New Watcher
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @paramDef {"type":"String","label":"Repository","name":"repository","required":true,"description":"Repository in format owner/repo","dictionary":"getRepositoriesDictionary"}
     *
     * @returns {Object}
     * @sampleResult {"login":"octocat","id":1,"node_id":"MDQ6VXNlcjE=","avatar_url":"https://github.com/images/error/octocat_happy.gif","url":"https://api.github.com/users/octocat"}
     */
  async onNewWatcher(invocation) {
    const { owner, repo } = this.#parseRepository(invocation.params.repository)

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/repos/${ owner }/${ repo }/subscribers`,
      query: { per_page: 1 },
    })

    if (response && response.length > 0) {
      return response[0]
    }

    return null
  }

  /**
     * @description Triggers when a new repository is created
     * @registerAs POLLING_TRIGGER
     * @route POST /on-new-repository
     * @operationName New Repository
     * @category Repositories
     * @appearanceColor #24292f #57606a
     *
     * @returns {Object}
     * @sampleResult {"id":1296269,"node_id":"MDEwOlJlcG9zaXRvcnkxMjk2MjY5","name":"Hello-World","full_name":"octocat/Hello-World","owner":{"login":"octocat"},"private":false,"description":"This your first repo!","created_at":"2011-01-26T19:01:12Z"}
     */
  async onNewRepository(invocation) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/user/repos`,
      query: { per_page: 1, sort: 'created', direction: 'desc' },
    })

    if (response && response.length > 0) {
      return response[0]
    }

    return null
  }

  /**
     * @description Triggers when the user joins a new team
     * @registerAs POLLING_TRIGGER
     * @route POST /on-new-team
     * @operationName New Team
     * @category Organizations
     * @appearanceColor #24292f #57606a
     *
     * @returns {Object}
     * @sampleResult {"id":1,"node_id":"MDQ6VGVhbTE=","url":"https://api.github.com/teams/1","name":"Justice League","description":"A great team.","slug":"justice-league","permission":"admin","privacy":"closed"}
     */
  async onNewTeam(invocation) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/user/teams`,
      query: { per_page: 100 },
    })

    if (response && response.length > 0) {
      return response[0]
    }

    return null
  }
}

Flowrunner.ServerCode.addService(GitHub, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth App Client ID from your GitHub OAuth App at https://github.com/settings/developers.',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth App Client Secret from your GitHub OAuth App at https://github.com/settings/developers.',
  },
])

module.exports = GitHub

