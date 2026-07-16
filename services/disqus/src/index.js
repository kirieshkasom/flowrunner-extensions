const logger = {
  info: (...args) => console.log('[Disqus] info:', ...args),
  debug: (...args) => console.log('[Disqus] debug:', ...args),
  error: (...args) => console.log('[Disqus] error:', ...args),
  warn: (...args) => console.log('[Disqus] warn:', ...args),
}

const API_BASE_URL = 'https://disqus.com/api/3.0'

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
 * @integrationName Disqus
 * @integrationIcon /icon.svg
 */
class DisqusService {
  constructor(config) {
    this.apiKey = config.apiKey
    this.accessToken = config.accessToken
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /**
   * Single private request helper. Authentication (api_key + access_token) is always
   * appended to the query string. Disqus wraps every response in { code, response };
   * code 0 means success, anything else is an error whose message is the response string.
   */
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    const authQuery = clean({
      api_key: this.apiKey,
      access_token: this.accessToken,
      ...(query || {}),
    })

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      let request = Flowrunner.Request[method.toLowerCase()](url).query(authQuery)

      let response

      if (method.toLowerCase() === 'post') {
        request = request.set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        response = await request.send(clean(body) || {})
      } else {
        response = await request
      }

      if (response && response.code !== 0) {
        const apiMessage = typeof response.response === 'string' ? response.response : 'Unknown error'

        throw new Error(`Disqus API error (code ${ response.code }): ${ apiMessage }`)
      }

      return response ? response.response : response
    } catch (error) {
      if (error.message && error.message.startsWith('Disqus API error')) {
        throw error
      }

      const status = error.status || error.statusCode
      const bodyMessage = typeof error.body?.response === 'string' ? error.body.response : undefined
      const message = bodyMessage || error.body?.message || error.message

      logger.error(`${ logTag } - failed${ status ? ` (${ status })` : '' }: ${ message }`)

      throw new Error(`Disqus API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  /* =========================================================================
   * Forums
   * ========================================================================= */

  /**
   * @operationName Get Forum Details
   * @category Forums
   * @description Retrieves details of a Disqus forum (site) by its short name. Returns the forum's name, description, creation date, settings, subscriber and post counts, and moderator configuration. The forum short name is the unique identifier shown in your Disqus admin URL.
   * @route GET /forums/details
   * @paramDef {"type":"String","label":"Forum","name":"forum","required":true,"description":"Forum short name (ID), e.g. \"myforum\" from disqus.com/admin/settings/myforum."}
   *
   * @returns {Object}
   * @sampleResult {"id":"myforum","name":"My Forum","createdAt":"2015-03-10T12:00:00","founder":"12345","favicon":{"permalink":"https://example.com/favicon.ico"},"description":"A community forum","language":"en","settings":{"organicDiscoveryEnabled":true}}
   */
  async getForumDetails(forum) {
    return await this.#apiRequest({
      logTag: '[getForumDetails]',
      url: `${ API_BASE_URL }/forums/details.json`,
      method: 'get',
      query: { forum },
    })
  }

  /**
   * @operationName List Forum Categories
   * @category Forums
   * @description Lists the categories defined within a Disqus forum. Categories are optional groupings used to organize threads. Returns each category's ID, title, and default flag.
   * @route GET /forums/list-categories
   * @paramDef {"type":"String","label":"Forum","name":"forum","required":true,"description":"Forum short name (ID) to list categories for."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of categories to return (1-100, default 25)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response's cursor.next to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"cursor":{"prev":null,"hasNext":false,"next":null,"hasPrev":false,"total":1,"id":null,"more":false},"response":[{"id":"98765","forum":"myforum","title":"General","default":true,"order":1}]}
   */
  async listForumCategories(forum, limit, cursor) {
    return await this.#apiRequest({
      logTag: '[listForumCategories]',
      url: `${ API_BASE_URL }/forums/listCategories.json`,
      method: 'get',
      query: { forum, limit, cursor },
    })
  }

  /**
   * @operationName List Forum Threads
   * @category Forums
   * @description Lists threads (discussions) belonging to a Disqus forum, most recent first. Supports pagination via limit and cursor. Each thread includes its ID, title, link, post count, and creation date.
   * @route GET /forums/list-threads
   * @paramDef {"type":"String","label":"Forum","name":"forum","required":true,"description":"Forum short name (ID) to list threads for."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of threads to return (1-100, default 25)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response's cursor.next to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"cursor":{"prev":null,"hasNext":true,"next":"1:0:0","hasPrev":false,"total":null,"id":null,"more":true},"response":[{"id":"55555","forum":"myforum","title":"Welcome thread","link":"https://example.com/welcome","posts":12,"createdAt":"2016-01-05T09:00:00"}]}
   */
  async listForumThreads(forum, limit, cursor) {
    return await this.#apiRequest({
      logTag: '[listForumThreads]',
      url: `${ API_BASE_URL }/forums/listThreads.json`,
      method: 'get',
      query: { forum, limit, cursor },
    })
  }

  /**
   * @operationName List Forum Posts
   * @category Forums
   * @description Lists posts (comments) across all threads in a Disqus forum, most recent first. Supports pagination and filtering by moderation state. Useful for moderation dashboards and exporting a forum's comment activity.
   * @route GET /forums/list-posts
   * @paramDef {"type":"String","label":"Forum","name":"forum","required":true,"description":"Forum short name (ID) to list posts for."}
   * @paramDef {"type":"String","label":"Include","name":"include","uiComponent":{"type":"DROPDOWN","options":{"values":["Approved","Unapproved","Spam","Deleted","Flagged","Highlighted"]}},"description":"Moderation state of posts to include. Defaults to Approved."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of posts to return (1-100, default 25)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response's cursor.next to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"cursor":{"prev":null,"hasNext":true,"next":"1:0:0","hasPrev":false,"total":null,"id":null,"more":true},"response":[{"id":"3000001","message":"<p>Great post!</p>","thread":"55555","forum":"myforum","createdAt":"2016-02-01T10:00:00","isApproved":true,"author":{"name":"Jane Doe","username":"jane"}}]}
   */
  async listForumPosts(forum, include, limit, cursor) {
    const resolvedInclude = this.#resolveChoice(include, {
      Approved: 'approved',
      Unapproved: 'unapproved',
      Spam: 'spam',
      Deleted: 'deleted',
      Flagged: 'flagged',
      Highlighted: 'highlighted',
    })

    return await this.#apiRequest({
      logTag: '[listForumPosts]',
      url: `${ API_BASE_URL }/forums/listPosts.json`,
      method: 'get',
      query: { forum, include: resolvedInclude || 'approved', limit, cursor },
    })
  }

  /* =========================================================================
   * Threads
   * ========================================================================= */

  /**
   * @operationName Get Thread Details
   * @category Threads
   * @description Retrieves details of a Disqus thread. Look up a thread either by its numeric thread ID, or by forum plus link (the page URL the thread is attached to). Returns the thread title, link, post count, and moderation status.
   * @route GET /threads/details
   * @paramDef {"type":"String","label":"Thread ID","name":"thread","description":"Numeric thread ID. Provide this OR the Forum + Link pair."}
   * @paramDef {"type":"String","label":"Forum","name":"forum","description":"Forum short name (ID). Required when looking up a thread by Link instead of by Thread ID."}
   * @paramDef {"type":"String","label":"Link","name":"link","description":"The page URL the thread is attached to. Used together with Forum to resolve a thread by link."}
   *
   * @returns {Object}
   * @sampleResult {"id":"55555","forum":"myforum","title":"Welcome thread","link":"https://example.com/welcome","posts":12,"isClosed":false,"isDeleted":false,"createdAt":"2016-01-05T09:00:00","author":"12345"}
   */
  async getThreadDetails(thread, forum, link) {
    const query = { forum }

    if (link) {
      query['thread:link'] = link
    } else {
      query.thread = thread
    }

    return await this.#apiRequest({
      logTag: '[getThreadDetails]',
      url: `${ API_BASE_URL }/threads/details.json`,
      method: 'get',
      query,
    })
  }

  /**
   * @operationName List Thread Posts
   * @category Threads
   * @description Lists the posts (comments) belonging to a single Disqus thread, ordered as displayed. Supports pagination and moderation-state filtering. Use this to read a discussion's comments for a specific page.
   * @route GET /threads/list-posts
   * @paramDef {"type":"String","label":"Thread ID","name":"thread","required":true,"description":"Numeric thread ID to list posts for."}
   * @paramDef {"type":"String","label":"Include","name":"include","uiComponent":{"type":"DROPDOWN","options":{"values":["Approved","Unapproved","Spam","Deleted","Flagged","Highlighted"]}},"description":"Moderation state of posts to include. Defaults to Approved."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of posts to return (1-100, default 25)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response's cursor.next to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"cursor":{"prev":null,"hasNext":false,"next":null,"hasPrev":false,"total":null,"id":null,"more":false},"response":[{"id":"3000001","message":"<p>First!</p>","thread":"55555","parent":null,"createdAt":"2016-02-01T10:00:00","isApproved":true,"author":{"name":"Jane Doe","username":"jane"}}]}
   */
  async listThreadPosts(thread, include, limit, cursor) {
    const resolvedInclude = this.#resolveChoice(include, {
      Approved: 'approved',
      Unapproved: 'unapproved',
      Spam: 'spam',
      Deleted: 'deleted',
      Flagged: 'flagged',
      Highlighted: 'highlighted',
    })

    return await this.#apiRequest({
      logTag: '[listThreadPosts]',
      url: `${ API_BASE_URL }/threads/listPosts.json`,
      method: 'get',
      query: { thread, include: resolvedInclude || 'approved', limit, cursor },
    })
  }

  /**
   * @operationName Create Thread
   * @category Threads
   * @description Creates a new thread (discussion) within a forum. A thread is where comments are attached and typically corresponds to a page on your site. Requires the forum short name and a title; optionally attach a URL, identifier, slug, category, or opening message. Requires a valid access token.
   * @route POST /threads/create
   * @paramDef {"type":"String","label":"Forum","name":"forum","required":true,"description":"Forum short name (ID) the thread will belong to."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Title of the new thread."}
   * @paramDef {"type":"String","label":"URL","name":"url","description":"Page URL the thread is associated with (RFC 3986, max 500 chars)."}
   * @paramDef {"type":"String","label":"Identifier","name":"identifier","description":"Unique identifier for the thread on your site (max 300 chars). Lets you map a thread to your own content ID."}
   * @paramDef {"type":"String","label":"Slug","name":"slug","description":"Alphanumeric slug for the thread (max 200 chars)."}
   * @paramDef {"type":"String","label":"Category ID","name":"category","description":"ID of a forum category to assign the thread to."}
   * @paramDef {"type":"String","label":"Message","name":"message","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional opening message/body for the thread."}
   *
   * @returns {Object}
   * @sampleResult {"id":"88888","forum":"myforum","title":"New product launch","link":"https://example.com/launch","slug":"new-product-launch","identifier":"launch-2016","createdAt":"2016-03-01T08:00:00","isClosed":false,"posts":0}
   */
  async createThread(forum, title, url, identifier, slug, category, message) {
    return await this.#apiRequest({
      logTag: '[createThread]',
      url: `${ API_BASE_URL }/threads/create.json`,
      method: 'post',
      body: { forum, title, url, identifier, slug, category, message },
    })
  }

  /**
   * @operationName Close Thread
   * @category Threads
   * @description Closes a thread so that no new comments can be posted to it. Existing comments remain visible. Requires a valid access token with moderation permission on the forum.
   * @route POST /threads/close
   * @paramDef {"type":"String","label":"Thread ID","name":"thread","required":true,"description":"Numeric thread ID to close."}
   *
   * @returns {Object}
   * @sampleResult {"code":0,"response":[{"id":"55555"}]}
   */
  async closeThread(thread) {
    return await this.#apiRequest({
      logTag: '[closeThread]',
      url: `${ API_BASE_URL }/threads/close.json`,
      method: 'post',
      body: { thread },
    })
  }

  /**
   * @operationName Open Thread
   * @category Threads
   * @description Reopens a previously closed thread so that comments can be posted to it again. Requires a valid access token with moderation permission on the forum.
   * @route POST /threads/open
   * @paramDef {"type":"String","label":"Thread ID","name":"thread","required":true,"description":"Numeric thread ID to reopen."}
   *
   * @returns {Object}
   * @sampleResult {"code":0,"response":[{"id":"55555"}]}
   */
  async openThread(thread) {
    return await this.#apiRequest({
      logTag: '[openThread]',
      url: `${ API_BASE_URL }/threads/open.json`,
      method: 'post',
      body: { thread },
    })
  }

  /* =========================================================================
   * Posts (comments)
   * ========================================================================= */

  /**
   * @operationName Get Post
   * @category Posts
   * @description Retrieves the details of a single post (comment) by its ID, including the message HTML, author, parent post, thread, timestamps, and moderation flags.
   * @route GET /posts/details
   * @paramDef {"type":"String","label":"Post ID","name":"post","required":true,"description":"Numeric post (comment) ID to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"3000001","message":"<p>Great post!</p>","thread":"55555","forum":"myforum","parent":null,"createdAt":"2016-02-01T10:00:00","isApproved":true,"isSpam":false,"isDeleted":false,"author":{"name":"Jane Doe","username":"jane","isAnonymous":false}}
   */
  async getPost(post) {
    return await this.#apiRequest({
      logTag: '[getPost]',
      url: `${ API_BASE_URL }/posts/details.json`,
      method: 'get',
      query: { post },
    })
  }

  /**
   * @operationName List Posts
   * @category Posts
   * @description Lists posts (comments) in a forum, filtered by moderation state, most recent first. Supports pagination. This is the primary endpoint for pulling a queue of comments to moderate or export.
   * @route GET /posts/list
   * @paramDef {"type":"String","label":"Forum","name":"forum","required":true,"description":"Forum short name (ID) to list posts for."}
   * @paramDef {"type":"String","label":"Include","name":"include","uiComponent":{"type":"DROPDOWN","options":{"values":["Approved","Unapproved","Spam","Deleted","Flagged","Highlighted"]}},"description":"Moderation state of posts to include. Defaults to Approved."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of posts to return (1-100, default 25)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response's cursor.next to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"cursor":{"prev":null,"hasNext":true,"next":"1:0:0","hasPrev":false,"total":null,"id":null,"more":true},"response":[{"id":"3000002","message":"<p>Needs review</p>","thread":"55555","forum":"myforum","isApproved":false,"createdAt":"2016-02-02T11:00:00","author":{"name":"Anon","isAnonymous":true}}]}
   */
  async listPosts(forum, include, limit, cursor) {
    const resolvedInclude = this.#resolveChoice(include, {
      Approved: 'approved',
      Unapproved: 'unapproved',
      Spam: 'spam',
      Deleted: 'deleted',
      Flagged: 'flagged',
      Highlighted: 'highlighted',
    })

    return await this.#apiRequest({
      logTag: '[listPosts]',
      url: `${ API_BASE_URL }/posts/list.json`,
      method: 'get',
      query: { forum, include: resolvedInclude || 'approved', limit, cursor },
    })
  }

  /**
   * @operationName Create Post
   * @category Posts
   * @description Creates a new post (comment) on a thread. Provide the thread ID and the message text; optionally set a parent post ID to make it a reply. When posting on behalf of an anonymous author, supply author name and email. Requires a valid access token.
   * @route POST /posts/create
   * @paramDef {"type":"String","label":"Thread ID","name":"thread","required":true,"description":"Numeric thread ID to post the comment to."}
   * @paramDef {"type":"String","label":"Message","name":"message","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The comment body. HTML is supported per the forum's settings."}
   * @paramDef {"type":"String","label":"Parent Post ID","name":"parent","description":"ID of the post being replied to. Omit for a top-level comment."}
   * @paramDef {"type":"String","label":"Author Name","name":"authorName","description":"Display name for an anonymous author (when not posting as an authenticated user)."}
   * @paramDef {"type":"String","label":"Author Email","name":"authorEmail","description":"Email for an anonymous author (RFC 5322). Often required for anonymous posting."}
   * @paramDef {"type":"String","label":"State","name":"state","uiComponent":{"type":"DROPDOWN","options":{"values":["Unapproved","Approved","Spam","Killed"]}},"description":"Initial moderation state of the post. Requires moderation permission to force approval."}
   *
   * @returns {Object}
   * @sampleResult {"id":"3000010","message":"<p>Thanks for sharing!</p>","thread":"55555","forum":"myforum","parent":null,"createdAt":"2016-03-05T14:00:00","isApproved":true,"author":{"name":"Jane Doe","username":"jane"}}
   */
  async createPost(thread, message, parent, authorName, authorEmail, state) {
    const resolvedState = this.#resolveChoice(state, {
      Unapproved: 'unapproved',
      Approved: 'approved',
      Spam: 'spam',
      Killed: 'killed',
    })

    return await this.#apiRequest({
      logTag: '[createPost]',
      url: `${ API_BASE_URL }/posts/create.json`,
      method: 'post',
      body: {
        thread,
        message,
        parent,
        author_name: authorName,
        author_email: authorEmail,
        state: resolvedState,
      },
    })
  }

  /**
   * @operationName Approve Post
   * @category Posts
   * @description Approves a post (comment), making it publicly visible and moving it out of the moderation queue. Requires a valid access token with moderation permission on the forum.
   * @route POST /posts/approve
   * @paramDef {"type":"String","label":"Post ID","name":"post","required":true,"description":"Numeric post (comment) ID to approve."}
   *
   * @returns {Object}
   * @sampleResult {"code":0,"response":[{"id":"3000002"}]}
   */
  async approvePost(post) {
    return await this.#apiRequest({
      logTag: '[approvePost]',
      url: `${ API_BASE_URL }/posts/approve.json`,
      method: 'post',
      body: { post },
    })
  }

  /**
   * @operationName Remove Post
   * @category Posts
   * @description Removes (deletes) a post (comment) so it is no longer displayed. This is a moderation delete, not a permanent purge. Requires a valid access token with moderation permission on the forum.
   * @route POST /posts/remove
   * @paramDef {"type":"String","label":"Post ID","name":"post","required":true,"description":"Numeric post (comment) ID to remove."}
   *
   * @returns {Object}
   * @sampleResult {"code":0,"response":[{"id":"3000002"}]}
   */
  async removePost(post) {
    return await this.#apiRequest({
      logTag: '[removePost]',
      url: `${ API_BASE_URL }/posts/remove.json`,
      method: 'post',
      body: { post },
    })
  }

  /**
   * @operationName Mark Post As Spam
   * @category Posts
   * @description Flags a post (comment) as spam, hiding it and training Disqus's spam filter. Requires a valid access token with moderation permission on the forum.
   * @route POST /posts/spam
   * @paramDef {"type":"String","label":"Post ID","name":"post","required":true,"description":"Numeric post (comment) ID to mark as spam."}
   *
   * @returns {Object}
   * @sampleResult {"code":0,"response":[{"id":"3000002"}]}
   */
  async markPostAsSpam(post) {
    return await this.#apiRequest({
      logTag: '[markPostAsSpam]',
      url: `${ API_BASE_URL }/posts/spam.json`,
      method: 'post',
      body: { post },
    })
  }

  /**
   * @operationName Highlight Post
   * @category Posts
   * @description Highlights a post (comment), promoting it as a featured comment in the thread. Requires a valid access token with moderation permission on the forum.
   * @route POST /posts/highlight
   * @paramDef {"type":"String","label":"Post ID","name":"post","required":true,"description":"Numeric post (comment) ID to highlight."}
   *
   * @returns {Object}
   * @sampleResult {"id":"3000002","isHighlighted":true}
   */
  async highlightPost(post) {
    return await this.#apiRequest({
      logTag: '[highlightPost]',
      url: `${ API_BASE_URL }/posts/highlight.json`,
      method: 'post',
      body: { post },
    })
  }

  /* =========================================================================
   * Users
   * ========================================================================= */

  /**
   * @operationName Get User Details
   * @category Users
   * @description Retrieves the public profile details of a Disqus user by their numeric user ID, including username, display name, avatar, join date, and aggregate reputation and post/like counts.
   * @route GET /users/details
   * @paramDef {"type":"String","label":"User ID","name":"user","required":true,"description":"Numeric Disqus user ID to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"12345","username":"jane","name":"Jane Doe","joinedAt":"2014-06-01T00:00:00","avatar":{"permalink":"https://disqus.com/api/users/avatars/jane.jpg"},"reputation":4.2,"numPosts":320,"numLikesReceived":58,"isPrivate":false}
   */
  async getUserDetails(user) {
    return await this.#apiRequest({
      logTag: '[getUserDetails]',
      url: `${ API_BASE_URL }/users/details.json`,
      method: 'get',
      query: { user },
    })
  }

  /**
   * @operationName List User Posts
   * @category Users
   * @description Lists posts (comments) authored by a specific Disqus user, most recent first, across all forums visible to your credentials. Supports pagination. Useful for auditing a user's activity.
   * @route GET /users/list-posts
   * @paramDef {"type":"String","label":"User ID","name":"user","required":true,"description":"Numeric Disqus user ID whose posts to list."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of posts to return (1-100, default 25)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous response's cursor.next to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"cursor":{"prev":null,"hasNext":true,"next":"1:0:0","hasPrev":false,"total":null,"id":null,"more":true},"response":[{"id":"3000001","message":"<p>Great post!</p>","thread":"55555","forum":"myforum","createdAt":"2016-02-01T10:00:00","isApproved":true}]}
   */
  async listUserPosts(user, limit, cursor) {
    return await this.#apiRequest({
      logTag: '[listUserPosts]',
      url: `${ API_BASE_URL }/users/listPosts.json`,
      method: 'get',
      query: { user, limit, cursor },
    })
  }
}

Flowrunner.ServerCode.addService(DisqusService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Disqus application Public Key (API Key). Create an application at https://disqus.com/api/applications/ and copy its Public Key.',
  },
  {
    name: 'accessToken',
    displayName: 'Access Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'An OAuth access token for the account. Required for write actions (create/moderate) and private reads.',
  },
])
