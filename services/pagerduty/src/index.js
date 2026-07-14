// PagerDuty incident management - incidents, services, escalation policies, schedules,
// users, teams, on-call, maintenance windows, tags, and business services (OAuth2).

// ============================================================================
//  CONSTANTS
// ============================================================================
const API_BASE = 'https://api.pagerduty.com'
const OAUTH_AUTHORIZE_URL = 'https://identity.pagerduty.com/oauth/authorize'
const OAUTH_TOKEN_URL = 'https://identity.pagerduty.com/oauth/token'
const PD_ACCEPT = 'application/vnd.pagerduty+json;version=2'

// Events API v2 lives on a separate host and is authenticated by a per-service routing key in the
// request body, not by the OAuth access token used for the REST API above.
const EVENTS_API_BASE = 'https://events.pagerduty.com/v2'

// Scopes are hardcoded (not a config item). PagerDuty grants the subset it recognizes and never
// errors on an unknown scope, so an over-broad list is safe. Strings quoted from each endpoint's
// "Scoped OAuth requires" note in openapiv3.json.
const DEFAULT_SCOPE_LIST = [
  'openid',
  'incidents.read', 'incidents.write',
  'services.read', 'services.write',
  'escalation_policies.read', 'escalation_policies.write',
  'schedules.read', 'schedules.write',
  'users.read', 'users.write',
  'users:contact_methods.read', 'users:contact_methods.write',
  'teams.read', 'teams.write',
  'oncalls.read',
  'priorities.read',
  'tags.read', 'tags.write',
]
const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const PAGE_SIZE = 25

// Friendly DROPDOWN labels the UI shows, mapped to the API values PagerDuty expects.
const URGENCY_MAP = { High: 'high', Low: 'low' }
const INCIDENT_STATUS_MAP = { Triggered: 'triggered', Acknowledged: 'acknowledged', Resolved: 'resolved' }
const ALERT_CREATION_MAP = { 'Create Alerts And Incidents': 'create_alerts_and_incidents', 'Create Incidents': 'create_incidents' }
const SERVICE_STATUS_MAP = { Active: 'active', Disabled: 'disabled' }
const USER_ROLE_MAP = {
  Admin: 'admin',
  'Responder (User)': 'user',
  'Limited User': 'limited_user',
  Observer: 'observer',
  'Read-only User': 'read_only_user',
  'Restricted Access': 'restricted_access',
  Owner: 'owner',
}
const TEAM_ROLE_MAP = { Manager: 'manager', Responder: 'responder', Observer: 'observer' }
const MAINTENANCE_WINDOW_FILTER_MAP = { Past: 'past', Future: 'future', Ongoing: 'ongoing' }
const ENTITY_TYPE_MAP = { Users: 'users', Teams: 'teams', 'Escalation Policies': 'escalation_policies' }
const SEVERITY_MAP = { Critical: 'critical', Error: 'error', Warning: 'warning', Info: 'info' }

const ERROR_HINTS = {
  401: 'Authentication failed — reconnect the PagerDuty account.',
  402: 'This feature is not enabled on your PagerDuty plan.',
  403: 'Access denied — the connected account is missing the required scope; reconnect with broader access.',
  404: 'Not found — the ID may be wrong; use the matching list action to pick a valid one.',
  429: 'Rate limit hit — retry in a moment.',
}

// ============================================================================
//  LOGGER
// ============================================================================
const logger = {
  info: (...args) => console.log('[PagerDuty] info:', ...args),
  debug: (...args) => console.log('[PagerDuty] debug:', ...args),
  error: (...args) => console.log('[PagerDuty] error:', ...args),
  warn: (...args) => console.log('[PagerDuty] warn:', ...args),
}

// Shallow-strips undefined/null/'' values so optional Events API v2 fields are omitted rather
// than sent as null (PagerDuty rejects some fields when explicitly null).
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

// ============================================================================
//  DICTIONARY PAYLOAD TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} getServicesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter services by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for the next page of results."}
 */

/**
 * @typedef {Object} getEscalationPoliciesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter escalation policies by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for the next page of results."}
 */

/**
 * @typedef {Object} getPrioritiesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter priorities by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for the next page of results."}
 */

/**
 * @typedef {Object} getUsersDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter users by name or email."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for the next page of results."}
 */

/**
 * @typedef {Object} getTeamsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter teams by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for the next page of results."}
 */

/**
 * @typedef {Object} getSchedulesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter schedules by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for the next page of results."}
 */

/**
 * @typedef {Object} getIncidentsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter open incidents by title."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for the next page of results."}
 */

/**
 * @typedef {Object} getIncidentAlertsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Incident","name":"incidentId","description":"The incident whose alerts populate the list."}
 */

/**
 * @typedef {Object} getIncidentAlertsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter alerts by summary."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for the next page of results."}
 * @paramDef {"type":"getIncidentAlertsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The incident whose alerts to list."}
 */

/**
 * @typedef {Object} getMaintenanceWindowsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter maintenance windows by description."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for the next page of results."}
 */

/**
 * @typedef {Object} getBusinessServicesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter business services by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for the next page of results."}
 */

/**
 * @typedef {Object} getTagsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter tags by label."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for the next page of results."}
 */

/**
 * @integrationName PagerDuty
 * @integrationIcon /icon.svg
 * @requireOAuth
 * @integrationTriggersScope SINGLE_APP
 */
class PagerDuty {
  constructor(config) {
    this.config = config || {}
    this.clientId = this.config.clientId
    this.clientSecret = this.config.clientSecret
    this.eventsRoutingKey = this.config.eventsRoutingKey
  }

  // ==========================================================================
  //  CORE - every external call goes through #apiRequest
  // ==========================================================================
  async #apiRequest({ url, method, body, query, fromEmail, logTag }) {
    method = method || 'get'

    try {
      logger.debug(`${ logTag } ${ method.toUpperCase() } ${ url }`)

      const request = Flowrunner.Request[method](url)
        .set(this.#headers(body !== undefined, fromEmail))
        .query(query || {})

      if (body !== undefined) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      this.#handleError(error, logTag)
    }
  }

  #headers(hasBody, fromEmail) {
    const headers = {
      Authorization: `Bearer ${ this.#getAccessToken() }`,
      Accept: PD_ACCEPT,
    }

    if (hasBody) {
      headers['Content-Type'] = 'application/json'
    }

    if (fromEmail) {
      headers.From = fromEmail
    }

    return headers
  }

  #handleError(error, logTag) {
    const status = error?.status || error?.body?.status || error?.code
    const apiMessage =
      error?.body?.error?.errors?.[0] ||
      error?.body?.error?.message ||
      error?.body?.message ||
      error?.message ||
      'Request failed'
    const hint = ERROR_HINTS[status]

    logger.error(`${ logTag } failed: ${ apiMessage }`)

    throw new Error(hint ? `${ hint } (${ apiMessage })` : apiMessage)
  }

  // Translate a friendly DROPDOWN label into the API value; pass through anything unmapped.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // ==========================================================================
  //  EVENTS API v2 - separate host, no OAuth. Auth is the routing key in the body.
  // ==========================================================================
  // Every Events API v2 call goes through here. Unlike #apiRequest (REST API, OAuth bearer
  // token), this posts unauthenticated to events.pagerduty.com - the integration routing key
  // carried in the JSON body is what authorizes and routes the event.
  async #eventsRequest(url, body) {
    try {
      logger.debug(`eventsRequest POST ${ url }`)

      return await Flowrunner.Request.post(url)
        .set({ 'Content-Type': 'application/json' })
        .send(clean(body))
    } catch (error) {
      const apiMessage =
        (Array.isArray(error?.body?.errors) && error.body.errors.join(', ')) ||
        error?.body?.message ||
        error?.message ||
        'Request failed'

      logger.error(`eventsRequest failed: ${ apiMessage }`)

      throw new Error(apiMessage)
    }
  }

  // Resolves the routing key for an Events API v2 call: the per-call override if supplied,
  // otherwise the service-level default from config. Throws a clear error if neither is set,
  // since PagerDuty would otherwise reject the event with an opaque 400.
  #resolveRoutingKey(routingKey) {
    const key = routingKey || this.eventsRoutingKey

    if (!key) {
      throw new Error(
        'A Routing Key is required. Either set the Events API Routing Key in this service\'s configuration, ' +
        'or provide a Routing Key Override for this call.'
      )
    }

    return key
  }

  // Splits an Array.<String> param that may also arrive as a comma-separated string.
  #toList(value) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    const list = Array.isArray(value)
      ? value
      : String(value).split(',').map(part => part.trim()).filter(Boolean)

    return list.length ? list : undefined
  }

  // Resolves the acting-user email for the From header that PagerDuty requires on these writes.
  // Uses the explicit override if the user supplied one, otherwise looks up the connected
  // account's own email via GET /users/me (the authenticated OAuth user). Throws a plain-English
  // error if neither is available, since the write would 400 without a valid From email.
  // docs: openapiv3.json GET /users/me response example (response.user.email)
  async #resolveFromEmail(explicit) {
    if (explicit) {
      return explicit
    }

    let me

    try {
      me = await this.#apiRequest({ url: `${ API_BASE }/users/me`, logTag: 'resolveFromEmail' })
    } catch (error) {
      throw new Error(
        'From (User Email) is required for this action and the connected account email could not be looked up. ' +
        'Provide the email of a PagerDuty user in the From (User Email) field.'
      )
    }

    const email = me && me.user && me.user.email

    if (!email) {
      throw new Error(
        'From (User Email) is required for this action. Provide the email of a PagerDuty user in the From (User Email) field.'
      )
    }

    return email
  }

  // The offset cursor for a list response: the next offset when `more` is true, else null.
  #nextOffsetCursor(result) {
    if (result && result.more) {
      return String((Number(result.offset) || 0) + (Number(result.limit) || PAGE_SIZE))
    }

    return null
  }

  // Cursor for a dictionary that filters the fetched page by a typed term in-process (the list
  // endpoint has no name query). Keep paging while the page yields matches, but drop the "load
  // more" once a term has filtered the whole page out — an empty list plus a load-more button is
  // misleading, since the next page is filtered the same way.
  #filteredCursor(result, term, items) {
    if (term && items.length === 0) return null

    return this.#nextOffsetCursor(result)
  }

  // ==========================================================================
  //  OAUTH2 SYSTEM METHODS
  // ==========================================================================
  #getAccessToken() {
    return this.request.headers['oauth-access-token']
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   */
  async getOAuth2ConnectionURL() {
    // docs: https://developer.pagerduty.com/docs/user-oauth-token-via-code-grant
    // redirect_uri is injected by the FlowRunner platform - do not append it here.
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      scope: DEFAULT_SCOPE_STRING,
    })

    return `${ OAUTH_AUTHORIZE_URL }?${ params.toString() }`
  }

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   */
  async executeCallback(callbackObject) {
    // docs: https://developer.pagerduty.com/docs/user-oauth-token-via-code-grant
    const tokenResponse = await Flowrunner.Request.post(OAUTH_TOKEN_URL)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(
        new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code: callbackObject.code,
          redirect_uri: callbackObject.redirectURI,
        }).toString()
      )

    const me = await Flowrunner.Request.get(`${ API_BASE }/users/me`)
      .set({ Authorization: `Bearer ${ tokenResponse.access_token }`, Accept: PD_ACCEPT })
    const user = (me && me.user) || {}

    return {
      token: tokenResponse.access_token,
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token,
      connectionIdentityName: user.name || user.email || null,
      connectionIdentityImageURL: user.avatar_url || null,
      overwrite: true,
    }
  }

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   */
  async refreshToken(refreshToken) {
    // docs: https://developer.pagerduty.com/docs/app-oauth-token
    const tokenResponse = await Flowrunner.Request.post(OAUTH_TOKEN_URL)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: this.clientId,
          client_secret: this.clientSecret,
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
  //  INCIDENTS
  // ==========================================================================
  /**
   * @operationName Create Incident
   * @category Incidents
   * @description Opens a new incident on a PagerDuty service, paging the on-call responders. Use this to raise an alert from a flow - e.g. when a downstream check fails or a customer reports an outage.
   * @route POST /create-incident
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Short summary of the problem. Becomes the incident headline."}
   * @paramDef {"type":"String","label":"Service","name":"serviceId","required":true,"dictionary":"getServicesDictionary","description":"The service the incident is raised against. Pick from your PagerDuty services."}
   * @paramDef {"type":"String","label":"Urgency","name":"urgency","uiComponent":{"type":"DROPDOWN","options":{"values":["High","Low"]}},"description":"How urgently responders are paged. Defaults to the service's urgency rule."}
   * @paramDef {"type":"String","label":"Priority","name":"priorityId","dictionary":"getPrioritiesDictionary","description":"Optional priority level (P1-P5). Use List Priorities to choose."}
   * @paramDef {"type":"String","label":"Escalation Policy","name":"escalationPolicyId","dictionary":"getEscalationPoliciesDictionary","description":"Optional escalation policy override. Defaults to the service's policy."}
   * @paramDef {"type":"String","label":"Details","name":"details","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Longer description of the incident (the incident body details)."}
   * @paramDef {"type":"String","label":"Deduplication Key","name":"incidentKey","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional key to deduplicate repeated triggers into one incident."}
   * @paramDef {"type":"String","label":"From (User Email)","name":"fromEmail","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Email of the PagerDuty user creating the incident (the From header). Defaults to the connected account's email."}
   * @returns {Object}
   * @sampleResult {"incident":{"id":"PT4KHLK","incident_number":1234,"title":"The server is on fire.","status":"triggered","urgency":"high","service":{"id":"PIJ90N7","type":"service_reference"},"html_url":"https://subdomain.pagerduty.com/incidents/PT4KHLK","created_at":"2015-10-06T21:30:42Z"}}
   */
  async createIncident(title, serviceId, urgency, priorityId, escalationPolicyId, details, incidentKey, fromEmail) {
    // docs: openapiv3.json POST /incidents requestBody example
    if (!title) throw new Error('Title is required.')
    if (!serviceId) throw new Error('Service is required — use Get Services to pick one.')

    const incident = {
      type: 'incident',
      title,
      service: { id: serviceId, type: 'service_reference' },
    }

    if (urgency) incident.urgency = this.#resolveChoice(urgency, URGENCY_MAP)
    if (priorityId) incident.priority = { id: priorityId, type: 'priority_reference' }
    if (escalationPolicyId) incident.escalation_policy = { id: escalationPolicyId, type: 'escalation_policy_reference' }
    if (details) incident.body = { type: 'incident_body', details }
    if (incidentKey) incident.incident_key = incidentKey

    return await this.#apiRequest({
      url: `${ API_BASE }/incidents`,
      method: 'post',
      body: { incident },
      fromEmail: await this.#resolveFromEmail(fromEmail),
      logTag: 'createIncident',
    })
  }

  /**
   * @operationName List Incidents
   * @category Incidents
   * @description Lists incidents, optionally filtered by status, urgency, service, team, or date range. Use this to find incidents to act on, or to report on recent activity.
   * @route POST /list-incidents
   * @paramDef {"type":"Array<String>","label":"Statuses","name":"statuses","uiComponent":{"type":"DROPDOWN","options":{"values":["Triggered","Acknowledged","Resolved"]}},"description":"Filter to incidents in these states. Leave empty for all."}
   * @paramDef {"type":"Array<String>","label":"Urgencies","name":"urgencies","uiComponent":{"type":"DROPDOWN","options":{"values":["High","Low"]}},"description":"Filter to incidents with these urgency levels."}
   * @paramDef {"type":"String","label":"Service","name":"serviceId","dictionary":"getServicesDictionary","description":"Only incidents for this service. Pick from your services."}
   * @paramDef {"type":"String","label":"Team","name":"teamId","dictionary":"getTeamsDictionary","description":"Only incidents for this team."}
   * @paramDef {"type":"String","label":"Since","name":"since","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start of the created/updated date range (ISO8601). Max range 6 months."}
   * @paramDef {"type":"String","label":"Until","name":"until","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"End of the date range (ISO8601)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":25,"description":"Results per page (max 100)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset (0-based)."}
   * @returns {Object}
   * @sampleResult {"incidents":[{"id":"PT4KHLK","incident_number":1234,"title":"The server is on fire.","status":"resolved","urgency":"high","service":{"id":"PIJ90N7","type":"service_reference"},"escalation_policy":{"id":"PT20YPA","type":"escalation_policy_reference"},"created_at":"2015-10-06T21:30:42Z"}],"limit":25,"offset":0,"more":false,"total":null}
   */
  async listIncidents(statuses, urgencies, serviceId, teamId, since, until, limit, offset) {
    const query = { limit: limit || PAGE_SIZE, offset: offset || 0 }

    const statusList = this.#toList(statuses)
    const urgencyList = this.#toList(urgencies)

    if (statusList) query['statuses[]'] = statusList.map(status => this.#resolveChoice(status, INCIDENT_STATUS_MAP))
    if (urgencyList) query['urgencies[]'] = urgencyList.map(urgency => this.#resolveChoice(urgency, URGENCY_MAP))
    if (serviceId) query['service_ids[]'] = [serviceId]
    if (teamId) query['team_ids[]'] = [teamId]
    if (since) query.since = since
    if (until) query.until = until

    return await this.#apiRequest({ url: `${ API_BASE }/incidents`, query, logTag: 'listIncidents' })
  }

  /**
   * @operationName Get Incident
   * @category Incidents
   * @description Retrieves the full details of one incident by ID, including its status, service, and assignments. Use this after listing or creating an incident.
   * @route POST /get-incident
   * @paramDef {"type":"String","label":"Incident","name":"incidentId","required":true,"dictionary":"getIncidentsDictionary","description":"The incident to fetch."}
   * @returns {Object}
   * @sampleResult {"incident":{"id":"PT4KHLK","incident_number":1234,"title":"The server is on fire.","status":"acknowledged","urgency":"high","service":{"id":"PIJ90N7","type":"service_reference"}}}
   */
  async getIncident(incidentId) {
    if (!incidentId) throw new Error('Incident is required.')

    return await this.#apiRequest({ url: `${ API_BASE }/incidents/${ incidentId }`, logTag: 'getIncident' })
  }

  /**
   * @operationName Update Incident
   * @category Incidents
   * @description Acknowledges, resolves, re-prioritizes, re-assigns, or escalates a single incident. Use this to progress an incident through its lifecycle from a flow.
   * @route POST /update-incident
   * @paramDef {"type":"String","label":"Incident","name":"incidentId","required":true,"dictionary":"getIncidentsDictionary","description":"The incident to update."}
   * @paramDef {"type":"String","label":"New Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Acknowledged","Resolved"]}},"description":"Acknowledge or resolve the incident."}
   * @paramDef {"type":"String","label":"Priority","name":"priorityId","dictionary":"getPrioritiesDictionary","description":"Change the incident priority."}
   * @paramDef {"type":"String","label":"Urgency","name":"urgency","uiComponent":{"type":"DROPDOWN","options":{"values":["High","Low"]}},"description":"Change the incident urgency."}
   * @paramDef {"type":"String","label":"Escalation Policy","name":"escalationPolicyId","dictionary":"getEscalationPoliciesDictionary","description":"Reassign to a different escalation policy (escalate)."}
   * @paramDef {"type":"String","label":"Reassign To","name":"assigneeUserId","dictionary":"getUsersDictionary","description":"Reassign the incident to this user."}
   * @paramDef {"type":"String","label":"Resolution Note","name":"resolution","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional resolution text when resolving."}
   * @paramDef {"type":"String","label":"From (User Email)","name":"fromEmail","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Email of the acting user (From header). Defaults to the connected account."}
   * @returns {Object}
   * @sampleResult {"incident":{"id":"PT4KHLK","status":"acknowledged","urgency":"high","incident_number":1234}}
   */
  async updateIncident(incidentId, status, priorityId, urgency, escalationPolicyId, assigneeUserId, resolution, fromEmail) {
    // docs: openapiv3.json PUT /incidents/{id} requestBody example
    if (!incidentId) throw new Error('Incident is required.')

    const incident = { type: 'incident_reference' }

    if (status) incident.status = this.#resolveChoice(status, INCIDENT_STATUS_MAP)
    if (priorityId) incident.priority = { id: priorityId, type: 'priority_reference' }
    if (urgency) incident.urgency = this.#resolveChoice(urgency, URGENCY_MAP)
    if (escalationPolicyId) incident.escalation_policy = { id: escalationPolicyId, type: 'escalation_policy_reference' }
    if (assigneeUserId) incident.assignments = [{ assignee: { id: assigneeUserId, type: 'user_reference' } }]
    if (resolution) incident.resolution = resolution

    return await this.#apiRequest({
      url: `${ API_BASE }/incidents/${ incidentId }`,
      method: 'put',
      body: { incident },
      fromEmail: await this.#resolveFromEmail(fromEmail),
      logTag: 'updateIncident',
    })
  }

  /**
   * @operationName Merge Incidents
   * @category Incidents
   * @description Merges one or more source incidents into a target incident, so duplicate alerts collapse into a single timeline. Use this to clean up redundant incidents.
   * @route POST /merge-incidents
   * @paramDef {"type":"String","label":"Target Incident","name":"targetIncidentId","required":true,"dictionary":"getIncidentsDictionary","description":"The incident that survives the merge."}
   * @paramDef {"type":"Array<String>","label":"Source Incidents","name":"sourceIncidentIds","required":true,"description":"Incident IDs to merge into the target (comma-separated or a list)."}
   * @paramDef {"type":"String","label":"From (User Email)","name":"fromEmail","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Email of the acting user (From header)."}
   * @returns {Object}
   * @sampleResult {"incident":{"id":"PT4KHLK","incident_number":1234,"title":"The server is on fire.","status":"triggered"}}
   */
  async mergeIncidents(targetIncidentId, sourceIncidentIds, fromEmail) {
    // docs: openapiv3.json PUT /incidents/{id}/merge requestBody example
    if (!targetIncidentId) throw new Error('Target Incident is required.')

    const sources = this.#toList(sourceIncidentIds)

    if (!sources) throw new Error('At least one Source Incident is required.')

    return await this.#apiRequest({
      url: `${ API_BASE }/incidents/${ targetIncidentId }/merge`,
      method: 'put',
      body: { source_incidents: sources.map(id => ({ id, type: 'incident_reference' })) },
      fromEmail: await this.#resolveFromEmail(fromEmail),
      logTag: 'mergeIncidents',
    })
  }

  /**
   * @operationName Snooze Incident
   * @category Incidents
   * @description Snoozes an acknowledged incident for a set duration, suppressing further escalation until it expires. Use this to silence an incident while someone works on it.
   * @route POST /snooze-incident
   * @paramDef {"type":"String","label":"Incident","name":"incidentId","required":true,"dictionary":"getIncidentsDictionary","description":"The incident to snooze."}
   * @paramDef {"type":"Number","label":"Duration (Seconds)","name":"durationSeconds","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":3600,"description":"How long to snooze, in seconds (e.g. 3600 = 1 hour)."}
   * @paramDef {"type":"String","label":"From (User Email)","name":"fromEmail","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Email of the acting user (From header)."}
   * @returns {Object}
   * @sampleResult {"incident":{"id":"PT4KHLK","status":"acknowledged","incident_number":1234}}
   */
  async snoozeIncident(incidentId, durationSeconds, fromEmail) {
    // docs: openapiv3.json POST /incidents/{id}/snooze requestBody example
    if (!incidentId) throw new Error('Incident is required.')
    if (!durationSeconds) throw new Error('Duration (Seconds) is required.')

    return await this.#apiRequest({
      url: `${ API_BASE }/incidents/${ incidentId }/snooze`,
      method: 'post',
      body: { duration: Number(durationSeconds) },
      fromEmail: await this.#resolveFromEmail(fromEmail),
      logTag: 'snoozeIncident',
    })
  }

  /**
   * @operationName Create Incident Note
   * @category Incidents
   * @description Adds a note (a comment) to an incident's timeline. Use this to record context or hand-off information visible to responders.
   * @route POST /create-incident-note
   * @paramDef {"type":"String","label":"Incident","name":"incidentId","required":true,"dictionary":"getIncidentsDictionary","description":"The incident to add a note to."}
   * @paramDef {"type":"String","label":"Note","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The note text."}
   * @paramDef {"type":"String","label":"From (User Email)","name":"fromEmail","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Email of the user adding the note (From header)."}
   * @returns {Object}
   * @sampleResult {"note":{"id":"PWL7QXS","content":"Firefighters are on the scene.","created_at":"2015-11-10T00:31:52-05:00"}}
   */
  async createIncidentNote(incidentId, content, fromEmail) {
    // docs: openapiv3.json POST /incidents/{id}/notes requestBody example
    if (!incidentId) throw new Error('Incident is required.')
    if (!content) throw new Error('Note is required.')

    return await this.#apiRequest({
      url: `${ API_BASE }/incidents/${ incidentId }/notes`,
      method: 'post',
      body: { note: { content } },
      fromEmail: await this.#resolveFromEmail(fromEmail),
      logTag: 'createIncidentNote',
    })
  }

  /**
   * @operationName List Incident Notes
   * @category Incidents
   * @description Lists the notes (comments) recorded on an incident's timeline. Use this to read the running commentary on an incident.
   * @route POST /list-incident-notes
   * @paramDef {"type":"String","label":"Incident","name":"incidentId","required":true,"dictionary":"getIncidentsDictionary","description":"The incident whose notes to list."}
   * @returns {Object}
   * @sampleResult {"notes":[{"id":"PWL7QXS","content":"Firefighters are on the scene.","created_at":"2015-11-10T00:31:52-05:00"}]}
   */
  async listIncidentNotes(incidentId) {
    if (!incidentId) throw new Error('Incident is required.')

    return await this.#apiRequest({ url: `${ API_BASE }/incidents/${ incidentId }/notes`, logTag: 'listIncidentNotes' })
  }

  /**
   * @operationName Create Status Update
   * @category Incidents
   * @description Posts a status update on an incident, broadcast to its subscribers (e.g. a status page or stakeholders). Use this to keep watchers informed during an incident.
   * @route POST /create-status-update
   * @paramDef {"type":"String","label":"Incident","name":"incidentId","required":true,"dictionary":"getIncidentsDictionary","description":"The incident to post a status update on."}
   * @paramDef {"type":"String","label":"Message","name":"message","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The status update text shown to subscribers."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional subject line for the update."}
   * @paramDef {"type":"String","label":"HTML Message","name":"htmlMessage","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional HTML version of the message."}
   * @paramDef {"type":"String","label":"From (User Email)","name":"fromEmail","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Email of the acting user (From header)."}
   * @returns {Object}
   * @sampleResult {"status_update":{"id":"PEYK3VT","message":"The server fire is spreading.","created_at":"2015-11-10T00:31:52-05:00"}}
   */
  async createStatusUpdate(incidentId, message, subject, htmlMessage, fromEmail) {
    // docs: openapiv3.json POST /incidents/{id}/status_updates requestBody example
    if (!incidentId) throw new Error('Incident is required.')
    if (!message) throw new Error('Message is required.')

    const body = { message }

    if (subject) body.subject = subject
    if (htmlMessage) body.html_message = htmlMessage

    return await this.#apiRequest({
      url: `${ API_BASE }/incidents/${ incidentId }/status_updates`,
      method: 'post',
      body,
      fromEmail: await this.#resolveFromEmail(fromEmail),
      logTag: 'createStatusUpdate',
    })
  }

  /**
   * @operationName Create Responder Request
   * @category Incidents
   * @description Requests an additional responder to join an incident, sending them a notification with a message. Use this to pull in extra help on a live incident.
   * @route POST /create-responder-request
   * @paramDef {"type":"String","label":"Incident","name":"incidentId","required":true,"dictionary":"getIncidentsDictionary","description":"The incident to request responders on."}
   * @paramDef {"type":"String","label":"Requester","name":"requesterId","required":true,"dictionary":"getUsersDictionary","description":"The user making the request."}
   * @paramDef {"type":"String","label":"Responder","name":"targetId","required":true,"dictionary":"getUsersDictionary","description":"The user to request as a responder."}
   * @paramDef {"type":"String","label":"Message","name":"message","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The message sent to the requested responder."}
   * @returns {Object}
   * @sampleResult {"responder_request":{"incident":{"id":"PT4KHLK","type":"incident_reference"},"requester":{"id":"PL1JMK5","type":"user_reference"}}}
   */
  async createResponderRequest(incidentId, requesterId, targetId, message) {
    // docs: openapiv3.json POST /incidents/{id}/responder_requests requestBody example
    if (!incidentId) throw new Error('Incident is required.')
    if (!requesterId) throw new Error('Requester is required.')
    if (!targetId) throw new Error('Responder is required.')
    if (!message) throw new Error('Message is required.')

    return await this.#apiRequest({
      url: `${ API_BASE }/incidents/${ incidentId }/responder_requests`,
      method: 'post',
      body: {
        requester_id: requesterId,
        message,
        responder_request_targets: [{ responder_request_target: { id: targetId, type: 'user_reference' } }],
      },
      logTag: 'createResponderRequest',
    })
  }

  /**
   * @operationName List Incident Alerts
   * @category Incidents
   * @description Lists the alerts that make up an incident - the underlying monitoring signals grouped into it. Use this to inspect what triggered an incident.
   * @route POST /list-incident-alerts
   * @paramDef {"type":"String","label":"Incident","name":"incidentId","required":true,"dictionary":"getIncidentsDictionary","description":"The incident whose alerts to list."}
   * @returns {Object}
   * @sampleResult {"alerts":[{"id":"PEYSGVF","status":"resolved","alert_key":"srv01/cpu","summary":"High CPU","created_at":"2015-10-06T21:31:42Z"}],"limit":25,"offset":0,"more":false,"total":null}
   */
  async listIncidentAlerts(incidentId) {
    if (!incidentId) throw new Error('Incident is required.')

    return await this.#apiRequest({ url: `${ API_BASE }/incidents/${ incidentId }/alerts`, logTag: 'listIncidentAlerts' })
  }

  /**
   * @operationName Get Incident Alert
   * @category Incidents
   * @description Retrieves one alert within an incident by its ID, including the alert body and the service it came from. Use this to drill into a specific alert.
   * @route POST /get-incident-alert
   * @paramDef {"type":"String","label":"Incident","name":"incidentId","required":true,"dictionary":"getIncidentsDictionary","description":"The parent incident."}
   * @paramDef {"type":"String","label":"Alert","name":"alertId","required":true,"dictionary":"getIncidentAlertsDictionary","dependsOn":["incidentId"],"description":"The alert (from List Incident Alerts)."}
   * @returns {Object}
   * @sampleResult {"alert":{"id":"PEYSGVF","status":"triggered","alert_key":"srv01/cpu","summary":"High CPU"}}
   */
  async getIncidentAlert(incidentId, alertId) {
    if (!incidentId) throw new Error('Incident is required.')
    if (!alertId) throw new Error('Alert is required.')

    return await this.#apiRequest({ url: `${ API_BASE }/incidents/${ incidentId }/alerts/${ alertId }`, logTag: 'getIncidentAlert' })
  }

  /**
   * @operationName Update Alert
   * @category Incidents
   * @description Resolves an alert, or moves it to a different incident. Use this to clear a single alert independently of its incident, or to re-group alerts.
   * @route POST /update-alert
   * @paramDef {"type":"String","label":"Incident","name":"incidentId","required":true,"dictionary":"getIncidentsDictionary","description":"The parent incident."}
   * @paramDef {"type":"String","label":"Alert","name":"alertId","required":true,"dictionary":"getIncidentAlertsDictionary","dependsOn":["incidentId"],"description":"The alert to update (from List Incident Alerts)."}
   * @paramDef {"type":"String","label":"New Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Resolved"]}},"description":"Resolve the alert."}
   * @paramDef {"type":"String","label":"Move To Incident","name":"moveToIncidentId","dictionary":"getIncidentsDictionary","description":"Optionally move the alert to another incident."}
   * @paramDef {"type":"String","label":"From (User Email)","name":"fromEmail","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Email of the acting user (From header)."}
   * @returns {Object}
   * @sampleResult {"alert":{"id":"PEYSGVF","status":"resolved","alert_key":"srv01/cpu"}}
   */
  async updateAlert(incidentId, alertId, status, moveToIncidentId, fromEmail) {
    // docs: openapiv3.json PUT /incidents/{id}/alerts/{alert_id} requestBody example
    if (!incidentId) throw new Error('Incident is required.')
    if (!alertId) throw new Error('Alert is required.')

    const alert = { type: 'alert' }

    if (status) alert.status = this.#resolveChoice(status, INCIDENT_STATUS_MAP)
    if (moveToIncidentId) alert.incident = { id: moveToIncidentId, type: 'incident_reference' }

    return await this.#apiRequest({
      url: `${ API_BASE }/incidents/${ incidentId }/alerts/${ alertId }`,
      method: 'put',
      body: { alert },
      fromEmail: await this.#resolveFromEmail(fromEmail),
      logTag: 'updateAlert',
    })
  }

  /**
   * @operationName List Incident Log Entries
   * @category Incidents
   * @description Lists the log entries (the audit timeline) of an incident - triggers, acknowledgements, escalations, notes, and resolution events. Use this to reconstruct exactly what happened.
   * @route POST /list-incident-log-entries
   * @paramDef {"type":"String","label":"Incident","name":"incidentId","required":true,"dictionary":"getIncidentsDictionary","description":"The incident whose timeline (log entries) to list."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":25,"description":"Results per page (max 100)."}
   * @returns {Object}
   * @sampleResult {"log_entries":[{"id":"Q02JTSNZWHSEKV","type":"trigger_log_entry","summary":"Triggered through the API","created_at":"2015-10-06T21:30:42Z"}],"limit":25,"offset":0,"more":false,"total":null}
   */
  async listIncidentLogEntries(incidentId, limit) {
    if (!incidentId) throw new Error('Incident is required.')

    return await this.#apiRequest({
      url: `${ API_BASE }/incidents/${ incidentId }/log_entries`,
      query: { limit: limit || PAGE_SIZE },
      logTag: 'listIncidentLogEntries',
    })
  }

  // ==========================================================================
  //  SERVICES
  // ==========================================================================
  /**
   * @operationName List Services
   * @category Services
   * @description Lists PagerDuty services (the monitored applications incidents are raised against), optionally filtered by name or team. Use this to find a service before creating an incident or maintenance window.
   * @route POST /list-services
   * @paramDef {"type":"String","label":"Search","name":"query","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Filter services by name."}
   * @paramDef {"type":"String","label":"Team","name":"teamId","dictionary":"getTeamsDictionary","description":"Only services for this team."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":25,"description":"Results per page (max 100)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset."}
   * @returns {Object}
   * @sampleResult {"services":[{"id":"PIJ90N7","name":"My Mail Service","status":"active","escalation_policy":{"id":"PT20YPA","type":"escalation_policy_reference"}}],"limit":25,"offset":0,"more":false,"total":null}
   */
  async listServices(query, teamId, limit, offset) {
    const q = { limit: limit || PAGE_SIZE, offset: offset || 0 }

    if (query) q.query = query
    if (teamId) q['team_ids[]'] = [teamId]

    return await this.#apiRequest({ url: `${ API_BASE }/services`, query: q, logTag: 'listServices' })
  }

  /**
   * @operationName Get Service
   * @category Services
   * @description Retrieves the full configuration of one service by ID, including its escalation policy and integrations. Use this to inspect a service.
   * @route POST /get-service
   * @paramDef {"type":"String","label":"Service","name":"serviceId","required":true,"dictionary":"getServicesDictionary","description":"The service to fetch."}
   * @returns {Object}
   * @sampleResult {"service":{"id":"PIJ90N7","name":"My Mail Service","status":"active","description":"Email pipeline"}}
   */
  async getService(serviceId) {
    if (!serviceId) throw new Error('Service is required.')

    return await this.#apiRequest({ url: `${ API_BASE }/services/${ serviceId }`, logTag: 'getService' })
  }

  /**
   * @operationName Create Service
   * @category Services
   * @description Creates a new PagerDuty service tied to an escalation policy, defining where incidents are raised and who is paged. Use this to onboard a new application into PagerDuty.
   * @route POST /create-service
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The service name."}
   * @paramDef {"type":"String","label":"Escalation Policy","name":"escalationPolicyId","required":true,"dictionary":"getEscalationPoliciesDictionary","description":"The escalation policy that pages responders for this service."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"What this service monitors."}
   * @paramDef {"type":"Number","label":"Auto-Resolve Timeout (Seconds)","name":"autoResolveTimeout","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Seconds before an open incident auto-resolves (leave empty to disable)."}
   * @paramDef {"type":"Number","label":"Acknowledgement Timeout (Seconds)","name":"acknowledgementTimeout","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Seconds before an acknowledged incident re-triggers (leave empty to disable)."}
   * @paramDef {"type":"String","label":"Alert Creation","name":"alertCreation","uiComponent":{"type":"DROPDOWN","options":{"values":["Create Alerts And Incidents","Create Incidents"]}},"description":"Whether the service creates alerts plus incidents, or incidents only."}
   * @returns {Object}
   * @sampleResult {"service":{"id":"PIJ90N7","name":"My Web App","status":"active","escalation_policy":{"id":"PWIP6CQ","type":"escalation_policy_reference"}}}
   */
  async createService(name, escalationPolicyId, description, autoResolveTimeout, acknowledgementTimeout, alertCreation) {
    // docs: openapiv3.json POST /services requestBody example
    if (!name) throw new Error('Name is required.')
    if (!escalationPolicyId) throw new Error('Escalation Policy is required — use Get Escalation Policies to pick one.')

    const service = {
      type: 'service',
      name,
      escalation_policy: { id: escalationPolicyId, type: 'escalation_policy_reference' },
    }

    if (description) service.description = description
    if (autoResolveTimeout !== undefined && autoResolveTimeout !== null && autoResolveTimeout !== '') service.auto_resolve_timeout = Number(autoResolveTimeout)
    if (acknowledgementTimeout !== undefined && acknowledgementTimeout !== null && acknowledgementTimeout !== '') service.acknowledgement_timeout = Number(acknowledgementTimeout)
    if (alertCreation) service.alert_creation = this.#resolveChoice(alertCreation, ALERT_CREATION_MAP)

    return await this.#apiRequest({ url: `${ API_BASE }/services`, method: 'post', body: { service }, logTag: 'createService' })
  }

  /**
   * @operationName Update Service
   * @category Services
   * @description Updates a service's name, description, status, or escalation policy. Use this to reconfigure an existing service.
   * @route POST /update-service
   * @paramDef {"type":"String","label":"Service","name":"serviceId","required":true,"dictionary":"getServicesDictionary","description":"The service to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New service name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Disabled"]}},"description":"Enable (active) or disable the service. The warning, critical, and maintenance states are derived from incident and maintenance-window activity and cannot be set here."}
   * @paramDef {"type":"String","label":"Escalation Policy","name":"escalationPolicyId","dictionary":"getEscalationPoliciesDictionary","description":"Change the escalation policy."}
   * @returns {Object}
   * @sampleResult {"service":{"id":"PIJ90N7","name":"My Web App","status":"active"}}
   */
  async updateService(serviceId, name, description, status, escalationPolicyId) {
    // docs: openapiv3.json PUT /services/{id} requestBody example
    if (!serviceId) throw new Error('Service is required.')

    const service = { type: 'service' }

    if (name) service.name = name
    if (description) service.description = description
    if (status) service.status = this.#resolveChoice(status, SERVICE_STATUS_MAP)
    if (escalationPolicyId) service.escalation_policy = { id: escalationPolicyId, type: 'escalation_policy_reference' }

    return await this.#apiRequest({ url: `${ API_BASE }/services/${ serviceId }`, method: 'put', body: { service }, logTag: 'updateService' })
  }

  /**
   * @operationName Delete Service
   * @category Services
   * @description Permanently deletes a service. Use this to remove a decommissioned application from PagerDuty. This cannot be undone.
   * @route POST /delete-service
   * @paramDef {"type":"String","label":"Service","name":"serviceId","required":true,"dictionary":"getServicesDictionary","description":"The service to delete. This removes the service permanently."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":"PIJ90N7"}
   */
  async deleteService(serviceId) {
    // docs: openapiv3.json DELETE /services/{id}
    if (!serviceId) throw new Error('Service is required.')

    await this.#apiRequest({ url: `${ API_BASE }/services/${ serviceId }`, method: 'delete', logTag: 'deleteService' })

    return { deleted: true, id: serviceId }
  }

  // ==========================================================================
  //  ESCALATION POLICIES
  // ==========================================================================
  /**
   * @operationName List Escalation Policies
   * @category Escalation Policies
   * @description Lists escalation policies (the ordered chains of who gets paged and when), optionally filtered by name or team. Use this to find a policy before assigning it to a service.
   * @route POST /list-escalation-policies
   * @paramDef {"type":"String","label":"Search","name":"query","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Filter escalation policies by name."}
   * @paramDef {"type":"String","label":"Team","name":"teamId","dictionary":"getTeamsDictionary","description":"Only policies for this team."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":25,"description":"Results per page (max 100)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset."}
   * @returns {Object}
   * @sampleResult {"escalation_policies":[{"id":"PT20YPA","name":"Engineering Escalation Policy","num_loops":2}],"limit":25,"offset":0,"more":false,"total":null}
   */
  async listEscalationPolicies(query, teamId, limit, offset) {
    const q = { limit: limit || PAGE_SIZE, offset: offset || 0 }

    if (query) q.query = query
    if (teamId) q['team_ids[]'] = [teamId]

    return await this.#apiRequest({ url: `${ API_BASE }/escalation_policies`, query: q, logTag: 'listEscalationPolicies' })
  }

  /**
   * @operationName Get Escalation Policy
   * @category Escalation Policies
   * @description Retrieves one escalation policy by ID, including its rules and targets. Use this to inspect the paging chain of a policy.
   * @route POST /get-escalation-policy
   * @paramDef {"type":"String","label":"Escalation Policy","name":"escalationPolicyId","required":true,"dictionary":"getEscalationPoliciesDictionary","description":"The policy to fetch."}
   * @returns {Object}
   * @sampleResult {"escalation_policy":{"id":"PT20YPA","name":"Engineering Escalation Policy","num_loops":2,"escalation_rules":[{"escalation_delay_in_minutes":30}]}}
   */
  async getEscalationPolicy(escalationPolicyId) {
    if (!escalationPolicyId) throw new Error('Escalation Policy is required.')

    return await this.#apiRequest({ url: `${ API_BASE }/escalation_policies/${ escalationPolicyId }`, logTag: 'getEscalationPolicy' })
  }

  /**
   * @operationName Create Escalation Policy
   * @category Escalation Policies
   * @description Creates an escalation policy with a first level of responders paged after a delay. Use this to define who is on the hook for incidents and how escalation flows.
   * @route POST /create-escalation-policy
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The escalation policy name."}
   * @paramDef {"type":"Array<String>","label":"First-Level Responders","name":"escalationTargetUserIds","required":true,"description":"User IDs paged at the first escalation level (comma-separated or a list). Use List Users to find IDs."}
   * @paramDef {"type":"Number","label":"Escalation Delay (Minutes)","name":"escalationDelayMinutes","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":30,"description":"Minutes before unacknowledged incidents escalate to the next level."}
   * @paramDef {"type":"Number","label":"Number Of Loops","name":"numLoops","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many times the policy repeats if no one acknowledges."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"What this policy is for."}
   * @paramDef {"type":"Array<String>","label":"Teams","name":"teamIds","description":"Team IDs that own this policy (comma-separated or a list)."}
   * @returns {Object}
   * @sampleResult {"escalation_policy":{"id":"PT20YPA","name":"Engineering Escalation Policy","num_loops":2}}
   */
  async createEscalationPolicy(name, escalationTargetUserIds, escalationDelayMinutes, numLoops, description, teamIds) {
    // docs: openapiv3.json POST /escalation_policies requestBody example
    if (!name) throw new Error('Name is required.')

    const targets = this.#toList(escalationTargetUserIds)

    if (!targets) throw new Error('At least one First-Level Responder is required — use List Users to find IDs.')

    const escalationPolicy = {
      type: 'escalation_policy',
      name,
      escalation_rules: [{
        escalation_delay_in_minutes: Number(escalationDelayMinutes) || 30,
        targets: targets.map(id => ({ id, type: 'user_reference' })),
      }],
    }

    if (numLoops !== undefined && numLoops !== null && numLoops !== '') escalationPolicy.num_loops = Number(numLoops)
    if (description) escalationPolicy.description = description

    const teams = this.#toList(teamIds)

    if (teams) escalationPolicy.teams = teams.map(id => ({ id, type: 'team_reference' }))

    return await this.#apiRequest({ url: `${ API_BASE }/escalation_policies`, method: 'post', body: { escalation_policy: escalationPolicy }, logTag: 'createEscalationPolicy' })
  }

  /**
   * @operationName Update Escalation Policy
   * @category Escalation Policies
   * @description Updates an escalation policy's name, description, or loop count while preserving its existing escalation rules and teams. Use this for the common edits; full rule changes are made via Create.
   * @route POST /update-escalation-policy
   * @paramDef {"type":"String","label":"Escalation Policy","name":"escalationPolicyId","required":true,"dictionary":"getEscalationPoliciesDictionary","description":"The policy to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New policy name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description."}
   * @paramDef {"type":"Number","label":"Number Of Loops","name":"numLoops","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New loop count."}
   * @returns {Object}
   * @sampleResult {"escalation_policy":{"id":"PT20YPA","name":"Engineering Escalation Policy","num_loops":3}}
   */
  async updateEscalationPolicy(escalationPolicyId, name, description, numLoops) {
    // docs: openapiv3.json PUT /escalation_policies/{id} requestBody example
    // PUT /escalation_policies requires the full policy object incl. escalation_rules and teams;
    // fetch current, merge changes, so a partial payload doesn't wipe the existing rules/teams.
    if (!escalationPolicyId) throw new Error('Escalation Policy is required.')

    const current = await this.#apiRequest({ url: `${ API_BASE }/escalation_policies/${ escalationPolicyId }`, logTag: 'updateEscalationPolicy.get' })
    const existing = (current && current.escalation_policy) || {}

    const escalationPolicy = {
      type: 'escalation_policy',
      name: name || existing.name,
      escalation_rules: existing.escalation_rules || [],
    }

    if (description !== undefined && description !== null && description !== '') {
      escalationPolicy.description = description
    } else if (existing.description) {
      escalationPolicy.description = existing.description
    }

    if (numLoops !== undefined && numLoops !== null && numLoops !== '') {
      escalationPolicy.num_loops = Number(numLoops)
    } else if (existing.num_loops !== undefined && existing.num_loops !== null) {
      escalationPolicy.num_loops = existing.num_loops
    }

    if (existing.teams) escalationPolicy.teams = existing.teams

    return await this.#apiRequest({ url: `${ API_BASE }/escalation_policies/${ escalationPolicyId }`, method: 'put', body: { escalation_policy: escalationPolicy }, logTag: 'updateEscalationPolicy' })
  }

  /**
   * @operationName Delete Escalation Policy
   * @category Escalation Policies
   * @description Permanently deletes an escalation policy. Use this to remove an unused policy. A policy still attached to a service cannot be deleted.
   * @route POST /delete-escalation-policy
   * @paramDef {"type":"String","label":"Escalation Policy","name":"escalationPolicyId","required":true,"dictionary":"getEscalationPoliciesDictionary","description":"The policy to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":"PT20YPA"}
   */
  async deleteEscalationPolicy(escalationPolicyId) {
    // docs: openapiv3.json DELETE /escalation_policies/{id}
    if (!escalationPolicyId) throw new Error('Escalation Policy is required.')

    await this.#apiRequest({ url: `${ API_BASE }/escalation_policies/${ escalationPolicyId }`, method: 'delete', logTag: 'deleteEscalationPolicy' })

    return { deleted: true, id: escalationPolicyId }
  }

  // ==========================================================================
  //  SCHEDULES
  // ==========================================================================
  /**
   * @operationName List Schedules
   * @category Schedules
   * @description Lists on-call schedules (the rotations that define who is on call when), optionally filtered by name. Use this to find a schedule before reading its rotation or adding an override.
   * @route POST /list-schedules
   * @paramDef {"type":"String","label":"Search","name":"query","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Filter schedules by name."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":25,"description":"Results per page (max 100)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset."}
   * @returns {Object}
   * @sampleResult {"schedules":[{"id":"PI7DH85","name":"Daily Engineering Rotation","time_zone":"America/New_York"}],"limit":25,"offset":0,"more":false,"total":null}
   */
  async listSchedules(query, limit, offset) {
    const q = { limit: limit || PAGE_SIZE, offset: offset || 0 }

    if (query) q.query = query

    return await this.#apiRequest({ url: `${ API_BASE }/schedules`, query: q, logTag: 'listSchedules' })
  }

  /**
   * @operationName Get Schedule
   * @category Schedules
   * @description Retrieves one schedule by ID, including its rotation layers and the rendered final schedule. Use this to inspect a rotation.
   * @route POST /get-schedule
   * @paramDef {"type":"String","label":"Schedule","name":"scheduleId","required":true,"dictionary":"getSchedulesDictionary","description":"The schedule to fetch."}
   * @returns {Object}
   * @sampleResult {"schedule":{"id":"PI7DH85","name":"Daily Engineering Rotation","time_zone":"America/New_York"}}
   */
  async getSchedule(scheduleId) {
    if (!scheduleId) throw new Error('Schedule is required.')

    return await this.#apiRequest({ url: `${ API_BASE }/schedules/${ scheduleId }`, logTag: 'getSchedule' })
  }

  /**
   * @operationName Create Schedule
   * @category Schedules
   * @description Creates an on-call schedule with a single rotation layer of users taking turns. Use this to set up who is on call and how the rotation advances.
   * @route POST /create-schedule
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The schedule name."}
   * @paramDef {"type":"String","label":"Time Zone","name":"timeZone","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"IANA time zone for the schedule (e.g. America/New_York)."}
   * @paramDef {"type":"Array<String>","label":"Rotation Users","name":"layerUserIds","required":true,"description":"User IDs in the on-call rotation, in order (comma-separated or a list). Use List Users."}
   * @paramDef {"type":"String","label":"Rotation Start","name":"rotationStart","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"When the rotation begins (ISO8601 with offset)."}
   * @paramDef {"type":"Number","label":"Shift Length (Seconds)","name":"turnLengthSeconds","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":86400,"description":"Length of each on-call turn in seconds (86400 = 1 day)."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"What this schedule covers."}
   * @returns {Object}
   * @sampleResult {"schedule":{"id":"PI7DH85","name":"Daily Engineering Rotation","time_zone":"America/New_York"}}
   */
  async createSchedule(name, timeZone, layerUserIds, rotationStart, turnLengthSeconds, description) {
    // docs: openapiv3.json POST /schedules requestBody example
    if (!name) throw new Error('Name is required.')
    if (!timeZone) throw new Error('Time Zone is required (e.g. America/New_York).')
    if (!rotationStart) throw new Error('Rotation Start is required.')

    const users = this.#toList(layerUserIds)

    if (!users) throw new Error('At least one Rotation User is required — use List Users.')

    const schedule = {
      type: 'schedule',
      name,
      time_zone: timeZone,
      schedule_layers: [{
        start: rotationStart,
        rotation_virtual_start: rotationStart,
        rotation_turn_length_seconds: Number(turnLengthSeconds) || 86400,
        users: users.map(id => ({ user: { id, type: 'user_reference' } })),
      }],
    }

    if (description) schedule.description = description

    return await this.#apiRequest({ url: `${ API_BASE }/schedules`, method: 'post', body: { schedule }, logTag: 'createSchedule' })
  }

  /**
   * @operationName Update Schedule
   * @category Schedules
   * @description Updates a schedule's name, time zone, or description while preserving its existing rotation layers. Use this for the common metadata edits without rebuilding the rotation.
   * @route POST /update-schedule
   * @paramDef {"type":"String","label":"Schedule","name":"scheduleId","required":true,"dictionary":"getSchedulesDictionary","description":"The schedule to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New schedule name."}
   * @paramDef {"type":"String","label":"Time Zone","name":"timeZone","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New IANA time zone."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description."}
   * @returns {Object}
   * @sampleResult {"schedule":{"id":"PI7DH85","name":"Daily Engineering Rotation","time_zone":"America/New_York"}}
   */
  async updateSchedule(scheduleId, name, timeZone, description) {
    // docs: openapiv3.json PUT /schedules/{id} requestBody example
    // PUT /schedules requires the full schedule object incl. schedule_layers; fetch current, merge changes.
    if (!scheduleId) throw new Error('Schedule is required.')

    const current = await this.#apiRequest({ url: `${ API_BASE }/schedules/${ scheduleId }`, logTag: 'updateSchedule.get' })
    const existing = (current && current.schedule) || {}

    const schedule = {
      type: 'schedule',
      name: name || existing.name,
      time_zone: timeZone || existing.time_zone,
      schedule_layers: existing.schedule_layers || [],
    }

    if (description !== undefined && description !== null && description !== '') {
      schedule.description = description
    } else if (existing.description) {
      schedule.description = existing.description
    }

    return await this.#apiRequest({ url: `${ API_BASE }/schedules/${ scheduleId }`, method: 'put', body: { schedule }, logTag: 'updateSchedule' })
  }

  /**
   * @operationName Delete Schedule
   * @category Schedules
   * @description Permanently deletes a schedule. Use this to remove an unused rotation. A schedule still referenced by an escalation policy cannot be deleted.
   * @route POST /delete-schedule
   * @paramDef {"type":"String","label":"Schedule","name":"scheduleId","required":true,"dictionary":"getSchedulesDictionary","description":"The schedule to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":"PI7DH85"}
   */
  async deleteSchedule(scheduleId) {
    // docs: openapiv3.json DELETE /schedules/{id}
    if (!scheduleId) throw new Error('Schedule is required.')

    await this.#apiRequest({ url: `${ API_BASE }/schedules/${ scheduleId }`, method: 'delete', logTag: 'deleteSchedule' })

    return { deleted: true, id: scheduleId }
  }

  /**
   * @operationName List Schedule Overrides
   * @category Schedules
   * @description Lists the overrides on a schedule within a date range - temporary substitutions of who is on call. Use this to see who is covering instead of the default rotation.
   * @route POST /list-schedule-overrides
   * @paramDef {"type":"String","label":"Schedule","name":"scheduleId","required":true,"dictionary":"getSchedulesDictionary","description":"The schedule whose overrides to list."}
   * @paramDef {"type":"String","label":"Since","name":"since","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start of the override date range (ISO8601). Required by the API."}
   * @paramDef {"type":"String","label":"Until","name":"until","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"End of the override date range (ISO8601). Required by the API."}
   * @returns {Object}
   * @sampleResult {"overrides":[{"id":"PQ47DCP","start":"2012-07-01T00:00:00-04:00","end":"2012-07-02T00:00:00-04:00","user":{"id":"PEYSGVA","type":"user_reference"}}]}
   */
  async listScheduleOverrides(scheduleId, since, until) {
    if (!scheduleId) throw new Error('Schedule is required.')
    if (!since) throw new Error('Since is required.')
    if (!until) throw new Error('Until is required.')

    return await this.#apiRequest({ url: `${ API_BASE }/schedules/${ scheduleId }/overrides`, query: { since, until }, logTag: 'listScheduleOverrides' })
  }

  /**
   * @operationName Create Schedule Override
   * @category Schedules
   * @description Adds an override to a schedule, putting a specific user on call for a time window in place of the normal rotation. Use this to arrange cover for planned absences.
   * @route POST /create-schedule-override
   * @paramDef {"type":"String","label":"Schedule","name":"scheduleId","required":true,"dictionary":"getSchedulesDictionary","description":"The schedule to add an override to."}
   * @paramDef {"type":"String","label":"Override User","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The user who covers the override window."}
   * @paramDef {"type":"String","label":"Start","name":"start","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Override start (ISO8601 with offset)."}
   * @paramDef {"type":"String","label":"End","name":"end","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Override end (ISO8601 with offset)."}
   * @paramDef {"type":"String","label":"Time Zone","name":"timeZone","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Optional IANA time zone for the override window."}
   * @returns {Object}
   * @sampleResult {"overrides":[{"id":"PQ47DCP","start":"2012-07-01T00:00:00-04:00","end":"2012-07-02T00:00:00-04:00","user":{"id":"PEYSGVA","type":"user_reference"}}]}
   */
  async createScheduleOverride(scheduleId, userId, start, end, timeZone) {
    // docs: openapiv3.json POST /schedules/{id}/overrides requestBody example
    if (!scheduleId) throw new Error('Schedule is required.')
    if (!userId) throw new Error('Override User is required.')
    if (!start) throw new Error('Start is required.')
    if (!end) throw new Error('End is required.')

    const override = { start, end, user: { id: userId, type: 'user_reference' } }

    if (timeZone) override.time_zone = timeZone

    return await this.#apiRequest({ url: `${ API_BASE }/schedules/${ scheduleId }/overrides`, method: 'post', body: { overrides: [override] }, logTag: 'createScheduleOverride' })
  }

  /**
   * @operationName List Schedule On-Calls
   * @category Schedules
   * @description Lists the users on call for a schedule, optionally within a time window. Use this to find out who to contact for a given rotation.
   * @route POST /list-schedule-on-calls
   * @paramDef {"type":"String","label":"Schedule","name":"scheduleId","required":true,"dictionary":"getSchedulesDictionary","description":"The schedule whose on-call users to list."}
   * @paramDef {"type":"String","label":"Since","name":"since","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start of the time window (ISO8601)."}
   * @paramDef {"type":"String","label":"Until","name":"until","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"End of the time window (ISO8601)."}
   * @returns {Object}
   * @sampleResult {"users":[{"id":"PT23IWX","name":"Tim Wright","email":"tim@example.com"}]}
   */
  async listScheduleOnCalls(scheduleId, since, until) {
    if (!scheduleId) throw new Error('Schedule is required.')

    const query = {}

    if (since) query.since = since
    if (until) query.until = until

    return await this.#apiRequest({ url: `${ API_BASE }/schedules/${ scheduleId }/users`, query, logTag: 'listScheduleOnCalls' })
  }

  // ==========================================================================
  //  USERS
  // ==========================================================================
  /**
   * @operationName List Users
   * @category Users
   * @description Lists the users in your PagerDuty account, optionally filtered by name, email, or team. Use this to find a user before assigning incidents or building schedules.
   * @route POST /list-users
   * @paramDef {"type":"String","label":"Search","name":"query","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Filter users by name or email."}
   * @paramDef {"type":"String","label":"Team","name":"teamId","dictionary":"getTeamsDictionary","description":"Only users on this team."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":25,"description":"Results per page (max 100)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset."}
   * @returns {Object}
   * @sampleResult {"users":[{"id":"PXPGF42","name":"Earline Greenholt","email":"earline@graham.name","role":"admin","time_zone":"America/Lima"}],"limit":25,"offset":0,"more":false,"total":null}
   */
  async listUsers(query, teamId, limit, offset) {
    const q = { limit: limit || PAGE_SIZE, offset: offset || 0 }

    if (query) q.query = query
    if (teamId) q['team_ids[]'] = [teamId]

    return await this.#apiRequest({ url: `${ API_BASE }/users`, query: q, logTag: 'listUsers' })
  }

  /**
   * @operationName Get User
   * @category Users
   * @description Retrieves one user by ID, including their role, time zone, and contact details. Use this to inspect a user.
   * @route POST /get-user
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The user to fetch."}
   * @returns {Object}
   * @sampleResult {"user":{"id":"PXPGF42","name":"Earline Greenholt","email":"earline@graham.name","role":"admin"}}
   */
  async getUser(userId) {
    if (!userId) throw new Error('User is required.')

    return await this.#apiRequest({ url: `${ API_BASE }/users/${ userId }`, logTag: 'getUser' })
  }

  /**
   * @operationName Create User
   * @category Users
   * @description Invites a new user into your PagerDuty account with a name, email, and role. Use this to onboard a responder. May require an available license on the account.
   * @route POST /create-user
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user's full name."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user's login email (must be unique)."}
   * @paramDef {"type":"String","label":"Role","name":"role","uiComponent":{"type":"DROPDOWN","options":{"values":["Admin","Responder (User)","Limited User","Observer","Read-only User","Restricted Access","Owner"]}},"description":"The user's account role."}
   * @paramDef {"type":"String","label":"Time Zone","name":"timeZone","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"IANA time zone (e.g. America/Lima)."}
   * @paramDef {"type":"String","label":"Job Title","name":"jobTitle","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The user's job title."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A short bio / note."}
   * @paramDef {"type":"String","label":"From (User Email)","name":"fromEmail","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Email of the admin creating the user (From header). Defaults to the connected account."}
   * @returns {Object}
   * @sampleResult {"user":{"id":"PXPGF42","name":"Earline Greenholt","email":"earline@graham.name","role":"admin"}}
   */
  async createUser(name, email, role, timeZone, jobTitle, description, fromEmail) {
    // docs: openapiv3.json POST /users requestBody example
    if (!name) throw new Error('Name is required.')
    if (!email) throw new Error('Email is required.')

    const user = { type: 'user', name, email }

    if (role) user.role = this.#resolveChoice(role, USER_ROLE_MAP)
    if (timeZone) user.time_zone = timeZone
    if (jobTitle) user.job_title = jobTitle
    if (description) user.description = description

    return await this.#apiRequest({
      url: `${ API_BASE }/users`,
      method: 'post',
      body: { user },
      fromEmail: await this.#resolveFromEmail(fromEmail),
      logTag: 'createUser',
    })
  }

  /**
   * @operationName Update User
   * @category Users
   * @description Updates a user's name, email, role, or job title. Use this to change a responder's details or permissions.
   * @route POST /update-user
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The user to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New full name."}
   * @paramDef {"type":"String","label":"Email","name":"email","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New email."}
   * @paramDef {"type":"String","label":"Role","name":"role","uiComponent":{"type":"DROPDOWN","options":{"values":["Admin","Responder (User)","Limited User","Observer","Read-only User","Restricted Access","Owner"]}},"description":"New account role."}
   * @paramDef {"type":"String","label":"Job Title","name":"jobTitle","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New job title."}
   * @returns {Object}
   * @sampleResult {"user":{"id":"PXPGF42","name":"Earline Greenholt","email":"earline@graham.name","role":"admin"}}
   */
  async updateUser(userId, name, email, role, jobTitle) {
    // docs: openapiv3.json PUT /users/{id} requestBody example
    if (!userId) throw new Error('User is required.')

    const user = { type: 'user' }

    if (name) user.name = name
    if (email) user.email = email
    if (role) user.role = this.#resolveChoice(role, USER_ROLE_MAP)
    if (jobTitle) user.job_title = jobTitle

    return await this.#apiRequest({ url: `${ API_BASE }/users/${ userId }`, method: 'put', body: { user }, logTag: 'updateUser' })
  }

  /**
   * @operationName Delete User
   * @category Users
   * @description Permanently removes a user from your PagerDuty account. Use this during offboarding. A user who is the only responder on a policy cannot be deleted.
   * @route POST /delete-user
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The user to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":"PXPGF42"}
   */
  async deleteUser(userId) {
    // docs: openapiv3.json DELETE /users/{id}
    if (!userId) throw new Error('User is required.')

    await this.#apiRequest({ url: `${ API_BASE }/users/${ userId }`, method: 'delete', logTag: 'deleteUser' })

    return { deleted: true, id: userId }
  }

  /**
   * @operationName List User Contact Methods
   * @category Users
   * @description Lists a user's contact methods (email, phone, SMS, push). Use this to see how a responder can be reached.
   * @route POST /list-user-contact-methods
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The user whose contact methods to list."}
   * @returns {Object}
   * @sampleResult {"contact_methods":[{"id":"PVMGSML","type":"email_contact_method","label":"Work","address":"grady@hickle.net"}]}
   */
  async listUserContactMethods(userId) {
    if (!userId) throw new Error('User is required.')

    return await this.#apiRequest({ url: `${ API_BASE }/users/${ userId }/contact_methods`, logTag: 'listUserContactMethods' })
  }

  /**
   * @operationName List User Notification Rules
   * @category Users
   * @description Lists a user's notification rules - how and when they are notified for high- and low-urgency incidents. Use this to audit a responder's alerting setup.
   * @route POST /list-user-notification-rules
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The user whose notification rules to list."}
   * @returns {Object}
   * @sampleResult {"notification_rules":[{"id":"P7N8QRX","type":"assignment_notification_rule","start_delay_in_minutes":0,"urgency":"high"}]}
   */
  async listUserNotificationRules(userId) {
    if (!userId) throw new Error('User is required.')

    return await this.#apiRequest({ url: `${ API_BASE }/users/${ userId }/notification_rules`, logTag: 'listUserNotificationRules' })
  }

  // ==========================================================================
  //  TEAMS
  // ==========================================================================
  /**
   * @operationName List Teams
   * @category Teams
   * @description Lists the teams in your account, optionally filtered by name. Use this to find a team before scoping services, policies, or users to it.
   * @route POST /list-teams
   * @paramDef {"type":"String","label":"Search","name":"query","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Filter teams by name."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":25,"description":"Results per page (max 100)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset."}
   * @returns {Object}
   * @sampleResult {"teams":[{"id":"PQ9K7I8","name":"Engineering","description":"The engineering team"}],"limit":25,"offset":0,"more":false,"total":null}
   */
  async listTeams(query, limit, offset) {
    const q = { limit: limit || PAGE_SIZE, offset: offset || 0 }

    if (query) q.query = query

    return await this.#apiRequest({ url: `${ API_BASE }/teams`, query: q, logTag: 'listTeams' })
  }

  /**
   * @operationName Get Team
   * @category Teams
   * @description Retrieves one team by ID. Use this to inspect a team's details.
   * @route POST /get-team
   * @paramDef {"type":"String","label":"Team","name":"teamId","required":true,"dictionary":"getTeamsDictionary","description":"The team to fetch."}
   * @returns {Object}
   * @sampleResult {"team":{"id":"PQ9K7I8","name":"Engineering","description":"The engineering team"}}
   */
  async getTeam(teamId) {
    if (!teamId) throw new Error('Team is required.')

    return await this.#apiRequest({ url: `${ API_BASE }/teams/${ teamId }`, logTag: 'getTeam' })
  }

  /**
   * @operationName Create Team
   * @category Teams
   * @description Creates a new team to group users, services, and escalation policies. Use this to organize your account by squad or product area.
   * @route POST /create-team
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The team name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"What this team does."}
   * @returns {Object}
   * @sampleResult {"team":{"id":"PQ9K7I8","name":"Engineering","description":"The engineering team"}}
   */
  async createTeam(name, description) {
    // docs: openapiv3.json POST /teams requestBody example
    if (!name) throw new Error('Name is required.')

    const team = { type: 'team', name }

    if (description) team.description = description

    return await this.#apiRequest({ url: `${ API_BASE }/teams`, method: 'post', body: { team }, logTag: 'createTeam' })
  }

  /**
   * @operationName Update Team
   * @category Teams
   * @description Updates a team's name or description. Use this to rename or re-describe a team.
   * @route POST /update-team
   * @paramDef {"type":"String","label":"Team","name":"teamId","required":true,"dictionary":"getTeamsDictionary","description":"The team to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New team name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description."}
   * @returns {Object}
   * @sampleResult {"team":{"id":"PQ9K7I8","name":"Engineering","description":"The engineering team"}}
   */
  async updateTeam(teamId, name, description) {
    // docs: openapiv3.json PUT /teams/{id} requestBody example
    if (!teamId) throw new Error('Team is required.')

    const team = { type: 'team' }

    if (name) team.name = name
    if (description) team.description = description

    return await this.#apiRequest({ url: `${ API_BASE }/teams/${ teamId }`, method: 'put', body: { team }, logTag: 'updateTeam' })
  }

  /**
   * @operationName Delete Team
   * @category Teams
   * @description Permanently deletes a team. Use this to remove an obsolete team. Members, services, and policies are not deleted, just unlinked.
   * @route POST /delete-team
   * @paramDef {"type":"String","label":"Team","name":"teamId","required":true,"dictionary":"getTeamsDictionary","description":"The team to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":"PQ9K7I8"}
   */
  async deleteTeam(teamId) {
    // docs: openapiv3.json DELETE /teams/{id}
    if (!teamId) throw new Error('Team is required.')

    await this.#apiRequest({ url: `${ API_BASE }/teams/${ teamId }`, method: 'delete', logTag: 'deleteTeam' })

    return { deleted: true, id: teamId }
  }

  /**
   * @operationName Add User To Team
   * @category Teams
   * @description Adds a user to a team, optionally with a team role (manager, responder, or observer). Use this to grow a team's membership.
   * @route POST /add-user-to-team
   * @paramDef {"type":"String","label":"Team","name":"teamId","required":true,"dictionary":"getTeamsDictionary","description":"The team to add the user to."}
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The user to add."}
   * @paramDef {"type":"String","label":"Team Role","name":"role","uiComponent":{"type":"DROPDOWN","options":{"values":["Manager","Responder","Observer"]}},"description":"The user's role within the team."}
   * @returns {Object}
   * @sampleResult {"added":true,"teamId":"PQ9K7I8","userId":"PXPGF42"}
   */
  async addUserToTeam(teamId, userId, role) {
    // docs: openapiv3.json PUT /teams/{id}/users/{user_id} requestBody example
    if (!teamId) throw new Error('Team is required.')
    if (!userId) throw new Error('User is required.')

    const resolvedRole = this.#resolveChoice(role, TEAM_ROLE_MAP)

    await this.#apiRequest({
      url: `${ API_BASE }/teams/${ teamId }/users/${ userId }`,
      method: 'put',
      body: resolvedRole ? { role: resolvedRole } : undefined,
      logTag: 'addUserToTeam',
    })

    return { added: true, teamId, userId }
  }

  /**
   * @operationName Remove User From Team
   * @category Teams
   * @description Removes a user from a team. Use this when a member leaves a squad.
   * @route POST /remove-user-from-team
   * @paramDef {"type":"String","label":"Team","name":"teamId","required":true,"dictionary":"getTeamsDictionary","description":"The team to remove the user from."}
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The user to remove."}
   * @returns {Object}
   * @sampleResult {"removed":true,"teamId":"PQ9K7I8","userId":"PXPGF42"}
   */
  async removeUserFromTeam(teamId, userId) {
    // docs: openapiv3.json DELETE /teams/{id}/users/{user_id}
    if (!teamId) throw new Error('Team is required.')
    if (!userId) throw new Error('User is required.')

    await this.#apiRequest({ url: `${ API_BASE }/teams/${ teamId }/users/${ userId }`, method: 'delete', logTag: 'removeUserFromTeam' })

    return { removed: true, teamId, userId }
  }

  /**
   * @operationName Add Escalation Policy To Team
   * @category Teams
   * @description Associates an escalation policy with a team, so the team owns it. Use this to organize policies under their owning team.
   * @route POST /add-escalation-policy-to-team
   * @paramDef {"type":"String","label":"Team","name":"teamId","required":true,"dictionary":"getTeamsDictionary","description":"The team to associate the policy with."}
   * @paramDef {"type":"String","label":"Escalation Policy","name":"escalationPolicyId","required":true,"dictionary":"getEscalationPoliciesDictionary","description":"The policy to add."}
   * @returns {Object}
   * @sampleResult {"added":true,"teamId":"PQ9K7I8","escalationPolicyId":"PT20YPA"}
   */
  async addEscalationPolicyToTeam(teamId, escalationPolicyId) {
    // docs: openapiv3.json PUT /teams/{id}/escalation_policies/{escalation_policy_id} (no requestBody - empty PUT)
    if (!teamId) throw new Error('Team is required.')
    if (!escalationPolicyId) throw new Error('Escalation Policy is required.')

    await this.#apiRequest({ url: `${ API_BASE }/teams/${ teamId }/escalation_policies/${ escalationPolicyId }`, method: 'put', logTag: 'addEscalationPolicyToTeam' })

    return { added: true, teamId, escalationPolicyId }
  }

  /**
   * @operationName Remove Escalation Policy From Team
   * @category Teams
   * @description Removes the association between an escalation policy and a team. Use this to disown a policy from a team.
   * @route POST /remove-escalation-policy-from-team
   * @paramDef {"type":"String","label":"Team","name":"teamId","required":true,"dictionary":"getTeamsDictionary","description":"The team to disassociate the policy from."}
   * @paramDef {"type":"String","label":"Escalation Policy","name":"escalationPolicyId","required":true,"dictionary":"getEscalationPoliciesDictionary","description":"The policy to remove."}
   * @returns {Object}
   * @sampleResult {"removed":true,"teamId":"PQ9K7I8","escalationPolicyId":"PT20YPA"}
   */
  async removeEscalationPolicyFromTeam(teamId, escalationPolicyId) {
    // docs: openapiv3.json DELETE /teams/{id}/escalation_policies/{escalation_policy_id}
    if (!teamId) throw new Error('Team is required.')
    if (!escalationPolicyId) throw new Error('Escalation Policy is required.')

    await this.#apiRequest({ url: `${ API_BASE }/teams/${ teamId }/escalation_policies/${ escalationPolicyId }`, method: 'delete', logTag: 'removeEscalationPolicyFromTeam' })

    return { removed: true, teamId, escalationPolicyId }
  }

  // ==========================================================================
  //  ON-CALLS / PRIORITIES
  // ==========================================================================
  /**
   * @operationName List On-Calls
   * @category On-Call
   * @description Lists who is currently (or within a window) on call, optionally filtered by user, schedule, or escalation policy. Use this to find the right person to page right now.
   * @route POST /list-on-calls
   * @paramDef {"type":"String","label":"User","name":"userId","dictionary":"getUsersDictionary","description":"Only on-calls for this user."}
   * @paramDef {"type":"String","label":"Schedule","name":"scheduleId","dictionary":"getSchedulesDictionary","description":"Only on-calls for this schedule."}
   * @paramDef {"type":"String","label":"Escalation Policy","name":"escalationPolicyId","dictionary":"getEscalationPoliciesDictionary","description":"Only on-calls for this escalation policy."}
   * @paramDef {"type":"String","label":"Since","name":"since","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start of the time window (ISO8601)."}
   * @paramDef {"type":"String","label":"Until","name":"until","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"End of the time window (ISO8601)."}
   * @paramDef {"type":"Boolean","label":"Earliest Only","name":"earliest","uiComponent":{"type":"TOGGLE"},"description":"Return only the earliest on-call per combination."}
   * @returns {Object}
   * @sampleResult {"oncalls":[{"user":{"id":"PT23IWX","type":"user_reference","summary":"Tim Wright"},"schedule":{"id":"PI7DH85","type":"schedule_reference"},"escalation_policy":{"id":"PT20YPA","type":"escalation_policy_reference"},"escalation_level":2,"start":"2015-03-06T15:28:51-05:00","end":"2015-03-07T15:28:51-05:00"}],"limit":25,"offset":0,"more":false,"total":null}
   */
  async listOnCalls(userId, scheduleId, escalationPolicyId, since, until, earliest) {
    const query = {}

    if (userId) query['user_ids[]'] = [userId]
    if (scheduleId) query['schedule_ids[]'] = [scheduleId]
    if (escalationPolicyId) query['escalation_policy_ids[]'] = [escalationPolicyId]
    if (since) query.since = since
    if (until) query.until = until
    if (earliest) query.earliest = true

    return await this.#apiRequest({ url: `${ API_BASE }/oncalls`, query, logTag: 'listOnCalls' })
  }

  /**
   * @operationName List Priorities
   * @category On-Call
   * @description Lists the account's incident priorities (e.g. P1-P5) with their names and descriptions. Use this to pick a priority ID when creating or updating an incident.
   * @route POST /list-priorities
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":25,"description":"Results per page."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset."}
   * @returns {Object}
   * @sampleResult {"priorities":[{"id":"PSLWBL8","name":"P1","description":"Critical issue that warrants public notification"},{"id":"P53ZZH5","name":"P2","description":"Critical system issue"}],"limit":25,"offset":0,"more":false,"total":null}
   */
  async listPriorities(limit, offset) {
    return await this.#apiRequest({ url: `${ API_BASE }/priorities`, query: { limit: limit || PAGE_SIZE, offset: offset || 0 }, logTag: 'listPriorities' })
  }

  // ==========================================================================
  //  MAINTENANCE WINDOWS
  // ==========================================================================
  /**
   * @operationName List Maintenance Windows
   * @category Maintenance Windows
   * @description Lists maintenance windows (periods when a service's alerting is suppressed), optionally filtered to past, future, or ongoing windows. Use this to see scheduled downtime.
   * @route POST /list-maintenance-windows
   * @paramDef {"type":"String","label":"Filter","name":"filter","uiComponent":{"type":"DROPDOWN","options":{"values":["Past","Future","Ongoing"]}},"description":"Restrict to past, future, or ongoing windows."}
   * @paramDef {"type":"String","label":"Service","name":"serviceId","dictionary":"getServicesDictionary","description":"Only windows affecting this service."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":25,"description":"Results per page (max 100)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset."}
   * @returns {Object}
   * @sampleResult {"maintenance_windows":[{"id":"PEYSGVF","start_time":"2015-11-09T20:00:00-05:00","end_time":"2015-11-09T22:00:00-05:00","description":"Immanentizing the eschaton","services":[{"id":"PIJ90N7","type":"service_reference"}]}],"limit":25,"offset":0,"more":false,"total":null}
   */
  async listMaintenanceWindows(filter, serviceId, limit, offset) {
    const query = { limit: limit || PAGE_SIZE, offset: offset || 0 }

    if (filter) query.filter = this.#resolveChoice(filter, MAINTENANCE_WINDOW_FILTER_MAP)
    if (serviceId) query['service_ids[]'] = [serviceId]

    return await this.#apiRequest({ url: `${ API_BASE }/maintenance_windows`, query, logTag: 'listMaintenanceWindows' })
  }

  /**
   * @operationName Get Maintenance Window
   * @category Maintenance Windows
   * @description Retrieves one maintenance window by ID. Use this to inspect a scheduled downtime window.
   * @route POST /get-maintenance-window
   * @paramDef {"type":"String","label":"Maintenance Window","name":"maintenanceWindowId","required":true,"dictionary":"getMaintenanceWindowsDictionary","description":"The window to fetch."}
   * @returns {Object}
   * @sampleResult {"maintenance_window":{"id":"PEYSGVF","start_time":"2015-11-09T20:00:00-05:00","end_time":"2015-11-09T22:00:00-05:00","description":"Immanentizing the eschaton"}}
   */
  async getMaintenanceWindow(maintenanceWindowId) {
    if (!maintenanceWindowId) throw new Error('Maintenance Window is required.')

    return await this.#apiRequest({ url: `${ API_BASE }/maintenance_windows/${ maintenanceWindowId }`, logTag: 'getMaintenanceWindow' })
  }

  /**
   * @operationName Create Maintenance Window
   * @category Maintenance Windows
   * @description Schedules a maintenance window during which alerting for the given services is suppressed. Use this to silence expected noise during a planned deploy or maintenance.
   * @route POST /create-maintenance-window
   * @paramDef {"type":"String","label":"Start Time","name":"startTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"When the maintenance window begins (ISO8601 with offset)."}
   * @paramDef {"type":"String","label":"End Time","name":"endTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"When the window ends (ISO8601 with offset)."}
   * @paramDef {"type":"Array<String>","label":"Services","name":"serviceIds","required":true,"description":"Service IDs whose alerting is suppressed during the window (comma-separated or a list). Use List Services."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Why the maintenance is happening."}
   * @paramDef {"type":"String","label":"From (User Email)","name":"fromEmail","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Email of the user scheduling the window (From header)."}
   * @returns {Object}
   * @sampleResult {"maintenance_window":{"id":"PEYSGVF","start_time":"2015-11-09T20:00:00-05:00","end_time":"2015-11-09T22:00:00-05:00","description":"Immanentizing the eschaton"}}
   */
  async createMaintenanceWindow(startTime, endTime, serviceIds, description, fromEmail) {
    // docs: openapiv3.json POST /maintenance_windows requestBody example
    if (!startTime) throw new Error('Start Time is required.')
    if (!endTime) throw new Error('End Time is required.')

    const services = this.#toList(serviceIds)

    if (!services) throw new Error('At least one Service is required — use List Services.')

    const maintenanceWindow = {
      type: 'maintenance_window',
      start_time: startTime,
      end_time: endTime,
      services: services.map(id => ({ id, type: 'service_reference' })),
    }

    if (description) maintenanceWindow.description = description

    return await this.#apiRequest({
      url: `${ API_BASE }/maintenance_windows`,
      method: 'post',
      body: { maintenance_window: maintenanceWindow },
      fromEmail: await this.#resolveFromEmail(fromEmail),
      logTag: 'createMaintenanceWindow',
    })
  }

  /**
   * @operationName Update Maintenance Window
   * @category Maintenance Windows
   * @description Updates a maintenance window's times, description, or affected services. Use this to reschedule or re-scope planned downtime.
   * @route POST /update-maintenance-window
   * @paramDef {"type":"String","label":"Maintenance Window","name":"maintenanceWindowId","required":true,"dictionary":"getMaintenanceWindowsDictionary","description":"The window to update."}
   * @paramDef {"type":"String","label":"Start Time","name":"startTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"New start time (ISO8601)."}
   * @paramDef {"type":"String","label":"End Time","name":"endTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"New end time (ISO8601)."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description."}
   * @paramDef {"type":"Array<String>","label":"Services","name":"serviceIds","description":"New set of service IDs (comma-separated or a list)."}
   * @returns {Object}
   * @sampleResult {"maintenance_window":{"id":"PEYSGVF","start_time":"2015-11-09T20:00:00-05:00","end_time":"2015-11-09T22:00:00-05:00"}}
   */
  async updateMaintenanceWindow(maintenanceWindowId, startTime, endTime, description, serviceIds) {
    // docs: openapiv3.json PUT /maintenance_windows/{id} requestBody example
    if (!maintenanceWindowId) throw new Error('Maintenance Window is required.')

    const maintenanceWindow = { type: 'maintenance_window' }

    if (startTime) maintenanceWindow.start_time = startTime
    if (endTime) maintenanceWindow.end_time = endTime
    if (description) maintenanceWindow.description = description

    const services = this.#toList(serviceIds)

    if (services) maintenanceWindow.services = services.map(id => ({ id, type: 'service_reference' }))

    return await this.#apiRequest({ url: `${ API_BASE }/maintenance_windows/${ maintenanceWindowId }`, method: 'put', body: { maintenance_window: maintenanceWindow }, logTag: 'updateMaintenanceWindow' })
  }

  /**
   * @operationName Delete Maintenance Window
   * @category Maintenance Windows
   * @description Deletes a maintenance window, or ends it early if it is already running. Use this to cancel planned downtime or restore alerting sooner.
   * @route POST /delete-maintenance-window
   * @paramDef {"type":"String","label":"Maintenance Window","name":"maintenanceWindowId","required":true,"dictionary":"getMaintenanceWindowsDictionary","description":"The window to delete or end."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":"PEYSGVF"}
   */
  async deleteMaintenanceWindow(maintenanceWindowId) {
    // docs: openapiv3.json DELETE /maintenance_windows/{id}
    if (!maintenanceWindowId) throw new Error('Maintenance Window is required.')

    await this.#apiRequest({ url: `${ API_BASE }/maintenance_windows/${ maintenanceWindowId }`, method: 'delete', logTag: 'deleteMaintenanceWindow' })

    return { deleted: true, id: maintenanceWindowId }
  }

  // ==========================================================================
  //  TAGS
  // ==========================================================================
  /**
   * @operationName List Tags
   * @category Tags
   * @description Lists the tags defined in your account, optionally filtered by label. Use this to find a tag ID before assigning or removing it.
   * @route POST /list-tags
   * @paramDef {"type":"String","label":"Search","name":"query","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Filter tags by label."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":25,"description":"Results per page (max 100)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset."}
   * @returns {Object}
   * @sampleResult {"tags":[{"id":"P5IYCNZ","type":"tag","label":"Batman"}],"limit":25,"offset":0,"more":false,"total":null}
   */
  async listTags(query, limit, offset) {
    const q = { limit: limit || PAGE_SIZE, offset: offset || 0 }

    if (query) q.query = query

    return await this.#apiRequest({ url: `${ API_BASE }/tags`, query: q, logTag: 'listTags' })
  }

  /**
   * @operationName Create Tag
   * @category Tags
   * @description Creates a new tag (a free-form label) that can be attached to users, teams, and escalation policies. Use this to introduce a new label before tagging entities with it.
   * @route POST /create-tag
   * @paramDef {"type":"String","label":"Label","name":"label","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The tag text (e.g. a team or environment label)."}
   * @returns {Object}
   * @sampleResult {"tag":{"id":"P5IYCNZ","type":"tag","label":"Batman"}}
   */
  async createTag(label) {
    // docs: openapiv3.json POST /tags requestBody example
    if (!label) throw new Error('Label is required.')

    return await this.#apiRequest({ url: `${ API_BASE }/tags`, method: 'post', body: { tag: { type: 'tag', label } }, logTag: 'createTag' })
  }

  /**
   * @operationName Delete Tag
   * @category Tags
   * @description Permanently deletes a tag, removing it from every entity it was attached to. Use this to retire a label.
   * @route POST /delete-tag
   * @paramDef {"type":"String","label":"Tag","name":"tagId","required":true,"dictionary":"getTagsDictionary","description":"The tag to delete (removes it from all entities)."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":"P5IYCNZ"}
   */
  async deleteTag(tagId) {
    // docs: openapiv3.json DELETE /tags/{id}
    if (!tagId) throw new Error('Tag is required.')

    await this.#apiRequest({ url: `${ API_BASE }/tags/${ tagId }`, method: 'delete', logTag: 'deleteTag' })

    return { deleted: true, id: tagId }
  }

  /**
   * @operationName List Tagged Entities
   * @category Tags
   * @description Lists the users, teams, or escalation policies connected to a tag. Use this to find everything labelled with a given tag.
   * @route POST /list-tagged-entities
   * @paramDef {"type":"String","label":"Tag","name":"tagId","required":true,"dictionary":"getTagsDictionary","description":"The tag whose connected entities to list."}
   * @paramDef {"type":"String","label":"Entity Type","name":"entityType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Users","Teams","Escalation Policies"]}},"description":"Which kind of entity to return for this tag."}
   * @returns {Object}
   * @sampleResult {"users":[{"id":"PXPGF42","type":"user_reference","summary":"Earline Greenholt"}]}
   */
  async listTaggedEntities(tagId, entityType) {
    if (!tagId) throw new Error('Tag is required.')
    if (!entityType) throw new Error('Entity Type is required.')

    const resolvedEntityType = this.#resolveChoice(entityType, ENTITY_TYPE_MAP)

    return await this.#apiRequest({ url: `${ API_BASE }/tags/${ tagId }/${ resolvedEntityType }`, logTag: 'listTaggedEntities' })
  }

  /**
   * @operationName Change Entity Tags
   * @category Tags
   * @description Adds and/or removes tags on a user, team, or escalation policy in one call. New labels are created on the fly; existing tags are referenced by ID. Use this to label entities for filtering and reporting.
   * @route POST /change-entity-tags
   * @paramDef {"type":"String","label":"Entity Type","name":"entityType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Users","Teams","Escalation Policies"]}},"description":"The kind of entity to tag."}
   * @paramDef {"type":"String","label":"Entity","name":"entityRef","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The ID of the user, team, or escalation policy to tag. Use the matching List action to find it."}
   * @paramDef {"type":"Array<String>","label":"Tags To Add (New Labels)","name":"addLabels","description":"New tag labels to create and attach (comma-separated or a list)."}
   * @paramDef {"type":"Array<String>","label":"Tags To Add (Existing)","name":"addTagIds","description":"Existing tag IDs to attach (comma-separated or a list). Use List Tags."}
   * @paramDef {"type":"Array<String>","label":"Tags To Remove","name":"removeTagIds","description":"Existing tag IDs to remove (comma-separated or a list)."}
   * @returns {Object}
   * @sampleResult {"tags":[{"id":"P5IYCNZ","label":"Batman"}]}
   */
  async changeEntityTags(entityType, entityRef, addLabels, addTagIds, removeTagIds) {
    // docs: openapiv3.json POST /{entity_type}/{id}/change_tags requestBody example
    if (!entityType) throw new Error('Entity Type is required.')
    if (!entityRef) throw new Error('Entity is required — use the matching List action to find the ID.')

    const resolvedEntityType = this.#resolveChoice(entityType, ENTITY_TYPE_MAP)
    const add = []
    const labels = this.#toList(addLabels)
    const addIds = this.#toList(addTagIds)
    const removeIds = this.#toList(removeTagIds)

    if (labels) labels.forEach(label => add.push({ type: 'tag', label }))
    if (addIds) addIds.forEach(id => add.push({ type: 'tag_reference', id }))

    if (!add.length && !removeIds) throw new Error('Provide at least one tag to add or remove.')

    const body = {}

    if (add.length) body.add = add
    if (removeIds) body.remove = removeIds.map(id => ({ type: 'tag_reference', id }))

    return await this.#apiRequest({ url: `${ API_BASE }/${ resolvedEntityType }/${ entityRef }/change_tags`, method: 'post', body, logTag: 'changeEntityTags' })
  }

  // ==========================================================================
  //  BUSINESS SERVICES
  // ==========================================================================
  /**
   * @operationName List Business Services
   * @category Business Services
   * @description Lists business services - the customer-facing capabilities (e.g. "Checkout") that technical services roll up into. Use this to find a business service before reading or updating it.
   * @route POST /list-business-services
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":25,"description":"Results per page (max 100)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset."}
   * @returns {Object}
   * @sampleResult {"business_services":[{"id":"PD1234X","name":"Self-serve mobile checkout","description":"Checkout service for our mobile clients","point_of_contact":"PagerDuty Admin"}],"limit":25,"offset":0,"more":false,"total":null}
   */
  async listBusinessServices(limit, offset) {
    return await this.#apiRequest({ url: `${ API_BASE }/business_services`, query: { limit: limit || PAGE_SIZE, offset: offset || 0 }, logTag: 'listBusinessServices' })
  }

  /**
   * @operationName Get Business Service
   * @category Business Services
   * @description Retrieves one business service by ID, including its point of contact and owning team. Use this to inspect a business service.
   * @route POST /get-business-service
   * @paramDef {"type":"String","label":"Business Service","name":"businessServiceId","required":true,"dictionary":"getBusinessServicesDictionary","description":"The business service to fetch."}
   * @returns {Object}
   * @sampleResult {"business_service":{"id":"PD1234X","name":"Self-serve mobile checkout","description":"Checkout service for our mobile clients"}}
   */
  async getBusinessService(businessServiceId) {
    if (!businessServiceId) throw new Error('Business Service is required.')

    return await this.#apiRequest({ url: `${ API_BASE }/business_services/${ businessServiceId }`, logTag: 'getBusinessService' })
  }

  /**
   * @operationName Create Business Service
   * @category Business Services
   * @description Creates a business service to represent a customer-facing capability. Use this to model a product or capability for status and impact reporting.
   * @route POST /create-business-service
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The business service name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"What the business service represents."}
   * @paramDef {"type":"String","label":"Point Of Contact","name":"pointOfContact","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Who owns / is accountable for this business service."}
   * @paramDef {"type":"String","label":"Team","name":"teamId","dictionary":"getTeamsDictionary","description":"The team that owns this business service."}
   * @returns {Object}
   * @sampleResult {"business_service":{"id":"PD1234X","name":"Self-serve mobile checkout","description":"Checkout service for our mobile clients","point_of_contact":"PagerDuty Admin"}}
   */
  async createBusinessService(name, description, pointOfContact, teamId) {
    // docs: openapiv3.json POST /business_services requestBody example
    if (!name) throw new Error('Name is required.')

    const businessService = { name }

    if (description) businessService.description = description
    if (pointOfContact) businessService.point_of_contact = pointOfContact
    if (teamId) businessService.team = { id: teamId }

    return await this.#apiRequest({ url: `${ API_BASE }/business_services`, method: 'post', body: { business_service: businessService }, logTag: 'createBusinessService' })
  }

  /**
   * @operationName Update Business Service
   * @category Business Services
   * @description Updates a business service's name, description, point of contact, or owning team. Use this to keep a business service's metadata current.
   * @route POST /update-business-service
   * @paramDef {"type":"String","label":"Business Service","name":"businessServiceId","required":true,"dictionary":"getBusinessServicesDictionary","description":"The business service to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description."}
   * @paramDef {"type":"String","label":"Point Of Contact","name":"pointOfContact","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New point of contact."}
   * @paramDef {"type":"String","label":"Team","name":"teamId","dictionary":"getTeamsDictionary","description":"New owning team."}
   * @returns {Object}
   * @sampleResult {"business_service":{"id":"PD1234X","name":"Self-serve mobile checkout","description":"Checkout service for our mobile clients"}}
   */
  async updateBusinessService(businessServiceId, name, description, pointOfContact, teamId) {
    // docs: openapiv3.json PUT /business_services/{id} requestBody example
    if (!businessServiceId) throw new Error('Business Service is required.')

    const businessService = {}

    if (name) businessService.name = name
    if (description) businessService.description = description
    if (pointOfContact) businessService.point_of_contact = pointOfContact
    if (teamId) businessService.team = { id: teamId }

    return await this.#apiRequest({ url: `${ API_BASE }/business_services/${ businessServiceId }`, method: 'put', body: { business_service: businessService }, logTag: 'updateBusinessService' })
  }

  /**
   * @operationName Delete Business Service
   * @category Business Services
   * @description Permanently deletes a business service. Use this to remove a retired customer-facing capability.
   * @route POST /delete-business-service
   * @paramDef {"type":"String","label":"Business Service","name":"businessServiceId","required":true,"dictionary":"getBusinessServicesDictionary","description":"The business service to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"id":"PD1234X"}
   */
  async deleteBusinessService(businessServiceId) {
    // docs: openapiv3.json DELETE /business_services/{id}
    if (!businessServiceId) throw new Error('Business Service is required.')

    await this.#apiRequest({ url: `${ API_BASE }/business_services/${ businessServiceId }`, method: 'delete', logTag: 'deleteBusinessService' })

    return { deleted: true, id: businessServiceId }
  }

  // ==========================================================================
  //  EVENTS API v2 - trigger/acknowledge/resolve alerts and record change events.
  //  Separate host and auth from the REST API above (see #eventsRequest).
  // ==========================================================================
  /**
   * @operationName Trigger Alert
   * @category Events
   * @description Sends a trigger event to PagerDuty's Events API v2, raising a new alert on the service tied to the routing key (and, depending on the integration's alert-creation setting, opening or updating an incident). This is the primary automation path for paging from monitoring, scripts, or flows - much lower overhead than Create Incident. Provide a Deduplication Key to update an already-open alert instead of creating a new one; omit it to let PagerDuty generate one, which is returned as dedup_key in the response for later Acknowledge/Resolve calls.
   * @route POST /trigger-alert
   * @paramDef {"type":"String","label":"Routing Key Override","name":"routingKey","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Overrides the configured Events API Routing Key for this call. Use to send this alert to a different PagerDuty service's Events API v2 integration."}
   * @paramDef {"type":"String","label":"Summary","name":"summary","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"A brief, human-readable summary of the problem, used as the alert/incident title (e.g. \"CPU load high on host-1\")."}
   * @paramDef {"type":"String","label":"Source","name":"source","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The unique location of the affected system, preferably a hostname or fully-qualified domain name (e.g. \"prod-web-3\")."}
   * @paramDef {"type":"String","label":"Severity","name":"severity","uiComponent":{"type":"DROPDOWN","options":{"values":["Critical","Error","Warning","Info"]}},"defaultValue":"Critical","description":"The perceived severity of the problem."}
   * @paramDef {"type":"String","label":"Deduplication Key","name":"dedupKey","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Identifies this alert for deduplication and for later Acknowledge/Resolve calls. Reusing the same key updates the existing open alert instead of creating a new one. If omitted, PagerDuty generates one and returns it as dedup_key."}
   * @paramDef {"type":"String","label":"Component","name":"component","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The component of the source machine or service responsible for the event (e.g. \"database\", \"nginx\")."}
   * @paramDef {"type":"String","label":"Group","name":"group","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"A logical grouping of sources (e.g. \"prod-us-east-1\", \"checkout-service\")."}
   * @paramDef {"type":"String","label":"Class","name":"class","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The class/type of the event (e.g. \"ping failure\", \"disk space low\")."}
   * @paramDef {"type":"Object","label":"Custom Details","name":"customDetails","description":"Freeform additional details about the alert as key/value pairs, shown on the resulting incident (e.g. {\"host\":\"web-1\",\"metric\":\"cpu\",\"value\":97})."}
   * @paramDef {"type":"Array<Object>","label":"Links","name":"links","description":"Optional list of links to attach to the alert (e.g. [{\"href\":\"https://example.com/dashboard\",\"text\":\"View Dashboard\"}])."}
   * @paramDef {"type":"Array<Object>","label":"Images","name":"images","description":"Optional list of images to attach to the alert (e.g. [{\"src\":\"https://example.com/chart.png\",\"href\":\"https://example.com\",\"alt\":\"CPU chart\"}])."}
   * @returns {Object}
   * @sampleResult {"status":"success","message":"Event processed","dedup_key":"samplekeydedup"}
   */
  async triggerAlert(routingKey, summary, source, severity, dedupKey, component, group, eventClass, customDetails, links, images) {
    // docs: PagerDuty Events API v2 - POST /v2/enqueue (event_action: trigger)
    if (!summary) throw new Error('Summary is required.')
    if (!source) throw new Error('Source is required.')

    const routing_key = this.#resolveRoutingKey(routingKey)
    const timestamp = new Date().toISOString()

    return await this.#eventsRequest(`${ EVENTS_API_BASE }/enqueue`, {
      routing_key,
      event_action: 'trigger',
      dedup_key: dedupKey,
      payload: clean({
        summary,
        source,
        severity: severity ? this.#resolveChoice(severity, SEVERITY_MAP) : 'critical',
        component,
        group,
        class: eventClass,
        custom_details: customDetails,
        timestamp,
      }),
      links,
      images,
    })
  }

  /**
   * @operationName Acknowledge Alert
   * @category Events
   * @description Sends an acknowledge event to PagerDuty's Events API v2 for an open alert, signaling that someone is working on it and pausing further escalation. Use this from automation that detects a human (or a bot) has taken ownership of a triggered alert.
   * @route POST /acknowledge-alert
   * @paramDef {"type":"String","label":"Routing Key Override","name":"routingKey","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Overrides the configured Events API Routing Key for this call. Must match the routing key the alert was triggered with."}
   * @paramDef {"type":"String","label":"Deduplication Key","name":"dedupKey","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The dedup_key of the alert to acknowledge, from the Trigger Alert response."}
   * @returns {Object}
   * @sampleResult {"status":"success","message":"Event processed","dedup_key":"samplekeydedup"}
   */
  async acknowledgeAlert(routingKey, dedupKey) {
    // docs: PagerDuty Events API v2 - POST /v2/enqueue (event_action: acknowledge)
    if (!dedupKey) throw new Error('Deduplication Key is required.')

    return await this.#eventsRequest(`${ EVENTS_API_BASE }/enqueue`, {
      routing_key: this.#resolveRoutingKey(routingKey),
      event_action: 'acknowledge',
      dedup_key: dedupKey,
    })
  }

  /**
   * @operationName Resolve Alert
   * @category Events
   * @description Sends a resolve event to PagerDuty's Events API v2 for an open alert, closing it out (and resolving the associated incident once all of its alerts are resolved). Use this to automatically clear an alert once the underlying condition recovers.
   * @route POST /resolve-alert
   * @paramDef {"type":"String","label":"Routing Key Override","name":"routingKey","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Overrides the configured Events API Routing Key for this call. Must match the routing key the alert was triggered with."}
   * @paramDef {"type":"String","label":"Deduplication Key","name":"dedupKey","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The dedup_key of the alert to resolve, from the Trigger Alert response."}
   * @returns {Object}
   * @sampleResult {"status":"success","message":"Event processed","dedup_key":"samplekeydedup"}
   */
  async resolveAlert(routingKey, dedupKey) {
    // docs: PagerDuty Events API v2 - POST /v2/enqueue (event_action: resolve)
    if (!dedupKey) throw new Error('Deduplication Key is required.')

    return await this.#eventsRequest(`${ EVENTS_API_BASE }/enqueue`, {
      routing_key: this.#resolveRoutingKey(routingKey),
      event_action: 'resolve',
      dedup_key: dedupKey,
    })
  }

  /**
   * @operationName Send Change Event
   * @category Events
   * @description Records a change event (e.g. a deploy or configuration change) via PagerDuty's Events API v2 change endpoint, for context alongside incidents on the associated service's timeline. Change events do not page anyone and are not incidents - use this to give responders visibility into recent changes that may be related to an incident.
   * @route POST /send-change-event
   * @paramDef {"type":"String","label":"Routing Key Override","name":"routingKey","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Overrides the configured Events API Routing Key for this call."}
   * @paramDef {"type":"String","label":"Summary","name":"summary","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"A brief, human-readable summary of the change (e.g. \"Deployed v1.4.2 to production\")."}
   * @paramDef {"type":"String","label":"Source","name":"source","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The system that generated the change, e.g. a CI/CD pipeline or deployment tool name."}
   * @paramDef {"type":"Object","label":"Custom Details","name":"customDetails","description":"Freeform additional details about the change as key/value pairs (e.g. {\"version\":\"1.4.2\",\"repo\":\"my-app\"})."}
   * @paramDef {"type":"Array<Object>","label":"Links","name":"links","description":"Optional list of links related to the change (e.g. [{\"href\":\"https://example.com/build/123\",\"text\":\"Build 123\"}])."}
   * @returns {Object}
   * @sampleResult {"status":"success","message":"Change event processed"}
   */
  async sendChangeEvent(routingKey, summary, source, customDetails, links) {
    // docs: PagerDuty Events API v2 - POST /v2/change/enqueue
    if (!summary) throw new Error('Summary is required.')

    const routing_key = this.#resolveRoutingKey(routingKey)
    const timestamp = new Date().toISOString()

    return await this.#eventsRequest(`${ EVENTS_API_BASE }/change/enqueue`, {
      routing_key,
      payload: clean({
        summary,
        source,
        custom_details: customDetails,
        timestamp,
      }),
      links,
    })
  }

  // ==========================================================================
  //  DICTIONARIES - back every resource-pick (*Id) param with one of these
  // ==========================================================================
  /**
   * @registerAs DICTIONARY
   * @operationName Get Services Dictionary
   * @description Provides a searchable list of services for dropdown selection in incident, maintenance, and on-call actions.
   * @route POST /get-services-dictionary
   * @paramDef {"type":"getServicesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"My Mail Service","value":"PIJ90N7","note":"PIJ90N7"}],"cursor":"25"}
   */
  async getServicesDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = { limit: PAGE_SIZE, offset: Number(cursor) || 0 }

    if (search) query.query = search

    const result = await this.#apiRequest({ url: `${ API_BASE }/services`, query, logTag: 'getServicesDictionary' })
    const items = (result && result.services) || []

    return {
      items: items.map(s => ({ label: s.name, value: s.id, note: s.id })),
      cursor: this.#nextOffsetCursor(result),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Escalation Policies Dictionary
   * @description Provides a searchable list of escalation policies for dropdown selection in service and incident actions.
   * @route POST /get-escalation-policies-dictionary
   * @paramDef {"type":"getEscalationPoliciesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Engineering Escalation Policy","value":"PT20YPA","note":"PT20YPA"}],"cursor":null}
   */
  async getEscalationPoliciesDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = { limit: PAGE_SIZE, offset: Number(cursor) || 0 }

    if (search) query.query = search

    const result = await this.#apiRequest({ url: `${ API_BASE }/escalation_policies`, query, logTag: 'getEscalationPoliciesDictionary' })
    const items = (result && result.escalation_policies) || []

    return {
      items: items.map(ep => ({ label: ep.name, value: ep.id, note: ep.id })),
      cursor: this.#nextOffsetCursor(result),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Priorities Dictionary
   * @description Provides the account's incident priorities for dropdown selection in incident actions.
   * @route POST /get-priorities-dictionary
   * @paramDef {"type":"getPrioritiesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"P1 — Critical issue","value":"PSLWBL8","note":"P1"}],"cursor":null}
   */
  async getPrioritiesDictionary(payload) {
    const { search, cursor } = payload || {}

    const result = await this.#apiRequest({ url: `${ API_BASE }/priorities`, query: { limit: PAGE_SIZE, offset: Number(cursor) || 0 }, logTag: 'getPrioritiesDictionary' })
    const priorities = (result && result.priorities) || []
    const term = (search || '').toLowerCase()

    const items = priorities
      .map(p => ({ label: p.description ? `${ p.name } — ${ p.description }` : p.name, value: p.id, note: p.name }))
      .filter(item => !term || item.label.toLowerCase().includes(term))

    return { items, cursor: this.#filteredCursor(result, term, items) }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Users Dictionary
   * @description Provides a searchable list of users for dropdown selection in assignment, schedule, team, and responder actions.
   * @route POST /get-users-dictionary
   * @paramDef {"type":"getUsersDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Earline Greenholt (earline@graham.name)","value":"PXPGF42","note":"earline@graham.name"}],"cursor":null}
   */
  async getUsersDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = { limit: PAGE_SIZE, offset: Number(cursor) || 0 }

    if (search) query.query = search

    const result = await this.#apiRequest({ url: `${ API_BASE }/users`, query, logTag: 'getUsersDictionary' })
    const items = (result && result.users) || []

    return {
      items: items.map(u => ({ label: u.email ? `${ u.name } (${ u.email })` : u.name, value: u.id, note: u.email || u.id })),
      cursor: this.#nextOffsetCursor(result),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Teams Dictionary
   * @description Provides a searchable list of teams for dropdown selection in filtering and ownership actions.
   * @route POST /get-teams-dictionary
   * @paramDef {"type":"getTeamsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Engineering","value":"PQ9K7I8","note":"PQ9K7I8"}],"cursor":null}
   */
  async getTeamsDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = { limit: PAGE_SIZE, offset: Number(cursor) || 0 }

    if (search) query.query = search

    const result = await this.#apiRequest({ url: `${ API_BASE }/teams`, query, logTag: 'getTeamsDictionary' })
    const items = (result && result.teams) || []

    return {
      items: items.map(t => ({ label: t.name, value: t.id, note: t.id })),
      cursor: this.#nextOffsetCursor(result),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Schedules Dictionary
   * @description Provides a searchable list of on-call schedules for dropdown selection in override and on-call actions.
   * @route POST /get-schedules-dictionary
   * @paramDef {"type":"getSchedulesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Daily Engineering Rotation","value":"PI7DH85","note":"America/New_York"}],"cursor":null}
   */
  async getSchedulesDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = { limit: PAGE_SIZE, offset: Number(cursor) || 0 }

    if (search) query.query = search

    const result = await this.#apiRequest({ url: `${ API_BASE }/schedules`, query, logTag: 'getSchedulesDictionary' })
    const items = (result && result.schedules) || []

    return {
      items: items.map(s => ({ label: s.name, value: s.id, note: s.time_zone || s.id })),
      cursor: this.#nextOffsetCursor(result),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Incidents Dictionary
   * @description Provides a searchable list of incidents (triggered, acknowledged, and resolved) for dropdown selection in incident actions.
   * @route POST /get-incidents-dictionary
   * @paramDef {"type":"getIncidentsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"#1234 The server is on fire.","value":"PT4KHLK","note":"resolved"}],"cursor":null}
   */
  async getIncidentsDictionary(payload) {
    const { search, cursor } = payload || {}
    // No status filter: include resolved incidents so pickers (e.g. notes, status updates on a
    // closed incident) can reach them. Sorted newest-first so open incidents surface at the top.
    const query = { limit: PAGE_SIZE, offset: Number(cursor) || 0, 'sort_by': 'created_at:desc' }

    const result = await this.#apiRequest({ url: `${ API_BASE }/incidents`, query, logTag: 'getIncidentsDictionary' })
    const incidents = (result && result.incidents) || []
    const term = (search || '').toLowerCase()

    const items = incidents
      .map(i => ({ label: `#${ i.incident_number } ${ i.title }`, value: i.id, note: i.status }))
      .filter(item => !term || item.label.toLowerCase().includes(term))

    return { items, cursor: this.#filteredCursor(result, term, items) }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Incident Alerts Dictionary
   * @description Provides the alerts of a selected incident for dropdown selection in alert actions. Depends on the chosen incident.
   * @route POST /get-incident-alerts-dictionary
   * @paramDef {"type":"getIncidentAlertsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the incident criteria whose alerts to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"High CPU","value":"PEYSGVF","note":"resolved"}],"cursor":null}
   */
  async getIncidentAlertsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const incidentId = criteria?.incidentId

    if (!incidentId) {
      return { items: [], cursor: null }
    }

    const result = await this.#apiRequest({
      url: `${ API_BASE }/incidents/${ incidentId }/alerts`,
      query: { limit: PAGE_SIZE, offset: Number(cursor) || 0 },
      logTag: 'getIncidentAlertsDictionary',
    })
    const alerts = (result && result.alerts) || []
    const term = (search || '').toLowerCase()

    const items = alerts
      .map(a => ({ label: a.summary || a.alert_key || a.id, value: a.id, note: a.status }))
      .filter(item => !term || item.label.toLowerCase().includes(term))

    return { items, cursor: this.#filteredCursor(result, term, items) }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Maintenance Windows Dictionary
   * @description Provides a searchable list of maintenance windows for dropdown selection in maintenance-window actions.
   * @route POST /get-maintenance-windows-dictionary
   * @paramDef {"type":"getMaintenanceWindowsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Immanentizing the eschaton (2015-11-09T20:00:00-05:00)","value":"PEYSGVF","note":"PEYSGVF"}],"cursor":null}
   */
  async getMaintenanceWindowsDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = { limit: PAGE_SIZE, offset: Number(cursor) || 0 }

    if (search) query.query = search

    const result = await this.#apiRequest({ url: `${ API_BASE }/maintenance_windows`, query, logTag: 'getMaintenanceWindowsDictionary' })
    const items = (result && result.maintenance_windows) || []

    return {
      items: items.map(w => ({ label: `${ w.description || 'Maintenance' } (${ w.start_time })`, value: w.id, note: w.id })),
      cursor: this.#nextOffsetCursor(result),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Business Services Dictionary
   * @description Provides a searchable list of business services for dropdown selection in business-service actions.
   * @route POST /get-business-services-dictionary
   * @paramDef {"type":"getBusinessServicesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Self-serve mobile checkout","value":"PD1234X","note":"PD1234X"}],"cursor":null}
   */
  async getBusinessServicesDictionary(payload) {
    const { search, cursor } = payload || {}

    const result = await this.#apiRequest({ url: `${ API_BASE }/business_services`, query: { limit: PAGE_SIZE, offset: Number(cursor) || 0 }, logTag: 'getBusinessServicesDictionary' })
    const services = (result && result.business_services) || []
    const term = (search || '').toLowerCase()

    const items = services
      .map(s => ({ label: s.name, value: s.id, note: s.id }))
      .filter(item => !term || item.label.toLowerCase().includes(term))

    return { items, cursor: this.#filteredCursor(result, term, items) }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tags Dictionary
   * @description Provides a searchable list of tags for dropdown selection in tag actions.
   * @route POST /get-tags-dictionary
   * @paramDef {"type":"getTagsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Batman","value":"P5IYCNZ","note":"P5IYCNZ"}],"cursor":null}
   */
  async getTagsDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = { limit: PAGE_SIZE, offset: Number(cursor) || 0 }

    if (search) query.query = search

    const result = await this.#apiRequest({ url: `${ API_BASE }/tags`, query, logTag: 'getTagsDictionary' })
    const items = (result && result.tags) || []

    return {
      items: items.map(t => ({ label: t.label, value: t.id, note: t.id })),
      cursor: this.#nextOffsetCursor(result),
    }
  }

  // ==========================================================================
  //  TRIGGERS (polling) - state-diff based
  // ==========================================================================
  /**
   * @registerAs POLLING_TRIGGER
   * @operationName On New Triggered Incident
   * @category Triggers
   * @description Fires when a new incident is triggered in PagerDuty, optionally filtered to a service or urgency. Polling interval can be customized (minimum 30 seconds). Use this to kick off a flow the moment a new alert pages.
   * @route POST /on-new-triggered-incident
   * @appearanceColor #06AC38 #25D366
   * @paramDef {"type":"String","label":"Service","name":"serviceId","dictionary":"getServicesDictionary","description":"Only fire for incidents on this service. Leave empty for all services."}
   * @paramDef {"type":"String","label":"Urgency","name":"urgency","uiComponent":{"type":"DROPDOWN","options":{"values":["High","Low"]}},"description":"Only fire for incidents at this urgency."}
   * @returns {Object}
   * @sampleResult {"id":"PT4KHLK","incident_number":1234,"title":"The server is on fire.","status":"triggered","urgency":"high","service":{"id":"PIJ90N7","type":"service_reference"},"created_at":"2015-10-06T21:30:42Z","html_url":"https://subdomain.pagerduty.com/incidents/PT4KHLK"}
   */
  async onNewTriggeredIncident(invocation) {
    const { serviceId, urgency } = invocation.triggerData || {}
    const state = invocation.state || {}

    const filters = {}

    if (serviceId) filters['service_ids[]'] = [serviceId]
    if (urgency) filters['urgencies[]'] = [this.#resolveChoice(urgency, URGENCY_MAP)]

    const cappedSeen = ids => ids.slice(-5000)

    // First run: record the most recent triggered incidents and set the watermark to "now", then
    // emit nothing so an existing backlog does not replay as new. The watermark is "now" (not a
    // value read off this page), so however many incidents already exist, none are mistaken for
    // new on the next poll. Seeding seenIds from the latest page lets the next poll's overlap
    // window dedupe those recent incidents instead of re-firing them.
    if (!state.seenIds) {
      const seed = await this.#apiRequest({
        url: `${ API_BASE }/incidents`,
        query: { ...filters, 'statuses[]': ['triggered'], sort_by: 'created_at:desc', time_zone: 'UTC', limit: 100 },
        logTag: 'onNewTriggeredIncident',
      })
      const seedIncidents = (seed && seed.incidents) || []

      return {
        events: [],
        state: { seenIds: cappedSeen(seedIncidents.map(i => i.id)), lastSince: new Date().toISOString() },
      }
    }

    // Look back a short overlap before the watermark so an incident that only becomes queryable
    // after the watermark moved past its created_at is still returned; seenIds dedupes the overlap.
    // Pin time_zone=UTC so created_at comes back in the same "Z" form as the watermark, keeping the
    // string comparison below correct regardless of the account's default time zone.
    const since = new Date(new Date(state.lastSince).getTime() - 2 * 60 * 1000).toISOString()
    const query = {
      ...filters,
      'statuses[]': ['triggered'],
      sort_by: 'created_at:asc',
      time_zone: 'UTC',
      since,
      limit: 100,
    }

    // Paginate while PagerDuty reports more results, up to a sane bound, so a burst of more than
    // 100 new incidents in the window surfaces in a single poll cycle instead of trickling in
    // 100 at a time across several cycles.
    const MAX_POLL_PAGES = 20
    let incidents = []
    let offset = 0

    for (let page = 0; page < MAX_POLL_PAGES; page++) {
      const result = await this.#apiRequest({
        url: `${ API_BASE }/incidents`,
        query: { ...query, offset },
        logTag: 'onNewTriggeredIncident',
      })
      const pageIncidents = (result && result.incidents) || []

      incidents = incidents.concat(pageIncidents)

      if (!result || !result.more) break

      offset = Number(result.offset || offset) + Number(result.limit || 100)
    }

    const allIds = incidents.map(i => i.id)
    // Carry the watermark to the newest created_at seen, never backward (floor is the prior
    // watermark). With asc sort and since=max(created_at), an undrained window (more than
    // MAX_POLL_PAGES * 100 incidents) keeps a created_at >= the watermark and is re-fetched next
    // poll instead of being skipped.
    const maxCreatedAt = incidents.reduce((max, i) => (i.created_at > max ? i.created_at : max), state.lastSince)

    const seen = new Set(state.seenIds)
    const fresh = incidents.filter(i => !seen.has(i.id))

    return {
      events: fresh.map(i => ({ name: 'onNewTriggeredIncident', data: i })),
      state: { seenIds: cappedSeen([...state.seenIds, ...allIds]), lastSince: maxCreatedAt },
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    return this[invocation.eventName](invocation)
  }
}

Flowrunner.ServerCode.addService(PagerDuty, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth2 Client ID from your PagerDuty app (developer.pagerduty.com → My Apps → your OAuth 2.0 app).',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth2 Client Secret from your PagerDuty app (developer.pagerduty.com → My Apps → your OAuth 2.0 app).',
  },
  {
    name: 'eventsRoutingKey',
    displayName: 'Events API Routing Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'The Integration Key of an Events API v2 integration on a PagerDuty service (in PagerDuty: Service → Integrations → Add → "Events API v2"). Used as the default routing key when triggering, acknowledging, or resolving alerts; each Events action can override it per call.',
  },
])
