const logger = {
  info: (...args) => console.log('[SendGrid] info:', ...args),
  debug: (...args) => console.log('[SendGrid] debug:', ...args),
  error: (...args) => console.log('[SendGrid] error:', ...args),
  warn: (...args) => console.log('[SendGrid] warn:', ...args),
}

const API_BASE_URL = 'https://api.sendgrid.com/v3'

const MIME_TYPES = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  txt: 'text/plain',
  csv: 'text/csv',
  html: 'text/html',
  xml: 'application/xml',
  json: 'application/json',
  ics: 'text/calendar',
  zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  wav: 'audio/wav',
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
 * @usesFileStorage
 * @integrationName SendGrid
 * @integrationIcon /icon.png
 */
class SendGrid {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.apiKey }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const errors = error.body?.errors

      const message = Array.isArray(errors)
        ? errors.map(item => (item.field ? `${ item.field }: ${ item.message }` : item.message)).join('; ')
        : error.body?.error || error.message

      logger.error(`${ logTag } - Request failed: ${ message }`)

      throw new Error(`SendGrid API error: ${ message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #parseEmails(value) {
    if (!value) {
      return undefined
    }

    const list = Array.isArray(value) ? value : String(value).split(',')
    const emails = list.map(item => String(item).trim()).filter(Boolean)

    return emails.length ? emails.map(email => ({ email })) : undefined
  }

  async #buildAttachments(attachmentUrls, logTag) {
    if (!attachmentUrls || !attachmentUrls.length) {
      return undefined
    }

    const attachments = []

    for (const url of attachmentUrls) {
      try {
        const bytes = await Flowrunner.Request.get(url).setEncoding(null)
        const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
        const filename = decodeURIComponent(url.split('?')[0].split('/').pop() || `attachment_${ Date.now() }`)
        const extension = filename.includes('.') ? filename.split('.').pop().toLowerCase() : ''

        attachments.push({
          content: buffer.toString('base64'),
          filename,
          type: MIME_TYPES[extension] || 'application/octet-stream',
          disposition: 'attachment',
        })
      } catch (error) {
        logger.error(`${ logTag } - Failed to download attachment from ${ url }: ${ error.message }`)

        throw new Error(`SendGrid API error: failed to download attachment from ${ url }`)
      }
    }

    return attachments
  }

  async #sendMail({
    fromEmail, fromName, to, cc, bcc, replyTo, subject, textContent, htmlContent,
    templateId, dynamicTemplateData, attachmentUrls, sendAt, categories, customArgs, logTag,
  }) {
    const personalization = clean({
      to: this.#parseEmails(to),
      cc: this.#parseEmails(cc),
      bcc: this.#parseEmails(bcc),
      dynamic_template_data: dynamicTemplateData,
    })

    if (!personalization.to) {
      throw new Error('SendGrid API error: at least one "To" recipient is required')
    }

    const content = []

    if (textContent) {
      content.push({ type: 'text/plain', value: textContent })
    }

    if (htmlContent) {
      content.push({ type: 'text/html', value: htmlContent })
    }

    const payload = clean({
      personalizations: [personalization],
      from: clean({ email: fromEmail, name: fromName }),
      reply_to: replyTo ? { email: replyTo } : undefined,
      subject,
      content: content.length ? content : undefined,
      template_id: templateId,
      attachments: await this.#buildAttachments(attachmentUrls, logTag),
      send_at: sendAt,
      categories: categories && categories.length ? categories : undefined,
      custom_args: customArgs,
    })

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/mail/send`,
      method: 'post',
      body: payload,
    })

    return { queued: true }
  }

  /**
   * @operationName Send Email
   * @category Email
   * @description Sends an email through the SendGrid v3 Mail Send API. Supports multiple To/CC/BCC recipients, plain-text and/or HTML bodies, a Reply-To address, file attachments downloaded from URLs (max total message size 30 MB), scheduled sending up to 72 hours ahead, categories for analytics, and custom arguments attached to event webhooks. At least one of Text Content or HTML Content is required. SendGrid queues the message asynchronously, so a successful call returns {"queued":true} rather than a delivery confirmation.
   * @route POST /send-email
   *
   * @paramDef {"type":"String","label":"From Email","name":"fromEmail","required":true,"dictionary":"getVerifiedSendersDictionary","description":"Sender email address. Must be a verified sender or belong to an authenticated domain in your SendGrid account."}
   * @paramDef {"type":"String","label":"From Name","name":"fromName","description":"Sender display name shown in the recipient's inbox."}
   * @paramDef {"type":"Array<String>","label":"To","name":"to","required":true,"description":"Recipient email addresses. Accepts an array or a single comma-separated string."}
   * @paramDef {"type":"Array<String>","label":"CC","name":"cc","description":"CC recipient email addresses. Accepts an array or a single comma-separated string."}
   * @paramDef {"type":"Array<String>","label":"BCC","name":"bcc","description":"BCC recipient email addresses. Accepts an array or a single comma-separated string."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Email subject line."}
   * @paramDef {"type":"String","label":"Text Content","name":"textContent","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Plain-text body of the email. Provide this, HTML Content, or both."}
   * @paramDef {"type":"String","label":"HTML Content","name":"htmlContent","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"HTML body of the email. Provide this, Text Content, or both."}
   * @paramDef {"type":"String","label":"Reply To","name":"replyTo","description":"Email address that receives replies, if different from the sender."}
   * @paramDef {"type":"Array<String>","label":"Attachment URLs","name":"attachmentUrls","description":"URLs of files to attach (e.g. FlowRunner file URLs). Each file is downloaded, Base64-encoded, and attached; the filename and MIME type are inferred from the URL."}
   * @paramDef {"type":"Number","label":"Send At","name":"sendAt","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp (seconds) to schedule delivery, up to 72 hours in the future. Leave empty to send immediately."}
   * @paramDef {"type":"Array<String>","label":"Categories","name":"categories","description":"Up to 10 category names used to group the message in SendGrid statistics."}
   * @paramDef {"type":"Object","label":"Custom Args","name":"customArgs","description":"Key-value pairs (string values) attached to the message and echoed back in event webhooks, e.g. {\"orderId\":\"12345\"}."}
   *
   * @returns {Object}
   * @sampleResult {"queued":true}
   */
  async sendEmail(fromEmail, fromName, to, cc, bcc, subject, textContent, htmlContent, replyTo, attachmentUrls, sendAt, categories, customArgs) {
    if (!textContent && !htmlContent) {
      throw new Error('SendGrid API error: provide Text Content, HTML Content, or both')
    }

    return this.#sendMail({
      fromEmail, fromName, to, cc, bcc, subject, textContent, htmlContent,
      replyTo, attachmentUrls, sendAt, categories, customArgs,
      logTag: '[sendEmail]',
    })
  }

  /**
   * @operationName Send Templated Email
   * @category Email
   * @description Sends an email using a SendGrid dynamic transactional template. The template controls the subject and body; Dynamic Template Data supplies the Handlebars substitution values (e.g. {{firstName}}). Supports multiple To/CC/BCC recipients, Reply-To, URL attachments, scheduled sending up to 72 hours ahead, categories, and custom arguments. SendGrid queues the message asynchronously, so a successful call returns {"queued":true}.
   * @route POST /send-templated-email
   *
   * @paramDef {"type":"String","label":"From Email","name":"fromEmail","required":true,"dictionary":"getVerifiedSendersDictionary","description":"Sender email address. Must be a verified sender or belong to an authenticated domain in your SendGrid account."}
   * @paramDef {"type":"String","label":"From Name","name":"fromName","description":"Sender display name shown in the recipient's inbox."}
   * @paramDef {"type":"Array<String>","label":"To","name":"to","required":true,"description":"Recipient email addresses. Accepts an array or a single comma-separated string."}
   * @paramDef {"type":"Array<String>","label":"CC","name":"cc","description":"CC recipient email addresses. Accepts an array or a single comma-separated string."}
   * @paramDef {"type":"Array<String>","label":"BCC","name":"bcc","description":"BCC recipient email addresses. Accepts an array or a single comma-separated string."}
   * @paramDef {"type":"String","label":"Template ID","name":"templateId","required":true,"dictionary":"getTemplatesDictionary","description":"ID of the dynamic transactional template to use (starts with 'd-'). The template's active version defines the subject and body."}
   * @paramDef {"type":"Object","label":"Dynamic Template Data","name":"dynamicTemplateData","description":"Key-value data merged into the template's Handlebars placeholders, e.g. {\"firstName\":\"Jane\",\"orderTotal\":\"$25.00\"}."}
   * @paramDef {"type":"String","label":"Reply To","name":"replyTo","description":"Email address that receives replies, if different from the sender."}
   * @paramDef {"type":"Array<String>","label":"Attachment URLs","name":"attachmentUrls","description":"URLs of files to attach (e.g. FlowRunner file URLs). Each file is downloaded, Base64-encoded, and attached; the filename and MIME type are inferred from the URL."}
   * @paramDef {"type":"Number","label":"Send At","name":"sendAt","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp (seconds) to schedule delivery, up to 72 hours in the future. Leave empty to send immediately."}
   * @paramDef {"type":"Array<String>","label":"Categories","name":"categories","description":"Up to 10 category names used to group the message in SendGrid statistics."}
   * @paramDef {"type":"Object","label":"Custom Args","name":"customArgs","description":"Key-value pairs (string values) attached to the message and echoed back in event webhooks, e.g. {\"orderId\":\"12345\"}."}
   *
   * @returns {Object}
   * @sampleResult {"queued":true}
   */
  async sendTemplatedEmail(fromEmail, fromName, to, cc, bcc, templateId, dynamicTemplateData, replyTo, attachmentUrls, sendAt, categories, customArgs) {
    return this.#sendMail({
      fromEmail, fromName, to, cc, bcc, templateId, dynamicTemplateData,
      replyTo, attachmentUrls, sendAt, categories, customArgs,
      logTag: '[sendTemplatedEmail]',
    })
  }

  /**
   * @operationName Upsert Contacts
   * @category Contacts
   * @description Adds new contacts or updates existing ones (matched by email) in SendGrid Marketing Campaigns, optionally adding them to one or more lists. Each contact object must include an "email" property and may include "first_name", "last_name", "phone_number_id", "address_line_1", "city", "country", "postal_code" and a "custom_fields" object keyed by custom field ID. Up to 30,000 contacts (max 6 MB payload) per call. Processing is asynchronous: the returned job_id can be used to track import status in SendGrid.
   * @route PUT /upsert-contacts
   *
   * @paramDef {"type":"Array<Object>","label":"Contacts","name":"contacts","required":true,"description":"Contact objects to add or update. Each must contain an \"email\" property, e.g. [{\"email\":\"jane@example.com\",\"first_name\":\"Jane\"}]."}
   * @paramDef {"type":"Array<String>","label":"List IDs","name":"listIds","description":"IDs of marketing lists to add all of these contacts to. Select from your existing lists."}
   *
   * @returns {Object}
   * @sampleResult {"job_id":"UGkG7T8SVdTBnrLXBDlXIL"}
   */
  async upsertContacts(contacts, listIds) {
    const logTag = '[upsertContacts]'

    return this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/marketing/contacts`,
      method: 'put',
      body: clean({
        contacts,
        list_ids: listIds && listIds.length ? listIds : undefined,
      }),
    })
  }

  /**
   * @operationName Search Contacts
   * @category Contacts
   * @description Searches Marketing Campaigns contacts using SendGrid's SGQL query language, e.g. email LIKE '%@example.com' or first_name = 'Jane' AND CONTAINS(list_ids, 'list-id'). Returns up to 50 matching contacts with their full field data plus the total match count. Recently added contacts may take a few minutes to become searchable.
   * @route POST /search-contacts
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"SGQL query string, e.g. email LIKE '%@example.com' AND CONTAINS(list_ids, 'YOUR_LIST_ID'). String literals use single quotes."}
   *
   * @returns {Object}
   * @sampleResult {"result":[{"id":"5f2c1a90-9a75-4b12-b12e-1f0d6b6f7f2a","email":"jane@example.com","first_name":"Jane","last_name":"Doe","list_ids":["ca7a3796-e8a8-4029-9ccb-df8937940562"],"created_at":"2026-01-10T15:20:00Z","updated_at":"2026-02-01T09:00:00Z"}],"contact_count":1,"_metadata":{"self":"https://api.sendgrid.com/v3/marketing/contacts/search"}}
   */
  async searchContacts(query) {
    const logTag = '[searchContacts]'

    return this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/marketing/contacts/search`,
      method: 'post',
      body: { query },
    })
  }

  /**
   * @operationName Get Contact By Email
   * @category Contacts
   * @description Retrieves a single Marketing Campaigns contact by exact email address, including standard fields, list memberships, and custom field values. Fails with a not-found error if no contact has that email. Recently added contacts may take a few minutes to become available.
   * @route POST /get-contact-by-email
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Exact email address of the contact to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"result":{"jane@example.com":{"contact":{"id":"5f2c1a90-9a75-4b12-b12e-1f0d6b6f7f2a","email":"jane@example.com","first_name":"Jane","last_name":"Doe","list_ids":["ca7a3796-e8a8-4029-9ccb-df8937940562"],"created_at":"2026-01-10T15:20:00Z","updated_at":"2026-02-01T09:00:00Z"}}}}
   */
  async getContactByEmail(email) {
    const logTag = '[getContactByEmail]'

    return this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/marketing/contacts/search/emails`,
      method: 'post',
      body: { emails: [email] },
    })
  }

  /**
   * @operationName Delete Contacts
   * @category Contacts
   * @description Deletes Marketing Campaigns contacts either by a list of contact IDs or all contacts in the account when Delete All is enabled. Deletion is asynchronous and irreversible; the returned job_id can be used to track progress. Provide contact IDs (from Search Contacts) or enable Delete All, but not both.
   * @route DELETE /delete-contacts
   *
   * @paramDef {"type":"Array<String>","label":"Contact IDs","name":"contactIds","description":"IDs of the contacts to delete. Obtain IDs via Search Contacts or Get Contact By Email."}
   * @paramDef {"type":"Boolean","label":"Delete All","name":"deleteAll","uiComponent":{"type":"TOGGLE"},"description":"When enabled, permanently deletes ALL contacts in the account. Contact IDs are ignored. Use with extreme caution."}
   *
   * @returns {Object}
   * @sampleResult {"job_id":"UGkG7T8SVdTBnrLXBDlXIL"}
   */
  async deleteContacts(contactIds, deleteAll) {
    const logTag = '[deleteContacts]'

    if (!deleteAll && (!contactIds || !contactIds.length)) {
      throw new Error('SendGrid API error: provide Contact IDs or enable Delete All')
    }

    return this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/marketing/contacts`,
      method: 'delete',
      query: deleteAll ? { delete_all_contacts: 'true' } : { ids: contactIds.join(',') },
    })
  }

  /**
   * @operationName Create List
   * @category Lists
   * @description Creates a new Marketing Campaigns contact list. List names must be unique within the account (max 100 characters). Returns the new list's ID, name, and contact count.
   * @route POST /create-list
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the new list. Must be unique in your account, up to 100 characters."}
   *
   * @returns {Object}
   * @sampleResult {"id":"ca7a3796-e8a8-4029-9ccb-df8937940562","name":"Newsletter Subscribers","contact_count":0,"_metadata":{"self":"https://api.sendgrid.com/v3/marketing/lists/ca7a3796-e8a8-4029-9ccb-df8937940562"}}
   */
  async createList(name) {
    const logTag = '[createList]'

    return this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/marketing/lists`,
      method: 'post',
      body: { name },
    })
  }

  /**
   * @operationName Get Lists
   * @category Lists
   * @description Retrieves Marketing Campaigns contact lists with their IDs, names, and contact counts. Supports cursor pagination: pass the page token extracted from the previous response's _metadata.next URL to fetch the next page (up to 1000 lists per page).
   * @route GET /get-lists
   *
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of lists per page (1-1000). Defaults to 100."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from the previous response's _metadata.next URL (its page_token query parameter)."}
   *
   * @returns {Object}
   * @sampleResult {"result":[{"id":"ca7a3796-e8a8-4029-9ccb-df8937940562","name":"Newsletter Subscribers","contact_count":4210,"_metadata":{"self":"https://api.sendgrid.com/v3/marketing/lists/ca7a3796-e8a8-4029-9ccb-df8937940562"}}],"_metadata":{"self":"https://api.sendgrid.com/v3/marketing/lists"}}
   */
  async getLists(pageSize, pageToken) {
    const logTag = '[getLists]'

    return this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/marketing/lists`,
      method: 'get',
      query: {
        page_size: pageSize || 100,
        page_token: pageToken,
      },
    })
  }

  /**
   * @operationName Delete List
   * @category Lists
   * @description Deletes a Marketing Campaigns contact list by ID. By default the contacts on the list are kept in your account and only the list itself is removed; enable Delete Contacts to also delete every contact on the list (asynchronous, returns a job_id).
   * @route DELETE /delete-list
   *
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getListsDictionary","description":"ID of the list to delete."}
   * @paramDef {"type":"Boolean","label":"Delete Contacts","name":"deleteContacts","uiComponent":{"type":"TOGGLE"},"description":"When enabled, also permanently deletes all contacts on the list, not just the list itself."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"listId":"ca7a3796-e8a8-4029-9ccb-df8937940562"}
   */
  async deleteList(listId, deleteContacts) {
    const logTag = '[deleteList]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/marketing/lists/${ encodeURIComponent(listId) }`,
      method: 'delete',
      query: deleteContacts ? { delete_contacts: 'true' } : undefined,
    })

    return response || { deleted: true, listId }
  }

  /**
   * @operationName List Dynamic Templates
   * @category Templates
   * @description Retrieves the dynamic (Handlebars) transactional templates in your SendGrid account, including each template's ID, name, and versions with their subjects and active status. Supports cursor pagination via a page token from the previous response's _metadata.next URL.
   * @route GET /list-dynamic-templates
   *
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of templates per page (1-200). Defaults to 100."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from the previous response's _metadata.next URL (its page_token query parameter)."}
   *
   * @returns {Object}
   * @sampleResult {"result":[{"id":"d-3b7f2c1a9a754b12b12e1f0d6b6f7f2a","name":"Order Confirmation","generation":"dynamic","updated_at":"2026-02-01 09:00:00","versions":[{"id":"8aa74dc0-3a4e-11ec-8d3d-0242ac130003","template_id":"d-3b7f2c1a9a754b12b12e1f0d6b6f7f2a","active":1,"name":"v1","subject":"Your order {{orderId}} is confirmed"}]}],"_metadata":{"self":"https://api.sendgrid.com/v3/templates"}}
   */
  async listDynamicTemplates(pageSize, pageToken) {
    const logTag = '[listDynamicTemplates]'

    return this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/templates`,
      method: 'get',
      query: {
        generations: 'dynamic',
        page_size: pageSize || 100,
        page_token: pageToken,
      },
    })
  }

  /**
   * @operationName List Global Unsubscribes
   * @category Suppressions
   * @description Retrieves email addresses on the global unsubscribe (global suppression) list — recipients who will not receive any email from your account. Supports an optional Unix timestamp window and offset-based pagination.
   * @route GET /list-global-unsubscribes
   *
   * @paramDef {"type":"Number","label":"Start Time","name":"startTime","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp (seconds); only return unsubscribes created at or after this time."}
   * @paramDef {"type":"Number","label":"End Time","name":"endTime","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp (seconds); only return unsubscribes created at or before this time."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of records to return per page."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records to skip, for offset pagination."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"created":1735689600,"email":"jane@example.com"},{"created":1735776000,"email":"john@example.com"}]
   */
  async listGlobalUnsubscribes(startTime, endTime, limit, offset) {
    const logTag = '[listGlobalUnsubscribes]'

    return this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/suppression/unsubscribes`,
      method: 'get',
      query: {
        start_time: startTime,
        end_time: endTime,
        limit,
        offset,
      },
    })
  }

  /**
   * @operationName Add Global Unsubscribes
   * @category Suppressions
   * @description Adds one or more email addresses to the global unsubscribe (global suppression) list, preventing them from receiving any email sent through your SendGrid account. Returns the list of addresses that were added.
   * @route POST /add-global-unsubscribes
   *
   * @paramDef {"type":"Array<String>","label":"Emails","name":"emails","required":true,"description":"Email addresses to globally unsubscribe."}
   *
   * @returns {Object}
   * @sampleResult {"recipient_emails":["jane@example.com","john@example.com"]}
   */
  async addGlobalUnsubscribes(emails) {
    const logTag = '[addGlobalUnsubscribes]'

    return this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/asm/suppressions/global`,
      method: 'post',
      body: { recipient_emails: emails },
    })
  }

  /**
   * @operationName Delete Global Unsubscribe
   * @category Suppressions
   * @description Removes a single email address from the global unsubscribe (global suppression) list so it can receive email from your account again. Succeeds even if the address was not on the list.
   * @route DELETE /delete-global-unsubscribe
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Email address to remove from the global unsubscribe list."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"email":"jane@example.com"}
   */
  async deleteGlobalUnsubscribe(email) {
    const logTag = '[deleteGlobalUnsubscribe]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/asm/suppressions/global/${ encodeURIComponent(email) }`,
      method: 'delete',
    })

    return { deleted: true, email }
  }

  /**
   * @operationName List Bounces
   * @category Suppressions
   * @description Retrieves the bounce suppression list — addresses that hard-bounced and are blocked from receiving further email. Each record includes the email, bounce reason, SMTP status code, and creation timestamp. Supports an optional Unix timestamp window.
   * @route GET /list-bounces
   *
   * @paramDef {"type":"Number","label":"Start Time","name":"startTime","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp (seconds); only return bounces created at or after this time."}
   * @paramDef {"type":"Number","label":"End Time","name":"endTime","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp (seconds); only return bounces created at or before this time."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"created":1735689600,"email":"invalid@example.com","reason":"550 5.1.1 The email account that you tried to reach does not exist","status":"5.1.1"}]
   */
  async listBounces(startTime, endTime) {
    const logTag = '[listBounces]'

    return this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/suppression/bounces`,
      method: 'get',
      query: {
        start_time: startTime,
        end_time: endTime,
      },
    })
  }

  /**
   * @operationName Delete Bounces
   * @category Suppressions
   * @description Removes addresses from the bounce suppression list so SendGrid will attempt delivery to them again. Provide specific email addresses, or enable Delete All to clear the entire bounce list. Provide one or the other, not both.
   * @route DELETE /delete-bounces
   *
   * @paramDef {"type":"Array<String>","label":"Emails","name":"emails","description":"Email addresses to remove from the bounce list."}
   * @paramDef {"type":"Boolean","label":"Delete All","name":"deleteAll","uiComponent":{"type":"TOGGLE"},"description":"When enabled, removes ALL addresses from the bounce list. Emails are ignored."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true}
   */
  async deleteBounces(emails, deleteAll) {
    const logTag = '[deleteBounces]'

    if (!deleteAll && (!emails || !emails.length)) {
      throw new Error('SendGrid API error: provide Emails or enable Delete All')
    }

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/suppression/bounces`,
      method: 'delete',
      body: deleteAll ? { delete_all: true } : { emails },
    })

    return { deleted: true }
  }

  /**
   * @operationName Get Email Stats
   * @category Statistics
   * @description Retrieves global email statistics (requests, delivered, opens, clicks, bounces, spam reports, unsubscribes, and more) for a date range, optionally aggregated by day, week, or month. Dates use YYYY-MM-DD format; End Date defaults to today.
   * @route GET /get-email-stats
   *
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","required":true,"description":"First day of the reporting range in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","description":"Last day of the reporting range in YYYY-MM-DD format. Defaults to today."}
   * @paramDef {"type":"String","label":"Aggregated By","name":"aggregatedBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Day","Week","Month"]}},"defaultValue":"Day","description":"How to bucket the statistics over the date range. Defaults to Day."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"date":"2026-07-01","stats":[{"metrics":{"blocks":0,"bounce_drops":0,"bounces":1,"clicks":12,"deferred":0,"delivered":240,"invalid_emails":0,"opens":150,"processed":242,"requests":242,"spam_report_drops":0,"spam_reports":0,"unique_clicks":10,"unique_opens":98,"unsubscribe_drops":0,"unsubscribes":1}}]}]
   */
  async getEmailStats(startDate, endDate, aggregatedBy) {
    const logTag = '[getEmailStats]'

    return this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/stats`,
      method: 'get',
      query: {
        start_date: startDate,
        end_date: endDate,
        aggregated_by: this.#resolveChoice(aggregatedBy, { Day: 'day', Week: 'week', Month: 'month' }),
      },
    })
  }

  /**
   * @operationName Validate Email
   * @category Validation
   * @description Validates a single email address in real time using SendGrid Email Address Validation. Returns a validity verdict (Valid/Risky/Invalid), a 0-1 score, and detailed checks for domain validity, known bounces, suspected role addresses, and disposable domains. NOTE: this endpoint requires a SendGrid plan that includes Email Address Validation (Pro and above or a dedicated Email Validation plan) and its own Email Validation API key may be required by your account setup.
   * @route POST /validate-email
   *
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Email address to validate."}
   * @paramDef {"type":"String","label":"Source","name":"source","description":"Optional one-word label identifying where the address was captured, e.g. signup."}
   *
   * @returns {Object}
   * @sampleResult {"result":{"email":"jane@example.com","verdict":"Valid","score":0.85021,"local":"jane","host":"example.com","checks":{"domain":{"has_valid_address_syntax":true,"has_mx_or_a_record":true,"is_suspected_disposable_address":false},"local_part":{"is_suspected_role_address":false},"additional":{"has_known_bounces":false,"has_suspected_bounces":false}},"source":"SIGNUP","ip_address":"192.0.2.10"}}
   */
  async validateEmail(email, source) {
    const logTag = '[validateEmail]'

    return this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/validations/email`,
      method: 'post',
      body: clean({ email, source }),
    })
  }

  /**
   * @operationName Get Verified Senders
   * @category Senders
   * @description Retrieves the verified sender identities configured in your SendGrid account, including each sender's from/reply-to addresses, nickname, and verification status. Only verified senders (or authenticated domains) can be used as the From address when sending email.
   * @route GET /get-verified-senders
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of senders to return. Defaults to all."}
   * @paramDef {"type":"Number","label":"Last Seen ID","name":"lastSeenId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Return only senders with an ID greater than this value, for pagination."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"id":1234,"nickname":"Support","from_email":"support@example.com","from_name":"Example Support","reply_to":"support@example.com","reply_to_name":"Example Support","address":"1 Main St","city":"Denver","country":"USA","verified":true,"locked":false}]}
   */
  async getVerifiedSenders(limit, lastSeenId) {
    const logTag = '[getVerifiedSenders]'

    return this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/verified_senders`,
      method: 'get',
      query: {
        limit,
        lastSeenID: lastSeenId,
      },
    })
  }

  #extractPageToken(metadata) {
    const next = metadata?.next

    if (!next) {
      return null
    }

    try {
      return new URL(next).searchParams.get('page_token')
    } catch (_) {
      return null
    }
  }

  /**
   * @typedef {Object} getListsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text used to filter lists by name (client-side, case-insensitive)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from the previous dictionary response."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Lists Dictionary
   * @description Provides Marketing Campaigns contact lists for selection in list parameters. The option value is the list ID; the note shows the contact count.
   * @route POST /get-lists-dictionary
   * @paramDef {"type":"getListsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Newsletter Subscribers","value":"ca7a3796-e8a8-4029-9ccb-df8937940562","note":"4210 contacts"}],"cursor":null}
   */
  async getListsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getListsDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/marketing/lists`,
      method: 'get',
      query: {
        page_size: 100,
        page_token: cursor,
      },
    })

    let lists = response.result || []

    if (search) {
      const term = search.toLowerCase()
      lists = lists.filter(list => (list.name || '').toLowerCase().includes(term))
    }

    return {
      items: lists.map(list => ({
        label: list.name,
        value: list.id,
        note: `${ list.contact_count ?? 0 } contacts`,
      })),
      cursor: this.#extractPageToken(response._metadata),
    }
  }

  /**
   * @typedef {Object} getTemplatesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text used to filter templates by name (client-side, case-insensitive)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from the previous dictionary response."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Templates Dictionary
   * @description Provides dynamic transactional templates for selection in Send Templated Email. The option value is the template ID (d-...); the note shows the active version's subject when available.
   * @route POST /get-templates-dictionary
   * @paramDef {"type":"getTemplatesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Order Confirmation","value":"d-3b7f2c1a9a754b12b12e1f0d6b6f7f2a","note":"Your order {{orderId}} is confirmed"}],"cursor":null}
   */
  async getTemplatesDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getTemplatesDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/templates`,
      method: 'get',
      query: {
        generations: 'dynamic',
        page_size: 100,
        page_token: cursor,
      },
    })

    let templates = response.result || response.templates || []

    if (search) {
      const term = search.toLowerCase()
      templates = templates.filter(template => (template.name || '').toLowerCase().includes(term))
    }

    return {
      items: templates.map(template => {
        const activeVersion = (template.versions || []).find(version => version.active === 1)

        return {
          label: template.name,
          value: template.id,
          note: activeVersion?.subject || undefined,
        }
      }),
      cursor: this.#extractPageToken(response._metadata),
    }
  }

  /**
   * @typedef {Object} getVerifiedSendersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text used to filter senders by email, name, or nickname (client-side, case-insensitive)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. The verified senders list is returned in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Verified Senders Dictionary
   * @description Provides verified sender identities for selecting the From address in Send Email and Send Templated Email. The option value is the sender's email address; unverified senders are marked in the note.
   * @route POST /get-verified-senders-dictionary
   * @paramDef {"type":"getVerifiedSendersDictionary__payload","label":"Payload","name":"payload","description":"Search text used to filter verified senders."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Example Support <support@example.com>","value":"support@example.com","note":"Support"}],"cursor":null}
   */
  async getVerifiedSendersDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getVerifiedSendersDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/verified_senders`,
      method: 'get',
    })

    let senders = response.results || []

    if (search) {
      const term = search.toLowerCase()

      senders = senders.filter(sender =>
        [sender.from_email, sender.from_name, sender.nickname].some(
          value => (value || '').toLowerCase().includes(term)
        )
      )
    }

    return {
      items: senders.map(sender => {
        const noteParts = [sender.nickname, sender.verified === false ? 'NOT VERIFIED' : null].filter(Boolean)

        return {
          label: sender.from_name ? `${ sender.from_name } <${ sender.from_email }>` : sender.from_email,
          value: sender.from_email,
          note: noteParts.join(' - ') || undefined,
        }
      }),
      cursor: null,
    }
  }
}

Flowrunner.ServerCode.addService(SendGrid, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your SendGrid API key (Settings > API Keys in the SendGrid dashboard). Use a key with Full Access, or at least Mail Send, Marketing, Suppressions, Stats, and Template Engine scopes.',
  },
])
