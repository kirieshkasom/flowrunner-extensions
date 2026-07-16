const logger = {
  info: (...args) => console.log('[Cisco Webex] info:', ...args),
  debug: (...args) => console.log('[Cisco Webex] debug:', ...args),
  error: (...args) => console.log('[Cisco Webex] error:', ...args),
  warn: (...args) => console.log('[Cisco Webex] warn:', ...args),
}

const API_BASE_URL = 'https://webexapis.com/v1'

const DEFAULT_MAX = 50

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
 * @integrationName Cisco Webex
 * @integrationIcon /icon.svg
 */
class CiscoWebexService {
  constructor(config) {
    this.accessToken = config.accessToken
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.accessToken }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const responseBody = error.body || {}
      const detail = Array.isArray(responseBody.errors) && responseBody.errors.length
        ? responseBody.errors.map(e => e.description || e.message).filter(Boolean).join('; ')
        : ''
      const trackingId = responseBody.trackingId ? ` (trackingId: ${ responseBody.trackingId })` : ''
      const message = responseBody.message || (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))
      const combined = [message, detail].filter(Boolean).join(' - ')

      logger.error(`${ logTag } - failed: ${ combined }${ trackingId }`)

      throw new Error(`Cisco Webex API error: ${ combined }${ trackingId }`)
    }
  }

  /* =========================================================================
   * MESSAGES
   * ========================================================================= */

  /**
   * @operationName Create Message
   * @category Messages
   * @description Posts a new message to a Webex space (room) or directly to a person. Provide exactly one destination: a Room ID, a recipient email (toPersonEmail), or a recipient person ID (toPersonId). Supply text and/or markdown (markdown renders formatting; text is the plain-text fallback). Optionally attach up to one publicly reachable file URL and/or Adaptive Card attachments. Returns the created message object including its ID.
   * @route POST /messages
   * @appearanceColor #005073 #00A0D1
   *
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","dictionary":"getRoomsDictionary","description":"Destination space (room) ID. Use this OR To Person Email OR To Person ID."}
   * @paramDef {"type":"String","label":"To Person Email","name":"toPersonEmail","description":"Email address of the recipient for a 1:1 direct message. Use this OR Room ID OR To Person ID."}
   * @paramDef {"type":"String","label":"To Person ID","name":"toPersonId","description":"Person ID of the recipient for a 1:1 direct message. Use this OR Room ID OR To Person Email."}
   * @paramDef {"type":"String","label":"Markdown","name":"markdown","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Message body with Markdown formatting. When set, the plain-text fallback is auto-derived unless Text is also provided."}
   * @paramDef {"type":"String","label":"Text","name":"text","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Plain-text message body. Required if Markdown and attachments are omitted."}
   * @paramDef {"type":"Array<String>","label":"Files","name":"files","description":"Public URLs of files to attach. The Webex API currently accepts a single file per message."}
   * @paramDef {"type":"Array<Object>","label":"Attachments","name":"attachments","description":"Adaptive Card attachment objects (each with contentType 'application/vnd.microsoft.card.adaptive' and a content payload)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"Y2lzY29zcGFyazovL3VzL01FU1NBR0UvMTIz","roomId":"Y2lzY29zcGFyazovL3VzL1JPT00vYWJj","roomType":"group","text":"Hello team","markdown":"**Hello** team","personId":"Y2lzY29zcGFyazovL3VzL1BFT1BMRS9wZXJz","personEmail":"bot@webex.bot","created":"2026-07-14T10:00:00.000Z"}
   */
  async createMessage(roomId, toPersonEmail, toPersonId, markdown, text, files, attachments) {
    const logTag = '[createMessage]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/messages`,
      method: 'post',
      body: clean({
        roomId,
        toPersonEmail,
        toPersonId,
        markdown,
        text,
        files: Array.isArray(files) && files.length ? files : undefined,
        attachments: Array.isArray(attachments) && attachments.length ? attachments : undefined,
      }),
    })
  }

  /**
   * @operationName Create Direct Message
   * @category Messages
   * @description Sends a 1:1 direct message to a person by email address. A convenience over Create Message for the common case of messaging one user with plain text. Returns the created message object.
   * @route POST /messages/direct
   * @appearanceColor #005073 #00A0D1
   *
   * @paramDef {"type":"String","label":"To Person Email","name":"toPersonEmail","required":true,"description":"Email address of the person to message directly."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Plain-text message body to send."}
   * @paramDef {"type":"String","label":"Markdown","name":"markdown","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional Markdown-formatted body. When provided, it renders with formatting and Text acts as the fallback."}
   *
   * @returns {Object}
   * @sampleResult {"id":"Y2lzY29zcGFyazovL3VzL01FU1NBR0UvNDU2","roomId":"Y2lzY29zcGFyazovL3VzL1JPT00vZGly","roomType":"direct","text":"Hi there","personEmail":"bot@webex.bot","toPersonEmail":"user@example.com","created":"2026-07-14T10:05:00.000Z"}
   */
  async createDirectMessage(toPersonEmail, text, markdown) {
    const logTag = '[createDirectMessage]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/messages`,
      method: 'post',
      body: clean({ toPersonEmail, text, markdown }),
    })
  }

  /**
   * @operationName List Messages
   * @category Messages
   * @description Lists messages in a Webex space (room), newest first. Requires a Room ID. Optionally filter by parent message (for threaded replies) or by messages sent before a timestamp, and limit the page size. Returns an object with an items array of message objects.
   * @route GET /messages
   * @appearanceColor #005073 #00A0D1
   *
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","required":true,"dictionary":"getRoomsDictionary","description":"Space (room) ID whose messages to list."}
   * @paramDef {"type":"String","label":"Parent Message ID","name":"parentId","description":"Return only replies within the thread of this parent message ID."}
   * @paramDef {"type":"String","label":"Before","name":"before","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Return only messages sent before this ISO 8601 timestamp."}
   * @paramDef {"type":"Number","label":"Max","name":"max","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of messages to return per page (default 50)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"Y2lzY29zcGFyazovL3VzL01FU1NBR0UvMTIz","roomId":"Y2lzY29zcGFyazovL3VzL1JPT00vYWJj","roomType":"group","text":"Hello team","personEmail":"user@example.com","created":"2026-07-14T10:00:00.000Z"}]}
   */
  async listMessages(roomId, parentId, before, max) {
    const logTag = '[listMessages]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/messages`,
      method: 'get',
      query: { roomId, parentId, before, max: max || DEFAULT_MAX },
    })
  }

  /**
   * @operationName Get Message
   * @category Messages
   * @description Retrieves the full details of a single message by its ID, including body text/markdown, sender, room, attachments, and file references.
   * @route GET /messages/get
   * @appearanceColor #005073 #00A0D1
   *
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"description":"ID of the message to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"Y2lzY29zcGFyazovL3VzL01FU1NBR0UvMTIz","roomId":"Y2lzY29zcGFyazovL3VzL1JPT00vYWJj","roomType":"group","text":"Hello team","files":["https://webexapis.com/v1/contents/Y29udGVudA"],"personEmail":"user@example.com","created":"2026-07-14T10:00:00.000Z"}
   */
  async getMessage(messageId) {
    const logTag = '[getMessage]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/messages/${ encodeURIComponent(messageId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Delete Message
   * @category Messages
   * @description Permanently deletes a message by its ID. Only the message author (or a space moderator) can delete a message. Returns an empty object on success.
   * @route DELETE /messages
   * @appearanceColor #005073 #00A0D1
   *
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"description":"ID of the message to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteMessage(messageId) {
    const logTag = '[deleteMessage]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/messages/${ encodeURIComponent(messageId) }`,
      method: 'delete',
    })

    return { success: true }
  }

  /**
   * @operationName Get Message Attachment
   * @category Messages
   * @description Downloads a file attached to a message and stores it in FlowRunner file storage, returning a URL. Provide a Webex file content URL (from a message's files array, e.g. https://webexapis.com/v1/contents/...). The file is fetched with your token, uploaded to storage, and a shareable URL is returned. Use the File Settings parameter to choose the storage scope.
   * @route POST /messages/attachment
   * @appearanceColor #005073 #00A0D1
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"description":"Webex content URL of the attachment (from a message's files array), e.g. https://webexapis.com/v1/contents/{id}."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","description":"Optional name to save the file as. When omitted, the name is taken from the download response or generated."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   *
   * @returns {Object}
   * @sampleResult {"url":"https://files.flowrunner.io/webex_attachment_1720000000000.pdf","filename":"report.pdf","contentType":"application/pdf","size":20481}
   */
  async getMessageAttachment(fileUrl, fileName, fileOptions) {
    const logTag = '[getMessageAttachment]'

    let response

    try {
      logger.debug(`${ logTag } - downloading [GET::${ fileUrl }]`)

      response = await Flowrunner.Request.get(fileUrl)
        .set({ 'Authorization': `Bearer ${ this.accessToken }` })
        .setEncoding(null)
        .buffer(true)
    } catch (error) {
      const message = error.body?.message || error.message
      logger.error(`${ logTag } - download failed: ${ message }`)
      throw new Error(`Cisco Webex API error: ${ message }`)
    }

    const raw = response && response.body !== undefined ? response.body : response
    const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)

    const headers = (response && response.headers) || {}
    const contentType = headers['content-type']
    let resolvedName = fileName

    if (!resolvedName) {
      const disposition = headers['content-disposition'] || ''
      const match = disposition.match(/filename="?([^"]+)"?/i)
      resolvedName = match ? match[1] : `webex_attachment_${ Date.now() }`
    }

    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename: resolvedName,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return { url, filename: resolvedName, contentType, size: buffer.length }
  }

  /* =========================================================================
   * ROOMS (SPACES)
   * ========================================================================= */

  /**
   * @operationName List Rooms
   * @category Rooms
   * @description Lists Webex spaces (rooms) the authenticated user or bot is a member of, sorted by most recent activity. Optionally filter by room type (direct 1:1 conversations or group spaces) or restrict to spaces within a specific team, and limit the page size. Returns an object with an items array of room objects.
   * @route GET /rooms
   * @appearanceColor #005073 #00A0D1
   *
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Direct","Group"]}},"description":"Filter rooms by type. Direct = 1:1 conversations, Group = multi-person spaces."}
   * @paramDef {"type":"String","label":"Team ID","name":"teamId","description":"Return only rooms that belong to this team."}
   * @paramDef {"type":"Number","label":"Max","name":"max","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of rooms to return per page (default 50)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"Y2lzY29zcGFyazovL3VzL1JPT00vYWJj","title":"Project Alpha","type":"group","isLocked":false,"teamId":"Y2lzY29zcGFyazovL3VzL1RFQU0vdGVhbQ","lastActivity":"2026-07-14T09:00:00.000Z","created":"2026-01-10T08:00:00.000Z"}]}
   */
  async listRooms(type, teamId, max) {
    const logTag = '[listRooms]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/rooms`,
      method: 'get',
      query: {
        type: this.#resolveChoice(type, { Direct: 'direct', Group: 'group' }),
        teamId,
        max: max || DEFAULT_MAX,
      },
    })
  }

  /**
   * @operationName Create Room
   * @category Rooms
   * @description Creates a new Webex group space (room) with the given title. Optionally attach the space to a team by providing a Team ID. The authenticated user or bot becomes a member of the new space. Returns the created room object.
   * @route POST /rooms
   * @appearanceColor #005073 #00A0D1
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Display name for the new space."}
   * @paramDef {"type":"String","label":"Team ID","name":"teamId","description":"Team ID to create this space within. Omit for a standalone space."}
   *
   * @returns {Object}
   * @sampleResult {"id":"Y2lzY29zcGFyazovL3VzL1JPT00vbmV3","title":"Launch Planning","type":"group","isLocked":false,"created":"2026-07-14T10:10:00.000Z"}
   */
  async createRoom(title, teamId) {
    const logTag = '[createRoom]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/rooms`,
      method: 'post',
      body: clean({ title, teamId }),
    })
  }

  /**
   * @operationName Get Room
   * @category Rooms
   * @description Retrieves the details of a single space (room) by its ID, including title, type, team association, lock status, and timestamps.
   * @route GET /rooms/get
   * @appearanceColor #005073 #00A0D1
   *
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","required":true,"dictionary":"getRoomsDictionary","description":"ID of the space to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"Y2lzY29zcGFyazovL3VzL1JPT00vYWJj","title":"Project Alpha","type":"group","isLocked":false,"lastActivity":"2026-07-14T09:00:00.000Z","created":"2026-01-10T08:00:00.000Z"}
   */
  async getRoom(roomId) {
    const logTag = '[getRoom]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/rooms/${ encodeURIComponent(roomId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Update Room
   * @category Rooms
   * @description Updates a space (room) by its ID. Currently the title can be changed. Returns the updated room object.
   * @route PUT /rooms
   * @appearanceColor #005073 #00A0D1
   *
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","required":true,"dictionary":"getRoomsDictionary","description":"ID of the space to update."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"New display name for the space."}
   *
   * @returns {Object}
   * @sampleResult {"id":"Y2lzY29zcGFyazovL3VzL1JPT00vYWJj","title":"Project Alpha (Renamed)","type":"group","created":"2026-01-10T08:00:00.000Z"}
   */
  async updateRoom(roomId, title) {
    const logTag = '[updateRoom]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/rooms/${ encodeURIComponent(roomId) }`,
      method: 'put',
      body: clean({ title }),
    })
  }

  /**
   * @operationName Delete Room
   * @category Rooms
   * @description Permanently deletes a space (room) by its ID. This removes the space and its content for all members. Returns an empty object on success.
   * @route DELETE /rooms
   * @appearanceColor #005073 #00A0D1
   *
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","required":true,"dictionary":"getRoomsDictionary","description":"ID of the space to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteRoom(roomId) {
    const logTag = '[deleteRoom]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/rooms/${ encodeURIComponent(roomId) }`,
      method: 'delete',
    })

    return { success: true }
  }

  /**
   * @operationName Get Room Meeting Details
   * @category Rooms
   * @description Retrieves the meeting details associated with a space (room), including the meeting link, SIP address, dial-in numbers, and passwords used to start or join the space's meeting.
   * @route GET /rooms/meeting-details
   * @appearanceColor #005073 #00A0D1
   *
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","required":true,"dictionary":"getRoomsDictionary","description":"ID of the space whose meeting details to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"roomId":"Y2lzY29zcGFyazovL3VzL1JPT00vYWJj","meetingLink":"https://web.webex.com/meet/pr1234","sipAddress":"pr1234@meet.webex.com","meetingNumber":"201234567","callInTollFreeNumber":"+1-866-555-0100","callInTollNumber":"+1-408-555-0100"}
   */
  async getRoomMeetingDetails(roomId) {
    const logTag = '[getRoomMeetingDetails]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/rooms/${ encodeURIComponent(roomId) }/meetingInfo`,
      method: 'get',
    })
  }

  /* =========================================================================
   * MEMBERSHIPS
   * ========================================================================= */

  /**
   * @operationName List Memberships
   * @category Memberships
   * @description Lists the memberships of a space (room), showing who belongs to it and whether each member is a moderator. Requires a Room ID. Returns an object with an items array of membership objects.
   * @route GET /memberships
   * @appearanceColor #005073 #00A0D1
   *
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","required":true,"dictionary":"getRoomsDictionary","description":"Space ID whose memberships to list."}
   * @paramDef {"type":"Number","label":"Max","name":"max","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of memberships to return per page (default 50)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"Y2lzY29zcGFyazovL3VzL01FTUJFUlNISVAvbWVt","roomId":"Y2lzY29zcGFyazovL3VzL1JPT00vYWJj","personId":"Y2lzY29zcGFyazovL3VzL1BFT1BMRS9wZXJz","personEmail":"user@example.com","personDisplayName":"Jane Doe","isModerator":false,"created":"2026-01-10T08:00:00.000Z"}]}
   */
  async listMemberships(roomId, max) {
    const logTag = '[listMemberships]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/memberships`,
      method: 'get',
      query: { roomId, max: max || DEFAULT_MAX },
    })
  }

  /**
   * @operationName Create Membership
   * @category Memberships
   * @description Adds a person to a space (room). Identify the person by email (personEmail) or person ID (personId). Optionally grant them moderator privileges. Returns the created membership object.
   * @route POST /memberships
   * @appearanceColor #005073 #00A0D1
   *
   * @paramDef {"type":"String","label":"Room ID","name":"roomId","required":true,"dictionary":"getRoomsDictionary","description":"Space to add the person to."}
   * @paramDef {"type":"String","label":"Person Email","name":"personEmail","description":"Email address of the person to add. Provide this OR Person ID."}
   * @paramDef {"type":"String","label":"Person ID","name":"personId","description":"Person ID of the person to add. Provide this OR Person Email."}
   * @paramDef {"type":"Boolean","label":"Is Moderator","name":"isModerator","uiComponent":{"type":"CHECKBOX"},"description":"Whether the added person should be a moderator of the space. Defaults to false."}
   *
   * @returns {Object}
   * @sampleResult {"id":"Y2lzY29zcGFyazovL3VzL01FTUJFUlNISVAvbmV3","roomId":"Y2lzY29zcGFyazovL3VzL1JPT00vYWJj","personEmail":"newuser@example.com","personDisplayName":"New User","isModerator":false,"created":"2026-07-14T10:15:00.000Z"}
   */
  async createMembership(roomId, personEmail, personId, isModerator) {
    const logTag = '[createMembership]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/memberships`,
      method: 'post',
      body: clean({
        roomId,
        personEmail,
        personId,
        isModerator: isModerator === true ? true : undefined,
      }),
    })
  }

  /**
   * @operationName Delete Membership
   * @category Memberships
   * @description Removes a person from a space by deleting their membership. Provide the membership ID (obtainable via List Memberships). Returns an empty object on success.
   * @route DELETE /memberships
   * @appearanceColor #005073 #00A0D1
   *
   * @paramDef {"type":"String","label":"Membership ID","name":"membershipId","required":true,"description":"ID of the membership to delete (from List Memberships)."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteMembership(membershipId) {
    const logTag = '[deleteMembership]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/memberships/${ encodeURIComponent(membershipId) }`,
      method: 'delete',
    })

    return { success: true }
  }

  /* =========================================================================
   * PEOPLE
   * ========================================================================= */

  /**
   * @operationName Get My Own Details
   * @category People
   * @description Returns the profile of the person or bot associated with the current access token. Useful as a connection/authentication check and to obtain your own person ID, emails, and display name.
   * @route GET /people/me
   * @appearanceColor #005073 #00A0D1
   *
   * @returns {Object}
   * @sampleResult {"id":"Y2lzY29zcGFyazovL3VzL1BFT1BMRS9tZQ","emails":["bot@webex.bot"],"displayName":"My Bot","nickName":"My Bot","type":"bot","status":"active","created":"2025-01-01T00:00:00.000Z"}
   */
  async getMyOwnDetails() {
    const logTag = '[getMyOwnDetails]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/people/me`,
      method: 'get',
    })
  }

  /**
   * @operationName List People
   * @category People
   * @description Searches for people in your Webex organization. Filter by email address or by display name (at least one filter is required by the Webex API). Returns an object with an items array of person objects.
   * @route GET /people
   * @appearanceColor #005073 #00A0D1
   *
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Filter people by exact email address. Provide this OR Display Name."}
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","description":"Filter people whose display name starts with this value. Provide this OR Email."}
   * @paramDef {"type":"Number","label":"Max","name":"max","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of people to return per page (default 50)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"Y2lzY29zcGFyazovL3VzL1BFT1BMRS9wZXJz","emails":["user@example.com"],"displayName":"Jane Doe","nickName":"Jane","type":"person","status":"active"}]}
   */
  async listPeople(email, displayName, max) {
    const logTag = '[listPeople]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/people`,
      method: 'get',
      query: { email, displayName, max: max || DEFAULT_MAX },
    })
  }

  /**
   * @operationName Get Person
   * @category People
   * @description Retrieves the profile of a single person by their person ID, including emails, display name, avatar, org, and status.
   * @route GET /people/get
   * @appearanceColor #005073 #00A0D1
   *
   * @paramDef {"type":"String","label":"Person ID","name":"personId","required":true,"description":"ID of the person to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"Y2lzY29zcGFyazovL3VzL1BFT1BMRS9wZXJz","emails":["user@example.com"],"displayName":"Jane Doe","nickName":"Jane","type":"person","status":"active","created":"2025-01-01T00:00:00.000Z"}
   */
  async getPerson(personId) {
    const logTag = '[getPerson]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/people/${ encodeURIComponent(personId) }`,
      method: 'get',
    })
  }

  /* =========================================================================
   * TEAMS
   * ========================================================================= */

  /**
   * @operationName List Teams
   * @category Teams
   * @description Lists the teams the authenticated user or bot belongs to. Teams group related spaces. Returns an object with an items array of team objects.
   * @route GET /teams
   * @appearanceColor #005073 #00A0D1
   *
   * @paramDef {"type":"Number","label":"Max","name":"max","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of teams to return per page (default 50)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"Y2lzY29zcGFyazovL3VzL1RFQU0vdGVhbQ","name":"Engineering","created":"2025-03-01T00:00:00.000Z"}]}
   */
  async listTeams(max) {
    const logTag = '[listTeams]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/teams`,
      method: 'get',
      query: { max: max || DEFAULT_MAX },
    })
  }

  /**
   * @operationName Create Team
   * @category Teams
   * @description Creates a new team with the given name. The authenticated user or bot becomes a member. Teams are containers for related spaces. Returns the created team object.
   * @route POST /teams
   * @appearanceColor #005073 #00A0D1
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Display name for the new team."}
   *
   * @returns {Object}
   * @sampleResult {"id":"Y2lzY29zcGFyazovL3VzL1RFQU0vbmV3","name":"Product","created":"2026-07-14T10:20:00.000Z"}
   */
  async createTeam(name) {
    const logTag = '[createTeam]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/teams`,
      method: 'post',
      body: clean({ name }),
    })
  }

  /**
   * @operationName Get Team
   * @category Teams
   * @description Retrieves the details of a single team by its ID, including its name and creation time.
   * @route GET /teams/get
   * @appearanceColor #005073 #00A0D1
   *
   * @paramDef {"type":"String","label":"Team ID","name":"teamId","required":true,"description":"ID of the team to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"Y2lzY29zcGFyazovL3VzL1RFQU0vdGVhbQ","name":"Engineering","created":"2025-03-01T00:00:00.000Z"}
   */
  async getTeam(teamId) {
    const logTag = '[getTeam]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/teams/${ encodeURIComponent(teamId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName List Team Memberships
   * @category Teams
   * @description Lists the members of a team, showing each person and whether they are a team moderator. Requires a Team ID. Returns an object with an items array of team membership objects.
   * @route GET /team-memberships
   * @appearanceColor #005073 #00A0D1
   *
   * @paramDef {"type":"String","label":"Team ID","name":"teamId","required":true,"description":"ID of the team whose memberships to list."}
   * @paramDef {"type":"Number","label":"Max","name":"max","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of team memberships to return per page (default 50)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"Y2lzY29zcGFyazovL3VzL1RFQU1fTUVNQkVSU0hJUC90bQ","teamId":"Y2lzY29zcGFyazovL3VzL1RFQU0vdGVhbQ","personId":"Y2lzY29zcGFyazovL3VzL1BFT1BMRS9wZXJz","personEmail":"user@example.com","personDisplayName":"Jane Doe","isModerator":true,"created":"2025-03-01T00:00:00.000Z"}]}
   */
  async listTeamMemberships(teamId, max) {
    const logTag = '[listTeamMemberships]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/team/memberships`,
      method: 'get',
      query: { teamId, max: max || DEFAULT_MAX },
    })
  }

  /* =========================================================================
   * MEETINGS
   * ========================================================================= */

  /**
   * @operationName List Meetings
   * @category Meetings
   * @description Lists scheduled meetings visible to the authenticated user. Optionally filter by meeting state and time window (from/to as ISO 8601), and limit the page size. Returns an object with an items array of meeting objects.
   * @route GET /meetings
   * @appearanceColor #005073 #00A0D1
   *
   * @paramDef {"type":"String","label":"State","name":"state","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Scheduled","Ready","Lobby","In Progress","Ended","Missed","Expired"]}},"description":"Filter meetings by lifecycle state."}
   * @paramDef {"type":"String","label":"From","name":"from","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Return meetings starting at or after this ISO 8601 time."}
   * @paramDef {"type":"String","label":"To","name":"to","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Return meetings starting before this ISO 8601 time."}
   * @paramDef {"type":"Number","label":"Max","name":"max","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of meetings to return per page (default 50)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"meeting-abc123","meetingNumber":"201234567","title":"Weekly Sync","state":"scheduled","start":"2026-07-15T15:00:00Z","end":"2026-07-15T16:00:00Z","timezone":"UTC","webLink":"https://web.webex.com/meet/pr201234567","hostEmail":"host@example.com"}]}
   */
  async listMeetings(state, from, to, max) {
    const logTag = '[listMeetings]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/meetings`,
      method: 'get',
      query: {
        state: this.#resolveChoice(state, {
          Active: 'active',
          Scheduled: 'scheduled',
          Ready: 'ready',
          Lobby: 'lobby',
          'In Progress': 'inProgress',
          Ended: 'ended',
          Missed: 'missed',
          Expired: 'expired',
        }),
        from,
        to,
        max: max || DEFAULT_MAX,
      },
    })
  }

  /**
   * @operationName Create Meeting
   * @category Meetings
   * @description Schedules a new Webex meeting. Provide a title and ISO 8601 start and end times (with an optional timezone). Optionally add an agenda, a join password, and a list of invitee email addresses. Returns the created meeting object including its meeting number, web link, and SIP address.
   * @route POST /meetings
   * @appearanceColor #005073 #00A0D1
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Meeting title / topic."}
   * @paramDef {"type":"String","label":"Start","name":"start","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Meeting start time in ISO 8601 format, e.g. 2026-07-15T15:00:00Z."}
   * @paramDef {"type":"String","label":"End","name":"end","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Meeting end time in ISO 8601 format, e.g. 2026-07-15T16:00:00Z."}
   * @paramDef {"type":"String","label":"Timezone","name":"timezone","description":"IANA timezone for the start/end times, e.g. America/New_York. Defaults to UTC when omitted."}
   * @paramDef {"type":"String","label":"Agenda","name":"agenda","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional agenda / description for the meeting."}
   * @paramDef {"type":"String","label":"Password","name":"password","description":"Optional join password. When omitted, Webex generates one automatically."}
   * @paramDef {"type":"Array<String>","label":"Invitees","name":"invitees","description":"Email addresses of people to invite to the meeting."}
   *
   * @returns {Object}
   * @sampleResult {"id":"meeting-abc123","meetingNumber":"201234567","title":"Kickoff","agenda":"Project kickoff","state":"scheduled","start":"2026-07-15T15:00:00Z","end":"2026-07-15T16:00:00Z","timezone":"UTC","webLink":"https://web.webex.com/meet/pr201234567","sipAddress":"201234567@webex.com","hostEmail":"host@example.com"}
   */
  async createMeeting(title, start, end, timezone, agenda, password, invitees) {
    const logTag = '[createMeeting]'

    const inviteeList = Array.isArray(invitees) && invitees.length
      ? invitees.filter(Boolean).map(email => ({ email }))
      : undefined

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/meetings`,
      method: 'post',
      body: clean({ title, start, end, timezone, agenda, password, invitees: inviteeList }),
    })
  }

  /**
   * @operationName Get Meeting
   * @category Meetings
   * @description Retrieves the details of a single meeting by its ID, including title, agenda, start/end times, web link, SIP address, host, and state.
   * @route GET /meetings/get
   * @appearanceColor #005073 #00A0D1
   *
   * @paramDef {"type":"String","label":"Meeting ID","name":"meetingId","required":true,"description":"ID of the meeting to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"meeting-abc123","meetingNumber":"201234567","title":"Kickoff","agenda":"Project kickoff","state":"scheduled","start":"2026-07-15T15:00:00Z","end":"2026-07-15T16:00:00Z","timezone":"UTC","webLink":"https://web.webex.com/meet/pr201234567","hostEmail":"host@example.com"}
   */
  async getMeeting(meetingId) {
    const logTag = '[getMeeting]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/meetings/${ encodeURIComponent(meetingId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Update Meeting
   * @category Meetings
   * @description Updates a scheduled meeting by its ID. Provide the fields to change (title, start, end, timezone, agenda, or password). Webex requires the title and start/end times to be present on update, so supply the current values for any you are not changing. Returns the updated meeting object.
   * @route PUT /meetings
   * @appearanceColor #005073 #00A0D1
   *
   * @paramDef {"type":"String","label":"Meeting ID","name":"meetingId","required":true,"description":"ID of the meeting to update."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Meeting title / topic."}
   * @paramDef {"type":"String","label":"Start","name":"start","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Meeting start time in ISO 8601 format."}
   * @paramDef {"type":"String","label":"End","name":"end","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Meeting end time in ISO 8601 format."}
   * @paramDef {"type":"String","label":"Timezone","name":"timezone","description":"IANA timezone for the start/end times. Defaults to UTC."}
   * @paramDef {"type":"String","label":"Agenda","name":"agenda","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated agenda / description."}
   * @paramDef {"type":"String","label":"Password","name":"password","description":"Updated join password."}
   *
   * @returns {Object}
   * @sampleResult {"id":"meeting-abc123","meetingNumber":"201234567","title":"Kickoff (Updated)","state":"scheduled","start":"2026-07-15T16:00:00Z","end":"2026-07-15T17:00:00Z","timezone":"UTC","webLink":"https://web.webex.com/meet/pr201234567"}
   */
  async updateMeeting(meetingId, title, start, end, timezone, agenda, password) {
    const logTag = '[updateMeeting]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/meetings/${ encodeURIComponent(meetingId) }`,
      method: 'put',
      body: clean({ title, start, end, timezone, agenda, password }),
    })
  }

  /**
   * @operationName Delete Meeting
   * @category Meetings
   * @description Cancels and deletes a scheduled meeting by its ID. Returns an empty object on success.
   * @route DELETE /meetings
   * @appearanceColor #005073 #00A0D1
   *
   * @paramDef {"type":"String","label":"Meeting ID","name":"meetingId","required":true,"description":"ID of the meeting to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteMeeting(meetingId) {
    const logTag = '[deleteMeeting]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/meetings/${ encodeURIComponent(meetingId) }`,
      method: 'delete',
    })

    return { success: true }
  }

  /* =========================================================================
   * WEBHOOKS (management — not a FlowRunner trigger)
   * ========================================================================= */

  /**
   * @operationName List Webhooks
   * @category Webhooks
   * @description Lists the Webex webhooks registered under the current token. These are Webex-side webhooks you manage directly (not FlowRunner triggers). Returns an object with an items array of webhook objects.
   * @route GET /webhooks
   * @appearanceColor #005073 #00A0D1
   *
   * @paramDef {"type":"Number","label":"Max","name":"max","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of webhooks to return per page (default 50)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"webhook-abc","name":"New messages","targetUrl":"https://example.com/hook","resource":"messages","event":"created","status":"active","created":"2026-06-01T00:00:00.000Z"}]}
   */
  async listWebhooks(max) {
    const logTag = '[listWebhooks]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/webhooks`,
      method: 'get',
      query: { max: max || DEFAULT_MAX },
    })
  }

  /**
   * @operationName Create Webhook
   * @category Webhooks
   * @description Registers a Webex webhook that POSTs to your target URL when the chosen resource fires the chosen event. Provide a name, the target URL, the resource (e.g. messages, memberships, rooms), and the event (created, updated, deleted). Optionally add a filter (e.g. roomId=...) to scope notifications. This creates a Webex-side webhook; it is not wired to a FlowRunner trigger. Returns the created webhook object.
   * @route POST /webhooks
   * @appearanceColor #005073 #00A0D1
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"A descriptive name for the webhook."}
   * @paramDef {"type":"String","label":"Target URL","name":"targetUrl","required":true,"description":"HTTPS URL that Webex will POST event payloads to."}
   * @paramDef {"type":"String","label":"Resource","name":"resource","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Messages","Memberships","Rooms","Attachment Actions","Meetings"]}},"description":"The Webex resource to watch."}
   * @paramDef {"type":"String","label":"Event","name":"event","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Created","Updated","Deleted","All"]}},"description":"The event on the resource to be notified about."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Optional filter to scope events, e.g. roomId=Y2lzY29z...&mentionedPeople=me."}
   * @paramDef {"type":"String","label":"Secret","name":"secret","description":"Optional secret used to generate the X-Spark-Signature HMAC header for payload verification."}
   *
   * @returns {Object}
   * @sampleResult {"id":"webhook-new","name":"New messages","targetUrl":"https://example.com/hook","resource":"messages","event":"created","status":"active","created":"2026-07-14T10:25:00.000Z"}
   */
  async createWebhook(name, targetUrl, resource, event, filter, secret) {
    const logTag = '[createWebhook]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/webhooks`,
      method: 'post',
      body: clean({
        name,
        targetUrl,
        resource: this.#resolveChoice(resource, {
          Messages: 'messages',
          Memberships: 'memberships',
          Rooms: 'rooms',
          'Attachment Actions': 'attachmentActions',
          Meetings: 'meetings',
        }),
        event: this.#resolveChoice(event, {
          Created: 'created',
          Updated: 'updated',
          Deleted: 'deleted',
          All: 'all',
        }),
        filter,
        secret,
      }),
    })
  }

  /**
   * @operationName Delete Webhook
   * @category Webhooks
   * @description Deletes a Webex webhook by its ID, stopping further event notifications to its target URL. Returns an empty object on success.
   * @route DELETE /webhooks
   * @appearanceColor #005073 #00A0D1
   *
   * @paramDef {"type":"String","label":"Webhook ID","name":"webhookId","required":true,"description":"ID of the webhook to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteWebhook(webhookId) {
    const logTag = '[deleteWebhook]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/webhooks/${ encodeURIComponent(webhookId) }`,
      method: 'delete',
    })

    return { success: true }
  }

  /* =========================================================================
   * DICTIONARIES
   * ========================================================================= */

  /**
   * @typedef {Object} getRoomsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter rooms by title (case-insensitive, matched client-side)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Webex room listing returns a page in one call, so this is currently unused."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Rooms Dictionary
   * @description Provides a searchable list of Webex spaces (rooms) for selecting a Room ID in other operations. The option value is the room ID; the label is the room title.
   * @route POST /get-rooms-dictionary
   * @paramDef {"type":"getRoomsDictionary__payload","label":"Payload","name":"payload","description":"Search text used to filter rooms by title."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Project Alpha","value":"Y2lzY29zcGFyazovL3VzL1JPT00vYWJj","note":"group"}],"cursor":null}
   */
  async getRoomsDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getRoomsDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/rooms`,
      method: 'get',
      query: { max: 100 },
    })

    let rooms = response.items || []

    if (search) {
      const needle = search.toLowerCase()
      rooms = rooms.filter(room => (room.title || '').toLowerCase().includes(needle))
    }

    return {
      items: rooms.map(room => ({
        label: room.title || '(untitled space)',
        value: room.id,
        note: room.type,
      })),
      cursor: null,
    }
  }
}

Flowrunner.ServerCode.addService(CiscoWebexService, [
  {
    name: 'accessToken',
    displayName: 'Access Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Webex → developer.webex.com → a Bot token (recommended) or your Personal Access Token (12h). For production use a Bot or Integration OAuth token.',
  },
])
