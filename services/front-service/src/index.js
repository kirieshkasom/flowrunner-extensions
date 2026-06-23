const logger = {
  info: (...args) => console.log('[Front Service] info:', ...args),
  debug: (...args) => console.log('[Front Service] debug:', ...args),
  error: (...args) => console.log('[Front Service] error:', ...args),
  warn: (...args) => console.log('[Front Service] warn:', ...args),
}

const API_BASE_URL = 'https://api2.frontapp.com'
const DEFAULT_PAGE_SIZE = 25
const TRIGGER_INBOUND_CONV_CAP = 10
const TRIGGER_COMMENT_CONV_CAP = 10
const TRIGGER_STATE_ID_CAP = 500

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

function splitCsv(value) {
  if (!value) {
    return []
  }

  return value.split(',').map(s => s.trim()).filter(s => s.length > 0)
}

function normalizeAttachment(att) {
  return {
    id: att.id,
    filename: att.filename,
    content_type: att.content_type,
    size: att.size,
    url: att.url,
    is_inline: att.metadata?.is_inline ?? false,
  }
}

const MIME_EXTENSIONS = {
  'application/pdf': '.pdf',
  'application/json': '.json',
  'application/xml': '.xml',
  'application/zip': '.zip',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'text/html': '.html',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
}

function extensionForMimeType(contentType) {
  if (!contentType) {
    return ''
  }

  const type = contentType.split(';')[0].trim().toLowerCase()

  return MIME_EXTENSIONS[type] || ''
}

function hasFileExtension(name) {
  return /\.[A-Za-z0-9]{1,8}$/.test(name)
}

/**
 * @integrationName Front
 * @integrationIcon /logo.png
 * @integrationTriggersScope SINGLE_APP
 */
class FrontService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  async #apiRequest({ url, method = 'get', body, form, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ Authorization: `Bearer ${ this.apiKey }` })
        .query(cleanedQuery)

      if (form) {
        request.set({ 'Content-Type': 'multipart/form-data' })

        return await request.form(form)
      }

      if (body !== undefined) {
        request.set({ 'Content-Type': 'application/json' })

        return await request.send(body)
      }

      request.set({ 'Content-Type': 'application/json' })

      return await request
    } catch (error) {
      const errorBody = error.message
      let message

      if (errorBody && typeof errorBody === 'object' && errorBody._error) {
        message = errorBody._error.message || errorBody._error.title || JSON.stringify(errorBody._error)
      } else if (typeof errorBody === 'string') {
        message = errorBody
      } else {
        message = JSON.stringify(errorBody)
      }

      logger.error(`${ logTag } - Request failed: ${ message }`)

      throw new Error(`Front API error: ${ message }`)
    }
  }

  async #buildMessageFormData(messageParams, attachmentUrls, logTag) {
    const formData = new Flowrunner.Request.FormData()

    for (const [key, value] of Object.entries(messageParams)) {
      if (value === undefined || value === null) {
        continue
      }

      if (Array.isArray(value)) {
        value.forEach(v => formData.append(`${ key }[]`, v))
      } else if (typeof value === 'object') {
        formData.append(key, JSON.stringify(value))
      } else {
        formData.append(key, String(value))
      }
    }

    for (const url of attachmentUrls) {
      logger.debug(`${ logTag } Fetching attachment from ${ url }`)

      const fileResponse = await Flowrunner.Request.get(url).setEncoding(null).unwrapBody(false)
      const mimeType = fileResponse.headers['content-type'] || 'application/octet-stream'
      const filename = (url.split('/').pop() || 'attachment').split('?')[0]

      formData.append('attachments[]', fileResponse.body, {
        filename,
        contentType: mimeType,
      })
    }

    return formData
  }

  async #downloadBinary({ url, logTag }) {
    logger.debug(`${ logTag } - downloading binary from ${ url }`)

    const response = await Flowrunner.Request
      .get(url)
      .set({ Authorization: `Bearer ${ this.apiKey }` })
      .setEncoding(null)
      .unwrapBody(false)

    return {
      buffer: response.body,
      contentType: response.headers['content-type'] || 'application/octet-stream',
    }
  }

  // -------------------- Dictionaries --------------------

  /**
   * @typedef {Object} getInboxesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter inboxes by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor token returned in the previous response."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Inboxes Dictionary
   * @description Provides a searchable list of Front inboxes for filtering conversations or targeting triggers.
   * @route POST /get-inboxes-dictionary
   * @paramDef {"type":"getInboxesDictionary__payload","label":"Payload","name":"payload","description":"Search string and pagination cursor for filtering inboxes."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Support","value":"inb_abc","note":"shared"}],"cursor":null}
   */
  async getInboxesDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getInboxesDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: cursor || `${ API_BASE_URL }/inboxes`,
      query: cursor ? undefined : { limit: DEFAULT_PAGE_SIZE },
    })

    let inboxes = response._results || []

    if (search) {
      const term = search.toLowerCase()

      inboxes = inboxes.filter(i => (i.name || '').toLowerCase().includes(term))
    }

    return {
      items: inboxes.map(i => ({
        label: i.name,
        value: i.id,
        note: i.type || 'inbox',
      })),
      cursor: response._pagination?.next || null,
    }
  }

  /**
   * @typedef {Object} getChannelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter channels by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor token returned in the previous response."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Channels Dictionary
   * @description Provides a list of Front channels (email, SMS, chat, etc.) used as the sending channel when creating new messages or replying.
   * @route POST /get-channels-dictionary
   * @paramDef {"type":"getChannelsDictionary__payload","label":"Payload","name":"payload","description":"Search string and pagination cursor for filtering channels."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"support@example.com","value":"cha_xyz","note":"smtp"}],"cursor":null}
   */
  async getChannelsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getChannelsDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: cursor || `${ API_BASE_URL }/channels`,
      query: cursor ? undefined : { limit: DEFAULT_PAGE_SIZE },
    })

    let channels = response._results || []

    if (search) {
      const term = search.toLowerCase()

      channels = channels.filter(c =>
        (c.name || '').toLowerCase().includes(term) ||
        (c.address || '').toLowerCase().includes(term)
      )
    }

    return {
      items: channels.map(c => ({
        label: c.name || c.address,
        value: c.id,
        note: c.type || 'channel',
      })),
      cursor: response._pagination?.next || null,
    }
  }

  /**
   * @typedef {Object} getTeammatesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter teammates by name or email."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor token returned in the previous response."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Teammates Dictionary
   * @description Provides a searchable list of Front teammates for use as conversation assignees or comment authors.
   * @route POST /get-teammates-dictionary
   * @paramDef {"type":"getTeammatesDictionary__payload","label":"Payload","name":"payload","description":"Search string and pagination cursor for filtering teammates."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Jane Doe","value":"tea_001","note":"jane@example.com"}],"cursor":null}
   */
  async getTeammatesDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getTeammatesDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: cursor || `${ API_BASE_URL }/teammates`,
      query: cursor ? undefined : { limit: DEFAULT_PAGE_SIZE },
    })

    let teammates = response._results || []

    if (search) {
      const term = search.toLowerCase()

      teammates = teammates.filter(t => {
        const name = `${ t.first_name || '' } ${ t.last_name || '' }`.trim().toLowerCase()
        const email = (t.email || '').toLowerCase()
        const username = (t.username || '').toLowerCase()

        return name.includes(term) || email.includes(term) || username.includes(term)
      })
    }

    return {
      items: teammates.map(t => ({
        label: `${ t.first_name || '' } ${ t.last_name || '' }`.trim() || t.username || t.email,
        value: t.id,
        note: t.email,
      })),
      cursor: response._pagination?.next || null,
    }
  }

  /**
   * @typedef {Object} getTagsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter tags by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor token returned in the previous response."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tags Dictionary
   * @description Provides a list of Front tags for filtering conversations or applying via update.
   * @route POST /get-tags-dictionary
   * @paramDef {"type":"getTagsDictionary__payload","label":"Payload","name":"payload","description":"Search string and pagination cursor for filtering tags."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"vip","value":"tag_001","note":"highlight:red"}],"cursor":null}
   */
  async getTagsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getTagsDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: cursor || `${ API_BASE_URL }/tags`,
      query: cursor ? undefined : { limit: DEFAULT_PAGE_SIZE },
    })

    let tags = response._results || []

    if (search) {
      const term = search.toLowerCase()

      tags = tags.filter(t => (t.name || '').toLowerCase().includes(term))
    }

    return {
      items: tags.map(t => ({
        label: t.name,
        value: t.id,
        note: t.highlight ? `highlight:${ t.highlight }` : 'tag',
      })),
      cursor: response._pagination?.next || null,
    }
  }

  // -------------------- Conversations --------------------

  /**
   * @operationName List Conversations
   * @description Retrieves a paginated list of Front conversations with optional filters by inbox, tag, assignee, status, and free-text query (Front Query Language). Returns conversation metadata including subject, status, last message preview, and recipient.
   * @category Conversations
   * @route POST /list-conversations
   * @appearanceColor #A777E3 #C39FE9
   *
   * @paramDef {"type":"String","label":"Query","name":"query","description":"Optional Front Query Language string (e.g., 'subject:invoice' or 'is:unread from:acme.com'). See Front docs for syntax."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","values":["open","archived","deleted","spam","assigned","unassigned","ALL"]},"description":"Optional status filter. ALL returns conversations regardless of status."}
   * @paramDef {"type":"String","label":"Inbox","name":"inboxId","dictionary":"getInboxesDictionary","description":"Optional inbox to filter conversations to."}
   * @paramDef {"type":"String","label":"Tag","name":"tagId","dictionary":"getTagsDictionary","description":"Optional tag to filter conversations to."}
   * @paramDef {"type":"String","label":"Assignee","name":"assigneeId","dictionary":"getTeammatesDictionary","description":"Optional assignee teammate to filter conversations to."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of conversations per page. Defaults to 25, up to 100."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor URL from a prior response's _pagination.next."}
   *
   * @returns {Object}
   * @sampleResult {"_results":[{"id":"cnv_abc","subject":"Invoice question","status":"open","is_private":false,"created_at":1718200000,"last_message":{"id":"msg_zzz","is_inbound":true,"created_at":1718210000,"body":"Hi, about the invoice..."},"recipient":{"handle":"alice@example.com","role":"to"},"assignee":null,"tags":[]}],"_pagination":{"next":"https://api2.frontapp.com/conversations?page_token=..."}}
   */
  async listConversations(query, status, inboxId, tagId, assigneeId, limit, cursor) {
    const logTag = '[listConversations]'

    if (cursor) {
      return await this.#apiRequest({ logTag, url: cursor })
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/conversations`,
      query: {
        q: query,
        status: status && status !== 'ALL' ? status : undefined,
        inbox_id: inboxId,
        tag_id: tagId,
        assignee_id: assigneeId,
        limit: limit || DEFAULT_PAGE_SIZE,
      },
    })
  }

  /**
   * @operationName Get Conversation
   * @description Retrieves a single conversation by ID with full metadata: subject, status, recipient, assignee, tags, links, custom fields, and counts.
   * @category Conversations
   * @route POST /get-conversation
   * @appearanceColor #A777E3 #C39FE9
   *
   * @paramDef {"type":"String","label":"Conversation ID","name":"conversationId","required":true,"description":"The unique conversation ID (e.g., cnv_...)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"cnv_abc","subject":"Invoice question","status":"open","is_private":false,"created_at":1718200000,"recipient":{"handle":"alice@example.com","role":"to"},"assignee":{"id":"tea_001","email":"jane@example.com"},"tags":[{"id":"tag_001","name":"vip"}]}
   */
  async getConversation(conversationId) {
    const logTag = '[getConversation]'

    if (!conversationId) {
      throw new Error('Conversation ID is required')
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/conversations/${ conversationId }`,
    })
  }

  /**
   * @operationName Search Conversations
   * @description Searches conversations using Front Query Language. Supports operators like subject:, from:, is:unread, is:open, tag:, inbox:, before:/after:. Returns matching conversations sorted by relevance.
   * @category Conversations
   * @route POST /search-conversations
   * @appearanceColor #A777E3 #C39FE9
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Front Query Language query string (e.g., 'subject:refund is:open from:acme.com')."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of conversations to return. Defaults to 25, up to 100."}
   *
   * @returns {Object}
   * @sampleResult {"_results":[{"id":"cnv_abc","subject":"Refund request","status":"open","created_at":1718200000}],"_pagination":{"next":null}}
   */
  async searchConversations(query, limit) {
    const logTag = '[searchConversations]'

    if (!query) {
      throw new Error('Search query is required')
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/conversations/search/${ encodeURIComponent(query) }`,
      query: { limit: limit || DEFAULT_PAGE_SIZE },
    })
  }

  /**
   * @operationName Update Conversation
   * @description Updates a conversation's status, assignee, inbox, or tags. Only the fields you provide are changed; leave others empty to keep them unchanged.
   * @category Conversations
   * @route POST /update-conversation
   * @appearanceColor #A777E3 #C39FE9
   *
   * @paramDef {"type":"String","label":"Conversation ID","name":"conversationId","required":true,"description":"The conversation to update."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","values":["open","archived","deleted","spam"]},"description":"Optional new status."}
   * @paramDef {"type":"String","label":"Assignee","name":"assigneeId","dictionary":"getTeammatesDictionary","description":"Optional new assignee teammate ID. Pass an empty string to unassign."}
   * @paramDef {"type":"String","label":"Tag IDs","name":"tagIds","description":"Optional comma-separated tag IDs. Replaces current tags. Leave empty to keep current tags."}
   * @paramDef {"type":"String","label":"Inbox","name":"inboxId","dictionary":"getInboxesDictionary","description":"Optional inbox to move the conversation to."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"conversationId":"cnv_abc"}
   */
  async updateConversation(conversationId, status, assigneeId, tagIds, inboxId) {
    const logTag = '[updateConversation]'

    if (!conversationId) {
      throw new Error('Conversation ID is required')
    }

    const body = clean({
      status,
      assignee_id: assigneeId,
      inbox_id: inboxId,
    })

    if (tagIds) {
      body.tag_ids = splitCsv(tagIds)
    }

    await this.#apiRequest({
      logTag,
      method: 'patch',
      url: `${ API_BASE_URL }/conversations/${ conversationId }`,
      body,
    })

    return { success: true, conversationId }
  }

  /**
   * @operationName Archive Conversation
   * @description Convenience action that archives a conversation. Equivalent to Update Conversation with status set to archived.
   * @category Conversations
   * @route POST /archive-conversation
   * @appearanceColor #A777E3 #C39FE9
   *
   * @paramDef {"type":"String","label":"Conversation ID","name":"conversationId","required":true,"description":"The conversation to archive."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"conversationId":"cnv_abc"}
   */
  async archiveConversation(conversationId) {
    const logTag = '[archiveConversation]'

    if (!conversationId) {
      throw new Error('Conversation ID is required')
    }

    await this.#apiRequest({
      logTag,
      method: 'patch',
      url: `${ API_BASE_URL }/conversations/${ conversationId }`,
      body: { status: 'archived' },
    })

    return { success: true, conversationId }
  }

  /**
   * @operationName List Conversation Messages
   * @description Retrieves the paginated list of messages in a conversation, with content, author, recipients, and direction (inbound/outbound).
   * @category Conversations
   * @route POST /list-conversation-messages
   * @appearanceColor #A777E3 #C39FE9
   *
   * @paramDef {"type":"String","label":"Conversation ID","name":"conversationId","required":true,"description":"The conversation whose messages to list."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of messages per page. Defaults to 25, up to 100."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor URL from a prior response's _pagination.next."}
   *
   * @returns {Object}
   * @sampleResult {"_results":[{"id":"msg_zzz","type":"email","is_inbound":true,"created_at":1718210000,"subject":"Re: Invoice question","body":"<p>Sure, here's the info</p>","text":"Sure, here's the info","author":null,"recipients":[{"handle":"alice@example.com","role":"from"}],"attachments":[{"id":"fil_231iuypv","filename":"invoice.pdf","url":"https://api2.frontapp.com/download/fil_231iuypv","content_type":"application/pdf","size":84210,"metadata":{"is_inline":false}}]}],"_pagination":{"next":null}}
   */
  async listConversationMessages(conversationId, limit, cursor) {
    const logTag = '[listConversationMessages]'

    if (!conversationId) {
      throw new Error('Conversation ID is required')
    }

    if (cursor) {
      return await this.#apiRequest({ logTag, url: cursor })
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/conversations/${ conversationId }/messages`,
      query: { limit: limit || DEFAULT_PAGE_SIZE },
    })
  }

  /**
   * @operationName Send Message
   * @description Sends a new outbound message through a Front channel, starting a new conversation. Supports email, SMS, and other channel types. Optionally attaches files by URL (each URL is fetched and uploaded as an attachment).
   * @category Conversations
   * @route POST /send-message
   * @appearanceColor #A777E3 #C39FE9
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Channel","name":"channelId","required":true,"dictionary":"getChannelsDictionary","description":"The Front channel to send through."}
   * @paramDef {"type":"String","label":"To","name":"to","required":true,"description":"Comma-separated recipient addresses (e.g., emails or phone numbers depending on the channel)."}
   * @paramDef {"type":"String","label":"Body","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Message body. May contain HTML for email channels or plain text for SMS/chat."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"Optional subject (used for email-type channels)."}
   * @paramDef {"type":"String","label":"CC","name":"cc","description":"Optional comma-separated CC addresses."}
   * @paramDef {"type":"String","label":"BCC","name":"bcc","description":"Optional comma-separated BCC addresses."}
   * @paramDef {"type":"String","label":"Attachment URLs","name":"attachmentUrls","description":"Optional comma-separated URLs of files to attach. Each URL is fetched and uploaded as a message attachment."}
   *
   * @returns {Object}
   * @sampleResult {"id":"msg_new","type":"email","is_inbound":false,"created_at":1718220000,"subject":"Hello","body":"<p>Hi</p>"}
   */
  async sendMessage(channelId, to, body, subject, cc, bcc, attachmentUrls) {
    const logTag = '[sendMessage]'

    if (!channelId) {
      throw new Error('Channel ID is required')
    }

    if (!to) {
      throw new Error('Recipient (to) is required')
    }

    if (!body) {
      throw new Error('Body is required')
    }

    const messageParams = {
      to: splitCsv(to),
      subject,
      body,
      cc: cc ? splitCsv(cc) : undefined,
      bcc: bcc ? splitCsv(bcc) : undefined,
    }

    const attachments = splitCsv(attachmentUrls)
    const url = `${ API_BASE_URL }/channels/${ channelId }/messages`

    if (attachments.length > 0) {
      const formData = await this.#buildMessageFormData(messageParams, attachments, logTag)

      return await this.#apiRequest({
        logTag,
        method: 'post',
        url,
        form: formData,
      })
    }

    return await this.#apiRequest({
      logTag,
      method: 'post',
      url,
      body: clean(messageParams),
    })
  }

  /**
   * @operationName Reply to Conversation
   * @description Sends a reply message in an existing conversation. Uses the conversation's default channel unless a different one is specified. Optionally attaches files by URL.
   * @category Conversations
   * @route POST /reply-to-conversation
   * @appearanceColor #A777E3 #C39FE9
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Conversation ID","name":"conversationId","required":true,"description":"The conversation to reply to."}
   * @paramDef {"type":"String","label":"Body","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Reply body. May contain HTML for email channels."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"Optional subject override (otherwise the conversation's existing subject is used)."}
   * @paramDef {"type":"String","label":"Channel","name":"channelId","dictionary":"getChannelsDictionary","description":"Optional channel to reply through. Defaults to the conversation's primary channel."}
   * @paramDef {"type":"String","label":"Attachment URLs","name":"attachmentUrls","description":"Optional comma-separated URLs of files to attach. Each URL is fetched and uploaded as a reply attachment."}
   *
   * @returns {Object}
   * @sampleResult {"id":"msg_reply","type":"email","is_inbound":false,"created_at":1718230000,"body":"Thanks for reaching out"}
   */
  async replyToConversation(conversationId, body, subject, channelId, attachmentUrls) {
    const logTag = '[replyToConversation]'

    if (!conversationId) {
      throw new Error('Conversation ID is required')
    }

    if (!body) {
      throw new Error('Body is required')
    }

    const messageParams = {
      body,
      subject,
      channel_id: channelId,
    }

    const attachments = splitCsv(attachmentUrls)
    const url = `${ API_BASE_URL }/conversations/${ conversationId }/messages`

    if (attachments.length > 0) {
      const formData = await this.#buildMessageFormData(messageParams, attachments, logTag)

      return await this.#apiRequest({
        logTag,
        method: 'post',
        url,
        form: formData,
      })
    }

    return await this.#apiRequest({
      logTag,
      method: 'post',
      url,
      body: clean(messageParams),
    })
  }

  // -------------------- Attachments --------------------

  /**
   * @operationName Get Attachment
   * @description Downloads a Front message attachment and stores it in FlowRunner Files, returning a URL to the stored file. Accepts either an attachment id (e.g. fil_123) from a message's attachments list, or the attachment's full Front download URL.
   * @category Attachments
   * @route POST /get-attachment
   * @appearanceColor #A777E3 #C39FE9
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Attachment","name":"attachment","required":true,"description":"Attachment id (e.g. fil_231iuypv) or the full Front download URL from a message's attachments list."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","description":"Optional name to store the file under. Defaults to the name in the URL or 'attachment'."}
   * @paramDef {"type":"String","label":"Target Directory","name":"targetDirectory","description":"Optional folder in FlowRunner Files. Defaults to /front-attachments."}
   *
   * @returns {Object}
   * @sampleResult {"url":"https://backendlessappcontent.com/APP-ID/REST-KEY/files/front-attachments/invoice.pdf"}
   */
  async getAttachment(attachment, fileName, targetDirectory) {
    const logTag = '[getAttachment]'

    if (!attachment) {
      throw new Error('Attachment is required')
    }

    let downloadUrl

    if (/^https?:\/\//i.test(attachment)) {
      let parsed

      try {
        parsed = new URL(attachment)
      } catch (error) {
        throw new Error('Attachment URL is not a valid URL')
      }

      const host = parsed.hostname.toLowerCase()

      if (parsed.protocol !== 'https:') {
        throw new Error('Attachment URL must use HTTPS')
      }

      if (host !== 'frontapp.com' && !host.endsWith('.frontapp.com')) {
        throw new Error('Attachment URL must be a Front (frontapp.com) download link')
      }

      downloadUrl = parsed.href
    } else {
      downloadUrl = `${ API_BASE_URL }/download/${ encodeURIComponent(attachment) }`
    }

    const { buffer, contentType } = await this.#downloadBinary({ url: downloadUrl, logTag })

    let name = fileName || (downloadUrl.split('/').pop() || 'attachment').split('?')[0]

    if (!hasFileExtension(name)) {
      name += extensionForMimeType(contentType)
    }

    const directory = targetDirectory || '/front-attachments'

    const url = await Flowrunner.Files.saveFile(directory, name, buffer, true)

    return { url }
  }

  // -------------------- Comments --------------------

  /**
   * @operationName List Comments
   * @description Retrieves internal comments on a conversation. Comments are team-only notes that are not visible to the customer.
   * @category Comments
   * @route POST /list-comments
   * @appearanceColor #F5B400 #FFD261
   *
   * @paramDef {"type":"String","label":"Conversation ID","name":"conversationId","required":true,"description":"The conversation whose comments to list."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of comments per page. Defaults to 25."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor URL from a prior response's _pagination.next."}
   *
   * @returns {Object}
   * @sampleResult {"_results":[{"id":"com_001","body":"@jane can you look at this?","author":{"id":"tea_002","email":"bob@example.com"},"posted_at":1718220500}],"_pagination":{"next":null}}
   */
  async listComments(conversationId, limit, cursor) {
    const logTag = '[listComments]'

    if (!conversationId) {
      throw new Error('Conversation ID is required')
    }

    if (cursor) {
      return await this.#apiRequest({ logTag, url: cursor })
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/conversations/${ conversationId }/comments`,
      query: { limit: limit || DEFAULT_PAGE_SIZE },
    })
  }

  /**
   * @operationName Add Comment
   * @description Posts an internal comment on a conversation. Comments are team-only notes (not visible to the customer) and support @-mentions of teammates by ID.
   * @category Comments
   * @route POST /add-comment
   * @appearanceColor #F5B400 #FFD261
   *
   * @paramDef {"type":"String","label":"Conversation ID","name":"conversationId","required":true,"description":"The conversation to comment on."}
   * @paramDef {"type":"String","label":"Body","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Comment text. Use @[Teammate Name](tea_<id>) to mention a teammate."}
   * @paramDef {"type":"String","label":"Author","name":"authorId","dictionary":"getTeammatesDictionary","description":"Optional teammate to post as. Defaults to the API token's owning teammate."}
   *
   * @returns {Object}
   * @sampleResult {"id":"com_new","body":"FYI, checked the account","author":{"id":"tea_001","email":"jane@example.com"},"posted_at":1718220600}
   */
  async addComment(conversationId, body, authorId) {
    const logTag = '[addComment]'

    if (!conversationId) {
      throw new Error('Conversation ID is required')
    }

    if (!body) {
      throw new Error('Body is required')
    }

    return await this.#apiRequest({
      logTag,
      method: 'post',
      url: `${ API_BASE_URL }/conversations/${ conversationId }/comments`,
      body: clean({
        body,
        author_id: authorId,
      }),
    })
  }

  // -------------------- Contacts --------------------

  /**
   * @operationName List Contacts
   * @description Retrieves a paginated list of contacts in the Front workspace. Use Search Contacts to look up by handle (email/phone) instead.
   * @category Contacts
   * @route POST /list-contacts
   * @appearanceColor #2EC4B6 #6EE0D3
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring filter on contact name (applied locally to the page)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of contacts per page. Defaults to 25, up to 100."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor URL from a prior response's _pagination.next."}
   *
   * @returns {Object}
   * @sampleResult {"_results":[{"id":"crd_abc","name":"Alice Example","description":"Acme contact","handles":[{"handle":"alice@example.com","source":"email"}],"is_spammer":false}],"_pagination":{"next":null}}
   */
  async listContacts(search, limit, cursor) {
    const logTag = '[listContacts]'

    if (cursor) {
      return await this.#apiRequest({ logTag, url: cursor })
    }

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/contacts`,
      query: { limit: limit || DEFAULT_PAGE_SIZE },
    })

    if (search) {
      const term = search.toLowerCase()
      response._results = (response._results || []).filter(c => (c.name || '').toLowerCase().includes(term))
    }

    return response
  }

  /**
   * @operationName Get Contact
   * @description Retrieves a single contact by ID with name, description, handles (email/phone/social), and linked accounts.
   * @category Contacts
   * @route POST /get-contact
   * @appearanceColor #2EC4B6 #6EE0D3
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The contact ID (crd_...)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"crd_abc","name":"Alice Example","description":"Acme contact","handles":[{"handle":"alice@example.com","source":"email"}],"groups":[],"links":[]}
   */
  async getContact(contactId) {
    const logTag = '[getContact]'

    if (!contactId) {
      throw new Error('Contact ID is required')
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/contacts/${ contactId }`,
    })
  }

  /**
   * @operationName Create Contact
   * @description Creates a new contact with name, description, and handles. Handles is a comma-separated list in 'source:handle' format, e.g., 'email:jane@example.com,phone:+15551234567'.
   * @category Contacts
   * @route POST /create-contact
   * @appearanceColor #2EC4B6 #6EE0D3
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The contact's full name."}
   * @paramDef {"type":"String","label":"Handles","name":"handles","required":true,"description":"Comma-separated 'source:handle' entries. Valid sources: email, phone, twitter, intercom, front_chat, custom. Example: 'email:jane@example.com,phone:+15551234567'."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional free-text description of the contact."}
   * @paramDef {"type":"String","label":"Links","name":"links","description":"Optional comma-separated URLs (e.g., LinkedIn profile, Salesforce link)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"crd_new","name":"Jane Doe","description":"VIP","handles":[{"handle":"jane@example.com","source":"email"}],"links":["https://linkedin.com/in/jane"]}
   */
  async createContact(name, handles, description, links) {
    const logTag = '[createContact]'

    if (!name) {
      throw new Error('Name is required')
    }

    if (!handles) {
      throw new Error('At least one handle is required')
    }

    const handleObjects = splitCsv(handles).map(entry => {
      const [source, ...handleParts] = entry.split(':')
      const handle = handleParts.join(':').trim()

      if (!source || !handle) {
        throw new Error(`Invalid handle entry "${ entry }". Expected format 'source:handle'.`)
      }

      return { source: source.trim(), handle }
    })

    const body = clean({
      name,
      description,
      handles: handleObjects,
    })

    if (links) {
      body.links = splitCsv(links)
    }

    return await this.#apiRequest({
      logTag,
      method: 'post',
      url: `${ API_BASE_URL }/contacts`,
      body,
    })
  }

  /**
   * @operationName Update Contact
   * @description Updates a contact's name and/or description. To modify handles use Front's specific handle endpoints (not exposed in v1).
   * @category Contacts
   * @route POST /update-contact
   * @appearanceColor #2EC4B6 #6EE0D3
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The contact to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Optional new name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional new description."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"contactId":"crd_abc"}
   */
  async updateContact(contactId, name, description) {
    const logTag = '[updateContact]'

    if (!contactId) {
      throw new Error('Contact ID is required')
    }

    await this.#apiRequest({
      logTag,
      method: 'patch',
      url: `${ API_BASE_URL }/contacts/${ contactId }`,
      body: clean({ name, description }),
    })

    return { success: true, contactId }
  }

  // -------------------- Accounts --------------------

  /**
   * @operationName List Accounts
   * @description Retrieves a paginated list of accounts (companies) in the Front workspace. Accounts group contacts under a single organization.
   * @category Accounts
   * @route POST /list-accounts
   * @appearanceColor #FF6F61 #FF9389
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional substring filter on account name (applied locally to the page)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of accounts per page. Defaults to 25, up to 100."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor URL from a prior response's _pagination.next."}
   *
   * @returns {Object}
   * @sampleResult {"_results":[{"id":"act_xyz","name":"Acme Inc","description":"Key customer","domains":[{"domain":"acme.com"}],"external_id":"hub_123"}],"_pagination":{"next":null}}
   */
  async listAccounts(search, limit, cursor) {
    const logTag = '[listAccounts]'

    if (cursor) {
      return await this.#apiRequest({ logTag, url: cursor })
    }

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/accounts`,
      query: { limit: limit || DEFAULT_PAGE_SIZE },
    })

    if (search) {
      const term = search.toLowerCase()
      response._results = (response._results || []).filter(a => (a.name || '').toLowerCase().includes(term))
    }

    return response
  }

  /**
   * @operationName Get Account
   * @description Retrieves a single account by ID with name, description, domains, external ID, and custom fields.
   * @category Accounts
   * @route POST /get-account
   * @appearanceColor #FF6F61 #FF9389
   *
   * @paramDef {"type":"String","label":"Account ID","name":"accountId","required":true,"description":"The account ID (act_...)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"act_xyz","name":"Acme Inc","description":"Key customer","domains":[{"domain":"acme.com"}],"external_id":"hub_123","custom_fields":{}}
   */
  async getAccount(accountId) {
    const logTag = '[getAccount]'

    if (!accountId) {
      throw new Error('Account ID is required')
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/accounts/${ accountId }`,
    })
  }

  /**
   * @operationName Create Account
   * @description Creates a new account (company). Domains let Front automatically associate inbound emails from that domain with this account.
   * @category Accounts
   * @route POST /create-account
   * @appearanceColor #FF6F61 #FF9389
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The account/company name."}
   * @paramDef {"type":"String","label":"Domains","name":"domains","description":"Optional comma-separated domains owned by this account (e.g., 'acme.com,acme.co.uk'). Inbound emails from these domains are automatically associated with the account."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional free-text description of the account."}
   * @paramDef {"type":"String","label":"External ID","name":"externalId","description":"Optional ID from an external system (e.g., your CRM) for cross-referencing."}
   *
   * @returns {Object}
   * @sampleResult {"id":"act_new","name":"Acme Inc","description":"Key customer","domains":[{"domain":"acme.com"}],"external_id":"hub_123"}
   */
  async createAccount(name, domains, description, externalId) {
    const logTag = '[createAccount]'

    if (!name) {
      throw new Error('Name is required')
    }

    const body = clean({
      name,
      description,
      external_id: externalId,
    })

    if (domains) {
      body.domains = splitCsv(domains).map(d => ({ domain: d }))
    }

    return await this.#apiRequest({
      logTag,
      method: 'post',
      url: `${ API_BASE_URL }/accounts`,
      body,
    })
  }

  /**
   * @operationName Update Account
   * @description Updates an account's name, domains, or description. Only the fields you provide are changed.
   * @category Accounts
   * @route POST /update-account
   * @appearanceColor #FF6F61 #FF9389
   *
   * @paramDef {"type":"String","label":"Account ID","name":"accountId","required":true,"description":"The account to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Optional new name."}
   * @paramDef {"type":"String","label":"Domains","name":"domains","description":"Optional comma-separated domains. Replaces the current domain list."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional new description."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"accountId":"act_xyz"}
   */
  async updateAccount(accountId, name, domains, description) {
    const logTag = '[updateAccount]'

    if (!accountId) {
      throw new Error('Account ID is required')
    }

    const body = clean({ name, description })

    if (domains) {
      body.domains = splitCsv(domains).map(d => ({ domain: d }))
    }

    await this.#apiRequest({
      logTag,
      method: 'patch',
      url: `${ API_BASE_URL }/accounts/${ accountId }`,
      body,
    })

    return { success: true, accountId }
  }

  // -------------------- Triggers --------------------

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    return this[invocation.eventName](invocation)
  }

  /**
   * @operationName On New Conversation
   * @description Triggers when a new conversation appears in Front. Optionally filter by inbox or tag to scope which conversations wake the flow. Polling interval can be customized (minimum 30 seconds).
   * @category Triggers
   * @registerAs POLLING_TRIGGER
   * @route POST /on-new-conversation
   * @appearanceColor #A777E3 #C39FE9
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Inbox","name":"inboxId","dictionary":"getInboxesDictionary","description":"Optional. Only conversations in this inbox trigger the flow."}
   * @paramDef {"type":"String","label":"Tag","name":"tagId","dictionary":"getTagsDictionary","description":"Optional. Only conversations with this tag trigger the flow."}
   *
   * @returns {Object}
   * @sampleResult {"id":"cnv_abc","subject":"Invoice question","status":"open","created_at":1718200000,"recipient":{"handle":"alice@example.com","role":"to"},"last_message":{"id":"msg_zzz","is_inbound":true,"created_at":1718210000}}
   */
  async onNewConversation(invocation) {
    const logTag = '[onNewConversation]'
    const { inboxId, tagId } = invocation.triggerData || {}

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/conversations`,
      query: {
        inbox_id: inboxId,
        tag_id: tagId,
        limit: DEFAULT_PAGE_SIZE,
      },
    })

    return this.#diffByIdEvents(response._results || [], invocation, logTag)
  }

  /**
   * @operationName On New Inbound Message
   * @description Triggers when a new inbound message arrives in Front. Uses Front Query Language to find conversations updated since the last poll, then walks up to 10 of them to find new inbound messages. If more than 10 conversations receive new inbound messages between polls, the 11th+ may be missed. Polling interval can be customized (minimum 30 seconds); for higher fidelity, use Front's native webhooks.
   * @category Triggers
   * @registerAs POLLING_TRIGGER
   * @route POST /on-new-inbound-message
   * @appearanceColor #A777E3 #C39FE9
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Inbox","name":"inboxId","dictionary":"getInboxesDictionary","description":"Optional. Only inbound messages in this inbox trigger the flow."}
   *
   * @returns {Object}
   * @sampleResult {"id":"msg_zzz","type":"email","is_inbound":true,"created_at":1718210000,"subject":"Re: Invoice question","body":"<p>Sure</p>","conversation_id":"cnv_abc","senderEmail":"alice@example.com","recipients":[{"handle":"alice@example.com","role":"from"}],"attachments":[{"id":"fil_231iuypv","filename":"invoice.pdf","content_type":"application/pdf","size":84210,"url":"https://api2.frontapp.com/download/fil_231iuypv","is_inline":false}]}
   */
  async onNewInboundMessage(invocation) {
    const logTag = '[onNewInboundMessage]'
    const { inboxId } = invocation.triggerData || {}
    const nowSeconds = Math.floor(Date.now() / 1000)

    let query = `updated_after:${ invocation.state?.watermark || nowSeconds - 60 }`

    if (inboxId) {
      query += ` inbox:${ inboxId }`
    }

    const search = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/conversations/search/${ encodeURIComponent(query) }`,
      query: { limit: TRIGGER_INBOUND_CONV_CAP },
    })

    const conversations = (search._results || []).slice(0, TRIGGER_INBOUND_CONV_CAP)
    const watermark = invocation.state?.watermark || nowSeconds - 60
    const seenIds = new Set(invocation.state?.ids || [])
    const newMessages = []

    for (const conv of conversations) {
      const messagesResponse = await this.#apiRequest({
        logTag,
        url: `${ API_BASE_URL }/conversations/${ conv.id }/messages`,
        query: { limit: 5 },
      })

      const messages = messagesResponse._results || []

      for (const msg of messages) {
        if (msg.is_inbound && msg.created_at > watermark && !seenIds.has(msg.id)) {
          const sender = (msg.recipients || []).find(r => r.role === 'from')

          newMessages.push({
            ...msg,
            conversation_id: conv.id,
            senderEmail: sender?.handle || null,
            attachments: (msg.attachments || []).map(normalizeAttachment),
          })

          seenIds.add(msg.id)
        }
      }
    }

    if (invocation.learningMode) {
      logger.debug(`${ logTag } learningMode returning latest inbound message`)

      return {
        events: newMessages[0] ? [newMessages[0]] : [],
        state: null,
      }
    }

    if (!invocation.state) {
      logger.debug(`${ logTag } seeding state, ignoring ${ newMessages.length } existing message(s)`)

      return {
        events: [],
        state: {
          watermark: nowSeconds,
          ids: [],
        },
      }
    }

    const newWatermark = newMessages.reduce((max, m) => Math.max(max, m.created_at), watermark)
    const cappedIds = [...seenIds].slice(-TRIGGER_STATE_ID_CAP)

    logger.debug(`${ logTag } emitting ${ newMessages.length } new inbound message(s)`)

    return {
      events: newMessages,
      state: {
        watermark: newWatermark,
        ids: cappedIds,
      },
    }
  }

  /**
   * @operationName On New Comment
   * @description Triggers when a new internal comment is posted on a Front conversation. Uses Front Query Language to find conversations updated since the last poll, then walks up to 10 of them to find new comments. If more than 10 conversations receive new comments between polls, the 11th+ may be missed. Polling interval can be customized (minimum 30 seconds); for higher fidelity, use Front's native webhooks.
   * @category Triggers
   * @registerAs POLLING_TRIGGER
   * @route POST /on-new-comment
   * @appearanceColor #F5B400 #FFD261
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Inbox","name":"inboxId","dictionary":"getInboxesDictionary","description":"Optional. Only comments on conversations in this inbox trigger the flow."}
   *
   * @returns {Object}
   * @sampleResult {"id":"com_001","body":"FYI checked the account","author":{"id":"tea_001","email":"jane@example.com"},"posted_at":1718220500,"conversation_id":"cnv_abc"}
   */
  async onNewComment(invocation) {
    const logTag = '[onNewComment]'
    const { inboxId } = invocation.triggerData || {}
    const nowSeconds = Math.floor(Date.now() / 1000)

    let query = `updated_after:${ invocation.state?.watermark || nowSeconds - 60 }`

    if (inboxId) {
      query += ` inbox:${ inboxId }`
    }

    const search = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/conversations/search/${ encodeURIComponent(query) }`,
      query: { limit: TRIGGER_COMMENT_CONV_CAP },
    })

    const conversations = (search._results || []).slice(0, TRIGGER_COMMENT_CONV_CAP)
    const watermark = invocation.state?.watermark || nowSeconds - 60
    const seenIds = new Set(invocation.state?.ids || [])
    const newComments = []

    for (const conv of conversations) {
      const commentsResponse = await this.#apiRequest({
        logTag,
        url: `${ API_BASE_URL }/conversations/${ conv.id }/comments`,
        query: { limit: 10 },
      })

      const comments = commentsResponse._results || []

      for (const com of comments) {
        if (com.posted_at > watermark && !seenIds.has(com.id)) {
          newComments.push({ ...com, conversation_id: conv.id })
          seenIds.add(com.id)
        }
      }
    }

    if (invocation.learningMode) {
      logger.debug(`${ logTag } learningMode returning latest comment`)

      return {
        events: newComments[0] ? [newComments[0]] : [],
        state: null,
      }
    }

    if (!invocation.state) {
      logger.debug(`${ logTag } seeding state, ignoring ${ newComments.length } existing comment(s)`)

      return {
        events: [],
        state: {
          watermark: nowSeconds,
          ids: [],
        },
      }
    }

    const newWatermark = newComments.reduce((max, c) => Math.max(max, c.posted_at), watermark)
    const cappedIds = [...seenIds].slice(-TRIGGER_STATE_ID_CAP)

    logger.debug(`${ logTag } emitting ${ newComments.length } new comment(s)`)

    return {
      events: newComments,
      state: {
        watermark: newWatermark,
        ids: cappedIds,
      },
    }
  }

  #diffByIdEvents(items, invocation, logTag) {
    if (invocation.learningMode) {
      logger.debug(`${ logTag } learningMode returning latest item`)

      return {
        events: items[0] ? [items[0]] : [],
        state: null,
      }
    }

    if (!invocation.state?.ids) {
      logger.debug(`${ logTag } seeding state with ${ items.length } ids`)

      return {
        events: [],
        state: { ids: items.map(i => i.id) },
      }
    }

    const seen = new Set(invocation.state.ids)
    const newOnes = items.filter(i => !seen.has(i.id))

    const merged = [...items.map(i => i.id), ...invocation.state.ids]
    const dedupedIds = [...new Set(merged)].slice(0, TRIGGER_STATE_ID_CAP)

    logger.debug(`${ logTag } emitting ${ newOnes.length } new event(s)`)

    return {
      events: newOnes,
      state: { ids: dedupedIds },
    }
  }
}

Flowrunner.ServerCode.addService(FrontService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Front API token. Get it from Settings → Developers → API Tokens at https://app.frontapp.com/settings/developers/tokens',
  },
])
