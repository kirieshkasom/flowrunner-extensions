'use strict'

const crypto = require('crypto')

const API_BASE_URL_PRODUCTION = 'https://gateway.prod.bill.com/connect/v3'
const API_BASE_URL_SANDBOX = 'https://gateway.stage.bill.com/connect/v3'

const WEBHOOK_BASE_URL_PRODUCTION = 'https://gateway.prod.bill.com/connect-events'
const WEBHOOK_BASE_URL_SANDBOX = 'https://gateway.stage.bill.com/connect-events'

const DEFAULT_PAGE_SIZE = 50

// Session-expired error codes that trigger automatic re-authentication
const SESSION_EXPIRED_CODES = ['BDC_1109', 'BDC_1120']

const MethodCallTypes = {
  SHAPE_EVENT: 'SHAPE_EVENT',
  FILTER_TRIGGER: 'FILTER_TRIGGER',
}

// Maps trigger method names to BILL.com webhook event types
const WEBHOOK_EVENTS = {
  onBillCreated: { type: 'bill.created', version: '1' },
  onBillUpdated: { type: 'bill.updated', version: '1' },
  onInvoiceCreated: { type: 'invoice.created', version: '1' },
  onInvoiceUpdated: { type: 'invoice.updated', version: '1' },
  onVendorCreated: { type: 'vendor.created', version: '1' },
  onPaymentUpdated: { type: 'payment.updated', version: '1' },
  onPaymentFailed: { type: 'payment.failed', version: '1' },
}

// Reverse mapping: BILL.com event type → trigger method name
const EVENT_TYPE_TO_METHOD = Object.entries(WEBHOOK_EVENTS).reduce((acc, [method, { type }]) => {
  acc[type] = method

  return acc
}, {})

const logger = {
  info: (...args) => console.log('[BILL.com Service] info:', ...args),
  debug: (...args) => console.log('[BILL.com Service] debug:', ...args),
  error: (...args) => console.log('[BILL.com Service] error:', ...args),
  warn: (...args) => console.log('[BILL.com Service] warn:', ...args),
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

/**
 * @integrationName BILL.com
 * @integrationIcon /icon.svg
 * @integrationTriggersScope SINGLE_APP
 */
class BillComService {
  constructor(config) {
    this.devKey = config.devKey
    this.username = config.username
    this.password = config.password
    this.organizationId = config.organizationId
    this.apiBaseUrl = config.environment === 'Sandbox' ? API_BASE_URL_SANDBOX : API_BASE_URL_PRODUCTION
    this.webhookBaseUrl = config.environment === 'Sandbox' ? WEBHOOK_BASE_URL_SANDBOX : WEBHOOK_BASE_URL_PRODUCTION
    this.sessionId = null
  }

  // ==================== Private Helpers ====================

  async #ensureSession() {
    if (this.sessionId) {
      return
    }

    logger.debug('ensureSession - logging in to BILL.com')

    try {
      const response = await Flowrunner.Request.post(`${ this.apiBaseUrl }/login`)
        .set({ 'Content-Type': 'application/json' })
        .send({
          username: this.username,
          password: this.password,
          organizationId: this.organizationId,
          devKey: this.devKey,
        })

      if (!response.sessionId) {
        throw new Error('Login failed: no sessionId returned in the response.')
      }

      this.sessionId = response.sessionId
      logger.debug('ensureSession - successfully logged in')
    } catch (error) {
      const errorMessage = error?.body?.response_data?.error_message ||
        error?.message ||
        'Unknown authentication error'

      logger.error(`ensureSession - login failed: ${ errorMessage }`)
      throw new Error(`BILL.com authentication failed: ${ errorMessage }`)
    }
  }

  #extractErrorMessage(error) {
    const body = error?.body || error
    const errorCode = body?.response_data?.error_code
    const errorMessage = body?.response_data?.error_message ||
      body?.response_message ||
      error?.message ||
      'Unknown BILL.com API error'

    return { errorCode, errorMessage }
  }

  #isSessionExpiredError(error) {
    const { errorCode } = this.#extractErrorMessage(error)

    return SESSION_EXPIRED_CODES.includes(errorCode) || error?.status === 401
  }

  async #makeRequest({ url, method, body, query, headers }) {
    const request = Flowrunner.Request[method](url)
      .set({
        sessionId: this.sessionId,
        devKey: this.devKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      })

    if (headers) {
      request.set(headers)
    }

    if (query) {
      request.query(query)
    }

    if (body) {
      return await request.send(body)
    }

    return await request
  }

  async #apiRequest({ url, method, body, query, logTag, headers }) {
    method = method || 'get'

    if (query) {
      query = cleanupObject(query)
    }

    await this.#ensureSession()

    logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

    try {
      return await this.#makeRequest({ url, method, body, query, headers })
    } catch (error) {
      if (this.#isSessionExpiredError(error)) {
        logger.warn(`${ logTag } - session expired, re-authenticating...`)
        this.sessionId = null
        await this.#ensureSession()

        return await this.#makeRequest({ url, method, body, query, headers })
      }

      const { errorMessage } = this.#extractErrorMessage(error)

      logger.error(`${ logTag } - api error: ${ errorMessage }`)
      throw new Error(`BILL.com API Error: ${ errorMessage }`)
    }
  }

  // ==================== Vendors ====================

  /**
   * @operationName Create Vendor
   * @category Vendors
   * @description Creates a new vendor in BILL.com for accounts payable. Vendors represent the people or companies you pay for goods and services.
   *
   * @route POST /create-vendor
   * @appearanceColor #00B140 #33C466
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Vendor Name","name":"name","required":true,"description":"The name of the vendor to create."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"The vendor's company or business name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Primary email address for the vendor."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Primary phone number for the vendor."}
   * @paramDef {"type":"String","label":"Address Line 1","name":"addressLine1","description":"Street address line 1."}
   * @paramDef {"type":"String","label":"City","name":"city","description":"City for the vendor's address."}
   * @paramDef {"type":"String","label":"State/Province","name":"stateOrProvince","description":"State or province for the vendor's address."}
   * @paramDef {"type":"String","label":"ZIP/Postal Code","name":"zipOrPostalCode","description":"ZIP or postal code for the vendor's address."}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"Two-letter country code (e.g., US)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"00901ABCDEFGHIJKLMN","name":"Office Supplies Co","companyName":"Office Supplies Co","email":"vendor@example.com","phone":"5551234567","archived":false,"createdTime":"2026-01-15T10:30:00.000+0000","updatedTime":"2026-01-15T10:30:00.000+0000"}
   */
  async createVendor(name, companyName, email, phone, addressLine1, city, stateOrProvince, zipOrPostalCode, country) {
    if (!name) {
      throw new Error('"Vendor Name" is required.')
    }

    const address = cleanupObject({
      line1: addressLine1,
      city,
      stateOrProvince,
      zipOrPostalCode,
      country,
    })

    const body = cleanupObject({
      name,
      companyName,
      email,
      phone,
      address,
    })

    return await this.#apiRequest({
      url: `${ this.apiBaseUrl }/vendors`,
      method: 'post',
      body,
      logTag: 'createVendor',
    })
  }

  /**
   * @operationName Get Vendor
   * @category Vendors
   * @description Retrieves detailed information about a specific vendor by ID from BILL.com. Returns the full vendor record including contact details, address, and payment configuration.
   *
   * @route POST /get-vendor
   * @appearanceColor #00B140 #33C466
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Vendor","name":"vendorId","required":true,"dictionary":"getVendorsDictionary","description":"The vendor to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"00901ABCDEFGHIJKLMN","name":"Office Supplies Co","companyName":"Office Supplies Co","email":"vendor@example.com","phone":"5551234567","archived":false,"createdTime":"2026-01-15T10:30:00.000+0000"}
   */
  async getVendor(vendorId) {
    if (!vendorId) {
      throw new Error('"Vendor" is required.')
    }

    return await this.#apiRequest({
      url: `${ this.apiBaseUrl }/vendors/${ vendorId }`,
      logTag: 'getVendor',
    })
  }

  /**
   * @operationName Update Vendor
   * @category Vendors
   * @description Updates an existing vendor's information in BILL.com. Only the fields you provide will be changed; all other fields remain unchanged.
   *
   * @route POST /update-vendor
   * @appearanceColor #00B140 #33C466
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Vendor","name":"vendorId","required":true,"dictionary":"getVendorsDictionary","description":"The vendor to update."}
   * @paramDef {"type":"String","label":"Vendor Name","name":"name","description":"Updated vendor name."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"Updated company name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Updated email address."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Updated phone number."}
   * @paramDef {"type":"String","label":"Address Line 1","name":"addressLine1","description":"Updated street address."}
   * @paramDef {"type":"String","label":"City","name":"city","description":"Updated city."}
   * @paramDef {"type":"String","label":"State/Province","name":"stateOrProvince","description":"Updated state or province."}
   * @paramDef {"type":"String","label":"ZIP/Postal Code","name":"zipOrPostalCode","description":"Updated postal code."}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"Updated two-letter country code."}
   *
   * @returns {Object}
   * @sampleResult {"id":"00901ABCDEFGHIJKLMN","name":"Office Supplies Co Updated","companyName":"Office Supplies Co","email":"vendor@example.com","archived":false,"updatedTime":"2026-01-16T10:30:00.000+0000"}
   */
  async updateVendor(vendorId, name, companyName, email, phone, addressLine1, city, stateOrProvince, zipOrPostalCode, country) {
    if (!vendorId) {
      throw new Error('"Vendor" is required.')
    }

    const address = cleanupObject({
      line1: addressLine1,
      city,
      stateOrProvince,
      zipOrPostalCode,
      country,
    })

    const body = cleanupObject({
      name,
      companyName,
      email,
      phone,
      address,
    })

    return await this.#apiRequest({
      url: `${ this.apiBaseUrl }/vendors/${ vendorId }`,
      method: 'patch',
      body,
      logTag: 'updateVendor',
    })
  }

  /**
   * @operationName List Vendors
   * @category Vendors
   * @description Retrieves a paginated list of vendors from BILL.com. Returns vendors with their basic details including name, email, and status.
   *
   * @route POST /list-vendors
   * @appearanceColor #00B140 #33C466
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of vendors to return per page, between 1 and 100. Defaults to 50."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Filter vendors whose name starts with this text (case-sensitive prefix match)."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"id":"00901ABCDEFGHIJKLMN","name":"Office Supplies Co","email":"vendor@example.com","archived":false}],"nextPage":null,"prevPage":null}
   */
  async listVendors(maxResults, name) {
    const filters = []

    if (name) {
      filters.push(`name:sw:${ name }`)
    }

    return await this.#apiRequest({
      url: `${ this.apiBaseUrl }/vendors`,
      query: {
        max: maxResults || DEFAULT_PAGE_SIZE,
        filters: filters.length ? filters.join(',') : undefined,
      },
      logTag: 'listVendors',
    })
  }

  // ==================== Bills ====================

  /**
   * @operationName Create Bill
   * @category Bills
   * @description Creates a new bill in BILL.com to record an amount owed to a vendor. Requires a vendor, invoice number, dates, and at least one line item with amount and description.
   *
   * @route POST /create-bill
   * @appearanceColor #00B140 #33C466
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Vendor","name":"vendorId","required":true,"dictionary":"getVendorsDictionary","description":"The vendor who issued the bill."}
   * @paramDef {"type":"String","label":"Invoice Number","name":"invoiceNumber","required":true,"description":"The vendor's invoice number for this bill."}
   * @paramDef {"type":"String","label":"Invoice Date","name":"invoiceDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Date of the vendor's invoice."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Payment due date for this bill."}
   * @paramDef {"type":"Array<Object>","label":"Line Items","name":"lineItems","required":true,"description":"Array of line items. Each item should have amount (number) and description (string)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"00n01ABCDEFGHIJKLMN","vendorId":"00901ABCDEFGHIJKLMN","invoiceNumber":"INV-2026-001","invoiceDate":"2026-01-15","dueDate":"2026-02-15","amount":149.00,"paymentStatus":"UNPAID","approvalStatus":"UNASSIGNED","archived":false,"billLineItems":[{"amount":149.00,"description":"Office supplies"}],"createdTime":"2026-01-15T10:30:00.000+0000"}
   */
  async createBill(vendorId, invoiceNumber, invoiceDate, dueDate, lineItems) {
    if (!vendorId) {
      throw new Error('"Vendor" is required.')
    }

    if (!invoiceNumber) {
      throw new Error('"Invoice Number" is required.')
    }

    if (!dueDate) {
      throw new Error('"Due Date" is required.')
    }

    const body = cleanupObject({
      vendorId,
      invoiceNumber,
      invoiceDate,
      dueDate,
      billLineItems: lineItems,
    })

    return await this.#apiRequest({
      url: `${ this.apiBaseUrl }/bills`,
      method: 'post',
      body,
      logTag: 'createBill',
    })
  }

  /**
   * @operationName Get Bill
   * @category Bills
   * @description Retrieves detailed information about a specific bill by ID from BILL.com. Returns the full bill record including vendor reference, line items, payment status, and approval status.
   *
   * @route POST /get-bill
   * @appearanceColor #00B140 #33C466
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Bill","name":"billId","required":true,"dictionary":"getBillsDictionary","description":"The bill to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"00n01ABCDEFGHIJKLMN","vendorId":"00901ABCDEFGHIJKLMN","invoiceNumber":"INV-2026-001","invoiceDate":"2026-01-15","dueDate":"2026-02-15","amount":149.00,"paymentStatus":"UNPAID","approvalStatus":"UNASSIGNED","archived":false,"billLineItems":[{"amount":149.00,"description":"Office supplies"}],"createdTime":"2026-01-15T10:30:00.000+0000"}
   */
  async getBill(billId) {
    if (!billId) {
      throw new Error('"Bill" is required.')
    }

    return await this.#apiRequest({
      url: `${ this.apiBaseUrl }/bills/${ billId }`,
      logTag: 'getBill',
    })
  }

  /**
   * @operationName Update Bill
   * @category Bills
   * @description Updates an existing bill in BILL.com. You can update bill details such as due date and line items. Only the fields you provide will be changed.
   *
   * @route POST /update-bill
   * @appearanceColor #00B140 #33C466
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Bill","name":"billId","required":true,"dictionary":"getBillsDictionary","description":"The bill to update."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Updated due date for this bill."}
   * @paramDef {"type":"String","label":"Invoice Number","name":"invoiceNumber","description":"Updated vendor invoice number."}
   * @paramDef {"type":"Array<Object>","label":"Line Items","name":"lineItems","description":"Updated line items. Each item should have amount (number) and description (string)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"00n01ABCDEFGHIJKLMN","vendorId":"00901ABCDEFGHIJKLMN","invoiceNumber":"INV-2026-001","dueDate":"2026-03-01","amount":200.00,"paymentStatus":"UNPAID","archived":false,"updatedTime":"2026-01-16T10:30:00.000+0000"}
   */
  async updateBill(billId, dueDate, invoiceNumber, lineItems) {
    if (!billId) {
      throw new Error('"Bill" is required.')
    }

    const body = cleanupObject({
      dueDate,
      invoiceNumber,
      billLineItems: lineItems,
    })

    return await this.#apiRequest({
      url: `${ this.apiBaseUrl }/bills/${ billId }`,
      method: 'patch',
      body,
      logTag: 'updateBill',
    })
  }

  /**
   * @operationName List Bills
   * @category Bills
   * @description Retrieves a paginated list of bills from BILL.com. Returns bills with their basic details including vendor, amount, due date, and payment status.
   *
   * @route POST /list-bills
   * @appearanceColor #00B140 #33C466
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of bills to return per page, between 1 and 100. Defaults to 50."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"id":"00n01ABCDEFGHIJKLMN","vendorId":"00901ABCDEFGHIJKLMN","invoiceNumber":"INV-2026-001","amount":149.00,"dueDate":"2026-02-15","paymentStatus":"UNPAID"}],"nextPage":null,"prevPage":null}
   */
  async listBills(maxResults) {
    return await this.#apiRequest({
      url: `${ this.apiBaseUrl }/bills`,
      query: { max: maxResults || DEFAULT_PAGE_SIZE },
      logTag: 'listBills',
    })
  }

  // ==================== Customers ====================

  /**
   * @operationName Create Customer
   * @category Customers
   * @description Creates a new customer in BILL.com for accounts receivable. Customers represent the people or companies you invoice for goods and services.
   *
   * @route POST /create-customer
   * @appearanceColor #00B140 #33C466
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Customer Name","name":"name","required":true,"description":"The name of the customer to create."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"The customer's company or business name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Primary email address for the customer. Required for sending invoices."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Primary phone number for the customer."}
   * @paramDef {"type":"String","label":"Account Type","name":"accountType","uiComponent":{"type":"DROPDOWN","options":{"values":["BUSINESS","PERSON"]}},"description":"Type of customer account. Defaults to BUSINESS if not specified."}
   * @paramDef {"type":"String","label":"Address Line 1","name":"addressLine1","description":"Billing street address line 1."}
   * @paramDef {"type":"String","label":"City","name":"city","description":"Billing city."}
   * @paramDef {"type":"String","label":"State/Province","name":"stateOrProvince","description":"Billing state or province."}
   * @paramDef {"type":"String","label":"ZIP/Postal Code","name":"zipOrPostalCode","description":"Billing postal code."}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"Two-letter country code (e.g., US)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"0cu01ABCDEFGHIJKLMN","name":"Acme Corporation","companyName":"Acme Corporation","email":"billing@acme.com","phone":"5559876543","accountType":"BUSINESS","archived":false,"createdTime":"2026-01-15T10:30:00.000+0000","updatedTime":"2026-01-15T10:30:00.000+0000"}
   */
  async createCustomer(name, companyName, email, phone, accountType, addressLine1, city, stateOrProvince, zipOrPostalCode, country) {
    if (!name) {
      throw new Error('"Customer Name" is required.')
    }

    const address = cleanupObject({
      line1: addressLine1,
      city,
      stateOrProvince,
      zipOrPostalCode,
      country,
    })

    const body = cleanupObject({
      name,
      companyName,
      email,
      phone,
      accountType,
      address,
    })

    return await this.#apiRequest({
      url: `${ this.apiBaseUrl }/customers`,
      method: 'post',
      body,
      logTag: 'createCustomer',
    })
  }

  /**
   * @operationName Get Customer
   * @category Customers
   * @description Retrieves detailed information about a specific customer by ID from BILL.com. Returns the full customer record including contact details, billing address, and balance.
   *
   * @route POST /get-customer
   * @appearanceColor #00B140 #33C466
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The customer to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"0cu01ABCDEFGHIJKLMN","name":"Acme Corporation","companyName":"Acme Corporation","email":"billing@acme.com","accountType":"BUSINESS","archived":false,"createdTime":"2026-01-15T10:30:00.000+0000"}
   */
  async getCustomer(customerId) {
    if (!customerId) {
      throw new Error('"Customer" is required.')
    }

    return await this.#apiRequest({
      url: `${ this.apiBaseUrl }/customers/${ customerId }`,
      logTag: 'getCustomer',
    })
  }

  /**
   * @operationName Update Customer
   * @category Customers
   * @description Updates an existing customer's information in BILL.com. Only the fields you provide will be changed; all other fields remain unchanged.
   *
   * @route POST /update-customer
   * @appearanceColor #00B140 #33C466
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The customer to update."}
   * @paramDef {"type":"String","label":"Customer Name","name":"name","description":"Updated customer name."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"Updated company name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Updated email address."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Updated phone number."}
   * @paramDef {"type":"String","label":"Address Line 1","name":"addressLine1","description":"Updated billing street address."}
   * @paramDef {"type":"String","label":"City","name":"city","description":"Updated billing city."}
   * @paramDef {"type":"String","label":"State/Province","name":"stateOrProvince","description":"Updated billing state or province."}
   * @paramDef {"type":"String","label":"ZIP/Postal Code","name":"zipOrPostalCode","description":"Updated billing postal code."}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"Updated two-letter country code."}
   *
   * @returns {Object}
   * @sampleResult {"id":"0cu01ABCDEFGHIJKLMN","name":"Acme Corporation Updated","email":"new@acme.com","archived":false,"updatedTime":"2026-01-16T10:30:00.000+0000"}
   */
  async updateCustomer(customerId, name, companyName, email, phone, addressLine1, city, stateOrProvince, zipOrPostalCode, country) {
    if (!customerId) {
      throw new Error('"Customer" is required.')
    }

    const address = cleanupObject({
      line1: addressLine1,
      city,
      stateOrProvince,
      zipOrPostalCode,
      country,
    })

    const body = cleanupObject({
      name,
      companyName,
      email,
      phone,
      address,
    })

    return await this.#apiRequest({
      url: `${ this.apiBaseUrl }/customers/${ customerId }`,
      method: 'patch',
      body,
      logTag: 'updateCustomer',
    })
  }

  /**
   * @operationName List Customers
   * @category Customers
   * @description Retrieves a paginated list of customers from BILL.com. Returns customers with their basic details including name, email, and account type.
   *
   * @route POST /list-customers
   * @appearanceColor #00B140 #33C466
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of customers to return per page, between 1 and 100. Defaults to 50."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"id":"0cu01ABCDEFGHIJKLMN","name":"Acme Corporation","email":"billing@acme.com","archived":false}],"nextPage":null,"prevPage":null}
   */
  async listCustomers(maxResults) {
    return await this.#apiRequest({
      url: `${ this.apiBaseUrl }/customers`,
      query: { max: maxResults || DEFAULT_PAGE_SIZE },
      logTag: 'listCustomers',
    })
  }

  // ==================== Invoices ====================

  /**
   * @operationName Create Invoice
   * @category Invoices
   * @description Creates a new invoice in BILL.com for a specified customer. Line items define the products or services being invoiced with quantity, description, and price per unit.
   *
   * @route POST /create-invoice
   * @appearanceColor #00B140 #33C466
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The customer to invoice."}
   * @paramDef {"type":"String","label":"Invoice Number","name":"invoiceNumber","required":true,"description":"A unique invoice number for your records."}
   * @paramDef {"type":"String","label":"Invoice Date","name":"invoiceDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Date of the invoice."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Payment due date for this invoice."}
   * @paramDef {"type":"Array<Object>","label":"Line Items","name":"lineItems","required":true,"description":"Array of line items. Each item should have quantity (number), description (string), and price (number per unit)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"00e01ABCDEFGHIJKLMN","customerId":"0cu01ABCDEFGHIJKLMN","invoiceNumber":"INV-001","invoiceDate":"2026-01-15","dueDate":"2026-02-15","totalAmount":299.98,"dueAmount":299.98,"status":"OPEN","invoiceLineItems":[{"quantity":2,"description":"Consulting hours","price":149.99}],"createdTime":"2026-01-15T10:30:00.000+0000"}
   */
  async createInvoice(customerId, invoiceNumber, invoiceDate, dueDate, lineItems) {
    if (!customerId) {
      throw new Error('"Customer" is required.')
    }

    if (!invoiceNumber) {
      throw new Error('"Invoice Number" is required.')
    }

    if (!dueDate) {
      throw new Error('"Due Date" is required.')
    }

    const body = cleanupObject({
      customerId,
      invoiceNumber,
      invoiceDate,
      dueDate,
      invoiceLineItems: lineItems,
    })

    return await this.#apiRequest({
      url: `${ this.apiBaseUrl }/invoices`,
      method: 'post',
      body,
      logTag: 'createInvoice',
    })
  }

  /**
   * @operationName Get Invoice
   * @category Invoices
   * @description Retrieves detailed information about a specific invoice by ID from BILL.com. Returns the full invoice record including customer reference, line items, amounts, and payment status.
   *
   * @route POST /get-invoice
   * @appearanceColor #00B140 #33C466
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"getInvoicesDictionary","description":"The invoice to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"00e01ABCDEFGHIJKLMN","customerId":"0cu01ABCDEFGHIJKLMN","invoiceNumber":"INV-001","invoiceDate":"2026-01-15","dueDate":"2026-02-15","totalAmount":299.98,"dueAmount":299.98,"status":"OPEN","invoiceLineItems":[{"quantity":2,"description":"Consulting hours","price":149.99}],"createdTime":"2026-01-15T10:30:00.000+0000"}
   */
  async getInvoice(invoiceId) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required.')
    }

    return await this.#apiRequest({
      url: `${ this.apiBaseUrl }/invoices/${ invoiceId }`,
      logTag: 'getInvoice',
    })
  }

  /**
   * @operationName Update Invoice
   * @category Invoices
   * @description Updates an existing invoice in BILL.com. You can update the due date, invoice number, and line items. Only the fields you provide will be changed.
   *
   * @route POST /update-invoice
   * @appearanceColor #00B140 #33C466
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"getInvoicesDictionary","description":"The invoice to update."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Updated due date for this invoice."}
   * @paramDef {"type":"String","label":"Invoice Number","name":"invoiceNumber","description":"Updated invoice number."}
   * @paramDef {"type":"Array<Object>","label":"Line Items","name":"lineItems","description":"Updated line items. Each item should have quantity, description, and price."}
   *
   * @returns {Object}
   * @sampleResult {"id":"00e01ABCDEFGHIJKLMN","customerId":"0cu01ABCDEFGHIJKLMN","invoiceNumber":"INV-001","dueDate":"2026-03-01","totalAmount":399.98,"dueAmount":399.98,"status":"OPEN","updatedTime":"2026-01-16T10:30:00.000+0000"}
   */
  async updateInvoice(invoiceId, dueDate, invoiceNumber, lineItems) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required.')
    }

    const body = cleanupObject({
      dueDate,
      invoiceNumber,
      invoiceLineItems: lineItems,
    })

    return await this.#apiRequest({
      url: `${ this.apiBaseUrl }/invoices/${ invoiceId }`,
      method: 'patch',
      body,
      logTag: 'updateInvoice',
    })
  }

  /**
   * @operationName List Invoices
   * @category Invoices
   * @description Retrieves a paginated list of invoices from BILL.com. Returns invoices with their basic details including customer, amounts, due date, and status.
   *
   * @route POST /list-invoices
   * @appearanceColor #00B140 #33C466
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of invoices to return per page, between 1 and 100. Defaults to 50."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"id":"00e01ABCDEFGHIJKLMN","customerId":"0cu01ABCDEFGHIJKLMN","invoiceNumber":"INV-001","dueDate":"2026-02-15","totalAmount":299.98,"dueAmount":299.98,"status":"OPEN"}],"nextPage":null,"prevPage":null}
   */
  async listInvoices(maxResults) {
    return await this.#apiRequest({
      url: `${ this.apiBaseUrl }/invoices`,
      query: { max: maxResults || DEFAULT_PAGE_SIZE },
      logTag: 'listInvoices',
    })
  }

  /**
   * @operationName Send Invoice
   * @category Invoices
   * @description Sends an invoice to the customer via email through BILL.com. The customer receives a professionally formatted email with the invoice details and a payment link.
   *
   * @route POST /send-invoice
   * @appearanceColor #00B140 #33C466
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"getInvoicesDictionary","description":"The invoice to send via email."}
   *
   * @returns {Object}
   * @sampleResult {"id":"00e01ABCDEFGHIJKLMN","invoiceNumber":"INV-001","status":"SENT"}
   */
  async sendInvoice(invoiceId) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required.')
    }

    return await this.#apiRequest({
      url: `${ this.apiBaseUrl }/invoices/${ invoiceId }/email`,
      method: 'post',
      logTag: 'sendInvoice',
    })
  }

  // ==================== Bill Payments ====================

  /**
   * @operationName Record Bill Payment
   * @category Bill Payments
   * @description Records an accounts payable payment in BILL.com. Use this to record a payment made to a vendor and apply the recorded amount to one or more bills.
   *
   * @route POST /create-bill-payment
   * @appearanceColor #00B140 #33C466
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Vendor","name":"vendorId","required":true,"dictionary":"getVendorsDictionary","description":"The vendor being paid."}
   * @paramDef {"type":"Array<BillPaymentItem>","label":"Payments","name":"payments","required":true,"description":"One or more bill payment allocations. Each item specifies which bill to pay and the amount to apply."}
   * @paramDef {"type":"String","label":"Process Date","name":"processDate","uiComponent":{"type":"DATE_PICKER"},"description":"Date the payment should be processed (YYYY-MM-DD format)."}
   * @paramDef {"type":"Boolean","label":"Print Check","name":"toPrintCheck","uiComponent":{"type":"TOGGLE"},"description":"Whether to print a check for this payment."}
   *
   * @returns {Object}
   * @sampleResult {"id":"0bp01ABCDEFGHIJKLMN","vendorId":"00901ABCDEFGHIJKLMN","amount":100.00,"processDate":"2026-01-20","toPrintCheck":false,"payments":[{"billId":"00n01ABCDEFGHIJKLMN","amount":100.00}],"createdTime":"2026-01-20T10:30:00.000+0000"}
   */
  async createBillPayment(vendorId, payments, processDate, toPrintCheck) {
    if (!vendorId) {
      throw new Error('"Vendor" is required.')
    }

    if (!payments || !Array.isArray(payments) || payments.length === 0) {
      throw new Error('"Payments" is required and must contain at least one payment allocation.')
    }

    const body = cleanupObject({
      vendorId,
      payments,
      processDate,
      toPrintCheck,
    })

    return await this.#apiRequest({
      url: `${ this.apiBaseUrl }/bills/record-payment`,
      method: 'post',
      body,
      logTag: 'createBillPayment',
    })
  }

  /**
   * @operationName Get Bill Payment
   * @category Bill Payments
   * @description Retrieves detailed information about a specific bill payment by ID from BILL.com. Returns the full payment record including vendor, amount, status, and linked bills.
   *
   * @route POST /get-bill-payment
   * @appearanceColor #00B140 #33C466
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"The ID of the bill payment to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"0bp01ABCDEFGHIJKLMN","vendorId":"00901ABCDEFGHIJKLMN","amount":149.00,"paymentDate":"2026-01-20","status":"PAID","createdTime":"2026-01-20T10:30:00.000+0000"}
   */
  async getBillPayment(paymentId) {
    if (!paymentId) {
      throw new Error('"Payment ID" is required.')
    }

    return await this.#apiRequest({
      url: `${ this.apiBaseUrl }/payments/${ paymentId }`,
      logTag: 'getBillPayment',
    })
  }

  /**
   * @operationName List Bill Payments
   * @category Bill Payments
   * @description Retrieves a paginated list of accounts payable payments from BILL.com. Returns payments with their basic details including vendor, amount, and status.
   *
   * @route POST /list-bill-payments
   * @appearanceColor #00B140 #33C466
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of payments to return per page, between 1 and 100. Defaults to 50."}
   * @paramDef {"type":"String","label":"Vendor ID","name":"vendorId","description":"Filter payments to a single vendor by their BILL.com vendor ID."}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"Filter payments by status (e.g. SCHEDULED, PROCESSED, CANCELED, VOIDED, PAID_OFFLINE)."}
   * @paramDef {"type":"String","label":"Process Date From","name":"processDateFrom","uiComponent":{"type":"DATE_PICKER"},"description":"Only return payments with a process date on or after this date (YYYY-MM-DD format)."}
   * @paramDef {"type":"String","label":"Process Date To","name":"processDateTo","uiComponent":{"type":"DATE_PICKER"},"description":"Only return payments with a process date on or before this date (YYYY-MM-DD format)."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"id":"0bp01ABCDEFGHIJKLMN","vendorId":"00901ABCDEFGHIJKLMN","amount":149.00,"paymentDate":"2026-01-20","status":"PAID"}],"nextPage":null,"prevPage":null}
   */
  async listBillPayments(maxResults, vendorId, status, processDateFrom, processDateTo) {
    const filters = []

    if (vendorId) {
      filters.push(`vendorId:eq:${ vendorId }`)
    }

    if (status) {
      filters.push(`status:eq:${ status }`)
    }

    if (processDateFrom) {
      filters.push(`processDate:gte:${ processDateFrom }`)
    }

    if (processDateTo) {
      filters.push(`processDate:lte:${ processDateTo }`)
    }

    return await this.#apiRequest({
      url: `${ this.apiBaseUrl }/payments`,
      query: {
        max: maxResults || DEFAULT_PAGE_SIZE,
        filters: filters.length ? filters.join(',') : undefined,
      },
      logTag: 'listBillPayments',
    })
  }

  // ==================== Receivable Payments ====================

  /**
   * @operationName Charge Customer
   * @category Receivable Payments
   * @description Charges a customer for one or more invoices in BILL.com. The customer must have a bank account on file. Applies the payment to specified invoices.
   *
   * @route POST /charge-customer
   * @appearanceColor #00B140 #33C466
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The customer to charge."}
   * @paramDef {"type":"String","label":"Bank Account ID","name":"bankAccountId","required":true,"description":"The customer's BILL.com bank account ID to charge."}
   * @paramDef {"type":"Array<Object>","label":"Invoice Payments","name":"invoicePayments","required":true,"description":"Array of invoice payment allocations. Each should have invoiceId (string) and amount (number)."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description for the payment transaction."}
   *
   * @returns {Object}
   * @sampleResult {"id":"0rp01ABCDEFGHIJKLMN","customerId":"0cu01ABCDEFGHIJKLMN","amount":299.98,"status":"PAID","paymentDate":"2026-01-20","createdTime":"2026-01-20T10:30:00.000+0000"}
   */
  async chargeCustomer(customerId, bankAccountId, invoicePayments, description) {
    if (!customerId) {
      throw new Error('"Customer" is required.')
    }

    if (!bankAccountId) {
      throw new Error('"Bank Account ID" is required.')
    }

    if (!invoicePayments || !Array.isArray(invoicePayments) || invoicePayments.length === 0) {
      throw new Error('"Invoice Payments" is required and must contain at least one payment allocation.')
    }

    const body = cleanupObject({
      customerId,
      bankAccountId,
      invoicePayments,
      description,
    })

    return await this.#apiRequest({
      url: `${ this.apiBaseUrl }/receivable-payments`,
      method: 'post',
      body,
      logTag: 'chargeCustomer',
    })
  }

  /**
   * @operationName Get Receivable Payment
   * @category Receivable Payments
   * @description Retrieves detailed information about a specific received payment by ID from BILL.com. Returns the full payment record including customer, amount, status, and linked invoices.
   *
   * @route POST /get-receivable-payment
   * @appearanceColor #00B140 #33C466
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"The ID of the receivable payment to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"0rp01ABCDEFGHIJKLMN","customerId":"0cu01ABCDEFGHIJKLMN","amount":299.98,"status":"PAID","paymentDate":"2026-01-20","createdTime":"2026-01-20T10:30:00.000+0000"}
   */
  async getReceivablePayment(paymentId) {
    if (!paymentId) {
      throw new Error('"Payment ID" is required.')
    }

    return await this.#apiRequest({
      url: `${ this.apiBaseUrl }/receivable-payments/${ paymentId }`,
      logTag: 'getReceivablePayment',
    })
  }

  /**
   * @operationName List Receivable Payments
   * @category Receivable Payments
   * @description Retrieves a paginated list of received payments from BILL.com. Returns payments with their basic details including customer, amount, status, and payment date.
   *
   * @route POST /list-receivable-payments
   * @appearanceColor #00B140 #33C466
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of payments to return per page, between 1 and 100. Defaults to 50."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"id":"0rp01ABCDEFGHIJKLMN","customerId":"0cu01ABCDEFGHIJKLMN","amount":299.98,"status":"PAID","paymentDate":"2026-01-20"}],"nextPage":null,"prevPage":null}
   */
  async listReceivablePayments(maxResults) {
    return await this.#apiRequest({
      url: `${ this.apiBaseUrl }/receivable-payments`,
      query: { max: maxResults || DEFAULT_PAGE_SIZE },
      logTag: 'listReceivablePayments',
    })
  }

  // ==================== Trigger System Methods ====================

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    const existingSubscriptionId = invocation.webhookData?.subscriptionId
    const existingSecurityKey = invocation.webhookData?.securityKey

    const neededEventTypes = [...new Set(
      invocation.events.map(event => WEBHOOK_EVENTS[event.name]?.type).filter(Boolean)
    )]

    if (neededEventTypes.length === 0) {
      logger.warn('handleTriggerUpsertWebhook - no valid event types found')

      return { webhookData: invocation.webhookData || {} }
    }

    const events = neededEventTypes.map(type => ({
      type,
      version: '1',
    }))

    if (existingSubscriptionId) {
      logger.debug(`handleTriggerUpsertWebhook - updating subscription ${ existingSubscriptionId }`)

      await this.#apiRequest({
        url: `${ this.webhookBaseUrl }/v3/subscriptions/${ existingSubscriptionId }`,
        method: 'put',
        headers: { 'X-Idempotent-Key': crypto.randomUUID() },
        body: {
          name: 'FlowRunner BILL.com trigger',
          notificationUrl: invocation.callbackUrl,
          status: { enabled: true },
          events,
        },
        logTag: 'handleTriggerUpsertWebhook - update',
      })

      return {
        webhookData: {
          subscriptionId: existingSubscriptionId,
          securityKey: existingSecurityKey,
        },
      }
    }

    logger.debug('handleTriggerUpsertWebhook - creating new subscription')

    const response = await this.#apiRequest({
      url: `${ this.webhookBaseUrl }/v3/subscriptions`,
      method: 'post',
      headers: { 'X-Idempotent-Key': crypto.randomUUID() },
      body: {
        name: 'FlowRunner BILL.com trigger',
        notificationUrl: invocation.callbackUrl,
        status: { enabled: true },
        events,
      },
      logTag: 'handleTriggerUpsertWebhook - create',
    })

    return {
      webhookData: {
        subscriptionId: response.id || response.subscriptionId,
        securityKey: response.securityKey,
      },
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    const eventType = invocation.body?.metadata?.eventType
    const methodName = EVENT_TYPE_TO_METHOD[eventType]

    if (!methodName) {
      logger.warn(`handleTriggerResolveEvents - unknown event type: ${ eventType }`)

      return { events: [] }
    }

    const events = await this[methodName](MethodCallTypes.SHAPE_EVENT, invocation)

    return { events }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    return this[invocation.eventName](MethodCallTypes.FILTER_TRIGGER, invocation)
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerDeleteWebhook(invocation) {
    const subscriptionId = invocation.webhookData?.subscriptionId

    if (subscriptionId) {
      logger.debug(`handleTriggerDeleteWebhook - deleting subscription ${ subscriptionId }`)

      try {
        await this.#apiRequest({
          url: `${ this.webhookBaseUrl }/v3/subscriptions/${ subscriptionId }`,
          method: 'delete',
          logTag: 'handleTriggerDeleteWebhook',
        })
      } catch (error) {
        logger.warn(`handleTriggerDeleteWebhook - failed to delete: ${ error.message }`)
      }
    }

    return { webhookData: {} }
  }

  // ==================== Trigger Events ====================

  /**
   * @operationName On Bill Created
   * @category Triggers
   * @description Triggered when a new bill is created in BILL.com. Fires whenever a vendor bill is added to accounts payable.
   *
   * @route POST /on-bill-created
   * @registerAs REALTIME_TRIGGER
   * @appearanceColor #00B140 #33C466
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"eventType":"bill.created","id":"00n01ABCDEFGHIJKLMN","vendorId":"00901ABCDEFGHIJKLMN","amount":149.00,"invoiceNumber":"INV-2026-001","paymentStatus":"UNPAID"}
   */
  async onBillCreated(callType, invocation) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [{
        name: 'onBillCreated',
        data: {
          eventType: invocation.body?.metadata?.eventType,
          ...invocation.body?.bill,
        },
      }]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      return { ids: invocation.triggers.map(t => t.id) }
    }
  }

  /**
   * @operationName On Bill Updated
   * @category Triggers
   * @description Triggered when a bill is updated in BILL.com. Fires when bill fields change such as vendor, amount, invoice number, invoice date, or purchase order.
   *
   * @route POST /on-bill-updated
   * @registerAs REALTIME_TRIGGER
   * @appearanceColor #00B140 #33C466
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"eventType":"bill.updated","id":"00n01ABCDEFGHIJKLMN","vendorId":"00901ABCDEFGHIJKLMN","amount":200.00,"invoiceNumber":"INV-2026-001","paymentStatus":"UNPAID"}
   */
  async onBillUpdated(callType, invocation) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [{
        name: 'onBillUpdated',
        data: {
          eventType: invocation.body?.metadata?.eventType,
          ...invocation.body?.bill,
        },
      }]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      return { ids: invocation.triggers.map(t => t.id) }
    }
  }

  /**
   * @operationName On Invoice Created
   * @category Triggers
   * @description Triggered when a new invoice is created in BILL.com. Fires whenever an accounts receivable invoice is generated for a customer.
   *
   * @route POST /on-invoice-created
   * @registerAs REALTIME_TRIGGER
   * @appearanceColor #00B140 #33C466
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"eventType":"invoice.created","id":"00e01ABCDEFGHIJKLMN","customerId":"0cu01ABCDEFGHIJKLMN","invoiceNumber":"INV-001","totalAmount":299.98,"status":"OPEN"}
   */
  async onInvoiceCreated(callType, invocation) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [{
        name: 'onInvoiceCreated',
        data: {
          eventType: invocation.body?.metadata?.eventType,
          ...invocation.body?.invoice,
        },
      }]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      return { ids: invocation.triggers.map(t => t.id) }
    }
  }

  /**
   * @operationName On Invoice Updated
   * @category Triggers
   * @description Triggered when an invoice is updated in BILL.com. Fires when invoice details are modified including amounts, dates, or status changes.
   *
   * @route POST /on-invoice-updated
   * @registerAs REALTIME_TRIGGER
   * @appearanceColor #00B140 #33C466
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"eventType":"invoice.updated","id":"00e01ABCDEFGHIJKLMN","customerId":"0cu01ABCDEFGHIJKLMN","invoiceNumber":"INV-001","totalAmount":399.98,"status":"OPEN"}
   */
  async onInvoiceUpdated(callType, invocation) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [{
        name: 'onInvoiceUpdated',
        data: {
          eventType: invocation.body?.metadata?.eventType,
          ...invocation.body?.invoice,
        },
      }]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      return { ids: invocation.triggers.map(t => t.id) }
    }
  }

  /**
   * @operationName On Vendor Created
   * @category Triggers
   * @description Triggered when a new vendor is created in BILL.com. Fires whenever a vendor is added to accounts payable.
   *
   * @route POST /on-vendor-created
   * @registerAs REALTIME_TRIGGER
   * @appearanceColor #00B140 #33C466
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"eventType":"vendor.created","id":"00901ABCDEFGHIJKLMN","name":"Office Supplies Co","email":"vendor@example.com","archived":false}
   */
  async onVendorCreated(callType, invocation) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [{
        name: 'onVendorCreated',
        data: {
          eventType: invocation.body?.metadata?.eventType,
          ...invocation.body?.vendor,
        },
      }]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      return { ids: invocation.triggers.map(t => t.id) }
    }
  }

  /**
   * @operationName On Payment Updated
   * @category Triggers
   * @description Triggered when a payment status changes in BILL.com. Fires when payments transition between states such as pending, processing, paid, or voided.
   *
   * @route POST /on-payment-updated
   * @registerAs REALTIME_TRIGGER
   * @appearanceColor #00B140 #33C466
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"eventType":"payment.updated","id":"stp01ABCDEFGHIJKLMN","status":"PAID","amount":149.00}
   */
  async onPaymentUpdated(callType, invocation) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [{
        name: 'onPaymentUpdated',
        data: {
          eventType: invocation.body?.metadata?.eventType,
          ...invocation.body?.payment,
        },
      }]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      return { ids: invocation.triggers.map(t => t.id) }
    }
  }

  /**
   * @operationName On Payment Failed
   * @category Triggers
   * @description Triggered when a payment fails in BILL.com. Fires when a payment request is declined or encounters an error during processing.
   *
   * @route POST /on-payment-failed
   * @registerAs REALTIME_TRIGGER
   * @appearanceColor #00B140 #33C466
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"eventType":"payment.failed","id":"stp01ABCDEFGHIJKLMN","status":"FAILED","amount":149.00}
   */
  async onPaymentFailed(callType, invocation) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [{
        name: 'onPaymentFailed',
        data: {
          eventType: invocation.body?.metadata?.eventType,
          ...invocation.body?.payment,
        },
      }]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      return { ids: invocation.triggers.map(t => t.id) }
    }
  }

  // ==================== Dictionary Methods ====================

  /**
   * @registerAs DICTIONARY
   * @operationName Get Vendors
   * @description Provides a searchable list of vendors for dynamic parameter selection in FlowRunner.
   * @route POST /get-vendors-dictionary
   * @paramDef {"type":"getVendorsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering vendors."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Office Supplies Co","value":"00901ABCDEFGHIJKLMN","note":"vendor@example.com"}],"cursor":null}
   */
  async getVendorsDictionary(payload) {
    const { search, cursor } = payload || {}

    const query = { max: DEFAULT_PAGE_SIZE }

    if (cursor) {
      query.page = cursor
    }

    const response = await this.#apiRequest({
      url: `${ this.apiBaseUrl }/vendors`,
      query,
      logTag: 'getVendorsDictionary',
    })

    let vendors = response.results || []

    if (search) {
      const searchLower = search.toLowerCase()
      vendors = vendors.filter(v => v.name?.toLowerCase().includes(searchLower))
    }

    return {
      cursor: response.nextPage || null,
      items: vendors.map(vendor => ({
        label: vendor.name || `Vendor ${ vendor.id }`,
        value: vendor.id,
        note: vendor.email || `ID: ${ vendor.id }`,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Customers
   * @description Provides a searchable list of customers for dynamic parameter selection in FlowRunner.
   * @route POST /get-customers-dictionary
   * @paramDef {"type":"getCustomersDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering customers."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Acme Corporation","value":"0cu01ABCDEFGHIJKLMN","note":"billing@acme.com"}],"cursor":null}
   */
  async getCustomersDictionary(payload) {
    const { search, cursor } = payload || {}

    const query = { max: DEFAULT_PAGE_SIZE }

    if (cursor) {
      query.page = cursor
    }

    const response = await this.#apiRequest({
      url: `${ this.apiBaseUrl }/customers`,
      query,
      logTag: 'getCustomersDictionary',
    })

    let customers = response.results || []

    if (search) {
      const searchLower = search.toLowerCase()
      customers = customers.filter(c => c.name?.toLowerCase().includes(searchLower))
    }

    return {
      cursor: response.nextPage || null,
      items: customers.map(customer => ({
        label: customer.name || `Customer ${ customer.id }`,
        value: customer.id,
        note: customer.email || `ID: ${ customer.id }`,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Bills
   * @description Provides a searchable list of bills for dynamic parameter selection in FlowRunner.
   * @route POST /get-bills-dictionary
   * @paramDef {"type":"getBillsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering bills."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Bill #INV-2026-001","value":"00n01ABCDEFGHIJKLMN","note":"$149.00 - UNPAID"}],"cursor":null}
   */
  async getBillsDictionary(payload) {
    const { search, cursor } = payload || {}

    const query = { max: DEFAULT_PAGE_SIZE }

    if (cursor) {
      query.page = cursor
    }

    const response = await this.#apiRequest({
      url: `${ this.apiBaseUrl }/bills`,
      query,
      logTag: 'getBillsDictionary',
    })

    let bills = response.results || []

    if (search) {
      const searchLower = search.toLowerCase()
      bills = bills.filter(b => b.invoiceNumber?.toLowerCase().includes(searchLower))
    }

    return {
      cursor: response.nextPage || null,
      items: bills.map(bill => ({
        label: bill.invoiceNumber ? `Bill #${ bill.invoiceNumber }` : `Bill ${ bill.id }`,
        value: bill.id,
        note: `$${ bill.amount || 0 } - ${ bill.paymentStatus || 'Unknown' }`,
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
   * @sampleResult {"items":[{"label":"Invoice #INV-001","value":"00e01ABCDEFGHIJKLMN","note":"$299.98 - OPEN"}],"cursor":null}
   */
  async getInvoicesDictionary(payload) {
    const { search, cursor } = payload || {}

    const query = { max: DEFAULT_PAGE_SIZE }

    if (cursor) {
      query.page = cursor
    }

    const response = await this.#apiRequest({
      url: `${ this.apiBaseUrl }/invoices`,
      query,
      logTag: 'getInvoicesDictionary',
    })

    let invoices = response.results || []

    if (search) {
      const searchLower = search.toLowerCase()
      invoices = invoices.filter(i => i.invoiceNumber?.toLowerCase().includes(searchLower))
    }

    return {
      cursor: response.nextPage || null,
      items: invoices.map(invoice => ({
        label: invoice.invoiceNumber ? `Invoice #${ invoice.invoiceNumber }` : `Invoice ${ invoice.id }`,
        value: invoice.id,
        note: `$${ invoice.totalAmount || invoice.dueAmount || 0 } - ${ invoice.status || 'Unknown' }`,
      })),
    }
  }
}

Flowrunner.ServerCode.addService(BillComService, [
  {
    name: 'devKey',
    displayName: 'Developer Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Developer key from your BILL.com developer account at developer.bill.com.',
  },
  {
    name: 'username',
    displayName: 'Username',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Email address used to sign in to your BILL.com account.',
  },
  {
    name: 'password',
    displayName: 'Password',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Password for your BILL.com account.',
  },
  {
    name: 'organizationId',
    displayName: 'Organization ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Your BILL.com organization ID. Found in your developer account settings.',
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
 * @typedef {Object} BillPaymentItem
 * @property {String} billId
 * @property {Number} amount
 */

/**
 * @typedef {Object} getVendorsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter vendors by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
 */

/**
 * @typedef {Object} getCustomersDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter customers by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
 */

/**
 * @typedef {Object} getBillsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter bills by invoice number."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
 */

/**
 * @typedef {Object} getInvoicesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter invoices by invoice number."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
 */
