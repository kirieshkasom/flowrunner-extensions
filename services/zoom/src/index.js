// Zoom meetings integration - create, manage, and inspect meetings, registrants, invitations,
// cloud recordings, and past-meeting participants (OAuth2).

// ============================================================================
//  CONSTANTS
// ============================================================================
const API_BASE = 'https://api.zoom.us/v2'
const OAUTH_AUTHORIZE_URL = 'https://zoom.us/oauth/authorize'
const OAUTH_TOKEN_URL = 'https://zoom.us/oauth/token'

const PAGE_SIZE = 30

// Friendly DROPDOWN labels the UI shows, mapped to the API values Zoom expects.
// docs: POST /users/{userId}/meetings - type: 1 instant, 2 scheduled, 3 recurring no fixed time
const MEETING_TYPE_MAP = { 'Instant': 1, 'Scheduled': 2, 'Recurring (No Fixed Time)': 3 }
// docs: GET /users/{userId}/meetings - type query param
const LIST_TYPE_MAP = { Scheduled: 'scheduled', Live: 'live', Upcoming: 'upcoming' }
// docs: settings.auto_recording - none | local | cloud
const AUTO_RECORDING_MAP = { None: 'none', Local: 'local', Cloud: 'cloud' }
// docs: DELETE /meetings/{meetingId}/recordings - action query param
const RECORDING_DELETE_ACTION_MAP = { 'Move To Trash': 'trash', 'Delete Permanently': 'delete' }

const ERROR_HINTS = {
  401: 'Authentication failed — reconnect the Zoom account.',
  404: 'Not found — the meeting ID may be wrong or the meeting has expired.',
  429: 'Rate limit hit — retry in a moment.',
}

// ============================================================================
//  LOGGER
// ============================================================================
const logger = {
  info: (...args) => console.log('[Zoom] info:', ...args),
  debug: (...args) => console.log('[Zoom] debug:', ...args),
  error: (...args) => console.log('[Zoom] error:', ...args),
  warn: (...args) => console.log('[Zoom] warn:', ...args),
}

// ============================================================================
//  DICTIONARY PAYLOAD TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} getMeetingsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter meetings by topic."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for the next page of results."}
 */

/**
 * @integrationName Zoom
 * @integrationIcon /icon.png
 * @requireOAuth
 */
class Zoom {
  constructor(config) {
    this.config = config || {}
    this.clientId = this.config.clientId
    this.clientSecret = this.config.clientSecret
  }

  // ==========================================================================
  //  CORE - every Zoom REST call goes through #apiRequest
  // ==========================================================================
  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'

    try {
      logger.debug(`${ logTag } ${ method.toUpperCase() } ${ url }`)

      const headers = { Authorization: `Bearer ${ this.#getAccessToken() }` }

      if (body !== undefined) {
        headers['Content-Type'] = 'application/json'
      }

      const request = Flowrunner.Request[method](url)
        .set(headers)
        .query(query || {})

      if (body !== undefined) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      this.#handleError(error, logTag)
    }
  }

  // Zoom error bodies look like { "code": 3001, "message": "Meeting does not exist: 123." }
  #handleError(error, logTag) {
    const status = error?.status || error?.statusCode
    const zoomCode = error?.body?.code
    const apiMessage = error?.body?.message || error?.message || 'Request failed'
    const hint = ERROR_HINTS[status]
    const message = zoomCode ? `${ apiMessage } (Zoom code ${ zoomCode })` : apiMessage

    logger.error(`${ logTag } failed: ${ message }`)

    throw new Error(hint ? `${ hint } (${ message })` : message)
  }

  // Translate a friendly DROPDOWN label into the API value; pass through anything unmapped.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #requireMeetingId(meetingId) {
    if (meetingId === undefined || meetingId === null || meetingId === '') {
      throw new Error('Meeting ID is required.')
    }

    return encodeURIComponent(String(meetingId).trim())
  }

  // Builds the meeting `settings` object from individual flags, omitting anything unset so
  // Zoom keeps its defaults. Returns undefined when no setting was provided at all.
  #buildSettings(waitingRoom, joinBeforeHost, muteUponEntry, autoRecording) {
    const settings = {}

    if (waitingRoom !== undefined && waitingRoom !== null && waitingRoom !== '') settings.waiting_room = Boolean(waitingRoom)
    if (joinBeforeHost !== undefined && joinBeforeHost !== null && joinBeforeHost !== '') settings.join_before_host = Boolean(joinBeforeHost)
    if (muteUponEntry !== undefined && muteUponEntry !== null && muteUponEntry !== '') settings.mute_upon_entry = Boolean(muteUponEntry)
    if (autoRecording) settings.auto_recording = this.#resolveChoice(autoRecording, AUTO_RECORDING_MAP)

    return Object.keys(settings).length ? settings : undefined
  }

  // ==========================================================================
  //  OAUTH2 SYSTEM METHODS
  // ==========================================================================
  #getAccessToken() {
    return this.request.headers['oauth-access-token']
  }

  #basicAuthHeader() {
    return `Basic ${ Buffer.from(`${ this.clientId }:${ this.clientSecret }`).toString('base64') }`
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   */
  async getOAuth2ConnectionURL() {
    // docs: https://developers.zoom.us/docs/integrations/oauth/
    // Scopes are configured on the Zoom OAuth app itself, not passed in the authorize URL.
    // redirect_uri is injected by the FlowRunner platform - do not append it here.
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
    })

    return `${ OAUTH_AUTHORIZE_URL }?${ params.toString() }`
  }

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   */
  async executeCallback(callbackObject) {
    // docs: https://developers.zoom.us/docs/integrations/oauth/ - token request uses HTTP Basic
    // auth (clientId:clientSecret) and must echo the redirect_uri used in the authorize step.
    const tokenResponse = await Flowrunner.Request.post(OAUTH_TOKEN_URL)
      .set({
        'Authorization': this.#basicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      })
      .send(
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: callbackObject.code,
          redirect_uri: callbackObject.redirectURI,
        }).toString()
      )

    const me = await Flowrunner.Request.get(`${ API_BASE }/users/me`)
      .set({ Authorization: `Bearer ${ tokenResponse.access_token }` })

    return {
      token: tokenResponse.access_token,
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token,
      connectionIdentityName: me?.email || [me?.first_name, me?.last_name].filter(Boolean).join(' ') || null,
      connectionIdentityImageURL: me?.pic_url || null,
      overwrite: true,
    }
  }

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   */
  async refreshToken(refreshToken) {
    // docs: https://developers.zoom.us/docs/integrations/oauth/#refreshing-an-access-token
    const tokenResponse = await Flowrunner.Request.post(OAUTH_TOKEN_URL)
      .set({
        'Authorization': this.#basicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      })
      .send(
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }).toString()
      )

    return {
      token: tokenResponse.access_token,
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token,
    }
  }

  // ==========================================================================
  //  MEETINGS
  // ==========================================================================
  /**
   * @operationName Create Meeting
   * @category Meetings
   * @description Creates a Zoom meeting for the connected user and returns its ID, join URL, and start URL. Supports instant, scheduled, and recurring (no fixed time) meetings, with optional waiting room, join-before-host, mute-on-entry, and automatic recording settings.
   * @route POST /create-meeting
   * @paramDef {"type":"String","label":"Topic","name":"topic","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The meeting topic (title), up to 200 characters."}
   * @paramDef {"type":"String","label":"Meeting Type","name":"meetingType","defaultValue":"Scheduled","uiComponent":{"type":"DROPDOWN","options":{"values":["Instant","Scheduled","Recurring (No Fixed Time)"]}},"description":"Instant meetings start immediately; Scheduled meetings start at the Start Time; Recurring (No Fixed Time) meetings can be started at any time, repeatedly."}
   * @paramDef {"type":"String","label":"Start Time","name":"startTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"When the meeting starts, in ISO 8601 format (e.g. 2026-08-01T15:00:00Z). Required for Scheduled meetings; ignored for Instant and Recurring (No Fixed Time)."}
   * @paramDef {"type":"Number","label":"Duration (Minutes)","name":"duration","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":60,"description":"Scheduled meeting length in minutes."}
   * @paramDef {"type":"String","label":"Timezone","name":"timezone","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Timezone for the start time (e.g. America/New_York). Defaults to the user's Zoom timezone. Not needed when Start Time is in UTC (ends with Z)."}
   * @paramDef {"type":"String","label":"Agenda","name":"agenda","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The meeting agenda (description), up to 2000 characters."}
   * @paramDef {"type":"String","label":"Password","name":"password","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Passcode participants must enter to join, up to 10 characters. Account policies may restrict allowed characters."}
   * @paramDef {"type":"Boolean","label":"Waiting Room","name":"waitingRoom","uiComponent":{"type":"TOGGLE"},"description":"Hold participants in a waiting room until the host admits them."}
   * @paramDef {"type":"Boolean","label":"Join Before Host","name":"joinBeforeHost","uiComponent":{"type":"TOGGLE"},"description":"Allow participants to join before the host arrives. Ignored when the waiting room is enabled."}
   * @paramDef {"type":"Boolean","label":"Mute Upon Entry","name":"muteUponEntry","uiComponent":{"type":"TOGGLE"},"description":"Mute participants automatically as they join."}
   * @paramDef {"type":"String","label":"Auto Recording","name":"autoRecording","uiComponent":{"type":"DROPDOWN","options":{"values":["None","Local","Cloud"]}},"description":"Record the meeting automatically: locally on the host's computer, to Zoom cloud storage (paid plans), or not at all."}
   * @returns {Object}
   * @sampleResult {"id":85746065434,"uuid":"4444AAAiAAAAAiAiAiiAii==","host_id":"30R7kT7bTIKSNUFEuH_Qlg","topic":"Weekly Sync","type":2,"status":"waiting","start_time":"2026-08-01T15:00:00Z","duration":60,"timezone":"America/New_York","agenda":"Discuss roadmap","created_at":"2026-07-13T10:00:00Z","join_url":"https://zoom.us/j/85746065434?pwd=abc123","start_url":"https://zoom.us/s/85746065434?zak=...","password":"abc123","settings":{"waiting_room":true,"join_before_host":false,"mute_upon_entry":true,"auto_recording":"cloud"}}
   */
  async createMeeting(topic, meetingType, startTime, duration, timezone, agenda, password, waitingRoom, joinBeforeHost, muteUponEntry, autoRecording) {
    // docs: POST /users/{userId}/meetings - topic, type (1|2|3), start_time, duration, timezone,
    // agenda, password, settings{waiting_room, join_before_host, mute_upon_entry, auto_recording}
    if (!topic) throw new Error('Topic is required.')

    const body = {
      topic,
      type: this.#resolveChoice(meetingType, MEETING_TYPE_MAP) || 2,
    }

    if (startTime) body.start_time = startTime
    if (duration !== undefined && duration !== null && duration !== '') body.duration = Number(duration)
    if (timezone) body.timezone = timezone
    if (agenda) body.agenda = agenda
    if (password) body.password = password

    const settings = this.#buildSettings(waitingRoom, joinBeforeHost, muteUponEntry, autoRecording)

    if (settings) body.settings = settings

    return await this.#apiRequest({ url: `${ API_BASE }/users/me/meetings`, method: 'post', body, logTag: 'createMeeting' })
  }

  /**
   * @operationName Get Meeting
   * @category Meetings
   * @description Retrieves the full details of one meeting by its ID, including topic, schedule, join URL, and settings. Works for upcoming and live meetings hosted by the connected user.
   * @route GET /get-meeting
   * @paramDef {"type":"String","label":"Meeting","name":"meetingId","required":true,"dictionary":"getMeetingsDictionary","description":"The meeting to fetch. Pick from your upcoming meetings or provide a meeting ID."}
   * @returns {Object}
   * @sampleResult {"id":85746065434,"uuid":"4444AAAiAAAAAiAiAiiAii==","host_id":"30R7kT7bTIKSNUFEuH_Qlg","topic":"Weekly Sync","type":2,"status":"waiting","start_time":"2026-08-01T15:00:00Z","duration":60,"timezone":"America/New_York","agenda":"Discuss roadmap","join_url":"https://zoom.us/j/85746065434?pwd=abc123","settings":{"waiting_room":true,"join_before_host":false,"mute_upon_entry":true,"auto_recording":"cloud"}}
   */
  async getMeeting(meetingId) {
    return await this.#apiRequest({ url: `${ API_BASE }/meetings/${ this.#requireMeetingId(meetingId) }`, logTag: 'getMeeting' })
  }

  /**
   * @operationName List Meetings
   * @category Meetings
   * @description Lists the connected user's meetings, filtered to scheduled, currently live, or upcoming meetings, with token-based pagination. Note: instant meetings and details like the agenda are not included in list results - use Get Meeting for full details.
   * @route GET /list-meetings
   * @paramDef {"type":"String","label":"Type","name":"listType","defaultValue":"Upcoming","uiComponent":{"type":"DROPDOWN","options":{"values":["Scheduled","Live","Upcoming"]}},"description":"Scheduled: all unexpired scheduled meetings; Live: meetings in progress right now; Upcoming: all upcoming meetings including live ones."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":30,"description":"Results per page (max 300)."}
   * @paramDef {"type":"String","label":"Next Page Token","name":"nextPageToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Token from a previous response to fetch the next page. Tokens expire after 15 minutes."}
   * @returns {Object}
   * @sampleResult {"page_size":30,"total_records":2,"next_page_token":"","meetings":[{"id":85746065434,"uuid":"4444AAAiAAAAAiAiAiiAii==","host_id":"30R7kT7bTIKSNUFEuH_Qlg","topic":"Weekly Sync","type":2,"start_time":"2026-08-01T15:00:00Z","duration":60,"timezone":"America/New_York","created_at":"2026-07-13T10:00:00Z","join_url":"https://zoom.us/j/85746065434"}]}
   */
  async listMeetings(listType, pageSize, nextPageToken) {
    // docs: GET /users/{userId}/meetings - type (scheduled|live|upcoming), page_size, next_page_token
    const query = {
      type: this.#resolveChoice(listType, LIST_TYPE_MAP) || 'upcoming',
      page_size: pageSize || PAGE_SIZE,
    }

    if (nextPageToken) query.next_page_token = nextPageToken

    return await this.#apiRequest({ url: `${ API_BASE }/users/me/meetings`, query, logTag: 'listMeetings' })
  }

  /**
   * @operationName Update Meeting
   * @category Meetings
   * @description Updates an existing meeting's topic, schedule, agenda, password, or settings. Only the fields you provide are changed; everything else keeps its current value.
   * @route PATCH /update-meeting
   * @paramDef {"type":"String","label":"Meeting","name":"meetingId","required":true,"dictionary":"getMeetingsDictionary","description":"The meeting to update. Pick from your upcoming meetings or provide a meeting ID."}
   * @paramDef {"type":"String","label":"Topic","name":"topic","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New meeting topic (title)."}
   * @paramDef {"type":"String","label":"Start Time","name":"startTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"New start time in ISO 8601 format (e.g. 2026-08-01T15:00:00Z)."}
   * @paramDef {"type":"Number","label":"Duration (Minutes)","name":"duration","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New meeting length in minutes."}
   * @paramDef {"type":"String","label":"Timezone","name":"timezone","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Timezone for the start time (e.g. America/New_York)."}
   * @paramDef {"type":"String","label":"Agenda","name":"agenda","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New meeting agenda (description)."}
   * @paramDef {"type":"String","label":"Password","name":"password","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New join passcode, up to 10 characters."}
   * @paramDef {"type":"Boolean","label":"Waiting Room","name":"waitingRoom","uiComponent":{"type":"TOGGLE"},"description":"Enable or disable the waiting room."}
   * @paramDef {"type":"Boolean","label":"Join Before Host","name":"joinBeforeHost","uiComponent":{"type":"TOGGLE"},"description":"Allow or disallow joining before the host arrives."}
   * @paramDef {"type":"Boolean","label":"Mute Upon Entry","name":"muteUponEntry","uiComponent":{"type":"TOGGLE"},"description":"Mute or unmute participants automatically as they join."}
   * @paramDef {"type":"String","label":"Auto Recording","name":"autoRecording","uiComponent":{"type":"DROPDOWN","options":{"values":["None","Local","Cloud"]}},"description":"Change automatic recording: locally, to Zoom cloud storage (paid plans), or off."}
   * @returns {Object}
   * @sampleResult {"updated":true,"meetingId":"85746065434"}
   */
  async updateMeeting(meetingId, topic, startTime, duration, timezone, agenda, password, waitingRoom, joinBeforeHost, muteUponEntry, autoRecording) {
    // docs: PATCH /meetings/{meetingId} - same body shape as create; returns 204 No Content
    const id = this.#requireMeetingId(meetingId)
    const body = {}

    if (topic) body.topic = topic
    if (startTime) body.start_time = startTime
    if (duration !== undefined && duration !== null && duration !== '') body.duration = Number(duration)
    if (timezone) body.timezone = timezone
    if (agenda) body.agenda = agenda
    if (password) body.password = password

    const settings = this.#buildSettings(waitingRoom, joinBeforeHost, muteUponEntry, autoRecording)

    if (settings) body.settings = settings

    if (!Object.keys(body).length) {
      throw new Error('Provide at least one field to update.')
    }

    await this.#apiRequest({ url: `${ API_BASE }/meetings/${ id }`, method: 'patch', body, logTag: 'updateMeeting' })

    return { updated: true, meetingId: String(meetingId) }
  }

  /**
   * @operationName Delete Meeting
   * @category Meetings
   * @description Deletes a meeting by its ID, removing it from the host's schedule. Registrants are not notified by this action. This cannot be undone.
   * @route DELETE /delete-meeting
   * @paramDef {"type":"String","label":"Meeting","name":"meetingId","required":true,"dictionary":"getMeetingsDictionary","description":"The meeting to delete. Pick from your upcoming meetings or provide a meeting ID."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"meetingId":"85746065434"}
   */
  async deleteMeeting(meetingId) {
    // docs: DELETE /meetings/{meetingId} - returns 204 No Content
    const id = this.#requireMeetingId(meetingId)

    await this.#apiRequest({ url: `${ API_BASE }/meetings/${ id }`, method: 'delete', logTag: 'deleteMeeting' })

    return { deleted: true, meetingId: String(meetingId) }
  }

  /**
   * @operationName Get Meeting Invitation
   * @category Meetings
   * @description Retrieves the meeting's invitation text - the ready-to-send blurb with the join link, meeting ID, and passcode that Zoom generates for the host. Use this to email or message an invite from a flow.
   * @route GET /get-meeting-invitation
   * @paramDef {"type":"String","label":"Meeting","name":"meetingId","required":true,"dictionary":"getMeetingsDictionary","description":"The meeting whose invitation text to fetch."}
   * @returns {Object}
   * @sampleResult {"invitation":"Jane Doe is inviting you to a scheduled Zoom meeting.\n\nTopic: Weekly Sync\nTime: Aug 1, 2026 03:00 PM Eastern Time (US and Canada)\n\nJoin Zoom Meeting\nhttps://zoom.us/j/85746065434?pwd=abc123\n\nMeeting ID: 857 4606 5434\nPasscode: abc123"}
   */
  async getMeetingInvitation(meetingId) {
    // docs: GET /meetings/{meetingId}/invitation - returns { invitation }
    return await this.#apiRequest({ url: `${ API_BASE }/meetings/${ this.#requireMeetingId(meetingId) }/invitation`, logTag: 'getMeetingInvitation' })
  }

  // ==========================================================================
  //  REGISTRANTS
  // ==========================================================================
  /**
   * @operationName Add Meeting Registrant
   * @category Registrants
   * @description Registers a person for a meeting and returns their personal join URL. The meeting must have registration enabled (set up in the Zoom web portal when scheduling); otherwise Zoom rejects the request.
   * @route POST /add-meeting-registrant
   * @paramDef {"type":"String","label":"Meeting","name":"meetingId","required":true,"dictionary":"getMeetingsDictionary","description":"The meeting to register the person for. Registration must be enabled on it."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The registrant's email address."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The registrant's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The registrant's last name."}
   * @returns {Object}
   * @sampleResult {"id":85746065434,"registrant_id":"9tboDiHUQAeOnbmudzWa5g","topic":"Weekly Sync","start_time":"2026-08-01T15:00:00Z","join_url":"https://zoom.us/w/85746065434?tk=xyz","participant_pin_code":380303}
   */
  async addMeetingRegistrant(meetingId, email, firstName, lastName) {
    // docs: POST /meetings/{meetingId}/registrants - email + first_name required, last_name optional
    const id = this.#requireMeetingId(meetingId)

    if (!email) throw new Error('Email is required.')
    if (!firstName) throw new Error('First Name is required.')

    const body = { email, first_name: firstName }

    if (lastName) body.last_name = lastName

    return await this.#apiRequest({ url: `${ API_BASE }/meetings/${ id }/registrants`, method: 'post', body, logTag: 'addMeetingRegistrant' })
  }

  /**
   * @operationName List Meeting Registrants
   * @category Registrants
   * @description Lists the people registered for a meeting, including their name, email, status, and personal join URL, with token-based pagination. The meeting must have registration enabled.
   * @route GET /list-meeting-registrants
   * @paramDef {"type":"String","label":"Meeting","name":"meetingId","required":true,"dictionary":"getMeetingsDictionary","description":"The meeting whose registrants to list."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":30,"description":"Results per page (max 300)."}
   * @paramDef {"type":"String","label":"Next Page Token","name":"nextPageToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Token from a previous response to fetch the next page. Tokens expire after 15 minutes."}
   * @returns {Object}
   * @sampleResult {"page_size":30,"total_records":1,"next_page_token":"","registrants":[{"id":"9tboDiHUQAeOnbmudzWa5g","email":"jane@example.com","first_name":"Jane","last_name":"Doe","status":"approved","join_url":"https://zoom.us/w/85746065434?tk=xyz","create_time":"2026-07-13T10:05:00Z"}]}
   */
  async listMeetingRegistrants(meetingId, pageSize, nextPageToken) {
    // docs: GET /meetings/{meetingId}/registrants
    const id = this.#requireMeetingId(meetingId)
    const query = { page_size: pageSize || PAGE_SIZE }

    if (nextPageToken) query.next_page_token = nextPageToken

    return await this.#apiRequest({ url: `${ API_BASE }/meetings/${ id }/registrants`, query, logTag: 'listMeetingRegistrants' })
  }

  // ==========================================================================
  //  RECORDINGS (cloud recording requires a paid Zoom plan)
  // ==========================================================================
  /**
   * @operationName List Cloud Recordings
   * @category Recordings
   * @description Lists the connected user's cloud recordings within a date range (up to one month per request; defaults to the last 30 days), including per-file download URLs. Cloud recording requires a paid Zoom plan.
   * @route GET /list-cloud-recordings
   * @paramDef {"type":"String","label":"From","name":"from","uiComponent":{"type":"DATE_PICKER"},"description":"Start of the date range (yyyy-MM-dd). The range may span at most one month."}
   * @paramDef {"type":"String","label":"To","name":"to","uiComponent":{"type":"DATE_PICKER"},"description":"End of the date range (yyyy-MM-dd)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":30,"description":"Results per page (max 300)."}
   * @paramDef {"type":"String","label":"Next Page Token","name":"nextPageToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Token from a previous response to fetch the next page. Tokens expire after 15 minutes."}
   * @returns {Object}
   * @sampleResult {"from":"2026-06-13","to":"2026-07-13","page_size":30,"total_records":1,"next_page_token":"","meetings":[{"uuid":"4444AAAiAAAAAiAiAiiAii==","id":85746065434,"topic":"Weekly Sync","start_time":"2026-07-01T15:00:00Z","duration":58,"total_size":338101,"recording_count":2,"recording_files":[{"id":"f1b1c9a0","file_type":"MP4","file_size":338101,"recording_start":"2026-07-01T15:00:05Z","recording_end":"2026-07-01T15:58:00Z","download_url":"https://zoom.us/rec/download/abc","status":"completed"}]}]}
   */
  async listCloudRecordings(from, to, pageSize, nextPageToken) {
    // docs: GET /users/{userId}/recordings - from/to (yyyy-MM-dd, max one month), page_size, next_page_token
    const query = { page_size: pageSize || PAGE_SIZE }

    if (from) query.from = from
    if (to) query.to = to
    if (nextPageToken) query.next_page_token = nextPageToken

    return await this.#apiRequest({ url: `${ API_BASE }/users/me/recordings`, query, logTag: 'listCloudRecordings' })
  }

  /**
   * @operationName Get Meeting Recordings
   * @category Recordings
   * @description Retrieves all cloud recording files of one meeting - video, audio, transcript, and chat files - each with its download URL. Cloud recording requires a paid Zoom plan; download URLs may require an access token appended for protected recordings.
   * @route GET /get-meeting-recordings
   * @paramDef {"type":"String","label":"Meeting ID","name":"meetingId","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The meeting ID or UUID whose recordings to fetch. For a recurring meeting the ID returns the latest instance; use the UUID for a specific instance."}
   * @returns {Object}
   * @sampleResult {"uuid":"4444AAAiAAAAAiAiAiiAii==","id":85746065434,"host_id":"30R7kT7bTIKSNUFEuH_Qlg","topic":"Weekly Sync","start_time":"2026-07-01T15:00:00Z","duration":58,"total_size":338101,"recording_count":2,"share_url":"https://zoom.us/rec/share/abc","recording_files":[{"id":"f1b1c9a0","meeting_id":"4444AAAiAAAAAiAiAiiAii==","file_type":"MP4","file_extension":"MP4","file_size":338101,"recording_type":"shared_screen_with_speaker_view","recording_start":"2026-07-01T15:00:05Z","recording_end":"2026-07-01T15:58:00Z","download_url":"https://zoom.us/rec/download/abc","play_url":"https://zoom.us/rec/play/abc","status":"completed"}]}
   */
  async getMeetingRecordings(meetingId) {
    // docs: GET /meetings/{meetingId}/recordings - response.recording_files[].download_url
    return await this.#apiRequest({ url: `${ API_BASE }/meetings/${ this.#requireMeetingId(meetingId) }/recordings`, logTag: 'getMeetingRecordings' })
  }

  /**
   * @operationName Delete Meeting Recordings
   * @category Recordings
   * @description Deletes all cloud recording files of a meeting, either moving them to the Zoom trash (recoverable for 30 days) or deleting them permanently. Cloud recording requires a paid Zoom plan.
   * @route DELETE /delete-meeting-recordings
   * @paramDef {"type":"String","label":"Meeting ID","name":"meetingId","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The meeting ID or UUID whose recordings to delete."}
   * @paramDef {"type":"String","label":"Delete Mode","name":"deleteMode","defaultValue":"Move To Trash","uiComponent":{"type":"DROPDOWN","options":{"values":["Move To Trash","Delete Permanently"]}},"description":"Move To Trash keeps the files recoverable in the Zoom trash for 30 days; Delete Permanently removes them immediately and cannot be undone."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"meetingId":"85746065434","action":"trash"}
   */
  async deleteMeetingRecordings(meetingId, deleteMode) {
    // docs: DELETE /meetings/{meetingId}/recordings?action=trash|delete - returns 204 No Content
    const id = this.#requireMeetingId(meetingId)
    const action = this.#resolveChoice(deleteMode, RECORDING_DELETE_ACTION_MAP) || 'trash'

    await this.#apiRequest({
      url: `${ API_BASE }/meetings/${ id }/recordings`,
      method: 'delete',
      query: { action },
      logTag: 'deleteMeetingRecordings',
    })

    return { deleted: true, meetingId: String(meetingId), action }
  }

  // ==========================================================================
  //  PAST MEETINGS
  // ==========================================================================
  /**
   * @operationName List Past Meeting Participants
   * @category Past Meetings
   * @description Lists everyone who attended a past meeting, with their name, email, and join/leave times. Requires a paid Zoom plan (Pro or higher); free accounts receive an error from Zoom.
   * @route GET /list-past-meeting-participants
   * @paramDef {"type":"String","label":"Meeting ID","name":"meetingId","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The past meeting's ID or UUID. For a recurring meeting the ID returns the latest instance; use the UUID for a specific instance."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":30,"description":"Results per page (max 300)."}
   * @paramDef {"type":"String","label":"Next Page Token","name":"nextPageToken","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Token from a previous response to fetch the next page. Tokens expire after 15 minutes."}
   * @returns {Object}
   * @sampleResult {"page_size":30,"total_records":2,"next_page_token":"","participants":[{"id":"30R7kT7bTIKSNUFEuH_Qlg","name":"Jane Doe","user_email":"jane@example.com","join_time":"2026-07-01T15:00:05Z","leave_time":"2026-07-01T15:58:00Z","duration":3475,"status":"in_meeting"}]}
   */
  async listPastMeetingParticipants(meetingId, pageSize, nextPageToken) {
    // docs: GET /past_meetings/{meetingId}/participants - paid plan required
    const id = this.#requireMeetingId(meetingId)
    const query = { page_size: pageSize || PAGE_SIZE }

    if (nextPageToken) query.next_page_token = nextPageToken

    return await this.#apiRequest({ url: `${ API_BASE }/past_meetings/${ id }/participants`, query, logTag: 'listPastMeetingParticipants' })
  }

  // ==========================================================================
  //  USERS
  // ==========================================================================
  /**
   * @operationName Get My User
   * @category Users
   * @description Retrieves the connected Zoom user's profile - name, email, account type, timezone, and personal meeting ID. Use this to identify the connected account or read its defaults.
   * @route GET /get-my-user
   * @returns {Object}
   * @sampleResult {"id":"30R7kT7bTIKSNUFEuH_Qlg","first_name":"Jane","last_name":"Doe","email":"jane@example.com","type":2,"timezone":"America/New_York","pmi":5551112222,"personal_meeting_url":"https://zoom.us/j/5551112222","account_id":"q6gBJVO5TzexKYTb_I2rpg","status":"active","pic_url":"https://zoom.us/p/photo.jpg"}
   */
  async getMyUser() {
    // docs: GET /users/me
    return await this.#apiRequest({ url: `${ API_BASE }/users/me`, logTag: 'getMyUser' })
  }

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================
  /**
   * @registerAs DICTIONARY
   * @operationName Get Meetings Dictionary
   * @description Provides the connected user's upcoming meetings (topic and start time) for dropdown selection in meeting actions.
   * @route POST /get-meetings-dictionary
   * @paramDef {"type":"getMeetingsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Weekly Sync — 2026-08-01T15:00:00Z","value":"85746065434","note":"scheduled"}],"cursor":null}
   */
  async getMeetingsDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = { type: 'upcoming', page_size: PAGE_SIZE }

    if (cursor) query.next_page_token = cursor

    const result = await this.#apiRequest({ url: `${ API_BASE }/users/me/meetings`, query, logTag: 'getMeetingsDictionary' })
    const meetings = (result && result.meetings) || []
    const term = (search || '').toLowerCase()

    const typeNotes = { 1: 'instant', 2: 'scheduled', 3: 'recurring', 8: 'recurring' }

    // The list endpoint has no topic filter, so the typed term filters the fetched page
    // in-process. Drop the "load more" once a term has filtered the whole page out.
    const items = meetings
      .map(m => ({
        label: m.start_time ? `${ m.topic } — ${ m.start_time }` : m.topic,
        value: String(m.id),
        note: typeNotes[m.type] || String(m.id),
      }))
      .filter(item => !term || item.label.toLowerCase().includes(term))

    const nextCursor = result && result.next_page_token ? result.next_page_token : null

    return { items, cursor: term && items.length === 0 ? null : nextCursor }
  }
}

Flowrunner.ServerCode.addService(Zoom, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth Client ID from your Zoom app (marketplace.zoom.us → Develop → Build App → General App / OAuth).',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth Client Secret from your Zoom app (marketplace.zoom.us → Develop → Build App → General App / OAuth).',
  },
])
