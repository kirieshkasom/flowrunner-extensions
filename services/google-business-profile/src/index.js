'use strict'

const OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USER_INFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'

const ACCOUNT_MANAGEMENT_URL = 'https://mybusinessaccountmanagement.googleapis.com/v1'
const BUSINESS_INFORMATION_URL = 'https://mybusinessbusinessinformation.googleapis.com/v1'
const REVIEWS_URL = 'https://mybusiness.googleapis.com/v4'

const DEFAULT_SCOPE = 'https://www.googleapis.com/auth/business.manage'

// Business Information reads REQUIRE a readMask. Sensible default returned on every location read.
const DEFAULT_LOCATION_READ_MASK = 'name,title,storefrontAddress,phoneNumbers,websiteUri,regularHours,categories,metadata,latlng'

const logger = {
  info: (...args) => console.log('[Google Business Profile] info:', ...args),
  debug: (...args) => console.log('[Google Business Profile] debug:', ...args),
  error: (...args) => console.log('[Google Business Profile] error:', ...args),
  warn: (...args) => console.log('[Google Business Profile] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName Google Business Profile
 * @integrationIcon /icon.png
 **/
class GoogleBusinessProfileService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE
  }

  async #apiRequest({ url, method, body, query, logTag }) {
    method = (method || 'get').toLowerCase()

    if (query) {
      query = cleanupObject(query)
    }

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=[${ JSON.stringify(query) }]`)

      const request = Flowrunner.Request[method](url)
        .set(this.#getAccessTokenHeader())
        .query(query || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.error?.message || error.body?.message || error.message

      logger.error(`${ logTag } - failed (${ error.status || error.statusCode || '?' }): ${ message }`)

      throw new Error(`Google Business Profile API error: ${ message }`)
    }
  }

  #getAccessTokenHeader(accessToken) {
    return {
      Authorization: `Bearer ${ accessToken || this.request.headers['oauth-access-token'] }`,
      'Content-Type': 'application/json',
    }
  }

  // Accepts either a bare id ("123") or a full resource path ("accounts/123") and returns "accounts/123".
  #normalizeAccountName(accountId) {
    if (!accountId) return accountId

    return accountId.startsWith('accounts/') ? accountId : `accounts/${ accountId }`
  }

  // Accepts either a bare id ("456") or a full resource path ("locations/456") and returns "locations/456".
  #normalizeLocationName(locationId) {
    if (!locationId) return locationId

    return locationId.startsWith('locations/') ? locationId : `locations/${ locationId }`
  }

  // Extracts the bare id from a resource path or bare id (e.g. "accounts/123" -> "123").
  #bareId(value) {
    if (!value) return value

    const parts = String(value).split('/')

    return parts[parts.length - 1]
  }

  // ============================================ OAUTH ===============================================

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('scope', this.scopes)
    params.append('access_type', 'offline')
    params.append('prompt', 'consent')

    const connectionURL = `${ OAUTH_URL }?${ params.toString() }`

    logger.debug(`composed connectionURL: ${ connectionURL }`)

    return connectionURL
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   *
   * @property {String} token
   * @property {String} [refreshToken]
   * @property {Number} [expirationInSeconds]
   * @property {Object} [userData]
   * @property {Boolean} [overwrite]
   * @property {String} connectionIdentityName
   * @property {String} [connectionIdentityImageURL]
   */

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('code', callbackObject.code)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('grant_type', 'authorization_code')
    params.append('client_secret', this.clientSecret)
    params.append('access_type', 'offline')

    const codeExchangeResponse = await Flowrunner.Request.post(TOKEN_URL)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    logger.debug('[executeCallback] token exchange completed')

    let userData = {}
    let connectionIdentityName = 'Google Business Profile Account'
    let connectionIdentityImageURL = null

    try {
      userData = await Flowrunner.Request
        .get(USER_INFO_URL)
        .set(this.#getAccessTokenHeader(codeExchangeResponse.access_token))

      if (userData.name || userData.email) {
        connectionIdentityName = userData.name
          ? `${ userData.name } (${ userData.email })`
          : userData.email
      }

      connectionIdentityImageURL = userData.picture || null
    } catch (error) {
      logger.error(`[executeCallback] userInfo error: ${ error.message }`)
    }

    return {
      token: codeExchangeResponse.access_token,
      expirationInSeconds: codeExchangeResponse.expires_in,
      refreshToken: codeExchangeResponse.refresh_token,
      connectionIdentityName,
      connectionIdentityImageURL,
      overwrite: true,
      userData,
    }
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   *
   * @property {String} token
   * @property {Number} [expirationInSeconds]
   * @property {String} [refreshToken]
   */

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    try {
      const { access_token, expires_in } = await Flowrunner.Request.post(TOKEN_URL)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .query({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        })

      return {
        token: access_token,
        expirationInSeconds: expires_in,
      }
    } catch (error) {
      logger.error(`refreshToken error: ${ error.message }`)

      if (error.body?.error === 'invalid_grant') {
        throw new Error('Refresh token expired or invalid, please re-authenticate.')
      }

      throw error
    }
  }

  // ========================================== DICTIONARIES ===========================================

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
   * @typedef {Object} getAccountsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied locally to the account name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for retrieving the next page of accounts."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Accounts
   * @category Accounts
   * @description Lists Google Business Profile accounts the authenticated user can manage, for selection in dependent parameters. Returns each account's resource name (accounts/{accountId}) as the value.
   *
   * @route POST /get-accounts-dictionary
   *
   * @paramDef {"type":"getAccountsDictionary__payload","label":"Payload","name":"payload","description":"Optional search string and pagination cursor."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Acme Coffee","value":"accounts/106321000000000000000","note":"LOCATION_GROUP"}],"cursor":"CAEQAA"}
   */
  async getAccountsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getAccountsDictionary',
      url: `${ ACCOUNT_MANAGEMENT_URL }/accounts`,
      query: { pageSize: 20, pageToken: cursor },
    })

    const accounts = response.accounts || []
    const filtered = search
      ? searchFilter(accounts, ['accountName', 'name'], search)
      : accounts

    return {
      cursor: response.nextPageToken,
      items: filtered.map(account => ({
        label: account.accountName || account.name,
        value: account.name,
        note: account.type || 'Account',
      })),
    }
  }

  /**
   * @typedef {Object} getLocationsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Account","name":"accountId","required":true,"dictionary":"getAccountsDictionary","description":"Account whose locations should be listed. Full resource name (accounts/{accountId})."}
   */

  /**
   * @typedef {Object} getLocationsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter applied locally to the location title."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for retrieving the next page of locations."}
   * @paramDef {"type":"getLocationsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Dependent selection criteria; requires the parent account."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Locations
   * @category Locations
   * @description Lists locations under a selected account for use in dependent parameters. Returns each location's resource name (locations/{locationId}) as the value. Requires the parent account to be selected first.
   *
   * @route POST /get-locations-dictionary
   *
   * @paramDef {"type":"getLocationsDictionary__payload","label":"Payload","name":"payload","description":"Search string, pagination cursor, and the parent account criteria."}
   *
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Acme Coffee - Downtown","value":"locations/15343003000000000000","note":"+1 555-123-4567"}],"cursor":"CAEQAA"}
   */
  async getLocationsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const accountId = criteria?.accountId

    if (!accountId) {
      return { items: [] }
    }

    const accountName = this.#normalizeAccountName(accountId)

    const response = await this.#apiRequest({
      logTag: 'getLocationsDictionary',
      url: `${ BUSINESS_INFORMATION_URL }/${ accountName }/locations`,
      query: {
        readMask: 'name,title,storefrontAddress,phoneNumbers',
        pageSize: 100,
        pageToken: cursor,
      },
    })

    const locations = response.locations || []
    const filtered = search
      ? searchFilter(locations, ['title', 'name'], search)
      : locations

    return {
      cursor: response.nextPageToken,
      items: filtered.map(location => ({
        label: location.title || location.name,
        value: location.name,
        note: location.phoneNumbers?.primaryPhone || location.storefrontAddress?.locality || 'Location',
      })),
    }
  }

  // ============================================ ACCOUNTS =============================================

  /**
   * @description Lists all Google Business Profile accounts the authenticated user can access, including personal accounts and location groups (organizations). Returns each account's resource name, display name, type, role, and verification state. Supports pagination.
   *
   * @route GET /list-accounts
   * @operationName List Accounts
   * @category Accounts
   * @appearanceColor #4285f4 #34a853
   *
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of accounts to return per page (default 20, max 20)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous response's nextPageToken to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"accounts":[{"name":"accounts/106321000000000000000","accountName":"Acme Coffee","type":"LOCATION_GROUP","role":"OWNER","verificationState":"VERIFIED"}],"nextPageToken":"CAEQAA"}
   */
  async listAccounts(pageSize, pageToken) {
    return this.#apiRequest({
      logTag: 'listAccounts',
      url: `${ ACCOUNT_MANAGEMENT_URL }/accounts`,
      query: { pageSize: pageSize || undefined, pageToken: pageToken || undefined },
    })
  }

  /**
   * @description Retrieves a single Google Business Profile account by its resource name, returning its display name, type, role, and verification state. Accepts either a bare account id or a full resource name (accounts/{accountId}).
   *
   * @route GET /get-account
   * @operationName Get Account
   * @category Accounts
   * @appearanceColor #4285f4 #34a853
   *
   * @paramDef {"type":"String","label":"Account","name":"accountId","required":true,"dictionary":"getAccountsDictionary","description":"Account resource name (accounts/{accountId}) or bare account id."}
   *
   * @returns {Object}
   * @sampleResult {"name":"accounts/106321000000000000000","accountName":"Acme Coffee","type":"LOCATION_GROUP","role":"OWNER","verificationState":"VERIFIED"}
   */
  async getAccount(accountId) {
    if (!accountId) {
      throw new Error('"Account" is required')
    }

    return this.#apiRequest({
      logTag: 'getAccount',
      url: `${ ACCOUNT_MANAGEMENT_URL }/${ this.#normalizeAccountName(accountId) }`,
    })
  }

  // =========================================== LOCATIONS ============================================

  /**
   * @description Lists business locations under a specified account. A readMask is REQUIRED by the Business Information API and defaults to a sensible set (name, title, storefrontAddress, phoneNumbers) when not supplied. Supports server-side filtering, ordering, and pagination.
   *
   * @route GET /list-locations
   * @operationName List Locations
   * @category Locations
   * @appearanceColor #4285f4 #34a853
   *
   * @paramDef {"type":"String","label":"Account","name":"accountId","required":true,"dictionary":"getAccountsDictionary","description":"Parent account resource name (accounts/{accountId}) or bare account id."}
   * @paramDef {"type":"String","label":"Read Mask","name":"readMask","description":"Comma-separated location fields to return (e.g. name,title,storefrontAddress,phoneNumbers,websiteUri). Defaults to name,title,storefrontAddress,phoneNumbers."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of locations per page (default 10, max 100)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous response's nextPageToken."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Optional server-side filter expression, e.g. title=\"Acme\"."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Title (A-Z)","Title (Z-A)","Store Code (A-Z)","Store Code (Z-A)"]}},"description":"Sort order for the returned locations."}
   *
   * @returns {Object}
   * @sampleResult {"locations":[{"name":"locations/15343003000000000000","title":"Acme Coffee - Downtown","storefrontAddress":{"locality":"Austin"},"phoneNumbers":{"primaryPhone":"+1 555-123-4567"}}],"totalSize":1,"nextPageToken":"CAEQAA"}
   */
  async listLocations(accountId, readMask, pageSize, pageToken, filter, orderBy) {
    if (!accountId) {
      throw new Error('"Account" is required')
    }

    const resolvedOrderBy = this.#resolveChoice(orderBy, {
      'Title (A-Z)': 'title',
      'Title (Z-A)': 'title desc',
      'Store Code (A-Z)': 'storeCode',
      'Store Code (Z-A)': 'storeCode desc',
    })

    return this.#apiRequest({
      logTag: 'listLocations',
      url: `${ BUSINESS_INFORMATION_URL }/${ this.#normalizeAccountName(accountId) }/locations`,
      query: {
        readMask: readMask || 'name,title,storefrontAddress,phoneNumbers',
        pageSize: pageSize || undefined,
        pageToken: pageToken || undefined,
        filter: filter || undefined,
        orderBy: resolvedOrderBy,
      },
    })
  }

  /**
   * @description Retrieves the full details of a single business location. A readMask is REQUIRED by the Business Information API; when omitted, a comprehensive default mask is applied. Accepts a bare location id or a full resource name (locations/{locationId}).
   *
   * @route GET /get-location
   * @operationName Get Location
   * @category Locations
   * @appearanceColor #4285f4 #34a853
   *
   * @paramDef {"type":"String","label":"Location","name":"locationName","required":true,"description":"Location resource name (locations/{locationId}) or bare location id."}
   * @paramDef {"type":"String","label":"Read Mask","name":"readMask","description":"Comma-separated location fields to return. Defaults to a comprehensive set including name, title, storefrontAddress, phoneNumbers, websiteUri, regularHours, categories, and metadata."}
   *
   * @returns {Object}
   * @sampleResult {"name":"locations/15343003000000000000","title":"Acme Coffee - Downtown","storefrontAddress":{"addressLines":["123 Main St"],"locality":"Austin","regionCode":"US"},"phoneNumbers":{"primaryPhone":"+1 555-123-4567"},"websiteUri":"https://acme.example.com"}
   */
  async getLocation(locationName, readMask) {
    if (!locationName) {
      throw new Error('"Location" is required')
    }

    return this.#apiRequest({
      logTag: 'getLocation',
      url: `${ BUSINESS_INFORMATION_URL }/${ this.#normalizeLocationName(locationName) }`,
      query: { readMask: readMask || DEFAULT_LOCATION_READ_MASK },
    })
  }

  /**
   * @description Updates fields on a business location. An updateMask is REQUIRED and must list exactly the fields being changed (e.g. title,phoneNumbers,websiteUri); only those fields in the provided location object are applied. Accepts a bare location id or a full resource name (locations/{locationId}).
   *
   * @route PATCH /update-location
   * @operationName Update Location
   * @category Locations
   * @appearanceColor #4285f4 #34a853
   *
   * @paramDef {"type":"String","label":"Location","name":"locationName","required":true,"description":"Location resource name (locations/{locationId}) or bare location id."}
   * @paramDef {"type":"String","label":"Update Mask","name":"updateMask","required":true,"description":"Comma-separated list of fields to update, e.g. title,phoneNumbers,websiteUri,regularHours. Only these fields are modified."}
   * @paramDef {"type":"Object","label":"Location","name":"location","required":true,"description":"The location object containing the new field values (only fields named in the update mask are applied), e.g. {\"title\":\"Acme Coffee - Uptown\",\"websiteUri\":\"https://acme.example.com\"}."}
   * @paramDef {"type":"Boolean","label":"Validate Only","name":"validateOnly","uiComponent":{"type":"TOGGLE"},"description":"If true, validates the request without persisting changes. Default false."}
   *
   * @returns {Object}
   * @sampleResult {"name":"locations/15343003000000000000","title":"Acme Coffee - Uptown","websiteUri":"https://acme.example.com"}
   */
  async updateLocation(locationName, updateMask, location, validateOnly) {
    if (!locationName) {
      throw new Error('"Location" is required')
    }

    if (!updateMask) {
      throw new Error('"Update Mask" is required')
    }

    if (!location || typeof location !== 'object') {
      throw new Error('"Location" object is required')
    }

    return this.#apiRequest({
      logTag: 'updateLocation',
      method: 'patch',
      url: `${ BUSINESS_INFORMATION_URL }/${ this.#normalizeLocationName(locationName) }`,
      query: { updateMask, validateOnly: validateOnly === true ? true : undefined },
      body: location,
    })
  }

  // ============================================ REVIEWS =============================================

  /**
   * @description Lists customer reviews for a business location using the legacy Business Profile v4 API, including star rating, reviewer, comment, and any existing owner reply. Returns the location's average rating and total review count. Supports ordering and pagination (max 50 per page).
   *
   * @route GET /list-reviews
   * @operationName List Reviews
   * @category Reviews
   * @appearanceColor #4285f4 #34a853
   *
   * @paramDef {"type":"String","label":"Account","name":"accountId","required":true,"dictionary":"getAccountsDictionary","description":"Parent account resource name (accounts/{accountId}) or bare account id."}
   * @paramDef {"type":"String","label":"Location","name":"locationId","required":true,"dictionary":"getLocationsDictionary","description":"Location resource name (locations/{locationId}) or bare location id."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Newest","Highest Rating","Lowest Rating"]}},"description":"Sort order for the returned reviews. Defaults to Newest."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of reviews per page (max 50)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous response's nextPageToken."}
   *
   * @returns {Object}
   * @sampleResult {"reviews":[{"name":"accounts/106/locations/153/reviews/abc","reviewId":"abc","reviewer":{"displayName":"Jane D."},"starRating":"FIVE","comment":"Great coffee!","createTime":"2026-01-05T10:00:00Z","reviewReply":{"comment":"Thanks Jane!","updateTime":"2026-01-06T09:00:00Z"}}],"averageRating":4.7,"totalReviewCount":128,"nextPageToken":"CAEQAA"}
   */
  async listReviews(accountId, locationId, orderBy, pageSize, pageToken) {
    if (!accountId) {
      throw new Error('"Account" is required')
    }

    if (!locationId) {
      throw new Error('"Location" is required')
    }

    const resolvedOrderBy = this.#resolveChoice(orderBy, {
      'Newest': 'updateTime desc',
      'Highest Rating': 'rating desc',
      'Lowest Rating': 'rating',
    })

    return this.#apiRequest({
      logTag: 'listReviews',
      url: `${ REVIEWS_URL }/accounts/${ this.#bareId(accountId) }/locations/${ this.#bareId(locationId) }/reviews`,
      query: {
        orderBy: resolvedOrderBy || 'updateTime desc',
        pageSize: pageSize || undefined,
        pageToken: pageToken || undefined,
      },
    })
  }

  /**
   * @description Retrieves a single customer review for a location by its review id, including the star rating, reviewer, comment, and any existing owner reply. Uses the legacy Business Profile v4 API.
   *
   * @route GET /get-review
   * @operationName Get Review
   * @category Reviews
   * @appearanceColor #4285f4 #34a853
   *
   * @paramDef {"type":"String","label":"Account","name":"accountId","required":true,"dictionary":"getAccountsDictionary","description":"Parent account resource name (accounts/{accountId}) or bare account id."}
   * @paramDef {"type":"String","label":"Location","name":"locationId","required":true,"dictionary":"getLocationsDictionary","description":"Location resource name (locations/{locationId}) or bare location id."}
   * @paramDef {"type":"String","label":"Review ID","name":"reviewId","required":true,"description":"The unique identifier of the review to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"name":"accounts/106/locations/153/reviews/abc","reviewId":"abc","reviewer":{"displayName":"Jane D."},"starRating":"FIVE","comment":"Great coffee!","createTime":"2026-01-05T10:00:00Z"}
   */
  async getReview(accountId, locationId, reviewId) {
    if (!accountId) {
      throw new Error('"Account" is required')
    }

    if (!locationId) {
      throw new Error('"Location" is required')
    }

    if (!reviewId) {
      throw new Error('"Review ID" is required')
    }

    return this.#apiRequest({
      logTag: 'getReview',
      url: `${ REVIEWS_URL }/accounts/${ this.#bareId(accountId) }/locations/${ this.#bareId(locationId) }/reviews/${ this.#bareId(reviewId) }`,
    })
  }

  /**
   * @description Creates or updates the business owner's public reply to a customer review. Calling this on a review that already has a reply overwrites the existing reply. Uses the legacy Business Profile v4 API.
   *
   * @route PUT /reply-to-review
   * @operationName Reply To Review
   * @category Reviews
   * @appearanceColor #4285f4 #34a853
   *
   * @paramDef {"type":"String","label":"Account","name":"accountId","required":true,"dictionary":"getAccountsDictionary","description":"Parent account resource name (accounts/{accountId}) or bare account id."}
   * @paramDef {"type":"String","label":"Location","name":"locationId","required":true,"dictionary":"getLocationsDictionary","description":"Location resource name (locations/{locationId}) or bare location id."}
   * @paramDef {"type":"String","label":"Review ID","name":"reviewId","required":true,"description":"The unique identifier of the review to reply to."}
   * @paramDef {"type":"String","label":"Comment","name":"comment","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The reply text to publish under the review."}
   *
   * @returns {Object}
   * @sampleResult {"comment":"Thanks Jane, see you soon!","updateTime":"2026-01-06T09:00:00Z"}
   */
  async replyToReview(accountId, locationId, reviewId, comment) {
    if (!accountId) {
      throw new Error('"Account" is required')
    }

    if (!locationId) {
      throw new Error('"Location" is required')
    }

    if (!reviewId) {
      throw new Error('"Review ID" is required')
    }

    if (!comment) {
      throw new Error('"Comment" is required')
    }

    return this.#apiRequest({
      logTag: 'replyToReview',
      method: 'put',
      url: `${ REVIEWS_URL }/accounts/${ this.#bareId(accountId) }/locations/${ this.#bareId(locationId) }/reviews/${ this.#bareId(reviewId) }/reply`,
      body: { comment },
    })
  }

  /**
   * @description Deletes the business owner's reply to a customer review, removing the public response. The review itself is not affected. Uses the legacy Business Profile v4 API.
   *
   * @route DELETE /delete-review-reply
   * @operationName Delete Review Reply
   * @category Reviews
   * @appearanceColor #4285f4 #34a853
   *
   * @paramDef {"type":"String","label":"Account","name":"accountId","required":true,"dictionary":"getAccountsDictionary","description":"Parent account resource name (accounts/{accountId}) or bare account id."}
   * @paramDef {"type":"String","label":"Location","name":"locationId","required":true,"dictionary":"getLocationsDictionary","description":"Location resource name (locations/{locationId}) or bare location id."}
   * @paramDef {"type":"String","label":"Review ID","name":"reviewId","required":true,"description":"The unique identifier of the review whose reply should be deleted."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"reviewId":"abc"}
   */
  async deleteReviewReply(accountId, locationId, reviewId) {
    if (!accountId) {
      throw new Error('"Account" is required')
    }

    if (!locationId) {
      throw new Error('"Location" is required')
    }

    if (!reviewId) {
      throw new Error('"Review ID" is required')
    }

    await this.#apiRequest({
      logTag: 'deleteReviewReply',
      method: 'delete',
      url: `${ REVIEWS_URL }/accounts/${ this.#bareId(accountId) }/locations/${ this.#bareId(locationId) }/reviews/${ this.#bareId(reviewId) }/reply`,
    })

    return { success: true, reviewId: this.#bareId(reviewId) }
  }

  /**
   * @description Retrieves reviews across multiple locations of an account in a single batch call using the legacy Business Profile v4 API. Accepts up to 10 location ids and returns the reviews for each, along with per-location average rating and total review count.
   *
   * @route POST /batch-get-reviews
   * @operationName Batch Get Reviews
   * @category Reviews
   * @appearanceColor #4285f4 #34a853
   *
   * @paramDef {"type":"String","label":"Account","name":"accountId","required":true,"dictionary":"getAccountsDictionary","description":"Parent account resource name (accounts/{accountId}) or bare account id."}
   * @paramDef {"type":"Array<String>","label":"Location Names","name":"locationNames","required":true,"description":"Location resource names (locations/{locationId}) or bare location ids to fetch reviews for (max 10)."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Newest","Highest Rating","Lowest Rating"]}},"description":"Sort order for the returned reviews. Defaults to Newest."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of reviews per location (max 50)."}
   *
   * @returns {Object}
   * @sampleResult {"locationReviews":[{"name":"accounts/106/locations/153","review":{"reviewId":"abc","starRating":"FIVE","comment":"Great coffee!"}}]}
   */
  async batchGetReviews(accountId, locationNames, orderBy, pageSize) {
    if (!accountId) {
      throw new Error('"Account" is required')
    }

    if (!Array.isArray(locationNames) || locationNames.length === 0) {
      throw new Error('"Location Names" must be a non-empty array')
    }

    const resolvedOrderBy = this.#resolveChoice(orderBy, {
      'Newest': 'updateTime desc',
      'Highest Rating': 'rating desc',
      'Lowest Rating': 'rating',
    })

    return this.#apiRequest({
      logTag: 'batchGetReviews',
      method: 'post',
      url: `${ REVIEWS_URL }/accounts/${ this.#bareId(accountId) }/locations:batchGetReviews`,
      body: {
        locationNames: locationNames.map(name => this.#normalizeLocationName(name)),
        pageSize: pageSize || undefined,
        orderBy: resolvedOrderBy || 'updateTime desc',
      },
    })
  }

  // ============================================= MEDIA =============================================

  /**
   * @description Lists the photos and videos associated with a business location (owner and customer media) using the legacy Business Profile v4 API. Returns media items with their URLs, category, and metadata. Supports pagination.
   *
   * @route GET /list-location-media
   * @operationName List Location Media
   * @category Media
   * @appearanceColor #4285f4 #34a853
   *
   * @paramDef {"type":"String","label":"Account","name":"accountId","required":true,"dictionary":"getAccountsDictionary","description":"Parent account resource name (accounts/{accountId}) or bare account id."}
   * @paramDef {"type":"String","label":"Location","name":"locationId","required":true,"dictionary":"getLocationsDictionary","description":"Location resource name (locations/{locationId}) or bare location id."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of media items per page."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous response's nextPageToken."}
   *
   * @returns {Object}
   * @sampleResult {"mediaItems":[{"name":"accounts/106/locations/153/media/xyz","mediaFormat":"PHOTO","locationAssociation":{"category":"COVER"},"googleUrl":"https://lh3.googleusercontent.com/xyz"}],"totalMediaItemCount":42,"nextPageToken":"CAEQAA"}
   */
  async listLocationMedia(accountId, locationId, pageSize, pageToken) {
    if (!accountId) {
      throw new Error('"Account" is required')
    }

    if (!locationId) {
      throw new Error('"Location" is required')
    }

    return this.#apiRequest({
      logTag: 'listLocationMedia',
      url: `${ REVIEWS_URL }/accounts/${ this.#bareId(accountId) }/locations/${ this.#bareId(locationId) }/media`,
      query: { pageSize: pageSize || undefined, pageToken: pageToken || undefined },
    })
  }

  // ============================================ HELPERS ============================================

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }
}

Flowrunner.ServerCode.addService(GoogleBusinessProfileService, [
  {
    displayName: 'Client Id',
    defaultValue: '',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your OAuth 2.0 Client ID from the Google Cloud Console (used for authentication requests).',
  },
  {
    displayName: 'Client Secret',
    defaultValue: '',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your OAuth 2.0 Client Secret from the Google Cloud Console (required for secure authentication).',
  },
])

function cleanupObject(data) {
  const result = {}

  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null) {
      result[key] = data[key]
    }
  })

  return result
}

function searchFilter(list, props, searchString) {
  return list.filter(item =>
    props.some(prop => {
      const value = prop.split('.').reduce((acc, key) => acc?.[key], item)

      return value && String(value).toLowerCase().includes(searchString.toLowerCase())
    })
  )
}
