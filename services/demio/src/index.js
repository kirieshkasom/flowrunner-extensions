const logger = {
  info: (...args) => console.log('[Demio] info:', ...args),
  debug: (...args) => console.log('[Demio] debug:', ...args),
  error: (...args) => console.log('[Demio] error:', ...args),
  warn: (...args) => console.log('[Demio] warn:', ...args),
}

const API_BASE_URL = 'https://my.demio.com/api/v1'

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
 * @integrationName Demio
 * @integrationIcon /icon.png
 */
class DemioService {
  constructor(config) {
    this.apiKey = config.apiKey
    this.apiSecret = config.apiSecret
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
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
          'Api-Key': this.apiKey,
          'Api-Secret': this.apiSecret,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const body = error.body || {}
      let message = body.message

      if (!message && body.errors) {
        message = typeof body.errors === 'string' ? body.errors : JSON.stringify(body.errors)
      }

      if (!message) {
        message = error.message
      }

      const status = error.status || error.statusCode
      const suffix = status ? ` (status ${ status })` : ''

      logger.error(`${ logTag } - failed: ${ message }${ suffix }`)

      throw new Error(`Demio API error: ${ message }${ suffix }`)
    }
  }

  /**
   * @operationName List Events
   * @category Events
   * @description Lists the webinars (events) in your Demio account. Filter by type to return either upcoming (scheduled) events or past events. Each event includes its id, name, and scheduled session dates. Use the returned event id with Get Event, Get Event Dates, Register Participant, and List Event Participants.
   * @route GET /events
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Upcoming","Past"]}},"defaultValue":"Upcoming","description":"Which events to return: Upcoming (scheduled) or Past. Defaults to Upcoming."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":123456,"name":"Product Onboarding Webinar","type":"future","date_id":789012,"dates":[{"date_id":789012,"date":"2026-08-01 15:00:00","timezone":"America/New_York"}]}]
   */
  async listEvents(type) {
    const logTag = '[listEvents]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/events`,
      method: 'get',
      query: {
        type: this.#resolveChoice(type, { Upcoming: 'upcoming', Past: 'past' }) || 'upcoming',
      },
    })
  }

  /**
   * @operationName Get Event
   * @category Events
   * @description Retrieves the full details of a single webinar (event) by its id, including its name, description, registration settings, and scheduled session information. Optionally pass a Date ID to scope the response to one specific session of a recurring event.
   * @route GET /event/{id}
   * @paramDef {"type":"String","label":"Event ID","name":"id","required":true,"dictionary":"getEventsDictionary","description":"The Demio event (webinar) id. Search and select an upcoming event, or enter an id directly."}
   * @paramDef {"type":"String","label":"Date ID","name":"dateId","description":"Optional session date_id to scope the response to a single scheduled session of the event."}
   * @returns {Object}
   * @sampleResult {"id":123456,"name":"Product Onboarding Webinar","description":"Learn the basics.","type":"future","date_id":789012,"registration_count":42,"dates":[{"date_id":789012,"date":"2026-08-01 15:00:00","timezone":"America/New_York"}]}
   */
  async getEvent(id, dateId) {
    const logTag = '[getEvent]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/event/${ encodeURIComponent(id) }`,
      method: 'get',
      query: {
        date_id: dateId,
      },
    })
  }

  /**
   * @operationName Get Event Dates
   * @category Events
   * @description Returns the scheduled session dates for a webinar (event). Each entry includes its date_id, start date/time, and timezone. Use a returned date_id when registering a participant for a specific session with Register Participant.
   * @route GET /event/{id}/dates
   * @paramDef {"type":"String","label":"Event ID","name":"id","required":true,"dictionary":"getEventsDictionary","description":"The Demio event (webinar) id whose scheduled session dates you want."}
   * @returns {Array<Object>}
   * @sampleResult [{"date_id":789012,"date":"2026-08-01 15:00:00","timezone":"America/New_York","status":"upcoming"}]
   */
  async getEventDates(id) {
    const logTag = '[getEventDates]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/event/${ encodeURIComponent(id) }/dates`,
      method: 'get',
    })
  }

  /**
   * @operationName Register Participant
   * @category Registration
   * @description Registers a person for a Demio webinar session. Provide the event id, the session date_id, and the participant's name and email. Optionally pass custom registration fields (as a key/value object matching your event's registration form) and a GDPR consent flag. Returns the created registrant, typically including their unique join link.
   * @route POST /event/register
   * @paramDef {"type":"String","label":"Event ID","name":"id","required":true,"dictionary":"getEventsDictionary","description":"The Demio event (webinar) id to register the participant for."}
   * @paramDef {"type":"String","label":"Date ID","name":"dateId","required":true,"description":"The session date_id to register for. Get valid values from Get Event Dates."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Full name of the participant to register."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Email address of the participant. Their unique join link is sent here."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Optional key/value object of additional registration fields matching your event's registration form (e.g. {\"company\":\"Acme\",\"phone\":\"555-1234\"})."}
   * @paramDef {"type":"Boolean","label":"GDPR Consent","name":"gdpr","uiComponent":{"type":"CHECKBOX"},"description":"Set to true to record the participant's GDPR consent. Required if your event enforces GDPR consent."}
   * @returns {Object}
   * @sampleResult {"id":345678,"event_id":123456,"date_id":789012,"name":"Jane Doe","email":"jane@example.com","join_link":"https://my.demio.com/ref/abcdef"}
   */
  async registerParticipant(id, dateId, name, email, customFields, gdpr) {
    const logTag = '[registerParticipant]'

    const body = clean({
      id,
      date_id: dateId,
      name,
      email,
      gdpr: gdpr === true ? true : undefined,
    })

    if (customFields && typeof customFields === 'object') {
      Object.assign(body, customFields)
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/event/register`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName List Event Participants
   * @category Participants
   * @description Lists the participants (registrants and attendees) for a webinar session. Provide the event id and optionally a session date_id to scope results to a single session. Each participant includes their name, email, registration and attendance status. Use this to sync registrants or check who attended.
   * @route GET /event/{id}/participants
   * @paramDef {"type":"String","label":"Event ID","name":"id","required":true,"dictionary":"getEventsDictionary","description":"The Demio event (webinar) id whose participants you want."}
   * @paramDef {"type":"String","label":"Date ID","name":"dateId","description":"Optional session date_id to scope participants to a single scheduled session."}
   * @returns {Object}
   * @sampleResult {"participants":[{"id":345678,"name":"Jane Doe","email":"jane@example.com","status":"registered","attended":false}]}
   */
  async listEventParticipants(id, dateId) {
    const logTag = '[listEventParticipants]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/event/${ encodeURIComponent(id) }/participants`,
      method: 'get',
      query: {
        date_id: dateId,
      },
    })
  }

  /**
   * @operationName Get Event Report
   * @category Reports
   * @description Retrieves the analytics report for a webinar session, including registration and attendance statistics and the lists of registrants and attendees. Provide the event id and optionally a session date_id to scope the report to a single session. Use this for post-webinar reporting and engagement analysis.
   * @route GET /report/event/{id}
   * @paramDef {"type":"String","label":"Event ID","name":"id","required":true,"dictionary":"getEventsDictionary","description":"The Demio event (webinar) id to report on."}
   * @paramDef {"type":"String","label":"Date ID","name":"dateId","description":"Optional session date_id to scope the report to a single scheduled session."}
   * @returns {Object}
   * @sampleResult {"event_id":123456,"date_id":789012,"stats":{"registered":42,"attended":30,"attendance_rate":0.71},"registrants":[{"id":345678,"name":"Jane Doe","email":"jane@example.com","attended":true}]}
   */
  async getEventReport(id, dateId) {
    const logTag = '[getEventReport]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/report/event/${ encodeURIComponent(id) }`,
      method: 'get',
      query: {
        date_id: dateId,
      },
    })
  }

  /**
   * @typedef {Object} getEventsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter events by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Demio returns events in a single call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Events Dictionary
   * @description Provides a searchable list of upcoming Demio webinars (events) for selecting an event in other operations. Each option's value is the event id expected by Get Event, Get Event Dates, Register Participant, List Event Participants, and Get Event Report.
   * @route POST /get-events-dictionary
   * @paramDef {"type":"getEventsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input for filtering upcoming events by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Product Onboarding Webinar","value":"123456","note":"2026-08-01 15:00:00"}],"cursor":null}
   */
  async getEventsDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getEventsDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/events`,
      method: 'get',
      query: {
        type: 'upcoming',
      },
    })

    const events = Array.isArray(response) ? response : response?.events || []
    const term = (search || '').toLowerCase()

    const filtered = term
      ? events.filter(event => (event.name || '').toLowerCase().includes(term))
      : events

    return {
      items: filtered.map(event => {
        const firstDate = Array.isArray(event.dates) && event.dates.length ? event.dates[0].date : undefined

        return {
          label: event.name || `Event ${ event.id }`,
          value: String(event.id),
          note: firstDate || undefined,
        }
      }),
      cursor: null,
    }
  }
}

Flowrunner.ServerCode.addService(DemioService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Demio Public API Key. Get it from Demio → Settings → Integrations → Public API → API Key. Sent as the Api-Key header.',
  },
  {
    name: 'apiSecret',
    displayName: 'API Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Demio Public API Secret, shown alongside the API Key in Demio → Settings → Integrations → Public API. Sent as the Api-Secret header.',
  },
])
