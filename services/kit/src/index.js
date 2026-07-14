// ============================================================================
//  SPEC: Kit (formerly ConvertKit) — v4 API   auth: api-key (X-Kit-Api-Key)
//  RESOURCES:
//    - Subscribers:   create, get, list (filters), update, unsubscribe
//    - Tags:          create, list (+dictionary), tag by id, tag by email,
//                     remove tag, list subscribers for tag
//    - Forms:         list (+dictionary), add subscriber (by id or email)
//    - Sequences:     list (+dictionary), add subscriber (by id or email)
//    - Custom Fields: list, create
//    - Broadcasts:    list, create (draft/scheduled), get, stats
//    - Account:       get current account (connection sanity check)
//  TRIGGERS: REALTIME (SINGLE_APP) — onKitEvent (v4 webhooks; one webhook per
//            registered trigger; the callback URL carries triggerId/kitEvent
//            query params because Kit deliveries do not echo the event name).
//  API DOCS: https://developers.kit.com/v4 — cursor pagination (after/before/
//            per_page), errors arrive as { errors: [ ... ] }.
// ============================================================================

const API_BASE = 'https://api.kit.com/v4'

// Maps the friendly Event dropdown label to the Kit v4 webhook event name.
// Verified against https://developers.kit.com/api-reference/webhooks/create-a-webhook
const TRIGGER_EVENT_LABEL_TO_NAME = {
  'Subscriber Activated': 'subscriber.subscriber_activate',
  'Subscriber Unsubscribed': 'subscriber.subscriber_unsubscribe',
  'Subscriber Bounced': 'subscriber.subscriber_bounce',
  'Subscriber Complained': 'subscriber.subscriber_complain',
  'Tag Added': 'subscriber.tag_add',
  'Tag Removed': 'subscriber.tag_remove',
  'Form Subscribed': 'subscriber.form_subscribe',
  'Sequence Subscribed': 'subscriber.course_subscribe',
  'Sequence Completed': 'subscriber.course_complete',
  'Link Clicked': 'subscriber.link_click',
  'Purchase Created': 'purchase.purchase_create',
}

// Events that require an extra identifier in the webhook subscription body.
const TRIGGER_EVENT_EXTRA_PARAM = {
  'subscriber.tag_add': { bodyKey: 'tag_id', triggerParam: 'tagId', label: 'Tag' },
  'subscriber.tag_remove': { bodyKey: 'tag_id', triggerParam: 'tagId', label: 'Tag' },
  'subscriber.form_subscribe': { bodyKey: 'form_id', triggerParam: 'formId', label: 'Form' },
  'subscriber.course_subscribe': { bodyKey: 'sequence_id', triggerParam: 'sequenceId', label: 'Sequence' },
  'subscriber.course_complete': { bodyKey: 'sequence_id', triggerParam: 'sequenceId', label: 'Sequence' },
  'subscriber.link_click': { bodyKey: 'initiator_value', triggerParam: 'linkUrl', label: 'Link URL' },
}

const CALL_TYPES = {
  SHAPE_EVENT: 'SHAPE_EVENT',
  FILTER_TRIGGER: 'FILTER_TRIGGER',
}

// ============================================================================
//  LOGGER
// ============================================================================
const logger = {
  info: (...args) => console.log('[Kit] info:', ...args),
  debug: (...args) => console.log('[Kit] debug:', ...args),
  error: (...args) => console.log('[Kit] error:', ...args),
  warn: (...args) => console.log('[Kit] warn:', ...args),
}

// ============================================================================
//  DICTIONARY PAYLOAD TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} getTagsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter tags by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getFormsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter forms by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getSequencesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter sequences by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @integrationName Kit (ConvertKit)
 * @integrationIcon /icon.png
 * @integrationTriggersScope SINGLE_APP
 */
class Kit {
  constructor(config) {
    this.config = config || {}
    this.apiKey = this.config.apiKey
  }

  // ==========================================================================
  //  CORE — every external call goes through #apiRequest
  // ==========================================================================
  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'

    try {
      logger.debug(`${ logTag } ${ method.toUpperCase() } ${ url }`)

      const request = Flowrunner.Request[method](url)
        .set({ 'X-Kit-Api-Key': this.apiKey, 'Content-Type': 'application/json' })
        .query(query || {})

      if (body !== undefined) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      // Kit v4 errors arrive as { errors: ["message", ...] }.
      const apiErrors = error?.body?.errors
      const message = Array.isArray(apiErrors) && apiErrors.length
        ? apiErrors.join('; ')
        : error?.body?.error || error?.message || 'Request failed'

      logger.error(`${ logTag } failed: ${ message }`)

      throw new Error(`Kit API error: ${ message }`)
    }
  }

  // Removes undefined/null/'' entries so optional params never reach the API.
  #clean(object) {
    const result = {}

    for (const [key, value] of Object.entries(object || {})) {
      if (value !== undefined && value !== null && value !== '') {
        result[key] = value
      }
    }

    return result
  }

  // Maps a friendly dropdown label to its Kit API value. Unmapped values
  // (and identity dropdowns) pass through unchanged.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Builds the shared cursor-pagination query (after/before/per_page).
  #pagination(afterCursor, beforeCursor, perPage) {
    return this.#clean({
      after: afterCursor,
      before: beforeCursor,
      per_page: perPage,
    })
  }

  // ==========================================================================
  //  ACCOUNT
  // ==========================================================================
  /**
   * @operationName Get Account
   * @category Account
   * @description Retrieves the current Kit account — name, primary email, plan type, and timezone. Use this to verify the API key connection or to read account-level details.
   * @route GET /get-account
   * @returns {Object}
   * @sampleResult {"account":{"id":12345,"name":"Acme Newsletter","primary_email_address":"owner@example.com","plan_type":"creator","timezone":{"name":"Eastern Time (US & Canada)","friendly_name":"(GMT-05:00) Eastern Time (US & Canada)","utc_offset":"-05:00"}}}
   */
  async getAccount() {
    // docs: https://developers.kit.com/api-reference/accounts/get-current-account
    return await this.#apiRequest({
      url: `${ API_BASE }/account`,
      logTag: 'getAccount',
    })
  }

  // ==========================================================================
  //  SUBSCRIBERS
  // ==========================================================================
  /**
   * @operationName Create Subscriber
   * @category Subscribers
   * @description Creates a subscriber in Kit (or updates the existing one when the email address is already present). Optionally sets the first name, state, and custom field values. Note: subscribers created this way are added directly without a confirmation email.
   * @route POST /create-subscriber
   * @paramDef {"type":"String","label":"Email Address","name":"emailAddress","required":true,"description":"The subscriber's email address. If a subscriber with this email already exists, it is updated instead of duplicated."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"The subscriber's first name."}
   * @paramDef {"type":"String","label":"State","name":"state","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Inactive"]}},"description":"Initial state of the subscriber. Defaults to Active when left blank."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"fields","description":"Custom field values keyed by the field's label exactly as it appears in Kit (e.g. {\"Company\":\"Acme\"}). Fields must already exist — use Create Custom Field first if needed."}
   * @returns {Object}
   * @sampleResult {"subscriber":{"id":987654,"first_name":"Alice","email_address":"alice@example.com","state":"active","created_at":"2026-01-15T09:30:00Z","fields":{"Company":"Acme"}}}
   */
  async createSubscriber(emailAddress, firstName, state, fields) {
    // docs: https://developers.kit.com/api-reference/subscribers/create-a-subscriber
    return await this.#apiRequest({
      url: `${ API_BASE }/subscribers`,
      method: 'post',
      body: this.#clean({
        email_address: emailAddress,
        first_name: firstName,
        state: this.#resolveChoice(state, { Active: 'active', Inactive: 'inactive' }),
        fields,
      }),
      logTag: 'createSubscriber',
    })
  }

  /**
   * @operationName Get Subscriber
   * @category Subscribers
   * @description Retrieves a single Kit subscriber by ID, including their email, first name, state, and custom field values.
   * @route GET /get-subscriber
   * @paramDef {"type":"String","label":"Subscriber ID","name":"subscriberId","required":true,"description":"The numeric ID of the subscriber to fetch. Find it via List Subscribers or from a trigger payload."}
   * @returns {Object}
   * @sampleResult {"subscriber":{"id":987654,"first_name":"Alice","email_address":"alice@example.com","state":"active","created_at":"2026-01-15T09:30:00Z","fields":{"Company":"Acme"}}}
   */
  async getSubscriber(subscriberId) {
    // docs: https://developers.kit.com/api-reference/subscribers/get-a-subscriber
    return await this.#apiRequest({
      url: `${ API_BASE }/subscribers/${ subscriberId }`,
      logTag: 'getSubscriber',
    })
  }

  /**
   * @operationName List Subscribers
   * @category Subscribers
   * @description Lists subscribers in the Kit account with optional filters: exact email address, status, and creation date range. Results are cursor-paginated — pass the returned pagination.end_cursor as After Cursor to fetch the next page.
   * @route GET /list-subscribers
   * @paramDef {"type":"String","label":"Email Address","name":"emailAddress","description":"Filter to the subscriber with this exact email address."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Inactive","Bounced","Complained","Cancelled","All"]}},"description":"Filter by subscriber status. Defaults to Active when left blank."}
   * @paramDef {"type":"String","label":"Created After","name":"createdAfter","uiComponent":{"type":"DATE_PICKER"},"description":"Only subscribers created after this date (ISO 8601)."}
   * @paramDef {"type":"String","label":"Created Before","name":"createdBefore","uiComponent":{"type":"DATE_PICKER"},"description":"Only subscribers created before this date (ISO 8601)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page (1-500, default 500)."}
   * @paramDef {"type":"String","label":"After Cursor","name":"afterCursor","description":"Pagination cursor — pass the previous response's pagination.end_cursor to get the next page."}
   * @paramDef {"type":"String","label":"Before Cursor","name":"beforeCursor","description":"Pagination cursor — pass the previous response's pagination.start_cursor to get the prior page."}
   * @returns {Object}
   * @sampleResult {"subscribers":[{"id":987654,"first_name":"Alice","email_address":"alice@example.com","state":"active","created_at":"2026-01-15T09:30:00Z"}],"pagination":{"has_previous_page":false,"has_next_page":true,"start_cursor":"WzFd","end_cursor":"WzUwMF0","per_page":500}}
   */
  async listSubscribers(emailAddress, status, createdAfter, createdBefore, perPage, afterCursor, beforeCursor) {
    // docs: https://developers.kit.com/api-reference/subscribers/list-subscribers
    return await this.#apiRequest({
      url: `${ API_BASE }/subscribers`,
      query: {
        ...this.#clean({
          email_address: emailAddress,
          status: this.#resolveChoice(status, {
            Active: 'active',
            Inactive: 'inactive',
            Bounced: 'bounced',
            Complained: 'complained',
            Cancelled: 'cancelled',
            All: 'all',
          }),
          created_after: createdAfter,
          created_before: createdBefore,
        }),
        ...this.#pagination(afterCursor, beforeCursor, perPage),
      },
      logTag: 'listSubscribers',
    })
  }

  /**
   * @operationName Update Subscriber
   * @category Subscribers
   * @description Updates a Kit subscriber's email address, first name, and/or custom field values. Leave a field blank to keep its current value. To change subscription state, use Unsubscribe Subscriber instead.
   * @route PUT /update-subscriber
   * @paramDef {"type":"String","label":"Subscriber ID","name":"subscriberId","required":true,"description":"The numeric ID of the subscriber to update."}
   * @paramDef {"type":"String","label":"Email Address","name":"emailAddress","description":"New email address for the subscriber."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"New first name for the subscriber."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"fields","description":"Custom field values to set, keyed by the field's label exactly as it appears in Kit (e.g. {\"Company\":\"Acme\"}). Only the listed fields are changed."}
   * @returns {Object}
   * @sampleResult {"subscriber":{"id":987654,"first_name":"Alice","email_address":"alice.new@example.com","state":"active","created_at":"2026-01-15T09:30:00Z","fields":{"Company":"Acme"}}}
   */
  async updateSubscriber(subscriberId, emailAddress, firstName, fields) {
    // docs: https://developers.kit.com/api-reference/subscribers/update-a-subscriber
    return await this.#apiRequest({
      url: `${ API_BASE }/subscribers/${ subscriberId }`,
      method: 'put',
      body: this.#clean({
        email_address: emailAddress,
        first_name: firstName,
        fields,
      }),
      logTag: 'updateSubscriber',
    })
  }

  /**
   * @operationName Unsubscribe Subscriber
   * @category Subscribers
   * @description Unsubscribes a Kit subscriber so they no longer receive any emails from the account. This sets their state to cancelled; it does not delete the subscriber record.
   * @route POST /unsubscribe-subscriber
   * @paramDef {"type":"String","label":"Subscriber ID","name":"subscriberId","required":true,"description":"The numeric ID of the subscriber to unsubscribe."}
   * @returns {Object}
   * @sampleResult {"unsubscribed":true,"subscriberId":"987654"}
   */
  async unsubscribeSubscriber(subscriberId) {
    // docs: https://developers.kit.com/api-reference/subscribers/unsubscribe-subscriber
    await this.#apiRequest({
      url: `${ API_BASE }/subscribers/${ subscriberId }/unsubscribe`,
      method: 'post',
      logTag: 'unsubscribeSubscriber',
    })

    return { unsubscribed: true, subscriberId }
  }

  // ==========================================================================
  //  TAGS
  // ==========================================================================
  /**
   * @operationName Create Tag
   * @category Tags
   * @description Creates a new tag in the Kit account. Tags are the primary way to segment subscribers for automations and broadcast filters.
   * @route POST /create-tag
   * @paramDef {"type":"String","label":"Tag Name","name":"name","required":true,"description":"Name for the new tag. Must be unique within the account."}
   * @returns {Object}
   * @sampleResult {"tag":{"id":54321,"name":"Newsletter","created_at":"2026-01-15T09:30:00Z"}}
   */
  async createTag(name) {
    // docs: https://developers.kit.com/api-reference/tags/create-a-tag
    return await this.#apiRequest({
      url: `${ API_BASE }/tags`,
      method: 'post',
      body: { name },
      logTag: 'createTag',
    })
  }

  /**
   * @operationName List Tags
   * @category Tags
   * @description Lists the tags in the Kit account. Results are cursor-paginated — pass the returned pagination.end_cursor as After Cursor to fetch the next page.
   * @route GET /list-tags
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page (1-500, default 500)."}
   * @paramDef {"type":"String","label":"After Cursor","name":"afterCursor","description":"Pagination cursor — pass the previous response's pagination.end_cursor to get the next page."}
   * @returns {Object}
   * @sampleResult {"tags":[{"id":54321,"name":"Newsletter","created_at":"2026-01-15T09:30:00Z"}],"pagination":{"has_previous_page":false,"has_next_page":false,"start_cursor":null,"end_cursor":null,"per_page":500}}
   */
  async listTags(perPage, afterCursor) {
    // docs: https://developers.kit.com/api-reference/tags/list-tags
    return await this.#apiRequest({
      url: `${ API_BASE }/tags`,
      query: this.#pagination(afterCursor, undefined, perPage),
      logTag: 'listTags',
    })
  }

  /**
   * @operationName Tag Subscriber
   * @category Tags
   * @description Adds a tag to an existing subscriber identified by their subscriber ID. Use Tag Subscriber By Email when you only have the email address.
   * @route POST /tag-subscriber
   * @paramDef {"type":"String","label":"Tag","name":"tagId","required":true,"dictionary":"getTagsDictionary","description":"The tag to add. Pick from the list or paste a tag ID."}
   * @paramDef {"type":"String","label":"Subscriber ID","name":"subscriberId","required":true,"description":"The numeric ID of the subscriber to tag."}
   * @returns {Object}
   * @sampleResult {"subscriber":{"id":987654,"first_name":"Alice","email_address":"alice@example.com","state":"active","tagged_at":"2026-01-15T09:30:00Z"}}
   */
  async tagSubscriber(tagId, subscriberId) {
    // docs: https://developers.kit.com/api-reference/tags/tag-a-subscriber
    return await this.#apiRequest({
      url: `${ API_BASE }/tags/${ tagId }/subscribers/${ subscriberId }`,
      method: 'post',
      logTag: 'tagSubscriber',
    })
  }

  /**
   * @operationName Tag Subscriber By Email
   * @category Tags
   * @description Adds a tag to a subscriber identified by email address. The subscriber must already exist in the Kit account — use Create Subscriber first for new contacts.
   * @route POST /tag-subscriber-by-email
   * @paramDef {"type":"String","label":"Tag","name":"tagId","required":true,"dictionary":"getTagsDictionary","description":"The tag to add. Pick from the list or paste a tag ID."}
   * @paramDef {"type":"String","label":"Email Address","name":"emailAddress","required":true,"description":"Email address of the existing subscriber to tag."}
   * @returns {Object}
   * @sampleResult {"subscriber":{"id":987654,"first_name":"Alice","email_address":"alice@example.com","state":"active","tagged_at":"2026-01-15T09:30:00Z"}}
   */
  async tagSubscriberByEmail(tagId, emailAddress) {
    // docs: https://developers.kit.com/api-reference/tags/tag-a-subscriber
    return await this.#apiRequest({
      url: `${ API_BASE }/tags/${ tagId }/subscribers`,
      method: 'post',
      body: { email_address: emailAddress },
      logTag: 'tagSubscriberByEmail',
    })
  }

  /**
   * @operationName Remove Tag From Subscriber
   * @category Tags
   * @description Removes a tag from a subscriber. The subscriber stays in the account — only the tag association is deleted.
   * @route DELETE /remove-tag-from-subscriber
   * @paramDef {"type":"String","label":"Tag","name":"tagId","required":true,"dictionary":"getTagsDictionary","description":"The tag to remove. Pick from the list or paste a tag ID."}
   * @paramDef {"type":"String","label":"Subscriber ID","name":"subscriberId","required":true,"description":"The numeric ID of the subscriber to remove the tag from."}
   * @returns {Object}
   * @sampleResult {"removed":true,"tagId":"54321","subscriberId":"987654"}
   */
  async removeTagFromSubscriber(tagId, subscriberId) {
    // docs: https://developers.kit.com/api-reference/tags/remove-tag-from-subscriber
    await this.#apiRequest({
      url: `${ API_BASE }/tags/${ tagId }/subscribers/${ subscriberId }`,
      method: 'delete',
      logTag: 'removeTagFromSubscriber',
    })

    return { removed: true, tagId, subscriberId }
  }

  /**
   * @operationName List Subscribers For Tag
   * @category Tags
   * @description Lists the subscribers that have a given tag, with optional status and creation date filters. Results are cursor-paginated.
   * @route GET /list-subscribers-for-tag
   * @paramDef {"type":"String","label":"Tag","name":"tagId","required":true,"dictionary":"getTagsDictionary","description":"The tag whose subscribers to list."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Inactive","Bounced","Complained","Cancelled","All"]}},"description":"Filter by subscriber status. Defaults to Active when left blank."}
   * @paramDef {"type":"String","label":"Created After","name":"createdAfter","uiComponent":{"type":"DATE_PICKER"},"description":"Only subscribers created after this date (ISO 8601)."}
   * @paramDef {"type":"String","label":"Created Before","name":"createdBefore","uiComponent":{"type":"DATE_PICKER"},"description":"Only subscribers created before this date (ISO 8601)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page (1-500, default 500)."}
   * @paramDef {"type":"String","label":"After Cursor","name":"afterCursor","description":"Pagination cursor — pass the previous response's pagination.end_cursor to get the next page."}
   * @returns {Object}
   * @sampleResult {"subscribers":[{"id":987654,"first_name":"Alice","email_address":"alice@example.com","state":"active","tagged_at":"2026-01-15T09:30:00Z"}],"pagination":{"has_previous_page":false,"has_next_page":false,"start_cursor":null,"end_cursor":null,"per_page":500}}
   */
  async listSubscribersForTag(tagId, status, createdAfter, createdBefore, perPage, afterCursor) {
    // docs: https://developers.kit.com/api-reference/tags — list subscribers for a tag
    return await this.#apiRequest({
      url: `${ API_BASE }/tags/${ tagId }/subscribers`,
      query: {
        ...this.#clean({
          status: this.#resolveChoice(status, {
            Active: 'active',
            Inactive: 'inactive',
            Bounced: 'bounced',
            Complained: 'complained',
            Cancelled: 'cancelled',
            All: 'all',
          }),
          created_after: createdAfter,
          created_before: createdBefore,
        }),
        ...this.#pagination(afterCursor, undefined, perPage),
      },
      logTag: 'listSubscribersForTag',
    })
  }

  // ==========================================================================
  //  FORMS
  // ==========================================================================
  /**
   * @operationName List Forms
   * @category Forms
   * @description Lists the forms and landing pages in the Kit account with their names, types, and embed details. Results are cursor-paginated.
   * @route GET /list-forms
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page (1-500, default 500)."}
   * @paramDef {"type":"String","label":"After Cursor","name":"afterCursor","description":"Pagination cursor — pass the previous response's pagination.end_cursor to get the next page."}
   * @returns {Object}
   * @sampleResult {"forms":[{"id":23456,"name":"Homepage Signup","type":"embed","format":"inline","embed_url":"https://acme.kit.com/homepage-signup","created_at":"2026-01-10T12:00:00Z"}],"pagination":{"has_previous_page":false,"has_next_page":false,"start_cursor":null,"end_cursor":null,"per_page":500}}
   */
  async listForms(perPage, afterCursor) {
    // docs: https://developers.kit.com/api-reference/forms/list-forms
    return await this.#apiRequest({
      url: `${ API_BASE }/forms`,
      query: this.#pagination(afterCursor, undefined, perPage),
      logTag: 'listForms',
    })
  }

  /**
   * @operationName Add Subscriber To Form
   * @category Forms
   * @description Adds an existing subscriber to a Kit form, which triggers the form's incentive email and automations. Identify the subscriber by ID or by email address (one is required; ID wins when both are given).
   * @route POST /add-subscriber-to-form
   * @paramDef {"type":"String","label":"Form","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The form to add the subscriber to."}
   * @paramDef {"type":"String","label":"Subscriber ID","name":"subscriberId","description":"The numeric ID of an existing subscriber. Provide this or an email address."}
   * @paramDef {"type":"String","label":"Email Address","name":"emailAddress","description":"Email address of an existing subscriber. Used when Subscriber ID is blank."}
   * @returns {Object}
   * @sampleResult {"subscriber":{"id":987654,"first_name":"Alice","email_address":"alice@example.com","state":"active","added_at":"2026-01-15T09:30:00Z"}}
   */
  async addSubscriberToForm(formId, subscriberId, emailAddress) {
    // docs: https://developers.kit.com/api-reference/forms/add-subscriber-to-form
    if (subscriberId) {
      return await this.#apiRequest({
        url: `${ API_BASE }/forms/${ formId }/subscribers/${ subscriberId }`,
        method: 'post',
        logTag: 'addSubscriberToForm',
      })
    }

    if (!emailAddress) {
      throw new Error('Provide a Subscriber ID or an Email Address to add to the form.')
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/forms/${ formId }/subscribers`,
      method: 'post',
      body: { email_address: emailAddress },
      logTag: 'addSubscriberToForm',
    })
  }

  // ==========================================================================
  //  SEQUENCES
  // ==========================================================================
  /**
   * @operationName List Sequences
   * @category Sequences
   * @description Lists the email sequences (courses) in the Kit account. Results are cursor-paginated.
   * @route GET /list-sequences
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page (1-500, default 500)."}
   * @paramDef {"type":"String","label":"After Cursor","name":"afterCursor","description":"Pagination cursor — pass the previous response's pagination.end_cursor to get the next page."}
   * @returns {Object}
   * @sampleResult {"sequences":[{"id":34567,"name":"Welcome Series","hold":false,"repeat":false,"created_at":"2026-01-10T12:00:00Z"}],"pagination":{"has_previous_page":false,"has_next_page":false,"start_cursor":null,"end_cursor":null,"per_page":500}}
   */
  async listSequences(perPage, afterCursor) {
    // docs: https://developers.kit.com/api-reference/sequences/list-sequences
    return await this.#apiRequest({
      url: `${ API_BASE }/sequences`,
      query: this.#pagination(afterCursor, undefined, perPage),
      logTag: 'listSequences',
    })
  }

  /**
   * @operationName Add Subscriber To Sequence
   * @category Sequences
   * @description Enrolls an existing subscriber in a Kit email sequence so they start receiving its emails. Identify the subscriber by ID or by email address (one is required; ID wins when both are given).
   * @route POST /add-subscriber-to-sequence
   * @paramDef {"type":"String","label":"Sequence","name":"sequenceId","required":true,"dictionary":"getSequencesDictionary","description":"The sequence to enroll the subscriber in."}
   * @paramDef {"type":"String","label":"Subscriber ID","name":"subscriberId","description":"The numeric ID of an existing subscriber. Provide this or an email address."}
   * @paramDef {"type":"String","label":"Email Address","name":"emailAddress","description":"Email address of an existing subscriber. Used when Subscriber ID is blank."}
   * @returns {Object}
   * @sampleResult {"subscriber":{"id":987654,"first_name":"Alice","email_address":"alice@example.com","state":"active","added_at":"2026-01-15T09:30:00Z"}}
   */
  async addSubscriberToSequence(sequenceId, subscriberId, emailAddress) {
    // docs: https://developers.kit.com/api-reference/sequences/add-subscriber-to-sequence
    if (subscriberId) {
      return await this.#apiRequest({
        url: `${ API_BASE }/sequences/${ sequenceId }/subscribers/${ subscriberId }`,
        method: 'post',
        logTag: 'addSubscriberToSequence',
      })
    }

    if (!emailAddress) {
      throw new Error('Provide a Subscriber ID or an Email Address to add to the sequence.')
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/sequences/${ sequenceId }/subscribers`,
      method: 'post',
      body: { email_address: emailAddress },
      logTag: 'addSubscriberToSequence',
    })
  }

  // ==========================================================================
  //  CUSTOM FIELDS
  // ==========================================================================
  /**
   * @operationName List Custom Fields
   * @category Custom Fields
   * @description Lists the custom fields defined in the Kit account, including each field's label and the key used when setting values on subscribers. Results are cursor-paginated.
   * @route GET /list-custom-fields
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page (1-500, default 500)."}
   * @paramDef {"type":"String","label":"After Cursor","name":"afterCursor","description":"Pagination cursor — pass the previous response's pagination.end_cursor to get the next page."}
   * @returns {Object}
   * @sampleResult {"custom_fields":[{"id":45678,"name":"ck_field_45678_company","key":"company","label":"Company"}],"pagination":{"has_previous_page":false,"has_next_page":false,"start_cursor":null,"end_cursor":null,"per_page":500}}
   */
  async listCustomFields(perPage, afterCursor) {
    // docs: https://developers.kit.com/api-reference/custom-fields/list-custom-fields
    return await this.#apiRequest({
      url: `${ API_BASE }/custom_fields`,
      query: this.#pagination(afterCursor, undefined, perPage),
      logTag: 'listCustomFields',
    })
  }

  /**
   * @operationName Create Custom Field
   * @category Custom Fields
   * @description Creates a new custom field in the Kit account. Once created, set its value on subscribers via Create Subscriber or Update Subscriber using the field's label as the key.
   * @route POST /create-custom-field
   * @paramDef {"type":"String","label":"Field Label","name":"label","required":true,"description":"Label for the new custom field (e.g. Company). Kit derives the field key from this label."}
   * @returns {Object}
   * @sampleResult {"custom_field":{"id":45678,"name":"ck_field_45678_company","key":"company","label":"Company"}}
   */
  async createCustomField(label) {
    // docs: https://developers.kit.com/api-reference/custom-fields/create-a-custom-field
    return await this.#apiRequest({
      url: `${ API_BASE }/custom_fields`,
      method: 'post',
      body: { label },
      logTag: 'createCustomField',
    })
  }

  // ==========================================================================
  //  BROADCASTS
  // ==========================================================================
  /**
   * @operationName List Broadcasts
   * @category Broadcasts
   * @description Lists the broadcasts (one-time emails) in the Kit account with their subjects and send times. Results are cursor-paginated.
   * @route GET /list-broadcasts
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page (1-500, default 500)."}
   * @paramDef {"type":"String","label":"After Cursor","name":"afterCursor","description":"Pagination cursor — pass the previous response's pagination.end_cursor to get the next page."}
   * @returns {Object}
   * @sampleResult {"broadcasts":[{"id":67890,"subject":"January Newsletter","created_at":"2026-01-15T09:30:00Z","send_at":"2026-01-20T15:00:00Z","public":false}],"pagination":{"has_previous_page":false,"has_next_page":false,"start_cursor":null,"end_cursor":null,"per_page":500}}
   */
  async listBroadcasts(perPage, afterCursor) {
    // docs: https://developers.kit.com/api-reference/broadcasts/list-broadcasts
    return await this.#apiRequest({
      url: `${ API_BASE }/broadcasts`,
      query: this.#pagination(afterCursor, undefined, perPage),
      logTag: 'listBroadcasts',
    })
  }

  /**
   * @operationName Create Broadcast
   * @category Broadcasts
   * @description Creates a broadcast email in Kit. Leave Send At blank to save it as a draft you can review and send from the Kit UI; set Send At to schedule delivery to all active subscribers at that time. Content supports HTML.
   * @route POST /create-broadcast
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"The email subject line."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The email body. HTML is supported."}
   * @paramDef {"type":"String","label":"Preview Text","name":"previewText","description":"Preview text shown next to the subject in most inboxes."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Internal description of the broadcast (not shown to recipients)."}
   * @paramDef {"type":"String","label":"Email Template ID","name":"emailTemplateId","description":"Numeric ID of the Kit email template to render the broadcast with. Leave blank to use the account default."}
   * @paramDef {"type":"String","label":"Send At","name":"sendAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"When to send the broadcast (ISO 8601). Leave blank to save it as a draft instead of scheduling."}
   * @paramDef {"type":"Boolean","label":"Public","name":"isPublic","uiComponent":{"type":"TOGGLE"},"defaultValue":false,"description":"Publish the broadcast to the account's public feed and archive page."}
   * @returns {Object}
   * @sampleResult {"broadcast":{"id":67890,"subject":"January Newsletter","preview_text":"Fresh updates inside","description":null,"content":"<p>Hello!</p>","public":false,"send_at":null,"created_at":"2026-01-15T09:30:00Z"}}
   */
  async createBroadcast(subject, content, previewText, description, emailTemplateId, sendAt, isPublic) {
    // docs: https://developers.kit.com/api-reference/broadcasts/create-a-broadcast
    const body = this.#clean({
      subject,
      content,
      preview_text: previewText,
      description,
      email_template_id: emailTemplateId ? Number(emailTemplateId) : undefined,
      send_at: sendAt,
    })

    if (isPublic !== undefined && isPublic !== null) {
      body.public = Boolean(isPublic)
    }

    return await this.#apiRequest({
      url: `${ API_BASE }/broadcasts`,
      method: 'post',
      body,
      logTag: 'createBroadcast',
    })
  }

  /**
   * @operationName Get Broadcast
   * @category Broadcasts
   * @description Retrieves a single broadcast by ID, including its subject, content, send time, and publication settings.
   * @route GET /get-broadcast
   * @paramDef {"type":"String","label":"Broadcast ID","name":"broadcastId","required":true,"description":"The numeric ID of the broadcast to fetch. Find it via List Broadcasts."}
   * @returns {Object}
   * @sampleResult {"broadcast":{"id":67890,"subject":"January Newsletter","preview_text":"Fresh updates inside","content":"<p>Hello!</p>","public":false,"send_at":"2026-01-20T15:00:00Z","created_at":"2026-01-15T09:30:00Z"}}
   */
  async getBroadcast(broadcastId) {
    // docs: https://developers.kit.com/api-reference/broadcasts — get a broadcast
    return await this.#apiRequest({
      url: `${ API_BASE }/broadcasts/${ broadcastId }`,
      logTag: 'getBroadcast',
    })
  }

  /**
   * @operationName Get Broadcast Stats
   * @category Broadcasts
   * @description Retrieves delivery and engagement statistics for a sent broadcast — recipients, open rate, click rate, unsubscribes, and click counts.
   * @route GET /get-broadcast-stats
   * @paramDef {"type":"String","label":"Broadcast ID","name":"broadcastId","required":true,"description":"The numeric ID of the broadcast to fetch statistics for."}
   * @returns {Object}
   * @sampleResult {"broadcast":{"id":67890,"stats":{"recipients":1500,"open_rate":52.3,"click_rate":12.1,"unsubscribes":3,"total_clicks":320,"show_total_clicks":false,"status":"completed","progress":100.0}}}
   */
  async getBroadcastStats(broadcastId) {
    // docs: https://developers.kit.com/api-reference/broadcasts — get stats
    return await this.#apiRequest({
      url: `${ API_BASE }/broadcasts/${ broadcastId }/stats`,
      logTag: 'getBroadcastStats',
    })
  }

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================
  /**
   * @registerAs DICTIONARY
   * @operationName Get Tags Dictionary
   * @description Lists the account's tags for selection in dependent parameters, with optional name filtering and cursor pagination.
   * @route POST /get-tags-dictionary
   * @paramDef {"type":"getTagsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Newsletter","value":"54321","note":"Tag"}],"cursor":"WzU0MzIxXQ"}
   */
  async getTagsDictionary(payload) {
    const { search, cursor } = payload || {}
    const response = await this.listTags(500, cursor)

    return this.#toDictionary(response.tags, search, response.pagination, 'Tag')
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Forms Dictionary
   * @description Lists the account's forms and landing pages for selection in dependent parameters, with optional name filtering and cursor pagination.
   * @route POST /get-forms-dictionary
   * @paramDef {"type":"getFormsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Homepage Signup","value":"23456","note":"embed"}],"cursor":null}
   */
  async getFormsDictionary(payload) {
    const { search, cursor } = payload || {}
    const response = await this.listForms(500, cursor)
    const items = (response.forms || [])
      .filter(form => !search || String(form.name || '').toLowerCase().includes(String(search).toLowerCase()))
      .map(form => ({ label: form.name, value: String(form.id), note: form.type || 'Form' }))

    return { items, cursor: response.pagination?.has_next_page ? response.pagination.end_cursor : null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Sequences Dictionary
   * @description Lists the account's email sequences for selection in dependent parameters, with optional name filtering and cursor pagination.
   * @route POST /get-sequences-dictionary
   * @paramDef {"type":"getSequencesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Welcome Series","value":"34567","note":"Sequence"}],"cursor":null}
   */
  async getSequencesDictionary(payload) {
    const { search, cursor } = payload || {}
    const response = await this.listSequences(500, cursor)

    return this.#toDictionary(response.sequences, search, response.pagination, 'Sequence')
  }

  // Shared name-filtered dictionary shaping for Kit list responses.
  #toDictionary(records, search, pagination, note) {
    const items = (records || [])
      .filter(record => !search || String(record.name || '').toLowerCase().includes(String(search).toLowerCase()))
      .map(record => ({ label: record.name, value: String(record.id), note }))

    return { items, cursor: pagination?.has_next_page ? pagination.end_cursor : null }
  }

  // ==========================================================================
  //  REALTIME TRIGGER (SINGLE_APP — one Kit webhook per registered trigger)
  // ==========================================================================
  /**
   * @operationName On Kit Event
   * @category Triggers
   * @description Fires when the chosen event happens in Kit — a subscriber activates, unsubscribes, bounces, or complains; a tag is added or removed; a form is subscribed; a sequence is subscribed or completed; a link is clicked; or a purchase is created. Kit registers a webhook for the event and this trigger runs your flow when it arrives. Tag, Form, Sequence, and Link URL are only required for their matching events.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-kit-event
   * @paramDef {"type":"String","label":"Event","name":"event","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Subscriber Activated","Subscriber Unsubscribed","Subscriber Bounced","Subscriber Complained","Tag Added","Tag Removed","Form Subscribed","Sequence Subscribed","Sequence Completed","Link Clicked","Purchase Created"]}},"description":"Which Kit event fires this trigger."}
   * @paramDef {"type":"String","label":"Tag","name":"tagId","dictionary":"getTagsDictionary","description":"Required for Tag Added / Tag Removed — the tag to watch. Ignored for other events."}
   * @paramDef {"type":"String","label":"Form","name":"formId","dictionary":"getFormsDictionary","description":"Required for Form Subscribed — the form to watch. Ignored for other events."}
   * @paramDef {"type":"String","label":"Sequence","name":"sequenceId","dictionary":"getSequencesDictionary","description":"Required for Sequence Subscribed / Sequence Completed — the sequence to watch. Ignored for other events."}
   * @paramDef {"type":"String","label":"Link URL","name":"linkUrl","description":"Required for Link Clicked — the exact URL inside your emails whose clicks fire this trigger. Ignored for other events."}
   * @returns {Object}
   * @sampleResult {"event":"subscriber.tag_add","subscriberId":987654,"emailAddress":"alice@example.com","firstName":"Alice","state":"active","subscriber":{"id":987654,"first_name":"Alice","email_address":"alice@example.com","state":"active","created_at":"2026-01-15T09:30:00Z","fields":{"Company":"Acme"}},"payload":{"subscriber":{"id":987654,"email_address":"alice@example.com"}}}
   */
  onKitEvent(callType, payload) {
    if (callType === CALL_TYPES.SHAPE_EVENT) {
      return [{ name: 'onKitEvent', data: this.#shapeKitEvent(payload) }]
    }

    if (callType === CALL_TYPES.FILTER_TRIGGER) {
      const eventData = payload.eventData || payload.data || {}

      const ids = (payload.triggers || [])
        .filter(trigger => {
          // Primary match: the webhook callback URL carries the trigger id it was created for.
          if (eventData.triggerId) {
            return String(trigger.id) === String(eventData.triggerId)
          }

          // Fallback: match on the subscribed event name.
          return TRIGGER_EVENT_LABEL_TO_NAME[trigger.data?.event] === eventData.event
        })
        .map(trigger => trigger.id)

      return { ids }
    }
  }

  // Kit webhook deliveries do not echo the event name, so it is recovered from
  // the callback URL query params stamped at webhook-creation time.
  #shapeKitEvent(invocation) {
    const queryParams = invocation.queryParams || {}
    const body = invocation.body || {}
    const subscriber = body.subscriber || null

    return {
      event: queryParams.kitEvent || null,
      triggerId: queryParams.triggerId || null,
      subscriberId: subscriber?.id ?? null,
      emailAddress: subscriber?.email_address ?? null,
      firstName: subscriber?.first_name ?? null,
      state: subscriber?.state ?? null,
      subscriber,
      payload: body,
    }
  }

  // ── SYSTEM trigger handlers (SINGLE_APP) ───────────────────────────────
  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerUpsertWebhook
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    logger.debug(`handleTriggerUpsertWebhook.invocation: ${ JSON.stringify(invocation) }`)

    const webhooks = []

    for (const event of invocation.events || []) {
      const data = event.triggerData || {}
      const eventName = TRIGGER_EVENT_LABEL_TO_NAME[data.event] || data.event

      if (!eventName) {
        throw new Error('The trigger is missing an Event selection.')
      }

      const eventBody = { name: eventName }
      const extra = TRIGGER_EVENT_EXTRA_PARAM[eventName]

      if (extra) {
        const rawValue = data[extra.triggerParam]

        if (rawValue === undefined || rawValue === null || rawValue === '') {
          throw new Error(`The "${ data.event }" event requires the ${ extra.label } parameter.`)
        }

        eventBody[extra.bodyKey] = extra.bodyKey === 'initiator_value' ? String(rawValue) : Number(rawValue)
      }

      // Kit deliveries do not include the event name, so stamp it (plus the
      // trigger id and connection id) onto the callback URL for resolution.
      const separator = invocation.callbackUrl.includes('?') ? '&' : '?'
      const targetUrl = `${ invocation.callbackUrl }${ separator }connectionId=${ invocation.connectionId }` +
        `&triggerId=${ encodeURIComponent(event.id) }&kitEvent=${ encodeURIComponent(eventName) }`

      const created = await this.#apiRequest({
        url: `${ API_BASE }/webhooks`,
        method: 'post',
        body: { target_url: targetUrl, event: eventBody },
        logTag: 'createWebhook',
      })

      webhooks.push({ triggerId: event.id, webhookId: created?.webhook?.id, event: eventName })
    }

    return { webhookData: { webhooks }, connectionId: invocation.connectionId }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerResolveEvents
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    logger.debug('handleTriggerResolveEvents invoked')

    // Kit performs no subscription handshake, but guard the empty-body case defensively.
    if (!invocation || !invocation.body || !Object.keys(invocation.body).length) {
      return { handshake: true, responseToExternalService: invocation?.body || {} }
    }

    return {
      connectionId: invocation.queryParams?.connectionId,
      events: this.onKitEvent(CALL_TYPES.SHAPE_EVENT, invocation),
    }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerSelectMatched
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    logger.debug(`handleTriggerSelectMatched.${ invocation.eventName }`)

    return this.onKitEvent(CALL_TYPES.FILTER_TRIGGER, invocation)
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerDeleteWebhook
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerDeleteWebhook(invocation) {
    logger.debug('handleTriggerDeleteWebhook invoked')

    const webhooks = invocation.webhookData?.webhooks || []

    for (const webhook of webhooks) {
      if (!webhook.webhookId) {
        continue
      }

      try {
        await this.#apiRequest({
          url: `${ API_BASE }/webhooks/${ webhook.webhookId }`,
          method: 'delete',
          logTag: 'deleteWebhook',
        })
      } catch (error) {
        logger.warn(`handleTriggerDeleteWebhook: failed to delete webhook ${ webhook.webhookId }: ${ error?.message }`)
      }
    }

    return { webhookData: {} }
  }
}

Flowrunner.ServerCode.addService(Kit, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Kit v4 API key. Get it in Kit under Settings → Developer → API Keys (v4).',
  },
])
