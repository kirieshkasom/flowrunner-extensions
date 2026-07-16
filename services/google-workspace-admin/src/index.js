'use strict'

const API_BASE_URL = 'https://admin.googleapis.com/admin/directory/v1'
const OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USER_INFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'

// Alias for the authenticated administrator's own account. Every Directory API
// endpoint that requires a customer id accepts this value in place of the real id.
const MY_CUSTOMER = 'my_customer'

const DEFAULT_PAGE_SIZE = 100
const DICTIONARY_PAGE_SIZE = 50

const DEFAULT_SCOPE_LIST = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/admin.directory.user',
  'https://www.googleapis.com/auth/admin.directory.group',
  'https://www.googleapis.com/auth/admin.directory.group.member',
  'https://www.googleapis.com/auth/admin.directory.orgunit',
  'https://www.googleapis.com/auth/admin.directory.domain.readonly',
  'https://www.googleapis.com/auth/admin.directory.rolemanagement.readonly',
  'https://www.googleapis.com/auth/admin.directory.device.mobile.readonly',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const logger = {
  info: (...args) => console.log('[Google Workspace Admin] info:', ...args),
  debug: (...args) => console.log('[Google Workspace Admin] debug:', ...args),
  error: (...args) => console.log('[Google Workspace Admin] error:', ...args),
  warn: (...args) => console.log('[Google Workspace Admin] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName Google Workspace Admin
 * @integrationIcon /icon.png
 **/
class GoogleWorkspaceAdminService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  #getAccessTokenHeader(accessToken) {
    return {
      Authorization: `Bearer ${ accessToken || this.request.headers['oauth-access-token'] }`,
      'Content-Type': 'application/json',
    }
  }

  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'
    query = cleanupObject(query)

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      const request = Flowrunner.Request[method](url)
        .set(this.#getAccessTokenHeader())
        .query(query)

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const apiError = error.body?.error
      const reason = apiError?.errors?.[0]?.reason
      const message = apiError?.message || error.message
      const status = error.status || error.statusCode || ''
      const reasonPart = reason ? ` (${ reason })` : ''

      logger.error(`${ logTag } - error [${ status }]: ${ message }${ reasonPart }`)

      throw new Error(`Google Workspace Admin API error: ${ message }${ reasonPart }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // ============================================== OAUTH =============================================

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
    params.append('client_secret', this.clientSecret)
    params.append('code', callbackObject.code)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('grant_type', 'authorization_code')
    params.append('access_type', 'offline')

    const codeExchangeResponse = await Flowrunner.Request.post(TOKEN_URL)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    let userData = {}
    let connectionIdentityName = 'Google Workspace Admin Account'
    let connectionIdentityImageURL = null

    try {
      userData = await Flowrunner.Request
        .get(USER_INFO_URL)
        .set({ Authorization: `Bearer ${ codeExchangeResponse.access_token }` })

      logger.debug(`[executeCallback] userInfo: ${ JSON.stringify(userData) }`)

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

  // =========================================== DICTIONARIES =========================================

  /**
   * @typedef {Object} getUsersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter users. Matches against name and email using the Directory API query syntax."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token (nextPageToken) for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Users Dictionary
   * @description Provides a searchable list of Google Workspace users for dynamic parameter selection. Each entry maps a user's full name to their primary email address (used as the userKey). Searches across name and email fields within the authenticated administrator's account.
   * @route POST /get-users-dictionary
   * @paramDef {"type":"getUsersDictionary__payload","label":"Payload","name":"payload","description":"Contains an optional search string and pagination cursor for retrieving and filtering users."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Liz Smith","value":"liz@example.com","note":"liz@example.com"}],"cursor":"tokenABC"}
   */
  async getUsersDictionary(payload) {
    const { search, cursor } = payload || {}

    const query = {
      customer: MY_CUSTOMER,
      maxResults: DICTIONARY_PAGE_SIZE,
      pageToken: cursor,
      orderBy: 'email',
    }

    if (search) {
      // Directory API prefix-matches name and email fields with this query form.
      query.query = `name:${ search }* email:${ search }*`
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/users`,
      query,
      logTag: 'getUsersDictionary',
    })

    return {
      cursor: response.nextPageToken || null,
      items: (response.users || []).map(user => ({
        label: user.name?.fullName || user.primaryEmail,
        note: user.primaryEmail,
        value: user.primaryEmail,
      })),
    }
  }

  /**
   * @typedef {Object} getGroupsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter groups by name or email. Matching is performed locally on the retrieved page of results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token (nextPageToken) for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Groups Dictionary
   * @description Provides a searchable list of Google Workspace groups for dynamic parameter selection. Each entry maps a group's name to its email address (used as the groupKey). Lists groups within the authenticated administrator's account.
   * @route POST /get-groups-dictionary
   * @paramDef {"type":"getGroupsDictionary__payload","label":"Payload","name":"payload","description":"Contains an optional search string and pagination cursor for retrieving and filtering groups."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Sales Team","value":"sales@example.com","note":"sales@example.com"}],"cursor":"tokenABC"}
   */
  async getGroupsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/groups`,
      query: {
        customer: MY_CUSTOMER,
        maxResults: DICTIONARY_PAGE_SIZE,
        pageToken: cursor,
      },
      logTag: 'getGroupsDictionary',
    })

    const groups = response.groups || []
    const filtered = search
      ? searchFilter(groups, ['name', 'email'], search)
      : groups

    return {
      cursor: response.nextPageToken || null,
      items: filtered.map(group => ({
        label: group.name || group.email,
        note: group.email,
        value: group.email,
      })),
    }
  }

  // ============================================== USERS =============================================

  /**
   * @operationName List Users
   * @category Users
   * @appearanceColor #1a73e8 #34a853
   * @description Retrieves users from the Google Workspace account. Supports domain filtering, a search query, sorting, and result limiting. The customer is fixed to the authenticated administrator's own account (my_customer). Returns a paginated list; follow the nextPageToken value using the Page Token parameter to retrieve additional pages.
   * @route GET /list-users
   * @paramDef {"type":"String","label":"Domain","name":"domain","description":"Optional domain name to restrict results to a single domain, for example: example.com. Leave empty to search all domains in the account."}
   * @paramDef {"type":"String","label":"Search Query","name":"query","description":"Optional search query using Directory API syntax, for example: email:sales* or orgName='Engineering' or isAdmin=true."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of users to return per page. Defaults to 100. The API allows up to 500."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Email","Family Name","Given Name"]}},"description":"Property used to sort the results. Defaults to Email."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Direction of the sort. Defaults to Ascending."}
   * @paramDef {"type":"Boolean","label":"Show Deleted","name":"showDeleted","uiComponent":{"type":"TOGGLE"},"description":"When enabled, returns recently deleted users instead of active users. Deleted users can be restored with Undelete User within 20 days."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"The nextPageToken value from a previous response, used to retrieve the next page of results."}
   * @returns {Object}
   * @sampleResult {"kind":"admin#directory#users","users":[{"id":"1234567890","primaryEmail":"liz@example.com","name":{"givenName":"Liz","familyName":"Smith","fullName":"Liz Smith"},"suspended":false,"isAdmin":false}],"nextPageToken":"tokenABC"}
   */
  async listUsers(domain, query, maxResults, orderBy, sortOrder, showDeleted, pageToken) {
    const resolvedOrderBy = this.#resolveChoice(orderBy, {
      'Email': 'EMAIL',
      'Family Name': 'FAMILY_NAME',
      'Given Name': 'GIVEN_NAME',
    })

    const resolvedSortOrder = this.#resolveChoice(sortOrder, {
      'Ascending': 'ASCENDING',
      'Descending': 'DESCENDING',
    })

    return this.#apiRequest({
      url: `${ API_BASE_URL }/users`,
      query: {
        customer: MY_CUSTOMER,
        domain,
        query,
        maxResults: maxResults ? Math.min(maxResults, 500) : DEFAULT_PAGE_SIZE,
        orderBy: resolvedOrderBy,
        sortOrder: resolvedSortOrder,
        showDeleted: showDeleted ? 'true' : undefined,
        pageToken,
      },
      logTag: 'listUsers',
    })
  }

  /**
   * @operationName Get User
   * @category Users
   * @appearanceColor #1a73e8 #34a853
   * @description Retrieves a single user by their primary email address or unique user id (the userKey). Returns the full user resource including name, organizational unit, aliases, and administrative status.
   * @route GET /get-user
   * @paramDef {"type":"String","label":"User","name":"userKey","required":true,"dictionary":"getUsersDictionary","description":"The user's primary email address or unique id. Choose a user or paste an email or id."}
   * @returns {Object}
   * @sampleResult {"id":"1234567890","primaryEmail":"liz@example.com","name":{"givenName":"Liz","familyName":"Smith","fullName":"Liz Smith"},"isAdmin":false,"suspended":false,"orgUnitPath":"/Sales"}
   */
  async getUser(userKey) {
    if (!userKey) {
      throw new Error('Parameter "User" is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/users/${ encodeURIComponent(userKey) }`,
      logTag: 'getUser',
    })
  }

  /**
   * @operationName Create User
   * @category Users
   * @appearanceColor #1a73e8 #34a853
   * @description Creates a new user in the Google Workspace account. Requires a primary email (whose domain must be a verified domain in the account), given and family names, and an initial password. Optionally place the user in an organizational unit and require a password change at first sign-in.
   * @route POST /create-user
   * @paramDef {"type":"String","label":"Primary Email","name":"primaryEmail","required":true,"description":"The user's sign-in address, for example: liz@example.com. The domain must be a verified domain in the account."}
   * @paramDef {"type":"String","label":"Given Name","name":"givenName","required":true,"description":"The user's first name, for example: Liz."}
   * @paramDef {"type":"String","label":"Family Name","name":"familyName","required":true,"description":"The user's last name, for example: Smith."}
   * @paramDef {"type":"String","label":"Password","name":"password","required":true,"description":"The initial password for the user. Must be at least 8 characters and meet the account's password policy."}
   * @paramDef {"type":"String","label":"Org Unit Path","name":"orgUnitPath","description":"Optional organizational unit to place the user in, for example: /Sales/Marketing. Defaults to the root org unit (/)."}
   * @paramDef {"type":"Boolean","label":"Change Password At Next Login","name":"changePasswordAtNextLogin","uiComponent":{"type":"TOGGLE"},"description":"Whether the user must change their password at the next sign-in. Defaults to false."}
   * @returns {Object}
   * @sampleResult {"id":"1234567890","primaryEmail":"liz@example.com","name":{"givenName":"Liz","familyName":"Smith"},"orgUnitPath":"/Sales","isAdmin":false}
   */
  async createUser(primaryEmail, givenName, familyName, password, orgUnitPath, changePasswordAtNextLogin) {
    if (!primaryEmail) {
      throw new Error('Parameter "Primary Email" is required')
    }

    if (!givenName) {
      throw new Error('Parameter "Given Name" is required')
    }

    if (!familyName) {
      throw new Error('Parameter "Family Name" is required')
    }

    if (!password) {
      throw new Error('Parameter "Password" is required')
    }

    const body = cleanupObject({
      primaryEmail,
      name: { givenName, familyName },
      password,
      orgUnitPath,
      changePasswordAtNextLogin: changePasswordAtNextLogin === undefined ? undefined : changePasswordAtNextLogin,
    })

    return this.#apiRequest({
      url: `${ API_BASE_URL }/users`,
      logTag: 'createUser',
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Update User
   * @category Users
   * @appearanceColor #1a73e8 #34a853
   * @description Updates writable properties of an existing user, such as their name, primary email, organizational unit, or password. Only the fields you provide are changed. Returns the updated user resource.
   * @route PUT /update-user
   * @paramDef {"type":"String","label":"User","name":"userKey","required":true,"dictionary":"getUsersDictionary","description":"The user's primary email address or unique id. Choose a user or paste an email or id."}
   * @paramDef {"type":"String","label":"Primary Email","name":"primaryEmail","description":"An updated primary email address. Changing this renames the user's account; the previous address becomes an alias."}
   * @paramDef {"type":"String","label":"Given Name","name":"givenName","description":"An updated first name for the user."}
   * @paramDef {"type":"String","label":"Family Name","name":"familyName","description":"An updated last name for the user."}
   * @paramDef {"type":"String","label":"Password","name":"password","description":"An updated password for the user. Must meet the account's password policy."}
   * @paramDef {"type":"String","label":"Org Unit Path","name":"orgUnitPath","description":"Move the user to a different organizational unit, for example: /Sales/Marketing."}
   * @returns {Object}
   * @sampleResult {"id":"1234567890","primaryEmail":"liz@example.com","name":{"givenName":"Elizabeth","familyName":"Smith"},"orgUnitPath":"/Sales/Marketing"}
   */
  async updateUser(userKey, primaryEmail, givenName, familyName, password, orgUnitPath) {
    if (!userKey) {
      throw new Error('Parameter "User" is required')
    }

    const name = cleanupObject({ givenName, familyName })

    const body = cleanupObject({
      primaryEmail,
      name: Object.keys(name).length > 0 ? name : undefined,
      password,
      orgUnitPath,
    })

    if (Object.keys(body).length === 0) {
      throw new Error('Provide at least one property to update')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/users/${ encodeURIComponent(userKey) }`,
      logTag: 'updateUser',
      method: 'put',
      body,
    })
  }

  /**
   * @operationName Delete User
   * @category Users
   * @appearanceColor #1a73e8 #34a853
   * @description Deletes a user from the account. The user is retained in a recoverable state for 20 days, during which they can be restored with Undelete User; after that they are permanently removed. Returns a confirmation message.
   * @route DELETE /delete-user
   * @paramDef {"type":"String","label":"User","name":"userKey","required":true,"dictionary":"getUsersDictionary","description":"The user's primary email address or unique id. Choose a user or paste an email or id."}
   * @returns {Object}
   * @sampleResult {"message":"User deleted successfully","userKey":"liz@example.com"}
   */
  async deleteUser(userKey) {
    if (!userKey) {
      throw new Error('Parameter "User" is required')
    }

    await this.#apiRequest({
      url: `${ API_BASE_URL }/users/${ encodeURIComponent(userKey) }`,
      logTag: 'deleteUser',
      method: 'delete',
    })

    return { message: 'User deleted successfully', userKey }
  }

  /**
   * @operationName Suspend User
   * @category Users
   * @appearanceColor #1a73e8 #34a853
   * @description Suspends a user, immediately blocking their ability to sign in while preserving their data and account. Useful when an employee is on leave or an account is compromised. Returns the updated user resource.
   * @route PATCH /suspend-user
   * @paramDef {"type":"String","label":"User","name":"userKey","required":true,"dictionary":"getUsersDictionary","description":"The user's primary email address or unique id. Choose a user or paste an email or id."}
   * @returns {Object}
   * @sampleResult {"id":"1234567890","primaryEmail":"liz@example.com","suspended":true}
   */
  async suspendUser(userKey) {
    if (!userKey) {
      throw new Error('Parameter "User" is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/users/${ encodeURIComponent(userKey) }`,
      logTag: 'suspendUser',
      method: 'patch',
      body: { suspended: true },
    })
  }

  /**
   * @operationName Unsuspend User
   * @category Users
   * @appearanceColor #1a73e8 #34a853
   * @description Restores sign-in access for a previously suspended user by clearing the suspended flag. Returns the updated user resource.
   * @route PATCH /unsuspend-user
   * @paramDef {"type":"String","label":"User","name":"userKey","required":true,"dictionary":"getUsersDictionary","description":"The user's primary email address or unique id. Choose a user or paste an email or id."}
   * @returns {Object}
   * @sampleResult {"id":"1234567890","primaryEmail":"liz@example.com","suspended":false}
   */
  async unsuspendUser(userKey) {
    if (!userKey) {
      throw new Error('Parameter "User" is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/users/${ encodeURIComponent(userKey) }`,
      logTag: 'unsuspendUser',
      method: 'patch',
      body: { suspended: false },
    })
  }

  /**
   * @operationName Undelete User
   * @category Users
   * @appearanceColor #1a73e8 #34a853
   * @description Restores a user that was deleted within the last 20 days. Because a deleted user has no primary email, you must provide the user's unique id (obtained from List Users with Show Deleted enabled). Optionally place the restored user in an organizational unit. Returns a confirmation message.
   * @route POST /undelete-user
   * @paramDef {"type":"String","label":"User ID","name":"userKey","required":true,"description":"The unique id of the deleted user. Obtain this from List Users with the Show Deleted option enabled; a primary email cannot be used here."}
   * @paramDef {"type":"String","label":"Org Unit Path","name":"orgUnitPath","description":"Organizational unit to restore the user into, for example: /Sales. Defaults to the root org unit (/)."}
   * @returns {Object}
   * @sampleResult {"message":"User restored successfully","userKey":"1234567890"}
   */
  async undeleteUser(userKey, orgUnitPath) {
    if (!userKey) {
      throw new Error('Parameter "User ID" is required')
    }

    await this.#apiRequest({
      url: `${ API_BASE_URL }/users/${ encodeURIComponent(userKey) }/undelete`,
      logTag: 'undeleteUser',
      method: 'post',
      body: { orgUnitPath: orgUnitPath || '/' },
    })

    return { message: 'User restored successfully', userKey }
  }

  /**
   * @operationName Make User Admin
   * @category Users
   * @appearanceColor #1a73e8 #34a853
   * @description Grants or revokes super administrator privileges for a user. Enable to make the user a super administrator with full control of the account; disable to remove those privileges. Returns a confirmation message.
   * @route POST /make-user-admin
   * @paramDef {"type":"String","label":"User","name":"userKey","required":true,"dictionary":"getUsersDictionary","description":"The user's primary email address or unique id. Choose a user or paste an email or id."}
   * @paramDef {"type":"Boolean","label":"Is Admin","name":"status","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"Enable to grant super administrator privileges; disable to revoke them. Defaults to enabled."}
   * @returns {Object}
   * @sampleResult {"message":"User admin status updated successfully","userKey":"liz@example.com","isAdmin":true}
   */
  async makeUserAdmin(userKey, status) {
    if (!userKey) {
      throw new Error('Parameter "User" is required')
    }

    const isAdmin = status === undefined ? true : status

    await this.#apiRequest({
      url: `${ API_BASE_URL }/users/${ encodeURIComponent(userKey) }/makeAdmin`,
      logTag: 'makeUserAdmin',
      method: 'post',
      body: { status: isAdmin },
    })

    return { message: 'User admin status updated successfully', userKey, isAdmin }
  }

  /**
   * @operationName List User Aliases
   * @category Users
   * @appearanceColor #1a73e8 #34a853
   * @description Retrieves all email aliases configured for a user. Aliases are alternative addresses that deliver to the same mailbox.
   * @route GET /list-user-aliases
   * @paramDef {"type":"String","label":"User","name":"userKey","required":true,"dictionary":"getUsersDictionary","description":"The user's primary email address or unique id. Choose a user or paste an email or id."}
   * @returns {Object}
   * @sampleResult {"kind":"admin#directory#aliases","aliases":[{"kind":"admin#directory#alias","primaryEmail":"liz@example.com","alias":"elizabeth@example.com"}]}
   */
  async listUserAliases(userKey) {
    if (!userKey) {
      throw new Error('Parameter "User" is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/users/${ encodeURIComponent(userKey) }/aliases`,
      logTag: 'listUserAliases',
    })
  }

  /**
   * @operationName Add User Alias
   * @category Users
   * @appearanceColor #1a73e8 #34a853
   * @description Adds an email alias to a user. The alias must use a verified domain in the account, and mail sent to it is delivered to the user's mailbox. Returns the created alias resource.
   * @route POST /add-user-alias
   * @paramDef {"type":"String","label":"User","name":"userKey","required":true,"dictionary":"getUsersDictionary","description":"The user's primary email address or unique id. Choose a user or paste an email or id."}
   * @paramDef {"type":"String","label":"Alias","name":"alias","required":true,"description":"The alias email address to add, for example: elizabeth@example.com. The domain must be a verified domain in the account."}
   * @returns {Object}
   * @sampleResult {"kind":"admin#directory#alias","primaryEmail":"liz@example.com","alias":"elizabeth@example.com"}
   */
  async addUserAlias(userKey, alias) {
    if (!userKey) {
      throw new Error('Parameter "User" is required')
    }

    if (!alias) {
      throw new Error('Parameter "Alias" is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/users/${ encodeURIComponent(userKey) }/aliases`,
      logTag: 'addUserAlias',
      method: 'post',
      body: { alias },
    })
  }

  // ============================================== GROUPS ============================================

  /**
   * @operationName List Groups
   * @category Groups
   * @appearanceColor #1a73e8 #34a853
   * @description Retrieves groups from the Google Workspace account. Optionally filter by domain, by a search query, or by a user to list only the groups that user belongs to. The customer is fixed to the authenticated administrator's own account (my_customer). Returns a paginated list; follow the nextPageToken value using the Page Token parameter to retrieve additional pages.
   * @route GET /list-groups
   * @paramDef {"type":"String","label":"Domain","name":"domain","description":"Optional domain name to restrict results to a single domain, for example: example.com."}
   * @paramDef {"type":"String","label":"Search Query","name":"query","description":"Optional search query using Directory API syntax, for example: email:sales* or name:'Marketing Team'."}
   * @paramDef {"type":"String","label":"User Key","name":"userKey","description":"Optional user primary email or id. When provided, only groups that this user is a member of are returned."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of groups to return per page. Defaults to 100. The API allows up to 200."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"The nextPageToken value from a previous response, used to retrieve the next page of results."}
   * @returns {Object}
   * @sampleResult {"kind":"admin#directory#groups","groups":[{"id":"01234567abcdefg","email":"sales@example.com","name":"Sales Team","directMembersCount":"12"}],"nextPageToken":"tokenABC"}
   */
  async listGroups(domain, query, userKey, maxResults, pageToken) {
    const listQuery = {
      maxResults: maxResults ? Math.min(maxResults, 200) : DEFAULT_PAGE_SIZE,
      pageToken,
      domain,
      query,
      userKey,
    }

    // The customer and userKey parameters are mutually exclusive on this endpoint.
    if (!userKey) {
      listQuery.customer = MY_CUSTOMER
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/groups`,
      query: listQuery,
      logTag: 'listGroups',
    })
  }

  /**
   * @operationName Get Group
   * @category Groups
   * @appearanceColor #1a73e8 #34a853
   * @description Retrieves a single group by its email address or unique id (the groupKey). Returns the full group resource including name, description, and direct member count.
   * @route GET /get-group
   * @paramDef {"type":"String","label":"Group","name":"groupKey","required":true,"dictionary":"getGroupsDictionary","description":"The group's email address or unique id. Choose a group or paste an email or id."}
   * @returns {Object}
   * @sampleResult {"id":"01234567abcdefg","email":"sales@example.com","name":"Sales Team","description":"Global sales team","directMembersCount":"12"}
   */
  async getGroup(groupKey) {
    if (!groupKey) {
      throw new Error('Parameter "Group" is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/groups/${ encodeURIComponent(groupKey) }`,
      logTag: 'getGroup',
    })
  }

  /**
   * @operationName Create Group
   * @category Groups
   * @appearanceColor #1a73e8 #34a853
   * @description Creates a new group in the account. Requires a group email whose domain is a verified domain in the account. Optionally set a display name and description. Returns the created group resource.
   * @route POST /create-group
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"The group's email address, for example: sales@example.com. The domain must be a verified domain in the account."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The display name of the group, for example: Sales Team."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"An optional description of the group's purpose.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @returns {Object}
   * @sampleResult {"id":"01234567abcdefg","email":"sales@example.com","name":"Sales Team","description":"Global sales team"}
   */
  async createGroup(email, name, description) {
    if (!email) {
      throw new Error('Parameter "Email" is required')
    }

    const body = cleanupObject({ email, name, description })

    return this.#apiRequest({
      url: `${ API_BASE_URL }/groups`,
      logTag: 'createGroup',
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Update Group
   * @category Groups
   * @appearanceColor #1a73e8 #34a853
   * @description Updates writable properties of an existing group, such as its email, name, or description. Only the fields you provide are changed. Returns the updated group resource.
   * @route PUT /update-group
   * @paramDef {"type":"String","label":"Group","name":"groupKey","required":true,"dictionary":"getGroupsDictionary","description":"The group's email address or unique id. Choose a group or paste an email or id."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"An updated email address for the group. The previous address becomes an alias."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"An updated display name for the group."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"An updated description for the group.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @returns {Object}
   * @sampleResult {"id":"01234567abcdefg","email":"sales@example.com","name":"Global Sales","description":"Updated description"}
   */
  async updateGroup(groupKey, email, name, description) {
    if (!groupKey) {
      throw new Error('Parameter "Group" is required')
    }

    const body = cleanupObject({ email, name, description })

    if (Object.keys(body).length === 0) {
      throw new Error('Provide at least one property to update')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/groups/${ encodeURIComponent(groupKey) }`,
      logTag: 'updateGroup',
      method: 'put',
      body,
    })
  }

  /**
   * @operationName Delete Group
   * @category Groups
   * @appearanceColor #1a73e8 #34a853
   * @description Permanently deletes a group from the account. This removes the group and its membership; the action cannot be undone. Returns a confirmation message.
   * @route DELETE /delete-group
   * @paramDef {"type":"String","label":"Group","name":"groupKey","required":true,"dictionary":"getGroupsDictionary","description":"The group's email address or unique id. Choose a group or paste an email or id."}
   * @returns {Object}
   * @sampleResult {"message":"Group deleted successfully","groupKey":"sales@example.com"}
   */
  async deleteGroup(groupKey) {
    if (!groupKey) {
      throw new Error('Parameter "Group" is required')
    }

    await this.#apiRequest({
      url: `${ API_BASE_URL }/groups/${ encodeURIComponent(groupKey) }`,
      logTag: 'deleteGroup',
      method: 'delete',
    })

    return { message: 'Group deleted successfully', groupKey }
  }

  // =========================================== GROUP MEMBERS =======================================

  /**
   * @operationName List Group Members
   * @category Group Members
   * @appearanceColor #1a73e8 #34a853
   * @description Retrieves the members of a group, which may include users, other groups, and service accounts. Optionally filter by role. Returns a paginated list; follow the nextPageToken value using the Page Token parameter to retrieve additional pages.
   * @route GET /list-group-members
   * @paramDef {"type":"String","label":"Group","name":"groupKey","required":true,"dictionary":"getGroupsDictionary","description":"The group's email address or unique id. Choose a group or paste an email or id."}
   * @paramDef {"type":"String","label":"Roles","name":"roles","uiComponent":{"type":"DROPDOWN","options":{"values":["Owner","Manager","Member"]}},"description":"Optional role to filter members by. Leave empty to return members of all roles."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of members to return per page. Defaults to 100. The API allows up to 200."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"The nextPageToken value from a previous response, used to retrieve the next page of results."}
   * @returns {Object}
   * @sampleResult {"kind":"admin#directory#members","members":[{"kind":"admin#directory#member","id":"1234567890","email":"liz@example.com","role":"MEMBER","type":"USER","status":"ACTIVE"}],"nextPageToken":"tokenABC"}
   */
  async listGroupMembers(groupKey, roles, maxResults, pageToken) {
    if (!groupKey) {
      throw new Error('Parameter "Group" is required')
    }

    const resolvedRoles = this.#resolveChoice(roles, {
      'Owner': 'OWNER',
      'Manager': 'MANAGER',
      'Member': 'MEMBER',
    })

    return this.#apiRequest({
      url: `${ API_BASE_URL }/groups/${ encodeURIComponent(groupKey) }/members`,
      query: {
        roles: resolvedRoles,
        maxResults: maxResults ? Math.min(maxResults, 200) : DEFAULT_PAGE_SIZE,
        pageToken,
      },
      logTag: 'listGroupMembers',
    })
  }

  /**
   * @operationName Get Group Member
   * @category Group Members
   * @appearanceColor #1a73e8 #34a853
   * @description Retrieves a single membership record, including the member's role and status within the group.
   * @route GET /get-group-member
   * @paramDef {"type":"String","label":"Group","name":"groupKey","required":true,"dictionary":"getGroupsDictionary","description":"The group's email address or unique id. Choose a group or paste an email or id."}
   * @paramDef {"type":"String","label":"Member","name":"memberKey","required":true,"description":"The member's email address or unique id."}
   * @returns {Object}
   * @sampleResult {"kind":"admin#directory#member","id":"1234567890","email":"liz@example.com","role":"MEMBER","type":"USER","status":"ACTIVE"}
   */
  async getGroupMember(groupKey, memberKey) {
    if (!groupKey) {
      throw new Error('Parameter "Group" is required')
    }

    if (!memberKey) {
      throw new Error('Parameter "Member" is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/groups/${ encodeURIComponent(groupKey) }/members/${ encodeURIComponent(memberKey) }`,
      logTag: 'getGroupMember',
    })
  }

  /**
   * @operationName Add Group Member
   * @category Group Members
   * @appearanceColor #1a73e8 #34a853
   * @description Adds a user, group, or service account to a group with a chosen role. Members can be regular Members, Managers, or Owners. Returns the created membership resource.
   * @route POST /add-group-member
   * @paramDef {"type":"String","label":"Group","name":"groupKey","required":true,"dictionary":"getGroupsDictionary","description":"The group to add the member to. Choose a group or paste an email or id."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"The email address of the user, group, or service account to add as a member."}
   * @paramDef {"type":"String","label":"Role","name":"role","defaultValue":"Member","uiComponent":{"type":"DROPDOWN","options":{"values":["Member","Manager","Owner"]}},"description":"The role to assign the member. Members receive group mail; Managers and Owners can additionally manage membership. Defaults to Member."}
   * @returns {Object}
   * @sampleResult {"kind":"admin#directory#member","id":"1234567890","email":"liz@example.com","role":"MEMBER","type":"USER","status":"ACTIVE"}
   */
  async addGroupMember(groupKey, email, role) {
    if (!groupKey) {
      throw new Error('Parameter "Group" is required')
    }

    if (!email) {
      throw new Error('Parameter "Email" is required')
    }

    const resolvedRole = this.#resolveChoice(role, {
      'Member': 'MEMBER',
      'Manager': 'MANAGER',
      'Owner': 'OWNER',
    }) || 'MEMBER'

    return this.#apiRequest({
      url: `${ API_BASE_URL }/groups/${ encodeURIComponent(groupKey) }/members`,
      logTag: 'addGroupMember',
      method: 'post',
      body: { email, role: resolvedRole },
    })
  }

  /**
   * @operationName Update Group Member
   * @category Group Members
   * @appearanceColor #1a73e8 #34a853
   * @description Updates a member's role within a group, for example promoting a Member to a Manager or Owner. Returns the updated membership resource.
   * @route PUT /update-group-member
   * @paramDef {"type":"String","label":"Group","name":"groupKey","required":true,"dictionary":"getGroupsDictionary","description":"The group's email address or unique id. Choose a group or paste an email or id."}
   * @paramDef {"type":"String","label":"Member","name":"memberKey","required":true,"description":"The member's email address or unique id."}
   * @paramDef {"type":"String","label":"Role","name":"role","required":true,"defaultValue":"Member","uiComponent":{"type":"DROPDOWN","options":{"values":["Member","Manager","Owner"]}},"description":"The new role for the member: Member, Manager, or Owner."}
   * @returns {Object}
   * @sampleResult {"kind":"admin#directory#member","id":"1234567890","email":"liz@example.com","role":"MANAGER","type":"USER","status":"ACTIVE"}
   */
  async updateGroupMember(groupKey, memberKey, role) {
    if (!groupKey) {
      throw new Error('Parameter "Group" is required')
    }

    if (!memberKey) {
      throw new Error('Parameter "Member" is required')
    }

    const resolvedRole = this.#resolveChoice(role, {
      'Member': 'MEMBER',
      'Manager': 'MANAGER',
      'Owner': 'OWNER',
    })

    if (!resolvedRole) {
      throw new Error('Parameter "Role" is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/groups/${ encodeURIComponent(groupKey) }/members/${ encodeURIComponent(memberKey) }`,
      logTag: 'updateGroupMember',
      method: 'put',
      body: { email: memberKey, role: resolvedRole },
    })
  }

  /**
   * @operationName Remove Group Member
   * @category Group Members
   * @appearanceColor #1a73e8 #34a853
   * @description Removes a member from a group. This does not delete the underlying user or group; it only ends the membership. Returns a confirmation message.
   * @route DELETE /remove-group-member
   * @paramDef {"type":"String","label":"Group","name":"groupKey","required":true,"dictionary":"getGroupsDictionary","description":"The group's email address or unique id. Choose a group or paste an email or id."}
   * @paramDef {"type":"String","label":"Member","name":"memberKey","required":true,"description":"The member's email address or unique id to remove."}
   * @returns {Object}
   * @sampleResult {"message":"Member removed successfully","groupKey":"sales@example.com","memberKey":"liz@example.com"}
   */
  async removeGroupMember(groupKey, memberKey) {
    if (!groupKey) {
      throw new Error('Parameter "Group" is required')
    }

    if (!memberKey) {
      throw new Error('Parameter "Member" is required')
    }

    await this.#apiRequest({
      url: `${ API_BASE_URL }/groups/${ encodeURIComponent(groupKey) }/members/${ encodeURIComponent(memberKey) }`,
      logTag: 'removeGroupMember',
      method: 'delete',
    })

    return { message: 'Member removed successfully', groupKey, memberKey }
  }

  /**
   * @operationName Check Has Member
   * @category Group Members
   * @appearanceColor #1a73e8 #34a853
   * @description Checks whether a user is a member of a group, including through nested group membership. Returns a boolean result.
   * @route GET /check-has-member
   * @paramDef {"type":"String","label":"Group","name":"groupKey","required":true,"dictionary":"getGroupsDictionary","description":"The group's email address or unique id. Choose a group or paste an email or id."}
   * @paramDef {"type":"String","label":"Member","name":"memberKey","required":true,"description":"The user email address or id to check for membership."}
   * @returns {Object}
   * @sampleResult {"isMember":true}
   */
  async checkHasMember(groupKey, memberKey) {
    if (!groupKey) {
      throw new Error('Parameter "Group" is required')
    }

    if (!memberKey) {
      throw new Error('Parameter "Member" is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/groups/${ encodeURIComponent(groupKey) }/hasMember/${ encodeURIComponent(memberKey) }`,
      logTag: 'checkHasMember',
    })
  }

  // ============================================ ORG UNITS ==========================================

  /**
   * @operationName List Org Units
   * @category Org Units
   * @appearanceColor #1a73e8 #34a853
   * @description Retrieves the organizational units in the account. Optionally restrict the scope to immediate children, all descendants, or all descendants including a starting unit. The customer is fixed to the authenticated administrator's own account (my_customer).
   * @route GET /list-org-units
   * @paramDef {"type":"String","label":"Type","name":"type","defaultValue":"All","uiComponent":{"type":"DROPDOWN","options":{"values":["All","Children","All Including Parent"]}},"description":"Scope of org units to return. Children returns only immediate children; All returns all descendants; All Including Parent also includes the org unit named in Org Unit Path. Defaults to All."}
   * @paramDef {"type":"String","label":"Org Unit Path","name":"orgUnitPath","description":"Optional org unit to start from, for example: /Sales. Provide the path without a leading slash consideration here (a leading slash is accepted for the query parameter). Defaults to the root org unit."}
   * @returns {Object}
   * @sampleResult {"kind":"admin#directory#orgUnits","organizationUnits":[{"kind":"admin#directory#orgUnit","name":"Sales","orgUnitPath":"/Sales","orgUnitId":"id:03ph8a2z1","parentOrgUnitPath":"/"}]}
   */
  async listOrgUnits(type, orgUnitPath) {
    const resolvedType = this.#resolveChoice(type, {
      'All': 'all',
      'Children': 'children',
      'All Including Parent': 'allIncludingParent',
    })

    return this.#apiRequest({
      url: `${ API_BASE_URL }/customer/${ MY_CUSTOMER }/orgunits`,
      query: {
        type: resolvedType,
        orgUnitPath,
      },
      logTag: 'listOrgUnits',
    })
  }

  /**
   * @operationName Get Org Unit
   * @category Org Units
   * @appearanceColor #1a73e8 #34a853
   * @description Retrieves a single organizational unit by its path. The path must be provided WITHOUT a leading slash, for example: Sales/Marketing (not /Sales/Marketing). Returns the org unit resource.
   * @route GET /get-org-unit
   * @paramDef {"type":"String","label":"Org Unit Path","name":"orgUnitPath","required":true,"description":"The full path of the org unit WITHOUT a leading slash, for example: Sales/Marketing. A leading slash, if provided, is stripped automatically."}
   * @returns {Object}
   * @sampleResult {"kind":"admin#directory#orgUnit","name":"Marketing","orgUnitPath":"/Sales/Marketing","orgUnitId":"id:03ph8a2z2","parentOrgUnitPath":"/Sales"}
   */
  async getOrgUnit(orgUnitPath) {
    if (!orgUnitPath) {
      throw new Error('Parameter "Org Unit Path" is required')
    }

    const normalizedPath = stripLeadingSlash(orgUnitPath)

    return this.#apiRequest({
      url: `${ API_BASE_URL }/customer/${ MY_CUSTOMER }/orgunits/${ encodePath(normalizedPath) }`,
      logTag: 'getOrgUnit',
    })
  }

  /**
   * @operationName Create Org Unit
   * @category Org Units
   * @appearanceColor #1a73e8 #34a853
   * @description Creates a new organizational unit under a parent org unit. Provide the unit name and the parent's path (use / for the root). Optionally add a description. Returns the created org unit resource.
   * @route POST /create-org-unit
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the new org unit, for example: Marketing."}
   * @paramDef {"type":"String","label":"Parent Org Unit Path","name":"parentOrgUnitPath","required":true,"defaultValue":"/","description":"The path of the parent org unit, for example: /Sales. Use / to create the unit directly under the root."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"An optional description of the org unit.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @returns {Object}
   * @sampleResult {"kind":"admin#directory#orgUnit","name":"Marketing","orgUnitPath":"/Sales/Marketing","orgUnitId":"id:03ph8a2z2","parentOrgUnitPath":"/Sales"}
   */
  async createOrgUnit(name, parentOrgUnitPath, description) {
    if (!name) {
      throw new Error('Parameter "Name" is required')
    }

    if (!parentOrgUnitPath) {
      throw new Error('Parameter "Parent Org Unit Path" is required')
    }

    const body = cleanupObject({ name, parentOrgUnitPath, description })

    return this.#apiRequest({
      url: `${ API_BASE_URL }/customer/${ MY_CUSTOMER }/orgunits`,
      logTag: 'createOrgUnit',
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Update Org Unit
   * @category Org Units
   * @appearanceColor #1a73e8 #34a853
   * @description Updates an organizational unit's name, description, or parent (moving it in the hierarchy). Identify the unit by its path WITHOUT a leading slash. Only the fields you provide are changed. Returns the updated org unit resource.
   * @route PUT /update-org-unit
   * @paramDef {"type":"String","label":"Org Unit Path","name":"orgUnitPath","required":true,"description":"The full path of the org unit to update WITHOUT a leading slash, for example: Sales/Marketing."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"An updated name for the org unit."}
   * @paramDef {"type":"String","label":"Parent Org Unit Path","name":"parentOrgUnitPath","description":"A new parent path to move the org unit under, for example: /Operations."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"An updated description for the org unit.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @returns {Object}
   * @sampleResult {"kind":"admin#directory#orgUnit","name":"Field Marketing","orgUnitPath":"/Sales/Field Marketing","orgUnitId":"id:03ph8a2z2","parentOrgUnitPath":"/Sales"}
   */
  async updateOrgUnit(orgUnitPath, name, parentOrgUnitPath, description) {
    if (!orgUnitPath) {
      throw new Error('Parameter "Org Unit Path" is required')
    }

    const body = cleanupObject({ name, parentOrgUnitPath, description })

    if (Object.keys(body).length === 0) {
      throw new Error('Provide at least one property to update')
    }

    const normalizedPath = stripLeadingSlash(orgUnitPath)

    return this.#apiRequest({
      url: `${ API_BASE_URL }/customer/${ MY_CUSTOMER }/orgunits/${ encodePath(normalizedPath) }`,
      logTag: 'updateOrgUnit',
      method: 'put',
      body,
    })
  }

  /**
   * @operationName Delete Org Unit
   * @category Org Units
   * @appearanceColor #1a73e8 #34a853
   * @description Deletes an organizational unit. The unit must have no child org units and no users assigned to it. Identify the unit by its path WITHOUT a leading slash. Returns a confirmation message.
   * @route DELETE /delete-org-unit
   * @paramDef {"type":"String","label":"Org Unit Path","name":"orgUnitPath","required":true,"description":"The full path of the org unit to delete WITHOUT a leading slash, for example: Sales/Marketing."}
   * @returns {Object}
   * @sampleResult {"message":"Org unit deleted successfully","orgUnitPath":"Sales/Marketing"}
   */
  async deleteOrgUnit(orgUnitPath) {
    if (!orgUnitPath) {
      throw new Error('Parameter "Org Unit Path" is required')
    }

    const normalizedPath = stripLeadingSlash(orgUnitPath)

    await this.#apiRequest({
      url: `${ API_BASE_URL }/customer/${ MY_CUSTOMER }/orgunits/${ encodePath(normalizedPath) }`,
      logTag: 'deleteOrgUnit',
      method: 'delete',
    })

    return { message: 'Org unit deleted successfully', orgUnitPath: normalizedPath }
  }

  // ========================================= DOMAINS & ROLES =======================================

  /**
   * @operationName List Domains
   * @category Domains & Roles
   * @appearanceColor #1a73e8 #34a853
   * @description Retrieves the domains and domain aliases registered for the account, including which domain is the primary and whether each is verified. The customer is fixed to the authenticated administrator's own account (my_customer).
   * @route GET /list-domains
   * @returns {Object}
   * @sampleResult {"kind":"admin#directory#domains","domains":[{"domainName":"example.com","isPrimary":true,"verified":true,"creationTime":"1600000000000"}]}
   */
  async listDomains() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/customer/${ MY_CUSTOMER }/domains`,
      logTag: 'listDomains',
    })
  }

  /**
   * @operationName List Roles
   * @category Domains & Roles
   * @appearanceColor #1a73e8 #34a853
   * @description Retrieves the administrator roles defined for the account, including built-in system roles and custom roles, with their ids and privileges. The customer is fixed to the authenticated administrator's own account (my_customer).
   * @route GET /list-roles
   * @returns {Object}
   * @sampleResult {"kind":"admin#directory#roles","items":[{"roleId":"3894220830343168","roleName":"_SEED_ADMIN_ROLE","isSystemRole":true,"isSuperAdminRole":true}]}
   */
  async listRoles() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/customer/${ MY_CUSTOMER }/roles`,
      logTag: 'listRoles',
    })
  }

  /**
   * @operationName List Role Assignments
   * @category Domains & Roles
   * @appearanceColor #1a73e8 #34a853
   * @description Retrieves administrator role assignments for the account, showing which users hold which roles and their scope. Optionally filter to a single user. Returns a paginated list; follow the nextPageToken value using the Page Token parameter to retrieve additional pages.
   * @route GET /list-role-assignments
   * @paramDef {"type":"String","label":"User Key","name":"userKey","description":"Optional user primary email or id to filter assignments to a single user."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"The nextPageToken value from a previous response, used to retrieve the next page of results."}
   * @returns {Object}
   * @sampleResult {"kind":"admin#directory#roleAssignments","items":[{"roleAssignmentId":"9068161020000001","roleId":"9068161020000002","assignedTo":"100000000000000000001","scopeType":"CUSTOMER"}]}
   */
  async listRoleAssignments(userKey, pageToken) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/customer/${ MY_CUSTOMER }/roleassignments`,
      query: {
        userKey,
        pageToken,
      },
      logTag: 'listRoleAssignments',
    })
  }

  // ============================================= DEVICES ===========================================

  /**
   * @operationName List Mobile Devices
   * @category Devices
   * @appearanceColor #1a73e8 #34a853
   * @description Retrieves the mobile devices synchronized with the account, including device model, operating system, owner, and management status. Optionally filter with a search query. The customer is fixed to the authenticated administrator's own account (my_customer). Returns a paginated list; follow the nextPageToken value using the Page Token parameter to retrieve additional pages.
   * @route GET /list-mobile-devices
   * @paramDef {"type":"String","label":"Search Query","name":"query","description":"Optional device search query, for example: status:approved or email:liz@example.com or type:android."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of devices to return per page. Defaults to 100. The API allows up to 100."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"The nextPageToken value from a previous response, used to retrieve the next page of results."}
   * @returns {Object}
   * @sampleResult {"kind":"admin#directory#mobiledevices","mobiledevices":[{"resourceId":"AFiQxQ8_r...","email":["liz@example.com"],"model":"Pixel 7","os":"Android 14","status":"APPROVED","type":"ANDROID"}],"nextPageToken":"tokenABC"}
   */
  async listMobileDevices(query, maxResults, pageToken) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/customer/${ MY_CUSTOMER }/devices/mobile`,
      query: {
        query,
        maxResults: maxResults ? Math.min(maxResults, 100) : DEFAULT_PAGE_SIZE,
        pageToken,
      },
      logTag: 'listMobileDevices',
    })
  }
}

Flowrunner.ServerCode.addService(GoogleWorkspaceAdminService, [
  {
    displayName: 'Client ID',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your OAuth 2.0 Client ID from the Google Cloud Console. The OAuth consent screen must include the Admin SDK scopes.',
  },
  {
    displayName: 'Client Secret',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your OAuth 2.0 Client Secret from the Google Cloud Console.',
  },
])

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

function searchFilter(list, props, searchString) {
  const needle = searchString.toLowerCase()

  return list.filter(item =>
    props.some(prop => {
      const value = item[prop]

      return value && String(value).toLowerCase().includes(needle)
    })
  )
}

function stripLeadingSlash(path) {
  return path.startsWith('/') ? path.slice(1) : path
}

// Encodes an org unit path for use as a URL path segment while preserving the
// slashes that separate nested org units (e.g. Sales/Marketing).
function encodePath(path) {
  return path
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/')
}
