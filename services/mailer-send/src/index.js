'use strict'

const { EmailWebhook, Attachment, EmailParams, MailerSend: MailerSendApi, Sender, Recipient } = require('mailersend')
const { buildErrorMessage, searchFilter } = require('./utils')

const logger = {
  info: (...args) => console.log('[MailerSend Service] info:', ...args),
  debug: (...args) => console.log('[MailerSend Service] debug:', ...args),
  error: (...args) => console.log('[MailerSend Service] error:', ...args),
  warn: (...args) => console.log('[MailerSend Service] warn:', ...args),
}

const EventTypes = {
  onEmailSent: 'activity.sent',
  onEmailDelivered: 'activity.delivered',
  onEmailSoftBounced: 'activity.soft_bounced',
  onEmailNotDelivered: 'activity.hard_bounced',
  onEmailOpened: 'activity.opened',
  onEmailOpenedFirst: 'activity.opened_unique',
  onLinkClicked: 'activity.clicked',
  onLinkClickedFirst: 'activity.clicked_unique',
  onRecipientUnsubscribed: 'activity.unsubscribed',
  onSpamComplaint: 'activity.spam_complaint',
}

const MethodTypes = Object.keys(EventTypes).reduce((acc, key) => ((acc[EventTypes[key]] = key), acc), {})

const MethodCallTypes = {
  SHAPE_EVENT: 'SHAPE_EVENT',
  FILTER_TRIGGER: 'FILTER_TRIGGER',
}

const UNAUTHENTICATED_ERROR = 'Please check the API key, the server is rejecting the one you provided.'

/**
 * @integrationName MailerSend
 * @integrationTriggersScope ALL_APPS
 * @integrationIcon /icon.png
 **/
class MailerSend {
  constructor(config) {
    this.apiKey = config.apiKey
    this.fromEmail = config.fromEmail
    this.fromName = config.fromName

    this.mailerSend = new MailerSendApi({ apiKey: this.apiKey })
  }

  async #getIdentityById(id) {
    if (!id) {
      return null
    }

    return this.mailerSend.email.identity
      .single(id)
      .then(response => response.body.data)
      .catch(error => {
        throw new Error(`Cannot find an identity by ID="${ id }". Error: ${ error.message }`)
      })
  }

  async #getBase64File(url) {
    try {
      const content = await Flowrunner.Request.get(url).setEncoding('base64')
      const filename = url.split('/').pop()

      return { content, filename }
    } catch (_) {
      throw new Error(`Failed to get the file from ${ url }`)
    }
  }

  #parseEmailRecipients(recipients) {
    return (Array.isArray(recipients) ? recipients : [recipients]).map(recipient =>
      typeof recipient === 'string' ? { email: recipient } : recipient
    )
  }

  async #getDomains() {
    return this.mailerSend.email.domain
      .list()
      .then(response => response.body.data)
      .catch(e => logger.error(e.body.message))
  }

  async #createWebhook(events, domainId, callbackUrl) {
    const webhook = new EmailWebhook()
      .setName('MailerSendWebhook')
      .setUrl(callbackUrl)
      .setDomainId(domainId)
      .setEnabled(true)
      .setEvents(events)

    return this.mailerSend.email.webhook
      .create(webhook)
      .then(response => response.body.data)
      .catch(e => logger.error(e.body.message))
  }

  async #deleteWebhook(webhookId) {
    return this.mailerSend.email.webhook.delete(webhookId).catch(e => logger.error(e.body.message))
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    logger.debug(`handleTriggerUpsertWebhook: ${ JSON.stringify(invocation) }`)

    const domains = await this.#getDomains()
    const domainId = domains[0]?.id
    logger.debug(`domainId: ${ domainId }`)

    const events = invocation.events.map(event => EventTypes[event.name])
    logger.debug(`events: ${ JSON.stringify(events) }`)

    const webhookData = await this.#createWebhook(events, domainId, invocation.callbackUrl)
    logger.debug(`webhookData: ${ JSON.stringify(webhookData) }`)

    return { webhookData, eventScopeId: domainId }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    logger.debug(`handleTriggerResolveEvents: ${ JSON.stringify(invocation) }`)

    const methodName = MethodTypes[invocation.body.type]
    logger.debug(`methodName: ${ methodName }`)

    if (!methodName) {
      return null
    }

    const events = await this[methodName](MethodCallTypes.SHAPE_EVENT, invocation.body)
    logger.debug(`events: ${ JSON.stringify(events) }`)

    return {
      eventScopeId: invocation.body.domain_id,
      events,
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    logger.debug(`handleTriggerSelectMatched: ${ JSON.stringify(invocation) }`)

    return this[invocation.eventName](MethodCallTypes.FILTER_TRIGGER, invocation)
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerDeleteWebhook(invocation) {
    logger.debug(`handleTriggerDeleteWebhook: ${ invocation }`)

    await this.#deleteWebhook(invocation.webhookData.id)

    return {}
  }

  /**
   * @operationName On Email Sent
   * @description Triggered when an email is sent through MailerSend.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-email-sent
   * @executionTimeoutInSeconds 120
   * @appearanceColor #1240FF #191970
   *
   */
  onEmailSent(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      logger.debug(`SHAPE_EVENT: ${ JSON.stringify(payload) }`)

      return [
        {
          name: 'onEmailSent',
          data: payload.data,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      logger.debug(`FILTER_TRIGGER: ${ JSON.stringify(payload) }`)

      const triggersToActivate = payload.triggers.map(({ id }) => id)
      logger.debug(`triggersToActivate: ${ JSON.stringify(triggersToActivate) }`)

      return { ids: triggersToActivate }
    }
  }

  /**
   * @operationName On Email Delivered
   * @description Triggered when an email is successfully delivered without errors.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-email-delivered
   * @executionTimeoutInSeconds 120
   * @appearanceColor #1240FF #191970
   *
   *
   */
  onEmailDelivered(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      logger.debug(`SHAPE_EVENT: ${ JSON.stringify(payload) }`)

      return [
        {
          name: 'onEmailDelivered',
          data: payload.data,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      logger.debug(`FILTER_TRIGGER: ${ JSON.stringify(payload) }`)

      const triggersToActivate = payload.triggers.map(({ id }) => id)
      logger.debug(`triggersToActivate: ${ JSON.stringify(triggersToActivate) }`)

      return { ids: triggersToActivate }
    }
  }

  /**
   * @operationName On Email Soft Bounced
   * @description Triggered when an email is not delivered due to a soft bounce.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-email-soft-bounced
   * @executionTimeoutInSeconds 120
   * @appearanceColor #1240FF #191970
   *
   *
   */
  onEmailSoftBounced(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      logger.debug(`SHAPE_EVENT: ${ JSON.stringify(payload) }`)

      return [
        {
          name: 'onEmailSoftBounced',
          data: payload.data,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      logger.debug(`FILTER_TRIGGER: ${ JSON.stringify(payload) }`)

      const triggersToActivate = payload.triggers.map(({ id }) => id)
      logger.debug(`triggersToActivate: ${ JSON.stringify(triggersToActivate) }`)

      return { ids: triggersToActivate }
    }
  }

  /**
   * @operationName On Email Not Delivered
   * @description Triggered when an email fails to deliver.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-email-not-delivered
   * @executionTimeoutInSeconds 120
   * @appearanceColor #1240FF #191970
   *
   *
   */
  onEmailNotDelivered(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      logger.debug(`SHAPE_EVENT: ${ JSON.stringify(payload) }`)

      return [
        {
          name: 'onEmailNotDelivered',
          data: payload.data,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      logger.debug(`FILTER_TRIGGER: ${ JSON.stringify(payload) }`)

      const triggersToActivate = payload.triggers.map(({ id }) => id)
      logger.debug(`triggersToActivate: ${ JSON.stringify(triggersToActivate) }`)

      return { ids: triggersToActivate }
    }
  }

  /**
   * @operationName On Email Opened
   * @description Triggered when a recipient opens the delivered email.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-email-opened
   * @executionTimeoutInSeconds 120
   * @appearanceColor #1240FF #191970
   *
   * @paramDef {"type":"String","label":"Recipient Email","name":"recipientEmail","required":true,"description":"Triggers only if the opened email was sent to this specific recipient address."}
   */
  onEmailOpened(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      logger.debug(`SHAPE_EVENT: ${ JSON.stringify(payload) }`)

      return [
        {
          name: 'onEmailOpened',
          data: payload.data,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      logger.debug(`FILTER_TRIGGER: ${ JSON.stringify(payload) }`)

      const triggersToActivate = payload.triggers
        .filter(({ data }) => data.recipientEmail === payload.eventData.email.recipient.email)
        .map(({ id }) => id)

      logger.debug(`triggersToActivate: ${ JSON.stringify(triggersToActivate) }`)

      return { ids: triggersToActivate }
    }
  }

  /**
   * @operationName On Email Opened First
   * @description Triggers when the recipient receives your email and opens it for the first time.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-email-opened-first
   * @executionTimeoutInSeconds 120
   * @appearanceColor #1240FF #191970
   *
   * @paramDef {"type":"String","label":"Recipient Email","name":"recipientEmail","required":true,"description":"Triggers only if the opened email was sent to this specific recipient address."}
   *
   */
  onEmailOpenedFirst(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      logger.debug(`SHAPE_EVENT: ${ JSON.stringify(payload) }`)

      return [
        {
          name: 'onEmailOpenedFirst',
          data: payload.data,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      logger.debug(`FILTER_TRIGGER: ${ JSON.stringify(payload) }`)

      const triggersToActivate = payload.triggers
        .filter(({ data }) => data.recipientEmail === payload.eventData.email.recipient.email)
        .map(({ id }) => id)

      logger.debug(`triggersToActivate: ${ JSON.stringify(triggersToActivate) }`)

      return { ids: triggersToActivate }
    }
  }

  /**
   * @operationName On Link Clicked
   * @description Triggers when the recipient clicks a link in your email.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-link-clicked
   * @executionTimeoutInSeconds 120
   * @appearanceColor #1240FF #191970
   *
   * @paramDef {"type":"String","label":"Recipient Email","name":"recipientEmail","required":true,"description":"Triggers only if the link was clicked by this specific recipient address."}
   *
   *
   */
  onLinkClicked(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      logger.debug(`SHAPE_EVENT: ${ JSON.stringify(payload) }`)

      return [
        {
          name: 'onLinkClicked',
          data: payload.data,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      logger.debug(`FILTER_TRIGGER: ${ JSON.stringify(payload) }`)

      const triggersToActivate = payload.triggers
        .filter(({ data }) => data.recipientEmail === payload.eventData.email.recipient.email)
        .map(({ id }) => id)

      logger.debug(`triggersToActivate: ${ JSON.stringify(triggersToActivate) }`)

      return { ids: triggersToActivate }
    }
  }

  /**
   * @operationName On Link Clicked First
   * @description Triggers when the recipient clicks a link in your email only for the first time.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-link-clicked-first
   * @executionTimeoutInSeconds 120
   * @appearanceColor #1240FF #191970
   *
   * @paramDef {"type":"String","label":"Recipient Email","name":"recipientEmail","required":true,"description":"Triggers only if the link was clicked for the first time by this specific recipient address."}
   *
   */
  onLinkClickedFirst(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      logger.debug(`SHAPE_EVENT: ${ JSON.stringify(payload) }`)

      return [
        {
          name: 'onLinkClickedFirst',
          data: payload.data,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      logger.debug(`FILTER_TRIGGER: ${ JSON.stringify(payload) }`)

      const triggersToActivate = payload.triggers
        .filter(({ data }) => data.recipientEmail === payload.eventData.email.recipient.email)
        .map(({ id }) => id)

      logger.debug(`triggersToActivate: ${ JSON.stringify(triggersToActivate) }`)

      return { ids: triggersToActivate }
    }
  }

  /**
   * @operationName On Recipient Unsubscribed
   * @description Triggers when the recipient unsubscribes from your emails.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-recipient-unsubscribed
   * @executionTimeoutInSeconds 120
   * @appearanceColor #1240FF #191970
   *
   * @paramDef {"type":"String","label":"Recipient Email","name":"recipientEmail","required":true,"description":"The email address of the recipient who unsubscribed from your emails."}
   *
   *
   */
  onRecipientUnsubscribed(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      logger.debug(`SHAPE_EVENT: ${ JSON.stringify(payload) }`)

      return [
        {
          name: 'onRecipientUnsubscribed',
          data: payload.data,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      logger.debug(`FILTER_TRIGGER: ${ JSON.stringify(payload) }`)

      const triggersToActivate = payload.triggers
        .filter(({ data }) => data.recipientEmail === payload.eventData.email.recipient.email)
        .map(({ id }) => id)

      logger.debug(`triggersToActivate: ${ JSON.stringify(triggersToActivate) }`)

      return { ids: triggersToActivate }
    }
  }

  /**
   * @operationName On Spam Complaint
   * @description Triggers when the recipient marks your emails as spam.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-spam-complaint
   * @executionTimeoutInSeconds 120
   * @appearanceColor #1240FF #191970
   *
   * @paramDef {"type":"String","label":"Recipient Email","name":"recipientEmail","required":true,"description":"The email address of the recipient who marked your emails as spam."}
   *
   *
   */
  onSpamComplaint(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      logger.debug(`SHAPE_EVENT: ${ JSON.stringify(payload) }`)

      return [
        {
          name: 'onSpamComplaint',
          data: payload.data,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      logger.debug(`FILTER_TRIGGER: ${ JSON.stringify(payload) }`)

      const triggersToActivate = payload.triggers
        .filter(({ data }) => data.recipientEmail === payload.eventData.email.recipient.email)
        .map(({ id }) => id)

      logger.debug(`triggersToActivate: ${ JSON.stringify(triggersToActivate) }`)

      return { ids: triggersToActivate }
    }
  }

  // ========================================== DICTIONARIES ===========================================

  /**
   * @typedef {Object} DictionaryPayload
   * @property {String} [search]
   */

  /**
   * @typedef {Object} DictionaryItem
   * @property {String} label
   * @property {any} value
   * @property {String} note
   */

  /**
   * @typedef {Object} DictionaryResponse
   * @property {Array.<DictionaryItem>} items
   */

  /**
   * @typedef {Object} getSendersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter senders by their name, email, or ID. Filtering is performed locally on retrieved results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Senders
   * @description Returns a list of MailerSend verified senders. Note: search functionality filters senders only within the current set of results.
   *
   * @route POST /get-senders
   *
   * @paramDef {"type":"getSendersDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering senders."}
   *
   * @sampleResult {"items":[{"label":"My Name (me@example.com)","note":"ID: 001","value":"001"}]}
   * @returns {DictionaryResponse}
   */
  async getSendersDictionary({ search }) {
    const senders = await this.mailerSend.email.identity
      .list()
      .then(response => response.body.data)
      .catch(e => {
        throw new Error(e.statusCode === 401 ? UNAUTHENTICATED_ERROR : e.body.message)
      })

    const filteredSenders = search ? searchFilter(senders, ['id', 'name', 'email'], search) : senders

    return {
      items: filteredSenders.map(({ id, name, email }) => ({
        label: `${ name } (${ email })`,
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @typedef {Object} getTemplatesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter templates by their name or ID. Filtering is performed locally on retrieved results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Templates
   * @description Returns a list of MailerSend templates. Note: search functionality filters templates only within the current set of results.
   *
   * @route POST /get-templates
   *
   * @paramDef {"type":"getTemplatesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering templates."}
   *
   * @sampleResult {"items":[{"label":"Welcome Email","note":"ID: 002","value":"002"}]}
   * @returns {DictionaryResponse}
   */
  async getTemplatesDictionary({ search }) {
    const templates = await this.mailerSend.email.template
      .list()
      .then(response => response.body.data)
      .catch(e => {
        throw new Error(e.statusCode === 401 ? UNAUTHENTICATED_ERROR : e.body.message)
      })

    const filteredTemplates = search ? searchFilter(templates, ['id', 'name'], search) : templates

    return {
      items: filteredTemplates.map(({ id, name }) => ({
        label: name || '[empty]',
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  // ======================================= END OF DICTIONARIES =======================================

  /**
   * @typedef Headers
   * @property {String} date
   * @property {String} server
   * @property {String} cf-ray
   * @property {String} transfer-encoding
   * @property {String} x-ratelimit-limit
   * @property {String} x-message-id
   * @property {String} x-apiquota-reset
   * @property {String} cf-cache-status
   * @property {String} x-ratelimit-remaining
   * @property {String} strict-transport-security
   * @property {String} x-apiquota-remaining
   * @property {String} connection
   * @property {String} content-type
   * @property {String} cache-control
   */

  /**
   * @typedef MessageStatus
   * @property {Headers} headers
   * @property {String} body
   * @property {Number} statusCode
   */

  /**
   * @operationName Send Email
   * @description Sends an email to the specified recipient.
   *
   * @route POST /send-email
   * @executionTimeoutInSeconds 120
   * @appearanceColor #1240FF #191970
   *
   * @paramDef {"type":"String","label":"Sender","name":"senderId","dictionary":"getSendersDictionary","description":"The ID of the sender used for sending the email."}
   * @paramDef {"type":"String","label":"To Name","name":"toName","description":"The name of the recipient. Cannot contain ';' or ',' characters."}
   * @paramDef {"type":"String","label":"To Email","name":"toEmail","required":true,"description":"The email address of the recipient."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"The subject line of the email message."}
   * @paramDef {"type":"String","label":"HTML Content","name":"htmlBody","description":"HTML body of the email. Required if Text Content is not provided."}
   * @paramDef {"type":"String","label":"Text Content","name":"textBody","description":"Plain text body of the email. Required if HTML Content is not provided."}
   * @paramDef {"type":"Array.<String>","label":"Attachment URLs","name":"attachments","description":"List of URLs of files to attach to the email."}
   *
   * @returns {MessageStatus} Status of the send message.
   * @sampleResult {"headers":{"date":"Wed,05Mar202521:20:32GMT","server":"cloudflare","cf-ray":"test-ray-id-123456-DFW","transfer-encoding":"chunked","x-ratelimit-limit":"10","x-message-id":"test-message-id-abcdef123456","x-apiquota-reset":"2025-03-06T00:00:00Z","cf-cache-status":"DYNAMIC","x-ratelimit-remaining":"9","strict-transport-security":"max-age=31536000;includeSubDomains","x-apiquota-remaining":"999","connection":"close","content-type":"text/html;charset=UTF-8","cache-control":"no-cache,private"},"body":"","statusCode":202}
   */
  async sendEmail(senderId, toName, toEmail, subject, htmlBody, textBody, attachments) {
    const sender = await this.#getIdentityById(senderId)
    const sentFrom = new Sender(sender?.email || this.fromEmail, sender?.name || this.fromName)
    const recipients = [new Recipient(toEmail, toName || null)]

    let attachmentsData

    if (attachments && attachments.length) {
      const attachmentPromises = attachments?.map(this.#getBase64File)
      const attachmentResults = await Promise.all(attachmentPromises)

      attachmentsData = attachmentResults.map(att => new Attachment(att.content, att.filename, 'attachment'))
    }

    const emailParams = new EmailParams()
      .setFrom(sentFrom)
      .setTo(recipients)
      .setSubject(subject)
      .setHtml(htmlBody)
      .setText(textBody)
      .setAttachments(attachmentsData)

    logger.debug(`sendEmail: ${ JSON.stringify(emailParams) }`)

    try {
      return await this.mailerSend.email.send(emailParams)
    } catch (error) {
      throw new Error(buildErrorMessage(error))
    }
  }

  /**
   * @operationName Send Email with CC/BCC
   * @description Sends an email with support for multiple recipients, CC, and BCC addresses.
   *
   * @route POST /send-email-with-cc-bcc
   * @executionTimeoutInSeconds 120
   * @appearanceColor #1240FF #191970
   *
   * @paramDef {"type":"String","label":"Sender","name":"senderId","dictionary":"getSendersDictionary","description":"The ID of the sender used to send the email."}
   * @paramDef {"type":"Array","label":"To Email Recipients","name":"to","required":true,"description":"A list of primary recipients, each as an email address or an object with 'email' (required) and 'name' (optional, cannot contain ';' or ',')."}
   * @paramDef {"type":"Array","label":"CC Email Recipients","name":"cc","description":"A list of CC recipients, each as an email address or an object with 'email' (required) and 'name' (optional, cannot contain ';' or ',')."}
   * @paramDef {"type":"Array","label":"BCC Email Recipients","name":"bcc","description":"A list of BCC recipients, each as an email address or an object with 'email' (required) and 'name' (optional, cannot contain ';' or ',')."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"The subject line of the email message."}
   * @paramDef {"type":"String","label":"HTML Content","name":"htmlBody","description":"HTML body of the email. Required if Text Content is not provided."}
   * @paramDef {"type":"String","label":"Text Content","name":"textBody","description":"Plain text body of the email. Required if HTML Content is not provided."}
   * @paramDef {"type":"Array.<String>","label":"Attachment URLs","name":"attachments","description":"List of URLs of files to attach to the email."}
   *
   * @returns {MessageStatus} Status of the send message.
   * @sampleResult {"headers":{"date":"Wed,05Mar202521:20:32GMT","server":"cloudflare","cf-ray":"test-ray-id-123456-DFW","transfer-encoding":"chunked","x-ratelimit-limit":"10","x-message-id":"test-message-id-abcdef123456","x-apiquota-reset":"2025-03-06T00:00:00Z","cf-cache-status":"DYNAMIC","x-ratelimit-remaining":"9","strict-transport-security":"max-age=31536000;includeSubDomains","x-apiquota-remaining":"999","connection":"close","content-type":"text/html;charset=UTF-8","cache-control":"no-cache,private"},"body":"","statusCode":202}
   */
  async sendEmailWithCcAndBcc(senderId, to, cc, bcc, subject, htmlBody, textBody, attachments) {
    const sender = await this.#getIdentityById(senderId)
    const sentFrom = new Sender(sender?.email || this.fromEmail, sender?.name || this.fromName)

    let attachmentsData

    if (attachments && attachments.length) {
      const attachmentPromises = attachments?.map(this.#getBase64File)
      const attachmentResults = await Promise.all(attachmentPromises)

      attachmentsData = attachmentResults.map(att => new Attachment(att.content, att.filename, 'attachment'))
    }

    const emailParams = new EmailParams()
      .setFrom(sentFrom)
      .setTo(this.#parseEmailRecipients(to))
      .setSubject(subject)
      .setHtml(htmlBody)
      .setText(textBody)
      .setAttachments(attachmentsData)

    if (!!cc) {
      emailParams.setCc(this.#parseEmailRecipients(cc))
    }

    if (!!bcc) {
      emailParams.setBcc(this.#parseEmailRecipients(bcc))
    }

    logger.debug(`sendEmailWithCcAndBcc: ${ JSON.stringify(emailParams) }`)

    try {
      return await this.mailerSend.email.send(emailParams)
    } catch (error) {
      throw new Error(buildErrorMessage(error))
    }
  }

  /**
   * @operationName Send Email with Template
   * @description Sends an email based on a pre-defined template, with optional personalization and tracking options.
   *
   * @route POST /send-email-with-template
   * @executionTimeoutInSeconds 120
   * @appearanceColor #1240FF #191970
   *
   * @paramDef {"type":"String","label":"Sender","name":"senderId","dictionary":"getSendersDictionary","description":"The ID of the sender used to send the email."}
   * @paramDef {"type":"Array","label":"To Email Recipients","name":"to","required":true,"description":"A list of primary recipients, each as an email address or an object with 'email' (required) and 'name' (optional, cannot contain ';' or ',')."}
   * @paramDef {"type":"String","label":"Template","name":"templateId","required":true,"dictionary":"getTemplatesDictionary","description":"The ID of the email template to use for sending the message."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"The subject line of the email message."}
   * @paramDef {"type":"Array.<Object>","label":"Personalization","name":"personalization","description":"List of key-value pairs to dynamically populate template fields."}
   * @paramDef {"type":"Boolean","label":"Track Clicks","name":"trackClicks","uiComponent":{"type":"TOGGLE"},"description":"Whether to track link clicks in the email."}
   * @paramDef {"type":"Boolean","label":"Track Opens","name":"trackOpens","uiComponent":{"type":"TOGGLE"},"description":"Whether to track when the email is opened."}
   * @paramDef {"type":"Boolean","label":"Track Content","name":"trackContent","uiComponent":{"type":"TOGGLE"},"description":"Whether to track content engagement in the email."}
   *
   * @returns {MessageStatus} Status of the send message.
   * @sampleResult {"headers":{"date":"Wed,05Mar202521:20:32GMT","server":"cloudflare","cf-ray":"test-ray-id-123456-DFW","transfer-encoding":"chunked","x-ratelimit-limit":"10","x-message-id":"test-message-id-abcdef123456","x-apiquota-reset":"2025-03-06T00:00:00Z","cf-cache-status":"DYNAMIC","x-ratelimit-remaining":"9","strict-transport-security":"max-age=31536000;includeSubDomains","x-apiquota-remaining":"999","connection":"close","content-type":"text/html;charset=UTF-8","cache-control":"no-cache,private"},"body":"","statusCode":202}
   */
  async sendEmailWithTemplate(
    senderId,
    to,
    templateId,
    subject,
    personalization,
    trackClicks,
    trackOpens,
    trackContent
  ) {
    const sender = await this.#getIdentityById(senderId)
    const sentFrom = new Sender(sender?.email || this.fromEmail, sender?.name || this.fromName)

    const trackingOptions = {
      track_clicks: trackClicks || false,
      track_opens: trackOpens || false,
      track_content: trackContent || false,
    }

    const emailParams = new EmailParams()
      .setFrom(sentFrom)
      .setTo(this.#parseEmailRecipients(to))
      .setSubject(subject)
      .setTemplateId(templateId)
      .setSettings(trackingOptions)

    if (!!personalization) {
      emailParams.setPersonalization(Array.isArray(personalization) ? personalization : [personalization])
    }

    logger.debug(`sendEmailWithTemplate: ${ JSON.stringify(emailParams) }`)

    try {
      return await this.mailerSend.email.send(emailParams)
    } catch (error) {
      throw new Error(buildErrorMessage(error))
    }
  }
}

Flowrunner.ServerCode.addService(MailerSend, [
  {
    order: 0,
    displayName: 'API Key',
    defaultValue: '',
    name: 'apiKey',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Your MailerSend API key for authentication.',
  },
  {
    order: 1,
    displayName: 'Default From Name',
    defaultValue: '',
    name: 'fromName',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    hint: 'The default sender\'s name used when no sender name is provided.',
  },
  {
    order: 2,
    displayName: 'Default From Email',
    defaultValue: '',
    name: 'fromEmail',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    hint: 'The default sender\'s email address used when no sender email is provided.',
  },
])
