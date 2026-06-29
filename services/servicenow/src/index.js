/* eslint-disable no-unused-vars */
/**
 * @integrationName ServiceNow
 * @integrationIcon /icon.svg
 * @requireOAuth
 * @appearanceColor #032D42 #62D84E
 */

/*
 * SPEC: ServiceNow   auth: oauth2 (authorization-code + refresh) + Instance URL config item
 * RESOURCES:
 *   - name: Incident             tier: primary   table: incident        ops: [create, get, list, update, delete]
 *   - name: ChangeRequest        tier: primary   table: change_request  ops: [create, get, list, update, delete]
 *   - name: Problem              tier: primary   table: problem         ops: [create, get, list, update, delete]
 *   - name: RequestedItem        tier: primary   table: sc_req_item     ops: [create, get, list, update, delete]
 *   - name: User                 tier: primary   table: sys_user        ops: [get, list, create, update, delete]   # write ops ACL-gated (see GATES)
 *   - name: GenericTableRecord   tier: secondary table: <user-supplied> ops: [create, get, list, update, delete]   # escape hatch over Table API
 * DICTIONARIES:
 *   - listTables        -> table name picker (curated OOB tables + freetext)   # feeds tableName params
 *   - pickUser          -> sys_user picker  (feeds assigned_to / caller_id / requested_for)
 *   - listUserGroups    -> sys_user_group picker (feeds assignment_group)
 *   - listCatalogItems  -> sc_cat_item picker (feeds cat_item)
 * TRIGGERS: none   # not in this batch (request)
 * GATES:
 *   - sys_user create/update/delete  : requires user_admin/admin ACL on the connected account -> HUMAN LIVE-TEST (Tier 4).
 *   - Rate limiting (HTTP 429)       : per-instance REST rate-limit rules, no fixed number to cite (operational note, not a blocker).
 *   - All write bodies are N1-SATISFIED at build time (verbatim_evidence in DESIGN 1.5/1.6/1.7); no UNVERIFIABLE write endpoints.
 *   - Live writes still require a real ServiceNow PDI/instance + OAuth browser consent -> Tier-4 human pass for every create/update/delete.
 */

const SERVICE_NAME = 'ServiceNow'

// Table name constants (real out-of-the-box ServiceNow tables).
const TABLE_INCIDENT = 'incident'
const TABLE_CHANGE = 'change_request'
const TABLE_PROBLEM = 'problem'
const TABLE_RITM = 'sc_req_item'
const TABLE_USER = 'sys_user'
const TABLE_USER_GROUP = 'sys_user_group'
const TABLE_CAT_ITEM = 'sc_cat_item'
const TABLE_DB_OBJECT = 'sys_db_object'
const TABLE_DICTIONARY = 'sys_dictionary'

const DEFAULT_LIMIT = 50

// Curated set of common OOB tables for the table picker (merged with a live search).
const CURATED_TABLES = [
  { name: 'incident', label: 'Incident' },
  { name: 'change_request', label: 'Change Request' },
  { name: 'problem', label: 'Problem' },
  { name: 'sc_req_item', label: 'Requested Item' },
  { name: 'sc_task', label: 'Catalog Task' },
  { name: 'task', label: 'Task' },
  { name: 'sys_user', label: 'User' },
  { name: 'sys_user_group', label: 'Group' },
  { name: 'cmdb_ci', label: 'Configuration Item' },
  { name: 'kb_knowledge', label: 'Knowledge Article' },
]

const ERROR_HINTS = {
  400: 'Invalid request. Check your filter (ServiceNow encoded-query example: active=true^priority=1) and that field names are real columns.',
  401: 'Your ServiceNow connection expired — reconnect the account.',
  403: 'Your ServiceNow user lacks rights on that table. Ask an admin to grant access (or use a different account).',
  404: 'No record found for that sys_id. Use the matching List action to pick a valid record.',
  429: 'ServiceNow rate limit hit — retry shortly (your instance enforces REST rate limits).',
}

const logger = {
  info: (...args) => console.log(`[${ SERVICE_NAME }] info:`, ...args),
  debug: (...args) => console.log(`[${ SERVICE_NAME }] debug:`, ...args),
  warn: (...args) => console.log(`[${ SERVICE_NAME }] warn:`, ...args),
  error: (...args) => console.log(`[${ SERVICE_NAME }] error:`, ...args),
}

/* ── DROPDOWN label → API value maps (UI shows friendly labels; code sends API values) ── */

const DISPLAY_VALUES = { 'Raw values': 'false', 'Display labels': 'true', Both: 'all' }
const PRIORITY_3 = { High: '1', Medium: '2', Low: '3' }
const CHANGE_TYPE = { Standard: 'standard', Normal: 'normal', Emergency: 'emergency' }
const INCIDENT_CATEGORY = { 'Inquiry / Help': 'inquiry', Software: 'software', Hardware: 'hardware', Network: 'network', Database: 'database' }
const CHANGE_RISK = { High: '2', Moderate: '3', Low: '4' }
const REQ_ITEM_STATE = { 'Pending Approval': '1', Approved: '2', 'Closed Complete': '3', 'Closed Incomplete': '4', 'Closed Skipped': '7' }
const INCIDENT_STATE = { New: '1', 'In Progress': '2', 'On Hold': '3', Resolved: '6', Closed: '7', Canceled: '8' }
const PROBLEM_STATE = { New: '1', Assess: '2', 'Root Cause Analysis': '3', 'Fix in Progress': '4', Resolved: '5', Closed: '6' }
const CHANGE_STATE = { New: '-5', Assess: '-4', Authorize: '-3', Scheduled: '-2', Implement: '-1', Review: '0', Closed: '3', Canceled: '4' }

/* ── Dictionary payload typedefs ──────────────────────────────────────────── */

/**
 * @typedef {Object} listTables__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter tables by name. Matched against the curated list and a live table search."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for the next page of results."}
 */

/**
 * @typedef {Object} pickUser__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter users by name or email."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for the next page of results."}
 */

/**
 * @typedef {Object} listUserGroups__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter assignment groups by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for the next page of results."}
 */

/**
 * @typedef {Object} listCatalogItems__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter catalog items by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for the next page of results."}
 */

/**
 * @typedef {Object} pickIncident__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter incidents by number or short description."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for the next page of results."}
 */

/**
 * @typedef {Object} pickChangeRequest__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter change requests by number or short description."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for the next page of results."}
 */

/**
 * @typedef {Object} pickProblem__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter problems by number or short description."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for the next page of results."}
 */

/**
 * @typedef {Object} pickRequestedItem__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter requested items by number or short description."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for the next page of results."}
 */

/**
 * @typedef {Object} pickTableRecord__payloadCriteria
 * @paramDef {"type":"String","label":"Table","name":"tableName","required":true,"description":"The ServiceNow table whose records to list."}
 */

/**
 * @typedef {Object} pickTableRecord__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter records by number, name, or short description."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for the next page of results."}
 * @paramDef {"type":"pickTableRecord__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the table whose records to list."}
 */

class ServiceNow {
  constructor(config) {
    this.clientId = config.clientId || process.env.SERVICENOW_CLIENT_ID
    this.clientSecret = config.clientSecret || process.env.SERVICENOW_CLIENT_SECRET
    this.instanceUrl = config.instanceUrl || process.env.SERVICENOW_INSTANCE_URL
  }

  /* ── Friendly-label → API-value mapping helper (used by every DROPDOWN param) ── */
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /* ── OAuth SYSTEM methods (instance-relative; URLs built from instanceUrl) ── */

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   */
  async getOAuth2ConnectionURL(authParams) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: authParams.redirectUri,
      state: authParams.state,
    })

    // docs: https://docs.servicenow.com/bundle/xanadu-platform-security/page/administer/security/concept/c_OAuthApplications.html
    return `${ this.#instanceUrl() }/oauth_auth.do?${ params.toString() }`
  }

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   */
  async executeCallback(callbackObject) {
    const code = callbackObject.code || callbackObject.codeParam
    const redirectUri = this.request?.context?.redirectUri || callbackObject.redirectUri || process.env.SERVICENOW_REDIRECT_URI

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    })

    // docs: https://docs.servicenow.com/bundle/xanadu-platform-security/page/integrate/authentication/task/t_SettingUpOAuth.html
    const tokenData = await Flowrunner.Request.post(`${ this.#instanceUrl() }/oauth_token.do`)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' })
      .send(params.toString())

    const identity = await this.#fetchIdentity(tokenData.access_token)

    return {
      token: tokenData.access_token,
      expirationInSeconds: tokenData.expires_in || null,
      refreshToken: tokenData.refresh_token || null,
      connectionIdentityName: identity.name || null,
      connectionIdentityImageURL: null,
      overwrite: true,
    }
  }

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   */
  async refreshToken() {
    const refreshToken = this.request?.context?.refreshToken || this.request?.body?.refreshToken

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    })

    // docs: https://docs.servicenow.com/bundle/xanadu-platform-security/page/integrate/authentication/task/t_SettingUpOAuth.html
    const tokenData = await Flowrunner.Request.post(`${ this.#instanceUrl() }/oauth_token.do`)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' })
      .send(params.toString())

    return {
      token: tokenData.access_token,
      expirationInSeconds: tokenData.expires_in || null,
      refreshToken: tokenData.refresh_token || refreshToken,
      connectionIdentityName: null,
      connectionIdentityImageURL: null,
      overwrite: true,
    }
  }

  /* ── Incident ─────────────────────────────────────────────────────────────── */

  /**
   * @operationName Create Incident
   * @category Incidents
   * @description Create a ServiceNow incident (an outage, ticket, or break/fix record). Use when a flow needs to open a new incident; returns the new INC number and sys_id.
   * @route POST /createIncident
   *
   * @paramDef {"type":"String","label":"Short Description","name":"shortDescription","required":true,"description":"One-line summary of the incident.","uiComponent":{"type":"SINGLE_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Full detail of the incident.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Caller","name":"callerId","dictionary":"pickUser","description":"The user who reported the incident. Pick a user; the sys_id is sent."}
   * @paramDef {"type":"String","label":"Assigned To","name":"assignedTo","dictionary":"pickUser","description":"The user who owns the incident. Pick a user; the sys_id is sent."}
   * @paramDef {"type":"String","label":"Assignment Group","name":"assignmentGroup","dictionary":"listUserGroups","description":"The group that owns the incident. Pick a group; the sys_id is sent."}
   * @paramDef {"type":"String","label":"Category","name":"category","description":"Incident category.","uiComponent":{"type":"DROPDOWN","options":{"values":["Inquiry / Help","Software","Hardware","Network","Database"]}}}
   * @paramDef {"type":"String","label":"Impact","name":"impact","description":"Business impact of the incident.","uiComponent":{"type":"DROPDOWN","options":{"values":["High","Medium","Low"]}}}
   * @paramDef {"type":"String","label":"Urgency","name":"urgency","description":"How quickly the incident must be resolved.","uiComponent":{"type":"DROPDOWN","options":{"values":["High","Medium","Low"]}}}
   * @paramDef {"type":"String","label":"State","name":"state","description":"Lifecycle state of the incident.","uiComponent":{"type":"DROPDOWN","options":{"values":["New","In Progress","On Hold","Resolved","Closed","Canceled"]}}}
   * @paramDef {"type":"String","label":"Additional Comments (customer-visible)","name":"comments","description":"A comment visible to the caller.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Work Notes (internal)","name":"workNotes","description":"An internal-only work note.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   *
   * @returns {Object}
   * @sampleResult {"result":{"number":"INC0010002","sys_id":"a1b2c3","short_description":"Unable to connect to email","state":"1","impact":"2","urgency":"2","priority":"3"}}
   */
  async createIncident(shortDescription, description, callerId, assignedTo, assignmentGroup, category, impact, urgency, state, comments, workNotes) {
    if (!shortDescription) throw new Error('Short Description is required to create an incident.')

    const body = this.#compact({
      short_description: shortDescription,
      description,
      caller_id: callerId,
      assigned_to: assignedTo,
      assignment_group: assignmentGroup,
      category: this.#resolveChoice(category, INCIDENT_CATEGORY),
      impact: this.#resolveChoice(impact, PRIORITY_3),
      urgency: this.#resolveChoice(urgency, PRIORITY_3),
      state: this.#resolveChoice(state, INCIDENT_STATE),
      comments,
      work_notes: workNotes,
    })

    // docs: https://docs.servicenow.com/bundle/xanadu-api-reference/page/integrate/inbound-rest/concept/c_TableAPI.html#title_table-POST
    return await this.#apiRequest({ method: 'post', table: TABLE_INCIDENT, body, logTag: 'createIncident' })
  }

  /**
   * @operationName Get Incident
   * @category Incidents
   * @description Fetch one incident by its sys_id. Feed the sys_id from List Incidents or Create Incident.
   * @route POST /getIncident
   *
   * @paramDef {"type":"String","label":"Incident","name":"sysId","required":true,"dictionary":"pickIncident","description":"The incident to act on. Pick an incident; its sys_id is sent."}
   * @paramDef {"type":"String","label":"Value Format","name":"displayValues","description":"Whether field values come back as raw codes, human labels, or both.","defaultValue":"Display labels","uiComponent":{"type":"DROPDOWN","options":{"values":["Raw values","Display labels","Both"]}}}
   * @paramDef {"type":"Array<String>","label":"Return Fields","name":"fields","description":"Restrict the response to these columns. Accepts an array or a comma-separated string."}
   *
   * @returns {Object}
   * @sampleResult {"result":{"number":"INC0000060","sys_id":"a1b2c3","short_description":"Unable to connect to email","state":"1","priority":"3"}}
   */
  async getIncident(sysId, displayValues, fields) {
    return await this.#getRecord(TABLE_INCIDENT, sysId, displayValues, fields, 'getIncident')
  }

  /**
   * @operationName List Incidents
   * @category Incidents
   * @description List or search incidents. Filter with a ServiceNow encoded query (e.g. active=true^priority=1) and page with limit/offset.
   * @route POST /listIncidents
   *
   * @paramDef {"type":"String","label":"Filter (encoded query)","name":"query","description":"ServiceNow encoded query, e.g. active=true^priority=1. Leave blank to list all.","uiComponent":{"type":"SINGLE_LINE_TEXT"}}
   * @paramDef {"type":"Number","label":"Page Size","name":"limit","description":"Maximum records to return (default 50).","defaultValue":50,"uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","description":"Records to skip for pagination (default 0). Use next_offset from a prior page.","defaultValue":0,"uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"String","label":"Value Format","name":"displayValues","description":"Whether field values come back as raw codes, human labels, or both.","defaultValue":"Display labels","uiComponent":{"type":"DROPDOWN","options":{"values":["Raw values","Display labels","Both"]}}}
   * @paramDef {"type":"Array<String>","label":"Return Fields","name":"fields","description":"Restrict the response to these columns. Accepts an array or a comma-separated string."}
   *
   * @returns {Object}
   * @sampleResult {"result":[{"number":"INC0000060","sys_id":"a1b2c3","short_description":"Unable to connect to email","state":"1","priority":"3"}],"next_offset":50}
   */
  async listIncidents(query, limit, offset, displayValues, fields) {
    return await this.#listRecords(TABLE_INCIDENT, query, limit, offset, displayValues, fields, 'listIncidents')
  }

  /**
   * @operationName Update Incident
   * @category Incidents
   * @description Update fields on an incident by sys_id (PATCH — only the fields you set are changed). Common uses: change state, reassign, or add comments.
   * @route POST /updateIncident
   *
   * @paramDef {"type":"String","label":"Incident","name":"sysId","required":true,"dictionary":"pickIncident","description":"The incident to update. Pick an incident; its sys_id is sent."}
   * @paramDef {"type":"String","label":"Short Description","name":"shortDescription","description":"New one-line summary.","uiComponent":{"type":"SINGLE_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"New full detail.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Caller","name":"callerId","dictionary":"pickUser","description":"New caller. Pick a user; the sys_id is sent."}
   * @paramDef {"type":"String","label":"Assigned To","name":"assignedTo","dictionary":"pickUser","description":"New owner. Pick a user; the sys_id is sent."}
   * @paramDef {"type":"String","label":"Assignment Group","name":"assignmentGroup","dictionary":"listUserGroups","description":"New owning group. Pick a group; the sys_id is sent."}
   * @paramDef {"type":"String","label":"Category","name":"category","description":"New category.","uiComponent":{"type":"DROPDOWN","options":{"values":["Inquiry / Help","Software","Hardware","Network","Database"]}}}
   * @paramDef {"type":"String","label":"Impact","name":"impact","description":"New business impact.","uiComponent":{"type":"DROPDOWN","options":{"values":["High","Medium","Low"]}}}
   * @paramDef {"type":"String","label":"Urgency","name":"urgency","description":"New urgency.","uiComponent":{"type":"DROPDOWN","options":{"values":["High","Medium","Low"]}}}
   * @paramDef {"type":"String","label":"State","name":"state","description":"New lifecycle state.","uiComponent":{"type":"DROPDOWN","options":{"values":["New","In Progress","On Hold","Resolved","Closed","Canceled"]}}}
   * @paramDef {"type":"String","label":"Additional Comments (customer-visible)","name":"comments","description":"Append a caller-visible comment.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Work Notes (internal)","name":"workNotes","description":"Append an internal-only work note.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   *
   * @returns {Object}
   * @sampleResult {"result":{"number":"INC0000060","sys_id":"a1b2c3","state":"2","assigned_to":{"value":"681b365ec0a80164000fb0b05854a0cd"}}}
   */
  async updateIncident(sysId, shortDescription, description, callerId, assignedTo, assignmentGroup, category, impact, urgency, state, comments, workNotes) {
    if (!sysId) throw new Error('Incident sys_id is required. Get it from List Incidents or Create Incident.')

    const body = this.#compact({
      short_description: shortDescription,
      description,
      caller_id: callerId,
      assigned_to: assignedTo,
      assignment_group: assignmentGroup,
      category: this.#resolveChoice(category, INCIDENT_CATEGORY),
      impact: this.#resolveChoice(impact, PRIORITY_3),
      urgency: this.#resolveChoice(urgency, PRIORITY_3),
      state: this.#resolveChoice(state, INCIDENT_STATE),
      comments,
      work_notes: workNotes,
    })

    // docs: https://docs.servicenow.com/bundle/xanadu-api-reference/page/integrate/inbound-rest/concept/c_TableAPI.html#title_table-PUT
    return await this.#apiRequest({ method: 'patch', table: TABLE_INCIDENT, sysId, body, logTag: 'updateIncident' })
  }

  /**
   * @operationName Delete Incident
   * @category Incidents
   * @description Delete an incident by sys_id. Permanent — the record cannot be recovered.
   * @route POST /deleteIncident
   *
   * @paramDef {"type":"String","label":"Incident","name":"sysId","required":true,"dictionary":"pickIncident","description":"The incident to delete. Pick an incident; its sys_id is sent."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"sys_id":"a1b2c3"}
   */
  async deleteIncident(sysId) {
    return await this.#deleteRecord(TABLE_INCIDENT, sysId, 'deleteIncident')
  }

  /* ── Change Request ───────────────────────────────────────────────────────── */

  /**
   * @operationName Create Change Request
   * @category Change Requests
   * @description Create a ServiceNow change request for change management. Use when a flow needs to propose a standard, normal, or emergency change; returns the new CHG number and sys_id.
   * @route POST /createChangeRequest
   *
   * @paramDef {"type":"String","label":"Short Description","name":"shortDescription","required":true,"description":"One-line summary of the change.","uiComponent":{"type":"SINGLE_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Full detail of the change.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Type","name":"type","description":"Change type.","uiComponent":{"type":"DROPDOWN","options":{"values":["Standard","Normal","Emergency"]}}}
   * @paramDef {"type":"String","label":"Risk","name":"risk","description":"Risk level of the change.","uiComponent":{"type":"DROPDOWN","options":{"values":["High","Moderate","Low"]}}}
   * @paramDef {"type":"String","label":"Impact","name":"impact","description":"Business impact of the change.","uiComponent":{"type":"DROPDOWN","options":{"values":["High","Medium","Low"]}}}
   * @paramDef {"type":"String","label":"Assigned To","name":"assignedTo","dictionary":"pickUser","description":"The user who owns the change. Pick a user; the sys_id is sent."}
   * @paramDef {"type":"String","label":"Assignment Group","name":"assignmentGroup","dictionary":"listUserGroups","description":"The group that owns the change. Pick a group; the sys_id is sent."}
   * @paramDef {"type":"String","label":"State","name":"state","description":"Lifecycle state of the change.","uiComponent":{"type":"DROPDOWN","options":{"values":["New","Assess","Authorize","Scheduled","Implement","Review","Closed","Canceled"]}}}
   * @paramDef {"type":"String","label":"Planned Start","name":"startDate","description":"Planned start of the change window (YYYY-MM-DD HH:MM:SS).","uiComponent":{"type":"DATE_TIME_PICKER"}}
   * @paramDef {"type":"String","label":"Planned End","name":"endDate","description":"Planned end of the change window (YYYY-MM-DD HH:MM:SS).","uiComponent":{"type":"DATE_TIME_PICKER"}}
   *
   * @returns {Object}
   * @sampleResult {"result":{"number":"CHG0030001","sys_id":"d4e5f6","type":"normal","state":"-5","risk":"3"}}
   */
  async createChangeRequest(shortDescription, description, type, risk, impact, assignedTo, assignmentGroup, state, startDate, endDate) {
    if (!shortDescription) throw new Error('Short Description is required to create a change request.')

    const body = this.#compact({
      short_description: shortDescription,
      description,
      type: this.#resolveChoice(type, CHANGE_TYPE),
      risk: this.#resolveChoice(risk, CHANGE_RISK),
      impact: this.#resolveChoice(impact, PRIORITY_3),
      assigned_to: assignedTo,
      assignment_group: assignmentGroup,
      state: this.#resolveChoice(state, CHANGE_STATE),
      start_date: startDate,
      end_date: endDate,
    })

    // docs: https://docs.servicenow.com/bundle/xanadu-api-reference/page/integrate/inbound-rest/concept/c_TableAPI.html#title_table-POST
    return await this.#apiRequest({ method: 'post', table: TABLE_CHANGE, body, logTag: 'createChangeRequest' })
  }

  /**
   * @operationName Get Change Request
   * @category Change Requests
   * @description Fetch one change request by its sys_id. Feed the sys_id from List Change Requests or Create Change Request.
   * @route POST /getChangeRequest
   *
   * @paramDef {"type":"String","label":"Change Request","name":"sysId","required":true,"dictionary":"pickChangeRequest","description":"The change request to act on. Pick a change request; its sys_id is sent."}
   * @paramDef {"type":"String","label":"Value Format","name":"displayValues","description":"Whether field values come back as raw codes, human labels, or both.","defaultValue":"Display labels","uiComponent":{"type":"DROPDOWN","options":{"values":["Raw values","Display labels","Both"]}}}
   * @paramDef {"type":"Array<String>","label":"Return Fields","name":"fields","description":"Restrict the response to these columns. Accepts an array or a comma-separated string."}
   *
   * @returns {Object}
   * @sampleResult {"result":{"number":"CHG0030001","sys_id":"d4e5f6","type":"normal","state":"-5","risk":"3"}}
   */
  async getChangeRequest(sysId, displayValues, fields) {
    return await this.#getRecord(TABLE_CHANGE, sysId, displayValues, fields, 'getChangeRequest')
  }

  /**
   * @operationName List Change Requests
   * @category Change Requests
   * @description List or search change requests. Filter with a ServiceNow encoded query (e.g. active=true^type=emergency) and page with limit/offset.
   * @route POST /listChangeRequests
   *
   * @paramDef {"type":"String","label":"Filter (encoded query)","name":"query","description":"ServiceNow encoded query, e.g. active=true^type=emergency. Leave blank to list all.","uiComponent":{"type":"SINGLE_LINE_TEXT"}}
   * @paramDef {"type":"Number","label":"Page Size","name":"limit","description":"Maximum records to return (default 50).","defaultValue":50,"uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","description":"Records to skip for pagination (default 0). Use next_offset from a prior page.","defaultValue":0,"uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"String","label":"Value Format","name":"displayValues","description":"Whether field values come back as raw codes, human labels, or both.","defaultValue":"Display labels","uiComponent":{"type":"DROPDOWN","options":{"values":["Raw values","Display labels","Both"]}}}
   * @paramDef {"type":"Array<String>","label":"Return Fields","name":"fields","description":"Restrict the response to these columns. Accepts an array or a comma-separated string."}
   *
   * @returns {Object}
   * @sampleResult {"result":[{"number":"CHG0030001","sys_id":"d4e5f6","type":"normal","state":"-5","risk":"3"}],"next_offset":50}
   */
  async listChangeRequests(query, limit, offset, displayValues, fields) {
    return await this.#listRecords(TABLE_CHANGE, query, limit, offset, displayValues, fields, 'listChangeRequests')
  }

  /**
   * @operationName Update Change Request
   * @category Change Requests
   * @description Update fields on a change request by sys_id (PATCH — only the fields you set are changed). Common uses: advance the state, set risk, or reassign.
   * @route POST /updateChangeRequest
   *
   * @paramDef {"type":"String","label":"Change Request","name":"sysId","required":true,"dictionary":"pickChangeRequest","description":"The change request to update. Pick a change request; its sys_id is sent."}
   * @paramDef {"type":"String","label":"Short Description","name":"shortDescription","description":"New one-line summary.","uiComponent":{"type":"SINGLE_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"New full detail.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Type","name":"type","description":"New change type.","uiComponent":{"type":"DROPDOWN","options":{"values":["Standard","Normal","Emergency"]}}}
   * @paramDef {"type":"String","label":"Risk","name":"risk","description":"New risk level.","uiComponent":{"type":"DROPDOWN","options":{"values":["High","Moderate","Low"]}}}
   * @paramDef {"type":"String","label":"Impact","name":"impact","description":"New business impact.","uiComponent":{"type":"DROPDOWN","options":{"values":["High","Medium","Low"]}}}
   * @paramDef {"type":"String","label":"Assigned To","name":"assignedTo","dictionary":"pickUser","description":"New owner. Pick a user; the sys_id is sent."}
   * @paramDef {"type":"String","label":"Assignment Group","name":"assignmentGroup","dictionary":"listUserGroups","description":"New owning group. Pick a group; the sys_id is sent."}
   * @paramDef {"type":"String","label":"State","name":"state","description":"New lifecycle state.","uiComponent":{"type":"DROPDOWN","options":{"values":["New","Assess","Authorize","Scheduled","Implement","Review","Closed","Canceled"]}}}
   * @paramDef {"type":"String","label":"Planned Start","name":"startDate","description":"New planned start (YYYY-MM-DD HH:MM:SS).","uiComponent":{"type":"DATE_TIME_PICKER"}}
   * @paramDef {"type":"String","label":"Planned End","name":"endDate","description":"New planned end (YYYY-MM-DD HH:MM:SS).","uiComponent":{"type":"DATE_TIME_PICKER"}}
   *
   * @returns {Object}
   * @sampleResult {"result":{"number":"CHG0030001","sys_id":"d4e5f6","state":"-2","risk":"3"}}
   */
  async updateChangeRequest(sysId, shortDescription, description, type, risk, impact, assignedTo, assignmentGroup, state, startDate, endDate) {
    if (!sysId) throw new Error('Change sys_id is required. Get it from List Change Requests or Create Change Request.')

    const body = this.#compact({
      short_description: shortDescription,
      description,
      type: this.#resolveChoice(type, CHANGE_TYPE),
      risk: this.#resolveChoice(risk, CHANGE_RISK),
      impact: this.#resolveChoice(impact, PRIORITY_3),
      assigned_to: assignedTo,
      assignment_group: assignmentGroup,
      state: this.#resolveChoice(state, CHANGE_STATE),
      start_date: startDate,
      end_date: endDate,
    })

    // docs: https://docs.servicenow.com/bundle/xanadu-api-reference/page/integrate/inbound-rest/concept/c_TableAPI.html#title_table-PUT
    return await this.#apiRequest({ method: 'patch', table: TABLE_CHANGE, sysId, body, logTag: 'updateChangeRequest' })
  }

  /**
   * @operationName Delete Change Request
   * @category Change Requests
   * @description Delete a change request by sys_id. Permanent — the record cannot be recovered.
   * @route POST /deleteChangeRequest
   *
   * @paramDef {"type":"String","label":"Change Request","name":"sysId","required":true,"dictionary":"pickChangeRequest","description":"The change request to delete. Pick a change request; its sys_id is sent."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"sys_id":"d4e5f6"}
   */
  async deleteChangeRequest(sysId) {
    return await this.#deleteRecord(TABLE_CHANGE, sysId, 'deleteChangeRequest')
  }

  /* ── Problem ──────────────────────────────────────────────────────────────── */

  /**
   * @operationName Create Problem
   * @category Problems
   * @description Create a ServiceNow problem record for root-cause analysis behind recurring incidents. Returns the new PRB number and sys_id.
   * @route POST /createProblem
   *
   * @paramDef {"type":"String","label":"Short Description","name":"shortDescription","required":true,"description":"One-line summary of the problem.","uiComponent":{"type":"SINGLE_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Full detail of the problem.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Impact","name":"impact","description":"Business impact of the problem.","uiComponent":{"type":"DROPDOWN","options":{"values":["High","Medium","Low"]}}}
   * @paramDef {"type":"String","label":"Urgency","name":"urgency","description":"How quickly the problem must be addressed.","uiComponent":{"type":"DROPDOWN","options":{"values":["High","Medium","Low"]}}}
   * @paramDef {"type":"String","label":"State","name":"state","description":"Lifecycle state of the problem.","uiComponent":{"type":"DROPDOWN","options":{"values":["New","Assess","Root Cause Analysis","Fix in Progress","Resolved","Closed"]}}}
   * @paramDef {"type":"String","label":"Assigned To","name":"assignedTo","dictionary":"pickUser","description":"The user who owns the problem. Pick a user; the sys_id is sent."}
   * @paramDef {"type":"String","label":"Assignment Group","name":"assignmentGroup","dictionary":"listUserGroups","description":"The group that owns the problem. Pick a group; the sys_id is sent."}
   *
   * @returns {Object}
   * @sampleResult {"result":{"number":"PRB0040001","sys_id":"g7h8i9","state":"1"}}
   */
  async createProblem(shortDescription, description, impact, urgency, state, assignedTo, assignmentGroup) {
    if (!shortDescription) throw new Error('Short Description is required to create a problem.')

    const body = this.#compact({
      short_description: shortDescription,
      description,
      impact: this.#resolveChoice(impact, PRIORITY_3),
      urgency: this.#resolveChoice(urgency, PRIORITY_3),
      state: this.#resolveChoice(state, PROBLEM_STATE),
      assigned_to: assignedTo,
      assignment_group: assignmentGroup,
    })

    // docs: https://docs.servicenow.com/bundle/xanadu-api-reference/page/integrate/inbound-rest/concept/c_TableAPI.html#title_table-POST
    return await this.#apiRequest({ method: 'post', table: TABLE_PROBLEM, body, logTag: 'createProblem' })
  }

  /**
   * @operationName Get Problem
   * @category Problems
   * @description Fetch one problem by its sys_id. Feed the sys_id from List Problems or Create Problem.
   * @route POST /getProblem
   *
   * @paramDef {"type":"String","label":"Problem","name":"sysId","required":true,"dictionary":"pickProblem","description":"The problem to act on. Pick a problem; its sys_id is sent."}
   * @paramDef {"type":"String","label":"Value Format","name":"displayValues","description":"Whether field values come back as raw codes, human labels, or both.","defaultValue":"Display labels","uiComponent":{"type":"DROPDOWN","options":{"values":["Raw values","Display labels","Both"]}}}
   * @paramDef {"type":"Array<String>","label":"Return Fields","name":"fields","description":"Restrict the response to these columns. Accepts an array or a comma-separated string."}
   *
   * @returns {Object}
   * @sampleResult {"result":{"number":"PRB0040001","sys_id":"g7h8i9","state":"1"}}
   */
  async getProblem(sysId, displayValues, fields) {
    return await this.#getRecord(TABLE_PROBLEM, sysId, displayValues, fields, 'getProblem')
  }

  /**
   * @operationName List Problems
   * @category Problems
   * @description List or search problems. Filter with a ServiceNow encoded query (e.g. state=1) and page with limit/offset.
   * @route POST /listProblems
   *
   * @paramDef {"type":"String","label":"Filter (encoded query)","name":"query","description":"ServiceNow encoded query, e.g. state=1. Leave blank to list all.","uiComponent":{"type":"SINGLE_LINE_TEXT"}}
   * @paramDef {"type":"Number","label":"Page Size","name":"limit","description":"Maximum records to return (default 50).","defaultValue":50,"uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","description":"Records to skip for pagination (default 0). Use next_offset from a prior page.","defaultValue":0,"uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"String","label":"Value Format","name":"displayValues","description":"Whether field values come back as raw codes, human labels, or both.","defaultValue":"Display labels","uiComponent":{"type":"DROPDOWN","options":{"values":["Raw values","Display labels","Both"]}}}
   * @paramDef {"type":"Array<String>","label":"Return Fields","name":"fields","description":"Restrict the response to these columns. Accepts an array or a comma-separated string."}
   *
   * @returns {Object}
   * @sampleResult {"result":[{"number":"PRB0040001","sys_id":"g7h8i9","state":"1"}],"next_offset":50}
   */
  async listProblems(query, limit, offset, displayValues, fields) {
    return await this.#listRecords(TABLE_PROBLEM, query, limit, offset, displayValues, fields, 'listProblems')
  }

  /**
   * @operationName Update Problem
   * @category Problems
   * @description Update fields on a problem by sys_id (PATCH — only the fields you set are changed). Common uses: advance the state through root-cause analysis or reassign.
   * @route POST /updateProblem
   *
   * @paramDef {"type":"String","label":"Problem","name":"sysId","required":true,"dictionary":"pickProblem","description":"The problem to update. Pick a problem; its sys_id is sent."}
   * @paramDef {"type":"String","label":"Short Description","name":"shortDescription","description":"New one-line summary.","uiComponent":{"type":"SINGLE_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"New full detail.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Impact","name":"impact","description":"New business impact.","uiComponent":{"type":"DROPDOWN","options":{"values":["High","Medium","Low"]}}}
   * @paramDef {"type":"String","label":"Urgency","name":"urgency","description":"New urgency.","uiComponent":{"type":"DROPDOWN","options":{"values":["High","Medium","Low"]}}}
   * @paramDef {"type":"String","label":"State","name":"state","description":"New lifecycle state.","uiComponent":{"type":"DROPDOWN","options":{"values":["New","Assess","Root Cause Analysis","Fix in Progress","Resolved","Closed"]}}}
   * @paramDef {"type":"String","label":"Assigned To","name":"assignedTo","dictionary":"pickUser","description":"New owner. Pick a user; the sys_id is sent."}
   * @paramDef {"type":"String","label":"Assignment Group","name":"assignmentGroup","dictionary":"listUserGroups","description":"New owning group. Pick a group; the sys_id is sent."}
   *
   * @returns {Object}
   * @sampleResult {"result":{"number":"PRB0040001","sys_id":"g7h8i9","state":"3"}}
   */
  async updateProblem(sysId, shortDescription, description, impact, urgency, state, assignedTo, assignmentGroup) {
    if (!sysId) throw new Error('Problem sys_id is required. Get it from List Problems or Create Problem.')

    const body = this.#compact({
      short_description: shortDescription,
      description,
      impact: this.#resolveChoice(impact, PRIORITY_3),
      urgency: this.#resolveChoice(urgency, PRIORITY_3),
      state: this.#resolveChoice(state, PROBLEM_STATE),
      assigned_to: assignedTo,
      assignment_group: assignmentGroup,
    })

    // docs: https://docs.servicenow.com/bundle/xanadu-api-reference/page/integrate/inbound-rest/concept/c_TableAPI.html#title_table-PUT
    return await this.#apiRequest({ method: 'patch', table: TABLE_PROBLEM, sysId, body, logTag: 'updateProblem' })
  }

  /**
   * @operationName Delete Problem
   * @category Problems
   * @description Delete a problem by sys_id. Permanent — the record cannot be recovered.
   * @route POST /deleteProblem
   *
   * @paramDef {"type":"String","label":"Problem","name":"sysId","required":true,"dictionary":"pickProblem","description":"The problem to delete. Pick a problem; its sys_id is sent."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"sys_id":"g7h8i9"}
   */
  async deleteProblem(sysId) {
    return await this.#deleteRecord(TABLE_PROBLEM, sysId, 'deleteProblem')
  }

  /* ── Requested Item ───────────────────────────────────────────────────────── */

  /**
   * @operationName Create Requested Item
   * @category Requested Items
   * @description Create a service catalog requested item (RITM) — a fulfillment line item for a catalog request. Returns the new RITM number and sys_id.
   * @route POST /createRequestedItem
   *
   * @paramDef {"type":"String","label":"Short Description","name":"shortDescription","required":true,"description":"One-line summary of the requested item.","uiComponent":{"type":"SINGLE_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Full detail of the requested item.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Catalog Item","name":"catItem","dictionary":"listCatalogItems","description":"The catalog item being requested. Pick an item; the sys_id is sent."}
   * @paramDef {"type":"String","label":"Requested For","name":"requestedFor","dictionary":"pickUser","description":"The beneficiary of the request. Pick a user; the sys_id is sent."}
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","description":"How many of the item to request (default 1).","defaultValue":1,"uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"String","label":"State","name":"state","description":"Lifecycle state of the requested item.","uiComponent":{"type":"DROPDOWN","options":{"values":["Pending Approval","Approved","Closed Complete","Closed Incomplete","Closed Skipped"]}}}
   * @paramDef {"type":"String","label":"Assigned To","name":"assignedTo","dictionary":"pickUser","description":"The fulfiller of the requested item. Pick a user; the sys_id is sent."}
   *
   * @returns {Object}
   * @sampleResult {"result":{"number":"RITM0050001","sys_id":"j1k2l3","quantity":"1","state":"1"}}
   */
  async createRequestedItem(shortDescription, description, catItem, requestedFor, quantity, state, assignedTo) {
    if (!shortDescription) throw new Error('Short Description is required to create a requested item.')

    const body = this.#compact({
      short_description: shortDescription,
      description,
      cat_item: catItem,
      requested_for: requestedFor,
      quantity: quantity == null ? undefined : String(quantity),
      state: this.#resolveChoice(state, REQ_ITEM_STATE),
      assigned_to: assignedTo,
    })

    // docs: https://docs.servicenow.com/bundle/xanadu-api-reference/page/integrate/inbound-rest/concept/c_TableAPI.html#title_table-POST
    return await this.#apiRequest({ method: 'post', table: TABLE_RITM, body, logTag: 'createRequestedItem' })
  }

  /**
   * @operationName Get Requested Item
   * @category Requested Items
   * @description Fetch one requested item by its sys_id. Feed the sys_id from List Requested Items or Create Requested Item.
   * @route POST /getRequestedItem
   *
   * @paramDef {"type":"String","label":"Requested Item","name":"sysId","required":true,"dictionary":"pickRequestedItem","description":"The requested item to act on. Pick a requested item; its sys_id is sent."}
   * @paramDef {"type":"String","label":"Value Format","name":"displayValues","description":"Whether field values come back as raw codes, human labels, or both.","defaultValue":"Display labels","uiComponent":{"type":"DROPDOWN","options":{"values":["Raw values","Display labels","Both"]}}}
   * @paramDef {"type":"Array<String>","label":"Return Fields","name":"fields","description":"Restrict the response to these columns. Accepts an array or a comma-separated string."}
   *
   * @returns {Object}
   * @sampleResult {"result":{"number":"RITM0050001","sys_id":"j1k2l3","quantity":"1","state":"1"}}
   */
  async getRequestedItem(sysId, displayValues, fields) {
    return await this.#getRecord(TABLE_RITM, sysId, displayValues, fields, 'getRequestedItem')
  }

  /**
   * @operationName List Requested Items
   * @category Requested Items
   * @description List or search requested items (RITMs). Filter with a ServiceNow encoded query (e.g. state=1) and page with limit/offset.
   * @route POST /listRequestedItems
   *
   * @paramDef {"type":"String","label":"Filter (encoded query)","name":"query","description":"ServiceNow encoded query, e.g. state=1. Leave blank to list all.","uiComponent":{"type":"SINGLE_LINE_TEXT"}}
   * @paramDef {"type":"Number","label":"Page Size","name":"limit","description":"Maximum records to return (default 50).","defaultValue":50,"uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","description":"Records to skip for pagination (default 0). Use next_offset from a prior page.","defaultValue":0,"uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"String","label":"Value Format","name":"displayValues","description":"Whether field values come back as raw codes, human labels, or both.","defaultValue":"Display labels","uiComponent":{"type":"DROPDOWN","options":{"values":["Raw values","Display labels","Both"]}}}
   * @paramDef {"type":"Array<String>","label":"Return Fields","name":"fields","description":"Restrict the response to these columns. Accepts an array or a comma-separated string."}
   *
   * @returns {Object}
   * @sampleResult {"result":[{"number":"RITM0050001","sys_id":"j1k2l3","quantity":"1","state":"1"}],"next_offset":50}
   */
  async listRequestedItems(query, limit, offset, displayValues, fields) {
    return await this.#listRecords(TABLE_RITM, query, limit, offset, displayValues, fields, 'listRequestedItems')
  }

  /**
   * @operationName Update Requested Item
   * @category Requested Items
   * @description Update fields on a requested item by sys_id (PATCH — only the fields you set are changed). Common uses: advance the state or assign a fulfiller.
   * @route POST /updateRequestedItem
   *
   * @paramDef {"type":"String","label":"Requested Item","name":"sysId","required":true,"dictionary":"pickRequestedItem","description":"The requested item to update. Pick a requested item; its sys_id is sent."}
   * @paramDef {"type":"String","label":"Short Description","name":"shortDescription","description":"New one-line summary.","uiComponent":{"type":"SINGLE_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"New full detail.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Catalog Item","name":"catItem","dictionary":"listCatalogItems","description":"New catalog item. Pick an item; the sys_id is sent."}
   * @paramDef {"type":"String","label":"Requested For","name":"requestedFor","dictionary":"pickUser","description":"New beneficiary. Pick a user; the sys_id is sent."}
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","description":"New quantity.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"String","label":"State","name":"state","description":"New lifecycle state.","uiComponent":{"type":"DROPDOWN","options":{"values":["Pending Approval","Approved","Closed Complete","Closed Incomplete","Closed Skipped"]}}}
   * @paramDef {"type":"String","label":"Assigned To","name":"assignedTo","dictionary":"pickUser","description":"New fulfiller. Pick a user; the sys_id is sent."}
   *
   * @returns {Object}
   * @sampleResult {"result":{"number":"RITM0050001","sys_id":"j1k2l3","state":"2"}}
   */
  async updateRequestedItem(sysId, shortDescription, description, catItem, requestedFor, quantity, state, assignedTo) {
    if (!sysId) throw new Error('Requested Item sys_id is required. Get it from List Requested Items or Create Requested Item.')

    const body = this.#compact({
      short_description: shortDescription,
      description,
      cat_item: catItem,
      requested_for: requestedFor,
      quantity: quantity == null ? undefined : String(quantity),
      state: this.#resolveChoice(state, REQ_ITEM_STATE),
      assigned_to: assignedTo,
    })

    // docs: https://docs.servicenow.com/bundle/xanadu-api-reference/page/integrate/inbound-rest/concept/c_TableAPI.html#title_table-PUT
    return await this.#apiRequest({ method: 'patch', table: TABLE_RITM, sysId, body, logTag: 'updateRequestedItem' })
  }

  /**
   * @operationName Delete Requested Item
   * @category Requested Items
   * @description Delete a requested item by sys_id. Permanent — the record cannot be recovered.
   * @route POST /deleteRequestedItem
   *
   * @paramDef {"type":"String","label":"Requested Item","name":"sysId","required":true,"dictionary":"pickRequestedItem","description":"The requested item to delete. Pick a requested item; its sys_id is sent."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"sys_id":"j1k2l3"}
   */
  async deleteRequestedItem(sysId) {
    return await this.#deleteRecord(TABLE_RITM, sysId, 'deleteRequestedItem')
  }

  /* ── User (sys_user) ──────────────────────────────────────────────────────── */

  /**
   * @operationName Get User
   * @category Users
   * @description Fetch one user (sys_user) by sys_id. Use to resolve a person record for assignment or requestor lookups. Feed the sys_id from List Users.
   * @route POST /getUser
   *
   * @paramDef {"type":"String","label":"User","name":"sysId","required":true,"dictionary":"pickUser","description":"The user to act on. Pick a user; their sys_id is sent."}
   * @paramDef {"type":"String","label":"Value Format","name":"displayValues","description":"Whether field values come back as raw codes, human labels, or both.","defaultValue":"Display labels","uiComponent":{"type":"DROPDOWN","options":{"values":["Raw values","Display labels","Both"]}}}
   * @paramDef {"type":"Array<String>","label":"Return Fields","name":"fields","description":"Restrict the response to these columns. Accepts an array or a comma-separated string."}
   *
   * @returns {Object}
   * @sampleResult {"result":{"sys_id":"m4n5o6","user_name":"abel.tuter","first_name":"Abel","last_name":"Tuter","email":"abel.tuter@example.com","active":"true"}}
   */
  async getUser(sysId, displayValues, fields) {
    return await this.#getRecord(TABLE_USER, sysId, displayValues, fields, 'getUser')
  }

  /**
   * @operationName List Users
   * @category Users
   * @description List or search users (sys_user). Filter with a ServiceNow encoded query (e.g. active=true^emailLIKEacme.com) and page with limit/offset.
   * @route POST /listUsers
   *
   * @paramDef {"type":"String","label":"Filter (encoded query)","name":"query","description":"ServiceNow encoded query, e.g. active=true^emailLIKEacme.com. Leave blank to list all.","uiComponent":{"type":"SINGLE_LINE_TEXT"}}
   * @paramDef {"type":"Number","label":"Page Size","name":"limit","description":"Maximum records to return (default 50).","defaultValue":50,"uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","description":"Records to skip for pagination (default 0). Use next_offset from a prior page.","defaultValue":0,"uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"String","label":"Value Format","name":"displayValues","description":"Whether field values come back as raw codes, human labels, or both.","defaultValue":"Display labels","uiComponent":{"type":"DROPDOWN","options":{"values":["Raw values","Display labels","Both"]}}}
   * @paramDef {"type":"Array<String>","label":"Return Fields","name":"fields","description":"Restrict the response to these columns. Accepts an array or a comma-separated string."}
   *
   * @returns {Object}
   * @sampleResult {"result":[{"sys_id":"m4n5o6","user_name":"abel.tuter","first_name":"Abel","last_name":"Tuter","email":"abel.tuter@example.com","active":"true"}],"next_offset":50}
   */
  async listUsers(query, limit, offset, displayValues, fields) {
    return await this.#listRecords(TABLE_USER, query, limit, offset, displayValues, fields, 'listUsers')
  }

  /**
   * @operationName Create User
   * @category Users
   * @description Create a user (sys_user) record (requires user admin rights on the connected account). Returns the new user sys_id.
   * @route POST /createUser
   *
   * @paramDef {"type":"String","label":"User Name","name":"userName","required":true,"description":"The login id (must be unique).","uiComponent":{"type":"SINGLE_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"Given name.","uiComponent":{"type":"SINGLE_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Family name.","uiComponent":{"type":"SINGLE_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Email address.","uiComponent":{"type":"SINGLE_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Business phone number.","uiComponent":{"type":"SINGLE_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Mobile Phone","name":"mobilePhone","description":"Mobile phone number.","uiComponent":{"type":"SINGLE_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Job title.","uiComponent":{"type":"SINGLE_LINE_TEXT"}}
   * @paramDef {"type":"Boolean","label":"Active","name":"active","description":"Whether the account is enabled.","uiComponent":{"type":"TOGGLE"}}
   *
   * @returns {Object}
   * @sampleResult {"result":{"sys_id":"m4n5o6","user_name":"abel.tuter","first_name":"Abel","last_name":"Tuter","active":"true"}}
   */
  async createUser(userName, firstName, lastName, email, phone, mobilePhone, title, active) {
    if (!userName) throw new Error('User Name is required to create a user.')

    const body = this.#compact({
      user_name: userName,
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      mobile_phone: mobilePhone,
      title,
      active: active == null ? undefined : String(active),
    })

    // docs: https://docs.servicenow.com/bundle/xanadu-api-reference/page/integrate/inbound-rest/concept/c_TableAPI.html#title_table-POST
    return await this.#apiRequest({ method: 'post', table: TABLE_USER, body, logTag: 'createUser' })
  }

  /**
   * @operationName Update User
   * @category Users
   * @description Update a user (sys_user) record by sys_id (PATCH — only the fields you set are changed; requires user admin rights on the connected account).
   * @route POST /updateUser
   *
   * @paramDef {"type":"String","label":"User","name":"sysId","required":true,"dictionary":"pickUser","description":"The user to update. Pick a user; their sys_id is sent."}
   * @paramDef {"type":"String","label":"User Name","name":"userName","description":"New login id.","uiComponent":{"type":"SINGLE_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"New given name.","uiComponent":{"type":"SINGLE_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"New family name.","uiComponent":{"type":"SINGLE_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New email address.","uiComponent":{"type":"SINGLE_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"New business phone number.","uiComponent":{"type":"SINGLE_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Mobile Phone","name":"mobilePhone","description":"New mobile phone number.","uiComponent":{"type":"SINGLE_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New job title.","uiComponent":{"type":"SINGLE_LINE_TEXT"}}
   * @paramDef {"type":"Boolean","label":"Active","name":"active","description":"Whether the account is enabled.","uiComponent":{"type":"TOGGLE"}}
   *
   * @returns {Object}
   * @sampleResult {"result":{"sys_id":"m4n5o6","user_name":"abel.tuter","active":"false"}}
   */
  async updateUser(sysId, userName, firstName, lastName, email, phone, mobilePhone, title, active) {
    if (!sysId) throw new Error('User sys_id is required. Get it from List Users.')

    const body = this.#compact({
      user_name: userName,
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      mobile_phone: mobilePhone,
      title,
      active: active == null ? undefined : String(active),
    })

    // docs: https://docs.servicenow.com/bundle/xanadu-api-reference/page/integrate/inbound-rest/concept/c_TableAPI.html#title_table-PUT
    return await this.#apiRequest({ method: 'patch', table: TABLE_USER, sysId, body, logTag: 'updateUser' })
  }

  /**
   * @operationName Delete User
   * @category Users
   * @description Delete a user (sys_user) record by sys_id (requires user admin rights on the connected account). Permanent — the record cannot be recovered.
   * @route POST /deleteUser
   *
   * @paramDef {"type":"String","label":"User","name":"sysId","required":true,"dictionary":"pickUser","description":"The user to delete. Pick a user; their sys_id is sent."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"sys_id":"m4n5o6"}
   */
  async deleteUser(sysId) {
    return await this.#deleteRecord(TABLE_USER, sysId, 'deleteUser')
  }

  /* ── Generic Table Record (escape hatch) ──────────────────────────────────── */

  /**
   * @operationName Create Table Record
   * @category Generic Table
   * @description Create a record in any ServiceNow table not covered by the named actions (the Table API escape hatch). Pick the table, then fill the field values; returns the created record including its sys_id.
   * @route POST /createTableRecord
   *
   * @paramDef {"type":"String","label":"Table","name":"tableName","required":true,"dictionary":"listTables","description":"The ServiceNow table to write to (e.g. incident, sc_task, cmdb_ci)."}
   * @paramDef {"type":"Object","label":"Field Values","name":"fieldsData","required":true,"schemaLoader":"tableRecordSchema","dependsOn":["tableName"],"description":"Column-to-value map for the new record. The fields shown are loaded from the chosen table's schema."}
   *
   * @returns {Object}
   * @sampleResult {"result":{"sys_id":"p7q8r9","number":"INC0010003"}}
   */
  async createTableRecord(tableName, fieldsData) {
    if (!tableName) throw new Error('Table is required. Pick a table from the dropdown.')

    // docs: https://docs.servicenow.com/bundle/xanadu-api-reference/page/integrate/inbound-rest/concept/c_TableAPI.html#title_table-POST
    return await this.#apiRequest({ method: 'post', table: tableName, body: this.#compact(fieldsData || {}), logTag: 'createTableRecord' })
  }

  /**
   * @operationName Get Table Record
   * @category Generic Table
   * @description Fetch one record from any ServiceNow table by sys_id (the Table API escape hatch). Feed the sys_id from List Table Records.
   * @route POST /getTableRecord
   *
   * @paramDef {"type":"String","label":"Table","name":"tableName","required":true,"dictionary":"listTables","description":"The ServiceNow table to read from."}
   * @paramDef {"type":"String","label":"Record","name":"sysId","required":true,"dictionary":"pickTableRecord","dependsOn":["tableName"],"description":"The record to act on. Pick a record from the chosen table; its sys_id is sent."}
   * @paramDef {"type":"String","label":"Value Format","name":"displayValues","description":"Whether field values come back as raw codes, human labels, or both.","defaultValue":"Display labels","uiComponent":{"type":"DROPDOWN","options":{"values":["Raw values","Display labels","Both"]}}}
   * @paramDef {"type":"Array<String>","label":"Return Fields","name":"fields","description":"Restrict the response to these columns. Accepts an array or a comma-separated string."}
   *
   * @returns {Object}
   * @sampleResult {"result":{"sys_id":"p7q8r9","number":"INC0010003"}}
   */
  async getTableRecord(tableName, sysId, displayValues, fields) {
    if (!tableName) throw new Error('Table is required. Pick a table from the dropdown.')

    return await this.#getRecord(tableName, sysId, displayValues, fields, 'getTableRecord')
  }

  /**
   * @operationName List Table Records
   * @category Generic Table
   * @description List or search records in any ServiceNow table (the Table API escape hatch). Filter with a ServiceNow encoded query and page with limit/offset.
   * @route POST /listTableRecords
   *
   * @paramDef {"type":"String","label":"Table","name":"tableName","required":true,"dictionary":"listTables","description":"The ServiceNow table to read from."}
   * @paramDef {"type":"String","label":"Filter (encoded query)","name":"query","description":"ServiceNow encoded query, e.g. active=true. Leave blank to list all.","uiComponent":{"type":"SINGLE_LINE_TEXT"}}
   * @paramDef {"type":"Number","label":"Page Size","name":"limit","description":"Maximum records to return (default 50).","defaultValue":50,"uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","description":"Records to skip for pagination (default 0). Use next_offset from a prior page.","defaultValue":0,"uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"String","label":"Value Format","name":"displayValues","description":"Whether field values come back as raw codes, human labels, or both.","defaultValue":"Display labels","uiComponent":{"type":"DROPDOWN","options":{"values":["Raw values","Display labels","Both"]}}}
   * @paramDef {"type":"Array<String>","label":"Return Fields","name":"fields","description":"Restrict the response to these columns. Accepts an array or a comma-separated string."}
   *
   * @returns {Object}
   * @sampleResult {"result":[{"sys_id":"p7q8r9","number":"INC0010003"}],"next_offset":50}
   */
  async listTableRecords(tableName, query, limit, offset, displayValues, fields) {
    if (!tableName) throw new Error('Table is required. Pick a table from the dropdown.')

    return await this.#listRecords(tableName, query, limit, offset, displayValues, fields, 'listTableRecords')
  }

  /**
   * @operationName Update Table Record
   * @category Generic Table
   * @description Update a record in any ServiceNow table by sys_id (PATCH — only the fields you set are changed; the Table API escape hatch). Feed the sys_id from List Table Records.
   * @route POST /updateTableRecord
   *
   * @paramDef {"type":"String","label":"Table","name":"tableName","required":true,"dictionary":"listTables","description":"The ServiceNow table to write to."}
   * @paramDef {"type":"String","label":"Record","name":"sysId","required":true,"dictionary":"pickTableRecord","dependsOn":["tableName"],"description":"The record to update. Pick a record from the chosen table; its sys_id is sent."}
   * @paramDef {"type":"Object","label":"Field Values","name":"fieldsData","required":true,"schemaLoader":"tableRecordSchema","dependsOn":["tableName"],"description":"Column-to-value map of the fields to change. The fields shown are loaded from the chosen table's schema."}
   *
   * @returns {Object}
   * @sampleResult {"result":{"sys_id":"p7q8r9","number":"INC0010003","state":"2"}}
   */
  async updateTableRecord(tableName, sysId, fieldsData) {
    if (!tableName) throw new Error('Table is required. Pick a table from the dropdown.')
    if (!sysId) throw new Error('Record sys_id is required. Get it from List Table Records.')

    // docs: https://docs.servicenow.com/bundle/xanadu-api-reference/page/integrate/inbound-rest/concept/c_TableAPI.html#title_table-PUT
    return await this.#apiRequest({ method: 'patch', table: tableName, sysId, body: this.#compact(fieldsData || {}), logTag: 'updateTableRecord' })
  }

  /**
   * @operationName Delete Table Record
   * @category Generic Table
   * @description Delete a record from any ServiceNow table by sys_id (the Table API escape hatch). Permanent — the record cannot be recovered.
   * @route POST /deleteTableRecord
   *
   * @paramDef {"type":"String","label":"Table","name":"tableName","required":true,"dictionary":"listTables","description":"The ServiceNow table to delete from."}
   * @paramDef {"type":"String","label":"Record","name":"sysId","required":true,"dictionary":"pickTableRecord","dependsOn":["tableName"],"description":"The record to delete. Pick a record from the chosen table; its sys_id is sent."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"sys_id":"p7q8r9"}
   */
  async deleteTableRecord(tableName, sysId) {
    if (!tableName) throw new Error('Table is required. Pick a table from the dropdown.')

    return await this.#deleteRecord(tableName, sysId, 'deleteTableRecord')
  }

  /* ── Schema loader for the generic Field Values object ─────────────────────── */

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /tableRecordSchema
   * @paramDef {"type":"String","name":"tableName","required":true}
   * @returns {Object}
   */
  async tableRecordSchema(payload) {
    const tableName = payload?.criteria?.tableName
    if (!tableName) return null

    // sys_dictionary is itself a Table API table; read the chosen table's writable columns.
    // docs: https://docs.servicenow.com/bundle/xanadu-api-reference/page/integrate/inbound-rest/concept/c_TableAPI.html#title_table-GET
    const response = await this.#apiRequest({
      method: 'get',
      table: TABLE_DICTIONARY,
      query: {
        sysparm_query: `name=${ tableName }^active=true^elementISNOTEMPTY`,
        sysparm_fields: 'element,column_label,internal_type,mandatory,read_only',
        sysparm_limit: 200,
      },
      logTag: 'tableRecordSchema',
    })

    const columns = Array.isArray(response?.result) ? response.result : []

    return columns
      .filter(col => col.element && this.#dictValue(col.read_only) !== 'true')
      .map(col => {
        const internalType = this.#dictValue(col.internal_type)

        return {
          type: internalType === 'integer' || internalType === 'decimal' || internalType === 'float' ? 'Number' : 'String',
          name: col.element,
          label: this.#dictValue(col.column_label) || col.element,
          required: this.#dictValue(col.mandatory) === 'true',
          description: `ServiceNow column "${ col.element }" (${ internalType || 'string' }).`,
        }
      })
  }

  /* ── Dictionaries ─────────────────────────────────────────────────────────── */

  /**
   * @registerAs DICTIONARY
   * @operationName Pick Table
   * @description Lists common ServiceNow tables (and matches against all tables by name) for choosing which table to read or write.
   * @route POST /listTables
   * @paramDef {"type":"listTables__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Incident","value":"incident","note":"incident"}],"cursor":null}
   */
  async listTables(payload) {
    const { search, cursor } = payload || {}
    const term = (search || '').trim().toLowerCase()

    const curated = CURATED_TABLES.filter(t => !term || t.name.includes(term) || t.label.toLowerCase().includes(term))

    let live = []

    if (term) {
      const response = await this.#apiRequest({
        method: 'get',
        table: TABLE_DB_OBJECT,
        query: {
          sysparm_query: `nameLIKE${ search }^ORlabelLIKE${ search }`,
          sysparm_fields: 'name,label',
          sysparm_limit: DEFAULT_LIMIT,
        },
        logTag: 'listTables',
      })
      live = Array.isArray(response?.result) ? response.result : []
    }

    const seen = new Set(curated.map(t => t.name))
    const merged = [...curated]

    for (const row of live) {
      if (row.name && !seen.has(row.name)) {
        seen.add(row.name)
        merged.push({ name: row.name, label: row.label || row.name })
      }
    }

    return {
      items: merged.map(t => ({ label: t.label, value: t.name, note: t.name })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Pick User
   * @description Searches active users (sys_user) by name or email for assignment, caller, or requestor fields. Returns the user sys_id as the value.
   * @route POST /pickUser
   * @paramDef {"type":"pickUser__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Abel Tuter","value":"m4n5o6","note":"abel.tuter@example.com"}],"cursor":null}
   */
  async pickUser(payload) {
    const { search } = payload || {}
    const term = (search || '').trim()
    const filter = term ? `nameLIKE${ term }^ORemailLIKE${ term }^active=true` : 'active=true'

    const response = await this.#apiRequest({
      method: 'get',
      table: TABLE_USER,
      query: { sysparm_query: filter, sysparm_fields: 'sys_id,name,email', sysparm_limit: DEFAULT_LIMIT },
      logTag: 'pickUser',
    })

    const rows = Array.isArray(response?.result) ? response.result : []

    return {
      items: rows.map(u => ({ label: u.name || u.sys_id, value: u.sys_id, note: u.email || null })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Pick Group
   * @description Searches active assignment groups (sys_user_group) by name. Returns the group sys_id as the value.
   * @route POST /listUserGroups
   * @paramDef {"type":"listUserGroups__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Service Desk","value":"s1t2u3","note":null}],"cursor":null}
   */
  async listUserGroups(payload) {
    const { search } = payload || {}
    const term = (search || '').trim()
    const filter = term ? `nameLIKE${ term }^active=true` : 'active=true'

    const response = await this.#apiRequest({
      method: 'get',
      table: TABLE_USER_GROUP,
      query: { sysparm_query: filter, sysparm_fields: 'sys_id,name', sysparm_limit: DEFAULT_LIMIT },
      logTag: 'listUserGroups',
    })

    const rows = Array.isArray(response?.result) ? response.result : []

    return {
      items: rows.map(g => ({ label: g.name || g.sys_id, value: g.sys_id, note: null })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Pick Catalog Item
   * @description Searches active service catalog items (sc_cat_item) by name. Returns the catalog item sys_id as the value.
   * @route POST /listCatalogItems
   * @paramDef {"type":"listCatalogItems__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Standard Laptop","value":"c1d2e3","note":"Request a standard laptop"}],"cursor":null}
   */
  async listCatalogItems(payload) {
    const { search } = payload || {}
    const term = (search || '').trim()
    const filter = term ? `nameLIKE${ term }^active=true` : 'active=true'

    const response = await this.#apiRequest({
      method: 'get',
      table: TABLE_CAT_ITEM,
      query: { sysparm_query: filter, sysparm_fields: 'sys_id,name,short_description', sysparm_limit: DEFAULT_LIMIT },
      logTag: 'listCatalogItems',
    })

    const rows = Array.isArray(response?.result) ? response.result : []

    return {
      items: rows.map(c => ({ label: c.name || c.sys_id, value: c.sys_id, note: c.short_description || null })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Pick Incident
   * @description Searches incidents by number or short description so users select a record instead of pasting a sys_id. Returns the incident sys_id as the value.
   * @route POST /pickIncident
   * @paramDef {"type":"pickIncident__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"INC0000060 — Unable to connect to email","value":"a1b2c3","note":"Unable to connect to email"}],"cursor":null}
   */
  async pickIncident(payload) {
    return await this.#pickRecord(TABLE_INCIDENT, payload, 'pickIncident')
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Pick Change Request
   * @description Searches change requests by number or short description so users select a record instead of pasting a sys_id. Returns the change request sys_id as the value.
   * @route POST /pickChangeRequest
   * @paramDef {"type":"pickChangeRequest__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"CHG0030001 — Upgrade database","value":"d4e5f6","note":"Upgrade database"}],"cursor":null}
   */
  async pickChangeRequest(payload) {
    return await this.#pickRecord(TABLE_CHANGE, payload, 'pickChangeRequest')
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Pick Problem
   * @description Searches problems by number or short description so users select a record instead of pasting a sys_id. Returns the problem sys_id as the value.
   * @route POST /pickProblem
   * @paramDef {"type":"pickProblem__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"PRB0040001 — Recurring email outage","value":"g7h8i9","note":"Recurring email outage"}],"cursor":null}
   */
  async pickProblem(payload) {
    return await this.#pickRecord(TABLE_PROBLEM, payload, 'pickProblem')
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Pick Requested Item
   * @description Searches requested items by number or short description so users select a record instead of pasting a sys_id. Returns the requested item sys_id as the value.
   * @route POST /pickRequestedItem
   * @paramDef {"type":"pickRequestedItem__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"RITM0050001 — Standard Laptop","value":"j1k2l3","note":"Standard Laptop"}],"cursor":null}
   */
  async pickRequestedItem(payload) {
    return await this.#pickRecord(TABLE_RITM, payload, 'pickRequestedItem')
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Pick Table Record
   * @description Searches records in the chosen table by number, name, or short description so users select a record instead of pasting a sys_id. Returns the record sys_id as the value.
   * @route POST /pickTableRecord
   * @paramDef {"type":"pickTableRecord__payload","label":"Payload","name":"payload","description":"Optional search text, pagination cursor, and the chosen table under criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"INC0010003","value":"p7q8r9","note":"Harness generic record"}],"cursor":null}
   */
  async pickTableRecord(payload) {
    const tableName = payload?.criteria?.tableName
    if (!tableName) return { items: [], cursor: null }

    return await this.#pickRecord(tableName, payload, 'pickTableRecord')
  }

  /* ── Shared CRUD helpers ──────────────────────────────────────────────────── */

  // Record picker shared by every per-resource sys_id dictionary. Lists records of a table,
  // labelling each by its number + short_description (falling back to name/sys_id) and
  // returning the sys_id as the dropdown value.
  async #pickRecord(table, payload, logTag) {
    const term = (payload?.search || '').trim()
    const filter = term ? `numberLIKE${ term }^ORshort_descriptionLIKE${ term }^ORnameLIKE${ term }` : ''

    const query = { sysparm_fields: 'sys_id,number,name,short_description', sysparm_limit: DEFAULT_LIMIT }
    if (filter) query.sysparm_query = filter

    const response = await this.#apiRequest({ method: 'get', table, query, logTag })
    const rows = Array.isArray(response?.result) ? response.result : []

    return {
      items: rows.map(row => {
        const number = this.#dictValue(row.number)
        const short = this.#dictValue(row.short_description)
        const name = this.#dictValue(row.name)
        const sysId = this.#dictValue(row.sys_id)
        const headline = number || name || sysId
        const label = number && short ? `${ number } — ${ short }` : headline

        return { label, value: sysId, note: short || name || null }
      }),
      cursor: null,
    }
  }

  /* ── Core CRUD helpers ────────────────────────────────────────────────────── */

  async #getRecord(table, sysId, displayValues, fields, logTag) {
    if (!sysId) throw new Error('sys_id is required. Get it from the matching List action.')

    // docs: https://docs.servicenow.com/bundle/xanadu-api-reference/page/integrate/inbound-rest/concept/c_TableAPI.html#title_table-GET-id
    return await this.#apiRequest({
      method: 'get',
      table,
      sysId,
      query: this.#shapingQuery(displayValues, fields),
      logTag,
    })
  }

  async #listRecords(table, query, limit, offset, displayValues, fields, logTag) {
    const pageSize = Number.isFinite(Number(limit)) && limit != null ? Number(limit) : DEFAULT_LIMIT
    const start = Number.isFinite(Number(offset)) && offset != null ? Number(offset) : 0

    const q = {
      sysparm_limit: pageSize,
      sysparm_offset: start,
      ...this.#shapingQuery(displayValues, fields),
    }
    if (query) q.sysparm_query = query

    // docs: https://docs.servicenow.com/bundle/xanadu-api-reference/page/integrate/inbound-rest/concept/c_TableAPI.html#title_table-GET
    const response = await this.#apiRequest({ method: 'get', table, query: q, logTag })

    const rows = Array.isArray(response?.result) ? response.result : []

    return { ...response, next_offset: rows.length < pageSize ? null : start + pageSize }
  }

  async #deleteRecord(table, sysId, logTag) {
    if (!sysId) throw new Error('sys_id is required. Get it from the matching List action.')

    // docs: https://docs.servicenow.com/bundle/xanadu-api-reference/page/integrate/inbound-rest/concept/c_TableAPI.html#title_table-DELETE
    await this.#apiRequest({ method: 'delete', table, sysId, logTag })

    return { deleted: true, sys_id: sysId }
  }

  #shapingQuery(displayValues, fields) {
    const q = { sysparm_display_value: this.#resolveChoice(displayValues, DISPLAY_VALUES) || 'true' }
    const fieldList = Array.isArray(fields)
      ? fields.join(',')
      : typeof fields === 'string'
        ? fields
        : ''
    if (fieldList.trim()) q.sysparm_fields = fieldList.trim()

    return q
  }

  /* ── Core request factory ─────────────────────────────────────────────────── */

  async #apiRequest({ method, table, sysId, body, query, logTag }) {
    const accessToken = this.#getAccessToken()
    const base = this.#instanceUrl()
    const url = sysId
      ? `${ base }/api/now/table/${ encodeURIComponent(table) }/${ encodeURIComponent(sysId) }`
      : `${ base }/api/now/table/${ encodeURIComponent(table) }`

    const headers = { Authorization: `Bearer ${ accessToken }`, Accept: 'application/json' }
    if (body) headers['Content-Type'] = 'application/json'

    logger.debug(`[${ logTag }] ${ method.toUpperCase() } ${ url }`)

    try {
      const request = Flowrunner.Request[method](url).set(headers)
      if (query && Object.keys(query).length) request.query(query)
      if (body) return await request.send(body)

      return await request
    } catch (error) {
      throw this.#friendlyError(error, table, logTag)
    }
  }

  #friendlyError(error, table, logTag) {
    const status = error?.status || error?.body?.status || error?.code
    const apiMsg =
      error?.body?.error?.message ||
      error?.body?.error?.detail ||
      error?.message ||
      'Request failed.'
    const hint = ERROR_HINTS[status]
    const message = hint ? `${ hint.replace('that table', `table '${ table }'`) } (${ apiMsg })` : `ServiceNow request failed: ${ apiMsg }`
    logger.error(`[${ logTag }] ${ message }`)

    return new Error(message)
  }

  /* ── Internal utilities ───────────────────────────────────────────────────── */

  #instanceUrl() {
    const raw = this.instanceUrl

    if (!raw) {
      throw new Error('Set the Instance URL in the service config (e.g. https://dev12345.service-now.com).')
    }

    return String(raw).trim().replace(/\/+$/, '')
  }

  #getAccessToken() {
    return this.request?.context?.accessToken || this.request?.headers?.['oauth-access-token'] || process.env.SERVICENOW_ACCESS_TOKEN
  }

  async #fetchIdentity(accessToken) {
    try {
      const url = `${ this.#instanceUrl() }/api/now/table/sys_user?sysparm_query=user_name=javascript:gs.getUserName()&sysparm_fields=name&sysparm_limit=1`
      const response = await Flowrunner.Request.get(url)
        .set({ Authorization: `Bearer ${ accessToken }`, Accept: 'application/json' })
      const rows = Array.isArray(response?.result) ? response.result : []

      return { name: rows[0]?.name || null }
    } catch (error) {
      logger.warn(`Could not resolve connection identity: ${ error.message }`)

      return { name: null }
    }
  }

  // sys_dictionary fields may arrive as raw strings or {display_value,value} objects.
  #dictValue(field) {
    if (field && typeof field === 'object') return field.value != null ? String(field.value) : ''

    return field == null ? '' : String(field)
  }

  // Drop null/undefined/empty-string entries so PATCH only sends supplied columns.
  #compact(obj) {
    const out = {}

    for (const [key, value] of Object.entries(obj || {})) {
      if (value !== undefined && value !== null && value !== '') out[key] = value
    }

    return out
  }
}

Flowrunner.ServerCode.addService(ServiceNow, [
  {
    name: 'clientId',
    displayName: 'Client Id',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The OAuth Client ID from your ServiceNow OAuth application registry entry.',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The OAuth Client Secret from your ServiceNow OAuth application registry entry.',
  },
  {
    name: 'instanceUrl',
    displayName: 'Instance URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your ServiceNow instance base URL, e.g. https://dev12345.service-now.com (no trailing slash).',
  },
])
