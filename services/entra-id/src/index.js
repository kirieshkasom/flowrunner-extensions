const OAUTH_BASE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const API_BASE_URL = 'https://graph.microsoft.com/v1.0'
const PAGE_SIZE_DICTIONARY = 25

const DEFAULT_SCOPE_LIST = [
  'openid',
  'offline_access',
  'User.ReadWrite.All',
  'Group.ReadWrite.All',
  'Directory.ReadWrite.All',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const logger = {
  info: (...args) => console.log('[Microsoft Entra ID] info:', ...args),
  debug: (...args) => console.log('[Microsoft Entra ID] debug:', ...args),
  error: (...args) => console.log('[Microsoft Entra ID] error:', ...args),
  warn: (...args) => console.log('[Microsoft Entra ID] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName Microsoft Entra ID
 * @integrationIcon /icon.png
 **/
class MicrosoftEntraIdService {
  /**
   * @typedef {Object} getUsersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to search users by display name. Uses Microsoft Graph search, requiring the ConsistencyLevel: eventual header."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination link for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getGroupsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to search groups by display name. Uses Microsoft Graph search, requiring the ConsistencyLevel: eventual header."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination link for retrieving the next page of results."}
   */
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  #getAccessTokenHeader(extraHeaders) {
    return {
      Authorization: `Bearer ${ this.request.headers['oauth-access-token'] }`,
      ...(extraHeaders || {}),
    }
  }

  async #apiRequest({ url, method, body, query, headers, logTag }) {
    method = method || 'get'
    query = cleanupObject(query)

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      const request = Flowrunner.Request[method](url)
        .set(this.#getAccessTokenHeader(headers))
        .query(query)

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const graphError = error.body?.error
      const message = graphError?.message || error.message
      const code = graphError?.code ? `${ graphError.code }: ` : ''

      logger.error(`${ logTag } - error [${ error.status || error.statusCode || '' }]: ${ code }${ message }`)

      throw new Error(`Microsoft Entra ID API error: ${ code }${ message }`)
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
   * @operationName Get Users Dictionary
   * @description Provides a searchable list of directory users for dynamic parameter selection. Each entry maps a user's display name to their object ID and shows the user principal name as a note.
   * @route POST /get-users-dictionary
   * @paramDef {"type":"getUsersDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering users."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Adele Vance","value":"87d349ed-44d7-43e1-9a83-5f2406dee5bd","note":"AdeleV@contoso.com"}],"cursor":null}
   */
  async getUsersDictionary(payload) {
    const { search, cursor } = payload || {}

    let url = cursor
    let query
    let headers

    if (!cursor) {
      url = `${ API_BASE_URL }/users`

      query = {
        $top: PAGE_SIZE_DICTIONARY,
        $select: 'id,displayName,userPrincipalName',
      }

      if (search) {
        query.$search = `"displayName:${ search }"`
        headers = { ConsistencyLevel: 'eventual' }
      }
    }

    const response = await this.#apiRequest({
      url,
      query,
      headers,
      logTag: 'getUsersDictionary',
    })

    return {
      cursor: response['@odata.nextLink'] || null,
      items: (response.value || []).map(({ id, displayName, userPrincipalName }) => ({
        label: displayName || userPrincipalName || id,
        note: userPrincipalName || `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Groups Dictionary
   * @description Provides a searchable list of directory groups for dynamic parameter selection. Each entry maps a group's display name to its object ID.
   * @route POST /get-groups-dictionary
   * @paramDef {"type":"getGroupsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering groups."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Library Assist","value":"b320ee12-b1cd-4cca-b648-a437be61c5cd","note":"library@contoso.com"}],"cursor":null}
   */
  async getGroupsDictionary(payload) {
    const { search, cursor } = payload || {}

    let url = cursor
    let query
    let headers

    if (!cursor) {
      url = `${ API_BASE_URL }/groups`

      query = {
        $top: PAGE_SIZE_DICTIONARY,
        $select: 'id,displayName,mail',
      }

      if (search) {
        query.$search = `"displayName:${ search }"`
        headers = { ConsistencyLevel: 'eventual' }
      }
    }

    const response = await this.#apiRequest({
      url,
      query,
      headers,
      logTag: 'getGroupsDictionary',
    })

    return {
      cursor: response['@odata.nextLink'] || null,
      items: (response.value || []).map(({ id, displayName, mail }) => ({
        label: displayName || id,
        note: mail || `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @operationName Get My Profile
   * @category Directory
   * @appearanceColor #0F6CBD #004578
   * @description Retrieves the profile of the signed-in user including display name, email, user principal name, and object ID. Useful for verifying that the connection to Microsoft Entra ID is working.
   * @route GET /me
   * @returns {Object}
   * @sampleResult {"id":"87d349ed-44d7-43e1-9a83-5f2406dee5bd","displayName":"Adele Vance","mail":"AdeleV@contoso.com","userPrincipalName":"AdeleV@contoso.com","jobTitle":"Product Marketing Manager"}
   */
  getMyProfile() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/me`,
      logTag: 'getMyProfile',
    })
  }

  /**
   * @operationName List Users
   * @category Users
   * @appearanceColor #0F6CBD #004578
   * @description Retrieves users from the directory. Supports OData filtering, full-text search on display name and email, field selection, and result limiting. Returns a paginated list; follow the @odata.nextLink value using the Next Page Link parameter to retrieve additional pages.
   * @route GET /list-users
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Optional OData $filter expression, for example: startsWith(displayName,'A') or accountEnabled eq true."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional full-text search across display name, mail, and user principal name. Automatically sends the ConsistencyLevel: eventual header required by Microsoft Graph."}
   * @paramDef {"type":"String","label":"Select Fields","name":"select","description":"Optional comma-separated list of properties to return, for example: id,displayName,mail,userPrincipalName. Reduces payload size."}
   * @paramDef {"type":"Number","label":"Max Results","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of users to return per page. Defaults to 25. Microsoft Graph allows up to 999."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"The @odata.nextLink URL from a previous response used to retrieve the next page. When provided, all other parameters are ignored."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"87d349ed-44d7-43e1-9a83-5f2406dee5bd","displayName":"Adele Vance","mail":"AdeleV@contoso.com","userPrincipalName":"AdeleV@contoso.com"}],"@odata.nextLink":"https://graph.microsoft.com/v1.0/users?$skiptoken=X'4453'"}
   */
  async listUsers(filter, search, select, top, nextLink) {
    if (nextLink) {
      return this.#apiRequest({
        url: nextLink,
        logTag: 'listUsers',
      })
    }

    const query = {
      $filter: filter,
      $select: select,
      $top: top ? Math.min(top, 999) : PAGE_SIZE_DICTIONARY,
    }

    let headers

    if (search) {
      query.$search = search.includes(':') ? search : `"displayName:${ search }"`
      headers = { ConsistencyLevel: 'eventual' }
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/users`,
      query,
      headers,
      logTag: 'listUsers',
    })
  }

  /**
   * @operationName Get User
   * @category Users
   * @appearanceColor #0F6CBD #004578
   * @description Retrieves a single user by object ID or user principal name (email). Optionally limit the returned properties with a field selection.
   * @route GET /get-user
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The object ID or user principal name (email) of the user. Choose a user or paste an ID or UPN."}
   * @paramDef {"type":"String","label":"Select Fields","name":"select","description":"Optional comma-separated list of properties to return, for example: id,displayName,mail,jobTitle,department."}
   * @returns {Object}
   * @sampleResult {"id":"87d349ed-44d7-43e1-9a83-5f2406dee5bd","displayName":"Adele Vance","mail":"AdeleV@contoso.com","userPrincipalName":"AdeleV@contoso.com","jobTitle":"Product Marketing Manager","accountEnabled":true}
   */
  async getUser(userId, select) {
    if (!userId) {
      throw new Error('Parameter "User" is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/users/${ encodeURIComponent(userId) }`,
      query: { $select: select },
      logTag: 'getUser',
    })
  }

  /**
   * @operationName Create User
   * @category Users
   * @appearanceColor #0F6CBD #004578
   * @description Creates a new member user in the directory. Requires a display name, mail nickname, user principal name (which must use a verified domain), and an initial password. By default the account is enabled and the user is required to change their password at first sign-in.
   * @route POST /create-user
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","required":true,"description":"The name shown in the address book, for example: Adele Vance."}
   * @paramDef {"type":"String","label":"Mail Nickname","name":"mailNickname","required":true,"description":"The mail alias for the user, for example: AdeleV. Must not contain spaces or the characters @ () \\ [] \" ; : <> ,."}
   * @paramDef {"type":"String","label":"User Principal Name","name":"userPrincipalName","required":true,"description":"The sign-in name in alias@domain form, for example: AdeleV@contoso.com. The domain must be a verified domain in the tenant."}
   * @paramDef {"type":"String","label":"Password","name":"password","required":true,"description":"The initial password for the user. Must meet the tenant's password complexity policy."}
   * @paramDef {"type":"Boolean","label":"Account Enabled","name":"accountEnabled","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"Whether the account is enabled and able to sign in. Defaults to enabled."}
   * @paramDef {"type":"Boolean","label":"Force Password Change","name":"forceChangePasswordNextSignIn","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"Whether the user must change their password at the next sign-in. Defaults to true."}
   * @returns {Object}
   * @sampleResult {"id":"87d349ed-44d7-43e1-9a83-5f2406dee5bd","displayName":"Adele Vance","mailNickname":"AdeleV","userPrincipalName":"AdeleV@contoso.com","accountEnabled":true}
   */
  async createUser(displayName, mailNickname, userPrincipalName, password, accountEnabled, forceChangePasswordNextSignIn) {
    if (!displayName) {
      throw new Error('Parameter "Display Name" is required')
    }

    if (!mailNickname) {
      throw new Error('Parameter "Mail Nickname" is required')
    }

    if (!userPrincipalName) {
      throw new Error('Parameter "User Principal Name" is required')
    }

    if (!password) {
      throw new Error('Parameter "Password" is required')
    }

    const body = cleanupObject({
      accountEnabled: accountEnabled === undefined ? true : accountEnabled,
      displayName,
      mailNickname,
      userPrincipalName,
      passwordProfile: {
        password,
        forceChangePasswordNextSignIn: forceChangePasswordNextSignIn === undefined ? true : forceChangePasswordNextSignIn,
      },
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
   * @appearanceColor #0F6CBD #004578
   * @description Updates writable properties of an existing user, such as display name, job title, department, or account enabled state. Only the fields you provide are changed. Returns a confirmation message; Microsoft Graph returns no content on a successful update.
   * @route PATCH /update-user
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The object ID or user principal name of the user to update. Choose a user or paste an ID or UPN."}
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","description":"An updated display name for the user."}
   * @paramDef {"type":"String","label":"Job Title","name":"jobTitle","description":"An updated job title for the user."}
   * @paramDef {"type":"String","label":"Department","name":"department","description":"An updated department for the user."}
   * @paramDef {"type":"String","label":"Office Location","name":"officeLocation","description":"An updated office location for the user."}
   * @paramDef {"type":"String","label":"Mobile Phone","name":"mobilePhone","description":"An updated mobile phone number for the user."}
   * @paramDef {"type":"Boolean","label":"Account Enabled","name":"accountEnabled","uiComponent":{"type":"TOGGLE"},"description":"Set to enable or disable the user's ability to sign in. Leave unset to keep the current value."}
   * @returns {Object}
   * @sampleResult {"message":"User updated successfully","userId":"87d349ed-44d7-43e1-9a83-5f2406dee5bd"}
   */
  async updateUser(userId, displayName, jobTitle, department, officeLocation, mobilePhone, accountEnabled) {
    if (!userId) {
      throw new Error('Parameter "User" is required')
    }

    const body = cleanupObject({
      displayName,
      jobTitle,
      department,
      officeLocation,
      mobilePhone,
      accountEnabled,
    })

    if (Object.keys(body).length === 0) {
      throw new Error('Provide at least one property to update')
    }

    await this.#apiRequest({
      url: `${ API_BASE_URL }/users/${ encodeURIComponent(userId) }`,
      logTag: 'updateUser',
      method: 'patch',
      body,
    })

    return { message: 'User updated successfully', userId }
  }

  /**
   * @operationName Delete User
   * @category Users
   * @appearanceColor #0F6CBD #004578
   * @description Deletes a user from the directory. The user is moved to the deleted items container and can be restored within 30 days before being permanently removed.
   * @route DELETE /delete-user
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The object ID or user principal name of the user to delete. Choose a user or paste an ID or UPN."}
   * @returns {Object}
   * @sampleResult {"message":"User deleted successfully","userId":"87d349ed-44d7-43e1-9a83-5f2406dee5bd"}
   */
  async deleteUser(userId) {
    if (!userId) {
      throw new Error('Parameter "User" is required')
    }

    await this.#apiRequest({
      url: `${ API_BASE_URL }/users/${ encodeURIComponent(userId) }`,
      logTag: 'deleteUser',
      method: 'delete',
    })

    return { message: 'User deleted successfully', userId }
  }

  /**
   * @operationName Reset User Password
   * @category Users
   * @appearanceColor #0F6CBD #004578
   * @description Resets a user's password by updating their password profile. Optionally require the user to change the password at their next sign-in. The new password must meet the tenant's password complexity policy.
   * @route PATCH /reset-user-password
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The object ID or user principal name of the user whose password to reset. Choose a user or paste an ID or UPN."}
   * @paramDef {"type":"String","label":"New Password","name":"password","required":true,"description":"The new password for the user. Must meet the tenant's password complexity policy."}
   * @paramDef {"type":"Boolean","label":"Force Password Change","name":"forceChangePasswordNextSignIn","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"Whether the user must change this password at their next sign-in. Defaults to true."}
   * @returns {Object}
   * @sampleResult {"message":"Password reset successfully","userId":"87d349ed-44d7-43e1-9a83-5f2406dee5bd"}
   */
  async resetUserPassword(userId, password, forceChangePasswordNextSignIn) {
    if (!userId) {
      throw new Error('Parameter "User" is required')
    }

    if (!password) {
      throw new Error('Parameter "New Password" is required')
    }

    const body = {
      passwordProfile: {
        password,
        forceChangePasswordNextSignIn: forceChangePasswordNextSignIn === undefined ? true : forceChangePasswordNextSignIn,
      },
    }

    await this.#apiRequest({
      url: `${ API_BASE_URL }/users/${ encodeURIComponent(userId) }`,
      logTag: 'resetUserPassword',
      method: 'patch',
      body,
    })

    return { message: 'Password reset successfully', userId }
  }

  /**
   * @operationName Revoke Sign-In Sessions
   * @category Users
   * @appearanceColor #0F6CBD #004578
   * @description Invalidates all refresh tokens and browser sessions for a user by resetting their sign-in session validity time. This forces the user to reauthenticate on all devices and applications. Useful when an account is compromised or an employee leaves.
   * @route POST /revoke-sign-in-sessions
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The object ID or user principal name of the user whose sessions to revoke. Choose a user or paste an ID or UPN."}
   * @returns {Object}
   * @sampleResult {"@odata.context":"https://graph.microsoft.com/v1.0/$metadata#Edm.Boolean","value":true}
   */
  async revokeSignInSessions(userId) {
    if (!userId) {
      throw new Error('Parameter "User" is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/users/${ encodeURIComponent(userId) }/revokeSignInSessions`,
      logTag: 'revokeSignInSessions',
      method: 'post',
    })
  }

  /**
   * @operationName List User's Groups
   * @category Users
   * @appearanceColor #0F6CBD #004578
   * @description Retrieves the groups and directory roles that a user is a direct member of. Returns a paginated list; follow the @odata.nextLink value using the Next Page Link parameter to retrieve additional pages.
   * @route GET /list-user-groups
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The object ID or user principal name of the user. Choose a user or paste an ID or UPN."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"The @odata.nextLink URL from a previous response used to retrieve the next page. When provided, the User parameter is ignored."}
   * @returns {Object}
   * @sampleResult {"value":[{"@odata.type":"#microsoft.graph.group","id":"b320ee12-b1cd-4cca-b648-a437be61c5cd","displayName":"Library Assist","mail":"library@contoso.com"}]}
   */
  async listUserGroups(userId, nextLink) {
    if (nextLink) {
      return this.#apiRequest({
        url: nextLink,
        logTag: 'listUserGroups',
      })
    }

    if (!userId) {
      throw new Error('Parameter "User" is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/users/${ encodeURIComponent(userId) }/memberOf`,
      logTag: 'listUserGroups',
    })
  }

  /**
   * @operationName List Groups
   * @category Groups
   * @appearanceColor #0F6CBD #004578
   * @description Retrieves groups from the directory. Supports OData filtering, full-text search on display name and email, field selection, and result limiting. Returns a paginated list; follow the @odata.nextLink value using the Next Page Link parameter to retrieve additional pages.
   * @route GET /list-groups
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Optional OData $filter expression, for example: securityEnabled eq true or startsWith(displayName,'Sales')."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional full-text search across display name and email. Automatically sends the ConsistencyLevel: eventual header required by Microsoft Graph."}
   * @paramDef {"type":"String","label":"Select Fields","name":"select","description":"Optional comma-separated list of properties to return, for example: id,displayName,mail,groupTypes."}
   * @paramDef {"type":"Number","label":"Max Results","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of groups to return per page. Defaults to 25. Microsoft Graph allows up to 999."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"The @odata.nextLink URL from a previous response used to retrieve the next page. When provided, all other parameters are ignored."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"b320ee12-b1cd-4cca-b648-a437be61c5cd","displayName":"Library Assist","mail":"library@contoso.com","groupTypes":["Unified"],"securityEnabled":false}],"@odata.nextLink":"https://graph.microsoft.com/v1.0/groups?$skiptoken=X'4453'"}
   */
  async listGroups(filter, search, select, top, nextLink) {
    if (nextLink) {
      return this.#apiRequest({
        url: nextLink,
        logTag: 'listGroups',
      })
    }

    const query = {
      $filter: filter,
      $select: select,
      $top: top ? Math.min(top, 999) : PAGE_SIZE_DICTIONARY,
    }

    let headers

    if (search) {
      query.$search = search.includes(':') ? search : `"displayName:${ search }"`
      headers = { ConsistencyLevel: 'eventual' }
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/groups`,
      query,
      headers,
      logTag: 'listGroups',
    })
  }

  /**
   * @operationName Get Group
   * @category Groups
   * @appearanceColor #0F6CBD #004578
   * @description Retrieves a single group by its object ID. Optionally limit the returned properties with a field selection.
   * @route GET /get-group
   * @paramDef {"type":"String","label":"Group","name":"groupId","required":true,"dictionary":"getGroupsDictionary","description":"The object ID of the group. Choose a group or paste an ID."}
   * @paramDef {"type":"String","label":"Select Fields","name":"select","description":"Optional comma-separated list of properties to return, for example: id,displayName,description,mail,groupTypes."}
   * @returns {Object}
   * @sampleResult {"id":"b320ee12-b1cd-4cca-b648-a437be61c5cd","displayName":"Library Assist","description":"Self help community for library","mail":"library@contoso.com","groupTypes":["Unified"],"securityEnabled":false,"mailEnabled":true}
   */
  async getGroup(groupId, select) {
    if (!groupId) {
      throw new Error('Parameter "Group" is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/groups/${ encodeURIComponent(groupId) }`,
      query: { $select: select },
      logTag: 'getGroup',
    })
  }

  /**
   * @operationName Create Group
   * @category Groups
   * @appearanceColor #0F6CBD #004578
   * @description Creates a new group in the directory. Choose the group type: a Microsoft 365 group for collaboration or a Security group for access control. The calling user is automatically added as the group owner.
   * @route POST /create-group
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","required":true,"description":"The name to display for the group. Maximum 256 characters."}
   * @paramDef {"type":"String","label":"Mail Nickname","name":"mailNickname","required":true,"description":"The mail alias for the group, unique within the organization. Maximum 64 characters. Must not contain spaces or the characters @ () \\ [] \" ; : <> ,."}
   * @paramDef {"type":"String","label":"Group Type","name":"groupType","required":true,"defaultValue":"Security","uiComponent":{"type":"DROPDOWN","options":{"values":["Security","Microsoft 365"]}},"description":"The type of group to create. Security groups control access to resources; Microsoft 365 groups add shared collaboration features such as a mailbox and calendar. Defaults to Security."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"An optional description for the group."}
   * @returns {Object}
   * @sampleResult {"id":"b320ee12-b1cd-4cca-b648-a437be61c5cd","displayName":"Library Assist","mailNickname":"library","groupTypes":["Unified"],"mailEnabled":true,"securityEnabled":false}
   */
  async createGroup(displayName, mailNickname, groupType, description) {
    if (!displayName) {
      throw new Error('Parameter "Display Name" is required')
    }

    if (!mailNickname) {
      throw new Error('Parameter "Mail Nickname" is required')
    }

    const resolvedType = this.#resolveChoice(groupType, {
      'Security': 'security',
      'Microsoft 365': 'unified',
    }) || 'security'

    const isUnified = resolvedType === 'unified'

    const body = cleanupObject({
      displayName,
      mailNickname,
      description,
      groupTypes: isUnified ? ['Unified'] : [],
      mailEnabled: isUnified,
      securityEnabled: !isUnified,
    })

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
   * @appearanceColor #0F6CBD #004578
   * @description Updates writable properties of an existing group, such as display name or description. Only the fields you provide are changed. Returns a confirmation message; Microsoft Graph returns no content on a successful update.
   * @route PATCH /update-group
   * @paramDef {"type":"String","label":"Group","name":"groupId","required":true,"dictionary":"getGroupsDictionary","description":"The object ID of the group to update. Choose a group or paste an ID."}
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","description":"An updated display name for the group."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"An updated description for the group."}
   * @paramDef {"type":"String","label":"Mail Nickname","name":"mailNickname","description":"An updated mail alias for the group. Must not contain spaces or the characters @ () \\ [] \" ; : <> ,."}
   * @returns {Object}
   * @sampleResult {"message":"Group updated successfully","groupId":"b320ee12-b1cd-4cca-b648-a437be61c5cd"}
   */
  async updateGroup(groupId, displayName, description, mailNickname) {
    if (!groupId) {
      throw new Error('Parameter "Group" is required')
    }

    const body = cleanupObject({
      displayName,
      description,
      mailNickname,
    })

    if (Object.keys(body).length === 0) {
      throw new Error('Provide at least one property to update')
    }

    await this.#apiRequest({
      url: `${ API_BASE_URL }/groups/${ encodeURIComponent(groupId) }`,
      logTag: 'updateGroup',
      method: 'patch',
      body,
    })

    return { message: 'Group updated successfully', groupId }
  }

  /**
   * @operationName Delete Group
   * @category Groups
   * @appearanceColor #0F6CBD #004578
   * @description Deletes a group from the directory. Microsoft 365 groups are moved to the deleted items container and can be restored within 30 days; security groups are deleted permanently.
   * @route DELETE /delete-group
   * @paramDef {"type":"String","label":"Group","name":"groupId","required":true,"dictionary":"getGroupsDictionary","description":"The object ID of the group to delete. Choose a group or paste an ID."}
   * @returns {Object}
   * @sampleResult {"message":"Group deleted successfully","groupId":"b320ee12-b1cd-4cca-b648-a437be61c5cd"}
   */
  async deleteGroup(groupId) {
    if (!groupId) {
      throw new Error('Parameter "Group" is required')
    }

    await this.#apiRequest({
      url: `${ API_BASE_URL }/groups/${ encodeURIComponent(groupId) }`,
      logTag: 'deleteGroup',
      method: 'delete',
    })

    return { message: 'Group deleted successfully', groupId }
  }

  /**
   * @operationName List Group Members
   * @category Groups
   * @appearanceColor #0F6CBD #004578
   * @description Retrieves the direct members of a group, which may include users, other groups, service principals, and devices. Returns a paginated list; follow the @odata.nextLink value using the Next Page Link parameter to retrieve additional pages.
   * @route GET /list-group-members
   * @paramDef {"type":"String","label":"Group","name":"groupId","required":true,"dictionary":"getGroupsDictionary","description":"The object ID of the group whose members to list. Choose a group or paste an ID."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"The @odata.nextLink URL from a previous response used to retrieve the next page. When provided, the Group parameter is ignored."}
   * @returns {Object}
   * @sampleResult {"value":[{"@odata.type":"#microsoft.graph.user","id":"87d349ed-44d7-43e1-9a83-5f2406dee5bd","displayName":"Adele Vance","userPrincipalName":"AdeleV@contoso.com"}]}
   */
  async listGroupMembers(groupId, nextLink) {
    if (nextLink) {
      return this.#apiRequest({
        url: nextLink,
        logTag: 'listGroupMembers',
      })
    }

    if (!groupId) {
      throw new Error('Parameter "Group" is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/groups/${ encodeURIComponent(groupId) }/members`,
      logTag: 'listGroupMembers',
    })
  }

  /**
   * @operationName Add Group Member
   * @category Groups
   * @appearanceColor #0F6CBD #004578
   * @description Adds a user as a member of a group. Returns a confirmation message; Microsoft Graph returns no content on success.
   * @route POST /add-group-member
   * @paramDef {"type":"String","label":"Group","name":"groupId","required":true,"dictionary":"getGroupsDictionary","description":"The object ID of the group to add the member to. Choose a group or paste an ID."}
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The object ID of the user to add as a member. Choose a user or paste an object ID (a UPN is not accepted here)."}
   * @returns {Object}
   * @sampleResult {"message":"Member added successfully","groupId":"b320ee12-b1cd-4cca-b648-a437be61c5cd","userId":"87d349ed-44d7-43e1-9a83-5f2406dee5bd"}
   */
  async addGroupMember(groupId, userId) {
    if (!groupId) {
      throw new Error('Parameter "Group" is required')
    }

    if (!userId) {
      throw new Error('Parameter "User" is required')
    }

    const body = {
      '@odata.id': `${ API_BASE_URL }/directoryObjects/${ userId }`,
    }

    await this.#apiRequest({
      url: `${ API_BASE_URL }/groups/${ encodeURIComponent(groupId) }/members/$ref`,
      logTag: 'addGroupMember',
      method: 'post',
      body,
    })

    return { message: 'Member added successfully', groupId, userId }
  }

  /**
   * @operationName Remove Group Member
   * @category Groups
   * @appearanceColor #0F6CBD #004578
   * @description Removes a user from a group's membership. This does not delete the user. Returns a confirmation message; Microsoft Graph returns no content on success.
   * @route DELETE /remove-group-member
   * @paramDef {"type":"String","label":"Group","name":"groupId","required":true,"dictionary":"getGroupsDictionary","description":"The object ID of the group to remove the member from. Choose a group or paste an ID."}
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The object ID of the user to remove. Choose a user or paste an object ID."}
   * @returns {Object}
   * @sampleResult {"message":"Member removed successfully","groupId":"b320ee12-b1cd-4cca-b648-a437be61c5cd","userId":"87d349ed-44d7-43e1-9a83-5f2406dee5bd"}
   */
  async removeGroupMember(groupId, userId) {
    if (!groupId) {
      throw new Error('Parameter "Group" is required')
    }

    if (!userId) {
      throw new Error('Parameter "User" is required')
    }

    await this.#apiRequest({
      url: `${ API_BASE_URL }/groups/${ encodeURIComponent(groupId) }/members/${ encodeURIComponent(userId) }/$ref`,
      logTag: 'removeGroupMember',
      method: 'delete',
    })

    return { message: 'Member removed successfully', groupId, userId }
  }

  /**
   * @operationName Add Group Owner
   * @category Groups
   * @appearanceColor #0F6CBD #004578
   * @description Adds a user as an owner of a group. Owners can manage the group's membership and settings. Returns a confirmation message; Microsoft Graph returns no content on success.
   * @route POST /add-group-owner
   * @paramDef {"type":"String","label":"Group","name":"groupId","required":true,"dictionary":"getGroupsDictionary","description":"The object ID of the group to add the owner to. Choose a group or paste an ID."}
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The object ID of the user to add as an owner. Choose a user or paste an object ID."}
   * @returns {Object}
   * @sampleResult {"message":"Owner added successfully","groupId":"b320ee12-b1cd-4cca-b648-a437be61c5cd","userId":"87d349ed-44d7-43e1-9a83-5f2406dee5bd"}
   */
  async addGroupOwner(groupId, userId) {
    if (!groupId) {
      throw new Error('Parameter "Group" is required')
    }

    if (!userId) {
      throw new Error('Parameter "User" is required')
    }

    const body = {
      '@odata.id': `${ API_BASE_URL }/users/${ userId }`,
    }

    await this.#apiRequest({
      url: `${ API_BASE_URL }/groups/${ encodeURIComponent(groupId) }/owners/$ref`,
      logTag: 'addGroupOwner',
      method: 'post',
      body,
    })

    return { message: 'Owner added successfully', groupId, userId }
  }

  /**
   * @operationName List Directory Roles
   * @category Directory Roles
   * @appearanceColor #0F6CBD #004578
   * @description Retrieves the directory roles that are activated in the tenant, such as Global Administrator or User Administrator, including each role's ID, display name, and role template ID.
   * @route GET /list-directory-roles
   * @returns {Object}
   * @sampleResult {"value":[{"id":"5b3fe339-e832-4587-ab7c-3c1f45a58e97","displayName":"Global Administrator","roleTemplateId":"62e90394-69f5-4237-9190-012177145e10","description":"Can manage all aspects of Microsoft Entra ID and Microsoft services that use Microsoft Entra identities."}]}
   */
  listDirectoryRoles() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/directoryRoles`,
      logTag: 'listDirectoryRoles',
    })
  }

  /**
   * @operationName List Directory Role Members
   * @category Directory Roles
   * @appearanceColor #0F6CBD #004578
   * @description Retrieves the members (principals) assigned to a directory role. Provide the role's object ID, obtained from List Directory Roles. Returns a paginated list; follow the @odata.nextLink value using the Next Page Link parameter to retrieve additional pages.
   * @route GET /list-directory-role-members
   * @paramDef {"type":"String","label":"Role ID","name":"roleId","required":true,"description":"The object ID of the directory role, obtained from List Directory Roles. This is the role's id, not its roleTemplateId."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"The @odata.nextLink URL from a previous response used to retrieve the next page. When provided, the Role ID parameter is ignored."}
   * @returns {Object}
   * @sampleResult {"value":[{"@odata.type":"#microsoft.graph.user","id":"87d349ed-44d7-43e1-9a83-5f2406dee5bd","displayName":"Adele Vance","userPrincipalName":"AdeleV@contoso.com"}]}
   */
  async listDirectoryRoleMembers(roleId, nextLink) {
    if (nextLink) {
      return this.#apiRequest({
        url: nextLink,
        logTag: 'listDirectoryRoleMembers',
      })
    }

    if (!roleId) {
      throw new Error('Parameter "Role ID" is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/directoryRoles/${ encodeURIComponent(roleId) }/members`,
      logTag: 'listDirectoryRoleMembers',
    })
  }

  /**
   * @operationName Invite Guest User
   * @category Invitations
   * @appearanceColor #0F6CBD #004578
   * @description Invites an external user to the directory as a B2B guest. Optionally send them the standard invitation email. Returns the invitation, including a redeem URL the guest can use to accept if no email is sent.
   * @route POST /invite-guest-user
   * @paramDef {"type":"String","label":"Guest Email","name":"invitedUserEmailAddress","required":true,"description":"The email address of the external user to invite."}
   * @paramDef {"type":"String","label":"Redirect URL","name":"inviteRedirectUrl","required":true,"description":"The URL the guest is redirected to after accepting the invitation, for example: https://myapps.microsoft.com."}
   * @paramDef {"type":"String","label":"Display Name","name":"invitedUserDisplayName","description":"An optional display name for the invited guest user."}
   * @paramDef {"type":"Boolean","label":"Send Invitation Email","name":"sendInvitationMessage","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"Whether to send the guest the standard invitation email. Defaults to true. When false, use the returned redeem URL to deliver the invitation yourself."}
   * @returns {Object}
   * @sampleResult {"id":"7b92124c-9fa9-4837-98b1-cf7b85de69e2","invitedUserEmailAddress":"guest@external.com","inviteRedeemUrl":"https://login.microsoftonline.com/redeem?...","status":"PendingAcceptance","invitedUser":{"id":"243b1de4-ba8f-4711-8bc6-ab4d5c94f19a"}}
   */
  async inviteGuestUser(invitedUserEmailAddress, inviteRedirectUrl, invitedUserDisplayName, sendInvitationMessage) {
    if (!invitedUserEmailAddress) {
      throw new Error('Parameter "Guest Email" is required')
    }

    if (!inviteRedirectUrl) {
      throw new Error('Parameter "Redirect URL" is required')
    }

    const body = cleanupObject({
      invitedUserEmailAddress,
      inviteRedirectUrl,
      invitedUserDisplayName,
      sendInvitationMessage: sendInvitationMessage === undefined ? true : sendInvitationMessage,
    })

    return this.#apiRequest({
      url: `${ API_BASE_URL }/invitations`,
      logTag: 'inviteGuestUser',
      method: 'post',
      body,
    })
  }

  /**
   * @operationName List Applications
   * @category Applications
   * @appearanceColor #0F6CBD #004578
   * @description Retrieves the application registrations in the directory, including each application's ID, app ID, and display name. Returns a paginated list; follow the @odata.nextLink value using the Next Page Link parameter to retrieve additional pages.
   * @route GET /list-applications
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Optional OData $filter expression, for example: startsWith(displayName,'Contoso')."}
   * @paramDef {"type":"Number","label":"Max Results","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of applications to return per page. Defaults to 25. Microsoft Graph allows up to 999."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"The @odata.nextLink URL from a previous response used to retrieve the next page. When provided, all other parameters are ignored."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"acc848e9-e8ec-4feb-a521-8d58b5482e09","appId":"00000000-0000-0000-0000-000000000000","displayName":"Contoso Web App","signInAudience":"AzureADMyOrg"}]}
   */
  async listApplications(filter, top, nextLink) {
    if (nextLink) {
      return this.#apiRequest({
        url: nextLink,
        logTag: 'listApplications',
      })
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/applications`,
      query: {
        $filter: filter,
        $top: top ? Math.min(top, 999) : PAGE_SIZE_DICTIONARY,
      },
      logTag: 'listApplications',
    })
  }

  /**
   * @operationName List Service Principals
   * @category Applications
   * @appearanceColor #0F6CBD #004578
   * @description Retrieves the service principals (enterprise applications) in the directory, including each service principal's ID, app ID, and display name. Returns a paginated list; follow the @odata.nextLink value using the Next Page Link parameter to retrieve additional pages.
   * @route GET /list-service-principals
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Optional OData $filter expression, for example: startsWith(displayName,'Contoso')."}
   * @paramDef {"type":"Number","label":"Max Results","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of service principals to return per page. Defaults to 25. Microsoft Graph allows up to 999."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"The @odata.nextLink URL from a previous response used to retrieve the next page. When provided, all other parameters are ignored."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"59e617e5-e447-4adc-8b88-00af644d7c92","appId":"00000000-0000-0000-0000-000000000000","displayName":"Contoso Enterprise App","servicePrincipalType":"Application"}]}
   */
  async listServicePrincipals(filter, top, nextLink) {
    if (nextLink) {
      return this.#apiRequest({
        url: nextLink,
        logTag: 'listServicePrincipals',
      })
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/servicePrincipals`,
      query: {
        $filter: filter,
        $top: top ? Math.min(top, 999) : PAGE_SIZE_DICTIONARY,
      },
      logTag: 'listServicePrincipals',
    })
  }
}

Flowrunner.ServerCode.addService(MicrosoftEntraIdService, [
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
  const email = user.mail || user.userPrincipalName

  if (email && user.displayName) {
    return `${ email } (${ user.displayName })`
  }

  return email || user.displayName || 'Microsoft Entra ID Connection'
}
