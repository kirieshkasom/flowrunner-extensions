'use strict'

const { jsonRequest } = require('./aws-client')
const { CredentialProvider } = require('./credentials')
const { createLogger, mapAwsError } = require('./errors')
const { awsConfigItems } = require('./config-items')

const TARGET_PREFIX = 'AWSCognitoIdentityProviderService'
const CONTENT_TYPE = 'application/x-amz-json-1.1'

const MESSAGE_ACTIONS = { Suppress: 'SUPPRESS', Resend: 'RESEND' }

/**
 * @typedef {Object} getUserPoolsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter matched against user pool name or ID."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call."}
 */

/**
 * @typedef {Object} getGroupsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"User Pool ID","name":"userPoolId","description":"The user pool whose groups are listed."}
 */

/**
 * @typedef {Object} getGroupsDictionary__payload
 * @paramDef {"type":"getGroupsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Dependent criteria; supplies the user pool ID."}
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text filter matched against group name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call."}
 */

/**
 * @integrationName AWS Cognito
 * @integrationIcon /icon.svg
 */
class Cognito {
  constructor(config = {}) {
    this.region = config.region || 'us-east-1'
    this.logger = createLogger('AWS Cognito')

    this.credentials = new CredentialProvider({
      authenticationMethod: config.authenticationMethod || 'API Key',
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: this.region,
      roleArn: config.roleArn,
      externalId: config.externalId,
    })

    this.deps = { jsonRequest }
  }

  async sendJson(operation, body) {
    const creds = await this.credentials.resolve()

    return this.deps.jsonRequest(
      { region: this.region, service: 'cognito-idp', target: `${ TARGET_PREFIX }.${ operation }`, contentType: CONTENT_TYPE, body },
      creds
    )
  }

  // Maps a friendly dropdown label to its API value; passes unknown values through unchanged.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Converts a plain attributes object ({ email: "x" }) into Cognito's [{Name, Value}] format.
  #toAttributeList(attributes) {
    if (!attributes || typeof attributes !== 'object') return []

    return Object.entries(attributes).map(([Name, Value]) => ({ Name, Value: Value === null || Value === undefined ? '' : String(Value) }))
  }

  // Converts Cognito's [{Name, Value}] format back into a plain object.
  #fromAttributeList(list) {
    const out = {}

    for (const attr of list || []) {
      out[attr.Name] = attr.Value
    }

    return out
  }

  // ---------------------------------------------------------------------------
  // Users (admin)
  // ---------------------------------------------------------------------------

  /**
   * @operationName Admin Create User
   * @description Creates a new user in the specified user pool as an administrator. Supply user attributes as a plain JSON object (e.g. {"email":"a@b.com","phone_number":"+15555550100"}) which is converted to Cognito's attribute format. Optionally set a temporary password, suppress or resend the invitation message, and choose delivery mediums. Cognito sends an invitation with a temporary password unless suppressed.
   * @category User Management
   * @route POST /admin-create-user
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"User Pool ID","name":"userPoolId","required":true,"dictionary":"getUserPoolsDictionary","description":"The ID of the user pool to create the user in."}
   * @paramDef {"type":"String","label":"Username","name":"username","required":true,"description":"The username for the new user. Must be unique within the user pool."}
   * @paramDef {"type":"Object","label":"Attributes","name":"attributes","required":false,"description":"User attributes as a plain JSON object keyed by attribute name (e.g. {\"email\":\"a@b.com\",\"email_verified\":\"true\",\"name\":\"Ada\"}). Custom attributes use the custom: prefix."}
   * @paramDef {"type":"String","label":"Temporary Password","name":"temporaryPassword","required":false,"description":"An optional temporary password for the user. If omitted, Cognito generates one. The user must change it on first sign-in."}
   * @paramDef {"type":"String","label":"Message Action","name":"messageAction","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["Suppress","Resend"]}},"description":"Suppress to create the user without sending an invitation; Resend to resend an existing invitation. Leave empty to send a new invitation."}
   * @paramDef {"type":"Array<String>","label":"Delivery Mediums","name":"desiredDeliveryMediums","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["EMAIL","SMS"]}},"description":"How to deliver the invitation message. Defaults to SMS when omitted."}
   * @returns {Object}
   * @sampleResult {"user":{"Username":"ada","Attributes":{"email":"a@b.com","sub":"1234"},"UserStatus":"FORCE_CHANGE_PASSWORD","Enabled":true}}
   */
  async adminCreateUser(userPoolId, username, attributes, temporaryPassword, messageAction, desiredDeliveryMediums) {
    if (!userPoolId) throw new Error('userPoolId is required.')
    if (!username) throw new Error('username is required.')

    try {
      const body = { UserPoolId: userPoolId, Username: username }
      const attrList = this.#toAttributeList(attributes)

      if (attrList.length) body.UserAttributes = attrList
      if (temporaryPassword) body.TemporaryPassword = temporaryPassword

      const action = this.#resolveChoice(messageAction, MESSAGE_ACTIONS)

      if (action) body.MessageAction = action
      if (Array.isArray(desiredDeliveryMediums) && desiredDeliveryMediums.length) body.DesiredDeliveryMediums = desiredDeliveryMediums

      const res = await this.sendJson('AdminCreateUser', body)
      const user = res.User || {}

      return { user: { ...user, Attributes: this.#fromAttributeList(user.Attributes) } }
    } catch (error) {
      this.#handleError('adminCreateUser', error)
    }
  }

  /**
   * @operationName Admin Get User
   * @description Retrieves a single user from a user pool by username, as an administrator. Returns the user's attributes as a plain JSON object along with status, enabled flag, and MFA settings.
   * @category User Management
   * @route GET /admin-get-user
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"User Pool ID","name":"userPoolId","required":true,"dictionary":"getUserPoolsDictionary","description":"The ID of the user pool that contains the user."}
   * @paramDef {"type":"String","label":"Username","name":"username","required":true,"description":"The username, sub, or an alias (email/phone) of the user to retrieve."}
   * @returns {Object}
   * @sampleResult {"username":"ada","userStatus":"CONFIRMED","enabled":true,"attributes":{"email":"a@b.com","sub":"1234"},"createDate":1700000000,"lastModifiedDate":1700000000}
   */
  async adminGetUser(userPoolId, username) {
    if (!userPoolId) throw new Error('userPoolId is required.')
    if (!username) throw new Error('username is required.')

    try {
      const res = await this.sendJson('AdminGetUser', { UserPoolId: userPoolId, Username: username })

      return {
        username: res.Username,
        userStatus: res.UserStatus,
        enabled: res.Enabled,
        attributes: this.#fromAttributeList(res.UserAttributes),
        mfaOptions: res.MFAOptions || [],
        preferredMfaSetting: res.PreferredMfaSetting || null,
        userMFASettingList: res.UserMFASettingList || [],
        createDate: res.UserCreateDate,
        lastModifiedDate: res.UserLastModifiedDate,
      }
    } catch (error) {
      this.#handleError('adminGetUser', error)
    }
  }

  /**
   * @operationName List Users
   * @description Lists and searches users in a user pool. Optionally filter by an attribute (e.g. email = "a@b.com" or "name ^= \"Ad\""), limit the page size, restrict which attributes are returned, and paginate with a pagination token. Returns users with attributes as plain JSON.
   * @category User Management
   * @route GET /list-users
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"User Pool ID","name":"userPoolId","required":true,"dictionary":"getUserPoolsDictionary","description":"The ID of the user pool to list users from."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","required":false,"description":"An attribute filter string, e.g. email = \"a@b.com\", or username ^= \"a\" (starts-with). Omit to return all users."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of users to return per page (1-60)."}
   * @paramDef {"type":"Array<String>","label":"Attributes To Get","name":"attributesToGet","required":false,"description":"Optional list of attribute names to return for each user (e.g. [\"email\",\"name\"]). Returns all attributes when omitted."}
   * @paramDef {"type":"String","label":"Pagination Token","name":"paginationToken","required":false,"description":"Pagination token returned by a previous call. Omit for the first page."}
   * @returns {Object}
   * @sampleResult {"users":[{"Username":"ada","Attributes":{"email":"a@b.com"},"UserStatus":"CONFIRMED","Enabled":true}],"paginationToken":null}
   */
  async listUsers(userPoolId, filter, limit, attributesToGet, paginationToken) {
    if (!userPoolId) throw new Error('userPoolId is required.')

    try {
      const body = { UserPoolId: userPoolId }

      if (filter) body.Filter = filter
      if (limit) body.Limit = limit
      if (Array.isArray(attributesToGet) && attributesToGet.length) body.AttributesToGet = attributesToGet
      if (paginationToken) body.PaginationToken = paginationToken

      const res = await this.sendJson('ListUsers', body)

      return {
        users: (res.Users || []).map(u => ({ ...u, Attributes: this.#fromAttributeList(u.Attributes) })),
        paginationToken: res.PaginationToken || null,
      }
    } catch (error) {
      this.#handleError('listUsers', error)
    }
  }

  /**
   * @operationName Admin Update User Attributes
   * @description Updates one or more attributes of a user as an administrator. Supply the attributes to set as a plain JSON object (e.g. {"email":"new@b.com","email_verified":"true"}). Attributes not included are left unchanged.
   * @category User Management
   * @route POST /admin-update-user-attributes
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"User Pool ID","name":"userPoolId","required":true,"dictionary":"getUserPoolsDictionary","description":"The ID of the user pool that contains the user."}
   * @paramDef {"type":"String","label":"Username","name":"username","required":true,"description":"The username, sub, or alias of the user to update."}
   * @paramDef {"type":"Object","label":"Attributes","name":"attributes","required":true,"description":"Attributes to set as a plain JSON object keyed by attribute name (e.g. {\"email\":\"new@b.com\",\"name\":\"Ada L\"})."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async adminUpdateUserAttributes(userPoolId, username, attributes) {
    if (!userPoolId) throw new Error('userPoolId is required.')
    if (!username) throw new Error('username is required.')

    const attrList = this.#toAttributeList(attributes)

    if (!attrList.length) throw new Error('attributes must contain at least one attribute to update.')

    try {
      await this.sendJson('AdminUpdateUserAttributes', { UserPoolId: userPoolId, Username: username, UserAttributes: attrList })

      return { success: true }
    } catch (error) {
      this.#handleError('adminUpdateUserAttributes', error)
    }
  }

  /**
   * @operationName Admin Delete User
   * @description Permanently deletes a user from a user pool as an administrator. This action cannot be undone.
   * @category User Management
   * @route DELETE /admin-delete-user
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"User Pool ID","name":"userPoolId","required":true,"dictionary":"getUserPoolsDictionary","description":"The ID of the user pool that contains the user."}
   * @paramDef {"type":"String","label":"Username","name":"username","required":true,"description":"The username, sub, or alias of the user to delete."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async adminDeleteUser(userPoolId, username) {
    if (!userPoolId) throw new Error('userPoolId is required.')
    if (!username) throw new Error('username is required.')

    try {
      await this.sendJson('AdminDeleteUser', { UserPoolId: userPoolId, Username: username })

      return { success: true }
    } catch (error) {
      this.#handleError('adminDeleteUser', error)
    }
  }

  /**
   * @operationName Admin Enable User
   * @description Enables a previously disabled user as an administrator, allowing them to sign in again.
   * @category User Management
   * @route POST /admin-enable-user
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"User Pool ID","name":"userPoolId","required":true,"dictionary":"getUserPoolsDictionary","description":"The ID of the user pool that contains the user."}
   * @paramDef {"type":"String","label":"Username","name":"username","required":true,"description":"The username, sub, or alias of the user to enable."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async adminEnableUser(userPoolId, username) {
    if (!userPoolId) throw new Error('userPoolId is required.')
    if (!username) throw new Error('username is required.')

    try {
      await this.sendJson('AdminEnableUser', { UserPoolId: userPoolId, Username: username })

      return { success: true }
    } catch (error) {
      this.#handleError('adminEnableUser', error)
    }
  }

  /**
   * @operationName Admin Disable User
   * @description Disables a user as an administrator, preventing them from signing in until re-enabled. Existing tokens remain valid until they expire.
   * @category User Management
   * @route POST /admin-disable-user
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"User Pool ID","name":"userPoolId","required":true,"dictionary":"getUserPoolsDictionary","description":"The ID of the user pool that contains the user."}
   * @paramDef {"type":"String","label":"Username","name":"username","required":true,"description":"The username, sub, or alias of the user to disable."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async adminDisableUser(userPoolId, username) {
    if (!userPoolId) throw new Error('userPoolId is required.')
    if (!username) throw new Error('username is required.')

    try {
      await this.sendJson('AdminDisableUser', { UserPoolId: userPoolId, Username: username })

      return { success: true }
    } catch (error) {
      this.#handleError('adminDisableUser', error)
    }
  }

  /**
   * @operationName Admin Reset User Password
   * @description Resets a user's password as an administrator and sets their status to RESET_REQUIRED. Cognito sends the user a message with a code to set a new password on their next sign-in.
   * @category User Management
   * @route POST /admin-reset-user-password
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"User Pool ID","name":"userPoolId","required":true,"dictionary":"getUserPoolsDictionary","description":"The ID of the user pool that contains the user."}
   * @paramDef {"type":"String","label":"Username","name":"username","required":true,"description":"The username, sub, or alias of the user whose password to reset."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async adminResetUserPassword(userPoolId, username) {
    if (!userPoolId) throw new Error('userPoolId is required.')
    if (!username) throw new Error('username is required.')

    try {
      await this.sendJson('AdminResetUserPassword', { UserPoolId: userPoolId, Username: username })

      return { success: true }
    } catch (error) {
      this.#handleError('adminResetUserPassword', error)
    }
  }

  /**
   * @operationName Admin Set User Password
   * @description Sets a user's password directly as an administrator. When Permanent is true the password is final and the user's status becomes CONFIRMED; when false it is temporary and the user must change it on next sign-in (status FORCE_CHANGE_PASSWORD).
   * @category User Management
   * @route POST /admin-set-user-password
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"User Pool ID","name":"userPoolId","required":true,"dictionary":"getUserPoolsDictionary","description":"The ID of the user pool that contains the user."}
   * @paramDef {"type":"String","label":"Username","name":"username","required":true,"description":"The username, sub, or alias of the user whose password to set."}
   * @paramDef {"type":"String","label":"Password","name":"password","required":true,"description":"The new password. Must satisfy the user pool's password policy."}
   * @paramDef {"type":"Boolean","label":"Permanent","name":"permanent","required":false,"uiComponent":{"type":"CHECKBOX"},"description":"True to set a permanent password (status CONFIRMED); false (default) for a temporary password the user must change."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async adminSetUserPassword(userPoolId, username, password, permanent) {
    if (!userPoolId) throw new Error('userPoolId is required.')
    if (!username) throw new Error('username is required.')
    if (!password) throw new Error('password is required.')

    try {
      await this.sendJson('AdminSetUserPassword', { UserPoolId: userPoolId, Username: username, Password: password, Permanent: permanent === true })

      return { success: true }
    } catch (error) {
      this.#handleError('adminSetUserPassword', error)
    }
  }

  /**
   * @operationName Admin Confirm Sign Up
   * @description Confirms a user's sign-up as an administrator, without requiring the confirmation code. Moves a user from UNCONFIRMED to CONFIRMED status so they can sign in.
   * @category User Management
   * @route POST /admin-confirm-sign-up
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"User Pool ID","name":"userPoolId","required":true,"dictionary":"getUserPoolsDictionary","description":"The ID of the user pool that contains the user."}
   * @paramDef {"type":"String","label":"Username","name":"username","required":true,"description":"The username of the user to confirm."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async adminConfirmSignUp(userPoolId, username) {
    if (!userPoolId) throw new Error('userPoolId is required.')
    if (!username) throw new Error('username is required.')

    try {
      await this.sendJson('AdminConfirmSignUp', { UserPoolId: userPoolId, Username: username })

      return { success: true }
    } catch (error) {
      this.#handleError('adminConfirmSignUp', error)
    }
  }

  // ---------------------------------------------------------------------------
  // Groups
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Group
   * @description Creates a new group in a user pool. Groups can carry a description, a precedence (lower numbers take priority when a user belongs to multiple groups), and an optional IAM role ARN for identity-pool role mapping.
   * @category Group Management
   * @route POST /create-group
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"User Pool ID","name":"userPoolId","required":true,"dictionary":"getUserPoolsDictionary","description":"The ID of the user pool to create the group in."}
   * @paramDef {"type":"String","label":"Group Name","name":"groupName","required":true,"description":"The name of the new group. Must be unique within the user pool."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":false,"description":"An optional description of the group."}
   * @paramDef {"type":"Number","label":"Precedence","name":"precedence","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional precedence value; a lower number takes priority when a user is in multiple groups."}
   * @paramDef {"type":"String","label":"Role ARN","name":"roleArn","required":false,"description":"Optional IAM role ARN assigned to members of this group for identity-pool role mapping."}
   * @returns {Object}
   * @sampleResult {"group":{"GroupName":"admins","UserPoolId":"us-east-1_abc","Description":"Admins","Precedence":1}}
   */
  async createGroup(userPoolId, groupName, description, precedence, roleArn) {
    if (!userPoolId) throw new Error('userPoolId is required.')
    if (!groupName) throw new Error('groupName is required.')

    try {
      const body = { UserPoolId: userPoolId, GroupName: groupName }

      if (description) body.Description = description
      if (precedence !== undefined && precedence !== null && precedence !== '') body.Precedence = precedence
      if (roleArn) body.RoleArn = roleArn

      const res = await this.sendJson('CreateGroup', body)

      return { group: res.Group || null }
    } catch (error) {
      this.#handleError('createGroup', error)
    }
  }

  /**
   * @operationName List Groups
   * @description Lists the groups in a user pool. Supports page-size limiting and pagination via a next token.
   * @category Group Management
   * @route GET /list-groups
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"User Pool ID","name":"userPoolId","required":true,"dictionary":"getUserPoolsDictionary","description":"The ID of the user pool to list groups from."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of groups to return per page (1-60)."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","required":false,"description":"Pagination token returned by a previous call. Omit for the first page."}
   * @returns {Object}
   * @sampleResult {"groups":[{"GroupName":"admins","Precedence":1}],"nextToken":null}
   */
  async listGroups(userPoolId, limit, nextToken) {
    if (!userPoolId) throw new Error('userPoolId is required.')

    try {
      const body = { UserPoolId: userPoolId }

      if (limit) body.Limit = limit
      if (nextToken) body.NextToken = nextToken

      const res = await this.sendJson('ListGroups', body)

      return { groups: res.Groups || [], nextToken: res.NextToken || null }
    } catch (error) {
      this.#handleError('listGroups', error)
    }
  }

  /**
   * @operationName Get Group
   * @description Retrieves the details of a single group in a user pool by name, including its description, precedence, and role ARN.
   * @category Group Management
   * @route GET /get-group
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"User Pool ID","name":"userPoolId","required":true,"dictionary":"getUserPoolsDictionary","description":"The ID of the user pool that contains the group."}
   * @paramDef {"type":"String","label":"Group Name","name":"groupName","required":true,"dictionary":"getGroupsDictionary","description":"The name of the group to retrieve."}
   * @returns {Object}
   * @sampleResult {"group":{"GroupName":"admins","UserPoolId":"us-east-1_abc","Description":"Admins","Precedence":1}}
   */
  async getGroup(userPoolId, groupName) {
    if (!userPoolId) throw new Error('userPoolId is required.')
    if (!groupName) throw new Error('groupName is required.')

    try {
      const res = await this.sendJson('GetGroup', { UserPoolId: userPoolId, GroupName: groupName })

      return { group: res.Group || null }
    } catch (error) {
      this.#handleError('getGroup', error)
    }
  }

  /**
   * @operationName Delete Group
   * @description Deletes a group from a user pool. Users are not deleted, but they lose membership of the group.
   * @category Group Management
   * @route DELETE /delete-group
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"User Pool ID","name":"userPoolId","required":true,"dictionary":"getUserPoolsDictionary","description":"The ID of the user pool that contains the group."}
   * @paramDef {"type":"String","label":"Group Name","name":"groupName","required":true,"dictionary":"getGroupsDictionary","description":"The name of the group to delete."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteGroup(userPoolId, groupName) {
    if (!userPoolId) throw new Error('userPoolId is required.')
    if (!groupName) throw new Error('groupName is required.')

    try {
      await this.sendJson('DeleteGroup', { UserPoolId: userPoolId, GroupName: groupName })

      return { success: true }
    } catch (error) {
      this.#handleError('deleteGroup', error)
    }
  }

  /**
   * @operationName Admin Add User To Group
   * @description Adds a user to a group as an administrator. If the user is already a member the call succeeds without change.
   * @category Group Management
   * @route POST /admin-add-user-to-group
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"User Pool ID","name":"userPoolId","required":true,"dictionary":"getUserPoolsDictionary","description":"The ID of the user pool that contains the user and group."}
   * @paramDef {"type":"String","label":"Username","name":"username","required":true,"description":"The username, sub, or alias of the user to add."}
   * @paramDef {"type":"String","label":"Group Name","name":"groupName","required":true,"dictionary":"getGroupsDictionary","description":"The name of the group to add the user to."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async adminAddUserToGroup(userPoolId, username, groupName) {
    if (!userPoolId) throw new Error('userPoolId is required.')
    if (!username) throw new Error('username is required.')
    if (!groupName) throw new Error('groupName is required.')

    try {
      await this.sendJson('AdminAddUserToGroup', { UserPoolId: userPoolId, Username: username, GroupName: groupName })

      return { success: true }
    } catch (error) {
      this.#handleError('adminAddUserToGroup', error)
    }
  }

  /**
   * @operationName Admin Remove User From Group
   * @description Removes a user from a group as an administrator.
   * @category Group Management
   * @route POST /admin-remove-user-from-group
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"User Pool ID","name":"userPoolId","required":true,"dictionary":"getUserPoolsDictionary","description":"The ID of the user pool that contains the user and group."}
   * @paramDef {"type":"String","label":"Username","name":"username","required":true,"description":"The username, sub, or alias of the user to remove."}
   * @paramDef {"type":"String","label":"Group Name","name":"groupName","required":true,"dictionary":"getGroupsDictionary","description":"The name of the group to remove the user from."}
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async adminRemoveUserFromGroup(userPoolId, username, groupName) {
    if (!userPoolId) throw new Error('userPoolId is required.')
    if (!username) throw new Error('username is required.')
    if (!groupName) throw new Error('groupName is required.')

    try {
      await this.sendJson('AdminRemoveUserFromGroup', { UserPoolId: userPoolId, Username: username, GroupName: groupName })

      return { success: true }
    } catch (error) {
      this.#handleError('adminRemoveUserFromGroup', error)
    }
  }

  /**
   * @operationName Admin List Groups For User
   * @description Lists the groups that a user belongs to, as an administrator. Supports page-size limiting and pagination via a next token.
   * @category Group Management
   * @route GET /admin-list-groups-for-user
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"User Pool ID","name":"userPoolId","required":true,"dictionary":"getUserPoolsDictionary","description":"The ID of the user pool that contains the user."}
   * @paramDef {"type":"String","label":"Username","name":"username","required":true,"description":"The username, sub, or alias of the user whose groups to list."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of groups to return per page (1-60)."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","required":false,"description":"Pagination token returned by a previous call. Omit for the first page."}
   * @returns {Object}
   * @sampleResult {"groups":[{"GroupName":"admins","Precedence":1}],"nextToken":null}
   */
  async adminListGroupsForUser(userPoolId, username, limit, nextToken) {
    if (!userPoolId) throw new Error('userPoolId is required.')
    if (!username) throw new Error('username is required.')

    try {
      const body = { UserPoolId: userPoolId, Username: username }

      if (limit) body.Limit = limit
      if (nextToken) body.NextToken = nextToken

      const res = await this.sendJson('AdminListGroupsForUser', body)

      return { groups: res.Groups || [], nextToken: res.NextToken || null }
    } catch (error) {
      this.#handleError('adminListGroupsForUser', error)
    }
  }

  // ---------------------------------------------------------------------------
  // User Pools
  // ---------------------------------------------------------------------------

  /**
   * @operationName List User Pools
   * @description Lists the user pools associated with the AWS account in the configured region. Supports page-size limiting and pagination via a next token.
   * @category User Pools
   * @route GET /list-user-pools
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of user pools to return per page (1-60). Defaults to 60."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","required":false,"description":"Pagination token returned by a previous call. Omit for the first page."}
   * @returns {Object}
   * @sampleResult {"userPools":[{"Id":"us-east-1_abc","Name":"MyPool"}],"nextToken":null}
   */
  async listUserPools(maxResults, nextToken) {
    try {
      const body = { MaxResults: maxResults || 60 }

      if (nextToken) body.NextToken = nextToken

      const res = await this.sendJson('ListUserPools', body)

      return { userPools: res.UserPools || [], nextToken: res.NextToken || null }
    } catch (error) {
      this.#handleError('listUserPools', error)
    }
  }

  /**
   * @operationName Describe User Pool
   * @description Returns the full configuration of a user pool, including its policies, schema, MFA configuration, email/SMS settings, and estimated number of users.
   * @category User Pools
   * @route GET /describe-user-pool
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"User Pool ID","name":"userPoolId","required":true,"dictionary":"getUserPoolsDictionary","description":"The ID of the user pool to describe."}
   * @returns {Object}
   * @sampleResult {"userPool":{"Id":"us-east-1_abc","Name":"MyPool","Status":"Enabled","EstimatedNumberOfUsers":42}}
   */
  async describeUserPool(userPoolId) {
    if (!userPoolId) throw new Error('userPoolId is required.')

    try {
      const res = await this.sendJson('DescribeUserPool', { UserPoolId: userPoolId })

      return { userPool: res.UserPool || null }
    } catch (error) {
      this.#handleError('describeUserPool', error)
    }
  }

  /**
   * @operationName Create User Pool
   * @description Creates a new Cognito user pool. Supply the pool name and, optionally, a password policy and any additional pool settings as a plain JSON object (e.g. AutoVerifiedAttributes, MfaConfiguration, Schema). Additional settings are merged into the request, letting you configure advanced options.
   * @category User Pools
   * @route POST /create-user-pool
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Pool Name","name":"poolName","required":true,"description":"The name of the new user pool."}
   * @paramDef {"type":"Object","label":"Policies","name":"policies","required":false,"description":"Optional pool policies as plain JSON, e.g. {\"PasswordPolicy\":{\"MinimumLength\":8,\"RequireUppercase\":true}}."}
   * @paramDef {"type":"Object","label":"Additional Settings","name":"additionalSettings","required":false,"description":"Optional additional CreateUserPool fields as plain JSON, e.g. {\"AutoVerifiedAttributes\":[\"email\"],\"MfaConfiguration\":\"OFF\"}. Merged into the request."}
   * @returns {Object}
   * @sampleResult {"userPool":{"Id":"us-east-1_abc","Name":"MyPool","Status":"Enabled"}}
   */
  async createUserPool(poolName, policies, additionalSettings) {
    if (!poolName) throw new Error('poolName is required.')

    try {
      const body = { PoolName: poolName }

      if (policies && typeof policies === 'object') body.Policies = policies
      if (additionalSettings && typeof additionalSettings === 'object') Object.assign(body, additionalSettings)

      const res = await this.sendJson('CreateUserPool', body)

      return { userPool: res.UserPool || null }
    } catch (error) {
      this.#handleError('createUserPool', error)
    }
  }

  // ---------------------------------------------------------------------------
  // App Clients
  // ---------------------------------------------------------------------------

  /**
   * @operationName List User Pool Clients
   * @description Lists the app clients configured for a user pool. Supports page-size limiting and pagination via a next token.
   * @category App Clients
   * @route GET /list-user-pool-clients
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"User Pool ID","name":"userPoolId","required":true,"dictionary":"getUserPoolsDictionary","description":"The ID of the user pool whose app clients to list."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of app clients to return per page (1-60)."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","required":false,"description":"Pagination token returned by a previous call. Omit for the first page."}
   * @returns {Object}
   * @sampleResult {"userPoolClients":[{"ClientId":"1abc","ClientName":"web","UserPoolId":"us-east-1_abc"}],"nextToken":null}
   */
  async listUserPoolClients(userPoolId, maxResults, nextToken) {
    if (!userPoolId) throw new Error('userPoolId is required.')

    try {
      const body = { UserPoolId: userPoolId }

      if (maxResults) body.MaxResults = maxResults
      if (nextToken) body.NextToken = nextToken

      const res = await this.sendJson('ListUserPoolClients', body)

      return { userPoolClients: res.UserPoolClients || [], nextToken: res.NextToken || null }
    } catch (error) {
      this.#handleError('listUserPoolClients', error)
    }
  }

  /**
   * @operationName Describe User Pool Client
   * @description Returns the full configuration of a single app client in a user pool, including its allowed OAuth flows, callback URLs, token validity, and authentication flows.
   * @category App Clients
   * @route GET /describe-user-pool-client
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"User Pool ID","name":"userPoolId","required":true,"dictionary":"getUserPoolsDictionary","description":"The ID of the user pool that contains the app client."}
   * @paramDef {"type":"String","label":"Client ID","name":"clientId","required":true,"description":"The ID of the app client to describe."}
   * @returns {Object}
   * @sampleResult {"userPoolClient":{"ClientId":"1abc","ClientName":"web","UserPoolId":"us-east-1_abc"}}
   */
  async describeUserPoolClient(userPoolId, clientId) {
    if (!userPoolId) throw new Error('userPoolId is required.')
    if (!clientId) throw new Error('clientId is required.')

    try {
      const res = await this.sendJson('DescribeUserPoolClient', { UserPoolId: userPoolId, ClientId: clientId })

      return { userPoolClient: res.UserPoolClient || null }
    } catch (error) {
      this.#handleError('describeUserPoolClient', error)
    }
  }

  // ---------------------------------------------------------------------------
  // Dictionaries
  // ---------------------------------------------------------------------------

  /**
   * @registerAs DICTIONARY
   * @operationName Get User Pools Dictionary
   * @description Provides a searchable list of Cognito user pools for dynamic dropdown selection in other operations. Each item's value is the user pool ID.
   * @route POST /get-user-pools-dictionary
   * @paramDef {"type":"getUserPoolsDictionary__payload","label":"Payload","name":"payload","description":"Optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"MyPool","value":"us-east-1_abc"}],"cursor":null}
   */
  async getUserPoolsDictionary(payload) {
    const { search, cursor } = payload || {}

    try {
      const body = { MaxResults: 60 }

      if (cursor) body.NextToken = cursor

      const res = await this.sendJson('ListUserPools', body)
      let pools = res.UserPools || []

      if (search) {
        const lower = search.toLowerCase()

        pools = pools.filter(p => (p.Name || '').toLowerCase().includes(lower) || (p.Id || '').toLowerCase().includes(lower))
      }

      return {
        items: pools.map(p => ({ label: p.Name || p.Id, value: p.Id, note: p.Id })),
        cursor: res.NextToken || null,
      }
    } catch (error) {
      this.#handleError('getUserPoolsDictionary', error)
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Groups Dictionary
   * @description Provides a searchable list of groups within a selected user pool for dynamic dropdown selection. Requires a user pool ID supplied via the dependent criteria.
   * @route POST /get-groups-dictionary
   * @paramDef {"type":"getGroupsDictionary__payload","label":"Payload","name":"payload","description":"User pool ID criteria plus optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"admins","value":"admins"}],"cursor":null}
   */
  async getGroupsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const userPoolId = criteria && criteria.userPoolId

    if (!userPoolId) return { items: [], cursor: null }

    try {
      const body = { UserPoolId: userPoolId, Limit: 60 }

      if (cursor) body.NextToken = cursor

      const res = await this.sendJson('ListGroups', body)
      let groups = res.Groups || []

      if (search) {
        const lower = search.toLowerCase()

        groups = groups.filter(g => (g.GroupName || '').toLowerCase().includes(lower))
      }

      return {
        items: groups.map(g => ({ label: g.GroupName, value: g.GroupName, note: g.Description || undefined })),
        cursor: res.NextToken || null,
      }
    } catch (error) {
      this.#handleError('getGroupsDictionary', error)
    }
  }

  #handleError(method, error) {
    this.logger.error(`[${ method }]`, error && error.message)

    if (error && error.name === 'UserNotFoundException') {
      throw new Error(`User not found: ${ error.message }. Check the username and user pool ID.`)
    }

    if (error && error.name === 'ResourceNotFoundException') {
      throw new Error(`Resource not found: ${ error.message }. Check the user pool ID, group name, or client ID.`)
    }

    if (error && error.name === 'UsernameExistsException') {
      throw new Error(`Username already exists: ${ error.message }.`)
    }

    if (error && error.name === 'GroupExistsException') {
      throw new Error(`Group already exists: ${ error.message }.`)
    }

    if (error && error.name === 'InvalidParameterException') {
      throw new Error(`Invalid request: ${ error.message }. Check the supplied parameters and attribute names.`)
    }

    if (error && error.name === 'InvalidPasswordException') {
      throw new Error(`Invalid password: ${ error.message }. It must satisfy the user pool's password policy.`)
    }

    if (error && error.name === 'NotAuthorizedException') {
      throw new Error(`Not authorized: ${ error.message }. Verify the operation is permitted for this user or credentials.`)
    }

    throw mapAwsError(error)
  }
}

if (typeof Flowrunner !== 'undefined') {
  Flowrunner.ServerCode.addService(Cognito, awsConfigItems)
}

module.exports = { Cognito }
