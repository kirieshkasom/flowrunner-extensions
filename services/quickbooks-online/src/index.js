'use strict'

const OAUTH_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2'
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const API_BASE_URL_PRODUCTION = 'https://quickbooks.api.intuit.com/v3/company'
const API_BASE_URL_SANDBOX = 'https://sandbox-quickbooks.api.intuit.com/v3/company'
const USER_INFO_URL = 'https://accounts.platform.intuit.com/v1/openid_connect/userinfo'

const DEFAULT_SCOPE_LIST = [
  'com.intuit.quickbooks.accounting',
  'openid',
  'profile',
  'email',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const MINOR_VERSION = '75'
const DEFAULT_MAX_RESULTS = 100
const TOKEN_REALM_DELIMITER = '::realm::'

const ItemTypes = {
  INVENTORY: 'Inventory',
  NON_INVENTORY: 'NonInventory',
  SERVICE: 'Service',
}

const logger = {
  info: (...args) => console.log('[QuickBooks Online Service] info:', ...args),
  debug: (...args) => console.log('[QuickBooks Online Service] debug:', ...args),
  error: (...args) => console.log('[QuickBooks Online Service] error:', ...args),
  warn: (...args) => console.log('[QuickBooks Online Service] warn:', ...args),
}

function cleanupObject(data) {
  const result = {}

  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null && data[key] !== '') {
      result[key] = data[key]
    }
  })

  return Object.keys(result).length > 0 ? result : undefined
}

function escapeQueryValue(value) {
  if (typeof value !== 'string') return value

  return value.replace(/'/g, "\\'")
}

/**
 * @requireOAuth
 * @integrationName QuickBooks Online
 * @integrationIcon /icon.svg
 */
class QuickBooksOnlineService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
    this.apiBaseUrl = config.environment === 'Sandbox' ? API_BASE_URL_SANDBOX : API_BASE_URL_PRODUCTION
  }

  // ==================== Private Helpers ====================

  #getCompositeToken() {
    const compositeToken = this.request.headers['oauth-access-token']

    if (!compositeToken) {
      throw new Error('Access token is not available. Please reconnect your QuickBooks Online account.')
    }

    return compositeToken
  }

  #getAccessTokenHeader() {
    const compositeToken = this.#getCompositeToken()
    const accessToken = compositeToken.split(TOKEN_REALM_DELIMITER)[0]

    return { Authorization: `Bearer ${ accessToken }` }
  }

  #getSecretTokenHeader() {
    const credentials = Buffer.from(`${ this.clientId }:${ this.clientSecret }`).toString('base64')

    return { Authorization: `Basic ${ credentials }` }
  }

  #getRealmId() {
    const compositeToken = this.#getCompositeToken()
    const realmId = compositeToken.split(TOKEN_REALM_DELIMITER)[1]

    if (!realmId) {
      throw new Error('Company ID (realmId) is not available. Please reconnect your QuickBooks Online account.')
    }

    return realmId
  }

  #getBaseUrl() {
    return `${ this.apiBaseUrl }/${ this.#getRealmId() }`
  }

  async #apiRequest({ url, method, body, query, logTag, headers }) {
    method = method || 'get'

    query = {
      ...cleanupObject(query || {}),
      minorversion: MINOR_VERSION,
    }

    logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

    try {
      const request = Flowrunner.Request[method](url)
        .set(this.#getAccessTokenHeader())
        .set({ Accept: 'application/json' })
        .query(query)

      if (headers) {
        request.set(headers)
      }

      if (body) {
        request.set({ 'Content-Type': 'application/json' })

        return await request.send(body)
      }

      return await request
    } catch (error) {
      const body = error?.body || error?.message
      const faultErrors = body?.fault?.error

      if (Array.isArray(faultErrors) && faultErrors.length > 0) {
        const faultMessage = faultErrors.map(e => `${ e.message }${ e.detail ? ` - ${ e.detail }` : '' }`).join('; ')

        logger.error(`${ logTag } - QBO fault: ${ faultMessage }`)
        throw new Error(faultMessage)
      }

      logger.error(`${ logTag } - api error:`, typeof error === 'object' ? JSON.stringify(error) : error)
      throw error
    }
  }

  async #getEntitySyncToken(entityType, entityId) {
    const response = await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/${ entityType }/${ entityId }`,
      logTag: `getEntitySyncToken:${ entityType }`,
    })

    const entity = response[entityType]

    if (!entity) {
      throw new Error(`${ entityType } with ID "${ entityId }" not found.`)
    }

    return entity.SyncToken
  }

  // ==================== OAuth2 System Methods ====================

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('scope', this.scopes)
    params.append('response_type', 'code')

    return `${ OAUTH_AUTH_URL }?${ params.toString() }`
  }

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    const code = callbackObject.code
    const realmId = callbackObject.realmId

    if (!realmId) {
      throw new Error('Company ID (realmId) was not provided in the OAuth callback.')
    }

    const params = new URLSearchParams()

    params.append('grant_type', 'authorization_code')
    params.append('code', code)
    params.append('redirect_uri', callbackObject.redirectURI)

    const tokenResponse = await Flowrunner.Request.post(TOKEN_URL)
      .set(this.#getSecretTokenHeader())
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    let connectionIdentityName = 'QuickBooks Online Company'

    try {
      const userInfo = await Flowrunner.Request.get(USER_INFO_URL)
        .set({ Authorization: `Bearer ${ tokenResponse.access_token }` })
        .set({ Accept: 'application/json' })

      if (userInfo.givenName || userInfo.familyName) {
        connectionIdentityName = [userInfo.givenName, userInfo.familyName].filter(Boolean).join(' ')
      } else if (userInfo.email) {
        connectionIdentityName = userInfo.email
      }
    } catch (e) {
      logger.warn('executeCallback - could not fetch user info:', e.message)
    }

    return {
      token: `${ tokenResponse.access_token }${ TOKEN_REALM_DELIMITER }${ realmId }`,
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token,
      connectionIdentityName,
      connectionIdentityImageURL: null,
      overwrite: true,
      userData: {
        realmId,
      },
    }
  }

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    const realmId = this.#getRealmId()

    const params = new URLSearchParams()

    params.append('grant_type', 'refresh_token')
    params.append('refresh_token', refreshToken)

    const response = await Flowrunner.Request.post(TOKEN_URL)
      .set(this.#getSecretTokenHeader())
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    return {
      token: `${ response.access_token }${ TOKEN_REALM_DELIMITER }${ realmId }`,
      expirationInSeconds: response.expires_in,
      refreshToken: response.refresh_token || refreshToken,
    }
  }

  // ==================== Customers ====================

  /**
   * @operationName Create Customer
   * @category Customers
   * @description Creates a new customer in QuickBooks Online. Customers represent the people or companies you sell products and services to. The display name must be unique across all customers, vendors, and employees.
   *
   * @route POST /create-customer
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","required":true,"description":"Unique display name for the customer. Must be unique across customers, vendors, and employees."}
   * @paramDef {"type":"String","label":"First Name","name":"givenName","description":"First name of the customer."}
   * @paramDef {"type":"String","label":"Last Name","name":"familyName","description":"Last name of the customer."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"Name of the company associated with the customer."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Primary email address for the customer."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Primary phone number for the customer."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free-form notes about the customer."}
   *
   * @returns {Object}
   * @sampleResult {"Customer":{"Id":"123","DisplayName":"John Smith","GivenName":"John","FamilyName":"Smith","CompanyName":"Smith Corp","PrimaryEmailAddr":{"Address":"john@smith.com"},"PrimaryPhone":{"FreeFormNumber":"555-1234"},"Active":true,"Balance":0,"SyncToken":"0","domain":"QBO","sparse":false}}
   */
  async createCustomer(displayName, givenName, familyName, companyName, email, phone, notes) {
    if (!displayName) {
      throw new Error('"Display Name" is required.')
    }

    const body = cleanupObject({
      DisplayName: displayName,
      GivenName: givenName,
      FamilyName: familyName,
      CompanyName: companyName,
      PrimaryEmailAddr: email ? { Address: email } : undefined,
      PrimaryPhone: phone ? { FreeFormNumber: phone } : undefined,
      Notes: notes,
    })

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/customer`,
      method: 'post',
      body,
      logTag: 'createCustomer',
    })
  }

  /**
   * @operationName Get Customer
   * @category Customers
   * @description Retrieves a single customer by ID from QuickBooks Online. Returns the full customer record including contact information, balance, and metadata.
   *
   * @route POST /get-customer
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The customer to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"Customer":{"Id":"123","DisplayName":"John Smith","GivenName":"John","FamilyName":"Smith","CompanyName":"Smith Corp","PrimaryEmailAddr":{"Address":"john@smith.com"},"PrimaryPhone":{"FreeFormNumber":"555-1234"},"Active":true,"Balance":150.00,"SyncToken":"2","domain":"QBO"}}
   */
  async getCustomer(customerId) {
    if (!customerId) {
      throw new Error('"Customer" is required.')
    }

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/customer/${ customerId }`,
      logTag: 'getCustomer',
    })
  }

  /**
   * @operationName Update Customer
   * @category Customers
   * @description Updates an existing customer in QuickBooks Online using a sparse update. Only the fields you provide will be changed; all other fields remain unchanged.
   *
   * @route POST /update-customer
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The customer to update."}
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","description":"Updated display name for the customer."}
   * @paramDef {"type":"String","label":"First Name","name":"givenName","description":"Updated first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"familyName","description":"Updated last name."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"Updated company name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Updated email address."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Updated phone number."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated notes about the customer."}
   *
   * @returns {Object}
   * @sampleResult {"Customer":{"Id":"123","DisplayName":"John Smith Updated","GivenName":"John","FamilyName":"Smith","CompanyName":"Smith Corp","PrimaryEmailAddr":{"Address":"john@smith.com"},"Active":true,"Balance":150.00,"SyncToken":"3","sparse":true}}
   */
  async updateCustomer(customerId, displayName, givenName, familyName, companyName, email, phone, notes) {
    if (!customerId) {
      throw new Error('"Customer" is required.')
    }

    const syncToken = await this.#getEntitySyncToken('Customer', customerId)

    const body = cleanupObject({
      Id: customerId,
      SyncToken: syncToken,
      sparse: true,
      DisplayName: displayName,
      GivenName: givenName,
      FamilyName: familyName,
      CompanyName: companyName,
      PrimaryEmailAddr: email ? { Address: email } : undefined,
      PrimaryPhone: phone ? { FreeFormNumber: phone } : undefined,
      Notes: notes,
    })

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/customer`,
      method: 'post',
      body,
      logTag: 'updateCustomer',
    })
  }

  /**
   * @operationName Deactivate Customer
   * @category Customers
   * @description Deactivates a customer in QuickBooks Online by setting their Active status to false. QuickBooks does not support permanent deletion of customers; deactivation hides them from active lists while preserving historical data.
   *
   * @route POST /deactivate-customer
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The customer to deactivate."}
   *
   * @returns {Object}
   * @sampleResult {"Customer":{"Id":"123","DisplayName":"John Smith","Active":false,"SyncToken":"4","sparse":true}}
   */
  async deactivateCustomer(customerId) {
    if (!customerId) {
      throw new Error('"Customer" is required.')
    }

    const syncToken = await this.#getEntitySyncToken('Customer', customerId)

    const body = {
      Id: customerId,
      SyncToken: syncToken,
      sparse: true,
      Active: false,
    }

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/customer`,
      method: 'post',
      body,
      logTag: 'deactivateCustomer',
    })
  }

  /**
   * @operationName List Customers
   * @category Customers
   * @description Queries customers in QuickBooks Online with optional search filtering. Search matches against the DisplayName field. Results are paginated and sorted by DisplayName.
   *
   * @route POST /list-customers
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search text to filter customers by display name."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of customers to return, up to 1000. Defaults to 100."}
   * @paramDef {"type":"Number","label":"Start Position","name":"startPosition","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Starting position for pagination, 1-based. Defaults to 1."}
   *
   * @returns {Object}
   * @sampleResult {"QueryResponse":{"Customer":[{"Id":"123","DisplayName":"John Smith","Active":true,"Balance":150.00},{"Id":"124","DisplayName":"Jane Doe","Active":true,"Balance":0}],"startPosition":1,"maxResults":2,"totalCount":2}}
   */
  async listCustomers(search, maxResults, startPosition) {
    let queryStr = 'SELECT * FROM Customer'
    const filters = []

    if (search) {
      filters.push(`DisplayName LIKE '%${ escapeQueryValue(search) }%'`)
    }

    if (filters.length > 0) {
      queryStr += ` WHERE ${ filters.join(' AND ') }`
    }

    queryStr += ' ORDERBY DisplayName'
    queryStr += ` MAXRESULTS ${ maxResults || DEFAULT_MAX_RESULTS }`
    queryStr += ` STARTPOSITION ${ startPosition || 1 }`

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/query`,
      query: { query: queryStr },
      logTag: 'listCustomers',
    })
  }

  // ==================== Invoices ====================

  /**
   * @operationName Create Invoice
   * @category Invoices
   * @description Creates a new invoice in QuickBooks Online for a specified customer. Line items define the products or services being invoiced. Each line item should include an ItemRef (from the Items dictionary), UnitPrice, and Qty.
   *
   * @route POST /create-invoice
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The customer to invoice."}
   * @paramDef {"type":"Array<Object>","label":"Line Items","name":"lineItems","required":true,"description":"Array of line items. Each item should have: DetailType (SalesItemLineDetail), Amount, and SalesItemLineDetail with ItemRef, UnitPrice, Qty."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Payment due date for the invoice in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"Transaction Date","name":"txnDate","uiComponent":{"type":"DATE_PICKER"},"description":"Date of the transaction. Defaults to today if not specified."}
   * @paramDef {"type":"String","label":"Private Note","name":"privateNote","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A private note that is not visible to the customer."}
   *
   * @returns {Object}
   * @sampleResult {"Invoice":{"Id":"456","DocNumber":"1001","TxnDate":"2025-01-15","DueDate":"2025-02-15","TotalAmt":500.00,"Balance":500.00,"CustomerRef":{"value":"123","name":"John Smith"},"Line":[{"Id":"1","DetailType":"SalesItemLineDetail","Amount":500.00,"SalesItemLineDetail":{"ItemRef":{"value":"10","name":"Widget"},"UnitPrice":100,"Qty":5}}],"SyncToken":"0"}}
   */
  async createInvoice(customerId, lineItems, dueDate, txnDate, privateNote) {
    if (!customerId) {
      throw new Error('"Customer" is required.')
    }

    if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
      throw new Error('"Line Items" is required and must be a non-empty array.')
    }

    const body = cleanupObject({
      CustomerRef: { value: customerId },
      Line: lineItems,
      DueDate: dueDate,
      TxnDate: txnDate,
      PrivateNote: privateNote,
    })

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/invoice`,
      method: 'post',
      body,
      logTag: 'createInvoice',
    })
  }

  /**
   * @operationName Get Invoice
   * @category Invoices
   * @description Retrieves a single invoice by ID from QuickBooks Online. Returns the full invoice record including line items, customer reference, amounts, and status.
   *
   * @route POST /get-invoice
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"getInvoicesDictionary","description":"The invoice to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"Invoice":{"Id":"456","DocNumber":"1001","TxnDate":"2025-01-15","DueDate":"2025-02-15","TotalAmt":500.00,"Balance":500.00,"CustomerRef":{"value":"123","name":"John Smith"},"Line":[{"Id":"1","DetailType":"SalesItemLineDetail","Amount":500.00,"SalesItemLineDetail":{"ItemRef":{"value":"10","name":"Widget"},"UnitPrice":100,"Qty":5}}],"SyncToken":"2"}}
   */
  async getInvoice(invoiceId) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required.')
    }

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/invoice/${ invoiceId }`,
      logTag: 'getInvoice',
    })
  }

  /**
   * @operationName Update Invoice
   * @category Invoices
   * @description Updates an existing invoice in QuickBooks Online using a sparse update. Only the fields you provide will be changed. You can update the customer, line items, dates, and notes.
   *
   * @route POST /update-invoice
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"getInvoicesDictionary","description":"The invoice to update."}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","dictionary":"getCustomersDictionary","description":"Updated customer for the invoice."}
   * @paramDef {"type":"Array<Object>","label":"Line Items","name":"lineItems","description":"Updated line items array. Replaces all existing line items when provided."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Updated payment due date in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"Private Note","name":"privateNote","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated private note."}
   *
   * @returns {Object}
   * @sampleResult {"Invoice":{"Id":"456","DocNumber":"1001","TxnDate":"2025-01-15","DueDate":"2025-03-01","TotalAmt":750.00,"Balance":750.00,"CustomerRef":{"value":"123","name":"John Smith"},"SyncToken":"3","sparse":true}}
   */
  async updateInvoice(invoiceId, customerId, lineItems, dueDate, privateNote) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required.')
    }

    const syncToken = await this.#getEntitySyncToken('Invoice', invoiceId)

    const body = cleanupObject({
      Id: invoiceId,
      SyncToken: syncToken,
      sparse: true,
      CustomerRef: customerId ? { value: customerId } : undefined,
      Line: lineItems,
      DueDate: dueDate,
      PrivateNote: privateNote,
    })

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/invoice`,
      method: 'post',
      body,
      logTag: 'updateInvoice',
    })
  }

  /**
   * @operationName Delete Invoice
   * @category Invoices
   * @description Permanently deletes an invoice from QuickBooks Online. This action cannot be undone. The invoice must not have any payments applied to it.
   *
   * @route POST /delete-invoice
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"getInvoicesDictionary","description":"The invoice to delete."}
   *
   * @returns {Object}
   * @sampleResult {"Invoice":{"Id":"456","domain":"QBO","status":"Deleted"}}
   */
  async deleteInvoice(invoiceId) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required.')
    }

    const syncToken = await this.#getEntitySyncToken('Invoice', invoiceId)

    const body = {
      Id: invoiceId,
      SyncToken: syncToken,
    }

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/invoice`,
      method: 'post',
      body,
      query: { operation: 'delete' },
      logTag: 'deleteInvoice',
    })
  }

  /**
   * @operationName Void Invoice
   * @category Invoices
   * @description Voids an invoice in QuickBooks Online. Voiding sets the invoice balance to zero while preserving the record for audit purposes. This is preferred over deletion when you need to maintain a paper trail.
   *
   * @route POST /void-invoice
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"getInvoicesDictionary","description":"The invoice to void."}
   *
   * @returns {Object}
   * @sampleResult {"Invoice":{"Id":"456","DocNumber":"1001","TotalAmt":0,"Balance":0,"SyncToken":"4"}}
   */
  async voidInvoice(invoiceId) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required.')
    }

    const syncToken = await this.#getEntitySyncToken('Invoice', invoiceId)

    const body = {
      Id: invoiceId,
      SyncToken: syncToken,
    }

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/invoice`,
      method: 'post',
      body,
      query: { operation: 'void' },
      logTag: 'voidInvoice',
    })
  }

  /**
   * @operationName List Invoices
   * @category Invoices
   * @description Queries invoices in QuickBooks Online with optional filtering. Search matches against the DocNumber field. Results are paginated and sorted by transaction date in descending order.
   *
   * @route POST /list-invoices
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search text to filter invoices by document number."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of invoices to return, up to 1000. Defaults to 100."}
   * @paramDef {"type":"Number","label":"Start Position","name":"startPosition","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Starting position for pagination, 1-based. Defaults to 1."}
   *
   * @returns {Object}
   * @sampleResult {"QueryResponse":{"Invoice":[{"Id":"456","DocNumber":"1001","TxnDate":"2025-01-15","TotalAmt":500.00,"Balance":500.00,"CustomerRef":{"value":"123","name":"John Smith"}},{"Id":"457","DocNumber":"1002","TxnDate":"2025-01-20","TotalAmt":250.00,"Balance":0}],"startPosition":1,"maxResults":2,"totalCount":2}}
   */
  async listInvoices(search, maxResults, startPosition) {
    let queryStr = 'SELECT * FROM Invoice'
    const filters = []

    if (search) {
      filters.push(`DocNumber LIKE '%${ escapeQueryValue(search) }%'`)
    }

    if (filters.length > 0) {
      queryStr += ` WHERE ${ filters.join(' AND ') }`
    }

    queryStr += ' ORDERBY TxnDate DESC'
    queryStr += ` MAXRESULTS ${ maxResults || DEFAULT_MAX_RESULTS }`
    queryStr += ` STARTPOSITION ${ startPosition || 1 }`

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/query`,
      query: { query: queryStr },
      logTag: 'listInvoices',
    })
  }

  /**
   * @operationName Send Invoice
   * @category Invoices
   * @description Sends an invoice to the customer via email. Uses the customer's email address on file or a specified email address. QuickBooks Online generates and sends a professionally formatted email with the invoice details.
   *
   * @route POST /send-invoice
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"getInvoicesDictionary","description":"The invoice to send."}
   * @paramDef {"type":"String","label":"Send To Email","name":"emailTo","description":"Email address to send the invoice to. If not specified, the customer's email on file is used."}
   *
   * @returns {Object}
   * @sampleResult {"Invoice":{"Id":"456","DocNumber":"1001","EmailStatus":"EmailSent","DeliveryInfo":{"DeliveryType":"Email","DeliveryTime":"2025-01-15T10:30:00-07:00"}}}
   */
  async sendInvoice(invoiceId, emailTo) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required.')
    }

    const query = {}

    if (emailTo) {
      query.sendTo = emailTo
    }

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/invoice/${ invoiceId }/send`,
      method: 'post',
      query,
      logTag: 'sendInvoice',
    })
  }

  /**
   * @operationName Get Invoice PDF
   * @category Invoices
   * @description Downloads a PDF representation of an invoice from QuickBooks Online. Returns the invoice as a binary PDF file that can be saved or forwarded.
   *
   * @route POST /get-invoice-pdf
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"getInvoicesDictionary","description":"The invoice to download as PDF."}
   *
   * @returns {Object}
   * @sampleResult {"contentType":"application/pdf","content":"<binary PDF data>"}
   */
  async getInvoicePDF(invoiceId) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required.')
    }

    const url = `${ this.#getBaseUrl() }/invoice/${ invoiceId }/pdf`

    const query = { minorversion: MINOR_VERSION }

    logger.debug(`getInvoicePDF - downloading PDF for invoice: ${ invoiceId }`)

    const pdfData = await Flowrunner.Request.get(url)
      .set(this.#getAccessTokenHeader())
      .set({ Accept: 'application/pdf' })
      .query(query)
      .setEncoding(null)

    return {
      contentType: 'application/pdf',
      content: pdfData,
    }
  }

  // ==================== Items ====================

  /**
   * @operationName Create Item
   * @category Items
   * @description Creates a new item (product or service) in QuickBooks Online. Items represent what your company buys, sells, or resells. You must specify a type (Inventory, NonInventory, or Service) and link it to an income account.
   *
   * @route POST /create-item
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the item. Must be unique."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Inventory","NonInventory","Service"]}},"description":"Type of item: Inventory (tracked stock), NonInventory (purchased/sold but not tracked), or Service."}
   * @paramDef {"type":"Number","label":"Unit Price","name":"unitPrice","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sales price per unit of the item."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Description of the item as it appears on sales forms."}
   * @paramDef {"type":"String","label":"Income Account","name":"incomeAccountId","required":true,"dictionary":"getAccountsDictionary","description":"Income account to track revenue from sales of this item."}
   * @paramDef {"type":"String","label":"Expense Account","name":"expenseAccountId","dictionary":"getAccountsDictionary","description":"Expense account for tracking the cost of this item. Required for Inventory type items."}
   *
   * @returns {Object}
   * @sampleResult {"Item":{"Id":"10","Name":"Widget","Type":"NonInventory","UnitPrice":25.00,"Description":"Standard widget","IncomeAccountRef":{"value":"79","name":"Sales of Product Income"},"Active":true,"SyncToken":"0"}}
   */
  async createItem(name, type, unitPrice, description, incomeAccountId, expenseAccountId) {
    if (!name) {
      throw new Error('"Name" is required.')
    }

    if (!type) {
      throw new Error('"Type" is required.')
    }

    if (!incomeAccountId) {
      throw new Error('"Income Account" is required.')
    }

    const body = cleanupObject({
      Name: name,
      Type: type,
      UnitPrice: unitPrice,
      Description: description,
      IncomeAccountRef: { value: incomeAccountId },
      ExpenseAccountRef: expenseAccountId ? { value: expenseAccountId } : undefined,
    })

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/item`,
      method: 'post',
      body,
      logTag: 'createItem',
    })
  }

  /**
   * @operationName Get Item
   * @category Items
   * @description Retrieves a single item by ID from QuickBooks Online. Returns the full item record including pricing, type, account references, and metadata.
   *
   * @route POST /get-item
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"getItemsDictionary","description":"The item to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"Item":{"Id":"10","Name":"Widget","Type":"NonInventory","UnitPrice":25.00,"Description":"Standard widget","IncomeAccountRef":{"value":"79","name":"Sales of Product Income"},"Active":true,"SyncToken":"1"}}
   */
  async getItem(itemId) {
    if (!itemId) {
      throw new Error('"Item" is required.')
    }

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/item/${ itemId }`,
      logTag: 'getItem',
    })
  }

  /**
   * @operationName Update Item
   * @category Items
   * @description Updates an existing item in QuickBooks Online using a sparse update. Only the fields you provide will be changed; all other fields remain unchanged.
   *
   * @route POST /update-item
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"getItemsDictionary","description":"The item to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Updated name for the item."}
   * @paramDef {"type":"Number","label":"Unit Price","name":"unitPrice","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Updated sales price per unit."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated description of the item."}
   *
   * @returns {Object}
   * @sampleResult {"Item":{"Id":"10","Name":"Widget Pro","Type":"NonInventory","UnitPrice":35.00,"Description":"Premium widget","Active":true,"SyncToken":"2","sparse":true}}
   */
  async updateItem(itemId, name, unitPrice, description) {
    if (!itemId) {
      throw new Error('"Item" is required.')
    }

    const syncToken = await this.#getEntitySyncToken('Item', itemId)

    const body = cleanupObject({
      Id: itemId,
      SyncToken: syncToken,
      sparse: true,
      Name: name,
      UnitPrice: unitPrice,
      Description: description,
    })

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/item`,
      method: 'post',
      body,
      logTag: 'updateItem',
    })
  }

  /**
   * @operationName List Items
   * @category Items
   * @description Queries items in QuickBooks Online with optional filtering by name and type. Results are paginated and sorted by name. Use this to browse your product and service catalog.
   *
   * @route POST /list-items
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search text to filter items by name."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Inventory","NonInventory","Service"]}},"description":"Optional filter by item type."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of items to return, up to 1000. Defaults to 100."}
   * @paramDef {"type":"Number","label":"Start Position","name":"startPosition","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Starting position for pagination, 1-based. Defaults to 1."}
   *
   * @returns {Object}
   * @sampleResult {"QueryResponse":{"Item":[{"Id":"10","Name":"Widget","Type":"NonInventory","UnitPrice":25.00,"Active":true},{"Id":"11","Name":"Consulting","Type":"Service","UnitPrice":150.00,"Active":true}],"startPosition":1,"maxResults":2,"totalCount":2}}
   */
  async listItems(search, type, maxResults, startPosition) {
    let queryStr = 'SELECT * FROM Item'
    const filters = []

    if (search) {
      filters.push(`Name LIKE '%${ escapeQueryValue(search) }%'`)
    }

    if (type) {
      filters.push(`Type = '${ escapeQueryValue(type) }'`)
    }

    if (filters.length > 0) {
      queryStr += ` WHERE ${ filters.join(' AND ') }`
    }

    queryStr += ' ORDERBY Name'
    queryStr += ` MAXRESULTS ${ maxResults || DEFAULT_MAX_RESULTS }`
    queryStr += ` STARTPOSITION ${ startPosition || 1 }`

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/query`,
      query: { query: queryStr },
      logTag: 'listItems',
    })
  }

  // ==================== Payments ====================

  /**
   * @operationName Create Payment
   * @category Payments
   * @description Creates a new payment in QuickBooks Online to record a payment received from a customer. You can optionally link the payment to a specific invoice. If no invoice is specified, the payment is recorded as an unapplied payment.
   *
   * @route POST /create-payment
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The customer who is making the payment."}
   * @paramDef {"type":"Number","label":"Total Amount","name":"totalAmt","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Total payment amount received."}
   * @paramDef {"type":"String","label":"Payment Date","name":"paymentDate","uiComponent":{"type":"DATE_PICKER"},"description":"Date the payment was received. Defaults to today if not specified."}
   * @paramDef {"type":"String","label":"Payment Method","name":"paymentMethodId","dictionary":"getPaymentMethodsDictionary","description":"Method of payment (e.g., Cash, Check, Credit Card)."}
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","dictionary":"getInvoicesDictionary","description":"Optional invoice to apply this payment to. If not specified, payment is recorded as unapplied."}
   *
   * @returns {Object}
   * @sampleResult {"Payment":{"Id":"789","TotalAmt":500.00,"CustomerRef":{"value":"123","name":"John Smith"},"TxnDate":"2025-01-20","PaymentMethodRef":{"value":"1","name":"Check"},"UnappliedAmt":0,"SyncToken":"0"}}
   */
  async createPayment(customerId, totalAmt, paymentDate, paymentMethodId, invoiceId) {
    if (!customerId) {
      throw new Error('"Customer" is required.')
    }

    if (totalAmt === undefined || totalAmt === null) {
      throw new Error('"Total Amount" is required.')
    }

    const body = cleanupObject({
      CustomerRef: { value: customerId },
      TotalAmt: totalAmt,
      TxnDate: paymentDate,
      PaymentMethodRef: paymentMethodId ? { value: paymentMethodId } : undefined,
      Line: invoiceId
        ? [
          {
            Amount: totalAmt,
            LinkedTxn: [
              {
                TxnId: invoiceId,
                TxnType: 'Invoice',
              },
            ],
          },
        ]
        : undefined,
    })

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/payment`,
      method: 'post',
      body,
      logTag: 'createPayment',
    })
  }

  /**
   * @operationName Get Payment
   * @category Payments
   * @description Retrieves a single payment by ID from QuickBooks Online. Returns the full payment record including customer reference, amount, linked transactions, and metadata.
   *
   * @route POST /get-payment
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"The ID of the payment to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"Payment":{"Id":"789","TotalAmt":500.00,"CustomerRef":{"value":"123","name":"John Smith"},"TxnDate":"2025-01-20","PaymentMethodRef":{"value":"1","name":"Check"},"UnappliedAmt":0,"SyncToken":"1"}}
   */
  async getPayment(paymentId) {
    if (!paymentId) {
      throw new Error('"Payment ID" is required.')
    }

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/payment/${ paymentId }`,
      logTag: 'getPayment',
    })
  }

  /**
   * @operationName Delete Payment
   * @category Payments
   * @description Permanently deletes a payment from QuickBooks Online. This action cannot be undone and will reverse any invoice applications associated with this payment.
   *
   * @route POST /delete-payment
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"The ID of the payment to delete."}
   *
   * @returns {Object}
   * @sampleResult {"Payment":{"Id":"789","domain":"QBO","status":"Deleted"}}
   */
  async deletePayment(paymentId) {
    if (!paymentId) {
      throw new Error('"Payment ID" is required.')
    }

    const syncToken = await this.#getEntitySyncToken('Payment', paymentId)

    const body = {
      Id: paymentId,
      SyncToken: syncToken,
    }

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/payment`,
      method: 'post',
      body,
      query: { operation: 'delete' },
      logTag: 'deletePayment',
    })
  }

  /**
   * @operationName Void Payment
   * @category Payments
   * @description Voids a payment in QuickBooks Online. Voiding sets the payment amount to zero while preserving the record for audit purposes. This reverses any invoice applications while maintaining a transaction history.
   *
   * @route POST /void-payment
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"The ID of the payment to void."}
   *
   * @returns {Object}
   * @sampleResult {"Payment":{"Id":"789","TotalAmt":0,"UnappliedAmt":0,"SyncToken":"3"}}
   */
  async voidPayment(paymentId) {
    if (!paymentId) {
      throw new Error('"Payment ID" is required.')
    }

    const syncToken = await this.#getEntitySyncToken('Payment', paymentId)

    const body = {
      Id: paymentId,
      SyncToken: syncToken,
    }

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/payment`,
      method: 'post',
      body,
      query: { operation: 'void' },
      logTag: 'voidPayment',
    })
  }

  /**
   * @operationName List Payments
   * @category Payments
   * @description Queries payments in QuickBooks Online with optional filtering. Results are paginated and sorted by transaction date in descending order. Use this to review payment history.
   *
   * @route POST /list-payments
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Customer","name":"customerId","dictionary":"getCustomersDictionary","description":"Optional filter to show only payments from a specific customer."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of payments to return, up to 1000. Defaults to 100."}
   * @paramDef {"type":"Number","label":"Start Position","name":"startPosition","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Starting position for pagination, 1-based. Defaults to 1."}
   *
   * @returns {Object}
   * @sampleResult {"QueryResponse":{"Payment":[{"Id":"789","TotalAmt":500.00,"CustomerRef":{"value":"123","name":"John Smith"},"TxnDate":"2025-01-20"},{"Id":"790","TotalAmt":250.00,"CustomerRef":{"value":"124","name":"Jane Doe"},"TxnDate":"2025-01-18"}],"startPosition":1,"maxResults":2,"totalCount":2}}
   */
  async listPayments(customerId, maxResults, startPosition) {
    let queryStr = 'SELECT * FROM Payment'
    const filters = []

    if (customerId) {
      filters.push(`CustomerRef = '${ escapeQueryValue(customerId) }'`)
    }

    if (filters.length > 0) {
      queryStr += ` WHERE ${ filters.join(' AND ') }`
    }

    queryStr += ' ORDERBY TxnDate DESC'
    queryStr += ` MAXRESULTS ${ maxResults || DEFAULT_MAX_RESULTS }`
    queryStr += ` STARTPOSITION ${ startPosition || 1 }`

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/query`,
      query: { query: queryStr },
      logTag: 'listPayments',
    })
  }

  // ==================== Dictionary Methods ====================

  /**
   * @registerAs DICTIONARY
   * @operationName Get Customers
   * @description Provides a searchable list of customers for dynamic parameter selection in FlowRunner.
   * @route POST /get-customers-dictionary
   * @paramDef {"type":"getCustomersDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering customers."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"John Smith","value":"123","note":"john@smith.com"}],"cursor":null}
   */
  async getCustomersDictionary(payload) {
    const { search, cursor } = payload || {}

    const page = cursor ? parseInt(cursor) : 1
    const startPos = (page - 1) * DEFAULT_MAX_RESULTS + 1

    let queryStr = 'SELECT * FROM Customer WHERE Active = true'

    if (search) {
      queryStr += ` AND DisplayName LIKE '%${ escapeQueryValue(search) }%'`
    }

    queryStr += ' ORDERBY DisplayName'
    queryStr += ` MAXRESULTS ${ DEFAULT_MAX_RESULTS }`
    queryStr += ` STARTPOSITION ${ startPos }`

    const response = await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/query`,
      query: { query: queryStr },
      logTag: 'getCustomersDictionary',
    })

    const customers = response.QueryResponse?.Customer || []
    const hasMore = customers.length >= DEFAULT_MAX_RESULTS

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: customers.map(customer => ({
        label: customer.DisplayName,
        value: customer.Id,
        note: customer.PrimaryEmailAddr?.Address || customer.PrimaryPhone?.FreeFormNumber || `ID: ${ customer.Id }`,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Invoices
   * @description Provides a searchable list of invoices for dynamic parameter selection in FlowRunner.
   * @route POST /get-invoices-dictionary
   * @paramDef {"type":"getInvoicesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering invoices."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Invoice #1001","value":"456","note":"$500.00 - Paid"}],"cursor":null}
   */
  async getInvoicesDictionary(payload) {
    const { search, cursor } = payload || {}

    const page = cursor ? parseInt(cursor) : 1
    const startPos = (page - 1) * DEFAULT_MAX_RESULTS + 1

    let queryStr = 'SELECT * FROM Invoice'

    if (search) {
      queryStr += ` WHERE DocNumber LIKE '%${ escapeQueryValue(search) }%'`
    }

    queryStr += ' ORDERBY TxnDate DESC'
    queryStr += ` MAXRESULTS ${ DEFAULT_MAX_RESULTS }`
    queryStr += ` STARTPOSITION ${ startPos }`

    const response = await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/query`,
      query: { query: queryStr },
      logTag: 'getInvoicesDictionary',
    })

    const invoices = response.QueryResponse?.Invoice || []
    const hasMore = invoices.length >= DEFAULT_MAX_RESULTS

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: invoices.map(invoice => ({
        label: `Invoice #${ invoice.DocNumber || invoice.Id }`,
        value: invoice.Id,
        note: `$${ Number(invoice.TotalAmt || 0).toFixed(2) } - ${ invoice.Balance > 0 ? 'Open' : 'Paid' }`,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Items
   * @description Provides a searchable list of items (products and services) for dynamic parameter selection in FlowRunner.
   * @route POST /get-items-dictionary
   * @paramDef {"type":"getItemsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering items."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Widget","value":"10","note":"NonInventory - $25.00"}],"cursor":null}
   */
  async getItemsDictionary(payload) {
    const { search, cursor } = payload || {}

    const page = cursor ? parseInt(cursor) : 1
    const startPos = (page - 1) * DEFAULT_MAX_RESULTS + 1

    let queryStr = 'SELECT * FROM Item WHERE Active = true'

    if (search) {
      queryStr += ` AND Name LIKE '%${ escapeQueryValue(search) }%'`
    }

    queryStr += ' ORDERBY Name'
    queryStr += ` MAXRESULTS ${ DEFAULT_MAX_RESULTS }`
    queryStr += ` STARTPOSITION ${ startPos }`

    const response = await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/query`,
      query: { query: queryStr },
      logTag: 'getItemsDictionary',
    })

    const items = response.QueryResponse?.Item || []
    const hasMore = items.length >= DEFAULT_MAX_RESULTS

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: items.map(item => ({
        label: item.Name,
        value: item.Id,
        note: `${ item.Type || 'Item' }${ item.UnitPrice ? ` - $${ Number(item.UnitPrice).toFixed(2) }` : '' }`,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Accounts
   * @description Provides a searchable list of chart of accounts for dynamic parameter selection in FlowRunner. Used for linking items to income or expense accounts.
   * @route POST /get-accounts-dictionary
   * @paramDef {"type":"getAccountsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering accounts."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Sales of Product Income","value":"79","note":"Income"}],"cursor":null}
   */
  async getAccountsDictionary(payload) {
    const { search, cursor } = payload || {}

    const page = cursor ? parseInt(cursor) : 1
    const startPos = (page - 1) * DEFAULT_MAX_RESULTS + 1

    let queryStr = 'SELECT * FROM Account WHERE Active = true'

    if (search) {
      queryStr += ` AND Name LIKE '%${ escapeQueryValue(search) }%'`
    }

    queryStr += ' ORDERBY Name'
    queryStr += ` MAXRESULTS ${ DEFAULT_MAX_RESULTS }`
    queryStr += ` STARTPOSITION ${ startPos }`

    const response = await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/query`,
      query: { query: queryStr },
      logTag: 'getAccountsDictionary',
    })

    const accounts = response.QueryResponse?.Account || []
    const hasMore = accounts.length >= DEFAULT_MAX_RESULTS

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: accounts.map(account => ({
        label: account.Name,
        value: account.Id,
        note: account.AccountType || `ID: ${ account.Id }`,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Payment Methods
   * @description Provides a searchable list of payment methods (Cash, Check, Credit Card, etc.) for dynamic parameter selection in FlowRunner.
   * @route POST /get-payment-methods-dictionary
   * @paramDef {"type":"getPaymentMethodsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering payment methods."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Check","value":"1","note":"ID: 1"}],"cursor":null}
   */
  async getPaymentMethodsDictionary(payload) {
    const { search, cursor } = payload || {}

    const page = cursor ? parseInt(cursor) : 1
    const startPos = (page - 1) * DEFAULT_MAX_RESULTS + 1

    let queryStr = 'SELECT * FROM PaymentMethod WHERE Active = true'

    if (search) {
      queryStr += ` AND Name LIKE '%${ escapeQueryValue(search) }%'`
    }

    queryStr += ' ORDERBY Name'
    queryStr += ` MAXRESULTS ${ DEFAULT_MAX_RESULTS }`
    queryStr += ` STARTPOSITION ${ startPos }`

    const response = await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/query`,
      query: { query: queryStr },
      logTag: 'getPaymentMethodsDictionary',
    })

    const methods = response.QueryResponse?.PaymentMethod || []
    const hasMore = methods.length >= DEFAULT_MAX_RESULTS

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: methods.map(method => ({
        label: method.Name,
        value: method.Id,
        note: `ID: ${ method.Id }`,
      })),
    }
  }

  // ==================== Vendors ====================

  /**
   * @operationName Create Vendor
   * @category Vendors
   * @description Creates a new vendor in QuickBooks Online. Vendors represent the people or companies you purchase products and services from. The display name must be unique across customers, vendors, and employees.
   *
   * @route POST /create-vendor
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","required":true,"description":"Unique display name for the vendor. Must be unique across customers, vendors, and employees."}
   * @paramDef {"type":"String","label":"First Name","name":"givenName","description":"First name of the vendor contact."}
   * @paramDef {"type":"String","label":"Last Name","name":"familyName","description":"Last name of the vendor contact."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"Name of the vendor company."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Primary email address for the vendor."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Primary phone number for the vendor."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free-form notes about the vendor."}
   *
   * @returns {Object}
   * @sampleResult {"Vendor":{"Id":"201","DisplayName":"Office Supplies Co","GivenName":"Jane","FamilyName":"Doe","CompanyName":"Office Supplies Co","PrimaryEmailAddr":{"Address":"jane@officesupplies.com"},"PrimaryPhone":{"FreeFormNumber":"555-9876"},"Active":true,"Balance":0,"SyncToken":"0"}}
   */
  async createVendor(displayName, givenName, familyName, companyName, email, phone, notes) {
    if (!displayName) {
      throw new Error('"Display Name" is required.')
    }

    const body = cleanupObject({
      DisplayName: displayName,
      GivenName: givenName,
      FamilyName: familyName,
      CompanyName: companyName,
      PrimaryEmailAddr: email ? { Address: email } : undefined,
      PrimaryPhone: phone ? { FreeFormNumber: phone } : undefined,
      Notes: notes,
    })

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/vendor`,
      method: 'post',
      body,
      logTag: 'createVendor',
    })
  }

  /**
   * @operationName Get Vendor
   * @category Vendors
   * @description Retrieves a single vendor by ID from QuickBooks Online. Returns the full vendor record including contact information, balance, and metadata.
   *
   * @route POST /get-vendor
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Vendor","name":"vendorId","required":true,"dictionary":"getVendorsDictionary","description":"The vendor to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"Vendor":{"Id":"201","DisplayName":"Office Supplies Co","CompanyName":"Office Supplies Co","PrimaryEmailAddr":{"Address":"jane@officesupplies.com"},"Active":true,"Balance":500.00,"SyncToken":"2"}}
   */
  async getVendor(vendorId) {
    if (!vendorId) {
      throw new Error('"Vendor" is required.')
    }

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/vendor/${ vendorId }`,
      logTag: 'getVendor',
    })
  }

  /**
   * @operationName Update Vendor
   * @category Vendors
   * @description Updates an existing vendor in QuickBooks Online using a sparse update. Only the fields you provide will be changed; all other fields remain unchanged.
   *
   * @route POST /update-vendor
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Vendor","name":"vendorId","required":true,"dictionary":"getVendorsDictionary","description":"The vendor to update."}
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","description":"Updated display name for the vendor."}
   * @paramDef {"type":"String","label":"First Name","name":"givenName","description":"Updated first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"familyName","description":"Updated last name."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"Updated company name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Updated email address."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Updated phone number."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated notes about the vendor."}
   *
   * @returns {Object}
   * @sampleResult {"Vendor":{"Id":"201","DisplayName":"Office Supplies Co Updated","Active":true,"Balance":500.00,"SyncToken":"3","sparse":true}}
   */
  async updateVendor(vendorId, displayName, givenName, familyName, companyName, email, phone, notes) {
    if (!vendorId) {
      throw new Error('"Vendor" is required.')
    }

    const syncToken = await this.#getEntitySyncToken('Vendor', vendorId)

    const body = cleanupObject({
      Id: vendorId,
      SyncToken: syncToken,
      sparse: true,
      DisplayName: displayName,
      GivenName: givenName,
      FamilyName: familyName,
      CompanyName: companyName,
      PrimaryEmailAddr: email ? { Address: email } : undefined,
      PrimaryPhone: phone ? { FreeFormNumber: phone } : undefined,
      Notes: notes,
    })

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/vendor`,
      method: 'post',
      body,
      logTag: 'updateVendor',
    })
  }

  /**
   * @operationName Deactivate Vendor
   * @category Vendors
   * @description Deactivates a vendor in QuickBooks Online by setting their Active status to false. QuickBooks does not support permanent deletion of vendors; deactivation hides them from active lists while preserving historical data.
   *
   * @route POST /deactivate-vendor
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Vendor","name":"vendorId","required":true,"dictionary":"getVendorsDictionary","description":"The vendor to deactivate."}
   *
   * @returns {Object}
   * @sampleResult {"Vendor":{"Id":"201","DisplayName":"Office Supplies Co","Active":false,"SyncToken":"4","sparse":true}}
   */
  async deactivateVendor(vendorId) {
    if (!vendorId) {
      throw new Error('"Vendor" is required.')
    }

    const syncToken = await this.#getEntitySyncToken('Vendor', vendorId)

    const body = {
      Id: vendorId,
      SyncToken: syncToken,
      sparse: true,
      Active: false,
    }

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/vendor`,
      method: 'post',
      body,
      logTag: 'deactivateVendor',
    })
  }

  /**
   * @operationName List Vendors
   * @category Vendors
   * @description Queries vendors in QuickBooks Online with optional search filtering. Search matches against the DisplayName field. Results are paginated and sorted by DisplayName.
   *
   * @route POST /list-vendors
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search text to filter vendors by display name."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of vendors to return, up to 1000. Defaults to 100."}
   * @paramDef {"type":"Number","label":"Start Position","name":"startPosition","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Starting position for pagination, 1-based. Defaults to 1."}
   *
   * @returns {Object}
   * @sampleResult {"QueryResponse":{"Vendor":[{"Id":"201","DisplayName":"Office Supplies Co","Active":true,"Balance":500.00},{"Id":"202","DisplayName":"Tech Hardware Inc","Active":true,"Balance":0}],"startPosition":1,"maxResults":2,"totalCount":2}}
   */
  async listVendors(search, maxResults, startPosition) {
    let queryStr = 'SELECT * FROM Vendor'
    const filters = []

    if (search) {
      filters.push(`DisplayName LIKE '%${ escapeQueryValue(search) }%'`)
    }

    if (filters.length > 0) {
      queryStr += ` WHERE ${ filters.join(' AND ') }`
    }

    queryStr += ' ORDERBY DisplayName'
    queryStr += ` MAXRESULTS ${ maxResults || DEFAULT_MAX_RESULTS }`
    queryStr += ` STARTPOSITION ${ startPosition || 1 }`

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/query`,
      query: { query: queryStr },
      logTag: 'listVendors',
    })
  }

  // ==================== Accounts ====================

  /**
   * @operationName Create Account
   * @category Accounts
   * @description Creates a new account in the QuickBooks Online chart of accounts. Accounts are used to categorize financial transactions. You must specify a name and account type (e.g., Income, Expense, Bank, etc.).
   *
   * @route POST /create-account
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the account. Must be unique."}
   * @paramDef {"type":"String","label":"Account Type","name":"accountType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Bank","Other Current Asset","Fixed Asset","Other Asset","Accounts Receivable","Equity","Income","Cost of Goods Sold","Expense","Other Income","Other Expense","Accounts Payable","Credit Card","Long Term Liability","Other Current Liability"]}},"description":"The classification of the account in the chart of accounts."}
   * @paramDef {"type":"String","label":"Account Sub-Type","name":"accountSubType","description":"More specific classification within the account type (e.g., Checking, Savings for Bank type)."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Description of the account purpose."}
   *
   * @returns {Object}
   * @sampleResult {"Account":{"Id":"301","Name":"Office Supplies Expense","AccountType":"Expense","AccountSubType":"SuppliesMaterials","Active":true,"CurrentBalance":0,"SyncToken":"0"}}
   */
  async createAccount(name, accountType, accountSubType, description) {
    if (!name) {
      throw new Error('"Name" is required.')
    }

    if (!accountType) {
      throw new Error('"Account Type" is required.')
    }

    const body = cleanupObject({
      Name: name,
      AccountType: accountType,
      AccountSubType: accountSubType,
      Description: description,
    })

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/account`,
      method: 'post',
      body,
      logTag: 'createAccount',
    })
  }

  /**
   * @operationName Get Account
   * @category Accounts
   * @description Retrieves a single account by ID from the QuickBooks Online chart of accounts. Returns the full account record including type, balance, and metadata.
   *
   * @route POST /get-account
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Account","name":"accountId","required":true,"dictionary":"getAccountsDictionary","description":"The account to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"Account":{"Id":"301","Name":"Office Supplies Expense","AccountType":"Expense","AccountSubType":"SuppliesMaterials","Active":true,"CurrentBalance":1250.00,"SyncToken":"1"}}
   */
  async getAccount(accountId) {
    if (!accountId) {
      throw new Error('"Account" is required.')
    }

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/account/${ accountId }`,
      logTag: 'getAccount',
    })
  }

  /**
   * @operationName Update Account
   * @category Accounts
   * @description Updates an existing account in the QuickBooks Online chart of accounts. Note that AccountType cannot be changed after creation. Uses a full update, so all writable fields should be provided.
   *
   * @route POST /update-account
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Account","name":"accountId","required":true,"dictionary":"getAccountsDictionary","description":"The account to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Updated account name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated description of the account."}
   *
   * @returns {Object}
   * @sampleResult {"Account":{"Id":"301","Name":"Office Supplies Updated","AccountType":"Expense","Active":true,"CurrentBalance":1250.00,"SyncToken":"2","sparse":true}}
   */
  async updateAccount(accountId, name, description) {
    if (!accountId) {
      throw new Error('"Account" is required.')
    }

    const syncToken = await this.#getEntitySyncToken('Account', accountId)

    const body = cleanupObject({
      Id: accountId,
      SyncToken: syncToken,
      sparse: true,
      Name: name,
      Description: description,
    })

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/account`,
      method: 'post',
      body,
      logTag: 'updateAccount',
    })
  }

  /**
   * @operationName List Accounts
   * @category Accounts
   * @description Queries the chart of accounts in QuickBooks Online with optional filtering by name and account type. Results are paginated and sorted by name.
   *
   * @route POST /list-accounts
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search text to filter accounts by name."}
   * @paramDef {"type":"String","label":"Account Type","name":"accountType","uiComponent":{"type":"DROPDOWN","options":{"values":["Bank","Other Current Asset","Fixed Asset","Other Asset","Accounts Receivable","Equity","Income","Cost of Goods Sold","Expense","Other Income","Other Expense","Accounts Payable","Credit Card","Long Term Liability","Other Current Liability"]}},"description":"Optional filter by account type."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of accounts to return, up to 1000. Defaults to 100."}
   * @paramDef {"type":"Number","label":"Start Position","name":"startPosition","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Starting position for pagination, 1-based. Defaults to 1."}
   *
   * @returns {Object}
   * @sampleResult {"QueryResponse":{"Account":[{"Id":"301","Name":"Office Supplies Expense","AccountType":"Expense","Active":true,"CurrentBalance":1250.00},{"Id":"302","Name":"Checking","AccountType":"Bank","Active":true,"CurrentBalance":5000.00}],"startPosition":1,"maxResults":2,"totalCount":2}}
   */
  async listAccounts(search, accountType, maxResults, startPosition) {
    let queryStr = 'SELECT * FROM Account'
    const filters = []

    if (search) {
      filters.push(`Name LIKE '%${ escapeQueryValue(search) }%'`)
    }

    if (accountType) {
      filters.push(`AccountType = '${ escapeQueryValue(accountType) }'`)
    }

    if (filters.length > 0) {
      queryStr += ` WHERE ${ filters.join(' AND ') }`
    }

    queryStr += ' ORDERBY Name'
    queryStr += ` MAXRESULTS ${ maxResults || DEFAULT_MAX_RESULTS }`
    queryStr += ` STARTPOSITION ${ startPosition || 1 }`

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/query`,
      query: { query: queryStr },
      logTag: 'listAccounts',
    })
  }

  // ==================== Bills ====================

  /**
   * @operationName Create Bill
   * @category Bills
   * @description Creates a new bill in QuickBooks Online to record an amount owed to a vendor. Line items define the expenses or items being billed. Each line item should specify a DetailType and the corresponding detail object.
   *
   * @route POST /create-bill
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Vendor","name":"vendorId","required":true,"dictionary":"getVendorsDictionary","description":"The vendor who issued the bill."}
   * @paramDef {"type":"Array<Object>","label":"Line Items","name":"lineItems","required":true,"description":"Array of line items. Each item should have DetailType (AccountBasedExpenseLineDetail or ItemBasedExpenseLineDetail), Amount, and the corresponding detail object."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Payment due date for the bill in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"Transaction Date","name":"txnDate","uiComponent":{"type":"DATE_PICKER"},"description":"Date of the bill transaction. Defaults to today if not specified."}
   * @paramDef {"type":"String","label":"Private Note","name":"privateNote","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A private note for internal reference."}
   *
   * @returns {Object}
   * @sampleResult {"Bill":{"Id":"501","VendorRef":{"value":"201","name":"Office Supplies Co"},"TxnDate":"2025-01-15","DueDate":"2025-02-15","TotalAmt":350.00,"Balance":350.00,"Line":[{"Id":"1","DetailType":"AccountBasedExpenseLineDetail","Amount":350.00,"AccountBasedExpenseLineDetail":{"AccountRef":{"value":"301","name":"Office Supplies"}}}],"SyncToken":"0"}}
   */
  async createBill(vendorId, lineItems, dueDate, txnDate, privateNote) {
    if (!vendorId) {
      throw new Error('"Vendor" is required.')
    }

    if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
      throw new Error('"Line Items" is required and must be a non-empty array.')
    }

    const body = cleanupObject({
      VendorRef: { value: vendorId },
      Line: lineItems,
      DueDate: dueDate,
      TxnDate: txnDate,
      PrivateNote: privateNote,
    })

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/bill`,
      method: 'post',
      body,
      logTag: 'createBill',
    })
  }

  /**
   * @operationName Get Bill
   * @category Bills
   * @description Retrieves a single bill by ID from QuickBooks Online. Returns the full bill record including vendor reference, line items, amounts, and status.
   *
   * @route POST /get-bill
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Bill ID","name":"billId","required":true,"description":"The ID of the bill to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"Bill":{"Id":"501","VendorRef":{"value":"201","name":"Office Supplies Co"},"TxnDate":"2025-01-15","DueDate":"2025-02-15","TotalAmt":350.00,"Balance":350.00,"SyncToken":"1"}}
   */
  async getBill(billId) {
    if (!billId) {
      throw new Error('"Bill ID" is required.')
    }

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/bill/${ billId }`,
      logTag: 'getBill',
    })
  }

  /**
   * @operationName Update Bill
   * @category Bills
   * @description Updates an existing bill in QuickBooks Online using a sparse update. Only the fields you provide will be changed.
   *
   * @route POST /update-bill
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Bill ID","name":"billId","required":true,"description":"The ID of the bill to update."}
   * @paramDef {"type":"String","label":"Vendor","name":"vendorId","dictionary":"getVendorsDictionary","description":"Updated vendor for the bill."}
   * @paramDef {"type":"Array<Object>","label":"Line Items","name":"lineItems","description":"Updated line items array. Replaces all existing line items when provided."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Updated payment due date in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"Private Note","name":"privateNote","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated private note."}
   *
   * @returns {Object}
   * @sampleResult {"Bill":{"Id":"501","VendorRef":{"value":"201","name":"Office Supplies Co"},"DueDate":"2025-03-01","TotalAmt":400.00,"Balance":400.00,"SyncToken":"2","sparse":true}}
   */
  async updateBill(billId, vendorId, lineItems, dueDate, privateNote) {
    if (!billId) {
      throw new Error('"Bill ID" is required.')
    }

    const syncToken = await this.#getEntitySyncToken('Bill', billId)

    const body = cleanupObject({
      Id: billId,
      SyncToken: syncToken,
      sparse: true,
      VendorRef: vendorId ? { value: vendorId } : undefined,
      Line: lineItems,
      DueDate: dueDate,
      PrivateNote: privateNote,
    })

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/bill`,
      method: 'post',
      body,
      logTag: 'updateBill',
    })
  }

  /**
   * @operationName Delete Bill
   * @category Bills
   * @description Permanently deletes a bill from QuickBooks Online. This action cannot be undone. The bill must not have any payments applied to it.
   *
   * @route POST /delete-bill
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Bill ID","name":"billId","required":true,"description":"The ID of the bill to delete."}
   *
   * @returns {Object}
   * @sampleResult {"Bill":{"Id":"501","domain":"QBO","status":"Deleted"}}
   */
  async deleteBill(billId) {
    if (!billId) {
      throw new Error('"Bill ID" is required.')
    }

    const syncToken = await this.#getEntitySyncToken('Bill', billId)

    const body = {
      Id: billId,
      SyncToken: syncToken,
    }

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/bill`,
      method: 'post',
      body,
      query: { operation: 'delete' },
      logTag: 'deleteBill',
    })
  }

  /**
   * @operationName List Bills
   * @category Bills
   * @description Queries bills in QuickBooks Online with optional filtering. You can filter by vendor. Results are paginated and sorted by transaction date in descending order.
   *
   * @route POST /list-bills
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Vendor","name":"vendorId","dictionary":"getVendorsDictionary","description":"Optional filter to show only bills from a specific vendor."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of bills to return, up to 1000. Defaults to 100."}
   * @paramDef {"type":"Number","label":"Start Position","name":"startPosition","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Starting position for pagination, 1-based. Defaults to 1."}
   *
   * @returns {Object}
   * @sampleResult {"QueryResponse":{"Bill":[{"Id":"501","VendorRef":{"value":"201","name":"Office Supplies Co"},"TxnDate":"2025-01-15","TotalAmt":350.00,"Balance":350.00},{"Id":"502","VendorRef":{"value":"202","name":"Tech Hardware Inc"},"TxnDate":"2025-01-10","TotalAmt":1200.00,"Balance":0}],"startPosition":1,"maxResults":2,"totalCount":2}}
   */
  async listBills(vendorId, maxResults, startPosition) {
    let queryStr = 'SELECT * FROM Bill'
    const filters = []

    if (vendorId) {
      filters.push(`VendorRef = '${ escapeQueryValue(vendorId) }'`)
    }

    if (filters.length > 0) {
      queryStr += ` WHERE ${ filters.join(' AND ') }`
    }

    queryStr += ' ORDERBY TxnDate DESC'
    queryStr += ` MAXRESULTS ${ maxResults || DEFAULT_MAX_RESULTS }`
    queryStr += ` STARTPOSITION ${ startPosition || 1 }`

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/query`,
      query: { query: queryStr },
      logTag: 'listBills',
    })
  }

  // ==================== Estimates ====================

  /**
   * @operationName Create Estimate
   * @category Estimates
   * @description Creates a new estimate (quote) in QuickBooks Online for a specified customer. Estimates are non-posting transactions used to propose prices for goods or services before an invoice is created.
   *
   * @route POST /create-estimate
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The customer to create the estimate for."}
   * @paramDef {"type":"Array<Object>","label":"Line Items","name":"lineItems","required":true,"description":"Array of line items. Each item should have DetailType (SalesItemLineDetail), Amount, and SalesItemLineDetail with ItemRef, UnitPrice, Qty."}
   * @paramDef {"type":"String","label":"Expiration Date","name":"expirationDate","uiComponent":{"type":"DATE_PICKER"},"description":"Date when the estimate expires in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"Transaction Date","name":"txnDate","uiComponent":{"type":"DATE_PICKER"},"description":"Date of the estimate. Defaults to today if not specified."}
   * @paramDef {"type":"String","label":"Private Note","name":"privateNote","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A private note that is not visible to the customer."}
   * @paramDef {"type":"String","label":"Customer Memo","name":"customerMemo","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A message visible to the customer on the estimate."}
   *
   * @returns {Object}
   * @sampleResult {"Estimate":{"Id":"601","DocNumber":"1001","TxnDate":"2025-01-15","ExpirationDate":"2025-02-15","TotalAmt":2500.00,"CustomerRef":{"value":"123","name":"John Smith"},"TxnStatus":"Pending","Line":[{"Id":"1","DetailType":"SalesItemLineDetail","Amount":2500.00,"SalesItemLineDetail":{"ItemRef":{"value":"10","name":"Consulting"},"UnitPrice":250,"Qty":10}}],"SyncToken":"0"}}
   */
  async createEstimate(customerId, lineItems, expirationDate, txnDate, privateNote, customerMemo) {
    if (!customerId) {
      throw new Error('"Customer" is required.')
    }

    if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
      throw new Error('"Line Items" is required and must be a non-empty array.')
    }

    const body = cleanupObject({
      CustomerRef: { value: customerId },
      Line: lineItems,
      ExpirationDate: expirationDate,
      TxnDate: txnDate,
      PrivateNote: privateNote,
      CustomerMemo: customerMemo ? { value: customerMemo } : undefined,
    })

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/estimate`,
      method: 'post',
      body,
      logTag: 'createEstimate',
    })
  }

  /**
   * @operationName Get Estimate
   * @category Estimates
   * @description Retrieves a single estimate by ID from QuickBooks Online. Returns the full estimate record including line items, customer reference, amounts, and status.
   *
   * @route POST /get-estimate
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Estimate ID","name":"estimateId","required":true,"description":"The ID of the estimate to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"Estimate":{"Id":"601","DocNumber":"1001","TxnDate":"2025-01-15","ExpirationDate":"2025-02-15","TotalAmt":2500.00,"CustomerRef":{"value":"123","name":"John Smith"},"TxnStatus":"Pending","SyncToken":"1"}}
   */
  async getEstimate(estimateId) {
    if (!estimateId) {
      throw new Error('"Estimate ID" is required.')
    }

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/estimate/${ estimateId }`,
      logTag: 'getEstimate',
    })
  }

  /**
   * @operationName Update Estimate
   * @category Estimates
   * @description Updates an existing estimate in QuickBooks Online using a sparse update. Only the fields you provide will be changed.
   *
   * @route POST /update-estimate
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Estimate ID","name":"estimateId","required":true,"description":"The ID of the estimate to update."}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","dictionary":"getCustomersDictionary","description":"Updated customer for the estimate."}
   * @paramDef {"type":"Array<Object>","label":"Line Items","name":"lineItems","description":"Updated line items array. Replaces all existing line items when provided."}
   * @paramDef {"type":"String","label":"Expiration Date","name":"expirationDate","uiComponent":{"type":"DATE_PICKER"},"description":"Updated expiration date in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"Private Note","name":"privateNote","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated private note."}
   * @paramDef {"type":"String","label":"Customer Memo","name":"customerMemo","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated customer-visible message."}
   *
   * @returns {Object}
   * @sampleResult {"Estimate":{"Id":"601","DocNumber":"1001","TotalAmt":3000.00,"CustomerRef":{"value":"123","name":"John Smith"},"TxnStatus":"Pending","SyncToken":"2","sparse":true}}
   */
  async updateEstimate(estimateId, customerId, lineItems, expirationDate, privateNote, customerMemo) {
    if (!estimateId) {
      throw new Error('"Estimate ID" is required.')
    }

    const syncToken = await this.#getEntitySyncToken('Estimate', estimateId)

    const body = cleanupObject({
      Id: estimateId,
      SyncToken: syncToken,
      sparse: true,
      CustomerRef: customerId ? { value: customerId } : undefined,
      Line: lineItems,
      ExpirationDate: expirationDate,
      PrivateNote: privateNote,
      CustomerMemo: customerMemo ? { value: customerMemo } : undefined,
    })

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/estimate`,
      method: 'post',
      body,
      logTag: 'updateEstimate',
    })
  }

  /**
   * @operationName Delete Estimate
   * @category Estimates
   * @description Permanently deletes an estimate from QuickBooks Online. This action cannot be undone.
   *
   * @route POST /delete-estimate
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Estimate ID","name":"estimateId","required":true,"description":"The ID of the estimate to delete."}
   *
   * @returns {Object}
   * @sampleResult {"Estimate":{"Id":"601","domain":"QBO","status":"Deleted"}}
   */
  async deleteEstimate(estimateId) {
    if (!estimateId) {
      throw new Error('"Estimate ID" is required.')
    }

    const syncToken = await this.#getEntitySyncToken('Estimate', estimateId)

    const body = {
      Id: estimateId,
      SyncToken: syncToken,
    }

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/estimate`,
      method: 'post',
      body,
      query: { operation: 'delete' },
      logTag: 'deleteEstimate',
    })
  }

  /**
   * @operationName List Estimates
   * @category Estimates
   * @description Queries estimates in QuickBooks Online with optional filtering. Search matches against the DocNumber field. Results are paginated and sorted by transaction date in descending order.
   *
   * @route POST /list-estimates
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search text to filter estimates by document number."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of estimates to return, up to 1000. Defaults to 100."}
   * @paramDef {"type":"Number","label":"Start Position","name":"startPosition","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Starting position for pagination, 1-based. Defaults to 1."}
   *
   * @returns {Object}
   * @sampleResult {"QueryResponse":{"Estimate":[{"Id":"601","DocNumber":"1001","TxnDate":"2025-01-15","TotalAmt":2500.00,"CustomerRef":{"value":"123","name":"John Smith"},"TxnStatus":"Pending"},{"Id":"602","DocNumber":"1002","TxnDate":"2025-01-20","TotalAmt":1500.00,"CustomerRef":{"value":"124","name":"Jane Doe"},"TxnStatus":"Accepted"}],"startPosition":1,"maxResults":2,"totalCount":2}}
   */
  async listEstimates(search, maxResults, startPosition) {
    let queryStr = 'SELECT * FROM Estimate'
    const filters = []

    if (search) {
      filters.push(`DocNumber LIKE '%${ escapeQueryValue(search) }%'`)
    }

    if (filters.length > 0) {
      queryStr += ` WHERE ${ filters.join(' AND ') }`
    }

    queryStr += ' ORDERBY TxnDate DESC'
    queryStr += ` MAXRESULTS ${ maxResults || DEFAULT_MAX_RESULTS }`
    queryStr += ` STARTPOSITION ${ startPosition || 1 }`

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/query`,
      query: { query: queryStr },
      logTag: 'listEstimates',
    })
  }

  /**
   * @operationName Send Estimate
   * @category Estimates
   * @description Sends an estimate to the customer via email. Uses the customer's email address on file or a specified email address. QuickBooks Online generates and sends a professionally formatted email with the estimate details.
   *
   * @route POST /send-estimate
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Estimate ID","name":"estimateId","required":true,"description":"The ID of the estimate to send."}
   * @paramDef {"type":"String","label":"Send To Email","name":"emailTo","description":"Email address to send the estimate to. If not specified, the customer's email on file is used."}
   *
   * @returns {Object}
   * @sampleResult {"Estimate":{"Id":"601","DocNumber":"1001","EmailStatus":"EmailSent","DeliveryInfo":{"DeliveryType":"Email","DeliveryTime":"2025-01-15T10:30:00-07:00"}}}
   */
  async sendEstimate(estimateId, emailTo) {
    if (!estimateId) {
      throw new Error('"Estimate ID" is required.')
    }

    const query = {}

    if (emailTo) {
      query.sendTo = emailTo
    }

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/estimate/${ estimateId }/send`,
      method: 'post',
      query,
      logTag: 'sendEstimate',
    })
  }

  /**
   * @operationName Get Estimate PDF
   * @category Estimates
   * @description Downloads a PDF representation of an estimate from QuickBooks Online. Returns the estimate as a binary PDF file that can be saved or forwarded.
   *
   * @route POST /get-estimate-pdf
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Estimate ID","name":"estimateId","required":true,"description":"The ID of the estimate to download as PDF."}
   *
   * @returns {Object}
   * @sampleResult {"contentType":"application/pdf","content":"<binary PDF data>"}
   */
  async getEstimatePDF(estimateId) {
    if (!estimateId) {
      throw new Error('"Estimate ID" is required.')
    }

    const url = `${ this.#getBaseUrl() }/estimate/${ estimateId }/pdf`

    const query = { minorversion: MINOR_VERSION }

    logger.debug(`getEstimatePDF - downloading PDF for estimate: ${ estimateId }`)

    const pdfData = await Flowrunner.Request.get(url)
      .set(this.#getAccessTokenHeader())
      .set({ Accept: 'application/pdf' })
      .query(query)
      .setEncoding(null)

    return {
      contentType: 'application/pdf',
      content: pdfData,
    }
  }

  // ==================== Employees ====================

  /**
   * @operationName Create Employee
   * @category Employees
   * @description Creates a new employee record in QuickBooks Online. The display name must be unique across all customers, vendors, and employees.
   *
   * @route POST /create-employee
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","required":true,"description":"The unique display name for the employee. Must be unique across customers, vendors, and employees."}
   * @paramDef {"type":"String","label":"First Name","name":"givenName","description":"Employee's first name (max 25 characters)."}
   * @paramDef {"type":"String","label":"Last Name","name":"familyName","description":"Employee's last name (max 25 characters)."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Employee's email address."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Employee's primary phone number."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Employee's job title."}
   * @paramDef {"type":"String","label":"Hired Date","name":"hiredDate","uiComponent":{"type":"DATE_PICKER"},"description":"Employee's hire date in YYYY-MM-DD format."}
   *
   * @returns {Object}
   * @sampleResult {"Employee":{"Id":"301","DisplayName":"Alice Johnson","GivenName":"Alice","FamilyName":"Johnson","PrintOnCheckName":"Alice Johnson","Active":true,"PrimaryEmailAddr":{"Address":"alice@example.com"},"PrimaryPhone":{"FreeFormNumber":"555-0101"},"HiredDate":"2025-01-15","SyncToken":"0"}}
   */
  async createEmployee(displayName, givenName, familyName, email, phone, title, hiredDate) {
    if (!displayName) {
      throw new Error('"Display Name" is required.')
    }

    const body = cleanupObject({
      DisplayName: displayName,
      GivenName: givenName,
      FamilyName: familyName,
      PrimaryEmailAddr: email ? { Address: email } : undefined,
      PrimaryPhone: phone ? { FreeFormNumber: phone } : undefined,
      Title: title,
      HiredDate: hiredDate,
    })

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/employee`,
      method: 'post',
      body,
      logTag: 'createEmployee',
    })
  }

  /**
   * @operationName Get Employee
   * @category Employees
   * @description Retrieves a single employee record by ID from QuickBooks Online. Returns the full employee details including contact information, hire date, and status.
   *
   * @route POST /get-employee
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Employee","name":"employeeId","required":true,"dictionary":"getEmployeesDictionary","description":"The employee to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"Employee":{"Id":"301","DisplayName":"Alice Johnson","GivenName":"Alice","FamilyName":"Johnson","Active":true,"PrimaryEmailAddr":{"Address":"alice@example.com"},"PrimaryPhone":{"FreeFormNumber":"555-0101"},"Title":"Engineer","HiredDate":"2025-01-15","SyncToken":"1"}}
   */
  async getEmployee(employeeId) {
    if (!employeeId) {
      throw new Error('"Employee" is required.')
    }

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/employee/${ employeeId }`,
      logTag: 'getEmployee',
    })
  }

  /**
   * @operationName Update Employee
   * @category Employees
   * @description Updates an existing employee record in QuickBooks Online using a sparse update. Only the fields you provide will be changed.
   *
   * @route POST /update-employee
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Employee","name":"employeeId","required":true,"dictionary":"getEmployeesDictionary","description":"The employee to update."}
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","description":"Updated display name for the employee."}
   * @paramDef {"type":"String","label":"First Name","name":"givenName","description":"Updated first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"familyName","description":"Updated last name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Updated email address."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Updated phone number."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Updated job title."}
   *
   * @returns {Object}
   * @sampleResult {"Employee":{"Id":"301","DisplayName":"Alice Johnson","GivenName":"Alice","FamilyName":"Johnson","Active":true,"PrimaryEmailAddr":{"Address":"alice.new@example.com"},"Title":"Senior Engineer","SyncToken":"2","sparse":true}}
   */
  async updateEmployee(employeeId, displayName, givenName, familyName, email, phone, title) {
    if (!employeeId) {
      throw new Error('"Employee" is required.')
    }

    const syncToken = await this.#getEntitySyncToken('Employee', employeeId)

    const body = cleanupObject({
      Id: employeeId,
      SyncToken: syncToken,
      sparse: true,
      DisplayName: displayName,
      GivenName: givenName,
      FamilyName: familyName,
      PrimaryEmailAddr: email ? { Address: email } : undefined,
      PrimaryPhone: phone ? { FreeFormNumber: phone } : undefined,
      Title: title,
    })

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/employee`,
      method: 'post',
      body,
      logTag: 'updateEmployee',
    })
  }

  /**
   * @operationName Deactivate Employee
   * @category Employees
   * @description Deactivates an employee in QuickBooks Online by setting their Active status to false. QuickBooks Online does not support permanent deletion of employees.
   *
   * @route POST /deactivate-employee
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Employee","name":"employeeId","required":true,"dictionary":"getEmployeesDictionary","description":"The employee to deactivate."}
   *
   * @returns {Object}
   * @sampleResult {"Employee":{"Id":"301","DisplayName":"Alice Johnson","Active":false,"SyncToken":"3"}}
   */
  async deactivateEmployee(employeeId) {
    if (!employeeId) {
      throw new Error('"Employee" is required.')
    }

    const syncToken = await this.#getEntitySyncToken('Employee', employeeId)

    const body = {
      Id: employeeId,
      SyncToken: syncToken,
      sparse: true,
      Active: false,
    }

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/employee`,
      method: 'post',
      body,
      logTag: 'deactivateEmployee',
    })
  }

  /**
   * @operationName List Employees
   * @category Employees
   * @description Queries employees in QuickBooks Online with optional search filtering. Search matches against the DisplayName field. Results are paginated and sorted by DisplayName.
   *
   * @route POST /list-employees
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search text to filter employees by display name."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of employees to return, up to 1000. Defaults to 100."}
   * @paramDef {"type":"Number","label":"Start Position","name":"startPosition","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Starting position for pagination, 1-based. Defaults to 1."}
   *
   * @returns {Object}
   * @sampleResult {"QueryResponse":{"Employee":[{"Id":"301","DisplayName":"Alice Johnson","Active":true,"GivenName":"Alice","FamilyName":"Johnson"},{"Id":"302","DisplayName":"Bob Smith","Active":true,"GivenName":"Bob","FamilyName":"Smith"}],"startPosition":1,"maxResults":2,"totalCount":2}}
   */
  async listEmployees(search, maxResults, startPosition) {
    let queryStr = 'SELECT * FROM Employee'
    const filters = []

    if (search) {
      filters.push(`DisplayName LIKE '%${ escapeQueryValue(search) }%'`)
    }

    if (filters.length > 0) {
      queryStr += ` WHERE ${ filters.join(' AND ') }`
    }

    queryStr += ' ORDERBY DisplayName'
    queryStr += ` MAXRESULTS ${ maxResults || DEFAULT_MAX_RESULTS }`
    queryStr += ` STARTPOSITION ${ startPosition || 1 }`

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/query`,
      query: { query: queryStr },
      logTag: 'listEmployees',
    })
  }

  // ==================== Company ====================

  /**
   * @operationName Get Company Info
   * @category Company
   * @description Retrieves the company information for the connected QuickBooks Online account. Returns company name, address, contact details, and other organization settings.
   *
   * @route POST /get-company-info
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"CompanyInfo":{"Id":"1","CompanyName":"Acme Corp","LegalName":"Acme Corporation LLC","CompanyAddr":{"Line1":"123 Main St","City":"Mountain View","CountrySubDivisionCode":"CA","PostalCode":"94041"},"PrimaryPhone":{"FreeFormNumber":"555-0100"},"Email":{"Address":"info@acme.com"},"WebAddr":{"URI":"https://acme.com"},"FiscalYearStartMonth":"January","Country":"US","SyncToken":"5"}}
   */
  async getCompanyInfo() {
    const realmId = this.#getRealmId()

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/companyinfo/${ realmId }`,
      logTag: 'getCompanyInfo',
    })
  }

  /**
   * @operationName Update Company Info
   * @category Company
   * @description Updates the company information in QuickBooks Online using a sparse update. CompanyName and company address are required by QuickBooks even for sparse updates.
   *
   * @route POST /update-company-info
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","required":true,"description":"The company name. Required by QuickBooks Online for all updates."}
   * @paramDef {"type":"String","label":"Legal Name","name":"legalName","description":"The legal or registered name of the company."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Company email address."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Company primary phone number."}
   * @paramDef {"type":"String","label":"Website","name":"website","description":"Company website URL."}
   * @paramDef {"type":"String","label":"Address Line 1","name":"addressLine1","required":true,"description":"Street address line 1. Required by QuickBooks Online for all updates."}
   * @paramDef {"type":"String","label":"City","name":"city","description":"City for the company address."}
   * @paramDef {"type":"String","label":"State/Province","name":"countrySubDivisionCode","description":"State or province code (e.g., CA, NY, ON)."}
   * @paramDef {"type":"String","label":"Postal Code","name":"postalCode","description":"Postal or ZIP code."}
   *
   * @returns {Object}
   * @sampleResult {"CompanyInfo":{"Id":"1","CompanyName":"Acme Corp Updated","LegalName":"Acme Corporation LLC","CompanyAddr":{"Line1":"456 New St","City":"San Francisco","CountrySubDivisionCode":"CA","PostalCode":"94105"},"SyncToken":"6","sparse":true}}
   */
  async updateCompanyInfo(companyName, legalName, email, phone, website, addressLine1, city, countrySubDivisionCode, postalCode) {
    if (!companyName) {
      throw new Error('"Company Name" is required.')
    }

    if (!addressLine1) {
      throw new Error('"Address Line 1" is required.')
    }

    const realmId = this.#getRealmId()

    const currentInfo = await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/companyinfo/${ realmId }`,
      logTag: 'updateCompanyInfo:fetch',
    })

    const syncToken = currentInfo.CompanyInfo?.SyncToken

    if (!syncToken && syncToken !== '0') {
      throw new Error('Unable to retrieve current company info for update.')
    }

    const body = cleanupObject({
      Id: currentInfo.CompanyInfo.Id,
      SyncToken: syncToken,
      sparse: true,
      CompanyName: companyName,
      LegalName: legalName,
      CompanyAddr: cleanupObject({
        Line1: addressLine1,
        City: city,
        CountrySubDivisionCode: countrySubDivisionCode,
        PostalCode: postalCode,
      }),
      Email: email ? { Address: email } : undefined,
      PrimaryPhone: phone ? { FreeFormNumber: phone } : undefined,
      WebAddr: website ? { URI: website } : undefined,
    })

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/companyinfo`,
      method: 'post',
      body,
      logTag: 'updateCompanyInfo',
    })
  }

  /**
   * @operationName Get Preferences
   * @category Company
   * @description Retrieves the company preferences and settings from QuickBooks Online. Returns accounting, sales, vendor, tax, email, reporting, time tracking, and currency preferences.
   *
   * @route POST /get-preferences
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"Preferences":{"Id":"1","AccountingInfoPrefs":{"FirstMonthOfFiscalYear":"January","UseAccountNumbers":true,"ClassTrackingPerTxn":false,"TrackDepartments":false},"SalesFormsPrefs":{"CustomTxnNumbers":false,"AllowEstimates":true,"AllowDiscount":true,"AutoApplyPayments":true},"VendorAndPurchasesPrefs":{"BillableExpenseTracking":true,"TrackingByCustomer":true},"TaxPrefs":{"UsingSalesTax":true},"ReportPrefs":{"ReportBasis":"Accrual"},"CurrencyPrefs":{"HomeCurrency":{"value":"USD"},"MultiCurrencyEnabled":false},"SyncToken":"3"}}
   */
  async getPreferences() {
    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/preferences`,
      logTag: 'getPreferences',
    })
  }

  // ==================== Tax Agencies ====================

  /**
   * @operationName Create Tax Agency
   * @category Tax
   * @description Creates a new tax agency in QuickBooks Online. Tax agencies are government entities that collect taxes. Once created, tax agencies cannot be updated or deleted via the API.
   *
   * @route POST /create-tax-agency
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","required":true,"description":"The name of the tax agency (e.g., 'California Franchise Tax Board')."}
   *
   * @returns {Object}
   * @sampleResult {"TaxAgency":{"Id":"5","DisplayName":"California Franchise Tax Board","TaxTrackedOnSales":true,"TaxTrackedOnPurchases":false,"SyncToken":"0"}}
   */
  async createTaxAgency(displayName) {
    if (!displayName) {
      throw new Error('"Display Name" is required.')
    }

    const body = {
      DisplayName: displayName,
    }

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/taxagency`,
      method: 'post',
      body,
      logTag: 'createTaxAgency',
    })
  }

  /**
   * @operationName Get Tax Agency
   * @category Tax
   * @description Retrieves a single tax agency by ID from QuickBooks Online. Returns the tax agency name and tax tracking settings.
   *
   * @route POST /get-tax-agency
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Tax Agency","name":"taxAgencyId","required":true,"dictionary":"getTaxAgenciesDictionary","description":"The tax agency to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"TaxAgency":{"Id":"5","DisplayName":"California Franchise Tax Board","TaxTrackedOnSales":true,"TaxTrackedOnPurchases":false,"SyncToken":"0"}}
   */
  async getTaxAgency(taxAgencyId) {
    if (!taxAgencyId) {
      throw new Error('"Tax Agency" is required.')
    }

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/taxagency/${ taxAgencyId }`,
      logTag: 'getTaxAgency',
    })
  }

  /**
   * @operationName List Tax Agencies
   * @category Tax
   * @description Queries tax agencies in QuickBooks Online with optional search filtering. Search matches against the DisplayName field. Results are paginated and sorted by DisplayName.
   *
   * @route POST /list-tax-agencies
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search text to filter tax agencies by display name."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of tax agencies to return, up to 1000. Defaults to 100."}
   * @paramDef {"type":"Number","label":"Start Position","name":"startPosition","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Starting position for pagination, 1-based. Defaults to 1."}
   *
   * @returns {Object}
   * @sampleResult {"QueryResponse":{"TaxAgency":[{"Id":"5","DisplayName":"California Franchise Tax Board","TaxTrackedOnSales":true},{"Id":"6","DisplayName":"IRS","TaxTrackedOnSales":true}],"startPosition":1,"maxResults":2,"totalCount":2}}
   */
  async listTaxAgencies(search, maxResults, startPosition) {
    let queryStr = 'SELECT * FROM TaxAgency'
    const filters = []

    if (search) {
      filters.push(`DisplayName LIKE '%${ escapeQueryValue(search) }%'`)
    }

    if (filters.length > 0) {
      queryStr += ` WHERE ${ filters.join(' AND ') }`
    }

    queryStr += ' ORDERBY DisplayName'
    queryStr += ` MAXRESULTS ${ maxResults || DEFAULT_MAX_RESULTS }`
    queryStr += ` STARTPOSITION ${ startPosition || 1 }`

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/query`,
      query: { query: queryStr },
      logTag: 'listTaxAgencies',
    })
  }

  // ==================== Reports ====================

  /**
   * @operationName Get Profit and Loss Report
   * @category Reports
   * @description Generates a Profit and Loss (Income Statement) summary report from QuickBooks Online. Shows income, cost of goods sold, expenses, and net income for the specified period. Use either a date macro (preset range) or custom start/end dates.
   *
   * @route POST /get-profit-and-loss-report
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Date Range","name":"dateMacro","uiComponent":{"type":"DROPDOWN","options":{"values":["This Month","This Month-to-date","Last Month","Last Month-to-date","This Fiscal Quarter","This Fiscal Quarter-to-date","Last Fiscal Quarter","Last Fiscal Quarter-to-date","This Fiscal Year","This Fiscal Year-to-date","Last Fiscal Year","Last Fiscal Year-to-date","This Calendar Year","This Calendar Year-to-date","Last Calendar Year","Last Calendar Year-to-date"]}},"description":"Predefined date range for the report. If set, Start Date and End Date are ignored."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","uiComponent":{"type":"DATE_PICKER"},"description":"Custom start date in YYYY-MM-DD format. Used only when Date Range is not set."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","uiComponent":{"type":"DATE_PICKER"},"description":"Custom end date in YYYY-MM-DD format. Used only when Date Range is not set."}
   * @paramDef {"type":"String","label":"Accounting Method","name":"accountingMethod","uiComponent":{"type":"DROPDOWN","options":{"values":["Accrual","Cash"]}},"description":"Accounting method for the report. Defaults to the company's preference."}
   * @paramDef {"type":"String","label":"Summarize By","name":"summarizeColumnBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Total","Month","Week","Days","Quarter","Year","Customers"]}},"description":"How to group the report columns. Defaults to Total."}
   *
   * @returns {Object}
   * @sampleResult {"Header":{"ReportName":"ProfitAndLoss","ReportBasis":"Accrual","StartPeriod":"2025-01-01","EndPeriod":"2025-12-31","Currency":"USD"},"Columns":{"Column":[{"ColTitle":"","ColType":"Account"},{"ColTitle":"Total","ColType":"Money"}]},"Rows":{"Row":[{"Header":{"ColData":[{"value":"Income"}]},"Summary":{"ColData":[{"value":"Income"},{"value":"50000.00"}]}},{"Header":{"ColData":[{"value":"Expenses"}]},"Summary":{"ColData":[{"value":"Expenses"},{"value":"30000.00"}]}}]}}
   */
  async getProfitAndLossReport(dateMacro, startDate, endDate, accountingMethod, summarizeColumnBy) {
    const query = {}

    if (dateMacro) {
      query.date_macro = dateMacro
    } else {
      if (startDate) {
        query.start_date = startDate
      }

      if (endDate) {
        query.end_date = endDate
      }
    }

    if (accountingMethod) {
      query.accounting_method = accountingMethod
    }

    if (summarizeColumnBy) {
      query.summarize_column_by = summarizeColumnBy
    }

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/reports/ProfitAndLoss`,
      query,
      logTag: 'getProfitAndLossReport',
    })
  }

  /**
   * @operationName Get Profit and Loss Detail Report
   * @category Reports
   * @description Generates a detailed Profit and Loss report from QuickBooks Online with transaction-level detail. Shows individual transactions that make up income and expense totals. Use either a date macro (preset range) or custom start/end dates.
   *
   * @route POST /get-profit-and-loss-detail-report
   * @appearanceColor #2CA01C #34B824
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Date Range","name":"dateMacro","uiComponent":{"type":"DROPDOWN","options":{"values":["This Month","This Month-to-date","Last Month","Last Month-to-date","This Fiscal Quarter","This Fiscal Quarter-to-date","Last Fiscal Quarter","Last Fiscal Quarter-to-date","This Fiscal Year","This Fiscal Year-to-date","Last Fiscal Year","Last Fiscal Year-to-date","This Calendar Year","This Calendar Year-to-date","Last Calendar Year","Last Calendar Year-to-date"]}},"description":"Predefined date range for the report. If set, Start Date and End Date are ignored."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","uiComponent":{"type":"DATE_PICKER"},"description":"Custom start date in YYYY-MM-DD format. Used only when Date Range is not set."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","uiComponent":{"type":"DATE_PICKER"},"description":"Custom end date in YYYY-MM-DD format. Used only when Date Range is not set."}
   * @paramDef {"type":"String","label":"Accounting Method","name":"accountingMethod","uiComponent":{"type":"DROPDOWN","options":{"values":["Accrual","Cash"]}},"description":"Accounting method for the report. Defaults to the company's preference."}
   *
   * @returns {Object}
   * @sampleResult {"Header":{"ReportName":"ProfitAndLossDetail","ReportBasis":"Accrual","StartPeriod":"2025-01-01","EndPeriod":"2025-12-31","Currency":"USD"},"Columns":{"Column":[{"ColTitle":"Date","ColType":"date"},{"ColTitle":"Transaction Type","ColType":"String"},{"ColTitle":"Name","ColType":"String"},{"ColTitle":"Amount","ColType":"Money"}]},"Rows":{"Row":[{"Header":{"ColData":[{"value":"Income"}]},"Rows":{"Row":[{"ColData":[{"value":"2025-01-15"},{"value":"Invoice"},{"value":"John Smith"},{"value":"500.00"}]}]},"Summary":{"ColData":[{"value":"Total Income"},{"value":"500.00"}]}}]}}
   */
  async getProfitAndLossDetailReport(dateMacro, startDate, endDate, accountingMethod) {
    const query = {}

    if (dateMacro) {
      query.date_macro = dateMacro
    } else {
      if (startDate) {
        query.start_date = startDate
      }

      if (endDate) {
        query.end_date = endDate
      }
    }

    if (accountingMethod) {
      query.accounting_method = accountingMethod
    }

    return await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/reports/ProfitAndLossDetail`,
      query,
      logTag: 'getProfitAndLossDetailReport',
    })
  }

  // ==================== Phase 2 & 3 Dictionary Methods ====================

  /**
   * @registerAs DICTIONARY
   * @operationName Get Vendors
   * @description Provides a searchable list of vendors for dynamic parameter selection in FlowRunner.
   * @route POST /get-vendors-dictionary
   * @paramDef {"type":"getVendorsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering vendors."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Office Supplies Co","value":"201","note":"jane@officesupplies.com"}],"cursor":null}
   */
  async getVendorsDictionary(payload) {
    const { search, cursor } = payload || {}

    const page = cursor ? parseInt(cursor) : 1
    const startPos = (page - 1) * DEFAULT_MAX_RESULTS + 1

    let queryStr = 'SELECT * FROM Vendor WHERE Active = true'

    if (search) {
      queryStr += ` AND DisplayName LIKE '%${ escapeQueryValue(search) }%'`
    }

    queryStr += ' ORDERBY DisplayName'
    queryStr += ` MAXRESULTS ${ DEFAULT_MAX_RESULTS }`
    queryStr += ` STARTPOSITION ${ startPos }`

    const response = await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/query`,
      query: { query: queryStr },
      logTag: 'getVendorsDictionary',
    })

    const vendors = response.QueryResponse?.Vendor || []
    const hasMore = vendors.length >= DEFAULT_MAX_RESULTS

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: vendors.map(vendor => ({
        label: vendor.DisplayName,
        value: vendor.Id,
        note: vendor.PrimaryEmailAddr?.Address || vendor.PrimaryPhone?.FreeFormNumber || `ID: ${ vendor.Id }`,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Employees
   * @description Provides a searchable list of employees for dynamic parameter selection in FlowRunner.
   * @route POST /get-employees-dictionary
   * @paramDef {"type":"getEmployeesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering employees."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Alice Johnson","value":"301","note":"alice@example.com"}],"cursor":null}
   */
  async getEmployeesDictionary(payload) {
    const { search, cursor } = payload || {}

    const page = cursor ? parseInt(cursor) : 1
    const startPos = (page - 1) * DEFAULT_MAX_RESULTS + 1

    let queryStr = 'SELECT * FROM Employee WHERE Active = true'

    if (search) {
      queryStr += ` AND DisplayName LIKE '%${ escapeQueryValue(search) }%'`
    }

    queryStr += ' ORDERBY DisplayName'
    queryStr += ` MAXRESULTS ${ DEFAULT_MAX_RESULTS }`
    queryStr += ` STARTPOSITION ${ startPos }`

    const response = await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/query`,
      query: { query: queryStr },
      logTag: 'getEmployeesDictionary',
    })

    const employees = response.QueryResponse?.Employee || []
    const hasMore = employees.length >= DEFAULT_MAX_RESULTS

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: employees.map(employee => ({
        label: employee.DisplayName,
        value: employee.Id,
        note: employee.PrimaryEmailAddr?.Address || employee.PrimaryPhone?.FreeFormNumber || `ID: ${ employee.Id }`,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tax Agencies
   * @description Provides a searchable list of tax agencies for dynamic parameter selection in FlowRunner.
   * @route POST /get-tax-agencies-dictionary
   * @paramDef {"type":"getTaxAgenciesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering tax agencies."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"California Franchise Tax Board","value":"5","note":"ID: 5"}],"cursor":null}
   */
  async getTaxAgenciesDictionary(payload) {
    const { search, cursor } = payload || {}

    const page = cursor ? parseInt(cursor) : 1
    const startPos = (page - 1) * DEFAULT_MAX_RESULTS + 1

    let queryStr = 'SELECT * FROM TaxAgency'
    const filters = []

    if (search) {
      filters.push(`DisplayName LIKE '%${ escapeQueryValue(search) }%'`)
    }

    if (filters.length > 0) {
      queryStr += ` WHERE ${ filters.join(' AND ') }`
    }

    queryStr += ' ORDERBY DisplayName'
    queryStr += ` MAXRESULTS ${ DEFAULT_MAX_RESULTS }`
    queryStr += ` STARTPOSITION ${ startPos }`

    const response = await this.#apiRequest({
      url: `${ this.#getBaseUrl() }/query`,
      query: { query: queryStr },
      logTag: 'getTaxAgenciesDictionary',
    })

    const taxAgencies = response.QueryResponse?.TaxAgency || []
    const hasMore = taxAgencies.length >= DEFAULT_MAX_RESULTS

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: taxAgencies.map(agency => ({
        label: agency.DisplayName,
        value: agency.Id,
        note: `ID: ${ agency.Id }`,
      })),
    }
  }
}

Flowrunner.ServerCode.addService(QuickBooksOnlineService, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    defaultValue: 'ABTuxy7q8kScfKl6wuWYNrcFoM40HyQoc3Th0mtjYTKpcEBBLE',
    required: true,
    shared: true,
    hint: 'OAuth 2.0 Client ID from Intuit Developer Portal (developer.intuit.com).',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    defaultValue: 'f895AgMpO93GJGcXv7LJrBV9REWnD9lsMpXXjGUp',
    required: true,
    shared: true,
    hint: 'OAuth 2.0 Client Secret from Intuit Developer Portal.',
  },
  {
    name: 'environment',
    displayName: 'Environment',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    defaultValue: 'Production',
    required: true,
    options: ['Production', 'Sandbox'],
    hint: 'Select Sandbox for development/testing, Production for live data.',
  },
])

/**
 * @typedef {Object} getCustomersDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter customers by display name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
 */

/**
 * @typedef {Object} getInvoicesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter invoices by document number."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
 */

/**
 * @typedef {Object} getItemsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter items by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
 */

/**
 * @typedef {Object} getAccountsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter accounts by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
 */

/**
 * @typedef {Object} getPaymentMethodsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter payment methods by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
 */

/**
 * @typedef {Object} getVendorsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter vendors by display name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
 */

/**
 * @typedef {Object} getEmployeesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter employees by display name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
 */

/**
 * @typedef {Object} getTaxAgenciesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter tax agencies by display name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
 */
