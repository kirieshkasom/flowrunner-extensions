'use strict'

const ZOHO_CRM_SCOPES = 'ZohoCRM.modules.ALL,ZohoCRM.settings.ALL,ZohoCRM.users.READ'
const TOKEN_DOMAIN_DELIMITER = '::domain::'

const ERROR_HINTS = {
  400: 'Zoho rejected the request. Check the field names and values - field API names are case-sensitive (e.g. Last_Name, not last name).',
  401: 'Authentication failed - reconnect the Zoho CRM account.',
  403: 'Access denied - your Zoho profile lacks permission for this record type or operation.',
  404: 'Not found - the record type or ID may be wrong. Use the matching "Get" action to pick a valid one.',
  429: 'Zoho rate limit hit - retry in a moment.',
  500: 'Zoho had a server error - this is usually transient, retry in a moment.',
}

const logger = {
  info: (...args) => console.log('[Zoho CRM Service] info:', ...args),
  debug: (...args) => console.log('[Zoho CRM Service] debug:', ...args),
  error: (...args) => console.log('[Zoho CRM Service] error:', ...args),
  warn: (...args) => console.log('[Zoho CRM Service] warn:', ...args),
}

function cleanupObject(data) {
  if (!data) {
    return undefined
  }

  const result = {}

  Object.keys(data).forEach(key => {
    const value = data[key]

    if (value === undefined || value === null) {
      return
    }

    if (typeof value === 'string' && value.trim() === '') {
      return
    }

    result[key] = value
  })

  return Object.keys(result).length > 0 ? result : undefined
}

/**
 * @requireOAuth
 * @integrationName Zoho CRM
 * @integrationIcon /icon.png
 */
class ZohoCRMService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.dataCenterDomain = config.dataCenterDomain || 'com'
  }

  // ──────────────────────────────────────────────
  // Private Helpers
  // ──────────────────────────────────────────────

  #getCompositeToken() {
    const compositeToken = this.request.headers['oauth-access-token']

    if (!compositeToken) {
      throw new Error('Access token is not available. Please reconnect your Zoho CRM account.')
    }

    return compositeToken
  }

  #getAccessToken() {
    return this.#getCompositeToken().split(TOKEN_DOMAIN_DELIMITER)[0]
  }

  #getApiDomain() {
    const apiDomain = this.#getCompositeToken().split(TOKEN_DOMAIN_DELIMITER)[1]

    if (!apiDomain) {
      throw new Error('Unable to connect to Zoho CRM. Please reconnect your account.')
    }

    return apiDomain
  }

  #getOAuthBaseUrl() {
    return `https://accounts.zoho.${ this.dataCenterDomain }/oauth/v2`
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'
    query = cleanupObject(query)

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      const request = Flowrunner.Request[method](url)
        .set({
          'Authorization': `Zoho-oauthtoken ${ this.#getAccessToken() }`,
          'Content-Type': 'application/json',
        })
        .query(query)

      if (body) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      this.#handleError(error, logTag)
    }
  }

  #handleError(error, logTag) {
    const status = error?.status || error?.body?.status || error?.code
    const apiMessage =
      error?.body?.message ||
      error?.message ||
      'Request failed'
    const hint = ERROR_HINTS[status]

    logger.error(`${ logTag } - API request failed: ${ apiMessage }`)

    throw new Error(hint ? `${ hint } (${ apiMessage })` : apiMessage)
  }

  #getParamTypeForZohoFieldType(dataType) {
    switch (dataType) {
      case 'integer':
      case 'currency':
      case 'double':
      case 'decimal':
        return 'Number'

      case 'boolean':
        return 'Boolean'

      case 'text':
      case 'website':
      case 'email':
      case 'phone':
      case 'autonumber':
      case 'textarea':
      case 'date':
      case 'datetime':
      case 'picklist':
      case 'multiselectpicklist':
      case 'lookup':
      case 'bigint':
      case 'long':
      default:
        return 'String'
    }
  }

  #getFriendlyFieldTypeName(dataType) {
    switch (dataType) {
      case 'text': return 'Text'
      case 'textarea': return 'Multi-line text'
      case 'boolean': return 'Yes/No'
      case 'picklist': return 'Dropdown selection'
      case 'multiselectpicklist': return 'Multi-select'
      case 'integer': case 'double': case 'decimal': return 'Number'
      case 'currency': return 'Currency'
      case 'date': return 'Date'
      case 'datetime': return 'Date and time'
      case 'lookup': return 'Related record'
      case 'email': return 'Email'
      case 'phone': return 'Phone'
      case 'website': return 'Website URL'
      case 'autonumber': return 'Auto-generated number'
      default: return 'Text'
    }
  }

  #getUiComponentForZohoFieldType(dataType, field) {
    switch (dataType) {
      case 'boolean':
        return { type: 'TOGGLE' }

      case 'textarea':
      case 'multiselectpicklist':
        return { type: 'MULTI_LINE_TEXT' }

      case 'integer':
      case 'currency':
      case 'double':
      case 'decimal':
        return { type: 'NUMERIC_STEPPER' }

      case 'date':
        return { type: 'DATE_PICKER' }

      case 'datetime':
        return { type: 'DATE_TIME_PICKER' }

      case 'picklist':
        if (field?.pick_list_values?.length) {
          return {
            type: 'DROPDOWN',
            options: {
              values: field.pick_list_values.map(v => ({
                value: v.actual_value ?? v.display_value,
                label: v.display_value,
              })),
            },
          }
        }

        return { type: 'SINGLE_LINE_TEXT' }

      default:
        return { type: 'SINGLE_LINE_TEXT' }
    }
  }

  // v7 requires an explicit field list when listing records; an empty `fields` returns a
  // mandatory-param error. When the user leaves it blank we fetch the module's field API
  // names (Zoho caps the parameter at 50) so "all fields" keeps working.
  async #resolveFields(moduleName, fields) {
    if (fields) {
      return fields
    }

    try {
      const apiDomain = this.#getApiDomain()

      const fieldsResponse = await this.#apiRequest({
        url: `${ apiDomain }/crm/v7/settings/fields?module=${ moduleName }`,
        logTag: 'resolveFields',
      })

      const apiNames = (fieldsResponse.fields || [])
        .map(f => f.api_name)
        .filter(Boolean)
        .slice(0, 50)

      return apiNames.length ? apiNames.join(',') : undefined
    } catch (e) {
      logger.warn(`resolveFields - could not load fields for ${ moduleName }: ${ e.message }`)

      return fields
    }
  }

  // Best-effort human label for a record picker. Modules expose different name fields, so
  // fall back through the common ones and finally the raw id.
  #recordDisplayLabel(record) {
    return record.Full_Name ||
      record.Name ||
      record.Deal_Name ||
      record.Account_Name ||
      record.Subject ||
      record.Last_Name ||
      record.Email ||
      record.email ||
      record.id
  }

  async #listRecordsForDictionary(moduleName, search) {
    if (!moduleName) {
      return []
    }

    const apiDomain = this.#getApiDomain()

    if (search) {
      const response = await this.#apiRequest({
        url: `${ apiDomain }/crm/v7/${ moduleName }/search`,
        query: { word: search, per_page: 50 },
        logTag: 'recordsDictionary',
      })

      return response?.data || []
    }

    const fields = await this.#resolveFields(moduleName)

    const response = await this.#apiRequest({
      url: `${ apiDomain }/crm/v7/${ moduleName }`,
      query: { fields, per_page: 50 },
      logTag: 'recordsDictionary',
    })

    return response?.data || []
  }

  // ──────────────────────────────────────────────
  // OAuth2 System Methods
  // ──────────────────────────────────────────────

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   *
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('scope', ZOHO_CRM_SCOPES)
    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('access_type', 'offline')
    // Zoho returns a refresh token only on the very first consent. Without prompt=consent a
    // reconnect yields no refresh token and the connection silently dies when the access token
    // expires, so force the consent screen on every connect.
    params.append('prompt', 'consent')

    const connectionURL = `${ this.#getOAuthBaseUrl() }/auth?${ params.toString() }`

    logger.debug(`OAuth2 Connection URL: ${ connectionURL }`)

    return connectionURL
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   * @property {String} token
   * @property {String} refreshToken
   * @property {Number} expirationInSeconds
   * @property {String} connectionIdentityName
   */

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   *
   * @param {Object} callbackObject
   *
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

    const tokenResponse = await Flowrunner.Request.post(`${ this.#getOAuthBaseUrl() }/token`)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    logger.debug(`executeCallback -> tokenResponse: ${ JSON.stringify(tokenResponse) }`)

    const apiDomain = tokenResponse.api_domain || `https://www.zohoapis.${ this.dataCenterDomain }`

    let connectionIdentityName = 'Zoho CRM Account'

    try {
      const userInfo = await Flowrunner.Request.get(`${ apiDomain }/crm/v7/users?type=CurrentUser`)
        .set({ 'Authorization': `Zoho-oauthtoken ${ tokenResponse.access_token }` })

      const currentUser = userInfo.users?.[0]

      if (currentUser) {
        connectionIdentityName = currentUser.full_name || currentUser.email || 'Zoho CRM Account'
      }
    } catch (e) {
      logger.warn('executeCallback - could not fetch user info:', e.message)
    }

    return {
      token: `${ tokenResponse.access_token }${ TOKEN_DOMAIN_DELIMITER }${ apiDomain }`,
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token,
      connectionIdentityName,
      overwrite: true,
    }
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   * @property {String} token
   * @property {Number} expirationInSeconds
   */

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   *
   * @param {String} refreshToken
   *
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    logger.debug('Refresh Token')

    const params = new URLSearchParams()

    params.append('grant_type', 'refresh_token')
    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)
    params.append('refresh_token', refreshToken)

    const response = await Flowrunner.Request.post(`${ this.#getOAuthBaseUrl() }/token`)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    // The refresh response carries its own api_domain; rely on it rather than the request
    // header, which is not guaranteed to be present during a refresh call.
    const apiDomain = response.api_domain || `https://www.zohoapis.${ this.dataCenterDomain }`

    return {
      token: `${ response.access_token }${ TOKEN_DOMAIN_DELIMITER }${ apiDomain }`,
      expirationInSeconds: response.expires_in,
    }
  }

  // ──────────────────────────────────────────────
  // Schema Loader Methods
  // ──────────────────────────────────────────────

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @paramDef {"type":"Object","label":"Payload","name":"payload","required":true,"description":"Contains the selected record type used to load the field schema."}
   * @returns {Array}
   */
  async createRecordFieldsSchemaLoader(payload) {
    const { moduleName } = payload?.criteria || {}

    if (!moduleName) {
      return []
    }

    const apiDomain = this.#getApiDomain()

    const fieldsResponse = await this.#apiRequest({
      url: `${ apiDomain }/crm/v7/settings/fields?module=${ moduleName }`,
      logTag: 'createRecordFieldsSchemaLoader',
    })

    const fields = fieldsResponse.fields || []

    return fields
      .filter(field => !field.read_only && field.api_name !== 'id')
      .map(field => ({
        type: this.#getParamTypeForZohoFieldType(field.data_type),
        label: field.display_label,
        name: field.api_name,
        required: field.system_mandatory || false,
        uiComponent: this.#getUiComponentForZohoFieldType(field.data_type, field),
        description: `${ this.#getFriendlyFieldTypeName(field.data_type) }${ field.tooltip ? '. ' + field.tooltip : '' }`,
      }))
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @paramDef {"type":"Object","label":"Payload","name":"payload","required":true,"description":"Contains the selected record type used to load the field schema."}
   * @returns {Array}
   */
  async updateRecordFieldsSchemaLoader(payload) {
    const { moduleName } = payload?.criteria || {}

    if (!moduleName) {
      return []
    }

    const apiDomain = this.#getApiDomain()

    const fieldsResponse = await this.#apiRequest({
      url: `${ apiDomain }/crm/v7/settings/fields?module=${ moduleName }`,
      logTag: 'updateRecordFieldsSchemaLoader',
    })

    const fields = fieldsResponse.fields || []

    return fields
      .filter(field => !field.read_only && field.api_name !== 'id')
      .map(field => ({
        type: this.#getParamTypeForZohoFieldType(field.data_type),
        label: field.display_label,
        name: field.api_name,
        required: false,
        uiComponent: this.#getUiComponentForZohoFieldType(field.data_type, field),
        description: `${ this.#getFriendlyFieldTypeName(field.data_type) }${ field.tooltip ? '. ' + field.tooltip : '' }`,
      }))
  }

  // ──────────────────────────────────────────────
  // Dictionary Methods
  // ──────────────────────────────────────────────

  /**
   * @registerAs DICTIONARY
   * @operationName Get Record Types
   * @description Lists the available Zoho CRM record types such as Leads, Contacts, Deals, Accounts, and any custom types.
   * @route POST /get-modules-dictionary
   *
   * @paramDef {"type":"getModulesDictionary__payload","label":"Payload","name":"payload","description":"Optional text to narrow down the list of record types."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Leads","value":"Leads","note":"Lead"}],"cursor":null}
   */
  async getModulesDictionary(payload) {
    const { search } = payload || {}
    const apiDomain = this.#getApiDomain()

    const response = await this.#apiRequest({
      url: `${ apiDomain }/crm/v7/settings/modules`,
      logTag: 'getModulesDictionary',
    })

    let modules = response.modules || []

    modules = modules.filter(m => m.api_supported && m.status === 'visible')

    if (search) {
      const searchLower = search.toLowerCase()

      modules = modules.filter(m =>
        m.plural_label?.toLowerCase().includes(searchLower) ||
        m.api_name?.toLowerCase().includes(searchLower)
      )
    }

    return {
      items: modules.map(m => ({
        label: m.plural_label,
        value: m.api_name,
        note: m.singular_label || '',
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Record Fields
   * @description Lists the available fields for a chosen record type, such as Name, Email, or Phone. Use this to pick which fields to include, search by, or sort by.
   * @route POST /get-module-fields-dictionary
   *
   * @paramDef {"type":"getModuleFieldsDictionary__payload","label":"Payload","name":"payload","description":"Specify the record type and optionally filter fields by name."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Last Name","value":"Last_Name","note":"Text"}],"cursor":null}
   */
  async getModuleFieldsDictionary(payload) {
    const { search, criteria } = payload || {}
    const moduleName = criteria?.moduleName

    if (!moduleName) {
      return { items: [], cursor: null }
    }

    const apiDomain = this.#getApiDomain()

    const fieldsResponse = await this.#apiRequest({
      url: `${ apiDomain }/crm/v7/settings/fields?module=${ moduleName }`,
      logTag: 'getModuleFieldsDictionary',
    })

    let fields = fieldsResponse.fields || []

    if (search) {
      const searchLower = search.toLowerCase()

      fields = fields.filter(f =>
        f.display_label?.toLowerCase().includes(searchLower) ||
        f.api_name?.toLowerCase().includes(searchLower)
      )
    }

    return {
      items: fields.map(f => ({
        label: f.display_label,
        value: f.api_name,
        note: this.#getFriendlyFieldTypeName(f.data_type),
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Users
   * @description Lists the active users in your Zoho CRM account. Use this to assign a record owner when creating or updating records.
   * @route POST /get-users-dictionary
   *
   * @paramDef {"type":"getUsersDictionary__payload","label":"Payload","name":"payload","description":"Optional text to narrow down the list of users."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"John Smith","value":"5000000012345","note":"john@example.com"}],"cursor":null}
   */
  async getUsersDictionary(payload) {
    const { search } = payload || {}
    const apiDomain = this.#getApiDomain()

    const response = await this.#apiRequest({
      url: `${ apiDomain }/crm/v7/users`,
      query: { type: 'ActiveUsers' },
      logTag: 'getUsersDictionary',
    })

    let users = response.users || []

    if (search) {
      const searchLower = search.toLowerCase()

      users = users.filter(u =>
        u.full_name?.toLowerCase().includes(searchLower) ||
        u.email?.toLowerCase().includes(searchLower)
      )
    }

    return {
      items: users.map(u => ({
        label: u.full_name,
        value: u.id,
        note: u.email,
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Related Record Types
   * @description Lists the record types that are related to a chosen record type. For example, Contacts related to an Account, or Deals related to a Lead.
   * @route POST /get-related-modules-dictionary
   *
   * @paramDef {"type":"getRelatedModulesDictionary__payload","label":"Payload","name":"payload","description":"Specify the record type and optionally filter related types by name."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Contacts","value":"Contacts","note":""}],"cursor":null}
   */
  async getRelatedModulesDictionary(payload) {
    const { search, criteria } = payload || {}
    const moduleName = criteria?.moduleName

    if (!moduleName) {
      return { items: [], cursor: null }
    }

    const apiDomain = this.#getApiDomain()

    const response = await this.#apiRequest({
      url: `${ apiDomain }/crm/v7/settings/related_lists?module=${ moduleName }`,
      logTag: 'getRelatedModulesDictionary',
    })

    let relatedLists = response.related_lists || []

    if (search) {
      const searchLower = search.toLowerCase()

      relatedLists = relatedLists.filter(r =>
        r.display_label?.toLowerCase().includes(searchLower) ||
        r.api_name?.toLowerCase().includes(searchLower)
      )
    }

    return {
      items: relatedLists.map(r => ({
        label: r.display_label,
        value: r.api_name,
        note: r.type || '',
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Select Tag
   * @description Lists the tags available for a chosen record type. Tags help categorize and organize your records in Zoho CRM.
   * @route POST /get-tags-dictionary
   *
   * @paramDef {"type":"getTagsDictionary__payload","label":"Payload","name":"payload","description":"Specify the record type and optionally filter tags by name."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Hot Lead","value":"Hot Lead","note":"#FF0000"}],"cursor":null}
   */
  async getTagsDictionary(payload) {
    const { search, criteria } = payload || {}
    const moduleName = criteria?.moduleName

    if (!moduleName) {
      return { items: [], cursor: null }
    }

    const apiDomain = this.#getApiDomain()

    const response = await this.#apiRequest({
      url: `${ apiDomain }/crm/v7/settings/tags?module=${ moduleName }`,
      logTag: 'getTagsDictionary',
    })

    let tags = response.tags || []

    if (search) {
      const searchLower = search.toLowerCase()

      tags = tags.filter(t =>
        t.name?.toLowerCase().includes(searchLower)
      )
    }

    return {
      items: tags.map(t => ({
        label: t.name,
        value: t.name,
        note: t.color_code || '',
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Select Record
   * @description Lists records of a chosen record type so you can pick one instead of pasting an ID. Search matches across the record's searchable fields.
   * @route POST /get-records-dictionary
   *
   * @paramDef {"type":"getRecordsDictionary__payload","label":"Payload","name":"payload","description":"Specify the record type and optionally filter records by keyword."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"John Smith","value":"5000000012345","note":"john@example.com"}],"cursor":null}
   */
  async getRecordsDictionary(payload) {
    const { search, criteria } = payload || {}
    const moduleName = criteria?.moduleName || criteria?.parentModule

    const records = await this.#listRecordsForDictionary(moduleName, search)

    return {
      items: records.map(r => ({
        label: this.#recordDisplayLabel(r),
        value: r.id,
        note: r.Email || r.email || '',
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Leads
   * @description Lists leads from Zoho CRM so you can pick the lead to convert instead of pasting an ID.
   * @route POST /get-leads-dictionary
   *
   * @paramDef {"type":"getLeadsDictionary__payload","label":"Payload","name":"payload","description":"Optional text to filter leads by keyword."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"John Smith","value":"5000000012345","note":"john@example.com"}],"cursor":null}
   */
  async getLeadsDictionary(payload) {
    const { search } = payload || {}

    const records = await this.#listRecordsForDictionary('Leads', search)

    return {
      items: records.map(r => ({
        label: this.#recordDisplayLabel(r),
        value: r.id,
        note: r.Email || r.Company || '',
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Accounts
   * @description Lists accounts from Zoho CRM so you can pick an existing account instead of pasting an ID.
   * @route POST /get-accounts-dictionary
   *
   * @paramDef {"type":"getAccountsDictionary__payload","label":"Payload","name":"payload","description":"Optional text to filter accounts by keyword."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Acme Corp","value":"5000000054323","note":"www.acme.com"}],"cursor":null}
   */
  async getAccountsDictionary(payload) {
    const { search } = payload || {}

    const records = await this.#listRecordsForDictionary('Accounts', search)

    return {
      items: records.map(r => ({
        label: this.#recordDisplayLabel(r),
        value: r.id,
        note: r.Website || r.Phone || '',
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Notes
   * @description Lists notes from Zoho CRM (most recent first) so you can pick one instead of pasting an ID.
   * @route POST /get-notes-dictionary
   *
   * @paramDef {"type":"getNotesDictionary__payload","label":"Payload","name":"payload","description":"Optional text to filter notes by title or content."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Follow-up","value":"5000000067890","note":"Called the customer regarding proposal."}],"cursor":null}
   */
  async getNotesDictionary(payload) {
    const { search } = payload || {}
    const apiDomain = this.#getApiDomain()

    const response = await this.#apiRequest({
      url: `${ apiDomain }/crm/v7/Notes`,
      query: { fields: 'Note_Title,Note_Content', per_page: 100 },
      logTag: 'getNotesDictionary',
    })

    let notes = response?.data || []

    if (search) {
      const searchLower = search.toLowerCase()

      notes = notes.filter(n =>
        n.Note_Title?.toLowerCase().includes(searchLower) ||
        n.Note_Content?.toLowerCase().includes(searchLower)
      )
    }

    return {
      items: notes.map(n => ({
        label: n.Note_Title || (n.Note_Content ? n.Note_Content.slice(0, 50) : n.id),
        value: n.id,
        note: n.Note_Content ? n.Note_Content.slice(0, 60) : '',
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Select Related Record
   * @description Lists the records related to a parent record so you can pick one instead of pasting an ID.
   * @route POST /get-related-records-dictionary
   *
   * @paramDef {"type":"getRelatedRecordsDictionary__payload","label":"Payload","name":"payload","description":"Specify the parent record type, parent record ID, and related record type."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Jane Doe","value":"5000000012345","note":"jane@example.com"}],"cursor":null}
   */
  async getRelatedRecordsDictionary(payload) {
    const { search, criteria } = payload || {}
    const { moduleName, recordId, relatedModule } = criteria || {}

    if (!moduleName || !recordId || !relatedModule) {
      return { items: [], cursor: null }
    }

    const apiDomain = this.#getApiDomain()
    const fields = await this.#resolveFields(relatedModule)

    const response = await this.#apiRequest({
      url: `${ apiDomain }/crm/v7/${ moduleName }/${ recordId }/${ relatedModule }`,
      query: { fields, per_page: 50 },
      logTag: 'getRelatedRecordsDictionary',
    })

    let records = response?.data || []

    if (search) {
      const searchLower = search.toLowerCase()

      records = records.filter(r =>
        String(this.#recordDisplayLabel(r)).toLowerCase().includes(searchLower)
      )
    }

    return {
      items: records.map(r => ({
        label: this.#recordDisplayLabel(r),
        value: r.id,
        note: r.Email || r.email || '',
      })),
      cursor: null,
    }
  }

  // ──────────────────────────────────────────────
  // Record CRUD Methods
  // ──────────────────────────────────────────────

  /**
   * @description Retrieves a list of records from Zoho CRM. You can choose which record type to pull from, which fields to include, and how to sort the results.
   *
   * @route POST /get-records
   * @operationName Get Records
   * @category Records
   *
   * @appearanceColor #D32F2F #E53935
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Record Type","name":"moduleName","required":true,"dictionary":"getModulesDictionary","description":"The type of record to retrieve (e.g., Leads, Contacts, Deals)."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"The fields to include in the results, separated by commas (e.g., Full_Name, Email, Phone). Leave empty to include all fields."}
   * @paramDef {"type":"Number","label":"Results Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many records to return at once (maximum 200). Defaults to 200."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Which page of results to return. Starts at 1."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","dictionary":"getModuleFieldsDictionary","dependsOn":["moduleName"],"description":"The field to sort results by."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction: ascending (oldest/smallest first) or descending (newest/largest first)."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"5000000012345","Full_Name":"John Smith","Email":"john@example.com"}],"info":{"per_page":200,"count":1,"page":1,"more_records":false}}
   */
  async getRecords(moduleName, fields, perPage, page, sortBy, sortOrder) {
    const apiDomain = this.#getApiDomain()
    const resolvedFields = await this.#resolveFields(moduleName, fields)

    const response = await this.#apiRequest({
      url: `${ apiDomain }/crm/v7/${ moduleName }`,
      query: {
        fields: resolvedFields,
        per_page: perPage,
        page,
        sort_by: sortBy,
        sort_order: this.#resolveChoice(sortOrder, { Ascending: 'asc', Descending: 'desc' }),
      },
      logTag: 'getRecords',
    })

    return response || { data: [] }
  }

  /**
   * @description Retrieves a single record from Zoho CRM using its record ID. Returns all available fields for that record.
   *
   * @route POST /get-record-by-id
   * @operationName Get Single Record
   * @category Records
   *
   * @appearanceColor #D32F2F #E53935
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Record Type","name":"moduleName","required":true,"dictionary":"getModulesDictionary","description":"The type of record to look up (e.g., Leads, Contacts, Deals)."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"dictionary":"getRecordsDictionary","dependsOn":["moduleName"],"description":"The record to retrieve. Pick the record type first, then choose a record."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"5000000012345","Full_Name":"John Smith","Email":"john@example.com","Company":"Acme Corp"}]}
   */
  async getRecordById(moduleName, recordId) {
    const apiDomain = this.#getApiDomain()

    return await this.#apiRequest({
      url: `${ apiDomain }/crm/v7/${ moduleName }/${ recordId }`,
      logTag: 'getRecordById',
    })
  }

  /**
   * @description Creates a new record in Zoho CRM. The available fields depend on the record type you choose. Some fields may be required (for example, Last Name for Contacts, or Deal Name for Deals).
   *
   * @route POST /create-record
   * @operationName Create Record
   * @category Records
   *
   * @appearanceColor #D32F2F #E53935
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Record Type","name":"moduleName","required":true,"dictionary":"getModulesDictionary","description":"The type of record to create (e.g., Leads, Contacts, Deals)."}
   * @paramDef {"type":"Object","label":"Record Fields","name":"fields","required":true,"schemaLoader":"createRecordFieldsSchemaLoader","dependsOn":["moduleName"],"description":"The values for the new record. The available fields update automatically based on the record type you selected."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"5000000012345","Modified_Time":"2024-01-15T10:30:00+00:00","Created_Time":"2024-01-15T10:30:00+00:00"},"message":"record added","status":"success"}]}
   */
  async createRecord(moduleName, fields) {
    const apiDomain = this.#getApiDomain()

    return await this.#apiRequest({
      url: `${ apiDomain }/crm/v7/${ moduleName }`,
      method: 'post',
      body: { data: [fields || {}] },
      logTag: 'createRecord',
    })
  }

  /**
   * @description Updates an existing record in any Zoho CRM module. Only the specified fields are updated; unspecified fields remain unchanged.
   *
   * @route POST /update-record
   * @operationName Update Record
   * @category Records
   *
   * @appearanceColor #D32F2F #E53935
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Record Type","name":"moduleName","required":true,"dictionary":"getModulesDictionary","description":"The type of record to update (e.g., Leads, Contacts, Deals)."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"dictionary":"getRecordsDictionary","dependsOn":["moduleName"],"description":"The record to update. Pick the record type first, then choose a record."}
   * @paramDef {"type":"Object","label":"Record Fields","name":"fields","required":true,"schemaLoader":"updateRecordFieldsSchemaLoader","dependsOn":["moduleName"],"description":"The field values to change. Only the fields you fill in will be updated. The available fields update automatically based on the record type you selected."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"5000000012345","Modified_Time":"2024-01-15T11:00:00+00:00"},"message":"record updated","status":"success"}]}
   */
  async updateRecord(moduleName, recordId, fields) {
    const apiDomain = this.#getApiDomain()

    return await this.#apiRequest({
      url: `${ apiDomain }/crm/v7/${ moduleName }`,
      method: 'put',
      body: { data: [{ id: recordId, ...(fields || {}) }] },
      logTag: 'updateRecord',
    })
  }

  /**
   * @description Creates a new record, or updates an existing one if a match is found. Use this to avoid creating duplicates, for example when importing data from another system.
   *
   * @route POST /upsert-record
   * @operationName Create or Update Record
   * @category Records
   *
   * @appearanceColor #D32F2F #E53935
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Record Type","name":"moduleName","required":true,"dictionary":"getModulesDictionary","description":"The type of record to create or update (e.g., Leads, Contacts, Deals)."}
   * @paramDef {"type":"String","label":"Match By Fields","name":"duplicateCheckFields","required":true,"description":"The fields used to find an existing match, separated by commas (e.g., Email or Email,Last_Name). If a record with matching values exists, it will be updated instead of creating a new one."}
   * @paramDef {"type":"Object","label":"Record Fields","name":"fields","required":true,"schemaLoader":"createRecordFieldsSchemaLoader","dependsOn":["moduleName"],"description":"The values for the record. If an existing match is found, those values will be updated. Otherwise, a new record is created."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","duplicate_field":"Email","action":"update","details":{"id":"5000000012345","Modified_Time":"2024-01-15T11:30:00+00:00"},"message":"record updated","status":"success"}]}
   */
  async upsertRecord(moduleName, duplicateCheckFields, fields) {
    const apiDomain = this.#getApiDomain()

    const dupFields = duplicateCheckFields
      ? duplicateCheckFields.split(',').map(f => f.trim())
      : []

    return await this.#apiRequest({
      url: `${ apiDomain }/crm/v7/${ moduleName }/upsert`,
      method: 'post',
      body: {
        data: [fields || {}],
        duplicate_check_fields: dupFields,
      },
      logTag: 'upsertRecord',
    })
  }

  /**
   * @description Permanently deletes a record from any Zoho CRM module by its unique ID. This action cannot be undone.
   *
   * @route POST /delete-record
   * @operationName Delete Record
   * @category Records
   *
   * @appearanceColor #D32F2F #E53935
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Record Type","name":"moduleName","required":true,"dictionary":"getModulesDictionary","description":"The type of record to delete from (e.g., Leads, Contacts, Deals)."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"dictionary":"getRecordsDictionary","dependsOn":["moduleName"],"description":"The record to delete. Pick the record type first, then choose a record."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"5000000012345"},"message":"record deleted","status":"success"}]}
   */
  async deleteRecord(moduleName, recordId) {
    const apiDomain = this.#getApiDomain()

    return await this.#apiRequest({
      url: `${ apiDomain }/crm/v7/${ moduleName }/${ recordId }`,
      method: 'delete',
      logTag: 'deleteRecord',
    })
  }

  /**
   * @description Searches for records in Zoho CRM by specific conditions, email, phone, or keyword. You can combine multiple conditions using "and" or "or" to narrow down results.
   *
   * @route POST /search-records
   * @operationName Search Records
   * @category Records
   *
   * @appearanceColor #D32F2F #E53935
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Record Type","name":"moduleName","required":true,"dictionary":"getModulesDictionary","description":"The type of record to search (e.g., Leads, Contacts, Deals)."}
   * @paramDef {"type":"String","label":"Criteria","name":"criteria","description":"A search condition to filter records. Example: ((Last_Name:equals:Smith)and(Company:equals:Acme)). Use equals, starts_with, or contains between the field name and value."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Search by email address."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Search by phone number."}
   * @paramDef {"type":"String","label":"Keyword","name":"word","description":"Search for this keyword across all searchable fields in the record."}
   * @paramDef {"type":"Number","label":"Results Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many records to return at once (maximum 200). Defaults to 200."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Which page of results to return. Starts at 1."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"5000000012345","Full_Name":"John Smith","Email":"john@example.com"}],"info":{"per_page":200,"count":1,"page":1,"more_records":false}}
   */
  async searchRecords(moduleName, criteria, email, phone, word, perPage, page) {
    if (!criteria && !email && !phone && !word) {
      throw new Error('Provide at least one of Criteria, Email, Phone, or Keyword to search.')
    }

    const apiDomain = this.#getApiDomain()

    const response = await this.#apiRequest({
      url: `${ apiDomain }/crm/v7/${ moduleName }/search`,
      query: {
        criteria,
        email,
        phone,
        word,
        per_page: perPage,
        page,
      },
      logTag: 'searchRecords',
    })

    return response || { data: [] }
  }

  // ──────────────────────────────────────────────
  // Notes Methods
  // ──────────────────────────────────────────────

  /**
   * @description Retrieves a specific note by its unique ID from Zoho CRM. Returns the note title, content, and parent record information.
   *
   * @route POST /get-note
   * @operationName Get Note
   * @category Notes
   *
   * @appearanceColor #D32F2F #E53935
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Note ID","name":"noteId","required":true,"dictionary":"getNotesDictionary","description":"The note to retrieve. Pick from the list of recent notes, or paste an ID."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"5000000067890","Note_Title":"Follow-up","Note_Content":"Called the customer regarding proposal.","Created_Time":"2024-01-15T10:30:00+00:00"}]}
   */
  async getNote(noteId) {
    const apiDomain = this.#getApiDomain()

    return await this.#apiRequest({
      url: `${ apiDomain }/crm/v7/Notes/${ noteId }`,
      logTag: 'getNote',
    })
  }

  /**
   * @description Creates a new note linked to a record in any Zoho CRM module. Notes can be used to add comments, follow-up reminders, or additional context to leads, contacts, deals, and other records.
   *
   * @route POST /create-note
   * @operationName Create Note
   * @category Notes
   *
   * @appearanceColor #D32F2F #E53935
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Record Type","name":"parentModule","required":true,"dictionary":"getModulesDictionary","description":"The type of record to attach the note to (e.g., Leads, Contacts, Deals)."}
   * @paramDef {"type":"String","label":"Record ID","name":"parentRecordId","required":true,"dictionary":"getRecordsDictionary","dependsOn":["parentModule"],"description":"The record to attach this note to. Pick the record type first, then choose a record."}
   * @paramDef {"type":"String","label":"Note Title","name":"noteTitle","required":true,"description":"Title of the note."}
   * @paramDef {"type":"String","label":"Note Content","name":"noteContent","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Body content of the note."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"5000000067890","Modified_Time":"2024-01-15T10:30:00+00:00","Created_Time":"2024-01-15T10:30:00+00:00"},"message":"record added","status":"success"}]}
   */
  async createNote(parentModule, parentRecordId, noteTitle, noteContent) {
    const apiDomain = this.#getApiDomain()

    return await this.#apiRequest({
      url: `${ apiDomain }/crm/v7/Notes`,
      method: 'post',
      body: {
        data: [{
          Note_Title: noteTitle,
          Note_Content: noteContent,
          Parent_Id: {
            module: { api_name: parentModule },
            id: parentRecordId,
          },
        }],
      },
      logTag: 'createNote',
    })
  }

  /**
   * @description Updates the title or content of an existing note in Zoho CRM. Only the specified fields are modified.
   *
   * @route POST /update-note
   * @operationName Update Note
   * @category Notes
   *
   * @appearanceColor #D32F2F #E53935
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Note ID","name":"noteId","required":true,"dictionary":"getNotesDictionary","description":"The note to update. Pick from the list of recent notes, or paste an ID."}
   * @paramDef {"type":"String","label":"Note Title","name":"noteTitle","description":"Updated title for the note. Leave empty to keep the current title."}
   * @paramDef {"type":"String","label":"Note Content","name":"noteContent","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated body content for the note. Leave empty to keep the current content."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"5000000067890","Modified_Time":"2024-01-15T11:00:00+00:00"},"message":"record updated","status":"success"}]}
   */
  async updateNote(noteId, noteTitle, noteContent) {
    const apiDomain = this.#getApiDomain()

    const noteData = { id: noteId }

    if (noteTitle) {
      noteData.Note_Title = noteTitle
    }

    if (noteContent) {
      noteData.Note_Content = noteContent
    }

    return await this.#apiRequest({
      url: `${ apiDomain }/crm/v7/Notes`,
      method: 'put',
      body: { data: [noteData] },
      logTag: 'updateNote',
    })
  }

  /**
   * @description Permanently deletes a note from Zoho CRM by its unique ID. This action cannot be undone.
   *
   * @route POST /delete-note
   * @operationName Delete Note
   * @category Notes
   *
   * @appearanceColor #D32F2F #E53935
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Note ID","name":"noteId","required":true,"dictionary":"getNotesDictionary","description":"The note to delete. Pick from the list of recent notes, or paste an ID."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"5000000067890"},"message":"record deleted","status":"success"}]}
   */
  async deleteNote(noteId) {
    const apiDomain = this.#getApiDomain()

    return await this.#apiRequest({
      url: `${ apiDomain }/crm/v7/Notes/${ noteId }`,
      method: 'delete',
      logTag: 'deleteNote',
    })
  }

  // ──────────────────────────────────────────────
  // Related Records Methods
  // ──────────────────────────────────────────────

  /**
   * @description Retrieves the records related to a specific record in Zoho CRM. For example, get all Contacts associated with an Account, or all Notes linked to a Deal.
   *
   * @route POST /get-related-records
   * @operationName Get Related Records
   * @category Related Records
   *
   * @appearanceColor #D32F2F #E53935
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Record Type","name":"moduleName","required":true,"dictionary":"getModulesDictionary","description":"The type of the parent record (e.g., Accounts, Deals)."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"dictionary":"getRecordsDictionary","dependsOn":["moduleName"],"description":"The parent record whose related records you want to retrieve. Pick the record type first, then choose a record."}
   * @paramDef {"type":"String","label":"Related Record Type","name":"relatedModule","required":true,"dictionary":"getRelatedModulesDictionary","dependsOn":["moduleName"],"description":"The type of related records to retrieve (e.g., Contacts, Notes, Deals)."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"The fields to include in the results, separated by commas. Leave empty to include all fields of the related record type."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"id":"5000000012345","Full_Name":"Jane Doe","Email":"jane@example.com"}],"info":{"per_page":200,"count":1,"page":1,"more_records":false}}
   */
  async getRelatedRecords(moduleName, recordId, relatedModule, fields) {
    const apiDomain = this.#getApiDomain()
    const resolvedFields = await this.#resolveFields(relatedModule, fields)

    const response = await this.#apiRequest({
      url: `${ apiDomain }/crm/v7/${ moduleName }/${ recordId }/${ relatedModule }`,
      query: { fields: resolvedFields },
      logTag: 'getRelatedRecords',
    })

    return response || { data: [] }
  }

  /**
   * @description Updates the association data for a record in a many-to-many related list, for example a contact's member status in a Campaign or a product's row in a Price Book. This works for multi-association related lists (Campaigns, Products, Price Books, and similar), not lookup relationships like Contacts under an Account.
   *
   * @route POST /update-related-record
   * @operationName Update Related Record
   * @category Related Records
   *
   * @appearanceColor #D32F2F #E53935
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Record Type","name":"moduleName","required":true,"dictionary":"getModulesDictionary","description":"The type of the parent record (e.g., Campaigns, Accounts, Deals)."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"dictionary":"getRecordsDictionary","dependsOn":["moduleName"],"description":"The parent record. Pick the record type first, then choose a record."}
   * @paramDef {"type":"String","label":"Related List","name":"relatedModule","required":true,"dictionary":"getRelatedModulesDictionary","dependsOn":["moduleName"],"description":"The multi-association related list to update (e.g., Contacts on a Campaign, or Price_Books on a Product)."}
   * @paramDef {"type":"String","label":"Related Record ID","name":"relatedRecordId","required":true,"dictionary":"getRelatedRecordsDictionary","dependsOn":["moduleName","recordId","relatedModule"],"description":"The related record whose association you want to update. Choose the parent record and related list first, then pick a record."}
   * @paramDef {"type":"String","label":"Association Fields JSON","name":"fieldsJson","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The association (junction) fields to update as a JSON object, for example {\"Member_Status\":\"Contacted\"}. These are the fields the related list exposes, not the related record's own fields."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"5000000012345","Modified_Time":"2024-03-20T11:00:00+00:00"},"message":"record updated","status":"success"}]}
   */
  async updateRelatedRecord(moduleName, recordId, relatedModule, relatedRecordId, fieldsJson) {
    const apiDomain = this.#getApiDomain()

    let fields = {}

    try {
      fields = typeof fieldsJson === 'string' ? JSON.parse(fieldsJson) : fieldsJson || {}
    } catch (e) {
      throw new Error('The Fields JSON value is not valid JSON. Please provide a valid JSON object, for example: {"Member_Status":"Contacted"}')
    }

    return await this.#apiRequest({
      url: `${ apiDomain }/crm/v7/${ moduleName }/${ recordId }/${ relatedModule }/${ relatedRecordId }`,
      method: 'put',
      body: { data: [{ ...fields, id: relatedRecordId }] },
      logTag: 'updateRelatedRecord',
    })
  }

  /**
   * @description Removes records from a many-to-many related list, for example removing contacts from a Campaign or products from a Price Book. The records themselves are not deleted, only their association with the parent is removed. This works for multi-association related lists (Campaigns, Products, Price Books, and similar), not lookup relationships like Contacts under an Account.
   *
   * @route POST /unlink-related-records
   * @operationName Unlink Related Records
   * @category Related Records
   *
   * @appearanceColor #D32F2F #E53935
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Record Type","name":"moduleName","required":true,"dictionary":"getModulesDictionary","description":"The type of the parent record (e.g., Campaigns, Accounts, Deals)."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"dictionary":"getRecordsDictionary","dependsOn":["moduleName"],"description":"The parent record. Pick the record type first, then choose a record."}
   * @paramDef {"type":"String","label":"Related List","name":"relatedModule","required":true,"dictionary":"getRelatedModulesDictionary","dependsOn":["moduleName"],"description":"The multi-association related list to remove records from (e.g., Contacts on a Campaign, or Price_Books on a Product)."}
   * @paramDef {"type":"String","label":"Related Record IDs","name":"relatedRecordIds","required":true,"description":"The IDs of the related records to remove from the list, separated by commas (maximum 100)."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"5000000012345"},"message":"relation removed","status":"success"}]}
   */
  async unlinkRelatedRecords(moduleName, recordId, relatedModule, relatedRecordIds) {
    const apiDomain = this.#getApiDomain()

    return await this.#apiRequest({
      url: `${ apiDomain }/crm/v7/${ moduleName }/${ recordId }/${ relatedModule }`,
      method: 'delete',
      query: { ids: relatedRecordIds },
      logTag: 'unlinkRelatedRecords',
    })
  }

  // ──────────────────────────────────────────────
  // Lead Conversion Methods
  // ──────────────────────────────────────────────

  /**
   * @description Converts a lead into a contact, and optionally creates or links an account and a deal. This is the standard Zoho CRM lead conversion process.
   *
   * @route POST /convert-lead
   * @operationName Convert Lead
   * @category Lead Conversion
   *
   * @appearanceColor #D32F2F #E53935
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Lead","name":"leadId","required":true,"dictionary":"getLeadsDictionary","description":"The lead to convert. Pick from the list, or paste a lead ID."}
   * @paramDef {"type":"Boolean","label":"Overwrite Existing Data","name":"overwrite","uiComponent":{"type":"TOGGLE"},"description":"Whether to overwrite existing account and contact data with the lead's data during conversion."}
   * @paramDef {"type":"Boolean","label":"Notify Lead Owner","name":"notifyLeadOwner","uiComponent":{"type":"TOGGLE"},"description":"Whether to send a notification to the lead owner about the conversion."}
   * @paramDef {"type":"Boolean","label":"Notify New Record Owner","name":"notifyNewEntityOwner","uiComponent":{"type":"TOGGLE"},"description":"Whether to send a notification to the owner of the newly created contact, account, or deal."}
   * @paramDef {"type":"String","label":"Existing Account","name":"accountId","dictionary":"getAccountsDictionary","description":"An existing account to link. Leave empty to create a new account from the lead."}
   * @paramDef {"type":"String","label":"Deal Name","name":"dealName","description":"Name for the deal to create during conversion. Leave empty to skip deal creation."}
   * @paramDef {"type":"String","label":"Closing Date","name":"closingDate","description":"Expected closing date for the deal in YYYY-MM-DD format (e.g., 2024-06-30)."}
   * @paramDef {"type":"String","label":"Deal Stage","name":"stage","description":"The sales stage for the new deal (e.g., Qualification, Needs Analysis, Proposal)."}
   * @paramDef {"type":"String","label":"Pipeline","name":"pipeline","description":"The pipeline for the new deal. Required when creating a deal if your org has multiple pipelines."}
   * @paramDef {"type":"Number","label":"Deal Amount","name":"amount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The monetary value of the deal."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"Contacts":{"name":"John Smith","id":"5000000054321"},"Deals":{"name":"Acme Renewal","id":"5000000054322"},"Accounts":{"name":"Acme Corp","id":"5000000054323"}},"message":"The record has been converted successfully","status":"success"}]}
   */
  async convertLead(leadId, overwrite, notifyLeadOwner, notifyNewEntityOwner, accountId, dealName, closingDate, stage, pipeline, amount) {
    const apiDomain = this.#getApiDomain()

    const conversionData = {}

    if (overwrite !== undefined && overwrite !== null) {
      conversionData.overwrite = overwrite
    }

    if (notifyLeadOwner !== undefined && notifyLeadOwner !== null) {
      conversionData.notify_lead_owner = notifyLeadOwner
    }

    if (notifyNewEntityOwner !== undefined && notifyNewEntityOwner !== null) {
      conversionData.notify_new_entity_owner = notifyNewEntityOwner
    }

    if (accountId) {
      conversionData.Accounts = { id: accountId }
    }

    const dealFields = cleanupObject({
      Deal_Name: dealName,
      Closing_Date: closingDate,
      Stage: stage,
      Pipeline: pipeline,
      Amount: amount,
    })

    if (dealFields) {
      conversionData.Deals = dealFields
    }

    return await this.#apiRequest({
      url: `${ apiDomain }/crm/v7/Leads/${ leadId }/actions/convert`,
      method: 'post',
      body: { data: [conversionData] },
      logTag: 'convertLead',
    })
  }

  // ──────────────────────────────────────────────
  // Tags Methods
  // ──────────────────────────────────────────────

  /**
   * @description Retrieves all tags available for a specific record type in Zoho CRM. Returns the tag name, color, and creation details.
   *
   * @route POST /get-tags
   * @operationName Get Tags
   * @category Tags
   *
   * @appearanceColor #D32F2F #E53935
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Record Type","name":"moduleName","required":true,"dictionary":"getModulesDictionary","description":"The type of record to get tags for (e.g., Leads, Contacts, Deals)."}
   *
   * @returns {Object}
   * @sampleResult {"tags":[{"id":"5000000000123","name":"Hot Lead","color_code":"#FF0000","created_time":"2024-01-15T10:30:00+00:00"}]}
   */
  async getTags(moduleName) {
    const apiDomain = this.#getApiDomain()

    return await this.#apiRequest({
      url: `${ apiDomain }/crm/v7/settings/tags?module=${ moduleName }`,
      logTag: 'getTags',
    })
  }

  /**
   * @description Adds one or more tags to one or more records in Zoho CRM. Tags help categorize records for filtering, segmentation, and reporting.
   *
   * @route POST /add-tags-to-records
   * @operationName Add Tags to Records
   * @category Tags
   *
   * @appearanceColor #D32F2F #E53935
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Record Type","name":"moduleName","required":true,"dictionary":"getModulesDictionary","description":"The type of record to tag (e.g., Leads, Contacts, Deals)."}
   * @paramDef {"type":"String","label":"Record IDs","name":"recordIds","required":true,"description":"The IDs of the records to tag, separated by commas."}
   * @paramDef {"type":"String","label":"Tag Names","name":"tagNames","required":true,"description":"The names of the tags to add, separated by commas (e.g., Hot Lead, Priority, Follow Up)."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"5000000012345","tags":["Hot Lead"]},"message":"tags added","status":"success"}]}
   */
  async addTagsToRecords(moduleName, recordIds, tagNames) {
    const apiDomain = this.#getApiDomain()

    const tags = tagNames.split(',').map(t => ({ name: t.trim() }))
    const ids = recordIds.split(',').map(id => id.trim())

    return await this.#apiRequest({
      url: `${ apiDomain }/crm/v7/${ moduleName }/actions/add_tags`,
      method: 'post',
      body: { tags, ids },
      logTag: 'addTagsToRecords',
    })
  }

  /**
   * @description Removes one or more tags from one or more records in Zoho CRM. The tags themselves are not deleted; they are only removed from the specified records.
   *
   * @route POST /remove-tags-from-records
   * @operationName Remove Tags from Records
   * @category Tags
   *
   * @appearanceColor #D32F2F #E53935
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Record Type","name":"moduleName","required":true,"dictionary":"getModulesDictionary","description":"The type of record to remove tags from (e.g., Leads, Contacts, Deals)."}
   * @paramDef {"type":"String","label":"Record IDs","name":"recordIds","required":true,"description":"The IDs of the records to remove tags from, separated by commas."}
   * @paramDef {"type":"String","label":"Tag Names","name":"tagNames","required":true,"description":"The names of the tags to remove, separated by commas (e.g., Hot Lead, Priority)."}
   *
   * @returns {Object}
   * @sampleResult {"data":[{"code":"SUCCESS","details":{"id":"5000000012345"},"message":"tags removed","status":"success"}]}
   */
  async removeTagsFromRecords(moduleName, recordIds, tagNames) {
    const apiDomain = this.#getApiDomain()

    const tags = tagNames.split(',').map(t => ({ name: t.trim() }))
    const ids = recordIds.split(',').map(id => id.trim())

    return await this.#apiRequest({
      url: `${ apiDomain }/crm/v7/${ moduleName }/actions/remove_tags`,
      method: 'post',
      body: { tags, ids },
      logTag: 'removeTagsFromRecords',
    })
  }

  /**
   * @description Creates a new tag for a specific record type in Zoho CRM. Once created, the tag can be added to any record of that type.
   *
   * @route POST /create-tag
   * @operationName Create Tag
   * @category Tags
   *
   * @appearanceColor #D32F2F #E53935
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Record Type","name":"moduleName","required":true,"dictionary":"getModulesDictionary","description":"The type of record this tag will be available for (e.g., Leads, Contacts, Deals)."}
   * @paramDef {"type":"String","label":"Tag Name","name":"tagName","required":true,"description":"The name for the new tag."}
   *
   * @returns {Object}
   * @sampleResult {"tags":[{"id":"5000000000456","name":"VIP Customer","created_time":"2024-02-20T14:00:00+00:00"}]}
   */
  async createTag(moduleName, tagName) {
    const apiDomain = this.#getApiDomain()

    return await this.#apiRequest({
      url: `${ apiDomain }/crm/v7/settings/tags?module=${ moduleName }`,
      method: 'post',
      body: { tags: [{ name: tagName }] },
      logTag: 'createTag',
    })
  }
}

Flowrunner.ServerCode.addService(ZohoCRMService, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your Client ID from the Zoho API Console at api-console.zoho.com.',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your Client Secret from the Zoho API Console.',
  },
  {
    name: 'dataCenterDomain',
    displayName: 'Region',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    options: ['com', 'eu', 'in', 'com.au', 'jp', 'ca', 'sa'],
    defaultValue: 'com',
    required: true,
    shared: false,
    hint: 'Your Zoho account region: com (US), eu (Europe), in (India), com.au (Australia), jp (Japan), ca (Canada), sa (Saudi Arabia).',
  },
])

/**
 * @typedef {Object} getModulesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Type to search for a specific record type by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for loading more results."}
 */

/**
 * @typedef {Object} getModuleFieldsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Record Type","name":"moduleName","required":true,"description":"The record type whose fields you want to see."}
 */

/**
 * @typedef {Object} getModuleFieldsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Type to search for a specific field by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for loading more results."}
 * @paramDef {"type":"getModuleFieldsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"The record type to load fields for."}
 */

/**
 * @typedef {Object} getUsersDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Type to search for a user by name or email."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for loading more results."}
 */

/**
 * @typedef {Object} getRelatedModulesDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Record Type","name":"moduleName","required":true,"description":"The record type whose related types you want to see."}
 */

/**
 * @typedef {Object} getRelatedModulesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Type to search for a specific related type by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for loading more results."}
 * @paramDef {"type":"getRelatedModulesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"The record type to load related types for."}
 */

/**
 * @typedef {Object} getTagsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Record Type","name":"moduleName","required":true,"description":"The record type whose tags you want to see."}
 */

/**
 * @typedef {Object} getTagsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Type to search for a specific tag by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for loading more results."}
 * @paramDef {"type":"getTagsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"The record type to load tags for."}
 */

/**
 * @typedef {Object} getRecordsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Record Type","name":"moduleName","description":"The record type whose records you want to list."}
 * @paramDef {"type":"String","label":"Record Type","name":"parentModule","description":"The record type whose records you want to list (used when attaching a note)."}
 */

/**
 * @typedef {Object} getRecordsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Type to search for a record by keyword."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for loading more results."}
 * @paramDef {"type":"getRecordsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"The record type to load records for."}
 */

/**
 * @typedef {Object} getLeadsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Type to search for a lead by keyword."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for loading more results."}
 */

/**
 * @typedef {Object} getAccountsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Type to search for an account by keyword."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for loading more results."}
 */

/**
 * @typedef {Object} getNotesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Type to search for a note by title or content."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for loading more results."}
 */

/**
 * @typedef {Object} getRelatedRecordsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Record Type","name":"moduleName","required":true,"description":"The parent record type."}
 * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"description":"The parent record ID."}
 * @paramDef {"type":"String","label":"Related Record Type","name":"relatedModule","required":true,"description":"The related record type to list."}
 */

/**
 * @typedef {Object} getRelatedRecordsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Type to search for a related record by keyword."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for loading more results."}
 * @paramDef {"type":"getRelatedRecordsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"The parent record and related type to load related records for."}
 */
