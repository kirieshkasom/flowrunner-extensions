'use strict'

const https = require('https')
const http = require('http')

const DEFAULT_API_VERSION = '24.200.001'

const logger = {
  info: (...args) => console.log('[Acumatica Service] info:', ...args),
  debug: (...args) => console.log('[Acumatica Service] debug:', ...args),
  error: (...args) => console.log('[Acumatica Service] error:', ...args),
  warn: (...args) => console.log('[Acumatica Service] warn:', ...args),
}

/**
 * @usesFileStorage
 * @integrationName Acumatica
 * @integrationIcon /icon.svg
 * @description Integrates with Acumatica ERP for vendor validation, bill management, and accounts payable automation. Supports creating bills, releasing bills from hold, and searching bills by description or vendor reference.
 */
class AcumaticaService {
  constructor(config) {
    this.instanceUrl = (config.instanceUrl || '').replace(/\/+$/, '')
    this.username = config.username
    this.password = config.password
    this.cookies = null

    const apiVersion = config.apiVersion || DEFAULT_API_VERSION

    this.apiBaseUrl = `${ this.instanceUrl }/entity/Default/${ apiVersion }`

    logger.debug(`constructor - instanceUrl: ${ this.instanceUrl }, apiVersion: ${ apiVersion }`)
  }

  async #login() {
    const body = JSON.stringify({
      name: this.username,
      password: this.password,
      company: '',
    })

    const loginUrl = new URL(`${ this.instanceUrl }/entity/auth/login`)
    const protocol = loginUrl.protocol === 'https:' ? https : http

    return new Promise((resolve, reject) => {
      const req = protocol.request({
        hostname: loginUrl.hostname,
        port: loginUrl.port || (loginUrl.protocol === 'https:' ? 443 : 80),
        path: loginUrl.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      }, res => {
        let data = ''

        res.on('data', chunk => data += chunk)

        res.on('end', () => {
          if (res.statusCode === 204 || res.statusCode === 200) {
            const setCookies = res.headers['set-cookie'] || []

            this.cookies = setCookies.map(c => c.split(';')[0]).join('; ')

            logger.debug(`#login - session established (${ setCookies.length } cookies)`)

            resolve()
          } else {
            reject(new Error(`Login failed (HTTP ${ res.statusCode }): ${ data || 'No response body' }`))
          }
        })
      })

      req.on('error', reject)
      req.write(body)
      req.end()
    })
  }

  async #logout() {
    if (!this.cookies) {
      return
    }

    try {
      logger.debug('#logout - releasing session')

      await Flowrunner.Request.post(`${ this.instanceUrl }/entity/auth/logout`)
        .set({ Cookie: this.cookies })

      logger.debug('#logout - session released')
    } catch (error) {
      logger.warn(`#logout - failed to release session: ${ error.message }`)
    }

    this.cookies = null
  }

  async #ensureSession() {
    if (!this.cookies) {
      await this.#login()
    }
  }

  async #withSession(fn) {
    await this.#ensureSession()

    try {
      return await fn()
    } finally {
      await this.#logout()
    }
  }

  async #apiRequest({ url, method, body, query, logTag }, isRetry) {
    method = method || 'get'

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      const request = Flowrunner.Request[method](url)
        .set({
          Cookie: this.cookies,
          'Content-Type': 'application/json',
        })

      if (query) {
        request.query(query)
      }

      if (body) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      if (!isRetry && (error.statusCode === 401 || error.status === 401)) {
        logger.debug(`${ logTag } - session expired, re-authenticating`)

        await this.#login()

        return this.#apiRequest({ url, method, body, query, logTag }, true)
      }

      if (error.body) {
        logger.error(`${ logTag } - response body: ${ JSON.stringify(error.body) }`)
      }

      const message = error.body?.exceptionMessage ||
        error.body?.innerException?.innerException?.exceptionMessage ||
        error.body?.innerException?.exceptionMessage ||
        error.body?.error ||
        error.body?.Message ||
        error.body?.message ||
        (typeof error.message === 'string' ? error.message : null) ||
        'Unknown error'

      logger.error(`${ logTag } - error: ${ message }`)

      throw new Error(`${ logTag } failed: ${ message }`)
    }
  }

  // =============================== VENDOR METHODS ================================

  /**
   * @operationName Validate Vendor
   * @category Vendors
   * @description Retrieves a vendor record from Acumatica by Vendor ID to validate the vendor exists and is active. Returns the full vendor record including name, status, and payment terms.
   *
   * @route GET /validate-vendor
   * @appearanceColor #33CCFF #66DDFF
   *
   * @paramDef {"type":"String","label":"Vendor ID","name":"vendorId","required":true,"description":"The unique Vendor ID in Acumatica (e.g., 'V000001')."}
   *
   * @returns {Object}
   * @sampleResult {"VendorID":{"value":"V000001"},"VendorName":{"value":"Office Supply Co"},"Status":{"value":"Active"},"Terms":{"value":"30D"},"VendorClass":{"value":"DOMESTIC"},"CurrencyID":{"value":"USD"}}
   */
  async validateVendor(vendorId) {
    if (!vendorId) {
      throw new Error('"Vendor ID" is required')
    }

    return this.#withSession(() => this.#apiRequest({
      logTag: 'validateVendor',
      url: `${ this.apiBaseUrl }/Vendor/${ encodeURIComponent(vendorId) }`,
    }))
  }

  /**
   * @operationName List Vendors
   * @category Vendors
   * @description Retrieves a list of vendors from Acumatica. Use the optional OData filter to narrow results by status, class, or other fields. Useful for verifying seed data or browsing available vendors.
   *
   * @route GET /list-vendors
   * @appearanceColor #33CCFF #66DDFF
   *
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"OData $filter expression (e.g., \"Status eq 'Active'\", \"VendorClass eq 'DOMESTIC'\"). If omitted, returns all vendors."}
   * @paramDef {"type":"String","label":"Select Fields","name":"select","description":"Comma-separated list of fields to return (e.g., 'VendorID,VendorName,Status'). If omitted, all fields are returned."}
   * @paramDef {"type":"Number","label":"Top","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of vendors to return."}
   *
   * @returns {Array}
   * @sampleResult [{"VendorID":{"value":"V000001"},"VendorName":{"value":"Office Supply Co"},"Status":{"value":"Active"},"VendorClass":{"value":"DOMESTIC"}},{"VendorID":{"value":"V000002"},"VendorName":{"value":"Pacific Beverages"},"Status":{"value":"Active"},"VendorClass":{"value":"DOMESTIC"}}]
   */
  async listVendors(filter, select, top) {
    const query = {}

    if (filter) {
      query['$filter'] = filter
    }

    if (select) {
      query['$select'] = select
    }

    if (top) {
      query['$top'] = top
    }

    return this.#withSession(() => this.#apiRequest({
      logTag: 'listVendors',
      url: `${ this.apiBaseUrl }/Vendor`,
      query: Object.keys(query).length > 0 ? query : undefined,
    }))
  }

  /**
   * @operationName Get Vendor
   * @category Vendors
   * @description Retrieves full details of a single vendor by Vendor ID, including name, class, payment terms, currency, and contact information. Use this to pull vendor data for display or downstream processing.
   *
   * @route GET /get-vendor
   * @appearanceColor #33CCFF #66DDFF
   *
   * @paramDef {"type":"String","label":"Vendor ID","name":"vendorId","required":true,"description":"The unique Vendor ID in Acumatica (e.g., 'V000001')."}
   *
   * @returns {Object}
   * @sampleResult {"VendorID":{"value":"V000001"},"VendorName":{"value":"Office Supply Co"},"Status":{"value":"Active"},"Terms":{"value":"30D"},"VendorClass":{"value":"DOMESTIC"},"CurrencyID":{"value":"USD"}}
   */
  async getVendor(vendorId) {
    if (!vendorId) {
      throw new Error('"Vendor ID" is required')
    }

    return this.#withSession(() => this.#apiRequest({
      logTag: 'getVendor',
      url: `${ this.apiBaseUrl }/Vendor/${ encodeURIComponent(vendorId) }`,
    }))
  }

  /**
   * @operationName Create Vendor
   * @category Vendors
   * @description Creates a new vendor record in Acumatica. At minimum, provide a Vendor ID and Vendor Name. Optionally set vendor class, default payment terms, and currency. Useful for auto-creating new distributors or suppliers from FlowRunner workflows.
   *
   * @route POST /create-vendor
   * @appearanceColor #33CCFF #66DDFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Vendor ID","name":"vendorId","required":true,"description":"Unique identifier for the new vendor (e.g., 'PACBEV'). Must not already exist in Acumatica."}
   * @paramDef {"type":"String","label":"Vendor Name","name":"vendorName","required":true,"description":"Display name for the vendor (e.g., 'Pacific Beverages LLC')."}
   * @paramDef {"type":"String","label":"Vendor Class","name":"vendorClass","description":"Vendor classification code (e.g., 'DOMESTIC', 'FOREIGN'). Determines default GL accounts and settings. If omitted, uses the system default class."}
   * @paramDef {"type":"String","label":"Terms","name":"terms","description":"Default payment terms for this vendor (e.g., 'NET30', '2/10NET30'). Applied automatically to new bills for this vendor."}
   * @paramDef {"type":"String","label":"Currency ID","name":"currencyId","description":"Default currency code for transactions with this vendor (e.g., 'USD', 'EUR'). If omitted, uses the system base currency."}
   *
   * @returns {Object}
   * @sampleResult {"VendorID":{"value":"PACBEV"},"VendorName":{"value":"Pacific Beverages LLC"},"Status":{"value":"Active"},"VendorClass":{"value":"DOMESTIC"},"Terms":{"value":"NET30"},"CurrencyID":{"value":"USD"}}
   */
  async createVendor(vendorId, vendorName, vendorClass, terms, currencyId) {
    if (!vendorId) {
      throw new Error('"Vendor ID" is required')
    }

    if (!vendorName) {
      throw new Error('"Vendor Name" is required')
    }

    const vendor = {
      VendorID: { value: vendorId },
      VendorName: { value: vendorName },
    }

    if (vendorClass) {
      vendor.VendorClass = { value: vendorClass }
    }

    if (terms) {
      vendor.Terms = { value: terms }
    }

    if (currencyId) {
      vendor.CurrencyID = { value: currencyId }
    }

    return this.#withSession(() => this.#apiRequest({
      logTag: 'createVendor',
      method: 'put',
      url: `${ this.apiBaseUrl }/Vendor`,
      body: vendor,
    }))
  }

  // =============================== BILL METHODS ================================

  /**
   * @typedef {Object} BillDetailLine
   * @property {String} Description - Line item description (e.g., 'Price Support (780 cases @ $2.00)')
   * @property {Number} Amount - Bill-level amount (header field, not typically used on detail lines)
   * @property {String} Account - GL expense account number (e.g., '5100')
   * @property {String} Subaccount - GL subaccount segment
   * @property {String} InventoryID - Inventory item ID
   * @property {Number} Qty - Quantity
   * @property {Number} UnitCost - Cost per unit
   * @property {String} UOM - Unit of measure (e.g., 'EA', 'HR')
   * @property {String} Branch - Branch identifier
   * @property {Number} ExtendedCost - Extended cost (Qty * UnitCost)
   * @property {String} Project - Project code
   * @property {String} ProjectTask - Project task code
   */

  /**
   * @operationName Check Duplicate Bill
   * @category Bills
   * @description Checks if a bill with the specified vendor ID and vendor reference number already exists in Acumatica. Returns matching bills to prevent duplicate bill entry. An empty array indicates no duplicates were found.
   *
   * @route POST /check-duplicate-bill
   * @appearanceColor #33CCFF #66DDFF
   *
   * @paramDef {"type":"String","label":"Vendor ID","name":"vendorId","required":true,"description":"The Vendor ID to check against (e.g., 'V000001')."}
   * @paramDef {"type":"String","label":"Vendor Reference","name":"vendorRef","required":true,"description":"The vendor's invoice or reference number to check for existing bills (e.g., 'INV-2025-001')."}
   *
   * @returns {Array}
   * @sampleResult [{"ReferenceNbr":{"value":"000042"},"Type":{"value":"Bill"},"Vendor":{"value":"V000001"},"VendorRef":{"value":"INV-2025-001"},"Status":{"value":"Open"},"Amount":{"value":1500.00},"Balance":{"value":1500.00}}]
   */
  async checkDuplicateBill(vendorId, vendorRef) {
    if (!vendorId) {
      throw new Error('"Vendor ID" is required')
    }

    if (!vendorRef) {
      throw new Error('"Vendor Reference" is required')
    }

    return this.#withSession(() => this.#apiRequest({
      logTag: 'checkDuplicateBill',
      url: `${ this.apiBaseUrl }/Bill`,
      query: {
        '$filter': `VendorID eq '${ vendorId }' and VendorRef eq '${ vendorRef }'`,
      },
    }))
  }

  /**
   * @operationName Create Bill
   * @category Bills
   * @description Creates a new Accounts Payable bill in Acumatica. The bill is created in Hold status by default. Provide vendor, reference number, dates, and optionally line item details as a JSON array.
   *
   * @route POST /create-bill
   * @appearanceColor #33CCFF #66DDFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Vendor","name":"vendor","required":true,"description":"The Vendor ID for this bill (e.g., 'V000001'). Must be a valid, active vendor in Acumatica."}
   * @paramDef {"type":"String","label":"Vendor Reference","name":"vendorRef","required":true,"description":"The vendor's invoice or reference number (e.g., 'INV-2025-001'). Used to match the bill to the vendor's original invoice."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"The bill date. If omitted, defaults to the current date in Acumatica."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"The payment due date for this bill. If omitted, calculated from the vendor's payment terms."}
   * @paramDef {"type":"String","label":"Post Period","name":"postPeriod","description":"The financial period for posting (e.g., '012025' for January 2025). If omitted, derived from the bill date."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"A description or memo for the bill. Helps identify the bill purpose in reports and lists."}
   * @paramDef {"type":"String","label":"Location ID","name":"locationId","description":"The vendor location ID if the vendor has multiple locations. Uses the vendor's default location if omitted."}
   * @paramDef {"type":"String","label":"Terms","name":"terms","description":"Payment terms override (e.g., 'Net30', '2/10Net30'). If omitted, uses the vendor's default payment terms."}
   * @paramDef {"type":"Array.<BillDetailLine>","label":"Detail Lines","name":"detailLines","description":"Array of bill detail line objects. Each line should include at minimum Description, ExtendedCost, and Account. Example: [{\"Description\":\"Price Support\",\"ExtendedCost\":1560.00,\"Account\":\"5100\"}]"}
   *
   * @returns {Object}
   * @sampleResult {"ReferenceNbr":{"value":"000043"},"Type":{"value":"Bill"},"Vendor":{"value":"V000001"},"VendorRef":{"value":"INV-2025-001"},"Status":{"value":"On Hold"},"Date":{"value":"2025-01-15T00:00:00"},"Amount":{"value":50.00},"Hold":{"value":true}}
   */
  async createBill(vendor, vendorRef, date, dueDate, postPeriod, description, locationId, terms, detailLines) {
    if (!vendor) {
      throw new Error('"Vendor" is required')
    }

    if (!vendorRef) {
      throw new Error('"Vendor Reference" is required')
    }

    const bill = {
      Vendor: { value: vendor },
      VendorRef: { value: vendorRef },
      Type: { value: 'Bill' },
    }

    if (date) {
      bill.Date = { value: new Date(Number(date) || date).toISOString() }
    }

    if (dueDate) {
      bill.DueDate = { value: new Date(Number(dueDate) || dueDate).toISOString() }
    }

    if (postPeriod) {
      bill.PostPeriod = { value: postPeriod }
    }

    if (description) {
      bill.Description = { value: description }
    }

    if (locationId) {
      bill.LocationID = { value: locationId }
    }

    if (terms) {
      bill.Terms = { value: terms }
    }

    if (Array.isArray(detailLines) && detailLines.length > 0) {
      const detailFields = [
        'Branch',
        'InventoryID',
        'Description',
        'UOM',
        'Qty',
        'UnitCost',
        'ExtendedCost',
        'Amount',
        'Account',
        'Subaccount',
        'Project',
        'ProjectTask',
      ]

      bill.Details = detailLines.map(line => {
        const wrappedLine = {}

        detailFields.forEach(field => {
          if (line[field] !== undefined && line[field] !== null) {
            wrappedLine[field] = { value: line[field] }
          }
        })

        return wrappedLine
      })

      const total = detailLines.reduce((sum, line) => sum + (Number(line.ExtendedCost) || 0), 0)

      if (total > 0) {
        bill.Amount = { value: total }
      }
    }

    return this.#withSession(() => this.#apiRequest({
      logTag: 'createBill',
      method: 'put',
      url: `${ this.apiBaseUrl }/Bill`,
      body: bill,
    }))
  }

  /**
   * @operationName Release Bill from Hold
   * @category Bills
   * @description Releases a bill from Hold status in Acumatica, changing its status to Balanced and making it available for payment processing. The bill must currently be in Hold status.
   *
   * @route POST /release-bill-from-hold
   * @appearanceColor #33CCFF #66DDFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Reference Number","name":"referenceNbr","required":true,"description":"The system-generated bill reference number (e.g., '000043'). This is the ReferenceNbr field, not the VendorRef."}
   *
   * @returns {Object}
   * @sampleResult {"ReferenceNbr":{"value":"000043"},"Type":{"value":"Bill"},"Vendor":{"value":"V000001"},"VendorRef":{"value":"INV-2025-001"},"Status":{"value":"Balanced"},"Hold":{"value":false},"Amount":{"value":50.00}}
   */
  async releaseBillFromHold(referenceNbr) {
    if (!referenceNbr) {
      throw new Error('"Reference Number" is required')
    }

    return this.#withSession(() => this.#apiRequest({
      logTag: 'releaseBillFromHold',
      method: 'post',
      url: `${ this.apiBaseUrl }/Bill/ReleaseFromHold`,
      body: {
        entity: {
          Type: { value: 'Bill' },
          ReferenceNbr: { value: referenceNbr },
        },
        parameters: {},
      },
    }))
  }

  /**
   * @operationName Get Bill
   * @category Bills
   * @description Retrieves bills from Acumatica by vendor reference number to verify a bill was created successfully or to look up bill details. Returns all bills matching the specified vendor reference, including their detail lines.
   *
   * @route POST /get-bill
   * @appearanceColor #33CCFF #66DDFF
   *
   * @paramDef {"type":"String","label":"Vendor Reference","name":"vendorRef","required":true,"description":"The vendor's invoice or reference number to search for (e.g., 'INV-2025-001')."}
   *
   * @returns {Array}
   * @sampleResult [{"ReferenceNbr":{"value":"000043"},"Type":{"value":"Bill"},"Vendor":{"value":"V000001"},"VendorRef":{"value":"INV-2025-001"},"Status":{"value":"Balanced"},"Date":{"value":"2025-01-15T00:00:00"},"Amount":{"value":50.00},"Balance":{"value":50.00},"Details":[{"Description":{"value":"Price Support"},"ExtendedCost":{"value":50.00},"Account":{"value":"5100"},"Qty":{"value":1},"UnitCost":{"value":50.00}}]}]
   */
  async getBill(vendorRef) {
    if (!vendorRef) {
      throw new Error('"Vendor Reference" is required')
    }

    return this.#withSession(() => this.#apiRequest({
      logTag: 'getBill',
      url: `${ this.apiBaseUrl }/Bill`,
      query: {
        '$filter': `VendorRef eq '${ vendorRef }'`,
        '$expand': 'Details',
      },
    }))
  }

  /**
   * @operationName Search Bills by Description
   * @category Bills
   * @description Searches for bills in Acumatica whose description contains the specified keyword. Useful for finding related bills or detecting potential duplicate payments based on description text.
   *
   * @route GET /search-bills-by-description
   * @appearanceColor #33CCFF #66DDFF
   *
   * @paramDef {"type":"String","label":"Keyword","name":"keyword","required":true,"description":"The search keyword to find in bill descriptions. Matches any bill whose Description field contains this text."}
   * @paramDef {"type":"Number","label":"Top","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of bills to return. Limits results for performance when searching broadly."}
   *
   * @returns {Array}
   * @sampleResult [{"ReferenceNbr":{"value":"000042"},"Type":{"value":"Bill"},"Vendor":{"value":"V000001"},"VendorRef":{"value":"INV-001"},"Status":{"value":"Open"},"Description":{"value":"Office supplies Q1"},"Amount":{"value":1500.00}}]
   */
  async searchBillsByDescription(keyword, top) {
    if (!keyword) {
      throw new Error('"Keyword" is required')
    }

    const query = {
      '$filter': `Description contains '${ keyword }'`,
    }

    if (top) {
      query['$top'] = top
    }

    return this.#withSession(() => this.#apiRequest({
      logTag: 'searchBillsByDescription',
      url: `${ this.apiBaseUrl }/Bill`,
      query,
    }))
  }

  /**
   * @operationName List Bills
   * @category Bills
   * @description Retrieves a list of bills from Acumatica. Use the optional OData filter to narrow results by status, vendor, date range, or other fields. Useful for confirming creates worked or browsing all AP bills.
   *
   * @route GET /list-bills
   * @appearanceColor #33CCFF #66DDFF
   *
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"OData $filter expression (e.g., \"Status eq 'Open'\", \"Vendor eq 'PACBEV'\"). If omitted, returns all bills."}
   * @paramDef {"type":"String","label":"Select Fields","name":"select","description":"Comma-separated list of fields to return (e.g., 'ReferenceNbr,Vendor,VendorRef,Status,Amount'). If omitted, all fields are returned."}
   * @paramDef {"type":"Number","label":"Top","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of bills to return."}
   *
   * @returns {Array}
   * @sampleResult [{"ReferenceNbr":{"value":"000042"},"Type":{"value":"Bill"},"Vendor":{"value":"V000001"},"VendorRef":{"value":"INV-001"},"Status":{"value":"Open"},"Amount":{"value":1500.00}},{"ReferenceNbr":{"value":"000043"},"Type":{"value":"Bill"},"Vendor":{"value":"PACBEV"},"VendorRef":{"value":"PBD-2025-0892"},"Status":{"value":"On Hold"},"Amount":{"value":3630.00}}]
   */
  async listBills(filter, select, top) {
    const query = {}

    if (filter) {
      query['$filter'] = filter
    }

    if (select) {
      query['$select'] = select
    }

    if (top) {
      query['$top'] = top
    }

    return this.#withSession(() => this.#apiRequest({
      logTag: 'listBills',
      url: `${ this.apiBaseUrl }/Bill`,
      query: Object.keys(query).length > 0 ? query : undefined,
    }))
  }

  /**
   * @operationName Get Bill by Reference Number
   * @category Bills
   * @description Retrieves a bill from Acumatica by its system-generated reference number. Cleaner than searching by VendorRef when you already know the Acumatica ReferenceNbr.
   *
   * @route POST /get-bill-by-reference-nbr
   * @appearanceColor #33CCFF #66DDFF
   *
   * @paramDef {"type":"String","label":"Reference Number","name":"referenceNbr","required":true,"description":"The system-generated Acumatica bill reference number (e.g., '000043')."}
   *
   * @returns {Array}
   * @sampleResult [{"ReferenceNbr":{"value":"000043"},"Type":{"value":"Bill"},"Vendor":{"value":"PACBEV"},"VendorRef":{"value":"PBD-2025-0892"},"Status":{"value":"Balanced"},"Date":{"value":"2025-02-20T00:00:00"},"Amount":{"value":3630.00},"Balance":{"value":3630.00},"Description":{"value":"Kroger SoCal Winter Hydration Promo"}}]
   */
  async getBillByReferenceNbr(referenceNbr) {
    if (!referenceNbr) {
      throw new Error('"Reference Number" is required')
    }

    return this.#withSession(() => this.#apiRequest({
      logTag: 'getBillByReferenceNbr',
      url: `${ this.apiBaseUrl }/Bill`,
      query: {
        '$filter': `ReferenceNbr eq '${ referenceNbr }'`,
      },
    }))
  }

  /**
   * @operationName Delete Bill
   * @category Bills
   * @description Deletes a bill from Acumatica by its reference number. The bill must be in On Hold status to be deleted. Useful for resetting between demo runs or cleaning up erroneously created bills without using the Acumatica UI.
   *
   * @route POST /delete-bill
   * @appearanceColor #33CCFF #66DDFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Reference Number","name":"referenceNbr","required":true,"description":"The system-generated bill reference number to delete (e.g., '000043'). The bill must be in Hold status."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"referenceNbr":"000043"}
   */
  async deleteBill(referenceNbr) {
    if (!referenceNbr) {
      throw new Error('"Reference Number" is required')
    }

    return this.#withSession(async () => {
      await this.#apiRequest({
        logTag: 'deleteBill',
        method: 'delete',
        url: `${ this.apiBaseUrl }/Bill/Bill/${ referenceNbr }`,
      })

      return { deleted: true, referenceNbr }
    })
  }

  /**
   * @operationName Attach File to Bill
   * @category Bills
   * @description Downloads a file from the provided URL and attaches it to an existing bill in Acumatica. Use this to attach the original billback PDF, supporting documentation, or invoice images to the Acumatica record.
   *
   * @route POST /attach-file-to-bill
   * @appearanceColor #33CCFF #66DDFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Reference Number","name":"referenceNbr","required":true,"description":"The bill reference number to attach the file to (e.g., '000043')."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","required":true,"description":"Name for the attached file including extension (e.g., 'invoice-PBD-2025-0892.pdf')."}
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"URL of the file to download and attach. Can be any publicly accessible URL."}
   *
   * @returns {Object}
   * @sampleResult {"attached":true,"referenceNbr":"000043","fileName":"invoice-PBD-2025-0892.pdf"}
   */
  async attachFileToBill(referenceNbr, fileName, fileUrl) {
    if (!referenceNbr) {
      throw new Error('"Reference Number" is required')
    }

    if (!fileName) {
      throw new Error('"File Name" is required')
    }

    if (!fileUrl) {
      throw new Error('"File URL" is required')
    }

    return this.#withSession(async () => {
      try {
        logger.debug(`attachFileToBill - downloading file from: ${ fileUrl }`)

        const fileData = await Flowrunner.Request.get(fileUrl).setEncoding(null)

        const encodedFileName = encodeURIComponent(fileName)
        const uploadUrl = `${ this.apiBaseUrl }/Bill/Bill/${ referenceNbr }/files/${ encodedFileName }`

        logger.debug(`attachFileToBill - uploading to: ${ uploadUrl }`)

        await Flowrunner.Request.put(uploadUrl)
          .set({
            Cookie: this.cookies,
            'Content-Type': 'application/octet-stream',
          })
          .send(fileData)

        return { attached: true, referenceNbr, fileName }
      } catch (error) {
        const message = error.body?.exceptionMessage || error.body?.Message || error.message || 'Unknown error'

        logger.error(`attachFileToBill - error: ${ message }`)

        throw new Error(`attachFileToBill failed: ${ message }`)
      }
    })
  }

  /**
   * @operationName List Bill Files
   * @category Bills
   * @description Lists the files attached to a bill in Acumatica by its reference number. Returns the attachment metadata (filename and download link) for each file on the record. Useful for verifying that supporting documents were attached or for retrieving previously uploaded invoices.
   *
   * @route POST /list-bill-files
   * @appearanceColor #33CCFF #66DDFF
   *
   * @paramDef {"type":"String","label":"Reference Number","name":"referenceNbr","required":true,"description":"The system-generated bill reference number whose attachments you want to list (e.g., '000043'). This is the ReferenceNbr field, not the VendorRef."}
   *
   * @returns {Array}
   * @sampleResult [{"id":"7c9e6679-7425-40de-944b-e07fc1f90ae7","filename":"Bill (Bill, 000043)/invoice-PBD-2025-0892.pdf","href":"/entity/Default/25.200.001/files/7c9e6679-7425-40de-944b-e07fc1f90ae7","url":"https://mycompany.acumatica.com/entity/Default/25.200.001/files/7c9e6679-7425-40de-944b-e07fc1f90ae7"}]
   */
  async getBillFiles(referenceNbr) {
    if (!referenceNbr) {
      throw new Error('"Reference Number" is required')
    }

    return this.#withSession(async () => {
      // Look the bill up with a $filter (same proven approach as getBillByReferenceNbr) and
      // expand its files. This avoids retrieving by key path (/Bill/Bill/{ref}), which also
      // requires Type='Bill' to match and otherwise fails with "No entity satisfies the
      // condition.", and it avoids the standalone ".../files" sub-resource, which can throw
      // "Operation is not valid due to the current state of the object." on some versions.
      const bills = await this.#apiRequest({
        logTag: 'getBillFiles',
        url: `${ this.apiBaseUrl }/Bill`,
        query: {
          '$filter': `ReferenceNbr eq '${ referenceNbr }'`,
          '$expand': 'files',
        },
      })

      const bill = Array.isArray(bills) ? bills[0] : bills
      const files = bill?.files

      if (!Array.isArray(files)) {
        return []
      }

      return files.map(file => {
        const href = file?.href

        if (!href) {
          return file
        }

        // href is relative to the instance (e.g. "/entity/Default/.../files/{id}").
        // Prefix it with the instance URL so callers get a directly fetchable URL.
        const url = /^https?:\/\//i.test(href)
          ? href
          : `${ this.instanceUrl }${ href.startsWith('/') ? '' : '/' }${ href }`

        return { ...file, url }
      })
    })
  }

  /**
   * @operationName Download Bill File
   * @category Bills
   * @description Downloads a file attached to a bill and saves it to FlowRunner file storage, returning a native FlowRunner URL to the stored file. Provide the file URL (or relative href) returned by "List Bill Files". The file is fetched using an authenticated Acumatica session, so attachments that are not publicly accessible can still be retrieved, then uploaded to FlowRunner storage for use elsewhere in your flow.
   *
   * @route POST /download-bill-file
   * @appearanceColor #33CCFF #66DDFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"description":"The file URL or relative href returned by \"List Bill Files\" (the 'url' or 'href' field), e.g. 'https://mycompany.acumatica.com/entity/Default/24.200.001/files/{id}'."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","required":false,"description":"The file's name from \"List Bill Files\" (the 'filename' field). Any embedded directory path is stripped automatically. If omitted, a name is derived from the URL."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   *
   * @returns {Object}
   * @sampleResult {"url":"https://backendlessappcontent.com/APP-ID/REST-KEY/files/flow/Invoice_69993_from_Hayden_Beverage.pdf","filename":"Invoice_69993_from_Hayden_Beverage.pdf"}
   */
  async downloadBillFile(fileUrl, fileName, fileOptions) {
    if (!fileUrl) {
      throw new Error('"File URL" is required')
    }

    // Accept either the absolute "url" or the relative "href" from List Bill Files.
    const url = /^https?:\/\//i.test(fileUrl)
      ? fileUrl
      : `${ this.instanceUrl }${ fileUrl.startsWith('/') ? '' : '/' }${ fileUrl }`

    // Sanitize the provided filename: strip any directory prefix (the Acumatica
    // filename embeds a Windows-style path, e.g. "Folder\\Invoice.pdf"), splitting
    // on both forward and back slashes and taking the last segment, then replace
    // characters the FlowRunner Files API disallows (spaces, '#', parentheses,
    // etc.) with underscores while preserving the extension dot. Runs of dots are
    // collapsed to a single dot — the Files API rejects '..' (path-traversal guard),
    // so embedded sequences like "Invoice...Shoprite.pdf" would otherwise fail.
    const sanitizeName = value => String(value || '')
      .split(/[/\\]/).pop()
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/\.{2,}/g, '.')
      .replace(/^[._]+|[._]+$/g, '')

    let resolvedName = sanitizeName(fileName)

    if (!resolvedName) {
      // Derive a fallback name from the URL's last path segment.
      resolvedName = sanitizeName(url.split('?')[0])
    }

    if (!resolvedName) {
      resolvedName = 'acumatica-bill-file'
    }

    return this.#withSession(async () => {
      try {
        logger.debug(`downloadBillFile - fetching file from: ${ url }`)

        const fileData = await Flowrunner.Request.get(url)
          .set({ Cookie: this.cookies })
          .setEncoding(null)

        const buffer = Buffer.isBuffer(fileData) ? fileData : Buffer.from(fileData)

        const result = await this.flowrunner.Files.uploadFile(buffer, {
          filename: resolvedName,
          generateUrl: true,
          overwrite: true,
          ...(fileOptions || { scope: 'FLOW' }),
        })

        return { url: result.url, filename: resolvedName }
      } catch (error) {
        const message = error.body?.exceptionMessage || error.body?.Message || error.message || 'Unknown error'

        logger.error(`downloadBillFile - error: ${ message }`)

        throw new Error(`downloadBillFile failed: ${ message }`)
      }
    })
  }

  // =============================== REFERENCE DATA METHODS ================================

  /**
   * @operationName List GL Accounts
   * @category Reference Data
   * @description Retrieves a list of General Ledger accounts from Acumatica. Use this to verify account codes (e.g., expense account '5100') before creating bills, or to browse the chart of accounts.
   *
   * @route GET /list-gl-accounts
   * @appearanceColor #33CCFF #66DDFF
   *
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"OData $filter expression (e.g., \"Type eq 'Expense'\", \"AccountCD eq '5100'\"). If omitted, returns all accounts."}
   * @paramDef {"type":"String","label":"Select Fields","name":"select","description":"Comma-separated list of fields to return (e.g., 'AccountCD,Description,Type'). If omitted, all fields are returned."}
   * @paramDef {"type":"Number","label":"Top","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of accounts to return."}
   *
   * @returns {Array}
   * @sampleResult [{"AccountCD":{"value":"5100"},"Description":{"value":"Cost of Goods Sold"},"Type":{"value":"Expense"},"Active":{"value":true}},{"AccountCD":{"value":"6000"},"Description":{"value":"Advertising Expense"},"Type":{"value":"Expense"},"Active":{"value":true}}]
   */
  async listGLAccounts(filter, select, top) {
    const query = {}

    if (filter) {
      query['$filter'] = filter
    }

    if (select) {
      query['$select'] = select
    }

    if (top) {
      query['$top'] = top
    }

    return this.#withSession(() => this.#apiRequest({
      logTag: 'listGLAccounts',
      url: `${ this.apiBaseUrl }/Account`,
      query: Object.keys(query).length > 0 ? query : undefined,
    }))
  }

  /**
   * @operationName List Credit Terms
   * @category Reference Data
   * @description Retrieves a list of payment terms defined in Acumatica. Use this to verify that a terms code (e.g., 'NET30') exists before creating bills or vendors, or to browse all available payment terms.
   *
   * @route GET /list-credit-terms
   * @appearanceColor #33CCFF #66DDFF
   *
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"OData $filter expression (e.g., \"TermsID eq 'NET30'\"). If omitted, returns all payment terms."}
   * @paramDef {"type":"String","label":"Select Fields","name":"select","description":"Comma-separated list of fields to return (e.g., 'TermsID,Description,DueType'). If omitted, all fields are returned."}
   * @paramDef {"type":"Number","label":"Top","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of terms to return."}
   *
   * @returns {Array}
   * @sampleResult [{"TermsID":{"value":"NET30"},"Description":{"value":"Net 30 Days"},"DueType":{"value":"FixedNumberOfDays"},"DueDays":{"value":30}},{"TermsID":{"value":"2/10NET30"},"Description":{"value":"2% 10 Days, Net 30"},"DueType":{"value":"FixedNumberOfDays"},"DueDays":{"value":30}}]
   */
  async listCreditTerms(filter, select, top) {
    const query = {}

    if (filter) {
      query['$filter'] = filter
    }

    if (select) {
      query['$select'] = select
    }

    if (top) {
      query['$top'] = top
    }

    return this.#withSession(() => this.#apiRequest({
      logTag: 'listCreditTerms',
      url: `${ this.apiBaseUrl }/Terms`,
      query: Object.keys(query).length > 0 ? query : undefined,
    }))
  }

  // =============================== SHIPMENT METHODS ================================

  /**
   * @operationName Get Shipment Volumes by Customer and Period
   * @category Shipments
   * @description Queries completed shipments for a specific customer within a date range and returns aggregated volumes per SKU. Sums ShippedQty across all matching shipments for each InventoryID. Useful for validating distributor-claimed volumes against actual shipment records.
   *
   * @route POST /get-shipment-volumes
   * @appearanceColor #33CCFF #66DDFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Customer ID","name":"customerID","required":true,"description":"The Acumatica Customer ID to query shipments for (e.g., 'PACBEV')."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Period start date (inclusive). Format: YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Period end date (inclusive). Format: YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"Status","name":"status","required":false,"description":"Filter by shipment status (e.g., 'Completed', 'Confirmed', 'Open'). Leave empty to return all statuses."}
   *
   * @returns {Object}
   * @sampleResult {"customerID":"PACBEV","period":{"start":"2025-01-15","end":"2025-02-15"},"shipments_found":3,"volumes":[{"sku":"REC-ORG-12","description":"Recover 180 Original 12pk","total_cases_shipped":780},{"sku":"REC-CIT-12","description":"Recover 180 Citrus Burst 12pk","total_cases_shipped":612}]}
   */
  async getShipmentVolumes(customerID, startDate, endDate, status) {
    if (!customerID) {
      throw new Error('"Customer ID" is required')
    }

    if (!startDate) {
      throw new Error('"Start Date" is required')
    }

    if (!endDate) {
      throw new Error('"End Date" is required')
    }

    const start = new Date(Number(startDate) || startDate).toISOString().split('T')[0]
    const end = new Date(Number(endDate) || endDate).toISOString().split('T')[0]

    return this.#withSession(async () => {
      const filterParts = [
        `CustomerID eq '${ customerID }'`,
        `ShipmentDate ge datetimeoffset'${ start }'`,
        `ShipmentDate le datetimeoffset'${ end }'`,
      ]

      if (status) {
        filterParts.push(`Status eq '${ status }'`)
      }

      const filter = encodeURIComponent(filterParts.join(' and '))
      const expand = encodeURIComponent('Details')

      const url = `${ this.apiBaseUrl }/Shipment?$filter=${ filter }&$expand=${ expand }`

      logger.debug(`getShipmentVolumes - url: ${ url }`)

      const shipments = await this.#apiRequest({
        logTag: 'getShipmentVolumes',
        url,
      })

      logger.debug(`getShipmentVolumes - response type: ${ typeof shipments }, isArray: ${ Array.isArray(shipments) }, length: ${ Array.isArray(shipments) ? shipments.length : 'N/A' }`)
      logger.debug(`getShipmentVolumes - raw response: ${ JSON.stringify(shipments) }`)

      const result = {
        customerID,
        period: { start, end },
        shipments_found: 0,
        volumes: [],
      }

      if (!Array.isArray(shipments) || shipments.length === 0) {
        return result
      }

      result.shipments_found = shipments.length

      const skuMap = {}

      for (const shipment of shipments) {
        if (!Array.isArray(shipment.Details)) {
          continue
        }

        for (const line of shipment.Details) {
          const sku = line.InventoryID?.value
          const qty = Number(line.ShippedQty?.value) || 0

          if (!sku) {
            continue
          }

          if (!skuMap[sku]) {
            skuMap[sku] = {
              sku,
              description: line.Description?.value || '',
              total_cases_shipped: 0,
            }
          }

          skuMap[sku].total_cases_shipped += qty
        }
      }

      result.volumes = Object.values(skuMap)

      return result
    })
  }

  // =============================== REPORT METHODS ================================

  /**
   * @operationName Get AP Account Balance
   * @category Reports
   * @description Retrieves the AP Aging Summary report (AP632000) from Acumatica showing outstanding balances by vendor. Optionally filter by a specific vendor to see their aging buckets and total outstanding amount.
   *
   * @route POST /get-ap-account-balance
   * @appearanceColor #33CCFF #66DDFF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Vendor ID","name":"vendorId","description":"Optional Vendor ID to filter the report to a single vendor. If omitted, returns aging data for all vendors."}
   *
   * @returns {Object}
   * @sampleResult {"ReportResults":[{"VendorID":{"value":"PACBEV"},"VendorName":{"value":"Pacific Beverages"},"CurrentBalance":{"value":3630.00},"Age01":{"value":3630.00},"Age02":{"value":0},"Age03":{"value":0},"Age04":{"value":0},"TotalDue":{"value":3630.00}}]}
   */
  async getAPAccountBalance(vendorId) {
    const body = {
      entity: {},
      parameters: {},
    }

    if (vendorId) {
      body.parameters.VendorID = { value: vendorId }
    }

    return this.#withSession(() => this.#apiRequest({
      logTag: 'getAPAccountBalance',
      method: 'post',
      url: `${ this.apiBaseUrl }/Report/AP632000`,
      body,
    }))
  }
}

Flowrunner.ServerCode.addService(AcumaticaService, [
  {
    order: 0,
    displayName: 'Instance URL',
    name: 'instanceUrl',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Your Acumatica instance URL (e.g., https://mycompany.acumatica.com).',
  },
  {
    order: 1,
    displayName: 'Username',
    name: 'username',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Acumatica API user login.',
  },
  {
    order: 2,
    displayName: 'Password',
    name: 'password',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Acumatica API user password.',
  },
  {
    order: 3,
    displayName: 'API Version',
    name: 'apiVersion',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    hint: `Endpoint version (default: ${ DEFAULT_API_VERSION }). Check your instance for supported versions.`,
  },
])
