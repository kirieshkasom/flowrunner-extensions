// SAP Business One - Service Layer integration (OData v4 over the on-prem b1s/v1 API,
// session-cookie auth via /Login). The Cancel bound action is supported only on A/R Invoices,
// A/R Credit Memos, Incoming/Outgoing Payments, Orders, and Purchase Orders.

// ============================================================================
//  CONSTANTS
// ============================================================================
const SERVICE_LAYER_PATH = '/b1s/v1'
// Default Service Layer page size is 20; clients follow odata.nextLink to get every row.

// Friendly dropdown label -> SAP Service Layer API enum value. Dropdowns expose the labels;
// #resolveChoice maps a chosen label back to the API value (and passes through raw API values).
const CARD_TYPE_LABELS = {
  Customer: 'cCustomer',
  'Vendor / Supplier': 'cSupplier',
  Lead: 'cLead',
}
const DOCUMENT_STATUS_LABELS = {
  Open: 'bost_Open',
  Closed: 'bost_Close',
}
const ACTIVITY_TYPE_LABELS = {
  Conversation: 'cn_Conversation',
  Meeting: 'cn_Meeting',
  Task: 'cn_Task',
  Note: 'cn_Note',
  'Phone Call': 'cn_PhoneCall',
}

// ============================================================================
//  LOGGER
// ============================================================================
const logger = {
  info: (...args) => console.log('[SAP Business One] info:', ...args),
  debug: (...args) => console.log('[SAP Business One] debug:', ...args),
  error: (...args) => console.log('[SAP Business One] error:', ...args),
  warn: (...args) => console.log('[SAP Business One] warn:', ...args),
}

// ============================================================================
//  TYPEDEFS - document / line shapes (give AI agents a real schema)
// ============================================================================
/**
 * @typedef {Object} DocumentLine
 * @property {String} ItemCode - Item code on the line (pick with Get Items).
 * @property {Number} Quantity - Quantity ordered/shipped on this line.
 * @property {Number} UnitPrice - Price per unit for this line.
 * @property {String} TaxCode - Tax code applied to the line (e.g. 'T1').
 * @property {String} WarehouseCode - Warehouse the line draws from / ships to.
 * @property {Number} DiscountPercent - Per-line discount percentage.
 */

/**
 * @typedef {Object} PaymentInvoiceLink
 * @property {Number} DocEntry - DocEntry of the invoice being paid.
 * @property {Number} SumApplied - Amount applied to that invoice.
 * @property {String} InvoiceType - Document object type of the paid invoice (e.g. 'it_Invoice').
 */

/**
 * @typedef {Object} JournalEntryLine
 * @property {String} AccountCode - G/L account code (pick with Get Accounts).
 * @property {Number} Debit - Debit amount for this line.
 * @property {Number} Credit - Credit amount for this line.
 * @property {String} LineMemo - Free-text memo for this line.
 */

// ============================================================================
//  DICTIONARY PAYLOAD TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} getBusinessPartnersDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Type","name":"cardType","description":"Optional partner type to filter by (cCustomer, cSupplier, or cLead)."}
 */
/**
 * @typedef {Object} getBusinessPartnersDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text matched against partner name and code."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset ($skip) for the next page of results."}
 * @paramDef {"type":"getBusinessPartnersDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Optional filter values, e.g. a partner type."}
 */

/**
 * @typedef {Object} getItemsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text matched against item name and code."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset ($skip) for the next page of results."}
 */

/**
 * @typedef {Object} getWarehousesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text matched against warehouse name and code."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset ($skip) for the next page of results."}
 */

/**
 * @typedef {Object} getPriceListsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text matched against price list name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset ($skip) for the next page of results."}
 */

/**
 * @typedef {Object} getChartOfAccountsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text matched against account name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset ($skip) for the next page of results."}
 */

/**
 * @typedef {Object} getDocumentDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text matched against the customer/vendor code on the document."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset ($skip) for the next page of results."}
 */

/**
 * @integrationName SAP Business One
 * @integrationIcon /icon.svg
 * @appearanceColor #0A6ED1 #4BA3F0
 */
class SAPBusinessOne {
  constructor(config) {
    this.config = config || {}
    this.baseUrl = (this.config.baseUrl || '').replace(/\/+$/, '')
    this.companyDB = this.config.companyDB
    this.username = this.config.username
    this.password = this.config.password
    this.session = null
  }

  // ==========================================================================
  //  SESSION + CORE REQUEST
  // ==========================================================================
  #serviceLayerUrl(entity) {
    return `${ this.baseUrl }${ SERVICE_LAYER_PATH }/${ entity }`
  }

  // Logs in and caches the B1SESSION + ROUTEID cookies. Session lives ~30 min.
  // docs: https://help.sap.com/doc/fc2f5477516c404c8bf9ad1315a17238/10.0/en-US/Working_with_SAP_Business_One_Service_Layer.pdf (Login and Logout)
  async #getSession(force) {
    if (this.session && !force) {
      return this.session
    }

    if (!this.baseUrl || !this.companyDB || !this.username || !this.password) {
      throw new Error('SAP Business One is not configured. Set the Service Layer Base URL, Company DB, Username, and Password in the service settings.')
    }

    const loginUrl = `${ this.baseUrl }${ SERVICE_LAYER_PATH }/Login`
    const body = { CompanyDB: this.companyDB, UserName: this.username, Password: this.password }

    logger.debug(`#getSession POST ${ loginUrl }`)

    const response = await Flowrunner.Request.post(loginUrl)
      .set({ 'Content-Type': 'application/json' })
      .unwrapBody(false)
      .send(body)

    const cookie = this.#extractCookies(response)

    this.session = { cookie, sessionId: response?.body?.SessionId || null }

    return this.session
  }

  #extractCookies(response) {
    const headers = response?.headers || {}
    const raw = headers['set-cookie'] || headers['Set-Cookie'] || []
    const cookieParts = (Array.isArray(raw) ? raw : [raw])
      .map(c => String(c).split(';')[0])
      .filter(Boolean)

    if (!cookieParts.length) {
      throw new Error('SAP Business One login did not return a session cookie. Check the Company DB, Username, and Password.')
    }

    return cookieParts.join('; ')
  }

  // Single factory for every Service Layer call. Attaches the session cookie and, on a 401
  // (expired session), logs in again once and retries.
  async #apiRequest({ entity, method, body, query, prefer, logTag, retried }) {
    method = method || 'get'

    try {
      const session = await this.#getSession()
      const url = this.#serviceLayerUrl(entity)

      logger.debug(`${ logTag } ${ method.toUpperCase() } ${ url }`)

      const headers = { 'Content-Type': 'application/json', Cookie: session.cookie }

      if (prefer) {
        headers.Prefer = prefer
      }

      const request = Flowrunner.Request[method](url).set(headers).query(query || {})

      if (body !== undefined && body !== null) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      if (this.#isAuthError(error) && !retried) {
        logger.warn(`${ logTag } session expired — re-authenticating`)
        await this.#getSession(true)

        return this.#apiRequest({ entity, method, body, query, prefer, logTag, retried: true })
      }

      this.#handleError(error, logTag)
    }
  }

  #isAuthError(error) {
    const status = error?.status || error?.code || error?.body?.error?.code

    return status === 401 || status === '401'
  }

  #handleError(error, logTag) {
    const status = error?.status || error?.code
    const apiMessage = error?.body?.error?.message?.value ||
      error?.body?.error?.message ||
      error?.body?.message ||
      error?.message ||
      'Request failed'

    logger.error(`${ logTag } failed: ${ apiMessage }`)

    if (status === 404) {
      throw new Error(`Not found — the record may not exist. Use the matching "Get …" or "List …" action to pick a valid one. (${ apiMessage })`)
    }

    throw new Error(apiMessage)
  }

  // ==========================================================================
  //  SHARED HELPERS
  // ==========================================================================
  // Maps a friendly dropdown label to its API value; passes through raw values and empties.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Builds an OData query object, dropping empty values. Service Layer expects raw $-keys.
  #odataQuery({ filter, select, orderby, top, skip, expand }) {
    const q = {}

    if (filter) q.$filter = filter
    if (select) q.$select = select
    if (orderby) q.$orderby = orderby
    if (top !== undefined && top !== null && top !== '') q.$top = top
    if (skip !== undefined && skip !== null && skip !== '') q.$skip = skip
    if (expand) q.$expand = expand

    return q
  }

  // Lists an entity set, following odata.nextLink (OData v3, no @ prefix) until absent.
  // Returns { value: [...all rows...], count }. Honors an optional maxResults cap.
  async #listAll({ entity, filter, select, orderby, maxResults, logTag }) {
    const query = this.#odataQuery({ filter, select, orderby })
    let all = []
    let pages = 0
    let current = await this.#apiRequest({ entity, method: 'get', query, logTag })

    while (current) {
      pages += 1
      const rows = (current && current.value) || []
      all = all.concat(rows)

      if (maxResults && all.length >= maxResults) {
        all = all.slice(0, maxResults)
        break
      }

      const next = current['odata.nextLink']

      if (!next) {
        break
      }

      // nextLink is like "/b1s/v1/Orders?$skip=20" or "Orders?$skip=20"; extract entity+query.
      const rel = String(next).replace(/^\/?b1s\/v1\//, '').replace(/^\//, '')
      current = await this.#apiRequest({ entity: rel, method: 'get', logTag })
    }

    return { value: all, count: all.length, pagesFollowed: pages }
  }

  // Shared dictionary search-filter builder for two text fields (contains on both).
  #searchFilter(search, fieldA, fieldB) {
    if (!search) return undefined
    const safe = String(search).replace(/'/g, "''")

    return `contains(${ fieldA },'${ safe }') or contains(${ fieldB },'${ safe }')`
  }

  // Generic document dictionary used by every docEntry picker.
  async #documentDictionary({ entity, payload }) {
    const { search, cursor } = payload || {}
    const filter = search ? `contains(CardCode,'${ String(search).replace(/'/g, "''") }')` : undefined
    const query = this.#odataQuery({ select: 'DocEntry,DocNum,CardCode', filter, top: 20, skip: cursor || undefined })
    const result = await this.#apiRequest({ entity, method: 'get', query, logTag: `dictionary:${ entity }` })
    const rows = (result && result.value) || []

    return {
      items: rows.map(d => ({
        label: `#${ d.DocNum } (${ d.CardCode })`,
        value: d.DocEntry,
        note: `DocEntry ${ d.DocEntry }`,
      })),
      cursor: this.#nextCursor(result, cursor),
    }
  }

  #nextCursor(result, cursor) {
    if (!result || !result['odata.nextLink']) return null
    const base = Number(cursor) || 0

    return base + 20
  }

  // Normalizes a DocumentLine array into the SAP body shape (drops empty fields).
  #mapDocumentLines(lines) {
    if (!Array.isArray(lines)) return []

    return lines.map(line => {
      const l = {}

      if (line.ItemCode !== undefined) l.ItemCode = line.ItemCode
      if (line.Quantity !== undefined && line.Quantity !== null && line.Quantity !== '') l.Quantity = line.Quantity
      if (line.UnitPrice !== undefined && line.UnitPrice !== null && line.UnitPrice !== '') l.UnitPrice = line.UnitPrice
      if (line.TaxCode !== undefined && line.TaxCode !== null && line.TaxCode !== '') l.TaxCode = line.TaxCode
      if (line.WarehouseCode !== undefined && line.WarehouseCode !== null && line.WarehouseCode !== '') l.WarehouseCode = line.WarehouseCode
      if (line.DiscountPercent !== undefined && line.DiscountPercent !== null && line.DiscountPercent !== '') l.DiscountPercent = line.DiscountPercent

      return l
    })
  }

  // Creates a sales/purchase document. Body = header fields + DocumentLines[].
  async #createDocument({ entity, cardCode, documentLines, docDate, docDueDate, comments, logTag }) {
    if (!cardCode) throw new Error('Customer/Vendor (CardCode) is required.')
    if (!Array.isArray(documentLines) || !documentLines.length) throw new Error('At least one line item is required (each needs an Item and Quantity).')

    const body = { CardCode: cardCode, DocumentLines: this.#mapDocumentLines(documentLines) }

    if (docDate) body.DocDate = docDate
    if (docDueDate) body.DocDueDate = docDueDate
    if (comments) body.Comments = comments

    return await this.#apiRequest({ entity, method: 'post', body, logTag })
  }

  // Reads a document by its integer DocEntry key (no quotes around the key).
  async #getDocument({ entity, docEntry, logTag }) {
    if (docEntry === undefined || docEntry === null || docEntry === '') throw new Error('Document number (DocEntry) is required.')

    return await this.#apiRequest({ entity: `${ entity }(${ Number(docEntry) })`, method: 'get', logTag })
  }

  // List documents, optionally filtered by customer/vendor and document status.
  async #listDocuments({ entity, cardCode, status, maxResults, logTag }) {
    const clauses = []

    const documentStatus = this.#resolveChoice(status, DOCUMENT_STATUS_LABELS)

    if (cardCode) clauses.push(`CardCode eq '${ String(cardCode).replace(/'/g, "''") }'`)
    if (documentStatus) clauses.push(`DocumentStatus eq '${ documentStatus }'`)

    return await this.#listAll({
      entity,
      filter: clauses.length ? clauses.join(' and ') : undefined,
      maxResults,
      logTag,
    })
  }

  // PATCH update - only the fields passed are changed; unspecified fields keep their values.
  async #updateDocument({ entity, docEntry, fields, logTag }) {
    if (docEntry === undefined || docEntry === null || docEntry === '') throw new Error('Document number (DocEntry) is required.')

    await this.#apiRequest({ entity: `${ entity }(${ Number(docEntry) })`, method: 'patch', body: fields, logTag })

    return { DocEntry: Number(docEntry), updated: true }
  }

  // Bound action (Close / Cancel) - POST /<EntitySet>(<key>)/<Action>, no body.
  async #documentAction({ entity, docEntry, action, resultKey, logTag }) {
    if (docEntry === undefined || docEntry === null || docEntry === '') throw new Error('Document number (DocEntry) is required.')

    await this.#apiRequest({ entity: `${ entity }(${ Number(docEntry) })/${ action }`, method: 'post', logTag })

    return { DocEntry: Number(docEntry), [resultKey]: true }
  }

  // ==========================================================================
  //  DICTIONARIES - resource pickers
  // ==========================================================================
  /**
   * @registerAs DICTIONARY
   * @operationName Get Business Partners Dictionary
   * @description Searchable list of business partners (customers, vendors, leads) for dropdown selection.
   * @route POST /get-business-partners-dictionary
   * @paramDef {"type":"getBusinessPartnersDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and optional partner-type criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Customer c1 (c1)","value":"c1","note":"Customer"}],"cursor":null}
   */
  async getBusinessPartnersDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const clauses = []

    if (criteria?.cardType) {
      clauses.push(`CardType eq '${ criteria.cardType }'`)
    }

    const text = this.#searchFilter(search, 'CardName', 'CardCode')

    if (text) {
      clauses.push(`(${ text })`)
    }

    const query = this.#odataQuery({
      select: 'CardCode,CardName,CardType',
      filter: clauses.length ? clauses.join(' and ') : undefined,
      top: 20,
      skip: cursor || undefined,
    })
    const result = await this.#apiRequest({ entity: 'BusinessPartners', method: 'get', query, logTag: 'getBusinessPartnersDictionary' })
    const rows = (result && result.value) || []
    const typeLabel = { cCustomer: 'Customer', cSupplier: 'Vendor / Supplier', cLead: 'Lead' }

    return {
      items: rows.map(bp => ({
        label: `${ bp.CardName } (${ bp.CardCode })`,
        value: bp.CardCode,
        note: typeLabel[bp.CardType] || bp.CardType || '',
      })),
      cursor: this.#nextCursor(result, cursor),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Items Dictionary
   * @description Searchable list of inventory/sales/purchase items for dropdown selection.
   * @route POST /get-items-dictionary
   * @paramDef {"type":"getItemsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Widget (i1)","value":"i1","note":"ID: i1"}],"cursor":null}
   */
  async getItemsDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = this.#odataQuery({
      select: 'ItemCode,ItemName',
      filter: this.#searchFilter(search, 'ItemName', 'ItemCode'),
      top: 20,
      skip: cursor || undefined,
    })
    const result = await this.#apiRequest({ entity: 'Items', method: 'get', query, logTag: 'getItemsDictionary' })
    const rows = (result && result.value) || []

    return {
      items: rows.map(it => ({ label: `${ it.ItemName } (${ it.ItemCode })`, value: it.ItemCode, note: `ID: ${ it.ItemCode }` })),
      cursor: this.#nextCursor(result, cursor),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Warehouses Dictionary
   * @description Searchable list of warehouses for dropdown selection.
   * @route POST /get-warehouses-dictionary
   * @paramDef {"type":"getWarehousesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"General Warehouse (01)","value":"01","note":"Warehouse 01"}],"cursor":null}
   */
  async getWarehousesDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = this.#odataQuery({
      select: 'WarehouseCode,WarehouseName',
      filter: this.#searchFilter(search, 'WarehouseName', 'WarehouseCode'),
      top: 20,
      skip: cursor || undefined,
    })
    const result = await this.#apiRequest({ entity: 'Warehouses', method: 'get', query, logTag: 'getWarehousesDictionary' })
    const rows = (result && result.value) || []

    return {
      items: rows.map(w => ({ label: `${ w.WarehouseName } (${ w.WarehouseCode })`, value: w.WarehouseCode, note: `Warehouse ${ w.WarehouseCode }` })),
      cursor: this.#nextCursor(result, cursor),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Price Lists Dictionary
   * @description Searchable list of price lists for dropdown selection.
   * @route POST /get-price-lists-dictionary
   * @paramDef {"type":"getPriceListsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Base Price","value":"1","note":"List #1"}],"cursor":null}
   */
  async getPriceListsDictionary(payload) {
    const { search, cursor } = payload || {}
    const safe = search ? String(search).replace(/'/g, "''") : null
    const query = this.#odataQuery({
      select: 'PriceListNo,PriceListName',
      filter: safe ? `contains(PriceListName,'${ safe }')` : undefined,
      top: 20,
      skip: cursor || undefined,
    })
    const result = await this.#apiRequest({ entity: 'PriceLists', method: 'get', query, logTag: 'getPriceListsDictionary' })
    const rows = (result && result.value) || []

    return {
      items: rows.map(p => ({ label: `${ p.PriceListName }`, value: String(p.PriceListNo), note: `List #${ p.PriceListNo }` })),
      cursor: this.#nextCursor(result, cursor),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Accounts Dictionary
   * @description Searchable list of G/L accounts (chart of accounts) for dropdown selection.
   * @route POST /get-chart-of-accounts-dictionary
   * @paramDef {"type":"getChartOfAccountsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Sales Revenue (40000)","value":"40000","note":"Account 40000"}],"cursor":null}
   */
  async getChartOfAccountsDictionary(payload) {
    const { search, cursor } = payload || {}
    const safe = search ? String(search).replace(/'/g, "''") : null
    const query = this.#odataQuery({
      select: 'Code,Name',
      filter: safe ? `contains(Name,'${ safe }')` : undefined,
      top: 20,
      skip: cursor || undefined,
    })
    const result = await this.#apiRequest({ entity: 'ChartOfAccounts', method: 'get', query, logTag: 'getChartOfAccountsDictionary' })
    const rows = (result && result.value) || []

    return {
      items: rows.map(a => ({ label: `${ a.Name } (${ a.Code })`, value: a.Code, note: `Account ${ a.Code }` })),
      cursor: this.#nextCursor(result, cursor),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Orders Dictionary
   * @description Searchable list of sales orders (by customer code) for dropdown selection.
   * @route POST /get-orders-dictionary
   * @paramDef {"type":"getDocumentDictionary__payload","label":"Payload","name":"payload","description":"Search text (customer code) and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"#11 (c1)","value":22,"note":"DocEntry 22"}],"cursor":null}
   */
  async getOrdersDictionary(payload) {
    return this.#documentDictionary({ entity: 'Orders', payload })
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Quotations Dictionary
   * @description Searchable list of sales quotations for dropdown selection.
   * @route POST /get-quotations-dictionary
   * @paramDef {"type":"getDocumentDictionary__payload","label":"Payload","name":"payload","description":"Search text (customer code) and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"#7 (c1)","value":12,"note":"DocEntry 12"}],"cursor":null}
   */
  async getQuotationsDictionary(payload) {
    return this.#documentDictionary({ entity: 'Quotations', payload })
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Delivery Notes Dictionary
   * @description Searchable list of delivery notes for dropdown selection.
   * @route POST /get-delivery-notes-dictionary
   * @paramDef {"type":"getDocumentDictionary__payload","label":"Payload","name":"payload","description":"Search text (customer code) and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"#9 (c1)","value":18,"note":"DocEntry 18"}],"cursor":null}
   */
  async getDeliveryNotesDictionary(payload) {
    return this.#documentDictionary({ entity: 'DeliveryNotes', payload })
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Invoices Dictionary
   * @description Searchable list of A/R invoices for dropdown selection.
   * @route POST /get-invoices-dictionary
   * @paramDef {"type":"getDocumentDictionary__payload","label":"Payload","name":"payload","description":"Search text (customer code) and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"#3 (c1)","value":5,"note":"DocEntry 5"}],"cursor":null}
   */
  async getInvoicesDictionary(payload) {
    return this.#documentDictionary({ entity: 'Invoices', payload })
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Credit Notes Dictionary
   * @description Searchable list of A/R credit memos for dropdown selection.
   * @route POST /get-credit-notes-dictionary
   * @paramDef {"type":"getDocumentDictionary__payload","label":"Payload","name":"payload","description":"Search text (customer code) and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"#2 (c1)","value":4,"note":"DocEntry 4"}],"cursor":null}
   */
  async getCreditNotesDictionary(payload) {
    return this.#documentDictionary({ entity: 'CreditNotes', payload })
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Returns Dictionary
   * @description Searchable list of sales returns for dropdown selection.
   * @route POST /get-returns-dictionary
   * @paramDef {"type":"getDocumentDictionary__payload","label":"Payload","name":"payload","description":"Search text (customer code) and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"#1 (c1)","value":3,"note":"DocEntry 3"}],"cursor":null}
   */
  async getReturnsDictionary(payload) {
    return this.#documentDictionary({ entity: 'Returns', payload })
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Purchase Orders Dictionary
   * @description Searchable list of purchase orders for dropdown selection.
   * @route POST /get-purchase-orders-dictionary
   * @paramDef {"type":"getDocumentDictionary__payload","label":"Payload","name":"payload","description":"Search text (vendor code) and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"#15 (v1)","value":31,"note":"DocEntry 31"}],"cursor":null}
   */
  async getPurchaseOrdersDictionary(payload) {
    return this.#documentDictionary({ entity: 'PurchaseOrders', payload })
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Purchase Quotations Dictionary
   * @description Searchable list of purchase quotations for dropdown selection.
   * @route POST /get-purchase-quotations-dictionary
   * @paramDef {"type":"getDocumentDictionary__payload","label":"Payload","name":"payload","description":"Search text (vendor code) and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"#5 (v1)","value":21,"note":"DocEntry 21"}],"cursor":null}
   */
  async getPurchaseQuotationsDictionary(payload) {
    return this.#documentDictionary({ entity: 'PurchaseQuotations', payload })
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Goods Receipt POs Dictionary
   * @description Searchable list of goods receipt POs (purchase delivery notes) for dropdown selection.
   * @route POST /get-purchase-delivery-notes-dictionary
   * @paramDef {"type":"getDocumentDictionary__payload","label":"Payload","name":"payload","description":"Search text (vendor code) and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"#8 (v1)","value":24,"note":"DocEntry 24"}],"cursor":null}
   */
  async getPurchaseDeliveryNotesDictionary(payload) {
    return this.#documentDictionary({ entity: 'PurchaseDeliveryNotes', payload })
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Purchase Invoices Dictionary
   * @description Searchable list of A/P invoices (purchase invoices) for dropdown selection.
   * @route POST /get-purchase-invoices-dictionary
   * @paramDef {"type":"getDocumentDictionary__payload","label":"Payload","name":"payload","description":"Search text (vendor code) and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"#4 (v1)","value":14,"note":"DocEntry 14"}],"cursor":null}
   */
  async getPurchaseInvoicesDictionary(payload) {
    return this.#documentDictionary({ entity: 'PurchaseInvoices', payload })
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Purchase Credit Notes Dictionary
   * @description Searchable list of A/P credit memos (purchase credit notes) for dropdown selection.
   * @route POST /get-purchase-credit-notes-dictionary
   * @paramDef {"type":"getDocumentDictionary__payload","label":"Payload","name":"payload","description":"Search text (vendor code) and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"#2 (v1)","value":9,"note":"DocEntry 9"}],"cursor":null}
   */
  async getPurchaseCreditNotesDictionary(payload) {
    return this.#documentDictionary({ entity: 'PurchaseCreditNotes', payload })
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Incoming Payments Dictionary
   * @description Searchable list of incoming (customer) payments for dropdown selection.
   * @route POST /get-incoming-payments-dictionary
   * @paramDef {"type":"getDocumentDictionary__payload","label":"Payload","name":"payload","description":"Search text (customer code) and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"#3 (c1)","value":5,"note":"DocEntry 5"}],"cursor":null}
   */
  async getIncomingPaymentsDictionary(payload) {
    return this.#documentDictionary({ entity: 'IncomingPayments', payload })
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Outgoing Payments Dictionary
   * @description Searchable list of outgoing (vendor) payments for dropdown selection.
   * @route POST /get-vendor-payments-dictionary
   * @paramDef {"type":"getDocumentDictionary__payload","label":"Payload","name":"payload","description":"Search text (vendor code) and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"#2 (v1)","value":7,"note":"DocEntry 7"}],"cursor":null}
   */
  async getVendorPaymentsDictionary(payload) {
    return this.#documentDictionary({ entity: 'VendorPayments', payload })
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Stock Transfers Dictionary
   * @description Searchable list of stock transfers for dropdown selection.
   * @route POST /get-stock-transfers-dictionary
   * @paramDef {"type":"getDocumentDictionary__payload","label":"Payload","name":"payload","description":"Search text (card code) and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"#6 ()","value":16,"note":"DocEntry 16"}],"cursor":null}
   */
  async getStockTransfersDictionary(payload) {
    return this.#documentDictionary({ entity: 'StockTransfers', payload })
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Activities Dictionary
   * @description Searchable list of CRM activities for dropdown selection.
   * @route POST /get-activities-dictionary
   * @paramDef {"type":"getDocumentDictionary__payload","label":"Payload","name":"payload","description":"Search text (card code) and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Activity 1 (c1)","value":1,"note":"ActivityCode 1"}],"cursor":null}
   */
  async getActivitiesDictionary(payload) {
    const { search, cursor } = payload || {}
    const filter = search ? `contains(CardCode,'${ String(search).replace(/'/g, "''") }')` : undefined
    const query = this.#odataQuery({ select: 'ActivityCode,CardCode', filter, top: 20, skip: cursor || undefined })
    const result = await this.#apiRequest({ entity: 'Activities', method: 'get', query, logTag: 'getActivitiesDictionary' })
    const rows = (result && result.value) || []

    return {
      items: rows.map(a => ({ label: `Activity ${ a.ActivityCode } (${ a.CardCode })`, value: a.ActivityCode, note: `ActivityCode ${ a.ActivityCode }` })),
      cursor: this.#nextCursor(result, cursor),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Journal Entries Dictionary
   * @description Searchable list of journal entries for dropdown selection.
   * @route POST /get-journal-entries-dictionary
   * @paramDef {"type":"getDocumentDictionary__payload","label":"Payload","name":"payload","description":"Search text (memo) and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"JE #101","value":101,"note":"JdtNum 101"}],"cursor":null}
   */
  async getJournalEntriesDictionary(payload) {
    const { search, cursor } = payload || {}
    const filter = search ? `contains(Memo,'${ String(search).replace(/'/g, "''") }')` : undefined
    const query = this.#odataQuery({ select: 'JdtNum,Memo', filter, top: 20, skip: cursor || undefined })
    const result = await this.#apiRequest({ entity: 'JournalEntries', method: 'get', query, logTag: 'getJournalEntriesDictionary' })
    const rows = (result && result.value) || []

    return {
      items: rows.map(j => ({ label: `JE #${ j.JdtNum }`, value: j.JdtNum, note: `JdtNum ${ j.JdtNum }` })),
      cursor: this.#nextCursor(result, cursor),
    }
  }

  // ==========================================================================
  //  BUSINESS PARTNERS
  // ==========================================================================
  /**
   * @operationName Create Business Partner
   * @category Business Partners
   * @description Create a customer, vendor/supplier, or lead in SAP Business One. Use this to add a new trading partner before raising a sales or purchasing document for them.
   * @route POST /create-business-partner
   * @paramDef {"type":"String","label":"Name","name":"cardName","required":true,"description":"Display name of the business partner (the company or person)."}
   * @paramDef {"type":"String","label":"Type","name":"cardType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Customer","Vendor / Supplier","Lead"]}},"description":"Whether this partner is a Customer, Vendor, or Lead."}
   * @paramDef {"type":"String","label":"Code","name":"cardCode","description":"Optional unique code. Leave blank if your company uses automatic BP numbering."}
   * @paramDef {"type":"Number","label":"Group Code","name":"groupCode","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric BP group from your SAP setup (e.g. 100)."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Primary phone number (maps to Phone1)."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Primary email (maps to EmailAddress)."}
   * @returns {Object}
   * @sampleResult {"CardCode":"c1","CardName":"customer c1","CardType":"cCustomer","GroupCode":100}
   */
  async createBusinessPartner(cardName, cardType, cardCode, groupCode, phone, email) {
    if (!cardName) throw new Error('Name is required to create a business partner.')

    const body = { CardName: cardName, CardType: this.#resolveChoice(cardType, CARD_TYPE_LABELS) }

    if (cardCode) body.CardCode = cardCode
    if (groupCode !== undefined && groupCode !== null && groupCode !== '') body.GroupCode = groupCode
    if (phone) body.Phone1 = phone
    if (email) body.EmailAddress = email

    return await this.#apiRequest({ entity: 'BusinessPartners', method: 'post', body, logTag: 'createBusinessPartner' })
  }

  /**
   * @operationName Get Business Partner
   * @category Business Partners
   * @description Retrieve one business partner by its code, including contact and address details.
   * @route POST /get-business-partner
   * @paramDef {"type":"String","label":"Business Partner","name":"cardCode","required":true,"dictionary":"getBusinessPartnersDictionary","description":"The BP code to fetch."}
   * @returns {Object}
   * @sampleResult {"CardCode":"c1","CardName":"customer c1","CardType":"cCustomer","GroupCode":100}
   */
  async getBusinessPartner(cardCode) {
    if (!cardCode) throw new Error('Business Partner code is required.')

    return await this.#apiRequest({ entity: `BusinessPartners('${ encodeURIComponent(cardCode) }')`, method: 'get', logTag: 'getBusinessPartner' })
  }

  /**
   * @operationName List Business Partners
   * @category Business Partners
   * @description List or search business partners, optionally filtered by type (Customer/Vendor/Lead). Returns all matching rows by following pagination automatically.
   * @route POST /list-business-partners
   * @paramDef {"type":"String","label":"Type","name":"cardType","uiComponent":{"type":"DROPDOWN","options":{"values":["Customer","Vendor / Supplier","Lead"]}},"description":"Limit to a partner type. Leave blank for all."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text matched against name and code."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Cap the number of rows. Leave blank to return all."}
   * @returns {Object}
   * @sampleResult {"value":[{"CardCode":"c1","CardName":"customer c1","CardType":"cCustomer"}],"count":1}
   */
  async listBusinessPartners(cardType, search, maxResults) {
    const clauses = []
    const type = this.#resolveChoice(cardType, CARD_TYPE_LABELS)

    if (type) clauses.push(`CardType eq '${ type }'`)

    const text = this.#searchFilter(search, 'CardName', 'CardCode')

    if (text) clauses.push(`(${ text })`)

    return await this.#listAll({
      entity: 'BusinessPartners',
      filter: clauses.length ? clauses.join(' and ') : undefined,
      maxResults,
      logTag: 'listBusinessPartners',
    })
  }

  /**
   * @operationName Update Business Partner
   * @category Business Partners
   * @description Update fields on an existing business partner. Only the fields you supply change (PATCH semantics).
   * @route POST /update-business-partner
   * @paramDef {"type":"String","label":"Business Partner","name":"cardCode","required":true,"dictionary":"getBusinessPartnersDictionary","description":"The BP to update."}
   * @paramDef {"type":"String","label":"Name","name":"cardName","description":"New display name."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"New phone (Phone1)."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New email (EmailAddress)."}
   * @returns {Object}
   * @sampleResult {"CardCode":"c1","updated":true}
   */
  async updateBusinessPartner(cardCode, cardName, phone, email) {
    if (!cardCode) throw new Error('Business Partner code is required.')

    const body = {}

    if (cardName) body.CardName = cardName
    if (phone) body.Phone1 = phone
    if (email) body.EmailAddress = email

    await this.#apiRequest({ entity: `BusinessPartners('${ encodeURIComponent(cardCode) }')`, method: 'patch', body, logTag: 'updateBusinessPartner' })

    return { CardCode: cardCode, updated: true }
  }

  /**
   * @operationName Delete Business Partner
   * @category Business Partners
   * @description Delete a business partner. Fails if the partner has posted transactions (SAP returns -5006).
   * @route POST /delete-business-partner
   * @paramDef {"type":"String","label":"Business Partner","name":"cardCode","required":true,"dictionary":"getBusinessPartnersDictionary","description":"The BP to delete."}
   * @returns {Object}
   * @sampleResult {"CardCode":"c1","deleted":true}
   */
  async deleteBusinessPartner(cardCode) {
    if (!cardCode) throw new Error('Business Partner code is required.')

    await this.#apiRequest({ entity: `BusinessPartners('${ encodeURIComponent(cardCode) }')`, method: 'delete', logTag: 'deleteBusinessPartner' })

    return { CardCode: cardCode, deleted: true }
  }

  // ==========================================================================
  //  CONTACTS (ContactEmployees on a Business Partner)
  // ==========================================================================
  /**
   * @operationName Create Contact
   * @category Business Partners
   * @description Add a contact person to a business partner. Contacts are managed as the partner's ContactEmployees collection, so this patches the partner with a new contact.
   * @route POST /create-contact
   * @paramDef {"type":"String","label":"Business Partner","name":"cardCode","required":true,"dictionary":"getBusinessPartnersDictionary","description":"Partner the contact belongs to."}
   * @paramDef {"type":"String","label":"Contact Name","name":"name","required":true,"description":"Internal name/key of the contact person."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"Contact first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Contact last name."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Contact phone number."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Contact email address (E_Mail)."}
   * @returns {Object}
   * @sampleResult {"CardCode":"c1","contactAdded":"Jane Doe"}
   */
  async createContact(cardCode, name, firstName, lastName, phone, email) {
    if (!cardCode) throw new Error('Business Partner code is required.')
    if (!name) throw new Error('Contact Name is required.')

    // Contacts have no top-level endpoint - they live as ContactEmployees, a child collection
    // PATCHed onto the parent business partner.
    const contact = { Name: name }

    if (firstName) contact.FirstName = firstName
    if (lastName) contact.LastName = lastName
    if (phone) contact.Phone1 = phone
    if (email) contact.E_Mail = email

    await this.#apiRequest({
      entity: `BusinessPartners('${ encodeURIComponent(cardCode) }')`,
      method: 'patch',
      body: { ContactEmployees: [contact] },
      logTag: 'createContact',
    })

    return { CardCode: cardCode, contactAdded: name }
  }

  /**
   * @operationName Get Contacts
   * @category Business Partners
   * @description Retrieve the contact persons (ContactEmployees) of a business partner.
   * @route POST /get-contacts
   * @paramDef {"type":"String","label":"Business Partner","name":"cardCode","required":true,"dictionary":"getBusinessPartnersDictionary","description":"Partner whose contacts to fetch."}
   * @returns {Object}
   * @sampleResult {"CardCode":"c1","ContactEmployees":[{"InternalCode":1,"Name":"Jane Doe","E_Mail":"jane@acme.com"}]}
   */
  async getContacts(cardCode) {
    if (!cardCode) throw new Error('Business Partner code is required.')

    return await this.#apiRequest({
      entity: `BusinessPartners('${ encodeURIComponent(cardCode) }')`,
      method: 'get',
      query: { $select: 'CardCode,ContactEmployees' },
      logTag: 'getContacts',
    })
  }

  /**
   * @operationName List Contacts
   * @category Business Partners
   * @description List business partners together with their contact persons. Follows pagination to return all rows.
   * @route POST /list-contacts
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text matched against partner name and code."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Cap rows; blank returns all."}
   * @returns {Object}
   * @sampleResult {"value":[{"CardCode":"c1","ContactEmployees":[{"Name":"Jane Doe"}]}],"count":1}
   */
  async listContacts(search, maxResults) {
    return await this.#listAll({
      entity: 'BusinessPartners',
      select: 'CardCode,CardName,ContactEmployees',
      filter: this.#searchFilter(search, 'CardName', 'CardCode'),
      maxResults,
      logTag: 'listContacts',
    })
  }

  /**
   * @operationName Update Contact
   * @category Business Partners
   * @description Update a contact person on a business partner by its internal code (PATCH of the ContactEmployees collection).
   * @route POST /update-contact
   * @paramDef {"type":"String","label":"Business Partner","name":"cardCode","required":true,"dictionary":"getBusinessPartnersDictionary","description":"Partner the contact belongs to."}
   * @paramDef {"type":"Number","label":"Contact Internal Code","name":"internalCode","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"InternalCode of the contact (see Get Contacts)."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"New phone number."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New email (E_Mail)."}
   * @returns {Object}
   * @sampleResult {"CardCode":"c1","internalCode":1,"updated":true}
   */
  async updateContact(cardCode, internalCode, phone, email) {
    if (!cardCode) throw new Error('Business Partner code is required.')
    if (internalCode === undefined || internalCode === null) throw new Error('Contact Internal Code is required.')

    // Update by PATCHing the partner with the matching ContactEmployees element (keyed by InternalCode).
    const contact = { InternalCode: internalCode }

    if (phone) contact.Phone1 = phone
    if (email) contact.E_Mail = email

    await this.#apiRequest({
      entity: `BusinessPartners('${ encodeURIComponent(cardCode) }')`,
      method: 'patch',
      body: { ContactEmployees: [contact] },
      logTag: 'updateContact',
    })

    return { CardCode: cardCode, internalCode, updated: true }
  }
  // NOTE: There is no DELETE on the ContactEmployees sub-collection in the Service Layer.
  // Contacts are managed through the parent BusinessPartner (see Add/Update Contact, both of
  // which PATCH the partner's ContactEmployees collection).

  // ==========================================================================
  //  ITEMS & INVENTORY
  // ==========================================================================
  /**
   * @operationName Create Item
   * @category Items & Inventory
   * @description Create an inventory/sales/purchase item (product) master record. Use before adding the item to documents.
   * @route POST /create-item
   * @paramDef {"type":"String","label":"Item Code","name":"itemCode","required":true,"description":"Unique item code."}
   * @paramDef {"type":"String","label":"Item Name","name":"itemName","required":true,"description":"Display name of the item."}
   * @paramDef {"type":"Number","label":"Item Group","name":"itemsGroupCode","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric item group from your SAP setup."}
   * @paramDef {"type":"Boolean","label":"Track Inventory","name":"inventoryItem","uiComponent":{"type":"TOGGLE"},"description":"Maintain stock for this item."}
   * @paramDef {"type":"Boolean","label":"Sales Item","name":"salesItem","uiComponent":{"type":"TOGGLE"},"description":"Item can be sold."}
   * @paramDef {"type":"Boolean","label":"Purchase Item","name":"purchaseItem","uiComponent":{"type":"TOGGLE"},"description":"Item can be purchased."}
   * @returns {Object}
   * @sampleResult {"ItemCode":"i011","ItemName":"Widget","InventoryItem":"tYES"}
   */
  async createItem(itemCode, itemName, itemsGroupCode, inventoryItem, salesItem, purchaseItem) {
    if (!itemCode) throw new Error('Item Code is required.')
    if (!itemName) throw new Error('Item Name is required.')

    const yn = v => (v ? 'tYES' : 'tNO')
    const body = { ItemCode: itemCode, ItemName: itemName }

    if (itemsGroupCode !== undefined && itemsGroupCode !== null && itemsGroupCode !== '') body.ItemsGroupCode = itemsGroupCode
    if (inventoryItem !== undefined && inventoryItem !== null) body.InventoryItem = yn(inventoryItem)
    if (salesItem !== undefined && salesItem !== null) body.SalesItem = yn(salesItem)
    if (purchaseItem !== undefined && purchaseItem !== null) body.PurchaseItem = yn(purchaseItem)

    return await this.#apiRequest({ entity: 'Items', method: 'post', body, logTag: 'createItem' })
  }

  /**
   * @operationName Get Item
   * @category Items & Inventory
   * @description Retrieve one item including price and per-warehouse stock (ItemWarehouseInfoCollection).
   * @route POST /get-item
   * @paramDef {"type":"String","label":"Item","name":"itemCode","required":true,"dictionary":"getItemsDictionary","description":"Item to fetch."}
   * @returns {Object}
   * @sampleResult {"ItemCode":"i1","ItemName":"Widget","ItemWarehouseInfoCollection":[{"WarehouseCode":"01","InStock":42}]}
   */
  async getItem(itemCode) {
    if (!itemCode) throw new Error('Item Code is required.')

    return await this.#apiRequest({ entity: `Items('${ encodeURIComponent(itemCode) }')`, method: 'get', logTag: 'getItem' })
  }

  /**
   * @operationName List Items
   * @category Items & Inventory
   * @description List or search items. Follows pagination to return all matches.
   * @route POST /list-items
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Match on item name or code."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Cap rows; blank returns all."}
   * @returns {Object}
   * @sampleResult {"value":[{"ItemCode":"i1","ItemName":"Widget"}],"count":1}
   */
  async listItems(search, maxResults) {
    return await this.#listAll({
      entity: 'Items',
      filter: this.#searchFilter(search, 'ItemName', 'ItemCode'),
      maxResults,
      logTag: 'listItems',
    })
  }

  /**
   * @operationName Update Item
   * @category Items & Inventory
   * @description Update fields on an existing item (PATCH; only supplied fields change).
   * @route POST /update-item
   * @paramDef {"type":"String","label":"Item","name":"itemCode","required":true,"dictionary":"getItemsDictionary","description":"Item to update."}
   * @paramDef {"type":"String","label":"Item Name","name":"itemName","description":"New name."}
   * @returns {Object}
   * @sampleResult {"ItemCode":"i1","updated":true}
   */
  async updateItem(itemCode, itemName) {
    if (!itemCode) throw new Error('Item Code is required.')

    const body = {}

    if (itemName) body.ItemName = itemName

    await this.#apiRequest({ entity: `Items('${ encodeURIComponent(itemCode) }')`, method: 'patch', body, logTag: 'updateItem' })

    return { ItemCode: itemCode, updated: true }
  }

  /**
   * @operationName Delete Item
   * @category Items & Inventory
   * @description Delete an item. Fails (-5006) if the item is used in transactions.
   * @route POST /delete-item
   * @paramDef {"type":"String","label":"Item","name":"itemCode","required":true,"dictionary":"getItemsDictionary","description":"Item to delete."}
   * @returns {Object}
   * @sampleResult {"ItemCode":"i1","deleted":true}
   */
  async deleteItem(itemCode) {
    if (!itemCode) throw new Error('Item Code is required.')

    await this.#apiRequest({ entity: `Items('${ encodeURIComponent(itemCode) }')`, method: 'delete', logTag: 'deleteItem' })

    return { ItemCode: itemCode, deleted: true }
  }

  /**
   * @operationName Create Warehouse
   * @category Items & Inventory
   * @description Create a warehouse (stock location).
   * @route POST /create-warehouse
   * @paramDef {"type":"String","label":"Warehouse Code","name":"warehouseCode","required":true,"description":"Unique warehouse code."}
   * @paramDef {"type":"String","label":"Warehouse Name","name":"warehouseName","required":true,"description":"Display name of the warehouse."}
   * @returns {Object}
   * @sampleResult {"WarehouseCode":"02","WarehouseName":"East Warehouse"}
   */
  async createWarehouse(warehouseCode, warehouseName) {
    if (!warehouseCode) throw new Error('Warehouse Code is required.')
    if (!warehouseName) throw new Error('Warehouse Name is required.')

    return await this.#apiRequest({ entity: 'Warehouses', method: 'post', body: { WarehouseCode: warehouseCode, WarehouseName: warehouseName }, logTag: 'createWarehouse' })
  }

  /**
   * @operationName Get Warehouse
   * @category Items & Inventory
   * @description Retrieve one warehouse by its code.
   * @route POST /get-warehouse
   * @paramDef {"type":"String","label":"Warehouse","name":"warehouseCode","required":true,"dictionary":"getWarehousesDictionary","description":"Warehouse to fetch."}
   * @returns {Object}
   * @sampleResult {"WarehouseCode":"01","WarehouseName":"General Warehouse"}
   */
  async getWarehouse(warehouseCode) {
    if (!warehouseCode) throw new Error('Warehouse Code is required.')

    return await this.#apiRequest({ entity: `Warehouses('${ encodeURIComponent(warehouseCode) }')`, method: 'get', logTag: 'getWarehouse' })
  }

  /**
   * @operationName List Warehouses
   * @category Items & Inventory
   * @description List or search warehouses. Follows pagination to return all rows.
   * @route POST /list-warehouses
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Match on warehouse name or code."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Cap rows; blank returns all."}
   * @returns {Object}
   * @sampleResult {"value":[{"WarehouseCode":"01","WarehouseName":"General Warehouse"}],"count":1}
   */
  async listWarehouses(search, maxResults) {
    return await this.#listAll({
      entity: 'Warehouses',
      filter: this.#searchFilter(search, 'WarehouseName', 'WarehouseCode'),
      maxResults,
      logTag: 'listWarehouses',
    })
  }

  /**
   * @operationName Update Warehouse
   * @category Items & Inventory
   * @description Update a warehouse's name (PATCH; only supplied fields change).
   * @route POST /update-warehouse
   * @paramDef {"type":"String","label":"Warehouse","name":"warehouseCode","required":true,"dictionary":"getWarehousesDictionary","description":"Warehouse to update."}
   * @paramDef {"type":"String","label":"Warehouse Name","name":"warehouseName","description":"New name."}
   * @returns {Object}
   * @sampleResult {"WarehouseCode":"01","updated":true}
   */
  async updateWarehouse(warehouseCode, warehouseName) {
    if (!warehouseCode) throw new Error('Warehouse Code is required.')

    const body = {}

    if (warehouseName) body.WarehouseName = warehouseName

    await this.#apiRequest({ entity: `Warehouses('${ encodeURIComponent(warehouseCode) }')`, method: 'patch', body, logTag: 'updateWarehouse' })

    return { WarehouseCode: warehouseCode, updated: true }
  }

  /**
   * @operationName Get Price List
   * @category Items & Inventory
   * @description Retrieve one price list by its number, including its item prices.
   * @route POST /get-price-list
   * @paramDef {"type":"String","label":"Price List","name":"priceListNo","required":true,"dictionary":"getPriceListsDictionary","description":"Price list to fetch."}
   * @returns {Object}
   * @sampleResult {"PriceListNo":1,"PriceListName":"Base Price"}
   */
  async getPriceList(priceListNo) {
    if (priceListNo === undefined || priceListNo === null || priceListNo === '') throw new Error('Price List number is required.')

    return await this.#apiRequest({ entity: `PriceLists(${ Number(priceListNo) })`, method: 'get', logTag: 'getPriceList' })
  }

  /**
   * @operationName List Price Lists
   * @category Items & Inventory
   * @description List all price lists. Follows pagination to return all rows.
   * @route POST /list-price-lists
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Cap rows; blank returns all."}
   * @returns {Object}
   * @sampleResult {"value":[{"PriceListNo":1,"PriceListName":"Base Price"}],"count":1}
   */
  async listPriceLists(maxResults) {
    return await this.#listAll({ entity: 'PriceLists', maxResults, logTag: 'listPriceLists' })
  }

  /**
   * @operationName Update Price List
   * @category Items & Inventory
   * @description Update a price list's name or factor (PATCH; only supplied fields change).
   * @route POST /update-price-list
   * @paramDef {"type":"String","label":"Price List","name":"priceListNo","required":true,"dictionary":"getPriceListsDictionary","description":"Price list to update."}
   * @paramDef {"type":"String","label":"Name","name":"priceListName","description":"New price list name."}
   * @paramDef {"type":"Number","label":"Factor","name":"factor","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New multiplier factor for the price list."}
   * @returns {Object}
   * @sampleResult {"PriceListNo":1,"updated":true}
   */
  async updatePriceList(priceListNo, priceListName, factor) {
    if (priceListNo === undefined || priceListNo === null || priceListNo === '') throw new Error('Price List number is required.')

    const body = {}

    if (priceListName) body.PriceListName = priceListName
    if (factor !== undefined && factor !== null && factor !== '') body.Factor = factor

    await this.#apiRequest({ entity: `PriceLists(${ Number(priceListNo) })`, method: 'patch', body, logTag: 'updatePriceList' })

    return { PriceListNo: Number(priceListNo), updated: true }
  }

  // ==========================================================================
  //  SALES - Quotations
  // ==========================================================================
  /**
   * @operationName Create Quotation
   * @category Sales
   * @description Create a sales quotation for a customer with line items. Use to send a price proposal before the customer commits to an order.
   * @route POST /create-quotation
   * @paramDef {"type":"String","label":"Customer","name":"cardCode","required":true,"dictionary":"getBusinessPartnersDictionary","description":"Customer the quotation is for."}
   * @paramDef {"type":"Array<DocumentLine>","label":"Line Items","name":"documentLines","required":true,"description":"Products on the quotation. Each line needs an Item and Quantity."}
   * @paramDef {"type":"String","label":"Document Date","name":"docDate","uiComponent":{"type":"DATE_PICKER"},"description":"Posting date (defaults to today)."}
   * @paramDef {"type":"String","label":"Valid Until","name":"docDueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Date the quote is valid until."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free-text remarks on the quotation."}
   * @returns {Object}
   * @sampleResult {"DocEntry":12,"DocNum":7,"CardCode":"c1","DocumentStatus":"bost_Open"}
   */
  async createQuotation(cardCode, documentLines, docDate, docDueDate, comments) {
    return await this.#createDocument({ entity: 'Quotations', cardCode, documentLines, docDate, docDueDate, comments, logTag: 'createQuotation' })
  }

  /**
   * @operationName Get Quotation
   * @category Sales
   * @description Retrieve a sales quotation by its internal DocEntry.
   * @route POST /get-quotation
   * @paramDef {"type":"Number","label":"Quotation","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getQuotationsDictionary","description":"Internal DocEntry of the quotation."}
   * @returns {Object}
   * @sampleResult {"DocEntry":12,"DocNum":7,"CardCode":"c1","DocumentStatus":"bost_Open"}
   */
  async getQuotation(docEntry) {
    return await this.#getDocument({ entity: 'Quotations', docEntry, logTag: 'getQuotation' })
  }

  /**
   * @operationName List Quotations
   * @category Sales
   * @description List or search sales quotations by customer and/or status. Follows pagination for all rows.
   * @route POST /list-quotations
   * @paramDef {"type":"String","label":"Customer","name":"cardCode","dictionary":"getBusinessPartnersDictionary","description":"Limit to one customer."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Closed"]}},"description":"Open or closed quotations."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Cap rows; blank returns all."}
   * @returns {Object}
   * @sampleResult {"value":[{"DocEntry":12,"DocNum":7,"CardCode":"c1"}],"count":1}
   */
  async listQuotations(cardCode, status, maxResults) {
    return await this.#listDocuments({ entity: 'Quotations', cardCode, status, maxResults, logTag: 'listQuotations' })
  }

  /**
   * @operationName Update Quotation
   * @category Sales
   * @description Update a sales quotation's header fields (PATCH).
   * @route POST /update-quotation
   * @paramDef {"type":"Number","label":"Quotation","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getQuotationsDictionary","description":"Quotation to update."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New remarks."}
   * @paramDef {"type":"String","label":"Valid Until","name":"docDueDate","uiComponent":{"type":"DATE_PICKER"},"description":"New valid-until date."}
   * @returns {Object}
   * @sampleResult {"DocEntry":12,"updated":true}
   */
  async updateQuotation(docEntry, comments, docDueDate) {
    const fields = {}

    if (comments) fields.Comments = comments
    if (docDueDate) fields.DocDueDate = docDueDate

    return await this.#updateDocument({ entity: 'Quotations', docEntry, fields, logTag: 'updateQuotation' })
  }

  /**
   * @operationName Close Quotation
   * @category Sales
   * @description Close a sales quotation (bound Close action) so it no longer appears as open.
   * @route POST /close-quotation
   * @paramDef {"type":"Number","label":"Quotation","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getQuotationsDictionary","description":"Quotation to close."}
   * @returns {Object}
   * @sampleResult {"DocEntry":12,"closed":true}
   */
  async closeQuotation(docEntry) {
    return await this.#documentAction({ entity: 'Quotations', docEntry, action: 'Close', resultKey: 'closed', logTag: 'closeQuotation' })
  }

  // ==========================================================================
  //  SALES - Orders
  // ==========================================================================
  /**
   * @operationName Create Order
   * @category Sales
   * @description Create a sales order for a customer with one or more line items. Use after the quotation stage to commit the sale; it feeds delivery and invoicing.
   * @route POST /create-order
   * @paramDef {"type":"String","label":"Customer","name":"cardCode","required":true,"dictionary":"getBusinessPartnersDictionary","description":"Customer the order is for."}
   * @paramDef {"type":"Array<DocumentLine>","label":"Line Items","name":"documentLines","required":true,"description":"Products on the order. Each line needs an Item and Quantity."}
   * @paramDef {"type":"String","label":"Document Date","name":"docDate","uiComponent":{"type":"DATE_PICKER"},"description":"Posting date (defaults to today)."}
   * @paramDef {"type":"String","label":"Delivery / Due Date","name":"docDueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Required delivery date."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free-text remarks on the order."}
   * @returns {Object}
   * @sampleResult {"DocEntry":22,"DocNum":11,"DocType":"dDocument_Items","CardCode":"c1","DocumentStatus":"bost_Open","DocTotal":1960}
   */
  async createOrder(cardCode, documentLines, docDate, docDueDate, comments) {
    return await this.#createDocument({ entity: 'Orders', cardCode, documentLines, docDate, docDueDate, comments, logTag: 'createOrder' })
  }

  /**
   * @operationName Get Order
   * @category Sales
   * @description Retrieve a sales order by its internal DocEntry.
   * @route POST /get-order
   * @paramDef {"type":"Number","label":"Order","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getOrdersDictionary","description":"Internal DocEntry of the order."}
   * @returns {Object}
   * @sampleResult {"DocEntry":22,"DocNum":11,"CardCode":"c1","DocumentStatus":"bost_Open"}
   */
  async getOrder(docEntry) {
    return await this.#getDocument({ entity: 'Orders', docEntry, logTag: 'getOrder' })
  }

  /**
   * @operationName List Orders
   * @category Sales
   * @description List or search sales orders. Filter by customer and/or status; follows pagination for all rows.
   * @route POST /list-orders
   * @paramDef {"type":"String","label":"Customer","name":"cardCode","dictionary":"getBusinessPartnersDictionary","description":"Limit to one customer."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Closed"]}},"description":"Open or closed orders."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Cap rows; blank returns all."}
   * @returns {Object}
   * @sampleResult {"value":[{"DocEntry":22,"DocNum":11,"CardCode":"c1"}],"count":1}
   */
  async listOrders(cardCode, status, maxResults) {
    return await this.#listDocuments({ entity: 'Orders', cardCode, status, maxResults, logTag: 'listOrders' })
  }

  /**
   * @operationName Update Order
   * @category Sales
   * @description Update a sales order's header fields (PATCH; only supplied fields change).
   * @route POST /update-order
   * @paramDef {"type":"Number","label":"Order","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getOrdersDictionary","description":"Order to update."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New remarks."}
   * @paramDef {"type":"String","label":"Due Date","name":"docDueDate","uiComponent":{"type":"DATE_PICKER"},"description":"New due date."}
   * @returns {Object}
   * @sampleResult {"DocEntry":22,"updated":true}
   */
  async updateOrder(docEntry, comments, docDueDate) {
    const fields = {}

    if (comments) fields.Comments = comments
    if (docDueDate) fields.DocDueDate = docDueDate

    return await this.#updateDocument({ entity: 'Orders', docEntry, fields, logTag: 'updateOrder' })
  }

  /**
   * @operationName Close Order
   * @category Sales
   * @description Close a sales order (bound Close action) so it no longer appears as open.
   * @route POST /close-order
   * @paramDef {"type":"Number","label":"Order","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getOrdersDictionary","description":"Order to close."}
   * @returns {Object}
   * @sampleResult {"DocEntry":22,"closed":true}
   */
  async closeOrder(docEntry) {
    return await this.#documentAction({ entity: 'Orders', docEntry, action: 'Close', resultKey: 'closed', logTag: 'closeOrder' })
  }

  /**
   * @operationName Cancel Order
   * @category Sales
   * @description Cancel a sales order (bound Cancel action). Use to void an order that should not be fulfilled.
   * @route POST /cancel-order
   * @paramDef {"type":"Number","label":"Order","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getOrdersDictionary","description":"Order to cancel."}
   * @returns {Object}
   * @sampleResult {"DocEntry":22,"cancelled":true}
   */
  async cancelOrder(docEntry) {
    return await this.#documentAction({ entity: 'Orders', docEntry, action: 'Cancel', resultKey: 'cancelled', logTag: 'cancelOrder' })
  }

  // ==========================================================================
  //  SALES - Delivery Notes
  // ==========================================================================
  /**
   * @operationName Create Delivery Note
   * @category Sales
   * @description Create a delivery note (goods shipped to a customer) with line items. Use to record fulfillment of a sales order.
   * @route POST /create-delivery-note
   * @paramDef {"type":"String","label":"Customer","name":"cardCode","required":true,"dictionary":"getBusinessPartnersDictionary","description":"Customer the delivery is for."}
   * @paramDef {"type":"Array<DocumentLine>","label":"Line Items","name":"documentLines","required":true,"description":"Items being delivered. Each line needs an Item and Quantity."}
   * @paramDef {"type":"String","label":"Document Date","name":"docDate","uiComponent":{"type":"DATE_PICKER"},"description":"Posting date (defaults to today)."}
   * @paramDef {"type":"String","label":"Due Date","name":"docDueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Document due date."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free-text remarks."}
   * @returns {Object}
   * @sampleResult {"DocEntry":18,"DocNum":9,"CardCode":"c1","DocumentStatus":"bost_Open"}
   */
  async createDeliveryNote(cardCode, documentLines, docDate, docDueDate, comments) {
    return await this.#createDocument({ entity: 'DeliveryNotes', cardCode, documentLines, docDate, docDueDate, comments, logTag: 'createDeliveryNote' })
  }

  /**
   * @operationName Get Delivery Note
   * @category Sales
   * @description Retrieve a delivery note by its internal DocEntry.
   * @route POST /get-delivery-note
   * @paramDef {"type":"Number","label":"Delivery Note","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getDeliveryNotesDictionary","description":"Internal DocEntry of the delivery note."}
   * @returns {Object}
   * @sampleResult {"DocEntry":18,"DocNum":9,"CardCode":"c1","DocumentStatus":"bost_Open"}
   */
  async getDeliveryNote(docEntry) {
    return await this.#getDocument({ entity: 'DeliveryNotes', docEntry, logTag: 'getDeliveryNote' })
  }

  /**
   * @operationName List Delivery Notes
   * @category Sales
   * @description List or search delivery notes by customer and/or status. Follows pagination for all rows.
   * @route POST /list-delivery-notes
   * @paramDef {"type":"String","label":"Customer","name":"cardCode","dictionary":"getBusinessPartnersDictionary","description":"Limit to one customer."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Closed"]}},"description":"Open or closed delivery notes."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Cap rows; blank returns all."}
   * @returns {Object}
   * @sampleResult {"value":[{"DocEntry":18,"DocNum":9,"CardCode":"c1"}],"count":1}
   */
  async listDeliveryNotes(cardCode, status, maxResults) {
    return await this.#listDocuments({ entity: 'DeliveryNotes', cardCode, status, maxResults, logTag: 'listDeliveryNotes' })
  }

  /**
   * @operationName Update Delivery Note
   * @category Sales
   * @description Update a delivery note's header fields (PATCH; only supplied fields change).
   * @route POST /update-delivery-note
   * @paramDef {"type":"Number","label":"Delivery Note","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getDeliveryNotesDictionary","description":"Delivery note to update."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New remarks."}
   * @returns {Object}
   * @sampleResult {"DocEntry":18,"updated":true}
   */
  async updateDeliveryNote(docEntry, comments) {
    const fields = {}

    if (comments) fields.Comments = comments

    return await this.#updateDocument({ entity: 'DeliveryNotes', docEntry, fields, logTag: 'updateDeliveryNote' })
  }

  /**
   * @operationName Close Delivery Note
   * @category Sales
   * @description Close a delivery note (bound Close action).
   * @route POST /close-delivery-note
   * @paramDef {"type":"Number","label":"Delivery Note","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getDeliveryNotesDictionary","description":"Delivery note to close."}
   * @returns {Object}
   * @sampleResult {"DocEntry":18,"closed":true}
   */
  async closeDeliveryNote(docEntry) {
    return await this.#documentAction({ entity: 'DeliveryNotes', docEntry, action: 'Close', resultKey: 'closed', logTag: 'closeDeliveryNote' })
  }
  // NOTE: DeliveryNotes do NOT support the Cancel bound action in the Service Layer; use Close
  // to take a delivery note out of the open pipeline. (Cancel is only valid on A/R Invoices,
  // A/R Credit Memos, Incoming/Outgoing Payments, Orders, and Purchase Orders.)

  // ==========================================================================
  //  SALES - A/R Invoices (Invoices)
  // ==========================================================================
  /**
   * @operationName Create A/R Invoice
   * @category Sales
   * @description Create a customer (A/R) invoice with line items. Use to bill a customer for goods or services.
   * @route POST /create-ar-invoice
   * @paramDef {"type":"String","label":"Customer","name":"cardCode","required":true,"dictionary":"getBusinessPartnersDictionary","description":"Customer being invoiced."}
   * @paramDef {"type":"Array<DocumentLine>","label":"Line Items","name":"documentLines","required":true,"description":"Billed items. Each line needs an Item and Quantity."}
   * @paramDef {"type":"String","label":"Document Date","name":"docDate","uiComponent":{"type":"DATE_PICKER"},"description":"Posting date (defaults to today)."}
   * @paramDef {"type":"String","label":"Due Date","name":"docDueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Payment due date."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free-text remarks."}
   * @returns {Object}
   * @sampleResult {"DocEntry":5,"DocNum":3,"CardCode":"c1","DocumentStatus":"bost_Open","DocTotal":1960}
   */
  async createARInvoice(cardCode, documentLines, docDate, docDueDate, comments) {
    return await this.#createDocument({ entity: 'Invoices', cardCode, documentLines, docDate, docDueDate, comments, logTag: 'createARInvoice' })
  }

  /**
   * @operationName Get A/R Invoice
   * @category Sales
   * @description Retrieve a customer (A/R) invoice by its internal DocEntry.
   * @route POST /get-ar-invoice
   * @paramDef {"type":"Number","label":"Invoice","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getInvoicesDictionary","description":"Internal DocEntry of the invoice."}
   * @returns {Object}
   * @sampleResult {"DocEntry":5,"DocNum":3,"CardCode":"c1","DocumentStatus":"bost_Open"}
   */
  async getARInvoice(docEntry) {
    return await this.#getDocument({ entity: 'Invoices', docEntry, logTag: 'getARInvoice' })
  }

  /**
   * @operationName List A/R Invoices
   * @category Sales
   * @description List or search customer (A/R) invoices by customer and/or status. Follows pagination for all rows.
   * @route POST /list-ar-invoices
   * @paramDef {"type":"String","label":"Customer","name":"cardCode","dictionary":"getBusinessPartnersDictionary","description":"Limit to one customer."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Closed"]}},"description":"Open or closed invoices."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Cap rows; blank returns all."}
   * @returns {Object}
   * @sampleResult {"value":[{"DocEntry":5,"DocNum":3,"CardCode":"c1"}],"count":1}
   */
  async listARInvoices(cardCode, status, maxResults) {
    return await this.#listDocuments({ entity: 'Invoices', cardCode, status, maxResults, logTag: 'listARInvoices' })
  }

  /**
   * @operationName Update A/R Invoice
   * @category Sales
   * @description Update a customer (A/R) invoice's header fields (PATCH; only supplied fields change).
   * @route POST /update-ar-invoice
   * @paramDef {"type":"Number","label":"Invoice","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getInvoicesDictionary","description":"Invoice to update."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New remarks."}
   * @returns {Object}
   * @sampleResult {"DocEntry":5,"updated":true}
   */
  async updateARInvoice(docEntry, comments) {
    const fields = {}

    if (comments) fields.Comments = comments

    return await this.#updateDocument({ entity: 'Invoices', docEntry, fields, logTag: 'updateARInvoice' })
  }

  /**
   * @operationName Cancel A/R Invoice
   * @category Sales
   * @description Cancel a customer (A/R) invoice (bound Cancel action). Creates a cancellation document.
   * @route POST /cancel-ar-invoice
   * @paramDef {"type":"Number","label":"Invoice","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getInvoicesDictionary","description":"Invoice to cancel."}
   * @returns {Object}
   * @sampleResult {"DocEntry":5,"cancelled":true}
   */
  async cancelARInvoice(docEntry) {
    return await this.#documentAction({ entity: 'Invoices', docEntry, action: 'Cancel', resultKey: 'cancelled', logTag: 'cancelARInvoice' })
  }

  // ==========================================================================
  //  SALES - A/R Credit Memos (CreditNotes)
  // ==========================================================================
  /**
   * @operationName Create A/R Credit Memo
   * @category Sales
   * @description Create a customer (A/R) credit memo with line items. Use to credit a customer for returned goods or a billing correction.
   * @route POST /create-ar-credit-memo
   * @paramDef {"type":"String","label":"Customer","name":"cardCode","required":true,"dictionary":"getBusinessPartnersDictionary","description":"Customer being credited."}
   * @paramDef {"type":"Array<DocumentLine>","label":"Line Items","name":"documentLines","required":true,"description":"Credited items. Each line needs an Item and Quantity."}
   * @paramDef {"type":"String","label":"Document Date","name":"docDate","uiComponent":{"type":"DATE_PICKER"},"description":"Posting date (defaults to today)."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free-text remarks."}
   * @returns {Object}
   * @sampleResult {"DocEntry":4,"DocNum":2,"CardCode":"c1","DocumentStatus":"bost_Open"}
   */
  async createARCreditMemo(cardCode, documentLines, docDate, comments) {
    return await this.#createDocument({ entity: 'CreditNotes', cardCode, documentLines, docDate, comments, logTag: 'createARCreditMemo' })
  }

  /**
   * @operationName Get A/R Credit Memo
   * @category Sales
   * @description Retrieve a customer (A/R) credit memo by its internal DocEntry.
   * @route POST /get-ar-credit-memo
   * @paramDef {"type":"Number","label":"Credit Memo","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getCreditNotesDictionary","description":"Internal DocEntry of the credit memo."}
   * @returns {Object}
   * @sampleResult {"DocEntry":4,"DocNum":2,"CardCode":"c1"}
   */
  async getARCreditMemo(docEntry) {
    return await this.#getDocument({ entity: 'CreditNotes', docEntry, logTag: 'getARCreditMemo' })
  }

  /**
   * @operationName List A/R Credit Memos
   * @category Sales
   * @description List or search customer (A/R) credit memos by customer and/or status. Follows pagination for all rows.
   * @route POST /list-ar-credit-memos
   * @paramDef {"type":"String","label":"Customer","name":"cardCode","dictionary":"getBusinessPartnersDictionary","description":"Limit to one customer."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Closed"]}},"description":"Open or closed credit memos."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Cap rows; blank returns all."}
   * @returns {Object}
   * @sampleResult {"value":[{"DocEntry":4,"DocNum":2,"CardCode":"c1"}],"count":1}
   */
  async listARCreditMemos(cardCode, status, maxResults) {
    return await this.#listDocuments({ entity: 'CreditNotes', cardCode, status, maxResults, logTag: 'listARCreditMemos' })
  }

  /**
   * @operationName Update A/R Credit Memo
   * @category Sales
   * @description Update a customer (A/R) credit memo's header fields (PATCH; only supplied fields change).
   * @route POST /update-ar-credit-memo
   * @paramDef {"type":"Number","label":"Credit Memo","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getCreditNotesDictionary","description":"Credit memo to update."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New remarks."}
   * @returns {Object}
   * @sampleResult {"DocEntry":4,"updated":true}
   */
  async updateARCreditMemo(docEntry, comments) {
    const fields = {}

    if (comments) fields.Comments = comments

    return await this.#updateDocument({ entity: 'CreditNotes', docEntry, fields, logTag: 'updateARCreditMemo' })
  }

  /**
   * @operationName Cancel A/R Credit Memo
   * @category Sales
   * @description Cancel a customer (A/R) credit memo (bound Cancel action).
   * @route POST /cancel-ar-credit-memo
   * @paramDef {"type":"Number","label":"Credit Memo","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getCreditNotesDictionary","description":"Credit memo to cancel."}
   * @returns {Object}
   * @sampleResult {"DocEntry":4,"cancelled":true}
   */
  async cancelARCreditMemo(docEntry) {
    return await this.#documentAction({ entity: 'CreditNotes', docEntry, action: 'Cancel', resultKey: 'cancelled', logTag: 'cancelARCreditMemo' })
  }

  // ==========================================================================
  //  SALES - Returns
  // ==========================================================================
  /**
   * @operationName Create Return
   * @category Sales
   * @description Create a sales return (customer sends goods back) with line items.
   * @route POST /create-return
   * @paramDef {"type":"String","label":"Customer","name":"cardCode","required":true,"dictionary":"getBusinessPartnersDictionary","description":"Customer returning goods."}
   * @paramDef {"type":"Array<DocumentLine>","label":"Line Items","name":"documentLines","required":true,"description":"Returned items. Each line needs an Item and Quantity."}
   * @paramDef {"type":"String","label":"Document Date","name":"docDate","uiComponent":{"type":"DATE_PICKER"},"description":"Posting date (defaults to today)."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free-text remarks."}
   * @returns {Object}
   * @sampleResult {"DocEntry":3,"DocNum":1,"CardCode":"c1","DocumentStatus":"bost_Open"}
   */
  async createReturn(cardCode, documentLines, docDate, comments) {
    return await this.#createDocument({ entity: 'Returns', cardCode, documentLines, docDate, comments, logTag: 'createReturn' })
  }

  /**
   * @operationName Get Return
   * @category Sales
   * @description Retrieve a sales return by its internal DocEntry.
   * @route POST /get-return
   * @paramDef {"type":"Number","label":"Return","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getReturnsDictionary","description":"Internal DocEntry of the return."}
   * @returns {Object}
   * @sampleResult {"DocEntry":3,"DocNum":1,"CardCode":"c1"}
   */
  async getReturn(docEntry) {
    return await this.#getDocument({ entity: 'Returns', docEntry, logTag: 'getReturn' })
  }

  /**
   * @operationName List Returns
   * @category Sales
   * @description List or search sales returns by customer and/or status. Follows pagination for all rows.
   * @route POST /list-returns
   * @paramDef {"type":"String","label":"Customer","name":"cardCode","dictionary":"getBusinessPartnersDictionary","description":"Limit to one customer."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Closed"]}},"description":"Open or closed returns."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Cap rows; blank returns all."}
   * @returns {Object}
   * @sampleResult {"value":[{"DocEntry":3,"DocNum":1,"CardCode":"c1"}],"count":1}
   */
  async listReturns(cardCode, status, maxResults) {
    return await this.#listDocuments({ entity: 'Returns', cardCode, status, maxResults, logTag: 'listReturns' })
  }

  /**
   * @operationName Update Return
   * @category Sales
   * @description Update a sales return's header fields (PATCH; only supplied fields change).
   * @route POST /update-return
   * @paramDef {"type":"Number","label":"Return","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getReturnsDictionary","description":"Return to update."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New remarks."}
   * @returns {Object}
   * @sampleResult {"DocEntry":3,"updated":true}
   */
  async updateReturn(docEntry, comments) {
    const fields = {}

    if (comments) fields.Comments = comments

    return await this.#updateDocument({ entity: 'Returns', docEntry, fields, logTag: 'updateReturn' })
  }
  // NOTE: Returns do NOT support the Cancel bound action in the Service Layer (Cancel is valid
  // only on A/R Invoices, A/R Credit Memos, Incoming/Outgoing Payments, Orders, Purchase Orders).

  // ==========================================================================
  //  PURCHASING - Purchase Quotations
  // ==========================================================================
  /**
   * @operationName Create Purchase Quotation
   * @category Purchasing
   * @description Create a purchase quotation request to a vendor with line items. Use to solicit a vendor price before raising a purchase order.
   * @route POST /create-purchase-quotation
   * @paramDef {"type":"String","label":"Vendor","name":"cardCode","required":true,"dictionary":"getBusinessPartnersDictionary","description":"Vendor to request a quote from."}
   * @paramDef {"type":"Array<DocumentLine>","label":"Line Items","name":"documentLines","required":true,"description":"Items to quote. Each line needs an Item and Quantity."}
   * @paramDef {"type":"String","label":"Document Date","name":"docDate","uiComponent":{"type":"DATE_PICKER"},"description":"Posting date (defaults to today)."}
   * @paramDef {"type":"String","label":"Required By","name":"docDueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Date the quote is required by."}
   * @returns {Object}
   * @sampleResult {"DocEntry":21,"DocNum":5,"CardCode":"v1","DocumentStatus":"bost_Open"}
   */
  async createPurchaseQuotation(cardCode, documentLines, docDate, docDueDate) {
    return await this.#createDocument({ entity: 'PurchaseQuotations', cardCode, documentLines, docDate, docDueDate, logTag: 'createPurchaseQuotation' })
  }

  /**
   * @operationName Get Purchase Quotation
   * @category Purchasing
   * @description Retrieve a purchase quotation by its internal DocEntry.
   * @route POST /get-purchase-quotation
   * @paramDef {"type":"Number","label":"Purchase Quotation","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getPurchaseQuotationsDictionary","description":"Internal DocEntry of the purchase quotation."}
   * @returns {Object}
   * @sampleResult {"DocEntry":21,"DocNum":5,"CardCode":"v1"}
   */
  async getPurchaseQuotation(docEntry) {
    return await this.#getDocument({ entity: 'PurchaseQuotations', docEntry, logTag: 'getPurchaseQuotation' })
  }

  /**
   * @operationName List Purchase Quotations
   * @category Purchasing
   * @description List or search purchase quotations by vendor and/or status. Follows pagination for all rows.
   * @route POST /list-purchase-quotations
   * @paramDef {"type":"String","label":"Vendor","name":"cardCode","dictionary":"getBusinessPartnersDictionary","description":"Limit to one vendor."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Closed"]}},"description":"Open or closed purchase quotations."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Cap rows; blank returns all."}
   * @returns {Object}
   * @sampleResult {"value":[{"DocEntry":21,"DocNum":5,"CardCode":"v1"}],"count":1}
   */
  async listPurchaseQuotations(cardCode, status, maxResults) {
    return await this.#listDocuments({ entity: 'PurchaseQuotations', cardCode, status, maxResults, logTag: 'listPurchaseQuotations' })
  }

  /**
   * @operationName Update Purchase Quotation
   * @category Purchasing
   * @description Update a purchase quotation's header fields (PATCH; only supplied fields change).
   * @route POST /update-purchase-quotation
   * @paramDef {"type":"Number","label":"Purchase Quotation","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getPurchaseQuotationsDictionary","description":"Purchase quotation to update."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New remarks."}
   * @returns {Object}
   * @sampleResult {"DocEntry":21,"updated":true}
   */
  async updatePurchaseQuotation(docEntry, comments) {
    const fields = {}

    if (comments) fields.Comments = comments

    return await this.#updateDocument({ entity: 'PurchaseQuotations', docEntry, fields, logTag: 'updatePurchaseQuotation' })
  }

  /**
   * @operationName Close Purchase Quotation
   * @category Purchasing
   * @description Close a purchase quotation (bound Close action).
   * @route POST /close-purchase-quotation
   * @paramDef {"type":"Number","label":"Purchase Quotation","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getPurchaseQuotationsDictionary","description":"Purchase quotation to close."}
   * @returns {Object}
   * @sampleResult {"DocEntry":21,"closed":true}
   */
  async closePurchaseQuotation(docEntry) {
    return await this.#documentAction({ entity: 'PurchaseQuotations', docEntry, action: 'Close', resultKey: 'closed', logTag: 'closePurchaseQuotation' })
  }

  // ==========================================================================
  //  PURCHASING - Purchase Orders
  // ==========================================================================
  /**
   * @operationName Create Purchase Order
   * @category Purchasing
   * @description Create a purchase order to a vendor with line items. Use to procure stock or services.
   * @route POST /create-purchase-order
   * @paramDef {"type":"String","label":"Vendor","name":"cardCode","required":true,"dictionary":"getBusinessPartnersDictionary","description":"Vendor to purchase from."}
   * @paramDef {"type":"Array<DocumentLine>","label":"Line Items","name":"documentLines","required":true,"description":"Items to order; each needs an Item and Quantity."}
   * @paramDef {"type":"String","label":"Document Date","name":"docDate","uiComponent":{"type":"DATE_PICKER"},"description":"Posting date (defaults to today)."}
   * @paramDef {"type":"String","label":"Expected Date","name":"docDueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Expected receipt date."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free-text remarks."}
   * @returns {Object}
   * @sampleResult {"DocEntry":31,"DocNum":15,"CardCode":"v1","DocumentStatus":"bost_Open"}
   */
  async createPurchaseOrder(cardCode, documentLines, docDate, docDueDate, comments) {
    return await this.#createDocument({ entity: 'PurchaseOrders', cardCode, documentLines, docDate, docDueDate, comments, logTag: 'createPurchaseOrder' })
  }

  /**
   * @operationName Get Purchase Order
   * @category Purchasing
   * @description Retrieve a purchase order by its internal DocEntry.
   * @route POST /get-purchase-order
   * @paramDef {"type":"Number","label":"Purchase Order","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getPurchaseOrdersDictionary","description":"Internal DocEntry of the purchase order."}
   * @returns {Object}
   * @sampleResult {"DocEntry":31,"DocNum":15,"CardCode":"v1","DocumentStatus":"bost_Open"}
   */
  async getPurchaseOrder(docEntry) {
    return await this.#getDocument({ entity: 'PurchaseOrders', docEntry, logTag: 'getPurchaseOrder' })
  }

  /**
   * @operationName List Purchase Orders
   * @category Purchasing
   * @description List or search purchase orders by vendor and/or status. Follows pagination for all rows.
   * @route POST /list-purchase-orders
   * @paramDef {"type":"String","label":"Vendor","name":"cardCode","dictionary":"getBusinessPartnersDictionary","description":"Limit to one vendor."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Closed"]}},"description":"Open or closed purchase orders."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Cap rows; blank returns all."}
   * @returns {Object}
   * @sampleResult {"value":[{"DocEntry":31,"DocNum":15,"CardCode":"v1"}],"count":1}
   */
  async listPurchaseOrders(cardCode, status, maxResults) {
    return await this.#listDocuments({ entity: 'PurchaseOrders', cardCode, status, maxResults, logTag: 'listPurchaseOrders' })
  }

  /**
   * @operationName Update Purchase Order
   * @category Purchasing
   * @description Update a purchase order's header fields (PATCH; only supplied fields change).
   * @route POST /update-purchase-order
   * @paramDef {"type":"Number","label":"Purchase Order","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getPurchaseOrdersDictionary","description":"Purchase order to update."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New remarks."}
   * @paramDef {"type":"String","label":"Expected Date","name":"docDueDate","uiComponent":{"type":"DATE_PICKER"},"description":"New expected receipt date."}
   * @returns {Object}
   * @sampleResult {"DocEntry":31,"updated":true}
   */
  async updatePurchaseOrder(docEntry, comments, docDueDate) {
    const fields = {}

    if (comments) fields.Comments = comments
    if (docDueDate) fields.DocDueDate = docDueDate

    return await this.#updateDocument({ entity: 'PurchaseOrders', docEntry, fields, logTag: 'updatePurchaseOrder' })
  }

  /**
   * @operationName Close Purchase Order
   * @category Purchasing
   * @description Close a purchase order (bound Close action).
   * @route POST /close-purchase-order
   * @paramDef {"type":"Number","label":"Purchase Order","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getPurchaseOrdersDictionary","description":"Purchase order to close."}
   * @returns {Object}
   * @sampleResult {"DocEntry":31,"closed":true}
   */
  async closePurchaseOrder(docEntry) {
    return await this.#documentAction({ entity: 'PurchaseOrders', docEntry, action: 'Close', resultKey: 'closed', logTag: 'closePurchaseOrder' })
  }

  /**
   * @operationName Cancel Purchase Order
   * @category Purchasing
   * @description Cancel a purchase order (bound Cancel action). Use to void a PO that should not be fulfilled.
   * @route POST /cancel-purchase-order
   * @paramDef {"type":"Number","label":"Purchase Order","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getPurchaseOrdersDictionary","description":"Purchase order to cancel."}
   * @returns {Object}
   * @sampleResult {"DocEntry":31,"cancelled":true}
   */
  async cancelPurchaseOrder(docEntry) {
    return await this.#documentAction({ entity: 'PurchaseOrders', docEntry, action: 'Cancel', resultKey: 'cancelled', logTag: 'cancelPurchaseOrder' })
  }

  // ==========================================================================
  //  PURCHASING - Goods Receipt PO (PurchaseDeliveryNotes)
  // ==========================================================================
  /**
   * @operationName Create Goods Receipt PO
   * @category Purchasing
   * @description Create a goods receipt PO (record receipt of purchased goods) with line items. Use to receive stock against a purchase order.
   * @route POST /create-goods-receipt-po
   * @paramDef {"type":"String","label":"Vendor","name":"cardCode","required":true,"dictionary":"getBusinessPartnersDictionary","description":"Vendor the goods came from."}
   * @paramDef {"type":"Array<DocumentLine>","label":"Line Items","name":"documentLines","required":true,"description":"Received items. Each line needs an Item and Quantity."}
   * @paramDef {"type":"String","label":"Document Date","name":"docDate","uiComponent":{"type":"DATE_PICKER"},"description":"Posting date (defaults to today)."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free-text remarks."}
   * @returns {Object}
   * @sampleResult {"DocEntry":24,"DocNum":8,"CardCode":"v1","DocumentStatus":"bost_Open"}
   */
  async createGoodsReceiptPO(cardCode, documentLines, docDate, comments) {
    return await this.#createDocument({ entity: 'PurchaseDeliveryNotes', cardCode, documentLines, docDate, comments, logTag: 'createGoodsReceiptPO' })
  }

  /**
   * @operationName Get Goods Receipt PO
   * @category Purchasing
   * @description Retrieve a goods receipt PO by its internal DocEntry.
   * @route POST /get-goods-receipt-po
   * @paramDef {"type":"Number","label":"Goods Receipt PO","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getPurchaseDeliveryNotesDictionary","description":"Internal DocEntry of the goods receipt PO."}
   * @returns {Object}
   * @sampleResult {"DocEntry":24,"DocNum":8,"CardCode":"v1"}
   */
  async getGoodsReceiptPO(docEntry) {
    return await this.#getDocument({ entity: 'PurchaseDeliveryNotes', docEntry, logTag: 'getGoodsReceiptPO' })
  }

  /**
   * @operationName List Goods Receipt POs
   * @category Purchasing
   * @description List or search goods receipt POs by vendor and/or status. Follows pagination for all rows.
   * @route POST /list-goods-receipt-pos
   * @paramDef {"type":"String","label":"Vendor","name":"cardCode","dictionary":"getBusinessPartnersDictionary","description":"Limit to one vendor."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Closed"]}},"description":"Open or closed goods receipt POs."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Cap rows; blank returns all."}
   * @returns {Object}
   * @sampleResult {"value":[{"DocEntry":24,"DocNum":8,"CardCode":"v1"}],"count":1}
   */
  async listGoodsReceiptPOs(cardCode, status, maxResults) {
    return await this.#listDocuments({ entity: 'PurchaseDeliveryNotes', cardCode, status, maxResults, logTag: 'listGoodsReceiptPOs' })
  }

  /**
   * @operationName Update Goods Receipt PO
   * @category Purchasing
   * @description Update a goods receipt PO's header fields (PATCH; only supplied fields change).
   * @route POST /update-goods-receipt-po
   * @paramDef {"type":"Number","label":"Goods Receipt PO","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getPurchaseDeliveryNotesDictionary","description":"Goods receipt PO to update."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New remarks."}
   * @returns {Object}
   * @sampleResult {"DocEntry":24,"updated":true}
   */
  async updateGoodsReceiptPO(docEntry, comments) {
    const fields = {}

    if (comments) fields.Comments = comments

    return await this.#updateDocument({ entity: 'PurchaseDeliveryNotes', docEntry, fields, logTag: 'updateGoodsReceiptPO' })
  }
  // NOTE: Goods Receipt POs (PurchaseDeliveryNotes) do NOT support the Cancel bound action in
  // the Service Layer (Cancel is valid only on A/R Invoices, A/R Credit Memos, Incoming/Outgoing
  // Payments, Orders, and Purchase Orders).

  // ==========================================================================
  //  PURCHASING - A/P Invoices (PurchaseInvoices). Cancel NOT supported (-5006).
  // ==========================================================================
  /**
   * @operationName Create A/P Invoice
   * @category Purchasing
   * @description Create a vendor (A/P) invoice with line items. Use to record a bill from a vendor.
   * @route POST /create-ap-invoice
   * @paramDef {"type":"String","label":"Vendor","name":"cardCode","required":true,"dictionary":"getBusinessPartnersDictionary","description":"Vendor billing you."}
   * @paramDef {"type":"Array<DocumentLine>","label":"Line Items","name":"documentLines","required":true,"description":"Billed items. Each line needs an Item and Quantity."}
   * @paramDef {"type":"String","label":"Document Date","name":"docDate","uiComponent":{"type":"DATE_PICKER"},"description":"Posting date (defaults to today)."}
   * @paramDef {"type":"String","label":"Due Date","name":"docDueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Payment due date."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free-text remarks."}
   * @returns {Object}
   * @sampleResult {"DocEntry":14,"DocNum":4,"CardCode":"v1","DocumentStatus":"bost_Open"}
   */
  async createAPInvoice(cardCode, documentLines, docDate, docDueDate, comments) {
    return await this.#createDocument({ entity: 'PurchaseInvoices', cardCode, documentLines, docDate, docDueDate, comments, logTag: 'createAPInvoice' })
  }

  /**
   * @operationName Get A/P Invoice
   * @category Purchasing
   * @description Retrieve a vendor (A/P) invoice by its internal DocEntry.
   * @route POST /get-ap-invoice
   * @paramDef {"type":"Number","label":"A/P Invoice","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getPurchaseInvoicesDictionary","description":"Internal DocEntry of the A/P invoice."}
   * @returns {Object}
   * @sampleResult {"DocEntry":14,"DocNum":4,"CardCode":"v1"}
   */
  async getAPInvoice(docEntry) {
    return await this.#getDocument({ entity: 'PurchaseInvoices', docEntry, logTag: 'getAPInvoice' })
  }

  /**
   * @operationName List A/P Invoices
   * @category Purchasing
   * @description List or search vendor (A/P) invoices by vendor and/or status. Follows pagination for all rows.
   * @route POST /list-ap-invoices
   * @paramDef {"type":"String","label":"Vendor","name":"cardCode","dictionary":"getBusinessPartnersDictionary","description":"Limit to one vendor."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Closed"]}},"description":"Open or closed A/P invoices."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Cap rows; blank returns all."}
   * @returns {Object}
   * @sampleResult {"value":[{"DocEntry":14,"DocNum":4,"CardCode":"v1"}],"count":1}
   */
  async listAPInvoices(cardCode, status, maxResults) {
    return await this.#listDocuments({ entity: 'PurchaseInvoices', cardCode, status, maxResults, logTag: 'listAPInvoices' })
  }

  /**
   * @operationName Update A/P Invoice
   * @category Purchasing
   * @description Update a vendor (A/P) invoice's header fields (PATCH; only supplied fields change). Note: A/P invoices cannot be cancelled via Service Layer.
   * @route POST /update-ap-invoice
   * @paramDef {"type":"Number","label":"A/P Invoice","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getPurchaseInvoicesDictionary","description":"A/P invoice to update."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New remarks."}
   * @returns {Object}
   * @sampleResult {"DocEntry":14,"updated":true}
   */
  async updateAPInvoice(docEntry, comments) {
    const fields = {}

    if (comments) fields.Comments = comments

    return await this.#updateDocument({ entity: 'PurchaseInvoices', docEntry, fields, logTag: 'updateAPInvoice' })
  }

  // ==========================================================================
  //  PURCHASING - A/P Credit Memos (PurchaseCreditNotes)
  // ==========================================================================
  /**
   * @operationName Create A/P Credit Memo
   * @category Purchasing
   * @description Create a vendor (A/P) credit memo with line items. Use to record a credit from a vendor for returned goods or a billing correction.
   * @route POST /create-ap-credit-memo
   * @paramDef {"type":"String","label":"Vendor","name":"cardCode","required":true,"dictionary":"getBusinessPartnersDictionary","description":"Vendor issuing the credit."}
   * @paramDef {"type":"Array<DocumentLine>","label":"Line Items","name":"documentLines","required":true,"description":"Credited items. Each line needs an Item and Quantity."}
   * @paramDef {"type":"String","label":"Document Date","name":"docDate","uiComponent":{"type":"DATE_PICKER"},"description":"Posting date (defaults to today)."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free-text remarks."}
   * @returns {Object}
   * @sampleResult {"DocEntry":9,"DocNum":2,"CardCode":"v1","DocumentStatus":"bost_Open"}
   */
  async createAPCreditMemo(cardCode, documentLines, docDate, comments) {
    return await this.#createDocument({ entity: 'PurchaseCreditNotes', cardCode, documentLines, docDate, comments, logTag: 'createAPCreditMemo' })
  }

  /**
   * @operationName Get A/P Credit Memo
   * @category Purchasing
   * @description Retrieve a vendor (A/P) credit memo by its internal DocEntry.
   * @route POST /get-ap-credit-memo
   * @paramDef {"type":"Number","label":"A/P Credit Memo","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getPurchaseCreditNotesDictionary","description":"Internal DocEntry of the A/P credit memo."}
   * @returns {Object}
   * @sampleResult {"DocEntry":9,"DocNum":2,"CardCode":"v1"}
   */
  async getAPCreditMemo(docEntry) {
    return await this.#getDocument({ entity: 'PurchaseCreditNotes', docEntry, logTag: 'getAPCreditMemo' })
  }

  /**
   * @operationName List A/P Credit Memos
   * @category Purchasing
   * @description List or search vendor (A/P) credit memos by vendor and/or status. Follows pagination for all rows.
   * @route POST /list-ap-credit-memos
   * @paramDef {"type":"String","label":"Vendor","name":"cardCode","dictionary":"getBusinessPartnersDictionary","description":"Limit to one vendor."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Closed"]}},"description":"Open or closed A/P credit memos."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Cap rows; blank returns all."}
   * @returns {Object}
   * @sampleResult {"value":[{"DocEntry":9,"DocNum":2,"CardCode":"v1"}],"count":1}
   */
  async listAPCreditMemos(cardCode, status, maxResults) {
    return await this.#listDocuments({ entity: 'PurchaseCreditNotes', cardCode, status, maxResults, logTag: 'listAPCreditMemos' })
  }

  /**
   * @operationName Update A/P Credit Memo
   * @category Purchasing
   * @description Update a vendor (A/P) credit memo's header fields (PATCH; only supplied fields change).
   * @route POST /update-ap-credit-memo
   * @paramDef {"type":"Number","label":"A/P Credit Memo","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getPurchaseCreditNotesDictionary","description":"A/P credit memo to update."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New remarks."}
   * @returns {Object}
   * @sampleResult {"DocEntry":9,"updated":true}
   */
  async updateAPCreditMemo(docEntry, comments) {
    const fields = {}

    if (comments) fields.Comments = comments

    return await this.#updateDocument({ entity: 'PurchaseCreditNotes', docEntry, fields, logTag: 'updateAPCreditMemo' })
  }

  // ==========================================================================
  //  PAYMENTS
  // ==========================================================================
  // Builds a payment body shared by incoming/outgoing payments.
  // docs: Service Layer API Reference - IncomingPayments / VendorPayments (header = CardCode + tender + PaymentInvoices[])
  #paymentBody({ cardCode, paymentInvoices, cashSum, transferSum, transferAccount, docDate }) {
    if (!cardCode) throw new Error('Customer/Vendor (CardCode) is required.')

    const body = { CardCode: cardCode }

    if (Array.isArray(paymentInvoices) && paymentInvoices.length) {
      body.PaymentInvoices = paymentInvoices.map(p => {
        const link = {}

        if (p.DocEntry !== undefined && p.DocEntry !== null && p.DocEntry !== '') link.DocEntry = p.DocEntry
        if (p.SumApplied !== undefined && p.SumApplied !== null && p.SumApplied !== '') link.SumApplied = p.SumApplied
        if (p.InvoiceType) link.InvoiceType = p.InvoiceType

        return link
      })
    }

    if (cashSum !== undefined && cashSum !== null && cashSum !== '') body.CashSum = cashSum
    if (transferSum !== undefined && transferSum !== null && transferSum !== '') body.TransferSum = transferSum
    if (transferAccount) body.TransferAccount = transferAccount
    if (docDate) body.DocDate = docDate

    return body
  }

  /**
   * @operationName Create Incoming Payment
   * @category Payments
   * @description Record a customer payment against one or more A/R invoices. Use to apply received cash, transfer, or check to open invoices.
   * @route POST /create-incoming-payment
   * @paramDef {"type":"String","label":"Customer","name":"cardCode","required":true,"dictionary":"getBusinessPartnersDictionary","description":"Paying customer."}
   * @paramDef {"type":"Array<PaymentInvoiceLink>","label":"Invoices Paid","name":"paymentInvoices","description":"Invoices this payment settles (by DocEntry + amount)."}
   * @paramDef {"type":"Number","label":"Cash Amount","name":"cashSum","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Amount paid in cash."}
   * @paramDef {"type":"Number","label":"Bank Transfer Amount","name":"transferSum","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Amount paid by bank transfer."}
   * @paramDef {"type":"String","label":"Bank G/L Account","name":"transferAccount","dictionary":"getChartOfAccountsDictionary","description":"G/L account for the transfer."}
   * @paramDef {"type":"String","label":"Payment Date","name":"docDate","uiComponent":{"type":"DATE_PICKER"},"description":"Posting date (defaults to today)."}
   * @returns {Object}
   * @sampleResult {"DocEntry":5,"DocNum":3,"CardCode":"c1","CashSum":1960}
   */
  async createIncomingPayment(cardCode, paymentInvoices, cashSum, transferSum, transferAccount, docDate) {
    const body = this.#paymentBody({ cardCode, paymentInvoices, cashSum, transferSum, transferAccount, docDate })

    return await this.#apiRequest({ entity: 'IncomingPayments', method: 'post', body, logTag: 'createIncomingPayment' })
  }

  /**
   * @operationName Get Incoming Payment
   * @category Payments
   * @description Retrieve an incoming (customer) payment by its internal DocEntry.
   * @route POST /get-incoming-payment
   * @paramDef {"type":"Number","label":"Incoming Payment","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getIncomingPaymentsDictionary","description":"Internal DocEntry of the payment."}
   * @returns {Object}
   * @sampleResult {"DocEntry":5,"DocNum":3,"CardCode":"c1","CashSum":1960}
   */
  async getIncomingPayment(docEntry) {
    return await this.#getDocument({ entity: 'IncomingPayments', docEntry, logTag: 'getIncomingPayment' })
  }

  /**
   * @operationName List Incoming Payments
   * @category Payments
   * @description List or search incoming (customer) payments by customer. Follows pagination for all rows.
   * @route POST /list-incoming-payments
   * @paramDef {"type":"String","label":"Customer","name":"cardCode","dictionary":"getBusinessPartnersDictionary","description":"Limit to one customer."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Cap rows; blank returns all."}
   * @returns {Object}
   * @sampleResult {"value":[{"DocEntry":5,"DocNum":3,"CardCode":"c1"}],"count":1}
   */
  async listIncomingPayments(cardCode, maxResults) {
    return await this.#listDocuments({ entity: 'IncomingPayments', cardCode, maxResults, logTag: 'listIncomingPayments' })
  }

  /**
   * @operationName Cancel Incoming Payment
   * @category Payments
   * @description Cancel an incoming (customer) payment (bound Cancel action). Posted payments cannot be edited or deleted, only cancelled.
   * @route POST /cancel-incoming-payment
   * @paramDef {"type":"Number","label":"Incoming Payment","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getIncomingPaymentsDictionary","description":"Payment to cancel."}
   * @returns {Object}
   * @sampleResult {"DocEntry":5,"cancelled":true}
   */
  async cancelIncomingPayment(docEntry) {
    return await this.#documentAction({ entity: 'IncomingPayments', docEntry, action: 'Cancel', resultKey: 'cancelled', logTag: 'cancelIncomingPayment' })
  }

  /**
   * @operationName Create Outgoing Payment
   * @category Payments
   * @description Record a payment to a vendor against one or more A/P invoices. Use to apply cash, transfer, or check to open vendor bills.
   * @route POST /create-outgoing-payment
   * @paramDef {"type":"String","label":"Vendor","name":"cardCode","required":true,"dictionary":"getBusinessPartnersDictionary","description":"Vendor being paid."}
   * @paramDef {"type":"Array<PaymentInvoiceLink>","label":"Invoices Paid","name":"paymentInvoices","description":"A/P invoices this payment settles (by DocEntry + amount)."}
   * @paramDef {"type":"Number","label":"Cash Amount","name":"cashSum","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Amount paid in cash."}
   * @paramDef {"type":"Number","label":"Bank Transfer Amount","name":"transferSum","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Amount paid by bank transfer."}
   * @paramDef {"type":"String","label":"Bank G/L Account","name":"transferAccount","dictionary":"getChartOfAccountsDictionary","description":"G/L account for the transfer."}
   * @paramDef {"type":"String","label":"Payment Date","name":"docDate","uiComponent":{"type":"DATE_PICKER"},"description":"Posting date (defaults to today)."}
   * @returns {Object}
   * @sampleResult {"DocEntry":7,"DocNum":2,"CardCode":"v1","TransferSum":500}
   */
  async createOutgoingPayment(cardCode, paymentInvoices, cashSum, transferSum, transferAccount, docDate) {
    const body = this.#paymentBody({ cardCode, paymentInvoices, cashSum, transferSum, transferAccount, docDate })

    return await this.#apiRequest({ entity: 'VendorPayments', method: 'post', body, logTag: 'createOutgoingPayment' })
  }

  /**
   * @operationName Get Outgoing Payment
   * @category Payments
   * @description Retrieve an outgoing (vendor) payment by its internal DocEntry.
   * @route POST /get-outgoing-payment
   * @paramDef {"type":"Number","label":"Outgoing Payment","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getVendorPaymentsDictionary","description":"Internal DocEntry of the payment."}
   * @returns {Object}
   * @sampleResult {"DocEntry":7,"DocNum":2,"CardCode":"v1","TransferSum":500}
   */
  async getOutgoingPayment(docEntry) {
    return await this.#getDocument({ entity: 'VendorPayments', docEntry, logTag: 'getOutgoingPayment' })
  }

  /**
   * @operationName List Outgoing Payments
   * @category Payments
   * @description List or search outgoing (vendor) payments by vendor. Follows pagination for all rows.
   * @route POST /list-outgoing-payments
   * @paramDef {"type":"String","label":"Vendor","name":"cardCode","dictionary":"getBusinessPartnersDictionary","description":"Limit to one vendor."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Cap rows; blank returns all."}
   * @returns {Object}
   * @sampleResult {"value":[{"DocEntry":7,"DocNum":2,"CardCode":"v1"}],"count":1}
   */
  async listOutgoingPayments(cardCode, maxResults) {
    return await this.#listDocuments({ entity: 'VendorPayments', cardCode, maxResults, logTag: 'listOutgoingPayments' })
  }

  /**
   * @operationName Cancel Outgoing Payment
   * @category Payments
   * @description Cancel an outgoing (vendor) payment (bound Cancel action). Posted payments cannot be edited or deleted, only cancelled.
   * @route POST /cancel-outgoing-payment
   * @paramDef {"type":"Number","label":"Outgoing Payment","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getVendorPaymentsDictionary","description":"Payment to cancel."}
   * @returns {Object}
   * @sampleResult {"DocEntry":7,"cancelled":true}
   */
  async cancelOutgoingPayment(docEntry) {
    return await this.#documentAction({ entity: 'VendorPayments', docEntry, action: 'Cancel', resultKey: 'cancelled', logTag: 'cancelOutgoingPayment' })
  }

  // ==========================================================================
  //  INVENTORY TRANSACTIONS
  // ==========================================================================
  /**
   * @operationName Create Stock Transfer
   * @category Items & Inventory
   * @description Move stock between warehouses with line items. Use to rebalance inventory across locations.
   * @route POST /create-stock-transfer
   * @paramDef {"type":"String","label":"From Warehouse","name":"fromWarehouse","required":true,"dictionary":"getWarehousesDictionary","description":"Warehouse stock is moved out of."}
   * @paramDef {"type":"String","label":"To Warehouse","name":"toWarehouse","required":true,"dictionary":"getWarehousesDictionary","description":"Warehouse stock is moved into."}
   * @paramDef {"type":"Array<DocumentLine>","label":"Line Items","name":"stockTransferLines","required":true,"description":"Items to move. Each line needs an Item, Quantity, and source WarehouseCode."}
   * @paramDef {"type":"String","label":"Document Date","name":"docDate","uiComponent":{"type":"DATE_PICKER"},"description":"Posting date (defaults to today)."}
   * @returns {Object}
   * @sampleResult {"DocEntry":16,"DocNum":6,"FromWarehouse":"01","ToWarehouse":"02"}
   */
  async createStockTransfer(fromWarehouse, toWarehouse, stockTransferLines, docDate) {
    if (!fromWarehouse) throw new Error('From Warehouse is required.')
    if (!toWarehouse) throw new Error('To Warehouse is required.')
    if (!Array.isArray(stockTransferLines) || !stockTransferLines.length) throw new Error('At least one stock transfer line is required.')

    // Document-style body: header (warehouses) + StockTransferLines[].
    const body = {
      FromWarehouse: fromWarehouse,
      ToWarehouse: toWarehouse,
      StockTransferLines: this.#mapDocumentLines(stockTransferLines),
    }

    if (docDate) body.DocDate = docDate

    return await this.#apiRequest({ entity: 'StockTransfers', method: 'post', body, logTag: 'createStockTransfer' })
  }

  /**
   * @operationName Get Stock Transfer
   * @category Items & Inventory
   * @description Retrieve a stock transfer by its internal DocEntry.
   * @route POST /get-stock-transfer
   * @paramDef {"type":"Number","label":"Stock Transfer","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getStockTransfersDictionary","description":"Internal DocEntry of the stock transfer."}
   * @returns {Object}
   * @sampleResult {"DocEntry":16,"DocNum":6,"FromWarehouse":"01","ToWarehouse":"02"}
   */
  async getStockTransfer(docEntry) {
    return await this.#getDocument({ entity: 'StockTransfers', docEntry, logTag: 'getStockTransfer' })
  }

  /**
   * @operationName List Stock Transfers
   * @category Items & Inventory
   * @description List stock transfers. Follows pagination to return all rows.
   * @route POST /list-stock-transfers
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Cap rows; blank returns all."}
   * @returns {Object}
   * @sampleResult {"value":[{"DocEntry":16,"DocNum":6,"FromWarehouse":"01"}],"count":1}
   */
  async listStockTransfers(maxResults) {
    return await this.#listAll({ entity: 'StockTransfers', maxResults, logTag: 'listStockTransfers' })
  }

  /**
   * @operationName Update Stock Transfer
   * @category Items & Inventory
   * @description Update a stock transfer's header fields (PATCH; only supplied fields change).
   * @route POST /update-stock-transfer
   * @paramDef {"type":"Number","label":"Stock Transfer","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getStockTransfersDictionary","description":"Stock transfer to update."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New remarks."}
   * @returns {Object}
   * @sampleResult {"DocEntry":16,"updated":true}
   */
  async updateStockTransfer(docEntry, comments) {
    const fields = {}

    if (comments) fields.Comments = comments

    return await this.#updateDocument({ entity: 'StockTransfers', docEntry, fields, logTag: 'updateStockTransfer' })
  }

  /**
   * @operationName Create Goods Issue
   * @category Items & Inventory
   * @description Post a goods issue (remove stock from inventory, e.g. for scrap or internal use) with line items. Posted documents cannot be edited or deleted.
   * @route POST /create-goods-issue
   * @paramDef {"type":"Array<DocumentLine>","label":"Line Items","name":"documentLines","required":true,"description":"Items to issue out. Each line needs an Item, Quantity, and WarehouseCode."}
   * @paramDef {"type":"String","label":"Document Date","name":"docDate","uiComponent":{"type":"DATE_PICKER"},"description":"Posting date (defaults to today)."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free-text remarks."}
   * @returns {Object}
   * @sampleResult {"DocEntry":12,"DocNum":3,"DocumentLines":[{"ItemCode":"i1","Quantity":5}]}
   */
  async createGoodsIssue(documentLines, docDate, comments) {
    if (!Array.isArray(documentLines) || !documentLines.length) throw new Error('At least one line item is required.')

    // InventoryGenExits is a document-style entity: header + DocumentLines[], and has no CardCode.
    const body = { DocumentLines: this.#mapDocumentLines(documentLines) }

    if (docDate) body.DocDate = docDate
    if (comments) body.Comments = comments

    return await this.#apiRequest({ entity: 'InventoryGenExits', method: 'post', body, logTag: 'createGoodsIssue' })
  }

  /**
   * @operationName Get Goods Issue
   * @category Items & Inventory
   * @description Retrieve a goods issue by its internal DocEntry.
   * @route POST /get-goods-issue
   * @paramDef {"type":"Number","label":"Goods Issue","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Internal DocEntry of the goods issue."}
   * @returns {Object}
   * @sampleResult {"DocEntry":12,"DocNum":3}
   */
  async getGoodsIssue(docEntry) {
    return await this.#getDocument({ entity: 'InventoryGenExits', docEntry, logTag: 'getGoodsIssue' })
  }

  /**
   * @operationName List Goods Issues
   * @category Items & Inventory
   * @description List goods issues. Follows pagination to return all rows.
   * @route POST /list-goods-issues
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Cap rows; blank returns all."}
   * @returns {Object}
   * @sampleResult {"value":[{"DocEntry":12,"DocNum":3}],"count":1}
   */
  async listGoodsIssues(maxResults) {
    return await this.#listAll({ entity: 'InventoryGenExits', maxResults, logTag: 'listGoodsIssues' })
  }

  /**
   * @operationName Create Goods Receipt
   * @category Items & Inventory
   * @description Post a goods receipt (add stock to inventory, e.g. for production or found stock) with line items. Posted documents cannot be edited or deleted.
   * @route POST /create-goods-receipt
   * @paramDef {"type":"Array<DocumentLine>","label":"Line Items","name":"documentLines","required":true,"description":"Items to receive in. Each line needs an Item, Quantity, and WarehouseCode."}
   * @paramDef {"type":"String","label":"Document Date","name":"docDate","uiComponent":{"type":"DATE_PICKER"},"description":"Posting date (defaults to today)."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free-text remarks."}
   * @returns {Object}
   * @sampleResult {"DocEntry":13,"DocNum":4,"DocumentLines":[{"ItemCode":"i1","Quantity":5}]}
   */
  async createGoodsReceipt(documentLines, docDate, comments) {
    if (!Array.isArray(documentLines) || !documentLines.length) throw new Error('At least one line item is required.')

    // InventoryGenEntries is a document-style entity: header + DocumentLines[], and has no CardCode.
    const body = { DocumentLines: this.#mapDocumentLines(documentLines) }

    if (docDate) body.DocDate = docDate
    if (comments) body.Comments = comments

    return await this.#apiRequest({ entity: 'InventoryGenEntries', method: 'post', body, logTag: 'createGoodsReceipt' })
  }

  /**
   * @operationName Get Goods Receipt
   * @category Items & Inventory
   * @description Retrieve a goods receipt by its internal DocEntry.
   * @route POST /get-goods-receipt
   * @paramDef {"type":"Number","label":"Goods Receipt","name":"docEntry","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Internal DocEntry of the goods receipt."}
   * @returns {Object}
   * @sampleResult {"DocEntry":13,"DocNum":4}
   */
  async getGoodsReceipt(docEntry) {
    return await this.#getDocument({ entity: 'InventoryGenEntries', docEntry, logTag: 'getGoodsReceipt' })
  }

  /**
   * @operationName List Goods Receipts
   * @category Items & Inventory
   * @description List goods receipts. Follows pagination to return all rows.
   * @route POST /list-goods-receipts
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Cap rows; blank returns all."}
   * @returns {Object}
   * @sampleResult {"value":[{"DocEntry":13,"DocNum":4}],"count":1}
   */
  async listGoodsReceipts(maxResults) {
    return await this.#listAll({ entity: 'InventoryGenEntries', maxResults, logTag: 'listGoodsReceipts' })
  }

  // ==========================================================================
  //  FINANCIALS
  // ==========================================================================
  /**
   * @operationName Create Journal Entry
   * @category Financials
   * @description Post a manual G/L journal entry with balanced debit/credit lines. Use for adjustments and accruals.
   * @route POST /create-journal-entry
   * @paramDef {"type":"Array<JournalEntryLine>","label":"Journal Lines","name":"journalEntryLines","required":true,"description":"Balanced debit/credit lines; total debits must equal total credits."}
   * @paramDef {"type":"String","label":"Posting Date","name":"referenceDate","uiComponent":{"type":"DATE_PICKER"},"description":"G/L posting date (defaults to today)."}
   * @paramDef {"type":"String","label":"Memo","name":"memo","description":"Journal memo."}
   * @returns {Object}
   * @sampleResult {"JdtNum":101,"Memo":"Accrual","TransId":4567}
   */
  async createJournalEntry(journalEntryLines, referenceDate, memo) {
    if (!Array.isArray(journalEntryLines) || !journalEntryLines.length) throw new Error('At least one journal line is required.')

    // docs: Service Layer API Reference - JournalEntries (header + JournalEntryLines[] of AccountCode/Debit/Credit)
    const body = {
      JournalEntryLines: journalEntryLines.map(l => {
        const line = {}

        if (l.AccountCode) line.AccountCode = l.AccountCode
        if (l.Debit !== undefined && l.Debit !== null && l.Debit !== '') line.Debit = l.Debit
        if (l.Credit !== undefined && l.Credit !== null && l.Credit !== '') line.Credit = l.Credit
        if (l.LineMemo) line.LineMemo = l.LineMemo

        return line
      }),
    }

    if (referenceDate) body.ReferenceDate = referenceDate
    if (memo) body.Memo = memo

    return await this.#apiRequest({ entity: 'JournalEntries', method: 'post', body, logTag: 'createJournalEntry' })
  }

  /**
   * @operationName Get Journal Entry
   * @category Financials
   * @description Retrieve a journal entry by its number (JdtNum).
   * @route POST /get-journal-entry
   * @paramDef {"type":"Number","label":"Journal Entry","name":"jdtNum","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getJournalEntriesDictionary","description":"Journal entry number (JdtNum)."}
   * @returns {Object}
   * @sampleResult {"JdtNum":101,"Memo":"Accrual","TransId":4567}
   */
  async getJournalEntry(jdtNum) {
    if (jdtNum === undefined || jdtNum === null || jdtNum === '') throw new Error('Journal Entry number (JdtNum) is required.')

    return await this.#apiRequest({ entity: `JournalEntries(${ Number(jdtNum) })`, method: 'get', logTag: 'getJournalEntry' })
  }

  /**
   * @operationName List Journal Entries
   * @category Financials
   * @description List journal entries. Follows pagination to return all rows.
   * @route POST /list-journal-entries
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Cap rows; blank returns all."}
   * @returns {Object}
   * @sampleResult {"value":[{"JdtNum":101,"Memo":"Accrual"}],"count":1}
   */
  async listJournalEntries(maxResults) {
    return await this.#listAll({ entity: 'JournalEntries', maxResults, logTag: 'listJournalEntries' })
  }

  /**
   * @operationName Update Journal Entry
   * @category Financials
   * @description Update a journal entry's memo or reference (PATCH; only supplied fields change).
   * @route POST /update-journal-entry
   * @paramDef {"type":"Number","label":"Journal Entry","name":"jdtNum","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getJournalEntriesDictionary","description":"Journal entry number (JdtNum) to update."}
   * @paramDef {"type":"String","label":"Memo","name":"memo","description":"New memo."}
   * @returns {Object}
   * @sampleResult {"JdtNum":101,"updated":true}
   */
  async updateJournalEntry(jdtNum, memo) {
    if (jdtNum === undefined || jdtNum === null || jdtNum === '') throw new Error('Journal Entry number (JdtNum) is required.')

    const body = {}

    if (memo) body.Memo = memo

    await this.#apiRequest({ entity: `JournalEntries(${ Number(jdtNum) })`, method: 'patch', body, logTag: 'updateJournalEntry' })

    return { JdtNum: Number(jdtNum), updated: true }
  }

  /**
   * @operationName Get Account
   * @category Financials
   * @description Retrieve a single G/L account from the chart of accounts by its code.
   * @route POST /get-account
   * @paramDef {"type":"String","label":"Account","name":"code","required":true,"dictionary":"getChartOfAccountsDictionary","description":"G/L account code."}
   * @returns {Object}
   * @sampleResult {"Code":"40000","Name":"Sales Revenue","ActiveAccount":"tYES"}
   */
  async getAccount(code) {
    if (!code) throw new Error('Account code is required.')

    return await this.#apiRequest({ entity: `ChartOfAccounts('${ encodeURIComponent(code) }')`, method: 'get', logTag: 'getAccount' })
  }

  /**
   * @operationName List Accounts
   * @category Financials
   * @description List or search G/L accounts (chart of accounts). Follows pagination to return all rows.
   * @route POST /list-accounts
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Match on account name."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Cap rows; blank returns all."}
   * @returns {Object}
   * @sampleResult {"value":[{"Code":"40000","Name":"Sales Revenue"}],"count":1}
   */
  async listAccounts(search, maxResults) {
    const safe = search ? String(search).replace(/'/g, "''") : null

    return await this.#listAll({
      entity: 'ChartOfAccounts',
      filter: safe ? `contains(Name,'${ safe }')` : undefined,
      maxResults,
      logTag: 'listAccounts',
    })
  }

  // ==========================================================================
  //  CRM - Activities
  // ==========================================================================
  /**
   * @operationName Create Activity
   * @category CRM
   * @description Create a CRM activity (call, meeting, task, note) linked to a business partner. Use to log customer interactions and follow-ups.
   * @route POST /create-activity
   * @paramDef {"type":"String","label":"Business Partner","name":"cardCode","required":true,"dictionary":"getBusinessPartnersDictionary","description":"Partner the activity is about."}
   * @paramDef {"type":"String","label":"Activity Type","name":"activityType","uiComponent":{"type":"DROPDOWN","options":{"values":["Conversation","Meeting","Task","Note","Phone Call"]}},"description":"Kind of activity."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Activity details."}
   * @paramDef {"type":"String","label":"Date","name":"activityDate","uiComponent":{"type":"DATE_PICKER"},"description":"When the activity occurs (defaults to today)."}
   * @returns {Object}
   * @sampleResult {"ActivityCode":1,"CardCode":"c1","Notes":"Follow-up call"}
   */
  async createActivity(cardCode, activityType, notes, activityDate) {
    if (!cardCode) throw new Error('Business Partner code is required.')

    // Created on the Activities entity; CardCode links the activity to its business partner.
    const body = { CardCode: cardCode }

    if (activityType) body.Activity = this.#resolveChoice(activityType, ACTIVITY_TYPE_LABELS)
    if (notes) body.Notes = notes
    if (activityDate) body.ActivityDate = activityDate

    return await this.#apiRequest({ entity: 'Activities', method: 'post', body, logTag: 'createActivity' })
  }

  /**
   * @operationName Get Activity
   * @category CRM
   * @description Retrieve a CRM activity by its ActivityCode.
   * @route POST /get-activity
   * @paramDef {"type":"Number","label":"Activity","name":"activityCode","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getActivitiesDictionary","description":"Internal ActivityCode of the activity."}
   * @returns {Object}
   * @sampleResult {"ActivityCode":1,"CardCode":"c1","Notes":"Follow-up call"}
   */
  async getActivity(activityCode) {
    if (activityCode === undefined || activityCode === null || activityCode === '') throw new Error('ActivityCode is required.')

    return await this.#apiRequest({ entity: `Activities(${ Number(activityCode) })`, method: 'get', logTag: 'getActivity' })
  }

  /**
   * @operationName List Activities
   * @category CRM
   * @description List or search CRM activities by business partner. Follows pagination to return all rows.
   * @route POST /list-activities
   * @paramDef {"type":"String","label":"Business Partner","name":"cardCode","dictionary":"getBusinessPartnersDictionary","description":"Limit to one partner."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Cap rows; blank returns all."}
   * @returns {Object}
   * @sampleResult {"value":[{"ActivityCode":1,"CardCode":"c1","Notes":"Follow-up call"}],"count":1}
   */
  async listActivities(cardCode, maxResults) {
    const filter = cardCode ? `CardCode eq '${ String(cardCode).replace(/'/g, "''") }'` : undefined

    return await this.#listAll({ entity: 'Activities', filter, maxResults, logTag: 'listActivities' })
  }

  /**
   * @operationName Update Activity
   * @category CRM
   * @description Update a CRM activity's notes (PATCH; only supplied fields change).
   * @route POST /update-activity
   * @paramDef {"type":"Number","label":"Activity","name":"activityCode","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getActivitiesDictionary","description":"Activity to update."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New activity details."}
   * @returns {Object}
   * @sampleResult {"ActivityCode":1,"updated":true}
   */
  async updateActivity(activityCode, notes) {
    if (activityCode === undefined || activityCode === null || activityCode === '') throw new Error('ActivityCode is required.')

    const body = {}

    if (notes) body.Notes = notes

    await this.#apiRequest({ entity: `Activities(${ Number(activityCode) })`, method: 'patch', body, logTag: 'updateActivity' })

    return { ActivityCode: Number(activityCode), updated: true }
  }

  /**
   * @operationName Delete Activity
   * @category CRM
   * @description Delete a CRM activity by its ActivityCode.
   * @route POST /delete-activity
   * @paramDef {"type":"Number","label":"Activity","name":"activityCode","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"dictionary":"getActivitiesDictionary","description":"Activity to delete."}
   * @returns {Object}
   * @sampleResult {"ActivityCode":1,"deleted":true}
   */
  async deleteActivity(activityCode) {
    if (activityCode === undefined || activityCode === null || activityCode === '') throw new Error('ActivityCode is required.')

    await this.#apiRequest({ entity: `Activities(${ Number(activityCode) })`, method: 'delete', logTag: 'deleteActivity' })

    return { ActivityCode: Number(activityCode), deleted: true }
  }

  // ==========================================================================
  //  QUERY - generic OData passthrough
  // ==========================================================================
  /**
   * @operationName Query Entities
   * @category Query
   * @description Run an advanced OData query against any Service Layer entity set with filter/select/sort. Returns ALL matching rows (follows pagination automatically). Use when no dedicated action fits.
   * @route POST /query-entities
   * @paramDef {"type":"String","label":"Entity Set","name":"entitySet","required":true,"description":"Service Layer entity set, e.g. Orders, BusinessPartners, Items."}
   * @paramDef {"type":"String","label":"Filter ($filter)","name":"filter","description":"OData filter, e.g. DocTotal gt 3000. Supports startswith/endswith/contains and and/or/not/eq/gt/lt."}
   * @paramDef {"type":"String","label":"Fields ($select)","name":"select","description":"Comma-separated fields to return, e.g. DocEntry,DocNum."}
   * @paramDef {"type":"String","label":"Sort ($orderby)","name":"orderby","description":"Sort expression, e.g. DocTotal asc."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Cap total rows; blank returns every matching row."}
   * @returns {Object}
   * @sampleResult {"value":[{"DocEntry":22,"DocNum":11,"DocTotal":1960}],"count":1,"pagesFollowed":1}
   */
  async queryEntities(entitySet, filter, select, orderby, maxResults) {
    if (!entitySet) throw new Error('Entity Set is required (e.g. Orders, BusinessPartners, Items).')

    return await this.#listAll({ entity: entitySet, filter, select, orderby, maxResults, logTag: 'queryEntities' })
  }

  // ==========================================================================
  //  POLLING TRIGGERS
  //  Service Layer has no webhook/push surface, so new-record events are detected by polling.
  //  Each trigger persists a high-water cursor between cycles and emits only rows newer than it.
  // ==========================================================================
  /**
   * @operationName On New Sales Order
   * @category Triggers
   * @description Fires when a new sales order is created in SAP Business One. Each new order (by its internal DocEntry) is emitted once. Use this to kick off fulfilment, notifications, or downstream sync the moment an order lands. Polling interval can be customized (minimum 30 seconds).
   * @route POST /on-new-sales-order
   * @registerAs POLLING_TRIGGER
   * @returns {Object}
   * @sampleResult {"DocEntry":22,"DocNum":11,"CardCode":"c1","CardName":"Customer c1","DocTotal":1960,"DocDate":"2026-06-01"}
   */
  async onNewSalesOrder() {}

  /**
   * @operationName On New Business Partner
   * @category Triggers
   * @description Fires when a new business partner (customer, vendor, or lead) is added in SAP Business One. Each new partner (by its CardCode) is emitted once. Use this to sync new accounts into your CRM, onboarding flow, or mailing list. Polling interval can be customized (minimum 30 seconds).
   * @route POST /on-new-business-partner
   * @registerAs POLLING_TRIGGER
   * @returns {Object}
   * @sampleResult {"CardCode":"c1","CardName":"Customer c1","CardType":"cCustomer","EmailAddress":"hello@acme.com","CreateDate":"2026-06-01"}
   */
  async onNewBusinessPartner() {}

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerPollingForEvent
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    return this[invocation.eventName](invocation)
  }

  // New Sales Orders by monotonic DocEntry. Cursor = highest DocEntry seen so far; on each cycle
  // we fetch only orders with DocEntry greater than the cursor (ascending) and emit them.
  async onNewSalesOrder(invocation) {
    return this.#pollByDocEntry({
      entity: 'Orders',
      select: 'DocEntry,DocNum,CardCode,CardName,DocTotal,DocDate',
      state: invocation && invocation.state,
      logTag: 'onNewSalesOrder',
    })
  }

  // New Business Partners. BusinessPartners have no monotonic DocEntry, so we cursor on CreateDate.
  // We fetch ascending with a server-side `CreateDate ge cursor` filter and follow odata.nextLink
  // for EVERY matching row (no fixed window) - so a burst of >200 new partners between polls is
  // paged through in full, never dropped. CreateDate is date-granular, so we refetch the cursor day
  // (ge, not gt) and dedup the boundary date via a seen set of CardCodes already emitted that day.
  async onNewBusinessPartner(invocation) {
    const state = (invocation && invocation.state) || {}
    const cursorDate = typeof state.cursorDate === 'string' ? state.cursorDate : null

    // First cycle: find the current latest CreateDate and seed the cursor without emitting the
    // backlog. A capped newest-first read is enough just to learn the boundary date + its codes.
    if (cursorDate === null) {
      const { value: latest } = await this.#listAll({
        entity: 'BusinessPartners',
        select: 'CardCode,CreateDate',
        orderby: 'CreateDate desc',
        maxResults: 200,
        logTag: 'onNewBusinessPartner',
      })
      const seedDate = latest.reduce((max, r) => (r.CreateDate > max ? r.CreateDate : max), '')

      return { events: [], state: { cursorDate: seedDate, seen: latest.filter(r => r.CreateDate === seedDate).map(r => r.CardCode) } }
    }

    const { value: rows } = await this.#listAll({
      entity: 'BusinessPartners',
      select: 'CardCode,CardName,CardType,EmailAddress,CreateDate',
      filter: `CreateDate ge '${ cursorDate }'`,
      orderby: 'CreateDate asc',
      logTag: 'onNewBusinessPartner',
    })

    const seen = new Set(Array.isArray(state.seen) ? state.seen : [])
    const newRows = rows.filter(r => !seen.has(r.CardCode))
    const maxDate = rows.reduce((max, r) => (r.CreateDate > max ? r.CreateDate : max), cursorDate)

    // Carry forward only the boundary (latest) date's CardCodes - the sole date that can still
    // receive more partners under a date-granular cursor, so the only set we must dedup next cycle.
    return { events: newRows, state: { cursorDate: maxDate, seen: rows.filter(r => r.CreateDate === maxDate).map(r => r.CardCode) } }
  }

  // Shared high-water-mark poller for document entities keyed by the monotonic DocEntry.
  async #pollByDocEntry({ entity, select, state, logTag }) {
    const lastDocEntry = state && typeof state.lastDocEntry === 'number' ? state.lastDocEntry : null
    const filter = lastDocEntry !== null ? `DocEntry gt ${ lastDocEntry }` : undefined

    const { value: rows } = await this.#listAll({
      entity,
      select,
      filter,
      orderby: 'DocEntry asc',
      maxResults: 200,
      logTag,
    })

    const maxSeen = rows.reduce((max, r) => (r.DocEntry > max ? r.DocEntry : max), lastDocEntry || 0)

    // First cycle: seed the cursor at the current max without emitting the existing backlog.
    if (lastDocEntry === null) {
      return { events: [], state: { lastDocEntry: maxSeen } }
    }

    return { events: rows, state: { lastDocEntry: maxSeen } }
  }
}

Flowrunner.ServerCode.addService(SAPBusinessOne, [
  {
    displayName: 'Service Layer Base URL',
    name: 'baseUrl',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Base URL of your SAP Business One Service Layer, e.g. https://my-b1-server:50000 (do not include /b1s/v1).',
  },
  {
    displayName: 'Company DB',
    name: 'companyDB',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'The company database schema name to log into, e.g. SBODEMOUS.',
  },
  {
    displayName: 'Username',
    name: 'username',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Service Layer user name (e.g. manager).',
  },
  {
    displayName: 'Password',
    name: 'password',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Password for the Service Layer user.',
  },
])
