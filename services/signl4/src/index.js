const logger = {
  info: (...args) => console.log('[SIGNL4] info:', ...args),
  debug: (...args) => console.log('[SIGNL4] debug:', ...args),
  error: (...args) => console.log('[SIGNL4] error:', ...args),
  warn: (...args) => console.log('[SIGNL4] warn:', ...args),
}

const API_BASE_URL = 'https://connect.signl4.com/webhook'

const ALERTING_SCENARIO_MAP = {
  'Single ACK': 'single_ack',
  'Multi ACK': 'multi_ack',
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
 * @integrationName SIGNL4
 * @integrationIcon /icon.png
 */
class Signl4Service {
  constructor(config) {
    this.teamSecret = config.teamSecret
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // All external calls go through this single private helper.
  async #apiRequest({ url, method = 'post', body, logTag }) {
    try {
      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ 'Content-Type': 'application/json' })

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const status = error.status || error.statusCode
      const message = error.body?.message ||
        (typeof error.body === 'string' && error.body) ||
        (error.body ? JSON.stringify(error.body) : undefined) ||
        error.message

      logger.error(`${ logTag } - Request failed (${ status }): ${ message }`)

      throw new Error(`SIGNL4 API error${ status ? ` (${ status })` : '' }: ${ message }`)
    }
  }

  /**
   * @operationName Send Alert
   * @category Alerting
   * @description Triggers a new SIGNL4 alert (a "signl") that is pushed to the on-call team's mobile devices with push, SMS, and voice notifications. Set an External ID (X-S4-ExternalID) to a stable, incident-specific identifier so the alert can later be closed with Resolve Alert. Choose Single ACK (first responder acknowledges for everyone) or Multi ACK (every notified person must acknowledge). Optional Service, Location, Filtering, and Source System values enrich routing and display. Returns the created event's identifier.
   * @route POST /send-alert
   * @appearanceColor #F7941D #FBB040
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Short alert title shown at the top of the notification (e.g. \"Database unreachable\")."}
   * @paramDef {"type":"String","label":"Message","name":"message","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Detailed alert text describing the incident and any context responders need."}
   * @paramDef {"type":"String","label":"Alerting Scenario","name":"alertingScenario","uiComponent":{"type":"DROPDOWN","options":{"values":["Single ACK","Multi ACK"]}},"description":"Acknowledgement mode. Single ACK: the first responder acknowledges for the whole team. Multi ACK: every notified person must acknowledge. Defaults to Single ACK."}
   * @paramDef {"type":"String","label":"External ID","name":"externalId","description":"Stable identifier for this incident from your source system. Reuse the same value with Resolve Alert to close the alert. Duplicate alerts with the same External ID are de-duplicated by SIGNL4."}
   * @paramDef {"type":"String","label":"Service","name":"service","description":"Optional service or component name the alert relates to (e.g. \"Payments API\"). Used for routing and grouping."}
   * @paramDef {"type":"String","label":"Location","name":"location","description":"Optional location as \"latitude,longitude\" (e.g. \"49.4,8.7\") to attach a map position to the alert."}
   * @paramDef {"type":"String","label":"Filtering","name":"filtering","uiComponent":{"type":"CHECKBOX"},"description":"Set to true to apply SIGNL4 alert filtering / muting rules to this alert. Defaults to false."}
   * @paramDef {"type":"String","label":"Source System","name":"sourceSystem","description":"Optional name of the originating system (e.g. \"FlowRunner\") shown on the alert for traceability."}
   *
   * @returns {Object}
   * @sampleResult {"eventId":"a1b2c3d4-0000-1111-2222-333344445555"}
   */
  async sendAlert(title, message, alertingScenario, externalId, service, location, filtering, sourceSystem) {
    const logTag = '[sendAlert]'

    const body = clean({
      'Title': title,
      'Message': message,
      'X-S4-Service': service,
      'X-S4-Location': location,
      'X-S4-AlertingScenario': this.#resolveChoice(alertingScenario, ALERTING_SCENARIO_MAP) || 'single_ack',
      'X-S4-Filtering': filtering === true || filtering === 'true' ? 'true' : undefined,
      'X-S4-ExternalID': externalId,
      'X-S4-Status': 'new',
      'X-S4-SourceSystem': sourceSystem,
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/${ this.teamSecret }`,
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Resolve Alert
   * @category Alerting
   * @description Closes an existing SIGNL4 alert by its External ID (X-S4-ExternalID). Pass the exact same External ID that was used when the alert was raised with Send Alert; SIGNL4 resolves the alert associated with that identifier and stops further escalation. Use one stable External ID per incident so Send Alert and Resolve Alert stay tied together.
   * @route POST /resolve-alert
   * @appearanceColor #F7941D #FBB040
   *
   * @paramDef {"type":"String","label":"External ID","name":"externalId","required":true,"description":"The External ID used when the alert was created with Send Alert. Must match exactly to resolve the correct alert."}
   *
   * @returns {Object}
   * @sampleResult {"eventId":"a1b2c3d4-0000-1111-2222-333344445555"}
   */
  async resolveAlert(externalId) {
    const logTag = '[resolveAlert]'

    const body = {
      'X-S4-ExternalID': externalId,
      'X-S4-Status': 'resolved',
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/${ this.teamSecret }`,
      method: 'post',
      body,
    })
  }
}

Flowrunner.ServerCode.addService(Signl4Service, [
  {
    name: 'teamSecret',
    displayName: 'Team Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'SIGNL4 -> Integrations / Team -> your team secret (the last path segment of your inbound webhook URL, e.g. the SECRET in https://connect.signl4.com/webhook/SECRET).',
  },
])
