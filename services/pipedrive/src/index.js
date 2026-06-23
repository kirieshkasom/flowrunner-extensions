'use strict'

// NOTE: Pipedrive v2 API is documented but most of it isn't usable
// Using v1 API which is fully functional
const API_BASE_URL = 'https://api.pipedrive.com/v1'
const OAUTH_URL = 'https://oauth.pipedrive.com/oauth/authorize'
const TOKEN_URL = 'https://oauth.pipedrive.com/oauth/token'

// Friendly DROPDOWN label -> Pipedrive API value mappings
const VISIBLE_TO_MAP = {
  'Owner & followers (private)': '1',
  'Entire company': '3',
}

const logger = {
  info: (...args) => console.log('[Pipedrive Service] info:', ...args),
  debug: (...args) => console.log('[Pipedrive Service] debug:', ...args),
  error: (...args) => console.log('[Pipedrive Service] error:', ...args),
  warn: (...args) => console.log('[Pipedrive Service] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName Pipedrive
 * @integrationIcon /icon.png
 * @integrationTriggersScope SINGLE_APP
 */
class PipedriveService {

  constructor(config) {
    this.config = config || {}
    this.clientId = this.config.clientId
    this.clientSecret = this.config.clientSecret
  }

  #getAccessToken() {
    return this.request.headers['oauth-access-token']
  }

  #getAuthorizationHeader() {
    return {
      Authorization: `Bearer ${ this.#getAccessToken() }`,
    }
  }

  #getBasicAuthHeader() {
    const credentials = Buffer.from(`${ this.clientId }:${ this.clientSecret }`).toString('base64')

    return {
      Authorization: `Basic ${ credentials }`,
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #handleError(error) {
    // Extract meaningful error message from various possible error formats
    const message = error?.message?.error ||
            error?.body?.error_info ||
            error?.body?.error ||
            error?.body?.message ||
            error?.message ||
            JSON.stringify(error)

    // Guard against object-typed values (e.g. a Flowrunner.Request rejection whose `message`
    // is the parsed JSON body) rendering as the useless "[object Object]".
    const text = typeof message === 'string' ? message : JSON.stringify(message)

    throw new Error(`Pipedrive API error: ${ text }`)
  }

  async #apiRequest({ url, method = 'get', body, query }) {
    try {
      return await Flowrunner.Request[method](url)
        .set({
          Authorization: `Bearer ${ this.#getAccessToken() }`,
          'Content-Type': 'application/json',
        })
        .query(query)
        .send(body)
    } catch (error) {
      // Flowrunner.Request can reject an actually-successful response (observed on some
      // Pipedrive DELETEs, e.g. /activityTypes), carrying the success body on the rejection.
      // The body matches a normal success ({ success: true, data }), so return it as such
      // rather than surfacing a spurious error.
      if (error?.body?.success === true) {
        return error.body
      }

      logger.error('[#apiRequest] Raw error:', JSON.stringify(error, null, 2))
      logger.error('[#apiRequest] Error message:', error.message)
      logger.error('[#apiRequest] Error body:', JSON.stringify(error.body, null, 2))
      this.#handleError(error)
    }
  }

  #cleanObject(obj) {
    Object.keys(obj).forEach(key => {
      if (obj[key] === undefined || obj[key] === null) {
        delete obj[key]
      }
    })

    return obj
  }

  // Some stricter v1 endpoints validate certain flags as the numeric enum 0/1 and reject the
  // boolean strings "true"/"false". Convert booleans to 1/0; leave undefined/null untouched so
  // the surrounding cleanup can drop them.
  #toNumericFlag(value) {
    if (typeof value === 'boolean') return value ? 1 : 0

    return value
  }

  /**
     * Parses a date/time string and returns formatted date and time for Pipedrive API
     * @param {String} dateTimeString - Date/time string in various formats
     * @returns {{due_date: String|null, due_time: String|null}} - Formatted date (YYYY-MM-DD) and time (HH:MM)
     */
  #parseDateTimeForPipedrive(dateTimeString) {
    if (!dateTimeString) {
      return { due_date: null, due_time: null }
    }

    try {
      let datetime

      // If it's already in ISO format or a valid date string, parse it
      if (typeof dateTimeString === 'string') {
        // Handle date-only format (YYYY-MM-DD)
        if (dateTimeString.match(/^\d{4}-\d{2}-\d{2}$/)) {
          // Date only, set time to noon UTC to avoid timezone issues
          datetime = new Date(`${ dateTimeString }T12:00:00Z`)
        } else if (dateTimeString.includes('T') && !dateTimeString.includes('Z') && !dateTimeString.match(/[+-]\d{2}:\d{2}$/)) {
          // Handle ISO format with T but no timezone
          datetime = new Date(`${ dateTimeString }Z`)
        } else if (dateTimeString.match(/^\d+$/)) {
          // Handle timestamp (number as string)
          datetime = new Date(parseInt(dateTimeString, 10))
        } else {
          // Try to parse as-is
          datetime = new Date(dateTimeString)
        }
      } else if (typeof dateTimeString === 'number') {
        // Handle Unix timestamp
        datetime = new Date(dateTimeString)
      } else {
        datetime = new Date(dateTimeString)
      }

      // Check if the date is valid
      if (isNaN(datetime.getTime())) {
        logger.warn(`Invalid date/time format: ${ dateTimeString }`)

        return { due_date: null, due_time: null }
      }

      // Format date as YYYY-MM-DD
      const due_date = datetime.toISOString().split('T')[0]
      // Format time as HH:MM
      const due_time = datetime.toISOString().split('T')[1].substring(0, 5)

      return { due_date, due_time }
    } catch (error) {
      logger.error(`Error parsing date/time: ${ dateTimeString }`, error)

      return { due_date: null, due_time: null }
    }
  }

    
  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)

    return `${ OAUTH_URL }?${ params.toString() }`
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   * @property {String} token - The access token
   * @property {String} refreshToken - The refresh token
   * @property {Number} expirationInSeconds - Token expiration time in seconds
   * @property {String} connectionIdentityName - User's display name
   * @property {String} [connectionIdentityImageURL] - User's profile picture URL
   * @property {Boolean} overwrite - Whether to overwrite existing connection
   * @property {Object} userData - Complete user data from Pipedrive
   */

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    try {
      // Exchange authorization code for tokens
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code: callbackObject.code,
        redirect_uri: callbackObject.redirectURI,
      })

      const tokenResponse = await Flowrunner.Request.post(TOKEN_URL)
        .set(this.#getBasicAuthHeader())
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      // Get user information
      const userInfoUrl = `${ API_BASE_URL }/users/me`
      const userResponse = await Flowrunner.Request.get(userInfoUrl).set({
        Authorization: `Bearer ${ tokenResponse.access_token }`,
      })

      const userData = userResponse.data

      return {
        token: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        expirationInSeconds: tokenResponse.expires_in || 3600,
        connectionIdentityName: userData.name || userData.email || 'Pipedrive User',
        connectionIdentityImageURL: userData.icon_url,
        overwrite: true,
        userData: userData,
      }
    } catch (error) {
      throw new Error(`OAuth callback execution failed: ${ error.message }`)
    }
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   * @property {String} token - The new access token
   * @property {Number} expirationInSeconds - Token expiration time in seconds
   * @property {String} [refreshToken] - The new refresh token (if provided)
   */

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    try {
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      })

      const response = await Flowrunner.Request.post(TOKEN_URL)
        .set(this.#getBasicAuthHeader())
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      return {
        token: response.access_token,
        expirationInSeconds: response.expires_in || 3600,
        refreshToken: response.refresh_token,
      }
    } catch (error) {
      throw new Error(`Token refresh failed: ${ error.message }`)
    }
  }

  /**
   * @description Retrieves information about the current authenticated user
   * @route GET /get-current-user
   * @operationName Get Current User
   * @category User Management
   * @appearanceColor #2f97e8 #1a7dc4
   *
   * @returns {Object}
   * @sampleResult {"id":12345,"name":"John Doe","email":"john.doe@example.com","phone":"1234567890","active_flag":true,"is_admin":1,"role_id":1,"has_created_company":true,"default_currency":"USD","locale":"en_US","lang":1,"timezone_name":"America/New_York","timezone_offset":"-05:00","icon_url":"https://cdn.pipedrive.com/avatars/1234.jpg","is_you":true,"company_id":67890,"company_name":"Example Corp","company_domain":"example.com","company_country":"US","company_industry":"Software"}
   */
  async getCurrentUser() {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/users/me`,
    })

    return response.data
  }


  // ======================================== DICTIONARIES ========================================


  #filterByName(items, search) {
    if (!search) {
      return items
    }

    const term = String(search).toLowerCase()

    return items.filter(item => String(item.name || '').toLowerCase().includes(term))
  }

  /**
   * @typedef {Object} getPipelinesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter pipelines by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Pipelines
   * @category Pipelines
   * @description Retrieves all pipelines so a pipeline can be selected from a list.
   * @route POST /get-pipelines-dictionary
   *
   * @paramDef {"type":"getPipelinesDictionary__payload","label":"Payload","name":"payload","description":"Contains an optional search string and pagination cursor."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Sales Pipeline","value":"1","note":"ID: 1"}],"cursor":null}
   */
  async getPipelinesDictionary({ search } = {}) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/pipelines`,
      method: 'get',
    })

    const pipelines = this.#filterByName(response.data || [], search)

    return {
      items: pipelines.map(pipeline => ({
        label: pipeline.name,
        value: pipeline.id,
        note: `ID: ${ pipeline.id }`,
      })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getStagesDictionary__payloadCriteria
   * @paramDef {"type":"Number","label":"Pipeline","name":"pipeline_id","description":"Optional pipeline to restrict the stages to."}
   */

  /**
   * @typedef {Object} getStagesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter stages by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   * @paramDef {"type":"getStagesDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Optional pipeline selection to restrict the stages."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Stages
   * @category Stages
   * @description Retrieves stages so a stage can be selected from a list, optionally restricted to a pipeline.
   * @route POST /get-stages-dictionary
   *
   * @paramDef {"type":"getStagesDictionary__payload","label":"Payload","name":"payload","description":"Contains an optional search string, pagination cursor, and pipeline criteria."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Qualified","value":"2","note":"Pipeline: 1"}],"cursor":null}
   */
  async getStagesDictionary({ search, criteria } = {}) {
    const pipelineId = criteria?.pipeline_id

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/stages`,
      method: 'get',
      query: pipelineId ? { pipeline_id: pipelineId } : undefined,
    })

    const stages = this.#filterByName(response.data || [], search)

    return {
      items: stages.map(stage => ({
        label: stage.name,
        value: stage.id,
        note: `Pipeline: ${ stage.pipeline_id }`,
      })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getUsersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter users by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Users
   * @category Users
   * @description Retrieves all users so a user can be selected from a list.
   * @route POST /get-users-dictionary
   *
   * @paramDef {"type":"getUsersDictionary__payload","label":"Payload","name":"payload","description":"Contains an optional search string and pagination cursor."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"John Doe","value":"12345","note":"john.doe@example.com"}],"cursor":null}
   */
  async getUsersDictionary({ search } = {}) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/users`,
      method: 'get',
    })

    const users = this.#filterByName(response.data || [], search)

    return {
      items: users.map(user => ({
        label: user.name,
        value: user.id,
        note: user.email || `ID: ${ user.id }`,
      })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getPersonsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter persons by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (offset) for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Persons
   * @category Persons
   * @description Retrieves persons so a person can be selected from a list.
   * @route POST /get-persons-dictionary
   *
   * @paramDef {"type":"getPersonsDictionary__payload","label":"Payload","name":"payload","description":"Contains an optional search string and pagination cursor."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Jane Smith","value":"101","note":"ID: 101"}],"cursor":100}
   */
  async getPersonsDictionary({ search, cursor } = {}) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/persons`,
      method: 'get',
      query: { start: cursor || 0, limit: 100 },
    })

    const persons = this.#filterByName(response.data || [], search)
    const pagination = response.additional_data?.pagination

    return {
      items: persons.map(person => ({
        label: person.name,
        value: person.id,
        note: `ID: ${ person.id }`,
      })),
      cursor: pagination?.more_items_in_collection ? pagination.next_start : null,
    }
  }

  /**
   * @typedef {Object} getOrganizationsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter organizations by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (offset) for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Organizations
   * @category Organizations
   * @description Retrieves organizations so an organization can be selected from a list.
   * @route POST /get-organizations-dictionary
   *
   * @paramDef {"type":"getOrganizationsDictionary__payload","label":"Payload","name":"payload","description":"Contains an optional search string and pagination cursor."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Example Corp","value":"201","note":"ID: 201"}],"cursor":100}
   */
  async getOrganizationsDictionary({ search, cursor } = {}) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/organizations`,
      method: 'get',
      query: { start: cursor || 0, limit: 100 },
    })

    const organizations = this.#filterByName(response.data || [], search)
    const pagination = response.additional_data?.pagination

    return {
      items: organizations.map(organization => ({
        label: organization.name,
        value: organization.id,
        note: `ID: ${ organization.id }`,
      })),
      cursor: pagination?.more_items_in_collection ? pagination.next_start : null,
    }
  }


  // ======================================== ACTIVITIES ========================================


  /**
   * @description Adds a new activity.
   * @route POST /activities
   * @operationName Create Activity
   * @category Activities
   *
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"The subject or title of the record.","required":false}
   * @paramDef {"type":"String","label":"Type","name":"type","description":"The type of the record.","required":false}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","description":"The date when the activity is due (YYYY-MM-DD).","uiComponent":{"type":"DATE_PICKER"},"required":false}
   * @paramDef {"type":"String","label":"Due Time","name":"dueTime","description":"The time when the activity is due (HH:MM).","required":false}
   * @paramDef {"type":"String","label":"Duration","name":"duration","description":"The duration of the activity (HH:MM).","required":false}
   * @paramDef {"type":"String","label":"Note","name":"note","description":"Content of the note in HTML format.","uiComponent":{"type":"MULTI_LINE_TEXT"},"required":false}
   * @paramDef {"type":"Number","label":"Deal","name":"deal_id","description":"The deal associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Person","name":"person_id","dictionary":"getPersonsDictionary","description":"The person associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Organization","name":"org_id","dictionary":"getOrganizationsDictionary","description":"The organization associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"User","name":"user_id","dictionary":"getUsersDictionary","description":"The user associated with this record. If omitted, uses the authenticated user.","required":false}
   * @paramDef {"type":"Boolean","label":"Mark as Done","name":"done","description":"Whether the activity is completed.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"String","label":"Location","name":"location","description":"The location of the activity (address, meeting room, etc.).","required":false}
   * @paramDef {"type":"String","label":"Participants","name":"participants","description":"List of participants for the activity.","required":false}
   * @paramDef {"type":"Boolean","label":"Busy Flag","name":"busy_flag","description":"Mark the activity time as busy.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"String","label":"Attendees","name":"attendees","description":"Attendees for the activity.","required":false}
   * @paramDef {"type":"String","label":"Public Description","name":"public_description","description":"Public description of the activity.","uiComponent":{"type":"MULTI_LINE_TEXT"},"required":false}
   *
   * @returns {Object}
   * @sampleResult {"id":501,"subject":"Follow-up call","type":"call","done":false,"due_date":"2024-02-01","due_time":"14:00","duration":"00:30","deal_id":1,"person_id":101,"org_id":201,"user_id":12345,"add_time":"2024-01-15 10:30:00","update_time":"2024-01-15 10:30:00","marked_as_done_time":null,"active_flag":true,"busy_flag":false,"location":"Conference Room A"}
   */
  async createActivity(subject, type, dueDate, dueTime, duration, note, dealId, personId, orgId, userId, done, location, participants, busyFlag, attendees, publicDescription) {
    const body = {
      subject,
      type,
      due_date: dueDate,
      due_time: dueTime,
      duration,
      note,
      deal_id: dealId,
      person_id: personId,
      org_id: orgId,
      user_id: userId,
      done,
      location,
      participants,
      busy_flag: busyFlag,
      attendees,
      public_description: publicDescription,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/activities`,
      method: 'post',
      body,
    })

    return response.data
  }

  /**
   * @description Returns details of a specific activity.
   * @route GET /activities/:id
   * @operationName Get Activity
   * @category Activities
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   * @sampleResult {"id":501,"subject":"Follow-up call","type":"call","done":false,"due_date":"2024-02-01","due_time":"14:00","duration":"00:30","deal_id":1,"person_id":101,"org_id":201,"user_id":12345,"add_time":"2024-01-15 10:30:00","update_time":"2024-01-18 09:00:00","marked_as_done_time":null,"active_flag":true,"busy_flag":false,"location":"Conference Room A","note":"Discuss contract renewal"}
   */
  async getActivity(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/activities/${ id }`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Updates the properties of an activity.
   * @route PUT /activities/:id
   * @operationName Update Activity
   * @category Activities
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"The subject or title of the record.","required":false}
   * @paramDef {"type":"String","label":"Type","name":"type","description":"The type of the record.","required":false}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","description":"The date when the activity is due (YYYY-MM-DD).","uiComponent":{"type":"DATE_PICKER"},"required":false}
   * @paramDef {"type":"String","label":"Due Time","name":"dueTime","description":"The time when the activity is due (HH:MM).","required":false}
   * @paramDef {"type":"String","label":"Duration","name":"duration","description":"The duration of the activity (HH:MM).","required":false}
   * @paramDef {"type":"String","label":"Note","name":"note","description":"Content of the note in HTML format.","uiComponent":{"type":"MULTI_LINE_TEXT"},"required":false}
   * @paramDef {"type":"Number","label":"Deal","name":"deal_id","description":"The deal associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Person","name":"person_id","dictionary":"getPersonsDictionary","description":"The person associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Organization","name":"org_id","dictionary":"getOrganizationsDictionary","description":"The organization associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"User","name":"user_id","dictionary":"getUsersDictionary","description":"The user associated with this record. If omitted, uses the authenticated user.","required":false}
   * @paramDef {"type":"Boolean","label":"Mark as Done","name":"done","description":"Whether the activity is completed.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"String","label":"Location","name":"location","description":"The location of the activity (address, meeting room, etc.).","required":false}
   * @paramDef {"type":"String","label":"Participants","name":"participants","description":"List of participants for the activity.","required":false}
   * @paramDef {"type":"Boolean","label":"Busy Flag","name":"busy_flag","description":"Mark the activity time as busy.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"String","label":"Attendees","name":"attendees","description":"Attendees for the activity.","required":false}
   * @paramDef {"type":"String","label":"Public Description","name":"public_description","description":"Public description of the activity.","uiComponent":{"type":"MULTI_LINE_TEXT"},"required":false}
   *
   * @returns {Object}
   * @sampleResult {"id":501,"subject":"Follow-up call (rescheduled)","type":"call","done":true,"due_date":"2024-02-02","due_time":"15:00","duration":"00:45","deal_id":1,"person_id":101,"org_id":201,"user_id":12345,"add_time":"2024-01-15 10:30:00","update_time":"2024-01-25 16:00:00","marked_as_done_time":"2024-01-25 16:00:00","active_flag":true,"busy_flag":true,"location":"Conference Room B"}
   */
  async updateActivity(id, subject, type, dueDate, dueTime, duration, note, dealId, personId, orgId, userId, done, location, participants, busyFlag, attendees, publicDescription) {
    const body = {
      subject,
      type,
      due_date: dueDate,
      due_time: dueTime,
      duration,
      note,
      deal_id: dealId,
      person_id: personId,
      org_id: orgId,
      user_id: userId,
      done,
      location,
      participants,
      busy_flag: busyFlag,
      attendees,
      public_description: publicDescription,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/activities/${ id }`,
      method: 'put',
      body,
    })

    return response.data
  }

  /**
   * @description Marks an activity as deleted.
   * @route DELETE /activities/:id
   * @operationName Delete Activity
   * @category Activities
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async deleteActivity(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/activities/${ id }`,
      method: 'delete',
    })

    return response.data
  }

  /**
   * @description Returns all activities.
   * @route GET /activities
   * @operationName List Activities
   * @category Activities
   *
   * @paramDef {"type":"Number","label":"User","name":"user_id","dictionary":"getUsersDictionary","description":"The user associated with this record. If omitted, uses the authenticated user.","required":false}
   * @paramDef {"type":"Number","label":"Filter","name":"filter_id","description":"Identifier of the filter to apply.","required":false}
   * @paramDef {"type":"String","label":"Type","name":"type","description":"The type of the record.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Start Date and Time","name":"startDateTime","description":"Start date and time for filtering results. Will be automatically formatted for Pipedrive.","uiComponent":{"type":"DATE_TIME_PICKER"},"required":false}
   * @paramDef {"type":"Number","label":"End Date and Time","name":"endDateTime","description":"End date and time for filtering results. Will be automatically formatted for Pipedrive.","uiComponent":{"type":"DATE_TIME_PICKER"},"required":false}
   * @paramDef {"type":"Boolean","label":"Mark as Done","name":"done","description":"Whether the activity is completed.","uiComponent":{"type":"TOGGLE"},"required":false}
   *
   * @returns {Object}
   * @sampleResult [{"id":501,"subject":"Follow-up call","type":"call","done":false,"due_date":"2024-02-01","due_time":"14:00","deal_id":1,"person_id":101,"org_id":201,"user_id":12345,"add_time":"2024-01-15 10:30:00","active_flag":true},{"id":502,"subject":"Send proposal","type":"task","done":true,"due_date":"2024-01-20","due_time":"","deal_id":2,"person_id":102,"org_id":202,"user_id":12345,"add_time":"2024-01-12 09:00:00","marked_as_done_time":"2024-01-19 17:00:00","active_flag":true}]
   */
  async listActivities(userId, filterId, type, limit, start, startDate, endDate, done) {
    const query = {
      user_id: userId,
      filter_id: filterId,
      type,
      limit,
      start,
      start_date: startDate,
      end_date: endDate,
      done,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/activities`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Marks multiple activities as deleted.
   * @route DELETE /activities
   * @operationName Delete Activities
   * @category Activities
   *
   * @paramDef {"type":"String","label":"Identifiers","name":"ids","description":"Comma-separated list of IDs.","required":true}
   *
   * @returns {Object}
   */
  async deleteActivities(ids) {
    const query = { ids: Array.isArray(ids) ? ids.join(',') : ids }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/activities`,
      method: 'delete',
      query,
    })

    return response.data
  }


  // ======================================== ACTIVITYFIELDS ========================================


  /**
   * @description Returns all activity fields.
   * @route GET /activityFields
   * @operationName List Activity Fields
   * @category ActivityFields
   *
   * @returns {Object}
   */
  async listActivityFields() {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/activityFields`,
      method: 'get',
    })

    return response.data
  }


  // ======================================== ACTIVITYTYPES ========================================


  /**
   * @description Returns all activity types.
   * @route GET /activityTypes
   * @operationName List Activity Types
   * @category ActivityTypes
   *
   * @returns {Object}
   */
  async listActivityTypes() {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/activityTypes`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Adds a new activity type.
   * @route POST /activityTypes
   * @operationName Create Activity Type
   * @category ActivityTypes
   *
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the record.","required":false}
   * @paramDef {"type":"String","label":"Icon Key","name":"icon_key","description":"Icon key for the activity type.","required":false}
   * @paramDef {"type":"String","label":"Color","name":"color","description":"Color code for the activity type.","required":false}
   *
   * @returns {Object}
   */
  async createActivityType(name, iconKey, color) {
    const body = {
      name,
      icon_key: iconKey,
      color,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/activityTypes`,
      method: 'post',
      body,
    })

    return response.data
  }

  /**
   * @description Marks multiple activity types as deleted.
   * @route DELETE /activityTypes
   * @operationName Delete Activity Types
   * @category ActivityTypes
   *
   * @paramDef {"type":"String","label":"Identifiers","name":"ids","description":"Comma-separated list of IDs.","required":true}
   *
   * @returns {Object}
   */
  async deleteActivityTypes(ids) {
    const query = { ids: Array.isArray(ids) ? ids.join(',') : ids }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/activityTypes`,
      method: 'delete',
      query,
    })

    return response.data
  }

  /**
   * @description Marks an activity type as deleted.
   * @route DELETE /activityTypes/:id
   * @operationName Delete Activity Type
   * @category ActivityTypes
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async deleteActivityType(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/activityTypes/${ id }`,
      method: 'delete',
    })

    return response.data
  }

  /**
   * @description Updates the properties of an activity type.
   * @route PUT /activityTypes/:id
   * @operationName Update Activity Type
   * @category ActivityTypes
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the record.","required":false}
   * @paramDef {"type":"String","label":"Icon Key","name":"icon_key","description":"Icon key for the activity type.","required":false}
   * @paramDef {"type":"String","label":"Color","name":"color","description":"Color code for the activity type.","required":false}
   * @paramDef {"type":"Number","label":"Order Number","name":"order_nr","description":"Order number.","required":false}
   *
   * @returns {Object}
   */
  async updateActivityType(id, name, iconKey, color, orderNr) {
    const body = {
      name,
      icon_key: iconKey,
      color,
      order_nr: orderNr,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/activityTypes/${ id }`,
      method: 'put',
      body,
    })

    return response.data
  }


  // ======================================== BILLING ========================================


  /**
   * @description Returns all billing add-ons for the company.
   * @route GET /billing/subscriptions/addons
   * @operationName List Billing Add-ons
   * @category Billing
   *
   * @returns {Object}
   */
  async listBillingAddons() {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/billing/subscriptions/addons`,
      method: 'get',
    })

    return response.data
  }


  // ======================================== CALLLOGS ========================================


  /**
   * @description Returns all call logs.
   * @route GET /callLogs
   * @operationName List Call Logs
   * @category CallLogs
   *
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async listCallLogs(start, limit) {
    const query = { start, limit }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/callLogs`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Adds a new call log.
   * @route POST /callLogs
   * @operationName Create Call Log
   * @category CallLogs
   *
   * @paramDef {"type":"String","label":"To Phone Number","name":"to_phone_number","description":"Phone number the call was made to.","required":true}
   * @paramDef {"type":"String","label":"Outcome","name":"outcome","description":"Outcome of the call.","required":true}
   * @paramDef {"type":"String","label":"Call Start Time","name":"start_time","description":"The time when the call started (ISO 8601 format or HH:MM).","required":true}
   * @paramDef {"type":"String","label":"Call End Time","name":"end_time","description":"The time when the call ended (ISO 8601 format or HH:MM).","required":true}
   * @paramDef {"type":"Number","label":"User","name":"user_id","dictionary":"getUsersDictionary","description":"The user associated with this record. If omitted, uses the authenticated user.","required":false}
   * @paramDef {"type":"Number","label":"Activity","name":"activity_id","description":"The activity associated with this record.","required":false}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"The subject or title of the record.","required":false}
   * @paramDef {"type":"String","label":"Duration","name":"duration","description":"The duration of the activity (HH:MM).","required":false}
   * @paramDef {"type":"String","label":"From Phone Number","name":"from_phone_number","description":"Phone number the call was made from.","required":false}
   * @paramDef {"type":"Number","label":"Person","name":"person_id","dictionary":"getPersonsDictionary","description":"The person associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Organization","name":"org_id","dictionary":"getOrganizationsDictionary","description":"The organization associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Deal","name":"deal_id","description":"The deal associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Lead","name":"lead_id","description":"Identifier of the lead.","required":false}
   * @paramDef {"type":"String","label":"Note","name":"note","description":"Content of the note in HTML format.","uiComponent":{"type":"MULTI_LINE_TEXT"},"required":false}
   *
   * @returns {Object}
   */
  async createCallLog(toPhoneNumber, outcome, startTime, endTime, userId, activityId, subject, duration, fromPhoneNumber, personId, orgId, dealId, leadId, note) {
    const body = {
      to_phone_number: toPhoneNumber,
      outcome,
      start_time: startTime,
      end_time: endTime,
      user_id: userId,
      activity_id: activityId,
      subject,
      duration,
      from_phone_number: fromPhoneNumber,
      person_id: personId,
      org_id: orgId,
      deal_id: dealId,
      lead_id: leadId,
      note,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/callLogs`,
      method: 'post',
      body,
    })

    return response.data
  }

  /**
   * @description Returns details of a specific call log.
   * @route GET /callLogs/:id
   * @operationName Get Call Log
   * @category CallLogs
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async getCallLog(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/callLogs/${ id }`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Marks a call log as deleted.
   * @route DELETE /callLogs/:id
   * @operationName Delete Call Log
   * @category CallLogs
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async deleteCallLog(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/callLogs/${ id }`,
      method: 'delete',
    })

    return response.data
  }

  /**
   * @description Attaches an audio recording to the call log.
   * @route POST /callLogs/:id/recordings
   * @operationName Attach Call Log Recording
   * @category CallLogs
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"String","label":"File","name":"file","description":"The file to upload.","required":true}
   *
   * @returns {Object}
   */
  async attachCallLogRecording(id, file) {
    const body = { file }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/callLogs/${ id }/recordings`,
      method: 'post',
      body,
    })

    return response.data
  }


  // ======================================== CHANNELS ========================================


  /**
   * @description Adds a new channel.
   * @route POST /channels
   * @operationName Create channel
   * @category Channels
   *
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the record.","required":false}
   * @paramDef {"type":"Number","label":"Provider Channel","name":"provider_channel_id","description":"Identifier of the provider channel.","required":false}
   * @paramDef {"type":"String","label":"Avatar URL","name":"avatar_url","description":"URL of the user avatar image.","required":false}
   * @paramDef {"type":"Boolean","label":"Template Support","name":"template_support","description":"Whether template support is enabled.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"String","label":"Provider Type","name":"provider_type","description":"Type of the provider.","required":false}
   *
   * @returns {Object}
   */
  async createChannel(name, providerChannelId, avatarUrl, templateSupport, providerType) {
    const body = { name: name, provider_channel_id: providerChannelId, avatar_url: avatarUrl, template_support: templateSupport, provider_type: providerType }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/channels`,
      method: 'post',
      body: Object.keys(body).length ? body : undefined,
    })

    return response.data
  }

  /**
   * @description Marks a channel as deleted.
   * @route DELETE /channels/:id
   * @operationName Delete channel
   * @category Channels
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":false}
   *
   * @returns {Object}
   */
  async deleteChannel(id) {

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/channels/${ id }`,
      method: 'delete',
    })

    return response.data
  }

  /**
   * @description Adds a message to a conversation. To use the endpoint, you need to have **Messengers integration** O...
   * @route POST /channels/messages/receive
   * @operationName Receives incoming message
   * @category Channels
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":false}
   * @paramDef {"type":"String","label":"Channel","name":"channel_id","description":"The channel identifier.","required":true}
   * @paramDef {"type":"Number","label":"Sender","name":"sender_id","description":"Identifier of the message sender.","required":false}
   * @paramDef {"type":"Number","label":"Conversation","name":"conversation_id","description":"Identifier of the conversation.","required":true}
   * @paramDef {"type":"String","label":"Message","name":"message","description":"Message content.","required":false}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"The status of the record.","uiComponent":{"type":"DROPDOWN","options":{"values":[]}},"required":false}
   * @paramDef {"type":"String","label":"Created At","name":"created_at","description":"Timestamp when the item was created.","required":false}
   * @paramDef {"type":"String","label":"Reply By","name":"reply_by","description":"Expected reply deadline.","required":false}
   * @paramDef {"type":"String","label":"Conversation Link","name":"conversation_link","description":"Link to the conversation.","required":false}
   * @paramDef {"type":"String","label":"Attachments","name":"attachments","description":"Attachments for the item.","required":false}
   *
   * @returns {Object}
   */
  async receivesIncomingMessage(id, channelId, senderId, conversationId, message, status, createdAt, replyBy, conversationLink, attachments) {
    const body = { id: id, channel_id: channelId, sender_id: senderId, conversation_id: conversationId, message: message, status: status, created_at: createdAt, reply_by: replyBy, conversation_link: conversationLink, attachments: attachments }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/channels/messages/receive`,
      method: 'post',
      body: Object.keys(body).length ? body : undefined,
    })

    return response.data
  }

  /**
   * @description Marks a channel as deleted.
   * @route DELETE /channels/:channel-id/conversations/:conversation-id
   * @operationName Delete conversation
   * @category Channels
   *
   * @paramDef {"type":"String","label":"Channel","name":"channel_id","description":"The channel identifier.","required":true}
   * @paramDef {"type":"Number","label":"Conversation","name":"conversation_id","description":"Identifier of the conversation.","required":true}
   *
   * @returns {Object}
   */
  async deleteConversation(channelId, conversationId) {

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/channels/${ channelId }-id/conversations/${ conversationId }-id`,
      method: 'delete',
    })

    return response.data
  }


  // ======================================== CURRENCIES ========================================


  /**
   * @description Returns all supported currencies.
   * @route GET /currencies
   * @operationName List Currencies
   * @category Currencies
   *
   * @paramDef {"type":"String","label":"Search Term","name":"term","description":"The term to search for.","required":false}
   *
   * @returns {Object}
   */
  async listCurrencies(term) {
    const query = { term }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/currencies`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }


  // ======================================== DEALFIELDS ========================================


  /**
   * @description Returns all deal fields.
   * @route GET /dealFields
   * @operationName List Deal Fields
   * @category DealFields
   *
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async listDealFields(start, limit) {
    const query = { start, limit }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/dealFields`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Adds a new deal field.
   * @route POST /dealFields
   * @operationName Create Deal Field
   * @category DealFields
   *
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the record.","required":false}
   * @paramDef {"type":"String","label":"Field Type","name":"field_type","description":"Type of the field.","required":true}
   * @paramDef {"type":"String","label":"Options","name":"options","description":"Options for the field (JSON array).","required":false}
   * @paramDef {"type":"Boolean","label":"Add Visible Flag","name":"add_visible_flag","description":"Whether the field is visible in add dialogs.","uiComponent":{"type":"TOGGLE"},"required":false}
   *
   * @returns {Object}
   */
  async createDealField(fieldType, name, options, addVisibleFlag) {
    const body = {
      field_type: fieldType,
      name,
      options,
      add_visible_flag: addVisibleFlag,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/dealFields`,
      method: 'post',
      body,
    })

    return response.data
  }

  /**
   * @description Marks multiple deal fields as deleted.
   * @route DELETE /dealFields
   * @operationName Delete Deal Fields
   * @category DealFields
   *
   * @paramDef {"type":"String","label":"Identifiers","name":"ids","description":"Comma-separated list of IDs.","required":true}
   *
   * @returns {Object}
   */
  async deleteDealFields(ids) {
    const query = { ids: Array.isArray(ids) ? ids.join(',') : ids }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/dealFields`,
      method: 'delete',
      query,
    })

    return response.data
  }

  /**
   * @description Returns details of a specific deal field.
   * @route GET /dealFields/:id
   * @operationName Get Deal Field
   * @category DealFields
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async getDealField(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/dealFields/${ id }`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Marks a deal field as deleted.
   * @route DELETE /dealFields/:id
   * @operationName Delete Deal Field
   * @category DealFields
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async deleteDealField(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/dealFields/${ id }`,
      method: 'delete',
    })

    return response.data
  }

  /**
   * @description Updates the properties of a deal field.
   * @route PUT /dealFields/:id
   * @operationName Update Deal Field
   * @category DealFields
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the record.","required":false}
   * @paramDef {"type":"String","label":"Options","name":"options","description":"Options for the field (JSON array).","required":false}
   * @paramDef {"type":"Boolean","label":"Add Visible Flag","name":"add_visible_flag","description":"Whether the field is visible in add dialogs.","uiComponent":{"type":"TOGGLE"},"required":false}
   *
   * @returns {Object}
   */
  async updateDealField(id, name, options, addVisibleFlag) {
    const body = {
      name,
      options,
      add_visible_flag: addVisibleFlag,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/dealFields/${ id }`,
      method: 'put',
      body,
    })

    return response.data
  }


  // ======================================== DEALS ========================================


  /**
   * @description Returns all deals.
   * @route GET /deals
   * @operationName List Deals
   * @category Deals
   *
   * @paramDef {"type":"Number","label":"User","name":"user_id","dictionary":"getUsersDictionary","description":"The user associated with this record. If omitted, uses the authenticated user.","required":false}
   * @paramDef {"type":"Number","label":"Filter","name":"filter_id","description":"Identifier of the filter to apply.","required":false}
   * @paramDef {"type":"Number","label":"Stage","name":"stage_id","dictionary":"getStagesDictionary","description":"The stage associated with this record.","required":false}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"The status of the record.","uiComponent":{"type":"DROPDOWN","options":{"values":[]}},"required":false}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   * @paramDef {"type":"String","label":"Sort By","name":"sort","description":"Field to sort by (e.g., \"id DESC\").","required":false}
   * @paramDef {"type":"String","label":"Owned By You","name":"owned_by_you","description":"Filter for items owned by current user.","required":false}
   *
   * @returns {Object}
   * @sampleResult [{"id":1,"title":"New Business Deal","value":5000,"currency":"USD","status":"open","stage_id":1,"pipeline_id":1,"person_id":101,"org_id":201,"user_id":12345,"add_time":"2024-01-15 10:30:00","update_time":"2024-01-20 14:05:00","active":true},{"id":2,"title":"Renewal Contract","value":12000,"currency":"USD","status":"won","stage_id":4,"pipeline_id":1,"person_id":102,"org_id":202,"user_id":12345,"add_time":"2024-01-10 08:15:00","update_time":"2024-01-22 16:30:00","active":false}]
   */
  async listDeals(userId, filterId, stageId, status, start, limit, sort, ownedByYou) {
    const query = {
      user_id: userId,
      filter_id: filterId,
      stage_id: stageId,
      status,
      start,
      limit,
      sort,
      owned_by_you: ownedByYou,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Adds a new deal.
   * @route POST /deals
   * @operationName Create Deal
   * @category Deals
   *
   * @paramDef {"type":"String","label":"Title","name":"title","description":"The title of the record.","required":true}
   * @paramDef {"type":"String","label":"Value","name":"value","description":"The monetary value of the deal.","required":false}
   * @paramDef {"type":"String","label":"Currency","name":"currency","description":"The currency of the deal value.","required":false}
   * @paramDef {"type":"Number","label":"User","name":"user_id","dictionary":"getUsersDictionary","description":"The user associated with this record. If omitted, uses the authenticated user.","required":false}
   * @paramDef {"type":"Number","label":"Person","name":"person_id","dictionary":"getPersonsDictionary","description":"The person associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Organization","name":"org_id","dictionary":"getOrganizationsDictionary","description":"The organization associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Stage","name":"stage_id","dictionary":"getStagesDictionary","description":"The stage associated with this record.","required":false}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"The status of the record.","uiComponent":{"type":"DROPDOWN","options":{"values":[]}},"required":false}
   * @paramDef {"type":"String","label":"Expected Close Date","name":"expected_close_date","description":"The expected close date of the deal (YYYY-MM-DD).","uiComponent":{"type":"DATE_PICKER"},"required":false}
   * @paramDef {"type":"Number","label":"Probability","name":"probability","description":"Success probability percentage (0-100).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":100,"step":1},"required":false}
   * @paramDef {"type":"String","label":"Lost Reason","name":"lost_reason","description":"The reason why the deal was lost.","required":false}
   * @paramDef {"type":"String","label":"Visible To","name":"visible_to","description":"Visibility of the record.","uiComponent":{"type":"DROPDOWN","options":{"values":["Owner & followers (private)","Entire company"]}},"required":false}
   * @paramDef {"type":"String","label":"Created At","name":"add_time","description":"The creation date and time of the record (UTC).","required":false}
   * @paramDef {"type":"Number","label":"Pipeline","name":"pipeline_id","dictionary":"getPipelinesDictionary","description":"The pipeline associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Label","name":"label","description":"Label identifier.","required":false}
   *
   * @returns {Object}
   * @sampleResult {"id":1,"title":"New Business Deal","value":5000,"currency":"USD","status":"open","stage_id":1,"pipeline_id":1,"person_id":101,"org_id":201,"user_id":12345,"probability":50,"add_time":"2024-01-15 10:30:00","update_time":"2024-01-15 10:30:00","stage_change_time":null,"active":true,"deleted":false,"won_time":null,"lost_time":null,"close_time":null,"expected_close_date":"2024-02-15"}
   */
  async createDeal(title, value, currency, userId, personId, orgId, stageId, status, expectedCloseDate, probability, lostReason, visibleTo, addTime, pipelineId, label) {
    const body = {
      title,
      value,
      currency,
      user_id: userId,
      person_id: personId,
      org_id: orgId,
      stage_id: stageId,
      status,
      expected_close_date: expectedCloseDate,
      probability,
      lost_reason: lostReason,
      visible_to: this.#resolveChoice(visibleTo, VISIBLE_TO_MAP),
      add_time: addTime,
      pipeline_id: pipelineId,
      label,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals`,
      method: 'post',
      body,
    })

    return response.data
  }

  /**
   * @description Marks multiple deals as deleted.
   * @route DELETE /deals
   * @operationName Delete Deals
   * @category Deals
   *
   * @paramDef {"type":"String","label":"Identifiers","name":"ids","description":"Comma-separated list of IDs.","required":true}
   *
   * @returns {Object}
   */
  async deleteDeals(ids) {
    const query = { ids: Array.isArray(ids) ? ids.join(',') : ids }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals`,
      method: 'delete',
      query,
    })

    return response.data
  }

  /**
   * @description Returns all archived deals.
   * @route GET /deals/archived
   * @operationName List Archived Deals
   * @category Deals
   *
   * @paramDef {"type":"Number","label":"User","name":"user_id","dictionary":"getUsersDictionary","description":"The user associated with this record. If omitted, uses the authenticated user.","required":false}
   * @paramDef {"type":"Number","label":"Filter","name":"filter_id","description":"Identifier of the filter to apply.","required":false}
   * @paramDef {"type":"Number","label":"Person","name":"person_id","dictionary":"getPersonsDictionary","description":"The person associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Organization","name":"org_id","dictionary":"getOrganizationsDictionary","description":"The organization associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Stage","name":"stage_id","dictionary":"getStagesDictionary","description":"The stage associated with this record.","required":false}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"The status of the record.","uiComponent":{"type":"DROPDOWN","options":{"values":[]}},"required":false}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   * @paramDef {"type":"String","label":"Sort By","name":"sort","description":"Field to sort by (e.g., \"id DESC\").","required":false}
   * @paramDef {"type":"String","label":"Owned By You","name":"owned_by_you","description":"Filter for items owned by current user.","required":false}
   *
   * @returns {Object}
   */
  async listArchivedDeals(userId, filterId, personId, orgId, stageId, status, start, limit, sort, ownedByYou) {
    const query = {
      user_id: userId,
      filter_id: filterId,
      person_id: personId,
      org_id: orgId,
      stage_id: stageId,
      status,
      start,
      limit,
      sort,
      owned_by_you: ownedByYou,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/archived`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Returns all deals.
   * @route GET /deals/collection
   * @operationName List Deals Collection
   * @category Deals
   *
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving next page of results.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   * @paramDef {"type":"String","label":"Since","name":"since","description":"Timestamp to filter items modified since.","required":false}
   * @paramDef {"type":"String","label":"Until","name":"until","description":"Timestamp to filter items modified until.","required":false}
   * @paramDef {"type":"Number","label":"User","name":"user_id","dictionary":"getUsersDictionary","description":"The user associated with this record. If omitted, uses the authenticated user.","required":true}
   * @paramDef {"type":"Number","label":"Stage","name":"stage_id","dictionary":"getStagesDictionary","description":"The stage associated with this record.","required":false}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"The status of the record.","uiComponent":{"type":"DROPDOWN","options":{"values":[]}},"required":false}
   *
   * @returns {Object}
   */
  async listDealsCollection(cursor, limit, since, until, userId, stageId, status) {
    const query = {
      cursor,
      limit,
      since,
      until,
      user_id: userId,
      stage_id: stageId,
      status,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/collection`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Searches all deals.
   * @route GET /deals/search
   * @operationName Search Deals
   * @category Deals
   *
   * @paramDef {"type":"String","label":"Search Term","name":"term","description":"The term to search for.","required":true}
   * @paramDef {"type":"Array","label":"Fields","name":"fields","description":"Array of field names to include in response.","required":false}
   * @paramDef {"type":"String","label":"Exact Match","name":"exact_match","description":"Whether to perform exact matching in search.","required":false}
   * @paramDef {"type":"Number","label":"Person","name":"person_id","dictionary":"getPersonsDictionary","description":"The person associated with this record.","required":true}
   * @paramDef {"type":"Number","label":"Organization","name":"organization_id","description":"The organization associated with this record.","required":false}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"The status of the record.","uiComponent":{"type":"DROPDOWN","options":{"values":[]}},"required":false}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async searchDeals(term, fields, exactMatch, personId, organizationId, status, start, limit) {
    const query = {
      term,
      fields,
      exact_match: exactMatch,
      person_id: personId,
      organization_id: organizationId,
      status,
      start,
      limit,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/search`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Returns a summary of deals.
   * @route GET /deals/summary
   * @operationName Get Deals Summary
   * @category Deals
   *
   * @paramDef {"type":"String","label":"Status","name":"status","description":"The status of the record.","uiComponent":{"type":"DROPDOWN","options":{"values":[]}},"required":false}
   * @paramDef {"type":"Number","label":"Filter","name":"filter_id","description":"Identifier of the filter to apply.","required":false}
   * @paramDef {"type":"Number","label":"User","name":"user_id","dictionary":"getUsersDictionary","description":"The user associated with this record. If omitted, uses the authenticated user.","required":true}
   * @paramDef {"type":"Number","label":"Pipeline","name":"pipeline_id","dictionary":"getPipelinesDictionary","description":"The pipeline associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Stage","name":"stage_id","dictionary":"getStagesDictionary","description":"The stage associated with this record.","required":false}
   *
   * @returns {Object}
   */
  async getDealsSummary(status, filterId, userId, pipelineId, stageId) {
    const query = {
      status,
      filter_id: filterId,
      user_id: userId,
      pipeline_id: pipelineId,
      stage_id: stageId,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/summary`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Returns a summary of archived deals.
   * @route GET /deals/summary/archived
   * @operationName Get Archived Deals Summary
   * @category Deals
   *
   * @paramDef {"type":"String","label":"Status","name":"status","description":"The status of the record.","uiComponent":{"type":"DROPDOWN","options":{"values":[]}},"required":false}
   * @paramDef {"type":"Number","label":"Filter","name":"filter_id","description":"Identifier of the filter to apply.","required":false}
   * @paramDef {"type":"Number","label":"User","name":"user_id","dictionary":"getUsersDictionary","description":"The user associated with this record. If omitted, uses the authenticated user.","required":true}
   * @paramDef {"type":"Number","label":"Pipeline","name":"pipeline_id","dictionary":"getPipelinesDictionary","description":"The pipeline associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Stage","name":"stage_id","dictionary":"getStagesDictionary","description":"The stage associated with this record.","required":false}
   *
   * @returns {Object}
   */
  async getArchivedDealsSummary(status, filterId, userId, pipelineId, stageId) {
    const query = {
      status,
      filter_id: filterId,
      user_id: userId,
      pipeline_id: pipelineId,
      stage_id: stageId,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/summary/archived`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Returns a timeline of deals.
   * @route GET /deals/timeline
   * @operationName Get Deals Timeline
   * @category Deals
   *
   * @paramDef {"type":"Number","label":"Start Date and Time","name":"startDateTime","description":"Start date and time for filtering results. Will be automatically formatted for Pipedrive.","uiComponent":{"type":"DATE_TIME_PICKER"},"required":true}
   * @paramDef {"type":"Number","label":"Interval","name":"interval","description":"Interval for statistics (day, week, month).","required":true}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","description":"Monetary amount.","required":true}
   * @paramDef {"type":"String","label":"Field Key","name":"field_key","description":"Key of the field.","required":true}
   * @paramDef {"type":"Number","label":"User","name":"user_id","dictionary":"getUsersDictionary","description":"The user associated with this record. If omitted, uses the authenticated user.","required":true}
   * @paramDef {"type":"Number","label":"Pipeline","name":"pipeline_id","dictionary":"getPipelinesDictionary","description":"The pipeline associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Filter","name":"filter_id","description":"Identifier of the filter to apply.","required":false}
   * @paramDef {"type":"Number","label":"Exclude Deals","name":"exclude_deals","description":"Deal IDs to exclude from results.","required":false}
   * @paramDef {"type":"String","label":"Totals Convert Currency","name":"totals_convert_currency","description":"Currency to convert totals to.","required":false}
   *
   * @returns {Object}
   */
  async getDealsTimeline(startDate, interval, amount, fieldKey, userId, pipelineId, filterId, excludeDeals, totalsConvertCurrency) {
    const query = {
      start_date: startDate,
      interval,
      amount,
      field_key: fieldKey,
      user_id: userId,
      pipeline_id: pipelineId,
      filter_id: filterId,
      exclude_deals: excludeDeals,
      totals_convert_currency: totalsConvertCurrency,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/timeline`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Returns a timeline of archived deals.
   * @route GET /deals/timeline/archived
   * @operationName Get Archived Deals Timeline
   * @category Deals
   *
   * @paramDef {"type":"Number","label":"Start Date and Time","name":"startDateTime","description":"Start date and time for filtering results. Will be automatically formatted for Pipedrive.","uiComponent":{"type":"DATE_TIME_PICKER"},"required":true}
   * @paramDef {"type":"Number","label":"Interval","name":"interval","description":"Interval for statistics (day, week, month).","required":true}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","description":"Monetary amount.","required":true}
   * @paramDef {"type":"String","label":"Field Key","name":"field_key","description":"Key of the field.","required":true}
   * @paramDef {"type":"Number","label":"User","name":"user_id","dictionary":"getUsersDictionary","description":"The user associated with this record. If omitted, uses the authenticated user.","required":true}
   * @paramDef {"type":"Number","label":"Pipeline","name":"pipeline_id","dictionary":"getPipelinesDictionary","description":"The pipeline associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Filter","name":"filter_id","description":"Identifier of the filter to apply.","required":false}
   * @paramDef {"type":"Number","label":"Exclude Deals","name":"exclude_deals","description":"Deal IDs to exclude from results.","required":false}
   * @paramDef {"type":"String","label":"Totals Convert Currency","name":"totals_convert_currency","description":"Currency to convert totals to.","required":false}
   *
   * @returns {Object}
   */
  async getArchivedDealsTimeline(startDate, interval, amount, fieldKey, userId, pipelineId, filterId, excludeDeals, totalsConvertCurrency) {
    const query = {
      start_date: startDate,
      interval,
      amount,
      field_key: fieldKey,
      user_id: userId,
      pipeline_id: pipelineId,
      filter_id: filterId,
      exclude_deals: excludeDeals,
      totals_convert_currency: totalsConvertCurrency,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/timeline/archived`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Marks a deal as deleted.
   * @route DELETE /deals/:id
   * @operationName Delete Deal
   * @category Deals
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async deleteDeal(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/${ id }`,
      method: 'delete',
    })

    return response.data
  }

  /**
   * @description Returns details of a specific deal.
   * @route GET /deals/:id
   * @operationName Get Deal
   * @category Deals
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   * @sampleResult {"id":1,"title":"New Business Deal","value":5000,"currency":"USD","status":"open","stage_id":1,"pipeline_id":1,"person_id":101,"org_id":201,"user_id":12345,"probability":50,"add_time":"2024-01-15 10:30:00","update_time":"2024-01-20 14:05:00","stage_change_time":"2024-01-18 09:00:00","active":true,"deleted":false,"won_time":null,"lost_time":null,"close_time":null,"expected_close_date":"2024-02-15","activities_count":3,"done_activities_count":1}
   */
  async getDeal(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/${ id }`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Updates the properties of a deal.
   * @route PUT /deals/:id
   * @operationName Update Deal
   * @category Deals
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"The title of the record.","required":false}
   * @paramDef {"type":"String","label":"Value","name":"value","description":"The monetary value of the deal.","required":false}
   * @paramDef {"type":"String","label":"Currency","name":"currency","description":"The currency of the deal value.","required":false}
   * @paramDef {"type":"Number","label":"User","name":"user_id","dictionary":"getUsersDictionary","description":"The user associated with this record. If omitted, uses the authenticated user.","required":false}
   * @paramDef {"type":"Number","label":"Person","name":"person_id","dictionary":"getPersonsDictionary","description":"The person associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Organization","name":"org_id","dictionary":"getOrganizationsDictionary","description":"The organization associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Stage","name":"stage_id","dictionary":"getStagesDictionary","description":"The stage associated with this record.","required":false}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"The status of the record.","uiComponent":{"type":"DROPDOWN","options":{"values":[]}},"required":false}
   * @paramDef {"type":"String","label":"Expected Close Date","name":"expected_close_date","description":"The expected close date of the deal (YYYY-MM-DD).","uiComponent":{"type":"DATE_PICKER"},"required":false}
   * @paramDef {"type":"Number","label":"Probability","name":"probability","description":"Success probability percentage (0-100).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":100,"step":1},"required":false}
   * @paramDef {"type":"String","label":"Lost Reason","name":"lost_reason","description":"The reason why the deal was lost.","required":false}
   * @paramDef {"type":"String","label":"Visible To","name":"visible_to","description":"Visibility of the record.","uiComponent":{"type":"DROPDOWN","options":{"values":["Owner & followers (private)","Entire company"]}},"required":false}
   * @paramDef {"type":"String","label":"Created At","name":"add_time","description":"The creation date and time of the record (UTC).","required":false}
   * @paramDef {"type":"Number","label":"Pipeline","name":"pipeline_id","dictionary":"getPipelinesDictionary","description":"The pipeline associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Label","name":"label","description":"Label identifier.","required":false}
   *
   * @returns {Object}
   * @sampleResult {"id":1,"title":"Updated Deal Title","value":7500,"currency":"USD","status":"open","stage_id":2,"pipeline_id":1,"person_id":101,"org_id":201,"user_id":12345,"probability":75,"add_time":"2024-01-15 10:30:00","update_time":"2024-01-25 11:45:00","active":true,"deleted":false,"won_time":null,"lost_time":null,"close_time":null,"expected_close_date":"2024-02-15"}
   */
  async updateDeal(id, title, value, currency, userId, personId, orgId, stageId, status, expectedCloseDate, probability, lostReason, visibleTo, addTime, pipelineId, label) {
    const body = {
      title,
      value,
      currency,
      user_id: userId,
      person_id: personId,
      org_id: orgId,
      stage_id: stageId,
      status,
      expected_close_date: expectedCloseDate,
      probability,
      lost_reason: lostReason,
      visible_to: this.#resolveChoice(visibleTo, VISIBLE_TO_MAP),
      add_time: addTime,
      pipeline_id: pipelineId,
      label,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/${ id }`,
      method: 'put',
      body,
    })

    return response.data
  }

  /**
   * @description Returns all activities associated with a deal.
   * @route GET /deals/:id/activities
   * @operationName List Deal Activities
   * @category Deals
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   * @paramDef {"type":"Boolean","label":"Mark as Done","name":"done","description":"Whether the activity is completed.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Array","label":"Exclude","name":"exclude","description":"Items to exclude from results.","required":false}
   *
   * @returns {Object}
   */
  async listDealActivities(id, start, limit, done, exclude) {
    const query = {
      start,
      limit,
      done,
      exclude,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/${ id }/activities`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Returns updates about deal field values.
   * @route GET /deals/:id/changelog
   * @operationName List Deal Updates
   * @category Deals
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving next page of results.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async listDealUpdates(id, cursor, limit) {
    const query = { cursor, limit }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/${ id }/changelog`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Duplicates a deal.
   * @route POST /deals/:id/duplicate
   * @operationName Duplicate Deal
   * @category Deals
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async duplicateDeal(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/${ id }/duplicate`,
      method: 'post',
    })

    return response.data
  }

  /**
   * @description Returns all files attached to a deal.
   * @route GET /deals/:id/files
   * @operationName List Deal Files
   * @category Deals
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   * @paramDef {"type":"String","label":"Sort By","name":"sort","description":"Field to sort by (e.g., \"id DESC\").","required":false}
   *
   * @returns {Object}
   */
  async listDealFiles(id, start, limit, sort) {
    const query = { start, limit, sort }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/${ id }/files`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Returns updates about a deal.
   * @route GET /deals/:id/flow
   * @operationName List Deal Flow
   * @category Deals
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   * @paramDef {"type":"Number","label":"All Changes","name":"all_changes","description":"Include all changes since specified date.","uiComponent":{"type":"DATE_PICKER"},"required":false}
   * @paramDef {"type":"Array","label":"Items","name":"items","description":"Array of items.","required":false}
   *
   * @returns {Object}
   */
  async listDealFlow(id, start, limit, allChanges, items) {
    const query = {
      start,
      limit,
      all_changes: allChanges,
      items,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/${ id }/flow`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Returns updates about participants of a deal.
   * @route GET /deals/:id/participantsChangelog
   * @operationName List Deal Participants Updates
   * @category Deals
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving next page of results.","required":false}
   *
   * @returns {Object}
   */
  async listDealParticipantsUpdates(id, limit, cursor) {
    const query = { limit, cursor }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/${ id }/participantsChangelog`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Returns all followers of a deal.
   * @route GET /deals/:id/followers
   * @operationName List Deal Followers
   * @category Deals
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async listDealFollowers(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/${ id }/followers`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Adds a follower to a deal.
   * @route POST /deals/:id/followers
   * @operationName Add Deal Follower
   * @category Deals
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"User","name":"user_id","dictionary":"getUsersDictionary","description":"The user associated with this record. If omitted, uses the authenticated user.","required":true}
   *
   * @returns {Object}
   */
  async addDealFollower(id, userId) {
    const body = { user_id: userId }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/${ id }/followers`,
      method: 'post',
      body,
    })

    return response.data
  }

  /**
   * @description Removes a follower from a deal.
   * @route DELETE /deals/:id/followers/:follower_id
   * @operationName Delete Deal Follower
   * @category Deals
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Follower","name":"follower_id","description":"Identifier of the follower user.","required":true}
   *
   * @returns {Object}
   */
  async deleteDealFollower(id, followerId) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/${ id }/followers/${ followerId }`,
      method: 'delete',
    })

    return response.data
  }

  /**
   * @description Returns all mail messages associated with a deal.
   * @route GET /deals/:id/mailMessages
   * @operationName List Deal Mail Messages
   * @category Deals
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async listDealMailMessages(id, start, limit) {
    const query = { start, limit }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/${ id }/mailMessages`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Merges a deal with another deal.
   * @route PUT /deals/:id/merge
   * @operationName Merge Deals
   * @category Deals
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Merge With","name":"merge_with_id","description":"Identifier of the organization to merge with.","required":true}
   *
   * @returns {Object}
   */
  async mergeDeals(id, mergeWithId) {
    const body = { merge_with_id: mergeWithId }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/${ id }/merge`,
      method: 'put',
      body,
    })

    return response.data
  }

  /**
   * @description Returns all participants of a deal.
   * @route GET /deals/:id/participants
   * @operationName List Deal Participants
   * @category Deals
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async listDealParticipants(id, start, limit) {
    const query = { start, limit }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/${ id }/participants`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Adds a participant to a deal.
   * @route POST /deals/:id/participants
   * @operationName Add Deal Participant
   * @category Deals
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Person","name":"person_id","dictionary":"getPersonsDictionary","description":"The person associated with this record.","required":true}
   *
   * @returns {Object}
   */
  async addDealParticipant(id, personId) {
    const body = { person_id: personId }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/${ id }/participants`,
      method: 'post',
      body,
    })

    return response.data
  }

  /**
   * @description Removes a participant from a deal.
   * @route DELETE /deals/:id/participants/:deal_participant_id
   * @operationName Delete Deal Participant
   * @category Deals
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Deal Participant","name":"deal_participant_id","description":"Identifier of the deal participant.","required":true}
   *
   * @returns {Object}
   */
  async deleteDealParticipant(id, dealParticipantId) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/${ id }/participants/${ dealParticipantId }`,
      method: 'delete',
    })

    return response.data
  }

  /**
   * @description Returns users permitted to access a deal.
   * @route GET /deals/:id/permittedUsers
   * @operationName List Deal Permitted Users
   * @category Deals
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async listDealPermittedUsers(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/${ id }/permittedUsers`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Returns all persons associated with a deal.
   * @route GET /deals/:id/persons
   * @operationName List Deal Persons
   * @category Deals
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async listDealPersons(id, start, limit) {
    const query = { start, limit }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/${ id }/persons`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Returns all products attached to a deal.
   * @route GET /deals/:id/products
   * @operationName List Deal Products
   * @category Deals
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   * @paramDef {"type":"String","label":"Include Product Data","name":"include_product_data","description":"Whether to include product data in response.","required":false}
   *
   * @returns {Object}
   */
  async listDealProducts(id, start, limit, includeProductData) {
    const query = {
      start,
      limit,
      include_product_data: this.#toNumericFlag(includeProductData),
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/${ id }/products`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Adds a product to a deal.
   * @route POST /deals/:id/products
   * @operationName Add Deal Product
   * @category Deals
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Product","name":"product_id","description":"The product associated with this record.","required":true}
   * @paramDef {"type":"Number","label":"Item Price","name":"item_price","description":"Price of the item.","required":false}
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","description":"Quantity of the item.","required":false}
   * @paramDef {"type":"Number","label":"Discount %","name":"discount_percentage","description":"Discount percentage (0-100).","required":false}
   * @paramDef {"type":"String","label":"Duration","name":"duration","description":"The duration of the activity (HH:MM).","required":false}
   * @paramDef {"type":"Number","label":"Variation","name":"product_variation_id","description":"Identifier of the product variation.","required":false}
   * @paramDef {"type":"String","label":"Comments","name":"comments","description":"Comments about the product attachment.","required":false}
   * @paramDef {"type":"Boolean","label":"Enabled","name":"enabled_flag","description":"Whether the product attachment is enabled.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Number","label":"Tax","name":"tax","description":"Tax percentage.","required":false}
   * @paramDef {"type":"String","label":"Tax Method","name":"tax_method","required":false}
   *
   * @returns {Object}
   */
  async addDealProduct(id, productId, itemPrice, quantity, discountPercentage, duration, productVariationId, comments, enabledFlag, tax, taxMethod) {
    const body = {
      product_id: productId,
      item_price: itemPrice,
      quantity,
      discount_percentage: discountPercentage,
      duration,
      product_variation_id: productVariationId,
      comments,
      enabled_flag: enabledFlag,
      tax,
      tax_method: taxMethod,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/${ id }/products`,
      method: 'post',
      body,
    })

    return response.data
  }

  /**
   * @description Updates a product attached to a deal.
   * @route PUT /deals/:id/products/:product_attachment_id
   * @operationName Update Deal Product
   * @category Deals
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Product Attachment","name":"product_attachment_id","description":"Identifier of the attached product.","required":true}
   * @paramDef {"type":"Number","label":"Item Price","name":"item_price","description":"Price of the item.","required":false}
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","description":"Quantity of the item.","required":false}
   * @paramDef {"type":"Number","label":"Discount %","name":"discount_percentage","description":"Discount percentage (0-100).","required":false}
   * @paramDef {"type":"String","label":"Duration","name":"duration","description":"The duration of the activity (HH:MM).","required":false}
   * @paramDef {"type":"Number","label":"Variation","name":"product_variation_id","description":"Identifier of the product variation.","required":false}
   * @paramDef {"type":"String","label":"Comments","name":"comments","description":"Comments about the product attachment.","required":false}
   * @paramDef {"type":"Boolean","label":"Enabled","name":"enabled_flag","description":"Whether the product attachment is enabled.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Number","label":"Tax","name":"tax","description":"Tax percentage.","required":false}
   * @paramDef {"type":"String","label":"Tax Method","name":"tax_method","required":false}
   *
   * @returns {Object}
   */
  async updateDealProduct(id, productAttachmentId, itemPrice, quantity, discountPercentage, duration, productVariationId, comments, enabledFlag, tax, taxMethod) {
    const body = {
      item_price: itemPrice,
      quantity,
      discount_percentage: discountPercentage,
      duration,
      product_variation_id: productVariationId,
      comments,
      enabled_flag: enabledFlag,
      tax,
      tax_method: taxMethod,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/${ id }/products/${ productAttachmentId }`,
      method: 'put',
      body,
    })

    return response.data
  }

  /**
   * @description Removes a product from a deal.
   * @route DELETE /deals/:id/products/:product_attachment_id
   * @operationName Delete Deal Product
   * @category Deals
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Product Attachment","name":"product_attachment_id","description":"Identifier of the attached product.","required":true}
   *
   * @returns {Object}
   */
  async deleteDealProduct(id, productAttachmentId) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/${ id }/products/${ productAttachmentId }`,
      method: 'delete',
    })

    return response.data
  }


  // ======================================== FILES ========================================


  /**
   * @description Returns all files.
   * @route GET /files
   * @operationName List Files
   * @category Files
   *
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   * @paramDef {"type":"String","label":"Sort By","name":"sort","description":"Field to sort by (e.g., \"id DESC\").","required":false}
   *
   * @returns {Object}
   */
  async listFiles(start, limit, sort) {
    const query = { start, limit, sort }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/files`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Uploads a new file.
   * @route POST /files
   * @operationName Upload File
   * @category Files
   *
   * @paramDef {"type":"String","label":"File","name":"file","description":"The file to upload.","required":true}
   * @paramDef {"type":"Number","label":"Deal","name":"deal_id","description":"The deal associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Person","name":"person_id","dictionary":"getPersonsDictionary","description":"The person associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Organization","name":"org_id","dictionary":"getOrganizationsDictionary","description":"The organization associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Product","name":"product_id","description":"The product associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Activity","name":"activity_id","description":"The activity associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Lead","name":"lead_id","description":"Identifier of the lead.","required":false}
   *
   * @returns {Object}
   */
  async uploadFile(file, dealId, personId, orgId, productId, activityId, leadId) {
    const body = {
      file,
      deal_id: dealId,
      person_id: personId,
      org_id: orgId,
      product_id: productId,
      activity_id: activityId,
      lead_id: leadId,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/files`,
      method: 'post',
      body,
    })

    return response.data
  }

  /**
   * @description Creates a remote file and links it to an item.
   * @route POST /files/remote
   * @operationName Create Remote File
   * @category Files
   *
   * @paramDef {"type":"String","label":"File Type","name":"file_type","description":"The type of the file.","required":true}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"The title of the record.","required":true}
   * @paramDef {"type":"String","label":"Item Type","name":"item_type","description":"The type of item to associate the file with (deal, person, organization, etc.).","required":true}
   * @paramDef {"type":"Number","label":"Item","name":"item_id","description":"The Identifier of the item to associate the file with.","required":true}
   * @paramDef {"type":"String","label":"Remote Location","name":"remote_location","description":"The location type to send the file to (e.g., googledrive).","required":true}
   *
   * @returns {Object}
   */
  async createRemoteFile(fileType, title, itemType, itemId, remoteLocation) {
    const body = {
      file_type: fileType,
      title,
      item_type: itemType,
      item_id: itemId,
      remote_location: remoteLocation,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/files/remote`,
      method: 'post',
      body,
    })

    return response.data
  }

  /**
   * @description Links an existing remote file to an item.
   * @route POST /files/remoteLink
   * @operationName Link Remote File
   * @category Files
   *
   * @paramDef {"type":"String","label":"Item Type","name":"item_type","description":"The type of item to associate the file with (deal, person, organization, etc.).","required":true}
   * @paramDef {"type":"Number","label":"Item","name":"item_id","description":"The Identifier of the item to associate the file with.","required":true}
   * @paramDef {"type":"String","label":"Remote","name":"remote_id","description":"The remote item identifier.","required":true}
   * @paramDef {"type":"String","label":"Remote Location","name":"remote_location","description":"The location type to send the file to (e.g., googledrive).","required":true}
   *
   * @returns {Object}
   */
  async linkRemoteFile(itemType, itemId, remoteId, remoteLocation) {
    const body = {
      item_type: itemType,
      item_id: itemId,
      remote_id: remoteId,
      remote_location: remoteLocation,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/files/remoteLink`,
      method: 'post',
      body,
    })

    return response.data
  }

  /**
   * @description Marks a file as deleted.
   * @route DELETE /files/:id
   * @operationName Delete File
   * @category Files
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async deleteFile(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/files/${ id }`,
      method: 'delete',
    })

    return response.data
  }

  /**
   * @description Returns details of a specific file.
   * @route GET /files/:id
   * @operationName Get File
   * @category Files
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async getFile(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/files/${ id }`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Updates the properties of a file.
   * @route PUT /files/:id
   * @operationName Update File
   * @category Files
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the record.","required":false}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Description of the record.","uiComponent":{"type":"MULTI_LINE_TEXT"},"required":false}
   *
   * @returns {Object}
   */
  async updateFile(id, name, description) {
    const body = { name, description }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/files/${ id }`,
      method: 'put',
      body,
    })

    return response.data
  }

  /**
   * @description Initializes a file download.
   * @route GET /files/:id/download
   * @operationName Download File
   * @category Files
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async downloadFile(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/files/${ id }/download`,
      method: 'get',
    })

    return response.data
  }


  // ======================================== FILTERS ========================================


  /**
   * @description Returns all filters.
   * @route GET /filters
   * @operationName List Filters
   * @category Filters
   *
   * @paramDef {"type":"String","label":"Type","name":"type","description":"The type of the record.","required":true}
   *
   * @returns {Object}
   */
  async listFilters(type) {
    const query = { type }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/filters`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Adds a new filter.
   * @route POST /filters
   * @operationName Create Filter
   * @category Filters
   *
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the record.","required":false}
   * @paramDef {"type":"String","label":"Conditions","name":"conditions","description":"Filter conditions (JSON string).","required":false}
   * @paramDef {"type":"String","label":"Type","name":"type","description":"The type of the record.","required":true}
   *
   * @returns {Object}
   */
  async createFilter(name, conditions, type) {
    const body = { name, conditions, type }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/filters`,
      method: 'post',
      body,
    })

    return response.data
  }

  /**
   * @description Marks multiple filters as deleted.
   * @route DELETE /filters
   * @operationName Delete Filters
   * @category Filters
   *
   * @paramDef {"type":"String","label":"Identifiers","name":"ids","description":"Comma-separated list of IDs.","required":true}
   *
   * @returns {Object}
   */
  async deleteFilters(ids) {
    const query = { ids: Array.isArray(ids) ? ids.join(',') : ids }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/filters`,
      method: 'delete',
      query,
    })

    return response.data
  }

  /**
   * @description Returns details of a specific filter.
   * @route GET /filters/:id
   * @operationName Get Filter
   * @category Filters
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async getFilter(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/filters/${ id }`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Marks a filter as deleted.
   * @route DELETE /filters/:id
   * @operationName Delete Filter
   * @category Filters
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async deleteFilter(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/filters/${ id }`,
      method: 'delete',
    })

    return response.data
  }

  /**
   * @description Updates the properties of a filter.
   * @route PUT /filters/:id
   * @operationName Update Filter
   * @category Filters
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the record.","required":false}
   * @paramDef {"type":"String","label":"Conditions","name":"conditions","description":"Filter conditions (JSON string).","required":false}
   *
   * @returns {Object}
   */
  async updateFilter(id, name, conditions) {
    const body = { name, conditions }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/filters/${ id }`,
      method: 'put',
      body,
    })

    return response.data
  }

  /**
   * @description Returns all filter helpers.
   * @route GET /filters/helpers
   * @operationName List Filter Helpers
   * @category Filters
   *
   * @returns {Object}
   */
  async listFilterHelpers() {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/filters/helpers`,
      method: 'get',
    })

    return response.data
  }


  // ======================================== GOALS ========================================


  /**
   * @description Adds a new goal.
   * @route POST /goals
   * @operationName Create new goal
   * @category Goals
   *
   * @paramDef {"type":"String","label":"Type","name":"type","description":"The type of the record.","required":false}
   * @paramDef {"type":"String","label":"Assignee","name":"assignee","description":"User assigned to the item.","required":false}
   * @paramDef {"type":"String","label":"Expected Outcome","name":"expected_outcome","description":"Expected outcome for the goal.","required":false}
   * @paramDef {"type":"String","label":"Duration","name":"duration","description":"The duration of the activity (HH:MM).","required":false}
   * @paramDef {"type":"Number","label":"Interval","name":"interval","description":"Interval for statistics (day, week, month).","required":false}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"The title of the record.","required":false}
   *
   * @returns {Object}
   */
  async createNewGoal(type, assignee, expectedOutcome, duration, interval, title) {
    const body = { type: type, assignee: assignee, expected_outcome: expectedOutcome, duration: duration, interval: interval, title: title }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/goals`,
      method: 'post',
      body: Object.keys(body).length ? body : undefined,
    })

    // The goals endpoints wrap the record as { data: { goal: {...} } }; unwrap so the
    // returned object exposes the goal (and its id) at the top level like other resources.
    return response.data?.goal || response.data
  }

  /**
   * @description Returns data about goals based on criteria. For searching, append `{searchField}={searchValue}` to t...
   * @route GET /goals/find
   * @operationName Find goals
   * @category Goals
   *
   * @paramDef {"type":"String","label":"Type Name","name":"type.name","description":"Name of the type.","required":false}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"The title of the record.","required":false}
   * @paramDef {"type":"Boolean","label":"Is Active","name":"is_active","description":"Whether the item is active.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Number","label":"Assignee","name":"assignee_id","description":"Identifier of the user assigned to the task.","required":false}
   * @paramDef {"type":"String","label":"Assignee Type","name":"assignee.type","description":"Type of assignee (user, team, etc).","required":false}
   * @paramDef {"type":"String","label":"Expected Outcome Target","name":"expected_outcome.target","description":"Target value for the expected outcome.","required":false}
   * @paramDef {"type":"String","label":"Expected Outcome Tracking Metric","name":"expected_outcome.tracking_metric","description":"Metric used to track the expected outcome.","required":false}
   * @paramDef {"type":"Number","label":"Expected Outcome Currency","name":"expected_outcome.currency_id","description":"Currency ID for the expected outcome.","required":false}
   * @paramDef {"type":"Number","label":"Type Params Pipeline","name":"type.params.pipeline_id","description":"Pipeline ID for goal parameters.","required":false}
   * @paramDef {"type":"Number","label":"Type Params Stage","name":"type.params.stage_id","description":"Stage ID for goal parameters.","required":false}
   * @paramDef {"type":"Number","label":"Type Params Activity Type","name":"type.params.activity_type_id","description":"Activity type ID for goal parameters.","required":false}
   * @paramDef {"type":"Number","label":"Period Start","name":"period.start","description":"Start of the reporting period.","uiComponent":{"type":"DATE_PICKER"},"required":false}
   * @paramDef {"type":"Number","label":"Period End","name":"period.end","description":"End of the reporting period.","uiComponent":{"type":"DATE_PICKER"},"required":false}
   *
   * @returns {Object}
   */
  async findGoals(typeName, title, isActive, assigneeId, assigneeType, expectedOutcomeTarget, expectedOutcomeTrackingMetric, expectedOutcomeCurrencyId, typeParamsPipelineId, typeParamsStageId, typeParamsActivityTypeId, periodStart, periodEnd) {
    const query = { 'type.name': typeName, title: title, is_active: isActive, 'assignee.id': assigneeId, 'assignee.type': assigneeType, 'expected_outcome.target': expectedOutcomeTarget, 'expected_outcome.tracking_metric': expectedOutcomeTrackingMetric, 'expected_outcome.currency_id': expectedOutcomeCurrencyId, 'type.params.pipeline_id': typeParamsPipelineId, 'type.params.stage_id': typeParamsStageId, 'type.params.activity_type_id': typeParamsActivityTypeId, 'period.start': periodStart, 'period.end': periodEnd }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/goals/find`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Updates the properties of a goal.
   * @route PUT /goals/:id
   * @operationName Update existing goal
   * @category Goals
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"The title of the record.","required":false}
   * @paramDef {"type":"String","label":"Assignee","name":"assignee","description":"User assigned to the item.","required":false}
   * @paramDef {"type":"String","label":"Type","name":"type","description":"The type of the record.","required":false}
   * @paramDef {"type":"String","label":"Expected Outcome","name":"expected_outcome","description":"Expected outcome for the goal.","required":false}
   * @paramDef {"type":"String","label":"Duration","name":"duration","description":"The duration of the activity (HH:MM).","required":false}
   * @paramDef {"type":"Number","label":"Interval","name":"interval","description":"Interval for statistics (day, week, month).","required":false}
   *
   * @returns {Object}
   */
  async updateExistingGoal(id, title, assignee, type, expectedOutcome, duration, interval) {
    const body = { title: title, assignee: assignee, type: type, expected_outcome: expectedOutcome, duration: duration, interval: interval }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/goals/${ id }`,
      method: 'put',
      body: Object.keys(body).length ? body : undefined,
    })

    // Unwrap { data: { goal: {...} } } so the updated goal is returned at the top level.
    return response.data?.goal || response.data
  }

  /**
   * @description Marks a goal as deleted.
   * @route DELETE /goals/:id
   * @operationName Delete existing goal
   * @category Goals
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async deleteExistingGoal(id) {

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/goals/${ id }`,
      method: 'delete',
    })

    return response.data
  }

  /**
   * @description Returns details of a specific goal.
   * @route GET /goals/:id/results
   * @operationName Get result of goal
   * @category Goals
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Period Start","name":"period.start","description":"Start of the reporting period.","uiComponent":{"type":"DATE_PICKER"},"required":false}
   * @paramDef {"type":"Number","label":"Period End","name":"period.end","description":"End of the reporting period.","uiComponent":{"type":"DATE_PICKER"},"required":false}
   *
   * @returns {Object}
   */
  async getResultOfGoal(id, periodStart, periodEnd) {
    const query = { 'period.start': periodStart, 'period.end': periodEnd }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/goals/${ id }/results`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }


  // ======================================== ITEMSEARCH ========================================


  /**
   * @description Performs search across multiple item types.
   * @route GET /itemSearch
   * @operationName Search Items
   * @category ItemSearch
   *
   * @paramDef {"type":"String","label":"Search Term","name":"term","description":"The term to search for.","required":true}
   * @paramDef {"type":"String","label":"Item Types","name":"item_types","description":"Types of items to search.","required":false}
   * @paramDef {"type":"Array","label":"Fields","name":"fields","description":"Array of field names to include in response.","required":false}
   * @paramDef {"type":"Boolean","label":"Search for Related Items","name":"search_for_related_items","description":"Search for related items.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"String","label":"Exact Match","name":"exact_match","description":"Whether to perform exact matching in search.","required":false}
   * @paramDef {"type":"Array","label":"Include Fields","name":"include_fields","description":"Array of additional fields to include.","required":false}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async searchItems(term, itemTypes, fields, searchForRelatedItems, exactMatch, includeFields, start, limit) {
    const query = {
      term,
      item_types: itemTypes,
      fields,
      search_for_related_items: searchForRelatedItems,
      exact_match: exactMatch,
      include_fields: includeFields,
      start,
      limit,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/itemSearch`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Performs search using a specific field.
   * @route GET /itemSearch/field
   * @operationName Search Items by Field
   * @category ItemSearch
   *
   * @paramDef {"type":"String","label":"Search Term","name":"term","description":"The term to search for.","required":true}
   * @paramDef {"type":"String","label":"Field Type","name":"field_type","description":"Type of the field.","required":true}
   * @paramDef {"type":"String","label":"Exact Match","name":"exact_match","description":"Whether to perform exact matching in search.","required":false}
   * @paramDef {"type":"String","label":"Field Key","name":"field_key","description":"Key of the field.","required":false}
   * @paramDef {"type":"Boolean","label":"Return Item Identifiers","name":"return_item_ids","description":"Return only item IDs.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async searchItemsByField(term, fieldType, exactMatch, fieldKey, returnItemIds, start, limit) {
    const query = {
      term,
      field_type: fieldType,
      exact_match: exactMatch,
      field_key: fieldKey,
      return_item_ids: returnItemIds,
      start,
      limit,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/itemSearch/field`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }


  // ======================================== LEADLABELS ========================================


  /**
   * @description Returns all lead labels.
   * @route GET /leadLabels
   * @operationName List Lead Labels
   * @category LeadLabels
   *
   * @returns {Object}
   */
  async listLeadLabels() {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/leadLabels`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Adds a new lead label.
   * @route POST /leadLabels
   * @operationName Create Lead Label
   * @category LeadLabels
   *
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the record.","required":false}
   * @paramDef {"type":"String","label":"Color","name":"color","description":"Color code for the activity type.","required":false}
   *
   * @returns {Object}
   */
  async createLeadLabel(name, color) {
    const body = {
      name,
      color,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/leadLabels`,
      method: 'post',
      body,
    })

    return response.data
  }

  /**
   * @description Updates the properties of a lead label.
   * @route POST /leadLabels/:id
   * @operationName Update Lead Label
   * @category LeadLabels
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the record.","required":false}
   * @paramDef {"type":"String","label":"Color","name":"color","description":"Color code for the activity type.","required":false}
   *
   * @returns {Object}
   */
  async updateLeadLabel(id, name, color) {
    const body = {
      name,
      color,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/leadLabels/${ id }`,
      method: 'patch',
      body,
    })

    return response.data
  }

  /**
   * @description Marks a lead label as deleted.
   * @route DELETE /leadLabels/:id
   * @operationName Delete Lead Label
   * @category LeadLabels
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async deleteLeadLabel(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/leadLabels/${ id }`,
      method: 'delete',
    })

    return response.data
  }


  // ======================================== LEADS ========================================


  /**
   * @description Returns all leads.
   * @route GET /leads
   * @operationName List Leads
   * @category Leads
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Owner","name":"owner_id","description":"The user who owns this record.","required":false}
   * @paramDef {"type":"Number","label":"Person","name":"person_id","dictionary":"getPersonsDictionary","description":"The person associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Organization","name":"organization_id","description":"The organization associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Filter","name":"filter_id","description":"Identifier of the filter to apply.","required":false}
   * @paramDef {"type":"String","label":"Sort By","name":"sort","description":"Field to sort by (e.g., \"id DESC\").","required":false}
   *
   * @returns {Object}
   */
  async listLeads(limit, start, ownerId, personId, organizationId, filterId, sort) {
    const query = {
      limit,
      start,
      owner_id: ownerId,
      person_id: personId,
      organization_id: organizationId,
      filter_id: filterId,
      sort,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/leads`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Adds a new lead.
   * @route POST /leads
   * @operationName Create Lead
   * @category Leads
   *
   * @paramDef {"type":"String","label":"Title","name":"title","description":"The title of the record.","required":false}
   * @paramDef {"type":"Number","label":"Owner","name":"owner_id","description":"The user who owns this record.","required":false}
   * @paramDef {"type":"String","label":"Label Identifiers","name":"label_ids","description":"List of label IDs.","required":false}
   * @paramDef {"type":"Number","label":"Person","name":"person_id","dictionary":"getPersonsDictionary","description":"The person associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Organization","name":"organization_id","description":"The organization associated with this record.","required":false}
   * @paramDef {"type":"String","label":"Value","name":"value","description":"The monetary value of the deal.","required":false}
   * @paramDef {"type":"String","label":"Expected Close Date","name":"expected_close_date","description":"The expected close date of the deal (YYYY-MM-DD).","uiComponent":{"type":"DATE_PICKER"},"required":false}
   * @paramDef {"type":"String","label":"Visible To","name":"visible_to","description":"Visibility of the record.","uiComponent":{"type":"DROPDOWN","options":{"values":["Owner & followers (private)","Entire company"]}},"required":false}
   * @paramDef {"type":"Boolean","label":"Was Seen","name":"was_seen","description":"Whether the lead was seen.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"String","label":"Origin","name":"origin_id","description":"The origin identifier.","required":false}
   * @paramDef {"type":"Number","label":"Channel","name":"channel","description":"The channel.","required":false}
   * @paramDef {"type":"String","label":"Channel","name":"channel_id","description":"The channel identifier.","required":false}
   *
   * @returns {Object}
   */
  async createLead(title, ownerId, labelIds, personId, organizationId, value, expectedCloseDate, visibleTo, wasSeen, originId, channel, channelId) {
    const body = {
      title,
      owner_id: ownerId,
      label_ids: Array.isArray(labelIds) ? labelIds.join(',') : labelIds,
      person_id: personId,
      organization_id: organizationId,
      value,
      expected_close_date: expectedCloseDate,
      visible_to: this.#resolveChoice(visibleTo, VISIBLE_TO_MAP),
      was_seen: wasSeen,
      origin_id: originId,
      channel,
      channel_id: channelId,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/leads`,
      method: 'post',
      body,
    })

    return response.data
  }

  /**
   * @description Returns all archived leads.
   * @route GET /leads/archived
   * @operationName List Archived Leads
   * @category Leads
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Owner","name":"owner_id","description":"The user who owns this record.","required":false}
   * @paramDef {"type":"Number","label":"Person","name":"person_id","dictionary":"getPersonsDictionary","description":"The person associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Organization","name":"organization_id","description":"The organization associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Filter","name":"filter_id","description":"Identifier of the filter to apply.","required":false}
   * @paramDef {"type":"String","label":"Sort By","name":"sort","description":"Field to sort by (e.g., \"id DESC\").","required":false}
   *
   * @returns {Object}
   */
  async listArchivedLeads(limit, start, ownerId, personId, organizationId, filterId, sort) {
    const query = {
      limit,
      start,
      owner_id: ownerId,
      person_id: personId,
      organization_id: organizationId,
      filter_id: filterId,
      sort,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/leads/archived`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Returns details of a specific lead.
   * @route GET /leads/:id
   * @operationName Get Lead
   * @category Leads
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async getLead(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/leads/${ id }`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Updates the properties of a lead.
   * @route POST /leads/:id
   * @operationName Update Lead
   * @category Leads
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"The title of the record.","required":false}
   * @paramDef {"type":"Number","label":"Owner","name":"owner_id","description":"The user who owns this record.","required":false}
   * @paramDef {"type":"String","label":"Label Identifiers","name":"label_ids","description":"List of label IDs.","required":false}
   * @paramDef {"type":"Number","label":"Person","name":"person_id","dictionary":"getPersonsDictionary","description":"The person associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Organization","name":"organization_id","description":"The organization associated with this record.","required":false}
   * @paramDef {"type":"Boolean","label":"Is Archived","name":"is_archived","description":"Whether to include archived items.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"String","label":"Value","name":"value","description":"The monetary value of the deal.","required":false}
   * @paramDef {"type":"String","label":"Expected Close Date","name":"expected_close_date","description":"The expected close date of the deal (YYYY-MM-DD).","uiComponent":{"type":"DATE_PICKER"},"required":false}
   * @paramDef {"type":"String","label":"Visible To","name":"visible_to","description":"Visibility of the record.","uiComponent":{"type":"DROPDOWN","options":{"values":["Owner & followers (private)","Entire company"]}},"required":false}
   * @paramDef {"type":"Boolean","label":"Was Seen","name":"was_seen","description":"Whether the lead was seen.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Number","label":"Channel","name":"channel","description":"The channel.","required":false}
   * @paramDef {"type":"String","label":"Channel","name":"channel_id","description":"The channel identifier.","required":false}
   *
   * @returns {Object}
   */
  async updateLead(id, title, ownerId, labelIds, personId, organizationId, isArchived, value, expectedCloseDate, visibleTo, wasSeen, channel, channelId) {
    const body = {
      title,
      owner_id: ownerId,
      label_ids: Array.isArray(labelIds) ? labelIds.join(',') : labelIds,
      person_id: personId,
      organization_id: organizationId,
      is_archived: isArchived,
      value,
      expected_close_date: expectedCloseDate,
      visible_to: this.#resolveChoice(visibleTo, VISIBLE_TO_MAP),
      was_seen: wasSeen,
      channel,
      channel_id: channelId,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/leads/${ id }`,
      method: 'patch',
      body,
    })

    return response.data
  }

  /**
   * @description Marks a lead as deleted.
   * @route DELETE /leads/:id
   * @operationName Delete Lead
   * @category Leads
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async deleteLead(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/leads/${ id }`,
      method: 'delete',
    })

    return response.data
  }

  /**
   * @description Returns users permitted to access a lead.
   * @route GET /leads/:id/permittedUsers
   * @operationName List Lead Permitted Users
   * @category Leads
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async listLeadPermittedUsers(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/leads/${ id }/permittedUsers`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Searches all leads.
   * @route GET /leads/search
   * @operationName Search Leads
   * @category Leads
   *
   * @paramDef {"type":"String","label":"Search Term","name":"term","description":"The term to search for.","required":true}
   * @paramDef {"type":"Array","label":"Fields","name":"fields","description":"Array of field names to include in response.","required":false}
   * @paramDef {"type":"String","label":"Exact Match","name":"exact_match","description":"Whether to perform exact matching in search.","required":false}
   * @paramDef {"type":"Number","label":"Person","name":"person_id","dictionary":"getPersonsDictionary","description":"The person associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Organization","name":"organization_id","description":"The organization associated with this record.","required":false}
   * @paramDef {"type":"Array","label":"Include Fields","name":"include_fields","description":"Array of additional fields to include.","required":false}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async searchLeads(term, fields, exactMatch, personId, organizationId, includeFields, start, limit) {
    const query = {
      term,
      fields,
      exact_match: exactMatch,
      person_id: personId,
      organization_id: organizationId,
      include_fields: includeFields,
      start,
      limit,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/leads/search`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }


  // ======================================== LEADSOURCES ========================================


  /**
   * @description Returns all lead sources.
   * @route GET /leadSources
   * @operationName List Lead Sources
   * @category LeadSources
   *
   * @returns {Object}
   */
  async listLeadSources() {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/leadSources`,
      method: 'get',
    })

    return response.data
  }


  // ======================================== LEGACYTEAMS ========================================


  /**
   * @description Returns all legacyteams.
   * @route GET /legacyTeams
   * @operationName List teams
   * @category LegacyTeams
   *
   * @paramDef {"type":"String","label":"Order By","name":"order_by","description":"Field name to order results by.","required":false}
   * @paramDef {"type":"Boolean","label":"Skip Users","name":"skip_users","description":"Whether to skip returning user data.","uiComponent":{"type":"TOGGLE"},"required":false}
   *
   * @returns {Object}
   */
  async listTeams(orderBy, skipUsers) {
    const query = { order_by: orderBy, skip_users: this.#toNumericFlag(skipUsers) }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/legacyTeams`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Adds a new legacyteam.
   * @route POST /legacyTeams
   * @operationName Create new team
   * @category LegacyTeams
   *
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the record.","required":false}
   * @paramDef {"type":"Number","label":"Manager","name":"manager_id","description":"Identifier of the manager user.","required":false}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Description of the record.","uiComponent":{"type":"MULTI_LINE_TEXT"},"required":false}
   * @paramDef {"type":"Array","label":"Users","name":"users","description":"Array of user IDs.","required":false}
   *
   * @returns {Object}
   */
  async createNewTeam(name, managerId, description, users) {
    const body = { name: name, manager_id: managerId, description: description, users: users }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/legacyTeams`,
      method: 'post',
      body: Object.keys(body).length ? body : undefined,
    })

    return response.data
  }

  /**
   * @description Returns details of a specific legacyteam.
   * @route GET /legacyTeams/:id
   * @operationName Get single team
   * @category LegacyTeams
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Boolean","label":"Skip Users","name":"skip_users","description":"Whether to skip returning user data.","uiComponent":{"type":"TOGGLE"},"required":false}
   *
   * @returns {Object}
   */
  async getSingleTeam(id, skipUsers) {
    const query = { skip_users: this.#toNumericFlag(skipUsers) }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/legacyTeams/${ id }`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Updates the properties of a legacyteam.
   * @route PUT /legacyTeams/:id
   * @operationName Update team
   * @category LegacyTeams
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the record.","required":false}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Description of the record.","uiComponent":{"type":"MULTI_LINE_TEXT"},"required":false}
   * @paramDef {"type":"Number","label":"Manager","name":"manager_id","description":"Identifier of the manager user.","required":false}
   * @paramDef {"type":"Array","label":"Users","name":"users","description":"Array of user IDs.","required":false}
   * @paramDef {"type":"Boolean","label":"Active","name":"active_flag","description":"Whether the record is active.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Boolean","label":"Deleted Flag","name":"deleted_flag","description":"Whether the item is deleted.","uiComponent":{"type":"TOGGLE"},"required":false}
   *
   * @returns {Object}
   */
  async updateTeam(id, name, description, managerId, users, activeFlag, deletedFlag) {
    const body = { name: name, description: description, manager_id: managerId, users: users, active_flag: activeFlag, deleted_flag: deletedFlag }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/legacyTeams/${ id }`,
      method: 'put',
      body: Object.keys(body).length ? body : undefined,
    })

    return response.data
  }

  /**
   * @description Returns all legacyteams.
   * @route GET /legacyTeams/:id/users
   * @operationName List users in team
   * @category LegacyTeams
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async listUsersInTeam(id) {

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/legacyTeams/${ id }/users`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Adds a new legacyteam.
   * @route POST /legacyTeams/:id/users
   * @operationName Create users to team
   * @category LegacyTeams
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Array","label":"Users","name":"users","description":"Array of user IDs.","required":false}
   *
   * @returns {Object}
   */
  async createUsersToTeam(id, users) {
    const body = { users: users }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/legacyTeams/${ id }/users`,
      method: 'post',
      body: Object.keys(body).length ? body : undefined,
    })

    return response.data
  }

  /**
   * @description Marks a legacyteam as deleted.
   * @route DELETE /legacyTeams/:id/users
   * @operationName Delete users from team
   * @category LegacyTeams
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Array","label":"Users","name":"users","description":"Array of user IDs.","required":false}
   *
   * @returns {Object}
   */
  async deleteUsersFromTeam(id, users) {
    const body = { users: users }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/legacyTeams/${ id }/users`,
      method: 'delete',
      body: Object.keys(body).length ? body : undefined,
    })

    return response.data
  }

  /**
   * @description Returns all legacyteams.
   * @route GET /legacyTeams/user/:id
   * @operationName List teams of user
   * @category LegacyTeams
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"String","label":"Order By","name":"order_by","description":"Field name to order results by.","required":false}
   * @paramDef {"type":"Boolean","label":"Skip Users","name":"skip_users","description":"Whether to skip returning user data.","uiComponent":{"type":"TOGGLE"},"required":false}
   *
   * @returns {Object}
   */
  async listTeamsOfUser(id, orderBy, skipUsers) {
    const query = { order_by: orderBy, skip_users: this.#toNumericFlag(skipUsers) }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/legacyTeams/user/${ id }`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }


  // ======================================== MAILBOX ========================================


  /**
   * @description Returns details of a specific mailbox.
   * @route GET /mailbox/mailMessages/:id
   * @operationName Get one mail message
   * @category Mailbox
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"String","label":"Include Body","name":"include_body","description":"Whether to include message body in response.","required":false}
   *
   * @returns {Object}
   */
  async getOneMailMessage(id, includeBody) {
    const query = { include_body: includeBody }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/mailbox/mailMessages/${ id }`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Returns details of a specific mailbox.
   * @route GET /mailbox/mailThreads
   * @operationName Get mail threads
   * @category Mailbox
   *
   * @paramDef {"type":"String","label":"Folder","name":"folder","description":"Folder location.","required":false}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async getMailThreads(folder, start, limit) {
    const query = { folder: folder, start: start, limit: limit }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/mailbox/mailThreads`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Marks a mailbox as deleted.
   * @route DELETE /mailbox/mailThreads/:id
   * @operationName Delete mail thread
   * @category Mailbox
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async deleteMailThread(id) {

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/mailbox/mailThreads/${ id }`,
      method: 'delete',
    })

    return response.data
  }

  /**
   * @description Returns details of a specific mailbox.
   * @route GET /mailbox/mailThreads/:id
   * @operationName Get one mail thread
   * @category Mailbox
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async getOneMailThread(id) {

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/mailbox/mailThreads/${ id }`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Updates the properties of a mailbox.
   * @route PUT /mailbox/mailThreads/:id
   * @operationName Update mail thread details
   * @category Mailbox
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Deal","name":"deal_id","description":"The deal associated with this record.","required":true}
   * @paramDef {"type":"Number","label":"Lead","name":"lead_id","description":"Identifier of the lead.","required":true}
   * @paramDef {"type":"Boolean","label":"Shared Flag","name":"shared_flag","description":"Whether the item is shared.","uiComponent":{"type":"TOGGLE"},"required":true}
   * @paramDef {"type":"Boolean","label":"Read Flag","name":"read_flag","description":"Whether the item has been read.","uiComponent":{"type":"TOGGLE"},"required":true}
   * @paramDef {"type":"Boolean","label":"Archived Flag","name":"archived_flag","description":"Whether the item is archived.","uiComponent":{"type":"TOGGLE"},"required":true}
   *
   * @returns {Object}
   */
  async updateMailThreadDetails(id, dealId, leadId, sharedFlag, readFlag, archivedFlag) {
    const body = { deal_id: dealId, lead_id: leadId, shared_flag: sharedFlag, read_flag: readFlag, archived_flag: archivedFlag }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/mailbox/mailThreads/${ id }`,
      method: 'put',
      body: Object.keys(body).length ? body : undefined,
    })

    return response.data
  }

  /**
   * @description Returns all mailbox.
   * @route GET /mailbox/mailThreads/:id/mailMessages
   * @operationName List mail messages of mail thread
   * @category Mailbox
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async listMailMessagesOfMailThread(id) {

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/mailbox/mailThreads/${ id }/mailMessages`,
      method: 'get',
    })

    return response.data
  }


  // ======================================== MEETINGS ========================================


  /**
   * @description Links a user with an installed video call integration.
   * @route POST /meetings/userProviderLinks
   * @operationName Link User Provider
   * @category Meetings
   *
   * @paramDef {"type":"String","label":"User Provider","name":"user_provider_id","description":"Provider user identifier.","required":true}
   * @paramDef {"type":"Number","label":"User","name":"user_id","dictionary":"getUsersDictionary","description":"The user associated with this record. If omitted, uses the authenticated user.","required":true}
   * @paramDef {"type":"Number","label":"Company","name":"company_id","description":"Identifier of the company.","required":true}
   * @paramDef {"type":"String","label":"Marketplace Client","name":"marketplace_client_id","description":"Marketplace client identifier.","required":true}
   *
   * @returns {Object}
   */
  async linkUserProvider(userProviderId, userId, companyId, marketplaceClientId) {
    const body = {
      user_provider_id: userProviderId,
      user_id: userId,
      company_id: companyId,
      marketplace_client_id: marketplaceClientId,
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/meetings/userProviderLinks`,
      method: 'post',
      body,
    })

    return response.data
  }

  /**
   * @description Deletes the link between a user and video call integration.
   * @route DELETE /meetings/userProviderLinks/:id
   * @operationName Delete User Provider Link
   * @category Meetings
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async deleteUserProviderLink(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/meetings/userProviderLinks/${ id }`,
      method: 'delete',
    })

    return response.data
  }


  // ======================================== NOTEFIELDS ========================================


  /**
   * @description Returns all note fields.
   * @route GET /noteFields
   * @operationName List Note Fields
   * @category NoteFields
   *
   * @returns {Object}
   */
  async listNoteFields() {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/noteFields`,
      method: 'get',
    })

    return response.data
  }


  // ======================================== NOTES ========================================


  /**
   * @description Returns all notes.
   * @route GET /notes
   * @operationName List Notes
   * @category Notes
   *
   * @paramDef {"type":"Number","label":"User","name":"user_id","dictionary":"getUsersDictionary","description":"The user associated with this record. If omitted, uses the authenticated user.","required":false}
   * @paramDef {"type":"Number","label":"Lead","name":"lead_id","description":"Identifier of the lead.","required":false}
   * @paramDef {"type":"Number","label":"Deal","name":"deal_id","description":"The deal associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Person","name":"person_id","dictionary":"getPersonsDictionary","description":"The person associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Organization","name":"org_id","dictionary":"getOrganizationsDictionary","description":"The organization associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Project","name":"project_id","description":"Identifier of the project.","required":false}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   * @paramDef {"type":"String","label":"Sort By","name":"sort","description":"Field to sort by (e.g., \"id DESC\").","required":false}
   * @paramDef {"type":"Number","label":"Start Date and Time","name":"startDateTime","description":"Start date and time for filtering results. Will be automatically formatted for Pipedrive.","uiComponent":{"type":"DATE_TIME_PICKER"},"required":false}
   * @paramDef {"type":"Number","label":"End Date and Time","name":"endDateTime","description":"End date and time for filtering results. Will be automatically formatted for Pipedrive.","uiComponent":{"type":"DATE_TIME_PICKER"},"required":false}
   * @paramDef {"type":"Boolean","label":"Pinned to Lead","name":"pinned_to_lead_flag","description":"Whether the item is pinned to a lead.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Boolean","label":"Pinned to Deal","name":"pinned_to_deal_flag","description":"Whether the item is pinned to a deal.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Boolean","label":"Pinned to Organization","name":"pinned_to_organization_flag","description":"Whether the item is pinned to an organization.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Boolean","label":"Pinned to Person","name":"pinned_to_person_flag","description":"Whether the item is pinned to a person.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Boolean","label":"Pinned to Project","name":"pinned_to_project_flag","description":"Whether the item is pinned to a project.","uiComponent":{"type":"TOGGLE"},"required":false}
   *
   * @returns {Object}
   */
  async listNotes(userId, leadId, dealId, personId, orgId, projectId, start, limit, sort, startDate, endDate, pinnedToLeadFlag, pinnedToDealFlag, pinnedToOrganizationFlag, pinnedToPersonFlag, pinnedToProjectFlag) {
    const query = {
      user_id: userId,
      lead_id: leadId,
      deal_id: dealId,
      person_id: personId,
      org_id: orgId,
      project_id: projectId,
      start,
      limit,
      sort,
      start_date: startDate,
      end_date: endDate,
      pinned_to_lead_flag: pinnedToLeadFlag,
      pinned_to_deal_flag: pinnedToDealFlag,
      pinned_to_organization_flag: pinnedToOrganizationFlag,
      pinned_to_person_flag: pinnedToPersonFlag,
      pinned_to_project_flag: pinnedToProjectFlag,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/notes`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Adds a new note.
   * @route POST /notes
   * @operationName Create Note
   * @category Notes
   *
   * @paramDef {"type":"String","label":"Content","name":"content","description":"The content of the record.","uiComponent":{"type":"MULTI_LINE_TEXT"},"required":true}
   * @paramDef {"type":"Number","label":"Lead","name":"lead_id","description":"Identifier of the lead.","required":false}
   * @paramDef {"type":"Number","label":"Deal","name":"deal_id","description":"The deal associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Person","name":"person_id","dictionary":"getPersonsDictionary","description":"The person associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Organization","name":"org_id","dictionary":"getOrganizationsDictionary","description":"The organization associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Project","name":"project_id","description":"Identifier of the project.","required":false}
   * @paramDef {"type":"Number","label":"User","name":"user_id","dictionary":"getUsersDictionary","description":"The user associated with this record. If omitted, uses the authenticated user.","required":false}
   * @paramDef {"type":"String","label":"Created At","name":"add_time","description":"The creation date and time of the record (UTC).","required":false}
   * @paramDef {"type":"Boolean","label":"Pinned to Lead","name":"pinned_to_lead_flag","description":"Whether the item is pinned to a lead.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Boolean","label":"Pinned to Deal","name":"pinned_to_deal_flag","description":"Whether the item is pinned to a deal.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Boolean","label":"Pinned to Organization","name":"pinned_to_organization_flag","description":"Whether the item is pinned to an organization.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Boolean","label":"Pinned to Person","name":"pinned_to_person_flag","description":"Whether the item is pinned to a person.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Boolean","label":"Pinned to Project","name":"pinned_to_project_flag","description":"Whether the item is pinned to a project.","uiComponent":{"type":"TOGGLE"},"required":false}
   *
   * @returns {Object}
   */
  async createNote(content, leadId, dealId, personId, orgId, projectId, userId, addTime, pinnedToLeadFlag, pinnedToDealFlag, pinnedToOrganizationFlag, pinnedToPersonFlag, pinnedToProjectFlag) {
    const body = {
      content,
      lead_id: leadId,
      deal_id: dealId,
      person_id: personId,
      org_id: orgId,
      project_id: projectId,
      user_id: userId,
      add_time: addTime,
      pinned_to_lead_flag: pinnedToLeadFlag,
      pinned_to_deal_flag: pinnedToDealFlag,
      pinned_to_organization_flag: pinnedToOrganizationFlag,
      pinned_to_person_flag: pinnedToPersonFlag,
      pinned_to_project_flag: pinnedToProjectFlag,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/notes`,
      method: 'post',
      body,
    })

    return response.data
  }

  /**
   * @description Marks a note as deleted.
   * @route DELETE /notes/:id
   * @operationName Delete Note
   * @category Notes
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async deleteNote(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/notes/${ id }`,
      method: 'delete',
    })

    return response.data
  }

  /**
   * @description Returns details of a specific note.
   * @route GET /notes/:id
   * @operationName Get Note
   * @category Notes
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async getNote(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/notes/${ id }`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Updates the properties of a note.
   * @route PUT /notes/:id
   * @operationName Update Note
   * @category Notes
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"String","label":"Content","name":"content","description":"The content of the record.","uiComponent":{"type":"MULTI_LINE_TEXT"},"required":true}
   * @paramDef {"type":"Number","label":"Lead","name":"lead_id","description":"Identifier of the lead.","required":false}
   * @paramDef {"type":"Number","label":"Deal","name":"deal_id","description":"The deal associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Person","name":"person_id","dictionary":"getPersonsDictionary","description":"The person associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Organization","name":"org_id","dictionary":"getOrganizationsDictionary","description":"The organization associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Project","name":"project_id","description":"Identifier of the project.","required":false}
   * @paramDef {"type":"Number","label":"User","name":"user_id","dictionary":"getUsersDictionary","description":"The user associated with this record. If omitted, uses the authenticated user.","required":false}
   * @paramDef {"type":"String","label":"Created At","name":"add_time","description":"The creation date and time of the record (UTC).","required":false}
   * @paramDef {"type":"Boolean","label":"Pinned to Lead","name":"pinned_to_lead_flag","description":"Whether the item is pinned to a lead.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Boolean","label":"Pinned to Deal","name":"pinned_to_deal_flag","description":"Whether the item is pinned to a deal.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Boolean","label":"Pinned to Organization","name":"pinned_to_organization_flag","description":"Whether the item is pinned to an organization.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Boolean","label":"Pinned to Person","name":"pinned_to_person_flag","description":"Whether the item is pinned to a person.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Boolean","label":"Pinned to Project","name":"pinned_to_project_flag","description":"Whether the item is pinned to a project.","uiComponent":{"type":"TOGGLE"},"required":false}
   *
   * @returns {Object}
   */
  async updateNote(id, content, leadId, dealId, personId, orgId, projectId, userId, addTime, pinnedToLeadFlag, pinnedToDealFlag, pinnedToOrganizationFlag, pinnedToPersonFlag, pinnedToProjectFlag) {
    const body = {
      content,
      lead_id: leadId,
      deal_id: dealId,
      person_id: personId,
      org_id: orgId,
      project_id: projectId,
      user_id: userId,
      add_time: addTime,
      pinned_to_lead_flag: pinnedToLeadFlag,
      pinned_to_deal_flag: pinnedToDealFlag,
      pinned_to_organization_flag: pinnedToOrganizationFlag,
      pinned_to_person_flag: pinnedToPersonFlag,
      pinned_to_project_flag: pinnedToProjectFlag,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/notes/${ id }`,
      method: 'put',
      body,
    })

    return response.data
  }

  /**
   * @description Returns all comments for a note.
   * @route GET /notes/:id/comments
   * @operationName List Note Comments
   * @category Notes
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async listNoteComments(id, start, limit) {
    const query = { start, limit }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/notes/${ id }/comments`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Adds a comment to a note.
   * @route POST /notes/:id/comments
   * @operationName Add Note Comment
   * @category Notes
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"String","label":"Content","name":"content","description":"The content of the record.","uiComponent":{"type":"MULTI_LINE_TEXT"},"required":true}
   *
   * @returns {Object}
   */
  async addNoteComment(id, content) {
    const body = { content }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/notes/${ id }/comments`,
      method: 'post',
      body,
    })

    return response.data
  }

  /**
   * @description Returns details of a specific comment.
   * @route GET /notes/:id/comments/:commentId
   * @operationName Get Note Comment
   * @category Notes
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"String","label":"Comment","name":"comment_id","description":"The comment identifier.","required":true}
   *
   * @returns {Object}
   */
  async getNoteComment(id, commentId) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/notes/${ id }/comments/${ commentId }`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Updates a comment related to a note.
   * @route PUT /notes/:id/comments/:commentId
   * @operationName Update Note Comment
   * @category Notes
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"String","label":"Comment","name":"comment_id","description":"The comment identifier.","required":true}
   * @paramDef {"type":"String","label":"Content","name":"content","description":"The content of the record.","uiComponent":{"type":"MULTI_LINE_TEXT"},"required":true}
   *
   * @returns {Object}
   */
  async updateNoteComment(id, commentId, content) {
    const body = { content }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/notes/${ id }/comments/${ commentId }`,
      method: 'put',
      body,
    })

    return response.data
  }

  /**
   * @description Deletes a comment related to a note.
   * @route DELETE /notes/:id/comments/:commentId
   * @operationName Delete Note Comment
   * @category Notes
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"String","label":"Comment","name":"comment_id","description":"The comment identifier.","required":true}
   *
   * @returns {Object}
   */
  async deleteNoteComment(id, commentId) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/notes/${ id }/comments/${ commentId }`,
      method: 'delete',
    })

    return response.data
  }


  // ======================================== ORGANIZATIONFIELDS ========================================


  /**
   * @description Returns all organization fields.
   * @route GET /organizationFields
   * @operationName List Organization Fields
   * @category OrganizationFields
   *
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async listOrganizationFields(start, limit) {
    const query = { start, limit }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/organizationFields`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Adds a new organization field.
   * @route POST /organizationFields
   * @operationName Create Organization Field
   * @category OrganizationFields
   *
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the record.","required":false}
   * @paramDef {"type":"String","label":"Field Type","name":"field_type","description":"Type of the field.","required":true}
   * @paramDef {"type":"String","label":"Options","name":"options","description":"Options for the field (JSON array).","required":false}
   * @paramDef {"type":"Boolean","label":"Add Visible Flag","name":"add_visible_flag","description":"Whether the field is visible in add dialogs.","uiComponent":{"type":"TOGGLE"},"required":false}
   *
   * @returns {Object}
   */
  async createOrganizationField(fieldType, name, options, addVisibleFlag) {
    const body = {
      field_type: fieldType,
      name,
      options,
      add_visible_flag: addVisibleFlag,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/organizationFields`,
      method: 'post',
      body,
    })

    return response.data
  }

  /**
   * @description Marks multiple organization fields as deleted.
   * @route DELETE /organizationFields
   * @operationName Delete Organization Fields
   * @category OrganizationFields
   *
   * @paramDef {"type":"String","label":"Identifiers","name":"ids","description":"Comma-separated list of IDs.","required":true}
   *
   * @returns {Object}
   */
  async deleteOrganizationFields(ids) {
    const query = { ids: Array.isArray(ids) ? ids.join(',') : ids }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/organizationFields`,
      method: 'delete',
      query,
    })

    return response.data
  }

  /**
   * @description Returns details of a specific organization field.
   * @route GET /organizationFields/:id
   * @operationName Get Organization Field
   * @category OrganizationFields
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async getOrganizationField(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/organizationFields/${ id }`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Marks an organization field as deleted.
   * @route DELETE /organizationFields/:id
   * @operationName Delete Organization Field
   * @category OrganizationFields
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async deleteOrganizationField(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/organizationFields/${ id }`,
      method: 'delete',
    })

    return response.data
  }

  /**
   * @description Updates the properties of an organization field.
   * @route PUT /organizationFields/:id
   * @operationName Update Organization Field
   * @category OrganizationFields
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the record.","required":false}
   * @paramDef {"type":"String","label":"Options","name":"options","description":"Options for the field (JSON array).","required":false}
   * @paramDef {"type":"Boolean","label":"Add Visible Flag","name":"add_visible_flag","description":"Whether the field is visible in add dialogs.","uiComponent":{"type":"TOGGLE"},"required":false}
   *
   * @returns {Object}
   */
  async updateOrganizationField(id, name, options, addVisibleFlag) {
    const body = {
      name,
      options,
      add_visible_flag: addVisibleFlag,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/organizationFields/${ id }`,
      method: 'put',
      body,
    })

    return response.data
  }


  // ======================================== ORGANIZATIONS ========================================


  /**
   * @description Returns all organizations.
   * @route GET /organizations
   * @operationName List Organizations
   * @category Organizations
   *
   * @paramDef {"type":"Number","label":"User","name":"user_id","dictionary":"getUsersDictionary","description":"The user associated with this record. If omitted, uses the authenticated user.","required":true}
   * @paramDef {"type":"Number","label":"Filter","name":"filter_id","description":"Identifier of the filter to apply.","required":false}
   * @paramDef {"type":"String","label":"First Character","name":"first_char","description":"First character of the name.","required":false}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   * @paramDef {"type":"String","label":"Sort By","name":"sort","description":"Field to sort by (e.g., \"id DESC\").","required":false}
   *
   * @returns {Object}
   * @sampleResult [{"id":201,"name":"Example Corp","owner_id":12345,"add_time":"2024-01-15 10:30:00","active_flag":true,"people_count":4,"open_deals_count":2},{"id":202,"name":"Acme Industries","owner_id":12345,"add_time":"2024-01-08 11:00:00","active_flag":true,"people_count":7,"open_deals_count":3}]
   */
  async listOrganizations(userId, filterId, firstChar, start, limit, sort) {
    const query = {
      user_id: userId,
      filter_id: filterId,
      first_char: firstChar,
      start,
      limit,
      sort,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/organizations`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Adds a new organization.
   * @route POST /organizations
   * @operationName Create Organization
   * @category Organizations
   *
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the record.","required":false}
   * @paramDef {"type":"String","label":"Created At","name":"add_time","description":"The creation date and time of the record (UTC).","required":false}
   * @paramDef {"type":"Number","label":"Owner","name":"owner_id","description":"The user who owns this record.","required":false}
   * @paramDef {"type":"Number","label":"Label","name":"label","description":"Label identifier.","required":false}
   * @paramDef {"type":"String","label":"Label Identifiers","name":"label_ids","description":"List of label IDs.","required":false}
   * @paramDef {"type":"String","label":"Visible To","name":"visible_to","description":"Visibility of the record.","uiComponent":{"type":"DROPDOWN","options":{"values":["Owner & followers (private)","Entire company"]}},"required":false}
   *
   * @returns {Object}
   * @sampleResult {"id":201,"name":"Example Corp","owner_id":12345,"add_time":"2024-01-15 10:30:00","update_time":"2024-01-15 10:30:00","active_flag":true,"visible_to":"3","people_count":0,"open_deals_count":0,"closed_deals_count":0,"address":null,"cc_email":"example@pipedrivemail.com"}
   */
  async createOrganization(name, addTime, ownerId, label, labelIds, visibleTo) {
    const body = {
      name,
      add_time: addTime,
      owner_id: ownerId,
      label,
      label_ids: Array.isArray(labelIds) ? labelIds.join(',') : labelIds,
      visible_to: this.#resolveChoice(visibleTo, VISIBLE_TO_MAP),
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/organizations`,
      method: 'post',
      body,
    })

    return response.data
  }

  /**
   * @description Returns all organizations.
   * @route GET /organizations/collection
   * @operationName List Organizations Collection
   * @category Organizations
   *
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving next page of results.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   * @paramDef {"type":"String","label":"Since","name":"since","description":"Timestamp to filter items modified since.","required":false}
   * @paramDef {"type":"String","label":"Until","name":"until","description":"Timestamp to filter items modified until.","required":false}
   * @paramDef {"type":"Number","label":"Owner","name":"owner_id","description":"The user who owns this record.","required":false}
   * @paramDef {"type":"String","label":"First Character","name":"first_char","description":"First character of the name.","required":false}
   *
   * @returns {Object}
   */
  async listOrganizationsCollection(cursor, limit, since, until, ownerId, firstChar) {
    const query = {
      cursor,
      limit,
      since,
      until,
      owner_id: ownerId,
      first_char: firstChar,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/organizations/collection`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Searches all organizations.
   * @route GET /organizations/search
   * @operationName Search Organizations
   * @category Organizations
   *
   * @paramDef {"type":"String","label":"Search Term","name":"term","description":"The term to search for.","required":true}
   * @paramDef {"type":"Array","label":"Fields","name":"fields","description":"Array of field names to include in response.","required":false}
   * @paramDef {"type":"String","label":"Exact Match","name":"exact_match","description":"Whether to perform exact matching in search.","required":false}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async searchOrganizations(term, fields, exactMatch, start, limit) {
    const query = {
      term,
      fields,
      exact_match: exactMatch,
      start,
      limit,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/organizations/search`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Marks multiple organizations as deleted.
   * @route DELETE /organizations
   * @operationName Delete Organizations
   * @category Organizations
   *
   * @paramDef {"type":"String","label":"Identifiers","name":"ids","description":"Comma-separated list of IDs.","required":true}
   *
   * @returns {Object}
   */
  async deleteOrganizations(ids) {
    const query = { ids: Array.isArray(ids) ? ids.join(',') : ids }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/organizations`,
      method: 'delete',
      query,
    })

    return response.data
  }

  /**
   * @description Returns details of a specific organization.
   * @route GET /organizations/:id
   * @operationName Get Organization
   * @category Organizations
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   * @sampleResult {"id":201,"name":"Example Corp","owner_id":12345,"add_time":"2024-01-15 10:30:00","update_time":"2024-01-20 09:00:00","active_flag":true,"visible_to":"3","people_count":4,"open_deals_count":2,"closed_deals_count":1,"address":"123 Main St, New York, NY","cc_email":"example@pipedrivemail.com"}
   */
  async getOrganization(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/organizations/${ id }`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Updates the properties of an organization.
   * @route PUT /organizations/:id
   * @operationName Update Organization
   * @category Organizations
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the record.","required":false}
   * @paramDef {"type":"Number","label":"Owner","name":"owner_id","description":"The user who owns this record.","required":false}
   * @paramDef {"type":"Number","label":"Label","name":"label","description":"Label identifier.","required":false}
   * @paramDef {"type":"String","label":"Label Identifiers","name":"label_ids","description":"List of label IDs.","required":false}
   * @paramDef {"type":"String","label":"Visible To","name":"visible_to","description":"Visibility of the record.","uiComponent":{"type":"DROPDOWN","options":{"values":["Owner & followers (private)","Entire company"]}},"required":false}
   *
   * @returns {Object}
   * @sampleResult {"id":201,"name":"Example Corp International","owner_id":12345,"add_time":"2024-01-15 10:30:00","update_time":"2024-01-25 13:20:00","active_flag":true,"visible_to":"3","people_count":4,"open_deals_count":2,"closed_deals_count":1,"address":"123 Main St, New York, NY"}
   */
  async updateOrganization(id, name, ownerId, label, labelIds, visibleTo) {
    const body = {
      name,
      owner_id: ownerId,
      label,
      label_ids: Array.isArray(labelIds) ? labelIds.join(',') : labelIds,
      visible_to: this.#resolveChoice(visibleTo, VISIBLE_TO_MAP),
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/organizations/${ id }`,
      method: 'put',
      body,
    })

    return response.data
  }

  /**
   * @description Marks an organization as deleted.
   * @route DELETE /organizations/:id
   * @operationName Delete Organization
   * @category Organizations
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async deleteOrganization(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/organizations/${ id }`,
      method: 'delete',
    })

    return response.data
  }

  /**
   * @description Returns all activities associated with an organization.
   * @route GET /organizations/:id/activities
   * @operationName List Organization Activities
   * @category Organizations
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   * @paramDef {"type":"Boolean","label":"Mark as Done","name":"done","description":"Whether the activity is completed.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Array","label":"Exclude","name":"exclude","description":"Items to exclude from results.","required":false}
   *
   * @returns {Object}
   */
  async listOrganizationActivities(id, start, limit, done, exclude) {
    const query = {
      start,
      limit,
      done,
      exclude,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/organizations/${ id }/activities`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Returns updates about organization field values.
   * @route GET /organizations/:id/changelog
   * @operationName List Organization Updates
   * @category Organizations
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving next page of results.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async listOrganizationUpdates(id, cursor, limit) {
    const query = { cursor, limit }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/organizations/${ id }/changelog`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Returns all deals associated with an organization.
   * @route GET /organizations/:id/deals
   * @operationName List Organization Deals
   * @category Organizations
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"The status of the record.","uiComponent":{"type":"DROPDOWN","options":{"values":[]}},"required":false}
   * @paramDef {"type":"String","label":"Sort By","name":"sort","description":"Field to sort by (e.g., \"id DESC\").","required":false}
   * @paramDef {"type":"Boolean","label":"Only Primary Association","name":"only_primary_association","description":"Show only primary association.","uiComponent":{"type":"TOGGLE"},"required":false}
   *
   * @returns {Object}
   */
  async listOrganizationDeals(id, start, limit, status, sort, onlyPrimaryAssociation) {
    const query = {
      start,
      limit,
      status,
      sort,
      only_primary_association: onlyPrimaryAssociation,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/organizations/${ id }/deals`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Returns all files attached to an organization.
   * @route GET /organizations/:id/files
   * @operationName List Organization Files
   * @category Organizations
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   * @paramDef {"type":"String","label":"Sort By","name":"sort","description":"Field to sort by (e.g., \"id DESC\").","required":false}
   *
   * @returns {Object}
   */
  async listOrganizationFiles(id, start, limit, sort) {
    const query = { start, limit, sort }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/organizations/${ id }/files`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Returns updates about an organization.
   * @route GET /organizations/:id/flow
   * @operationName List Organization Flow
   * @category Organizations
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   * @paramDef {"type":"Number","label":"All Changes","name":"all_changes","description":"Include all changes since specified date.","uiComponent":{"type":"DATE_PICKER"},"required":false}
   * @paramDef {"type":"Array","label":"Items","name":"items","description":"Array of items.","required":false}
   *
   * @returns {Object}
   */
  async listOrganizationFlow(id, start, limit, allChanges, items) {
    const query = {
      start,
      limit,
      all_changes: allChanges,
      items,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/organizations/${ id }/flow`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Returns all followers of an organization.
   * @route GET /organizations/:id/followers
   * @operationName List Organization Followers
   * @category Organizations
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async listOrganizationFollowers(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/organizations/${ id }/followers`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Adds a follower to an organization.
   * @route POST /organizations/:id/followers
   * @operationName Add Organization Follower
   * @category Organizations
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"User","name":"user_id","dictionary":"getUsersDictionary","description":"The user associated with this record. If omitted, uses the authenticated user.","required":true}
   *
   * @returns {Object}
   */
  async addOrganizationFollower(id, userId) {
    const body = { user_id: userId }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/organizations/${ id }/followers`,
      method: 'post',
      body,
    })

    return response.data
  }

  /**
   * @description Removes a follower from an organization.
   * @route DELETE /organizations/:id/followers/:follower_id
   * @operationName Delete Organization Follower
   * @category Organizations
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Follower","name":"follower_id","description":"Identifier of the follower user.","required":true}
   *
   * @returns {Object}
   */
  async deleteOrganizationFollower(id, followerId) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/organizations/${ id }/followers/${ followerId }`,
      method: 'delete',
    })

    return response.data
  }

  /**
   * @description Returns all mail messages associated with an organization.
   * @route GET /organizations/:id/mailMessages
   * @operationName List Organization Mail Messages
   * @category Organizations
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async listOrganizationMailMessages(id, start, limit) {
    const query = { start, limit }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/organizations/${ id }/mailMessages`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Merges an organization with another organization.
   * @route PUT /organizations/:id/merge
   * @operationName Merge Organizations
   * @category Organizations
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Merge With","name":"merge_with_id","description":"Identifier of the organization to merge with.","required":true}
   *
   * @returns {Object}
   */
  async mergeOrganizations(id, mergeWithId) {
    const body = { merge_with_id: mergeWithId }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/organizations/${ id }/merge`,
      method: 'put',
      body,
    })

    return response.data
  }

  /**
   * @description Returns users permitted to access an organization.
   * @route GET /organizations/:id/permittedUsers
   * @operationName List Organization Permitted Users
   * @category Organizations
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async listOrganizationPermittedUsers(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/organizations/${ id }/permittedUsers`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Returns all persons associated with an organization.
   * @route GET /organizations/:id/persons
   * @operationName List Organization Persons
   * @category Organizations
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async listOrganizationPersons(id, start, limit) {
    const query = { start, limit }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/organizations/${ id }/persons`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }


  // ======================================== PERMISSIONSETS ========================================


  /**
   * @description Returns all permission sets.
   * @route GET /permissionSets
   * @operationName List Permission Sets
   * @category PermissionSets
   *
   * @paramDef {"type":"String","label":"App","name":"app","description":"App filter for permission sets.","required":false}
   *
   * @returns {Object}
   */
  async listPermissionSets(app) {
    const query = { app }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/permissionSets`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Returns details of a specific permission set.
   * @route GET /permissionSets/:id
   * @operationName Get Permission Set
   * @category PermissionSets
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async getPermissionSet(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/permissionSets/${ id }`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Returns all assignments for a permission set.
   * @route GET /permissionSets/:id/assignments
   * @operationName List Permission Set Assignments
   * @category PermissionSets
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async listPermissionSetAssignments(id, start, limit) {
    const query = { start, limit }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/permissionSets/${ id }/assignments`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }


  // ======================================== PERSONFIELDS ========================================


  /**
   * @description Returns all person fields.
   * @route GET /personFields
   * @operationName List Person Fields
   * @category PersonFields
   *
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async listPersonFields(start, limit) {
    const query = { start, limit }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/personFields`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Adds a new person field.
   * @route POST /personFields
   * @operationName Create Person Field
   * @category PersonFields
   *
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the record.","required":false}
   * @paramDef {"type":"String","label":"Field Type","name":"field_type","description":"Type of the field.","required":true}
   * @paramDef {"type":"String","label":"Options","name":"options","description":"Options for the field (JSON array).","required":false}
   * @paramDef {"type":"Boolean","label":"Add Visible Flag","name":"add_visible_flag","description":"Whether the field is visible in add dialogs.","uiComponent":{"type":"TOGGLE"},"required":false}
   *
   * @returns {Object}
   */
  async createPersonField(fieldType, name, options, addVisibleFlag) {
    const body = {
      field_type: fieldType,
      name,
      options,
      add_visible_flag: addVisibleFlag,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/personFields`,
      method: 'post',
      body,
    })

    return response.data
  }

  /**
   * @description Marks multiple person fields as deleted.
   * @route DELETE /personFields
   * @operationName Delete Person Fields
   * @category PersonFields
   *
   * @paramDef {"type":"String","label":"Identifiers","name":"ids","description":"Comma-separated list of IDs.","required":true}
   *
   * @returns {Object}
   */
  async deletePersonFields(ids) {
    const query = { ids: Array.isArray(ids) ? ids.join(',') : ids }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/personFields`,
      method: 'delete',
      query,
    })

    return response.data
  }

  /**
   * @description Returns details of a specific person field.
   * @route GET /personFields/:id
   * @operationName Get Person Field
   * @category PersonFields
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async getPersonField(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/personFields/${ id }`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Marks a person field as deleted.
   * @route DELETE /personFields/:id
   * @operationName Delete Person Field
   * @category PersonFields
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async deletePersonField(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/personFields/${ id }`,
      method: 'delete',
    })

    return response.data
  }

  /**
   * @description Updates the properties of a person field.
   * @route PUT /personFields/:id
   * @operationName Update Person Field
   * @category PersonFields
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the record.","required":false}
   * @paramDef {"type":"String","label":"Options","name":"options","description":"Options for the field (JSON array).","required":false}
   * @paramDef {"type":"Boolean","label":"Add Visible Flag","name":"add_visible_flag","description":"Whether the field is visible in add dialogs.","uiComponent":{"type":"TOGGLE"},"required":false}
   *
   * @returns {Object}
   */
  async updatePersonField(id, name, options, addVisibleFlag) {
    const body = {
      name,
      options,
      add_visible_flag: addVisibleFlag,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/personFields/${ id }`,
      method: 'put',
      body,
    })

    return response.data
  }


  // ======================================== PERSONS ========================================


  /**
   * @description Returns all persons.
   * @route GET /persons
   * @operationName List Persons
   * @category Persons
   *
   * @paramDef {"type":"Number","label":"User","name":"user_id","dictionary":"getUsersDictionary","description":"The user associated with this record. If omitted, uses the authenticated user.","required":true}
   * @paramDef {"type":"Number","label":"Filter","name":"filter_id","description":"Identifier of the filter to apply.","required":false}
   * @paramDef {"type":"String","label":"First Character","name":"first_char","description":"First character of the name.","required":false}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   * @paramDef {"type":"String","label":"Sort By","name":"sort","description":"Field to sort by (e.g., \"id DESC\").","required":false}
   *
   * @returns {Object}
   * @sampleResult [{"id":101,"name":"Jane Smith","owner_id":12345,"org_id":201,"email":[{"value":"jane.smith@example.com","primary":true,"label":"work"}],"phone":[{"value":"+1234567890","primary":true,"label":"work"}],"add_time":"2024-01-15 10:30:00","active_flag":true},{"id":102,"name":"John Brown","owner_id":12345,"org_id":202,"email":[{"value":"john.brown@example.com","primary":true,"label":"work"}],"phone":[{"value":"+1987654321","primary":true,"label":"mobile"}],"add_time":"2024-01-12 14:00:00","active_flag":true}]
   */
  async listPersons(userId, filterId, firstChar, start, limit, sort) {
    const query = {
      user_id: userId,
      filter_id: filterId,
      first_char: firstChar,
      start,
      limit,
      sort,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/persons`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Adds a new person.
   * @route POST /persons
   * @operationName Create Person
   * @category Persons
   *
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the record.","required":true}
   * @paramDef {"type":"Number","label":"Owner","name":"owner_id","description":"The user who owns this record.","required":false}
   * @paramDef {"type":"Number","label":"Organization","name":"org_id","dictionary":"getOrganizationsDictionary","description":"The organization associated with this record.","required":false}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Email address.","required":false}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Phone number.","required":false}
   * @paramDef {"type":"Number","label":"Label","name":"label","description":"Label identifier.","required":false}
   * @paramDef {"type":"String","label":"Label Identifiers","name":"label_ids","description":"List of label IDs.","required":false}
   * @paramDef {"type":"String","label":"Visible To","name":"visible_to","description":"Visibility of the record.","uiComponent":{"type":"DROPDOWN","options":{"values":["Owner & followers (private)","Entire company"]}},"required":false}
   * @paramDef {"type":"String","label":"Marketing Status","name":"marketing_status","description":"Marketing status of the person.","required":false}
   * @paramDef {"type":"String","label":"Created At","name":"add_time","description":"The creation date and time of the record (UTC).","required":false}
   *
   * @returns {Object}
   * @sampleResult {"id":101,"name":"Jane Smith","first_name":"Jane","last_name":"Smith","owner_id":12345,"org_id":201,"email":[{"value":"jane.smith@example.com","primary":true,"label":"work"}],"phone":[{"value":"+1234567890","primary":true,"label":"work"}],"add_time":"2024-01-15 10:30:00","update_time":"2024-01-15 10:30:00","active_flag":true,"visible_to":"3","marketing_status":"no_consent"}
   */
  async createPerson(name, ownerId, orgId, email, phone, label, labelIds, visibleTo, marketingStatus, addTime) {
    const body = {
      name,
      owner_id: ownerId,
      org_id: orgId,
      email,
      phone,
      label,
      label_ids: Array.isArray(labelIds) ? labelIds.join(',') : labelIds,
      visible_to: this.#resolveChoice(visibleTo, VISIBLE_TO_MAP),
      marketing_status: marketingStatus,
      add_time: addTime,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/persons`,
      method: 'post',
      body,
    })

    return response.data
  }

  /**
   * @description Returns all persons.
   * @route GET /persons/collection
   * @operationName List Persons Collection
   * @category Persons
   *
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving next page of results.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   * @paramDef {"type":"String","label":"Since","name":"since","description":"Timestamp to filter items modified since.","required":false}
   * @paramDef {"type":"String","label":"Until","name":"until","description":"Timestamp to filter items modified until.","required":false}
   * @paramDef {"type":"Number","label":"Owner","name":"owner_id","description":"The user who owns this record.","required":false}
   * @paramDef {"type":"String","label":"First Character","name":"first_char","description":"First character of the name.","required":false}
   *
   * @returns {Object}
   */
  async listPersonsCollection(cursor, limit, since, until, ownerId, firstChar) {
    const query = {
      cursor,
      limit,
      since,
      until,
      owner_id: ownerId,
      first_char: firstChar,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/persons/collection`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Searches all persons.
   * @route GET /persons/search
   * @operationName Search Persons
   * @category Persons
   *
   * @paramDef {"type":"String","label":"Search Term","name":"term","description":"The term to search for.","required":true}
   * @paramDef {"type":"Array","label":"Fields","name":"fields","description":"Array of field names to include in response.","required":false}
   * @paramDef {"type":"String","label":"Exact Match","name":"exact_match","description":"Whether to perform exact matching in search.","required":false}
   * @paramDef {"type":"Number","label":"Organization","name":"organization_id","description":"The organization associated with this record.","required":false}
   * @paramDef {"type":"Array","label":"Include Fields","name":"include_fields","description":"Array of additional fields to include.","required":false}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async searchPersons(term, fields, exactMatch, organizationId, includeFields, start, limit) {
    const query = {
      term,
      fields,
      exact_match: exactMatch,
      organization_id: organizationId,
      include_fields: includeFields,
      start,
      limit,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/persons/search`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Marks multiple persons as deleted.
   * @route DELETE /persons
   * @operationName Delete Persons
   * @category Persons
   *
   * @paramDef {"type":"String","label":"Identifiers","name":"ids","description":"Comma-separated list of IDs.","required":true}
   *
   * @returns {Object}
   */
  async deletePersons(ids) {
    const query = { ids: Array.isArray(ids) ? ids.join(',') : ids }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/persons`,
      method: 'delete',
      query,
    })

    return response.data
  }

  /**
   * @description Returns details of a specific person.
   * @route GET /persons/:id
   * @operationName Get Person
   * @category Persons
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   * @sampleResult {"id":101,"name":"Jane Smith","first_name":"Jane","last_name":"Smith","owner_id":12345,"org_id":201,"email":[{"value":"jane.smith@example.com","primary":true,"label":"work"}],"phone":[{"value":"+1234567890","primary":true,"label":"work"}],"add_time":"2024-01-15 10:30:00","update_time":"2024-01-20 09:00:00","active_flag":true,"visible_to":"3","open_deals_count":2,"closed_deals_count":1,"activities_count":5}
   */
  async getPerson(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/persons/${ id }`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Updates the properties of a person.
   * @route PUT /persons/:id
   * @operationName Update Person
   * @category Persons
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the record.","required":false}
   * @paramDef {"type":"Number","label":"Owner","name":"owner_id","description":"The user who owns this record.","required":false}
   * @paramDef {"type":"Number","label":"Organization","name":"org_id","dictionary":"getOrganizationsDictionary","description":"The organization associated with this record.","required":false}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Email address.","required":false}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Phone number.","required":false}
   * @paramDef {"type":"Number","label":"Label","name":"label","description":"Label identifier.","required":false}
   * @paramDef {"type":"String","label":"Label Identifiers","name":"label_ids","description":"List of label IDs.","required":false}
   * @paramDef {"type":"String","label":"Visible To","name":"visible_to","description":"Visibility of the record.","uiComponent":{"type":"DROPDOWN","options":{"values":["Owner & followers (private)","Entire company"]}},"required":false}
   * @paramDef {"type":"String","label":"Marketing Status","name":"marketing_status","description":"Marketing status of the person.","required":false}
   * @paramDef {"type":"String","label":"Created At","name":"add_time","description":"The creation date and time of the record (UTC).","required":false}
   *
   * @returns {Object}
   * @sampleResult {"id":101,"name":"Jane A. Smith","first_name":"Jane","last_name":"A. Smith","owner_id":12345,"org_id":201,"email":[{"value":"jane.smith@newcorp.com","primary":true,"label":"work"}],"phone":[{"value":"+1234567890","primary":true,"label":"work"}],"add_time":"2024-01-15 10:30:00","update_time":"2024-01-25 12:10:00","active_flag":true,"visible_to":"3","marketing_status":"subscribed"}
   */
  async updatePerson(id, name, ownerId, orgId, email, phone, label, labelIds, visibleTo, marketingStatus, addTime) {
    const body = {
      name,
      owner_id: ownerId,
      org_id: orgId,
      email,
      phone,
      label,
      label_ids: Array.isArray(labelIds) ? labelIds.join(',') : labelIds,
      visible_to: this.#resolveChoice(visibleTo, VISIBLE_TO_MAP),
      marketing_status: marketingStatus,
      add_time: addTime,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/persons/${ id }`,
      method: 'put',
      body,
    })

    return response.data
  }

  /**
   * @description Marks a person as deleted.
   * @route DELETE /persons/:id
   * @operationName Delete Person
   * @category Persons
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async deletePerson(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/persons/${ id }`,
      method: 'delete',
    })

    return response.data
  }

  /**
   * @description Returns all activities associated with a person.
   * @route GET /persons/:id/activities
   * @operationName List Person Activities
   * @category Persons
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   * @paramDef {"type":"Boolean","label":"Mark as Done","name":"done","description":"Whether the activity is completed.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Array","label":"Exclude","name":"exclude","description":"Items to exclude from results.","required":false}
   *
   * @returns {Object}
   */
  async listPersonActivities(id, start, limit, done, exclude) {
    const query = {
      start,
      limit,
      done,
      exclude,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/persons/${ id }/activities`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Returns updates about person field values.
   * @route GET /persons/:id/changelog
   * @operationName List Person Updates
   * @category Persons
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving next page of results.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async listPersonUpdates(id, cursor, limit) {
    const query = { cursor, limit }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/persons/${ id }/changelog`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Returns all deals associated with a person.
   * @route GET /persons/:id/deals
   * @operationName List Person Deals
   * @category Persons
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"The status of the record.","uiComponent":{"type":"DROPDOWN","options":{"values":[]}},"required":false}
   * @paramDef {"type":"String","label":"Sort By","name":"sort","description":"Field to sort by (e.g., \"id DESC\").","required":false}
   *
   * @returns {Object}
   */
  async listPersonDeals(id, start, limit, status, sort) {
    const query = {
      start,
      limit,
      status,
      sort,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/persons/${ id }/deals`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Returns all files attached to a person.
   * @route GET /persons/:id/files
   * @operationName List Person Files
   * @category Persons
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   * @paramDef {"type":"String","label":"Sort By","name":"sort","description":"Field to sort by (e.g., \"id DESC\").","required":false}
   *
   * @returns {Object}
   */
  async listPersonFiles(id, start, limit, sort) {
    const query = { start, limit, sort }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/persons/${ id }/files`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Returns updates about a person.
   * @route GET /persons/:id/flow
   * @operationName List Person Flow
   * @category Persons
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   * @paramDef {"type":"Number","label":"All Changes","name":"all_changes","description":"Include all changes since specified date.","uiComponent":{"type":"DATE_PICKER"},"required":false}
   * @paramDef {"type":"Array","label":"Items","name":"items","description":"Array of items.","required":false}
   *
   * @returns {Object}
   */
  async listPersonFlow(id, start, limit, allChanges, items) {
    const query = {
      start,
      limit,
      all_changes: allChanges,
      items,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/persons/${ id }/flow`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Returns all followers of a person.
   * @route GET /persons/:id/followers
   * @operationName List Person Followers
   * @category Persons
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async listPersonFollowers(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/persons/${ id }/followers`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Adds a follower to a person.
   * @route POST /persons/:id/followers
   * @operationName Add Person Follower
   * @category Persons
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"User","name":"user_id","dictionary":"getUsersDictionary","description":"The user associated with this record. If omitted, uses the authenticated user.","required":true}
   *
   * @returns {Object}
   */
  async addPersonFollower(id, userId) {
    const body = { user_id: userId }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/persons/${ id }/followers`,
      method: 'post',
      body,
    })

    return response.data
  }

  /**
   * @description Removes a follower from a person.
   * @route DELETE /persons/:id/followers/:follower_id
   * @operationName Delete Person Follower
   * @category Persons
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Follower","name":"follower_id","description":"Identifier of the follower user.","required":true}
   *
   * @returns {Object}
   */
  async deletePersonFollower(id, followerId) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/persons/${ id }/followers/${ followerId }`,
      method: 'delete',
    })

    return response.data
  }

  /**
   * @description Returns all mail messages associated with a person.
   * @route GET /persons/:id/mailMessages
   * @operationName List Person Mail Messages
   * @category Persons
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async listPersonMailMessages(id, start, limit) {
    const query = { start, limit }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/persons/${ id }/mailMessages`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Merges a person with another person.
   * @route PUT /persons/:id/merge
   * @operationName Merge Persons
   * @category Persons
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Merge With","name":"merge_with_id","description":"Identifier of the organization to merge with.","required":true}
   *
   * @returns {Object}
   */
  async mergePersons(id, mergeWithId) {
    const body = { merge_with_id: mergeWithId }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/persons/${ id }/merge`,
      method: 'put',
      body,
    })

    return response.data
  }

  /**
   * @description Returns users permitted to access a person.
   * @route GET /persons/:id/permittedUsers
   * @operationName List Person Permitted Users
   * @category Persons
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async listPersonPermittedUsers(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/persons/${ id }/permittedUsers`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Deletes a person's picture.
   * @route DELETE /persons/:id/picture
   * @operationName Delete Person Picture
   * @category Persons
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async deletePersonPicture(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/persons/${ id }/picture`,
      method: 'delete',
    })

    return response.data
  }

  /**
   * @description Uploads a picture for a person.
   * @route POST /persons/:id/picture
   * @operationName Upload Person Picture
   * @category Persons
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"String","label":"File","name":"file","description":"The file to upload.","required":true}
   * @paramDef {"type":"Number","label":"Crop X","name":"crop_x","description":"X coordinate of the crop.","required":false}
   * @paramDef {"type":"Number","label":"Crop Y","name":"crop_y","description":"Y coordinate of the crop.","required":false}
   * @paramDef {"type":"Number","label":"Crop Width","name":"crop_width","description":"Width of the crop.","required":false}
   * @paramDef {"type":"Number","label":"Crop Height","name":"crop_height","description":"Height of the crop.","required":false}
   *
   * @returns {Object}
   */
  async uploadPersonPicture(id, file, cropX, cropY, cropWidth, cropHeight) {
    const body = {
      file,
      crop_x: cropX,
      crop_y: cropY,
      crop_width: cropWidth,
      crop_height: cropHeight,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/persons/${ id }/picture`,
      method: 'post',
      body,
    })

    return response.data
  }

  /**
   * @description Returns all products associated with a person.
   * @route GET /persons/:id/products
   * @operationName List Person Products
   * @category Persons
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async listPersonProducts(id, start, limit) {
    const query = { start, limit }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/persons/${ id }/products`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }


  // ======================================== PIPELINES ========================================


  /**
   * @description Returns all pipelines.
   * @route GET /pipelines
   * @operationName List Pipelines
   * @category Pipelines
   *
   * @returns {Object}
   */
  async listPipelines() {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/pipelines`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Adds a new pipeline.
   * @route POST /pipelines
   * @operationName Create Pipeline
   * @category Pipelines
   *
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the record.","required":false}
   * @paramDef {"type":"Boolean","label":"Deal Probability","name":"deal_probability","description":"Deal probability.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Number","label":"Order Number","name":"order_nr","description":"Order number.","required":false}
   * @paramDef {"type":"Boolean","label":"Active","name":"active","description":"Whether the pipeline is active.","uiComponent":{"type":"TOGGLE"},"required":false}
   *
   * @returns {Object}
   */
  async createPipeline(name, dealProbability, orderNr, active) {
    const body = {
      name,
      deal_probability: dealProbability,
      order_nr: orderNr,
      active,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/pipelines`,
      method: 'post',
      body,
    })

    return response.data
  }

  /**
   * @description Marks a pipeline as deleted.
   * @route DELETE /pipelines/:id
   * @operationName Delete Pipeline
   * @category Pipelines
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async deletePipeline(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/pipelines/${ id }`,
      method: 'delete',
    })

    return response.data
  }

  /**
   * @description Returns details of a specific pipeline.
   * @route GET /pipelines/:id
   * @operationName Get Pipeline
   * @category Pipelines
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async getPipeline(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/pipelines/${ id }`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Updates the properties of a pipeline.
   * @route PUT /pipelines/:id
   * @operationName Update Pipeline
   * @category Pipelines
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the record.","required":false}
   * @paramDef {"type":"Boolean","label":"Deal Probability","name":"deal_probability","description":"Deal probability.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Number","label":"Order Number","name":"order_nr","description":"Order number.","required":false}
   * @paramDef {"type":"Boolean","label":"Active","name":"active","description":"Whether the pipeline is active.","uiComponent":{"type":"TOGGLE"},"required":false}
   *
   * @returns {Object}
   */
  async updatePipeline(id, name, dealProbability, orderNr, active) {
    const body = {
      name,
      deal_probability: dealProbability,
      order_nr: orderNr,
      active,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/pipelines/${ id }`,
      method: 'put',
      body,
    })

    return response.data
  }

  /**
   * @description Returns conversion rates for a pipeline.
   * @route GET /pipelines/:id/conversion_statistics
   * @operationName Get Pipeline Conversion Rates
   * @category Pipelines
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Start Date and Time","name":"startDateTime","description":"Start date and time for filtering results. Will be automatically formatted for Pipedrive.","uiComponent":{"type":"DATE_TIME_PICKER"},"required":false}
   * @paramDef {"type":"Number","label":"End Date and Time","name":"endDateTime","description":"End date and time for filtering results. Will be automatically formatted for Pipedrive.","uiComponent":{"type":"DATE_TIME_PICKER"},"required":false}
   * @paramDef {"type":"Number","label":"User","name":"user_id","dictionary":"getUsersDictionary","description":"The user associated with this record. If omitted, uses the authenticated user.","required":false}
   *
   * @returns {Object}
   */
  async getPipelineConversionRates(id, startDate, endDate, userId) {
    const query = {
      start_date: startDate,
      end_date: endDate,
      user_id: userId,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/pipelines/${ id }/conversion_statistics`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Returns deals in a pipeline.
   * @route GET /pipelines/:id/deals
   * @operationName Get Pipeline Deals
   * @category Pipelines
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Filter","name":"filter_id","description":"Identifier of the filter to apply.","required":false}
   * @paramDef {"type":"Number","label":"User","name":"user_id","dictionary":"getUsersDictionary","description":"The user associated with this record. If omitted, uses the authenticated user.","required":false}
   * @paramDef {"type":"Boolean","label":"Everyone","name":"everyone","description":"Show deals for everyone.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Number","label":"Stage","name":"stage_id","dictionary":"getStagesDictionary","description":"The stage associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   * @paramDef {"type":"Boolean","label":"Get Summary","name":"get_summary","description":"Get summary.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"String","label":"Totals Convert Currency","name":"totals_convert_currency","description":"Currency to convert totals to.","required":false}
   *
   * @returns {Object}
   */
  async getPipelineDeals(id, filterId, userId, everyone, stageId, start, limit, getSummary, totalsConvertCurrency) {
    const query = {
      filter_id: filterId,
      user_id: userId,
      everyone,
      stage_id: stageId,
      start,
      limit,
      get_summary: getSummary,
      totals_convert_currency: totalsConvertCurrency,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/pipelines/${ id }/deals`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Returns movement statistics for a pipeline.
   * @route GET /pipelines/:id/movement_statistics
   * @operationName Get Pipeline Movement Statistics
   * @category Pipelines
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Start Date and Time","name":"startDateTime","description":"Start date and time for filtering results. Will be automatically formatted for Pipedrive.","uiComponent":{"type":"DATE_TIME_PICKER"},"required":false}
   * @paramDef {"type":"Number","label":"End Date and Time","name":"endDateTime","description":"End date and time for filtering results. Will be automatically formatted for Pipedrive.","uiComponent":{"type":"DATE_TIME_PICKER"},"required":false}
   * @paramDef {"type":"Number","label":"User","name":"user_id","dictionary":"getUsersDictionary","description":"The user associated with this record. If omitted, uses the authenticated user.","required":false}
   *
   * @returns {Object}
   */
  async getPipelineMovementStatistics(id, startDate, endDate, userId) {
    const query = {
      start_date: startDate,
      end_date: endDate,
      user_id: userId,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/pipelines/${ id }/movement_statistics`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }


  // ======================================== PRODUCTFIELDS ========================================


  /**
   * @description Returns all product fields.
   * @route GET /productFields
   * @operationName List Product Fields
   * @category ProductFields
   *
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async listProductFields(start, limit) {
    const query = { start, limit }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/productFields`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Adds a new product field.
   * @route POST /productFields
   * @operationName Create Product Field
   * @category ProductFields
   *
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the record.","required":false}
   * @paramDef {"type":"String","label":"Field Type","name":"field_type","description":"Type of the field.","required":true}
   * @paramDef {"type":"String","label":"Options","name":"options","description":"Options for the field (JSON array).","required":false}
   *
   * @returns {Object}
   */
  async createProductField(name, fieldType, options) {
    const body = {
      name,
      field_type: fieldType,
      options,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/productFields`,
      method: 'post',
      body,
    })

    return response.data
  }

  /**
   * @description Marks multiple product fields as deleted.
   * @route DELETE /productFields
   * @operationName Delete Product Fields
   * @category ProductFields
   *
   * @paramDef {"type":"String","label":"Identifiers","name":"ids","description":"Comma-separated list of IDs.","required":true}
   *
   * @returns {Object}
   */
  async deleteProductFields(ids) {
    const query = { ids: Array.isArray(ids) ? ids.join(',') : ids }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/productFields`,
      method: 'delete',
      query,
    })

    return response.data
  }

  /**
   * @description Returns details of a specific product field.
   * @route GET /productFields/:id
   * @operationName Get Product Field
   * @category ProductFields
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async getProductField(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/productFields/${ id }`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Marks a product field as deleted.
   * @route DELETE /productFields/:id
   * @operationName Delete Product Field
   * @category ProductFields
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async deleteProductField(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/productFields/${ id }`,
      method: 'delete',
    })

    return response.data
  }

  /**
   * @description Updates the properties of a product field.
   * @route PUT /productFields/:id
   * @operationName Update Product Field
   * @category ProductFields
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the record.","required":false}
   * @paramDef {"type":"String","label":"Options","name":"options","description":"Options for the field (JSON array).","required":false}
   *
   * @returns {Object}
   */
  async updateProductField(id, name, options) {
    const body = {
      name,
      options,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/productFields/${ id }`,
      method: 'put',
      body,
    })

    return response.data
  }


  // ======================================== PRODUCTS ========================================


  /**
   * @description Returns all products.
   * @route GET /products
   * @operationName List Products
   * @category Products
   *
   * @paramDef {"type":"Number","label":"User","name":"user_id","dictionary":"getUsersDictionary","description":"The user associated with this record. If omitted, uses the authenticated user.","required":true}
   * @paramDef {"type":"Number","label":"Filter","name":"filter_id","description":"Identifier of the filter to apply.","required":false}
   * @paramDef {"type":"String","label":"Identifiers","name":"ids","description":"Comma-separated list of IDs.","required":false}
   * @paramDef {"type":"String","label":"First Character","name":"first_char","description":"First character of the name.","required":false}
   * @paramDef {"type":"Boolean","label":"Get Summary","name":"get_summary","description":"Get summary.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async listProducts(userId, filterId, ids, firstChar, getSummary, start, limit) {
    const query = {
      user_id: userId,
      filter_id: filterId,
      ids: Array.isArray(ids) ? ids.join(',') : ids,
      first_char: firstChar,
      get_summary: getSummary,
      start,
      limit,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/products`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Adds a new product.
   * @route POST /products
   * @operationName Create Product
   * @category Products
   *
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the record.","required":false}
   * @paramDef {"type":"String","label":"Auth Code","name":"code","description":"OAuth authorization code.","required":false}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Description of the record.","uiComponent":{"type":"MULTI_LINE_TEXT"},"required":false}
   * @paramDef {"type":"String","label":"Unit","name":"unit","description":"Unit of the product.","required":false}
   * @paramDef {"type":"Number","label":"Tax","name":"tax","description":"Tax percentage.","required":false}
   * @paramDef {"type":"Boolean","label":"Active","name":"active_flag","description":"Whether the record is active.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Boolean","label":"Selectable","name":"selectable","description":"Whether the product is selectable.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"String","label":"Visible To","name":"visible_to","description":"Visibility of the record.","uiComponent":{"type":"DROPDOWN","options":{"values":["Owner & followers (private)","Entire company"]}},"required":false}
   * @paramDef {"type":"Number","label":"Owner","name":"owner_id","description":"The user who owns this record.","required":false}
   * @paramDef {"type":"String","label":"Prices","name":"prices","description":"Product prices (JSON array).","required":false}
   * @paramDef {"type":"String","label":"Billing Frequency","name":"billing_frequency","description":"Billing frequency.","required":false}
   * @paramDef {"type":"Number","label":"Billing Frequency Cycles","name":"billing_frequency_cycles","description":"Number of billing frequency cycles.","required":false}
   *
   * @returns {Object}
   */
  async createProduct(name, code, description, unit, tax, activeFlag, selectable, visibleTo, ownerId, prices, billingFrequency, billingFrequencyCycles) {
    const body = {
      name,
      code,
      description,
      unit,
      tax,
      active_flag: activeFlag,
      selectable,
      visible_to: this.#resolveChoice(visibleTo, VISIBLE_TO_MAP),
      owner_id: ownerId,
      prices,
      billing_frequency: billingFrequency,
      billing_frequency_cycles: billingFrequencyCycles,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/products`,
      method: 'post',
      body,
    })

    return response.data
  }

  /**
   * @description Searches all products.
   * @route GET /products/search
   * @operationName Search Products
   * @category Products
   *
   * @paramDef {"type":"String","label":"Search Term","name":"term","description":"The term to search for.","required":true}
   * @paramDef {"type":"Array","label":"Fields","name":"fields","description":"Array of field names to include in response.","required":false}
   * @paramDef {"type":"String","label":"Exact Match","name":"exact_match","description":"Whether to perform exact matching in search.","required":false}
   * @paramDef {"type":"Array","label":"Include Fields","name":"include_fields","description":"Array of additional fields to include.","required":false}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async searchProducts(term, fields, exactMatch, includeFields, start, limit) {
    const query = {
      term,
      fields,
      exact_match: exactMatch,
      include_fields: includeFields,
      start,
      limit,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/products/search`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Marks a product as deleted.
   * @route DELETE /products/:id
   * @operationName Delete Product
   * @category Products
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async deleteProduct(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/products/${ id }`,
      method: 'delete',
    })

    return response.data
  }

  /**
   * @description Returns details of a specific product.
   * @route GET /products/:id
   * @operationName Get Product
   * @category Products
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async getProduct(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/products/${ id }`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Updates the properties of a product.
   * @route PUT /products/:id
   * @operationName Update Product
   * @category Products
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the record.","required":false}
   * @paramDef {"type":"String","label":"Auth Code","name":"code","description":"OAuth authorization code.","required":false}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Description of the record.","uiComponent":{"type":"MULTI_LINE_TEXT"},"required":false}
   * @paramDef {"type":"String","label":"Unit","name":"unit","description":"Unit of the product.","required":false}
   * @paramDef {"type":"Number","label":"Tax","name":"tax","description":"Tax percentage.","required":false}
   * @paramDef {"type":"Boolean","label":"Active","name":"active_flag","description":"Whether the record is active.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Boolean","label":"Selectable","name":"selectable","description":"Whether the product is selectable.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"String","label":"Visible To","name":"visible_to","description":"Visibility of the record.","uiComponent":{"type":"DROPDOWN","options":{"values":["Owner & followers (private)","Entire company"]}},"required":false}
   * @paramDef {"type":"Number","label":"Owner","name":"owner_id","description":"The user who owns this record.","required":false}
   * @paramDef {"type":"String","label":"Prices","name":"prices","description":"Product prices (JSON array).","required":false}
   * @paramDef {"type":"String","label":"Billing Frequency","name":"billing_frequency","description":"Billing frequency.","required":false}
   * @paramDef {"type":"Number","label":"Billing Frequency Cycles","name":"billing_frequency_cycles","description":"Number of billing frequency cycles.","required":false}
   *
   * @returns {Object}
   */
  async updateProduct(id, name, code, description, unit, tax, activeFlag, selectable, visibleTo, ownerId, prices, billingFrequency, billingFrequencyCycles) {
    const body = {
      name,
      code,
      description,
      unit,
      tax,
      active_flag: activeFlag,
      selectable,
      visible_to: this.#resolveChoice(visibleTo, VISIBLE_TO_MAP),
      owner_id: ownerId,
      prices,
      billing_frequency: billingFrequency,
      billing_frequency_cycles: billingFrequencyCycles,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/products/${ id }`,
      method: 'put',
      body,
    })

    return response.data
  }

  /**
   * @description Returns all deals where product is attached.
   * @route GET /products/:id/deals
   * @operationName List Product Deals
   * @category Products
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"The status of the record.","uiComponent":{"type":"DROPDOWN","options":{"values":[]}},"required":false}
   *
   * @returns {Object}
   */
  async listProductDeals(id, start, limit, status) {
    const query = { start, limit, status }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/products/${ id }/deals`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Returns all files attached to a product.
   * @route GET /products/:id/files
   * @operationName List Product Files
   * @category Products
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   * @paramDef {"type":"String","label":"Sort By","name":"sort","description":"Field to sort by (e.g., \"id DESC\").","required":false}
   *
   * @returns {Object}
   */
  async listProductFiles(id, start, limit, sort) {
    const query = { start, limit, sort }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/products/${ id }/files`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Returns all followers of a product.
   * @route GET /products/:id/followers
   * @operationName List Product Followers
   * @category Products
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async listProductFollowers(id, start, limit) {
    const query = { start, limit }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/products/${ id }/followers`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Adds a follower to a product.
   * @route POST /products/:id/followers
   * @operationName Add Product Follower
   * @category Products
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"User","name":"user_id","dictionary":"getUsersDictionary","description":"The user associated with this record. If omitted, uses the authenticated user.","required":true}
   *
   * @returns {Object}
   */
  async addProductFollower(id, userId) {
    const body = { user_id: userId }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/products/${ id }/followers`,
      method: 'post',
      body,
    })

    return response.data
  }

  /**
   * @description Removes a follower from a product.
   * @route DELETE /products/:id/followers/:follower_id
   * @operationName Delete Product Follower
   * @category Products
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Follower","name":"follower_id","description":"Identifier of the follower user.","required":true}
   *
   * @returns {Object}
   */
  async deleteProductFollower(id, followerId) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/products/${ id }/followers/${ followerId }`,
      method: 'delete',
    })

    return response.data
  }

  /**
   * @description Returns users permitted to access a product.
   * @route GET /products/:id/permittedUsers
   * @operationName List Product Permitted Users
   * @category Products
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async listProductPermittedUsers(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/products/${ id }/permittedUsers`,
      method: 'get',
    })

    return response.data
  }


  // ======================================== PROJECTS ========================================


  /**
   * @description Returns all projects.
   * @route GET /projects
   * @operationName List projects
   * @category Projects
   *
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving next page of results.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   * @paramDef {"type":"Number","label":"Filter","name":"filter_id","description":"Identifier of the filter to apply.","required":false}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"The status of the record.","uiComponent":{"type":"DROPDOWN","options":{"values":[]}},"required":false}
   * @paramDef {"type":"Number","label":"Phase","name":"phase_id","description":"Identifier of the project phase.","required":false}
   * @paramDef {"type":"String","label":"Include Archived","name":"include_archived","description":"Whether to include archived items in results.","required":false}
   *
   * @returns {Object}
   */
  async listProjects(cursor, limit, filterId, status, phaseId, includeArchived) {
    const query = { cursor: cursor, limit: limit, filter_id: filterId, status: status, phase_id: phaseId, include_archived: includeArchived }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/projects`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Adds a new project.
   * @route POST /projects
   * @operationName Create project
   * @category Projects
   *
   * @paramDef {"type":"String","label":"Title","name":"title","description":"The title of the record.","required":false}
   * @paramDef {"type":"Number","label":"Board","name":"board_id","description":"Identifier of the project board.","required":false}
   * @paramDef {"type":"Number","label":"Phase","name":"phase_id","description":"Identifier of the project phase.","required":false}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Description of the record.","uiComponent":{"type":"MULTI_LINE_TEXT"},"required":false}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"The status of the record.","uiComponent":{"type":"DROPDOWN","options":{"values":[]}},"required":false}
   * @paramDef {"type":"Number","label":"Owner","name":"owner_id","description":"The user who owns this record.","required":false}
   * @paramDef {"type":"Number","label":"Start Date and Time","name":"startDateTime","description":"Start date and time for filtering results. Will be automatically formatted for Pipedrive.","uiComponent":{"type":"DATE_TIME_PICKER"},"required":false}
   * @paramDef {"type":"Number","label":"End Date and Time","name":"endDateTime","description":"End date and time for filtering results. Will be automatically formatted for Pipedrive.","uiComponent":{"type":"DATE_TIME_PICKER"},"required":false}
   * @paramDef {"type":"Number","label":"Deal IDs","name":"deal_ids","description":"Deal IDs (comma-separated).","required":false}
   * @paramDef {"type":"Number","label":"Organization","name":"org_id","dictionary":"getOrganizationsDictionary","description":"The organization associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Person","name":"person_id","dictionary":"getPersonsDictionary","description":"The person associated with this record.","required":false}
   * @paramDef {"type":"String","label":"Labels","name":"labels","description":"Labels or tags for categorization.","required":false}
   * @paramDef {"type":"Number","label":"Template","name":"template_id","description":"Identifier of the template.","required":false}
   *
   * @returns {Object}
   */
  async createProject(title, boardId, phaseId, description, status, ownerId, startDate, endDate, dealIds, orgId, personId, labels, templateId) {
    const body = { title: title, board_id: boardId, phase_id: phaseId, description: description, status: status, owner_id: ownerId, start_date: startDate, end_date: endDate, deal_ids: Array.isArray(dealIds) ? dealIds.join(',') : dealIds, org_id: orgId, person_id: personId, labels: labels, template_id: templateId }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/projects`,
      method: 'post',
      body: Object.keys(body).length ? body : undefined,
    })

    return response.data
  }

  /**
   * @description Returns details of a specific project.
   * @route GET /projects/:id
   * @operationName Get details of project
   * @category Projects
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async getDetailsOfProject(id) {

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/projects/${ id }`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Updates the properties of a project.
   * @route PUT /projects/:id
   * @operationName Update project
   * @category Projects
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"The title of the record.","required":false}
   * @paramDef {"type":"Number","label":"Board","name":"board_id","description":"Identifier of the project board.","required":false}
   * @paramDef {"type":"Number","label":"Phase","name":"phase_id","description":"Identifier of the project phase.","required":false}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Description of the record.","uiComponent":{"type":"MULTI_LINE_TEXT"},"required":false}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"The status of the record.","uiComponent":{"type":"DROPDOWN","options":{"values":[]}},"required":false}
   * @paramDef {"type":"Number","label":"Owner","name":"owner_id","description":"The user who owns this record.","required":false}
   * @paramDef {"type":"Number","label":"Start Date and Time","name":"startDateTime","description":"Start date and time for filtering results. Will be automatically formatted for Pipedrive.","uiComponent":{"type":"DATE_TIME_PICKER"},"required":false}
   * @paramDef {"type":"Number","label":"End Date and Time","name":"endDateTime","description":"End date and time for filtering results. Will be automatically formatted for Pipedrive.","uiComponent":{"type":"DATE_TIME_PICKER"},"required":false}
   * @paramDef {"type":"Number","label":"Deal IDs","name":"deal_ids","description":"Deal IDs (comma-separated).","required":false}
   * @paramDef {"type":"Number","label":"Organization","name":"org_id","dictionary":"getOrganizationsDictionary","description":"The organization associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Person","name":"person_id","dictionary":"getPersonsDictionary","description":"The person associated with this record.","required":false}
   * @paramDef {"type":"String","label":"Labels","name":"labels","description":"Labels or tags for categorization.","required":false}
   *
   * @returns {Object}
   */
  async updateProject(id, title, boardId, phaseId, description, status, ownerId, startDate, endDate, dealIds, orgId, personId, labels) {
    const body = { title: title, board_id: boardId, phase_id: phaseId, description: description, status: status, owner_id: ownerId, start_date: startDate, end_date: endDate, deal_ids: Array.isArray(dealIds) ? dealIds.join(',') : dealIds, org_id: orgId, person_id: personId, labels: labels }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/projects/${ id }`,
      method: 'put',
      body: Object.keys(body).length ? body : undefined,
    })

    return response.data
  }

  /**
   * @description Marks a project as deleted.
   * @route DELETE /projects/:id
   * @operationName Delete project
   * @category Projects
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async deleteProject(id) {

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/projects/${ id }`,
      method: 'delete',
    })

    return response.data
  }

  /**
   * @description Archives a project.
   * @route POST /projects/:id/archive
   * @operationName Archive project
   * @category Projects
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async archiveProject(id) {

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/projects/${ id }/archive`,
      method: 'post',
    })

    return response.data
  }

  /**
   * @description Returns information about items in a project plan. Items consists of tasks and activities and are li...
   * @route GET /projects/:id/plan
   * @operationName Returns project plan
   * @category Projects
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async returnsProjectPlan(id) {

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/projects/${ id }/plan`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Updates the properties of a project.
   * @route PUT /projects/:id/plan/activities/:activityId
   * @operationName Update activity in project plan
   * @category Projects
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Activity","name":"activity_id","description":"The activity associated with this record.","required":true}
   * @paramDef {"type":"Number","label":"Phase","name":"phase_id","description":"Identifier of the project phase.","required":false}
   * @paramDef {"type":"Number","label":"Group","name":"group_id","description":"Identifier of the group.","required":false}
   *
   * @returns {Object}
   */
  async updateActivityInProjectPlan(id, activityid, phaseId, groupId) {
    const body = { phase_id: phaseId, group_id: groupId }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/projects/${ id }/plan/activities/${ activityid }`,
      method: 'put',
      body: Object.keys(body).length ? body : undefined,
    })

    return response.data
  }

  /**
   * @description Updates the properties of a project.
   * @route PUT /projects/:id/plan/tasks/:taskId
   * @operationName Update task in project plan
   * @category Projects
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Task","name":"task_id","description":"Identifier of the task.","required":true}
   * @paramDef {"type":"Number","label":"Phase","name":"phase_id","description":"Identifier of the project phase.","required":false}
   * @paramDef {"type":"Number","label":"Group","name":"group_id","description":"Identifier of the group.","required":false}
   *
   * @returns {Object}
   */
  async updateTaskInProjectPlan(id, taskid, phaseId, groupId) {
    const body = { phase_id: phaseId, group_id: groupId }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/projects/${ id }/plan/tasks/${ taskid }`,
      method: 'put',
      body: Object.keys(body).length ? body : undefined,
    })

    return response.data
  }

  /**
   * @description Returns all active groups under a specific project.
   * @route GET /projects/:id/groups
   * @operationName Returns project groups
   * @category Projects
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async returnsProjectGroups(id) {

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/projects/${ id }/groups`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Returns tasks linked to a specific project.
   * @route GET /projects/:id/tasks
   * @operationName Returns project tasks
   * @category Projects
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async returnsProjectTasks(id) {

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/projects/${ id }/tasks`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Returns activities linked to a specific project.
   * @route GET /projects/:id/activities
   * @operationName Returns project activities
   * @category Projects
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async returnsProjectActivities(id) {

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/projects/${ id }/activities`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Returns all projects.
   * @route GET /projects/boards
   * @operationName List project boards
   * @category Projects
   *
   * @returns {Object}
   */
  async listProjectBoards() {

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/projects/boards`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Returns details of a specific project.
   * @route GET /projects/phases
   * @operationName Get project phases
   * @category Projects
   *
   * @paramDef {"type":"Number","label":"Board","name":"board_id","description":"Identifier of the project board.","required":false}
   *
   * @returns {Object}
   */
  async getProjectPhases(boardId) {
    const query = { board_id: boardId }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/projects/phases`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }


  // ======================================== PROJECTTEMPLATES ========================================


  /**
   * @description Returns all project templates.
   * @route GET /projectTemplates
   * @operationName List Project Templates
   * @category ProjectTemplates
   *
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving next page of results.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async listProjectTemplates(cursor, limit) {
    const query = { cursor, limit }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/projectTemplates`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Returns details of a specific project template.
   * @route GET /projectTemplates/:id
   * @operationName Get Project Template
   * @category ProjectTemplates
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async getProjectTemplate(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/projectTemplates/${ id }`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Returns details of a specific project board.
   * @route GET /projects/boards/:id
   * @operationName Get Project Board
   * @category ProjectTemplates
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async getProjectBoard(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/projects/boards/${ id }`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Returns details of a specific project phase.
   * @route GET /projects/phases/:id
   * @operationName Get Project Phase
   * @category ProjectTemplates
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async getProjectPhase(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/projects/phases/${ id }`,
      method: 'get',
    })

    return response.data
  }


  // ======================================== RECENTS ========================================


  /**
   * @description Returns recently viewed items.
   * @route GET /recents
   * @operationName Get Recents
   * @category Recents
   *
   * @paramDef {"type":"String","label":"Since Timestamp","name":"since_timestamp","description":"Search for items modified since this timestamp.","required":false}
   * @paramDef {"type":"Array","label":"Items","name":"items","description":"Array of items.","required":false}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async getRecents(sinceTimestamp, items, start, limit) {
    const query = {
      since_timestamp: sinceTimestamp,
      items,
      start,
      limit,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/recents`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }


  // ======================================== ROLES ========================================


  /**
   * @description Returns all roles.
   * @route GET /roles
   * @operationName List roles
   * @category Roles
   *
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async listRoles(start, limit) {
    const query = { start: start, limit: limit }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/roles`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Adds a new role.
   * @route POST /roles
   * @operationName Create role
   * @category Roles
   *
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the record.","required":false}
   * @paramDef {"type":"Number","label":"Parent Role","name":"parent_role_id","description":"Identifier of the parent role.","required":false}
   *
   * @returns {Object}
   */
  async createRole(name, parentRoleId) {
    const body = { name: name, parent_role_id: parentRoleId }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/roles`,
      method: 'post',
      body: Object.keys(body).length ? body : undefined,
    })

    return response.data
  }

  /**
   * @description Marks a role as deleted.
   * @route DELETE /roles/:id
   * @operationName Delete role
   * @category Roles
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async deleteRole(id) {

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/roles/${ id }`,
      method: 'delete',
    })

    return response.data
  }

  /**
   * @description Returns details of a specific role.
   * @route GET /roles/:id
   * @operationName Get one role
   * @category Roles
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async getOneRole(id) {

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/roles/${ id }`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Updates the properties of a role.
   * @route PUT /roles/:id
   * @operationName Update role details
   * @category Roles
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Parent Role","name":"parent_role_id","description":"Identifier of the parent role.","required":false}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the record.","required":false}
   *
   * @returns {Object}
   */
  async updateRoleDetails(id, parentRoleId, name) {
    const body = { parent_role_id: parentRoleId, name: name }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/roles/${ id }`,
      method: 'put',
      body: Object.keys(body).length ? body : undefined,
    })

    return response.data
  }

  /**
   * @description Marks a role as deleted.
   * @route DELETE /roles/:id/assignments
   * @operationName Delete role assignment
   * @category Roles
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"User","name":"user_id","dictionary":"getUsersDictionary","description":"The user associated with this record. If omitted, uses the authenticated user.","required":false}
   *
   * @returns {Object}
   */
  async deleteRoleAssignment(id, userId) {
    const body = { user_id: userId }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/roles/${ id }/assignments`,
      method: 'delete',
      body: Object.keys(body).length ? body : undefined,
    })

    return response.data
  }

  /**
   * @description Returns all roles.
   * @route GET /roles/:id/assignments
   * @operationName List role assignments
   * @category Roles
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async listRoleAssignments(id, start, limit) {
    const query = { start: start, limit: limit }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/roles/${ id }/assignments`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Adds a new role.
   * @route POST /roles/:id/assignments
   * @operationName Create role assignment
   * @category Roles
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"User","name":"user_id","dictionary":"getUsersDictionary","description":"The user associated with this record. If omitted, uses the authenticated user.","required":false}
   *
   * @returns {Object}
   */
  async createRoleAssignment(id, userId) {
    const body = { user_id: userId }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/roles/${ id }/assignments`,
      method: 'post',
      body: Object.keys(body).length ? body : undefined,
    })

    return response.data
  }

  /**
   * @description Returns all roles.
   * @route GET /roles/:id/settings
   * @operationName List role settings
   * @category Roles
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async listRoleSettings(id) {

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/roles/${ id }/settings`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Adds a new role.
   * @route POST /roles/:id/settings
   * @operationName Create or update role setting
   * @category Roles
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"String","label":"Setting Key","name":"setting_key","description":"Key name for the setting.","required":false}
   * @paramDef {"type":"String","label":"Value","name":"value","description":"The monetary value of the deal.","required":false}
   *
   * @returns {Object}
   */
  async createOrUpdateRoleSetting(id, settingKey, value) {
    const body = { setting_key: settingKey, value: value }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/roles/${ id }/settings`,
      method: 'post',
      body: Object.keys(body).length ? body : undefined,
    })

    return response.data
  }

  /**
   * @description Returns all roles.
   * @route GET /roles/:id/pipelines
   * @operationName List pipeline visibility for role
   * @category Roles
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Visible","name":"visible","description":"Visibility filter for pipelines (0-3).","required":false}
   *
   * @returns {Object}
   */
  async listPipelineVisibilityForRole(id, visible) {
    const query = { visible: visible }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/roles/${ id }/pipelines`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Updates the properties of a role.
   * @route PUT /roles/:id/pipelines
   * @operationName Update pipeline visibility for role
   * @category Roles
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Array","label":"Visible Pipeline IDs","name":"visible_pipeline_ids","description":"IDs of pipelines visible to the user.","required":false}
   *
   * @returns {Object}
   */
  async updatePipelineVisibilityForRole(id, visiblePipelineIds) {
    const body = { visible_pipeline_ids: Array.isArray(visiblePipelineIds) ? visiblePipelineIds.join(',') : visiblePipelineIds }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/roles/${ id }/pipelines`,
      method: 'put',
      body: Object.keys(body).length ? body : undefined,
    })

    return response.data
  }


  // ======================================== STAGES ========================================


  /**
   * @description Returns all stages.
   * @route GET /stages
   * @operationName List Stages
   * @category Stages
   *
   * @paramDef {"type":"Number","label":"Pipeline","name":"pipeline_id","dictionary":"getPipelinesDictionary","description":"The pipeline associated with this record.","required":false}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async listStages(pipelineId, start, limit) {
    const query = {
      pipeline_id: pipelineId,
      start,
      limit,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/stages`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Adds a new stage.
   * @route POST /stages
   * @operationName Create Stage
   * @category Stages
   *
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the record.","required":false}
   * @paramDef {"type":"Number","label":"Pipeline","name":"pipeline_id","dictionary":"getPipelinesDictionary","description":"The pipeline associated with this record.","required":false}
   * @paramDef {"type":"Boolean","label":"Deal Probability","name":"deal_probability","description":"Deal probability.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Boolean","label":"Rotten Flag","name":"rotten_flag","description":"Whether deals in this stage can become rotten.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Number","label":"Rotten Days","name":"rotten_days","description":"Number of days before a deal becomes rotten.","required":false}
   *
   * @returns {Object}
   */
  async createStage(name, pipelineId, dealProbability, rottenFlag, rottenDays) {
    const body = {
      name,
      pipeline_id: pipelineId,
      deal_probability: dealProbability,
      rotten_flag: rottenFlag,
      rotten_days: rottenDays,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/stages`,
      method: 'post',
      body,
    })

    return response.data
  }

  /**
   * @description Marks multiple stages as deleted.
   * @route DELETE /stages
   * @operationName Delete Stages
   * @category Stages
   *
   * @paramDef {"type":"String","label":"Identifiers","name":"ids","description":"Comma-separated list of IDs.","required":true}
   *
   * @returns {Object}
   */
  async deleteStages(ids) {
    const query = { ids: Array.isArray(ids) ? ids.join(',') : ids }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/stages`,
      method: 'delete',
      query,
    })

    return response.data
  }

  /**
   * @description Returns details of a specific stage.
   * @route GET /stages/:id
   * @operationName Get Stage
   * @category Stages
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async getStage(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/stages/${ id }`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Marks a stage as deleted.
   * @route DELETE /stages/:id
   * @operationName Delete Stage
   * @category Stages
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async deleteStage(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/stages/${ id }`,
      method: 'delete',
    })

    return response.data
  }

  /**
   * @description Updates the properties of a stage.
   * @route PUT /stages/:id
   * @operationName Update Stage
   * @category Stages
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the record.","required":false}
   * @paramDef {"type":"Number","label":"Pipeline","name":"pipeline_id","dictionary":"getPipelinesDictionary","description":"The pipeline associated with this record.","required":false}
   * @paramDef {"type":"Boolean","label":"Deal Probability","name":"deal_probability","description":"Deal probability.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Boolean","label":"Rotten Flag","name":"rotten_flag","description":"Whether deals in this stage can become rotten.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Number","label":"Rotten Days","name":"rotten_days","description":"Number of days before a deal becomes rotten.","required":false}
   * @paramDef {"type":"Number","label":"Order Number","name":"order_nr","description":"Order number.","required":false}
   *
   * @returns {Object}
   */
  async updateStage(id, name, pipelineId, dealProbability, rottenFlag, rottenDays, orderNr) {
    const body = {
      name,
      pipeline_id: pipelineId,
      deal_probability: dealProbability,
      rotten_flag: rottenFlag,
      rotten_days: rottenDays,
      order_nr: orderNr,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/stages/${ id }`,
      method: 'put',
      body,
    })

    return response.data
  }

  /**
   * @description Returns deals in a stage.
   * @route GET /stages/:id/deals
   * @operationName List Stage Deals
   * @category Stages
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Filter","name":"filter_id","description":"Identifier of the filter to apply.","required":false}
   * @paramDef {"type":"Number","label":"User","name":"user_id","dictionary":"getUsersDictionary","description":"The user associated with this record. If omitted, uses the authenticated user.","required":false}
   * @paramDef {"type":"Boolean","label":"Everyone","name":"everyone","description":"Show deals for everyone.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async listStageDeals(id, filterId, userId, everyone, start, limit) {
    const query = {
      filter_id: filterId,
      user_id: userId,
      everyone,
      start,
      limit,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/stages/${ id }/deals`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }


  // ======================================== TASKS ========================================


  /**
   * @description Returns all tasks.
   * @route GET /tasks
   * @operationName List Tasks
   * @category Tasks
   *
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving next page of results.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   * @paramDef {"type":"Number","label":"Assignee","name":"assignee_id","description":"Identifier of the user assigned to the task.","required":false}
   * @paramDef {"type":"Number","label":"Project","name":"project_id","description":"Identifier of the project.","required":true}
   * @paramDef {"type":"Number","label":"Parent Task","name":"parent_task_id","description":"Identifier of the parent task.","required":false}
   * @paramDef {"type":"Boolean","label":"Mark as Done","name":"done","description":"Whether the activity is completed.","uiComponent":{"type":"TOGGLE"},"required":false}
   *
   * @returns {Object}
   */
  async listTasks(cursor, limit, assigneeId, projectId, parentTaskId, done) {
    const query = {
      cursor,
      limit,
      assignee_id: assigneeId,
      project_id: projectId,
      parent_task_id: parentTaskId,
      done,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/tasks`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Adds a new task.
   * @route POST /tasks
   * @operationName Create Task
   * @category Tasks
   *
   * @paramDef {"type":"String","label":"Title","name":"title","description":"The title of the record.","required":true}
   * @paramDef {"type":"Number","label":"Project","name":"project_id","description":"Identifier of the project.","required":true}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Description of the record.","uiComponent":{"type":"MULTI_LINE_TEXT"},"required":false}
   * @paramDef {"type":"Number","label":"Parent Task","name":"parent_task_id","description":"Identifier of the parent task.","required":false}
   * @paramDef {"type":"Number","label":"Assignee","name":"assignee_id","description":"Identifier of the user assigned to the task.","required":false}
   * @paramDef {"type":"Boolean","label":"Mark as Done","name":"done","description":"Whether the activity is completed.","uiComponent":{"type":"TOGGLE"},"required":false}
   * @paramDef {"type":"Number","label":"Due Date and Time","name":"dueDateTime","description":"The date and time when the activity is due. Will be automatically formatted for Pipedrive.","uiComponent":{"type":"DATE_TIME_PICKER"},"required":false}
   *
   * @returns {Object}
   */
  async createTask(title, projectId, description, parentTaskId, assigneeId, done, dueDate) {
    const body = {
      title,
      project_id: projectId,
      description,
      parent_task_id: parentTaskId,
      assignee_id: assigneeId,
      done,
      due_date: dueDate,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/tasks`,
      method: 'post',
      body,
    })

    return response.data
  }

  /**
   * @description Returns details of a specific task.
   * @route GET /tasks/:id
   * @operationName Get Task
   * @category Tasks
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async getTask(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/tasks/${ id }`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Updates the properties of a task.
   * @route PUT /tasks/:id
   * @operationName Update Task
   * @category Tasks
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async updateTask(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/tasks/${ id }`,
      method: 'put',
    })

    return response.data
  }

  /**
   * @description Marks a task as deleted.
   * @route DELETE /tasks/:id
   * @operationName Delete Task
   * @category Tasks
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async deleteTask(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/tasks/${ id }`,
      method: 'delete',
    })

    return response.data
  }


  // ======================================== USERCONNECTIONS ========================================


  /**
   * @description Returns all user connections.
   * @route GET /userConnections
   * @operationName List User Connections
   * @category UserConnections
   *
   * @returns {Object}
   */
  async listUserConnections() {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/userConnections`,
      method: 'get',
    })

    return response.data
  }


  // ======================================== USERS ========================================


  /**
   * @description Returns all users.
   * @route GET /users
   * @operationName List Users
   * @category Users
   *
   * @returns {Object}
   */
  async listUsers() {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/users`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Adds a new user.
   * @route POST /users
   * @operationName Create User
   * @category Users
   *
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Email address.","required":true}
   * @paramDef {"type":"String","label":"Access","name":"access","description":"User access level.","required":false}
   * @paramDef {"type":"Boolean","label":"Active","name":"active_flag","description":"Whether the record is active.","uiComponent":{"type":"TOGGLE"},"required":false}
   *
   * @returns {Object}
   */
  async createUser(email, access, activeFlag) {
    const body = {
      email,
      access,
      active_flag: activeFlag,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/users`,
      method: 'post',
      body,
    })

    return response.data
  }

  /**
   * @description Finds users by name or email.
   * @route GET /users/find
   * @operationName Find Users
   * @category Users
   *
   * @paramDef {"type":"String","label":"Search Term","name":"term","description":"The term to search for.","required":true}
   * @paramDef {"type":"Boolean","label":"Search by Email","name":"search_by_email","description":"Search users by email.","uiComponent":{"type":"TOGGLE"},"required":false}
   *
   * @returns {Object}
   */
  async findUsers(term, searchByEmail) {
    const query = {
      term,
      search_by_email: searchByEmail,
    }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/users/find`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Returns details of a specific user.
   * @route GET /users/:id
   * @operationName Get User
   * @category Users
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async getUser(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/users/${ id }`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Updates the properties of a user.
   * @route PUT /users/:id
   * @operationName Update User
   * @category Users
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Boolean","label":"Active","name":"active_flag","description":"Whether the record is active.","uiComponent":{"type":"TOGGLE"},"required":false}
   *
   * @returns {Object}
   */
  async updateUser(id, activeFlag) {
    const body = { active_flag: activeFlag }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/users/${ id }`,
      method: 'put',
      body,
    })

    return response.data
  }

  /**
   * @description Returns all followers of a user.
   * @route GET /users/:id/followers
   * @operationName List User Followers
   * @category Users
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async listUserFollowers(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/users/${ id }/followers`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Returns all permissions for a user.
   * @route GET /users/:id/permissions
   * @operationName List User Permissions
   * @category Users
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async listUserPermissions(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/users/${ id }/permissions`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Returns all role assignments for a user.
   * @route GET /users/:id/roleAssignments
   * @operationName List User Role Assignments
   * @category Users
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   * @paramDef {"type":"Number","label":"Offset","name":"start","description":"Pagination start offset.","required":false}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results to return (max 500).","uiComponent":{"type":"NUMERIC_STEPPER","min":0,"max":500,"step":1},"defaultValue":100,"required":false}
   *
   * @returns {Object}
   */
  async listUserRoleAssignments(id, start, limit) {
    const query = { start, limit }

    // Clean up undefined
    Object.keys(query).forEach(key => (query[key] === undefined || query[key] === null) && delete query[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/users/${ id }/roleAssignments`,
      method: 'get',
      query: Object.keys(query).length ? query : undefined,
    })

    return response.data
  }

  /**
   * @description Returns all role settings for a user.
   * @route GET /users/:id/roleSettings
   * @operationName List User Role Settings
   * @category Users
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async listUserRoleSettings(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/users/${ id }/roleSettings`,
      method: 'get',
    })

    return response.data
  }


  // ======================================== USERSETTINGS ========================================


  /**
   * @description Returns all settings for the authorized user.
   * @route GET /userSettings
   * @operationName List User Settings
   * @category UserSettings
   *
   * @returns {Object}
   */
  async listUserSettings() {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/userSettings`,
      method: 'get',
    })

    return response.data
  }


  // ======================================== WEBHOOKS ========================================


  /**
   * @description Returns all webhooks.
   * @route GET /webhooks
   * @operationName List Webhooks
   * @category Webhooks
   *
   * @returns {Object}
   */
  async listWebhooks() {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/webhooks`,
      method: 'get',
    })

    return response.data
  }

  /**
   * @description Adds a new webhook.
   * @route POST /webhooks
   * @operationName Create Webhook
   * @category Webhooks
   *
   * @paramDef {"type":"String","label":"Subscription URL","name":"subscription_url","description":"Webhook subscription URL.","required":true}
   * @paramDef {"type":"String","label":"Event Action","name":"event_action","description":"Event action (e.g., added, updated, deleted).","required":true}
   * @paramDef {"type":"String","label":"Event Object","name":"event_object","description":"Event object (e.g., deal, person, organization).","required":true}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The name of the record.","required":false}
   * @paramDef {"type":"Number","label":"User","name":"user_id","dictionary":"getUsersDictionary","description":"The user associated with this record. If omitted, uses the authenticated user.","required":false}
   * @paramDef {"type":"String","label":"HTTP Auth User","name":"http_auth_user","description":"HTTP basic auth username.","required":false}
   * @paramDef {"type":"String","label":"HTTP Auth Password","name":"http_auth_password","description":"HTTP basic auth password.","required":false}
   * @paramDef {"type":"String","label":"Version","name":"version","description":"Webhook version.","required":false}
   *
   * @returns {Object}
   */
  async createWebhook(subscriptionUrl, eventAction, eventObject, name, userId, httpAuthUser, httpAuthPassword, version) {
    const body = {
      subscription_url: subscriptionUrl,
      event_action: eventAction,
      event_object: eventObject,
      name,
      user_id: userId,
      http_auth_user: httpAuthUser,
      http_auth_password: httpAuthPassword,
      version,
    }

    // Clean up undefined
    Object.keys(body).forEach(key => (body[key] === undefined || body[key] === null) && delete body[key])

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/webhooks`,
      method: 'post',
      body,
    })

    return response.data
  }

  /**
   * @description Deletes a webhook.
   * @route DELETE /webhooks/:id
   * @operationName Delete Webhook
   * @category Webhooks
   *
   * @paramDef {"type":"Number","label":"Identifier","name":"id","description":"The unique identifier of the record.","required":true}
   *
   * @returns {Object}
   */
  async deleteWebhook(id) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/webhooks/${ id }`,
      method: 'delete',
    })

    return response.data
  }

}

Flowrunner.ServerCode.addService(PipedriveService, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth2 Client ID from your Pipedrive app at https://developers.pipedrive.com (Developer Hub).',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth2 Client Secret from your Pipedrive app at https://developers.pipedrive.com (Developer Hub).',
  },
])
