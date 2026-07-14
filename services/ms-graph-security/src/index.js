const OAUTH_BASE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0'
const API_BASE_URL = `${ GRAPH_BASE_URL }/security`

const DEFAULT_PAGE_SIZE = 50

const DEFAULT_SCOPE_LIST = [
  'openid',
  'offline_access',
  'SecurityEvents.ReadWrite.All',
  'SecurityIncident.ReadWrite.All',
  'SecurityAlert.ReadWrite.All',
  'ThreatIndicators.ReadWrite.OwnedBy',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const ALERT_STATUS_MAP = {
  'New': 'new',
  'In Progress': 'inProgress',
  'Resolved': 'resolved',
}

const INCIDENT_STATUS_MAP = {
  'Active': 'active',
  'Resolved': 'resolved',
  'Redirected': 'redirected',
}

const CLASSIFICATION_MAP = {
  'Unknown': 'unknown',
  'True Positive': 'truePositive',
  'False Positive': 'falsePositive',
  'Informational Expected Activity': 'informationalExpectedActivity',
}

const DETERMINATION_MAP = {
  'Unknown': 'unknown',
  'Advanced Persistent Threat (APT)': 'apt',
  'Malware': 'malware',
  'Security Personnel': 'securityPersonnel',
  'Security Testing': 'securityTesting',
  'Unwanted Software': 'unwantedSoftware',
  'Multi-Staged Attack': 'multiStagedAttack',
  'Compromised Account': 'compromisedAccount',
  'Phishing': 'phishing',
  'Malicious User Activity': 'maliciousUserActivity',
  'Not Malicious': 'notMalicious',
  'Not Enough Data to Validate': 'notEnoughDataToValidate',
  'Confirmed User Activity': 'confirmedUserActivity',
  'Line of Business Application': 'lineOfBusinessApplication',
  'Other': 'other',
}

const TI_ACTION_MAP = {
  'Alert': 'alert',
  'Allow': 'allow',
  'Block': 'block',
  'Unknown': 'unknown',
}

const TI_TLP_MAP = {
  'White': 'white',
  'Green': 'green',
  'Amber': 'amber',
  'Red': 'red',
}

const logger = {
  info: (...args) => console.log('[Microsoft Graph Security] info:', ...args),
  debug: (...args) => console.log('[Microsoft Graph Security] debug:', ...args),
  error: (...args) => console.log('[Microsoft Graph Security] error:', ...args),
  warn: (...args) => console.log('[Microsoft Graph Security] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName Microsoft Graph Security
 * @integrationIcon /icon.svg
 **/
class MicrosoftGraphSecurityService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  #getAccessTokenHeader(extraHeaders) {
    return {
      Authorization: `Bearer ${ this.request.headers['oauth-access-token'] }`,
      ...(extraHeaders || {}),
    }
  }

  async #apiRequest({ url, method, body, query, headers, logTag }) {
    method = method || 'get'
    query = cleanupObject(query)

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      const request = Flowrunner.Request[method](url)
        .set(this.#getAccessTokenHeader(headers))
        .query(query)

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const graphError = error.body?.error
      const message = graphError?.message || error.message
      const code = graphError?.code ? `${ graphError.code }: ` : ''

      logger.error(`${ logTag } - error [${ error.status || error.statusCode || '' }]: ${ code }${ message }`)

      throw new Error(`Microsoft Graph Security API error: ${ code }${ message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()
    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('scope', this.scopes)
    params.append('response_mode', 'query')

    return `${ OAUTH_BASE_URL }/authorize?${ params.toString() }`
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   * @property {String} token
   * @property {String} refreshToken
   * @property {Number} expirationInSeconds
   * @property {Object} userData
   * @property {String} connectionIdentityName
   * @property {Boolean} overwrite
   */

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    const code = callbackObject.code
    const url = `${ OAUTH_BASE_URL }/token`

    const params = new URLSearchParams()
    params.append('client_id', this.clientId)
    params.append('code', code)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('grant_type', 'authorization_code')
    params.append('client_secret', this.clientSecret)

    const response = await Flowrunner.Request.post(url)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    let userData = {}

    try {
      userData = await Flowrunner.Request.get(`${ GRAPH_BASE_URL }/me`).set({
        Authorization: `Bearer ${ response.access_token }`,
        'Content-Type': 'application/json',
      })

      logger.debug(`[executeCallback] userData response: ${ JSON.stringify(userData, null, 2) }`)
    } catch (error) {
      logger.error(`[executeCallback] getUserProfile error: ${ error.message }`)
    }

    return {
      token: response.access_token,
      refreshToken: response.refresh_token,
      expirationInSeconds: response.expires_in,
      connectionIdentityName: constructIdentityName(userData),
      overwrite: true,
      userData: userData,
    }
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   * @property {String} token
   * @property {Number} expirationInSeconds
   * @property {String} refreshToken
   */

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    const url = `${ OAUTH_BASE_URL }/token`

    const params = new URLSearchParams()
    params.append('client_id', this.clientId)
    params.append('scope', this.scopes)
    params.append('refresh_token', refreshToken)
    params.append('grant_type', 'refresh_token')
    params.append('client_secret', this.clientSecret)

    try {
      const response = await Flowrunner.Request.post(url)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      return {
        token: response.access_token,
        refreshToken: response.refresh_token,
        expirationInSeconds: response.expires_in,
      }
    } catch (error) {
      logger.error('Error refreshing token: ', error.message || error)
      throw error
    }
  }

  /**
   * @operationName List Alerts
   * @category Alerts
   * @appearanceColor #0F6CBD #004578
   * @description Retrieves security alerts from the modern alerts_v2 collection, which tracks suspicious activities detected across Microsoft Defender and Microsoft Sentinel. Supports OData filtering, sorting, and result limiting. The filterable properties include status, severity, classification, determination, serviceSource, assignedTo, createdDateTime, and lastUpdateDateTime. Returns a paginated list; follow the @odata.nextLink value using the Next Page Link parameter to retrieve additional pages.
   * @route GET /list-alerts
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Optional OData $filter expression, for example: status eq 'new' or severity eq 'high' or serviceSource eq 'microsoftDefenderForEndpoint'."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","description":"Optional OData $orderby expression, for example: createdDateTime desc or severity asc."}
   * @paramDef {"type":"Number","label":"Max Results","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of alerts to return per page. Defaults to 50."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"The @odata.nextLink URL from a previous response used to retrieve the next page. When provided, all other parameters are ignored."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"da637551227677560813_-961444813","status":"new","severity":"low","classification":"unknown","determination":"unknown","serviceSource":"microsoftDefenderForEndpoint","title":"Suspicious execution of hidden file","incidentId":"28282","createdDateTime":"2021-04-27T12:19:27.7211305Z"}],"@odata.nextLink":"https://graph.microsoft.com/v1.0/security/alerts_v2?$skiptoken=..."}
   */
  async listAlerts(filter, orderBy, top, nextLink) {
    if (nextLink) {
      return this.#apiRequest({ url: nextLink, logTag: 'listAlerts' })
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/alerts_v2`,
      query: {
        $filter: filter,
        $orderby: orderBy,
        $top: top || DEFAULT_PAGE_SIZE,
      },
      logTag: 'listAlerts',
    })
  }

  /**
   * @operationName Get Alert
   * @category Alerts
   * @appearanceColor #0F6CBD #004578
   * @description Retrieves a single security alert from the alerts_v2 collection by its ID, including its status, severity, classification, determination, associated incident, and the full evidence collection (devices, files, processes, user accounts, and more).
   * @route GET /get-alert
   * @paramDef {"type":"String","label":"Alert ID","name":"alertId","required":true,"description":"The unique identifier of the alert to retrieve, for example: da637551227677560813_-961444813."}
   * @returns {Object}
   * @sampleResult {"id":"da637551227677560813_-961444813","status":"new","severity":"low","classification":"unknown","determination":"unknown","serviceSource":"microsoftDefenderForEndpoint","title":"Suspicious execution of hidden file","category":"DefenseEvasion","incidentId":"28282","assignedTo":null,"evidence":[]}
   */
  async getAlert(alertId) {
    if (!alertId) {
      throw new Error('Parameter "Alert ID" is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/alerts_v2/${ encodeURIComponent(alertId) }`,
      logTag: 'getAlert',
    })
  }

  /**
   * @operationName Update Alert
   * @category Alerts
   * @appearanceColor #0F6CBD #004578
   * @description Updates the triage fields of a security alert in the alerts_v2 collection, such as its status, assigned owner, classification, and determination. Only the fields you provide are changed. Returns the updated alert object.
   * @route PATCH /update-alert
   * @paramDef {"type":"String","label":"Alert ID","name":"alertId","required":true,"description":"The unique identifier of the alert to update."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["New","In Progress","Resolved"]}},"description":"The triage status of the alert. Leave unset to keep the current value."}
   * @paramDef {"type":"String","label":"Assigned To","name":"assignedTo","description":"The user principal name (email) of the owner to assign the alert to. Free text; leave unset to keep the current owner."}
   * @paramDef {"type":"String","label":"Classification","name":"classification","uiComponent":{"type":"DROPDOWN","options":{"values":["Unknown","True Positive","False Positive","Informational Expected Activity"]}},"description":"The classification of the alert. Leave unset to keep the current value."}
   * @paramDef {"type":"String","label":"Determination","name":"determination","uiComponent":{"type":"DROPDOWN","options":{"values":["Unknown","Advanced Persistent Threat (APT)","Malware","Security Personnel","Security Testing","Unwanted Software","Multi-Staged Attack","Compromised Account","Phishing","Malicious User Activity","Not Malicious","Not Enough Data to Validate","Confirmed User Activity","Line of Business Application","Other"]}},"description":"The determination of the alert that explains its verdict. Leave unset to keep the current value."}
   * @returns {Object}
   * @sampleResult {"id":"da637551227677560813_-961444813","status":"resolved","assignedTo":"secops@contoso.com","classification":"truePositive","determination":"malware","severity":"low"}
   */
  async updateAlert(alertId, status, assignedTo, classification, determination) {
    if (!alertId) {
      throw new Error('Parameter "Alert ID" is required')
    }

    const body = cleanupObject({
      status: this.#resolveChoice(status, ALERT_STATUS_MAP),
      assignedTo,
      classification: this.#resolveChoice(classification, CLASSIFICATION_MAP),
      determination: this.#resolveChoice(determination, DETERMINATION_MAP),
    })

    if (Object.keys(body).length === 0) {
      throw new Error('Provide at least one property to update')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/alerts_v2/${ encodeURIComponent(alertId) }`,
      method: 'patch',
      body,
      logTag: 'updateAlert',
    })
  }

  /**
   * @operationName List Legacy Alerts
   * @category Alerts
   * @appearanceColor #0F6CBD #004578
   * @description Retrieves security alerts from the legacy alerts collection (the original Microsoft Graph Security alert entity). Prefer List Alerts for current work; use this only when integrating with providers or workflows that still depend on the legacy schema. Returns a paginated list; follow the @odata.nextLink value using the Next Page Link parameter to retrieve additional pages.
   * @route GET /list-legacy-alerts
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Optional OData $filter expression, for example: severity eq 'high' or status eq 'newAlert'."}
   * @paramDef {"type":"Number","label":"Max Results","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of alerts to return per page. Defaults to 50."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"The @odata.nextLink URL from a previous response used to retrieve the next page. When provided, all other parameters are ignored."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"2517536653827919807_a3644bd8","title":"Suspicious PowerShell activity","severity":"medium","status":"newAlert","category":"Execution","createdDateTime":"2021-04-27T12:19:27Z"}],"@odata.nextLink":"https://graph.microsoft.com/v1.0/security/alerts?$skip=50"}
   */
  async listLegacyAlerts(filter, top, nextLink) {
    if (nextLink) {
      return this.#apiRequest({ url: nextLink, logTag: 'listLegacyAlerts' })
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/alerts`,
      query: {
        $filter: filter,
        $top: top || DEFAULT_PAGE_SIZE,
      },
      logTag: 'listLegacyAlerts',
    })
  }

  /**
   * @operationName List Incidents
   * @category Incidents
   * @appearanceColor #0F6CBD #004578
   * @description Retrieves security incidents, which correlate related alerts into a single case. Supports OData filtering and optionally expands the related alerts inline. The filterable properties include status, severity, assignedTo, classification, determination, and createdDateTime. Returns a paginated list; follow the @odata.nextLink value using the Next Page Link parameter to retrieve additional pages.
   * @route GET /list-incidents
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Optional OData $filter expression, for example: status eq 'active' or severity eq 'high'."}
   * @paramDef {"type":"Boolean","label":"Expand Alerts","name":"expandAlerts","uiComponent":{"type":"TOGGLE"},"description":"When enabled, includes the full collection of related alerts inline with each incident via $expand=alerts. Increases the response size."}
   * @paramDef {"type":"Number","label":"Max Results","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of incidents to return per page. Defaults to 50."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"The @odata.nextLink URL from a previous response used to retrieve the next page. When provided, all other parameters are ignored."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"29","displayName":"Multi-stage incident involving Execution & Command and control","status":"active","severity":"high","assignedTo":"admin@contoso.com","classification":"truePositive","determination":"multiStagedAttack","customTags":["Demo"],"createdDateTime":"2026-01-22T12:09:23Z"}],"@odata.nextLink":"https://graph.microsoft.com/v1.0/security/incidents?$skip=50"}
   */
  async listIncidents(filter, expandAlerts, top, nextLink) {
    if (nextLink) {
      return this.#apiRequest({ url: nextLink, logTag: 'listIncidents' })
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/incidents`,
      query: {
        $filter: filter,
        $expand: expandAlerts ? 'alerts' : undefined,
        $top: top || DEFAULT_PAGE_SIZE,
      },
      logTag: 'listIncidents',
    })
  }

  /**
   * @operationName Get Incident
   * @category Incidents
   * @appearanceColor #0F6CBD #004578
   * @description Retrieves a single security incident by its ID, including its status, severity, assignment, classification, determination, custom tags, and summary. Optionally expands the full collection of related alerts inline.
   * @route GET /get-incident
   * @paramDef {"type":"String","label":"Incident ID","name":"incidentId","required":true,"description":"The unique identifier of the incident to retrieve, for example: 29."}
   * @paramDef {"type":"Boolean","label":"Expand Alerts","name":"expandAlerts","uiComponent":{"type":"TOGGLE"},"description":"When enabled, includes the full collection of related alerts inline via $expand=alerts."}
   * @returns {Object}
   * @sampleResult {"id":"29","displayName":"Multi-stage incident involving Execution & Command and control","status":"active","severity":"high","assignedTo":"admin@contoso.com","classification":"truePositive","determination":"multiStagedAttack","customTags":["Demo"],"summary":"Defender Experts has identified malicious activity."}
   */
  async getIncident(incidentId, expandAlerts) {
    if (!incidentId) {
      throw new Error('Parameter "Incident ID" is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/incidents/${ encodeURIComponent(incidentId) }`,
      query: { $expand: expandAlerts ? 'alerts' : undefined },
      logTag: 'getIncident',
    })
  }

  /**
   * @operationName Update Incident
   * @category Incidents
   * @appearanceColor #0F6CBD #004578
   * @description Updates the triage fields of a security incident, such as its status, assigned owner, classification, determination, and custom tags. Only the fields you provide are changed. Custom tags replace the existing tag collection. Returns the updated incident object.
   * @route PATCH /update-incident
   * @paramDef {"type":"String","label":"Incident ID","name":"incidentId","required":true,"description":"The unique identifier of the incident to update."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Resolved","Redirected"]}},"description":"The status of the incident. Leave unset to keep the current value."}
   * @paramDef {"type":"String","label":"Assigned To","name":"assignedTo","description":"The user principal name (email) of the owner to assign the incident to. Free text; leave unset to keep the current owner."}
   * @paramDef {"type":"String","label":"Classification","name":"classification","uiComponent":{"type":"DROPDOWN","options":{"values":["Unknown","True Positive","False Positive","Informational Expected Activity"]}},"description":"The classification of the incident. Leave unset to keep the current value."}
   * @paramDef {"type":"String","label":"Determination","name":"determination","uiComponent":{"type":"DROPDOWN","options":{"values":["Unknown","Advanced Persistent Threat (APT)","Malware","Security Personnel","Security Testing","Unwanted Software","Multi-Staged Attack","Compromised Account","Phishing","Malicious User Activity","Not Malicious","Not Enough Data to Validate","Confirmed User Activity","Line of Business Application","Other"]}},"description":"The determination of the incident that explains its verdict. Leave unset to keep the current value."}
   * @paramDef {"type":"Array<String>","label":"Custom Tags","name":"customTags","description":"An array of custom tags to associate with the incident. This replaces the existing set of custom tags."}
   * @returns {Object}
   * @sampleResult {"id":"29","status":"active","assignedTo":"admin@contoso.com","classification":"truePositive","determination":"multiStagedAttack","customTags":["Demo"]}
   */
  async updateIncident(incidentId, status, assignedTo, classification, determination, customTags) {
    if (!incidentId) {
      throw new Error('Parameter "Incident ID" is required')
    }

    const body = cleanupObject({
      status: this.#resolveChoice(status, INCIDENT_STATUS_MAP),
      assignedTo,
      classification: this.#resolveChoice(classification, CLASSIFICATION_MAP),
      determination: this.#resolveChoice(determination, DETERMINATION_MAP),
      customTags: Array.isArray(customTags) && customTags.length ? customTags : undefined,
    })

    if (Object.keys(body).length === 0) {
      throw new Error('Provide at least one property to update')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/incidents/${ encodeURIComponent(incidentId) }`,
      method: 'patch',
      body,
      logTag: 'updateIncident',
    })
  }

  /**
   * @operationName List Secure Scores
   * @category Secure Score
   * @appearanceColor #0F6CBD #004578
   * @description Retrieves the tenant's Microsoft Secure Score history, where each entry represents a snapshot of the security posture on a given day, including the current score, maximum achievable score, and per-control breakdown. The most recent scores are returned first. Returns a paginated list; follow the @odata.nextLink value using the Next Page Link parameter to retrieve additional pages.
   * @route GET /list-secure-scores
   * @paramDef {"type":"Number","label":"Max Results","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of secure score snapshots to return per page. Defaults to 50."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"The @odata.nextLink URL from a previous response used to retrieve the next page. When provided, all other parameters are ignored."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"00000000-0000-0000-0000-000000000001_2021-01-01","azureTenantId":"00000000-0000-0000-0000-000000000001","currentScore":22.0,"maxScore":37.0,"createdDateTime":"2021-01-01T00:00:00Z","activeUserCount":88}],"@odata.nextLink":"https://graph.microsoft.com/v1.0/security/secureScores?$skiptoken=..."}
   */
  async listSecureScores(top, nextLink) {
    if (nextLink) {
      return this.#apiRequest({ url: nextLink, logTag: 'listSecureScores' })
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/secureScores`,
      query: { $top: top || DEFAULT_PAGE_SIZE },
      logTag: 'listSecureScores',
    })
  }

  /**
   * @operationName Get Secure Score
   * @category Secure Score
   * @appearanceColor #0F6CBD #004578
   * @description Retrieves a single Microsoft Secure Score snapshot by its ID, including the current and maximum score, comparative averages, enabled security services, and the full control-by-control score breakdown for that day.
   * @route GET /get-secure-score
   * @paramDef {"type":"String","label":"Secure Score ID","name":"secureScoreId","required":true,"description":"The unique identifier of the secure score snapshot, for example: 00000000-0000-0000-0000-000000000001_2021-01-01."}
   * @returns {Object}
   * @sampleResult {"id":"00000000-0000-0000-0000-000000000001_2021-01-01","currentScore":22.0,"maxScore":37.0,"createdDateTime":"2021-01-01T00:00:00Z","activeUserCount":88,"controlScores":[{"controlName":"AdminMFAV2","score":0.0,"controlCategory":"Identity"}]}
   */
  async getSecureScore(secureScoreId) {
    if (!secureScoreId) {
      throw new Error('Parameter "Secure Score ID" is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/secureScores/${ encodeURIComponent(secureScoreId) }`,
      logTag: 'getSecureScore',
    })
  }

  /**
   * @operationName List Secure Score Control Profiles
   * @category Secure Score
   * @appearanceColor #0F6CBD #004578
   * @description Retrieves the Secure Score control profiles, which describe each security control that contributes to the tenant's Secure Score, including its category, maximum score, remediation guidance, mitigated threats, and current review state. Returns a paginated list; follow the @odata.nextLink value using the Next Page Link parameter to retrieve additional pages.
   * @route GET /list-secure-score-control-profiles
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Optional OData $filter expression, for example: controlCategory eq 'Identity'."}
   * @paramDef {"type":"Number","label":"Max Results","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of control profiles to return per page. Defaults to 50."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"The @odata.nextLink URL from a previous response used to retrieve the next page. When provided, all other parameters are ignored."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"NonOwnerAccess","controlCategory":"Data","title":"Review mailbox access by non-owners bi-weekly","maxScore":5.0,"rank":25,"tier":"Core","service":"EXO","threats":["Account Breach","Data Exfiltration"]}],"@odata.nextLink":"https://graph.microsoft.com/v1.0/security/secureScoreControlProfiles?$skiptoken=..."}
   */
  async listSecureScoreControlProfiles(filter, top, nextLink) {
    if (nextLink) {
      return this.#apiRequest({ url: nextLink, logTag: 'listSecureScoreControlProfiles' })
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/secureScoreControlProfiles`,
      query: {
        $filter: filter,
        $top: top || DEFAULT_PAGE_SIZE,
      },
      logTag: 'listSecureScoreControlProfiles',
    })
  }

  /**
   * @operationName Update Secure Score Control Profile
   * @category Secure Score
   * @appearanceColor #0F6CBD #004578
   * @description Updates the review state of a Secure Score control profile, for example to mark a control as ignored or third-party managed, assign it, and add a note explaining the decision. Microsoft Graph requires a vendorInformation block on every update; this action supplies the standard Microsoft SecureScore vendor values automatically. Returns the updated control profile.
   * @route PATCH /update-secure-score-control-profile
   * @paramDef {"type":"String","label":"Control Profile ID","name":"controlProfileId","required":true,"description":"The unique identifier of the control profile to update, for example: NonOwnerAccess."}
   * @paramDef {"type":"String","label":"State","name":"state","uiComponent":{"type":"DROPDOWN","options":{"values":["Default","Ignored","Third Party","Reviewed"]}},"description":"The review state to set for the control. Default resets to the automatically calculated state; Ignored excludes it from the score; Third Party marks it as covered by another product; Reviewed marks it as manually verified."}
   * @paramDef {"type":"String","label":"Assigned To","name":"assignedTo","description":"An optional owner to assign the control to, recorded in the control state update."}
   * @paramDef {"type":"String","label":"Comment","name":"comment","description":"An optional note explaining the state change, recorded in the control state update."}
   * @returns {Object}
   * @sampleResult {"id":"NonOwnerAccess","controlCategory":"Data","title":"Review mailbox access by non-owners bi-weekly","maxScore":5.0,"controlStateUpdates":[{"assignedTo":null,"comment":"Handled by third-party tool","state":"ThirdParty","updatedBy":"user1@contoso.com","updatedDateTime":"2026-03-19T22:37:14Z"}],"vendorInformation":{"provider":"SecureScore","vendor":"Microsoft"}}
   */
  async updateSecureScoreControlProfile(controlProfileId, state, assignedTo, comment) {
    if (!controlProfileId) {
      throw new Error('Parameter "Control Profile ID" is required')
    }

    const resolvedState = this.#resolveChoice(state, {
      'Default': 'Default',
      'Ignored': 'Ignored',
      'Third Party': 'ThirdParty',
      'Reviewed': 'Reviewed',
    })

    const controlStateUpdate = cleanupObject({
      assignedTo,
      comment,
      state: resolvedState,
    })

    const body = {
      vendorInformation: {
        provider: 'SecureScore',
        vendor: 'Microsoft',
      },
    }

    if (Object.keys(controlStateUpdate).length) {
      body.controlStateUpdates = [controlStateUpdate]
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/secureScoreControlProfiles/${ encodeURIComponent(controlProfileId) }`,
      method: 'patch',
      body,
      headers: { Prefer: 'return=representation' },
      logTag: 'updateSecureScoreControlProfile',
    })
  }

  /**
   * @operationName List Threat Intelligence Indicators
   * @category Threat Intelligence
   * @appearanceColor #0F6CBD #004578
   * @description Retrieves the threat intelligence indicators (tiIndicators) your application has submitted to Microsoft security products such as Microsoft Defender for Endpoint and Microsoft Sentinel. Each indicator carries an observable (URL, domain, IP, or file hash), an action, a threat type, and a Traffic Light Protocol level. Returns a paginated list; follow the @odata.nextLink value using the Next Page Link parameter to retrieve additional pages.
   * @route GET /list-ti-indicators
   * @paramDef {"type":"Number","label":"Max Results","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of indicators to return per page. Defaults to 50."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"The @odata.nextLink URL from a previous response used to retrieve the next page. When provided, all other parameters are ignored."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"e58c2fc5-1d9a-4c5f-8e5c-8c3e0d3f9c2a","action":"alert","threatType":"WatchList","tlpLevel":"green","targetProduct":"Azure Sentinel","domainName":"badspot.example.com","expirationDateTime":"2026-08-01T00:00:00Z"}],"@odata.nextLink":"https://graph.microsoft.com/v1.0/security/tiIndicators?$skiptoken=..."}
   */
  async listTiIndicators(top, nextLink) {
    if (nextLink) {
      return this.#apiRequest({ url: nextLink, logTag: 'listTiIndicators' })
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/tiIndicators`,
      query: { $top: top || DEFAULT_PAGE_SIZE },
      logTag: 'listTiIndicators',
    })
  }

  /**
   * @operationName Create Threat Intelligence Indicator
   * @category Threat Intelligence
   * @appearanceColor #0F6CBD #004578
   * @description Submits a new threat intelligence indicator (tiIndicator) to a Microsoft security product so it can be matched against telemetry and drive an allow, block, or alert action. Provide at least one observable: a domain name, URL, destination IP address, or file hash (with its hash type). An action, threat type, Traffic Light Protocol level, target product, description, and expiration date are required by Microsoft Graph. Returns the created indicator.
   * @route POST /create-ti-indicator
   * @paramDef {"type":"String","label":"Action","name":"action","required":true,"defaultValue":"Alert","uiComponent":{"type":"DROPDOWN","options":{"values":["Alert","Allow","Block","Unknown"]}},"description":"The action the target security product applies when the indicator matches."}
   * @paramDef {"type":"String","label":"Target Product","name":"targetProduct","required":true,"defaultValue":"Azure Sentinel","uiComponent":{"type":"DROPDOWN","options":{"values":["Azure Sentinel","Microsoft Defender ATP"]}},"description":"The single Microsoft security product the indicator is applied to."}
   * @paramDef {"type":"String","label":"Threat Type","name":"threatType","required":true,"defaultValue":"WatchList","uiComponent":{"type":"DROPDOWN","options":{"values":["Botnet","C2","CryptoMining","Darknet","DDoS","MaliciousUrl","Malware","Phishing","Proxy","PUA","WatchList"]}},"description":"The category of threat the indicator represents."}
   * @paramDef {"type":"String","label":"TLP Level","name":"tlpLevel","required":true,"defaultValue":"Green","uiComponent":{"type":"DROPDOWN","options":{"values":["White","Green","Amber","Red"]}},"description":"The Traffic Light Protocol level describing the sensitivity and sharing scope of the indicator."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":true,"description":"A brief description of the threat represented by the indicator (100 characters or fewer)."}
   * @paramDef {"type":"String","label":"Expiration Date/Time","name":"expirationDateTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"The ISO 8601 UTC timestamp when the indicator expires, for example: 2026-08-01T00:00:00Z. All indicators must expire to avoid staleness."}
   * @paramDef {"type":"String","label":"Domain Name","name":"domainName","description":"An observable domain name in subdomain.domain.tld form, for example: baddomain.example.net. Provide at least one observable."}
   * @paramDef {"type":"String","label":"URL","name":"url","description":"An observable URL. Provide at least one observable."}
   * @paramDef {"type":"String","label":"Destination IPv4","name":"networkDestinationIPv4","description":"An observable destination IPv4 address. Provide at least one observable."}
   * @paramDef {"type":"String","label":"File Hash Value","name":"fileHashValue","description":"An observable file hash value. When set, also provide the File Hash Type. Provide at least one observable."}
   * @paramDef {"type":"String","label":"File Hash Type","name":"fileHashType","uiComponent":{"type":"DROPDOWN","options":{"values":["sha1","sha256","md5","authenticodeHash256","lsHash","ctph","unknown"]}},"description":"The hash algorithm of the File Hash Value. Required when a file hash value is supplied."}
   * @paramDef {"type":"Number","label":"Severity","name":"severity","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The severity of the indicated behavior from 0 (none) to 5 (most severe). Defaults to 3 when omitted."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"An optional array of free-form tags or keywords to store with the indicator."}
   * @returns {Object}
   * @sampleResult {"id":"e58c2fc5-1d9a-4c5f-8e5c-8c3e0d3f9c2a","action":"alert","threatType":"WatchList","tlpLevel":"green","targetProduct":"Azure Sentinel","domainName":"baddomain.example.net","description":"Suspicious domain","expirationDateTime":"2026-08-01T00:00:00Z","azureTenantId":"b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c"}
   */
  async createTiIndicator(action, targetProduct, threatType, tlpLevel, description, expirationDateTime, domainName, url, networkDestinationIPv4, fileHashValue, fileHashType, severity, tags) {
    if (!action) {
      throw new Error('Parameter "Action" is required')
    }

    if (!targetProduct) {
      throw new Error('Parameter "Target Product" is required')
    }

    if (!threatType) {
      throw new Error('Parameter "Threat Type" is required')
    }

    if (!tlpLevel) {
      throw new Error('Parameter "TLP Level" is required')
    }

    if (!description) {
      throw new Error('Parameter "Description" is required')
    }

    if (!expirationDateTime) {
      throw new Error('Parameter "Expiration Date/Time" is required')
    }

    if (fileHashValue && !fileHashType) {
      throw new Error('Parameter "File Hash Type" is required when a File Hash Value is provided')
    }

    if (!domainName && !url && !networkDestinationIPv4 && !fileHashValue) {
      throw new Error('Provide at least one observable: Domain Name, URL, Destination IPv4, or File Hash Value')
    }

    const body = cleanupObject({
      action: this.#resolveChoice(action, TI_ACTION_MAP),
      targetProduct,
      threatType,
      tlpLevel: this.#resolveChoice(tlpLevel, TI_TLP_MAP),
      description,
      expirationDateTime,
      domainName,
      url,
      networkDestinationIPv4,
      fileHashValue,
      fileHashType,
      severity,
      tags: Array.isArray(tags) && tags.length ? tags : undefined,
    })

    return this.#apiRequest({
      url: `${ API_BASE_URL }/tiIndicators`,
      method: 'post',
      body,
      logTag: 'createTiIndicator',
    })
  }

  /**
   * @operationName Delete Threat Intelligence Indicator
   * @category Threat Intelligence
   * @appearanceColor #0F6CBD #004578
   * @description Deletes a threat intelligence indicator (tiIndicator) that your application previously submitted, removing it from the target security product. Returns a confirmation message; Microsoft Graph returns no content on success.
   * @route DELETE /delete-ti-indicator
   * @paramDef {"type":"String","label":"Indicator ID","name":"indicatorId","required":true,"description":"The unique identifier of the threat intelligence indicator to delete."}
   * @returns {Object}
   * @sampleResult {"message":"Threat intelligence indicator deleted successfully","indicatorId":"e58c2fc5-1d9a-4c5f-8e5c-8c3e0d3f9c2a"}
   */
  async deleteTiIndicator(indicatorId) {
    if (!indicatorId) {
      throw new Error('Parameter "Indicator ID" is required')
    }

    await this.#apiRequest({
      url: `${ API_BASE_URL }/tiIndicators/${ encodeURIComponent(indicatorId) }`,
      method: 'delete',
      logTag: 'deleteTiIndicator',
    })

    return { message: 'Threat intelligence indicator deleted successfully', indicatorId }
  }
}

Flowrunner.ServerCode.addService(MicrosoftGraphSecurityService, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth2 Client ID (Application ID) of your Microsoft Entra app registration with Microsoft Graph security permissions.',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth2 Client Secret of your Microsoft Entra app registration.',
  },
])

function cleanupObject(data) {
  if (!data) {
    return
  }

  const result = {}

  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null) {
      result[key] = data[key]
    }
  })

  return result
}

function constructIdentityName(user) {
  const email = user.mail || user.userPrincipalName

  if (email && user.displayName) {
    return `${ email } (${ user.displayName })`
  }

  return email || user.displayName || 'Microsoft Graph Security Connection'
}
