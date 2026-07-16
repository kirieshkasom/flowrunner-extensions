const logger = {
  info: (...args) => console.log('[Matrix] info:', ...args),
  debug: (...args) => console.log('[Matrix] debug:', ...args),
  error: (...args) => console.log('[Matrix] error:', ...args),
  warn: (...args) => console.log('[Matrix] warn:', ...args),
}

const CLIENT_API_PATH = '/_matrix/client/v3'
const MEDIA_API_PATH = '/_matrix/media/v3'

let TXN_COUNTER = 0

// Matrix requires a unique transaction ID per PUT send/redact call for idempotency.
function nextTxnId() {
  TXN_COUNTER += 1

  return `fr${ Date.now() }${ TXN_COUNTER }`
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

const MSGTYPE_MAP = {
  Text: 'm.text',
  Notice: 'm.notice',
  Emote: 'm.emote',
}

/**
 * @usesFileStorage
 * @integrationName Matrix
 * @integrationIcon /icon.svg
 */
class MatrixService {
  constructor(config) {
    // Strip a trailing slash so path concatenation is always correct.
    this.homeserverUrl = (config.homeserverUrl || '').replace(/\/+$/, '')
    this.accessToken = config.accessToken
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Single private request helper — all Client-Server API calls go through here.
  async #apiRequest({ path, method = 'get', body, query, contentType = 'application/json', logTag }) {
    const url = `${ this.homeserverUrl }${ path }`

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.accessToken }`,
          'Content-Type': contentType,
        })
        .query(clean(query) || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const errBody = error.body || {}
      const errcode = errBody.errcode
      const message = errBody.error || error.message
      const status = error.status || error.statusCode

      logger.error(`${ logTag } - failed (${ status || '?' }/${ errcode || '?' }): ${ message }`)

      throw new Error(`Matrix API error${ errcode ? ` [${ errcode }]` : '' }: ${ message }`)
    }
  }

  /**
   * @operationName Send Message
   * @category Messaging
   * @description Sends a message event (m.room.message) to a room. Choose Text for a standard message, Notice for automated/bot messages, or Emote for an action message. Supply an optional HTML formatted body (with format set to org.matrix.custom.html) for rich formatting. A unique transaction ID is generated automatically for idempotency. Returns the created event ID.
   * @route PUT /rooms/send-message
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","required":true,"description":"The room to send to, e.g. !abc123:matrix.org. Use Resolve Room Alias to convert an alias like #room:server first."}
   * @paramDef {"type":"String","label":"Message","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The plain-text message body. Shown to clients that do not render HTML."}
   * @paramDef {"type":"String","label":"Message Type","name":"msgtype","uiComponent":{"type":"DROPDOWN","options":{"values":["Text","Notice","Emote"]}},"description":"Text (m.text) for a normal message, Notice (m.notice) for bot/automated output, Emote (m.emote) for an action. Defaults to Text."}
   * @paramDef {"type":"String","label":"Formatted Body (HTML)","name":"formattedBody","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional HTML version of the message. When provided, format is set to org.matrix.custom.html automatically."}
   * @returns {Object}
   * @sampleResult {"event_id":"$sYf2p1oPz3example:matrix.org"}
   */
  async sendMessage(roomId, body, msgtype, formattedBody) {
    const logTag = '[sendMessage]'
    const resolvedType = this.#resolveChoice(msgtype, MSGTYPE_MAP) || 'm.text'

    const content = clean({
      msgtype: resolvedType,
      body,
      format: formattedBody ? 'org.matrix.custom.html' : undefined,
      formatted_body: formattedBody,
    })

    return this.#apiRequest({
      logTag,
      method: 'put',
      path: `${ CLIENT_API_PATH }/rooms/${ encodeURIComponent(roomId) }/send/m.room.message/${ nextTxnId() }`,
      body: content,
    })
  }

  /**
   * @operationName Send Notice
   * @category Messaging
   * @description Sends an m.notice message to a room. Notices are intended for automated or bot-generated content and are typically rendered less prominently than normal messages by Matrix clients. Supply an optional HTML formatted body for rich formatting. Returns the created event ID.
   * @route PUT /rooms/send-notice
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","required":true,"description":"The room to send to, e.g. !abc123:matrix.org."}
   * @paramDef {"type":"String","label":"Message","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The plain-text notice body."}
   * @paramDef {"type":"String","label":"Formatted Body (HTML)","name":"formattedBody","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional HTML version of the notice. When provided, format is set to org.matrix.custom.html automatically."}
   * @returns {Object}
   * @sampleResult {"event_id":"$sYf2p1oPz3example:matrix.org"}
   */
  async sendNotice(roomId, body, formattedBody) {
    const logTag = '[sendNotice]'

    const content = clean({
      msgtype: 'm.notice',
      body,
      format: formattedBody ? 'org.matrix.custom.html' : undefined,
      formatted_body: formattedBody,
    })

    return this.#apiRequest({
      logTag,
      method: 'put',
      path: `${ CLIENT_API_PATH }/rooms/${ encodeURIComponent(roomId) }/send/m.room.message/${ nextTxnId() }`,
      body: content,
    })
  }

  /**
   * @operationName Send Event
   * @category Messaging
   * @description Sends an arbitrary event of any type to a room with a custom content object. Use this for event types beyond m.room.message (e.g. m.reaction, m.sticker, or custom application events). The content must be a JSON object matching the event type's schema. A unique transaction ID is generated automatically. Returns the created event ID.
   * @route PUT /rooms/send-event
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","required":true,"description":"The room to send to, e.g. !abc123:matrix.org."}
   * @paramDef {"type":"String","label":"Event Type","name":"eventType","required":true,"description":"The Matrix event type, e.g. m.reaction, m.sticker, or a custom type."}
   * @paramDef {"type":"Object","label":"Content","name":"content","required":true,"description":"The event content object, matching the schema for the given event type."}
   * @returns {Object}
   * @sampleResult {"event_id":"$sYf2p1oPz3example:matrix.org"}
   */
  async sendEvent(roomId, eventType, content) {
    const logTag = '[sendEvent]'

    return this.#apiRequest({
      logTag,
      method: 'put',
      path: `${ CLIENT_API_PATH }/rooms/${ encodeURIComponent(roomId) }/send/${ encodeURIComponent(eventType) }/${ nextTxnId() }`,
      body: content || {},
    })
  }

  /**
   * @operationName Redact Event
   * @category Messaging
   * @description Redacts (removes the content of) a previously sent event, such as deleting a message. The event remains in the room history but its content is stripped. Provide an optional reason that is recorded with the redaction. A unique transaction ID is generated automatically. Returns the redaction event ID.
   * @route PUT /rooms/redact-event
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","required":true,"description":"The room containing the event, e.g. !abc123:matrix.org."}
   * @paramDef {"type":"String","label":"Event ID","name":"eventId","required":true,"description":"The ID of the event to redact, e.g. $sYf2p1oPz3example:matrix.org."}
   * @paramDef {"type":"String","label":"Reason","name":"reason","description":"Optional human-readable reason for the redaction."}
   * @returns {Object}
   * @sampleResult {"event_id":"$redactionEvent123:matrix.org"}
   */
  async redactEvent(roomId, eventId, reason) {
    const logTag = '[redactEvent]'

    return this.#apiRequest({
      logTag,
      method: 'put',
      path: `${ CLIENT_API_PATH }/rooms/${ encodeURIComponent(roomId) }/redact/${ encodeURIComponent(eventId) }/${ nextTxnId() }`,
      body: clean({ reason }),
    })
  }

  /**
   * @operationName Create Room
   * @category Rooms
   * @description Creates a new Matrix room. Set a name and topic, choose a visibility preset (Public Chat is publicly joinable, Private Chat is invite-only), optionally reserve a local room alias, invite users on creation, and flag the room as a direct message. Returns the new room ID.
   * @route POST /rooms/create
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The room display name."}
   * @paramDef {"type":"String","label":"Topic","name":"topic","description":"A short topic/description for the room."}
   * @paramDef {"type":"String","label":"Preset","name":"preset","uiComponent":{"type":"DROPDOWN","options":{"values":["Public Chat","Private Chat","Trusted Private Chat"]}},"description":"Public Chat (publicly joinable), Private Chat (invite-only), or Trusted Private Chat (invite-only, all invitees get equal power). Defaults to Private Chat."}
   * @paramDef {"type":"String","label":"Room Alias Name","name":"roomAliasName","description":"Optional local part of a room alias to reserve, e.g. myroom becomes #myroom:yourserver."}
   * @paramDef {"type":"Array<String>","label":"Invite","name":"invite","description":"Optional list of full user IDs to invite on creation, e.g. @alice:matrix.org."}
   * @paramDef {"type":"Boolean","label":"Is Direct","name":"isDirect","uiComponent":{"type":"CHECKBOX"},"description":"Whether to flag this room as a direct (1:1) message."}
   * @returns {Object}
   * @sampleResult {"room_id":"!newRoom123:matrix.org"}
   */
  async createRoom(name, topic, preset, roomAliasName, invite, isDirect) {
    const logTag = '[createRoom]'

    const resolvedPreset = this.#resolveChoice(preset, {
      'Public Chat': 'public_chat',
      'Private Chat': 'private_chat',
      'Trusted Private Chat': 'trusted_private_chat',
    }) || 'private_chat'

    const body = clean({
      name,
      topic,
      preset: resolvedPreset,
      room_alias_name: roomAliasName,
      invite: Array.isArray(invite) && invite.length ? invite : undefined,
      is_direct: isDirect === true ? true : undefined,
    })

    return this.#apiRequest({
      logTag,
      method: 'post',
      path: `${ CLIENT_API_PATH }/createRoom`,
      body,
    })
  }

  /**
   * @operationName Join Room
   * @category Rooms
   * @description Joins a room by its room ID or alias. Accepts either a room ID (e.g. !abc123:matrix.org) or an alias (e.g. #room:matrix.org). Returns the joined room's ID.
   * @route POST /rooms/join
   * @paramDef {"type":"String","label":"Room ID or Alias","name":"roomIdOrAlias","required":true,"description":"The room ID or alias to join, e.g. !abc123:matrix.org or #room:matrix.org."}
   * @returns {Object}
   * @sampleResult {"room_id":"!abc123:matrix.org"}
   */
  async joinRoom(roomIdOrAlias) {
    const logTag = '[joinRoom]'

    return this.#apiRequest({
      logTag,
      method: 'post',
      path: `${ CLIENT_API_PATH }/join/${ encodeURIComponent(roomIdOrAlias) }`,
      body: {},
    })
  }

  /**
   * @operationName Leave Room
   * @category Rooms
   * @description Leaves a room the account is currently a member of. The room remains in history until forgotten. Returns an empty object on success.
   * @route POST /rooms/leave
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","required":true,"description":"The room to leave, e.g. !abc123:matrix.org."}
   * @returns {Object}
   * @sampleResult {}
   */
  async leaveRoom(roomId) {
    const logTag = '[leaveRoom]'

    return this.#apiRequest({
      logTag,
      method: 'post',
      path: `${ CLIENT_API_PATH }/rooms/${ encodeURIComponent(roomId) }/leave`,
      body: {},
    })
  }

  /**
   * @operationName Forget Room
   * @category Rooms
   * @description Forgets a room, removing it from the account's room list and its history from the server for this user. The account must have already left the room. Returns an empty object on success.
   * @route POST /rooms/forget
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","required":true,"description":"The room to forget, e.g. !abc123:matrix.org. You must leave the room before forgetting it."}
   * @returns {Object}
   * @sampleResult {}
   */
  async forgetRoom(roomId) {
    const logTag = '[forgetRoom]'

    return this.#apiRequest({
      logTag,
      method: 'post',
      path: `${ CLIENT_API_PATH }/rooms/${ encodeURIComponent(roomId) }/forget`,
      body: {},
    })
  }

  /**
   * @operationName Invite User
   * @category Rooms
   * @description Invites a user to a room by their full user ID. The invited user must accept the invitation to join. Returns an empty object on success.
   * @route POST /rooms/invite
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","required":true,"description":"The room to invite into, e.g. !abc123:matrix.org."}
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"description":"The full user ID to invite, e.g. @alice:matrix.org."}
   * @returns {Object}
   * @sampleResult {}
   */
  async inviteUser(roomId, userId) {
    const logTag = '[inviteUser]'

    return this.#apiRequest({
      logTag,
      method: 'post',
      path: `${ CLIENT_API_PATH }/rooms/${ encodeURIComponent(roomId) }/invite`,
      body: { user_id: userId },
    })
  }

  /**
   * @operationName Kick User
   * @category Rooms
   * @description Kicks a user from a room, setting their membership to leave. The user can rejoin if the room permits. Requires sufficient power level in the room. Provide an optional reason. Returns an empty object on success.
   * @route POST /rooms/kick
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","required":true,"description":"The room to kick from, e.g. !abc123:matrix.org."}
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"description":"The full user ID to kick, e.g. @alice:matrix.org."}
   * @paramDef {"type":"String","label":"Reason","name":"reason","description":"Optional human-readable reason for the kick."}
   * @returns {Object}
   * @sampleResult {}
   */
  async kickUser(roomId, userId, reason) {
    const logTag = '[kickUser]'

    return this.#apiRequest({
      logTag,
      method: 'post',
      path: `${ CLIENT_API_PATH }/rooms/${ encodeURIComponent(roomId) }/kick`,
      body: clean({ user_id: userId, reason }),
    })
  }

  /**
   * @operationName Get Joined Rooms
   * @category Rooms
   * @description Returns the list of room IDs the account is currently joined to.
   * @route GET /rooms/joined
   * @returns {Object}
   * @sampleResult {"joined_rooms":["!abc123:matrix.org","!def456:matrix.org"]}
   */
  async getJoinedRooms() {
    const logTag = '[getJoinedRooms]'

    return this.#apiRequest({
      logTag,
      method: 'get',
      path: `${ CLIENT_API_PATH }/joined_rooms`,
    })
  }

  /**
   * @operationName Get Room Messages
   * @category Rooms
   * @description Retrieves a paginated window of events from a room's timeline. By default it fetches the most recent messages (backwards direction). Use the returned end token as the from value to page further, and set the direction and limit as needed. Returns the event chunk plus start/end pagination tokens.
   * @route GET /rooms/messages
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","required":true,"description":"The room to read messages from, e.g. !abc123:matrix.org."}
   * @paramDef {"type":"String","label":"Direction","name":"dir","uiComponent":{"type":"DROPDOWN","options":{"values":["Backwards","Forwards"]}},"description":"Backwards (most recent first) or Forwards (oldest first). Defaults to Backwards."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of events to return. Defaults to 10."}
   * @paramDef {"type":"String","label":"From","name":"from","description":"Optional pagination token to start from (use the end token from a previous call)."}
   * @returns {Object}
   * @sampleResult {"chunk":[{"type":"m.room.message","event_id":"$abc:matrix.org","sender":"@alice:matrix.org","content":{"msgtype":"m.text","body":"Hello"},"origin_server_ts":1700000000000}],"start":"t1-start","end":"t2-end"}
   */
  async getRoomMessages(roomId, dir, limit, from) {
    const logTag = '[getRoomMessages]'

    const resolvedDir = this.#resolveChoice(dir, {
      Backwards: 'b',
      Forwards: 'f',
    }) || 'b'

    return this.#apiRequest({
      logTag,
      method: 'get',
      path: `${ CLIENT_API_PATH }/rooms/${ encodeURIComponent(roomId) }/messages`,
      query: {
        dir: resolvedDir,
        limit: limit || 10,
        from,
      },
    })
  }

  /**
   * @operationName Get Room State
   * @category Rooms
   * @description Returns the full current state of a room as an array of state events (membership, name, topic, power levels, join rules, and more).
   * @route GET /rooms/state
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","required":true,"description":"The room to read state from, e.g. !abc123:matrix.org."}
   * @returns {Array<Object>}
   * @sampleResult [{"type":"m.room.name","state_key":"","content":{"name":"My Room"},"event_id":"$abc:matrix.org","sender":"@alice:matrix.org"}]
   */
  async getRoomState(roomId) {
    const logTag = '[getRoomState]'

    return this.#apiRequest({
      logTag,
      method: 'get',
      path: `${ CLIENT_API_PATH }/rooms/${ encodeURIComponent(roomId) }/state`,
    })
  }

  /**
   * @operationName Get Room Members
   * @category Rooms
   * @description Returns the membership events for a room, describing each member and their membership state (join, invite, leave, ban).
   * @route GET /rooms/members
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","required":true,"description":"The room to list members for, e.g. !abc123:matrix.org."}
   * @returns {Object}
   * @sampleResult {"chunk":[{"type":"m.room.member","state_key":"@alice:matrix.org","content":{"membership":"join","displayname":"Alice"},"sender":"@alice:matrix.org"}]}
   */
  async getRoomMembers(roomId) {
    const logTag = '[getRoomMembers]'

    return this.#apiRequest({
      logTag,
      method: 'get',
      path: `${ CLIENT_API_PATH }/rooms/${ encodeURIComponent(roomId) }/members`,
    })
  }

  /**
   * @operationName Resolve Room Alias
   * @category Rooms
   * @description Resolves a human-readable room alias (e.g. #room:matrix.org) to its canonical room ID and the list of servers known to have members in the room.
   * @route GET /directory/room
   * @paramDef {"type":"String","label":"Room Alias","name":"roomAlias","required":true,"description":"The room alias to resolve, e.g. #room:matrix.org."}
   * @returns {Object}
   * @sampleResult {"room_id":"!abc123:matrix.org","servers":["matrix.org","example.org"]}
   */
  async resolveRoomAlias(roomAlias) {
    const logTag = '[resolveRoomAlias]'

    return this.#apiRequest({
      logTag,
      method: 'get',
      path: `${ CLIENT_API_PATH }/directory/room/${ encodeURIComponent(roomAlias) }`,
    })
  }

  /**
   * @operationName Set Room Topic
   * @category Rooms
   * @description Sets the topic (m.room.topic state event) of a room. Requires sufficient power level. Returns the state event ID.
   * @route PUT /rooms/topic
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","required":true,"description":"The room to update, e.g. !abc123:matrix.org."}
   * @paramDef {"type":"String","label":"Topic","name":"topic","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The new topic text for the room."}
   * @returns {Object}
   * @sampleResult {"event_id":"$stateEvent123:matrix.org"}
   */
  async setRoomTopic(roomId, topic) {
    const logTag = '[setRoomTopic]'

    return this.#apiRequest({
      logTag,
      method: 'put',
      path: `${ CLIENT_API_PATH }/rooms/${ encodeURIComponent(roomId) }/state/m.room.topic`,
      body: { topic },
    })
  }

  /**
   * @operationName Set Room Name
   * @category Rooms
   * @description Sets the display name (m.room.name state event) of a room. Requires sufficient power level. Returns the state event ID.
   * @route PUT /rooms/name
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","required":true,"description":"The room to update, e.g. !abc123:matrix.org."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The new display name for the room."}
   * @returns {Object}
   * @sampleResult {"event_id":"$stateEvent123:matrix.org"}
   */
  async setRoomName(roomId, name) {
    const logTag = '[setRoomName]'

    return this.#apiRequest({
      logTag,
      method: 'put',
      path: `${ CLIENT_API_PATH }/rooms/${ encodeURIComponent(roomId) }/state/m.room.name`,
      body: { name },
    })
  }

  /**
   * @operationName Get Profile
   * @category Profile
   * @description Retrieves a user's public profile: their display name and avatar URL (an mxc:// media URI). Works for any user ID on any federated homeserver.
   * @route GET /profile/get
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"description":"The full user ID to look up, e.g. @alice:matrix.org."}
   * @returns {Object}
   * @sampleResult {"displayname":"Alice","avatar_url":"mxc://matrix.org/abc123"}
   */
  async getProfile(userId) {
    const logTag = '[getProfile]'

    return this.#apiRequest({
      logTag,
      method: 'get',
      path: `${ CLIENT_API_PATH }/profile/${ encodeURIComponent(userId) }`,
    })
  }

  /**
   * @operationName Set Display Name
   * @category Profile
   * @description Sets the display name for a user. You can only set the display name of the account that owns the access token. Returns an empty object on success.
   * @route PUT /profile/displayname
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"description":"The user ID whose display name to set, e.g. @alice:matrix.org. Must match the authenticated account."}
   * @paramDef {"type":"String","label":"Display Name","name":"displayname","required":true,"description":"The new display name."}
   * @returns {Object}
   * @sampleResult {}
   */
  async setDisplayName(userId, displayname) {
    const logTag = '[setDisplayName]'

    return this.#apiRequest({
      logTag,
      method: 'put',
      path: `${ CLIENT_API_PATH }/profile/${ encodeURIComponent(userId) }/displayname`,
      body: { displayname },
    })
  }

  /**
   * @operationName Whoami
   * @category Profile
   * @description Returns the user ID (and device ID, if applicable) associated with the configured access token. Useful as a connection and credential check.
   * @route GET /account/whoami
   * @returns {Object}
   * @sampleResult {"user_id":"@alice:matrix.org","device_id":"ABCDEFGHIJ"}
   */
  async whoami() {
    const logTag = '[whoami]'

    return this.#apiRequest({
      logTag,
      method: 'get',
      path: `${ CLIENT_API_PATH }/account/whoami`,
    })
  }

  /**
   * @operationName Upload Media
   * @category Media
   * @description Downloads a file from a publicly accessible source URL and uploads it to the Matrix homeserver's media repository. Returns the resulting mxc:// content URI, which can be referenced in message content (e.g. m.image, m.file) via Send Event.
   * @route POST /media/upload
   * @paramDef {"type":"String","label":"Source URL","name":"sourceUrl","required":true,"description":"A publicly accessible URL of the file to fetch and upload."}
   * @paramDef {"type":"String","label":"Filename","name":"filename","description":"Optional filename to record with the upload, e.g. photo.png."}
   * @paramDef {"type":"String","label":"Content Type","name":"contentType","description":"Optional MIME type of the file, e.g. image/png. Defaults to application/octet-stream."}
   * @returns {Object}
   * @sampleResult {"content_uri":"mxc://matrix.org/abcdef123456"}
   */
  async uploadMedia(sourceUrl, filename, contentType) {
    const logTag = '[uploadMedia]'
    const mimeType = contentType || 'application/octet-stream'

    let buffer

    try {
      logger.debug(`${ logTag } - downloading source ${ sourceUrl }`)
      const bytes = await Flowrunner.Request.get(sourceUrl).setEncoding(null)
      buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    } catch (error) {
      const message = error.message || String(error)
      logger.error(`${ logTag } - source download failed: ${ message }`)
      throw new Error(`Matrix API error: failed to download source file: ${ message }`)
    }

    return this.#apiRequest({
      logTag,
      method: 'post',
      contentType: mimeType,
      path: `${ MEDIA_API_PATH }/upload`,
      query: { filename },
      body: buffer,
    })
  }

  /**
   * @operationName Download Media
   * @category Media
   * @description Downloads media from the Matrix homeserver's media repository and stores it in FlowRunner file storage, returning a URL to the stored file. Provide the server name and media ID from an mxc:// URI (mxc://serverName/mediaId).
   * @route POST /media/download
   * @paramDef {"type":"String","label":"Server Name","name":"serverName","required":true,"description":"The server name portion of the mxc:// URI, e.g. matrix.org in mxc://matrix.org/abc123."}
   * @paramDef {"type":"String","label":"Media ID","name":"mediaId","required":true,"description":"The media ID portion of the mxc:// URI, e.g. abc123 in mxc://matrix.org/abc123."}
   * @paramDef {"type":"String","label":"Filename","name":"filename","description":"Optional filename for the stored file. Defaults to the media ID."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   * @returns {Object}
   * @sampleResult {"url":"https://files.flowrunner.io/flow/matrix_abc123","filename":"abc123"}
   */
  async downloadMedia(serverName, mediaId, filename, fileOptions) {
    const logTag = '[downloadMedia]'
    const url = `${ this.homeserverUrl }${ MEDIA_API_PATH }/download/${ encodeURIComponent(serverName) }/${ encodeURIComponent(mediaId) }`

    let buffer

    try {
      logger.debug(`${ logTag } - [GET::${ url }]`)
      const bytes = await Flowrunner.Request.get(url)
        .set({ 'Authorization': `Bearer ${ this.accessToken }` })
        .setEncoding(null)
      buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    } catch (error) {
      const errBody = error.body || {}
      const message = errBody.error || error.message
      logger.error(`${ logTag } - download failed: ${ message }`)
      throw new Error(`Matrix API error${ errBody.errcode ? ` [${ errBody.errcode }]` : '' }: ${ message }`)
    }

    const storedName = filename || mediaId

    const uploaded = await this.flowrunner.Files.uploadFile(buffer, {
      filename: `matrix_${ storedName }`,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return { url: uploaded.url, filename: storedName }
  }
}

Flowrunner.ServerCode.addService(MatrixService, [
  {
    name: 'homeserverUrl',
    displayName: 'Homeserver URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Matrix homeserver URL, e.g. https://matrix.org (strip any trailing slash).',
  },
  {
    name: 'accessToken',
    displayName: 'Access Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'An access token for your Matrix account (Element -> Settings -> Help & About -> Access Token, or obtained via /login).',
  },
])
