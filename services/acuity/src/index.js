const logger = {
  info: (...args) => console.log('[Acuity Scheduling] info:', ...args),
  debug: (...args) => console.log('[Acuity Scheduling] debug:', ...args),
  error: (...args) => console.log('[Acuity Scheduling] error:', ...args),
  warn: (...args) => console.log('[Acuity Scheduling] warn:', ...args),
}

const API_BASE_URL = 'https://acuityscheduling.com/api/v1'

const DEFAULT_MAX = 100

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
 * @integrationName Acuity Scheduling
 * @integrationIcon /icon.png
 * @integrationTriggersScope SINGLE_APP
 */
class AcuityScheduling {
  constructor(config) {
    this.userId = config.userId
    this.apiKey = config.apiKey
  }

  #authHeader() {
    const token = Buffer.from(`${ this.userId }:${ this.apiKey }`).toString('base64')

    return `Basic ${ token }`
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': this.#authHeader(),
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const details = error.body || {}
      const message = details.message || error.message
      const errorCode = details.error ? ` (${ details.error })` : ''
      const status = error.status || error.statusCode || details.status_code

      logger.error(`${ logTag } - failed [${ status }]: ${ message }${ errorCode }`)

      throw new Error(`Acuity Scheduling API error${ status ? ` [${ status }]` : '' }: ${ message }${ errorCode }`)
    }
  }

  // ─── Appointments ───────────────────────────────────────────────────────

  /**
   * @operationName List Appointments
   * @category Appointments
   * @description Retrieves scheduled appointments. Supports filtering by date range (minDate/maxDate as YYYY-MM-DD), calendar, appointment type, client email, and canceled status, plus sort direction (newest or oldest first). Returns up to the requested maximum (Acuity defaults to 100). Use this to find appointment IDs for other operations.
   * @route GET /list-appointments
   *
   * @paramDef {"type":"Number","label":"Max Results","name":"max","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of appointments to return. Defaults to 100."}
   * @paramDef {"type":"String","label":"Min Date","name":"minDate","uiComponent":{"type":"DATE_PICKER"},"description":"Only return appointments on or after this date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"Max Date","name":"maxDate","uiComponent":{"type":"DATE_PICKER"},"description":"Only return appointments on or before this date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"Calendar","name":"calendarID","dictionary":"getCalendarsDictionary","description":"Filter to appointments on a specific calendar."}
   * @paramDef {"type":"String","label":"Appointment Type","name":"appointmentTypeID","dictionary":"getAppointmentTypesDictionary","description":"Filter to appointments of a specific type."}
   * @paramDef {"type":"Boolean","label":"Canceled","name":"canceled","uiComponent":{"type":"CHECKBOX"},"description":"When true, returns canceled appointments instead of scheduled ones. Defaults to false."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Filter to appointments booked by this client email."}
   * @paramDef {"type":"String","label":"Sort Direction","name":"direction","uiComponent":{"type":"DROPDOWN","options":{"values":["Newest First","Oldest First"]}},"defaultValue":"Newest First","description":"Order results by appointment datetime. Defaults to Newest First."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":123456789,"firstName":"Ada","lastName":"Lovelace","email":"ada@example.com","phone":"5551234567","datetime":"2026-08-01T09:00:00-0700","endTime":"2026-08-01T09:30:00-0700","date":"August 1, 2026","time":"9:00am","type":"Consultation","appointmentTypeID":1234567,"calendar":"Main","calendarID":987654,"canceled":false,"price":"0.00","duration":"30"}]
   */
  async listAppointments(max, minDate, maxDate, calendarID, appointmentTypeID, canceled, email, direction) {
    return await this.#apiRequest({
      logTag: '[listAppointments]',
      url: `${ API_BASE_URL }/appointments`,
      method: 'get',
      query: {
        max: max || DEFAULT_MAX,
        minDate,
        maxDate,
        calendarID,
        appointmentTypeID,
        canceled: canceled === true ? true : undefined,
        email,
        direction: this.#resolveChoice(direction, { 'Newest First': 'DESC', 'Oldest First': 'ASC' }),
      },
    })
  }

  /**
   * @operationName Get Appointment
   * @category Appointments
   * @description Retrieves the full details of a single appointment by its ID, including client contact info, scheduled time, appointment type, calendar, price, and any intake form field values.
   * @route GET /get-appointment
   *
   * @paramDef {"type":"String","label":"Appointment ID","name":"appointmentId","required":true,"description":"The unique ID of the appointment to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":123456789,"firstName":"Ada","lastName":"Lovelace","email":"ada@example.com","phone":"5551234567","datetime":"2026-08-01T09:00:00-0700","endTime":"2026-08-01T09:30:00-0700","date":"August 1, 2026","time":"9:00am","type":"Consultation","appointmentTypeID":1234567,"calendar":"Main","calendarID":987654,"canceled":false,"price":"0.00","duration":"30","forms":[{"id":1,"name":"Intake","values":[{"fieldID":9,"name":"Notes","value":"First visit"}]}]}
   */
  async getAppointment(appointmentId) {
    return await this.#apiRequest({
      logTag: '[getAppointment]',
      url: `${ API_BASE_URL }/appointments/${ appointmentId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Appointment
   * @category Appointments
   * @description Books a new appointment as an administrator (bypasses client-facing availability restrictions). Requires an appointment type, an ISO 8601 datetime, and the client's first name, last name, and email. Optionally set phone, a specific calendar, and intake form field values. No confirmation email is sent unless configured on the account.
   * @route POST /create-appointment
   *
   * @paramDef {"type":"String","label":"Appointment Type","name":"appointmentTypeID","required":true,"dictionary":"getAppointmentTypesDictionary","description":"The type of appointment to book."}
   * @paramDef {"type":"String","label":"Datetime","name":"datetime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start time in ISO 8601 format, e.g. 2026-08-01T09:00:00-0700. Should match an available slot for the type/calendar."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","required":true,"description":"Client's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","required":true,"description":"Client's last name."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Client's email address."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Client's phone number."}
   * @paramDef {"type":"String","label":"Calendar","name":"calendarID","dictionary":"getCalendarsDictionary","description":"Book on a specific calendar. If omitted, Acuity auto-assigns based on availability."}
   * @paramDef {"type":"Array<Object>","label":"Form Fields","name":"fields","description":"Intake form field values, each as {\"id\": <fieldID>, \"value\": \"...\"}."}
   *
   * @returns {Object}
   * @sampleResult {"id":123456789,"firstName":"Ada","lastName":"Lovelace","email":"ada@example.com","phone":"5551234567","datetime":"2026-08-01T09:00:00-0700","type":"Consultation","appointmentTypeID":1234567,"calendar":"Main","calendarID":987654,"canceled":false,"price":"0.00","duration":"30"}
   */
  async createAppointment(appointmentTypeID, datetime, firstName, lastName, email, phone, calendarID, fields) {
    return await this.#apiRequest({
      logTag: '[createAppointment]',
      url: `${ API_BASE_URL }/appointments`,
      method: 'post',
      query: { admin: true },
      body: clean({
        appointmentTypeID: appointmentTypeID !== undefined ? Number(appointmentTypeID) : undefined,
        datetime,
        firstName,
        lastName,
        email,
        phone,
        calendarID: calendarID !== undefined ? Number(calendarID) : undefined,
        fields: Array.isArray(fields) ? fields : undefined,
      }),
    })
  }

  /**
   * @operationName Reschedule Appointment
   * @category Appointments
   * @description Moves an existing appointment to a new start time. Provide the appointment ID and the new datetime in ISO 8601 format. Returns the updated appointment. The new time should correspond to an available slot for the appointment's type and calendar.
   * @route PUT /reschedule-appointment
   *
   * @paramDef {"type":"String","label":"Appointment ID","name":"appointmentId","required":true,"description":"The ID of the appointment to reschedule."}
   * @paramDef {"type":"String","label":"New Datetime","name":"datetime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"New start time in ISO 8601 format, e.g. 2026-08-02T14:00:00-0700."}
   * @paramDef {"type":"String","label":"Calendar","name":"calendarID","dictionary":"getCalendarsDictionary","description":"Optionally move the appointment to a different calendar."}
   *
   * @returns {Object}
   * @sampleResult {"id":123456789,"firstName":"Ada","lastName":"Lovelace","email":"ada@example.com","datetime":"2026-08-02T14:00:00-0700","type":"Consultation","appointmentTypeID":1234567,"calendar":"Main","calendarID":987654,"canceled":false}
   */
  async rescheduleAppointment(appointmentId, datetime, calendarID) {
    return await this.#apiRequest({
      logTag: '[rescheduleAppointment]',
      url: `${ API_BASE_URL }/appointments/${ appointmentId }/reschedule`,
      method: 'put',
      body: clean({
        datetime,
        calendarID: calendarID !== undefined ? Number(calendarID) : undefined,
      }),
    })
  }

  /**
   * @operationName Cancel Appointment
   * @category Appointments
   * @description Cancels an existing appointment by ID. Optionally include a cancellation note that is stored on the appointment. Returns the updated (canceled) appointment. Cancellation is not reversible via the API.
   * @route PUT /cancel-appointment
   *
   * @paramDef {"type":"String","label":"Appointment ID","name":"appointmentId","required":true,"description":"The ID of the appointment to cancel."}
   * @paramDef {"type":"String","label":"Cancel Note","name":"cancelNote","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional note explaining the cancellation, stored on the appointment."}
   *
   * @returns {Object}
   * @sampleResult {"id":123456789,"firstName":"Ada","lastName":"Lovelace","email":"ada@example.com","datetime":"2026-08-01T09:00:00-0700","type":"Consultation","canceled":true,"cancelNote":"Client requested cancellation"}
   */
  async cancelAppointment(appointmentId, cancelNote) {
    return await this.#apiRequest({
      logTag: '[cancelAppointment]',
      url: `${ API_BASE_URL }/appointments/${ appointmentId }/cancel`,
      method: 'put',
      body: clean({ cancelNote }),
    })
  }

  /**
   * @operationName Update Appointment
   * @category Appointments
   * @description Updates editable details on an existing appointment, such as private notes and intake form field values. Does not change the scheduled time (use Reschedule Appointment for that). Returns the updated appointment.
   * @route PUT /update-appointment
   *
   * @paramDef {"type":"String","label":"Appointment ID","name":"appointmentId","required":true,"description":"The ID of the appointment to update."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Private notes to store on the appointment."}
   * @paramDef {"type":"Array<Object>","label":"Form Fields","name":"fields","description":"Intake form field values to update, each as {\"id\": <fieldID>, \"value\": \"...\"}."}
   *
   * @returns {Object}
   * @sampleResult {"id":123456789,"firstName":"Ada","lastName":"Lovelace","email":"ada@example.com","datetime":"2026-08-01T09:00:00-0700","type":"Consultation","notes":"VIP client","canceled":false}
   */
  async updateAppointment(appointmentId, notes, fields) {
    return await this.#apiRequest({
      logTag: '[updateAppointment]',
      url: `${ API_BASE_URL }/appointments/${ appointmentId }`,
      method: 'put',
      body: clean({
        notes,
        fields: Array.isArray(fields) ? fields : undefined,
      }),
    })
  }

  // ─── Availability ───────────────────────────────────────────────────────

  /**
   * @operationName Get Availability Dates
   * @category Availability
   * @description Returns the dates within a given month that have open availability for a specific appointment type, optionally scoped to one calendar. Use the returned dates with Get Availability Times to find bookable slots.
   * @route GET /get-availability-dates
   *
   * @paramDef {"type":"String","label":"Month","name":"month","required":true,"description":"Month to check in YYYY-MM format, e.g. 2026-08."}
   * @paramDef {"type":"String","label":"Appointment Type","name":"appointmentTypeID","required":true,"dictionary":"getAppointmentTypesDictionary","description":"The appointment type to check availability for."}
   * @paramDef {"type":"String","label":"Calendar","name":"calendarID","dictionary":"getCalendarsDictionary","description":"Restrict availability to a specific calendar."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"date":"2026-08-01"},{"date":"2026-08-04"},{"date":"2026-08-05"}]
   */
  async getAvailabilityDates(month, appointmentTypeID, calendarID) {
    return await this.#apiRequest({
      logTag: '[getAvailabilityDates]',
      url: `${ API_BASE_URL }/availability/dates`,
      method: 'get',
      query: { month, appointmentTypeID, calendarID },
    })
  }

  /**
   * @operationName Get Availability Times
   * @category Availability
   * @description Returns the specific open time slots on a given date for an appointment type, optionally scoped to one calendar. Each returned time is a bookable ISO 8601 datetime that can be passed to Create Appointment.
   * @route GET /get-availability-times
   *
   * @paramDef {"type":"String","label":"Date","name":"date","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Date to check in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"Appointment Type","name":"appointmentTypeID","required":true,"dictionary":"getAppointmentTypesDictionary","description":"The appointment type to check availability for."}
   * @paramDef {"type":"String","label":"Calendar","name":"calendarID","dictionary":"getCalendarsDictionary","description":"Restrict availability to a specific calendar."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"time":"2026-08-01T09:00:00-0700","slotsAvailable":1},{"time":"2026-08-01T09:30:00-0700","slotsAvailable":1}]
   */
  async getAvailabilityTimes(date, appointmentTypeID, calendarID) {
    return await this.#apiRequest({
      logTag: '[getAvailabilityTimes]',
      url: `${ API_BASE_URL }/availability/times`,
      method: 'get',
      query: { date, appointmentTypeID, calendarID },
    })
  }

  /**
   * @operationName Check Times
   * @category Availability
   * @description Validates whether specific times are still available for booking a given appointment type before creating appointments. Provide the appointment type and a list of ISO 8601 datetimes; returns the subset that are currently bookable. Useful to confirm slots have not been taken since they were fetched.
   * @route POST /check-times
   *
   * @paramDef {"type":"String","label":"Appointment Type","name":"appointmentTypeID","required":true,"dictionary":"getAppointmentTypesDictionary","description":"The appointment type the times are being checked against."}
   * @paramDef {"type":"Array<String>","label":"Times","name":"times","required":true,"description":"List of ISO 8601 datetimes to validate, e.g. 2026-08-01T09:00:00-0700."}
   * @paramDef {"type":"String","label":"Calendar","name":"calendarID","dictionary":"getCalendarsDictionary","description":"Restrict the check to a specific calendar."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"time":"2026-08-01T09:00:00-0700","slotsAvailable":1,"valid":true}]
   */
  async checkTimes(appointmentTypeID, times, calendarID) {
    return await this.#apiRequest({
      logTag: '[checkTimes]',
      url: `${ API_BASE_URL }/availability/check-times`,
      method: 'post',
      body: clean({
        appointmentTypeID: appointmentTypeID !== undefined ? Number(appointmentTypeID) : undefined,
        times: Array.isArray(times) ? times : undefined,
        calendarID: calendarID !== undefined ? Number(calendarID) : undefined,
      }),
    })
  }

  // ─── Appointment Types ──────────────────────────────────────────────────

  /**
   * @operationName List Appointment Types
   * @category Appointment Types
   * @description Retrieves all appointment types configured on the account, including their name, ID, duration, price, category, and whether they are active or private. Use the returned IDs when booking or checking availability.
   * @route GET /list-appointment-types
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":1234567,"name":"Consultation","active":true,"description":"Initial consultation","duration":30,"price":"0.00","category":"General","color":"#8EB20A","private":false,"type":"service","calendarIDs":[987654]}]
   */
  async listAppointmentTypes() {
    return await this.#apiRequest({
      logTag: '[listAppointmentTypes]',
      url: `${ API_BASE_URL }/appointment-types`,
      method: 'get',
    })
  }

  // ─── Calendars ──────────────────────────────────────────────────────────

  /**
   * @operationName List Calendars
   * @category Calendars
   * @description Retrieves all calendars on the account, including their name, ID, email, timezone, and location. Calendars represent staff members or resources against which appointments are booked.
   * @route GET /list-calendars
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":987654,"name":"Main","email":"main@example.com","replyTo":"main@example.com","description":"Primary calendar","location":"123 Main St","timezone":"America/Los_Angeles"}]
   */
  async listCalendars() {
    return await this.#apiRequest({
      logTag: '[listCalendars]',
      url: `${ API_BASE_URL }/calendars`,
      method: 'get',
    })
  }

  // ─── Clients ────────────────────────────────────────────────────────────

  /**
   * @operationName List Clients
   * @category Clients
   * @description Retrieves clients stored on the account. Supply an optional search term to filter by name, email, or phone. Returns each client's name and contact details.
   * @route GET /list-clients
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional filter matching client name, email, or phone."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"firstName":"Ada","lastName":"Lovelace","email":"ada@example.com","phone":"5551234567","notes":""}]
   */
  async listClients(search) {
    return await this.#apiRequest({
      logTag: '[listClients]',
      url: `${ API_BASE_URL }/clients`,
      method: 'get',
      query: { search },
    })
  }

  /**
   * @operationName Create Client
   * @category Clients
   * @description Creates a new client record on the account with a first name, last name, and optional email and phone. Returns the created client. Note that appointments booked via Create Appointment automatically create clients as well.
   * @route POST /create-client
   *
   * @paramDef {"type":"String","label":"First Name","name":"firstName","required":true,"description":"Client's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","required":true,"description":"Client's last name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Client's email address."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Client's phone number."}
   *
   * @returns {Object}
   * @sampleResult {"firstName":"Ada","lastName":"Lovelace","email":"ada@example.com","phone":"5551234567","notes":""}
   */
  async createClient(firstName, lastName, email, phone) {
    return await this.#apiRequest({
      logTag: '[createClient]',
      url: `${ API_BASE_URL }/clients`,
      method: 'post',
      body: clean({ firstName, lastName, email, phone }),
    })
  }

  /**
   * @operationName Update Client
   * @category Clients
   * @description Updates an existing client identified by their current first name, last name, and phone (Acuity's composite client key). Provide the fields to change. Returns the updated client record.
   * @route PUT /update-client
   *
   * @paramDef {"type":"String","label":"First Name","name":"firstName","required":true,"description":"Client's current first name (used to identify the client)."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","required":true,"description":"Client's current last name (used to identify the client)."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Client's current phone number (used to identify the client)."}
   * @paramDef {"type":"String","label":"New Email","name":"email","description":"Updated email address."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated notes for the client."}
   *
   * @returns {Object}
   * @sampleResult {"firstName":"Ada","lastName":"Lovelace","email":"ada.new@example.com","phone":"5551234567","notes":"Preferred contact by email"}
   */
  async updateClient(firstName, lastName, phone, email, notes) {
    return await this.#apiRequest({
      logTag: '[updateClient]',
      url: `${ API_BASE_URL }/clients`,
      method: 'put',
      query: clean({ firstName, lastName, phone }),
      body: clean({ email, notes }),
    })
  }

  // ─── Forms ──────────────────────────────────────────────────────────────

  /**
   * @operationName List Forms
   * @category Forms
   * @description Retrieves the intake form definitions configured on the account, including each form's fields and their IDs, names, and types. Use these field IDs to populate the Form Fields parameter when creating or updating appointments.
   * @route GET /list-forms
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":1,"name":"Intake","fields":[{"id":9,"name":"Notes","type":"textarea","required":false,"options":[]}]}]
   */
  async listForms() {
    return await this.#apiRequest({
      logTag: '[listForms]',
      url: `${ API_BASE_URL }/forms`,
      method: 'get',
    })
  }

  // ─── Certificates ───────────────────────────────────────────────────────

  /**
   * @operationName List Certificates
   * @category Certificates
   * @description Retrieves discount and gift certificate codes configured on the account, including the code, discount type/amount, appointment type restrictions, and remaining uses. Useful for auditing or applying promotional codes.
   * @route GET /list-certificates
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":54321,"certificate":"SAVE10","appointmentTypeIDs":[1234567],"productID":null,"orderID":null,"expiration":"2026-12-31","email":"","name":"10% off","type":"percentage","discountAmount":10,"remainingValue":null,"remainingMinutes":null}]
   */
  async listCertificates() {
    return await this.#apiRequest({
      logTag: '[listCertificates]',
      url: `${ API_BASE_URL }/certificates`,
      method: 'get',
    })
  }

  // ─── Account ────────────────────────────────────────────────────────────

  /**
   * @operationName Get Me
   * @category Account
   * @description Retrieves the authenticated Acuity account's profile, including business name, email, timezone, currency, and plan. Useful as a connection/credential check.
   * @route GET /get-me
   *
   * @returns {Object}
   * @sampleResult {"email":"owner@example.com","name":"Acme Studio","timezone":"America/Los_Angeles","currency":"USD","country":"US","plan":"Emerging","platform":"Acuity","viewAll":true}
   */
  async getMe() {
    return await this.#apiRequest({
      logTag: '[getMe]',
      url: `${ API_BASE_URL }/me`,
      method: 'get',
    })
  }

  // ─── Dictionaries ───────────────────────────────────────────────────────

  /**
   * @typedef {Object} getAppointmentTypesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter appointment types by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Acuity returns all appointment types in one call, so this is unused but kept for compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Appointment Types Dictionary
   * @description Provides a selectable list of appointment types (label = name, value = ID) for use in appointment and availability parameters.
   * @route POST /get-appointment-types-dictionary
   * @paramDef {"type":"getAppointmentTypesDictionary__payload","label":"Payload","name":"payload","description":"Optional search string to filter appointment types by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Consultation","value":"1234567","note":"30 min - $0.00"}],"cursor":null}
   */
  async getAppointmentTypesDictionary(payload) {
    const { search } = payload || {}

    const types = await this.#apiRequest({
      logTag: '[getAppointmentTypesDictionary]',
      url: `${ API_BASE_URL }/appointment-types`,
      method: 'get',
    })

    const list = Array.isArray(types) ? types : []
    const term = (search || '').toLowerCase()

    const filtered = term
      ? list.filter(t => (t.name || '').toLowerCase().includes(term))
      : list

    return {
      items: filtered.map(t => {
        const noteParts = []

        if (t.duration !== undefined) {
          noteParts.push(`${ t.duration } min`)
        }

        if (t.price !== undefined) {
          noteParts.push(`$${ t.price }`)
        }

        return {
          label: t.name,
          value: String(t.id),
          note: noteParts.join(' - ') || undefined,
        }
      }),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getCalendarsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter calendars by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Acuity returns all calendars in one call, so this is unused but kept for compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Calendars Dictionary
   * @description Provides a selectable list of calendars (label = name, value = ID) for use in appointment and availability parameters.
   * @route POST /get-calendars-dictionary
   * @paramDef {"type":"getCalendarsDictionary__payload","label":"Payload","name":"payload","description":"Optional search string to filter calendars by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Main","value":"987654","note":"America/Los_Angeles"}],"cursor":null}
   */
  async getCalendarsDictionary(payload) {
    const { search } = payload || {}

    const calendars = await this.#apiRequest({
      logTag: '[getCalendarsDictionary]',
      url: `${ API_BASE_URL }/calendars`,
      method: 'get',
    })

    const list = Array.isArray(calendars) ? calendars : []
    const term = (search || '').toLowerCase()

    const filtered = term
      ? list.filter(c => (c.name || '').toLowerCase().includes(term))
      : list

    return {
      items: filtered.map(c => ({
        label: c.name,
        value: String(c.id),
        note: c.timezone || undefined,
      })),
      cursor: null,
    }
  }

  // ─── Polling Trigger ────────────────────────────────────────────────────

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    return this[invocation.eventName](invocation)
  }

  /**
   * @operationName On New Appointment
   * @category Appointments
   * @description Fires when a new appointment is booked on the account, emitting the raw appointment object. Optionally scope monitoring to a single appointment type and/or calendar. The first poll establishes a baseline without firing, so pre-existing appointments are not replayed; only appointments created after monitoring begins trigger the flow.
   * @registerAs POLLING_TRIGGER
   * @route POST /on-new-appointment
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Appointment Type","name":"appointmentTypeID","dictionary":"getAppointmentTypesDictionary","description":"Only fire for new appointments of this type. Leave empty to watch all types."}
   * @paramDef {"type":"String","label":"Calendar","name":"calendarID","dictionary":"getCalendarsDictionary","description":"Only fire for new appointments on this calendar. Leave empty to watch all calendars."}
   *
   * @returns {Object}
   * @sampleResult {"id":123456789,"firstName":"Ada","lastName":"Lovelace","email":"ada@example.com","phone":"5551234567","datetime":"2026-08-01T09:00:00-0700","type":"Consultation","appointmentTypeID":1234567,"calendar":"Main","calendarID":987654,"canceled":false,"price":"0.00","duration":"30"}
   */
  async onNewAppointment(invocation) {
    const { appointmentTypeID, calendarID } = invocation.triggerData || {}

    logger.debug(`[onNewAppointment] typeID=${ appointmentTypeID } calendarID=${ calendarID }`)

    let appointments

    try {
      appointments = await this.#apiRequest({
        logTag: '[onNewAppointment]',
        url: `${ API_BASE_URL }/appointments`,
        method: 'get',
        query: {
          direction: 'DESC',
          max: 25,
          appointmentTypeID,
          calendarID,
        },
      })
    } catch (error) {
      logger.error(`[onNewAppointment] poll failed: ${ error.message }`)

      return { events: [], state: invocation.state || {} }
    }

    const list = Array.isArray(appointments) ? appointments : []

    if (invocation.learningMode) {
      return { events: list.slice(0, 1), state: null }
    }

    const lastSeenId = invocation.state?.lastSeenId

    if (lastSeenId === undefined || lastSeenId === null) {
      const newest = list.length ? Number(list[0].id) : 0

      logger.debug(`[onNewAppointment] init baseline lastSeenId=${ newest }`)

      return { events: [], state: { lastSeenId: newest } }
    }

    const fresh = list.filter(a => Number(a.id) > Number(lastSeenId))
    const maxId = list.reduce((acc, a) => Math.max(acc, Number(a.id)), Number(lastSeenId))

    // Emit oldest-first so downstream receives events in chronological order.
    const events = fresh.sort((a, b) => Number(a.id) - Number(b.id))

    return { events, state: { lastSeenId: maxId } }
  }
}

Flowrunner.ServerCode.addService(AcuityScheduling, [
  {
    name: 'userId',
    displayName: 'User ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Acuity User ID. Find it in Acuity → Integrations → API → User ID.',
  },
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Acuity API Key. Find it in Acuity → Integrations → API → API Key.',
  },
])
