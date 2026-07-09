const OAUTH_BASE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0'
const ME_URL = `${ GRAPH_BASE_URL }/me`
const PAGE_SIZE_DICTIONARY = 25
const DEFAULT_LIST_TOP = 25
// Byte-range size for large-file upload sessions. Graph requires every chunk but the last to be a
// multiple of 320 KiB (327,680 bytes); 10 MiB is exactly 32 x 320 KiB and sits in Graph's
// recommended 5-10 MiB range.
const UPLOAD_CHUNK_SIZE = 10 * 1024 * 1024

const DEFAULT_SCOPE_LIST = [
  'User.Read',
  'Sites.Read.All',
  'Sites.ReadWrite.All',
  'Sites.Manage.All',
  'Files.Read.All',
  'Files.ReadWrite.All',
  'offline_access',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

// Lookback subtracted from the stored watermark when polling the next window, so records that
// become queryable a little after their timestamp still land inside the window (the seen-id set
// dedupes the overlap). 15 minutes.
const POLL_OVERLAP_MS = 15 * 60 * 1000
// Cap on the carried seen-id set so poll state never grows without bound (keeps the newest IDs).
const MAX_SEEN_IDS = 5000

const ERROR_HINTS = {
  400: 'Invalid request — check the required fields and their values.',
  401: 'Authentication failed — reconnect the SharePoint account.',
  403: 'Permission denied — the connected account is missing the scope for this action.',
  404: 'Not found — the ID may be wrong; use the matching "Get …"/dictionary action to pick a valid one.',
  422: 'Invalid request — check the required fields and their values.',
  429: 'SharePoint rate limit hit — retry in a moment.',
}

const logger = {
  info: (...args) => console.log('[SharePoint Service] info:', ...args),
  debug: (...args) => console.log('[SharePoint Service] debug:', ...args),
  error: (...args) => console.log('[SharePoint Service] error:', ...args),
  warn: (...args) => console.log('[SharePoint Service] warn:', ...args),
}

/**
 * @usesFileStorage
 * @requireOAuth
 * @integrationName SharePoint
 * @integrationIcon /icon.png
 **/
class SharePointService {
  /**
   * @typedef {Object} getSitesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter sites by display name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getListsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site whose lists are returned."}
   */

  /**
   * @typedef {Object} getListsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter lists by display name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   * @paramDef {"type":"getListsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters to identify the SharePoint site."}
   */

  /**
   * @typedef {Object} getDrivesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site whose document libraries (drives) are returned."}
   */

  /**
   * @typedef {Object} getDrivesDictionary__payload
   * @paramDef {"type":"getDrivesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters to identify the SharePoint site."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter drives by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getDriveItemsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site."}
   * @paramDef {"type":"String","label":"Drive","name":"driveId","required":true,"dictionary":"getDrivesDictionary","dependsOn":["siteId"],"description":"The drive containing the items."}
   * @paramDef {"type":"String","label":"Folder ID","name":"folderId","description":"Folder to list children of. Leave blank for the drive root."}
   */

  /**
   * @typedef {Object} getDriveItemsDictionary__payload
   * @paramDef {"type":"getDriveItemsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters to identify the drive and folder."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter items by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getListItemsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site."}
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["siteId"],"description":"The list whose items are returned."}
   */

  /**
   * @typedef {Object} getListItemsDictionary__payload
   * @paramDef {"type":"getListItemsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters to identify the site and list."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter items locally by Title field."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
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

  async #apiRequest({ url, method, body, query, headers, logTag }) {
    method = method || 'get'
    query = cleanupObject(query)

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      const req = Flowrunner.Request[method](url)
        .set({ ...this.#getAccessTokenHeader(), ...(headers || {}) })

      if (query) {
        req.query(query)
      }

      return await req.send(body)
    } catch (error) {
      throw this.#normalizeError(error, logTag)
    }
  }

  #normalizeError(error, logTag) {
    const status = error?.status || error?.body?.status
    const apiMessage = error?.body?.error?.message || error?.body?.message || error?.message || 'Request failed'

    logger.error(`${ logTag } - error [${ status }]: ${ apiMessage }`)

    const friendly = ERROR_HINTS[status]

    return new Error(friendly ? `${ friendly } (${ apiMessage })` : apiMessage)
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Normalize a downloaded file body to a Buffer. Flowrunner.Request auto-parses
  // the response by Content-Type, so a JSON/text source comes back as a parsed
  // object/array/string rather than bytes despite .setEncoding(null). Buffer.from
  // on a parsed array would also misread elements as byte values, so re-serialize
  // anything that isn't already a Buffer.
  #toBuffer(body) {
    if (Buffer.isBuffer(body)) {
      return body
    }

    if (typeof body === 'string') {
      return Buffer.from(body)
    }

    return Buffer.from(JSON.stringify(body))
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
    params.append('prompt', 'select_account')

    return `${ OAUTH_BASE_URL }/authorize?${ params.toString() }`
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
        // Entra ID may omit refresh_token on a refresh; fall back to the current one so we never
        // overwrite the stored refresh token with undefined and break the connection.
        refreshToken: response.refresh_token || refreshToken,
        expirationInSeconds: response.expires_in,
      }
    } catch (error) {
      logger.error('Error refreshing token: ', error.message || error)
      throw error
    }
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
      userData = await Flowrunner.Request.get(ME_URL).set({
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
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    return this[invocation.eventName](invocation)
  }

  // ============================================================
  // DICTIONARIES
  // ============================================================

  /**
   * @registerAs DICTIONARY
   * @operationName Get Sites Dictionary
   * @description Provides a searchable list of SharePoint sites for dynamic parameter selection.
   * @route POST /get-sites-dictionary
   * @paramDef {"type":"getSitesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Marketing Team Site","value":"contoso.sharepoint.com,abc123,def456","note":"Path: /sites/marketing"}],"cursor":null}
   */
  async getSitesDictionary(payload) {
    const { search, cursor } = payload || {}

    let url
    let query

    if (cursor) {
      url = cursor
    } else if (search) {
      url = `${ GRAPH_BASE_URL }/sites`

      query = {
        search: search,
        $top: PAGE_SIZE_DICTIONARY,
        $select: 'id,displayName,name,webUrl',
      }
    } else {
      url = `${ GRAPH_BASE_URL }/sites`

      query = {
        search: '*',
        $top: PAGE_SIZE_DICTIONARY,
        $select: 'id,displayName,name,webUrl',
      }
    }

    const response = await this.#apiRequest({
      url,
      query,
      logTag: 'getSitesDictionary',
    })

    const sites = response.value || []

    return {
      cursor: response['@odata.nextLink'] || null,
      items: sites.map(site => ({
        label: site.displayName || site.name || site.id,
        note: site.webUrl ? `URL: ${ site.webUrl }` : `ID: ${ site.id }`,
        value: site.id,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Lists Dictionary
   * @description Provides a searchable list of SharePoint lists within a selected site.
   * @route POST /get-lists-dictionary
   * @paramDef {"type":"getListsDictionary__payload","label":"Payload","name":"payload","description":"Contains site ID, optional search string, and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Tasks","value":"abcd-1234","note":"ID: abcd-1234"}],"cursor":null}
   */
  async getListsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const siteId = criteria?.siteId

    if (!siteId) {
      return { items: [], cursor: null }
    }

    const url = cursor ? cursor : `${ GRAPH_BASE_URL }/sites/${ siteId }/lists`
    const query = cursor ? undefined : {
      $top: PAGE_SIZE_DICTIONARY,
      $select: 'id,displayName,name',
    }

    const response = await this.#apiRequest({
      url,
      query,
      logTag: 'getListsDictionary',
    })

    const lists = response.value || []
    const filtered = search ? searchFilter(lists, ['displayName', 'name'], search) : lists

    return {
      cursor: response['@odata.nextLink'] || null,
      items: filtered.map(list => ({
        label: list.displayName || list.name || list.id,
        note: `ID: ${ list.id }`,
        value: list.id,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Drives Dictionary
   * @description Provides a searchable list of document libraries (drives) within a selected site.
   * @route POST /get-drives-dictionary
   * @paramDef {"type":"getDrivesDictionary__payload","label":"Payload","name":"payload","description":"Contains site ID, optional search string, and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Documents","value":"b!abc","note":"Type: documentLibrary"}],"cursor":null}
   */
  async getDrivesDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const siteId = criteria?.siteId

    if (!siteId) {
      return { items: [], cursor: null }
    }

    const url = cursor ? cursor : `${ GRAPH_BASE_URL }/sites/${ siteId }/drives`
    const query = cursor ? undefined : {
      $top: PAGE_SIZE_DICTIONARY,
      $select: 'id,name,driveType',
    }

    const response = await this.#apiRequest({
      url,
      query,
      logTag: 'getDrivesDictionary',
    })

    const drives = response.value || []
    const filtered = search ? searchFilter(drives, ['name'], search) : drives

    return {
      cursor: response['@odata.nextLink'] || null,
      items: filtered.map(drive => ({
        label: drive.name || drive.id,
        note: `Type: ${ drive.driveType || 'documentLibrary' }`,
        value: drive.id,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Drive Items Dictionary
   * @description Provides a searchable list of folders and files within a drive folder for dynamic selection.
   * @route POST /get-drive-items-dictionary
   * @paramDef {"type":"getDriveItemsDictionary__payload","label":"Payload","name":"payload","description":"Contains drive ID, optional folder ID, search string, and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Reports","value":"01ABC","note":"Type: folder"}],"cursor":null}
   */
  async getDriveItemsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    // Accept "targetDriveId" too: copyDriveItem's Target Parent Folder chooser depends on
    // targetDriveId, so the criteria arrives under that alias rather than driveId.
    const driveId = criteria?.driveId ?? criteria?.targetDriveId
    const folderId = criteria?.folderId

    if (!driveId) {
      return { items: [], cursor: null }
    }

    let url
    let query

    if (cursor) {
      url = cursor
    } else {
      const path = folderId
        ? `/drives/${ driveId }/items/${ folderId }/children`
        : `/drives/${ driveId }/root/children`
      url = `${ GRAPH_BASE_URL }${ path }`

      query = {
        $top: PAGE_SIZE_DICTIONARY,
        $select: 'id,name,folder,file,size',
      }
    }

    const response = await this.#apiRequest({
      url,
      query,
      logTag: 'getDriveItemsDictionary',
    })

    const items = response.value || []
    const filtered = search ? searchFilter(items, ['name'], search) : items

    return {
      cursor: response['@odata.nextLink'] || null,
      items: filtered.map(item => ({
        label: item.name,
        note: `Type: ${ item.folder ? 'folder' : 'file' }`,
        value: item.id,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get List Items Dictionary
   * @description Provides a searchable list of items within a SharePoint list for dynamic parameter selection.
   * @route POST /get-list-items-dictionary
   * @paramDef {"type":"getListItemsDictionary__payload","label":"Payload","name":"payload","description":"Contains site ID, list ID, optional search and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Quarterly Report","value":"42","note":"ID: 42"}],"cursor":null}
   */
  async getListItemsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const siteId = criteria?.siteId
    const listId = criteria?.listId

    if (!siteId || !listId) {
      return { items: [], cursor: null }
    }

    const url = cursor ? cursor : `${ GRAPH_BASE_URL }/sites/${ siteId }/lists/${ listId }/items`
    const query = cursor ? undefined : {
      $top: PAGE_SIZE_DICTIONARY,
      $expand: 'fields($select=Title)',
    }

    const response = await this.#apiRequest({
      url,
      query,
      logTag: 'getListItemsDictionary',
    })

    const items = response.value || []
    const filtered = search ? items.filter(item => {
      const title = item.fields?.Title || ''

      return title.toLowerCase().includes(search.toLowerCase())
    }) : items

    return {
      cursor: response['@odata.nextLink'] || null,
      items: filtered.map(item => ({
        label: item.fields?.Title || `Item ${ item.id }`,
        note: `ID: ${ item.id }`,
        value: item.id,
      })),
    }
  }

  // ============================================================
  // USER
  // ============================================================

  /**
   * @operationName Get User Profile
   * @category User Information
   * @appearanceColor #038387 #4FC3C7
   * @description Retrieves the profile of the signed-in user including display name, email, and basic information.
   * @route POST /get-user-profile
   * @returns {Object}
   * @sampleResult {"id":"87d349ed-44d7-43e1-9a83-5f2406dee5bd","displayName":"John Smith","mail":"john.smith@company.com","userPrincipalName":"john.smith@company.com"}
   */
  getUserProfile() {
    return this.#apiRequest({
      url: ME_URL,
      logTag: 'getUserProfile',
    })
  }

  // ============================================================
  // SITES
  // ============================================================

  /**
   * @operationName Get Root Site
   * @category Sites
   * @appearanceColor #038387 #4FC3C7
   * @description Retrieves the root SharePoint site for the tenant.
   * @route POST /get-root-site
   * @returns {Object}
   * @sampleResult {"id":"contoso.sharepoint.com,abc,def","displayName":"Communication site","webUrl":"https://contoso.sharepoint.com"}
   */
  getRootSite() {
    return this.#apiRequest({
      url: `${ GRAPH_BASE_URL }/sites/root`,
      logTag: 'getRootSite',
    })
  }

  /**
   * @operationName Get Site By ID
   * @category Sites
   * @appearanceColor #038387 #4FC3C7
   * @description Retrieves details of a SharePoint site by its ID.
   * @route POST /get-site
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"contoso.sharepoint.com,abc,def","displayName":"Marketing","webUrl":"https://contoso.sharepoint.com/sites/marketing"}
   */
  async getSiteById(siteId) {
    if (!siteId) {
      throw new Error('Parameter "Site" is required')
    }

    return this.#apiRequest({
      url: `${ GRAPH_BASE_URL }/sites/${ siteId }`,
      logTag: 'getSiteById',
    })
  }

  /**
   * @operationName Search Sites
   * @category Sites
   * @appearanceColor #038387 #4FC3C7
   * @description Searches SharePoint sites accessible to the signed-in user.
   * @route POST /search-sites
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Search keywords. Use '*' to match all sites."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of sites to return. Defaults to 25, max 200."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"contoso.sharepoint.com,abc,def","displayName":"Marketing","webUrl":"https://contoso.sharepoint.com/sites/marketing"}]}
   */
  async searchSites(query, maxResults) {
    if (!query) {
      throw new Error('Parameter "Query" is required')
    }

    return this.#apiRequest({
      url: `${ GRAPH_BASE_URL }/sites`,
      logTag: 'searchSites',
      query: {
        search: query,
        $top: Math.min(maxResults ?? DEFAULT_LIST_TOP, 200),
        $select: 'id,displayName,name,webUrl,description,createdDateTime',
      },
    })
  }

  /**
   * @operationName Get Followed Sites
   * @category Sites
   * @appearanceColor #038387 #4FC3C7
   * @description Retrieves the SharePoint sites that the signed-in user is following.
   * @route POST /get-followed-sites
   * @returns {Object}
   * @sampleResult {"value":[{"id":"contoso.sharepoint.com,abc,def","displayName":"Marketing"}]}
   */
  getFollowedSites() {
    return this.#apiRequest({
      url: `${ ME_URL }/followedSites`,
      logTag: 'getFollowedSites',
    })
  }

  /**
   * @operationName Get Site By Path
   * @category Sites
   * @appearanceColor #038387 #4FC3C7
   * @description Retrieves a SharePoint site by hostname and server-relative path.
   * @route POST /get-site-by-path
   * @paramDef {"type":"String","label":"Hostname","name":"hostname","required":true,"description":"Tenant hostname, e.g. contoso.sharepoint.com."}
   * @paramDef {"type":"String","label":"Site Path","name":"sitePath","required":true,"description":"Server-relative path of the site, e.g. /sites/marketing."}
   * @returns {Object}
   * @sampleResult {"id":"contoso.sharepoint.com,abc,def","displayName":"Marketing","webUrl":"https://contoso.sharepoint.com/sites/marketing"}
   */
  async getSiteByPath(hostname, sitePath) {
    if (!hostname) {
      throw new Error('Parameter "Hostname" is required')
    }

    if (!sitePath) {
      throw new Error('Parameter "Site Path" is required')
    }

    const cleaned = sitePath.replace(/^\/+/, '').replace(/\/+$/, '')

    if (!cleaned) {
      throw new Error('Parameter "Site Path" cannot be empty or just slashes')
    }

    const encoded = cleaned.split('/').map(encodeURIComponent).join('/')

    return this.#apiRequest({
      url: `${ GRAPH_BASE_URL }/sites/${ hostname }:/${ encoded }`,
      logTag: 'getSiteByPath',
    })
  }

  // ============================================================
  // LISTS
  // ============================================================

  /**
   * @operationName Get Lists
   * @category Lists
   * @appearanceColor #038387 #4FC3C7
   * @description Retrieves all lists from a SharePoint site.
   * @route POST /get-lists
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site whose lists are returned."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of lists to return. Defaults to 25, max 200."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"abc-123","displayName":"Tasks","createdDateTime":"2024-01-15T10:00:00Z"}]}
   */
  async getLists(siteId, maxResults) {
    if (!siteId) {
      throw new Error('Parameter "Site" is required')
    }

    return this.#apiRequest({
      url: `${ GRAPH_BASE_URL }/sites/${ siteId }/lists`,
      logTag: 'getLists',
      query: {
        $top: Math.min(maxResults ?? DEFAULT_LIST_TOP, 200),
      },
    })
  }

  /**
   * @operationName Get List
   * @category Lists
   * @appearanceColor #038387 #4FC3C7
   * @description Retrieves details for a single SharePoint list.
   * @route POST /get-list
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site containing the list."}
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["siteId"],"description":"The list to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"abc-123","displayName":"Tasks","columns":[],"createdDateTime":"2024-01-15T10:00:00Z"}
   */
  async getList(siteId, listId) {
    if (!siteId) {
      throw new Error('Parameter "Site" is required')
    }

    if (!listId) {
      throw new Error('Parameter "List" is required')
    }

    return this.#apiRequest({
      url: `${ GRAPH_BASE_URL }/sites/${ siteId }/lists/${ listId }`,
      logTag: 'getList',
      query: { $expand: 'columns' },
    })
  }

  /**
   * @operationName Create List
   * @category Lists
   * @appearanceColor #038387 #4FC3C7
   * @description Creates a new list in a SharePoint site.
   * @route POST /create-list
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site to create the list in."}
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","required":true,"description":"The display name for the new list."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Optional description of the list."}
   * @paramDef {"type":"String","label":"Template","name":"template","uiComponent":{"type":"DROPDOWN","options":{"values":["Generic List","Document Library"]}},"description":"Base template for the list. Defaults to genericList. Microsoft Graph v1.0 only supports creating genericList and documentLibrary templates programmatically."}
   * @returns {Object}
   * @sampleResult {"id":"abc-123","displayName":"My New List","list":{"template":"genericList"}}
   */
  async createList(siteId, displayName, description, template) {
    if (!siteId) {
      throw new Error('Parameter "Site" is required')
    }

    if (!displayName) {
      throw new Error('Parameter "Display Name" is required')
    }

    template = this.#resolveChoice(template, { 'Generic List': 'genericList', 'Document Library': 'documentLibrary' })

    const body = {
      displayName: displayName,
      list: {
        template: template || 'genericList',
      },
    }

    if (description) {
      body.description = description
    }

    return this.#apiRequest({
      url: `${ GRAPH_BASE_URL }/sites/${ siteId }/lists`,
      logTag: 'createList',
      method: 'post',
      body: body,
    })
  }

  /**
   * @operationName Delete List
   * @category Lists
   * @appearanceColor #038387 #4FC3C7
   * @description Deletes a SharePoint list.
   * @route POST /delete-list
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site containing the list."}
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["siteId"],"description":"The list to delete."}
   * @returns {Object}
   * @sampleResult {"message":"List deleted successfully"}
   */
  async deleteList(siteId, listId) {
    if (!siteId) {
      throw new Error('Parameter "Site" is required')
    }

    if (!listId) {
      throw new Error('Parameter "List" is required')
    }

    await this.#apiRequest({
      url: `${ GRAPH_BASE_URL }/sites/${ siteId }/lists/${ listId }`,
      logTag: 'deleteList',
      method: 'delete',
    })

    return { message: 'List deleted successfully' }
  }

  /**
   * @operationName Get List Columns
   * @category Lists
   * @appearanceColor #038387 #4FC3C7
   * @description Retrieves the column definitions of a SharePoint list - each column's internal name, display name, type, and whether it is required or read-only. Use it to discover the column names to pass to Create List Item and Update List Item.
   * @route POST /get-list-columns
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site."}
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["siteId"],"description":"The list whose columns are returned."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"99ddcf45-e2f7-4f17-82b0-6fba34445103","name":"Title","displayName":"Title","required":false,"readOnly":false,"hidden":false,"text":{"maxLength":255}}]}
   */
  async getListColumns(siteId, listId) {
    if (!siteId || !listId) {
      throw new Error('Parameters "Site" and "List" are required')
    }

    return this.#apiRequest({
      url: `${ GRAPH_BASE_URL }/sites/${ siteId }/lists/${ listId }/columns`,
      logTag: 'getListColumns',
    })
  }

  // ============================================================
  // LIST ITEMS
  // ============================================================

  /**
   * @operationName Get List Items
   * @category List Items
   * @appearanceColor #038387 #4FC3C7
   * @description Retrieves items from a SharePoint list with their field values.
   * @route POST /get-list-items
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site."}
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["siteId"],"description":"The list whose items are returned."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of items to return. Defaults to 25, max 200."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"OData $filter expression applied to the fields, e.g. fields/Title eq 'Foo'."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","description":"OData $orderby expression, e.g. fields/Modified desc."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"URL to retrieve the next page of results. If provided, all other parameters are ignored."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"1","fields":{"Title":"Quarterly Report","Status":"Done"}}],"@odata.nextLink":null}
   */
  async getListItems(siteId, listId, maxResults, filter, orderBy, nextLink) {
    if (nextLink) {
      return this.#apiRequest({
        url: nextLink,
        logTag: 'getListItems',
      })
    }

    if (!siteId) {
      throw new Error('Parameter "Site" is required')
    }

    if (!listId) {
      throw new Error('Parameter "List" is required')
    }

    const query = {
      $expand: 'fields',
      $top: Math.min(maxResults ?? DEFAULT_LIST_TOP, 200),
    }

    if (filter) {
      query.$filter = filter
    }

    if (orderBy) {
      query.$orderby = orderBy
    }

    return this.#apiRequest({
      url: `${ GRAPH_BASE_URL }/sites/${ siteId }/lists/${ listId }/items`,
      logTag: 'getListItems',
      query,
      headers: (filter || orderBy) ? { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } : undefined,
    })
  }

  /**
   * @operationName Get List Item
   * @category List Items
   * @appearanceColor #038387 #4FC3C7
   * @description Retrieves a single item from a SharePoint list with all field values.
   * @route POST /get-list-item
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site."}
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["siteId"],"description":"The list containing the item."}
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"getListItemsDictionary","dependsOn":["siteId","listId"],"description":"The item to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"1","fields":{"Title":"Quarterly Report","Status":"Done"}}
   */
  async getListItem(siteId, listId, itemId) {
    if (!siteId || !listId || !itemId) {
      throw new Error('Parameters "Site", "List" and "Item" are required')
    }

    return this.#apiRequest({
      url: `${ GRAPH_BASE_URL }/sites/${ siteId }/lists/${ listId }/items/${ itemId }`,
      logTag: 'getListItem',
      query: { $expand: 'fields' },
    })
  }

  /**
   * @operationName Create List Item
   * @category List Items
   * @appearanceColor #038387 #4FC3C7
   * @description Creates a new item in a SharePoint list with the provided field values.
   * @route POST /create-list-item
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site."}
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["siteId"],"description":"The list to add the item to."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"description":"Field values for the new item, keyed by the list's internal column names, e.g. {\"Title\":\"My item\",\"Status\":\"Open\"}. Freeform because the columns differ per list. Use Get List Columns to discover the available column names."}
   * @returns {Object}
   * @sampleResult {"id":"42","fields":{"Title":"My item","Status":"Open"}}
   */
  async createListItem(siteId, listId, fields) {
    if (!siteId) {
      throw new Error('Parameter "Site" is required')
    }

    if (!listId) {
      throw new Error('Parameter "List" is required')
    }

    if (!fields || typeof fields !== 'object') {
      throw new Error('Parameter "Fields" is required and must be an object')
    }

    return this.#apiRequest({
      url: `${ GRAPH_BASE_URL }/sites/${ siteId }/lists/${ listId }/items`,
      logTag: 'createListItem',
      method: 'post',
      body: { fields: fields },
    })
  }

  /**
   * @operationName Update List Item
   * @category List Items
   * @appearanceColor #038387 #4FC3C7
   * @description Updates the field values of an existing list item.
   * @route POST /update-list-item
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site."}
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["siteId"],"description":"The list containing the item."}
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"getListItemsDictionary","dependsOn":["siteId","listId"],"description":"The item to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"description":"Field values to update, keyed by the list's internal column names. Only the columns you supply are modified. Freeform because the columns differ per list. Use Get List Columns to discover the available column names."}
   * @returns {Object}
   * @sampleResult {"Title":"Updated Report","Status":"Done"}
   */
  async updateListItem(siteId, listId, itemId, fields) {
    if (!siteId || !listId || !itemId) {
      throw new Error('Parameters "Site", "List" and "Item" are required')
    }

    if (!fields || typeof fields !== 'object') {
      throw new Error('Parameter "Fields" is required and must be an object')
    }

    return this.#apiRequest({
      url: `${ GRAPH_BASE_URL }/sites/${ siteId }/lists/${ listId }/items/${ itemId }/fields`,
      logTag: 'updateListItem',
      method: 'patch',
      body: fields,
    })
  }

  /**
   * @operationName Delete List Item
   * @category List Items
   * @appearanceColor #038387 #4FC3C7
   * @description Deletes a list item from a SharePoint list.
   * @route POST /delete-list-item
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site."}
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["siteId"],"description":"The list containing the item."}
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"getListItemsDictionary","dependsOn":["siteId","listId"],"description":"The item to delete."}
   * @returns {Object}
   * @sampleResult {"message":"Item deleted successfully"}
   */
  async deleteListItem(siteId, listId, itemId) {
    if (!siteId || !listId || !itemId) {
      throw new Error('Parameters "Site", "List" and "Item" are required')
    }

    await this.#apiRequest({
      url: `${ GRAPH_BASE_URL }/sites/${ siteId }/lists/${ listId }/items/${ itemId }`,
      logTag: 'deleteListItem',
      method: 'delete',
    })

    return { message: 'Item deleted successfully' }
  }

  // ============================================================
  // DRIVES & FILES
  // ============================================================

  /**
   * @operationName Get Drives
   * @category Drives
   * @appearanceColor #038387 #4FC3C7
   * @description Retrieves all document libraries (drives) for a SharePoint site.
   * @route POST /get-drives
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"b!abc","name":"Documents","driveType":"documentLibrary"}]}
   */
  async getDrives(siteId) {
    if (!siteId) {
      throw new Error('Parameter "Site" is required')
    }

    return this.#apiRequest({
      url: `${ GRAPH_BASE_URL }/sites/${ siteId }/drives`,
      logTag: 'getDrives',
    })
  }

  /**
   * @operationName List Folder Children
   * @category Drives
   * @appearanceColor #038387 #4FC3C7
   * @description Retrieves the immediate children (files and folders) of a folder in a drive. Leave folder blank for the drive root.
   * @route POST /list-folder-children
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site."}
   * @paramDef {"type":"String","label":"Drive","name":"driveId","required":true,"dictionary":"getDrivesDictionary","dependsOn":["siteId"],"description":"The document library."}
   * @paramDef {"type":"String","label":"Folder","name":"folderId","dictionary":"getDriveItemsDictionary","dependsOn":["siteId","driveId"],"description":"The folder to list children of. Leave blank for the drive root."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of items to return. Defaults to 25, max 200."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"URL to retrieve the next page of results. If provided, all other parameters are ignored."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"01ABC","name":"Reports","folder":{"childCount":3}},{"id":"01DEF","name":"data.xlsx","file":{"mimeType":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},"size":12345}]}
   */
  async listFolderChildren(siteId, driveId, folderId, maxResults, nextLink) {
    if (nextLink) {
      return this.#apiRequest({
        url: nextLink,
        logTag: 'listFolderChildren',
      })
    }

    if (!siteId) {
      throw new Error('Parameter "Site" is required')
    }

    if (!driveId) {
      throw new Error('Parameter "Drive" is required')
    }

    const path = folderId
      ? `/drives/${ driveId }/items/${ folderId }/children`
      : `/drives/${ driveId }/root/children`

    return this.#apiRequest({
      url: `${ GRAPH_BASE_URL }${ path }`,
      logTag: 'listFolderChildren',
      query: {
        $top: Math.min(maxResults ?? DEFAULT_LIST_TOP, 200),
      },
    })
  }

  /**
   * @operationName Get Drive Item
   * @category Drives
   * @appearanceColor #038387 #4FC3C7
   * @description Retrieves metadata for a file or folder by its ID.
   * @route POST /get-drive-item
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site."}
   * @paramDef {"type":"String","label":"Drive","name":"driveId","required":true,"dictionary":"getDrivesDictionary","dependsOn":["siteId"],"description":"The document library."}
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"getDriveItemsDictionary","dependsOn":["siteId","driveId"],"description":"The file or folder."}
   * @returns {Object}
   * @sampleResult {"id":"01DEF","name":"data.xlsx","file":{"mimeType":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},"size":12345,"webUrl":"https://contoso.sharepoint.com/..."}
   */
  async getDriveItem(siteId, driveId, itemId) {
    if (!siteId || !driveId || !itemId) {
      throw new Error('Parameters "Site", "Drive" and "Item" are required')
    }

    return this.#apiRequest({
      url: `${ GRAPH_BASE_URL }/drives/${ driveId }/items/${ itemId }`,
      logTag: 'getDriveItem',
    })
  }

  /**
   * @operationName Get Drive Item By Path
   * @category Drives
   * @appearanceColor #038387 #4FC3C7
   * @description Retrieves a drive item by its path within the drive root.
   * @route POST /get-drive-item-by-path
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site."}
   * @paramDef {"type":"String","label":"Drive","name":"driveId","required":true,"dictionary":"getDrivesDictionary","dependsOn":["siteId"],"description":"The document library."}
   * @paramDef {"type":"String","label":"Item Path","name":"itemPath","required":true,"description":"Path of the item relative to the drive root, e.g. Reports/2024/Q1.xlsx."}
   * @returns {Object}
   * @sampleResult {"id":"01DEF","name":"Q1.xlsx","file":{"mimeType":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}}
   */
  async getDriveItemByPath(siteId, driveId, itemPath) {
    if (!siteId || !driveId || !itemPath) {
      throw new Error('Parameters "Site", "Drive" and "Item Path" are required')
    }

    const cleaned = itemPath.replace(/^\/+/, '').replace(/\/+$/, '')

    if (!cleaned) {
      throw new Error('Parameter "Item Path" cannot be empty or just slashes')
    }

    const encoded = cleaned.split('/').map(encodeURIComponent).join('/')

    return this.#apiRequest({
      url: `${ GRAPH_BASE_URL }/drives/${ driveId }/root:/${ encoded }`,
      logTag: 'getDriveItemByPath',
    })
  }

  /**
   * @operationName Create Folder
   * @category Drives
   * @appearanceColor #038387 #4FC3C7
   * @description Creates a new folder inside a drive folder. Leave parent folder blank to create at the drive root.
   * @route POST /create-folder
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site."}
   * @paramDef {"type":"String","label":"Drive","name":"driveId","required":true,"dictionary":"getDrivesDictionary","dependsOn":["siteId"],"description":"The document library."}
   * @paramDef {"type":"String","label":"Parent Folder","name":"parentFolderId","dictionary":"getDriveItemsDictionary","dependsOn":["siteId","driveId"],"description":"Parent folder. Leave blank for the drive root."}
   * @paramDef {"type":"String","label":"Folder Name","name":"folderName","required":true,"description":"Name of the new folder."}
   * @paramDef {"type":"String","label":"On Conflict","name":"conflictBehavior","uiComponent":{"type":"DROPDOWN","options":{"values":["Fail","Rename","Replace"]}},"description":"What to do if a folder with this name already exists. Defaults to fail."}
   * @returns {Object}
   * @sampleResult {"id":"01ABC","name":"Reports","folder":{"childCount":0}}
   */
  async createFolder(siteId, driveId, parentFolderId, folderName, conflictBehavior) {
    if (!siteId || !driveId || !folderName) {
      throw new Error('Parameters "Site", "Drive" and "Folder Name" are required')
    }

    conflictBehavior = this.#resolveChoice(conflictBehavior, { Fail: 'fail', Rename: 'rename', Replace: 'replace' })

    const path = parentFolderId
      ? `/drives/${ driveId }/items/${ parentFolderId }/children`
      : `/drives/${ driveId }/root/children`

    return this.#apiRequest({
      url: `${ GRAPH_BASE_URL }${ path }`,
      logTag: 'createFolder',
      method: 'post',
      body: {
        name: folderName,
        folder: {},
        '@microsoft.graph.conflictBehavior': conflictBehavior || 'fail',
      },
    })
  }

  /**
   * @operationName Upload File
   * @category Drives
   * @appearanceColor #038387 #4FC3C7
   * @description Uploads a file to a SharePoint document library by URL or text content. For files larger than 4 MB, prefer downloading first into FlowRunner Files. Files up to 4 MB are uploaded directly via Graph small-file upload.
   * @route POST /upload-file
   * @executionTimeoutInSeconds 300
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site."}
   * @paramDef {"type":"String","label":"Drive","name":"driveId","required":true,"dictionary":"getDrivesDictionary","dependsOn":["siteId"],"description":"The document library to upload to."}
   * @paramDef {"type":"String","label":"Parent Folder","name":"parentFolderId","dictionary":"getDriveItemsDictionary","dependsOn":["siteId","driveId"],"description":"Folder to upload into. Leave blank to upload at the drive root."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","required":true,"description":"Name of the file as it should appear in SharePoint."}
   * @paramDef {"type":"String","label":"Source URL","name":"sourceUrl","description":"Public URL to download the file from. Either Source URL or Content must be provided."}
   * @paramDef {"type":"String","label":"Content","name":"content","description":"Inline string content to upload. Used if Source URL is not provided."}
   * @paramDef {"type":"String","label":"Content Type","name":"contentType","description":"MIME type to upload as. Defaults to application/octet-stream when uploading inline content."}
   * @paramDef {"type":"String","label":"On Conflict","name":"conflictBehavior","uiComponent":{"type":"DROPDOWN","options":{"values":["Fail","Rename","Replace"]}},"description":"What to do if a file with this name already exists. Defaults to replace."}
   * @returns {Object}
   * @sampleResult {"id":"01ABC","name":"report.pdf","size":24576,"webUrl":"https://contoso.sharepoint.com/sites/marketing/Shared%20Documents/report.pdf"}
   */
  async uploadFile(siteId, driveId, parentFolderId, fileName, sourceUrl, content, contentType, conflictBehavior) {
    if (!siteId || !driveId || !fileName) {
      throw new Error('Parameters "Site", "Drive" and "File Name" are required')
    }

    if (!sourceUrl && content === undefined) {
      throw new Error('One of "Source URL" or "Content" must be provided')
    }

    if (sourceUrl && content !== undefined) {
      throw new Error('Provide either "Source URL" or "Content", not both')
    }

    let payload
    let mimeType

    if (sourceUrl) {
      try {
        payload = await Flowrunner.Request.get(sourceUrl).setEncoding(null)
      } catch (e) {
        logger.error(`uploadFile - failed to fetch source URL: ${ e.message }`)
        throw new Error(`Failed to fetch source URL: ${ e.message }`)
      }

      mimeType = contentType || 'application/octet-stream'
    } else {
      payload = content
      mimeType = contentType || 'text/plain'
    }

    conflictBehavior = this.#resolveChoice(conflictBehavior, { Fail: 'fail', Rename: 'rename', Replace: 'replace' })
    const conflict = conflictBehavior || 'replace'
    const encodedName = encodeURIComponent(fileName)

    const basePath = parentFolderId
      ? `/drives/${ driveId }/items/${ parentFolderId }:/${ encodedName }:/content`
      : `/drives/${ driveId }/root:/${ encodedName }:/content`

    const url = `${ GRAPH_BASE_URL }${ basePath }?@microsoft.graph.conflictBehavior=${ conflict }`

    try {
      logger.debug(`uploadFile - PUT ${ url }`)

      return await Flowrunner.Request.put(url)
        .set({
          ...this.#getAccessTokenHeader(),
          'Content-Type': mimeType,
        })
        .send(payload)
    } catch (error) {
      throw this.#normalizeError(error, 'uploadFile')
    }
  }

  /**
   * @operationName Download File
   * @category Drives
   * @appearanceColor #038387 #4FC3C7
   * @description Returns a short-lived download URL for a file. Use the URL to fetch file content directly. The URL is pre-authenticated and expires within minutes.
   * @route POST /download-file
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site."}
   * @paramDef {"type":"String","label":"Drive","name":"driveId","required":true,"dictionary":"getDrivesDictionary","dependsOn":["siteId"],"description":"The document library."}
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"getDriveItemsDictionary","dependsOn":["siteId","driveId"],"description":"The file to download."}
   * @returns {Object}
   * @sampleResult {"id":"01DEF","name":"report.pdf","downloadUrl":"https://contoso.sharepoint.com/_layouts/download.aspx?...","size":24576,"mimeType":"application/pdf"}
   */
  async downloadFile(siteId, driveId, itemId) {
    if (!siteId || !driveId || !itemId) {
      throw new Error('Parameters "Site", "Drive" and "Item" are required')
    }

    const item = await this.#apiRequest({
      url: `${ GRAPH_BASE_URL }/drives/${ driveId }/items/${ itemId }`,
      logTag: 'downloadFile',
      query: { $select: 'id,name,size,file,@microsoft.graph.downloadUrl' },
    })

    return {
      id: item.id,
      name: item.name,
      size: item.size,
      mimeType: item.file?.mimeType,
      downloadUrl: item['@microsoft.graph.downloadUrl'] || null,
    }
  }

  /**
   * @operationName Delete Drive Item
   * @category Drives
   * @appearanceColor #038387 #4FC3C7
   * @description Deletes a file or folder from a document library.
   * @route POST /delete-drive-item
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site."}
   * @paramDef {"type":"String","label":"Drive","name":"driveId","required":true,"dictionary":"getDrivesDictionary","dependsOn":["siteId"],"description":"The document library."}
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"getDriveItemsDictionary","dependsOn":["siteId","driveId"],"description":"The file or folder to delete."}
   * @returns {Object}
   * @sampleResult {"message":"Item deleted successfully"}
   */
  async deleteDriveItem(siteId, driveId, itemId) {
    if (!siteId || !driveId || !itemId) {
      throw new Error('Parameters "Site", "Drive" and "Item" are required')
    }

    await this.#apiRequest({
      url: `${ GRAPH_BASE_URL }/drives/${ driveId }/items/${ itemId }`,
      logTag: 'deleteDriveItem',
      method: 'delete',
    })

    return { message: 'Item deleted successfully' }
  }

  /**
   * @operationName Move Drive Item
   * @category Drives
   * @appearanceColor #038387 #4FC3C7
   * @description Moves a file or folder to a new parent folder within the same drive, optionally renaming it. Cross-drive moves are not supported by Microsoft Graph; use Copy Drive Item then Delete Drive Item to move between drives.
   * @route POST /move-drive-item
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site."}
   * @paramDef {"type":"String","label":"Drive","name":"driveId","required":true,"dictionary":"getDrivesDictionary","dependsOn":["siteId"],"description":"The document library."}
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"getDriveItemsDictionary","dependsOn":["siteId","driveId"],"description":"The file or folder to move."}
   * @paramDef {"type":"String","label":"New Parent Folder","name":"newParentFolderId","required":true,"dictionary":"getDriveItemsDictionary","dependsOn":["siteId","driveId"],"description":"Destination folder."}
   * @paramDef {"type":"String","label":"New Name","name":"newName","description":"Optional new name for the item."}
   * @returns {Object}
   * @sampleResult {"id":"01ABC","name":"renamed.pdf","parentReference":{"id":"01DEF"}}
   */
  async moveDriveItem(siteId, driveId, itemId, newParentFolderId, newName) {
    if (!siteId || !driveId || !itemId || !newParentFolderId) {
      throw new Error('Parameters "Site", "Drive", "Item" and "New Parent Folder" are required')
    }

    const body = {
      parentReference: { id: newParentFolderId },
    }

    if (newName) {
      body.name = newName
    }

    return this.#apiRequest({
      url: `${ GRAPH_BASE_URL }/drives/${ driveId }/items/${ itemId }`,
      logTag: 'moveDriveItem',
      method: 'patch',
      body: body,
    })
  }

  /**
   * @operationName Copy Drive Item
   * @category Drives
   * @appearanceColor #038387 #4FC3C7
   * @description Asynchronously copies a file or folder to a new location. The copy runs in the background and the request returns immediately. To verify completion, list the destination folder a few seconds later.
   * @route POST /copy-drive-item
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site."}
   * @paramDef {"type":"String","label":"Drive","name":"driveId","required":true,"dictionary":"getDrivesDictionary","dependsOn":["siteId"],"description":"The document library."}
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"getDriveItemsDictionary","dependsOn":["siteId","driveId"],"description":"The file or folder to copy."}
   * @paramDef {"type":"String","label":"Target Drive","name":"targetDriveId","required":true,"dictionary":"getDrivesDictionary","dependsOn":["siteId"],"description":"Destination drive."}
   * @paramDef {"type":"String","label":"Target Parent Folder","name":"targetParentFolderId","required":true,"dictionary":"getDriveItemsDictionary","dependsOn":["siteId","targetDriveId"],"description":"Destination folder."}
   * @paramDef {"type":"String","label":"New Name","name":"newName","description":"Optional new name for the copied item."}
   * @paramDef {"type":"String","label":"On Conflict","name":"conflictBehavior","uiComponent":{"type":"DROPDOWN","options":{"values":["Fail","Rename","Replace"]}},"description":"What to do if an item with this name already exists at the destination. Defaults to rename."}
   * @returns {Object}
   * @sampleResult {"status":"accepted"}
   */
  async copyDriveItem(siteId, driveId, itemId, targetDriveId, targetParentFolderId, newName, conflictBehavior) {
    if (!siteId || !driveId || !itemId || !targetDriveId || !targetParentFolderId) {
      throw new Error('Parameters "Site", "Drive", "Item", "Target Drive" and "Target Parent Folder" are required')
    }

    const body = {
      parentReference: {
        driveId: targetDriveId,
        id: targetParentFolderId,
      },
    }

    if (newName) {
      body.name = newName
    }

    conflictBehavior = this.#resolveChoice(conflictBehavior, { Fail: 'fail', Rename: 'rename', Replace: 'replace' })
    const conflict = conflictBehavior || 'rename'
    const url = `${ GRAPH_BASE_URL }/drives/${ driveId }/items/${ itemId }/copy?@microsoft.graph.conflictBehavior=${ conflict }`

    await this.#apiRequest({
      url,
      logTag: 'copyDriveItem',
      method: 'post',
      body: body,
    })

    return { status: 'accepted' }
  }

  /**
   * @operationName Create Sharing Link
   * @category Drives
   * @appearanceColor #038387 #4FC3C7
   * @description Creates a shareable link to a file or folder. Choose link type (view, edit, embed) and scope (anonymous, organization).
   * @route POST /create-sharing-link
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site."}
   * @paramDef {"type":"String","label":"Drive","name":"driveId","required":true,"dictionary":"getDrivesDictionary","dependsOn":["siteId"],"description":"The document library."}
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"getDriveItemsDictionary","dependsOn":["siteId","driveId"],"description":"The file or folder to share."}
   * @paramDef {"type":"String","label":"Link Type","name":"linkType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["View","Edit","Embed"]}},"description":"Type of permission granted by the link."}
   * @paramDef {"type":"String","label":"Scope","name":"scope","uiComponent":{"type":"DROPDOWN","options":{"values":["Anonymous","Organization"]}},"description":"Audience for the link. Defaults to organization."}
   * @paramDef {"type":"String","label":"Password","name":"password","description":"Optional password to protect the link. OneDrive Personal only — ignored on SharePoint and OneDrive for Business."}
   * @paramDef {"type":"String","label":"Expiration","name":"expirationDateTime","description":"ISO 8601 expiration timestamp for the link, e.g. 2026-12-31T23:59:00Z. Applies to any scope; subject to your organization's sharing policy."}
   * @returns {Object}
   * @sampleResult {"id":"abc","link":{"webUrl":"https://contoso.sharepoint.com/:b:/s/marketing/EabcXYZ","type":"view","scope":"organization"}}
   */
  async createSharingLink(siteId, driveId, itemId, linkType, scope, password, expirationDateTime) {
    if (!siteId || !driveId || !itemId || !linkType) {
      throw new Error('Parameters "Site", "Drive", "Item" and "Link Type" are required')
    }

    linkType = this.#resolveChoice(linkType, { View: 'view', Edit: 'edit', Embed: 'embed' })
    scope = this.#resolveChoice(scope, { Anonymous: 'anonymous', Organization: 'organization' })

    const resolvedScope = scope || 'organization'

    // Expiration is scope-independent and password is account-type-gated (OneDrive Personal only),
    // per the createLink docs — let Graph reject an unsupported combination rather than pre-blocking
    // valid ones (e.g. an expiring organization link).
    const body = {
      type: linkType,
      scope: resolvedScope,
    }

    if (password) {
      body.password = password
    }

    if (expirationDateTime) {
      body.expirationDateTime = expirationDateTime
    }

    return this.#apiRequest({
      url: `${ GRAPH_BASE_URL }/drives/${ driveId }/items/${ itemId }/createLink`,
      logTag: 'createSharingLink',
      method: 'post',
      body: body,
    })
  }

  /**
   * @operationName Rename Drive Item
   * @category Drives
   * @appearanceColor #038387 #4FC3C7
   * @description Renames a file or folder in place, keeping it in its current folder. To move an item to a different folder, use Move Drive Item instead.
   * @route POST /rename-drive-item
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site."}
   * @paramDef {"type":"String","label":"Drive","name":"driveId","required":true,"dictionary":"getDrivesDictionary","dependsOn":["siteId"],"description":"The document library."}
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"getDriveItemsDictionary","dependsOn":["siteId","driveId"],"description":"The file or folder to rename."}
   * @paramDef {"type":"String","label":"New Name","name":"newName","required":true,"description":"The new name for the item, including the file extension for files, e.g. Q1-report.pdf."}
   * @returns {Object}
   * @sampleResult {"id":"01NKDM7HMOJTVYMDOSXFDK2QJDXCDI3WUK","name":"Q1-report.pdf","file":{"mimeType":"application/pdf"},"webUrl":"https://contoso.sharepoint.com/sites/marketing/Shared%20Documents/Q1-report.pdf"}
   */
  async renameDriveItem(siteId, driveId, itemId, newName) {
    if (!siteId || !driveId || !itemId || !newName) {
      throw new Error('Parameters "Site", "Drive", "Item" and "New Name" are required')
    }

    return this.#apiRequest({
      url: `${ GRAPH_BASE_URL }/drives/${ driveId }/items/${ itemId }`,
      logTag: 'renameDriveItem',
      method: 'patch',
      body: { name: newName },
    })
  }

  /**
   * @operationName List Drive Item Versions
   * @category Drives
   * @appearanceColor #038387 #4FC3C7
   * @description Lists the version history of a file, newest first. Each version carries its ID, size, who last changed it, and when. Requires version history to be enabled on the library.
   * @route POST /list-drive-item-versions
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site."}
   * @paramDef {"type":"String","label":"Drive","name":"driveId","required":true,"dictionary":"getDrivesDictionary","dependsOn":["siteId"],"description":"The document library."}
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"getDriveItemsDictionary","dependsOn":["siteId","driveId"],"description":"The file whose version history to list."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"3.0","lastModifiedBy":{"user":{"id":"ce251278-ef9e-4fe5-833c-1d89eeae68e0","displayName":"John Smith"}},"lastModifiedDateTime":"2026-04-01T12:34:53.912Z","size":123}]}
   */
  async listDriveItemVersions(siteId, driveId, itemId) {
    if (!siteId || !driveId || !itemId) {
      throw new Error('Parameters "Site", "Drive" and "Item" are required')
    }

    return this.#apiRequest({
      url: `${ GRAPH_BASE_URL }/drives/${ driveId }/items/${ itemId }/versions`,
      logTag: 'listDriveItemVersions',
    })
  }

  /**
   * @operationName Create Upload Session
   * @category Drives
   * @appearanceColor #038387 #4FC3C7
   * @description Starts a resumable upload session for a large file (over 4 MB) and returns a pre-authenticated upload URL. Pass that URL to Upload Large File to stream the bytes. For files up to 4 MB use Upload File instead.
   * @route POST /create-upload-session
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site."}
   * @paramDef {"type":"String","label":"Drive","name":"driveId","required":true,"dictionary":"getDrivesDictionary","dependsOn":["siteId"],"description":"The document library to upload to."}
   * @paramDef {"type":"String","label":"Parent Folder","name":"parentFolderId","dictionary":"getDriveItemsDictionary","dependsOn":["siteId","driveId"],"description":"Folder to upload into. Leave blank to upload at the drive root."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","required":true,"description":"Name of the file as it should appear in SharePoint, e.g. archive.zip."}
   * @paramDef {"type":"String","label":"On Conflict","name":"conflictBehavior","uiComponent":{"type":"DROPDOWN","options":{"values":["Fail","Rename","Replace"]}},"description":"What to do if a file with this name already exists. Defaults to replace."}
   * @returns {Object}
   * @sampleResult {"uploadUrl":"https://contoso.sharepoint.com/_api/v2.0/drives/b!abc/items/01ABC/uploadSession?guid=xyz&overwrite=True","expirationDateTime":"2026-04-01T09:21:55.523Z"}
   */
  async createUploadSession(siteId, driveId, parentFolderId, fileName, conflictBehavior) {
    if (!siteId || !driveId || !fileName) {
      throw new Error('Parameters "Site", "Drive" and "File Name" are required')
    }

    conflictBehavior = this.#resolveChoice(conflictBehavior, { Fail: 'fail', Rename: 'rename', Replace: 'replace' })

    const encodedName = encodeURIComponent(fileName)

    const basePath = parentFolderId
      ? `/drives/${ driveId }/items/${ parentFolderId }:/${ encodedName }:/createUploadSession`
      : `/drives/${ driveId }/root:/${ encodedName }:/createUploadSession`

    return this.#apiRequest({
      url: `${ GRAPH_BASE_URL }${ basePath }`,
      logTag: 'createUploadSession',
      method: 'post',
      body: {
        item: {
          '@microsoft.graph.conflictBehavior': conflictBehavior || 'replace',
          name: fileName,
        },
      },
    })
  }

  /**
   * @operationName Upload Large File
   * @category Drives
   * @appearanceColor #038387 #4FC3C7
   * @description Uploads a larger file (over 4 MB) to SharePoint by sending it to an upload session in sequential chunks. First call Create Upload Session to get an upload URL, then pass that URL and the source file here. The whole file is loaded into memory before it is sent, so the practical size limit is the memory available to this function - keep files under a few hundred megabytes. For files up to 4 MB use Upload File instead.
   * @route POST /upload-large-file
   * @executionTimeoutInSeconds 900
   * @paramDef {"type":"String","label":"Upload URL","name":"uploadUrl","required":true,"description":"The pre-authenticated upload URL returned by Create Upload Session."}
   * @paramDef {"type":"String","label":"File","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"The file to upload (its URL). Its bytes are fetched into memory, then sent to SharePoint in chunks."}
   * @returns {Object}
   * @sampleResult {"id":"01ABC","name":"archive.zip","size":104857600,"file":{"mimeType":"application/zip"},"webUrl":"https://contoso.sharepoint.com/sites/marketing/Shared%20Documents/archive.zip"}
   */
  async uploadLargeFile(uploadUrl, fileUrl) {
    if (!uploadUrl) {
      throw new Error('Parameter "Upload URL" is required - call Create Upload Session first to obtain it')
    }

    if (!fileUrl) {
      throw new Error('Parameter "File" is required')
    }

    let buffer

    try {
      buffer = this.#toBuffer(await Flowrunner.Request.get(fileUrl).setEncoding(null))
    } catch (error) {
      logger.error(`uploadLargeFile - failed to fetch source file: ${ error.message }`)
      throw new Error(`Failed to fetch the source file: ${ error.message }`)
    }

    const total = buffer.length

    if (!total) {
      throw new Error('The source file is empty.')
    }

    let last

    try {
      // Stream the file in sequential byte ranges. The upload URL is pre-authenticated, so the PUTs
      // must NOT carry an Authorization header - a bearer token here makes Graph reject the chunk.
      for (let start = 0; start < total; start += UPLOAD_CHUNK_SIZE) {
        const end = Math.min(start + UPLOAD_CHUNK_SIZE, total)
        const chunk = buffer.subarray(start, end)

        logger.debug(`uploadLargeFile - PUT bytes ${ start }-${ end - 1 }/${ total }`)

        last = await Flowrunner.Request.put(uploadUrl)
          .set({
            'Content-Type': 'application/octet-stream',
            'Content-Range': `bytes ${ start }-${ end - 1 }/${ total }`,
          })
          .send(chunk)
      }
    } catch (error) {
      throw this.#normalizeError(error, 'uploadLargeFile')
    }

    // The response to the final byte range is the finished driveItem; earlier ranges return status.
    return last
  }

  // ============================================================
  // SEARCH
  // ============================================================

  /**
   * @operationName Search SharePoint
   * @category Search
   * @appearanceColor #038387 #4FC3C7
   * @description Searches across SharePoint content using Microsoft Graph search API. Supports searching sites, lists, list items, drives, and drive items.
   * @route POST /search
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Search query string. Supports KQL syntax (e.g., 'project AND status:active')."}
   * @paramDef {"type":"String","label":"Entity Types","name":"entityTypes","uiComponent":{"type":"DROPDOWN","options":{"values":["Drive Item","List Item","List","Site"]}},"description":"Type of entity to search. Defaults to driveItem."}
   * @paramDef {"type":"Number","label":"Size","name":"size","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of results to return. Defaults to 25, max 100."}
   * @paramDef {"type":"Number","label":"From","name":"from","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Offset to start at for pagination. Defaults to 0."}
   * @returns {Object}
   * @sampleResult {"value":[{"hitsContainers":[{"hits":[{"hitId":"01ABC","resource":{"name":"report.pdf","webUrl":"https://contoso.sharepoint.com/..."}}],"total":3}]}]}
   */
  async search(query, entityTypes, size, from) {
    if (!query) {
      throw new Error('Parameter "Query" is required')
    }

    entityTypes = this.#resolveChoice(entityTypes, { 'Drive Item': 'driveItem', 'List Item': 'listItem', List: 'list', Site: 'site' })

    const body = {
      requests: [
        {
          entityTypes: [entityTypes || 'driveItem'],
          query: { queryString: query },
          from: from ?? 0,
          size: Math.min(size ?? DEFAULT_LIST_TOP, 100),
        },
      ],
    }

    return this.#apiRequest({
      url: `${ GRAPH_BASE_URL }/search/query`,
      logTag: 'search',
      method: 'post',
      body: body,
    })
  }

  // ============================================================
  // POLLING TRIGGERS
  // ============================================================

  /**
   * @operationName On New List Item
   * @category Triggers
   * @description Triggers when a new item is added to a SharePoint list. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   * @route POST /on-new-list-item
   * @appearanceColor #f9566d #fb874b
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site to monitor."}
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["siteId"],"description":"The list to monitor for new items."}
   * @returns {Object}
   * @sampleResult {"id":"42","fields":{"Title":"Quarterly Report","Status":"Open"},"createdDateTime":"2026-04-01T10:00:00Z"}
   */
  async onNewListItem(invocation) {
    const { siteId, listId } = invocation.triggerData || {}

    if (!siteId || !listId) {
      throw new Error('Trigger requires "Site" and "List" parameters')
    }

    // Graph list items reject $orderby, so we can't fetch a "newest N" window. Instead we keep a
    // time high-water-mark and query items whose fields/Created is past it, paging to the tail -
    // this catches new items no matter how large the list grew (the old fixed oldest-100 window
    // never saw them).
    if (invocation.learningMode) {
      const sample = await this.#fetchOneListItem(siteId, listId)

      return { events: sample ? [sample] : [], state: null }
    }

    const state = invocation.state || {}
    const now = new Date().toISOString()

    if (!state.since) {
      // Seed: record recently created items so the first real poll's overlap doesn't replay them,
      // and emit nothing (no backlog dump).
      const seedFrom = new Date(Date.now() - POLL_OVERLAP_MS).toISOString()
      const seed = await this.#fetchListItemsSince(siteId, listId, 'Created', seedFrom)

      return { events: [], state: { since: now, seenIds: seed.map(item => item.id).slice(0, MAX_SEEN_IDS) } }
    }

    const windowStart = new Date(Date.parse(state.since) - POLL_OVERLAP_MS).toISOString()
    const items = await this.#fetchListItemsSince(siteId, listId, 'Created', windowStart)
    const seen = new Set(state.seenIds || [])
    const events = items.filter(item => !seen.has(item.id))
    const seenIds = [...items.map(item => item.id), ...(state.seenIds || [])].slice(0, MAX_SEEN_IDS)

    return { events, state: { since: now, seenIds } }
  }

  /**
   * @operationName On Updated List Item
   * @category Triggers
   * @description Triggers when an existing item in a SharePoint list is updated. Only items that existed on the previous poll are tracked; pair with "On New List Item" to capture newly created records.
   * @registerAs POLLING_TRIGGER
   * @route POST /on-updated-list-item
   * @appearanceColor #f9566d #fb874b
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site to monitor."}
   * @paramDef {"type":"String","label":"List","name":"listId","required":true,"dictionary":"getListsDictionary","dependsOn":["siteId"],"description":"The list to monitor for updates."}
   * @returns {Object}
   * @sampleResult {"id":"42","fields":{"Title":"Quarterly Report","Status":"Done"},"lastModifiedDateTime":"2026-04-01T11:00:00Z"}
   */
  async onUpdatedListItem(invocation) {
    const { siteId, listId } = invocation.triggerData || {}

    if (!siteId || !listId) {
      throw new Error('Trigger requires "Site" and "List" parameters')
    }

    // Same high-water-mark approach as On New List Item, watermarking fields/Modified so an update
    // to any item is caught regardless of list size. Dedupe on id+Modified so the overlap re-fetch
    // does not re-emit, while a second edit to the same item still fires.
    if (invocation.learningMode) {
      const sample = await this.#fetchOneListItem(siteId, listId)

      return { events: sample ? [sample] : [], state: null }
    }

    const state = invocation.state || {}
    const now = new Date().toISOString()

    if (!state.since) {
      const seedFrom = new Date(Date.now() - POLL_OVERLAP_MS).toISOString()
      const seed = await this.#fetchListItemsSince(siteId, listId, 'Modified', seedFrom)

      return { events: [], state: { since: now, seenIds: seed.map(modifiedKey).slice(0, MAX_SEEN_IDS) } }
    }

    const cutoff = Date.parse(state.since)
    const windowStart = new Date(cutoff - POLL_OVERLAP_MS).toISOString()
    const items = await this.#fetchListItemsSince(siteId, listId, 'Modified', windowStart)
    const seen = new Set(state.seenIds || [])
    // Only surface updates to items that existed before this poll; items created since the
    // watermark are brand-new and belong to On New List Item, not here.
    const events = items.filter(item => Date.parse(item.createdDateTime) < cutoff && !seen.has(modifiedKey(item)))
    const seenIds = [...items.map(modifiedKey), ...(state.seenIds || [])].slice(0, MAX_SEEN_IDS)

    return { events, state: { since: now, seenIds } }
  }

  /**
   * @operationName On New File
   * @category Triggers
   * @description Triggers when a new file is added to a folder in a SharePoint document library. Polling interval can be customized (minimum 30 seconds). Subfolders are not monitored.
   * @registerAs POLLING_TRIGGER
   * @route POST /on-new-file
   * @appearanceColor #f9566d #fb874b
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site to monitor."}
   * @paramDef {"type":"String","label":"Drive","name":"driveId","required":true,"dictionary":"getDrivesDictionary","dependsOn":["siteId"],"description":"The document library to monitor."}
   * @paramDef {"type":"String","label":"Folder","name":"folderId","dictionary":"getDriveItemsDictionary","dependsOn":["siteId","driveId"],"description":"Folder to watch. Leave blank to monitor the drive root."}
   * @returns {Object}
   * @sampleResult {"id":"01ABC","name":"new-report.pdf","file":{"mimeType":"application/pdf"},"size":24576,"createdDateTime":"2026-04-01T10:00:00Z"}
   */
  async onNewFile(invocation) {
    const { siteId, driveId, folderId } = invocation.triggerData || {}

    if (!siteId || !driveId) {
      throw new Error('Trigger requires "Site" and "Drive" parameters')
    }

    const files = await this.#fetchFolderFiles(driveId, folderId, 200)
    const fileIds = files.map(file => file.id)

    if (invocation.learningMode) {
      return {
        events: files.length ? [files[0]] : [],
        state: { fileIds },
      }
    }

    if (!invocation.state?.fileIds) {
      return {
        events: [],
        state: { fileIds },
      }
    }

    const prevIDs = new Set(invocation.state.fileIds)
    const newFiles = files.filter(file => !prevIDs.has(file.id))

    return {
      events: newFiles,
      state: { fileIds },
    }
  }

  /**
   * @operationName On File Updated
   * @category Triggers
   * @description Triggers when an existing file in a SharePoint folder is modified. Only files that existed on the previous poll are tracked; pair with "On New File" to capture new uploads. Polling interval can be customized (minimum 30 seconds). Subfolders are not monitored.
   * @registerAs POLLING_TRIGGER
   * @route POST /on-file-updated
   * @appearanceColor #f9566d #fb874b
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Site","name":"siteId","required":true,"dictionary":"getSitesDictionary","description":"The SharePoint site to monitor."}
   * @paramDef {"type":"String","label":"Drive","name":"driveId","required":true,"dictionary":"getDrivesDictionary","dependsOn":["siteId"],"description":"The document library to monitor."}
   * @paramDef {"type":"String","label":"Folder","name":"folderId","dictionary":"getDriveItemsDictionary","dependsOn":["siteId","driveId"],"description":"Folder to watch. Leave blank to monitor the drive root."}
   * @returns {Object}
   * @sampleResult {"id":"01ABC","name":"report.pdf","lastModifiedDateTime":"2026-04-01T11:00:00Z","size":24576}
   */
  async onFileUpdated(invocation) {
    const { siteId, driveId, folderId } = invocation.triggerData || {}

    if (!siteId || !driveId) {
      throw new Error('Trigger requires "Site" and "Drive" parameters')
    }

    const files = await this.#fetchFolderFiles(driveId, folderId, 200)
    const snapshot = files.map(file => ({
      id: file.id,
      lastModifiedDateTime: file.lastModifiedDateTime,
    }))

    if (invocation.learningMode) {
      return {
        events: files.length ? [files[0]] : [],
        state: { files: snapshot },
      }
    }

    if (!invocation.state?.files) {
      return {
        events: [],
        state: { files: snapshot },
      }
    }

    const prevMap = new Map(invocation.state.files.map(f => [f.id, f.lastModifiedDateTime]))
    const updated = files.filter(file => {
      const prev = prevMap.get(file.id)

      return prev !== undefined && prev !== file.lastModifiedDateTime
    })

    return {
      events: updated,
      state: { files: snapshot },
    }
  }

  // ============================================================
  // PRIVATE HELPERS
  // ============================================================

  // Fetch every list item whose fields/<field> is at or after sinceIso, paging to the tail. Graph
  // list items reject $orderby, so the time filter is how the poll windows onto new/updated items
  // instead of a fixed oldest-N page.
  async #fetchListItemsSince(siteId, listId, field, sinceIso) {
    const items = []
    let url = `${ GRAPH_BASE_URL }/sites/${ siteId }/lists/${ listId }/items`
    let query = {
      $expand: 'fields',
      $top: 50,
      $filter: `fields/${ field } ge '${ sinceIso }'`,
    }
    // Created/Modified aren't guaranteed to be indexed; this header lets the filter run anyway
    // (the same header Get List Items uses for ad-hoc filters). Sent on every page.
    const headers = { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' }

    while (url) {
      const response = await this.#apiRequest({
        url,
        query,
        headers,
        logTag: 'fetchListItemsSince',
      })

      if (Array.isArray(response.value)) {
        items.push(...response.value)
      }

      const nextUrl = response['@odata.nextLink'] || null

      if (!nextUrl || nextUrl === url) {
        break
      }

      url = nextUrl
      query = undefined
    }

    return items
  }

  // One item, for the learning-mode shape sample (any item exposes the same event shape).
  async #fetchOneListItem(siteId, listId) {
    const response = await this.#apiRequest({
      url: `${ GRAPH_BASE_URL }/sites/${ siteId }/lists/${ listId }/items`,
      query: {
        $expand: 'fields',
        $top: 1,
      },
      logTag: 'fetchOneListItem',
    })

    return (response.value || [])[0]
  }

  async #fetchFolderFiles(driveId, folderId, maxItems) {
    const files = []
    const path = folderId
      ? `/drives/${ driveId }/items/${ folderId }/children`
      : `/drives/${ driveId }/root/children`

    let url = `${ GRAPH_BASE_URL }${ path }`
    // children supports $orderby (list items don't): order newest-changed first so new uploads and
    // recent edits land inside the capped window even in a large folder - the default name order
    // would bury them past the cap.
    let query = {
      $top: 50,
      $orderby: 'lastModifiedDateTime desc',
    }

    while (url && files.length < maxItems) {
      const response = await this.#apiRequest({
        url,
        query,
        logTag: 'fetchFolderFiles',
      })

      if (Array.isArray(response.value)) {
        for (const item of response.value) {
          if (item.file) {
            files.push(item)
          }
        }
      }

      const nextUrl = response['@odata.nextLink'] || null

      if (nextUrl === url) {
        break
      }

      url = nextUrl
      query = undefined
    }

    return files.slice(0, maxItems)
  }
}

Flowrunner.ServerCode.addService(SharePointService, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: true,
    hint: 'Microsoft Entra ID Application (client) ID. Leave blank to use default.',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: true,
    hint: 'Microsoft Entra ID client secret. Leave blank to use default.',
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

// Dedupe key for the update trigger: an item re-fires only when its Modified timestamp advances,
// so a repeated edit is a new event while the overlap re-fetch of an unchanged item is not.
function modifiedKey(item) {
  return `${ item.id }|${ item.lastModifiedDateTime }`
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

function constructIdentityName(user) {
  if (!user) {
    return 'SharePoint Connection'
  }

  if (user.mail && user.displayName) {
    return `${ user.mail } (${ user.displayName })`
  }

  return user.mail || user.displayName || user.userPrincipalName || 'SharePoint Connection'
}
