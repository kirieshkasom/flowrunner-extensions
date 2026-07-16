// GoTo Webinar (formerly GoToWebinar / Citrix) integration - manage webinars, registrants,
// attendees, and sessions via the GoTo Webinar REST API v2 (OAuth2).

// ============================================================================
//  CONSTANTS
// ============================================================================
const API_BASE = 'https://api.getgo.com/G2W/rest/v2'

// GoTo (formerly LogMeIn) OAuth 2.0 endpoints. authentication.logmeininc.com is the current
// authorization server for GoTo products; the older api.getgo.com/oauth/v2 host was decommissioned
// on 2025-09-30. Token exchange authenticates the client with HTTP Basic auth (base64
// clientId:secret) and a form-urlencoded body.
//
// IMPORTANT: the current token response returns ONLY access_token, token_type, refresh_token,
// expires_in, scope, and principal. It NO LONGER returns organizer_key / account_key / user
// details (those were removed in the New Token Retrieval migration). The organizer key required by
// every GoTo Webinar path must now be fetched separately from the SCIM /me identity API below.
const OAUTH_AUTHORIZE_URL = 'https://authentication.logmeininc.com/oauth/authorize'
const OAUTH_TOKEN_URL = 'https://authentication.logmeininc.com/oauth/token'

// SCIM /me identity endpoint — returns the authenticated user, including the organizer key and the
// accounts they belong to (each with its account key). Called right after the token exchange to
// capture the keys the token response no longer provides.
const IDENTITY_ME_URL = 'https://api.getgo.com/identity/v1/Users/me'

// GoTo Webinar paths are scoped to organizerKey (and, for account reads, accountKey), both of
// which arrive in the token response but are NOT reliably passed back on later invocations.
// Following the platform's composite-token pattern (docs/flowrunner-extension-oauth2.md), we embed
// them into the `token` field so they ride back on the oauth-access-token header every call.
const TOKEN_DELIMITER = '::gtw::'

const PAGE_SIZE = 20

// Friendly DROPDOWN labels the UI shows, mapped to the API values GoTo Webinar expects.
const WEBINAR_TYPE_MAP = {
  'Single Session': 'single_session',
  'Series': 'series',
  'Sequence': 'sequence',
}

const ERROR_HINTS = {
  400: 'The request was rejected — check the field values (dates must be ISO8601, time ranges valid).',
  401: 'Authentication failed — reconnect the GoTo Webinar account.',
  403: 'Access denied — the connected account cannot access this resource, or is missing the required scope.',
  404: 'Not found — the key may be wrong; use the matching list action to pick a valid one.',
  409: 'Conflict — the registrant may already exist, or the webinar state does not allow this change.',
  429: 'Rate limit hit — retry in a moment.',
}

// ============================================================================
//  LOGGER
// ============================================================================
const logger = {
  info: (...args) => console.log('[GoTo Webinar] info:', ...args),
  debug: (...args) => console.log('[GoTo Webinar] debug:', ...args),
  error: (...args) => console.log('[GoTo Webinar] error:', ...args),
  warn: (...args) => console.log('[GoTo Webinar] warn:', ...args),
}

// ============================================================================
//  DICTIONARY PAYLOAD TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} getWebinarsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter upcoming webinars by subject."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination page number for the next page of results."}
 */

/**
 * @integrationName GoTo Webinar
 * @integrationIcon /icon.png
 * @requireOAuth
 */
class GoToWebinar {
  constructor(config) {
    this.config = config || {}
    this.clientId = this.config.clientId
    this.clientSecret = this.config.clientSecret
  }

  // ==========================================================================
  //  CORE - every external call goes through #apiRequest
  // ==========================================================================
  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'

    try {
      logger.debug(`${ logTag } ${ method.toUpperCase() } ${ url }`)

      const request = Flowrunner.Request[method](url)
        .set(this.#headers(body !== undefined))
        .query(query || {})

      if (body !== undefined) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      this.#handleError(error, logTag)
    }
  }

  #headers(hasBody) {
    const headers = {
      Authorization: `Bearer ${ this.#getAccessToken() }`,
      Accept: 'application/json',
    }

    if (hasBody) {
      headers['Content-Type'] = 'application/json'
    }

    return headers
  }

  #handleError(error, logTag) {
    const status = error?.status || error?.statusCode
    const apiMessage =
      error?.body?.description ||
      error?.body?.message ||
      error?.body?.error_description ||
      error?.message ||
      'Request failed'
    const errCode = error?.body?.int_err_code
    const hint = ERROR_HINTS[status]

    logger.error(`${ logTag } failed: ${ apiMessage }${ errCode ? ` (${ errCode })` : '' }`)

    throw new Error(hint ? `${ hint } (${ apiMessage })` : apiMessage)
  }

  // Translate a friendly DROPDOWN label into the API value; pass through anything unmapped.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // The composite token from the header: "<accessToken>::gtw::<organizerKey>::gtw::<accountKey>".
  #getCompositeToken() {
    const token = this.request.headers['oauth-access-token']

    if (!token) {
      throw new Error('Access token is not available. Please reconnect the GoTo Webinar account.')
    }

    return token
  }

  #getAccessToken() {
    return this.#getCompositeToken().split(TOKEN_DELIMITER)[0]
  }

  // organizerKey is embedded into the token at connect time (see #buildCompositeToken); GoTo Webinar
  // paths are scoped to it, so every operation resolves it from the composite token.
  #getOrganizerKey() {
    const key = this.#getCompositeToken().split(TOKEN_DELIMITER)[1]

    if (!key) {
      throw new Error('Organizer key is unavailable — reconnect the GoTo Webinar account so it can be captured.')
    }

    return key
  }

  // accountKey is optional (only some accounts expose account-wide reads); may be absent.
  #getAccountKey() {
    return this.#getCompositeToken().split(TOKEN_DELIMITER)[2] || null
  }

  // Assembles the composite token embedding organizerKey + accountKey so both survive later calls.
  #buildCompositeToken(accessToken, organizerKey, accountKey) {
    return [accessToken, organizerKey || '', accountKey || ''].join(TOKEN_DELIMITER)
  }

  // The token response no longer carries organizer_key/account_key, so we resolve them from the
  // SCIM /me identity API using the freshly issued access token. The response exposes a top-level
  // `key` (the organizer key) and an `accounts` array whose entries each carry an account `key`.
  async #fetchIdentityKeys(accessToken) {
    try {
      const me = await Flowrunner.Request.get(IDENTITY_ME_URL)
        .set({ Authorization: `Bearer ${ accessToken }`, Accept: 'application/json' })

      const organizerKey = me?.key || me?.id || null
      const accounts = Array.isArray(me?.accounts) ? me.accounts : []
      const accountKey = accounts[0]?.key || me?.accountKey || null
      const email = me?.email || (Array.isArray(me?.emails) ? me.emails[0]?.value : null) || null
      const fullName =
        me?.displayName ||
        [me?.name?.givenName, me?.name?.familyName].filter(Boolean).join(' ').trim() ||
        null

      return { organizerKey, accountKey, email, fullName }
    } catch (error) {
      logger.warn(`fetchIdentityKeys failed: ${ error?.body?.message || error?.message }`)

      return { organizerKey: null, accountKey: null, email: null, fullName: null }
    }
  }

  // ==========================================================================
  //  OAUTH2 SYSTEM METHODS
  // ==========================================================================
  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   */
  async getOAuth2ConnectionURL() {
    // redirect_uri and state are injected by the FlowRunner platform - do not append them here.
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
    })

    return `${ OAUTH_AUTHORIZE_URL }?${ params.toString() }`
  }

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   */
  async executeCallback(callbackObject) {
    // GoTo authenticates the client at the token endpoint with HTTP Basic auth (base64 of
    // clientId:clientSecret) and a form-urlencoded body. The current token response returns only
    // access_token/refresh_token/expires_in/scope/principal — it no longer includes organizer_key
    // or account_key — so we fetch those from the SCIM /me identity API and embed them into the
    // stored token so operations can build the /organizers/{organizerKey}/... paths.
    const basic = Buffer.from(`${ this.clientId }:${ this.clientSecret }`).toString('base64')

    const tokenResponse = await Flowrunner.Request.post(OAUTH_TOKEN_URL)
      .set({ Authorization: `Basic ${ basic }`, 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: callbackObject.code,
          redirect_uri: callbackObject.redirectURI,
        }).toString()
      )

    const identity = await this.#fetchIdentityKeys(tokenResponse.access_token)
    const organizerKey = identity.organizerKey
    const accountKey = identity.accountKey
    const email = identity.email || tokenResponse.principal || null

    if (!organizerKey) {
      throw new Error('Could not determine the organizer key from the GoTo identity API. Ensure the connected account is a GoTo Webinar organizer and try reconnecting.')
    }

    return {
      token: this.#buildCompositeToken(tokenResponse.access_token, organizerKey, accountKey),
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token,
      connectionIdentityName: identity.fullName || email || organizerKey || null,
      connectionIdentityImageURL: null,
      userData: { organizerKey, accountKey, email },
      overwrite: true,
    }
  }

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   */
  async refreshToken(refreshToken) {
    const basic = Buffer.from(`${ this.clientId }:${ this.clientSecret }`).toString('base64')

    const tokenResponse = await Flowrunner.Request.post(OAUTH_TOKEN_URL)
      .set({ Authorization: `Basic ${ basic }`, 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }).toString()
      )

    // The refresh response does not carry organizer_key/account_key (the token endpoint no longer
    // returns them), so re-embed the values already captured in the current composite token.
    const composite = this.#getCompositeToken().split(TOKEN_DELIMITER)
    const organizerKey = composite[1]
    const accountKey = composite[2]

    return {
      token: this.#buildCompositeToken(tokenResponse.access_token, organizerKey, accountKey),
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token || refreshToken,
    }
  }

  // ==========================================================================
  //  WEBINARS
  // ==========================================================================
  /**
   * @operationName Get All Webinars
   * @category Webinars
   * @description Lists webinars for the connected organizer within a date range. Returns each webinar's key, subject, description, session times, and registration URL. Use this to find a webinar before managing its registrants or reading its sessions. The from/to time range is required by GoTo and cannot exceed one year.
   * @route GET /get-all-webinars
   * @paramDef {"type":"String","label":"From Time","name":"fromTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start of the date range (ISO8601, e.g. 2024-01-01T00:00:00Z). Required by GoTo; the range may not exceed one year."}
   * @paramDef {"type":"String","label":"To Time","name":"toTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"End of the date range (ISO8601, e.g. 2024-12-31T23:59:59Z)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":0,"description":"Zero-based page number for pagination."}
   * @paramDef {"type":"Number","label":"Page Size","name":"size","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":20,"description":"Number of webinars per page (default 20)."}
   * @returns {Object}
   * @sampleResult {"_embedded":{"webinars":[{"webinarKey":"9999999999999999999","subject":"My First Webinar","description":"Learn the basics","times":[{"startTime":"2024-05-01T15:00:00Z","endTime":"2024-05-01T16:00:00Z"}],"timeZone":"America/New_York","registrationUrl":"https://register.gotowebinar.com/register/1234"}]},"page":{"size":20,"totalElements":1,"totalPages":1,"number":0}}
   */
  async getAllWebinars(fromTime, toTime, page, size) {
    if (!fromTime) throw new Error('From Time is required.')
    if (!toTime) throw new Error('To Time is required.')

    const organizerKey = this.#getOrganizerKey()

    return await this.#apiRequest({
      url: `${ API_BASE }/organizers/${ organizerKey }/webinars`,
      query: {
        fromTime,
        toTime,
        page: page || 0,
        size: size || PAGE_SIZE,
      },
      logTag: 'getAllWebinars',
    })
  }

  /**
   * @operationName Get Webinar
   * @category Webinars
   * @description Retrieves the full details of a single webinar by its key, including subject, description, all session times, time zone, type, and registration settings. Use this after finding a webinar with Get All Webinars.
   * @route GET /get-webinar
   * @paramDef {"type":"String","label":"Webinar","name":"webinarKey","required":true,"dictionary":"getWebinarsDictionary","description":"The webinar to fetch."}
   * @returns {Object}
   * @sampleResult {"webinarKey":"9999999999999999999","subject":"My First Webinar","description":"Learn the basics","times":[{"startTime":"2024-05-01T15:00:00Z","endTime":"2024-05-01T16:00:00Z"}],"timeZone":"America/New_York","organizerKey":"1111111111","registrationUrl":"https://register.gotowebinar.com/register/1234","numberOfRegistrants":12,"webinarType":"single_session"}
   */
  async getWebinar(webinarKey) {
    if (!webinarKey) throw new Error('Webinar is required.')

    const organizerKey = this.#getOrganizerKey()

    return await this.#apiRequest({
      url: `${ API_BASE }/organizers/${ organizerKey }/webinars/${ webinarKey }`,
      logTag: 'getWebinar',
    })
  }

  /**
   * @operationName Create Webinar
   * @category Webinars
   * @description Schedules a new webinar for the connected organizer. Provide the subject, one or more session time ranges, and a time zone. For a single occurrence use type Single Session with one time range; use Series or Sequence with multiple time ranges for recurring events. Returns the new webinar key and registration URL.
   * @route POST /create-webinar
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The webinar title shown to registrants."}
   * @paramDef {"type":"Array<Object>","label":"Times","name":"times","required":true,"description":"One or more session time ranges, each an object with startTime and endTime in ISO8601 (e.g. [{\"startTime\":\"2024-05-01T15:00:00Z\",\"endTime\":\"2024-05-01T16:00:00Z\"}]). Single Session takes one range; Series and Sequence take multiple."}
   * @paramDef {"type":"String","label":"Time Zone","name":"timeZone","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"IANA time zone name (e.g. America/New_York, Europe/London)."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Longer description of the webinar shown on the registration page."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Single Session","Series","Sequence"]}},"defaultValue":"Single Session","description":"Single Session (one occurrence), Series (recurring, register once for all), or Sequence (recurring, register per session)."}
   * @paramDef {"type":"Boolean","label":"Approval Required","name":"isApprovalRequired","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, registrants must be approved by the organizer before they can attend."}
   * @returns {Object}
   * @sampleResult {"webinarKey":"9999999999999999999"}
   */
  async createWebinar(subject, times, timeZone, description, type, isApprovalRequired) {
    if (!subject) throw new Error('Subject is required.')
    if (!timeZone) throw new Error('Time Zone is required.')

    const parsedTimes = this.#parseTimes(times)

    if (!parsedTimes || parsedTimes.length === 0) {
      throw new Error('At least one session time range (with startTime and endTime) is required.')
    }

    const organizerKey = this.#getOrganizerKey()

    const body = {
      subject,
      times: parsedTimes,
      timeZone,
      type: this.#resolveChoice(type, WEBINAR_TYPE_MAP) || 'single_session',
    }

    if (description) body.description = description

    if (isApprovalRequired !== undefined && isApprovalRequired !== null && isApprovalRequired !== '') {
      body.isApprovalRequired = Boolean(isApprovalRequired)
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/organizers/${ organizerKey }/webinars`,
      method: 'post',
      body,
      logTag: 'createWebinar',
    })
  }

  /**
   * @operationName Update Webinar
   * @category Webinars
   * @description Updates an existing webinar's subject, description, session times, time zone, or approval setting. Only the fields you provide are changed. When changing session times, set Notify Participants to control whether registrants receive an updated-time email. Returns no content on success.
   * @route PUT /update-webinar
   * @paramDef {"type":"String","label":"Webinar","name":"webinarKey","required":true,"dictionary":"getWebinarsDictionary","description":"The webinar to update."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New webinar title."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description."}
   * @paramDef {"type":"Array<Object>","label":"Times","name":"times","description":"Replacement session time ranges, each an object with startTime and endTime in ISO8601."}
   * @paramDef {"type":"String","label":"Time Zone","name":"timeZone","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New IANA time zone name (e.g. America/New_York)."}
   * @paramDef {"type":"Boolean","label":"Approval Required","name":"isApprovalRequired","uiComponent":{"type":"CHECKBOX"},"description":"Whether registrants must be approved before attending."}
   * @paramDef {"type":"Boolean","label":"Notify Participants","name":"notifyParticipants","uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"When enabled, existing registrants are emailed about the change (relevant when session times change)."}
   * @returns {Object}
   * @sampleResult {"updated":true,"webinarKey":"9999999999999999999"}
   */
  async updateWebinar(webinarKey, subject, description, times, timeZone, isApprovalRequired, notifyParticipants) {
    if (!webinarKey) throw new Error('Webinar is required.')

    const organizerKey = this.#getOrganizerKey()

    const body = {}

    if (subject) body.subject = subject
    if (description !== undefined && description !== null) body.description = description
    if (timeZone) body.timeZone = timeZone

    const parsedTimes = this.#parseTimes(times)

    if (parsedTimes && parsedTimes.length > 0) body.times = parsedTimes

    if (isApprovalRequired !== undefined && isApprovalRequired !== null && isApprovalRequired !== '') {
      body.isApprovalRequired = Boolean(isApprovalRequired)
    }

    const notify = notifyParticipants === undefined || notifyParticipants === null || notifyParticipants === ''
      ? true
      : Boolean(notifyParticipants)

    await this.#apiRequest({
      url: `${ API_BASE }/organizers/${ organizerKey }/webinars/${ webinarKey }`,
      method: 'put',
      query: { notifyParticipants: notify },
      body,
      logTag: 'updateWebinar',
    })

    return { updated: true, webinarKey }
  }

  /**
   * @operationName Cancel Webinar
   * @category Webinars
   * @description Cancels (deletes) a webinar. Optionally sends cancellation emails to everyone who registered. This cannot be undone — the webinar and its registration URL stop working immediately.
   * @route DELETE /cancel-webinar
   * @paramDef {"type":"String","label":"Webinar","name":"webinarKey","required":true,"dictionary":"getWebinarsDictionary","description":"The webinar to cancel. This removes it permanently."}
   * @paramDef {"type":"Boolean","label":"Send Cancellation Emails","name":"sendCancellationEmails","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, all registrants are emailed that the webinar was cancelled."}
   * @returns {Object}
   * @sampleResult {"cancelled":true,"webinarKey":"9999999999999999999"}
   */
  async cancelWebinar(webinarKey, sendCancellationEmails) {
    if (!webinarKey) throw new Error('Webinar is required.')

    const organizerKey = this.#getOrganizerKey()

    await this.#apiRequest({
      url: `${ API_BASE }/organizers/${ organizerKey }/webinars/${ webinarKey }`,
      method: 'delete',
      query: { sendCancellationEmails: Boolean(sendCancellationEmails) },
      logTag: 'cancelWebinar',
    })

    return { cancelled: true, webinarKey }
  }

  // ==========================================================================
  //  REGISTRANTS
  // ==========================================================================
  /**
   * @operationName Get Registrants
   * @category Registrants
   * @description Lists everyone who has registered for a webinar, including their name, email, registration status, and join URL. Use this to export a registration list or check who has signed up.
   * @route GET /get-registrants
   * @paramDef {"type":"String","label":"Webinar","name":"webinarKey","required":true,"dictionary":"getWebinarsDictionary","description":"The webinar whose registrants to list."}
   * @returns {Object}
   * @sampleResult [{"registrantKey":"5555555555555555555","firstName":"Jane","lastName":"Doe","email":"jane@example.com","status":"APPROVED","registrationDate":"2024-04-01T12:00:00Z","joinUrl":"https://global.gotowebinar.com/join/1234/567"}]
   */
  async getRegistrants(webinarKey) {
    if (!webinarKey) throw new Error('Webinar is required.')

    const organizerKey = this.#getOrganizerKey()

    return await this.#apiRequest({
      url: `${ API_BASE }/organizers/${ organizerKey }/webinars/${ webinarKey }/registrants`,
      logTag: 'getRegistrants',
    })
  }

  /**
   * @operationName Get Registrant
   * @category Registrants
   * @description Retrieves a single registrant's details by their registrant key, including status, registration answers, and personal join URL. Use this after listing registrants.
   * @route GET /get-registrant
   * @paramDef {"type":"String","label":"Webinar","name":"webinarKey","required":true,"dictionary":"getWebinarsDictionary","description":"The webinar the registrant belongs to."}
   * @paramDef {"type":"String","label":"Registrant Key","name":"registrantKey","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The registrant key (from Get Registrants)."}
   * @returns {Object}
   * @sampleResult {"registrantKey":"5555555555555555555","firstName":"Jane","lastName":"Doe","email":"jane@example.com","status":"APPROVED","joinUrl":"https://global.gotowebinar.com/join/1234/567","timeZone":"America/New_York"}
   */
  async getRegistrant(webinarKey, registrantKey) {
    if (!webinarKey) throw new Error('Webinar is required.')
    if (!registrantKey) throw new Error('Registrant Key is required.')

    const organizerKey = this.#getOrganizerKey()

    return await this.#apiRequest({
      url: `${ API_BASE }/organizers/${ organizerKey }/webinars/${ webinarKey }/registrants/${ registrantKey }`,
      logTag: 'getRegistrant',
    })
  }

  /**
   * @operationName Create Registrant
   * @category Registrants
   * @description Registers a new person for a webinar. First name, last name, and email are required; additional profile fields can be supplied. Returns the registrant key, status, and a personal join URL to send to the attendee. If the webinar requires approval, the status will be WAITING until an organizer approves.
   * @route POST /create-registrant
   * @paramDef {"type":"String","label":"Webinar","name":"webinarKey","required":true,"dictionary":"getWebinarsDictionary","description":"The webinar to register the person for."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Registrant's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Registrant's last name."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Registrant's email address."}
   * @paramDef {"type":"String","label":"Organization","name":"organization","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Registrant's company or organization."}
   * @paramDef {"type":"String","label":"Job Title","name":"jobTitle","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Registrant's job title."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Registrant's phone number."}
   * @paramDef {"type":"String","label":"City","name":"city","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Registrant's city."}
   * @paramDef {"type":"String","label":"State","name":"state","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Registrant's state or province."}
   * @paramDef {"type":"String","label":"Country","name":"country","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Registrant's country (ISO code, e.g. US)."}
   * @paramDef {"type":"Array<Object>","label":"Custom Responses","name":"responses","description":"Answers to the webinar's custom registration questions, each an object with questionKey and responseText (or answerKey for multiple-choice)."}
   * @paramDef {"type":"Boolean","label":"Resend Confirmation","name":"resendConfirmation","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, re-sends the confirmation email if the person is already registered."}
   * @returns {Object}
   * @sampleResult {"registrantKey":"5555555555555555555","joinUrl":"https://global.gotowebinar.com/join/1234/567","status":"APPROVED"}
   */
  async createRegistrant(webinarKey, firstName, lastName, email, organization, jobTitle, phone, city, state, country, responses, resendConfirmation) {
    if (!webinarKey) throw new Error('Webinar is required.')
    if (!firstName) throw new Error('First Name is required.')
    if (!lastName) throw new Error('Last Name is required.')
    if (!email) throw new Error('Email is required.')

    const organizerKey = this.#getOrganizerKey()

    const body = { firstName, lastName, email }

    if (organization) body.organization = organization
    if (jobTitle) body.jobTitle = jobTitle
    if (phone) body.phone = phone
    if (city) body.city = city
    if (state) body.state = state
    if (country) body.country = country

    const parsedResponses = this.#parseJsonArray(responses)

    if (parsedResponses && parsedResponses.length > 0) body.responses = parsedResponses

    const query = {}

    if (resendConfirmation) query.resendConfirmation = true

    return await this.#apiRequest({
      url: `${ API_BASE }/organizers/${ organizerKey }/webinars/${ webinarKey }/registrants`,
      method: 'post',
      query,
      body,
      logTag: 'createRegistrant',
    })
  }

  /**
   * @operationName Delete Registrant
   * @category Registrants
   * @description Removes a registrant from a webinar, cancelling their registration. Their personal join URL stops working. Use this to unregister someone who signed up in error.
   * @route DELETE /delete-registrant
   * @paramDef {"type":"String","label":"Webinar","name":"webinarKey","required":true,"dictionary":"getWebinarsDictionary","description":"The webinar the registrant belongs to."}
   * @paramDef {"type":"String","label":"Registrant Key","name":"registrantKey","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The registrant key to remove (from Get Registrants)."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"registrantKey":"5555555555555555555"}
   */
  async deleteRegistrant(webinarKey, registrantKey) {
    if (!webinarKey) throw new Error('Webinar is required.')
    if (!registrantKey) throw new Error('Registrant Key is required.')

    const organizerKey = this.#getOrganizerKey()

    await this.#apiRequest({
      url: `${ API_BASE }/organizers/${ organizerKey }/webinars/${ webinarKey }/registrants/${ registrantKey }`,
      method: 'delete',
      logTag: 'deleteRegistrant',
    })

    return { deleted: true, registrantKey }
  }

  // ==========================================================================
  //  ATTENDEES
  // ==========================================================================
  /**
   * @operationName Get Attendees
   * @category Attendees
   * @description Lists the people who actually attended a specific past session of a webinar, including their join and leave times and time in session. Attendee data is only available after a session has ended. Use Get All Sessions first to find the session key.
   * @route GET /get-attendees
   * @paramDef {"type":"String","label":"Webinar","name":"webinarKey","required":true,"dictionary":"getWebinarsDictionary","description":"The webinar the session belongs to."}
   * @paramDef {"type":"String","label":"Session Key","name":"sessionKey","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The past session's key (from Get All Sessions)."}
   * @returns {Object}
   * @sampleResult [{"registrantKey":"5555555555555555555","firstName":"Jane","lastName":"Doe","email":"jane@example.com","attendanceTimeInSeconds":2700,"attendance":{"enteredWebinar":true}}]
   */
  async getAttendees(webinarKey, sessionKey) {
    if (!webinarKey) throw new Error('Webinar is required.')
    if (!sessionKey) throw new Error('Session Key is required.')

    const organizerKey = this.#getOrganizerKey()

    return await this.#apiRequest({
      url: `${ API_BASE }/organizers/${ organizerKey }/webinars/${ webinarKey }/sessions/${ sessionKey }/attendees`,
      logTag: 'getAttendees',
    })
  }

  /**
   * @operationName Get Attendee
   * @category Attendees
   * @description Retrieves a single attendee's participation details for a past webinar session by their registrant key. Use this after listing attendees to inspect one person's session activity.
   * @route GET /get-attendee
   * @paramDef {"type":"String","label":"Webinar","name":"webinarKey","required":true,"dictionary":"getWebinarsDictionary","description":"The webinar the session belongs to."}
   * @paramDef {"type":"String","label":"Session Key","name":"sessionKey","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The past session's key (from Get All Sessions)."}
   * @paramDef {"type":"String","label":"Registrant Key","name":"registrantKey","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The attendee's registrant key (from Get Attendees)."}
   * @returns {Object}
   * @sampleResult {"registrantKey":"5555555555555555555","firstName":"Jane","lastName":"Doe","email":"jane@example.com","attendanceTimeInSeconds":2700}
   */
  async getAttendee(webinarKey, sessionKey, registrantKey) {
    if (!webinarKey) throw new Error('Webinar is required.')
    if (!sessionKey) throw new Error('Session Key is required.')
    if (!registrantKey) throw new Error('Registrant Key is required.')

    const organizerKey = this.#getOrganizerKey()

    return await this.#apiRequest({
      url: `${ API_BASE }/organizers/${ organizerKey }/webinars/${ webinarKey }/sessions/${ sessionKey }/attendees/${ registrantKey }`,
      logTag: 'getAttendee',
    })
  }

  // ==========================================================================
  //  SESSIONS
  // ==========================================================================
  /**
   * @operationName Get All Sessions
   * @category Sessions
   * @description Lists all past sessions of a webinar (each time it was actually run), with each session's key, start/end times, and registrant/attendee counts. Use this to find a session key for reading attendees, performance, polls, questions, or surveys.
   * @route GET /get-all-sessions
   * @paramDef {"type":"String","label":"Webinar","name":"webinarKey","required":true,"dictionary":"getWebinarsDictionary","description":"The webinar whose past sessions to list."}
   * @returns {Object}
   * @sampleResult {"_embedded":{"webinarSessions":[{"sessionKey":"8888888888888888888","webinarKey":"9999999999999999999","startTime":"2024-05-01T15:00:00Z","endTime":"2024-05-01T16:00:00Z","registrantsAttended":10}]}}
   */
  async getAllSessions(webinarKey) {
    if (!webinarKey) throw new Error('Webinar is required.')

    const organizerKey = this.#getOrganizerKey()

    return await this.#apiRequest({
      url: `${ API_BASE }/organizers/${ organizerKey }/webinars/${ webinarKey }/sessions`,
      logTag: 'getAllSessions',
    })
  }

  /**
   * @operationName Get Session Performance
   * @category Sessions
   * @description Retrieves aggregate performance metrics for a past webinar session — attendance, engagement, poll and survey counts, questions asked, and interest rating. Use this to report on how a session went.
   * @route GET /get-session-performance
   * @paramDef {"type":"String","label":"Webinar","name":"webinarKey","required":true,"dictionary":"getWebinarsDictionary","description":"The webinar the session belongs to."}
   * @paramDef {"type":"String","label":"Session Key","name":"sessionKey","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The past session's key (from Get All Sessions)."}
   * @returns {Object}
   * @sampleResult {"attendance":{"registrantCount":20,"percentageAttendance":75,"averageAttendanceTimeSeconds":2400,"averageInterestRating":8.5},"polls":{"numberOfPolls":2},"surveys":{"numberOfSurveys":1},"questions":{"numberOfQuestions":5}}
   */
  async getSessionPerformance(webinarKey, sessionKey) {
    if (!webinarKey) throw new Error('Webinar is required.')
    if (!sessionKey) throw new Error('Session Key is required.')

    const organizerKey = this.#getOrganizerKey()

    return await this.#apiRequest({
      url: `${ API_BASE }/organizers/${ organizerKey }/webinars/${ webinarKey }/sessions/${ sessionKey }/performance`,
      logTag: 'getSessionPerformance',
    })
  }

  /**
   * @operationName Get Session Polls
   * @category Sessions
   * @description Retrieves the poll questions asked during a past webinar session along with the attendees' answers. Use this to analyze audience responses to your polls.
   * @route GET /get-session-polls
   * @paramDef {"type":"String","label":"Webinar","name":"webinarKey","required":true,"dictionary":"getWebinarsDictionary","description":"The webinar the session belongs to."}
   * @paramDef {"type":"String","label":"Session Key","name":"sessionKey","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The past session's key (from Get All Sessions)."}
   * @returns {Object}
   * @sampleResult [{"question":"How did you hear about us?","answers":[{"answer":"Social media","numberOfVotes":8},{"answer":"A colleague","numberOfVotes":4}]}]
   */
  async getSessionPolls(webinarKey, sessionKey) {
    if (!webinarKey) throw new Error('Webinar is required.')
    if (!sessionKey) throw new Error('Session Key is required.')

    const organizerKey = this.#getOrganizerKey()

    return await this.#apiRequest({
      url: `${ API_BASE }/organizers/${ organizerKey }/webinars/${ webinarKey }/sessions/${ sessionKey }/polls`,
      logTag: 'getSessionPolls',
    })
  }

  /**
   * @operationName Get Session Questions
   * @category Sessions
   * @description Retrieves the questions asked by attendees during a past webinar session, with the organizer's answers where provided. Use this to review the Q&A from a session.
   * @route GET /get-session-questions
   * @paramDef {"type":"String","label":"Webinar","name":"webinarKey","required":true,"dictionary":"getWebinarsDictionary","description":"The webinar the session belongs to."}
   * @paramDef {"type":"String","label":"Session Key","name":"sessionKey","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The past session's key (from Get All Sessions)."}
   * @returns {Object}
   * @sampleResult [{"question":"Will the slides be shared?","askerName":"Jane Doe","answers":[{"text":"Yes, by email tomorrow.","answererName":"Host"}]}]
   */
  async getSessionQuestions(webinarKey, sessionKey) {
    if (!webinarKey) throw new Error('Webinar is required.')
    if (!sessionKey) throw new Error('Session Key is required.')

    const organizerKey = this.#getOrganizerKey()

    return await this.#apiRequest({
      url: `${ API_BASE }/organizers/${ organizerKey }/webinars/${ webinarKey }/sessions/${ sessionKey }/questions`,
      logTag: 'getSessionQuestions',
    })
  }

  /**
   * @operationName Get Session Surveys
   * @category Sessions
   * @description Retrieves the post-session survey questions and the attendees' answers for a past webinar session. Use this to collect and analyze survey feedback.
   * @route GET /get-session-surveys
   * @paramDef {"type":"String","label":"Webinar","name":"webinarKey","required":true,"dictionary":"getWebinarsDictionary","description":"The webinar the session belongs to."}
   * @paramDef {"type":"String","label":"Session Key","name":"sessionKey","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The past session's key (from Get All Sessions)."}
   * @returns {Object}
   * @sampleResult [{"question":"How satisfied were you?","answers":[{"answer":"Very satisfied","numberOfVotes":12}]}]
   */
  async getSessionSurveys(webinarKey, sessionKey) {
    if (!webinarKey) throw new Error('Webinar is required.')
    if (!sessionKey) throw new Error('Session Key is required.')

    const organizerKey = this.#getOrganizerKey()

    return await this.#apiRequest({
      url: `${ API_BASE }/organizers/${ organizerKey }/webinars/${ webinarKey }/sessions/${ sessionKey }/surveys`,
      logTag: 'getSessionSurveys',
    })
  }

  // ==========================================================================
  //  ACCOUNT
  // ==========================================================================
  /**
   * @operationName Get Account Webinars
   * @category Account
   * @description Lists all webinars across every organizer in the connected account within a date range — not just the connected user's own webinars. Requires the connected account to grant account-wide access. Use this for account-level reporting across organizers.
   * @route GET /get-account-webinars
   * @paramDef {"type":"String","label":"From Time","name":"fromTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start of the date range (ISO8601). Required; range may not exceed one year."}
   * @paramDef {"type":"String","label":"To Time","name":"toTime","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"End of the date range (ISO8601)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":0,"description":"Zero-based page number for pagination."}
   * @paramDef {"type":"Number","label":"Page Size","name":"size","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":20,"description":"Number of webinars per page (default 20)."}
   * @returns {Object}
   * @sampleResult {"_embedded":{"webinars":[{"webinarKey":"9999999999999999999","organizerKey":"1111111111","subject":"Company All-Hands","times":[{"startTime":"2024-05-01T15:00:00Z","endTime":"2024-05-01T16:00:00Z"}],"timeZone":"America/New_York"}]},"page":{"size":20,"totalElements":1,"totalPages":1,"number":0}}
   */
  async getAccountWebinars(fromTime, toTime, page, size) {
    if (!fromTime) throw new Error('From Time is required.')
    if (!toTime) throw new Error('To Time is required.')

    const accountKey = this.#getAccountKey()

    if (!accountKey) {
      throw new Error('Account key is unavailable for this connection — reconnect the GoTo Webinar account, or use Get All Webinars for the connected organizer instead.')
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/accounts/${ accountKey }/webinars`,
      query: {
        fromTime,
        toTime,
        page: page || 0,
        size: size || PAGE_SIZE,
      },
      logTag: 'getAccountWebinars',
    })
  }

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================
  /**
   * @registerAs DICTIONARY
   * @operationName Get Webinars Dictionary
   * @description Lists upcoming webinars for the connected organizer for selection in dependent parameters. Each option shows the webinar subject and its next start time.
   * @route POST /get-webinars-dictionary
   * @paramDef {"type":"getWebinarsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"My First Webinar (2024-05-01T15:00:00Z)","value":"9999999999999999999","note":"America/New_York"}],"cursor":null}
   */
  async getWebinarsDictionary(payload) {
    const { search, cursor } = payload || {}
    const page = cursor ? Number(cursor) : 0
    const organizerKey = this.#getOrganizerKey()

    // Upcoming webinars: from now to one year ahead (GoTo caps the range at one year).
    const now = new Date()
    const oneYear = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)

    const result = await this.#apiRequest({
      url: `${ API_BASE }/organizers/${ organizerKey }/webinars`,
      query: {
        fromTime: now.toISOString(),
        toTime: oneYear.toISOString(),
        page,
        size: PAGE_SIZE,
      },
      logTag: 'getWebinarsDictionary',
    })

    const webinars = (result && result._embedded && result._embedded.webinars) || []
    const term = (search || '').toLowerCase()

    const items = webinars
      .filter(webinar => !term || (webinar.subject || '').toLowerCase().includes(term))
      .map(webinar => {
        const startTime = webinar.times && webinar.times[0] && webinar.times[0].startTime
        const label = startTime ? `${ webinar.subject } (${ startTime })` : webinar.subject

        return { label, value: String(webinar.webinarKey), note: webinar.timeZone || undefined }
      })

    const pageInfo = (result && result.page) || {}
    const hasMore = pageInfo.number !== undefined && pageInfo.totalPages !== undefined
      ? pageInfo.number + 1 < pageInfo.totalPages
      : false
    const nextCursor = hasMore && !(term && items.length === 0) ? String(page + 1) : null

    return { items, cursor: nextCursor }
  }

  // ==========================================================================
  //  HELPERS
  // ==========================================================================
  // Parses a session-times param that may arrive as an already-parsed array of {startTime,endTime}
  // objects or as a JSON string, and validates each range carries both fields.
  #parseTimes(times) {
    const parsed = this.#parseJsonArray(times)

    if (!parsed) return undefined

    return parsed.map(range => {
      if (!range || !range.startTime || !range.endTime) {
        throw new Error('Each session time range must include both startTime and endTime (ISO8601).')
      }

      return { startTime: range.startTime, endTime: range.endTime }
    })
  }

  // Normalizes an Array<Object> param into a real array. FlowRunner may hand these over as a
  // parsed array or as a JSON string depending on the caller; both are accepted.
  #parseJsonArray(value) {
    if (value === undefined || value === null || value === '') return undefined

    let parsed = value

    if (typeof value === 'string') {
      try {
        parsed = JSON.parse(value)
      } catch (error) {
        throw new Error('Expected a JSON array of objects.')
      }
    }

    if (!Array.isArray(parsed)) {
      throw new Error('Expected a JSON array of objects.')
    }

    return parsed
  }
}

Flowrunner.ServerCode.addService(GoToWebinar, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The Client ID (Consumer Key) of your GoTo OAuth app. Create one at https://developer.goto.com under My Apps.',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The Client Secret (Consumer Secret) of your GoTo OAuth app.',
  },
])
