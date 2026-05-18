const { chunkMarkdown } = require('./utils')

const OAUTH_BASE_URL = 'https://slack.com/oauth/v2'
const API_BASE_URL = 'https://slack.com/api'

const MAX_CHANNELS_LIMIT = 1000
const MAX_MEMBERS_LIMIT = 1000
const MAX_CHANNEL_MESSAGES_LIMIT = 100
const MAX_THREAD_MESSAGES_LIMIT = 1000

const DEFAULT_SCOPE_LIST = [
  'channels:history',
  'channels:read',
  'channels:join',
  'channels:manage',
  'chat:write',
  'chat:write.customize',
  'chat:write.public',
  'commands',
  'files:write',
  'groups:history',
  'groups:read',
  'groups:write',
  'im:write',
  'mpim:write',
  'reactions:read',
  'reminders:write',
  'team:read',
  'users.profile:read',
  'users:read',
  'users:read.email',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const USER_SCOPE_LIST = [
  'channels:history',
  'channels:read',
  'channels:write',
  'chat:write',
  'emoji:read',
  'files:read',
  'files:write',
  'groups:history',
  'groups:read',
  'groups:write',
  'im:write',
  'mpim:write',
  'reactions:read',
  'reminders:write',
  'search:read',
  'stars:read',
  'team:read',
  'users.profile:write',
  'users:read',
  'users:read.email',
]

const USER_SCOPE_STRING = USER_SCOPE_LIST.join(' ')

const REACTIONS = [
  { label: '✅', value: 'white_check_mark', note: 'ID: white_check_mark' },
  { label: '❌', value: 'x', note: 'ID: x' },
  { label: '🚀', value: 'rocket', note: 'ID: rocket' },
  { label: '🔥', value: 'fire', note: 'ID: fire' },
  { label: '🚨', value: 'rotating_light', note: 'ID: rotating_light' },
  { label: '🐛', value: 'bug', note: 'ID: bug' },
  { label: '🔧', value: 'wrench', note: 'ID: wrench' },
  { label: '👀', value: 'eyes', note: 'ID: eyes' },
  { label: '👍', value: '+1', note: 'ID: +1' },
  { label: '👎', value: '-1', note: 'ID: -1' },
  { label: '🛑', value: 'stop_sign', note: 'ID: stop_sign' },
  { label: '💡', value: 'bulb', note: 'ID: bulb' },
  { label: '📌', value: 'pushpin', note: 'ID: pushpin' },
  { label: '🔄', value: 'arrows_counterclockwise', note: 'ID: arrows_counterclockwise' },
  { label: '🎯', value: 'dart', note: 'ID: dart' },
  { label: '1️⃣', value: 'one', note: 'ID: one' },
  { label: '2️⃣', value: 'two', note: 'ID: two' },
  { label: '3️⃣', value: 'three', note: 'ID: three' },
  { label: '4️⃣', value: 'four', note: 'ID: four' },
  { label: '5️⃣', value: 'five', note: 'ID: five' },
  { label: '6️⃣', value: 'six', note: 'ID: six' },
  { label: '7️⃣', value: 'seven', note: 'ID: seven' },
  { label: '8️⃣', value: 'eight', note: 'ID: eight' },
  { label: '9️⃣', value: 'nine', note: 'ID: nine' },
  { label: '🔟', value: 'ten', note: 'ID: ten' },
]

const MethodCallTypes = {
  SHAPE_EVENT: 'SHAPE_EVENT',
  FILTER_TRIGGER: 'FILTER_TRIGGER',
}

const EventTypes = {
  message: 'onChannelMessage',
  reaction_added: 'onReactionAdded',
  star_added: 'onMessageSaved',
  emoji_changed: 'onCustomEmojiAdded',
  team_join: 'onNewMember',
  channel_created: 'onChannelCreated',
  file_shared: 'onFileShared',
}

const BOT_EVENTS = new Set([
  EventTypes.message,
  EventTypes.file_shared,
  EventTypes.reaction_added,
])

const logger = {
  info: (...args) => console.log('[Slack Service] info:', ...args),
  debug: (...args) => console.log('[Slack Service] debug:', ...args),
  error: (...args) => console.log('[Slack Service] error:', ...args),
  warn: (...args) => console.log('[Slack Service] warn:', ...args),
}

/**
 *  @requireOAuth
 *  @integrationName Slack
 *  @integrationTriggersScope ALL_APPS
 *  @integrationIcon /icon.png
 **/
class Slack {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scope = config.scope || DEFAULT_SCOPE_STRING
    this.userScope = config.scope || USER_SCOPE_STRING
  }

  #resolveAccessTokens() {
    if (this.accessTokensResolved) {
      return
    }

    const accessTokenStr = this.request.headers['oauth-access-token']

    if (accessTokenStr) {
      const accessTokens = deserializeToken(accessTokenStr)

      if (!accessTokens.u || !accessTokens.b) {
        throw new Error('Can not parse AccessTokens because of wrong format')
      }

      this.userAccessToken = accessTokens.u
      this.botAccessToken = accessTokens.b

      this.accessTokensResolved = true
    }
  }

  async #apiRequest({ url, method, body, query, logTag, bot }) {
    this.#resolveAccessTokens()

    method = method || 'get'

    query = cleanupObject(query)

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      return await Flowrunner.Request[method](url)
        .set(this.#getAccessTokenHeader(bot ? this.botAccessToken : this.userAccessToken))
        .query(query)
        .send(body)
        .then(resolveSlackResponse)
    } catch (error) {
      logger.error(`${ logTag } - error: ${ error.message }`)

      throw error
    }
  }

  #getAccessTokenHeader(accessToken) {
    return {
      Authorization: `Bearer ${ accessToken }`,
    }
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('scope', this.scope)
    params.append('user_scope', this.userScope)

    return `${ OAUTH_BASE_URL }/authorize?${ params.toString() }`
  }

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   *
   * @param {String} refreshToken
   *
   * @returns {Object}
   */
  async refreshToken(refreshToken) {
    const refreshTokens = deserializeToken(refreshToken)

    const userRefreshToken = refreshTokens.u
    const botRefreshToken = refreshTokens.b

    if (!userRefreshToken || !botRefreshToken) {
      throw new Error('Can not parse RefreshTokens because of wrong format')
    }

    const userData = await refreshTokenFor(this, userRefreshToken)
    const botData = await refreshTokenFor(this, botRefreshToken)

    return serializeTokens(userData, botData)
  }

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {Object}
   */
  async executeCallback(callbackObject) {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)
    params.append('code', callbackObject.code)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('grant_type', 'authorization_code')

    let codeExchangeResponse = {}

    try {
      codeExchangeResponse = await Flowrunner.Request.post(`${ API_BASE_URL }/oauth.v2.access`)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())
        .then(resolveSlackResponse)

      logger.debug(`[executeCallback] codeExchangeResponse response: ${ JSON.stringify(codeExchangeResponse, null, 2) }`)
    } catch (error) {
      logger.error(`[executeCallback] codeExchangeResponse error: ${ error.message }`)

      return {}
    }

    const userData = {
      userId: codeExchangeResponse.authed_user.id,
      access_token: codeExchangeResponse.authed_user.access_token,
      refresh_token: codeExchangeResponse.authed_user.refresh_token,
      expires_in: codeExchangeResponse.authed_user.expires_in,
    }

    const botData = {
      userId: codeExchangeResponse.bot_user_id,
      access_token: codeExchangeResponse.access_token,
      refresh_token: codeExchangeResponse.refresh_token,
      expires_in: codeExchangeResponse.expires_in,
    }

    const { token, expirationInSeconds, refreshToken } = serializeTokens(userData, botData)

    let userInfo = {}

    try {
      userInfo = await Flowrunner.Request.get(`${ API_BASE_URL }/users.info`)
        .set(this.#getAccessTokenHeader(userData.access_token))
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .query({
          user: userData.userId,
        })
        .then(resolveSlackResponse)

      logger.debug(`[executeCallback] userInfo response: ${ JSON.stringify(userInfo, null, 2) }`)
    } catch (error) {
      logger.error(`[executeCallback] userInfo error: ${ error.message }`)

      return {}
    }

    return {
      token,
      expirationInSeconds,
      refreshToken,
      overwrite: true,
      connectionIdentityName: `@${ userInfo.user?.real_name } (${ codeExchangeResponse.team.name })`,
      connectionIdentityImageURL: userInfo.user?.profile?.image_24,
      userData: {
        team: codeExchangeResponse.team,
        userId: userData.userId,
        botUserId: botData.userId,
      },
    }
  }

  /**
   * @operationName On Message from Query
   * @category Message Monitoring
   * @description Checks Slack for new messages matching a given query. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   *
   * @route POST /on-message-from-query
   * @executionTimeoutInSeconds 120
   * @appearanceColor #f9566d #fb874b
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Slack search query string. Refer to Slack API documentation for syntax."}
   *
   * @returns {Object}
   * @sampleResult {"iid":"9d66d0a3-329d-4bb3-871e-954a109d5375","team":"T012340Z125V","score":0,"channel":{"id":"C0812345D96","is_channel":true,"is_group":false,"is_im":false,"is_mpim":false,"is_shared":false,"is_org_shared":false,"is_ext_shared":false,"is_private":true,"name":"test-channel-name","pending_shared":[],"is_pending_ext_shared":false},"type":"message","user":"U012345UJS2","username":"test.username","ts":"1745500292.281239","files":[{"id":"F08123456LKS","created":1745500277,"timestamp":1745500277,"name":"2024-10-30 22-56-57.png","title":"2024-10-30 22-56-57.png","mimetype":"image/png","filetype":"png","pretty_type":"PNG","user":"U012345UJS2","user_team":"T012340Z125V","editable":false,"size":9977,"mode":"hosted","is_external":false,"external_type":"","is_public":false,"public_url_shared":false,"display_as_bot":false,"username":"","url_private":"https://files.slack.com/files-pri/T012340Z125V-F08123456LKS/2024-10-30_22-56-57.png","url_private_download":"https://files.slack.com/files-pri/T012340Z125V-F08123456LKS/download/2024-10-30_22-56-57.png","media_display_type":"unknown","thumb_64":"https://files.slack.com/files-tmb/T012340Z125V-F08123456LKS-656e23e7c1/2024-10-30_22-56-57_64.png","thumb_80":"https://files.slack.com/files-tmb/T012340Z125V-F08123456LKS-656e23e7c1/2024-10-30_22-56-57_80.png","thumb_360":"https://files.slack.com/files-tmb/T012340Z125V-F08123456LKS-656e23e7c1/2024-10-30_22-56-57_360.png","thumb_360_w":200,"thumb_360_h":200,"thumb_160":"https://files.slack.com/files-tmb/T012340Z125V-F08123456LKS-656e23e7c1/2024-10-30_22-56-57_160.png","original_w":200,"original_h":200,"thumb_tiny":"AwAwADCpVwThuAe/pQBoTQR3zLdhn+JfWntzMxyxJPuc0lFFAH//Z","permalink":"https://testworksp.slack.com/files/U012345UJS2/F08123456LKS/2024-10-30_22-56-57.png","permalink_public":"https://slack-files.com/T012340Z125V-F08123456LKS-2c6bfa514a","is_starred":false,"has_rich_preview":false,"file_access":"visible"}],"blocks":[{"type":"section","block_id":"zYtvT","text":{"type":"mrkdwn","text":"message text","verbatim":false}}],"text":"message text","permalink":"https://testworksp.slack.com/archives/C0812345D96/p1745123456281239","no_reactions":true}
   */
  async onMessageFromQuery(invocation) {
    const searchResult = await this.searchMessages(invocation.triggerData.query)

    const messages = searchResult.messages.matches

    if (invocation.learningMode) {
      const message = messages[0]

      logger.debug(`in onMessageFromQuery trigger learningMode message.id=${ message?.id }`)

      return {
        events: [message],
        state: null,
      }
    }

    logger.debug(`in onMessageFromQuery trigger loaded messages.length=${ messages.length }`)

    if (!invocation.state?.messages) {
      logger.debug(`init onMessageFromQuery trigger with messages.length=${ messages.length }`)

      return {
        events: [],
        state: { messages },
      }
    }

    const prevIDs = new Set(invocation.state.messages.map(({ ts }) => ts))

    const newMessages = messages.filter(({ ts }) => !prevIDs.has(ts))

    logger.debug(`run onMessageFromQuery trigger for new messages.length=${ newMessages.length }`)

    return {
      events: newMessages,
      state: { messages },
    }
  }

  /**
   * @operationName On Mention
   * @category Message Monitoring
   * @description Monitors Slack for user mentions and keywords to trigger AI workflows for automated responses, notifications, or personalized interactions. Perfect for building AI assistants that respond to mentions, keyword-based automation, or priority message handling.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-mention
   * @executionTimeoutInSeconds 120
   * @appearanceColor #f9566d #fb874b
   *
   * @paramDef {"type":"String","label":"User ID","name":"userId","dictionary":"getUsersDictionary","description":"Triggers only when the specified user is mentioned. Provide this, or 'Word', or both. If both are set, both conditions must match."}
   * @paramDef {"type":"String","label":"Word","name":"checkWord","description":"Triggers only if the message contains this word (case-insensitive). If 'User ID' is also provided, both must match."}
   * @paramDef {"type":"Boolean","label":"Trigger for Bots","name":"triggerForBot","uiComponent":{"type":"TOGGLE"},"description":"Enable this to allow messages from bots to trigger the event."}
   *
   * @returns {Object}
   * @sampleResult {"isBot":false,"client_msg_id":"f687a8a3-1234-4ae9-b829-d655eb4de54a","blocks":[],"event_ts":"1745494230.694079","channel":"C012345AF1FC","text":"@testName@testName","team":"T012340Z125V","type":"message","channel_type":"group","user":"U012345UJS2","ts":"1745494230.694079"}
   */
  async onMention(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      const mentions = extractMentions(payload.event.text)

      if (!mentions.length) {
        // we always must trigger at least one mention, otherwise there will be nothing to check for string match
        mentions.push(null)
      }

      return mentions.map(() => ({
        name: 'onMention',
        data: {
          ...payload.event,
          isBot: !!payload.event.bot_profile || payload.event.subtype === 'channel_join',
        },
      }))
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const triggersToActivate = payload.triggers
        .filter(trigger => {
          const { triggerForBot, userId: triggerUserId, checkWord } = trigger.data
          const { isBot, user: eventUserId, text } = payload.eventData

          if (!triggerUserId && !checkWord) {
            return false
          }

          if (!triggerForBot && isBot) {
            return false
          }

          if (triggerUserId && triggerUserId !== eventUserId) {
            return false
          }

          if (checkWord && !text.toLowerCase().includes(checkWord.toLowerCase())) {
            return false
          }

          return true
        })
        .map(({ id }) => id)

      return {
        ids: triggersToActivate.filter(Boolean),
      }
    }
  }

  /**
   * @operationName On Channel Message
   * @category Message Monitoring
   * @description Monitors Slack channels for new messages and triggers AI workflows for automated responses, message analysis, or real-time team communication processing. Perfect for building chatbots, analyzing team sentiment, or automating customer support responses.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-channel-message
   * @executionTimeoutInSeconds 120
   * @appearanceColor #f9566d #fb874b
   *
   * @paramDef {"type":"String", "label":"Channel ID", "name":"channelId", "required":true, "dictionary":"getChannelsDictionary", "description":"Channel to monitor for messages. Examples: 'support', 'general', 'project-alpha'. Select specific channel to watch for team communication."}
   * @paramDef {"type":"Boolean", "label":"Trigger for Bots", "name":"triggerForBot", "uiComponent":{"type":"TOGGLE"}, "description":"Include bot messages in triggers. Enable for automated message processing, disable to focus only on human messages."}
   *
   * @returns {Object}
   * @sampleResult {"isBot":false,"client_msg_id":"06fd11ac-1234-5678-97cb-e7ef402405c8","blocks":[],"event_ts":"1745441382.633049","channel":"C012345AF1FC","text":"hello","team":"T012340Z125V","type":"message","channel_type":"group","user":"U012345UJS2","ts":"1745441382.633049"}
   */
  async onChannelMessage(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      const events = []

      const mentionEventsData = await this.onMention(MethodCallTypes.SHAPE_EVENT, payload)

      events.push(...mentionEventsData)

      events.push({
        name: 'onChannelMessage',
        data: {
          ...payload.event,
          isBot: !!payload.event.bot_profile || payload.event.subtype === 'channel_join',
        },
      })

      return events
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      return {
        ids: payload.triggers
          .filter(trigger => {
            const { triggerForBot, channelId: triggerChannelId } = trigger.data
            const { isBot, channel: eventChannelId } = payload.eventData

            if (!triggerForBot && isBot) {
              return false
            }

            if (triggerChannelId && triggerChannelId !== eventChannelId) {
              return false
            }

            return true
          })
          .map(({ id }) => id),
      }
    }
  }

  /**
   * @operationName On Reaction Added
   * @category Event Monitoring
   * @description Triggered when a user adds a reaction to a message in a Slack channel.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-reaction-added
   * @executionTimeoutInSeconds 120
   * @appearanceColor #f9566d #fb874b
   *
   * @paramDef {"type":"String", "label":"Channel ID", "name":"channelId", "dictionary":"getChannelsDictionary", "description":"Triggers only for reactions in this channel. Optional."}
   * @paramDef {"type":"String", "label":"Reaction", "name":"reaction", "dictionary":"getReactionsDictionary", "description":"Triggers only for this specific reaction. Optional."}
   * @paramDef {"type":"String", "label":"User ID", "name":"userId", "dictionary":"getUsersDictionary", "description":"Triggers only when this user adds a reaction. Optional."}
   *
   * @returns {Object}
   * @sampleResult {"item":{"channel":"C012345AF1FC","type":"message","ts":"1745494726.636239"},"reaction":"disappointed","item_user":"U012345UJS2","event_ts":"1745496656.001500","channel":"C012345AF1FC","messageId":"1745494726.636239","type":"reaction_added","user":"U012345UJS2"}
   */
  async onReactionAdded(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: EventTypes[payload.event.type],
          data: {
            ...payload.event,
            channel: payload.event.item.channel,
            messageId: payload.event.item.ts,
          },
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const triggersToActivate = payload.triggers
        .filter(trigger => {
          const { channelId: triggerChannelId, userId: triggerUserId } = trigger.data
          const { channel: eventChannelId, user: eventUserId } = payload.eventData

          if (triggerChannelId && triggerChannelId !== eventChannelId) {
            return false
          }

          if (triggerUserId && triggerUserId !== eventUserId) {
            return false
          }

          return true
        })
        .map(({ id }) => id)

      return { ids: triggersToActivate }
    }
  }

  /**
   * @operationName On New Member
   * @category Event Monitoring
   * @description Triggered when a new user joins your Slack workspace.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-new-member
   * @executionTimeoutInSeconds 120
   * @appearanceColor #f9566d #fb874b
   *
   * @returns {Object}
   * @sampleResult {"cache_ts":1745497131,"event_ts":"1745497131.006800","type":"team_join","user":{"is_ultra_restricted":false,"color":"a72f79","tz":"Europe/Belgrade","is_owner":false,"is_restricted":false,"tz_label":"Central European Summer Time","profile":{"status_emoji":"","image_32":"https://secure.gravatar.com/avatar/2ed9b1234567c295bb5152f7dcccde.jpg?s=32&d=https%3A%2F%2Fa.slack-edge.com%2Fdf10d%2Fimg%2Favatars%2Fava_0015-32.png","status_emoji_display_info":[],"image_24":"https://secure.gravatar.com/avatar/2ed9b1234567c295bb5152f7dcccde.jpg?s=24&d=https%3A%2F%2Fa.slack-edge.com%2Fdf10d%2Fimg%2Favatars%2Fava_0015-24.png","last_name":"Test Last Name","real_name":"Test First Name Test Last Name","image_192":"https://secure.gravatar.com/avatar/2ed9b1234567c295bb5152f7dcccde.jpg?s=192&d=https%3A%2F%2Fa.slack-edge.com%2Fdf10d%2Fimg%2Favatars%2Fava_0015-192.png","image_48":"https://secure.gravatar.com/avatar/2ed9b1234567c295bb5152f7dcccde.jpg?s=48&d=https%3A%2F%2Fa.slack-edge.com%2Fdf10d%2Fimg%2Favatars%2Fava_0015-48.png","team":"T012340Z125V","title":"","display_name":"Test First Name Test Last Name","status_text_canonical":"","status_expiration":0,"skype":"","phone":"","real_name_normalized":"Test First Name Test Last Name","status_text":"","fields":{},"avatar_hash":"g2ed9b903193","image_72":"https://secure.gravatar.com/avatar/2ed9b1234567c295bb5152f7dcccde.jpg?s=72&d=https%3A%2F%2Fa.slack-edge.com%2Fdf10d%2Fimg%2Favatars%2Fava_0015-72.png","first_name":"Test First Name","email":"name@fr.com","image_512":"https://secure.gravatar.com/avatar/2ed9b1234567c295bb5152f7dcccde.jpg?s=512&d=https%3A%2F%2Fa.slack-edge.com%2Fdf10d%2Fimg%2Favatars%2Fava_0015-512.png","display_name_normalized":"Test First Name Test Last Name"},"is_primary_owner":false,"real_name":"Test First Name Test Last Name","team_id":"T012340Z125V","who_can_share_contact_card":"EVERYONE","is_admin":false,"is_email_confirmed":true,"is_app_user":false,"deleted":false,"tz_offset":7200,"name":"Test First Name","id":"U08P011234T4","is_bot":false,"presence":"away","updated":1745497131}}
   */
  onNewMember(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onNewMember',
          data: {
            ...payload.event,
          },
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      return { ids: payload.triggers.map(({ id }) => id) }
    }
  }

  /**
   * @operationName On Channel Created
   * @category Event Monitoring
   * @description Triggered when a new Slack channel is created.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-channel-created
   * @executionTimeoutInSeconds 120
   * @appearanceColor #f9566d #fb874b
   *
   * @returns {Object}
   * @sampleResult {"channel":{"is_private":false,"purpose":{"last_set":0,"creator":"","value":""},"is_pending_ext_shared":false,"context_team_id":"T012340Z125V","pending_shared":[],"is_channel":true,"is_shared":false,"id":"C08Q34XGZLG","previous_names":[],"pending_connected_team_ids":[],"creator":"U012345UJS2","is_im":false,"is_frozen":false,"is_mpim":false,"created":1745440957,"name_normalized":"t4","is_ext_shared":false,"is_group":false,"unlinked":0,"is_archived":false,"is_general":false,"name":"t4","topic":{"last_set":0,"creator":"","value":""},"shared_team_ids":["T012340Z125V"],"is_org_shared":false,"updated":1745440957975,"parent_conversation":null}}
   */
  onChannelCreated(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onChannelCreated',
          data: {
            channel: payload.event.channel,
          },
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      return {
        ids: payload.triggers.map(({ id }) => id),
      }
    }
  }

  /**
   * @operationName On File Shared
   * @category Event Monitoring
   * @description Triggered when a new file is shared in your workspace.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-file-shared
   * @executionTimeoutInSeconds 120
   * @appearanceColor #f9566d #fb874b
   *
   * @paramDef {"type":"String", "label":"Channel ID", "name":"channelId", "dictionary":"getChannelsDictionary", "description":"Triggers only if the file is shared in this specific Slack channel."}
   * @paramDef {"type":"String", "label":"User ID", "name":"userId", "dictionary":"getUsersDictionary", "description":"Triggers only if the file is shared by this specific user."}
   *
   * @returns {Object}
   * @sampleResult {"channelId":"D07NDH6N2KU","userId":"U012345UJS2","fileId":"F08PFT7UZPX"}
   */
  async onFileShared(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      const { file_id, user_id, channel_id } = payload.event

      return [
        {
          name: 'onFileShared',
          data: {
            channelId: channel_id,
            userId: user_id,
            fileId: file_id,
          },
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const triggersToActivate = payload.triggers
        .filter(trigger => {
          const { channelId: triggerChannelId, userId: triggerUserId } = trigger.data
          const { channelId: eventChannelId, userId: eventUserId } = payload.eventData

          if (triggerChannelId && triggerChannelId !== eventChannelId) {
            return false
          }

          if (triggerUserId && triggerUserId !== eventUserId) {
            return false
          }

          return true
        })
        .map(({ id }) => id)

      return { ids: triggersToActivate }
    }
  }

  /**
   * @operationName On Block Action
   * @category Interactivity
   * @description Triggered when a user clicks a button or interacts with a Block Kit element in a Slack message. Use this to build approval flows, interactive forms, or any workflow that requires human input via Slack buttons. Outputs include the action ID, value, clicking user, channel, and original message timestamp.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-block-action
   * @executionTimeoutInSeconds 120
   * @appearanceColor #f9566d #fb874b
   *
   * @paramDef {"type":"String", "label":"Action ID", "name":"actionId", "description":"Triggers only when this specific action_id matches the clicked button. Leave empty to match all actions."}
   * @paramDef {"type":"String", "label":"Block ID", "name":"blockId", "description":"Triggers only when the action is from this specific block. Leave empty to match all blocks."}
   * @paramDef {"type":"String", "label":"Channel ID", "name":"channelId", "dictionary":"getChannelsDictionary", "description":"Triggers only for interactions in this specific channel. Leave empty to match all channels."}
   *
   * @returns {Object}
   * @sampleResult {"action_id":"approve_request","action_value":"{\"request_id\":\"REQ-001\",\"amount\":1500}","block_id":"approval_block","user_id":"U06XXXXXXXX","user_name":"john.doe","user_display_name":"John Doe","channel_id":"C06XXXXXXXX","message_ts":"1708441234.123456","team_id":"T06XXXXXXXX"}
   */
  onBlockAction(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      const action = payload.actions?.[0] || {}

      return [
        {
          name: 'onBlockAction',
          data: {
            action_id: action.action_id,
            action_value: action.value,
            block_id: action.block_id,
            user_id: payload.user?.id,
            user_name: payload.user?.username,
            user_display_name: payload.user?.name,
            channel_id: payload.channel?.id,
            message_ts: payload.message?.ts,
            team_id: payload.team?.id,
          },
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const triggersToActivate = payload.triggers
        .filter(trigger => {
          const { actionId: triggerActionId, blockId: triggerBlockId, channelId: triggerChannelId } = trigger.data
          const { action_id: eventActionId, block_id: eventBlockId, channel_id: eventChannelId } = payload.eventData

          if (triggerActionId && triggerActionId !== eventActionId) {
            return false
          }

          if (triggerBlockId && triggerBlockId !== eventBlockId) {
            return false
          }

          if (triggerChannelId && triggerChannelId !== eventChannelId) {
            return false
          }

          return true
        })
        .map(({ id }) => id)

      return { ids: triggersToActivate }
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    if (invocation.body.challenge) {
      logger.debug('handleTriggerResolveEvents run the "challenge" invocation')

      return {
        responseToExternalService: invocation.body.challenge,
        events: [],
      }
    }

    // Handle Slack interactivity payloads (block_actions from buttons, etc.)
    // These arrive as application/x-www-form-urlencoded with a "payload" field containing a JSON string
    if (invocation.body.payload) {
      const interactivityPayload = typeof invocation.body.payload === 'string'
        ? JSON.parse(invocation.body.payload)
        : invocation.body.payload

      logger.debug(`handleTriggerResolveEvents interactivity type=${ interactivityPayload.type }`)

      if (interactivityPayload.type === 'block_actions') {
        const events = this.onBlockAction(MethodCallTypes.SHAPE_EVENT, interactivityPayload)

        logger.debug(`handleTriggerResolveEvents.onBlockAction.events=${ JSON.stringify(events) }`)

        return {
          responseToExternalService: '',
          eventScopeId: interactivityPayload.team?.id,
          events,
        }
      }

      // Acknowledge unknown interactivity types without processing
      return {
        responseToExternalService: '',
        events: [],
      }
    }

    const methodName = EventTypes[invocation.body.event?.type]

    if (!methodName) {
      logger.debug(`handleTriggerResolveEvents no method found for event=${ invocation.body.event?.type }`)

      return null
    }

    logger.debug(`handleTriggerResolveEvents.${ methodName }.SHAPE_EVENT`)

    const events = await this[methodName](MethodCallTypes.SHAPE_EVENT, invocation.body)

    logger.debug(`handleTriggerResolveEvents.events=${ JSON.stringify(events) }`)

    return {
      eventScopeId: invocation.body.team_id,
      events,
    }
  }

  async #addSystemBotToChannel(channelId, botUserId) {
    return this.inviteUserToChannel(channelId, botUserId)
  }

  async #removeSystemBotFromChannel(channelId, botUserId) {
    return this.kickUserFromChannel(channelId, botUserId)
  }

  async #getConnectionInfo(options) {
    return this.#apiRequest({
      logTag: '#getConnectionInfo',
      url: `${ API_BASE_URL }/auth.test`,
      ...options,
    })
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    const { team_id } = await this.#getConnectionInfo()

    const { events, webhookData } = invocation

    const triggerChannels = events
      .filter(({ name }) => BOT_EVENTS.has(name))
      .map(({ triggerData }) => triggerData.channelId)

    const { added, removed } = arrayDiff(webhookData?.channelsWithBots, triggerChannels)

    const connectionInfo = await this.#getConnectionInfo({ bot: true })
    const botUserId = connectionInfo.user_id

    const toAdd = added.map(channelId => this.#addSystemBotToChannel(channelId, botUserId))
    const toRemove = removed.map(channelId => this.#removeSystemBotFromChannel(channelId, botUserId))

    await Promise.all([...toAdd, ...toRemove])

    return {
      eventScopeId: team_id,
      webhookData: { channelsWithBots: triggerChannels },
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   */
  async handleTriggerDeleteWebhook(invocation) {
    const connectionInfo = await this.#getConnectionInfo({ bot: true })

    const toRemove = (invocation.webhookData?.channelsWithBots || [])
      .map(channelId => this.#removeSystemBotFromChannel(channelId, connectionInfo.user_id))

    await Promise.all(toRemove)

    return { webhookData: { channelsWithBots: [] } }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    logger.debug(`handleTriggerResolveEvents.${ invocation.eventName }.FILTER_TRIGGER`)

    const result = await this[invocation.eventName](MethodCallTypes.FILTER_TRIGGER, invocation)

    logger.debug(`handleTriggerResolveEvents.${ invocation.eventName }.FILTER_TRIGGER items=${ JSON.stringify(result) }`)

    return result
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    logger.debug(`handleTriggerPollingForEvent.${ invocation.eventName }`)

    return this[invocation.eventName](invocation)
  }

  /**
   * @operationName Find Member
   * @category User Management
   * @description Locates Slack workspace members for AI agents to identify users, verify team membership, or gather user information for personalized interactions. Essential for user lookup, permission checking, or building user-specific automation workflows.
   *
   * @route POST /find-member
   * @executionTimeoutInSeconds 120
   * @appearanceColor #e01e5a #ecb32e
   *
   * @paramDef {"type":"String", "label":"User ID", "name":"userId", "required":false, "description":"Slack User ID to search for. Examples: 'U1234567890', 'U0BPQUNTA'. Use this if you have the specific user ID from mentions or other sources."}
   * @paramDef {"type":"String", "label":"User Email", "name":"email", "required":false, "description":"Email address to search for. Examples: 'john.doe@company.com', 'admin@workspace.com'. Use this to find users by their registered email address."}
   *
   * @returns {Object}
   * @sampleResult {"isBot":true,"displayName":"Example Bot","botId":"example_bot_id_1","userId":"example_user_id_1","username":"example_username","email":"example@example.com"}
   */
  async findMember(userId, email) {
    let result

    if (userId) {
      result = await this.#apiRequest({
        logTag: 'findUserByEmail',
        url: `${ API_BASE_URL }/users.info`,
        query: {
          user: userId,
        },
      })
    }

    if (email) {
      result = await this.#apiRequest({
        logTag: 'findUserByEmail',
        url: `${ API_BASE_URL }/users.lookupByEmail`,
        query: {
          email,
        },
      })
    }

    if (!result) {
      throw new Error('To find a workspace member use one of the following criteria [id,name,username,email]')
    }

    return normalizeMember(result.user)
  }

  /**
   * @operationName Find Members
   * @route POST /find-members
   *
   * @category User Management
   * @description Filters users based on a search string. Matches Slack ID or email exactly, and username or display name partially, all case-insensitive.
   *
   * @appearanceColor #e01e5a #ecb32e
   * @executionTimeoutInSeconds 120
   *
   *
   * @paramDef {"type":"String", "label":"Search", "name":"search", "required":true, "description":"A string to filter users by Slack ID, email (exact match), or username/display name (partial match). The search is case-insensitive."}
   *
   * @sampleResult [{"isBot":true,"displayName":"Example Bot","botId":"example_bot_id_1","userId":"example_user_id_1","username":"example_username","email":"example@example.com"}]
   *
   * @returns {Object}
   */
  async findMembers(search) {
    let members = []

    let next_cursor

    do {
      const result = await this.#getMembersListPage(next_cursor)

      members.push(...result.members)

      next_cursor = result.nextCursor
    } while (next_cursor)

    members = filterMembersBySearch(members, search)

    return members.splice(0, 10)
  }

  async #getMembersListPage(cursor) {
    const result = await this.#apiRequest({
      logTag: 'getMembersListPage',
      url: `${ API_BASE_URL }/users.list`,
      query: {
        limit: MAX_MEMBERS_LIMIT,
        cursor: cursor || undefined,
      },
    })

    return {
      nextCursor: result.response_metadata.next_cursor || null,
      members: result.members.map(normalizeMember),
    }
  }

  /**
   * @operationName Find Channel
   * @category Channel Management
   * @description Searches for a Slack channel by its ID or name.
   *
   * @route POST /find-channel
   * @executionTimeoutInSeconds 120
   * @appearanceColor #e01e5a #ecb32e
   *
   * @paramDef {"type":"String", "label":"Channel ID", "name":"id", "required":false, "description":"The Slack Channel ID to search for. Optional if channel name is provided."}
   * @paramDef {"type":"String", "label":"Channel Name", "name":"name", "required":false, "description":"The name of the Slack channel to search for. Optional if channel ID is provided."}
   *
   * @returns {Object}
   * @sampleResult {"creator":"example_creator_id_1","isGeneral":false,"isArchived":false,"name":"example-channel-name","id":"example_channel_id_1","isPrivate":true,"numMembers":1}
   */
  async findChannel(id, name) {
    const channels = await this.#getAllChannelsList()

    let matcher

    if (id) {
      matcher = channel => channel.id === id
    } else if (name) {
      name = name.toLowerCase()
      matcher = channel => channel.name === name
    } else {
      throw new Error('Specify Channel ID or Channel Name to find a channel')
    }

    const channel = channels.find(matcher)

    if (!channel) {
      throw new Error('Found no channel by the provided criteria')
    }

    return {
      ...channel,
      channelId: channel.id,
      id: undefined,
    }
  }

  async #createChannel(name, description, isPrivate) {
    if (name) {
      name = name.toLowerCase()
    }

    const result = await this.#apiRequest({
      logTag: 'createChannel',
      method: 'post',
      url: `${ API_BASE_URL }/conversations.create`,
      body: {
        name,
        description,
        is_private: isPrivate,
      },
    })

    return {
      channelId: result.channel.id,
    }
  }

  /**
   * @operationName Create Public Channel
   *
   * @category Channel Management
   * @description Creates new public Slack channels for AI agents to organize team communications, set up project-specific discussions, or establish dedicated spaces for automated workflows. Perfect for dynamic channel creation based on project needs or automated team organization.
   *
   * @appearanceColor #e01e5a #ecb32e
   * @executionTimeoutInSeconds 120
   *
   *
   * @route POST /create-public-channel
   *
   * @paramDef {"type":"String", "label":"Channel Name", "name":"channelName", "required":true, "description": "Name for the new channel. Examples: 'project-alpha', 'customer-feedback', 'weekly-reports'. Use lowercase with hyphens, no spaces."}
   * @paramDef {"type":"String", "label":"Channel Description", "name":"channelDescription", "required":false, "description": "Purpose description for the channel. Examples: 'Project Alpha coordination', 'Customer feedback collection', 'Automated report distribution'. Helps team understand channel purpose."}
   *
   * @sampleResult {"channelId": "example_channel_id_D3M9ND"}
   *
   * @returns {Object}
   */
  async createPublicChannel(channelName, channelDescription) {
    return this.#createChannel(channelName, channelDescription, false)
  }

  /**
   * @operationName Create Private Channel
   *
   * @category Channel Management
   * @description Creates a new private Slack channel
   *
   * @appearanceColor #e01e5a #ecb32e
   * @executionTimeoutInSeconds 120
   *
   *
   * @route POST /create-private-channel
   *
   * @paramDef {"type":"String", "label":"Channel Name", "name":"channelName", "required":true, "description": "The name of the new private Slack channel."}
   * @paramDef {"type":"String", "label":"Channel Description", "name":"channelDescription", "required":false, "description": "A description for the new private Slack channel."}
   *
   * @sampleResult {"channelId": "example_channel_id_D3M9ND"}
   *
   * @returns {Object}
   */
  async createPrivateChannel(channelName, channelDescription) {
    return this.#createChannel(channelName, channelDescription, true)
  }

  async #getAllChannelsList() {
    const channels = []

    let next_cursor

    do {
      const result = await this.#getChannelsListPage(next_cursor)

      channels.push(...result.channels)

      next_cursor = result.nextCursor || undefined
    } while (next_cursor)

    return channels
  }

  async #getChannelsListPage(cursor) {
    const result = await this.#apiRequest({
      logTag: 'getChannelsListPage',
      url: `${ API_BASE_URL }/conversations.list`,
      query: {
        types: 'public_channel,private_channel',
        limit: MAX_CHANNELS_LIMIT,
        cursor: cursor || undefined,
      },
    })

    return {
      nextCursor: result.response_metadata.next_cursor,
      channels: result.channels.map(channel => ({
        id: channel.id,
        name: channel.name,
        creator: channel.creator,
        isPrivate: channel.is_private,
        isArchived: channel.is_archived,
        isGeneral: channel.is_general,
        numMembers: channel.num_members,
      })),
    }
  }

  /**
   * @operationName Invite User To Channel
   *
   * @category Channel Management
   * @description Invites a user to a specific Slack channel
   *
   * @route POST /invite-users-to-channel
   *
   * @appearanceColor #e01e5a #ecb32e
   * @executionTimeoutInSeconds 120
   *
   *
   * @paramDef {"type":"String", "label":"Channel ID", "name":"channelId", "required":true, "dictionary":"getChannelsDictionary", "description": "The ID of the Slack channel to invite the user to."}
   * @paramDef {"type":"String", "label":"User ID", "name":"userId", "required":true, "dictionary":"getUsersDictionary", "description": "The ID of the user to be invited to the Slack channel."}
   */
  async inviteUserToChannel(channelId, userId) {
    await this.#apiRequest({
      logTag: 'inviteUserToChannel',
      method: 'post',
      url: `${ API_BASE_URL }/conversations.invite`,
      body: {
        channel: channelId,
        users: userId,
      },
    })
  }

  /**
   * @operationName Kick User From Channel
   * @category Channel Management
   * @description Kicks a user from a specific Slack channel
   *
   * @route POST /kick-user-from-channel
   *
   * @appearanceColor #e01e5a #ecb32e
   * @executionTimeoutInSeconds 120
   *
   *
   * @paramDef {"type":"String", "label":"Channel ID", "name":"channelId", "required":true, "dictionary":"getChannelsDictionary", "description": "The ID of the Slack channel from which the user will be kicked."}
   * @paramDef {"type":"String", "label":"User ID", "name":"userId", "required":true, "dictionary":"getUsersDictionary", "description": "The ID of the user to be kicked from the Slack channel."}
   *
   */
  async kickUserFromChannel(channelId, userId) {
    await this.#apiRequest({
      logTag: 'kickUserFromChannel',
      method: 'post',
      url: `${ API_BASE_URL }/conversations.kick`,
      body: {
        channel: channelId,
        user: userId,
      },
    })
  }

  async #sendMessageTo(data) {
    const { channel, messageText, threadId, sendAsBot, botName, botIcon, replyBroadcast, imageURL, blocks } = data

    let messageBlocks

    if (blocks) {
      messageBlocks = typeof blocks === 'string' ? JSON.parse(blocks) : blocks
    } else {
      messageBlocks = []

      if (messageText) {
        const chunks = chunkMarkdown(messageText)

        chunks.forEach(chunk => {
          messageBlocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: chunk,
            },
          })
        })
      }

      if (imageURL) {
        messageBlocks.push({
          type: 'image',
          alt_text: 'image',
          image_url: imageURL,
        })
      }
    }

    const body = cleanupObject({
      channel,
      text: messageText || undefined,
      thread_ts: threadId,
      username: botName,
      blocks: messageBlocks.length ? messageBlocks : undefined,
      icon_url: botIcon,
      reply_broadcast: replyBroadcast,
    })

    const result = await this.#apiRequest({
      logTag: 'sendMessageTo',
      method: 'post',
      url: `${ API_BASE_URL }/chat.postMessage`,
      body,
      bot: sendAsBot,
    })

    return {
      messageId: result.message.ts,
      channelId: result.channel,
    }
  }

  /**
   * @operationName Send Message To Channel
   * @category Message Operations
   * @description Sends messages to Slack channels with optional Block Kit rich layouts. Supports plain text with Slack formatting, or advanced Block Kit JSON for buttons, menus, and interactive elements. Returns the message timestamp and channel ID for later updates or tracking.
   *
   * @appearanceColor #e01e5a #ecb32e
   * @executionTimeoutInSeconds 120
   *
   *
   * @route POST /send-message-to-channel
   *
   * @paramDef {"type":"String", "label":"Channel ID", "name":"channelId", "required":true, "dictionary":"getChannelsDictionary", "description": "Target Slack channel for the message. Examples: 'general', 'alerts', 'project-updates'. Select from your available channels."}
   * @paramDef {"type":"String", "label":"Message Text", "name":"messageText", "required":false, "uiComponent":{"type":"MULTI_LINE_TEXT"}, "description": "Message content with Slack formatting support. When blocks are provided, this text is used as the notification fallback. Use @channel, @here, or <@userId> for mentions."}
   * @paramDef {"type":"String", "label":"Thread ID", "name":"threadId", "required":false, "description": "The ID of the thread to post the message in, if applicable."}
   * @paramDef {"type":"Boolean", "label":"Send as a bot", "name":"sendAsBot", "required":false, "uiComponent":{"type":"TOGGLE"}, "description": "Whether the message should be sent as a bot."}
   * @paramDef {"type":"String", "label":"Bot Name", "name":"botName", "required":false, "description": "The name of the bot sending the message, if \"Send as a bot\" is true."}
   * @paramDef {"type":"String", "label":"Bot Icon", "name":"botIcon", "required":false, "description": "The icon of the bot sending the message, if \"Send as a bot\" is true."}
   * @paramDef {"type":"Boolean", "label":"Also Send to the Channel", "name":"replyBroadcast", "required":false, "uiComponent":{"type":"TOGGLE"}, "description": "Whether to broadcast the reply to the Slack channel."}
   * @paramDef {"type":"String", "label":"Image URL", "name":"imageURL", "required":false, "description": "A URL to an image to attach to the message."}
   * @paramDef {"type":"String", "label":"Blocks", "name":"blocks", "uiComponent":{"type":"MULTI_LINE_TEXT"}, "description": "Optional JSON array of Slack Block Kit elements. When provided, these blocks are used instead of auto-generated blocks from the message text. Supports buttons, sections, images, dividers, and other Block Kit components. Refer to Slack Block Kit documentation for the format."}
   *
   * @sampleResult {"messageId":"1503435956.000247","channelId":"C06XXXXXXXX"}
   *
   * @returns {Object}
   */
  async sendMessageToChannel(channelId, messageText, threadId, sendAsBot, botName, botIcon, replyBroadcast, imageURL, blocks) {
    return this.#sendMessageTo({
      channel: channelId,
      messageText,
      threadId,
      sendAsBot,
      botName,
      botIcon,
      replyBroadcast,
      imageURL,
      blocks,
    })
  }

  /**
   * @operationName Send Direct Message
   * @category Message Operations
   * @description Sends a direct message to a user on Slack with optional Block Kit rich layouts. Supports plain text with Slack formatting, or advanced Block Kit JSON for buttons, menus, and interactive elements. Returns the message timestamp and channel ID for later updates or tracking.
   *
   * @appearanceColor #e01e5a #ecb32e
   * @executionTimeoutInSeconds 120
   *
   *
   * @route POST /send-direct-channel
   *
   * @paramDef {"type":"String", "label":"User ID", "name":"userId", "required":true, "dictionary":"getUsersDictionary", "description": "The ID of the user to send the direct message to."}
   * @paramDef {"type":"String", "label":"Message Text", "name":"messageText", "required":false, "uiComponent":{"type":"MULTI_LINE_TEXT"}, "description": "The text content of the message. When blocks are provided, this text is used as the notification fallback. Supports Slack formatting such as @channel and @here, and user mentions via <@U123456789>."}
   * @paramDef {"type":"String", "label":"Thread ID", "name":"threadId", "required":false, "description": "The ID of the thread to post the message in, if applicable."}
   * @paramDef {"type":"Boolean", "label":"Send as a bot", "name":"sendAsBot", "required":false, "uiComponent":{"type":"TOGGLE"}, "description": "Whether the message should be sent as a bot."}
   * @paramDef {"type":"String", "label":"Bot Name", "name":"botName", "required":false, "description": "The name of the bot sending the message, if \"Send as a bot\" is true."}
   * @paramDef {"type":"String", "label":"Bot Icon", "name":"botIcon", "required":false, "description": "The icon of the bot sending the message, if \"Send as a bot\" is true."}
   * @paramDef {"type":"Boolean", "label":"Also Send to the Channel", "name":"replyBroadcast", "required":false, "uiComponent":{"type":"TOGGLE"}, "description": "Whether to broadcast the reply to the Slack channel."}
   * @paramDef {"type":"String", "label":"Image URL", "name":"imageURL", "required":false, "description": "A URL to an image to attach to the message."}
   * @paramDef {"type":"String", "label":"Blocks", "name":"blocks", "uiComponent":{"type":"MULTI_LINE_TEXT"}, "description": "Optional JSON array of Slack Block Kit elements. When provided, these blocks are used instead of auto-generated blocks from the message text. Supports buttons, sections, images, dividers, and other Block Kit components. Refer to Slack Block Kit documentation for the format."}
   *
   * @sampleResult {"messageId":"1503435956.000247","channelId":"D06XXXXXXXX"}
   *
   * @returns {Object}
   */
  async sendDirectMessage(userId, messageText, threadId, sendAsBot, botName, botIcon, replyBroadcast, imageURL, blocks) {
    return this.#sendMessageTo({
      channel: userId,
      messageText,
      threadId,
      sendAsBot,
      botName,
      botIcon,
      replyBroadcast,
      imageURL,
      blocks,
    })
  }

  /**
   * @operationName Delete Message In Channel
   * @category Message Operations
   * @description Deletes a specific message from a Slack channel.
   *
   * @appearanceColor #e01e5a #ecb32e
   * @executionTimeoutInSeconds 120
   *
   *
   * @route POST /delete-message-in-channel
   *
   * @paramDef {"type":"String", "label":"Channel ID", "name":"channelId", "required":true, "dictionary":"getChannelsDictionary", "description": "The ID of the Slack channel where the message will be deleted."}
   * @paramDef {"type":"String", "label":"Message ID", "name":"messageId", "required":true, "description": "The ID of the message to be deleted from the Slack channel."}
   */
  async deleteMessageInChannel(channelId, messageId) {
    await this.#apiRequest({
      logTag: 'deleteMessageInChannel',
      method: 'post',
      url: `${ API_BASE_URL }/chat.delete`,
      body: cleanupObject({
        channel: channelId,
        ts: messageId,
      }),
    })
  }

  /**
   * @operationName Update Message In Channel
   * @category Message Operations
   * @description Updates a specific message in a Slack channel. Supports plain text updates or replacing the entire message content with Block Kit JSON. Commonly used after a button click to swap interactive buttons with a confirmation message.
   *
   * @appearanceColor #e01e5a #ecb32e
   * @executionTimeoutInSeconds 120
   *
   *
   * @route POST /update-message-in-channel
   *
   * @paramDef {"type":"String", "label":"Channel ID", "name":"channelId", "required":true, "dictionary":"getChannelsDictionary", "description": "The ID of the Slack channel where the message will be updated."}
   * @paramDef {"type":"String", "label":"Message ID", "name":"messageId", "required":true, "description": "The ID (timestamp) of the message to be updated. Obtained from the send message output or from a trigger event."}
   * @paramDef {"type":"String", "label":"Message Text", "name":"messageText", "required":false, "uiComponent":{"type":"MULTI_LINE_TEXT"}, "description": "The new text content for the message. When blocks are provided, this text is used as the notification fallback. Supports Slack formatting like @channel, @here, and user mentions via <@U123456789>."}
   * @paramDef {"type":"Boolean", "label":"Also Send to the Channel", "name":"replyBroadcast", "required":false, "uiComponent":{"type":"TOGGLE"}, "description": "Whether to broadcast the updated message to the Slack channel."}
   * @paramDef {"type":"String", "label":"Image URL", "name":"imageURL", "required":false, "description": "A URL to an image to attach to the updated message."}
   * @paramDef {"type":"String", "label":"Blocks", "name":"blocks", "uiComponent":{"type":"MULTI_LINE_TEXT"}, "description": "Optional JSON array of Slack Block Kit elements to replace the existing message content. When provided, these blocks are used instead of auto-generated blocks from the message text."}
   */
  async updateMessageInChannel(channelId, messageId, messageText, replyBroadcast, imageURL, blocks) {
    let messageBlocks

    if (blocks) {
      messageBlocks = typeof blocks === 'string' ? JSON.parse(blocks) : blocks
    } else {
      messageBlocks = []

      if (messageText) {
        messageBlocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: messageText,
          },
        })
      }

      if (imageURL) {
        messageBlocks.push({
          type: 'image',
          alt_text: 'image',
          image_url: imageURL,
        })
      }
    }

    const body = cleanupObject({
      channel: channelId,
      ts: messageId,
      text: messageText || undefined,
      blocks: messageBlocks.length ? messageBlocks : undefined,
      reply_broadcast: replyBroadcast,
    })

    await this.#apiRequest({
      logTag: 'updateMessageInChannel',
      method: 'post',
      url: `${ API_BASE_URL }/chat.update`,
      body,
    })
  }

  /**
   * @operationName Get Message
   * @category Message Operations
   * @description Retrieves a specific message from a Slack channel by a message ID.
   *
   * @appearanceColor #e01e5a #ecb32e
   * @executionTimeoutInSeconds 120
   *
   *
   * @route POST /get-message
   *
   * @paramDef {"type":"String", "label":"Channel ID", "name":"channelId", "required":true, "dictionary":"getChannelsDictionary", "description": "The ID of the Slack channel where the message is located."}
   * @paramDef {"type":"String", "label":"Message ID", "name":"messageId", "required":true, "description": "The ID of the message to retrieve from the Slack channel."}
   *
   * @sampleResult {"messageRawData":{},"messageId":"example_message_id_1","messageText":"Example message text","messageType":"message","messageSubType":"thread_broadcast | bot_message | channel_join","threadId":"example_thread_id_1","userId":"example_user_id_1","botId":"example_bot_id_1","botName":"Example Bot"}
   *
   * @returns {Object}
   */
  async getMessage(channelId, messageId) {
    const result = await this.#apiRequest({
      logTag: 'getMessage',
      method: 'get',
      url: `${ API_BASE_URL }/conversations.history`,
      query: {
        channel: channelId,
        oldest: messageId,
        limit: 1,
        inclusive: true,
      },
    })

    const messages = result.messages.map(normalizeChannelMessage)

    const message = messages[0]

    if (!message) {
      throw new Error(`Can not find the message with id="${ messageId }"`)
    }

    return message
  }

  /**
   * @operationName Get File Info
   * @category File Operations
   * @description Retrieves detailed information about a Slack file using its ID.
   *
   * @route POST /get-file-info
   * @executionTimeoutInSeconds 120
   * @appearanceColor #e01e5a #ecb32e
   *
   * @paramDef {"type":"String", "label":"File ID", "name":"fileId", "required":true, "description":"The ID of the file to retrieve information for."}
   *
   * @returns {Object}
   * @sampleResult {"file":{"filetype":"png","thumb_360":"https://files.slack.com/files-tmb/T012340Z125V-F012234SEYLS-01123c595ad/2024-10-30_22-56-57_360.png","thumb_160":"https://files.slack.com/files-tmb/T012340Z125V-F012234SEYLS-01123c595ad/2024-10-30_22-56-57_160.png","title":"2024-10-30 22-56-57.png","file_access":"visible","original_h":200,"ims":[],"mode":"hosted","shares":{"private":{}},"media_display_type":"unknown","url_private":"https://files.slack.com/files-pri/T012340Z125V-F012234SEYLS/2024-10-30_22-56-57.png","id":"F012234SEYLS","display_as_bot":false,"timestamp":1745499971,"thumb_64":"https://files.slack.com/files-tmb/T012340Z125V-F012234SEYLS-01123c595ad/2024-10-30_22-56-57_64.png","thumb_80":"https://files.slack.com/files-tmb/T012340Z125V-F012234SEYLS-01123c595ad/2024-10-30_22-56-57_80.png","created":1745499971,"editable":false,"has_more_shares":false,"is_external":false,"thumb_360_h":200,"groups":["C0812345D96","C012345AF1FC"],"pretty_type":"PNG","external_type":"","url_private_download":"https://files.slack.com/files-pri/T012340Z125V-F012234SEYLS/download/2024-10-30_22-56-57.png","user_team":"T012340Z125V","permalink_public":"https://slack-files.com/T012340Z125V-F012234SEYLS-98aa67dabb","has_rich_preview":false,"is_starred":false,"size":9977,"channels":[],"comments_count":0,"name":"2024-10-30 22-56-57.png","is_public":false,"thumb_360_w":200,"thumb_tiny":"AwAwADCpVwThuAe/pQBoTQR3zLdhn+JfWntzMxyxJPuc0lFFAH//Z","mimetype":"image/png","public_url_shared":false,"permalink":"https://testworksp.slack.com/files/U012345UJS2/F012234SEYLS/2024-10-30_22-56-57.png","user":"U012345UJS2","original_w":200,"username":""},"comments":[],"response_metadata":{"next_cursor":""},"ok":true}
   */
  async getFileInfo(fileId) {
    const result = await this.#apiRequest({
      logTag: 'getFileInfo',
      method: 'get',
      url: `${ API_BASE_URL }/files.info`,
      query: { file: fileId },
    })

    if (!result) {
      throw new Error(`Can not find the file with id="${ fileId }"`)
    }

    return result
  }

  /**
   * @operationName Search Messages
   * @category Search Operations
   * @description Searches Slack message history for AI agents to analyze past conversations, find relevant information, or extract insights from team communications. Perfect for building knowledge bases, analyzing sentiment, or finding specific information across all channels.
   *
   * @route POST /search-messages
   * @executionTimeoutInSeconds 120
   * @appearanceColor #e01e5a #ecb32e
   *
   * @paramDef {"type":"String", "label":"Query", "name":"query", "required":true, "description":"Search query using Slack syntax. Examples: 'error logs', 'from:@john project update', 'in:#support urgent'. Use keywords, user filters (from:@user), or channel filters (in:#channel)."}
   *
   * @returns {Object}
   * @sampleResult {"query":"slack query string","messages":{"total":72,"pagination":{"per_page":100,"last":72,"total_count":72,"page":1,"page_count":1,"first":1},"paging":{"total":72,"pages":1,"count":100,"page":1},"matches":[{"no_reactions":true,"iid":"586870da-5300-4ee2-9499-2980b602993d","blocks":[{"text":{"text":"message text","type":"mrkdwn","verbatim":false},"type":"section","block_id":"zYtvT"}],"channel":{"is_private":true,"is_im":false,"pending_shared":[],"is_mpim":false,"is_channel":true,"is_shared":false,"name":"test-channel-name","id":"C0812345D96","is_ext_shared":false,"is_pending_ext_shared":false,"is_org_shared":false,"is_group":false},"team":"T012340Z125V","type":"message","score":0,"files":[{"filetype":"png","thumb_360":"https://files.slack.com/files-tmb/T012340Z125V-F08123456LKS-656e23e7c1/2024-10-30_22-56-57_360.png","thumb_160":"https://files.slack.com/files-tmb/T012340Z125V-F08123456LKS-656e23e7c1/2024-10-30_22-56-57_160.png","title":"2024-10-30 22-56-57.png","file_access":"visible","original_h":200,"mode":"hosted","media_display_type":"unknown","url_private":"https://files.slack.com/files-pri/T012340Z125V-F08123456LKS/2024-10-30_22-56-57.png","id":"F08123456LKS","display_as_bot":false,"timestamp":1745500277,"thumb_64":"https://files.slack.com/files-tmb/T012340Z125V-F08123456LKS-656e23e7c1/2024-10-30_22-56-57_64.png","thumb_80":"https://files.slack.com/files-tmb/T012340Z125V-F08123456LKS-656e23e7c1/2024-10-30_22-56-57_80.png","created":1745500277,"editable":false,"is_external":false,"thumb_360_h":200,"pretty_type":"PNG","external_type":"","url_private_download":"https://files.slack.com/files-pri/T012340Z125V-F08123456LKS/download/2024-10-30_22-56-57.png","user_team":"T012340Z125V","permalink_public":"https://slack-files.com/T012340Z125V-F08123456LKS-2c6bfa514a","has_rich_preview":false,"is_starred":false,"size":9977,"name":"2024-10-30 22-56-57.png","is_public":false,"thumb_360_w":200,"thumb_tiny":"AwAwADCpVwThuAe/pQBoTQR3zLdhn+JfWntzMxyxJPuc0lFFAH//Z","mimetype":"image/png","public_url_shared":false,"permalink":"https://testworksp.slack.com/files/U012345UJS2/F08123456LKS/2024-10-30_22-56-57.png","user":"U012345UJS2","original_w":200,"username":""}],"text":"","permalink":"https://testworksp.slack.com/archives/C0812345D96/p1745123456281239","user":"U012345UJS2","username":"test.username","ts":"1745500292.281239"}]},"ok":true}
   */
  async searchMessages(query) {
    return this.#apiRequest({
      logTag: 'onMessageFromQuery',
      url: `${ API_BASE_URL }/search.messages`,
      query: {
        sort: 'timestamp',
        query: query,
        count: MAX_CHANNEL_MESSAGES_LIMIT,
      },
    })
  }

  /**
   * @operationName Get Latest Channel Messages
   * @category Message Operations
   * @description Retrieves the latest messages (up to 100) from a specific Slack channel.
   *
   * @appearanceColor #e01e5a #ecb32e
   * @executionTimeoutInSeconds 120
   *
   *
   * @route POST /get-latest-channel-messages
   *
   * @paramDef {"type":"String", "label":"Channel ID", "name":"channelId", "required":true, "dictionary":"getChannelsDictionary", "description": "The ID of the Slack channel from which to retrieve the latest messages."}
   *
   * @sampleResult [{"messageRawData":{},"messageId":"example_message_id_1","messageText":"Example message text","messageType":"message","messageSubType":"thread_broadcast | bot_message | channel_join","threadId":"example_thread_id_1","userId":"example_user_id_1","botId":"example_bot_id_1","botName":"Example Bot"}]
   *
   * @returns {Array.<Object>}
   */
  async getLatestChannelMessages(channelId) {
    const result = await this.#apiRequest({
      logTag: 'getChannelMessages',
      method: 'get',
      url: `${ API_BASE_URL }/conversations.history`,
      query: {
        channel: channelId,
        limit: MAX_CHANNEL_MESSAGES_LIMIT,
        inclusive: true,
      },
    })

    return result.messages.map(normalizeChannelMessage)
  }

  /**
   * @operationName Get Latest Thread Messages
   * @category Message Operations
   * @description Retrieves the latest 1000 messages from a specific thread in a Slack channel.
   *
   * @appearanceColor #e01e5a #ecb32e
   * @executionTimeoutInSeconds 120
   *
   *
   * @route POST /get-latest-thread-messages
   *
   * @paramDef {"type":"String", "label":"Channel ID", "name":"channelId", "required":true, "dictionary":"getChannelsDictionary", "description": "The ID of the Slack channel where the thread is located."}
   * @paramDef {"type":"String", "label":"Thread ID", "name":"threadId", "required":true, "description": "The ID of the thread from which to retrieve the latest messages."}
   *
   * @sampleResult [{"messageRawData":{},"messageId":"example_message_id_1","messageText":"Example message text","messageType":"message","messageSubType":"thread_broadcast | bot_message | channel_join","threadId":"example_thread_id_1","userId":"example_user_id_1","botId":"example_bot_id_1","botName":"Example Bot"}]
   *
   * @returns {Array.<Object>}
   */
  async getLatestThreadMessages(channelId, threadId) {
    const result = await this.#apiRequest({
      logTag: 'getThreadMessages',
      method: 'get',
      url: `${ API_BASE_URL }/conversations.replies`,
      query: {
        channel: channelId,
        ts: threadId,
        limit: MAX_THREAD_MESSAGES_LIMIT,
        inclusive: true,
      },
    })

    return result.messages.map(normalizeChannelMessage)
  }

  // ------------ DICTIONARIES -------------------

  /**
   * @typedef {Object} DictionaryPayload
   * @property {String} [search]
   * @property {String} [cursor]
   */

  /**
   * @typedef {Object} DictionaryItem
   * @property {String} label
   * @property {any} value
   * @property {String} note
   */

  /**
   * @typedef {Object} DictionaryResponse
   * @property {Array<DictionaryItem>} items
   * @property {String} cursor
   */

  /**
   * @typedef {Object} getChannelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter channels by their name or ID. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results. Use the returned cursor to fetch additional channels."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Channels
   * @category Data Retrieval
   * @description Returns a paginated list of Slack channels. Note: search functionality filters channels only within the current page of results. Use the cursor to paginate through all available channels.
   *
   * @route POST /get-channels
   *
   * @paramDef {"type":"getChannelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering channels."}
   *
   * @sampleResult {"cursor":"abc123","items":[{"label":"general","value":"C012345","note":"ID: C012345"}]}
   * @returns {DictionaryResponse}
   */
  async getChannelsDictionary({ search, cursor }) {
    const { nextCursor, channels } = await this.#getChannelsListPage(cursor)

    let filteredChannels = channels

    if (search) {
      search = search.toLowerCase()

      filteredChannels = channels.filter(c => {
        return c.name?.toLowerCase().includes(search) || c.id?.toLowerCase() === search
      })
    }

    return {
      cursor: nextCursor || null,
      items: filteredChannels.map(channel => ({
        label: channel.name,
        value: channel.id,
        note: `ID: ${ channel.id }`,
      })),
    }
  }

  /**
   * @typedef {Object} getUsersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter users by their display name, username, email, or ID. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results. Use the returned cursor to fetch additional users."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Users
   * @category Data Retrieval
   * @description Returns a paginated list of Slack users. Note: search functionality filters users only within the current page of results. Use the cursor to paginate through all available users.
   *
   * @route POST /get-users
   *
   * @paramDef {"type":"getUsersDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering users."}
   *
   * @sampleResult {"cursor":"abc456","items":[{"label":"Jane Doe","value":"U12345","note":"ID: U12345"}]}
   * @returns {DictionaryResponse}
   */
  async getUsersDictionary({ search, cursor }) {
    const { nextCursor, members } = await this.#getMembersListPage(cursor)

    const filteredMembers = filterMembersBySearch(members, search)

    return {
      items: filteredMembers.map(user => ({
        label: user.displayName,
        value: user.userId,
        note: `ID: ${ user.userId }`,
      })),
      cursor: nextCursor || null,
    }
  }

  /**
   * @typedef {Object} getReactionsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter reactions by their ID. Filtering is performed locally on retrieved results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Reactions
   * @category Data Retrieval
   * @description Returns a list of Slack reactions. Note: search functionality filters reactions only within the current set of results.
   *
   * @route POST /get-reactions
   *
   * @paramDef {"type":"getReactionsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering reactions."}
   *
   * @sampleResult {"items":[{"label":"👀","value":"eyes","note":"ID: eyes"}]}
   * @returns {DictionaryResponse}
   */
  async getReactionsDictionary({ search }) {
    search = search.toLowerCase()

    return {
      items: REACTIONS.filter(({ note }) => note.includes(search)),
    }
  }
}

Flowrunner.ServerCode.addService(Slack, [
  {
    order: 0,
    displayName: 'Client Id',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    name: 'clientId',
    hint: 'Your Slack OAuth 2.0 Client ID, found in the Slack API dashboard under "App Credentials".',
  },
  {
    order: 1,
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    name: 'clientSecret',
    hint: 'Your Slack OAuth 2.0 Client Secret, used for secure authentication, available in "App Credentials".',
  },
])

function resolveSlackResponse(response) {
  if (response.ok) {
    return response
  }

  if (response.error) {
    if (response.error === 'missing_scope') {
      throw new Error(
        `Slack Result Error: "${ response.error }" needed: "${ response.needed }" provided: "${ response.provided }"`
      )
    }

    if (Array.isArray(response.errors)) {
      response.error = `${ response.error }; ${ response.errors.join('; ') }`
    }

    throw new Error(`Slack Result Error: "${ response.error }"`)
  }

  throw new Error(`Slack Unknown Result Error: "${ JSON.stringify(response) }"`)
}

function cleanupObject(data) {
  if (!data) {
    return
  }

  const result = {}

  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null) {
      result[key] = data[key]
    }
  })

  return result
}

function serializeTokens(userData, botData) {
  const accessToken = serializeToken(userData.access_token, botData.access_token)
  const refreshToken = serializeToken(userData.refresh_token, botData.refresh_token)

  const expiresIn =
    userData.expires_in && botData.expires_in
      ? Math.min(userData.expires_in, botData.expires_in)
      : userData.expires_in || botData.expires_in

  return {
    token: accessToken,
    expirationInSeconds: expiresIn,
    refreshToken: refreshToken,
  }
}

function serializeToken(userToken, botToken) {
  return JSON.stringify(JSON.stringify({ u: userToken, b: botToken }))
}

function deserializeToken(tokenString) {
  let tokens

  if (tokenString) {
    try {
      tokens = JSON.parse(tokenString)
    } catch {
    }

    if (tokens && typeof tokens === 'string') {
      try {
        tokens = JSON.parse(tokens)
      } catch {
      }
    }
  }

  return {
    u: tokens?.u,
    b: tokens?.b,
  }
}

async function refreshTokenFor(service, refreshToken) {
  try {
    const response = await Flowrunner.Request.post(`${ API_BASE_URL }/oauth.v2.access`)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .query({
        client_id: service.clientId,
        client_secret: service.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      })
      .then(resolveSlackResponse)

    return {
      access_token: response.access_token,
      expires_in: response.expires_in,
      refresh_token: response.refresh_token,
    }
  } catch (error) {
    logger.error(`refreshToken: ${ error.message }`)

    throw error
  }
}

function normalizeChannelMessage(message) {
  return {
    messageRawData: message,
    messageId: message.ts,
    messageText: message.text,
    messageType: message.type,
    messageSubType: message.subtype,
    threadId: message.thread_ts,
    userId: message.user,
    replyCount: message.reply_count,
    botId: message.bot_id,
    botName: message.bot_id
      ? message.username || message.bot_profile?.name
      : undefined,
  }
}

function normalizeMember(member) {
  return {
    rawMemberData: member,
    userId: member.id,
    email: member.profile.email,
    username: member.name,
    displayName: member.profile.display_name || member.profile.real_name || member.real_name,
    isBot: member.is_bot,
    botId: member.profile.bot_id,
  }
}

function filterMembersBySearch(members, search) {
  if (!search) {
    return members
  }

  search = search.toLowerCase()

  return members.filter(member => {
    if (member.userId.toLowerCase() === search || member.email?.toLowerCase() === search) {
      return true
    }

    if (member.username?.toLowerCase().includes(search) || member.displayName?.toLowerCase().includes(search)) {
      return true
    }
  })
}

const mentionPattern = /<@([A-Z0-9]+)>/g

function extractMentions(text) {
  if (!text) {
    return []
  }

  return [...new Set([...text.matchAll(mentionPattern)].map(match => match[1]))]
}

function arrayDiff(prev = [], next = []) {
  const prevState = new Set(prev)
  const nextState = new Set(next)

  const added = next.filter(v => !prevState.has(v))
  const removed = prev.filter(v => !nextState.has(v))

  return { added, removed }
}
