'use strict'

const OAUTH_BASE_URL = 'https://auth.calendly.com/oauth'
const API_BASE_URL = 'https://api.calendly.com'

const DEFAULT_SCOPE_LIST = ['default']

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const MAX_RESULTS_COUNT = 100
const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000
const DEFAULT_MEETING_DURATION = 30 // in minutes

const DEFAULT_LIMIT = 100

const EventTypes = {
  onCreateInvitee: 'invitee.created',
  onCancelInvitee: 'invitee.canceled',
  onMarkInviteeAsNoShow: 'invitee_no_show.created',
  onUnmarkInviteeAsNoShow: 'invitee_no_show.deleted',
  onSubmitRoutingForm: 'routing_form_submission.created',
}

const MethodTypes = Object.keys(EventTypes).reduce((acc, key) => ((acc[EventTypes[key]] = key), acc), {})

const MethodCallTypes = {
  SHAPE_EVENT: 'SHAPE_EVENT',
  FILTER_TRIGGER: 'FILTER_TRIGGER',
}

const logger = {
  info: (...args) => console.log('[Calendly Service] info:', ...args),
  debug: (...args) => console.log('[Calendly Service] debug:', ...args),
  error: (...args) => console.log('[Calendly Service] error:', ...args),
  warn: (...args) => console.log('[Calendly Service] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName Calendly
 * @integrationTriggersScope SINGLE_APP
 * @integrationIcon /icon.svg
 **/
class CalendlyService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'

    if (query) {
      query = cleanupObject(query)
    }

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      return await Flowrunner.Request[method](url)
        .set(this.#getAccessTokenHeader())
        .query(query)
        .send(body)
    } catch (error) {
      logger.error(`${ logTag } - error: ${ JSON.stringify({ ...error }) }`)

      throw error
    }
  }

  #getAccessTokenHeader(accessToken) {
    return {
      Authorization: `Bearer ${ accessToken || this.request.headers['oauth-access-token'] }`,
    }
  }

  #getSecretTokenHeader() {
    const token = Buffer.from(`${ this.clientId }:${ this.clientSecret }`).toString('base64')

    return {
      Authorization: `Basic ${ token }`,
    }
  }

  /**
   * @route GET /getOAuth2ConnectionURL
   * @registerAs SYSTEM
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('scope', this.scopes)
    params.append('response_type', 'code')

    return `${ OAUTH_BASE_URL }/authorize?${ params.toString() }`
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   *
   * @property {String} token
   * @property {Number} [expirationInSeconds]
   * @property {String} [refreshToken]
   */

  /**
   * @route PUT /refreshToken
   * @registerAs SYSTEM
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    const params = new URLSearchParams()

    params.append('grant_type', 'refresh_token')
    params.append('refresh_token', refreshToken)

    try {
      const response = await Flowrunner.Request.post(`${ OAUTH_BASE_URL }/token`)
        .set(this.#getSecretTokenHeader())
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      return {
        token: response.access_token,
        expirationInSeconds: response.expires_in,
        refreshToken: response.refresh_token || refreshToken,
      }
    } catch (error) {
      logger.error(`refreshToken: ${ error.message }`)

      throw error
    }
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   *
   * @property {String} token
   * @property {String} [refreshToken]
   * @property {Number} [expirationInSeconds]
   * @property {Object} [userData]
   * @property {Boolean} [overwrite]
   * @property {String} connectionIdentityName
   * @property {String} [connectionIdentityImageURL]
   */

  /**
   * @route POST /executeCallback
   * @registerAs SYSTEM
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    const params = new URLSearchParams()

    params.append('code', callbackObject.code)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('grant_type', 'authorization_code')

    let codeExchangeResponse = {}

    try {
      codeExchangeResponse = await Flowrunner.Request.post(`${ OAUTH_BASE_URL }/token`)
        .set(this.#getSecretTokenHeader())
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      logger.debug(`[executeCallback] codeExchangeResponse response: ${ JSON.stringify(codeExchangeResponse) }`)
    } catch (error) {
      logger.error(`[executeCallback] codeExchangeResponse error: ${ error.message }`)

      return {}
    }

    let userData = {}

    if (codeExchangeResponse.owner) {
      try {
        const userInfoResponse = await Flowrunner.Request
          .get(codeExchangeResponse.owner)
          .set(this.#getAccessTokenHeader(codeExchangeResponse['access_token']))

        userData = userInfoResponse.resource

        logger.debug(`[executeCallback] userInfo response: ${ JSON.stringify(userData) }`)
      } catch (error) {
        logger.error(`[executeCallback] userInfo error: ${ error.message }`)

        return {}
      }
    }

    return {
      token: codeExchangeResponse['access_token'],
      expirationInSeconds: codeExchangeResponse['expires_in'],
      refreshToken: codeExchangeResponse['refresh_token'],
      connectionIdentityName: userData
        ? `${ userData.name } (${ userData.email })`
        : 'Calendly Service Account',
      connectionIdentityImageURL: userData?.avatar_url,
      overwrite: true,
      userData,
    }
  }

  async #getCurrentAccountInfo() {
    const response = await this.#apiRequest({
      logTag: 'getCurrentAccountInfo',
      url: `${ API_BASE_URL }/users/me`,
    })

    return response.resource
  }

  // ========================================== DICTIONARIES ===========================================

  /**
   * @typedef {Object} DictionaryPayload
   * @property {String} [search]
   * @property {String} [cursor]
   */

  /**
   * @typedef {Object} DictionaryItem
   * @property {String} label
   * @property {any} value
   * @property {String} note
   */

  /**
   * @typedef {Object} DictionaryResponse
   * @property {Array<DictionaryItem>} items
   * @property {String} cursor
   */

  /**
   * @typedef {Object} getHostsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter hosts by their name, email, or URI. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for retrieving the next page of results. Use the returned cursor to fetch additional hosts."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Hosts
   * @category Team Management
   * @description Returns team members available as meeting hosts for AI-powered scheduling automation. Enables AI agents to dynamically assign meetings to appropriate team members based on expertise, availability, or workload distribution.
   *
   * @route POST /get-hosts
   *
   * @paramDef {"type":"getHostsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination token for retrieving and filtering hosts."}
   *
   * @sampleResult {"cursor":"eyJpZCI6IjEyMzQ1NiIsInBhZ2UiOjJ9","items":[{"label":"Sarah Wilson (sarah@company.com)","note":"Sales Manager","value":"https://api.calendly.com/users/ABC123"},{"label":"John Smith (john@company.com)","note":"Product Specialist","value":"https://api.calendly.com/users/DEF456"}]}
   * @returns {DictionaryResponse}
   */
  async getHostsDictionary({ search, cursor }) {
    const me = await this.#getCurrentAccountInfo()

    const { collection, pagination } = await this.#apiRequest({
      logTag: 'getHostsDictionary',
      url: `${ API_BASE_URL }/organization_memberships`,
      query: {
        organization: me.current_organization,
        count: DEFAULT_LIMIT,
        page_token: cursor,
      },
    })

    const filteredMembers = search
      ? searchFilter(collection, ['user.name', 'user.email', 'user.uri'], search)
      : collection

    return {
      cursor: pagination.next_page_token,
      items: filteredMembers.map(({ user: { name, email, uri } }) => ({
        label: name ? `${ name } (${ email })` : email || '[empty]',
        note: `URI: ${ uri }`,
        value: uri,
      })),
    }
  }

  /**
   * @typedef {Object} getScheduledEventsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter scheduled events by their name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for retrieving the next page of results. Use the returned cursor to fetch additional scheduled events."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Scheduled Events
   * @category Event Management
   * @description Returns scheduled meetings for AI agents to manage existing bookings, send reminders, handle cancellations, or trigger follow-up workflows. Essential for automated meeting management and customer relationship maintenance.
   *
   * @route POST /get-scheduled-events
   *
   * @paramDef {"type":"getScheduledEventsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination token for retrieving and filtering scheduled events."}
   *
   * @sampleResult {"cursor":"eyJpZCI6Ijc4OTAiLCJwYWdlIjoyfQ==","items":[{"label":"Product Demo - Sarah Wilson","note":"Jan 20, 2025 3:00 PM","value":"A1B2C3D4"},{"label":"Consultation Call - John Smith","note":"Jan 22, 2025 10:00 AM","value":"E5F6G7H8"}]}
   * @returns {DictionaryResponse}
   */
  async getScheduledEventsDictionary({ search, cursor }) {
    const me = await this.#getCurrentAccountInfo()

    const { collection, pagination } = await this.#apiRequest({
      logTag: 'getScheduledEventsDictionary',
      url: `${ API_BASE_URL }/scheduled_events`,
      query: {
        organization: me.current_organization,
        count: DEFAULT_LIMIT,
        page_token: cursor,
      },
    })

    const filteredScheduledEvents = search
      ? searchFilter(collection, ['name'], search)
      : collection

    return {
      cursor: pagination.next_page_token,
      items: filteredScheduledEvents.map(({ name, uri }) => ({
        label: name || '[empty]',
        note: `ID: ${ getIdFromURI(uri) }`,
        value: getIdFromURI(uri),
      })),
    }
  }

  /**
   * @typedef {Object} getEventTypesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter event types by their name or URI. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for retrieving the next page of results. Use the returned cursor to fetch additional event types."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Event Types
   * @category Event Management
   * @description Returns available meeting types for AI-powered scheduling. Enables AI agents to dynamically select appropriate meeting formats, durations, and configurations based on prospect needs, conversation context, or business rules.
   *
   * @route POST /get-event-types
   *
   * @paramDef {"type":"getEventTypesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination token for retrieving and filtering event types."}
   *
   * @sampleResult {"cursor":"eyJpZCI6IjU0MzIxIiwicGFnZSI6M30=","items":[{"label":"30 Minute Meeting","note":"Quick calls and check-ins","value":"https://api.calendly.com/event_types/A1B2C3E4"},{"label":"Product Demo","note":"60 minutes - Full product walkthrough","value":"https://api.calendly.com/event_types/B2C3D4E5"}]}
   * @returns {DictionaryResponse}
   */
  async getEventTypesDictionary({ search, cursor }) {
    const me = await this.#getCurrentAccountInfo()

    const { collection, pagination } = await this.#apiRequest({
      logTag: 'getEventTypesDictionary',
      url: `${ API_BASE_URL }/event_types`,
      query: {
        organization: me.current_organization,
        count: DEFAULT_LIMIT,
        page_token: cursor,
      },
    })

    const filteredEventTypes = search
      ? searchFilter(collection, ['name', 'uri'], search)
      : collection

    return {
      cursor: pagination.next_page_token,
      items: filteredEventTypes.map(({ name, uri }) => ({
        label: name || '[empty]',
        note: `ID: ${ getIdFromURI(uri) }`,
        value: uri,
      })),
    }
  }

  // ======================================= END OF DICTIONARIES =======================================

  async #createWebhook(events, invocation) {
    const me = await this.#getCurrentAccountInfo()

    const response = await this.#apiRequest({
      logTag: 'createWebhook',
      method: 'post',
      url: `${ API_BASE_URL }/webhook_subscriptions`,
      body: {
        url: `${ invocation.callbackUrl }&connectionId=${ invocation.connectionId }`,
        events,
        organization: me.current_organization,
        scope: 'organization',
      },
    })

    return response?.resource
  }

  async #deleteWebhook(webhookUri) {
    await this.#apiRequest({
      logTag: 'deleteWebhook',
      url: webhookUri,
      method: 'delete',
    })
  }

  async #getWebhook(invocation) {
    const events = invocation.events.map(event => EventTypes[event.name])

    if (invocation.webhookData) {
      await this.#deleteWebhook(invocation.webhookData.uri)
    }

    return this.#createWebhook(events, invocation)
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    logger.debug(`handleTriggerUpsertWebhook.invocation: ${ JSON.stringify(invocation) }`)

    const webhookData = await this.#getWebhook(invocation)

    logger.debug(`handleTriggerUpsertWebhook.webhookData: ${ JSON.stringify(webhookData) }`)

    return {
      webhookData,
      connectionId: invocation.connectionId,
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    logger.debug(`handleTriggerResolveEvents.invocation: ${ JSON.stringify(invocation) }`)

    const methodName = MethodTypes[invocation.body.event]

    logger.debug(`handleTriggerResolveEvents.methodName: ${ methodName }`)

    if (!methodName) {
      return null
    }

    logger.debug(`handleTriggerResolveEvents.${ methodName }.SHAPE_EVENT: ${ JSON.stringify(invocation.body.payload) }`)

    const events = await this[methodName](MethodCallTypes.SHAPE_EVENT, invocation.body.payload)

    logger.debug(`handleTriggerResolveEvents.${ methodName }.events: ${ JSON.stringify(events) }`)

    return {
      connectionId: invocation.queryParams.connectionId,
      events,
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    logger.debug(`handleTriggerSelectMatched.${ invocation.eventName }.FILTER_TRIGGER: ${ JSON.stringify(invocation) }`)

    const data = await this[invocation.eventName](MethodCallTypes.FILTER_TRIGGER, invocation)

    logger.debug(`handleTriggerSelectMatched.${ invocation.eventName }.triggersToActivate: ${ JSON.stringify(data) }`)

    return data
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   */
  async handleTriggerDeleteWebhook(invocation) {
    logger.debug(`handleTriggerDeleteWebhook.invocation: ${ JSON.stringify(invocation) }`)

    await this.#deleteWebhook(invocation.webhookData.uri)
  }

  /**
   * @operationName On Invitee Created
   * @category Event Tracking
   * @description Triggers when someone schedules a meeting, enabling AI agents to automate follow-up workflows, send confirmation emails, add contacts to CRM systems, or trigger personalized onboarding sequences. Perfect for capturing leads, scheduling follow-ups, and maintaining engagement momentum.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-invitee-created
   * @appearanceColor #006bff #0ee8f0
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Event Type","name":"eventType","dictionary":"getEventTypesDictionary","description":"Filter by specific meeting type. Examples: '30 Minute Meeting', 'Demo Call', 'Consultation'. Leave empty to trigger for all event types, or specify to target particular meeting workflows."}
   *
   * @returns {Object}
   * @sampleResult {"name":"John Doe","email":"john.doe@company.com","timezone":"America/New_York","created_at":"2025-01-15T14:30:00.000Z","questions_and_answers":[{"question":"What would you like to discuss?","answer":"Product demo and pricing"}],"scheduled_event":{"name":"30 Minute Meeting","start_time":"2025-01-20T15:00:00.000Z","end_time":"2025-01-20T15:30:00.000Z","location":{"type":"zoom_conference","join_url":"https://zoom.us/j/123456789"},"event_memberships":[{"user_name":"Sarah Wilson","user_email":"sarah@company.com"}]},"cancel_url":"https://calendly.com/cancellations/abc123","reschedule_url":"https://calendly.com/reschedulings/abc123"}
   */
  onCreateInvitee(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onCreateInvitee',
          data: payload,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const ids = []

      payload.triggers.forEach(trigger => {
        const eventType = trigger.data.eventType

        if (trigger.data.eventType) {
          const event = payload.eventData.scheduled_event

          if (eventType === event.event_type || eventType === event.name) {
            ids.push(trigger.id)
          }
        } else {
          ids.push(trigger.id)
        }
      })

      logger.debug(`onCreateInvitee.triggersIdsToActivate: ${ JSON.stringify(ids) }`)

      return { ids }
    }
  }

  /**
   * @operationName On Invitee Canceled
   * @category Event Tracking
   * @description Triggers when someone cancels their scheduled meeting, enabling AI agents to automatically send acknowledgment emails, update CRM records, trigger reschedule workflows, or launch retention campaigns. Perfect for maintaining customer relationships and reducing churn from cancelled meetings.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-invitee-canceled
   * @appearanceColor #006bff #0ee8f0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Event Type","name":"eventType","dictionary":"getEventTypesDictionary","description":"Event Type URI or Name. Select a specific Event Type to only trigger when invitees schedule this type of event. Leave empty to trigger for all Event Types."}
   *
   * @returns {Object}
   * @sampleResult {"reschedule_url":"https://calendly.com/reschedulings/daebde77-xxxx-xxxx-xxxx-5930d81d922a","timezone":"Europe/Helsinki","created_at":"2025-04-17T18:52:53.581626Z","text_reminder_number":null,"tracking":{"utm_term":null,"utm_campaign":null,"utm_medium":null,"salesforce_uuid":null,"utm_source":null,"utm_content":null},"updated_at":"2025-04-17T18:54:19.712979Z","invitee_scheduled_by":"https://api.calendly.com/users/8b5fa03b-xxxx-xxxx-xxxx-f67f3641b5c6","payment":null,"questions_and_answers":[],"event":"https://api.calendly.com/scheduled_events/7e13a0ae-xxxx-xxxx-xxxx-d867751f5bee","scheduled_event":{"event_memberships":[{"user_email":"host-user@email.com","user_name":"host name","user":"https://api.calendly.com/users/8b5fa03b-xxxx-xxxx-xxxx-f67f3641b5c6"}],"end_time":"2025-04-18T09:00:00.000000Z","created_at":"2025-04-17T18:52:53.562918Z","meeting_notes_plain":null,"uri":"https://api.calendly.com/scheduled_events/7e13a0ae-xxxx-xxxx-xxxx-d867751f5bee","start_time":"2025-04-18T08:30:00.000000Z","cancellation":{"reason":"rejection reason ","canceled_by":"host name","canceler_type":"host","created_at":"2025-04-17T18:54:19.666606Z"},"event_type":"https://api.calendly.com/event_types/da6b2df5-xxxx-xxxx-xxxx-c86e4f5ea292","updated_at":"2025-04-17T18:54:19.682124Z","meeting_notes_html":null,"invitees_counter":{"total":1,"limit":1,"active":0},"name":"Quick Call","location":{"join_url":"https://calendly.com/events/7e13a0ae-xxxx-xxxx-xxxx-d867751f5bee/google_meet","type":"google_conference","status":"pushed"},"event_guests":[],"status":"canceled"},"first_name":null,"email":"foo@foo.com","rescheduled":false,"old_invitee":null,"scheduling_method":null,"last_name":null,"new_invitee":null,"routing_form_submission":null,"uri":"https://api.calendly.com/scheduled_events/7e13a0ae-xxxx-xxxx-xxxx-d867751f5bee/invitees/daebde77-xxxx-xxxx-xxxx-5930d81d922a","cancellation":{"reason":"rejection reason ","canceled_by":"host name","canceler_type":"host","created_at":"2025-04-17T18:54:19.666606Z"},"name":"to cancel me","reconfirmation":null,"no_show":null,"cancel_url":"https://calendly.com/cancellations/daebde77-xxxx-xxxx-xxxx-5930d81d922a","status":"canceled"}
   */
  onCancelInvitee(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onCancelInvitee',
          data: payload,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const ids = []

      payload.triggers.forEach(trigger => {
        const eventType = trigger.data.eventType

        if (trigger.data.eventType) {
          const event = payload.eventData.scheduled_event

          if (eventType === event.event_type || eventType === event.name) {
            ids.push(trigger.id)
          }
        } else {
          ids.push(trigger.id)
        }
      })

      logger.debug(`onCancelInvitee.triggersIdsToActivate: ${ JSON.stringify(ids) }`)

      return { ids }
    }
  }

  /**
   * @operationName On Mark Invitee as No-Show
   * @category Event Tracking
   * @description Triggers when an invitee is marked as no-show.To use this integration, a Calendly Standard, Teams, or Enterprise subscription is required. If you're currently using Calendly's Free plan, you'll need to upgrade your account.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-mark-invitee-as-no-show
   * @appearanceColor #006bff #0ee8f0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"User Email","name":"userEmail","required":false,"description":"Email of the user who was marked as a no-show. If it is empty it runs for all users."}
   *
   * @returns {Object}
   * @sampleResult {"reschedule_url":"https://calendly.com/reschedulings/68731199-xxxx-xxxx-xxxx-06d82873cbd8","timezone":"Europe/Helsinki","created_at":"2025-04-16T08:03:41.909498Z","text_reminder_number":null,"tracking":{"utm_term":null,"utm_campaign":null,"utm_medium":null,"salesforce_uuid":null,"utm_source":null,"utm_content":null},"updated_at":"2025-04-16T08:03:41.909498Z","invitee_scheduled_by":null,"payment":null,"questions_and_answers":[{"answer":"hello","question":"Please share anything that will help prepare for our meeting.","position":0}],"event":"https://api.calendly.com/scheduled_events/a9fba920-xxxx-xxxx-xxxx-86eb33bed129","scheduled_event":{"event_memberships":[{"user_email":"host-user@email.com","user_name":"host name","user":"https://api.calendly.com/users/8b5fa03b-xxxx-xxxx-xxxx-f67f3641b5c6"}],"end_time":"2025-04-17T09:30:00.000000Z","created_at":"2025-04-16T08:03:41.880531Z","meeting_notes_plain":null,"uri":"https://api.calendly.com/scheduled_events/a9fba920-xxxx-xxxx-xxxx-86eb33bed129","start_time":"2025-04-17T09:00:00.000000Z","event_type":"https://api.calendly.com/event_types/da6b2df5-xxxx-xxxx-xxxx-c86e4f5ea292","updated_at":"2025-04-16T08:03:43.722838Z","meeting_notes_html":null,"invitees_counter":{"total":1,"limit":1,"active":1},"name":"Quick Call","location":{"join_url":"https://calendly.com/events/a9fba920-xxxx-xxxx-xxxx-86eb33bed129/google_meet","type":"google_conference","status":"pushed"},"event_guests":[],"status":"active"},"first_name":null,"email":"foo@foo.com","rescheduled":false,"old_invitee":null,"scheduling_method":null,"last_name":null,"new_invitee":null,"routing_form_submission":null,"uri":"https://api.calendly.com/scheduled_events/a9fba920-xxxx-xxxx-xxxx-86eb33bed129/invitees/68731199-xxxx-xxxx-xxxx-06d82873cbd8","name":"Test Dev","reconfirmation":null,"no_show":{"created_at":"2025-04-17T19:42:35.201874Z","uri":"https://api.calendly.com/invitee_no_shows/e75af044-375e-486d-8568-01a11657e534"},"cancel_url":"https://calendly.com/cancellations/68731199-xxxx-xxxx-xxxx-06d82873cbd8","status":"active"}
   */
  onMarkInviteeAsNoShow(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onMarkInviteeAsNoShow',
          data: payload,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const triggersToActivate = payload.triggers
        .filter(trigger => {
          return (
            !trigger.data.userEmail ||
            trigger.data.userEmail === payload.eventData.email
          )
        })
        .map(trigger => trigger.id)

      logger.debug(`onMarkInviteeAsNoShow.triggersIdsToActivate: ${ JSON.stringify(triggersToActivate) }`)

      return { ids: triggersToActivate }
    }
  }

  /**
   * @operationName On Unmark Invitee as No-Show
   * @category Event Tracking
   * @description Triggers when an invitee is unmarked as no-show. To use this integration, a Calendly Standard, Teams, or Enterprise subscription is required. If you're currently using Calendly's Free plan, you'll need to upgrade your account.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-unmark-invitee-as-no-show
   * @appearanceColor #006bff #0ee8f0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"User Email","name":"userEmail","required":false,"description":"Email of the user who was unmarked as a no-show."}
   *
   * @returns {Object}
   * @sampleResult {"reschedule_url":"https://calendly.com/reschedulings/68731199-xxxx-xxxx-xxxx-06d82873cbd8","timezone":"Europe/Helsinki","created_at":"2025-04-16T08:03:41.909498Z","text_reminder_number":null,"tracking":{"utm_term":null,"utm_campaign":null,"utm_medium":null,"salesforce_uuid":null,"utm_source":null,"utm_content":null},"updated_at":"2025-04-16T08:03:41.909498Z","invitee_scheduled_by":null,"payment":null,"questions_and_answers":[{"answer":"hello","question":"Please share anything that will help prepare for our meeting.","position":0}],"event":"https://api.calendly.com/scheduled_events/a9fba920-xxxx-xxxx-xxxx-86eb33bed129","scheduled_event":{"event_memberships":[{"user_email":"host-user@email.com","user_name":"host name","user":"https://api.calendly.com/users/8b5fa03b-xxxx-xxxx-xxxx-f67f3641b5c6"}],"end_time":"2025-04-17T09:30:00.000000Z","created_at":"2025-04-16T08:03:41.880531Z","meeting_notes_plain":null,"uri":"https://api.calendly.com/scheduled_events/a9fba920-xxxx-xxxx-xxxx-86eb33bed129","start_time":"2025-04-17T09:00:00.000000Z","event_type":"https://api.calendly.com/event_types/da6b2df5-xxxx-xxxx-xxxx-c86e4f5ea292","updated_at":"2025-04-16T08:03:43.722838Z","meeting_notes_html":null,"invitees_counter":{"total":1,"limit":1,"active":1},"name":"Quick Call","location":{"join_url":"https://calendly.com/events/a9fba920-xxxx-xxxx-xxxx-86eb33bed129/google_meet","type":"google_conference","status":"pushed"},"event_guests":[],"status":"active"},"first_name":null,"email":"foo@foo.com","rescheduled":false,"old_invitee":null,"scheduling_method":null,"last_name":null,"new_invitee":null,"routing_form_submission":null,"uri":"https://api.calendly.com/scheduled_events/a9fba920-xxxx-xxxx-xxxx-86eb33bed129/invitees/68731199-xxxx-xxxx-xxxx-06d82873cbd8","name":"Test Dev","reconfirmation":null,"no_show":null,"cancel_url":"https://calendly.com/cancellations/68731199-xxxx-xxxx-xxxx-06d82873cbd8","status":"active"}
   */
  onUnmarkInviteeAsNoShow(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onUnmarkInviteeAsNoShow',
          data: payload,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const triggersToActivate = payload.triggers
        .filter(trigger => {
          return (
            !trigger.data.userEmail ||
            trigger.data.userEmail === payload.eventData.email
          )
        })
        .map(trigger => trigger.id)

      logger.debug(`onUnmarkInviteeAsNoShow.triggersIdsToActivate: ${ JSON.stringify(triggersToActivate) }`)

      return { ids: triggersToActivate }
    }
  }

  /**
   * @operationName On New Routing Form Submitted
   * @category Event Tracking
   * @description Triggers when a user submits a routing form before scheduling. To use this integration, a Calendly Teams or Enterprise subscription is required. If you're currently using Calendly's Free or Standard plan, you'll need to upgrade your account.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-new-routing-form-submitted
   * @appearanceColor #006bff #0ee8f0
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"result":{"type":"custom_message","value":{"body":"We aren't able to offer any meetings at this time.","headline":"Thank you for your interest"}},"submitter":null,"routing_form":"https://api.calendly.com/routing_forms/ce901f76-8371-406d-9344-853f5b47f604","updated_at":"2025-04-17T19:51:51.405443Z","created_at":"2025-04-17T19:51:51.405443Z","questions_and_answers":[{"question_uuid":"a353664e-7d24-42a4-bf90-e1d588107aee","answer":"test2","question":"Name"}],"tracking":{"utm_term":null,"utm_campaign":null,"salesforce_uuid":null,"utm_medium":null,"utm_content":null,"utm_source":null},"uri":"https://api.calendly.com/routing_form_submissions/91a8e7c7-b157-41b9-9400-6cf30c826d03","submitter_type":null}
   */
  onSubmitRoutingForm(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onSubmitRoutingForm',
          data: payload,
        },
      ]
    } else if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const triggersToActivate = payload.triggers.map(trigger => trigger.id)

      return { ids: triggersToActivate }
    }
  }

  /**
   * @description Cancels a scheduled meeting, enabling AI agents to automatically handle cancellations, send apology emails, reschedule follow-ups, or trigger alternate workflows. Perfect for managing booking conflicts, emergency cancellations, or automated schedule adjustments based on business rules.
   *
   * @route POST /cancel-scheduled-event
   * @operationName Cancel Scheduled Event
   * @category Event Management
   * @appearanceColor #006bff #0ee8f0
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes scheduled_events.write
   *
   * @paramDef {"type":"String","label":"Event","name":"eventId","description":"Select the scheduled meeting to cancel. Use the event ID from the scheduled events list or from trigger data.","required":true,"dictionary":"getScheduledEventsDictionary"}
   * @paramDef {"type":"String","label":"Reason","name":"reason","description":"Cancellation reason visible to attendees. Examples: 'Emergency came up', 'Schedule conflict', 'Rescheduling needed'. Helps maintain professional communication.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   *
   * @returns {Object}
   * @sampleResult {"reason":"Emergency meeting conflict - will reschedule soon","canceled_by":"Sarah Wilson","canceler_type":"host","created_at":"2025-01-15T16:45:00.000Z"}
   */
  async cancelScheduledEvent(eventId, reason) {
    if (!eventId) {
      throw new Error('"Event" is required')
    }

    const result = await this.#apiRequest({
      logTag: 'cancelScheduledEvent',
      method: 'post',
      url: `${ API_BASE_URL }/scheduled_events/${ eventId }/cancellation`,
      body: {
        reason: reason || undefined,
      },
    })

    return result.resource
  }

  /**
   * @description Find the first host by name or email
   *
   * @route POST /find-host-by-name-or-email
   * @operationName Find Host by Name/Email
   * @appearanceColor #006bff #0ee8f0
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes events.read
   *
   * @paramDef {"type":"String","label":"Host","name":"host","description":"Host Name or Email", "required":true}
   *
   * @returns {Object}
   * @sampleResult {}
   */
  async findHostByNameOrEmail(host) {
    host = host.toLowerCase()

    const currentAccount = await this.#getCurrentAccountInfo()

    if (!currentAccount.current_organization) {
      return null
    }

    const query = {
      organization: currentAccount.current_organization,
    }

    const user = await findPagedCollectionItem(async pagingQuery => {
      const { pagination, collection } = await this.#apiRequest({
        logTag: 'organizationMemberships',
        method: 'get',
        url: `${ API_BASE_URL }/organization_memberships`,
        query: {
          ...query,
          ...pagingQuery,
        },
      })

      for (const item of collection) {
        if (item.user.name.toLowerCase() === host || item.user.email.toLowerCase() === host) {
          return {
            result: item,
          }
        }
      }

      return {
        pagination,
      }
    })

    if (user) {
      logger.debug(`Found an user with q="${ host }": ${ JSON.stringify(user) }`)
    } else {
      logger.debug(`Can not found a user with q="${ host }"`)
    }

    return user
  }

  /**
   * @description Find the first event type by name
   *
   * @route POST /find-event-type-by-name
   * @operationName Find Event Type by Name
   * @appearanceColor #006bff #0ee8f0
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes events.read
   *
   * @paramDef {"type":"String","label":"Event Type Name","name":"eventTypeName","description":"Event Type Name","required":true}
   *
   * @returns {Object}
   * @sampleResult {}
   */
  async findEventTypeByName(eventTypeName) {
    const currentAccount = await this.#getCurrentAccountInfo()

    const query = {
      user: currentAccount.uri,
      active: true,
      sort: 'position:asc',
    }

    const eventType = await findPagedCollectionItem(async () => {
      const { pagination, collection } = await this.#apiRequest({
        logTag: 'getUserEventTypesList',
        url: `${ API_BASE_URL }/event_types`,
        query,
      })

      for (const item of collection) {
        if (item.name === eventTypeName) {
          return {
            result: item,
          }
        }
      }

      return {
        pagination,
      }
    })

    if (eventType) {
      logger.debug(`Found an event type with name="${ eventTypeName }": ${ JSON.stringify(eventType) }`)
    } else {
      logger.debug(`Can not found an event type with name="${ eventTypeName }"`)
    }

    return eventType
  }

  /**
   * @description Creates a custom one-off meeting link, enabling AI agents to generate personalized booking pages for specific prospects, custom meeting types, or special events. Perfect for creating targeted demo links, personalized consultation bookings, or unique meeting experiences for VIP clients.
   *
   * @route POST /create-one-off-meeting
   * @operationName Create One-Off Meeting
   * @category Meeting Automation
   * @appearanceColor #006bff #0ee8f0
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes events.write
   *
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Meeting title visible to invitees. Examples: 'Product Demo with John', 'VIP Consultation Call'. Defaults to host's name if not specified.","required":false}
   * @paramDef {"type":"String","label":"Host","name":"host","description":"Meeting host from your organization. Select by name or email. Defaults to current user if not specified.","required":false,"dictionary":"getHostsDictionary"}
   * @paramDef {"type":"String","label":"Co Host(s)","name":"coHosts","description":"Additional team members to include in the meeting. Up to 9 co-hosts supported for collaborative sessions.","dictionary":"getHostsDictionary"}
   * @paramDef {"type":"Number","label":"Duration","name":"duration","description":"Meeting length in minutes. Examples: 30 for standard calls, 60 for demos, 15 for quick check-ins. Default: 30 minutes.","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"String","label":"Timezone","name":"timezone","description":"Meeting timezone. Examples: 'America/New_York', 'Europe/London', 'Asia/Tokyo'. Defaults to host's timezone if not specified."}
   * @paramDef {"type": "String", "label": "Start Date", "name": "startDate", "description": "First available booking date. Format: YYYY-MM-DD. Example: '2025-01-20'. Defaults to today.","required":false,"uiComponent":{"type":"DATE_PICKER"}}
   * @paramDef {"type": "String", "label": "End Date", "name": "endDate", "description": "Last available booking date. Format: YYYY-MM-DD. Example: '2025-02-20'. Must be within 365 days of start date.","required":true,"uiComponent":{"type":"DATE_PICKER"}}
   * @paramDef {"type": "String", "label": "Location Kind", "name": "locationKind", "required":true, "uiComponent":{"type": "DROPDOWN", "options": {"values": ["custom", "google_conference", "gotomeeting_conference", "physical", "microsoft_teams_conference", "webex_conference", "zoom_conference", "inbound_call"]}}, "description": "Specifies the meeting location or platform."}
   * @paramDef {"type": "String", "label": "Location", "name": "location", "description": "Meeting location details. Examples: 'Conference Room A', 'zoom.us/j/123456789', '+1-555-0123'. Depends on location kind selected."}
   * @paramDef {"type": "String", "label": "Additional Location Info", "name": "additionalLocationInfo", "description": "Any additional location info"}
   *
   * @returns {Object}
   * @sampleResult {"schedulingURL":"https://calendly.com/d/abc123-def456/product-demo-with-sarah"}
   */
  async createOneOffMeeting(
    name,
    host,
    coHosts,
    duration,
    timezone,
    startDate,
    endDate,
    locationKind,
    location,
    additionalLocationInfo
  ) {
    const body = {
      name,
      host,
      duration,
      co_hosts: Array.isArray(coHosts)
        ? coHosts
        : typeof coHosts === 'string'
          ? [coHosts]
          : null,
      date_setting: {
        type: 'date_range',
        start_date: startDate,
        end_date: endDate,
      },
    }

    if (!body.duration) {
      body.duration = DEFAULT_MEETING_DURATION
    }

    if (!body.date_setting.start_date) {
      body.date_setting.start_date = formatDateToDayString(Date.now())
    }

    if (!body.date_setting.end_date) {
      body.date_setting.end_date = formatDateToDayString(Date.now() + TWO_WEEKS)
    }

    if (timezone) {
      body.timezone = timezone
    }

    if (locationKind) {
      body.location = composeLocationData(locationKind, { location, additionalLocationInfo })
    }

    if (body.host && !body.host.startsWith('http://')) {
      const hostObject = await this.findHostByNameOrEmail(body.host)

      body.host = hostObject?.uri
    }

    const currentUser = !body.name || !body.host ? await this.#getCurrentAccountInfo() : null

    if (!body.name) {
      body.name = `Meeting with ${ currentUser.name }`
    }

    if (!body.host) {
      body.host = currentUser.uri
    }

    const result = await this.#apiRequest({
      logTag: 'getEventInvitee',
      method: 'post',
      url: `${ API_BASE_URL }/one_off_event_types`,
      body,
    })

    return result.resource
  }

  async #resolveEventTypeOption(eventType) {
    if (eventType && !eventType.startsWith('http://') && !eventType.startsWith('https://')) {
      const eventTypeObject = await this.findEventTypeByName(eventType)

      if (!eventTypeObject) {
        throw new Error(`Can not resolve "Event Type" by the following value "${ eventType }"`)
      }

      eventType = eventTypeObject?.uri || null
    }

    return eventType
  }

  /**
   * @description Retrieves a specific user availability schedule by ID, enabling AI agents to understand working hours, date overrides, and scheduling rules. Perfect for intelligent scheduling, availability analysis, and calendar optimization workflows.
   *
   * @route GET /get-user-availability-schedule
   * @operationName Get User Availability Schedule
   * @category Availability Management
   * @appearanceColor #006bff #0ee8f0
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Schedule ID","name":"scheduleId","description":"The unique identifier of the availability schedule to retrieve. Format: UUID. Example: 'abc123-def456-789012'.","required":true}
   *
   * @returns {Object}
   * @sampleResult {"uri":"https://api.calendly.com/user_availability_schedules/abc123-def456","name":"Working Hours","user":"https://api.calendly.com/users/AAAAAAAAAAAAAAAA","timezone":"America/New_York","rules":[{"type":"wday","wday":"monday","intervals":[{"from":"09:00","to":"17:00"}]},{"type":"wday","wday":"tuesday","intervals":[{"from":"09:00","to":"17:00"}]},{"type":"wday","wday":"wednesday","intervals":[{"from":"09:00","to":"17:00"}]},{"type":"wday","wday":"thursday","intervals":[{"from":"09:00","to":"17:00"}]},{"type":"wday","wday":"friday","intervals":[{"from":"09:00","to":"12:00"},{"from":"13:00","to":"17:00"}]}],"date_overrides":[{"date":"2025-01-20","intervals":[{"from":"10:00","to":"14:00"}]}]}
   */
  async getUserAvailabilitySchedule(scheduleId) {
    if (!scheduleId) {
      throw new Error('"Schedule ID" is required')
    }

    const result = await this.#apiRequest({
      logTag: 'getUserAvailabilitySchedule',
      method: 'get',
      url: `${ API_BASE_URL }/user_availability_schedules/${ scheduleId }`,
    })

    return result.resource
  }

  /**
   * @description Lists all user availability schedules for a specific user or the current user, enabling AI agents to analyze multiple schedules, identify patterns, and optimize calendar configurations. Perfect for schedule management, availability reporting, and intelligent calendar coordination.
   *
   * @route GET /list-user-availability-schedules
   * @operationName List User Availability Schedules
   * @category Availability Management
   * @appearanceColor #006bff #0ee8f0
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"User","name":"user","description":"User URI to retrieve schedules for. Format: Calendly user URI. Example: 'https://api.calendly.com/users/AAAAAAAAAAAAAAAA'. Defaults to current authenticated user if not specified.","dictionary":"getHostsDictionary"}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","description":"Number of schedules to return per page. Min: 1, Max: 200. Default: 20.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Token for pagination. Use the next_page_token from previous response to get the next page of results."}
   *
   * @returns {Object}
   * @sampleResult {"collection":[{"uri":"https://api.calendly.com/user_availability_schedules/abc123","name":"Working Hours","user":"https://api.calendly.com/users/AAAAAAAAAAAAAAAA","default":true,"timezone":"America/New_York"},{"uri":"https://api.calendly.com/user_availability_schedules/def456","name":"Weekend Schedule","user":"https://api.calendly.com/users/AAAAAAAAAAAAAAAA","default":false,"timezone":"America/New_York"}],"pagination":{"count":2,"next_page_token":"eyJwYWdlIjogMn0=","next_page":"https://api.calendly.com/user_availability_schedules?user=https%3A%2F%2Fapi.calendly.com%2Fusers%2FAAAAAAAAAAAAAAAA&page_token=eyJwYWdlIjogMn0%3D","previous_page":"https://api.calendly.com/user_availability_schedules?user=https%3A%2F%2Fapi.calendly.com%2Fusers%2FAAAAAAAAAAAAAAAA&page_token=eyJwYWdlIjogMH0%3D","previous_page_token":"eyJwYWdlIjogMH0="}}
   */
  async listUserAvailabilitySchedules(user, pageSize, pageToken) {
    // If no user is specified, get the current user
    if (!user) {
      const currentUser = await this.#getCurrentAccountInfo()
      user = currentUser.uri
    }

    const query = {
      user: user,
      count: pageSize || 20,
      page_token: pageToken || undefined,
    }

    const result = await this.#apiRequest({
      logTag: 'listUserAvailabilitySchedules',
      method: 'get',
      url: `${ API_BASE_URL }/user_availability_schedules`,
      query: cleanupObject(query),
    })

    return result
  }

  /**
   * @description Creates a one-time scheduling link for existing event types, enabling AI agents to generate secure, personalized booking URLs for individual prospects. Perfect for targeted outreach, personalized follow-ups, or creating exclusive booking opportunities that expire after one use.
   *
   * @route POST /create-single-use-scheduling-link
   * @operationName Create Single-Use Scheduling Link
   * @category Meeting Automation
   * @appearanceColor #006bff #0ee8f0
   *
   * @executionTimeoutInSeconds 120
   *
   * @requiredOauth2Scopes events.write
   *
   * @paramDef {"type":"String","label":"Event Type","name":"eventType","dictionary":"getEventTypesDictionary","description":"Select the meeting type for the booking link. Examples: '30 Minute Meeting', 'Product Demo', 'Consultation'. Uses your first active event type if not specified."}
   *
   * @returns {Object}
   * @sampleResult {"schedulingURL":"https://calendly.com/d/xyz789-abc123/30-minute-meeting"}
   */
  async createSingleUseSchedulingLink(eventType) {
    eventType = await this.#resolveEventTypeOption(eventType)

    if (!eventType) {
      const currentAccount = await this.#getCurrentAccountInfo()

      const { collection } = await this.#apiRequest({
        logTag: 'getUserEventTypesList',
        url: `${ API_BASE_URL }/event_types`,
        query: {
          user: currentAccount.uri,
          count: 1,
          active: true,
          sort: 'position:asc',
        },
      })

      eventType = collection[0]?.uri || null

      if (!eventType) {
        throw new Error('Your account has no active event types')
      }
    }

    const response = await this.#apiRequest({
      logTag: 'createSingleUseSchedulingLink',
      method: 'post',
      url: `${ API_BASE_URL }/scheduling_links`,
      body: {
        max_event_count: 1,
        owner: eventType,
        owner_type: 'EventType',
      },
    })

    return {
      schedulingURL: response.resource.booking_url,
    }
  }
}

Flowrunner.ServerCode.addService(CalendlyService, [
  {
    order: 0,
    displayName: 'Client Id',
    defaultValue: '',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your OAuth 2.0 Client ID from the Calendly Developer Portal (used for authentication requests).',
  },
  {
    order: 1,
    displayName: 'Client Secret',
    defaultValue: '',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your OAuth 2.0 Client Secret from the Calendly Developer Portal (required for secure authentication).',
  },
])

function cleanupObject(data) {
  const result = {}

  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null) {
      result[key] = data[key]
    }
  })

  return result
}

async function findPagedCollectionItem(processor) {
  let nextPageToken = null

  do {
    const queryParams = {
      count: MAX_RESULTS_COUNT,
      page_token: nextPageToken,
    }

    const response = await processor(queryParams)

    if (response.result) {
      return response.result
    }

    nextPageToken = response.pagination.next_page_token
  } while (nextPageToken)
}

function composeLocationData(kind, options = {}) {
  const locationTypes = {
    inbound_call: {
      kind,
      phone_number: options.location || '',
      additional_info: options.additionalLocationInfo || '',
    },
    custom: {
      kind,
      location: options.location || '',
    },
    physical: {
      kind,
      location: options.location || '',
      additional_info: options.additionalLocationInfo || '',
    },
  }

  return locationTypes[kind] || { kind: kind }
}

function formatDateToDayString(value) {
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${ year }-${ month }-${ day }`
}

function getIdFromURI(uri) {
  return uri.split('/').pop()
}

function searchFilter(list, props, searchString) {
  return list.filter(item =>
    props.some(prop => {
      const value = prop.split('.').reduce((acc, key) => acc?.[key], item)

      return value && String(value).toLowerCase().includes(searchString.toLowerCase())
    })
  )
}
