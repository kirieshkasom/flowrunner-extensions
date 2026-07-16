const logger = {
  info: (...args) => console.log('[LINE] info:', ...args),
  debug: (...args) => console.log('[LINE] debug:', ...args),
  error: (...args) => console.log('[LINE] error:', ...args),
  warn: (...args) => console.log('[LINE] warn:', ...args),
}

const API_BASE_URL = 'https://api.line.me/v2/bot'
const API_DATA_BASE_URL = 'https://api-data.line.me/v2/bot'

const MAX_MULTICAST_RECIPIENTS = 500

// Remove undefined/null/empty values so we never send stray fields to the LINE API.
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
 * @integrationName LINE
 * @integrationIcon /icon.svg
 */
class LineService {
  constructor(config) {
    this.channelAccessToken = config.channelAccessToken
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, encoding, logTag }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      let request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.channelAccessToken }`,
          'Content-Type': 'application/json',
        })
        .query(clean(query))

      if (encoding === null) {
        request = request.setEncoding(null)
      }

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const responseBody = error.body || {}
      const details = Array.isArray(responseBody.details) && responseBody.details.length
        ? ` (${ responseBody.details.map(d => `${ d.property ? `${ d.property }: ` : '' }${ d.message }`).join('; ') })`
        : ''
      const message = `${ responseBody.message || error.message || 'Unknown error' }${ details }`

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`LINE API error: ${ message }`)
    }
  }

  // Build the LINE messages array. Callers may supply a plain text convenience
  // string, a raw messages array (rich message objects), or both. A raw array
  // takes precedence; when only text is given we wrap it in a text message object.
  #buildMessages(text, messages) {
    if (Array.isArray(messages) && messages.length) {
      return messages
    }

    if (typeof text === 'string' && text.length) {
      return [{ type: 'text', text }]
    }

    throw new Error('LINE API error: provide a Message text or a non-empty Messages array.')
  }

  /**
   * @operationName Push Message
   * @category Messaging
   * @description Sends a message proactively to a single user, group, or chat room by ID. Provide the destination ID plus either a simple Message text (wrapped as a text message automatically) or a raw Messages array of LINE message objects (text, image, video, sticker, template, flex, etc.) for rich content. A raw Messages array, when supplied, takes precedence over the Message text. Up to 5 message objects can be sent in one call. Note: this is a proactive push and consumes your monthly message quota.
   * @route POST /message/push
   * @paramDef {"type":"String","label":"To","name":"to","required":true,"description":"Destination ID: a user ID, group ID, or room ID obtained from a webhook event. Not a LINE display name or phone number."}
   * @paramDef {"type":"String","label":"Message","name":"text","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Plain text message body. Sent as a single text message. Ignored when a Messages array is provided. Provide this OR Messages."}
   * @paramDef {"type":"Array<Object>","label":"Messages","name":"messages","description":"Raw array of LINE message objects for rich content (e.g. [{\"type\":\"image\",\"originalContentUrl\":\"...\",\"previewImageUrl\":\"...\"}]). Max 5. Overrides Message text when non-empty."}
   * @returns {Object}
   * @sampleResult {"sentMessages":[{"id":"461230966842064897","quoteToken":"IStG5h1Tz7bkYbGuDdcqmDN..."}]}
   */
  async pushMessage(to, text, messages) {
    return await this.#apiRequest({
      logTag: '[pushMessage]',
      url: `${ API_BASE_URL }/message/push`,
      method: 'post',
      body: {
        to,
        messages: this.#buildMessages(text, messages),
      },
    })
  }

  /**
   * @operationName Reply Message
   * @category Messaging
   * @description Replies to a user's message using a reply token. The reply token is delivered inside an incoming webhook event (the `replyToken` field of a message/follow/postback event) and can only be used once, within roughly 30 seconds of receiving the event. Provide either a simple Message text or a raw Messages array (max 5). Unlike Push Message, replies do NOT consume your monthly message quota.
   * @route POST /message/reply
   * @paramDef {"type":"String","label":"Reply Token","name":"replyToken","required":true,"description":"The one-time reply token from an incoming webhook event's `replyToken` field. Valid only briefly after the event is received."}
   * @paramDef {"type":"String","label":"Message","name":"text","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Plain text reply body. Sent as a single text message. Ignored when a Messages array is provided. Provide this OR Messages."}
   * @paramDef {"type":"Array<Object>","label":"Messages","name":"messages","description":"Raw array of LINE message objects for rich replies. Max 5. Overrides Message text when non-empty."}
   * @returns {Object}
   * @sampleResult {"sentMessages":[{"id":"461230966842064898","quoteToken":"IStG5h1Tz7bkYbGuDdcqmDN..."}]}
   */
  async replyMessage(replyToken, text, messages) {
    return await this.#apiRequest({
      logTag: '[replyMessage]',
      url: `${ API_BASE_URL }/message/reply`,
      method: 'post',
      body: {
        replyToken,
        messages: this.#buildMessages(text, messages),
      },
    })
  }

  /**
   * @operationName Multicast Message
   * @category Messaging
   * @description Sends the same message to multiple users at once by their user IDs (up to 500 per call). Cannot target group or room IDs — use Push Message for those. Provide either a simple Message text or a raw Messages array (max 5 message objects). Consumes your monthly message quota (one message per recipient).
   * @route POST /message/multicast
   * @paramDef {"type":"Array<String>","label":"To","name":"to","required":true,"description":"Array of user IDs (max 500) obtained from webhook events. Group/room IDs are not allowed here."}
   * @paramDef {"type":"String","label":"Message","name":"text","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Plain text message body sent to every recipient. Ignored when a Messages array is provided. Provide this OR Messages."}
   * @paramDef {"type":"Array<Object>","label":"Messages","name":"messages","description":"Raw array of LINE message objects for rich content. Max 5. Overrides Message text when non-empty."}
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async multicastMessage(to, text, messages) {
    if (!Array.isArray(to) || !to.length) {
      throw new Error('LINE API error: provide at least one user ID in To.')
    }

    if (to.length > MAX_MULTICAST_RECIPIENTS) {
      throw new Error(`LINE API error: multicast supports at most ${ MAX_MULTICAST_RECIPIENTS } recipients per call (received ${ to.length }).`)
    }

    const result = await this.#apiRequest({
      logTag: '[multicastMessage]',
      url: `${ API_BASE_URL }/message/multicast`,
      method: 'post',
      body: {
        to,
        messages: this.#buildMessages(text, messages),
      },
    })

    // A successful multicast returns an empty body; normalize to a status object.
    return result && Object.keys(result).length ? result : { status: 'success' }
  }

  /**
   * @operationName Broadcast Message
   * @category Messaging
   * @description Sends a message to all users who have added your LINE Official Account as a friend (all followers). Provide either a simple Message text or a raw Messages array (max 5 message objects). Broadcasts consume a large portion of your monthly message quota — one message per follower — so use with care.
   * @route POST /message/broadcast
   * @paramDef {"type":"String","label":"Message","name":"text","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Plain text message body broadcast to all followers. Ignored when a Messages array is provided. Provide this OR Messages."}
   * @paramDef {"type":"Array<Object>","label":"Messages","name":"messages","description":"Raw array of LINE message objects for rich content. Max 5. Overrides Message text when non-empty."}
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async broadcastMessage(text, messages) {
    const result = await this.#apiRequest({
      logTag: '[broadcastMessage]',
      url: `${ API_BASE_URL }/message/broadcast`,
      method: 'post',
      body: {
        messages: this.#buildMessages(text, messages),
      },
    })

    return result && Object.keys(result).length ? result : { status: 'success' }
  }

  /**
   * @operationName Narrowcast Message
   * @category Messaging
   * @description Sends a message to a filtered subset of followers using a recipient filter (audience, demographic, or operator conditions) and/or a message-limit target. Provide the raw Recipient filter object and either a simple Message text or a raw Messages array (max 5). Narrowcast is processed asynchronously (LINE returns HTTP 202 Accepted with an empty body); its per-request delivery status is tracked by LINE and can be checked in the LINE Official Account Manager. Consumes your monthly message quota.
   * @route POST /message/narrowcast
   * @paramDef {"type":"String","label":"Message","name":"text","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Plain text message body. Ignored when a Messages array is provided. Provide this OR Messages."}
   * @paramDef {"type":"Array<Object>","label":"Messages","name":"messages","description":"Raw array of LINE message objects for rich content. Max 5. Overrides Message text when non-empty."}
   * @paramDef {"type":"Object","label":"Recipient","name":"recipient","description":"Recipient filter object combining audience/redelivery conditions with AND/OR/NOT operators (e.g. {\"type\":\"audience\",\"audienceGroupId\":1234567890123}). Omit to target all followers subject to the demographic filter."}
   * @paramDef {"type":"Object","label":"Demographic Filter","name":"filter","description":"Demographic filter object narrowing recipients by attributes such as age, gender, area, appType, or subscriptionPeriod."}
   * @paramDef {"type":"Number","label":"Max Recipients","name":"max","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of recipients (upper limit) for this narrowcast. Optional."}
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async narrowcastMessage(text, messages, recipient, filter, max) {
    // LINE accepts narrowcast asynchronously with a 202 and an empty body (the
    // request ID is returned only via the X-Line-Request-Id header, which the
    // request helper does not expose). Normalize the empty body to a status object.
    const result = await this.#apiRequest({
      logTag: '[narrowcastMessage]',
      url: `${ API_BASE_URL }/message/narrowcast`,
      method: 'post',
      body: clean({
        messages: this.#buildMessages(text, messages),
        recipient,
        filter,
        limit: max !== undefined && max !== null ? { max } : undefined,
      }),
    })

    return result && Object.keys(result).length ? result : { status: 'success' }
  }

  /**
   * @operationName Get Message Content
   * @category Messaging
   * @description Downloads the binary media (image, video, audio, or file) that a user sent in a message, identified by the message ID from a webhook message event. The content is fetched from LINE's content server, saved to FlowRunner file storage, and a downloadable URL is returned. Note: message content is only retrievable for a limited period after the message is received.
   * @route GET /message/content
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"description":"The `message.id` from an incoming webhook message event whose content (image/video/audio/file) you want to retrieve."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"]}
   * @returns {Object}
   * @sampleResult {"messageId":"461230966842064897","sizeBytes":204813,"url":"https://files.flowrunner.io/flow/line_content_461230966842064897"}
   */
  async getMessageContent(messageId, fileOptions) {
    const logTag = '[getMessageContent]'

    const body = await this.#apiRequest({
      logTag,
      url: `${ API_DATA_BASE_URL }/message/${ messageId }/content`,
      method: 'get',
      encoding: null,
    })

    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body)

    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename: `line_content_${ messageId }`,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return {
      messageId,
      sizeBytes: buffer.length,
      url,
    }
  }

  /**
   * @operationName Get Profile
   * @category Profile
   * @description Retrieves the LINE profile of a user who is friends with your Official Account, by user ID. Returns the display name, user ID, profile picture URL, status message, and language. Only works for users who have added your account as a friend.
   * @route GET /profile
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"description":"The user ID (starts with `U`) obtained from a webhook event's `source.userId`."}
   * @returns {Object}
   * @sampleResult {"userId":"U4af4980629...","displayName":"LINE Taro","pictureUrl":"https://profile.line-scdn.net/abcdefghijklmn","statusMessage":"Hello, LINE!","language":"en"}
   */
  async getProfile(userId) {
    return await this.#apiRequest({
      logTag: '[getProfile]',
      url: `${ API_BASE_URL }/profile/${ userId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Group Member Profile
   * @category Profile
   * @description Retrieves the profile of a specific member within a group chat, by group ID and user ID. Returns display name, user ID, and profile picture URL. The bot must be a member of the group.
   * @route GET /group/member/profile
   * @paramDef {"type":"String","label":"Group ID","name":"groupId","required":true,"description":"The group ID (starts with `C`) from a webhook event's `source.groupId`."}
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"description":"The user ID of the group member from a webhook event's `source.userId`."}
   * @returns {Object}
   * @sampleResult {"userId":"U4af4980629...","displayName":"LINE Taro","pictureUrl":"https://profile.line-scdn.net/abcdefghijklmn"}
   */
  async getGroupMemberProfile(groupId, userId) {
    return await this.#apiRequest({
      logTag: '[getGroupMemberProfile]',
      url: `${ API_BASE_URL }/group/${ groupId }/member/${ userId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Group Summary
   * @category Profile
   * @description Retrieves summary information about a group chat by group ID, including the group ID, group name, and group icon (picture URL). The bot must be a member of the group.
   * @route GET /group/summary
   * @paramDef {"type":"String","label":"Group ID","name":"groupId","required":true,"description":"The group ID (starts with `C`) from a webhook event's `source.groupId`."}
   * @returns {Object}
   * @sampleResult {"groupId":"Ca56f94637c...","groupName":"Group name","pictureUrl":"https://profile.line-scdn.net/abcdefghijklmn"}
   */
  async getGroupSummary(groupId) {
    return await this.#apiRequest({
      logTag: '[getGroupSummary]',
      url: `${ API_BASE_URL }/group/${ groupId }/summary`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Message Quota
   * @category Insights
   * @description Retrieves the monthly message quota for your LINE Official Account. Returns the quota type (`limited` or `none`) and, when limited, the maximum number of push/broadcast messages allowed in the current month.
   * @route GET /message/quota
   * @returns {Object}
   * @sampleResult {"type":"limited","value":1000}
   */
  async getMessageQuota() {
    return await this.#apiRequest({
      logTag: '[getMessageQuota]',
      url: `${ API_BASE_URL }/message/quota`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Message Consumption
   * @category Insights
   * @description Retrieves the number of messages sent in the current month that count against the monthly quota. Returns the total usage so far this month.
   * @route GET /message/quota/consumption
   * @returns {Object}
   * @sampleResult {"totalUsage":500}
   */
  async getMessageConsumption() {
    return await this.#apiRequest({
      logTag: '[getMessageConsumption]',
      url: `${ API_BASE_URL }/message/quota/consumption`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Sent Message Count
   * @category Insights
   * @description Retrieves the number of push messages successfully sent on a specific date. Provide the date in yyyyMMdd format (UTC+9). The status may be `ready` (data available in `success`), `unready` (aggregation not finished, try again later), `unavailable_for_privacy` (too few messages to report for privacy reasons), or `out_of_service` (date outside the retention period). Only dates within roughly the last 60 days are available.
   * @route GET /message/delivery/push
   * @paramDef {"type":"String","label":"Date","name":"date","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"The date to count sent push messages for, in yyyyMMdd format (e.g. 20260713), based on UTC+9. Must be within the last ~60 days."}
   * @returns {Object}
   * @sampleResult {"status":"ready","success":10000}
   */
  async getSentMessageCount(date) {
    return await this.#apiRequest({
      logTag: '[getSentMessageCount]',
      url: `${ API_BASE_URL }/message/delivery/push`,
      method: 'get',
      query: { date: this.#normalizeDate(date) },
    })
  }

  /**
   * @operationName List Rich Menus
   * @category Rich Menu
   * @description Lists all rich menus registered on your LINE Official Account. Returns each rich menu's ID, name, size, chat bar text, selection state, and defined tap areas. Rich menus are the customizable menus shown at the bottom of a chat.
   * @route GET /richmenu/list
   * @returns {Object}
   * @sampleResult {"richmenus":[{"richMenuId":"richmenu-8dfdfc571eca39c0ffcd1f799519c5b5","name":"Menu A","chatBarText":"Tap here","selected":false,"size":{"width":2500,"height":1686},"areas":[{"bounds":{"x":0,"y":0,"width":1250,"height":1686},"action":{"type":"message","text":"Hello"}}]}]}
   */
  async listRichMenus() {
    return await this.#apiRequest({
      logTag: '[listRichMenus]',
      url: `${ API_BASE_URL }/richmenu/list`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Rich Menu
   * @category Rich Menu
   * @description Retrieves a single rich menu by its ID. Returns the rich menu's name, size, chat bar text, selection state, and tap areas with their bound actions.
   * @route GET /richmenu
   * @paramDef {"type":"String","label":"Rich Menu ID","name":"richMenuId","required":true,"description":"The ID of the rich menu to retrieve (e.g. richmenu-8dfdfc571eca39c0ffcd1f799519c5b5). Use List Rich Menus to find IDs."}
   * @returns {Object}
   * @sampleResult {"richMenuId":"richmenu-8dfdfc571eca39c0ffcd1f799519c5b5","name":"Menu A","chatBarText":"Tap here","selected":false,"size":{"width":2500,"height":1686},"areas":[{"bounds":{"x":0,"y":0,"width":1250,"height":1686},"action":{"type":"message","text":"Hello"}}]}
   */
  async getRichMenu(richMenuId) {
    return await this.#apiRequest({
      logTag: '[getRichMenu]',
      url: `${ API_BASE_URL }/richmenu/${ richMenuId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Bot Info
   * @category Account
   * @description Retrieves basic information about the bot associated with the channel access token, including the bot's user ID, basic ID, premium ID, display name, icon URL, chat mode, and mark-as-read mode. Useful as a quick connection/credentials check.
   * @route GET /info
   * @returns {Object}
   * @sampleResult {"userId":"Ub9952f8...","basicId":"@216nmvn","premiumId":"@example","displayName":"Example name","pictureUrl":"https://obs.line-apps.com/abcdefghijklmn","chatMode":"chat","markAsReadMode":"manual"}
   */
  async getBotInfo() {
    return await this.#apiRequest({
      logTag: '[getBotInfo]',
      url: `${ API_BASE_URL }/info`,
      method: 'get',
    })
  }

  // The LINE delivery/push endpoint expects a yyyyMMdd date. A DATE_PICKER may
  // submit an ISO date (yyyy-MM-dd) or timestamp; strip separators so both work.
  #normalizeDate(date) {
    if (date === undefined || date === null) {
      return date
    }

    const str = String(date)
    const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/)

    if (isoMatch) {
      return `${ isoMatch[1] }${ isoMatch[2] }${ isoMatch[3] }`
    }

    return str.replace(/\D/g, '').slice(0, 8)
  }
}

Flowrunner.ServerCode.addService(LineService, [
  {
    name: 'channelAccessToken',
    displayName: 'Channel Access Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'LINE Developers Console → your Messaging API channel → Channel access token (long-lived). Sent as Authorization: Bearer <token>.',
  },
])
