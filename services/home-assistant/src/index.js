const logger = {
  info: (...args) => console.log('[Home Assistant] info:', ...args),
  debug: (...args) => console.log('[Home Assistant] debug:', ...args),
  error: (...args) => console.log('[Home Assistant] error:', ...args),
  warn: (...args) => console.log('[Home Assistant] warn:', ...args),
}

function clean(obj) {
  if (!obj || typeof obj !== 'object') {
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

function encodePathSegment(value) {
  return encodeURIComponent(String(value == null ? '' : value).trim())
}

/**
 * @integrationName Home Assistant
 * @integrationIcon /icon.png
 */
class HomeAssistantService {
  constructor(config) {
    // Strip any trailing slash so URLs build cleanly.
    this.serverUrl = (config.serverUrl || '').trim().replace(/\/+$/, '')
    this.accessToken = config.accessToken
    this.baseUrl = `${ this.serverUrl }/api`
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const url = `${ this.baseUrl }${ path }`

    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery || {}) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.accessToken }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const status = error.status || error.statusCode
      const message = error.body?.message || error.message || 'Unknown error'

      logger.error(`${ logTag } - failed (${ status || 'no status' }): ${ message }`)

      throw new Error(`Home Assistant API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  /**
   * @operationName Get API Status
   * @category Config & Info
   * @description Verifies that the Home Assistant API is reachable and that the configured server URL and long-lived access token are valid. Calls the API root and returns a simple running message. Use this to test connectivity before running other operations.
   * @route GET /status
   * @returns {Object}
   * @sampleResult {"message":"API running."}
   */
  async getApiStatus() {
    return this.#apiRequest({
      logTag: '[getApiStatus]',
      path: '/',
      method: 'get',
    })
  }

  /**
   * @operationName Get Config
   * @category Config & Info
   * @description Returns the current Home Assistant configuration, including location name, latitude/longitude, elevation, time zone, unit system, installed version, loaded components, and current config state. Useful for discovering server capabilities and metadata.
   * @route GET /config
   * @returns {Object}
   * @sampleResult {"latitude":32.87336,"longitude":-117.22743,"elevation":430,"unit_system":{"length":"km","mass":"g","temperature":"°C","volume":"L"},"location_name":"Home","time_zone":"America/Los_Angeles","components":["sensor","light","switch"],"version":"2024.6.0","config_dir":"/config","state":"RUNNING"}
   */
  async getConfig() {
    return this.#apiRequest({
      logTag: '[getConfig]',
      path: '/config',
      method: 'get',
    })
  }

  /**
   * @operationName Check Config
   * @category Config & Info
   * @description Validates the current Home Assistant configuration.yaml files without restarting the server. Returns a result of "valid" or "invalid" along with any error details. Requires the config integration to be enabled on the Home Assistant instance.
   * @route POST /config/check
   * @returns {Object}
   * @sampleResult {"errors":null,"result":"valid"}
   */
  async checkConfig() {
    return this.#apiRequest({
      logTag: '[checkConfig]',
      path: '/config/core/check_config',
      method: 'post',
    })
  }

  /**
   * @operationName Get States
   * @category States
   * @description Returns the current state and attributes of every entity in Home Assistant as an array of state objects. Each object includes the entity_id, state value, attributes (such as friendly_name and unit_of_measurement), and last-changed/last-updated timestamps.
   * @route GET /states
   * @returns {Array<Object>}
   * @sampleResult [{"entity_id":"light.kitchen","state":"on","attributes":{"friendly_name":"Kitchen Light","brightness":180},"last_changed":"2024-06-01T12:00:00+00:00","last_updated":"2024-06-01T12:00:00+00:00"}]
   */
  async getStates() {
    return this.#apiRequest({
      logTag: '[getStates]',
      path: '/states',
      method: 'get',
    })
  }

  /**
   * @operationName Get Entity State
   * @category States
   * @description Returns the current state and attributes of a single entity by its entity_id (for example light.kitchen or sensor.outside_temperature). Returns an error if the entity does not exist.
   * @route GET /states/entity
   * @paramDef {"type":"String","label":"Entity ID","name":"entityId","required":true,"dictionary":"getEntitiesDictionary","description":"The entity to look up, e.g. light.kitchen or sensor.outside_temperature. Pick from the list or type an entity_id directly."}
   * @returns {Object}
   * @sampleResult {"entity_id":"sensor.outside_temperature","state":"15.6","attributes":{"friendly_name":"Outside Temperature","unit_of_measurement":"°C"},"last_changed":"2024-06-01T12:00:00+00:00","last_updated":"2024-06-01T12:00:00+00:00"}
   */
  async getEntityState(entityId) {
    return this.#apiRequest({
      logTag: '[getEntityState]',
      path: `/states/${ encodePathSegment(entityId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Set State
   * @category States
   * @description Creates or updates the state of an entity in Home Assistant's state machine. Note this only changes the representation within Home Assistant and does not communicate with the actual device; to control a device, use Call Service instead. Returns the resulting state object.
   * @route POST /states/entity
   * @paramDef {"type":"String","label":"Entity ID","name":"entityId","required":true,"dictionary":"getEntitiesDictionary","description":"The entity_id to create or update, e.g. sensor.my_custom_sensor."}
   * @paramDef {"type":"String","label":"State","name":"state","required":true,"description":"The new state value to set, e.g. on, off, or a numeric reading like 21.5."}
   * @paramDef {"type":"Object","label":"Attributes","name":"attributes","description":"Optional attributes object to attach to the entity, e.g. {\"friendly_name\":\"My Sensor\",\"unit_of_measurement\":\"°C\"}."}
   * @returns {Object}
   * @sampleResult {"entity_id":"sensor.my_custom_sensor","state":"21.5","attributes":{"friendly_name":"My Sensor","unit_of_measurement":"°C"},"last_changed":"2024-06-01T12:00:00+00:00","last_updated":"2024-06-01T12:00:00+00:00"}
   */
  async setState(entityId, state, attributes) {
    return this.#apiRequest({
      logTag: '[setState]',
      path: `/states/${ encodePathSegment(entityId) }`,
      method: 'post',
      body: clean({
        state,
        attributes: attributes || {},
      }),
    })
  }

  /**
   * @operationName List Services
   * @category Services
   * @description Returns all service domains available on the Home Assistant instance and the services each domain exposes, including their fields and descriptions. Use this to discover which domain/service pairs and parameters are valid for Call Service.
   * @route GET /services
   * @returns {Array<Object>}
   * @sampleResult [{"domain":"light","services":{"turn_on":{"name":"Turn on","description":"Turn on one or more lights.","fields":{"brightness":{"description":"Number between 0 and 255."}}},"turn_off":{"name":"Turn off","description":"Turn off one or more lights."}}}]
   */
  async listServices() {
    return this.#apiRequest({
      logTag: '[listServices]',
      path: '/services',
      method: 'get',
    })
  }

  /**
   * @operationName Call Service
   * @category Services
   * @description Calls a Home Assistant service to control devices or automations, e.g. domain "light" and service "turn_on". Provide the target and any parameters via Service Data, e.g. {"entity_id":"light.kitchen","brightness":255}. Returns the list of entity states that changed as a result of the call.
   * @route POST /services/call
   * @paramDef {"type":"String","label":"Domain","name":"domain","required":true,"description":"The service domain, e.g. light, switch, climate, script, automation, or homeassistant."}
   * @paramDef {"type":"String","label":"Service","name":"service","required":true,"description":"The service to call within the domain, e.g. turn_on, turn_off, toggle, or set_temperature."}
   * @paramDef {"type":"Object","label":"Service Data","name":"serviceData","description":"Service parameters and target, e.g. {\"entity_id\":\"light.kitchen\",\"brightness\":255}. Leave empty for services that take no data."}
   * @returns {Array<Object>}
   * @sampleResult [{"entity_id":"light.kitchen","state":"on","attributes":{"friendly_name":"Kitchen Light","brightness":255},"last_changed":"2024-06-01T12:00:00+00:00","last_updated":"2024-06-01T12:00:00+00:00"}]
   */
  async callService(domain, service, serviceData) {
    return this.#apiRequest({
      logTag: '[callService]',
      path: `/services/${ encodePathSegment(domain) }/${ encodePathSegment(service) }`,
      method: 'post',
      body: serviceData || {},
    })
  }

  /**
   * @operationName List Events
   * @category Events
   * @description Returns all event types the Home Assistant instance is currently listening for, along with the number of listeners for each. Useful for discovering valid event types before firing a custom event.
   * @route GET /events
   * @returns {Array<Object>}
   * @sampleResult [{"event":"state_changed","listener_count":5},{"event":"service_registered","listener_count":1}]
   */
  async listEvents() {
    return this.#apiRequest({
      logTag: '[listEvents]',
      path: '/events',
      method: 'get',
    })
  }

  /**
   * @operationName Fire Event
   * @category Events
   * @description Fires a custom event on the Home Assistant event bus. Provide the event type and an optional event data object. Automations can be triggered by these events. Returns a confirmation message.
   * @route POST /events/fire
   * @paramDef {"type":"String","label":"Event Type","name":"eventType","required":true,"description":"The event type to fire, e.g. my_custom_event."}
   * @paramDef {"type":"Object","label":"Event Data","name":"eventData","description":"Optional event data payload, e.g. {\"entity_id\":\"light.kitchen\",\"value\":42}. Leave empty for an event with no data."}
   * @returns {Object}
   * @sampleResult {"message":"Event my_custom_event fired."}
   */
  async fireEvent(eventType, eventData) {
    return this.#apiRequest({
      logTag: '[fireEvent]',
      path: `/events/${ encodePathSegment(eventType) }`,
      method: 'post',
      body: eventData || {},
    })
  }

  /**
   * @operationName Get History
   * @category History & Logbook
   * @description Returns state-change history for one or more entities over a time period. The start timestamp defaults to one day before the request if omitted. Provide entity IDs to filter (strongly recommended for performance) and an optional end time. Returns an array of state-object arrays, one per entity.
   * @route GET /history
   * @paramDef {"type":"String","label":"Start Timestamp","name":"timestamp","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"ISO 8601 start time, e.g. 2024-06-01T00:00:00+00:00. Defaults to 1 day ago if omitted."}
   * @paramDef {"type":"String","label":"Filter Entity ID","name":"filterEntityId","dictionary":"getEntitiesDictionary","description":"Comma-separated entity IDs to include, e.g. sensor.outside_temperature,light.kitchen. Strongly recommended to limit the amount of returned data."}
   * @paramDef {"type":"String","label":"End Time","name":"endTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"ISO 8601 end time. Defaults to the current time if omitted."}
   * @paramDef {"type":"Boolean","label":"Minimal Response","name":"minimalResponse","uiComponent":{"type":"CHECKBOX"},"description":"When true, only return last_changed and state for states other than the first and last, reducing payload size."}
   * @paramDef {"type":"Boolean","label":"No Attributes","name":"noAttributes","uiComponent":{"type":"CHECKBOX"},"description":"When true, omit entity attributes from the response to reduce payload size."}
   * @paramDef {"type":"Boolean","label":"Significant Changes Only","name":"significantChangesOnly","uiComponent":{"type":"CHECKBOX"},"description":"When true, only return significant state changes rather than every update."}
   * @returns {Array<Object>}
   * @sampleResult [[{"entity_id":"sensor.outside_temperature","state":"15.6","attributes":{"unit_of_measurement":"°C"},"last_changed":"2024-06-01T00:00:00+00:00"},{"entity_id":"sensor.outside_temperature","state":"16.1","last_changed":"2024-06-01T00:30:00+00:00"}]]
   */
  async getHistory(timestamp, filterEntityId, endTime, minimalResponse, noAttributes, significantChangesOnly) {
    const path = timestamp
      ? `/history/period/${ encodePathSegment(timestamp) }`
      : '/history/period'

    return this.#apiRequest({
      logTag: '[getHistory]',
      path,
      method: 'get',
      query: {
        filter_entity_id: filterEntityId,
        end_time: endTime,
        minimal_response: minimalResponse ? '' : undefined,
        no_attributes: noAttributes ? '' : undefined,
        significant_changes_only: significantChangesOnly ? '' : undefined,
      },
    })
  }

  /**
   * @operationName Get Logbook
   * @category History & Logbook
   * @description Returns human-readable logbook entries describing what happened in Home Assistant over a time period, such as entities turning on/off and automations firing. The start timestamp defaults to one day before the request if omitted. Optionally filter by a single entity and provide an end time.
   * @route GET /logbook
   * @paramDef {"type":"String","label":"Start Timestamp","name":"timestamp","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"ISO 8601 start time, e.g. 2024-06-01T00:00:00+00:00. Defaults to 1 day ago if omitted."}
   * @paramDef {"type":"String","label":"Entity ID","name":"entity","dictionary":"getEntitiesDictionary","description":"Optional single entity_id to filter the logbook, e.g. light.kitchen."}
   * @paramDef {"type":"String","label":"End Time","name":"endTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"ISO 8601 end time. Defaults to the current time if omitted."}
   * @returns {Array<Object>}
   * @sampleResult [{"when":"2024-06-01T12:00:00+00:00","name":"Kitchen Light","message":"turned on","domain":"light","entity_id":"light.kitchen"}]
   */
  async getLogbook(timestamp, entity, endTime) {
    const path = timestamp
      ? `/logbook/${ encodePathSegment(timestamp) }`
      : '/logbook'

    return this.#apiRequest({
      logTag: '[getLogbook]',
      path,
      method: 'get',
      query: {
        entity,
        end_time: endTime,
      },
    })
  }

  /**
   * @operationName Get Error Log
   * @category History & Logbook
   * @description Returns all errors logged during the current Home Assistant session as plain text. Useful for diagnosing configuration or integration problems on the instance.
   * @route GET /error-log
   * @returns {String}
   * @sampleResult "2024-06-01 12:00:00 ERROR (MainThread) [homeassistant.components.sensor] Setup failed for sensor: Integration not found."
   */
  async getErrorLog() {
    return this.#apiRequest({
      logTag: '[getErrorLog]',
      path: '/error_log',
      method: 'get',
    })
  }

  /**
   * @operationName Render Template
   * @category Templates
   * @description Renders a Home Assistant Jinja2 template using the instance's live state and returns the resulting string. Useful for computing values from entity states, e.g. "{{ states('sensor.outside_temperature') }}" or "The sun is {{ states('sun.sun') }}".
   * @route POST /template
   * @paramDef {"type":"String","label":"Template","name":"template","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A Jinja2 template string, e.g. It is {{ now() }} and the temperature is {{ states('sensor.outside_temperature') }} degrees."}
   * @returns {String}
   * @sampleResult "It is currently 15.6 degrees outside."
   */
  async renderTemplate(template) {
    return this.#apiRequest({
      logTag: '[renderTemplate]',
      path: '/template',
      method: 'post',
      body: { template },
    })
  }

  /**
   * @operationName List Calendars
   * @category Calendars
   * @description Returns the list of calendar entities configured in Home Assistant, each with its entity_id and display name. Use an entity_id with Get Calendar Events to retrieve events.
   * @route GET /calendars
   * @returns {Array<Object>}
   * @sampleResult [{"entity_id":"calendar.family","name":"Family"},{"entity_id":"calendar.work","name":"Work"}]
   */
  async listCalendars() {
    return this.#apiRequest({
      logTag: '[listCalendars]',
      path: '/calendars',
      method: 'get',
    })
  }

  /**
   * @operationName Get Calendar Events
   * @category Calendars
   * @description Returns events from a calendar entity between a start and end time. Both timestamps are required. Each event includes a summary, start and end (as dateTime for timed events or date for all-day events), and optional description and location.
   * @route GET /calendars/events
   * @paramDef {"type":"String","label":"Calendar Entity ID","name":"entityId","required":true,"dictionary":"getCalendarsDictionary","description":"The calendar entity to query, e.g. calendar.family."}
   * @paramDef {"type":"String","label":"Start","name":"start","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"ISO 8601 start of the time range, e.g. 2024-06-01T00:00:00Z."}
   * @paramDef {"type":"String","label":"End","name":"end","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"ISO 8601 end of the time range, e.g. 2024-06-08T00:00:00Z."}
   * @returns {Array<Object>}
   * @sampleResult [{"summary":"Dentist Appointment","start":{"dateTime":"2024-06-03T09:00:00-07:00"},"end":{"dateTime":"2024-06-03T10:00:00-07:00"},"description":"Annual checkup","location":"123 Main St"}]
   */
  async getCalendarEvents(entityId, start, end) {
    return this.#apiRequest({
      logTag: '[getCalendarEvents]',
      path: `/calendars/${ encodePathSegment(entityId) }`,
      method: 'get',
      query: {
        start,
        end,
      },
    })
  }

  /**
   * @typedef {Object} getEntitiesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter entities by entity_id or friendly name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Home Assistant returns all states in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Entities Dictionary
   * @description Provides a searchable list of the instance's entities for selecting an entity_id in operations such as Get Entity State, Set State, Get History, and Get Logbook. The option value is the entity_id and the note shows the entity's friendly name.
   * @route POST /get-entities-dictionary
   * @paramDef {"type":"getEntitiesDictionary__payload","label":"Payload","name":"payload","description":"Contains the optional search string used to filter entities."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"light.kitchen","value":"light.kitchen","note":"Kitchen Light"}],"cursor":null}
   */
  async getEntitiesDictionary(payload) {
    const { search } = payload || {}

    const states = await this.#apiRequest({
      logTag: '[getEntitiesDictionary]',
      path: '/states',
      method: 'get',
    })

    const term = (search || '').toLowerCase().trim()

    const items = (Array.isArray(states) ? states : [])
      .map(state => {
        const entityId = state.entity_id
        const friendlyName = state.attributes?.friendly_name

        return {
          label: entityId,
          value: entityId,
          note: friendlyName || undefined,
        }
      })
      .filter(item => {
        if (!term) {
          return true
        }

        return item.label.toLowerCase().includes(term) ||
          (item.note && item.note.toLowerCase().includes(term))
      })

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} getCalendarsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter calendars by entity_id or name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Home Assistant returns all calendars in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Calendars Dictionary
   * @description Provides a searchable list of the instance's calendar entities for selecting a calendar in Get Calendar Events. The option value is the calendar entity_id and the note shows its display name.
   * @route POST /get-calendars-dictionary
   * @paramDef {"type":"getCalendarsDictionary__payload","label":"Payload","name":"payload","description":"Contains the optional search string used to filter calendars."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Family","value":"calendar.family","note":"calendar.family"}],"cursor":null}
   */
  async getCalendarsDictionary(payload) {
    const { search } = payload || {}

    const calendars = await this.#apiRequest({
      logTag: '[getCalendarsDictionary]',
      path: '/calendars',
      method: 'get',
    })

    const term = (search || '').toLowerCase().trim()

    const items = (Array.isArray(calendars) ? calendars : [])
      .map(calendar => ({
        label: calendar.name || calendar.entity_id,
        value: calendar.entity_id,
        note: calendar.entity_id,
      }))
      .filter(item => {
        if (!term) {
          return true
        }

        return item.value.toLowerCase().includes(term) ||
          item.label.toLowerCase().includes(term)
      })

    return { items, cursor: null }
  }
}

Flowrunner.ServerCode.addService(HomeAssistantService, [
  {
    name: 'serverUrl',
    displayName: 'Server URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Home Assistant URL, e.g. https://myhome.duckdns.org:8123 (strip any trailing slash). The service appends /api to this.',
  },
  {
    name: 'accessToken',
    displayName: 'Access Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'A long-lived access token. Create one in Home Assistant under Profile > Long-Lived Access Tokens > Create Token.',
  },
])
