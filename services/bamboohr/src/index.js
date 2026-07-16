'use strict'

const crypto = require('crypto')

const SCOPE_LIST = [
  'openid',
  'offline_access',
  'employee',
  'employee.write',
  'time_off',
  'time_off.write',
  'time_tracking',
  'time_tracking.write',
  'company:info',
  'report',
  'webhooks',
  'webhooks.write',
  'employee:file',
  'employee:file.write',
  'company_file',
  'company_file.write',
  'field',
]

const SCOPE_STRING = SCOPE_LIST.join(' ')

const EMPLOYEE_FIELDS = [
  'firstName',
  'lastName',
  'displayName',
  'jobTitle',
  'department',
  'division',
  'workEmail',
  'workPhone',
  'mobilePhone',
  'hireDate',
  'status',
]

// Fields the employee-change trigger watches (and echoes back in the payload) when the
// subscriber doesn't name its own set.
const DEFAULT_WEBHOOK_FIELDS = [
  'firstName',
  'lastName',
  'jobTitle',
  'department',
  'division',
  'workEmail',
  'status',
]

const logger = {
  info: (...args) => console.log('[BambooHR] info:', ...args),
  debug: (...args) => console.log('[BambooHR] debug:', ...args),
  error: (...args) => console.log('[BambooHR] error:', ...args),
  warn: (...args) => console.log('[BambooHR] warn:', ...args),
}

// Lowercase every header key so inbound webhook lookups are case-insensitive.
function lowerKeys(headers) {
  const out = {}

  for (const key of Object.keys(headers || {})) {
    out[String(key).toLowerCase()] = headers[key]
  }

  return out
}

// Constant-time comparison of two hex signature strings (length mismatch fails fast).
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a))
  const bufB = Buffer.from(String(b))

  if (bufA.length !== bufB.length) return false

  return crypto.timingSafeEqual(bufA, bufB)
}

// Case-insensitive local filter of dictionary items by their label; BambooHR list endpoints
// don't take a search term, so filtering happens here on the retrieved page.
function filterItems(items, search) {
  if (!search) return items

  const needle = String(search).toLowerCase()

  return items.filter(item => String(item.label || '').toLowerCase().includes(needle))
}

/**
 * @requireOAuth
 * @usesFileStorage
 * @integrationName BambooHR
 * @integrationIcon /icon.png
 * @integrationTriggersScope SINGLE_APP
 */
class BambooHR {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret

    const rawDomain = config.companyDomain || ''

    this.companyDomain = rawDomain
      .replace(/^https?:\/\//, '')
      .replace(/\.bamboohr\.com.*$/, '')
      .trim()
  }

  #getAuthBaseUrl() {
    return `https://${ this.companyDomain }.bamboohr.com`
  }

  #getApiBaseUrl() {
    return `https://${ this.companyDomain }.bamboohr.com/api/v1`
  }

  #getAccessTokenHeader(accessToken) {
    return {
      Authorization: `Bearer ${ accessToken || this.request.headers['oauth-access-token'] }`,
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Accepts either an array or a comma-separated string and returns a trimmed, non-empty list
  // (or undefined). Used by params that take multiple names (e.g. new file category names).
  #toList(value) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    const list = Array.isArray(value)
      ? value
      : String(value).split(',').map(part => part.trim()).filter(Boolean)

    return list.length ? list : undefined
  }

  // Parses a filename out of a Content-Disposition header, accepting both the quoted-string
  // form (filename="x") and the RFC 5987 extended form (filename*=UTF-8''x).
  #parseFileNameFromContentDisposition(header) {
    if (!header) {
      return null
    }

    const match = String(header).match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i)

    if (!match) {
      return null
    }

    const raw = match[1] || match[2]

    try {
      return decodeURIComponent(raw)
    } catch (error) {
      return raw
    }
  }

  async #apiRequest({ url, method, body, query, logTag, rawResponse }) {
    method = method || 'get'

    try {
      logger.debug(
        `${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`
      )

      let request = Flowrunner.Request[method](url)
        .set(this.#getAccessTokenHeader())
        .set({ Accept: 'application/json' })
        .query(query)

      // rawResponse resolves to { status, headers, body } instead of the bare body - needed
      // when the useful result is a response header (e.g. the created id in Location).
      if (rawResponse) {
        request = request.unwrapBody(false)
      }

      if (body) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      logger.error(`${ logTag } - error: ${ error.message }`)

      throw error
    }
  }

  // ========================================== OAUTH2 SYSTEM METHODS ==========================================

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   */
  async getOAuth2ConnectionURL() {
    // docs: https://documentation.bamboohr.com/docs/getting-started
    // BambooHR's documented authorize.php flow requires request=authorize.
    // redirect_uri and state are intentionally omitted — the FlowRunner platform appends both.
    const params = new URLSearchParams()

    params.append('request', 'authorize')
    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('scope', SCOPE_STRING)

    return `${ this.#getAuthBaseUrl() }/authorize.php?${ params.toString() }`
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

    params.append('grant_type', 'authorization_code')
    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)
    params.append('code', callbackObject.code)
    params.append('redirect_uri', callbackObject.redirectURI)

    let codeExchangeResponse = {}

    try {
      codeExchangeResponse = await Flowrunner.Request.post(
        `${ this.#getAuthBaseUrl() }/token.php`
      )
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      logger.debug('[executeCallback] Token exchange successful')
    } catch (error) {
      logger.error(
        `[executeCallback] codeExchangeResponse error: ${ error.message }`
      )

      throw new Error(
        'Failed to exchange authorization code: ' + error.message
      )
    }

    // docs: https://documentation.bamboohr.com/page/openid-connect-login-api
    // The `openid` scope makes BambooHR return an id_token (a JWT) whose claims identify the
    // authenticated user directly. Prefer those claims over guessing the first directory user
    // from /meta/users/ (that endpoint is admin-gated and Object.values()[0] is arbitrary).
    const idTokenClaims = this.#decodeJwtPayload(codeExchangeResponse['id_token'])

    let currentUser = {}
    let connectionIdentityName = null

    if (idTokenClaims) {
      const claimName =
        idTokenClaims.name ||
        [idTokenClaims.given_name, idTokenClaims.family_name]
          .filter(Boolean)
          .join(' ') ||
        idTokenClaims.preferred_username ||
        null
      const claimEmail = idTokenClaims.email || null

      currentUser = idTokenClaims

      if (claimName && claimEmail) {
        connectionIdentityName = `${ claimName } (${ claimEmail })`
      } else {
        connectionIdentityName = claimName || claimEmail
      }
    }

    // Fallback: only query the directory if the id_token didn't yield an identity.
    if (!connectionIdentityName) {
      try {
        const userInfo = await Flowrunner.Request.get(
          `${ this.#getApiBaseUrl() }/meta/users/`
        )
          .set(this.#getAccessTokenHeader(codeExchangeResponse['access_token']))
          .set({ Accept: 'application/json' })

        const users = Object.values(userInfo || {})
        const fallbackUser = users[0] || {}

        const nameParts = [fallbackUser.firstName, fallbackUser.lastName].filter(
          Boolean
        )
        const displayName = nameParts.length > 0 ? nameParts.join(' ') : null

        currentUser = fallbackUser

        connectionIdentityName = displayName
          ? `${ displayName } (${ fallbackUser.email || '' })`
          : fallbackUser.email || null
      } catch (error) {
        logger.warn(`[executeCallback] directory lookup failed: ${ error.message }`)
      }
    }

    return {
      token: codeExchangeResponse['access_token'],
      expirationInSeconds: codeExchangeResponse['expires_in'] || 3600,
      refreshToken: codeExchangeResponse['refresh_token'],
      connectionIdentityName:
        connectionIdentityName || 'Unknown BambooHR Account',
      connectionIdentityImageURL: null,
      overwrite: true,
      userData: currentUser,
    }
  }

  /**
   * Decodes the payload of a JWT (e.g. an OIDC id_token) without verifying its signature.
   * Used only to read display-identity claims for the connection label.
   */
  #decodeJwtPayload(jwt) {
    if (!jwt || typeof jwt !== 'string') {
      return null
    }

    try {
      const payload = jwt.split('.')[1]

      if (!payload) {
        return null
      }

      const json = Buffer.from(payload, 'base64').toString('utf8')

      return JSON.parse(json)
    } catch (error) {
      logger.warn(`[executeCallback] failed to decode id_token: ${ error.message }`)

      return null
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
    const params = new URLSearchParams()

    params.append('grant_type', 'refresh_token')
    params.append('refresh_token', refreshToken)
    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)

    try {
      const response = await Flowrunner.Request.post(
        `${ this.#getAuthBaseUrl() }/token.php`
      )
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      return {
        token: response.access_token,
        expirationInSeconds: response.expires_in || 3600,
        refreshToken: response.refresh_token || refreshToken,
      }
    } catch (error) {
      logger.error(`[refreshToken] error: ${ error.message }`)

      throw error
    }
  }

  // ========================================== BUSINESS METHODS ==========================================

  /**
   * @typedef {Object} EmployeeDirectoryEntry
   * @property {String} id - The unique BambooHR employee ID.
   * @property {String} displayName - The employee's display name.
   * @property {String} firstName - The employee's first name.
   * @property {String} lastName - The employee's last name.
   * @property {String} preferredName - The employee's preferred name.
   * @property {String} jobTitle - The employee's job title.
   * @property {String} workPhone - The employee's work phone number.
   * @property {String} workEmail - The employee's work email address.
   * @property {String} department - The employee's department.
   * @property {String} location - The employee's work location.
   * @property {String} division - The employee's division.
   * @property {String} photoUrl - URL to the employee's profile photo.
   */

  /**
   * @typedef {Object} EmployeeDirectoryResponse
   * @property {Array<EmployeeDirectoryEntry>} employees - List of employees in the directory.
   */

  /**
   * @operationName Get Employee Directory
   * @category Employee Management
   * @description Retrieves the complete employee directory from BambooHR, including all listed employees with their basic contact and job information such as name, job title, department, work email, and phone number.
   * @route POST /getEmployeeDirectory
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @returns {EmployeeDirectoryResponse}
   * @sampleResult {"employees":[{"id":"123","displayName":"Jane Smith","firstName":"Jane","lastName":"Smith","preferredName":"Jane","jobTitle":"Software Engineer","workPhone":"+1-555-0100","workEmail":"jane.smith@example.com","department":"Engineering","location":"New York","division":"Technology","photoUrl":"https://example.bamboohr.com/employees/photos/123.jpg"}]}
   */
  async getEmployeeDirectory() {
    try {
      logger.debug('[getEmployeeDirectory] Fetching employee directory')

      const response = await this.#apiRequest({
        logTag: 'getEmployeeDirectory',
        url: `${ this.#getApiBaseUrl() }/employees/directory`,
      })

      logger.debug(
        `[getEmployeeDirectory] Retrieved ${ response.employees?.length || 0 } employees`
      )

      return response
    } catch (error) {
      logger.error(`[getEmployeeDirectory] Error: ${ error.message }`)

      throw new Error(
        `Failed to retrieve employee directory: ${ error.message }`
      )
    }
  }

  /**
   * @typedef {Object} EmployeeDetails
   * @property {String} id - The unique BambooHR employee ID.
   * @property {String} firstName - The employee's first name.
   * @property {String} lastName - The employee's last name.
   * @property {String} displayName - The employee's display name.
   * @property {String} jobTitle - The employee's job title.
   * @property {String} department - The employee's department.
   * @property {String} division - The employee's division.
   * @property {String} workEmail - The employee's work email address.
   * @property {String} workPhone - The employee's work phone number.
   * @property {String} mobilePhone - The employee's mobile phone number.
   * @property {String} hireDate - The employee's hire date in YYYY-MM-DD format.
   * @property {String} status - The employee's employment status (e.g., Active, Inactive).
   */

  /**
   * @operationName Get Employee By ID
   * @category Employee Management
   * @description Retrieves detailed information for a specific employee by their unique BambooHR employee ID, including personal details, job title, department, division, contact information, hire date, and employment status.
   * @route POST /getEmployeeById
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","required":true,"description":"The unique BambooHR employee ID (e.g., 123).","dictionary":"getEmployeeDirectoryDictionary"}
   * @paramDef {"type":"String","label":"Fields","name":"fields","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Comma-separated list of fields to return (e.g., firstName,lastName,workEmail,customNNNN). Use \"all\" to return every available field. Defaults to a standard set if not specified."}
   *
   * @returns {EmployeeDetails}
   * @sampleResult {"id":"123","firstName":"Jane","lastName":"Smith","displayName":"Jane Smith","jobTitle":"Software Engineer","department":"Engineering","division":"Technology","workEmail":"jane.smith@example.com","workPhone":"+1-555-0100","mobilePhone":"+1-555-0101","hireDate":"2022-03-15","status":"Active"}
   */
  async getEmployeeById(employeeId, fields) {
    try {
      if (!employeeId) {
        throw new Error('Employee ID is required')
      }

      logger.debug(
        `[getEmployeeById] Fetching employee with ID: ${ employeeId }`
      )

      // docs: https://documentation.bamboohr.com/reference/get-employee
      // BambooHR requires an explicit field list (or "all"); default to a standard set
      // but let callers request comp/custom/status-history fields or "all".
      const requestedFields = fields ? fields.trim() : EMPLOYEE_FIELDS.join(',')

      const response = await this.#apiRequest({
        logTag: 'getEmployeeById',
        url: `${ this.#getApiBaseUrl() }/employees/${ employeeId }`,
        query: { fields: requestedFields },
      })

      logger.debug(
        `[getEmployeeById] Successfully retrieved employee: ${ response.displayName || employeeId }`
      )

      return response
    } catch (error) {
      logger.error(`[getEmployeeById] Error: ${ error.message }`)

      throw new Error(
        `Failed to retrieve employee ${ employeeId }: ${ error.message }`
      )
    }
  }

  // ========================================== EMPLOYEE MANAGEMENT ==========================================

  /**
   * @typedef {Object} EmployeeListEntry
   * @property {String} employeeId - The unique BambooHR employee ID.
   * @property {String} firstName - The employee's first name.
   * @property {String} lastName - The employee's last name.
   * @property {String} preferredName - The employee's preferred name.
   * @property {String} photoUrl - URL to the employee's profile photo.
   * @property {String} jobTitleName - The employee's job title.
   * @property {String} status - Employment status (e.g., Active, Inactive).
   * @property {String} workEmail - The employee's work email address.
   */

  /**
   * @typedef {Object} ListEmployeesResponse
   * @property {Array<EmployeeListEntry>} employees - List of employees matching the query.
   */

  /**
   * @operationName List Employees
   * @category Employee Management
   * @description Returns a paginated list of employees with basic information such as name, job title, status, and photo URL. Additional fields like email and phone can be requested via the fields parameter.
   * @route POST /listEmployees
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Additional Fields","name":"fields","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Comma-separated list of additional fields to include (e.g., workEmail, homeEmail, bestEmail, middleName, workPhone, mobilePhone, homePhone)."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Sort order for results. Use field names with optional minus prefix for descending (e.g., lastName,-firstName)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of employees to return per page."}
   *
   * @returns {ListEmployeesResponse}
   * @sampleResult {"employees":[{"employeeId":"123","firstName":"Jane","lastName":"Smith","preferredName":"Jane","photoUrl":"https://example.bamboohr.com/photos/123.jpg","jobTitleName":"Engineer","status":"Active","workEmail":"jane@example.com"}]}
   */
  async listEmployees(fields, sort, pageSize) {
    try {
      logger.debug('[listEmployees] Fetching employee list')

      const defaultFields =
        'employeeId,firstName,lastName,preferredName,photoUrl,jobTitleName,status'
      const allFields = fields ? `${ defaultFields },${ fields }` : defaultFields

      const query = {
        fields: allFields,
      }

      if (sort) {
        query.sort = sort
      }

      if (pageSize) {
        query.limit = pageSize
      }

      const response = await this.#apiRequest({
        logTag: 'listEmployees',
        url: `${ this.#getApiBaseUrl() }/employees`,
        query,
      })

      logger.debug(
        `[listEmployees] Retrieved ${ response.employees?.length || 0 } employees`
      )

      return response
    } catch (error) {
      logger.error(`[listEmployees] Error: ${ error.message }`)

      throw new Error(`Failed to list employees: ${ error.message }`)
    }
  }

  /**
   * @typedef {Object} CreateEmployeeResponse
   * @property {Boolean} success - Whether the employee was created successfully.
   * @property {String} employeeId - The unique ID of the newly created employee.
   * @property {String} message - Status message describing the result.
   */

  /**
   * @operationName Create Employee
   * @category Employee Management
   * @description Creates a new employee in BambooHR. At minimum, first name and last name are required. Returns the new employee's ID so it can feed later actions.
   * @route POST /createEmployee
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"First Name","name":"firstName","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The employee's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The employee's last name."}
   * @paramDef {"type":"String","label":"Job Title","name":"jobTitle","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The employee's job title."}
   * @paramDef {"type":"String","label":"Department","name":"department","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The department the employee belongs to."}
   * @paramDef {"type":"String","label":"Division","name":"division","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The division the employee belongs to."}
   * @paramDef {"type":"String","label":"Work Email","name":"workEmail","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The employee's work email address."}
   * @paramDef {"type":"String","label":"Hire Date","name":"hireDate","uiComponent":{"type":"DATE_PICKER"},"description":"The employee's hire date in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"Location","name":"location","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The employee's work location."}
   *
   * @returns {CreateEmployeeResponse}
   * @sampleResult {"success":true,"employeeId":"456","message":"Employee created successfully"}
   */
  async createEmployee(
    firstName,
    lastName,
    jobTitle,
    department,
    division,
    workEmail,
    hireDate,
    location
  ) {
    try {
      if (!firstName) {
        throw new Error('First name is required')
      }

      if (!lastName) {
        throw new Error('Last name is required')
      }

      logger.debug(
        `[createEmployee] Creating employee: ${ firstName } ${ lastName }`
      )

      const body = { firstName, lastName }

      if (jobTitle) body.jobTitle = jobTitle
      if (department) body.department = department
      if (division) body.division = division
      if (workEmail) body.workEmail = workEmail
      if (hireDate) body.hireDate = hireDate
      if (location) body.location = location

      // BambooHR replies 201 with an empty body; the new employee's id is only in the
      // Location header (.../employees/{id}), so read the full response to recover it.
      const created = await this.#apiRequest({
        logTag: 'createEmployee',
        url: `${ this.#getApiBaseUrl() }/employees`,
        method: 'post',
        body,
        rawResponse: true,
      })

      const locationHeader =
        created?.headers?.location || created?.headers?.Location || ''
      const employeeId = locationHeader
        ? locationHeader.split('/').filter(Boolean).pop()
        : null

      logger.debug(
        `[createEmployee] Employee created successfully: ${ firstName } ${ lastName } (id ${ employeeId })`
      )

      return {
        success: true,
        employeeId,
        message: 'Employee created successfully',
      }
    } catch (error) {
      logger.error(`[createEmployee] Error: ${ error.message }`)

      throw new Error(`Failed to create employee: ${ error.message }`)
    }
  }

  /**
   * @typedef {Object} UpdateEmployeeResponse
   * @property {Boolean} success - Whether the employee was updated successfully.
   * @property {String} message - Status message describing the result.
   */

  /**
   * @operationName Update Employee
   * @category Employee Management
   * @description Updates one or more fields for an existing employee. Provide a JSON object of field name/value pairs to update. Use the List Fields method to discover available field names.
   * @route POST /updateEmployee
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","required":true,"description":"The unique BambooHR employee ID to update.","dictionary":"getEmployeeDirectoryDictionary"}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"schemaLoader":"updateEmployeeSchema","description":"The employee fields to change. Common fields are offered as inputs; to set a custom field, add its alias (e.g. custom4508269) as a key."}
   *
   * @returns {UpdateEmployeeResponse}
   * @sampleResult {"success":true,"message":"Employee updated successfully"}
   */
  async updateEmployee(employeeId, fields) {
    try {
      if (!employeeId) {
        throw new Error('Employee ID is required')
      }

      if (!fields || Object.keys(fields).length === 0) {
        throw new Error('At least one field is required to update')
      }

      logger.debug(
        `[updateEmployee] Updating employee ${ employeeId } with fields: ${ JSON.stringify(fields) }`
      )

      await this.#apiRequest({
        logTag: 'updateEmployee',
        url: `${ this.#getApiBaseUrl() }/employees/${ employeeId }`,
        method: 'post',
        body: fields,
      })

      logger.debug(
        `[updateEmployee] Employee ${ employeeId } updated successfully`
      )

      return { success: true, message: 'Employee updated successfully' }
    } catch (error) {
      logger.error(`[updateEmployee] Error: ${ error.message }`)

      throw new Error(
        `Failed to update employee ${ employeeId }: ${ error.message }`
      )
    }
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @returns {Array}
   */
  async updateEmployeeSchema() {
    // The common built-in employee fields BambooHR accepts on the update endpoint. Custom
    // fields (custom{id}) aren't listed here - callers add those keys directly to the object.
    return [
      { type: 'String', label: 'First Name', name: 'firstName', required: false, uiComponent: { type: 'SINGLE_LINE_TEXT' }, description: 'The employee\'s first name.' },
      { type: 'String', label: 'Last Name', name: 'lastName', required: false, uiComponent: { type: 'SINGLE_LINE_TEXT' }, description: 'The employee\'s last name.' },
      { type: 'String', label: 'Preferred Name', name: 'preferredName', required: false, uiComponent: { type: 'SINGLE_LINE_TEXT' }, description: 'The name the employee goes by.' },
      { type: 'String', label: 'Job Title', name: 'jobTitle', required: false, uiComponent: { type: 'SINGLE_LINE_TEXT' }, description: 'The employee\'s job title.' },
      { type: 'String', label: 'Department', name: 'department', required: false, uiComponent: { type: 'SINGLE_LINE_TEXT' }, description: 'The department the employee belongs to.' },
      { type: 'String', label: 'Division', name: 'division', required: false, uiComponent: { type: 'SINGLE_LINE_TEXT' }, description: 'The division the employee belongs to.' },
      { type: 'String', label: 'Location', name: 'location', required: false, uiComponent: { type: 'SINGLE_LINE_TEXT' }, description: 'The employee\'s work location.' },
      { type: 'String', label: 'Work Email', name: 'workEmail', required: false, uiComponent: { type: 'SINGLE_LINE_TEXT' }, description: 'The employee\'s work email address.' },
      { type: 'String', label: 'Work Phone', name: 'workPhone', required: false, uiComponent: { type: 'SINGLE_LINE_TEXT' }, description: 'The employee\'s work phone number.' },
      { type: 'String', label: 'Mobile Phone', name: 'mobilePhone', required: false, uiComponent: { type: 'SINGLE_LINE_TEXT' }, description: 'The employee\'s mobile phone number.' },
      { type: 'String', label: 'Home Email', name: 'homeEmail', required: false, uiComponent: { type: 'SINGLE_LINE_TEXT' }, description: 'The employee\'s personal email address.' },
      { type: 'String', label: 'Hire Date', name: 'hireDate', required: false, uiComponent: { type: 'DATE_PICKER' }, description: 'The employee\'s hire date in YYYY-MM-DD format.' },
      { type: 'String', label: 'Employment Status', name: 'status', required: false, uiComponent: { type: 'DROPDOWN', options: { values: ['Active', 'Inactive'] } }, description: 'The employee\'s employment status.' },
    ]
  }

  /**
   * @typedef {Object} ChangedEmployeeEntry
   * @property {String} id - The employee ID that changed.
   * @property {String} action - The type of change (e.g., Updated, Inserted, Deleted).
   * @property {String} lastChanged - ISO 8601 timestamp of the last change.
   */

  /**
   * @typedef {Object} GetChangedEmployeeIdsResponse
   * @property {String} latest - ISO 8601 timestamp of the most recent change across all employees.
   * @property {Object} employees - Map of employee IDs to their change details.
   */

  /**
   * @operationName Get Changed Employee IDs
   * @category Employee Management
   * @description Returns employee IDs that have changed since the given timestamp. Useful for incremental data synchronization. Any field change on an employee triggers their inclusion in the results.
   * @route POST /getChangedEmployeeIds
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Since","name":"since","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"ISO 8601 timestamp to retrieve changes from (e.g., 2024-01-01T00:00:00Z)."}
   * @paramDef {"type":"String","label":"Change Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Inserted","Updated","Deleted"]}},"description":"Filter by type of change. Leave blank to return every change type."}
   *
   * @returns {GetChangedEmployeeIdsResponse}
   * @sampleResult {"latest":"2024-03-15T14:30:00+00:00","employees":{"123":{"id":"123","action":"Updated","lastChanged":"2024-03-15T14:30:00+00:00"}}}
   */
  async getChangedEmployeeIds(since, type) {
    try {
      if (!since) {
        throw new Error('The "since" timestamp is required')
      }

      logger.debug(
        `[getChangedEmployeeIds] Fetching changes since: ${ since }, type: ${ type || 'all' }`
      )

      // The `type` filter accepts inserted/updated/deleted; omitting it returns every type.
      // The response `action` field is capitalized (e.g. "Updated"), unlike the lowercase filter.
      const query = { since }

      if (type) {
        query.type = this.#resolveChoice(type, { Inserted: 'inserted', Updated: 'updated', Deleted: 'deleted' })
      }

      const response = await this.#apiRequest({
        logTag: 'getChangedEmployeeIds',
        url: `${ this.#getApiBaseUrl() }/employees/changed`,
        query,
      })

      logger.debug(
        `[getChangedEmployeeIds] Retrieved changes, latest: ${ response.latest }`
      )

      return response
    } catch (error) {
      logger.error(`[getChangedEmployeeIds] Error: ${ error.message }`)

      throw new Error(`Failed to get changed employee IDs: ${ error.message }`)
    }
  }

  // ========================================== COMPANY ==========================================

  /**
   * @typedef {Object} CompanyAddress
   * @property {String} line1 - Street address line 1.
   * @property {String} line2 - Street address line 2.
   * @property {String} city - City name.
   * @property {String} state - State or province code.
   * @property {String} zip - Postal or ZIP code.
   */

  /**
   * @typedef {Object} CompanyInformationResponse
   * @property {String} legalName - The company's legal name.
   * @property {String} displayName - The company's display name.
   * @property {CompanyAddress} address - The company's primary address.
   * @property {String} phone - The company's primary phone number.
   */

  /**
   * @operationName Get Company Information
   * @category Company
   * @description Returns basic company profile information including legal name, display name, primary address, and contact phone number.
   * @route POST /getCompanyInformation
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @returns {CompanyInformationResponse}
   * @sampleResult {"legalName":"Acme Corp","displayName":"Acme","address":{"line1":"123 Main St","line2":"","city":"Denver","state":"CO","zip":"80202"},"phone":"555-0100"}
   */
  async getCompanyInformation() {
    try {
      logger.debug('[getCompanyInformation] Fetching company information')

      const response = await this.#apiRequest({
        logTag: 'getCompanyInformation',
        url: `${ this.#getApiBaseUrl() }/company_information`,
      })

      logger.debug(
        `[getCompanyInformation] Retrieved company: ${ response.displayName || response.legalName || 'unknown' }`
      )

      return response
    } catch (error) {
      logger.error(`[getCompanyInformation] Error: ${ error.message }`)

      throw new Error(
        `Failed to retrieve company information: ${ error.message }`
      )
    }
  }

  // ========================================== EMPLOYEE DATA ==========================================

  /**
   * @typedef {Object} EmployeeTableRow
   * @property {String} id - The unique row ID.
   * @property {String} employeeId - The employee ID this row belongs to.
   * @property {String} date - The effective date of the table entry.
   * @property {String} jobTitle - The job title (for jobInfo table).
   * @property {String} department - The department (for jobInfo table).
   * @property {String} division - The division (for jobInfo table).
   */

  /**
   * @operationName Get Employee Table Data
   * @category Employee Data
   * @description Returns all rows from a specific employee table such as jobInfo, compensation, or employmentStatus. Pick the table from the table list.
   * @route POST /getEmployeeTableData
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","required":true,"description":"The unique BambooHR employee ID.","dictionary":"getEmployeeDirectoryDictionary"}
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"description":"The employee table to retrieve (e.g., jobInfo, compensation, employmentStatus). Pick from the table list.","dictionary":"getTablesDictionary"}
   *
   * @returns {Array<EmployeeTableRow>}
   * @sampleResult [{"id":"1","employeeId":"123","date":"2023-01-15","jobTitle":"Software Engineer","department":"Engineering","division":"Product"}]
   */
  async getEmployeeTableData(employeeId, tableName) {
    try {
      if (!employeeId) {
        throw new Error('Employee ID is required')
      }

      if (!tableName) {
        throw new Error('Table name is required')
      }

      logger.debug(
        `[getEmployeeTableData] Fetching table "${ tableName }" for employee ${ employeeId }`
      )

      const response = await this.#apiRequest({
        logTag: 'getEmployeeTableData',
        url: `${ this.#getApiBaseUrl() }/employees/${ employeeId }/tables/${ tableName }`,
      })

      logger.debug(
        `[getEmployeeTableData] Retrieved ${ Array.isArray(response) ? response.length : 0 } rows from "${ tableName }"`
      )

      return response
    } catch (error) {
      logger.error(`[getEmployeeTableData] Error: ${ error.message }`)

      throw new Error(
        `Failed to retrieve table "${ tableName }" for employee ${ employeeId }: ${ error.message }`
      )
    }
  }

  /**
   * @typedef {Object} CreateTableRowResponse
   * @property {Boolean} success - Whether the table row was created successfully.
   * @property {String} message - Status message describing the result.
   */

  /**
   * @operationName Create Table Row
   * @category Employee Data
   * @description Adds a new row to a specified employee table (e.g., jobInfo, compensation). Use the List Fields method to discover available fields for each table.
   * @route POST /createTableRow
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","required":true,"description":"The unique BambooHR employee ID.","dictionary":"getEmployeeDirectoryDictionary"}
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"description":"The employee table to add a row to (e.g., jobInfo, compensation). Pick from the table list.","dictionary":"getTablesDictionary"}
   * @paramDef {"type":"Object","label":"Row Data","name":"rowData","required":true,"description":"Field name/value pairs for the new table row. Field names vary by table (use List Fields to discover them)."}
   *
   * @returns {CreateTableRowResponse}
   * @sampleResult {"success":true,"message":"Table row created successfully"}
   */
  async createTableRow(employeeId, tableName, rowData) {
    try {
      if (!employeeId) {
        throw new Error('Employee ID is required')
      }

      if (!tableName) {
        throw new Error('Table name is required')
      }

      if (!rowData || Object.keys(rowData).length === 0) {
        throw new Error('Row data is required')
      }

      logger.debug(
        `[createTableRow] Adding row to table "${ tableName }" for employee ${ employeeId }`
      )

      await this.#apiRequest({
        logTag: 'createTableRow',
        url: `${ this.#getApiBaseUrl() }/employees/${ employeeId }/tables/${ tableName }`,
        method: 'post',
        body: rowData,
      })

      logger.debug(
        `[createTableRow] Row added to table "${ tableName }" for employee ${ employeeId }`
      )

      return { success: true, message: 'Table row created successfully' }
    } catch (error) {
      logger.error(`[createTableRow] Error: ${ error.message }`)

      throw new Error(
        `Failed to create table row in "${ tableName }" for employee ${ employeeId }: ${ error.message }`
      )
    }
  }

  /**
   * @typedef {Object} UpdateTableRowResponse
   * @property {Boolean} success - Whether the table row was updated successfully.
   * @property {String} message - Status message describing the result.
   */

  /**
   * @operationName Update Table Row
   * @category Employee Data
   * @description Updates an existing row in an employee table. Only the provided fields will be changed; other fields remain unaffected.
   * @route POST /updateTableRow
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","required":true,"description":"The unique BambooHR employee ID.","dictionary":"getEmployeeDirectoryDictionary"}
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"description":"The employee table containing the row (e.g., jobInfo, compensation). Pick from the table list.","dictionary":"getTablesDictionary"}
   * @paramDef {"type":"String","label":"Row ID","name":"rowId","required":true,"description":"The unique ID of the table row to update.","dictionary":"getTableRowsDictionary","dependsOn":["employeeId","tableName"]}
   * @paramDef {"type":"Object","label":"Row Data","name":"rowData","required":true,"description":"Field name/value pairs to update in the table row. Field names vary by table (use List Fields to discover them)."}
   *
   * @returns {UpdateTableRowResponse}
   * @sampleResult {"success":true,"message":"Table row updated successfully"}
   */
  async updateTableRow(employeeId, tableName, rowId, rowData) {
    try {
      if (!employeeId) {
        throw new Error('Employee ID is required')
      }

      if (!tableName) {
        throw new Error('Table name is required')
      }

      if (!rowId) {
        throw new Error('Row ID is required')
      }

      if (!rowData || Object.keys(rowData).length === 0) {
        throw new Error('Row data is required')
      }

      logger.debug(
        `[updateTableRow] Updating row ${ rowId } in table "${ tableName }" for employee ${ employeeId }`
      )

      await this.#apiRequest({
        logTag: 'updateTableRow',
        url: `${ this.#getApiBaseUrl() }/employees/${ employeeId }/tables/${ tableName }/${ rowId }`,
        method: 'post',
        body: rowData,
      })

      logger.debug(
        `[updateTableRow] Row ${ rowId } updated in table "${ tableName }" for employee ${ employeeId }`
      )

      return { success: true, message: 'Table row updated successfully' }
    } catch (error) {
      logger.error(`[updateTableRow] Error: ${ error.message }`)

      throw new Error(
        `Failed to update table row ${ rowId } in "${ tableName }": ${ error.message }`
      )
    }
  }

  /**
   * @typedef {Object} DeleteTableRowResponse
   * @property {Boolean} success - Whether the table row was deleted successfully.
   */

  /**
   * @operationName Delete Table Row
   * @category Employee Data
   * @description Deletes a specific row from an employee table. This action is permanent and cannot be undone.
   * @route POST /deleteTableRow
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","required":true,"description":"The unique BambooHR employee ID.","dictionary":"getEmployeeDirectoryDictionary"}
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"description":"The employee table containing the row. Pick from the table list.","dictionary":"getTablesDictionary"}
   * @paramDef {"type":"String","label":"Row ID","name":"rowId","required":true,"description":"The unique ID of the table row to delete.","dictionary":"getTableRowsDictionary","dependsOn":["employeeId","tableName"]}
   *
   * @returns {DeleteTableRowResponse}
   * @sampleResult {"success":true}
   */
  async deleteTableRow(employeeId, tableName, rowId) {
    try {
      if (!employeeId) {
        throw new Error('Employee ID is required')
      }

      if (!tableName) {
        throw new Error('Table name is required')
      }

      if (!rowId) {
        throw new Error('Row ID is required')
      }

      logger.debug(
        `[deleteTableRow] Deleting row ${ rowId } from table "${ tableName }" for employee ${ employeeId }`
      )

      await this.#apiRequest({
        logTag: 'deleteTableRow',
        url: `${ this.#getApiBaseUrl() }/employees/${ employeeId }/tables/${ tableName }/${ rowId }`,
        method: 'delete',
      })

      logger.debug(
        `[deleteTableRow] Row ${ rowId } deleted from table "${ tableName }" for employee ${ employeeId }`
      )

      return { success: true }
    } catch (error) {
      logger.error(`[deleteTableRow] Error: ${ error.message }`)

      throw new Error(
        `Failed to delete table row ${ rowId } from "${ tableName }": ${ error.message }`
      )
    }
  }

  // ========================================== EMPLOYEE FILES ==========================================

  /**
   * @typedef {Object} EmployeeFile
   * @property {Number} id - The unique file ID.
   * @property {String} name - The display name of the file.
   * @property {String} originalFileName - The original file name.
   * @property {Number} size - The file size in bytes.
   * @property {String} dateCreated - ISO timestamp of when the file was created.
   * @property {String} createdBy - Name of the user who uploaded the file.
   */

  /**
   * @typedef {Object} EmployeeFileCategory
   * @property {Number} id - The unique category ID.
   * @property {String} name - The category name.
   * @property {Array<EmployeeFile>} files - List of files in the category.
   */

  /**
   * @typedef {Object} ListEmployeeFilesResponse
   * @property {Object} employee - The employee info object.
   * @property {Array<EmployeeFileCategory>} categories - List of file categories with their files.
   */

  /**
   * @operationName List Employee Files
   * @category Employee Files
   * @description Lists all file categories and files for an employee, including file metadata such as name, size, creation date, and sharing status.
   * @route POST /listEmployeeFiles
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","required":true,"description":"The unique BambooHR employee ID.","dictionary":"getEmployeeDirectoryDictionary"}
   *
   * @returns {ListEmployeeFilesResponse}
   * @sampleResult {"employee":{"id":123},"categories":[{"id":1,"name":"New Hire Documents","files":[{"id":100,"name":"Offer Letter","originalFileName":"offer.pdf","size":25600,"dateCreated":"2023-01-15T10:30:00+0000","createdBy":"HR Admin"}]}]}
   */
  async listEmployeeFiles(employeeId) {
    try {
      if (!employeeId) {
        throw new Error('Employee ID is required')
      }

      logger.debug(
        `[listEmployeeFiles] Listing files for employee ${ employeeId }`
      )

      const response = await this.#apiRequest({
        logTag: 'listEmployeeFiles',
        url: `${ this.#getApiBaseUrl() }/employees/${ employeeId }/files/view`,
      })

      logger.debug(
        `[listEmployeeFiles] Retrieved ${ response.categories?.length || 0 } file categories for employee ${ employeeId }`
      )

      return response
    } catch (error) {
      logger.error(`[listEmployeeFiles] Error: ${ error.message }`)

      throw new Error(
        `Failed to list files for employee ${ employeeId }: ${ error.message }`
      )
    }
  }

  /**
   * @typedef {Object} UploadEmployeeFileResponse
   * @property {Boolean} success - Whether the file was uploaded successfully.
   * @property {String} message - Status message describing the result.
   */

  /**
   * @operationName Upload Employee File
   * @category Employee Files
   * @description Uploads a file to an employee's file section. The file must be under 20MB. Use List Employee Files to find available category IDs.
   * @route POST /uploadEmployeeFile
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","required":true,"description":"The unique BambooHR employee ID.","dictionary":"getEmployeeDirectoryDictionary"}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Display name for the uploaded file."}
   * @paramDef {"type":"String","label":"Category","name":"categoryId","required":true,"description":"The employee file category to upload into.","dictionary":"getEmployeeFileCategoriesDictionary","dependsOn":["employeeId"]}
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"URL of the file to upload from Flowrunner file storage."}
   * @paramDef {"type":"String","label":"Share with Employee","name":"share","uiComponent":{"type":"DROPDOWN","options":{"values":["No","Yes"]}},"description":"Whether to share the file with the employee. Defaults to No."}
   *
   * @returns {UploadEmployeeFileResponse}
   * @sampleResult {"success":true,"message":"File uploaded successfully"}
   */
  async uploadEmployeeFile(employeeId, fileName, categoryId, fileUrl, share) {
    try {
      if (!employeeId) {
        throw new Error('Employee ID is required')
      }

      if (!fileName) {
        throw new Error('File name is required')
      }

      if (!categoryId) {
        throw new Error('Category ID is required')
      }

      if (!fileUrl) {
        throw new Error('File URL is required')
      }

      logger.debug(
        `[uploadEmployeeFile] Uploading file "${ fileName }" for employee ${ employeeId }`
      )

      const fileData = await Flowrunner.Request.get(fileUrl).setEncoding(null)

      // Do NOT set Content-Type manually — the form supplies the multipart boundary.
      const formData = new Flowrunner.Request.FormData()
      formData.append('file', fileData, { filename: fileName })
      formData.append('fileName', fileName)
      formData.append('category', String(categoryId))

      if (this.#resolveChoice(share, { No: 'no', Yes: 'yes' }) === 'yes') {
        formData.append('share', 'yes')
      }

      const request = Flowrunner.Request.post(
        `${ this.#getApiBaseUrl() }/employees/${ employeeId }/files`
      ).set(this.#getAccessTokenHeader())

      await request.form(formData)

      logger.debug(
        `[uploadEmployeeFile] File "${ fileName }" uploaded successfully for employee ${ employeeId }`
      )

      return { success: true, message: 'File uploaded successfully' }
    } catch (error) {
      logger.error(`[uploadEmployeeFile] Error: ${ error.message }`)

      throw new Error(
        `Failed to upload file for employee ${ employeeId }: ${ error.message }`
      )
    }
  }

  /**
   * @typedef {Object} DeleteEmployeeFileResponse
   * @property {Boolean} success - Whether the file was deleted successfully.
   * @property {String} message - Status message describing the result.
   */

  /**
   * @operationName Delete Employee File
   * @category Employee Files
   * @description Deletes a specific file from an employee's file section. This action is permanent and cannot be undone.
   * @route POST /deleteEmployeeFile
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","required":true,"description":"The unique BambooHR employee ID.","dictionary":"getEmployeeDirectoryDictionary"}
   * @paramDef {"type":"String","label":"File ID","name":"fileId","required":true,"description":"The unique ID of the file to delete.","dictionary":"getEmployeeFilesDictionary","dependsOn":["employeeId"]}
   *
   * @returns {DeleteEmployeeFileResponse}
   * @sampleResult {"success":true,"message":"Employee file deleted successfully"}
   */
  async deleteEmployeeFile(employeeId, fileId) {
    try {
      if (!employeeId) {
        throw new Error('Employee ID is required')
      }

      if (!fileId) {
        throw new Error('File ID is required')
      }

      logger.debug(
        `[deleteEmployeeFile] Deleting file ${ fileId } for employee ${ employeeId }`
      )

      await this.#apiRequest({
        logTag: 'deleteEmployeeFile',
        url: `${ this.#getApiBaseUrl() }/employees/${ employeeId }/files/${ fileId }`,
        method: 'delete',
      })

      logger.debug(
        `[deleteEmployeeFile] File ${ fileId } deleted for employee ${ employeeId }`
      )

      return { success: true, message: 'Employee file deleted successfully' }
    } catch (error) {
      logger.error(`[deleteEmployeeFile] Error: ${ error.message }`)

      throw new Error(
        `Failed to delete file ${ fileId } for employee ${ employeeId }: ${ error.message }`
      )
    }
  }

  /**
   * @typedef {Object} DownloadEmployeeFileResponse
   * @property {String} fileName - The original name of the downloaded file.
   * @property {String} contentType - The MIME type of the file.
   * @property {Number} sizeBytes - The size of the file in bytes.
   * @property {String} fileUrl - The FlowRunner Files URL where the downloaded file was saved.
   */

  /**
   * @operationName Download Employee File
   * @category Employee Files
   * @description Downloads an employee file's contents, saves them to FlowRunner file storage, and returns the saved file's URL along with its name, content type, and size.
   * @route POST /downloadEmployeeFile
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","required":true,"description":"The unique BambooHR employee ID whose file to download.","dictionary":"getEmployeeDirectoryDictionary"}
   * @paramDef {"type":"String","label":"File ID","name":"fileId","required":true,"description":"The unique ID of the employee file to download. Pick from the employee's files.","dictionary":"getEmployeeFilesDictionary","dependsOn":["employeeId"]}
   *
   * @returns {DownloadEmployeeFileResponse}
   * @sampleResult {"fileName":"offer.pdf","contentType":"application/pdf","sizeBytes":25600,"fileUrl":"https://files.flowrunner.io/bamboohr-downloads/offer.pdf"}
   */
  async downloadEmployeeFile(employeeId, fileId) {
    try {
      if (!employeeId) {
        throw new Error('Employee ID is required')
      }

      if (!fileId) {
        throw new Error('File ID is required')
      }

      logger.debug(
        `[downloadEmployeeFile] Downloading file ${ fileId } for employee ${ employeeId }`
      )

      const response = await Flowrunner.Request.get(
        `${ this.#getApiBaseUrl() }/employees/${ employeeId }/files/${ fileId }`
      )
        .set(this.#getAccessTokenHeader())
        .setEncoding(null)
        .unwrapBody(false)

      const headers = lowerKeys(response.headers)
      const fileName =
        this.#parseFileNameFromContentDisposition(headers['content-disposition']) ||
        `bamboohr-file-${ fileId }`
      const contentType = headers['content-type'] || 'application/octet-stream'
      const buffer = response.body

      if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new Error('The file download returned no content')
      }

      const { url } = await this.flowrunner.Files.uploadFile(buffer, {
        filename: fileName,
        generateUrl: true,
        overwrite: true,
        scope: 'FLOW',
      })

      logger.debug(
        `[downloadEmployeeFile] File ${ fileId } downloaded and saved as "${ fileName }"`
      )

      return {
        fileName,
        contentType,
        sizeBytes: buffer.length,
        fileUrl: url,
      }
    } catch (error) {
      logger.error(`[downloadEmployeeFile] Error: ${ error.message }`)

      throw new Error(
        `Failed to download file ${ fileId } for employee ${ employeeId }: ${ error.message }`
      )
    }
  }

  /**
   * @typedef {Object} UpdateEmployeeFileResponse
   * @property {Boolean} success - Whether the file was updated successfully.
   * @property {String} message - Status message describing the result.
   */

  /**
   * @operationName Update Employee File
   * @category Employee Files
   * @description Updates an employee file's name, category, or sharing setting. Only the fields provided are changed.
   * @route POST /updateEmployeeFile
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","required":true,"description":"The unique BambooHR employee ID whose file to update.","dictionary":"getEmployeeDirectoryDictionary"}
   * @paramDef {"type":"String","label":"File ID","name":"fileId","required":true,"description":"The unique ID of the employee file to update.","dictionary":"getEmployeeFilesDictionary","dependsOn":["employeeId"]}
   * @paramDef {"type":"String","label":"New Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New display name for the file. Leave blank to keep the current name."}
   * @paramDef {"type":"String","label":"Category","name":"categoryId","description":"Move the file to this category. Leave blank to keep the current category.","dictionary":"getEmployeeFileCategoriesDictionary","dependsOn":["employeeId"]}
   * @paramDef {"type":"String","label":"Share with Employee","name":"shareWithEmployee","uiComponent":{"type":"DROPDOWN","options":{"values":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]}},"description":"Whether the file is visible to the employee. Leave blank to keep the current setting."}
   *
   * @returns {UpdateEmployeeFileResponse}
   * @sampleResult {"success":true,"message":"Employee file updated successfully"}
   */
  async updateEmployeeFile(employeeId, fileId, name, categoryId, shareWithEmployee) {
    try {
      if (!employeeId) {
        throw new Error('Employee ID is required')
      }

      if (!fileId) {
        throw new Error('File ID is required')
      }

      const body = {}

      if (name) body.name = name
      if (categoryId) body.categoryId = String(categoryId)
      if (shareWithEmployee) body.shareWithEmployee = shareWithEmployee

      if (Object.keys(body).length === 0) {
        throw new Error('At least one field is required to update')
      }

      logger.debug(
        `[updateEmployeeFile] Updating file ${ fileId } for employee ${ employeeId }`
      )

      await this.#apiRequest({
        logTag: 'updateEmployeeFile',
        url: `${ this.#getApiBaseUrl() }/employees/${ employeeId }/files/${ fileId }`,
        method: 'post',
        body,
      })

      logger.debug(
        `[updateEmployeeFile] File ${ fileId } updated for employee ${ employeeId }`
      )

      return { success: true, message: 'Employee file updated successfully' }
    } catch (error) {
      logger.error(`[updateEmployeeFile] Error: ${ error.message }`)

      throw new Error(
        `Failed to update file ${ fileId } for employee ${ employeeId }: ${ error.message }`
      )
    }
  }

  /**
   * @typedef {Object} EmployeeFileCategoryEntry
   * @property {Number} id - The unique category ID.
   * @property {String} name - The category name.
   */

  /**
   * @typedef {Object} ListEmployeeFileCategoriesResponse
   * @property {Array<EmployeeFileCategoryEntry>} categories - List of employee file categories.
   */

  /**
   * @operationName List Employee File Categories
   * @category Employee Files
   * @description Lists the employee file categories visible to the caller. BambooHR has no standalone endpoint for this, so the categories are read from an employee's file listing (the categories are the same for every employee).
   * @route POST /listEmployeeFileCategories
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","required":true,"description":"Any employee you can view; the returned file categories are the same for every employee.","dictionary":"getEmployeeDirectoryDictionary"}
   *
   * @returns {ListEmployeeFileCategoriesResponse}
   * @sampleResult {"categories":[{"id":1,"name":"New Hire Documents"},{"id":112,"name":"Training Docs"}]}
   */
  async listEmployeeFileCategories(employeeId) {
    try {
      if (!employeeId) {
        throw new Error('Employee ID is required')
      }

      logger.debug(
        `[listEmployeeFileCategories] Listing file categories for employee ${ employeeId }`
      )

      const response = await this.#apiRequest({
        logTag: 'listEmployeeFileCategories',
        url: `${ this.#getApiBaseUrl() }/employees/${ employeeId }/files/view`,
      })

      const categories = Array.isArray(response?.categories) ? response.categories : []

      logger.debug(
        `[listEmployeeFileCategories] Retrieved ${ categories.length } categories`
      )

      return { categories: categories.map(c => ({ id: c.id, name: c.name })) }
    } catch (error) {
      logger.error(`[listEmployeeFileCategories] Error: ${ error.message }`)

      throw new Error(`Failed to list employee file categories: ${ error.message }`)
    }
  }

  /**
   * @typedef {Object} CreateFileCategoryResponse
   * @property {Boolean} success - Whether the category was created successfully.
   * @property {String} message - Status message describing the result.
   */

  /**
   * @operationName Create Employee File Category
   * @category Employee Files
   * @description Creates one or more employee file categories. Each name must be non-empty and unique among existing employee file categories. Requires admin permission.
   * @route POST /createEmployeeFileCategory
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"Array<String>","label":"Category Names","name":"categoryNames","required":true,"description":"One or more names for the new employee file categories. Each must be non-empty and unique. Accepts a list or a comma-separated string."}
   *
   * @returns {CreateFileCategoryResponse}
   * @sampleResult {"success":true,"message":"Employee file category created successfully"}
   */
  async createEmployeeFileCategory(categoryNames) {
    try {
      const names = this.#toList(categoryNames)

      if (!names) {
        throw new Error('At least one category name is required')
      }

      logger.debug(`[createEmployeeFileCategory] Creating categories: ${ names.join(', ') }`)

      await this.#apiRequest({
        logTag: 'createEmployeeFileCategory',
        url: `${ this.#getApiBaseUrl() }/employees/files/categories`,
        method: 'post',
        body: names,
      })

      logger.debug('[createEmployeeFileCategory] Categories created successfully')

      return { success: true, message: 'Employee file category created successfully' }
    } catch (error) {
      logger.error(`[createEmployeeFileCategory] Error: ${ error.message }`)

      throw new Error(`Failed to create employee file category: ${ error.message }`)
    }
  }

  // ========================================== EMPLOYEE DEPENDENTS ==========================================

  /**
   * @typedef {Object} EmployeeDependent
   * @property {String} id - The unique dependent ID.
   * @property {String} employeeId - The employee ID the dependent belongs to.
   * @property {String} firstName - The dependent's first name.
   * @property {String} lastName - The dependent's last name.
   * @property {String} relationship - The relationship to the employee (e.g., Spouse, Child).
   * @property {String} dateOfBirth - The dependent's date of birth in YYYY-MM-DD format.
   * @property {String} gender - The dependent's gender.
   */

  /**
   * @typedef {Object} ListEmployeeDependentsResponse
   * @property {Array<EmployeeDependent>} Employee Dependents - List of employee dependents.
   */

  /**
   * @operationName List Employee Dependents
   * @category Employee Dependents
   * @description Returns employee dependents for the company or a specific employee. Requires Benefits Administration permissions.
   * @route POST /listEmployeeDependents
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","description":"Optional employee ID to filter dependents for a specific employee. Returns all company dependents if omitted.","dictionary":"getEmployeeDirectoryDictionary"}
   *
   * @returns {ListEmployeeDependentsResponse}
   * @sampleResult {"Employee Dependents":[{"id":"1","employeeId":"123","firstName":"Sarah","lastName":"Smith","relationship":"Spouse","dateOfBirth":"1990-05-15","gender":"Female"}]}
   */
  async listEmployeeDependents(employeeId) {
    try {
      logger.debug(
        `[listEmployeeDependents] Fetching dependents${ employeeId ? ` for employee ${ employeeId }` : ' for all employees' }`
      )

      const query = {}

      if (employeeId) {
        query.employeeid = employeeId
      }

      const response = await this.#apiRequest({
        logTag: 'listEmployeeDependents',
        url: `${ this.#getApiBaseUrl() }/employeedependents`,
        query,
      })

      logger.debug(
        '[listEmployeeDependents] Retrieved dependents successfully'
      )

      return response
    } catch (error) {
      logger.error(`[listEmployeeDependents] Error: ${ error.message }`)

      throw new Error(`Failed to list employee dependents: ${ error.message }`)
    }
  }

  /**
   * @typedef {Object} CreateEmployeeDependentResponse
   * @property {Array<EmployeeDependent>} Employee Dependents - The created dependent record.
   */

  /**
   * @operationName Create Employee Dependent
   * @category Employee Dependents
   * @description Creates a new dependent record for an employee. Requires Benefits Administration permissions.
   * @route POST /createEmployeeDependent
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","required":true,"description":"The unique BambooHR employee ID.","dictionary":"getEmployeeDirectoryDictionary"}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The dependent's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The dependent's last name."}
   * @paramDef {"type":"String","label":"Relationship","name":"relationship","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The relationship to the employee (e.g., spouse, child)."}
   * @paramDef {"type":"String","label":"Date of Birth","name":"dateOfBirth","uiComponent":{"type":"DATE_PICKER"},"description":"The dependent's date of birth in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"Gender","name":"gender","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The dependent's gender."}
   * @paramDef {"type":"String","label":"US Citizen","name":"isUsCitizen","uiComponent":{"type":"DROPDOWN","options":{"values":["Yes","No"]}},"description":"Whether the dependent is a US citizen."}
   * @paramDef {"type":"String","label":"Student","name":"isStudent","uiComponent":{"type":"DROPDOWN","options":{"values":["Yes","No"]}},"description":"Whether the dependent is a student."}
   *
   * @returns {CreateEmployeeDependentResponse}
   * @sampleResult {"Employee Dependents":[{"id":"5","employeeId":"123","firstName":"Sarah","lastName":"Smith","relationship":"Spouse","dateOfBirth":"1990-05-15","gender":"Female"}]}
   */
  async createEmployeeDependent(
    employeeId,
    firstName,
    lastName,
    relationship,
    dateOfBirth,
    gender,
    isUsCitizen,
    isStudent
  ) {
    try {
      if (!employeeId) {
        throw new Error('Employee ID is required')
      }

      if (!firstName) {
        throw new Error('First name is required')
      }

      if (!lastName) {
        throw new Error('Last name is required')
      }

      if (!relationship) {
        throw new Error('Relationship is required')
      }

      logger.debug(
        `[createEmployeeDependent] Creating dependent "${ firstName } ${ lastName }" for employee ${ employeeId }`
      )

      const body = {
        employeeId,
        firstName,
        lastName,
        relationship,
      }

      if (dateOfBirth) body.dateOfBirth = dateOfBirth
      if (gender) body.gender = gender
      if (isUsCitizen) body.isUsCitizen = this.#resolveChoice(isUsCitizen, { Yes: 'yes', No: 'no' })
      if (isStudent) body.isStudent = this.#resolveChoice(isStudent, { Yes: 'yes', No: 'no' })

      const response = await this.#apiRequest({
        logTag: 'createEmployeeDependent',
        url: `${ this.#getApiBaseUrl() }/employeedependents`,
        method: 'post',
        body,
      })

      logger.debug(
        `[createEmployeeDependent] Dependent created for employee ${ employeeId }`
      )

      return response
    } catch (error) {
      logger.error(`[createEmployeeDependent] Error: ${ error.message }`)

      throw new Error(
        `Failed to create dependent for employee ${ employeeId }: ${ error.message }`
      )
    }
  }

  /**
   * @typedef {Object} UpdateEmployeeDependentResponse
   * @property {Array<EmployeeDependent>} Employee Dependents - The updated dependent record.
   */

  /**
   * @operationName Update Employee Dependent
   * @category Employee Dependents
   * @description Updates an existing employee dependent record. All required fields must be provided as this performs a full replacement of the dependent data.
   * @route POST /updateEmployeeDependent
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Dependent ID","name":"dependentId","required":true,"description":"The unique ID of the dependent record to update.","dictionary":"getEmployeeDependentsDictionary","dependsOn":["employeeId"]}
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","required":true,"description":"The unique BambooHR employee ID.","dictionary":"getEmployeeDirectoryDictionary"}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The dependent's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The dependent's last name."}
   * @paramDef {"type":"String","label":"Relationship","name":"relationship","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The relationship to the employee (e.g., spouse, child)."}
   * @paramDef {"type":"String","label":"Date of Birth","name":"dateOfBirth","uiComponent":{"type":"DATE_PICKER"},"description":"The dependent's date of birth in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"Gender","name":"gender","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The dependent's gender."}
   *
   * @returns {UpdateEmployeeDependentResponse}
   * @sampleResult {"Employee Dependents":[{"id":"5","employeeId":"123","firstName":"Sarah","lastName":"Smith-Jones","relationship":"Spouse","dateOfBirth":"1990-05-15","gender":"Female"}]}
   */
  async updateEmployeeDependent(
    dependentId,
    employeeId,
    firstName,
    lastName,
    relationship,
    dateOfBirth,
    gender
  ) {
    try {
      if (!dependentId) {
        throw new Error('Dependent ID is required')
      }

      if (!employeeId) {
        throw new Error('Employee ID is required')
      }

      if (!firstName) {
        throw new Error('First name is required')
      }

      if (!lastName) {
        throw new Error('Last name is required')
      }

      if (!relationship) {
        throw new Error('Relationship is required')
      }

      logger.debug(
        `[updateEmployeeDependent] Updating dependent ${ dependentId } for employee ${ employeeId }`
      )

      const body = {
        employeeId,
        firstName,
        lastName,
        relationship,
      }

      if (dateOfBirth) body.dateOfBirth = dateOfBirth
      if (gender) body.gender = gender

      const response = await this.#apiRequest({
        logTag: 'updateEmployeeDependent',
        url: `${ this.#getApiBaseUrl() }/employeedependents/${ dependentId }`,
        method: 'put',
        body,
      })

      logger.debug(
        `[updateEmployeeDependent] Dependent ${ dependentId } updated for employee ${ employeeId }`
      )

      return response
    } catch (error) {
      logger.error(`[updateEmployeeDependent] Error: ${ error.message }`)

      throw new Error(
        `Failed to update dependent ${ dependentId }: ${ error.message }`
      )
    }
  }

  // ========================================== TIME OFF METHODS ==========================================

  /**
   * @typedef {Object} TimeOffRequestStatus
   * @property {String} status - The current status of the request (e.g., approved, denied, requested, canceled).
   * @property {String} lastChanged - ISO 8601 date of the last status change.
   */

  /**
   * @typedef {Object} TimeOffRequestType
   * @property {Number} id - The time off type ID.
   * @property {String} name - The time off type name (e.g., Vacation, Sick Leave).
   * @property {String} icon - Icon identifier for the time off type.
   */

  /**
   * @typedef {Object} TimeOffRequestAmount
   * @property {String} unit - The unit of measurement (days or hours).
   * @property {String} amount - The total amount requested.
   */

  /**
   * @typedef {Object} TimeOffRequest
   * @property {Number} id - The unique time off request ID.
   * @property {Number} employeeId - The employee ID who made the request.
   * @property {String} name - The employee's display name.
   * @property {String} start - The start date of the time off in YYYY-MM-DD format.
   * @property {String} end - The end date of the time off in YYYY-MM-DD format.
   * @property {String} created - The date the request was created.
   * @property {TimeOffRequestStatus} status - The current status details.
   * @property {TimeOffRequestType} type - The time off type details.
   * @property {TimeOffRequestAmount} amount - The requested amount details.
   */

  /**
   * @operationName List Time Off Requests
   * @category Time Off
   * @description Returns time off requests within the specified date range. Results include request details, status, employee info, and daily amounts. Optionally filter by employee, status, or time off type.
   * @route POST /listTimeOffRequests
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Start Date","name":"start","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Start of the date range in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"End Date","name":"end","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"End of the date range in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","description":"Optional employee ID to filter requests for a specific employee.","dictionary":"getEmployeeDirectoryDictionary"}
   * @paramDef {"type":"String","label":"Status Filter","name":"status","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Comma-separated list of statuses to filter by (e.g., approved,denied,requested,canceled)."}
   * @paramDef {"type":"String","label":"Type Filter","name":"type","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Comma-separated list of time off type IDs to filter by."}
   *
   * @returns {Array<TimeOffRequest>}
   * @sampleResult [{"id":1,"employeeId":123,"name":"Jane Smith","start":"2024-03-01","end":"2024-03-05","created":"2024-02-15","status":{"status":"approved","lastChanged":"2024-02-16"},"type":{"id":1,"name":"Vacation","icon":"airplane"},"amount":{"unit":"days","amount":"5"}}]
   */
  async listTimeOffRequests(start, end, employeeId, status, type) {
    try {
      logger.debug(
        `[listTimeOffRequests] Fetching time off requests from ${ start } to ${ end }`
      )

      const query = { start, end }

      if (employeeId) {
        query.employeeId = employeeId
      }

      if (status) {
        query.status = status
      }

      if (type) {
        query.type = type
      }

      const response = await this.#apiRequest({
        logTag: 'listTimeOffRequests',
        url: `${ this.#getApiBaseUrl() }/time_off/requests`,
        query,
      })

      logger.debug(
        `[listTimeOffRequests] Retrieved ${ Array.isArray(response) ? response.length : 0 } requests`
      )

      return response
    } catch (error) {
      logger.error(`[listTimeOffRequests] Error: ${ error.message }`)

      throw new Error(`Failed to list time off requests: ${ error.message }`)
    }
  }

  /**
   * @typedef {Object} CreateTimeOffRequestResult
   * @property {Boolean} success - Whether the request was created successfully.
   * @property {String} message - A description of the result.
   */

  /**
   * @operationName Create Time Off Request
   * @category Time Off
   * @description Creates a time off request for an employee. Use status "approved" or "denied" to record directly without approval workflow. Use "requested" to submit for manager approval.
   * @route POST /createTimeOffRequest
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","required":true,"description":"The unique BambooHR employee ID.","dictionary":"getEmployeeDirectoryDictionary"}
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Requested","Approved","Denied"]}},"description":"The initial status for the request. Use Requested to submit for approval, or Approved/Denied to record directly."}
   * @paramDef {"type":"String","label":"Start Date","name":"start","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Start date of the time off in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"End Date","name":"end","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"End date of the time off in YYYY-MM-DD format."}
   * @paramDef {"type":"Number","label":"Time Off Type ID","name":"timeOffTypeId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The ID of the time off type (e.g., Vacation, Sick). Use List Time Off Types to find available IDs."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Total amount of time off in hours or days, depending on the time off type configuration."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional note text to attach to the request."}
   * @paramDef {"type":"Number","label":"Previous Request ID","name":"previousRequestId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"ID of a previous request to supersede with this new one."}
   *
   * @returns {CreateTimeOffRequestResult}
   * @sampleResult {"success":true,"message":"Time off request created successfully"}
   */
  async createTimeOffRequest(
    employeeId,
    status,
    start,
    end,
    timeOffTypeId,
    amount,
    notes,
    previousRequestId
  ) {
    try {
      if (!employeeId) {
        throw new Error('Employee ID is required')
      }

      logger.debug(
        `[createTimeOffRequest] Creating time off request for employee: ${ employeeId }`
      )

      const body = {
        status: this.#resolveChoice(status, { Requested: 'requested', Approved: 'approved', Denied: 'denied' }),
        start,
        end,
        timeOffTypeId,
      }

      if (amount !== undefined && amount !== null) {
        body.amount = amount
      }

      // BambooHR carries request notes as an array of { from, note } entries; a note added at
      // creation is attributed to the employee the request is for.
      if (notes) {
        body.notes = [{ from: 'employee', note: notes }]
      }

      if (previousRequestId !== undefined && previousRequestId !== null) {
        body.previousRequest = previousRequestId
      }

      await this.#apiRequest({
        logTag: 'createTimeOffRequest',
        url: `${ this.#getApiBaseUrl() }/employees/${ employeeId }/time_off/request`,
        method: 'put',
        body,
      })

      logger.debug(
        `[createTimeOffRequest] Successfully created time off request for employee: ${ employeeId }`
      )

      return {
        success: true,
        message: 'Time off request created successfully',
      }
    } catch (error) {
      logger.error(`[createTimeOffRequest] Error: ${ error.message }`)

      throw new Error(`Failed to create time off request: ${ error.message }`)
    }
  }

  /**
   * @typedef {Object} UpdateTimeOffRequestStatusResult
   * @property {Boolean} success - Whether the status was updated successfully.
   * @property {String} message - A description of the result.
   */

  /**
   * @operationName Update Time Off Request Status
   * @category Time Off
   * @description Updates the status of an existing time off request. Use this to approve, deny, or cancel a pending time off request.
   * @route POST /updateTimeOffRequestStatus
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Request ID","name":"requestId","required":true,"description":"The unique ID of the time off request to update.","dictionary":"getTimeOffRequestsDictionary"}
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Approved","Denied","Canceled"]}},"description":"The new status to set for the request."}
   * @paramDef {"type":"String","label":"Note","name":"note","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional note explaining the status change."}
   *
   * @returns {UpdateTimeOffRequestStatusResult}
   * @sampleResult {"success":true,"message":"Time off request status updated"}
   */
  async updateTimeOffRequestStatus(requestId, status, note) {
    try {
      if (!requestId) {
        throw new Error('Request ID is required')
      }

      logger.debug(
        `[updateTimeOffRequestStatus] Updating request ${ requestId } to status: ${ status }`
      )

      const body = { status: this.#resolveChoice(status, { Approved: 'approved', Denied: 'denied', Canceled: 'canceled' }) }

      if (note) {
        body.note = note
      }

      await this.#apiRequest({
        logTag: 'updateTimeOffRequestStatus',
        url: `${ this.#getApiBaseUrl() }/time_off/requests/${ requestId }/status`,
        method: 'put',
        body,
      })

      logger.debug(
        `[updateTimeOffRequestStatus] Successfully updated request ${ requestId }`
      )

      return { success: true, message: 'Time off request status updated' }
    } catch (error) {
      logger.error(`[updateTimeOffRequestStatus] Error: ${ error.message }`)

      throw new Error(
        `Failed to update time off request status: ${ error.message }`
      )
    }
  }

  /**
   * @typedef {Object} TimeOffBalance
   * @property {String} timeOffType - The time off type ID.
   * @property {String} name - The name of the time off category (e.g., Vacation, Sick Leave).
   * @property {String} units - The unit of measurement (hours or days).
   * @property {String} balance - The current available balance.
   * @property {String} end - The balance calculation end date.
   * @property {String} policyType - The policy type (accruing, discretionary, manual).
   * @property {String} usedYearToDate - The amount used year-to-date.
   */

  /**
   * @operationName Get Time Off Balance
   * @category Time Off
   * @description Returns time off balances for an employee across all assigned categories as of a given date. Shows balance, used year-to-date, and policy type for each time off category.
   * @route POST /getTimeOffBalance
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","required":true,"description":"The unique BambooHR employee ID.","dictionary":"getEmployeeDirectoryDictionary"}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","uiComponent":{"type":"DATE_PICKER"},"description":"Calculate balance as of this date in YYYY-MM-DD format. Defaults to today if not provided."}
   *
   * @returns {Array<TimeOffBalance>}
   * @sampleResult [{"timeOffType":"1","name":"Vacation","units":"hours","balance":"80.00","end":"2024-12-31","policyType":"accruing","usedYearToDate":"40.00"}]
   */
  async getTimeOffBalance(employeeId, endDate) {
    try {
      if (!employeeId) {
        throw new Error('Employee ID is required')
      }

      logger.debug(
        `[getTimeOffBalance] Fetching time off balance for employee: ${ employeeId }`
      )

      const query = {}

      if (endDate) {
        query.end = endDate
      }

      const response = await this.#apiRequest({
        logTag: 'getTimeOffBalance',
        url: `${ this.#getApiBaseUrl() }/employees/${ employeeId }/time_off/calculator`,
        query,
      })

      logger.debug(
        `[getTimeOffBalance] Retrieved balance for employee: ${ employeeId }`
      )

      return response
    } catch (error) {
      logger.error(`[getTimeOffBalance] Error: ${ error.message }`)

      throw new Error(
        `Failed to retrieve time off balance for employee ${ employeeId }: ${ error.message }`
      )
    }
  }

  /**
   * @typedef {Object} TimeOffPolicy
   * @property {Number} id - The unique policy ID.
   * @property {Number} timeOffTypeId - The associated time off type ID.
   * @property {String} name - The policy name.
   * @property {String} effectiveDate - The date the policy became effective, or null if always active.
   * @property {String} type - The policy type (accruing, discretionary, manual).
   */

  /**
   * @operationName List Time Off Policies
   * @category Time Off
   * @description Returns all time off policies configured for the company, including policy ID, name, type (accruing, discretionary, manual), and the associated time off type.
   * @route POST /listTimeOffPolicies
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @returns {Array<TimeOffPolicy>}
   * @sampleResult [{"id":1,"timeOffTypeId":1,"name":"Standard Vacation Policy","effectiveDate":null,"type":"accruing"}]
   */
  async listTimeOffPolicies() {
    try {
      logger.debug('[listTimeOffPolicies] Fetching time off policies')

      const response = await this.#apiRequest({
        logTag: 'listTimeOffPolicies',
        url: `${ this.#getApiBaseUrl() }/meta/time_off/policies`,
      })

      logger.debug(
        `[listTimeOffPolicies] Retrieved ${ Array.isArray(response) ? response.length : 0 } policies`
      )

      return response
    } catch (error) {
      logger.error(`[listTimeOffPolicies] Error: ${ error.message }`)

      throw new Error(`Failed to list time off policies: ${ error.message }`)
    }
  }

  /**
   * @typedef {Object} TimeOffType
   * @property {Number} id - The unique time off type ID.
   * @property {String} name - The name of the time off type (e.g., Vacation, Sick Leave).
   * @property {String} units - The unit of measurement (hours or days).
   * @property {String} color - The hex color code associated with this type.
   * @property {String} icon - The icon identifier for this type.
   * @property {String} source - The source of the type (internal or external).
   */

  /**
   * @typedef {Object} DefaultHoursEntry
   * @property {String} name - The day of the week.
   * @property {String} amount - The default number of hours for that day.
   */

  /**
   * @typedef {Object} TimeOffTypesResponse
   * @property {Array<TimeOffType>} timeOffTypes - List of configured time off types.
   * @property {Array<DefaultHoursEntry>} defaultHours - Default hours-per-day schedule for each weekday.
   */

  /**
   * @operationName List Time Off Types
   * @category Time Off
   * @description Returns all active time off types configured for the company along with the default hours-per-day schedule. Each type includes ID, name, units (hours/days), color, and icon.
   * @route POST /listTimeOffTypes
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @returns {TimeOffTypesResponse}
   * @sampleResult {"timeOffTypes":[{"id":1,"name":"Vacation","units":"hours","color":"56afdd","icon":"airplane","source":"internal"}],"defaultHours":[{"name":"Monday","amount":"8"}]}
   */
  async listTimeOffTypes() {
    try {
      logger.debug('[listTimeOffTypes] Fetching time off types')

      const response = await this.#apiRequest({
        logTag: 'listTimeOffTypes',
        url: `${ this.#getApiBaseUrl() }/meta/time_off/types`,
      })

      logger.debug(
        `[listTimeOffTypes] Retrieved ${ response.timeOffTypes?.length || 0 } time off types`
      )

      return response
    } catch (error) {
      logger.error(`[listTimeOffTypes] Error: ${ error.message }`)

      throw new Error(`Failed to list time off types: ${ error.message }`)
    }
  }

  /**
   * @typedef {Object} WhosOutEntry
   * @property {Number} id - The unique entry ID.
   * @property {String} type - The entry type (timeOff or holiday).
   * @property {Number} employeeId - The employee ID (present for timeOff entries only).
   * @property {String} name - The employee name or holiday name.
   * @property {String} start - The start date in YYYY-MM-DD format.
   * @property {String} end - The end date in YYYY-MM-DD format.
   */

  /**
   * @operationName List Who's Out
   * @category Time Off
   * @description Returns a list of employees who are out and company holidays for the specified period. Includes both time off entries and holidays. Defaults to the next 14 days if no dates are provided.
   * @route POST /listWhosOut
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","uiComponent":{"type":"DATE_PICKER"},"description":"Start of the date range in YYYY-MM-DD format. Defaults to today."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","uiComponent":{"type":"DATE_PICKER"},"description":"End of the date range in YYYY-MM-DD format. Defaults to 14 days from start."}
   *
   * @returns {Array<WhosOutEntry>}
   * @sampleResult [{"id":1,"type":"timeOff","employeeId":123,"name":"Jane Smith","start":"2024-03-01","end":"2024-03-05"},{"id":2,"type":"holiday","name":"Memorial Day","start":"2024-05-27","end":"2024-05-27"}]
   */
  async listWhosOut(startDate, endDate) {
    try {
      logger.debug("[listWhosOut] Fetching who's out")

      const query = {}

      if (startDate) {
        query.start = startDate
      }

      if (endDate) {
        query.end = endDate
      }

      const response = await this.#apiRequest({
        logTag: 'listWhosOut',
        url: `${ this.#getApiBaseUrl() }/time_off/whos_out`,
        query,
      })

      logger.debug(
        `[listWhosOut] Retrieved ${ Array.isArray(response) ? response.length : 0 } entries`
      )

      return response
    } catch (error) {
      logger.error(`[listWhosOut] Error: ${ error.message }`)

      throw new Error(`Failed to list who's out: ${ error.message }`)
    }
  }

  /**
   * @typedef {Object} EmployeeTimeOffPolicy
   * @property {Number} timeOffPolicyId - The assigned policy ID.
   * @property {Number} timeOffTypeId - The associated time off type ID.
   * @property {String} accrualStartDate - The date when accrual begins for this employee in YYYY-MM-DD format.
   */

  /**
   * @operationName List Employee Time Off Policies
   * @category Time Off
   * @description Returns time off policies currently assigned to a specific employee, including policy ID, time off type, and accrual start date.
   * @route POST /listEmployeeTimeOffPolicies
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","required":true,"description":"The unique BambooHR employee ID.","dictionary":"getEmployeeDirectoryDictionary"}
   *
   * @returns {Array<EmployeeTimeOffPolicy>}
   * @sampleResult [{"timeOffPolicyId":1,"timeOffTypeId":1,"accrualStartDate":"2023-01-15"}]
   */
  async listEmployeeTimeOffPolicies(employeeId) {
    try {
      if (!employeeId) {
        throw new Error('Employee ID is required')
      }

      logger.debug(
        `[listEmployeeTimeOffPolicies] Fetching policies for employee: ${ employeeId }`
      )

      const response = await this.#apiRequest({
        logTag: 'listEmployeeTimeOffPolicies',
        url: `${ this.#getApiBaseUrl() }/employees/${ employeeId }/time_off/policies`,
      })

      logger.debug(
        `[listEmployeeTimeOffPolicies] Retrieved ${ Array.isArray(response) ? response.length : 0 } policies for employee: ${ employeeId }`
      )

      return response
    } catch (error) {
      logger.error(`[listEmployeeTimeOffPolicies] Error: ${ error.message }`)

      throw new Error(
        `Failed to list time off policies for employee ${ employeeId }: ${ error.message }`
      )
    }
  }

  /**
   * @typedef {Object} AdjustTimeOffBalanceResult
   * @property {Boolean} success - Whether the balance adjustment was applied successfully.
   * @property {String} message - A description of the result.
   */

  /**
   * @operationName Adjust Time Off Balance
   * @category Time Off
   * @description Creates a balance adjustment for an employee's time off type. Use positive amounts to add balance and negative amounts to subtract. Cannot adjust discretionary (unlimited) time off types.
   * @route POST /adjustTimeOffBalance
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","required":true,"description":"The unique BambooHR employee ID.","dictionary":"getEmployeeDirectoryDictionary"}
   * @paramDef {"type":"Number","label":"Time Off Type ID","name":"timeOffTypeId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The ID of the time off type to adjust. Use List Time Off Types to find available IDs."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The adjustment amount. Use a positive value to add balance and a negative value to subtract."}
   * @paramDef {"type":"String","label":"Effective Date","name":"date","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"The effective date for the balance adjustment in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"Note","name":"note","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional reason or explanation for the balance adjustment."}
   *
   * @returns {AdjustTimeOffBalanceResult}
   * @sampleResult {"success":true,"message":"Time off balance adjusted successfully"}
   */
  async adjustTimeOffBalance(employeeId, timeOffTypeId, amount, date, note) {
    try {
      if (!employeeId) {
        throw new Error('Employee ID is required')
      }

      logger.debug(
        `[adjustTimeOffBalance] Adjusting balance for employee ${ employeeId }, type ${ timeOffTypeId }, amount ${ amount }`
      )

      const body = {
        timeOffTypeId,
        amount,
        date,
      }

      if (note) {
        body.note = note
      }

      await this.#apiRequest({
        logTag: 'adjustTimeOffBalance',
        url: `${ this.#getApiBaseUrl() }/employees/${ employeeId }/time_off/balance_adjustment`,
        method: 'put',
        body,
      })

      logger.debug(
        `[adjustTimeOffBalance] Successfully adjusted balance for employee: ${ employeeId }`
      )

      return {
        success: true,
        message: 'Time off balance adjusted successfully',
      }
    } catch (error) {
      logger.error(`[adjustTimeOffBalance] Error: ${ error.message }`)

      throw new Error(`Failed to adjust time off balance: ${ error.message }`)
    }
  }

  // ========================================== TIME TRACKING METHODS ==========================================

  /**
   * @typedef {Object} TimesheetEntry
   * @property {Number} id - The unique timesheet entry ID.
   * @property {Number} employeeId - The employee ID.
   * @property {String} type - The entry type (hour or clock).
   * @property {String} start - The start date or datetime.
   * @property {String} end - The end date or datetime.
   * @property {Number} hours - The total hours recorded.
   * @property {String} note - An optional note for the entry.
   * @property {Number} projectId - The associated project ID, or null.
   * @property {Number} taskId - The associated task ID, or null.
   */

  /**
   * @typedef {Object} TimesheetEntriesResponse
   * @property {Array<TimesheetEntry>} timesheetEntries - List of timesheet entries.
   */

  /**
   * @operationName List Timesheet Entries
   * @category Time Tracking
   * @description Returns timesheet entries for all or specified employees within a date range. Dates must be within the last 365 days. Results include both clock-based and hour-based entry types.
   * @route POST /listTimesheetEntries
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Start Date","name":"start","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Start of the date range in YYYY-MM-DD format. Must be within the last 365 days."}
   * @paramDef {"type":"String","label":"End Date","name":"end","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"End of the date range in YYYY-MM-DD format. Must be within the last 365 days."}
   * @paramDef {"type":"String","label":"Employee IDs","name":"employeeIds","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Comma-separated employee IDs to filter results (e.g., '1,2,3'). Returns all employees if not provided."}
   *
   * @returns {TimesheetEntriesResponse}
   * @sampleResult {"timesheetEntries":[{"id":1,"employeeId":123,"type":"hour","start":"2024-03-01","end":"2024-03-01","hours":8.0,"note":"Regular work day","projectId":null,"taskId":null}]}
   */
  async listTimesheetEntries(start, end, employeeIds) {
    try {
      logger.debug(
        `[listTimesheetEntries] Fetching timesheet entries from ${ start } to ${ end }`
      )

      const query = { start, end }

      if (employeeIds) {
        query.employeeIds = employeeIds
      }

      const response = await this.#apiRequest({
        logTag: 'listTimesheetEntries',
        url: `${ this.#getApiBaseUrl() }/time_tracking/timesheet_entries`,
        query,
      })

      logger.debug(
        `[listTimesheetEntries] Retrieved ${ response.timesheetEntries?.length || 0 } entries`
      )

      return response
    } catch (error) {
      logger.error(`[listTimesheetEntries] Error: ${ error.message }`)

      throw new Error(`Failed to list timesheet entries: ${ error.message }`)
    }
  }

  /**
   * @typedef {Object} ClockEntry
   * @property {Number} id - The unique clock entry ID.
   * @property {Number} employeeId - The employee ID.
   * @property {String} type - The entry type (clock).
   * @property {String} start - The clock-in datetime in ISO 8601 format.
   * @property {String} end - The clock-out datetime in ISO 8601 format, or null if still clocked in.
   * @property {String} timezone - The timezone of the entry.
   * @property {Number} hours - The total hours, available after clock-out.
   */

  /**
   * @operationName Clock In Employee
   * @category Time Tracking
   * @description Clocks in an employee. Without date and time parameters, clocks in at the current server time. Provide date, startTime, and timezone for historical or timezone-specific entries.
   * @route POST /clockInEmployee
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","required":true,"description":"The unique BambooHR employee ID.","dictionary":"getEmployeeDirectoryDictionary"}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Date for a historical clock-in entry in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"Start Time","name":"startTime","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Clock-in time in HH:MM 24-hour format (e.g., 09:00)."}
   * @paramDef {"type":"String","label":"Timezone","name":"timezone","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"IANA timezone identifier (e.g., America/Denver, Europe/London)."}
   * @paramDef {"type":"String","label":"Note","name":"note","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional note for the clock-in entry."}
   * @paramDef {"type":"Number","label":"Project ID","name":"projectId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional project ID to associate with this clock entry."}
   * @paramDef {"type":"Number","label":"Task ID","name":"taskId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional task ID to associate with this clock entry."}
   *
   * @returns {ClockEntry}
   * @sampleResult {"id":1,"employeeId":123,"type":"clock","start":"2024-03-01T09:00:00","end":null,"timezone":"America/Denver"}
   */
  async clockInEmployee(
    employeeId,
    date,
    startTime,
    timezone,
    note,
    projectId,
    taskId
  ) {
    try {
      if (!employeeId) {
        throw new Error('Employee ID is required')
      }

      logger.debug(`[clockInEmployee] Clocking in employee: ${ employeeId }`)

      const body = {}

      if (date) {
        body.date = date
      }

      if (startTime) {
        body.start = startTime
      }

      if (timezone) {
        body.timezone = timezone
      }

      if (note) {
        body.note = note
      }

      if (projectId !== undefined && projectId !== null) {
        body.projectId = projectId
      }

      if (taskId !== undefined && taskId !== null) {
        body.taskId = taskId
      }

      const response = await this.#apiRequest({
        logTag: 'clockInEmployee',
        url: `${ this.#getApiBaseUrl() }/time_tracking/employees/${ employeeId }/clock_in`,
        method: 'post',
        body,
      })

      logger.debug(
        `[clockInEmployee] Successfully clocked in employee: ${ employeeId }`
      )

      return response
    } catch (error) {
      logger.error(`[clockInEmployee] Error: ${ error.message }`)

      throw new Error(
        `Failed to clock in employee ${ employeeId }: ${ error.message }`
      )
    }
  }

  /**
   * @operationName Clock Out Employee
   * @category Time Tracking
   * @description Clocks out a currently clocked-in employee. Without parameters, clocks out at the current server time. Provide date, endTime, and timezone for historical or timezone-specific entries.
   * @route POST /clockOutEmployee
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","required":true,"description":"The unique BambooHR employee ID.","dictionary":"getEmployeeDirectoryDictionary"}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Date for a historical clock-out entry in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"End Time","name":"endTime","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Clock-out time in HH:MM 24-hour format (e.g., 17:00)."}
   * @paramDef {"type":"String","label":"Timezone","name":"timezone","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"IANA timezone identifier (e.g., America/Denver, Europe/London)."}
   *
   * @returns {ClockEntry}
   * @sampleResult {"id":1,"employeeId":123,"type":"clock","start":"2024-03-01T09:00:00","end":"2024-03-01T17:00:00","timezone":"America/Denver","hours":8.0}
   */
  async clockOutEmployee(employeeId, date, endTime, timezone) {
    try {
      if (!employeeId) {
        throw new Error('Employee ID is required')
      }

      logger.debug(`[clockOutEmployee] Clocking out employee: ${ employeeId }`)

      const body = {}

      if (date) {
        body.date = date
      }

      if (endTime) {
        body.end = endTime
      }

      if (timezone) {
        body.timezone = timezone
      }

      const response = await this.#apiRequest({
        logTag: 'clockOutEmployee',
        url: `${ this.#getApiBaseUrl() }/time_tracking/employees/${ employeeId }/clock_out`,
        method: 'post',
        body,
      })

      logger.debug(
        `[clockOutEmployee] Successfully clocked out employee: ${ employeeId }`
      )

      return response
    } catch (error) {
      logger.error(`[clockOutEmployee] Error: ${ error.message }`)

      throw new Error(
        `Failed to clock out employee ${ employeeId }: ${ error.message }`
      )
    }
  }

  /**
   * @typedef {Object} HourEntry
   * @property {Number} id - The unique hour entry ID.
   * @property {Number} employeeId - The employee ID.
   * @property {String} type - The entry type (hour).
   * @property {String} date - The date of the entry in YYYY-MM-DD format.
   * @property {Number} hours - The number of hours recorded.
   */

  /**
   * @typedef {Object} HourEntriesResponse
   * @property {Array<HourEntry>} timesheetEntries - List of created or updated hour entries.
   */

  /**
   * @operationName Create or Update Hour Entries
   * @category Time Tracking
   * @description Creates or updates timesheet hour entries in bulk. Include an ID in each entry object to update an existing entry; omit the ID to create a new one. Each entry requires employeeId, date, and hours at minimum.
   * @route POST /createOrUpdateHourEntries
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"Array<Object>","label":"Entries","name":"entries","required":true,"description":"JSON array of hour entry objects. Each entry: { employeeId (number, required), date (string YYYY-MM-DD, required), hours (number, required), projectId (number, optional), taskId (number, optional), note (string, optional), id (number, optional - include to update existing entry) }."}
   *
   * @returns {HourEntriesResponse}
   * @sampleResult {"timesheetEntries":[{"id":1,"employeeId":123,"type":"hour","date":"2024-03-01","hours":8.0}]}
   */
  async createOrUpdateHourEntries(entries) {
    try {
      logger.debug('[createOrUpdateHourEntries] Storing hour entries')

      const body = { hours: entries }

      const response = await this.#apiRequest({
        logTag: 'createOrUpdateHourEntries',
        url: `${ this.#getApiBaseUrl() }/time_tracking/hour_entries/store`,
        method: 'post',
        body,
      })

      logger.debug(
        '[createOrUpdateHourEntries] Successfully stored hour entries'
      )

      return response
    } catch (error) {
      logger.error(`[createOrUpdateHourEntries] Error: ${ error.message }`)

      throw new Error(
        `Failed to create or update hour entries: ${ error.message }`
      )
    }
  }

  // ========================================== RECRUITING METHODS ==========================================

  /**
   * @typedef {Object} JobApplicationApplicant
   * @property {String} firstName - The applicant's first name.
   * @property {String} lastName - The applicant's last name.
   * @property {String} email - The applicant's email address.
   */

  /**
   * @typedef {Object} JobApplicationStatus
   * @property {Number} id - The status ID.
   * @property {String} label - The status display label.
   */

  /**
   * @typedef {Object} JobApplicationJob
   * @property {Number} id - The job opening ID.
   * @property {String} title - The job title.
   */

  /**
   * @typedef {Object} JobApplicationEntry
   * @property {Number} id - The application ID.
   * @property {String} appliedDate - The date the candidate applied (YYYY-MM-DD).
   * @property {JobApplicationStatus} status - The current application status.
   * @property {Number} rating - The applicant's rating (1-5).
   * @property {JobApplicationApplicant} applicant - The applicant's personal details.
   * @property {JobApplicationJob} job - The associated job opening.
   */

  /**
   * @typedef {Object} JobApplicationsResponse
   * @property {Array<JobApplicationEntry>} applications - List of job applications.
   */

  /**
   * @operationName Get Job Applications
   * @category Recruiting
   * @description Returns a list of job applications with applicant details, job info, status, and ratings. Can be filtered by job opening, application status, or a search term.
   * @route POST /getJobApplications
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"Number","label":"Job ID","name":"jobId","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Filter applications by a specific job opening ID."}
   * @paramDef {"type":"String","label":"Application Status","name":"applicationStatus","uiComponent":{"type":"DROPDOWN","options":{"values":["All","All Active","New","Active","Inactive","Hired"]}},"description":"Filter applications by status group. Defaults to All Active if not specified."}
   * @paramDef {"type":"String","label":"Search","name":"searchString","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Search term to filter applications by applicant name or other details."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Applicant Name","Job Title","Rating","Status","Last Updated","Created Date"]}},"description":"Field to sort results by."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number for paginated results (starts at 1)."}
   *
   * @returns {JobApplicationsResponse}
   * @sampleResult {"applications":[{"id":1,"appliedDate":"2024-02-01","status":{"id":1,"label":"New"},"rating":4,"applicant":{"firstName":"John","lastName":"Doe","email":"john@example.com"},"job":{"id":10,"title":"Software Engineer"}}]}
   */
  async getJobApplications(
    jobId,
    applicationStatus,
    searchString,
    sortBy,
    sortOrder,
    page
  ) {
    try {
      logger.debug('[getJobApplications] Fetching job applications')

      const query = {}

      if (jobId) {
        query.jobId = jobId
      }

      // The status-group values (ALL_ACTIVE, NEW, HIRED, ...) go on `applicationStatus`;
      // `applicationStatusId` is for a single numeric status id, which this action doesn't take.
      if (applicationStatus) {
        query.applicationStatus = this.#resolveChoice(applicationStatus, { All: 'ALL', 'All Active': 'ALL_ACTIVE', New: 'NEW', Active: 'ACTIVE', Inactive: 'INACTIVE', Hired: 'HIRED' })
      }

      if (searchString) {
        query.search = searchString
      }

      if (sortBy) {
        query.sortBy = this.#resolveChoice(sortBy, { 'Applicant Name': 'first_name', 'Job Title': 'job_title', Rating: 'rating', Status: 'status', 'Last Updated': 'last_updated', 'Created Date': 'created_date' })
      }

      if (sortOrder) {
        query.sortOrder = this.#resolveChoice(sortOrder, { Ascending: 'ASC', Descending: 'DESC' })
      }

      if (page) {
        query.page = page
      }

      const response = await this.#apiRequest({
        logTag: 'getJobApplications',
        url: `${ this.#getApiBaseUrl() }/applicant_tracking/applications`,
        query,
      })

      logger.debug(
        `[getJobApplications] Retrieved ${ response.applications?.length || 0 } applications`
      )

      return response
    } catch (error) {
      logger.error(`[getJobApplications] Error: ${ error.message }`)

      throw new Error(`Failed to retrieve job applications: ${ error.message }`)
    }
  }

  /**
   * @typedef {Object} JobApplicationDetailStatus
   * @property {Number} id - The status ID.
   * @property {String} label - The status display label.
   * @property {String} dateChanged - The date the status was last changed.
   */

  /**
   * @typedef {Object} JobApplicationDetailApplicant
   * @property {String} firstName - The applicant's first name.
   * @property {String} lastName - The applicant's last name.
   * @property {String} email - The applicant's email address.
   * @property {String} phone - The applicant's phone number.
   */

  /**
   * @typedef {Object} JobApplicationQA
   * @property {String} question - The application question text.
   * @property {String} answer - The applicant's answer.
   */

  /**
   * @typedef {Object} JobApplicationDetailsResponse
   * @property {Number} id - The application ID.
   * @property {String} appliedDate - The date the candidate applied (YYYY-MM-DD).
   * @property {JobApplicationDetailStatus} status - The current application status with change date.
   * @property {Number} rating - The applicant's rating (1-5).
   * @property {JobApplicationDetailApplicant} applicant - The applicant's personal details.
   * @property {JobApplicationJob} job - The associated job opening.
   * @property {Array<JobApplicationQA>} questionsAndAnswers - Application questions and responses.
   */

  /**
   * @operationName Get Job Application Details
   * @category Recruiting
   * @description Returns full details of a single job application including applicant info, status history, questions and answers, and attached documents.
   * @route POST /getJobApplicationDetails
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Application ID","name":"applicationId","required":true,"description":"The unique ID of the job application to retrieve.","dictionary":"getJobApplicationsDictionary"}
   *
   * @returns {JobApplicationDetailsResponse}
   * @sampleResult {"id":1,"appliedDate":"2024-02-01","status":{"id":1,"label":"New","dateChanged":"2024-02-01"},"rating":4,"applicant":{"firstName":"John","lastName":"Doe","email":"john@example.com","phone":"555-0100"},"job":{"id":10,"title":"Software Engineer"},"questionsAndAnswers":[{"question":"Years of experience?","answer":"5"}]}
   */
  async getJobApplicationDetails(applicationId) {
    try {
      if (!applicationId) {
        throw new Error('Application ID is required')
      }

      logger.debug(
        `[getJobApplicationDetails] Fetching application: ${ applicationId }`
      )

      const response = await this.#apiRequest({
        logTag: 'getJobApplicationDetails',
        url: `${ this.#getApiBaseUrl() }/applicant_tracking/applications/${ applicationId }`,
      })

      logger.debug(
        `[getJobApplicationDetails] Successfully retrieved application ${ applicationId }`
      )

      return response
    } catch (error) {
      logger.error(`[getJobApplicationDetails] Error: ${ error.message }`)

      throw new Error(
        `Failed to retrieve application details: ${ error.message }`
      )
    }
  }

  /**
   * @typedef {Object} JobSummaryEntry
   * @property {Number} id - The job opening ID.
   * @property {String} title - The job title.
   * @property {String} postedDate - The date the job was posted (YYYY-MM-DD).
   * @property {String} location - The job location.
   * @property {String} department - The department for this job.
   * @property {String} status - The current job status (e.g., Open, Filled, Draft).
   * @property {String} hiringLead - The name of the hiring lead.
   * @property {Number} newApplicantsCount - Number of new applicants.
   * @property {Number} activeApplicantsCount - Number of active applicants.
   * @property {Number} totalApplicantsCount - Total number of applicants.
   */

  /**
   * @operationName Get Job Summaries
   * @category Recruiting
   * @description Returns a list of job opening summaries including title, status, hiring lead, location, and applicant counts.
   * @route POST /getJobSummaries
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Status Groups","name":"statusGroups","uiComponent":{"type":"DROPDOWN","options":{"values":["All","Draft and Open","Open","Filled","Draft","On Hold","Canceled"]}},"description":"Filter job openings by status group. Defaults to All if not specified."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Applicant Count","Title","Hiring Lead","Created Date","Status"]}},"description":"Field to sort results by."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction."}
   *
   * @returns {Array<JobSummaryEntry>}
   * @sampleResult [{"id":10,"title":"Software Engineer","postedDate":"2024-01-15","location":"Remote","department":"Engineering","status":"Open","hiringLead":"Jane Manager","newApplicantsCount":5,"activeApplicantsCount":12,"totalApplicantsCount":30}]
   */
  async getJobSummaries(statusGroups, sortBy, sortOrder) {
    try {
      logger.debug('[getJobSummaries] Fetching job summaries')

      const query = {}

      if (statusGroups) {
        query.statusGroups = this.#resolveChoice(statusGroups, { All: 'ALL', 'Draft and Open': 'DRAFT_AND_OPEN', Open: 'Open', Filled: 'Filled', Draft: 'Draft', 'On Hold': 'On Hold', Canceled: 'Canceled' })
      }

      if (sortBy) {
        query.sortBy = this.#resolveChoice(sortBy, { 'Applicant Count': 'count', Title: 'title', 'Hiring Lead': 'lead', 'Created Date': 'created', Status: 'status' })
      }

      if (sortOrder) {
        query.sortOrder = this.#resolveChoice(sortOrder, { Ascending: 'ASC', Descending: 'DESC' })
      }

      const response = await this.#apiRequest({
        logTag: 'getJobSummaries',
        url: `${ this.#getApiBaseUrl() }/applicant_tracking/jobs`,
        query,
      })

      logger.debug(
        `[getJobSummaries] Retrieved ${ Array.isArray(response) ? response.length : 0 } job summaries`
      )

      return response
    } catch (error) {
      logger.error(`[getJobSummaries] Error: ${ error.message }`)

      throw new Error(`Failed to retrieve job summaries: ${ error.message }`)
    }
  }

  /**
   * @typedef {Object} CreateCandidateResponse
   * @property {String} result - The result status of the operation.
   * @property {Number} candidateId - The newly created candidate's application ID.
   */

  /**
   * @operationName Create Candidate Application
   * @category Recruiting
   * @description Creates a new candidate application for a job opening. At minimum requires the applicant's first name, last name, and a job opening ID.
   * @route POST /createCandidate
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"First Name","name":"firstName","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The candidate's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The candidate's last name."}
   * @paramDef {"type":"Number","label":"Job ID","name":"jobId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The job opening ID to apply the candidate to."}
   * @paramDef {"type":"String","label":"Email","name":"email","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The candidate's email address."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumber","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The candidate's phone number."}
   * @paramDef {"type":"String","label":"Source","name":"source","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Where the candidate was sourced from (e.g., LinkedIn, Indeed)."}
   * @paramDef {"type":"String","label":"Address","name":"address","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The candidate's street address."}
   * @paramDef {"type":"String","label":"City","name":"city","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The candidate's city."}
   * @paramDef {"type":"String","label":"State","name":"state","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The candidate's state or province."}
   * @paramDef {"type":"String","label":"ZIP Code","name":"zip","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The candidate's ZIP or postal code."}
   * @paramDef {"type":"String","label":"Country","name":"country","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The candidate's country."}
   * @paramDef {"type":"String","label":"LinkedIn URL","name":"linkedinUrl","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The candidate's LinkedIn profile URL."}
   * @paramDef {"type":"String","label":"Website URL","name":"websiteUrl","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The candidate's personal or portfolio website URL."}
   * @paramDef {"type":"String","label":"Desired Salary","name":"desiredSalary","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The candidate's desired salary amount."}
   * @paramDef {"type":"String","label":"Referred By","name":"referredBy","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Name of the person who referred the candidate."}
   *
   * @returns {CreateCandidateResponse}
   * @sampleResult {"result":"success","candidateId":456}
   */
  async createCandidate(
    firstName,
    lastName,
    jobId,
    email,
    phoneNumber,
    source,
    address,
    city,
    state,
    zip,
    country,
    linkedinUrl,
    websiteUrl,
    desiredSalary,
    referredBy
  ) {
    try {
      if (!firstName) {
        throw new Error('First name is required')
      }

      if (!lastName) {
        throw new Error('Last name is required')
      }

      if (!jobId) {
        throw new Error('Job ID is required')
      }

      logger.debug(
        `[createCandidate] Creating candidate: ${ firstName } ${ lastName } for job ${ jobId }`
      )

      const body = {
        firstName,
        lastName,
        jobId,
      }

      if (email) body.email = email
      if (phoneNumber) body.phoneNumber = phoneNumber
      if (source) body.source = source
      if (address) body.address = address
      if (city) body.city = city
      if (state) body.state = state
      if (zip) body.zip = zip
      if (country) body.country = country
      if (linkedinUrl) body.linkedinUrl = linkedinUrl
      if (websiteUrl) body.websiteUrl = websiteUrl
      if (desiredSalary) body.desiredSalary = desiredSalary
      if (referredBy) body.referredBy = referredBy

      const response = await this.#apiRequest({
        logTag: 'createCandidate',
        url: `${ this.#getApiBaseUrl() }/applicant_tracking/application`,
        method: 'post',
        body,
      })

      logger.debug('[createCandidate] Candidate created successfully')

      return response
    } catch (error) {
      logger.error(`[createCandidate] Error: ${ error.message }`)

      throw new Error(
        `Failed to create candidate application: ${ error.message }`
      )
    }
  }

  /**
   * @typedef {Object} ApplicantStatusEntry
   * @property {String} id - The status ID.
   * @property {String} code - The status code (e.g., NEW, ACTIVE).
   * @property {String} name - The status name.
   * @property {String} translatedName - The translated status name.
   * @property {String} description - The status description.
   * @property {Boolean} enabled - Whether the status is currently enabled.
   * @property {Boolean} manageable - Whether the status can be managed by administrators.
   */

  /**
   * @operationName Get Applicant Statuses
   * @category Recruiting
   * @description Returns all applicant statuses configured for the company, including both system-defined and custom statuses with their enabled or disabled state.
   * @route POST /getApplicantStatuses
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @returns {Array<ApplicantStatusEntry>}
   * @sampleResult [{"id":"1","code":"NEW","name":"New","translatedName":"New","description":null,"enabled":true,"manageable":false}]
   */
  async getApplicantStatuses() {
    try {
      logger.debug('[getApplicantStatuses] Fetching applicant statuses')

      const response = await this.#apiRequest({
        logTag: 'getApplicantStatuses',
        url: `${ this.#getApiBaseUrl() }/applicant_tracking/statuses`,
      })

      logger.debug('[getApplicantStatuses] Retrieved applicant statuses')

      return response
    } catch (error) {
      logger.error(`[getApplicantStatuses] Error: ${ error.message }`)

      throw new Error(
        `Failed to retrieve applicant statuses: ${ error.message }`
      )
    }
  }

  /**
   * @typedef {Object} UpdateApplicantStatusResponse
   * @property {String} type - The resource type.
   * @property {String} id - The status ID that was applied.
   */

  /**
   * @operationName Update Applicant Status
   * @category Recruiting
   * @description Updates the status of a job application. Use the Get Applicant Statuses action to find valid status IDs.
   * @route POST /updateApplicantStatus
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Application ID","name":"applicationId","required":true,"description":"The unique ID of the job application to update.","dictionary":"getJobApplicationsDictionary"}
   * @paramDef {"type":"Number","label":"Status ID","name":"statusId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The new status ID to assign. Use Get Applicant Statuses to find valid IDs."}
   *
   * @returns {UpdateApplicantStatusResponse}
   * @sampleResult {"type":"positionApplicantStatus","id":"1"}
   */
  async updateApplicantStatus(applicationId, statusId) {
    try {
      if (!applicationId) {
        throw new Error('Application ID is required')
      }

      if (!statusId) {
        throw new Error('Status ID is required')
      }

      logger.debug(
        `[updateApplicantStatus] Updating application ${ applicationId } to status ${ statusId }`
      )

      // docs: https://documentation.bamboohr.com/reference/update-applicant-status
      // Body field is `status` (integer = the status ID), per the documented body params.
      const response = await this.#apiRequest({
        logTag: 'updateApplicantStatus',
        url: `${ this.#getApiBaseUrl() }/applicant_tracking/applications/${ applicationId }/status`,
        method: 'post',
        body: { status: statusId },
      })

      logger.debug(
        `[updateApplicantStatus] Status updated successfully for application ${ applicationId }`
      )

      return response
    } catch (error) {
      logger.error(`[updateApplicantStatus] Error: ${ error.message }`)

      throw new Error(`Failed to update applicant status: ${ error.message }`)
    }
  }

  /**
   * @typedef {Object} CreateApplicationCommentResponse
   * @property {String} type - The resource type (comment).
   * @property {String} id - The newly created comment ID.
   */

  /**
   * @operationName Create Job Application Comment
   * @category Recruiting
   * @description Adds a comment to a job application. Comments are visible in the application's activity feed within BambooHR.
   * @route POST /createJobApplicationComment
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Application ID","name":"applicationId","required":true,"description":"The unique ID of the job application to comment on.","dictionary":"getJobApplicationsDictionary"}
   * @paramDef {"type":"String","label":"Comment","name":"comment","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The comment text to add to the application."}
   *
   * @returns {CreateApplicationCommentResponse}
   * @sampleResult {"type":"comment","id":"100"}
   */
  async createJobApplicationComment(applicationId, comment) {
    try {
      if (!applicationId) {
        throw new Error('Application ID is required')
      }

      if (!comment) {
        throw new Error('Comment is required')
      }

      logger.debug(
        `[createJobApplicationComment] Adding comment to application ${ applicationId }`
      )

      const response = await this.#apiRequest({
        logTag: 'createJobApplicationComment',
        url: `${ this.#getApiBaseUrl() }/applicant_tracking/applications/${ applicationId }/comments`,
        method: 'post',
        body: { type: 'comment', comment },
      })

      logger.debug(
        `[createJobApplicationComment] Comment added successfully to application ${ applicationId }`
      )

      return response
    } catch (error) {
      logger.error(`[createJobApplicationComment] Error: ${ error.message }`)

      throw new Error(`Failed to add comment to application: ${ error.message }`)
    }
  }

  // ========================================== TRAINING METHODS ==========================================

  /**
   * @typedef {Object} TrainingTypeCategory
   * @property {Number} id - The category ID.
   * @property {String} name - The category name.
   */

  /**
   * @typedef {Object} TrainingTypeEntry
   * @property {String} name - The training type name.
   * @property {String} renewable - Whether the training is renewable (yes or no).
   * @property {Number} frequency - Renewal frequency in months.
   * @property {String} required - Whether the training is required (yes or no).
   * @property {TrainingTypeCategory} category - The training category.
   * @property {String} description - Description of the training type.
   */

  /**
   * @operationName List Training Types
   * @category Training
   * @description Returns all training types configured for the company, including renewal settings, required status, category, and self-completion permissions.
   * @route POST /listTrainingTypes
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @returns {Object}
   * @sampleResult {"1":{"name":"Safety Training","renewable":"yes","frequency":12,"required":"yes","category":{"id":1,"name":"Compliance"},"description":"Annual safety training"}}
   */
  async listTrainingTypes() {
    try {
      logger.debug('[listTrainingTypes] Fetching training types')

      const response = await this.#apiRequest({
        logTag: 'listTrainingTypes',
        url: `${ this.#getApiBaseUrl() }/training/type`,
      })

      logger.debug('[listTrainingTypes] Training types retrieved successfully')

      return response
    } catch (error) {
      logger.error(`[listTrainingTypes] Error: ${ error.message }`)

      throw new Error(`Failed to retrieve training types: ${ error.message }`)
    }
  }

  /**
   * @typedef {Object} TrainingRecordType
   * @property {Number} id - The training type ID.
   * @property {String} name - The training type name.
   */

  /**
   * @typedef {Object} EmployeeTrainingRecord
   * @property {Number} id - The unique training record ID.
   * @property {Number} employeeId - The employee ID the record belongs to.
   * @property {String} completed - The completion date (YYYY-MM-DD).
   * @property {TrainingRecordType} type - The training type details.
   * @property {String} instructor - The instructor name.
   * @property {Number} hours - Number of training hours.
   * @property {Number} credits - Number of training credits earned.
   * @property {Number} cost - The cost of the training.
   * @property {String} notes - Additional notes about the training record.
   */

  /**
   * @operationName List Employee Training Records
   * @category Training
   * @description Returns all training records for a specific employee, including completion date, training type, instructor, hours, and credits.
   * @route POST /listEmployeeTrainingRecords
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","required":true,"description":"The unique BambooHR employee ID.","dictionary":"getEmployeeDirectoryDictionary"}
   *
   * @returns {Array<EmployeeTrainingRecord>}
   * @sampleResult [{"id":1,"employeeId":123,"completed":"2024-01-15","type":{"id":1,"name":"Safety Training"},"instructor":"John Trainer","hours":4,"credits":1,"cost":0,"notes":"Completed successfully"}]
   */
  async listEmployeeTrainingRecords(employeeId) {
    try {
      if (!employeeId) {
        throw new Error('Employee ID is required')
      }

      logger.debug(
        `[listEmployeeTrainingRecords] Fetching training records for employee ${ employeeId }`
      )

      const response = await this.#apiRequest({
        logTag: 'listEmployeeTrainingRecords',
        url: `${ this.#getApiBaseUrl() }/training/record/employee/${ employeeId }`,
      })

      logger.debug(
        `[listEmployeeTrainingRecords] Training records retrieved for employee ${ employeeId }`
      )

      return response
    } catch (error) {
      logger.error(`[listEmployeeTrainingRecords] Error: ${ error.message }`)

      throw new Error(`Failed to retrieve training records: ${ error.message }`)
    }
  }

  /**
   * @typedef {Object} CreateTrainingRecordResponse
   * @property {Number} id - The newly created training record ID.
   * @property {String} completed - The completion date (YYYY-MM-DD).
   * @property {TrainingRecordType} type - The training type details.
   * @property {String} instructor - The instructor name.
   * @property {Number} hours - Number of training hours.
   */

  /**
   * @operationName Create Employee Training Record
   * @category Training
   * @description Creates a new training record for an employee. Requires a valid training type ID and completion date at minimum.
   * @route POST /createEmployeeTrainingRecord
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","required":true,"description":"The unique BambooHR employee ID.","dictionary":"getEmployeeDirectoryDictionary"}
   * @paramDef {"type":"Number","label":"Training Type ID","name":"trainingTypeId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The ID of an existing training type. Use List Training Types to find valid IDs."}
   * @paramDef {"type":"String","label":"Completed Date","name":"completedDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"The date the training was completed in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"Instructor","name":"instructor","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The name of the training instructor."}
   * @paramDef {"type":"Number","label":"Hours","name":"hours","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of hours spent on the training."}
   * @paramDef {"type":"Number","label":"Credits","name":"credits","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of credits earned for the training."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Additional notes about the training record."}
   *
   * @returns {CreateTrainingRecordResponse}
   * @sampleResult {"id":5,"completed":"2024-03-15","type":{"id":1,"name":"Safety Training"},"instructor":"Jane Trainer","hours":4}
   */
  async createEmployeeTrainingRecord(
    employeeId,
    trainingTypeId,
    completedDate,
    instructor,
    hours,
    credits,
    notes
  ) {
    try {
      if (!employeeId) {
        throw new Error('Employee ID is required')
      }

      if (!trainingTypeId) {
        throw new Error('Training Type ID is required')
      }

      if (!completedDate) {
        throw new Error('Completed Date is required')
      }

      logger.debug(
        `[createEmployeeTrainingRecord] Creating training record for employee ${ employeeId }`
      )

      const body = {
        type: trainingTypeId,
        completed: completedDate,
      }

      if (instructor) body.instructor = instructor
      if (hours !== undefined && hours !== null) body.hours = hours
      if (credits !== undefined && credits !== null) body.credits = credits
      if (notes) body.notes = notes

      const response = await this.#apiRequest({
        logTag: 'createEmployeeTrainingRecord',
        url: `${ this.#getApiBaseUrl() }/training/record/employee/${ employeeId }`,
        method: 'post',
        body,
      })

      logger.debug(
        `[createEmployeeTrainingRecord] Training record created for employee ${ employeeId }`
      )

      return response
    } catch (error) {
      logger.error(`[createEmployeeTrainingRecord] Error: ${ error.message }`)

      throw new Error(`Failed to create training record: ${ error.message }`)
    }
  }

  // ========================================== REPORTS METHODS ==========================================

  /**
   * @typedef {Object} CustomReportField
   * @property {String} id - The field identifier.
   * @property {String} type - The field data type (e.g., text, date).
   * @property {String} name - The field display name.
   */

  /**
   * @typedef {Object} CustomReportResponse
   * @property {String} title - The report title.
   * @property {Array<CustomReportField>} fields - The fields included in the report.
   * @property {Array<Object>} employees - The employee data rows matching the report fields.
   */

  /**
   * @operationName Request Custom Report
   * @category Reports
   * @description Generates an ad-hoc employee report with specified fields. Returns data for all employees (active and inactive). Use the List Fields action to discover available field names.
   * @route POST /requestCustomReport
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Report Title","name":"title","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"A descriptive title for the report."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Comma-separated list of field names to include (e.g., firstName,lastName,department,hireDate). Use List Fields to discover available field names."}
   * @paramDef {"type":"String","label":"Filter Last Changed","name":"filterLastChanged","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"ISO date string to filter employees changed after this date (e.g., 2024-01-01T00:00:00Z)."}
   *
   * @returns {CustomReportResponse}
   * @sampleResult {"title":"Employee Report","fields":[{"id":"firstName","type":"text","name":"First Name"},{"id":"lastName","type":"text","name":"Last Name"}],"employees":[{"id":"123","firstName":"Jane","lastName":"Smith"}]}
   */
  async requestCustomReport(title, fields, filterLastChanged) {
    try {
      if (!title) {
        throw new Error('Report title is required')
      }

      if (!fields) {
        throw new Error('Fields are required')
      }

      logger.debug(`[requestCustomReport] Generating custom report: ${ title }`)

      const fieldList = fields
        .split(',')
        .map(f => f.trim())
        .filter(Boolean)

      const body = {
        title,
        fields: fieldList,
      }

      if (filterLastChanged) {
        body.filters = {
          lastChanged: {
            includeNull: 'no',
            value: filterLastChanged,
          },
        }
      }

      const response = await this.#apiRequest({
        logTag: 'requestCustomReport',
        url: `${ this.#getApiBaseUrl() }/reports/custom`,
        method: 'post',
        query: { format: 'JSON' },
        body,
      })

      logger.debug(
        `[requestCustomReport] Report generated with ${ response.employees?.length || 0 } employees`
      )

      return response
    } catch (error) {
      logger.error(`[requestCustomReport] Error: ${ error.message }`)

      throw new Error(`Failed to generate custom report: ${ error.message }`)
    }
  }

  // ========================================== METADATA METHODS ==========================================

  /**
   * @typedef {Object} FieldMetadata
   * @property {Number} id - The field ID.
   * @property {String} name - The field display name.
   * @property {String} type - The field data type (e.g., text, date, list).
   * @property {String} alias - The field alias used in API requests.
   */

  /**
   * @operationName List Fields
   * @category Metadata
   * @description Returns all available employee fields in the account, including field ID, display name, data type, and alias. Use this to discover valid field names for other endpoints like Request Custom Report.
   * @route POST /listFields
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @returns {Array<FieldMetadata>}
   * @sampleResult [{"id":4,"name":"First Name","type":"text","alias":"firstName"},{"id":5,"name":"Last Name","type":"text","alias":"lastName"},{"id":17,"name":"Job Title","type":"text","alias":"jobTitle"}]
   */
  async listFields() {
    try {
      logger.debug('[listFields] Fetching available employee fields')

      const response = await this.#apiRequest({
        logTag: 'listFields',
        url: `${ this.#getApiBaseUrl() }/meta/fields`,
      })

      logger.debug(
        `[listFields] Retrieved ${ Array.isArray(response) ? response.length : 0 } fields`
      )

      return response
    } catch (error) {
      logger.error(`[listFields] Error: ${ error.message }`)

      throw new Error(`Failed to retrieve field metadata: ${ error.message }`)
    }
  }

  /**
   * @typedef {Object} UserEntry
   * @property {String} id - The user ID.
   * @property {String} employeeId - The associated employee ID.
   * @property {String} firstName - The user's first name.
   * @property {String} lastName - The user's last name.
   * @property {String} email - The user's email address.
   * @property {String} status - The user's status (enabled or disabled).
   * @property {String} lastLogin - The user's last login timestamp in ISO format.
   */

  /**
   * @operationName List Users
   * @category Metadata
   * @description Returns all users for the company including user ID, associated employee ID, name, email, status, and last login time. Optionally filter by user status.
   * @route POST /listUsers
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Enabled","Disabled"]}},"description":"Filter users by status. Returns all users if not specified."}
   *
   * @returns {Object}
   * @sampleResult {"1":{"id":"1","employeeId":"123","firstName":"Jane","lastName":"Smith","email":"jane@example.com","status":"enabled","lastLogin":"2024-03-15T10:30:00+00:00"}}
   */
  async listUsers(status) {
    try {
      logger.debug('[listUsers] Fetching users')

      const query = {}

      if (status) {
        query.status = this.#resolveChoice(status, { Enabled: 'enabled', Disabled: 'disabled' })
      }

      const response = await this.#apiRequest({
        logTag: 'listUsers',
        url: `${ this.#getApiBaseUrl() }/meta/users/`,
        query,
      })

      logger.debug('[listUsers] Users retrieved successfully')

      return response
    } catch (error) {
      logger.error(`[listUsers] Error: ${ error.message }`)

      throw new Error(`Failed to retrieve users: ${ error.message }`)
    }
  }

  // ========================================== GOALS METHODS ==========================================

  /**
   * @typedef {Object} GoalEntry
   * @property {Number} id - The goal ID.
   * @property {String} title - The goal title.
   * @property {String} description - The goal description.
   * @property {Number} percentComplete - The goal completion percentage (0-100).
   * @property {String} dueDate - The goal due date (YYYY-MM-DD).
   * @property {String} status - The goal status (e.g., in_progress, completed, closed).
   * @property {Array<Number>} sharedWithEmployeeIds - Employee IDs the goal is shared with.
   */

  /**
   * @typedef {Object} GoalsResponse
   * @property {Array<GoalEntry>} goals - List of employee goals.
   */

  /**
   * @operationName List Goals
   * @category Goals
   * @description Returns goals assigned to an employee. Optionally filter by goal status (in progress, completed, or closed). Results are capped at 50 goals.
   * @route POST /listGoals
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","required":true,"description":"The unique BambooHR employee ID.","dictionary":"getEmployeeDirectoryDictionary"}
   * @paramDef {"type":"String","label":"Filter","name":"filter","uiComponent":{"type":"DROPDOWN","options":{"values":["In Progress","Completed","Closed"]}},"description":"Filter goals by status. Returns all goals if not specified."}
   *
   * @returns {GoalsResponse}
   * @sampleResult {"goals":[{"id":1,"title":"Complete Q1 deliverables","description":"Deliver all planned features","percentComplete":75,"dueDate":"2024-03-31","status":"in_progress","sharedWithEmployeeIds":[123,456]}]}
   */
  async listGoals(employeeId, filter) {
    try {
      if (!employeeId) {
        throw new Error('Employee ID is required')
      }

      logger.debug(`[listGoals] Fetching goals for employee ${ employeeId }`)

      const query = {}

      if (filter) {
        query.filter = this.#resolveChoice(filter, { 'In Progress': 'status-inProgress', Completed: 'status-completed', Closed: 'status-closed' })
      }

      const response = await this.#apiRequest({
        logTag: 'listGoals',
        url: `${ this.#getApiBaseUrl() }/performance/employees/${ employeeId }/goals`,
        query,
      })

      logger.debug(
        `[listGoals] Retrieved ${ response.goals?.length || 0 } goals for employee ${ employeeId }`
      )

      return response
    } catch (error) {
      logger.error(`[listGoals] Error: ${ error.message }`)

      throw new Error(`Failed to retrieve goals: ${ error.message }`)
    }
  }

  /**
   * @typedef {Object} CreateGoalResponse
   * @property {Number} id - The newly created goal ID.
   * @property {String} title - The goal title.
   * @property {String} description - The goal description.
   * @property {Number} percentComplete - The goal completion percentage.
   * @property {String} dueDate - The goal due date (YYYY-MM-DD).
   * @property {String} status - The goal status.
   */

  /**
   * @operationName Create Goal
   * @category Goals
   * @description Creates a new goal for an employee. The goal owner's employee ID is automatically included in the sharing list if no shared employee IDs are specified.
   * @route POST /createGoal
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","required":true,"description":"The unique BambooHR employee ID who will own the goal.","dictionary":"getEmployeeDirectoryDictionary"}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The goal title."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"The goal due date in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A detailed description of the goal."}
   * @paramDef {"type":"Number","label":"Percent Complete","name":"percentComplete","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Initial completion percentage (0-100). Defaults to 0."}
   * @paramDef {"type":"String","label":"Shared With Employee IDs","name":"sharedWithEmployeeIds","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Comma-separated employee IDs to share the goal with. If not provided, the goal is shared with the owner only."}
   *
   * @returns {CreateGoalResponse}
   * @sampleResult {"id":5,"title":"Complete Q2 OKRs","description":"Deliver all Q2 objectives","percentComplete":0,"dueDate":"2024-06-30","status":"in_progress"}
   */
  async createGoal(
    employeeId,
    title,
    dueDate,
    description,
    percentComplete,
    sharedWithEmployeeIds
  ) {
    try {
      if (!employeeId) {
        throw new Error('Employee ID is required')
      }

      if (!title) {
        throw new Error('Title is required')
      }

      if (!dueDate) {
        throw new Error('Due Date is required')
      }

      logger.debug(
        `[createGoal] Creating goal "${ title }" for employee ${ employeeId }`
      )

      const body = {
        title,
        dueDate,
      }

      if (description) body.description = description
      if (percentComplete !== undefined && percentComplete !== null)
        body.percentComplete = percentComplete

      if (sharedWithEmployeeIds) {
        body.sharedWithEmployeeIds = sharedWithEmployeeIds
          .split(',')
          .map(id => Number(id.trim()))
          .filter(id => !isNaN(id))
      } else {
        body.sharedWithEmployeeIds = [Number(employeeId)]
      }

      const response = await this.#apiRequest({
        logTag: 'createGoal',
        url: `${ this.#getApiBaseUrl() }/performance/employees/${ employeeId }/goals`,
        method: 'post',
        body,
      })

      logger.debug(
        `[createGoal] Goal created successfully for employee ${ employeeId }`
      )

      return response
    } catch (error) {
      logger.error(`[createGoal] Error: ${ error.message }`)

      throw new Error(`Failed to create goal: ${ error.message }`)
    }
  }

  /**
   * @typedef {Object} UpdateGoalProgressResponse
   * @property {Number} id - The goal ID that was updated.
   * @property {Number} percentComplete - The new completion percentage.
   * @property {String} status - The resulting goal status.
   * @property {String} completionDate - The completion date when the goal is fully complete.
   */

  /**
   * @operationName Update Goal Progress
   * @category Goals
   * @description Updates the completion percentage of an employee's goal. When progress reaches 100%, a completion date is required and the goal is marked complete.
   * @route POST /updateGoalProgress
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","required":true,"description":"The unique BambooHR employee ID who owns the goal.","dictionary":"getEmployeeDirectoryDictionary"}
   * @paramDef {"type":"String","label":"Goal ID","name":"goalId","required":true,"description":"The unique ID of the goal to update.","dictionary":"getGoalsDictionary","dependsOn":["employeeId"]}
   * @paramDef {"type":"Number","label":"Percent Complete","name":"percentComplete","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The new completion percentage (0-100)."}
   * @paramDef {"type":"String","label":"Completion Date","name":"completionDate","uiComponent":{"type":"DATE_PICKER"},"description":"The date the goal was completed (YYYY-MM-DD). Required when Percent Complete is 100."}
   *
   * @returns {UpdateGoalProgressResponse}
   * @sampleResult {"id":1,"percentComplete":100,"status":"completed","completionDate":"2024-03-31"}
   */
  async updateGoalProgress(employeeId, goalId, percentComplete, completionDate) {
    try {
      if (!employeeId) {
        throw new Error('Employee ID is required')
      }

      if (!goalId) {
        throw new Error('Goal ID is required')
      }

      if (percentComplete === undefined || percentComplete === null) {
        throw new Error('Percent Complete is required')
      }

      if (Number(percentComplete) === 100 && !completionDate) {
        throw new Error(
          'Completion Date is required when Percent Complete is 100'
        )
      }

      logger.debug(
        `[updateGoalProgress] Updating goal ${ goalId } for employee ${ employeeId } to ${ percentComplete }%`
      )

      // docs: https://documentation.bamboohr.com/reference/update-goal-progress
      // PUT .../goals/{id}/progress with { percentComplete, completionDate? }.
      const body = { percentComplete: Number(percentComplete) }

      if (completionDate) {
        body.completionDate = completionDate
      }

      const response = await this.#apiRequest({
        logTag: 'updateGoalProgress',
        url: `${ this.#getApiBaseUrl() }/performance/employees/${ employeeId }/goals/${ goalId }/progress`,
        method: 'put',
        body,
      })

      logger.debug(
        `[updateGoalProgress] Goal ${ goalId } progress updated for employee ${ employeeId }`
      )

      return response
    } catch (error) {
      logger.error(`[updateGoalProgress] Error: ${ error.message }`)

      throw new Error(`Failed to update goal progress: ${ error.message }`)
    }
  }

  /**
   * @typedef {Object} DeleteGoalResponse
   * @property {Boolean} success - Whether the deletion was successful.
   * @property {String} message - A descriptive result message.
   */

  /**
   * @operationName Delete Goal
   * @category Goals
   * @description Permanently deletes a goal for an employee. This action cannot be undone.
   * @route POST /deleteGoal
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","required":true,"description":"The unique BambooHR employee ID who owns the goal.","dictionary":"getEmployeeDirectoryDictionary"}
   * @paramDef {"type":"String","label":"Goal ID","name":"goalId","required":true,"description":"The unique ID of the goal to delete.","dictionary":"getGoalsDictionary","dependsOn":["employeeId"]}
   *
   * @returns {DeleteGoalResponse}
   * @sampleResult {"success":true,"message":"Goal deleted successfully"}
   */
  async deleteGoal(employeeId, goalId) {
    try {
      if (!employeeId) {
        throw new Error('Employee ID is required')
      }

      if (!goalId) {
        throw new Error('Goal ID is required')
      }

      logger.debug(
        `[deleteGoal] Deleting goal ${ goalId } for employee ${ employeeId }`
      )

      await this.#apiRequest({
        logTag: 'deleteGoal',
        url: `${ this.#getApiBaseUrl() }/performance/employees/${ employeeId }/goals/${ goalId }`,
        method: 'delete',
      })

      logger.debug(
        `[deleteGoal] Goal ${ goalId } deleted successfully for employee ${ employeeId }`
      )

      return { success: true, message: 'Goal deleted successfully' }
    } catch (error) {
      logger.error(`[deleteGoal] Error: ${ error.message }`)

      throw new Error(`Failed to delete goal: ${ error.message }`)
    }
  }

  // ========================================== COMPANY FILES ==========================================

  /**
   * @typedef {Object} CompanyFileEntry
   * @property {Number} id - The unique file ID.
   * @property {String} name - The display name of the file.
   * @property {String} originalFileName - The original file name.
   * @property {String} size - The file size in bytes (returned by the API as a string).
   * @property {String} dateCreated - ISO timestamp of when the file was created.
   * @property {String} createdBy - Name of the user who uploaded the file.
   * @property {String} shareWithEmployees - Whether the file is shared with employees ("yes" or "no").
   * @property {String} canRenameFile - Whether the caller can rename the file ("yes" or "no").
   * @property {String} canDeleteFile - Whether the caller can delete the file ("yes" or "no").
   */

  /**
   * @typedef {Object} CompanyFileCategory
   * @property {Number} id - The unique category ID.
   * @property {String} name - The category name.
   * @property {String} canUploadFiles - Whether the caller can upload into this category ("yes" or "no").
   * @property {Array<CompanyFileEntry>} files - List of files in the category.
   */

  /**
   * @typedef {Object} ListCompanyFilesResponse
   * @property {Array<CompanyFileCategory>} categories - List of company file categories with their files.
   */

  /**
   * @operationName List Company Files
   * @category Company Files
   * @description Lists all company file categories and the files within each that are visible to the caller.
   * @route POST /listCompanyFiles
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @returns {ListCompanyFilesResponse}
   * @sampleResult {"categories":[{"id":20,"name":"New Employee Docs","canUploadFiles":"yes","files":[{"id":387,"name":"Direct Deposit Form","originalFileName":"Direct Deposit Form.rtf","size":"57028","dateCreated":"2025-02-11T22:30:07+0000","createdBy":"John Doe","shareWithEmployees":"no","canRenameFile":"yes","canDeleteFile":"yes"}]}]}
   */
  async listCompanyFiles() {
    try {
      logger.debug('[listCompanyFiles] Listing company files')

      const response = await this.#apiRequest({
        logTag: 'listCompanyFiles',
        url: `${ this.#getApiBaseUrl() }/files/view`,
      })

      logger.debug(
        `[listCompanyFiles] Retrieved ${ response.categories?.length || 0 } categories`
      )

      return response
    } catch (error) {
      logger.error(`[listCompanyFiles] Error: ${ error.message }`)

      throw new Error(`Failed to list company files: ${ error.message }`)
    }
  }

  /**
   * @typedef {Object} UploadCompanyFileResponse
   * @property {Boolean} success - Whether the file was uploaded successfully.
   * @property {String} fileId - The unique ID of the newly uploaded file, or null if it could not be recovered.
   * @property {String} message - Status message describing the result.
   */

  /**
   * @operationName Upload Company File
   * @category Company Files
   * @description Uploads a file into a company file category. The file must be under 20MB. Use List Company Files to find available category IDs.
   * @route POST /uploadCompanyFile
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"File Name","name":"fileName","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Display name for the uploaded file."}
   * @paramDef {"type":"String","label":"Category","name":"categoryId","required":true,"description":"The company file category (section) to upload into.","dictionary":"getCompanyFileCategoriesDictionary"}
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"URL of the file to upload from FlowRunner file storage."}
   * @paramDef {"type":"String","label":"Share with Employees","name":"share","uiComponent":{"type":"DROPDOWN","options":{"values":[{"value":"no","label":"No"},{"value":"yes","label":"Yes"}]}},"description":"Whether to share the file with all employees. Defaults to No."}
   *
   * @returns {UploadCompanyFileResponse}
   * @sampleResult {"success":true,"fileId":"387","message":"Company file uploaded successfully"}
   */
  async uploadCompanyFile(fileName, categoryId, fileUrl, share) {
    try {
      if (!fileName) {
        throw new Error('File name is required')
      }

      if (!categoryId) {
        throw new Error('Category ID is required')
      }

      if (!fileUrl) {
        throw new Error('File URL is required')
      }

      logger.debug(
        `[uploadCompanyFile] Uploading file "${ fileName }" into category ${ categoryId }`
      )

      const fileData = await Flowrunner.Request.get(fileUrl).setEncoding(null)

      // Use the platform-native Flowrunner.Request.FormData: .form() drives its
      // getHeaders()/getLength(). The file part is a Buffer with a filename; do NOT set
      // Content-Type manually - getHeaders() supplies the multipart boundary.
      const formData = new Flowrunner.Request.FormData()
      formData.append('file', fileData, { filename: fileName })
      formData.append('fileName', fileName)
      formData.append('category', String(categoryId))

      if (share === 'yes') {
        formData.append('share', 'yes')
      }

      // BambooHR replies 201 with an empty body; the new file's id is only in the Location
      // header, so read the full response to recover it.
      const created = await Flowrunner.Request.post(`${ this.#getApiBaseUrl() }/files`)
        .set(this.#getAccessTokenHeader())
        .unwrapBody(false)
        .form(formData)

      const headers = lowerKeys(created?.headers || {})
      const locationHeader = headers['location'] || ''
      const fileId = locationHeader
        ? locationHeader.split('/').filter(Boolean).pop()
        : null

      logger.debug(
        `[uploadCompanyFile] File "${ fileName }" uploaded successfully (id ${ fileId })`
      )

      return {
        success: true,
        fileId,
        message: 'Company file uploaded successfully',
      }
    } catch (error) {
      logger.error(`[uploadCompanyFile] Error: ${ error.message }`)

      throw new Error(`Failed to upload company file "${ fileName }": ${ error.message }`)
    }
  }

  /**
   * @typedef {Object} DownloadCompanyFileResponse
   * @property {String} fileName - The original name of the downloaded file.
   * @property {String} contentType - The MIME type of the file.
   * @property {Number} sizeBytes - The size of the file in bytes.
   * @property {String} fileUrl - The FlowRunner Files URL where the downloaded file was saved.
   */

  /**
   * @operationName Download Company File
   * @category Company Files
   * @description Downloads a company file's contents, saves them to FlowRunner file storage, and returns the saved file's URL along with its name, content type, and size.
   * @route POST /downloadCompanyFile
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"File ID","name":"fileId","required":true,"description":"The unique ID of the company file to download.","dictionary":"getCompanyFilesDictionary"}
   *
   * @returns {DownloadCompanyFileResponse}
   * @sampleResult {"fileName":"Direct Deposit Form.rtf","contentType":"application/rtf","sizeBytes":57028,"fileUrl":"https://files.flowrunner.io/bamboohr-downloads/Direct%20Deposit%20Form.rtf"}
   */
  async downloadCompanyFile(fileId) {
    try {
      if (!fileId) {
        throw new Error('File ID is required')
      }

      logger.debug(`[downloadCompanyFile] Downloading file ${ fileId }`)

      const response = await Flowrunner.Request.get(
        `${ this.#getApiBaseUrl() }/files/${ fileId }`
      )
        .set(this.#getAccessTokenHeader())
        .setEncoding(null)
        .unwrapBody(false)

      const headers = lowerKeys(response.headers)
      const fileName =
        this.#parseFileNameFromContentDisposition(headers['content-disposition']) ||
        `bamboohr-file-${ fileId }`
      const contentType = headers['content-type'] || 'application/octet-stream'
      const buffer = response.body

      if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new Error('The file download returned no content')
      }

      const { url } = await this.flowrunner.Files.uploadFile(buffer, {
        filename: fileName,
        generateUrl: true,
        overwrite: true,
        scope: 'FLOW',
      })

      logger.debug(`[downloadCompanyFile] File ${ fileId } downloaded and saved as "${ fileName }"`)

      return {
        fileName,
        contentType,
        sizeBytes: buffer.length,
        fileUrl: url,
      }
    } catch (error) {
      logger.error(`[downloadCompanyFile] Error: ${ error.message }`)

      throw new Error(`Failed to download company file ${ fileId }: ${ error.message }`)
    }
  }

  /**
   * @typedef {Object} UpdateCompanyFileResponse
   * @property {Boolean} success - Whether the file was updated successfully.
   * @property {String} message - Status message describing the result.
   */

  /**
   * @operationName Update Company File
   * @category Company Files
   * @description Updates a company file's name, category, or sharing setting. Only the fields provided are changed.
   * @route POST /updateCompanyFile
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"File ID","name":"fileId","required":true,"description":"The unique ID of the company file to update.","dictionary":"getCompanyFilesDictionary"}
   * @paramDef {"type":"String","label":"New Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New display name for the file. Leave blank to keep the current name."}
   * @paramDef {"type":"String","label":"Category","name":"categoryId","description":"Move the file to this category. Leave blank to keep the current category.","dictionary":"getCompanyFileCategoriesDictionary"}
   * @paramDef {"type":"String","label":"Share with Employees","name":"shareWithEmployee","uiComponent":{"type":"DROPDOWN","options":{"values":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]}},"description":"Whether the file is shared with all employees. Leave blank to keep the current setting."}
   *
   * @returns {UpdateCompanyFileResponse}
   * @sampleResult {"success":true,"message":"Company file updated successfully"}
   */
  async updateCompanyFile(fileId, name, categoryId, shareWithEmployee) {
    try {
      if (!fileId) {
        throw new Error('File ID is required')
      }

      const body = {}

      if (name) body.name = name
      if (categoryId) body.categoryId = String(categoryId)
      if (shareWithEmployee) body.shareWithEmployee = shareWithEmployee

      if (Object.keys(body).length === 0) {
        throw new Error('At least one field is required to update')
      }

      logger.debug(`[updateCompanyFile] Updating file ${ fileId }`)

      await this.#apiRequest({
        logTag: 'updateCompanyFile',
        url: `${ this.#getApiBaseUrl() }/files/${ fileId }`,
        method: 'post',
        body,
      })

      logger.debug(`[updateCompanyFile] File ${ fileId } updated`)

      return { success: true, message: 'Company file updated successfully' }
    } catch (error) {
      logger.error(`[updateCompanyFile] Error: ${ error.message }`)

      throw new Error(`Failed to update company file ${ fileId }: ${ error.message }`)
    }
  }

  /**
   * @typedef {Object} DeleteCompanyFileResponse
   * @property {Boolean} success - Whether the file was deleted successfully.
   * @property {String} message - Status message describing the result.
   */

  /**
   * @operationName Delete Company File
   * @category Company Files
   * @description Permanently removes a company file. This action is permanent and cannot be undone. Requires the company's Files tool to be enabled.
   * @route POST /deleteCompanyFile
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"File ID","name":"fileId","required":true,"description":"The unique ID of the company file to delete. This action is permanent and cannot be undone.","dictionary":"getCompanyFilesDictionary"}
   *
   * @returns {DeleteCompanyFileResponse}
   * @sampleResult {"success":true,"message":"Company file deleted successfully"}
   */
  async deleteCompanyFile(fileId) {
    try {
      if (!fileId) {
        throw new Error('File ID is required')
      }

      logger.debug(`[deleteCompanyFile] Deleting file ${ fileId }`)

      await this.#apiRequest({
        logTag: 'deleteCompanyFile',
        url: `${ this.#getApiBaseUrl() }/files/${ fileId }`,
        method: 'delete',
      })

      logger.debug(`[deleteCompanyFile] File ${ fileId } deleted`)

      return { success: true, message: 'Company file deleted successfully' }
    } catch (error) {
      logger.error(`[deleteCompanyFile] Error: ${ error.message }`)

      throw new Error(`Failed to delete company file ${ fileId }: ${ error.message }`)
    }
  }

  /**
   * @operationName Create Company File Category
   * @category Company Files
   * @description Creates one or more company file categories. Each name must be non-empty and unique among existing company file categories. Requires admin permission.
   * @route POST /createCompanyFileCategory
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"Array<String>","label":"Category Names","name":"categoryNames","required":true,"description":"One or more names for the new company file categories. Each must be non-empty and unique. Accepts a list or a comma-separated string."}
   *
   * @returns {CreateFileCategoryResponse}
   * @sampleResult {"success":true,"message":"Company file category created successfully"}
   */
  async createCompanyFileCategory(categoryNames) {
    try {
      const names = this.#toList(categoryNames)

      if (!names) {
        throw new Error('At least one category name is required')
      }

      logger.debug(`[createCompanyFileCategory] Creating categories: ${ names.join(', ') }`)

      await this.#apiRequest({
        logTag: 'createCompanyFileCategory',
        url: `${ this.#getApiBaseUrl() }/files/categories`,
        method: 'post',
        body: names,
      })

      logger.debug('[createCompanyFileCategory] Categories created successfully')

      return { success: true, message: 'Company file category created successfully' }
    } catch (error) {
      logger.error(`[createCompanyFileCategory] Error: ${ error.message }`)

      throw new Error(`Failed to create company file category: ${ error.message }`)
    }
  }

  // ========================================== METADATA ==========================================

  /**
   * @typedef {Object} TableFieldEntry
   * @property {Number} id - The unique field ID.
   * @property {String} name - The display name of the field.
   * @property {String} alias - The API alias of the field.
   * @property {String} type - The field's data type (e.g., text, date, list).
   */

  /**
   * @typedef {Object} TableMetadataEntry
   * @property {String} alias - The API alias for the table (e.g., jobInfo, compensation).
   * @property {Array<TableFieldEntry>} fields - The fields contained in the table.
   */

  /**
   * @operationName List Tables Metadata
   * @category Metadata
   * @description Returns all tabular (table-based) fields available in the account, including each table's alias and the fields it contains. Use this to discover valid table names for the employee table row methods.
   * @route POST /listTablesMetadata
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @returns {Array<TableMetadataEntry>}
   * @sampleResult [{"alias":"jobInfo","fields":[{"id":1,"name":"Job Title","alias":"jobTitle","type":"text"},{"id":2,"name":"Department","alias":"department","type":"list"}]}]
   */
  async listTablesMetadata() {
    try {
      logger.debug('[listTablesMetadata] Fetching table metadata')

      const response = await this.#apiRequest({
        logTag: 'listTablesMetadata',
        url: `${ this.#getApiBaseUrl() }/meta/tables`,
      })

      logger.debug(
        `[listTablesMetadata] Retrieved ${ Array.isArray(response) ? response.length : 0 } tables`
      )

      return response
    } catch (error) {
      logger.error(`[listTablesMetadata] Error: ${ error.message }`)

      throw new Error(`Failed to list table metadata: ${ error.message }`)
    }
  }

  // ========================================== WEBHOOKS ==========================================

  /**
   * @typedef {Object} WebhookEntry
   * @property {String} id - The unique webhook ID.
   * @property {String} name - The webhook display name.
   * @property {String} created - The datetime the webhook was created.
   * @property {String} lastSent - The datetime the webhook last fired, or null if never fired.
   * @property {String} url - The HTTPS URL that receives webhook payloads.
   */

  /**
   * @typedef {Object} ListWebhooksResponse
   * @property {Array<WebhookEntry>} webhooks - List of webhooks owned by the authenticated API key.
   */

  /**
   * @operationName List Webhooks
   * @category Webhooks
   * @description Returns all webhooks owned by the authenticated API key. Each entry includes the webhook ID, name, URL, creation datetime, and last fired datetime.
   * @route POST /listWebhooks
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @returns {ListWebhooksResponse}
   * @sampleResult {"webhooks":[{"id":"1","name":"Employee Changes","created":"2024-01-15 10:30:00","lastSent":"2024-03-10 14:22:00","url":"https://example.com/webhook"}]}
   */
  async listWebhooks() {
    try {
      logger.debug('[listWebhooks] Fetching all webhooks')

      const response = await this.#apiRequest({
        logTag: 'listWebhooks',
        url: `${ this.#getApiBaseUrl() }/webhooks`,
      })

      logger.debug(
        `[listWebhooks] Retrieved ${ response.webhooks?.length || 0 } webhooks`
      )

      return response
    } catch (error) {
      logger.error(`[listWebhooks] Error: ${ error.message }`)

      throw new Error(`Failed to list webhooks: ${ error.message }`)
    }
  }

  /**
   * @typedef {Object} CreateWebhookResponse
   * @property {String} id - The unique webhook ID.
   * @property {String} name - The webhook display name.
   * @property {String} created - The datetime the webhook was created.
   * @property {String} lastSent - The datetime the webhook last fired, or null if never fired.
   * @property {Array<String>} monitorFields - List of employee fields being monitored for changes.
   * @property {Object} postFields - Map of field aliases to external names included in payloads.
   * @property {String} url - The HTTPS URL that receives webhook payloads.
   * @property {String} format - The payload format (json).
   * @property {String} privateKey - The HMAC-SHA256 private key for verifying webhook signatures. Only returned at creation time.
   * @property {Boolean} includeCompanyDomain - Whether the company domain is included in payloads.
   * @property {Array<String>} events - List of events the webhook is subscribed to.
   */

  /**
   * @operationName Create Webhook
   * @category Webhooks
   * @description Creates a new webhook subscription. When events includes "employee.updated", monitorFields is required. The response includes a privateKey for HMAC-SHA256 payload verification, which is only returned at creation time.
   * @route POST /createWebhook
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"A descriptive name for the webhook."}
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The HTTPS URL that will receive webhook payloads."}
   * @paramDef {"type":"String","label":"Monitor Fields","name":"monitorFields","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Comma-separated list of employee field names to monitor for changes (e.g., firstName,lastName,jobTitle). Required when events includes employee.updated."}
   * @paramDef {"type":"Object","label":"Post Fields","name":"postFields","description":"Map each employee field alias to the key name it should appear under in the payload (e.g., {\"firstName\":\"Name\",\"lastName\":\"Surname\"})."}
   * @paramDef {"type":"String","label":"Format","name":"format","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["JSON"]}},"description":"The payload delivery format. BambooHR delivers these webhooks as JSON."}
   * @paramDef {"type":"Boolean","label":"Include Company Domain","name":"includeCompanyDomain","uiComponent":{"type":"TOGGLE"},"description":"Whether to include the company domain in webhook payloads."}
   * @paramDef {"type":"String","label":"Events","name":"events","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Comma-separated list of events to subscribe to (e.g., employee.created,employee.updated,employee.deleted)."}
   *
   * @returns {CreateWebhookResponse}
   * @sampleResult {"id":"4","name":"Employee Changes","created":"2024-03-15 10:30:00","lastSent":null,"monitorFields":["firstName","lastName"],"postFields":{"firstName":"Name"},"url":"https://example.com/webhook","format":"json","privateKey":"abc123secret","includeCompanyDomain":false,"events":["employee.created","employee.updated"]}
   */
  async createWebhook(
    name,
    url,
    monitorFields,
    postFields,
    format,
    includeCompanyDomain,
    events
  ) {
    try {
      if (!name) {
        throw new Error('Webhook name is required')
      }

      if (!url) {
        throw new Error('Webhook URL is required')
      }

      if (!format) {
        throw new Error('Webhook format is required')
      }

      logger.debug(`[createWebhook] Creating webhook: ${ name }`)

      const body = {
        name,
        url,
        format: this.#resolveChoice(format, { JSON: 'json' }),
      }

      if (monitorFields) {
        body.monitorFields = monitorFields
          .split(',')
          .map(f => f.trim())
          .filter(Boolean)
      }

      if (postFields) {
        body.postFields = postFields
      }

      if (includeCompanyDomain !== undefined && includeCompanyDomain !== null) {
        body.includeCompanyDomain = includeCompanyDomain
      }

      if (events) {
        body.events = events
          .split(',')
          .map(e => e.trim())
          .filter(Boolean)
      }

      const response = await this.#apiRequest({
        logTag: 'createWebhook',
        url: `${ this.#getApiBaseUrl() }/webhooks`,
        method: 'post',
        body,
      })

      logger.debug(`[createWebhook] Webhook "${ name }" created successfully`)

      return response
    } catch (error) {
      logger.error(`[createWebhook] Error: ${ error.message }`)

      throw new Error(`Failed to create webhook: ${ error.message }`)
    }
  }

  /**
   * @typedef {Object} GetWebhookResponse
   * @property {String} id - The unique webhook ID.
   * @property {String} name - The webhook display name.
   * @property {String} created - The datetime the webhook was created.
   * @property {String} lastSent - The datetime the webhook last fired, or null if never fired.
   * @property {Array<String>} monitorFields - List of employee fields being monitored for changes.
   * @property {Object} postFields - Map of field aliases to external names included in payloads.
   * @property {String} url - The HTTPS URL that receives webhook payloads.
   * @property {String} format - The payload format (json).
   * @property {Boolean} includeCompanyDomain - Whether the company domain is included in payloads.
   * @property {Array<String>} events - List of events the webhook is subscribed to.
   */

  /**
   * @operationName Get Webhook
   * @category Webhooks
   * @description Returns the full configuration of a single webhook including name, URL, format, monitored fields, post fields, events, and timestamps.
   * @route POST /getWebhook
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Webhook ID","name":"webhookId","required":true,"description":"The unique ID of the webhook to retrieve.","dictionary":"getWebhooksDictionary"}
   *
   * @returns {GetWebhookResponse}
   * @sampleResult {"id":"1","name":"Employee Changes","created":"2024-01-15 10:30:00","lastSent":"2024-03-10 14:22:00","monitorFields":["firstName","lastName"],"postFields":{"firstName":"Name"},"url":"https://example.com/webhook","format":"json","includeCompanyDomain":false,"events":["employee.created","employee.updated"]}
   */
  async getWebhook(webhookId) {
    try {
      if (!webhookId) {
        throw new Error('Webhook ID is required')
      }

      logger.debug(`[getWebhook] Fetching webhook: ${ webhookId }`)

      const response = await this.#apiRequest({
        logTag: 'getWebhook',
        url: `${ this.#getApiBaseUrl() }/webhooks/${ webhookId }`,
      })

      logger.debug(`[getWebhook] Successfully retrieved webhook ${ webhookId }`)

      return response
    } catch (error) {
      logger.error(`[getWebhook] Error: ${ error.message }`)

      throw new Error(
        `Failed to retrieve webhook ${ webhookId }: ${ error.message }`
      )
    }
  }

  /**
   * @typedef {Object} UpdateWebhookResponse
   * @property {String} id - The unique webhook ID.
   * @property {String} name - The updated webhook display name.
   * @property {String} created - The datetime the webhook was originally created.
   * @property {String} lastSent - The datetime the webhook last fired, or null if never fired.
   * @property {Array<String>} monitorFields - Updated list of employee fields being monitored.
   * @property {Object} postFields - Updated map of field aliases to external names.
   * @property {String} url - The updated HTTPS URL that receives webhook payloads.
   * @property {String} format - The updated payload format (json).
   * @property {Boolean} includeCompanyDomain - Whether the company domain is included in payloads.
   * @property {Array<String>} events - Updated list of events the webhook is subscribed to.
   */

  /**
   * @operationName Update Webhook
   * @category Webhooks
   * @description Performs a full replacement update of a webhook configuration. All fields replace existing values. The monitorFields array is required when events includes "employee.updated".
   * @route POST /updateWebhook
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Webhook ID","name":"webhookId","required":true,"description":"The unique ID of the webhook to update.","dictionary":"getWebhooksDictionary"}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The updated name for the webhook."}
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The updated HTTPS URL that will receive webhook payloads."}
   * @paramDef {"type":"String","label":"Monitor Fields","name":"monitorFields","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Comma-separated list of employee field names to monitor for changes (e.g., firstName,lastName,department). Required when events includes employee.updated."}
   * @paramDef {"type":"Object","label":"Post Fields","name":"postFields","description":"Map each employee field alias to the key name it should appear under in the payload (e.g., {\"firstName\":\"Name\"})."}
   * @paramDef {"type":"String","label":"Format","name":"format","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["JSON"]}},"description":"The payload delivery format. BambooHR delivers these webhooks as JSON."}
   * @paramDef {"type":"Boolean","label":"Include Company Domain","name":"includeCompanyDomain","uiComponent":{"type":"TOGGLE"},"description":"Whether to include the company domain in webhook payloads."}
   * @paramDef {"type":"String","label":"Events","name":"events","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Comma-separated list of events to subscribe to (e.g., employee.created,employee.updated,employee.deleted)."}
   *
   * @returns {UpdateWebhookResponse}
   * @sampleResult {"id":"1","name":"Updated Webhook","created":"2024-01-15 10:30:00","lastSent":"2024-03-10 14:22:00","monitorFields":["firstName","lastName","department"],"postFields":{},"url":"https://example.com/webhook-v2","format":"json","includeCompanyDomain":true,"events":["employee.created","employee.updated","employee.deleted"]}
   */
  async updateWebhook(
    webhookId,
    name,
    url,
    monitorFields,
    postFields,
    format,
    includeCompanyDomain,
    events
  ) {
    try {
      if (!webhookId) {
        throw new Error('Webhook ID is required')
      }

      if (!name) {
        throw new Error('Webhook name is required')
      }

      if (!url) {
        throw new Error('Webhook URL is required')
      }

      if (!format) {
        throw new Error('Webhook format is required')
      }

      logger.debug(`[updateWebhook] Updating webhook: ${ webhookId }`)

      const body = {
        name,
        url,
        format: this.#resolveChoice(format, { JSON: 'json' }),
      }

      if (monitorFields) {
        body.monitorFields = monitorFields
          .split(',')
          .map(f => f.trim())
          .filter(Boolean)
      }

      if (postFields) {
        body.postFields = postFields
      }

      if (includeCompanyDomain !== undefined && includeCompanyDomain !== null) {
        body.includeCompanyDomain = includeCompanyDomain
      }

      if (events) {
        body.events = events
          .split(',')
          .map(e => e.trim())
          .filter(Boolean)
      }

      const response = await this.#apiRequest({
        logTag: 'updateWebhook',
        url: `${ this.#getApiBaseUrl() }/webhooks/${ webhookId }`,
        method: 'put',
        body,
      })

      logger.debug(`[updateWebhook] Webhook ${ webhookId } updated successfully`)

      return response
    } catch (error) {
      logger.error(`[updateWebhook] Error: ${ error.message }`)

      throw new Error(
        `Failed to update webhook ${ webhookId }: ${ error.message }`
      )
    }
  }

  /**
   * @typedef {Object} DeleteWebhookResponse
   * @property {Boolean} success - Whether the webhook was deleted successfully.
   * @property {String} message - Status message describing the result.
   */

  /**
   * @operationName Delete Webhook
   * @category Webhooks
   * @description Deletes a webhook subscription. This action is permanent and the webhook will no longer receive events.
   * @route POST /deleteWebhook
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Webhook ID","name":"webhookId","required":true,"description":"The unique ID of the webhook to delete.","dictionary":"getWebhooksDictionary"}
   *
   * @returns {DeleteWebhookResponse}
   * @sampleResult {"success":true,"message":"Webhook deleted successfully"}
   */
  async deleteWebhook(webhookId) {
    try {
      if (!webhookId) {
        throw new Error('Webhook ID is required')
      }

      logger.debug(`[deleteWebhook] Deleting webhook: ${ webhookId }`)

      await this.#apiRequest({
        logTag: 'deleteWebhook',
        url: `${ this.#getApiBaseUrl() }/webhooks/${ webhookId }`,
        method: 'delete',
      })

      logger.debug(`[deleteWebhook] Webhook ${ webhookId } deleted successfully`)

      return { success: true, message: 'Webhook deleted successfully' }
    } catch (error) {
      logger.error(`[deleteWebhook] Error: ${ error.message }`)

      throw new Error(
        `Failed to delete webhook ${ webhookId }: ${ error.message }`
      )
    }
  }

  /**
   * @typedef {Object} WebhookLogEntry
   * @property {String} webhookId - The webhook ID this log entry belongs to.
   * @property {String} url - The URL the webhook payload was sent to.
   * @property {String} lastAttempted - The datetime of the last delivery attempt.
   * @property {String} lastSuccess - The datetime of the last successful delivery.
   * @property {String} statusCode - The HTTP status code returned by the receiving server.
   * @property {String} format - The payload format used (json).
   * @property {Array<String>} employeeIds - List of employee IDs included in the webhook payload.
   */

  /**
   * @operationName Get Webhook Logs
   * @category Webhooks
   * @description Returns recent delivery log entries for a webhook covering the last 14 days (up to 200 entries). Each entry includes the target URL, timestamps, HTTP status code, format, and affected employee IDs.
   * @route POST /getWebhookLogs
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Webhook ID","name":"webhookId","required":true,"description":"The unique ID of the webhook to retrieve logs for.","dictionary":"getWebhooksDictionary"}
   *
   * @returns {Array<WebhookLogEntry>}
   * @sampleResult [{"webhookId":"1","url":"https://example.com/webhook","lastAttempted":"2024-03-10 14:22:00","lastSuccess":"2024-03-10 14:22:00","statusCode":"200","format":"json","employeeIds":["123","456"]}]
   */
  async getWebhookLogs(webhookId) {
    try {
      if (!webhookId) {
        throw new Error('Webhook ID is required')
      }

      logger.debug(`[getWebhookLogs] Fetching logs for webhook: ${ webhookId }`)

      const response = await this.#apiRequest({
        logTag: 'getWebhookLogs',
        url: `${ this.#getApiBaseUrl() }/webhooks/${ webhookId }/log`,
      })

      logger.debug(
        `[getWebhookLogs] Retrieved ${ Array.isArray(response) ? response.length : 0 } log entries for webhook ${ webhookId }`
      )

      return response
    } catch (error) {
      logger.error(`[getWebhookLogs] Error: ${ error.message }`)

      throw new Error(
        `Failed to retrieve webhook logs for ${ webhookId }: ${ error.message }`
      )
    }
  }

  // ========================================== REALTIME TRIGGER ==========================================

  /**
   * @operationName On Employee Changed
   * @category Triggers
   * @description Fires whenever a watched field on any employee changes in BambooHR (for example a job title, department, or status update). Activating the trigger registers a BambooHR webhook that watches the fields you name and calls FlowRunner the moment they change; deactivating removes it. Each event carries the changed employee's ID and the new field values. BambooHR reports every event as a field change - the trigger cannot distinguish whether the change came from creating, updating, or deleting an employee.
   * @route POST /onEmployeeChanged
   * @registerAs REALTIME_TRIGGER
   *
   * @appearanceColor #73C41D #5AA010
   *
   * @paramDef {"type":"String","label":"Monitored Fields","name":"monitorFields","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Comma-separated employee field names to watch for changes (e.g. firstName,lastName,jobTitle,department,workEmail,status). Leave blank to watch a standard set of profile fields."}
   *
   * @returns {Object}
   * @sampleResult {"type":"changed","employeeId":"123","changedFields":["jobTitle"],"fields":{"jobTitle":"Senior Engineer"},"timestamp":"2024-03-15T14:30:00+00:00"}
   */
  async onEmployeeChanged() {}

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    const stored = invocation.webhookData || {}
    const callbackUrl = invocation.callbackUrl || invocation.callbackURL

    // Watch the union of fields named by every subscribing trigger, or a standard set.
    const fields = new Set()

    for (const event of (invocation.events || [])) {
      const raw = event.triggerData?.monitorFields

      if (raw) {
        String(raw).split(',').map(f => f.trim()).filter(Boolean).forEach(f => fields.add(f))
      }
    }

    if (!fields.size) {
      DEFAULT_WEBHOOK_FIELDS.forEach(f => fields.add(f))
    }

    const monitorFields = [...fields]

    // postFields echoes each watched field back under its own name in the delivered payload.
    const postFields = {}

    monitorFields.forEach(f => {
      postFields[f] = f
    })

    const body = {
      name: 'FlowRunner employee change trigger',
      url: callbackUrl,
      format: 'json',
      monitorFields,
      postFields,
    }

    let webhookId = stored.webhookId
    let privateKey = stored.privateKey

    try {
      if (webhookId) {
        // A full-replace update; BambooHR keeps the original privateKey, so we keep ours too.
        await this.#apiRequest({
          logTag: 'handleTriggerUpsertWebhook.update',
          url: `${ this.#getApiBaseUrl() }/webhooks/${ webhookId }`,
          method: 'put',
          body,
        })
      } else {
        const created = await this.#apiRequest({
          logTag: 'handleTriggerUpsertWebhook.create',
          url: `${ this.#getApiBaseUrl() }/webhooks`,
          method: 'post',
          body,
        })

        webhookId = created?.id
        privateKey = created?.privateKey
      }
    } catch (error) {
      logger.error(`[handleTriggerUpsertWebhook] Error: ${ error.message }`)

      throw error
    }

    return { webhookData: { webhookId, privateKey, monitorFields } }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    const headers = lowerKeys(invocation.headers || invocation.httpHeaders || {})
    const signature = headers['x-bamboohr-signature']
    const timestamp = headers['x-bamboohr-timestamp']
    const privateKey = invocation.webhookData?.privateKey
    const rawBody =
      invocation.rawBody ||
      invocation.bodyString ||
      (typeof invocation.body === 'string' ? invocation.body : null)

    // With a stored key, a delivery MUST prove itself. BambooHR signs a hex HMAC-SHA256 over
    // (raw body + timestamp) with the webhook's private key. A missing header/body or a
    // mismatch is rejected; the compare is constant-time so a near-miss can't be probed.
    if (privateKey) {
      if (!signature || !timestamp || !rawBody) {
        logger.warn('[handleTriggerResolveEvents] missing signature, timestamp, or raw body - rejecting')

        return { events: [] }
      }

      const expected = crypto
        .createHmac('sha256', privateKey)
        .update(rawBody + timestamp, 'utf8')
        .digest('hex')

      if (!safeEqual(expected, signature)) {
        logger.warn('[handleTriggerResolveEvents] signature mismatch - rejecting')

        return { events: [] }
      }
    } else {
      // No stored key (webhook predates key capture) - the delivery cannot be verified.
      logger.warn('[handleTriggerResolveEvents] no stored privateKey - accepting delivery unverified')
    }

    const payload = invocation.body || {}
    const employees = Array.isArray(payload.employees) ? payload.employees : []

    const events = employees.map(emp => ({
      name: 'onEmployeeChanged',
      data: {
        type: 'changed',
        employeeId: String(emp.id != null ? emp.id : ''),
        changedFields: emp.changedFields || [],
        fields: emp.fields || {},
        timestamp: emp.timestamp || payload.timestamp || new Date().toISOString(),
      },
    }))

    return { events }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    // Every subscriber to an employee change matches; the monitored-field set is enforced by
    // the webhook itself, so there is no per-event filtering to do here.
    const triggers = invocation.triggers || []

    return { ids: triggers.map(t => t.id) }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerDeleteWebhook(invocation) {
    const webhookId = invocation.webhookData?.webhookId

    if (!webhookId) {
      return {}
    }

    try {
      await this.#apiRequest({
        logTag: 'handleTriggerDeleteWebhook',
        url: `${ this.#getApiBaseUrl() }/webhooks/${ webhookId }`,
        method: 'delete',
      })
    } catch (error) {
      logger.warn(`[handleTriggerDeleteWebhook] cleanup failed, leaving webhook ${ webhookId }: ${ error.message }`)
    }

    return {}
  }

  // ========================================== DICTIONARIES ==========================================

  /**
   * @typedef {Object} getEmployeeDirectoryDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter employees by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Employee Picker
   * @description Lists employees so an employee can be picked from a dropdown instead of pasting an ID.
   * @route POST /getEmployeeDirectoryDictionary
   * @paramDef {"type":"getEmployeeDirectoryDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Jane Smith","value":"123","note":"Software Engineer"}],"cursor":null}
   */
  async getEmployeeDirectoryDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getEmployeeDirectoryDictionary',
      url: `${ this.#getApiBaseUrl() }/employees/directory`,
    })

    const employees = Array.isArray(response?.employees) ? response.employees : []

    const items = employees.map(e => ({
      label: e.displayName || [e.firstName, e.lastName].filter(Boolean).join(' ') || `Employee ${ e.id }`,
      value: String(e.id),
      note: e.jobTitle || e.department || '',
    }))

    return { items: filterItems(items, search), cursor: null }
  }

  /**
   * @typedef {Object} getWebhooksDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter webhooks by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Webhook Picker
   * @description Lists webhooks owned by the connected account so one can be picked from a dropdown.
   * @route POST /getWebhooksDictionary
   * @paramDef {"type":"getWebhooksDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Employee Changes","value":"1","note":"https://example.com/webhook"}],"cursor":null}
   */
  async getWebhooksDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getWebhooksDictionary',
      url: `${ this.#getApiBaseUrl() }/webhooks`,
    })

    const webhooks = Array.isArray(response?.webhooks) ? response.webhooks : []

    const items = webhooks.map(w => ({
      label: w.name || `Webhook ${ w.id }`,
      value: String(w.id),
      note: w.url || '',
    }))

    return { items: filterItems(items, search), cursor: null }
  }

  /**
   * @typedef {Object} getJobApplicationsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter applications by applicant name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Job Application Picker
   * @description Lists active job applications so one can be picked from a dropdown instead of pasting an ID.
   * @route POST /getJobApplicationsDictionary
   * @paramDef {"type":"getJobApplicationsDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"John Doe","value":"1","note":"Software Engineer"}],"cursor":null}
   */
  async getJobApplicationsDictionary(payload) {
    const { search } = payload || {}

    const query = {}

    if (search) {
      query.searchString = search
    }

    const response = await this.#apiRequest({
      logTag: 'getJobApplicationsDictionary',
      url: `${ this.#getApiBaseUrl() }/applicant_tracking/applications`,
      query,
    })

    const applications = Array.isArray(response?.applications) ? response.applications : []

    const items = applications.map(a => {
      const applicant = a.applicant || {}
      const name = [applicant.firstName, applicant.lastName].filter(Boolean).join(' ')

      return {
        label: name || `Application ${ a.id }`,
        value: String(a.id),
        note: a.job?.title || '',
      }
    })

    return { items: filterItems(items, search), cursor: null }
  }

  /**
   * @typedef {Object} getTimeOffRequestsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter requests by employee name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Time Off Request Picker
   * @description Lists time off requests from the last 90 days through the next 90 days so one can be picked from a dropdown.
   * @route POST /getTimeOffRequestsDictionary
   * @paramDef {"type":"getTimeOffRequestsDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Jane Smith - Vacation","value":"1","note":"2024-03-01 to 2024-03-05"}],"cursor":null}
   */
  async getTimeOffRequestsDictionary(payload) {
    const { search } = payload || {}

    const day = 24 * 60 * 60 * 1000
    const start = new Date(Date.now() - 90 * day).toISOString().slice(0, 10)
    const end = new Date(Date.now() + 90 * day).toISOString().slice(0, 10)

    const response = await this.#apiRequest({
      logTag: 'getTimeOffRequestsDictionary',
      url: `${ this.#getApiBaseUrl() }/time_off/requests`,
      query: { start, end },
    })

    const requests = Array.isArray(response) ? response : []

    const items = requests.map(r => ({
      label: [r.name, r.type?.name].filter(Boolean).join(' - ') || `Request ${ r.id }`,
      value: String(r.id),
      note: [r.start, r.end].filter(Boolean).join(' to '),
    }))

    return { items: filterItems(items, search), cursor: null }
  }

  /**
   * @typedef {Object} getGoalsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","required":true,"description":"The employee whose goals to list."}
   */

  /**
   * @typedef {Object} getGoalsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter goals by title."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
   * @paramDef {"type":"getGoalsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the employee whose goals to list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Goal Picker
   * @description Lists an employee's goals so one can be picked from a dropdown instead of pasting an ID.
   * @route POST /getGoalsDictionary
   * @paramDef {"type":"getGoalsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the employee criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Complete Q1 deliverables","value":"1","note":"75% complete"}],"cursor":null}
   */
  async getGoalsDictionary(payload) {
    const { search, criteria } = payload || {}
    const employeeId = criteria?.employeeId

    if (!employeeId) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      logTag: 'getGoalsDictionary',
      url: `${ this.#getApiBaseUrl() }/performance/employees/${ employeeId }/goals`,
    })

    const goals = Array.isArray(response?.goals) ? response.goals : []

    const items = goals.map(g => ({
      label: g.title || `Goal ${ g.id }`,
      value: String(g.id),
      note: g.percentComplete != null ? `${ g.percentComplete }% complete` : '',
    }))

    return { items: filterItems(items, search), cursor: null }
  }

  /**
   * @typedef {Object} getEmployeeFilesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","required":true,"description":"The employee whose files to list."}
   */

  /**
   * @typedef {Object} getEmployeeFilesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter files by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
   * @paramDef {"type":"getEmployeeFilesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the employee whose files to list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Employee File Picker
   * @description Lists an employee's files so one can be picked from a dropdown instead of pasting an ID.
   * @route POST /getEmployeeFilesDictionary
   * @paramDef {"type":"getEmployeeFilesDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the employee criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Offer Letter","value":"100","note":"New Hire Documents"}],"cursor":null}
   */
  async getEmployeeFilesDictionary(payload) {
    const { search, criteria } = payload || {}
    const employeeId = criteria?.employeeId

    if (!employeeId) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      logTag: 'getEmployeeFilesDictionary',
      url: `${ this.#getApiBaseUrl() }/employees/${ employeeId }/files/view`,
    })

    const categories = Array.isArray(response?.categories) ? response.categories : []
    const items = []

    for (const category of categories) {
      for (const file of (category.files || [])) {
        items.push({
          label: file.name || file.originalFileName || `File ${ file.id }`,
          value: String(file.id),
          note: category.name || '',
        })
      }
    }

    return { items: filterItems(items, search), cursor: null }
  }

  /**
   * @typedef {Object} getEmployeeDependentsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","required":true,"description":"The employee whose dependents to list."}
   */

  /**
   * @typedef {Object} getEmployeeDependentsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter dependents by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
   * @paramDef {"type":"getEmployeeDependentsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the employee whose dependents to list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Employee Dependent Picker
   * @description Lists an employee's dependents so one can be picked from a dropdown instead of pasting an ID.
   * @route POST /getEmployeeDependentsDictionary
   * @paramDef {"type":"getEmployeeDependentsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the employee criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Sarah Smith","value":"1","note":"Spouse"}],"cursor":null}
   */
  async getEmployeeDependentsDictionary(payload) {
    const { search, criteria } = payload || {}
    const employeeId = criteria?.employeeId

    if (!employeeId) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      logTag: 'getEmployeeDependentsDictionary',
      url: `${ this.#getApiBaseUrl() }/employeedependents`,
      query: { employeeid: employeeId },
    })

    const dependents = Array.isArray(response?.['Employee Dependents'])
      ? response['Employee Dependents']
      : []

    const items = dependents.map(d => ({
      label: [d.firstName, d.lastName].filter(Boolean).join(' ') || `Dependent ${ d.id }`,
      value: String(d.id),
      note: d.relationship || '',
    }))

    return { items: filterItems(items, search), cursor: null }
  }

  /**
   * @typedef {Object} getTableRowsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","required":true,"description":"The employee whose table rows to list."}
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"description":"The employee table containing the rows."}
   */

  /**
   * @typedef {Object} getTableRowsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter rows by date."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
   * @paramDef {"type":"getTableRowsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the employee and table whose rows to list."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Table Row Picker
   * @description Lists rows in an employee table so one can be picked from a dropdown instead of pasting an ID.
   * @route POST /getTableRowsDictionary
   * @paramDef {"type":"getTableRowsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the employee and table criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"2023-01-15","value":"1","note":"Software Engineer"}],"cursor":null}
   */
  async getTableRowsDictionary(payload) {
    const { search, criteria } = payload || {}
    const employeeId = criteria?.employeeId
    const tableName = criteria?.tableName

    if (!employeeId || !tableName) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      logTag: 'getTableRowsDictionary',
      url: `${ this.#getApiBaseUrl() }/employees/${ employeeId }/tables/${ tableName }`,
    })

    const rows = Array.isArray(response) ? response : []

    const items = rows.map(row => ({
      label: row.date || `Row ${ row.id }`,
      value: String(row.id),
      note: row.jobTitle || row.department || '',
    }))

    return { items: filterItems(items, search), cursor: null }
  }

  /**
   * @typedef {Object} getEmployeeFileCategoriesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Employee ID","name":"employeeId","required":true,"description":"The employee whose file listing supplies the categories."}
   */

  /**
   * @typedef {Object} getEmployeeFileCategoriesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter categories by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
   * @paramDef {"type":"getEmployeeFileCategoriesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the employee whose file listing supplies the categories."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Employee File Category Picker
   * @description Lists employee file categories so one can be picked from a dropdown instead of typing an ID.
   * @route POST /getEmployeeFileCategoriesDictionary
   * @paramDef {"type":"getEmployeeFileCategoriesDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the employee criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"New Hire Documents","value":"1","note":"1 files"}],"cursor":null}
   */
  async getEmployeeFileCategoriesDictionary(payload) {
    const { search, criteria } = payload || {}
    const employeeId = criteria?.employeeId

    if (!employeeId) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      logTag: 'getEmployeeFileCategoriesDictionary',
      url: `${ this.#getApiBaseUrl() }/employees/${ employeeId }/files/view`,
    })

    const categories = Array.isArray(response?.categories) ? response.categories : []

    const items = categories.map(c => ({
      label: c.name || `Category ${ c.id }`,
      value: String(c.id),
      note: `${ (c.files || []).length } files`,
    }))

    return { items: filterItems(items, search), cursor: null }
  }

  /**
   * @typedef {Object} getCompanyFilesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter files by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Company File Picker
   * @description Lists company files so one can be picked from a dropdown instead of pasting an ID.
   * @route POST /getCompanyFilesDictionary
   * @paramDef {"type":"getCompanyFilesDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Direct Deposit Form","value":"387","note":"New Employee Docs"}],"cursor":null}
   */
  async getCompanyFilesDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getCompanyFilesDictionary',
      url: `${ this.#getApiBaseUrl() }/files/view`,
    })

    const categories = Array.isArray(response?.categories) ? response.categories : []
    const items = []

    for (const category of categories) {
      for (const file of (category.files || [])) {
        items.push({
          label: file.name || file.originalFileName || `File ${ file.id }`,
          value: String(file.id),
          note: category.name || '',
        })
      }
    }

    return { items: filterItems(items, search), cursor: null }
  }

  /**
   * @typedef {Object} getCompanyFileCategoriesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter categories by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Company File Category Picker
   * @description Lists company file categories so one can be picked from a dropdown instead of typing an ID.
   * @route POST /getCompanyFileCategoriesDictionary
   * @paramDef {"type":"getCompanyFileCategoriesDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"New Employee Docs","value":"20","note":""}],"cursor":null}
   */
  async getCompanyFileCategoriesDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getCompanyFileCategoriesDictionary',
      url: `${ this.#getApiBaseUrl() }/files/view`,
    })

    const categories = Array.isArray(response?.categories) ? response.categories : []

    const items = categories.map(c => ({
      label: c.name || `Category ${ c.id }`,
      value: String(c.id),
      note: c.canUploadFiles === 'no' ? 'read-only' : '',
    }))

    return { items: filterItems(items, search), cursor: null }
  }

  /**
   * @typedef {Object} getTablesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter tables by alias."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Table Picker
   * @description Lists employee tables so a table can be picked from a dropdown instead of typing its alias.
   * @route POST /getTablesDictionary
   * @paramDef {"type":"getTablesDictionary__payload","label":"Payload","name":"payload","description":"Optional search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"jobInfo","value":"jobInfo","note":"6 fields"}],"cursor":null}
   */
  async getTablesDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getTablesDictionary',
      url: `${ this.#getApiBaseUrl() }/meta/tables`,
    })

    const tables = Array.isArray(response) ? response : []

    const items = tables.map(t => ({
      label: t.alias,
      value: t.alias,
      note: `${ (t.fields || []).length } fields`,
    }))

    return { items: filterItems(items, search), cursor: null }
  }
}

Flowrunner.ServerCode.addService(BambooHR, [
  {
    displayName: 'Client ID',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your OAuth 2.0 Client ID from the BambooHR Developer Portal.',
  },
  {
    displayName: 'Client Secret',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your OAuth 2.0 Client Secret from the BambooHR Developer Portal.',
  },
  {
    displayName: 'Company Domain',
    name: 'companyDomain',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your BambooHR subdomain (e.g., "mycompany" from mycompany.bamboohr.com).',
  },
])
