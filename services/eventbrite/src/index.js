const logger = {
  info: (...args) => console.log('[Eventbrite] info:', ...args),
  debug: (...args) => console.log('[Eventbrite] debug:', ...args),
  error: (...args) => console.log('[Eventbrite] error:', ...args),
  warn: (...args) => console.log('[Eventbrite] warn:', ...args),
}

const API_BASE_URL = 'https://www.eventbriteapi.com/v3'

const EVENT_STATUS_MAP = {
  Draft: 'draft',
  Live: 'live',
  Started: 'started',
  Ended: 'ended',
  Completed: 'completed',
  Canceled: 'canceled',
}

const ATTENDEE_STATUS_MAP = {
  Attending: 'attending',
  'Not Attending': 'not_attending',
  Unpaid: 'unpaid',
}

const ORDER_STATUS_MAP = {
  Placed: 'placed',
  Refunded: 'refunded',
  'Transferred From': 'transferred_from',
  'Transferred To': 'transferred_to',
}

function clean(obj) {
  if (!obj || typeof obj !== 'object') {
    return obj
  }

  const result = {}

  for (const key in obj) {
    const value = obj[key]

    if (value === undefined || value === null || value === '') {
      continue
    }

    if (typeof value === 'object' && !Array.isArray(value)) {
      const nested = clean(value)

      if (Object.keys(nested).length > 0) {
        result[key] = nested
      }
    } else {
      result[key] = value
    }
  }

  return result
}

/**
 * @integrationName Eventbrite
 * @integrationIcon /icon.png
 */
class EventbriteService {
  constructor(config) {
    this.privateToken = config.privateToken
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.privateToken }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const body = error.body || {}
      const message = body.error_description || body.error || error.message

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Eventbrite API error: ${ message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /* ==========================================================================
   * Events
   * ======================================================================== */

  /**
   * @operationName List Events
   * @category Events
   * @description Lists events belonging to an organization. Supports filtering by lifecycle status (draft, live, started, ended, completed, canceled), a time window (past, current_future, all), and result ordering. Results are paginated; pass the returned continuation token to fetch the next page. Requires an organization ID (use Get Organizations to look one up).
   * @route GET /organizations/events
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"getOrganizationsDictionary","description":"ID of the organization whose events to list. Search and select, or enter an organization ID directly."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Live","Started","Ended","Completed","Canceled"]}},"description":"Only return events in this lifecycle status. Leave empty to return all statuses."}
   * @paramDef {"type":"String","label":"Time Filter","name":"timeFilter","uiComponent":{"type":"DROPDOWN","options":{"values":["Past","Current & Future","All"]}},"description":"Restrict events by time relative to now. Defaults to all events."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Start Ascending","Start Descending","Created Ascending","Created Descending"]}},"description":"Sort order for the returned events. Defaults to start ascending."}
   * @paramDef {"type":"String","label":"Continuation","name":"continuation","description":"Continuation token from a previous response's pagination object to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"pagination":{"object_count":42,"page_number":1,"page_size":50,"page_count":1,"continuation":"eyJwYWdlIjogMn0","has_more_items":false},"events":[{"id":"1234567890","name":{"text":"Launch Party","html":"Launch Party"},"start":{"timezone":"America/New_York","local":"2026-09-01T18:00:00","utc":"2026-09-01T22:00:00Z"},"status":"live","currency":"USD","online_event":false}]}
   */
  async listEvents(organizationId, status, timeFilter, orderBy, continuation) {
    const logTag = '[listEvents]'

    return this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/organizations/${ organizationId }/events/`,
      method: 'get',
      query: {
        status: this.#resolveChoice(status, EVENT_STATUS_MAP),
        time_filter: this.#resolveChoice(timeFilter, {
          'Past': 'past',
          'Current & Future': 'current_future',
          'All': 'all',
        }),
        order_by: this.#resolveChoice(orderBy, {
          'Start Ascending': 'start_asc',
          'Start Descending': 'start_desc',
          'Created Ascending': 'created_asc',
          'Created Descending': 'created_desc',
        }),
        continuation,
      },
    })
  }

  /**
   * @operationName Get Event
   * @category Events
   * @description Retrieves a single event by ID. Optionally expands related sub-objects (venue and ticket_availability) inline so you do not need separate calls to read the event's venue details or ticket availability summary.
   * @route GET /events/get
   *
   * @paramDef {"type":"String","label":"Event ID","name":"eventId","required":true,"dictionary":"getEventsDictionary","description":"ID of the event to retrieve. Search and select an event, or enter an event ID directly."}
   * @paramDef {"type":"Array<String>","label":"Expand","name":"expand","uiComponent":{"type":"DROPDOWN","options":{"values":["venue","ticket_availability"]}},"description":"Related objects to embed in the response. Choose venue and/or ticket_availability."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1234567890","name":{"text":"Launch Party","html":"Launch Party"},"description":{"text":"Join us","html":"<p>Join us</p>"},"start":{"timezone":"America/New_York","local":"2026-09-01T18:00:00","utc":"2026-09-01T22:00:00Z"},"end":{"timezone":"America/New_York","local":"2026-09-01T21:00:00","utc":"2026-09-02T01:00:00Z"},"currency":"USD","online_event":false,"status":"live","url":"https://www.eventbrite.com/e/1234567890"}
   */
  async getEvent(eventId, expand) {
    const logTag = '[getEvent]'
    const expandList = Array.isArray(expand) ? expand.filter(Boolean) : []

    return this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/events/${ eventId }/`,
      method: 'get',
      query: expandList.length ? { expand: expandList.join(',') } : {},
    })
  }

  /**
   * @operationName Create Event
   * @category Events
   * @description Creates a new event under an organization. Eventbrite requires a nested event body. This action builds it from individual fields: the event name maps to event.name.html, start/end each map to an object of {timezone, utc} (UTC timestamps must end in "Z", e.g. 2026-09-01T22:00:00Z), currency maps to event.currency, and the online flag maps to event.online_event. The event is created as a draft; use Publish Event to make it live. Optionally attach a venue (from Create Venue) and a listing category (from List Categories).
   * @route POST /organizations/events
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"getOrganizationsDictionary","description":"ID of the organization that will own the event."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Event title. Sent as event.name.html."}
   * @paramDef {"type":"String","label":"Timezone","name":"timezone","required":true,"description":"Olson timezone for the event, e.g. America/New_York. Applied to both start and end."}
   * @paramDef {"type":"String","label":"Start (UTC)","name":"startUtc","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Event start time in UTC ending with Z, e.g. 2026-09-01T22:00:00Z. Sent as event.start.utc."}
   * @paramDef {"type":"String","label":"End (UTC)","name":"endUtc","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Event end time in UTC ending with Z, e.g. 2026-09-02T01:00:00Z. Sent as event.end.utc."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","required":true,"description":"ISO 4217 currency code for ticket sales, e.g. USD, EUR, GBP. Sent as event.currency."}
   * @paramDef {"type":"Boolean","label":"Online Event","name":"onlineEvent","uiComponent":{"type":"CHECKBOX"},"description":"Whether this is an online-only event. Defaults to false. Sent as event.online_event."}
   * @paramDef {"type":"String","label":"Venue ID","name":"venueId","description":"Optional ID of a venue to associate with the event. Sent as event.venue_id."}
   * @paramDef {"type":"String","label":"Category ID","name":"categoryId","dictionary":"getCategoriesDictionary","description":"Optional listing category ID. Sent as event.category_id."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1234567890","name":{"text":"Launch Party","html":"Launch Party"},"start":{"timezone":"America/New_York","utc":"2026-09-01T22:00:00Z"},"end":{"timezone":"America/New_York","utc":"2026-09-02T01:00:00Z"},"currency":"USD","online_event":false,"status":"draft","url":"https://www.eventbrite.com/e/1234567890"}
   */
  async createEvent(organizationId, name, timezone, startUtc, endUtc, currency, onlineEvent, venueId, categoryId) {
    const logTag = '[createEvent]'

    const body = {
      event: clean({
        name: { html: name },
        start: { timezone, utc: startUtc },
        end: { timezone, utc: endUtc },
        currency,
        online_event: onlineEvent === undefined ? false : onlineEvent,
        venue_id: venueId,
        category_id: categoryId,
      }),
    }

    return this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/organizations/${ organizationId }/events/`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Update Event
   * @category Events
   * @description Updates an existing event. Only the fields you provide are changed; leave a field empty to keep its current value. Start and end are updated together with the supplied timezone, and both UTC timestamps must end in "Z".
   * @route POST /events/update
   *
   * @paramDef {"type":"String","label":"Event ID","name":"eventId","required":true,"dictionary":"getEventsDictionary","description":"ID of the event to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New event title. Sent as event.name.html."}
   * @paramDef {"type":"String","label":"Timezone","name":"timezone","description":"Olson timezone applied to start and end when either is provided, e.g. America/New_York."}
   * @paramDef {"type":"String","label":"Start (UTC)","name":"startUtc","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"New start time in UTC ending with Z. Requires a timezone."}
   * @paramDef {"type":"String","label":"End (UTC)","name":"endUtc","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"New end time in UTC ending with Z. Requires a timezone."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","description":"New ISO 4217 currency code, e.g. USD. Sent as event.currency."}
   * @paramDef {"type":"Boolean","label":"Online Event","name":"onlineEvent","uiComponent":{"type":"CHECKBOX"},"description":"Whether the event is online-only. Sent as event.online_event."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1234567890","name":{"text":"Launch Party 2026","html":"Launch Party 2026"},"currency":"USD","online_event":false,"status":"draft"}
   */
  async updateEvent(eventId, name, timezone, startUtc, endUtc, currency, onlineEvent) {
    const logTag = '[updateEvent]'

    const event = clean({
      name: name ? { html: name } : undefined,
      start: startUtc ? { timezone, utc: startUtc } : undefined,
      end: endUtc ? { timezone, utc: endUtc } : undefined,
      currency,
      online_event: onlineEvent,
    })

    return this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/events/${ eventId }/`,
      method: 'post',
      body: { event },
    })
  }

  /**
   * @operationName Publish Event
   * @category Events
   * @description Publishes a draft event, making it live and publicly visible. The event must have at least one valid ticket class and a start/end time before it can be published. Returns a confirmation flag.
   * @route POST /events/publish
   *
   * @paramDef {"type":"String","label":"Event ID","name":"eventId","required":true,"dictionary":"getEventsDictionary","description":"ID of the event to publish."}
   *
   * @returns {Object}
   * @sampleResult {"published":true}
   */
  async publishEvent(eventId) {
    const logTag = '[publishEvent]'

    return this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/events/${ eventId }/publish/`,
      method: 'post',
      body: {},
    })
  }

  /**
   * @operationName Unpublish Event
   * @category Events
   * @description Unpublishes a live event, returning it to draft/unlisted state so it is no longer publicly visible. Only works when the event has no completed orders.
   * @route POST /events/unpublish
   *
   * @paramDef {"type":"String","label":"Event ID","name":"eventId","required":true,"dictionary":"getEventsDictionary","description":"ID of the event to unpublish."}
   *
   * @returns {Object}
   * @sampleResult {"unpublished":true}
   */
  async unpublishEvent(eventId) {
    const logTag = '[unpublishEvent]'

    return this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/events/${ eventId }/unpublish/`,
      method: 'post',
      body: {},
    })
  }

  /**
   * @operationName Cancel Event
   * @category Events
   * @description Cancels a live event. Cancelling stops future ticket sales and marks the event as canceled while keeping its page accessible. Any existing attendees are retained. This cannot be undone through the API in the same way; re-publishing is required to reactivate.
   * @route POST /events/cancel
   *
   * @paramDef {"type":"String","label":"Event ID","name":"eventId","required":true,"dictionary":"getEventsDictionary","description":"ID of the event to cancel."}
   *
   * @returns {Object}
   * @sampleResult {"canceled":true}
   */
  async cancelEvent(eventId) {
    const logTag = '[cancelEvent]'

    return this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/events/${ eventId }/cancel/`,
      method: 'post',
      body: {},
    })
  }

  /* ==========================================================================
   * Attendees
   * ======================================================================== */

  /**
   * @operationName List Attendees
   * @category Attendees
   * @description Lists attendees for an event, including profile answers, barcodes, and order association. Optionally filter by attendee status. Results are paginated; pass the returned continuation token to fetch the next page.
   * @route GET /events/attendees
   *
   * @paramDef {"type":"String","label":"Event ID","name":"eventId","required":true,"dictionary":"getEventsDictionary","description":"ID of the event whose attendees to list."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Attending","Not Attending","Unpaid"]}},"description":"Only return attendees with this status. Leave empty to return all."}
   * @paramDef {"type":"String","label":"Continuation","name":"continuation","description":"Continuation token from a previous response to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"pagination":{"object_count":2,"page_number":1,"page_size":50,"page_count":1,"continuation":"eyJwYWdlIjogMn0","has_more_items":false},"attendees":[{"id":"9876543210","order_id":"555555555","status":"Attending","profile":{"name":"Ada Lovelace","email":"ada@example.com"},"ticket_class_name":"General Admission"}]}
   */
  async listAttendees(eventId, status, continuation) {
    const logTag = '[listAttendees]'

    return this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/events/${ eventId }/attendees/`,
      method: 'get',
      query: {
        status: this.#resolveChoice(status, ATTENDEE_STATUS_MAP),
        continuation,
      },
    })
  }

  /**
   * @operationName Get Attendee
   * @category Attendees
   * @description Retrieves a single attendee of an event by attendee ID, including their profile details, ticket class, barcode, and check-in status.
   * @route GET /events/attendees/get
   *
   * @paramDef {"type":"String","label":"Event ID","name":"eventId","required":true,"dictionary":"getEventsDictionary","description":"ID of the event the attendee belongs to."}
   * @paramDef {"type":"String","label":"Attendee ID","name":"attendeeId","required":true,"description":"ID of the attendee to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"9876543210","order_id":"555555555","status":"Attending","checked_in":false,"profile":{"name":"Ada Lovelace","email":"ada@example.com"},"ticket_class_name":"General Admission","costs":{"gross":{"currency":"USD","major_value":"25.00"}}}
   */
  async getAttendee(eventId, attendeeId) {
    const logTag = '[getAttendee]'

    return this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/events/${ eventId }/attendees/${ attendeeId }/`,
      method: 'get',
    })
  }

  /* ==========================================================================
   * Orders
   * ======================================================================== */

  /**
   * @operationName List Orders
   * @category Orders
   * @description Lists orders. Provide an event ID to list that event's orders, or an organization ID to list all orders across the organization's events. Optionally filter by order status. Results are paginated via the continuation token.
   * @route GET /orders
   *
   * @paramDef {"type":"String","label":"Event ID","name":"eventId","dictionary":"getEventsDictionary","description":"List orders for this event. Provide either an event ID or an organization ID."}
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","dictionary":"getOrganizationsDictionary","description":"List orders across all of this organization's events. Used only when no event ID is provided."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Placed","Refunded","Transferred From","Transferred To"]}},"description":"Only return orders with this status. Leave empty to return all."}
   * @paramDef {"type":"String","label":"Continuation","name":"continuation","description":"Continuation token from a previous response to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"pagination":{"object_count":1,"page_number":1,"page_size":50,"page_count":1,"has_more_items":false},"orders":[{"id":"555555555","status":"placed","email":"ada@example.com","first_name":"Ada","last_name":"Lovelace","costs":{"gross":{"currency":"USD","major_value":"25.00"}}}]}
   */
  async listOrders(eventId, organizationId, status, continuation) {
    const logTag = '[listOrders]'

    if (!eventId && !organizationId) {
      throw new Error('Eventbrite API error: provide either an event ID or an organization ID to list orders.')
    }

    const url = eventId
      ? `${ API_BASE_URL }/events/${ eventId }/orders/`
      : `${ API_BASE_URL }/organizations/${ organizationId }/orders/`

    return this.#apiRequest({
      logTag,
      url,
      method: 'get',
      query: {
        status: this.#resolveChoice(status, ORDER_STATUS_MAP),
        continuation,
      },
    })
  }

  /**
   * @operationName Get Order
   * @category Orders
   * @description Retrieves a single order by ID, including buyer details, costs, and status. Optionally expand attendees and the associated event.
   * @route GET /orders/get
   *
   * @paramDef {"type":"String","label":"Order ID","name":"orderId","required":true,"description":"ID of the order to retrieve."}
   * @paramDef {"type":"Array<String>","label":"Expand","name":"expand","uiComponent":{"type":"DROPDOWN","options":{"values":["attendees","event"]}},"description":"Related objects to embed in the response. Choose attendees and/or event."}
   *
   * @returns {Object}
   * @sampleResult {"id":"555555555","status":"placed","email":"ada@example.com","first_name":"Ada","last_name":"Lovelace","event_id":"1234567890","costs":{"gross":{"currency":"USD","major_value":"25.00"}}}
   */
  async getOrder(orderId, expand) {
    const logTag = '[getOrder]'
    const expandList = Array.isArray(expand) ? expand.filter(Boolean) : []

    return this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/orders/${ orderId }/`,
      method: 'get',
      query: expandList.length ? { expand: expandList.join(',') } : {},
    })
  }

  /* ==========================================================================
   * Ticket Classes
   * ======================================================================== */

  /**
   * @operationName List Ticket Classes
   * @category Ticket Classes
   * @description Lists the ticket classes (ticket types) configured for an event, including price, quantity, and free/paid status. Results are paginated via the continuation token.
   * @route GET /events/ticket-classes
   *
   * @paramDef {"type":"String","label":"Event ID","name":"eventId","required":true,"dictionary":"getEventsDictionary","description":"ID of the event whose ticket classes to list."}
   * @paramDef {"type":"String","label":"Continuation","name":"continuation","description":"Continuation token from a previous response to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"pagination":{"object_count":1,"page_number":1,"page_size":50,"page_count":1,"has_more_items":false},"ticket_classes":[{"id":"111222333","name":"General Admission","free":false,"cost":{"currency":"USD","major_value":"25.00","display":"$25.00"},"quantity_total":100,"quantity_sold":12}]}
   */
  async listTicketClasses(eventId, continuation) {
    const logTag = '[listTicketClasses]'

    return this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/events/${ eventId }/ticket_classes/`,
      method: 'get',
      query: { continuation },
    })
  }

  /**
   * @operationName Create Ticket Class
   * @category Ticket Classes
   * @description Creates a ticket class for an event. For paid tickets, set Free to false and provide a Cost as a currency-prefixed string (e.g. "USD,2500" for $25.00, where the amount is in minor units/cents). For free tickets, set Free to true and omit the cost. The body is nested under ticket_class.
   * @route POST /events/ticket-classes
   *
   * @paramDef {"type":"String","label":"Event ID","name":"eventId","required":true,"dictionary":"getEventsDictionary","description":"ID of the event to add the ticket class to."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Display name of the ticket class, e.g. General Admission."}
   * @paramDef {"type":"Number","label":"Quantity Total","name":"quantityTotal","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Total number of tickets available in this class."}
   * @paramDef {"type":"Boolean","label":"Free","name":"free","uiComponent":{"type":"CHECKBOX"},"description":"Whether this is a free ticket. When true, Cost is ignored. Defaults to false."}
   * @paramDef {"type":"String","label":"Cost","name":"cost","description":"Ticket price as currency,amount-in-minor-units, e.g. USD,2500 for $25.00. Required when Free is false."}
   *
   * @returns {Object}
   * @sampleResult {"id":"111222333","name":"General Admission","free":false,"cost":{"currency":"USD","value":2500,"major_value":"25.00","display":"$25.00"},"quantity_total":100}
   */
  async createTicketClass(eventId, name, quantityTotal, free, cost) {
    const logTag = '[createTicketClass]'
    const isFree = free === undefined ? false : free

    const ticketClass = clean({
      name,
      quantity_total: quantityTotal,
      free: isFree,
      cost: isFree ? undefined : cost,
    })

    return this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/events/${ eventId }/ticket_classes/`,
      method: 'post',
      body: { ticket_class: ticketClass },
    })
  }

  /**
   * @operationName Update Ticket Class
   * @category Ticket Classes
   * @description Updates an existing ticket class. Only the fields you provide are changed. Use the same cost format as Create Ticket Class (currency,amount-in-minor-units).
   * @route POST /events/ticket-classes/update
   *
   * @paramDef {"type":"String","label":"Event ID","name":"eventId","required":true,"dictionary":"getEventsDictionary","description":"ID of the event the ticket class belongs to."}
   * @paramDef {"type":"String","label":"Ticket Class ID","name":"ticketClassId","required":true,"description":"ID of the ticket class to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New display name for the ticket class."}
   * @paramDef {"type":"Number","label":"Quantity Total","name":"quantityTotal","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New total number of tickets available."}
   * @paramDef {"type":"Boolean","label":"Free","name":"free","uiComponent":{"type":"CHECKBOX"},"description":"Whether this ticket is free."}
   * @paramDef {"type":"String","label":"Cost","name":"cost","description":"New price as currency,amount-in-minor-units, e.g. USD,2500."}
   *
   * @returns {Object}
   * @sampleResult {"id":"111222333","name":"VIP","free":false,"cost":{"currency":"USD","major_value":"50.00","display":"$50.00"},"quantity_total":50}
   */
  async updateTicketClass(eventId, ticketClassId, name, quantityTotal, free, cost) {
    const logTag = '[updateTicketClass]'

    const ticketClass = clean({
      name,
      quantity_total: quantityTotal,
      free,
      cost,
    })

    return this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/events/${ eventId }/ticket_classes/${ ticketClassId }/`,
      method: 'post',
      body: { ticket_class: ticketClass },
    })
  }

  /**
   * @operationName Delete Ticket Class
   * @category Ticket Classes
   * @description Deletes a ticket class from an event. This is only permitted when no tickets in the class have been sold. Returns a confirmation flag.
   * @route DELETE /events/ticket-classes
   *
   * @paramDef {"type":"String","label":"Event ID","name":"eventId","required":true,"dictionary":"getEventsDictionary","description":"ID of the event the ticket class belongs to."}
   * @paramDef {"type":"String","label":"Ticket Class ID","name":"ticketClassId","required":true,"description":"ID of the ticket class to delete."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true}
   */
  async deleteTicketClass(eventId, ticketClassId) {
    const logTag = '[deleteTicketClass]'

    return this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/events/${ eventId }/ticket_classes/${ ticketClassId }/`,
      method: 'delete',
    })
  }

  /* ==========================================================================
   * Venues
   * ======================================================================== */

  /**
   * @operationName List Venues
   * @category Venues
   * @description Lists venues belonging to an organization, including their names and structured addresses. Results are paginated via the continuation token.
   * @route GET /organizations/venues
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"getOrganizationsDictionary","description":"ID of the organization whose venues to list."}
   * @paramDef {"type":"String","label":"Continuation","name":"continuation","description":"Continuation token from a previous response to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"pagination":{"object_count":1,"page_number":1,"page_size":50,"page_count":1,"has_more_items":false},"venues":[{"id":"44445555","name":"Main Hall","address":{"address_1":"123 Market St","city":"San Francisco","region":"CA","postal_code":"94103","country":"US"}}]}
   */
  async listVenues(organizationId, continuation) {
    const logTag = '[listVenues]'

    return this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/organizations/${ organizationId }/venues/`,
      method: 'get',
      query: { continuation },
    })
  }

  /**
   * @operationName Create Venue
   * @category Venues
   * @description Creates a venue under an organization. The body is nested under venue, with the location fields grouped into venue.address. The returned venue ID can be passed to Create Event to set the event location.
   * @route POST /organizations/venues
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"getOrganizationsDictionary","description":"ID of the organization that will own the venue."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Venue name. Sent as venue.name."}
   * @paramDef {"type":"String","label":"Address Line 1","name":"address1","required":true,"description":"Street address. Sent as venue.address.address_1."}
   * @paramDef {"type":"String","label":"Address Line 2","name":"address2","description":"Additional address detail (suite, floor). Sent as venue.address.address_2."}
   * @paramDef {"type":"String","label":"City","name":"city","description":"City. Sent as venue.address.city."}
   * @paramDef {"type":"String","label":"Region","name":"region","description":"State/province/region. Sent as venue.address.region."}
   * @paramDef {"type":"String","label":"Postal Code","name":"postalCode","description":"ZIP/postal code. Sent as venue.address.postal_code."}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"ISO 3166-1 alpha-2 country code, e.g. US, GB. Sent as venue.address.country."}
   *
   * @returns {Object}
   * @sampleResult {"id":"44445555","name":"Main Hall","address":{"address_1":"123 Market St","city":"San Francisco","region":"CA","postal_code":"94103","country":"US"}}
   */
  async createVenue(organizationId, name, address1, address2, city, region, postalCode, country) {
    const logTag = '[createVenue]'

    const venue = clean({
      name,
      address: {
        address_1: address1,
        address_2: address2,
        city,
        region,
        postal_code: postalCode,
        country,
      },
    })

    return this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/organizations/${ organizationId }/venues/`,
      method: 'post',
      body: { venue },
    })
  }

  /**
   * @operationName Get Venue
   * @category Venues
   * @description Retrieves a single venue by ID, including its name, structured address, and geolocation when available.
   * @route GET /venues/get
   *
   * @paramDef {"type":"String","label":"Venue ID","name":"venueId","required":true,"description":"ID of the venue to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"44445555","name":"Main Hall","address":{"address_1":"123 Market St","city":"San Francisco","region":"CA","postal_code":"94103","country":"US","latitude":"37.7749","longitude":"-122.4194"}}
   */
  async getVenue(venueId) {
    const logTag = '[getVenue]'

    return this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/venues/${ venueId }/`,
      method: 'get',
    })
  }

  /* ==========================================================================
   * Categories & Me
   * ======================================================================== */

  /**
   * @operationName List Categories
   * @category Categories
   * @description Lists Eventbrite's standard listing categories (e.g. Music, Business, Food & Drink). Use a category ID when creating an event to classify it. Results are paginated via the continuation token.
   * @route GET /categories
   *
   * @paramDef {"type":"String","label":"Continuation","name":"continuation","description":"Continuation token from a previous response to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"pagination":{"object_count":20,"page_number":1,"page_size":50,"page_count":1,"has_more_items":false},"categories":[{"id":"103","name":"Music","name_localized":"Music","short_name":"Music"},{"id":"101","name":"Business & Professional","short_name":"Business"}]}
   */
  async listCategories(continuation) {
    const logTag = '[listCategories]'

    return this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/categories/`,
      method: 'get',
      query: { continuation },
    })
  }

  /**
   * @operationName Get User
   * @category Me
   * @description Retrieves the profile of the user who owns the private token, including user ID, name, and email addresses. Useful for confirming the connected account.
   * @route GET /users/me
   *
   * @returns {Object}
   * @sampleResult {"id":"223344556677","name":"Ada Lovelace","first_name":"Ada","last_name":"Lovelace","emails":[{"email":"ada@example.com","verified":true,"primary":true}]}
   */
  async getUser() {
    const logTag = '[getUser]'

    return this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/me/`,
      method: 'get',
    })
  }

  /* ==========================================================================
   * Dictionaries
   * ======================================================================== */

  /**
   * @typedef {Object} getOrganizationsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter organizations by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination continuation token from a previous dictionary call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Organizations Dictionary
   * @description Lists the organizations the connected account belongs to, for selecting an organization in organization-scoped operations. The option value is the organization ID.
   * @route POST /get-organizations-dictionary
   * @paramDef {"type":"getOrganizationsDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Acme Events","value":"778899","note":"Organization"}],"cursor":"eyJwYWdlIjogMn0"}
   */
  async getOrganizationsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getOrganizationsDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/me/organizations/`,
      method: 'get',
      query: { continuation: cursor },
    })

    const organizations = response.organizations || []
    const term = (search || '').toLowerCase()

    const items = organizations
      .filter(org => !term || (org.name || '').toLowerCase().includes(term))
      .map(org => ({
        label: org.name || org.id,
        value: org.id,
        note: 'Organization',
      }))

    return {
      items,
      cursor: response.pagination?.has_more_items ? response.pagination.continuation : undefined,
    }
  }

  /**
   * @typedef {Object} getEventsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"getOrganizationsDictionary","description":"Organization whose events to list."}
   */

  /**
   * @typedef {Object} getEventsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter events by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination continuation token from a previous dictionary call."}
   * @paramDef {"type":"getEventsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"The organization whose events to list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Events Dictionary
   * @description Lists events for a selected organization, for choosing an event in event-scoped operations. Requires an organization to be selected first. The option value is the event ID.
   * @route POST /get-events-dictionary
   * @paramDef {"type":"getEventsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the organization criteria whose events to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Launch Party","value":"1234567890","note":"live"}],"cursor":"eyJwYWdlIjogMn0"}
   */
  async getEventsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const organizationId = criteria?.organizationId
    const logTag = '[getEventsDictionary]'

    if (!organizationId) {
      return { items: [] }
    }

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/organizations/${ organizationId }/events/`,
      method: 'get',
      query: {
        continuation: cursor,
        name_filter: search || undefined,
        order_by: 'start_desc',
      },
    })

    const events = response.events || []

    const items = events.map(event => ({
      label: event.name?.text || event.id,
      value: event.id,
      note: event.status,
    }))

    return {
      items,
      cursor: response.pagination?.has_more_items ? response.pagination.continuation : undefined,
    }
  }

  /**
   * @typedef {Object} getCategoriesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter categories by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination continuation token from a previous dictionary call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Categories Dictionary
   * @description Lists Eventbrite's standard listing categories for selecting a category when creating an event. The option value is the category ID.
   * @route POST /get-categories-dictionary
   * @paramDef {"type":"getCategoriesDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Music","value":"103","note":"Category"}],"cursor":"eyJwYWdlIjogMn0"}
   */
  async getCategoriesDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getCategoriesDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/categories/`,
      method: 'get',
      query: { continuation: cursor },
    })

    const categories = response.categories || []
    const term = (search || '').toLowerCase()

    const items = categories
      .filter(category => !term || (category.name || '').toLowerCase().includes(term))
      .map(category => ({
        label: category.name || category.id,
        value: category.id,
        note: 'Category',
      }))

    return {
      items,
      cursor: response.pagination?.has_more_items ? response.pagination.continuation : undefined,
    }
  }
}

Flowrunner.ServerCode.addService(EventbriteService, [
  {
    name: 'privateToken',
    displayName: 'Private Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Eventbrite private token. Find it in Eventbrite → Account Settings → Developer Links → API Keys → your private token.',
  },
])
