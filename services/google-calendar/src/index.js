'use strict'

const API_BASE_URL = 'https://www.googleapis.com/calendar/v3'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const USER_INFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

const DEFAULT_SCOPE_LIST = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const DEFAULT_LIMIT = 100

const logger = {
  info: (...args) => console.log('[Google Calendar Service] info:', ...args),
  debug: (...args) => console.log('[Google Calendar Service] debug:', ...args),
  error: (...args) => console.log('[Google Calendar Service] error:', ...args),
  warn: (...args) => console.log('[Google Calendar Service] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName Google Calendar
 * @integrationTriggersScope SINGLE_APP
 * @integrationIcon /icon.webp
 **/
class GoogleCalendarService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'

    if (query) {
      query = cleanupObject(query)
    }

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      return await Flowrunner.Request[method](url)
        .set(this.#getAccessTokenHeader())
        .query(query)
        .send(body)
    } catch (error) {
      logger.error(`${ logTag } - error: ${ JSON.stringify({ ...error }) }`)

      throw error
    }
  }

  #getAccessTokenHeader(accessToken) {
    return {
      Authorization: `Bearer ${ accessToken || this.request.headers['oauth-access-token'] }`,
    }
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('scope', this.scopes)
    params.append('access_type', 'offline')
    params.append('prompt', 'consent')

    const connectionURL = `${ OAUTH_URL }?${ params.toString() }`

    logger.debug(`composed connectionURL: ${ connectionURL }`)

    return connectionURL
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
      const { access_token, expires_in } = await Flowrunner.Request.post(TOKEN_URL)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .query({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        })

      return {
        token: access_token,
        expirationInSeconds: expires_in,
      }
    } catch (error) {
      logger.error(`refreshToken error: ${ error.message }`)

      if (error.body?.error === 'invalid_grant') {
        throw new Error('Refresh token expired or invalid, please re-authenticate.')
      }

      throw error
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

    params.append('client_id', this.clientId)
    params.append('code', callbackObject.code)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('grant_type', 'authorization_code')
    params.append('client_secret', this.clientSecret)
    params.append('access_type', 'offline')

    const codeExchangeResponse = await Flowrunner.Request.post(TOKEN_URL)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    logger.debug(`[executeCallback] codeExchangeResponse: ${ JSON.stringify(codeExchangeResponse) }`)

    let userData = {}
    let connectionIdentityName = 'Google Calendar Account'
    let connectionIdentityImageURL = null

    try {
      userData = await Flowrunner.Request
        .get(USER_INFO_URL)
        .set(this.#getAccessTokenHeader(codeExchangeResponse.access_token))

      logger.debug(`[executeCallback] userInfo: ${ JSON.stringify(userData) }`)

      if (userData.name || userData.email) {
        connectionIdentityName = userData.name
          ? `${ userData.name } (${ userData.email })`
          : userData.email
      }

      connectionIdentityImageURL = userData.picture || null
    } catch (error) {
      logger.error(`[executeCallback] userInfo error: ${ error.message }`)
    }

    return {
      token: codeExchangeResponse.access_token,
      expirationInSeconds: codeExchangeResponse.expires_in,
      refreshToken: codeExchangeResponse.refresh_token,
      connectionIdentityName,
      connectionIdentityImageURL,
      overwrite: true,
      userData,
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    logger.debug(`handleTriggerPollingForEvent.${ invocation.eventName }`)

    return this[invocation.eventName](invocation)
  }

  // ========================================== DICTIONARIES ===========================================

  /**
   * @typedef {Object} DictionaryPayload
   * @property {String} [search]
   * @property {String} [cursor]
   */

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
   * @typedef {Object} getCalendarsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter calendars by their name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Calendars
   * @category Calendar Management
   * @description Returns available calendars for AI-powered event scheduling. Enables AI agents to dynamically select appropriate calendars based on event type, team, or business context.
   *
   * @route POST /get-calendars
   *
   * @paramDef {"type":"getCalendarsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination token for retrieving and filtering calendars."}
   *
   * @sampleResult {"cursor":"nextPageToken123","items":[{"label":"Primary Calendar","note":"user@example.com","value":"primary"},{"label":"Work Calendar","note":"work@example.com","value":"work@example.com"}]}
   * @returns {DictionaryResponse}
   */
  async getCalendarsDictionary({ search, cursor }) {
    const response = await this.#apiRequest({
      logTag: 'getCalendarsDictionary',
      url: `${ API_BASE_URL }/users/me/calendarList`,
      query: {
        maxResults: DEFAULT_LIMIT,
        pageToken: cursor,
      },
    })

    const calendars = response.items || []

    const filteredCalendars = search
      ? searchFilter(calendars, ['summary', 'id'], search)
      : calendars

    return {
      cursor: response.nextPageToken,
      items: filteredCalendars.map(({ summary, id }) => ({
        label: summary || id,
        note: `Calendar ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @typedef {Object} getTimeZonesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter timezones. Filtering is performed locally on retrieved results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Time Zones
   * @category Calendar Management
   * @description Returns available time zones for event scheduling. Enables AI agents to set appropriate time zones for events based on location or participant preferences.
   *
   * @route POST /get-timezones
   *
   * @paramDef {"type":"getTimeZonesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering time zones."}
   *
   * @sampleResult {"items":[{"label":"America/New_York (Eastern Time)","note":"UTC-05:00","value":"America/New_York"},{"label":"America/Los_Angeles (Pacific Time)","note":"UTC-08:00","value":"America/Los_Angeles"}]}
   * @returns {DictionaryResponse}
   */
  async getTimeZonesDictionary({ search }) {
    // Common time zones list
    const timeZones = [
      { value: 'America/New_York', label: 'Eastern Time (US & Canada)', offset: 'UTC-05:00' },
      { value: 'America/Chicago', label: 'Central Time (US & Canada)', offset: 'UTC-06:00' },
      { value: 'America/Denver', label: 'Mountain Time (US & Canada)', offset: 'UTC-07:00' },
      { value: 'America/Los_Angeles', label: 'Pacific Time (US & Canada)', offset: 'UTC-08:00' },
      { value: 'Europe/London', label: 'London', offset: 'UTC+00:00' },
      { value: 'Europe/Paris', label: 'Paris', offset: 'UTC+01:00' },
      { value: 'Europe/Berlin', label: 'Berlin', offset: 'UTC+01:00' },
      { value: 'Asia/Tokyo', label: 'Tokyo', offset: 'UTC+09:00' },
      { value: 'Asia/Hong_Kong', label: 'Hong Kong', offset: 'UTC+08:00' },
      { value: 'Asia/Singapore', label: 'Singapore', offset: 'UTC+08:00' },
      { value: 'Australia/Sydney', label: 'Sydney', offset: 'UTC+10:00' },
      { value: 'UTC', label: 'UTC', offset: 'UTC+00:00' },
    ]

    const filteredTimeZones = search
      ? searchFilter(timeZones, ['value', 'label'], search)
      : timeZones

    return {
      items: filteredTimeZones.map(({ value, label, offset }) => ({
        label: `${ label } (${ value })`,
        note: offset,
        value: value,
      })),
    }
  }

  // ======================================= END OF DICTIONARIES =======================================

  /**
   * @description Creates a new calendar event with specified details, enabling AI agents to automatically schedule meetings, appointments, and reminders. Perfect for automated scheduling, meeting coordination, and calendar management workflows.
   *
   * @route POST /create-event
   * @operationName Create Event
   * @category Event Management
   * @appearanceColor #4285f4 #34a853
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes calendar.events
   *
   * @paramDef {"type":"String","label":"Calendar","name":"calendarId","description":"Select the calendar to add the event to. Use 'primary' for the user's primary calendar or select from available calendars.","required":true,"dictionary":"getCalendarsDictionary"}
   * @paramDef {"type":"String","label":"Summary","name":"summary","description":"Event title. Examples: 'Team Meeting', 'Product Demo', 'Client Call'. This is the main event name displayed in the calendar.","required":true}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Detailed event description. Can include agenda, meeting notes, or additional context.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Location","name":"location","description":"Event location. Examples: 'Conference Room A', '123 Main St', 'Zoom Meeting'. Physical address or meeting platform."}
   * @paramDef {"type":"String","label":"Start Date Time","name":"startDateTime","description":"Event start time in ISO 8601 format. Example: '2025-01-20T10:00:00'. For all-day events, use date only: '2025-01-20'.","required":true}
   * @paramDef {"type":"String","label":"End Date Time","name":"endDateTime","description":"Event end time in ISO 8601 format. Example: '2025-01-20T11:00:00'. For all-day events, use date only: '2025-01-20'.","required":true}
   * @paramDef {"type":"String","label":"Time Zone","name":"timeZone","description":"Time zone for the event. Examples: 'America/New_York', 'Europe/London', 'Asia/Tokyo'. Defaults to calendar's default time zone if not specified.","dictionary":"getTimeZonesDictionary"}
   * @paramDef {"type":"Array<String>","label":"Attendees","name":"attendees","description":"List of attendee email addresses. Example: ['john@example.com', 'jane@example.com']. Invitations will be sent to all attendees.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"Boolean","label":"Send Notifications","name":"sendNotifications","description":"Whether to send email notifications to attendees about the new event. Default: true.","uiComponent":{"type":"TOGGLE"}}
   * @paramDef {"type":"String","label":"Conference Data","name":"conferenceData","description":"Add video/phone conference. Options: 'hangoutsMeet' for Google Meet, 'none' for no conference. Leave empty for no conference.","uiComponent":{"type":"DROPDOWN","options":{"values":["none","hangoutsMeet"]}}}
   * @paramDef {"type":"String","label":"Color","name":"colorId","description":"Event color ID (1-11). Each number represents a different color in Google Calendar. Leave empty for default color.","uiComponent":{"type":"DROPDOWN","options":{"values":["1","2","3","4","5","6","7","8","9","10","11"]}}}
   * @paramDef {"type":"String","label":"Recurrence Rule","name":"recurrence","description":"Recurring event rule in RRULE format. Example: 'RRULE:FREQ=WEEKLY;COUNT=10' for weekly event repeating 10 times. Leave empty for one-time event."}
   *
   * @returns {Object}
   * @sampleResult {"id":"abc123def456","summary":"Team Meeting","description":"Quarterly planning session","location":"Conference Room A","start":{"dateTime":"2025-01-20T10:00:00-05:00","timeZone":"America/New_York"},"end":{"dateTime":"2025-01-20T11:00:00-05:00","timeZone":"America/New_York"},"attendees":[{"email":"john@example.com","responseStatus":"needsAction"},{"email":"jane@example.com","responseStatus":"needsAction"}],"hangoutLink":"https://meet.google.com/abc-defg-hij","htmlLink":"https://www.google.com/calendar/event?eid=abc123def456","status":"confirmed","created":"2025-01-15T14:30:00.000Z"}
   */
  async createEvent(
    calendarId,
    summary,
    description,
    location,
    startDateTime,
    endDateTime,
    timeZone,
    attendees,
    sendNotifications,
    conferenceData,
    colorId,
    recurrence
  ) {
    if (!calendarId) {
      throw new Error('"Calendar" is required')
    }

    if (!summary) {
      throw new Error('"Summary" is required')
    }

    if (!startDateTime) {
      throw new Error('"Start Date Time" is required')
    }

    if (!endDateTime) {
      throw new Error('"End Date Time" is required')
    }

    const event = {
      summary,
      description: description || undefined,
      location: location || undefined,
      colorId: colorId || undefined,
    }

    // Determine if this is an all-day event
    const isAllDay = !startDateTime.includes('T') && !endDateTime.includes('T')

    if (isAllDay) {
      event.start = { date: startDateTime }
      event.end = { date: endDateTime }
    } else {
      event.start = {
        dateTime: startDateTime,
        timeZone: timeZone || undefined,
      }

      event.end = {
        dateTime: endDateTime,
        timeZone: timeZone || undefined,
      }
    }

    // Parse attendees
    if (attendees) {
      if (typeof attendees === 'string') {
        // Split by newlines or commas
        const emailList = attendees
          .split(/[\n,]/)
          .map(email => email.trim())
          .filter(email => email.length > 0)

        event.attendees = emailList.map(email => ({ email }))
      } else if (Array.isArray(attendees)) {
        event.attendees = attendees.map(email => ({ email }))
      }
    }

    // Add recurrence if specified
    if (recurrence) {
      event.recurrence = [recurrence]
    }

    // Add conference data if specified
    if (conferenceData && conferenceData !== 'none') {
      event.conferenceData = {
        createRequest: {
          requestId: generateRequestId(),
          conferenceSolutionKey: { type: conferenceData },
        },
      }
    }

    const queryParams = {
      sendUpdates: sendNotifications === false ? 'none' : 'all',
    }

    if (conferenceData && conferenceData !== 'none') {
      queryParams.conferenceDataVersion = 1
    }

    const result = await this.#apiRequest({
      logTag: 'createEvent',
      method: 'post',
      url: `${ API_BASE_URL }/calendars/${ encodeURIComponent(calendarId) }/events`,
      body: event,
      query: queryParams,
    })

    return result
  }

  /**
   * @description Retrieves details of a specific calendar event, enabling AI agents to access event information, check status, or extract attendee data. Perfect for event verification, status checking, and data extraction workflows.
   *
   * @route GET /get-event
   * @operationName Get Event
   * @category Event Management
   * @appearanceColor #4285f4 #34a853
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes calendar.events.readonly
   *
   * @paramDef {"type":"String","label":"Calendar","name":"calendarId","description":"Calendar containing the event. Use 'primary' for the user's primary calendar.","required":true,"dictionary":"getCalendarsDictionary"}
   * @paramDef {"type":"String","label":"Event ID","name":"eventId","description":"The unique identifier of the event to retrieve.","required":true}
   *
   * @returns {Object}
   * @sampleResult {"id":"abc123def456","summary":"Team Meeting","description":"Quarterly planning session","location":"Conference Room A","start":{"dateTime":"2025-01-20T10:00:00-05:00","timeZone":"America/New_York"},"end":{"dateTime":"2025-01-20T11:00:00-05:00","timeZone":"America/New_York"},"attendees":[{"email":"john@example.com","responseStatus":"accepted"},{"email":"jane@example.com","responseStatus":"tentative"}],"status":"confirmed","htmlLink":"https://www.google.com/calendar/event?eid=abc123def456"}
   */
  async getEvent(calendarId, eventId) {
    if (!calendarId) {
      throw new Error('"Calendar" is required')
    }

    if (!eventId) {
      throw new Error('"Event ID" is required')
    }

    const result = await this.#apiRequest({
      logTag: 'getEvent',
      method: 'get',
      url: `${ API_BASE_URL }/calendars/${ encodeURIComponent(calendarId) }/events/${ encodeURIComponent(eventId) }`,
    })

    return result
  }

  /**
   * @description Lists upcoming events from a calendar with optional filtering, enabling AI agents to retrieve event schedules, check availability, or find specific events. Perfect for availability checking, schedule analysis, and event discovery.
   *
   * @route GET /list-events
   * @operationName List Events
   * @category Event Management
   * @appearanceColor #4285f4 #34a853
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes calendar.events.readonly
   *
   * @paramDef {"type":"String","label":"Calendar","name":"calendarId","description":"Calendar to list events from. Use 'primary' for the user's primary calendar.","required":true,"dictionary":"getCalendarsDictionary"}
   * @paramDef {"type":"String","label":"Time Min","name":"timeMin","description":"Lower bound for event start time. Accepts formats: '2025-01-20T00:00:00Z' (RFC3339), '2025-01-20T00:00:00-05:00' (with timezone), or '2025-01-20' (date only). Defaults to current time."}
   * @paramDef {"type":"String","label":"Time Max","name":"timeMax","description":"Upper bound for event start time. Accepts formats: '2025-02-20T23:59:59Z' (RFC3339), '2025-02-20T23:59:59-05:00' (with timezone), or '2025-02-20' (date only)."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","description":"Maximum number of events to return. Min: 1, Max: 2500. Default: 250.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"String","label":"Search Query","name":"searchQuery","description":"Free text search query to filter events by summary, description, location, attendee names, or emails."}
   * @paramDef {"type":"Boolean","label":"Single Events","name":"singleEvents","description":"Whether to expand recurring events into individual instances. Default: true.","uiComponent":{"type":"TOGGLE"}}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","description":"Sort order of the results. 'startTime' requires singleEvents=true.","uiComponent":{"type":"DROPDOWN","options":{"values":["startTime","updated"]}}}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"abc123","summary":"Team Meeting","start":{"dateTime":"2025-01-20T10:00:00-05:00"},"end":{"dateTime":"2025-01-20T11:00:00-05:00"},"status":"confirmed"},{"id":"def456","summary":"Client Call","start":{"dateTime":"2025-01-21T14:00:00-05:00"},"end":{"dateTime":"2025-01-21T15:00:00-05:00"},"status":"confirmed"}],"nextPageToken":"nextToken123"}
   */
  async listEvents(calendarId, timeMin, timeMax, maxResults, searchQuery, singleEvents, orderBy) {
    if (!calendarId) {
      throw new Error('"Calendar" is required')
    }

    const shouldExpandSingleEvents = singleEvents !== false
    const query = {
      timeMin: timeMin ? ensureRFC3339Format(timeMin, false) : new Date().toISOString(),
      timeMax: timeMax ? ensureRFC3339Format(timeMax, true) : undefined,
      maxResults: maxResults || 250,
      q: searchQuery || undefined,
      singleEvents: shouldExpandSingleEvents,
    }

    // orderBy can only be used when singleEvents is true
    if (orderBy && shouldExpandSingleEvents) {
      query.orderBy = orderBy
    }

    const result = await this.#apiRequest({
      logTag: 'listEvents',
      method: 'get',
      url: `${ API_BASE_URL }/calendars/${ encodeURIComponent(calendarId) }/events`,
      query,
    })

    return result
  }

  /**
   * @description Updates an existing calendar event with new details, enabling AI agents to modify event times, locations, attendees, or other properties. Perfect for rescheduling, updating meeting details, or managing event changes.
   *
   * @route PUT /update-event
   * @operationName Update Event
   * @category Event Management
   * @appearanceColor #4285f4 #34a853
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes calendar.events
   *
   * @paramDef {"type":"String","label":"Calendar","name":"calendarId","description":"Calendar containing the event. Use 'primary' for the user's primary calendar.","required":true,"dictionary":"getCalendarsDictionary"}
   * @paramDef {"type":"String","label":"Event ID","name":"eventId","description":"The unique identifier of the event to update.","required":true}
   * @paramDef {"type":"String","label":"Summary","name":"summary","description":"Updated event title."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Updated event description.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Location","name":"location","description":"Updated event location."}
   * @paramDef {"type":"String","label":"Start Date Time","name":"startDateTime","description":"Updated start time in ISO 8601 format."}
   * @paramDef {"type":"String","label":"End Date Time","name":"endDateTime","description":"Updated end time in ISO 8601 format."}
   * @paramDef {"type":"String","label":"Time Zone","name":"timeZone","description":"Updated time zone.","dictionary":"getTimeZonesDictionary"}
   * @paramDef {"type":"Boolean","label":"Send Notifications","name":"sendNotifications","description":"Whether to send email notifications about the update. Default: true.","uiComponent":{"type":"TOGGLE"}}
   *
   * @returns {Object}
   * @sampleResult {"id":"abc123def456","summary":"Updated Team Meeting","start":{"dateTime":"2025-01-20T14:00:00-05:00","timeZone":"America/New_York"},"end":{"dateTime":"2025-01-20T15:00:00-05:00","timeZone":"America/New_York"},"status":"confirmed","updated":"2025-01-15T16:30:00.000Z"}
   */
  async updateEvent(
    calendarId,
    eventId,
    summary,
    description,
    location,
    startDateTime,
    endDateTime,
    timeZone,
    sendNotifications
  ) {
    if (!calendarId) {
      throw new Error('"Calendar" is required')
    }

    if (!eventId) {
      throw new Error('"Event ID" is required')
    }

    // First, get the existing event
    const existingEvent = await this.getEvent(calendarId, eventId)

    // Build update object with only provided fields
    const updates = {}

    if (summary !== undefined) updates.summary = summary
    if (description !== undefined) updates.description = description
    if (location !== undefined) updates.location = location

    if (startDateTime !== undefined) {
      const isAllDay = !startDateTime.includes('T')

      updates.start = isAllDay
        ? { date: startDateTime }
        : { dateTime: startDateTime, timeZone: timeZone || existingEvent.start.timeZone }
    }

    if (endDateTime !== undefined) {
      const isAllDay = !endDateTime.includes('T')

      updates.end = isAllDay
        ? { date: endDateTime }
        : { dateTime: endDateTime, timeZone: timeZone || existingEvent.end.timeZone }
    }

    const event = { ...existingEvent, ...updates }

    const result = await this.#apiRequest({
      logTag: 'updateEvent',
      method: 'put',
      url: `${ API_BASE_URL }/calendars/${ encodeURIComponent(calendarId) }/events/${ encodeURIComponent(eventId) }`,
      body: event,
      query: {
        sendUpdates: sendNotifications === false ? 'none' : 'all',
      },
    })

    return result
  }

  /**
   * @description Deletes a calendar event, enabling AI agents to cancel meetings, remove appointments, or clean up outdated events. Perfect for automated cancellations, schedule cleanup, and event removal workflows.
   *
   * @route DELETE /delete-event
   * @operationName Delete Event
   * @category Event Management
   * @appearanceColor #4285f4 #34a853
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes calendar.events
   *
   * @paramDef {"type":"String","label":"Calendar","name":"calendarId","description":"Calendar containing the event. Use 'primary' for the user's primary calendar.","required":true,"dictionary":"getCalendarsDictionary"}
   * @paramDef {"type":"String","label":"Event ID","name":"eventId","description":"The unique identifier of the event to delete.","required":true}
   * @paramDef {"type":"Boolean","label":"Send Notifications","name":"sendNotifications","description":"Whether to send email notifications about the cancellation. Default: true.","uiComponent":{"type":"TOGGLE"}}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Event deleted successfully","eventId":"abc123def456"}
   */
  async deleteEvent(calendarId, eventId, sendNotifications) {
    if (!calendarId) {
      throw new Error('"Calendar" is required')
    }

    if (!eventId) {
      throw new Error('"Event ID" is required')
    }

    await this.#apiRequest({
      logTag: 'deleteEvent',
      method: 'delete',
      url: `${ API_BASE_URL }/calendars/${ encodeURIComponent(calendarId) }/events/${ encodeURIComponent(eventId) }`,
      query: {
        sendUpdates: sendNotifications === false ? 'none' : 'all',
      },
    })

    return {
      success: true,
      message: 'Event deleted successfully',
      eventId,
    }
  }

  // ============================================ TRIGGERS =============================================

  #getEventTimestamp(timeObj) {
    if (!timeObj) return null

    if (timeObj.dateTime) {
      return new Date(timeObj.dateTime).getTime()
    }

    if (timeObj.date) {
      return new Date(timeObj.date).getTime()
    }

    return null
  }

  /**
   * @operationName On Event Starting Soon
   * @category Event Triggers
   * @description Triggers when a calendar event is about to start within the specified lead time. Enables AI agents to send reminders, prepare meeting materials, or initiate pre-meeting workflows. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   *
   * @route POST /on-event-starting-soon
   * @appearanceColor #f9566d #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Calendar","name":"calendarId","description":"Calendar to monitor for upcoming events. Use 'primary' for the user's primary calendar.","required":true,"dictionary":"getCalendarsDictionary"}
   * @paramDef {"type":"String","label":"Lead Time","name":"leadTimeMinutes","description":"How many minutes before the event start time to trigger the notification.","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["5","10","15","30","60"]}}}
   *
   * @returns {Object}
   * @sampleResult {"id":"abc123def456","summary":"Team Meeting","description":"Quarterly planning session","location":"Conference Room A","start":{"dateTime":"2025-01-20T10:00:00-05:00","timeZone":"America/New_York"},"end":{"dateTime":"2025-01-20T11:00:00-05:00","timeZone":"America/New_York"},"attendees":[{"email":"john@example.com","responseStatus":"accepted"}],"status":"confirmed","htmlLink":"https://www.google.com/calendar/event?eid=abc123def456"}
   */
  async onEventStartingSoon(invocation) {
    const { calendarId, leadTimeMinutes } = invocation.triggerData
    const leadMs = (parseInt(leadTimeMinutes, 10) || 15) * 60 * 1000

    if (invocation.learningMode) {
      const now = new Date()
      const result = await this.#apiRequest({
        logTag: 'onEventStartingSoon.learningMode',
        method: 'get',
        url: `${ API_BASE_URL }/calendars/${ encodeURIComponent(calendarId) }/events`,
        query: {
          timeMin: now.toISOString(),
          maxResults: 1,
          singleEvents: true,
          orderBy: 'startTime',
        },
      })

      const event = result.items?.[0] || null

      return {
        events: event ? [event] : [],
        state: null,
      }
    }

    const now = new Date()
    const windowEnd = new Date(now.getTime() + leadMs)

    const result = await this.#apiRequest({
      logTag: 'onEventStartingSoon',
      method: 'get',
      url: `${ API_BASE_URL }/calendars/${ encodeURIComponent(calendarId) }/events`,
      query: {
        timeMin: now.toISOString(),
        timeMax: windowEnd.toISOString(),
        maxResults: 250,
        singleEvents: true,
        orderBy: 'startTime',
      },
    })

    const events = result.items || []
    const currentEventIds = new Set(events.map(e => e.id))

    if (!invocation.state?.initialized) {
      logger.debug(`onEventStartingSoon.init: found ${ events.length } events in window`)

      return {
        events: [],
        state: {
          initialized: true,
          notifiedEventIds: events.map(e => e.id),
        },
      }
    }

    const previousIds = new Set(invocation.state.notifiedEventIds || [])
    const newEvents = events.filter(e => !previousIds.has(e.id))

    logger.debug(`onEventStartingSoon: ${ newEvents.length } new events in window`)

    // Keep only IDs that are still in the current window + new ones
    const updatedIds = [...invocation.state.notifiedEventIds.filter(id => currentEventIds.has(id))]

    for (const e of newEvents) {
      updatedIds.push(e.id)
    }

    return {
      events: newEvents,
      state: {
        initialized: true,
        notifiedEventIds: updatedIds,
      },
    }
  }

  /**
   * @operationName On Event Ended
   * @category Event Triggers
   * @description Triggers when a calendar event has ended. Enables AI agents to send follow-up emails, create meeting summaries, log attendance, or initiate post-meeting workflows. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   *
   * @route POST /on-event-ended
   * @appearanceColor #f9566d #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Calendar","name":"calendarId","description":"Calendar to monitor for ended events. Use 'primary' for the user's primary calendar.","required":true,"dictionary":"getCalendarsDictionary"}
   *
   * @returns {Object}
   * @sampleResult {"id":"abc123def456","summary":"Team Meeting","description":"Quarterly planning session","location":"Conference Room A","start":{"dateTime":"2025-01-20T10:00:00-05:00","timeZone":"America/New_York"},"end":{"dateTime":"2025-01-20T11:00:00-05:00","timeZone":"America/New_York"},"attendees":[{"email":"john@example.com","responseStatus":"accepted"}],"status":"confirmed","htmlLink":"https://www.google.com/calendar/event?eid=abc123def456"}
   */
  async onEventEnded(invocation) {
    const { calendarId } = invocation.triggerData
    const LOOKBACK_MS = 2 * 60 * 60 * 1000 // 2 hours

    if (invocation.learningMode) {
      const now = new Date()
      const lookbackStart = new Date(now.getTime() - LOOKBACK_MS)

      const result = await this.#apiRequest({
        logTag: 'onEventEnded.learningMode',
        method: 'get',
        url: `${ API_BASE_URL }/calendars/${ encodeURIComponent(calendarId) }/events`,
        query: {
          timeMin: lookbackStart.toISOString(),
          timeMax: now.toISOString(),
          maxResults: 1,
          singleEvents: true,
          orderBy: 'startTime',
        },
      })

      const events = result.items || []
      const nowMs = now.getTime()
      const endedEvent = events.find(e => {
        const endMs = this.#getEventTimestamp(e.end)

        return endMs && endMs <= nowMs
      })

      return {
        events: endedEvent ? [endedEvent] : [],
        state: null,
      }
    }

    const now = new Date()
    const nowMs = now.getTime()
    const lookbackStart = new Date(nowMs - LOOKBACK_MS)

    const result = await this.#apiRequest({
      logTag: 'onEventEnded',
      method: 'get',
      url: `${ API_BASE_URL }/calendars/${ encodeURIComponent(calendarId) }/events`,
      query: {
        timeMin: lookbackStart.toISOString(),
        timeMax: now.toISOString(),
        maxResults: 250,
        singleEvents: true,
        orderBy: 'startTime',
      },
    })

    const allEvents = result.items || []
    const endedEvents = allEvents.filter(e => {
      const endMs = this.#getEventTimestamp(e.end)

      return endMs && endMs <= nowMs
    })

    const currentEndedIds = new Set(endedEvents.map(e => e.id))

    if (!invocation.state?.initialized) {
      logger.debug(`onEventEnded.init: found ${ endedEvents.length } ended events`)

      return {
        events: [],
        state: {
          initialized: true,
          notifiedEventIds: endedEvents.map(e => e.id),
        },
      }
    }

    const previousIds = new Set(invocation.state.notifiedEventIds || [])
    const newEndedEvents = endedEvents.filter(e => !previousIds.has(e.id))

    logger.debug(`onEventEnded: ${ newEndedEvents.length } newly ended events`)

    // Keep only IDs still in the lookback window + new ones
    const updatedIds = [...invocation.state.notifiedEventIds.filter(id => currentEndedIds.has(id))]

    for (const e of newEndedEvents) {
      updatedIds.push(e.id)
    }

    return {
      events: newEndedEvents,
      state: {
        initialized: true,
        notifiedEventIds: updatedIds,
      },
    }
  }
}

Flowrunner.ServerCode.addService(GoogleCalendarService, [
  {
    order: 0,
    displayName: 'Client Id',
    defaultValue: '',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your OAuth 2.0 Client ID from the Google Cloud Console (used for authentication requests).',
  },
  {
    order: 1,
    displayName: 'Client Secret',
    defaultValue: '',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your OAuth 2.0 Client Secret from the Google Cloud Console (required for secure authentication).',
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
      const value = prop.split('.').reduce((acc, key) => acc?.[key], item)

      return value && String(value).toLowerCase().includes(searchString.toLowerCase())
    })
  )
}

function generateRequestId() {
  return `${ Date.now() }-${ Math.random().toString(36).substring(2, 15) }`
}

function ensureRFC3339Format(dateString, isEndDate = false) {
  // If it's already in RFC3339 format (has 'T' and timezone), return as-is
  if (dateString.includes('T') && (dateString.includes('Z') || dateString.includes('+') || dateString.match(/-\d{2}:\d{2}$/))) {
    return dateString
  }

  // If it's a date only (YYYY-MM-DD), convert to start/end of day in UTC
  if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const time = isEndDate ? 'T23:59:59Z' : 'T00:00:00Z'

    return `${ dateString }${ time }`
  }

  // If it has T but no timezone, add Z for UTC
  if (dateString.includes('T')) {
    return `${ dateString }Z`
  }

  // Fallback: try to parse and convert to ISO string
  return new Date(dateString).toISOString()
}
