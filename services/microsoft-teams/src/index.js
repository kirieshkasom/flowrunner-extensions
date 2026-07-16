const OAUTH_BASE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const API_BASE_URL = 'https://graph.microsoft.com/v1.0'
const PAGE_SIZE_DICTIONARY = 20

const DEFAULT_SCOPE_LIST = [
  'offline_access',
  'User.Read',
  'Team.ReadBasic.All',
  'Channel.ReadBasic.All',
  'ChannelMessage.Send',
  'ChannelMessage.Read.All',
  'Chat.ReadWrite',
  'ChatMessage.Send',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const logger = {
  info: (...args) => console.log('[Microsoft Teams] info:', ...args),
  debug: (...args) => console.log('[Microsoft Teams] debug:', ...args),
  error: (...args) => console.log('[Microsoft Teams] error:', ...args),
  warn: (...args) => console.log('[Microsoft Teams] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName Microsoft Teams
 * @integrationIcon /icon.png
 **/
class MicrosoftTeamsService {
  /**
   * @typedef {Object} getTeamsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter teams by display name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination link for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getChannelsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Team ID","name":"teamId","required":true,"description":"The ID of the team whose channels to list."}
   */

  /**
   * @typedef {Object} getChannelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter channels by display name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination link for retrieving the next page of results."}
   * @paramDef {"type":"getChannelsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The team whose channels to list."}
   */

  /**
   * @typedef {Object} getChatsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter chats by topic or member names. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination link for retrieving the next page of results."}
   */
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  #getAccessTokenHeader(accessToken) {
    return {
      Authorization: `Bearer ${ this.request.headers['oauth-access-token'] || accessToken }`,
    }
  }

  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'
    query = cleanupObject(query)

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      return await Flowrunner.Request[method](url).set(this.#getAccessTokenHeader()).query(query).send(body)
    } catch (error) {
      const message = error.body?.error?.message || error.message

      logger.error(`${ logTag } - error: ${ message }`)

      throw new Error(`Microsoft Teams API error: ${ message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()
    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('scope', this.scopes)
    params.append('response_mode', 'query')

    return `${ OAUTH_BASE_URL }/authorize?${ params.toString() }`
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   * @property {String} token
   * @property {String} refreshToken
   * @property {Number} expirationInSeconds
   * @property {Object} userData
   * @property {String} connectionIdentityName
   * @property {Boolean} overwrite
   */

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    const code = callbackObject.code
    const url = `${ OAUTH_BASE_URL }/token`

    const params = new URLSearchParams()
    params.append('client_id', this.clientId)
    params.append('code', code)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('grant_type', 'authorization_code')
    params.append('client_secret', this.clientSecret)

    const response = await Flowrunner.Request.post(url)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    let userData = {}

    try {
      userData = await Flowrunner.Request.get(`${ API_BASE_URL }/me`).set({
        Authorization: `Bearer ${ response.access_token }`,
        'Content-Type': 'application/json',
      })

      logger.debug(`[executeCallback] userData response: ${ JSON.stringify(userData, null, 2) }`)
    } catch (error) {
      logger.error(`[executeCallback] getUserProfile error: ${ error.message }`)
    }

    return {
      token: response.access_token,
      refreshToken: response.refresh_token,
      expirationInSeconds: response.expires_in,
      connectionIdentityName: constructIdentityName(userData),
      overwrite: true,
      userData: userData,
    }
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   * @property {String} token
   * @property {Number} expirationInSeconds
   * @property {String} refreshToken
   */

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    const url = `${ OAUTH_BASE_URL }/token`

    const params = new URLSearchParams()
    params.append('client_id', this.clientId)
    params.append('scope', this.scopes)
    params.append('refresh_token', refreshToken)
    params.append('grant_type', 'refresh_token')
    params.append('client_secret', this.clientSecret)

    try {
      const response = await Flowrunner.Request.post(url)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      return {
        token: response.access_token,
        refreshToken: response.refresh_token,
        expirationInSeconds: response.expires_in,
      }
    } catch (error) {
      logger.error('Error refreshing token: ', error.message || error)
      throw error
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Teams Dictionary
   * @description Provides a searchable list of the signed-in user's joined teams for dynamic parameter selection.
   * @route POST /get-teams-dictionary
   * @paramDef {"type":"getTeamsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering teams."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Engineering","value":"19c9a1f2-8f5b-4d3e-9c1a-2b7e6f0d4a11","note":"ID: 19c9a1f2-8f5b-4d3e-9c1a-2b7e6f0d4a11"}],"cursor":null}
   */
  async getTeamsDictionary(payload) {
    const { search, cursor } = payload || {}
    const url = cursor ? cursor : `${ API_BASE_URL }/me/joinedTeams`

    const response = await this.#apiRequest({
      url,
      logTag: 'getTeamsDictionary',
    })

    const teams = response.value || []
    const filteredTeams = search ? searchFilter(teams, ['displayName'], search) : teams

    return {
      cursor: response['@odata.nextLink'] || null,
      items: filteredTeams.map(({ id, displayName }) => ({
        label: displayName,
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Channels Dictionary
   * @description Provides a searchable list of channels within a selected team for dynamic parameter selection. Requires a team to be chosen first.
   * @route POST /get-channels-dictionary
   * @paramDef {"type":"getChannelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string, pagination cursor, and the team criteria whose channels to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"General","value":"19:abcdef1234567890@thread.tacv2","note":"Standard channel"}],"cursor":null}
   */
  async getChannelsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const teamId = criteria?.teamId

    if (!teamId) {
      return { items: [], cursor: null }
    }

    const url = cursor ? cursor : `${ API_BASE_URL }/teams/${ teamId }/channels`

    const response = await this.#apiRequest({
      url,
      logTag: 'getChannelsDictionary',
    })

    const channels = response.value || []
    const filteredChannels = search ? searchFilter(channels, ['displayName'], search) : channels

    return {
      cursor: response['@odata.nextLink'] || null,
      items: filteredChannels.map(({ id, displayName, membershipType }) => ({
        label: displayName,
        note: membershipType ? `${ capitalize(membershipType) } channel` : `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Chats Dictionary
   * @description Provides a searchable list of the signed-in user's chats for dynamic parameter selection. Chats are labeled by topic when available, otherwise by member names.
   * @route POST /get-chats-dictionary
   * @paramDef {"type":"getChatsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering chats."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Jane Doe, John Smith","value":"19:2da4c29f6d7041eca70b638b43d45437@thread.v2","note":"oneOnOne"}],"cursor":null}
   */
  async getChatsDictionary(payload) {
    const { search, cursor } = payload || {}
    const url = cursor ? cursor : `${ API_BASE_URL }/me/chats`

    const query = cursor
      ? undefined
      : {
        $expand: 'members',
        $top: PAGE_SIZE_DICTIONARY,
      }

    const response = await this.#apiRequest({
      url,
      query,
      logTag: 'getChatsDictionary',
    })

    const chats = (response.value || []).map(chat => ({
      ...chat,
      resolvedLabel: chat.topic || (chat.members || []).map(member => member.displayName).filter(Boolean).join(', ') || chat.id,
    }))

    const filteredChats = search ? searchFilter(chats, ['resolvedLabel'], search) : chats

    return {
      cursor: response['@odata.nextLink'] || null,
      items: filteredChats.map(({ id, resolvedLabel, chatType }) => ({
        label: resolvedLabel,
        note: chatType || `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @operationName Get My Profile
   * @category User Information
   * @appearanceColor #6264A7 #464775
   * @description Retrieves the profile of the signed-in user including display name, email, and user principal name. Useful for verifying the connection.
   * @route GET /me
   * @returns {Object}
   * @sampleResult {"id":"87d349ed-44d7-43e1-9a83-5f2406dee5bd","displayName":"John Smith","mail":"john.smith@company.com","userPrincipalName":"john.smith@company.com","jobTitle":"Engineer","officeLocation":"Building 1"}
   */
  getMyProfile() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/me`,
      logTag: 'getMyProfile',
    })
  }

  /**
   * @operationName List Teams
   * @category Teams
   * @appearanceColor #6264A7 #464775
   * @description Retrieves the Microsoft Teams the signed-in user is a member of, including each team's ID, display name, and description.
   * @route GET /list-teams
   * @returns {Object}
   * @sampleResult {"value":[{"id":"19c9a1f2-8f5b-4d3e-9c1a-2b7e6f0d4a11","displayName":"Engineering","description":"Engineering team workspace","isArchived":false}]}
   */
  listTeams() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/me/joinedTeams`,
      logTag: 'listTeams',
    })
  }

  /**
   * @operationName List Team Members
   * @category Teams
   * @appearanceColor #6264A7 #464775
   * @description Retrieves the members of a team, including each member's display name, email, roles, and Microsoft Entra user ID.
   * @route GET /list-team-members
   * @paramDef {"type":"String","label":"Team","name":"teamId","required":true,"dictionary":"getTeamsDictionary","description":"The team whose members to list. Choose a team or paste a team ID."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"MCMjMiMjZGVm","displayName":"Jane Doe","email":"jane.doe@company.com","roles":["owner"],"userId":"87d349ed-44d7-43e1-9a83-5f2406dee5bd"}]}
   */
  async listTeamMembers(teamId) {
    if (!teamId) {
      throw new Error('Parameter "Team" is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/teams/${ teamId }/members`,
      logTag: 'listTeamMembers',
    })
  }

  /**
   * @operationName List Channels
   * @category Channels
   * @appearanceColor #6264A7 #464775
   * @description Retrieves the channels of a team, including each channel's ID, display name, description, and membership type (standard, private, or shared).
   * @route GET /list-channels
   * @paramDef {"type":"String","label":"Team","name":"teamId","required":true,"dictionary":"getTeamsDictionary","description":"The team whose channels to list. Choose a team or paste a team ID."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"19:abcdef1234567890@thread.tacv2","displayName":"General","description":"Team general channel","membershipType":"standard"}]}
   */
  async listChannels(teamId) {
    if (!teamId) {
      throw new Error('Parameter "Team" is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/teams/${ teamId }/channels`,
      logTag: 'listChannels',
    })
  }

  /**
   * @operationName Create Channel
   * @category Channels
   * @appearanceColor #6264A7 #464775
   * @description Creates a new channel in a team with the given display name, optional description, and membership type. When creating a private channel, the signed-in user is automatically added as the channel owner.
   * @route POST /create-channel
   * @paramDef {"type":"String","label":"Team","name":"teamId","required":true,"dictionary":"getTeamsDictionary","description":"The team in which to create the channel. Choose a team or paste a team ID."}
   * @paramDef {"type":"String","label":"Channel Name","name":"displayName","required":true,"description":"The display name of the new channel. Maximum 50 characters."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"An optional description for the channel."}
   * @paramDef {"type":"String","label":"Membership Type","name":"membershipType","defaultValue":"Standard","uiComponent":{"type":"DROPDOWN","options":{"values":["Standard","Private"]}},"description":"The channel visibility. Standard channels are open to all team members; Private channels are restricted to invited members. Defaults to Standard."}
   * @returns {Object}
   * @sampleResult {"id":"19:abcdef1234567890@thread.tacv2","displayName":"Project Alpha","description":"Channel for Project Alpha","membershipType":"standard"}
   */
  async createChannel(teamId, displayName, description, membershipType) {
    if (!teamId) {
      throw new Error('Parameter "Team" is required')
    }

    if (!displayName) {
      throw new Error('Parameter "Channel Name" is required')
    }

    const resolvedMembershipType = this.#resolveChoice(membershipType, {
      Standard: 'standard',
      Private: 'private',
    }) || 'standard'

    const body = cleanupObject({
      displayName,
      description,
      membershipType: resolvedMembershipType,
    })

    if (resolvedMembershipType === 'private') {
      const me = await this.#apiRequest({
        url: `${ API_BASE_URL }/me`,
        logTag: 'createChannel',
      })

      body.members = [
        {
          '@odata.type': '#microsoft.graph.aadUserConversationMember',
          'user@odata.bind': `${ API_BASE_URL }/users('${ me.id }')`,
          roles: ['owner'],
        },
      ]
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/teams/${ teamId }/channels`,
      logTag: 'createChannel',
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Delete Channel
   * @category Channels
   * @appearanceColor #6264A7 #464775
   * @description Deletes a channel from a team. The channel is soft-deleted and can be restored by a team administrator within 30 days.
   * @route DELETE /delete-channel
   * @paramDef {"type":"String","label":"Team","name":"teamId","required":true,"dictionary":"getTeamsDictionary","description":"The team that contains the channel. Choose a team or paste a team ID."}
   * @paramDef {"type":"String","label":"Channel","name":"channelId","required":true,"dictionary":"getChannelsDictionary","dependsOn":["teamId"],"description":"The channel to delete. Choose a team above to pick from its channels, or paste a channel ID."}
   * @returns {Object}
   * @sampleResult {"message":"Channel deleted successfully"}
   */
  async deleteChannel(teamId, channelId) {
    if (!teamId) {
      throw new Error('Parameter "Team" is required')
    }

    if (!channelId) {
      throw new Error('Parameter "Channel" is required')
    }

    await this.#apiRequest({
      url: `${ API_BASE_URL }/teams/${ teamId }/channels/${ channelId }`,
      logTag: 'deleteChannel',
      method: 'delete',
    })

    return { message: 'Channel deleted successfully' }
  }

  /**
   * @operationName Send Channel Message
   * @category Channel Messages
   * @appearanceColor #6264A7 #464775
   * @description Sends a message to a team channel as the signed-in user. Supports plain text or HTML content and an optional subject line.
   * @route POST /send-channel-message
   * @paramDef {"type":"String","label":"Team","name":"teamId","required":true,"dictionary":"getTeamsDictionary","description":"The team that contains the channel. Choose a team or paste a team ID."}
   * @paramDef {"type":"String","label":"Channel","name":"channelId","required":true,"dictionary":"getChannelsDictionary","dependsOn":["teamId"],"description":"The channel to post the message to. Choose a team above to pick from its channels, or paste a channel ID."}
   * @paramDef {"type":"String","label":"Content Type","name":"contentType","defaultValue":"Text","uiComponent":{"type":"DROPDOWN","options":{"values":["Text","HTML"]}},"description":"The format of the message body. Defaults to Text."}
   * @paramDef {"type":"String","label":"Message","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The body of the message. Use HTML markup when Content Type is set to HTML."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"An optional subject line displayed above the message."}
   * @returns {Object}
   * @sampleResult {"id":"1752403200000","messageType":"message","createdDateTime":"2026-07-13T10:00:00Z","subject":"Status Update","body":{"contentType":"text","content":"Deployment completed"},"from":{"user":{"displayName":"John Smith"}}}
   */
  async sendChannelMessage(teamId, channelId, contentType, content, subject) {
    if (!teamId) {
      throw new Error('Parameter "Team" is required')
    }

    if (!channelId) {
      throw new Error('Parameter "Channel" is required')
    }

    if (!content) {
      throw new Error('Parameter "Message" is required')
    }

    const body = cleanupObject({
      subject,
      body: {
        contentType: this.#resolveChoice(contentType, { Text: 'text', HTML: 'html' }) || 'text',
        content,
      },
    })

    return this.#apiRequest({
      url: `${ API_BASE_URL }/teams/${ teamId }/channels/${ channelId }/messages`,
      logTag: 'sendChannelMessage',
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Reply To Channel Message
   * @category Channel Messages
   * @appearanceColor #6264A7 #464775
   * @description Sends a reply to an existing message in a team channel as the signed-in user. Supports plain text or HTML content.
   * @route POST /reply-to-channel-message
   * @paramDef {"type":"String","label":"Team","name":"teamId","required":true,"dictionary":"getTeamsDictionary","description":"The team that contains the channel. Choose a team or paste a team ID."}
   * @paramDef {"type":"String","label":"Channel","name":"channelId","required":true,"dictionary":"getChannelsDictionary","dependsOn":["teamId"],"description":"The channel that contains the message. Choose a team above to pick from its channels, or paste a channel ID."}
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"description":"The ID of the root channel message to reply to."}
   * @paramDef {"type":"String","label":"Content Type","name":"contentType","defaultValue":"Text","uiComponent":{"type":"DROPDOWN","options":{"values":["Text","HTML"]}},"description":"The format of the reply body. Defaults to Text."}
   * @paramDef {"type":"String","label":"Reply","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The body of the reply. Use HTML markup when Content Type is set to HTML."}
   * @returns {Object}
   * @sampleResult {"id":"1752403260000","messageType":"message","replyToId":"1752403200000","createdDateTime":"2026-07-13T10:01:00Z","body":{"contentType":"text","content":"Thanks for the update"},"from":{"user":{"displayName":"Jane Doe"}}}
   */
  async replyToChannelMessage(teamId, channelId, messageId, contentType, content) {
    if (!teamId) {
      throw new Error('Parameter "Team" is required')
    }

    if (!channelId) {
      throw new Error('Parameter "Channel" is required')
    }

    if (!messageId) {
      throw new Error('Parameter "Message ID" is required')
    }

    if (!content) {
      throw new Error('Parameter "Reply" is required')
    }

    const body = {
      body: {
        contentType: this.#resolveChoice(contentType, { Text: 'text', HTML: 'html' }) || 'text',
        content,
      },
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/teams/${ teamId }/channels/${ channelId }/messages/${ messageId }/replies`,
      logTag: 'replyToChannelMessage',
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Get Channel Messages
   * @category Channel Messages
   * @appearanceColor #6264A7 #464775
   * @description Retrieves the most recent top-level messages from a team channel, newest first. Replies are not included; use Get Channel Message or the replies of a specific message to inspect threads.
   * @route GET /get-channel-messages
   * @paramDef {"type":"String","label":"Team","name":"teamId","required":true,"dictionary":"getTeamsDictionary","description":"The team that contains the channel. Choose a team or paste a team ID."}
   * @paramDef {"type":"String","label":"Channel","name":"channelId","required":true,"dictionary":"getChannelsDictionary","dependsOn":["teamId"],"description":"The channel whose messages to retrieve. Choose a team above to pick from its channels, or paste a channel ID."}
   * @paramDef {"type":"Number","label":"Max Results","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The maximum number of messages to retrieve. Defaults to 20. Microsoft Graph allows up to 50 per page."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"URL to retrieve the next page of results. If provided, all other parameters are ignored."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"1752403200000","messageType":"message","createdDateTime":"2026-07-13T10:00:00Z","subject":null,"body":{"contentType":"text","content":"Deployment completed"},"from":{"user":{"displayName":"John Smith"}}}],"@odata.nextLink":"https://graph.microsoft.com/v1.0/teams/19c9a1f2/channels/19:abc@thread.tacv2/messages?$skiptoken=abc"}
   */
  async getChannelMessages(teamId, channelId, top, nextLink) {
    if (nextLink) {
      return this.#apiRequest({
        url: nextLink,
        logTag: 'getChannelMessages',
      })
    }

    if (!teamId) {
      throw new Error('Parameter "Team" is required')
    }

    if (!channelId) {
      throw new Error('Parameter "Channel" is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/teams/${ teamId }/channels/${ channelId }/messages`,
      logTag: 'getChannelMessages',
      query: { $top: Math.min(top || 20, 50) },
    })
  }

  /**
   * @operationName Get Channel Message
   * @category Channel Messages
   * @appearanceColor #6264A7 #464775
   * @description Retrieves a single message from a team channel by its ID, including its content, sender, timestamps, and reactions.
   * @route GET /get-channel-message
   * @paramDef {"type":"String","label":"Team","name":"teamId","required":true,"dictionary":"getTeamsDictionary","description":"The team that contains the channel. Choose a team or paste a team ID."}
   * @paramDef {"type":"String","label":"Channel","name":"channelId","required":true,"dictionary":"getChannelsDictionary","dependsOn":["teamId"],"description":"The channel that contains the message. Choose a team above to pick from its channels, or paste a channel ID."}
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"description":"The ID of the channel message to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"1752403200000","messageType":"message","createdDateTime":"2026-07-13T10:00:00Z","subject":"Status Update","body":{"contentType":"text","content":"Deployment completed"},"from":{"user":{"displayName":"John Smith"}},"reactions":[]}
   */
  async getChannelMessage(teamId, channelId, messageId) {
    if (!teamId) {
      throw new Error('Parameter "Team" is required')
    }

    if (!channelId) {
      throw new Error('Parameter "Channel" is required')
    }

    if (!messageId) {
      throw new Error('Parameter "Message ID" is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/teams/${ teamId }/channels/${ channelId }/messages/${ messageId }`,
      logTag: 'getChannelMessage',
    })
  }

  /**
   * @operationName List Chats
   * @category Chats
   * @appearanceColor #6264A7 #464775
   * @description Retrieves the signed-in user's chats (one-on-one, group, and meeting chats) with their members expanded, so each chat includes participant display names and emails.
   * @route GET /list-chats
   * @paramDef {"type":"Number","label":"Max Results","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The maximum number of chats to retrieve. Defaults to 20. Microsoft Graph allows up to 50 per page."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"URL to retrieve the next page of results. If provided, all other parameters are ignored."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"19:2da4c29f6d7041eca70b638b43d45437@thread.v2","topic":null,"chatType":"oneOnOne","members":[{"displayName":"Jane Doe","email":"jane.doe@company.com"},{"displayName":"John Smith","email":"john.smith@company.com"}]}],"@odata.nextLink":"https://graph.microsoft.com/v1.0/me/chats?$skiptoken=abc"}
   */
  async listChats(top, nextLink) {
    if (nextLink) {
      return this.#apiRequest({
        url: nextLink,
        logTag: 'listChats',
      })
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/me/chats`,
      logTag: 'listChats',
      query: {
        $expand: 'members',
        $top: Math.min(top || 20, 50),
      },
    })
  }

  /**
   * @operationName Send Chat Message
   * @category Chats
   * @appearanceColor #6264A7 #464775
   * @description Sends a message to an existing one-on-one or group chat as the signed-in user. Supports plain text or HTML content.
   * @route POST /send-chat-message
   * @paramDef {"type":"String","label":"Chat","name":"chatId","required":true,"dictionary":"getChatsDictionary","description":"The chat to send the message to. Choose a chat or paste a chat ID."}
   * @paramDef {"type":"String","label":"Content Type","name":"contentType","defaultValue":"Text","uiComponent":{"type":"DROPDOWN","options":{"values":["Text","HTML"]}},"description":"The format of the message body. Defaults to Text."}
   * @paramDef {"type":"String","label":"Message","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The body of the message. Use HTML markup when Content Type is set to HTML."}
   * @returns {Object}
   * @sampleResult {"id":"1752403300000","messageType":"message","chatId":"19:2da4c29f6d7041eca70b638b43d45437@thread.v2","createdDateTime":"2026-07-13T10:02:00Z","body":{"contentType":"text","content":"Hi there"},"from":{"user":{"displayName":"John Smith"}}}
   */
  async sendChatMessage(chatId, contentType, content) {
    if (!chatId) {
      throw new Error('Parameter "Chat" is required')
    }

    if (!content) {
      throw new Error('Parameter "Message" is required')
    }

    const body = {
      body: {
        contentType: this.#resolveChoice(contentType, { Text: 'text', HTML: 'html' }) || 'text',
        content,
      },
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/chats/${ chatId }/messages`,
      logTag: 'sendChatMessage',
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Get Chat Messages
   * @category Chats
   * @appearanceColor #6264A7 #464775
   * @description Retrieves the most recent messages from a one-on-one or group chat, newest first.
   * @route GET /get-chat-messages
   * @paramDef {"type":"String","label":"Chat","name":"chatId","required":true,"dictionary":"getChatsDictionary","description":"The chat whose messages to retrieve. Choose a chat or paste a chat ID."}
   * @paramDef {"type":"Number","label":"Max Results","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The maximum number of messages to retrieve. Defaults to 20. Microsoft Graph allows up to 50 per page."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"URL to retrieve the next page of results. If provided, all other parameters are ignored."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"1752403300000","messageType":"message","createdDateTime":"2026-07-13T10:02:00Z","body":{"contentType":"text","content":"Hi there"},"from":{"user":{"displayName":"John Smith"}}}],"@odata.nextLink":"https://graph.microsoft.com/v1.0/chats/19:2da4c29f@thread.v2/messages?$skiptoken=abc"}
   */
  async getChatMessages(chatId, top, nextLink) {
    if (nextLink) {
      return this.#apiRequest({
        url: nextLink,
        logTag: 'getChatMessages',
      })
    }

    if (!chatId) {
      throw new Error('Parameter "Chat" is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/chats/${ chatId }/messages`,
      logTag: 'getChatMessages',
      query: { $top: Math.min(top || 20, 50) },
    })
  }

  /**
   * @operationName Create One-On-One Chat
   * @category Chats
   * @appearanceColor #6264A7 #464775
   * @description Creates (or returns the existing) one-on-one chat between the signed-in user and another user in the organization, identified by email address, user principal name, or Microsoft Entra user ID. Use Send Chat Message with the returned chat ID to start messaging.
   * @route POST /create-one-on-one-chat
   * @paramDef {"type":"String","label":"User","name":"user","required":true,"description":"The email address, user principal name, or Microsoft Entra user ID of the person to chat with."}
   * @returns {Object}
   * @sampleResult {"id":"19:2da4c29f6d7041eca70b638b43d45437@thread.v2","chatType":"oneOnOne","createdDateTime":"2026-07-13T10:00:00Z","webUrl":"https://teams.microsoft.com/l/chat/19%3A2da4c29f6d7041eca70b638b43d45437%40thread.v2/0"}
   */
  async createOneOnOneChat(user) {
    if (!user) {
      throw new Error('Parameter "User" is required')
    }

    const me = await this.#apiRequest({
      url: `${ API_BASE_URL }/me`,
      logTag: 'createOneOnOneChat',
    })

    const body = {
      chatType: 'oneOnOne',
      members: [
        {
          '@odata.type': '#microsoft.graph.aadUserConversationMember',
          'user@odata.bind': `${ API_BASE_URL }/users('${ me.id }')`,
          roles: ['owner'],
        },
        {
          '@odata.type': '#microsoft.graph.aadUserConversationMember',
          'user@odata.bind': `${ API_BASE_URL }/users('${ user }')`,
          roles: ['owner'],
        },
      ],
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/chats`,
      logTag: 'createOneOnOneChat',
      method: 'post',
      body,
    })
  }
}

Flowrunner.ServerCode.addService(MicrosoftTeamsService, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth2 Client ID (Application ID) of your Microsoft Entra app registration.',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth2 Client Secret of your Microsoft Entra app registration.',
  },
])

function searchFilter(list, props, searchString) {
  const caseInsensitiveSearch = searchString.toLowerCase()

  return list.filter(item =>
    props.some(prop => {
      const value = prop.split('.').reduce((acc, key) => acc?.[key], item)

      return value && String(value).toLowerCase().includes(caseInsensitiveSearch)
    })
  )
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

function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value
}

function constructIdentityName(user) {
  const email = user.mail || user.userPrincipalName

  if (email && user.displayName) {
    return `${ email } (${ user.displayName })`
  }

  return email || user.displayName || 'Microsoft Teams Connection'
}
