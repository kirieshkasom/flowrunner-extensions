const logger = {
  info: (...args) => console.log('[Discord] info:', ...args),
  debug: (...args) => console.log('[Discord] debug:', ...args),
  error: (...args) => console.log('[Discord] error:', ...args),
  warn: (...args) => console.log('[Discord] warn:', ...args),
}

const API_BASE_URL = 'https://discord.com/api/v10'

const DEFAULT_MESSAGES_LIMIT = 50
const DEFAULT_MEMBERS_LIMIT = 100

const CHANNEL_TYPE_NAMES = {
  0: 'Text',
  1: 'DM',
  2: 'Voice',
  4: 'Category',
  5: 'Announcement',
  10: 'Announcement Thread',
  11: 'Public Thread',
  12: 'Private Thread',
  13: 'Stage',
  15: 'Forum',
  16: 'Media',
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
 * Converts a hex color string like "#5865F2" or "5865F2" to the integer Discord embeds expect.
 */
function hexColorToInt(color) {
  if (color === undefined || color === null || color === '') {
    return undefined
  }

  const hex = String(color).trim().replace(/^#/, '')

  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`Invalid embed color "${ color }". Use a 6-digit hex color like #5865F2.`)
  }

  return parseInt(hex, 16)
}

/**
 * @integrationName Discord
 * @integrationIcon /icon.png
 */
class DiscordService {
  constructor(config) {
    this.botToken = config.botToken
    this.guildId = config.guildId
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bot ${ this.botToken }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      throw this.#composeError(error, logTag)
    }
  }

  #composeError(error, logTag) {
    const status = error.status || error.statusCode
    const retryAfter = error.body?.retry_after

    if (status === 429 || retryAfter !== undefined) {
      const scope = error.body?.global ? 'global rate limit' : 'rate limit'
      const message = `Discord ${ scope } exceeded. Retry after ${ retryAfter ?? 'a few' } seconds.`

      logger.error(`${ logTag } - ${ message }`)

      return new Error(message)
    }

    let message = error.body?.message || error.message || 'Unknown error'

    if (error.body?.errors) {
      message += ` Details: ${ JSON.stringify(error.body.errors) }`
    }

    logger.error(`${ logTag } - Request failed: ${ message }`)

    return new Error(`Discord API error: ${ message }`)
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #buildEmbed({ title, description, color, imageUrl }) {
    const embed = clean({
      title,
      description,
      color: hexColorToInt(color),
      image: imageUrl ? { url: imageUrl } : undefined,
    })

    return Object.keys(embed).length > 0 ? embed : undefined
  }

  /**
   * @operationName Send Message
   * @category Messages
   * @description Sends a message to a Discord channel as the bot. Supports plain text content up to 2000 characters, an optional simple embed (title, description, color, image), and text-to-speech delivery. Either message content or at least one embed field is required. The bot must have the Send Messages permission in the target channel. Returns the created message including its ID for later editing, reactions, or thread creation.
   * @route POST /send-message
   *
   * @paramDef {"type":"String","label":"Channel","name":"channelId","required":true,"dictionary":"getChannelsDictionary","description":"Target channel. Select a channel or provide a channel ID."}
   * @paramDef {"type":"String","label":"Content","name":"content","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Message text (up to 2000 characters). Supports Discord markdown and mentions like <@userId>. Required unless an embed is provided."}
   * @paramDef {"type":"String","label":"Embed Title","name":"embedTitle","description":"Optional embed title (up to 256 characters)."}
   * @paramDef {"type":"String","label":"Embed Description","name":"embedDescription","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional embed body text (up to 4096 characters). Supports Discord markdown."}
   * @paramDef {"type":"String","label":"Embed Color","name":"embedColor","description":"Optional embed accent color as a hex value, e.g. #5865F2."}
   * @paramDef {"type":"String","label":"Embed Image URL","name":"embedImageUrl","description":"Optional public image URL displayed inside the embed."}
   * @paramDef {"type":"Boolean","label":"Text To Speech","name":"tts","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, the message is read aloud in the channel using text-to-speech."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1211234567890123456","channel_id":"1109876543210987654","content":"Deployment finished","author":{"id":"1101111111111111111","username":"flowrunner-bot","bot":true},"embeds":[{"title":"Build #42","description":"All checks passed","color":5793522}],"timestamp":"2026-07-13T10:15:00.000000+00:00","tts":false}
   */
  async sendMessage(channelId, content, embedTitle, embedDescription, embedColor, embedImageUrl, tts) {
    const logTag = '[sendMessage]'

    const embed = this.#buildEmbed({
      title: embedTitle,
      description: embedDescription,
      color: embedColor,
      imageUrl: embedImageUrl,
    })

    if (!content && !embed) {
      throw new Error('Either message content or at least one embed field (title, description, color, image) is required.')
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/channels/${ channelId }/messages`,
      method: 'post',
      body: clean({
        content,
        tts: tts === true ? true : undefined,
        embeds: embed ? [embed] : undefined,
      }),
    })
  }

  /**
   * @operationName Send Message (Advanced)
   * @category Messages
   * @description Sends a message to a Discord channel using a raw Discord message payload for full control. The payload object is passed straight to the Discord Create Message endpoint, so it can include multiple rich embeds, interactive components (buttons, select menus), allowed_mentions rules, message_reference for replies, flags, and any other fields Discord supports. Use this when the simple Send Message operation is not flexible enough.
   * @route POST /send-message-advanced
   *
   * @paramDef {"type":"String","label":"Channel","name":"channelId","required":true,"dictionary":"getChannelsDictionary","description":"Target channel. Select a channel or provide a channel ID."}
   * @paramDef {"type":"Object","label":"Message Payload","name":"payload","required":true,"description":"Raw Discord message object, e.g. {\"content\":\"Hi\",\"embeds\":[...],\"components\":[...],\"allowed_mentions\":{\"parse\":[]}}. See the Discord Create Message documentation for all supported fields."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1211234567890123456","channel_id":"1109876543210987654","content":"Pick an option","components":[{"type":1,"components":[{"type":2,"style":1,"label":"Approve","custom_id":"approve"}]}],"embeds":[],"timestamp":"2026-07-13T10:15:00.000000+00:00"}
   */
  async sendMessageAdvanced(channelId, payload) {
    const logTag = '[sendMessageAdvanced]'

    if (!payload || typeof payload !== 'object') {
      throw new Error('Message Payload must be an object matching the Discord message schema.')
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/channels/${ channelId }/messages`,
      method: 'post',
      body: payload,
    })
  }

  /**
   * @operationName Edit Message
   * @category Messages
   * @description Edits a previously sent message in a channel. Only messages authored by the bot can be edited. Updates the text content and, optionally, replaces the message embed with a new one built from the embed fields. Fields left empty are not changed unless a new embed is provided, in which case the previous embeds are replaced.
   * @route PATCH /edit-message
   *
   * @paramDef {"type":"String","label":"Channel","name":"channelId","required":true,"dictionary":"getChannelsDictionary","description":"Channel containing the message. Select a channel or provide a channel ID."}
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"description":"ID of the message to edit. The message must have been sent by this bot."}
   * @paramDef {"type":"String","label":"Content","name":"content","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New message text (up to 2000 characters). Leave empty to keep the current text."}
   * @paramDef {"type":"String","label":"Embed Title","name":"embedTitle","description":"Optional new embed title. Providing any embed field replaces all existing embeds."}
   * @paramDef {"type":"String","label":"Embed Description","name":"embedDescription","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional new embed body text."}
   * @paramDef {"type":"String","label":"Embed Color","name":"embedColor","description":"Optional new embed accent color as a hex value, e.g. #5865F2."}
   * @paramDef {"type":"String","label":"Embed Image URL","name":"embedImageUrl","description":"Optional new public image URL displayed inside the embed."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1211234567890123456","channel_id":"1109876543210987654","content":"Deployment finished (updated)","embeds":[],"edited_timestamp":"2026-07-13T10:20:00.000000+00:00"}
   */
  async editMessage(channelId, messageId, content, embedTitle, embedDescription, embedColor, embedImageUrl) {
    const logTag = '[editMessage]'

    const embed = this.#buildEmbed({
      title: embedTitle,
      description: embedDescription,
      color: embedColor,
      imageUrl: embedImageUrl,
    })

    if (!content && !embed) {
      throw new Error('Provide new content or at least one embed field to edit the message.')
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/channels/${ channelId }/messages/${ messageId }`,
      method: 'patch',
      body: clean({
        content,
        embeds: embed ? [embed] : undefined,
      }),
    })
  }

  /**
   * @operationName Delete Message
   * @category Messages
   * @description Permanently deletes a message from a channel. The bot can always delete its own messages; deleting other users' messages requires the Manage Messages permission in the channel. Deletion cannot be undone.
   * @route DELETE /delete-message
   *
   * @paramDef {"type":"String","label":"Channel","name":"channelId","required":true,"dictionary":"getChannelsDictionary","description":"Channel containing the message. Select a channel or provide a channel ID."}
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"description":"ID of the message to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"channelId":"1109876543210987654","messageId":"1211234567890123456"}
   */
  async deleteMessage(channelId, messageId) {
    const logTag = '[deleteMessage]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/channels/${ channelId }/messages/${ messageId }`,
      method: 'delete',
    })

    return { success: true, channelId, messageId }
  }

  /**
   * @operationName Get Messages
   * @category Messages
   * @description Retrieves recent messages from a channel, newest first. Supports paging backwards through history with the Before message ID or forwards with the After message ID (use only one of the two). Returns up to 100 messages per call, including author, content, embeds, attachments, and reactions. Requires the Read Message History permission.
   * @route GET /get-messages
   *
   * @paramDef {"type":"String","label":"Channel","name":"channelId","required":true,"dictionary":"getChannelsDictionary","description":"Channel to read messages from. Select a channel or provide a channel ID."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of messages to return (1-100). Defaults to 50."}
   * @paramDef {"type":"String","label":"Before Message ID","name":"before","description":"Return only messages sent before this message ID (paging backwards through history)."}
   * @paramDef {"type":"String","label":"After Message ID","name":"after","description":"Return only messages sent after this message ID (paging forwards through history)."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"1211234567890123456","channel_id":"1109876543210987654","content":"Deployment finished","author":{"id":"1101111111111111111","username":"flowrunner-bot","bot":true},"timestamp":"2026-07-13T10:15:00.000000+00:00","attachments":[],"embeds":[]}]
   */
  async getMessages(channelId, limit, before, after) {
    const logTag = '[getMessages]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/channels/${ channelId }/messages`,
      method: 'get',
      query: {
        limit: limit || DEFAULT_MESSAGES_LIMIT,
        before,
        after,
      },
    })
  }

  /**
   * @operationName Get Message
   * @category Messages
   * @description Retrieves a single message by its ID, including author, content, embeds, attachments, reactions, and thread information. Requires the Read Message History permission in the channel.
   * @route GET /get-message
   *
   * @paramDef {"type":"String","label":"Channel","name":"channelId","required":true,"dictionary":"getChannelsDictionary","description":"Channel containing the message. Select a channel or provide a channel ID."}
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"description":"ID of the message to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1211234567890123456","channel_id":"1109876543210987654","content":"Deployment finished","author":{"id":"1101111111111111111","username":"flowrunner-bot","bot":true},"timestamp":"2026-07-13T10:15:00.000000+00:00","reactions":[{"emoji":{"name":"👍"},"count":3}]}
   */
  async getMessage(channelId, messageId) {
    const logTag = '[getMessage]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/channels/${ channelId }/messages/${ messageId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Add Reaction
   * @category Messages
   * @description Adds an emoji reaction to a message as the bot. Accepts a standard Unicode emoji (e.g. 👍 or 🎉) or a custom server emoji in the name:id format (e.g. partyblob:1234567890123456789). Requires the Add Reactions permission, plus Read Message History to access the message.
   * @route PUT /add-reaction
   *
   * @paramDef {"type":"String","label":"Channel","name":"channelId","required":true,"dictionary":"getChannelsDictionary","description":"Channel containing the message. Select a channel or provide a channel ID."}
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"description":"ID of the message to react to."}
   * @paramDef {"type":"String","label":"Emoji","name":"emoji","required":true,"description":"Unicode emoji character (e.g. 👍) or a custom emoji as name:id (e.g. partyblob:1234567890123456789)."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"channelId":"1109876543210987654","messageId":"1211234567890123456","emoji":"👍"}
   */
  async addReaction(channelId, messageId, emoji) {
    const logTag = '[addReaction]'

    const encodedEmoji = encodeURIComponent(emoji)

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/channels/${ channelId }/messages/${ messageId }/reactions/${ encodedEmoji }/@me`,
      method: 'put',
      body: {},
    })

    return { success: true, channelId, messageId, emoji }
  }

  /**
   * @operationName Send Direct Message
   * @category Messages
   * @description Sends a private direct message to a server member as the bot. Opens (or reuses) a DM channel with the user, then posts the message to it. Note: Discord only allows bots to DM users who share a server with the bot, and users can disable DMs from server members, in which case delivery fails with a permissions error.
   * @route POST /send-direct-message
   *
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getMembersDictionary","description":"Recipient. Select a server member or provide a Discord user ID."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Message text (up to 2000 characters). Supports Discord markdown."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1211234567890123456","channel_id":"1150000000000000000","content":"Your report is ready","author":{"id":"1101111111111111111","username":"flowrunner-bot","bot":true},"timestamp":"2026-07-13T10:15:00.000000+00:00"}
   */
  async sendDirectMessage(userId, content) {
    const logTag = '[sendDirectMessage]'

    const dmChannel = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users/@me/channels`,
      method: 'post',
      body: { recipient_id: userId },
    })

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/channels/${ dmChannel.id }/messages`,
      method: 'post',
      body: { content },
    })
  }

  /**
   * @operationName Create Channel
   * @category Channels
   * @description Creates a new channel in the configured Discord server. Supports text, voice, category, and announcement channel types, an optional topic (text and announcement channels), and an optional parent category to nest the channel under. Requires the Manage Channels permission. Returns the created channel including its ID.
   * @route POST /create-channel
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Channel name (1-100 characters). Discord lowercases text channel names and replaces spaces with dashes."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"defaultValue":"Text","uiComponent":{"type":"DROPDOWN","options":{"values":["Text","Voice","Category","Announcement"]}},"description":"Kind of channel to create. Announcement channels require the server to have the Community feature enabled."}
   * @paramDef {"type":"String","label":"Topic","name":"topic","description":"Optional channel topic shown at the top of the channel (text and announcement channels, up to 1024 characters)."}
   * @paramDef {"type":"String","label":"Parent Category ID","name":"parentId","description":"Optional ID of a category channel to place the new channel under. Use List Channels to find category IDs (type 4)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1160000000000000000","type":0,"name":"release-notes","topic":"Automated release announcements","guild_id":"1100000000000000000","parent_id":"1155555555555555555","position":7}
   */
  async createChannel(name, type, topic, parentId) {
    const logTag = '[createChannel]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/guilds/${ this.guildId }/channels`,
      method: 'post',
      body: clean({
        name,
        type: this.#resolveChoice(type, {
          'Text': 0,
          'Voice': 2,
          'Category': 4,
          'Announcement': 5,
        }),
        topic,
        parent_id: parentId,
      }),
    })
  }

  /**
   * @operationName List Channels
   * @category Channels
   * @description Lists all channels in the configured Discord server, including text, voice, category, announcement, forum, and stage channels (threads are not included). Each entry contains the channel ID, name, numeric type, topic, position, and parent category ID.
   * @route GET /list-channels
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"1109876543210987654","type":0,"name":"general","topic":"Team chat","guild_id":"1100000000000000000","parent_id":null,"position":0},{"id":"1155555555555555555","type":4,"name":"Projects","guild_id":"1100000000000000000","parent_id":null,"position":1}]
   */
  async listChannels() {
    const logTag = '[listChannels]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/guilds/${ this.guildId }/channels`,
      method: 'get',
    })
  }

  /**
   * @operationName Delete Channel
   * @category Channels
   * @description Permanently deletes a channel from the server, or closes a thread. Deleting a category does not delete the channels inside it. Requires the Manage Channels permission. This action cannot be undone and removes all messages in the channel.
   * @route DELETE /delete-channel
   *
   * @paramDef {"type":"String","label":"Channel ID","name":"channelId","required":true,"description":"ID of the channel or thread to delete. Use List Channels to find channel IDs."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"channelId":"1160000000000000000","name":"release-notes"}
   */
  async deleteChannel(channelId) {
    const logTag = '[deleteChannel]'

    const deleted = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/channels/${ channelId }`,
      method: 'delete',
    })

    return { success: true, channelId, name: deleted?.name }
  }

  /**
   * @operationName Create Thread
   * @category Channels
   * @description Creates a thread in a text or announcement channel. When a Message ID is provided the thread is attached to that message; otherwise a standalone public thread is created. The auto-archive duration controls how long the thread stays visible without activity. Requires the Create Public Threads permission.
   * @route POST /create-thread
   *
   * @paramDef {"type":"String","label":"Channel","name":"channelId","required":true,"dictionary":"getChannelsDictionary","description":"Parent channel for the thread. Select a channel or provide a channel ID."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Thread name (1-100 characters)."}
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","description":"Optional ID of a message to start the thread from. Leave empty to create a standalone thread."}
   * @paramDef {"type":"String","label":"Auto Archive Duration","name":"autoArchiveDuration","defaultValue":"1 Day","uiComponent":{"type":"DROPDOWN","options":{"values":["1 Hour","1 Day","3 Days","1 Week"]}},"description":"How long the thread stays out of the archived state without new activity. Defaults to 1 Day."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1170000000000000000","type":11,"name":"Bug triage 2026-07-13","parent_id":"1109876543210987654","guild_id":"1100000000000000000","thread_metadata":{"archived":false,"auto_archive_duration":1440}}
   */
  async createThread(channelId, name, messageId, autoArchiveDuration) {
    const logTag = '[createThread]'

    const duration = this.#resolveChoice(autoArchiveDuration, {
      '1 Hour': 60,
      '1 Day': 1440,
      '3 Days': 4320,
      '1 Week': 10080,
    })

    const url = messageId
      ? `${ API_BASE_URL }/channels/${ channelId }/messages/${ messageId }/threads`
      : `${ API_BASE_URL }/channels/${ channelId }/threads`

    return await this.#apiRequest({
      logTag,
      url,
      method: 'post',
      body: clean({
        name,
        auto_archive_duration: duration,
        // type is required only for standalone threads; 11 = public thread
        type: messageId ? undefined : 11,
      }),
    })
  }

  /**
   * @operationName List Guild Members
   * @category Members & Roles
   * @description Lists members of the configured Discord server, sorted by user ID. Returns up to 1000 members per call; page through larger servers by passing the highest user ID from the previous page as the After parameter. Requires the Server Members privileged intent to be enabled for the bot in the Discord Developer Portal.
   * @route GET /list-guild-members
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of members to return (1-1000). Defaults to 100."}
   * @paramDef {"type":"String","label":"After User ID","name":"after","description":"Return only members with a user ID greater than this value. Use for pagination."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"user":{"id":"1101111111111111111","username":"jane_doe","global_name":"Jane"},"nick":"Jane D","roles":["1122222222222222222"],"joined_at":"2025-02-01T09:00:00.000000+00:00"}]
   */
  async listGuildMembers(limit, after) {
    const logTag = '[listGuildMembers]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/guilds/${ this.guildId }/members`,
      method: 'get',
      query: {
        limit: limit || DEFAULT_MEMBERS_LIMIT,
        after,
      },
    })
  }

  /**
   * @operationName Get Guild Member
   * @category Members & Roles
   * @description Retrieves a single member of the configured server by user ID, including their username, server nickname, assigned role IDs, join date, and timeout status.
   * @route GET /get-guild-member
   *
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getMembersDictionary","description":"Member to retrieve. Select a server member or provide a Discord user ID."}
   *
   * @returns {Object}
   * @sampleResult {"user":{"id":"1101111111111111111","username":"jane_doe","global_name":"Jane"},"nick":"Jane D","roles":["1122222222222222222","1133333333333333333"],"joined_at":"2025-02-01T09:00:00.000000+00:00","communication_disabled_until":null}
   */
  async getGuildMember(userId) {
    const logTag = '[getGuildMember]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/guilds/${ this.guildId }/members/${ userId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Add Role To Member
   * @category Members & Roles
   * @description Assigns a role to a server member. Requires the Manage Roles permission, and the bot's highest role must be positioned above the role being assigned in the server's role list.
   * @route PUT /add-role-to-member
   *
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getMembersDictionary","description":"Member to modify. Select a server member or provide a Discord user ID."}
   * @paramDef {"type":"String","label":"Role","name":"roleId","required":true,"dictionary":"getRolesDictionary","description":"Role to assign. Select a role or provide a role ID."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"userId":"1101111111111111111","roleId":"1122222222222222222","action":"added"}
   */
  async addRoleToMember(userId, roleId) {
    const logTag = '[addRoleToMember]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/guilds/${ this.guildId }/members/${ userId }/roles/${ roleId }`,
      method: 'put',
      body: {},
    })

    return { success: true, userId, roleId, action: 'added' }
  }

  /**
   * @operationName Remove Role From Member
   * @category Members & Roles
   * @description Removes a role from a server member. Requires the Manage Roles permission, and the bot's highest role must be positioned above the role being removed in the server's role list.
   * @route DELETE /remove-role-from-member
   *
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getMembersDictionary","description":"Member to modify. Select a server member or provide a Discord user ID."}
   * @paramDef {"type":"String","label":"Role","name":"roleId","required":true,"dictionary":"getRolesDictionary","description":"Role to remove. Select a role or provide a role ID."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"userId":"1101111111111111111","roleId":"1122222222222222222","action":"removed"}
   */
  async removeRoleFromMember(userId, roleId) {
    const logTag = '[removeRoleFromMember]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/guilds/${ this.guildId }/members/${ userId }/roles/${ roleId }`,
      method: 'delete',
    })

    return { success: true, userId, roleId, action: 'removed' }
  }

  /**
   * @operationName List Roles
   * @category Members & Roles
   * @description Lists all roles in the configured Discord server with their ID, name, color, position, permissions bitfield, and whether they are managed by an integration. Role IDs can be used with Add Role To Member and Remove Role From Member.
   * @route GET /list-roles
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"1100000000000000000","name":"@everyone","color":0,"position":0,"permissions":"559623605571137","managed":false},{"id":"1122222222222222222","name":"Moderator","color":15844367,"position":3,"permissions":"17179869184","managed":false}]
   */
  async listRoles() {
    const logTag = '[listRoles]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/guilds/${ this.guildId }/roles`,
      method: 'get',
    })
  }

  /**
   * @operationName Send Webhook Message
   * @category Webhooks
   * @description Posts a message through a Discord webhook URL without using the bot token — a standalone escape hatch for channels or servers where the bot is not installed. Create the webhook in Discord (Channel Settings → Integrations → Webhooks) and paste its URL. Supports text content, a custom username and avatar override, and an optional simple embed. Returns the created message.
   * @route POST /send-webhook-message
   *
   * @paramDef {"type":"String","label":"Webhook URL","name":"webhookUrl","required":true,"description":"Full Discord webhook URL, e.g. https://discord.com/api/webhooks/{id}/{token}. Treat it as a secret."}
   * @paramDef {"type":"String","label":"Content","name":"content","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Message text (up to 2000 characters). Required unless an embed is provided."}
   * @paramDef {"type":"String","label":"Username Override","name":"username","description":"Optional display name for this message, overriding the webhook's default name."}
   * @paramDef {"type":"String","label":"Avatar URL Override","name":"avatarUrl","description":"Optional public image URL used as the avatar for this message."}
   * @paramDef {"type":"String","label":"Embed Title","name":"embedTitle","description":"Optional embed title (up to 256 characters)."}
   * @paramDef {"type":"String","label":"Embed Description","name":"embedDescription","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional embed body text (up to 4096 characters)."}
   * @paramDef {"type":"String","label":"Embed Color","name":"embedColor","description":"Optional embed accent color as a hex value, e.g. #5865F2."}
   * @paramDef {"type":"String","label":"Embed Image URL","name":"embedImageUrl","description":"Optional public image URL displayed inside the embed."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1211234567890123456","channel_id":"1109876543210987654","content":"Nightly backup completed","author":{"username":"Backup Bot","bot":true},"webhook_id":"1180000000000000000","timestamp":"2026-07-13T10:15:00.000000+00:00"}
   */
  async sendWebhookMessage(webhookUrl, content, username, avatarUrl, embedTitle, embedDescription, embedColor, embedImageUrl) {
    const logTag = '[sendWebhookMessage]'

    if (!webhookUrl || !/^https:\/\/(?:[a-z]+\.)?discord(?:app)?\.com\/api\/webhooks\//.test(webhookUrl)) {
      throw new Error('Webhook URL must be a Discord webhook URL like https://discord.com/api/webhooks/{id}/{token}.')
    }

    const embed = this.#buildEmbed({
      title: embedTitle,
      description: embedDescription,
      color: embedColor,
      imageUrl: embedImageUrl,
    })

    if (!content && !embed) {
      throw new Error('Either message content or at least one embed field (title, description, color, image) is required.')
    }

    try {
      logger.debug(`${ logTag } - posting to webhook`)

      // wait=true makes Discord return the created message instead of 204 No Content
      return await Flowrunner.Request.post(webhookUrl)
        .set({ 'Content-Type': 'application/json' })
        .query({ wait: true })
        .send(clean({
          content,
          username,
          avatar_url: avatarUrl,
          embeds: embed ? [embed] : undefined,
        }))
    } catch (error) {
      throw this.#composeError(error, logTag)
    }
  }

  /**
   * @typedef {Object} getChannelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter channels by name (case-insensitive)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Discord returns all guild channels in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Channels Dictionary
   * @description Lists message-capable channels (text and announcement) in the configured server for channel selection parameters. The option value is the channel ID and the note shows the channel type.
   * @route POST /get-channels-dictionary
   * @paramDef {"type":"getChannelsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"general","value":"1109876543210987654","note":"Text"}],"cursor":null}
   */
  async getChannelsDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getChannelsDictionary]'

    const channels = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/guilds/${ this.guildId }/channels`,
      method: 'get',
    })

    const searchLower = (search || '').toLowerCase()

    const items = (channels || [])
      .filter(channel => channel.type === 0 || channel.type === 5)
      .filter(channel => !searchLower || channel.name.toLowerCase().includes(searchLower))
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map(channel => ({
        label: channel.name,
        value: channel.id,
        note: CHANNEL_TYPE_NAMES[channel.type] || `Type ${ channel.type }`,
      }))

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} getRolesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter roles by name (case-insensitive)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Discord returns all guild roles in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Roles Dictionary
   * @description Lists roles in the configured server for role selection parameters. The option value is the role ID. Integration-managed roles (e.g. bot roles) are marked in the note and cannot be assigned manually.
   * @route POST /get-roles-dictionary
   * @paramDef {"type":"getRolesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Moderator","value":"1122222222222222222","note":"Position 3"}],"cursor":null}
   */
  async getRolesDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getRolesDictionary]'

    const roles = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/guilds/${ this.guildId }/roles`,
      method: 'get',
    })

    const searchLower = (search || '').toLowerCase()

    const items = (roles || [])
      .filter(role => !searchLower || role.name.toLowerCase().includes(searchLower))
      .sort((a, b) => (b.position ?? 0) - (a.position ?? 0))
      .map(role => ({
        label: role.name,
        value: role.id,
        note: role.managed ? 'Managed by integration' : `Position ${ role.position }`,
      }))

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} getMembersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter members by username or nickname (uses Discord member search)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (the highest user ID from the previous page)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Members Dictionary
   * @description Lists members of the configured server for user selection parameters. The option label is the username and the value is the user ID. When a search term is provided, Discord's member search endpoint is used; otherwise members are paged by user ID. Requires the Server Members privileged intent.
   * @route POST /get-members-dictionary
   * @paramDef {"type":"getMembersDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"jane_doe","value":"1101111111111111111","note":"Jane D"}],"cursor":"1101111111111111111"}
   */
  async getMembersDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getMembersDictionary]'

    let members

    if (search) {
      members = await this.#apiRequest({
        logTag,
        url: `${ API_BASE_URL }/guilds/${ this.guildId }/members/search`,
        method: 'get',
        query: { query: search, limit: DEFAULT_MEMBERS_LIMIT },
      })
    } else {
      members = await this.#apiRequest({
        logTag,
        url: `${ API_BASE_URL }/guilds/${ this.guildId }/members`,
        method: 'get',
        query: { limit: DEFAULT_MEMBERS_LIMIT, after: cursor },
      })
    }

    const items = (members || []).map(member => ({
      label: member.user?.username || member.user?.id,
      value: member.user?.id,
      note: member.nick || member.user?.global_name || undefined,
    }))

    const nextCursor = !search && items.length === DEFAULT_MEMBERS_LIMIT
      ? items[items.length - 1].value
      : null

    return { items, cursor: nextCursor }
  }
}

Flowrunner.ServerCode.addService(DiscordService, [
  {
    name: 'botToken',
    displayName: 'Bot Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Discord Developer Portal → your app → Bot → Token. The bot must be invited to your server with appropriate permissions.',
  },
  {
    name: 'guildId',
    displayName: 'Server (Guild) ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your server ID. Enable Developer Mode in Discord (Settings → Advanced), then right-click the server name → Copy Server ID.',
  },
])
