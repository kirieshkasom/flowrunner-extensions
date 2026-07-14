const logger = {
  info: (...args) => console.log('[Mailgun] info:', ...args),
  debug: (...args) => console.log('[Mailgun] debug:', ...args),
  error: (...args) => console.log('[Mailgun] error:', ...args),
  warn: (...args) => console.log('[Mailgun] warn:', ...args),
}

const API_HOSTS = {
  US: 'https://api.mailgun.net',
  EU: 'https://api.eu.mailgun.net',
}

const DEFAULT_PAGE_LIMIT = 100
const DICTIONARY_PAGE_LIMIT = 100

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
 * @integrationName Mailgun
 * @integrationIcon /icon.png
 * @usesFileStorage
 */
class MailgunService {
  constructor(config) {
    this.apiKey = config.apiKey
    this.baseUrl = API_HOSTS[config.region] || API_HOSTS.US
    this.authHeader = `Basic ${ Buffer.from(`api:${ config.apiKey }`).toString('base64') }`
  }

  // ==========================================================================
  //  PRIVATE HELPERS
  // ==========================================================================

  /**
   * Single request helper. `url` may be a path (prefixed with the regional base URL)
   * or an absolute URL (used for Mailgun paging links). `form` is a plain object turned
   * into multipart form data; array values are appended once per element, and
   * { buffer, filename } values become file parts.
   */
  async #apiRequest({ url, method = 'get', form, query, logTag }) {
    const fullUrl = url.startsWith('http') ? url : `${ this.baseUrl }${ url }`

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ fullUrl }]`)

      const request = Flowrunner.Request[method.toLowerCase()](fullUrl)
        .set({ Authorization: this.authHeader })
        .query(clean(query) || {})

      if (form !== undefined) {
        const formData = new Flowrunner.Request.FormData()

        for (const [key, value] of Object.entries(form)) {
          if (value === undefined || value === null || value === '') {
            continue
          }

          if (Array.isArray(value)) {
            value.forEach(item => formData.append(key, String(item)))
          } else if (typeof value === 'object' && Buffer.isBuffer(value.buffer)) {
            formData.append(key, value.buffer, { filename: value.filename })
          } else {
            formData.append(key, String(value))
          }
        }

        // No explicit Content-Type — the form sets the multipart boundary automatically.
        return await request.form(formData)
      }

      return await request
    } catch (error) {
      const message = error.body?.message || error.body?.Error ||
        (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))

      logger.error(`${ logTag } - request failed: ${ message }`)

      throw new Error(`Mailgun API error: ${ message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /** Converts an ISO 8601 string, epoch seconds, or epoch milliseconds to RFC 2822 (UTC). */
  #toRfc2822(value) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    const num = Number(value)
    const date = Number.isNaN(num)
      ? new Date(value)
      : new Date(num > 1e12 ? num : num * 1000)

    if (Number.isNaN(date.getTime())) {
      throw new Error(`Mailgun API error: invalid delivery time value "${ value }"`)
    }

    return date.toUTCString()
  }

  /** Converts an ISO 8601 string, RFC 2822 string, or epoch value to epoch seconds. */
  #toEpochSeconds(value) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    const num = Number(value)

    if (!Number.isNaN(num)) {
      return num > 1e12 ? Math.floor(num / 1000) : Math.floor(num)
    }

    const parsed = Date.parse(value)

    if (Number.isNaN(parsed)) {
      throw new Error(`Mailgun API error: invalid timestamp value "${ value }"`)
    }

    return Math.floor(parsed / 1000)
  }

  #fileNameFromUrl(url, index) {
    try {
      const name = decodeURIComponent(String(url).split('/').pop().split('?')[0])

      return name || `attachment_${ index + 1 }`
    } catch (error) {
      return `attachment_${ index + 1 }`
    }
  }

  async #downloadAttachments(attachmentUrls) {
    const attachments = []

    for (const [index, fileUrl] of (attachmentUrls || []).entries()) {
      const bytes = await Flowrunner.Request.get(fileUrl).setEncoding(null)

      attachments.push({
        buffer: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes),
        filename: this.#fileNameFromUrl(fileUrl, index),
      })
    }

    return attachments
  }

  /** Builds the shared message form fields used by both send operations. */
  #buildMessageForm({ from, to, cc, bcc, subject, replyTo, tags, deliveryTime, testMode }) {
    const form = clean({
      from,
      to,
      cc,
      bcc,
      subject,
      'h:Reply-To': replyTo,
      'o:deliverytime': this.#toRfc2822(deliveryTime),
    })

    if (Array.isArray(tags) && tags.length > 0) {
      form['o:tag'] = tags
    }

    if (testMode === true) {
      form['o:testmode'] = 'yes'
    }

    return form
  }

  // ==========================================================================
  //  MESSAGES
  // ==========================================================================

  /**
   * @operationName Send Email
   * @category Messages
   * @description Sends an email through a Mailgun sending domain. Supports plain text and/or HTML bodies, CC/BCC, Reply-To, file attachments from FlowRunner storage, tags for analytics, scheduled delivery (up to 3 days ahead on most plans), Mailgun test mode, and per-message click/open tracking overrides. Provide at least one of Text Body or HTML Body. Returns the queued Mailgun message ID.
   * @route POST /send-email
   * @paramDef {"type":"String","label":"Domain","name":"domain","required":true,"dictionary":"getDomainsDictionary","description":"Mailgun sending domain to send from (e.g. mg.example.com)."}
   * @paramDef {"type":"String","label":"From","name":"from","required":true,"description":"Sender address, e.g. \"Support <support@mg.example.com>\" or support@mg.example.com. Must belong to the selected domain."}
   * @paramDef {"type":"String","label":"To","name":"to","required":true,"description":"Recipient address(es). Separate multiple recipients with commas."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Email subject line."}
   * @paramDef {"type":"String","label":"Text Body","name":"text","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Plain-text body. Provide this, HTML Body, or both."}
   * @paramDef {"type":"String","label":"HTML Body","name":"html","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"HTML body. Provide this, Text Body, or both."}
   * @paramDef {"type":"String","label":"CC","name":"cc","description":"CC address(es), comma-separated."}
   * @paramDef {"type":"String","label":"BCC","name":"bcc","description":"BCC address(es), comma-separated."}
   * @paramDef {"type":"String","label":"Reply-To","name":"replyTo","description":"Address that replies should go to (sets the Reply-To header)."}
   * @paramDef {"type":"Array<String>","label":"Attachment URLs","name":"attachmentUrls","description":"URLs of files to attach (e.g. FlowRunner file URLs). Each file is downloaded and attached with its original file name."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags to attach to the message for Mailgun analytics (max 10, e.g. welcome-flow)."}
   * @paramDef {"type":"String","label":"Delivery Time","name":"deliveryTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Schedule delivery for a future time. Accepts a date-time or timestamp; converted to the RFC 2822 format Mailgun requires."}
   * @paramDef {"type":"Boolean","label":"Test Mode","name":"testMode","uiComponent":{"type":"TOGGLE"},"description":"When enabled, Mailgun accepts the message but does not deliver it (o:testmode). Useful for testing flows without sending real email."}
   * @paramDef {"type":"Boolean","label":"Track Clicks","name":"trackingClicks","uiComponent":{"type":"TOGGLE"},"description":"Override the domain's click-tracking setting for this message. Leave untouched to use the domain default."}
   * @paramDef {"type":"Boolean","label":"Track Opens","name":"trackingOpens","uiComponent":{"type":"TOGGLE"},"description":"Override the domain's open-tracking setting for this message. Leave untouched to use the domain default."}
   * @returns {Object}
   * @sampleResult {"id":"<20260115120000.1.6F2A54E12345ABCD@mg.example.com>","message":"Queued. Thank you."}
   */
  async sendEmail(domain, from, to, subject, text, html, cc, bcc, replyTo, attachmentUrls, tags, deliveryTime, testMode, trackingClicks, trackingOpens) {
    const form = this.#buildMessageForm({ from, to, cc, bcc, subject, replyTo, tags, deliveryTime, testMode })

    if (text) {
      form.text = text
    }

    if (html) {
      form.html = html
    }

    if (typeof trackingClicks === 'boolean') {
      form['o:tracking-clicks'] = trackingClicks ? 'yes' : 'no'
    }

    if (typeof trackingOpens === 'boolean') {
      form['o:tracking-opens'] = trackingOpens ? 'yes' : 'no'
    }

    const attachments = await this.#downloadAttachments(attachmentUrls)

    attachments.forEach((attachment, index) => {
      form[`__attachment_${ index }`] = attachment
    })

    return await this.#sendForm(domain, form, '[sendEmail]')
  }

  /**
   * @operationName Send Templated Email
   * @category Messages
   * @description Sends an email using a stored Mailgun template. Template variables are passed as a JSON object via the X-Mailgun-Variables header and substituted into the template's handlebars placeholders. Supports CC/BCC, Reply-To, tags, scheduled delivery, and test mode.
   * @route POST /send-templated-email
   * @paramDef {"type":"String","label":"Domain","name":"domain","required":true,"dictionary":"getDomainsDictionary","description":"Mailgun sending domain that owns the template (e.g. mg.example.com)."}
   * @paramDef {"type":"String","label":"Template","name":"template","required":true,"description":"Name of a template stored in the Mailgun domain (Sending > Templates)."}
   * @paramDef {"type":"String","label":"From","name":"from","required":true,"description":"Sender address, e.g. \"Support <support@mg.example.com>\". Must belong to the selected domain."}
   * @paramDef {"type":"String","label":"To","name":"to","required":true,"description":"Recipient address(es). Separate multiple recipients with commas."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Email subject line."}
   * @paramDef {"type":"Object","label":"Template Variables","name":"templateVariables","description":"JSON object of variables substituted into the template, e.g. {\"firstName\":\"Ada\",\"plan\":\"Pro\"}."}
   * @paramDef {"type":"String","label":"CC","name":"cc","description":"CC address(es), comma-separated."}
   * @paramDef {"type":"String","label":"BCC","name":"bcc","description":"BCC address(es), comma-separated."}
   * @paramDef {"type":"String","label":"Reply-To","name":"replyTo","description":"Address that replies should go to (sets the Reply-To header)."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags to attach to the message for Mailgun analytics (max 10)."}
   * @paramDef {"type":"String","label":"Delivery Time","name":"deliveryTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Schedule delivery for a future time. Accepts a date-time or timestamp; converted to the RFC 2822 format Mailgun requires."}
   * @paramDef {"type":"Boolean","label":"Test Mode","name":"testMode","uiComponent":{"type":"TOGGLE"},"description":"When enabled, Mailgun accepts the message but does not deliver it (o:testmode)."}
   * @returns {Object}
   * @sampleResult {"id":"<20260115120000.1.6F2A54E12345ABCD@mg.example.com>","message":"Queued. Thank you."}
   */
  async sendTemplatedEmail(domain, template, from, to, subject, templateVariables, cc, bcc, replyTo, tags, deliveryTime, testMode) {
    const form = this.#buildMessageForm({ from, to, cc, bcc, subject, replyTo, tags, deliveryTime, testMode })

    form.template = template

    if (templateVariables && Object.keys(templateVariables).length > 0) {
      form['h:X-Mailgun-Variables'] = JSON.stringify(templateVariables)
    }

    return await this.#sendForm(domain, form, '[sendTemplatedEmail]')
  }

  /**
   * Sends a message form to /v3/{domain}/messages. Keys prefixed with `__attachment_`
   * carry { buffer, filename } file parts and are appended as `attachment` fields.
   */
  async #sendForm(domain, form, logTag) {
    const url = `${ this.baseUrl }/v3/${ encodeURIComponent(domain) }/messages`

    try {
      logger.debug(`${ logTag } - [POST::${ url }]`)

      const formData = new Flowrunner.Request.FormData()

      for (const [key, value] of Object.entries(form)) {
        if (value === undefined || value === null || value === '') {
          continue
        }

        if (key.startsWith('__attachment_')) {
          formData.append('attachment', value.buffer, { filename: value.filename })
        } else if (Array.isArray(value)) {
          value.forEach(item => formData.append(key, String(item)))
        } else {
          formData.append(key, String(value))
        }
      }

      // No explicit Content-Type — the form sets the multipart boundary automatically.
      return await Flowrunner.Request.post(url)
        .set({ Authorization: this.authHeader })
        .form(formData)
    } catch (error) {
      const message = error.body?.message || error.body?.Error ||
        (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))

      logger.error(`${ logTag } - request failed: ${ message }`)

      throw new Error(`Mailgun API error: ${ message }`)
    }
  }

  // ==========================================================================
  //  EVENTS
  // ==========================================================================

  /**
   * @operationName Get Events
   * @category Events
   * @description Retrieves message events (accepted, delivered, failed, opened, clicked, unsubscribed, complained, stored) for a domain from the Mailgun event log. Supports filtering by event type, recipient, and time range. Mailgun retains events for a limited window (typically 1-30 days depending on plan). Returns event items plus paging URLs for retrieving further pages.
   * @route GET /get-events
   * @paramDef {"type":"String","label":"Domain","name":"domain","required":true,"dictionary":"getDomainsDictionary","description":"Mailgun domain whose event log to query."}
   * @paramDef {"type":"String","label":"Event Type","name":"eventType","uiComponent":{"type":"DROPDOWN","options":{"values":["Accepted","Delivered","Failed","Opened","Clicked","Unsubscribed","Complained","Stored"]}},"description":"Only return events of this type. Leave empty for all event types."}
   * @paramDef {"type":"String","label":"Recipient","name":"recipient","description":"Only return events for this recipient email address."}
   * @paramDef {"type":"String","label":"Begin Time","name":"beginTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start of the time range. Accepts a date-time or timestamp."}
   * @paramDef {"type":"String","label":"End Time","name":"endTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"End of the time range. Accepts a date-time or timestamp."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of events to return (1-300, default 100)."}
   * @returns {Object}
   * @sampleResult {"items":[{"event":"delivered","timestamp":1768476000.123,"recipient":"user@example.com","message":{"headers":{"message-id":"20260115120000.1.6F2A54E12345ABCD@mg.example.com","subject":"Welcome!"}},"tags":["welcome-flow"]}],"paging":{"next":"https://api.mailgun.net/v3/mg.example.com/events/W3siYSI6...","previous":"https://api.mailgun.net/v3/mg.example.com/events/W3siYiI6..."}}
   */
  async getEvents(domain, eventType, recipient, beginTime, endTime, limit) {
    const begin = this.#toEpochSeconds(beginTime)

    return await this.#apiRequest({
      logTag: '[getEvents]',
      url: `/v3/${ encodeURIComponent(domain) }/events`,
      query: {
        event: this.#resolveChoice(eventType, {
          'Accepted': 'accepted',
          'Delivered': 'delivered',
          'Failed': 'failed',
          'Opened': 'opened',
          'Clicked': 'clicked',
          'Unsubscribed': 'unsubscribed',
          'Complained': 'complained',
          'Stored': 'stored',
        }),
        recipient,
        begin,
        end: this.#toEpochSeconds(endTime),
        // When only a begin time is given, Mailgun requires an explicit traversal direction.
        ascending: begin !== undefined && this.#toEpochSeconds(endTime) === undefined ? 'yes' : undefined,
        limit: limit || DEFAULT_PAGE_LIMIT,
      },
    })
  }

  // ==========================================================================
  //  EMAIL VALIDATION
  // ==========================================================================

  /**
   * @operationName Validate Email Address
   * @category Email Validation
   * @description Validates a single email address using Mailgun's email validation service (v4). Returns a deliverability result (deliverable, undeliverable, do_not_send, catch_all, unknown), a risk rating (low, medium, high, unknown), the reasons behind the assessment, and flags for disposable and role-based addresses. Requires a Mailgun plan that includes email validations.
   * @route GET /validate-email-address
   * @paramDef {"type":"String","label":"Email Address","name":"address","required":true,"description":"The email address to validate, e.g. user@example.com."}
   * @returns {Object}
   * @sampleResult {"address":"user@example.com","is_disposable_address":false,"is_role_address":false,"reason":[],"result":"deliverable","risk":"low"}
   */
  async validateEmailAddress(address) {
    return await this.#apiRequest({
      logTag: '[validateEmailAddress]',
      url: '/v4/address/validate',
      query: { address },
    })
  }

  // ==========================================================================
  //  MAILING LISTS
  // ==========================================================================

  /**
   * @operationName Create Mailing List
   * @category Mailing Lists
   * @description Creates a new Mailgun mailing list. A mailing list is identified by its own email address (e.g. news@mg.example.com); sending a message to that address distributes it to all subscribed members. Access level controls who may post to the list.
   * @route POST /create-mailing-list
   * @paramDef {"type":"String","label":"List Address","name":"address","required":true,"description":"Email address for the new mailing list, e.g. news@mg.example.com. Must use one of your Mailgun domains."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Display name of the mailing list."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Short description of the mailing list."}
   * @paramDef {"type":"String","label":"Access Level","name":"accessLevel","defaultValue":"Read Only","uiComponent":{"type":"DROPDOWN","options":{"values":["Read Only","Members","Everyone"]}},"description":"Who may post to the list: Read Only (only authenticated API calls), Members (list members), or Everyone."}
   * @returns {Object}
   * @sampleResult {"list":{"address":"news@mg.example.com","name":"Newsletter","description":"Monthly product news","access_level":"readonly","reply_preference":"list","created_at":"Thu, 15 Jan 2026 12:00:00 -0000","members_count":0},"message":"Mailing list has been created"}
   */
  async createMailingList(address, name, description, accessLevel) {
    return await this.#apiRequest({
      logTag: '[createMailingList]',
      url: '/v3/lists',
      method: 'post',
      form: clean({
        address,
        name,
        description,
        access_level: this.#resolveChoice(accessLevel, {
          'Read Only': 'readonly',
          'Members': 'members',
          'Everyone': 'everyone',
        }),
      }),
    })
  }

  /**
   * @operationName List Mailing Lists
   * @category Mailing Lists
   * @description Retrieves the mailing lists in your Mailgun account, including each list's address, name, description, access level, and member count. Returns items plus paging URLs for retrieving further pages.
   * @route GET /list-mailing-lists
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of lists to return (default 100)."}
   * @returns {Object}
   * @sampleResult {"items":[{"address":"news@mg.example.com","name":"Newsletter","description":"Monthly product news","access_level":"readonly","reply_preference":"list","created_at":"Thu, 15 Jan 2026 12:00:00 -0000","members_count":42}],"paging":{"first":"https://api.mailgun.net/v3/lists/pages?limit=100","next":"https://api.mailgun.net/v3/lists/pages?limit=100&page=next&address=news@mg.example.com"}}
   */
  async listMailingLists(limit) {
    return await this.#apiRequest({
      logTag: '[listMailingLists]',
      url: '/v3/lists/pages',
      query: { limit: limit || DEFAULT_PAGE_LIMIT },
    })
  }

  /**
   * @operationName Get Mailing List
   * @category Mailing Lists
   * @description Retrieves a single mailing list's details by its address, including name, description, access level, and current member count.
   * @route GET /get-mailing-list
   * @paramDef {"type":"String","label":"Mailing List","name":"listAddress","required":true,"dictionary":"getMailingListsDictionary","description":"Address of the mailing list, e.g. news@mg.example.com."}
   * @returns {Object}
   * @sampleResult {"list":{"address":"news@mg.example.com","name":"Newsletter","description":"Monthly product news","access_level":"readonly","reply_preference":"list","created_at":"Thu, 15 Jan 2026 12:00:00 -0000","members_count":42}}
   */
  async getMailingList(listAddress) {
    return await this.#apiRequest({
      logTag: '[getMailingList]',
      url: `/v3/lists/${ encodeURIComponent(listAddress) }`,
    })
  }

  /**
   * @operationName Delete Mailing List
   * @category Mailing Lists
   * @description Permanently deletes a mailing list and all of its members. This cannot be undone.
   * @route DELETE /delete-mailing-list
   * @paramDef {"type":"String","label":"Mailing List","name":"listAddress","required":true,"dictionary":"getMailingListsDictionary","description":"Address of the mailing list to delete, e.g. news@mg.example.com."}
   * @returns {Object}
   * @sampleResult {"address":"news@mg.example.com","message":"Mailing list has been removed"}
   */
  async deleteMailingList(listAddress) {
    return await this.#apiRequest({
      logTag: '[deleteMailingList]',
      url: `/v3/lists/${ encodeURIComponent(listAddress) }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Add List Member
   * @category Mailing Lists
   * @description Adds a member to a mailing list, optionally with a display name, custom JSON variables (usable for template personalization), and an initial subscription state. Enable Upsert to update the member instead of failing if the address already exists on the list.
   * @route POST /add-list-member
   * @paramDef {"type":"String","label":"Mailing List","name":"listAddress","required":true,"dictionary":"getMailingListsDictionary","description":"Address of the mailing list to add the member to."}
   * @paramDef {"type":"String","label":"Member Address","name":"memberAddress","required":true,"description":"Email address of the member to add."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Display name of the member."}
   * @paramDef {"type":"Object","label":"Variables","name":"vars","description":"Custom JSON variables stored with the member, e.g. {\"city\":\"Austin\",\"plan\":\"Pro\"}."}
   * @paramDef {"type":"Boolean","label":"Subscribed","name":"subscribed","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"Whether the member starts out subscribed. Unsubscribed members remain on the list but do not receive messages."}
   * @paramDef {"type":"Boolean","label":"Upsert","name":"upsert","uiComponent":{"type":"TOGGLE"},"description":"When enabled, updates the member if the address already exists instead of returning an error."}
   * @returns {Object}
   * @sampleResult {"member":{"address":"user@example.com","name":"Ada Lovelace","subscribed":true,"vars":{"city":"Austin"}},"message":"Mailing list member has been created"}
   */
  async addListMember(listAddress, memberAddress, name, vars, subscribed, upsert) {
    const form = clean({
      address: memberAddress,
      name,
      vars: vars && Object.keys(vars).length > 0 ? JSON.stringify(vars) : undefined,
    })

    if (typeof subscribed === 'boolean') {
      form.subscribed = subscribed ? 'yes' : 'no'
    }

    if (upsert === true) {
      form.upsert = 'yes'
    }

    return await this.#apiRequest({
      logTag: '[addListMember]',
      url: `/v3/lists/${ encodeURIComponent(listAddress) }/members`,
      method: 'post',
      form,
    })
  }

  /**
   * @operationName List Members
   * @category Mailing Lists
   * @description Retrieves the members of a mailing list, including each member's address, name, subscription state, and custom variables. Optionally filter by subscription status. Returns items plus paging URLs for retrieving further pages.
   * @route GET /list-members
   * @paramDef {"type":"String","label":"Mailing List","name":"listAddress","required":true,"dictionary":"getMailingListsDictionary","description":"Address of the mailing list whose members to retrieve."}
   * @paramDef {"type":"String","label":"Subscription Status","name":"subscriptionStatus","uiComponent":{"type":"DROPDOWN","options":{"values":["Subscribed","Unsubscribed"]}},"description":"Only return members with this subscription state. Leave empty for all members."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of members to return (default 100)."}
   * @returns {Object}
   * @sampleResult {"items":[{"address":"user@example.com","name":"Ada Lovelace","subscribed":true,"vars":{"city":"Austin"}}],"paging":{"first":"https://api.mailgun.net/v3/lists/news@mg.example.com/members/pages?limit=100","next":"https://api.mailgun.net/v3/lists/news@mg.example.com/members/pages?limit=100&page=next&address=user@example.com"}}
   */
  async listMembers(listAddress, subscriptionStatus, limit) {
    return await this.#apiRequest({
      logTag: '[listMembers]',
      url: `/v3/lists/${ encodeURIComponent(listAddress) }/members/pages`,
      query: {
        subscribed: this.#resolveChoice(subscriptionStatus, {
          'Subscribed': 'yes',
          'Unsubscribed': 'no',
        }),
        limit: limit || DEFAULT_PAGE_LIMIT,
      },
    })
  }

  /**
   * @operationName Delete List Member
   * @category Mailing Lists
   * @description Removes a member from a mailing list by email address. The member's data (name, variables) is deleted along with the membership.
   * @route DELETE /delete-list-member
   * @paramDef {"type":"String","label":"Mailing List","name":"listAddress","required":true,"dictionary":"getMailingListsDictionary","description":"Address of the mailing list to remove the member from."}
   * @paramDef {"type":"String","label":"Member Address","name":"memberAddress","required":true,"description":"Email address of the member to remove."}
   * @returns {Object}
   * @sampleResult {"member":{"address":"user@example.com"},"message":"Mailing list member has been deleted"}
   */
  async deleteListMember(listAddress, memberAddress) {
    return await this.#apiRequest({
      logTag: '[deleteListMember]',
      url: `/v3/lists/${ encodeURIComponent(listAddress) }/members/${ encodeURIComponent(memberAddress) }`,
      method: 'delete',
    })
  }

  // ==========================================================================
  //  SUPPRESSIONS
  // ==========================================================================

  /**
   * @operationName List Bounces
   * @category Suppressions
   * @description Retrieves the bounce suppression list for a domain — addresses that hard-bounced and are automatically blocked from future sending. Each entry includes the address, SMTP error code, error text, and when the bounce was recorded.
   * @route GET /list-bounces
   * @paramDef {"type":"String","label":"Domain","name":"domain","required":true,"dictionary":"getDomainsDictionary","description":"Mailgun domain whose bounce list to retrieve."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of bounces to return (default 100, max 10000)."}
   * @returns {Object}
   * @sampleResult {"items":[{"address":"bounced@example.com","code":"550","error":"550 5.1.1 The email account does not exist","created_at":"Thu, 15 Jan 2026 12:00:00 UTC"}],"paging":{"first":"https://api.mailgun.net/v3/mg.example.com/bounces?limit=100","next":"https://api.mailgun.net/v3/mg.example.com/bounces?limit=100&page=next&address=bounced@example.com"}}
   */
  async listBounces(domain, limit) {
    return await this.#apiRequest({
      logTag: '[listBounces]',
      url: `/v3/${ encodeURIComponent(domain) }/bounces`,
      query: { limit: limit || DEFAULT_PAGE_LIMIT },
    })
  }

  /**
   * @operationName Delete Bounce
   * @category Suppressions
   * @description Removes an address from a domain's bounce suppression list so Mailgun will attempt delivery to it again. Use this after a previously bouncing mailbox has been fixed.
   * @route DELETE /delete-bounce
   * @paramDef {"type":"String","label":"Domain","name":"domain","required":true,"dictionary":"getDomainsDictionary","description":"Mailgun domain whose bounce list to modify."}
   * @paramDef {"type":"String","label":"Address","name":"address","required":true,"description":"Email address to remove from the bounce list."}
   * @returns {Object}
   * @sampleResult {"address":"bounced@example.com","message":"Bounced address has been removed"}
   */
  async deleteBounce(domain, address) {
    return await this.#apiRequest({
      logTag: '[deleteBounce]',
      url: `/v3/${ encodeURIComponent(domain) }/bounces/${ encodeURIComponent(address) }`,
      method: 'delete',
    })
  }

  /**
   * @operationName List Unsubscribes
   * @category Suppressions
   * @description Retrieves the unsubscribe suppression list for a domain — addresses that opted out and are blocked from future sending (optionally per tag). Each entry includes the address, tags it unsubscribed from, and when it was recorded.
   * @route GET /list-unsubscribes
   * @paramDef {"type":"String","label":"Domain","name":"domain","required":true,"dictionary":"getDomainsDictionary","description":"Mailgun domain whose unsubscribe list to retrieve."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of unsubscribes to return (default 100, max 10000)."}
   * @returns {Object}
   * @sampleResult {"items":[{"address":"user@example.com","tags":["*"],"created_at":"Thu, 15 Jan 2026 12:00:00 UTC"}],"paging":{"first":"https://api.mailgun.net/v3/mg.example.com/unsubscribes?limit=100","next":"https://api.mailgun.net/v3/mg.example.com/unsubscribes?limit=100&page=next&address=user@example.com"}}
   */
  async listUnsubscribes(domain, limit) {
    return await this.#apiRequest({
      logTag: '[listUnsubscribes]',
      url: `/v3/${ encodeURIComponent(domain) }/unsubscribes`,
      query: { limit: limit || DEFAULT_PAGE_LIMIT },
    })
  }

  /**
   * @operationName Add Unsubscribe
   * @category Suppressions
   * @description Adds an address to a domain's unsubscribe suppression list, blocking future messages to it. Optionally scope the unsubscribe to a single tag; leave the tag empty (or use *) to unsubscribe from all messages.
   * @route POST /add-unsubscribe
   * @paramDef {"type":"String","label":"Domain","name":"domain","required":true,"dictionary":"getDomainsDictionary","description":"Mailgun domain whose unsubscribe list to add to."}
   * @paramDef {"type":"String","label":"Address","name":"address","required":true,"description":"Email address to unsubscribe."}
   * @paramDef {"type":"String","label":"Tag","name":"tag","description":"Unsubscribe from messages with this tag only. Leave empty to unsubscribe from all messages (*)."}
   * @returns {Object}
   * @sampleResult {"message":"Address has been added to the unsubscribes table","address":"user@example.com"}
   */
  async addUnsubscribe(domain, address, tag) {
    return await this.#apiRequest({
      logTag: '[addUnsubscribe]',
      url: `/v3/${ encodeURIComponent(domain) }/unsubscribes`,
      method: 'post',
      form: clean({ address, tag }),
    })
  }

  /**
   * @operationName Delete Unsubscribe
   * @category Suppressions
   * @description Removes an address from a domain's unsubscribe suppression list so it can receive messages again. Use with care — re-mailing users who opted out may violate anti-spam regulations.
   * @route DELETE /delete-unsubscribe
   * @paramDef {"type":"String","label":"Domain","name":"domain","required":true,"dictionary":"getDomainsDictionary","description":"Mailgun domain whose unsubscribe list to modify."}
   * @paramDef {"type":"String","label":"Address","name":"address","required":true,"description":"Email address to remove from the unsubscribe list."}
   * @returns {Object}
   * @sampleResult {"address":"user@example.com","message":"Unsubscribe event has been removed"}
   */
  async deleteUnsubscribe(domain, address) {
    return await this.#apiRequest({
      logTag: '[deleteUnsubscribe]',
      url: `/v3/${ encodeURIComponent(domain) }/unsubscribes/${ encodeURIComponent(address) }`,
      method: 'delete',
    })
  }

  /**
   * @operationName List Complaints
   * @category Suppressions
   * @description Retrieves the complaint suppression list for a domain — addresses that marked your messages as spam and are blocked from future sending. Each entry includes the address and when the complaint was recorded.
   * @route GET /list-complaints
   * @paramDef {"type":"String","label":"Domain","name":"domain","required":true,"dictionary":"getDomainsDictionary","description":"Mailgun domain whose complaint list to retrieve."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of complaints to return (default 100, max 10000)."}
   * @returns {Object}
   * @sampleResult {"items":[{"address":"user@example.com","created_at":"Thu, 15 Jan 2026 12:00:00 UTC"}],"paging":{"first":"https://api.mailgun.net/v3/mg.example.com/complaints?limit=100","next":"https://api.mailgun.net/v3/mg.example.com/complaints?limit=100&page=next&address=user@example.com"}}
   */
  async listComplaints(domain, limit) {
    return await this.#apiRequest({
      logTag: '[listComplaints]',
      url: `/v3/${ encodeURIComponent(domain) }/complaints`,
      query: { limit: limit || DEFAULT_PAGE_LIMIT },
    })
  }

  // ==========================================================================
  //  STATISTICS
  // ==========================================================================

  /**
   * @operationName Get Stats
   * @category Statistics
   * @description Retrieves aggregated sending statistics for a domain from Mailgun's stats API. Select one or more event types to aggregate (accepted, delivered, failed, opened, clicked, unsubscribed, complained, stored) and either a duration (e.g. 30d, 24h, 2m) or an explicit start/end time range. Returns per-interval counts plus the overall time window.
   * @route GET /get-stats
   * @paramDef {"type":"Array<String>","label":"Events","name":"events","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Accepted","Delivered","Failed","Opened","Clicked","Unsubscribed","Complained","Stored"]}},"description":"Event types to aggregate statistics for. At least one is required."}
   * @paramDef {"type":"String","label":"Domain","name":"domain","required":true,"dictionary":"getDomainsDictionary","description":"Mailgun domain whose statistics to retrieve."}
   * @paramDef {"type":"String","label":"Duration","name":"duration","description":"Period to look back from now, as a number plus unit: h (hours), d (days), or m (months) — e.g. 24h, 30d, 2m. Ignored when Start Time is provided."}
   * @paramDef {"type":"String","label":"Start Time","name":"startTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start of an explicit time range. Accepts a date-time or timestamp. Overrides Duration."}
   * @paramDef {"type":"String","label":"End Time","name":"endTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"End of an explicit time range. Defaults to now when omitted."}
   * @returns {Object}
   * @sampleResult {"start":"Mon, 15 Dec 2025 00:00:00 UTC","end":"Thu, 15 Jan 2026 00:00:00 UTC","resolution":"day","stats":[{"time":"Thu, 15 Jan 2026 00:00:00 UTC","accepted":{"total":120,"incoming":0,"outgoing":120},"delivered":{"total":118,"smtp":118,"http":0}}]}
   */
  async getStats(events, domain, duration, startTime, endTime) {
    const eventMapping = {
      'Accepted': 'accepted',
      'Delivered': 'delivered',
      'Failed': 'failed',
      'Opened': 'opened',
      'Clicked': 'clicked',
      'Unsubscribed': 'unsubscribed',
      'Complained': 'complained',
      'Stored': 'stored',
    }

    // The stats endpoint requires the event parameter repeated once per type,
    // so the query string is assembled manually.
    const params = new URLSearchParams()

    for (const event of events || []) {
      params.append('event', this.#resolveChoice(event, eventMapping))
    }

    const start = this.#toEpochSeconds(startTime)
    const end = this.#toEpochSeconds(endTime)

    if (start !== undefined) {
      params.append('start', String(start))

      if (end !== undefined) {
        params.append('end', String(end))
      }
    } else if (duration) {
      params.append('duration', duration)
    }

    return await this.#apiRequest({
      logTag: '[getStats]',
      url: `/v3/${ encodeURIComponent(domain) }/stats/total?${ params.toString() }`,
    })
  }

  // ==========================================================================
  //  DOMAINS
  // ==========================================================================

  /**
   * @operationName List Domains
   * @category Domains
   * @description Retrieves the sending domains registered in your Mailgun account, including each domain's name, state (active/unverified/disabled), type (sandbox/custom), and creation date.
   * @route GET /list-domains
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of domains to return (default 100)."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of domains to skip, for offset-based pagination (default 0)."}
   * @returns {Object}
   * @sampleResult {"total_count":2,"items":[{"name":"mg.example.com","state":"active","type":"custom","created_at":"Thu, 15 Jan 2026 12:00:00 GMT","smtp_login":"postmaster@mg.example.com","web_scheme":"https","wildcard":false}]}
   */
  async listDomains(limit, skip) {
    return await this.#apiRequest({
      logTag: '[listDomains]',
      url: '/v3/domains',
      query: {
        limit: limit || DEFAULT_PAGE_LIMIT,
        skip: skip || undefined,
      },
    })
  }

  /**
   * @operationName Get Domain
   * @category Domains
   * @description Retrieves a single domain's details, including its verification state, sending and receiving DNS records (with per-record validity), and SMTP credentials login. Useful for checking whether a domain's DNS is fully verified.
   * @route GET /get-domain
   * @paramDef {"type":"String","label":"Domain","name":"domain","required":true,"dictionary":"getDomainsDictionary","description":"The Mailgun domain to retrieve, e.g. mg.example.com."}
   * @returns {Object}
   * @sampleResult {"domain":{"name":"mg.example.com","state":"active","type":"custom","created_at":"Thu, 15 Jan 2026 12:00:00 GMT","smtp_login":"postmaster@mg.example.com","web_scheme":"https"},"receiving_dns_records":[{"record_type":"MX","priority":"10","valid":"valid","value":"mxa.mailgun.org"}],"sending_dns_records":[{"record_type":"TXT","name":"mg.example.com","valid":"valid","value":"v=spf1 include:mailgun.org ~all"}]}
   */
  async getDomain(domain) {
    return await this.#apiRequest({
      logTag: '[getDomain]',
      url: `/v3/domains/${ encodeURIComponent(domain) }`,
    })
  }

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================

  /**
   * @typedef {Object} getDomainsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text filter applied to domain names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Offset-based pagination cursor (number of domains to skip)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Domains Dictionary
   * @description Lists the account's Mailgun sending domains for selection in domain parameters. The option value is the domain name expected by the messaging, events, suppression, stats, and domain operations.
   * @route POST /get-domains-dictionary
   * @paramDef {"type":"getDomainsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for filtering domains."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"mg.example.com","value":"mg.example.com","note":"active - custom"}],"cursor":null}
   */
  async getDomainsDictionary(payload) {
    const { search, cursor } = payload || {}
    const skip = cursor ? Number(cursor) || 0 : 0

    const response = await this.#apiRequest({
      logTag: '[getDomainsDictionary]',
      url: '/v3/domains',
      query: { limit: DICTIONARY_PAGE_LIMIT, skip: skip || undefined },
    })

    const items = (response.items || [])
      .filter(domain => !search || domain.name.toLowerCase().includes(search.toLowerCase()))
      .map(domain => ({
        label: domain.name,
        value: domain.name,
        note: [domain.state, domain.type].filter(Boolean).join(' - ') || undefined,
      }))

    const fetchedCount = (response.items || []).length
    const hasMore = fetchedCount === DICTIONARY_PAGE_LIMIT && skip + fetchedCount < (response.total_count || 0)

    return {
      items,
      cursor: hasMore ? String(skip + fetchedCount) : null,
    }
  }

  /**
   * @typedef {Object} getMailingListsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text filter applied to list addresses and names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (the Mailgun next-page URL from the previous call)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Mailing Lists Dictionary
   * @description Lists the account's Mailgun mailing lists for selection in mailing-list parameters. The option value is the list address expected by the mailing list operations.
   * @route POST /get-mailing-lists-dictionary
   * @paramDef {"type":"getMailingListsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for filtering mailing lists."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Newsletter (news@mg.example.com)","value":"news@mg.example.com","note":"42 members"}],"cursor":null}
   */
  async getMailingListsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getMailingListsDictionary]',
      url: cursor || '/v3/lists/pages',
      query: cursor ? undefined : { limit: DICTIONARY_PAGE_LIMIT },
    })

    const lists = response.items || []

    const items = lists
      .filter(list => {
        if (!search) {
          return true
        }

        const term = search.toLowerCase()

        return list.address.toLowerCase().includes(term) ||
          (list.name || '').toLowerCase().includes(term)
      })
      .map(list => ({
        label: list.name ? `${ list.name } (${ list.address })` : list.address,
        value: list.address,
        note: typeof list.members_count === 'number' ? `${ list.members_count } members` : undefined,
      }))

    return {
      items,
      cursor: lists.length === DICTIONARY_PAGE_LIMIT ? response.paging?.next || null : null,
    }
  }
}

Flowrunner.ServerCode.addService(MailgunService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your private Mailgun API key. Find it in the Mailgun dashboard under Settings > API Security > Add new key (or use an existing Mailgun API key).',
  },
  {
    name: 'region',
    displayName: 'Region',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    required: true,
    shared: false,
    defaultValue: 'US',
    options: ['US', 'EU'],
    hint: 'Mailgun region hosting your account. EU accounts use api.eu.mailgun.net; US accounts use api.mailgun.net.',
  },
])
