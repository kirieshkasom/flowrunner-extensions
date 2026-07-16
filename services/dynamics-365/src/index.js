const OAUTH_BASE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const API_VERSION = 'v9.2'

const ENTITY_SET_MAPPING = {
  'Accounts': 'accounts',
  'Contacts': 'contacts',
  'Leads': 'leads',
  'Opportunities': 'opportunities',
  'Cases (Incidents)': 'incidents',
  'Tasks': 'tasks',
}

const logger = {
  info: (...args) => console.log('[Microsoft Dynamics 365] info:', ...args),
  debug: (...args) => console.log('[Microsoft Dynamics 365] debug:', ...args),
  error: (...args) => console.log('[Microsoft Dynamics 365] error:', ...args),
  warn: (...args) => console.log('[Microsoft Dynamics 365] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName Microsoft Dynamics 365
 * @integrationIcon /icon.png
 **/
class MicrosoftDynamics365Service {
  /**
   * @typedef {Object} getEntitySetsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter tables by display name or entity set name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Dataverse metadata queries return all results at once, so this value is not used."}
   */
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.orgUrl = (config.orgUrl || '').trim().replace(/\/+$/, '')
  }

  get #apiBaseUrl() {
    return `${ this.orgUrl }/api/data/${ API_VERSION }`
  }

  #getDefaultHeaders(extraHeaders) {
    return {
      'Authorization': `Bearer ${ this.request.headers['oauth-access-token'] }`,
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...(extraHeaders || {}),
    }
  }

  async #apiRequest({ url, method, body, query, headers, logTag }) {
    method = method || 'get'
    query = cleanupObject(query)

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      const request = Flowrunner.Request[method](url).set(this.#getDefaultHeaders(headers)).query(query || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.error?.message || error.message

      logger.error(`${ logTag } - error: ${ message }`)

      throw new Error(`Microsoft Dynamics 365 API error: ${ message }`)
    }
  }

  #resolveEntitySet(entitySet, customEntitySet) {
    const custom = (customEntitySet || '').trim()

    if (custom) {
      return custom
    }

    const resolved = this.#resolveChoice(entitySet, ENTITY_SET_MAPPING)

    if (!resolved) {
      throw new Error('Provide either "Entity Set" or "Custom Entity Set"')
    }

    return resolved
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #normalizeRecordId(recordId) {
    const normalized = (recordId || '').trim().replace(/[{}]/g, '')

    if (!normalized) {
      throw new Error('Parameter "Record ID" is required')
    }

    return normalized
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()
    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('scope', `${ this.orgUrl }/user_impersonation offline_access openid profile`)
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
    const url = `${ OAUTH_BASE_URL }/token`

    const params = new URLSearchParams()
    params.append('client_id', callbackObject.clientId || this.clientId)
    params.append('client_secret', callbackObject.clientSecret || this.clientSecret)
    params.append('code', callbackObject.code)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('grant_type', 'authorization_code')
    params.append('scope', `${ this.orgUrl }/user_impersonation offline_access openid profile`)

    const response = await Flowrunner.Request.post(url)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    let userData = {}
    let connectionIdentityName = 'Dynamics 365 user'

    try {
      const authHeaders = {
        'Authorization': `Bearer ${ response.access_token }`,
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
        'Accept': 'application/json',
      }

      const whoAmI = await Flowrunner.Request.get(`${ this.#apiBaseUrl }/WhoAmI`).set(authHeaders)

      userData = await Flowrunner.Request
        .get(`${ this.#apiBaseUrl }/systemusers(${ whoAmI.UserId })`)
        .set(authHeaders)
        .query({ $select: 'fullname,internalemailaddress,domainname' })

      connectionIdentityName = constructIdentityName(userData)
    } catch (error) {
      logger.error(`[executeCallback] identity lookup error: ${ error.message }`)
    }

    return {
      token: response.access_token,
      refreshToken: response.refresh_token,
      expirationInSeconds: response.expires_in,
      connectionIdentityName,
      overwrite: true,
      userData,
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
    params.append('client_secret', this.clientSecret)
    params.append('refresh_token', refreshToken)
    params.append('grant_type', 'refresh_token')
    params.append('scope', `${ this.orgUrl }/user_impersonation offline_access openid profile`)

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
   * @operationName Get Entity Sets Dictionary
   * @description Provides a searchable list of Dataverse tables (entity sets) available in the connected environment, labeled by display name with the entity set name as the value. Retrieves all tables marked as valid for Advanced Find in a single request (Dataverse metadata queries are not paginated) and filters locally by the search string.
   * @route POST /get-entity-sets-dictionary
   * @paramDef {"type":"getEntitySetsDictionary__payload","label":"Payload","name":"payload","description":"Contains an optional search string for filtering tables."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Account","value":"accounts","note":"accounts"}],"cursor":null}
   */
  async getEntitySetsDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ this.#apiBaseUrl }/EntityDefinitions`,
      query: {
        $select: 'EntitySetName,LogicalName,DisplayName',
        $filter: 'IsValidForAdvancedFind/Value eq true',
      },
      logTag: 'getEntitySetsDictionary',
    })

    const tables = (response.value || [])
      .filter(table => table.EntitySetName)
      .map(table => ({
        entitySetName: table.EntitySetName,
        displayName: table.DisplayName?.UserLocalizedLabel?.Label || table.LogicalName,
      }))

    const filteredTables = search ? searchFilter(tables, ['displayName', 'entitySetName'], search) : tables

    filteredTables.sort((a, b) => a.displayName.localeCompare(b.displayName))

    return {
      cursor: null,
      items: filteredTables.map(({ entitySetName, displayName }) => ({
        label: displayName,
        note: entitySetName,
        value: entitySetName,
      })),
    }
  }

  /**
   * @operationName Who Am I
   * @category Connection
   * @appearanceColor #0B53CE #002050
   * @description Verifies the connection to the Dynamics 365 environment and returns the IDs of the signed-in user, their business unit, and the organization. Useful as a connection health check and for obtaining the current user ID for lookups.
   * @route GET /who-am-i
   * @returns {Object}
   * @sampleResult {"BusinessUnitId":"31a39a7e-8bcd-4d24-9d8b-d3f6a1b2c3d4","UserId":"87d349ed-44d7-43e1-9a83-5f2406dee5bd","OrganizationId":"c7f1c1a2-9b3e-4a5d-8e6f-7a8b9c0d1e2f"}
   */
  whoAmI() {
    return this.#apiRequest({
      url: `${ this.#apiBaseUrl }/WhoAmI`,
      logTag: 'whoAmI',
    })
  }

  /**
   * @operationName List Records
   * @category Records
   * @appearanceColor #0B53CE #002050
   * @description Retrieves records from a Dataverse table with optional OData column selection, filtering, sorting, and page size. Returns the records in "value" and, when more records are available, an "@odata.nextLink" URL that can be passed back via the Next Page Link parameter to fetch the following page.
   * @route GET /list-records
   * @paramDef {"type":"String","label":"Entity Set","name":"entitySet","defaultValue":"Accounts","uiComponent":{"type":"DROPDOWN","options":{"values":["Accounts","Contacts","Leads","Opportunities","Cases (Incidents)","Tasks"]}},"description":"A common Dataverse table to query. Ignored when Custom Entity Set is provided."}
   * @paramDef {"type":"String","label":"Custom Entity Set","name":"customEntitySet","dictionary":"getEntitySetsDictionary","description":"The plural entity set name of any table, overriding the Entity Set dropdown (e.g. accounts, contacts, incidents, or a custom table like cr123_projects). Choose from the list or type the entity set name."}
   * @paramDef {"type":"Array<String>","label":"Columns","name":"select","description":"Column logical names to return (OData $select), e.g. [\"name\",\"revenue\",\"statecode\"]. Returns all columns when omitted."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"OData $filter expression, e.g. statecode eq 0, contains(name,'acme'), createdon gt 2026-01-01T00:00:00Z, or combinations with and/or."}
   * @paramDef {"type":"String","label":"Order By","name":"orderby","description":"OData $orderby expression, e.g. \"createdon desc\" or \"name asc\"."}
   * @paramDef {"type":"Number","label":"Max Results","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The maximum number of records to return (OData $top). Dataverse returns up to 5000 records per page when omitted."}
   * @paramDef {"type":"Boolean","label":"Include Annotations","name":"includeAnnotations","uiComponent":{"type":"TOGGLE"},"description":"When enabled, includes OData annotations such as formatted values and lookup display names in each record."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"The @odata.nextLink URL from a previous response to retrieve the next page. If provided, all other parameters are ignored."}
   * @returns {Object}
   * @sampleResult {"value":[{"@odata.etag":"W/\"1035433\"","accountid":"00000000-0000-0000-0000-000000000001","name":"Acme Corporation","revenue":5000000}],"@odata.nextLink":"https://yourorg.crm.dynamics.com/api/data/v9.2/accounts?$skiptoken=abc"}
   */
  async listRecords(entitySet, customEntitySet, select, filter, orderby, top, includeAnnotations, nextLink) {
    const headers = includeAnnotations ? { 'Prefer': 'odata.include-annotations="*"' } : undefined

    if (nextLink) {
      return this.#apiRequest({
        url: nextLink,
        headers,
        logTag: 'listRecords',
      })
    }

    const resolvedEntitySet = this.#resolveEntitySet(entitySet, customEntitySet)

    return this.#apiRequest({
      url: `${ this.#apiBaseUrl }/${ resolvedEntitySet }`,
      query: {
        $select: Array.isArray(select) && select.length ? select.join(',') : undefined,
        $filter: filter || undefined,
        $orderby: orderby || undefined,
        $top: top || undefined,
      },
      headers,
      logTag: 'listRecords',
    })
  }

  /**
   * @operationName Get Record
   * @category Records
   * @appearanceColor #0B53CE #002050
   * @description Retrieves a single record from a Dataverse table by its GUID, with optional column selection and expansion of related records via navigation properties.
   * @route GET /get-record
   * @paramDef {"type":"String","label":"Entity Set","name":"entitySet","defaultValue":"Accounts","uiComponent":{"type":"DROPDOWN","options":{"values":["Accounts","Contacts","Leads","Opportunities","Cases (Incidents)","Tasks"]}},"description":"A common Dataverse table to read from. Ignored when Custom Entity Set is provided."}
   * @paramDef {"type":"String","label":"Custom Entity Set","name":"customEntitySet","dictionary":"getEntitySetsDictionary","description":"The plural entity set name of any table, overriding the Entity Set dropdown (e.g. accounts, contacts, incidents, or a custom table like cr123_projects). Choose from the list or type the entity set name."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"description":"The GUID of the record to retrieve, e.g. 00000000-0000-0000-0000-000000000001."}
   * @paramDef {"type":"Array<String>","label":"Columns","name":"select","description":"Column logical names to return (OData $select), e.g. [\"name\",\"revenue\"]. Returns all columns when omitted."}
   * @paramDef {"type":"String","label":"Expand","name":"expand","description":"OData $expand expression to include related records, e.g. \"primarycontactid($select=fullname,emailaddress1)\"."}
   * @paramDef {"type":"Boolean","label":"Include Annotations","name":"includeAnnotations","uiComponent":{"type":"TOGGLE"},"description":"When enabled, includes OData annotations such as formatted values and lookup display names in the record."}
   * @returns {Object}
   * @sampleResult {"@odata.etag":"W/\"1035433\"","accountid":"00000000-0000-0000-0000-000000000001","name":"Acme Corporation","revenue":5000000,"statecode":0}
   */
  async getRecord(entitySet, customEntitySet, recordId, select, expand, includeAnnotations) {
    const resolvedEntitySet = this.#resolveEntitySet(entitySet, customEntitySet)
    const resolvedRecordId = this.#normalizeRecordId(recordId)

    return this.#apiRequest({
      url: `${ this.#apiBaseUrl }/${ resolvedEntitySet }(${ resolvedRecordId })`,
      query: {
        $select: Array.isArray(select) && select.length ? select.join(',') : undefined,
        $expand: expand || undefined,
      },
      headers: includeAnnotations ? { 'Prefer': 'odata.include-annotations="*"' } : undefined,
      logTag: 'getRecord',
    })
  }

  /**
   * @operationName Create Record
   * @category Records
   * @appearanceColor #0B53CE #002050
   * @description Creates a new record in a Dataverse table and returns the created record including its generated GUID. Column names in the data object are logical names (e.g. name, emailaddress1). Set lookup columns with the @odata.bind convention, e.g. {"primarycontactid@odata.bind": "/contacts(00000000-0000-0000-0000-000000000001)"}.
   * @route POST /create-record
   * @paramDef {"type":"String","label":"Entity Set","name":"entitySet","defaultValue":"Accounts","uiComponent":{"type":"DROPDOWN","options":{"values":["Accounts","Contacts","Leads","Opportunities","Cases (Incidents)","Tasks"]}},"description":"A common Dataverse table to create the record in. Ignored when Custom Entity Set is provided."}
   * @paramDef {"type":"String","label":"Custom Entity Set","name":"customEntitySet","dictionary":"getEntitySetsDictionary","description":"The plural entity set name of any table, overriding the Entity Set dropdown (e.g. accounts, contacts, incidents, or a custom table like cr123_projects). Choose from the list or type the entity set name."}
   * @paramDef {"type":"Object","label":"Data","name":"data","required":true,"description":"The record data as an object of column logical names to values, e.g. {\"name\":\"Acme Corporation\",\"telephone1\":\"555-0100\"}. Use \"column@odata.bind\" values like \"/contacts(guid)\" to set lookup columns."}
   * @returns {Object}
   * @sampleResult {"@odata.etag":"W/\"1035434\"","accountid":"11111111-2222-3333-4444-555555555555","name":"Acme Corporation","telephone1":"555-0100"}
   */
  async createRecord(entitySet, customEntitySet, data) {
    const resolvedEntitySet = this.#resolveEntitySet(entitySet, customEntitySet)

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Parameter "Data" is required and must be an object')
    }

    return this.#apiRequest({
      url: `${ this.#apiBaseUrl }/${ resolvedEntitySet }`,
      method: 'post',
      body: data,
      headers: { 'Prefer': 'return=representation' },
      logTag: 'createRecord',
    })
  }

  /**
   * @operationName Update Record
   * @category Records
   * @appearanceColor #0B53CE #002050
   * @description Updates an existing record in a Dataverse table and returns the updated record. Include only the columns being changed. By default the request sends If-Match: * so it fails if the record does not exist; enable Upsert to create the record with the given GUID when it is missing. Use the @odata.bind convention for lookup columns, e.g. {"primarycontactid@odata.bind": "/contacts(guid)"}.
   * @route PATCH /update-record
   * @paramDef {"type":"String","label":"Entity Set","name":"entitySet","defaultValue":"Accounts","uiComponent":{"type":"DROPDOWN","options":{"values":["Accounts","Contacts","Leads","Opportunities","Cases (Incidents)","Tasks"]}},"description":"A common Dataverse table containing the record. Ignored when Custom Entity Set is provided."}
   * @paramDef {"type":"String","label":"Custom Entity Set","name":"customEntitySet","dictionary":"getEntitySetsDictionary","description":"The plural entity set name of any table, overriding the Entity Set dropdown (e.g. accounts, contacts, incidents, or a custom table like cr123_projects). Choose from the list or type the entity set name."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"description":"The GUID of the record to update, e.g. 00000000-0000-0000-0000-000000000001."}
   * @paramDef {"type":"Object","label":"Data","name":"data","required":true,"description":"The columns to change as an object of column logical names to values, e.g. {\"name\":\"Updated Name\",\"creditonhold\":true}. Use \"column@odata.bind\" values like \"/contacts(guid)\" to set lookup columns."}
   * @paramDef {"type":"Boolean","label":"Upsert","name":"upsert","uiComponent":{"type":"TOGGLE"},"description":"When enabled, creates the record with the given GUID if it does not exist (Dataverse upsert). When disabled (default), the update fails with 404 if the record is missing."}
   * @returns {Object}
   * @sampleResult {"@odata.etag":"W/\"1035435\"","accountid":"00000000-0000-0000-0000-000000000001","name":"Updated Name","creditonhold":true}
   */
  async updateRecord(entitySet, customEntitySet, recordId, data, upsert) {
    const resolvedEntitySet = this.#resolveEntitySet(entitySet, customEntitySet)
    const resolvedRecordId = this.#normalizeRecordId(recordId)

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Parameter "Data" is required and must be an object')
    }

    const headers = { 'Prefer': 'return=representation' }

    if (!upsert) {
      headers['If-Match'] = '*'
    }

    return this.#apiRequest({
      url: `${ this.#apiBaseUrl }/${ resolvedEntitySet }(${ resolvedRecordId })`,
      method: 'patch',
      body: data,
      headers,
      logTag: 'updateRecord',
    })
  }

  /**
   * @operationName Delete Record
   * @category Records
   * @appearanceColor #0B53CE #002050
   * @description Permanently deletes a record from a Dataverse table by its GUID. Fails with a 404 error if the record does not exist.
   * @route DELETE /delete-record
   * @paramDef {"type":"String","label":"Entity Set","name":"entitySet","defaultValue":"Accounts","uiComponent":{"type":"DROPDOWN","options":{"values":["Accounts","Contacts","Leads","Opportunities","Cases (Incidents)","Tasks"]}},"description":"A common Dataverse table containing the record. Ignored when Custom Entity Set is provided."}
   * @paramDef {"type":"String","label":"Custom Entity Set","name":"customEntitySet","dictionary":"getEntitySetsDictionary","description":"The plural entity set name of any table, overriding the Entity Set dropdown (e.g. accounts, contacts, incidents, or a custom table like cr123_projects). Choose from the list or type the entity set name."}
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"description":"The GUID of the record to delete, e.g. 00000000-0000-0000-0000-000000000001."}
   * @returns {Object}
   * @sampleResult {"message":"Record deleted successfully"}
   */
  async deleteRecord(entitySet, customEntitySet, recordId) {
    const resolvedEntitySet = this.#resolveEntitySet(entitySet, customEntitySet)
    const resolvedRecordId = this.#normalizeRecordId(recordId)

    await this.#apiRequest({
      url: `${ this.#apiBaseUrl }/${ resolvedEntitySet }(${ resolvedRecordId })`,
      method: 'delete',
      logTag: 'deleteRecord',
    })

    return { message: 'Record deleted successfully' }
  }

  /**
   * @operationName Execute FetchXML Query
   * @category Queries
   * @appearanceColor #0B53CE #002050
   * @description Executes a FetchXML query against a Dataverse table and returns the matching records. FetchXML supports aggregation, grouping, linked entities (joins), and complex filtering beyond OData. The fetch element's entity name must be the singular logical name (e.g. account) while the Entity Set parameter uses the plural entity set name (e.g. accounts). Very large queries may exceed URL length limits since the query is sent URL-encoded.
   * @route GET /execute-fetchxml-query
   * @paramDef {"type":"String","label":"Entity Set","name":"entitySet","defaultValue":"Accounts","uiComponent":{"type":"DROPDOWN","options":{"values":["Accounts","Contacts","Leads","Opportunities","Cases (Incidents)","Tasks"]}},"description":"A common Dataverse table matching the query's root entity. Ignored when Custom Entity Set is provided."}
   * @paramDef {"type":"String","label":"Custom Entity Set","name":"customEntitySet","dictionary":"getEntitySetsDictionary","description":"The plural entity set name of any table, overriding the Entity Set dropdown (e.g. accounts, contacts, incidents, or a custom table like cr123_projects). Choose from the list or type the entity set name."}
   * @paramDef {"type":"String","label":"FetchXML","name":"fetchXml","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The FetchXML query, e.g. <fetch top=\"10\"><entity name=\"account\"><attribute name=\"name\"/><filter><condition attribute=\"statecode\" operator=\"eq\" value=\"0\"/></filter></entity></fetch>."}
   * @paramDef {"type":"Boolean","label":"Include Annotations","name":"includeAnnotations","uiComponent":{"type":"TOGGLE"},"description":"When enabled, includes OData annotations such as formatted values, lookup display names, and the FetchXML paging cookie in the response."}
   * @returns {Object}
   * @sampleResult {"value":[{"@odata.etag":"W/\"1035433\"","accountid":"00000000-0000-0000-0000-000000000001","name":"Acme Corporation"}]}
   */
  async executeFetchXmlQuery(entitySet, customEntitySet, fetchXml, includeAnnotations) {
    const resolvedEntitySet = this.#resolveEntitySet(entitySet, customEntitySet)

    if (!fetchXml || !fetchXml.trim()) {
      throw new Error('Parameter "FetchXML" is required')
    }

    return this.#apiRequest({
      url: `${ this.#apiBaseUrl }/${ resolvedEntitySet }`,
      query: { fetchXml: fetchXml.trim() },
      headers: includeAnnotations ? { 'Prefer': 'odata.include-annotations="*"' } : undefined,
      logTag: 'executeFetchXmlQuery',
    })
  }
}

Flowrunner.ServerCode.addService(MicrosoftDynamics365Service, [
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
  {
    name: 'orgUrl',
    displayName: 'Organization URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Dynamics 365 environment URL, e.g. https://yourorg.crm.dynamics.com. Find it in the Power Platform admin center under Environments.',
  },
])

function searchFilter(list, props, searchString) {
  const caseInsensitiveSearch = searchString.toLowerCase()

  return list.filter(item =>
    props.some(prop => {
      const value = item[prop]

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

function constructIdentityName(user) {
  const email = user.internalemailaddress || user.domainname

  if (user.fullname && email) {
    return `${ user.fullname } (${ email })`
  }

  return user.fullname || email || 'Dynamics 365 user'
}
