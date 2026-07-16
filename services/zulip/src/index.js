const logger = {
  info: (...args) => console.log('[Zulip] info:', ...args),
  debug: (...args) => console.log('[Zulip] debug:', ...args),
  error: (...args) => console.log('[Zulip] error:', ...args),
  warn: (...args) => console.log('[Zulip] warn:', ...args),
}

const MESSAGE_TYPE_MAPPING = { Stream: 'stream', Direct: 'direct' }

/**
 * Removes undefined/null/empty values from an object.
 * @param {Object} obj
 * @returns {Object}
 */
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
 * @usesFileStorage
 * @integrationName Zulip
 * @integrationIcon /icon.png
 */
class ZulipService {
  constructor(config) {
    this.siteUrl = (config.siteUrl || '').replace(/\/+$/, '')
    this.email = config.email
    this.apiKey = config.apiKey
    this.baseUrl = `${ this.siteUrl }/api/v1`
    this.authHeader = `Basic ${ Buffer.from(`${ this.email }:${ this.apiKey }`).toString('base64') }`
  }

  /**
   * Maps a friendly dropdown label to the underlying API value.
   * @param {String} value
   * @param {Object} mapping
   * @returns {String}
   */
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /**
   * Serializes a value for a Zulip form field. Arrays and objects are JSON-stringified,
   * everything else is coerced to a string.
   * @param {*} value
   * @returns {String}
   */
  #serializeField(value) {
    if (value === null || value === undefined) {
      return value
    }

    if (typeof value === 'object') {
      return JSON.stringify(value)
    }

    return value
  }

  /**
   * Builds a form-encoded body object from a plain object, dropping empty values and
   * JSON-stringifying arrays/objects as Zulip expects.
   * @param {Object} body
   * @returns {Object}
   */
  #buildForm(body) {
    const form = {}

    for (const key in body) {
      const value = body[key]

      if (value === undefined || value === null || value === '') {
        continue
      }

      form[key] = this.#serializeField(value)
    }

    return form
  }

  /**
   * Single private request helper. All Zulip API calls (except multipart uploads) go through here.
   * Zulip request bodies are form-encoded; arrays/objects are JSON-stringified into fields.
   * Responses carry { result: "success" | "error", msg, code }.
   * @param {Object} options
   * @returns {Object}
   */
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      let request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ Authorization: this.authHeader })
        .query(cleanedQuery ? this.#buildForm(cleanedQuery) : {})

      let response

      if (body !== undefined) {
        request = request.set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        response = await request.send(this.#buildForm(body))
      } else {
        response = await request
      }

      if (response && response.result === 'error') {
        throw new Error(`Zulip API error: ${ response.msg || 'Unknown error' }${ response.code ? ` (${ response.code })` : '' }`)
      }

      return response
    } catch (error) {
      if (error.message && error.message.startsWith('Zulip API error:')) {
        throw error
      }

      const status = error.status || error.statusCode
      const message = error.body?.msg || error.body?.message ||
        (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))

      logger.error(`${ logTag } - failed${ status ? ` [${ status }]` : '' }: ${ message }`)

      throw new Error(`Zulip API error: ${ message }${ status ? ` (status ${ status })` : '' }`)
    }
  }

  /**
   * @operationName Send Message
   * @category Messages
   * @description Sends a message to a Zulip stream (channel) or as a direct message. For a stream message, set Type to "Stream", provide the stream name in Recipients, and set a Topic. For a direct message, set Type to "Direct" and provide Recipients as a JSON array of user emails or IDs, e.g. ["user@example.com"] or [9,10]; Topic is ignored. Returns the created message ID.
   * @route POST /messages
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Stream","Direct"]}},"description":"Whether to send to a stream/channel or as a direct message."}
   * @paramDef {"type":"String","label":"Recipients","name":"to","required":true,"dictionary":"getStreamsDictionary","description":"For a stream message, the stream name. For a direct message, a JSON array of recipient emails or user IDs, e.g. [\"user@example.com\"] or [9,10]."}
   * @paramDef {"type":"String","label":"Topic","name":"topic","description":"Topic for the stream message. Required for stream messages; ignored for direct messages."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The message body. Supports Zulip-flavored Markdown."}
   * @returns {Object}
   * @sampleResult {"id":42,"msg":"","result":"success"}
   */
  async sendMessage(type, to, topic, content) {
    const logTag = '[sendMessage]'
    const resolvedType = this.#resolveChoice(type, MESSAGE_TYPE_MAPPING)

    let recipients = to

    if (resolvedType === 'direct' && typeof to === 'string') {
      const trimmed = to.trim()

      if (trimmed.startsWith('[')) {
        recipients = JSON.parse(trimmed)
      }
    }

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/messages`,
      method: 'post',
      body: {
        type: resolvedType,
        to: recipients,
        topic: resolvedType === 'stream' ? topic : undefined,
        content,
      },
    })
  }

  /**
   * @operationName Get Messages
   * @category Messages
   * @description Retrieves messages from Zulip relative to an anchor point. Use Anchor ("newest", "oldest", "first_unread", or a message ID) with Num Before / Num After to page. Optionally filter with a Narrow, a JSON array of {operator, operand} objects, e.g. [{"operator":"stream","operand":"general"}].
   * @route GET /messages
   * @paramDef {"type":"String","label":"Anchor","name":"anchor","description":"Where to anchor fetching: \"newest\", \"oldest\", \"first_unread\", or a numeric message ID. Defaults to newest."}
   * @paramDef {"type":"Number","label":"Num Before","name":"numBefore","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of messages before the anchor to retrieve. Defaults to 50."}
   * @paramDef {"type":"Number","label":"Num After","name":"numAfter","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of messages after the anchor to retrieve. Defaults to 0."}
   * @paramDef {"type":"Array<Object>","label":"Narrow","name":"narrow","description":"Optional filter as a JSON array of {operator, operand} objects, e.g. [{\"operator\":\"stream\",\"operand\":\"general\"}]."}
   * @returns {Object}
   * @sampleResult {"result":"success","msg":"","anchor":42,"found_newest":true,"found_oldest":false,"messages":[{"id":42,"content":"Hello","sender_email":"user@example.com","sender_full_name":"User","timestamp":1710000000,"type":"stream","subject":"general","display_recipient":"general"}]}
   */
  async getMessages(anchor, numBefore, numAfter, narrow) {
    const logTag = '[getMessages]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/messages`,
      method: 'get',
      query: {
        anchor: anchor || 'newest',
        num_before: numBefore !== undefined && numBefore !== null ? numBefore : 50,
        num_after: numAfter !== undefined && numAfter !== null ? numAfter : 0,
        narrow: narrow && narrow.length ? narrow : undefined,
      },
    })
  }

  /**
   * @operationName Update Message
   * @category Messages
   * @description Edits an existing message's content and/or moves it to a different topic. Provide the message ID and at least one of Content or Topic. Topic edits apply to stream messages.
   * @route PATCH /messages/{id}
   * @paramDef {"type":"Number","label":"Message ID","name":"messageId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The ID of the message to update."}
   * @paramDef {"type":"String","label":"Content","name":"content","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New message body. Leave empty to keep the current content."}
   * @paramDef {"type":"String","label":"Topic","name":"topic","description":"New topic name (stream messages only). Leave empty to keep the current topic."}
   * @returns {Object}
   * @sampleResult {"result":"success","msg":""}
   */
  async updateMessage(messageId, content, topic) {
    const logTag = '[updateMessage]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/messages/${ messageId }`,
      method: 'patch',
      body: {
        content,
        topic,
      },
    })
  }

  /**
   * @operationName Delete Message
   * @category Messages
   * @description Permanently deletes a message by its ID. Requires appropriate permissions in the Zulip organization.
   * @route DELETE /messages/{id}
   * @paramDef {"type":"Number","label":"Message ID","name":"messageId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The ID of the message to delete."}
   * @returns {Object}
   * @sampleResult {"result":"success","msg":""}
   */
  async deleteMessage(messageId) {
    const logTag = '[deleteMessage]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/messages/${ messageId }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Add Reaction
   * @category Messages
   * @description Adds an emoji reaction to a message. Provide the message ID and the emoji name (without colons), e.g. "thumbs_up".
   * @route POST /messages/{id}/reactions
   * @paramDef {"type":"Number","label":"Message ID","name":"messageId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The ID of the message to react to."}
   * @paramDef {"type":"String","label":"Emoji Name","name":"emojiName","required":true,"description":"The emoji name without colons, e.g. \"thumbs_up\" or \"heart\"."}
   * @returns {Object}
   * @sampleResult {"result":"success","msg":""}
   */
  async addReaction(messageId, emojiName) {
    const logTag = '[addReaction]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/messages/${ messageId }/reactions`,
      method: 'post',
      body: {
        emoji_name: emojiName,
      },
    })
  }

  /**
   * @operationName Remove Reaction
   * @category Messages
   * @description Removes an emoji reaction previously added to a message. Provide the message ID and the emoji name (without colons).
   * @route DELETE /messages/{id}/reactions
   * @paramDef {"type":"Number","label":"Message ID","name":"messageId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The ID of the message to remove the reaction from."}
   * @paramDef {"type":"String","label":"Emoji Name","name":"emojiName","required":true,"description":"The emoji name without colons, e.g. \"thumbs_up\" or \"heart\"."}
   * @returns {Object}
   * @sampleResult {"result":"success","msg":""}
   */
  async removeReaction(messageId, emojiName) {
    const logTag = '[removeReaction]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/messages/${ messageId }/reactions`,
      method: 'delete',
      body: {
        emoji_name: emojiName,
      },
    })
  }

  /**
   * @operationName Get Message Read Receipts
   * @category Messages
   * @description Returns the list of user IDs who have marked a specific message as read. Read receipts must be enabled in the Zulip organization.
   * @route GET /messages/{id}/read_receipts
   * @paramDef {"type":"Number","label":"Message ID","name":"messageId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The ID of the message to fetch read receipts for."}
   * @returns {Object}
   * @sampleResult {"result":"success","msg":"","user_ids":[9,10,11]}
   */
  async getMessageReadReceipts(messageId) {
    const logTag = '[getMessageReadReceipts]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/messages/${ messageId }/read_receipts`,
      method: 'get',
    })
  }

  /**
   * @operationName Upload File
   * @category Messages
   * @description Uploads a file to Zulip, then stores it in FlowRunner file storage and returns both the Zulip upload URL and a downloadable FlowRunner URL. Use the returned Zulip URL in message content as a Markdown link, e.g. [file.pdf](/user_uploads/...). Large files (25MB+) may fail due to network timeouts.
   * @route POST /user_uploads
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"description":"Publicly accessible URL of the file to upload to Zulip."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","description":"Optional name to store the file under. Defaults to a name derived from the URL."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"],"description":"Where to store the copy of the file in FlowRunner file storage."}
   * @returns {Object}
   * @sampleResult {"zulipUrl":"/user_uploads/1/4e/m2A3.../file.pdf","zulipHost":"https://yourorg.zulipchat.com","url":"https://files.flowrunner.io/output_1710000000.pdf","filename":"file.pdf","result":"success"}
   */
  async uploadFile(fileUrl, fileName, fileOptions) {
    const logTag = '[uploadFile]'

    try {
      logger.debug(`${ logTag } - fetching source file`)

      const bytes = await Flowrunner.Request.get(fileUrl).setEncoding(null)
      const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)

      const derivedName = fileName || decodeURIComponent(fileUrl.split('/').pop().split('?')[0]) || `upload_${ Date.now() }`

      logger.debug(`${ logTag } - uploading to Zulip as ${ derivedName }`)

      const formData = new Flowrunner.Request.FormData()

      formData.append('filename', buffer, derivedName)

      const response = await Flowrunner.Request.post(`${ this.baseUrl }/user_uploads`)
        .set({ Authorization: this.authHeader })
        .form(formData)

      if (response && response.result === 'error') {
        throw new Error(`Zulip API error: ${ response.msg || 'Upload failed' }`)
      }

      const zulipUrl = response.url || response.uri

      const stored = await this.flowrunner.Files.uploadFile(buffer, {
        filename: derivedName,
        generateUrl: true,
        overwrite: true,
        ...(fileOptions || { scope: 'FLOW' }),
      })

      return {
        zulipUrl,
        zulipHost: this.siteUrl,
        url: stored.url,
        filename: response.filename || derivedName,
        result: response.result || 'success',
      }
    } catch (error) {
      if (error.message && error.message.startsWith('Zulip API error:')) {
        throw error
      }

      const message = error.body?.msg || error.body?.message || error.message

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Zulip API error: ${ message }`)
    }
  }

  /**
   * @operationName Get Streams
   * @category Streams
   * @description Retrieves the streams (channels) the authenticated user can access, including their IDs, names, and descriptions.
   * @route GET /streams
   * @paramDef {"type":"Boolean","label":"Include Public","name":"includePublic","uiComponent":{"type":"CHECKBOX"},"description":"Include all public streams. Defaults to true."}
   * @paramDef {"type":"Boolean","label":"Include Subscribed","name":"includeSubscribed","uiComponent":{"type":"CHECKBOX"},"description":"Include streams the user is subscribed to. Defaults to true."}
   * @returns {Object}
   * @sampleResult {"result":"success","msg":"","streams":[{"stream_id":1,"name":"general","description":"Everyone","invite_only":false}]}
   */
  async getStreams(includePublic, includeSubscribed) {
    const logTag = '[getStreams]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/streams`,
      method: 'get',
      query: {
        include_public: includePublic !== undefined ? includePublic : true,
        include_subscribed: includeSubscribed !== undefined ? includeSubscribed : true,
      },
    })
  }

  /**
   * @operationName Get Stream ID
   * @category Streams
   * @description Looks up the numeric stream ID for a given stream (channel) name.
   * @route GET /get_stream_id
   * @paramDef {"type":"String","label":"Stream Name","name":"stream","required":true,"dictionary":"getStreamsDictionary","description":"The name of the stream to look up."}
   * @returns {Object}
   * @sampleResult {"result":"success","msg":"","stream_id":1}
   */
  async getStreamId(stream) {
    const logTag = '[getStreamId]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/get_stream_id`,
      method: 'get',
      query: { stream },
    })
  }

  /**
   * @operationName Get Stream Topics
   * @category Streams
   * @description Retrieves the recent topics in a stream (channel), identified by its numeric stream ID. Use Get Stream ID first if you only have the stream name.
   * @route GET /users/me/{stream_id}/topics
   * @paramDef {"type":"Number","label":"Stream ID","name":"streamId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The numeric ID of the stream to list topics for."}
   * @returns {Object}
   * @sampleResult {"result":"success","msg":"","topics":[{"name":"announcements","max_id":42}]}
   */
  async getStreamTopics(streamId) {
    const logTag = '[getStreamTopics]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/users/me/${ streamId }/topics`,
      method: 'get',
    })
  }

  /**
   * @operationName Subscribe to Streams
   * @category Streams
   * @description Subscribes the authenticated user to one or more streams (channels). Provide stream names as an array; any names that do not exist are created automatically. Optionally set a description applied only to newly created streams.
   * @route POST /users/me/subscriptions
   * @paramDef {"type":"Array<String>","label":"Stream Names","name":"streamNames","required":true,"description":"Names of the streams to subscribe to. Non-existent streams are created."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Optional description applied only to streams that are newly created by this call."}
   * @returns {Object}
   * @sampleResult {"result":"success","msg":"","subscribed":{"user@example.com":["general"]},"already_subscribed":{}}
   */
  async subscribeToStreams(streamNames, description) {
    const logTag = '[subscribeToStreams]'

    const subscriptions = (streamNames || []).map(name =>
      description ? { name, description } : { name })

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/users/me/subscriptions`,
      method: 'post',
      body: {
        subscriptions,
      },
    })
  }

  /**
   * @operationName Create Stream
   * @category Streams
   * @description Creates a new stream (channel) by subscribing the authenticated user to it. In Zulip, streams are created implicitly when subscribing to a non-existent name. Optionally mark it private (invite-only) and set a description.
   * @route POST /users/me/subscriptions
   * @paramDef {"type":"String","label":"Stream Name","name":"streamName","required":true,"description":"The name of the stream to create."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Optional description for the new stream."}
   * @paramDef {"type":"Boolean","label":"Private","name":"inviteOnly","uiComponent":{"type":"CHECKBOX"},"description":"Whether the stream is private (invite-only). Defaults to false (public)."}
   * @returns {Object}
   * @sampleResult {"result":"success","msg":"","subscribed":{"user@example.com":["new-stream"]},"already_subscribed":{}}
   */
  async createStream(streamName, description, inviteOnly) {
    const logTag = '[createStream]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/users/me/subscriptions`,
      method: 'post',
      body: {
        subscriptions: [description ? { name: streamName, description } : { name: streamName }],
        invite_only: inviteOnly !== undefined ? inviteOnly : undefined,
      },
    })
  }

  /**
   * @operationName Unsubscribe from Streams
   * @category Streams
   * @description Unsubscribes the authenticated user from one or more streams (channels). Provide the stream names as an array of strings.
   * @route DELETE /users/me/subscriptions
   * @paramDef {"type":"Array<String>","label":"Stream Names","name":"streamNames","required":true,"description":"Names of the streams to unsubscribe from."}
   * @returns {Object}
   * @sampleResult {"result":"success","msg":"","removed":["general"],"not_removed":[]}
   */
  async unsubscribeFromStreams(streamNames) {
    const logTag = '[unsubscribeFromStreams]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/users/me/subscriptions`,
      method: 'delete',
      body: {
        subscriptions: streamNames || [],
      },
    })
  }

  /**
   * @operationName Get Users
   * @category Users
   * @description Retrieves all users (members) in the Zulip organization, including their IDs, emails, full names, and roles.
   * @route GET /users
   * @paramDef {"type":"Boolean","label":"Include Custom Fields","name":"includeCustomFields","uiComponent":{"type":"CHECKBOX"},"description":"Include the users' custom profile field data. Defaults to false."}
   * @returns {Object}
   * @sampleResult {"result":"success","msg":"","members":[{"user_id":9,"email":"user@example.com","full_name":"User","is_admin":false,"is_active":true}]}
   */
  async getUsers(includeCustomFields) {
    const logTag = '[getUsers]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/users`,
      method: 'get',
      query: {
        include_custom_profile_fields: includeCustomFields !== undefined ? includeCustomFields : undefined,
      },
    })
  }

  /**
   * @operationName Get User
   * @category Users
   * @description Retrieves details of a single user by their numeric user ID.
   * @route GET /users/{id}
   * @paramDef {"type":"Number","label":"User ID","name":"userId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The numeric ID of the user to retrieve."}
   * @returns {Object}
   * @sampleResult {"result":"success","msg":"","user":{"user_id":9,"email":"user@example.com","full_name":"User","is_active":true}}
   */
  async getUser(userId) {
    const logTag = '[getUser]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/users/${ userId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Own User
   * @category Users
   * @description Retrieves the profile of the authenticated user (bot or user). Useful as a connection check to verify the site URL, email, and API key are valid.
   * @route GET /users/me
   * @returns {Object}
   * @sampleResult {"result":"success","msg":"","user_id":9,"email":"bot@example.com","full_name":"My Bot","is_bot":true}
   */
  async getOwnUser() {
    const logTag = '[getOwnUser]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/users/me`,
      method: 'get',
    })
  }

  /**
   * @operationName Create User
   * @category Users
   * @description Creates a new user in the Zulip organization. Requires administrator permissions. Provide the new user's email, password, and full name.
   * @route POST /users
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Email address for the new user."}
   * @paramDef {"type":"String","label":"Password","name":"password","required":true,"description":"Initial password for the new user."}
   * @paramDef {"type":"String","label":"Full Name","name":"fullName","required":true,"description":"Display name for the new user."}
   * @returns {Object}
   * @sampleResult {"result":"success","msg":"","user_id":25}
   */
  async createUser(email, password, fullName) {
    const logTag = '[createUser]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/users`,
      method: 'post',
      body: {
        email,
        password,
        full_name: fullName,
      },
    })
  }

  /**
   * @operationName Update User
   * @category Users
   * @description Updates an existing user identified by their numeric user ID. Requires administrator permissions. Provide any of full name or role to change.
   * @route PATCH /users/{id}
   * @paramDef {"type":"Number","label":"User ID","name":"userId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The numeric ID of the user to update."}
   * @paramDef {"type":"String","label":"Full Name","name":"fullName","description":"New display name for the user. Leave empty to keep unchanged."}
   * @paramDef {"type":"String","label":"Role","name":"role","uiComponent":{"type":"DROPDOWN","options":{"values":["Owner","Administrator","Moderator","Member","Guest"]}},"description":"New organization role for the user. Leave empty to keep unchanged."}
   * @returns {Object}
   * @sampleResult {"result":"success","msg":""}
   */
  async updateUser(userId, fullName, role) {
    const logTag = '[updateUser]'

    const resolvedRole = this.#resolveChoice(role, {
      Owner: 100,
      Administrator: 200,
      Moderator: 300,
      Member: 400,
      Guest: 600,
    })

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/users/${ userId }`,
      method: 'patch',
      body: {
        full_name: fullName,
        role: resolvedRole,
      },
    })
  }

  /**
   * @operationName Deactivate User
   * @category Users
   * @description Deactivates (deletes) a user in the Zulip organization by their numeric user ID. Requires administrator permissions. The user can be reactivated later.
   * @route DELETE /users/{id}
   * @paramDef {"type":"Number","label":"User ID","name":"userId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The numeric ID of the user to deactivate."}
   * @returns {Object}
   * @sampleResult {"result":"success","msg":""}
   */
  async deactivateUser(userId) {
    const logTag = '[deactivateUser]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/users/${ userId }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Register Event Queue
   * @category Events
   * @description Registers an event queue with Zulip and returns a queue ID and the current state. Provide the event types to subscribe to as an array, e.g. ["message"]. Note: fetching events from the queue uses long-polling and is not supported here.
   * @route POST /register
   * @paramDef {"type":"Array<String>","label":"Event Types","name":"eventTypes","description":"Event types to register for, e.g. [\"message\",\"reaction\"]. Leave empty to register for all events."}
   * @returns {Object}
   * @sampleResult {"result":"success","msg":"","queue_id":"1593114627:0","last_event_id":-1,"max_message_id":42}
   */
  async registerEventQueue(eventTypes) {
    const logTag = '[registerEventQueue]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/register`,
      method: 'post',
      body: {
        event_types: eventTypes && eventTypes.length ? eventTypes : undefined,
      },
    })
  }

  /**
   * @typedef {Object} getStreamsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter streams by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Zulip returns all streams in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Streams Dictionary
   * @description Provides a searchable list of Zulip streams (channels) for selecting a stream in dependent parameters. The option value is the stream name; the note carries the numeric stream ID.
   * @route POST /get-streams-dictionary
   * @paramDef {"type":"getStreamsDictionary__payload","label":"Payload","name":"payload","description":"Search string used to filter streams by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"general","value":"general","note":"ID: 1"}],"cursor":null}
   */
  async getStreamsDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getStreamsDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ this.baseUrl }/streams`,
      method: 'get',
    })

    const streams = response.streams || []
    const term = (search || '').toLowerCase()

    const filtered = term
      ? streams.filter(s => (s.name || '').toLowerCase().includes(term))
      : streams

    return {
      items: filtered.map(s => ({
        label: s.name,
        value: s.name,
        note: `ID: ${ s.stream_id }`,
      })),
      cursor: null,
    }
  }
}

Flowrunner.ServerCode.addService(ZulipService, [
  {
    name: 'siteUrl',
    displayName: 'Site URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Zulip organization URL, e.g. https://yourorg.zulipchat.com (strip any trailing slash).',
  },
  {
    name: 'email',
    displayName: 'Email',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'The bot or user email address used for authentication.',
  },
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Zulip API key. Find it in Zulip under Settings > Account & privacy > API key (or a bot\'s key).',
  },
])
