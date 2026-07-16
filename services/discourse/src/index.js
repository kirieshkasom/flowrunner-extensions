const logger = {
  info: (...args) => console.log('[Discourse] info:', ...args),
  debug: (...args) => console.log('[Discourse] debug:', ...args),
  error: (...args) => console.log('[Discourse] error:', ...args),
  warn: (...args) => console.log('[Discourse] warn:', ...args),
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
 * @integrationName Discourse
 * @integrationIcon /icon.png
 */
class DiscourseService {
  constructor(config) {
    this.siteUrl = (config.siteUrl || '').replace(/\/+$/, '')
    this.apiKey = config.apiKey
    this.apiUsername = config.apiUsername
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const url = `${ this.siteUrl }${ path }`

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Api-Key': this.apiKey,
          'Api-Username': this.apiUsername,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        })
        .query(clean(query) || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      // Discourse returns { errors: [...], error_type } with a 422 on validation failures.
      const discourseErrors = error.body?.errors
      const message = Array.isArray(discourseErrors) && discourseErrors.length
        ? discourseErrors.join('; ')
        : (error.body?.error || error.body?.message || error.message)
      const status = error.status || error.statusCode

      logger.error(`${ logTag } - failed (${ status }): ${ message }`)

      throw new Error(`Discourse API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  /**
   * @operationName Create Topic
   * @category Topics & Posts
   * @description Creates a new topic (thread) by submitting its first post. Provide a title, the body in raw Markdown, and optionally a category ID to file it under. Returns the created post, which includes the new topic_id and topic_slug. Use the returned topic_id with Create Post/Reply to add replies.
   * @route POST /posts.json
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Topic title. Must meet the forum's minimum title length."}
   * @paramDef {"type":"String","label":"Body (Markdown)","name":"raw","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Body of the first post, in raw Markdown. Must meet the forum's minimum post length."}
   * @paramDef {"type":"Number","label":"Category ID","name":"category","uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getCategoriesDictionary","description":"Numeric ID of the category to post in (not the name). Select from the categories list or enter an ID. Omit for the default/uncategorized category."}
   * @returns {Object}
   * @sampleResult {"id":301,"username":"system","created_at":"2026-07-14T12:00:00.000Z","cooked":"<p>Hello world</p>","post_number":1,"topic_id":142,"topic_slug":"welcome-to-the-forum","raw":"Hello world"}
   */
  async createTopic(title, raw, category) {
    return await this.#apiRequest({
      logTag: '[createTopic]',
      path: '/posts.json',
      method: 'post',
      body: clean({ title, raw, category }),
    })
  }

  /**
   * @operationName Create Post / Reply
   * @category Topics & Posts
   * @description Adds a reply to an existing topic. Provide the topic_id and the reply body in raw Markdown. Optionally set reply_to_post_number to reply to a specific post within the topic (threaded reply) rather than the topic as a whole. Returns the created post including its post_number.
   * @route POST /posts.json
   * @paramDef {"type":"Number","label":"Topic ID","name":"topicId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the topic to reply to (from Create Topic or Get Topic)."}
   * @paramDef {"type":"String","label":"Body (Markdown)","name":"raw","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Reply body in raw Markdown. Must meet the forum's minimum post length."}
   * @paramDef {"type":"Number","label":"Reply To Post Number","name":"replyToPostNumber","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional post_number within the topic to reply to for a threaded reply. Omit to reply to the topic."}
   * @returns {Object}
   * @sampleResult {"id":302,"username":"system","created_at":"2026-07-14T12:05:00.000Z","cooked":"<p>Great point!</p>","post_number":2,"topic_id":142,"reply_to_post_number":1,"raw":"Great point!"}
   */
  async createPost(topicId, raw, replyToPostNumber) {
    return await this.#apiRequest({
      logTag: '[createPost]',
      path: '/posts.json',
      method: 'post',
      body: clean({
        topic_id: topicId,
        raw,
        reply_to_post_number: replyToPostNumber,
      }),
    })
  }

  /**
   * @operationName Get Topic
   * @category Topics & Posts
   * @description Retrieves a topic by its numeric ID, including topic metadata and the current page of posts under post_stream. Use the post IDs and post_numbers here with Get Post, Update Post, or Create Post/Reply.
   * @route GET /t/{id}.json
   * @paramDef {"type":"Number","label":"Topic ID","name":"topicId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the topic to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":142,"title":"Welcome to the forum","slug":"welcome-to-the-forum","posts_count":2,"category_id":5,"tags":["intro"],"post_stream":{"posts":[{"id":301,"post_number":1,"username":"system","cooked":"<p>Hello world</p>"}]}}
   */
  async getTopic(topicId) {
    return await this.#apiRequest({
      logTag: '[getTopic]',
      path: `/t/${ encodeURIComponent(topicId) }.json`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Post
   * @category Topics & Posts
   * @description Retrieves a single post by its numeric ID, including the raw Markdown, cooked HTML, author, and the topic it belongs to.
   * @route GET /posts/{id}.json
   * @paramDef {"type":"Number","label":"Post ID","name":"postId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the post to retrieve (the post id, not its post_number)."}
   * @returns {Object}
   * @sampleResult {"id":301,"username":"system","created_at":"2026-07-14T12:00:00.000Z","cooked":"<p>Hello world</p>","raw":"Hello world","post_number":1,"topic_id":142,"topic_slug":"welcome-to-the-forum"}
   */
  async getPost(postId) {
    return await this.#apiRequest({
      logTag: '[getPost]',
      path: `/posts/${ encodeURIComponent(postId) }.json`,
      method: 'get',
    })
  }

  /**
   * @operationName Update Post
   * @category Topics & Posts
   * @description Edits the body of an existing post. Provide the new raw Markdown and an optional edit reason that is recorded in the post's revision history. Returns the updated post.
   * @route PUT /posts/{id}.json
   * @paramDef {"type":"Number","label":"Post ID","name":"postId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the post to edit."}
   * @paramDef {"type":"String","label":"Body (Markdown)","name":"raw","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New body content in raw Markdown, replacing the current content."}
   * @paramDef {"type":"String","label":"Edit Reason","name":"editReason","description":"Optional reason for the edit, saved in the post's revision history."}
   * @returns {Object}
   * @sampleResult {"post":{"id":301,"post_number":1,"topic_id":142,"cooked":"<p>Updated content</p>","raw":"Updated content","version":2}}
   */
  async updatePost(postId, raw, editReason) {
    return await this.#apiRequest({
      logTag: '[updatePost]',
      path: `/posts/${ encodeURIComponent(postId) }.json`,
      method: 'put',
      body: clean({
        post: clean({ raw, edit_reason: editReason }),
      }),
    })
  }

  /**
   * @operationName Delete Post
   * @category Topics & Posts
   * @description Deletes a single post by its numeric ID. Deleting the first post of a topic (post_number 1) deletes the whole topic. Returns an empty body on success.
   * @route DELETE /posts/{id}.json
   * @paramDef {"type":"Number","label":"Post ID","name":"postId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the post to delete."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deletePost(postId) {
    const result = await this.#apiRequest({
      logTag: '[deletePost]',
      path: `/posts/${ encodeURIComponent(postId) }.json`,
      method: 'delete',
    })

    return result || { success: true }
  }

  /**
   * @operationName Delete Topic
   * @category Topics & Posts
   * @description Deletes a topic by its numeric ID, removing the topic and all of its posts. Returns an empty body on success.
   * @route DELETE /t/{id}.json
   * @paramDef {"type":"Number","label":"Topic ID","name":"topicId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the topic to delete."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteTopic(topicId) {
    const result = await this.#apiRequest({
      logTag: '[deleteTopic]',
      path: `/t/${ encodeURIComponent(topicId) }.json`,
      method: 'delete',
    })

    return result || { success: true }
  }

  /**
   * @operationName List Latest Topics
   * @category Topics & Posts
   * @description Lists the most recent topics on the forum, ordered by latest activity. Optionally page through results. Returns a topic_list with topics and the users referenced by them.
   * @route GET /latest.json
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based page number for pagination. Omit for the first page."}
   * @returns {Object}
   * @sampleResult {"users":[{"id":1,"username":"system"}],"topic_list":{"topics":[{"id":142,"title":"Welcome to the forum","slug":"welcome-to-the-forum","posts_count":2,"category_id":5,"last_posted_at":"2026-07-14T12:05:00.000Z"}]}}
   */
  async listLatestTopics(page) {
    return await this.#apiRequest({
      logTag: '[listLatestTopics]',
      path: '/latest.json',
      method: 'get',
      query: { page },
    })
  }

  /**
   * @operationName List Top Topics
   * @category Topics & Posts
   * @description Lists the top topics on the forum, ranked by engagement over a chosen time period (all, yearly, quarterly, monthly, weekly, daily). Returns a topic_list with the top topics.
   * @route GET /top.json
   * @paramDef {"type":"String","label":"Period","name":"period","uiComponent":{"type":"DROPDOWN","options":{"values":["All Time","Yearly","Quarterly","Monthly","Weekly","Daily"]}},"description":"Time window used to rank topics. Defaults to All Time."}
   * @returns {Object}
   * @sampleResult {"users":[{"id":1,"username":"system"}],"topic_list":{"topics":[{"id":142,"title":"Welcome to the forum","slug":"welcome-to-the-forum","posts_count":42,"like_count":120,"views":3400}]}}
   */
  async listTopTopics(period) {
    const resolvedPeriod = this.#resolveChoice(period, {
      'All Time': 'all',
      Yearly: 'yearly',
      Quarterly: 'quarterly',
      Monthly: 'monthly',
      Weekly: 'weekly',
      Daily: 'daily',
    })

    return await this.#apiRequest({
      logTag: '[listTopTopics]',
      path: '/top.json',
      method: 'get',
      query: { period: resolvedPeriod },
    })
  }

  /**
   * @operationName List Categories
   * @category Categories
   * @description Lists the forum's categories, including their numeric IDs, names, slugs, colors, and topic counts. Use a category's numeric ID with Create Topic and its slug + ID with Get Category Topics.
   * @route GET /categories.json
   * @paramDef {"type":"Boolean","label":"Include Subcategories","name":"includeSubcategories","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, include subcategories nested under each parent category."}
   * @returns {Object}
   * @sampleResult {"category_list":{"categories":[{"id":5,"name":"General","slug":"general","color":"0088CC","topic_count":124,"description_text":"General discussion"}]}}
   */
  async listCategories(includeSubcategories) {
    return await this.#apiRequest({
      logTag: '[listCategories]',
      path: '/categories.json',
      method: 'get',
      query: { include_subcategories: includeSubcategories ? true : undefined },
    })
  }

  /**
   * @operationName Get Category Topics
   * @category Categories
   * @description Lists the topics within a specific category. Requires both the category slug and its numeric ID (Discourse addresses categories as /c/{slug}/{id}). Returns a topic_list scoped to that category.
   * @route GET /c/{slug}/{id}.json
   * @paramDef {"type":"String","label":"Category Slug","name":"slug","required":true,"description":"URL slug of the category, e.g. general (from List Categories)."}
   * @paramDef {"type":"Number","label":"Category ID","name":"categoryId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getCategoriesDictionary","description":"Numeric ID of the category (from List Categories)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based page number for pagination. Omit for the first page."}
   * @returns {Object}
   * @sampleResult {"topic_list":{"topics":[{"id":142,"title":"Welcome to the forum","slug":"welcome-to-the-forum","category_id":5,"posts_count":2}]}}
   */
  async getCategoryTopics(slug, categoryId, page) {
    return await this.#apiRequest({
      logTag: '[getCategoryTopics]',
      path: `/c/${ encodeURIComponent(slug) }/${ encodeURIComponent(categoryId) }.json`,
      method: 'get',
      query: { page },
    })
  }

  /**
   * @operationName Search
   * @category Search
   * @description Full-text search across topics, posts, and users. The query supports Discourse search filters such as @username (by author), #category-slug (in a category), tag:name, status:open, status:closed, status:solved, in:title, order:latest, and quoted "exact phrases". Returns matching posts, topics, and users.
   * @route GET /search.json
   * @paramDef {"type":"String","label":"Query","name":"q","required":true,"description":"Search query. Supports filters, e.g. logging @alice #support status:open."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number for paginated search results. Omit for the first page."}
   * @returns {Object}
   * @sampleResult {"posts":[{"id":301,"username":"system","topic_id":142,"post_number":1,"blurb":"Hello world..."}],"topics":[{"id":142,"title":"Welcome to the forum","slug":"welcome-to-the-forum"}],"users":[],"grouped_search_result":{"term":"welcome","post_ids":[301]}}
   */
  async search(q, page) {
    return await this.#apiRequest({
      logTag: '[search]',
      path: '/search.json',
      method: 'get',
      query: { q, page },
    })
  }

  /**
   * @operationName Get User
   * @category Users
   * @description Retrieves a user's public profile by username, including id, name, avatar, trust level, and stats. The returned user.id is required for admin actions like Suspend User.
   * @route GET /users/{username}.json
   * @paramDef {"type":"String","label":"Username","name":"username","required":true,"description":"Username of the user to retrieve (without a leading @)."}
   * @returns {Object}
   * @sampleResult {"user":{"id":42,"username":"alice","name":"Alice Doe","trust_level":2,"avatar_template":"/user_avatar/forum/alice/{size}/1_2.png","admin":false,"moderator":false}}
   */
  async getUser(username) {
    return await this.#apiRequest({
      logTag: '[getUser]',
      path: `/users/${ encodeURIComponent(username) }.json`,
      method: 'get',
    })
  }

  /**
   * @operationName Create User
   * @category Users
   * @description Registers a new user account. Provide name, email, username, and password. Set active to skip email activation and approved to bypass admin approval (both require admin API privileges). Returns success status and the new user_id.
   * @route POST /users.json
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Full display name of the new user."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Email address for the new account. Must be unique."}
   * @paramDef {"type":"String","label":"Username","name":"username","required":true,"description":"Unique username for the new account."}
   * @paramDef {"type":"String","label":"Password","name":"password","required":true,"description":"Password for the new account. Must meet the forum's password policy."}
   * @paramDef {"type":"Boolean","label":"Active","name":"active","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, activates the account immediately without email confirmation. Requires admin API privileges."}
   * @paramDef {"type":"Boolean","label":"Approved","name":"approved","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, marks the account as approved, bypassing admin approval queues. Requires admin API privileges."}
   * @returns {Object}
   * @sampleResult {"success":true,"active":true,"message":"Your account is activated and ready to use.","user_id":42}
   */
  async createUser(name, email, username, password, active, approved) {
    return await this.#apiRequest({
      logTag: '[createUser]',
      path: '/users.json',
      method: 'post',
      body: clean({
        name,
        email,
        username,
        password,
        active: active ? true : undefined,
        approved: approved ? true : undefined,
      }),
    })
  }

  /**
   * @operationName Get User by External ID
   * @category Users
   * @description Looks up a user by their external identifier (the external_id set via SSO / DiscourseConnect). Returns the same profile shape as Get User. Useful for mapping your own system's user IDs to Discourse accounts.
   * @route GET /u/by-external/{external_id}.json
   * @paramDef {"type":"String","label":"External ID","name":"externalId","required":true,"description":"The external_id assigned to the user through SSO / DiscourseConnect."}
   * @returns {Object}
   * @sampleResult {"user":{"id":42,"username":"alice","name":"Alice Doe","trust_level":2,"external_id":"ext-1001"}}
   */
  async getUserByExternalId(externalId) {
    return await this.#apiRequest({
      logTag: '[getUserByExternalId]',
      path: `/u/by-external/${ encodeURIComponent(externalId) }.json`,
      method: 'get',
    })
  }

  /**
   * @operationName List User Actions
   * @category Users
   * @description Lists a user's recent activity stream (posts, replies, likes given/received, and more) filtered by action type. Returns user_actions with each item's action_type, topic, and excerpt.
   * @route GET /user_actions.json
   * @paramDef {"type":"String","label":"Username","name":"username","required":true,"description":"Username whose activity to list."}
   * @paramDef {"type":"String","label":"Action Types","name":"filter","uiComponent":{"type":"DROPDOWN","options":{"values":["Topics Created","Replies","Posts","Likes Received","Likes Given","Bookmarks","Mentions","Solved"]}},"description":"Type of activity to return. Omit to return all action types."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of items to skip for pagination. Omit for the most recent items."}
   * @returns {Object}
   * @sampleResult {"user_actions":[{"action_type":4,"created_at":"2026-07-14T12:00:00.000Z","username":"alice","title":"Welcome to the forum","topic_id":142,"post_number":1,"excerpt":"Hello world"}]}
   */
  async listUserActions(username, filter, offset) {
    const resolvedFilter = this.#resolveChoice(filter, {
      'Topics Created': '4',
      Replies: '5',
      Posts: '4,5',
      'Likes Received': '2',
      'Likes Given': '1',
      Bookmarks: '3',
      Mentions: '6',
      Solved: '15',
    })

    return await this.#apiRequest({
      logTag: '[listUserActions]',
      path: '/user_actions.json',
      method: 'get',
      query: {
        username,
        filter: resolvedFilter,
        offset,
      },
    })
  }

  /**
   * @operationName Suspend User
   * @category Users
   * @description Suspends a user account until a given date, blocking them from logging in. Requires the numeric user id (from Get User) and admin API privileges. Provide the suspend-until timestamp and a reason shown to the user. Returns the suspension details.
   * @route PUT /admin/users/{id}/suspend
   * @paramDef {"type":"Number","label":"User ID","name":"userId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the user to suspend (the user.id from Get User, not the username)."}
   * @paramDef {"type":"String","label":"Suspend Until","name":"suspendUntil","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Date/time until which the user is suspended (ISO 8601, e.g. 2026-12-31T00:00:00Z)."}
   * @paramDef {"type":"String","label":"Reason","name":"reason","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Reason for the suspension, recorded and shown to the suspended user on login."}
   * @returns {Object}
   * @sampleResult {"suspension":{"suspended":true,"suspend_reason":"Spam","full_suspend_reason":"Spam","suspended_till":"2026-12-31T00:00:00.000Z","suspended_at":"2026-07-14T12:00:00.000Z"}}
   */
  async suspendUser(userId, suspendUntil, reason) {
    return await this.#apiRequest({
      logTag: '[suspendUser]',
      path: `/admin/users/${ encodeURIComponent(userId) }/suspend.json`,
      method: 'put',
      body: clean({
        suspend_until: suspendUntil,
        reason,
      }),
    })
  }

  /**
   * @operationName Send Private Message
   * @category Private Messages
   * @description Sends a private message to one or more users. Provide a title, the body in raw Markdown, and the recipient usernames. Internally this creates a private_message topic. Returns the created message post including its topic_id.
   * @route POST /posts.json
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Subject line of the private message."}
   * @paramDef {"type":"String","label":"Body (Markdown)","name":"raw","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Message body in raw Markdown."}
   * @paramDef {"type":"Array<String>","label":"Recipient Usernames","name":"recipients","required":true,"description":"Usernames of the recipients (without a leading @). Sent as a comma-separated list to Discourse."}
   * @returns {Object}
   * @sampleResult {"id":303,"username":"system","post_number":1,"topic_id":143,"topic_slug":"a-private-note","archetype":"private_message","raw":"Hi there"}
   */
  async sendPrivateMessage(title, raw, recipients) {
    const targetRecipients = Array.isArray(recipients)
      ? recipients.join(',')
      : recipients

    return await this.#apiRequest({
      logTag: '[sendPrivateMessage]',
      path: '/posts.json',
      method: 'post',
      body: clean({
        title,
        raw,
        target_recipients: targetRecipients,
        archetype: 'private_message',
      }),
    })
  }

  /**
   * @operationName List Tags
   * @category Tags
   * @description Lists all tags configured on the forum along with their topic counts. Returns tags and, where applicable, extra tag groups.
   * @route GET /tags.json
   * @returns {Object}
   * @sampleResult {"tags":[{"id":"intro","text":"intro","count":12},{"id":"support","text":"support","count":45}]}
   */
  async listTags() {
    return await this.#apiRequest({
      logTag: '[listTags]',
      path: '/tags.json',
      method: 'get',
    })
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /**
   * @typedef {Object} getCategoriesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter matched against category names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Categories are returned in a single call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Categories Dictionary
   * @description Provides a searchable list of forum categories for selecting a category in Create Topic and Get Category Topics. Each option's value is the category's numeric ID.
   * @route POST /get-categories-dictionary
   * @paramDef {"type":"getCategoriesDictionary__payload","label":"Payload","name":"payload","description":"Search input used to filter categories by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"General","value":"5","note":"Slug: general - 124 topics"}],"cursor":null}
   */
  async getCategoriesDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getCategoriesDictionary]',
      path: '/categories.json',
      method: 'get',
    })

    const categories = response?.category_list?.categories || []
    const term = (search || '').trim().toLowerCase()

    const filtered = term
      ? categories.filter(cat => (cat.name || '').toLowerCase().includes(term))
      : categories

    return {
      items: filtered.map(cat => {
        const noteParts = [
          cat.slug ? `Slug: ${ cat.slug }` : null,
          typeof cat.topic_count === 'number' ? `${ cat.topic_count } topics` : null,
        ].filter(Boolean)

        return {
          label: cat.name,
          value: String(cat.id),
          note: noteParts.join(' - ') || undefined,
        }
      }),
      cursor: null,
    }
  }
}

Flowrunner.ServerCode.addService(DiscourseService, [
  {
    name: 'siteUrl',
    displayName: 'Site URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Discourse forum URL, e.g. https://forum.example.com (strip any trailing slash).',
  },
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Generate under Discourse → Admin → API → Keys → generate a key. Sent as the Api-Key header.',
  },
  {
    name: 'apiUsername',
    displayName: 'API Username',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'The username the API key acts as (e.g. system or an admin). Sent as the Api-Username header.',
  },
])
