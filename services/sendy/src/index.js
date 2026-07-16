const logger = {
  info: (...args) => console.log('[Sendy] info:', ...args),
  debug: (...args) => console.log('[Sendy] debug:', ...args),
  error: (...args) => console.log('[Sendy] error:', ...args),
  warn: (...args) => console.log('[Sendy] warn:', ...args),
}

// Sendy responses are PLAIN TEXT, never JSON. Successful calls return short
// strings such as "1", "true", a status like "Subscribed", or a message like
// "Campaign created". Failures also arrive as plain-text strings (HTTP 200),
// e.g. "Already subscribed." or "Invalid API key.". We never JSON-parse the
// body; instead we normalize the text and treat a known set of error phrases
// (plus anything that is not a recognized success token) as a failure.

// Case-insensitive substrings that indicate a failed operation even though
// Sendy returns them with a 200 status and a plain-text body.
const ERROR_MARKERS = [
  'some fields are missing',
  'api key not passed',
  'invalid api key',
  'invalid email address',
  'already subscribed',
  'bounced email address',
  'email is suppressed',
  'invalid list id',
  'email does not exist',
  'no data passed',
  'list id not passed',
  'list does not exist',
  'email address not passed',
  'subscriber does not exist',
  'email not passed',
  'email does not exist in list',
  'no brands found',
  'from name not passed',
  'from email not passed',
  'reply to email not passed',
  'subject not passed',
  'html not passed',
  'list or segment id',
  'one or more list ids are invalid',
  'one or more segment ids are invalid',
  'brand id not passed',
  'unable to create campaign',
  'unable to create and send campaign',
  'unable to schedule campaign',
  'unable to calculate totals',
]

function toText(response) {
  if (response === undefined || response === null) {
    return ''
  }

  if (typeof response === 'string') {
    return response.trim()
  }

  if (Buffer.isBuffer(response)) {
    return response.toString('utf8').trim()
  }

  if (typeof response === 'object') {
    if (typeof response.text === 'string') {
      return response.text.trim()
    }

    return JSON.stringify(response).trim()
  }

  return String(response).trim()
}

function isError(text) {
  const lower = text.toLowerCase()

  return ERROR_MARKERS.some(marker => lower.includes(marker))
}

// Remove undefined/null/empty values so optional form fields are omitted.
function clean(obj) {
  const result = {}

  for (const key in obj) {
    const value = obj[key]

    if (value !== undefined && value !== null && value !== '') {
      result[key] = value
    }
  }

  return result
}

// Sendy expects boolean flags (boolean, silent, gdpr) as the string "true"/"1".
function toFlag(value) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  return value === true || value === 'true' || value === 1 || value === '1' ? 'true' : undefined
}

/**
 * @integrationName Sendy
 * @integrationIcon /icon.png
 */
class SendyService {
  constructor(config) {
    // Base URL of the self-hosted Sendy installation, e.g. https://sendy.example.com
    this.url = (config.url || '').replace(/\/+$/, '')
    this.apiKey = config.apiKey
  }

  // Single request helper. Every Sendy endpoint is POST with an
  // application/x-www-form-urlencoded body that always includes api_key.
  // The response is plain text; known error strings are converted to thrown
  // errors so failed operations surface as errors rather than silent successes.
  async #apiRequest({ path, body, logTag }) {
    const url = `${ this.url }${ path }`
    const formBody = clean({ api_key: this.apiKey, ...body })

    try {
      logger.debug(`${ logTag } - [POST::${ url }]`)

      const response = await Flowrunner.Request.post(url)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(formBody)

      const text = toText(response)

      if (isError(text)) {
        logger.error(`${ logTag } - Sendy returned an error: ${ text }`)
        throw new Error(`Sendy API error: ${ text }`)
      }

      return text
    } catch (error) {
      if (error.message && error.message.startsWith('Sendy API error:')) {
        throw error
      }

      const message = toText(error.body) || error.message || 'Unknown error'

      logger.error(`${ logTag } - Request failed: ${ message }`)

      throw new Error(`Sendy API error: ${ message }`)
    }
  }

  /**
   * @operationName Subscribe
   * @category Subscribers
   * @description Adds a subscriber to a Sendy list. Requires the list ID and email; name, country, IP address, referrer, and GDPR consent are optional, and any additional custom field values can be provided as a JSON object matching your list's custom fields. Returns the plain-text string "true" on success. Common plain-text errors include "Already subscribed.", "Invalid email address.", "Bounced email address.", "Email is suppressed.", and "Invalid list ID.".
   * @route POST /subscribe
   * @paramDef {"type":"String","label":"List ID","name":"list","required":true,"description":"The Sendy list ID (the encrypted list ID shown in your Sendy dashboard) to subscribe the person to."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Email address of the subscriber."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Name of the subscriber."}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"Two-letter country code of the subscriber, e.g. US, GB."}
   * @paramDef {"type":"String","label":"IP Address","name":"ipaddress","description":"IP address of the subscriber, used for geolocation and analytics."}
   * @paramDef {"type":"String","label":"Referrer","name":"referrer","description":"URL the subscriber was referred from."}
   * @paramDef {"type":"Boolean","label":"GDPR Consent","name":"gdpr","uiComponent":{"type":"CHECKBOX"},"description":"Set to true to mark that the subscriber gave GDPR consent."}
   * @paramDef {"type":"Boolean","label":"Silent","name":"silent","uiComponent":{"type":"CHECKBOX"},"description":"Set to true to bypass the double opt-in confirmation email and add the subscriber directly (only applies to double opt-in lists)."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Additional custom field values as a JSON object, e.g. {\"City\":\"London\"}. Keys must match the custom field names configured on your Sendy list."}
   * @returns {String}
   * @sampleResult "true"
   */
  async subscribe(list, email, name, country, ipaddress, referrer, gdpr, silent, customFields) {
    const logTag = '[subscribe]'

    return await this.#apiRequest({
      logTag,
      path: '/subscribe',
      body: clean({
        list,
        email,
        name,
        country,
        ipaddress,
        referrer,
        gdpr: toFlag(gdpr),
        silent: toFlag(silent),
        boolean: 'true',
        ...(customFields && typeof customFields === 'object' ? customFields : {}),
      }),
    })
  }

  /**
   * @operationName Unsubscribe
   * @category Subscribers
   * @description Unsubscribes an email address from a Sendy list. The subscriber remains in the list but is marked as unsubscribed. Returns the plain-text string "true" on success. Common plain-text errors include "Invalid email address." and "Email does not exist.".
   * @route POST /unsubscribe
   * @paramDef {"type":"String","label":"List ID","name":"list","required":true,"description":"The Sendy list ID to unsubscribe the person from."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Email address of the subscriber to unsubscribe."}
   * @returns {String}
   * @sampleResult "true"
   */
  async unsubscribe(list, email) {
    const logTag = '[unsubscribe]'

    return await this.#apiRequest({
      logTag,
      path: '/unsubscribe',
      body: clean({
        list,
        email,
        boolean: 'true',
      }),
    })
  }

  /**
   * @operationName Delete Subscriber
   * @category Subscribers
   * @description Permanently deletes a subscriber from a Sendy list. Unlike unsubscribing, this removes the subscriber record entirely. Returns the plain-text string "true" on success. Common plain-text errors include "List does not exist" and "Subscriber does not exist".
   * @route POST /api/subscribers/delete.php
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"description":"The Sendy list ID the subscriber belongs to."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Email address of the subscriber to delete."}
   * @returns {String}
   * @sampleResult "true"
   */
  async deleteSubscriber(listId, email) {
    const logTag = '[deleteSubscriber]'

    return await this.#apiRequest({
      logTag,
      path: '/api/subscribers/delete.php',
      body: clean({
        list_id: listId,
        email,
      }),
    })
  }

  /**
   * @operationName Get Subscription Status
   * @category Subscribers
   * @description Returns the subscription status of an email address on a Sendy list as a plain-text string. Possible statuses are "Subscribed", "Unsubscribed", "Unconfirmed", "Bounced", "Soft bounced", and "Complained". Common plain-text errors include "Email does not exist in list".
   * @route POST /api/subscribers/subscription-status.php
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"description":"The Sendy list ID to check the status against."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Email address of the subscriber to check."}
   * @returns {String}
   * @sampleResult "Subscribed"
   */
  async getSubscriptionStatus(listId, email) {
    const logTag = '[getSubscriptionStatus]'

    return await this.#apiRequest({
      logTag,
      path: '/api/subscribers/subscription-status.php',
      body: clean({
        list_id: listId,
        email,
      }),
    })
  }

  /**
   * @operationName Get Active Subscriber Count
   * @category Subscribers
   * @description Returns the number of active (subscribed) subscribers on a Sendy list as a plain-text integer string. Common plain-text errors include "List ID not passed" and "List does not exist".
   * @route POST /api/subscribers/active-subscriber-count.php
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"description":"The Sendy list ID to count active subscribers for."}
   * @returns {String}
   * @sampleResult "1543"
   */
  async getActiveSubscriberCount(listId) {
    const logTag = '[getActiveSubscriberCount]'

    return await this.#apiRequest({
      logTag,
      path: '/api/subscribers/active-subscriber-count.php',
      body: clean({
        list_id: listId,
      }),
    })
  }

  /**
   * @operationName Create Campaign
   * @category Campaigns
   * @description Creates a campaign in Sendy as a draft, or optionally sends it immediately when Send Campaign is set to 1 and list IDs are provided. Requires from name, from email, reply-to, subject, and HTML content. Returns a plain-text confirmation such as "Campaign created" or "Campaign created and now sending". Common plain-text errors include "List or segment ID(s) not passed", "One or more list IDs are invalid", and "Unable to create campaign".
   * @route POST /api/campaigns/create.php
   * @paramDef {"type":"String","label":"From Name","name":"fromName","required":true,"description":"The name the campaign is sent from."}
   * @paramDef {"type":"String","label":"From Email","name":"fromEmail","required":true,"description":"The email address the campaign is sent from."}
   * @paramDef {"type":"String","label":"Reply To","name":"replyTo","required":true,"description":"The reply-to email address for the campaign."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"The subject line of the campaign email."}
   * @paramDef {"type":"String","label":"HTML Content","name":"htmlText","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The HTML body of the campaign email."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Internal title of the campaign. Defaults to the subject if omitted."}
   * @paramDef {"type":"String","label":"Plain Text Content","name":"plainText","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional plain-text alternative body of the campaign email."}
   * @paramDef {"type":"String","label":"List IDs","name":"listIds","description":"Comma-separated list IDs to send to. Required when Send Campaign is set to Yes."}
   * @paramDef {"type":"String","label":"Segment IDs","name":"segmentIds","description":"Comma-separated segment IDs to send to. Can be used instead of, or together with, list IDs."}
   * @paramDef {"type":"String","label":"Brand ID","name":"brandId","description":"The brand ID to create the campaign under. Required when only creating a draft (not sending)."}
   * @paramDef {"type":"String","label":"Query String","name":"queryString","description":"Optional tracking query string appended to links, e.g. utm_source=sendy."}
   * @paramDef {"type":"Boolean","label":"Send Campaign","name":"sendCampaign","uiComponent":{"type":"CHECKBOX"},"description":"Set to true (Yes) to send the campaign immediately after creation. When false, the campaign is only created as a draft."}
   * @returns {String}
   * @sampleResult "Campaign created"
   */
  async createCampaign(fromName, fromEmail, replyTo, subject, htmlText, title, plainText, listIds, segmentIds, brandId, queryString, sendCampaign) {
    const logTag = '[createCampaign]'

    return await this.#apiRequest({
      logTag,
      path: '/api/campaigns/create.php',
      body: clean({
        from_name: fromName,
        from_email: fromEmail,
        reply_to: replyTo,
        subject,
        html_text: htmlText,
        title,
        plain_text: plainText,
        list_ids: listIds,
        segment_ids: segmentIds,
        brand_id: brandId,
        query_string: queryString,
        send_campaign: sendCampaign === true || sendCampaign === 'true' || sendCampaign === 1 || sendCampaign === '1' ? '1' : '0',
      }),
    })
  }

  /**
   * @operationName Get Brands
   * @category Brands
   * @description Retrieves the list of brands configured in your Sendy installation. On success Sendy returns a JSON string of brands with their IDs and names, which is returned here as raw text. Returns the plain-text error "No brands found" when no brands exist, or "Invalid API key" for an invalid key.
   * @route POST /api/brands/get-brands.php
   * @returns {String}
   * @sampleResult "[{\"id\":\"1\",\"name\":\"My Brand\"}]"
   */
  async getBrands() {
    const logTag = '[getBrands]'

    return await this.#apiRequest({
      logTag,
      path: '/api/brands/get-brands.php',
      body: {},
    })
  }
}

Flowrunner.ServerCode.addService(SendyService, [
  {
    name: 'url',
    displayName: 'Installation URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Sendy installation URL, e.g. https://sendy.example.com (strip any trailing slash).',
  },
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Sendy API key. Find it in Sendy under Settings → your API key.',
  },
])
