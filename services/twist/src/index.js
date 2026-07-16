'use strict'

const logger = {
  info: (...args) => console.log('[Twist] info:', ...args),
  debug: (...args) => console.log('[Twist] debug:', ...args),
  error: (...args) => console.log('[Twist] error:', ...args),
  warn: (...args) => console.log('[Twist] warn:', ...args),
}

const API_BASE_URL = 'https://api.twist.com/api/v3'
const OAUTH_AUTHORIZE_URL = 'https://twist.com/oauth/authorize'
const OAUTH_TOKEN_URL = 'https://twist.com/oauth/access_token'

const OAUTH_SCOPE = [
  'user:read',
  'workspaces:read',
  'channels:read',
  'channels:write',
  'threads:read',
  'threads:write',
  'comments:read',
  'comments:write',
  'messages:read',
  'messages:write',
].join(',')

/**
 * @requireOAuth
 * @integrationName Twist
 * @integrationIcon /icon.png
 */
class Twist {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
  }

  /**
   * Single private request helper — all Twist API calls go through here.
   * GET endpoints receive params as query string; POST endpoints as a
   * form-urlencoded body (Twist accepts either form or JSON for writes).
   * @private
   */
  async #apiRequest({ path, method = 'get', params, logTag }) {
    const url = `${ API_BASE_URL }${ path }`
    const cleaned = this.#clean(params)

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ Authorization: `Bearer ${ this.#accessToken() }` })

      if (method.toLowerCase() === 'get') {
        return await request.query(cleaned)
      }

      return await request
        .set({ 'Content-Type': 'application/json' })
        .send(cleaned)
    } catch (error) {
      const status = error.status || error.statusCode
      const message = error.body?.error_string || error.body?.error || error.message
      logger.error(`${ logTag } - failed (${ status }): ${ message }`)
      throw new Error(`Twist API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  /**
   * @private
   */
  #accessToken() {
    return this.request.headers['oauth-access-token']
  }

  /**
   * Removes undefined/null values so optional params are not sent.
   * @private
   */
  #clean(obj) {
    if (!obj) return {}

    return Object.fromEntries(
      Object.entries(obj).filter(([, value]) => value !== undefined && value !== null && value !== '')
    )
  }

  // ---------------------------------------------------------------------------
  // OAuth2 system methods
  // ---------------------------------------------------------------------------

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()
    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('scope', OAUTH_SCOPE)

    const connectionURL = `${ OAUTH_AUTHORIZE_URL }?${ params.toString() }`
    logger.debug(`composed connectionURL: ${ connectionURL }`)

    return connectionURL
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   * @property {String} token
   * @property {String} [refreshToken]
   * @property {Number} [expirationInSeconds]
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
    const body = {
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code: callbackObject.code,
      grant_type: 'authorization_code',
      redirect_uri: callbackObject.redirectURI,
    }

    const tokenResponse = await Flowrunner.Request.post(OAUTH_TOKEN_URL)
      .set({ 'Content-Type': 'application/json' })
      .send(body)

    const accessToken = tokenResponse.access_token

    let identityName = 'Twist Account'
    let identityImageURL

    try {
      const sessionUser = await Flowrunner.Request.get(`${ API_BASE_URL }/users/get_session_user`)
        .set({ Authorization: `Bearer ${ accessToken }` })

      identityName = sessionUser.name || sessionUser.email || identityName
      identityImageURL = sessionUser.avatar_url || sessionUser.image_url
    } catch (error) {
      logger.warn(`executeCallback - could not load session user: ${ error.message }`)
    }

    return {
      token: accessToken,
      refreshToken: tokenResponse.refresh_token,
      expirationInSeconds: tokenResponse.expires_in,
      connectionIdentityName: identityName,
      connectionIdentityImageURL: identityImageURL,
      overwrite: true,
    }
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
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
    const tokenResponse = await Flowrunner.Request.post(OAUTH_TOKEN_URL)
      .set({ 'Content-Type': 'application/json' })
      .send({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      })

    return {
      token: tokenResponse.access_token,
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token || refreshToken,
    }
  }

  // ---------------------------------------------------------------------------
  // Workspaces
  // ---------------------------------------------------------------------------

  /**
   * @operationName Get Workspaces
   * @description Retrieves all Twist workspaces the connected user belongs to. A workspace is the top-level container that holds channels, threads, and conversations for an organization or team.
   * @category Workspaces
   * @route GET /workspaces/get
   * @returns {Array<Object>}
   * @sampleResult [{"id":123,"name":"Acme Inc","color":1,"creator":456,"default_conversation":789}]
   */
  async getWorkspaces() {
    return this.#apiRequest({ path: '/workspaces/get', method: 'get', logTag: 'getWorkspaces' })
  }

  /**
   * @operationName Get Workspace
   * @description Retrieves a single Twist workspace by its numeric ID, including its name, color, creator, and default conversation.
   * @category Workspaces
   * @route GET /workspaces/getone
   * @paramDef {"type":"Number","label":"Workspace ID","name":"workspaceId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The numeric ID of the workspace to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":123,"name":"Acme Inc","color":1,"creator":456,"default_conversation":789}
   */
  async getWorkspace(workspaceId) {
    return this.#apiRequest({
      path: '/workspaces/getone',
      method: 'get',
      params: { id: workspaceId },
      logTag: 'getWorkspace',
    })
  }

  /**
   * @operationName Get Default Workspace
   * @description Retrieves the connected user's default Twist workspace. Useful as a starting point when no specific workspace ID is known.
   * @category Workspaces
   * @route GET /workspaces/get-default
   * @returns {Object}
   * @sampleResult {"id":123,"name":"Acme Inc","color":1,"creator":456,"default_conversation":789}
   */
  async getDefaultWorkspace() {
    return this.#apiRequest({
      path: '/workspaces/get_default',
      method: 'get',
      logTag: 'getDefaultWorkspace',
    })
  }

  // ---------------------------------------------------------------------------
  // Channels
  // ---------------------------------------------------------------------------

  /**
   * @operationName Get Channels
   * @description Lists channels within a workspace. Channels group related threads (like topics or projects). By default only active channels are returned; enable "Include Archived" to also return archived channels.
   * @category Channels
   * @route GET /channels/get
   * @paramDef {"type":"Number","label":"Workspace ID","name":"workspaceId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getWorkspacesDictionary","description":"The workspace whose channels to list."}
   * @paramDef {"type":"Boolean","label":"Include Archived","name":"includeArchived","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"Whether to also include archived channels. Defaults to false."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of channels to return."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":10,"name":"General","description":"Team-wide discussion","workspace_id":123,"public":true,"archived":false}]
   */
  async getChannels(workspaceId, includeArchived, limit) {
    return this.#apiRequest({
      path: '/channels/get',
      method: 'get',
      params: { workspace_id: workspaceId, archived: includeArchived, limit },
      logTag: 'getChannels',
    })
  }

  /**
   * @operationName Get Channel
   * @description Retrieves a single channel by its numeric ID, including its name, description, visibility, and archived state.
   * @category Channels
   * @route GET /channels/getone
   * @paramDef {"type":"Number","label":"Channel ID","name":"channelId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The numeric ID of the channel to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":10,"name":"General","description":"Team-wide discussion","workspace_id":123,"public":true,"archived":false}
   */
  async getChannel(channelId) {
    return this.#apiRequest({
      path: '/channels/getone',
      method: 'get',
      params: { id: channelId },
      logTag: 'getChannel',
    })
  }

  /**
   * @operationName Add Channel
   * @description Creates a new channel in a workspace. Set "Public" to true so all workspace members can join, or false for a private channel limited to invited members. The description supports Twist markdown.
   * @category Channels
   * @route POST /channels/add
   * @paramDef {"type":"Number","label":"Workspace ID","name":"workspaceId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getWorkspacesDictionary","description":"The workspace to create the channel in."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Display name for the new channel."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional channel description. Supports Twist markdown."}
   * @paramDef {"type":"Boolean","label":"Public","name":"isPublic","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"Whether the channel is public to all workspace members. Defaults to true."}
   * @returns {Object}
   * @sampleResult {"id":11,"name":"Marketing","description":"Campaign planning","workspace_id":123,"public":true,"archived":false}
   */
  async addChannel(workspaceId, name, description, isPublic) {
    return this.#apiRequest({
      path: '/channels/add',
      method: 'post',
      params: {
        workspace_id: workspaceId,
        name,
        description,
        public: isPublic,
      },
      logTag: 'addChannel',
    })
  }

  /**
   * @operationName Update Channel
   * @description Updates an existing channel's name, description, or public visibility. Only the fields you provide are changed. The description supports Twist markdown.
   * @category Channels
   * @route POST /channels/update
   * @paramDef {"type":"Number","label":"Channel ID","name":"channelId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The numeric ID of the channel to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":false,"description":"New display name for the channel."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New channel description. Supports Twist markdown."}
   * @paramDef {"type":"Boolean","label":"Public","name":"isPublic","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"Whether the channel should be public to all workspace members."}
   * @returns {Object}
   * @sampleResult {"id":10,"name":"General","description":"Updated description","workspace_id":123,"public":true,"archived":false}
   */
  async updateChannel(channelId, name, description, isPublic) {
    return this.#apiRequest({
      path: '/channels/update',
      method: 'post',
      params: {
        id: channelId,
        name,
        description,
        public: isPublic,
      },
      logTag: 'updateChannel',
    })
  }

  /**
   * @operationName Archive Channel
   * @description Archives a channel, hiding it from the active channel list while preserving its threads. Use Update Channel or Remove Channel afterwards if needed; archived channels can be re-created by admins in the Twist UI.
   * @category Channels
   * @route POST /channels/archive
   * @paramDef {"type":"Number","label":"Channel ID","name":"channelId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The numeric ID of the channel to archive."}
   * @returns {Object}
   * @sampleResult {"id":10,"name":"General","archived":true}
   */
  async archiveChannel(channelId) {
    return this.#apiRequest({
      path: '/channels/archive',
      method: 'post',
      params: { id: channelId },
      logTag: 'archiveChannel',
    })
  }

  /**
   * @operationName Remove Channel
   * @description Permanently deletes a channel and all of its threads. This action cannot be undone.
   * @category Channels
   * @route POST /channels/remove
   * @paramDef {"type":"Number","label":"Channel ID","name":"channelId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The numeric ID of the channel to delete."}
   * @returns {Object}
   * @sampleResult {"id":10,"removed":true}
   */
  async removeChannel(channelId) {
    return this.#apiRequest({
      path: '/channels/remove',
      method: 'post',
      params: { id: channelId },
      logTag: 'removeChannel',
    })
  }

  // ---------------------------------------------------------------------------
  // Threads
  // ---------------------------------------------------------------------------

  /**
   * @operationName Get Threads
   * @description Lists threads within a channel, newest first. A thread is a titled, focused discussion inside a channel. Use "Limit" to control how many are returned.
   * @category Threads
   * @route GET /threads/get
   * @paramDef {"type":"Number","label":"Channel ID","name":"channelId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getChannelsDictionary","description":"The channel whose threads to list."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of threads to return (default 20, max 500)."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":500,"title":"Q3 Planning","channel_id":10,"creator":456,"content":"Let's align on goals","last_updated_ts":1720000000}]
   */
  async getThreads(channelId, limit) {
    return this.#apiRequest({
      path: '/threads/get',
      method: 'get',
      params: { channel_id: channelId, limit },
      logTag: 'getThreads',
    })
  }

  /**
   * @operationName Get Thread
   * @description Retrieves a single thread by its numeric ID, including its title, content, creator, and metadata.
   * @category Threads
   * @route GET /threads/getone
   * @paramDef {"type":"Number","label":"Thread ID","name":"threadId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The numeric ID of the thread to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":500,"title":"Q3 Planning","channel_id":10,"creator":456,"content":"Let's align on goals","last_updated_ts":1720000000}
   */
  async getThread(threadId) {
    return this.#apiRequest({
      path: '/threads/getone',
      method: 'get',
      params: { id: threadId },
      logTag: 'getThread',
    })
  }

  /**
   * @operationName Add Thread
   * @description Starts a new thread in a channel with a title and body. The content supports Twist markdown, including mentions written as [Name](twist-mention://USER_ID). Recipients is a comma-separated list of user IDs to notify, or the literal value EVERYONE to notify all channel members.
   * @category Threads
   * @route POST /threads/add
   * @paramDef {"type":"Number","label":"Channel ID","name":"channelId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getChannelsDictionary","description":"The channel to create the thread in."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The thread title."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The thread body. Supports Twist markdown and mentions like [Name](twist-mention://USER_ID)."}
   * @paramDef {"type":"String","label":"Recipients","name":"recipients","required":false,"description":"Comma-separated user IDs to notify, or EVERYONE for all channel members."}
   * @returns {Object}
   * @sampleResult {"id":501,"title":"Kickoff","channel_id":10,"creator":456,"content":"Welcome to the project"}
   */
  async addThread(channelId, title, content, recipients) {
    return this.#apiRequest({
      path: '/threads/add',
      method: 'post',
      params: {
        channel_id: channelId,
        title,
        content,
        recipients: this.#parseRecipients(recipients),
      },
      logTag: 'addThread',
    })
  }

  /**
   * @operationName Update Thread
   * @description Updates an existing thread's title and/or content. Only the fields you provide are changed. The content supports Twist markdown.
   * @category Threads
   * @route POST /threads/update
   * @paramDef {"type":"Number","label":"Thread ID","name":"threadId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The numeric ID of the thread to update."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":false,"description":"New thread title."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":false,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New thread body. Supports Twist markdown."}
   * @returns {Object}
   * @sampleResult {"id":500,"title":"Q3 Planning (updated)","channel_id":10,"content":"Revised goals"}
   */
  async updateThread(threadId, title, content) {
    return this.#apiRequest({
      path: '/threads/update',
      method: 'post',
      params: { id: threadId, title, content },
      logTag: 'updateThread',
    })
  }

  /**
   * @operationName Star Thread
   * @description Stars (favorites) a thread for the connected user so it can be found quickly in their starred list.
   * @category Threads
   * @route POST /threads/star
   * @paramDef {"type":"Number","label":"Thread ID","name":"threadId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The numeric ID of the thread to star."}
   * @returns {Object}
   * @sampleResult {"id":500,"is_starred":true}
   */
  async starThread(threadId) {
    return this.#apiRequest({
      path: '/threads/star',
      method: 'post',
      params: { id: threadId },
      logTag: 'starThread',
    })
  }

  /**
   * @operationName Move Thread
   * @description Moves a thread from its current channel into a different channel within the same workspace.
   * @category Threads
   * @route POST /threads/move
   * @paramDef {"type":"Number","label":"Thread ID","name":"threadId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The numeric ID of the thread to move."}
   * @paramDef {"type":"Number","label":"Target Channel ID","name":"channelId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getChannelsDictionary","description":"The channel to move the thread into."}
   * @returns {Object}
   * @sampleResult {"id":500,"channel_id":12}
   */
  async moveThread(threadId, channelId) {
    return this.#apiRequest({
      path: '/threads/move',
      method: 'post',
      params: { id: threadId, channel_id: channelId },
      logTag: 'moveThread',
    })
  }

  /**
   * @operationName Close Thread
   * @description Marks a thread as closed (resolved), signaling that the discussion is complete. Closed threads can be reopened later.
   * @category Threads
   * @route POST /threads/close
   * @paramDef {"type":"Number","label":"Thread ID","name":"threadId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The numeric ID of the thread to close."}
   * @returns {Object}
   * @sampleResult {"id":500,"is_closed":true}
   */
  async closeThread(threadId) {
    return this.#apiRequest({
      path: '/threads/close',
      method: 'post',
      params: { id: threadId },
      logTag: 'closeThread',
    })
  }

  /**
   * @operationName Reopen Thread
   * @description Reopens a previously closed thread so the discussion can continue.
   * @category Threads
   * @route POST /threads/reopen
   * @paramDef {"type":"Number","label":"Thread ID","name":"threadId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The numeric ID of the thread to reopen."}
   * @returns {Object}
   * @sampleResult {"id":500,"is_closed":false}
   */
  async reopenThread(threadId) {
    return this.#apiRequest({
      path: '/threads/reopen',
      method: 'post',
      params: { id: threadId },
      logTag: 'reopenThread',
    })
  }

  /**
   * @operationName Remove Thread
   * @description Permanently deletes a thread and all of its comments. This action cannot be undone.
   * @category Threads
   * @route POST /threads/remove
   * @paramDef {"type":"Number","label":"Thread ID","name":"threadId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The numeric ID of the thread to delete."}
   * @returns {Object}
   * @sampleResult {"id":500,"removed":true}
   */
  async removeThread(threadId) {
    return this.#apiRequest({
      path: '/threads/remove',
      method: 'post',
      params: { id: threadId },
      logTag: 'removeThread',
    })
  }

  // ---------------------------------------------------------------------------
  // Comments
  // ---------------------------------------------------------------------------

  /**
   * @operationName Get Comments
   * @description Lists the comments (replies) on a thread in chronological order. Use "Limit" to control how many are returned.
   * @category Comments
   * @route GET /comments/get
   * @paramDef {"type":"Number","label":"Thread ID","name":"threadId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The thread whose comments to list."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of comments to return."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":900,"thread_id":500,"creator":456,"content":"Sounds good to me","posted_ts":1720000100}]
   */
  async getComments(threadId, limit) {
    return this.#apiRequest({
      path: '/comments/get',
      method: 'get',
      params: { thread_id: threadId, limit },
      logTag: 'getComments',
    })
  }

  /**
   * @operationName Add Comment
   * @description Posts a new comment (reply) to a thread. The content supports Twist markdown, including mentions written as [Name](twist-mention://USER_ID). Recipients is a comma-separated list of user IDs to notify, or the literal value EVERYONE.
   * @category Comments
   * @route POST /comments/add
   * @paramDef {"type":"Number","label":"Thread ID","name":"threadId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The thread to comment on."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The comment body. Supports Twist markdown and mentions like [Name](twist-mention://USER_ID)."}
   * @paramDef {"type":"String","label":"Recipients","name":"recipients","required":false,"description":"Comma-separated user IDs to notify, or EVERYONE for all thread participants."}
   * @returns {Object}
   * @sampleResult {"id":901,"thread_id":500,"creator":456,"content":"On it!","posted_ts":1720000200}
   */
  async addComment(threadId, content, recipients) {
    return this.#apiRequest({
      path: '/comments/add',
      method: 'post',
      params: {
        thread_id: threadId,
        content,
        recipients: this.#parseRecipients(recipients),
      },
      logTag: 'addComment',
    })
  }

  /**
   * @operationName Update Comment
   * @description Updates the content of an existing comment. The content supports Twist markdown.
   * @category Comments
   * @route POST /comments/update
   * @paramDef {"type":"Number","label":"Comment ID","name":"commentId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The numeric ID of the comment to update."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The new comment body. Supports Twist markdown."}
   * @returns {Object}
   * @sampleResult {"id":901,"thread_id":500,"content":"Updated reply"}
   */
  async updateComment(commentId, content) {
    return this.#apiRequest({
      path: '/comments/update',
      method: 'post',
      params: { id: commentId, content },
      logTag: 'updateComment',
    })
  }

  /**
   * @operationName Remove Comment
   * @description Permanently deletes a comment from its thread. This action cannot be undone.
   * @category Comments
   * @route POST /comments/remove
   * @paramDef {"type":"Number","label":"Comment ID","name":"commentId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The numeric ID of the comment to delete."}
   * @returns {Object}
   * @sampleResult {"id":901,"removed":true}
   */
  async removeComment(commentId) {
    return this.#apiRequest({
      path: '/comments/remove',
      method: 'post',
      params: { id: commentId },
      logTag: 'removeComment',
    })
  }

  // ---------------------------------------------------------------------------
  // Messages (conversations / direct messages)
  // ---------------------------------------------------------------------------

  /**
   * @operationName Get Conversations
   * @description Lists the direct-message conversations in a workspace. Conversations are private, ongoing chats between members (as opposed to channel threads).
   * @category Messages
   * @route GET /conversations/get
   * @paramDef {"type":"Number","label":"Workspace ID","name":"workspaceId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getWorkspacesDictionary","description":"The workspace whose conversations to list."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of conversations to return."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":700,"workspace_id":123,"user_ids":[456,457],"last_active_ts":1720000000}]
   */
  async getConversations(workspaceId, limit) {
    return this.#apiRequest({
      path: '/conversations/get',
      method: 'get',
      params: { workspace_id: workspaceId, limit },
      logTag: 'getConversations',
    })
  }

  /**
   * @operationName Get Conversation Messages
   * @description Lists the messages in a direct-message conversation in chronological order. Use "Limit" to control how many are returned.
   * @category Messages
   * @route GET /conversation_messages/get
   * @paramDef {"type":"Number","label":"Conversation ID","name":"conversationId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The conversation whose messages to list."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of messages to return."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":800,"conversation_id":700,"creator":456,"content":"Hey there","posted_ts":1720000000}]
   */
  async getConversationMessages(conversationId, limit) {
    return this.#apiRequest({
      path: '/conversation_messages/get',
      method: 'get',
      params: { conversation_id: conversationId, limit },
      logTag: 'getConversationMessages',
    })
  }

  /**
   * @operationName Add Message
   * @description Sends a new message into a direct-message conversation. The content supports Twist markdown, including mentions written as [Name](twist-mention://USER_ID).
   * @category Messages
   * @route POST /conversation_messages/add
   * @paramDef {"type":"Number","label":"Conversation ID","name":"conversationId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The conversation to post the message into."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The message body. Supports Twist markdown and mentions like [Name](twist-mention://USER_ID)."}
   * @returns {Object}
   * @sampleResult {"id":801,"conversation_id":700,"creator":456,"content":"On my way","posted_ts":1720000300}
   */
  async addMessage(conversationId, content) {
    return this.#apiRequest({
      path: '/conversation_messages/add',
      method: 'post',
      params: { conversation_id: conversationId, content },
      logTag: 'addMessage',
    })
  }

  // ---------------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------------

  /**
   * @operationName Get Workspace Users
   * @description Lists all users who are members of a workspace, including their IDs, names, and email addresses. Useful for resolving recipients and mentions.
   * @category Users
   * @route GET /workspace-users/get
   * @paramDef {"type":"Number","label":"Workspace ID","name":"workspaceId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getWorkspacesDictionary","description":"The workspace whose members to list."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":456,"name":"Ada Lovelace","email":"ada@acme.com","user_type":"USER"}]
   */
  async getWorkspaceUsers(workspaceId) {
    return this.#apiRequest({
      path: '/workspace_users/get',
      method: 'get',
      params: { id: workspaceId },
      logTag: 'getWorkspaceUsers',
    })
  }

  /**
   * @operationName Get Session User
   * @description Retrieves the profile of the currently connected Twist user, including name, email, and default workspace. Useful for verifying that the connection is authorized.
   * @category Users
   * @route GET /users/get-session-user
   * @returns {Object}
   * @sampleResult {"id":456,"name":"Ada Lovelace","email":"ada@acme.com","default_workspace":123}
   */
  async getSessionUser() {
    return this.#apiRequest({
      path: '/users/get_session_user',
      method: 'get',
      logTag: 'getSessionUser',
    })
  }

  // ---------------------------------------------------------------------------
  // Dictionaries
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} getWorkspacesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to workspace names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused; Twist returns all workspaces at once)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Workspaces Dictionary
   * @description Lists the connected user's workspaces for selection in dependent parameters.
   * @route POST /get-workspaces-dictionary
   * @paramDef {"type":"getWorkspacesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Acme Inc","value":"123","note":"Workspace"}]}
   */
  async getWorkspacesDictionary(payload) {
    const { search } = payload || {}
    const workspaces = await this.#apiRequest({
      path: '/workspaces/get',
      method: 'get',
      logTag: 'getWorkspacesDictionary',
    })

    const items = (Array.isArray(workspaces) ? workspaces : [])
      .filter(workspace => this.#matches(workspace.name, search))
      .map(workspace => ({
        label: workspace.name,
        value: String(workspace.id),
        note: 'Workspace',
      }))

    return { items }
  }

  /**
   * @typedef {Object} getChannelsDictionary__payloadCriteria
   * @paramDef {"type":"Number","label":"Workspace ID","name":"workspaceId","required":true,"description":"The workspace whose channels to list."}
   */

  /**
   * @typedef {Object} getChannelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to channel names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (unused; Twist returns all channels at once)."}
   * @paramDef {"type":"getChannelsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Dependency values, including the selected workspace ID."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Channels Dictionary
   * @description Lists channels within a workspace for selection in dependent parameters. Depends on a selected workspace ID.
   * @route POST /get-channels-dictionary
   * @paramDef {"type":"getChannelsDictionary__payload","label":"Payload","name":"payload","description":"Search, pagination, and dependency input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"General","value":"10","note":"Channel"}]}
   */
  async getChannelsDictionary(payload) {
    const { search, criteria } = payload || {}
    const workspaceId = criteria?.workspaceId

    if (!workspaceId) {
      return { items: [] }
    }

    const channels = await this.#apiRequest({
      path: '/channels/get',
      method: 'get',
      params: { workspace_id: workspaceId },
      logTag: 'getChannelsDictionary',
    })

    const items = (Array.isArray(channels) ? channels : [])
      .filter(channel => this.#matches(channel.name, search))
      .map(channel => ({
        label: channel.name,
        value: String(channel.id),
        note: 'Channel',
      }))

    return { items }
  }

  /**
   * Case-insensitive substring match used by dictionaries.
   * @private
   */
  #matches(value, search) {
    if (!search) return true

    return String(value || '').toLowerCase().includes(String(search).toLowerCase())
  }

  /**
   * Normalizes a recipients string into the shape Twist expects: the literal
   * "EVERYONE", or an array of numeric user IDs.
   * @private
   */
  #parseRecipients(recipients) {
    if (recipients === undefined || recipients === null || recipients === '') return undefined
    if (String(recipients).trim().toUpperCase() === 'EVERYONE') return 'EVERYONE'

    return String(recipients)
      .split(',')
      .map(part => Number(part.trim()))
      .filter(id => Number.isFinite(id))
  }
}

Flowrunner.ServerCode.addService(Twist, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The Client ID (OAuth 2 client identifier) of your Twist integration. Create one at https://twist.com/integrations.',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The Client Secret of your Twist integration, found alongside the Client ID in your Twist integration settings.',
  },
])
