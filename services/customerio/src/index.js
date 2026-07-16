const logger = {
  info: (...args) => console.log('[Customer.io] info:', ...args),
  debug: (...args) => console.log('[Customer.io] debug:', ...args),
  error: (...args) => console.log('[Customer.io] error:', ...args),
  warn: (...args) => console.log('[Customer.io] warn:', ...args),
}

const REGION_HOSTS = {
  US: {
    track: 'https://track.customer.io/api/v1',
    app: 'https://api.customer.io/v1',
  },
  EU: {
    track: 'https://track-eu.customer.io/api/v1',
    app: 'https://api-eu.customer.io/v1',
  },
}

const DEFAULT_PAGE_LIMIT = 50

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
 * @integrationName Customer.io
 * @integrationIcon /icon.png
 */
class CustomerIOService {
  constructor(config) {
    this.siteId = config.siteId
    this.trackApiKey = config.trackApiKey
    this.appApiKey = config.appApiKey
    this.region = config.region === 'EU' ? 'EU' : 'US'
  }

  get #trackBaseUrl() {
    return REGION_HOSTS[this.region].track
  }

  get #appBaseUrl() {
    return REGION_HOSTS[this.region].app
  }

  #trackHeaders() {
    const credentials = Buffer.from(`${ this.siteId }:${ this.trackApiKey }`).toString('base64')

    return {
      'Authorization': `Basic ${ credentials }`,
      'Content-Type': 'application/json',
    }
  }

  #appHeaders() {
    if (!this.appApiKey) {
      throw new Error(
        'Customer.io App API Key is not configured. This action requires an App API key. ' +
        'Create one in Customer.io under Account Settings → App API Keys and add it to the service configuration.'
      )
    }

    return {
      'Authorization': `Bearer ${ this.appApiKey }`,
      'Content-Type': 'application/json',
    }
  }

  async #apiRequest({ url, method = 'get', headers, body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set(headers)
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.meta?.error ||
        (Array.isArray(error.body?.errors)
          ? error.body.errors.map(e => (typeof e === 'string' ? e : e.detail || e.reason || JSON.stringify(e))).join('; ')
          : error.body?.errors) ||
        (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))

      logger.error(`${ logTag } - Request failed: ${ message }`)

      throw new Error(`Customer.io API error: ${ message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // ---------------------------------------------------------------------------
  // People (Track API)
  // ---------------------------------------------------------------------------

  /**
   * @operationName Identify Person
   * @category People
   * @description Creates a new person or updates an existing one in your Customer.io workspace (upsert). Identify a person by email address or by your internal ID, and set any profile attributes as key-value pairs. Reserved attributes like "email", "created_at" (Unix timestamp) and "unsubscribed" can be included in the attributes object. Uses the Track API.
   * @route PUT /identify-person
   *
   * @paramDef {"type":"String","label":"Identifier","name":"identifier","required":true,"description":"The person's identifier: an email address or your internal ID, depending on your workspace settings."}
   * @paramDef {"type":"Object","label":"Attributes","name":"attributes","description":"Profile attributes to set on the person as key-value pairs, e.g. {\"email\":\"ada@example.com\",\"first_name\":\"Ada\",\"plan\":\"pro\"}."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"identifier":"ada@example.com"}
   */
  async identifyPerson(identifier, attributes) {
    const logTag = '[identifyPerson]'

    await this.#apiRequest({
      logTag,
      url: `${ this.#trackBaseUrl }/customers/${ encodeURIComponent(identifier) }`,
      method: 'put',
      headers: this.#trackHeaders(),
      body: attributes || {},
    })

    return { success: true, identifier }
  }

  /**
   * @operationName Delete Person
   * @category People
   * @description Permanently deletes a person and their profile data from your Customer.io workspace. This does not prevent the person from being re-added later; to stop all future messaging and re-identification, use Suppress Person instead. Uses the Track API.
   * @route DELETE /delete-person
   *
   * @paramDef {"type":"String","label":"Person ID","name":"personId","required":true,"description":"The person's identifier: an email address or your internal ID, depending on your workspace settings."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"personId":"ada@example.com"}
   */
  async deletePerson(personId) {
    const logTag = '[deletePerson]'

    await this.#apiRequest({
      logTag,
      url: `${ this.#trackBaseUrl }/customers/${ encodeURIComponent(personId) }`,
      method: 'delete',
      headers: this.#trackHeaders(),
    })

    return { success: true, personId }
  }

  /**
   * @operationName Suppress Person
   * @category People
   * @description Suppresses a person: deletes their profile and prevents Customer.io from ever re-adding or messaging that identifier again until it is unsuppressed. Use this for hard opt-outs and data removal requests. Uses the Track API.
   * @route POST /suppress-person
   *
   * @paramDef {"type":"String","label":"Person ID","name":"personId","required":true,"description":"The person's identifier: an email address or your internal ID, depending on your workspace settings."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"personId":"ada@example.com"}
   */
  async suppressPerson(personId) {
    const logTag = '[suppressPerson]'

    await this.#apiRequest({
      logTag,
      url: `${ this.#trackBaseUrl }/customers/${ encodeURIComponent(personId) }/suppress`,
      method: 'post',
      headers: this.#trackHeaders(),
      body: {},
    })

    return { success: true, personId }
  }

  /**
   * @operationName Unsuppress Person
   * @category People
   * @description Removes the suppression from a previously suppressed identifier, allowing Customer.io to identify and message that person again. This does not restore the deleted profile data; re-identify the person to rebuild their profile. Uses the Track API.
   * @route POST /unsuppress-person
   *
   * @paramDef {"type":"String","label":"Person ID","name":"personId","required":true,"description":"The person's identifier: an email address or your internal ID, depending on your workspace settings."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"personId":"ada@example.com"}
   */
  async unsuppressPerson(personId) {
    const logTag = '[unsuppressPerson]'

    await this.#apiRequest({
      logTag,
      url: `${ this.#trackBaseUrl }/customers/${ encodeURIComponent(personId) }/unsuppress`,
      method: 'post',
      headers: this.#trackHeaders(),
      body: {},
    })

    return { success: true, personId }
  }

  // ---------------------------------------------------------------------------
  // Events (Track API)
  // ---------------------------------------------------------------------------

  /**
   * @operationName Track Event
   * @category Events
   * @description Sends a named event for a known person to Customer.io. Events can trigger campaigns, update segments, and appear on the person's activity timeline. Event data is available in campaign messages via liquid (e.g. {{event.plan}}). Uses the Track API.
   * @route POST /track-event
   *
   * @paramDef {"type":"String","label":"Person ID","name":"personId","required":true,"description":"The person's identifier: an email address or your internal ID, depending on your workspace settings."}
   * @paramDef {"type":"String","label":"Event Name","name":"eventName","required":true,"description":"Name of the event, e.g. \"purchase\" or \"signed_up\"."}
   * @paramDef {"type":"Object","label":"Event Data","name":"data","description":"Optional event payload as key-value pairs, e.g. {\"plan\":\"pro\",\"amount\":99}."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"personId":"ada@example.com","eventName":"purchase"}
   */
  async trackEvent(personId, eventName, data) {
    const logTag = '[trackEvent]'

    await this.#apiRequest({
      logTag,
      url: `${ this.#trackBaseUrl }/customers/${ encodeURIComponent(personId) }/events`,
      method: 'post',
      headers: this.#trackHeaders(),
      body: clean({
        name: eventName,
        data: data || undefined,
      }),
    })

    return { success: true, personId, eventName }
  }

  /**
   * @operationName Track Anonymous Event
   * @category Events
   * @description Sends a named event that is not associated with a known person. Anonymous events can trigger event-triggered campaigns for anonymous invites and similar flows. Optionally provide an anonymous ID to group events from the same unidentified visitor; if that visitor is later identified with the same ID, Customer.io can associate their anonymous events. Uses the Track API.
   * @route POST /track-anonymous-event
   *
   * @paramDef {"type":"String","label":"Event Name","name":"eventName","required":true,"description":"Name of the event, e.g. \"invite_sent\"."}
   * @paramDef {"type":"Object","label":"Event Data","name":"data","description":"Optional event payload as key-value pairs. For anonymous invite campaigns, include a \"recipient\" property with the recipient's email address."}
   * @paramDef {"type":"String","label":"Anonymous ID","name":"anonymousId","description":"Optional identifier for the anonymous visitor who performed the event."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"eventName":"invite_sent"}
   */
  async trackAnonymousEvent(eventName, data, anonymousId) {
    const logTag = '[trackAnonymousEvent]'

    await this.#apiRequest({
      logTag,
      url: `${ this.#trackBaseUrl }/events`,
      method: 'post',
      headers: this.#trackHeaders(),
      body: clean({
        name: eventName,
        data: data || undefined,
        anonymous_id: anonymousId,
      }),
    })

    return { success: true, eventName }
  }

  // ---------------------------------------------------------------------------
  // Segments (Track + App API)
  // ---------------------------------------------------------------------------

  /**
   * @operationName Add To Manual Segment
   * @category Segments
   * @description Adds up to 1000 people to a manual segment by their IDs. The segment must be a manual (not data-driven) segment created in Customer.io. People who do not exist yet are ignored. Uses the Track API.
   * @route POST /add-to-manual-segment
   *
   * @paramDef {"type":"String","label":"Segment","name":"segmentId","required":true,"dictionary":"getSegmentsDictionary","description":"The manual segment to add people to. Select from the list (requires the App API key) or enter the numeric segment ID directly."}
   * @paramDef {"type":"Array<String>","label":"Person IDs","name":"personIds","required":true,"description":"IDs of the people to add (up to 1000 per call). These are the identifiers used in your workspace (IDs or email addresses)."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"segmentId":"7","count":2}
   */
  async addToManualSegment(segmentId, personIds) {
    const logTag = '[addToManualSegment]'

    await this.#apiRequest({
      logTag,
      url: `${ this.#trackBaseUrl }/segments/${ encodeURIComponent(segmentId) }/add_customers`,
      method: 'post',
      headers: this.#trackHeaders(),
      body: { ids: personIds },
    })

    return { success: true, segmentId, count: (personIds || []).length }
  }

  /**
   * @operationName Remove From Manual Segment
   * @category Segments
   * @description Removes up to 1000 people from a manual segment by their IDs. The segment must be a manual (not data-driven) segment created in Customer.io. Uses the Track API.
   * @route POST /remove-from-manual-segment
   *
   * @paramDef {"type":"String","label":"Segment","name":"segmentId","required":true,"dictionary":"getSegmentsDictionary","description":"The manual segment to remove people from. Select from the list (requires the App API key) or enter the numeric segment ID directly."}
   * @paramDef {"type":"Array<String>","label":"Person IDs","name":"personIds","required":true,"description":"IDs of the people to remove (up to 1000 per call). These are the identifiers used in your workspace (IDs or email addresses)."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"segmentId":"7","count":2}
   */
  async removeFromManualSegment(segmentId, personIds) {
    const logTag = '[removeFromManualSegment]'

    await this.#apiRequest({
      logTag,
      url: `${ this.#trackBaseUrl }/segments/${ encodeURIComponent(segmentId) }/remove_customers`,
      method: 'post',
      headers: this.#trackHeaders(),
      body: { ids: personIds },
    })

    return { success: true, segmentId, count: (personIds || []).length }
  }

  /**
   * @operationName List Segments
   * @category Segments
   * @description Lists all segments in the workspace with their ID, name, description, type (manual or data-driven) and state. Use the numeric ID with the manual segment actions. Requires the App API key.
   * @route GET /list-segments
   *
   * @returns {Object}
   * @sampleResult {"segments":[{"id":7,"deduplicate_id":"7:1613063089","name":"Manual Segment","description":"People added via API","state":"finished","type":"manual","progress":null,"tags":null}]}
   */
  async listSegments() {
    const logTag = '[listSegments]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.#appBaseUrl }/segments`,
      method: 'get',
      headers: this.#appHeaders(),
    })
  }

  // ---------------------------------------------------------------------------
  // Messaging (App API)
  // ---------------------------------------------------------------------------

  /**
   * @operationName Send Transactional Email
   * @category Messaging
   * @description Sends a transactional email using a transactional message template defined in Customer.io. Personalize the template with message data (available via liquid, e.g. {{trigger.order_id}}), and optionally override the template's from address, subject or body for this send. Identify the recipient person by ID or email; if the person does not exist, Customer.io creates a profile for them. Returns the delivery ID for tracking. Requires the App API key.
   * @route POST /send-transactional-email
   *
   * @paramDef {"type":"String","label":"Transactional Message","name":"transactionalMessageId","required":true,"dictionary":"getTransactionalMessagesDictionary","description":"The transactional message template to send. Select from the list or enter the numeric ID (or trigger name) directly."}
   * @paramDef {"type":"String","label":"To","name":"to","required":true,"description":"Recipient email address, e.g. ada@example.com."}
   * @paramDef {"type":"String","label":"Person Email","name":"personEmail","description":"Email identifier of the person to attribute this delivery to. Provide either this or Person ID."}
   * @paramDef {"type":"String","label":"Person ID","name":"personId","description":"ID identifier of the person to attribute this delivery to. Provide either this or Person Email. If both are set, Person ID is used."}
   * @paramDef {"type":"Object","label":"Message Data","name":"messageData","description":"Key-value data merged into the template via liquid, e.g. {\"order_id\":\"A-1234\",\"total\":\"$99.00\"}."}
   * @paramDef {"type":"String","label":"From Override","name":"fromOverride","description":"Optional from address override for this send, e.g. \"Support <support@example.com>\". Leave empty to use the template's from address."}
   * @paramDef {"type":"String","label":"Subject Override","name":"subjectOverride","description":"Optional subject line override for this send. Leave empty to use the template's subject."}
   * @paramDef {"type":"String","label":"Body Override","name":"bodyOverride","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional HTML body override for this send. Leave empty to use the template's body."}
   *
   * @returns {Object}
   * @sampleResult {"delivery_id":"RPILAgUBcRhIBqSfeiIwdIYJKxTY","queued_at":1613063089}
   */
  async sendTransactionalEmail(transactionalMessageId, to, personEmail, personId, messageData, fromOverride, subjectOverride, bodyOverride) {
    const logTag = '[sendTransactionalEmail]'

    if (!personId && !personEmail) {
      throw new Error('Customer.io API error: provide either Person ID or Person Email to identify the recipient person.')
    }

    const identifiers = personId ? { id: personId } : { email: personEmail }

    return await this.#apiRequest({
      logTag,
      url: `${ this.#appBaseUrl }/send/email`,
      method: 'post',
      headers: this.#appHeaders(),
      body: clean({
        transactional_message_id: transactionalMessageId,
        to,
        identifiers,
        message_data: messageData || undefined,
        from: fromOverride,
        subject: subjectOverride,
        body: bodyOverride,
      }),
    })
  }

  /**
   * @operationName Trigger Broadcast
   * @category Messaging
   * @description Triggers an API-triggered broadcast campaign, sending it to its configured audience or to the recipients you specify. Only campaigns created as API-triggered broadcasts in Customer.io can be triggered this way; regular segment- or event-triggered campaigns cannot. Trigger data is available in the broadcast's messages via liquid (e.g. {{trigger.headline}}). Returns the trigger ID for status tracking. Requires the App API key.
   * @route POST /trigger-broadcast
   *
   * @paramDef {"type":"String","label":"Broadcast","name":"broadcastId","required":true,"dictionary":"getBroadcastsDictionary","description":"The API-triggered broadcast to trigger. Select from the list or enter the numeric broadcast ID directly."}
   * @paramDef {"type":"Object","label":"Trigger Data","name":"data","description":"Key-value data merged into the broadcast's messages via liquid, e.g. {\"headline\":\"Flash sale\",\"discount\":\"20%\"}."}
   * @paramDef {"type":"Object","label":"Recipients","name":"recipients","description":"Optional audience filter overriding the broadcast's configured audience, e.g. {\"segment\":{\"id\":7}} or an and/or attribute filter. Leave empty to use the audience configured in Customer.io."}
   *
   * @returns {Object}
   * @sampleResult {"id":3,"broadcast_id":12,"created_at":1613063089}
   */
  async triggerBroadcast(broadcastId, data, recipients) {
    const logTag = '[triggerBroadcast]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.#appBaseUrl }/campaigns/${ encodeURIComponent(broadcastId) }/triggers`,
      method: 'post',
      headers: this.#appHeaders(),
      body: clean({
        data: data || undefined,
        recipients: recipients || undefined,
      }),
    })
  }

  /**
   * @operationName List Transactional Messages
   * @category Messaging
   * @description Lists the transactional message templates defined in the workspace with their numeric ID, name and settings. Use the ID with Send Transactional Email. Requires the App API key.
   * @route GET /list-transactional-messages
   *
   * @returns {Object}
   * @sampleResult {"messages":[{"id":5,"name":"Order Confirmation","description":"Sent after purchase","send_to_unsubscribed":true,"queue_drafts":false,"created_at":1613063089,"updated_at":1613063089}]}
   */
  async listTransactionalMessages() {
    const logTag = '[listTransactionalMessages]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.#appBaseUrl }/transactional`,
      method: 'get',
      headers: this.#appHeaders(),
    })
  }

  // ---------------------------------------------------------------------------
  // Customers (App API)
  // ---------------------------------------------------------------------------

  /**
   * @operationName Search Customers
   * @category People
   * @description Searches people in the workspace by attribute. Either provide a simple attribute name/value pair (matched with the "eq" operator) or supply a raw Customer.io filter object for advanced queries (and/or/not, segment membership, exists). Returns matching people's identifiers (id, email, cio_id) and a cursor for the next page. Requires the App API key.
   * @route POST /search-customers
   *
   * @paramDef {"type":"String","label":"Attribute Name","name":"attributeName","description":"Attribute to match, e.g. \"email\" or \"plan\". Used with Attribute Value for a simple equality search. Ignored when Raw Filter is provided."}
   * @paramDef {"type":"String","label":"Attribute Value","name":"attributeValue","description":"Value the attribute must equal, e.g. \"ada@example.com\"."}
   * @paramDef {"type":"Object","label":"Raw Filter","name":"rawFilter","description":"Full Customer.io filter object for advanced searches, e.g. {\"and\":[{\"attribute\":{\"field\":\"plan\",\"operator\":\"eq\",\"value\":\"pro\"}}]}. Takes precedence over the simple attribute pair."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of people to return per page (default 50, max 1000)."}
   * @paramDef {"type":"String","label":"Start Cursor","name":"start","description":"Pagination cursor from a previous response's \"next\" field. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"identifiers":[{"email":"ada@example.com","id":"user_42","cio_id":"a3000001"}],"ids":["user_42"],"next":"eyJwYWdlIjoyfQ"}
   */
  async searchCustomers(attributeName, attributeValue, rawFilter, limit, start) {
    const logTag = '[searchCustomers]'

    let filter = rawFilter

    if (!filter) {
      if (!attributeName) {
        throw new Error('Customer.io API error: provide either an Attribute Name/Value pair or a Raw Filter object.')
      }

      filter = {
        and: [
          { attribute: { field: attributeName, operator: 'eq', value: attributeValue } },
        ],
      }
    }

    return await this.#apiRequest({
      logTag,
      url: `${ this.#appBaseUrl }/customers`,
      method: 'post',
      headers: this.#appHeaders(),
      query: {
        limit: limit || DEFAULT_PAGE_LIMIT,
        start,
      },
      body: { filter },
    })
  }

  /**
   * @operationName Get Customer Attributes
   * @category People
   * @description Returns a person's full attribute set, along with the timestamp each attribute was last updated and the person's devices and unsubscribe state. Requires the App API key.
   * @route GET /get-customer-attributes
   *
   * @paramDef {"type":"String","label":"Person ID","name":"personId","required":true,"description":"The person's identifier: an email address or your internal ID, depending on your workspace settings."}
   *
   * @returns {Object}
   * @sampleResult {"customer":{"id":"user_42","attributes":{"email":"ada@example.com","first_name":"Ada","plan":"pro"},"timestamps":{"email":1613063089,"first_name":1613063089},"unsubscribed":false,"devices":[]}}
   */
  async getCustomerAttributes(personId) {
    const logTag = '[getCustomerAttributes]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.#appBaseUrl }/customers/${ encodeURIComponent(personId) }/attributes`,
      method: 'get',
      headers: this.#appHeaders(),
    })
  }

  /**
   * @operationName List Customer Activities
   * @category People
   * @description Returns a person's activity timeline: events they performed, attribute changes, page views, messages sent/opened/clicked, and more. Optionally filter by activity type. Returns activities plus a cursor for the next page. Requires the App API key.
   * @route GET /list-customer-activities
   *
   * @paramDef {"type":"String","label":"Person ID","name":"personId","required":true,"description":"The person's identifier: an email address or your internal ID, depending on your workspace settings."}
   * @paramDef {"type":"String","label":"Activity Type","name":"activityType","uiComponent":{"type":"DROPDOWN","options":{"values":["Page View","Event","Attribute Update","Failed Attribute Update","Device Update","Email Drafted","Email Sent","Email Delivered","Email Opened","Email Clicked","Email Converted","Email Bounced","Email Dropped","Email Spammed","Email Failed","Email Unsubscribed","Webhook Event"]}},"description":"Optional filter limiting results to a single activity type. Leave empty for all activity."}
   * @paramDef {"type":"String","label":"Event Name","name":"eventName","description":"Optional event name filter, applied when Activity Type is Event or Page View."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of activities to return per page (default 10, max 100)."}
   *
   * @returns {Object}
   * @sampleResult {"activities":[{"id":"01F5B0EXAMPLE","type":"event","name":"purchase","timestamp":1613063089,"data":{"plan":"pro"},"customer_id":"user_42","customer_identifiers":{"id":"user_42","email":"ada@example.com"}}],"next":""}
   */
  async listCustomerActivities(personId, activityType, eventName, limit) {
    const logTag = '[listCustomerActivities]'

    const type = this.#resolveChoice(activityType, {
      'Page View': 'page',
      'Event': 'event',
      'Attribute Update': 'attribute_update',
      'Failed Attribute Update': 'failed_attribute_update',
      'Device Update': 'device_update',
      'Email Drafted': 'drafted_email',
      'Email Sent': 'sent_email',
      'Email Delivered': 'delivered_email',
      'Email Opened': 'opened_email',
      'Email Clicked': 'clicked_email',
      'Email Converted': 'converted_email',
      'Email Bounced': 'bounced_email',
      'Email Dropped': 'dropped_email',
      'Email Spammed': 'spammed_email',
      'Email Failed': 'failed_email',
      'Email Unsubscribed': 'unsubscribed_email',
      'Webhook Event': 'webhook_event',
    })

    return await this.#apiRequest({
      logTag,
      url: `${ this.#appBaseUrl }/customers/${ encodeURIComponent(personId) }/activities`,
      method: 'get',
      headers: this.#appHeaders(),
      query: {
        type,
        name: eventName,
        limit,
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Campaigns (App API)
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Campaigns
   * @category Campaigns
   * @description Lists all campaigns in the workspace with their metadata: numeric ID, name, type (segment, event or API-triggered), state, trigger and action details, and tags. Use the ID with Get Campaign Metrics. Requires the App API key.
   * @route GET /list-campaigns
   *
   * @returns {Object}
   * @sampleResult {"campaigns":[{"id":3,"name":"Welcome Series","type":"segment","state":"running","created":1613063089,"updated":1613063089,"active":true,"actions":[{"id":96,"type":"email"}],"tags":["onboarding"]}]}
   */
  async listCampaigns() {
    const logTag = '[listCampaigns]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.#appBaseUrl }/campaigns`,
      method: 'get',
      headers: this.#appHeaders(),
    })
  }

  /**
   * @operationName Get Campaign Metrics
   * @category Campaigns
   * @description Returns time-series performance metrics for a campaign: sent, delivered, opened, clicked, converted, bounced, unsubscribed and more, bucketed by the period you choose. Use Steps to control how many periods are returned (e.g. period Days with 30 steps returns the last 30 days). Requires the App API key.
   * @route GET /get-campaign-metrics
   *
   * @paramDef {"type":"Number","label":"Campaign ID","name":"campaignId","required":true,"description":"Numeric ID of the campaign. Find it with List Campaigns."}
   * @paramDef {"type":"String","label":"Period","name":"period","defaultValue":"Days","uiComponent":{"type":"DROPDOWN","options":{"values":["Hours","Days","Weeks","Months"]}},"description":"Time bucket size for the metric series. Defaults to Days."}
   * @paramDef {"type":"Number","label":"Steps","name":"steps","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of periods to return, counting back from now (e.g. 30 with period Days = last 30 days). Maximum depends on the period; up to 24 hours, 45 days, 12 weeks or 120 months."}
   *
   * @returns {Object}
   * @sampleResult {"metric":{"series":{"sent":[120,98],"delivered":[118,96],"opened":[54,40],"clicked":[12,9],"converted":[3,2],"bounced":[2,2],"unsubscribed":[1,0]}}}
   */
  async getCampaignMetrics(campaignId, period, steps) {
    const logTag = '[getCampaignMetrics]'

    return await this.#apiRequest({
      logTag,
      url: `${ this.#appBaseUrl }/campaigns/${ encodeURIComponent(campaignId) }/metrics`,
      method: 'get',
      headers: this.#appHeaders(),
      query: {
        period: this.#resolveChoice(period, {
          Hours: 'hours',
          Days: 'days',
          Weeks: 'weeks',
          Months: 'months',
        }) || 'days',
        steps,
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Dictionaries (App API)
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} getSegmentsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text filter applied to segment names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Customer.io returns all segments in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Segments Dictionary
   * @description Provides the workspace's manual segments for selection in the Add To / Remove From Manual Segment actions. The option value is the numeric segment ID. Requires the App API key.
   * @route POST /get-segments-dictionary
   * @paramDef {"type":"getSegmentsDictionary__payload","label":"Payload","name":"payload","description":"Contains the search string used to filter segments by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Manual Segment","value":"7","note":"manual"}],"cursor":null}
   */
  async getSegmentsDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getSegmentsDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ this.#appBaseUrl }/segments`,
      method: 'get',
      headers: this.#appHeaders(),
    })

    const searchLower = (search || '').toLowerCase()

    const segments = (response.segments || [])
      .filter(segment => segment.type === 'manual')
      .filter(segment => !searchLower || (segment.name || '').toLowerCase().includes(searchLower))

    return {
      items: segments.map(segment => ({
        label: segment.name,
        value: String(segment.id),
        note: segment.description || segment.type,
      })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getTransactionalMessagesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text filter applied to transactional message names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Customer.io returns all transactional messages in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Transactional Messages Dictionary
   * @description Provides the workspace's transactional message templates for selection in Send Transactional Email. The option value is the numeric message ID. Requires the App API key.
   * @route POST /get-transactional-messages-dictionary
   * @paramDef {"type":"getTransactionalMessagesDictionary__payload","label":"Payload","name":"payload","description":"Contains the search string used to filter transactional messages by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Order Confirmation","value":"5","note":"Sent after purchase"}],"cursor":null}
   */
  async getTransactionalMessagesDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getTransactionalMessagesDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ this.#appBaseUrl }/transactional`,
      method: 'get',
      headers: this.#appHeaders(),
    })

    const searchLower = (search || '').toLowerCase()

    const messages = (response.messages || [])
      .filter(message => !searchLower || (message.name || '').toLowerCase().includes(searchLower))

    return {
      items: messages.map(message => ({
        label: message.name,
        value: String(message.id),
        note: message.description || undefined,
      })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getBroadcastsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text filter applied to broadcast names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Customer.io returns all broadcasts in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Broadcasts Dictionary
   * @description Provides the workspace's API-triggered broadcasts for selection in Trigger Broadcast. The option value is the numeric broadcast ID. Requires the App API key.
   * @route POST /get-broadcasts-dictionary
   * @paramDef {"type":"getBroadcastsDictionary__payload","label":"Payload","name":"payload","description":"Contains the search string used to filter broadcasts by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Flash Sale Announcement","value":"12","note":"active"}],"cursor":null}
   */
  async getBroadcastsDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getBroadcastsDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ this.#appBaseUrl }/broadcasts`,
      method: 'get',
      headers: this.#appHeaders(),
    })

    const searchLower = (search || '').toLowerCase()

    const broadcasts = (response.broadcasts || [])
      .filter(broadcast => !searchLower || (broadcast.name || '').toLowerCase().includes(searchLower))

    return {
      items: broadcasts.map(broadcast => ({
        label: broadcast.name,
        value: String(broadcast.id),
        note: broadcast.active === false ? 'inactive' : 'active',
      })),
      cursor: null,
    }
  }
}

Flowrunner.ServerCode.addService(CustomerIOService, [
  {
    name: 'siteId',
    displayName: 'Site ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your workspace Site ID. Find it in Customer.io under Workspace Settings → API Credentials → Tracking API.',
  },
  {
    name: 'trackApiKey',
    displayName: 'Track API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Tracking API key, paired with the Site ID. Find it in Customer.io under Workspace Settings → API Credentials → Tracking API.',
  },
  {
    name: 'appApiKey',
    displayName: 'App API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Needed only for App API actions (transactional email, broadcasts, customer search, segments, campaigns). Create one in Customer.io under Account Settings → App API Keys.',
  },
  {
    name: 'region',
    displayName: 'Region',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    defaultValue: 'US',
    required: true,
    shared: false,
    options: ['US', 'EU'],
    hint: 'Data center region of your Customer.io account. Pick EU if your account is hosted in the European Union region.',
  },
])
