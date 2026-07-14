const logger = {
  info: (...args) => console.log('[Mailjet] info:', ...args),
  debug: (...args) => console.log('[Mailjet] debug:', ...args),
  error: (...args) => console.log('[Mailjet] error:', ...args),
  warn: (...args) => console.log('[Mailjet] warn:', ...args),
}

const API_BASE_URL = 'https://api.mailjet.com'

const DEFAULT_PAGE_LIMIT = 50
const DICTIONARY_PAGE_LIMIT = 50

const CONTENT_TYPE_BY_EXTENSION = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  txt: 'text/plain',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
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
 * @integrationName Mailjet
 * @integrationIcon /icon.png
 * @usesFileStorage
 */
class MailjetService {
  constructor(config) {
    this.apiKey = config.apiKey
    this.secretKey = config.secretKey
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Basic ${ Buffer.from(`${ this.apiKey }:${ this.secretKey }`).toString('base64') }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = this.#extractErrorMessage(error)

      logger.error(`${ logTag } - Request failed: ${ message }`)

      throw new Error(`Mailjet API error: ${ message }`)
    }
  }

  #extractErrorMessage(error) {
    const errorBody = error.body

    if (errorBody) {
      if (Array.isArray(errorBody.Messages)) {
        const sendErrors = errorBody.Messages
          .flatMap(message => message.Errors || [])
          .map(item => item.ErrorMessage)
          .filter(Boolean)

        if (sendErrors.length) {
          return sendErrors.join('; ')
        }
      }

      if (errorBody.ErrorMessage) {
        return errorBody.ErrorInfo
          ? `${ errorBody.ErrorMessage } (${ errorBody.ErrorInfo })`
          : errorBody.ErrorMessage
      }
    }

    return typeof error.message === 'string' ? error.message : JSON.stringify(error.message)
  }

  #parseRecipients(recipients) {
    if (!recipients) {
      return undefined
    }

    const list = Array.isArray(recipients)
      ? recipients
      : String(recipients).split(',')

    const parsed = list
      .map(item => String(item).trim())
      .filter(Boolean)
      .map(email => ({ Email: email }))

    return parsed.length ? parsed : undefined
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  async #buildAttachments(attachmentUrls, logTag) {
    if (!attachmentUrls || !attachmentUrls.length) {
      return undefined
    }

    const attachments = []

    for (const url of attachmentUrls) {
      logger.debug(`${ logTag } - downloading attachment`)

      const bytes = await Flowrunner.Request.get(url).setEncoding(null)
      const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)

      const filename = decodeURIComponent(url.split('?')[0].split('/').pop() || `attachment_${ Date.now() }`)
      const extension = filename.includes('.') ? filename.split('.').pop().toLowerCase() : ''

      attachments.push({
        ContentType: CONTENT_TYPE_BY_EXTENSION[extension] || 'application/octet-stream',
        Filename: filename,
        Base64Content: buffer.toString('base64'),
      })
    }

    return attachments
  }

  #listResult(response) {
    return {
      count: response.Count,
      total: response.Total,
      data: response.Data || [],
    }
  }

  /**
   * @operationName Send Email
   * @category Email Sending
   * @description Sends a transactional email through the Mailjet Send API v3.1. Supports plain text and HTML content, CC/BCC recipients, reply-to, file attachments (downloaded from URLs and embedded as base64), stored Mailjet templates with variables, a custom ID and event payload for tracking, and sandbox mode for validation without actual delivery. When a template is selected, subject and body parts are optional. Returns the delivery status with a MessageID and MessageUUID for each recipient.
   * @route POST /send-email
   *
   * @paramDef {"type":"String","label":"From Email","name":"fromEmail","required":true,"description":"Sender email address. Must be a verified sender address or domain in your Mailjet account."}
   * @paramDef {"type":"String","label":"From Name","name":"fromName","description":"Sender display name shown in the recipient's inbox."}
   * @paramDef {"type":"Array<String>","label":"To","name":"to","required":true,"description":"Recipient email addresses. Accepts a list or a single comma-separated string. Maximum 50 recipients per message."}
   * @paramDef {"type":"Array<String>","label":"CC","name":"cc","description":"CC recipient email addresses. Accepts a list or a comma-separated string."}
   * @paramDef {"type":"Array<String>","label":"BCC","name":"bcc","description":"BCC recipient email addresses. Accepts a list or a comma-separated string."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"Email subject line. Optional when a template with a stored subject is used."}
   * @paramDef {"type":"String","label":"Text Part","name":"textPart","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Plain text body of the email. Optional when a template is used."}
   * @paramDef {"type":"String","label":"HTML Part","name":"htmlPart","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"HTML body of the email. Optional when a template is used."}
   * @paramDef {"type":"String","label":"Reply To","name":"replyTo","description":"Email address that replies should be sent to."}
   * @paramDef {"type":"String","label":"Template","name":"templateId","dictionary":"getTemplatesDictionary","description":"Stored Mailjet template to use instead of inline content. Select a template or enter its numeric ID."}
   * @paramDef {"type":"Boolean","label":"Template Language","name":"templateLanguage","uiComponent":{"type":"CHECKBOX"},"description":"Enable Mailjet's template language to process variables, conditions and loops in the template. Required for variable substitution."}
   * @paramDef {"type":"Object","label":"Variables","name":"variables","description":"Key-value variables injected into the template, e.g. {\"firstName\":\"John\"}. Requires Template Language to be enabled."}
   * @paramDef {"type":"Array<String>","label":"Attachment URLs","name":"attachmentUrls","description":"URLs of files to attach (e.g. FlowRunner file URLs). Each file is downloaded and embedded as a base64 attachment. Total message size must stay under Mailjet's 15 MB limit."}
   * @paramDef {"type":"String","label":"Custom ID","name":"customId","description":"Custom identifier attached to the message, returned in events and message queries for tracking."}
   * @paramDef {"type":"String","label":"Event Payload","name":"eventPayload","description":"Arbitrary payload string attached to the message and echoed back in webhook events."}
   * @paramDef {"type":"Boolean","label":"Sandbox Mode","name":"sandboxMode","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, Mailjet validates the message without sending it. No email is delivered and no MessageID is generated."}
   *
   * @returns {Object}
   * @sampleResult {"Status":"success","CustomID":"order-1234","To":[{"Email":"recipient@example.com","MessageUUID":"5e6f7a89-1b2c-3d4e-5f6a-7b8c9d0e1f2a","MessageID":576460753004591401,"MessageHref":"https://api.mailjet.com/v3/REST/message/576460753004591401"}],"Cc":[],"Bcc":[]}
   */
  async sendEmail(fromEmail, fromName, to, cc, bcc, subject, textPart, htmlPart, replyTo, templateId,
    templateLanguage, variables, attachmentUrls, customId, eventPayload, sandboxMode) {
    const logTag = '[sendEmail]'

    const message = clean({
      From: clean({ Email: fromEmail, Name: fromName }),
      To: this.#parseRecipients(to),
      Cc: this.#parseRecipients(cc),
      Bcc: this.#parseRecipients(bcc),
      Subject: subject,
      TextPart: textPart,
      HTMLPart: htmlPart,
      ReplyTo: replyTo ? { Email: replyTo } : undefined,
      TemplateID: templateId ? Number(templateId) : undefined,
      TemplateLanguage: templateLanguage || undefined,
      Variables: variables,
      Attachments: await this.#buildAttachments(attachmentUrls, logTag),
      CustomID: customId,
      EventPayload: eventPayload,
    })

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3.1/send`,
      method: 'post',
      body: clean({
        Messages: [message],
        SandboxMode: sandboxMode || undefined,
      }),
    })

    return (response.Messages && response.Messages[0]) || response
  }

  /**
   * @operationName Send Bulk Emails
   * @category Email Sending
   * @description Sends up to 50 fully-formed messages in a single Mailjet Send API v3.1 call. Each message object is passed through as-is and must follow the Mailjet v3.1 message schema, e.g. {"From":{"Email":"sender@example.com","Name":"Sender"},"To":[{"Email":"recipient@example.com"}],"Subject":"Hello","TextPart":"Hi there"}. Optional message fields include HTMLPart, Cc, Bcc, ReplyTo, TemplateID, TemplateLanguage, Variables, Attachments, CustomID and EventPayload. Returns the per-message delivery status array.
   * @route POST /send-bulk-emails
   *
   * @paramDef {"type":"Array<Object>","label":"Messages","name":"messages","required":true,"description":"Array of Mailjet v3.1 message objects (maximum 50). Each must contain at least From, To and content (Subject/TextPart/HTMLPart or TemplateID)."}
   * @paramDef {"type":"Boolean","label":"Sandbox Mode","name":"sandboxMode","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, Mailjet validates the messages without sending them. No emails are delivered."}
   *
   * @returns {Object}
   * @sampleResult {"Messages":[{"Status":"success","To":[{"Email":"a@example.com","MessageUUID":"5e6f7a89-1b2c-3d4e-5f6a-7b8c9d0e1f2a","MessageID":576460753004591401,"MessageHref":"https://api.mailjet.com/v3/REST/message/576460753004591401"}]},{"Status":"success","To":[{"Email":"b@example.com","MessageUUID":"6f7a8b9c-2c3d-4e5f-6a7b-8c9d0e1f2a3b","MessageID":576460753004591402,"MessageHref":"https://api.mailjet.com/v3/REST/message/576460753004591402"}]}]}
   */
  async sendBulkEmails(messages, sandboxMode) {
    const logTag = '[sendBulkEmails]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3.1/send`,
      method: 'post',
      body: clean({
        Messages: messages,
        SandboxMode: sandboxMode || undefined,
      }),
    })
  }

  /**
   * @operationName Create Contact
   * @category Contacts
   * @description Creates a new contact in the Mailjet global contact database. The contact can then be subscribed to contact lists and enriched with custom properties. Fails if a contact with the same email address already exists. Returns the created contact with its numeric ID.
   * @route POST /create-contact
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Contact email address. Must be unique across your Mailjet account."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Display name of the contact."}
   * @paramDef {"type":"Boolean","label":"Exclude From Campaigns","name":"isExcludedFromCampaigns","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, the contact is excluded from all marketing campaign emails but can still receive transactional messages."}
   *
   * @returns {Object}
   * @sampleResult {"ID":123456789,"Email":"contact@example.com","Name":"John Doe","IsExcludedFromCampaigns":false,"CreatedAt":"2026-01-15T10:30:00Z","DeliveredCount":0,"IsOptInPending":false,"IsSpamComplaining":false}
   */
  async createContact(email, name, isExcludedFromCampaigns) {
    const logTag = '[createContact]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/REST/contact`,
      method: 'post',
      body: clean({
        Email: email,
        Name: name,
        IsExcludedFromCampaigns: isExcludedFromCampaigns || undefined,
      }),
    })

    return (response.Data && response.Data[0]) || response
  }

  /**
   * @operationName Get Contact
   * @category Contacts
   * @description Retrieves a single contact from the Mailjet contact database by its numeric ID or email address. Returns the contact's profile including name, campaign exclusion flag, delivery counters and activity timestamps.
   * @route GET /get-contact
   *
   * @paramDef {"type":"String","label":"Contact ID or Email","name":"contactId","required":true,"description":"Numeric contact ID or the contact's email address."}
   *
   * @returns {Object}
   * @sampleResult {"ID":123456789,"Email":"contact@example.com","Name":"John Doe","IsExcludedFromCampaigns":false,"CreatedAt":"2026-01-15T10:30:00Z","DeliveredCount":5,"LastActivityAt":"2026-02-01T08:00:00Z","IsOptInPending":false,"IsSpamComplaining":false}
   */
  async getContact(contactId) {
    const logTag = '[getContact]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/REST/contact/${ encodeURIComponent(contactId) }`,
    })

    return (response.Data && response.Data[0]) || response
  }

  /**
   * @operationName List Contacts
   * @category Contacts
   * @description Retrieves contacts from the Mailjet global contact database with pagination. Returns the contacts with their IDs, email addresses, names and activity counters, plus count and total metadata.
   * @route GET /list-contacts
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of contacts to return (1-1000). Defaults to 50."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of contacts to skip for pagination. Defaults to 0."}
   *
   * @returns {Object}
   * @sampleResult {"count":2,"total":150,"data":[{"ID":123456789,"Email":"contact@example.com","Name":"John Doe","IsExcludedFromCampaigns":false,"CreatedAt":"2026-01-15T10:30:00Z","DeliveredCount":5},{"ID":123456790,"Email":"other@example.com","Name":"Jane Doe","IsExcludedFromCampaigns":false,"CreatedAt":"2026-01-16T09:00:00Z","DeliveredCount":2}]}
   */
  async listContacts(limit, offset) {
    const logTag = '[listContacts]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/REST/contact`,
      query: {
        Limit: limit || DEFAULT_PAGE_LIMIT,
        Offset: offset,
      },
    })

    return this.#listResult(response)
  }

  /**
   * @operationName Update Contact
   * @category Contacts
   * @description Updates a contact's name and campaign exclusion flag in the Mailjet contact database. The email address itself cannot be changed. Returns the updated contact.
   * @route PUT /update-contact
   *
   * @paramDef {"type":"String","label":"Contact ID or Email","name":"contactId","required":true,"description":"Numeric contact ID or the contact's email address."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New display name of the contact."}
   * @paramDef {"type":"Boolean","label":"Exclude From Campaigns","name":"isExcludedFromCampaigns","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, the contact is excluded from all marketing campaign emails but can still receive transactional messages."}
   *
   * @returns {Object}
   * @sampleResult {"ID":123456789,"Email":"contact@example.com","Name":"John Updated","IsExcludedFromCampaigns":true,"CreatedAt":"2026-01-15T10:30:00Z","DeliveredCount":5}
   */
  async updateContact(contactId, name, isExcludedFromCampaigns) {
    const logTag = '[updateContact]'

    const body = clean({ Name: name })

    if (isExcludedFromCampaigns !== undefined && isExcludedFromCampaigns !== null) {
      body.IsExcludedFromCampaigns = isExcludedFromCampaigns
    }

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/REST/contact/${ encodeURIComponent(contactId) }`,
      method: 'put',
      body,
    })

    return (response.Data && response.Data[0]) || response
  }

  /**
   * @operationName Update Contact Properties
   * @category Contacts
   * @description Sets custom property values on a contact (e.g. first name, country, plan). Properties must already be defined in your Mailjet account (Contacts - Contact properties, or via the /contactmetadata API) before values can be assigned. Provide the values as a simple key-value object; it is converted to Mailjet's Data array format. Returns the contact's updated property data.
   * @route PUT /update-contact-properties
   *
   * @paramDef {"type":"String","label":"Contact ID or Email","name":"contactId","required":true,"description":"Numeric contact ID or the contact's email address."}
   * @paramDef {"type":"Object","label":"Properties","name":"properties","required":true,"description":"Key-value object of contact property values, e.g. {\"firstname\":\"John\",\"country\":\"US\"}. Property names must match properties defined in your Mailjet account."}
   *
   * @returns {Object}
   * @sampleResult {"ID":123456789,"ContactID":123456789,"Data":[{"Name":"firstname","Value":"John"},{"Name":"country","Value":"US"}]}
   */
  async updateContactProperties(contactId, properties) {
    const logTag = '[updateContactProperties]'

    const data = Object.entries(properties || {}).map(([propertyName, value]) => ({
      Name: propertyName,
      Value: value,
    }))

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/REST/contactdata/${ encodeURIComponent(contactId) }`,
      method: 'put',
      body: { Data: data },
    })

    return (response.Data && response.Data[0]) || response
  }

  /**
   * @operationName Delete Contact
   * @category Contacts
   * @description Permanently deletes a contact from your Mailjet account using the GDPR-compliant v4 contacts endpoint. This removes the contact and its personal data irreversibly; historical statistics are anonymized. Requires the numeric contact ID (use Get Contact to look it up by email first).
   * @route DELETE /delete-contact
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"Numeric contact ID. Email addresses are not accepted by this endpoint - use Get Contact to resolve an email to its ID first."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"contactId":"123456789"}
   */
  async deleteContact(contactId) {
    const logTag = '[deleteContact]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v4/contacts/${ encodeURIComponent(contactId) }`,
      method: 'delete',
    })

    return { success: true, contactId }
  }

  /**
   * @operationName Create Contact List
   * @category Contact Lists
   * @description Creates a new contact list in your Mailjet account. Contacts can then be added to the list with Manage List Subscription. Returns the created list with its numeric ID.
   * @route POST /create-contact-list
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the contact list. Must be unique within your account."}
   *
   * @returns {Object}
   * @sampleResult {"ID":987654,"Name":"Newsletter Subscribers","Address":"abc123def","CreatedAt":"2026-01-15T10:30:00Z","IsDeleted":false,"SubscriberCount":0}
   */
  async createContactList(name) {
    const logTag = '[createContactList]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/REST/contactslist`,
      method: 'post',
      body: { Name: name },
    })

    return (response.Data && response.Data[0]) || response
  }

  /**
   * @operationName List Contact Lists
   * @category Contact Lists
   * @description Retrieves the contact lists in your Mailjet account with pagination. Returns each list's ID, name, subscriber count and creation date, plus count and total metadata.
   * @route GET /list-contact-lists
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of lists to return (1-1000). Defaults to 50."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of lists to skip for pagination. Defaults to 0."}
   *
   * @returns {Object}
   * @sampleResult {"count":2,"total":8,"data":[{"ID":987654,"Name":"Newsletter Subscribers","Address":"abc123def","CreatedAt":"2026-01-15T10:30:00Z","IsDeleted":false,"SubscriberCount":1250},{"ID":987655,"Name":"Product Updates","Address":"def456ghi","CreatedAt":"2026-01-20T12:00:00Z","IsDeleted":false,"SubscriberCount":430}]}
   */
  async listContactLists(limit, offset) {
    const logTag = '[listContactLists]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/REST/contactslist`,
      query: {
        Limit: limit || DEFAULT_PAGE_LIMIT,
        Offset: offset,
      },
    })

    return this.#listResult(response)
  }

  /**
   * @operationName Manage List Subscription
   * @category Contact Lists
   * @description Adds a contact to a contact list, removes it, or unsubscribes it, in a single call. If the contact does not exist yet, it is created automatically. "Add Force" (re)subscribes even previously unsubscribed contacts, while "Add No Force" respects an existing unsubscription. Optionally sets the contact's name and custom property values at the same time. Returns the resulting list membership record.
   * @route POST /manage-list-subscription
   *
   * @paramDef {"type":"String","label":"Contact List","name":"listId","required":true,"dictionary":"getContactListsDictionary","description":"Contact list to manage the subscription on. Select a list or enter its numeric ID."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Email address of the contact. Created automatically if it does not exist yet."}
   * @paramDef {"type":"String","label":"Action","name":"action","required":true,"defaultValue":"Add Force","uiComponent":{"type":"DROPDOWN","options":{"values":["Add Force","Add No Force","Remove","Unsubscribe"]}},"description":"Subscription action. Add Force subscribes the contact even if previously unsubscribed; Add No Force keeps an existing unsubscription; Remove deletes the contact from the list; Unsubscribe keeps it on the list but marked unsubscribed."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Display name to set on the contact."}
   * @paramDef {"type":"Object","label":"Properties","name":"properties","description":"Key-value object of contact property values to set, e.g. {\"firstname\":\"John\"}. Property names must match properties defined in your Mailjet account."}
   *
   * @returns {Object}
   * @sampleResult {"ContactID":123456789,"Email":"contact@example.com","Action":"addforce","Name":"John Doe","Properties":{"firstname":"John"}}
   */
  async manageListSubscription(listId, email, action, name, properties) {
    const logTag = '[manageListSubscription]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/REST/contactslist/${ encodeURIComponent(listId) }/managecontact`,
      method: 'post',
      body: clean({
        Email: email,
        Action: this.#resolveChoice(action, {
          'Add Force': 'addforce',
          'Add No Force': 'addnoforce',
          'Remove': 'remove',
          'Unsubscribe': 'unsub',
        }),
        Name: name,
        Properties: properties,
      }),
    })

    return (response.Data && response.Data[0]) || response
  }

  /**
   * @operationName List Templates
   * @category Templates
   * @description Retrieves the email templates owned by your Mailjet account (user-created templates, including those built with Passport). Returns each template's numeric ID, name, categories and edit mode, plus count and total metadata. Use a template's ID with Send Email.
   * @route GET /list-templates
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of templates to return (1-1000). Defaults to 50."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of templates to skip for pagination. Defaults to 0."}
   *
   * @returns {Object}
   * @sampleResult {"count":2,"total":6,"data":[{"ID":1234567,"Name":"Welcome Email","Author":"John Doe","Categories":["welcome"],"EditMode":1,"IsStarred":false,"OwnerType":"user","Purposes":["transactional"]},{"ID":1234568,"Name":"Order Confirmation","Author":"John Doe","Categories":[],"EditMode":1,"IsStarred":true,"OwnerType":"user","Purposes":["transactional"]}]}
   */
  async listTemplates(limit, offset) {
    const logTag = '[listTemplates]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/REST/template`,
      query: {
        OwnerType: 'user',
        Limit: limit || DEFAULT_PAGE_LIMIT,
        Offset: offset,
      },
    })

    return this.#listResult(response)
  }

  /**
   * @operationName List Messages
   * @category Messages & Statistics
   * @description Retrieves processed messages sent from your Mailjet account, with optional filtering by time range and recipient email address. Returns each message's ID, status, contact, sender and timing details, plus count and total metadata.
   * @route GET /list-messages
   *
   * @paramDef {"type":"String","label":"From Timestamp","name":"fromTs","description":"Only include messages sent at or after this time. RFC 3339 / ISO 8601 timestamp (e.g. 2026-01-15T00:00:00Z) or Unix timestamp in seconds."}
   * @paramDef {"type":"String","label":"To Timestamp","name":"toTs","description":"Only include messages sent at or before this time. RFC 3339 / ISO 8601 timestamp (e.g. 2026-01-31T23:59:59Z) or Unix timestamp in seconds."}
   * @paramDef {"type":"String","label":"Recipient Email","name":"contactEmail","description":"Only include messages sent to this recipient email address."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of messages to return (1-1000). Defaults to 50."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of messages to skip for pagination. Defaults to 0."}
   *
   * @returns {Object}
   * @sampleResult {"count":1,"total":320,"data":[{"ID":576460753004591401,"ArrivedAt":"2026-02-01T10:15:00Z","ContactAlt":"recipient@example.com","ContactID":123456789,"Status":"opened","Subject":"Welcome!","SenderID":112233,"FromEmail":"sender@example.com","MessageSize":2048,"SpamassassinScore":0}]}
   */
  async listMessages(fromTs, toTs, contactEmail, limit, offset) {
    const logTag = '[listMessages]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/REST/message`,
      query: {
        FromTS: fromTs,
        ToTS: toTs,
        ContactAlt: contactEmail,
        Limit: limit || DEFAULT_PAGE_LIMIT,
        Offset: offset,
      },
    })

    return this.#listResult(response)
  }

  /**
   * @operationName Get Message
   * @category Messages & Statistics
   * @description Retrieves the details of a single sent message by its Mailjet message ID (as returned by Send Email or List Messages). Returns the message's status, recipient, sender, subject, size and timing details.
   * @route GET /get-message
   *
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"description":"Numeric Mailjet message ID, e.g. from the MessageID field returned by Send Email."}
   *
   * @returns {Object}
   * @sampleResult {"ID":576460753004591401,"ArrivedAt":"2026-02-01T10:15:00Z","ContactAlt":"recipient@example.com","ContactID":123456789,"Status":"opened","Subject":"Welcome!","SenderID":112233,"FromEmail":"sender@example.com","MessageSize":2048,"SpamassassinScore":0,"UUID":"5e6f7a89-1b2c-3d4e-5f6a-7b8c9d0e1f2a"}
   */
  async getMessage(messageId) {
    const logTag = '[getMessage]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/REST/message/${ encodeURIComponent(messageId) }`,
    })

    return (response.Data && response.Data[0]) || response
  }

  /**
   * @operationName Get Message History
   * @category Messages & Statistics
   * @description Retrieves the event history of a sent message (sent, opened, clicked, bounced, etc.) by its Mailjet message ID. Returns the chronological list of events with timestamps and user agent details where available.
   * @route GET /get-message-history
   *
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"description":"Numeric Mailjet message ID, e.g. from the MessageID field returned by Send Email."}
   *
   * @returns {Object}
   * @sampleResult {"count":2,"total":2,"data":[{"Comment":"","EventAt":1769940900,"EventType":"sent","State":"","Useragent":""},{"Comment":"","EventAt":1769941200,"EventType":"opened","State":"","Useragent":"Mozilla/5.0"}]}
   */
  async getMessageHistory(messageId) {
    const logTag = '[getMessageHistory]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/REST/messagehistory/${ encodeURIComponent(messageId) }`,
    })

    return this.#listResult(response)
  }

  /**
   * @operationName Get Stat Counters
   * @category Messages & Statistics
   * @description Retrieves aggregated email statistics (sent, delivered, opened, clicked, bounced, spam, unsubscribed counts) from Mailjet's statcounters API. Statistics can be sourced for the whole API key, a specific campaign or a contact list, timed by message or by event, and aggregated at hourly, daily or lifetime resolution.
   * @route GET /get-stat-counters
   *
   * @paramDef {"type":"String","label":"Counter Source","name":"counterSource","required":true,"defaultValue":"API Key","uiComponent":{"type":"DROPDOWN","options":{"values":["API Key","Campaign","List"]}},"description":"Scope of the statistics: the entire API key, a specific campaign, or a specific contact list. Campaign and List require a Source ID."}
   * @paramDef {"type":"String","label":"Counter Timing","name":"counterTiming","required":true,"defaultValue":"Message","uiComponent":{"type":"DROPDOWN","options":{"values":["Message","Event"]}},"description":"Message groups statistics by when messages were sent; Event groups them by when events (opens, clicks) occurred."}
   * @paramDef {"type":"String","label":"Counter Resolution","name":"counterResolution","required":true,"defaultValue":"Lifetime","uiComponent":{"type":"DROPDOWN","options":{"values":["Highest","Hour","Day","Lifetime"]}},"description":"Aggregation granularity of the returned counters. Highest returns the finest resolution available; Lifetime returns a single aggregate."}
   * @paramDef {"type":"String","label":"From Timestamp","name":"fromTs","description":"Only include statistics from this time onward. RFC 3339 / ISO 8601 timestamp (e.g. 2026-01-15T00:00:00Z) or Unix timestamp in seconds."}
   * @paramDef {"type":"String","label":"To Timestamp","name":"toTs","description":"Only include statistics up to this time. RFC 3339 / ISO 8601 timestamp (e.g. 2026-01-31T23:59:59Z) or Unix timestamp in seconds."}
   * @paramDef {"type":"String","label":"Source ID","name":"sourceId","description":"Numeric ID of the campaign or contact list to get statistics for. Required when Counter Source is Campaign or List."}
   *
   * @returns {Object}
   * @sampleResult {"count":1,"total":1,"data":[{"APIKeyID":112233,"EventClickDelay":120,"EventClickedCount":45,"EventOpenDelay":60,"EventOpenedCount":230,"EventSpamCount":0,"EventUnsubscribedCount":2,"EventWorkflowExitedCount":0,"MessageBlockedCount":1,"MessageClickedCount":40,"MessageDeferredCount":0,"MessageHardBouncedCount":2,"MessageOpenedCount":210,"MessageQueuedCount":0,"MessageSentCount":500,"MessageSoftBouncedCount":3,"MessageSpamCount":0,"MessageUnsubscribedCount":2,"MessageWorkFlowExitedCount":0,"SourceID":0,"Timeslice":"","Total":500}]}
   */
  async getStatCounters(counterSource, counterTiming, counterResolution, fromTs, toTs, sourceId) {
    const logTag = '[getStatCounters]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/REST/statcounters`,
      query: {
        CounterSource: this.#resolveChoice(counterSource, {
          'API Key': 'APIKey',
          'Campaign': 'Campaign',
          'List': 'List',
        }),
        CounterTiming: counterTiming,
        CounterResolution: counterResolution,
        FromTS: fromTs,
        ToTS: toTs,
        SourceID: sourceId,
      },
    })

    return this.#listResult(response)
  }

  /**
   * @typedef {Object} getContactListsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text used to filter contact lists by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (numeric offset) returned by the previous page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Contact Lists Dictionary
   * @description Provides the account's contact lists as selectable options for the Contact List parameter in Manage List Subscription. The option value is the list's numeric ID.
   * @route POST /get-contact-lists-dictionary
   * @paramDef {"type":"getContactListsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor used to filter contact lists."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Newsletter Subscribers","value":"987654","note":"1250 subscribers"}],"cursor":"50"}
   */
  async getContactListsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getContactListsDictionary]'

    const offset = Number(cursor) || 0

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/REST/contactslist`,
      query: {
        Limit: DICTIONARY_PAGE_LIMIT,
        Offset: offset,
      },
    })

    const lists = (response.Data || [])
      .filter(list => !list.IsDeleted)
      .filter(list => !search || (list.Name || '').toLowerCase().includes(search.toLowerCase()))

    const hasMore = (response.Data || []).length === DICTIONARY_PAGE_LIMIT

    return {
      items: lists.map(list => ({
        label: list.Name,
        value: String(list.ID),
        note: `${ list.SubscriberCount ?? 0 } subscribers`,
      })),
      cursor: hasMore ? String(offset + DICTIONARY_PAGE_LIMIT) : null,
    }
  }

  /**
   * @typedef {Object} getTemplatesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text used to filter templates by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (numeric offset) returned by the previous page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Templates Dictionary
   * @description Provides the account's user-created email templates as selectable options for the Template parameter in Send Email. The option value is the template's numeric ID.
   * @route POST /get-templates-dictionary
   * @paramDef {"type":"getTemplatesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor used to filter templates."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Welcome Email","value":"1234567","note":"transactional"}],"cursor":"50"}
   */
  async getTemplatesDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getTemplatesDictionary]'

    const offset = Number(cursor) || 0

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/v3/REST/template`,
      query: {
        OwnerType: 'user',
        Limit: DICTIONARY_PAGE_LIMIT,
        Offset: offset,
      },
    })

    const templates = (response.Data || [])
      .filter(template => !search || (template.Name || '').toLowerCase().includes(search.toLowerCase()))

    const hasMore = (response.Data || []).length === DICTIONARY_PAGE_LIMIT

    return {
      items: templates.map(template => ({
        label: template.Name,
        value: String(template.ID),
        note: (template.Purposes || []).join(', ') || undefined,
      })),
      cursor: hasMore ? String(offset + DICTIONARY_PAGE_LIMIT) : null,
    }
  }
}

Flowrunner.ServerCode.addService(MailjetService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Mailjet API Key. Find it in Mailjet under Account settings > API Key Management (primary and sub-account).',
  },
  {
    name: 'secretKey',
    displayName: 'Secret Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Mailjet Secret Key, shown next to the API Key in Account settings > API Key Management.',
  },
])
