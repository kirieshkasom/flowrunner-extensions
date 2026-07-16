const logger = {
  info: (...args) => console.log('[Rocket.Chat] info:', ...args),
  debug: (...args) => console.log('[Rocket.Chat] debug:', ...args),
  error: (...args) => console.log('[Rocket.Chat] error:', ...args),
  warn: (...args) => console.log('[Rocket.Chat] warn:', ...args),
}

/**
 * @usesFileStorage
 * @integrationName Rocket.Chat
 * @integrationIcon /icon.svg
 */
class RocketChat {
  constructor(config) {
    this.serverUrl = (config.serverUrl || '').trim().replace(/\/+$/, '')
    this.userId = config.userId
    this.authToken = config.authToken
    this.apiBaseUrl = `${ this.serverUrl }/api/v1`
  }

  #authHeaders() {
    return {
      'X-Auth-Token': this.authToken,
      'X-User-Id': this.userId,
    }
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const url = `${ this.apiBaseUrl }${ path }`

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)
      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ ...this.#authHeaders(), 'Content-Type': 'application/json' })
        .query(query || {})
      const response = body !== undefined ? await request.send(body) : await request

      return this.#unwrap(response, logTag)
    } catch (error) {
      const message = error.body?.error || error.body?.message || error.message
      logger.error(`${ logTag } - failed: ${ message }`)
      throw new Error(`Rocket.Chat API error: ${ message }`)
    }
  }

  // Rocket.Chat responses carry { success: true|false, ... }. Surface failures.
  #unwrap(response, logTag) {
    if (response && response.success === false) {
      const message = response.error || response.errorType || 'Request failed'
      logger.error(`${ logTag } - unsuccessful: ${ message }`)
      throw new Error(`Rocket.Chat API error: ${ message }`)
    }

    return response
  }

  #cleanBody(obj) {
    const result = {}

    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined && value !== null && value !== '') result[key] = value
    }

    return result
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /* ============================ MESSAGES ============================ */

  /**
   * @operationName Post Message
   * @description Posts a new message to a channel, private group, or direct message. Target the destination with a channel name prefixed by "#" (or a username prefixed by "@" for a DM) or a room ID. Supports display customization via alias, emoji, and avatar overrides, plus an array of rich attachment objects (each may include title, text, color, image_url, and fields).
   * @category Messages
   * @route POST /post-message
   * @paramDef {"type":"String","label":"Channel","name":"channel","required":true,"description":"Destination: a channel name (#general), a username for a DM (@john), or a room ID."}
   * @paramDef {"type":"String","label":"Text","name":"text","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The message body. Optional when attachments are supplied."}
   * @paramDef {"type":"String","label":"Alias","name":"alias","description":"Overrides the displayed sender name for this message."}
   * @paramDef {"type":"String","label":"Emoji","name":"emoji","description":"Emoji shown as the message avatar, e.g. :robot:."}
   * @paramDef {"type":"String","label":"Avatar URL","name":"avatar","description":"Image URL shown as the message avatar."}
   * @paramDef {"type":"Array<Object>","label":"Attachments","name":"attachments","description":"Array of Rocket.Chat attachment objects (title, text, color, image_url, fields, etc.)."}
   * @returns {Object}
   * @sampleResult {"ts":"1481748965123","channel":"general","message":{"_id":"msg1","rid":"GENERAL","msg":"Hello","u":{"_id":"u1","username":"bot"}},"success":true}
   */
  async postMessage(channel, text, alias, emoji, avatar, attachments) {
    const body = this.#cleanBody({ channel, text, alias, emoji, avatar, attachments })

    return this.#apiRequest({ path: '/chat.postMessage', method: 'post', body, logTag: 'postMessage' })
  }

  /**
   * @operationName Send Message
   * @description Sends a message using the fuller message object form, which supports client-supplied message IDs and advanced fields. Requires the target room ID (rid) and message text (msg). Use Post Message for simpler channel-name based posting.
   * @category Messages
   * @route POST /send-message
   * @paramDef {"type":"String","label":"Room ID","name":"rid","required":true,"description":"The room ID (rid) to send the message to."}
   * @paramDef {"type":"String","label":"Text","name":"msg","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The message body text."}
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","description":"Optional client-generated message ID to assign to the message."}
   * @returns {Object}
   * @sampleResult {"message":{"_id":"msg1","rid":"GENERAL","msg":"Hello","ts":"2024-01-01T00:00:00.000Z","u":{"_id":"u1","username":"bot"}},"success":true}
   */
  async sendMessage(rid, msg, messageId) {
    const message = this.#cleanBody({ rid, msg, _id: messageId })

    return this.#apiRequest({ path: '/chat.sendMessage', method: 'post', body: { message }, logTag: 'sendMessage' })
  }

  /**
   * @operationName Update Message
   * @description Updates the text of an existing message. Requires the room ID that contains the message and the message ID to edit. The edit replaces the message text and marks the message as edited.
   * @category Messages
   * @route POST /update-message
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","required":true,"description":"The room ID containing the message."}
   * @paramDef {"type":"String","label":"Message ID","name":"msgId","required":true,"description":"The ID of the message to update."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The new message body text."}
   * @returns {Object}
   * @sampleResult {"message":{"_id":"msg1","rid":"GENERAL","msg":"Updated text","editedAt":"2024-01-01T00:00:00.000Z"},"success":true}
   */
  async updateMessage(roomId, msgId, text) {
    return this.#apiRequest({ path: '/chat.update', method: 'post', body: { roomId, msgId, text }, logTag: 'updateMessage' })
  }

  /**
   * @operationName Delete Message
   * @description Permanently deletes a message from a room. Requires the room ID and the message ID. Deletion is subject to the server's message-editing permissions and time limits.
   * @category Messages
   * @route POST /delete-message
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","required":true,"description":"The room ID containing the message."}
   * @paramDef {"type":"String","label":"Message ID","name":"msgId","required":true,"description":"The ID of the message to delete."}
   * @returns {Object}
   * @sampleResult {"_id":"msg1","ts":1481748965123,"success":true}
   */
  async deleteMessage(roomId, msgId) {
    return this.#apiRequest({ path: '/chat.delete', method: 'post', body: { roomId, msgId }, logTag: 'deleteMessage' })
  }

  /**
   * @operationName Get Channel Messages
   * @description Retrieves the message history of a public channel by room ID. Supports limiting the number of returned messages and bounding the range with oldest/latest ISO timestamps for pagination.
   * @category Messages
   * @route GET /channel-messages
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","required":true,"description":"The room ID of the channel to read history from."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of messages to return (default 20)."}
   * @paramDef {"type":"String","label":"Oldest","name":"oldest","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Return messages after this ISO 8601 timestamp."}
   * @paramDef {"type":"String","label":"Latest","name":"latest","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Return messages before this ISO 8601 timestamp."}
   * @returns {Object}
   * @sampleResult {"messages":[{"_id":"msg1","rid":"GENERAL","msg":"Hello","ts":"2024-01-01T00:00:00.000Z","u":{"_id":"u1","username":"bot"}}],"success":true}
   */
  async getChannelMessages(roomId, count, oldest, latest) {
    const query = this.#cleanBody({ roomId, count, oldest, latest })

    return this.#apiRequest({ path: '/channels.history', method: 'get', query, logTag: 'getChannelMessages' })
  }

  /**
   * @operationName Pin Message
   * @description Pins a message to its room so it appears in the room's pinned-messages list. Requires the message ID. Pinned messages remain highlighted until unpinned.
   * @category Messages
   * @route POST /pin-message
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"description":"The ID of the message to pin."}
   * @returns {Object}
   * @sampleResult {"message":{"_id":"msg1","rid":"GENERAL","pinned":true},"success":true}
   */
  async pinMessage(messageId) {
    return this.#apiRequest({ path: '/chat.pinMessage', method: 'post', body: { messageId }, logTag: 'pinMessage' })
  }

  /**
   * @operationName Star Message
   * @description Stars a message for the authenticated user, adding it to their personal starred-messages list. Requires the message ID. Starring is private to the acting user.
   * @category Messages
   * @route POST /star-message
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"description":"The ID of the message to star."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async starMessage(messageId) {
    return this.#apiRequest({ path: '/chat.starMessage', method: 'post', body: { messageId }, logTag: 'starMessage' })
  }

  /**
   * @operationName React to Message
   * @description Adds (or toggles) an emoji reaction on a message. Requires the message ID and an emoji shortname such as :thumbsup: (colons optional). If the reaction already exists for the acting user it is removed, matching Rocket.Chat's toggle behavior.
   * @category Messages
   * @route POST /react
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"description":"The ID of the message to react to."}
   * @paramDef {"type":"String","label":"Emoji","name":"emoji","required":true,"description":"Emoji shortname, e.g. :thumbsup: or :rocket:."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async react(messageId, emoji) {
    return this.#apiRequest({ path: '/chat.react', method: 'post', body: { messageId, emoji }, logTag: 'react' })
  }

  /* ============================ CHANNELS ============================ */

  /**
   * @operationName Create Channel
   * @description Creates a new public channel with the given name. Optionally seeds the channel with an initial set of members supplied as an array of usernames. Channel names may not contain spaces.
   * @category Channels
   * @route POST /create-channel
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The channel name (no spaces), e.g. project-updates."}
   * @paramDef {"type":"Array<String>","label":"Members","name":"members","description":"Usernames to add to the channel on creation."}
   * @returns {Object}
   * @sampleResult {"channel":{"_id":"ch1","name":"project-updates","t":"c","msgs":0,"usernames":["admin"]},"success":true}
   */
  async createChannel(name, members) {
    const body = this.#cleanBody({ name, members })

    return this.#apiRequest({ path: '/channels.create', method: 'post', body, logTag: 'createChannel' })
  }

  /**
   * @operationName Get Channel Info
   * @description Retrieves details about a public channel. Identify the channel by its name or by its room ID (supply at least one). Returns metadata including topic, announcement, member count, and creation info.
   * @category Channels
   * @route GET /channel-info
   * @paramDef {"type":"String","label":"Channel Name","name":"roomName","dictionary":"getChannelsDictionary","description":"The channel name to look up (omit if using Room ID)."}
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","description":"The channel room ID to look up (omit if using Channel Name)."}
   * @returns {Object}
   * @sampleResult {"channel":{"_id":"ch1","name":"general","t":"c","topic":"Team chat","usersCount":42},"success":true}
   */
  async getChannelInfo(roomName, roomId) {
    const query = this.#cleanBody({ roomName, roomId })

    return this.#apiRequest({ path: '/channels.info', method: 'get', query, logTag: 'getChannelInfo' })
  }

  /**
   * @operationName List Channels
   * @description Lists public channels the authenticated user can access. Supports pagination via count and offset to page through large workspaces.
   * @category Channels
   * @route GET /list-channels
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of channels to return (default 50)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of channels to skip for pagination."}
   * @returns {Object}
   * @sampleResult {"channels":[{"_id":"ch1","name":"general","t":"c","usersCount":42}],"total":1,"count":1,"offset":0,"success":true}
   */
  async listChannels(count, offset) {
    const query = this.#cleanBody({ count, offset })

    return this.#apiRequest({ path: '/channels.list', method: 'get', query, logTag: 'listChannels' })
  }

  /**
   * @operationName Archive Channel
   * @description Archives a public channel by room ID, making it read-only and hiding it from active channel lists. Archived channels can be unarchived later by an administrator.
   * @category Channels
   * @route POST /archive-channel
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","required":true,"description":"The room ID of the channel to archive."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async archiveChannel(roomId) {
    return this.#apiRequest({ path: '/channels.archive', method: 'post', body: { roomId }, logTag: 'archiveChannel' })
  }

  /**
   * @operationName Delete Channel
   * @description Permanently deletes a public channel by room ID, removing all of its messages. This action cannot be undone.
   * @category Channels
   * @route POST /delete-channel
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","required":true,"description":"The room ID of the channel to delete."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteChannel(roomId) {
    return this.#apiRequest({ path: '/channels.delete', method: 'post', body: { roomId }, logTag: 'deleteChannel' })
  }

  /**
   * @operationName Invite User to Channel
   * @description Adds a user to a public channel. Requires the channel room ID and the ID of the user to invite. The user gains access to the channel and its history per the room settings.
   * @category Channels
   * @route POST /invite-user
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","required":true,"description":"The room ID of the channel."}
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The ID of the user to add to the channel."}
   * @returns {Object}
   * @sampleResult {"channel":{"_id":"ch1","name":"general","usersCount":43},"success":true}
   */
  async inviteUser(roomId, userId) {
    return this.#apiRequest({ path: '/channels.invite', method: 'post', body: { roomId, userId }, logTag: 'inviteUser' })
  }

  /**
   * @operationName Kick User from Channel
   * @description Removes a user from a public channel. Requires the channel room ID and the ID of the user to remove. The user loses access to the channel.
   * @category Channels
   * @route POST /kick-user
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","required":true,"description":"The room ID of the channel."}
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The ID of the user to remove from the channel."}
   * @returns {Object}
   * @sampleResult {"channel":{"_id":"ch1","name":"general","usersCount":41},"success":true}
   */
  async kickUser(roomId, userId) {
    return this.#apiRequest({ path: '/channels.kick', method: 'post', body: { roomId, userId }, logTag: 'kickUser' })
  }

  /**
   * @operationName Set Channel Topic
   * @description Sets or replaces the topic line of a public channel. Requires the channel room ID and the new topic text. Pass an empty topic to clear it.
   * @category Channels
   * @route POST /set-topic
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","required":true,"description":"The room ID of the channel."}
   * @paramDef {"type":"String","label":"Topic","name":"topic","required":true,"description":"The new topic text for the channel."}
   * @returns {Object}
   * @sampleResult {"topic":"Team announcements","success":true}
   */
  async setTopic(roomId, topic) {
    return this.#apiRequest({ path: '/channels.setTopic', method: 'post', body: { roomId, topic }, logTag: 'setTopic' })
  }

  /**
   * @operationName Set Channel Announcement
   * @description Sets or replaces the announcement banner of a public channel. Requires the channel room ID and the new announcement text. Announcements are shown prominently at the top of the channel.
   * @category Channels
   * @route POST /set-announcement
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","required":true,"description":"The room ID of the channel."}
   * @paramDef {"type":"String","label":"Announcement","name":"announcement","required":true,"description":"The new announcement text for the channel."}
   * @returns {Object}
   * @sampleResult {"announcement":"Maintenance at 5pm","success":true}
   */
  async setAnnouncement(roomId, announcement) {
    return this.#apiRequest({ path: '/channels.setAnnouncement', method: 'post', body: { roomId, announcement }, logTag: 'setAnnouncement' })
  }

  /* ============================ GROUPS (private) ============================ */

  /**
   * @operationName Create Group
   * @description Creates a new private group (private channel) with the given name. Optionally seeds the group with an initial set of members supplied as an array of usernames. Only invited members can see a private group.
   * @category Groups
   * @route POST /create-group
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The private group name (no spaces)."}
   * @paramDef {"type":"Array<String>","label":"Members","name":"members","description":"Usernames to add to the group on creation."}
   * @returns {Object}
   * @sampleResult {"group":{"_id":"gr1","name":"leadership","t":"p","usernames":["admin"]},"success":true}
   */
  async createGroup(name, members) {
    const body = this.#cleanBody({ name, members })

    return this.#apiRequest({ path: '/groups.create', method: 'post', body, logTag: 'createGroup' })
  }

  /**
   * @operationName Get Group Info
   * @description Retrieves details about a private group. Identify the group by its name or by its room ID (supply at least one). Returns metadata including topic, announcement, and member count.
   * @category Groups
   * @route GET /group-info
   * @paramDef {"type":"String","label":"Group Name","name":"roomName","description":"The private group name to look up (omit if using Room ID)."}
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","description":"The group room ID to look up (omit if using Group Name)."}
   * @returns {Object}
   * @sampleResult {"group":{"_id":"gr1","name":"leadership","t":"p","usersCount":5},"success":true}
   */
  async getGroupInfo(roomName, roomId) {
    const query = this.#cleanBody({ roomName, roomId })

    return this.#apiRequest({ path: '/groups.info', method: 'get', query, logTag: 'getGroupInfo' })
  }

  /**
   * @operationName List Groups
   * @description Lists private groups the authenticated user is a member of. Supports pagination via count and offset. Only groups the acting user belongs to are returned.
   * @category Groups
   * @route GET /list-groups
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of groups to return (default 50)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of groups to skip for pagination."}
   * @returns {Object}
   * @sampleResult {"groups":[{"_id":"gr1","name":"leadership","t":"p","usersCount":5}],"total":1,"count":1,"offset":0,"success":true}
   */
  async listGroups(count, offset) {
    const query = this.#cleanBody({ count, offset })

    return this.#apiRequest({ path: '/groups.list', method: 'get', query, logTag: 'listGroups' })
  }

  /* ============================ IM (direct messages) ============================ */

  /**
   * @operationName Create Direct Message
   * @description Creates (or returns the existing) direct-message room between the authenticated user and the specified username. Use the returned room ID to send messages into the DM.
   * @category Direct Messages
   * @route POST /create-dm
   * @paramDef {"type":"String","label":"Username","name":"username","required":true,"dictionary":"getUsersDictionary","description":"The username to open a direct message with."}
   * @returns {Object}
   * @sampleResult {"room":{"_id":"rid1","t":"d","usernames":["admin","john"]},"success":true}
   */
  async createDirectMessage(username) {
    return this.#apiRequest({ path: '/im.create', method: 'post', body: { username }, logTag: 'createDirectMessage' })
  }

  /**
   * @operationName Send Direct Message
   * @description Sends a direct message to a user by their username. Delivers the text to the one-on-one DM with that user, creating the DM room implicitly. Supports optional alias, emoji, and avatar overrides.
   * @category Direct Messages
   * @route POST /send-dm
   * @paramDef {"type":"String","label":"Username","name":"username","required":true,"dictionary":"getUsersDictionary","description":"The username to send the direct message to."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The message body text."}
   * @paramDef {"type":"String","label":"Alias","name":"alias","description":"Overrides the displayed sender name for this message."}
   * @paramDef {"type":"String","label":"Emoji","name":"emoji","description":"Emoji shown as the message avatar, e.g. :robot:."}
   * @paramDef {"type":"String","label":"Avatar URL","name":"avatar","description":"Image URL shown as the message avatar."}
   * @returns {Object}
   * @sampleResult {"ts":"1481748965123","channel":"john","message":{"_id":"msg1","msg":"Hi","u":{"_id":"u1","username":"bot"}},"success":true}
   */
  async sendDirectMessage(username, text, alias, emoji, avatar) {
    const channel = username.startsWith('@') ? username : `@${ username }`
    const body = this.#cleanBody({ channel, text, alias, emoji, avatar })

    return this.#apiRequest({ path: '/chat.postMessage', method: 'post', body, logTag: 'sendDirectMessage' })
  }

  /* ============================ USERS ============================ */

  /**
   * @operationName Get User Info
   * @description Retrieves the profile of a user. Identify the user by their user ID or username (supply at least one). Returns name, email, status, roles, and account metadata subject to the caller's permissions.
   * @category Users
   * @route GET /user-info
   * @paramDef {"type":"String","label":"User ID","name":"userId","dictionary":"getUsersDictionary","description":"The user ID to look up (omit if using Username)."}
   * @paramDef {"type":"String","label":"Username","name":"username","description":"The username to look up (omit if using User ID)."}
   * @returns {Object}
   * @sampleResult {"user":{"_id":"u1","username":"john","name":"John Doe","status":"online","roles":["user"]},"success":true}
   */
  async getUserInfo(userId, username) {
    const query = this.#cleanBody({ userId, username })

    return this.#apiRequest({ path: '/users.info', method: 'get', query, logTag: 'getUserInfo' })
  }

  /**
   * @operationName Create User
   * @description Creates a new user account. Requires email, display name, password, and username. Requires the caller to have user-administration permissions. The new account is created active unless the server enforces verification.
   * @category Users
   * @route POST /create-user
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"The user's email address."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The user's display name."}
   * @paramDef {"type":"String","label":"Password","name":"password","required":true,"description":"The initial password for the account."}
   * @paramDef {"type":"String","label":"Username","name":"username","required":true,"description":"The login username (no spaces)."}
   * @returns {Object}
   * @sampleResult {"user":{"_id":"u2","username":"jane","name":"Jane Roe","emails":[{"address":"jane@example.com","verified":false}]},"success":true}
   */
  async createUser(email, name, password, username) {
    return this.#apiRequest({ path: '/users.create', method: 'post', body: { email, name, password, username }, logTag: 'createUser' })
  }

  /**
   * @operationName Get Me
   * @description Returns the profile of the authenticated user associated with the configured credentials. Useful as a connection and credentials check, since a successful response confirms the server URL, user ID, and token are valid.
   * @category Users
   * @route GET /me
   * @returns {Object}
   * @sampleResult {"_id":"u1","username":"bot","name":"Automation Bot","status":"online","success":true}
   */
  async getMe() {
    return this.#apiRequest({ path: '/me', method: 'get', logTag: 'getMe' })
  }

  /**
   * @operationName Set User Status
   * @description Sets the authenticated user's presence and custom status message. The presence is one of Online, Away, Busy, or Offline; the optional message is shown alongside the status.
   * @category Users
   * @route POST /set-status
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Online","Away","Busy","Offline"]}},"defaultValue":"Online","description":"The presence status to set."}
   * @paramDef {"type":"String","label":"Message","name":"message","description":"Optional custom status message text."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async setUserStatus(status, message) {
    const resolved = this.#resolveChoice(status, { Online: 'online', Away: 'away', Busy: 'busy', Offline: 'offline' })
    const body = this.#cleanBody({ status: resolved, message })

    return this.#apiRequest({ path: '/users.setStatus', method: 'post', body, logTag: 'setUserStatus' })
  }

  /**
   * @operationName Update User
   * @description Updates an existing user account. Requires the target user ID and a data object containing the fields to change (for example name, email, password, active, or roles). Requires user-administration permissions.
   * @category Users
   * @route POST /update-user
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The ID of the user to update."}
   * @paramDef {"type":"Object","label":"Data","name":"data","required":true,"description":"Fields to update, e.g. {\"name\":\"New Name\",\"email\":\"new@example.com\",\"active\":true}."}
   * @returns {Object}
   * @sampleResult {"user":{"_id":"u1","username":"john","name":"New Name"},"success":true}
   */
  async updateUser(userId, data) {
    return this.#apiRequest({ path: '/users.update', method: 'post', body: { userId, data }, logTag: 'updateUser' })
  }

  /* ============================ FILES ============================ */

  /**
   * @operationName Upload File to Room
   * @description Uploads a file from a URL into a room and posts it as a file message. Requires the target room ID and the source file URL; optional message text and description are attached to the file post. The file is downloaded, then uploaded to the room via multipart, so the room members receive it as a shared attachment.
   * @category Files
   * @route POST /upload-file
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","required":true,"description":"The room ID to upload the file into."}
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"description":"Publicly reachable URL of the file to upload."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","description":"Name for the uploaded file (defaults to the URL's file name)."}
   * @paramDef {"type":"String","label":"Message","name":"msg","description":"Optional message text posted with the file."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Optional description shown under the file."}
   * @returns {Object}
   * @sampleResult {"message":{"_id":"msg1","rid":"GENERAL","file":{"_id":"f1","name":"report.pdf","type":"application/pdf"}},"success":true}
   */
  async uploadFileToRoom(roomId, fileUrl, fileName, msg, description) {
    const logTag = 'uploadFileToRoom'
    const resolvedName = fileName || decodeURIComponent(fileUrl.split('?')[0].split('/').pop()) || `upload_${ Date.now() }`

    try {
      const bytes = await Flowrunner.Request.get(fileUrl).setEncoding(null)
      const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)

      const formData = new Flowrunner.Request.FormData()
      formData.append('file', buffer, resolvedName)
      if (msg) formData.append('msg', msg)
      if (description) formData.append('description', description)

      const url = `${ this.apiBaseUrl }/rooms.upload/${ roomId }`
      logger.debug(`${ logTag } - [POST::${ url }]`)
      const response = await Flowrunner.Request.post(url).set(this.#authHeaders()).form(formData)

      return this.#unwrap(response, logTag)
    } catch (error) {
      const message = error.body?.error || error.body?.message || error.message
      logger.error(`${ logTag } - failed: ${ message }`)
      throw new Error(`Rocket.Chat API error: ${ message }`)
    }
  }

  /* ============================ DICTIONARIES ============================ */

  /**
   * @typedef {Object} getChannelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to channel names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (numeric offset) from a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Channels Dictionary
   * @description Lists public channels for selection in dependent parameters, returning each channel's name as the label and room ID as the value.
   * @route POST /get-channels-dictionary
   * @paramDef {"type":"getChannelsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"general","value":"GENERAL","note":"Channel"}],"cursor":"50"}
   */
  async getChannelsDictionary(payload) {
    const { search, cursor } = payload || {}
    const count = 50
    const offset = cursor ? parseInt(cursor, 10) || 0 : 0
    const response = await this.#apiRequest({
      path: '/channels.list',
      method: 'get',
      query: this.#cleanBody({ count, offset }),
      logTag: 'getChannelsDictionary',
    })
    const channels = response.channels || []
    const filtered = search
      ? channels.filter(c => (c.name || '').toLowerCase().includes(search.toLowerCase()))
      : channels
    const items = filtered.map(c => ({ label: c.name, value: c._id, note: 'Channel' }))
    const nextCursor = channels.length === count ? String(offset + count) : undefined

    return { items, cursor: nextCursor }
  }

  /**
   * @typedef {Object} getUsersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied to usernames and names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (numeric offset) from a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Users Dictionary
   * @description Lists users for selection in dependent parameters, returning each user's display name as the label and user ID as the value, with the username shown as a note.
   * @route POST /get-users-dictionary
   * @paramDef {"type":"getUsersDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"John Doe","value":"u1","note":"@john"}],"cursor":"50"}
   */
  async getUsersDictionary(payload) {
    const { search, cursor } = payload || {}
    const count = 50
    const offset = cursor ? parseInt(cursor, 10) || 0 : 0
    const query = this.#cleanBody({ count, offset })
    if (search) query.query = JSON.stringify({ $or: [{ username: { $regex: search, $options: 'i' } }, { name: { $regex: search, $options: 'i' } }] })
    const response = await this.#apiRequest({
      path: '/users.list',
      method: 'get',
      query,
      logTag: 'getUsersDictionary',
    })
    const users = response.users || []
    const items = users.map(u => ({ label: u.name || u.username, value: u._id, note: `@${ u.username }` }))
    const nextCursor = users.length === count ? String(offset + count) : undefined

    return { items, cursor: nextCursor }
  }
}

Flowrunner.ServerCode.addService(RocketChat, [
  {
    name: 'serverUrl',
    displayName: 'Server URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Rocket.Chat server URL, e.g. https://chat.example.com (strip any trailing slash).',
  },
  {
    name: 'userId',
    displayName: 'User ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Rocket.Chat → My Account → Personal Access Tokens → the User ID shown when creating a token.',
  },
  {
    name: 'authToken',
    displayName: 'Auth Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'The Personal Access Token created under My Account → Personal Access Tokens.',
  },
])
