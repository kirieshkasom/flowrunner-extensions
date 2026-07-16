const logger = {
  info: (...args) => console.log('[Iterable] info:', ...args),
  debug: (...args) => console.log('[Iterable] debug:', ...args),
  error: (...args) => console.log('[Iterable] error:', ...args),
  warn: (...args) => console.log('[Iterable] warn:', ...args),
}

const US_BASE_URL = 'https://api.iterable.com/api'
const EU_BASE_URL = 'https://api.eu.iterable.com/api'

/**
 * Removes undefined, null, and empty-string values from a flat object so they
 * are not sent to the Iterable API. Nested objects (dataFields) are left intact.
 */
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
 * @integrationName Iterable
 * @integrationIcon /icon.png
 */
class IterableService {
  constructor(config) {
    this.apiKey = config.apiKey
    this.baseUrl = config.region === 'EU' ? EU_BASE_URL : US_BASE_URL
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const url = `${ this.baseUrl }${ path }`

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Api-Key': this.apiKey,
          'Content-Type': 'application/json',
        })
        .query(clean(query) || {})

      const response = body !== undefined ? await request.send(body) : await request

      // Iterable wraps write responses in { code, msg, params }. A non-Success
      // code returned with a 2xx status still indicates a failure.
      if (response && response.code && response.code !== 'Success') {
        throw new Error(`Iterable API error: ${ response.msg || response.code }`)
      }

      return response
    } catch (error) {
      if (error.message && error.message.startsWith('Iterable API error:')) {
        throw error
      }

      const body = error.body || {}
      const message = body.msg || body.message || error.message || 'Unknown error'
      const code = body.code ? ` (${ body.code })` : ''

      logger.error(`${ logTag } - failed: ${ message }${ code }`)

      throw new Error(`Iterable API error: ${ message }${ code }`)
    }
  }

  // Maps a friendly dropdown label to the API value, passing through unknown values.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /* ==================================================================== */
  /* Users                                                                 */
  /* ==================================================================== */

  /**
   * @operationName Update User
   * @category Users
   * @description Creates or updates a single user profile in Iterable. Identify the user by email or userId (at least one is required). Provide dataFields as an object of profile attributes to set. Enable Merge Nested Objects to deep-merge nested dataFields instead of overwriting them. Users are email-keyed by default; set Prefer User ID for userId-based projects.
   * @route POST /users/update
   * @paramDef {"type":"String","label":"Email","name":"email","description":"User email address. Required unless User ID is provided."}
   * @paramDef {"type":"String","label":"User ID","name":"userId","description":"Unique user identifier. Required unless Email is provided (or in userId-based projects)."}
   * @paramDef {"type":"Object","label":"Data Fields","name":"dataFields","description":"Object of profile attributes to create or update, e.g. {\"firstName\":\"Ada\",\"plan\":\"pro\"}."}
   * @paramDef {"type":"Boolean","label":"Merge Nested Objects","name":"mergeNestedObjects","uiComponent":{"type":"CHECKBOX"},"description":"When true, nested objects in Data Fields are deep-merged with the existing profile instead of replaced. Defaults to false."}
   * @paramDef {"type":"Boolean","label":"Prefer User ID","name":"preferUserId","uiComponent":{"type":"CHECKBOX"},"description":"When true, create the user by userId if they do not already exist. Defaults to false."}
   * @returns {Object}
   * @sampleResult {"code":"Success","msg":"","params":null}
   */
  async updateUser(email, userId, dataFields, mergeNestedObjects, preferUserId) {
    return await this.#apiRequest({
      logTag: '[updateUser]',
      path: '/users/update',
      method: 'post',
      body: clean({
        email,
        userId,
        dataFields: dataFields || undefined,
        mergeNestedObjects: mergeNestedObjects || undefined,
        preferUserId: preferUserId || undefined,
      }),
    })
  }

  /**
   * @operationName Get User
   * @category Users
   * @description Retrieves a single user profile with all of its data fields. Look the user up by email (default) or by userId. Returns the user object including email, userId, and dataFields.
   * @route GET /users/get
   * @paramDef {"type":"String","label":"Identifier","name":"identifier","required":true,"description":"The user's email address, or their userId when Look Up By is set to User ID."}
   * @paramDef {"type":"String","label":"Look Up By","name":"lookupBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Email","User ID"]}},"description":"Whether the Identifier is an email or a userId. Defaults to Email."}
   * @returns {Object}
   * @sampleResult {"user":{"email":"user@example.com","userId":"u-123","dataFields":{"firstName":"Ada","plan":"pro"}}}
   */
  async getUser(identifier, lookupBy) {
    const byUserId = lookupBy === 'User ID'
    const path = byUserId
      ? `/users/byUserId/${ encodeURIComponent(identifier) }`
      : `/users/${ encodeURIComponent(identifier) }`

    return await this.#apiRequest({
      logTag: '[getUser]',
      path,
      method: 'get',
    })
  }

  /**
   * @operationName Delete User
   * @category Users
   * @description Permanently deletes a user profile from Iterable by email address. This removes the user and their profile data; the action cannot be undone.
   * @route DELETE /users/delete
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Email address of the user to delete."}
   * @returns {Object}
   * @sampleResult {"code":"Success","msg":"","params":null}
   */
  async deleteUser(email) {
    return await this.#apiRequest({
      logTag: '[deleteUser]',
      path: `/users/${ encodeURIComponent(email) }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Bulk Update Users
   * @category Users
   * @description Creates or updates many user profiles in a single request. Provide an array of user objects, each with an email or userId and optional dataFields. Efficient for syncing large batches of profiles.
   * @route POST /users/bulk-update
   * @paramDef {"type":"Array<Object>","label":"Users","name":"users","required":true,"description":"Array of user objects, each like {\"email\":\"a@x.com\",\"dataFields\":{\"plan\":\"pro\"}}. Each must include an email or userId."}
   * @returns {Object}
   * @sampleResult {"successCount":2,"failCount":0,"invalidEmails":[],"invalidUserIds":[]}
   */
  async bulkUpdateUsers(users) {
    return await this.#apiRequest({
      logTag: '[bulkUpdateUsers]',
      path: '/users/bulkUpdate',
      method: 'post',
      body: { users: users || [] },
    })
  }

  /**
   * @operationName Update Subscriptions
   * @category Users
   * @description Overwrites a user's subscription state across email lists, message channels, and message types. Provide the arrays of IDs to set; omitted arrays are left unchanged. Use Update Subscriptions when you need to explicitly control unsubscribes rather than toggling a single list.
   * @route POST /users/update-subscriptions
   * @paramDef {"type":"String","label":"Email","name":"email","description":"User email address. Required unless User ID is provided."}
   * @paramDef {"type":"String","label":"User ID","name":"userId","description":"Unique user identifier. Required unless Email is provided."}
   * @paramDef {"type":"Array<Number>","label":"Email List IDs","name":"emailListIds","description":"List IDs the user should be subscribed to."}
   * @paramDef {"type":"Array<Number>","label":"Unsubscribed Channel IDs","name":"unsubscribedChannelIds","description":"Channel IDs the user should be unsubscribed from."}
   * @paramDef {"type":"Array<Number>","label":"Unsubscribed Message Type IDs","name":"unsubscribedMessageTypeIds","description":"Message type IDs the user should be unsubscribed from."}
   * @paramDef {"type":"Array<Number>","label":"Subscribed Message Type IDs","name":"subscribedMessageTypeIds","description":"Message type IDs the user should be subscribed to (double opt-in)."}
   * @paramDef {"type":"Number","label":"Campaign ID","name":"campaignId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional campaign ID to attribute the subscription change to."}
   * @returns {Object}
   * @sampleResult {"code":"Success","msg":"","params":null}
   */
  async updateSubscriptions(email, userId, emailListIds, unsubscribedChannelIds, unsubscribedMessageTypeIds, subscribedMessageTypeIds, campaignId) {
    return await this.#apiRequest({
      logTag: '[updateSubscriptions]',
      path: '/users/updateSubscriptions',
      method: 'post',
      body: clean({
        email,
        userId,
        emailListIds: emailListIds || undefined,
        unsubscribedChannelIds: unsubscribedChannelIds || undefined,
        unsubscribedMessageTypeIds: unsubscribedMessageTypeIds || undefined,
        subscribedMessageTypeIds: subscribedMessageTypeIds || undefined,
        campaignId: campaignId || undefined,
      }),
    })
  }

  /**
   * @operationName Get User Fields
   * @category Users
   * @description Returns the schema of all user profile fields defined in the Iterable project, mapping each field name to its data type. Useful for discovering which dataFields are available before updating users.
   * @route GET /users/get-fields
   * @returns {Object}
   * @sampleResult {"fields":{"email":"string","firstName":"string","signupDate":"date","plan":"string"}}
   */
  async getUserFields() {
    return await this.#apiRequest({
      logTag: '[getUserFields]',
      path: '/users/getFields',
      method: 'get',
    })
  }

  /* ==================================================================== */
  /* Events                                                                */
  /* ==================================================================== */

  /**
   * @operationName Track Event
   * @category Events
   * @description Tracks a single custom event for a user, identified by email or userId. Provide the event name and optional dataFields describing the event. Custom events power triggered campaigns and workflow entry criteria in Iterable.
   * @route POST /events/track
   * @paramDef {"type":"String","label":"Event Name","name":"eventName","required":true,"description":"Name of the custom event, e.g. \"purchase\" or \"videoWatched\"."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"User email address. Required unless User ID is provided."}
   * @paramDef {"type":"String","label":"User ID","name":"userId","description":"Unique user identifier. Required unless Email is provided."}
   * @paramDef {"type":"Object","label":"Data Fields","name":"dataFields","description":"Object of event attributes, e.g. {\"amount\":49.99,\"currency\":\"USD\"}."}
   * @paramDef {"type":"Number","label":"Created At","name":"createdAt","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Event timestamp as a Unix time in seconds. Defaults to the current time if omitted."}
   * @paramDef {"type":"Number","label":"Campaign ID","name":"campaignId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional campaign ID to attribute the event to."}
   * @returns {Object}
   * @sampleResult {"code":"Success","msg":"","params":null}
   */
  async trackEvent(eventName, email, userId, dataFields, createdAt, campaignId) {
    return await this.#apiRequest({
      logTag: '[trackEvent]',
      path: '/events/track',
      method: 'post',
      body: clean({
        eventName,
        email,
        userId,
        dataFields: dataFields || undefined,
        createdAt: createdAt || undefined,
        campaignId: campaignId || undefined,
      }),
    })
  }

  /**
   * @operationName Track Bulk Events
   * @category Events
   * @description Tracks many custom events in a single request. Provide an array of event objects, each with an eventName, an email or userId, and optional dataFields and createdAt. Efficient for ingesting batches of events.
   * @route POST /events/track-bulk
   * @paramDef {"type":"Array<Object>","label":"Events","name":"events","required":true,"description":"Array of event objects, each like {\"email\":\"a@x.com\",\"eventName\":\"purchase\",\"dataFields\":{\"amount\":10}}."}
   * @returns {Object}
   * @sampleResult {"successCount":3,"failCount":0,"invalidEmails":[],"invalidUserIds":[]}
   */
  async trackBulkEvents(events) {
    return await this.#apiRequest({
      logTag: '[trackBulkEvents]',
      path: '/events/trackBulk',
      method: 'post',
      body: { events: events || [] },
    })
  }

  /* ==================================================================== */
  /* Lists                                                                 */
  /* ==================================================================== */

  /**
   * @operationName Get Lists
   * @category Lists
   * @description Returns all lists in the Iterable project, including each list's ID, name, type, and creation time. Use a list's ID with the subscribe, unsubscribe, and get users operations.
   * @route GET /lists
   * @returns {Object}
   * @sampleResult {"lists":[{"id":12345,"name":"Newsletter","createdAt":1700000000000,"listType":"Standard"}]}
   */
  async getLists() {
    return await this.#apiRequest({
      logTag: '[getLists]',
      path: '/lists',
      method: 'get',
    })
  }

  /**
   * @operationName Create List
   * @category Lists
   * @description Creates a new static list in Iterable with the given name. Returns the numeric ID of the created list, which you can use to subscribe or unsubscribe users.
   * @route POST /lists
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name for the new list."}
   * @returns {Object}
   * @sampleResult {"listId":12345}
   */
  async createList(name) {
    return await this.#apiRequest({
      logTag: '[createList]',
      path: '/lists',
      method: 'post',
      body: { name },
    })
  }

  /**
   * @operationName Delete List
   * @category Lists
   * @description Permanently deletes a list from Iterable by its ID. This removes the list itself; user profiles are not deleted. The action cannot be undone.
   * @route DELETE /lists
   * @paramDef {"type":"Number","label":"List ID","name":"listId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getListsDictionary","description":"ID of the list to delete. Select a list or enter its ID."}
   * @returns {Object}
   * @sampleResult {"code":"Success","msg":"","params":null}
   */
  async deleteList(listId) {
    return await this.#apiRequest({
      logTag: '[deleteList]',
      path: `/lists/${ encodeURIComponent(listId) }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Subscribe to List
   * @category Lists
   * @description Adds one or more users to a list. Provide the list ID and an array of subscriber objects, each identified by email or userId. New users can be created on subscribe. Returns counts of successful and failed subscriptions.
   * @route POST /lists/subscribe
   * @paramDef {"type":"Number","label":"List ID","name":"listId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getListsDictionary","description":"ID of the list to subscribe users to."}
   * @paramDef {"type":"Array<Object>","label":"Subscribers","name":"subscribers","required":true,"description":"Array of subscriber objects, each like {\"email\":\"a@x.com\"} or {\"userId\":\"u-1\"}."}
   * @returns {Object}
   * @sampleResult {"successCount":2,"failCount":0,"invalidEmails":[],"invalidUserIds":[]}
   */
  async subscribeToList(listId, subscribers) {
    return await this.#apiRequest({
      logTag: '[subscribeToList]',
      path: '/lists/subscribe',
      method: 'post',
      body: {
        listId,
        subscribers: subscribers || [],
      },
    })
  }

  /**
   * @operationName Unsubscribe from List
   * @category Lists
   * @description Removes one or more users from a list. Provide the list ID and an array of subscriber objects, each identified by email or userId. Returns counts of successful and failed unsubscriptions.
   * @route POST /lists/unsubscribe
   * @paramDef {"type":"Number","label":"List ID","name":"listId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getListsDictionary","description":"ID of the list to unsubscribe users from."}
   * @paramDef {"type":"Array<Object>","label":"Subscribers","name":"subscribers","required":true,"description":"Array of subscriber objects, each like {\"email\":\"a@x.com\"} or {\"userId\":\"u-1\"}."}
   * @returns {Object}
   * @sampleResult {"successCount":1,"failCount":0,"invalidEmails":[],"invalidUserIds":[]}
   */
  async unsubscribeFromList(listId, subscribers) {
    return await this.#apiRequest({
      logTag: '[unsubscribeFromList]',
      path: '/lists/unsubscribe',
      method: 'post',
      body: {
        listId,
        subscribers: subscribers || [],
      },
    })
  }

  /**
   * @operationName Get List Users
   * @category Lists
   * @description Returns the email addresses of all users on a list. Provide the list ID. The response is a newline-delimited list of emails, useful for auditing or exporting list membership.
   * @route GET /lists/get-users
   * @paramDef {"type":"Number","label":"List ID","name":"listId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getListsDictionary","description":"ID of the list whose members to retrieve."}
   * @returns {Object}
   * @sampleResult {"emails":"user1@example.com\nuser2@example.com"}
   */
  async getListUsers(listId) {
    const response = await this.#apiRequest({
      logTag: '[getListUsers]',
      path: '/lists/getUsers',
      method: 'get',
      query: { listId },
    })

    // This endpoint returns a newline-delimited text body of emails; wrap it so
    // the action always returns a consistent object.
    if (typeof response === 'string') {
      return { emails: response }
    }

    return response
  }

  /**
   * @operationName Get List Size
   * @category Lists
   * @description Returns the number of users currently on a list. Provide the list ID.
   * @route GET /lists/size
   * @paramDef {"type":"Number","label":"List ID","name":"listId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getListsDictionary","description":"ID of the list whose size to retrieve."}
   * @returns {Object}
   * @sampleResult {"size":1042}
   */
  async getListSize(listId) {
    const response = await this.#apiRequest({
      logTag: '[getListSize]',
      path: `/lists/${ encodeURIComponent(listId) }/size`,
      method: 'get',
    })

    // The endpoint returns a bare integer; normalize to an object.
    if (typeof response === 'number') {
      return { size: response }
    }

    return response
  }

  /* ==================================================================== */
  /* Email & Push                                                          */
  /* ==================================================================== */

  /**
   * @operationName Send Email
   * @category Messaging
   * @description Sends a triggered (transactional) email to a single recipient using an existing email campaign. Provide the campaign ID and recipient email, plus optional dataFields to populate template merge variables. The campaign must be a triggered/transactional email campaign.
   * @route POST /email/target
   * @paramDef {"type":"Number","label":"Campaign ID","name":"campaignId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getCampaignsDictionary","description":"ID of the triggered email campaign to send."}
   * @paramDef {"type":"String","label":"Recipient Email","name":"recipientEmail","required":true,"description":"Email address of the recipient."}
   * @paramDef {"type":"Object","label":"Data Fields","name":"dataFields","description":"Object of merge values to populate the email template, e.g. {\"orderId\":\"A-100\"}."}
   * @returns {Object}
   * @sampleResult {"code":"Success","msg":"","params":null}
   */
  async sendEmail(campaignId, recipientEmail, dataFields) {
    return await this.#apiRequest({
      logTag: '[sendEmail]',
      path: '/email/target',
      method: 'post',
      body: clean({
        campaignId,
        recipientEmail,
        dataFields: dataFields || undefined,
      }),
    })
  }

  /**
   * @operationName Send Push
   * @category Messaging
   * @description Sends a triggered push notification to a single recipient using an existing push campaign. Provide the campaign ID and recipient (email or userId), plus optional dataFields for template merge variables. The campaign must be a triggered push campaign.
   * @route POST /push/target
   * @paramDef {"type":"Number","label":"Campaign ID","name":"campaignId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getCampaignsDictionary","description":"ID of the triggered push campaign to send."}
   * @paramDef {"type":"String","label":"Recipient Email","name":"recipientEmail","description":"Recipient email address. Required unless Recipient User ID is provided."}
   * @paramDef {"type":"String","label":"Recipient User ID","name":"recipientUserId","description":"Recipient userId. Required unless Recipient Email is provided."}
   * @paramDef {"type":"Object","label":"Data Fields","name":"dataFields","description":"Object of merge values to populate the push template."}
   * @returns {Object}
   * @sampleResult {"code":"Success","msg":"","params":null}
   */
  async sendPush(campaignId, recipientEmail, recipientUserId, dataFields) {
    return await this.#apiRequest({
      logTag: '[sendPush]',
      path: '/push/target',
      method: 'post',
      body: clean({
        campaignId,
        recipientEmail,
        recipientUserId,
        dataFields: dataFields || undefined,
      }),
    })
  }

  /* ==================================================================== */
  /* Campaigns                                                             */
  /* ==================================================================== */

  /**
   * @operationName List Campaigns
   * @category Campaigns
   * @description Returns all campaigns in the Iterable project, including each campaign's ID, name, type, medium, template ID, and status. Use a campaign's ID with Send Email, Send Push, or Get Campaign Metrics.
   * @route GET /campaigns
   * @returns {Object}
   * @sampleResult {"campaigns":[{"id":98765,"name":"Welcome Series","campaignState":"Ready","messageMedium":"Email","templateId":54321}]}
   */
  async listCampaigns() {
    return await this.#apiRequest({
      logTag: '[listCampaigns]',
      path: '/campaigns',
      method: 'get',
    })
  }

  /**
   * @operationName Get Campaign Metrics
   * @category Campaigns
   * @description Returns aggregate performance metrics (sends, opens, clicks, bounces, unsubscribes, and more) for one or more campaigns as CSV. Provide one or more campaign IDs and an optional date range.
   * @route GET /campaigns/metrics
   * @paramDef {"type":"Array<Number>","label":"Campaign IDs","name":"campaignIds","required":true,"description":"One or more campaign IDs to report on."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDateTime","uiComponent":{"type":"DATE_PICKER"},"description":"Optional start of the reporting window, e.g. 2024-01-01."}
   * @paramDef {"type":"String","label":"End Date","name":"endDateTime","uiComponent":{"type":"DATE_PICKER"},"description":"Optional end of the reporting window, e.g. 2024-01-31."}
   * @returns {Object}
   * @sampleResult {"metrics":"id,name,uniqueEmailSends,uniqueEmailOpens\n98765,Welcome,1000,420"}
   */
  async getCampaignMetrics(campaignIds, startDateTime, endDateTime) {
    const response = await this.#apiRequest({
      logTag: '[getCampaignMetrics]',
      path: '/campaigns/metrics',
      method: 'get',
      query: {
        campaignId: campaignIds,
        startDateTime,
        endDateTime,
      },
    })

    // The endpoint returns CSV text; wrap it so the action returns an object.
    if (typeof response === 'string') {
      return { metrics: response }
    }

    return response
  }

  /* ==================================================================== */
  /* Templates                                                            */
  /* ==================================================================== */

  /**
   * @operationName List Email Templates
   * @category Templates
   * @description Returns email templates in the Iterable project, including each template's ID, name, creation time, and associated campaign. Optionally filter by template type and message medium.
   * @route GET /templates
   * @paramDef {"type":"String","label":"Template Type","name":"templateType","uiComponent":{"type":"DROPDOWN","options":{"values":["Base","Blast","Triggered","Workflow"]}},"description":"Optional filter by template type."}
   * @paramDef {"type":"String","label":"Message Medium","name":"messageMedium","uiComponent":{"type":"DROPDOWN","options":{"values":["Email","Push","SMS","In-App"]}},"description":"Optional filter by message medium. Defaults to Email."}
   * @returns {Object}
   * @sampleResult {"templates":[{"templateId":54321,"name":"Welcome Email","createdAt":1700000000000,"templateType":"Triggered","messageMedium":"Email"}]}
   */
  async listEmailTemplates(templateType, messageMedium) {
    return await this.#apiRequest({
      logTag: '[listEmailTemplates]',
      path: '/templates',
      method: 'get',
      query: {
        templateType: this.#resolveChoice(templateType, {
          Base: 'Base',
          Blast: 'Blast',
          Triggered: 'Triggered',
          Workflow: 'Workflow',
        }),
        messageMedium: this.#resolveChoice(messageMedium, {
          Email: 'Email',
          Push: 'Push',
          SMS: 'SMS',
          'In-App': 'InApp',
        }),
      },
    })
  }

  /**
   * @operationName Get Email Template
   * @category Templates
   * @description Retrieves a single email template by its ID, returning its metadata and content including subject, preheader, and HTML body.
   * @route GET /templates/email/get
   * @paramDef {"type":"Number","label":"Template ID","name":"templateId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of the email template to retrieve."}
   * @returns {Object}
   * @sampleResult {"templateId":54321,"name":"Welcome Email","fromName":"Acme","subject":"Welcome!","preheaderText":"Glad you're here","html":"<html>...</html>"}
   */
  async getEmailTemplate(templateId) {
    return await this.#apiRequest({
      logTag: '[getEmailTemplate]',
      path: '/templates/email/get',
      method: 'get',
      query: { templateId },
    })
  }

  /* ==================================================================== */
  /* Dictionaries                                                          */
  /* ==================================================================== */

  /**
   * @typedef {Object} getListsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter lists by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Iterable returns all lists in one call, so this is unused but kept for compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Lists Dictionary
   * @description Provides a selectable list of Iterable lists for list-based parameters. The option value is the numeric list ID.
   * @route POST /get-lists-dictionary
   * @paramDef {"type":"getListsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Newsletter","value":12345,"note":"Standard"}],"cursor":null}
   */
  async getListsDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getListsDictionary]',
      path: '/lists',
      method: 'get',
    })

    const lists = (response && response.lists) || []
    const term = (search || '').trim().toLowerCase()

    const items = lists
      .filter(list => !term || (list.name || '').toLowerCase().includes(term))
      .map(list => ({
        label: list.name || `List ${ list.id }`,
        value: list.id,
        note: list.listType || undefined,
      }))

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} getCampaignsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter campaigns by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Iterable returns all campaigns in one call, so this is unused but kept for compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Campaigns Dictionary
   * @description Provides a selectable list of Iterable campaigns for campaign-based parameters. The option value is the numeric campaign ID.
   * @route POST /get-campaigns-dictionary
   * @paramDef {"type":"getCampaignsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Welcome Series","value":98765,"note":"Email - Ready"}],"cursor":null}
   */
  async getCampaignsDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getCampaignsDictionary]',
      path: '/campaigns',
      method: 'get',
    })

    const campaigns = (response && response.campaigns) || []
    const term = (search || '').trim().toLowerCase()

    const items = campaigns
      .filter(campaign => !term || (campaign.name || '').toLowerCase().includes(term))
      .map(campaign => {
        const noteParts = [campaign.messageMedium, campaign.campaignState].filter(Boolean)

        return {
          label: campaign.name || `Campaign ${ campaign.id }`,
          value: campaign.id,
          note: noteParts.join(' - ') || undefined,
        }
      })

    return { items, cursor: null }
  }
}

Flowrunner.ServerCode.addService(IterableService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'A server-side API key. Create one in Iterable under Settings > API Keys.',
  },
  {
    name: 'region',
    displayName: 'Data Center',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    options: ['US', 'EU'],
    defaultValue: 'US',
    required: false,
    shared: false,
    hint: 'EU data center accounts use api.eu.iterable.com. Choose EU only if your Iterable account is hosted in the EU.',
  },
])
