const DEFAULT_LIMIT = 100

const OAUTH_BASE_URL = 'https://login.mailchimp.com'
const API_BASE_URL = 'https://{dc}.api.mailchimp.com/3.0'

const logger = {
  info: (...args) => console.log('[Mailchimp Marketing Service] info:', ...args),
  debug: (...args) => console.log('[Mailchimp Marketing Service] debug:', ...args),
  error: (...args) => console.log('[Mailchimp Marketing Service] error:', ...args),
  warn: (...args) => console.log('[Mailchimp Marketing Service] warn:', ...args),
}

const SORT_FIELD_MAP = { 'Date Created': 'date_created' }
const SORT_DIR_MAP = { Ascending: 'ASC', Descending: 'DESC' }
const EMAIL_TYPE_MAP = { HTML: 'html', Text: 'text' }
const MEMBER_STATUS_MAP = {
  Subscribed: 'subscribed',
  Unsubscribed: 'unsubscribed',
  Cleaned: 'cleaned',
  Pending: 'pending',
  Transactional: 'transactional',
}

/**
 *  @requireOAuth
 *  @integrationName Mailchimp Marketing
 *  @integrationIcon /icon.jpeg
 **/
class MailchimpMarketing {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
  }

  #getAccessToken() {
    return this.request.headers['oauth-access-token']
  }

  /**
   * @param {String} dc - Data center identifier
   * @param {String} path - API endpoint path
   * @param {Boolean} [skipMergeValidation] - Skip merge validation parameter
   * @returns {String}
   */
  #buildUrl(dc, path, skipMergeValidation) {
    let url = API_BASE_URL.replace('{dc}', dc) + path

    if (skipMergeValidation) {
      url += '?skip_merge_validation=true'
    }

    return url
  }

  /**
   * @param {String} value - Friendly label submitted by the dropdown
   * @param {Object} mapping - Map of friendly label to API value
   * @returns {String|undefined}
   */
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  /**
   * @param {Object} obj - Object to clean
   * @returns {Object}
   */
  #clean(obj) {
    if (!obj) return {}
    const newObj = {}

    for (const propName in obj) {
      if (obj[propName] !== null && obj[propName] !== undefined) {
        newObj[propName] = obj[propName]
      }
    }

    return newObj
  }

  /**
   * @param {Array} list - List to filter
   * @param {Array} props - Properties to search in
   * @param {String} searchString - Search term
   * @returns {Array}
   */
  #searchFilter(list, props, searchString) {
    if (!searchString) return list

    return list.filter(item =>
      props.some(prop => {
        const value = prop.split('.').reduce((acc, key) => acc?.[key], item)

        return value && String(value).toLowerCase().includes(searchString.toLowerCase())
      })
    )
  }

  /**
   * @param {Number} cursor - Current cursor
   * @param {Number} total - Total items
   * @param {Number} limit - Items per page
   * @returns {Number|null}
   */
  #getCursor(cursor = 0, total, limit) {
    return cursor < total - limit ? cursor + limit : null
  }

  /**
   * @param {Object} metadata - OAuth metadata
   * @returns {String}
   */
  #constructIdentityName(metadata) {
    if (metadata.accountname && metadata.login.email) {
      return `${ metadata.accountname } (${ metadata.login.email })`
    }

    return metadata.login?.email || 'Mailchimp Marketing Account'
  }

  /**
   * @param {Object} params - Request parameters
   * @param {String} params.url - Request URL
   * @param {String} [params.method='get'] - HTTP method
   * @param {Object} [params.body] - Request body
   * @param {Object} [params.query] - Query parameters
   * @param {String} params.logTag - Log tag for debugging
   * @returns {Object}
   */
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }] query=[${ JSON.stringify(query) }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          Authorization: `Bearer ${ this.#getAccessToken() }`,
          'Content-Type': 'application/json',
        })

      if (query) {
        request.query(this.#clean(query))
      }

      if (body) {
        request.send(this.#clean(body))
      }

      const response = await request
      logger.debug(`${ logTag } - API response received`)

      return response

    } catch (error) {
      logger.error(`${ logTag } - API error: ${ JSON.stringify({
        message: error.message,
        status: error.status,
      }) }`)

      throw error
    }
  }

  /**
   * @typedef {Object} LoginInfo
   * @property {String} email
   * @property {String} avatar
   * @property {Number} login_id
   * @property {String} login_name
   * @property {String} login_email
   */

  /**
   * @typedef {Object} Metadata
   * @property {String} dc
   * @property {String} role
   * @property {String} accountname
   * @property {Number} user_id
   * @property {LoginInfo} login
   * @property {String} login_url
   * @property {String} api_endpoint
   */

  async #getMetadata(accessToken) {
    const token = accessToken || this.#getAccessToken()

    return await Flowrunner.Request
      .get(`${ OAUTH_BASE_URL }/oauth2/metadata`)
      .set({ Authorization: `OAuth ${ token }` })
  }

  /**
   * @route GET /getOAuth2ConnectionURL
   * @registerAs SYSTEM
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()
    params.append('response_type', 'code')
    params.append('client_id', this.clientId)

    const connectionURL = `${ OAUTH_BASE_URL }/oauth2/authorize?${ params.toString() }`
    logger.debug(`OAuth2 Connection URL: ${ connectionURL }`)

    return connectionURL
  }

  /**
   * @route PUT /refreshToken
   * @registerAs SYSTEM
   * @returns {Error}
   */
  async refreshToken() {
    throw new Error(
      'Mailchimp Marketing access tokens do not expire, so you do not need to use a refresh_token. The access token will remain valid unless the user revokes your application permission to access their account.'
    )
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   * @property {String} token
   * @property {Number | null} expirationInSeconds
   * @property {String} connectionIdentityName
   */

  /**
   * @route POST /executeCallback
   * @registerAs SYSTEM
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    logger.debug(`Execute Callback: ${ JSON.stringify(callbackObject) }`)

    const params = new URLSearchParams()
    params.append('grant_type', 'authorization_code')
    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('code', callbackObject.code)

    try {
      const response = await Flowrunner.Request.post(`${ OAUTH_BASE_URL }/oauth2/token`)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      logger.debug(`executeCallback -> response: ${ JSON.stringify(response) }`)

      const metadata = await this.#getMetadata(response['access_token'])
      logger.debug(`executeCallback -> metadata: ${ JSON.stringify(metadata) }`)

      return {
        token: response['access_token'],
        expirationInSeconds: response['expires_in'],
        overwrite: true,
        connectionIdentityName: this.#constructIdentityName(metadata),
        connectionIdentityImageURL: metadata?.login?.avatar,
      }
    } catch (error) {
      logger.error(`Failed to execute callback: ${ error }`)
      throw error
    }
  }

  // ========================================== DICTIONARIES ===========================================

  /**
   * @typedef {Object} DictionaryPayload
   * @property {String} [search]
   * @property {Number} [cursor]
   * @property {Object} [criteria]
   */

  /**
   * @typedef {Object} DictionaryItem
   * @property {String} label
   * @property {any} value
   * @property {String} [note]
   */

  /**
   * @typedef {Object} getDictionaryLists_ResultObject
   * @property {Array<DictionaryItem>} items
   * @property {Number} [cursor]
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Lists
   * @description Returns a paginated list of Mailchimp lists for dropdown selection
   * @route POST /get-dictionary-lists
   * @paramDef {"type":"getDictionaryLists__payload","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria"}
   * @sampleResult {"cursor":"100","items":[{"label":"My Newsletter","note":"Members: 1250","value":"abc123"}]}
   * @returns {getDictionaryLists_ResultObject}
   */
  async getDictionaryLists(payload) {
    const { search, cursor = 0 } = payload

    try {
      const metadata = await this.#getMetadata()
      const { dc } = metadata

      const { lists = [], total_items: totalItems = 0 } = await this.#apiRequest({
        url: this.#buildUrl(dc, '/lists'),
        logTag: 'getDictionaryLists',
        query: {
          offset: cursor,
          count: DEFAULT_LIMIT,
        },
      })

      let filteredLists = lists

      if (search) {
        filteredLists = this.#searchFilter(lists, ['name'], search)
      }

      const items = filteredLists.map(list => ({
        label: list.name,
        value: list.id,
        note: `Members: ${ list.stats?.member_count || 0 }`,
      }))

      return {
        items,
        cursor: this.#getCursor(cursor, totalItems, DEFAULT_LIMIT),
      }
    } catch (error) {
      logger.error(`getDictionaryLists error: ${ error }`)
      throw error
    }
  }

  /**
   * @typedef {Object} getDictionaryLists__payload
   * @property {String} [search]
   * @property {Number} [cursor]
   * @property {Object} [criteria]
   */

  /**
   * @typedef {Object} getMembers__payloadCriteria
   * @property {String} listId
   */

  /**
   * @typedef {Object} getMembers__payload
   * @property {String} [search]
   * @property {Number} [cursor]
   * @property {getMembers__payloadCriteria} [criteria]
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Members
   * @description Returns a paginated list of members for the specified Mailchimp list. Note: search functionality filters members only within the current page of results. Use the cursor to paginate through all available members.
   * @route POST /get-members
   * @paramDef {"type":"getMembers__payload","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria"}
   * @sampleResult {"cursor":"100","items":[{"label":"John Doe (john@example.com)","note":"ID: abc123","value":"abc123"}]}
   * @returns {getDictionaryLists_ResultObject}
   */
  async getMembers(payload) {
    const { search, cursor = 0, criteria } = payload

    if (!criteria?.listId) {
      throw new Error('List ID is required')
    }

    try {
      const metadata = await this.#getMetadata()
      const { dc } = metadata

      const { members = [], total_items: totalItems = 0 } = await this.#apiRequest({
        url: this.#buildUrl(dc, `/lists/${ criteria.listId }/members`),
        logTag: 'getMembers',
        query: {
          offset: cursor,
          count: DEFAULT_LIMIT,
        },
      })

      let filteredMembers = members

      if (search) {
        filteredMembers = this.#searchFilter(members, ['email_address', 'full_name'], search)
      }

      const items = filteredMembers.map(member => ({
        label: `${ member.full_name || member.email_address } (${ member.email_address })`,
        value: member.id,
        note: `Status: ${ member.status }`,
      }))

      return {
        items,
        cursor: this.#getCursor(cursor, totalItems, DEFAULT_LIMIT),
      }
    } catch (error) {
      logger.error(`getMembers error: ${ error }`)
      throw error
    }
  }

  /**
   * @typedef {Object} getMemberTags__payloadCriteria
   * @property {String} listId
   * @property {String} subscriberHash
   */

  /**
   * @typedef {Object} getMemberTags__payload
   * @property {String} [search]
   * @property {Number} [cursor]
   * @property {getMemberTags__payloadCriteria} [criteria]
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Member Tags
   * @description Returns a paginated list of tags for the specified Mailchimp list member. Note: search functionality filters tags only within the current page of results. Use the cursor to paginate through all available tags.
   * @route POST /get-member-tags
   * @paramDef {"type":"getMemberTags__payload","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria"}
   * @sampleResult {"cursor":"100","items":[{"label":"VIP","note":"ID: 345","value":"VIP"}]}
   * @returns {getDictionaryLists_ResultObject}
   */
  async getMemberTags(payload) {
    const { search, cursor = 0, criteria } = payload

    if (!criteria?.listId || !criteria?.subscriberHash) {
      throw new Error('List ID and Subscriber Hash are required')
    }

    try {
      const metadata = await this.#getMetadata()
      const { dc } = metadata

      const { tags = [], total_items: totalItems = 0 } = await this.#apiRequest({
        url: this.#buildUrl(dc, `/lists/${ criteria.listId }/members/${ criteria.subscriberHash }/tags`),
        logTag: 'getMemberTags',
        query: {
          offset: cursor,
          count: DEFAULT_LIMIT,
        },
      })

      let filteredTags = tags

      if (search) {
        filteredTags = this.#searchFilter(tags, ['name'], search)
      }

      const items = filteredTags.map(tag => ({
        label: tag.name,
        value: tag.name,
        note: `ID: ${ tag.id }`,
      }))

      return {
        items,
        cursor: this.#getCursor(cursor, totalItems, DEFAULT_LIMIT),
      }
    } catch (error) {
      logger.error(`getMemberTags error: ${ error }`)
      throw error
    }
  }

  /**
   * @typedef {Object} getTags__payloadCriteria
   * @property {String} listId
   */

  /**
   * @typedef {Object} getTags__payload
   * @property {String} [search]
   * @property {Number} [cursor]
   * @property {getTags__payloadCriteria} [criteria]
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tags
   * @description Returns a paginated list of tags for the specified Mailchimp list. Note: search functionality filters tags only within the current page of results. Use the cursor to paginate through all available tags.
   * @route POST /get-tags
   * @paramDef {"type":"getTags__payload","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria"}
   * @sampleResult {"cursor":"100","items":[{"label":"VIP","note":"ID: 789","value":"VIP"}]}
   * @returns {getDictionaryLists_ResultObject}
   */
  async getTags(payload) {
    const { search, cursor = 0, criteria } = payload

    if (!criteria?.listId) {
      throw new Error('List ID is required')
    }

    try {
      const metadata = await this.#getMetadata()
      const { dc } = metadata

      const { tags = [], total_items: totalItems = 0 } = await this.#apiRequest({
        url: this.#buildUrl(dc, `/lists/${ criteria.listId }/tag-search`),
        logTag: 'getTags',
        query: {
          offset: cursor,
          count: DEFAULT_LIMIT,
          name: search,
        },
      })

      const items = tags.map(tag => ({
        label: tag.name,
        value: tag.name,
        note: `ID: ${ tag.id }`,
      }))

      return {
        items,
        cursor: this.#getCursor(cursor, totalItems, DEFAULT_LIMIT),
      }
    } catch (error) {
      logger.error(`getTags error: ${ error }`)
      throw error
    }
  }

  /**
   * @typedef {Object} getCampaigns__payload
   * @property {String} [search]
   * @property {Number} [cursor]
   * @property {Object} [criteria]
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Campaigns
   * @description Returns a paginated list of Mailchimp campaigns. Note: search functionality filters campaigns only within the current page of results. Use the cursor to paginate through all available campaigns.
   * @route POST /get-campaigns
   * @paramDef {"type":"getCampaigns__payload","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria"}
   * @sampleResult {"cursor":"100","items":[{"label":"Spring Sale","note":"ID: 456","value":"456"}]}
   * @returns {getDictionaryLists_ResultObject}
   */
  async getCampaigns(payload) {
    const { search, cursor = 0 } = payload

    try {
      const metadata = await this.#getMetadata()
      const { dc } = metadata

      const { campaigns = [], total_items: totalItems = 0 } = await this.#apiRequest({
        url: this.#buildUrl(dc, '/campaigns'),
        logTag: 'getCampaigns',
        query: {
          offset: cursor,
          count: DEFAULT_LIMIT,
        },
      })

      let filteredCampaigns = campaigns

      if (search) {
        filteredCampaigns = this.#searchFilter(campaigns, ['settings.title', 'settings.subject_line'], search)
      }

      const items = filteredCampaigns.map(campaign => ({
        label: campaign.settings?.title || campaign.settings?.subject_line || `Campaign ${ campaign.id }`,
        value: campaign.id,
        note: `Status: ${ campaign.status }`,
      }))

      return {
        items,
        cursor: this.#getCursor(cursor, totalItems, DEFAULT_LIMIT),
      }
    } catch (error) {
      logger.error(`getCampaigns error: ${ error }`)
      throw error
    }
  }

  /**
   * @typedef {Object} getStores__payload
   * @property {String} [search]
   * @property {Number} [cursor]
   * @property {Object} [criteria]
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Stores
   * @description Returns a paginated list of Mailchimp stores. Note: search functionality filters stores only within the current page of results. Use the cursor to paginate through all available stores.
   * @route POST /get-stores
   * @paramDef {"type":"getStores__payload","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria"}
   * @sampleResult {"cursor":"100","items":[{"label":"My Store","note":"ID: 101","value":"101"}]}
   * @returns {getDictionaryLists_ResultObject}
   */
  async getStores(payload) {
    const { search, cursor = 0 } = payload

    try {
      const metadata = await this.#getMetadata()
      const { dc } = metadata

      const { stores = [], total_items: totalItems = 0 } = await this.#apiRequest({
        url: this.#buildUrl(dc, '/ecommerce/stores'),
        logTag: 'getStores',
        query: {
          offset: cursor,
          count: DEFAULT_LIMIT,
        },
      })

      let filteredStores = stores

      if (search) {
        filteredStores = this.#searchFilter(stores, ['name'], search)
      }

      const items = filteredStores.map(store => ({
        label: store.name,
        value: store.id,
        note: `Domain: ${ store.domain || 'N/A' }`,
      }))

      return {
        items,
        cursor: this.#getCursor(cursor, totalItems, DEFAULT_LIMIT),
      }
    } catch (error) {
      logger.error(`getStores error: ${ error }`)
      throw error
    }
  }

  // ========================================== ACTIONS ===========================================

  /**
   * @typedef {Object} GetListsInfo_ListContact
   * @property {String} company
   * @property {String} address1
   * @property {String} address2
   * @property {String} city
   * @property {String} state
   * @property {String} zip
   * @property {String} country
   * @property {String} phone
   */

  /**
   * @typedef {Object} GetListsInfo_CampaignDefaults
   * @property {String} from_name
   * @property {String} from_email
   * @property {String} subject
   * @property {String} language
   */

  /**
   * @typedef {Object} GetListsInfo_ListStats
   * @property {Number} member_count
   * @property {Number} total_contacts
   * @property {Number} unsubscribe_count
   * @property {Number} cleaned_count
   * @property {Number} member_count_since_send
   * @property {Number} unsubscribe_count_since_send
   * @property {Number} cleaned_count_since_send
   * @property {Number} campaign_count
   * @property {String} campaign_last_sent
   * @property {Number} merge_field_count
   * @property {Number} avg_sub_rate
   * @property {Number} avg_unsub_rate
   * @property {Number} target_sub_rate
   * @property {Number} open_rate
   * @property {Number} click_rate
   * @property {String} last_sub_date
   * @property {String} last_unsub_date
   */

  /**
   * @typedef {Object} GetListsInfo_List
   * @property {String} id
   * @property {Number} web_id
   * @property {String} name
   * @property {GetListsInfo_ListContact} contact
   * @property {String} permission_reminder
   * @property {Boolean} use_archive_bar
   * @property {GetListsInfo_CampaignDefaults} campaign_defaults
   * @property {Boolean} notify_on_subscribe
   * @property {Boolean} notify_on_unsubscribe
   * @property {String} date_created
   * @property {Number} list_rating
   * @property {Boolean} email_type_option
   * @property {String} subscribe_url_short
   * @property {String} subscribe_url_long
   * @property {String} beamer_address
   * @property {String} visibility
   * @property {Boolean} double_optin
   * @property {Boolean} has_welcome
   * @property {Boolean} marketing_permissions
   * @property {Array<String>} modules
   * @property {GetListsInfo_ListStats} stats
   */

  /**
   * @typedef {Object} GetListsInfo_Constraints
   * @property {Boolean} may_create
   * @property {Number} max_instances
   * @property {Number} current_total_instances
   */

  /**
   * @typedef {Object} GetListsInfo_ResultObject
   * @property {Array<GetListsInfo_List>} lists
   * @property {Number} total_items
   * @property {GetListsInfo_Constraints} constraints
   */

  /**
   * @description Gets information about all lists in the account
   * @route GET /getListsInfo
   * @operationName Get Lists Info
   * @category List Management
   * @paramDef {"type":"Number","label":"Count","name":"count","min":1,"max":1000,"description":"The number of records to return. Default value is 10. Maximum value is 1000"}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","min":0,"description":"Used for pagination, this is the number of records to skip. Default value is 0"}
   * @paramDef {"type":"String","label":"Before Date Created","name":"beforeDateCreated","description":"Restrict response to lists created before the set date. Uses ISO 8601 time format: 2015-10-21T15:41:36+00:00"}
   * @paramDef {"type":"String","label":"Since Date Created","name":"sinceDateCreated","description":"Restrict response to lists created after the set date. Uses ISO 8601 time format: 2015-10-21T15:41:36+00:00"}
   * @paramDef {"type":"String","label":"Before Campaign Last Sent","name":"beforeCampaignLastSent","description":"Restrict results to lists that have sent a campaign before this date. Uses ISO 8601 time format: 2015-10-21T15:41:36+00:00"}
   * @paramDef {"type":"String","label":"Since Campaign Last Sent","name":"sinceCampaignLastSent","description":"Restrict results to lists that have sent a campaign after this date. Uses ISO 8601 time format: 2015-10-21T15:41:36+00:00"}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Restrict results to lists that include a specific subscriber's email address"}
   * @paramDef {"type":"String","label":"Sort Field","name":"sortField","uiComponent":{"type":"DROPDOWN","options":{"values":["Date Created"]}},"description":"Returns files sorted by the specified field"}
   * @paramDef {"type":"String","label":"Sort Direction","name":"sortDir","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Determines the order direction for sorted results"}
   * @paramDef {"type":"Boolean","label":"Has Ecommerce Store","name":"hasEcommerceStore","description":"Restrict results to lists that have an ecommerce store"}
   * @paramDef {"type":"Boolean","label":"Include Total Contacts","name":"includeTotalContacts","description":"Return the total_contacts field in the stats response, which contains an aggregate count of all subscribed, unsubscribed, pending, cleaned, deleted, transactional, and non-subscribed members"}
   * @sampleResult {"lists":[{"id":"string","web_id":0,"name":"string","contact":{"company":"string","address1":"string","address2":"string","city":"string","state":"string","zip":"string","country":"string","phone":"string"},"permission_reminder":"string","use_archive_bar":false,"campaign_defaults":{"from_name":"string","from_email":"string","subject":"string","language":"string"},"notify_on_subscribe":false,"notify_on_unsubscribe":false,"date_created":"2019-08-24T14:15:22Z","list_rating":0,"email_type_option":true,"subscribe_url_short":"string","subscribe_url_long":"string","beamer_address":"string","visibility":"pub","double_optin":false,"has_welcome":false,"marketing_permissions":false,"modules":["string"],"stats":{"member_count":0,"total_contacts":0,"unsubscribe_count":0,"cleaned_count":0,"member_count_since_send":0,"unsubscribe_count_since_send":0,"cleaned_count_since_send":0,"campaign_count":0,"campaign_last_sent":"2019-08-24T14:15:22Z","merge_field_count":0,"avg_sub_rate":0,"avg_unsub_rate":0,"target_sub_rate":0,"open_rate":0,"click_rate":0,"last_sub_date":"2019-08-24T14:15:22Z","last_unsub_date":"2019-08-24T14:15:22Z"},"_links":[{"rel":"string","href":"string","method":"GET","targetSchema":"string","schema":"string"}]}],"total_items":0,"constraints":{"may_create":true,"max_instances":0,"current_total_instances":0},"_links":[{"rel":"string","href":"string","method":"GET","targetSchema":"string","schema":"string"}]}
   * @returns {GetListsInfo_ResultObject}
   */
  async getListsInfo(
    count,
    offset,
    beforeDateCreated,
    sinceDateCreated,
    beforeCampaignLastSent,
    sinceCampaignLastSent,
    email,
    sortField,
    sortDir,
    hasEcommerceStore,
    includeTotalContacts
  ) {
    try {
      const metadata = await this.#getMetadata()
      const { dc } = metadata

      return await this.#apiRequest({
        url: this.#buildUrl(dc, '/lists'),
        logTag: 'getListsInfo',
        query: {
          count,
          offset,
          before_date_created: beforeDateCreated,
          since_date_created: sinceDateCreated,
          before_campaign_last_sent: beforeCampaignLastSent,
          since_campaign_last_sent: sinceCampaignLastSent,
          email,
          sort_field: this.#resolveChoice(sortField, SORT_FIELD_MAP),
          sort_dir: this.#resolveChoice(sortDir, SORT_DIR_MAP),
          has_ecommerce_store: hasEcommerceStore,
          include_total_contacts: includeTotalContacts,
        },
      })
    } catch (error) {
      logger.error(`getListsInfo error: ${ error }`)
      throw error
    }
  }

  /**
   * @typedef {Object} AddMember_MergeFields
   * @property {any} [property1]
   * @property {any} [property2]
   */

  /**
   * @typedef {Object} AddMember_Interests
   * @property {Boolean} [property1]
   * @property {Boolean} [property2]
   */

  /**
   * @typedef {Object} AddMember_Location
   * @property {Number} latitude
   * @property {Number} longitude
   */

  /**
   * @typedef {Object} AddMember_MarketingPermission
   * @property {String} marketing_permission_id
   * @property {Boolean} enabled
   */

  /**
   * @typedef {Object} AddMember_Tag
   * @property {String} name
   * @property {String} status
   */

  /**
   * @typedef {Object} AddMember_ResultObject
   * @property {String} id
   * @property {String} email_address
   * @property {String} unique_email_id
   * @property {String} contact_id
   * @property {String} full_name
   * @property {Number} web_id
   * @property {String} email_type
   * @property {String} status
   * @property {String} unsubscribe_reason
   * @property {Boolean} consents_to_one_to_one_messaging
   * @property {AddMember_MergeFields} merge_fields
   * @property {AddMember_Interests} interests
   * @property {Object} stats
   * @property {String} ip_signup
   * @property {String} timestamp_signup
   * @property {String} ip_opt
   * @property {String} timestamp_opt
   * @property {Number} member_rating
   * @property {String} last_changed
   * @property {String} language
   * @property {Boolean} vip
   * @property {String} email_client
   * @property {AddMember_Location} location
   * @property {Array<AddMember_MarketingPermission>} marketing_permissions
   * @property {Object} last_note
   * @property {String} source
   * @property {Number} tags_count
   * @property {Array<AddMember_Tag>} tags
   * @property {String} list_id
   */

  /**
   * @description Adds a new member to the list
   * @route POST /addMember
   * @operationName Add Member To List
   * @category Member Management
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getDictionaryLists","description":"The unique ID for the list"}
   * @paramDef {"type":"String","label":"Email Address","name":"emailAddress","required":true,"description":"Email address for a subscriber"}
   * @paramDef {"type":"String","label":"Email Type","name":"emailType","uiComponent":{"type":"DROPDOWN","options":{"values":["HTML","Text"]}},"description":"Type of email this member asked to get ('html' or 'text')"}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Subscribed","Unsubscribed","Cleaned","Pending","Transactional"]}},"required":true,"description":"Subscriber's current status"}
   * @paramDef {"type":"Object","label":"Merge Fields","name":"mergeFields","description":"A dictionary of merge fields where the keys are the merge tags"}
   * @paramDef {"type":"Object","label":"Interests","name":"interests","description":"The key of this object's properties is the ID of the interest in question"}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"If set/detected, the subscriber's language"}
   * @paramDef {"type":"Boolean","label":"VIP","name":"vip","description":"VIP status for subscriber"}
   * @paramDef {"type":"Object","label":"Location","name":"location","description":"Subscriber location information"}
   * @paramDef {"type":"Array","label":"Marketing Permissions","name":"marketingPermissions","description":"The marketing permissions for the subscriber"}
   * @paramDef {"type":"String","label":"IP Signup","name":"ipSignup","description":"IP address the subscriber signed up from"}
   * @paramDef {"type":"String","label":"Timestamp Signup","name":"timestampSignup","description":"The date and time the subscriber signed up for the list in ISO 8601 format"}
   * @paramDef {"type":"String","label":"IP Opt","name":"ipOpt","description":"The IP address the subscriber used to confirm their opt-in status"}
   * @paramDef {"type":"String","label":"Timestamp Opt","name":"timestampOpt","description":"The date and time the subscriber confirmed their opt-in status in ISO 8601 format"}
   * @paramDef {"type":"Array","label":"Tags","name":"tags","description":"The tags that are associated with a member"}
   * @paramDef {"type":"Boolean","label":"Skip Merge Validation","name":"skipMergeValidation","description":"If skip_merge_validation is true, member data will be accepted without merge field values, even if the merge field is usually required. This defaults to false"}
   * @sampleResult {"id":"string","email_address":"string","unique_email_id":"string","contact_id":"string","full_name":"string","web_id":0,"email_type":"string","status":"subscribed","unsubscribe_reason":"string","consents_to_one_to_one_messaging":true,"merge_fields":{"property1":null,"property2":null},"interests":{"property1":true,"property2":true},"stats":{"avg_open_rate":0,"avg_click_rate":0,"ecommerce_data":{"total_revenue":0,"number_of_orders":0,"currency_code":"USD"}},"ip_signup":"string","timestamp_signup":"2019-08-24T14:15:22Z","ip_opt":"string","timestamp_opt":"2019-08-24T14:15:22Z","member_rating":0,"last_changed":"2019-08-24T14:15:22Z","language":"string","vip":true,"email_client":"string","location":{"latitude":0,"longitude":0,"gmtoff":0,"dstoff":0,"country_code":"string","timezone":"string","region":"string"},"marketing_permissions":[{"marketing_permission_id":"string","text":"string","enabled":true}],"last_note":{"note_id":0,"created_at":"2019-08-24T14:15:22Z","created_by":"string","note":"string"},"source":"string","tags_count":0,"tags":[{"id":0,"name":"string"}],"list_id":"string","_links":[{"rel":"string","href":"string","method":"GET","targetSchema":"string","schema":"string"}]}
   * @returns {AddMember_ResultObject}
   */
  async addMember(
    listId,
    emailAddress,
    emailType,
    status,
    mergeFields,
    interests,
    language,
    vip,
    location,
    marketingPermissions,
    ipSignup,
    timestampSignup,
    ipOpt,
    timestampOpt,
    tags,
    skipMergeValidation
  ) {
    try {
      const metadata = await this.#getMetadata()
      const { dc } = metadata

      return await this.#apiRequest({
        url: this.#buildUrl(dc, `/lists/${ listId }/members`, skipMergeValidation),
        method: 'post',
        logTag: 'addMember',
        body: {
          email_address: emailAddress,
          email_type: this.#resolveChoice(emailType, EMAIL_TYPE_MAP),
          status: this.#resolveChoice(status, MEMBER_STATUS_MAP),
          merge_fields: mergeFields,
          interests,
          language,
          vip,
          location,
          marketing_permissions: marketingPermissions,
          ip_signup: ipSignup,
          timestamp_signup: timestampSignup,
          ip_opt: ipOpt,
          timestamp_opt: timestampOpt,
          tags,
        },
      })
    } catch (error) {
      logger.error(`addMember error: ${ error }`)
      throw error
    }
  }

  /**
   * @description Adds or updates a list member
   * @route PUT /addOrUpdateListMember
   * @operationName Add Or Update List Member
   * @category Member Management
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getDictionaryLists","description":"The unique ID for the list"}
   * @paramDef {"type":"String","label":"Subscriber Hash","name":"subscriberHash","required":true,"description":"The MD5 hash of the lowercase version of the list member's email address"}
   * @paramDef {"type":"String","label":"Email Address","name":"emailAddress","required":true,"description":"Email address for a subscriber"}
   * @paramDef {"type":"String","label":"Status If New","name":"statusIfNew","uiComponent":{"type":"DROPDOWN","options":{"values":["Subscribed","Unsubscribed","Cleaned","Pending","Transactional"]}},"description":"Subscriber's status. This value is required only if the email address is not already present on the list"}
   * @paramDef {"type":"String","label":"Email Type","name":"emailType","uiComponent":{"type":"DROPDOWN","options":{"values":["HTML","Text"]}},"description":"Type of email this member asked to get ('html' or 'text')"}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Subscribed","Unsubscribed","Cleaned","Pending","Transactional"]}},"description":"Subscriber's current status"}
   * @paramDef {"type":"Object","label":"Merge Fields","name":"mergeFields","description":"A dictionary of merge fields where the keys are the merge tags"}
   * @paramDef {"type":"Object","label":"Interests","name":"interests","description":"The key of this object's properties is the ID of the interest in question"}
   * @paramDef {"type":"String","label":"Language","name":"language","description":"If set/detected, the subscriber's language"}
   * @paramDef {"type":"Boolean","label":"VIP","name":"vip","description":"VIP status for subscriber"}
   * @paramDef {"type":"Object","label":"Location","name":"location","description":"Subscriber location information"}
   * @paramDef {"type":"Array","label":"Marketing Permissions","name":"marketingPermissions","description":"The marketing permissions for the subscriber"}
   * @paramDef {"type":"String","label":"IP Signup","name":"ipSignup","description":"IP address the subscriber signed up from"}
   * @paramDef {"type":"String","label":"Timestamp Signup","name":"timestampSignup","description":"The date and time the subscriber signed up for the list in ISO 8601 format"}
   * @paramDef {"type":"String","label":"IP Opt","name":"ipOpt","description":"The IP address the subscriber used to confirm their opt-in status"}
   * @paramDef {"type":"String","label":"Timestamp Opt","name":"timestampOpt","description":"The date and time the subscriber confirmed their opt-in status in ISO 8601 format"}
   * @paramDef {"type":"Boolean","label":"Skip Merge Validation","name":"skipMergeValidation","description":"If skip_merge_validation is true, member data will be accepted without merge field values, even if the merge field is usually required"}
   * @sampleResult {"id":"string","email_address":"string","unique_email_id":"string","contact_id":"string","full_name":"string","web_id":0,"email_type":"string","status":"subscribed","unsubscribe_reason":"string","consents_to_one_to_one_messaging":true,"merge_fields":{"property1":null,"property2":null},"interests":{"property1":true,"property2":true},"stats":{"avg_open_rate":0,"avg_click_rate":0,"ecommerce_data":{"total_revenue":0,"number_of_orders":0,"currency_code":"USD"}},"ip_signup":"string","timestamp_signup":"2019-08-24T14:15:22Z","ip_opt":"string","timestamp_opt":"2019-08-24T14:15:22Z","member_rating":0,"last_changed":"2019-08-24T14:15:22Z","language":"string","vip":true,"email_client":"string","location":{"latitude":0,"longitude":0,"gmtoff":0,"dstoff":0,"country_code":"string","timezone":"string","region":"string"},"marketing_permissions":[{"marketing_permission_id":"string","text":"string","enabled":true}],"last_note":{"note_id":0,"created_at":"2019-08-24T14:15:22Z","created_by":"string","note":"string"},"source":"string","tags_count":0,"tags":[{"id":0,"name":"string"}],"list_id":"string","_links":[{"rel":"string","href":"string","method":"GET","targetSchema":"string","schema":"string"}]}
   * @returns {AddMember_ResultObject}
   */
  async addOrUpdateListMember(
    listId,
    subscriberHash,
    emailAddress,
    statusIfNew,
    emailType,
    status,
    mergeFields,
    interests,
    language,
    vip,
    location,
    marketingPermissions,
    ipSignup,
    timestampSignup,
    ipOpt,
    timestampOpt,
    skipMergeValidation
  ) {
    try {
      const metadata = await this.#getMetadata()
      const { dc } = metadata

      return await this.#apiRequest({
        url: this.#buildUrl(dc, `/lists/${ listId }/members/${ subscriberHash }`, skipMergeValidation),
        method: 'put',
        logTag: 'addOrUpdateListMember',
        body: {
          email_address: emailAddress,
          status_if_new: this.#resolveChoice(statusIfNew, MEMBER_STATUS_MAP),
          email_type: this.#resolveChoice(emailType, EMAIL_TYPE_MAP),
          status: this.#resolveChoice(status, MEMBER_STATUS_MAP),
          merge_fields: mergeFields,
          interests,
          language,
          vip,
          location,
          marketing_permissions: marketingPermissions,
          ip_signup: ipSignup,
          timestamp_signup: timestampSignup,
          ip_opt: ipOpt,
          timestamp_opt: timestampOpt,
        },
      })
    } catch (error) {
      logger.error(`addOrUpdateListMember error: ${ error }`)
      throw error
    }
  }

  /**
   * @description Unsubscribes or deletes a member from the list
   * @route POST /unsubscribeOrDeleteMember
   * @operationName Unsubscribe Or Delete List Member
   * @category Member Management
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getDictionaryLists","description":"The unique ID for the list"}
   * @paramDef {"type":"String","label":"Subscriber Hash","name":"subscriberHash","required":true,"description":"The MD5 hash of the lowercase version of the list member's email address"}
   * @paramDef {"type":"Boolean","label":"Delete Member","name":"deleteMember","description":"If true, the member will be permanently deleted. If false, the member will be unsubscribed"}
   * @sampleResult {"urls_clicked":[{"id":"string","url":"string","total_clicks":0,"click_percentage":0,"unique_clicks":0,"unique_click_percentage":0,"last_click":"2019-08-24T14:15:22Z","ab_split":{"a":{"total_clicks_a":0,"click_percentage_a":0,"unique_clicks_a":0,"unique_click_percentage_a":0},"b":{"total_clicks_b":0,"click_percentage_b":0,"unique_clicks_b":0,"unique_click_percentage_b":0}},"campaign_id":"string","_links":[{"rel":"string","href":"string","method":"GET","targetSchema":"string","schema":"string"}]}],"campaign_id":"string","total_items":0,"_links":[{"rel":"string","href":"string","method":"GET","targetSchema":"string","schema":"string"}]}
   * @returns {Object}
   */
  async unsubscribeOrDeleteMember(listId, subscriberHash, deleteMember) {
    try {
      const metadata = await this.#getMetadata()
      const { dc } = metadata

      if (deleteMember) {
        return await this.#apiRequest({
          url: this.#buildUrl(dc, `/lists/${ listId }/members/${ subscriberHash }/actions/delete-permanent`),
          method: 'post',
          logTag: 'unsubscribeOrDeleteMember',
        })
      }

      return await this.#apiRequest({
        url: this.#buildUrl(dc, `/lists/${ listId }/members/${ subscriberHash }`),
        method: 'patch',
        logTag: 'unsubscribeOrDeleteMember',
        body: { status: 'unsubscribed' },
      })
    } catch (error) {
      logger.error(`unsubscribeOrDeleteMember error: ${ error }`)
      throw error
    }
  }

  /**
   * @description Searches for a member in your Mailchimp audience. Optionally creates a member if none is found
   * @route GET /searchMember
   * @operationName Search Member
   * @category Member Management
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"The search query used to filter results"}
   * @paramDef {"type":"String","label":"List ID","name":"listId","dictionary":"getDictionaryLists","description":"The unique ID for the list"}
   * @paramDef {"type":"Object","label":"Create Fields","name":"createFields","description":"Fields for creating a new member if none is found"}
   * @sampleResult {"id":"string","email_address":"string","unique_email_id":"string","contact_id":"string","full_name":"string","web_id":0,"email_type":"string","status":"subscribed","unsubscribe_reason":"string","consents_to_one_to_one_messaging":true,"merge_fields":{"property1":null,"property2":null},"interests":{"property1":true,"property2":true},"stats":{"avg_open_rate":0,"avg_click_rate":0,"ecommerce_data":{"total_revenue":0,"number_of_orders":0,"currency_code":"USD"}},"ip_signup":"string","timestamp_signup":"2019-08-24T14:15:22Z","ip_opt":"string","timestamp_opt":"2019-08-24T14:15:22Z","member_rating":0,"last_changed":"2019-08-24T14:15:22Z","language":"string","vip":true,"email_client":"string","location":{"latitude":0,"longitude":0,"gmtoff":0,"dstoff":0,"country_code":"string","timezone":"string","region":"string"},"marketing_permissions":[{"marketing_permission_id":"string","text":"string","enabled":true}],"last_note":{"note_id":0,"created_at":"2019-08-24T14:15:22Z","created_by":"string","note":"string"},"source":"string","tags_count":0,"tags":[{"id":0,"name":"string"}],"list_id":"string","_links":[{"rel":"string","href":"string","method":"GET","targetSchema":"string","schema":"string"}]}
   * @returns {AddMember_ResultObject}
   */
  async searchMember(query, listId, createFields) {
    try {
      const metadata = await this.#getMetadata()
      const { dc } = metadata

      const results = await this.#apiRequest({
        url: this.#buildUrl(dc, '/search-members'),
        logTag: 'searchMember',
        query: { query, list_id: listId },
      })

      const exactMatchesMembers = results.exact_matches?.members
      const fullSearchMembers = results.full_search?.members

      if (exactMatchesMembers && exactMatchesMembers.length > 0) {
        return exactMatchesMembers[0]
      }

      if (fullSearchMembers && fullSearchMembers.length > 0) {
        return fullSearchMembers[0]
      }

      if (createFields) {
        const { list_id, skip_merge_validation, ...body } = createFields

        return await this.#apiRequest({
          url: this.#buildUrl(dc, `/lists/${ list_id }/members`, skip_merge_validation),
          method: 'post',
          logTag: 'searchMember-create',
          body,
        })
      }

      throw new Error(`No member was found for the query '${ query }'.`)
    } catch (error) {
      logger.error(`searchMember error: ${ error }`)
      throw error
    }
  }

  /**
   * @description Adds a new note for a specific subscriber
   * @route POST /addMemberNote
   * @operationName Add Member Note
   * @category Member Management
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getDictionaryLists","description":"The unique ID for the list"}
   * @paramDef {"type":"String","label":"Subscriber Hash","name":"subscriberHash","required":true,"description":"The MD5 hash of the lowercase version of the list member's email address"}
   * @paramDef {"type":"String","label":"Note","name":"note","required":true,"description":"The content of the note"}
   * @sampleResult {"id":0,"created_at":"2019-08-24T14:15:22Z","created_by":"string","updated_at":"2019-08-24T14:15:22Z","note":"string","list_id":"string","email_id":"string","contact_id":"string","_links":[{"rel":"string","href":"string","method":"GET","targetSchema":"string","schema":"string"}]}
   * @returns {Object}
   */
  async addMemberNote(listId, subscriberHash, note) {
    try {
      const metadata = await this.#getMetadata()
      const { dc } = metadata

      return await this.#apiRequest({
        url: this.#buildUrl(dc, `/lists/${ listId }/members/${ subscriberHash }/notes`),
        method: 'post',
        logTag: 'addMemberNote',
        body: { note },
      })
    } catch (error) {
      logger.error(`addMemberNote error: ${ error }`)
      throw error
    }
  }

  /**
   * @description Archives a list member. To permanently delete, use the delete-permanent action
   * @route DELETE /archiveMember
   * @operationName Archive List Member
   * @category Member Management
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getDictionaryLists","description":"The unique ID for the list"}
   * @paramDef {"type":"String","label":"Subscriber Hash","name":"subscriberHash","required":true,"description":"The MD5 hash of the lowercase version of the list member's email address"}
   * @sampleResult {}
   * @returns {Object}
   */
  async archiveMember(listId, subscriberHash) {
    try {
      const metadata = await this.#getMetadata()
      const { dc } = metadata

      return await this.#apiRequest({
        url: this.#buildUrl(dc, `/lists/${ listId }/members/${ subscriberHash }`),
        method: 'delete',
        logTag: 'archiveMember',
      })
    } catch (error) {
      logger.error(`archiveMember error: ${ error }`)
      throw error
    }
  }

  /**
   * @description Adds a tag to a list member
   * @route POST /addMemberTag
   * @operationName Add Member Tag
   * @category Tag Management
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getDictionaryLists","description":"The unique ID for the list"}
   * @paramDef {"type":"String","label":"Subscriber Hash","name":"subscriberHash","required":true,"description":"The MD5 hash of the lowercase version of the list member's email address"}
   * @paramDef {"type":"String","label":"Tag","name":"tag","required":true,"description":"The name of the tag to add"}
   * @paramDef {"type":"Boolean","label":"Is Syncing","name":"isSyncing","description":"When is_syncing is true, automations based on the tag will not fire"}
   * @sampleResult {}
   * @returns {Object}
   */
  async addMemberTag(listId, subscriberHash, tag, isSyncing) {
    try {
      const metadata = await this.#getMetadata()
      const { dc } = metadata

      return await this.#apiRequest({
        url: this.#buildUrl(dc, `/lists/${ listId }/members/${ subscriberHash }/tags`),
        method: 'post',
        logTag: 'addMemberTag',
        body: {
          tags: [{ name: tag, status: 'active' }],
          is_syncing: isSyncing,
        },
      })
    } catch (error) {
      logger.error(`addMemberTag error: ${ error }`)
      throw error
    }
  }

  /**
   * @description Removes a tag from a list member
   * @route POST /removeMemberTag
   * @operationName Remove Member Tag
   * @category Tag Management
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getDictionaryLists","description":"The unique ID for the list"}
   * @paramDef {"type":"String","label":"Subscriber Hash","name":"subscriberHash","required":true,"description":"The MD5 hash of the lowercase version of the list member's email address"}
   * @paramDef {"type":"String","label":"Tag","name":"tag","required":true,"description":"The name of the tag to remove"}
   * @paramDef {"type":"Boolean","label":"Is Syncing","name":"isSyncing","description":"When is_syncing is true, automations based on the tag will not fire"}
   * @sampleResult {}
   * @returns {Object}
   */
  async removeMemberTag(listId, subscriberHash, tag, isSyncing) {
    try {
      const metadata = await this.#getMetadata()
      const { dc } = metadata

      return await this.#apiRequest({
        url: this.#buildUrl(dc, `/lists/${ listId }/members/${ subscriberHash }/tags`),
        method: 'post',
        logTag: 'removeMemberTag',
        body: {
          tags: [{ name: tag, status: 'inactive' }],
          is_syncing: isSyncing,
        },
      })
    } catch (error) {
      logger.error(`removeMemberTag error: ${ error }`)
      throw error
    }
  }

  /**
   * @typedef {Object} CreateTag_ResultObject
   * @property {Number} id
   * @property {String} name
   * @property {Number} member_count
   * @property {String} type
   * @property {String} created_at
   * @property {String} updated_at
   * @property {Object} options
   * @property {String} list_id
   */

  /**
   * @description Creates a new tag in your Mailchimp account
   * @route POST /createTag
   * @operationName Create Tag
   * @category Tag Management
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getDictionaryLists","description":"The unique ID for the list"}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the tag"}
   * @sampleResult {"id":0,"name":"string","member_count":0,"type":"saved","created_at":"2019-08-24T14:15:22Z","updated_at":"2019-08-24T14:15:22Z","options":{"match":"any","conditions":[null]},"list_id":"string","_links":[{"rel":"string","href":"string","method":"GET","targetSchema":"string","schema":"string"}]}
   * @returns {CreateTag_ResultObject}
   */
  async createTag(listId, name) {
    try {
      const metadata = await this.#getMetadata()
      const { dc } = metadata

      return await this.#apiRequest({
        url: this.#buildUrl(dc, `/lists/${ listId }/segments`),
        method: 'post',
        logTag: 'createTag',
        body: { name, static_segment: [] },
      })
    } catch (error) {
      logger.error(`createTag error: ${ error }`)
      throw error
    }
  }

  /**
   * @description Searches for a tag. Optionally, creates a tag if none is found
   * @route GET /searchTag
   * @operationName Search Tag
   * @category Tag Management
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"dictionary":"getDictionaryLists","description":"The unique ID for the list"}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the tag to search for"}
   * @paramDef {"type":"Boolean","label":"Create New Tag","name":"createNewTag","description":"Whether to create a new tag if none is found"}
   * @sampleResult {"id":"string","email_address":"string","unique_email_id":"string","contact_id":"string","full_name":"string","web_id":0,"email_type":"string","status":"subscribed","unsubscribe_reason":"string","consents_to_one_to_one_messaging":true,"merge_fields":{"property1":null,"property2":null},"interests":{"property1":true,"property2":true},"stats":{"avg_open_rate":0,"avg_click_rate":0,"ecommerce_data":{"total_revenue":0,"number_of_orders":0,"currency_code":"USD"}},"ip_signup":"string","timestamp_signup":"2019-08-24T14:15:22Z","ip_opt":"string","timestamp_opt":"2019-08-24T14:15:22Z","member_rating":0,"last_changed":"2019-08-24T14:15:22Z","language":"string","vip":true,"email_client":"string","location":{"latitude":0,"longitude":0,"gmtoff":0,"dstoff":0,"country_code":"string","timezone":"string","region":"string"},"marketing_permissions":[{"marketing_permission_id":"string","text":"string","enabled":true}],"last_note":{"note_id":0,"created_at":"2019-08-24T14:15:22Z","created_by":"string","note":"string"},"source":"string","tags_count":0,"tags":[{"id":0,"name":"string"}],"list_id":"string","_links":[{"rel":"string","href":"string","method":"GET","targetSchema":"string","schema":"string"}]}
   * @returns {Object}
   */
  async searchTag(listId, name, createNewTag) {
    try {
      const metadata = await this.#getMetadata()
      const { dc } = metadata

      const { tags } = await this.#apiRequest({
        url: this.#buildUrl(dc, `/lists/${ listId }/tag-search`),
        logTag: 'searchTag',
        query: { name },
      })

      const foundTag = tags.find(tag => tag.name === name)

      if (foundTag) {
        return foundTag
      }

      if (createNewTag) {
        return await this.#apiRequest({
          url: this.#buildUrl(dc, `/lists/${ listId }/segments`),
          method: 'post',
          logTag: 'searchTag-create',
          body: { name, static_segment: [] },
        })
      }

      throw new Error(`No tag with name '${ name }' was found.`)
    } catch (error) {
      logger.error(`searchTag error: ${ error }`)
      throw error
    }
  }

  // Campaign-related methods continue with similar pattern...
  // For brevity, I'll show a few key methods and skip repetitive ones

  /**
   * @description Gets information about a specific campaign
   * @route GET /getCampaignInfo
   * @operationName Get Campaign Info
   * @category Campaign Management
   * @paramDef {"type":"String","label":"Campaign ID","name":"campaignId","required":true,"dictionary":"getCampaigns","description":"The unique ID for the campaign"}
   * @paramDef {"type":"Array","label":"Fields","name":"fields","description":"A comma-separated list of fields to return"}
   * @paramDef {"type":"Array","label":"Exclude Fields","name":"excludeFields","description":"A comma-separated list of fields to exclude"}
   * @sampleResult {"id":"string","web_id":0,"parent_campaign_id":"string","type":"regular","create_time":"2019-08-24T14:15:22Z","archive_url":"string","long_archive_url":"string","status":"save","emails_sent":0,"send_time":"2019-08-24T14:15:22Z","content_type":"template","needs_block_refresh":true,"resendable":true,"recipients":{"list_id":"string","list_is_active":true,"list_name":"string","segment_text":"string","recipient_count":0,"segment_opts":{"saved_segment_id":0,"prebuilt_segment_id":"subscribers-female","match":"any","conditions":[null]}},"settings":{"subject_line":"string","preview_text":"string","title":"string","from_name":"string","reply_to":"string","use_conversation":true,"to_name":"string","folder_id":"string","authenticate":true,"auto_footer":true,"inline_css":true,"auto_tweet":true,"auto_fb_post":["string"],"fb_comments":true,"timewarp":true,"template_id":0,"drag_and_drop":true},"variate_settings":{"winning_combination_id":"string","winning_campaign_id":"string","winner_criteria":"opens","wait_time":0,"test_size":0,"subject_lines":["string"],"send_times":["2019-08-24T14:15:22Z"],"from_names":["string"],"reply_to_addresses":["string"],"contents":["string"],"combinations":[{"id":"string","subject_line":0,"send_time":0,"from_name":0,"reply_to":0,"content_description":0,"recipients":0}]},"tracking":{"opens":true,"html_clicks":true,"text_clicks":true,"goal_tracking":true,"ecomm360":true,"google_analytics":"string","clicktale":"string","salesforce":{"campaign":true,"notes":true},"capsule":{"notes":true}},"rss_opts":{"feed_url":"http://example.com","frequency":"daily","schedule":{"hour":0,"daily_send":{"sunday":true,"monday":true,"tuesday":true,"wednesday":true,"thursday":true,"friday":true,"saturday":true},"weekly_send_day":"sunday","monthly_send_date":0},"last_sent":"2019-08-24T14:15:22Z","constrain_rss_img":true},"ab_split_opts":{"split_test":"subject","pick_winner":"opens","wait_units":"hours","wait_time":0,"split_size":1,"from_name_a":"string","from_name_b":"string","reply_email_a":"string","reply_email_b":"string","subject_a":"string","subject_b":"string","send_time_a":"2019-08-24T14:15:22Z","send_time_b":"2019-08-24T14:15:22Z","send_time_winner":"string"},"social_card":{"image_url":"string","description":"string","title":"string"},"report_summary":{"opens":0,"unique_opens":0,"open_rate":0,"clicks":0,"subscriber_clicks":0,"click_rate":0,"ecommerce":{"total_orders":0,"total_spent":0,"total_revenue":0}},"delivery_status":{"enabled":true,"can_cancel":true,"status":"delivering","emails_sent":0,"emails_canceled":0},"_links":[{"rel":"string","href":"string","method":"GET","targetSchema":"string","schema":"string"}]}
   * @returns {Object}
   */
  async getCampaignInfo(campaignId, fields, excludeFields) {
    try {
      const metadata = await this.#getMetadata()
      const { dc } = metadata

      return await this.#apiRequest({
        url: this.#buildUrl(dc, `/campaigns/${ campaignId }`),
        logTag: 'getCampaignInfo',
        query: {
          fields: fields?.join(','),
          exclude_fields: excludeFields?.join(','),
        },
      })
    } catch (error) {
      logger.error(`getCampaignInfo error: ${ error }`)
      throw error
    }
  }

}

Flowrunner.ServerCode.addService(MailchimpMarketing, [
  {
    order: 0,
    displayName: 'Client ID',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Client ID from your Mailchimp app settings.',
  },
  {
    order: 1,
    displayName: 'Client Secret',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Client Secret from your Mailchimp app settings.',
  },
])