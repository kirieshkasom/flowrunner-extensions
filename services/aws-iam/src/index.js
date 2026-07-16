'use strict'

const { awsConfigItems } = require('./config-items')
const {
  iamRequest,
  stsAssumeRole,
  parseXmlTag,
  parseXmlBlocks,
  getTag,
  decodeXmlEntities,
} = require('./iam-client')

const logger = {
  info: (...args) => console.log('[AWS IAM] info:', ...args),
  debug: (...args) => console.log('[AWS IAM] debug:', ...args),
  error: (...args) => console.log('[AWS IAM] error:', ...args),
  warn: (...args) => console.log('[AWS IAM] warn:', ...args),
}

const STS_EXPIRY_BUFFER_MS = 300000 // 5 minutes

/**
 * Maps a friendly dropdown label to its API value, passing through unknown values.
 * @param {string} value
 * @param {Object} mapping
 * @returns {string|undefined}
 */
function resolveChoice(value, mapping) {
  if (value === undefined || value === null) {
    return undefined
  }

  return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
}

/**
 * Parses a single <member> user block into a clean object.
 * @param {string} block
 * @returns {Object}
 */
function parseUser(block) {
  return {
    userId: getTag(block, 'UserId'),
    userName: getTag(block, 'UserName'),
    arn: getTag(block, 'Arn'),
    path: getTag(block, 'Path'),
    createDate: getTag(block, 'CreateDate') || null,
    passwordLastUsed: getTag(block, 'PasswordLastUsed') || null,
  }
}

/**
 * Parses a single <member> group block into a clean object.
 * @param {string} block
 * @returns {Object}
 */
function parseGroup(block) {
  return {
    groupId: getTag(block, 'GroupId'),
    groupName: getTag(block, 'GroupName'),
    arn: getTag(block, 'Arn'),
    path: getTag(block, 'Path'),
    createDate: getTag(block, 'CreateDate') || null,
  }
}

/**
 * Parses a single <member> role block into a clean object.
 * @param {string} block
 * @returns {Object}
 */
function parseRole(block) {
  const doc = getTag(block, 'AssumeRolePolicyDocument')

  let assumeRolePolicyDocument = doc

  if (doc) {
    try {
      assumeRolePolicyDocument = JSON.parse(doc)
    } catch (err) {
      assumeRolePolicyDocument = doc
    }
  }

  return {
    roleId: getTag(block, 'RoleId'),
    roleName: getTag(block, 'RoleName'),
    arn: getTag(block, 'Arn'),
    path: getTag(block, 'Path'),
    description: getTag(block, 'Description') || null,
    createDate: getTag(block, 'CreateDate') || null,
    maxSessionDuration: parseXmlTag(block, 'MaxSessionDuration') ? parseInt(parseXmlTag(block, 'MaxSessionDuration'), 10) : null,
    assumeRolePolicyDocument: assumeRolePolicyDocument || null,
  }
}

/**
 * Parses a single <member> managed-policy block into a clean object.
 * @param {string} block
 * @returns {Object}
 */
function parsePolicy(block) {
  return {
    policyId: getTag(block, 'PolicyId'),
    policyName: getTag(block, 'PolicyName'),
    arn: getTag(block, 'Arn'),
    path: getTag(block, 'Path'),
    defaultVersionId: getTag(block, 'DefaultVersionId'),
    attachmentCount: parseXmlTag(block, 'AttachmentCount') ? parseInt(parseXmlTag(block, 'AttachmentCount'), 10) : null,
    isAttachable: parseXmlTag(block, 'IsAttachable') === 'true',
    description: getTag(block, 'Description') || null,
    createDate: getTag(block, 'CreateDate') || null,
    updateDate: getTag(block, 'UpdateDate') || null,
  }
}

/**
 * @integrationName AWS IAM
 * @integrationIcon /icon.svg
 */
class AwsIam {
  constructor(config = {}) {
    this.authenticationMethod = config.authenticationMethod || 'API Key'
    this.accessKeyId = config.accessKeyId
    this.secretAccessKey = config.secretAccessKey
    this.region = config.region || 'us-east-1'
    this.roleArn = config.roleArn
    this.externalId = config.externalId

    this.stsCredentials = null
    this.stsCredentialsExpiry = null
  }

  async #assumeRole() {
    if (this.stsCredentials && this.stsCredentialsExpiry && Date.now() < this.stsCredentialsExpiry - STS_EXPIRY_BUFFER_MS) {
      return this.stsCredentials
    }

    if (!this.roleArn) {
      throw new Error('IAM Role ARN is required for IAM Role authentication. Please configure it in the service settings.')
    }

    if (!this.accessKeyId || !this.secretAccessKey) {
      throw new Error('Access Key and Secret Key are required for IAM Role authentication to call STS AssumeRole.')
    }

    // STS is regional; use the configured region for the AssumeRole call.
    const result = await stsAssumeRole(
      { accessKeyId: this.accessKeyId, secretAccessKey: this.secretAccessKey },
      this.region,
      this.roleArn,
      `flowrunner-iam-${ Date.now() }`,
      this.externalId
    )

    this.stsCredentials = {
      accessKeyId: result.accessKeyId,
      secretAccessKey: result.secretAccessKey,
      sessionToken: result.sessionToken,
    }

    this.stsCredentialsExpiry = new Date(result.expiration).getTime()

    return this.stsCredentials
  }

  async #getCredentials() {
    if (this.authenticationMethod === 'IAM Role') {
      return this.#assumeRole()
    }

    if (!this.accessKeyId || !this.secretAccessKey) {
      throw new Error('Access Key and Secret Key are required for API Key authentication. Please configure them in the service settings or switch to IAM Role authentication.')
    }

    return { accessKeyId: this.accessKeyId, secretAccessKey: this.secretAccessKey }
  }

  /**
   * Signs and sends an IAM AWS Query request, returning raw response XML.
   * @param {string} action
   * @param {Object} params
   * @param {string} logTag
   * @returns {Promise<string>}
   */
  async #call(action, params, logTag) {
    const credentials = await this.#getCredentials()

    logger.debug(`${ logTag } - [${ action }]`)

    return iamRequest(action, params || {}, credentials)
  }

  #handleError(logTag, error) {
    const code = error.code || error.name
    const message = error.message

    logger.error(`${ logTag } - failed [${ code }]: ${ message }`)

    if (code === 'NoSuchEntity') {
      throw new Error(`AWS IAM error: the requested entity does not exist. ${ message }`)
    }

    if (code === 'EntityAlreadyExists') {
      throw new Error(`AWS IAM error: the entity already exists. ${ message }`)
    }

    if (code === 'DeleteConflict') {
      throw new Error(`AWS IAM error: the entity cannot be deleted because it still has attached resources (policies, access keys, or group memberships). ${ message }`)
    }

    if (code === 'InvalidInput' || code === 'MalformedPolicyDocument') {
      throw new Error(`AWS IAM error: invalid input. ${ message }`)
    }

    if (code === 'AccessDenied' || code === 'InvalidClientTokenId' || code === 'SignatureDoesNotMatch') {
      throw new Error(`AWS IAM error: authentication or permission failure. Verify your Access Key, Secret Key, and IAM permissions. ${ message }`)
    }

    throw new Error(`AWS IAM error (${ code || 'Unknown' }): ${ message }`)
  }

  // ─── DICTIONARIES ────────────────────────────────────────────────────

  /**
   * @registerAs DICTIONARY
   * @operationName Get Users Dictionary
   * @description Provides a searchable list of IAM users for selection in dependent parameters. Filtering is applied locally on the retrieved page of results.
   * @route POST /get-users-dictionary
   * @paramDef {"type":"getUsersDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor for retrieving IAM users."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"alice","value":"alice","note":"arn:aws:iam::123456789012:user/alice"}],"cursor":null}
   */
  async getUsersDictionary(payload) {
    try {
      const { search, cursor } = payload || {}
      const xml = await this.#call('ListUsers', { MaxItems: 200, Marker: cursor || undefined }, 'getUsersDictionary')
      const users = parseXmlBlocks(xml, 'member').map(parseUser)
      const nextMarker = getTag(xml, 'IsTruncated') === 'true' ? getTag(xml, 'Marker') : null

      let items = users.map(user => ({ label: user.userName, value: user.userName, note: user.arn || '' }))

      if (search) {
        const s = search.toLowerCase()

        items = items.filter(item => item.label && item.label.toLowerCase().includes(s))
      }

      return { items, cursor: nextMarker }
    } catch (error) {
      this.#handleError('getUsersDictionary', error)
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Roles Dictionary
   * @description Provides a searchable list of IAM roles for selection in dependent parameters. Filtering is applied locally on the retrieved page of results.
   * @route POST /get-roles-dictionary
   * @paramDef {"type":"getRolesDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor for retrieving IAM roles."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"AppRole","value":"AppRole","note":"arn:aws:iam::123456789012:role/AppRole"}],"cursor":null}
   */
  async getRolesDictionary(payload) {
    try {
      const { search, cursor } = payload || {}
      const xml = await this.#call('ListRoles', { MaxItems: 200, Marker: cursor || undefined }, 'getRolesDictionary')
      const roles = parseXmlBlocks(xml, 'member').map(parseRole)
      const nextMarker = getTag(xml, 'IsTruncated') === 'true' ? getTag(xml, 'Marker') : null

      let items = roles.map(role => ({ label: role.roleName, value: role.roleName, note: role.arn || '' }))

      if (search) {
        const s = search.toLowerCase()

        items = items.filter(item => item.label && item.label.toLowerCase().includes(s))
      }

      return { items, cursor: nextMarker }
    } catch (error) {
      this.#handleError('getRolesDictionary', error)
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Policies Dictionary
   * @description Provides a searchable list of customer-managed (Local scope) IAM policies for selection in dependent parameters. Returns policy ARNs as values. Filtering is applied locally on the retrieved page of results.
   * @route POST /get-policies-dictionary
   * @paramDef {"type":"getPoliciesDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor for retrieving customer-managed IAM policies."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"MyPolicy","value":"arn:aws:iam::123456789012:policy/MyPolicy","note":"Attachments: 2"}],"cursor":null}
   */
  async getPoliciesDictionary(payload) {
    try {
      const { search, cursor } = payload || {}
      const xml = await this.#call('ListPolicies', { Scope: 'Local', MaxItems: 200, Marker: cursor || undefined }, 'getPoliciesDictionary')
      const policies = parseXmlBlocks(xml, 'member').map(parsePolicy)
      const nextMarker = getTag(xml, 'IsTruncated') === 'true' ? getTag(xml, 'Marker') : null

      let items = policies.map(policy => ({
        label: policy.policyName,
        value: policy.arn,
        note: policy.attachmentCount !== null ? `Attachments: ${ policy.attachmentCount }` : '',
      }))

      if (search) {
        const s = search.toLowerCase()

        items = items.filter(item => item.label && item.label.toLowerCase().includes(s))
      }

      return { items, cursor: nextMarker }
    } catch (error) {
      this.#handleError('getPoliciesDictionary', error)
    }
  }

  // ─── USERS ───────────────────────────────────────────────────────────

  /**
   * @operationName List Users
   * @category Users
   * @description Lists the IAM users in the AWS account, optionally filtered by a path prefix. Returns user name, ID, ARN, path, and creation date. Supports pagination via a marker returned when results are truncated. Note that this list operation does not return user tags or permissions boundaries.
   * @route GET /list-users
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Path Prefix","name":"pathPrefix","required":false,"description":"Optional path prefix to filter users, e.g. '/division_abc/'. Defaults to '/' (all users)."}
   * @paramDef {"type":"Number","label":"Max Items","name":"maxItems","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of users to return (1-1000). Defaults to 100."}
   * @paramDef {"type":"String","label":"Marker","name":"marker","required":false,"description":"Pagination marker from a previous truncated response to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"users":[{"userId":"AIDA...","userName":"alice","arn":"arn:aws:iam::123456789012:user/alice","path":"/","createDate":"2024-01-15T10:30:00Z","passwordLastUsed":null}],"isTruncated":false,"marker":null}
   */
  async listUsers(pathPrefix, maxItems, marker) {
    try {
      const xml = await this.#call('ListUsers', {
        PathPrefix: pathPrefix || undefined,
        MaxItems: maxItems || undefined,
        Marker: marker || undefined,
      }, 'listUsers')

      const users = parseXmlBlocks(xml, 'member').map(parseUser)
      const isTruncated = getTag(xml, 'IsTruncated') === 'true'

      return { users, isTruncated, marker: isTruncated ? getTag(xml, 'Marker') : null }
    } catch (error) {
      this.#handleError('listUsers', error)
    }
  }

  /**
   * @operationName Get User
   * @category Users
   * @description Retrieves detailed information about a single IAM user, including the user ID, ARN, path, creation date, and the date the user's password was last used. If no user name is supplied, returns details for the user making the request (based on the configured access key).
   * @route GET /get-user
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"User Name","name":"userName","required":false,"dictionary":"getUsersDictionary","description":"The name of the user to retrieve. Leave empty to return the user associated with the configured credentials."}
   * @returns {Object}
   * @sampleResult {"userId":"AIDA...","userName":"alice","arn":"arn:aws:iam::123456789012:user/alice","path":"/","createDate":"2024-01-15T10:30:00Z","passwordLastUsed":"2024-06-01T08:00:00Z"}
   */
  async getUser(userName) {
    try {
      const xml = await this.#call('GetUser', { UserName: userName || undefined }, 'getUser')
      const block = parseXmlTag(xml, 'User') || xml

      return parseUser(block)
    } catch (error) {
      this.#handleError('getUser', error)
    }
  }

  /**
   * @operationName Create User
   * @category Users
   * @description Creates a new IAM user in the AWS account. Optionally sets a path for organizing users and attaches tags. The new user has no permissions until policies are attached. User names are unique within the account and can contain up to 64 characters.
   * @route POST /create-user
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"User Name","name":"userName","required":true,"description":"The name for the new IAM user (up to 64 characters; letters, digits, and +=,.@_- )."}
   * @paramDef {"type":"String","label":"Path","name":"path","required":false,"description":"Optional path for the user, e.g. '/division_abc/'. Must begin and end with a forward slash. Defaults to '/'."}
   * @paramDef {"type":"Array<IamTag>","label":"Tags","name":"tags","required":false,"description":"Optional list of key/value tags to attach to the user."}
   * @returns {Object}
   * @sampleResult {"userId":"AIDA...","userName":"alice","arn":"arn:aws:iam::123456789012:user/alice","path":"/","createDate":"2024-01-15T10:30:00Z"}
   */
  async createUser(userName, path, tags) {
    if (!userName || !userName.trim()) {
      throw new Error('User name is required.')
    }

    try {
      const xml = await this.#call('CreateUser', {
        UserName: userName,
        Path: path || undefined,
        Tags: this.#buildTags(tags),
      }, 'createUser')

      const block = parseXmlTag(xml, 'User') || xml

      return parseUser(block)
    } catch (error) {
      this.#handleError('createUser', error)
    }
  }

  /**
   * @operationName Delete User
   * @category Users
   * @description Permanently deletes an IAM user from the AWS account. This action cannot be undone. The user must first have all access keys, signing certificates, MFA devices, group memberships, inline policies, and attached managed policies removed, otherwise the request fails with a deletion conflict.
   * @route DELETE /delete-user
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"User Name","name":"userName","required":true,"dictionary":"getUsersDictionary","description":"The name of the user to delete."}
   * @returns {Object}
   * @sampleResult {"success":true,"userName":"alice"}
   */
  async deleteUser(userName) {
    if (!userName || !userName.trim()) {
      throw new Error('User name is required.')
    }

    try {
      await this.#call('DeleteUser', { UserName: userName }, 'deleteUser')

      return { success: true, userName }
    } catch (error) {
      this.#handleError('deleteUser', error)
    }
  }

  /**
   * @operationName List Access Keys
   * @category Users
   * @description Lists the access key IDs associated with an IAM user, along with each key's status (Active or Inactive) and creation date. Secret access key values are never returned by this operation; they are only shown once when the key is first created.
   * @route GET /list-access-keys
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"User Name","name":"userName","required":true,"dictionary":"getUsersDictionary","description":"The name of the user whose access keys should be listed."}
   * @returns {Object}
   * @sampleResult {"accessKeys":[{"accessKeyId":"AKIA...","status":"Active","createDate":"2024-01-15T10:30:00Z"}]}
   */
  async listAccessKeys(userName) {
    if (!userName || !userName.trim()) {
      throw new Error('User name is required.')
    }

    try {
      const xml = await this.#call('ListAccessKeys', { UserName: userName }, 'listAccessKeys')
      const accessKeys = parseXmlBlocks(xml, 'member').map(block => ({
        userName: getTag(block, 'UserName'),
        accessKeyId: getTag(block, 'AccessKeyId'),
        status: getTag(block, 'Status'),
        createDate: getTag(block, 'CreateDate') || null,
      }))

      return { accessKeys }
    } catch (error) {
      this.#handleError('listAccessKeys', error)
    }
  }

  /**
   * @operationName Create Access Key
   * @category Users
   * @description Creates a new programmatic access key (access key ID and secret access key) for an IAM user. IMPORTANT: the secret access key is returned only once by this operation and cannot be retrieved again afterward — store it securely immediately. A user can have at most two access keys at a time.
   * @route POST /create-access-key
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"User Name","name":"userName","required":true,"dictionary":"getUsersDictionary","description":"The name of the user to create an access key for."}
   * @returns {Object}
   * @sampleResult {"accessKeyId":"AKIA...","secretAccessKey":"wJalrXUtnFEMI...","status":"Active","createDate":"2024-01-15T10:30:00Z","warning":"The secret access key is shown only once. Store it securely now."}
   */
  async createAccessKey(userName) {
    if (!userName || !userName.trim()) {
      throw new Error('User name is required.')
    }

    try {
      const xml = await this.#call('CreateAccessKey', { UserName: userName }, 'createAccessKey')
      const block = parseXmlTag(xml, 'AccessKey') || xml

      return {
        userName: getTag(block, 'UserName'),
        accessKeyId: getTag(block, 'AccessKeyId'),
        secretAccessKey: getTag(block, 'SecretAccessKey'),
        status: getTag(block, 'Status'),
        createDate: getTag(block, 'CreateDate') || null,
        warning: 'The secret access key is shown only once. Store it securely now — it cannot be retrieved again.',
      }
    } catch (error) {
      this.#handleError('createAccessKey', error)
    }
  }

  /**
   * @operationName Update Access Key
   * @category Users
   * @description Activates or deactivates an existing access key for an IAM user. Setting the status to Inactive disables the key without deleting it, allowing it to be re-enabled later. Commonly used during credential rotation to temporarily disable an old key before deleting it.
   * @route PUT /update-access-key
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"User Name","name":"userName","required":true,"dictionary":"getUsersDictionary","description":"The name of the user that owns the access key."}
   * @paramDef {"type":"String","label":"Access Key ID","name":"accessKeyId","required":true,"description":"The access key ID to update (e.g. AKIA...)."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Inactive"]}},"description":"The new status for the access key."}
   * @returns {Object}
   * @sampleResult {"success":true,"userName":"alice","accessKeyId":"AKIA...","status":"Inactive"}
   */
  async updateAccessKey(userName, accessKeyId, status) {
    if (!userName || !userName.trim()) {
      throw new Error('User name is required.')
    }

    if (!accessKeyId || !accessKeyId.trim()) {
      throw new Error('Access key ID is required.')
    }

    const resolvedStatus = resolveChoice(status, { Active: 'Active', Inactive: 'Inactive' })

    if (resolvedStatus !== 'Active' && resolvedStatus !== 'Inactive') {
      throw new Error("Status must be either 'Active' or 'Inactive'.")
    }

    try {
      await this.#call('UpdateAccessKey', { UserName: userName, AccessKeyId: accessKeyId, Status: resolvedStatus }, 'updateAccessKey')

      return { success: true, userName, accessKeyId, status: resolvedStatus }
    } catch (error) {
      this.#handleError('updateAccessKey', error)
    }
  }

  /**
   * @operationName Delete Access Key
   * @category Users
   * @description Permanently deletes an access key associated with an IAM user. This action cannot be undone and immediately revokes any programmatic access that used the key. Deactivate the key first and confirm no active workloads depend on it before deleting.
   * @route DELETE /delete-access-key
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"User Name","name":"userName","required":true,"dictionary":"getUsersDictionary","description":"The name of the user that owns the access key."}
   * @paramDef {"type":"String","label":"Access Key ID","name":"accessKeyId","required":true,"description":"The access key ID to delete (e.g. AKIA...)."}
   * @returns {Object}
   * @sampleResult {"success":true,"userName":"alice","accessKeyId":"AKIA..."}
   */
  async deleteAccessKey(userName, accessKeyId) {
    if (!userName || !userName.trim()) {
      throw new Error('User name is required.')
    }

    if (!accessKeyId || !accessKeyId.trim()) {
      throw new Error('Access key ID is required.')
    }

    try {
      await this.#call('DeleteAccessKey', { UserName: userName, AccessKeyId: accessKeyId }, 'deleteAccessKey')

      return { success: true, userName, accessKeyId }
    } catch (error) {
      this.#handleError('deleteAccessKey', error)
    }
  }

  // ─── GROUPS ──────────────────────────────────────────────────────────

  /**
   * @operationName List Groups
   * @category Groups
   * @description Lists the IAM groups in the AWS account, optionally filtered by a path prefix. Returns each group's name, ID, ARN, path, and creation date. Supports pagination via a marker when results are truncated.
   * @route GET /list-groups
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Path Prefix","name":"pathPrefix","required":false,"description":"Optional path prefix to filter groups, e.g. '/division_abc/'. Defaults to '/' (all groups)."}
   * @paramDef {"type":"Number","label":"Max Items","name":"maxItems","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of groups to return (1-1000). Defaults to 100."}
   * @paramDef {"type":"String","label":"Marker","name":"marker","required":false,"description":"Pagination marker from a previous truncated response to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"groups":[{"groupId":"AGPA...","groupName":"Admins","arn":"arn:aws:iam::123456789012:group/Admins","path":"/","createDate":"2024-01-15T10:30:00Z"}],"isTruncated":false,"marker":null}
   */
  async listGroups(pathPrefix, maxItems, marker) {
    try {
      const xml = await this.#call('ListGroups', {
        PathPrefix: pathPrefix || undefined,
        MaxItems: maxItems || undefined,
        Marker: marker || undefined,
      }, 'listGroups')

      const groups = parseXmlBlocks(xml, 'member').map(parseGroup)
      const isTruncated = getTag(xml, 'IsTruncated') === 'true'

      return { groups, isTruncated, marker: isTruncated ? getTag(xml, 'Marker') : null }
    } catch (error) {
      this.#handleError('listGroups', error)
    }
  }

  /**
   * @operationName Get Group
   * @category Groups
   * @description Retrieves an IAM group and the list of users that belong to it. Returns the group's metadata along with an array of member users (name, ID, ARN, and path). Useful for auditing group membership.
   * @route GET /get-group
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Group Name","name":"groupName","required":true,"description":"The name of the group to retrieve."}
   * @returns {Object}
   * @sampleResult {"group":{"groupId":"AGPA...","groupName":"Admins","arn":"arn:aws:iam::123456789012:group/Admins","path":"/","createDate":"2024-01-15T10:30:00Z"},"users":[{"userId":"AIDA...","userName":"alice","arn":"arn:aws:iam::123456789012:user/alice","path":"/"}]}
   */
  async getGroup(groupName) {
    if (!groupName || !groupName.trim()) {
      throw new Error('Group name is required.')
    }

    try {
      const xml = await this.#call('GetGroup', { GroupName: groupName }, 'getGroup')
      const groupBlock = parseXmlTag(xml, 'Group')
      const usersSection = parseXmlTag(xml, 'Users') || ''
      const users = parseXmlBlocks(usersSection, 'member').map(parseUser)

      return { group: groupBlock ? parseGroup(groupBlock) : null, users }
    } catch (error) {
      this.#handleError('getGroup', error)
    }
  }

  /**
   * @operationName Create Group
   * @category Groups
   * @description Creates a new IAM group in the AWS account. Groups let you attach policies once and apply the permissions to all member users. Optionally sets a path for organizing groups. The group has no permissions until policies are attached.
   * @route POST /create-group
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Group Name","name":"groupName","required":true,"description":"The name for the new IAM group (up to 128 characters; letters, digits, and +=,.@_- )."}
   * @paramDef {"type":"String","label":"Path","name":"path","required":false,"description":"Optional path for the group, e.g. '/division_abc/'. Must begin and end with a forward slash. Defaults to '/'."}
   * @returns {Object}
   * @sampleResult {"groupId":"AGPA...","groupName":"Admins","arn":"arn:aws:iam::123456789012:group/Admins","path":"/","createDate":"2024-01-15T10:30:00Z"}
   */
  async createGroup(groupName, path) {
    if (!groupName || !groupName.trim()) {
      throw new Error('Group name is required.')
    }

    try {
      const xml = await this.#call('CreateGroup', { GroupName: groupName, Path: path || undefined }, 'createGroup')
      const block = parseXmlTag(xml, 'Group') || xml

      return parseGroup(block)
    } catch (error) {
      this.#handleError('createGroup', error)
    }
  }

  /**
   * @operationName Delete Group
   * @category Groups
   * @description Permanently deletes an IAM group from the AWS account. This action cannot be undone. The group must be empty and have no attached or inline policies before it can be deleted, otherwise the request fails with a deletion conflict.
   * @route DELETE /delete-group
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Group Name","name":"groupName","required":true,"description":"The name of the group to delete. The group must have no members and no attached policies."}
   * @returns {Object}
   * @sampleResult {"success":true,"groupName":"Admins"}
   */
  async deleteGroup(groupName) {
    if (!groupName || !groupName.trim()) {
      throw new Error('Group name is required.')
    }

    try {
      await this.#call('DeleteGroup', { GroupName: groupName }, 'deleteGroup')

      return { success: true, groupName }
    } catch (error) {
      this.#handleError('deleteGroup', error)
    }
  }

  /**
   * @operationName Add User To Group
   * @category Groups
   * @description Adds an existing IAM user to an existing IAM group. The user inherits all permissions granted by the policies attached to the group. A user can belong to multiple groups.
   * @route POST /add-user-to-group
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Group Name","name":"groupName","required":true,"description":"The name of the group to add the user to."}
   * @paramDef {"type":"String","label":"User Name","name":"userName","required":true,"dictionary":"getUsersDictionary","description":"The name of the user to add to the group."}
   * @returns {Object}
   * @sampleResult {"success":true,"groupName":"Admins","userName":"alice"}
   */
  async addUserToGroup(groupName, userName) {
    if (!groupName || !groupName.trim()) {
      throw new Error('Group name is required.')
    }

    if (!userName || !userName.trim()) {
      throw new Error('User name is required.')
    }

    try {
      await this.#call('AddUserToGroup', { GroupName: groupName, UserName: userName }, 'addUserToGroup')

      return { success: true, groupName, userName }
    } catch (error) {
      this.#handleError('addUserToGroup', error)
    }
  }

  /**
   * @operationName Remove User From Group
   * @category Groups
   * @description Removes an IAM user from an IAM group. The user loses any permissions that were granted solely through that group's policies. This does not delete the user or the group.
   * @route POST /remove-user-from-group
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Group Name","name":"groupName","required":true,"description":"The name of the group to remove the user from."}
   * @paramDef {"type":"String","label":"User Name","name":"userName","required":true,"dictionary":"getUsersDictionary","description":"The name of the user to remove from the group."}
   * @returns {Object}
   * @sampleResult {"success":true,"groupName":"Admins","userName":"alice"}
   */
  async removeUserFromGroup(groupName, userName) {
    if (!groupName || !groupName.trim()) {
      throw new Error('Group name is required.')
    }

    if (!userName || !userName.trim()) {
      throw new Error('User name is required.')
    }

    try {
      await this.#call('RemoveUserFromGroup', { GroupName: groupName, UserName: userName }, 'removeUserFromGroup')

      return { success: true, groupName, userName }
    } catch (error) {
      this.#handleError('removeUserFromGroup', error)
    }
  }

  /**
   * @operationName List Groups For User
   * @category Groups
   * @description Lists all IAM groups that a specified user is a member of. Returns each group's name, ID, ARN, and path. Useful for determining a user's group-based permissions.
   * @route GET /list-groups-for-user
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"User Name","name":"userName","required":true,"dictionary":"getUsersDictionary","description":"The name of the user whose group memberships should be listed."}
   * @returns {Object}
   * @sampleResult {"groups":[{"groupId":"AGPA...","groupName":"Admins","arn":"arn:aws:iam::123456789012:group/Admins","path":"/"}]}
   */
  async listGroupsForUser(userName) {
    if (!userName || !userName.trim()) {
      throw new Error('User name is required.')
    }

    try {
      const xml = await this.#call('ListGroupsForUser', { UserName: userName }, 'listGroupsForUser')
      const groups = parseXmlBlocks(xml, 'member').map(parseGroup)

      return { groups }
    } catch (error) {
      this.#handleError('listGroupsForUser', error)
    }
  }

  // ─── ROLES ───────────────────────────────────────────────────────────

  /**
   * @operationName List Roles
   * @category Roles
   * @description Lists the IAM roles in the AWS account, optionally filtered by a path prefix. Returns each role's name, ID, ARN, path, description, and trust policy (assume-role policy document). Supports pagination via a marker when results are truncated.
   * @route GET /list-roles
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Path Prefix","name":"pathPrefix","required":false,"description":"Optional path prefix to filter roles, e.g. '/service-role/'. Defaults to '/' (all roles)."}
   * @paramDef {"type":"Number","label":"Max Items","name":"maxItems","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of roles to return (1-1000). Defaults to 100."}
   * @paramDef {"type":"String","label":"Marker","name":"marker","required":false,"description":"Pagination marker from a previous truncated response to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"roles":[{"roleId":"AROA...","roleName":"AppRole","arn":"arn:aws:iam::123456789012:role/AppRole","path":"/","description":"App execution role","createDate":"2024-01-15T10:30:00Z","assumeRolePolicyDocument":{"Version":"2012-10-17","Statement":[]}}],"isTruncated":false,"marker":null}
   */
  async listRoles(pathPrefix, maxItems, marker) {
    try {
      const xml = await this.#call('ListRoles', {
        PathPrefix: pathPrefix || undefined,
        MaxItems: maxItems || undefined,
        Marker: marker || undefined,
      }, 'listRoles')

      const roles = parseXmlBlocks(xml, 'member').map(parseRole)
      const isTruncated = getTag(xml, 'IsTruncated') === 'true'

      return { roles, isTruncated, marker: isTruncated ? getTag(xml, 'Marker') : null }
    } catch (error) {
      this.#handleError('listRoles', error)
    }
  }

  /**
   * @operationName Get Role
   * @category Roles
   * @description Retrieves detailed information about a single IAM role, including its ARN, path, description, maximum session duration, and its trust policy (assume-role policy document, returned as parsed JSON).
   * @route GET /get-role
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Role Name","name":"roleName","required":true,"dictionary":"getRolesDictionary","description":"The name of the role to retrieve."}
   * @returns {Object}
   * @sampleResult {"roleId":"AROA...","roleName":"AppRole","arn":"arn:aws:iam::123456789012:role/AppRole","path":"/","description":"App execution role","createDate":"2024-01-15T10:30:00Z","maxSessionDuration":3600,"assumeRolePolicyDocument":{"Version":"2012-10-17","Statement":[]}}
   */
  async getRole(roleName) {
    if (!roleName || !roleName.trim()) {
      throw new Error('Role name is required.')
    }

    try {
      const xml = await this.#call('GetRole', { RoleName: roleName }, 'getRole')
      const block = parseXmlTag(xml, 'Role') || xml

      return parseRole(block)
    } catch (error) {
      this.#handleError('getRole', error)
    }
  }

  /**
   * @operationName Create Role
   * @category Roles
   * @description Creates a new IAM role with the specified trust policy (assume-role policy document). The trust policy defines which principals (users, services, or accounts) are allowed to assume the role. Optionally sets a path and description. The role has no permissions policies until they are attached separately.
   * @route POST /create-role
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Role Name","name":"roleName","required":true,"description":"The name for the new IAM role (up to 64 characters; letters, digits, and +=,.@_- )."}
   * @paramDef {"type":"String","label":"Assume Role Policy Document","name":"assumeRolePolicyDocument","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The trust policy as a JSON string that grants an entity permission to assume the role, e.g. {\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"ec2.amazonaws.com\"},\"Action\":\"sts:AssumeRole\"}]}."}
   * @paramDef {"type":"String","label":"Path","name":"path","required":false,"description":"Optional path for the role, e.g. '/service-role/'. Must begin and end with a forward slash. Defaults to '/'."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":false,"description":"Optional description of the role's purpose."}
   * @returns {Object}
   * @sampleResult {"roleId":"AROA...","roleName":"AppRole","arn":"arn:aws:iam::123456789012:role/AppRole","path":"/","description":"App execution role","createDate":"2024-01-15T10:30:00Z","assumeRolePolicyDocument":{"Version":"2012-10-17","Statement":[]}}
   */
  async createRole(roleName, assumeRolePolicyDocument, path, description) {
    if (!roleName || !roleName.trim()) {
      throw new Error('Role name is required.')
    }

    if (!assumeRolePolicyDocument || !assumeRolePolicyDocument.trim()) {
      throw new Error('Assume role policy document is required.')
    }

    try {
      JSON.parse(assumeRolePolicyDocument)
    } catch (err) {
      throw new Error('Assume role policy document must be a valid JSON string.')
    }

    try {
      const xml = await this.#call('CreateRole', {
        RoleName: roleName,
        AssumeRolePolicyDocument: assumeRolePolicyDocument,
        Path: path || undefined,
        Description: description || undefined,
      }, 'createRole')

      const block = parseXmlTag(xml, 'Role') || xml

      return parseRole(block)
    } catch (error) {
      this.#handleError('createRole', error)
    }
  }

  /**
   * @operationName Delete Role
   * @category Roles
   * @description Permanently deletes an IAM role from the AWS account. This action cannot be undone. The role must first have all inline policies removed, all managed policies detached, and any instance profile associations removed, otherwise the request fails with a deletion conflict. Ensure no running workloads depend on the role before deleting.
   * @route DELETE /delete-role
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Role Name","name":"roleName","required":true,"dictionary":"getRolesDictionary","description":"The name of the role to delete."}
   * @returns {Object}
   * @sampleResult {"success":true,"roleName":"AppRole"}
   */
  async deleteRole(roleName) {
    if (!roleName || !roleName.trim()) {
      throw new Error('Role name is required.')
    }

    try {
      await this.#call('DeleteRole', { RoleName: roleName }, 'deleteRole')

      return { success: true, roleName }
    } catch (error) {
      this.#handleError('deleteRole', error)
    }
  }

  /**
   * @operationName List Attached Role Policies
   * @category Roles
   * @description Lists the managed policies attached to an IAM role. Returns each policy's name and ARN. Note that this lists only attached managed policies, not inline policies defined directly on the role.
   * @route GET /list-attached-role-policies
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Role Name","name":"roleName","required":true,"dictionary":"getRolesDictionary","description":"The name of the role whose attached managed policies should be listed."}
   * @returns {Object}
   * @sampleResult {"attachedPolicies":[{"policyName":"AmazonS3ReadOnlyAccess","policyArn":"arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess"}]}
   */
  async listAttachedRolePolicies(roleName) {
    if (!roleName || !roleName.trim()) {
      throw new Error('Role name is required.')
    }

    try {
      const xml = await this.#call('ListAttachedRolePolicies', { RoleName: roleName }, 'listAttachedRolePolicies')
      const attachedPolicies = parseXmlBlocks(xml, 'member').map(block => ({
        policyName: getTag(block, 'PolicyName'),
        policyArn: getTag(block, 'PolicyArn'),
      }))

      return { attachedPolicies }
    } catch (error) {
      this.#handleError('listAttachedRolePolicies', error)
    }
  }

  // ─── POLICIES ────────────────────────────────────────────────────────

  /**
   * @operationName List Policies
   * @category Policies
   * @description Lists the managed policies available in the AWS account. Filter by scope to return AWS-managed policies, customer-managed (Local) policies, or all. Optionally return only policies that are currently attached to at least one entity. Supports pagination via a marker when results are truncated.
   * @route GET /list-policies
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Scope","name":"scope","required":false,"uiComponent":{"type":"DROPDOWN","options":{"values":["All","AWS Managed","Customer Managed"]}},"description":"Which policies to list. 'AWS Managed' returns AWS-provided policies, 'Customer Managed' returns policies you created, 'All' returns both. Defaults to All."}
   * @paramDef {"type":"Boolean","label":"Only Attached","name":"onlyAttached","required":false,"uiComponent":{"type":"TOGGLE"},"description":"When true, only returns policies that are attached to at least one user, group, or role."}
   * @paramDef {"type":"Number","label":"Max Items","name":"maxItems","required":false,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of policies to return (1-1000). Defaults to 100."}
   * @paramDef {"type":"String","label":"Marker","name":"marker","required":false,"description":"Pagination marker from a previous truncated response to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"policies":[{"policyId":"ANPA...","policyName":"MyPolicy","arn":"arn:aws:iam::123456789012:policy/MyPolicy","path":"/","defaultVersionId":"v1","attachmentCount":2,"isAttachable":true,"description":null,"createDate":"2024-01-15T10:30:00Z","updateDate":"2024-01-15T10:30:00Z"}],"isTruncated":false,"marker":null}
   */
  async listPolicies(scope, onlyAttached, maxItems, marker) {
    try {
      const resolvedScope = resolveChoice(scope, { 'All': 'All', 'AWS Managed': 'AWS', 'Customer Managed': 'Local' }) || 'All'

      const xml = await this.#call('ListPolicies', {
        Scope: resolvedScope,
        OnlyAttached: onlyAttached ? 'true' : undefined,
        MaxItems: maxItems || undefined,
        Marker: marker || undefined,
      }, 'listPolicies')

      const policies = parseXmlBlocks(xml, 'member').map(parsePolicy)
      const isTruncated = getTag(xml, 'IsTruncated') === 'true'

      return { policies, isTruncated, marker: isTruncated ? getTag(xml, 'Marker') : null }
    } catch (error) {
      this.#handleError('listPolicies', error)
    }
  }

  /**
   * @operationName Get Policy
   * @category Policies
   * @description Retrieves metadata about a managed policy by its ARN, including the policy name, ID, default version, attachment count, and description. Does not return the policy document itself; use the policy version APIs for the full document.
   * @route GET /get-policy
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Policy ARN","name":"policyArn","required":true,"dictionary":"getPoliciesDictionary","description":"The Amazon Resource Name (ARN) of the managed policy to retrieve."}
   * @returns {Object}
   * @sampleResult {"policyId":"ANPA...","policyName":"MyPolicy","arn":"arn:aws:iam::123456789012:policy/MyPolicy","path":"/","defaultVersionId":"v1","attachmentCount":2,"isAttachable":true,"description":null,"createDate":"2024-01-15T10:30:00Z","updateDate":"2024-01-15T10:30:00Z"}
   */
  async getPolicy(policyArn) {
    if (!policyArn || !policyArn.trim()) {
      throw new Error('Policy ARN is required.')
    }

    try {
      const xml = await this.#call('GetPolicy', { PolicyArn: policyArn }, 'getPolicy')
      const block = parseXmlTag(xml, 'Policy') || xml

      return parsePolicy(block)
    } catch (error) {
      this.#handleError('getPolicy', error)
    }
  }

  /**
   * @operationName Create Policy
   * @category Policies
   * @description Creates a new customer-managed IAM policy from a JSON policy document. The policy defines a set of permissions that can then be attached to users, groups, or roles. The policy document must be valid JSON conforming to the IAM policy grammar.
   * @route POST /create-policy
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Policy Name","name":"policyName","required":true,"description":"The name for the new managed policy (up to 128 characters; letters, digits, and +=,.@-_ )."}
   * @paramDef {"type":"String","label":"Policy Document","name":"policyDocument","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The permissions policy as a JSON string, e.g. {\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"s3:GetObject\",\"Resource\":\"*\"}]}."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":false,"description":"Optional description of the policy's purpose. Cannot be changed after creation."}
   * @returns {Object}
   * @sampleResult {"policyId":"ANPA...","policyName":"MyPolicy","arn":"arn:aws:iam::123456789012:policy/MyPolicy","path":"/","defaultVersionId":"v1","attachmentCount":0,"isAttachable":true,"description":"Read-only S3","createDate":"2024-01-15T10:30:00Z","updateDate":"2024-01-15T10:30:00Z"}
   */
  async createPolicy(policyName, policyDocument, description) {
    if (!policyName || !policyName.trim()) {
      throw new Error('Policy name is required.')
    }

    if (!policyDocument || !policyDocument.trim()) {
      throw new Error('Policy document is required.')
    }

    try {
      JSON.parse(policyDocument)
    } catch (err) {
      throw new Error('Policy document must be a valid JSON string.')
    }

    try {
      const xml = await this.#call('CreatePolicy', {
        PolicyName: policyName,
        PolicyDocument: policyDocument,
        Description: description || undefined,
      }, 'createPolicy')

      const block = parseXmlTag(xml, 'Policy') || xml

      return parsePolicy(block)
    } catch (error) {
      this.#handleError('createPolicy', error)
    }
  }

  /**
   * @operationName Delete Policy
   * @category Policies
   * @description Permanently deletes a customer-managed IAM policy by its ARN. This action cannot be undone. Before deleting, the policy must be detached from all users, groups, and roles, and all non-default versions must be deleted, otherwise the request fails with a deletion conflict. AWS-managed policies cannot be deleted.
   * @route DELETE /delete-policy
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Policy ARN","name":"policyArn","required":true,"dictionary":"getPoliciesDictionary","description":"The ARN of the customer-managed policy to delete."}
   * @returns {Object}
   * @sampleResult {"success":true,"policyArn":"arn:aws:iam::123456789012:policy/MyPolicy"}
   */
  async deletePolicy(policyArn) {
    if (!policyArn || !policyArn.trim()) {
      throw new Error('Policy ARN is required.')
    }

    try {
      await this.#call('DeletePolicy', { PolicyArn: policyArn }, 'deletePolicy')

      return { success: true, policyArn }
    } catch (error) {
      this.#handleError('deletePolicy', error)
    }
  }

  /**
   * @operationName Attach User Policy
   * @category Policies
   * @description Attaches a managed policy to an IAM user, granting the user the permissions defined in the policy. Both AWS-managed and customer-managed policies can be attached. A user can have up to a limited number of attached managed policies.
   * @route POST /attach-user-policy
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"User Name","name":"userName","required":true,"dictionary":"getUsersDictionary","description":"The name of the user to attach the policy to."}
   * @paramDef {"type":"String","label":"Policy ARN","name":"policyArn","required":true,"dictionary":"getPoliciesDictionary","description":"The ARN of the managed policy to attach. Can be an AWS-managed or customer-managed policy ARN."}
   * @returns {Object}
   * @sampleResult {"success":true,"userName":"alice","policyArn":"arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess"}
   */
  async attachUserPolicy(userName, policyArn) {
    if (!userName || !userName.trim()) {
      throw new Error('User name is required.')
    }

    if (!policyArn || !policyArn.trim()) {
      throw new Error('Policy ARN is required.')
    }

    try {
      await this.#call('AttachUserPolicy', { UserName: userName, PolicyArn: policyArn }, 'attachUserPolicy')

      return { success: true, userName, policyArn }
    } catch (error) {
      this.#handleError('attachUserPolicy', error)
    }
  }

  /**
   * @operationName Detach User Policy
   * @category Policies
   * @description Detaches a managed policy from an IAM user, removing the permissions the policy granted. This does not delete the policy itself; it only removes the association with the user.
   * @route POST /detach-user-policy
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"User Name","name":"userName","required":true,"dictionary":"getUsersDictionary","description":"The name of the user to detach the policy from."}
   * @paramDef {"type":"String","label":"Policy ARN","name":"policyArn","required":true,"dictionary":"getPoliciesDictionary","description":"The ARN of the managed policy to detach from the user."}
   * @returns {Object}
   * @sampleResult {"success":true,"userName":"alice","policyArn":"arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess"}
   */
  async detachUserPolicy(userName, policyArn) {
    if (!userName || !userName.trim()) {
      throw new Error('User name is required.')
    }

    if (!policyArn || !policyArn.trim()) {
      throw new Error('Policy ARN is required.')
    }

    try {
      await this.#call('DetachUserPolicy', { UserName: userName, PolicyArn: policyArn }, 'detachUserPolicy')

      return { success: true, userName, policyArn }
    } catch (error) {
      this.#handleError('detachUserPolicy', error)
    }
  }

  /**
   * @operationName Attach Role Policy
   * @category Policies
   * @description Attaches a managed policy to an IAM role, granting the role the permissions defined in the policy. Both AWS-managed and customer-managed policies can be attached. This is the primary way to grant permissions to a role.
   * @route POST /attach-role-policy
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Role Name","name":"roleName","required":true,"dictionary":"getRolesDictionary","description":"The name of the role to attach the policy to."}
   * @paramDef {"type":"String","label":"Policy ARN","name":"policyArn","required":true,"dictionary":"getPoliciesDictionary","description":"The ARN of the managed policy to attach. Can be an AWS-managed or customer-managed policy ARN."}
   * @returns {Object}
   * @sampleResult {"success":true,"roleName":"AppRole","policyArn":"arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess"}
   */
  async attachRolePolicy(roleName, policyArn) {
    if (!roleName || !roleName.trim()) {
      throw new Error('Role name is required.')
    }

    if (!policyArn || !policyArn.trim()) {
      throw new Error('Policy ARN is required.')
    }

    try {
      await this.#call('AttachRolePolicy', { RoleName: roleName, PolicyArn: policyArn }, 'attachRolePolicy')

      return { success: true, roleName, policyArn }
    } catch (error) {
      this.#handleError('attachRolePolicy', error)
    }
  }

  /**
   * @operationName Detach Role Policy
   * @category Policies
   * @description Detaches a managed policy from an IAM role, removing the permissions the policy granted. This does not delete the policy itself; it only removes the association with the role.
   * @route POST /detach-role-policy
   * @appearanceColor #FF9900 #FFB84D
   * @paramDef {"type":"String","label":"Role Name","name":"roleName","required":true,"dictionary":"getRolesDictionary","description":"The name of the role to detach the policy from."}
   * @paramDef {"type":"String","label":"Policy ARN","name":"policyArn","required":true,"dictionary":"getPoliciesDictionary","description":"The ARN of the managed policy to detach from the role."}
   * @returns {Object}
   * @sampleResult {"success":true,"roleName":"AppRole","policyArn":"arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess"}
   */
  async detachRolePolicy(roleName, policyArn) {
    if (!roleName || !roleName.trim()) {
      throw new Error('Role name is required.')
    }

    if (!policyArn || !policyArn.trim()) {
      throw new Error('Policy ARN is required.')
    }

    try {
      await this.#call('DetachRolePolicy', { RoleName: roleName, PolicyArn: policyArn }, 'detachRolePolicy')

      return { success: true, roleName, policyArn }
    } catch (error) {
      this.#handleError('detachRolePolicy', error)
    }
  }

  // ─── ACCOUNT ─────────────────────────────────────────────────────────

  /**
   * @operationName Get Account Summary
   * @category Account
   * @description Retrieves a summary of IAM entity usage and IAM quotas for the AWS account, such as the number of users, groups, roles, and policies, along with their respective quotas and MFA status. Returns a map of summary keys to their integer values.
   * @route GET /get-account-summary
   * @appearanceColor #FF9900 #FFB84D
   * @returns {Object}
   * @sampleResult {"summary":{"Users":32,"UsersQuota":150,"Groups":7,"Roles":12,"Policies":22,"MFADevices":4,"AccountMFAEnabled":1}}
   */
  async getAccountSummary() {
    try {
      const xml = await this.#call('GetAccountSummary', {}, 'getAccountSummary')
      const entries = parseXmlBlocks(xml, 'entry')
      const summary = {}

      for (const entry of entries) {
        const key = getTag(entry, 'key')
        const rawValue = parseXmlTag(entry, 'value')

        if (key !== null) {
          const num = Number(rawValue)

          summary[key] = Number.isNaN(num) ? rawValue : num
        }
      }

      return { summary }
    } catch (error) {
      this.#handleError('getAccountSummary', error)
    }
  }

  /**
   * @operationName List Account Aliases
   * @category Account
   * @description Lists the account alias associated with the AWS account, if one is set. An account can have at most one alias, which is used in the account sign-in page URL. Returns an empty list when no alias is configured.
   * @route GET /list-account-aliases
   * @appearanceColor #FF9900 #FFB84D
   * @returns {Object}
   * @sampleResult {"accountAliases":["my-company"]}
   */
  async listAccountAliases() {
    try {
      const xml = await this.#call('ListAccountAliases', {}, 'listAccountAliases')
      const aliasesSection = parseXmlTag(xml, 'AccountAliases') || ''
      const accountAliases = parseXmlBlocks(aliasesSection, 'member').map(alias => decodeXmlEntities(alias))

      return { accountAliases }
    } catch (error) {
      this.#handleError('listAccountAliases', error)
    }
  }

  // ─── HELPERS ─────────────────────────────────────────────────────────

  /**
   * Converts an array of { key, value } tag objects into AWS Query tag members.
   * @param {Array<Object>} tags
   * @returns {Array<Object>|undefined}
   */
  #buildTags(tags) {
    if (!Array.isArray(tags) || tags.length === 0) {
      return undefined
    }

    return tags
      .filter(tag => tag && tag.key)
      .map(tag => ({ Key: tag.key, Value: tag.value !== undefined && tag.value !== null ? tag.value : '' }))
  }
}

// ─── TYPEDEFS ──────────────────────────────────────────────────────────────

/**
 * @typedef {Object} IamTag
 * @paramDef {"type":"String","label":"Key","name":"key","required":true,"description":"The tag key."}
 * @paramDef {"type":"String","label":"Value","name":"value","required":false,"description":"The tag value."}
 */

/**
 * @typedef {Object} getUsersDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter users by name. Filtering is performed locally on retrieved results."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination marker for retrieving the next page of users."}
 */

/**
 * @typedef {Object} getRolesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter roles by name. Filtering is performed locally on retrieved results."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination marker for retrieving the next page of roles."}
 */

/**
 * @typedef {Object} getPoliciesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter policies by name. Filtering is performed locally on retrieved results."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination marker for retrieving the next page of policies."}
 */

Flowrunner.ServerCode.addService(AwsIam, awsConfigItems)
