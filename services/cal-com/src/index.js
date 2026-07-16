// ============================================================================
//  SPEC: Cal.com   auth: api-key (Authorization: Bearer <apiKey>)
//  BASE: https://api.cal.com/v2
//  API VERSIONING: many v2 endpoints require a `cal-api-version` header carrying
//    a date value. Verified values used here:
//      - Bookings (list/get/create/cancel/reschedule/confirm/decline/mark-absent): 2024-08-13
//      - Event Types / Slots / Schedules / Me: 2024-06-14
//      - Webhooks: no cal-api-version header (own `version` field, default 2021-10-20)
//    #apiRequest accepts a per-call apiVersion so each endpoint sends the right one.
//  RESPONSE WRAPPER: v2 responses are { status, data }; #apiRequest unwraps `data`.
//  RESOURCES:
//    - Bookings      ops: list, get, create, cancel, reschedule, confirm, decline, mark-absent
//    - Event Types   ops: list, get, create, update, delete  (+ dictionary)
//    - Slots         ops: get available slots
//    - Schedules     ops: list, get  (+ dictionary)
//    - Me            ops: get current user (connection check)
//    - Webhooks      ops: create/delete (back the REALTIME trigger)
//  TRIGGERS: REALTIME (SINGLE_APP) — onCalEvent (booking/meeting webhooks)
// ============================================================================

// ============================================================================
//  CONSTANTS
// ============================================================================
const API_BASE = 'https://api.cal.com/v2'

// cal-api-version header values (date-stamped). Bookings and the general v2
// surface pin different stable versions; send the matching one per call.
const API_VERSION_BOOKINGS = '2024-08-13'
const API_VERSION_DEFAULT = '2024-06-14'

// Maps the friendly Event dropdown label (shown in the UI) to the Cal.com webhook
// trigger value sent to the API and matched against inbound deliveries.
const EVENT_LABEL_TO_VALUE = {
  'Booking Created': 'BOOKING_CREATED',
  'Booking Cancelled': 'BOOKING_CANCELLED',
  'Booking Rescheduled': 'BOOKING_RESCHEDULED',
  'Booking Requested': 'BOOKING_REQUESTED',
  'Booking Rejected': 'BOOKING_REJECTED',
  'Booking Paid': 'BOOKING_PAID',
  'Meeting Started': 'MEETING_STARTED',
  'Meeting Ended': 'MEETING_ENDED',
  'Recording Ready': 'RECORDING_READY',
  'Form Submitted': 'FORM_SUBMITTED',
}

const CALL_TYPES = {
  SHAPE_EVENT: 'SHAPE_EVENT',
  FILTER_TRIGGER: 'FILTER_TRIGGER',
}

const ERROR_HINTS = {
  401: 'Authentication failed — check the API key (Cal.com → Settings → Developer → API keys).',
  403: 'Access denied — the API key lacks permission for this resource.',
  404: 'Not found — the ID or slug may be wrong; use a list action or picker to choose a valid one.',
  422: 'Validation failed — check required fields (for bookings: eventTypeId, start, and attendee details).',
  429: 'Rate limit hit — retry in a moment.',
}

// ============================================================================
//  LOGGER
// ============================================================================
const logger = {
  info: (...args) => console.log('[Cal.com] info:', ...args),
  debug: (...args) => console.log('[Cal.com] debug:', ...args),
  error: (...args) => console.log('[Cal.com] error:', ...args),
  warn: (...args) => console.log('[Cal.com] warn:', ...args),
}

// ============================================================================
//  DICTIONARY PAYLOAD TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} getEventTypesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter event types by title."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getSchedulesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter schedules by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @integrationName Cal.com
 * @integrationIcon /icon.png
 * @integrationTriggersScope SINGLE_APP
 */
class CalCom {
  constructor(config) {
    this.config = config || {}
    this.apiKey = this.config.apiKey
  }

  // ==========================================================================
  //  CORE — every external call goes through #apiRequest
  // ==========================================================================
  // apiVersion: the cal-api-version header value for this endpoint. Pass null to
  // omit it (e.g. webhooks). Defaults to the general v2 surface version.
  async #apiRequest({ url, method = 'get', body, query, apiVersion = API_VERSION_DEFAULT, logTag }) {
    try {
      logger.debug(`${ logTag } ${ method.toUpperCase() } ${ url }`)

      const headers = {
        'Authorization': `Bearer ${ this.apiKey }`,
        'Content-Type': 'application/json',
      }

      if (apiVersion) {
        headers['cal-api-version'] = apiVersion
      }

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set(headers)
        .query(query || {})

      const response = body !== undefined ? await request.send(body) : await request

      // v2 wraps successful responses as { status, data } — unwrap data.
      return response && Object.prototype.hasOwnProperty.call(response, 'data') ? response.data : response
    } catch (error) {
      this.#handleError(error, logTag)
    }
  }

  #handleError(error, logTag) {
    const status = error?.status || error?.statusCode || error?.body?.status
    // Cal.com v2 errors nest the message under body.error.message.
    const apiMessage =
      error?.body?.error?.message ||
      error?.body?.message ||
      error?.message ||
      'Request failed'
    const hint = ERROR_HINTS[status]

    logger.error(`${ logTag } failed: ${ apiMessage }`)

    throw new Error(hint ? `Cal.com API error: ${ hint } (${ apiMessage })` : `Cal.com API error: ${ apiMessage }`)
  }

  // Maps a friendly dropdown label to its Cal.com API value. Unmapped values
  // (and identity dropdowns) pass through unchanged.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Drops undefined/null/'' entries so optional params never overwrite defaults.
  #compact(object) {
    const result = {}

    for (const [key, value] of Object.entries(object)) {
      if (value !== undefined && value !== null && value !== '') {
        result[key] = value
      }
    }

    return result
  }

  // ==========================================================================
  //  BOOKINGS
  // ==========================================================================
  /**
   * @operationName List Bookings
   * @category Bookings
   * @description Lists bookings for the connected Cal.com account with optional filters by status, attendee email, event type, and date range. Supports paging via take and skip. Use this to find bookings and their UIDs for follow-up actions.
   * @route GET /bookings
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Upcoming","Recurring","Past","Cancelled","Unconfirmed"]}},"description":"Filter bookings by status. Leave blank for all."}
   * @paramDef {"type":"String","label":"Attendee Email","name":"attendeeEmail","description":"Only return bookings that include this attendee email address."}
   * @paramDef {"type":"Number","label":"Event Type ID","name":"eventTypeId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Only return bookings for this event type."}
   * @paramDef {"type":"String","label":"Date From","name":"dateFrom","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return bookings starting on or after this date/time (ISO 8601)."}
   * @paramDef {"type":"String","label":"Date To","name":"dateTo","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return bookings starting on or before this date/time (ISO 8601)."}
   * @paramDef {"type":"Number","label":"Limit","name":"take","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":100,"description":"Max bookings to return per page (default 100)."}
   * @paramDef {"type":"Number","label":"Offset","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":0,"description":"Number of bookings to skip, for paging."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":123,"uid":"booking_abc123","title":"30 Min Meeting between Alice and Bob","status":"accepted","start":"2024-08-13T09:00:00.000Z","end":"2024-08-13T09:30:00.000Z","eventTypeId":456,"attendees":[{"name":"Bob","email":"bob@example.com","timeZone":"America/New_York"}]}]
   */
  async listBookings(status, attendeeEmail, eventTypeId, dateFrom, dateTo, take, skip) {
    // docs: https://cal.com/docs/api-reference/v2/bookings/get-all-bookings
    const query = this.#compact({
      status: this.#resolveChoice(status, {
        Upcoming: 'upcoming',
        Recurring: 'recurring',
        Past: 'past',
        Cancelled: 'cancelled',
        Unconfirmed: 'unconfirmed',
      }),
      attendeeEmail,
      eventTypeId,
      afterStart: dateFrom,
      beforeEnd: dateTo,
      take: take || 100,
      skip: skip || 0,
    })

    return await this.#apiRequest({
      url: `${ API_BASE }/bookings`,
      query,
      apiVersion: API_VERSION_BOOKINGS,
      logTag: 'listBookings',
    })
  }

  /**
   * @operationName Get Booking
   * @category Bookings
   * @description Retrieves a single booking by its UID, returning its status, times, event type, attendees, location, and metadata. Use this to inspect a booking before cancelling, rescheduling, or confirming it.
   * @route GET /bookings/{uid}
   * @paramDef {"type":"String","label":"Booking UID","name":"uid","required":true,"description":"The unique identifier (uid) of the booking, e.g. from List Bookings or a webhook payload."}
   * @returns {Object}
   * @sampleResult {"id":123,"uid":"booking_abc123","title":"30 Min Meeting","status":"accepted","start":"2024-08-13T09:00:00.000Z","end":"2024-08-13T09:30:00.000Z","eventTypeId":456,"attendees":[{"name":"Bob","email":"bob@example.com","timeZone":"America/New_York"}],"location":"integrations:daily","metadata":{}}
   */
  async getBooking(uid) {
    // docs: https://cal.com/docs/api-reference/v2/bookings/get-a-booking
    return await this.#apiRequest({
      url: `${ API_BASE }/bookings/${ uid }`,
      apiVersion: API_VERSION_BOOKINGS,
      logTag: 'getBooking',
    })
  }

  /**
   * @operationName Create Booking
   * @category Bookings
   * @description Creates a new booking for an event type at a specific start time on behalf of an attendee. The attendee's name, email, and time zone are required. Use Get Available Slots first to find a valid start time. Optionally pass custom booking-field responses, guests, a location, and metadata.
   * @route POST /bookings
   * @paramDef {"type":"Number","label":"Event Type ID","name":"eventTypeId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getEventTypesDictionary","description":"The event type to book. Pick one from the event type list."}
   * @paramDef {"type":"String","label":"Start","name":"start","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Booking start time in ISO 8601 UTC, e.g. 2024-08-13T09:00:00Z. Must be an available slot."}
   * @paramDef {"type":"String","label":"Attendee Name","name":"attendeeName","required":true,"description":"Full name of the person booking."}
   * @paramDef {"type":"String","label":"Attendee Email","name":"attendeeEmail","required":true,"description":"Email address of the person booking."}
   * @paramDef {"type":"String","label":"Attendee Time Zone","name":"attendeeTimeZone","required":true,"description":"IANA time zone of the attendee, e.g. America/New_York."}
   * @paramDef {"type":"String","label":"Attendee Language","name":"attendeeLanguage","description":"Two-letter language code for attendee notifications, e.g. en, es. Defaults to English."}
   * @paramDef {"type":"String","label":"Phone Number","name":"attendeePhoneNumber","description":"Attendee phone number in international format (required if the event has SMS reminders)."}
   * @paramDef {"type":"Array<String>","label":"Guests","name":"guests","description":"Additional guest email addresses to add to the booking. Accepts a list."}
   * @paramDef {"type":"String","label":"Location","name":"location","description":"Meeting location or integration identifier, e.g. integrations:daily or a custom address."}
   * @paramDef {"type":"Object","label":"Booking Field Responses","name":"bookingFieldsResponses","description":"Answers to the event type's custom booking fields as a key-value object."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","description":"Custom key-value metadata to attach to the booking (up to 50 keys)."}
   * @returns {Object}
   * @sampleResult {"id":123,"uid":"booking_abc123","title":"30 Min Meeting between Host and Bob","status":"accepted","start":"2024-08-13T09:00:00.000Z","end":"2024-08-13T09:30:00.000Z","eventTypeId":456,"attendees":[{"name":"Bob","email":"bob@example.com","timeZone":"America/New_York","language":"en"}]}
   */
  async createBooking(eventTypeId, start, attendeeName, attendeeEmail, attendeeTimeZone, attendeeLanguage, attendeePhoneNumber, guests, location, bookingFieldsResponses, metadata) {
    // docs: https://cal.com/docs/api-reference/v2/bookings/create-a-booking
    const body = this.#compact({
      eventTypeId,
      start,
      attendee: this.#compact({
        name: attendeeName,
        email: attendeeEmail,
        timeZone: attendeeTimeZone,
        language: attendeeLanguage,
        phoneNumber: attendeePhoneNumber,
      }),
      guests: Array.isArray(guests) && guests.length ? guests : undefined,
      location,
      bookingFieldsResponses,
      metadata,
    })

    return await this.#apiRequest({
      url: `${ API_BASE }/bookings`,
      method: 'post',
      body,
      apiVersion: API_VERSION_BOOKINGS,
      logTag: 'createBooking',
    })
  }

  /**
   * @operationName Cancel Booking
   * @category Bookings
   * @description Cancels an existing booking by its UID, with an optional reason recorded on the cancellation. Notifies attendees per the event type's settings. This cannot be undone; create a new booking to rebook.
   * @route POST /bookings/{uid}/cancel
   * @paramDef {"type":"String","label":"Booking UID","name":"uid","required":true,"description":"The uid of the booking to cancel."}
   * @paramDef {"type":"String","label":"Cancellation Reason","name":"cancellationReason","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional reason for the cancellation, shown to attendees."}
   * @returns {Object}
   * @sampleResult {"id":123,"uid":"booking_abc123","status":"cancelled","cancellationReason":"Attendee unavailable","start":"2024-08-13T09:00:00.000Z"}
   */
  async cancelBooking(uid, cancellationReason) {
    // docs: https://cal.com/docs/api-reference/v2/bookings/cancel-a-booking
    return await this.#apiRequest({
      url: `${ API_BASE }/bookings/${ uid }/cancel`,
      method: 'post',
      body: this.#compact({ cancellationReason }),
      apiVersion: API_VERSION_BOOKINGS,
      logTag: 'cancelBooking',
    })
  }

  /**
   * @operationName Reschedule Booking
   * @category Bookings
   * @description Reschedules a booking to a new start time, cancelling the original and creating a linked replacement. Returns the new booking. Use Get Available Slots to pick a valid new start time.
   * @route POST /bookings/{uid}/reschedule
   * @paramDef {"type":"String","label":"Booking UID","name":"uid","required":true,"description":"The uid of the booking to reschedule."}
   * @paramDef {"type":"String","label":"New Start","name":"start","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"New start time in ISO 8601 UTC, e.g. 2024-08-14T10:00:00Z. Must be an available slot."}
   * @paramDef {"type":"String","label":"Reschedule Reason","name":"reschedulingReason","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional reason for rescheduling, shown to attendees."}
   * @returns {Object}
   * @sampleResult {"id":124,"uid":"booking_def456","status":"accepted","start":"2024-08-14T10:00:00.000Z","end":"2024-08-14T10:30:00.000Z","rescheduledFromUid":"booking_abc123"}
   */
  async rescheduleBooking(uid, start, reschedulingReason) {
    // docs: https://cal.com/docs/api-reference/v2/bookings/reschedule-a-booking
    return await this.#apiRequest({
      url: `${ API_BASE }/bookings/${ uid }/reschedule`,
      method: 'post',
      body: this.#compact({ start, reschedulingReason }),
      apiVersion: API_VERSION_BOOKINGS,
      logTag: 'rescheduleBooking',
    })
  }

  /**
   * @operationName Confirm Booking
   * @category Bookings
   * @description Confirms a booking that is awaiting the host's approval (an event type that requires confirmation). The booking moves from unconfirmed/requested to accepted and attendees are notified.
   * @route POST /bookings/{uid}/confirm
   * @paramDef {"type":"String","label":"Booking UID","name":"uid","required":true,"description":"The uid of the unconfirmed booking to confirm."}
   * @returns {Object}
   * @sampleResult {"id":123,"uid":"booking_abc123","status":"accepted","start":"2024-08-13T09:00:00.000Z"}
   */
  async confirmBooking(uid) {
    // docs: https://cal.com/docs/api-reference/v2/bookings/confirm-a-booking
    return await this.#apiRequest({
      url: `${ API_BASE }/bookings/${ uid }/confirm`,
      method: 'post',
      body: {},
      apiVersion: API_VERSION_BOOKINGS,
      logTag: 'confirmBooking',
    })
  }

  /**
   * @operationName Decline Booking
   * @category Bookings
   * @description Declines a booking that is awaiting the host's approval, with an optional reason. The booking is rejected and attendees are notified. Use this for event types that require confirmation.
   * @route POST /bookings/{uid}/decline
   * @paramDef {"type":"String","label":"Booking UID","name":"uid","required":true,"description":"The uid of the unconfirmed booking to decline."}
   * @paramDef {"type":"String","label":"Reason","name":"reason","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional reason for declining, shown to attendees."}
   * @returns {Object}
   * @sampleResult {"id":123,"uid":"booking_abc123","status":"rejected","rejectionReason":"Not available"}
   */
  async declineBooking(uid, reason) {
    // docs: https://cal.com/docs/api-reference/v2/bookings/decline-a-booking
    return await this.#apiRequest({
      url: `${ API_BASE }/bookings/${ uid }/decline`,
      method: 'post',
      body: this.#compact({ reason }),
      apiVersion: API_VERSION_BOOKINGS,
      logTag: 'declineBooking',
    })
  }

  /**
   * @operationName Mark Absent
   * @category Bookings
   * @description Marks the host and/or specific attendees of a booking as no-shows (absent). Use this after a meeting to record who did not attend. Turn on Host Absent to mark the host, and list attendee emails to mark them absent.
   * @route POST /bookings/{uid}/mark-absent
   * @paramDef {"type":"String","label":"Booking UID","name":"uid","required":true,"description":"The uid of the booking to update."}
   * @paramDef {"type":"Boolean","label":"Host Absent","name":"hostAbsent","uiComponent":{"type":"TOGGLE"},"defaultValue":false,"description":"Turn on to mark the host as a no-show."}
   * @paramDef {"type":"Array<String>","label":"Absent Attendee Emails","name":"attendeeEmails","description":"Email addresses of attendees to mark as no-shows. Accepts a list."}
   * @returns {Object}
   * @sampleResult {"id":123,"uid":"booking_abc123","absentHost":true,"attendees":[{"email":"bob@example.com","absent":true}]}
   */
  async markAbsent(uid, hostAbsent, attendeeEmails) {
    // docs: https://cal.com/docs/api-reference/v2/bookings/mark-a-booking-absence
    const body = {}

    if (hostAbsent !== undefined && hostAbsent !== null) {
      body.host = Boolean(hostAbsent)
    }

    if (Array.isArray(attendeeEmails) && attendeeEmails.length) {
      body.attendees = attendeeEmails.map(email => ({ email, absent: true }))
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/bookings/${ uid }/mark-absent`,
      method: 'post',
      body,
      apiVersion: API_VERSION_BOOKINGS,
      logTag: 'markAbsent',
    })
  }

  // ==========================================================================
  //  EVENT TYPES
  // ==========================================================================
  /**
   * @operationName List Event Types
   * @category Event Types
   * @description Lists the event types available for a Cal.com user, optionally filtered by username and event slug. Event types define bookable meeting configurations (length, availability, location). Use this to discover event type IDs for creating bookings.
   * @route GET /event-types
   * @paramDef {"type":"String","label":"Username","name":"username","description":"Filter to a specific user's event types by their Cal.com username. Leave blank for the connected account."}
   * @paramDef {"type":"String","label":"Event Slug","name":"eventSlug","description":"Filter to a single event type by its slug (requires username)."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":456,"title":"30 Min Meeting","slug":"30min","lengthInMinutes":30,"description":"A quick chat","hidden":false,"locations":[{"type":"integrations:daily"}]}]
   */
  async listEventTypes(username, eventSlug) {
    // docs: https://cal.com/docs/api-reference/v2/event-types/get-all-event-types
    return await this.#apiRequest({
      url: `${ API_BASE }/event-types`,
      query: this.#compact({ username, eventSlug }),
      logTag: 'listEventTypes',
    })
  }

  /**
   * @operationName Get Event Type
   * @category Event Types
   * @description Retrieves a single event type by its ID, returning its title, slug, length, description, locations, availability schedule, and booking fields. Use this to inspect an event type before booking or updating it.
   * @route GET /event-types/{eventTypeId}
   * @paramDef {"type":"Number","label":"Event Type","name":"eventTypeId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getEventTypesDictionary","description":"The event type to fetch. Pick from the event type list."}
   * @returns {Object}
   * @sampleResult {"id":456,"title":"30 Min Meeting","slug":"30min","lengthInMinutes":30,"description":"A quick chat","hidden":false,"locations":[{"type":"integrations:daily"}],"bookingFields":[]}
   */
  async getEventType(eventTypeId) {
    // docs: https://cal.com/docs/api-reference/v2/event-types/get-an-event-type
    return await this.#apiRequest({
      url: `${ API_BASE }/event-types/${ eventTypeId }`,
      logTag: 'getEventType',
    })
  }

  /**
   * @operationName Create Event Type
   * @category Event Types
   * @description Creates a new event type for the connected account with a title, URL slug, and length in minutes. Optionally set a description, hide it from the public page, and add locations. The event type becomes bookable once created.
   * @route POST /event-types
   * @paramDef {"type":"Number","label":"Length (Minutes)","name":"lengthInMinutes","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":30,"description":"Duration of the meeting in minutes."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Display name of the event type, e.g. 30 Min Meeting."}
   * @paramDef {"type":"String","label":"Slug","name":"slug","required":true,"description":"URL slug for the booking page, e.g. 30min. Must be unique for the user."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description shown on the booking page."}
   * @paramDef {"type":"Boolean","label":"Hidden","name":"hidden","uiComponent":{"type":"TOGGLE"},"defaultValue":false,"description":"Turn on to hide this event type from the public booking page."}
   * @returns {Object}
   * @sampleResult {"id":789,"title":"30 Min Meeting","slug":"30min","lengthInMinutes":30,"description":"A quick chat","hidden":false}
   */
  async createEventType(lengthInMinutes, title, slug, description, hidden) {
    // docs: https://cal.com/docs/api-reference/v2/event-types/create-an-event-type
    const body = this.#compact({ lengthInMinutes, title, slug, description })

    if (hidden !== undefined && hidden !== null) {
      body.hidden = Boolean(hidden)
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/event-types`,
      method: 'post',
      body,
      logTag: 'createEventType',
    })
  }

  /**
   * @operationName Update Event Type
   * @category Event Types
   * @description Updates an existing event type's title, slug, length, description, or hidden state. Only the fields you provide are changed; leave a field blank to keep its current value.
   * @route PATCH /event-types/{eventTypeId}
   * @paramDef {"type":"Number","label":"Event Type","name":"eventTypeId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getEventTypesDictionary","description":"The event type to update."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New display name. Leave blank to keep the current title."}
   * @paramDef {"type":"String","label":"Slug","name":"slug","description":"New URL slug. Leave blank to keep the current slug."}
   * @paramDef {"type":"Number","label":"Length (Minutes)","name":"lengthInMinutes","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New meeting duration in minutes. Leave blank to keep current."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description. Leave blank to keep current."}
   * @paramDef {"type":"Boolean","label":"Hidden","name":"hidden","uiComponent":{"type":"TOGGLE"},"description":"Turn on to hide, off to show, on the public booking page."}
   * @returns {Object}
   * @sampleResult {"id":456,"title":"Updated Meeting","slug":"updated","lengthInMinutes":45,"hidden":false}
   */
  async updateEventType(eventTypeId, title, slug, lengthInMinutes, description, hidden) {
    // docs: https://cal.com/docs/api-reference/v2/event-types/update-an-event-type
    const body = this.#compact({ title, slug, lengthInMinutes, description })

    if (hidden !== undefined && hidden !== null) {
      body.hidden = Boolean(hidden)
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/event-types/${ eventTypeId }`,
      method: 'patch',
      body,
      logTag: 'updateEventType',
    })
  }

  /**
   * @operationName Delete Event Type
   * @category Event Types
   * @description Permanently deletes an event type by its ID. Existing bookings for the event type are not removed, but no new bookings can be made against it. This cannot be undone.
   * @route DELETE /event-types/{eventTypeId}
   * @paramDef {"type":"Number","label":"Event Type","name":"eventTypeId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getEventTypesDictionary","description":"The event type to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"eventTypeId":456}
   */
  async deleteEventType(eventTypeId) {
    // docs: https://cal.com/docs/api-reference/v2/event-types/delete-an-event-type
    await this.#apiRequest({
      url: `${ API_BASE }/event-types/${ eventTypeId }`,
      method: 'delete',
      logTag: 'deleteEventType',
    })

    return { deleted: true, eventTypeId }
  }

  // ==========================================================================
  //  AVAILABILITY / SLOTS
  // ==========================================================================
  /**
   * @operationName Get Available Slots
   * @category Availability
   * @description Returns the available time slots for an event type within a date range, honoring the host's availability and existing bookings. Use the returned start times to create or reschedule a booking. Optionally set the time zone the slots are expressed in.
   * @route GET /slots
   * @paramDef {"type":"Number","label":"Event Type ID","name":"eventTypeId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getEventTypesDictionary","description":"The event type to find open slots for."}
   * @paramDef {"type":"String","label":"Start","name":"start","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start of the search range in ISO 8601, e.g. 2024-08-13 or 2024-08-13T00:00:00Z."}
   * @paramDef {"type":"String","label":"End","name":"end","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"End of the search range in ISO 8601, e.g. 2024-08-20."}
   * @paramDef {"type":"String","label":"Time Zone","name":"timeZone","description":"IANA time zone to express the slots in, e.g. America/New_York. Defaults to UTC."}
   * @returns {Object}
   * @sampleResult {"2024-08-13":[{"start":"2024-08-13T09:00:00.000Z"},{"start":"2024-08-13T09:30:00.000Z"}],"2024-08-14":[{"start":"2024-08-14T10:00:00.000Z"}]}
   */
  async getAvailableSlots(eventTypeId, start, end, timeZone) {
    // docs: https://cal.com/docs/api-reference/v2/slots/get-available-slots
    return await this.#apiRequest({
      url: `${ API_BASE }/slots`,
      query: this.#compact({ eventTypeId, start, end, timeZone }),
      logTag: 'getAvailableSlots',
    })
  }

  // ==========================================================================
  //  SCHEDULES
  // ==========================================================================
  /**
   * @operationName List Schedules
   * @category Schedules
   * @description Lists the availability schedules for the connected Cal.com account. Schedules define working hours and time zones that event types reference. Use this to find schedule IDs.
   * @route GET /schedules
   * @returns {Array<Object>}
   * @sampleResult [{"id":111,"name":"Working Hours","timeZone":"America/New_York","isDefault":true,"availability":[{"days":["Monday","Tuesday"],"startTime":"09:00","endTime":"17:00"}]}]
   */
  async listSchedules() {
    // docs: https://cal.com/docs/api-reference/v2/schedules/get-all-schedules
    return await this.#apiRequest({
      url: `${ API_BASE }/schedules`,
      logTag: 'listSchedules',
    })
  }

  /**
   * @operationName Get Schedule
   * @category Schedules
   * @description Retrieves a single availability schedule by its ID, returning its name, time zone, default flag, and per-day working hours. Use this to inspect the availability an event type uses.
   * @route GET /schedules/{scheduleId}
   * @paramDef {"type":"Number","label":"Schedule","name":"scheduleId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getSchedulesDictionary","description":"The schedule to fetch. Pick from the schedule list."}
   * @returns {Object}
   * @sampleResult {"id":111,"name":"Working Hours","timeZone":"America/New_York","isDefault":true,"availability":[{"days":["Monday","Tuesday","Wednesday","Thursday","Friday"],"startTime":"09:00","endTime":"17:00"}]}
   */
  async getSchedule(scheduleId) {
    // docs: https://cal.com/docs/api-reference/v2/schedules/get-a-schedule
    return await this.#apiRequest({
      url: `${ API_BASE }/schedules/${ scheduleId }`,
      logTag: 'getSchedule',
    })
  }

  // ==========================================================================
  //  ME
  // ==========================================================================
  /**
   * @operationName Get My Profile
   * @category Account
   * @description Retrieves the profile of the Cal.com user the API key belongs to — username, email, name, time zone, and default schedule. Use this to verify the connection and read the account's default settings.
   * @route GET /me
   * @returns {Object}
   * @sampleResult {"id":100,"username":"alice","email":"alice@example.com","timeFormat":12,"defaultScheduleId":111,"weekStart":"Sunday","timeZone":"America/New_York","name":"Alice"}
   */
  async getMyProfile() {
    // docs: https://cal.com/docs/api-reference/v2/me/get-my-profile
    return await this.#apiRequest({
      url: `${ API_BASE }/me`,
      logTag: 'getMyProfile',
    })
  }

  // ==========================================================================
  //  REALTIME TRIGGER (SINGLE_APP — one webhook per trigger)
  // ==========================================================================
  /**
   * @operationName On Cal.com Event
   * @category Triggers
   * @description Fires when the chosen Cal.com event occurs — a booking is created, cancelled, rescheduled, requested, rejected, paid, or a meeting starts/ends. Cal.com registers a webhook for the selected event and this trigger runs your flow when the event is delivered, passing the full booking payload.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-cal-event
   * @paramDef {"type":"String","label":"Event","name":"event","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Booking Created","Booking Cancelled","Booking Rescheduled","Booking Requested","Booking Rejected","Booking Paid","Meeting Started","Meeting Ended","Recording Ready","Form Submitted"]}},"description":"Which Cal.com event fires this trigger."}
   * @returns {Object}
   * @sampleResult {"triggerEvent":"BOOKING_CREATED","bookingUid":"booking_abc123","bookingId":123,"title":"30 Min Meeting between Host and Bob","status":"ACCEPTED","startTime":"2024-08-13T09:00:00.000Z","endTime":"2024-08-13T09:30:00.000Z","eventTypeId":456,"attendees":[{"name":"Bob","email":"bob@example.com","timeZone":"America/New_York"}],"organizer":{"name":"Host","email":"host@example.com"},"createdAt":"2024-08-01T12:00:00.000Z"}
   */
  onCalEvent(callType, payload) {
    if (callType === CALL_TYPES.SHAPE_EVENT) {
      return [{ name: 'onCalEvent', data: this.#shapeCalEvent(payload) }]
    }

    if (callType === CALL_TYPES.FILTER_TRIGGER) {
      return {
        ids: this.#matchTriggers(payload, (trigger, event) =>
          this.#resolveChoice(trigger.data.event, EVENT_LABEL_TO_VALUE) === event.triggerEvent),
      }
    }
  }

  // ── Trigger event shaping ──────────────────────────────────────────────
  // Cal.com delivers { triggerEvent, createdAt, payload } where payload carries
  // the booking. Flatten the most useful fields to the top level.
  #shapeCalEvent(body) {
    const inner = body?.payload || {}

    return {
      triggerEvent: body?.triggerEvent,
      bookingUid: inner.uid,
      bookingId: inner.bookingId || inner.id,
      title: inner.title,
      status: inner.status,
      startTime: inner.startTime,
      endTime: inner.endTime,
      eventTypeId: inner.eventTypeId || inner.type?.id,
      attendees: inner.attendees,
      organizer: inner.organizer,
      location: inner.location,
      metadata: inner.metadata,
      createdAt: body?.createdAt,
      payload: inner,
    }
  }

  // The FILTER_TRIGGER payload carries the shaped eventData (under .data) plus the
  // registered triggers. Match each trigger whose selected event equals the delivery's.
  #matchTriggers(payload, predicate) {
    const eventData = payload.eventData || payload.data || {}
    const event = { triggerEvent: eventData.triggerEvent }

    return (payload.triggers || [])
      .filter(trigger => predicate(trigger, event))
      .map(trigger => trigger.id)
  }

  // ── SYSTEM trigger handlers (SINGLE_APP) ───────────────────────────────
  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerUpsertWebhook
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    logger.debug(`handleTriggerUpsertWebhook.invocation: ${ JSON.stringify(invocation) }`)

    const address = `${ invocation.callbackUrl }${ invocation.callbackUrl.includes('?') ? '&' : '?' }connectionId=${ invocation.connectionId }`
    const webhooks = []

    for (const event of invocation.events || []) {
      const data = event.triggerData || {}
      const resolvedEvent = this.#resolveChoice(data.event, EVENT_LABEL_TO_VALUE)

      // Webhooks use their own version field, not the cal-api-version header.
      const created = await this.#apiRequest({
        url: `${ API_BASE }/webhooks`,
        method: 'post',
        body: {
          subscriberUrl: address,
          triggers: [resolvedEvent],
          active: true,
        },
        apiVersion: null,
        logTag: 'createWebhook',
      })

      webhooks.push({ triggerId: event.id, webhookId: created?.id, event: resolvedEvent })
    }

    return { webhookData: { webhooks }, connectionId: invocation.connectionId }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerResolveEvents
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    logger.debug('handleTriggerResolveEvents invoked')

    // Cal.com webhook setup performs no handshake, but guard the empty-body case.
    if (!invocation || !invocation.body) {
      return { handshake: true, responseToExternalService: invocation?.body || {} }
    }

    if (!invocation.body.triggerEvent) {
      return { connectionId: invocation.queryParams?.connectionId, events: [] }
    }

    const events = this.onCalEvent(CALL_TYPES.SHAPE_EVENT, invocation.body)

    return { connectionId: invocation.queryParams?.connectionId, events }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerSelectMatched
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    logger.debug(`handleTriggerSelectMatched.${ invocation.eventName }`)

    return this[invocation.eventName](CALL_TYPES.FILTER_TRIGGER, invocation)
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerDeleteWebhook
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerDeleteWebhook(invocation) {
    logger.debug('handleTriggerDeleteWebhook invoked')

    const webhooks = invocation.webhookData?.webhooks || []

    for (const webhook of webhooks) {
      if (!webhook.webhookId) {
        continue
      }

      try {
        await this.#apiRequest({
          url: `${ API_BASE }/webhooks/${ webhook.webhookId }`,
          method: 'delete',
          apiVersion: null,
          logTag: 'deleteWebhook',
        })
      } catch (error) {
        logger.warn(`handleTriggerDeleteWebhook: failed to delete webhook ${ webhook.webhookId }: ${ error?.message }`)
      }
    }

    return { webhookData: {} }
  }

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================
  /**
   * @registerAs DICTIONARY
   * @operationName Get Event Types Dictionary
   * @description Provides a searchable list of the account's event types for dropdown selection in booking and slot actions.
   * @route POST /get-event-types-dictionary
   * @paramDef {"type":"getEventTypesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"30 Min Meeting","value":"456","note":"30 min • slug: 30min"}],"cursor":null}
   */
  async getEventTypesDictionary(payload) {
    const { search } = payload || {}
    const result = await this.listEventTypes()
    const entries = Array.isArray(result) ? result : (result?.eventTypes || [])
    const term = (search || '').toLowerCase()

    const items = entries
      .map(eventType => ({
        label: eventType.title,
        value: String(eventType.id),
        note: `${ eventType.lengthInMinutes || eventType.length || '?' } min • slug: ${ eventType.slug }`,
      }))
      .filter(item => !term || item.label.toLowerCase().includes(term))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Schedules Dictionary
   * @description Provides a searchable list of the account's availability schedules for dropdown selection.
   * @route POST /get-schedules-dictionary
   * @paramDef {"type":"getSchedulesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Working Hours","value":"111","note":"America/New_York (default)"}],"cursor":null}
   */
  async getSchedulesDictionary(payload) {
    const { search } = payload || {}
    const result = await this.listSchedules()
    const entries = Array.isArray(result) ? result : (result?.schedules || [])
    const term = (search || '').toLowerCase()

    const items = entries
      .map(schedule => ({
        label: schedule.name,
        value: String(schedule.id),
        note: `${ schedule.timeZone || 'no time zone' }${ schedule.isDefault ? ' (default)' : '' }`,
      }))
      .filter(item => !term || item.label.toLowerCase().includes(term))

    return { items, cursor: null }
  }
}

Flowrunner.ServerCode.addService(CalCom, [
  {
    name: 'apiKey',
    shared: false,
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Your Cal.com API key (starts with cal_). Generate it at Cal.com → Settings → Developer → API keys.',
  },
])
