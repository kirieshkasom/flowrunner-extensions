'use strict'

const API_BASE_URL = 'https://people.googleapis.com/v1'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const USER_INFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

const DEFAULT_SCOPE_LIST = [
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const DEFAULT_PAGE_SIZE = 100
const SEARCH_MAX_PAGE_SIZE = 30

const PERSON_FIELDS = 'names,emailAddresses,phoneNumbers,organizations,biographies,addresses'

const SORT_ORDER_OPTIONS = {
  'First Name': 'FIRST_NAME_ASCENDING',
  'Last Name': 'LAST_NAME_ASCENDING',
  'Last Modified': 'LAST_MODIFIED_DESCENDING',
}

const logger = {
  info: (...args) => console.log('[Google Contacts] info:', ...args),
  debug: (...args) => console.log('[Google Contacts] debug:', ...args),
  error: (...args) => console.log('[Google Contacts] error:', ...args),
  warn: (...args) => console.log('[Google Contacts] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName Google Contacts
 * @integrationIcon /icon.svg
 **/
class GoogleContactsService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
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
      const message = error.body?.error?.message || error.message

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Google Contacts API error: ${ message }`)
    }
  }

  #getAccessTokenHeader(accessToken) {
    return {
      Authorization: `Bearer ${ accessToken || this.request.headers['oauth-access-token'] }`,
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #normalizeContactResourceName(resourceName) {
    if (!resourceName) {
      throw new Error('"Contact" is required')
    }

    return resourceName.startsWith('people/') ? resourceName : `people/${ resourceName }`
  }

  #normalizeGroupResourceName(group) {
    if (!group) {
      throw new Error('"Contact Group" is required')
    }

    return group.startsWith('contactGroups/') ? group : `contactGroups/${ group }`
  }

  #simplifyPerson(person) {
    if (!person) {
      return person
    }

    const name = (person.names || [])[0] || {}
    const organization = (person.organizations || [])[0] || {}

    return {
      resourceName: person.resourceName,
      etag: person.etag,
      displayName: name.displayName || [name.givenName, name.familyName].filter(Boolean).join(' ') || null,
      firstName: name.givenName || null,
      lastName: name.familyName || null,
      emails: (person.emailAddresses || []).map(email => email.value).filter(Boolean),
      phones: (person.phoneNumbers || []).map(phone => phone.value).filter(Boolean),
      company: organization.name || null,
      jobTitle: organization.title || null,
      notes: (person.biographies || [])[0]?.value || null,
      addresses: (person.addresses || []).map(address => address.formattedValue).filter(Boolean),
      raw: person,
    }
  }

  #buildPersonBody({ firstName, lastName, email, phone, company, jobTitle, notes }) {
    const person = {}

    if (firstName || lastName) {
      person.names = [cleanupObject({ givenName: firstName, familyName: lastName })]
    }

    if (email) {
      person.emailAddresses = [{ value: email }]
    }

    if (phone) {
      person.phoneNumbers = [{ value: phone }]
    }

    if (company || jobTitle) {
      person.organizations = [cleanupObject({ name: company, title: jobTitle })]
    }

    if (notes) {
      person.biographies = [{ value: notes, contentType: 'TEXT_PLAIN' }]
    }

    return person
  }

  // Google recommends warming up the searchContacts cache with an empty-query request
  // before sending the real search, otherwise recent changes may be missing from results.
  async #warmupSearchCache(logTag) {
    try {
      await this.#apiRequest({
        logTag: `${ logTag }:warmup`,
        url: `${ API_BASE_URL }/people:searchContacts`,
        query: { query: '', readMask: 'names' },
      })
    } catch (error) {
      logger.warn(`${ logTag } - search cache warmup failed: ${ error.message }`)
    }
  }

  // ============================================= OAUTH ================================================

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

    let userData = {}
    let connectionIdentityName = 'Google Contacts Account'
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
   * @typedef {Object} getContactGroupsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter contact groups by name. Filtering is applied locally to the retrieved page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Contact Groups Dictionary
   * @description Lists the connected user's contact groups (labels) for selection in dependent parameters. Returns the group display name as the label and the group resource name (e.g. "contactGroups/myContacts") as the value.
   * @route POST /get-contact-groups-dictionary
   * @paramDef {"type":"getContactGroupsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Clients","value":"contactGroups/3bfe8d2c0a1b2c3d","note":"USER_CONTACT_GROUP (12 members)"}],"cursor":"nextPageToken123"}
   */
  async getContactGroupsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getContactGroupsDictionary',
      url: `${ API_BASE_URL }/contactGroups`,
      query: {
        pageSize: DEFAULT_PAGE_SIZE,
        pageToken: cursor,
      },
    })

    const groups = response.contactGroups || []

    const filteredGroups = search
      ? searchFilter(groups, ['formattedName', 'name', 'resourceName'], search)
      : groups

    return {
      cursor: response.nextPageToken,
      items: filteredGroups.map(group => ({
        label: group.formattedName || group.name,
        value: group.resourceName,
        note: `${ group.groupType }${ group.memberCount ? ` (${ group.memberCount } members)` : '' }`,
      })),
    }
  }

  /**
   * @typedef {Object} getContactsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to search contacts by name, nickname, email address, phone number, or organization (prefix matching via the People API search)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for retrieving the next page of results (used only when no search text is provided)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Contacts Dictionary
   * @description Lists the connected user's contacts for selection in dependent parameters. Without search text it pages through the full connections list; with search text it uses the People API contact search (cache warmup included, up to 30 matches). Returns the contact display name as the label, the primary email as the note, and the contact resource name (e.g. "people/c1234567890") as the value.
   * @route POST /get-contacts-dictionary
   * @paramDef {"type":"getContactsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Ada Lovelace","value":"people/c1234567890123456789","note":"ada@example.com"}],"cursor":"nextPageToken123"}
   */
  async getContactsDictionary(payload) {
    const { search, cursor } = payload || {}

    const toItem = person => {
      const name = (person.names || [])[0] || {}
      const email = (person.emailAddresses || [])[0] || {}

      return {
        label: name.displayName || email.value || person.resourceName,
        value: person.resourceName,
        note: email.value || '',
      }
    }

    if (search) {
      await this.#warmupSearchCache('getContactsDictionary')

      const response = await this.#apiRequest({
        logTag: 'getContactsDictionary',
        url: `${ API_BASE_URL }/people:searchContacts`,
        query: {
          query: search,
          readMask: 'names,emailAddresses',
          pageSize: SEARCH_MAX_PAGE_SIZE,
        },
      })

      return {
        items: (response.results || []).map(result => toItem(result.person)),
      }
    }

    const response = await this.#apiRequest({
      logTag: 'getContactsDictionary',
      url: `${ API_BASE_URL }/people/me/connections`,
      query: {
        personFields: 'names,emailAddresses',
        pageSize: DEFAULT_PAGE_SIZE,
        pageToken: cursor,
        sortOrder: 'FIRST_NAME_ASCENDING',
      },
    })

    return {
      cursor: response.nextPageToken,
      items: (response.connections || []).map(toItem),
    }
  }

  // ============================================ CONTACTS ==============================================

  /**
   * @description Creates a new contact in the connected user's Google Contacts. Build the contact from the simple fields (name, email, phone, company, job title, notes) and/or provide a Raw Person object in the People API Person format for advanced fields (multiple emails, addresses, birthdays, memberships, etc.) — raw fields override the simple ones. At least one field must be provided. Returns the created contact with a simplified shape plus the raw People API resource (including 'resourceName' and 'etag').
   *
   * @route POST /create-contact
   * @operationName Create Contact
   * @category Contacts
   *
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"The contact's given name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"The contact's family name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"The contact's email address."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"The contact's phone number, in any common format (e.g. '+1 555 123 4567')."}
   * @paramDef {"type":"String","label":"Company","name":"company","description":"The contact's company or organization name."}
   * @paramDef {"type":"String","label":"Job Title","name":"jobTitle","description":"The contact's job title within the company."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free-form notes about the contact (stored as the contact's biography)."}
   * @paramDef {"type":"Object","label":"Raw Person","name":"rawPerson","description":"Optional People API Person object for advanced fields, e.g. {\"emailAddresses\":[{\"value\":\"work@example.com\",\"type\":\"work\"}],\"addresses\":[{\"formattedValue\":\"1 Main St\"}]}. Merged over the simple fields, so any field present here replaces the corresponding simple field."}
   *
   * @returns {Object}
   * @sampleResult {"resourceName":"people/c1234567890123456789","etag":"%EgU0LjEuNy4=","displayName":"Ada Lovelace","firstName":"Ada","lastName":"Lovelace","emails":["ada@example.com"],"phones":["+1 555 123 4567"],"company":"Analytical Engines","jobTitle":"Engineer","notes":"Met at conference","addresses":[],"raw":{"resourceName":"people/c1234567890123456789"}}
   */
  async createContact(firstName, lastName, email, phone, company, jobTitle, notes, rawPerson) {
    const person = {
      ...this.#buildPersonBody({ firstName, lastName, email, phone, company, jobTitle, notes }),
      ...(rawPerson || {}),
    }

    if (!Object.keys(person).length) {
      throw new Error('At least one contact field must be provided')
    }

    const created = await this.#apiRequest({
      logTag: 'createContact',
      method: 'post',
      url: `${ API_BASE_URL }/people:createContact`,
      query: { personFields: PERSON_FIELDS },
      body: person,
    })

    return this.#simplifyPerson(created)
  }

  /**
   * @description Retrieves a single contact from the connected user's Google Contacts by its resource name. Returns a simplified shape (flattened name, emails, phones, company, job title, notes, addresses) plus the raw People API resource (including 'etag').
   *
   * @route GET /get-contact
   * @operationName Get Contact
   * @category Contacts
   *
   * @paramDef {"type":"String","label":"Contact","name":"resourceName","required":true,"dictionary":"getContactsDictionary","description":"The contact to retrieve, as a resource name in the format 'people/{personId}'. Select from the list or provide the resource name directly."}
   *
   * @returns {Object}
   * @sampleResult {"resourceName":"people/c1234567890123456789","etag":"%EgU0LjEuNy4=","displayName":"Ada Lovelace","firstName":"Ada","lastName":"Lovelace","emails":["ada@example.com"],"phones":["+1 555 123 4567"],"company":"Analytical Engines","jobTitle":"Engineer","notes":"Met at conference","addresses":["1 Main St, Springfield"],"raw":{"resourceName":"people/c1234567890123456789"}}
   */
  async getContact(resourceName) {
    const person = await this.#apiRequest({
      logTag: 'getContact',
      url: `${ API_BASE_URL }/${ this.#normalizeContactResourceName(resourceName) }`,
      query: { personFields: PERSON_FIELDS },
    })

    return this.#simplifyPerson(person)
  }

  /**
   * @description Lists the connected user's contacts (connections), sorted by first name, last name, or last modified time. Supports pagination via page token — up to 1000 contacts per page (default 100). Returns simplified contact objects (flattened name, emails, phones, company, notes) each including the raw People API resource, plus 'nextPageToken' and 'totalItems'.
   *
   * @route GET /list-contacts
   * @operationName List Contacts
   * @category Contacts
   *
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of contacts to return per page. Maximum: 1000. Default: 100."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous List Contacts response ('nextPageToken') used to retrieve the next page of results."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","defaultValue":"Last Modified","uiComponent":{"type":"DROPDOWN","options":{"values":["First Name","Last Name","Last Modified"]}},"description":"Order of returned contacts. 'First Name' and 'Last Name' sort alphabetically ascending; 'Last Modified' returns the most recently changed contacts first."}
   *
   * @returns {Object}
   * @sampleResult {"contacts":[{"resourceName":"people/c1234567890123456789","etag":"%EgU0LjEuNy4=","displayName":"Ada Lovelace","firstName":"Ada","lastName":"Lovelace","emails":["ada@example.com"],"phones":["+1 555 123 4567"],"company":"Analytical Engines","jobTitle":"Engineer","notes":null,"addresses":[]}],"nextPageToken":"nextPageToken123","totalItems":250}
   */
  async listContacts(pageSize, pageToken, sortOrder) {
    const response = await this.#apiRequest({
      logTag: 'listContacts',
      url: `${ API_BASE_URL }/people/me/connections`,
      query: {
        personFields: PERSON_FIELDS,
        pageSize: pageSize || DEFAULT_PAGE_SIZE,
        pageToken,
        sortOrder: this.#resolveChoice(sortOrder, SORT_ORDER_OPTIONS),
      },
    })

    return {
      contacts: (response.connections || []).map(person => this.#simplifyPerson(person)),
      nextPageToken: response.nextPageToken,
      totalItems: response.totalItems,
    }
  }

  /**
   * @description Updates an existing contact in the connected user's Google Contacts. Only the provided fields are updated — the current contact is fetched first to obtain its 'etag' (required by the People API for concurrency control) and to merge partial name/organization changes, so e.g. updating only the first name preserves the last name. Returns the updated contact in a simplified shape plus the raw People API resource.
   *
   * @route PATCH /update-contact
   * @operationName Update Contact
   * @category Contacts
   *
   * @paramDef {"type":"String","label":"Contact","name":"resourceName","required":true,"dictionary":"getContactsDictionary","description":"The contact to update, as a resource name in the format 'people/{personId}'."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"New given name for the contact. Leave empty to keep the current value."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"New family name for the contact. Leave empty to keep the current value."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New email address. Replaces all existing email addresses on the contact. Leave empty to keep the current value."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"New phone number. Replaces all existing phone numbers on the contact. Leave empty to keep the current value."}
   * @paramDef {"type":"String","label":"Company","name":"company","description":"New company or organization name. Leave empty to keep the current value."}
   * @paramDef {"type":"String","label":"Job Title","name":"jobTitle","description":"New job title. Leave empty to keep the current value."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New notes (biography) for the contact. Replaces the existing notes. Leave empty to keep the current value."}
   *
   * @returns {Object}
   * @sampleResult {"resourceName":"people/c1234567890123456789","etag":"%EgU0LjEuNy5=","displayName":"Ada King","firstName":"Ada","lastName":"King","emails":["ada@example.com"],"phones":["+1 555 123 4567"],"company":"Analytical Engines","jobTitle":"Countess","notes":"Updated notes","addresses":[],"raw":{"resourceName":"people/c1234567890123456789"}}
   */
  async updateContact(resourceName, firstName, lastName, email, phone, company, jobTitle, notes) {
    const name = this.#normalizeContactResourceName(resourceName)

    // The People API requires the current etag on every update; fetch it (and the
    // current values, so partial name/organization updates do not wipe siblings).
    const current = await this.#apiRequest({
      logTag: 'updateContact:fetchCurrent',
      url: `${ API_BASE_URL }/${ name }`,
      query: { personFields: PERSON_FIELDS },
    })

    const updateFields = []
    const body = { etag: current.etag }

    if (firstName || lastName) {
      const currentName = (current.names || [])[0] || {}

      body.names = [cleanupObject({
        givenName: firstName || currentName.givenName,
        familyName: lastName || currentName.familyName,
      })]

      updateFields.push('names')
    }

    if (email) {
      body.emailAddresses = [{ value: email }]
      updateFields.push('emailAddresses')
    }

    if (phone) {
      body.phoneNumbers = [{ value: phone }]
      updateFields.push('phoneNumbers')
    }

    if (company || jobTitle) {
      const currentOrganization = (current.organizations || [])[0] || {}

      body.organizations = [cleanupObject({
        name: company || currentOrganization.name,
        title: jobTitle || currentOrganization.title,
      })]

      updateFields.push('organizations')
    }

    if (notes) {
      body.biographies = [{ value: notes, contentType: 'TEXT_PLAIN' }]
      updateFields.push('biographies')
    }

    if (!updateFields.length) {
      throw new Error('At least one field to update must be provided')
    }

    const updated = await this.#apiRequest({
      logTag: 'updateContact',
      method: 'patch',
      url: `${ API_BASE_URL }/${ name }:updateContact`,
      query: {
        updatePersonFields: updateFields.join(','),
        personFields: PERSON_FIELDS,
      },
      body,
    })

    return this.#simplifyPerson(updated)
  }

  /**
   * @description Permanently deletes a contact from the connected user's Google Contacts by its resource name. This cannot be undone through the API (deleted contacts remain in the Google Contacts trash for 30 days via the web UI).
   *
   * @route DELETE /delete-contact
   * @operationName Delete Contact
   * @category Contacts
   *
   * @paramDef {"type":"String","label":"Contact","name":"resourceName","required":true,"dictionary":"getContactsDictionary","description":"The contact to delete, as a resource name in the format 'people/{personId}'."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Contact deleted successfully","resourceName":"people/c1234567890123456789"}
   */
  async deleteContact(resourceName) {
    const name = this.#normalizeContactResourceName(resourceName)

    await this.#apiRequest({
      logTag: 'deleteContact',
      method: 'delete',
      url: `${ API_BASE_URL }/${ name }:deleteContact`,
    })

    return {
      success: true,
      message: 'Contact deleted successfully',
      resourceName: name,
    }
  }

  /**
   * @description Searches the connected user's contacts by name, nickname, email address, phone number, or organization using prefix matching. Sends the warmup request recommended by Google (an empty-query search that refreshes the server-side cache) before the real search, so recently changed contacts are included. Returns up to 30 matches (API maximum) as simplified contact objects, each including the raw People API resource.
   *
   * @route GET /search-contacts
   * @operationName Search Contacts
   * @category Contacts
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"The search text. Matches prefixes of the contact's names, nicknames, email addresses, phone numbers, and organizations (e.g. 'ada' matches 'Ada Lovelace' and 'ada@example.com')."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of results to return. Maximum: 30. Default: 10 (API default)."}
   *
   * @returns {Object}
   * @sampleResult {"contacts":[{"resourceName":"people/c1234567890123456789","etag":"%EgU0LjEuNy4=","displayName":"Ada Lovelace","firstName":"Ada","lastName":"Lovelace","emails":["ada@example.com"],"phones":["+1 555 123 4567"],"company":"Analytical Engines","jobTitle":"Engineer","notes":null,"addresses":[]}],"totalMatches":1}
   */
  async searchContacts(query, pageSize) {
    if (!query) {
      throw new Error('"Query" is required')
    }

    await this.#warmupSearchCache('searchContacts')

    const response = await this.#apiRequest({
      logTag: 'searchContacts',
      url: `${ API_BASE_URL }/people:searchContacts`,
      query: {
        query,
        readMask: PERSON_FIELDS,
        pageSize: pageSize ? Math.min(pageSize, SEARCH_MAX_PAGE_SIZE) : undefined,
      },
    })

    const contacts = (response.results || []).map(result => this.#simplifyPerson(result.person))

    return {
      contacts,
      totalMatches: contacts.length,
    }
  }

  // ========================================== CONTACT GROUPS ==========================================

  /**
   * @description Lists the connected user's contact groups (labels), including system groups such as 'myContacts' and 'starred' as well as user-created groups. Each group includes its resource name, formatted name, group type, and member count. Supports pagination via page token.
   *
   * @route GET /list-contact-groups
   * @operationName List Contact Groups
   * @category Contact Groups
   *
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of contact groups to return per page. Maximum: 1000. Default: 30 (API default)."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous List Contact Groups response ('nextPageToken') used to retrieve the next page of results."}
   *
   * @returns {Object}
   * @sampleResult {"contactGroups":[{"resourceName":"contactGroups/3bfe8d2c0a1b2c3d","etag":"ABC123","groupType":"USER_CONTACT_GROUP","name":"Clients","formattedName":"Clients","memberCount":12}],"nextPageToken":"nextPageToken123","totalItems":8}
   */
  async listContactGroups(pageSize, pageToken) {
    return this.#apiRequest({
      logTag: 'listContactGroups',
      url: `${ API_BASE_URL }/contactGroups`,
      query: {
        pageSize,
        pageToken,
      },
    })
  }

  /**
   * @description Creates a new contact group (label) in the connected user's Google Contacts. The group name must be unique among the user's groups. Returns the created group including its resource name (e.g. 'contactGroups/3bfe8d2c0a1b2c3d'), which can be used to add or remove contacts.
   *
   * @route POST /create-contact-group
   * @operationName Create Contact Group
   * @category Contact Groups
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the new contact group. Must be unique among the user's contact groups."}
   *
   * @returns {Object}
   * @sampleResult {"resourceName":"contactGroups/3bfe8d2c0a1b2c3d","etag":"ABC123","groupType":"USER_CONTACT_GROUP","name":"Clients","formattedName":"Clients"}
   */
  async createContactGroup(name) {
    if (!name) {
      throw new Error('"Name" is required')
    }

    return this.#apiRequest({
      logTag: 'createContactGroup',
      method: 'post',
      url: `${ API_BASE_URL }/contactGroups`,
      body: {
        contactGroup: { name },
      },
    })
  }

  /**
   * @description Adds one or more contacts to a contact group (label) in the connected user's Google Contacts. Only user-created groups can be modified — system groups (e.g. 'myContacts', 'starred') are read-only. Up to 500 contacts can be added per call. Returns any contact resource names that could not be found.
   *
   * @route POST /add-contacts-to-group
   * @operationName Add Contacts To Group
   * @category Contact Groups
   *
   * @paramDef {"type":"String","label":"Contact Group","name":"group","required":true,"dictionary":"getContactGroupsDictionary","description":"The contact group to add contacts to, as a resource name in the format 'contactGroups/{contactGroupId}'. Must be a user-created group."}
   * @paramDef {"type":"Array<String>","label":"Contacts","name":"contacts","required":true,"description":"List of contact resource names to add to the group, each in the format 'people/{personId}'. Maximum 500 per call."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"groupResourceName":"contactGroups/3bfe8d2c0a1b2c3d","addedCount":2,"notFoundResourceNames":[]}
   */
  async addContactsToGroup(group, contacts) {
    const groupResourceName = this.#normalizeGroupResourceName(group)
    const resourceNames = this.#normalizeContactList(contacts)

    const response = await this.#apiRequest({
      logTag: 'addContactsToGroup',
      method: 'post',
      url: `${ API_BASE_URL }/${ groupResourceName }/members:modify`,
      body: {
        resourceNamesToAdd: resourceNames,
      },
    })

    const notFound = response.notFoundResourceNames || []

    return {
      success: true,
      groupResourceName,
      addedCount: resourceNames.length - notFound.length,
      notFoundResourceNames: notFound,
    }
  }

  /**
   * @description Removes one or more contacts from a contact group (label) in the connected user's Google Contacts. Only user-created groups can be modified — system groups (e.g. 'myContacts', 'starred') are read-only. The contacts themselves are not deleted, only their membership in the group. Returns any contact resource names that could not be found or removed.
   *
   * @route POST /remove-contacts-from-group
   * @operationName Remove Contacts From Group
   * @category Contact Groups
   *
   * @paramDef {"type":"String","label":"Contact Group","name":"group","required":true,"dictionary":"getContactGroupsDictionary","description":"The contact group to remove contacts from, as a resource name in the format 'contactGroups/{contactGroupId}'. Must be a user-created group."}
   * @paramDef {"type":"Array<String>","label":"Contacts","name":"contacts","required":true,"description":"List of contact resource names to remove from the group, each in the format 'people/{personId}'. Maximum 500 per call."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"groupResourceName":"contactGroups/3bfe8d2c0a1b2c3d","removedCount":1,"notFoundResourceNames":[],"canNotRemoveLastContactGroupResourceNames":[]}
   */
  async removeContactsFromGroup(group, contacts) {
    const groupResourceName = this.#normalizeGroupResourceName(group)
    const resourceNames = this.#normalizeContactList(contacts)

    const response = await this.#apiRequest({
      logTag: 'removeContactsFromGroup',
      method: 'post',
      url: `${ API_BASE_URL }/${ groupResourceName }/members:modify`,
      body: {
        resourceNamesToRemove: resourceNames,
      },
    })

    const notFound = response.notFoundResourceNames || []
    const cannotRemove = response.canNotRemoveLastContactGroupResourceNames || []

    return {
      success: true,
      groupResourceName,
      removedCount: resourceNames.length - notFound.length - cannotRemove.length,
      notFoundResourceNames: notFound,
      canNotRemoveLastContactGroupResourceNames: cannotRemove,
    }
  }

  #normalizeContactList(contacts) {
    const list = (Array.isArray(contacts) ? contacts : [contacts])
      .filter(Boolean)
      .map(contact => this.#normalizeContactResourceName(String(contact).trim()))

    if (!list.length) {
      throw new Error('"Contacts" must contain at least one contact resource name')
    }

    return list
  }
}

Flowrunner.ServerCode.addService(GoogleContactsService, [
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
      const value = item[prop]

      return value && String(value).toLowerCase().includes(searchString.toLowerCase())
    })
  )
}
