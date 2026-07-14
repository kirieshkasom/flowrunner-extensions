// ============================================================================
//  MailerLite — FlowRunner extension service
//  API: https://connect.mailerlite.com/api (the "new" MailerLite API, Bearer auth)
//  Docs: https://developers.mailerlite.com/docs
// ============================================================================

const API_BASE_URL = 'https://connect.mailerlite.com/api'

const logger = {
  info: (...args) => console.log('[MailerLite] info:', ...args),
  debug: (...args) => console.log('[MailerLite] debug:', ...args),
  error: (...args) => console.log('[MailerLite] error:', ...args),
  warn: (...args) => console.log('[MailerLite] warn:', ...args),
}

const DICTIONARY_PAGE_SIZE = 50

const CALL_TYPES = {
  SHAPE_EVENT: 'SHAPE_EVENT',
  FILTER_TRIGGER: 'FILTER_TRIGGER',
}

// Friendly dropdown labels → MailerLite API values.
const SUBSCRIBER_STATUSES = {
  'Active': 'active',
  'Unsubscribed': 'unsubscribed',
  'Unconfirmed': 'unconfirmed',
}

const SUBSCRIBER_FILTER_STATUSES = {
  'Active': 'active',
  'Unsubscribed': 'unsubscribed',
  'Unconfirmed': 'unconfirmed',
  'Bounced': 'bounced',
  'Junk': 'junk',
}

const CAMPAIGN_FILTER_STATUSES = {
  'Sent': 'sent',
  'Draft': 'draft',
  'Ready': 'ready',
}

const CAMPAIGN_DELIVERY_TYPES = {
  'Instant': 'instant',
  'Scheduled': 'scheduled',
}

// Friendly trigger Event labels → MailerLite webhook event names
// (verified against https://developers.mailerlite.com/docs/webhooks.html).
const SUBSCRIBER_EVENT_LABEL_TO_VALUE = {
  'Subscriber Created': 'subscriber.created',
  'Subscriber Updated': 'subscriber.updated',
  'Subscriber Unsubscribed': 'subscriber.unsubscribed',
  'Subscriber Added To Group': 'subscriber.added_to_group',
  'Subscriber Spam Reported': 'subscriber.spam_reported',
  'Subscriber Bounced': 'subscriber.bounced',
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

// ============================================================================
//  DICTIONARY PAYLOAD TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} getGroupsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter groups by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number for the next page of results."}
 */

/**
 * @typedef {Object} getCampaignsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter draft campaigns by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number for the next page of results."}
 */

/**
 * @integrationName MailerLite
 * @integrationIcon /icon.svg
 * @integrationTriggersScope SINGLE_APP
 */
class MailerLite {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  // ==========================================================================
  //  CORE — every external call goes through #apiRequest
  // ==========================================================================
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery || {}) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.apiKey }`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.message || error.message
      const details = error.body?.errors ? ` Details: ${ JSON.stringify(error.body.errors) }` : ''

      logger.error(`${ logTag } - failed: ${ message }${ details }`)

      throw new Error(`MailerLite API error: ${ message }${ details }`)
    }
  }

  // Maps a friendly dropdown label to its API value; passes unknown values through unchanged.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // ==========================================================================
  //  SUBSCRIBERS
  // ==========================================================================
  /**
   * @operationName Upsert Subscriber
   * @category Subscribers
   * @description Creates a new subscriber or updates the existing one with the same email address (MailerLite upserts on email). Optionally sets profile fields (name, last_name, and any custom fields by key), assigns the subscriber to groups, and sets the subscription status.
   * @route POST /upsert-subscriber
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Email address of the subscriber. If a subscriber with this email already exists, it is updated instead of created."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","description":"Profile fields as key-value pairs, e.g. {\"name\":\"John\",\"last_name\":\"Doe\",\"company\":\"Acme\"}. Keys must match field keys from List Fields; unknown keys are rejected by MailerLite."}
   * @paramDef {"type":"Array<String>","label":"Groups","name":"groups","description":"IDs of groups to assign the subscriber to. Use List Groups to find group IDs."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Unsubscribed","Unconfirmed"]}},"description":"Subscription status to set. Leave empty to keep the MailerLite default (Active, or Unconfirmed when double opt-in is enabled)."}
   * @returns {Object}
   * @sampleResult {"id":"31897397363737859","email":"john@example.com","status":"active","source":"api","sent":0,"opens_count":0,"clicks_count":0,"open_rate":0,"click_rate":0,"subscribed_at":"2026-01-15 09:30:00","created_at":"2026-01-15 09:30:00","updated_at":"2026-01-15 09:30:00","fields":{"name":"John","last_name":"Doe"},"groups":[]}
   */
  async upsertSubscriber(email, fields, groups, status) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/subscribers`,
      method: 'post',
      body: clean({
        email,
        fields,
        groups,
        status: this.#resolveChoice(status, SUBSCRIBER_STATUSES),
      }),
      logTag: 'upsertSubscriber',
    })

    return response.data
  }

  /**
   * @operationName Get Subscriber
   * @category Subscribers
   * @description Fetches a single subscriber by ID or email address. Returns the full subscriber profile including status, engagement counters (sent, opens, clicks), profile fields, and group memberships.
   * @route GET /get-subscriber
   * @paramDef {"type":"String","label":"Subscriber ID or Email","name":"subscriberIdOrEmail","required":true,"description":"The subscriber's MailerLite ID or email address."}
   * @returns {Object}
   * @sampleResult {"id":"31897397363737859","email":"john@example.com","status":"active","source":"api","sent":10,"opens_count":6,"clicks_count":2,"open_rate":0.6,"click_rate":0.2,"subscribed_at":"2026-01-15 09:30:00","created_at":"2026-01-15 09:30:00","updated_at":"2026-02-01 12:00:00","fields":{"name":"John","last_name":"Doe"},"groups":[{"id":"1","name":"Newsletter"}]}
   */
  async getSubscriber(subscriberIdOrEmail) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/subscribers/${ encodeURIComponent(subscriberIdOrEmail) }`,
      method: 'get',
      logTag: 'getSubscriber',
    })

    return response.data
  }

  /**
   * @operationName List Subscribers
   * @category Subscribers
   * @description Lists subscribers in the account with optional status filtering and cursor-based pagination. Returns the subscribers of the requested page plus cursors for fetching the next and previous pages.
   * @route GET /list-subscribers
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Unsubscribed","Unconfirmed","Bounced","Junk"]}},"description":"Only return subscribers with this status. Leave empty for all subscribers."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of subscribers per page (default 25)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call's nextCursor or prevCursor."}
   * @returns {Object}
   * @sampleResult {"subscribers":[{"id":"31897397363737859","email":"john@example.com","status":"active","fields":{"name":"John","last_name":"Doe"},"subscribed_at":"2026-01-15 09:30:00"}],"nextCursor":"eyJpZCI6MzE4OTczOTd9","prevCursor":null}
   */
  async listSubscribers(status, limit, cursor) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/subscribers`,
      method: 'get',
      query: {
        'filter[status]': this.#resolveChoice(status, SUBSCRIBER_FILTER_STATUSES),
        limit,
        cursor,
      },
      logTag: 'listSubscribers',
    })

    return {
      subscribers: response.data || [],
      nextCursor: response.meta?.next_cursor || null,
      prevCursor: response.meta?.prev_cursor || null,
    }
  }

  /**
   * @operationName Update Subscriber
   * @category Subscribers
   * @description Updates an existing subscriber by ID. Can change profile fields (name, last_name, custom fields), replace group assignments, and change the subscription status. Only the provided properties are changed.
   * @route PUT /update-subscriber
   * @paramDef {"type":"String","label":"Subscriber ID","name":"subscriberId","required":true,"description":"The MailerLite ID of the subscriber to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","description":"Profile fields to set, e.g. {\"name\":\"John\",\"last_name\":\"Doe\"}. Keys must match field keys from List Fields."}
   * @paramDef {"type":"Array<String>","label":"Groups","name":"groups","description":"IDs of groups to assign the subscriber to. This replaces the subscriber's current group assignments."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Unsubscribed","Unconfirmed"]}},"description":"New subscription status. Leave empty to keep the current status."}
   * @returns {Object}
   * @sampleResult {"id":"31897397363737859","email":"john@example.com","status":"active","fields":{"name":"John","last_name":"Doe"},"groups":[{"id":"1","name":"Newsletter"}],"updated_at":"2026-02-01 12:00:00"}
   */
  async updateSubscriber(subscriberId, fields, groups, status) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/subscribers/${ encodeURIComponent(subscriberId) }`,
      method: 'put',
      body: clean({
        fields,
        groups,
        status: this.#resolveChoice(status, SUBSCRIBER_STATUSES),
      }),
      logTag: 'updateSubscriber',
    })

    return response.data
  }

  /**
   * @operationName Delete Subscriber
   * @category Subscribers
   * @description Deletes a subscriber from the account by ID. The subscriber is removed from all groups and no longer receives campaigns. Use Forget Subscriber instead if you need GDPR-compliant erasure.
   * @route DELETE /delete-subscriber
   * @paramDef {"type":"String","label":"Subscriber ID","name":"subscriberId","required":true,"description":"The MailerLite ID of the subscriber to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"subscriberId":"31897397363737859"}
   */
  async deleteSubscriber(subscriberId) {
    await this.#apiRequest({
      url: `${ API_BASE_URL }/subscribers/${ encodeURIComponent(subscriberId) }`,
      method: 'delete',
      logTag: 'deleteSubscriber',
    })

    return { deleted: true, subscriberId }
  }

  /**
   * @operationName Forget Subscriber
   * @category Subscribers
   * @description Permanently and irreversibly erases a subscriber's personal data for GDPR compliance ("right to be forgotten"). DESTRUCTIVE: the data is completely deleted after a 30-day grace period and cannot be recovered — use Delete Subscriber for a regular removal.
   * @route POST /forget-subscriber
   * @paramDef {"type":"String","label":"Subscriber ID","name":"subscriberId","required":true,"description":"The MailerLite ID of the subscriber whose data should be permanently erased."}
   * @returns {Object}
   * @sampleResult {"message":"Subscriber data will be completely deleted and forgotten within 30 days","subscriber":{"id":"31897397363737859","email":"john@example.com","status":"unsubscribed"}}
   */
  async forgetSubscriber(subscriberId) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/subscribers/${ encodeURIComponent(subscriberId) }/forget`,
      method: 'post',
      body: {},
      logTag: 'forgetSubscriber',
    })

    return {
      message: response.message || 'Subscriber data will be completely deleted and forgotten',
      subscriber: response.data || null,
    }
  }

  // ==========================================================================
  //  GROUPS
  // ==========================================================================
  /**
   * @operationName Create Group
   * @category Groups
   * @description Creates a new subscriber group with the given name. Groups organize subscribers for targeted campaigns and automations.
   * @route POST /create-group
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the group (maximum 255 characters)."}
   * @returns {Object}
   * @sampleResult {"id":"1","name":"Newsletter","active_count":0,"sent_count":0,"opens_count":0,"clicks_count":0,"unsubscribed_count":0,"unconfirmed_count":0,"bounced_count":0,"junk_count":0,"created_at":"2026-01-15 09:30:00"}
   */
  async createGroup(name) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/groups`,
      method: 'post',
      body: { name },
      logTag: 'createGroup',
    })

    return response.data
  }

  /**
   * @operationName List Groups
   * @category Groups
   * @description Lists subscriber groups with optional name filtering and page-based pagination. Each group includes subscriber counts and engagement statistics.
   * @route GET /list-groups
   * @paramDef {"type":"String","label":"Name Filter","name":"nameFilter","description":"Only return groups whose name contains this text."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of groups per page (default 25)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to fetch (default 1)."}
   * @returns {Object}
   * @sampleResult {"groups":[{"id":"1","name":"Newsletter","active_count":100,"unsubscribed_count":5,"created_at":"2026-01-15 09:30:00"}],"total":1,"currentPage":1,"lastPage":1}
   */
  async listGroups(nameFilter, limit, page) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/groups`,
      method: 'get',
      query: {
        'filter[name]': nameFilter,
        limit,
        page,
      },
      logTag: 'listGroups',
    })

    return {
      groups: response.data || [],
      total: response.meta?.total,
      currentPage: response.meta?.current_page,
      lastPage: response.meta?.last_page,
    }
  }

  /**
   * @operationName Delete Group
   * @category Groups
   * @description Deletes a subscriber group by ID. Subscribers in the group are not deleted — they only lose this group membership.
   * @route DELETE /delete-group
   * @paramDef {"type":"String","label":"Group","name":"groupId","required":true,"dictionary":"getGroupsDictionary","description":"The group to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"groupId":"1"}
   */
  async deleteGroup(groupId) {
    await this.#apiRequest({
      url: `${ API_BASE_URL }/groups/${ encodeURIComponent(groupId) }`,
      method: 'delete',
      logTag: 'deleteGroup',
    })

    return { deleted: true, groupId }
  }

  /**
   * @operationName Assign Subscriber To Group
   * @category Groups
   * @description Adds an existing subscriber to a group. The subscriber keeps all other group memberships. Returns the group the subscriber was added to.
   * @route POST /assign-subscriber-to-group
   * @paramDef {"type":"String","label":"Subscriber ID","name":"subscriberId","required":true,"description":"The MailerLite ID of the subscriber."}
   * @paramDef {"type":"String","label":"Group","name":"groupId","required":true,"dictionary":"getGroupsDictionary","description":"The group to add the subscriber to."}
   * @returns {Object}
   * @sampleResult {"id":"1","name":"Newsletter","active_count":101,"created_at":"2026-01-15 09:30:00"}
   */
  async assignSubscriberToGroup(subscriberId, groupId) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/subscribers/${ encodeURIComponent(subscriberId) }/groups/${ encodeURIComponent(groupId) }`,
      method: 'post',
      body: {},
      logTag: 'assignSubscriberToGroup',
    })

    return response.data
  }

  /**
   * @operationName Remove Subscriber From Group
   * @category Groups
   * @description Removes a subscriber from a group. The subscriber itself is not deleted and keeps all other group memberships.
   * @route DELETE /remove-subscriber-from-group
   * @paramDef {"type":"String","label":"Subscriber ID","name":"subscriberId","required":true,"description":"The MailerLite ID of the subscriber."}
   * @paramDef {"type":"String","label":"Group","name":"groupId","required":true,"dictionary":"getGroupsDictionary","description":"The group to remove the subscriber from."}
   * @returns {Object}
   * @sampleResult {"removed":true,"subscriberId":"31897397363737859","groupId":"1"}
   */
  async removeSubscriberFromGroup(subscriberId, groupId) {
    await this.#apiRequest({
      url: `${ API_BASE_URL }/subscribers/${ encodeURIComponent(subscriberId) }/groups/${ encodeURIComponent(groupId) }`,
      method: 'delete',
      logTag: 'removeSubscriberFromGroup',
    })

    return { removed: true, subscriberId, groupId }
  }

  // ==========================================================================
  //  FIELDS
  // ==========================================================================
  /**
   * @operationName List Fields
   * @category Fields
   * @description Lists all subscriber fields in the account, including default fields (email, name, last_name) and custom fields. Use the returned field keys when setting the Fields parameter of Upsert Subscriber or Update Subscriber.
   * @route GET /list-fields
   * @returns {Object}
   * @sampleResult {"fields":[{"id":"1","name":"Email","key":"email","type":"text"},{"id":"2","name":"Name","key":"name","type":"text"},{"id":"3","name":"Company","key":"company","type":"text"}]}
   */
  async listFields() {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/fields`,
      method: 'get',
      logTag: 'listFields',
    })

    return { fields: response.data || [] }
  }

  // ==========================================================================
  //  CAMPAIGNS
  // ==========================================================================
  /**
   * @operationName List Campaigns
   * @category Campaigns
   * @description Lists campaigns in the account filtered by status (Sent, Draft, or Ready) with page-based pagination. Note: MailerLite defaults to Ready campaigns when no status is selected.
   * @route GET /list-campaigns
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Sent","Draft","Ready"]}},"description":"Campaign status to filter by. MailerLite defaults to Ready when empty."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of campaigns per page (default 25)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to fetch (default 1)."}
   * @returns {Object}
   * @sampleResult {"campaigns":[{"id":"1","name":"July Newsletter","type":"regular","status":"draft","created_at":"2026-01-15 09:30:00","emails":[{"subject":"Our July news","from":"news@example.com","from_name":"Acme News"}]}],"total":1,"currentPage":1,"lastPage":1}
   */
  async listCampaigns(status, limit, page) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/campaigns`,
      method: 'get',
      query: {
        'filter[status]': this.#resolveChoice(status, CAMPAIGN_FILTER_STATUSES),
        limit,
        page,
      },
      logTag: 'listCampaigns',
    })

    return {
      campaigns: response.data || [],
      total: response.meta?.total,
      currentPage: response.meta?.current_page,
      lastPage: response.meta?.last_page,
    }
  }

  /**
   * @operationName Get Campaign
   * @category Campaigns
   * @description Fetches a single campaign by ID, including its settings, content emails, and delivery statistics (sent, opens, clicks, unsubscribes, bounces) for sent campaigns.
   * @route GET /get-campaign
   * @paramDef {"type":"String","label":"Campaign ID","name":"campaignId","required":true,"description":"The MailerLite ID of the campaign. Use List Campaigns to find campaign IDs."}
   * @returns {Object}
   * @sampleResult {"id":"1","name":"July Newsletter","type":"regular","status":"sent","emails":[{"id":"5","subject":"Our July news","from":"news@example.com","from_name":"Acme News","stats":{"sent":100,"opens_count":60,"unique_opens_count":55,"open_rate":{"float":0.6,"string":"60%"},"clicks_count":20,"click_rate":{"float":0.2,"string":"20%"},"unsubscribes_count":1,"hard_bounces_count":0,"soft_bounces_count":1}}],"finished_at":"2026-01-16 10:00:00"}
   */
  async getCampaign(campaignId) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/campaigns/${ encodeURIComponent(campaignId) }`,
      method: 'get',
      logTag: 'getCampaign',
    })

    return response.data
  }

  /**
   * @operationName Create Campaign
   * @category Campaigns
   * @description Creates a regular email campaign as a draft with the given subject, sender, and HTML content, optionally targeted at specific groups (all active subscribers when no groups are given). The sender email must already be verified in MailerLite. Creating a campaign does NOT send it — use Schedule Campaign to send instantly or at a specific time.
   * @route POST /create-campaign
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Internal campaign name shown in the MailerLite dashboard (maximum 255 characters)."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Email subject line (maximum 255 characters)."}
   * @paramDef {"type":"String","label":"From Name","name":"fromName","required":true,"description":"Sender name displayed to recipients."}
   * @paramDef {"type":"String","label":"From Email","name":"fromEmail","required":true,"description":"Sender email address. Must be a valid address already verified in your MailerLite account."}
   * @paramDef {"type":"String","label":"HTML Content","name":"content","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"HTML body of the email. Providing custom HTML content via the API requires a MailerLite Advanced plan; leave empty to design the content in the MailerLite editor."}
   * @paramDef {"type":"Array<String>","label":"Groups","name":"groups","description":"IDs of groups to send the campaign to. Leave empty to target all active subscribers. Use List Groups to find group IDs."}
   * @returns {Object}
   * @sampleResult {"id":"1","name":"July Newsletter","type":"regular","status":"draft","created_at":"2026-01-15 09:30:00","emails":[{"id":"5","subject":"Our July news","from":"news@example.com","from_name":"Acme News"}]}
   */
  async createCampaign(name, subject, fromName, fromEmail, content, groups) {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/campaigns`,
      method: 'post',
      body: clean({
        name,
        type: 'regular',
        emails: [
          clean({
            subject,
            from_name: fromName,
            from: fromEmail,
            content,
          }),
        ],
        groups,
      }),
      logTag: 'createCampaign',
    })

    return response.data
  }

  /**
   * @operationName Schedule Campaign
   * @category Campaigns
   * @description Schedules a draft campaign for delivery — this is the step that actually sends a campaign. Choose Instant to send immediately, or Scheduled to send at a specific future date and time (account timezone by default).
   * @route POST /schedule-campaign
   * @paramDef {"type":"String","label":"Campaign","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","description":"The draft campaign to schedule."}
   * @paramDef {"type":"String","label":"Delivery","name":"delivery","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Instant","Scheduled"]}},"description":"Instant sends the campaign immediately; Scheduled sends it at the given date and time."}
   * @paramDef {"type":"String","label":"Date","name":"date","description":"Delivery date in YYYY-MM-DD format (must be in the future). Required when Delivery is Scheduled."}
   * @paramDef {"type":"String","label":"Hours","name":"hours","description":"Delivery hour in 24-hour HH format, e.g. 09 or 17. Required when Delivery is Scheduled."}
   * @paramDef {"type":"String","label":"Minutes","name":"minutes","description":"Delivery minutes in mm format, e.g. 00 or 30. Required when Delivery is Scheduled."}
   * @paramDef {"type":"Number","label":"Timezone ID","name":"timezoneId","description":"Optional MailerLite timezone ID for the scheduled time. Defaults to the account timezone."}
   * @returns {Object}
   * @sampleResult {"id":"1","name":"July Newsletter","type":"regular","status":"ready","scheduled_for":"2026-07-20 09:00:00","emails":[{"id":"5","subject":"Our July news"}]}
   */
  async scheduleCampaign(campaignId, delivery, date, hours, minutes, timezoneId) {
    const deliveryValue = this.#resolveChoice(delivery, CAMPAIGN_DELIVERY_TYPES)

    const body = { delivery: deliveryValue }

    if (deliveryValue === 'scheduled') {
      body.schedule = clean({
        date,
        hours,
        minutes,
        timezone_id: timezoneId,
      })
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/campaigns/${ encodeURIComponent(campaignId) }/schedule`,
      method: 'post',
      body,
      logTag: 'scheduleCampaign',
    })

    return response.data
  }

  /**
   * @operationName Delete Campaign
   * @category Campaigns
   * @description Deletes a campaign by ID. Deleted campaigns and their statistics cannot be recovered.
   * @route DELETE /delete-campaign
   * @paramDef {"type":"String","label":"Campaign ID","name":"campaignId","required":true,"description":"The MailerLite ID of the campaign to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"campaignId":"1"}
   */
  async deleteCampaign(campaignId) {
    await this.#apiRequest({
      url: `${ API_BASE_URL }/campaigns/${ encodeURIComponent(campaignId) }`,
      method: 'delete',
      logTag: 'deleteCampaign',
    })

    return { deleted: true, campaignId }
  }

  // ==========================================================================
  //  REALTIME TRIGGER (SINGLE_APP — one webhook per registered trigger)
  // ==========================================================================
  /**
   * @operationName On Subscriber Event
   * @category Triggers
   * @description Fires when a subscriber event happens in MailerLite (created, updated, unsubscribed, added to a group, marked as spam, or bounced). MailerLite registers a webhook for the chosen event and this trigger runs your flow when the event arrives.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-subscriber-event
   * @paramDef {"type":"String","label":"Event","name":"event","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Subscriber Created","Subscriber Updated","Subscriber Unsubscribed","Subscriber Added To Group","Subscriber Spam Reported","Subscriber Bounced"]}},"description":"Which subscriber event fires this trigger."}
   * @returns {Object}
   * @sampleResult {"event":"subscriber.created","id":"31897397363737859","email":"john@example.com","status":"active","source":"api","fields":{"name":"John","last_name":"Doe"},"subscribed_at":"2026-01-15 09:30:00","created_at":"2026-01-15 09:30:00"}
   */
  onSubscriberEvent(callType, payload) {
    if (callType === CALL_TYPES.SHAPE_EVENT) {
      return [{ name: 'onSubscriberEvent', data: this.#shapeSubscriberEvent(payload) }]
    }

    if (callType === CALL_TYPES.FILTER_TRIGGER) {
      const eventData = payload.eventData || payload.data || {}

      return {
        ids: (payload.triggers || [])
          .filter(trigger => this.#resolveChoice(trigger.data?.event, SUBSCRIBER_EVENT_LABEL_TO_VALUE) === eventData.event)
          .map(trigger => trigger.id),
      }
    }
  }

  // Normalizes a raw MailerLite webhook event: keeps the full payload and guarantees
  // a top-level `event` property carrying the event name (e.g. subscriber.created).
  #shapeSubscriberEvent(rawEvent) {
    return {
      ...rawEvent,
      event: rawEvent.event || rawEvent.type,
    }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerUpsertWebhook
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    logger.debug(`handleTriggerUpsertWebhook - triggers: ${ (invocation.events || []).length }`)

    const separator = invocation.callbackUrl.includes('?') ? '&' : '?'
    const callbackUrl = `${ invocation.callbackUrl }${ separator }connectionId=${ invocation.connectionId }`
    const webhooks = []

    for (const event of invocation.events || []) {
      const resolvedEvent = this.#resolveChoice(event.triggerData?.event, SUBSCRIBER_EVENT_LABEL_TO_VALUE)

      const created = await this.#apiRequest({
        url: `${ API_BASE_URL }/webhooks`,
        method: 'post',
        body: {
          name: `FlowRunner trigger ${ event.id }`,
          events: [resolvedEvent],
          url: callbackUrl,
        },
        logTag: 'handleTriggerUpsertWebhook',
      })

      webhooks.push({ triggerId: event.id, webhookId: created?.data?.id, event: resolvedEvent })
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

    // MailerLite performs no verification handshake, but guard the empty-body case defensively.
    if (!invocation || !invocation.body) {
      return { handshake: true, responseToExternalService: invocation?.body || {} }
    }

    const connectionId = invocation.queryParams?.connectionId

    // Deliveries are a single event object, or a batch { events: [...], total } for batchable webhooks.
    const rawEvents = Array.isArray(invocation.body.events) ? invocation.body.events : [invocation.body]

    const events = rawEvents
      .filter(rawEvent => rawEvent && typeof rawEvent === 'object')
      .flatMap(rawEvent => this.onSubscriberEvent(CALL_TYPES.SHAPE_EVENT, rawEvent))

    return { connectionId, events }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerSelectMatched
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    logger.debug(`handleTriggerSelectMatched.${ invocation.eventName }`)

    return this[invocation.eventName](CALL_TYPES.FILTER_TRIGGER, invocation)
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
          url: `${ API_BASE_URL }/webhooks/${ encodeURIComponent(webhook.webhookId) }`,
          method: 'delete',
          logTag: 'handleTriggerDeleteWebhook',
        })
      } catch (error) {
        logger.warn(`handleTriggerDeleteWebhook - failed to delete webhook ${ webhook.webhookId }: ${ error?.message }`)
      }
    }

    return { webhookData: {} }
  }

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================
  /**
   * @registerAs DICTIONARY
   * @operationName Get Groups Dictionary
   * @description Lists subscriber groups for selection in group parameters. The option value is the group ID.
   * @route POST /get-groups-dictionary
   * @paramDef {"type":"getGroupsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Newsletter","value":"1","note":"100 active subscribers"}],"cursor":"2"}
   */
  async getGroupsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/groups`,
      method: 'get',
      query: {
        'filter[name]': search,
        limit: DICTIONARY_PAGE_SIZE,
        page: cursor,
      },
      logTag: 'getGroupsDictionary',
    })

    const meta = response.meta || {}
    const hasMore = meta.current_page && meta.last_page && meta.current_page < meta.last_page

    return {
      items: (response.data || []).map(group => ({
        label: group.name,
        value: String(group.id),
        note: `${ group.active_count ?? 0 } active subscribers`,
      })),
      cursor: hasMore ? String(meta.current_page + 1) : null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Campaigns Dictionary
   * @description Lists draft campaigns for selection in Schedule Campaign. The option value is the campaign ID.
   * @route POST /get-campaigns-dictionary
   * @paramDef {"type":"getCampaignsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"July Newsletter","value":"1","note":"draft - Our July news"}],"cursor":"2"}
   */
  async getCampaignsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/campaigns`,
      method: 'get',
      query: {
        'filter[status]': 'draft',
        limit: DICTIONARY_PAGE_SIZE,
        page: cursor,
      },
      logTag: 'getCampaignsDictionary',
    })

    const meta = response.meta || {}
    const hasMore = meta.current_page && meta.last_page && meta.current_page < meta.last_page
    const searchText = (search || '').toLowerCase()

    const campaigns = (response.data || [])
      .filter(campaign => !searchText || (campaign.name || '').toLowerCase().includes(searchText))

    return {
      items: campaigns.map(campaign => ({
        label: campaign.name,
        value: String(campaign.id),
        note: [campaign.status, campaign.emails?.[0]?.subject].filter(Boolean).join(' - '),
      })),
      cursor: hasMore ? String(meta.current_page + 1) : null,
    }
  }
}

Flowrunner.ServerCode.addService(MailerLite, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your MailerLite API token. Generate it in MailerLite under Integrations → MailerLite API.',
  },
])
