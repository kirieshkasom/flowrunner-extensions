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
   * @description Lists the webinars (events) in your Demio account. Filter by type to return Upcoming (scheduled) events, Past events, or Automated (evergreen) events. Each event includes its id, name, and scheduled session dates. Use the returned event id with Get Event, Register Participant, and (via a session date_id) List Session Participants.
   * @route GET /events
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Upcoming","Past","Automated"]}},"defaultValue":"Upcoming","description":"Which events to return: Upcoming (scheduled), Past, or Automated (evergreen). Defaults to Upcoming."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":123456,"name":"Product Onboarding Webinar","type":"future","dates":[{"date_id":789012,"status":"upcoming","timestamp":1785945600,"datetime":"2026-08-01 15:00:00","zone":"America/New_York"}]}]
   */
  async listEvents(type) {
    const logTag = '[listEvents]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/events`,
      method: 'get',
      query: {
        type: this.#resolveChoice(type, { Upcoming: 'upcoming', Past: 'past', Automated: 'automated' }) || 'upcoming',
      },
    })
  }

  /**
   * @operationName Get Event
   * @category Events
   * @description Retrieves the full details of a single webinar (event) by its id, including its name, registration settings, and its scheduled sessions. The response contains a "dates" array where each entry has a date_id, status, and start datetime/timezone — use those date_id values with Get Event Session, Register Participant, and List Session Participants. Set Active Dates Only to return only currently active (not-yet-run) sessions.
   * @route GET /event/{id}
   * @paramDef {"type":"String","label":"Event ID","name":"id","required":true,"dictionary":"getEventsDictionary","description":"The Demio event (webinar) id. Search and select an upcoming event, or enter an id directly."}
   * @paramDef {"type":"Boolean","label":"Active Dates Only","name":"activeOnly","uiComponent":{"type":"CHECKBOX"},"description":"When true, returns only currently active (upcoming/not-yet-run) session dates for the event."}
   * @returns {Object}
   * @sampleResult {"id":123456,"name":"Product Onboarding Webinar","type":"future","dates":[{"date_id":789012,"status":"upcoming","timestamp":1785945600,"datetime":"2026-08-01 15:00:00","zone":"America/New_York"}]}
   */
  async getEvent(id, activeOnly) {
    const logTag = '[getEvent]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/event/${ encodeURIComponent(id) }`,
      method: 'get',
      query: {
        active: activeOnly === true ? 'true' : undefined,
      },
    })
  }

  /**
   * @operationName Get Event Session
   * @category Events
   * @description Retrieves details for a single scheduled session (date) of a webinar (event). Provide the event id and the session date_id. Returns that session's status, start date/time, timezone, and registration details. To discover the available date_id values for an event, call Get Event and read its "dates" array.
   * @route GET /event/{id}/date/{dateId}
   * @paramDef {"type":"String","label":"Event ID","name":"id","required":true,"dictionary":"getEventsDictionary","description":"The Demio event (webinar) id that the session belongs to."}
   * @paramDef {"type":"String","label":"Date ID","name":"dateId","required":true,"description":"The session date_id to retrieve. Get valid values from the \"dates\" array returned by Get Event."}
   * @returns {Object}
   * @sampleResult {"date_id":789012,"status":"upcoming","timestamp":1785945600,"datetime":"2026-08-01 15:00:00","zone":"America/New_York","registration_count":42}
   */
  async getEventSession(id, dateId) {
    const logTag = '[getEventSession]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/event/${ encodeURIComponent(id) }/date/${ encodeURIComponent(dateId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Register Participant
   * @category Registration
   * @description Registers a person for a Demio webinar. Provide the participant's name and email (both required). To target a specific event and session, pass the event id and the session date_id (get date_id values from the "dates" array of Get Event); alternatively pass the event's public registration ref URL. Optional fields — last name, company, website, phone number, GDPR consent, and arbitrary custom fields — are matched against your event's registration form. Returns the created registrant, typically including their unique join link.
   * @route PUT /event/register
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"First name (or full name) of the participant to register."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Email address of the participant. Their unique join link is sent here."}
   * @paramDef {"type":"String","label":"Event ID","name":"id","dictionary":"getEventsDictionary","description":"The Demio event (webinar) id to register for. Provide this (with Date ID) or a Registration Ref URL."}
   * @paramDef {"type":"String","label":"Date ID","name":"dateId","description":"The session date_id to register for. Get valid values from the \"dates\" array of Get Event."}
   * @paramDef {"type":"String","label":"Registration Ref URL","name":"refUrl","description":"The event's public registration ref URL. Use this as an alternative to Event ID + Date ID."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Optional last name of the participant."}
   * @paramDef {"type":"String","label":"Company","name":"company","description":"Optional company name of the participant."}
   * @paramDef {"type":"String","label":"Website","name":"website","description":"Optional website of the participant."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumber","description":"Optional phone number of the participant."}
   * @paramDef {"type":"Boolean","label":"GDPR Consent","name":"gdpr","uiComponent":{"type":"CHECKBOX"},"description":"Set to true to record the participant's GDPR consent. Required if your event enforces GDPR consent."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Optional key/value object of additional custom registration fields matching your event's registration form (e.g. {\"custom_field_role\":\"Manager\"})."}
   * @returns {Object}
   * @sampleResult {"id":345678,"event_id":123456,"date_id":789012,"name":"Jane Doe","email":"jane@example.com","join_link":"https://my.demio.com/ref/abcdef"}
   */
  async registerParticipant(name, email, id, dateId, refUrl, lastName, company, website, phoneNumber, gdpr, customFields) {
    const logTag = '[registerParticipant]'

    const body = clean({
      id,
      date_id: dateId,
      ref_url: refUrl,
      name,
      email,
      last_name: lastName,
      company,
      website,
      phone_number: phoneNumber,
      gdpr: gdpr === true ? 'true' : undefined,
    })

    if (customFields && typeof customFields === 'object') {
      Object.assign(body, customFields)
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/event/register`,
      method: 'put',
      body,
    })
  }

  /**
   * @operationName List Session Participants
   * @category Participants
   * @description Lists the participants (registrants and attendees) for a single webinar session, keyed by that session's date_id. Each participant includes their name, email, custom fields, attendance flag, and status. Optionally filter by status to return only, e.g., people who attended or did not attend. Discover a session's date_id from the "dates" array of Get Event. Use this for post-webinar reporting, syncing registrants, or checking attendance.
   * @route GET /report/{dateId}/participants
   * @paramDef {"type":"String","label":"Date ID","name":"dateId","required":true,"description":"The session date_id to report on. Get valid values from the \"dates\" array of Get Event."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Attended","Did Not Attend","Completed","Left Early","Banned"]}},"description":"Optional filter to return only participants with the given attendance status."}
   * @returns {Object}
   * @sampleResult {"participants":[{"name":"Jane Doe","email":"jane@example.com","custom_fields":[],"attended":true,"status":"attended"}]}
   */
  async listSessionParticipants(dateId, status) {
    const logTag = '[listSessionParticipants]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/report/${ encodeURIComponent(dateId) }/participants`,
      method: 'get',
      query: {
        status: this.#resolveChoice(status, {
          Attended: 'attended',
          'Did Not Attend': 'did not attend',
          Completed: 'completed',
          'Left Early': 'left early',
          Banned: 'banned',
        }),
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
   * @description Provides a searchable list of upcoming Demio webinars (events) for selecting an event in other operations. Each option's value is the event id expected by Get Event, Get Event Session, and Register Participant.
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
        const firstDate = Array.isArray(event.dates) && event.dates.length
          ? event.dates[0].datetime || event.dates[0].date
          : undefined

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
    hint: 'Your Demio Public API Key. Get it from Demio → Settings → Integrations → Public API. Sent as the Api-Key request header.',
  },
  {
    name: 'apiSecret',
    displayName: 'API Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Demio Public API Secret, shown alongside the API Key in Demio → Settings → Integrations → Public API. Sent as the Api-Secret request header.',
  },
])
