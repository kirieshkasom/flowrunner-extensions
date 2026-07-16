const logger = {
  info: (...args) => console.log('[UptimeRobot] info:', ...args),
  debug: (...args) => console.log('[UptimeRobot] debug:', ...args),
  error: (...args) => console.log('[UptimeRobot] error:', ...args),
  warn: (...args) => console.log('[UptimeRobot] warn:', ...args),
}

const API_BASE_URL = 'https://api.uptimerobot.com/v2'

// Friendly-label -> API integer mappings (UptimeRobot v2 API).
const MONITOR_TYPES = { 'HTTP(S)': 1, Keyword: 2, Ping: 3, Port: 4, Heartbeat: 5 }
const MONITOR_STATUSES = { Paused: 0, 'Not Checked Yet': 1, Up: 2, 'Seems Down': 8, Down: 9 }
const KEYWORD_TYPES = { Exists: 1, 'Not Exists': 2 }
const ALERT_CONTACT_TYPES = {
  SMS: 1,
  'E-mail': 2,
  'Twitter DM': 3,
  Boxcar: 4,
  'Web-Hook': 5,
  Pushbullet: 6,
  Zapier: 7,
  'Pro SMS': 8,
  Pushover: 9,
  HipChat: 10,
  Slack: 11,
}
const MWINDOW_TYPES = { Once: 1, Daily: 2, Weekly: 3, Monthly: 4 }
const PSP_SORTS = {
  'Friendly Name (A-Z)': 1,
  'Friendly Name (Z-A)': 2,
  'Status (Up-Down-Paused)': 3,
  'Status (Down-Up-Paused)': 4,
}

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
 * @integrationName UptimeRobot
 * @integrationIcon /icon.png
 */
class UptimeRobotService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Every UptimeRobot v2 request is a POST with a form-encoded body that always
  // carries api_key and format=json. All external calls flow through this helper.
  async #apiRequest({ path, body, logTag }) {
    const url = `${ API_BASE_URL }${ path }`

    try {
      const payload = clean({
        api_key: this.apiKey,
        format: 'json',
        ...(body || {}),
      })

      logger.debug(`${ logTag } - [POST::${ url }]`)

      const response = await Flowrunner.Request.post(url)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' })
        .send(new URLSearchParams(payload).toString())

      if (response && response.stat === 'fail') {
        const message = response.error?.message || response.error?.type || 'Unknown error'
        throw new Error(`UptimeRobot API error: ${ message }`)
      }

      return response
    } catch (error) {
      if (error.message && error.message.startsWith('UptimeRobot API error:')) {
        throw error
      }

      const message = error.body?.error?.message || error.body?.message || error.message
      logger.error(`${ logTag } - failed: ${ message }`)
      throw new Error(`UptimeRobot API error: ${ message }`)
    }
  }

  /**
   * @operationName Get Monitors
   * @category Monitors
   * @description Retrieves monitors from the account, optionally filtered by specific monitor IDs, a keyword search, monitor types, or statuses. Can additionally include recent event logs and response-time data for each monitor. Supports pagination via offset and limit (max 50 per page).
   * @route POST /get-monitors
   * @paramDef {"type":"String","label":"Monitor IDs","name":"monitors","description":"Optional dash-separated monitor IDs to fetch, e.g. \"15830-32696-83920\". Leave empty to return all monitors."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional keyword to filter monitors by friendly name or URL."}
   * @paramDef {"type":"Array<String>","label":"Types","name":"types","uiComponent":{"type":"DROPDOWN","options":{"values":["HTTP(S)","Keyword","Ping","Port","Heartbeat"]}},"description":"Optional list of monitor types to include. Leave empty for all types."}
   * @paramDef {"type":"Array<String>","label":"Statuses","name":"statuses","uiComponent":{"type":"DROPDOWN","options":{"values":["Paused","Not Checked Yet","Up","Seems Down","Down"]}},"description":"Optional list of monitor statuses to include. Leave empty for all statuses."}
   * @paramDef {"type":"Boolean","label":"Include Logs","name":"logs","uiComponent":{"type":"TOGGLE"},"description":"When enabled, includes recent event logs for each monitor. Defaults to false."}
   * @paramDef {"type":"Boolean","label":"Include Response Times","name":"responseTimes","uiComponent":{"type":"TOGGLE"},"description":"When enabled, includes recent response-time measurements for each monitor. Defaults to false."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset (record number to start from). Defaults to 0."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of monitors to return per page (max 50). Defaults to 50."}
   * @returns {Object}
   * @sampleResult {"stat":"ok","pagination":{"offset":0,"limit":50,"total":1},"monitors":[{"id":777749809,"friendly_name":"Google","url":"http://www.google.com","type":1,"status":2,"interval":300,"create_datetime":1462565497}]}
   */
  async getMonitors(monitors, search, types, statuses, logs, responseTimes, offset, limit) {
    const logTag = '[getMonitors]'

    return await this.#apiRequest({
      logTag,
      path: '/getMonitors',
      body: {
        monitors,
        search,
        types: this.#mapListToInts(types, MONITOR_TYPES),
        statuses: this.#mapListToInts(statuses, MONITOR_STATUSES),
        logs: logs ? 1 : undefined,
        response_times: responseTimes ? 1 : undefined,
        offset,
        limit,
      },
    })
  }

  /**
   * @operationName Create Monitor
   * @category Monitors
   * @description Creates a new monitor. Supports HTTP(S), Keyword, Ping, Port, and Heartbeat monitor types. For Keyword monitors, provide the keyword type and value. Optionally set the check interval and assign alert contacts so notifications are sent when the monitor goes up or down.
   * @route POST /create-monitor
   * @paramDef {"type":"String","label":"Friendly Name","name":"friendlyName","required":true,"description":"Human-readable name for the monitor."}
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"URL or host to monitor. For Heartbeat monitors this is the endpoint UptimeRobot expects pings from."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["HTTP(S)","Keyword","Ping","Port","Heartbeat"]}},"description":"The monitor type. Keyword requires a keyword value; Port requires a port number."}
   * @paramDef {"type":"Number","label":"Interval","name":"interval","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Check interval in seconds (minimum depends on plan; e.g. 300 for 5 minutes)."}
   * @paramDef {"type":"String","label":"Keyword Type","name":"keywordType","uiComponent":{"type":"DROPDOWN","options":{"values":["Exists","Not Exists"]}},"description":"For Keyword monitors: whether to alert when the keyword exists or when it does not exist on the page."}
   * @paramDef {"type":"String","label":"Keyword Value","name":"keywordValue","description":"For Keyword monitors: the keyword to search for in the response body."}
   * @paramDef {"type":"Number","label":"Port","name":"port","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"For Port monitors: the port number to check."}
   * @paramDef {"type":"String","label":"Alert Contacts","name":"alertContacts","dictionary":"getAlertContactsDictionary","description":"Optional alert contacts to notify, formatted as \"contactId_threshold_recurrence\" and dash-separated for multiple, e.g. \"457_0_0-373_5_0\". A bare contact ID also works."}
   * @returns {Object}
   * @sampleResult {"stat":"ok","monitor":{"id":777810874,"status":1}}
   */
  async createMonitor(friendlyName, url, type, interval, keywordType, keywordValue, port, alertContacts) {
    const logTag = '[createMonitor]'

    return await this.#apiRequest({
      logTag,
      path: '/newMonitor',
      body: {
        friendly_name: friendlyName,
        url,
        type: this.#resolveChoice(type, MONITOR_TYPES),
        interval,
        keyword_type: this.#resolveChoice(keywordType, KEYWORD_TYPES),
        keyword_value: keywordValue,
        port,
        alert_contacts: alertContacts,
      },
    })
  }

  /**
   * @operationName Edit Monitor
   * @category Monitors
   * @description Updates an existing monitor. Any provided field is changed; omitted fields are left untouched. Use the Status field to pause (0) or resume (1) a monitor. Note that the monitor type itself cannot be changed after creation.
   * @route POST /edit-monitor
   * @paramDef {"type":"String","label":"Monitor ID","name":"id","required":true,"dictionary":"getMonitorsDictionary","description":"ID of the monitor to edit."}
   * @paramDef {"type":"String","label":"Friendly Name","name":"friendlyName","description":"New human-readable name for the monitor."}
   * @paramDef {"type":"String","label":"URL","name":"url","description":"New URL or host to monitor."}
   * @paramDef {"type":"Number","label":"Interval","name":"interval","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New check interval in seconds."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Paused","Resumed"]}},"description":"Set to Paused to pause monitoring or Resumed to resume it."}
   * @paramDef {"type":"String","label":"Keyword Type","name":"keywordType","uiComponent":{"type":"DROPDOWN","options":{"values":["Exists","Not Exists"]}},"description":"For Keyword monitors: whether to alert when the keyword exists or does not exist."}
   * @paramDef {"type":"String","label":"Keyword Value","name":"keywordValue","description":"For Keyword monitors: the keyword to search for in the response body."}
   * @paramDef {"type":"String","label":"Alert Contacts","name":"alertContacts","dictionary":"getAlertContactsDictionary","description":"Alert contacts to notify, formatted as \"contactId_threshold_recurrence\" and dash-separated for multiple, e.g. \"457_0_0-373_5_0\"."}
   * @returns {Object}
   * @sampleResult {"stat":"ok","monitor":{"id":677810870}}
   */
  async editMonitor(id, friendlyName, url, interval, status, keywordType, keywordValue, alertContacts) {
    const logTag = '[editMonitor]'

    return await this.#apiRequest({
      logTag,
      path: '/editMonitor',
      body: {
        id,
        friendly_name: friendlyName,
        url,
        interval,
        status: this.#resolveChoice(status, { Paused: 0, Resumed: 1 }),
        keyword_type: this.#resolveChoice(keywordType, KEYWORD_TYPES),
        keyword_value: keywordValue,
        alert_contacts: alertContacts,
      },
    })
  }

  /**
   * @operationName Delete Monitor
   * @category Monitors
   * @description Permanently deletes a monitor and all of its associated logs and statistics. This action cannot be undone.
   * @route POST /delete-monitor
   * @paramDef {"type":"String","label":"Monitor ID","name":"id","required":true,"dictionary":"getMonitorsDictionary","description":"ID of the monitor to delete."}
   * @returns {Object}
   * @sampleResult {"stat":"ok","monitor":{"id":677810870}}
   */
  async deleteMonitor(id) {
    const logTag = '[deleteMonitor]'

    return await this.#apiRequest({
      logTag,
      path: '/deleteMonitor',
      body: { id },
    })
  }

  /**
   * @operationName Reset Monitor
   * @category Monitors
   * @description Resets a monitor by deleting all of its accumulated statistics and logs while keeping the monitor itself in place. Useful for starting fresh uptime tracking without recreating the monitor.
   * @route POST /reset-monitor
   * @paramDef {"type":"String","label":"Monitor ID","name":"id","required":true,"dictionary":"getMonitorsDictionary","description":"ID of the monitor to reset."}
   * @returns {Object}
   * @sampleResult {"stat":"ok","monitor":{"id":677810870}}
   */
  async resetMonitor(id) {
    const logTag = '[resetMonitor]'

    return await this.#apiRequest({
      logTag,
      path: '/resetMonitor',
      body: { id },
    })
  }

  /**
   * @operationName Get Alert Contacts
   * @category Alert Contacts
   * @description Retrieves the alert contacts configured on the account (e-mail addresses, SMS numbers, webhooks, integrations, etc.). Optionally filter by specific contact IDs and paginate with offset and limit.
   * @route POST /get-alert-contacts
   * @paramDef {"type":"String","label":"Alert Contact IDs","name":"alertContacts","description":"Optional dash-separated alert contact IDs to fetch, e.g. \"236-1782-4790\". Leave empty to return all."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset. Defaults to 0."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records to return per page (max 50). Defaults to 50."}
   * @returns {Object}
   * @sampleResult {"stat":"ok","pagination":{"offset":0,"limit":50,"total":1},"alert_contacts":[{"id":"236","friendly_name":"John Doe","type":2,"status":2,"value":"john@example.com"}]}
   */
  async getAlertContacts(alertContacts, offset, limit) {
    const logTag = '[getAlertContacts]'

    return await this.#apiRequest({
      logTag,
      path: '/getAlertContacts',
      body: { alert_contacts: alertContacts, offset, limit },
    })
  }

  /**
   * @operationName Create Alert Contact
   * @category Alert Contacts
   * @description Creates a new alert contact that monitors can notify when their status changes. Choose the contact type (e-mail, SMS, webhook, or a supported integration) and provide the destination value. Note that some contact types require activation before they become usable.
   * @route POST /create-alert-contact
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["SMS","E-mail","Twitter DM","Boxcar","Web-Hook","Pushbullet","Zapier","Pro SMS","Pushover","HipChat","Slack"]}},"description":"The alert contact channel type."}
   * @paramDef {"type":"String","label":"Value","name":"value","required":true,"description":"The destination for the contact, e.g. an e-mail address, phone number, or webhook URL, depending on the type."}
   * @paramDef {"type":"String","label":"Friendly Name","name":"friendlyName","required":true,"description":"Human-readable name for the alert contact."}
   * @returns {Object}
   * @sampleResult {"stat":"ok","alertcontact":{"id":"4864613","status":0}}
   */
  async createAlertContact(type, value, friendlyName) {
    const logTag = '[createAlertContact]'

    return await this.#apiRequest({
      logTag,
      path: '/newAlertContact',
      body: {
        type: this.#resolveChoice(type, ALERT_CONTACT_TYPES),
        value,
        friendly_name: friendlyName,
      },
    })
  }

  /**
   * @operationName Delete Alert Contact
   * @category Alert Contacts
   * @description Permanently deletes an alert contact. Monitors that referenced this contact will no longer notify it.
   * @route POST /delete-alert-contact
   * @paramDef {"type":"String","label":"Alert Contact ID","name":"id","required":true,"dictionary":"getAlertContactsDictionary","description":"ID of the alert contact to delete."}
   * @returns {Object}
   * @sampleResult {"stat":"ok","alert_contact":{"id":"4864613"}}
   */
  async deleteAlertContact(id) {
    const logTag = '[deleteAlertContact]'

    return await this.#apiRequest({
      logTag,
      path: '/deleteAlertContact',
      body: { id },
    })
  }

  /**
   * @operationName Get Maintenance Windows
   * @category Maintenance Windows
   * @description Retrieves the maintenance windows configured on the account. During a maintenance window, alerts for the affected monitors are suppressed. Optionally filter by specific maintenance window IDs and paginate with offset and limit.
   * @route POST /get-maintenance-windows
   * @paramDef {"type":"String","label":"Maintenance Window IDs","name":"mwindows","description":"Optional dash-separated maintenance window IDs to fetch, e.g. \"345-2986-71\". Leave empty to return all."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset. Defaults to 0."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records to return per page (max 50). Defaults to 50."}
   * @returns {Object}
   * @sampleResult {"stat":"ok","pagination":{"offset":0,"limit":50,"total":1},"mwindows":[{"id":1234,"type":2,"friendly_name":"Nightly Backup","start_time":"03:00","duration":60,"value":"","status":1}]}
   */
  async getMWindows(mwindows, offset, limit) {
    const logTag = '[getMWindows]'

    return await this.#apiRequest({
      logTag,
      path: '/getMWindows',
      body: { mwindows, offset, limit },
    })
  }

  /**
   * @operationName Create Maintenance Window
   * @category Maintenance Windows
   * @description Creates a maintenance window during which monitor alerts are suppressed. Choose how often it recurs (once, daily, weekly, or monthly). For weekly windows, Value is dash-separated weekday numbers (1=Monday ... 7=Sunday); for monthly windows, Value is dash-separated day-of-month numbers. Once windows use a full date-time start; recurring windows use a time-of-day start (HH:mm).
   * @route POST /create-maintenance-window
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Once","Daily","Weekly","Monthly"]}},"description":"How often the maintenance window recurs."}
   * @paramDef {"type":"String","label":"Friendly Name","name":"friendlyName","required":true,"description":"Human-readable name for the maintenance window."}
   * @paramDef {"type":"String","label":"Start Time","name":"startTime","required":true,"description":"Start of the window. For Once use a Unix timestamp or full date-time; for Daily/Weekly/Monthly use a time of day as HH:mm."}
   * @paramDef {"type":"Number","label":"Duration","name":"duration","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Duration of the window in minutes."}
   * @paramDef {"type":"String","label":"Value","name":"value","description":"For Weekly, dash-separated weekday numbers (1=Monday ... 7=Sunday). For Monthly, dash-separated day-of-month numbers. Not used for Once or Daily."}
   * @returns {Object}
   * @sampleResult {"stat":"ok","mwindow":{"id":1234,"status":1}}
   */
  async createMWindow(type, friendlyName, startTime, duration, value) {
    const logTag = '[createMWindow]'

    return await this.#apiRequest({
      logTag,
      path: '/newMWindow',
      body: {
        type: this.#resolveChoice(type, MWINDOW_TYPES),
        friendly_name: friendlyName,
        start_time: startTime,
        duration,
        value,
      },
    })
  }

  /**
   * @operationName Delete Maintenance Window
   * @category Maintenance Windows
   * @description Permanently deletes a maintenance window. Alerts will no longer be suppressed on its schedule.
   * @route POST /delete-maintenance-window
   * @paramDef {"type":"String","label":"Maintenance Window ID","name":"id","required":true,"description":"ID of the maintenance window to delete."}
   * @returns {Object}
   * @sampleResult {"stat":"ok","mwindow":{"id":1234}}
   */
  async deleteMWindow(id) {
    const logTag = '[deleteMWindow]'

    return await this.#apiRequest({
      logTag,
      path: '/deleteMWindow',
      body: { id },
    })
  }

  /**
   * @operationName Get Public Status Pages
   * @category Public Status Pages
   * @description Retrieves the public status pages (PSPs) configured on the account. Each PSP exposes the status of selected monitors on a shareable page. Optionally filter by specific PSP IDs and paginate with offset and limit.
   * @route POST /get-public-status-pages
   * @paramDef {"type":"String","label":"PSP IDs","name":"psps","description":"Optional dash-separated public status page IDs to fetch, e.g. \"1780-4790-8930\". Leave empty to return all."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset. Defaults to 0."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records to return per page (max 50). Defaults to 50."}
   * @returns {Object}
   * @sampleResult {"stat":"ok","pagination":{"offset":0,"limit":50,"total":1},"psps":[{"id":1780,"friendly_name":"Public Page","monitors":2,"sort":1,"status":1,"standard_url":"https://stats.uptimerobot.com/abc123"}]}
   */
  async getPSPs(psps, offset, limit) {
    const logTag = '[getPSPs]'

    return await this.#apiRequest({
      logTag,
      path: '/getPSPs',
      body: { psps, offset, limit },
    })
  }

  /**
   * @operationName Create Public Status Page
   * @category Public Status Pages
   * @description Creates a public status page (PSP) that displays the status of selected monitors on a shareable URL. Provide the monitors to include, an optional password to protect the page, and a sort order for how monitors are listed.
   * @route POST /create-public-status-page
   * @paramDef {"type":"String","label":"Friendly Name","name":"friendlyName","required":true,"description":"Human-readable name for the public status page."}
   * @paramDef {"type":"String","label":"Monitors","name":"monitors","required":true,"description":"Monitors to display. Use \"0\" for all monitors, or dash-separated monitor IDs, e.g. \"15830-32696-83920\"."}
   * @paramDef {"type":"String","label":"Password","name":"password","description":"Optional password to protect the page."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","uiComponent":{"type":"DROPDOWN","options":{"values":["Friendly Name (A-Z)","Friendly Name (Z-A)","Status (Up-Down-Paused)","Status (Down-Up-Paused)"]}},"description":"Order in which monitors are listed on the page."}
   * @returns {Object}
   * @sampleResult {"stat":"ok","psp":{"id":1780,"status":1,"standard_url":"https://stats.uptimerobot.com/abc123"}}
   */
  async createPSP(friendlyName, monitors, password, sort) {
    const logTag = '[createPSP]'

    return await this.#apiRequest({
      logTag,
      path: '/newPSP',
      body: {
        friendly_name: friendlyName,
        monitors,
        password,
        sort: this.#resolveChoice(sort, PSP_SORTS),
      },
    })
  }

  /**
   * @operationName Delete Public Status Page
   * @category Public Status Pages
   * @description Permanently deletes a public status page. Its shareable URL will no longer be accessible.
   * @route POST /delete-public-status-page
   * @paramDef {"type":"String","label":"PSP ID","name":"id","required":true,"description":"ID of the public status page to delete."}
   * @returns {Object}
   * @sampleResult {"stat":"ok","psp":{"id":1780}}
   */
  async deletePSP(id) {
    const logTag = '[deletePSP]'

    return await this.#apiRequest({
      logTag,
      path: '/deletePSP',
      body: { id },
    })
  }

  /**
   * @operationName Get Account Details
   * @category Account
   * @description Retrieves account details including the plan's monitor limit, the minimum monitoring interval, and counts of up, down, and paused monitors. Useful as a connection check to verify the API key is valid.
   * @route POST /get-account-details
   * @returns {Object}
   * @sampleResult {"stat":"ok","account":{"email":"test@domain.com","user_id":123456,"monitor_limit":50,"monitor_interval":1,"up_monitors":1,"down_monitors":0,"paused_monitors":2}}
   */
  async getAccountDetails() {
    const logTag = '[getAccountDetails]'

    return await this.#apiRequest({
      logTag,
      path: '/getAccountDetails',
      body: {},
    })
  }

  /**
   * @typedef {Object} getAlertContactsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter alert contacts by friendly name or value."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (numeric offset) for fetching the next page of alert contacts."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Alert Contacts Dictionary
   * @description Provides a selectable list of alert contacts for parameters that reference a contact. Each option's value is the alert contact ID.
   * @route POST /get-alert-contacts-dictionary
   * @paramDef {"type":"getAlertContactsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"John Doe","value":"236","note":"john@example.com"}],"cursor":"50"}
   */
  async getAlertContactsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getAlertContactsDictionary]'
    const limit = 50
    const offset = cursor ? Number(cursor) : 0

    const response = await this.#apiRequest({
      logTag,
      path: '/getAlertContacts',
      body: { offset, limit },
    })

    const contacts = response.alert_contacts || []
    const term = (search || '').toLowerCase()

    const items = contacts
      .filter(contact => {
        if (!term) {
          return true
        }

        return `${ contact.friendly_name || '' } ${ contact.value || '' }`.toLowerCase().includes(term)
      })
      .map(contact => ({
        label: contact.friendly_name || contact.value || String(contact.id),
        value: String(contact.id),
        note: contact.value || undefined,
      }))

    const total = response.pagination?.total ?? contacts.length
    const nextOffset = offset + limit
    const nextCursor = nextOffset < total ? String(nextOffset) : undefined

    return { items, cursor: nextCursor }
  }

  /**
   * @typedef {Object} getMonitorsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter monitors by friendly name or URL."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (numeric offset) for fetching the next page of monitors."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Monitors Dictionary
   * @description Provides a selectable list of monitors for parameters that reference a monitor. Each option's value is the monitor ID.
   * @route POST /get-monitors-dictionary
   * @paramDef {"type":"getMonitorsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Google","value":"777749809","note":"http://www.google.com"}],"cursor":"50"}
   */
  async getMonitorsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getMonitorsDictionary]'
    const limit = 50
    const offset = cursor ? Number(cursor) : 0

    const response = await this.#apiRequest({
      logTag,
      path: '/getMonitors',
      body: { search, offset, limit },
    })

    const monitors = response.monitors || []

    const items = monitors.map(monitor => ({
      label: monitor.friendly_name || monitor.url || String(monitor.id),
      value: String(monitor.id),
      note: monitor.url || undefined,
    }))

    const total = response.pagination?.total ?? monitors.length
    const nextOffset = offset + limit
    const nextCursor = nextOffset < total ? String(nextOffset) : undefined

    return { items, cursor: nextCursor }
  }

  // Maps an array of friendly labels to a dash-separated string of API integers,
  // matching UptimeRobot's expected filter format (e.g. "1-3-5").
  #mapListToInts(values, mapping) {
    if (!Array.isArray(values) || values.length === 0) {
      return undefined
    }

    const mapped = values
      .map(value => this.#resolveChoice(value, mapping))
      .filter(value => value !== undefined && value !== null && value !== '')

    return mapped.length > 0 ? mapped.join('-') : undefined
  }
}

Flowrunner.ServerCode.addService(UptimeRobotService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your UptimeRobot Main API Key. Find it in UptimeRobot under My Settings -> API -> Main API Key.',
  },
])
