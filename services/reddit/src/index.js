'use strict'

const AUTHORIZE_URL = 'https://www.reddit.com/api/v1/authorize'
const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token'
const API_BASE_URL = 'https://oauth.reddit.com'

// Reddit blocks or rate-limits (429) requests without a descriptive, unique User-Agent.
const USER_AGENT = 'FlowRunner/1.0 (FlowRunner Reddit Integration)'

const DEFAULT_SCOPE_LIST = [
  'identity',
  'read',
  'submit',
  'edit',
  'vote',
  'history',
  'mysubreddits',
  'subscribe',
  'save',
  'report',
  'privatemessages',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const DEFAULT_LIMIT = 25

const POST_KIND_OPTIONS = {
  'Self': 'self',
  'Link': 'link',
}

const VOTE_DIRECTION_OPTIONS = {
  'Upvote': 1,
  'Downvote': -1,
  'Unvote': 0,
}

const SUBREDDIT_SORT_OPTIONS = {
  'Hot': 'hot',
  'New': 'new',
  'Top': 'top',
  'Rising': 'rising',
}

const TOP_TIMEFRAME_OPTIONS = {
  'Hour': 'hour',
  'Day': 'day',
  'Week': 'week',
  'Month': 'month',
  'Year': 'year',
  'All Time': 'all',
}

const SEARCH_SORT_OPTIONS = {
  'Relevance': 'relevance',
  'Hot': 'hot',
  'New': 'new',
  'Top': 'top',
  'Comments': 'comments',
}

const logger = {
  info: (...args) => console.log('[Reddit] info:', ...args),
  debug: (...args) => console.log('[Reddit] debug:', ...args),
  error: (...args) => console.log('[Reddit] error:', ...args),
  warn: (...args) => console.log('[Reddit] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName Reddit
 * @integrationIcon /icon.png
 **/
class RedditService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  async #apiRequest({ url, method = 'get', body, query, form, logTag }) {
    if (query) {
      query = cleanupObject(query)
    }

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=[${ JSON.stringify(query) }]`)

      const request = Flowrunner.Request[method](url)
        .set({
          'Authorization': `Bearer ${ this.request.headers['oauth-access-token'] }`,
          'User-Agent': USER_AGENT,
        })
        .query(query || {})

      let response

      if (form !== undefined) {
        // Reddit write endpoints expect application/x-www-form-urlencoded bodies.
        response = await request
          .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
          .send(new URLSearchParams(cleanupObject(form)).toString())
      } else if (body !== undefined) {
        response = await request.send(body)
      } else {
        response = await request
      }

      this.#assertNoJsonErrors(response, logTag)

      return response
    } catch (error) {
      const message = this.#extractError(error)

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Reddit API error: ${ message }`)
    }
  }

  // Reddit returns HTTP 200 with { json: { errors: [[code, message, field], ...] } } for
  // api_type=json write calls. Surface those as real errors instead of silent success.
  #assertNoJsonErrors(response, logTag) {
    const errors = response?.json?.errors

    if (Array.isArray(errors) && errors.length) {
      const formatted = errors
        .map(entry => Array.isArray(entry) ? entry.filter(Boolean).join(': ') : String(entry))
        .join('; ')

      logger.error(`${ logTag } - json.errors: ${ formatted }`)

      throw new Error(formatted)
    }
  }

  #extractError(error) {
    if (error.body) {
      const jsonErrors = error.body.json?.errors

      if (Array.isArray(jsonErrors) && jsonErrors.length) {
        return jsonErrors
          .map(entry => Array.isArray(entry) ? entry.filter(Boolean).join(': ') : String(entry))
          .join('; ')
      }

      return error.body.message || error.body.error || error.message
    }

    return error.message
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Reddit responses wrap listings as { kind: "Listing", data: { children: [{ kind, data }], after, before } }.
  // This returns the inner data objects plus the pagination cursor.
  #unwrapListing(response) {
    const listing = response?.data || {}
    const children = Array.isArray(listing.children) ? listing.children : []

    return {
      items: children.map(child => child.data),
      after: listing.after || null,
      before: listing.before || null,
    }
  }

  #cleanSubredditName(subreddit) {
    if (!subreddit) {
      throw new Error('"Subreddit" is required')
    }

    return String(subreddit).trim().replace(/^\/?r\//i, '')
  }

  // ============================================= OAUTH ================================================

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('state', `flowrunner_${ Date.now() }`)
    params.append('duration', 'permanent')
    params.append('scope', this.scopes)

    const connectionURL = `${ AUTHORIZE_URL }?${ params.toString() }`

    logger.debug(`composed connectionURL: ${ connectionURL }`)

    return connectionURL
  }

  #basicAuthHeader() {
    const encoded = Buffer.from(`${ this.clientId }:${ this.clientSecret }`).toString('base64')

    return {
      'Authorization': `Basic ${ encoded }`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    }
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

    const tokenResponse = await Flowrunner.Request.post(TOKEN_URL)
      .set(this.#basicAuthHeader())
      .send(params.toString())

    let userData = {}
    let connectionIdentityName = 'Reddit Account'
    let connectionIdentityImageURL = null

    try {
      userData = await Flowrunner.Request
        .get(`${ API_BASE_URL }/api/v1/me`)
        .set({
          'Authorization': `Bearer ${ tokenResponse.access_token }`,
          'User-Agent': USER_AGENT,
        })

      if (userData.name) {
        connectionIdentityName = `u/${ userData.name }`
      }

      // icon_img may include HTML-escaped query params; strip them for a usable URL.
      const iconImg = userData.icon_img || userData.snoovatar_img || null

      connectionIdentityImageURL = iconImg ? iconImg.split('?')[0] : null
    } catch (error) {
      logger.error(`[executeCallback] /api/v1/me error: ${ error.message }`)
    }

    return {
      token: tokenResponse.access_token,
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token,
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

      const { access_token, expires_in, refresh_token } = await Flowrunner.Request.post(TOKEN_URL)
        .set(this.#basicAuthHeader())
        .send(params.toString())

      return {
        token: access_token,
        expirationInSeconds: expires_in,
        refreshToken: refresh_token || refreshToken,
      }
    } catch (error) {
      logger.error(`refreshToken error: ${ error.message }`)

      if (error.body?.error === 'invalid_grant') {
        throw new Error('Refresh token expired or invalid, please re-authenticate.')
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
   * @typedef {Object} getMySubredditsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter the retrieved subreddits by name or title. Filtering is applied locally to the current page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token ('after' fullname) from a previous response, used to retrieve the next page of subscribed subreddits."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get My Subreddits Dictionary
   * @description Lists the subreddits the connected user is subscribed to, for selection in dependent parameters. Returns the display name (e.g. "r/aww") as the label and the plain subreddit name (e.g. "aww") as the value.
   * @route POST /get-my-subreddits-dictionary
   * @paramDef {"type":"getMySubredditsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"r/aww","value":"aww","note":"Things that make you go AWW!"}],"cursor":"t5_2qh1o"}
   */
  async getMySubredditsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getMySubredditsDictionary',
      url: `${ API_BASE_URL }/subreddits/mine/subscriber`,
      query: {
        limit: 100,
        after: cursor,
      },
    })

    const { items, after } = this.#unwrapListing(response)

    const filtered = search
      ? searchFilter(items, ['display_name', 'title'], search)
      : items

    return {
      cursor: after,
      items: filtered.map(sub => ({
        label: sub.display_name_prefixed || `r/${ sub.display_name }`,
        value: sub.display_name,
        note: sub.public_description || sub.title || '',
      })),
    }
  }

  // ============================================ IDENTITY =============================================

  /**
   * @description Retrieves the profile of the connected Reddit user, including username, account age, karma totals, verification status, and account settings. Requires the 'identity' scope.
   *
   * @route GET /get-me
   * @operationName Get Me
   * @category Identity
   *
   * @returns {Object}
   * @sampleResult {"name":"example_user","id":"abc123","total_karma":15420,"link_karma":8200,"comment_karma":7220,"created_utc":1500000000,"is_gold":false,"verified":true,"icon_img":"https://styles.redditmedia.com/avatar.png"}
   */
  async getMe() {
    return this.#apiRequest({
      logTag: 'getMe',
      url: `${ API_BASE_URL }/api/v1/me`,
    })
  }

  /**
   * @description Retrieves the connected user's karma breakdown per subreddit, returning link karma and comment karma earned in each subreddit they have participated in. Requires the 'identity' scope.
   *
   * @route GET /get-my-karma
   * @operationName Get My Karma
   * @category Identity
   *
   * @returns {Object}
   * @sampleResult {"kind":"KarmaList","data":[{"sr":"aww","comment_karma":120,"link_karma":540},{"sr":"programming","comment_karma":45,"link_karma":10}]}
   */
  async getMyKarma() {
    return this.#apiRequest({
      logTag: 'getMyKarma',
      url: `${ API_BASE_URL }/api/v1/me/karma`,
    })
  }

  /**
   * @description Lists the subreddits the connected user is subscribed to. Returns unwrapped subreddit objects with subscriber counts, descriptions, and settings, plus an 'after' cursor for pagination. Requires the 'mysubreddits' scope.
   *
   * @route GET /get-my-subreddits
   * @operationName Get My Subreddits
   * @category Identity
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of subreddits to return. Maximum: 100. Default: 25."}
   * @paramDef {"type":"String","label":"After","name":"after","description":"Pagination cursor ('after' fullname, e.g. 't5_2qh1o') from a previous response, used to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"display_name":"aww","display_name_prefixed":"r/aww","subscribers":34000000,"public_description":"Things that make you go AWW!"}],"after":"t5_2qh1o","before":null}
   */
  async getMySubreddits(limit, after) {
    const response = await this.#apiRequest({
      logTag: 'getMySubreddits',
      url: `${ API_BASE_URL }/subreddits/mine/subscriber`,
      query: {
        limit: limit || DEFAULT_LIMIT,
        after,
      },
    })

    return this.#unwrapListing(response)
  }

  // =========================================== SUBMISSIONS ===========================================

  /**
   * @description Submits a new post to a subreddit as the connected user. Choose the kind: 'Self' for a text post (uses the Text field) or 'Link' for a link post (uses the URL field). Supports optional flair, NSFW and spoiler flags, and inbox reply subscription. Requires the 'submit' scope. Returns Reddit's json response containing the new post's URL, id, and fullname (t3_...).
   *
   * @route POST /submit-post
   * @operationName Submit Post
   * @category Submissions
   *
   * @paramDef {"type":"String","label":"Subreddit","name":"subreddit","required":true,"dictionary":"getMySubredditsDictionary","description":"The subreddit to post to, without the 'r/' prefix (e.g. 'test'). Select from your subscriptions or type a name directly."}
   * @paramDef {"type":"String","label":"Kind","name":"kind","required":true,"defaultValue":"Self","uiComponent":{"type":"DROPDOWN","options":{"values":["Self","Link"]}},"description":"The post type. 'Self' creates a text post (uses the Text field); 'Link' creates a link post (uses the URL field)."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The post title. Maximum 300 characters."}
   * @paramDef {"type":"String","label":"Text","name":"text","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The body text for a 'Self' post, in Markdown. Ignored for 'Link' posts."}
   * @paramDef {"type":"String","label":"URL","name":"url","description":"The destination URL for a 'Link' post. Required when Kind is 'Link'; ignored for 'Self' posts."}
   * @paramDef {"type":"String","label":"Flair ID","name":"flairId","description":"Optional flair template ID to apply to the post. Obtain valid IDs from the subreddit's link flair settings."}
   * @paramDef {"type":"Boolean","label":"NSFW","name":"nsfw","uiComponent":{"type":"CHECKBOX"},"description":"Mark the post as Not Safe For Work. Default: false."}
   * @paramDef {"type":"Boolean","label":"Spoiler","name":"spoiler","uiComponent":{"type":"CHECKBOX"},"description":"Mark the post as a spoiler. Default: false."}
   * @paramDef {"type":"Boolean","label":"Send Replies To Inbox","name":"sendReplies","uiComponent":{"type":"CHECKBOX"},"description":"Whether replies to this post are sent to the user's inbox. Default: true."}
   *
   * @returns {Object}
   * @sampleResult {"json":{"errors":[],"data":{"url":"https://www.reddit.com/r/test/comments/abc123/my_title/","id":"abc123","name":"t3_abc123","drafts_count":0}}}
   */
  async submitPost(subreddit, kind, title, text, url, flairId, nsfw, spoiler, sendReplies) {
    if (!title) {
      throw new Error('"Title" is required')
    }

    const resolvedKind = this.#resolveChoice(kind || 'Self', POST_KIND_OPTIONS)

    if (resolvedKind === 'link' && !url) {
      throw new Error('"URL" is required when Kind is "Link"')
    }

    return this.#apiRequest({
      logTag: 'submitPost',
      method: 'post',
      url: `${ API_BASE_URL }/api/submit`,
      form: {
        api_type: 'json',
        sr: this.#cleanSubredditName(subreddit),
        kind: resolvedKind,
        title,
        text: resolvedKind === 'self' ? text : undefined,
        url: resolvedKind === 'link' ? url : undefined,
        flair_id: flairId,
        nsfw: nsfw ? 'true' : undefined,
        spoiler: spoiler ? 'true' : undefined,
        sendreplies: sendReplies === false ? 'false' : 'true',
      },
    })
  }

  /**
   * @description Retrieves a post (link) and its comment tree by the post's base36 article id (e.g. 'abc123', the part after '/comments/'). Returns an array of two listings: the first contains the post, the second contains the top-level comments. Requires the 'read' scope.
   *
   * @route GET /get-post
   * @operationName Get Post
   * @category Submissions
   *
   * @paramDef {"type":"String","label":"Article ID","name":"article","required":true,"description":"The post's base36 id (e.g. 'abc123'), taken from its URL after '/comments/'. Do not include the 't3_' prefix."}
   *
   * @returns {Object}
   * @sampleResult {"post":{"id":"abc123","name":"t3_abc123","title":"My Title","author":"example_user","subreddit":"test","score":42,"num_comments":5,"url":"https://www.reddit.com/r/test/comments/abc123/my_title/"}}
   */
  async getPost(article) {
    if (!article) {
      throw new Error('"Article ID" is required')
    }

    const cleaned = String(article).trim().replace(/^t3_/i, '')

    const response = await this.#apiRequest({
      logTag: 'getPost',
      url: `${ API_BASE_URL }/comments/${ cleaned }`,
      query: { limit: 1 },
    })

    const postListing = Array.isArray(response) ? response[0] : response
    const post = this.#unwrapListing(postListing).items[0] || null

    return { post }
  }

  /**
   * @description Edits the body text of an existing self (text) post owned by the connected user. Requires the 'edit' scope. Returns the updated content in Reddit's json response.
   *
   * @route POST /edit-post
   * @operationName Edit Post
   * @category Submissions
   *
   * @paramDef {"type":"String","label":"Post Fullname","name":"thingId","required":true,"description":"The post's fullname, prefixed with 't3_' (e.g. 't3_abc123'). This is the 'name' field returned when submitting or fetching a post."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The new body text in Markdown. Replaces the existing text entirely."}
   *
   * @returns {Object}
   * @sampleResult {"json":{"errors":[],"data":{"things":[{"kind":"t3","data":{"id":"abc123","name":"t3_abc123","body":"Updated text","author":"example_user"}}]}}}
   */
  async editPost(thingId, text) {
    if (!thingId) {
      throw new Error('"Post Fullname" is required')
    }

    if (!text) {
      throw new Error('"Text" is required')
    }

    return this.#apiRequest({
      logTag: 'editPost',
      method: 'post',
      url: `${ API_BASE_URL }/api/editusertext`,
      form: {
        api_type: 'json',
        thing_id: thingId.trim(),
        text,
      },
    })
  }

  /**
   * @description Deletes a post owned by the connected user, specified by its fullname (t3_...). Requires the 'edit' scope. This action is permanent.
   *
   * @route POST /delete-post
   * @operationName Delete Post
   * @category Submissions
   *
   * @paramDef {"type":"String","label":"Post Fullname","name":"id","required":true,"description":"The post's fullname, prefixed with 't3_' (e.g. 't3_abc123')."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Post deleted successfully","id":"t3_abc123"}
   */
  async deletePost(id) {
    if (!id) {
      throw new Error('"Post Fullname" is required')
    }

    await this.#apiRequest({
      logTag: 'deletePost',
      method: 'post',
      url: `${ API_BASE_URL }/api/del`,
      form: { id: id.trim() },
    })

    return {
      success: true,
      message: 'Post deleted successfully',
      id: id.trim(),
    }
  }

  // ============================================ COMMENTS ==============================================

  /**
   * @description Posts a comment or reply as the connected user. The parent is a fullname: use a post's fullname (t3_...) to comment on the post, or a comment's fullname (t1_...) to reply to a comment. Requires the 'submit' scope. Returns the created comment in Reddit's json response.
   *
   * @route POST /add-comment
   * @operationName Add Comment
   * @category Comments
   *
   * @paramDef {"type":"String","label":"Parent Fullname","name":"parent","required":true,"description":"The fullname of the thing to reply to: a post ('t3_...') to comment on the post, or a comment ('t1_...') to reply to a comment."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The comment body in Markdown."}
   *
   * @returns {Object}
   * @sampleResult {"json":{"errors":[],"data":{"things":[{"kind":"t1","data":{"id":"def456","name":"t1_def456","body":"Nice post!","author":"example_user"}}]}}}
   */
  async addComment(parent, text) {
    if (!parent) {
      throw new Error('"Parent Fullname" is required')
    }

    if (!text) {
      throw new Error('"Text" is required')
    }

    return this.#apiRequest({
      logTag: 'addComment',
      method: 'post',
      url: `${ API_BASE_URL }/api/comment`,
      form: {
        api_type: 'json',
        thing_id: parent.trim(),
        text,
      },
    })
  }

  /**
   * @description Edits the body of an existing comment owned by the connected user. Requires the 'edit' scope. Returns the updated comment in Reddit's json response.
   *
   * @route POST /edit-comment
   * @operationName Edit Comment
   * @category Comments
   *
   * @paramDef {"type":"String","label":"Comment Fullname","name":"thingId","required":true,"description":"The comment's fullname, prefixed with 't1_' (e.g. 't1_def456')."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The new comment body in Markdown. Replaces the existing text entirely."}
   *
   * @returns {Object}
   * @sampleResult {"json":{"errors":[],"data":{"things":[{"kind":"t1","data":{"id":"def456","name":"t1_def456","body":"Updated comment","author":"example_user"}}]}}}
   */
  async editComment(thingId, text) {
    if (!thingId) {
      throw new Error('"Comment Fullname" is required')
    }

    if (!text) {
      throw new Error('"Text" is required')
    }

    return this.#apiRequest({
      logTag: 'editComment',
      method: 'post',
      url: `${ API_BASE_URL }/api/editusertext`,
      form: {
        api_type: 'json',
        thing_id: thingId.trim(),
        text,
      },
    })
  }

  /**
   * @description Deletes a comment owned by the connected user, specified by its fullname (t1_...). Requires the 'edit' scope. This action is permanent.
   *
   * @route POST /delete-comment
   * @operationName Delete Comment
   * @category Comments
   *
   * @paramDef {"type":"String","label":"Comment Fullname","name":"id","required":true,"description":"The comment's fullname, prefixed with 't1_' (e.g. 't1_def456')."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Comment deleted successfully","id":"t1_def456"}
   */
  async deleteComment(id) {
    if (!id) {
      throw new Error('"Comment Fullname" is required')
    }

    await this.#apiRequest({
      logTag: 'deleteComment',
      method: 'post',
      url: `${ API_BASE_URL }/api/del`,
      form: { id: id.trim() },
    })

    return {
      success: true,
      message: 'Comment deleted successfully',
      id: id.trim(),
    }
  }

  /**
   * @description Retrieves the comments for a post by the post's base36 article id (e.g. 'abc123'). Returns the flattened list of top-level comment objects plus the post itself. Supports an optional sort order and comment limit. Requires the 'read' scope.
   *
   * @route GET /get-comments-for-post
   * @operationName Get Comments For Post
   * @category Comments
   *
   * @paramDef {"type":"String","label":"Article ID","name":"article","required":true,"description":"The post's base36 id (e.g. 'abc123'), taken from its URL after '/comments/'. Do not include the 't3_' prefix."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","defaultValue":"Best","uiComponent":{"type":"DROPDOWN","options":{"values":["Best","Top","New","Controversial","Old","Q&A"]}},"description":"Comment sort order. Default: 'Best' (confidence)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of top-level comments to return. Default: 25."}
   *
   * @returns {Object}
   * @sampleResult {"post":{"id":"abc123","name":"t3_abc123","title":"My Title","num_comments":2},"comments":[{"id":"def456","name":"t1_def456","author":"user1","body":"Great post!","score":10}]}
   */
  async getCommentsForPost(article, sort, limit) {
    if (!article) {
      throw new Error('"Article ID" is required')
    }

    const cleaned = String(article).trim().replace(/^t3_/i, '')

    const response = await this.#apiRequest({
      logTag: 'getCommentsForPost',
      url: `${ API_BASE_URL }/comments/${ cleaned }`,
      query: {
        sort: this.#resolveChoice(sort, {
          'Best': 'confidence',
          'Top': 'top',
          'New': 'new',
          'Controversial': 'controversial',
          'Old': 'old',
          'Q&A': 'qa',
        }),
        limit: limit || DEFAULT_LIMIT,
      },
    })

    const [postListing, commentListing] = Array.isArray(response) ? response : [response, null]

    const post = this.#unwrapListing(postListing).items[0] || null
    const comments = commentListing ? this.#unwrapListing(commentListing).items : []

    return { post, comments }
  }

  // ========================================= VOTING & SAVING =========================================

  /**
   * @description Casts, changes, or removes the connected user's vote on a post or comment. The target is a fullname (t3_... for a post, t1_... for a comment). Requires the 'vote' scope. Per Reddit's API rules, votes must reflect a genuine user action, not automated behavior.
   *
   * @route POST /vote
   * @operationName Vote
   * @category Voting & Saving
   *
   * @paramDef {"type":"String","label":"Fullname","name":"id","required":true,"description":"The fullname of the post ('t3_...') or comment ('t1_...') to vote on."}
   * @paramDef {"type":"String","label":"Direction","name":"direction","required":true,"defaultValue":"Upvote","uiComponent":{"type":"DROPDOWN","options":{"values":["Upvote","Downvote","Unvote"]}},"description":"The vote to cast. 'Upvote' (+1), 'Downvote' (-1), or 'Unvote' (0) to remove an existing vote."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":"t3_abc123","direction":1}
   */
  async vote(id, direction) {
    if (!id) {
      throw new Error('"Fullname" is required')
    }

    const dir = this.#resolveChoice(direction || 'Upvote', VOTE_DIRECTION_OPTIONS)

    await this.#apiRequest({
      logTag: 'vote',
      method: 'post',
      url: `${ API_BASE_URL }/api/vote`,
      form: {
        id: id.trim(),
        dir: String(dir),
      },
    })

    return { success: true, id: id.trim(), direction: dir }
  }

  /**
   * @description Saves a post or comment to the connected user's saved items. The target is a fullname (t3_... or t1_...). An optional category groups the saved item (Reddit Premium feature). Requires the 'save' scope.
   *
   * @route POST /save
   * @operationName Save
   * @category Voting & Saving
   *
   * @paramDef {"type":"String","label":"Fullname","name":"id","required":true,"description":"The fullname of the post ('t3_...') or comment ('t1_...') to save."}
   * @paramDef {"type":"String","label":"Category","name":"category","description":"Optional saved-item category name (requires Reddit Premium). Leave blank to save without a category."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":"t3_abc123","action":"save"}
   */
  async save(id, category) {
    if (!id) {
      throw new Error('"Fullname" is required')
    }

    await this.#apiRequest({
      logTag: 'save',
      method: 'post',
      url: `${ API_BASE_URL }/api/save`,
      form: {
        id: id.trim(),
        category,
      },
    })

    return { success: true, id: id.trim(), action: 'save' }
  }

  /**
   * @description Removes a post or comment from the connected user's saved items. The target is a fullname (t3_... or t1_...). Requires the 'save' scope.
   *
   * @route POST /unsave
   * @operationName Unsave
   * @category Voting & Saving
   *
   * @paramDef {"type":"String","label":"Fullname","name":"id","required":true,"description":"The fullname of the post ('t3_...') or comment ('t1_...') to unsave."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":"t3_abc123","action":"unsave"}
   */
  async unsave(id) {
    if (!id) {
      throw new Error('"Fullname" is required')
    }

    await this.#apiRequest({
      logTag: 'unsave',
      method: 'post',
      url: `${ API_BASE_URL }/api/unsave`,
      form: { id: id.trim() },
    })

    return { success: true, id: id.trim(), action: 'unsave' }
  }

  /**
   * @description Hides a post from the connected user's listings, specified by its fullname (t3_...). Requires the 'report' scope.
   *
   * @route POST /hide
   * @operationName Hide
   * @category Voting & Saving
   *
   * @paramDef {"type":"String","label":"Post Fullname","name":"id","required":true,"description":"The post's fullname, prefixed with 't3_' (e.g. 't3_abc123')."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":"t3_abc123","action":"hide"}
   */
  async hide(id) {
    if (!id) {
      throw new Error('"Post Fullname" is required')
    }

    await this.#apiRequest({
      logTag: 'hide',
      method: 'post',
      url: `${ API_BASE_URL }/api/hide`,
      form: { id: id.trim() },
    })

    return { success: true, id: id.trim(), action: 'hide' }
  }

  /**
   * @description Unhides a previously hidden post, specified by its fullname (t3_...). Requires the 'report' scope.
   *
   * @route POST /unhide
   * @operationName Unhide
   * @category Voting & Saving
   *
   * @paramDef {"type":"String","label":"Post Fullname","name":"id","required":true,"description":"The post's fullname, prefixed with 't3_' (e.g. 't3_abc123')."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":"t3_abc123","action":"unhide"}
   */
  async unhide(id) {
    if (!id) {
      throw new Error('"Post Fullname" is required')
    }

    await this.#apiRequest({
      logTag: 'unhide',
      method: 'post',
      url: `${ API_BASE_URL }/api/unhide`,
      form: { id: id.trim() },
    })

    return { success: true, id: id.trim(), action: 'unhide' }
  }

  // ========================================= LISTINGS & BROWSE =======================================

  /**
   * @description Retrieves posts from a subreddit by sort order (Hot, New, Top, or Rising). For 'Top', an optional timeframe narrows results (e.g. Day, Week, All Time). Returns unwrapped post objects plus an 'after' cursor for pagination. Requires the 'read' scope.
   *
   * @route GET /get-subreddit-posts
   * @operationName Get Subreddit Posts
   * @category Listings & Browse
   *
   * @paramDef {"type":"String","label":"Subreddit","name":"subreddit","required":true,"dictionary":"getMySubredditsDictionary","description":"The subreddit to browse, without the 'r/' prefix (e.g. 'aww')."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","defaultValue":"Hot","uiComponent":{"type":"DROPDOWN","options":{"values":["Hot","New","Top","Rising"]}},"description":"The sort order for posts. Default: 'Hot'."}
   * @paramDef {"type":"String","label":"Timeframe","name":"timeframe","defaultValue":"Day","uiComponent":{"type":"DROPDOWN","options":{"values":["Hour","Day","Week","Month","Year","All Time"]}},"description":"Time window for 'Top' sort only; ignored for other sorts. Default: 'Day'."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of posts to return. Maximum: 100. Default: 25."}
   * @paramDef {"type":"String","label":"After","name":"after","description":"Pagination cursor ('after' fullname, e.g. 't3_abc123') from a previous response, used to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"abc123","name":"t3_abc123","title":"Cute puppy","author":"user1","subreddit":"aww","score":5400,"num_comments":210,"permalink":"/r/aww/comments/abc123/cute_puppy/"}],"after":"t3_xyz789","before":null}
   */
  async getSubredditPosts(subreddit, sort, timeframe, limit, after) {
    const resolvedSort = this.#resolveChoice(sort || 'Hot', SUBREDDIT_SORT_OPTIONS)

    const response = await this.#apiRequest({
      logTag: 'getSubredditPosts',
      url: `${ API_BASE_URL }/r/${ this.#cleanSubredditName(subreddit) }/${ resolvedSort }`,
      query: {
        t: resolvedSort === 'top' ? this.#resolveChoice(timeframe, TOP_TIMEFRAME_OPTIONS) : undefined,
        limit: limit || DEFAULT_LIMIT,
        after,
      },
    })

    return this.#unwrapListing(response)
  }

  /**
   * @description Searches Reddit for posts matching a query. When a subreddit is provided the search is restricted to that subreddit; otherwise it searches all of Reddit. Supports sort order and result limit. Returns unwrapped post objects plus an 'after' cursor. Requires the 'read' scope.
   *
   * @route GET /search
   * @operationName Search
   * @category Listings & Browse
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"The search query. Supports Reddit search syntax (e.g. 'flair:news', 'author:username')."}
   * @paramDef {"type":"String","label":"Subreddit","name":"subreddit","dictionary":"getMySubredditsDictionary","description":"Optional subreddit to restrict the search to, without the 'r/' prefix. Leave blank to search all of Reddit."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","defaultValue":"Relevance","uiComponent":{"type":"DROPDOWN","options":{"values":["Relevance","Hot","New","Top","Comments"]}},"description":"Sort order for search results. Default: 'Relevance'."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of results to return. Maximum: 100. Default: 25."}
   * @paramDef {"type":"String","label":"After","name":"after","description":"Pagination cursor ('after' fullname) from a previous response, used to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"abc123","name":"t3_abc123","title":"Breaking news","author":"user1","subreddit":"news","score":1200,"num_comments":89}],"after":"t3_xyz789","before":null}
   */
  async search(query, subreddit, sort, limit, after) {
    if (!query) {
      throw new Error('"Query" is required')
    }

    const cleanSub = subreddit ? this.#cleanSubredditName(subreddit) : null
    const url = cleanSub
      ? `${ API_BASE_URL }/r/${ cleanSub }/search`
      : `${ API_BASE_URL }/search`

    const response = await this.#apiRequest({
      logTag: 'search',
      url,
      query: {
        q: query,
        sort: this.#resolveChoice(sort, SEARCH_SORT_OPTIONS),
        restrict_sr: cleanSub ? 'true' : undefined,
        limit: limit || DEFAULT_LIMIT,
        after,
      },
    })

    return this.#unwrapListing(response)
  }

  /**
   * @description Retrieves the posts submitted by a given Reddit user. Returns unwrapped post objects plus an 'after' cursor for pagination. Requires the 'history' scope.
   *
   * @route GET /get-user-posts
   * @operationName Get User Posts
   * @category Listings & Browse
   *
   * @paramDef {"type":"String","label":"Username","name":"username","required":true,"description":"The Reddit username whose submitted posts to retrieve, without the 'u/' prefix (e.g. 'spez')."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","defaultValue":"New","uiComponent":{"type":"DROPDOWN","options":{"values":["Hot","New","Top"]}},"description":"Sort order for the user's posts. Default: 'New'."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of posts to return. Maximum: 100. Default: 25."}
   * @paramDef {"type":"String","label":"After","name":"after","description":"Pagination cursor ('after' fullname) from a previous response, used to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"abc123","name":"t3_abc123","title":"My submission","subreddit":"test","score":15,"num_comments":3}],"after":"t3_xyz789","before":null}
   */
  async getUserPosts(username, sort, limit, after) {
    if (!username) {
      throw new Error('"Username" is required')
    }

    const cleanUser = String(username).trim().replace(/^\/?u(?:ser)?\//i, '')

    const response = await this.#apiRequest({
      logTag: 'getUserPosts',
      url: `${ API_BASE_URL }/user/${ cleanUser }/submitted`,
      query: {
        sort: this.#resolveChoice(sort, { 'Hot': 'hot', 'New': 'new', 'Top': 'top' }),
        limit: limit || DEFAULT_LIMIT,
        after,
      },
    })

    return this.#unwrapListing(response)
  }

  // ============================================ SUBREDDITS ===========================================

  /**
   * @description Retrieves detailed information about a subreddit, including its title, description, subscriber count, creation date, and settings. Requires the 'read' scope.
   *
   * @route GET /get-subreddit-info
   * @operationName Get Subreddit Info
   * @category Subreddits
   *
   * @paramDef {"type":"String","label":"Subreddit","name":"subreddit","required":true,"dictionary":"getMySubredditsDictionary","description":"The subreddit to look up, without the 'r/' prefix (e.g. 'aww')."}
   *
   * @returns {Object}
   * @sampleResult {"display_name":"aww","display_name_prefixed":"r/aww","title":"aww","subscribers":34000000,"public_description":"Things that make you go AWW!","created_utc":1201234567,"over18":false}
   */
  async getSubredditInfo(subreddit) {
    const response = await this.#apiRequest({
      logTag: 'getSubredditInfo',
      url: `${ API_BASE_URL }/r/${ this.#cleanSubredditName(subreddit) }/about`,
    })

    return response?.data || response
  }

  /**
   * @description Subscribes the connected user to a subreddit or unsubscribes them from it. Requires the 'subscribe' scope.
   *
   * @route POST /set-subscription
   * @operationName Subscribe Or Unsubscribe
   * @category Subreddits
   *
   * @paramDef {"type":"String","label":"Subreddit","name":"subreddit","required":true,"dictionary":"getMySubredditsDictionary","description":"The subreddit to subscribe to or unsubscribe from, without the 'r/' prefix (e.g. 'aww')."}
   * @paramDef {"type":"String","label":"Action","name":"action","required":true,"defaultValue":"Subscribe","uiComponent":{"type":"DROPDOWN","options":{"values":["Subscribe","Unsubscribe"]}},"description":"Whether to subscribe to or unsubscribe from the subreddit."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"subreddit":"aww","action":"sub"}
   */
  async setSubscription(subreddit, action) {
    const cleanSub = this.#cleanSubredditName(subreddit)
    const resolvedAction = this.#resolveChoice(action || 'Subscribe', {
      'Subscribe': 'sub',
      'Unsubscribe': 'unsub',
    })

    await this.#apiRequest({
      logTag: 'setSubscription',
      method: 'post',
      url: `${ API_BASE_URL }/api/subscribe`,
      form: {
        action: resolvedAction,
        sr_name: cleanSub,
      },
    })

    return { success: true, subreddit: cleanSub, action: resolvedAction }
  }

  /**
   * @description Retrieves the posting rules for a subreddit, including each rule's short name, description, and the kind of content it applies to (link, comment, or all). Requires the 'read' scope.
   *
   * @route GET /get-subreddit-rules
   * @operationName Get Subreddit Rules
   * @category Subreddits
   *
   * @paramDef {"type":"String","label":"Subreddit","name":"subreddit","required":true,"dictionary":"getMySubredditsDictionary","description":"The subreddit whose rules to retrieve, without the 'r/' prefix (e.g. 'aww')."}
   *
   * @returns {Object}
   * @sampleResult {"rules":[{"short_name":"Be civil","description":"Treat others with respect.","kind":"all","priority":0}],"site_rules":["Spam","Personal and confidential information"]}
   */
  async getSubredditRules(subreddit) {
    return this.#apiRequest({
      logTag: 'getSubredditRules',
      url: `${ API_BASE_URL }/r/${ this.#cleanSubredditName(subreddit) }/about/rules`,
    })
  }

  // ============================================= MESSAGES ============================================

  /**
   * @description Sends a private message to another Reddit user from the connected account. Requires the 'privatemessages' scope. Returns Reddit's json response, which contains any validation errors.
   *
   * @route POST /send-message
   * @operationName Send Message
   * @category Messages
   *
   * @paramDef {"type":"String","label":"To","name":"to","required":true,"description":"The recipient's Reddit username, without the 'u/' prefix (e.g. 'spez')."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"The message subject. Maximum 100 characters."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The message body in Markdown."}
   *
   * @returns {Object}
   * @sampleResult {"json":{"errors":[]}}
   */
  async sendMessage(to, subject, text) {
    if (!to) {
      throw new Error('"To" is required')
    }

    if (!subject) {
      throw new Error('"Subject" is required')
    }

    if (!text) {
      throw new Error('"Text" is required')
    }

    return this.#apiRequest({
      logTag: 'sendMessage',
      method: 'post',
      url: `${ API_BASE_URL }/api/compose`,
      form: {
        api_type: 'json',
        to: String(to).trim().replace(/^\/?u\//i, ''),
        subject,
        text,
      },
    })
  }

  /**
   * @description Retrieves the connected user's message inbox, including private messages and comment/post replies. Returns unwrapped message objects plus an 'after' cursor for pagination. Requires the 'privatemessages' scope.
   *
   * @route GET /get-inbox
   * @operationName Get Inbox
   * @category Messages
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of messages to return. Maximum: 100. Default: 25."}
   * @paramDef {"type":"String","label":"After","name":"after","description":"Pagination cursor ('after' fullname) from a previous response, used to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"msg1","name":"t4_msg1","author":"user1","subject":"Hello","body":"Hi there!","new":true,"created_utc":1500000000}],"after":"t4_msg9","before":null}
   */
  async getInbox(limit, after) {
    const response = await this.#apiRequest({
      logTag: 'getInbox',
      url: `${ API_BASE_URL }/message/inbox`,
      query: {
        limit: limit || DEFAULT_LIMIT,
        after,
      },
    })

    return this.#unwrapListing(response)
  }
}

Flowrunner.ServerCode.addService(RedditService, [
  {
    displayName: 'Client Id',
    defaultValue: '',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The client ID of your Reddit "web app" from https://www.reddit.com/prefs/apps.',
  },
  {
    displayName: 'Client Secret',
    defaultValue: '',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The client secret of your Reddit "web app" from https://www.reddit.com/prefs/apps.',
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

function searchFilter(list, props, searchString) {
  return list.filter(item =>
    props.some(prop => {
      const value = item[prop]

      return value && String(value).toLowerCase().includes(searchString.toLowerCase())
    })
  )
}
