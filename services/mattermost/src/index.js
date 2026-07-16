const logger = {
  info: (...args) => console.log('[Mattermost] info:', ...args),
  debug: (...args) => console.log('[Mattermost] debug:', ...args),
  error: (...args) => console.log('[Mattermost] error:', ...args),
  warn: (...args) => console.log('[Mattermost] warn:', ...args),
}

const DEFAULT_PER_PAGE = 60
const MAX_PER_PAGE = 200

/**
 * @usesFileStorage
 * @integrationName Mattermost
 * @integrationIcon /icon.png
 */
class Mattermost {
  constructor(config) {
    this.serverUrl = (config.serverUrl || '').replace(/\/+$/, '')
    this.accessToken = config.accessToken
    this.apiBaseUrl = `${ this.serverUrl }/api/v4`
  }

  #headers(extra) {
    return {
      Authorization: `Bearer ${ this.accessToken }`,
      'Content-Type': 'application/json',
      ...(extra || {}),
    }
  }

  #cleanBody(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return body
    }

    return Object.fromEntries(
      Object.entries(body).filter(([, value]) => value !== undefined && value !== null)
    )
  }

  #cleanQuery(query) {
    if (!query) {
      return {}
    }

    return Object.fromEntries(
      Object.entries(query).filter(([, value]) => value !== undefined && value !== null && value !== '')
    )
  }

  // Single private request helper — all JSON external calls go through here.
  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const url = `${ this.apiBaseUrl }${ path }`

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set(this.#headers())
        .query(this.#cleanQuery(query))

      const payload = Array.isArray(body) ? body : this.#cleanBody(body)

      return payload !== undefined ? await request.send(payload) : await request
    } catch (error) {
      const body = error.body || {}
      const message = body.message || error.message
      const detail = body.id ? ` (${ body.id }, status ${ body.status_code || error.status || '' })` : ''

      logger.error(`${ logTag } - failed: ${ message }${ detail }`)

      throw new Error(`Mattermost API error: ${ message }${ detail }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #clampPerPage(perPage) {
    const value = Number(perPage)

    if (!Number.isFinite(value) || value <= 0) {
      return DEFAULT_PER_PAGE
    }

    return Math.min(Math.floor(value), MAX_PER_PAGE)
  }

  // ----------------------------------------------------------------------------
  // Posts
  // ----------------------------------------------------------------------------

  /**
   * @operationName Create Post
   * @category Posts
   * @description Creates a new post (message) in a Mattermost channel. Supports threaded replies via the root post ID, custom props (for attachments/metadata), and attaching previously uploaded files by their file IDs. Use Upload File first to obtain file IDs.
   * @route POST /posts
   * @paramDef {"type":"String","label":"Channel ID","name":"channelId","required":true,"dictionary":"getChannelsDictionary","description":"ID of the channel to post the message in."}
   * @paramDef {"type":"String","label":"Message","name":"message","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text body of the post. Supports Markdown formatting."}
   * @paramDef {"type":"String","label":"Root Post ID","name":"rootId","description":"ID of the root post to reply to. Set this to create a threaded reply; leave empty for a top-level post."}
   * @paramDef {"type":"Array<String>","label":"File IDs","name":"fileIds","description":"IDs of previously uploaded files to attach to the post. Obtain them from the Upload File action."}
   * @paramDef {"type":"Object","label":"Props","name":"props","description":"Optional key/value object of post properties, e.g. message attachments or custom metadata."}
   * @returns {Object}
   * @sampleResult {"id":"post123","channel_id":"chan123","message":"Hello team","user_id":"user123","create_at":1700000000000,"root_id":""}
   */
  async createPost(channelId, message, rootId, fileIds, props) {
    return this.#apiRequest({
      path: '/posts',
      method: 'post',
      body: {
        channel_id: channelId,
        message,
        root_id: rootId,
        file_ids: Array.isArray(fileIds) && fileIds.length ? fileIds : undefined,
        props,
      },
      logTag: 'createPost',
    })
  }

  /**
   * @operationName Get Post
   * @category Posts
   * @description Retrieves a single post by its ID, including its message, author, channel, timestamps, and thread metadata.
   * @route GET /get-post
   * @paramDef {"type":"String","label":"Post ID","name":"postId","required":true,"description":"ID of the post to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"post123","channel_id":"chan123","message":"Hello team","user_id":"user123","create_at":1700000000000}
   */
  async getPost(postId) {
    return this.#apiRequest({
      path: `/posts/${ postId }`,
      method: 'get',
      logTag: 'getPost',
    })
  }

  /**
   * @operationName Update Post
   * @category Posts
   * @description Updates the message text and/or props of an existing post. This replaces the post content; fields left empty are not changed.
   * @route PUT /update-post
   * @paramDef {"type":"String","label":"Post ID","name":"postId","required":true,"description":"ID of the post to update."}
   * @paramDef {"type":"String","label":"Message","name":"message","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New text body for the post. Supports Markdown formatting."}
   * @paramDef {"type":"Object","label":"Props","name":"props","description":"Optional replacement post properties object."}
   * @returns {Object}
   * @sampleResult {"id":"post123","channel_id":"chan123","message":"Edited message","update_at":1700000005000}
   */
  async updatePost(postId, message, props) {
    return this.#apiRequest({
      path: `/posts/${ postId }`,
      method: 'put',
      body: {
        id: postId,
        message,
        props,
      },
      logTag: 'updatePost',
    })
  }

  /**
   * @operationName Delete Post
   * @category Posts
   * @description Soft-deletes a post by its ID. The post is removed from the channel for all users.
   * @route DELETE /delete-post
   * @paramDef {"type":"String","label":"Post ID","name":"postId","required":true,"description":"ID of the post to delete."}
   * @returns {Object}
   * @sampleResult {"status":"OK"}
   */
  async deletePost(postId) {
    return this.#apiRequest({
      path: `/posts/${ postId }`,
      method: 'delete',
      logTag: 'deletePost',
    })
  }

  /**
   * @operationName Get Channel Posts
   * @category Posts
   * @description Retrieves a paginated list of posts for a channel, ordered newest-first. Returns an order array of post IDs plus a keyed posts map. Use page and per-page for pagination.
   * @route GET /channel-posts
   * @paramDef {"type":"String","label":"Channel ID","name":"channelId","required":true,"dictionary":"getChannelsDictionary","description":"ID of the channel to retrieve posts from."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based page number to fetch (default 0)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of posts per page (default 60, maximum 200)."}
   * @returns {Object}
   * @sampleResult {"order":["post123"],"posts":{"post123":{"id":"post123","message":"Hello","user_id":"user123"}},"next_post_id":"","prev_post_id":""}
   */
  async getChannelPosts(channelId, page, perPage) {
    return this.#apiRequest({
      path: `/channels/${ channelId }/posts`,
      method: 'get',
      query: {
        page: page !== undefined ? page : 0,
        per_page: this.#clampPerPage(perPage),
      },
      logTag: 'getChannelPosts',
    })
  }

  /**
   * @operationName Search Posts
   * @category Posts
   * @description Searches posts across a team using Mattermost search terms. Supports modifiers such as "from:", "in:", "before:", and "after:". Set OR search to match any term instead of all terms.
   * @route POST /search-posts
   * @paramDef {"type":"String","label":"Team ID","name":"teamId","required":true,"dictionary":"getTeamsDictionary","description":"ID of the team to search within."}
   * @paramDef {"type":"String","label":"Terms","name":"terms","required":true,"description":"Search terms. Supports modifiers like from:username, in:channel-name, before:YYYY-MM-DD."}
   * @paramDef {"type":"Boolean","label":"Match Any Term","name":"isOrSearch","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, matches posts containing any of the terms (OR). When disabled, all terms must match (AND)."}
   * @returns {Object}
   * @sampleResult {"order":["post123"],"posts":{"post123":{"id":"post123","message":"quarterly report","user_id":"user123"}}}
   */
  async searchPosts(teamId, terms, isOrSearch) {
    return this.#apiRequest({
      path: `/teams/${ teamId }/posts/search`,
      method: 'post',
      body: {
        terms,
        is_or_search: Boolean(isOrSearch),
      },
      logTag: 'searchPosts',
    })
  }

  /**
   * @operationName Pin Post
   * @category Posts
   * @description Pins a post to its channel so it appears in the channel's pinned posts list.
   * @route POST /pin-post
   * @paramDef {"type":"String","label":"Post ID","name":"postId","required":true,"description":"ID of the post to pin."}
   * @returns {Object}
   * @sampleResult {"status":"OK"}
   */
  async pinPost(postId) {
    return this.#apiRequest({
      path: `/posts/${ postId }/pin`,
      method: 'post',
      logTag: 'pinPost',
    })
  }

  /**
   * @operationName Unpin Post
   * @category Posts
   * @description Unpins a previously pinned post from its channel.
   * @route POST /unpin-post
   * @paramDef {"type":"String","label":"Post ID","name":"postId","required":true,"description":"ID of the post to unpin."}
   * @returns {Object}
   * @sampleResult {"status":"OK"}
   */
  async unpinPost(postId) {
    return this.#apiRequest({
      path: `/posts/${ postId }/unpin`,
      method: 'post',
      logTag: 'unpinPost',
    })
  }

  // ----------------------------------------------------------------------------
  // Channels
  // ----------------------------------------------------------------------------

  /**
   * @operationName Create Channel
   * @category Channels
   * @description Creates a new public or private channel within a team. The name is the URL-safe handle (lowercase, no spaces) and the display name is the human-readable label shown in the UI.
   * @route POST /channels
   * @paramDef {"type":"String","label":"Team ID","name":"teamId","required":true,"dictionary":"getTeamsDictionary","description":"ID of the team the channel belongs to."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"URL-safe channel handle: lowercase letters, numbers and hyphens only (e.g. project-alpha)."}
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","required":true,"description":"Human-readable channel name shown in the UI (e.g. Project Alpha)."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Public","Private"]}},"defaultValue":"Public","description":"Channel visibility: Public (open) or Private (invite-only)."}
   * @paramDef {"type":"String","label":"Purpose","name":"purpose","description":"Optional short purpose describing the channel."}
   * @paramDef {"type":"String","label":"Header","name":"header","description":"Optional channel header text shown at the top of the channel."}
   * @returns {Object}
   * @sampleResult {"id":"chan123","team_id":"team123","name":"project-alpha","display_name":"Project Alpha","type":"O"}
   */
  async createChannel(teamId, name, displayName, type, purpose, header) {
    return this.#apiRequest({
      path: '/channels',
      method: 'post',
      body: {
        team_id: teamId,
        name,
        display_name: displayName,
        type: this.#resolveChoice(type, { Public: 'O', Private: 'P' }),
        purpose,
        header,
      },
      logTag: 'createChannel',
    })
  }

  /**
   * @operationName Get Channel
   * @category Channels
   * @description Retrieves a channel by its ID, including name, display name, type, team, and metadata.
   * @route GET /get-channel
   * @paramDef {"type":"String","label":"Channel ID","name":"channelId","required":true,"dictionary":"getChannelsDictionary","description":"ID of the channel to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"chan123","team_id":"team123","name":"general","display_name":"General","type":"O"}
   */
  async getChannel(channelId) {
    return this.#apiRequest({
      path: `/channels/${ channelId }`,
      method: 'get',
      logTag: 'getChannel',
    })
  }

  /**
   * @operationName Get Channel by Name
   * @category Channels
   * @description Retrieves a channel within a team by its URL-safe name (handle) rather than its ID.
   * @route GET /channel-by-name
   * @paramDef {"type":"String","label":"Team ID","name":"teamId","required":true,"dictionary":"getTeamsDictionary","description":"ID of the team the channel belongs to."}
   * @paramDef {"type":"String","label":"Channel Name","name":"name","required":true,"description":"URL-safe channel handle (e.g. general)."}
   * @returns {Object}
   * @sampleResult {"id":"chan123","team_id":"team123","name":"general","display_name":"General","type":"O"}
   */
  async getChannelByName(teamId, name) {
    return this.#apiRequest({
      path: `/teams/${ teamId }/channels/name/${ name }`,
      method: 'get',
      logTag: 'getChannelByName',
    })
  }

  /**
   * @operationName List Channels for Team
   * @category Channels
   * @description Retrieves a paginated list of public channels for a team. Use page and per-page to iterate through all channels.
   * @route GET /team-channels
   * @paramDef {"type":"String","label":"Team ID","name":"teamId","required":true,"dictionary":"getTeamsDictionary","description":"ID of the team whose channels to list."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based page number to fetch (default 0)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of channels per page (default 60, maximum 200)."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":"chan123","name":"general","display_name":"General","type":"O"}]
   */
  async listChannelsForTeam(teamId, page, perPage) {
    return this.#apiRequest({
      path: `/teams/${ teamId }/channels`,
      method: 'get',
      query: {
        page: page !== undefined ? page : 0,
        per_page: this.#clampPerPage(perPage),
      },
      logTag: 'listChannelsForTeam',
    })
  }

  /**
   * @operationName Delete Channel
   * @category Channels
   * @description Archives (soft-deletes) a channel by its ID. The channel is removed from active lists but its history is retained.
   * @route DELETE /delete-channel
   * @paramDef {"type":"String","label":"Channel ID","name":"channelId","required":true,"dictionary":"getChannelsDictionary","description":"ID of the channel to archive."}
   * @returns {Object}
   * @sampleResult {"status":"OK"}
   */
  async deleteChannel(channelId) {
    return this.#apiRequest({
      path: `/channels/${ channelId }`,
      method: 'delete',
      logTag: 'deleteChannel',
    })
  }

  /**
   * @operationName Add User to Channel
   * @category Channels
   * @description Adds a user as a member of a channel.
   * @route POST /channel-add-member
   * @paramDef {"type":"String","label":"Channel ID","name":"channelId","required":true,"dictionary":"getChannelsDictionary","description":"ID of the channel to add the user to."}
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"ID of the user to add to the channel."}
   * @returns {Object}
   * @sampleResult {"channel_id":"chan123","user_id":"user123","roles":"channel_user"}
   */
  async addUserToChannel(channelId, userId) {
    return this.#apiRequest({
      path: `/channels/${ channelId }/members`,
      method: 'post',
      body: { user_id: userId },
      logTag: 'addUserToChannel',
    })
  }

  /**
   * @operationName Remove User from Channel
   * @category Channels
   * @description Removes a user from a channel's membership.
   * @route DELETE /channel-remove-member
   * @paramDef {"type":"String","label":"Channel ID","name":"channelId","required":true,"dictionary":"getChannelsDictionary","description":"ID of the channel to remove the user from."}
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"ID of the user to remove from the channel."}
   * @returns {Object}
   * @sampleResult {"status":"OK"}
   */
  async removeUserFromChannel(channelId, userId) {
    return this.#apiRequest({
      path: `/channels/${ channelId }/members/${ userId }`,
      method: 'delete',
      logTag: 'removeUserFromChannel',
    })
  }

  /**
   * @operationName Create Direct Channel
   * @category Channels
   * @description Creates (or returns the existing) direct message channel between two users.
   * @route POST /direct-channel
   * @paramDef {"type":"String","label":"First User ID","name":"userId1","required":true,"dictionary":"getUsersDictionary","description":"ID of the first user in the direct conversation."}
   * @paramDef {"type":"String","label":"Second User ID","name":"userId2","required":true,"dictionary":"getUsersDictionary","description":"ID of the second user in the direct conversation."}
   * @returns {Object}
   * @sampleResult {"id":"dm123","type":"D","name":"user123__user456"}
   */
  async createDirectChannel(userId1, userId2) {
    return this.#apiRequest({
      path: '/channels/direct',
      method: 'post',
      body: [userId1, userId2],
      logTag: 'createDirectChannel',
    })
  }

  /**
   * @operationName Create Group Channel
   * @category Channels
   * @description Creates (or returns the existing) group message channel among three or more users.
   * @route POST /group-channel
   * @paramDef {"type":"Array<String>","label":"User IDs","name":"userIds","required":true,"description":"IDs of the users (typically 3 to 8) to include in the group conversation."}
   * @returns {Object}
   * @sampleResult {"id":"gm123","type":"G","name":"grouphash"}
   */
  async createGroupChannel(userIds) {
    return this.#apiRequest({
      path: '/channels/group',
      method: 'post',
      body: Array.isArray(userIds) ? userIds : [],
      logTag: 'createGroupChannel',
    })
  }

  // ----------------------------------------------------------------------------
  // Teams
  // ----------------------------------------------------------------------------

  /**
   * @operationName List Teams
   * @category Teams
   * @description Retrieves a paginated list of teams on the server that are visible to the authenticated account.
   * @route GET /teams
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Zero-based page number to fetch (default 0)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of teams per page (default 60, maximum 200)."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":"team123","name":"engineering","display_name":"Engineering","type":"O"}]
   */
  async listTeams(page, perPage) {
    return this.#apiRequest({
      path: '/teams',
      method: 'get',
      query: {
        page: page !== undefined ? page : 0,
        per_page: this.#clampPerPage(perPage),
      },
      logTag: 'listTeams',
    })
  }

  /**
   * @operationName Get Team
   * @category Teams
   * @description Retrieves a team by its ID, including name, display name, type, and metadata.
   * @route GET /get-team
   * @paramDef {"type":"String","label":"Team ID","name":"teamId","required":true,"dictionary":"getTeamsDictionary","description":"ID of the team to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"team123","name":"engineering","display_name":"Engineering","type":"O"}
   */
  async getTeam(teamId) {
    return this.#apiRequest({
      path: `/teams/${ teamId }`,
      method: 'get',
      logTag: 'getTeam',
    })
  }

  /**
   * @operationName Get Team by Name
   * @category Teams
   * @description Retrieves a team by its URL-safe name (handle) rather than its ID.
   * @route GET /team-by-name
   * @paramDef {"type":"String","label":"Team Name","name":"name","required":true,"description":"URL-safe team handle (e.g. engineering)."}
   * @returns {Object}
   * @sampleResult {"id":"team123","name":"engineering","display_name":"Engineering","type":"O"}
   */
  async getTeamByName(name) {
    return this.#apiRequest({
      path: `/teams/name/${ name }`,
      method: 'get',
      logTag: 'getTeamByName',
    })
  }

  // ----------------------------------------------------------------------------
  // Users
  // ----------------------------------------------------------------------------

  /**
   * @operationName Get User
   * @category Users
   * @description Retrieves a user by their ID, including username, email, nickname, roles, and profile metadata.
   * @route GET /get-user
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"ID of the user to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"user123","username":"jdoe","email":"jdoe@example.com","first_name":"Jane","last_name":"Doe"}
   */
  async getUser(userId) {
    return this.#apiRequest({
      path: `/users/${ userId }`,
      method: 'get',
      logTag: 'getUser',
    })
  }

  /**
   * @operationName Get User by Username
   * @category Users
   * @description Retrieves a user by their username rather than their ID.
   * @route GET /user-by-username
   * @paramDef {"type":"String","label":"Username","name":"username","required":true,"description":"Username of the user to retrieve (without a leading @)."}
   * @returns {Object}
   * @sampleResult {"id":"user123","username":"jdoe","email":"jdoe@example.com","first_name":"Jane","last_name":"Doe"}
   */
  async getUserByUsername(username) {
    return this.#apiRequest({
      path: `/users/username/${ username }`,
      method: 'get',
      logTag: 'getUserByUsername',
    })
  }

  /**
   * @operationName Get Me
   * @category Users
   * @description Retrieves the profile of the account associated with the configured access token. Useful as a connection check to verify the server URL and token are valid.
   * @route GET /me
   * @returns {Object}
   * @sampleResult {"id":"user123","username":"botuser","email":"bot@example.com","roles":"system_user"}
   */
  async getMe() {
    return this.#apiRequest({
      path: '/users/me',
      method: 'get',
      logTag: 'getMe',
    })
  }

  /**
   * @operationName Search Users
   * @category Users
   * @description Searches for users by a term matched against username, full name, nickname, and (when permitted) email. Optionally scope the search to a specific team.
   * @route POST /search-users
   * @paramDef {"type":"String","label":"Term","name":"term","required":true,"description":"Text to search for across usernames, names, nicknames and emails."}
   * @paramDef {"type":"String","label":"Team ID","name":"teamId","dictionary":"getTeamsDictionary","description":"Optional team ID to restrict the search to members of that team."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":"user123","username":"jdoe","first_name":"Jane","last_name":"Doe"}]
   */
  async searchUsers(term, teamId) {
    return this.#apiRequest({
      path: '/users/search',
      method: 'post',
      body: {
        term,
        team_id: teamId,
      },
      logTag: 'searchUsers',
    })
  }

  /**
   * @operationName Create User
   * @category Users
   * @description Creates a new user account on the server. Requires the configured token to have user-management permissions. Provide either a password (for a standard account) or rely on the server's auth service.
   * @route POST /users
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Email address for the new user."}
   * @paramDef {"type":"String","label":"Username","name":"username","required":true,"description":"Unique username for the new user (lowercase, no spaces)."}
   * @paramDef {"type":"String","label":"Password","name":"password","description":"Password for the new user. Required for email/password accounts."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"Optional first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Optional last name."}
   * @paramDef {"type":"String","label":"Nickname","name":"nickname","description":"Optional nickname."}
   * @returns {Object}
   * @sampleResult {"id":"user789","username":"newuser","email":"newuser@example.com"}
   */
  async createUser(email, username, password, firstName, lastName, nickname) {
    return this.#apiRequest({
      path: '/users',
      method: 'post',
      body: {
        email,
        username,
        password,
        first_name: firstName,
        last_name: lastName,
        nickname,
      },
      logTag: 'createUser',
    })
  }

  /**
   * @operationName Update User Status
   * @category Users
   * @description Sets the presence status of a user (online, away, offline, or do not disturb).
   * @route PUT /user-status
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"ID of the user whose status to update."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Online","Away","Offline","Do Not Disturb"]}},"defaultValue":"Online","description":"Presence status to set for the user."}
   * @returns {Object}
   * @sampleResult {"user_id":"user123","status":"online","manual":true,"last_activity_at":1700000000000}
   */
  async updateUserStatus(userId, status) {
    return this.#apiRequest({
      path: `/users/${ userId }/status`,
      method: 'put',
      body: {
        user_id: userId,
        status: this.#resolveChoice(status, {
          Online: 'online',
          Away: 'away',
          Offline: 'offline',
          'Do Not Disturb': 'dnd',
        }),
      },
      logTag: 'updateUserStatus',
    })
  }

  // ----------------------------------------------------------------------------
  // Files
  // ----------------------------------------------------------------------------

  /**
   * @operationName Upload File
   * @category Files
   * @description Uploads a file to a channel and returns its file info, including the file ID. Provide a publicly reachable file URL; the file is downloaded and forwarded to Mattermost as multipart form data. Use the returned file ID in the File IDs parameter of Create Post to attach the file to a message.
   * @route POST /files
   * @paramDef {"type":"String","label":"Channel ID","name":"channelId","required":true,"dictionary":"getChannelsDictionary","description":"ID of the channel the file will be associated with."}
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"description":"Publicly accessible URL of the file to upload."}
   * @paramDef {"type":"String","label":"Filename","name":"filename","description":"Optional filename to use for the upload. If omitted, it is derived from the URL."}
   * @returns {Object}
   * @sampleResult {"file_infos":[{"id":"file123","name":"report.pdf","extension":"pdf","size":10240}],"client_ids":[]}
   */
  async uploadFile(channelId, fileUrl, filename) {
    const logTag = 'uploadFile'

    try {
      logger.debug(`${ logTag } - downloading source file: ${ fileUrl }`)

      const bytes = await Flowrunner.Request.get(fileUrl).setEncoding(null)
      const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)

      const resolvedName = filename || this.#filenameFromUrl(fileUrl)

      const formData = new Flowrunner.Request.FormData()

      formData.append('channel_id', channelId)
      formData.append('files', buffer, resolvedName)

      logger.debug(`${ logTag } - [POST::${ this.apiBaseUrl }/files]`)

      return await Flowrunner.Request.post(`${ this.apiBaseUrl }/files`)
        .set({ Authorization: `Bearer ${ this.accessToken }` })
        .form(formData)
    } catch (error) {
      const body = error.body || {}
      const message = body.message || error.message
      const detail = body.id ? ` (${ body.id }, status ${ body.status_code || error.status || '' })` : ''

      logger.error(`${ logTag } - failed: ${ message }${ detail }`)

      throw new Error(`Mattermost API error: ${ message }${ detail }`)
    }
  }

  #filenameFromUrl(fileUrl) {
    try {
      const pathname = new URL(fileUrl).pathname
      const name = pathname.split('/').filter(Boolean).pop()

      return name && name.length ? decodeURIComponent(name) : `upload_${ Date.now() }`
    } catch {
      return `upload_${ Date.now() }`
    }
  }

  /**
   * @operationName Get File
   * @category Files
   * @description Downloads a file from Mattermost by its file ID and stores it in FlowRunner file storage, returning a URL to the stored copy for use in later steps.
   * @route GET /get-file
   * @paramDef {"type":"String","label":"File ID","name":"fileId","required":true,"description":"ID of the file to download (as returned by Upload File or found on a post)."}
   * @paramDef {"type":"String","label":"Filename","name":"filename","description":"Optional filename to store the downloaded file under."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   * @returns {Object}
   * @sampleResult {"url":"https://files.flowrunner.io/flow/file123.pdf","filename":"file123.pdf"}
   */
  async getFile(fileId, filename, fileOptions) {
    const logTag = 'getFile'

    try {
      logger.debug(`${ logTag } - [GET::${ this.apiBaseUrl }/files/${ fileId }]`)

      const bytes = await Flowrunner.Request.get(`${ this.apiBaseUrl }/files/${ fileId }`)
        .set({ Authorization: `Bearer ${ this.accessToken }` })
        .setEncoding(null)

      const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
      const resolvedName = filename || `mattermost_${ fileId }`

      const { url } = await this.flowrunner.Files.uploadFile(buffer, {
        filename: resolvedName,
        generateUrl: true,
        overwrite: true,
        ...(fileOptions || { scope: 'FLOW' }),
      })

      return { url, filename: resolvedName }
    } catch (error) {
      const body = error.body || {}
      const message = body.message || error.message
      const detail = body.id ? ` (${ body.id }, status ${ body.status_code || error.status || '' })` : ''

      logger.error(`${ logTag } - failed: ${ message }${ detail }`)

      throw new Error(`Mattermost API error: ${ message }${ detail }`)
    }
  }

  // ----------------------------------------------------------------------------
  // Reactions
  // ----------------------------------------------------------------------------

  /**
   * @operationName Add Reaction
   * @category Reactions
   * @description Adds an emoji reaction to a post on behalf of a user. Use the emoji short name without colons (e.g. thumbsup).
   * @route POST /reactions
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"ID of the user reacting to the post."}
   * @paramDef {"type":"String","label":"Post ID","name":"postId","required":true,"description":"ID of the post to react to."}
   * @paramDef {"type":"String","label":"Emoji Name","name":"emojiName","required":true,"description":"Emoji short name without colons (e.g. thumbsup, white_check_mark, tada)."}
   * @returns {Object}
   * @sampleResult {"user_id":"user123","post_id":"post123","emoji_name":"thumbsup","create_at":1700000000000}
   */
  async addReaction(userId, postId, emojiName) {
    return this.#apiRequest({
      path: '/reactions',
      method: 'post',
      body: {
        user_id: userId,
        post_id: postId,
        emoji_name: this.#normalizeEmoji(emojiName),
      },
      logTag: 'addReaction',
    })
  }

  /**
   * @operationName Remove Reaction
   * @category Reactions
   * @description Removes an emoji reaction previously added by a user from a post.
   * @route DELETE /reactions
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"ID of the user whose reaction to remove."}
   * @paramDef {"type":"String","label":"Post ID","name":"postId","required":true,"description":"ID of the post to remove the reaction from."}
   * @paramDef {"type":"String","label":"Emoji Name","name":"emojiName","required":true,"description":"Emoji short name without colons (e.g. thumbsup)."}
   * @returns {Object}
   * @sampleResult {"status":"OK"}
   */
  async removeReaction(userId, postId, emojiName) {
    return this.#apiRequest({
      path: `/users/${ userId }/posts/${ postId }/reactions/${ this.#normalizeEmoji(emojiName) }`,
      method: 'delete',
      logTag: 'removeReaction',
    })
  }

  #normalizeEmoji(emojiName) {
    return (emojiName || '').replace(/:/g, '').trim()
  }

  // ----------------------------------------------------------------------------
  // Dictionaries
  // ----------------------------------------------------------------------------

  /**
   * @typedef {Object} getTeamsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter teams by name or display name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) for retrieving the next page of teams."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Teams Dictionary
   * @category Dictionaries
   * @description Returns a paginated list of teams for selection in dependent parameters. Search filters within the current page of results.
   * @route POST /get-teams-dictionary
   * @paramDef {"type":"getTeamsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Engineering","value":"team123","note":"engineering"}],"cursor":"1"}
   */
  async getTeamsDictionary(payload) {
    const { search, cursor } = payload || {}
    const page = this.#cursorToPage(cursor)

    const teams = await this.#apiRequest({
      path: '/teams',
      method: 'get',
      query: { page, per_page: DEFAULT_PER_PAGE },
      logTag: 'getTeamsDictionary',
    })

    const list = Array.isArray(teams) ? teams : []
    const filtered = this.#filterByText(list, search, team => [team.display_name, team.name])

    return {
      items: filtered.map(team => ({
        label: team.display_name || team.name,
        value: team.id,
        note: team.name,
      })),
      cursor: list.length === DEFAULT_PER_PAGE ? String(page + 1) : null,
    }
  }

  /**
   * @typedef {Object} getChannelsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Team ID","name":"teamId","dictionary":"getTeamsDictionary","description":"Team whose channels should be listed."}
   */

  /**
   * @typedef {Object} getChannelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter channels by name or display name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) for retrieving the next page of channels."}
   * @paramDef {"type":"getChannelsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Dependency values; provide the team ID to list its channels."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Channels Dictionary
   * @category Dictionaries
   * @description Returns a paginated list of channels for the selected team, for use in dependent parameters. Depends on a team ID supplied via criteria. Search filters within the current page of results.
   * @route POST /get-channels-dictionary
   * @paramDef {"type":"getChannelsDictionary__payload","label":"Payload","name":"payload","description":"Search, pagination, and team criteria input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"General","value":"chan123","note":"general"}],"cursor":"1"}
   */
  async getChannelsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const teamId = criteria?.teamId

    if (!teamId) {
      return { items: [], cursor: null }
    }

    const page = this.#cursorToPage(cursor)

    const channels = await this.#apiRequest({
      path: `/teams/${ teamId }/channels`,
      method: 'get',
      query: { page, per_page: DEFAULT_PER_PAGE },
      logTag: 'getChannelsDictionary',
    })

    const list = Array.isArray(channels) ? channels : []
    const filtered = this.#filterByText(list, search, channel => [channel.display_name, channel.name])

    return {
      items: filtered.map(channel => ({
        label: channel.display_name || channel.name,
        value: channel.id,
        note: channel.name,
      })),
      cursor: list.length === DEFAULT_PER_PAGE ? String(page + 1) : null,
    }
  }

  /**
   * @typedef {Object} getUsersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to search users by username or name. Uses the Mattermost user search when provided."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) for retrieving the next page of users. Ignored when a search term is supplied."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Users Dictionary
   * @category Dictionaries
   * @description Returns a paginated list of users for selection in dependent parameters. When a search term is provided, the server-side user search is used; otherwise users are listed page by page.
   * @route POST /get-users-dictionary
   * @paramDef {"type":"getUsersDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Jane Doe (jdoe)","value":"user123","note":"jdoe"}],"cursor":"1"}
   */
  async getUsersDictionary(payload) {
    const { search, cursor } = payload || {}

    if (search) {
      const results = await this.#apiRequest({
        path: '/users/search',
        method: 'post',
        body: { term: search },
        logTag: 'getUsersDictionary',
      })

      const list = Array.isArray(results) ? results : []

      return {
        items: list.map(user => this.#userToItem(user)),
        cursor: null,
      }
    }

    const page = this.#cursorToPage(cursor)

    const users = await this.#apiRequest({
      path: '/users',
      method: 'get',
      query: { page, per_page: DEFAULT_PER_PAGE },
      logTag: 'getUsersDictionary',
    })

    const list = Array.isArray(users) ? users : []

    return {
      items: list.map(user => this.#userToItem(user)),
      cursor: list.length === DEFAULT_PER_PAGE ? String(page + 1) : null,
    }
  }

  #userToItem(user) {
    const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim()
    const label = fullName ? `${ fullName } (${ user.username })` : user.username

    return {
      label,
      value: user.id,
      note: user.username,
    }
  }

  #cursorToPage(cursor) {
    const page = Number.parseInt(cursor, 10)

    return Number.isFinite(page) && page > 0 ? page : 0
  }

  #filterByText(list, search, fieldsFn) {
    if (!search) {
      return list
    }

    const term = search.toLowerCase()

    return list.filter(item => {
      return fieldsFn(item)
        .filter(Boolean)
        .some(field => String(field).toLowerCase().includes(term))
    })
  }
}

Flowrunner.ServerCode.addService(Mattermost, [
  {
    name: 'serverUrl',
    displayName: 'Server URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Mattermost server URL, e.g. https://mattermost.example.com (strip any trailing slash).',
  },
  {
    name: 'accessToken',
    displayName: 'Access Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Mattermost → Account Settings → Security → Personal Access Tokens (or a bot token). Personal access tokens must be enabled by an admin.',
  },
])
