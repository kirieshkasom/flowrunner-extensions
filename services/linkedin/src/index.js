'use strict'

const API_BASE_URL = 'https://api.linkedin.com'
const OAUTH_AUTHORIZE_URL = 'https://www.linkedin.com/oauth/v2/authorization'
const OAUTH_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken'
const USER_INFO_URL = `${ API_BASE_URL }/v2/userinfo`

// LinkedIn versioned (/rest) APIs require a Linkedin-Version header in YYYYMM format.
// 202606 is the current default marketing version (verified from Microsoft Learn docs, 2026-06).
const LINKEDIN_VERSION = '202606'

const DEFAULT_SCOPE_LIST = [
  'openid',
  'profile',
  'email',
  'w_member_social',
  'r_organization_social',
  'w_organization_social',
  'rw_organization_admin',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const VISIBILITY_OPTIONS = {
  'Public': 'PUBLIC',
  'Connections': 'CONNECTIONS',
  'Logged-In Members': 'LOGGED_IN',
}

const logger = {
  info: (...args) => console.log('[LinkedIn] info:', ...args),
  debug: (...args) => console.log('[LinkedIn] debug:', ...args),
  error: (...args) => console.log('[LinkedIn] error:', ...args),
  warn: (...args) => console.log('[LinkedIn] warn:', ...args),
}

/**
 * @requireOAuth
 * @usesFileStorage
 * @integrationName LinkedIn
 * @integrationIcon /icon.svg
 **/
class LinkedInService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  // ============================================ HELPERS ==============================================

  /**
   * Single private request helper — all versioned (/rest) and legacy (/v2) calls route through here.
   * `rest: true` adds the LinkedIn-Version and X-Restli-Protocol-Version headers required by /rest endpoints.
   */
  async #apiRequest({ url, method = 'get', body, query, headers, rest = false, logTag }) {
    if (query) {
      query = cleanupObject(query)
    }

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=[${ JSON.stringify(query || {}) }]`)

      const request = Flowrunner.Request[method](url)
        .set(this.#buildHeaders(rest, headers))
        .query(query || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const detail = error.body || {}
      const message = detail.message || error.message
      const serviceErrorCode = detail.serviceErrorCode
      const status = error.status || error.statusCode || detail.status

      logger.error(`${ logTag } - failed (status=${ status }, code=${ serviceErrorCode }): ${ message }`)

      throw new Error(
        `LinkedIn API error: ${ message }` +
        (serviceErrorCode !== undefined ? ` (serviceErrorCode ${ serviceErrorCode })` : '') +
        (status !== undefined ? ` [HTTP ${ status }]` : '')
      )
    }
  }

  #buildHeaders(rest, extra) {
    const headers = {
      'Authorization': `Bearer ${ this.request.headers['oauth-access-token'] }`,
      'Content-Type': 'application/json',
    }

    if (rest) {
      headers['LinkedIn-Version'] = LINKEDIN_VERSION
      headers['X-Restli-Protocol-Version'] = '2.0.0'
    }

    return { ...headers, ...(extra || {}) }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #encodeUrn(urn) {
    if (!urn) {
      throw new Error('"Post URN" is required')
    }

    // Already-encoded URNs are passed through unchanged.
    return urn.includes('%3A') ? urn : encodeURIComponent(urn)
  }

  /**
   * Resolves the author URN for a post. Accepts a full URN (urn:li:person:X / urn:li:organization:Y),
   * a bare organization id, or nothing (defaults to the authenticated member via /v2/userinfo).
   */
  async #resolveAuthorUrn(author) {
    if (!author) {
      const me = await this.#apiRequest({ logTag: 'resolveAuthor', url: USER_INFO_URL })

      return `urn:li:person:${ me.sub }`
    }

    if (author.startsWith('urn:li:')) {
      return author
    }

    // Bare numeric id — treat as organization.
    return `urn:li:organization:${ author }`
  }

  #buildPostBody({ authorUrn, commentary, visibility, content }) {
    const body = {
      author: authorUrn,
      commentary: commentary || '',
      visibility: this.#resolveChoice(visibility || 'Public', VISIBILITY_OPTIONS),
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    }

    if (content) {
      body.content = content
    }

    return body
  }

  /**
   * Creates a post via POST /rest/posts. LinkedIn returns 201 with an empty body and the new
   * post URN in the x-restli-id response header. Flowrunner.Request returns the body directly,
   * so we surface a normalized result and, when available, echo the author for convenience.
   */
  async #createPost(body, logTag) {
    const response = await this.#apiRequest({
      logTag,
      method: 'post',
      url: `${ API_BASE_URL }/rest/posts`,
      rest: true,
      body,
    })

    const postUrn = response?.id ||
      response?.['x-restli-id'] ||
      (response?.headers && response.headers['x-restli-id'])

    return {
      success: true,
      postUrn: postUrn || null,
      author: body.author,
      message: postUrn
        ? 'Post created successfully.'
        : 'Post created. The post URN is returned by LinkedIn in the x-restli-id response header.',
    }
  }

  // ============================================= OAUTH ================================================

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('response_type', 'code')
    params.append('client_id', this.clientId)
    params.append('scope', this.scopes)

    const connectionURL = `${ OAUTH_AUTHORIZE_URL }?${ params.toString() }`

    logger.debug(`composed connectionURL: ${ connectionURL }`)

    return connectionURL
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   *
   * @property {String} token
   * @property {String} [refreshToken]
   * @property {Number} [expirationInSeconds]
   * @property {Object} [userData]
   * @property {Boolean} [overwrite]
   * @property {String} connectionIdentityName
   * @property {String} [connectionIdentityImageURL]
   */

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    const params = new URLSearchParams()

    params.append('grant_type', 'authorization_code')
    params.append('code', callbackObject.code)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)

    const codeExchangeResponse = await Flowrunner.Request.post(OAUTH_TOKEN_URL)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    let userData = {}
    let connectionIdentityName = 'LinkedIn Account'
    let connectionIdentityImageURL = null

    try {
      userData = await Flowrunner.Request
        .get(USER_INFO_URL)
        .set({ Authorization: `Bearer ${ codeExchangeResponse.access_token }` })

      if (userData.name || userData.email) {
        connectionIdentityName = userData.name
          ? (userData.email ? `${ userData.name } (${ userData.email })` : userData.name)
          : userData.email
      }

      connectionIdentityImageURL = userData.picture || null
    } catch (error) {
      logger.error(`[executeCallback] userinfo error: ${ error.message }`)
    }

    return {
      token: codeExchangeResponse.access_token,
      expirationInSeconds: codeExchangeResponse.expires_in,
      refreshToken: codeExchangeResponse.refresh_token,
      connectionIdentityName,
      connectionIdentityImageURL,
      overwrite: true,
      userData,
    }
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   *
   * @property {String} token
   * @property {Number} [expirationInSeconds]
   * @property {String} [refreshToken]
   */

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    try {
      const params = new URLSearchParams()

      params.append('grant_type', 'refresh_token')
      params.append('refresh_token', refreshToken)
      params.append('client_id', this.clientId)
      params.append('client_secret', this.clientSecret)

      const { access_token, expires_in, refresh_token } = await Flowrunner.Request.post(OAUTH_TOKEN_URL)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      return {
        token: access_token,
        expirationInSeconds: expires_in,
        refreshToken: refresh_token || refreshToken,
      }
    } catch (error) {
      logger.error(`refreshToken error: ${ error.message }`)

      if (error.body?.error === 'invalid_grant') {
        throw new Error(
          'Refresh token expired or invalid. Note that refreshable tokens are only issued to apps ' +
          'approved for programmatic refresh; otherwise the member must re-authenticate.'
        )
      }

      throw error
    }
  }

  // ========================================== DICTIONARIES ===========================================

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
   * @typedef {Object} getOrganizationsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter organizations by name. Filtering is applied locally to the retrieved page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination start index for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Organizations Dictionary
   * @description Lists LinkedIn company pages (organizations) the connected member administers, for selecting a post author. Returns the organization name as the label and its full URN (urn:li:organization:{id}) as the value. Requires the 'rw_organization_admin' or 'r_organization_social' scope and Community Management API approval.
   * @route POST /get-organizations-dictionary
   * @paramDef {"type":"getOrganizationsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Devtestco","value":"urn:li:organization:2414183","note":"ADMINISTRATOR"}],"cursor":"10"}
   */
  async getOrganizationsDictionary(payload) {
    const { search, cursor } = payload || {}
    const start = cursor ? Number(cursor) : 0

    const aclResponse = await this.#apiRequest({
      logTag: 'getOrganizationsDictionary',
      url: `${ API_BASE_URL }/v2/organizationalEntityAcls`,
      rest: true,
      query: {
        q: 'roleAssignee',
        state: 'APPROVED',
        start,
        count: 20,
      },
    })

    const elements = aclResponse.elements || []
    const items = []

    for (const acl of elements) {
      const orgUrn = acl.organizationalTarget
      const orgId = orgUrn ? orgUrn.split(':').pop() : null

      let name = orgUrn

      if (orgId) {
        try {
          const org = await this.#apiRequest({
            logTag: 'getOrganizationsDictionary:org',
            url: `${ API_BASE_URL }/v2/organizations/${ orgId }`,
            rest: true,
          })

          name = org.localizedName || org.name?.localized?.en_US || orgUrn
        } catch (error) {
          logger.warn(`getOrganizationsDictionary - could not resolve name for ${ orgUrn }: ${ error.message }`)
        }
      }

      items.push({ label: name, value: orgUrn, note: acl.role })
    }

    const filtered = search
      ? items.filter(item => String(item.label).toLowerCase().includes(search.toLowerCase()))
      : items

    return {
      items: filtered,
      cursor: elements.length === 20 ? String(start + 20) : undefined,
    }
  }

  // ============================================ PROFILE ==============================================

  /**
   * @description Retrieves the connected member's LinkedIn profile using the OpenID Connect userinfo endpoint. Returns the member's OpenID subject id ('sub'), full name, given/family name, email, locale, and profile picture URL. The 'sub' value is the person id used to build the author URN for posts (urn:li:person:{sub}). Requires the 'openid', 'profile', and 'email' scopes.
   *
   * @route GET /get-my-profile
   * @operationName Get My Profile
   * @category Profile
   *
   * @returns {Object}
   * @sampleResult {"sub":"782bbtaQ","name":"Jane Doe","given_name":"Jane","family_name":"Doe","email":"jane@example.com","email_verified":true,"locale":"en-US","picture":"https://media.licdn.com/dms/image/abc/profile.jpg"}
   */
  async getMyProfile() {
    return this.#apiRequest({
      logTag: 'getMyProfile',
      url: USER_INFO_URL,
    })
  }

  // ============================================= POSTS ===============================================

  /**
   * @description Creates an organic text post (share) on LinkedIn via the versioned Posts API. Posts by default as the authenticated member (urn:li:person:{sub}); pass an Organization URN as the Author to post as a company page (requires Community Management API approval and an admin role). Optionally attach an article link (source URL, title, description) rendered as a link preview card — note LinkedIn does not scrape the URL, so the title and description must be supplied. For image posts, use Create Image Post instead. Commentary supports LinkedIn mention and hashtag annotation syntax. Requires the 'w_member_social' scope (member) or 'w_organization_social' (organization).
   *
   * @route POST /create-post
   * @operationName Create Post
   * @category Posts
   *
   * @paramDef {"type":"String","label":"Commentary","name":"commentary","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The main text of the post. Supports LinkedIn annotations for mentions (e.g. '@[Name](urn:li:organization:123)') and hashtags (e.g. '#example')."}
   * @paramDef {"type":"String","label":"Author","name":"author","dictionary":"getOrganizationsDictionary","description":"The post author. Leave empty to post as the connected member. To post as a company page, provide an organization URN (urn:li:organization:{id}) or select one from the list. A bare numeric id is treated as an organization id."}
   * @paramDef {"type":"String","label":"Visibility","name":"visibility","defaultValue":"Public","uiComponent":{"type":"DROPDOWN","options":{"values":["Public","Connections","Logged-In Members"]}},"description":"Who can see the post. 'Public' is visible to everyone, 'Connections' to the member's connections (member posts only), 'Logged-In Members' to any signed-in LinkedIn member. Default: 'Public'."}
   * @paramDef {"type":"String","label":"Article Link","name":"articleUrl","description":"Optional URL of an external article to attach as a link preview card. When provided, an article card is rendered using the Article Title and Article Description fields (LinkedIn does not scrape the page)."}
   * @paramDef {"type":"String","label":"Article Title","name":"articleTitle","description":"Title shown on the article link preview card. Used only when Article Link is provided."}
   * @paramDef {"type":"String","label":"Article Description","name":"articleDescription","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Description shown on the article link preview card. Used only when Article Link is provided."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"postUrn":"urn:li:share:6844785523593134080","author":"urn:li:person:782bbtaQ","message":"Post created successfully."}
   */
  async createPost(commentary, author, visibility, articleUrl, articleTitle, articleDescription) {
    if (!commentary) {
      throw new Error('"Commentary" is required')
    }

    const authorUrn = await this.#resolveAuthorUrn(author)

    let content

    if (articleUrl) {
      content = {
        article: cleanupObject({
          source: articleUrl,
          title: articleTitle,
          description: articleDescription,
        }),
      }
    }

    const body = this.#buildPostBody({ authorUrn, commentary, visibility, content })

    return this.#createPost(body, 'createPost')
  }

  /**
   * @description Creates a LinkedIn image post in one call by orchestrating LinkedIn's multi-step image flow: (1) POST /rest/images?action=initializeUpload to register the upload and obtain an upload URL and image URN, (2) download the image bytes from the supplied Flowrunner file URL and PUT them to that upload URL, then (3) create a post via POST /rest/posts with content.media set to the new image URN. Posts as the connected member by default; pass an Organization URN as the Author to post as a company page. Accepts JPG, PNG, or GIF images under ~36 megapixels. Requires the 'w_member_social' scope (member) or 'w_organization_social' (organization).
   *
   * @route POST /create-image-post
   * @operationName Create Image Post
   * @category Posts
   *
   * @paramDef {"type":"String","label":"Image URL","name":"imageUrl","required":true,"description":"Publicly reachable URL of the image to upload (e.g. a Flowrunner file URL). The image bytes are fetched and uploaded to LinkedIn. Supported formats: JPG, PNG, GIF; under ~36 megapixels."}
   * @paramDef {"type":"String","label":"Commentary","name":"commentary","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The main text of the post. Supports LinkedIn mention and hashtag annotation syntax."}
   * @paramDef {"type":"String","label":"Alt Text","name":"altText","description":"Alternative text describing the image for screen-reader accessibility. Recommended under 120 characters; maximum 4,086."}
   * @paramDef {"type":"String","label":"Author","name":"author","dictionary":"getOrganizationsDictionary","description":"The post author. Leave empty to post as the connected member. To post as a company page, provide an organization URN (urn:li:organization:{id}) or select one from the list."}
   * @paramDef {"type":"String","label":"Visibility","name":"visibility","defaultValue":"Public","uiComponent":{"type":"DROPDOWN","options":{"values":["Public","Connections","Logged-In Members"]}},"description":"Who can see the post. 'Public' is visible to everyone, 'Connections' to the member's connections (member posts only), 'Logged-In Members' to any signed-in LinkedIn member. Default: 'Public'."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"postUrn":"urn:li:share:6844785523593134080","imageUrn":"urn:li:image:C4E10AQFoyyAjHPMQuQ","author":"urn:li:person:782bbtaQ","message":"Post created successfully."}
   */
  async createImagePost(imageUrl, commentary, altText, author, visibility) {
    if (!imageUrl) {
      throw new Error('"Image URL" is required')
    }

    if (!commentary) {
      throw new Error('"Commentary" is required')
    }

    const authorUrn = await this.#resolveAuthorUrn(author)

    // Step 1 — initialize the upload to get an upload URL and image URN.
    const initResponse = await this.#apiRequest({
      logTag: 'createImagePost:init',
      method: 'post',
      url: `${ API_BASE_URL }/rest/images?action=initializeUpload`,
      rest: true,
      body: { initializeUploadRequest: { owner: authorUrn } },
    })

    const uploadUrl = initResponse?.value?.uploadUrl
    const imageUrn = initResponse?.value?.image

    if (!uploadUrl || !imageUrn) {
      throw new Error('LinkedIn did not return an upload URL for the image.')
    }

    // Step 2 — download the source bytes and PUT them to the upload URL.
    const downloaded = await Flowrunner.Request.get(imageUrl).setEncoding(null)
    const buffer = Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(downloaded)

    try {
      await Flowrunner.Request.put(uploadUrl)
        .set({ 'Authorization': `Bearer ${ this.request.headers['oauth-access-token'] }` })
        .send(buffer)
    } catch (error) {
      const message = error.body?.message || error.message

      logger.error(`createImagePost:upload - failed: ${ message }`)

      throw new Error(`LinkedIn image upload failed: ${ message }`)
    }

    // Step 3 — create the post referencing the new image URN.
    const content = { media: cleanupObject({ id: imageUrn, altText }) }
    const body = this.#buildPostBody({ authorUrn, commentary, visibility, content })

    const result = await this.#createPost(body, 'createImagePost')

    return { ...result, imageUrn }
  }

  /**
   * @description Retrieves a single LinkedIn post by its URN (a share URN 'urn:li:share:{id}' or UGC post URN 'urn:li:ugcPost:{id}'). Returns the post's author, commentary, visibility, distribution, content, and lifecycle metadata. Retrieving another member's posts requires the restricted 'r_member_social' scope; organization posts require 'r_organization_social'.
   *
   * @route GET /get-post
   * @operationName Get Post
   * @category Posts
   *
   * @paramDef {"type":"String","label":"Post URN","name":"postUrn","required":true,"description":"The URN of the post to retrieve, e.g. 'urn:li:share:6844785523593134080' or 'urn:li:ugcPost:6844785523593134080'. The URN is URL-encoded automatically."}
   *
   * @returns {Object}
   * @sampleResult {"id":"urn:li:share:6844785523593134080","author":"urn:li:person:782bbtaQ","commentary":"Sample text Post","visibility":"PUBLIC","lifecycleState":"PUBLISHED","distribution":{"feedDistribution":"MAIN_FEED"},"createdAt":1634790968743}
   */
  async getPost(postUrn) {
    return this.#apiRequest({
      logTag: 'getPost',
      url: `${ API_BASE_URL }/rest/posts/${ this.#encodeUrn(postUrn) }`,
      rest: true,
    })
  }

  /**
   * @description Permanently deletes a LinkedIn post by its URN (share or UGC post URN). Deletion is idempotent — deleting an already-deleted post still succeeds. The connected member must be the author (or an admin of the authoring organization). Requires the 'w_member_social' or 'w_organization_social' scope.
   *
   * @route DELETE /delete-post
   * @operationName Delete Post
   * @category Posts
   *
   * @paramDef {"type":"String","label":"Post URN","name":"postUrn","required":true,"description":"The URN of the post to delete, e.g. 'urn:li:share:6844785523593134080' or 'urn:li:ugcPost:6844785523593134080'. The URN is URL-encoded automatically."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Post deleted successfully.","postUrn":"urn:li:share:6844785523593134080"}
   */
  async deletePost(postUrn) {
    await this.#apiRequest({
      logTag: 'deletePost',
      method: 'delete',
      url: `${ API_BASE_URL }/rest/posts/${ this.#encodeUrn(postUrn) }`,
      rest: true,
      headers: { 'X-RestLi-Method': 'DELETE' },
    })

    return {
      success: true,
      message: 'Post deleted successfully.',
      postUrn,
    }
  }

  // ========================================= ORGANIZATIONS ===========================================

  /**
   * @description Lists the LinkedIn company pages (organizations) the connected member administers, returning each organization's URN and the member's role (e.g. ADMINISTRATOR, CONTENT_ADMIN). Use the returned organization URNs as the Author when posting as a company page. Requires the 'rw_organization_admin' or 'r_organization_social' scope and Community Management API approval.
   *
   * @route GET /get-my-organizations
   * @operationName Get My Organizations
   * @category Organizations
   *
   * @paramDef {"type":"Number","label":"Start","name":"start","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based index of the first result to return, for pagination. Default: 0."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of access-control entries to return per page. Default: 20."}
   *
   * @returns {Object}
   * @sampleResult {"elements":[{"organizationalTarget":"urn:li:organization:2414183","role":"ADMINISTRATOR","state":"APPROVED","roleAssignee":"urn:li:person:782bbtaQ"}],"paging":{"start":0,"count":20}}
   */
  async getMyOrganizations(start, count) {
    return this.#apiRequest({
      logTag: 'getMyOrganizations',
      url: `${ API_BASE_URL }/v2/organizationalEntityAcls`,
      rest: true,
      query: {
        q: 'roleAssignee',
        start: start || 0,
        count: count || 20,
      },
    })
  }

  /**
   * @description Retrieves details about a single LinkedIn organization (company page) by its numeric id or URN, including its localized name, vanity name, description, and website. The connected member must administer the organization. Requires the 'rw_organization_admin' or 'r_organization_social' scope.
   *
   * @route GET /get-organization
   * @operationName Get Organization
   * @category Organizations
   *
   * @paramDef {"type":"String","label":"Organization","name":"organization","required":true,"dictionary":"getOrganizationsDictionary","description":"The organization to retrieve, as a numeric id (e.g. '2414183') or full URN (e.g. 'urn:li:organization:2414183'). Select from the list or provide the id directly."}
   *
   * @returns {Object}
   * @sampleResult {"id":2414183,"localizedName":"Devtestco","vanityName":"devtestco","localizedWebsite":"https://example.com","localizedDescription":"A sample company page."}
   */
  async getOrganization(organization) {
    if (!organization) {
      throw new Error('"Organization" is required')
    }

    const orgId = organization.startsWith('urn:li:') ? organization.split(':').pop() : organization

    return this.#apiRequest({
      logTag: 'getOrganization',
      url: `${ API_BASE_URL }/v2/organizations/${ orgId }`,
      rest: true,
    })
  }

  // ======================================== SOCIAL ACTIONS ===========================================

  /**
   * @description Adds a comment to a LinkedIn post on behalf of the connected member (or an administered organization). The comment is created via the Social Actions API on the target post or comment URN. Requires the 'w_member_social' scope (member) or 'w_organization_social' (organization).
   *
   * @route POST /create-comment
   * @operationName Create Comment
   * @category Social Actions
   *
   * @paramDef {"type":"String","label":"Post URN","name":"postUrn","required":true,"description":"The URN of the post (or parent comment) to comment on, e.g. 'urn:li:share:6844785523593134080' or 'urn:li:ugcPost:6844785523593134080'. URL-encoded automatically."}
   * @paramDef {"type":"String","label":"Message","name":"message","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text of the comment."}
   * @paramDef {"type":"String","label":"Actor","name":"actor","dictionary":"getOrganizationsDictionary","description":"The URN commenting. Leave empty to comment as the connected member. To comment as a company page, provide an organization URN (urn:li:organization:{id}) or select one from the list."}
   *
   * @returns {Object}
   * @sampleResult {"actor":"urn:li:person:782bbtaQ","object":"urn:li:share:6844785523593134080","message":{"text":"Great post!"},"created":{"time":1634790968743},"id":"urn:li:comment:(urn:li:share:6844785523593134080,6844790000000000000)"}
   */
  async createComment(postUrn, message, actor) {
    if (!postUrn) {
      throw new Error('"Post URN" is required')
    }

    if (!message) {
      throw new Error('"Message" is required')
    }

    const actorUrn = await this.#resolveAuthorUrn(actor)

    return this.#apiRequest({
      logTag: 'createComment',
      method: 'post',
      url: `${ API_BASE_URL }/rest/socialActions/${ this.#encodeUrn(postUrn) }/comments`,
      rest: true,
      body: {
        actor: actorUrn,
        message: { text: message },
      },
    })
  }

  /**
   * @description Lists the comments on a LinkedIn post, returning each comment's actor, text, and creation time. Supports pagination via start and count. Requires read access to the post's social actions ('r_member_social' or 'r_organization_social').
   *
   * @route GET /get-comments
   * @operationName Get Comments
   * @category Social Actions
   *
   * @paramDef {"type":"String","label":"Post URN","name":"postUrn","required":true,"description":"The URN of the post to fetch comments for, e.g. 'urn:li:share:6844785523593134080' or 'urn:li:ugcPost:6844785523593134080'. URL-encoded automatically."}
   * @paramDef {"type":"Number","label":"Start","name":"start","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based index of the first comment to return, for pagination. Default: 0."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of comments to return per page. Default: 10."}
   *
   * @returns {Object}
   * @sampleResult {"paging":{"start":0,"count":10,"total":1},"elements":[{"actor":"urn:li:person:782bbtaQ","object":"urn:li:share:6844785523593134080","message":{"text":"Great post!"},"created":{"time":1634790968743},"id":"urn:li:comment:(urn:li:share:6844785523593134080,6844790000000000000)"}]}
   */
  async getComments(postUrn, start, count) {
    if (!postUrn) {
      throw new Error('"Post URN" is required')
    }

    return this.#apiRequest({
      logTag: 'getComments',
      url: `${ API_BASE_URL }/rest/socialActions/${ this.#encodeUrn(postUrn) }/comments`,
      rest: true,
      query: {
        start: start || 0,
        count: count || 10,
      },
    })
  }

  /**
   * @description Adds a like to a LinkedIn post on behalf of the connected member (or an administered organization) via the Social Actions API. Requires the 'w_member_social' scope (member) or 'w_organization_social' (organization).
   *
   * @route POST /like-post
   * @operationName Like Post
   * @category Social Actions
   *
   * @paramDef {"type":"String","label":"Post URN","name":"postUrn","required":true,"description":"The URN of the post to like, e.g. 'urn:li:share:6844785523593134080' or 'urn:li:ugcPost:6844785523593134080'. URL-encoded automatically."}
   * @paramDef {"type":"String","label":"Actor","name":"actor","dictionary":"getOrganizationsDictionary","description":"The URN performing the like. Leave empty to like as the connected member. To like as a company page, provide an organization URN (urn:li:organization:{id}) or select one from the list."}
   *
   * @returns {Object}
   * @sampleResult {"actor":"urn:li:person:782bbtaQ","object":"urn:li:share:6844785523593134080","created":{"time":1634790968743},"id":"urn:li:like:(urn:li:person:782bbtaQ,urn:li:share:6844785523593134080)"}
   */
  async likePost(postUrn, actor) {
    if (!postUrn) {
      throw new Error('"Post URN" is required')
    }

    const actorUrn = await this.#resolveAuthorUrn(actor)

    return this.#apiRequest({
      logTag: 'likePost',
      method: 'post',
      url: `${ API_BASE_URL }/rest/socialActions/${ this.#encodeUrn(postUrn) }/likes`,
      rest: true,
      body: {
        actor: actorUrn,
        object: postUrn,
      },
    })
  }
}

Flowrunner.ServerCode.addService(LinkedInService, [
  {
    displayName: 'Client Id',
    defaultValue: '',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your LinkedIn app\'s OAuth 2.0 Client ID from the LinkedIn Developer Portal (Auth tab).',
  },
  {
    displayName: 'Client Secret',
    defaultValue: '',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your LinkedIn app\'s OAuth 2.0 Client Secret from the LinkedIn Developer Portal (Auth tab).',
  },
])

function cleanupObject(data) {
  const result = {}

  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null) {
      result[key] = data[key]
    }
  })

  return result
}
