const API_BASE_URL = 'https://api.hubapi.com'
const OAUTH_BASE_URL = `${ API_BASE_URL }/oauth`
const AUTH_URL = 'https://app.hubspot.com/oauth/authorize'

const DEFAULT_SCOPE_LIST = [
  'oauth',
  'crm.objects.contacts.read',
  'crm.objects.contacts.write',
  'crm.objects.companies.read',
  'crm.objects.companies.write',
  'crm.objects.deals.read',
  'crm.objects.deals.write',
  'tickets',
  'e-commerce',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const logger = {
  info: (...args) => console.log('[HubSpot Service] info:', ...args),
  debug: (...args) => console.log('[HubSpot Service] debug:', ...args),
  error: (...args) => console.log('[HubSpot Service] error:', ...args),
  warn: (...args) => console.log('[HubSpot Service] warn:', ...args),
}

/**
 *  @requireOAuth
 *  @integrationName HubSpot
 *  @integrationIcon /icon.svg
 **/
class HubSpotService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  #getAccessToken() {
    return this.request.headers['oauth-access-token']
  }

  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      return await Flowrunner.Request[method](url)
        .set({
          'Authorization': `Bearer ${ this.#getAccessToken() }`,
          'Content-Type': 'application/json',
        })
        .query(query)
        .send(body)
    } catch (error) {
      logger.error(`${ logTag } - API request failed:`, error.message || error)
      throw error
    }
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   *
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()
    params.append('client_id', this.clientId)
    params.append('scope', this.scopes)
    params.append('response_type', 'code')

    const connectionURL = `${ AUTH_URL }?${ params.toString() }`
    logger.debug(`OAuth2 Connection URL: ${ connectionURL }`)

    return connectionURL
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
    logger.debug(`Refresh Token: ${ refreshToken }`)

    const params = new URLSearchParams()
    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)
    params.append('scope', this.scopes)
    params.append('refresh_token', refreshToken)
    params.append('grant_type', 'refresh_token')

    try {
      const { access_token, expires_in } = await Flowrunner.Request.post(`${ OAUTH_BASE_URL }/v1/token`)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      return { token: access_token, expirationInSeconds: expires_in }
    } catch (error) {
      logger.error(`Error refreshing token: ${ error.message || error }`)

      throw error
    }
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

    try {
      const response = await Flowrunner.Request.post(`${ OAUTH_BASE_URL }/v1/token`)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      logger.debug(`executeCallback -> response: ${ JSON.stringify(response) }`)

      return {
        token: response['access_token'],
        refreshToken: response['refresh_token'],
        expirationInSeconds: response['expires_in'],
        overwrite: true,
        connectionIdentityName: 'HubSpot Service Account',
      }
    } catch (error) {
      logger.error(`Failed to execute callback: ${ error }`)

      throw error
    }
  }

  /**
   * @typedef {Object} Membership
   * @property {Number} vid
   * @property {Number} internalListId
   * @property {Boolean} isMember
   * @property {Number} staticListId
   * @property {Number} timestamp
   */

  /**
   * @typedef {Object} Identity
   * @property {Boolean} isPrimary
   * @property {String} source
   * @property {String} type
   * @property {String} value
   * @property {Number} timestamp
   */

  /**
   * @typedef {Object} IdentityProfile
   * @property {Number} vid
   * @property {Number} savedAtTimestamp
   * @property {Number} pointerVid
   * @property {Array.<Identity>} identities
   * @property {Boolean} isContact
   * @property {Number} deletedChangedTimestamp
   * @property {Boolean} isDeleted
   * @property {Array.<Number>} linkedVids
   * @property {Number} previousVid
   */

  /**
   * @typedef {Object} Version
   * @property {Number} updatedByUserId
   * @property {Boolean} isEncrypted
   * @property {String} sourceLabel
   * @property {String} sourceType
   * @property {String} dataSensitivity
   * @property {String} value
   * @property {String} sourceId
   * @property {Boolean} selected
   * @property {Number} timestamp
   */

  /**
   * @typedef {Object} PropertyWithVersions
   * @property {String} value
   * @property {Array.<Version>} versions
   */

  /**
   * @typedef {Object} Contact
   * @property {Number} vid
   * @property {Array.<Object>} mergeAudits
   * @property {Number} addedAt
   * @property {Array.<Number>} mergedVids
   * @property {Boolean} isContact
   * @property {Array.<Object>} formSubmissions
   * @property {Number} portalId
   * @property {Array.<Membership>} listMemberships
   * @property {Array.<IdentityProfile>} identityProfiles
   * @property {Number} canonicalVid
   * @property {Object<String, PropertyWithVersions>} properties
   */

  /**
   * @typedef {Object} Contacts
   * @property {Boolean} hasMore
   * @property {Array.<Contact>} contacts
   * @property {Number} vidOffset
   */

  /**
   * @description Retrieves all contacts from your HubSpot account with comprehensive filtering and pagination options. Supports property selection, form submission history, and list membership details. Maximum of 100 contacts per request with pagination support for large datasets.
   *
   * @route POST /get-all-contacts
   * @operationName Get All Contacts
   * @category Contact Management
   *
   * @appearanceColor #fe8834 #ff5b35
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes crm.objects.contacts.read
   *
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"This parameter lets you specify the amount of contacts to return in your API call. The default for this parameter (if it isn't specified) is 20 contacts. The maximum amount of contacts you can have returned to you via this parameter is 100."}
   * @paramDef {"type":"String","label":"VID Offset","name":"vidOffset","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Used to page through the contacts. Every call to this endpoint will return a 'vid-offset' value. This value is used in the 'vidOffset' parameter of the next call to get the next page of contacts."}
   * @paramDef {"type":"Array.<String>","label":"Properties","name":"property","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"May be included multiple times. By default, only a few standard properties will be included in the response data. If you include the 'property' parameter, then you will instead get the specified property in the response. This parameter may be included multiple times to specify multiple properties. NOTE: Contacts only store data for properties with a value, so records with no value for a property will not include that property, even if the property is specified in the request URL."}
   * @paramDef {"type":"String","label":"Property Mode","name":"propertyMode","uiComponent":{"type":"DROPDOWN","options":{"values":["value_only","value_and_history"]}},"description":"One of 'value_only' or 'value_and_history' to specify if the current value for a property should be fetched, or the value and all the historical values for that property. Default is 'value_only'."}
   * @paramDef {"type":"String","label":"Form Submission Mode","name":"formSubmissionMode","uiComponent":{"type":"DROPDOWN","options":{"values":["all","none","newest","oldest"]}},"description":"One of 'all', 'none', 'newest', 'oldest' to specify which form submissions should be fetched. Default is 'newest'."}
   * @paramDef {"type":"Boolean","label":"Show List Memberships","name":"showListMemberships","uiComponent":{"type":"TOGGLE"},"description":"Boolean 'true' or 'false' to indicate whether current list memberships should be fetched for the contact. Default is 'false'."}
   *
   * @returns {Contacts}
   * @sampleResult {"has-more":false,"contacts":[{"vid":65333232777,"merge-audits":[],"addedAt":1728302373637,"merged-vids":[],"is-contact":true,"form-submissions":[],"portal-id":47634236,"list-memberships":[],"identity-profiles":[{"vid":65333232777,"saved-at-timestamp":1728302373637,"identities":[{"is-primary":true,"type":"EMAIL","value":"bh@hubspot.com","timestamp":1728302373057}],"deleted-changed-timestamp":0}],"canonical-vid":65333232777,"properties":{"firstname":{"value":"Brian"},"lastname":{"value":"Halligan"},"company":{"value":"HubSpot"}}}],"vid-offset":67412409230}
   */
  async getAllContacts(count, vidOffset, property, propertyMode, formSubmissionMode, showListMemberships) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/contacts/v1/lists/all/contacts/all`,
      method: 'get',
      query: {
        count,
        vidOffset,
        property,
        propertyMode,
        formSubmissionMode,
        showListMemberships,
      },
      logTag: 'getAllContacts',
    })
  }

  /**
   * @typedef {Object} AssociatedProperty
   * @property {String} value
   */

  /**
   * @typedef {Object} AssociatedCompany
   * @property {Number} companyId
   * @property {Number} portalId
   * @property {Object.<String, AssociatedProperty>} properties
   */

  /**
   * @typedef {Object} ContactInfo
   * @property {Number} vid
   * @property {Array.<Object>} mergeAudits
   * @property {Array.<Number>} mergedVids
   * @property {Boolean} isContact
   * @property {Array.<Object>} formSubmissions
   * @property {AssociatedCompany} associatedCompany
   * @property {Number} portalId
   * @property {Array.<Membership>} listMemberships
   * @property {Array.<IdentityProfile>} identityProfiles
   * @property {Number} canonicalVid
   * @property {Object.<String, PropertyWithVersions>} properties
   */

  /**
   * @description Retrieves detailed information about a single contact using their unique HubSpot ID (vid). Returns comprehensive contact data including properties with version history, form submissions, list memberships, and associated company information when available.
   *
   * @route POST /get-contact-by-id
   * @operationName Get Contact By ID
   * @category Contact Management
   *
   * @appearanceColor #fe8834 #ff5b35
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes crm.objects.contacts.read
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"vid","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"Unique identifier for a particular contact. In HubSpot's contact system, contact ID's are called 'vid', as you can see in the API output."}
   * @paramDef {"type":"Array.<String>","label":"Properties","name":"property","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"By default, all valued properties will be included. If you include the 'property' parameter, then the returned data will only include the property or properties that you request. You can include this parameter multiple times to specify multiple properties. The 'lastmodifieddate' and 'associatedcompanyid' will always be included, even if not specified. Keep in mind that only properties that have a value will be included in the response, even if specified in the URL."}
   * @paramDef {"type":"String","label":"Property Mode","name":"propertyMode","uiComponent":{"type":"DROPDOWN","options":{"values":["value_only","value_and_history"]}},"description":"One of 'value_only' or 'value_and_history' to specify if the current value for a property should be fetched, or the value and all the historical values for that property. Default is 'value_and_history'."}
   * @paramDef {"type":"String","label":"Form Submission Mode","name":"formSubmissionMode","uiComponent":{"type":"DROPDOWN","options":{"values":["all","none","newest","oldest"]}},"description":"One of 'all', 'none', 'newest', 'oldest' to specify which form submissions should be fetched. Default is 'all'."}
   * @paramDef {"type":"Boolean","label":"Show List Memberships","name":"showListMemberships","uiComponent":{"type":"TOGGLE"},"description":"Boolean 'true' or 'false' to indicate whether current list memberships should be fetched for the contact. Default is 'true'."}
   *
   * @returns {ContactInfo}
   * @sampleResult {"vid":66626343716,"merge-audits":[],"merged-vids":[],"is-contact":true,"form-submissions":[],"associated-company":{"company-id":23613829028,"portal-id":47634236,"properties":{"name":{"value":"HubSpot"},"domain":{"value":"hubspot.com"},"city":{"value":"Cambridge"}}},"portal-id":47634236,"list-memberships":[],"identity-profiles":[{"vid":66626343716,"saved-at-timestamp":1728640106669,"identities":[{"is-primary":true,"type":"EMAIL","value":"some@hubspot.com","timestamp":1728640106552}],"deleted-changed-timestamp":0}],"canonical-vid":66626343716,"properties":{"firstname":{"value":"Some"},"email":{"value":"some@hubspot.com"},"lifecyclestage":{"value":"opportunity"}}}
   *
   * @throws {Error} Returns a 404 is there is no contact with that vid.
   */
  async getContactById(vid, property, propertyMode, formSubmissionMode, showListMemberships) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/contacts/v1/contact/vid/${ vid }/profile`,
      method: 'get',
      query: {
        property,
        propertyMode,
        formSubmissionMode,
        showListMemberships,
      },
      logTag: 'getContactById',
    })
  }

  /**
   * @description Retrieves detailed contact information by email address. This method searches for and returns a single contact record matching the provided email, including all property data, form submissions, and associated company details.
   *
   * @route POST /get-contact-by-email
   * @operationName Get Contact By Email
   * @category Contact Management
   *
   * @appearanceColor #fe8834 #ff5b35
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes crm.objects.contacts.read
   *
   * @paramDef {"type":"String","label":"Contact Email","name":"contact_email","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The email address for the contact you're searching for."}
   * @paramDef {"type":"Array.<String>","label":"Properties","name":"property","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"By default, all valued properties will be included. If you include the 'property' parameter, then the returned data will only include the property or properties that you request. You can include this parameter multiple times to specify multiple properties. The 'lastmodifieddate' and 'associatedcompanyid' will always be included, even if not specified. Keep in mind that only properties that have a value will be included in the response, even if specified in the URL."}
   * @paramDef {"type":"String","label":"Property Mode","name":"propertyMode","uiComponent":{"type":"DROPDOWN","options":{"values":["value_only","value_and_history"]}},"description":"One of 'value_only' or 'value_and_history' to specify if the current value for a property should be fetched, or the value and all the historical values for that property. Default is 'value_and_history'."}
   * @paramDef {"type":"String","label":"Form Submission Mode","name":"formSubmissionMode","uiComponent":{"type":"DROPDOWN","options":{"values":["all","none","newest","oldest"]}},"description":"One of 'all', 'none', 'newest', 'oldest' to specify which form submissions should be fetched. Default is 'all'."}
   * @paramDef {"type":"Boolean","label":"Show List Memberships","name":"showListMemberships","uiComponent":{"type":"TOGGLE"},"description":"Boolean 'true' or 'false' to indicate whether current list memberships should be fetched for the contact. Default is 'true'."}
   *
   * @returns {ContactInfo}
   * @sampleResult {"vid":66626343716,"merge-audits":[],"merged-vids":[],"is-contact":true,"form-submissions":[],"associated-company":{"company-id":23613829028,"portal-id":47634236,"properties":{"name":{"value":"HubSpot"},"domain":{"value":"hubspot.com"}}},"portal-id":47634236,"list-memberships":[],"identity-profiles":[{"vid":66626343716,"saved-at-timestamp":1728640106669,"identities":[{"is-primary":true,"type":"EMAIL","value":"some@hubspot.com","timestamp":1728640106552}],"deleted-changed-timestamp":0}],"canonical-vid":66626343716,"properties":{"firstname":{"value":"Some"},"email":{"value":"some@hubspot.com"},"lifecyclestage":{"value":"opportunity"}}}
   *
   * @throws {Error} Returns a 404 response if no contact with the requested email address exists in HubSpot.
   */
  async getContactByEmail(contact_email, property, propertyMode, formSubmissionMode, showListMemberships) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/contacts/v1/contact/email/${ contact_email }/profile`,
      method: 'get',
      query: {
        property,
        propertyMode,
        formSubmissionMode,
        showListMemberships,
      },
      logTag: 'getContactByEmail',
    })
  }

  /**
   * @typedef {Object} PropertyEntry
   * @property {String} property
   * @property {String} value
   */

  /**
   * @description Creates a new contact record in your HubSpot account with the specified properties. The contact will be assigned a unique visitor ID (vid) for future reference. At least one property must be provided to create the contact successfully.
   *
   * @route POST /create-contact
   * @operationName Create Contact
   * @category Contact Management
   *
   * @appearanceColor #fe8834 #ff5b35
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes crm.objects.contacts.write
   *
   * @paramDef {"type":"Array.<PropertyEntry>","label":"Properties","name":"properties","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A list of contact properties that you want to set for the new contact record. Each entry in the list must include the internal name of the property, and the value that you want to set for that property. Note: You must include at least one property for the new contact or you will receive an error."}
   *
   * @returns {ContactInfo}
   * @sampleResult {"vid":68758030679,"merge-audits":[],"merged-vids":[],"is-contact":true,"form-submissions":[],"portal-id":47634236,"list-memberships":[],"identity-profiles":[{"vid":68758030679,"saved-at-timestamp":1729157940925,"identities":[{"is-primary":true,"type":"EMAIL","value":"annh@hubspot.com","timestamp":1729157940726}],"deleted-changed-timestamp":0}],"canonical-vid":68758030679,"properties":{"firstname":{"value":"Ann"},"email":{"value":"annh@hubspot.com"},"lifecyclestage":{"value":"lead"}}}
   *
   * @throws {Error} Returns a 400 error when there is a problem with the data in the request body, including when there are no properties included in the request data.
   * @throws {Error} Returns a 409 Conflict if there is an existing contact with the email address included in the request. The response body will have the identityProfile details of the contact, which will include the vid of the existing record.
   */
  async createContact(properties) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/contacts/v1/contact`,
      method: 'post',
      body: { properties },
      logTag: 'createContact',
    })
  }

  /**
   * @description Updates an existing contact in HubSpot with new property values. Only the properties specified in the request will be updated, leaving all other contact data unchanged. Property updates include optional timestamps for historical tracking.
   *
   * @route PUT /update-contact
   * @operationName Update Contact
   * @category Contact Management
   *
   * @appearanceColor #fe8834 #ff5b35
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes crm.objects.contacts.write
   *
   * @paramDef {"type":"String","label":"Contact VID","name":"vid","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The VID of the specific contact you want to update."}
   * @paramDef {"type":"Array.<PropertyEntry>","label":"Contact JSON","name":"properties","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"This is JSON that represents a contact that you're updating. This should be of the format seen below in the code sample given. Properties can have an optional timestamp indicating when the property was set (this will be the current time if not specified)."}
   *
   * @returns {void}
   *
   * @throws {Error} Returns a 400 if there is a problem with the data in the request body. You'll get a message in the response body with more details.
   * @throws {Error} Returns a 401 when an unauthorized request is made, such as an expired access token.
   * @throws {Error} Returns a 404 when there is no existing contact with the specified vid (visitor ID).
   * @throws {Error} Returns a 500 when an internal server error occurs.
   */
  async updateContact(vid, properties) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/contacts/v1/contact/vid/${ vid }/profile`,
      method: 'post',
      body: { properties },
      logTag: 'updateContact',
    })
  }

  /**
   * @typedef {Object} DeleteContactResponse
   * @property {Number} vid
   * @property {Boolean} deleted
   * @property {String} reason
   */

  /**
   * @description Permanently removes a contact from your HubSpot account. Note that if a contact with the same email address interacts with your portal again through forms or other channels, they will be automatically recreated in the system.
   *
   * @route DELETE /delete-contact
   * @operationName Delete Contact
   * @category Contact Management
   *
   * @appearanceColor #fe8834 #ff5b35
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes crm.objects.contacts.write
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contact_id","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"You must pass the Contact's ID that you're deleting in the request URL."}
   *
   * @returns {DeleteContactResponse}
   * @sampleResult {"vid":66907555176,"reason":"OK","deleted":true}
   *
   * @throws {Error} Returns a 401 when an unauthorized request is made.
   * @throws {Error} Returns a 404 when the contact vid does not exist.
   * @throws {Error} Returns a 500 when an internal server error occurs.
   */
  async deleteContact(contact_id) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/contacts/v1/contact/vid/${ contact_id }`,
      method: 'delete',
      logTag: 'deleteContact',
    })
  }

  /**
   * @typedef {Object} SearchContactsResponse
   * @property {Number} total
   * @property {Number} offset
   * @property {String} query
   * @property {Boolean} hasMore
   * @property {Array.<ContactInfo>} contacts
   */

  /**
   * @description Searches for contacts across multiple fields including email address, name, phone number, and company. Supports partial matching and returns paginated results with customizable property selection and sorting options.
   *
   * @route POST /search-contacts
   * @operationName Search Contacts
   * @category Contact Management
   *
   * @appearanceColor #fe8834 #ff5b35
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes crm.objects.contacts.read
   *
   * @paramDef {"type":"String","label":"Search Query","name":"q","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The search term for what you're searching for. You can use all of a word or just parts of a word as well. For example, if you're searching for contacts with 'hubspot' in their name or email, searching for 'hub' would also return contacts with 'hubspot' in their email address."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"This parameter lets you specify the amount of contacts to return in your API call. The default for this parameter (if it isn't specified) is 20 contacts. The maximum amount of contacts you can have returned to you via this parameter is 100."}
   * @paramDef {"type":"String","label":"Offset","name":"offset","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"This parameter is used to page through the results. Every call to this endpoint will return an offset value. This value is used in the 'offset=parameter' of the next call to get the next page of contacts."}
   * @paramDef {"type":"Array.<String>","label":"Properties","name":"property","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"If you include the 'property' parameter, then the properties in the 'contact' object in the returned data will only include the property or properties that you request."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"This parameter takes in an internal property name (e.g. vid) and sorts contact search results by that field."}
   * @paramDef {"type":"String","label":"Order","name":"order","uiComponent":{"type":"DROPDOWN","options":{"values":["DESC","ASC"]}},"description":"This parameter accepts 'DESC' or 'ASC' as values (defaults to 'DESC') to order results by the property specified in 'sort' parameter. As such, this parameter will only work when used in conjunction with 'sort'."}
   *
   * @returns {SearchContactsResponse}
   * @sampleResult {"total":1,"offset":1,"query":"gag","has-more":false,"contacts":[{"vid":66912979240,"merge-audits":[],"merged-vids":[],"is-contact":true,"form-submissions":[],"portal-id":47634236,"identity-profiles":[{"vid":66912979240,"saved-at-timestamp":0,"identities":[{"is-primary":true,"type":"EMAIL","value":"gaga@gaga.com","timestamp":1728740170682}],"deleted-changed-timestamp":0}],"canonical-vid":66912979240,"properties":{"email":{"value":"gaga@gaga.com"},"lastname":{"value":"gigigi"},"lifecyclestage":{"value":"lead"}}}]}
   */
  async searchContacts(q, count, offset, property, sort, order) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/contacts/v1/search/query`,
      method: 'get',
      query: { q, count, offset, property, sort, order },
      logTag: 'searchContacts',
    })
  }

  /**
   * @typedef {Object} ContactIdentity
   * @property {Number} vid
   * @property {Array.<Number>} linkedVid
   * @property {Array.<Identity>} identity
   */

  /**
   * @typedef {Object} ContactProperty
   * @property {Array.<Number>} sourceVid
   * @property {String} name
   * @property {String} value
   */

  /**
   * @typedef {Object} ContactAtCompany
   * @property {Number} vid
   * @property {Array.<ContactIdentity>} identities
   * @property {Number} canonicalVid
   * @property {Array.<Object>} mergeAudit
   * @property {Array.<Number>} vids
   * @property {Number} portalId
   * @property {Array.<Membership>} listMembership
   * @property {Array.<Object>} stateChanges
   * @property {Object<String, ContactProperty>} properties
   * @property {Array.<Object>} formSubmissions
   * @property {Boolean} isContact
   * @property {Array.<Number>} mergedVids
   */

  /**
   * @typedef {Object} ContactsAtCompany
   * @property {Number} vidOffset
   * @property {Boolean} hasMore
   * @property {Array.<ContactAtCompany>} contacts
   */

  /**
   * @description Retrieves all contacts associated with a specific company in HubSpot. Returns contacts that have their 'associatedcompanyid' property set to the specified company ID, with pagination support for large result sets.
   *
   * @route POST /get-contacts-at-company
   * @operationName Get Contacts At Company
   * @category Contact Management
   *
   * @appearanceColor #fe8834 #ff5b35
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes crm.objects.contacts.read crm.objects.companies.read
   *
   * @paramDef {"type":"String","label":"Company ID","name":"companyId","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The HubSpot company ID that you want to return contacts for."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Specify the number of contacts to return in the API call. Defaults to 20 contacts, maximum is 100."}
   * @paramDef {"type":"Number","label":"VID Offset","name":"vidOffset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Used to get the next page of results. Defaults to 0 for the first page."}
   *
   * @returns {ContactsAtCompany}
   * @sampleResult {"vidOffset":0,"hasMore":false,"contacts":[{"vid":66626343716,"identities":[{"vid":66626343716,"saved-at-timestamp":1728640106669,"identities":[{"is-primary":true,"type":"EMAIL","value":"some@hubspot.com","timestamp":1728640106552}],"deleted-changed-timestamp":0}],"canonical-vid":66626343716,"properties":{"firstname":{"value":"Some"},"email":{"value":"some@hubspot.com"},"associatedcompanyid":{"value":"23613829028"}},"is-contact":true}]}
   */
  async getContactsAtCompany(companyId, count, vidOffset) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/companies/v2/companies/${ companyId }/contacts`,
      method: 'get',
      query: { count, vidOffset },
      logTag: 'getContactsAtCompany',
    })
  }

  /**
   * @typedef {Object} CompanyProperty
   * @property {String} value
   * @property {Number} timestamp
   * @property {String} source
   * @property {String} sourceId
   */

  /**
   * @typedef {Object} Company
   * @property {Number} portalId
   * @property {Number} companyId
   * @property {Boolean} isDeleted
   * @property {Object<String, CompanyProperty>} properties
   * @property {Array.<Object>} additionalDomains
   * @property {Array.<Object>} stateChanges
   */

  /**
   * @typedef {Object} Companies
   * @property {Array.<Company>} companies
   * @property {Boolean} hasMore
   * @property {Number} offset
   */

  /**
   * @description Retrieves all companies from your HubSpot account with pagination support. Returns comprehensive company data including properties, domains, and state changes with customizable property selection and offset-based pagination.
   *
   * @route POST /get-all-companies
   * @operationName Get All Companies
   * @category Company Management
   *
   * @appearanceColor #fe8834 #ff5b35
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes crm.objects.companies.read
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The number of companies to return. Defaults to 100. Maximum is 250."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Used to get the next page of results. Defaults to 0 for the first page."}
   * @paramDef {"type":"Array.<String>","label":"Properties","name":"properties","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Array of property names you want to include in the response. By default all properties are returned."}
   * @paramDef {"type":"Array.<String>","label":"Properties With History","name":"propertiesWithHistory","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Array of property names for which you want to include historical values in addition to current values."}
   *
   * @returns {Companies}
   * @sampleResult {"companies":[{"portalId":47634236,"companyId":23613829028,"isDeleted":false,"properties":{"name":{"value":"HubSpot","timestamp":1728302373711},"domain":{"value":"hubspot.com","timestamp":1728302373711},"city":{"value":"Cambridge","timestamp":1728302373711},"state":{"value":"MA","timestamp":1728302373711}},"additionalDomains":[],"stateChanges":[]}],"hasMore":false,"offset":23613829029}
   */
  async getAllCompanies(limit, offset, properties, propertiesWithHistory) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/companies/v2/companies/paged`,
      method: 'get',
      query: { limit, offset, properties, propertiesWithHistory },
      logTag: 'getAllCompanies',
    })
  }

  /**
   * @description Retrieves detailed information about a specific company using its HubSpot company ID. Returns comprehensive company data including all properties, additional domains, and company state changes.
   *
   * @route POST /get-company-by-id
   * @operationName Get Company By ID
   * @category Company Management
   *
   * @appearanceColor #fe8834 #ff5b35
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes crm.objects.companies.read
   *
   * @paramDef {"type":"String","label":"Company ID","name":"companyId","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The HubSpot company ID that you want to get."}
   *
   * @returns {Company}
   * @sampleResult {"portalId":47634236,"companyId":23613829028,"isDeleted":false,"properties":{"name":{"value":"HubSpot","timestamp":1728302373711},"domain":{"value":"hubspot.com","timestamp":1728302373711},"city":{"value":"Cambridge","timestamp":1728302373711},"state":{"value":"MA","timestamp":1728302373711},"country":{"value":"United States","timestamp":1728302373711},"phone":{"value":"+1 888-482-7768","timestamp":1728302373711}},"additionalDomains":[],"stateChanges":[]}
   */
  async getCompanyById(companyId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/companies/v2/companies/${ companyId }`,
      method: 'get',
      logTag: 'getCompanyById',
    })
  }

  /**
   * @description Creates a new company record in your HubSpot account with the specified properties. Company records help organize and track business relationships, with properties for company details like name, domain, industry, and size.
   *
   * @route POST /create-company
   * @operationName Create Company
   * @category Company Management
   *
   * @appearanceColor #fe8834 #ff5b35
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes crm.objects.companies.write
   *
   * @paramDef {"type":"Array.<PropertyEntry>","label":"Properties","name":"properties","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Array of company properties to set. Each property should have a 'name' (internal property name) and 'value'. At least one property is required to create a company."}
   *
   * @returns {Company}
   * @sampleResult {"portalId":47634236,"companyId":23613829029,"isDeleted":false,"properties":{"name":{"value":"New Company","timestamp":1729157940726},"domain":{"value":"newcompany.com","timestamp":1729157940726},"createdate":{"value":"1729157940726","timestamp":1729157940726}},"additionalDomains":[],"stateChanges":[]}
   */
  async createCompany(properties) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/companies/v2/companies/`,
      method: 'post',
      body: { properties },
      logTag: 'createCompany',
    })
  }

  /**
   * @description Updates an existing company record in HubSpot with new property values. Only the properties specified in the request will be updated, leaving all other company data unchanged.
   *
   * @route PUT /update-company
   * @operationName Update Company
   * @category Company Management
   *
   * @appearanceColor #fe8834 #ff5b35
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes crm.objects.companies.write
   *
   * @paramDef {"type":"String","label":"Company ID","name":"companyId","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The HubSpot company ID that you want to update."}
   * @paramDef {"type":"Array.<PropertyEntry>","label":"Properties","name":"properties","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Array of company properties to update. Each property should have a 'name' (internal property name) and 'value'."}
   *
   * @returns {void}
   */
  async updateCompany(companyId, properties) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/companies/v2/companies/${ companyId }`,
      method: 'put',
      body: { properties },
      logTag: 'updateCompany',
    })
  }

  /**
   * @description Permanently removes a company record from your HubSpot account. This action cannot be undone, and all associated data and relationships will be lost.
   *
   * @route DELETE /delete-company
   * @operationName Delete Company
   * @category Company Management
   *
   * @appearanceColor #fe8834 #ff5b35
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes crm.objects.companies.write
   *
   * @paramDef {"type":"String","label":"Company ID","name":"companyId","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The HubSpot company ID that you want to delete."}
   *
   * @returns {void}
   */
  async deleteCompany(companyId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/companies/v2/companies/${ companyId }`,
      method: 'delete',
      logTag: 'deleteCompany',
    })
  }

  /**
   * @typedef {Object} DealProperty
   * @property {String} value
   * @property {Number} timestamp
   * @property {String} source
   * @property {String} sourceId
   */

  /**
   * @typedef {Object} Deal
   * @property {Number} dealId
   * @property {Number} portalId
   * @property {Boolean} isDeleted
   * @property {Array.<Object>} associations
   * @property {Object<String, DealProperty>} properties
   * @property {Array.<Object>} imports
   * @property {Array.<Object>} stateChanges
   */

  /**
   * @typedef {Object} Deals
   * @property {Array.<Deal>} deals
   * @property {Boolean} hasMore
   * @property {Number} offset
   */

  /**
   * @description Retrieves all deals from your HubSpot account with comprehensive filtering and pagination options. Returns deal records with properties, associations, and state changes, supporting custom property selection and offset-based pagination.
   *
   * @route POST /get-all-deals
   * @operationName Get All Deals
   * @category Deal Management
   *
   * @appearanceColor #fe8834 #ff5b35
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes crm.objects.deals.read
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The number of deals to return. Defaults to 100, maximum is 250."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Used to get the next page of results. Defaults to 0 for the first page."}
   * @paramDef {"type":"Array.<String>","label":"Properties","name":"properties","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Array of property names you want to include in the response. By default all properties are returned."}
   * @paramDef {"type":"Array.<String>","label":"Properties With History","name":"propertiesWithHistory","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Array of property names for which you want to include historical values in addition to current values."}
   * @paramDef {"type":"Boolean","label":"Include Associations","name":"includeAssociations","uiComponent":{"type":"TOGGLE"},"description":"Set to true to include associated record IDs for each deal."}
   *
   * @returns {Deals}
   * @sampleResult {"deals":[{"dealId":23259329303,"portalId":47634236,"isDeleted":false,"associations":{"associatedVids":[66626343716],"associatedCompanyIds":[23613829028]},"properties":{"dealname":{"value":"New Deal","timestamp":1729077437404},"amount":{"value":"500","timestamp":1729077437404},"dealstage":{"value":"appointmentscheduled","timestamp":1729077437404},"pipeline":{"value":"default","timestamp":1729077437404}},"imports":[],"stateChanges":[]}],"hasMore":false,"offset":23259329304}
   */
  async getAllDeals(limit, offset, properties, propertiesWithHistory, includeAssociations) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/v1/deal/paged`,
      method: 'get',
      query: { limit, offset, properties, propertiesWithHistory, includeAssociations },
      logTag: 'getAllDeals',
    })
  }

  /**
   * @description Retrieves detailed information about a specific deal using its HubSpot deal ID. Returns comprehensive deal data including all properties, associations with contacts and companies, and property version history when requested.
   *
   * @route POST /get-deal-by-id
   * @operationName Get Deal By ID
   * @category Deal Management
   *
   * @appearanceColor #fe8834 #ff5b35
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes crm.objects.deals.read
   *
   * @paramDef {"type":"String","label":"Deal ID","name":"dealId","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The HubSpot deal ID that you want to get."}
   * @paramDef {"type":"Boolean","label":"Include Property Versions","name":"includePropertyVersions","uiComponent":{"type":"TOGGLE"},"description":"Set to true to include the version history for all properties."}
   *
   * @returns {Deal}
   * @sampleResult {"dealId":23259329303,"portalId":47634236,"isDeleted":false,"associations":{"associatedVids":[66626343716],"associatedCompanyIds":[23613829028]},"properties":{"dealname":{"value":"New Deal","timestamp":1729077437404},"amount":{"value":"500","timestamp":1729077437404},"dealstage":{"value":"appointmentscheduled","timestamp":1729077437404},"pipeline":{"value":"default","timestamp":1729077437404},"closedate":{"value":"1729684800000","timestamp":1729077437404}},"imports":[],"stateChanges":[]}
   */
  async getDealById(dealId, includePropertyVersions) {
    const query = includePropertyVersions ? { includePropertyVersions: 'true' } : {}

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/v1/deal/${ dealId }`,
      method: 'get',
      query,
      logTag: 'getDealById',
    })
  }

  /**
   * @description Creates a new deal record in your HubSpot account with the specified properties. Deals represent sales opportunities and can be associated with contacts and companies to track the sales pipeline effectively.
   *
   * @route POST /create-deal
   * @operationName Create Deal
   * @category Deal Management
   *
   * @appearanceColor #fe8834 #ff5b35
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes crm.objects.deals.write
   *
   * @paramDef {"type":"Array.<PropertyEntry>","label":"Properties","name":"properties","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Array of deal properties to set. Each property should have a 'name' (internal property name) and 'value'. Common properties include dealname, amount, dealstage, and pipeline."}
   * @paramDef {"type":"Array.<Number>","label":"Associated Company IDs","name":"associatedCompanyIds","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Array of company IDs to associate with this deal."}
   * @paramDef {"type":"Array.<Number>","label":"Associated Contact VIDs","name":"associatedVids","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Array of contact VIDs to associate with this deal."}
   *
   * @returns {Deal}
   * @sampleResult {"dealId":23259329304,"portalId":47634236,"isDeleted":false,"associations":{"associatedVids":[],"associatedCompanyIds":[]},"properties":{"dealname":{"value":"New Sales Opportunity","timestamp":1729157940726},"amount":{"value":"1000","timestamp":1729157940726},"dealstage":{"value":"appointmentscheduled","timestamp":1729157940726},"pipeline":{"value":"default","timestamp":1729157940726}},"imports":[],"stateChanges":[]}
   */
  async createDeal(properties, associatedCompanyIds, associatedVids) {
    const body = {
      properties,
      associations: {
        associatedCompanyIds: associatedCompanyIds || [],
        associatedVids: associatedVids || [],
      },
    }

    return await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/v1/deal`,
      method: 'post',
      body,
      logTag: 'createDeal',
    })
  }

  /**
   * @description Updates an existing deal record in HubSpot with new property values. Only the properties specified in the request will be updated, leaving all other deal data and associations unchanged.
   *
   * @route PUT /update-deal
   * @operationName Update Deal
   * @category Deal Management
   *
   * @appearanceColor #fe8834 #ff5b35
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes crm.objects.deals.write
   *
   * @paramDef {"type":"String","label":"Deal ID","name":"dealId","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The HubSpot deal ID that you want to update."}
   * @paramDef {"type":"Array.<PropertyEntry>","label":"Properties","name":"properties","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Array of deal properties to update. Each property should have a 'name' (internal property name) and 'value'."}
   *
   * @returns {void}
   */
  async updateDeal(dealId, properties) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/v1/deal/${ dealId }`,
      method: 'put',
      body: { properties },
      logTag: 'updateDeal',
    })
  }

  /**
   * @description Permanently removes a deal record from your HubSpot account. This action cannot be undone, and all associated data and pipeline history will be lost.
   *
   * @route DELETE /delete-deal
   * @operationName Delete Deal
   * @category Deal Management
   *
   * @appearanceColor #fe8834 #ff5b35
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes crm.objects.deals.write
   *
   * @paramDef {"type":"String","label":"Deal ID","name":"dealId","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The HubSpot deal ID that you want to delete."}
   *
   * @returns {void}
   */
  async deleteDeal(dealId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/deals/v1/deal/${ dealId }`,
      method: 'delete',
      logTag: 'deleteDeal',
    })
  }

  /**
   * @typedef {Object} Association
   * @property {Number} fromObjectId
   * @property {Number} toObjectId
   * @property {String} category
   * @property {Number} definitionId
   */

  /**
   * @typedef {Object} AssociationsResponse
   * @property {Array.<Association>} results
   * @property {Boolean} hasMore
   * @property {Number} offset
   */

  /**
   * @description Retrieves all associations for a specific CRM object, showing relationships between contacts, companies, deals, and other record types. Returns detailed association information including definition IDs and categories for relationship mapping.
   *
   * @route POST /get-associations
   * @operationName Get Associations
   * @category Association Management
   *
   * @appearanceColor #fe8834 #ff5b35
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes crm.objects.companies.read crm.objects.contacts.read crm.objects.deals.read tickets e-commerce
   *
   * @paramDef {"type":"String","label":"Object ID","name":"objectId","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The ID of the object you want to get associations for."}
   * @paramDef {"type":"Number","label":"Definition ID","name":"definitionId","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,25,26,27,28,280]}},"description":"The ID of the association definition. Main ones are: 1 - contact to company, 2 - company to contact, 3 - deal to contact, 4 - contact to deal, 5 - deal to company, 6 - company to deal. See the table on the overview page for a list of all these IDs."}
   *
   * @returns {AssociationsResponse}
   * @sampleResult {"results":[{"fromObjectId":66626343716,"toObjectId":23613829028,"category":"HUBSPOT_DEFINED","definitionId":1}],"hasMore":false,"offset":0}
   */
  async getAssociations(objectId, definitionId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/crm-associations/v1/associations/${ objectId }/HUBSPOT_DEFINED/${ definitionId }`,
      method: 'get',
      logTag: 'getAssociations',
    })
  }

  /**
   * @description Creates associations between two CRM objects such as contacts, companies, deals, or tickets. Establishes relationships that help organize and connect related records in your HubSpot CRM.
   *
   * @route PUT /associate-objects
   * @operationName Associate Objects
   * @category Association Management
   *
   * @appearanceColor #fe8834 #ff5b35
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes crm.objects.companies.write crm.objects.contacts.write crm.objects.deals.write tickets e-commerce
   *
   * @paramDef {"type":"String","label":"From Object ID","name":"fromObjectId","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The ID of the object you want to associate from."}
   * @paramDef {"type":"String","label":"To Object ID","name":"toObjectId","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The ID of the object you want to associate to."}
   * @paramDef {"type":"String","label":"Category","name":"category","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The category of the association. Currently, this must be 'HUBSPOT_DEFINED'."}
   * @paramDef {"type":"Number","label":"Definition ID","name":"definitionId","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,25,26,27,28,280]}},"description":"The ID of the association definition. Main ones are: 1 - contact to company, 2 - company to contact, 3 - deal to contact, 4 - contact to deal, 5 - deal to company, 6 - company to deal. See the table on the overview page for a list of all these IDs."}
   *
   * @returns {void}
   */
  async associateObjects(fromObjectId, toObjectId, category, definitionId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/crm-associations/v1/associations`,
      method: 'put',
      body: {
        fromObjectId,
        toObjectId,
        category,
        definitionId,
      },
      logTag: 'associateObjects',
    })
  }

  /**
   * @description Removes existing associations between two CRM objects. This permanently deletes the relationship link between records such as contacts, companies, deals, or tickets without affecting the individual records themselves.
   *
   * @route DELETE /delete-association
   * @operationName Delete Association
   * @category Association Management
   *
   * @appearanceColor #fe8834 #ff5b35
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes crm.objects.companies.write crm.objects.contacts.write crm.objects.deals.write tickets e-commerce
   *
   * @paramDef {"type":"String","label":"From Object ID","name":"fromObjectId","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The ID of the object you want to remove the association from."}
   * @paramDef {"type":"String","label":"To Object ID","name":"toObjectId","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The ID of the currently associated object that you're removing the association from."}
   * @paramDef {"type":"String","label":"Category","name":"category","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The category of the association. Currently, this must be 'HUBSPOT_DEFINED'."}
   * @paramDef {"type":"Number","label":"Definition ID","name":"definitionId","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,25,26,27,28,280]}},"description":"The ID of the association definition. Main ones are: 1 - contact to company, 2 - company to contact, 3 - deal to contact, 4 - contact to deal, 5 - deal to company, 6 - company to deal. See the table on the overview page for a list of all these IDs."}
   *
   * @returns {void}
   */
  async deleteAssociation(fromObjectId, toObjectId, category, definitionId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/crm-associations/v1/associations/delete`,
      method: 'put',
      body: {
        fromObjectId,
        toObjectId,
        category,
        definitionId,
      },
      logTag: 'deleteAssociation',
    })
  }
}

Flowrunner.ServerCode.addService(HubSpotService, [
  {
    order: 0,
    displayName: 'Client ID',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth2 Client ID for HubSpot API integration. Leave empty to use default.',
  },
  {
    order: 1,
    displayName: 'Client Secret',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth2 Client Secret for HubSpot API integration. Leave empty to use default.',
  },
])