const logger = {
  info: (...args) => console.log('[Postmark] info:', ...args),
  debug: (...args) => console.log('[Postmark] debug:', ...args),
  error: (...args) => console.log('[Postmark] error:', ...args),
  warn: (...args) => console.log('[Postmark] warn:', ...args),
}

const API_BASE_URL = 'https://api.postmarkapp.com'

const DEFAULT_PAGE_SIZE = 50
const DICTIONARY_PAGE_SIZE = 100

const TRACK_LINKS_MAP = {
  'None': 'None',
  'Html And Text': 'HtmlAndText',
  'Html Only': 'HtmlOnly',
  'Text Only': 'TextOnly',
}

const MESSAGE_STATUS_MAP = {
  'Queued': 'queued',
  'Sent': 'sent',
  'Processed': 'processed',
}

const BOUNCE_TYPE_MAP = {
  'Hard Bounce': 'HardBounce',
  'Soft Bounce': 'SoftBounce',
  'Transient': 'Transient',
  'Unsubscribe': 'Unsubscribe',
  'Subscribe': 'Subscribe',
  'Auto Responder': 'AutoResponder',
  'Address Change': 'AddressChange',
  'DNS Error': 'DnsError',
  'Spam Notification': 'SpamNotification',
  'Spam Complaint': 'SpamComplaint',
  'Open Relay Test': 'OpenRelayTest',
  'Virus Notification': 'VirusNotification',
  'Challenge Verification': 'ChallengeVerification',
  'Bad Email Address': 'BadEmailAddress',
  'Manually Deactivated': 'ManuallyDeactivated',
  'Unconfirmed': 'Unconfirmed',
  'Blocked': 'Blocked',
  'SMTP API Error': 'SMTPApiError',
  'Inbound Error': 'InboundError',
  'DMARC Policy': 'DMARCPolicy',
  'Template Rendering Failed': 'TemplateRenderingFailed',
  'Unknown': 'Unknown',
}

const SUPPRESSION_REASON_MAP = {
  'Hard Bounce': 'HardBounce',
  'Spam Complaint': 'SpamComplaint',
  'Manual Suppression': 'ManualSuppression',
}

const MIME_TYPES = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  csv: 'text/csv',
  html: 'text/html',
  ics: 'text/calendar',
  json: 'application/json',
  xml: 'application/xml',
  zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
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

/**
 * @integrationName Postmark
 * @integrationIcon /icon.png
 * @usesFileStorage
 */
class PostmarkService {
  constructor(config) {
    this.serverToken = config.serverToken
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery || {}) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'X-Postmark-Server-Token': this.serverToken,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const errorCode = error.body?.ErrorCode
      const message = error.body?.Message || error.message

      logger.error(`${ logTag } - Request failed: ${ message }${ errorCode !== undefined ? ` (ErrorCode: ${ errorCode })` : '' }`)

      throw new Error(`Postmark API error: ${ message }${ errorCode !== undefined ? ` (ErrorCode: ${ errorCode })` : '' }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  async #buildAttachments(attachmentUrls, logTag) {
    if (!attachmentUrls || !attachmentUrls.length) {
      return undefined
    }

    return await Promise.all(attachmentUrls.map(async fileUrl => {
      const bytes = await Flowrunner.Request.get(fileUrl).setEncoding(null)
      const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)

      const rawName = decodeURIComponent(fileUrl.split('?')[0].split('/').pop() || '')
      const name = rawName || `attachment_${ Date.now() }`
      const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : ''

      logger.debug(`${ logTag } - attached file "${ name }" (${ buffer.length } bytes)`)

      return {
        Name: name,
        Content: buffer.toString('base64'),
        ContentType: MIME_TYPES[extension] || 'application/octet-stream',
      }
    }))
  }

  /**
   * @operationName Send Email
   * @category Email Sending
   * @description Sends a single email through Postmark. Supports HTML and/or plain-text bodies, up to 50 comma-separated recipients per address field (To, Cc, Bcc combined limit is 50), open and link tracking, a categorization tag, custom metadata, and file attachments downloaded from FlowRunner file URLs. Provide at least one of HTML Body or Text Body. Returns the Postmark Message ID and submission timestamp.
   * @route POST /send-email
   *
   * @paramDef {"type":"String","label":"From","name":"from","required":true,"description":"Sender email address, e.g. sender@example.com or \"Sender Name <sender@example.com>\". Must be a verified Sender Signature or on a verified domain in your Postmark account."}
   * @paramDef {"type":"String","label":"To","name":"to","required":true,"description":"Recipient email address(es), comma-separated. Up to 50 recipients across To, Cc, and Bcc."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Email subject line."}
   * @paramDef {"type":"String","label":"HTML Body","name":"htmlBody","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"HTML content of the email. Required if Text Body is empty; you may provide both."}
   * @paramDef {"type":"String","label":"Text Body","name":"textBody","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Plain-text content of the email. Required if HTML Body is empty; you may provide both."}
   * @paramDef {"type":"String","label":"Cc","name":"cc","description":"Carbon-copy recipient email address(es), comma-separated."}
   * @paramDef {"type":"String","label":"Bcc","name":"bcc","description":"Blind-carbon-copy recipient email address(es), comma-separated."}
   * @paramDef {"type":"String","label":"Reply To","name":"replyTo","description":"Reply-To email address. Defaults to the Reply-To configured on the Sender Signature."}
   * @paramDef {"type":"String","label":"Tag","name":"tag","description":"Tag for categorizing this email in Postmark statistics and searches, e.g. welcome-email. Maximum 1000 characters."}
   * @paramDef {"type":"Boolean","label":"Track Opens","name":"trackOpens","uiComponent":{"type":"CHECKBOX"},"description":"Activate open tracking for this email. Requires an HTML body."}
   * @paramDef {"type":"String","label":"Track Links","name":"trackLinks","uiComponent":{"type":"DROPDOWN","options":{"values":["None","Html And Text","Html Only","Text Only"]}},"defaultValue":"None","description":"Which message parts get link tracking. Defaults to None."}
   * @paramDef {"type":"String","label":"Message Stream","name":"messageStream","dictionary":"getMessageStreamsDictionary","defaultValue":"outbound","description":"Message stream to send through. Defaults to the outbound transactional stream. Select from your server's streams or type a stream ID."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","description":"Custom key/value metadata attached to the message, e.g. {\"order-id\":\"12345\"}. Up to 10 fields; returned in webhooks and message details."}
   * @paramDef {"type":"Array<String>","label":"Attachment URLs","name":"attachmentUrls","description":"URLs of FlowRunner files (or public URLs) to attach. Each file is downloaded and sent to Postmark as a base64 attachment. Total message size limit is 10 MB."}
   *
   * @returns {Object}
   * @sampleResult {"To":"john@example.com","SubmittedAt":"2026-07-13T09:30:00.0000000-04:00","MessageID":"0a129aee-e1cd-480d-b08d-4f48548ff48d","ErrorCode":0,"Message":"OK"}
   */
  async sendEmail(from, to, subject, htmlBody, textBody, cc, bcc, replyTo, tag, trackOpens, trackLinks, messageStream, metadata, attachmentUrls) {
    const logTag = '[sendEmail]'

    if (!htmlBody && !textBody) {
      throw new Error('Postmark API error: provide at least one of HTML Body or Text Body.')
    }

    const attachments = await this.#buildAttachments(attachmentUrls, logTag)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/email`,
      method: 'post',
      body: clean({
        From: from,
        To: to,
        Cc: cc,
        Bcc: bcc,
        Subject: subject,
        HtmlBody: htmlBody,
        TextBody: textBody,
        ReplyTo: replyTo,
        Tag: tag,
        TrackOpens: trackOpens,
        TrackLinks: this.#resolveChoice(trackLinks, TRACK_LINKS_MAP),
        MessageStream: messageStream || 'outbound',
        Metadata: metadata,
        Attachments: attachments,
      }),
    })
  }

  /**
   * @operationName Send Email with Template
   * @category Email Sending
   * @description Sends an email using a Postmark template. Identify the template by Template ID (select from the dictionary) or by Template Alias — provide exactly one. The Template Model supplies the variables rendered into the template's subject and body. Supports the same envelope options as Send Email: multiple recipients, tracking, tag, metadata, message stream, and attachments from FlowRunner file URLs.
   * @route POST /send-email-with-template
   *
   * @paramDef {"type":"String","label":"From","name":"from","required":true,"description":"Sender email address, e.g. sender@example.com or \"Sender Name <sender@example.com>\". Must be a verified Sender Signature or on a verified domain in your Postmark account."}
   * @paramDef {"type":"String","label":"To","name":"to","required":true,"description":"Recipient email address(es), comma-separated. Up to 50 recipients across To, Cc, and Bcc."}
   * @paramDef {"type":"String","label":"Template ID","name":"templateId","dictionary":"getTemplatesDictionary","description":"Numeric ID of the template to render. Select from the dictionary or type an ID. Provide this OR Template Alias, not both."}
   * @paramDef {"type":"String","label":"Template Alias","name":"templateAlias","description":"Alias of the template to render, e.g. welcome-email. Provide this OR Template ID, not both."}
   * @paramDef {"type":"Object","label":"Template Model","name":"templateModel","required":true,"description":"Key/value model used to render the template's variables, e.g. {\"name\":\"John\",\"action_url\":\"https://example.com/activate\"}."}
   * @paramDef {"type":"String","label":"Cc","name":"cc","description":"Carbon-copy recipient email address(es), comma-separated."}
   * @paramDef {"type":"String","label":"Bcc","name":"bcc","description":"Blind-carbon-copy recipient email address(es), comma-separated."}
   * @paramDef {"type":"String","label":"Reply To","name":"replyTo","description":"Reply-To email address. Defaults to the Reply-To configured on the Sender Signature."}
   * @paramDef {"type":"String","label":"Tag","name":"tag","description":"Tag for categorizing this email in Postmark statistics and searches. Maximum 1000 characters."}
   * @paramDef {"type":"Boolean","label":"Track Opens","name":"trackOpens","uiComponent":{"type":"CHECKBOX"},"description":"Activate open tracking for this email. Requires an HTML template body."}
   * @paramDef {"type":"String","label":"Track Links","name":"trackLinks","uiComponent":{"type":"DROPDOWN","options":{"values":["None","Html And Text","Html Only","Text Only"]}},"defaultValue":"None","description":"Which message parts get link tracking. Defaults to None."}
   * @paramDef {"type":"String","label":"Message Stream","name":"messageStream","dictionary":"getMessageStreamsDictionary","defaultValue":"outbound","description":"Message stream to send through. Defaults to the outbound transactional stream."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","description":"Custom key/value metadata attached to the message, e.g. {\"order-id\":\"12345\"}. Up to 10 fields."}
   * @paramDef {"type":"Array<String>","label":"Attachment URLs","name":"attachmentUrls","description":"URLs of FlowRunner files (or public URLs) to attach. Each file is downloaded and sent to Postmark as a base64 attachment. Total message size limit is 10 MB."}
   *
   * @returns {Object}
   * @sampleResult {"To":"john@example.com","SubmittedAt":"2026-07-13T09:30:00.0000000-04:00","MessageID":"0a129aee-e1cd-480d-b08d-4f48548ff48d","ErrorCode":0,"Message":"OK"}
   */
  async sendEmailWithTemplate(from, to, templateId, templateAlias, templateModel, cc, bcc, replyTo, tag, trackOpens, trackLinks, messageStream, metadata, attachmentUrls) {
    const logTag = '[sendEmailWithTemplate]'

    if (!templateId && !templateAlias) {
      throw new Error('Postmark API error: provide either Template ID or Template Alias.')
    }

    const attachments = await this.#buildAttachments(attachmentUrls, logTag)

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/email/withTemplate`,
      method: 'post',
      body: clean({
        TemplateId: templateId ? Number(templateId) : undefined,
        TemplateAlias: templateId ? undefined : templateAlias,
        TemplateModel: templateModel || {},
        From: from,
        To: to,
        Cc: cc,
        Bcc: bcc,
        ReplyTo: replyTo,
        Tag: tag,
        TrackOpens: trackOpens,
        TrackLinks: this.#resolveChoice(trackLinks, TRACK_LINKS_MAP),
        MessageStream: messageStream || 'outbound',
        Metadata: metadata,
        Attachments: attachments,
      }),
    })
  }

  /**
   * @operationName Send Batch Emails
   * @category Email Sending
   * @description Sends up to 500 emails in a single API call (total payload limit 50 MB). Each item in Messages is a raw Postmark message object with the fields From, To, Subject, and HtmlBody and/or TextBody (all required), plus optional Cc, Bcc, ReplyTo, Tag, TrackOpens, TrackLinks, Metadata, MessageStream, Headers, and Attachments. Returns one result object per message in the same order; check each item's ErrorCode (0 = accepted) because individual messages can fail while the batch call itself succeeds.
   * @route POST /send-batch-emails
   *
   * @paramDef {"type":"Array<Object>","label":"Messages","name":"messages","required":true,"description":"Array of Postmark message objects, e.g. [{\"From\":\"sender@example.com\",\"To\":\"john@example.com\",\"Subject\":\"Hello\",\"TextBody\":\"Hi John\",\"MessageStream\":\"outbound\"}]. Maximum 500 messages per call."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"ErrorCode":0,"Message":"OK","MessageID":"0a129aee-e1cd-480d-b08d-4f48548ff48d","SubmittedAt":"2026-07-13T09:30:00.0000000-04:00","To":"john@example.com"},{"ErrorCode":300,"Message":"Error parsing 'To': Illegal email address 'invalid'."}]
   */
  async sendBatchEmails(messages) {
    const logTag = '[sendBatchEmails]'

    if (!Array.isArray(messages) || !messages.length) {
      throw new Error('Postmark API error: Messages must be a non-empty array of message objects.')
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/email/batch`,
      method: 'post',
      body: messages,
    })
  }

  /**
   * @operationName List Templates
   * @category Templates
   * @description Lists the templates on your Postmark server with pagination. Optionally filter by template type (Standard templates or Layouts). Returns each template's ID, name, alias, type, and active state; use Get Template to fetch a template's full content.
   * @route GET /list-templates
   *
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of templates to return, maximum 500. Defaults to 50."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of templates to skip for pagination. Defaults to 0."}
   * @paramDef {"type":"String","label":"Template Type","name":"templateType","uiComponent":{"type":"DROPDOWN","options":{"values":["All","Standard","Layout"]}},"defaultValue":"All","description":"Filter by template type. Defaults to All."}
   *
   * @returns {Object}
   * @sampleResult {"TotalCount":2,"Templates":[{"Active":true,"TemplateId":1234,"Name":"Welcome Email","Alias":"welcome-email","TemplateType":"Standard","LayoutTemplate":null},{"Active":true,"TemplateId":5678,"Name":"Base Layout","Alias":"base-layout","TemplateType":"Layout","LayoutTemplate":null}]}
   */
  async listTemplates(count, offset, templateType) {
    const logTag = '[listTemplates]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/templates`,
      query: {
        Count: count || DEFAULT_PAGE_SIZE,
        Offset: offset || 0,
        TemplateType: templateType,
      },
    })
  }

  /**
   * @operationName Get Template
   * @category Templates
   * @description Retrieves a single template's full details, including its subject line, HTML body, text body, alias, type, and associated layout. Identify the template by its numeric ID or its alias.
   * @route GET /get-template
   *
   * @paramDef {"type":"String","label":"Template","name":"templateIdOrAlias","required":true,"dictionary":"getTemplatesDictionary","description":"Numeric template ID or template alias. Select from the dictionary or type a value."}
   *
   * @returns {Object}
   * @sampleResult {"TemplateId":1234,"Name":"Welcome Email","Subject":"Welcome, {{name}}!","HtmlBody":"<html><body>Hello {{name}}</body></html>","TextBody":"Hello {{name}}","AssociatedServerId":123456,"Active":true,"Alias":"welcome-email","TemplateType":"Standard","LayoutTemplate":null}
   */
  async getTemplate(templateIdOrAlias) {
    const logTag = '[getTemplate]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/templates/${ encodeURIComponent(templateIdOrAlias) }`,
    })
  }

  /**
   * @operationName Search Outbound Messages
   * @category Outbound Messages
   * @description Searches sent and queued messages on your server with pagination and filtering by recipient, sender, tag, status, subject, message stream, and date range. Returns message summaries (without full bodies); use Get Message Details for a specific message's content and delivery events. Message history retention depends on your Postmark plan (45 days by default).
   * @route GET /search-outbound-messages
   *
   * @paramDef {"type":"String","label":"Recipient","name":"recipient","description":"Filter by the recipient email address (To, Cc, or Bcc)."}
   * @paramDef {"type":"String","label":"From Email","name":"fromEmail","description":"Filter by the sender email address."}
   * @paramDef {"type":"String","label":"Tag","name":"tag","description":"Filter by message tag."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Queued","Sent","Processed"]}},"description":"Filter by message status. Sent and Processed return identical results."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"Filter by email subject."}
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","description":"Only return messages received on or after this date/time, e.g. 2026-07-01 or 2026-07-01T12:00:00. Interpreted in US Eastern Time."}
   * @paramDef {"type":"String","label":"To Date","name":"toDate","description":"Only return messages received up to this date/time, e.g. 2026-07-13 or 2026-07-13T12:00:00. Interpreted in US Eastern Time."}
   * @paramDef {"type":"String","label":"Message Stream","name":"messageStream","dictionary":"getMessageStreamsDictionary","description":"Filter by message stream ID. Defaults to all streams."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of messages to return, maximum 500. Defaults to 50."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of messages to skip for pagination. Defaults to 0."}
   *
   * @returns {Object}
   * @sampleResult {"TotalCount":194,"Messages":[{"Tag":"welcome-email","MessageID":"0a129aee-e1cd-480d-b08d-4f48548ff48d","MessageStream":"outbound","To":[{"Email":"john@example.com","Name":null}],"Cc":[],"Bcc":[],"Recipients":["john@example.com"],"ReceivedAt":"2026-07-10T08:58:30-04:00","From":"sender@example.com","Subject":"Welcome!","Attachments":[],"Status":"Sent","TrackOpens":true,"TrackLinks":"None","Sandboxed":false}]}
   */
  async searchOutboundMessages(recipient, fromEmail, tag, status, subject, fromDate, toDate, messageStream, count, offset) {
    const logTag = '[searchOutboundMessages]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/messages/outbound`,
      query: {
        recipient,
        fromemail: fromEmail,
        tag,
        status: this.#resolveChoice(status, MESSAGE_STATUS_MAP),
        subject,
        fromdate: fromDate,
        todate: toDate,
        messagestream: messageStream,
        count: count || DEFAULT_PAGE_SIZE,
        offset: offset || 0,
      },
    })
  }

  /**
   * @operationName Get Message Details
   * @category Outbound Messages
   * @description Retrieves full details of a sent message by its Message ID, including the HTML and text bodies, recipients, tag, metadata, tracking settings, and the MessageEvents timeline (delivery, bounce, open, click, and subscription-change events with per-event details).
   * @route GET /get-message-details
   *
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"description":"The Postmark Message ID returned when the email was sent, e.g. 0a129aee-e1cd-480d-b08d-4f48548ff48d."}
   *
   * @returns {Object}
   * @sampleResult {"MessageID":"0a129aee-e1cd-480d-b08d-4f48548ff48d","MessageStream":"outbound","To":[{"Email":"john@example.com","Name":null}],"Cc":[],"Bcc":[],"From":"sender@example.com","Subject":"Welcome!","Tag":"welcome-email","Status":"Sent","TextBody":"Hello John","HtmlBody":"<html><body>Hello John</body></html>","ReceivedAt":"2026-07-10T08:58:30-04:00","TrackOpens":true,"TrackLinks":"None","Metadata":{"order-id":"12345"},"Attachments":[],"MessageEvents":[{"Recipient":"john@example.com","Type":"Delivered","ReceivedAt":"2026-07-10T08:58:33-04:00","Details":{"DeliveryMessage":"smtp;250 2.0.0 OK","DestinationServer":"mail.example.com","DestinationIP":"192.0.2.1"}}]}
   */
  async getMessageDetails(messageId) {
    const logTag = '[getMessageDetails]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/messages/outbound/${ encodeURIComponent(messageId) }/details`,
    })
  }

  /**
   * @operationName Get Outbound Overview
   * @category Statistics
   * @description Returns aggregate sending statistics for your server: sent, bounced, and spam-complaint counts and rates, plus open and link-tracking totals. Optionally filter by tag, message stream, and date range.
   * @route GET /get-outbound-overview
   *
   * @paramDef {"type":"String","label":"Tag","name":"tag","description":"Filter statistics by message tag."}
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","description":"Only include statistics from this date onward, format YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"To Date","name":"toDate","description":"Only include statistics up to this date, format YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"Message Stream","name":"messageStream","dictionary":"getMessageStreamsDictionary","description":"Filter statistics by message stream ID."}
   *
   * @returns {Object}
   * @sampleResult {"Sent":615,"Bounced":64,"SMTPApiErrors":25,"BounceRate":10.406,"SpamComplaints":10,"SpamComplaintsRate":1.626,"Opens":166,"UniqueOpens":26,"Tracked":111,"WithLinkTracking":90,"WithOpenTracking":51,"TotalTrackedLinksSent":60,"UniqueLinksClicked":19,"TotalClicks":72,"WithClientRecorded":14,"WithPlatformRecorded":10,"WithReadTimeRecorded":10}
   */
  async getOutboundOverview(tag, fromDate, toDate, messageStream) {
    const logTag = '[getOutboundOverview]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/stats/outbound`,
      query: {
        tag,
        fromdate: fromDate,
        todate: toDate,
        messagestream: messageStream,
      },
    })
  }

  /**
   * @operationName Get Delivery Stats
   * @category Statistics
   * @description Returns the number of inactive (suppressed) email addresses on your server and a breakdown of bounce counts by bounce type (hard bounce, soft bounce, spam complaint, etc.).
   * @route GET /get-delivery-stats
   *
   * @returns {Object}
   * @sampleResult {"InactiveMails":192,"Bounces":[{"Name":"All","Count":253},{"Name":"Hard bounce","Type":"HardBounce","Count":195},{"Name":"Soft bounce","Type":"SoftBounce","Count":42},{"Name":"Spam complaint","Type":"SpamComplaint","Count":16}]}
   */
  async getDeliveryStats() {
    const logTag = '[getDeliveryStats]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/deliverystats`,
    })
  }

  /**
   * @operationName Search Bounces
   * @category Bounces
   * @description Searches bounces on your server with pagination and filtering by bounce type, active/inactive state, recipient email, tag, Message ID, message stream, and date range. Each bounce includes its ID (used by Get Bounce and Activate Bounce), type, description, and whether the recipient address was deactivated.
   * @route GET /search-bounces
   *
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Hard Bounce","Soft Bounce","Transient","Unsubscribe","Subscribe","Auto Responder","Address Change","DNS Error","Spam Notification","Spam Complaint","Open Relay Test","Virus Notification","Challenge Verification","Bad Email Address","Manually Deactivated","Unconfirmed","Blocked","SMTP API Error","Inbound Error","DMARC Policy","Template Rendering Failed","Unknown"]}},"description":"Filter by bounce type. Leave empty for all types."}
   * @paramDef {"type":"Boolean","label":"Inactive Only","name":"inactive","uiComponent":{"type":"CHECKBOX"},"description":"When checked, only return bounces that deactivated the recipient address; when unchecked, only active ones. Leave unset for both."}
   * @paramDef {"type":"String","label":"Email Filter","name":"emailFilter","description":"Filter by recipient email address (full or partial match)."}
   * @paramDef {"type":"String","label":"Tag","name":"tag","description":"Filter by message tag."}
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","description":"Filter by the Postmark Message ID of the original email."}
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","description":"Only return bounces on or after this date/time, e.g. 2026-07-01. Interpreted in US Eastern Time."}
   * @paramDef {"type":"String","label":"To Date","name":"toDate","description":"Only return bounces up to this date/time, e.g. 2026-07-13. Interpreted in US Eastern Time."}
   * @paramDef {"type":"String","label":"Message Stream","name":"messageStream","dictionary":"getMessageStreamsDictionary","description":"Filter by message stream ID. Defaults to all streams."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of bounces to return, maximum 500. Defaults to 50."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of bounces to skip for pagination. Defaults to 0."}
   *
   * @returns {Object}
   * @sampleResult {"TotalCount":253,"Bounces":[{"ID":692560173,"Type":"HardBounce","TypeCode":1,"Name":"Hard bounce","Tag":"welcome-email","MessageID":"0a129aee-e1cd-480d-b08d-4f48548ff48d","ServerID":123456,"MessageStream":"outbound","Description":"The server was unable to deliver your message (ex: unknown user, mailbox not found).","Details":"smtp;550 5.1.1 The email account that you tried to reach does not exist.","Email":"john@example.com","From":"sender@example.com","BouncedAt":"2026-07-10T08:58:30-04:00","DumpAvailable":true,"Inactive":true,"CanActivate":true,"Subject":"Welcome!"}]}
   */
  async searchBounces(type, inactive, emailFilter, tag, messageId, fromDate, toDate, messageStream, count, offset) {
    const logTag = '[searchBounces]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/bounces`,
      query: {
        type: this.#resolveChoice(type, BOUNCE_TYPE_MAP),
        inactive,
        emailFilter,
        tag,
        messageID: messageId,
        fromdate: fromDate,
        todate: toDate,
        messagestream: messageStream,
        count: count || DEFAULT_PAGE_SIZE,
        offset: offset || 0,
      },
    })
  }

  /**
   * @operationName Get Bounce
   * @category Bounces
   * @description Retrieves full details of a single bounce by its bounce ID, including the bounce type, SMTP details, the original message's ID and subject, whether the recipient address was deactivated, and whether it can be reactivated.
   * @route GET /get-bounce
   *
   * @paramDef {"type":"String","label":"Bounce ID","name":"bounceId","required":true,"description":"Numeric ID of the bounce, as returned by Search Bounces."}
   *
   * @returns {Object}
   * @sampleResult {"ID":692560173,"Type":"HardBounce","TypeCode":1,"Name":"Hard bounce","Tag":"welcome-email","MessageID":"0a129aee-e1cd-480d-b08d-4f48548ff48d","ServerID":123456,"MessageStream":"outbound","Description":"The server was unable to deliver your message (ex: unknown user, mailbox not found).","Details":"smtp;550 5.1.1 The email account that you tried to reach does not exist.","Email":"john@example.com","From":"sender@example.com","BouncedAt":"2026-07-10T08:58:30-04:00","DumpAvailable":true,"Inactive":true,"CanActivate":true,"Subject":"Welcome!","Content":null}
   */
  async getBounce(bounceId) {
    const logTag = '[getBounce]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/bounces/${ encodeURIComponent(bounceId) }`,
    })
  }

  /**
   * @operationName Activate Bounce
   * @category Bounces
   * @description Reactivates a bounced (deactivated) email address so Postmark will attempt delivery to it again. Only bounces whose CanActivate flag is true can be reactivated. Returns a confirmation message and the updated bounce object.
   * @route PUT /activate-bounce
   *
   * @paramDef {"type":"String","label":"Bounce ID","name":"bounceId","required":true,"description":"Numeric ID of the bounce to reactivate, as returned by Search Bounces or Get Bounce."}
   *
   * @returns {Object}
   * @sampleResult {"Message":"OK","Bounce":{"ID":692560173,"Type":"HardBounce","TypeCode":1,"Name":"Hard bounce","MessageID":"0a129aee-e1cd-480d-b08d-4f48548ff48d","ServerID":123456,"MessageStream":"outbound","Description":"The server was unable to deliver your message (ex: unknown user, mailbox not found).","Email":"john@example.com","From":"sender@example.com","BouncedAt":"2026-07-10T08:58:30-04:00","DumpAvailable":true,"Inactive":false,"CanActivate":true,"Subject":"Welcome!"}}
   */
  async activateBounce(bounceId) {
    const logTag = '[activateBounce]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/bounces/${ encodeURIComponent(bounceId) }/activate`,
      method: 'put',
      body: {},
    })
  }

  /**
   * @operationName List Suppressions
   * @category Suppressions
   * @description Lists the suppressed (inactive) email addresses on a message stream — addresses Postmark will not deliver to. Optionally filter by suppression reason, origin, a specific email address, and date range. Each entry shows why and when the address was suppressed.
   * @route GET /list-suppressions
   *
   * @paramDef {"type":"String","label":"Message Stream","name":"messageStream","required":true,"dictionary":"getMessageStreamsDictionary","defaultValue":"outbound","description":"ID of the message stream whose suppression list to return, e.g. outbound."}
   * @paramDef {"type":"String","label":"Suppression Reason","name":"suppressionReason","uiComponent":{"type":"DROPDOWN","options":{"values":["Hard Bounce","Spam Complaint","Manual Suppression"]}},"description":"Filter by the reason the address was suppressed."}
   * @paramDef {"type":"String","label":"Origin","name":"origin","uiComponent":{"type":"DROPDOWN","options":{"values":["Recipient","Customer","Admin"]}},"description":"Filter by who created the suppression: Recipient (e.g. unsubscribe link), Customer (you, via API or UI), or Admin (Postmark)."}
   * @paramDef {"type":"String","label":"Email Address","name":"emailAddress","description":"Return the suppression for a specific email address only."}
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","description":"Only return suppressions created on or after this date, format YYYY-MM-DD. Interpreted in US Eastern Time."}
   * @paramDef {"type":"String","label":"To Date","name":"toDate","description":"Only return suppressions created up to this date, format YYYY-MM-DD. Interpreted in US Eastern Time."}
   *
   * @returns {Object}
   * @sampleResult {"Suppressions":[{"EmailAddress":"john@example.com","SuppressionReason":"HardBounce","Origin":"Recipient","CreatedAt":"2026-07-10T08:58:30-04:00"},{"EmailAddress":"jane@example.com","SuppressionReason":"ManualSuppression","Origin":"Customer","CreatedAt":"2026-07-11T10:15:00-04:00"}]}
   */
  async listSuppressions(messageStream, suppressionReason, origin, emailAddress, fromDate, toDate) {
    const logTag = '[listSuppressions]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/message-streams/${ encodeURIComponent(messageStream) }/suppressions/dump`,
      query: {
        SuppressionReason: this.#resolveChoice(suppressionReason, SUPPRESSION_REASON_MAP),
        Origin: origin,
        EmailAddress: emailAddress,
        fromdate: fromDate,
        todate: toDate,
      },
    })
  }

  /**
   * @operationName Create Suppression
   * @category Suppressions
   * @description Adds one or more email addresses to a message stream's suppression list, preventing Postmark from delivering to them on that stream. Suppressions created this way have reason ManualSuppression and origin Customer. Returns a per-address status; check each entry because individual addresses can fail while the call succeeds.
   * @route POST /create-suppression
   *
   * @paramDef {"type":"String","label":"Message Stream","name":"messageStream","required":true,"dictionary":"getMessageStreamsDictionary","defaultValue":"outbound","description":"ID of the message stream to suppress the addresses on, e.g. outbound."}
   * @paramDef {"type":"Array<String>","label":"Email Addresses","name":"emailAddresses","required":true,"description":"Email addresses to suppress, e.g. [\"john@example.com\"]."}
   *
   * @returns {Object}
   * @sampleResult {"Suppressions":[{"EmailAddress":"john@example.com","Status":"Suppressed","Message":null}]}
   */
  async createSuppression(messageStream, emailAddresses) {
    const logTag = '[createSuppression]'

    if (!Array.isArray(emailAddresses) || !emailAddresses.length) {
      throw new Error('Postmark API error: Email Addresses must be a non-empty array.')
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/message-streams/${ encodeURIComponent(messageStream) }/suppressions`,
      method: 'post',
      body: {
        Suppressions: emailAddresses.map(email => ({ EmailAddress: email })),
      },
    })
  }

  /**
   * @operationName Delete Suppression
   * @category Suppressions
   * @description Removes one or more email addresses from a message stream's suppression list so Postmark can deliver to them again. Only suppressions with reason ManualSuppression or SpamComplaint can be deleted this way (hard-bounce suppressions must be reactivated via Activate Bounce). Returns a per-address status.
   * @route POST /delete-suppression
   *
   * @paramDef {"type":"String","label":"Message Stream","name":"messageStream","required":true,"dictionary":"getMessageStreamsDictionary","defaultValue":"outbound","description":"ID of the message stream to remove the suppressions from, e.g. outbound."}
   * @paramDef {"type":"Array<String>","label":"Email Addresses","name":"emailAddresses","required":true,"description":"Email addresses to unsuppress, e.g. [\"john@example.com\"]."}
   *
   * @returns {Object}
   * @sampleResult {"Suppressions":[{"EmailAddress":"john@example.com","Status":"Deleted","Message":null}]}
   */
  async deleteSuppression(messageStream, emailAddresses) {
    const logTag = '[deleteSuppression]'

    if (!Array.isArray(emailAddresses) || !emailAddresses.length) {
      throw new Error('Postmark API error: Email Addresses must be a non-empty array.')
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/message-streams/${ encodeURIComponent(messageStream) }/suppressions/delete`,
      method: 'post',
      body: {
        Suppressions: emailAddresses.map(email => ({ EmailAddress: email })),
      },
    })
  }

  /**
   * @operationName List Message Streams
   * @category Message Streams
   * @description Lists the message streams on your Postmark server (transactional, inbound, and broadcast streams). Optionally filter by stream type and include archived streams. Stream IDs are used by the send, search, statistics, and suppression operations.
   * @route GET /list-message-streams
   *
   * @paramDef {"type":"String","label":"Stream Type","name":"messageStreamType","uiComponent":{"type":"DROPDOWN","options":{"values":["All","Transactional","Inbound","Broadcasts"]}},"defaultValue":"All","description":"Filter by message stream type. Defaults to All."}
   * @paramDef {"type":"Boolean","label":"Include Archived Streams","name":"includeArchivedStreams","uiComponent":{"type":"CHECKBOX"},"description":"Include archived streams in the results. Defaults to false."}
   *
   * @returns {Object}
   * @sampleResult {"MessageStreams":[{"ID":"outbound","ServerID":123456,"Name":"Default Transactional Stream","Description":"Default stream used for transactional messages.","MessageStreamType":"Transactional","CreatedAt":"2026-01-10T08:58:30-04:00","UpdatedAt":null,"ArchivedAt":null,"ExpectedPurgeDate":null,"SubscriptionManagementConfiguration":{"UnsubscribeHandlingType":"None"}}],"TotalCount":1}
   */
  async listMessageStreams(messageStreamType, includeArchivedStreams) {
    const logTag = '[listMessageStreams]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/message-streams`,
      query: {
        MessageStreamType: messageStreamType || 'All',
        IncludeArchivedStreams: includeArchivedStreams === true ? 'true' : undefined,
      },
    })
  }

  /**
   * @typedef {Object} getTemplatesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter templates by name or alias."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (the offset into the template list)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Templates Dictionary
   * @description Provides a searchable list of the server's templates for selecting a template in Send Email with Template and Get Template. The option value is the numeric template ID.
   * @route POST /get-templates-dictionary
   * @paramDef {"type":"getTemplatesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Welcome Email","value":"1234","note":"Alias: welcome-email"}],"cursor":null}
   */
  async getTemplatesDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getTemplatesDictionary]'

    const offset = Number(cursor) || 0

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/templates`,
      query: {
        Count: DICTIONARY_PAGE_SIZE,
        Offset: offset,
        TemplateType: 'Standard',
      },
    })

    const templates = response.Templates || []
    const searchLower = (search || '').toLowerCase()

    const items = templates
      .filter(template => !searchLower ||
        (template.Name || '').toLowerCase().includes(searchLower) ||
        (template.Alias || '').toLowerCase().includes(searchLower))
      .map(template => ({
        label: template.Name,
        value: String(template.TemplateId),
        note: template.Alias ? `Alias: ${ template.Alias }` : undefined,
      }))

    const nextOffset = offset + templates.length

    return {
      items,
      cursor: nextOffset < (response.TotalCount || 0) ? String(nextOffset) : null,
    }
  }

  /**
   * @typedef {Object} getMessageStreamsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter streams by name or ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Postmark returns all streams in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Message Streams Dictionary
   * @description Provides the server's message streams for selecting a stream in the send, search, statistics, and suppression operations. The option value is the stream ID (e.g. outbound).
   * @route POST /get-message-streams-dictionary
   * @paramDef {"type":"getMessageStreamsDictionary__payload","label":"Payload","name":"payload","description":"Search text used to filter streams by name or ID."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Default Transactional Stream","value":"outbound","note":"Transactional"}],"cursor":null}
   */
  async getMessageStreamsDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getMessageStreamsDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/message-streams`,
      query: { MessageStreamType: 'All' },
    })

    const streams = response.MessageStreams || []
    const searchLower = (search || '').toLowerCase()

    return {
      items: streams
        .filter(stream => !searchLower ||
          (stream.Name || '').toLowerCase().includes(searchLower) ||
          (stream.ID || '').toLowerCase().includes(searchLower))
        .map(stream => ({
          label: stream.Name,
          value: stream.ID,
          note: stream.MessageStreamType,
        })),
      cursor: null,
    }
  }
}

Flowrunner.ServerCode.addService(PostmarkService, [
  {
    name: 'serverToken',
    displayName: 'Server API Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'In Postmark, open your Server and go to the API Tokens tab to copy the Server API token. Note: account-level operations (servers, domains, sender signatures) are not covered by this integration — they use a different, account-level token.',
  },
])
